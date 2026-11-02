export class PhotosDenied extends Error {}

async function blobOf(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with ${response.status}`);
    return response.blob();
}

function downloadBlob(blob: Blob): void {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `linger-${Date.now()}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Downloads a photo as a file. Signed URLs are on another origin, so it goes through a blob. */
export async function savePhoto(url: string): Promise<void> {
    downloadBlob(await blobOf(url));
}

/** Shares the photo file where the browser can, and downloads it otherwise. */
export async function sharePhoto(url: string): Promise<void> {
    const blob = await blobOf(url);
    const file = new File([blob], "linger.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
    }
    downloadBlob(blob);
}

/**
 * Phone browsers turn each download into its own prompt or tab, so saving every photo only
 * runs on a desktop browser until a ZIP download exists.
 */
export function canSaveAll(): boolean {
    if (typeof navigator === "undefined") return true;
    const phone = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
    const touchMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    return !phone && !touchMac;
}

/** Browsers have no album or permission to ask for; each photo is a download. */
export async function photoSaver(_album: string): Promise<(url: string) => Promise<void>> {
    return savePhoto;
}

/**
 * Downloads each photo in turn, reporting how many are done. A photo that fails is skipped;
 * resolves to the number saved.
 */
export async function saveAll(
    urls: readonly string[],
    onProgress: (done: number) => void,
): Promise<number> {
    let saved = 0;
    for (const [i, url] of urls.entries()) {
        try {
            await savePhoto(url);
            saved += 1;
        } catch {
            // Counted by the caller as total minus saved.
        }
        onProgress(i + 1);
    }
    return saved;
}

/** Downloads a photo that is already in the browser, such as one the event refused. */
export async function keepInPhotos(uri: string): Promise<void> {
    await savePhoto(uri);
}

/** Browsers have no settings page for this. */
export function openPhotoSettings(): void {}
