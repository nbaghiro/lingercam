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
    /** A thumbhash, base64, to draw while the photo loads; null for photos developed before it. */
    placeholder: z.string().nullable(),
    takenAt: z.iso.datetime({ offset: true }),
    photographer: z.object({ id: z.string(), name: z.string() }),
    likes: z.number().int(),
    likedByMe: z.boolean(),
    /** Only true in the host's view; hidden photos are left out for everyone else. */
    hidden: z.boolean(),
    /** How many people reported it. Only the host sees the real count; everyone else gets 0. */
    reports: z.number().int(),
});
export type GalleryItem = z.infer<typeof GalleryItem>;

/** First names the developing page lists, one per photo, so the tiles can be signed. */
export const PENDING_NAMES = 40;

/**
 * Before the reveal the gallery is counts only, plus the first names of who took each photo in
 * the order they were taken (names aren't secret). After it, signed photos a page at a time.
 * `mine` counts the viewer's own photos in both.
 */
export const GalleryPage = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("developing"),
        total: z.number().int(),
        mine: z.number().int(),
        photographers: z.number().int(),
        revealsAt: z.iso.datetime({ offset: true }),
        names: z.array(z.string()).max(PENDING_NAMES),
    }),
    z.object({
        kind: z.literal("photos"),
        total: z.number().int(),
        mine: z.number().int(),
        photographers: z.number().int(),
        items: z.array(GalleryItem),
        nextCursor: z.string().nullable(),
    }),
]);
export type GalleryPage = z.infer<typeof GalleryPage>;

/** Cards the reveal moment fans out, and slides the recap plays. */
export const HIGHLIGHT_COUNTS = { moment: 3, recap: 12 } as const;
export type HighlightsFor = keyof typeof HIGHLIGHT_COUNTS;

/** `GET /v1/e/:code/highlights`: chosen by the server, in the order they were taken. */
export const Highlights = z.object({ items: z.array(GalleryItem) });
export type Highlights = z.infer<typeof Highlights>;

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

/** What the shooting rules need, from an EventSummary or an Event's state and settings. */
export interface ShootingWindow {
    state: Event["state"];
    startsAt: string;
    endsAt: string;
}

export type ShootingPhase = "before" | "open" | "closed";

/**
 * Where an event is in its shooting window. A draft, or a live event before its start, is
 * "before": guests can join and read the rules, and the camera opens at the start. Live between
 * the start and the end is "open". Everything else is "closed".
 */
export function shootingPhase(event: ShootingWindow, now: Date): ShootingPhase {
    const t = now.getTime();
    if (event.state === "draft") return "before";
    if (event.state !== "live" || t >= Date.parse(event.endsAt)) return "closed";
    return t < Date.parse(event.startsAt) ? "before" : "open";
}

/** Guests can take photos while the event is live, from its start until its end. */
export function canShoot(event: ShootingWindow, now: Date): boolean {
    return shootingPhase(event, now) === "open";
}

/** Days after the reveal that a photo taken while the camera was open is still accepted. */
export const LATE_UPLOAD_DAYS = 7;

/**
 * The last moment a late photo is accepted: LATE_UPLOAD_DAYS after the reveal, or after the end
 * when the reveal comes first (right-away events).
 */
export function lateUploadsUntil(event: { endsAt: string; revealsAt: string }): Date {
    const from = Math.max(Date.parse(event.endsAt), Date.parse(event.revealsAt));
    return new Date(from + LATE_UPLOAD_DAYS * 86_400_000);
}

/**
 * Whether a photo taken at `takenAt` can be reserved now. While the camera is open, any photo.
 * After the end, a photo taken while the camera was open still gets through until
 * `lateUploadsUntil`, whether the event has ended or already revealed, so a guest who opens the
 * app the next morning still gets their photos in. The allowance caps it either way.
 */
export function canReserve(
    event: ShootingWindow & { revealsAt: string },
    takenAt: Date,
    now: Date,
): boolean {
    if (canShoot(event, now)) return true;
    const taken = takenAt.getTime();
    return (
        (event.state === "live" || event.state === "ended" || event.state === "revealed") &&
        taken >= Date.parse(event.startsAt) &&
        taken <= Date.parse(event.endsAt) &&
        now.getTime() <= lateUploadsUntil(event).getTime()
    );
}
