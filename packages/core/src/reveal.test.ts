import { describe, expect, test } from "vitest";
import { revealCountdown, revealTime, wallTime, zonedInstant, zonesDiffer } from "./reveal.ts";

const base = {
    startsAt: "2026-06-20T15:00:00-07:00",
    endsAt: "2026-06-20T23:00:00-07:00",
    timeZone: "America/Vancouver",
} as const;

function iso(d: Date): string {
    return d.toISOString();
}

function nextMorning(endsAt: string, timeZone: string): string {
    return iso(revealTime({ ...base, endsAt, timeZone, revealMode: "next-morning" }));
}

describe("revealTime", () => {
    test("right away reveals at the start", () => {
        expect(iso(revealTime({ ...base, revealMode: "right-away" }))).toBe(
            "2026-06-20T22:00:00.000Z",
        );
    });

    test("at the end reveals at the end", () => {
        expect(iso(revealTime({ ...base, revealMode: "at-end" }))).toBe("2026-06-21T06:00:00.000Z");
    });

    test("custom reveals at the chosen time", () => {
        const revealAt = "2026-06-22T19:30:00+01:00";
        expect(iso(revealTime({ ...base, revealMode: "custom", revealAt }))).toBe(
            "2026-06-22T18:30:00.000Z",
        );
    });

    test("next morning is 10:00 the day after the end, in the event's zone", () => {
        expect(nextMorning("2026-06-20T23:00:00-07:00", "America/Vancouver")).toBe(
            "2026-06-21T17:00:00.000Z",
        );
        expect(nextMorning("2026-05-01T20:00:00+05:30", "Asia/Kolkata")).toBe(
            "2026-05-02T04:30:00.000Z",
        );
    });

    test("an end in the small hours reveals the same morning", () => {
        expect(nextMorning("2026-06-21T01:00:00-07:00", "America/Vancouver")).toBe(
            "2026-06-21T17:00:00.000Z",
        );
        expect(nextMorning("2026-06-21T03:59:00-07:00", "America/Vancouver")).toBe(
            "2026-06-21T17:00:00.000Z",
        );
        expect(nextMorning("2026-06-21T04:00:00-07:00", "America/Vancouver")).toBe(
            "2026-06-22T17:00:00.000Z",
        );
    });

    test("next morning lands on 10:00 local when the clocks go back overnight", () => {
        // Vancouver leaves daylight time at 02:00 on 1 November 2026.
        const at = revealTime({
            ...base,
            endsAt: "2026-10-31T23:00:00-07:00",
            revealMode: "next-morning",
        });
        expect(iso(at)).toBe("2026-11-01T18:00:00.000Z");
        expect(wallTime(at, "America/Vancouver")).toMatchObject({
            day: 1,
            hour: 10,
            minute: 0,
        });
    });

    test("next morning lands on 10:00 local when the clocks go forward overnight", () => {
        expect(nextMorning("2026-03-07T22:00:00-08:00", "America/Vancouver")).toBe(
            "2026-03-08T17:00:00.000Z",
        );
        // London moves to summer time on 29 March 2026.
        expect(nextMorning("2026-03-28T23:30:00Z", "Europe/London")).toBe(
            "2026-03-29T09:00:00.000Z",
        );
        // Southern hemisphere: Sydney leaves daylight time on 5 April 2026.
        expect(nextMorning("2026-04-04T21:00:00+11:00", "Australia/Sydney")).toBe(
            "2026-04-05T00:00:00.000Z",
        );
    });

    test("next morning rolls over months and years", () => {
        expect(nextMorning("2026-12-31T22:00:00+13:00", "Pacific/Auckland")).toBe(
            "2026-12-31T21:00:00.000Z",
        );
        expect(nextMorning("2026-02-28T20:00:00Z", "UTC")).toBe("2026-03-01T10:00:00.000Z");
    });

    test("the same end instant reveals at different times in different zones", () => {
        const end = "2026-06-21T06:00:00Z";
        // 15:00 in Tokyo, so the next day there.
        expect(nextMorning(end, "Asia/Tokyo")).toBe("2026-06-22T01:00:00.000Z");
        // 23:00 the evening before in Vancouver.
        expect(nextMorning(end, "America/Vancouver")).toBe("2026-06-21T17:00:00.000Z");
    });
});

describe("zonedInstant", () => {
    test("finds the instant for a wall time on both sides of a DST change", () => {
        expect(iso(zonedInstant(2026, 3, 7, 10, 0, "America/New_York"))).toBe(
            "2026-03-07T15:00:00.000Z",
        );
        expect(iso(zonedInstant(2026, 3, 8, 10, 0, "America/New_York"))).toBe(
            "2026-03-08T14:00:00.000Z",
        );
        expect(iso(zonedInstant(2026, 7, 1, 10, 30, "Asia/Kathmandu"))).toBe(
            "2026-07-01T04:45:00.000Z",
        );
    });
});

describe("revealCountdown", () => {
    const zone = "America/Vancouver";
    const at = (s: string): Date => new Date(s);
    const ten = at("2026-06-21T10:00:00-07:00");

    test("counts down in hours and minutes inside twelve hours", () => {
        expect(revealCountdown(at("2026-06-20T23:42:00-07:00"), ten, zone)).toEqual({
            kind: "in",
            hours: 10,
            minutes: 18,
        });
        expect(revealCountdown(at("2026-06-21T09:42:00-07:00"), ten, zone)).toEqual({
            kind: "in",
            hours: 0,
            minutes: 18,
        });
        expect(revealCountdown(at("2026-06-21T07:00:00-07:00"), ten, zone)).toEqual({
            kind: "in",
            hours: 3,
            minutes: 0,
        });
    });

    test("rounds the last seconds up to a minute", () => {
        expect(revealCountdown(at("2026-06-21T09:59:30-07:00"), ten, zone)).toEqual({
            kind: "in",
            hours: 0,
            minutes: 1,
        });
        expect(revealCountdown(at("2026-06-20T22:01:00-07:00"), ten, zone)).toEqual({
            kind: "in",
            hours: 11,
            minutes: 59,
        });
    });

    test("is past once the time has come", () => {
        expect(revealCountdown(ten, ten, zone)).toEqual({ kind: "past" });
        expect(revealCountdown(at("2026-06-22T10:00:00-07:00"), ten, zone)).toEqual({
            kind: "past",
        });
    });

    test("names today, tomorrow, the weekday, or the date further out", () => {
        expect(
            revealCountdown(at("2026-06-21T06:00:00-07:00"), at("2026-06-21T19:30:00-07:00"), zone),
        ).toEqual({ kind: "today", time: "19:30" });
        expect(revealCountdown(at("2026-06-20T20:00:00-07:00"), ten, zone)).toEqual({
            kind: "tomorrow",
            time: "10:00",
        });
        expect(
            revealCountdown(at("2026-06-15T09:00:00-07:00"), at("2026-06-20T10:00:00-07:00"), zone),
        ).toEqual({ kind: "weekday", time: "10:00" });
        expect(
            revealCountdown(at("2026-06-15T09:00:00-07:00"), at("2026-11-22T10:00:00-08:00"), zone),
        ).toEqual({ kind: "date", time: "10:00", sameYear: true });
        expect(
            revealCountdown(at("2026-06-15T09:00:00-07:00"), at("2027-01-05T10:00:00-08:00"), zone),
        ).toEqual({ kind: "date", time: "10:00", sameYear: false });
    });

    test("uses the viewer's zone for the day and the clock", () => {
        const now = at("2026-06-20T22:00:00Z");
        const then = at("2026-06-21T12:00:00Z");
        expect(revealCountdown(now, then, "America/Vancouver")).toEqual({
            kind: "tomorrow",
            time: "05:00",
        });
        expect(revealCountdown(now, then, "Europe/London")).toEqual({
            kind: "tomorrow",
            time: "13:00",
        });
        expect(revealCountdown(now, then, "Asia/Tokyo")).toEqual({ kind: "today", time: "21:00" });
    });

    test("counts calendar days across a DST change", () => {
        expect(
            revealCountdown(at("2026-10-31T12:00:00-07:00"), at("2026-11-01T10:00:00-08:00"), zone),
        ).toEqual({ kind: "tomorrow", time: "10:00" });
    });

    test("falls back to the device zone", () => {
        expect(revealCountdown(at("2026-06-20T00:00:00Z"), at("2026-06-20T00:30:00Z"))).toEqual({
            kind: "in",
            hours: 0,
            minutes: 30,
        });
    });
});

describe("zonesDiffer", () => {
    const at = new Date("2026-06-21T17:00:00Z");

    test("names the zone only when the viewer's clock reads differently", () => {
        expect(zonesDiffer(at, "America/Vancouver", "America/Vancouver")).toBe(false);
        expect(zonesDiffer(at, "America/Vancouver", "America/Los_Angeles")).toBe(false);
        expect(zonesDiffer(at, "America/Vancouver", "America/Toronto")).toBe(true);
        expect(zonesDiffer(at, "Asia/Kolkata", "Asia/Dhaka")).toBe(true);
    });
});
