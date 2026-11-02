import { createHash } from "node:crypto";
import { applyLook, LOOKS, type LookId } from "@linger/core/film";
import {
    canReserve,
    canSeeShot,
    HIGHLIGHT_COUNTS,
    PENDING_NAMES,
    photoAccess,
    REPORTS_TO_HIDE,
    RESERVATION_MINUTES,
    type GalleryItem,
    type GalleryPage,
    type Highlights,
    type HighlightsFor,
    type Shot,
    type Viewer,
} from "@linger/core/shots";
import { firstName, shotsLeft } from "@linger/core/events";
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
    guestFor,
    ownedEvent,
    requireGuest,
    TAKEN_STATES,
    viewerFor,
    type EventRow,
    type GuestRow,
} from "./events.ts";
import { ApiError, body, deviceOf, errorDetail, log, uuidOr } from "./http.ts";
import { notifyHidden } from "./notify.ts";
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

type Row = { shot: ShotRow; name: string; likedByMe: boolean };

/** A photo as the gallery returns it, with fresh signed URLs. Reports are the host's to see. */
export async function galleryItem(row: Row, viewer: Seen): Promise<GalleryItem> {
    const { shot, name, likedByMe } = row;
    return {
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
        reports: viewer.kind === "host" ? shot.reports : 0,
    };
}

function rowColumns(viewer: Seen) {
    return {
        shot: shots,
        name: guests.name,
        likedByMe: sql<boolean>`exists (select 1 from ${likes} l where l.shot_id = ${shots.id} and l.who = ${who(viewer)})`,
    };
}

/** The developed photos a viewer may see in an event: not hidden unless they're the host. */
function visibleFilters(event: EventRow, viewer: Seen, access: "own" | "all", own: string): SQL[] {
    const filters: SQL[] = [eq(shots.eventId, event.id), eq(shots.state, "developed")];
    if (viewer.kind !== "host") filters.push(eq(shots.hidden, false));
    if (access === "own") filters.push(eq(shots.guestId, own));
    return filters;
}

async function gallery(
    event: EventRow,
    viewer: Seen,
    own: GuestRow,
    options: { cursor: string | undefined; limit: number; guest: string | undefined },
): Promise<GalleryPage> {
    const now = new Date();
    const access = photoAccess(event, viewer, now);
    if (access === "none") {
        const taken = and(eq(shots.eventId, event.id), inArray(shots.state, [...TAKEN_STATES]));
        const [counts] = await db
            .select({
                total: count(),
                photographers: countDistinct(shots.guestId),
                mine: sql<number>`count(*) filter (where ${shots.guestId} = ${own.id})::int`,
            })
            .from(shots)
            .where(taken);
        // Names aren't secret, and the developing tiles are signed with them.
        const named = await db
            .select({ name: guests.name })
            .from(shots)
            .innerJoin(guests, eq(guests.id, shots.guestId))
            .where(taken)
            .orderBy(asc(shots.takenAt), asc(shots.id))
            .limit(PENDING_NAMES);
        return {
            kind: "developing",
            total: counts?.total ?? 0,
            mine: counts?.mine ?? 0,
            photographers: counts?.photographers ?? 0,
            revealsAt: revealTime(event.settings).toISOString(),
            names: named.map((n) => firstName(n.name)),
        };
    }

    const filters = visibleFilters(event, viewer, access, own.id);
    if (options.guest) filters.push(eq(shots.guestId, options.guest));
    const [counts] = await db
        .select({
            total: count(),
            photographers: countDistinct(shots.guestId),
            mine: sql<number>`count(*) filter (where ${shots.guestId} = ${own.id})::int`,
        })
        .from(shots)
        .where(and(...filters));

    const after = options.cursor ? decodeCursor(options.cursor) : null;
    if (options.cursor && !after)
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
        .select(rowColumns(viewer))
        .from(shots)
        .innerJoin(guests, eq(guests.id, shots.guestId))
        .where(and(...pageFilters))
        .orderBy(asc(shots.takenAt), asc(shots.id))
        .limit(options.limit + 1);
    const page = rows.slice(0, options.limit);
    const items = await Promise.all(page.map((row) => galleryItem(row, viewer)));
    const last = page.at(-1);
    return {
        kind: "photos",
        total: counts?.total ?? 0,
        mine: counts?.mine ?? 0,
        photographers: counts?.photographers ?? 0,
        items,
        nextCursor: rows.length > options.limit && last ? encodeCursor(last.shot) : null,
    };
}

export interface Candidate {
    id: string;
    guestId: string;
    likes: number;
}

function before(a: readonly number[], b: readonly number[]): boolean {
    for (let i = 0; i < a.length; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x < y;
    }
    return false;
}

/**
 * Picks `n` photos spread across the night: the photos, in the order they were taken, are cut
 * into `n` runs, and each run gives the photo whose photographer has been picked least so far,
 * then the most liked, then the one nearest the middle of the run.
 */
function spread(candidates: Candidate[], n: number, picked: Map<string, number>): Candidate[] {
    const out: Candidate[] = [];
    if (n <= 0 || candidates.length === 0) return out;
    for (let i = 0; i < n; i++) {
        const from = Math.floor((i * candidates.length) / n);
        const to = Math.max(from + 1, Math.floor(((i + 1) * candidates.length) / n));
        const middle = (from + to - 1) / 2;
        let best: { c: Candidate; key: [number, number, number] } | null = null;
        for (let j = from; j < to && j < candidates.length; j++) {
            const c = candidates[j];
            if (!c) continue;
            const key: [number, number, number] = [
                picked.get(c.guestId) ?? 0,
                -c.likes,
                Math.abs(j - middle),
            ];
            if (!best || before(key, best.key)) best = { c, key };
        }
        if (best) {
            out.push(best.c);
            picked.set(best.c.guestId, (picked.get(best.c.guestId) ?? 0) + 1);
        }
    }
    return out;
}

/**
 * Chooses the moment's cards or the recap's slides from photos in the order they were taken,
 * returned in that order. The moment takes one of the viewer's own photos when they have one
 * (their most liked), then different photographers across the night. The recap takes the most
 * liked once anyone has liked something; before that, one or two per photographer across the
 * night.
 */
export function pickHighlights(
    candidates: Candidate[],
    purpose: HighlightsFor,
    viewerGuestId: string | null,
): Candidate[] {
    const n = HIGHLIGHT_COUNTS[purpose];
    if (candidates.length <= n) return candidates;
    const order = new Map(candidates.map((c, i) => [c.id, i]));
    const byTime = (a: Candidate, b: Candidate) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    if (purpose === "recap" && candidates.some((c) => c.likes > 0)) {
        return [...candidates]
            .sort((a, b) => b.likes - a.likes || byTime(a, b))
            .slice(0, n)
            .sort(byTime);
    }
    const picked = new Map<string, number>();
    const chosen: Candidate[] = [];
    if (purpose === "moment" && viewerGuestId) {
        const mine = candidates.filter((c) => c.guestId === viewerGuestId);
        const favourite = [...mine].sort((a, b) => b.likes - a.likes || byTime(a, b))[0];
        if (favourite) {
            chosen.push(favourite);
            picked.set(favourite.guestId, 1);
        }
    }
    const rest = candidates.filter((c) => !chosen.includes(c));
    chosen.push(...spread(rest, n - chosen.length, picked));
    return chosen.sort(byTime);
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
    const { viewer, guest } = await viewerFor(c, event);
    const limit = Math.min(
        100,
        Math.max(1, Number(c.req.query("limit") ?? PAGE_SIZE) || PAGE_SIZE),
    );
    const roll = c.req.query("guest");
    if (roll !== undefined && !z.uuid().safeParse(roll).success) {
        throw new ApiError(400, "invalid-request", "guest: not a guest id");
    }
    return c.json(
        await gallery(event, viewer, guest, { cursor: c.req.query("cursor"), limit, guest: roll }),
    );
});

/** The moment's three cards or the recap's twelve slides, signed, chosen by the server. */
shotRoutes.get("/v1/e/:code/highlights", async (c) => {
    const event = await eventByCode(c);
    const { viewer, guest } = await viewerFor(c, event);
    const purpose = z.enum(["moment", "recap"]).safeParse(c.req.query("for") ?? "moment");
    if (!purpose.success) {
        throw new ApiError(400, "invalid-request", "for: use moment or recap");
    }
    const access = photoAccess(event, viewer, new Date());
    if (access === "none") {
        throw new ApiError(409, "not-revealed", "The photos aren't out yet.");
    }
    const candidates = await db
        .select({ id: shots.id, guestId: shots.guestId, likes: shots.likes })
        .from(shots)
        .where(and(...visibleFilters(event, viewer, access, guest.id), eq(shots.hidden, false)))
        .orderBy(asc(shots.takenAt), asc(shots.id));
    const chosen = pickHighlights(candidates, purpose.data, guest.id);
    if (chosen.length === 0) return c.json({ items: [] } satisfies Highlights);
    const rows = await db
        .select(rowColumns(viewer))
        .from(shots)
        .innerJoin(guests, eq(guests.id, shots.guestId))
        .where(
            inArray(
                shots.id,
                chosen.map((p) => p.id),
            ),
        )
        .orderBy(asc(shots.takenAt), asc(shots.id));
    const items = await Promise.all(rows.map((row) => galleryItem(row, viewer)));
    return c.json({ items } satisfies Highlights);
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
    const window = {
        state: event.state,
        startsAt: event.settings.startsAt,
        endsAt: event.settings.endsAt,
        revealsAt: revealTime(event.settings).toISOString(),
    };
    if (!canReserve(window, takenAt, now)) {
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
    if (row.shot.guestId !== guest.id) {
        // A host who joined their own event from this device before shooting as the host.
        const device = deviceOf(c);
        const earlier = device ? await guestFor(row.event.id, device) : null;
        if (earlier?.id !== row.shot.guestId) throw missing;
    }
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
    const { shot, event, viewer } = await visibleShot(c, c.req.param("id"));
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
    if (result.hidden && !shot.hidden) {
        log("info", "photo hidden by reports", { shotId: shot.id });
        await notifyHidden(event);
    }
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

/** A photographer takes back one of their own photos. The shot isn't given back. */
shotRoutes.delete("/v1/shots/:id", async (c) => {
    const { shot, event } = await visibleShot(c, c.req.param("id"));
    const { guest } = await viewerFor(c, event);
    if (shot.guestId !== guest.id) {
        throw new ApiError(403, "not-yours", "Only the person who took a photo can remove it.");
    }
    await db.delete(shots).where(eq(shots.id, shot.id));
    await removePrefix(keys.shotFolder(shot.eventId, shot.id));
    return c.body(null, 204);
});
