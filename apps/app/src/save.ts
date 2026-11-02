import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Linking } from "react-native";
import { Album, Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";

/** Thrown when the person has not let Linger add to their photo library. */
export class PhotosDenied extends Error {}

async function download(url: string): Promise<File> {
    return File.downloadFileAsync(url, new File(Paths.cache, `linger-${randomUUID()}.jpg`));
}

async function addToLibrary(url: string): Promise<void> {
    const file = await download(url);
    try {
        await Asset.create(file.uri);
    } finally {
        if (file.exists) file.delete();
    }
}

/** Downloads a photo and adds it to the photo library. */
export async function savePhoto(url: string): Promise<void> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied("Photo library access was not granted.");
    await addToLibrary(url);
}

/** Opens the share sheet with the photo itself, not a link that will expire. */
export async function sharePhoto(url: string): Promise<void> {
    const file = await download(url);
    await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", UTI: "public.jpeg" });
}

/** Phones can always save every photo into the library. */
export function canSaveAll(): boolean {
    return true;
}

/**
 * Asks for photo access once and returns a function that saves one photo. With full access the
 * photos go into an album named `album`, made on the first save; with add-only access, or if the
 * album can't be made, they go into the library without one.
 */
export async function photoSaver(album: string): Promise<(url: string) => Promise<void>> {
    const full = await requestPermissionsAsync(false).catch(() => null);
    if (!full?.granted) {
        const addOnly = await requestPermissionsAsync(true);
        if (!addOnly.granted) throw new PhotosDenied("Photo library access was not granted.");
        return (url) => addToLibrary(url);
    }
    let into: Album | null = await Album.get(album).catch(() => null);
    let albumFailed = false;
    return async (url) => {
        const file = await download(url);
        try {
            const asset = await Asset.create(file.uri, into ?? undefined);
            if (!into && !albumFailed) {
                into = await Album.create(album, [asset]).catch(() => null);
                albumFailed = into === null;
            }
        } finally {
            if (file.exists) file.delete();
        }
    };
}

/**
 * Saves each photo in turn into the library, asking for access once, reporting how many are
 * done. A photo that fails is skipped; resolves to the number saved.
 */
export async function saveAll(
    urls: readonly string[],
    onProgress: (done: number) => void,
): Promise<number> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied("Photo library access was not granted.");
    let saved = 0;
    for (const [i, url] of urls.entries()) {
        try {
            await addToLibrary(url);
            saved += 1;
        } catch {
            // Counted by the caller as total minus saved.
        }
        onProgress(i + 1);
    }
    return saved;
}

/** Adds a photo that is already on the device, such as one the event refused, to the library. */
export async function keepInPhotos(uri: string): Promise<void> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied("Photo library access was not granted.");
    await Asset.create(uri);
}

/** Opens Linger's page in the Settings app, where photo access can be turned on. */
export function openPhotoSettings(): void {
    Linking.openSettings().catch(() => null);
}
