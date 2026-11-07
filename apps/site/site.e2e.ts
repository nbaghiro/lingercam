import { expect, test } from "@playwright/test";

// The marketing site on 8170 and the guest web app's shell on 8173: the copy says what ships, the
// Try LingerCam code opens the guest home, unknown paths read as missing pages, and the join domain
// serves its link files and preview tags.

const SITE = process.env.E2E_SITE_URL ?? "http://127.0.0.1:8170";
const JOIN = process.env.E2E_APP_URL ?? "http://localhost:8173";
const API = process.env.E2E_API_URL ?? "http://localhost:8171";
/** A seeded event (`pnpm --filter api seed`). */
const SEEDED_CODE = "EMMADN";

test.describe("site", () => {
    test("the hero and the acts describe what ships", async ({ page }) => {
        await page.goto(`${SITE}/`);
        await expect(page.locator(".hero h1")).toHaveText(
            /Every guest gets a camera\.\s*Everyone gets the night\./,
        );
        await expect(page.locator("#shoot")).toContainText(
            "Guests join from the QR code in their browser, or in the app if they have it.",
        );
        await expect(page.locator("#shoot")).toContainText(
            "A Live Activity for guests with the iPhone app",
        );
        await expect(page.locator("body")).not.toContainText("App Clip");
        await expect(page.locator("#pricing")).toContainText("Free");
        await expect(page.locator("#pricing")).not.toContainText("$0.00");
    });

    test("each nav tab has its own page, and the home sections link to them", async ({ page }) => {
        const pages: [string, RegExp][] = [
            ["/how-it-works/", /How LingerCam works/],
            ["/guests/", /Guests join with a name/],
            ["/reveal/", /The reveal/],
            ["/pricing/", /Pay once, by guest count/],
            ["/questions/", /Questions/],
        ];
        for (const [path, heading] of pages) {
            await page.goto(`${SITE}${path}`);
            await expect(page.locator("main h1")).toHaveText(heading);
            await expect(page.locator(`.nav a[href="${path}"]`)).toHaveAttribute(
                "aria-current",
                "page",
            );
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        }

        await page.goto(`${SITE}/`);
        for (const [section, path] of [
            ["#setup", "/how-it-works/"],
            ["#shoot", "/guests/"],
            ["#reveal", "/reveal/"],
            ["#pricing", "/pricing/"],
            ["#faq", "/questions/"],
        ]) {
            await expect(page.locator(`${section} a.more`)).toHaveAttribute("href", path);
        }
        // The home page keeps its seven questions; the Questions page has them all, by topic.
        await expect(page.locator("#faq details")).toHaveCount(7);
        await page.goto(`${SITE}/questions/`);
        expect(await page.locator("main details").count()).toBeGreaterThan(20);
        await page.getByText("I arrived after the camera closed").click();
        await expect(page.locator("main")).toContainText("someone new can still join the event");
    });

    test("Try LingerCam opens the guest home on the join domain", async ({ page }) => {
        await page.goto(`${SITE}/`);
        const link = page.locator(".try a.qr");
        await expect(link).toHaveAttribute("href", "https://join.lingercam.app/");
        await expect(page.locator(".try")).toContainText("Have a code?");
    });

    test("privacy covers the guest's optional email", async ({ page }) => {
        await page.goto(`${SITE}/privacy/`);
        await expect(page.locator("main")).toContainText("Email address, if you leave one.");
        // Markdown turns the apostrophe into a typographic one.
        await expect(page.locator("main")).toContainText(
            /A guest['’]s email address is kept with their place in the event/,
        );
    });

    test("support describes the hosting tools the app has", async ({ page }) => {
        await page.goto(`${SITE}/support/`);
        const main = page.locator("main");
        await expect(main).toContainText("tap Manage");
        await expect(main).toContainText("Can I end the event early?");
        await expect(main).toContainText("How do I delete an event?");
    });
});

test.describe("join domain", () => {
    test("serves the universal link and app link files as JSON", async ({ request }) => {
        const aasa = await request.get(`${JOIN}/.well-known/apple-app-site-association`);
        expect(aasa.ok()).toBe(true);
        const apple = (await aasa.json()) as {
            applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] };
        };
        const detail = apple.applinks.details[0];
        expect(detail?.appIDs[0]).toMatch(/\.app\.galleo\.linger$/);
        expect(detail?.components.map((c) => c["/"])).toEqual(
            expect.arrayContaining(["/??????", "/j/*"]),
        );

        const links = await request.get(`${JOIN}/.well-known/assetlinks.json`);
        expect(links.ok()).toBe(true);
        expect(links.headers()["content-type"]).toContain("json");
        const android = (await links.json()) as { target: { package_name: string } }[];
        expect(android[0]?.target.package_name).toBe("app.galleo.linger");
    });

    test("the page shell fits the screen and names the app", async ({ request }) => {
        const html = await (await request.get(`${JOIN}/`)).text();
        expect(html).toContain("viewport-fit=cover");
        expect(html).toContain('name="description"');
        expect(html).toContain('rel="apple-touch-icon"');
        expect(html).toContain('name="theme-color"');
        const icon = await request.get(`${JOIN}/apple-touch-icon.png`);
        expect(icon.headers()["content-type"]).toContain("image/png");
    });

    test("a shared code link carries the event's preview tags", async ({ request }) => {
        const res = await request.get(`${API}/v1/e/${SEEDED_CODE}/page`);
        expect(res.ok()).toBe(true);
        const html = await res.text();
        // The title is HTML-escaped, so the apostrophe arrives as &#39;.
        expect(html).toMatch(
            /<meta property="og:title" content="You(?:'|&#39;)re invited to shoot [^"]+">/,
        );
        expect(html).toContain(
            '<meta property="og:description" content="Scan to join. No download needed.">',
        );
        // The rest of the page is the web app's own shell, so the link still opens the app.
        expect(html).toContain("viewport-fit=cover");
        expect(html).toContain('<div id="root">');
    });

    test("an unknown path says the page doesn't exist", async ({ page }) => {
        for (const path of ["/about", "/not/a/page"]) {
            await page.goto(`${JOIN}${path}`);
            await expect(page.getByText("This page doesn't exist")).toBeVisible();
            await expect(page.getByText("There's no event with that code")).toHaveCount(0);
        }
        await page.getByRole("button", { name: "Go to LingerCam" }).click();
        await expect(page).toHaveURL(`${JOIN}/`);
    });

    test("a code in the path still goes to the join route", async ({ page }) => {
        await page.goto(`${JOIN}/${SEEDED_CODE.toLowerCase()}`);
        await expect(page).toHaveURL(new RegExp(`/(j|e)/${SEEDED_CODE}`));
        await expect(page.getByText("This page doesn't exist")).toHaveCount(0);
    });
});
