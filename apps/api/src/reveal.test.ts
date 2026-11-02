import type { ExpoPushMessage } from "expo-server-sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, events, startQueue, stopQueue } from "./db.ts";
import { advance, push, revealOverdue, startRevealWorker } from "./reveal.ts";
import { startShotWorkers } from "./shots.ts";
import { call, join, newEvent, newHost, samplePhoto, shoot, upload, waitFor } from "./testing.ts";
import { exists, keys } from "./storage.ts";

const sent: ExpoPushMessage[] = [];

beforeAll(async () => {
    await startQueue();
    await startShotWorkers();
    await startRevealWorker();
    push.send = async (messages) => {
        sent.push(...messages);
    };
});

afterAll(async () => {
    await stopQueue();
});

async function stateOf(id: string) {
    const [row] = await db.select().from(events).where(eq(events.id, id));
    return row;
}

const SECRET = /X-Amz|\/shots\/|thumb|developed\.jpg|original\.jpg/;

describe("the full lifecycle", () => {
    test("photos stay hidden from everyone until the reveal job runs, then come back signed", async () => {
        const { token } = await newHost("Maya");
        const event = await newEvent(token);

        const cover = await call("POST", `/v1/events/${event.id}/cover`, { token });
        expect(cover.status).toBe(200);
        expect(await upload(String(cover.body.uploadUrl), await samplePhoto())).toBe(200);
        expect(await exists(keys.cover(event.id))).toBe(true);
        const coverRedirect = await call("GET", `/v1/e/${event.code}/cover`);
        expect(coverRedirect.status).toBe(302);

        const live = await call("POST", `/v1/events/${event.id}/live`, { token });
        expect(live.body.event?.state).toBe("live");

        const priya = await join(event.code, "Priya");
        const theo = await join(event.code, "Theo");
        await call("POST", "/v1/push", {
            token,
            json: { token: "ExponentPushToken[host-device]" },
        });
        await call("POST", "/v1/push", {
            device: priya.device,
            json: { token: "ExponentPushToken[priya-phone]" },
        });

        const shots = [
            await shoot(event.code, priya.device),
            await shoot(event.code, priya.device),
            await shoot(event.code, theo.device),
        ];

        // The develop worker picks the shots up from the queue.
        await waitFor(async () => {
            for (const id of shots) {
                if (!(await exists(keys.shot(event.id, id, "thumb")))) return false;
            }
            return true;
        });

        for (const viewer of [{ token }, { device: priya.device }, { device: theo.device }]) {
            const gallery = await call("GET", `/v1/e/${event.code}/gallery`, viewer);
            expect(gallery.status).toBe(200);
            expect(gallery.body.kind).toBe("developing");
            expect(gallery.body.total).toBe(3);
            expect(gallery.body.photographers).toBe(2);
            expect(JSON.stringify(gallery.body)).not.toMatch(SECRET);
            const people = await call("GET", `/v1/e/${event.code}/people`, viewer);
            expect(JSON.stringify(people.body)).not.toMatch(SECRET);
        }
        const mine = await call("GET", `/v1/e/${event.code}/gallery`, { device: priya.device });
        expect(mine.body.mine).toBe(2);
        const like = await call("POST", `/v1/shots/${shots[0]}/like`, { device: theo.device });
        expect(like.status).toBe(404);

        // Moving the end two seconds out schedules the reveal job, which the worker then runs.
        const soon = new Date(Date.now() + 2000).toISOString();
        const patched = await call("PATCH", `/v1/events/${event.id}`, {
            token,
            json: { endsAt: soon },
        });
        expect(patched.status).toBe(200);
        expect(patched.body.event?.state).toBe("live");
        const revealed = await waitFor(async () => {
            const row = await stateOf(event.id);
            return row?.state === "revealed" ? row : null;
        });
        expect(revealed.revealedAt).not.toBeNull();

        expect(sent.map((m) => m.to).sort()).toEqual([
            "ExponentPushToken[host-device]",
            "ExponentPushToken[priya-phone]",
        ]);
        expect(sent[0]?.title).toBe("Test party");

        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { token });
        expect(gallery.body.kind).toBe("photos");
        expect(gallery.body.total).toBe(3);
        const items = Object.values(gallery.body.items ?? {});
        expect(items).toHaveLength(3);
        const first = items[0];
        expect(String(first?.url)).toMatch(/X-Amz-Signature/);
        expect(first?.width).toBe(640);
        const photo = await fetch(String(first?.url));
        expect(photo.status).toBe(200);
        expect(photo.headers.get("content-length")).not.toBe("0");
        const thumb = await fetch(String(first?.thumbUrl));
        expect(thumb.status).toBe(200);

        const guestView = await call("GET", `/v1/e/${event.code}/gallery`, { device: theo.device });
        expect(guestView.body.kind).toBe("photos");
        expect(Object.values(guestView.body.items ?? {})).toHaveLength(3);
    });
});

describe("advancing events", () => {
    test("right away reveals straight from live at the end", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "right-away" },
        });
        const ended = await call("POST", `/v1/events/${event.id}/end`, { token });
        expect(ended.body.event?.state).toBe("revealed");
    });

    test("on boot, anything overdue is ended or revealed", async () => {
        const { token } = await newHost();
        const overdue = await newEvent(token, { live: true });
        const waiting = await newEvent(token, {
            live: true,
            settings: { revealMode: "next-morning" },
        });
        const past = new Date(Date.now() - 60_000).toISOString();
        for (const id of [overdue.id, waiting.id]) {
            const row = await stateOf(id);
            if (!row) throw new Error("missing");
            await db
                .update(events)
                .set({ settings: { ...row.settings, endsAt: past } })
                .where(eq(events.id, id));
        }
        expect(await revealOverdue()).toBeGreaterThanOrEqual(2);
        expect((await stateOf(overdue.id))?.state).toBe("revealed");
        expect((await stateOf(waiting.id))?.state).toBe("ended");
        expect(await advance(waiting.id, new Date(Date.now() + 2 * 86_400_000))).toMatchObject({
            state: "revealed",
        });
    });

    test("revealed events are archived after 90 days and keep their photos visible", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        await call("POST", `/v1/events/${event.id}/end`, { token });
        const later = new Date(Date.now() + 91 * 86_400_000);
        expect((await advance(event.id, later))?.state).toBe("archived");
        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { token });
        expect(gallery.body.kind).toBe("photos");
    });

    test("a failing push service doesn't stop the reveal", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        await call("POST", "/v1/push", { token, json: { token: "ExponentPushToken[boom]" } });
        const send = push.send;
        push.send = async () => {
            throw new Error("push is down");
        };
        try {
            const ended = await call("POST", `/v1/events/${event.id}/end`, { token });
            expect(ended.status).toBe(200);
            expect(ended.body.event?.state).toBe("revealed");
        } finally {
            push.send = send;
        }
    });
});
