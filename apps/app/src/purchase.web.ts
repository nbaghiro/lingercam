import { UNLIMITED_SHOTS, tier as tierById, type TierId } from "@linger/core/pricing";

import { api, type Event } from "@/api";

export interface PurchaseRequest {
    event: Event;
    hostId: string;
    tier: TierId;
    unlimitedShots: boolean;
}

export type PurchaseResult =
    { kind: "paid"; event: Event } | { kind: "cancelled"; event: Event } | { kind: "redirected" };

export function productIds(tier: TierId, unlimitedShots: boolean): string[] {
    const ids: string[] = [];
    const productId = tierById(tier).productId;
    if (productId) ids.push(productId);
    if (unlimitedShots) ids.push(UNLIMITED_SHOTS.productId);
    return ids;
}

/** Stripe applies card payments through its webhook, so the web has nothing left to claim. */
export async function claimPending(): Promise<void> {}

/**
 * Sends the host to Stripe Checkout, which returns them to the event page once paid. In local
 * development the API's development claim applies the products without a card.
 */
export async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    if (__DEV__) {
        let event = request.event;
        for (const id of productIds(request.tier, request.unlimitedShots)) {
            event = await api.billing.devClaim(event.id, id);
        }
        return { kind: "paid", event };
    }
    const { url } = await api.billing.checkout(
        request.event.id,
        request.tier,
        request.unlimitedShots,
    );
    globalThis.location.assign(url);
    return { kind: "redirected" };
}
