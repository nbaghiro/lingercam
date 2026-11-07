import { expect, test, type Page } from "@playwright/test";

// The web build's root is the guest home, and host routes point to the apps: one button per store,
// each with its own destination. Code entry and the joined list belong to guest.e2e.ts.

const SITE = "http://localhost:8170";

/** Records the URLs the page asks the browser to open, without leaving the page. */
async function recordOpens(page: Page): Promise<() => Promise<string[]>> {
    await page.addInitScript(() => {
        const opened: string[] = [];
        (globalThis as unknown as { opened: string[] }).opened = opened;
        globalThis.open = (url?: string | URL) => {
            opened.push(String(url ?? ""));
            return null;
        };
    });
    return () => page.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}

test("the web root is the guest home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Have a code?").first()).toBeVisible();
    await expect(page.getByText(/LingerCam gives every guest at an event a camera/)).toBeVisible();
    await expect(page.getByText("Hosting happens in the app")).toHaveCount(0);

    const opened = await recordOpens(page);
    await page.reload();
    await page.getByText("About LingerCam").click();
    // The browser opens the site's root with its trailing slash.
    await expect.poll(opened).toContain(`${SITE}/`);
});

test("host routes send each store button to its own place", async ({ page }) => {
    const opened = await recordOpens(page);
    for (const path of ["/settings", "/new"]) {
        await page.goto(path);
        await expect(page.getByText("Hosting happens in the app")).toBeVisible();
    }
    await page.getByText("Download on the App Store").click();
    await page.getByText("Get it on Google Play").click();
    await expect.poll(async () => (await opened()).length).toBe(2);
    const [appStore, playStore] = await opened();
    // Without listing URLs in the environment both go to the support page's app section, never
    // to the site's front page.
    for (const url of [appStore, playStore]) {
        expect(url).not.toBe(SITE);
        expect(url).toMatch(
            /^https:\/\/(apps\.apple\.com|play\.google\.com)\/|\/support\/#get-the-app$/,
        );
    }
});
