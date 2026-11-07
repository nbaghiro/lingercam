import { readdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import type { EventSettings, EventState } from "@linger/core/events";
import { zonedInstant, wallTime, SMALL_HOURS_END } from "@linger/core/reveal";
import { tier, type TierId } from "@linger/core/pricing";
import { REPORTS_TO_HIDE } from "@linger/core/shots";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DEMO_EMAIL, DEMO_NAME, DEMO_PERSONAS, findOrCreateHost } from "./accounts.ts";
import { db, events, guests, hosts, likes, reports, shots, startQueue, stopQueue } from "./db.ts";
import { hostGuest } from "./events.ts";
import { isProduction, log } from "./http.ts";
import { scheduleReveal } from "./reveal.ts";
import { developShot } from "./shots.ts";
import { copy, keys, put, removePrefix } from "./storage.ts";

const PHOTOS = new URL("../../app/assets/demo/", import.meta.url);
const ZONE = "America/Vancouver";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Who takes each photo, by guest index: uneven, like a real night. */
const SHOOTERS = [0, 1, 2, 0, 3, 4, 1, 5, 6, 0, 2, 7, 3, 1, 0, 4, 5, 2, 6, 0, 1, 7, 3, 2];

export interface SeedEvent {
    code: string;
    state: EventState;
    settings: EventSettings;
    tier: TierId;
    cover: string | null;
    revealedAt: Date | null;
    guests: string[];
    /** Photo file names, shot by guests in turn. */
    photos: string[];
    /** Who takes each photo, by guest index, in place of SHOOTERS. */
    shooters?: number[];
    /** The guest the demo guest plays: their place moves to the device that asks. */
    you?: number;
    unlimited?: boolean;
    /** A crowd's worth of photos on top of `photos`, for trying the app at scale. */
    crowdPhotos?: number;
    /** Reports on photos by index; three hide a photo, as the report route would. */
    reported?: { photo: number; reports: number }[];
}

const FIRST = [
    "Ana",
    "Ben",
    "Cai",
    "Dana",
    "Eli",
    "Fern",
    "Gus",
    "Hana",
    "Ines",
    "Jun",
    "Kofi",
    "Lena",
    "Mira",
    "Nico",
    "Omar",
    "Pia",
    "Quinn",
    "Rosa",
    "Sami",
    "Tess",
    "Uma",
    "Vik",
    "Wren",
    "Ximena",
    "Yusuf",
    "Zoe",
    "Arjun",
    "Bea",
    "Cyrus",
    "Daria",
];
const LAST = "ABCDEFGHJKMNPRSTVWYZ";

/** A crowd for the large events: "Ana A.", "Ben A.", ..., 600 different names. */
function crowd(size: number): string[] {
    return Array.from({ length: size }, (_, i) => {
        const first = FIRST[i % FIRST.length] ?? "Guest";
        const last = LAST[Math.floor(i / FIRST.length) % LAST.length] ?? "X";
        return `${first} ${last}.`;
    });
}

export function localDay(offsetDays: number, hour: number, minute = 0): Date {
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

    // Past the late-join hour, so someone new can't join any more.
    const juneEnd = new Date(now.getTime() - 2 * HOUR);
    // A next-morning reveal from an end in the small hours would be this morning, not tomorrow.
    const nextMorning = wallTime(juneEnd, ZONE).hour >= SMALL_HOURS_END;
    const junReveal: Pick<EventSettings, "revealMode" | "revealAt"> = nextMorning
        ? { revealMode: "next-morning" }
        : { revealMode: "custom", revealAt: iso(localDay(1, 10)) };

    return [
        {
            code: "EMMADN",
            you: 0,
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
            you: 0,
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
            you: 0,
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
            // Live but not started: guests can join and read the rules before the camera opens.
            code: "SATWED",
            you: 1,
            state: "live",
            tier: "tier-80",
            cover: "w-walk.jpg",
            revealedAt: null,
            settings: {
                occasion: "wedding",
                title: "Sam & Ria's wedding",
                startsAt: iso(localDay(3, 15)),
                endsAt: iso(localDay(3, 23, 30)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Ria's mum", "Theo P.", "Ade O."],
            photos: [],
        },
        {
            // A free event one guest short of full.
            code: "GAMENT",
            state: "live",
            tier: "free",
            cover: "p-group.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "Game night",
                startsAt: iso(new Date(now.getTime() - HOUR)),
                endsAt: iso(new Date(now.getTime() + 5 * HOUR)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: [
                "Lena W.",
                "Tom B.",
                "Jun K.",
                "Ade O.",
                "Priya R.",
                "Marco D.",
                "Hana S.",
                "Sofia M.",
                "Theo P.",
            ],
            photos: ["p-cheer.jpg", "p-couch.jpg", "p-hug.jpg", "p-dance.jpg"],
        },
        {
            // Right away: photos show as they develop while the camera is open.
            code: "BRNCH5",
            you: 0,
            state: "live",
            tier: "tier-30",
            cover: "b-table.jpg",
            revealedAt: null,
            settings: {
                occasion: "everyday",
                title: "Sunday brunch",
                startsAt: iso(new Date(now.getTime() - HOUR)),
                endsAt: iso(new Date(now.getTime() + 3 * HOUR)),
                timeZone: ZONE,
                revealMode: "right-away",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Ines L.", "Marco D.", "Hana S.", "Jun K.", "Lena W."],
            photos: [
                "b-cup.jpg",
                "b-laugh.jpg",
                "b-cake.jpg",
                "b-hug.jpg",
                "b-table.jpg",
                "p-cheer.jpg",
            ],
        },
        {
            // Revealed, with one reported photo and one hidden by three reports.
            code: "BKCB27",
            you: 0,
            state: "revealed",
            tier: "free",
            cover: "p-couch.jpg",
            revealedAt: localDay(-2, 10),
            settings: {
                occasion: "everyday",
                title: "Book club",
                startsAt: iso(localDay(-3, 19)),
                endsAt: iso(localDay(-3, 22)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "mono@1",
            },
            guests: ["Priya R.", "Tom B.", "Sofia M.", "Ade O."],
            photos: [
                "p-couch.jpg",
                "b-cup.jpg",
                "p-hug.jpg",
                "b-laugh.jpg",
                "p-group.jpg",
                "b-table.jpg",
            ],
            reported: [
                { photo: 1, reports: 1 },
                { photo: 3, reports: 3 },
            ],
        },
        {
            // A large revealed event, for the people list.
            code: "FSTV28",
            state: "revealed",
            tier: "tier-250",
            cover: "e-fiesta.jpg",
            revealedAt: localDay(-3, 10),
            settings: {
                occasion: "party",
                title: "Street festival",
                startsAt: iso(localDay(-4, 12)),
                endsAt: iso(localDay(-4, 23)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: crowd(250),
            crowdPhotos: 3000,
            you: 0,
            photos: [
                "e-fiesta.jpg",
                "e-couple.jpg",
                "e-hero.jpg",
                "p-dance.jpg",
                "p-cheer.jpg",
                "w-crowd.jpg",
                "w-lights.jpg",
                "p-group.jpg",
                "t-van.jpg",
                "w-dance.jpg",
                "b-laugh.jpg",
                "p-hug.jpg",
            ],
        },
        {
            // The demo guest has used every shot.
            code: "DRNKS4",
            you: 0,
            state: "live",
            tier: "tier-30",
            cover: "p-cheer.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "Ines's leaving drinks",
                startsAt: iso(new Date(now.getTime() - 3 * HOUR)),
                endsAt: iso(new Date(now.getTime() + 2 * HOUR)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 10,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: ["Ines L.", "Jun K.", "Lena W.", "Theo P."],
            photos: [
                "p-cheer.jpg",
                "p-group.jpg",
                "p-hug.jpg",
                "p-dance.jpg",
                "p-couch.jpg",
                "b-laugh.jpg",
                "b-cup.jpg",
                "w-clink.jpg",
                "w-lights.jpg",
                "e-fiesta.jpg",
                "w-crowd.jpg",
                "b-table.jpg",
            ],
            shooters: [0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0],
        },
        {
            // Closes in a few minutes, for the last stretch of shooting.
            code: "FFCE7D",
            you: 0,
            state: "live",
            tier: "free",
            cover: "p-group.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "Friday office drinks",
                startsAt: iso(new Date(now.getTime() - 2 * HOUR)),
                endsAt: iso(new Date(now.getTime() + 9 * 60_000)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: ["Ade O.", "Lena W.", "Tom B.", "Hana S.", "Marco D."],
            photos: ["p-cheer.jpg", "p-hug.jpg", "b-laugh.jpg", "p-dance.jpg", "b-cup.jpg"],
        },
        {
            // Unlimited shots, only the host sees every photo, and a reveal at a picked time.
            code: "RTRT5W",
            you: 0,
            state: "live",
            tier: "tier-30",
            unlimited: true,
            cover: "t-van.jpg",
            revealedAt: null,
            settings: {
                occasion: "trip",
                title: "Team retreat",
                startsAt: iso(new Date(now.getTime() - 3 * HOUR)),
                endsAt: iso(new Date(now.getTime() + 6 * HOUR)),
                timeZone: ZONE,
                revealMode: "custom",
                revealAt: iso(localDay(2, 9)),
                shotsPerGuest: null,
                visibility: "host-only",
                look: "natural@1",
            },
            guests: ["Theo P.", "Ines L.", "Jun K.", "Priya R.", "Sofia M.", "Ben A."],
            photos: [
                "t-van.jpg",
                "t-drive.jpg",
                "t-lie.jpg",
                "p-group.jpg",
                "e-hero.jpg",
                "p-cheer.jpg",
                "b-table.jpg",
            ],
        },
        {
            // A free event with every place taken while the camera is open.
            code: "SPPR6C",
            state: "live",
            tier: "free",
            cover: "b-table.jpg",
            revealedAt: null,
            settings: {
                occasion: "everyday",
                title: "Supper club",
                startsAt: iso(new Date(now.getTime() - HOUR)),
                endsAt: iso(new Date(now.getTime() + 3 * HOUR)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: crowd(10),
            photos: ["b-cup.jpg", "b-table.jpg", "b-laugh.jpg"],
        },
        {
            // A right-away event after it ended: the photos were out all along.
            code: "TRVA7M",
            you: 0,
            state: "revealed",
            tier: "tier-30",
            cover: "e-fiesta.jpg",
            revealedAt: localDay(-1, 9),
            settings: {
                occasion: "everyday",
                title: "Market morning",
                startsAt: iso(localDay(-1, 9)),
                endsAt: iso(localDay(-1, 13)),
                timeZone: ZONE,
                revealMode: "right-away",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Lena W.", "Marco D.", "Ade O."],
            photos: ["e-fiesta.jpg", "e-couple.jpg", "b-cup.jpg", "p-hug.jpg", "e-hero.jpg"],
        },
        {
            // Archived, 90 days after its reveal.
            code: "PCNC3S",
            state: "archived",
            tier: "free",
            cover: "e-couple.jpg",
            revealedAt: localDay(-100, 10),
            settings: {
                occasion: "everyday",
                title: "Summer picnic",
                startsAt: iso(localDay(-101, 12)),
                endsAt: iso(localDay(-101, 18)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: ["Priya R.", "Tom B.", "Hana S.", "Jun K."],
            photos: [
                "e-couple.jpg",
                "p-couch.jpg",
                "w-walk.jpg",
                "b-laugh.jpg",
                "p-group.jpg",
                "w-sil.jpg",
            ],
        },
        {
            // Closed 20 minutes ago: someone who came late can still join for the rest of the hour.
            code: "KRK2NT",
            state: "ended",
            tier: "free",
            cover: "p-dance.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "Karaoke night",
                startsAt: iso(new Date(now.getTime() - 4 * HOUR)),
                endsAt: iso(new Date(now.getTime() - 20 * 60_000)),
                timeZone: ZONE,
                revealMode: "custom",
                revealAt: iso(localDay(1, 10)),
                shotsPerGuest: 12,
                visibility: "everyone",
                look: "natural@1",
            },
            guests: ["Hana S.", "Ben A.", "Lena W."],
            photos: ["p-dance.jpg", "p-cheer.jpg", "b-laugh.jpg", "p-hug.jpg"],
        },
        {
            // A big wedding under way: 150 guests and 1,500 photos developing.
            code: "PRYA5M",
            state: "live",
            tier: "tier-150",
            cover: "w-hero.jpg",
            revealedAt: null,
            settings: {
                occasion: "wedding",
                title: "Priya & Sam's wedding",
                startsAt: iso(new Date(now.getTime() - 5 * HOUR)),
                endsAt: iso(new Date(now.getTime() + 2 * HOUR)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: crowd(150),
            photos: [],
            crowdPhotos: 1500,
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

/** A host partway in: one event waiting for its first guest, and a draft without a cover. */
function halfPlan(): SeedEvent[] {
    return [
        {
            code: "DNNR7T",
            state: "live",
            tier: "free",
            cover: "b-table.jpg",
            revealedAt: null,
            settings: {
                occasion: "everyday",
                title: "Dinner at ours",
                startsAt: iso(localDay(1, 19)),
                endsAt: iso(localDay(1, 23)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 15,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: [],
            photos: [],
        },
        {
            code: "BABY2Y",
            state: "draft",
            tier: "free",
            cover: null,
            revealedAt: null,
            settings: {
                occasion: "birthday",
                title: "Leo turns one",
                startsAt: iso(localDay(9, 14)),
                endsAt: iso(localDay(9, 18)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
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

/** A small, repeatable random sequence, so a reseed puts every photo in the same place. */
function random(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/** Each demo photo as it is, mirrored, cropped in, and both: four distinct images from one. */
async function variants(file: string): Promise<Buffer[]> {
    const source = await photo(file);
    const { width = 0, height = 0 } = await sharp(source).metadata();
    const crop = {
        left: Math.round(width * 0.09),
        top: Math.round(height * 0.09),
        width: Math.round(width * 0.82),
        height: Math.round(height * 0.82),
    };
    return Promise.all([
        Promise.resolve(source),
        sharp(source).flop().jpeg().toBuffer(),
        sharp(source).extract(crop).jpeg().toBuffer(),
        sharp(source).flop().extract(crop).jpeg().toBuffer(),
    ]);
}

/** Runs tasks a few at a time. */
async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(task));
    }
}

/**
 * Fills an event with `count` photos from the crowd. Each distinct image is developed once,
 * through the same path as a guest's photo, and every further shot gets a copy of its files made
 * inside the bucket, so thousands of photos take seconds rather than an hour.
 */
async function seedCrowd(
    event: typeof events.$inferSelect,
    people: (typeof guests.$inferSelect)[],
    count: number,
    start: number,
    end: number,
): Promise<string[]> {
    const next = random(event.code.charCodeAt(0) * 7919 + count);
    const cap = event.settings.shotsPerGuest ?? count;
    const taken = new Map<string, number>();
    const shooter = () => {
        for (;;) {
            const guest = people[Math.floor(next() * people.length)];
            if (!guest) throw new Error("A crowd needs guests");
            const n = taken.get(guest.id) ?? 0;
            if (n < cap) {
                taken.set(guest.id, n + 1);
                return guest;
            }
        }
    };
    // Times are dealt out of order, so the four versions of one image don't sit side by side.
    const slots = Array.from({ length: count }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [slots[i], slots[j]] = [slots[j] ?? 0, slots[i] ?? 0];
    }
    const at = (i: number) => new Date(start + ((end - start) * ((slots[i] ?? i) + 0.5)) / count);

    const files = (await readdir(PHOTOS)).filter((f) => f.endsWith(".jpg")).sort();
    const masters: (typeof shots.$inferSelect)[] = [];
    for (const file of files) {
        for (const image of await variants(file)) {
            if (masters.length >= count) break;
            const [shot] = await db
                .insert(shots)
                .values({
                    eventId: event.id,
                    guestId: shooter().id,
                    state: "uploaded",
                    takenAt: at(masters.length),
                })
                .returning();
            if (!shot) continue;
            await put(keys.shot(event.id, shot.id, "original"), image);
            const developed = await developShot(shot.id);
            if (developed) masters.push(developed);
        }
    }
    if (masters.length === 0) return [];

    const rows = Array.from({ length: count - masters.length }, (_, i) => {
        const master = masters[Math.floor(next() * masters.length)] ?? masters[0];
        return {
            master,
            values: {
                eventId: event.id,
                guestId: shooter().id,
                state: "developed" as const,
                takenAt: at(masters.length + i),
                width: master?.width ?? null,
                height: master?.height ?? null,
            },
        };
    });
    const copies: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const inserted = await db
            .insert(shots)
            .values(batch.map((r) => r.values))
            .returning({ id: shots.id });
        await inBatches(
            inserted.map((row, j) => ({ id: row.id, from: batch[j]?.master })),
            32,
            async ({ id, from }) => {
                if (!from) return;
                for (const variant of ["developed", "thumb"] as const) {
                    await copy(
                        keys.shot(event.id, from.id, variant),
                        keys.shot(event.id, id, variant),
                    );
                }
            },
        );
        copies.push(...inserted.map((row) => row.id));
    }
    return [...masters.map((m) => m.id), ...copies];
}

async function seedEvent(
    hostId: string,
    spec: SeedEvent,
    crowds: boolean,
): Promise<typeof events.$inferSelect> {
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
            hasCover: spec.cover !== null,
            coverVersion: spec.cover === null ? 0 : 1,
            revealedAt: spec.revealedAt,
            unlimitedShots: spec.unlimited ?? false,
            createdAt:
                spec.state === "draft"
                    ? new Date(Date.now() - DAY)
                    : new Date(Date.parse(spec.settings.startsAt) - 7 * DAY),
        })
        .returning();
    if (!event) throw new Error(`Could not seed ${spec.code}`);
    await hostGuest(event);
    if (spec.cover) await put(keys.cover(event.id), await photo(spec.cover));

    const start = Date.parse(spec.settings.startsAt);
    const spacing = spec.guests.length > 50 ? 60_000 : 4 * 60_000;
    const people =
        spec.guests.length === 0
            ? []
            : await db
                  .insert(guests)
                  .values(
                      spec.guests.map((name, i) => ({
                          eventId: event.id,
                          device: `seed-${spec.code.toLowerCase()}-guest-${i}`,
                          name,
                          joinedAt: new Date(Math.min(start + i * spacing, Date.now() - 60_000)),
                      })),
                  )
                  .returning();

    const end = Math.min(Date.parse(spec.settings.endsAt), Date.now() - 5 * 60_000);
    const step = (end - start) / Math.max(1, spec.photos.length);
    const ids: string[] = [];
    for (const [i, file] of spec.photos.entries()) {
        const order = spec.shooters ?? SHOOTERS;
        const guest = people[(order[i % order.length] ?? 0) % people.length];
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
    if (crowds && spec.crowdPhotos) {
        ids.push(...(await seedCrowd(event, people, spec.crowdPhotos, start, end)));
    }
    await db
        .update(guests)
        .set({
            shotsTaken: sql`(select count(*) from ${shots} s where s.guest_id = ${guests.id})::int`,
        })
        .where(eq(guests.eventId, event.id));

    for (const { photo: index, reports: n } of spec.reported ?? []) {
        const shotId = ids[index];
        const by = people.slice(-n);
        if (!shotId || by.length < n) continue;
        await db.insert(reports).values(by.map((g) => ({ shotId, who: `guest:${g.id}` })));
        await db
            .update(shots)
            .set({ reports: n, hidden: n >= REPORTS_TO_HIDE })
            .where(eq(shots.id, shotId));
    }

    if (spec.state === "revealed" && people.length > 0 && spec.guests.length <= 50) {
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

export async function seedHost(
    email: string,
    name: string,
    specs: SeedEvent[],
    crowds = true,
): Promise<string> {
    const host = await findOrCreateHost(email, name);
    await db.update(hosts).set({ name }).where(eq(hosts.id, host.id));
    const others = await db
        .select({ code: events.code })
        .from(events)
        .where(eq(events.hostId, host.id));
    for (const { code } of others) await removeEvent(code);
    for (const spec of specs) {
        const event = await seedEvent(host.id, spec, crowds);
        if (event.state === "live" || event.state === "ended") await scheduleReveal(event);
        log("info", "seeded event", {
            code: spec.code,
            title: spec.settings.title,
            photos: spec.photos.length,
        });
    }
    return host.id;
}

/**
 * Puts the demo hosts and their events in place: the full demo host, a new host with nothing yet
 * and one partway in. Running it again resets them.
 */
export async function seed(
    now = new Date(),
    { crowds = true }: { crowds?: boolean } = {},
): Promise<{ hostId: string; codes: string[] }> {
    await startQueue();
    const specs = plan(now);
    const hostId = await seedHost(DEMO_EMAIL, DEMO_NAME, specs, crowds);
    await seedHost(DEMO_PERSONAS.new.email, DEMO_PERSONAS.new.name, []);
    await seedHost(DEMO_PERSONAS.half.email, DEMO_PERSONAS.half.name, halfPlan());
    return { hostId, codes: specs.map((s) => s.code) };
}

/** Gives a device the demo guest's places at the seeded events, so it sees them as that guest. */
export async function adoptSeedGuests(device: string): Promise<string[]> {
    const mine = plan(new Date()).filter((spec) => spec.you !== undefined);
    const rows = await db
        .select({ id: events.id, code: events.code })
        .from(events)
        .where(
            inArray(
                events.code,
                mine.map((spec) => spec.code),
            ),
        );
    const adopted: string[] = [];
    for (const spec of mine) {
        const event = rows.find((row) => row.code === spec.code);
        if (!event) continue;
        const seat = and(
            eq(guests.eventId, event.id),
            eq(guests.device, `seed-${spec.code.toLowerCase()}-guest-${spec.you}`),
        );
        const [open] = await db.select({ id: guests.id }).from(guests).where(seat);
        if (open) {
            // A place this device had there from an earlier join gives way.
            await db
                .delete(guests)
                .where(and(eq(guests.eventId, event.id), eq(guests.device, device)));
            await db.update(guests).set({ device }).where(eq(guests.id, open.id));
        }
        adopted.push(spec.code);
    }
    return adopted;
}

/** Gives the demo guest's places back and drops any other place this device has as a guest. */
export async function leaveSeedGuests(device: string): Promise<void> {
    const mine = plan(new Date()).filter((spec) => spec.you !== undefined);
    const rows = await db
        .select({ id: events.id, code: events.code })
        .from(events)
        .where(
            inArray(
                events.code,
                mine.map((spec) => spec.code),
            ),
        );
    for (const spec of mine) {
        const event = rows.find((row) => row.code === spec.code);
        if (!event) continue;
        await db
            .update(guests)
            .set({ device: `seed-${spec.code.toLowerCase()}-guest-${spec.you}` })
            .where(and(eq(guests.eventId, event.id), eq(guests.device, device)));
    }
    await db.delete(guests).where(and(eq(guests.device, device), eq(guests.isHost, false)));
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
