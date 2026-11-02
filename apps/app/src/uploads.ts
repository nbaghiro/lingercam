import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { z } from "zod";

import { api, asApiError, onForgetEvents, storage, uploadFile } from "@/api";

// Every photo goes through this queue: reserve a shot, PUT the file to the signed URL, confirm.
// The queue is saved after every step, so photos taken with no signal upload after a restart.

const Upload = z.object({
    id: z.string(),
    code: z.string(),
    /** A `file://` path in the app's documents on iOS and Android, a `data:` URL on the web. */
    uri: z.string(),
    takenAt: z.string(),
    shotId: z.string().optional(),
    uploadUrl: z.string().optional(),
    uploaded: z.boolean().optional(),
    attempts: z.number().int(),
    nextAt: z.number(),
});
type Upload = z.infer<typeof Upload>;

const QUEUE_KEY = "uploads";
const leftKey = (code: string) => `shotsLeft:${code}`;
const failedKey = (code: string) => `uploadsFailed:${code}`;

/** Reservation failures that will not change on a retry. The photo can't be sent. */
const FINAL = new Set(["no-shots-left", "not-shooting", "not-joined", "not-found", "not-open"]);

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

function changed(): void {
    try {
        storage.set(QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // Browser storage can be full. The queue still works for this visit.
    }
    version += 1;
    for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<Upload>): void {
    queue = queue.map((u) => (u.id === id ? { ...u, ...patch } : u));
    changed();
}

function remove(upload: Upload): void {
    queue = queue.filter((u) => u.id !== upload.id);
    changed();
    if (upload.uri.startsWith("file:")) {
        try {
            const file = new File(upload.uri);
            if (file.exists) file.delete();
        } catch {
            // A leftover file in the app's documents is harmless.
        }
    }
}

/** Remembers what the server last said about shots left, so the counter works offline. */
export function setShotsLeft(code: string, left: number | null): void {
    storage.set(leftKey(code), left === null ? "unlimited" : String(left));
    version += 1;
    for (const listener of listeners) listener();
}

/** Counts a photo the server refused for good, so the guest is told instead of losing it quietly. */
function countFailed(code: string): void {
    storage.set(failedKey(code), (storage.getNumber(failedKey(code)) ?? 0) + 1);
}

/** Clears the count once the guest has seen it. */
export function dismissFailed(code: string): void {
    storage.remove(failedKey(code));
    version += 1;
    for (const listener of listeners) listener();
}

function knownLeft(code: string): number | null | undefined {
    const raw = storage.getString(leftKey(code));
    if (raw === undefined) return undefined;
    return raw === "unlimited" ? null : Number(raw);
}

/** Adds a photo to the queue and starts sending it. */
export function enqueue(code: string, uri: string, takenAt: Date): void {
    queue = [
        ...queue,
        { id: randomUUID(), code, uri, takenAt: takenAt.toISOString(), attempts: 0, nextAt: 0 },
    ];
    changed();
    resumeUploads();
}

function backoff(upload: Upload, patch: Partial<Upload> = {}): void {
    const attempts = upload.attempts + 1;
    const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempts - 1, 5));
    update(upload.id, { ...patch, attempts, nextAt: Date.now() + delay });
}

async function send(upload: Upload): Promise<void> {
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
        if (!upload.uploaded) {
            await uploadFile(uploadUrl, upload.uri, "image/jpeg");
            update(upload.id, { uploaded: true });
        }
        await api.shots.confirm(shotId);
        remove(upload);
    } catch (error) {
        const { code, status } = asApiError(error);
        const current = queue.find((u) => u.id === upload.id) ?? upload;
        if (!current.shotId && FINAL.has(code)) {
            if (code === "no-shots-left") setShotsLeft(upload.code, 0);
            countFailed(upload.code);
            remove(current);
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
                attempts: current.attempts,
                nextAt: current.nextAt,
            };
            queue = queue.map((u) => (u.id === upload.id ? fresh : u));
            backoff(fresh);
        } else {
            backoff(current);
        }
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
            await send(next);
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

// A deleted event or account takes this device's waiting photos and counts with it.
onForgetEvents((codes) => {
    for (const upload of queue.filter((u) => codes.includes(u.code))) remove(upload);
    for (const code of codes) {
        storage.remove(leftKey(code));
        storage.remove(failedKey(code));
    }
});

AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    // A retry that was waiting can go now: the app has just come back, often with signal.
    queue = queue.map((u) => ({ ...u, nextAt: 0 }));
    resumeUploads();
});

export interface ShotsState {
    /** Shots this guest can still take, counting photos not yet reserved. `null` is unlimited. */
    left: number | null | undefined;
    /** Photos taken here that have not finished uploading. */
    pending: number;
    /** True when an upload has failed at least once and is waiting to retry. */
    retrying: boolean;
    /** Photos the server refused for good, such as ones sent after the camera closed. */
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
        keptInPhotos: 0,
        unreadable: 0,
        sending: false,
        drained: 0,
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
