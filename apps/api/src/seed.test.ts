import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { db, events, guests, shots, stopQueue } from "./db.ts";
import { adoptSeedGuests, leaveSeedGuests, seed } from "./seed.ts";
import { list } from "./storage.ts";

afterAll(stopQueue);

async function snapshot(codes: string[]) {
    const rows = await db.select().from(events).where(inArray(events.code, codes));
    const out: Record<
        string,
        { state: string; guests: number; hosts: number; developed: number; objects: number }
    > = {};
    for (const e of rows) {
        const people = await db.select().from(guests).where(eq(guests.eventId, e.id));
        out[e.settings.title] = {
            state: e.state,
            guests: people.filter((g) => !g.isHost).length,
            hosts: people.filter((g) => g.isHost).length,
            developed: (await db.select().from(shots).where(eq(shots.eventId, e.id))).filter(
                (s) => s.state === "developed",
            ).length,
            objects: (await list(`events/${e.id}/`)).length,
        };
    }
    return out;
}

describe("seed", () => {
    test(
        "loads the demo events and gives the same result when run again",
        { timeout: 120_000 },
        async () => {
            const first = await seed(undefined, { crowds: false });
            const before = await snapshot(first.codes);
            expect(before).toEqual({
                "Emma & Daniel's Wedding day": {
                    state: "revealed",
                    guests: 8,
                    hosts: 1,
                    developed: 24,
                    objects: 49,
                },
                "Maya turns thirty": {
                    state: "live",
                    guests: 5,
                    hosts: 1,
                    developed: 8,
                    objects: 17,
                },
                "Jun's housewarming": {
                    state: "ended",
                    guests: 4,
                    hosts: 1,
                    developed: 6,
                    objects: 13,
                },
                "Sam & Ria's wedding": {
                    state: "live",
                    guests: 3,
                    hosts: 1,
                    developed: 0,
                    objects: 1,
                },
                "Game night": { state: "live", guests: 9, hosts: 1, developed: 4, objects: 9 },
                "Sunday brunch": { state: "live", guests: 5, hosts: 1, developed: 6, objects: 13 },
                "Book club": { state: "revealed", guests: 4, hosts: 1, developed: 6, objects: 13 },
                "Street festival": {
                    state: "revealed",
                    guests: 250,
                    hosts: 1,
                    developed: 12,
                    objects: 25,
                },
                "Ines's leaving drinks": {
                    state: "live",
                    guests: 4,
                    hosts: 1,
                    developed: 12,
                    objects: 25,
                },
                "Friday office drinks": {
                    state: "live",
                    guests: 5,
                    hosts: 1,
                    developed: 5,
                    objects: 11,
                },
                "Team retreat": { state: "live", guests: 6, hosts: 1, developed: 7, objects: 15 },
                "Supper club": { state: "live", guests: 10, hosts: 1, developed: 3, objects: 7 },
                "Market morning": {
                    state: "revealed",
                    guests: 3,
                    hosts: 1,
                    developed: 5,
                    objects: 11,
                },
                "Summer picnic": {
                    state: "archived",
                    guests: 4,
                    hosts: 1,
                    developed: 6,
                    objects: 13,
                },
                "Karaoke night": { state: "ended", guests: 3, hosts: 1, developed: 4, objects: 9 },
                "Priya & Sam's wedding": {
                    state: "live",
                    guests: 150,
                    hosts: 1,
                    developed: 0,
                    objects: 1,
                },
                "Tofino, the long weekend": {
                    state: "draft",
                    guests: 0,
                    hosts: 1,
                    developed: 0,
                    objects: 1,
                },
            });
            const [club] = await db.select().from(events).where(eq(events.code, "BKCB27"));
            const clubShots = await db
                .select()
                .from(shots)
                .where(eq(shots.eventId, club?.id ?? ""));
            expect(clubShots.filter((s) => s.hidden)).toHaveLength(1);
            expect(clubShots.filter((s) => s.reports > 0)).toHaveLength(2);
            const [wedding] = await db.select().from(events).where(eq(events.code, "EMMADN"));
            if (!wedding) throw new Error("missing seeded event");
            await db.insert(events).values({
                code: "STRAY1",
                hostId: first.hostId,
                settings: wedding.settings,
                guestLimit: 10,
            });
            const second = await seed(undefined, { crowds: false });
            expect(second.hostId).toBe(first.hostId);
            const left = await db.select().from(events).where(eq(events.hostId, first.hostId));
            expect(left.map((e) => e.code).sort()).toEqual([...second.codes].sort());
            expect(await snapshot(second.codes)).toEqual(before);
        },
    );

    test(
        "the demo guest's places move to a device and back, and repeating either is safe",
        { timeout: 120_000 },
        async () => {
            await seed(undefined, { crowds: false });
            const device = "demo-guest-test-device";
            const mine = () => db.select().from(guests).where(eq(guests.device, device));
            const adopted = await adoptSeedGuests(device);
            expect(adopted.sort()).toEqual(
                [
                    "BKCB27",
                    "BRNCH5",
                    "DRNKS4",
                    "EMMADN",
                    "FFCE7D",
                    "FSTV28",
                    "JNHSWM",
                    "MAYA3X",
                    "RTRT5W",
                    "SATWED",
                    "TRVA7M",
                ].sort(),
            );
            const places = await mine();
            expect(places).toHaveLength(11);
            await adoptSeedGuests(device);
            expect((await mine()).map((g) => g.id).sort()).toEqual(places.map((g) => g.id).sort());
            const [drinks] = await db.select().from(events).where(eq(events.code, "DRNKS4"));
            expect(places.find((g) => g.eventId === drinks?.id)?.shotsTaken).toBe(10);
            await leaveSeedGuests(device);
            await leaveSeedGuests(device);
            expect(await mine()).toHaveLength(0);
            expect(await adoptSeedGuests(device)).toHaveLength(11);
            await leaveSeedGuests(device);
        },
    );
});
