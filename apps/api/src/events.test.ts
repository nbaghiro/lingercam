import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pushTokens, startQueue, stopQueue } from "./db.ts";
import { call, join, newDevice, newEvent, newHost, settings } from "./testing.ts";

beforeAll(startQueue);
afterAll(stopQueue);

describe("creating and editing", () => {
    test("creates a draft with a join code, and lists newest first", async () => {
        const { token } = await newHost();
        const first = await newEvent(token, { settings: { title: "First" } });
        const second = await newEvent(token, { settings: { title: "Second" } });
        expect(first.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
        const list = await call("GET", "/v1/events", { token });
        expect(Object.values(list.body.events ?? {}).map((e) => e.id)).toEqual([
            second.id,
            first.id,
        ]);
        const one = await call("GET", `/v1/events/${first.id}`, { token });
        expect(one.body.event).toMatchObject({ state: "draft", tier: "free", guestLimit: 10 });
    });

    test("rejects settings that don't hold together", async () => {
        const { token } = await newHost();
        const bad = settings({ endsAt: "2020-01-01T00:00:00Z" });
        const res = await call("POST", "/v1/events", { token, json: bad });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("invalid-request");
        const unlimited = await call("POST", "/v1/events", {
            token,
            json: settings({ shotsPerGuest: null }),
        });
        expect(unlimited.body.code).toBe("needs-unlimited");
    });

    test("only settings the state allows can change", async () => {
        const { token } = await newHost();
        const event = await newEvent(token);
        const draft = await call("PATCH", `/v1/events/${event.id}`, {
            token,
            json: { occasion: "wedding", title: "Renamed" },
        });
        expect(draft.body.event?.settings?.occasion).toBe("wedding");
        await call("POST", `/v1/events/${event.id}/live`, { token });
        const live = await call("PATCH", `/v1/events/${event.id}`, {
            token,
            json: { occasion: "trip" },
        });
        expect(live.status).toBe(409);
        expect(live.body.code).toBe("locked");
        const title = await call("PATCH", `/v1/events/${event.id}`, {
            token,
            json: { title: "Again" },
        });
        expect(title.body.event?.settings?.title).toBe("Again");
    });

    test("once live, photo privacy can only get stricter and the reveal only later", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { visibility: "host-only", revealMode: "next-morning" },
        });
        const patch = (json: unknown) => call("PATCH", `/v1/events/${event.id}`, { token, json });
        expect((await patch({ visibility: "everyone" })).body.code).toBe("locked");
        expect((await patch({ revealMode: "right-away" })).body.code).toBe("locked");
        expect((await patch({ revealMode: "at-end" })).body.code).toBe("locked");
        const past = new Date(Date.now() - 60_000).toISOString();
        expect((await patch({ revealMode: "custom", revealAt: past })).body.code).toBe("locked");
        const later = new Date(Date.now() + 4 * 86_400_000).toISOString();
        const moved = await patch({ revealMode: "custom", revealAt: later });
        expect(moved.status).toBe(200);
        expect(moved.body.event?.revealsAt).toBe(later);
    });

    test("a cover can be a JPEG, PNG, HEIC or WebP, and nothing else", async () => {
        const { token } = await newHost();
        const event = await newEvent(token);
        const png = await call("POST", `/v1/events/${event.id}/cover`, {
            token,
            json: { contentType: "image/png" },
        });
        const put = await fetch(String(png.body.uploadUrl), {
            method: "PUT",
            body: new Uint8Array([137, 80, 78, 71]),
            headers: { "content-type": "image/png" },
        });
        expect(put.status).toBe(200);
        const html = await call("POST", `/v1/events/${event.id}/cover`, {
            token,
            json: { contentType: "text/html" },
        });
        expect(html.status).toBe(400);
    });

    test("events carry the server's reveal time", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            settings: {
                startsAt: "2030-06-20T22:00:00Z",
                endsAt: "2030-06-21T05:00:00Z",
                timeZone: "America/Vancouver",
                revealMode: "next-morning",
            },
        });
        const one = await call("GET", `/v1/events/${event.id}`, { token });
        expect(one.body.event?.revealsAt).toBe("2030-06-21T17:00:00.000Z");
    });

    test("going live twice, or with an end in the past, is refused", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        expect((await call("POST", `/v1/events/${event.id}/live`, { token })).body.code).toBe(
            "wrong-state",
        );
        const past = await newEvent(token, {
            settings: {
                startsAt: new Date(Date.now() - 7_200_000).toISOString(),
                endsAt: new Date(Date.now() - 3_600_000).toISOString(),
            },
        });
        expect((await call("POST", `/v1/events/${past.id}/live`, { token })).body.code).toBe(
            "already-over",
        );
    });
});

describe("joining", () => {
    test("the summary shows what a guest needs and nothing private", async () => {
        const { token } = await newHost("Jun Kim");
        const event = await newEvent(token, { live: true });
        await join(event.code);
        const res = await call("GET", `/v1/e/${event.code.toLowerCase()}`);
        expect(res.body.event).toMatchObject({
            code: event.code,
            hostName: "Jun Kim",
            guestCount: 1,
            full: false,
            state: "live",
        });
        expect(res.body.event?.hostId).toBeUndefined();
        expect((await call("GET", "/v1/e/NOPE00")).status).toBe(404);
    });

    test("joining past the free limit returns event-full; the same device gets its guest back", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const devices = Array.from({ length: 15 }, newDevice);
        const replies = await Promise.all(
            devices.map((device, i) =>
                call("POST", `/v1/e/${event.code}/join`, { json: { name: `Guest ${i}`, device } }),
            ),
        );
        expect(replies.filter((r) => r.status === 200)).toHaveLength(10);
        expect(replies.filter((r) => String(r.body.code) === "event-full")).toHaveLength(5);
        const inside = devices[replies.findIndex((r) => r.status === 200)] ?? "";
        const back = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "New name", device: inside },
        });
        expect(back.status).toBe(200);
        expect(back.body.guest?.name).toBe("New name");
        const summary = await call("GET", `/v1/e/${event.code}`);
        expect(summary.body.event?.full).toBe(true);

        // A paid tier makes room.
        await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.30" },
        });
        const late = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Late", device: newDevice() },
        });
        expect(late.status).toBe(200);
    });

    test("after the reveal only guests who already joined get back in", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "at-end" } });
        const guest = await join(event.code, "Early");
        const ended = await call("POST", `/v1/events/${event.id}/end`, { token });
        expect(ended.body.event?.state).toBe("revealed");
        const again = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Early", device: guest.device },
        });
        expect(again.status).toBe(200);
        const stranger = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Stranger", device: newDevice() },
        });
        expect(stranger.body.code).toBe("not-open");
    });

    test("people lists guests with their confirmed shot counts", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code, "Lena");
        const people = await call("GET", `/v1/e/${event.code}/people`, { device: guest.device });
        expect(people.body.people?.[0]).toMatchObject({ name: "Lena", shots: 0 });
        expect(people.body.guestLimit).toBe(10);
    });
});

describe("auth", () => {
    test("host routes refuse other hosts and anonymous callers", async () => {
        const owner = await newHost();
        const other = await newHost();
        const event = await newEvent(owner.token);
        const routes: [string, string, unknown?][] = [
            ["GET", `/v1/events/${event.id}`],
            ["PATCH", `/v1/events/${event.id}`, { title: "Mine now" }],
            ["POST", `/v1/events/${event.id}/cover`],
            ["POST", `/v1/events/${event.id}/live`],
            ["POST", `/v1/events/${event.id}/end`],
        ];
        for (const [method, path, json] of routes) {
            const wrong = await call(method, path, { token: other.token, json });
            expect(wrong.status, `${method} ${path}`).toBe(404);
            const anonymous = await call(method, path, { json });
            expect(anonymous.status, `${method} ${path}`).toBe(401);
        }
        expect((await call("GET", "/v1/events", { token: "nope" })).status).toBe(401);
    });

    test("guest routes need a joined device", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const stranger = newDevice();
        for (const [method, path] of [
            ["GET", `/v1/e/${event.code}/me`],
            ["POST", `/v1/e/${event.code}/shots`],
            ["GET", `/v1/e/${event.code}/gallery`],
            ["GET", `/v1/e/${event.code}/people`],
        ] as const) {
            expect((await call(method, path)).status, `${method} ${path}`).toBe(401);
            expect((await call(method, path, { device: stranger })).status, path).toBe(403);
            expect((await call(method, path, { device: "short" })).status, path).toBe(401);
        }
        // The host may look at the gallery and people but can't shoot without joining.
        expect((await call("GET", `/v1/e/${event.code}/gallery`, { token })).status).toBe(200);
        expect((await call("POST", `/v1/e/${event.code}/shots`, { token })).status).toBe(401);
    });

    test("a stored push token only moves for its owner", async () => {
        const token = "ExponentPushToken[owned-by-a]";
        const a = newDevice();
        const b = newDevice();
        await call("POST", "/v1/push", { device: a, json: { token } });
        expect((await call("POST", "/v1/push", { device: b, json: { token } })).status).toBe(200);
        const [row] = await db.select().from(pushTokens).where(eq(pushTokens.token, token));
        expect(row?.device).toBe(a);
        const thief = await newHost();
        await call("POST", "/v1/push", { token: thief.token, json: { token } });
        const [still] = await db.select().from(pushTokens).where(eq(pushTokens.token, token));
        expect(still).toMatchObject({ device: a, hostId: null });
    });

    test("push tokens need a host or a device", async () => {
        const json = { token: "ExponentPushToken[abc]" };
        expect((await call("POST", "/v1/push", { json })).status).toBe(401);
        expect((await call("POST", "/v1/push", { json, device: newDevice() })).status).toBe(200);
        expect(
            (await call("POST", "/v1/push", { json: { token: "nope" }, device: newDevice() }))
                .status,
        ).toBe(400);
    });
});

describe("guessing codes", () => {
    test("an address that keeps missing is turned away, even for a real code", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        let status = 404;
        for (let i = 0; i < 25 && status === 404; i++) {
            status = (await call("GET", `/v1/e/ZZZZ${String(i).padStart(2, "2")}`)).status;
        }
        expect(status).toBe(429);
        expect((await call("GET", `/v1/e/${event.code}`)).status).toBe(429);
    });
});
