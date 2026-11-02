import { expect, test, type Browser, type Page } from "@playwright/test";

// The revealed gallery in the browser: rolls paged by the server, the viewer's keys, URLs signed
// again before they lapse, the recap's fixed set, end card and share, and Download all. A host
// and two guests are made through the API; the browser takes over a guest's device id.

const API = "http://localhost:8171";
const MAILPIT = "http://localhost:8176";
const ANA_SHOTS = 31;
const BEN_SHOTS = 3;
const TOTAL = ANA_SHOTS + BEN_SHOTS;

interface Json {
    [key: string]: unknown;
}

async function call(
    method: string,
    path: string,
    auth: { token?: string; device?: string } = {},
    body?: unknown,
): Promise<Json> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
            ...(auth.device ? { "x-device": auth.device } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as Json) : {};
}

async function signIn(): Promise<string> {
    const email = `e2e-gallery-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await call("POST", "/v1/auth/email/start", {}, { email });
    for (let i = 0; i < 50; i++) {
        const query = encodeURIComponent(`to:"${email}"`);
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
        const data = (await res.json()) as { messages?: { Subject: string }[] };
        const code = data.messages?.[0]?.Subject.match(/^(\d{6}) /)?.[1];
        if (code) {
            const verified = await call(
                "POST",
                "/v1/auth/email/verify",
                {},
                {
                    email,
                    code,
                    name: "Riley",
                },
            );
            return String(verified.session);
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`No sign-in email arrived for ${email}`);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 120_000;
    for (;;) {
        const value = await read();
        if (done(value)) return value;
        if (Date.now() > deadline) throw new Error(`Timed out at ${JSON.stringify(value)}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

async function shoot(code: string, device: string, name: string, shots: number, jpeg: Uint8Array) {
    await call("POST", `/v1/e/${code}/join`, { device }, { name, device });
    for (let i = 0; i < shots; i++) {
        const reserved = await call(
            "POST",
            `/v1/e/${code}/shots`,
            { device },
            {
                takenAt: new Date().toISOString(),
                clientId: crypto.randomUUID(),
            },
        );
        const put = await fetch(String(reserved.uploadUrl), {
            method: "PUT",
            headers: { "content-type": "image/jpeg" },
            body: jpeg as Uint8Array<ArrayBuffer>,
        });
        if (!put.ok) throw new Error(`Upload failed with ${put.status}`);
        await call("POST", `/v1/shots/${String(reserved.shotId)}/confirm`, { device });
    }
}

let token = "";
let code = "";
const ana = `e2e-ana-${crypto.randomUUID()}`;
const ben = `e2e-ben-${crypto.randomUUID()}`;

test.beforeAll(async ({ browser }) => {
    // A plain JPEG to upload as every photo, drawn by the browser.
    const painter = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await painter.setContent(
        '<body style="margin:0;background:linear-gradient(135deg,#c97b4a,#2b3a55)"></body>',
    );
    const jpeg = new Uint8Array(await painter.screenshot({ type: "jpeg", quality: 85 }));
    await painter.close();

    token = await signIn();
    const now = Date.now();
    const created = await call(
        "POST",
        "/v1/events",
        { token },
        {
            occasion: "party",
            title: "Gallery night",
            startsAt: new Date(now - 60_000).toISOString(),
            endsAt: new Date(now + 3_600_000).toISOString(),
            timeZone: "America/Vancouver",
            revealMode: "at-end",
            shotsPerGuest: 36,
            visibility: "everyone",
            look: "natural@1",
        },
    );
    const event = created.event as { id: string; code: string };
    code = event.code;
    await call("POST", `/v1/events/${event.id}/live`, { token });
    await shoot(code, ana, "Ana", ANA_SHOTS, jpeg);
    await shoot(code, ben, "Ben", BEN_SHOTS, jpeg);
    await until(
        () => call("GET", `/v1/e/${code}/gallery`, { token }),
        (g) => g.total === TOTAL,
    );
    await call(
        "PATCH",
        `/v1/events/${event.id}`,
        { token },
        {
            endsAt: new Date(Date.now() + 3_000).toISOString(),
        },
    );
    await until(
        () => call("GET", `/v1/e/${code}/gallery`, { token }),
        (g) => g.kind === "photos" && g.total === TOTAL,
    );
});

test.afterAll(async () => {
    if (token) await call("DELETE", "/v1/me", { token });
});

/** A browser that is this guest's device, with the reveal moment already seen. */
async function asGuest(browser: Browser, device: string, userAgent?: string): Promise<Page> {
    const context = await browser.newContext(userAgent ? { userAgent } : {});
    await context.addInitScript(
        ([id, joinCode]) => {
            localStorage.setItem("linger\\device", id);
            localStorage.setItem(`linger\\moment:${joinCode}`, "true");
        },
        [device, code] as const,
    );
    return context.newPage();
}

function galleryRequests(page: Page): string[] {
    const urls: string[] = [];
    page.on("request", (req) => {
        if (req.url().startsWith(`${API}/v1/e/${code}/gallery`)) urls.push(req.url());
    });
    return urls;
}

test("a roll pages from the server and the viewer pages within it", async ({ browser }) => {
    const page = await asGuest(browser, ben);
    const requests = galleryRequests(page);
    await page.goto(`/e/${code}`);
    await page.getByRole("button", { name: /People/ }).click();
    await page.getByRole("button", { name: /^Ana, / }).click();
    await expect.poll(() => requests.some((url) => url.includes("guest="))).toBe(true);

    // Scroll to the end of the roll: every one of Ana's photos is there, beyond the first page.
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 2000);
    await expect(page.getByLabel("Photo by Ben")).toHaveCount(0);
    await page.getByLabel("Photo by Ana").first().click();
    await expect(page.getByText(`1 of ${ANA_SHOTS}`)).toBeVisible();
});

test("the viewer moves with the arrow keys and closes with Escape", async ({ browser }) => {
    const page = await asGuest(browser, ben);
    await page.goto(`/e/${code}`);
    await page
        .getByLabel(/^Photo by /)
        .first()
        .click();
    await expect(page.getByText(`1 of ${TOTAL}`)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`2 of ${TOTAL}`)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(`1 of ${TOTAL}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/e/${code}$`));
});

test("signed URLs are renewed before they lapse", async ({ browser }) => {
    const page = await asGuest(browser, ben);
    await page.clock.install();
    const requests = galleryRequests(page);
    await page.goto(`/e/${code}`);
    await page
        .getByLabel(/^Photo by /)
        .first()
        .click();
    await expect(page.getByText(`1 of ${TOTAL}`)).toBeVisible();
    const before = requests.length;

    // URLs last an hour; 52 minutes in, the viewer is inside the 10-minute window.
    await page.clock.fastForward("52:00");
    await expect.poll(() => requests.length).toBeGreaterThan(before);
    const loaded = await page
        .locator("img")
        .evaluateAll((imgs) =>
            imgs
                .filter((img) => (img as HTMLImageElement).src.includes("/shots/"))
                .every((img) => (img as HTMLImageElement).naturalWidth > 0),
        );
    expect(loaded).toBe(true);
});

test("the recap plays a fixed set, ends on a card and shares the photo", async ({ browser }) => {
    const page = await asGuest(browser, ben);
    await page.addInitScript(() => {
        const shared: { name: string; type: string }[] = [];
        Object.assign(window, { shared });
        Object.assign(navigator, {
            canShare: () => true,
            share: async (data: { files?: File[] }) => {
                for (const file of data.files ?? [])
                    shared.push({ name: file.name, type: file.type });
            },
        });
    });
    const highlights: string[] = [];
    page.on("request", (req) => {
        if (req.url().includes(`/v1/e/${code}/highlights`)) highlights.push(req.url());
    });
    await page.goto(`/e/${code}/recap`);
    await expect(page.getByText("Gallery night").first()).toBeVisible();
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toContain("for=recap");

    // A like made while it plays doesn't change the set.
    const gallery = await call("GET", `/v1/e/${code}/gallery`, { device: ana });
    const last = (gallery.items as { id: string }[]).at(-1);
    if (last) await call("POST", `/v1/shots/${last.id}/like`, { device: ana });

    await page.getByRole("button", { name: "Share" }).click();
    await expect
        .poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared))
        .toEqual([{ name: "linger.jpg", type: "image/jpeg" }]);

    const box = page.viewportSize() ?? { width: 430, height: 932 };
    for (let i = 0; i < 12; i++) await page.mouse.click(box.width - 40, box.height / 2);
    await expect(page.getByRole("button", { name: "Watch again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "See every moment" })).toBeVisible();
    expect(highlights).toHaveLength(1);

    await page.getByRole("button", { name: "Watch again" }).click();
    await expect(page.getByText(/The whole night in \d+ seconds/)).toBeVisible();
});

test("Download all carries on past a failure and says how many were saved", async ({ browser }) => {
    const page = await asGuest(browser, ben);
    let failed = false;
    await page.route(/\/shots\/.*\.jpg/, async (route) => {
        if (!failed && route.request().url().includes("developed")) {
            failed = true;
            await route.fulfill({ status: 500, body: "" });
            return;
        }
        await route.continue();
    });
    await page.goto(`/e/${code}`);
    await page.getByRole("button", { name: "Download all photos" }).click();
    await expect(
        page.getByText(`${TOTAL - 1} of ${TOTAL} saved. 1 couldn't be saved.`, { exact: false }),
    ).toBeVisible({ timeout: 120_000 });
});

test("phone browsers are told to save from the viewer", async ({ browser }) => {
    const page = await asGuest(
        browser,
        ben,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
    await page.goto(`/e/${code}`);
    await page.getByRole("button", { name: "Download all photos" }).click();
    await expect(page.getByText("Save photos one at a time from the viewer.")).toBeVisible();
});

test("the people list draws only what is on screen", async ({ browser }) => {
    // FSTV28 is seeded with 250 guests; seed devices are named by event and index.
    const context = await browser.newContext();
    await context.addInitScript(() => {
        localStorage.setItem("linger\\device", "seed-fstv28-guest-0");
        localStorage.setItem("linger\\moment:FSTV28", "true");
    });
    const page = await context.newPage();
    await page.goto("/e/FSTV28");
    await page.getByRole("button", { name: /People/ }).click();
    await expect(page.getByRole("heading", { name: /people$/ })).toBeVisible();
    const drawn = await page.getByText(/^Joined /).count();
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(250);
});
