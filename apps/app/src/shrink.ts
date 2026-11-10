import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { loadImage } from "react-native-nitro-image";

/** The longest edge of a photo made smaller after the server said it was too large. */
const SMALLER_EDGE = 2048;

/**
 * Writes a smaller JPEG copy of a photo into the app's documents and returns its `file://` uri.
 * The copy is drawn from the pixels, so none of the original's metadata, location included, comes
 * with it.
 */
export async function shrinkPhoto(uri: string, edge = SMALLER_EDGE): Promise<string> {
    const image = await loadImage({ filePath: uri });
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const smaller = await image.resizeAsync(
        Math.round(image.width * scale),
        Math.round(image.height * scale),
    );
    const dir = new Directory(Paths.document, "uploads");
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${randomUUID()}.jpg`);
    await smaller.saveToFileAsync(
        decodeURIComponent(target.uri.replace(/^file:\/\//, "")),
        "jpg",
        80,
    );
    return target.uri;
}

/** Deletes a copy made by `shrinkPhoto`. */
export function dropCopy(uri: string): void {
    const file = new File(uri);
    if (file.exists) file.delete();
}
