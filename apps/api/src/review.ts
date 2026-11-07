import { localDay, seedHost, type SeedEvent } from "./seed.ts";
import { reviewAccount } from "./accounts.ts";
import { log } from "./http.ts";
import { startQueue, stopQueue } from "./db.ts";

const ZONE = "America/Vancouver";
const HOUR = 3_600_000;
const iso = (d: Date) => d.toISOString();

/**
 * App Review's events. A live event with photos showing right away, so a reviewer who joins with
 * its code sees their own shots appear; a revealed event with a full gallery and recap; and a
 * draft. The codes go in the review notes. Running it again resets them.
 */
function plan(now: Date): SeedEvent[] {
    return [
        {
            code: "RVW4PP",
            state: "live",
            tier: "tier-30",
            cover: "p-group.jpg",
            revealedAt: null,
            settings: {
                occasion: "party",
                title: "App Review party",
                startsAt: iso(new Date(now.getTime() - HOUR)),
                endsAt: iso(new Date(now.getTime() + 30 * 24 * HOUR)),
                timeZone: ZONE,
                revealMode: "right-away",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Lena W.", "Tom B.", "Ade O."],
            photos: ["p-cheer.jpg", "p-hug.jpg", "p-dance.jpg", "b-laugh.jpg"],
        },
        {
            code: "RVW8TF",
            state: "revealed",
            tier: "free",
            cover: "w-hero.jpg",
            revealedAt: localDay(-2, 10),
            settings: {
                occasion: "wedding",
                title: "Emma & Daniel's wedding",
                startsAt: iso(localDay(-3, 15)),
                endsAt: iso(localDay(-3, 23)),
                timeZone: ZONE,
                revealMode: "next-morning",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: ["Sofia M.", "Jun K.", "Priya R.", "Marco D."],
            photos: [
                "w-toast.jpg",
                "w-speech.jpg",
                "w-dance.jpg",
                "w-clink.jpg",
                "w-walk.jpg",
                "w-lights.jpg",
                "w-bouquet.jpg",
                "w-elders.jpg",
            ],
        },
        {
            code: "RVW2DR",
            state: "draft",
            tier: "free",
            cover: null,
            revealedAt: null,
            settings: {
                occasion: "birthday",
                title: "Maya turns thirty",
                startsAt: iso(localDay(10, 19)),
                endsAt: iso(localDay(10, 23)),
                timeZone: ZONE,
                revealMode: "at-end",
                shotsPerGuest: 24,
                visibility: "everyone",
                look: "warm-98@1",
            },
            guests: [],
            photos: [],
        },
    ];
}

/** Puts the review host and their events in place. Runs in production, unlike the demo seed. */
export async function seedReview(now = new Date()): Promise<string[]> {
    const review = reviewAccount();
    if (!review) throw new Error("Set REVIEW_EMAIL and a six-digit REVIEW_CODE first");
    await startQueue();
    const specs = plan(now);
    await seedHost(review.email, "App Review", specs);
    return specs.map((s) => s.code);
}

if (import.meta.main) {
    seedReview()
        .then(async (codes) => {
            log("info", "review account ready", { codes });
            await stopQueue();
            process.exit(0);
        })
        .catch((error: unknown) => {
            log("error", "review seed failed", { error: String(error) });
            process.exit(1);
        });
}
