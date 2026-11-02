import NetInfo from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { z } from "zod";

import { api, ApiError, asApiError, onForgetEvents, storage, uploadFile } from "@/api";
import { keepInPhotos } from "@/save";
import { shrinkPhoto } from "@/shrink";

// Every photo goes through this queue: reserve a shot, PUT the file to the signed URL, confirm.
// The queue is saved after every step, so photos taken with no signal upload after a restart.

const Upload = z.object({
    id: z.string(),
    code: z.string(),
    /**
     * A `file://` path in the app's documents on iOS and Android. On the web, `stored:` for a
     * photo kept in IndexedDB under the upload's id; older queues may hold a `data:` URL.
     */
    uri: z.string(),
    takenAt: z.string(),
    shotId: z.string().optional(),
    uploadUrl: z.string().optional(),
    uploaded: z.boolean().optional(),
    /** Set once the photo has been made smaller after the server said it was too large. */
    resized: z.boolean().optional(),
    attempts: z.number().int(),
    nextAt: z.number(),
});
type Upload = z.infer<typeof Upload>;

const QUEUE_KEY = "uploads";
const leftKey = (code: string) => `shotsLeft:${code}`;
const failedKey = (code: string) => `uploadsFailed:${code}`;
const keptKey = (code: string) => `uploadsKept:${code}`;
const unreadableKey = (code: string) => `uploadsUnreadable:${code}`;

/** Reservation failures that will not change on a retry. The photo can't be sent. */
const FINAL = new Set(["no-shots-left", "not-shooting", "not-joined", "not-found", "not-open"]);

const JPEG = "image/jpeg";
const WEB = Platform.OS === "web";
const STORED = "stored:";

function read(): Upload[] {
    try {
        const raw = storage.getString(QUEUE_KEY);
        const parsed = raw ? z.array(Upload).safeParse(JSON.parse(raw)) : null;
        return parsed?.success ? parsed.data : [];
    } catch {
        return [];
    }
}

let queue: Upload[] = read();
let version = 0;
const listeners = new Set<() => void>();
/** The upload being sent right now. */
let inFlight: Upload | undefined;
/** When each event's queue last emptied, for `ShotsState.drained`. */
const drainedAt = new Map<string, number>();

function notify(): void {
    version += 1;
    for (const listener of listeners) listener();
}

function changed(): void {
    try {
        storage.set(QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // Browser storage can be full. The queue still works for this visit.
    }
    notify();
}

function update(id: string, patch: Partial<Upload>): void {
    queue = queue.map((u) => (u.id === id ? { ...u, ...patch } : u));
    changed();
}

// Photos waiting on the web live in IndexedDB as Blobs, which has room for a full roll where
// localStorage runs out after a few `data:` URLs. Only the queue's metadata stays in storage.

/** Photos not yet written to IndexedDB, or kept for this visit when IndexedDB refused them. */
const held = new Map<string, Blob>();
const writes = new Map<string, Promise<unknown>>();
let database: Promise<IDBDatabase> | undefined;

function photos(): Promise<IDBDatabase> {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("linger-uploads", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("photos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB didn't open."));
    }).catch((error: unknown) => {
        database = undefined;
        throw error;
    });
    return database;
}

async function inPhotos<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
    const db = await photos();
    return new Promise<T>((resolve, reject) => {
        const transaction = db.transaction("photos", mode);
        const request = run(transaction.objectStore("photos"));
        transaction.oncomplete = () => resolve(request.result as T);
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB aborted."));
    });
}

async function storeBlob(id: string, blob: Blob): Promise<void> {
    held.set(id, blob);
    try {
        await inPhotos("readwrite", (store) => store.put(blob, id));
        held.delete(id);
    } catch {
        // Kept in memory instead, so the photo still sends during this visit.
    }
}

async function storedBlob(id: string): Promise<Blob | undefined> {
    const kept = held.get(id);
    if (kept) return kept;
    try {
        const blob = await inPhotos<unknown>("readonly", (store) => store.get(id));
        return blob instanceof Blob ? blob : undefined;
    } catch {
        return undefined;
    }
}

/** A uri the upload and the photo library can read, released once they have. */
interface Local {
    uri: string;
    release(): void;
}

/** Opens a queued photo, or `null` when its file is gone. */
async function open(upload: Upload): Promise<Local | null> {
    if (upload.uri.startsWith(STORED)) {
        await writes.get(upload.id);
        const blob = await storedBlob(upload.id);
        if (!blob) return null;
        const uri = URL.createObjectURL(blob);
        return { uri, release: () => URL.revokeObjectURL(uri) };
    }
    if (upload.uri.startsWith("file:")) {
        try {
            if (!new File(upload.uri).exists) return null;
        } catch {
            return null;
        }
    }
    return { uri: upload.uri, release: () => undefined };
}

function discard(upload: Upload): void {
    if (upload.uri.startsWith(STORED)) {
        held.delete(upload.id);
        inPhotos("readwrite", (store) => store.delete(upload.id)).catch(() => null);
    } else if (upload.uri.startsWith("file:")) {
        try {
            const file = new File(upload.uri);
            if (file.exists) file.delete();
        } catch {
            // A leftover file in the app's documents is harmless.
        }
    }
}

function remove(upload: Upload): void {
    queue = queue.filter((u) => u.id !== upload.id);
    if (!queue.some((u) => u.code === upload.code)) drainedAt.set(upload.code, Date.now());
    changed();
    discard(upload);
}

/** Remembers what the server last said about shots left, so the counter works offline. */
export function setShotsLeft(code: string, left: number | null): void {
    storage.set(leftKey(code), left === null ? "unlimited" : String(left));
    notify();
}

function count(key: string): void {
    storage.set(key, (storage.getNumber(key) ?? 0) + 1);
}

/** Clears the refused and unreadable counts once the guest has seen them. */
export function dismissFailed(code: string): void {
    storage.remove(failedKey(code));
    storage.remove(keptKey(code));
    storage.remove(unreadableKey(code));
    notify();
}

function knownLeft(code: string): number | null | undefined {
    const raw = storage.getString(leftKey(code));
    if (raw === undefined) return undefined;
    return raw === "unlimited" ? null : Number(raw);
}

/** Adds a photo to the queue and starts sending it. */
export function enqueue(code: string, uri: string, takenAt: Date): void {
    const id = randomUUID();
    let kept = uri;
    if (WEB && !uri.startsWith("file:")) {
        kept = STORED;
        writes.set(
            id,
            fetch(uri)
                .then((res) => res.blob())
                .then((blob) => storeBlob(id, blob))
                .catch(() => null)
                .finally(() => writes.delete(id)),
        );
    }
    queue = [
        ...queue,
        { id, code, uri: kept, takenAt: takenAt.toISOString(), attempts: 0, nextAt: 0 },
    ];
    changed();
    resumeUploads();
}

function backoff(upload: Upload, patch: Partial<Upload> = {}): void {
    const attempts = upload.attempts + 1;
    const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempts - 1, 5));
    update(upload.id, { ...patch, attempts, nextAt: Date.now() + delay });
}

/**
 * PUTs a photo to its signed URL. On iOS the file goes through a background session, so the
 * transfer carries on while the phone is locked; reserving and confirming still need the app.
 */
async function put(uploadUrl: string, local: Local): Promise<void> {
    if (WEB || !local.uri.startsWith("file:")) {
        await uploadFile(uploadUrl, local.uri, JPEG);
        return;
    }
    const result = await new File(local.uri)
        .upload(uploadUrl, {
            httpMethod: "PUT",
            headers: { "Content-Type": JPEG },
            mimeType: JPEG,
            sessionType: "background",
        })
        .catch(() => null);
    // A session that fails before any response gets one try through fetch instead.
    if (result === null) {
        await uploadFile(uploadUrl, local.uri, JPEG);
        return;
    }
    if (result.status < 200 || result.status >= 300) {
        throw new ApiError(result.status, "upload-failed", "The photo didn't upload.");
    }
}

/** Replaces a queued photo with a smaller copy and returns the queue's new uri for it. */
async function shrink(upload: Upload, local: Local): Promise<string> {
    const smaller = await shrinkPhoto(local.uri);
    if (WEB) {
        try {
            await storeBlob(upload.id, await (await fetch(smaller)).blob());
        } finally {
            URL.revokeObjectURL(smaller);
        }
        return STORED;
    }
    discard(upload);
    return smaller;
}

/** A photo the server will never take: saved to the guest's photos first, then let go. */
async function refuse(upload: Upload, code: string): Promise<void> {
    if (code === "no-shots-left") setShotsLeft(upload.code, 0);
    const local = await open(upload);
    let kept = false;
    if (local) {
        try {
            await keepInPhotos(local.uri);
            kept = true;
        } catch {
            // No permission or no space: the guest is told the photo couldn't be added.
        } finally {
            local.release();
        }
    }
    count(kept ? keptKey(upload.code) : failedKey(upload.code));
    remove(upload);
}

function unreadable(upload: Upload): void {
    count(unreadableKey(upload.code));
    remove(upload);
}

async function send(upload: Upload): Promise<void> {
    // Only a photo still to be PUT needs its file; one already uploaded only needs confirming.
    const needsFile = !upload.uploaded || !upload.shotId;
    let local = needsFile ? await open(upload) : null;
    if (needsFile && !local) {
        unreadable(upload);
        return;
    }
    let { shotId, uploadUrl } = upload;
    try {
        if (!shotId || !uploadUrl) {
            // The queue id goes along, so a retry after a lost reply gets the same reservation.
            const reserved = await api.guest.reserveShot(upload.code, upload.takenAt, upload.id);
            shotId = reserved.shotId;
            uploadUrl = reserved.uploadUrl;
            update(upload.id, { shotId, uploadUrl, uploaded: false });
            setShotsLeft(upload.code, reserved.shotsLeft);
        }
        if (!upload.uploaded && local) {
            await put(uploadUrl, local);
            update(upload.id, { uploaded: true });
        }
        await api.shots.confirm(shotId);
        remove(upload);
    } catch (error) {
        const { code, status } = asApiError(error);
        const current = queue.find((u) => u.id === upload.id) ?? upload;
        if (!current.shotId && FINAL.has(code)) {
            await refuse(current, code);
        } else if (code === "too-large") {
            if (current.resized) {
                await refuse(current, code);
                return;
            }
            local ??= await open(current);
            if (!local) {
                unreadable(current);
                return;
            }
            // Made smaller once and sent again to the same reservation.
            const uri = await shrink(current, local).catch(() => null);
            if (uri === null) backoff(current, { uploaded: false, resized: true });
            else update(current.id, { uri, uploaded: false, resized: true, nextAt: 0 });
        } else if (code === "not-uploaded") {
            backoff(current, { uploaded: false });
        } else if (
            code === "reservation-expired" ||
            (code === "not-found" && current.shotId) ||
            (code === "upload-failed" && status === 403)
        ) {
            // The reservation or its signed URL ran out. Start again with a new one.
            const fresh: Upload = {
                id: current.id,
                code: current.code,
                uri: current.uri,
                takenAt: current.takenAt,
                resized: current.resized,
                attempts: current.attempts,
                nextAt: current.nextAt,
            };
            queue = queue.map((u) => (u.id === upload.id ? fresh : u));
            backoff(fresh);
        } else {
            backoff(current);
        }
    } finally {
        local?.release();
    }
}

let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const now = Date.now();
            const next = queue.find((u) => u.nextAt <= now);
            if (!next) break;
            inFlight = next;
            notify();
            try {
                await send(next);
            } finally {
                inFlight = undefined;
                notify();
            }
        }
    } finally {
        running = false;
        const soonest = Math.min(...queue.map((u) => u.nextAt));
        if (Number.isFinite(soonest)) {
            timer = setTimeout(resumeUploads, Math.max(250, soonest - Date.now()));
        }
    }
}

/** Sends whatever is waiting. Called on launch, on returning to the app and after each photo. */
export function resumeUploads(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pump().catch(() => null);
}

/** Drops the backoff, for the moments signal is likely back. */
function retryNow(): void {
    if (queue.length === 0) return;
    queue = queue.map((u) => ({ ...u, nextAt: 0 }));
    resumeUploads();
}

// A deleted event or account takes this device's waiting photos and counts with it.
onForgetEvents((codes) => {
    for (const upload of queue.filter((u) => codes.includes(u.code))) remove(upload);
    for (const code of codes) {
        drainedAt.delete(code);
        storage.remove(leftKey(code));
        storage.remove(failedKey(code));
        storage.remove(keptKey(code));
        storage.remove(unreadableKey(code));
    }
});

AppState.addEventListener("change", (state) => {
    if (state === "active") retryNow();
});

if (WEB) {
    if (typeof window !== "undefined") window.addEventListener("online", retryNow);
} else {
    let connected: boolean | null = null;
    NetInfo.addEventListener((state) => {
        if (state.isConnected && connected === false) retryNow();
        connected = state.isConnected;
    });
}

export interface ShotsState {
    /** Shots this guest can still take, counting photos not yet reserved. `null` is unlimited. */
    left: number | null | undefined;
    /** Photos taken here that have not finished uploading. */
    pending: number;
    /** True when an upload has failed at least once and is waiting to retry. */
    retrying: boolean;
    /** Photos the server refused for good that couldn't be saved to the guest's photos either. */
    failed: number;
    /** Refused photos that were saved to the guest's photo library instead. */
    keptInPhotos: number;
    /** Queued photos whose local file couldn't be read, so they were dropped. */
    unreadable: number;
    /** True while a photo for this event is on its way to the server. */
    sending: boolean;
    /** When this event's queue last emptied after holding photos, in ms since the epoch, or 0. */
    drained: number;
}

function measure(code: string): ShotsState {
    const mine = queue.filter((u) => u.code === code);
    const known = knownLeft(code);
    const unreserved = mine.filter((u) => !u.shotId).length;
    return {
        left: known === undefined || known === null ? known : Math.max(0, known - unreserved),
        pending: mine.length,
        retrying: mine.some((u) => u.attempts > 0),
        failed: storage.getNumber(failedKey(code)) ?? 0,
        keptInPhotos: storage.getNumber(keptKey(code)) ?? 0,
        unreadable: storage.getNumber(unreadableKey(code)) ?? 0,
        sending: inFlight?.code === code,
        drained: drainedAt.get(code) ?? 0,
    };
}

const snapshots = new Map<string, { version: number; state: ShotsState }>();

/** One object per change, so React sees a new value exactly when the queue moves. */
function snapshot(code: string): ShotsState {
    const cached = snapshots.get(code);
    if (cached?.version === version) return cached.state;
    const state = measure(code);
    snapshots.set(code, { version, state });
    return state;
}

export function useShots(code: string): ShotsState {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => snapshot(code),
        () => snapshot(code),
    );
}
