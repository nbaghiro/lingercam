import { ARCHIVE_AFTER_DAYS, dueState } from "@linger/core/events";
import { revealTime } from "@linger/core/reveal";
import { and, count, countDistinct, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
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
 * and emails each guest who left an address and hasn't had the email yet.
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
    // Claimed before sending, so a second run of the job can't email anyone twice.
    const claimed = await db
        .update(guests)
        .set({ emailedAt: new Date() })
        .where(and(eq(guests.eventId, event.id), isNotNull(guests.email), isNull(guests.emailedAt)))
        .returning({ id: guests.id, email: guests.email });
    let emailed = 0;
    for (const guest of claimed) {
        if (guest.email && (await emailReveal({ id: guest.id, email: guest.email }, event, line))) {
            emailed++;
        }
    }
    return sent + emailed;
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

/** Every minute, in case a reveal job fired early or was lost. */
export async function startRevealWorker(): Promise<void> {
    await boss.work<{ eventId: string }>("reveal", async (jobs) => {
        for (const job of jobs) await advance(job.data.eventId);
    });
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
