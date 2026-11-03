import { defineConfig, devices } from "@playwright/test";

// The web end-to-end run: the site on 8170, the API on 8171 and the Expo web app on 8173, with the
// docker compose services already up. Servers that are already running are reused.
// E2E_SITE_URL, E2E_API_URL and E2E_APP_URL point the run at servers started elsewhere.

const site = process.env.E2E_SITE_URL ?? "http://127.0.0.1:8170";
const api = process.env.E2E_API_URL ?? "http://localhost:8171";
const app = process.env.E2E_APP_URL ?? "http://localhost:8173";

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
        baseURL: app,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        launchOptions: {
            args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
    },
    webServer: [
        {
            command: "pnpm --filter site dev",
            url: site,
            reuseExistingServer: true,
            timeout: 120_000,
        },
        {
            command: "pnpm --filter api start",
            url: `${api}/health`,
            reuseExistingServer: true,
            timeout: 120_000,
        },
        {
            command: "pnpm --filter app web",
            url: app,
            reuseExistingServer: true,
            timeout: 180_000,
            env: { CI: "1" },
        },
    ],
});
