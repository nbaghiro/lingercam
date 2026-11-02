import { describe, expect, test } from "vitest";
import {
    TIERS,
    UNLIMITED_SHOTS,
    formatPrice,
    isTierId,
    productById,
    tier,
    due,
} from "./pricing.ts";

describe("tiers", () => {
    test("match the published prices", () => {
        expect(TIERS.map((t) => [t.guests, t.priceCents])).toEqual([
            [10, 0],
            [30, 999],
            [80, 1999],
            [150, 3499],
            [250, 4999],
        ]);
    });

    test("only the 80 guest tier is marked popular", () => {
        expect(TIERS.filter((t) => t.popular).map((t) => t.id)).toEqual(["tier-80"]);
    });

    test("guest limits and prices both rise", () => {
        for (let i = 1; i < TIERS.length; i++) {
            const prev = TIERS[i - 1];
            const cur = TIERS[i];
            expect(cur?.guests).toBeGreaterThan(prev?.guests ?? Infinity);
            expect(cur?.priceCents).toBeGreaterThan(prev?.priceCents ?? Infinity);
        }
    });

    test("tier looks up by id and throws for unknown ids", () => {
        expect(tier("tier-150").guests).toBe(150);
        expect(() => tier("tier-999" as never)).toThrow();
        expect(isTierId("free")).toBe(true);
        expect(isTierId("tier-31")).toBe(false);
    });
});

describe("store products", () => {
    test("ids are fixed for both stores", () => {
        expect([
            ...TIERS.map((t) => t.productId).filter((id) => id !== null),
            UNLIMITED_SHOTS.productId,
        ]).toEqual([
            "linger.tier.30",
            "linger.tier.80",
            "linger.tier.150",
            "linger.tier.250",
            "linger.addon.unlimited",
        ]);
        expect(TIERS[0]?.productId).toBeNull();
    });

    test("productById resolves tiers and the add-on", () => {
        expect(productById("linger.tier.80")).toEqual({
            kind: "tier",
            tier: tier("tier-80"),
        });
        expect(productById("linger.addon.unlimited")).toEqual({
            kind: "addon",
            addOn: UNLIMITED_SHOTS,
        });
        expect(productById("linger.tier.10")).toBeNull();
        expect(productById("")).toBeNull();
    });
});

describe("prices", () => {
    test("unlimited shots cost $9.99", () => {
        expect(UNLIMITED_SHOTS.priceCents).toBe(999);
    });

    test("formatPrice writes dollars, or Free", () => {
        expect(formatPrice(0)).toBe("Free");
        expect(formatPrice(999)).toBe("$9.99");
        expect(formatPrice(4999)).toBe("$49.99");
        expect(formatPrice(1000)).toBe("$10.00");
    });

    test("due adds the add-on before the event exists", () => {
        expect(due(null, "free", false).cents).toBe(0);
        expect(due(null, "free", true).cents).toBe(999);
        expect(due(null, "tier-80", true).cents).toBe(2998);
    });

    test("due leaves out what the event already has", () => {
        const draft = { guestLimit: 10, unlimitedShots: false };
        expect(due(draft, "tier-30", false)).toMatchObject({ addOn: null, cents: 999 });
        const bought = { guestLimit: 80, unlimitedShots: false };
        expect(due(bought, "tier-80", true)).toMatchObject({ tier: null, cents: 999 });
        expect(due(bought, "tier-30", false)).toEqual({ tier: null, addOn: null, cents: 0 });
        expect(due({ guestLimit: 80, unlimitedShots: true }, "tier-150", true)).toMatchObject({
            addOn: null,
            cents: 3499,
        });
    });
});
