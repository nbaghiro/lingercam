import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
    Expo,
    type ExpoPushMessage,
    type ExpoPushReceipt,
    type ExpoPushTicket,
} from "expo-server-sdk";
import nodemailer from "nodemailer";
import { boss, db, events, guests, pushTokens } from "./db.ts";
import { errorDetail, log, maskEmail } from "./http.ts";

const accessToken = process.env.EXPO_ACCESS_TOKEN || undefined;
const mailFrom = process.env.MAIL_FROM ?? "LingerCam <hello@lingercam.app>";
const mailer = nodemailer.createTransport(pooled(process.env.SMTP_URL ?? "smtp://localhost:8177"));
const joinUrl = process.env.JOIN_URL ?? "http://localhost:8173";

/** Keeps a few SMTP connections open, so a reveal's emails don't each open a new one. */
export function pooled(url: string): string {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("pool")) parsed.searchParams.set("pool", "true");
    return parsed.toString();
}

/** Minutes before Expo's receipts are checked; Expo has them within 15 minutes. */
export const RECEIPT_MINUTES = 15;

async function sendWithExpo(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (!accessToken) {
        log("info", "push skipped, EXPO_ACCESS_TOKEN is not set", { count: messages.length });
        return [];
    }
    const expo = new Expo({ accessToken });
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
        tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
    }
    return tickets;
}

async function receiptsFromExpo(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
    if (!accessToken) return {};
    const expo = new Expo({ accessToken });
    const out: Record<string, ExpoPushReceipt> = {};
    for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
        Object.assign(out, await expo.getPushNotificationReceiptsAsync(chunk));
    }
    return out;
}

/** Replaceable so tests can see what would be sent and answer for Expo. */
export const push = { send: sendWithExpo, receipts: receiptsFromExpo };

/** Replaceable so tests can fail a send; real sends go to Mailpit locally. */
export const mail = {
    async send(message: { to: string; subject: string; text: string }): Promise<void> {
        await mailer.sendMail({ from: mailFrom, ...message });
    },
};

export interface SentTicket {
    id: string;
    token: string;
}

function isDead(result: ExpoPushTicket | ExpoPushReceipt): boolean {
    return result.status === "error" && result.details?.error === "DeviceNotRegistered";
}

async function prune(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
    log("info", "push tokens pruned", { count: tokens.length });
}

/**
 * Sends through Expo, drops tokens Expo says are gone, and queues a receipt check for the rest.
 * A failure is logged, never thrown, so a push can't fail the request that caused it.
 */
export async function sendPush(messages: ExpoPushMessage[]): Promise<number> {
    const valid = messages.filter((m) => typeof m.to === "string" && Expo.isExpoPushToken(m.to));
    if (valid.length === 0) return 0;
    try {
        const tickets = await push.send(valid);
        const dead: string[] = [];
        const sent: SentTicket[] = [];
        tickets.forEach((ticket, i) => {
            const token = valid[i]?.to;
            if (typeof token !== "string") return;
            if (ticket.status === "ok") sent.push({ id: ticket.id, token });
            else if (isDead(ticket)) dead.push(token);
            else log("warn", "push ticket error", { detail: ticket.message });
        });
        await prune(dead);
        if (sent.length > 0) {
            const at = new Date(Date.now() + RECEIPT_MINUTES * 60_000);
            await boss.sendAfter("push-receipts", { tickets: sent }, null, at);
        }
    } catch (error) {
        log("warn", "push failed", { error: errorDetail(error) });
    }
    return valid.length;
}

/** Reads Expo's receipts for sent pushes and removes tokens whose device has gone. */
export async function checkReceipts(tickets: SentTicket[]): Promise<number> {
    const receipts = await push.receipts(tickets.map((t) => t.id));
    const dead = tickets.filter((t) => {
        const receipt = receipts[t.id];
        return receipt !== undefined && isDead(receipt);
    });
    await prune(dead.map((t) => t.token));
    return dead.length;
}

export async function startNotifyWorkers(): Promise<void> {
    await boss.work<{ tickets: SentTicket[] }>("push-receipts", async (jobs) => {
        for (const job of jobs) await checkReceipts(job.data.tickets);
    });
}

/** Tokens for the host of an event, and with `guests` for every device that joined it. */
export async function eventTokens(
    event: { id: string; hostId: string },
    options: { guests: boolean },
): Promise<string[]> {
    const rows = options.guests
        ? await db
              .selectDistinct({ token: pushTokens.token })
              .from(pushTokens)
              .leftJoin(
                  guests,
                  and(eq(guests.device, pushTokens.device), eq(guests.eventId, event.id)),
              )
              .where(or(eq(pushTokens.hostId, event.hostId), isNotNull(guests.id)))
        : await db
              .select({ token: pushTokens.token })
              .from(pushTokens)
              .where(eq(pushTokens.hostId, event.hostId));
    return rows.map((r) => r.token);
}

/** Sends an email; returns false and logs when it couldn't be sent. */
export async function sendMail(message: {
    to: string;
    subject: string;
    text: string;
}): Promise<boolean> {
    try {
        await mail.send(message);
        return true;
    } catch (error) {
        log(
            "error",
            "email failed",
            { email: maskEmail(message.to), error: errorDetail(error) },
            error,
        );
        return false;
    }
}

function plural(n: number, one: string, many: string): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Maya turns thirty: the photos are ready. 612 moments from 34 people." */
export function revealLine(title: string, photos: number, people: number): string {
    const ready = `${title}: the photos are ready.`;
    if (photos === 0) return ready;
    return `${ready} ${plural(photos, "moment", "moments")} from ${plural(people, "person", "people")}.`;
}

export function fullLine(title: string): string {
    return `${title} is full. Make room for more guests.`;
}

export function hiddenLine(title: string): string {
    return `A photo at ${title} was hidden after reports.`;
}

/** What the notifications need to know about an event. */
interface Notified {
    id: string;
    hostId: string;
    code: string;
    settings: { title: string };
}

/** Tells the host once per guest limit that a guest was turned away because the event is full. */
export async function notifyFull(event: Notified): Promise<boolean> {
    const [claimed] = await db
        .update(events)
        .set({ fullNoticeLimit: sql`${events.guestLimit}` })
        .where(
            and(
                eq(events.id, event.id),
                sql`${events.fullNoticeLimit} is distinct from ${events.guestLimit}`,
            ),
        )
        .returning({ id: events.id });
    if (!claimed) return false;
    const tokens = await eventTokens(event, { guests: false });
    await sendPush(
        tokens.map((to) => ({
            to,
            body: fullLine(event.settings.title),
            sound: "default",
            data: { type: "full", url: `/e/${event.code}`, code: event.code },
        })),
    );
    return true;
}

/** Where reports reach LingerCam, so someone at LingerCam can act on them as the terms promise. */
export const moderationEmail = () => process.env.MODERATION_EMAIL || "support@lingercam.app";

/** Emails LingerCam about a new report, with enough to find the photo. */
export async function emailReport(report: {
    code: string;
    title: string;
    shotId: string;
    photographer: string;
    reports: number;
    hidden: boolean;
}): Promise<boolean> {
    return sendMail({
        to: moderationEmail(),
        subject: `Report: a photo in ${report.title} (${report.code})`,
        text: [
            `A photo was reported at ${report.title}, event code ${report.code}.`,
            ``,
            `Photo: ${report.shotId}`,
            `Taken by: ${report.photographer}`,
            `Reports so far: ${report.reports}${report.hidden ? " (hidden from guests)" : ""}`,
            ``,
            `The host can hide or remove it from the event's Manage tools.`,
        ].join("\n"),
    });
}

/** Tells the host that reports hid a photo. */
export async function notifyHidden(event: Notified): Promise<void> {
    const tokens = await eventTokens(event, { guests: false });
    await sendPush(
        tokens.map((to) => ({
            to,
            body: hiddenLine(event.settings.title),
            sound: "default",
            data: { type: "hidden", url: `/e/${event.code}`, code: event.code },
        })),
    );
}

/**
 * A silent push to the host and every guest device, so apps reschedule or cancel their local
 * reveal reminder: "reveal-changed" carries the new time, "deleted" means the event is gone.
 */
export async function notifyQuietly(
    event: Notified,
    change: { type: "reveal-changed"; revealsAt: string } | { type: "deleted" },
): Promise<void> {
    const tokens = await eventTokens(event, { guests: true });
    await sendPush(
        tokens.map((to) => ({
            to,
            contentAvailable: true,
            priority: "normal",
            data: { ...change, code: event.code },
        })),
    );
}

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** How long an email link can move a guest to another device. */
export const RESTORE_DAYS = 7;

/**
 * A fresh link that moves a guest to whichever device opens it, once, within a week. Each new
 * link replaces the last, so only the newest email works.
 */
export async function restoreLink(guestId: string, code: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db
        .update(guests)
        .set({ restoreHash: hashToken(token), restoreIssuedAt: new Date() })
        .where(eq(guests.id, guestId));
    return `${joinUrl}/j/${code}?restore=${token}`;
}

/** The reveal email for a browser guest who left an address. */
export async function emailReveal(
    guest: { id: string; email: string },
    event: Notified,
    line: string,
): Promise<boolean> {
    const link = await restoreLink(guest.id, event.code);
    const title = event.settings.title;
    return sendMail({
        to: guest.email,
        subject: `${title}: the photos are ready`,
        text:
            `${line}\n\nOpen the event to see them:\n${link}\n\n` +
            "The link opens the event as you, in any browser. It works once, for " +
            `${RESTORE_DAYS} days. You asked for this email when you joined ${title}, and it's ` +
            "the only one we send about it.\n",
    });
}

/** "I joined on another device": the link that brings this guest back on a new device. */
export async function emailRestore(
    guest: { id: string; email: string },
    event: Notified,
): Promise<boolean> {
    const link = await restoreLink(guest.id, event.code);
    const title = event.settings.title;
    return sendMail({
        to: guest.email,
        subject: `Open ${title} on this device`,
        text:
            `Here's your link to ${title}:\n${link}\n\n` +
            "It opens the event as you, with your photos, on the phone or browser you open it " +
            `on. It works once, for ${RESTORE_DAYS} days. Your other device will need a new ` +
            "link to get back in. If you didn't ask for this, you can ignore it.\n",
    });
}
