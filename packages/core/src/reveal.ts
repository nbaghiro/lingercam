import type { EventSettings } from "./events.ts";

/** Local hour the next-morning reveal happens at. */
export const MORNING_HOUR = 10;
/** An event that ends before this local hour reveals the same morning, not the day after. */
export const SMALL_HOURS_END = 4;

type RevealSettings = Pick<EventSettings, "startsAt" | "endsAt" | "timeZone" | "revealMode"> & {
    revealAt?: string | undefined;
};

interface WallTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            weekday: "long",
        });
        formatters.set(timeZone, f);
    }
    return f;
}

/** The wall-clock time at an instant in a time zone. */
export function wallTime(at: Date, timeZone: string): WallTime {
    const parts: Record<string, string> = {};
    for (const p of formatter(timeZone).formatToParts(at)) parts[p.type] = p.value;
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        weekday: parts.weekday ?? "",
    };
}

/** The instant a wall-clock time happens in a time zone. */
export function zonedInstant(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timeZone: string,
): Date {
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let guess = target;
    // Two passes settle the offset, including when the guess and the answer straddle a DST change.
    for (let i = 0; i < 2; i++) {
        const w = wallTime(new Date(guess), timeZone);
        const seen = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
        guess += target - seen;
    }
    return new Date(guess);
}

/** When everyone sees the photos. */
export function revealTime(settings: RevealSettings): Date {
    switch (settings.revealMode) {
        case "right-away":
            return new Date(settings.startsAt);
        case "at-end":
            return new Date(settings.endsAt);
        case "custom":
            return new Date(settings.revealAt ?? settings.endsAt);
        case "next-morning": {
            const end = wallTime(new Date(settings.endsAt), settings.timeZone);
            const addDays = end.hour < SMALL_HOURS_END ? 0 : 1;
            const day = new Date(Date.UTC(end.year, end.month - 1, end.day + addDays));
            return zonedInstant(
                day.getUTCFullYear(),
                day.getUTCMonth() + 1,
                day.getUTCDate(),
                MORNING_HOUR,
                0,
                settings.timeZone,
            );
        }
    }
}

function clock(w: WallTime): string {
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

function dayNumber(w: WallTime): number {
    return Date.UTC(w.year, w.month - 1, w.day) / 86_400_000;
}

/** Below this, the countdown is in hours and minutes instead of naming the day. */
export const COUNTDOWN_HOURS = 12;

/**
 * How far off the reveal is, as data for the app to phrase: past; a countdown in hours and
 * minutes under COUNTDOWN_HOURS; then today, tomorrow, a weekday within a week, or a date. `time`
 * is the 24-hour clock time of the reveal in the viewer's zone (the device zone by default).
 */
export type RevealCountdown =
    | { kind: "past" }
    | { kind: "in"; hours: number; minutes: number }
    | { kind: "today" | "tomorrow" | "weekday"; time: string }
    | { kind: "date"; time: string; sameYear: boolean };

export function revealCountdown(now: Date, at: Date, timeZone?: string): RevealCountdown {
    const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ms = at.getTime() - now.getTime();
    if (ms <= 0) return { kind: "past" };
    const minutes = Math.ceil(ms / 60_000);
    if (minutes < COUNTDOWN_HOURS * 60) {
        return { kind: "in", hours: Math.floor(minutes / 60), minutes: minutes % 60 };
    }
    const today = wallTime(now, zone);
    const then = wallTime(at, zone);
    const days = dayNumber(then) - dayNumber(today);
    const time = clock(then);
    if (days === 0) return { kind: "today", time };
    if (days === 1) return { kind: "tomorrow", time };
    if (days < 7) return { kind: "weekday", time };
    return { kind: "date", time, sameYear: then.year === today.year };
}

/**
 * Whether two zones show a different clock at an instant, so a time in the event's zone needs the
 * zone named for this viewer ("10:00 Vancouver time"). Zones with the same offset count as one.
 */
export function zonesDiffer(at: Date, eventZone: string, viewerZone: string): boolean {
    if (eventZone === viewerZone) return false;
    const a = wallTime(at, eventZone);
    const b = wallTime(at, viewerZone);
    return a.day !== b.day || a.hour !== b.hour || a.minute !== b.minute;
}
