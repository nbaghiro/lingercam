# Host experience: how it works now, and what it should be

Read-only review, 2026-11-02. Sources: `apps/app/src/{home,create,event,purchase,purchase.web,api,ui,copy}.ts(x)`,
`apps/app/app/*`, `apps/api/src/{accounts,events,billing}.ts`, `packages/core/src/{events,pricing,shots}.ts`,
the scratchpad (`../smallwares/.scratchpad/linger/index.html`, `SCREENS.setup` at lines 393-421) and
read-only requests to the live API on 8171. Nothing was run on the simulator.

"Now" means what the code does today. "Should" is my proposal.

## 0. The short version

The setup flow (five steps plus the invite) is close to the scratchpad and solid. After the invite,
**the host has almost no hosting tools**. The API already supports editing settings
(`PATCH /v1/events/:id`), ending early (`POST /v1/events/:id/end`) and upgrades while live
(`dev-claim`/`claim` accept live and ended events), but the app client has no calls for any of them
(`api.ts:256-268` only has list/get/create/cover/live). Once an event is live, the host sees exactly
what a guest sees (`event.tsx:287-615`). There is no way to delete an event or a draft (no route,
no UI), no way to read the join code as text, no way to fix a draft's details, and no signal when an
event fills up.

The scratchpad only designs the setup steps and the invite for the host (`index.html:393-421`).
Welcome, sign-in, the events list, settings and every host-management surface are app-invented, so
"matches the design" is only checkable for the five steps and the invite card.

## 1. Entry: first launch and sign-in

### Now
- Root layout waits for fonts and the stored session before hiding the splash
  (`app/_layout.tsx:22-41`), then runs `claimPending` (pending store claims, `purchase.ts:107`),
  `resumeUploads` and `endPastActivities`. No white flash path visible in code.
- `HomeScreen` (`home.tsx:41-46`): web shows `HostAppNote`; no session shows `Welcome`; otherwise
  `Events`.
- **Welcome** (`home.tsx:50-111`): hero photo `w-hero.jpg` with a Night gradient (62% height), the
  wordmark at 34, display title "Every guest gets a camera. Everyone gets the night.", body,
  "Continue with email" (primary, envelope icon), and in `__DEV__` only "Continue as demo host"
  (dark). Demo errors show a Notice (`home.tsx:97`, network vs generic). Legal line is one link to
  Terms (`home.tsx:98-106`) although the copy names both Terms and the Privacy Policy
  (`copy.ts:24`).
- **Sign-in sheet** (`home.tsx:115-247`), a bottom `Sheet` (fade backdrop, slide-in 280 ms,
  `ui.tsx:770-805`):
  - Step 1: "Sign in with email", body, email Input (autoFocus, email keyboard, `returnKeyType=send`
    submits), client regex check (`home.tsx:113,126`) with "Please enter a valid email address.",
    "Send code" (busy spinner).
  - Step 2: "Check your email", "Enter the 6-digit code we sent to {email}.", a 28 pt
    letter-spaced code field (`oneTimeCode`, auto-submits at six digits, `home.tsx:199-203`),
    "Sign in" (disabled until six digits), "Send a new code" and "Use a different email" text links.
    "A new code is on its way." after a resend.
  - Errors are the **server's English message strings** shown verbatim
    (`home.tsx:153`): "That code doesn't match. Check the email again.", "That code has expired. Ask
    for a new one." (`accounts.ts:186,191`), "That's a lot of tries..." (`http.ts` limiter). They
    bypass `copy.ts`, so they can't be localised and their tone is not reviewed with the rest.
  - After five wrong codes the server answers `code-expired` (`accounts.ts:177-187`), so the host
    is told the code **expired** when it was locked. Should say "Too many tries. Send a new code."
  - Resend has no cooldown or countdown; the third resend in 15 min returns 429 and the message.
  - Close (backdrop or Android back) resets everything except the typed email (`home.tsx:143-151`).
  - On success `verify` saves the session (`api.ts:226-233`) and the sheet closes; Welcome swaps to
    Events with no transition and no haptic.
- Demo host: `POST /v1/auth/demo` needs `DEV_ROUTES=1` (`accounts.ts:198-202`).
- The host's display name is derived from the email local part (`accounts.ts:49-53`, "naib" ->
  "Naib"). `PATCH /v1/me` exists (`accounts.ts:224-229`) but the app never calls it and has no name
  field. The name is used as the default guest name when the host joins their own event
  (`join.tsx:62`). `EventSummary.hostName` is returned but not shown anywhere in the app.
- Any 401 on any request clears the session silently (`api.ts:206-208`); the home screen flips to
  Welcome with no explanation.

### Should
- Map server error codes to `copy.ts` strings (`wrong-code`, `code-expired`, `too-many`,
  `email-failed`, `network`), and add a distinct "locked" code server-side.
- Resend with a visible 30-60 s cooldown; an "Open Mail" affordance on iOS.
- Both legal links tappable (two `Text` spans or two links).
- A one-line name step on first sign-in ("What should guests call you?"), using `PATCH /v1/me`, and
  name editing in Settings. The host's name should appear on the join sheet ("Maya invited you").
- On a 401 that drops the session, show a short Notice on Welcome ("You were signed out.").
- Success haptic (`notificationAsync(Success)`) on sign-in.

## 2. The events list

### Now (`home.tsx:261-428`)
- Header: wordmark 29 pt and a Settings icon button (label "Settings", `home.tsx:333-345`).
- Reloads on every focus (`visits` counter in the load key, `home.tsx:264-267`); previous data stays
  visible while reloading. Pull to refresh only spins when a list is already present
  (`home.tsx:288`).
- **Loading (first load): renders nothing** below the header, no spinner or skeleton
  (`home.tsx:295-305`, `null` branch).
- **Error**: only when nothing has loaded: Notice "Your events couldn't be loaded." and "Try again".
  If a list is already showing and a reload fails, nothing tells the host (data is stale silently).
- **Empty** (`home.tsx:347-365`): Mark 56, "No events yet", body, "Create an event" with plus icon.
  The pinned footer "New event" is hidden here (`home.tsx:274`).
- **List**: "Your events" title, cards newest first by `createdAt` (`events.ts:198-206`), not by
  state or date. Footer pinned "New event".
- **EventCard** (`home.tsx:376-428`): 240 pt card, radius 22, cover or a duotone occasion icon on
  Surface, bottom gradient, state chip top-left (Candle dot only for live), title (heading, 2 lines),
  one line under it (`cardLine`, `home.tsx:367-374`):
  - draft: "Not live yet. Finish setting it up to get the code."
  - live and ended: "Saturday 14 June · Reveals tomorrow at 10:00". The day uses the event zone but
    `revealLabel` is called **without** the event's time zone (`home.tsx:371`), so the two halves
    can disagree for a host in another zone.
  - live: shows the reveal, not the more useful "camera open, 3h 10m left" or a guest/moment count.
  - revealed and archived: just the day.
  - Press: opacity 0.85. No long-press or swipe actions. `accessibilityLabel` combines title, state
    and the line.
  - Tap: draft -> `/new?event=<id>` (resumes at step 5); otherwise `/e/<code>`.
- No offline indicator, no haptics, no entering animation, no section grouping.
- Seed drift: at 19:20 UTC today the API reports MAYA3X, JNHSWM and EMMADN all `revealed`, TFNWKD
  `draft` (read-only `GET /v1/e/:code`). The QA checklist and `flows/host.yaml:17` expect "Maya ...
  Live" and "Jun ... Ended", which only hold for 4 hours after a seed. Live and Ended cards can't be
  QA'd without reseeding.

### Should
- Order by what needs the host: **Live now** (pinned, Candle dot, "Camera open · 3h 10m left ·
  38 moments"), **Coming up** (future start, see section 4), **Waiting for the reveal** ("Reveals
  tomorrow at 10:00"), **Drafts**, then **Revealed** ("212 photos · 14 June"). Either sections or a
  sort with these as keys.
- Card line built from the event's zone throughout.
- A loading skeleton (two card shapes in Surface) instead of a blank screen; an inline Notice when a
  background reload fails while data is shown.
- Long-press menu: Show code, Share link, Edit, Delete (draft) or End now (live).

## 3. Creating an event

Route `/new` (`app/new.tsx`), `CreateScreen` (`create.tsx:193-298`). Progress is five bars
(`ui.tsx:686-702`); the back control sits on the progress line (`create.tsx:260-273`, comment at
857). Step content swaps instantly; no transition, no progress animation, no haptics on any choice.

### Step 1, occasion (`create.tsx:302-324`)
- "What are we capturing?" (display), body, five `OptionRow`s with duotone icons, radio roles.
  Wedding is preselected (`create.tsx:205`); Continue is always enabled.
- Choosing an occasion rebuilds the draft from `SUGGESTIONS` (`create.tsx:93-102`) and keeps title,
  cover and start (`create.tsx:277-284`). Going back to step 1 later and tapping another occasion
  **silently overwrites** the rules, look, visibility, tier and unlimited toggle the host already set.
- Close icon on step 1 (`create.tsx:268`), but its accessibility label is still "Back"
  (`create.tsx:264`).

### Step 2, name, date, cover (`create.tsx:331-466`)
- "What's it called?", a large serif multiline `Field` (autoFocus when empty, `maxLength` 60,
  `blurAndSubmit`), placeholder per occasion (`copy.ts:78-82`). Return blurs but does not advance.
  No character counter near the 60 limit.
- Continue is disabled while the title is blank or the dates are wrong (`create.tsx:672`) with no
  hint for the blank-title case.
- Date row opens an inline iOS calendar in a Sheet (`DateSheet`, `create.tsx:478-498`), en-GB,
  minimum today. **There is no start time**: picking today sets the start to now, any other day sets
  it to **midnight** (`create.tsx:347-354`). Moving the day keeps the event's length.
- Ends row opens a datetime spinner (5-minute steps, minimum start + 15 min). Android uses two system
  dialogs (`create.tsx:360-390`). Shown as "Tonight, 21:00" / "Same day, 14:00" / "Sunday, 1:00"
  (`copy.ts:314-324`).
- Wrong dates show "The end needs to be after the start." from core's rules (`create.tsx:189-191,
  424`).
- Time zone is always the device zone (`create.tsx:166`); there is no way to set it for a trip or a
  remote event.
- Cover: 210 pt tile, opens the photo library with 4:3 crop (`create.tsx:335-345`). No remove
  option. The cover only uploads when the host presses Start; a failed upload is swallowed
  (`create.tsx:683-688`), so the event silently has no cover.
- Keyboard: `Screen` uses `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"`
  (`ui.tsx:646-683`). Tapping Date while the title is focused opens the sheet with the keyboard still
  up; worth a manual check that it dismisses.

### Step 3, rules (`create.tsx:500-554`)
- "When do photos appear?" Segmented: Right away / When it ends / Next morning. Custom is not offered
  even though core and the seed support it (TFNWKD is `custom`). The note under it updates with the
  computed reveal (`create.tsx:514-518`).
- "Shots per guest" with a 28 pt italic serif value and a slider with stops 5, 15, 24, 36, ∞
  (`create.tsx:82-88`). The pan seeks continuously, so values like 17 or 29 are reachable; no snap and
  no haptic tick at stops. ∞ turns on the paid add-on with no price shown here; the $9.99 only
  appears on step 5.
- "Who sees the photos?" Every guest / Only me, with the host-only note.

### Step 4, look (`create.tsx:556-602`)
- Three 150 pt cards rendered through Skia (`look.tsx`) on the cover or an occasion sample; selected
  card gets a white 2.5 pt border. Matches the scratchpad.

### Step 5, guests and price (`create.tsx:604-651`)
- Five `TierRow`s with "Popular" on 80, "Unlimited shots / Add $9.99" toggle.
- Suggested tiers preselect **paid** tiers for wedding ($19.99), birthday and party ($9.99)
  (`create.tsx:97-100`). The button immediately reads "Start my film for $19.99". Defensible as a
  suggestion, but there's no review of what the host picked before paying.
- On a resumed draft that already has unlimited, the row still says "Add $9.99"; the button price is
  right because `due()` subtracts it (`create.tsx:671`, `pricing.ts:95-106`).

### Start (`create.tsx:664-750`)
1. Creates the event once (`if (!current)`, `create.tsx:680`) and uploads the cover.
2. `claimPending`, re-reads the event, works out what's still owed.
3. If owed: `purchase()`; dev without RevenueCat keys loops `dev-claim` per product
   (`purchase.ts:124-127`); cancelled returns to step 5 with no message.
4. `POST /live`, then the invite.

Problems:
- **Edits after the first attempt are lost.** Once the draft exists, going back and changing the
  title, dates, rules or look does nothing on the server: there is no PATCH call anywhere in the app.
  A host who cancels the payment, goes back to fix the name, and pays, gets the old name.
- Any error after creation shows "The payment didn't go through, so the event is saved as a draft"
  (`create.tsx:720-721`), including `already-over` from `/live` (`events.ts:278-280`) when the end
  passed, which isn't a payment problem and can't be fixed in the app.
- **Resumed drafts** jump to step 5 and back closes the flow (`create.tsx:209-215, 225`). The host
  can't change anything but the tier. `fromEvent` maps `custom` to `at-end` (`create.tsx:157`),
  harmless only because nothing is sent.
- iOS swipe-back on `/new` dismisses the whole flow from any step with no confirm; `BackHandler`
  only covers Android (`create.tsx:229-239`).
- No haptic or animation when the event goes live; it jumps to the invite.

### Invite (`create.tsx:754-819`)
- "Your film is ready" centred, close icon on the left (label "Done"), the cream `InviteCard` with
  mark, a real QR for `joinLink(code)` (`api.ts:18-20`), the title and "Scan to join. No download
  needed." Footer: "Print table cards" (four cards on one page via `expo-print`,
  `create.tsx:829-854`) and "Share link" (`Share.share`, message plus url on iOS).
- **The join code itself is never shown as text** (`ui.tsx:982-1004`), here or anywhere in the host
  UI, so a host can't read it aloud or write it on a whiteboard, and guests in the browser with a
  bad camera can't type it.
- No "Copy link". Share on iOS passes the URL in both `message` and `url`, so some targets show it
  twice.
- The print HTML pulls Newsreader from Google Fonts; offline it falls back to Georgia.
- Matches the scratchpad layout (`index.html:418-420`).

## 4. Product gap: scheduled events

`canShoot` ignores `startsAt` (`shots.ts:129-131`); an event is shootable from the moment it goes
live. Creating Saturday's wedding on Monday makes it **live on Monday**: the card shows "Live", the
camera works, the event screen counts down "5d 3h Left", and anyone with the code can shoot days
early. Combined with the midnight start (`create.tsx:349`), future events don't behave as hosts
expect.

Should: a start time on step 2, and "opens at" behaviour: either a `scheduled` phase in core
(`live` but before `startsAt` = "Opens Saturday at 15:00", guests can join and see the rules, the
camera stays closed) or `canShoot` checking `startsAt`. Lists and the event screen then show
"Opens in 2d" for these.

## 5. Hosting a live event

### Now
- The host opens `/e/<code>` and gets the **guest event screen** (`event.tsx:287-615`): cover with
  title, stats (Moments, Left or To reveal or Revealed, People ›), the primary camera button, QR
  and download icon buttons, then the developing grid (blurred cover tiles, max 40, "N more
  developing").
- "Open camera" for a host who hasn't joined: the camera's `me` call fails `not-joined` and replaces
  the route with the join sheet (`shutter.tsx:66`), prefilled with the host's name. The host then
  takes up one of the guest slots (a free event's 10 includes the host).
- QR opens `InviteSheet` (`event.tsx:799-826`): card at 200 pt and "Share link". **No print** here, so
  table cards can only be printed once, right after creation.
- People sheet (`event.tsx:687-795`): count title, "Shot counts so far...", rows with initial
  avatar, name, "Joined 21:04", shot count. No host marker and no "N of 10 guests". The scratchpad's
  people rows carry roles ("Host", "Bride's side", `index.html:444`).
- Polling every 30 s while developing (`event.tsx:323-333`) reloads the gallery counts and summary,
  but the People stat prefers `people.data` (`event.tsx:398`), which only reloads on pull to refresh
  (`round`, `event.tsx:293-294, 306-310`). **The people count goes stale** while the host watches.
- The reveal reminder: opening the event while it's developing asks for notification permission
  with no pre-prompt (`event.tsx:217-237, 347-349`). A host who never opens their own event after
  creating it gets no local reminder; push registration is also only triggered here
  (`event.tsx:236`).
- No haptics, no live "someone joined" or "new photo" feedback beyond the 30 s count update.
- `guestLimit` comes back from `/people` (`events.ts:394`) and `full` from the summary
  (`events.ts:160`), but neither is shown to the host. A full event is only discovered when guests
  report "This event is full. Ask the host to make room." (`copy.ts:153`) and the host has no button
  to make room.

### Should: a host layer on the event screen
Keep the guest layout and add, for the owner only (`useHostEvent` already exists,
`event.tsx:183-189`, used only by `photo.tsx:38`):
- A host row under the actions: guests "7 of 10" with a Candle bar, and when near or at the limit,
  "Make room" opening the tier list (`due()` already prices the difference, the API accepts upgrades
  on live and ended events, `billing.ts:33-44`).
- A "Manage" icon button (gear) opening a host sheet with:
  - Edit name (`title` is editable in every state up to revealed, `core/events.ts:142-148`).
  - Change the end time (live only), or reveal later; the UI should only offer what
    `lockedSettings` allows (`core/events.ts:155-181`): reveal later only, visibility only to
    "Only me".
  - Change cover (`POST /cover` is allowed in any state).
  - "End now" with a confirm ("The camera closes for everyone. Photos appear {when}."), calling
    `POST /end` (`events.ts:286-306`). Plan.md phase 8 removed this from the app because it wasn't in
    the design; the API still has it and hosts expect it.
  - Print table cards (reuse `tableCards`), Copy link, Show code.
- Join code as large text under the QR in both invite surfaces.
- People: mark the host, show joined/limit, keep the list fresh on the same poll.
- Hidden and reported photos: the report copy promises "The host will be told" (`copy.ts:219`) but
  nothing tells the host (no push, no badge, no list; `shots.ts:487-511` only logs). Either a
  "Reported (2)" filter on the revealed gallery for the host plus a push, or change the copy.
- Ask for notification permission at the invite step for the host, with one line of why ("We'll
  tell you when the photos are ready"), and schedule the host's reminder there.

## 6. Editing settings while live

Now: impossible in the app. The client has no `events.patch` (`api.ts:256-268`); the only entry
into settings is the draft resume at step 5. The server side is complete and tested
(`events.ts:222-257`, `lockedSettings`).

Should: the Manage sheet above, reusing the step components (`NameStep`, `RulesStep`) in an edit
mode with locked fields shown disabled and a one-line reason ("Can't move the reveal earlier once
guests are shooting"). Errors from `locked` (409) mapped to copy.

## 7. Ending early

Now: API only (`POST /v1/events/:id/end`). No client call, no UI, no copy.
Should: section 5. Success moves the card to "Waiting for the reveal" or straight to revealed for
right-away and at-end events (`advance`), so the screen should refresh the summary and gallery.

## 8. Deleting

Now: there is no `DELETE /v1/events/:id` and no UI. Drafts from abandoned or cancelled purchases
pile up in the list forever. The only deletion is the whole account.
Should: delete a draft freely; delete a live/ended/revealed event with a strong confirm ("Deletes
every photo for every guest. Paid events aren't refunded."), removing storage under
`keys.event(id)` as `deleteHost` does (`accounts.ts:122-127`), cancelling the pg-boss reveal job,
and cancelling the local reminder on this device.

## 9. Settings, sign-out, account deletion

### Now (`home.tsx:432-550`)
- Presented as an iOS modal (`app/_layout.tsx:52`), title "Settings" with a close icon, "Signed in
  as {email}", a group with Help and support / Privacy Policy / Terms of Service (open the site in
  an in-app browser, `home.tsx:578-584`), a group with Sign out and Delete account (Candle text and
  trash icon), version at the bottom.
- Sign out: no confirm, runs `signOut` then closes (`home.tsx:500-502`); server failures are ignored
  (`api.ts:239-244`). Local reveal reminders for the host's events and queued uploads stay.
- Delete account: system Alert "Delete your account?" with a clear body and "Delete everything"
  (destructive) (`home.tsx:445-458`, `copy.ts:62-66`); on success the modal closes onto Welcome; on
  failure a Notice. No mention that paid events aren't refunded. No second step (typing the email or
  similar) for an account with live events.
- No name, no email change, no notification settings, no "restore purchases" (consumables, so not
  required), no list of receipts.
- Delete uses Candle, which brand rules reserve for progress, caret and badges (`plan.md`, Brand);
  `Notice` errors also use Candle (`ui.tsx:1018-1030`). That makes "accent" mean error and danger as
  well.

### Should
- Name field (PATCH /v1/me). Notifications row (system permission state, open Settings).
- Sign-out confirm only when there are pending uploads or claims, and cancel this host's local
  reminders.
- Account deletion body names live events and says purchases aren't refunded.
- Decide one treatment for destructive and error states that isn't the brand accent (Paper text
  with a trash icon, or a muted red), and use it everywhere.

## 10. Purchases

- Native (`purchase.ts`): RevenueCat, one store product at a time, each transaction saved to MMKV
  before its claim and retried on launch (`purchase.ts:52-113`). Partial success (tier bought,
  add-on cancelled) returns `cancelled` with the updated event (`purchase.ts:144`) and the step-5
  button then prices only the add-on. The host gets no message saying the tier went through.
- Dev: without `EXPO_PUBLIC_REVENUECAT_*` keys every paid tier is applied instantly via `dev-claim`
  with no indication it's a test purchase.
- Web (`purchase.web.ts`): Stripe Checkout redirect, `success_url` `/e/<code>?paid=1`
  (`billing.ts:240-241`), but nothing in the app reads `paid=1`, and hosts can't reach create on the
  web anyway (`create.tsx:194`). Dead path today (noted in plan.md phase 3).
- `productIds` is duplicated in both files (`purchase.ts:38-44`, `purchase.web.ts:15-21`).
- `HostAppNote`'s App Store and Google Play buttons both open the site root (`home.tsx:566-571`).

Should: a short "Paid. Up to 80 guests." confirmation (and a Success haptic); a "Test purchase"
caption in dev; an upgrade path from the event screen; store buttons that go to the stores (or the
site's get-the-app anchor) until listings exist.

## 11. Cross-cutting

Haptics. Only the shutter uses them (`shutter.tsx:109`). Hosts should get: selection ticks on
occasion, segmented, tier and slider stops; Success on sign-in, on going live and on purchase;
Warning on destructive confirms.

Animation. Sheets fade and slide (`ui.tsx:779-798`), the Toggle animates, the reveal moment fans.
Everything else in the host path is instant: step changes, progress bars, welcome to list, list
cards. Proposed: a short cross-fade or slide between steps, progress bars filling over 200 ms,
cards fading in on first load, and a small reveal of the invite card (scale from 0.96).

Accessibility.
- Step 1's close button is labelled "Back" (`create.tsx:264`).
- `Progress` has a value but no label; should read "Step 2 of 5".
- `Notice` isn't announced (`ui.tsx:1018-1030`); errors after a button press are silent for
  VoiceOver. Use `accessibilityLiveRegion="polite"` and `AccessibilityInfo.announceForAccessibility`.
- The People stat label includes the "›" glyph (`copy.ts:184`), read aloud.
- The slider's accessibility increment moves by 1 between 5 and 37 (`ui.tsx:610-613`), so 37 reads
  "Unlimited" correctly but stepping is slow; step by stops instead.
- Event cards have good combined labels.

Copy. Server error messages bypass `copy.ts` in the sign-in sheet. "paymentFailed" is used for
non-payment failures. "The host will be told" is untrue today. Otherwise the copy is in the right
voice and has no em dashes.

Offline. The list keeps stale data silently; creation fails with a generic Notice; the invite works
offline except print fonts. No global connectivity hint.

Time zones. Device zone everywhere for creation; event zone on cards except the reveal half of the
card line (`home.tsx:371`).

## 12. Gaps ranked

1. No hosting tools after creation: no edit, end early, upgrade, print again, delete. API mostly
   exists; app client has none of it (`api.ts:256-268`).
2. Edits made after the first Start attempt are silently dropped (`create.tsx:680`), and resumed
   drafts can only change the tier (`create.tsx:209-215`).
3. Future events go live immediately and the start has no time (`shots.ts:129-131`,
   `create.tsx:349`).
4. The join code is never shown as text; print only at creation.
5. Host can't see or fix a full event (`full`, `guestLimit` unused in the app).
6. No way to delete a draft or an event (no route).
7. People count stale during polling (`event.tsx:398`); host not marked; host uses a guest slot.
8. Sign-in errors are raw server English, lockout reads as "expired", one legal link.
9. Blank first load on the list; stale-data errors hidden; list order ignores state.
10. "The host will be told" about reports, but nothing tells them.
11. Haptics and transitions absent across the host path; Candle doubles as error/danger colour.
12. Seed drifts out of Live/Ended within hours, so QA and `flows/host.yaml` assertions fail
    unless reseeded.
