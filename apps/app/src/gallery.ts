import type { GalleryItem } from "@linger/core/shots";
import { useSyncExternalStore } from "react";

import { endActivity } from "@/activity";
import { api, asApiError, type ApiError, type GalleryPage } from "@/api";

// The gallery is kept per join code outside React, so the photo viewer and the recap page
// through the same photos the event screen loaded.

export interface GalleryState {
    /** The latest first page: counts before the reveal, photos after. */
    first: GalleryPage | undefined;
    items: GalleryItem[];
    cursor: string | null;
    loading: boolean;
    error: ApiError | null;
}

const EMPTY: GalleryState = {
    first: undefined,
    items: [],
    cursor: null,
    loading: false,
    error: null,
};
const galleries = new Map<string, GalleryState>();
const galleryListeners = new Set<() => void>();

function setGallery(code: string, patch: Partial<GalleryState>): void {
    galleries.set(code, { ...(galleries.get(code) ?? EMPTY), ...patch });
    for (const listener of galleryListeners) listener();
}

// Each refresh starts a new generation; a page that arrives for an older one is dropped, so a
// slow "load more" can't write stale photos and an old cursor over a fresh first page.
const generations = new Map<string, number>();

/** Loads the first page again, replacing what was loaded. */
export async function refreshGallery(code: string): Promise<void> {
    const generation = (generations.get(code) ?? 0) + 1;
    generations.set(code, generation);
    setGallery(code, { loading: true });
    try {
        const page = await api.guest.gallery(code);
        if (generations.get(code) !== generation) return;
        if (page.kind === "photos") endActivity(code).catch(() => null);
        setGallery(code, {
            first: page,
            items: page.kind === "photos" ? page.items : [],
            cursor: page.kind === "photos" ? page.nextCursor : null,
            loading: false,
            error: null,
        });
    } catch (error) {
        if (generations.get(code) !== generation) return;
        setGallery(code, { loading: false, error: asApiError(error) });
    }
}

/** Loads the next page of photos, if there is one. */
export async function loadMoreGallery(code: string): Promise<void> {
    const start = galleries.get(code) ?? EMPTY;
    if (start.loading || !start.cursor) return;
    const generation = generations.get(code) ?? 0;
    setGallery(code, { loading: true });
    try {
        const page = await api.guest.gallery(code, start.cursor);
        if (generations.get(code) !== generation) return;
        if (page.kind !== "photos") {
            setGallery(code, { first: page, items: [], cursor: null, loading: false });
            return;
        }
        const current = galleries.get(code) ?? EMPTY;
        const seen = new Set(current.items.map((item) => item.id));
        setGallery(code, {
            items: [...current.items, ...page.items.filter((item) => !seen.has(item.id))],
            cursor: page.nextCursor,
            loading: false,
            error: null,
        });
    } catch (error) {
        if (generations.get(code) !== generation) return;
        setGallery(code, { loading: false, error: asApiError(error) });
    }
}

/** Loads every page. Used before saving all photos. */
export async function loadWholeGallery(code: string): Promise<GalleryItem[]> {
    for (let guard = 0; guard < 200; guard++) {
        const state = galleries.get(code) ?? EMPTY;
        if (!state.cursor) return state.items;
        await loadMoreGallery(code);
        if ((galleries.get(code) ?? EMPTY).error) break;
    }
    return (galleries.get(code) ?? EMPTY).items;
}

/** Changes one photo in place, such as after a like. */
export function patchPhoto(code: string, id: string, patch: Partial<GalleryItem>): void {
    const state = galleries.get(code) ?? EMPTY;
    setGallery(code, {
        items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
}

export function useGallery(code: string): GalleryState {
    return useSyncExternalStore(
        (listener) => {
            galleryListeners.add(listener);
            return () => galleryListeners.delete(listener);
        },
        () => galleries.get(code) ?? EMPTY,
        () => galleries.get(code) ?? EMPTY,
    );
}
