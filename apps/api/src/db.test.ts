import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, events, guests, hosts, sql, startQueue, stopQueue } from "./db.ts";
import { join, newEvent, newHost } from "./testing.ts";

beforeAll(startQueue);
afterAll(stopQueue);

describe("database", () => {
    test("migrations created every table", async () => {
        const rows = await sql<{ table_name: string }[]>`
            select table_name from information_schema.tables where table_schema = 'public'`;
        expect(rows.map((r) => r.table_name).sort()).toEqual([
            "email_codes",
            "events",
            "guests",
            "hosts",
            "likes",
            "purchases",
            "push_tokens",
            "reports",
            "sessions",
            "shots",
        ]);
    });

    test("deleting a host cascades to events and guests", async () => {
        const { token, hostId } = await newHost();
        const event = await newEvent(token, { live: true });
        await join(event.code);
        await db.delete(hosts).where(eq(hosts.id, hostId));
        expect(await db.select().from(events).where(eq(events.id, event.id))).toEqual([]);
        expect(await db.select().from(guests).where(eq(guests.eventId, event.id))).toEqual([]);
    });

    test("one guest per device per event", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const { device } = await join(event.code);
        await expect(
            db.insert(guests).values({ eventId: event.id, device, name: "Twin" }),
        ).rejects.toThrow();
    });
});
