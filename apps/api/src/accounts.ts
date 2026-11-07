import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { NAME_MAX } from "@linger/core/events";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { boss, db, emailCodes, events, guests, hosts, pushTokens, sessions } from "./db.ts";
import { ApiError, body, clientIp, deviceOf, devRoutes, limiter, log, maskEmail } from "./http.ts";
import { mail } from "./notify.ts";
import { keys, removePrefix } from "./storage.ts";

export const DEMO_EMAIL = "demo@lingercam.app";

/** The App Review login, when REVIEW_EMAIL and a six-digit REVIEW_CODE are both set. */
export function reviewAccount(env = process.env): { email: string; code: string } | null {
    const email = env.REVIEW_EMAIL?.trim().toLowerCase();
    const code = env.REVIEW_CODE?.trim();
    if (!email || !code || !/^\d{6}$/.test(code)) return null;
    return { email, code };
}
export const DEMO_NAME = "Alex Morgan";
/** The other demo hosts: one with no events yet and one partway in. */
export const DEMO_PERSONAS = {
    new: { email: "new@lingercam.app", name: "Sam Rivera" },
    half: { email: "half@lingercam.app", name: "Jordan Lee" },
} as const;
/**
 * In development the seeded demo hosts sign in through the email form with this code, and no email
 * goes out. Production never has DEV_ROUTES, so the code works nowhere else.
 */
export const DEMO_CODE = "000000";
const DEMO_EMAILS: readonly string[] = [
    DEMO_EMAIL,
    DEMO_PERSONAS.new.email,
    DEMO_PERSONAS.half.email,
];

/** The fixed code an email signs in with, if it has one: the review login or a local demo host. */
export function fixedCode(email: string): string | null {
    const review = reviewAccount();
    if (review !== null && email === review.email) return review.code;
    if (devRoutes && DEMO_EMAILS.includes(email)) return DEMO_CODE;
    return null;
}
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
export const SESSION_DAYS = 90;

const DAY_MS = 86_400_000;
// A code has a million values and five guesses; these keep the total guesses per address small.
const startsPerEmail = limiter("start-email", 3, 15 * 60_000);
const startsPerEmailDay = limiter("start-email-day", 10, DAY_MS);
const startsPerIp = limiter("start-ip", 20, 15 * 60_000);
const verifiesPerIp = limiter("verify-ip", 50, 15 * 60_000);

const secret = process.env.SESSION_SECRET || "local-development-only";

export type Host = typeof hosts.$inferSelect;

export function hostJson(host: Host) {
    return {
        id: host.id,
        email: host.email,
        name: host.name,
        createdAt: host.createdAt.toISOString(),
    };
}

function hashCode(email: string, code: string): string {
    return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Who a sign-in email belongs to, before they pick a name. */
function nameFromEmail(email: string): string {
    const local = email.split("@")[0] ?? "";
    const word = local.split(/[._+-]/)[0] ?? "";
    return word ? word[0]?.toUpperCase() + word.slice(1, NAME_MAX) : "Host";
}

export async function createSession(hostId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ tokenHash: hashToken(token), hostId });
    return token;
}

function bearer(c: Context): string | null {
    return c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

const sessionEnd = () => sql`now() + make_interval(days => ${SESSION_DAYS})`;

/**
 * The signed-in host, or null when there is no valid bearer token. Using a session keeps it alive
 * for another SESSION_DAYS; one left unused that long stops working.
 */
export async function currentHost(c: Context): Promise<Host | null> {
    const token = bearer(c);
    if (!token) return null;
    const [row] = await db
        .update(sessions)
        .set({ expiresAt: sessionEnd() })
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
        .returning({ hostId: sessions.hostId });
    if (!row) return null;
    const [host] = await db.select().from(hosts).where(eq(hosts.id, row.hostId));
    return host ?? null;
}

export async function deleteExpiredSessions(): Promise<number> {
    const gone = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, sql`now()`))
        .returning({ hostId: sessions.hostId });
    return gone.length;
}

export async function startAccountWorkers(): Promise<void> {
    await boss.work("expire-sessions", async () => {
        await deleteExpiredSessions();
    });
    await boss.schedule("expire-sessions", "17 * * * *");
}

/** The device value of a host's own guest row. X-Device can't carry a colon, so no device can. */
export function hostDevice(hostId: string): string {
    return `host:${hostId}`;
}

export async function requireHost(c: Context): Promise<Host> {
    const host = await currentHost(c);
    if (!host) throw new ApiError(401, "signed-out", "Sign in to continue.");
    return host;
}

export async function findOrCreateHost(email: string, name?: string): Promise<Host> {
    const [created] = await db
        .insert(hosts)
        .values({ email, name: name ?? nameFromEmail(email) })
        .onConflictDoNothing({ target: hosts.email })
        .returning();
    if (created) return created;
    const [found] = await db.select().from(hosts).where(eq(hosts.email, email));
    if (!found) throw new Error(`Host ${email} vanished`);
    return found;
}

/**
 * Deletes the host's stored photos, then the host; every row cascades from it, including push
 * tokens registered while signed in. `device` also removes the tokens this device registered as a
 * guest.
 */
export async function deleteHost(hostId: string, device: string | null = null): Promise<void> {
    const owned = await db.select({ id: events.id }).from(events).where(eq(events.hostId, hostId));
    for (const event of owned) await removePrefix(keys.event(event.id));
    if (device) await db.delete(pushTokens).where(eq(pushTokens.device, device));
    await db.delete(hosts).where(eq(hosts.id, hostId));
}

const Email = z.string().trim().toLowerCase().pipe(z.email());

export const accounts = new Hono();

accounts.post("/v1/auth/email/start", async (c) => {
    const { email } = await body(c, z.object({ email: Email }));
    startsPerIp.take(clientIp(c));
    // App Review (REVIEW_EMAIL and REVIEW_CODE) and the local demo hosts sign in with a fixed code
    // and no email. They may sign in many times, so the per-email limits don't apply.
    const fixed = fixedCode(email);
    if (fixed === null) {
        startsPerEmail.take(email);
        startsPerEmailDay.take(email);
    }
    const code = fixed ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
    const codeHash = hashCode(email, code);
    await db
        .insert(emailCodes)
        .values({ email, codeHash, expiresAt })
        .onConflictDoUpdate({
            target: emailCodes.email,
            set: { codeHash, expiresAt, attempts: 0 },
        });
    if (fixed !== null) return c.json({ sent: true, expiresInMinutes: CODE_MINUTES });
    try {
        await mail.send({
            to: email,
            subject: `${code} is your LingerCam code`,
            text: `Your LingerCam sign-in code is ${code}.\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.\n`,
        });
    } catch (error) {
        log("error", "sign-in email failed", { email: maskEmail(email), error: String(error) });
        throw new ApiError(502, "email-failed", "We couldn't send the email. Try again soon.");
    }
    return c.json({ sent: true, expiresInMinutes: CODE_MINUTES });
});

accounts.post("/v1/auth/email/verify", async (c) => {
    const input = await body(
        c,
        z.object({
            email: Email,
            code: z.string().regex(/^\d{6}$/),
            name: z.string().trim().min(1).max(NAME_MAX).optional(),
        }),
    );
    verifiesPerIp.take(clientIp(c));
    // The attempt is counted before the code is compared, in one statement, so parallel guesses
    // can't get past the limit.
    const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(
            and(
                eq(emailCodes.email, input.email),
                lt(emailCodes.attempts, CODE_ATTEMPTS),
                gt(emailCodes.expiresAt, sql`now()`),
            ),
        )
        .returning({ codeHash: emailCodes.codeHash });
    if (!row) {
        const [held] = await db
            .select({ attempts: emailCodes.attempts })
            .from(emailCodes)
            .where(and(eq(emailCodes.email, input.email), gt(emailCodes.expiresAt, sql`now()`)));
        if (held && held.attempts >= CODE_ATTEMPTS) {
            throw new ApiError(
                400,
                "code-locked",
                "That code had too many wrong tries. Ask for a new one.",
            );
        }
        throw new ApiError(400, "code-expired", "That code has expired. Ask for a new one.");
    }
    const expected = Buffer.from(row.codeHash, "hex");
    const given = Buffer.from(hashCode(input.email, input.code), "hex");
    if (!timingSafeEqual(expected, given)) {
        throw new ApiError(400, "wrong-code", "That code doesn't match. Check the email again.");
    }
    await db.delete(emailCodes).where(eq(emailCodes.email, input.email));
    const host = await findOrCreateHost(input.email, input.name);
    return c.json({ session: await createSession(host.id), host: hostJson(host) });
});

accounts.post("/v1/auth/demo", async (c) => {
    if (!devRoutes) throw new ApiError(404, "not-found", "Not found.");
    const as = c.req.query("as");
    const persona = as === "new" || as === "half" ? DEMO_PERSONAS[as] : null;
    const host = persona
        ? await findOrCreateHost(persona.email, persona.name)
        : await findOrCreateHost(DEMO_EMAIL, DEMO_NAME);
    return c.json({ session: await createSession(host.id), host: hostJson(host) });
});

accounts.post("/v1/auth/demo-guest", async (c) => {
    if (!devRoutes) throw new ApiError(404, "not-found", "Not found.");
    const device = deviceOf(c);
    if (!device) throw new ApiError(400, "no-device", "This needs a device.");
    // Loaded here so the seed, which reads this file, isn't loaded with every request.
    const { adoptSeedGuests, leaveSeedGuests } = await import("./seed.ts");
    if (c.req.query("leave") === "1") {
        await leaveSeedGuests(device);
        return c.json({ codes: [] });
    }
    return c.json({ codes: await adoptSeedGuests(device) });
});

accounts.post("/v1/auth/sign-out", async (c) => {
    const token = bearer(c);
    if (!token) return c.body(null, 204);
    const [ended] = await db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)))
        .returning({ hostId: sessions.hostId });
    const device = deviceOf(c);
    // This device stops getting the host's reveal pushes; it keeps the ones for events it joined.
    if (ended && device) {
        await db
            .update(pushTokens)
            .set({ hostId: null })
            .where(and(eq(pushTokens.device, device), eq(pushTokens.hostId, ended.hostId)));
    }
    return c.body(null, 204);
});

accounts.get("/v1/me", async (c) => c.json({ host: hostJson(await requireHost(c)) }));

accounts.patch("/v1/me", async (c) => {
    const host = await requireHost(c);
    const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(NAME_MAX) }));
    const [updated] = await db.update(hosts).set({ name }).where(eq(hosts.id, host.id)).returning();
    // The name the host shoots under at their own events follows the profile.
    await db
        .update(guests)
        .set({ name })
        .where(and(eq(guests.device, hostDevice(host.id)), eq(guests.isHost, true)));
    return c.json({ host: hostJson(updated ?? host) });
});

accounts.delete("/v1/me", async (c) => {
    const host = await requireHost(c);
    await deleteHost(host.id, deviceOf(c));
    log("info", "host deleted", { hostId: host.id });
    return c.body(null, 204);
});
