import { defineConfig } from "vitest/config";

// Integration tests run against the docker compose services, on their own database and bucket.
const env = {
    NODE_ENV: "test",
    DEV_ROUTES: "1",
    LOG_SILENT: "1",
    DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://linger:linger@localhost:8172/linger_test",
    S3_BUCKET: process.env.S3_TEST_BUCKET ?? "linger-test",
    EXPO_ACCESS_TOKEN: "",
    REVENUECAT_SECRET_KEY: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    REVENUECAT_WEBHOOK_AUTH: "test-webhook-auth",
};
Object.assign(process.env, env);

export default defineConfig({
    test: {
        env,
        globalSetup: ["./src/testing.ts"],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
