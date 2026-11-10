import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
    DEMO_CODE,
    DEMO_EMAIL,
    DEMO_PERSONAS,
    deleteExpiredSessions,
    fixedCode,
    reviewAccount,
} from "./accounts.ts";
import { launchGaps, productionProblems } from "./http.ts";
import {
    db,
    emailCodes,
    events,
    hosts,
    pushTokens,
    sessions,
    startQueue,
    stopQueue,
} from "./db.ts";
import { startDeletionWorkers } from "./deletion.ts";
import { push } from "./notify.ts";
import { cancelReveal } from "./reveal.ts";
import {
    call,
    join,
    newDevice,
    newEvent,
    newHost,
    samplePhoto,
    shoot,
    upload,
    waitFor,
} from "./testing.ts";
import { keys, list } from "./storage.ts";

beforeAll(async () => {
    await startQueue();
    await startDeletionWorkers();
});
afterAll(stopQueue);

const MAILPIT = "http://localhost:8176";

async function codeFor(email: string): Promise<string> {
    for (let i = 0; i < 25; i++) {
        const res = await fetch(
            `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        const data = (await res.json()) as { messages?: { Subject: string }[] };
        const subject = data.messages?.[0]?.Subject;
        const code = subject?.match(/^(\d{6}) /)?.[1];
        if (code) return code;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`No email for ${email}`);
}

describe("the App Review login", () => {
    test("signs in with the fixed code, sends no email, and is off until both are set", async () => {
        const email = `review-${randomBytes(4).toString("hex")}@example.com`;
        expect(reviewAccount({ REVIEW_EMAIL: email })).toBe(null);
        expect(reviewAccount({ REVIEW_EMAIL: email, REVIEW_CODE: "12ab56" })).toBe(null);
        process.env.REVIEW_EMAIL = email;
        process.env.REVIEW_CODE = "246810";
        try {
            for (let i = 0; i < 5; i++) {
                const start = await call("POST", "/v1/auth/email/start", { json: { email } });
                expect(start.status).toBe(200);
            }
            const wrong = await call("POST", "/v1/auth/email/verify", {
                json: { email, code: "111111" },
            });
            expect(wrong.status).toBe(400);
            const ok = await call("POST", "/v1/auth/email/verify", {
                json: { email, code: "246810" },
            });
            expect(ok.status).toBe(200);
            const mail = await fetch(
                `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
            );
            expect(((await mail.json()) as { messages?: unknown[] }).messages ?? []).toHaveLength(
                0,
            );
        } finally {
            delete process.env.REVIEW_EMAIL;
            delete process.env.REVIEW_CODE;
        }
    });

    test("the local demo hosts sign in through the email form with the demo code", async () => {
        expect(fixedCode(DEMO_PERSONAS.half.email)).toBe(DEMO_CODE);
        expect(fixedCode("someone@example.com")).toBe(null);
        const start = await call("POST", "/v1/auth/email/start", { json: { email: DEMO_EMAIL } });
        expect(start.status).toBe(200);
        const ok = await call("POST", "/v1/auth/email/verify", {
            json: { email: DEMO_EMAIL, code: DEMO_CODE },
        });
        expect(ok.status).toBe(200);
        expect(ok.body.host).toMatchObject({ email: DEMO_EMAIL });
    });

    test("production refuses a review email without a six-digit code", () => {
        const base = {
            SESSION_SECRET: "x".repeat(32),
            S3_ENDPOINT: "https://r2",
            S3_ACCESS_KEY_ID: "id",
            S3_SECRET_ACCESS_KEY: "secret",
            SMTP_URL: "smtp://mail",
        };
        expect(productionProblems(base)).toEqual([]);
        expect(productionProblems({ ...base, REVIEW_EMAIL: "review@lingercam.app" })).toContain(
            "REVIEW_CODE",
        );
        expect(
            productionProblems({
                ...base,
                REVIEW_EMAIL: "review@lingercam.app",
                REVIEW_CODE: "135790",
            }),
        ).toEqual([]);
    });

    test("names what a store launch still needs, without refusing to start", () => {
        expect(launchGaps({})).toEqual([
            "REVENUECAT_SECRET_KEY",
            "REVENUECAT_WEBHOOK_AUTH",
            "EXPO_ACCESS_TOKEN",
        ]);
        expect(
            launchGaps({
                REVENUECAT_SECRET_KEY: "sk",
                REVENUECAT_WEBHOOK_AUTH: "auth",
                EXPO_ACCESS_TOKEN: "token",
            }),
        ).toEqual([]);
    });
});

describe("email sign-in", () => {
    test("sends a six digit code that signs the host in once", async () => {
        const email = `Signin-${randomBytes(4).toString("hex")}@Example.com`;
        const start = await call("POST", "/v1/auth/email/start", { json: { email } });
        expect(start.body).toEqual({ sent: true, expiresInMinutes: 10 });
        const code = await codeFor(email.toLowerCase());

        const [stored] = await db
            .select()
            .from(emailCodes)
            .where(eq(emailCodes.email, email.toLowerCase()));
        expect(stored?.codeHash).not.toContain(code);

        const wrong = await call("POST", "/v1/auth/email/verify", {
            json: { email, code: code === "000000" ? "111111" : "000000" },
        });
        expect(wrong.body.code).toBe("wrong-code");

        const ok = await call("POST", "/v1/auth/email/verify", {
            json: { email, code, name: "Ines" },
        });
        expect(ok.status).toBe(200);
        expect(ok.body.host?.email).toBe(email.toLowerCase());
        expect(ok.body.host?.name).toBe("Ines");
        const token = String(ok.body.session);
        expect((await call("GET", "/v1/me", { token })).body.host?.name).toBe("Ines");

        const reused = await call("POST", "/v1/auth/email/verify", { json: { email, code } });
        expect(reused.body.code).toBe("code-expired");
    });

    test("an expired code is refused, and a sixth guess reads as locked", async () => {
        const email = `late-${randomBytes(4).toString("hex")}@example.com`;
        await call("POST", "/v1/auth/email/start", { json: { email } });
        const code = await codeFor(email);
        await db.update(emailCodes).set({ attempts: 5 }).where(eq(emailCodes.email, email));
        expect(
            (await call("POST", "/v1/auth/email/verify", { json: { email, code } })).body.code,
        ).toBe("code-locked");
        await call("POST", "/v1/auth/email/start", { json: { email } });
        await db
            .update(emailCodes)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(emailCodes.email, email));
        expect(
            (
                await call("POST", "/v1/auth/email/verify", {
                    json: { email, code: await codeFor(email) },
                })
            ).body.code,
        ).toBe("code-expired");
    });

    test("parallel guesses can't get past the attempt limit", async () => {
        const email = `burst-${randomBytes(4).toString("hex")}@example.com`;
        await call("POST", "/v1/auth/email/start", { json: { email } });
        const real = await codeFor(email);
        const wrong = (i: number) => String((Number(real) + 1 + i) % 1_000_000).padStart(6, "0");
        const replies = await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                call("POST", "/v1/auth/email/verify", { json: { email, code: wrong(i) } }),
            ),
        );
        const codes = replies.map((r) => String(r.body.code));
        expect(codes.filter((c) => c === "wrong-code")).toHaveLength(5);
        expect(codes.filter((c) => c === "code-locked")).toHaveLength(15);
        const late = await call("POST", "/v1/auth/email/verify", { json: { email, code: real } });
        expect(late.body.code).toBe("code-locked");
    });

    test("an address can ask for only a few codes at a time", async () => {
        const email = `many-${randomBytes(4).toString("hex")}@example.com`;
        const replies = [];
        for (let i = 0; i < 4; i++) {
            replies.push(await call("POST", "/v1/auth/email/start", { json: { email } }));
        }
        expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 429]);
        expect(replies[3]?.body.code).toBe("too-many");
    });

    test("rejects a malformed email", async () => {
        const res = await call("POST", "/v1/auth/email/start", { json: { email: "not-an-email" } });
        expect(res.status).toBe(400);
    });
});

describe("the demo host and the profile", () => {
    test("demo sign-in works outside production and returns the same host", async () => {
        const a = await call("POST", "/v1/auth/demo");
        const b = await call("POST", "/v1/auth/demo");
        expect(a.body.host?.email).toBe(DEMO_EMAIL);
        expect(a.body.host?.id).toBe(b.body.host?.id);
        expect(a.body.session).not.toBe(b.body.session);
    });

    test("the name can change, and sign-out ends the session", async () => {
        const { token } = await newHost();
        const renamed = await call("PATCH", "/v1/me", { token, json: { name: "Hana" } });
        expect(renamed.body.host?.name).toBe("Hana");
        expect((await call("POST", "/v1/auth/sign-out", { token })).status).toBe(204);
        expect((await call("GET", "/v1/me", { token })).status).toBe(401);
    });

    test("signing out stops this device getting the host's pushes", async () => {
        const { token, hostId } = await newHost();
        const device = newDevice();
        const pushToken = `ExponentPushToken[${randomBytes(6).toString("hex")}]`;
        await call("POST", "/v1/push", { token, device, json: { token: pushToken } });
        await call("POST", "/v1/auth/sign-out", { token, device });
        const [row] = await db.select().from(pushTokens).where(eq(pushTokens.token, pushToken));
        expect(row).toMatchObject({ hostId: null, device });
        expect(hostId).toBeTruthy();
    });

    test("sessions expire when unused, and using one keeps it alive", async () => {
        const { token, hostId } = await newHost();
        await db
            .update(sessions)
            .set({ expiresAt: new Date(Date.now() + 60_000) })
            .where(eq(sessions.hostId, hostId));
        expect((await call("GET", "/v1/me", { token })).status).toBe(200);
        const [renewed] = await db.select().from(sessions).where(eq(sessions.hostId, hostId));
        expect(renewed?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
        await db
            .update(sessions)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(sessions.hostId, hostId));
        expect((await call("GET", "/v1/me", { token })).status).toBe(401);
        expect(await deleteExpiredSessions()).toBeGreaterThanOrEqual(1);
        expect(await db.select().from(sessions).where(eq(sessions.hostId, hostId))).toEqual([]);
    });
});

describe("account deletion", () => {
    test("DELETE /v1/me removes the host's rows and every stored object", async () => {
        const { token, hostId } = await newHost();
        const event = await newEvent(token, { live: true });
        const cover = await call("POST", `/v1/events/${event.id}/cover`, { token });
        await upload(String(cover.body.uploadUrl), await samplePhoto());
        const guest = await join(event.code);
        await shoot(event.code, guest.device);
        expect((await list(keys.event(event.id))).length).toBeGreaterThanOrEqual(2);

        const device = newDevice();
        const guestToken = `ExponentPushToken[${randomBytes(6).toString("hex")}]`;
        await call("POST", "/v1/push", { device, json: { token: guestToken } });
        const guestPhone = `ExponentPushToken[${randomBytes(6).toString("hex")}]`;
        await call("POST", "/v1/push", { device: guest.device, json: { token: guestPhone } });

        const sent: string[] = [];
        const send = push.send;
        push.send = async (messages) => {
            for (const m of messages) if (m.data?.type === "deleted") sent.push(String(m.to));
            return [];
        };
        try {
            expect((await call("DELETE", "/v1/me", {})).status).toBe(401);
            expect((await call("DELETE", "/v1/me", { token, device })).status).toBe(204);
        } finally {
            push.send = send;
        }
        // Each event was torn down: guests' reminders are cancelled and its checks are gone.
        expect(sent).toContain(guestPhone);
        expect(await cancelReveal(event.id)).toBe(0);
        expect(await db.select().from(pushTokens).where(eq(pushTokens.token, guestToken))).toEqual(
            [],
        );
        await waitFor(async () => (await list(keys.event(event.id))).length === 0);
        expect(await db.select().from(hosts).where(eq(hosts.id, hostId))).toEqual([]);
        expect(await db.select().from(events).where(eq(events.id, event.id))).toEqual([]);
        expect((await call("GET", "/v1/me", { token })).status).toBe(401);
    });
});
