import { z } from "zod";
import type { Event } from "./events.ts";
import { revealTime } from "./reveal.ts";

export const ShotState = z.enum(["reserved", "uploaded", "developed", "failed"]);
export type ShotState = z.infer<typeof ShotState>;

/** Reports that hide a photo until the host reviews it. */
export const REPORTS_TO_HIDE = 3;
/** Minutes before an unconfirmed reservation is released. */
export const RESERVATION_MINUTES = 10;

export const Shot = z.object({
    id: z.string(),
    eventId: z.string(),
    guestId: z.string(),
    state: ShotState,
    takenAt: z.iso.datetime({ offset: true }),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    hidden: z.boolean(),
    reports: z.number().int(),
    likes: z.number().int(),
});
export type Shot = z.infer<typeof Shot>;

export const GalleryItem = z.object({
    id: z.string(),
    url: z.string(),
    thumbUrl: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    takenAt: z.iso.datetime({ offset: true }),
    photographer: z.object({ id: z.string(), name: z.string() }),
    likes: z.number().int(),
    likedByMe: z.boolean(),
    /** Only true in the host's view; hidden photos are left out for everyone else. */
    hidden: z.boolean(),
});
export type GalleryItem = z.infer<typeof GalleryItem>;

/** Before the reveal the gallery is counts only; after it, signed photos a page at a time. */
export const GalleryPage = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("developing"),
        total: z.number().int(),
        mine: z.number().int(),
        photographers: z.number().int(),
        revealsAt: z.iso.datetime({ offset: true }),
    }),
    z.object({
        kind: z.literal("photos"),
        total: z.number().int(),
        photographers: z.number().int(),
        items: z.array(GalleryItem),
        nextCursor: z.string().nullable(),
    }),
]);
export type GalleryPage = z.infer<typeof GalleryPage>;

export type Viewer =
    { kind: "host"; hostId: string } | { kind: "guest"; guestId: string } | { kind: "anonymous" };

type VisibleEvent = Pick<Event, "state" | "hostId"> & {
    settings: Pick<
        Event["settings"],
        "startsAt" | "endsAt" | "timeZone" | "revealMode" | "revealAt" | "visibility"
    >;
};

/**
 * Which photos a viewer may see: none, only their own, or all. Nobody sees anything before the
 * reveal, the host included. With "host-only" visibility a guest sees only the photos they took.
 */
export function photoAccess(
    event: VisibleEvent,
    viewer: Viewer,
    now: Date,
): "none" | "own" | "all" {
    if (viewer.kind === "anonymous") return "none";
    if (viewer.kind === "host" && viewer.hostId !== event.hostId) return "none";
    if (!isRevealed(event, now)) return "none";
    if (viewer.kind === "host" || event.settings.visibility === "everyone") return "all";
    return "own";
}

function isRevealed(event: VisibleEvent, now: Date): boolean {
    switch (event.state) {
        case "draft":
            return false;
        case "revealed":
        case "archived":
            return true;
        case "live":
        case "ended":
            return (
                event.settings.revealMode === "right-away" &&
                now.getTime() >= revealTime(event.settings).getTime()
            );
    }
}

export function canSeePhotos(event: VisibleEvent, viewer: Viewer, now: Date): boolean {
    return photoAccess(event, viewer, now) !== "none";
}

/** Whether one photo is visible to a viewer. Hidden photos stay visible only to the host. */
export function canSeeShot(
    event: VisibleEvent,
    viewer: Viewer,
    shot: Pick<Shot, "guestId" | "state" | "hidden">,
    now: Date,
): boolean {
    if (shot.state !== "developed") return false;
    const access = photoAccess(event, viewer, now);
    if (access === "none") return false;
    if (shot.hidden && viewer.kind !== "host") return false;
    if (access === "own") return viewer.kind === "guest" && viewer.guestId === shot.guestId;
    return true;
}

/** What the shooting rules need, from an Event (`settings.endsAt`) or an EventSummary. */
export interface ShootingWindow {
    state: Event["state"];
    endsAt: string;
}

/** Guests can take photos while the event is live and has not passed its end time. */
export function canShoot(event: ShootingWindow, now: Date): boolean {
    return event.state === "live" && now.getTime() < Date.parse(event.endsAt);
}

/** Minutes after the end that a photo taken before it can still be reserved and uploaded. */
export const LATE_UPLOAD_MINUTES = 60;

/**
 * Whether a photo taken at `takenAt` can be reserved now. While the camera is open, any photo.
 * After the end, a photo taken before it still gets through for LATE_UPLOAD_MINUTES, whether the
 * event has ended or already revealed, so photos queued on a weak connection aren't lost.
 */
export function canReserve(event: ShootingWindow, takenAt: Date, now: Date): boolean {
    if (canShoot(event, now)) return true;
    const ends = Date.parse(event.endsAt);
    return (
        (event.state === "live" || event.state === "ended" || event.state === "revealed") &&
        takenAt.getTime() <= ends &&
        now.getTime() <= ends + LATE_UPLOAD_MINUTES * 60_000
    );
}
