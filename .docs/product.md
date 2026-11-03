# Linger product spec

This is the finished Linger experience, written so it can be built and checked screen by screen.
It covers the host, the guest, the reveal, the gallery, the account, the site and the guest web
app, and the rules that cut across all of them.

It builds on the approved design (`../smallwares/.scratchpad/linger/index.html`), the plan
(`.docs/plan.md`, including Results), the QA checklist (`.docs/qa.md`) and the six review notes in
`.docs/vision/`. The scratchpad draws the five setup steps, the invite, the join sheet, the camera,
the developing screen, the Live Activity, the notification, the moment, the gallery, the viewer,
the recap and the people list. Everything else here (welcome, sign-in, the events list, settings,
hosting tools, error and empty states) follows the scratchpad's system rather than a drawn screen.

## How to read this

Each requirement starts with a status for the code on the `polish` branch at the end of the polish
run on 2026-11-02 (`.docs/polish-plan.md`, Results):

- **[yes]** the code meets it now.
- **[partly]** some of it is there; the line says what is missing. "Built, not verified" means the
  code is written but only a physical iPhone (decision Q16) or the Android pass (Q9) can confirm
  it.
- **[no]** not built.

Citations were written against the code before the polish run, so their line numbers may have
moved; the lines changed in that run drop their citations. Paths drop the leading `apps/` or `packages/`: `app/src/join.tsx`
is `apps/app/src/join.tsx`, `app/app/_layout.tsx` is a route file, `api/src/shots.ts` and
`core/src/shots.ts` are the API and the shared package, `site/src/...` is the site. "Scratchpad"
means the approved design file, with its line numbers. Where a requirement needs a decision that
isn't settled in the plan, it says so and points to "Decisions" below.

Scope stays with the product as planned. Larger ideas, including ones competitors ship, are listed
under "Later" at the end.

---

## Principles

These decide trade-offs when a screen or a feature pulls two ways.

1. **A guest is shooting within 10 seconds of scanning.** No account, no download required, one
   name, one camera permission. Anything added to the join path has to earn its place inside those
   10 seconds, which is why notification permission, email and "add to home screen" all wait until
   after the first photo.
2. **Nothing is visible before the reveal, for anyone, the host included.** The server enforces it:
   no photo, thumbnail or signed URL leaves the API before the reveal (`core/src/shots.ts:75-101`,
   `api/src/shots.ts:301-320`). Counts, names and times are not secret and should be used to make
   the wait feel alive.
3. **A photo taken is a photo kept.** Once the shutter fires, the photo is safe on the device and
   the device never deletes it until the server has accepted it. If the server will never accept
   it, the guest keeps it in their own photo library and is told why.
4. **Everyone hears about the reveal.** That includes guests who joined in a browser, who are most
   guests until there is an App Clip.
5. **One accent colour.** Candle (#E9C99A) marks live, progress, the caret and badges. Errors and
   destructive actions don't use it. White (Paper) is the only button colour, and the photos carry
   the colour.
6. **The host gets tools, not exceptions.** Hosts can change what the rules allow, end early, make
   room and remove things, but they see the photos at the same moment as everyone else.
7. **Say the rules before the first shot.** Shots per guest, when photos appear, and that photos
   come from this camera only. No surprises after the event.
8. **Event facts in the event's time zone.** A reveal at 10:00 means 10:00 where the event is,
   and the zone is shown when it differs from the viewer's.

## Decisions this spec makes

The plan leaves these open. This spec picks one answer for each so the rest can be built against
it. Each is marked "confirm" because Naib should agree before it's built.

- **D1, late photos (confirm).** The server accepts any photo taken before the end until 7 days
  after the reveal, and late arrivals appear in the gallery as they develop. Today the window is 60
  minutes after the end (`core/src/shots.ts:133-149`). The allowance still caps each guest, so a
  device clock set back only lets a guest use shots they already had.
- **D2, reveal notice for browser guests (confirm).** An optional "Email me when the photos are
  ready" after the first photo. The email link also restores the guest in any browser. Plus an
  "Add to calendar" file. No SMS, no web push for now (iOS only allows it from the home screen).
- **D3, archive (confirm).** Archived stays a label: photos, saving and the gallery keep working,
  and the event moves to a "Past" group in lists. This matches the privacy draft, which keeps photos
  until the host deletes the event or the account (`site/src/pages/privacy.md:74-80`).
- **D4, the host and the guest limit (confirm).** The host can shoot at their own event without
  using a guest place. Today the host joins as a guest and takes a slot (`app/src/shutter.tsx:66`,
  `app/src/join.tsx:62`).
- **D5, scheduled events.** An event can be live before it starts. Guests can join and read the
  rules, and the camera opens at the start time. Today the camera opens when the event goes live,
  days early for a Saturday wedding created on Monday (`core/src/shots.ts:128-131`).
- **D6, custom reveal.** Offered as "Pick a time" under the reveal options. Core and the site
  already support it (`core/src/reveal.ts`, `site/src/pages/index.astro:83`); the app offers three
  modes only (`app/src/create.tsx:90`).
- **D7, clock format (confirm).** Times follow the device's 12 or 24-hour setting. The scratchpad
  mixes "11:42 pm" (viewer, scratchpad:446) with 24-hour times elsewhere, and the code forces en-GB
  24-hour (`app/src/copy.ts:291-312`).
- **D8, recap output.** "Save photo" stays, as recorded in plan Results phase 4. A recap video file
  is under "Later".
- **D9, viewer gestures.** Double-tap zooms (the system photo convention). Liking stays on the
  button.

---

## 1. Host setup

### 1.1 Launch and welcome

The welcome screen isn't in the scratchpad. It uses the wedding hero photo, the wordmark, the
headline and one primary button.

- **[yes]** A cold launch shows the mark on Night and holds the splash until fonts and the stored
  session are ready, with no white flash (`app/app/_layout.tsx:22-41`).
- **[yes]** Welcome shows the hero photo with a Night gradient, the wordmark, "Every guest gets a
  camera. Everyone gets the night.", a body line and "Continue with email"
  (`app/src/home.tsx:50-111`, `app/src/copy.ts:19-24`). "Continue as demo host" appears only in
  development (`home.tsx:80-96`).
- **[yes]** A second, quieter entry for guests: "Have a code?" opens the code entry (section 4.1).
- **[yes]** If this device has joined events, they're listed above the sign-in as "Your events"
  (section 11.1).
- **[yes]** The legal line links both "Terms" and "Privacy Policy" as separate tap targets.
- **[yes]** If the session was dropped by the server, Welcome says "You've been signed out. Sign in
  to continue." once.
- **[yes]** The splash has a timeout (3 s) if the keychain read hangs, then shows Welcome.

### 1.2 Sign-in

A bottom sheet with two steps: email, then a 6-digit code.

- **[yes]** Email step: title "Sign in with email", an email field with autofocus and the email
  keyboard, Return submits, a client check with "Please enter a valid email address.", "Send code"
  with a busy state (`home.tsx:115-247`).
- **[yes]** Code step: "Check your email", "Enter the 6-digit code we sent to {email}.", a
  one-time-code field that submits itself at six digits, "Send a new code" and "Use a different
  email" (`home.tsx:199-203`).
- **[yes]** Every error comes from `copy.ts`, keyed by the server's code: wrong code ("That code
  doesn't match. Check the email and try again."), expired ("That code has expired. Send a new
  one."), locked after five tries ("Too many tries. Send a new code."), rate limited ("Please wait a
  few minutes before asking for another code."), email failed, offline.
- **[yes]** "Send a new code" is disabled for 30 seconds after each send, with the seconds shown
  ("Send a new code in 24s").
- **[yes]** On iOS, an "Open Mail" text button under the code field.
- **[yes]** Success: a success haptic, the sheet closes and the events list fades in.
- **[yes]** First sign-in only: one more step, "What should guests call you?", prefilled from the
  email's local part, saved with `PATCH /v1/me`. The name appears on the join sheet ("Alex invited
  you", section 4.2).
- **[yes]** Closing the sheet keeps the typed email and resets the rest (`home.tsx:143-151`).
- Accessibility: **[yes]** the error line is announced when it appears (section 14.6).

### 1.3 Your events

Not drawn in the scratchpad. Cover cards, 240 pt tall, radius 22, state chip top left, title, one
line under it.

- **[yes]** Header: wordmark and a Settings icon button (`home.tsx:333-345`).
- **[yes]** Grouped by what needs the host, in this order: **Live now**, **Coming up** (live, before
  the start), **Waiting for the reveal**, **Drafts**, **Revealed**, **Past** (archived).
- **[yes]** The line under each title says the one thing that matters for that state, in the event's
  time zone:
  - Live: "Camera open · 3h 10m left · 38 moments".
  - Coming up: "Opens Saturday at 15:00".
  - Waiting: "Saturday 14 June · Reveals tomorrow at 10:00", in the event's zone.
  - Draft: "Not live yet. Finish setting it up to get the code."
  - Revealed: "212 photos · 14 June".
- **[yes]** The live chip carries the Candle dot; no other state uses Candle
  (`home.tsx:376-428`).
- **[yes]** Tap: draft reopens setup, anything else opens `/e/<code>` (`home.tsx:317-322`).
- **[yes]** Long-press menu: Show code, Share link, Manage (live and later), Delete (drafts, and any
  event with a strong confirm, section 3.4).
- **[yes]** Loading: two card-shaped Surface placeholders.
- **[yes]** First-load error: "Your events couldn't be loaded." with "Try again".
- **[yes]** A failed background reload while a list is showing: a small line under the header,
  "Couldn't refresh. Showing what was loaded earlier."
- **[yes]** Empty: the mark, "No events yet", a body line and "Create an event"
  (`home.tsx:347-365`).
- **[yes]** "New event" pinned in the footer when the list has events.
- **[yes]** Pull to refresh, which shows its spinner whether or not a list is already showing.
- **[yes]** Cards fade in on first load (150 ms, none under Reduce Motion).
- **[yes]** Each card has one combined accessibility label: title, state and line.

### 1.4 Create an event

Five steps and the invite, as drawn (scratchpad:396-421). The progress line has five bars; the back
control sits on it; Continue is pinned to the bottom.

Across all steps:

- **[yes]** Steps slide horizontally (220 ms) and the progress bar fills over 200 ms. Under Reduce
  Motion, a cross-fade.
- **[yes]** Every choice (occasion, segment, slider stop, tier, toggle) gives a selection haptic.
- **[yes]** Back keeps everything entered; on step 1 the control is a close button labelled "Close".
- **[yes]** Leaving with changes (close, iOS swipe-back, Android back) asks "Discard this event?"
- **[yes]** The progress line is announced as "Step 2 of 5".

**Step 1, occasion.** "What are we capturing?", "We'll suggest shots, timing and guest count from
this.", five rows with duotone icons, one selected.

- **[yes]** Layout and copy match (`create.tsx:302-324`, scratchpad:396-399).
- **[yes]** Choosing an occasion fills in suggested rules, look and tier. Once the host has changed
  any of those by hand, a later occasion change keeps the host's choices.

**Step 2, name, date and cover.** "What's it called?", a large serif field, Date, Starts, Ends and
the cover tile.

- **[yes]** Placeholder per occasion, wraps, 60-character limit (`create.tsx:331-466`,
  `copy.ts:78-82`).
- **[yes]** From 50 characters on, a small "12 left" under the field.
- **[yes]** A **Starts** row with a time, defaulting to the next round half hour today or 18:00 on a
  future day.
- **[yes]** Ends opens a time picker in 5-minute steps, minimum start plus 15 minutes, phrased
  "Tonight, 21:00", "Sunday, 1:00" (`copy.ts:314-324`).
- **[yes]** An end before the start shows "The end needs to be after the start."
- **[yes]** Continue disabled with a blank title shows "Give it a name to continue." under the field
  when tapped.
- **[yes]** A **Time zone** row appears only when the chosen dates are far from now or the host
  changes it, defaulting to the device zone. Needed for trips (scratchpad's Tofino example).
- **[yes]** Cover: opens the library with a 4:3 crop; "Remove photo" once one is chosen; the upload
  starts in the background as soon as it's chosen; a failed upload shows "The cover couldn't be
  uploaded. Try another photo."
- **[yes]** Opening a picker dismisses the keyboard first.

**Step 3, rules.** "How should it work?"

- **[yes]** "When do photos appear?" segmented Right away / When it ends / Next morning, with the
  line "Everyone sees the photos tomorrow at 10:00." updating per choice (`create.tsx:500-554`).
- **[yes]** "Pick a time" text button under the segments opens a date and time picker; the segments
  then show none selected and the line reads the chosen time (D6).
- **[yes]** "Shots per guest" with the serif value and a slider over 5, 15, 24, 36, ∞. The thumb
  snaps to the five stops with a selection haptic at each, VoiceOver steps by stops, and the tick
  labels sit under their stops.
- **[yes]** Choosing ∞ shows "Unlimited shots add $9.99" under the slider, so the price isn't a
  surprise at step 5.
- **[yes]** "Who sees the photos?" Every guest / Only me, with the host-only note.

**Step 4, look.** "Pick a look", "Every photo at the event gets the same film."

- **[yes]** Three cards through the real shader on the cover or a sample, selected card with a white
  border (`create.tsx:556-602`, `app/src/look.tsx`).

**Step 5, guests and price.** "How many guests?", "One payment for this event. No subscription."

- **[yes]** Five tiers, "Popular" on 80, "Unlimited shots / Add $9.99" toggle, button "Start my
  film" or "Start my film for $19.99" (`create.tsx:604-651`).
- **[yes]** On native, prices show the store's localized string (CAD in Canada).
- **[yes]** When resuming a draft that already has unlimited, the row says "Included".
- **[yes]** In development without store keys, a "Test purchase" caption under the button.

**Start.**

- **[yes]** Creates the draft once, claims any pending store purchase, buys only what's still due,
  then goes live (`create.tsx:664-750`, `core/src/pricing.ts:95-106`).
- **[yes]** Changes made after a first attempt are saved before going live (`PATCH /v1/events/:id`).
- **[yes]** A resumed draft opens at step 5 with every earlier step reachable by Back.
- **[yes]** Errors say what happened: a cancelled payment returns to step 5 quietly; a failed
  payment says "The payment didn't go through. Your event is saved as a draft."; a network failure
  says "Linger couldn't reach the server. Your event is saved as a draft."; an end time that has
  passed says "The end time has passed. Pick a new end time." and goes to step 2.
- **[yes]** A partly completed purchase (tier bought, add-on cancelled) says "Up to 80 guests is
  paid. Unlimited shots wasn't added."
- **[yes]** Going live: success haptic, the invite card scales in from 0.96.

---

## 2. Inviting

### 2.1 The invite after creating

"Your film is ready", the cream card with the mark, the QR, the title, "Scan to join. No download
needed.", then "Print table cards" and "Share link" (scratchpad:418-420).

- **[yes]** Layout, real QR for the join link, both buttons (`create.tsx:754-819`,
  `app/src/api.ts:18-20`).
- **[yes]** The join code as text on the card, letter-spaced under the QR ("MAYA3X"), so it can be
  read aloud or written on a board.
- **[yes]** "Copy link" beside Share. Share passes the URL once.
- **[yes]** Close is labelled "Done" and sits on its own row, clear of the centred title at large
  text sizes.
- **[yes]** For a scheduled event (D5), a line under the card: "The camera opens Saturday at 15:00."
- **[yes]** Notification permission is asked here for the host, from a short card: "We'll tell you
  when the photos are ready." with "Turn on" and "Not now". The host's reveal reminder is scheduled
  here.

### 2.2 The invite sheet from the event and the camera

- **[yes]** The card at 200 pt and "Share link" (`event.tsx:799-826`).
- **[yes]** The code as text, "Copy link", and for the host "Print table cards".
- **[yes]** After the reveal, new people can't join (`api/src/events.ts:191-194`), so the QR action
  changes: members see "Share a photo" guidance instead of an invite, and the QR button is hidden.

### 2.3 Table cards

- **[yes]** Four cards on one page through the print sheet (`create.tsx:829-854`).
- **[yes]** Fonts embedded so cards print correctly offline.
- **[yes]** Each card carries the code as text and one line of rules: "24 shots each. Photos appear
  tomorrow at 10:00."

### 2.4 The shared link

- **[yes]** `join.lingercam.app/<code>` serves Open Graph tags per event: title "You're invited to
  shoot Maya turns thirty", the cover as the image, and "Scan to join. No download needed."
- **[partly]** Universal links (iOS) and App Links (Android) for the join domain, so the link opens
  the app when it's installed. The join domain serves `apple-app-site-association` and
  `assetlinks.json`, and the app declares the domain. The association file's app id still carries
  the placeholder team `TEAMID` and `assetlinks.json` has no certificate fingerprints, so links
  don't open the app until the real values are in (Q9, Q13).

---

## 3. Hosting live

The host opens their own event and sees the guest layout (cover, stats, actions, developing tiles)
with a host layer added. The scratchpad draws no host-only surfaces, so these follow its system:
Surface rows, Paper text, Candle only for progress.

### 3.1 The host layer on the event screen

- **[yes]** A host row under the actions: "7 of 10 guests" with a thin Candle bar. At 80% or more of
  the limit it adds "Make room", which opens the tier list priced by `due()`. The API accepts
  upgrades on live and ended events (`api/src/billing.ts:33-44`).
- **[yes]** A Manage button (gear, 48 pt Raised) in the action row, owner only.
- **[partly]** A full event sends the host a push: "Maya turns thirty is full. Make room for more
  guests." Guests see "This event is full. Ask the host to make room." The push is built, not
  verified on a physical iPhone (Q16).
- **[yes]** The people count stays current while the screen polls.
- **[yes]** Owner detection comes from the summary (a `role` field), not from loading every hosted
  event.
- **[yes]** "Open camera" for the host shoots straight away under the host's name, without the join
  sheet (D4).

### 3.2 Manage sheet

One sheet, rows in Surface groups. Only rows the current state allows are shown; locked fields are
shown disabled with one line of why. The rules are in `core/src/events.ts:142-181`.

- **[yes]** **Name**: editable until revealed.
- **[yes]** **Cover**: change any time (`POST /v1/events/:id/cover` allows it).
- **[yes]** **Ends**: live only; can move later, or earlier but not into the past.
- **[yes]** **Reveal**: can only move later once live. Disabled options read "Can't move the reveal
  earlier once guests are shooting."
- **[yes]** **Who sees the photos**: can go from Every guest to Only me, not back.
- **[yes]** **Show code**, **Copy link**, **Print table cards**.
- **[yes]** **End now** (live only): confirm "End the event now?" with "The camera closes for
  everyone. Photos appear {when}." and "End now". Calls `POST /v1/events/:id/end`, refreshes the
  summary, and shows the moment if it reveals at once.
- **[yes]** **Delete event** (section 3.4).
- **[yes]** Saving a change sends one PATCH, shows "Saved" for 2 seconds, and maps a `locked`
  refusal to copy. Every guest's local reveal reminder is out of date after a reveal change, so the
  server sends a silent push to update it (section 7.6).

### 3.3 People, as the host

- **[yes]** Count title, "Shot counts so far. Everyone's photos appear at the reveal.", rows with
  initial, name, "Joined 21:04" and count (`event.tsx:687-795`).
- **[yes]** The host's row is first and its second line reads "Host".
- **[yes]** "7 of 10 guests" under the title for the host.
- **[no]** Removing a guest: out of scope here, see Later.

### 3.4 Deleting

- **[yes]** A draft can be deleted from its card or from setup, with "Delete this draft?".
- **[yes]** Any other event can be deleted from Manage with "Delete Maya turns thirty?" and "This
  deletes every photo for every guest and can't be undone. Payments aren't refunded." The server
  removes rows and stored files under the event's key, cancels its reveal job, and the app cancels
  this device's reminder.

### 3.5 Reports

- **[partly]** When three reports hide a photo, the host gets a push: "A photo at Maya turns thirty
  was hidden after reports." and the host's grid shows a badge on reported and hidden tiles. The
  push is built, not verified on a physical iPhone (Q16).

---

## 4. Guest join

Target: scan to first shot in under 10 seconds on a phone with signal, with the app or without it.

### 4.1 Ways in

- **[yes]** Printed QR and shared link go to `join.lingercam.app/<code>`, which redirects to the
  join route (`app/app/[code].tsx:4-7`).
- **[partly]** With the app installed, the link opens the app (universal links, section 2.4). Built,
  but it can't work until the real team id and certificate fingerprints are in the association
  files.
- **[yes]** `linger://j/<code>` opens the join sheet natively.
- **[yes]** "Have a code?" on the native welcome and on the web root: six boxes, auto-advance,
  paste-aware, the unambiguous alphabet from `normalizeJoinCode` (`core/src/events.ts:270-275`).
- **[no]** An App Clip. Recorded as not feasible in React Native (plan Results phase 9); see Later.

### 4.2 The invite sheet

Over the blurred cover: the sheet with a 220 pt cover, the "Linger" byline, "You're invited to shoot
{title}", the rules line and one button (scratchpad:424-425).

- **[yes]** Layout, sizes and copy match within a few points (`app/src/join.tsx:111-149`,
  `.docs/vision/visual.md`).
- **[yes]** Rules line: "24 shots each. Photos appear tomorrow at 10:00.", with variants for
  unlimited and right-away (`join.tsx:24-35`).
- **[yes]** One more rule in the same line or under it: "Photos come from this camera only."
- **[yes]** The byline names the host when known, by first name: "Alex invited you".
- **[yes]** "Open camera" with the camera icon while shooting is possible.
- **[yes]** Each step fades in over 220 ms, and the sheet animates its height between steps.
- **[yes]** The grab bar either dismisses on a downward swipe or is removed.

States, each with its own title and line:

| State | Title | Line | Button | Now |
| --- | --- | --- | --- | --- |
| Loading | (cover placeholder) | | | **[yes]** |
| Live, open | You're invited to shoot {title} | 24 shots each. Photos appear tomorrow at 10:00. | Open camera | **[yes]** |
| Live, before start (D5) | You're invited to shoot {title} | The camera opens Saturday at 15:00. | Join now | **[yes]** |
| Full, not joined | {title} is full | Ask the host to make room. | Try again | **[yes]** |
| Draft | {title} isn't open yet | The host is still setting it up. | Try again | **[yes]** |
| Ended, joined or not | The camera has closed | Photos appear tomorrow at 10:00. | See the event | **[yes]** |
| Revealed, member | The photos are ready | 612 moments from 34 people. | See the photos | **[yes]** |
| Revealed, not a member | These photos are for the people who were there | If you joined on another phone or browser, open the email link or rejoin there. | (none, or "I joined on another device" from D2) | **[yes]** |
| Unknown code | There's no event with that code | Check the code and try again. | Code entry with the code prefilled | **[yes]** |
| Offline | This event couldn't be loaded | Check your connection and try again. | Try again | **[yes]** |

- **[yes]** Draft, full and before-start sheets refresh every 15 seconds while open, so the guest
  moves on when the host goes live or makes room.
- **[yes]** The sheet's clock isn't frozen at mount; a sheet left open past the end switches to the
  ended state.

### 4.3 Name

- **[yes]** "What should we call you?", "Your name goes on every photo you take, so everyone knows
  who took it.", centred serif field, `given-name`, Return submits, Continue with a busy state
  (`join.tsx:150-185`).
- **[yes]** Prefilled from the last name used on this device or the signed-in host's name
  (`join.tsx:62`).
- **[yes]** A device with a stored name skips this step: the invite button reads "Join as Sam" and a
  small "Not Sam?" link opens the name step.
- **[yes]** Back to the invite step from the name step.
- **[yes]** Disabled Continue reads as disabled: Raised background with Faint text.
- **[yes]** Join success gives a light success haptic.

### 4.4 Camera permission

- **[yes]** No pre-prompt screen when the permission hasn't been asked. Continue on the name step
  goes straight to the system prompt, then the camera. The "Allow the camera" step appears only when
  access is denied.
- **[yes]** Denied on native: "Linger needs the camera to take photos. Turn it on in Settings." and
  "Open Settings".
- **[yes]** Denied on the web: `camera.webDenied` and "Try again".
- **[yes]** On web, the camera stream opened for the permission check is kept and handed to the
  camera, so Safari asks once.
- **[yes]** Notifications are not asked during join.

### 4.5 Handoff

- **[yes]** Joining lands the event under the camera, so leaving the camera lands on the event
  (`join.tsx:72-75`).
- **[yes]** The summary and `me` from the join screen are reused by the camera without a second
  request.

---

## 5. Camera

As drawn (scratchpad:426-428): top bar with back, title and "6h 10m left", QR; viewfinder radius 28
with 12 pt margins in the warm film; tools row (flash, zoom 0.5/1×, flip); rolling counter, the
84 pt shutter and the last-shot thumbnail.

### 5.1 Layout and preview

- **[yes]** Top bar, viewfinder, tools, shutter and thumbnail sizes match the CSS
  (`shutter.tsx:133-153,406-485`).
- **[partly]** The film look is live in the viewfinder. Native draws it through the VisionCamera
  Skia frame processor (`FILM_SHADER`); the web builds it from core's look as an SVG colour matrix
  and gradient, without grain or halation. The native look is built, not verified on a physical
  iPhone (Q16), since the simulator has no camera.
- **[yes]** The web viewfinder clips cleanly at its corners.
- **[yes]** The screen stays awake while the camera is open (`expo-keep-awake`, `navigator.wakeLock`
  on web).
- **[yes]** On web, the camera stops when the tab is hidden and restarts when it returns.

### 5.2 Shutter

- **[yes]** Medium impact haptic, a white blink (85% for 60 ms, out over 260 ms), capture, queue,
  thumbnail, Live Activity update (`shutter.tsx:104-128`).
- **[yes]** A second, lighter haptic 120 ms later for the film advance.
- **[partly]** A soft shutter sound that respects the silent switch, or none (Q11). The system
  shutter sound, which the silent switch mutes, stands in for now; a sound of Linger's own isn't
  made.
- **[no]** Volume buttons fire the shutter on native. Moved to Later: VisionCamera 5 has no event
  for the volume buttons.
- **[yes]** Under Reduce Motion the blink is a 40% dim instead of white.
- **[yes]** VoiceOver announces "17 shots left" after each shot.

### 5.3 Counter

- **[yes]** Serif rolling counter, 260 ms roll (`shutter.tsx:350-394`), "∞" for unlimited.
- **[yes]** Neighbours spill past the chip and fade into Night, as drawn.
- **[yes]** No neighbour above the allowance on a full roll.
- **[yes]** The last three shots show the number in Candle, and the last shot gives a warning
  haptic.
- **[yes]** The counter shows the cached count while `me` loads, and the shutter waits until a count
  is known.

### 5.4 Tools

- **[yes]** Flash: on the back camera, Auto / On / Off, defaulting to Auto, remembered per device.
- **[partly]** Front camera "screen flash": the screen goes white at full brightness during capture.
  The white overlay fires on On (not Auto), and there is no brightness boost because
  `expo-brightness` isn't installed.
- **[yes]** Zoom pill 0.5 / 1× where the device has an ultra-wide.
- **[yes]** The zoom pill is hidden when only one lens exists, instead of a lone "1×" chip.
- **[partly]** Pinch to zoom and tap to focus and expose on native: built, not verified on a
  physical iPhone (Q16).
- **[yes]** Flip.
- **[yes]** Flash label "Flash" with its state as the value ("Auto"), not "Flash on" as the name.
- **[yes]** On web, the saved front-camera photo matches the mirrored preview.

### 5.5 Last shot and upload status

- **[yes]** The last shot through the look in the thumbnail; it survives leaving and reopening the
  camera; before the first photo, a faint mark instead of an empty square.
- **[yes]** A small Candle ring on the thumbnail while photos are still sending. Tapping the
  thumbnail opens the event, which says how many are waiting.
- **[yes]** After a capture failure, a short line over the bottom of the viewfinder that fades after
  3 s.

### 5.6 Camera states

Each state covers the viewfinder with a title, a line and one button.

| State | Copy | Now |
| --- | --- | --- |
| Before start (D5) | "The camera opens at 15:00." Countdown in the top bar. | **[yes]** |
| Closing soon (under 10 min) | Top bar reads "Closes in 8 min". | **[yes]** |
| Closed | "The camera has closed. Photos appear tomorrow at 10:00." / See the event | **[yes]** |
| Out of shots | "That's your roll" / "You've used every shot. The photos appear tomorrow at 10:00." / See the event, with a success haptic | **[yes]** |
| Offline, cached | Camera works; a small "Offline. Photos will send later." line in the top bar | **[yes]** |
| Offline, nothing cached | "This event couldn't be loaded. Check your connection and try again." / Try again | **[yes]** |
| Permission blocked | As 4.4 | **[yes]** |
| No camera (simulator, headless) | "Using sample photos" in development | **[yes]** |

---

## 6. Uploads: nothing is lost

- **[yes]** Every photo goes into a persisted queue with its file in the app's documents before
  anything else happens (`app/src/uploads.ts`, `camera.tsx:81-93`).
- **[yes]** Reserve with the queue id so a retry returns the same shot; PUT; confirm; then the local
  file is deleted (`uploads.ts:62-73,121`, `api/src/shots.ts:222-241`).
- **[yes]** Backoff 2 s to 60 s, reset when the app becomes active, resumed on launch
  (`uploads.ts:110-114,193-198`).
- **[yes]** The counter is optimistic (`uploads.ts:211-221`).
- **[partly]** Uploads continue in the background on iOS (background `URLSession` upload tasks), and
  on Android through a foreground service while photos are waiting. On iOS the PUT runs as an
  `expo-file-system` background upload and is confirmed when Linger next comes to the foreground;
  this is built, not verified on a physical iPhone (Q16). The Android foreground service isn't built
  (Q9).
- **[yes]** Reconnecting triggers an immediate retry (NetInfo or `online`), not the next backoff
  tick.
- **[yes]** Every request has a timeout (20 s for API calls, 90 s for a PUT), so one hung request
  can't stall the queue.
- **[yes]** The device never deletes a photo the server hasn't accepted. If a refusal is final, the
  photo is saved to the guest's library and the event says "1 photo couldn't be added to the event,
  so it was saved to your Photos." When it can't be saved at once, and always in the browser, it
  stays on the device until the guest taps Save or Download.
- **[yes]** Late photos per D1, so a guest who opens the app the next morning still gets their
  photos in.
- **[yes]** `too-large` and a missing local file are handled: the first is resized and retried once,
  the second is dropped with "1 photo couldn't be read."
- **[yes]** Native resizes to 2048 px before queueing, matching what the server keeps
  (`api/src/shots.ts:60`), so each upload is smaller on venue Wi-Fi.
- **[yes]** On web, queued photos are Blobs in IndexedDB.
- **[yes]** When the server fails to develop a photo and returns the shot (plan Results phase 8),
  the event screen says "1 photo couldn't be developed. You got the shot back."
- **[yes]** When the queue empties after being offline: "All 12 of your photos are in." for 3 s.

---

## 7. Waiting for the reveal

### 7.1 The event screen before the reveal

As drawn (scratchpad:429, `home(E, true)`): cover with title, stats (Moments, "6h 10m" Left,
People ›), the camera button with QR and download, then the developing grid.

- **[yes]** Cover 470 pt, scrim, serif 38 title, stats, action row, two-column 3:4 grid within a few
  points of the design (`event.tsx:442-488`, `visual.md`).
- **[yes]** The middle stat is "Left" while shooting and "To reveal" after. At the reveal time it
  never reads "0m To reveal"; it reads "Now" until the gallery arrives.
- **[yes]** A line under the actions for the guest: "Your roll: 7 taken, 17 left", from the gallery
  page's `mine`.
- **[yes]** Upload lines ("2 photos waiting to upload", "Photos will upload when you have signal
  again.") sit in a fixed slot so the grid doesn't jump.
- **[yes]** After the camera closes, the camera button becomes a labelled status, "Reveals tomorrow
  at 10:00".
- **[yes]** The download button is hidden until there are photos.
- **[yes]** A back or home control when the event was opened from a link: on native, `/` sits under
  any deep link, so Back goes to the events list.
- **[yes]** Empty: "No photos yet. Open the camera to take the first one."; after close: "No photos
  were taken before the camera closed." (`copy.ts:198-200`).
- **[yes]** Pull to refresh shows its spinner.
- **[yes]** Refetch on focus and on returning to the foreground.

### 7.2 Developing tiles

- **[yes]** Tiles come from counts only, never from photos. They vary: each tile takes a hue and
  brightness from its position and shows the photographer's first name in serif italic (names aren't
  secret).
- **[yes]** Capped at 40, then "212 more developing" (`event.tsx:550-554`).
- **[yes]** The tile grid reads as one element for VoiceOver: "212 photos developing".
- **[yes]** Fixed 6 pt gap between columns.

### 7.3 Countdown

- **[yes]** Countdown in the event's zone through `revealCountdown` (`core/src/reveal.ts`). It
  updates every minute in the last 12 hours and every second in the last minute.
- **[yes]** The screen schedules a refresh at `revealsAt` plus 3 seconds and polls every 5 seconds
  in the last minute, so the moment appears within seconds of the reveal.
- **[yes]** When the viewer's zone differs from the event's, the zone is named: "tomorrow at 10:00
  Vancouver time".

### 7.4 Asking for notifications

- **[yes]** A guest is asked from a card on the event screen the first time they leave the camera,
  or on "That's your roll": "Get a nudge at 10:00 when the photos are ready." with "Turn on" and
  "Not now". "Not now" hides it for this event.
- **[partly]** Granted: a local reminder at `revealsAt` with id `reveal-<code>`, and the push token
  is registered with the EAS project. Remote delivery is built, not verified on a physical iPhone
  (Q16); it also needs `EXPO_ACCESS_TOKEN` on the API.

### 7.5 Browser guests

- **[yes]** After the first photo, a card: "Want to know when the photos are ready?" with an email
  field and "Email me", plus "Add to calendar" (an `.ics` with the reveal time and the event link).
  The address is stored against the guest, used once for the reveal email and for identity recovery,
  and deleted when the event is deleted (D2).
- **[yes]** A one-line "Add to Home Screen to come back later" hint on iOS Safari after the reveal
  email card, shown once.

### 7.6 Keeping reminders right

- **[partly]** When the host changes the reveal or ends early, each device's reminder is
  rescheduled: the server sends a silent push to registered devices, and every app launch
  reschedules reminders for joined events from fresh summaries. The launch path works now; the
  silent push is built, not verified on a physical iPhone (Q16).
- **[yes]** One banner per reveal: a device whose push token is registered for the event cancels its
  local reminder.

### 7.7 Live Activity (iOS, app guests)

As drawn (scratchpad:430-431): title, "9 of 24 shots left", a Candle bar, "212 moments so far",
"Reveals tomorrow".

- **[yes]** Starts on the first photo, updates per photo, taps through to the event
  (`app/src/activity.ts:48-63`, `apps/app/targets/activity/LingerActivity.swift`).
- **[yes]** Its job is the shooting window: stale date and end at `endsAt`, not the reveal. After
  the end it reads "The camera has closed. Photos at 10:00." and leaves the lock screen within the
  system's limits.
- **[yes]** "Your roll is done" when shots reach 0.
- **[yes]** The moments count comes from the summary the app already has, not a gallery request per
  photo.

---

## 8. The reveal

### 8.1 The flip and the notification

- **[yes]** A pg-boss job at `revealTime(settings)` moves the event to revealed and sends pushes to
  the host and every guest device (`api/src/reveal.ts:31-93`), with a sweep after downtime
  (`reveal.ts:96-113`).
- **[yes]** The notification reads "Maya turns thirty: the photos are ready. 612 moments from 34
  people." as drawn (scratchpad:439-441). The local reminder can't know counts, so it reads "Maya
  turns thirty: the photos are ready."
- **[partly]** Push works: an EAS project id, receipts checked, dead tokens pruned. The project id
  is set and the API code is in place; delivery is built, not verified on a physical iPhone (Q16)
  and needs `EXPO_ACCESS_TOKEN`.
- **[yes]** Browser guests who left an email get the reveal email with the same line and a link that
  signs them back in as their guest (D2).
- **[yes]** Tapping the notification opens the event once, after the navigator is ready, without
  stacking a second copy if the event is already open.
- **[yes]** A banner isn't shown while the person is already on that event.

### 8.2 Landing

- **[yes]** Opening from the notification, the lock screen or an open screen lands on "It's all
  here." within two seconds, never on a developing grid reading "0m".
- **[yes]** The summary returns the time-driven state (`dueState`), so clients don't infer
  "revealed" from photos arriving.

### 8.3 The moment

As drawn (scratchpad:442-444): "It's all here.", "612 moments, 34 photographers.", three fanned
cards, "See every moment".

- **[yes]** Title, line, card geometry and the 900 ms fan match the design (`event.tsx:621-683`).
- **[yes]** Shown once per device per event, for host and guests (`event.tsx:379-391`).
- **[yes]** The three cards are chosen by the server: different photographers, spread across the
  night, and one of the viewer's own photos when they have one.
- **[yes]** The front card uses the full photo, not the 512 px thumbnail.
- **[yes]** A personal line under the count when the viewer shot: "12 of these are yours."
- **[yes]** "See every moment" gives a success haptic as the fan opens.
- **[yes]** The cards settle into the first grid tiles as the grid fades up (500 ms). Under Reduce
  Motion, a cross-fade.
- **[yes]** The 1300 ms timer is cleared if the screen unmounts.
- **[yes]** A screen already open when the flip happens swaps to the moment.

### 8.4 Right-away events

Photos appear as they develop, so there's no secret to reveal.

- **[yes]** No fan moment while live (plan Results phase 4).
- **[yes]** While live, the grid updates every 30 seconds with new photos fading in, and the stats
  read "Live" instead of a countdown.
- **[yes]** When the camera closes, a short line at the top: "That's the night. 612 moments from 34
  people." with "Watch the recap".

---

## 9. Gallery and viewer

### 9.1 The revealed event screen

As drawn (scratchpad:445, `home(E, false)`): stats Moments, "Revealed / Yesterday", People ›; the
grid signed in serif italic.

- **[yes]** Stats, two-column grid with names, 30 per page, infinite scroll
  (`event.tsx:541-594`, `api/src/shots.ts:64`).
- **[yes]** The primary action reads "Watch the recap" with the play icon.
- **[yes]** Hidden tiles show an eye-slash badge for the host.
- **[yes]** The gallery refreshes on focus and when its signed URLs are within 10 minutes of expiry.
- **[yes]** Images cache by shot id and size (`cacheKey`), so polls and revisits don't download
  again.
- **[yes]** Late photos (D1) appear in place by time, with the stats updated.
- **[yes]** Empty revealed gallery: "No photos were taken at this event."
- **[yes]** Gallery error: the stats don't show "0 Moments" as if real, and the grid area has a
  retry.

### 9.2 People and rolls

As drawn (scratchpad:453-454): "34 people", "Tap anyone to see their roll.", faces, names, counts.

- **[yes]** Sorted by count, faces from photos after the reveal, serif counts
  (`event.tsx:687-795`, `api/src/events.ts:372-395`).
- **[yes]** Second line: "Host" for the host, "Joined 21:04" for everyone else. The design's roles
  ("Bride's side") aren't modelled and stay out.
- **[yes]** Counts include only photos the viewer can see.
- **[yes]** A roll is complete: the gallery API takes `?guest=` and the roll pages from the server.
- **[yes]** "{name}'s roll" and "Show everyone" (`copy.ts:196`).
- **[yes]** The viewer opened from a roll pages within the roll.
- **[yes]** One divider weight across rows.

### 9.3 The photo viewer

As drawn (scratchpad:446-448): the photo full screen, back, "1,204 of 4,293", share; the
photographer in serif italic, "11:42 pm, Warm '98"; like with count and Save.

- **[yes]** Horizontal paging, loads more at the end, photographer, time and look, like (optimistic
  with rollback) and Save (`photo.tsx:137-228`).
- **[yes]** The whole photo is always visible, on a blurred, darkened copy of itself.
- **[yes]** Pinch and double-tap to zoom; swipe down to close; tap to hide and show the controls;
  arrow keys on the web.
- **[yes]** Top bar: back, position centred, share. Report (guests) and Hide (host) move to a "More"
  button beside share or a long-press.
- **[yes]** Like has a selected state for VoiceOver and a small scale bounce with a light haptic.
- **[yes]** Share shows a busy state while the photo downloads.
- **[yes]** Notes ("Saved to Photos", "Thanks. The photo has been reported.") float over the photo
  and are announced.
- **[yes]** The photographer's name opens their roll.
- **[yes]** Hide is immediate and undoable ("Hidden from guests. Undo").
- **[yes]** A guest can remove their own photo after the reveal, from the viewer's More menu (Q12).

### 9.4 Download all

- **[yes]** "Saving 12 of 212", then "212 photos saved to Photos" (`event.tsx:410-426,480-497`).
- **[yes]** Saves into an album named after the event.
- **[yes]** Asks for photo access once at the start, not per photo.
- **[yes]** Continues past a single failure and ends with "210 of 212 saved. 2 couldn't be saved." A
  refused permission says "Linger needs access to Photos to save them." with "Open Settings".
- **[yes]** "Stop" while saving; leaving the screen keeps it going with the status on the event.
- **[yes]** Signed URLs are refreshed before saving starts.
- **[yes]** One line, once, says photos are kept at 2048 px.
- **[yes]** Web: one download per photo works on desktop; on phones, the button explains "Save
  photos one at a time from the viewer." until a ZIP exists (Later).

### 9.5 Sharing

- **[yes]** Share in the viewer shares the photo file itself. Share in the recap shares the photo on
  screen, not the join link, which would send non-members to a refusal.

---

## 10. Recap

As drawn (scratchpad:449-452): full-screen photos, story bars, the title, "The whole night in 60
seconds", Save and Share.

- **[yes]** Up to 12 photos, 5 s each, slow zoom, bars, tap left or right, hold to pause, full-screen
  modal with a fade (`recap.tsx:31-218`, `app/app/_layout.tsx:56-59`).
- **[yes]** The server picks the slides in one call: on reveal day, when nobody has liked anything,
  one or two per photographer spread over the night; later, the most liked.
- **[yes]** The slide set doesn't change while it plays.
- **[yes]** Each slide credits its photographer in small serif italic.
- **[yes]** An end card: the title, "612 moments from 34 people", "Watch again" and "See every
  moment".
- **[yes]** Title overlay on the first slide, fading after 3 s.
- **[yes]** Slides cross-fade (300 ms) and don't start soft from the thumbnail.
- **[yes]** Landscape photos pan across the frame instead of being cropped and upscaled.
- **[yes]** A pause indicator; VoiceOver actions for next and previous; under Reduce Motion, no zoom
  and no auto-advance.
- **[yes]** "Save photo" saves the photo on screen (D8); Share shares that photo.
- **[yes]** The close button is a small X aligned with the end of the bars.

---

## 11. After the event

### 11.1 Finding the event again

- **[yes]** The app home lists events this device joined, beside the host's own, grouped like 1.3.
  Joined codes are kept on the device and refreshed with a device-scoped call.
- **[yes]** The web root (`join.lingercam.app/`) is a guest home: events this browser joined, "Have
  a code?", one paragraph on what Linger is and a link to the site.
- **[yes]** The guest's device id is kept in the keychain on iOS, so a reinstall is the same guest.
- **[yes]** A guest who left an email can open the reveal email link in any browser and be the same
  guest (D2). A guest without one who changes browser can't get back in after the reveal; the "not a
  member" sheet says so plainly (4.2).

### 11.2 Archived

- **[yes]** 90 days after the reveal the event is archived and nothing else changes, and the list
  moves it to "Past" (D3).

### 11.3 Post-reveal notifications

- **[no]** None beyond the reveal. A single "People loved your photos" summary the next evening is
  listed under Later.

---

## 12. Account and settings

Settings is a modal: "Settings", "Signed in as {email}", Help and support, Privacy Policy, Terms of
Service, Sign out, Delete account, the version.

- **[yes]** Rows, in-app browser links, version (`home.tsx:432-550`).
- **[yes]** **Name** row, editable (`PATCH /v1/me`).
- **[yes]** **Notifications** row showing the system permission, opening system settings when off.
- **[yes]** **Sign out**: no confirm unless photos are still uploading or a purchase is unclaimed
  ("2 photos are still uploading. Sign out anyway?"). Signing out cancels this host's reminders.
- **[yes]** **Delete account**: the confirm names what goes: "This deletes your account, your 3
  events and every photo in them. Live events end for every guest. Payments aren't refunded."
- **[yes]** Destructive rows use Paper text with a trash icon, not Candle.
- **[yes]** On success, Welcome, with this device's per-event state cleared (reminders, moment
  flags, queue).

---

## 13. Site and guest web app

### 13.1 Site (lingercam.app)

The scratchpad page ported to Astro: hero with three phones and occasion pills, the three acts,
pricing, questions, footer.

- **[yes]** Home renders every phone screen for all five occasions at build time and works without
  JavaScript (plan Results phase 5).
- **[yes]** Pricing from `core/pricing.ts` on home and `/pricing/`; privacy, terms, support and
  delete-account pages; OG tags and the social image (checked on 8170).
- **[yes]** The site describes what ships: "Guests join from the QR code in their browser, or in the
  app if they have it." The custom reveal claim is true with D6, and the Live Activity caption says
  it's for guests using the iPhone app.
- **[yes]** The "Try Linger" QR opens the guest home with "Have a code?" (13.2).
- **[partly]** The App Store button goes to the listing once it exists; until then
  `/support/#get-the-app`, which is what it does now. The listing doesn't exist yet (Q13).
- **[yes]** Support answers match the app, including what can change after the event starts (3.2).
- **[partly]** Legal drafts carry the lawyer note and bracketed placeholders, which must be filled
  before launch. They are still placeholders (Q13).
- **[yes]** Privacy says what D2 stores (an optional guest email) and how long.

### 13.2 Guest web app (join.lingercam.app)

- **[yes]** Join, camera, event, photo and recap work in the browser (qa.md web section,
  `pnpm test:e2e`).
- **[yes]** First paint doesn't wait on fonts: Latin woff2 subsets and system fallback while they
  load.
- **[yes]** The guest web app's head (`app/public/index.html`, since `output: "single"` never
  renders `+html.tsx`) has `viewport-fit=cover`, a description and the apple-touch-icon, and
  `/v1/e/:code/page` fills in the per-event OG tags from 2.4.
- **[partly]** The shutter row clears the floating Safari toolbar on iOS 26 (`viewport-fit=cover`
  and the safe-area inset are in place). Not checked: simulator Safari has no camera, so the web
  camera never opens there; it waits for the device pass (Q16).
- **[yes]** Unknown paths that aren't codes show a plain "This page doesn't exist" with a link to
  the guest home, not "There's no event with that code".
- **[yes]** Host routes show "Hosting happens in the app" with one button per store that goes to
  that store.
- **[yes]** Confirm dialogs use the app's sheet, not `window.confirm`.
- **[partly]** On Android Chrome, `ImageCapture.takePhoto()` for a real still with flash where
  supported, instead of a video frame. Built and run in desktop Chromium; Android is verified only
  in the Android pass (Q9).

---

## 14. System-wide

### 14.1 Data and caching

- **[yes]** One small query cache with stale-while-revalidate, keyed like the `useLoad` keys, so
  screens reuse the summary the previous screen loaded.
- **[yes]** `summary:<code>` and `me:<code>` persist on the device, so the camera and event open
  offline.
- **[yes]** Refetch on focus and on returning to the foreground; polling paused in the background.
- **[yes]** The summary carries the viewer's role, guest id, shots left, the server time and the
  time-driven state.

### 14.2 Errors and copy

- **[yes]** One `problem(code)` in `copy.ts` used by every screen, with a string for each API code
  (`system.md` section 5 lists them). Server messages are for logs only.
- **[yes]** A contract mismatch (bad JSON, schema failure) says "Something went wrong. Try again."
  rather than blaming the connection.
- **[yes]** A glossary at the top of `copy.ts`: **film** is the event, **roll** is one guest's
  shots, **shot** is the allowance unit, **photo** is the result, **moment** is the count on the
  cover.
- **[yes]** Copy is in one ICU catalogue with no em dashes (`copy.ts`).
- **[yes]** Strings outside the catalogue move in: "Free" and "$" in core's `formatPrice`, the
  "Developing" default in `Tile`, duration units, the "›" in "People ›".
- **[yes]** Copy that claims more than the code does is fixed with the feature: "The host will be
  told" (3.5).

### 14.3 Time

- **[yes]** One rule: event facts in the event zone, with the zone named when it differs; the
  device's hour cycle for display (D7).
- **[yes]** Countdowns and the shooting window use a server time offset from the response `Date`
  header, not the raw device clock. The last offset is stored, so a screen opened offline keeps the
  server's time.

### 14.4 Haptics

| Moment | Haptic | Now |
| --- | --- | --- |
| Shutter | Medium impact, then light 120 ms later | **[yes]** |
| Last three shots | Light impact | **[yes]** |
| Last shot / That's your roll | Warning, then Success | **[yes]** |
| Selections (occasion, segments, slider stops, tiers, toggle, flash, zoom) | Selection | **[yes]** |
| Sign-in, join, going live, purchase, saved to Photos | Success | **[yes]** |
| Like | Light impact | **[yes]** |
| Fan opens on the moment | Success | **[yes]** |
| Destructive confirm shown | Warning | **[yes]** |

### 14.5 Motion

| Where | Motion | Reduce Motion | Now |
| --- | --- | --- | --- |
| Sheets | Fade backdrop, slide 280 ms | Fade | **[yes]** slide (`ui.tsx:770-805`) |
| Create steps | Slide 220 ms, progress fill 200 ms | Cross-fade | **[yes]** |
| Join steps | Fade 220 ms with height animation | Fade | **[yes]** |
| Shutter | White blink | 40% dim | **[yes]** |
| Counter | Roll 260 ms | Swap | **[yes]** |
| Moment | Fan 900 ms, cards settle into the grid | Cross-fade | **[yes]** |
| Recap | Zoom or pan, cross-fade | Still, manual advance | **[yes]** |
| Invite after going live | Scale from 0.96 | Fade | **[yes]** |

- **[yes]** The app reads Reduce Motion explicitly (`useReducedMotion`).

### 14.6 Accessibility

- **[yes]** Icon buttons, tiles, stats, tiers, slider and toggle have labels; titles are headers
  (`ui.tsx:332-335,501,606-613,885,927`).
- **[yes]** Errors, toasts and upload status are announced (live region or
  `announceForAccessibility`).
- **[yes]** Dynamic Type: display and cover styles capped, rows and buttons grow, tested at the
  largest accessibility size.
- **[yes]** Contrast: text in Faint (#6D6B65, about 3.6:1 on Night) is 15 pt or larger, or moves to
  Ash.
- **[yes]** Recap navigation by VoiceOver actions, like selected state (9.3), the "›" removed from
  labels.
- **[yes]** Titles avoid single-word last lines: `lineBreakStrategyIOS="push-out"` on iOS and a
  no-break space between the last two words elsewhere. Body lines can still end on one word.

### 14.7 Design system

- **[yes]** Colour tokens match the brand: Night, Surface, Raised, Paper, Ash, Faint, Candle
  (`ui.tsx:68-96`).
- **[yes]** Newsreader at its display optical size for titles, numbers and names, as the scratchpad
  specifies. The Live Activity's bundled font gets the same fix.
- **[partly]** Spacing and radius scales, one divider token, one Sheet, one Row, one Toast, one
  share helper. The scales, the divider token and the shared Sheet, Row and Toast exist and most
  screens use them; about 40 literal radii remain in screen styles.
- **[yes]** An error treatment without Candle: Paper text with a warning icon. Candle stays for
  live, progress, the caret, the Popular tag and badges (Principle 5).
- **[partly]** Colours and sizes outside the tokens are removed (`system.md` section 10 lists each).
  A few literal colours remain (two text greys in `photo.tsx` and `people.tsx`, the black of the
  scrims).

### 14.8 Platform parity

- **[no]** Android: built and run once through every flow. Keyboard avoidance on Android for the
  name and email sheets, a notification channel, and an ongoing notification as the Live Activity's
  counterpart. Android is out of this run (Q9) and waits for its own pass.
- **[yes]** Signed media URLs reachable from a device on the local network in development, through
  `S3_PUBLIC_ENDPOINT`.

### 14.9 Performance

- **[yes]** Demo photos bundled only in development.
- **[yes]** Font subsets in native builds as well as the web.
- **[yes]** The last-shot thumbnail decodes a small image (192 px), not the full capture.
- **[yes]** People list virtualised for 250 guests.

---

## Later

Bigger than the planned product, or worth doing once the above is solid.

- **Native App Clip** for iPhone: a SwiftUI join and camera under 15 MB (plan Results phase 9). It
  removes the browser step for most guests.
- **Recap video** that can be saved and shared, rendered on the server from the developed photos.
- **ZIP download** for hosts and web guests, built by a job and linked by email.
- **Live slideshow** link for a screen at the venue, for right-away events.
- **Remove a guest** from the people list (Once added this in 1.7).
- **Top-up packs** (+10, +25 guests) instead of moving a whole tier.
- **Full-size developed copies** for paid tiers.
- **Optional date stamp** on Warm '98.
- **Guest book** note with a photo.
- **Post-reveal notifications**: "People loved your photos", an anniversary nudge.
- **Live Activity pushes** from the server (ActivityKit tokens and APNs), so the lock screen can
  show the reveal with counts.
- **Co-hosts.**
- **Web push** for guests who add Linger to the home screen.

## Open questions

- Shutter sound: a soft film-advance sound that respects the silent switch, or none?
- Should a guest be able to take back one of their own photos after the reveal, given the terms
  already say photos can be removed?
- For right-away events, is a closing line and the recap enough, or does the night need its own
  moment?
- Should the host see a "Reported" list, or is the push and a badge on tiles enough?
