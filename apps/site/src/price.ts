import { formatPrice } from "@linger/core/pricing";

/** A tier's price as the site shows it, with the free tier named instead of "$0.00". */
export function tierPrice(cents: number): string {
    return cents === 0 ? "Free" : formatPrice(cents);
}
