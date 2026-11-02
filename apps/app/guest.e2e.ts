import { expect, test, type Page } from "@playwright/test";

// The guest's side in the browser: every state of the join sheet, code entry, the joined list,
// the camera's states as the clock crosses the start and the end, offline, and an event deleted
// while a guest has it open. Each test makes its own events through the API and a fresh host, so
// the seeded demo data is only read, never changed.

const API = "http://localhost:8171";
const MAILPIT = "http://localhost:8176";
const MINUTE = 60_000;

interface Json {
    [key: string]: unknown;
}

async function call(
    method: string,
    path: string,
    options: { token?: string; device?: string; body?: unknown } = {},
): Promise<Json> {
    const { token, device, body } = options;
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(device ? { "x-device": device } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as Json) : {};
}

async function mail(to: string, subject: RegExp): Promise<string> {
    for (let i = 0; i < 60; i++) {
        const query = encodeURIComponent(`to:"${to}"`);
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
        const data = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
        const found = data.messages?.find((m) => subject.test(m.Subject));
        if (found) {
            const message = await fetch(`${MAILPIT}/api/v1/message/${found.ID}`);
            const body = (await message.json()) as { Text: string; Subject: string };
            return `${body.Subject}\n${body.Text}`;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`No email matching ${subject} arrived for ${to}`);
}

/** A fresh host through email sign-in, deleted again by `cleanUp`. */
async function signIn(): Promise<string> {
    const email = `guest-e2e-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await call("POST", "/v1/auth/email/start", { body: { email } });
    const text = await mail(email, /^\d{6} /);
    const code = /^(\d{6}) /.exec(text)?.[1];
    const verified = await call("POST", "/v1/auth/email/verify", {
        body: { email, code, name: "Alex" },
    });
    return String(verified.session);
}

const hosts: string[] = [];

test.afterAll(async () => {
    for (const token of hosts) await call("DELETE", "/v1/me", { token }).catch(() => null);
});

interface Made {
    id: string;
    code: string;
    token: string;
}

async function makeEvent(
    settings: {
        title?: string;
        startsIn?: number;
        endsIn?: number;
        revealMode?: "right-away" | "at-end" | "next-morning" | "custom";
        revealIn?: number;
        shots?: number;
    } = {},
    live = true,
): Promise<Made> {
    const token = await signIn();
    hosts.push(token);
    const now = Date.now();
    const created = await call("POST", "/v1/events", {
        token,
        body: {
            occasion: "party",
            title: settings.title ?? "Rooftop farewell",
            startsAt: new Date(now + (settings.startsIn ?? -MINUTE)).toISOString(),
            endsAt: new Date(now + (settings.endsIn ?? 60 * MINUTE)).toISOString(),
            timeZone: "America/Vancouver",
            revealMode: settings.revealMode ?? "next-morning",
            ...(settings.revealMode === "custom"
                ? { revealAt: new Date(now + (settings.revealIn ?? 0)).toISOString() }
                : {}),
            shotsPerGuest: settings.shots ?? 5,
            visibility: "everyone",
            look: "warm-98@1",
        },
    });
    const event = created.event as { id: string; code: string };
    if (live) await call("POST", `/v1/events/${event.id}/live`, { token });
    return { ...event, token };
}

function device(): string {
    return `e2e-${crypto.randomUUID().replace(/-/g, "")}`;
}

async function joinByApi(code: string, name: string, id = device()): Promise<string> {
    await call("POST", `/v1/e/${code}/join`, { device: id, body: { name, device: id } });
    return id;
}

/** Joins through the sheet and lands on the camera. */
async function joinInBrowser(page: Page, code: string, name: string): Promise<void> {
    await page.goto(`/j/${code}`);
    await page.getByRole("button", { name: /^(Open camera|Join as .+)$/ }).click();
    const field = page.getByLabel("Your name");
    if (await field.isVisible().catch(() => false)) {
        await field.fill(name);
        await page.getByRole("button", { name: "Continue" }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/e/${code}/camera$`));
}

const sheetTitle = (page: Page, text: string | RegExp) => page.getByRole("heading", { name: text });

test.describe("the join sheet", () => {
    test("live and open: the host's name, the rules and one camera button", async ({ page }) => {
        const event = await makeEvent({ title: "Maya's picnic" });
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "You're invited to shoot Maya's picnic")).toBeVisible();
        await expect(page.getByText("Alex invited you")).toBeVisible();
        await expect(page.getByText("5 shots each.", { exact: false })).toBeVisible();
        await expect(page.getByText("Photos come from this camera only.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Open camera" })).toBeVisible();
    });

    test("loading shows the sheet's shape, not a spinner", async ({ page }) => {
        const event = await makeEvent();
        await page.route(`${API}/v1/e/${event.code}`, async (route) => {
            await new Promise((r) => setTimeout(r, 1500));
            await route.continue();
        });
        await page.goto(`/j/${event.code}`);
        await expect(page.getByLabel("Loading the event")).toBeVisible();
        await expect(sheetTitle(page, /You're invited to shoot/)).toBeVisible();
    });

    test("before the start: when the camera opens, and Join now", async ({ page }) => {
        const event = await makeEvent({ startsIn: 3 * 60 * MINUTE, endsIn: 5 * 60 * MINUTE });
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, /You're invited to shoot/)).toBeVisible();
        await expect(page.getByText(/^The camera opens .+\.$/)).toBeVisible();
        await page.getByRole("button", { name: "Join now" }).click();
        await page.getByLabel("Your name").fill("Robin");
        await page.getByRole("button", { name: "Continue" }).click();
        // Joining early lands on the event, not the camera.
        await expect(page).toHaveURL(new RegExp(`/e/${event.code}$`));
    });

    test("a draft says so, retries, and moves on by itself once it goes live", async ({ page }) => {
        const event = await makeEvent({ title: "Cabin weekend" }, false);
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "Cabin weekend isn't open yet")).toBeVisible();
        await expect(page.getByText("The host is still setting it up.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await call("POST", `/v1/events/${event.id}/live`, { token: event.token });
        await expect(sheetTitle(page, "You're invited to shoot Cabin weekend")).toBeVisible({
            timeout: 25_000,
        });
    });

    test("full: the title says so, and the sheet opens up when the host makes room", async ({
        page,
    }) => {
        const event = await makeEvent({ title: "Game night" });
        const devices: string[] = [];
        for (let i = 0; i < 10; i++) devices.push(await joinByApi(event.code, `Guest ${i}`));
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "Game night is full")).toBeVisible();
        await expect(page.getByText("Ask the host to make room.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await call("POST", "/v1/billing/dev-claim", {
            token: event.token,
            body: { eventId: event.id, productId: "linger.tier.30" },
        });
        await expect(sheetTitle(page, "You're invited to shoot Game night")).toBeVisible({
            timeout: 25_000,
        });
    });

    test("ended: the camera has closed, with when the photos appear", async ({ page }) => {
        await page.goto("/j/JNHSWM");
        await expect(sheetTitle(page, "The camera has closed")).toBeVisible();
        await expect(page.getByText(/^Photos appear .+\.$/)).toBeVisible();
        await expect(page.getByRole("button", { name: "See the event" })).toBeVisible();
    });

    test("revealed, not a member: no name step, and a way back by email", async ({ page }) => {
        await page.goto("/j/EMMADN");
        await expect(
            sheetTitle(page, "These photos are for the people who were there"),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "See the photos" })).toHaveCount(0);
        await page.getByRole("button", { name: "I joined on another device" }).click();
        await expect(sheetTitle(page, "Find your photos")).toBeVisible();
        await page.getByRole("button", { name: "Back" }).click();
        await expect(
            sheetTitle(page, "These photos are for the people who were there"),
        ).toBeVisible();
    });

    test("an unknown code offers the code entry, prefilled", async ({ page }) => {
        await page.goto("/j/XQXQXQ");
        await expect(sheetTitle(page, "There's no event with that code")).toBeVisible();
        const field = page.getByLabel("Join code");
        await expect(field).toHaveValue("XQXQXQ");
        await field.fill("");
        await field.pressSequentially("maya3x");
        await expect(page).toHaveURL(/\/j\/MAYA3X$/);
        await expect(sheetTitle(page, /You're invited to shoot/)).toBeVisible();
    });

    test("pasting a whole link into the code entry joins that event", async ({ page }) => {
        await page.goto("/j/XQXQXQ");
        const field = page.getByLabel("Join code");
        await field.fill("https://join.lingercam.app/maya3x");
        await expect(page).toHaveURL(/\/j\/MAYA3X$/);
    });

    test("offline with nothing cached: a line and Try again", async ({ page }) => {
        const event = await makeEvent();
        await page.route(`${API}/v1/e/${event.code}`, (route) => route.abort());
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "This event couldn't be loaded")).toBeVisible();
        await page.unroute(`${API}/v1/e/${event.code}`);
        await page.getByRole("button", { name: "Try again" }).click();
        await expect(sheetTitle(page, /You're invited to shoot/)).toBeVisible();
    });

    test("a returning guest joins under their name, and can change it", async ({ page }) => {
        const first = await makeEvent();
        const second = await makeEvent({ title: "Second night" });
        await joinInBrowser(page, first.code, "Sam");
        await page.goto(`/j/${second.code}`);
        await expect(page.getByRole("button", { name: "Join as Sam" })).toBeVisible();
        await page.getByRole("button", { name: "Not Sam?" }).click();
        await expect(sheetTitle(page, "What should we call you?")).toBeVisible();
        // Back returns to the invite.
        await page.getByRole("button", { name: "Back" }).click();
        await expect(sheetTitle(page, "You're invited to shoot Second night")).toBeVisible();
        await page.getByRole("button", { name: "Join as Sam" }).click();
        await expect(page).toHaveURL(new RegExp(`/e/${second.code}/camera$`));
    });

    test("a sheet left open moves from live to ended to revealed as the clock passes", async ({
        page,
    }) => {
        const event = await makeEvent({
            title: "Short one",
            endsIn: 12_000,
            revealMode: "custom",
            revealIn: 24_000,
        });
        await joinByApi(event.code, "Someone");
        await joinInBrowser(page, event.code, "Kai");
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "You're invited to shoot Short one")).toBeVisible();
        await expect(sheetTitle(page, "The camera has closed")).toBeVisible({ timeout: 20_000 });
        await expect(sheetTitle(page, "The photos are ready")).toBeVisible({ timeout: 25_000 });
        await expect(page.getByText(/moments? from \d+ (person|people)\.$/)).toBeVisible();
        await expect(page.getByRole("button", { name: "See the photos" })).toBeVisible();
    });

    test("the camera reuses what the join sheet loaded", async ({ page }) => {
        const event = await makeEvent();
        const reads: string[] = [];
        page.on("request", (req) => {
            if (req.method() === "GET" && req.url().startsWith(`${API}/v1/e/${event.code}`)) {
                reads.push(new URL(req.url()).pathname);
            }
        });
        await joinInBrowser(page, event.code, "Ana");
        await expect(page.getByLabel("5 shots left")).toBeVisible();
        // One summary for the sheet and one after joining; `me` comes from the join itself.
        expect(reads.filter((p) => p === `/v1/e/${event.code}`).length).toBeLessThanOrEqual(2);
        expect(reads.filter((p) => p.endsWith("/me"))).toEqual([]);
    });

    test("an email link moves a guest to this browser", async ({ browser }) => {
        const event = await makeEvent({
            title: "Moved",
            endsIn: 6_000,
            revealMode: "custom",
            revealIn: 6_000,
        });
        const email = `moved-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const id = await joinByApi(event.code, "Noor");
        await call("POST", `/v1/e/${event.code}/email`, { device: id, body: { email } });
        await new Promise((r) => setTimeout(r, 8_000));

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`/j/${event.code}`);
        await page.getByRole("button", { name: "I joined on another device" }).click();
        await page.getByLabel("Email").fill(email);
        await page.getByRole("button", { name: "Send link" }).click();
        await expect(page.getByText(/a link is on its way/)).toBeVisible();
        const text = await mail(email, /on this device$/);
        const link = /https?:\/\/\S+\?restore=[A-Za-z0-9_-]+/.exec(text)?.[0];
        expect(link).toBeTruthy();
        await page.goto(new URL(link ?? "").pathname + new URL(link ?? "").search);
        await expect(page).toHaveURL(new RegExp(`/e/${event.code}$`));
        await context.close();
    });
});

test.describe("the camera", () => {
    test("before the start: when it opens, a countdown, and no shutter", async ({ page }) => {
        const event = await makeEvent({ startsIn: 2 * MINUTE + 30_000, endsIn: 60 * MINUTE });
        await page.goto(`/j/${event.code}`);
        await page.getByRole("button", { name: "Join now" }).click();
        await page.getByLabel("Your name").fill("Pat");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.goto(`/e/${event.code}/camera`);
        await expect(page.getByText(/^The camera opens at .+\.$/)).toBeVisible();
        await expect(page.getByText(/^Opens in \dm$/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Take photo" })).toBeDisabled();
    });

    test("closing soon, then closed while open, with when the photos appear", async ({ page }) => {
        const event = await makeEvent({ endsIn: 9 * MINUTE });
        await joinInBrowser(page, event.code, "Lee");
        await expect(page.getByText(/^Closes in (9|10) min$/)).toBeVisible();
        // The host ends it now; the open camera hears about it without a reload.
        await call("POST", `/v1/events/${event.id}/end`, { token: event.token });
        await expect(page.getByText(/^The camera has closed\. Photos appear .+\.$/)).toBeVisible({
            timeout: 75_000,
        });
        await expect(page.getByRole("button", { name: "Take photo" })).toBeDisabled();
    });

    test("the end passing with the camera open closes it on time", async ({ page }) => {
        const event = await makeEvent({ endsIn: 15_000 });
        await joinInBrowser(page, event.code, "Ivy");
        await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled();
        await expect(page.getByText(/^The camera has closed\./)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("button", { name: "Take photo" })).toBeDisabled();
    });

    test("after the reveal the closed camera says the photos are ready", async ({ page }) => {
        const event = await makeEvent({ endsIn: 10_000, revealMode: "at-end" });
        await joinInBrowser(page, event.code, "Oli");
        await expect(page.getByText("The photos are ready")).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("button", { name: "See the photos" })).toBeVisible();
    });

    test("the event screen counts the last minute down in seconds", async ({ page }) => {
        const event = await makeEvent({ endsIn: 50_000 });
        await joinInBrowser(page, event.code, "Ivy");
        await page.goto(`/e/${event.code}`);
        const seconds = page.getByText(/^\d{1,2}s$/);
        await expect(seconds).toBeVisible();
        const first = await seconds.textContent();
        await expect.poll(() => seconds.textContent(), { timeout: 5000 }).not.toBe(first);
    });

    test("a device clock that is an hour fast still shoots on the server's time", async ({
        page,
    }) => {
        const event = await makeEvent({ endsIn: 30 * MINUTE });
        await page.clock.install({ time: new Date(Date.now() + 60 * MINUTE) });
        await joinInBrowser(page, event.code, "Max");
        await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled();
        await expect(page.getByText(/^(2\d|30)m left$/)).toBeVisible();
    });

    test("offline: the camera keeps working and says photos will send later", async ({
        page,
        context,
    }) => {
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Uma");
        await expect(page.getByLabel("5 shots left")).toBeVisible();
        await context.setOffline(true);
        await expect(
            page.getByText("You're offline. Your photos will send when you're back online."),
        ).toBeVisible();
        await page.getByRole("button", { name: "Take photo" }).click();
        await expect(page.getByLabel("4 shots left")).toBeVisible();
        await context.setOffline(false);
    });

    test("offline with nothing cached: Try again loads the camera", async ({ page }) => {
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Vic");
        await page.evaluate(() => localStorage.clear());
        await page.route(`${API}/v1/e/${event.code}`, (route) => route.abort());
        await page.reload();
        await expect(page.getByText("This event couldn't be loaded")).toBeVisible();
        await page.unroute(`${API}/v1/e/${event.code}`);
        await page.getByRole("button", { name: "Try again" }).click();
        await expect(page.getByText("This event couldn't be loaded")).toHaveCount(0);
    });

    test("tools: flash cycles and is remembered, a single lens has no zoom pill", async ({
        page,
    }) => {
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Wen");
        // The fake camera has one lens and no torch.
        await expect(page.getByRole("radio", { name: "Zoom 0.5" })).toHaveCount(0);
        await expect(page.getByRole("radio", { name: "Zoom 1×" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Flash" })).toBeDisabled();
    });

    test("the last shot survives leaving and reopening the camera", async ({ page }) => {
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Zoe");
        await expect(page.getByRole("button", { name: "See the event" }).last()).toBeVisible();
        await page.getByRole("button", { name: "Take photo" }).click();
        await expect(page.getByLabel("4 shots left")).toBeVisible();
        await page.goto(`/e/${event.code}`);
        await page.goto(`/e/${event.code}/camera`);
        await expect(
            page.getByRole("button", {
                name: /^(That was your last photo\. See the event|See the event\. 1)/,
            }),
        ).toBeVisible();
    });

    test("the screen stays awake, and the camera stops on a hidden tab", async ({ page }) => {
        await page.addInitScript(() => {
            const calls: string[] = [];
            (window as unknown as { wakeCalls: string[] }).wakeCalls = calls;
            Object.defineProperty(navigator, "wakeLock", {
                value: {
                    request: () => {
                        calls.push("request");
                        return Promise.resolve({ release: () => Promise.resolve() });
                    },
                },
            });
        });
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Ari");
        await expect
            .poll(() =>
                page.evaluate(() => (window as unknown as { wakeCalls: string[] }).wakeCalls),
            )
            .toContain("request");

        const live = () =>
            page.evaluate(() => {
                const stream = document.querySelector("video")?.srcObject as MediaStream | null;
                return stream?.getVideoTracks().some((t) => t.readyState === "live") ?? false;
            });
        await expect.poll(live).toBe(true);
        await setHidden(page, true);
        await expect.poll(live).toBe(false);
        await setHidden(page, false);
        await expect.poll(live).toBe(true);
    });

    test("a deleted event says so in the camera and on the join sheet", async ({ page }) => {
        const event = await makeEvent();
        await joinInBrowser(page, event.code, "Bo");
        await expect(page.getByLabel("5 shots left")).toBeVisible();
        await call("DELETE", `/v1/events/${event.id}`, { token: event.token });
        await page.reload();
        await expect(page.getByText("This event isn't available any more.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Back to your events" })).toBeVisible();
        await page.goto(`/j/${event.code}`);
        await expect(sheetTitle(page, "This event isn't available any more.")).toBeVisible();
    });
});

test.describe("the guest home", () => {
    test("events this browser joined are listed, and a deleted one drops out", async ({ page }) => {
        const kept = await makeEvent({ title: "Kept party" });
        const dropped = await makeEvent({ title: "Dropped party" });
        await joinInBrowser(page, kept.code, "Cy");
        await joinInBrowser(page, dropped.code, "Cy");
        await page.goto("/");
        await expect(
            page.getByRole("button", { name: /^Kept party\. Camera open$/ }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: /^Dropped party\./ })).toBeVisible();
        await call("DELETE", `/v1/events/${dropped.id}`, { token: dropped.token });
        await page.reload();
        await expect(page.getByRole("button", { name: /^Kept party\./ })).toBeVisible();
        await expect(page.getByRole("button", { name: /^Dropped party\./ })).toHaveCount(0);
        await page.getByRole("button", { name: /^Kept party\./ }).click();
        await expect(page).toHaveURL(new RegExp(`/e/${kept.code}`));
    });

    test("Have a code? takes a typed code to its join sheet", async ({ page }) => {
        await page.goto("/");
        await page.getByLabel("Join code").fill("MAYA3X");
        await expect(page).toHaveURL(/\/j\/MAYA3X$/);
    });
});

async function setHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((value) => {
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => (value ? "hidden" : "visible"),
        });
        document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
}
