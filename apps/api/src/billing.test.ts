import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyPurchase } from "./billing.ts";
import { db, events, purchases, startQueue, stopQueue } from "./db.ts";
import { call, join, newEvent, newHost } from "./testing.ts";

beforeAll(startQueue);
afterAll(stopQueue);

describe("pricing", () => {
    test("lists the tiers and the add-on from core", async () => {
        const res = await call("GET", "/v1/pricing");
        expect(res.body.currency).toBe("USD");
        expect(Object.values(res.body.tiers ?? {}).map((t) => t.guests)).toEqual([
            10, 30, 80, 150, 250,
        ]);
        expect(res.body.unlimitedShots?.productId).toBe("linger.addon.unlimited");
    });
});

describe("dev claims", () => {
    test("a tier raises the guest limit, and one that wouldn't is refused before paying", async () => {
        const { token } = await newHost();
        const event = await newEvent(token);
        const big = await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.80" },
        });
        expect(big.body.event).toMatchObject({ tier: "tier-80", guestLimit: 80 });
        const small = await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.30" },
        });
        expect(small.body.code).toBe("already-covered");
        const rows = await db.select().from(purchases).where(eq(purchases.eventId, event.id));
        expect(rows).toHaveLength(1);
    });

    test("the unlimited add-on sets shots per guest to null", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true, settings: { shotsPerGuest: 5 } });
        const res = await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.addon.unlimited" },
        });
        expect(res.body.event?.unlimitedShots).toBe(true);
        expect(res.body.event?.settings?.shotsPerGuest).toBeNull();
        const guest = await join(event.code);
        for (let i = 0; i < 7; i++) {
            const r = await call("POST", `/v1/e/${event.code}/shots`, { device: guest.device });
            expect(r.status).toBe(201);
        }
        expect(
            (await call("GET", `/v1/e/${event.code}/me`, { device: guest.device })).body.shotsLeft,
        ).toBeNull();
        expect((await call("GET", `/v1/e/${event.code}`)).body.event?.shotsPerGuest).toBeNull();
    });

    test("refuses unknown products, other hosts' events and finished events", async () => {
        const { token } = await newHost();
        const other = await newHost();
        const event = await newEvent(token, { live: true });
        const unknown = await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.9000" },
        });
        expect(unknown.body.code).toBe("unknown-product");
        const notMine = await call("POST", "/v1/billing/dev-claim", {
            token: other.token,
            json: { eventId: event.id, productId: "linger.tier.30" },
        });
        expect(notMine.status).toBe(404);
        expect(
            (
                await call("POST", "/v1/billing/dev-claim", {
                    json: { eventId: event.id, productId: "linger.tier.30" },
                })
            ).status,
        ).toBe(401);
        await call("POST", `/v1/events/${event.id}/end`, { token });
        const over = await call("POST", "/v1/billing/dev-claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.30" },
        });
        expect(over.body.code).toBe("wrong-state");
    });

    test("a store transaction applies once", async () => {
        const { token, hostId } = await newHost();
        const event = await newEvent(token);
        const input = {
            hostId,
            eventId: event.id,
            productId: "linger.tier.30",
            store: "app-store" as const,
            transactionId: "tx-1",
        };
        expect((await applyPurchase(input)).guestLimit).toBe(30);
        expect((await applyPurchase({ ...input, productId: "linger.tier.150" })).guestLimit).toBe(
            30,
        );
    });
});

describe("stores without keys", () => {
    test("claim and checkout say they aren't configured", async () => {
        const { token } = await newHost();
        const event = await newEvent(token);
        const claim = await call("POST", "/v1/billing/claim", {
            token,
            json: { eventId: event.id, productId: "linger.tier.30", transactionId: "1000000001" },
        });
        expect(claim.status).toBe(503);
        expect(claim.body.code).toBe("store-not-configured");
        const checkout = await call("POST", "/v1/billing/checkout", {
            token,
            json: { eventId: event.id, tier: "tier-30" },
        });
        expect(checkout.body.code).toBe("checkout-not-configured");
    });

    test("checkout refuses finished events and tiers the event already has", async () => {
        const { token } = await newHost();
        const event = await newEvent(token, { live: true });
        const free = await call("POST", "/v1/billing/checkout", {
            token,
            json: { eventId: event.id, tier: "free", unlimitedShots: false },
        });
        expect(free.body.code).toBe("nothing-to-buy");
        await call("POST", `/v1/events/${event.id}/end`, { token });
        const over = await call("POST", "/v1/billing/checkout", {
            token,
            json: { eventId: event.id, tier: "tier-30" },
        });
        expect(over.body.code).toBe("wrong-state");
    });

    test("webhooks check their credentials", async () => {
        const rc = { event: { type: "CANCELLATION", store: "APP_STORE", transaction_id: "tx-x" } };
        expect((await call("POST", "/v1/billing/webhooks/revenuecat", { json: rc })).status).toBe(
            401,
        );
        const ok = await call("POST", "/v1/billing/webhooks/revenuecat", {
            json: rc,
            headers: { authorization: "test-webhook-auth" },
        });
        expect(ok.status).toBe(200);
        const stripe = await call("POST", "/v1/billing/webhooks/stripe", {
            json: { type: "checkout.session.completed" },
            headers: { "stripe-signature": "t=1,v1=forged" },
        });
        expect(stripe.status).toBe(400);
    });
});

describe("the RevenueCat webhook", () => {
    const auth = { authorization: "test-webhook-auth" };

    test("applies a purchase the app never claimed, once", async () => {
        const { token, hostId } = await newHost();
        const event = await newEvent(token);
        const json = {
            event: {
                type: "NON_RENEWING_PURCHASE",
                store: "APP_STORE",
                transaction_id: "3000000001",
                product_id: "linger.tier.80",
                app_user_id: hostId,
                subscriber_attributes: { eventId: { value: event.id } },
            },
        };
        for (let i = 0; i < 2; i++) {
            const res = await call("POST", "/v1/billing/webhooks/revenuecat", {
                json,
                headers: auth,
            });
            expect(res.status).toBe(200);
        }
        const [row] = await db.select().from(events).where(eq(events.id, event.id));
        expect(row?.guestLimit).toBe(80);
        const rows = await db.select().from(purchases).where(eq(purchases.eventId, event.id));
        expect(rows).toHaveLength(1);
    });

    test("a refund marks only that exact transaction", async () => {
        const { token, hostId } = await newHost();
        const event = await newEvent(token);
        const base = { hostId, eventId: event.id, store: "app-store" as const };
        await applyPurchase({ ...base, productId: "linger.tier.30", transactionId: "2000000123" });
        await applyPurchase({ ...base, productId: "linger.tier.80", transactionId: "20000001234" });
        await call("POST", "/v1/billing/webhooks/revenuecat", {
            json: {
                event: { type: "CANCELLATION", store: "APP_STORE", transaction_id: "2000000123" },
            },
            headers: auth,
        });
        const rows = await db.select().from(purchases).where(eq(purchases.eventId, event.id));
        const refunded = rows.filter((r) => r.refundedAt !== null).map((r) => r.transactionId);
        expect(refunded).toEqual(["2000000123"]);
    });
});
