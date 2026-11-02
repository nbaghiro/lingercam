import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { accounts, startAccountWorkers } from "./accounts.ts";
import { billing } from "./billing.ts";
import { migrate, sql, startQueue, stopQueue } from "./db.ts";
import { eventRoutes } from "./events.ts";
import { ApiError, errorDetail, isProduction, log, productionProblems } from "./http.ts";
import { revealOverdue, startRevealWorker } from "./reveal.ts";
import { releaseExpired, shotRoutes, startShotWorkers } from "./shots.ts";
import { healthy as storageHealthy } from "./storage.ts";

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:8173,http://localhost:8170")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

export function createApp(): Hono {
    const app = new Hono();

    app.use("*", async (c, next) => {
        const started = performance.now();
        await next();
        if (c.req.path === "/health") return;
        log("info", "request", {
            method: c.req.method,
            // Join codes open events, so they stay out of the logs.
            path: c.req.path.replace(/^\/v1\/e\/[^/]+/, "/v1/e/:code"),
            status: c.res.status,
            ms: Math.round(performance.now() - started),
        });
    });

    app.use(
        "*",
        cors({
            origin: origins,
            allowHeaders: ["Authorization", "Content-Type", "X-Device"],
            allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            maxAge: 600,
        }),
    );

    app.use(
        "*",
        bodyLimit({
            maxSize: 256 * 1024,
            onError: (c) =>
                c.json({ code: "too-large", message: "The request body is too large." }, 413),
        }),
    );

    app.get("/health", async (c) => {
        const database = await sql`select 1`.then(
            () => true,
            () => false,
        );
        const storage = await storageHealthy();
        return c.json(
            { ok: database && storage, database, storage },
            database && storage ? 200 : 503,
        );
    });

    app.route("/", accounts);
    app.route("/", eventRoutes);
    app.route("/", shotRoutes);
    app.route("/", billing);

    app.notFound((c) => c.json({ code: "not-found", message: "Not found." }, 404));

    app.onError((error, c) => {
        if (error instanceof ApiError) {
            return c.json({ code: error.code, message: error.message }, error.status);
        }
        if (error instanceof HTTPException) {
            return c.json({ code: "http-error", message: error.message }, error.status);
        }
        log("error", "unhandled error", { path: c.req.path, error: errorDetail(error) });
        return c.json({ code: "server-error", message: "Something went wrong on our side." }, 500);
    });

    return app;
}

/** Starts the job workers and catches up on anything that fell due while the server was down. */
export async function startWorkers(): Promise<void> {
    await startQueue();
    await startAccountWorkers();
    await startShotWorkers();
    await startRevealWorker();
    const revealed = await revealOverdue();
    const released = await releaseExpired();
    if (revealed + released > 0) log("info", "caught up", { revealed, released });
}

async function main(): Promise<void> {
    const missing = isProduction ? productionProblems() : [];
    if (missing.length > 0) {
        log("error", "refusing to start: production settings are missing or local defaults", {
            missing,
        });
        process.exit(1);
    }
    await migrate();
    await startWorkers();
    const port = Number(process.env.PORT ?? 8171);
    const server = serve({ fetch: createApp().fetch, port }, (info) =>
        log("info", "api listening", { port: info.port }),
    );
    const shutdown = (signal: string) => {
        log("info", "shutting down", { signal });
        server.close();
        stopQueue()
            .then(() => sql.end({ timeout: 5 }))
            .catch((error: unknown) =>
                log("error", "shutdown failed", { error: errorDetail(error) }),
            )
            .finally(() => process.exit(0));
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.main) {
    await main();
}
