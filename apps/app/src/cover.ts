import type { Event } from "@linger/core/events";
import { api, uploadFile } from "@/api";
import { dropCopy, shrinkPhoto } from "@/shrink";

/** Long enough for a full-width cover on a large phone, small enough for a link preview. */
const COVER_EDGE = 1600;

/**
 * Sends a chosen photo as the event's cover: a JPEG copy made on the device, so no location or
 * HEIC reaches anyone who opens the link, then confirmed so the event only shows it once stored.
 */
export async function sendCover(eventId: string, uri: string): Promise<Event> {
    const jpeg = await shrinkPhoto(uri, COVER_EDGE);
    try {
        const { uploadUrl } = await api.events.cover(eventId);
        await uploadFile(uploadUrl, jpeg, "image/jpeg");
        return await api.events.coverDone(eventId);
    } finally {
        dropCopy(jpeg);
    }
}
