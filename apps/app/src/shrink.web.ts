/** The longest edge of a photo made smaller after the server said it was too large. */
const SMALLER_EDGE = 2048;

/** Draws a smaller JPEG copy of a photo and returns it as a `blob:` uri the caller revokes. */
export async function shrinkPhoto(uri: string, edge = SMALLER_EDGE): Promise<string> {
    const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    if (!blob) throw new Error("The photo couldn't be re-encoded.");
    return URL.createObjectURL(blob);
}

/** Releases a copy made by `shrinkPhoto`. */
export function dropCopy(uri: string): void {
    URL.revokeObjectURL(uri);
}
