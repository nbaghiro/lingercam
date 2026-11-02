import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

// A whole event in the browser: a host sets it up through the API, two guests join and shoot with
// Chromium's fake camera, nothing leaks before the reveal, then the gallery shows every photo
// signed with the guest who took it.

const API = "http://localhost:8171";
const MAILPIT = "http://localhost:8176";
const STORAGE = "localhost:8174";
const SHOTS = 5;

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

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 90_000;
    for (;;) {
        const value = await read();
        if (done(value)) return value;
        if (Date.now() > deadline) throw new Error(`Timed out at ${JSON.stringify(value)}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

/** Everything a guest's browser receives from the API and storage, for the leak checks. */
interface Watch {
    page: Page;
    bodies: { url: string; body: string }[];
    storageReads: string[];
    errors: string[];
}

async function guest(browser: Browser): Promise<Watch> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const watch: Watch = { page, bodies: [], storageReads: [], errors: [] };
    page.on("response", (res: Response) => {
        const url = res.url();
        if (url.startsWith(API) && res.request().method() === "GET") {
            res.text()
                .then((body) => watch.bodies.push({ url, body }))
                .catch(() => null);
        }
    });
    page.on("request", (req) => {
        if (req.url().includes(STORAGE) && req.method() === "GET")
            watch.storageReads.push(req.url());
    });
    page.on("pageerror", (error) => watch.errors.push(error.message));
    return watch;
}

async function joinAndShoot(watch: Watch, code: string, name: string, shots: number) {
    const { page } = watch;
    await page.goto(`/j/${code}`);
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByLabel("Your name").fill(name);
    // Continue goes straight to the browser's camera prompt, which the fake UI accepts, so no
    // "Allow the camera" step appears in between.
    await page.getByRole("button", { name: "Continue" }).click();
    const shutter = page.getByRole("button", { name: "Take photo" });
    await expect(shutter).toBeVisible();
    await expect(page.getByText("Allow the camera")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/e/${code}/camera$`));
    await expect(page.getByLabel(`${SHOTS} shots left`)).toBeVisible();
    // The fake camera is live, not the development sample photos.
    await expect(page.locator("video")).toBeVisible();
    await expect
        .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth))
        .toBeGreaterThan(0);

    for (let taken = 1; taken <= shots; taken++) {
        await expect(shutter).toBeEnabled();
        await shutter.click();
        const left = SHOTS - taken;
        const label =
            left === 0 ? "No shots left" : left === 1 ? "1 shot left" : `${left} shots left`;
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
}

function photosIn(body: string): string[] {
    return body.match(/https?:\/\/[^"]*\/shots\/[^"]*/g) ?? [];
}

test("guests join, shoot, and see each other's photos only after the reveal", async ({
    browser,
}) => {
    const token = await signIn();
    const now = Date.now();
    const created = await call("POST", "/v1/events", token, {
        occasion: "party",
        title: "Rooftop farewell",
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        timeZone: "America/Vancouver",
        revealMode: "at-end",
        shotsPerGuest: SHOTS,
        visibility: "everyone",
        look: "warm-98@1",
    });
    const event = created.event as { id: string; code: string };
    await call("POST", `/v1/events/${event.id}/live`, token);

    try {
        const ana = await guest(browser);
        const ben = await guest(browser);
        await joinAndShoot(ana, event.code, "Ana", SHOTS);
        await joinAndShoot(ben, event.code, "Ben", 2);

        // Ana has used her roll: the camera says so and the shutter stays off.
        await expect(ana.page.getByText("That's your roll")).toBeVisible();
        await expect(ana.page.getByRole("button", { name: "Take photo" })).toBeDisabled();

        // Both queues reach the server, and the host still only gets counts.
        const gallery = () => call("GET", `/v1/e/${event.code}/gallery`, token);
        const developing = await until(gallery, (g) => g.total === SHOTS + 2);
        expect(developing.kind).toBe("developing");
        expect(Object.keys(developing)).not.toContain("items");

        // The event screen shows developing tiles and no photo, in the DOM or on the wire.
        for (const watch of [ana, ben]) {
            await watch.page.goto(`/e/${event.code}`);
            await expect(watch.page.getByText("Developing").first()).toBeVisible();
            await expect(watch.page.getByLabel(/^Photo by /)).toHaveCount(0);
        }
        for (const watch of [ana, ben]) {
            for (const { url, body } of watch.bodies) {
                expect(photosIn(body), url).toEqual([]);
                expect(body, url).not.toContain("X-Amz-Signature");
            }
            expect(watch.storageReads).toEqual([]);
            const sources = await watch.page
                .locator("img")
                .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
            expect(sources.filter((src) => src.includes("/shots/"))).toEqual([]);
        }

        // The host moves the end a few seconds out; the reveal job does the rest.
        await call("PATCH", `/v1/events/${event.id}`, token, {
            endsAt: new Date(Date.now() + 4_000).toISOString(),
        });
        await until(
            () => call("GET", `/v1/events/${event.id}`, token),
            (r) => (r.event as { state: string }).state === "revealed",
        );
        await until(gallery, (g) => g.kind === "photos" && g.total === SHOTS + 2);

        for (const watch of [ana, ben]) {
            const { page } = watch;
            await page.reload();
            await page.getByRole("button", { name: "See every moment" }).click();
            await expect(page.getByLabel("Photo by Ana")).toHaveCount(SHOTS);
            await expect(page.getByLabel("Photo by Ben")).toHaveCount(2);

            const thumbs = await page
                .locator("img")
                .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
            const signed = thumbs.filter((src) => src.includes("/shots/"));
            expect(signed.length).toBeGreaterThanOrEqual(SHOTS + 2);
            for (const src of signed) {
                expect(src).toContain("X-Amz-Signature");
                const res = await page.request.get(src);
                expect(res.status()).toBe(200);
                expect(res.headers()["content-type"]).toContain("image/jpeg");
            }
            expect(watch.errors).toEqual([]);
        }
    } finally {
        // Deleting the host removes the event, its guests, shots and stored files.
        await call("DELETE", "/v1/me", token);
    }
});
