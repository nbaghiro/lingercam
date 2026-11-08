import { ARCHIVE_AFTER_DAYS, dueState } from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import { and, count, countDistinct, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { boss, db, events, guests, shots } from "./db.ts";
import type { EventRow } from "./events.ts";
import { log } from "./http.ts";
import { emailReveal, eventTokens, revealLine, sendPush } from "./notify.ts";

const DAY_MS = 86_400_000;

/** Photos everyone can see once the event is revealed, and how many people took them. */
export async function revealedCounts(eventId: string): Promise<{ photos: number; people: number }> {
    const [row] = await db
        .select({ photos: count(), people: countDistinct(shots.guestId) })
        .from(shots)
        .where(
            and(eq(shots.eventId, eventId), eq(shots.state, "developed"), eq(shots.hidden, false)),
        );
    return { photos: row?.photos ?? 0, people: row?.people ?? 0 };
}

/**
 * Tells the host and every guest with a stored token that the photos are in, with the counts,
 * and queues one email for each guest who left an address and hasn't had it yet.
 */
export async function notifyReveal(event: EventRow): Promise<number> {
    const { photos, people } = await revealedCounts(event.id);
    const line = revealLine(event.settings.title, photos, people);
    const tokens = await eventTokens(event, { guests: true });
    const sent = await sendPush(
        tokens.map((to) => ({
            to,
            body: line,
            sound: "default",
            data: { type: "revealed", url: `/e/${event.code}`, code: event.code },
        })),
    );
    const waiting = await db
        .select({ id: guests.id })
        .from(guests)
        .where(
            and(eq(guests.eventId, event.id), isNotNull(guests.email), isNull(guests.emailedAt)),
        );
    for (const guest of waiting) {
        await boss.send("reveal-email", { guestId: guest.id, line }, EMAIL_RETRIES);
    }
    return sent + waiting.length;
}

/** About an hour of retries, for a mail provider that's down for a while. */
const EMAIL_RETRIES = { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 };

/**
 * Sends one guest's reveal email and marks it sent only once it has gone, so a crash or a failed
 * send leaves it for the retry. Returns false when there was nothing to send.
 */
export async function sendRevealEmail(guestId: string, line: string): Promise<boolean> {
    const [row] = await db
        .select({ guest: guests, event: events })
        .from(guests)
        .innerJoin(events, eq(events.id, guests.eventId))
        .where(eq(guests.id, guestId));
    if (!row?.guest.email || row.guest.emailedAt) return false;
    if (!(await emailReveal({ id: guestId, email: row.guest.email }, row.event, line))) {
        throw new Error("reveal email not sent");
    }
    await db.update(guests).set({ emailedAt: new Date() }).where(eq(guests.id, guestId));
    return true;
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

/** How long past its reveal time an event can stay unrevealed before it's reported as an error. */
const LATE_REVEAL_MS = 10 * 60_000;

/**
 * Reveals, ends or archives everything that is overdue, for example after downtime. An event
 * that can't be moved on, or is still unrevealed well past its reveal time, is logged as an error,
 * which Sentry turns into an alert.
 */
export async function revealOverdue(now = new Date()): Promise<number> {
    const archiveBefore = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY_MS);
    const due = await db
        .select({ id: events.id, state: events.state, settings: events.settings })
        .from(events)
        .where(
            or(
                and(
                    eq(events.state, "live"),
                    sql`(${events.settings}->>'endsAt')::timestamptz <= ${now.toISOString()}::timestamptz`,
                ),
                eq(events.state, "ended"),
                and(eq(events.state, "revealed"), lt(events.revealedAt, archiveBefore)),
            ),
        );
    let changed = 0;
    for (const { id, state, settings } of due) {
        try {
            const after = await advance(id, now);
            if (after && after.state !== state) changed++;
            const late = now.getTime() - revealTime(settings).getTime() > LATE_REVEAL_MS;
            if (after && (after.state === "live" || after.state === "ended") && late) {
                log("error", "event is past its reveal time and hasn't revealed", { eventId: id });
            }
        } catch (error) {
            log("error", "overdue event could not advance", { eventId: id }, error);
        }
    }
    return changed;
}

/** Every minute, in case a reveal job fired early or was lost. */
export async function startRevealWorker(): Promise<void> {
    // Many events reveal on the same minute, so several are worked on side by side.
    await boss.work<{ eventId: string }>("reveal", { localConcurrency: 4 }, async (jobs) => {
        for (const job of jobs) await advance(job.data.eventId);
    });
    await boss.work<{ guestId: string; line: string }>(
        "reveal-email",
        { localConcurrency: 4 },
        async (jobs) => {
            for (const job of jobs) await sendRevealEmail(job.data.guestId, job.data.line);
        },
    );
    await boss.work("reveal-sweep", async () => {
        const changed = await revealOverdue();
        if (changed > 0) log("info", "overdue events advanced", { changed });
    });
    await boss.schedule("reveal-sweep", "* * * * *");
}

/** Drops the queued end, reveal and archive checks of an event that is being deleted. */
export async function cancelReveal(eventId: string): Promise<number> {
    const jobs = await boss.findJobs<{ eventId: string }>("reveal", {
        data: { eventId },
        queued: true,
    });
    if (jobs.length > 0)
        await boss.deleteJob(
            "reveal",
            jobs.map((j) => j.id),
        );
    return jobs.length;
}
