import { ARCHIVE_AFTER_DAYS, dueState } from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { boss, db, events, guests, pushTokens } from "./db.ts";
import type { EventRow } from "./events.ts";
import { errorDetail, log } from "./http.ts";

const DAY_MS = 86_400_000;
const accessToken = process.env.EXPO_ACCESS_TOKEN || undefined;

async function sendWithExpo(messages: ExpoPushMessage[]): Promise<void> {
    if (!accessToken) {
        log("info", "push skipped, EXPO_ACCESS_TOKEN is not set", { count: messages.length });
        return;
    }
    const expo = new Expo({ accessToken });
    for (const chunk of expo.chunkPushNotifications(messages)) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
            if (ticket.status === "error")
                log("warn", "push ticket error", { detail: ticket.message });
        }
    }
}

/** Replaceable so tests can see what would be sent. */
export const push = { send: sendWithExpo };

/** Tells the host and every guest with a stored token that the photos are in. */
export async function notifyReveal(event: EventRow): Promise<number> {
    const rows = await db
        .selectDistinct({ token: pushTokens.token })
        .from(pushTokens)
        .leftJoin(guests, and(eq(guests.device, pushTokens.device), eq(guests.eventId, event.id)))
        .where(or(eq(pushTokens.hostId, event.hostId), isNotNull(guests.id)));
    const messages: ExpoPushMessage[] = rows
        .filter((r) => Expo.isExpoPushToken(r.token))
        .map((r) => ({
            to: r.token,
            title: event.settings.title,
            // The same line as the app's local reveal notification.
            body: "The photos are ready.",
            sound: "default",
            data: { url: `/e/${event.code}`, code: event.code },
        }));
    if (messages.length === 0) return 0;
    try {
        await push.send(messages);
    } catch (error) {
        log("warn", "push failed", { eventId: event.id, error: errorDetail(error) });
    }
    return messages.length;
}

/**
 * Moves an event to whatever state its times call for and, when that is the reveal, sends the
 * notifications. Safe to run any number of times.
 */
export async function advance(eventId: string, now = new Date()): Promise<EventRow | null> {
    const result = await db.transaction(async (tx) => {
        const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
        if (!event) return null;
        const next = dueState(event.state, event.settings, event.revealedAt, now);
        if (next === event.state) return { event, revealed: false };
        const [updated] = await tx
            .update(events)
            .set({ state: next, ...(next === "revealed" ? { revealedAt: now } : {}) })
            .where(eq(events.id, eventId))
            .returning();
        return { event: updated ?? event, revealed: next === "revealed" };
    });
    if (!result) return null;
    if (result.revealed) {
        log("info", "event revealed", { eventId });
        const archiveAt = new Date(now.getTime() + ARCHIVE_AFTER_DAYS * DAY_MS);
        await boss.sendAfter("reveal", { eventId }, null, archiveAt);
        await notifyReveal(result.event);
    }
    return result.event;
}

/** Queues a check at the end time and at the reveal time; each check runs `advance`. */
export async function scheduleReveal(event: EventRow): Promise<void> {
    const now = Date.now();
    const times = new Set([
        Date.parse(event.settings.endsAt),
        revealTime(event.settings).getTime(),
    ]);
    for (const at of times) {
        if (at > now) await boss.sendAfter("reveal", { eventId: event.id }, null, new Date(at));
    }
}

/** Reveals, ends or archives everything that is overdue, for example after downtime. */
export async function revealOverdue(now = new Date()): Promise<number> {
    const archiveBefore = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY_MS);
    const due = await db
        .select({ id: events.id, state: events.state })
        .from(events)
        .where(
            or(
                inArray(events.state, ["live", "ended"]),
                and(eq(events.state, "revealed"), lt(events.revealedAt, archiveBefore)),
            ),
        );
    let changed = 0;
    for (const { id, state } of due) {
        const after = await advance(id, now);
        if (after && after.state !== state) changed++;
    }
    return changed;
}

export async function startRevealWorker(): Promise<void> {
    await boss.work<{ eventId: string }>("reveal", async (jobs) => {
        for (const job of jobs) await advance(job.data.eventId);
    });
}
