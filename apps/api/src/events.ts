import {
    canTransition,
    dueState,
    EventSettings,
    EventSettingsPatch,
    GuestEmailRequest,
    JoinRequest,
    lockedSettings,
    normalizeJoinCode,
    joinCode,
    RestoreRequest,
    RestoreSendRequest,
    shotsLeft,
    type Event,
    type EventState,
    type EventSummary,
    type Guest,
    type Person,
    type SummaryViewer,
} from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import { canSeePhotos, type Viewer } from "@linger/core/shots";
import { tier } from "@linger/core/pricing";
import { and, count, countDistinct, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { currentHost, hostDevice, requireHost, type Host } from "./accounts.ts";
import { db, events, guests, hosts, pushTokens, shots } from "./db.ts";
import {
    ApiError,
    body,
    clientIp,
    deviceOf,
    errorDetail,
    issueMessage,
    limiter,
    log,
    uuidOr,
} from "./http.ts";
import {
    emailReveal,
    emailRestore,
    hashToken,
    notifyFull,
    notifyQuietly,
    revealLine,
} from "./notify.ts";
import { advance, cancelReveal, revealedCounts, scheduleReveal } from "./reveal.ts";
import {
    downloadUrl,
    IMAGE_TYPES,
    keys,
    MAX_UPLOAD_BYTES,
    objectSize,
    remove,
    removePrefix,
    uploadUrl,
} from "./storage.ts";

export type EventRow = typeof events.$inferSelect;
export type GuestRow = typeof guests.$inferSelect;

const apiUrl = process.env.API_URL ?? "http://localhost:8171";
const joinUrl = process.env.JOIN_URL ?? "http://localhost:8173";

/** Shots that count as taken: confirmed uploads and photos already developed. */
export const TAKEN_STATES = ["uploaded", "developed"] as const;

export function coverUrl(event: EventRow): string | null {
    return event.hasCover ? `${apiUrl}/v1/e/${event.code}/cover?v=${event.coverVersion}` : null;
}

export interface EventCounts {
    photoCount: number;
    guestCount: number;
}

export function eventJson(event: EventRow, counts: EventCounts): Event {
    return {
        id: event.id,
        code: event.code,
        hostId: event.hostId,
        state: event.state,
        settings: event.settings,
        tier: event.tier,
        unlimitedShots: event.unlimitedShots,
        guestLimit: event.guestLimit,
        coverUrl: coverUrl(event),
        createdAt: event.createdAt.toISOString(),
        revealsAt: revealTime(event.settings).toISOString(),
        revealedAt: event.revealedAt?.toISOString() ?? null,
        photoCount: counts.photoCount,
        guestCount: counts.guestCount,
    };
}

/** Photos taken and guests joined, for each event, in two grouped queries. */
export async function eventCounts(ids: string[]): Promise<Map<string, EventCounts>> {
    const out = new Map<string, EventCounts>(
        ids.map((id) => [id, { photoCount: 0, guestCount: 0 }]),
    );
    if (ids.length === 0) return out;
    const photos = await db
        .select({ id: shots.eventId, n: count() })
        .from(shots)
        .where(and(inArray(shots.eventId, ids), inArray(shots.state, [...TAKEN_STATES])))
        .groupBy(shots.eventId);
    const people = await db
        .select({ id: guests.eventId, n: count() })
        .from(guests)
        .where(and(inArray(guests.eventId, ids), eq(guests.isHost, false)))
        .groupBy(guests.eventId);
    for (const r of photos) {
        const entry = out.get(r.id);
        if (entry) entry.photoCount = r.n;
    }
    for (const r of people) {
        const entry = out.get(r.id);
        if (entry) entry.guestCount = r.n;
    }
    return out;
}

/** The event as the host's routes return it, with its counts. */
export async function hostEventJson(event: EventRow): Promise<Event> {
    const counts = await eventCounts([event.id]);
    return eventJson(event, counts.get(event.id) ?? { photoCount: 0, guestCount: 0 });
}

export function guestJson(guest: GuestRow): Guest {
    return {
        id: guest.id,
        eventId: guest.eventId,
        name: guest.name,
        shotsTaken: guest.shotsTaken,
        joinedAt: guest.joinedAt.toISOString(),
    };
}

const notFound = () => new ApiError(404, "not-found", "We couldn't find that event.");

export async function ownedEvent(host: Host, id: string): Promise<EventRow> {
    uuidOr(id, notFound());
    const [event] = await db.select().from(events).where(eq(events.id, id));
    if (!event || event.hostId !== host.id) throw notFound();
    return event;
}

// Join codes are short enough to guess, so an address that keeps missing is turned away.
const codeMisses = limiter("code-miss", 20, 10 * 60_000);

/** The event for the `:code` in the route. */
export async function eventByCode(c: Context): Promise<EventRow> {
    const ip = clientIp(c);
    codeMisses.check(ip);
    const code = normalizeJoinCode(c.req.param("code") ?? "");
    const [event] = code ? await db.select().from(events).where(eq(events.code, code)) : [];
    if (!event) {
        codeMisses.hit(ip);
        throw notFound();
    }
    return event;
}

export async function guestFor(eventId: string, device: string): Promise<GuestRow | null> {
    const [guest] = await db
        .select()
        .from(guests)
        .where(and(eq(guests.eventId, eventId), eq(guests.device, device)));
    return guest ?? null;
}

/**
 * The row the host shoots under at their own event. It doesn't count against the guest limit.
 * Made with the event; made here for events that predate it.
 */
export async function hostGuest(event: Pick<EventRow, "id" | "hostId">): Promise<GuestRow> {
    const device = hostDevice(event.hostId);
    const existing = await guestFor(event.id, device);
    if (existing) return existing;
    const [host] = await db
        .select({ name: hosts.name })
        .from(hosts)
        .where(eq(hosts.id, event.hostId));
    await db
        .insert(guests)
        .values({ eventId: event.id, device, name: host?.name ?? "Host", isHost: true })
        .onConflictDoNothing();
    const made = await guestFor(event.id, device);
    if (!made) throw new Error("Host guest row missing");
    return made;
}

/** The event's host, when the bearer token belongs to them. */
async function ownerOf(c: Context, event: EventRow): Promise<Host | null> {
    const host = await currentHost(c);
    return host && host.id === event.hostId ? host : null;
}

/** Who takes photos with this request: the host's own row for the host, or this device's guest. */
export async function requireGuest(c: Context, event: EventRow): Promise<GuestRow> {
    if (await ownerOf(c, event)) return hostGuest(event);
    const device = deviceOf(c);
    if (!device) throw new ApiError(401, "no-device", "This request needs a device id.");
    const guest = await guestFor(event.id, device);
    if (!guest) throw new ApiError(403, "not-joined", "Join the event first.");
    return guest;
}

/**
 * The event's host when the bearer token belongs to them, otherwise the guest for this device.
 * Anyone else is refused. `guest` is the row the viewer's own photos are filed under.
 */
export async function viewerFor(
    c: Context,
    event: EventRow,
): Promise<{ viewer: Exclude<Viewer, { kind: "anonymous" }>; guest: GuestRow }> {
    const host = await currentHost(c);
    if (host && host.id === event.hostId) {
        return { viewer: { kind: "host", hostId: host.id }, guest: await hostGuest(event) };
    }
    const device = deviceOf(c);
    const guest = device ? await guestFor(event.id, device) : null;
    if (guest) return { viewer: { kind: "guest", guestId: guest.id }, guest };
    if (!host && !device) throw new ApiError(401, "no-device", "This request needs a device id.");
    throw new ApiError(403, "not-joined", "Join the event first.");
}

/** Guests who joined; the host's own row doesn't count. */
export async function guestCount(eventId: string): Promise<number> {
    const [row] = await db
        .select({ n: count() })
        .from(guests)
        .where(and(eq(guests.eventId, eventId), eq(guests.isHost, false)));
    return row?.n ?? 0;
}

/** Whether the photos are out: once they are, counts are of photos people can see. */
export function photosOut(event: EventRow, now: Date): boolean {
    return canSeePhotos(event, { kind: "host", hostId: event.hostId }, now);
}

/** Before the reveal, every photo taken; after it, developed photos that aren't hidden. */
export function countedShots(event: EventRow, now: Date, seesHidden: boolean): SQL {
    if (!photosOut(event, now)) return inArray(shots.state, [...TAKEN_STATES]);
    const developed = eq(shots.state, "developed");
    return seesHidden ? developed : (and(developed, eq(shots.hidden, false)) ?? developed);
}

type Looking = { role: "host" | "guest"; guest: GuestRow } | { role: "none" };

async function lookingAt(c: Context, event: EventRow): Promise<Looking> {
    if (await ownerOf(c, event)) return { role: "host", guest: await hostGuest(event) };
    const device = deviceOf(c);
    const guest = device ? await guestFor(event.id, device) : null;
    return guest ? { role: "guest", guest } : { role: "none" };
}

async function summary(event: EventRow, looking: Looking): Promise<EventSummary> {
    const now = new Date();
    const [host] = await db
        .select({ name: hosts.name })
        .from(hosts)
        .where(eq(hosts.id, event.hostId));
    const n = await guestCount(event.id);
    const [photos] = await db
        .select({ n: count(), people: countDistinct(shots.guestId) })
        .from(shots)
        .where(and(eq(shots.eventId, event.id), countedShots(event, now, false)));
    const s = event.settings;
    const allowance = event.unlimitedShots ? null : s.shotsPerGuest;
    const viewer: SummaryViewer =
        looking.role === "none"
            ? { role: "none", guestId: null, shotsTaken: 0, shotsLeft: allowance }
            : {
                  role: looking.role,
                  guestId: looking.guest.id,
                  shotsTaken: looking.guest.shotsTaken,
                  shotsLeft: shotsLeft(event, looking.guest),
              };
    return {
        code: event.code,
        title: s.title,
        occasion: s.occasion,
        state: dueState(event.state, s, event.revealedAt, now),
        hostName: host?.name ?? "",
        coverUrl: coverUrl(event),
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        timeZone: s.timeZone,
        revealMode: s.revealMode,
        revealsAt: revealTime(s).toISOString(),
        shotsPerGuest: allowance,
        look: s.look,
        guestCount: n,
        full: n >= event.guestLimit,
        guestLimit: looking.role === "host" ? event.guestLimit : null,
        photoCount: photos?.n ?? 0,
        photographerCount: photos?.people ?? 0,
        viewer,
        now: now.toISOString(),
    };
}

/** Creates an event with a fresh join code, retrying on the rare collision, and the host's row. */
export async function createEvent(hostId: string, settings: EventSettings): Promise<EventRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const [created] = await db
            .insert(events)
            .values({ hostId, code: joinCode(), settings, guestLimit: tier("free").guests })
            .onConflictDoNothing({ target: events.code })
            .returning();
        if (created) {
            await hostGuest(created);
            return created;
        }
    }
    throw new Error("Could not find a free join code");
}

export async function setState(event: EventRow, to: EventState): Promise<EventRow> {
    if (!canTransition(event.state, to)) {
        throw new ApiError(409, "wrong-state", `An event can't go from ${event.state} to ${to}.`);
    }
    const [updated] = await db
        .update(events)
        .set({ state: to })
        .where(and(eq(events.id, event.id), eq(events.state, event.state)))
        .returning();
    if (!updated) throw new ApiError(409, "wrong-state", "The event changed. Try again.");
    return updated;
}

/** Tells every device when the reveal moved, so local reminders follow it. */
async function revealMoved(before: EventRow, after: EventRow): Promise<void> {
    const was = revealTime(before.settings).toISOString();
    const now = revealTime(after.settings).toISOString();
    if (was !== now) await notifyQuietly(after, { type: "reveal-changed", revealsAt: now });
}

/** Deletes an event's stored files, its queued jobs and its rows. */
export async function deleteEvent(event: EventRow): Promise<void> {
    await notifyQuietly(event, { type: "deleted" });
    await cancelReveal(event.id);
    await removePrefix(keys.event(event.id));
    await db.delete(events).where(eq(events.id, event.id));
}

/**
 * New guests can join while the camera is open and until the reveal. After it, only people who
 * already joined get in, so a code found later doesn't open the photos.
 */
const JOIN_STATES: readonly EventState[] = ["live", "ended"];

const emailsPerIp = limiter("guest-email-ip", 20, 60 * 60_000);
const restoreSendsPerIp = limiter("restore-send-ip", 10, 15 * 60_000);
const restoreSendsPerEmail = limiter("restore-send-email", 3, 15 * 60_000);
const restoresPerIp = limiter("restore-ip", 20, 15 * 60_000);

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
    );
}

const joinIndexUrl = process.env.JOIN_INDEX_URL || `${joinUrl}/index.html`;
let cachedIndex: { html: string; at: number } | null = null;

async function fetchJoinIndex(): Promise<string> {
    if (cachedIndex && Date.now() - cachedIndex.at < 5 * 60_000) return cachedIndex.html;
    const res = await fetch(joinIndexUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`index.html returned ${res.status}`);
    cachedIndex = { html: await res.text(), at: Date.now() };
    return cachedIndex.html;
}

/** The guest web app's index.html. Replaceable so tests don't need the web build. */
export const joinPage = { index: fetchJoinIndex };

const FALLBACK_INDEX =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Linger</title></head><body></body></html>';

/** index.html with an event's link preview tags in its head. */
export function withPreview(html: string, tags: Record<string, string>, title: string): string {
    const metas = Object.entries(tags)
        .map(([property, content]) => {
            const attr = property.startsWith("twitter:") ? "name" : "property";
            return `<meta ${attr}="${property}" content="${escapeHtml(content)}">`;
        })
        .join("");
    const titled = /<title>[^<]*<\/title>/i.test(html)
        ? html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
        : html.replace(/<head[^>]*>/i, (open) => `${open}<title>${escapeHtml(title)}</title>`);
    return titled.replace(/<\/head>/i, `${metas}</head>`);
}

function icsText(value: string): string {
    return value.replace(/[\\;,]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, "\\n");
}

function icsTime(at: Date): string {
    return at
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
}

/** Folds a content line at 75 bytes, as RFC 5545 asks. */
function icsFold(line: string): string {
    const parts: string[] = [];
    let current = "";
    for (const ch of line) {
        const limit = parts.length === 0 ? 75 : 74;
        if (Buffer.byteLength(current + ch) > limit) {
            parts.push(current);
            current = "";
        }
        current += ch;
    }
    parts.push(current);
    return parts.join("\r\n ");
}

/** A calendar file with one entry at the reveal, linking back to the event. */
export function revealCalendar(event: EventRow, now = new Date()): string {
    const at = revealTime(event.settings);
    const link = `${joinUrl}/j/${event.code}`;
    const title = event.settings.title;
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//GalleoApp//Linger//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:reveal-${event.code}@lingercam.app`,
        `DTSTAMP:${icsTime(now)}`,
        `DTSTART:${icsTime(at)}`,
        `DTEND:${icsTime(new Date(at.getTime() + 15 * 60_000))}`,
        `SUMMARY:${icsText(`${title}: the photos are ready`)}`,
        `DESCRIPTION:${icsText(`Open the event to see them: ${link}`)}`,
        `URL:${link}`,
        "END:VEVENT",
        "END:VCALENDAR",
    ];
    return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

export const eventRoutes = new Hono();

eventRoutes.get("/v1/events", async (c) => {
    const host = await requireHost(c);
    const rows = await db
        .select()
        .from(events)
        .where(eq(events.hostId, host.id))
        .orderBy(desc(events.createdAt));
    const counts = await eventCounts(rows.map((r) => r.id));
    return c.json({
        events: rows.map((r) => eventJson(r, counts.get(r.id) ?? { photoCount: 0, guestCount: 0 })),
    });
});

eventRoutes.post("/v1/events", async (c) => {
    const host = await requireHost(c);
    const settings = await body(c, EventSettings);
    if (settings.shotsPerGuest === null) {
        throw new ApiError(400, "needs-unlimited", "Unlimited shots needs the add-on.");
    }
    return c.json({ event: await hostEventJson(await createEvent(host.id, settings)) }, 201);
});

eventRoutes.get("/v1/events/:id", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    return c.json({ event: await hostEventJson(event) });
});

eventRoutes.patch("/v1/events/:id", async (c) => {
    const host = await requireHost(c);
    const before = await ownedEvent(host, c.req.param("id"));
    const patch = await body(c, EventSettingsPatch);
    // The row is locked so the reveal job can't change the state between the check and the write.
    const updated = await db.transaction(async (tx) => {
        const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, before.id))
            .for("update");
        if (!event) throw notFound();
        const locked = lockedSettings(event, patch);
        if (locked.length > 0) {
            throw new ApiError(
                409,
                "locked",
                `These can't change once the event is ${event.state}: ${locked.join(", ")}.`,
            );
        }
        const next = { ...event.settings, ...patch };
        // revealAt only belongs to a custom reveal, so switching to a preset clears it.
        if (patch.revealMode !== undefined && patch.revealMode !== "custom") delete next.revealAt;
        const merged = EventSettings.safeParse(next);
        if (!merged.success) {
            throw new ApiError(400, "invalid-request", issueMessage(merged.error));
        }
        if (merged.data.shotsPerGuest === null && !event.unlimitedShots) {
            throw new ApiError(400, "needs-unlimited", "Unlimited shots needs the add-on.");
        }
        const [row] = await tx
            .update(events)
            .set({ settings: merged.data })
            .where(eq(events.id, before.id))
            .returning();
        return row ?? event;
    });
    if (updated.state === "live" || updated.state === "ended") {
        await scheduleReveal(updated);
        await revealMoved(before, updated);
        return c.json({ event: await hostEventJson((await advance(updated.id)) ?? updated) });
    }
    return c.json({ event: await hostEventJson(updated) });
});

eventRoutes.delete("/v1/events/:id", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    await deleteEvent(event);
    log("info", "event deleted", { eventId: event.id });
    return c.body(null, 204);
});

eventRoutes.post("/v1/events/:id/cover", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    const { contentType } = c.req.header("content-type")?.includes("json")
        ? await body(c, z.object({ contentType: z.enum(IMAGE_TYPES).default("image/jpeg") }))
        : { contentType: "image/jpeg" as const };
    const [updated] = await db
        .update(events)
        .set({ hasCover: true, coverVersion: sql`${events.coverVersion} + 1` })
        .where(eq(events.id, event.id))
        .returning();
    if (!updated) throw notFound();
    return c.json({
        uploadUrl: await uploadUrl(keys.cover(event.id), contentType),
        coverUrl: coverUrl(updated),
    });
});

eventRoutes.delete("/v1/events/:id/cover", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    const [updated] = await db
        .update(events)
        .set({ hasCover: false, coverVersion: sql`${events.coverVersion} + 1` })
        .where(eq(events.id, event.id))
        .returning();
    if (!updated) throw notFound();
    await remove(keys.cover(event.id));
    return c.json({ event: await hostEventJson(updated) });
});

eventRoutes.post("/v1/events/:id/live", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    if (Date.parse(event.settings.endsAt) <= Date.now()) {
        throw new ApiError(409, "already-over", "The end time has passed. Pick a new one first.");
    }
    const live = await setState(event, "live");
    await scheduleReveal(live);
    return c.json({ event: await hostEventJson((await advance(live.id)) ?? live) });
});

eventRoutes.post("/v1/events/:id/end", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    if (event.state !== "live")
        throw new ApiError(409, "wrong-state", "Only a live event can end.");
    const now = new Date();
    let settings = event.settings;
    if (Date.parse(settings.endsAt) > now.getTime()) {
        settings = { ...settings, endsAt: now.toISOString() };
        if (Date.parse(settings.startsAt) >= now.getTime()) {
            settings = { ...settings, startsAt: new Date(now.getTime() - 60_000).toISOString() };
        }
        // A custom reveal can't sit before the new end, but it can stay where it was.
        if (settings.revealAt !== undefined && Date.parse(settings.revealAt) < now.getTime()) {
            settings = { ...settings, revealAt: settings.endsAt };
        }
    }
    await db.update(events).set({ settings }).where(eq(events.id, event.id));
    const updated = await advance(event.id, now);
    if (updated) {
        await scheduleReveal(updated);
        // A reveal that happened just now has already told everyone.
        if (updated.state !== "revealed") await revealMoved(event, updated);
    }
    return c.json({ event: await hostEventJson(updated ?? event) });
});

eventRoutes.get("/v1/e/:code", async (c) => {
    const event = await eventByCode(c);
    return c.json({ event: await summary(event, await lookingAt(c, event)) });
});

/** Summaries of the events this device joined as a guest, most recent first. */
eventRoutes.get("/v1/joined", async (c) => {
    const device = deviceOf(c);
    if (!device) throw new ApiError(401, "no-device", "This request needs a device id.");
    const rows = await db
        .select({ event: events, guest: guests })
        .from(guests)
        .innerJoin(events, eq(events.id, guests.eventId))
        .where(and(eq(guests.device, device), eq(guests.isHost, false)))
        .orderBy(desc(guests.joinedAt))
        .limit(100);
    const out: EventSummary[] = [];
    for (const r of rows) out.push(await summary(r.event, { role: "guest", guest: r.guest }));
    return c.json({ events: out });
});

eventRoutes.get("/v1/e/:code/cover", async (c) => {
    const event = await eventByCode(c);
    const size = event.hasCover ? await objectSize(keys.cover(event.id)) : null;
    if (size === null || size > MAX_UPLOAD_BYTES) {
        throw new ApiError(404, "no-cover", "This event has no cover photo yet.");
    }
    c.header("Cache-Control", "public, max-age=600");
    return c.redirect(await downloadUrl(keys.cover(event.id), 3600), 302);
});

/**
 * The guest web app's page for a shared link, with the event's preview tags. The join domain
 * sends `/<code>` here; anything that isn't an event gets the page unchanged.
 */
eventRoutes.get("/v1/e/:code/page", async (c) => {
    const html = await joinPage.index().catch((error: unknown) => {
        log("warn", "join index unavailable", { error: errorDetail(error) });
        return FALLBACK_INDEX;
    });
    c.header("Cache-Control", "public, max-age=300");
    let event: EventRow;
    try {
        event = await eventByCode(c);
    } catch (error) {
        // A mistyped path or a visitor over the code-miss limit still gets the app.
        if (
            error instanceof ApiError &&
            (error.code === "not-found" || error.code === "too-many")
        ) {
            return c.html(html);
        }
        throw error;
    }
    const title = `You're invited to shoot ${event.settings.title}`;
    const tags: Record<string, string> = {
        "og:type": "website",
        "og:site_name": "Linger",
        "og:title": title,
        "og:description": "Scan to join. No download needed.",
        "og:url": `${joinUrl}/${event.code}`,
        "twitter:card": event.hasCover ? "summary_large_image" : "summary",
    };
    const cover = coverUrl(event);
    if (cover) tags["og:image"] = cover;
    return c.html(withPreview(html, tags, title));
});

eventRoutes.get("/v1/e/:code/calendar.ics", async (c) => {
    const event = await eventByCode(c);
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="linger-${event.code}.ics"`);
    return c.body(revealCalendar(event));
});

eventRoutes.post("/v1/e/:code/join", async (c) => {
    const event = await eventByCode(c);
    // The host shoots under their own row and never takes a guest place.
    if (await ownerOf(c, event)) {
        const own = await hostGuest(event);
        return c.json({ guest: guestJson(own), shotsLeft: shotsLeft(event, own) });
    }
    const input = await body(c, JoinRequest);
    let guest: GuestRow;
    try {
        guest = await db.transaction(async (tx) => {
            // Locking the event row serialises joins, so the guest limit holds under parallel joins.
            const [locked] = await tx
                .select()
                .from(events)
                .where(eq(events.id, event.id))
                .for("update");
            const [existing] = await tx
                .select()
                .from(guests)
                .where(and(eq(guests.eventId, event.id), eq(guests.device, input.device)));
            if (existing) {
                if (existing.name === input.name) return existing;
                const [renamed] = await tx
                    .update(guests)
                    .set({ name: input.name })
                    .where(eq(guests.id, existing.id))
                    .returning();
                return renamed ?? existing;
            }
            if (!locked) throw notFound();
            const state = dueState(locked.state, locked.settings, locked.revealedAt, new Date());
            if (state === "revealed" || state === "archived") {
                throw new ApiError(
                    403,
                    "not-member",
                    "These photos are for the people who were there.",
                );
            }
            if (!JOIN_STATES.includes(state)) {
                throw new ApiError(409, "not-open", "This event isn't open to new guests.");
            }
            const [row] = await tx
                .select({ n: count() })
                .from(guests)
                .where(and(eq(guests.eventId, event.id), eq(guests.isHost, false)));
            if ((row?.n ?? 0) >= locked.guestLimit) {
                throw new ApiError(
                    409,
                    "event-full",
                    "This event is full. Ask the host to make room.",
                );
            }
            const [created] = await tx
                .insert(guests)
                .values({ eventId: event.id, device: input.device, name: input.name })
                .returning();
            if (!created) throw new Error("Guest insert returned nothing");
            return created;
        });
    } catch (error) {
        if (error instanceof ApiError && error.code === "event-full") await notifyFull(event);
        throw error;
    }
    return c.json({ guest: guestJson(guest), shotsLeft: shotsLeft(event, guest) });
});

eventRoutes.get("/v1/e/:code/me", async (c) => {
    const event = await eventByCode(c);
    const guest = await requireGuest(c, event);
    const [failed] = await db
        .select({ n: count() })
        .from(shots)
        .where(and(eq(shots.guestId, guest.id), eq(shots.state, "failed")));
    return c.json({
        guest: guestJson(guest),
        shotsLeft: shotsLeft(event, guest),
        // Photos the server couldn't develop; each one's shot went back to the guest.
        returned: failed?.n ?? 0,
    });
});

eventRoutes.get("/v1/e/:code/people", async (c) => {
    const event = await eventByCode(c);
    const { viewer } = await viewerFor(c, event);
    await hostGuest(event);
    const counted = countedShots(event, new Date(), viewer.kind === "host");
    const rows = await db
        .select({
            id: guests.id,
            name: guests.name,
            joinedAt: guests.joinedAt,
            isHost: guests.isHost,
            shots: sql<number>`count(${shots.id})::int`,
        })
        .from(guests)
        .leftJoin(shots, and(eq(shots.guestId, guests.id), counted))
        .where(eq(guests.eventId, event.id))
        .groupBy(guests.id)
        .orderBy(desc(guests.isHost), desc(sql`count(${shots.id})`), guests.joinedAt);
    const people: Person[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        shots: r.shots,
        joinedAt: r.joinedAt.toISOString(),
        host: r.isHost,
    }));
    return c.json({ people, guestLimit: event.guestLimit });
});

/**
 * Where a guest wants the reveal email, or null to forget it. Set after the reveal, the email
 * goes out at once.
 */
eventRoutes.post("/v1/e/:code/email", async (c) => {
    const event = await eventByCode(c);
    const guest = await requireGuest(c, event);
    const { email } = await body(c, GuestEmailRequest);
    emailsPerIp.take(clientIp(c));
    const [saved] = await db
        .update(guests)
        .set({ email, emailedAt: null })
        .where(eq(guests.id, guest.id))
        .returning();
    const state = dueState(event.state, event.settings, event.revealedAt, new Date());
    if (saved?.email && (state === "revealed" || state === "archived")) {
        const { photos, people } = await revealedCounts(event.id);
        const line = revealLine(event.settings.title, photos, people);
        await db.update(guests).set({ emailedAt: new Date() }).where(eq(guests.id, guest.id));
        await emailReveal({ id: guest.id, email: saved.email }, event, line);
    }
    return c.json({ email: saved?.email ?? null });
});

/**
 * "I joined on another device": emails a fresh link to the guest who left this address. The
 * reply is the same whether or not anyone did, so it can't be used to look addresses up.
 */
eventRoutes.post("/v1/e/:code/restore/send", async (c) => {
    const event = await eventByCode(c);
    const { email } = await body(c, RestoreSendRequest);
    restoreSendsPerIp.take(clientIp(c));
    restoreSendsPerEmail.take(email);
    const [guest] = await db
        .select({ id: guests.id, email: guests.email })
        .from(guests)
        .where(and(eq(guests.eventId, event.id), eq(guests.email, email)));
    if (guest?.email) await emailRestore({ id: guest.id, email: guest.email }, event);
    return c.json({ sent: true });
});

/**
 * Moves the guest an email link belongs to onto this device. A device that already joined as
 * someone else gives that place up only when it hasn't taken a photo.
 */
eventRoutes.post("/v1/e/:code/restore", async (c) => {
    const event = await eventByCode(c);
    const input = await body(c, RestoreRequest);
    restoresPerIp.take(clientIp(c));
    const guest = await db.transaction(async (tx) => {
        const [found] = await tx
            .select()
            .from(guests)
            .where(
                and(eq(guests.eventId, event.id), eq(guests.restoreHash, hashToken(input.token))),
            )
            .for("update");
        if (!found) {
            throw new ApiError(
                404,
                "bad-link",
                "That link has expired or belongs to another event.",
            );
        }
        if (found.device === input.device) return found;
        const [here] = await tx
            .select()
            .from(guests)
            .where(
                and(
                    eq(guests.eventId, event.id),
                    eq(guests.device, input.device),
                    ne(guests.id, found.id),
                ),
            );
        if (here && here.shotsTaken > 0) {
            throw new ApiError(
                409,
                "already-joined",
                "This device already joined as someone else.",
            );
        }
        if (here) await tx.delete(guests).where(eq(guests.id, here.id));
        const [moved] = await tx
            .update(guests)
            .set({ device: input.device })
            .where(eq(guests.id, found.id))
            .returning();
        return moved ?? found;
    });
    return c.json({ guest: guestJson(guest), shotsLeft: shotsLeft(event, guest) });
});

/** Stores an Expo push token for the signed-in host or for this device's guests. */
eventRoutes.post("/v1/push", async (c) => {
    const host = await currentHost(c);
    const device = deviceOf(c);
    if (!host && !device) throw new ApiError(401, "no-device", "This request needs a device id.");
    const { token } = await body(
        c,
        z.object({ token: z.string().regex(/^(Expo|Exponent)PushToken\[[^\]]+\]$/) }),
    );
    const owner = { hostId: host?.id ?? null, device, updatedAt: new Date() };
    // A token already stored moves only when the same host or device sends it again, or when it
    // has gone a month without being refreshed.
    const stale = new Date(Date.now() - 30 * 86_400_000);
    await db
        .insert(pushTokens)
        .values({ token, ...owner })
        .onConflictDoUpdate({
            target: pushTokens.token,
            set: owner,
            setWhere:
                or(
                    host ? eq(pushTokens.hostId, host.id) : sql`false`,
                    device ? eq(pushTokens.device, device) : sql`false`,
                    lt(pushTokens.updatedAt, stale),
                ) ?? sql`false`,
        });
    return c.json({ stored: true });
});
