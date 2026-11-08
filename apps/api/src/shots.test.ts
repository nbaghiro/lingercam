import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ExpoPushMessage } from "expo-server-sdk";
import { boss, db, events, guests, pushTokens, shots, startQueue, stopQueue } from "./db.ts";
import { push } from "./notify.ts";
import { startDeletionWorkers } from "./deletion.ts";
import {
    developImage,
    developShot,
    GIVE_UP_HOURS,
    pickHighlights,
    releaseExpired,
    STUCK_MINUTES,
    sweepUploaded,
    type Candidate,
} from "./shots.ts";
import { exists, keys, list, MAX_UPLOAD_BYTES, put } from "./storage.ts";
import {
    call,
    join,
    mailTo,
    newDevice,
    newEvent,
    newHost,
    samplePhoto,
    shoot,
    upload,
    waitFor,
} from "./testing.ts";

beforeAll(async () => {
    await startQueue();
    await startDeletionWorkers();
});
afterAll(stopQueue);

describe("reserving shots", () => {
    test("20 parallel reservations against an allowance of 5 give exactly 5", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const replies = await Promise.all(
            Array.from({ length: 20 }, () =>
                call("POST", `/v1/e/${event.code}/shots`, { device: guest.device }),
            ),
        );
        const ok = replies.filter((r) => r.status === 201);
        expect(ok).toHaveLength(5);
        expect(replies.filter((r) => String(r.body.code) === "no-shots-left")).toHaveLength(15);
        const rows = await db.select().from(shots).where(eq(shots.guestId, guest.guestId));
        expect(rows).toHaveLength(5);
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(0);
        expect(me.body.guest?.shotsTaken).toBe(5);
    });

    test("reservations never confirmed are released after ten minutes", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const reserved = [];
        for (let i = 0; i < 5; i++) {
            reserved.push(
                await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device }),
            );
        }
        const extra = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(extra.body.code).toBe("no-shots-left");

        // Two of them were made eleven minutes ago; one of those finished uploading in the
        // background, so it's kept and confirmed, and only the other is released.
        const stale = new Date(Date.now() - 11 * 60_000);
        for (const r of reserved.slice(0, 2)) {
            await db
                .update(shots)
                .set({ reservedAt: stale })
                .where(eq(shots.id, String(r.body.shotId)));
        }
        expect(await upload(String(reserved[0]?.body.uploadUrl), await samplePhoto())).toBe(200);
        expect(await releaseExpired()).toBeGreaterThanOrEqual(1);

        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(1);
        const again = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(again.status).toBe(201);
        const late = await call("POST", `/v1/shots/${String(reserved[0]?.body.shotId)}/confirm`, {
            device: guest.device,
        });
        expect(late.status).toBe(200);
        expect(late.body.shot?.state).not.toBe("reserved");
        const lost = await call("POST", `/v1/shots/${String(reserved[1]?.body.shotId)}/confirm`, {
            device: guest.device,
        });
        expect(lost.body.code).toBe("reservation-expired");
    });

    test("confirm checks the upload and the owner", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const a = await join(event.code, "A");
        const b = await join(event.code, "B");
        const r = await call("POST", `/v1/e/${event.code}/shots`, { device: a.device });
        const id = String(r.body.shotId);
        expect(
            (await call("POST", `/v1/shots/${id}/confirm`, { device: a.device })).body.code,
        ).toBe("not-uploaded");
        expect(await upload(String(r.body.uploadUrl), await samplePhoto())).toBe(200);
        expect((await call("POST", `/v1/shots/${id}/confirm`, { device: b.device })).status).toBe(
            404,
        );
        expect((await call("POST", `/v1/shots/${id}/confirm`, {})).status).toBe(401);
        const ok = await call("POST", `/v1/shots/${id}/confirm`, { device: a.device });
        expect(ok.body.shot?.state).toBe("uploaded");
        const twice = await call("POST", `/v1/shots/${id}/confirm`, { device: a.device });
        expect(twice.status).toBe(200);
    });

    test("the camera is closed outside a live event", async () => {
        const { token } = await newHost();
        const draft = await newEvent(token);
        const joinDraft = await call("POST", `/v1/e/${draft.code}/join`, {
            json: { name: "Early", device: "early-device-123456" },
        });
        expect(joinDraft.body.code).toBe("not-open");

        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "next-morning" },
        });
        const guest = await join(event.code);
        await call("POST", `/v1/events/${event.id}/end`, { token });
        const late = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(late.body.code).toBe("not-shooting");
    });

    test.each([
        ["next-morning", "ended"],
        ["at-end", "revealed"],
        ["right-away", "revealed"],
        ["custom", "ended"],
    ] as const)(
        "a %s event takes photos from before the end for a while after it (%s)",
        async (revealMode, after) => {
            const { token } = await newHost();
            const revealAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
            const event = await newEvent(token, {
                live: true,
                settings: { revealMode, ...(revealMode === "custom" ? { revealAt } : {}) },
            });
            const guest = await join(event.code);
            const takenAt = new Date(Date.now() - 1000).toISOString();
            const ended = await call("POST", `/v1/events/${event.id}/end`, { token });
            expect(ended.body.event?.state).toBe(after);
            const reserved = await call("POST", `/v1/e/${event.code}/shots`, {
                device: guest.device,
                json: { takenAt },
            });
            expect(reserved.status).toBe(201);
            expect(await upload(String(reserved.body.uploadUrl), await samplePhoto())).toBe(200);
            const id = String(reserved.body.shotId);
            const confirmed = await call("POST", `/v1/shots/${id}/confirm`, {
                device: guest.device,
            });
            expect(confirmed.body.shot?.state).toBe("uploaded");
            expect((await developShot(id))?.state).toBe("developed");
            const now = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
            expect(now.body.code).toBe("not-shooting");
        },
    );

    test("a retried reservation with the same client id returns the same shot", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const json = { clientId: "photo-1234abcd" };
        const replies = await Promise.all(
            Array.from({ length: 4 }, () =>
                call("POST", `/v1/e/${event.code}/shots`, { device: guest.device, json }),
            ),
        );
        expect(replies.map((r) => r.status)).toEqual([201, 201, 201, 201]);
        expect(new Set(replies.map((r) => String(r.body.shotId))).size).toBe(1);
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(4);
        const other = await call("POST", `/v1/e/${event.code}/shots`, {
            device: guest.device,
            json: { clientId: "photo-5678efgh" },
        });
        expect(other.body.shotId).not.toBe(replies[0]?.body.shotId);
    });

    test("an upload over the size limit is refused and removed", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code);
        const r = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        const id = String(r.body.shotId);
        const huge = Buffer.alloc(15 * 1024 * 1024 + 1, 1);
        expect(await upload(String(r.body.uploadUrl), huge)).toBe(200);
        const confirmed = await call("POST", `/v1/shots/${id}/confirm`, { device: guest.device });
        expect(confirmed.status).toBe(413);
        expect(await exists(keys.shot(event.id, id, "original"))).toBe(false);
    });
});

describe("developing failures", () => {
    test("a file that isn't a photo fails, and the shot goes back to the guest", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const r = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        const id = String(r.body.shotId);
        expect(await upload(String(r.body.uploadUrl), Buffer.from("not a jpeg at all"))).toBe(200);
        await call("POST", `/v1/shots/${id}/confirm`, { device: guest.device });
        expect((await developShot(id))?.state).toBe("failed");
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(5);
        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { token });
        expect(gallery.body.total).toBe(0);
        await waitFor(async () => !(await exists(keys.shot(event.id, id, "original"))));
    });

    test("developing deletes the original, so camera metadata isn't kept", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code);
        const id = await shoot(event.code, guest.device);
        expect(await exists(keys.shot(event.id, id, "original"))).toBe(true);
        await developShot(id);
        expect(await exists(keys.shot(event.id, id, "original"))).toBe(false);
        expect(await exists(keys.shot(event.id, id, "developed"))).toBe(true);
    });

    test("a file swapped for a larger one after the confirm is refused, not read", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const id = await shoot(event.code, guest.device);
        await put(keys.shot(event.id, id, "original"), Buffer.alloc(MAX_UPLOAD_BYTES + 1));
        expect((await developShot(id))?.state).toBe("failed");
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(5);
    });

    test("a photo developed while its event is deleted leaves nothing in storage", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const guest = await join(event.code);
        const id = await shoot(event.code, guest.device);
        const developing = developShot(id);
        await db.delete(events).where(eq(events.id, event.id));
        await developing;
        await developShot(id);
        expect(await list(keys.event(event.id))).toEqual([]);
    });

    test("stuck uploads are queued again, and given back after six hours", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const guest = await join(event.code);
        const lost = await shoot(event.code, guest.device);
        const stale = await shoot(event.code, guest.device);
        const jobs = (shotId: string) =>
            boss.findJobs("develop", { data: { shotId }, queued: true });
        await boss.deleteJob(
            "develop",
            [...(await jobs(lost)), ...(await jobs(stale))].map((j) => j.id),
        );
        const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
        await db
            .update(shots)
            .set({ reservedAt: ago(STUCK_MINUTES + 5) })
            .where(eq(shots.id, lost));
        await db
            .update(shots)
            .set({ reservedAt: ago(GIVE_UP_HOURS * 60 + 5) })
            .where(eq(shots.id, stale));

        const swept = await sweepUploaded();
        expect(swept.queued).toBeGreaterThanOrEqual(1);
        expect(await jobs(lost)).toHaveLength(1);
        // A second sweep doesn't queue it twice.
        await sweepUploaded();
        expect(await jobs(lost)).toHaveLength(1);
        const [given] = await db.select().from(shots).where(eq(shots.id, stale));
        expect(given?.state).toBe("failed");
        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(4);
        await waitFor(async () => !(await exists(keys.shot(event.id, stale, "original"))));
    });
});

describe("before the reveal", () => {
    test("no route the host or a guest can reach returns a photo or a signed URL", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "next-morning" },
        });
        const guest = await join(event.code, "Guest");
        const id = await shoot(event.code, guest.device);
        await developShot(id);
        const leaks = /X-Amz-Signature|localhost:8174|\/shots\//;
        const replies = [];
        for (const who of [{ token }, { device: guest.device }]) {
            replies.push(
                await call("GET", `/v1/e/${event.code}`, who),
                await call("GET", `/v1/e/${event.code}/gallery`, who),
                await call("GET", `/v1/e/${event.code}/people`, who),
                await call("POST", `/v1/shots/${id}/like`, who),
                await call("POST", `/v1/shots/${id}/report`, who),
            );
        }
        replies.push(
            await call("GET", `/v1/e/${event.code}/me`, { device: guest.device }),
            await call("POST", `/v1/shots/${id}/confirm`, { device: guest.device }),
            await call("POST", `/v1/shots/${id}/hide`, { token, json: { hidden: true } }),
            await call("GET", `/v1/events/${event.id}`, { token }),
            await call("GET", "/v1/events", { token }),
        );
        for (const reply of replies) expect(JSON.stringify(reply.body)).not.toMatch(leaks);
    });
});

describe("after the reveal", () => {
    async function revealedShot() {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "right-away" } });
        const people = [];
        for (const name of ["Ana", "Ben", "Cai", "Dev"]) people.push(await join(event.code, name));
        const shooter = people[0];
        if (!shooter) throw new Error("no guest");
        const id = await shoot(event.code, shooter.device);
        await developShot(id);
        return { token, event, people, id };
    }

    test("a report reaches LingerCam by email, with the event and the photo", async () => {
        const moderation = `moderation-${Date.now()}@example.com`;
        process.env.MODERATION_EMAIL = moderation;
        try {
            const { event, people, id } = await revealedShot();
            const ben = people[1];
            if (!ben) throw new Error("guest");
            await call("POST", `/v1/shots/${id}/report`, { device: ben.device });
            const mail = await mailTo(moderation);
            expect(mail.subject).toContain(event.code);
            expect(mail.text).toContain(id);
            expect(mail.text).toContain("Taken by: Ana");
        } finally {
            delete process.env.MODERATION_EMAIL;
        }
    });

    test("the host removes a guest: their photos and likes go, and that phone can't rejoin", async () => {
        const { token, event, people, id } = await revealedShot();
        const [ana, ben] = people;
        if (!ana || !ben) throw new Error("guests");
        await call("POST", `/v1/shots/${id}/like`, { device: ben.device });
        const benShot = await shoot(event.code, ben.device);
        await developShot(benShot);

        // Only the host can remove someone, and never the host's own row.
        const byGuest = await call("DELETE", `/v1/events/${event.id}/guests/${ben.guestId}`, {
            device: ana.device,
        });
        expect(byGuest.status).toBe(401);

        const removed = await call("DELETE", `/v1/events/${event.id}/guests/${ben.guestId}`, {
            token,
        });
        expect(removed.status).toBe(204);
        await waitFor(async () => !(await exists(keys.shot(event.id, benShot, "developed"))));
        const [liked] = await db.select().from(shots).where(eq(shots.id, id));
        expect(liked?.likes).toBe(0);
        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { device: ana.device });
        expect(gallery.body.total).toBe(1);

        const again = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Ben", device: ben.device },
        });
        expect(again.status).toBe(403);
        expect(again.body.code).toBe("removed");
        const someoneElse = await call("POST", `/v1/e/${event.code}/join`, {
            json: { name: "Cleo", device: newDevice() },
        });
        expect(someoneElse.status).toBe(200);
    });

    test("three reports hide a photo from guests but not from the host", async () => {
        const { token, event, people, id } = await revealedShot();
        const [, ben, cai, dev] = people;
        if (!ben || !cai || !dev) throw new Error("guests");
        await call("POST", `/v1/shots/${id}/report`, { device: ben.device });
        await call("POST", `/v1/shots/${id}/report`, { device: ben.device });
        await call("POST", `/v1/shots/${id}/report`, { device: cai.device });
        let [row] = await db.select().from(shots).where(eq(shots.id, id));
        expect(row?.reports).toBe(2);
        expect(row?.hidden).toBe(false);
        await call("POST", `/v1/shots/${id}/report`, { device: dev.device });
        [row] = await db.select().from(shots).where(eq(shots.id, id));
        expect(row?.hidden).toBe(true);

        const guestView = await call("GET", `/v1/e/${event.code}/gallery`, { device: ben.device });
        expect(guestView.body.total).toBe(0);
        const hostView = await call("GET", `/v1/e/${event.code}/gallery`, { token });
        expect(hostView.body.items?.[0]?.hidden).toBe(true);

        const unhide = await call("POST", `/v1/shots/${id}/hide`, {
            token,
            json: { hidden: false },
        });
        expect(unhide.body.shot?.hidden).toBe(false);
        expect(
            (await call("GET", `/v1/e/${event.code}/gallery`, { device: ben.device })).body.total,
        ).toBe(1);

        // The host's decision sticks: repeat reports, and new ones past the threshold, don't
        // hide it again.
        await call("POST", `/v1/shots/${id}/report`, { device: ben.device });
        await call("POST", `/v1/shots/${id}/report`, { device: dev.device });
        await call("POST", `/v1/shots/${id}/report`, { token });
        [row] = await db.select().from(shots).where(eq(shots.id, id));
        expect(row?.reports).toBe(4);
        expect(row?.hidden).toBe(false);
    });

    test("likes toggle and count once per person", async () => {
        const { token, event, people, id } = await revealedShot();
        const ben = people[1];
        if (!ben) throw new Error("guest");
        expect((await call("POST", `/v1/shots/${id}/like`, { device: ben.device })).body).toEqual({
            liked: true,
            likes: 1,
        });
        expect((await call("POST", `/v1/shots/${id}/like`, { token })).body.likes).toBe(2);
        const view = await call("GET", `/v1/e/${event.code}/gallery`, { device: ben.device });
        expect(view.body.items?.[0]?.likedByMe).toBe(true);
        expect((await call("POST", `/v1/shots/${id}/like`, { device: ben.device })).body).toEqual({
            liked: false,
            likes: 1,
        });
    });

    test("only the event's host can hide a photo", async () => {
        const { event, people, id } = await revealedShot();
        const other = await newHost();
        const ben = people[1];
        if (!ben) throw new Error("guest");
        expect(
            (
                await call("POST", `/v1/shots/${id}/hide`, {
                    token: other.token,
                    json: { hidden: true },
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await call("POST", `/v1/shots/${id}/hide`, {
                    device: ben.device,
                    json: { hidden: true },
                })
            ).status,
        ).toBe(401);
        expect((await call("POST", `/v1/shots/${id}/like`, { token: other.token })).status).toBe(
            403,
        );
        const outsider = await call("GET", `/v1/e/${event.code}/gallery`, { token: other.token });
        expect(outsider.status).toBe(403);
    });

    test("host-only visibility shows guests just their own photos", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "right-away", visibility: "host-only" },
        });
        const a = await join(event.code, "A");
        const b = await join(event.code, "B");
        await developShot(await shoot(event.code, a.device));
        await developShot(await shoot(event.code, b.device));
        expect((await call("GET", `/v1/e/${event.code}/gallery`, { token })).body.total).toBe(2);
        const own = await call("GET", `/v1/e/${event.code}/gallery`, { device: a.device });
        expect(own.body.total).toBe(1);
        expect(own.body.items?.[0]?.photographer?.name).toBe("A");
    });

    test("the gallery pages with a cursor", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "right-away", shotsPerGuest: 5 },
        });
        const a = await join(event.code);
        for (let i = 0; i < 3; i++) await developShot(await shoot(event.code, a.device));
        const first = await call("GET", `/v1/e/${event.code}/gallery?limit=2`, { token });
        expect(Object.values(first.body.items ?? {})).toHaveLength(2);
        const cursor = String(first.body.nextCursor);
        const second = await call("GET", `/v1/e/${event.code}/gallery?limit=2&cursor=${cursor}`, {
            token,
        });
        expect(Object.values(second.body.items ?? {})).toHaveLength(1);
        expect(second.body.nextCursor).toBeNull();
        const [g] = await db.select().from(guests).where(eq(guests.id, a.guestId));
        expect(g?.shotsTaken).toBe(3);
    });
});

describe("late photos", () => {
    async function endedLongAgo(days: number) {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "at-end" } });
        const guest = await join(event.code);
        const day = 86_400_000;
        const [row] = await db.select().from(events).where(eq(events.code, event.code));
        if (!row) throw new Error("missing");
        const ends = Date.now() - days * day;
        await db
            .update(events)
            .set({
                state: "revealed",
                revealedAt: new Date(ends),
                settings: {
                    ...row.settings,
                    startsAt: new Date(ends - 4 * 3_600_000).toISOString(),
                    endsAt: new Date(ends).toISOString(),
                },
            })
            .where(eq(events.id, row.id));
        return { event, guest, takenAt: new Date(ends - 3_600_000).toISOString() };
    }

    test("a photo taken while the camera was open is accepted for 7 days after the reveal", async () => {
        const recent = await endedLongAgo(6);
        const ok = await call("POST", `/v1/e/${recent.event.code}/shots`, {
            device: recent.guest.device,
            json: { takenAt: recent.takenAt },
        });
        expect(ok.status).toBe(201);
        const old = await endedLongAgo(8);
        const refused = await call("POST", `/v1/e/${old.event.code}/shots`, {
            device: old.guest.device,
            json: { takenAt: old.takenAt },
        });
        expect(refused.body.code).toBe("not-shooting");
    });
});

describe("the gallery for the app's screens", () => {
    test("the developing page names who took each photo, in order, and no more", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const priya = await join(event.code, "Priya R.");
        const theo = await join(event.code, "Theo");
        await shoot(event.code, priya.device);
        await shoot(event.code, theo.device);
        await shoot(event.code, priya.device);
        const page = await call("GET", `/v1/e/${event.code}/gallery`, { device: theo.device });
        expect(page.body).toMatchObject({ kind: "developing", total: 3, mine: 1 });
        expect(page.body.names).toEqual(["Priya", "Theo", "Priya"]);
        expect(JSON.stringify(page.body)).not.toMatch(/X-Amz|\/shots\//);
    });

    test("a roll pages from the server, and the host sees report counts", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "right-away" } });
        const a = await join(event.code, "A");
        const b = await join(event.code, "B");
        const first = await shoot(event.code, a.device);
        await developShot(first);
        await developShot(await shoot(event.code, b.device));
        await developShot(await shoot(event.code, a.device));
        await call("POST", `/v1/shots/${first}/report`, { device: b.device });

        const roll = await call("GET", `/v1/e/${event.code}/gallery?guest=${a.guestId}`, {
            device: b.device,
        });
        expect(roll.body).toMatchObject({ kind: "photos", total: 2, mine: 0 });
        const names = Object.values(roll.body.items ?? {}).map((i) => i.photographer?.name);
        expect(names).toEqual(["A", "A"]);
        expect(roll.body.items?.[0]?.reports).toBe(0);

        const host = await call("GET", `/v1/e/${event.code}/gallery?guest=${a.guestId}`, {
            token,
        });
        expect(host.body.items?.[0]?.reports).toBe(1);
        const mine = await call("GET", `/v1/e/${event.code}/gallery`, { device: a.device });
        expect(mine.body.mine).toBe(2);
        const bad = await call("GET", `/v1/e/${event.code}/gallery?guest=nope`, { token });
        expect(bad.status).toBe(400);
    });
});

describe("highlights", () => {
    const shot = (id: string, guestId: string, likes = 0): Candidate => ({ id, guestId, likes });

    test("the moment takes one of the viewer's own, then other people across the night", () => {
        const night = [
            shot("1", "ana"),
            shot("2", "ana"),
            shot("3", "ana"),
            shot("4", "ben"),
            shot("5", "ana"),
            shot("6", "cai"),
            shot("7", "ana"),
            shot("8", "me"),
            shot("9", "ana"),
        ];
        const picked = pickHighlights(night, "moment", "me");
        expect(picked.map((p) => p.guestId)).toContain("me");
        expect(new Set(picked.map((p) => p.guestId)).size).toBe(3);
        expect(picked.map((p) => p.id)).toEqual(
            [...picked.map((p) => p.id)].sort((x, y) => Number(x) - Number(y)),
        );
        const stranger = pickHighlights(night, "moment", null);
        expect(new Set(stranger.map((p) => p.guestId)).size).toBe(3);
    });

    test("the recap spreads people over the night until someone likes a photo", () => {
        const night = Array.from({ length: 40 }, (_, i) => shot(String(i), `g${i % 5}`));
        const spread = pickHighlights(night, "recap", null);
        expect(spread).toHaveLength(12);
        const per = new Map<string, number>();
        for (const p of spread) per.set(p.guestId, (per.get(p.guestId) ?? 0) + 1);
        expect(Math.max(...per.values())).toBeLessThanOrEqual(3);
        expect(Number(spread[0]?.id)).toBeLessThan(5);
        expect(Number(spread.at(-1)?.id)).toBeGreaterThan(34);

        const liked = night.map((p, i) => ({ ...p, likes: i === 7 || i === 30 ? 5 : 0 }));
        const top = pickHighlights(liked, "recap", null);
        expect(top.map((p) => p.id)).toContain("7");
        expect(top.map((p) => p.id)).toContain("30");
    });

    test("the route signs the chosen photos only after the reveal", async () => {
        const { token } = await newHost();
        const later = await newEvent(token, { live: true });
        const g = await join(later.code);
        await developShot(await shoot(later.code, g.device));
        const early = await call("GET", `/v1/e/${later.code}/highlights?for=moment`, {
            device: g.device,
        });
        expect(early.body.code).toBe("not-revealed");
        expect(JSON.stringify(early.body)).not.toMatch(/X-Amz/);

        const event = await newEvent(token, { live: true, settings: { revealMode: "right-away" } });
        const a = await join(event.code, "A");
        for (let i = 0; i < 4; i++) await developShot(await shoot(event.code, a.device));
        const moment = await call("GET", `/v1/e/${event.code}/highlights?for=moment`, {
            device: a.device,
        });
        const items = Object.values(moment.body.items ?? {});
        expect(items).toHaveLength(3);
        expect(String(items[0]?.url)).toMatch(/X-Amz-Signature/);
        const recap = await call("GET", `/v1/e/${event.code}/highlights?for=recap`, { token });
        expect(Object.values(recap.body.items ?? {})).toHaveLength(4);
    });
});

describe("taking a photo back", () => {
    test("a guest removes their own photo after the reveal, nobody else's", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { revealMode: "right-away" } });
        const a = await join(event.code, "A");
        const b = await join(event.code, "B");
        const id = await shoot(event.code, a.device);
        await developShot(id);
        expect((await call("DELETE", `/v1/shots/${id}`, { device: b.device })).body.code).toBe(
            "not-yours",
        );
        expect((await call("DELETE", `/v1/shots/${id}`, { token })).body.code).toBe("not-yours");
        expect((await call("DELETE", `/v1/shots/${id}`, { device: a.device })).status).toBe(204);
        await waitFor(async () => !(await exists(keys.shot(event.id, id, "developed"))));
        const gallery = await call("GET", `/v1/e/${event.code}/gallery`, { token });
        expect(gallery.body.total).toBe(0);
    });
});

describe("reports reach the host", () => {
    test("a push goes to the host when reports hide a photo", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, {
            live: true,
            settings: { revealMode: "right-away", title: "Maya turns thirty" },
        });
        await call("POST", "/v1/push", { token, json: { token: "ExponentPushToken[reports]" } });
        const people = [];
        for (const name of ["A", "B", "C", "D"]) people.push(await join(event.code, name));
        const id = await shoot(event.code, people[0]?.device ?? "");
        await developShot(id);
        const sent: ExpoPushMessage[] = [];
        const send = push.send;
        push.send = async (messages) => {
            sent.push(...messages);
            return [];
        };
        try {
            for (const p of people.slice(1)) {
                await call("POST", `/v1/shots/${id}/report`, { device: p.device });
            }
        } finally {
            push.send = send;
        }
        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toBe("ExponentPushToken[reports]");
        expect(sent[0]?.body).toBe("A photo at Maya turns thirty was hidden after reports.");
        await db.delete(pushTokens).where(eq(pushTokens.token, "ExponentPushToken[reports]"));
    });
});

describe("developing", () => {
    test("a demo photo develops to 2048 px and a 512 px thumbnail in good time", async () => {
        const original = await readFile(
            new URL("../../app/assets/demo/w-dance.jpg", import.meta.url),
        );
        const started = performance.now();
        const out = await developImage(original, "warm-98@1", 42);
        const ms = performance.now() - started;
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
        const thumb = await sharp(out.thumb).metadata();
        expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBe(512);
        expect((await sharp(out.developed).metadata()).format).toBe("jpeg");
        // A thumbhash is about 25 bytes, so the gallery can carry one for every photo.
        expect(Buffer.from(out.placeholder, "base64").length).toBeLessThan(40);
        expect(ms).toBeLessThan(1500);
    });
});
