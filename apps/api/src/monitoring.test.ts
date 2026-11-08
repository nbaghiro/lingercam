import { describe, expect, test } from "vitest";
import { productionProblems } from "./http.ts";
import { track, tracking } from "./monitoring.ts";

describe("error tracking", () => {
    test("is off without a DSN, and tracking is then a no-op", () => {
        expect(tracking).toBe(false);
        expect(() => track("a test error", { eventId: "e1" }, new Error("boom"))).not.toThrow();
    });

    test("production can start without it", () => {
        const env = {
            SESSION_SECRET: "a-real-secret",
            S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
            S3_ACCESS_KEY_ID: "key",
            S3_SECRET_ACCESS_KEY: "secret",
            SMTP_URL: "smtp://resend:key@smtp.resend.com:587",
        };
        expect(productionProblems(env)).toEqual([]);
    });
});
