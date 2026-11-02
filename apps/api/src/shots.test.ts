import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, guests, shots, startQueue, stopQueue } from "./db.ts";
import { developImage, developShot, releaseExpired } from "./shots.ts";
import { exists, keys } from "./storage.ts";
import { call, join, newEvent, newHost, samplePhoto, shoot, upload } from "./testing.ts";

beforeAll(startQueue);
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

        // Two of them were made eleven minutes ago; one of those had even started uploading.
        const stale = new Date(Date.now() - 11 * 60_000);
        for (const r of reserved.slice(0, 2)) {
            await db
                .update(shots)
                .set({ reservedAt: stale })
                .where(eq(shots.id, String(r.body.shotId)));
        }
        expect(await upload(String(reserved[0]?.body.uploadUrl), await samplePhoto())).toBe(200);
        expect(await releaseExpired()).toBeGreaterThanOrEqual(2);

        const me = await call("GET", `/v1/e/${event.code}/me`, { device: guest.device });
        expect(me.body.shotsLeft).toBe(2);
        const again = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
        expect(again.status).toBe(201);
        const late = await call("POST", `/v1/shots/${String(reserved[0]?.body.shotId)}/confirm`, {
            device: guest.device,
        });
        expect(late.body.code).toBe("reservation-expired");
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
        expect(await exists(keys.shot(event.id, id, "original"))).toBe(false);
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
        expect(ms).toBeLessThan(1500);
    });
});
