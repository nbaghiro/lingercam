import { defineConfig, devices } from "@playwright/test";

// The web end-to-end run: the API on 8171 and the Expo web app on 8173, with the docker compose
// services already up. Servers that are already running are reused.

export default defineConfig({
    testDir: "apps",
    testMatch: "**/*.e2e.ts",
    timeout: 300_000,
    expect: { timeout: 20_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 430, height: 932 },
        baseURL: "http://localhost:8173",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        launchOptions: {
            args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
    },
    webServer: [
        {
            command: "pnpm --filter api start",
            url: "http://localhost:8171/health",
            reuseExistingServer: true,
            timeout: 120_000,
        },
        {
            command: "pnpm --filter app web",
            url: "http://localhost:8173",
            reuseExistingServer: true,
            timeout: 180_000,
            env: { CI: "1" },
        },
    ],
});
