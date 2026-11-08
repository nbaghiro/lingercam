import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, events, pushTokens, shots, startQueue, stopQueue } from "./db.ts";
import { joinPage, withPreview } from "./events.ts";
import { developShot } from "./shots.ts";
import { list } from "./storage.ts";
import {
    call,
    join,
    newDevice,
    newEvent,
    newHost,
    samplePhoto,
    settings,
    shoot,
    upload,
} from "./testing.ts";

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

    test("switching a custom reveal back to a preset clears its time", async () => {
        const { token } = await newHost();
        const revealAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
        const event = await newEvent(token, { settings: { revealMode: "custom", revealAt } });
        const res = await call("PATCH", `/v1/events/${event.id}`, {
            token,
            json: { revealMode: "at-end" },
        });
        expect(res.status).toBe(200);
        expect(res.body.event?.settings?.revealMode).toBe("at-end");
        expect(res.body.event?.settings?.revealAt).toBeUndefined();
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
        const removed = await call("DELETE", `/v1/events/${event.id}/cover`, { token });
        expect(removed.status).toBe(200);
        expect(removed.body.event?.coverUrl).toBeNull();
        const gone = await call("GET", `/v1/e/${event.code}/cover`);
        expect(gone.body.code).toBe("no-cover");
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
        expect(stranger.status).toBe(403);
        expect(stranger.body.code).toBe("not-member");
    });

    test("someone new can join for an hour after the camera closes, then only guests", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "next-morning" },
        });
        const early = await join(event.code, "Early");
        const ended = await call("POST", `/v1/events/${event.id}/end`, { token });
        expect(ended.body.event?.state).toBe("ended");
        const late = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Late", device: newDevice() },
        });
        expect(late.status).toBe(200);

        // Two hours on, the late-join hour is over.
        const [row] = await db.select().from(events).where(eq(events.id, event.id));
        if (!row) throw new Error("missing event");
        const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
        await db
            .update(events)
            .set({ settings: { ...row.settings, startsAt: twoHoursAgo, endsAt: twoHoursAgo } })
            .where(eq(events.id, event.id));
        const stranger = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Stranger", device: newDevice() },
        });
        expect(stranger.status).toBe(403);
        expect(stranger.body.code).toBe("not-member");
        const back = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Early", device: early.device },
        });
        expect(back.status).toBe(200);
    });

    test("people lists guests with their confirmed shot counts", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code, "Lena");
        const people = await call("GET", `/v1/e/${event.code}/people`, { device: guest.device });
        expect(people.body.people?.[0]).toMatchObject({ name: "Test Host", host: true });
        expect(people.body.people?.[1]).toMatchObject({ name: "Lena", shots: 0, host: false });
        expect(people.body.guestLimit).toBe(null);
        const asHost = await call("GET", `/v1/e/${event.code}/people`, { token });
        expect(asHost.body.guestLimit).toBe(10);
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
        // The host may look at the gallery and people, and shoots under their own row.
        expect((await call("GET", `/v1/e/${event.code}/gallery`, { token })).status).toBe(200);
        expect((await call("POST", `/v1/e/${event.code}/shots`, { token })).status).toBe(201);
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

describe("the summary and lists", () => {
    test("the summary says who is viewing, with counts and the server's clock", async () => {
        const { token } = await newHost("Alex");
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 12 } });
        const priya = await join(event.code, "Priya R.");
        await shoot(event.code, priya.device);
        await shoot(event.code, priya.device);

        const anyone = (await call("GET", `/v1/e/${event.code}`)).body.event;
        expect(anyone?.viewer).toEqual({
            role: "none",
            guestId: null,
            shotsTaken: 0,
            shotsLeft: 12,
        });
        expect(anyone).toMatchObject({ photoCount: 2, photographerCount: 1, guestLimit: null });
        expect(Math.abs(Date.parse(String(anyone?.now)) - Date.now())).toBeLessThan(5000);

        const guest = (await call("GET", `/v1/e/${event.code}`, { device: priya.device })).body
            .event;
        expect(guest?.viewer).toEqual({
            role: "guest",
            guestId: priya.guestId,
            shotsTaken: 2,
            shotsLeft: 10,
        });

        const host = (await call("GET", `/v1/e/${event.code}`, { token })).body.event;
        expect(host?.viewer?.role).toBe("host");
        expect(host?.guestLimit).toBe(10);
        expect(host?.guestCount).toBe(1);
    });

    test("the summary's state follows the clock before the reveal job runs", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "at-end" } });
        const [row] = await db.select().from(events).where(eq(events.code, event.code));
        if (!row) throw new Error("missing");
        const past = new Date(Date.now() - 60_000).toISOString();
        await db
            .update(events)
            .set({ settings: { ...row.settings, endsAt: past } })
            .where(eq(events.id, row.id));
        const summary = await call("GET", `/v1/e/${event.code}`);
        expect(summary.body.event?.state).toBe("revealed");
    });

    test("the host's list carries photo and guest counts", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const a = await join(event.code, "A");
        await join(event.code, "B");
        await shoot(event.code, a.device);
        await shoot(event.code, a.device);
        const list = await call("GET", "/v1/events", { token });
        expect(list.body.events?.[0]).toMatchObject({ photoCount: 2, guestCount: 2 });
    });

    test("a device's joined events come back as summaries, newest first", async () => {
        const { token } = await newHost();
        const first = await newEvent(token, { live: true, settings: { title: "First" } });
        const second = await newEvent(token, { live: true, settings: { title: "Second" } });
        const device = newDevice();
        for (const e of [first, second]) {
            await call("POST", `/v1/e/${e.code}/join`, { json: { name: "Sam", device } });
        }
        const joined = await call("GET", "/v1/joined", { device });
        expect(Object.values(joined.body.events ?? {}).map((e) => e.title)).toEqual([
            "Second",
            "First",
        ]);
        expect(joined.body.events?.[0]?.viewer?.role).toBe("guest");
        expect((await call("GET", "/v1/joined")).status).toBe(401);
        expect((await call("GET", "/v1/joined", { device: newDevice() })).body.events).toEqual([]);
    });
});

describe("scheduled events", () => {
    test("guests join a live event before its start, and the camera opens at the start", async () => {
        const { token } = await newHost();
        const hour = 3_600_000;
        const event = await newEvent(token, {
            live: true,
            settings: {
                startsAt: new Date(Date.now() + 2 * hour).toISOString(),
                endsAt: new Date(Date.now() + 6 * hour).toISOString(),
            },
        });
        const guest = await join(event.code, "Early");
        const early = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(early.body.code).toBe("not-shooting");
        const [row] = await db.select().from(events).where(eq(events.code, event.code));
        if (!row) throw new Error("missing");
        const started = new Date(Date.now() - 60_000).toISOString();
        await db
            .update(events)
            .set({ settings: { ...row.settings, startsAt: started } })
            .where(eq(events.id, row.id));
        const open = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(open.status).toBe(201);
    });
});

describe("the host's place", () => {
    test("the host shoots at a full free event without taking a guest place", async () => {
        const { token } = await newHost("Alex Morgan");
        const event = await newEvent(token, { live: true });
        for (let i = 0; i < 10; i++) await join(event.code, `Guest ${i}`);
        const joined = await call("POST", `/v1/e/${event.code}/join`, { token });
        expect(joined.status).toBe(200);
        expect(joined.body.guest?.name).toBe("Alex Morgan");
        const reserved = await call("POST", `/v1/e/${event.code}/shots`, { token });
        expect(reserved.status).toBe(201);
        expect(await upload(String(reserved.body.uploadUrl), await samplePhoto())).toBe(200);
        const id = String(reserved.body.shotId);
        expect((await call("POST", `/v1/shots/${id}/confirm`, { token })).status).toBe(200);
        const summary = await call("GET", `/v1/e/${event.code}`, { token });
        expect(summary.body.event).toMatchObject({ guestCount: 10, full: true });
        expect(summary.body.event?.viewer?.shotsTaken).toBe(1);
        const me = await call("GET", `/v1/e/${event.code}/me`, { token });
        expect(me.body).toMatchObject({ shotsLeft: 4, returned: 0 });
    });

    test("people lists the host first, even before they shoot, and follows their name", async () => {
        const { token } = await newHost("Alex");
        const event = await newEvent(token, { live: true });
        const lena = await join(event.code, "Lena");
        await shoot(event.code, lena.device);
        await call("PATCH", "/v1/me", { token, json: { name: "Alex M." } });
        const people = await call("GET", `/v1/e/${event.code}/people`, { device: lena.device });
        expect(people.body.people?.[0]).toMatchObject({ name: "Alex M.", host: true, shots: 0 });
        expect(people.body.people?.[1]).toMatchObject({ name: "Lena", host: false, shots: 1 });
    });

    test("after the reveal, people counts leave out photos hidden from guests", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "right-away" } });
        const ana = await join(event.code, "Ana");
        const kept = await shoot(event.code, ana.device);
        const hidden = await shoot(event.code, ana.device);
        await developShot(kept);
        await developShot(hidden);
        await call("POST", `/v1/shots/${hidden}/hide`, { token, json: { hidden: true } });
        const asGuest = await call("GET", `/v1/e/${event.code}/people`, { device: ana.device });
        expect(asGuest.body.people?.[1]).toMatchObject({ name: "Ana", shots: 1 });
        const asHost = await call("GET", `/v1/e/${event.code}/people`, { token });
        expect(asHost.body.people?.[1]).toMatchObject({ name: "Ana", shots: 2 });
    });

    test("a photo the server couldn't develop is counted as returned", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code);
        const r = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        await upload(String(r.body.uploadUrl), Buffer.from("not a photo"));
        await call("POST", `/v1/shots/${String(r.body.shotId)}/confirm`, {
            device: guest.device,
        });
        await developShot(String(r.body.shotId));
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.returned).toBe(1);
    });
});

describe("deleting an event", () => {
    test("removes its rows and every stored file, and only its host can", async () => {
        const { token } = await newHost();
        const other = await newHost();
        const event = await newEvent(token, { live: true });
        await call("POST", `/v1/events/${event.id}/cover`, { token });
        const guest = await join(event.code);
        await shoot(event.code, guest.device);
        expect((await list(`events/${event.id}/`)).length).toBeGreaterThan(0);
        const path = `/v1/events/${event.id}`;
        expect((await call("DELETE", path, { token: other.token })).status).toBe(404);
        expect((await call("DELETE", path, { token })).status).toBe(204);
        expect(await list(`events/${event.id}/`)).toEqual([]);
        expect(await db.select().from(events).where(eq(events.id, event.id))).toEqual([]);
        expect(await db.select().from(shots).where(eq(shots.eventId, event.id))).toEqual([]);
        expect((await call("GET", `/v1/e/${event.code}`)).status).toBe(404);
    });
});

describe("the shared link", () => {
    test("the page carries the event's preview tags, escaped", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { title: "Maya <turns> thirty" },
        });
        await call("POST", `/v1/events/${event.id}/cover`, { token });
        const index = joinPage.index;
        joinPage.index = async () =>
            '<!doctype html><html><head><title>LingerCam</title></head><body><div id="root"></div></body></html>';
        try {
            const res = await call("GET", `/v1/e/${event.code}/page`);
            const html = String(res.body.text);
            expect(html).toContain(
                "<title>You&#39;re invited to shoot Maya &lt;turns&gt; thirty</title>",
            );
            expect(html).toContain(
                '<meta property="og:description" content="Scan to join. No download needed.">',
            );
            expect(html).toMatch(/<meta property="og:image" content="http[^"]+\/cover\?v=1">/);
            expect(html).toContain('<div id="root"></div>');
            const unknown = await call("GET", "/v1/e/ZZZZZZ/page");
            expect(String(unknown.body.text)).toContain("<title>LingerCam</title>");
        } finally {
            joinPage.index = index;
        }
    });

    test("a title with replacement patterns stays as written", () => {
        const html =
            "<!doctype html><html><head><title>LingerCam</title><style>x</style></head><body></body></html>";
        const title = "Dollars $` $& $' $$";
        const out = withPreview(html, { "og:title": title }, title);
        expect(out).toBe(
            "<!doctype html><html><head><title>Dollars $` $&amp; $&#39; $$</title><style>x</style>" +
                '<meta property="og:title" content="Dollars $` $&amp; $&#39; $$"></head><body></body></html>',
        );
    });

    test("the calendar file has one entry at the reveal with the event link", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: {
                title: "Maya turns thirty, again",
                endsAt: "2030-06-21T05:00:00Z",
                revealMode: "at-end",
            },
        });
        const res = await call("GET", `/v1/e/${event.code}/calendar.ics`);
        const ics = String(res.body.text);
        expect(ics).toContain("BEGIN:VEVENT\r\n");
        expect(ics).toContain("DTSTART:20300621T050000Z");
        expect(ics).toContain("SUMMARY:Maya turns thirty\\, again: the photos are ready");
        expect(ics.replace(/\r\n /g, "")).toContain(`/j/${event.code}`);
        for (const line of ics.split("\r\n"))
            expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
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

    test("one phone's misses on a venue's Wi-Fi don't lock out the guests around it", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        // The app sends its device with every request, so its misses are counted apart.
        const ana = newDevice();
        const joined = await call("POST", `/v1/e/${event.code}/join`, {
            device: ana,
            json: { name: "Ana", device: ana },
        });
        expect(joined.status).toBe(200);
        const typo = newDevice();
        let status = 404;
        for (let i = 0; i < 25 && status === 404; i++) {
            const code = `YYYY${String(i).padStart(2, "2")}`;
            status = (await call("GET", `/v1/e/${code}`, { device: typo })).status;
        }
        expect(status).toBe(429);
        // Ana is already in the event, and a new guest at the same venue can still join.
        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { device: ana });
        expect(gallery.status).toBe(200);
        expect((await call("GET", `/v1/e/${event.code}`, { device: newDevice() })).status).toBe(
            200,
        );
        expect((await call("GET", `/v1/e/${event.code}`, { device: typo })).status).toBe(429);
    });
});
