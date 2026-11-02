import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";

/** Thrown when the person has not let Linger add to their photo library. */
export class PhotosDenied extends Error {}

async function download(url: string): Promise<File> {
    return File.downloadFileAsync(url, new File(Paths.cache, `linger-${randomUUID()}.jpg`));
}

/** Downloads a photo and adds it to the photo library. */
export async function savePhoto(url: string): Promise<void> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied("Photo library access was not granted.");
    const file = await download(url);
    try {
        await Asset.create(file.uri);
    } finally {
        if (file.exists) file.delete();
    }
}

/** Opens the share sheet with the photo itself, not a link that will expire. */
export async function sharePhoto(url: string): Promise<void> {
    const file = await download(url);
    await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", UTI: "public.jpeg" });
}

/**
 * Saves each photo in turn, reporting how many are done. Stops at the first failure and resolves
 * to the number saved.
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

/** Adds a photo that is already on the device, such as one the event refused, to the library. */
export async function keepInPhotos(uri: string): Promise<void> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied("Photo library access was not granted.");
    await Asset.create(uri);
}
