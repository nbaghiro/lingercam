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
        { state: string; guests: number; developed: number; objects: number }
    > = {};
    for (const e of rows) {
        out[e.settings.title] = {
            state: e.state,
            guests: (await db.select().from(guests).where(eq(guests.eventId, e.id))).length,
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
                    developed: 24,
                    objects: 49,
                },
                "Maya turns thirty": { state: "live", guests: 5, developed: 8, objects: 17 },
                "Jun's housewarming": { state: "ended", guests: 4, developed: 6, objects: 13 },
                "Tofino, the long weekend": { state: "draft", guests: 0, developed: 0, objects: 1 },
            });
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
