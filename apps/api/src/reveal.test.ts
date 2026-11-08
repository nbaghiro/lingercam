import type { ExpoPushMessage } from "expo-server-sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { boss, db, events, guests, pushTokens, startQueue, stopQueue } from "./db.ts";
import { checkReceipts, mail, pooled, push, sendPush } from "./notify.ts";
import { advance, revealOverdue, sendRevealEmail, startRevealWorker } from "./reveal.ts";
import { developShot, startShotWorkers } from "./shots.ts";
import {
    call,
    join,
    mailTo,
    newEvent,
    newHost,
    samplePhoto,
    shoot,
    upload,
    waitFor,
} from "./testing.ts";
import { exists, keys } from "./storage.ts";

const sent: ExpoPushMessage[] = [];

beforeAll(async () => {
    await startQueue();
    await startShotWorkers();
    await startRevealWorker();
    push.send = async (messages) => {
        sent.push(...messages);
        return messages.map((_, i) => ({ status: "ok" as const, id: `ticket-${sent.length + i}` }));
    };
});

/** What was pushed for one event, of one kind. */
function pushed(code: string, type: string): ExpoPushMessage[] {
    return sent.filter((m) => m.data?.code === code && m.data.type === type);
}

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

        // Moving the end moved the reveal, so every device heard quietly first.
        const moved = pushed(event.code, "reveal-changed");
        expect(moved.map((m) => m.to).sort()).toEqual([
            "ExponentPushToken[host-device]",
            "ExponentPushToken[priya-phone]",
        ]);
        expect(moved[0]?.contentAvailable).toBe(true);
        expect(moved[0]?.body).toBeUndefined();
        const ready = pushed(event.code, "revealed");
        expect(ready.map((m) => m.to).sort()).toEqual([
            "ExponentPushToken[host-device]",
            "ExponentPushToken[priya-phone]",
        ]);
        expect(ready[0]?.body).toBe("Test party: the photos are ready. 3 moments from 2 people.");

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

    test("a sweep every minute catches a reveal whose job was lost", async () => {
        const schedules = await boss.getSchedules("reveal-sweep");
        expect(schedules.map((s) => s.cron)).toEqual(["* * * * *"]);
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const row = await stateOf(event.id);
        if (!row) throw new Error("missing");
        const past = new Date(Date.now() - 60_000).toISOString();
        await db
            .update(events)
            .set({ settings: { ...row.settings, endsAt: past } })
            .where(eq(events.id, event.id));
        await boss.send("reveal-sweep", {});
        await waitFor(async () => (await stateOf(event.id))?.state === "revealed");
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

describe("telling people", () => {
    test("a browser guest's email gets the reveal line and a link that restores them", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { title: "Maya turns thirty" },
        });
        const sam = await join(event.code, "Sam");
        await developShot(await shoot(event.code, sam.device));
        const address = `sam-${event.code.toLowerCase()}@example.com`;
        const saved = await call("POST", `/v1/e/${event.code}/email`, {
            device: sam.device,
            json: { email: address.toUpperCase() },
        });
        expect(saved.body.email).toBe(address);

        await call("POST", `/v1/events/${event.id}/end`, { token });
        const email = await mailTo(address);
        expect(email.subject).toBe("Maya turns thirty: the photos are ready");
        expect(email.text).toContain(
            "Maya turns thirty: the photos are ready. 1 moment from 1 person.",
        );
        const link = /\/j\/([A-Z0-9]{6})\?restore=([A-Za-z0-9_-]+)/.exec(email.text);
        expect(link?.[1]).toBe(event.code);

        // The link moves Sam to a new browser, with Sam's photo.
        const browser = "new-browser-device-01";
        const restored = await call("POST", `/v1/e/${event.code}/restore`, {
            json: { token: link?.[2], device: browser },
        });
        expect(restored.status).toBe(200);
        expect(restored.body.guest?.id).toBe(sam.guestId);
        const mine = await call("GET", `/v1/e/${event.code}/gallery`, { device: browser });
        expect(mine.body.mine).toBe(1);
        expect((await call("GET", `/v1/e/${event.code}/me`, { device: sam.device })).status).toBe(
            403,
        );
        const wrong = await call("POST", `/v1/e/${event.code}/restore`, {
            json: { token: "x".repeat(43), device: "another-browser-0001" },
        });
        expect(wrong.body.code).toBe("bad-link");
    });

    test("I joined on another device: the link is emailed only to an address that joined", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { title: "Book club" } });
        const ana = await join(event.code, "Ana");
        const address = `ana-${event.code.toLowerCase()}@example.com`;
        await call("POST", `/v1/e/${event.code}/email`, {
            device: ana.device,
            json: { email: address },
        });
        const send = (email: string) =>
            call("POST", `/v1/e/${event.code}/restore/send`, { json: { email } });
        expect((await send(address)).body.sent).toBe(true);
        expect((await send(`nobody-${event.code}@example.com`)).body.sent).toBe(true);
        const email = await mailTo(address);
        expect(email.subject).toBe("Open Book club on this device");
        expect(email.text).toMatch(/\?restore=[A-Za-z0-9_-]{40,}/);
    });

    test("a restore link works once, for a week, and never for the host's own row", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { title: "Picnic" } });
        const kim = await join(event.code, "Kim");
        const address = `kim-${event.code.toLowerCase()}@example.com`;
        await call("POST", `/v1/e/${event.code}/email`, {
            device: kim.device,
            json: { email: address },
        });
        await call("POST", `/v1/e/${event.code}/restore/send`, { json: { email: address } });
        const link = /\?restore=([A-Za-z0-9_-]+)/.exec((await mailTo(address)).text)?.[1];
        const restore = (device: string, linkToken = link) =>
            call("POST", `/v1/e/${event.code}/restore`, { json: { token: linkToken, device } });

        const phone = "kim-second-phone-0001";
        expect((await restore(phone)).body.guest?.id).toBe(kim.guestId);
        // Opening it again where it landed just opens the event; anywhere else it's used up.
        expect((await restore(phone)).body.guest?.id).toBe(kim.guestId);
        expect((await restore("kim-third-browser-001")).body.code).toBe("bad-link");

        await call("POST", `/v1/e/${event.code}/restore/send`, { json: { email: address } });
        const stale = await waitFor(async () => {
            const found = /\?restore=([A-Za-z0-9_-]+)/.exec((await mailTo(address)).text)?.[1];
            return found && found !== link ? found : null;
        });
        await db
            .update(guests)
            .set({ restoreIssuedAt: new Date(Date.now() - 8 * 86_400_000) })
            .where(eq(guests.id, kim.guestId));
        expect((await restore("kim-fourth-browser-01", stale)).body.code).toBe("bad-link");

        const asHost = await call("POST", `/v1/e/${event.code}/email`, {
            token,
            json: { email: `host-${event.code.toLowerCase()}@example.com` },
        });
        expect(asHost.body.code).toBe("host-row");
        expect((await call("GET", `/v1/e/${event.code}/me`, { token })).status).toBe(200);
    });

    test("after the reveal a guest gets one email, and an address belongs to one guest", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { title: "Quiz night" } });
        const lee = await join(event.code, "Lee");
        const rob = await join(event.code, "Rob");
        const first = `lee-${event.code.toLowerCase()}@example.com`;
        const second = `lee2-${event.code.toLowerCase()}@example.com`;
        const setEmail = (device: string, email: string) =>
            call("POST", `/v1/e/${event.code}/email`, { device, json: { email } });

        expect((await setEmail(lee.device, first)).body.email).toBe(first);
        expect((await setEmail(rob.device, first)).body.code).toBe("email-taken");

        await call("POST", `/v1/events/${event.id}/end`, { token });
        expect((await mailTo(first)).subject).toBe("Quiz night: the photos are ready");
        expect((await setEmail(lee.device, second)).body.email).toBe(second);
        await new Promise((r) => setTimeout(r, 500));
        const query = encodeURIComponent(`to:"${second}"`);
        const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8176";
        const found = (await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json()) as {
            messages?: unknown[];
        };
        expect(found.messages ?? []).toHaveLength(0);
    });

    test("a reveal email that fails isn't marked sent, so its retry delivers it once", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { title: "Bake off" } });
        const jo = await join(event.code, "Jo");
        const address = `jo-${event.code.toLowerCase()}@example.com`;
        await call("POST", `/v1/e/${event.code}/email`, {
            device: jo.device,
            json: { email: address },
        });
        const emailedAt = async () =>
            (await db.select().from(guests).where(eq(guests.id, jo.guestId)))[0]?.emailedAt;

        const send = mail.send;
        mail.send = async () => {
            throw new Error("smtp is down");
        };
        try {
            await expect(
                sendRevealEmail(jo.guestId, "Bake off: the photos are ready."),
            ).rejects.toThrow();
        } finally {
            mail.send = send;
        }
        expect(await emailedAt()).toBeNull();
        expect(await sendRevealEmail(jo.guestId, "Bake off: the photos are ready.")).toBe(true);
        expect(await emailedAt()).toBeInstanceOf(Date);
        expect(await sendRevealEmail(jo.guestId, "Bake off: the photos are ready.")).toBe(false);
    });

    test("SMTP connections are pooled unless the URL says otherwise", () => {
        expect(pooled("smtp://resend:key@smtp.resend.com:587")).toBe(
            "smtp://resend:key@smtp.resend.com:587?pool=true",
        );
        expect(pooled("smtp://localhost:8177?pool=false")).toBe("smtp://localhost:8177?pool=false");
    });

    test("a host hears once when the event fills, and again after making room", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { title: "Game night" } });
        await call("POST", "/v1/push", { token, json: { token: "ExponentPushToken[full-host]" } });
        for (let i = 0; i < 10; i++) await join(event.code, `Guest ${i}`);
        const knock = () =>
            call("POST", `/v1/e/${event.code}/join`, {
                json: { name: "Late", device: `late-device-${Date.now()}-x` },
            });
        expect((await knock()).body.code).toBe("event-full");
        expect((await knock()).body.code).toBe("event-full");
        const full = pushed(event.code, "full");
        expect(full).toHaveLength(1);
        expect(full[0]?.body).toBe("Game night is full. Make room for more guests.");
        expect(full[0]?.to).toBe("ExponentPushToken[full-host]");

        await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.30" },
        });
        for (let i = 0; i < 20; i++) await join(event.code, `More ${i}`);
        expect((await knock()).body.code).toBe("event-full");
        expect(pushed(event.code, "full")).toHaveLength(2);
    });

    test("deleting an event tells its devices quietly", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code);
        await call("POST", "/v1/push", {
            device: guest.device,
            json: { token: "ExponentPushToken[deleted-guest]" },
        });
        expect((await call("DELETE", `/v1/events/${event.id}`, { token })).status).toBe(204);
        expect(pushed(event.code, "deleted").map((m) => m.to)).toEqual([
            "ExponentPushToken[deleted-guest]",
        ]);
    });

    test("tokens Expo says are gone are pruned, from tickets and from receipts", async () => {
        const tokens = ["ExponentPushToken[gone-now]", "ExponentPushToken[gone-later]"];
        for (const t of tokens) await db.insert(pushTokens).values({ token: t, device: "d" });
        const send = push.send;
        const receipts = push.receipts;
        push.send = async () => [
            {
                status: "error",
                message: "not registered",
                details: { error: "DeviceNotRegistered" },
            },
            { status: "ok", id: "receipt-1" },
        ];
        push.receipts = async () => ({
            "receipt-1": {
                status: "error",
                message: "not registered",
                details: { error: "DeviceNotRegistered" },
            },
        });
        try {
            await sendPush(tokens.map((to) => ({ to, body: "hi" })));
            const left = await db.select().from(pushTokens);
            expect(left.map((r) => r.token)).not.toContain(tokens[0]);
            expect(left.map((r) => r.token)).toContain(tokens[1]);
            expect(await checkReceipts([{ id: "receipt-1", token: tokens[1] ?? "" }])).toBe(1);
            const after = await db.select().from(pushTokens);
            expect(after.map((r) => r.token)).not.toContain(tokens[1]);
        } finally {
            push.send = send;
            push.receipts = receipts;
        }
    });
});
