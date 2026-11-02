import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
    CURRENCY,
    productById,
    TIERS,
    UNLIMITED_SHOTS,
    isTierId,
    tier as tierById,
    type Product,
} from "@linger/core/pricing";
import { and, eq, isNull, like } from "drizzle-orm";
import { Hono } from "hono";
import Stripe from "stripe";
import { z } from "zod";
import { requireHost, type Host } from "./accounts.ts";
import { db, events, purchases } from "./db.ts";
import { hostEventJson, ownedEvent, type EventRow } from "./events.ts";
import { ApiError, body, devRoutes, errorDetail, log } from "./http.ts";

type Store = (typeof purchases.$inferInsert)["store"];

const revenueCatKey = process.env.REVENUECAT_SECRET_KEY || null;
const revenueCatWebhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH || null;
const stripeKey = process.env.STRIPE_SECRET_KEY || null;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;
const joinUrl = process.env.JOIN_URL ?? "http://localhost:8173";
const stripe = stripeKey ? new Stripe(stripeKey) : null;

/** Upgrades only make sense before the reveal. */
const OVER_STATES = new Set(["revealed", "archived"]);

/** Refuses a purchase that would charge the host for nothing. */
function assertWorthBuying(event: EventRow, productId: string): void {
    if (OVER_STATES.has(event.state)) {
        throw new ApiError(409, "wrong-state", "This event is over, so it can't be upgraded.");
    }
    const bought = product(productId);
    if (bought.kind === "tier" && bought.tier.guests <= event.guestLimit) {
        throw new ApiError(409, "already-covered", "This event already has room for that many.");
    }
    if (bought.kind === "addon" && event.unlimitedShots) {
        throw new ApiError(409, "already-covered", "This event already has unlimited shots.");
    }
}

function product(productId: string): Product {
    const found = productById(productId);
    if (!found) throw new ApiError(400, "unknown-product", "We don't sell that product.");
    return found;
}

/**
 * Applies a purchase to an event once per store transaction. A tier raises the guest limit;
 * the add-on makes shots unlimited.
 */
export async function applyPurchase(input: {
    hostId: string;
    eventId: string;
    productId: string;
    store: Store;
    transactionId: string;
}): Promise<EventRow> {
    const bought = product(input.productId);
    return db.transaction(async (tx) => {
        const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, input.eventId))
            .for("update");
        if (!event || event.hostId !== input.hostId) {
            throw new ApiError(404, "not-found", "We couldn't find that event.");
        }
        const [already] = await tx
            .select({ id: purchases.id })
            .from(purchases)
            .where(
                and(
                    eq(purchases.store, input.store),
                    eq(purchases.transactionId, input.transactionId),
                ),
            );
        if (already) return event;
        if (OVER_STATES.has(event.state)) {
            throw new ApiError(409, "wrong-state", "This event is over, so it can't be upgraded.");
        }
        const [recorded] = await tx
            .insert(purchases)
            .values(input)
            .onConflictDoNothing({ target: [purchases.store, purchases.transactionId] })
            .returning();
        if (!recorded) return event;
        const change =
            bought.kind === "tier"
                ? bought.tier.guests > event.guestLimit
                    ? { tier: bought.tier.id, guestLimit: bought.tier.guests }
                    : {}
                : { unlimitedShots: true, settings: { ...event.settings, shotsPerGuest: null } };
        if (Object.keys(change).length === 0) return event;
        const [updated] = await tx
            .update(events)
            .set(change)
            .where(eq(events.id, event.id))
            .returning();
        log("info", "purchase applied", { eventId: event.id, productId: input.productId });
        return updated ?? event;
    });
}

/**
 * Marks purchases refunded. Store transactions match exactly; a Stripe payment matches every
 * product bought with it (`<payment intent>:<product>`).
 */
async function markRefunded(
    store: Store,
    match: { transactionId: string } | { paymentIntent: string },
): Promise<void> {
    const escape = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const which =
        "transactionId" in match
            ? eq(purchases.transactionId, match.transactionId)
            : like(purchases.transactionId, `${escape(match.paymentIntent)}:%`);
    const rows = await db
        .update(purchases)
        .set({ refundedAt: new Date() })
        .where(and(eq(purchases.store, store), which, isNull(purchases.refundedAt)))
        .returning({ id: purchases.id, eventId: purchases.eventId });
    // The event keeps its limits: guests already in shouldn't lose their place.
    for (const r of rows)
        log("warn", "purchase refunded", { purchaseId: r.id, eventId: r.eventId });
}

function sameSecret(given: string | undefined, expected: string): boolean {
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(given ?? ""), digest(expected));
}

interface RevenueCatTransaction {
    id?: string;
    store_transaction_id?: string;
    store?: string;
}

/** Looks the transaction up on RevenueCat, which the app identifies by the host's id. */
async function verifyWithRevenueCat(
    host: Host,
    productId: string,
    transactionId: string,
): Promise<{ store: Store; transactionId: string }> {
    const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(host.id)}`,
        { headers: { Authorization: `Bearer ${revenueCatKey}` } },
    );
    if (!res.ok) {
        log("error", "revenuecat lookup failed", { status: res.status });
        throw new ApiError(502, "store-unavailable", "We couldn't reach the store. Try again.");
    }
    const data = (await res.json()) as {
        subscriber?: { non_subscriptions?: Record<string, RevenueCatTransaction[]> };
    };
    const found = (data.subscriber?.non_subscriptions?.[productId] ?? []).find(
        (t) => t.store_transaction_id === transactionId || t.id === transactionId,
    );
    if (!found) throw new ApiError(402, "not-purchased", "We couldn't find that purchase.");
    return {
        store: found.store === "play_store" ? "play-store" : "app-store",
        transactionId: found.store_transaction_id ?? transactionId,
    };
}

const Claim = z.object({
    eventId: z.uuid(),
    productId: z.string(),
    transactionId: z.string().min(1).max(200),
});

export const billing = new Hono();

billing.get("/v1/pricing", (c) =>
    c.json({ currency: CURRENCY, tiers: TIERS, unlimitedShots: UNLIMITED_SHOTS }),
);

billing.post("/v1/billing/claim", async (c) => {
    const host = await requireHost(c);
    const input = await body(c, Claim);
    if (!revenueCatKey) {
        throw new ApiError(503, "store-not-configured", "Store purchases aren't set up here.");
    }
    await ownedEvent(host, input.eventId);
    product(input.productId);
    const verified = await verifyWithRevenueCat(host, input.productId, input.transactionId);
    const event = await applyPurchase({ hostId: host.id, ...input, ...verified });
    return c.json({ event: await hostEventJson(event) });
});

billing.post("/v1/billing/checkout", async (c) => {
    const host = await requireHost(c);
    const input = await body(
        c,
        z.object({
            eventId: z.uuid(),
            tier: z.string().refine(isTierId).optional(),
            unlimitedShots: z.boolean().default(false),
        }),
    );
    const event = await ownedEvent(host, input.eventId);
    const items = [
        ...(input.tier && input.tier !== "free" ? [tierById(input.tier)] : []).map((t) => ({
            productId: t.productId ?? "",
            name: `Up to ${t.guests} guests`,
            cents: t.priceCents,
        })),
        ...(input.unlimitedShots
            ? [
                  {
                      productId: UNLIMITED_SHOTS.productId,
                      name: "Unlimited shots",
                      cents: UNLIMITED_SHOTS.priceCents,
                  },
              ]
            : []),
    ];
    if (items.length === 0)
        throw new ApiError(400, "nothing-to-buy", "Choose a tier or the add-on.");
    for (const item of items) assertWorthBuying(event, item.productId);
    if (!stripe)
        throw new ApiError(503, "checkout-not-configured", "Card payments aren't set up here.");
    const back = `${joinUrl}/e/${event.code}`;
    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: host.email,
        line_items: items.map((item) => ({
            quantity: 1,
            price_data: {
                currency: CURRENCY.toLowerCase(),
                unit_amount: item.cents,
                product_data: { name: `${event.settings.title}: ${item.name}` },
            },
        })),
        metadata: {
            hostId: host.id,
            eventId: event.id,
            products: items.map((item) => item.productId).join(","),
        },
        success_url: `${back}?paid=1`,
        cancel_url: back,
    });
    if (!session.url)
        throw new ApiError(502, "checkout-failed", "Checkout didn't start. Try again.");
    return c.json({ url: session.url });
});

billing.post("/v1/billing/dev-claim", async (c) => {
    if (!devRoutes) throw new ApiError(404, "not-found", "Not found.");
    const host = await requireHost(c);
    const input = await body(c, z.object({ eventId: z.uuid(), productId: z.string() }));
    assertWorthBuying(await ownedEvent(host, input.eventId), input.productId);
    const event = await applyPurchase({
        hostId: host.id,
        eventId: input.eventId,
        productId: input.productId,
        store: "dev",
        transactionId: randomUUID(),
    });
    return c.json({ event: await hostEventJson(event) });
});

const RevenueCatEvent = z.object({
    type: z.string(),
    store: z.string().optional(),
    transaction_id: z.string().optional(),
    product_id: z.string().optional(),
    app_user_id: z.string().optional(),
    subscriber_attributes: z.record(z.string(), z.object({ value: z.string() })).optional(),
});

/**
 * RevenueCat's webhook. A purchase is applied here too, in case the app's claim never arrived
 * (the app sets the `eventId` attribute before buying); applying is once per transaction, so the
 * claim and the webhook can both run. Refunds are recorded.
 */
billing.post("/v1/billing/webhooks/revenuecat", async (c) => {
    if (
        !revenueCatWebhookAuth ||
        !sameSecret(c.req.header("authorization"), revenueCatWebhookAuth)
    ) {
        throw new ApiError(401, "unauthorized", "Unauthorized.");
    }
    const parsed = z.object({ event: RevenueCatEvent }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ received: true });
    const e = parsed.data.event;
    const store: Store = e.store === "PLAY_STORE" ? "play-store" : "app-store";
    if (e.type === "CANCELLATION" && e.transaction_id) {
        await markRefunded(store, { transactionId: e.transaction_id });
    }
    const eventId = e.subscriber_attributes?.eventId?.value;
    if (
        e.type === "NON_RENEWING_PURCHASE" &&
        e.transaction_id &&
        e.product_id &&
        z.uuid().safeParse(e.app_user_id).success &&
        z.uuid().safeParse(eventId).success
    ) {
        try {
            await applyPurchase({
                hostId: e.app_user_id ?? "",
                eventId: eventId ?? "",
                productId: e.product_id,
                store,
                transactionId: e.transaction_id,
            });
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            log("warn", "store purchase not applied", { eventId, code: error.code });
        }
    }
    return c.json({ received: true });
});

billing.post("/v1/billing/webhooks/stripe", async (c) => {
    const signature = c.req.header("stripe-signature");
    if (!stripe || !stripeWebhookSecret || !signature) {
        throw new ApiError(400, "bad-signature", "Missing signature.");
    }
    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(
            await c.req.text(),
            signature,
            stripeWebhookSecret,
        );
    } catch {
        throw new ApiError(400, "bad-signature", "The signature doesn't match.");
    }
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const meta = session.metadata ?? {};
        const intent =
            typeof session.payment_intent === "string" ? session.payment_intent : session.id;
        if (meta.hostId && meta.eventId && session.payment_status === "paid") {
            const unapplied: string[] = [];
            for (const productId of (meta.products ?? "").split(",").filter(Boolean)) {
                try {
                    await applyPurchase({
                        hostId: meta.hostId,
                        eventId: meta.eventId,
                        productId,
                        store: "stripe",
                        transactionId: `${intent}:${productId}`,
                    });
                } catch (error) {
                    if (!(error instanceof ApiError)) throw error;
                    log("warn", "card payment not applied", {
                        eventId: meta.eventId,
                        code: error.code,
                    });
                    unapplied.push(productId);
                }
            }
            // The host paid for something the event can no longer get, for example a checkout
            // finished after the reveal. Give the money back instead of letting Stripe retry.
            if (unapplied.length > 0 && typeof session.payment_intent === "string") {
                const cents = unapplied.reduce((sum, id) => {
                    const bought = product(id);
                    return sum + (bought.kind === "tier" ? bought.tier : bought.addOn).priceCents;
                }, 0);
                await stripe.refunds.create({
                    payment_intent: session.payment_intent,
                    amount: cents,
                });
                for (const id of unapplied) {
                    await db
                        .insert(purchases)
                        .values({
                            hostId: meta.hostId,
                            eventId: meta.eventId,
                            productId: id,
                            store: "stripe",
                            transactionId: `${intent}:${id}`,
                            refundedAt: new Date(),
                        })
                        .onConflictDoNothing()
                        .catch((error: unknown) =>
                            log("warn", "refund not recorded", { error: errorDetail(error) }),
                        );
                }
            }
        }
    } else if (event.type === "charge.refunded") {
        const intent = event.data.object.payment_intent;
        if (typeof intent === "string") await markRefunded("stripe", { paymentIntent: intent });
    }
    return c.json({ received: true });
});
