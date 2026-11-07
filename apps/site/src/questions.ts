// Every question the site answers. The home page shows a few of them; /questions/ shows them all,
// grouped. Facts come from core, so the answers can't drift from what the app does.
import { LATE_JOIN_MS, MAX_SHOTS, MIN_SHOTS } from "@linger/core/events";
import { LOOK_IDS, LOOKS } from "@linger/core/film";
import { TIERS, UNLIMITED_SHOTS, formatPrice } from "@linger/core/pricing";

export interface Question {
    q: string;
    /** May hold simple inline HTML: links only. */
    a: string;
    /** Shown on the home page as well. */
    home?: boolean;
}

const free = TIERS[0];
const smallest = TIERS[1];
const largest = TIERS[TIERS.length - 1];
const [natural, warm, mono] = LOOK_IDS.map((id) => LOOKS[id]);
const lateHours = LATE_JOIN_MS / 3_600_000;
const support = '<a href="mailto:support@lingercam.app">support@lingercam.app</a>';

export const QUESTION_GROUPS: { title: string; questions: Question[] }[] = [
    {
        title: "Guests",
        questions: [
            {
                q: "Do guests need to download an app?",
                a: "No. Guests scan the event's QR code and the camera opens in their browser, with nothing to install. Guests who already have the LingerCam app join in the app instead. Only the host needs it.",
                home: true,
            },
            {
                q: "How many photos can each guest take?",
                a: `The host sets a number between ${MIN_SHOTS} and ${MAX_SHOTS} shots per guest, and the camera counts them down beside the shutter. Unlimited shots are an add-on for any event.`,
                home: true,
            },
            {
                q: "The camera won't open",
                a: "Check that your browser has permission to use the camera. On iPhone that's in Settings, under Safari, Camera. On Android it's in the browser's site settings. Then reload the page.",
            },
            {
                q: "I ran out of shots",
                a: "The host sets the number of shots per guest, and guests can't top them up.",
            },
            {
                q: "My photos haven't uploaded",
                a: "Photos upload in the background and try again when the connection comes back. Keep the page or app open for a moment once you have signal.",
            },
            {
                q: "I joined in a different browser or on another phone",
                a: "If you left your email address when you joined, the reveal email has a link that opens the event as you in any browser, with your name and your photos.",
            },
            {
                q: "I arrived after the camera closed",
                a: `For ${lateHours === 1 ? "an hour" : `${lateHours} hours`} after the camera closes, someone new can still join the event, so they're there for the reveal.`,
            },
        ],
    },
    {
        title: "Hosting",
        questions: [
            {
                q: "How do I start an event?",
                a: "Open the app, sign in with your email and tap to create an event. Pick the occasion, name it, set when photos appear and how many shots each guest gets, choose a look and a guest count. Then print the table cards or share the link.",
            },
            {
                q: "What are the looks?",
                a: `Each event has one film look that every photo shares: ${natural?.name}, ${warm?.name} with soft grain and a warm flash, or ${mono?.name} in high-contrast silver.`,
                home: true,
            },
            {
                q: "Can I change the settings after the event starts?",
                a: "Open the event in the app and tap Manage. While the event is live you can change the name, the cover and the end time, move the reveal later, and change who sees the photos from every guest to only you. The reveal can't move earlier once guests are shooting, and the film look and shots per guest are fixed once the event goes live.",
            },
            {
                q: "Can I end the event early?",
                a: "Yes. In Manage, tap End now. The camera closes for every guest, and before you confirm, the app shows when the photos will appear.",
            },
            {
                q: "Can I remove a guest?",
                a: "Yes. Hold their name in People, or use the menu on one of their photos. Their photos and likes are removed, and that phone can't join the event again.",
            },
            {
                q: "How do I delete an event?",
                a: "In Manage, tap Delete event. This deletes every photo for every guest and can't be undone, and payments aren't refunded. You can also delete any event, including a draft, from its card in your events list.",
            },
        ],
    },
    {
        title: "The reveal and the photos",
        questions: [
            {
                q: "When do the photos appear?",
                a: "The host picks the reveal when creating the event: right away, when the event ends, the next morning at 10:00, or a time of their choosing. Until then nobody sees the photos, the host included.",
                home: true,
            },
            {
                q: "Who can see the photos after the reveal?",
                a: "By default every guest sees the whole event. The host can choose Only me instead, so guests see just their own photos and the host sees everything.",
                home: true,
            },
            {
                q: "Can a photo be taken down?",
                a: "Yes. The host can hide any photo, and anyone at the event can report one. A photo that three people report is hidden automatically, and the host is notified. Guests can also remove their own photos once they can see them in the event.",
                home: true,
            },
            {
                q: "How do I keep the photos?",
                a: "Save one from the viewer, or tap Save all on the event to put every photo into an album named after it. Photos are kept at 2048 pixels on the long edge.",
            },
            {
                q: "How long are the photos kept?",
                a: 'Until the host deletes the event or their account. The <a href="/privacy/">Privacy Policy</a> covers what is stored and for how long.',
            },
        ],
    },
    {
        title: "Paying",
        questions: [
            {
                q: "What does it cost?",
                a: `Events with up to ${free?.guests} guests are free. Larger events are a single payment by guest count, from ${formatPrice(smallest?.priceCents ?? 0)} for ${smallest?.guests} guests to ${formatPrice(largest?.priceCents ?? 0)} for ${largest?.guests}. There is no subscription.`,
                home: true,
            },
            {
                q: "How do I pay?",
                a: "In the iPhone app through the App Store, in the Android app through Google Play, or on the web through Stripe. LingerCam never sees your card details.",
            },
            {
                q: "What if more guests turn up?",
                a: `Once an event reaches its guest limit, new guests can't join, so it's worth picking a size with some room. Make room moves an event to a larger size. The largest size takes ${largest?.guests} guests.`,
            },
            {
                q: "What does unlimited shots add?",
                a: `For ${formatPrice(UNLIMITED_SHOTS.priceCents)} on any event, guests can shoot as much as they like instead of a set number of shots.`,
            },
            {
                q: "Something went wrong with a payment",
                a: `Email ${support} with the event name and the email you sign in with, and we'll sort it out.`,
            },
        ],
    },
    {
        title: "Your account",
        questions: [
            {
                q: "How do I delete my account?",
                a: 'In the app under Settings, or by email. Deleting it removes your account and the events and photos in it. See <a href="/delete-account/">Delete your account</a>.',
            },
            {
                q: "How do I reach you?",
                a: `Email ${support}. Include the event name, and if you're a host, the email you sign in with.`,
            },
        ],
    },
];

/** The home page's questions, in the order it has always shown them. */
const HOME_ORDER = [
    "Do guests need to download an app?",
    "When do the photos appear?",
    "How many photos can each guest take?",
    "Who can see the photos after the reveal?",
    "What does it cost?",
    "Can a photo be taken down?",
    "What are the looks?",
];

const all = QUESTION_GROUPS.flatMap((g) => g.questions);
export const HOME_QUESTIONS: Question[] = HOME_ORDER.map((q) =>
    all.find((item) => item.q === q),
).filter((item): item is Question => item !== undefined && item.home === true);
