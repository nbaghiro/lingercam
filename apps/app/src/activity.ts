import { revealCountdown } from "@linger/core/reveal";
import { requireOptionalNativeModule } from "expo";

import { api, type EventSummary } from "@/api";
import { formatTime, revealLabel, t } from "@/copy";

// The Live Activity on the lock screen and in the Dynamic Island while a guest shoots. It starts
// with the first photo, moves with each one and ends at the reveal. The native side lives in
// modules/live-activity and the views in targets/activity; elsewhere these calls do nothing.

interface ActivityState {
    left: string;
    progress: number | null;
    moments: string;
    reveal: string;
    revealsAt: number;
}

interface LiveActivity {
    show(code: string, title: string, ready: string, state: ActivityState): Promise<void>;
    end(code: string): Promise<void>;
    endPast(): Promise<void>;
}

const native = requireOptionalNativeModule<LiveActivity>("LiveActivity");
const moments = new Map<string, number>();

async function eventMoments(code: string): Promise<number> {
    const counted = (moments.get(code) ?? 0) + 1;
    try {
        const page = await api.guest.gallery(code);
        return page.kind === "developing" ? Math.max(page.total, counted) : counted;
    } catch {
        return counted;
    }
}

function revealPhrase(summary: EventSummary, now: Date): string {
    const at = new Date(summary.revealsAt);
    // A countdown such as "in 3h" would go stale on the lock screen, so it reads as a clock time.
    if (revealCountdown(now, at, summary.timeZone).kind === "in") {
        return t("activity.revealsAt", { time: formatTime(at, summary.timeZone) });
    }
    return revealLabel(now, at, summary.timeZone);
}

/** Starts or moves the activity after a photo. `left` is what remains after it. */
export async function trackShot(summary: EventSummary, left: number | null): Promise<void> {
    if (!native) return;
    const count = await eventMoments(summary.code);
    moments.set(summary.code, count);
    const total = summary.shotsPerGuest;
    const limited = total !== null && left !== null;
    await native.show(summary.code, summary.title, t("notify.revealBody"), {
        left: limited
            ? t("activity.shotsLeft", { left: Math.min(left, total), total })
            : t("camera.unlimited"),
        progress: limited && total > 0 ? (total - Math.min(left, total)) / total : null,
        moments: t("activity.moments", { count }),
        reveal: revealPhrase(summary, new Date()),
        revealsAt: Date.parse(summary.revealsAt),
    });
}

/** Ends the activity once the photos are out. */
export async function endActivity(code: string): Promise<void> {
    await native?.end(code);
}

/** Ends any activity whose reveal passed while the app was closed. */
export async function endPastActivities(): Promise<void> {
    await native?.endPast();
}
