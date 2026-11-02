export const TIER_IDS = ["free", "tier-30", "tier-80", "tier-150", "tier-250"] as const;
export type TierId = (typeof TIER_IDS)[number];

export interface Tier {
    id: TierId;
    guests: number;
    priceCents: number;
    /** Consumable product id on the App Store and Google Play; null for the free tier. */
    productId: string | null;
    popular: boolean;
}

export const TIERS: readonly Tier[] = [
    { id: "free", guests: 10, priceCents: 0, productId: null, popular: false },
    {
        id: "tier-30",
        guests: 30,
        priceCents: 999,
        productId: "linger.tier.30",
        popular: false,
    },
    {
        id: "tier-80",
        guests: 80,
        priceCents: 1999,
        productId: "linger.tier.80",
        popular: true,
    },
    {
        id: "tier-150",
        guests: 150,
        priceCents: 3499,
        productId: "linger.tier.150",
        popular: false,
    },
    {
        id: "tier-250",
        guests: 250,
        priceCents: 4999,
        productId: "linger.tier.250",
        popular: false,
    },
];

export interface AddOn {
    id: "unlimited";
    priceCents: number;
    productId: string;
}

export const UNLIMITED_SHOTS: AddOn = {
    id: "unlimited",
    priceCents: 999,
    productId: "linger.addon.unlimited",
};

export const CURRENCY = "USD";

export function isTierId(value: string): value is TierId {
    return (TIER_IDS as readonly string[]).includes(value);
}

export function tier(id: TierId): Tier {
    const found = TIERS.find((t) => t.id === id);
    if (!found) throw new Error(`Unknown tier ${id}`);
    return found;
}

export type Product = { kind: "tier"; tier: Tier } | { kind: "addon"; addOn: AddOn };

export function productById(productId: string): Product | null {
    if (productId === UNLIMITED_SHOTS.productId) return { kind: "addon", addOn: UNLIMITED_SHOTS };
    const found = TIERS.find((t) => t.productId === productId);
    return found ? { kind: "tier", tier: found } : null;
}

/** "$9.99", or "Free" for zero. */
export function formatPrice(cents: number): string {
    if (cents === 0) return "Free";
    return `$${(cents / 100).toFixed(2)}`;
}

export interface Due {
    /** The tier to buy, or null when the event already has room for that many guests. */
    tier: Tier | null;
    /** The add-on to buy, or null when it isn't chosen or the event already has it. */
    addOn: AddOn | null;
    cents: number;
}

/**
 * What a host still pays for a tier and, if chosen, unlimited shots: only what the event doesn't
 * already have, so nothing is bought twice. `event` is null before the event exists.
 */
export function due(
    event: { guestLimit: number; unlimitedShots: boolean } | null,
    id: TierId,
    unlimitedShots: boolean,
): Due {
    const wanted = tier(id);
    const needsTier = wanted.priceCents > 0 && wanted.guests > (event?.guestLimit ?? 0);
    const needsAddOn = unlimitedShots && !(event?.unlimitedShots ?? false);
    const t = needsTier ? wanted : null;
    const addOn = needsAddOn ? UNLIMITED_SHOTS : null;
    return { tier: t, addOn, cents: (t?.priceCents ?? 0) + (addOn?.priceCents ?? 0) };
}
