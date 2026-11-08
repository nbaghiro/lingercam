# App Store listing

The listing for App Store Connect, written on 2026-11-08 from what the app does now. Facts that
come from code (prices, guest counts, shot limits, the looks) are named with their source, so they
can be checked against it before submission. Character counts are Apple's limits.

## Name and subtitle

**Name** (30 max, 23 used): LingerCam: Event Camera

**Subtitle** (30 max, 29 used): Guests shoot, then one reveal

Apple indexes the name, the subtitle and the keywords together, so the keywords below don't
repeat "camera", "event", "guests" or "reveal".

## Promotional text

170 max. It can change without a new build, so it's the place for anything seasonal.

> Every guest gets a camera with a set number of shots. Nothing shows until the reveal, then
> everyone sees the whole event at once. Free for up to 10 guests.

## Description

> LingerCam is a shared camera for weddings, parties, birthdays and trips. The host creates an
> event, and guests join by scanning a QR code. They don't need an account, and they can shoot
> from the browser without installing anything.
>
> Each guest gets a set number of shots, counted down beside the shutter, and every photo is
> developed with the film look the host chose. Nobody sees the photos until the reveal, the host
> included. At the reveal time everyone gets a notification, and the gallery opens with every
> photo signed by the guest who took it.
>
> For hosts
> - Set up an event in a few steps: the occasion, a title, the date and a cover photo.
> - Choose when the photos appear: right away, when the event ends, the next morning, or at a time
>   you pick.
> - Choose how many shots each guest gets, from 5 to 36, and one of three looks: Natural,
>   Warm '98 or Mono.
> - Share one code by QR, link or a printed table card.
> - Decide who sees what after the reveal: everyone sees everything, or each guest sees their own
>   photos and you see them all.
> - Hide any photo and remove a guest if you need to.
>
> For guests
> - Join with the code in the app or in the browser, under the name you choose.
> - Shoot with the event's look. Your photos upload in the background, even with a weak signal.
> - With the iPhone app, a Live Activity counts down to the reveal on your Lock Screen.
> - After the reveal, browse the gallery, see who shot what, watch the recap, and save the photos
>   you want.
>
> Pricing
> Events with up to 10 guests are free. Larger events are a one-time purchase for that event,
> priced by guest count, with no subscription. Unlimited shots is an optional add-on.
>
> Privacy
> Photos are only shown to the people at the event, according to the host's setting. The photo as
> the camera took it is deleted once it's developed, and the developed copy carries no location or
> camera metadata. LingerCam has no ads and doesn't use your photos for anything else.
>
> Terms: https://lingercam.app/terms/
> Privacy: https://lingercam.app/privacy/

Sources: free guest count, tiers and the add-on in `packages/core/src/pricing.ts`; shot range in
`packages/core/src/events.ts` (`MIN_SHOTS`, `MAX_SHOTS`); looks in `packages/core/src/film.ts`;
reveal modes in `REVEAL_MODES`.

## Keywords

100 max, 98 used, commas without spaces:

```
disposable,wedding,party,guest,photos,film,album,qr,birthday,reception,reunion,group,roll,keepsake
```

Other brands' names stay out (Apple rejects keywords that name another app or trademark).

## URLs and contact

- Support URL: https://lingercam.app/support/
- Marketing URL: https://lingercam.app/
- Privacy policy URL: https://lingercam.app/privacy/
- Copyright: 2026 GalleoApp, Inc.
- Category: Photo & Video. Secondary: Lifestyle.

## Review notes

The fields under App Review Information. The email and code are the `REVIEW_EMAIL` and
`REVIEW_CODE` values in Render's `lingercam-backend` group; copy them from there, not from this
file.

**Sign-in required:** yes. Username: the review email. Password: the six-digit review code.

> LingerCam signs hosts in with a six-digit code sent by email. The review account above skips the
> email: enter its address on the sign-in screen, tap Send code, then enter the code given here.
>
> The account has three events:
> - RVW4PP, "App Review party": live, with photos shown right away, so the camera, uploads and the
>   gallery can all be tried at once. To join as a guest from a second device, open
>   https://join.lingercam.app/RVW4PP in Safari or scan the QR code under Invite.
> - RVW8TF, "Emma & Daniel's wedding": already revealed, with 8 photos, the recap and the people
>   view.
> - RVW2DR, "Maya turns thirty": a draft, to see event setup and the purchase screen.
>
> Guests' photos are user-generated content shared only with the people at one event. Anyone at
> an event can report a photo from its menu; three reports hide it, the host can hide any photo or
> remove a guest, and every report is emailed to support@lingercam.app.
>
> Paid events are consumable in-app purchases, one per event, priced by guest count.

Run `pnpm --filter api review-seed` against production just before submitting, so RVW4PP is
live for the whole review.

## Screenshots

Apple needs the 6.9" iPhone size (1320 × 2868); the smaller sizes are scaled from it. Ten at most,
and the first three show in search. Each one is a real screen from the review or demo account,
captured on the simulator with `.scratchpad/screens/` and given one short caption above it.

1. **Gallery after the reveal** (RVW8TF or the demo wedding). Caption: "Every photo from every
   guest, signed by who took it."
2. **Camera** with the shots counter and the Warm '98 look. Caption: "Every guest gets a camera
   and a set number of shots."
3. **Developing** before the reveal, with the countdown. Caption: "Nothing shows until the
   reveal."
4. **Join sheet** from a scanned code. Caption: "Guests join from a QR code, in the app or the
   browser."
5. **Invite** with the QR code and the table card. Caption: "One code for every table."
6. **The rules** step: reveal time and shots per guest. Caption: "You choose when the photos
   appear."
7. **Choose a look**, showing the three looks on one photo. Caption: "One film look for
   everyone."
8. **Lock Screen** with the Live Activity counting down. Caption: "A countdown on the Lock
   Screen."
9. **The reveal moment**, the photos fanned out. Caption: "Then the whole event arrives at once."
10. **People**, who shot what. Caption: "See who shot what."

Use the demo festival or wedding for the gallery shots, since they have enough photos to fill the
screen. Captions follow the app's copy rules: sentence case, no em dashes, and text over a photo
sits on a scrim.

## Still to decide

- The App Preview video (optional, up to 30 seconds): the camera, a few shots, then the reveal.
- Localized listings: English only for the first release.
- Whether the subtitle should name an occasion instead ("For weddings and parties") once there's
  search data.
