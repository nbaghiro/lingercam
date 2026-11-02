import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";

import type { EventState, Occasion, RevealMode, Visibility } from "@linger/core/events";
import { revealCountdown } from "@linger/core/reveal";
import { IntlMessageFormat } from "intl-messageformat";

// Every user-facing string, as ICU messages. English is the only catalogue for now.
const en = {
    "common.continue": "Continue",
    "common.cancel": "Cancel",
    "common.done": "Done",
    "common.close": "Close",
    "common.back": "Back",
    "common.retry": "Try again",
    "common.error": "Something went wrong. Please try again.",
    "common.offline": "Linger couldn't reach the server. Check your connection and try again.",

    "welcome.title": "Every guest gets a camera. Everyone gets the night.",
    "welcome.body":
        "Guests scan a code and start shooting. Nothing shows until the reveal, then the whole event arrives at once.",
    "welcome.email": "Continue with email",
    "welcome.demo": "Continue as demo host",
    "welcome.legal": "By continuing you agree to the Terms and the Privacy Policy.",

    "signIn.title": "Sign in with email",
    "signIn.body": "We'll email you a 6-digit code. There's no password to remember.",
    "signIn.emailPlaceholder": "you@example.com",
    "signIn.send": "Send code",
    "signIn.codeTitle": "Check your email",
    "signIn.codeBody": "Enter the 6-digit code we sent to {email}.",
    "signIn.codePlaceholder": "000000",
    "signIn.verify": "Sign in",
    "signIn.resend": "Send a new code",
    "signIn.resent": "A new code is on its way.",
    "signIn.changeEmail": "Use a different email",
    "signIn.badEmail": "Please enter a valid email address.",

    "home.title": "Your events",
    "home.new": "New event",
    "home.settings": "Settings",
    "home.empty.title": "No events yet",
    "home.empty.body":
        "Create an event and put its code on the tables. Every guest's photos stay hidden until the reveal, then arrive together.",
    "home.empty.cta": "Create an event",
    "home.draft": "Not live yet. Finish setting it up to get the code.",
    "home.loadFailed": "Your events couldn't be loaded.",

    "state.draft": "Draft",
    "state.live": "Live",
    "state.ended": "Ended",
    "state.revealed": "Revealed",
    "state.archived": "Archived",

    "settings.title": "Settings",
    "settings.signedIn": "Signed in as {email}",
    "settings.support": "Help and support",
    "settings.privacy": "Privacy Policy",
    "settings.terms": "Terms of Service",
    "settings.signOut": "Sign out",
    "settings.delete": "Delete account",
    "settings.deleteTitle": "Delete your account?",
    "settings.deleteBody":
        "This deletes your account, every event you created and all of their photos, for you and for your guests. It can't be undone.",
    "settings.deleteConfirm": "Delete everything",
    "settings.deleteFailed": "Your account couldn't be deleted. Please try again.",
    "settings.version": "Version {version}",

    "occasion.wedding": "Wedding",
    "occasion.birthday": "Birthday",
    "occasion.trip": "Trip",
    "occasion.party": "Party",
    "occasion.everyday": "Just everyday",

    "create.occasion.title": "What are we capturing?",
    "create.occasion.body": "We'll suggest shots, timing and guest count from this.",
    "create.name.title": "What's it called?",
    "create.name.placeholder.wedding": "Emma & Daniel's Wedding",
    "create.name.placeholder.birthday": "Maya turns thirty",
    "create.name.placeholder.trip": "Tofino weekend",
    "create.name.placeholder.party": "Jun's housewarming",
    "create.name.placeholder.everyday": "Sunday dinners",
    "create.name.date": "Date",
    "create.name.ends": "Ends",
    "create.name.endsTonight": "Tonight, {time}",
    "create.name.endsSameDay": "Same day, {time}",
    "create.name.endsOn": "{day}, {time}",
    "create.name.endsBefore": "The end needs to be after the start.",
    "create.name.cover": "Cover photo",
    "create.name.coverChoose": "Choose a cover photo",
    "create.name.coverChange": "Change cover photo",
    "create.rules.title": "How should it work?",
    "create.rules.when": "When do photos appear?",
    "create.rules.whenNote": "Everyone sees the photos {when}.",
    "create.rules.rightAwayNote": "Everyone sees each photo as soon as it's developed.",
    "create.rules.shots": "Shots per guest",
    "create.rules.who": "Who sees the photos?",
    "create.rules.hostOnlyNote": "Guests see only the photos they took. You see all of them.",
    "create.look.title": "Pick a look",
    "create.look.body": "Every photo at the event gets the same film.",
    "create.guests.title": "How many guests?",
    "create.guests.body": "One payment for this event. No subscription.",
    "create.guests.tier": "Up to {count, number} guests",
    "create.guests.popular": "Popular",
    "create.guests.unlimited": "Unlimited shots",
    "create.guests.unlimitedPrice": "Add {price}",
    "create.start": "Start my film",
    "create.startPaid": "Start my film for {price}",
    "create.failed": "The event couldn't be created. Please try again.",
    "create.paymentFailed":
        "The payment didn't go through, so the event is saved as a draft. You can try again from your events.",
    "create.invite.title": "Your film is ready",
    "create.invite.scan": "Scan to join. No download needed.",
    "create.invite.print": "Print table cards",
    "create.invite.share": "Share link",
    "create.invite.shareMessage": "Join {title} on Linger and take photos with everyone: {url}",
    "create.invite.done": "Done",

    "reveal.right-away": "Right away",
    "reveal.at-end": "When it ends",
    "reveal.next-morning": "Next morning",
    "reveal.custom": "Custom",

    "visibility.everyone": "Every guest",
    "visibility.host-only": "Only me",

    "print.title": "Table cards for {title}",
    "print.scan": "Scan to join and take photos",
    "print.how": "Point your phone's camera at the code. No download needed. Photos appear {when}.",
    "print.howRightAway": "Point your phone's camera at the code. No download needed.",

    "web.hostTitle": "Hosting happens in the app",
    "web.hostBody":
        "Create and manage events in Linger for iPhone or Android. Guests can join and take photos right here in the browser.",
    "web.appStore": "Download on the App Store",
    "web.playStore": "Get it on Google Play",

    "join.invited": "You're invited to shoot {title}",
    "join.rules": "{shots, plural, one {# shot} other {# shots}} each. Photos appear {when}.",
    "join.rulesUnlimited": "Unlimited shots. Photos appear {when}.",
    "join.rulesRightAway":
        "{shots, plural, one {# shot} other {# shots}} each. Photos appear as they're developed.",
    "join.openCamera": "Open camera",
    "join.by": "Linger",
    "join.nameTitle": "What should we call you?",
    "join.nameBody": "Your name goes on every photo you take, so everyone knows who took it.",
    "join.namePlaceholder": "Your name",
    "join.cameraTitle": "Allow the camera",
    "join.cameraBody":
        "Linger needs the camera to take photos for this event. You can change this in Settings at any time.",
    "join.cameraAllow": "Allow camera",
    "join.openSettings": "Open Settings",
    "join.full": "This event is full. Ask the host to make room.",
    "join.notFound": "There's no event with that code. Check the code on the card and try again.",
    "join.notOpen": "This event isn't open to guests right now.",
    "join.rulesEnded": "The camera has closed. Photos appear {when}.",
    "join.rulesRevealed": "The camera has closed and the photos are ready.",
    "join.seePhotos": "See the photos",
    "join.loadFailed": "This event couldn't be loaded. Check your connection and try again.",

    "camera.left": "{time} left",
    "camera.shotsLeft":
        "{count, plural, =0 {No shots left} one {# shot left} other {# shots left}}",
    "camera.unlimited": "Unlimited shots",
    "camera.out": "That's your roll",
    "camera.outBody": "You've used every shot. The photos appear {when}.",
    "camera.ended": "This event has ended, so the camera is closed.",
    "camera.demo": "There's no camera here, so Linger is using sample photos.",
    "camera.flip": "Switch camera",
    "camera.shutter": "Take photo",
    "camera.flashOn": "Flash on",
    "camera.flashOff": "Flash off",
    "camera.zoom": "Zoom {level}",
    "camera.denied":
        "Linger can't use the camera. Turn it on for Linger in Settings, then come back.",
    "camera.webDenied":
        "The browser blocked the camera. Allow it from the address bar, then try again.",
    "camera.failed": "The photo didn't take. Please try again.",
    "camera.none": "Linger couldn't find a camera on this device.",
    "camera.seeEvent": "See the event",

    "event.moments": "Moments",
    "event.left": "Left",
    "event.people": "People ›",
    "event.revealed": "Revealed",
    "event.today": "Today",
    "event.yesterday": "Yesterday",
    "event.developing": "Developing",
    "event.openCamera": "Open camera",
    "event.showCode": "Show join code",
    "event.download": "Download all photos",
    "event.toReveal": "To reveal",
    "event.recap": "Watch the recap",
    "event.downloading": "Saving {done, number} of {total, number}",
    "event.downloaded": "{count, plural, one {# photo saved} other {# photos saved}} to Photos",
    "event.roll": "{name}'s roll",
    "event.everyone": "Show everyone",
    "event.empty": "No photos yet. Open the camera to take the first one.",
    "event.emptyRevealed": "No photos were taken at this event.",
    "event.emptyClosed": "No photos were taken before the camera closed.",
    "event.loadFailed": "This event couldn't be loaded.",
    "event.photoBy": "Photo by {name}",
    "event.more": "{count, plural, one {# more developing} other {# more developing}}",

    "moment.title": "It's all here.",
    "moment.body":
        "{moments, plural, one {# moment} other {# moments}}, {people, plural, one {# photographer} other {# photographers}}.",
    "moment.cta": "See every moment",

    "photo.position": "{index, number} of {total, number}",
    "photo.meta": "{time}, {look}",
    "photo.save": "Save",
    "photo.saved": "Saved to Photos",
    "photo.share": "Share",
    "photo.like": "Like",
    "photo.report": "Report photo",
    "photo.reportTitle": "Report this photo?",
    "photo.reportBody":
        "The host will be told. A photo reported by three people is hidden until the host reviews it.",
    "photo.reported": "Thanks. The photo has been reported.",
    "photo.hide": "Hide photo",
    "photo.unhide": "Show photo",
    "photo.hidden": "Hidden from guests",
    "photo.missing": "This photo isn't available.",
    "photo.saveFailed": "The photo couldn't be saved. Please try again.",
    "photo.allowPhotos": "Allow Linger to add photos in Settings, then try again.",
    "photo.reportFailed": "The report didn't go through. Please try again.",

    "recap.subtitle": "The whole night in {seconds, number} seconds",
    "recap.save": "Save photo",
    "recap.share": "Share",
    "recap.shareMessage": "The photos from {title} are on Linger: {url}",
    "recap.empty": "The recap is ready once the photos are revealed.",
    "recap.pause": "Pause",
    "recap.play": "Play",

    "people.title": "{count, plural, one {# person} other {# people}}",
    "people.body": "Tap anyone to see their roll.",
    "people.joined": "Joined {time}",
    "people.shots": "{count, plural, one {# shot} other {# shots}}",
    "people.bodyBefore": "Shot counts so far. Everyone's photos appear at the reveal.",

    "uploads.pending":
        "{count, plural, one {# photo waiting to upload} other {# photos waiting to upload}}",
    "uploads.retrying": "Photos will upload when you have signal again.",
    "uploads.failed":
        "{count, plural, one {# photo couldn't be sent} other {# photos couldn't be sent}} because the camera had closed or your shots had run out.",

    "revealLabel.past": "Revealed",
    "revealLabel.future": "Reveals {when}",
    "revealWhen.past": "now",
    "revealWhen.minutes": "in {minutes}m",
    "revealWhen.hours": "in {hours}h",
    "revealWhen.hoursMinutes": "in {hours}h {minutes}m",
    "revealWhen.today": "today at {time}",
    "revealWhen.tomorrow": "tomorrow at {time}",
    "revealWhen.weekday": "{weekday} at {time}",
    "revealWhen.date": "{date} at {time}",

    "activity.shotsLeft": "{left} of {total, plural, one {# shot} other {# shots}} left",
    "activity.moments": "{count, plural, one {# moment} other {# moments}} so far",
    "activity.revealsAt": "Reveals at {time}",

    "notify.revealTitle": "{title}",
    "notify.revealBody": "The photos are ready.",
} as const;

export type MessageKey = keyof typeof en;
type Values = Record<string, string | number | Date>;

const LOCALE = "en";
const cache = new Map<MessageKey, IntlMessageFormat>();

/** Formats a message from the catalogue. */
export function t(key: MessageKey, values?: Values): string {
    let format = cache.get(key);
    if (!format) {
        format = new IntlMessageFormat(en[key], LOCALE);
        cache.set(key, format);
    }
    return String(format.format(values));
}

export const occasionLabel = (o: Occasion): string => t(`occasion.${o}`);
export const stateLabel = (s: EventState): string => t(`state.${s}`);
export const revealModeLabel = (m: RevealMode): string => t(`reveal.${m}`);
export const visibilityLabel = (v: Visibility): string => t(`visibility.${v}`);

// Dates are shown in the event's time zone, in 24-hour time like the reveal labels in core.

const formats = new Map<string, Intl.DateTimeFormat>();

function format(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${timeZone}|${JSON.stringify(options)}`;
    let f = formats.get(key);
    if (!f) {
        f = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
        formats.set(key, f);
    }
    return f;
}

/** "Saturday 14 June" */
export function formatDay(at: Date, timeZone: string): string {
    return format(timeZone, { weekday: "long", day: "numeric", month: "long" }).format(at);
}

/** "21:00", or "1:00" in the small hours. */
export function formatTime(at: Date, timeZone: string): string {
    const time = format(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return time.format(at).replace(/^0(?=\d:)/, "");
}

/** "Tonight, 21:00" on the start day, otherwise "Sunday, 1:00". */
export function formatEnds(start: Date, end: Date, timeZone: string): string {
    const day = format(timeZone, { year: "numeric", month: "numeric", day: "numeric" });
    const weekday = format(timeZone, { weekday: "long" });
    const time = formatTime(end, timeZone);
    if (day.format(start) === day.format(end)) {
        const hour = Number(format(timeZone, { hour: "numeric", hourCycle: "h23" }).format(end));
        return t(hour >= 17 ? "create.name.endsTonight" : "create.name.endsSameDay", { time });
    }
    return t("create.name.endsOn", { day: weekday.format(end), time });
}

/** "4,293" */
export function formatCount(n: number): string {
    return new Intl.NumberFormat(LOCALE).format(n);
}

/** "1d 4h", "6h 05m" or "12m", the time left on the camera and the stat row. */
export function formatDuration(ms: number): string {
    const minutes = Math.max(0, Math.ceil(ms / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
    return `${mins}m`;
}

/** "14 June" */
function formatDate(at: Date, timeZone: string): string {
    return format(timeZone, { day: "numeric", month: "long" }).format(at);
}

const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "tomorrow at 10:00", "in 3h 12m" or "now", for "Photos appear tomorrow at 10:00." */
export function revealWhen(now: Date, at: Date, timeZone = deviceZone()): string {
    const when = revealCountdown(now, at, timeZone);
    switch (when.kind) {
        case "past":
            return t("revealWhen.past");
        case "in":
            if (when.hours === 0) return t("revealWhen.minutes", { minutes: when.minutes });
            if (when.minutes === 0) return t("revealWhen.hours", { hours: when.hours });
            return t("revealWhen.hoursMinutes", when);
        case "today":
        case "tomorrow":
            return t(`revealWhen.${when.kind}`, { time: when.time });
        case "weekday":
            return t("revealWhen.weekday", {
                weekday: format(timeZone, { weekday: "long" }).format(at),
                time: when.time,
            });
        case "date": {
            const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
            const date = format(
                timeZone,
                when.sameYear ? options : { ...options, year: "numeric" },
            );
            return t("revealWhen.date", { date: date.format(at), time: when.time });
        }
    }
}

/** "Reveals tomorrow at 10:00", or "Revealed" once it has happened. */
export function revealLabel(now: Date, at: Date, timeZone = deviceZone()): string {
    if (at.getTime() <= now.getTime()) return t("revealLabel.past");
    return t("revealLabel.future", { when: revealWhen(now, at, timeZone) });
}

/** "Today", "Yesterday" or "14 June", for the day an event was revealed. */
export function dayLabel(at: Date, now: Date, timeZone: string): string {
    const day = format(timeZone, { year: "numeric", month: "numeric", day: "numeric" });
    if (day.format(at) === day.format(now)) return t("event.today");
    if (day.format(at) === day.format(new Date(now.getTime() - 86_400_000))) {
        return t("event.yesterday");
    }
    return formatDate(at, timeZone);
}
