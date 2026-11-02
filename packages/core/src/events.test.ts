import { describe, expect, test } from "vitest";
import {
    EVENT_STATES,
    EventSettings,
    EventSettingsPatch,
    EventSummary,
    GuestEmailRequest,
    JOIN_ALPHABET,
    JOIN_CODE_LENGTH,
    JoinRequest,
    ARCHIVE_AFTER_DAYS,
    canTransition,
    dueState,
    firstName,
    isTimeZone,
    joinCode,
    lockedSettings,
    normalizeJoinCode,
    RestoreRequest,
    shotsLeft,
    type EventState,
} from "./events.ts";

const valid = {
    occasion: "wedding",
    title: "Emma & Daniel's Wedding",
    startsAt: "2026-06-20T15:00:00-07:00",
    endsAt: "2026-06-21T01:00:00-07:00",
    timeZone: "America/Vancouver",
    revealMode: "next-morning",
    shotsPerGuest: 24,
    visibility: "everyone",
    look: "warm-98@1",
} as const;

function problems(input: unknown): string[] {
    const result = EventSettings.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("lifecycle", () => {
    const allowed: [EventState, EventState][] = [
        ["draft", "live"],
        ["live", "ended"],
        ["live", "revealed"],
        ["ended", "revealed"],
        ["revealed", "archived"],
    ];

    test.each(allowed)("%s can move to %s", (from, to) => {
        expect(canTransition(from, to)).toBe(true);
    });

    test("every other pair is refused, including staying put and going back", () => {
        for (const from of EVENT_STATES) {
            for (const to of EVENT_STATES) {
                const expected = allowed.some(([a, b]) => a === from && b === to);
                expect(canTransition(from, to), `${from} to ${to}`).toBe(expected);
            }
        }
    });

    test("archived is final", () => {
        for (const to of EVENT_STATES) expect(canTransition("archived", to)).toBe(false);
    });
});

describe("EventSettings", () => {
    test("accepts the design's wedding", () => {
        expect(problems(valid)).toEqual([]);
    });

    test("trims the title and checks its length", () => {
        const parsed = EventSettings.parse({
            ...valid,
            title: "  Maya turns thirty  ",
        });
        expect(parsed.title).toBe("Maya turns thirty");
        expect(problems({ ...valid, title: "" })).toEqual(["title"]);
        expect(problems({ ...valid, title: "   " })).toEqual(["title"]);
        expect(problems({ ...valid, title: "a".repeat(60) })).toEqual([]);
        expect(problems({ ...valid, title: "a".repeat(61) })).toEqual(["title"]);
    });

    test("shots per guest is 5 to 36, whole, or null for unlimited", () => {
        expect(problems({ ...valid, shotsPerGuest: 5 })).toEqual([]);
        expect(problems({ ...valid, shotsPerGuest: 36 })).toEqual([]);
        expect(problems({ ...valid, shotsPerGuest: null })).toEqual([]);
        expect(problems({ ...valid, shotsPerGuest: 4 })).toEqual(["shotsPerGuest"]);
        expect(problems({ ...valid, shotsPerGuest: 37 })).toEqual(["shotsPerGuest"]);
        expect(problems({ ...valid, shotsPerGuest: 12.5 })).toEqual(["shotsPerGuest"]);
        expect(problems({ ...valid, shotsPerGuest: undefined })).toEqual(["shotsPerGuest"]);
    });

    test("the end must come after the start", () => {
        expect(problems({ ...valid, endsAt: valid.startsAt })).toEqual(["endsAt"]);
        expect(problems({ ...valid, endsAt: "2026-06-20T14:00:00-07:00" })).toEqual(["endsAt"]);
    });

    test("times need an offset", () => {
        expect(problems({ ...valid, startsAt: "2026-06-20T15:00:00" })).toEqual(["startsAt"]);
        expect(problems({ ...valid, startsAt: "2026-06-20T22:00:00Z" })).toEqual([]);
        expect(problems({ ...valid, startsAt: "yesterday" })).toEqual(["startsAt"]);
    });

    test("time zones must be IANA names", () => {
        expect(isTimeZone("Europe/London")).toBe(true);
        expect(isTimeZone("Mars/Olympus")).toBe(false);
        expect(problems({ ...valid, timeZone: "Mars/Olympus" })).toEqual(["timeZone"]);
    });

    test("custom reveals need a time at or after the end", () => {
        const custom = { ...valid, revealMode: "custom" } as const;
        expect(problems(custom)).toEqual(["revealAt"]);
        expect(problems({ ...custom, revealAt: valid.endsAt })).toEqual([]);
        expect(problems({ ...custom, revealAt: "2026-06-22T12:00:00-07:00" })).toEqual([]);
        expect(problems({ ...custom, revealAt: "2026-06-20T20:00:00-07:00" })).toEqual([
            "revealAt",
        ]);
    });

    test("a reveal time is refused for the other modes", () => {
        for (const revealMode of ["right-away", "at-end", "next-morning"]) {
            expect(problems({ ...valid, revealMode, revealAt: valid.endsAt })).toEqual([
                "revealAt",
            ]);
            expect(problems({ ...valid, revealMode })).toEqual([]);
        }
    });

    test("unknown occasions, visibilities, modes and looks are refused", () => {
        expect(problems({ ...valid, occasion: "funeral" })).toEqual(["occasion"]);
        expect(problems({ ...valid, visibility: "public" })).toEqual(["visibility"]);
        expect(problems({ ...valid, revealMode: "never" })).toEqual(["revealMode"]);
        expect(problems({ ...valid, look: "sepia@1" })).toEqual(["look"]);
    });

    test("the patch schema accepts any subset", () => {
        expect(EventSettingsPatch.parse({ title: "New" })).toEqual({
            title: "New",
        });
        expect(EventSettingsPatch.safeParse({ shotsPerGuest: 2 }).success).toBe(false);
    });
});

describe("editable settings", () => {
    const at = (state: EventState, settings: Partial<EventSettings> = {}) => ({
        state,
        settings: { ...valid, ...settings } as EventSettings,
    });

    test("a draft can change anything", () => {
        expect(lockedSettings(at("draft"), { look: "mono@1", shotsPerGuest: 10 })).toEqual([]);
        expect(lockedSettings(at("draft"), { revealMode: "right-away" })).toEqual([]);
        expect(
            lockedSettings(at("draft", { visibility: "host-only" }), { visibility: "everyone" }),
        ).toEqual([]);
    });

    test("a live event keeps its look, shots and start", () => {
        expect(lockedSettings(at("live"), { title: "x", endsAt: valid.endsAt })).toEqual([]);
        expect(lockedSettings(at("live"), { look: "mono@1", shotsPerGuest: 10 })).toEqual([
            "look",
            "shotsPerGuest",
        ]);
        expect(lockedSettings(at("live"), { startsAt: valid.startsAt })).toEqual(["startsAt"]);
    });

    test("ended can move the reveal later; revealed only the title and visibility", () => {
        expect(lockedSettings(at("ended"), { revealMode: "at-end", endsAt: valid.endsAt })).toEqual(
            ["endsAt", "revealMode"],
        );
        expect(
            lockedSettings(at("ended"), {
                revealMode: "custom",
                revealAt: "2026-06-22T10:00:00-07:00",
            }),
        ).toEqual([]);
        expect(
            lockedSettings(at("revealed"), {
                visibility: "host-only",
                revealMode: "at-end",
            }),
        ).toEqual(["revealMode"]);
    });

    test("once guests have shot, visibility only gets stricter", () => {
        expect(lockedSettings(at("live"), { visibility: "host-only" })).toEqual([]);
        for (const state of ["live", "ended", "revealed"] as const) {
            expect(
                lockedSettings(at(state, { visibility: "host-only" }), { visibility: "everyone" }),
            ).toEqual(["visibility"]);
        }
    });

    test("once live, the reveal can't move earlier", () => {
        expect(lockedSettings(at("live"), { revealMode: "right-away" })).toEqual(["revealMode"]);
        expect(lockedSettings(at("live"), { revealMode: "at-end" })).toEqual(["revealMode"]);
        expect(
            lockedSettings(at("live"), {
                revealMode: "custom",
                revealAt: "2026-06-21T02:00:00-07:00",
            }),
        ).toEqual(["revealMode", "revealAt"]);
        expect(
            lockedSettings(at("live", { revealMode: "right-away" }), { revealMode: "right-away" }),
        ).toEqual([]);
    });

    test("archived is read only", () => {
        expect(lockedSettings(at("archived"), { title: "x" })).toEqual(["title"]);
    });

    test("keys set to undefined are ignored", () => {
        expect(lockedSettings(at("archived"), { title: undefined } as never)).toEqual([]);
    });
});

describe("dueState", () => {
    const settings = { ...valid, revealMode: "at-end" as const };
    const ends = Date.parse(valid.endsAt);
    const before = new Date(ends - 60_000);
    const after = new Date(ends + 60_000);
    const morning = { ...valid };
    const DAY = 86_400_000;

    test.each([
        ["live", settings, before, "live"],
        ["live", settings, after, "revealed"],
        ["live", { ...settings, revealMode: "right-away" as const }, after, "revealed"],
        ["live", morning, after, "ended"],
        ["ended", morning, after, "ended"],
        ["ended", morning, new Date("2026-06-21T10:00:00-07:00"), "revealed"],
        ["live", morning, new Date("2026-06-21T10:00:00-07:00"), "revealed"],
        ["draft", settings, after, "draft"],
        ["archived", settings, after, "archived"],
    ] as const)("%s with %o at %s is %s", (state, s, now, expected) => {
        expect(dueState(state, s, null, now)).toBe(expected);
    });

    test("revealed events archive after the set number of days", () => {
        const revealedAt = new Date(ends);
        const almost = new Date(ends + ARCHIVE_AFTER_DAYS * DAY - 1);
        const done = new Date(ends + ARCHIVE_AFTER_DAYS * DAY);
        expect(dueState("revealed", settings, revealedAt, almost)).toBe("revealed");
        expect(dueState("revealed", settings, revealedAt, done)).toBe("archived");
        expect(dueState("revealed", settings, null, done)).toBe("revealed");
    });
});

describe("joining", () => {
    test("join codes are 6 characters from the unambiguous alphabet", () => {
        for (let i = 0; i < 500; i++) {
            const code = joinCode();
            expect(code).toHaveLength(JOIN_CODE_LENGTH);
            for (const ch of code) expect(JOIN_ALPHABET).toContain(ch);
        }
    });

    test("the alphabet leaves out look-alike characters", () => {
        expect(JOIN_ALPHABET).toHaveLength(30);
        for (const ch of "01ILOU") expect(JOIN_ALPHABET).not.toContain(ch);
        expect(new Set(JOIN_ALPHABET).size).toBe(JOIN_ALPHABET.length);
    });

    test("bytes past the even range are skipped, so each character is equally likely", () => {
        const batches = [
            new Uint8Array([255, 254, 240, 0, 1, 2]),
            new Uint8Array([29, 30, 239, 59, 255, 3]),
        ];
        let call = 0;
        const code = joinCode(() => batches[call++] ?? new Uint8Array(6));
        expect(code).toBe([0, 1, 2, 29, 0, 29].map((i) => JOIN_ALPHABET[i]).join(""));
    });

    test("normalizeJoinCode tidies typing and rejects impossible codes", () => {
        expect(normalizeJoinCode(" k7m2qx ")).toBe("K7M2QX");
        expect(normalizeJoinCode("K7M2Q")).toBeNull();
        expect(normalizeJoinCode("K7M2Q0")).toBeNull();
        expect(normalizeJoinCode("K7M2QI")).toBeNull();
    });

    test("join requests need a name and a device id", () => {
        const device = "dev_abcdefghijklmnop";
        expect(JoinRequest.parse({ name: "  Priya ", device })).toEqual({
            name: "Priya",
            device,
        });
        expect(JoinRequest.safeParse({ name: "", device }).success).toBe(false);
        expect(JoinRequest.safeParse({ name: "a".repeat(40), device }).success).toBe(true);
        expect(JoinRequest.safeParse({ name: "a".repeat(41), device }).success).toBe(false);
        expect(JoinRequest.safeParse({ name: "Priya", device: "short" }).success).toBe(false);
        expect(
            JoinRequest.safeParse({ name: "Priya", device: "has spaces in it ok" }).success,
        ).toBe(false);
    });
});

describe("shotsLeft", () => {
    const settings = EventSettings.parse(valid);

    test("counts down from the allowance and stops at zero", () => {
        const event = { settings, unlimitedShots: false };
        expect(shotsLeft(event, { shotsTaken: 0 })).toBe(24);
        expect(shotsLeft(event, { shotsTaken: 15 })).toBe(9);
        expect(shotsLeft(event, { shotsTaken: 30 })).toBe(0);
    });

    test("is null when shots are unlimited", () => {
        expect(shotsLeft({ settings, unlimitedShots: true }, { shotsTaken: 99 })).toBeNull();
        const open = { ...settings, shotsPerGuest: null };
        expect(shotsLeft({ settings: open, unlimitedShots: false }, { shotsTaken: 5 })).toBeNull();
    });
});

describe("EventSummary", () => {
    const summary = {
        code: "MAYA3X",
        title: "Maya turns thirty",
        occasion: "birthday",
        state: "live",
        hostName: "Alex",
        coverUrl: null,
        startsAt: "2026-06-20T15:00:00-07:00",
        endsAt: "2026-06-20T23:00:00-07:00",
        timeZone: "America/Vancouver",
        revealMode: "at-end",
        revealsAt: "2026-06-21T06:00:00Z",
        shotsPerGuest: 24,
        look: "warm-98@1",
        guestCount: 7,
        full: false,
        guestLimit: null,
        photoCount: 212,
        photographerCount: 6,
        viewer: { role: "guest", guestId: "g1", shotsTaken: 7, shotsLeft: 17 },
        now: "2026-06-20T22:00:00Z",
    };

    test("says who is viewing", () => {
        expect(EventSummary.parse(summary).viewer.role).toBe("guest");
        const none = { role: "none", guestId: null, shotsTaken: 0, shotsLeft: 24 };
        expect(EventSummary.safeParse({ ...summary, viewer: none }).success).toBe(true);
        const bad = { ...summary, viewer: { ...none, role: "owner" } };
        expect(EventSummary.safeParse(bad).success).toBe(false);
    });
});

describe("guest email and restore", () => {
    test("an email is trimmed and lowercased, and null forgets it", () => {
        expect(GuestEmailRequest.parse({ email: " Sam@Example.com " }).email).toBe(
            "sam@example.com",
        );
        expect(GuestEmailRequest.parse({ email: null }).email).toBeNull();
        expect(GuestEmailRequest.safeParse({ email: "not an email" }).success).toBe(false);
    });

    test("a restore token is a long url-safe string", () => {
        const device = "abcdefghijklmnop";
        expect(RestoreRequest.safeParse({ token: "a".repeat(43), device }).success).toBe(true);
        expect(RestoreRequest.safeParse({ token: "short", device }).success).toBe(false);
    });
});

describe("firstName", () => {
    test("the first word of a name", () => {
        expect(firstName("Priya R.")).toBe("Priya");
        expect(firstName("  Jun ")).toBe("Jun");
        expect(firstName("")).toBe("");
    });
});
