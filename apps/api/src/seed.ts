import { readFile } from "node:fs/promises";
import type { EventSettings, EventState } from "@linger/core/events";
import { zonedInstant, wallTime, SMALL_HOURS_END } from "@linger/core/reveal";
import { tier, type TierId } from "@linger/core/pricing";
import { eq, sql } from "drizzle-orm";
import { DEMO_EMAIL, DEMO_NAME, findOrCreateHost } from "./accounts.ts";
import { db, events, guests, hosts, likes, shots, startQueue, stopQueue } from "./db.ts";
import { isProduction, log } from "./http.ts";
import { scheduleReveal } from "./reveal.ts";
import { developShot } from "./shots.ts";
import { keys, put, removePrefix } from "./storage.ts";

const PHOTOS = new URL("../../app/assets/demo/", import.meta.url);
const ZONE = "America/Vancouver";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Who takes each photo, by guest index: uneven, like a real night. */
const SHOOTERS = [0, 1, 2, 0, 3, 4, 1, 5, 6, 0, 2, 7, 3, 1, 0, 4, 5, 2, 6, 0, 1, 7, 3, 2];

interface SeedEvent {
    code: string;
    state: EventState;
    settings: EventSettings;
    tier: TierId;
    cover: string;
    revealedAt: Date | null;
    guests: string[];
    /** Photo file names, shot by guests in turn. */
    photos: string[];
}

function localDay(offsetDays: number, hour: number, minute = 0): Date {
    const today = wallTime(new Date(), ZONE);
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
    return zonedInstant(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        ZONE,
    );
}

const iso = (d: Date) => d.toISOString();

function plan(now: Date): SeedEvent[] {
    const weddingStart = localDay(-13, 15);
    const weddingEnd = localDay(-13, 23, 30);

    const juneEnd = new Date(now.getTime() - HOUR);
    // A next-morning reveal from an end in the small hours would be this morning, not tomorrow.
    const nextMorning = wallTime(juneEnd, ZONE).hour >= SMALL_HOURS_END;
    const junReveal: Pick<EventSettings, "revealMode" | "revealAt"> = nextMorning
        ? { revealMode: "next-morning" }
        : { revealMode: "custom", revealAt: iso(localDay(1, 10)) };

    return [
        {
            code: "EMMADN",
            state: "revealed",
            tier: "tier-150",
            cover: "w-hero.jpg",
            revealedAt: localDay(-12, 10),
            settings: {
                occasion: "wedding",
                title: "Emma & Daniel's Wedding day",
                startsAt: iso(weddingStart),
                endsAt: iso(weddingEnd),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: [
                "Sofia M.",
                "Jun K.",
                "Ade O.",
                "Priya R.",
                "Tom B.",
                "Lena W.",
                "Marco D.",
                "Hana S.",
            ],
            photos: [
                "w-toast.jpg",
                "w-speech.jpg",
                "w-dance.jpg",
                "w-clink.jpg",
                "w-tear.jpg",
                "w-bw.jpg",
                "w-elders.jpg",
                "w-walk.jpg",
                "w-crowd.jpg",
                "w-bouquet.jpg",
                "w-dog.jpg",
                "w-sil.jpg",
                "w-lights.jpg",
                "w-hero.jpg",
                "e-couple.jpg",
                "e-fiesta.jpg",
                "e-hero.jpg",
                "b-table.jpg",
                "b-cup.jpg",
                "p-cheer.jpg",
                "p-dance.jpg",
                "p-group.jpg",
                "p-hug.jpg",
                "b-laugh.jpg",
            ],
        },
        {
            code: "MAYA3X",
            state: "live",
            tier: "tier-80",
            cover: "b-hero.jpg",
            revealedAt: null,
            settings: {
                occasion: "birthday",
                title: "Maya turns thirty",
                startsAt: iso(new Date(now.getTime() - 2 * HOUR)),
                endsAt: iso(new Date(now.getTime() + 4 * HOUR)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Priya R.", "Theo P.", "Ines L.", "Marco D.", "Hana S."],
            photos: [
                "b-laugh.jpg",
                "b-cup.jpg",
                "b-hug.jpg",
                "b-table.jpg",
                "b-cake.jpg",
                "p-cheer.jpg",
                "p-group.jpg",
                "p-couch.jpg",
            ],
        },
        {
            code: "JNHSWM",
            state: "ended",
            tier: "free",
            cover: "p-hero.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "Jun's housewarming",
                startsAt: iso(new Date(juneEnd.getTime() - 5 * HOUR)),
                endsAt: iso(juneEnd),
                timeZone: ZONE,
                ...junReveal,
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "mono@1",
            },
            guests: ["Jun K.", "Lena W.", "Tom B.", "Ade O."],
            photos: [
                "p-couch.jpg",
                "p-group.jpg",
                "p-dance.jpg",
                "p-hug.jpg",
                "p-cheer.jpg",
                "b-cup.jpg",
            ],
        },
        {
            code: "TFNWKD",
            state: "draft",
            tier: "free",
            cover: "t-lie.jpg",
            revealedAt: null,
            settings: {
                occasion: "trip",
                title: "Tofino, the long weekend",
                startsAt: iso(localDay(26, 10)),
                endsAt: iso(localDay(28, 18)),
                timeZone: ZONE,
                revealMode: "custom",
                revealAt: iso(localDay(28, 20)),
                shotsPerGuest: 36,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: [],
            photos: [],
        },
    ];
}

async function photo(name: string): Promise<Buffer> {
    return readFile(new URL(name, PHOTOS));
}

async function removeEvent(code: string): Promise<void> {
    const [existing] = await db.select({ id: events.id }).from(events).where(eq(events.code, code));
    if (!existing) return;
    await removePrefix(keys.event(existing.id));
    await db.delete(events).where(eq(events.id, existing.id));
}

async function seedEvent(hostId: string, spec: SeedEvent): Promise<typeof events.$inferSelect> {
    await removeEvent(spec.code);
    const [event] = await db
        .insert(events)
        .values({
            code: spec.code,
            hostId,
            state: spec.state,
            settings: spec.settings,
            tier: spec.tier,
            guestLimit: tier(spec.tier).guests,
            hasCover: true,
            coverVersion: 1,
            revealedAt: spec.revealedAt,
            createdAt:
                spec.state === "draft"
                    ? new Date(Date.now() - DAY)
                    : new Date(Date.parse(spec.settings.startsAt) - 7 * DAY),
        })
        .returning();
    if (!event) throw new Error(`Could not seed ${spec.code}`);
    await put(keys.cover(event.id), await photo(spec.cover));

    const people = [];
    for (const [i, name] of spec.guests.entries()) {
        const [guest] = await db
            .insert(guests)
            .values({
                eventId: event.id,
                device: `seed-${spec.code.toLowerCase()}-guest-${i}`,
                name,
                joinedAt: new Date(Date.parse(spec.settings.startsAt) + i * 4 * 60_000),
            })
            .returning();
        if (guest) people.push(guest);
    }

    const start = Date.parse(spec.settings.startsAt);
    const end = Math.min(Date.parse(spec.settings.endsAt), Date.now() - 5 * 60_000);
    const step = (end - start) / Math.max(1, spec.photos.length);
    const ids: string[] = [];
    for (const [i, file] of spec.photos.entries()) {
        const guest = people[(SHOOTERS[i % SHOOTERS.length] ?? 0) % people.length];
        if (!guest) continue;
        const [shot] = await db
            .insert(shots)
            .values({
                eventId: event.id,
                guestId: guest.id,
                state: "uploaded",
                takenAt: new Date(start + step * (i + 0.5)),
            })
            .returning();
        if (!shot) continue;
        await put(keys.shot(event.id, shot.id, "original"), await photo(file));
        await developShot(shot.id);
        ids.push(shot.id);
    }
    await db
        .update(guests)
        .set({
            shotsTaken: sql`(select count(*) from ${shots} s where s.guest_id = ${guests.id})::int`,
        })
        .where(eq(guests.eventId, event.id));

    if (spec.state === "revealed" && people.length > 0) {
        for (const [i, shotId] of ids.entries()) {
            const fans = people.filter((_, j) => (i * 3 + j * 7) % 5 < 2);
            if (fans.length === 0) continue;
            await db
                .insert(likes)
                .values(fans.map((g) => ({ shotId, who: `guest:${g.id}` })))
                .onConflictDoNothing();
            await db.update(shots).set({ likes: fans.length }).where(eq(shots.id, shotId));
        }
    }
    return event;
}

/** Puts the demo host and their four events in place. Running it again resets them. */
export async function seed(now = new Date()): Promise<{ hostId: string; codes: string[] }> {
    const host = await findOrCreateHost(DEMO_EMAIL, DEMO_NAME);
    await db.update(hosts).set({ name: DEMO_NAME }).where(eq(hosts.id, host.id));
    await startQueue();
    const specs = plan(now);
    const others = await db
        .select({ code: events.code })
        .from(events)
        .where(eq(events.hostId, host.id));
    for (const { code } of others) await removeEvent(code);
    for (const spec of specs) {
        const event = await seedEvent(host.id, spec);
        if (event.state === "live" || event.state === "ended") await scheduleReveal(event);
        log("info", "seeded event", {
            code: spec.code,
            title: spec.settings.title,
            photos: spec.photos.length,
        });
    }
    return { hostId: host.id, codes: specs.map((s) => s.code) };
}

if (import.meta.main && isProduction) {
    log("error", "the demo seed doesn't run in production");
    process.exit(1);
}

if (import.meta.main) {
    seed()
        .then(async (result) => {
            log("info", "seed done", result);
            await stopQueue();
            process.exit(0);
        })
        .catch((error: unknown) => {
            log("error", "seed failed", { error: String(error) });
            process.exit(1);
        });
}
