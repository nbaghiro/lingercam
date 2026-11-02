import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { db, events, guests, shots, stopQueue } from "./db.ts";
import { seed } from "./seed.ts";
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
            const first = await seed();
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
            const second = await seed();
            expect(second.hostId).toBe(first.hostId);
            const left = await db.select().from(events).where(eq(events.hostId, first.hostId));
            expect(left.map((e) => e.code).sort()).toEqual([...second.codes].sort());
            expect(await snapshot(second.codes)).toEqual(before);
        },
    );
});
