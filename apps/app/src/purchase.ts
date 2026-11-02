import { UNLIMITED_SHOTS, tier as tierById, type TierId } from "@linger/core/pricing";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { z } from "zod";

import { api, asApiError, currentHostId, storage, type Event } from "@/api";

export interface PurchaseRequest {
    event: Event;
    hostId: string;
    tier: TierId;
    unlimitedShots: boolean;
}

/**
 * "redirected" only happens on the web, where Stripe takes over the page. A cancelled purchase
 * still returns the event, since a product bought before the cancel may already have changed it.
 */
export type PurchaseResult =
    { kind: "paid"; event: Event } | { kind: "cancelled"; event: Event } | { kind: "redirected" };

const storeKey =
    Platform.OS === "ios"
        ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

let configuredFor: string | null = null;

function configure(hostId: string): void {
    if (!storeKey) return;
    if (configuredFor === null) {
        Purchases.configure({ apiKey: storeKey, appUserID: hostId });
        configuredFor = hostId;
    }
}

/** The store products for a tier and the add-on, in the order they are bought. */
export function productIds(tier: TierId, unlimitedShots: boolean): string[] {
    const ids: string[] = [];
    const productId = tierById(tier).productId;
    if (productId) ids.push(productId);
    if (unlimitedShots) ids.push(UNLIMITED_SHOTS.productId);
    return ids;
}

function isCancelled(error: unknown): boolean {
    return typeof error === "object" && error !== null && "userCancelled" in error
        ? Boolean((error as { userCancelled?: boolean }).userCancelled)
        : false;
}

// Store transactions the API hasn't confirmed yet. Each is saved before its claim is sent and
// removed once the claim succeeds, so a payment is never left unapplied by a dropped connection.

const PENDING_KEY = "pendingClaims";
const MAX_TRIES = 10;

const PendingClaim = z.object({
    hostId: z.string(),
    eventId: z.string(),
    productId: z.string(),
    transactionId: z.string(),
    tries: z.number().int(),
});
type PendingClaim = z.infer<typeof PendingClaim>;

function readPending(): PendingClaim[] {
    try {
        const raw = storage.getString(PENDING_KEY);
        const parsed = raw ? z.array(PendingClaim).safeParse(JSON.parse(raw)) : null;
        return parsed?.success ? parsed.data : [];
    } catch {
        return [];
    }
}

function writePending(list: PendingClaim[]): void {
    storage.set(PENDING_KEY, JSON.stringify(list));
}

function sameClaim(a: PendingClaim, b: PendingClaim): boolean {
    return a.transactionId === b.transactionId && a.productId === b.productId;
}

/** Claims that will never succeed: the event is gone or over, or the product is unknown. */
const HOPELESS = new Set(["not-found", "wrong-state", "unknown-product", "already-covered"]);

async function sendClaim(claim: PendingClaim): Promise<Event | null> {
    try {
        const event = await api.billing.claim(claim.eventId, claim.productId, claim.transactionId);
        writePending(readPending().filter((c) => !sameClaim(c, claim)));
        return event;
    } catch (error) {
        const { code } = asApiError(error);
        const tries = claim.tries + 1;
        const keep = !HOPELESS.has(code) && tries < MAX_TRIES;
        writePending(
            readPending().flatMap((c) =>
                sameClaim(c, claim) ? (keep ? [{ ...c, tries }] : []) : [c],
            ),
        );
        throw error;
    }
}

/** True when a store payment for this host hasn't reached the API yet. */
export function hasPendingClaims(hostId: string): boolean {
    return readPending().some((c) => c.hostId === hostId);
}

/** Purchases go through the API's development claim, with no store and no card. */
export function testPurchases(): boolean {
    return !storeKey;
}

export interface StorePrice {
    /** The store's own string, such as "CA$13.99". */
    priceString: string;
    price: number;
    currencyCode: string;
}

/**
 * The store's localized price for each product it knows, by product id. Empty without a store
 * key or when the store can't be reached, so callers fall back to core's prices.
 */
export async function storePrices(
    hostId: string,
    ids: string[],
): Promise<Record<string, StorePrice>> {
    if (!storeKey || ids.length === 0) return {};
    configure(hostId);
    const products = await Purchases.getProducts(ids, Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
    const prices: Record<string, StorePrice> = {};
    for (const p of products) {
        prices[p.identifier] = {
            priceString: p.priceString,
            price: p.price,
            currencyCode: p.currencyCode,
        };
    }
    return prices;
}

/** Sends any claims left over from an earlier purchase. Called on launch and before buying. */
export async function claimPending(): Promise<void> {
    const hostId = currentHostId();
    if (!storeKey || !hostId) return;
    for (const claim of readPending().filter((c) => c.hostId === hostId)) {
        await sendClaim(claim).catch(() => null);
    }
}

/**
 * Pays for a tier and the add-on through the App Store or Google Play with RevenueCat, and has
 * the API verify each transaction. Without a RevenueCat key (local development) the API's
 * development claim applies the products instead.
 */
export async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const ids = productIds(request.tier, request.unlimitedShots);
    let event = request.event;

    if (!storeKey) {
        for (const id of ids) event = await api.billing.devClaim(event.id, id);
        return { kind: "paid", event };
    }

    configure(request.hostId);
    if (configuredFor !== request.hostId) await Purchases.logIn(request.hostId);
    configuredFor = request.hostId;
    // The API's webhook reads this to apply a purchase whose claim never arrived.
    await Purchases.setAttributes({ eventId: event.id });

    const products = await Purchases.getProducts(ids, Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
    for (const id of ids) {
        const product = products.find((p) => p.identifier === id);
        if (!product) throw new Error(`The store has no product ${id}`);
        let transactionId: string;
        try {
            const result = await Purchases.purchaseStoreProduct(product);
            transactionId = result.transaction.transactionIdentifier;
        } catch (error) {
            if (isCancelled(error)) return { kind: "cancelled", event };
            throw error;
        }
        const claim = {
            hostId: request.hostId,
            eventId: event.id,
            productId: id,
            transactionId,
            tries: 0,
        };
        writePending([...readPending(), claim]);
        event = (await sendClaim(claim)) ?? event;
    }
    return { kind: "paid", event };
}
