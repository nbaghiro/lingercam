import { getConnInfo } from "@hono/node-server/conninfo";
import { DeviceId } from "@linger/core/events";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/** An error the client can act on. Rendered as `{ code, message }`. */
export class ApiError extends Error {
    readonly status: ContentfulStatusCode;
    readonly code: string;

    constructor(status: ContentfulStatusCode, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** "path: message" for the first problem zod found. */
export function issueMessage(error: z.ZodError): string {
    const issue = error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${where}${issue?.message ?? "Invalid request"}`;
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
    let raw: unknown;
    try {
        raw = await c.req.json();
    } catch {
        throw new ApiError(400, "invalid-json", "The request body isn't valid JSON.");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "invalid-request", issueMessage(parsed.error));
    return parsed.data;
}

/** The guest device id from `X-Device`, when it is well formed. */
export function deviceOf(c: Context): string | null {
    const device = c.req.header("x-device");
    return device && DeviceId.safeParse(device).success ? device : null;
}

/** The id from a route, or `missing` when it can't be one of our ids. */
export function uuidOr(id: string, missing: ApiError): string {
    if (!z.uuid().safeParse(id).success) throw missing;
    return id;
}

type Level = "info" | "warn" | "error";

/** One JSON line per entry, to stdout or stderr. */
export function log(level: Level, message: string, extra: Record<string, unknown> = {}): void {
    if (process.env.LOG_SILENT === "1" && level !== "error") return;
    const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...extra });
    (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
}

export function errorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** "a***@example.com", for logs. */
export function maskEmail(email: string): string {
    const [local = "", domain = ""] = email.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
}

export const isProduction = process.env.NODE_ENV === "production";

/** The demo sign-in and the development purchase claim. Off unless DEV_ROUTES=1. */
export const devRoutes = process.env.DEV_ROUTES === "1" && !isProduction;

const DEFAULT_SECRET = "local-development-only";

/** Settings production can't run without; each would otherwise fall back to a local default. */
export function productionProblems(env = process.env): string[] {
    const problems: string[] = [];
    if (!env.SESSION_SECRET || env.SESSION_SECRET === DEFAULT_SECRET) {
        problems.push("SESSION_SECRET");
    }
    for (const key of ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SMTP_URL"]) {
        if (!env[key]) problems.push(key);
    }
    if (env.S3_SECRET_ACCESS_KEY === "linger-local") problems.push("S3_SECRET_ACCESS_KEY");
    if (env.DEV_ROUTES === "1") problems.push("DEV_ROUTES");
    return problems;
}

/**
 * The caller's address. Behind Render's proxy (TRUST_PROXY=1) that is the last entry the proxy
 * appended to X-Forwarded-For; otherwise the socket's address.
 */
export function clientIp(c: Context): string {
    if (process.env.TRUST_PROXY === "1") {
        const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
        if (forwarded) return forwarded;
    }
    try {
        return getConnInfo(c).remote.address ?? "local";
    } catch {
        return "local";
    }
}

const hits = new Map<string, number[]>();

function recent(key: string, windowMs: number, now: number): number[] {
    const kept = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.size > 50_000) {
        for (const [k, times] of hits) if (now - (times.at(-1) ?? 0) > 86_400_000) hits.delete(k);
    }
    hits.set(key, kept);
    return kept;
}

/**
 * A sliding-window counter in memory, enough for one API instance. `check` refuses once `max`
 * hits are in the window; `hit` records one; `take` does both.
 */
export function limiter(name: string, max: number, windowMs: number) {
    const refuse = () =>
        new ApiError(429, "too-many", "That's a lot of tries. Wait a few minutes and try again.");
    return {
        check(id: string): void {
            if (recent(`${name}:${id}`, windowMs, Date.now()).length >= max) throw refuse();
        },
        hit(id: string): void {
            recent(`${name}:${id}`, windowMs, Date.now()).push(Date.now());
        },
        take(id: string): void {
            this.check(id);
            this.hit(id);
        },
    };
}
