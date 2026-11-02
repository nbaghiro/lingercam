import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startQueue, stopQueue } from "./db.ts";
import { app, call, newEvent, newHost } from "./testing.ts";

beforeAll(startQueue);
afterAll(stopQueue);

describe("server", () => {
    test("health checks the database and storage", async () => {
        const res = await call("GET", "/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, database: true, storage: true });
    });

    test("unknown routes answer in the error shape", async () => {
        const res = await call("GET", "/v1/nothing-here");
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ code: "not-found", message: "Not found." });
    });

    test("CORS allows the guest web app and the site, not other origins", async () => {
        for (const origin of ["http://localhost:8173", "http://localhost:8170"]) {
            const res = await app.request("/v1/pricing", {
                method: "OPTIONS",
                headers: { origin, "access-control-request-method": "POST" },
            });
            expect(res.headers.get("access-control-allow-origin")).toBe(origin);
        }
        const simple = await app.request("/health", {
            headers: { origin: "http://localhost:8173" },
        });
        expect(simple.headers.get("access-control-expose-headers")).toBe("Date");
        const evil = await app.request("/v1/pricing", { headers: { origin: "https://evil.test" } });
        expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    });

    test("every protected route refuses a caller with no credentials", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const shot = "00000000-0000-4000-8000-000000000000";
        const routes: [string, string][] = [
            ["GET", "/v1/me"],
            ["PATCH", "/v1/me"],
            ["DELETE", "/v1/me"],
            ["GET", "/v1/events"],
            ["POST", "/v1/events"],
            ["GET", `/v1/events/${event.id}`],
            ["PATCH", `/v1/events/${event.id}`],
            ["POST", `/v1/events/${event.id}/cover`],
            ["POST", `/v1/events/${event.id}/live`],
            ["POST", `/v1/events/${event.id}/end`],
            ["DELETE", `/v1/events/${event.id}`],
            ["GET", "/v1/joined"],
            ["GET", `/v1/e/${event.code}/me`],
            ["GET", `/v1/e/${event.code}/highlights`],
            ["POST", `/v1/e/${event.code}/email`],
            ["GET", `/v1/e/${event.code}/gallery`],
            ["GET", `/v1/e/${event.code}/people`],
            ["POST", `/v1/e/${event.code}/shots`],
            ["POST", `/v1/shots/${shot}/confirm`],
            ["POST", `/v1/shots/${shot}/like`],
            ["POST", `/v1/shots/${shot}/report`],
            ["POST", `/v1/shots/${shot}/hide`],
            ["DELETE", `/v1/shots/${shot}`],
            ["POST", "/v1/push"],
            ["POST", "/v1/billing/claim"],
            ["POST", "/v1/billing/checkout"],
            ["POST", "/v1/billing/dev-claim"],
        ];
        for (const [method, path] of routes) {
            const res = await call(method, path, { json: {} });
            expect([401, 403, 404, 410], `${method} ${path} gave ${res.status}`).toContain(
                res.status,
            );
        }
    });
});
