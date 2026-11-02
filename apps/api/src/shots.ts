import { createHash } from "node:crypto";
import { applyLook, LOOKS, type LookId } from "@linger/core/film";
import {
    canReserve,
    canSeeShot,
    photoAccess,
    REPORTS_TO_HIDE,
    RESERVATION_MINUTES,
    type GalleryItem,
    type GalleryPage,
    type Shot,
    type Viewer,
} from "@linger/core/shots";
import { shotsLeft } from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import {
    and,
    asc,
    count,
    countDistinct,
    eq,
    gt,
    inArray,
    lt,
    or,
    sql,
    type SQL,
} from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import sharp from "sharp";
import { z } from "zod";
import { requireHost } from "./accounts.ts";
import { boss, db, events, guests, likes, reports, shots } from "./db.ts";
import {
    eventByCode,
    ownedEvent,
    requireGuest,
    TAKEN_STATES,
    viewerFor,
    type EventRow,
    type GuestRow,
} from "./events.ts";
import { ApiError, body, errorDetail, log, uuidOr } from "./http.ts";
import {
    downloadUrl,
    get,
    keys,
    MAX_UPLOAD_BYTES,
    objectSize,
    put,
    remove,
    removePrefix,
    uploadUrl,
} from "./storage.ts";

export type ShotRow = typeof shots.$inferSelect;

/** Long edge of the developed photo and of its thumbnail. */
export const DEVELOPED_EDGE = 2048;
export const THUMB_EDGE = 512;
/** Larger inputs are refused instead of decoded: 50 MP is past any phone camera. */
export const MAX_INPUT_PIXELS = 50_000_000;
const PAGE_SIZE = 30;

export function shotJson(shot: ShotRow): Shot {
    return {
        id: shot.id,
        eventId: shot.eventId,
        guestId: shot.guestId,
        state: shot.state,
        takenAt: shot.takenAt.toISOString(),
        width: shot.width,
        height: shot.height,
        hidden: shot.hidden,
        reports: shot.reports,
        likes: shot.likes,
    };
}

export interface Developed {
    developed: Buffer;
    thumb: Buffer;
    width: number;
    height: number;
}

/** Turns an original into the developed photo (2048 px, JPEG q85) and its 512 px thumbnail. */
export async function developImage(
    original: Buffer,
    look: LookId,
    seed: number,
): Promise<Developed> {
    const { data, info } = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(DEVELOPED_EDGE, DEVELOPED_EDGE, { fit: "inside", withoutEnlargement: true })
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
    const pixels = applyLook(data, info.width, info.height, LOOKS[look], seed);
    const raw = { raw: { width: info.width, height: info.height, channels: 3 as const } };
    const developed = await sharp(pixels, raw).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    const thumb = await sharp(pixels, raw)
        .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside" })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    return { developed, thumb, width: info.width, height: info.height };
}

function seedFor(shotId: string): number {
    return createHash("sha256").update(shotId).digest().readUInt32LE(0);
}

/** Gives a shot back to its guest: their allowance goes up by one again. */
async function refund(guestId: string): Promise<void> {
    await db
        .update(guests)
        .set({ shotsTaken: sql`greatest(${guests.shotsTaken} - 1, 0)` })
        .where(eq(guests.id, guestId));
}

/**
 * The develop job: original in, developed photo and thumbnail out, then the original is deleted,
 * so nothing with the camera's metadata is kept. A file that can't be decoded as a photo marks
 * the shot failed and gives it back to the guest; storage errors throw, so the job retries.
 */
export async function developShot(shotId: string): Promise<ShotRow | null> {
    const [row] = await db
        .select({ shot: shots, look: sql<LookId>`${events.settings}->>'look'` })
        .from(shots)
        .innerJoin(events, eq(events.id, shots.eventId))
        .where(eq(shots.id, shotId));
    if (!row) return null;
    const { shot, look } = row;
    if (shot.state !== "uploaded") return shot;
    const original = await get(keys.shot(shot.eventId, shot.id, "original"));
    let out: Developed;
    try {
        out = await developImage(original, look, seedFor(shot.id));
    } catch (error) {
        log("warn", "photo could not be developed", {
            shotId: shot.id,
            error: errorDetail(error),
        });
        const [failed] = await db
            .update(shots)
            .set({ state: "failed" })
            .where(and(eq(shots.id, shot.id), eq(shots.state, "uploaded")))
            .returning();
        if (failed) {
            await refund(shot.guestId);
            await removePrefix(keys.shotFolder(shot.eventId, shot.id));
        }
        return failed ?? shot;
    }
    await put(keys.shot(shot.eventId, shot.id, "developed"), out.developed);
    await put(keys.shot(shot.eventId, shot.id, "thumb"), out.thumb);
    const [updated] = await db
        .update(shots)
        .set({ state: "developed", width: out.width, height: out.height })
        .where(eq(shots.id, shot.id))
        .returning();
    await remove(keys.shot(shot.eventId, shot.id, "original"));
    return updated ?? null;
}

/**
 * Releases reservations that were never confirmed, giving the shot back to the guest and
 * deleting anything uploaded for them.
 */
export async function releaseExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RESERVATION_MINUTES * 60_000);
    const released = await db.transaction(async (tx) => {
        const gone = await tx
            .delete(shots)
            .where(and(eq(shots.state, "reserved"), lt(shots.reservedAt, cutoff)))
            .returning({ id: shots.id, eventId: shots.eventId, guestId: shots.guestId });
        const perGuest = new Map<string, number>();
        for (const s of gone) perGuest.set(s.guestId, (perGuest.get(s.guestId) ?? 0) + 1);
        for (const [guestId, n] of perGuest) {
            await tx
                .update(guests)
                .set({ shotsTaken: sql`greatest(${guests.shotsTaken} - ${n}, 0)` })
                .where(eq(guests.id, guestId));
        }
        return gone;
    });
    for (const s of released) {
        await removePrefix(keys.shotFolder(s.eventId, s.id)).catch((error: unknown) =>
            log("warn", "could not clean a released shot", {
                shotId: s.id,
                error: errorDetail(error),
            }),
        );
    }
    return released.length;
}

export async function startShotWorkers(): Promise<void> {
    await boss.work<{ shotId: string }>("develop", { batchSize: 2 }, async (jobs) => {
        for (const job of jobs) await developShot(job.data.shotId);
    });
    await boss.work("release-reservations", async () => {
        await releaseExpired();
    });
    await boss.schedule("release-reservations", "* * * * *");
}

/**
 * Takes one shot from the guest's allowance in a single conditional UPDATE, so parallel requests
 * can never go past it. Returns null when there are none left. A `clientId` the guest already
 * reserved with returns that same shot, so a retry after a lost response doesn't take another.
 */
async function reserve(
    event: EventRow,
    guest: GuestRow,
    takenAt: Date,
    clientId: string | undefined,
): Promise<ShotRow | null> {
    return db.transaction(async (tx) => {
        if (clientId) {
            // Locking the guest serialises retries of the same photo.
            await tx
                .select({ id: guests.id })
                .from(guests)
                .where(eq(guests.id, guest.id))
                .for("update");
            const [existing] = await tx
                .select()
                .from(shots)
                .where(and(eq(shots.guestId, guest.id), eq(shots.clientId, clientId)));
            if (existing) {
                if (existing.state !== "reserved") return existing;
                const [renewed] = await tx
                    .update(shots)
                    .set({ reservedAt: new Date() })
                    .where(eq(shots.id, existing.id))
                    .returning();
                return renewed ?? existing;
            }
        }
        const allowance = sql`(select case when e.unlimited_shots then null
            else (e.settings->>'shotsPerGuest')::int end from events e where e.id = ${event.id})`;
        const [taken] = await tx
            .update(guests)
            .set({ shotsTaken: sql`${guests.shotsTaken} + 1` })
            .where(
                and(
                    eq(guests.id, guest.id),
                    sql`(${allowance} is null or ${guests.shotsTaken} < ${allowance})`,
                ),
            )
            .returning();
        if (!taken) return null;
        const [shot] = await tx
            .insert(shots)
            .values({ eventId: event.id, guestId: guest.id, takenAt, clientId: clientId ?? null })
            .returning();
        return shot ?? null;
    });
}

type Seen = Exclude<Viewer, { kind: "anonymous" }>;

function who(viewer: Seen): string {
    return viewer.kind === "host" ? `host:${viewer.hostId}` : `guest:${viewer.guestId}`;
}

/** The shot and its event, if the viewer may see the photo. Otherwise it doesn't exist for them. */
async function visibleShot(c: Context, shotId: string) {
    const missing = new ApiError(404, "not-found", "We couldn't find that photo.");
    uuidOr(shotId, missing);
    const [row] = await db
        .select({ shot: shots, event: events })
        .from(shots)
        .innerJoin(events, eq(events.id, shots.eventId))
        .where(eq(shots.id, shotId));
    if (!row) throw missing;
    const { viewer } = await viewerFor(c, row.event);
    if (!canSeeShot(row.event, viewer, row.shot, new Date())) throw missing;
    return { ...row, viewer };
}

function encodeCursor(shot: { takenAt: Date; id: string }): string {
    return Buffer.from(`${shot.takenAt.toISOString()}|${shot.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { takenAt: Date; id: string } | null {
    const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
    if (!at || !id || !z.uuid().safeParse(id).success || Number.isNaN(Date.parse(at))) return null;
    return { takenAt: new Date(at), id };
}

async function gallery(
    event: EventRow,
    viewer: Seen,
    cursor: string | undefined,
    limit: number,
): Promise<GalleryPage> {
    const now = new Date();
    const access = photoAccess(event, viewer, now);
    if (access === "none") {
        const [counts] = await db
            .select({
                total: count(),
                photographers: countDistinct(shots.guestId),
                mine: sql<number>`count(*) filter (where ${shots.guestId} = ${
                    viewer.kind === "guest" ? viewer.guestId : null
                })::int`,
            })
            .from(shots)
            .where(and(eq(shots.eventId, event.id), inArray(shots.state, [...TAKEN_STATES])));
        return {
            kind: "developing",
            total: counts?.total ?? 0,
            mine: counts?.mine ?? 0,
            photographers: counts?.photographers ?? 0,
            revealsAt: revealTime(event.settings).toISOString(),
        };
    }

    const filters: SQL[] = [eq(shots.eventId, event.id), eq(shots.state, "developed")];
    if (viewer.kind !== "host") filters.push(eq(shots.hidden, false));
    if (access === "own" && viewer.kind === "guest")
        filters.push(eq(shots.guestId, viewer.guestId));
    const [counts] = await db
        .select({ total: count(), photographers: countDistinct(shots.guestId) })
        .from(shots)
        .where(and(...filters));

    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after)
        throw new ApiError(400, "bad-cursor", "That page link is no longer valid.");
    const pageFilters = [...filters];
    if (after) {
        const later = or(
            gt(shots.takenAt, after.takenAt),
            and(eq(shots.takenAt, after.takenAt), gt(shots.id, after.id)),
        );
        if (later) pageFilters.push(later);
    }
    const rows = await db
        .select({
            shot: shots,
            name: guests.name,
            likedByMe: sql<boolean>`exists (select 1 from ${likes} l where l.shot_id = ${shots.id} and l.who = ${who(viewer)})`,
        })
        .from(shots)
        .innerJoin(guests, eq(guests.id, shots.guestId))
        .where(and(...pageFilters))
        .orderBy(asc(shots.takenAt), asc(shots.id))
        .limit(limit + 1);
    const page = rows.slice(0, limit);
    const items: GalleryItem[] = await Promise.all(
        page.map(async ({ shot, name, likedByMe }) => ({
            id: shot.id,
            url: await downloadUrl(keys.shot(shot.eventId, shot.id, "developed")),
            thumbUrl: await downloadUrl(keys.shot(shot.eventId, shot.id, "thumb")),
            width: shot.width ?? 0,
            height: shot.height ?? 0,
            takenAt: shot.takenAt.toISOString(),
            photographer: { id: shot.guestId, name },
            likes: shot.likes,
            likedByMe,
            hidden: shot.hidden,
        })),
    );
    const last = page.at(-1);
    return {
        kind: "photos",
        total: counts?.total ?? 0,
        photographers: counts?.photographers ?? 0,
        items,
        nextCursor: rows.length > limit && last ? encodeCursor(last.shot) : null,
    };
}

const ReserveRequest = z.object({
    takenAt: z.iso.datetime({ offset: true }).optional(),
    /** The app's id for the photo, sent again on every retry. */
    clientId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,64}$/)
        .optional(),
});

export const shotRoutes = new Hono();

shotRoutes.get("/v1/e/:code/gallery", async (c) => {
    const event = await eventByCode(c);
    const { viewer } = await viewerFor(c, event);
    const limit = Math.min(
        100,
        Math.max(1, Number(c.req.query("limit") ?? PAGE_SIZE) || PAGE_SIZE),
    );
    return c.json(await gallery(event, viewer, c.req.query("cursor"), limit));
});

shotRoutes.post("/v1/e/:code/shots", async (c) => {
    const event = await eventByCode(c);
    const guest = await requireGuest(c, event);
    const input: z.infer<typeof ReserveRequest> = c.req.header("content-type")?.includes("json")
        ? await body(c, ReserveRequest)
        : {};
    const now = new Date();
    const takenAt = input.takenAt
        ? new Date(Math.min(Date.parse(input.takenAt), now.getTime()))
        : now;
    if (!canReserve({ state: event.state, endsAt: event.settings.endsAt }, takenAt, now)) {
        throw new ApiError(409, "not-shooting", "The camera is closed for this event.");
    }
    const shot = await reserve(event, guest, takenAt, input.clientId);
    if (!shot) throw new ApiError(409, "no-shots-left", "You've used all your shots.");
    const [fresh] = await db.select().from(guests).where(eq(guests.id, guest.id));
    return c.json(
        {
            shotId: shot.id,
            uploadUrl: await uploadUrl(keys.shot(event.id, shot.id, "original")),
            shotsLeft: shotsLeft(event, fresh ?? guest),
        },
        201,
    );
});

shotRoutes.post("/v1/shots/:id/confirm", async (c) => {
    const missing = new ApiError(404, "not-found", "We couldn't find that shot.");
    const id = uuidOr(c.req.param("id"), missing);
    const expired = () =>
        new ApiError(410, "reservation-expired", "This shot's reservation ran out. Try again.");
    const [row] = await db
        .select({ shot: shots, event: events })
        .from(shots)
        .innerJoin(events, eq(events.id, shots.eventId))
        .where(eq(shots.id, id));
    if (!row) throw expired();
    const guest = await requireGuest(c, row.event);
    if (row.shot.guestId !== guest.id) throw missing;
    if (row.shot.state !== "reserved") return c.json({ shot: shotJson(row.shot) });
    const original = keys.shot(row.event.id, id, "original");
    const size = await objectSize(original);
    if (size === null) {
        throw new ApiError(409, "not-uploaded", "The photo hasn't finished uploading.");
    }
    if (size > MAX_UPLOAD_BYTES) {
        await remove(original);
        throw new ApiError(413, "too-large", "That photo is too large to send.");
    }
    const [updated] = await db
        .update(shots)
        .set({ state: "uploaded" })
        .where(and(eq(shots.id, id), eq(shots.state, "reserved")))
        .returning();
    if (updated) {
        await boss.send("develop", { shotId: id }, { retryLimit: 3, retryDelay: 10 });
        return c.json({ shot: shotJson(updated) });
    }
    // Something changed it since the read: a parallel confirm, or the release of the reservation.
    const [now] = await db.select().from(shots).where(eq(shots.id, id));
    if (!now) throw expired();
    return c.json({ shot: shotJson(now) });
});

shotRoutes.post("/v1/shots/:id/like", async (c) => {
    const { shot, viewer } = await visibleShot(c, c.req.param("id"));
    const key = who(viewer);
    const result = await db.transaction(async (tx) => {
        const [added] = await tx
            .insert(likes)
            .values({ shotId: shot.id, who: key })
            .onConflictDoNothing()
            .returning();
        if (!added)
            await tx.delete(likes).where(and(eq(likes.shotId, shot.id), eq(likes.who, key)));
        const [updated] = await tx
            .update(shots)
            .set({
                likes: sql`(select count(*) from ${likes} l where l.shot_id = ${shot.id})::int`,
            })
            .where(eq(shots.id, shot.id))
            .returning({ likes: shots.likes });
        return { liked: Boolean(added), likes: updated?.likes ?? 0 };
    });
    return c.json(result);
});

shotRoutes.post("/v1/shots/:id/report", async (c) => {
    const { shot, viewer } = await visibleShot(c, c.req.param("id"));
    const result = await db.transaction(async (tx) => {
        const [added] = await tx
            .insert(reports)
            .values({ shotId: shot.id, who: who(viewer) })
            .onConflictDoNothing()
            .returning();
        const n = sql<number>`(select count(*) from ${reports} r where r.shot_id = ${shot.id})::int`;
        const [counted] = await tx
            .update(shots)
            .set({ reports: n })
            .where(eq(shots.id, shot.id))
            .returning({ reports: shots.reports, hidden: shots.hidden });
        if (!counted) return { reports: shot.reports, hidden: shot.hidden };
        // Only the report that reaches the threshold hides the photo, so a host's decision to
        // show it again sticks until someone new reports it.
        if (added && counted.reports === REPORTS_TO_HIDE && !counted.hidden) {
            await tx.update(shots).set({ hidden: true }).where(eq(shots.id, shot.id));
            return { reports: counted.reports, hidden: true };
        }
        return counted;
    });
    if (result.hidden && !shot.hidden) log("info", "photo hidden by reports", { shotId: shot.id });
    return c.json({ reported: true, hidden: viewer.kind === "host" ? result.hidden : undefined });
});

shotRoutes.post("/v1/shots/:id/hide", async (c) => {
    const host = await requireHost(c);
    const missing = new ApiError(404, "not-found", "We couldn't find that photo.");
    const id = uuidOr(c.req.param("id"), missing);
    const [shot] = await db.select().from(shots).where(eq(shots.id, id));
    if (!shot) throw missing;
    await ownedEvent(host, shot.eventId);
    const { hidden } = await body(c, z.object({ hidden: z.boolean() }));
    const [updated] = await db.update(shots).set({ hidden }).where(eq(shots.id, id)).returning();
    return c.json({ shot: shotJson(updated ?? shot) });
});
