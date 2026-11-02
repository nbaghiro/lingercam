import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";

import type { EventState, Occasion, RevealMode, Visibility } from "@linger/core/events";
import { revealCountdown } from "@linger/core/reveal";
import { getCalendars } from "expo-localization";
import { IntlMessageFormat } from "intl-messageformat";

// Every user-facing string, as ICU messages. English is the only catalogue for now.
//
// Glossary, so the same thing is always called the same:
// - film: the event as a whole ("Start my film", "Your film is ready").
// - roll: one guest's shots at one event ("That's your roll", "Sam's roll").
// - shot: the allowance unit ("24 shots each", "17 shots left").
// - photo: what a shot becomes once it is developed and shown ("212 photos saved").
// - moment: the count on the cover and in the reveal ("612 moments").
//
// Workstreams add strings only inside their own block at the end of the catalogue.
const en = {
    "common.continue": "Continue",
    "common.cancel": "Cancel",
    "common.done": "Done",
    "common.close": "Close",
    "common.back": "Back",
    "common.retry": "Try again",
    "common.error": "Something went wrong. Try again.",
    "common.undo": "Undo",
    "common.openSettings": "Open Settings",
    "common.notNow": "Not now",
    "common.turnOn": "Turn on",
    "common.stop": "Stop",
    "common.copied": "Link copied",
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
    "event.people": "People",
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
    "event.more": "{count, number} more developing",

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
    "activity.closed": "The camera has closed. Photos at {time}.",
    "activity.rollDone": "Your roll is done",

    "notify.revealTitle": "{title}",
    "notify.revealBody": "The photos are ready.",

    "duration.days": "{days}d {hours}h",
    "duration.hours": "{hours}h {minutes}m",
    "duration.minutes": "{minutes}m",
    "duration.now": "Now",
    "time.am": "am",
    "time.pm": "pm",
    "zone.named": "{when} {zone} time",
    "price.free": "Free",
    "counts.momentsFromPeople":
        "{moments, plural, one {# moment} other {# moments}} from {people, plural, one {# person} other {# people}}",
    "guests.ofLimit": "{count, number} of {limit, number} guests",

    "problem.network": "Linger couldn't reach the server. Check your connection and try again.",
    "problem.timeout":
        "Linger couldn't reach the server in time. Check your connection and try again.",
    "problem.generic": "Something went wrong. Try again.",
    "problem.not-found": "There's no event with that code. Check the code and try again.",
    "problem.gone": "This event isn't available any more.",
    "problem.not-joined": "Join the event to see this.",
    "problem.event-full": "This event is full. Ask the host to make room.",
    "problem.not-open": "This event isn't open to guests right now.",
    "problem.no-shots-left": "You've used every shot.",
    "problem.not-shooting": "The camera has closed.",
    "problem.upload": "The photo didn't upload. Linger will try again.",
    "problem.too-large": "That photo is too large to send.",
    "problem.too-many": "Please wait a few minutes and try again.",
    "problem.wrong-code": "That code doesn't match. Check the email and try again.",
    "problem.code-expired": "That code has expired. Send a new one.",
    "problem.code-locked": "Too many tries. Send a new code.",
    "problem.email-failed": "The email couldn't be sent. Check the address and try again.",
    "problem.signed-out": "You've been signed out. Sign in to continue.",
    "problem.bad-cursor": "This event couldn't be loaded.",
    "problem.wrong-state": "The event has changed. Pull to refresh and try again.",
    "problem.locked": "That can't be changed at this stage of the event.",
    "problem.already-over": "The end time has passed. Pick a new end time.",
    "problem.already-covered": "This event already has that.",
    "problem.needs-unlimited": "Unlimited shots needs the add-on.",
    "problem.no-cover": "This event has no cover photo yet.",
    "problem.store": "The store couldn't be reached. Try again.",
    "problem.not-purchased": "The purchase couldn't be found.",
    "problem.checkout-failed": "Checkout didn't start. Try again.",
    "problem.not-yours": "Only the person who took a photo can remove it.",

    "a11y.step": "Step {step} of {total}",
    "a11y.warning": "Warning",

    "welcome.haveCode": "Have a code?",
    "welcome.yourEvents": "Your events",
    "welcome.signedOut": "You've been signed out. Sign in to continue.",
    "welcome.legalTerms": "Terms",
    "welcome.legalPrivacy": "Privacy Policy",
    "signIn.tooMany": "Please wait a few minutes before asking for another code.",
    "signIn.resendIn": "Send a new code in {seconds}s",
    "signIn.openMail": "Open Mail",
    "signIn.nameTitle": "What should guests call you?",
    "signIn.nameSave": "Save name",

    "home.group.live": "Live now",
    "home.group.upcoming": "Coming up",
    "home.group.waiting": "Waiting for the reveal",
    "home.group.drafts": "Drafts",
    "home.group.revealed": "Revealed",
    "home.group.past": "Past",
    "home.line.live":
        "Camera open · {left} left · {moments, plural, one {# moment} other {# moments}}",
    "home.line.upcoming": "Opens {when}",
    "home.line.waiting": "{day} · {reveal}",
    "home.line.revealed": "{photos, plural, one {# photo} other {# photos}} · {date}",
    "home.refreshFailed": "Couldn't refresh. Showing what was loaded earlier.",
    "home.menu.showCode": "Show code",
    "home.menu.shareLink": "Share link",
    "home.menu.manage": "Manage",
    "home.menu.delete": "Delete",

    "create.close": "Close",
    "create.discardTitle": "Discard this event?",
    "create.discard": "Discard",
    "create.keepEditing": "Keep editing",
    "create.name.left": "{count, number} left",
    "create.name.starts": "Starts",
    "create.name.required": "Give it a name to continue.",
    "create.name.timeZone": "Time zone",
    "create.name.coverRemove": "Remove photo",
    "create.name.coverFailed": "The cover couldn't be uploaded. Try another photo.",
    "create.rules.pickTime": "Pick a time",
    "create.rules.unlimitedPrice": "Unlimited shots add {price}",
    "create.guests.included": "Included",
    "create.testPurchase": "Test purchase",
    "create.paymentFailedDraft": "The payment didn't go through. Your event is saved as a draft.",
    "create.offlineDraft": "Linger couldn't reach the server. Your event is saved as a draft.",
    "create.endPassed": "The end time has passed. Pick a new end time.",
    "create.partlyPaid": "{tier} is paid. Unlimited shots wasn't added.",
    "create.deleteDraftTitle": "Delete this draft?",
    "create.deleteDraft": "Delete draft",

    "invite.copyLink": "Copy link",
    "invite.opens": "The camera opens {when}.",
    "invite.code": "Code {code}",
    "invite.sharePhoto": "Share a photo",
    "invite.sharePhotoBody":
        "New guests can't join once the photos are out. To share one, open it and tap Share.",
    "print.rules": "{shots, plural, one {# shot} other {# shots}} each. Photos appear {when}.",
    "print.rulesUnlimited": "Unlimited shots. Photos appear {when}.",

    "host.makeRoom": "Make room",
    "host.manage": "Manage",
    "manage.title": "Manage",
    "manage.name": "Name",
    "manage.cover": "Cover",
    "manage.ends": "Ends",
    "manage.reveal": "Reveal",
    "manage.revealLocked": "Can't move the reveal earlier once guests are shooting.",
    "manage.who": "Who sees the photos",
    "manage.showCode": "Show code",
    "manage.copyLink": "Copy link",
    "manage.print": "Print table cards",
    "manage.endNow": "End now",
    "manage.endTitle": "End the event now?",
    "manage.endBody": "The camera closes for everyone. Photos appear {when}.",
    "manage.delete": "Delete event",
    "manage.deleteTitle": "Delete {title}?",
    "manage.deleteBody":
        "This deletes every photo for every guest and can't be undone. Payments aren't refunded.",
    "manage.saved": "Saved",
    "people.host": "Host",

    "code.title": "Have a code?",
    "code.body": "Enter the 6-character code from the card or the link.",
    "code.label": "Join code",
    "code.join": "Join",

    "join.byHost": "{name} invited you",
    "join.cameraOnly": "Photos come from this camera only.",
    "join.joinNow": "Join now",
    "join.as": "Join as {name}",
    "join.notMe": "Not {name}?",
    "join.fullTitle": "{title} is full",
    "join.fullBody": "Ask the host to make room.",
    "join.draftTitle": "{title} isn't open yet",
    "join.draftBody": "The host is still setting it up.",
    "join.endedTitle": "The camera has closed",
    "join.endedBody": "Photos appear {when}.",
    "join.seeEvent": "See the event",
    "join.revealedTitle": "The photos are ready",
    "join.notMemberTitle": "These photos are for the people who were there",
    "join.notMemberBody":
        "If you joined on another phone or browser, open the email link or rejoin there.",
    "join.otherDevice": "I joined on another device",
    "join.notFoundTitle": "There's no event with that code",
    "join.notFoundBody": "Check the code and try again.",
    "join.offlineTitle": "This event couldn't be loaded",
    "join.offlineBody": "Check your connection and try again.",
    "join.cameraDenied": "Linger needs the camera to take photos. Turn it on in Settings.",
    "event.gone": "This event isn't available any more.",
    "event.backToEvents": "Back to your events",

    "camera.opensAt": "The camera opens at {time}.",
    "camera.closesIn": "Closes in {minutes, number} min",
    "camera.closed": "The camera has closed. Photos appear {when}.",
    "camera.readyTitle": "The photos are ready",
    "camera.offline": "Offline. Photos will send later.",
    "camera.usingSamples": "Using sample photos",
    "camera.flash": "Flash",
    "camera.flashAuto": "Auto",
    "camera.flashOnValue": "On",
    "camera.flashOffValue": "Off",

    "uploads.kept":
        "{count, plural, one {# photo couldn't be added to the event, so it was saved to your Photos.} other {# photos couldn't be added to the event, so they were saved to your Photos.}}",
    "uploads.unreadable":
        "{count, plural, one {# photo couldn't be read.} other {# photos couldn't be read.}}",
    "uploads.returned":
        "{count, plural, one {# photo couldn't be developed. You got the shot back.} other {# photos couldn't be developed. You got the shots back.}}",
    "uploads.allIn":
        "{count, plural, one {Your photo is in.} other {All # of your photos are in.}}",
    "uploads.stillSending":
        "{count, plural, one {# of your photos is still sending. It'll appear here.} other {# of your photos are still sending. They'll appear here.}}",

    "event.yourRoll": "Your roll: {taken, number} taken, {left, number} left",
    "event.yourRollUnlimited": "Your roll: {taken, number} taken",
    "event.live": "Live",
    "event.nightOver": "That's the night. {counts}.",
    "event.developingAll": "{count, plural, one {# photo developing} other {# photos developing}}",
    "event.readyOffline": "The photos are ready. They'll load when you're back online.",
    "event.hiddenBadge": "Hidden",
    "event.reportedBadge": "Reported",

    "notify.hostCard": "We'll tell you when the photos are ready.",
    "notify.guestCard": "Get a nudge at {time} when the photos are ready.",
    "notify.off":
        "Notifications are off for Linger. Turn them on in Settings to hear when the photos are ready.",
    "notify.webTitle": "Want to know when the photos are ready?",
    "notify.emailMe": "Email me",
    "notify.emailPlaceholder": "you@example.com",
    "notify.emailSaved": "We'll email you when the photos are ready.",
    "notify.calendar": "Add to calendar",
    "notify.calendarTitle": "{title}: the photos are ready",
    "notify.homeScreen": "Add to Home Screen to come back later",
    "notify.revealLine": "{title}: the photos are ready. {counts}.",
    "notify.revealLocal": "{title}: the photos are ready.",
    "notify.full": "{title} is full. Make room for more guests.",
    "notify.hidden": "A photo at {title} was hidden after reports.",

    "moment.yours": "{count, plural, one {# of these is yours.} other {# of these are yours.}}",

    "photo.more": "More",
    "photo.hiddenNote": "Hidden from guests.",
    "photo.remove": "Remove my photo",
    "photo.removeTitle": "Remove this photo?",
    "photo.removeBody": "It's removed from the event for everyone. This can't be undone.",
    "photo.liked": "Liked",

    "save.partial":
        "{saved, number} of {total, number} saved. {failed, plural, one {# couldn't be saved.} other {# couldn't be saved.}}",
    "save.denied": "Linger needs access to Photos to save them.",
    "save.size": "Photos are saved at 2048 px on the longest side.",
    "save.webPhone": "Save photos one at a time from the viewer.",

    "recap.watchAgain": "Watch again",
    "recap.next": "Next photo",
    "recap.previous": "Previous photo",

    "settings.name": "Name",
    "settings.notifications": "Notifications",
    "settings.notificationsOn": "On",
    "settings.notificationsOff": "Off",
    "settings.signOutWaiting":
        "{count, plural, one {# photo is still uploading. Sign out anyway?} other {# photos are still uploading. Sign out anyway?}}",
    "settings.signOutPurchase": "A purchase is still being applied. Sign out anyway?",
    "settings.deleteBodyEvents":
        "This deletes your account, {count, plural, =0 {your events} one {your # event} other {your # events}} and every photo in them. Live events end for every guest. Payments aren't refunded.",

    "web.notFoundTitle": "This page doesn't exist",
    "web.notFoundLink": "Go to Linger",
    "web.homeBody":
        "Linger gives every guest at an event a camera. The photos stay hidden until the reveal, then everyone gets them at the same time.",
    "web.siteLink": "About Linger",

    // W1, host setup and account. Add strings below this line.
    // End of W1.

    // W2, hosting tools and invite. Add strings below this line.
    // End of W2.

    // W3, guest join, camera and Live Activity. Add strings below this line.
    // End of W3.

    // W4, upload queue. Add strings below this line.
    // End of W4.

    // W5, event screen, waiting and the reveal. Add strings below this line.
    // End of W5.

    // W6, gallery, viewer, people, recap and saving. Add strings below this line.
    // End of W6.

    // W7, web shell and site. Add strings below this line.
    // End of W7.
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

const PROBLEMS: Record<string, MessageKey> = {
    network: "problem.network",
    timeout: "problem.timeout",
    "not-found": "problem.not-found",
    gone: "problem.gone",
    "not-joined": "problem.not-joined",
    "event-full": "problem.event-full",
    "not-open": "problem.not-open",
    "no-shots-left": "problem.no-shots-left",
    "not-shooting": "problem.not-shooting",
    "reservation-expired": "problem.upload",
    "not-uploaded": "problem.upload",
    "upload-failed": "problem.upload",
    "too-large": "problem.too-large",
    "too-many": "problem.too-many",
    "wrong-code": "problem.wrong-code",
    "code-expired": "problem.code-expired",
    "code-locked": "problem.code-locked",
    "email-failed": "problem.email-failed",
    "signed-out": "problem.signed-out",
    unauthorized: "problem.signed-out",
    "bad-cursor": "problem.bad-cursor",
    "wrong-state": "problem.wrong-state",
    locked: "problem.locked",
    "already-over": "problem.already-over",
    "already-covered": "problem.already-covered",
    "needs-unlimited": "problem.needs-unlimited",
    "no-cover": "problem.no-cover",
    "store-unavailable": "problem.store",
    "store-not-configured": "problem.store",
    "not-purchased": "problem.not-purchased",
    "checkout-failed": "problem.checkout-failed",
    "checkout-not-configured": "problem.checkout-failed",
    "not-yours": "problem.not-yours",
};

/**
 * What to tell the person about an API error code. Server messages are for logs only; anything
 * unknown, including a response the app couldn't read, is "Something went wrong. Try again."
 */
export function problem(code: string | undefined): string {
    const key = code === undefined ? undefined : PROBLEMS[code];
    return t(key ?? "problem.generic");
}

// Event facts are shown in the event's time zone. Clock times follow the device's 12 or 24-hour
// setting; days and dates read "Saturday 14 June".

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

let twentyFour: boolean | undefined;

/** True when the device shows a 24-hour clock. */
export function uses24HourClock(): boolean {
    if (twentyFour === undefined) {
        const calendar = getCalendars()[0];
        const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions()
            .hourCycle;
        twentyFour = calendar?.uses24hourClock ?? (cycle === "h23" || cycle === "h24");
    }
    return twentyFour;
}

/** "Saturday 14 June" */
export function formatDay(at: Date, timeZone: string): string {
    return format(timeZone, { weekday: "long", day: "numeric", month: "long" }).format(at);
}

/** "21:00" and "1:00" on a 24-hour device, "9:00 pm" and "1:00 am" on a 12-hour one. */
export function formatTime(at: Date, timeZone: string): string {
    const parts = format(timeZone, {
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    if (uses24HourClock()) return `${hour}:${minute}`;
    const period = t(hour < 12 ? "time.am" : "time.pm");
    return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${period}`;
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

/** "$9.99", or "Free" for zero. Prices are in cents. */
export function formatPrice(cents: number): string {
    if (cents === 0) return t("price.free");
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD" }).format(
        cents / 100,
    );
}

/** "1d 4h", "6h 05m" or "12m", the time left on the camera and the stat row; "Now" at zero. */
export function formatDuration(ms: number): string {
    if (ms <= 0) return t("duration.now");
    const minutes = Math.ceil(ms / 60_000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return t("duration.days", { days, hours });
    if (hours > 0) return t("duration.hours", { hours, minutes: String(mins).padStart(2, "0") });
    return t("duration.minutes", { minutes: mins });
}

/** "14 June" */
function formatDate(at: Date, timeZone: string): string {
    return format(timeZone, { day: "numeric", month: "long" }).format(at);
}

export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Minutes ahead of UTC in a zone at an instant. */
function offsetMinutes(at: Date, timeZone: string): number {
    const parts = format(timeZone, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hourCycle: "h23",
    }).formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") % 24,
        get("minute"),
        get("second"),
    );
    return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** "Vancouver" for America/Vancouver: the place a zone is named after. */
export function zoneName(timeZone: string): string {
    return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/** True when the event's clock reads differently from this device's at that instant. */
export function zoneDiffers(at: Date, timeZone: string): boolean {
    const device = deviceZone();
    return device !== timeZone && offsetMinutes(at, device) !== offsetMinutes(at, timeZone);
}

/**
 * "tomorrow at 10:00", "Saturday at 15:00", "in 3h 12m" or "now", phrased in the event's zone. A
 * clock time names the zone when the device's differs: "tomorrow at 10:00 Vancouver time".
 */
export function formatWhen(now: Date, at: Date, timeZone = deviceZone()): string {
    const when = revealCountdown(now, at, timeZone);
    let phrase: string;
    switch (when.kind) {
        case "past":
            return t("revealWhen.past");
        case "in":
            if (when.hours === 0) return t("revealWhen.minutes", { minutes: when.minutes });
            if (when.minutes === 0) return t("revealWhen.hours", { hours: when.hours });
            return t("revealWhen.hoursMinutes", when);
        case "today":
        case "tomorrow":
            phrase = t(`revealWhen.${when.kind}`, { time: formatTime(at, timeZone) });
            break;
        case "weekday":
            phrase = t("revealWhen.weekday", {
                weekday: format(timeZone, { weekday: "long" }).format(at),
                time: formatTime(at, timeZone),
            });
            break;
        case "date": {
            const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
            const date = format(
                timeZone,
                when.sameYear ? options : { ...options, year: "numeric" },
            );
            phrase = t("revealWhen.date", {
                date: date.format(at),
                time: formatTime(at, timeZone),
            });
            break;
        }
    }
    if (!zoneDiffers(at, timeZone)) return phrase;
    return t("zone.named", { when: phrase, zone: zoneName(timeZone) });
}

/** "tomorrow at 10:00", "in 3h 12m" or "now", for "Photos appear tomorrow at 10:00." */
export function revealWhen(now: Date, at: Date, timeZone = deviceZone()): string {
    return formatWhen(now, at, timeZone);
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

/** "612 moments from 34 people" */
export function momentsFromPeople(moments: number, people: number): string {
    return t("counts.momentsFromPeople", { moments, people });
}
