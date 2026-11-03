import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

// The upload queue in the browser: photos taken without signal survive a reload, reconnecting
// sends at once, a photo the event refuses is downloaded instead of lost, a `too-large` refusal
// is retried once with a smaller copy, and a photo whose file is gone is reported.

const API = process.env.E2E_API_URL ?? "http://localhost:8171";
const APP = process.env.E2E_APP_URL ?? "http://localhost:8173";
const MAILPIT = "http://localhost:8176";
const STORAGE = "localhost:8174";

interface Json {
    [key: string]: unknown;
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Json> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as Json) : {};
}

/** A fresh host through email sign-in, so the run leaves the seeded demo host untouched. */
async function signIn(): Promise<string> {
    const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
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

interface Event {
    id: string;
    code: string;
    token: string;
}

// One host for the whole file: the API starts at most 20 sign-ins per IP address in 15 minutes.
let host: Promise<string> | undefined;

async function liveEvent(title: string, shots: number): Promise<Event> {
    host ??= signIn();
    const token = await host;
    const now = Date.now();
    const created = await call("POST", "/v1/events", token, {
        occasion: "party",
        title,
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        timeZone: "America/Vancouver",
        revealMode: "at-end",
        shotsPerGuest: shots,
        visibility: "everyone",
        look: "warm-98@1",
    });
    const event = created.event as { id: string; code: string };
    await call("POST", `/v1/events/${event.id}/live`, token);
    return { ...event, token };
}

/** Photos that reached the server for this event, developing or developed. */
async function arrived(event: Event): Promise<number> {
    const gallery = await call("GET", `/v1/e/${event.code}/gallery`, event.token);
    return Number(gallery.total);
}

async function openCamera(page: Page, code: string, name: string): Promise<void> {
    await page.goto(`/j/${code}`);
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    const allow = page.getByRole("button", { name: "Allow camera" });
    const shutter = page.getByRole("button", { name: "Take photo" });
    await expect(allow.or(shutter)).toBeVisible();
    if (await allow.isVisible()) await allow.click();
    await expect(page).toHaveURL(new RegExp(`/e/${code}/camera$`));
    await expect
        .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth))
        .toBeGreaterThan(0);
}

async function shoot(page: Page, times: number): Promise<void> {
    const shutter = page.getByRole("button", { name: "Take photo" });
    for (let i = 0; i < times; i++) {
        await expect(shutter).toBeEnabled();
        await shutter.click();
    }
}

/** How many photos the queue holds in IndexedDB. */
function storedPhotos(page: Page): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve, reject) => {
                const request = indexedDB.open("linger-uploads", 1);
                request.onupgradeneeded = () => request.result.createObjectStore("photos");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const counted = request.result
                        .transaction("photos", "readonly")
                        .objectStore("photos")
                        .count();
                    counted.onsuccess = () => {
                        request.result.close();
                        resolve(counted.result);
                    };
                    counted.onerror = () => reject(counted.error);
                };
            }),
    );
}

/** Answers this event's reservation requests as if the signal had dropped. */
async function holdReservations(context: BrowserContext, code: string): Promise<string> {
    const pattern = `${API}/v1/e/${code}/shots`;
    await context.route(pattern, (route: Route) =>
        route.request().method() === "POST"
            ? route.abort("internetdisconnected")
            : route.continue(),
    );
    return pattern;
}

/** A problem response from the API, with the CORS header the browser needs to read it. */
function problem(route: Route, status: number, code: string): Promise<void> {
    return route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": APP },
        body: JSON.stringify({ code, message: code }),
    });
}

test("thirty photos taken without signal survive a reload and all upload", async ({ browser }) => {
    const event = await liveEvent("Long table dinner", 30);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openCamera(page, event.code, "Ana");

    const held = await holdReservations(context, event.code);
    await shoot(page, 30);
    await expect(page.getByLabel("No shots left", { exact: true })).toBeVisible();
    await expect.poll(() => storedPhotos(page)).toBe(30);

    // Only small metadata goes to localStorage: no photo is kept there as a data: URL, apart from
    // the camera's last-shot thumbnail, which is a few kilobytes.
    const local = await page.evaluate(() => ({ ...localStorage }));
    for (const [key, value] of Object.entries(local)) {
        if (key.includes("lastShot:")) expect(value.length).toBeLessThan(64_000);
        else expect(value).not.toContain("data:image");
    }

    await page.reload();
    await expect.poll(() => storedPhotos(page)).toBe(30);
    expect(await arrived(event)).toBe(0);

    await context.unroute(held);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => arrived(event), { timeout: 120_000 }).toBe(30);
    await expect.poll(() => storedPhotos(page)).toBe(0);
    await context.close();
});

test("reconnecting sends a waiting photo at once instead of at the next retry", async ({
    browser,
}) => {
    const event = await liveEvent("Back porch", 5);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openCamera(page, event.code, "Ben");

    await context.setOffline(true);
    await shoot(page, 1);
    // Retries at 2, 4, 8 and 16 s fail, so the next one is about 32 s away.
    await page.waitForTimeout(20_000);
    expect(await arrived(event)).toBe(0);

    const back = Date.now();
    await context.setOffline(false);
    await expect.poll(() => arrived(event), { timeout: 10_000 }).toBe(1);
    expect(Date.now() - back).toBeLessThan(10_000);
    await context.close();
});

test("a photo the event refuses for good is kept until the guest downloads it", async ({
    browser,
}) => {
    const event = await liveEvent("Garden party", 5);
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await openCamera(page, event.code, "Cleo");

    await context.route(`${API}/v1/e/${event.code}/shots`, (route) =>
        route.request().method() === "POST" ? problem(route, 403, "not-open") : route.continue(),
    );
    let downloads = 0;
    page.on("download", () => {
        downloads += 1;
    });
    await shoot(page, 1);
    await expect.poll(() => storedPhotos(page)).toBe(1);

    await page.goto(`/e/${event.code}`);
    await expect(
        page.getByText("1 photo couldn't be added to the event. Download it to keep it."),
    ).toBeVisible();
    expect(downloads).toBe(0);
    await expect.poll(() => storedPhotos(page)).toBe(1);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.jpg$/);
    expect((await saved.path()).length).toBeGreaterThan(0);
    await expect(
        page.getByText("1 photo couldn't be added to the event, so it was downloaded."),
    ).toBeVisible();
    await expect.poll(() => storedPhotos(page)).toBe(0);
    expect(await arrived(event)).toBe(0);
    await context.close();
});

test("a photo refused as too large is made smaller and sent once more", async ({ browser }) => {
    const event = await liveEvent("Rooftop", 5);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openCamera(page, event.code, "Dev");

    const puts: number[] = [];
    page.on("request", (req) => {
        if (req.url().includes(STORAGE) && req.method() === "PUT") {
            puts.push(req.postDataBuffer()?.length ?? 0);
        }
    });
    let refused = 0;
    await context.route(`${API}/v1/shots/*/confirm`, (route) => {
        if (refused > 0) return route.continue();
        refused += 1;
        return problem(route, 413, "too-large");
    });

    await shoot(page, 1);
    await expect.poll(() => arrived(event), { timeout: 60_000 }).toBe(1);
    expect(refused).toBe(1);
    expect(puts).toHaveLength(2);
    await expect.poll(() => storedPhotos(page)).toBe(0);
    await context.close();
});

test("a queued photo whose file is gone is dropped and reported", async ({ browser }) => {
    const event = await liveEvent("Picnic", 5);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openCamera(page, event.code, "Eli");

    const held = await holdReservations(context, event.code);
    await shoot(page, 1);
    await expect.poll(() => storedPhotos(page)).toBe(1);
    await page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open("linger-uploads", 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const transaction = request.result.transaction("photos", "readwrite");
                    transaction.objectStore("photos").clear();
                    transaction.oncomplete = () => {
                        request.result.close();
                        resolve();
                    };
                };
            }),
    );

    await page.goto(`/e/${event.code}`);
    await context.unroute(held);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("1 photo couldn't be read.")).toBeVisible();
    expect(await arrived(event)).toBe(0);
    await context.close();
});
