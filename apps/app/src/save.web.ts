export class PhotosDenied extends Error {}

async function blobOf(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with ${response.status}`);
    return response.blob();
}

/** Downloads a photo as a file. Signed URLs are on another origin, so it goes through a blob. */
export async function savePhoto(url: string): Promise<void> {
    const blob = await blobOf(url);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `linger-${Date.now()}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Shares the photo file where the browser can, and downloads it otherwise. */
export async function sharePhoto(url: string): Promise<void> {
    const blob = await blobOf(url);
    const file = new File([blob], "linger.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
    }
    await savePhoto(url);
}

/**
 * Downloads each photo in turn, reporting how many are done. Stops at the first failure and
 * resolves to the number saved.
 */
export async function saveAll(
    urls: readonly string[],
    onProgress: (done: number) => void,
): Promise<number> {
    let done = 0;
    for (const url of urls) {
        try {
            await savePhoto(url);
        } catch {
            break;
        }
        done += 1;
        onProgress(done);
    }
    return done;
}

/** Downloads a photo that is already in the browser, such as one the event refused. */
export async function keepInPhotos(uri: string): Promise<void> {
    await savePhoto(uri);
}
