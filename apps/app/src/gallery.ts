import type { GalleryItem } from "@linger/core/shots";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { endActivity } from "@/activity";
import {
    api,
    asApiError,
    signedUrlExpiry,
    storage,
    useOnForeground,
    type ApiError,
    type GalleryPage,
} from "@/api";
import { t } from "@/copy";
import { canSaveAll, photoSaver, PhotosDenied } from "@/save";

// The gallery is kept per join code outside React, so the photo viewer and the recap page
// through the same photos the event screen loaded. A roll (one person's photos) is a gallery of
// its own, paged by the server with `?guest=`.

export interface GalleryState {
    /** The latest first page: counts before the reveal, photos after. */
    first: GalleryPage | undefined;
    items: GalleryItem[];
    cursor: string | null;
    loading: boolean;
    error: ApiError | null;
    /** When the first of the loaded signed URLs stops working, in ms since the epoch. */
    expiresAt: number | null;
}

const EMPTY: GalleryState = {
    first: undefined,
    items: [],
    cursor: null,
    loading: false,
    error: null,
    expiresAt: null,
};
const galleries = new Map<string, GalleryState>();
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

function keyOf(code: string, guest?: string): string {
    return guest ? `${code}~${guest}` : code;
}

function codeOf(key: string): string {
    return key.split("~")[0] ?? key;
}

function read(key: string): GalleryState {
    return galleries.get(key) ?? EMPTY;
}

function setGallery(key: string, patch: Partial<GalleryState>): void {
    galleries.set(key, { ...read(key), ...patch });
    emit();
}

function earliestExpiry(items: readonly GalleryItem[]): number | null {
    let earliest: number | null = null;
    for (const item of items) {
        for (const url of [item.url, item.thumbUrl]) {
            const at = signedUrlExpiry(url);
            if (at !== null && (earliest === null || at < earliest)) earliest = at;
        }
    }
    return earliest;
}

function photosOf(page: GalleryPage) {
    return page.kind === "photos"
        ? { items: page.items, cursor: page.nextCursor }
        : { items: [], cursor: null };
}

// Each refresh starts a new generation; a page that arrives for an older one is dropped, so a
// slow "load more" can't write stale photos and an old cursor over a fresh first page.
const generations = new Map<string, number>();

function nextGeneration(key: string): number {
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    return generation;
}

/** Loads the first page again, replacing what was loaded. `guest` loads one person's roll. */
export async function refreshGallery(code: string, guest?: string): Promise<void> {
    const key = keyOf(code, guest);
    const generation = nextGeneration(key);
    setGallery(key, { loading: true });
    try {
        const page = await api.guest.gallery(code, undefined, guest);
        if (generations.get(key) !== generation) return;
        if (page.kind === "photos" && !guest) endActivity(code).catch(() => null);
        const { items, cursor } = photosOf(page);
        setGallery(key, {
            first: page,
            items,
            cursor,
            loading: false,
            error: null,
            expiresAt: earliestExpiry(items),
        });
    } catch (error) {
        if (generations.get(key) !== generation) return;
        setGallery(key, { loading: false, error: asApiError(error) });
    }
}

/** Loads the next page of photos, if there is one. */
export async function loadMoreGallery(code: string, guest?: string): Promise<void> {
    const key = keyOf(code, guest);
    const start = read(key);
    if (start.loading || !start.cursor) return;
    const generation = generations.get(key) ?? 0;
    setGallery(key, { loading: true });
    try {
        const page = await api.guest.gallery(code, start.cursor, guest);
        if (generations.get(key) !== generation) return;
        if (page.kind !== "photos") {
            setGallery(key, { first: page, items: [], cursor: null, loading: false });
            return;
        }
        const current = read(key);
        const seen = new Set(current.items.map((item) => item.id));
        const added = page.items.filter((item) => !seen.has(item.id));
        const pageExpiry = earliestExpiry(added);
        setGallery(key, {
            items: [...current.items, ...added],
            cursor: page.nextCursor,
            loading: false,
            error: null,
            expiresAt:
                current.expiresAt === null
                    ? pageExpiry
                    : Math.min(current.expiresAt, pageExpiry ?? current.expiresAt),
        });
    } catch (error) {
        if (generations.get(key) !== generation) return;
        setGallery(key, { loading: false, error: asApiError(error) });
    }
}

/** Loads every page. */
export async function loadWholeGallery(code: string, guest?: string): Promise<GalleryItem[]> {
    const key = keyOf(code, guest);
    for (let guard = 0; guard < 200; guard++) {
        if (!read(key).cursor) return read(key).items;
        await loadMoreGallery(code, guest);
        if (read(key).error) break;
    }
    return read(key).items;
}

/** Fetches pages from the start until `count` photos are covered, without touching the store. */
async function fetchPages(
    code: string,
    guest: string | undefined,
    count: number,
): Promise<{ first: GalleryPage; items: GalleryItem[]; cursor: string | null }> {
    const first = await api.guest.gallery(code, undefined, guest);
    let { items, cursor } = photosOf(first);
    for (let guard = 0; cursor && items.length < count && guard < 200; guard++) {
        const page = await api.guest.gallery(code, cursor, guest);
        const more = photosOf(page);
        const seen = new Set(items.map((item) => item.id));
        items = [...items, ...more.items.filter((item) => !seen.has(item.id))];
        cursor = more.cursor;
    }
    return { first, items, cursor };
}

/**
 * Signs the loaded photos again, keeping as many pages as were loaded, so a screen left open
 * keeps its place and its images when the old URLs are about to stop working.
 */
export async function renewGallery(code: string, guest?: string): Promise<void> {
    const key = keyOf(code, guest);
    const before = read(key);
    if (!before.first) return refreshGallery(code, guest);
    const generation = nextGeneration(key);
    try {
        const fresh = await fetchPages(code, guest, before.items.length);
        if (generations.get(key) !== generation) return;
        setGallery(key, {
            first: fresh.first,
            items: fresh.items,
            cursor: fresh.cursor,
            loading: false,
            error: null,
            expiresAt: earliestExpiry(fresh.items),
        });
    } catch (error) {
        if (generations.get(key) !== generation) return;
        setGallery(key, { loading: false, error: asApiError(error) });
    }
}

/** URLs are signed again this long before they expire. */
export const RENEW_BEFORE_MS = 10 * 60_000;

function dueForRenewal(state: GalleryState, now = Date.now()): boolean {
    return state.expiresAt !== null && state.expiresAt - now <= RENEW_BEFORE_MS;
}

/**
 * Keeps a gallery's signed URLs working while a screen shows it: on focus, on returning to the
 * foreground, and on a timer, each time only when they are within 10 minutes of expiry.
 */
export function useFreshGallery(code: string, guest?: string): void {
    const key = keyOf(code, guest);
    const expiresAt = useGallery(code, guest).expiresAt;
    const renewIfDue = useCallback(() => {
        if (dueForRenewal(read(key))) renewGallery(code, guest).catch(() => null);
    }, [code, guest, key]);

    useFocusEffect(renewIfDue);
    useOnForeground(renewIfDue);
    useEffect(() => {
        if (expiresAt === null) return;
        const id = setTimeout(renewIfDue, Math.max(0, expiresAt - RENEW_BEFORE_MS - Date.now()));
        return () => clearTimeout(id);
    }, [expiresAt, renewIfDue]);
}

function eachGallery(code: string, change: (state: GalleryState) => Partial<GalleryState>): void {
    for (const [key, state] of galleries) {
        if (codeOf(key) === code) galleries.set(key, { ...state, ...change(state) });
    }
    emit();
}

/** Changes one photo in place in every gallery of the event, such as after a like. */
export function patchPhoto(code: string, id: string, patch: Partial<GalleryItem>): void {
    eachGallery(code, (state) => ({
        items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
}

/** Takes a photo out of every gallery of the event, after its photographer removed it. */
export function removePhoto(code: string, id: string): void {
    eachGallery(code, (state) => {
        if (!state.items.some((item) => item.id === id)) return {};
        const first =
            state.first?.kind === "photos"
                ? { ...state.first, total: Math.max(0, state.first.total - 1) }
                : state.first;
        return { first, items: state.items.filter((item) => item.id !== id) };
    });
}

export function useGallery(code: string, guest?: string): GalleryState {
    const key = keyOf(code, guest);
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => read(key),
        () => read(key),
    );
}

// The roll the event screen shows, so the viewer can open one from a photographer's name.

export interface RollOwner {
    id: string;
    name: string;
}

const rolls = new Map<string, RollOwner | null>();

/** Shows one person's roll on the event screen, or everyone with `null`. */
export function showRoll(code: string, owner: RollOwner | null): void {
    rolls.set(code, owner);
    emit();
}

export function useRoll(code: string): RollOwner | null {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => rolls.get(code) ?? null,
        () => rolls.get(code) ?? null,
    );
}

// Saving every photo. It runs outside any screen, so leaving the event doesn't stop it, and the
// event screen shows its progress whenever it is open.

export type SaveAllStatus =
    | { state: "idle" }
    | { state: "saving"; done: number; total: number }
    | { state: "done"; saved: number; total: number; sizeNote: boolean }
    | { state: "stopped"; saved: number; total: number }
    | { state: "denied" }
    | { state: "unavailable" }
    | { state: "failed"; code: string };

const IDLE: SaveAllStatus = { state: "idle" };
const saveRuns = new Map<string, SaveAllStatus>();
const stopping = new Set<string>();
const SIZE_NOTED = "save-size-noted";

function setSaveRun(code: string, status: SaveAllStatus): void {
    saveRuns.set(code, status);
    emit();
}

/**
 * Saves every photo of the event into an album named after it, asking for access once. URLs are
 * signed again before it starts and whenever they near expiry, a photo that fails is counted
 * and skipped, and `stopSaving` ends it after the photo in hand.
 */
export async function saveWholeGallery(code: string, album: string): Promise<void> {
    const running = saveRuns.get(code);
    if (running?.state === "saving") return;
    if (!canSaveAll()) {
        setSaveRun(code, { state: "unavailable" });
        return;
    }
    stopping.delete(code);
    setSaveRun(code, { state: "saving", done: 0, total: read(code).first?.total ?? 0 });

    let save: (url: string) => Promise<void>;
    try {
        save = await photoSaver(album);
    } catch (error) {
        setSaveRun(
            code,
            error instanceof PhotosDenied ? { state: "denied" } : { state: "failed", code: "" },
        );
        return;
    }

    let items: GalleryItem[];
    try {
        items = (await fetchPages(code, undefined, Number.POSITIVE_INFINITY)).items;
    } catch (error) {
        setSaveRun(code, { state: "failed", code: asApiError(error).code });
        return;
    }

    const total = items.length;
    let saved = 0;
    for (let i = 0; i < items.length; i++) {
        if (stopping.has(code)) {
            stopping.delete(code);
            setSaveRun(code, { state: "stopped", saved, total });
            return;
        }
        let item = items[i];
        if (!item) continue;
        // A long run outlives the URLs it started with; sign the rest again before they lapse.
        const expiry = signedUrlExpiry(item.url);
        if (expiry !== null && expiry - Date.now() < 2 * 60_000) {
            try {
                const fresh = (await fetchPages(code, undefined, Number.POSITIVE_INFINITY)).items;
                const byId = new Map(fresh.map((photo) => [photo.id, photo]));
                items = items.map((photo) => byId.get(photo.id) ?? photo);
                item = items[i] ?? item;
            } catch {
                // Try the old URL; if it has lapsed, the photo counts as not saved.
            }
        }
        try {
            await save(item.url);
            saved += 1;
        } catch {
            // Counted in the summary as a photo that couldn't be saved.
        }
        setSaveRun(code, { state: "saving", done: i + 1, total });
    }

    const sizeNote = !(storage.getBoolean(SIZE_NOTED) ?? false);
    if (sizeNote && saved > 0) storage.set(SIZE_NOTED, true);
    setSaveRun(code, { state: "done", saved, total, sizeNote: sizeNote && saved > 0 });
}

/** Stops "Download all" after the photo it is saving. */
export function stopSaving(code: string): void {
    if (saveRuns.get(code)?.state === "saving") stopping.add(code);
}

/** Clears a finished run's line. */
export function dismissSaving(code: string): void {
    if (saveRuns.get(code)?.state !== "saving") setSaveRun(code, IDLE);
}

export function useSaveAll(code: string): SaveAllStatus {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => saveRuns.get(code) ?? IDLE,
        () => saveRuns.get(code) ?? IDLE,
    );
}

/**
 * The line the event screen shows for a run: progress, the result, or what to do next. The
 * screen adds "Stop" while saving and "Open Settings" when access was refused.
 */
export function saveAllLine(status: SaveAllStatus): string | null {
    switch (status.state) {
        case "idle":
            return null;
        case "saving":
            return t("event.downloading", { done: status.done, total: status.total });
        case "done": {
            const result =
                status.saved === status.total
                    ? t("event.downloaded", { count: status.saved })
                    : t("save.partial", {
                          saved: status.saved,
                          total: status.total,
                          failed: status.total - status.saved,
                      });
            return status.sizeNote ? `${result} ${t("save.size")}` : result;
        }
        case "stopped":
            return t("event.downloaded", { count: status.saved });
        case "denied":
            return t("save.denied");
        case "unavailable":
            return t("save.webPhone");
        case "failed":
            return status.code ? t("event.loadFailed") : t("photo.saveFailed");
    }
}

/** The size line, the first time a photo is saved on this device, and never again. */
export function sizeNoteOnce(): string | null {
    if (storage.getBoolean(SIZE_NOTED) ?? false) return null;
    storage.set(SIZE_NOTED, true);
    return t("save.size");
}
