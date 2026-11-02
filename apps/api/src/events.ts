import {
    canTransition,
    EventSettings,
    EventSettingsPatch,
    JoinRequest,
    lockedSettings,
    normalizeJoinCode,
    joinCode,
    shotsLeft,
    type Event,
    type EventState,
    type EventSummary,
    type Guest,
} from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import type { Viewer } from "@linger/core/shots";
import { tier } from "@linger/core/pricing";
import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { currentHost, requireHost, type Host } from "./accounts.ts";
import { db, events, guests, hosts, pushTokens, shots } from "./db.ts";
import { ApiError, body, clientIp, deviceOf, issueMessage, limiter, uuidOr } from "./http.ts";
import { advance, scheduleReveal } from "./reveal.ts";
import {
    downloadUrl,
    IMAGE_TYPES,
    keys,
    MAX_UPLOAD_BYTES,
    objectSize,
    uploadUrl,
} from "./storage.ts";

export type EventRow = typeof events.$inferSelect;
export type GuestRow = typeof guests.$inferSelect;

const apiUrl = process.env.API_URL ?? "http://localhost:8171";

/** Shots that count as taken: confirmed uploads and photos already developed. */
export const TAKEN_STATES = ["uploaded", "developed"] as const;

export function coverUrl(event: EventRow): string | null {
    return event.hasCover ? `${apiUrl}/v1/e/${event.code}/cover?v=${event.coverVersion}` : null;
}

export function eventJson(event: EventRow): Event {
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
    };
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

export async function requireGuest(c: Context, event: EventRow): Promise<GuestRow> {
    const device = deviceOf(c);
    if (!device) throw new ApiError(401, "no-device", "This request needs a device id.");
    const guest = await guestFor(event.id, device);
    if (!guest) throw new ApiError(403, "not-joined", "Join the event first.");
    return guest;
}

/**
 * The event's host when the bearer token belongs to them, otherwise the guest for this device.
 * Anyone else is refused.
 */
export async function viewerFor(
    c: Context,
    event: EventRow,
): Promise<{ viewer: Exclude<Viewer, { kind: "anonymous" }>; guest: GuestRow | null }> {
    const host = await currentHost(c);
    const device = deviceOf(c);
    const guest = device ? await guestFor(event.id, device) : null;
    if (host && host.id === event.hostId)
        return { viewer: { kind: "host", hostId: host.id }, guest };
    if (guest) return { viewer: { kind: "guest", guestId: guest.id }, guest };
    if (!host && !device) throw new ApiError(401, "no-device", "This request needs a device id.");
    throw new ApiError(403, "not-joined", "Join the event first.");
}

export async function guestCount(eventId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(guests).where(eq(guests.eventId, eventId));
    return row?.n ?? 0;
}

async function summary(event: EventRow): Promise<EventSummary> {
    const [host] = await db
        .select({ name: hosts.name })
        .from(hosts)
        .where(eq(hosts.id, event.hostId));
    const n = await guestCount(event.id);
    const s = event.settings;
    return {
        code: event.code,
        title: s.title,
        occasion: s.occasion,
        state: event.state,
        hostName: host?.name ?? "",
        coverUrl: coverUrl(event),
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        timeZone: s.timeZone,
        revealMode: s.revealMode,
        revealsAt: revealTime(s).toISOString(),
        shotsPerGuest: event.unlimitedShots ? null : s.shotsPerGuest,
        look: s.look,
        guestCount: n,
        full: n >= event.guestLimit,
    };
}

/** Creates an event with a fresh join code, retrying on the rare collision. */
export async function createEvent(hostId: string, settings: EventSettings): Promise<EventRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const [created] = await db
            .insert(events)
            .values({ hostId, code: joinCode(), settings, guestLimit: tier("free").guests })
            .onConflictDoNothing({ target: events.code })
            .returning();
        if (created) return created;
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

/**
 * New guests can join while the camera is open and until the reveal. After it, only people who
 * already joined get in, so a code found later doesn't open the photos.
 */
const JOIN_STATES: readonly EventState[] = ["live", "ended"];

export const eventRoutes = new Hono();

eventRoutes.get("/v1/events", async (c) => {
    const host = await requireHost(c);
    const rows = await db
        .select()
        .from(events)
        .where(eq(events.hostId, host.id))
        .orderBy(desc(events.createdAt));
    return c.json({ events: rows.map(eventJson) });
});

eventRoutes.post("/v1/events", async (c) => {
    const host = await requireHost(c);
    const settings = await body(c, EventSettings);
    if (settings.shotsPerGuest === null) {
        throw new ApiError(400, "needs-unlimited", "Unlimited shots needs the add-on.");
    }
    return c.json({ event: eventJson(await createEvent(host.id, settings)) }, 201);
});

eventRoutes.get("/v1/events/:id", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    return c.json({ event: eventJson(event) });
});

eventRoutes.patch("/v1/events/:id", async (c) => {
    const host = await requireHost(c);
    const { id } = await ownedEvent(host, c.req.param("id"));
    const patch = await body(c, EventSettingsPatch);
    // The row is locked so the reveal job can't change the state between the check and the write.
    const updated = await db.transaction(async (tx) => {
        const [event] = await tx.select().from(events).where(eq(events.id, id)).for("update");
        if (!event) throw notFound();
        const locked = lockedSettings(event, patch);
        if (locked.length > 0) {
            throw new ApiError(
                409,
                "locked",
                `These can't change once the event is ${event.state}: ${locked.join(", ")}.`,
            );
        }
        const merged = EventSettings.safeParse({ ...event.settings, ...patch });
        if (!merged.success) {
            throw new ApiError(400, "invalid-request", issueMessage(merged.error));
        }
        if (merged.data.shotsPerGuest === null && !event.unlimitedShots) {
            throw new ApiError(400, "needs-unlimited", "Unlimited shots needs the add-on.");
        }
        const [row] = await tx
            .update(events)
            .set({ settings: merged.data })
            .where(eq(events.id, id))
            .returning();
        return row ?? event;
    });
    if (updated.state === "live" || updated.state === "ended") {
        await scheduleReveal(updated);
        return c.json({ event: eventJson((await advance(updated.id)) ?? updated) });
    }
    return c.json({ event: eventJson(updated) });
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

eventRoutes.post("/v1/events/:id/live", async (c) => {
    const event = await ownedEvent(await requireHost(c), c.req.param("id"));
    if (Date.parse(event.settings.endsAt) <= Date.now()) {
        throw new ApiError(409, "already-over", "The end time has passed. Pick a new one first.");
    }
    const live = await setState(event, "live");
    await scheduleReveal(live);
    return c.json({ event: eventJson((await advance(live.id)) ?? live) });
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
    if (updated) await scheduleReveal(updated);
    return c.json({ event: eventJson(updated ?? event) });
});

eventRoutes.get("/v1/e/:code", async (c) => {
    const event = await eventByCode(c);
    return c.json({ event: await summary(event) });
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

eventRoutes.post("/v1/e/:code/join", async (c) => {
    const event = await eventByCode(c);
    const input = await body(c, JoinRequest);
    const guest = await db.transaction(async (tx) => {
        // Locking the event row serialises joins, so the guest limit holds under parallel joins.
        const [locked] = await tx
            .select({ guestLimit: events.guestLimit, state: events.state })
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
        if (!locked || !JOIN_STATES.includes(locked.state)) {
            throw new ApiError(409, "not-open", "This event isn't open to new guests.");
        }
        const [row] = await tx
            .select({ n: count() })
            .from(guests)
            .where(eq(guests.eventId, event.id));
        if ((row?.n ?? 0) >= (locked?.guestLimit ?? 0)) {
            throw new ApiError(409, "event-full", "This event is full. Ask the host to make room.");
        }
        const [created] = await tx
            .insert(guests)
            .values({ eventId: event.id, device: input.device, name: input.name })
            .returning();
        if (!created) throw new Error("Guest insert returned nothing");
        return created;
    });
    return c.json({ guest: guestJson(guest), shotsLeft: shotsLeft(event, guest) });
});

eventRoutes.get("/v1/e/:code/me", async (c) => {
    const event = await eventByCode(c);
    const guest = await requireGuest(c, event);
    return c.json({ guest: guestJson(guest), shotsLeft: shotsLeft(event, guest) });
});

eventRoutes.get("/v1/e/:code/people", async (c) => {
    const event = await eventByCode(c);
    await viewerFor(c, event);
    const rows = await db
        .select({
            id: guests.id,
            name: guests.name,
            joinedAt: guests.joinedAt,
            shots: sql<number>`count(${shots.id})::int`,
        })
        .from(guests)
        .leftJoin(shots, and(eq(shots.guestId, guests.id), inArray(shots.state, [...TAKEN_STATES])))
        .where(eq(guests.eventId, event.id))
        .groupBy(guests.id)
        .orderBy(desc(sql`count(${shots.id})`), guests.joinedAt);
    return c.json({
        people: rows.map((r) => ({
            id: r.id,
            name: r.name,
            shots: r.shots,
            joinedAt: r.joinedAt.toISOString(),
        })),
        guestLimit: event.guestLimit,
    });
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
