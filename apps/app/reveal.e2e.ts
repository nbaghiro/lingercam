import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// The reveal in the browser: the event screen before it (roll line, developing grid, "Now" at
// the reveal time), the moment from the server's highlights within seconds of the reveal, the
// labelled recap action, a photo held back across the reveal that appears once it sends, the
// same moment under reduced motion, and a right-away event that reads "Live" and then closes
// with "That's the night.".

const API = "http://localhost:8171";
const MAILPIT = "http://localhost:8176";
const SHOTS = 5;

interface Json {
    [key: string]: unknown;
}

async function call(
    method: string,
    path: string,
    auth?: { token?: string; device?: string },
    body?: unknown,
): Promise<Json> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(auth?.token ? { authorization: `Bearer ${auth.token}` } : {}),
            ...(auth?.device ? { "x-device": auth.device } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as Json) : {};
}

async function signIn(): Promise<string> {
    const email = `reveal-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await call("POST", "/v1/auth/email/start", undefined, { email });
    for (let i = 0; i < 50; i++) {
        const query = encodeURIComponent(`to:"${email}"`);
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
        const data = (await res.json()) as { messages?: { Subject: string }[] };
        const code = data.messages?.[0]?.Subject.match(/^(\d{6}) /)?.[1];
        if (code) {
            const verified = await call("POST", "/v1/auth/email/verify", undefined, {
                email,
                code,
                name: "Riley",
            });
            return String(verified.session);
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`No sign-in email arrived for ${email}`);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 90_000;
    for (;;) {
        const value = await read();
        if (done(value)) return value;
        if (Date.now() > deadline) throw new Error(`Timed out at ${JSON.stringify(value)}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

async function createEvent(
    token: string,
    revealMode: "at-end" | "right-away",
    endsInMs: number,
): Promise<{ id: string; code: string }> {
    const now = Date.now();
    const created = await call(
        "POST",
        "/v1/events",
        { token },
        {
            occasion: "party",
            title: revealMode === "right-away" ? "Garden brunch" : "Rooftop farewell",
            startsAt: new Date(now - 60_000).toISOString(),
            endsAt: new Date(now + endsInMs).toISOString(),
            timeZone: "America/Vancouver",
            revealMode,
            shotsPerGuest: SHOTS,
            visibility: "everyone",
            look: "natural@1",
        },
    );
    const event = created.event as { id: string; code: string };
    await call("POST", `/v1/events/${event.id}/live`, { token });
    return event;
}

interface Guest {
    context: BrowserContext;
    page: Page;
    device: string;
    errors: string[];
}

/**
 * A guest who joined through the API, with the same device id in the browser's storage, so the
 * test starts on the event screen instead of driving the join sheet.
 */
async function guest(
    browser: Browser,
    code: string,
    name: string,
    options: { reducedMotion?: "reduce" } = {},
): Promise<Guest> {
    const device = crypto.randomUUID();
    await call("POST", `/v1/e/${code}/join`, { device }, { name, device });
    const context = await browser.newContext(options);
    await context.addInitScript((id) => {
        window.localStorage.setItem("linger\\device", id);
    }, device);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    return { context, page, device, errors };
}

async function shoot(page: Page, code: string, count: number): Promise<void> {
    await page.goto(`/e/${code}/camera`);
    const allow = page.getByRole("button", { name: "Allow camera" });
    const shutter = page.getByRole("button", { name: "Take photo" });
    await expect(allow.or(shutter)).toBeVisible();
    if (await allow.isVisible()) await allow.click();
    for (let i = 0; i < count; i++) {
        await expect(shutter).toBeEnabled();
        await shutter.click();
        await page.waitForTimeout(400);
    }
}

function gallery(code: string, token: string) {
    return () => call("GET", `/v1/e/${code}/gallery`, { token });
}

test("the reveal lands on the moment within seconds, with the server's three cards", async ({
    browser,
}, testInfo) => {
    const token = await signIn();
    const event = await createEvent(token, "at-end", 3_600_000);
    const { code } = event;

    try {
        const ana = await guest(browser, code, "Ana Lopez");
        const ben = await guest(browser, code, "Ben", { reducedMotion: "reduce" });
        const cara = await guest(browser, code, "Cara");

        await shoot(ana.page, code, 3);
        await shoot(ben.page, code, 2);
        await until(gallery(code, token), (g) => g.total === 5);

        // Before the reveal: the roll line, the developing grid as one line, no download.
        await ana.page.goto(`/e/${code}`);
        await expect(ana.page.getByText("Your roll: 3 taken, 2 left")).toBeVisible();
        await expect(ana.page.getByLabel("5 photos developing")).toBeAttached();
        await expect(ana.page.getByText("Ana", { exact: true }).first()).toBeVisible();
        await expect(ana.page.getByRole("button", { name: "Save all photos" })).toHaveCount(0);
        await ana.page.screenshot({ path: testInfo.outputPath("developing.png") });

        // Cara takes two photos while her uploads can't get through.
        await cara.page.route("**/v1/e/*/shots", (route) => route.abort("internetdisconnected"));
        await shoot(cara.page, code, 2);

        // The end moves 20 s out; the reveal follows it.
        const revealsAt = Date.now() + 20_000;
        await call(
            "PATCH",
            `/v1/events/${event.id}`,
            { token },
            { endsAt: new Date(revealsAt).toISOString() },
        );

        // Ben's screen holds the gallery back past the reveal, so it must read "Now", not "0m".
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        await ben.page.route(`**/v1/e/${code}/gallery*`, async (route) => {
            if (Date.now() >= revealsAt) await released;
            await route.continue();
        });
        await ben.page.goto(`/e/${code}`);
        await expect(ben.page.getByText("To reveal")).toBeVisible();
        await cara.page.goto(`/e/${code}`);
        await expect(
            cara.page.getByText(/photos? waiting to upload|upload when you have signal/),
        ).toBeVisible();

        // Ana's screen stays open across the reveal and lands on the moment by itself.
        await expect(ana.page.getByText("It's all here.")).toBeVisible({ timeout: 45_000 });
        expect(Date.now() - revealsAt).toBeLessThan(5_000);
        await expect(ana.page.getByText("5 moments, 2 photographers.")).toBeVisible();
        await expect(ana.page.getByText("3 of these are yours.")).toBeVisible();

        // The cards are the server's highlights, the front one at full size.
        const highlights = await call("GET", `/v1/e/${code}/highlights?for=moment`, {
            device: ana.device,
        });
        const ids = (highlights.items as { id: string }[]).map((item) => item.id);
        expect(ids.length).toBe(3);
        const sources = await ana.page
            .locator("img")
            .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
        for (const id of ids) expect(sources.some((src) => src.includes(id))).toBe(true);
        await ana.page.screenshot({ path: testInfo.outputPath("moment.png") });

        await ana.page.getByRole("button", { name: "See every moment" }).click();
        await expect(ana.page.getByLabel(/^Photo by /).first()).toBeVisible();
        await expect(ana.page.getByText("It's all here.")).toHaveCount(0);
        await expect(ana.page.getByRole("button", { name: "Watch the recap" })).toBeVisible();
        await expect(ana.page.getByText("Watch the recap")).toBeVisible();
        await expect(ana.page.getByRole("button", { name: "Show code" })).toHaveCount(0);
        await expect(ana.page.getByRole("button", { name: "Save all photos" })).toBeVisible();

        // Ben's stat reads "Now" until his gallery arrives, then the moment under reduced motion.
        await expect(ben.page.getByText("Now", { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(ben.page.getByText("0m", { exact: true })).toHaveCount(0);
        release();
        await expect(ben.page.getByText("It's all here.")).toBeVisible({ timeout: 15_000 });
        await ben.page.getByRole("button", { name: "See every moment" }).click();
        await expect(ben.page.getByText("It's all here.")).toHaveCount(0);
        await expect(ben.page.getByLabel(/^Photo by /).first()).toBeVisible();

        // Cara's photos were held across the reveal: the line says so, then they appear in place
        // once her connection is back, without a reload.
        const seeAll = cara.page.getByRole("button", { name: "See every moment" });
        await expect(seeAll).toBeVisible({ timeout: 30_000 });
        await seeAll.click();
        await expect(
            cara.page.getByText("2 of your photos are still sending. They'll appear here."),
        ).toBeVisible();
        // The gallery leaves Cara's photos out for 10 s after they're sent, as if they were still
        // developing, so they only appear if the screen keeps checking after her queue empties.
        let developedAt = Infinity;
        await cara.page.route("**/v1/e/*/gallery*", async (route) => {
            const response = await route.fetch();
            if (Date.now() >= developedAt) return route.fulfill({ response });
            const page = (await response.json()) as {
                kind: string;
                total: number;
                mine: number;
                items?: { photographer: { name: string } }[];
            };
            if (page.kind === "photos" && page.items) {
                const others = page.items.filter((item) => item.photographer.name !== "Cara");
                page.total -= page.items.length - others.length;
                page.mine = 0;
                page.items = others;
            }
            return route.fulfill({ response, json: page });
        });
        await cara.page.unroute("**/v1/e/*/shots");
        await expect(
            cara.page.getByText("2 of your photos are still sending.", { exact: false }),
        ).toBeVisible();
        await until(gallery(code, token), (g) => g.kind === "photos" && g.total === 7);
        developedAt = Date.now() + 10_000;
        await expect(cara.page.getByLabel("Photo by Cara")).toHaveCount(2, { timeout: 40_000 });
        await expect(cara.page.getByText("7", { exact: true }).first()).toBeVisible();

        for (const g of [ana, ben, cara]) expect(g.errors).toEqual([]);
    } finally {
        await call("DELETE", "/v1/me", { token });
    }
});

test("a right-away event reads Live while shooting and closes with the night's line", async ({
    browser,
}) => {
    const token = await signIn();
    const event = await createEvent(token, "right-away", 25_000);
    const { code } = event;

    try {
        const dev = await guest(browser, code, "Dev");
        await shoot(dev.page, code, 2);
        await until(gallery(code, token), (g) => g.kind === "photos" && g.total === 2);

        await dev.page.goto(`/e/${code}`);
        await expect(dev.page.getByText("Live", { exact: true })).toBeVisible();
        await expect(dev.page.getByText("It's all here.")).toHaveCount(0);
        await expect(dev.page.getByLabel("Photo by Dev")).toHaveCount(2);

        await expect(dev.page.getByText("That's the night. 2 moments from 1 person.")).toBeVisible({
            timeout: 60_000,
        });
        await expect(dev.page.getByRole("button", { name: "Watch the recap" })).toBeVisible();
        expect(dev.errors).toEqual([]);
    } finally {
        await call("DELETE", "/v1/me", { token });
    }
});
