import { eq } from "drizzle-orm";
import { boss, db, events, hosts, pushTokens } from "./db.ts";
import type { EventRow } from "./events.ts";
import { notifyQuietly } from "./notify.ts";
import { cancelReveal } from "./reveal.ts";
import { keys, removePrefix, UPLOAD_SECONDS } from "./storage.ts";

/** Retries for most of a day, so a storage outage delays a delete instead of dropping it. */
const REMOVE_RETRIES = { retryLimit: 12, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 };

/**
 * Deletes everything under a prefix in a job: an event can hold tens of thousands of files, more
 * than a request has time for, and a failure is retried instead of leaving them behind. With
 * `after`, the job waits, for uploads still on their way.
 */
export async function removeLater(prefix: string, after?: Date): Promise<void> {
    if (!prefix.endsWith("/") || prefix === "/") throw new Error(`Refusing to remove "${prefix}"`);
    if (after) await boss.sendAfter("remove-files", { prefix }, REMOVE_RETRIES, after);
    else await boss.send("remove-files", { prefix }, REMOVE_RETRIES);
}

/**
 * When every upload URL signed now has run out. A photo can still land until then, so a second
 * pass at this time removes anything that was on its way.
 */
export function afterUploadsExpire(now = Date.now()): Date {
    return new Date(now + (UPLOAD_SECONDS + 60) * 1000);
}

/**
 * Removes an event. Devices hear quietly, so reveal reminders are cancelled; its queued checks are
 * dropped; then the rows go, and the files follow in a job, twice.
 */
export async function deleteEvent(event: EventRow): Promise<void> {
    await notifyQuietly(event, { type: "deleted" });
    await cancelReveal(event.id);
    await db.delete(events).where(eq(events.id, event.id));
    await removeLater(keys.event(event.id));
    await removeLater(keys.event(event.id), afterUploadsExpire());
}

/**
 * Removes each of the host's events as above, then the host; every other row cascades from it,
 * including push tokens registered while signed in. `device` also removes the tokens this device
 * registered as a guest.
 */
export async function deleteHost(hostId: string, device: string | null = null): Promise<void> {
    const owned = await db.select().from(events).where(eq(events.hostId, hostId));
    for (const event of owned) await deleteEvent(event);
    if (device) await db.delete(pushTokens).where(eq(pushTokens.device, device));
    await db.delete(hosts).where(eq(hosts.id, hostId));
}

export async function startDeletionWorkers(): Promise<void> {
    await boss.work<{ prefix: string }>("remove-files", async (jobs) => {
        for (const job of jobs) await removePrefix(job.data.prefix);
    });
}
