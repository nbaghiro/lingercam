import { revealCountdown } from "@linger/core/reveal";
import { requireOptionalNativeModule } from "expo";

import type { EventSummary } from "@/api";
import { formatTime, revealLabel, t } from "@/copy";

// The Live Activity on the lock screen and in the Dynamic Island while a guest shoots. Its job is
// the shooting window: it starts with the first photo, moves with each one, goes stale at the
// end and then reads "The camera has closed. Photos at 10:00." The native side lives in
// modules/live-activity and the views in targets/activity; elsewhere these calls do nothing.

interface ActivityState {
    left: string;
    progress: number | null;
    moments: string;
    reveal: string;
    /** Shown once the camera has closed. */
    closed: string;
    endsAt: number;
    revealsAt: number;
}

interface LiveActivity {
    show(code: string, title: string, state: ActivityState): Promise<void>;
    /** Ends with the closed line, which the system keeps on the lock screen for a while. */
    close(code: string, state: ActivityState): Promise<void>;
    end(code: string): Promise<void>;
    endPast(): Promise<void>;
}

const native = requireOptionalNativeModule<LiveActivity>("LiveActivity");
const moments = new Map<string, number>();
const lastState = new Map<string, ActivityState>();

function revealPhrase(summary: EventSummary, now: Date): string {
    const at = new Date(summary.revealsAt);
    // A countdown such as "in 3h" would go stale on the lock screen, so it reads as a clock time.
    if (revealCountdown(now, at, summary.timeZone).kind === "in") {
        return t("activity.revealsAt", { time: formatTime(at, summary.timeZone) });
    }
    return revealLabel(now, at, summary.timeZone);
}

function stateFor(summary: EventSummary, left: number | null, count: number): ActivityState {
    const total = summary.shotsPerGuest;
    const limited = total !== null && left !== null;
    const shotsLeft = limited ? Math.min(left, total) : null;
    return {
        left:
            shotsLeft === 0
                ? t("activity.rollDone")
                : shotsLeft !== null && total !== null
                  ? t("activity.shotsLeft", { left: shotsLeft, total })
                  : t("camera.unlimited"),
        progress:
            shotsLeft !== null && total !== null && total > 0 ? (total - shotsLeft) / total : null,
        moments: t("activity.moments", { count }),
        reveal: revealPhrase(summary, new Date()),
        closed: t("activity.closed", {
            time: formatTime(new Date(summary.revealsAt), summary.timeZone),
        }),
        endsAt: Date.parse(summary.endsAt),
        revealsAt: Date.parse(summary.revealsAt),
    };
}

/**
 * Starts or moves the activity after a photo. `left` is what remains after it. The moments count
 * comes from the summary the camera already has, plus the photos taken here since.
 */
export async function trackShot(summary: EventSummary, left: number | null): Promise<void> {
    if (!native) return;
    const count = Math.max((moments.get(summary.code) ?? 0) + 1, summary.photoCount + 1);
    moments.set(summary.code, count);
    const state = stateFor(summary, left, count);
    lastState.set(summary.code, state);
    await native.show(summary.code, summary.title, state);
}

/** The camera closed while the app was open: the activity says so and leaves on its own. */
export async function closeActivity(summary: EventSummary): Promise<void> {
    const state = lastState.get(summary.code);
    if (!native || !state) return;
    lastState.delete(summary.code);
    await native.close(summary.code, { ...state, reveal: revealPhrase(summary, new Date()) });
}

/** Ends the activity once the photos are out. */
export async function endActivity(code: string): Promise<void> {
    await native?.end(code);
}

/** Closes any activity whose camera closed while the app wasn't running. */
export async function endPastActivities(): Promise<void> {
    await native?.endPast();
}
