import { describe, expect, test } from "vitest";
import { EVENT_STATES, REVEAL_MODES, type EventState, type RevealMode } from "./events.ts";
import {
    GalleryPage,
    canSeePhotos,
    canSeeShot,
    canReserve,
    canShoot,
    Highlights,
    lateUploadsUntil,
    photoAccess,
    shootingPhase,
    LATE_UPLOAD_DAYS,
    type Viewer,
} from "./shots.ts";

const HOST = "host_1";
const startsAt = "2026-06-20T15:00:00-07:00";
const endsAt = "2026-06-20T23:00:00-07:00";
const beforeStart = new Date("2026-06-20T14:00:00-07:00");
const during = new Date("2026-06-20T18:00:00-07:00");
const after = new Date("2026-06-21T12:00:00-07:00");

function event(
    state: EventState,
    revealMode: RevealMode = "next-morning",
    visibility: "everyone" | "host-only" = "everyone",
) {
    return {
        state,
        hostId: HOST,
        settings: {
            startsAt,
            endsAt,
            timeZone: "America/Vancouver",
            revealMode,
            revealAt: revealMode === "custom" ? "2026-06-21T09:00:00-07:00" : undefined,
            visibility,
        },
    };
}

const host: Viewer = { kind: "host", hostId: HOST };
const otherHost: Viewer = { kind: "host", hostId: "host_2" };
const guest: Viewer = { kind: "guest", guestId: "guest_1" };
const anonymous: Viewer = { kind: "anonymous" };
const viewers = [host, otherHost, guest, anonymous];

describe("canSeePhotos", () => {
    test("nobody sees photos before the reveal, the host included", () => {
        for (const mode of REVEAL_MODES.filter((m) => m !== "right-away")) {
            for (const state of ["draft", "live", "ended"] as const) {
                for (const viewer of viewers) {
                    for (const now of [beforeStart, during, after]) {
                        expect(
                            canSeePhotos(event(state, mode), viewer, now),
                            `${state} ${mode} ${viewer.kind}`,
                        ).toBe(false);
                    }
                }
            }
        }
    });

    test("once revealed or archived, the host and guests see photos", () => {
        for (const mode of REVEAL_MODES) {
            for (const state of ["revealed", "archived"] as const) {
                expect(canSeePhotos(event(state, mode), host, after)).toBe(true);
                expect(canSeePhotos(event(state, mode), guest, after)).toBe(true);
            }
        }
    });

    test("right away shows photos from the start while live or ended", () => {
        expect(canSeePhotos(event("live", "right-away"), guest, during)).toBe(true);
        expect(canSeePhotos(event("ended", "right-away"), host, after)).toBe(true);
        expect(canSeePhotos(event("live", "right-away"), guest, beforeStart)).toBe(false);
        expect(canSeePhotos(event("draft", "right-away"), host, during)).toBe(false);
    });

    test("anonymous viewers and other hosts never see photos", () => {
        for (const state of EVENT_STATES) {
            for (const mode of REVEAL_MODES) {
                expect(canSeePhotos(event(state, mode), anonymous, after)).toBe(false);
                expect(canSeePhotos(event(state, mode), otherHost, after)).toBe(false);
            }
        }
    });

    test("host-only limits guests to their own photos", () => {
        const e = event("revealed", "next-morning", "host-only");
        expect(photoAccess(e, host, after)).toBe("all");
        expect(photoAccess(e, guest, after)).toBe("own");
        expect(photoAccess(event("revealed"), guest, after)).toBe("all");
        expect(photoAccess(event("live"), guest, during)).toBe("none");
    });

    test("covers every state, mode and viewer", () => {
        const table: string[] = [];
        for (const state of EVENT_STATES) {
            for (const mode of REVEAL_MODES) {
                for (const viewer of viewers) {
                    const seen = canSeePhotos(event(state, mode), viewer, after);
                    if (seen) table.push(`${state}/${mode}/${viewer.kind}`);
                }
            }
        }
        const expected: string[] = [];
        for (const state of EVENT_STATES) {
            for (const mode of REVEAL_MODES) {
                const open =
                    state === "revealed" ||
                    state === "archived" ||
                    (mode === "right-away" && (state === "live" || state === "ended"));
                if (open) expected.push(`${state}/${mode}/host`, `${state}/${mode}/guest`);
            }
        }
        expect(table.sort()).toEqual(expected.sort());
    });
});

describe("canSeeShot", () => {
    const mine = {
        guestId: "guest_1",
        state: "developed" as const,
        hidden: false,
    };
    const theirs = {
        guestId: "guest_2",
        state: "developed" as const,
        hidden: false,
    };
    const revealed = event("revealed");

    test("only developed photos are shown", () => {
        for (const state of ["reserved", "uploaded", "failed"] as const) {
            expect(canSeeShot(revealed, host, { ...mine, state }, after)).toBe(false);
        }
        expect(canSeeShot(revealed, guest, theirs, after)).toBe(true);
    });

    test("hidden photos stay visible to the host only", () => {
        expect(canSeeShot(revealed, host, { ...theirs, hidden: true }, after)).toBe(true);
        expect(canSeeShot(revealed, guest, { ...theirs, hidden: true }, after)).toBe(false);
        expect(canSeeShot(revealed, guest, { ...mine, hidden: true }, after)).toBe(false);
    });

    test("host-only shows a guest their own photos and nobody else's", () => {
        const e = event("revealed", "next-morning", "host-only");
        expect(canSeeShot(e, guest, mine, after)).toBe(true);
        expect(canSeeShot(e, guest, theirs, after)).toBe(false);
        expect(canSeeShot(e, host, theirs, after)).toBe(true);
    });

    test("nothing before the reveal", () => {
        expect(canSeeShot(event("live"), host, mine, during)).toBe(false);
        expect(canSeeShot(event("ended"), guest, mine, after)).toBe(false);
    });
});

describe("shootingPhase and canShoot", () => {
    const live = { state: "live" as const, startsAt, endsAt };

    test("a live event opens the camera at its start and closes it at its end", () => {
        expect(shootingPhase(live, beforeStart)).toBe("before");
        expect(canShoot(live, beforeStart)).toBe(false);
        expect(shootingPhase(live, new Date(startsAt))).toBe("open");
        expect(shootingPhase(live, during)).toBe("open");
        expect(canShoot(live, during)).toBe(true);
        expect(shootingPhase(live, new Date(endsAt))).toBe("closed");
        expect(canShoot(live, after)).toBe(false);
    });

    test("a draft is before; ended and later states are closed", () => {
        expect(shootingPhase({ ...live, state: "draft" }, during)).toBe("before");
        for (const state of ["draft", "ended", "revealed", "archived"] as const) {
            expect(canShoot({ ...live, state }, during)).toBe(false);
        }
        for (const state of ["ended", "revealed", "archived"] as const) {
            expect(shootingPhase({ ...live, state }, beforeStart)).toBe("closed");
        }
    });
});

describe("canReserve", () => {
    const end = Date.parse(endsAt);
    const revealsAt = "2026-06-21T10:00:00-07:00";
    const window = { startsAt, endsAt, revealsAt };
    const takenBefore = new Date(end - 60_000);
    const takenAfter = new Date(end + 60_000);
    const takenBeforeStart = new Date(Date.parse(startsAt) - 60_000);
    const dayMs = 86_400_000;
    const late = new Date(Date.parse(revealsAt) + (LATE_UPLOAD_DAYS - 1) * dayMs);
    const tooLate = new Date(Date.parse(revealsAt) + LATE_UPLOAD_DAYS * dayMs + 60_000);

    test("anything while the camera is open, nothing before it opens", () => {
        expect(canReserve({ state: "live", ...window }, during, during)).toBe(true);
        expect(canReserve({ state: "live", ...window }, beforeStart, beforeStart)).toBe(false);
    });

    test("a photo from the shooting window, until 7 days after the reveal", () => {
        for (const state of ["live", "ended", "revealed"] as const) {
            expect(canReserve({ state, ...window }, takenBefore, late)).toBe(true);
            expect(canReserve({ state, ...window }, takenBefore, tooLate)).toBe(false);
            expect(canReserve({ state, ...window }, takenAfter, late)).toBe(false);
            expect(canReserve({ state, ...window }, takenBeforeStart, late)).toBe(false);
        }
    });

    test("right-away events count the 7 days from the end", () => {
        const rightAway = { startsAt, endsAt, revealsAt: startsAt };
        expect(lateUploadsUntil(rightAway).getTime()).toBe(end + LATE_UPLOAD_DAYS * dayMs);
        expect(lateUploadsUntil(window).getTime()).toBe(
            Date.parse(revealsAt) + LATE_UPLOAD_DAYS * dayMs,
        );
    });

    test("never for drafts or archived events", () => {
        for (const state of ["draft", "archived"] as const) {
            expect(canReserve({ state, ...window }, takenBefore, late)).toBe(false);
        }
    });
});

describe("GalleryPage", () => {
    test("before the reveal it carries counts and no photos", () => {
        const page = GalleryPage.parse({
            kind: "developing",
            total: 212,
            mine: 9,
            photographers: 34,
            revealsAt: "2026-06-21T17:00:00Z",
            names: ["Priya", "Theo", "Priya"],
        });
        expect(page).not.toHaveProperty("items");
    });

    test("after the reveal it carries signed photos", () => {
        const page = GalleryPage.parse({
            kind: "photos",
            total: 1,
            mine: 0,
            photographers: 1,
            nextCursor: null,
            items: [
                {
                    id: "s1",
                    url: "https://example.com/s1.jpg",
                    thumbUrl: "https://example.com/s1-thumb.jpg",
                    width: 1200,
                    height: 1600,
                    placeholder: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
                    takenAt: "2026-06-20T23:42:00-07:00",
                    photographer: { id: "g1", name: "Priya" },
                    likes: 38,
                    likedByMe: false,
                    hidden: false,
                    reports: 0,
                },
            ],
        });
        expect(page.kind === "photos" && page.items[0]?.photographer.name).toBe("Priya");
    });

    test("highlights are photos only", () => {
        expect(Highlights.safeParse({ items: [] }).success).toBe(true);
        expect(Highlights.safeParse({ kind: "developing", total: 3 }).success).toBe(false);
    });

    test("a developing page with photos in it is refused", () => {
        const result = GalleryPage.safeParse({ kind: "developing", items: [] });
        expect(result.success).toBe(false);
        const tooMany = GalleryPage.safeParse({
            kind: "developing",
            total: 50,
            mine: 0,
            photographers: 1,
            revealsAt: "2026-06-21T17:00:00Z",
            names: Array.from({ length: 41 }, () => "Priya"),
        });
        expect(tooMany.success).toBe(false);
    });
});
