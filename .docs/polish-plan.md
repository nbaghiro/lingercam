# Linger polish plan

This plan takes Linger from the build that passed hand-off on 2026-11-01 to the finished product
described in `.docs/product.md`. It lists every requirement that `product.md` marks partly done or
not built, ranks them by how much they change how finished the product feels, groups them into
workstreams that can run in parallel without touching the same files, and ends with the product
calls that need Naib's answer before the work starts.

Sources: `.docs/product.md` (the spec, statuses as of 2026-11-02), the six notes in
`.docs/vision/`, `.docs/plan.md` including Results, `.docs/qa.md`, the approved design at
`../smallwares/.scratchpad/linger/index.html`, and the code. No source file has changed since
`product.md` was written (the newest is `apps/app/src/event.tsx`, 2026-11-01 21:08), so its line
citations hold, and I re-checked the ones this plan leans on. Paths in this file drop the leading
`apps/` or `packages/`, as `product.md` does: `app/src/join.tsx` is `apps/app/src/join.tsx`.

## How to read the gap list

Each item has an id, the owning workstream in brackets (a second one after `+` when another
workstream supplies part of it), the spec section, what the code does now with a citation, what
done looks like, and how it is verified.

Verification is one or more of:

- **Unit**: a Vitest test beside the code in `core` or `api`.
- **API**: a Vitest integration test in `api/src/*.test.ts` against the Docker services.
- **Web**: a Playwright test (`apps/**/*.e2e.ts`) against the web build with a fake camera.
- **Maestro**: a flow in `app/flows/` on the iPhone 17 Pro simulator.
- **Shot**: a simulator or browser screenshot compared against the matching scratchpad screen,
  saved to `.docs/vision/shots/` with an `after-` prefix.
- **Review**: haptics, sounds and timing that none of the above can observe. The reviewer reads
  the code against the spec's haptics and motion tables and checks it by hand in the native pass.
- **Device**: needs a physical iPhone. The simulator has no camera (the native camera falls back to
  the demo photos, so a frame processor, flash, focus and zoom never run) and no remote push or
  volume buttons. These checks are not part of the native pass; they wait for the device pass
  (decision Q16), and until then the item is "built, not verified".
- **Android**: verified only in the Android pass (decision Q9). Android parts of an item are
  written in this run but stay "built, not verified" until then.

Ranking uses four tiers. Ids run in rank order, so G1 matters most.

1. **Tier 1, breaks a promise.** Photos lost, guests stranded, the reveal unheard, or the host's
   input silently dropped. These decide whether the product works.
2. **Tier 2, the core moments.** Join, camera, waiting, reveal, gallery and hosting feel
   unfinished or differ visibly from the design.
3. **Tier 3, rough edges.** Things a careful guest or host notices on a second look.
4. **Tier 4, finish.** Small polish, strings and tokens.

Where a requirement in `product.md` repeats in two sections (for example universal links in 2.4
and 4.1), it is one item here and the item names both sections.

---

## 1. Gap list

### Tier 1: breaks a promise

- **G1** [W4] Photos refused for good are deleted (6). Now: a final reservation refusal removes the
  queue entry and the file, and the line blames the guest (`app/src/uploads.ts:30,136-139`,
  `app/src/copy.ts:246-247`). Done: a photo the server will never accept is saved to the guest's
  photo library first, then the event says "1 photo couldn't be added to the event, so it was
  saved to your Photos." Verify: Web (force `not-open`, check the download and the line), Maestro.
- **G2** [F1 + W4] Late photos, D1 (6, 9.1). Now: a photo taken before the end is accepted only
  until 60 minutes after it (`core/src/shots.ts:133-149`). Done: accepted until 7 days after the
  reveal, still capped by the allowance; late arrivals develop into the gallery by `takenAt`.
  Verify: Unit (`canReserve`), API (reserve after reveal succeeds within 7 days, fails after).
- **G3** [W4] Web queue loses photos on reload (6). Now: queued photos are `data:` URLs in
  localStorage and a full quota is swallowed (`app/src/uploads.ts:15-16,47-52`). Done: Blobs in
  IndexedDB, metadata beside them, nothing dropped at 30 photos. Verify: Web (queue 30 photos
  offline, reload, all upload).
- **G4** [F2 + W3] The camera can't open without signal (5.6, 14.1). Now: the camera needs a fresh
  summary (`app/src/shutter.tsx:95-96`) and `useLoad` keeps nothing (`app/src/api.ts:359-390`).
  Done: `summary:<code>` and `me:<code>` persist; the camera opens offline with "Offline. Photos
  will send later." in the top bar. The event screen also opens from the cache (14.1) with the same
  line under the actions instead of the spinner or "couldn't be loaded" (`app/src/event.tsx:351-370`
  shows one or the other today); at the reveal time offline it reads "Now" and "The photos are
  ready. They'll load when you're back online." Verify: Maestro (API stopped, camera opens, shot
  queues), Web (offline context, camera and event screen).
- **G5** [F1 + W5] Browser guests never hear about the reveal, D2 (7.5, 8.1). Now: no email, push or
  calendar path for web guests (`app/src/event.tsx:194,219,243`). Done: after the first photo a
  card offers "Email me" and "Add to calendar" (`.ics`); the reveal job sends one email with the
  scratchpad's line; the address is deleted with the event. Verify: API (email lands in Mailpit
  at reveal), Web (card, `.ics` contents).
- **G6** [W3 + F1] Revealed event, not a member: dead end (4.2). Now: the sheet offers "See the
  photos", asks a name, then fails with `not-open` (`app/src/join.tsx:142-147`,
  `api/src/events.ts:194,346-348`). Done: "These photos are for the people who were there" with
  the recovery line and, with D2, "I joined on another device". Verify: Web, Shot.
- **G7** [W3 + W1] No way back to a joined event (1.1, 11.1). Now: native home is host sign-in
  only (`app/src/home.tsx:41-46`); the web root says hosting happens in the app
  (`home.tsx:552-578`). Done: `joined.tsx` lists events this device joined (device-scoped call)
  above sign-in on native and as the web root's guest home. Verify: Web (join, open `/`, event
  listed), Maestro.
- **G8** [W3] No screen accepts a typed code (1.1, 4.1). Now: none. Done: "Have a code?" on native
  welcome and the web guest home; six boxes, auto-advance, paste-aware, `normalizeJoinCode`
  (`core/src/events.ts:270-275`). Verify: Web (type and paste), Maestro.
- **G9** [W6] The viewer crops portrait photos (9.3). Now: `cover` for portrait, flat black around
  landscape (`app/src/photo.tsx:244-252`). Done: the whole photo always visible over a blurred,
  darkened copy of itself. Verify: Shot (portrait and landscape against reveal 4).
- **G10** [W6 + W5 + F2] Signed URLs expire under an open gallery (9.1). Now: URLs last an hour
  (`api/src/storage.ts:33`) and the store never refreshes them (`app/src/event.tsx:85-91`). Done:
  refresh on focus, on foreground and when within 10 minutes of expiry; save-all refreshes first.
  Verify: Web (fake clock past expiry, images still load).
- **G11** [W1] Edits after the first Start are dropped (1.4 Start). Now: the app never calls PATCH,
  so a changed title or rule after a failed payment is lost (`app/src/create.tsx:680`,
  `app/src/api.ts:256-268`). Done: changes since the draft was created are PATCHed before going
  live. Verify: Maestro (cancel payment, edit, start, check title), API already covers PATCH.
- **G12** [W4] Uploads stop when the phone locks (6). Now: foreground only
  (`app/src/uploads.ts:167-198`). Done: iOS background upload tasks; on Android a foreground
  service while photos wait. If SDK 58's `expo-file-system` has no background session API, record
  that under plan Results and move it to Later (decision Q5). Verify: Maestro (shoot, background
  the app, API shows the shot confirmed), Android for the foreground service.
- **G13** [F2 + W5] A deep-linked event has no way back (7.1). Now: no back control and no screen
  under it (`app/src/event.tsx:457-465`). Done: `unstable_settings.initialRouteName` puts `/`
  under deep links on native; the event header has a back or home control. Verify: Maestro
  (`linger://e/EMMADN`, back lands on home).
- **G14** [F1 + F2 + W5] Push is off (7.4, 8.1). Now: no EAS project id, so no device registers
  (`app/src/event.tsx:205-215`). Done: project id set (decision Q3), tokens registered, receipts
  checked, dead tokens pruned. Verify: API (receipt pruning with a mocked Expo client), Device
  once the id exists (the simulator can't receive remote push).

### Tier 2: the core moments

- **G15** [F2 + W3] Titles use Newsreader's 16 pt cut (14.7). Now: `@expo-google-fonts/newsreader`
  400 only (`app/src/ui.tsx:98-105`), and the Live Activity bundles the same cut
  (`app/targets/activity/LingerActivity.swift:30`). Done: display cuts bundled for display,
  title, cover, heading and recap variants, 16 pt kept for 19 to 23 pt names; the Live Activity
  gets the display cut. Verify: Shot (moment, cover, join sheet against reveal 2 and shoot 1).
- **G16** [W3] No live film look in the native viewfinder; web look differs (5.1). Now: plain native
  preview (`app/src/camera.tsx:22-24`), CSS filter on web (`app/src/look.web.tsx:6-10`). Done:
  Skia frame processor with `FILM_SHADER` on native (needs a dev-client rebuild, decision Q7); web
  filter tuned until a capture matches `applyLook` output side by side. Verify: Web (browser
  viewfinder against shoot 2 and against `applyLook` on the same frame), Unit (web filter
  parameters per look are pinned in a test), Device for the native viewfinder (the simulator shows
  demo photos, so the frame processor never runs there).
- **G17** [F2 + W7] No universal links or App Links (2.4, 4.1). Now: none
  (`app/app.config.ts:19-24`, no `apple-app-site-association`). Done: associated domains and
  intent filters in config, AASA and `assetlinks.json` served from the join domain. Verify: Web
  (files served with the right content type), Device (needs the real domain and a signed build),
  Android for App Links.
- **G18** [W7 + F1] Shared links have no preview (2.4). Now: the web build is one page titled
  "Linger" (`app/app.config.ts:35`). Done: `join.lingercam.app/<code>` returns per-event Open Graph
  tags (title, cover, "Scan to join. No download needed."), by the route chosen in decision Q4.
  Verify: API or Web (fetch `/<code>`, read the tags).
- **G19** [W7] No `+html.tsx` (13.2). Now: none. Done: `viewport-fit=cover`, description,
  apple-touch-icon, theme colour. Verify: Web.
- **G20** [F2] Web first paint waits on about 6.3 MB of fonts (13.2). Now: Pretendard OTFs block the
  layout (`app/app/_layout.tsx:25,41`, `app/src/ui.tsx:101-104`). Done: Latin woff2 subsets on
  web and a system fallback while they load; the join sheet paints without waiting. Verify: Web
  (time to the join title under 1.5 s on a throttled profile).
- **G21** [W3] The shutter row sits under Safari's floating toolbar on iOS 26 (13.2). Now: no safe
  inset on web (`app/src/shutter.tsx:239`). Done: bottom inset from `env(safe-area-inset-bottom)`
  once G19 adds `viewport-fit`. Verify: Shot (Safari in the simulator during the native pass).
- **G22** [F1] Scheduled events, D5: the rules (1.4, 4.2, 5.6). Now: the camera opens when the event
  goes live (`core/src/shots.ts:128-131`). Done: `canShoot` requires `startsAt <= now`; a live
  event before its start lets guests join and read the rules. Verify: Unit, API.
- **G23** [W1] No start time in create (1.4 step 2). Now: a future day starts at midnight
  (`app/src/create.tsx:345-352`). Done: a Starts row, next half hour today or 18:00 on a later
  day. Verify: Maestro, Shot.
- **G24** [W3] Join sheet before the start (4.2). Now: not possible. Done: "The camera opens Saturday
  at 15:00." with "Join now". Verify: Web.
- **G25** [W3] Camera before the start (5.6). Now: not possible. Done: "The camera opens at 15:00."
  over the viewfinder, countdown in the top bar. Verify: Web.
- **G26** [W2] No way to end early (3.2). Now: the client call was removed in review (plan Results
  phase 8); the route exists (`api/src/events.ts:286-306`). Done: Manage, "End now" with the
  confirm copy from the spec; the moment shows if it reveals at once; an open guest camera closes
  (G246). Verify: Maestro (host tools are native only).
- **G27** [W2] No Manage sheet or button (3.1, 3.2). Now: none. Done: gear button in the action row,
  owner only; one sheet with Surface groups and only allowed rows. Verify: Maestro, Shot (against
  the scratchpad's Surface row system).
- **G28** [W2] Reveal can't be changed after creating (3.2). Now: no client. Done: reveal row that
  only moves later once live, disabled options explain why. Verify: Maestro, API covers the rule.
- **G29** [W2] The host can't see or fix a full event (3.1). Now: `guestLimit` and `full` returned,
  never shown (`api/src/events.ts:160,394`). Done: "7 of 10 guests" with a thin Candle bar, "Make
  room" at 80% opening tiers priced by `due()`. Verify: Maestro (dev claim raises the limit).
- **G30** [F1 + F2] The summary doesn't say who is viewing (3.1, 8.2, 14.1). Now: owner detection
  loads every hosted event (`app/src/event.tsx:183-189`) and clients infer "revealed" from photos
  arriving (`event.tsx:374-376`). Done: `EventSummary` carries `viewer` (role, guest id, shots
  taken and left), the time-driven state from `dueState`, and for the host `guestLimit`. Verify:
  Unit (schema), API.
- **G31** [F1 + W3] The host takes a guest slot to shoot, D4 (3.1). Now: the host joins as a guest
  (`app/src/shutter.tsx:66`, `app/src/join.tsx:62`). Done: "Open camera" shoots straight away
  under the host's name; the host's row isn't counted against the limit. Verify: API (a full free
  event still lets the host shoot), Maestro.
- **G32** [W5] The reveal lands up to 30 s late (7.3, 8.2). Now: flat 30 s poll
  (`app/src/event.tsx:270,323-341`). Done: a refresh at `revealsAt` plus 3 s, 5 s polls in the last
  minute, the moment within 2 s on a cold open. Verify: Web (at-end event ending in 20 s).
- **G33** [W5] The countdown moves on the poll (7.3). Now: updates every 30 s. Done: every minute in
  the last 12 hours, every second in the last minute. Verify: Web (fake clock).
- **G34** [F2 + W5] "0m To reveal" at the reveal time (7.1). Now: `formatDuration` clamps to 0
  (`app/src/copy.ts:332-340`). Done: F2 makes the formatter return "Now" at or past zero (it lives
  in `copy.ts`); W5 shows it until the gallery arrives. Verify: Web (fake clock); the app has no
  unit runner.
- **G35** [F1 + W5] The moment's three cards are the first three by time (8.3). Now:
  `app/src/event.tsx:651`, `api/src/shots.ts:352`. Done: a server highlights call picks different
  photographers, spread across the night, one of the viewer's own when they have one. Verify: API.
- **G36** [W5] The moment's front card is a 512 px thumbnail (8.3). Now: `app/src/event.tsx:675`.
  Done: the developed photo. Verify: Shot (against reveal 2).
- **G37** [F1 + W5] Reveal notification lacks the counts (8.1). Now: body "The photos are ready."
  hard-coded in the API (`api/src/reveal.ts:41-43`) and in `copy.ts:264-265`. Done: "Maya turns
  thirty: the photos are ready. 612 moments from 34 people." for push and email; the local reminder
  drops the counts. Verify: API.
- **G38** [W5] Tapping a notification can stack the event twice (8.1). Now: always pushes, cold-start
  check runs before the layout (`app/src/event.tsx:240-257`). Done: opens once after the
  navigator is ready, replaces if already on that event. Verify: Review, Maestro where possible.
- **G39** [W5] Guests are asked for notifications over the camera (4.4, 7.4). Now: the event screen
  under the camera asks on mount (`app/src/event.tsx:222,347-349`, `app/src/join.tsx:72-75`).
  Done: a card the first time the guest leaves the camera or on "That's your roll", with "Turn on"
  and "Not now". The event screen decides this on its own (the guest has at least one photo and
  hasn't answered for this event), so W3 doesn't need to signal it. Verify: Maestro (`simctl
  privacy reset` before the run).
- **G40** [W2 + W5] The host is asked for notifications without a reason (2.1). Now: on opening the
  event (`app/src/event.tsx:217-237`). Done: the same card on the invite after going live;
  reminder scheduled there. Verify: Maestro.
- **G41** [W5 + F1] Developing tiles repeat one blurred cover (7.2). Now: six offsets of the cover
  (`app/src/event.tsx:273-282,585-590`, `app/src/ui.tsx:933-947`). Done: each tile gets a hue and
  brightness from its position and the photographer's first name in serif italic, names supplied
  by the gallery's pending page. Verify: Shot (against shoot 3), API (no URL in the pending page).
- **G42** [W5] The guest's own roll isn't shown (7.1). Now: the gallery returns `mine`
  (`api/src/shots.ts:308-317`), unread. Done: "Your roll: 7 taken, 17 left" under the actions.
  Verify: Web.
- **G43** [W5] The recap button is icon only (9.1). Now: `app/src/event.tsx:428-440`. Done: "Watch
  the recap" with the play icon. Verify: Shot, Web.
- **G44** [W5] After the reveal the QR invites people who will be refused (2.2). Now: the invite
  still shows (`api/src/events.ts:191-194`). Done: QR hidden; members see sharing guidance. Verify:
  Web.
- **G45** [W6] Recap Share sends the join link (9.5, 10). Now: `app/src/recap.tsx:159-187`,
  `copy.ts:232`. Done: shares the photo on screen. Verify: Web (share stub receives a file).
- **G46** [F1 + W6] The recap signs the whole event to pick 12 (10). Now: loads every page and picks
  the most liked, the first 12 by time on reveal day (`app/src/recap.tsx:31-56`,
  `app/src/event.tsx:147-155`). Done: one highlights call; without likes, one or two per
  photographer spread over the night. Verify: API.
- **G47** [W6] The recap's slides change while it plays (10). Now: `app/src/recap.tsx:56`. Done: the
  set is fixed when the recap opens. Verify: Web.
- **G48** [W6] Viewer has no gestures (9.3, D9). Now: horizontal paging only. Done: pinch and
  double-tap zoom, swipe down to close, tap to hide controls, arrow keys on web. Verify: Maestro
  (swipe down closes), Web (keys).
- **G49** [W6] The viewer's position label is off centre (9.3). Now: Report or Hide beside Share
  (`app/src/photo.tsx:169-195`). Done: a More button holds Report and Hide; the position is
  centred. Verify: Shot (against reveal 4).
- **G50** [W6] Download all asks per photo (9.4). Now: `app/src/save.ts:14-23`. Done: one request at
  the start; refusal says "Linger needs access to Photos to save them." with Open Settings. The
  viewer's single save gets the same Open Settings action; today it only shows a note
  (`app/src/photo.tsx:111`). Verify: Maestro (deny, then both paths).
- **G51** [W6] Download all stops at the first failure and reports success (9.4). Now:
  `app/src/event.tsx:410-426`. Done: continues, ends with "210 of 212 saved. 2 couldn't be saved."
  Verify: Web (one URL forced to fail).
- **G52** [W6] Download all uses stale URLs (9.4). Now: none refreshed. Done: refresh before
  starting. Verify: Web.
- **G53** [F1 + W5 + W6] A person's roll shows only loaded pages (9.2). Now: client filter over loaded
  pages (`app/src/event.tsx:400,512-521`). Done: `?guest=` on the gallery API. Verify: API, Web.
- **G54** [W3] The counter clips its neighbours (5.3). Now: `overflow: "hidden"` at 82 pt
  (`app/src/shutter.tsx:455-463`). Done: neighbours spill past the chip and fade into Night; under
  Reduce Motion the number swaps instead of rolling (14.5). Verify: Shot (against shoot 2), Review.
- **G55** [W3] Flash is On or Off, default Off, forgotten (5.4). Now: `app/src/camera.tsx:170`.
  Done: Auto, On, Off on the back camera, default Auto, remembered per device. Verify: Maestro
  (control and persistence), Device (the flash fires).
- **G56** [W3] The screen sleeps while the camera is open (5.1). Now: nothing keeps it awake. Done:
  `expo-keep-awake` and `navigator.wakeLock`. Verify: Web (wake lock requested), Review.
- **G57** [W3] Native uploads full-size captures (6). Now: `app/src/camera.tsx:103-107`. Done: resized
  to 2048 px before queueing. Verify: Maestro plus a size check on the queued file.
- **G58** [W4] Reconnecting waits for the next backoff tick (6). Now: backoff only
  (`app/src/uploads.ts:110-114`). Done: NetInfo or `online` triggers an immediate run. Verify: Web.
- **G59** [F2] Requests have no timeout (6). Now: `app/src/api.ts:193-197,335-340`. Done: 20 s for
  API calls, 90 s for a PUT. Verify: Web (route that never answers).
- **G60** [W4] `too-large` and missing files retry forever (6). Now: `app/src/uploads.ts:142-160`.
  Done: resize and retry once; a missing file is dropped with "1 photo couldn't be read." Verify:
  Web.
- **G61** [F2] Errors show server or JavaScript text (14.2). Now: `app/src/home.tsx:153`,
  `app/src/photo.tsx:131`. Done: one `problem(code)` in `copy.ts` with a string per API code;
  server messages stay in logs. Verify: Web (forced codes), review of every `catch` that renders.
- **G62** [F1 + W1] Sign-in errors are raw and lockout reads as expired (1.2). Now:
  `app/src/home.tsx:153`, `api/src/accounts.ts:177-187`. Done: a `code-locked` code on the server;
  wrong, expired, locked, rate-limited, email failed and offline each have copy. Verify: API,
  Maestro.
- **G63** [F2] No shared query cache, no refetch on focus (14.1, 7.1). Now: each of five screens
  fetches the summary on mount (`app/src/api.ts:359-390`). Done: one stale-while-revalidate cache
  keyed like `useLoad`, refetch on focus and foreground, polling paused in the background. Verify:
  Web (request count on camera open after join).
- **G64** [F2 + F1] Time rules disagree, D7 (14.3). Now: card line, create preview and join mix
  zones (`app/src/home.tsx:368,371`, `app/src/create.tsx:184-186`, `app/src/join.tsx:25`); leading
  zeros differ (`copy.ts:309-312`). Done: event facts in the event zone, device hour cycle, one
  formatter. Verify: Unit (core), Web (two zones).
- **G65** [F2] Titles leave single-word last lines (14.6). Now: `.docs/vision/visual.md` gap 3. Done:
  `lineBreakStrategyIOS="push-out"` on iOS serif titles, a no-break space between the last two
  words elsewhere, inside `Text`. Verify: Shot (join sheet "Emma & Daniel's Wedding day").
- **G66** [F2 + W1 + W6] Candle marks errors (14.7, Principle 5). Now: `Notice`
  (`app/src/ui.tsx:1017-1030`), "Delete account" (`home.tsx:504-510`), "Hidden from guests"
  (`photo.tsx:207`). Done: errors in Paper with a warning icon; Candle only for live, progress,
  caret, Popular and badges. Verify: Shot.
- **G67** [F2] The shots slider reaches 17 and 29 (1.4 step 3). Now: continuous seek
  (`app/src/create.tsx:82-88`), VoiceOver steps by 1 (`app/src/ui.tsx:610-613`), tick labels off
  their stops (`ui.tsx:1077,1101`). Done: snaps to the five stops with a selection haptic,
  accessibility steps by stops, labels under stops. Verify: Maestro, Shot.
- **G68** [W1] iOS swipe-back discards a half-made event (1.4). Now: only Android back asks
  (`app/src/create.tsx:229-239`). Done: "Discard this event?" on close, swipe-back and Android back
  when anything changed. Verify: Maestro.
- **G69** [W1] No custom reveal, D6 (1.4 step 3). Now: three modes (`app/src/create.tsx:90`), while
  the site promises it (`site/src/pages/index.astro:83`). Done: "Pick a time" under the segments.
  Verify: Maestro.
- **G70** [W1] Cover upload is late and its failure silent (1.4 step 2). Now: runs on Start, failure
  swallowed (`app/src/create.tsx:683-688`). Done: uploads on choice, "Remove photo", failure copy.
  Verify: Maestro.
- **G71** [W1] Every failure after creation reads as a payment failure (1.4 Start). Now:
  `app/src/create.tsx:720-726`. Done: cancelled is quiet; payment, network and past end time each
  have their line; past end goes to step 2; an expired session (401, `app/src/api.ts:206`) keeps
  the draft and goes to sign-in with the G87 line. Verify: Maestro (dev claim forced to fail).
- **G72** [W1] A resumed draft can only change the tier (1.4 Start). Now:
  `app/src/create.tsx:209-215,225`. Done: opens at step 5 with Back reaching every step. Verify:
  Maestro (Tofino draft).
- **G73** [W1] Prices are USD on every store (1.4 step 5). Now: from core
  (`app/src/create.tsx:618,630,740`). Done: the store's localized price string on native, core
  prices as fallback. Verify: Review (needs store keys), Maestro shows fallback.
- **G74** [W1] The events list ignores state (1.3). Now: newest created first
  (`api/src/events.ts:198-206`). Done: Live now, Coming up, Waiting for the reveal, Drafts,
  Revealed, Past. Verify: Maestro (seeded four events), Shot.
- **G75** [W1 + F1] The card line doesn't say what matters (1.3). Now: date and reveal in the device
  zone (`app/src/home.tsx:367-374`). Done: one line per state in the event zone, with photo counts
  the list response now carries. Verify: Maestro, API (counts in `GET /v1/events`).
- **G76** [W2] The join code is never shown as text (2.1). Now: `app/src/ui.tsx:982-1004`. Done:
  letter-spaced under the QR. Verify: Shot, Maestro.
- **G77** [W3] Unknown code is one Candle line and a retry of the same code (4.2). Now:
  `app/src/join.tsx:103-107`. Done: title, line and the code entry prefilled. Verify: Web, Shot.
- **G78** [W3] Ended and revealed sheets still say "You're invited to shoot" (4.2). Now:
  `app/src/join.tsx:135-137`, `copy.ts:138`. Done: "The camera has closed" and "The photos are
  ready" titles with their lines and buttons. Verify: Web (JNHSWM, EMMADN), Shot.
- **G79** [W3] Returning guests type their name again (4.3). Now: prefilled, never skipped
  (`app/src/join.tsx:62,77-81`). Done: "Join as Sam" with "Not Sam?". Verify: Web.
- **G80** [W3] An extra permission step before the system prompt (4.4). Now:
  `app/src/join.tsx:186-215`. Done: Continue goes straight to the system prompt; the step appears
  only when denied. Verify: Maestro, Web.
- **G81** [W3] The Live Activity's stale date is the reveal (7.7). Now: `app/src/activity.ts:61`,
  `modules/live-activity/ios/LiveActivityModule.swift:42,55-60`, so right-away events start stale
  and next-morning ones outlive iOS's 8-hour limit. Done: stale and end at `endsAt`, then "The
  camera has closed. Photos at 10:00." Verify: Review in the native pass, Shot of the lock screen.
- **G82** [W7] The site promises an App Clip (13.1). Now: `site/src/pages/index.astro:49,51`. Done:
  "Guests join from the QR code in their browser, or in the app if they have it."; Live Activity
  caption scoped to the iPhone app. Verify: Web (site text).
- **G83** [W7 + W1] "Try Linger" opens the host note (13.1). Now: `site/src/pages/index.astro:18`
  to the web root (`app/src/home.tsx:552-578`). Done: lands on the guest home from G7. Verify: Web.
- **G84** [F2] Reinstalling makes a new guest (11.1). Now: device id in MMKV
  (`app/src/api.ts:96-104`). Done: keychain on iOS through `expo-secure-store`, migrated once.
  Verify: Review, Maestro (reinstall keeps the joined event).
- **G85** [F1 + W3] A guest can't move to another browser, D2 (11.1). Now: no path. Done: the
  reveal email link restores the guest on any device. Verify: API (token rebinds), Web.
- **G86** [W3] Offline with nothing cached has no retry (5.6). Now: `app/src/shutter.tsx:200-204`.
  Done: "This event couldn't be loaded..." with Try again. Verify: Web.

### Tier 3: rough edges

- **G87** [F2 + W1] A dropped session clears silently (1.1). Now: `app/src/api.ts:206-208`. Done:
  Welcome says "You've been signed out. Sign in to continue." once. Verify: Maestro.
- **G88** [F2] The splash can hang on a slow keychain (1.1). Now: `app/app/_layout.tsx:23-41`. Done:
  3 s timeout, then Welcome. Verify: Review.
- **G89** [W1] No resend cooldown (1.2). Now: none. Done: "Send a new code in 24s" for 30 s. Verify:
  Maestro.
- **G90** [W1] Hosts never set their name (1.2). Now: `PATCH /v1/me` exists
  (`api/src/accounts.ts:224-229`), no client. Done: first sign-in asks "What should guests call
  you?". Verify: Maestro.
- **G91** [W1] Sign-in errors aren't announced (1.2). Now: plain text. Done: uses the announcing
  `Notice` from G184. Verify: Review with VoiceOver in the native pass.
- **G92** [W1] No long-press menu on cards (1.3). Done: Show code, Share link, Manage, Delete.
  Verify: Maestro.
- **G93** [W1] Blank list while loading (1.3). Now: `app/src/home.tsx:295-305`. Done: two Surface
  card placeholders. Verify: Shot.
- **G94** [W1] Create steps swap instantly (1.4, 14.5). Done: 220 ms slide, 200 ms progress fill,
  cross-fade under Reduce Motion. Verify: Review.
- **G95** [F2 + W1 + W3] No selection haptics (1.4, 14.4). Done: occasion, segments, slider stops,
  tiers, toggle, flash, zoom, through one haptics helper in `ui.tsx`. F2 puts it inside
  `Segmented`, `Slider` and the toggle; W1 adds occasion and tiers; W3 adds flash and zoom.
  Verify: Review.
- **G96** [F2] Progress isn't announced as a step (1.4). Now: `app/src/ui.tsx:686-702`. Done: "Step 2
  of 5". Verify: Review with VoiceOver.
- **G97** [W1] Changing occasion overwrites the host's choices (1.4 step 1). Now:
  `app/src/create.tsx:277-284`. Done: manual changes survive. Verify: Maestro.
- **G98** [W1] No time zone choice for trips (1.4 step 2). Now: device zone always
  (`app/src/create.tsx:166`). Done: a Time zone row when dates are far off or on request. Verify:
  Maestro.
- **G99** [W1] Unlimited's price appears only at step 5 (1.4 step 3). Done: "Unlimited shots add
  $9.99" under the slider at ∞. Verify: Shot.
- **G100** [W1] A resumed draft with unlimited offers it again (1.4 step 5). Done: "Included".
  Verify: Maestro.
- **G101** [W1] Partly completed purchases aren't explained (1.4 Start). Done: "Up to 80 guests is
  paid. Unlimited shots wasn't added." Verify: Maestro.
- **G102** [W2] No Copy link; Share sends the URL twice on iOS (2.1). Now:
  `app/src/create.tsx:771-776`. Done: Copy link beside Share; one URL. Verify: Maestro.
- **G103** [W2] The invite doesn't say when a scheduled camera opens (2.1). Done: "The camera opens
  Saturday at 15:00." Verify: Maestro.
- **G104** [W2] The event's invite sheet lacks the code, Copy link and Print (2.2). Now:
  `app/src/event.tsx:799-826`. Done: all three, Print for the host. Verify: Maestro.
- **G105** [W2] Table cards lack the code and the rules (2.3). Now: `app/src/create.tsx:829-854`.
  Done: code as text and "24 shots each. Photos appear tomorrow at 10:00." Verify: Review of the
  print HTML, Shot of the print preview.
- **G106** [F1] The host isn't told the event is full (3.1). Done: push "... is full. Make room for
  more guests." on the first refused join. Verify: API.
- **G107** [W5] The People count goes stale while polling (3.1). Now:
  `app/src/event.tsx:293-294,398`. Done: from the polled summary. Verify: Web.
- **G108** [W2] Manage: Name, editable until revealed (3.2). Verify: Maestro.
- **G109** [W2] Manage: Cover, any time (3.2). Verify: Maestro.
- **G110** [W2] Manage: Ends, live only, later or earlier but not past (3.2). Verify: Maestro, API
  covers the rule.
- **G111** [W2] Manage: Who sees the photos, Every guest to Only me only (3.2). Verify: Maestro.
- **G112** [W2] Manage: Show code, Copy link, Print table cards (3.2). Verify: Maestro.
- **G113** [W2 + F1] Manage: saving (3.2, 7.6). Done: one PATCH, "Saved" for 2 s, `locked` mapped to
  copy; a reveal change sends a silent push so devices reschedule. Verify: Maestro, API (push
  queued on reveal change).
- **G114** [W2 + F1] No way to delete an event (3.4). Now: no route. Done: `DELETE /v1/events/:id`
  removes rows and stored files, cancels the reveal job; Manage confirms with the spec's copy.
  Verify: API (objects gone from storage), Maestro.
- **G115** [W1] No way to delete a draft (3.4). Done: from its card and from setup, "Delete this
  draft?". Verify: Maestro.
- **G116** [W6 + F1] The host isn't marked in People (3.3, 9.2). Done: host row first, second line
  "Host", listed even before shooting. Verify: API, Shot (against reveal 6).
- **G117** [W6] People doesn't show the guest limit to the host (3.3). Done: "7 of 10 guests" under
  the title. Verify: Maestro.
- **G118** [F1 + W5] Reports reach nobody (3.5, 9.1, 14.2). Now: "The host will be told."
  (`copy.ts:218-219`), nothing sends (`api/src/shots.ts:487-511`). Done: push to the host when three
  reports hide a photo; eye-slash and report badges on host tiles. Verify: API, Shot.
- **G119** [W3] The byline doesn't name the host (4.2). Now: `hostName` unused
  (`api/src/events.ts:150`). Done: "Alex invited you". Verify: Web.
- **G120** [W3] Join loading is a spinner in an empty sheet (4.2). Now: `app/src/join.tsx:109`.
  Done: the sheet's shape with a Surface placeholder. Verify: Shot.
- **G121** [W3] Full event: notice only, no retry (4.2). Now: `app/src/join.tsx:142-147`. Done:
  "{title} is full", "Ask the host to make room.", Try again. Verify: Web.
- **G122** [W3] Draft event: no title, no retry (4.2). Done: "{title} isn't open yet", Try again.
  Verify: Web (TFNWKD).
- **G123** [W3] Draft, full and before-start sheets don't refresh (4.2). Done: every 15 s while open.
  Verify: Web.
- **G124** [W3] The sheet's clock is frozen at mount (4.2). Now: `app/src/join.tsx:64`. Done: a sheet
  left open past the start, the end or the reveal switches state (before start to live, live to
  ended, ended to revealed member or not-a-member). Verify: Web (fake clock across all three).
- **G125** [F2] Disabled buttons look like faded primary buttons (4.3). Now: 40% opacity
  (`app/src/ui.tsx:345`). Done: Raised background with Faint text. Verify: Shot.
- **G126** [W3] Native denied-camera body uses the first-ask text (4.4). Now:
  `app/src/join.tsx:197-202`. Done: "Linger needs the camera to take photos. Turn it on in
  Settings." Verify: Maestro.
- **G127** [W3] Safari asks for the camera twice (4.4). Now: opens, closes, reopens
  (`app/src/camera.web.tsx:33-71`). Done: the permission stream is handed to the camera. Verify: Web.
- **G128** [W3 + F2] The camera refetches what join already loaded (4.5). Now:
  `app/src/shutter.tsx:56-57`. Done: from the cache in G63. Verify: Web (request count).
- **G129** [W3] The web camera runs in a hidden tab (5.1). Now: `app/src/camera.web.tsx:108-142`.
  Done: stops on hide, restarts on return. Verify: Web.
- **G130** [W3] VoiceOver isn't told the shots left (5.2). Done: "17 shots left" after each shot.
  Verify: Review.
- **G131** [W3] A full roll shows a neighbour above the allowance (5.3). Now:
  `app/src/shutter.tsx:381-389`. Done: none above the allowance. Verify: Shot.
- **G132** [W3] The last shots aren't marked (5.3, 14.4). Done: last three in Candle with a light
  haptic, warning haptic on the last. Verify: Shot, Review.
- **G133** [W3] The counter is blank when nothing is cached (5.3). Now: `app/src/uploads.ts:75-98`.
  Done: placeholder and a disabled shutter until `me` loads. Verify: Web.
- **G134** [W3] No front-camera flash (5.4). Done: screen flash at full brightness on capture.
  Verify: Device.
- **G135** [W3] No pinch zoom or tap to focus (5.4). Verify: Device.
- **G136** [W3] Web front photos are unmirrored while the preview is mirrored (5.4). Now:
  `app/src/camera.web.tsx:192`. Verify: Web (compare pixels of a known frame).
- **G137** [W3] The last shot vanishes on reopening the camera (5.5). Now: component state
  (`app/src/shutter.tsx:88`). Done: kept per event; faint mark before the first photo. Verify:
  Maestro.
- **G138** [W3] No sign that photos are still sending (5.5). Done: Candle ring on the thumbnail;
  tapping opens the event. Verify: Shot.
- **G139** [W3] No "Closes in 8 min" (5.6). Verify: Web (fake clock).
- **G140** [W3] The closed camera doesn't say when photos appear (5.6). Now:
  `app/src/shutter.tsx:169-204`. Done: "The camera has closed. Photos appear tomorrow at 10:00."
  with See the event; once the reveal has passed (camera left open, or opened from an old link),
  "The photos are ready" with See the photos. Verify: Web (fake clock past end, then past reveal).
- **G141** [W5 + F1] A photo that fails to develop disappears silently (6). Done: "1 photo couldn't
  be developed. You got the shot back." from a `returned` count in `me`. Verify: API, Web.
- **G142** [W5] Upload lines push the grid down (7.1). Now: `app/src/event.tsx:489-511`. Done: a
  fixed slot. Verify: Shot.
- **G143** [W5] The closed camera button is an unlabelled disabled icon (7.1). Now:
  `app/src/event.tsx:440`. Done: "Reveals tomorrow at 10:00" as a status. Verify: Shot.
- **G144** [W5] Download is dimmed before photos exist (7.1). Now: `app/src/event.tsx:485`. Done:
  hidden. Verify: Web.
- **G145** [W5] The grid reads as 40 "Developing" stops to VoiceOver (7.2). Done: one element, "212
  photos developing". Verify: Review.
- **G146** [F2] The zone isn't named when it differs (7.3, Principle 8). Done: "tomorrow at 10:00
  Vancouver time". Verify: Web (browser zone set differently).
- **G147** [F1 + W5] Reminders go stale after a reveal change (7.6). Now: rescheduled only when that
  screen reopens (`app/src/event.tsx:220-221`). Done: silent push plus a resync of joined events on
  launch. Verify: API (push queued), Review.
- **G148** [W5] Local reminder and push will both fire (7.6). Done: a registered device cancels its
  local reminder. Verify: Review.
- **G149** [W3] The Live Activity doesn't say the roll is done (7.7). Verify: Shot.
- **G150** [F1 + W5] No personal line on the moment (8.3). Done: "12 of these are yours." Verify:
  Web.
- **G151** [W5] The moment hard-cuts to the grid after 1300 ms (8.3). Now: `app/src/event.tsx:658`.
  Done: cards settle into the first tiles as the grid fades up; under Reduce Motion the fan and the
  settle are one cross-fade (14.5). Verify: Review, Shot sequence.
- **G152** [W5] The moment's timer isn't cleared on unmount (8.3). Verify: Review (code).
- **G153** [W5] Right-away events show a countdown while live (8.4). Done: "Live" stat, new photos
  fade in on the 30 s refresh. Verify: Web.
- **G154** [W5] Right-away events end without a word (8.4). Done: "That's the night..." with "Watch
  the recap". Verify: Web.
- **G155** [F2 + W5 + W6] Images download again on every poll (9.1). Now: no `cacheKey` anywhere.
  Done: one source helper keyed by shot id and size, used by every image. Verify: Web (no second
  request for the same tile).
- **G156** [W5] Late photos (D1) don't appear in place (9.1). Done: they slot in by `takenAt` with
  the stats updated, on the refreshes G247 adds (the revealed screen doesn't poll today,
  `app/src/event.tsx:323`). Verify: Web.
- **G157** [W5] A gallery error shows "0 Moments" and no retry (9.1). Now:
  `app/src/event.tsx:447,531-533`. Verify: Web (gallery route forced to fail), Shot.
- **G158** [F1] People counts include hidden photos (9.2). Now: `api/src/events.ts:41,384`. Verify:
  API.
- **G159** [W6] The viewer opened from a roll pages the whole event (9.2). Now:
  `app/src/photo.tsx:44-46`. Verify: Web.
- **G160** [W6] Like has no selected state or feedback (9.3, 14.6). Now: `app/src/photo.tsx:218-228`.
  Done: accessibility selected state, scale bounce, light haptic. Verify: Review.
- **G161** [W6] Share shows nothing while downloading (9.3). Now: `app/src/save.ts:26-29`. Verify:
  Review.
- **G162** [W6] Viewer notes push the buttons down and aren't announced (9.3). Now:
  `app/src/photo.tsx:212-216`. Verify: Shot.
- **G163** [W6] The photographer's name doesn't open their roll (9.3). Verify: Web.
- **G164** [W6] Hide waits on the network and shows raw errors (9.3). Now:
  `app/src/photo.tsx:126-133`. Done: immediate, "Hidden from guests. Undo". Verify: Maestro.
- **G165** [W6] Saved photos don't go into an album (9.4). Verify: Maestro (album exists).
- **G166** [W6] Download all can't be stopped and dies on leaving (9.4). Verify: Maestro.
- **G167** [W6] On phone browsers Download all opens many downloads (9.4). Done: the button explains
  "Save photos one at a time from the viewer." Verify: Web (mobile user agent).
- **G168** [W6] Recap slides don't credit the photographer (10). Verify: Shot.
- **G169** [W6] The recap has no end card (10). Done: title, counts, "Watch again", "See every
  moment". Verify: Web.
- **G170** [W6] Recap slides don't cross-fade and start soft (10). Verify: Review.
- **G171** [W6] Landscape recap slides are cropped and upscaled (10). Done: pan across the frame.
  Verify: Shot.
- **G172** [W6] The recap has no pause indicator, VoiceOver actions or Reduce Motion path (10,
  14.6). Now: `app/src/recap.tsx:107-117`. Verify: Review.
- **G173** [W1] Settings has no Name row (12). Verify: Maestro.
- **G174** [W1] Settings has no Notifications row (12). Verify: Maestro.
- **G175** [W1] Sign out loses waiting photos and leaves reminders (12). Now:
  `app/src/home.tsx:500-502`, `app/src/api.ts:239-244`. Done: confirm when photos or a purchase
  wait; reminders cancelled. Verify: Maestro.
- **G176** [W1] The delete confirm doesn't mention live events or refunds (12). Now:
  `copy.ts:62-66`. Verify: Shot.
- **G177** [W1] Destructive rows are Candle (12). Now: `app/src/home.tsx:504-510`. Done: Paper text
  with a trash icon. Verify: Shot.
- **G178** [F2] Deleting the account leaves device state (12). Now: only the session is cleared
  (`app/src/api.ts:249-253`). Done: reminders, moment flags and the queue for the host's events
  cleared. Verify: Review.
- **G179** [W7] Privacy doesn't cover the optional guest email (13.1). Verify: Web (page text).
- **G180** [W7] Unknown web paths say "no event with that code" (13.2). Done: a not-found page with
  a link to the guest home. Verify: Web.
- **G181** [F2] Web confirms use `window.confirm` (13.2). Now: `app/src/ui.tsx:1006-1010`. Done: the
  app's sheet. Verify: Web.
- **G182** [F2] Bad JSON blames the connection (14.2). Now: `app/src/api.ts:203,213`. Done:
  "Something went wrong. Try again." Verify: Web.
- **G183** [F2 + W3] The device clock drives the shooting window (14.3). Now:
  `app/src/shutter.tsx:59-72`. Done: an offset from the response `Date` header. Verify: Web (clock
  skewed in the browser).
- **G184** [F2] Errors and status lines aren't announced (14.6). Now: `Notice` is plain text
  (`app/src/ui.tsx:1017-1030`). Done: live region on web, `announceForAccessibility` on native.
  Verify: Review.
- **G185** [F2] Dynamic Type isn't handled (14.6). Done: display styles capped, rows and buttons grow;
  checked at the largest size. Verify: Shot at the largest size in the native pass.
- **G186** [F2] Faint text at 13 pt fails contrast (14.6). Done: Faint only at 15 pt and up, Ash
  below. Verify: Review.
- **G187** [F2 + W5] "›" is in labels and copy (14.2, 14.6). Now: `copy.ts:184`. Done: drawn as an
  icon, removed from accessibility labels. Verify: Review.
- **G188** [F2] No spacing, radius or divider scale; four sheet patterns (14.7, 9.2). Now: 11 radii,
  literal paddings (`.docs/vision/system.md` section 10). Done: scales and one Sheet, Row, Toast
  and share helper in `ui.tsx`; owners adopt them. Verify: Review, lint for stray literals is not
  practical, so a grep in review.
- **G189** [F2 + all owners] Reduce Motion isn't read (14.5). Done: one hook from `ui.tsx`; F2 uses
  it in `Sheet` (fade instead of slide) and every `ui.tsx` animation, and each owner applies it to
  the animations in its files, listed in the items that name them (G54, G94, G151, G172, G199,
  G205, G209, G217). Verify: Review, plus Web with `reducedMotion: "reduce"` in Playwright for the
  web-visible ones.
- **G190** [F2] Success and warning haptics are missing (14.4). Done: sign-in, join, going live,
  purchase, saved, fan, destructive confirm, through the helper. Verify: Review.
- **G191** [N] Android has never run (14.8). Done: built and taken through every flow, keyboard
  avoidance, a notification channel, an ongoing notification for shooting. Scope is decision Q9.
  Verify: Maestro on an emulator.
- **G192** [F2] Demo photos ship in every build (14.9). Now: 7.9 MB (`app/src/demo.ts`). Done:
  development only. Verify: export size check.
- **G193** [W6] The people list isn't virtualised (14.9). Now: ScrollView
  (`app/src/event.tsx:729-791`). Verify: Web with 250 seeded guests (the seed has four events with
  a handful of guests each; F1 adds the large one, see F1).

### Tier 4: finish

- **G194** [W1] One legal link opens Terms only (1.1). Now: `app/src/home.tsx:98-106`. Verify: Maestro.
- **G195** [W1] No "Open Mail" on iOS (1.2). Verify: Maestro.
- **G196** [W1] Sign-in success has no haptic or transition (1.2). Verify: Review.
- **G197** [W1] A failed background reload says nothing (1.3). Verify: Maestro (API stopped).
- **G198** [W1] Pull to refresh only spins with a list (1.3). Now: `app/src/home.tsx:288`. Verify:
  Review.
- **G199** [W1] Cards don't fade in (1.3). Verify: Review.
- **G200** [W1] Step 1's close control is labelled "Back" (1.4). Now: `app/src/create.tsx:264-268`.
  Verify: Review.
- **G201** [W1] No characters-left hint from 50 (1.4 step 2). Verify: Shot.
- **G202** [W1] A blank title gives no reason (1.4 step 2). Now: `app/src/create.tsx:672`. Verify:
  Maestro.
- **G203** [W1] Pickers open over the keyboard (1.4 step 2). Verify: Review.
- **G204** [W1] No "Test purchase" caption in development (1.4 step 5). Verify: Shot.
- **G205** [W2] Going live has no haptic and the invite doesn't scale in (1.4, 14.5). Verify: Review.
- **G206** [W2] "Done" crowds the invite title (2.1). Now: `app/src/create.tsx:797-808`. Verify: Shot
  at the largest text size.
- **G207** [W2] Table cards fall back to Georgia offline (2.3). Done: fonts embedded. Verify: Review
  of the print HTML.
- **G208** [W3] The rules don't say photos come from this camera only (4.2). Verify: Web.
- **G209** [W3] The join sheet jumps between steps (4.2). Done: height animates. Verify: Review.
- **G210** [W3] The grab bar does nothing (4.2). Now: `app/src/join.tsx:234`. Done: removed or swipe
  dismisses. Verify: Shot.
- **G211** [W3] No way back from the name step (4.3). Verify: Web.
- **G212** [W3] Joining has no haptic (4.3). Verify: Review.
- **G213** [W3] Web viewfinder corners show light slivers (5.1). Now:
  `app/src/camera.web.tsx:184-192`. Verify: Web screenshot.
- **G214** [W3] No second film-advance haptic (5.2). Verify: Review.
- **G215** [W3] Shutter sound undecided (5.2). Decision Q11. Verify: Review.
- **G216** [W3] Volume buttons don't fire the shutter (5.2). Feasibility depends on VisionCamera 5;
  if it needs a native module, it moves to Later. Verify: Device.
- **G217** [W3] The blink ignores Reduce Motion (5.2). Verify: Review.
- **G218** [W3] A lone "1×" on single-lens devices (5.4). Now: `app/src/shutter.tsx:307-318`.
  Verify: Web (single fake camera).
- **G219** [W3] The flash label names the state (5.4). Now: `app/src/shutter.tsx:214`. Verify:
  Review.
- **G220** [W3] A capture failure pushes the tools down (5.5). Now: `app/src/shutter.tsx:207`.
  Verify: Shot.
- **G221** [W3] "That's your roll" has no haptic (5.6). Verify: Review.
- **G222** [W5] No "All 12 of your photos are in." after an offline spell (6). Verify: Web.
- **G223** [W5] Event pull to refresh never spins (7.1). Now: `app/src/event.tsx:566`. Verify: Review.
- **G224** [F2] Grid gap varies with width (7.2). Now: `48.9%` (`app/src/ui.tsx:1161`). Done: fixed
  6 pt. Verify: Shot.
- **G225** [W5] No "Add to Home Screen" hint on iOS Safari (7.5). Verify: Web (Safari UA).
- **G226** [W3] The Live Activity loads the gallery per photo for its count (7.7). Now:
  `app/src/activity.ts:28-36`. Done: from the summary. Verify: Review.
- **G227** [W5] A banner shows while already on that event (8.1). Now:
  `app/src/event.tsx:194-203`. Verify: Review.
- **G228** [W5] The fan opens without a haptic (8.3). Verify: Review.
- **G229** [F2] Two divider weights (9.2). Now: `app/src/event.tsx:873`, `app/src/home.tsx:642`.
  Verify: Review.
- **G230** [F1 + W6] A guest can't take back their own photo (9.3). The terms say photos can be
  removed (`site/src/pages/terms.md:37`). Decision Q12. Verify: API, Maestro.
- **G231** [W6] Nothing says photos are kept at 2048 px (9.4). Verify: Shot.
- **G232** [W6] The recap title doesn't fade after 3 s (10). Verify: Review.
- **G233** [W6] The recap close is a 48 pt glass square (10). Now: `app/src/recap.tsx:133`. Verify:
  Shot (against reveal 5).
- **G234** [W1] Archived events don't move to Past (11.2, D3). Verify: Maestro.
- **G235** [W7] The App Store button points at support (13.1). Waits on the listing. Verify: Web.
- **G236** [W7] Support answers describe edits the app lacks (13.1). Done once G27 to G28 land.
  Verify: Web.
- **G237** [W7] Legal drafts have bracketed placeholders (13.1). Lawyer work, decision Q13. Verify:
  W7 lists every placeholder in the hand-off; the item stays open.
- **G238** [W1] Web store buttons both open the site (13.2). Now: `app/src/home.tsx:566-571`. Verify:
  Web.
- **G239** [W3] Android Chrome captures a video frame (13.2). Now: `app/src/camera.web.tsx:73-82`.
  Done: `ImageCapture.takePhoto()` where supported. Verify: Review.
- **G240** [F2] No glossary in `copy.ts` (14.2). Verify: Review.
- **G241** [F1 + F2] Strings outside the catalogue (14.2). Now: "Free" and "$" in core
  (`core/src/pricing.ts:78-81`), "Developing" in `Tile`, duration units. Verify: Unit, Review.
- **G242** [all owners] Colours and sizes outside the tokens (14.7). Each workstream removes the ones
  in its files after F2 lands the scales. Verify: grep in review.
- **G243** [F1] Signed media URLs unreachable from LAN devices in development (14.8). Done:
  `S3_PUBLIC_ENDPOINT`. Verify: API.
- **G244** [F2] Native builds ship full Pretendard (14.9). Done: subsets. Verify: export size check.
- **G245** [W3] The last-shot thumbnail decodes the full capture (14.9). Now: `app/src/look.tsx:17`.
  Verify: Review.

### Added by the critic: states the spec implies but no item covered

These are numbered after G245 so existing references stay valid; each states its tier. The first
two follow from Principle 3 and 8.2. The others are states that `product.md` doesn't list as
requirements yet. If Naib agrees, `product.md` gets matching lines at hand-off.

- **G246** [W3 + F2] Tier 1. The camera keeps shooting after the end and never hears about a
  change (5.6, 3.2). Now: the camera's clock ticks every 30 s (`app/src/shutter.tsx:69-71`) and
  its summary loads once with no reload (`shutter.tsx:55`), so the shutter stays live for up to
  30 s after `endsAt`. An End now (G26) or an earlier end from Manage (G110) never reaches an open
  camera. Those shots are refused as `not-shooting` and the queue deletes them
  (`app/src/uploads.ts:31,136-139`). Done: a timer to `endsAt` (on the G183 offset) switches to
  Closed on time; the summary refetches on foreground, every 60 s while the camera is open, and at
  once after a `not-shooting` refusal; an end moved later reopens the camera. F2 supplies the
  refetch through the G63 cache. Verify: Web (fake clock crosses the end with the camera open;
  end moved earlier through the API while open).
- **G247** [W5 + W4] Tier 2. Slow uploads at reveal time stay out of sight (6, 8.3, 9.1). Now:
  after the reveal the screen stops polling (`app/src/event.tsx:323`, `pollMs` is null once
  nothing is developing), so this device's photos still queued at the reveal, and other guests'
  late photos (D1), appear only after pull to refresh or reopening; the pending line reads the same
  as before the reveal (`event.tsx:505-511`). Done: while this device has photos queued after the
  reveal, the line reads "3 of your photos are still sending. They'll appear here."; the gallery
  refreshes when this device's queue drains (W4 exposes it on `ShotsState`) and on focus (G63);
  "12 of these are yours" (G150) counts only what has arrived. Verify: Web (hold uploads offline
  across the reveal, reconnect, the photos appear without a reload).
- **G248** [W3 + W5 + W1] Tier 3. A deleted event reads as a mistyped code (3.4). Now: once G114
  lands, a guest with the event open, in the camera or in the joined list gets `not-found` and sees
  "There's no event with that code" (`app/src/event.tsx:359`, `app/src/join.tsx:103-107`). Done:
  where the device already knew the event (joined list, an open screen, a cached summary), "This
  event isn't available any more." with Back to your events; the joined list and the host's list
  drop it; its reminder is cancelled; queued photos follow G1. Verify: Web (join, delete through
  the API, reload the event, camera and guest home).
- **G249** [W5] Tier 3. A guest who denied notifications has no way back (7.4). Now: the system
  prompt fires on mount and a denial is final (`app/src/event.tsx:217-237`); only the host gets a
  Settings row (G174). Done: when the permission is denied, the G39 card reads "Notifications are
  off for Linger. Turn them on in Settings to hear when the photos are ready." with Open Settings
  and Not now, shown once per event. Verify: Maestro (deny, then the card).

Counts: 15 in tier 1, 73 in tier 2, 109 in tier 3, 52 in tier 4, 249 in all.

---

## 2. Workstreams

### File ownership

Each workstream owns the files listed for it. No other workstream edits them. Three things make
that possible:

1. **Shared files are changed only in foundations.** `ui.tsx`, `copy.ts`, `api.ts`,
   `_layout.tsx`, `app.config.ts`, `app/package.json`, the lockfile, fonts, everything in
   `packages/core`, and everything in `apps/api` (whose tests share one `linger_test` database, so
   two agents can't run them at once).
2. **`event.tsx` and `create.tsx` are split first.** `event.tsx` holds seven concepts (gallery
   store, notifications, the event screen, the moment, people, the invite sheet, sharing;
   `app/src/event.tsx:69-259,287,639,687,799`) and `create.tsx` holds the invite card and table
   cards (`create.tsx:754-854`). Rule 1 of the architecture allows a split when a file holds two
   concepts. F2 moves code without changing behaviour, so the parallel workstreams start from
   disjoint files. The new files are listed below and need a dated line under plan Results
   (decision Q1).
3. **Copy additions go in owned blocks.** F2 adds every string the spec quotes. If a workstream
   needs another, it adds it inside its own marked block at the end of the `en` catalogue in
   `copy.ts` with the Edit tool and never runs Prettier on that file; the merge step folds the
   blocks in and formats once.
4. **Cross-workstream calls go through stubs F2 leaves behind.** Where one workstream calls into a
   file another owns, F2 adds the export first with today's behaviour, and the owner keeps its
   signature:
   - `_layout.tsx` (F2) calls `handleNotificationOpen` and `resyncReminders` from `notify.tsx`
     (W5) for G38 and G147, so W5 never edits the layout.
   - `uploads.ts` (W4) calls `keepInPhotos(uri)` from `save.ts` and `save.web.ts` (W6) for G1.
   - `ShotsState` in `uploads.ts` gains the fields others read (`keptInPhotos`, `unreadable`,
     `sending`, `drained`) as stubs; W3 reads it for G138 and G246, W5 for G1, G60, G222 and G247,
     W1 for G175. Only W4 fills them.
   - W2's "Make room" (G29) calls the existing exports of `purchase.ts` (W1); W1 may add exports
     but doesn't change the existing ones.
   - G192 changes how `camera.tsx` imports `demo.ts`; F2 makes that edit before W3 starts.
5. **Files nobody edits in the parallel phase.** `apps/app/ios/**` is generated by prebuild; the
   config changes in F2 reach it only when N rebuilds the dev client. `app/flows/open.yaml` and
   `config.yaml` are shared by every flow and change only in N. The existing `apps/app/web.e2e.ts`
   belongs to W3, because G31, G79 and G80 change the join path it drives.

New files F2 creates by moving code or as stubs with their exported signatures:

| File | Concept | Moved from | Owner |
| --- | --- | --- | --- |
| `app/src/gallery.ts` | gallery store, paging, roll filter, URL refresh | `event.tsx:69-176` | W6 |
| `app/src/notify.tsx` | permission card, reminders, push token, notification links | `event.tsx:205-257` | W5 |
| `app/src/moment.tsx` | the reveal moment | `event.tsx:617-683` | W5 |
| `app/src/people.tsx` | people sheet and rolls | `event.tsx:687-795` | W6 |
| `app/src/invite.tsx` | invite card, invite sheet, table cards, share link | `ui.tsx:969-1004`, `event.tsx:259,799-826`, `create.tsx:754-854` | W2 |
| `app/src/manage.tsx` | host row and Manage sheet | stub | W2 |
| `app/src/joined.tsx` | joined events and code entry | stub | W3 |

Download all moves from `event.tsx:410-426` into `save.ts` and `save.web.ts`, so saving has one
home (W6).

### F1, contract: core and API (one agent)

Files: `packages/core/src/*`, `apps/api/src/*`, `apps/api/drizzle/*`, `.env.example`,
`render.yaml`.

Contract it delivers, written into `.docs/plan.md` so app workstreams code against it:

- `canShoot` honours `startsAt`; `shootingPhase(event, now)` returns before, open or closed.
- `canReserve` accepts photos taken before the end until 7 days after the reveal.
- `EventSummary.viewer` (role host, guest or none; guest id; shots taken and left), `dueState`,
  `photoCount`, `photographerCount`, and `guestLimit` for the host.
- `Event` in `GET /v1/events` gains `photoCount` and `guestCount`.
- Gallery: `?guest=`; the pending page lists first names in shot order; host items carry `reports`.
- `GET /v1/e/:code/highlights?for=moment|recap`, signed, chosen as G35 and G46 describe.
- `GET /v1/joined` with `X-Device`: summaries for events this device joined.
- `DELETE /v1/events/:id`; `code-locked` on sign-in; `returned` count in `/me`.
- Host shooting without a guest slot; people list includes the host first and counts only
  visible photos.
- Guest email (D2): `POST /v1/e/:code/email`, reveal email, restore token and
  `POST /v1/e/:code/restore`; a migration for `guests.email`, `guests.is_host` and restore tokens.
- Reveal push with counts, receipts and pruning, silent push on reveal change, push on full and on
  hide by reports.
- `S3_PUBLIC_ENDPOINT`; "Free" and "$" leave core's `formatPrice`.
- The per-event Open Graph page if decision Q4 puts it in the API.
- Seed scenarios the checks above need, beside the four events there now (`api/src/seed.ts:60-177`):
  a live event before its start (G22 to G25), a free event one guest short of full (G29, G121),
  a right-away event that is shooting (G153, G154), a revealed event with a reported and a hidden
  photo (G118), and a revealed event with 250 guests (G193). The restore link lands on
  `/j/<code>` with a `restore` parameter, so no new app route is needed (G85).

Items (27): G2, G5, G6 (server part), G14 (server part), G18 (server part), G22, G30, G31, G35,
G37, G41 (server part), G46, G53, G62 (server part), G75 (server part), G85, G106, G113 (server
part), G114 (server part), G116 (server part), G118, G141, G147, G150, G158, G230 (if Q12 is yes),
G243. Shares G64 and G241 with F2.

Acceptance: `pnpm --filter api test` and core tests pass with a test for each rule above; `pnpm
check` passes; the seed still loads; `/health` returns 200; the contract section in `plan.md` is
updated with every new field, route and error code.

### F2, app foundations (one agent, runs beside F1)

Files: `app/src/ui.tsx`, `copy.ts`, `api.ts`, `demo.ts`, `app/app/_layout.tsx`,
`app/app.config.ts`, `app/package.json`, `pnpm-lock.yaml`, `app/assets/fonts/*`, and the splits
above (it creates the new files, then hands them over).

Work: split files; install every new dependency once (keep-awake, NetInfo, secure store use, the
Newsreader display cuts, the Skia frame processor package if Q7 is yes, an IndexedDB helper only if
plain IndexedDB proves too verbose); query cache with persistence and focus refetch; `problem(code)`
and every quoted string; time formatting under D7; timeouts; device id in the keychain;
`initialRouteName`; splash timeout; signed-out notice; tokens (spacing, radius, divider, error
treatment); `Text` orphan control and Dynamic Type caps; Slider stops; disabled Button; announcing
`Notice` and a Toast; app-sheet confirm on web; one haptics helper and the Reduce Motion hook; image
source helper with `cacheKey`; app config for associated domains, EAS project id, background modes.
The `api.ts` client methods for F1's new routes are added against the contract; their types come
from core once F1 lands, so F2 finishes `api.ts` last.

Items (43): G4 (cache part), G10 (helper), G13 (route part), G14 (config part), G15, G17 (config
part), G20, G30 (client types), G34 (formatter), G59, G61, G63, G64, G65, G66 (Notice), G67, G84,
G87, G88, G95 (inside `ui.tsx` controls), G96, G125, G128 (cache), G146, G155 (helper), G178,
G181, G182, G183 (offset), G184, G185, G186, G187 (copy), G188, G189, G190, G192, G224, G229,
G240, G241, G244, G246 (refetch), and the stubs in rule 4 above.

Acceptance: `pnpm check` passes; both Expo exports build; the existing `web.e2e.ts` passes
unchanged after the splits (behaviour preserved); the new files exist with their exported
signatures; one screenshot of the join sheet and the moment with the display cut.

### W1, host setup and account

Files: `app/src/home.tsx`, `app/src/create.tsx`, `app/src/purchase.ts`,
`app/src/purchase.web.ts`, `app/app/index.tsx`, `app/app/new.tsx`, `app/app/settings.tsx`,
`app/flows/host.yaml`.

Items (47): G7 (render), G11, G23, G62 (app), G66 (rows), G68, G69, G70, G71, G72, G73, G74, G75,
G87 (screen), G89, G90, G91, G92, G93, G94, G95, G97, G98, G99, G100, G101, G115, G173, G174,
G175, G176, G177, G194, G195, G196, G197, G198, G199, G200, G201, G202, G203, G204, G234, G238,
G83 (the web root it lands on), G248 (the host's list drops a deleted event).

Acceptance: `pnpm check`; `host.yaml` updated to cover grouping, start time, custom reveal,
discard, resume at step 5 and the name step (run in the native pass); no new string outside
`copy.ts`.

### W2, hosting tools and invite

Files: `app/src/manage.tsx`, `app/src/invite.tsx`, `app/flows/manage.yaml` (new).

Items (20): G26, G27, G28, G29, G40 (invite), G76, G102, G103, G104, G105, G108, G109, G110, G111,
G112, G113, G114, G205, G206, G207, plus the host row slot it fills in `event.tsx` through the
`HostRow` export (the slot is placed by F2).

Acceptance: `pnpm check`; `manage.yaml` covers end now, reveal later, visibility, make room through
dev claim, delete; print HTML contains the code and rules line.

### W3, guest join, camera and Live Activity

Files: `app/src/join.tsx`, `app/src/joined.tsx`, `app/src/shutter.tsx`, `app/src/camera.tsx`,
`app/src/camera.web.tsx`, `app/src/look.tsx`, `app/src/look.web.tsx`, `app/src/activity.ts`,
`app/targets/activity/*`, `app/modules/live-activity/*`, `app/app/j/[code].tsx`,
`app/app/e/[code]/camera.tsx`, `app/flows/guest.yaml`, `apps/app/guest.e2e.ts` (new),
`apps/app/web.e2e.ts`.

Items (64): G4, G6, G7, G8, G15 (Live Activity font), G16, G21, G24, G25, G31, G54, G55, G56, G57,
G77, G78, G79, G80, G81, G85, G86, G119, G120, G121, G122, G123, G124, G126, G127, G128, G129,
G130, G131, G132, G133, G134, G135, G136, G137, G138, G139, G140, G149, G183, G208, G209, G210,
G211, G212, G213, G214, G215, G216, G217, G218, G219, G220, G221, G226, G239, G245, G95 (flash
and zoom), G246, G248 (join sheet, camera and joined list).

Acceptance: `pnpm check`; `guest.e2e.ts` covers every join sheet state in the spec's table, code
entry, joined list, offline camera, camera states with a fake clock including the end passing
while the camera is open; `web.e2e.ts` updated for the new join path; `guest.yaml` updated; the
Swift target builds with `xcodebuild` without a simulator install (the run happens in the native
pass).

### W4, upload queue

Files: `app/src/uploads.ts`, `apps/app/uploads.e2e.ts` (new).

Items (7): G1, G2 (client), G3, G12, G58, G60, G247 (`drained` and `sending`).

Acceptance: `pnpm check`; `uploads.e2e.ts` covers 30 photos offline and a reload, a final refusal
saving the photo, `too-large` once, reconnect retry; a line under plan Results if background
upload isn't possible on SDK 58.

### W5, event screen, waiting and the reveal

Files: `app/src/event.tsx`, `app/src/moment.tsx`, `app/src/notify.tsx`,
`app/app/e/[code]/index.tsx`, `apps/app/reveal.e2e.ts` (new).

Items (44): G5 (card), G10 (focus), G13 (control), G14 (registration), G32, G33, G34, G35, G36,
G37 (local), G38, G39, G40 (card), G41, G42, G43, G44, G53 (event), G107, G118 (badges), G141,
G142, G143, G144, G145, G147, G148, G150, G151, G152, G153, G154, G155, G156, G157, G187, G222,
G223, G225, G227, G228, G247, G248 (event screen), G249.

Acceptance: `pnpm check`; `reveal.e2e.ts` drives an at-end event ending in 20 s and asserts the
moment within 5 s of the reveal, the server's three cards, "Now" instead of "0m", the roll line and
the labelled recap action; it also holds one upload across the reveal and checks it appears after
reconnecting (G247), and runs the reveal once with `reducedMotion: "reduce"`; screenshots of developing and moment against shoot 3 and reveal 2.

### W6, gallery, viewer, people, recap and saving

Files: `app/src/gallery.ts`, `app/src/photo.tsx`, `app/src/recap.tsx`, `app/src/people.tsx`,
`app/src/save.ts`, `app/src/save.web.ts`, `app/app/e/[code]/[photo].tsx`,
`app/app/e/[code]/recap.tsx`, `app/flows/gallery.yaml`, `apps/app/gallery.e2e.ts` (new).

Items (34): G9, G10, G45, G46, G47, G48, G49, G50, G51, G52, G53 (store), G66 (hidden line), G116,
G117, G155, G159, G160, G161, G162, G163, G164, G165, G166, G167, G168, G169, G170, G171, G172,
G193, G230, G231, G232, G233.

Acceptance: `pnpm check`; `gallery.e2e.ts` covers URL refresh past expiry, roll paging, viewer
keys, recap stable set, end card and share; `gallery.yaml` covers swipe down, save all into an
album and hide with undo; viewer and recap screenshots against reveal 4 and reveal 5.

### W7, web shell and site

Files: `apps/site/**`, `app/app/+html.tsx` (new), `app/app/+not-found.tsx` (new),
`app/app/[code].tsx`, `app/public/**` (`.well-known`), `apps/site/site.e2e.ts` (new).

Items (10): G17 (served files), G18 (page side), G19, G82, G83, G179, G180, G235, G236, G237 (only
the placeholders list, the text waits on a lawyer), and the Render routing for Q4.

Acceptance: `astro build` and `astro check`; `site.e2e.ts` checks the hero copy, the Try Linger
link target, privacy text and that `/.well-known/apple-app-site-association` returns JSON.

### N, native pass (one agent, after the merge)

Files: `app/flows/*.yaml` fixes only, `.docs/vision/shots/after-*.png`, `.docs/qa.md`.

Items (1 own, plus every Maestro, Shot and Review check above): G191 if Q9 is yes. Device and
Android checks are not N's; N lists them as "built, not verified" in `qa.md` for the device pass
(Q16) and the Android pass (Q9).

---

## 3. Order

1. **Preconditions.** Naib finishes manual QA on the simulator and frees 8170, 8171 and 8173. The
   repo has no commit yet (`git log` reports none), so an initial commit is made first (Q2). Each
   workstream then runs in its own git worktree.
2. **Foundations: F1 and F2 at the same time.** Disjoint files. F2 finishes `api.ts` after F1's
   contract lands. Exit: both acceptance lists pass, merged to main.
3. **Parallel: W1 to W7 at the same time.** Each in a worktree from the foundations merge. They run
   `pnpm check` (format, lint, typecheck; the API tests don't change in this phase) and write their
   Playwright and Maestro tests, but don't run Playwright or Maestro, because both use the one API,
   the one Metro and the one simulator. Exit: each acceptance list passes except the runs.
4. **Merge and web run (one agent).** Merge W1 to W7, fold the copy blocks into the catalogue and
   format, reseed, run `pnpm check`, `pnpm --filter api test` and every `*.e2e.ts`. Fix what breaks,
   in the owning files.
5. **Native pass (one agent, the only one on the simulator).** Rebuild the dev client (new native
   dependencies), reseed (MAYA3X stays live for four hours), run every Maestro flow, take the
   `after-` screenshots and compare them with the scratchpad at 402x874 points, check every Review
   item by hand including VoiceOver and the largest text size, then Safari for G21. Android if Q9
   is yes.
6. **Review.** Independent reviews for the architecture rules (one concept per file, no new
   folders, no phase numbers), correctness, the reveal secret (no URL before the reveal through
   the new highlights, pending names and joined routes), and copy (no em dashes, voice, no claim
   beyond the code). Fixes go to the owning files.
7. **Hand-off.** `pnpm check`, API tests and web runs pass; a dated line per decision under plan
   Results; `product.md` statuses updated; `qa.md` updated for the new screens; services running,
   seed loaded, app on the simulator signed in as the demo host.

---

## 4. Decisions for Naib

The spec already picks D1 to D9 and marks most "confirm". My recommendations on those, then the
new questions this plan raises.

- **D1, late photos until 7 days after the reveal.** Recommend yes. It is what makes "a photo taken
  is a photo kept" true for the guest who opens the app the next morning.
- **D2, optional email for browser guests, plus a calendar file.** Recommend yes. It also gives web
  guests a way back on a new device. It needs a production SMTP sender and a privacy line (G179).
- **D3, archive stays a label.** Recommend yes; it matches the privacy draft.
- **D4, the host shoots without using a guest place.** Recommend yes.
- **D5, scheduled events.** Recommend yes; without it a wedding created on Monday is open for days.
- **D6, custom reveal.** Recommend yes; the site already promises it.
- **D7, device 12 or 24-hour clock.** Recommend yes; the launch market is the US and Canada.
- **D8 and D9.** Recommend as written: "Save photo" stays, double-tap zooms.

New questions:

- **Q1, file splits.** Split `event.tsx` and `create.tsx` into the seven files in section 2 before
  the parallel work. Recommend yes: it follows rule 1 (each holds several concepts) and it is what
  lets seven agents work at once.
- **Q2, initial commit and worktrees.** The repo has never been committed. Recommend a first commit
  of the current state before the run, so each workstream gets a worktree and review has diffs.
- **Q3, EAS project.** Push needs an EAS project id. Recommend creating the project under the
  GalleoApp account now; without it G14, G37 (push part) and G147 stay untestable.
- **Q4, link previews for the join domain.** The web app is a static single page, so per-event
  tags need a server. Recommend that Render send `join.lingercam.app/<code>` to a small API route
  that returns the app's `index.html` with the event's tags filled in, and everything else to the
  static build. The alternative is Expo's server output, which moves the guest web app off static
  hosting.
- **Q5, background uploads.** If SDK 58 has no background upload session, the choice is a small
  native module or leaving it for Later. Recommend trying `expo-file-system` first and recording
  the result; the 7-day late window (D1) covers most of the risk meanwhile.
- **Q6, timing.** Editing files reloads the API and Metro you're using for QA. Recommend starting
  the run after your QA session ends.
- **Q7, live film look in the native viewfinder.** Needs the VisionCamera Skia frame processor and a
  dev-client rebuild. Recommend yes, built in W3 and checked in the native pass.
- **Q8, notification permission timing.** The spec asks guests after they leave the camera or finish
  the roll, and hosts on the invite. Recommend as written.
- **Q9, Android in this run.** Nothing has been built for Android yet. Recommend leaving it out of
  this run and doing one Android pass on its own, since the native pass already has one simulator
  and a long list.
- **Q10, flash default.** Recommend Auto, remembered per device.
- **Q11, shutter sound.** Recommend a soft sound that respects the silent switch, off when the
  device is silenced.
- **Q12, guests removing their own photo after the reveal.** The terms imply it. Recommend yes,
  own photos only, from the viewer's More menu.
- **Q13, legal text and the App Store listing.** Both are outside engineering. Recommend leaving
  the placeholders and the support link until a lawyer and the listing are ready; G235 and G237
  stay open.
- **Q14, report review.** Recommend the push and tile badges only for now; a reported list goes to
  Later.
- **Q15, right-away events.** Recommend the closing line and the recap (G154) without a separate
  moment.
- **Q16, a device pass.** About a dozen items can only be checked on a physical iPhone (the
  Device checks: G14, G16 native, G17, G55, G134, G135, G216, and remote push for G37, G147 and
  G148). Recommend one short pass on Naib's phone after the native pass, with a dev client built
  for the device, before `product.md` marks those items yes.
- **Q17, the four states the critic added (G246 to G249).** G246 and G247 follow from Principle 3
  and section 8.2 and are recommended as written. G248 and G249 are new copy; recommend yes, with
  matching lines added to `product.md` at hand-off.

Item counts above count an item once per workstream that has a part of it, so they add up to more
than 245. Items shared between workstreams name the part each one owns in brackets.

---

## Critic changes

A completeness review on 2026-11-02 checked this plan against `product.md`, the vision notes and
the code (no source file has changed since 2026-11-01 21:08). Every `[partly]` and `[no]` line in
`product.md` maps to an item, and every item in the plan is still open in the code: the spot checks
(G3, G19, G43, G44, G55, G56, G58, G102, G129, G152, G210, G218, G223, G243 among others) all
match their "Now". What changed:

- **Four missing states added as G246 to G249**, numbered after G245 so references hold: the
  camera stays open up to 30 s past the end and never hears about End now (tier 1); a guest's
  photos still sending at the reveal, and late photos, don't appear because the revealed screen
  stops polling (tier 2); a deleted event reads as a mistyped code (tier 3); a guest who denied
  notifications has no way back (tier 3). Counts updated to 249. Decision Q17 asks Naib to confirm.
- **States folded into existing items**: offline event screen and offline at the reveal (G4);
  reveal passing on the closed camera (G140) and on an open join sheet (G124); expired session
  during create (G71); the viewer's single save when Photos is denied (G50); a Done for G156.
- **Reduce Motion**: G189 now says where the hook is applied and names the owner items; the
  counter swap (G54) and the moment cross-fade (G151) were missing and are added; the reveal test
  runs once with reduced motion.
- **Verification**: a Device kind for checks the simulator can't do (camera look, flash, focus,
  volume buttons, remote push, universal links) and an Android kind tied to Q9; G14, G16, G17,
  G55, G134, G135 and G216 moved to it, and N lists them as "built, not verified". New decision
  Q16 for a device pass. G237 got a verify line; G26's contradictory "Web" was removed; G193 and
  others now have the seed scenarios F1 adds.
- **Ownership**: brackets and item lists now agree (G30, G34, G95, G128 and G187 added to F2;
  G53 names W6; G83 belongs to W1, which owns the web root, not W3; G95's flash and zoom go to
  W3). A new rule 4 lists the cross-file calls that F2 stubs (`_layout.tsx` to `notify.tsx`,
  `uploads.ts` to `save.ts`, the `ShotsState` fields, W2 calling `purchase.ts`, the `demo.ts`
  import in `camera.tsx`), and rule 5 names the files nobody edits in the parallel phase
  (`ios/**`, `open.yaml`, `config.yaml`) and gives the existing `web.e2e.ts` to W3.
- **Copy**: the quoted strings match `product.md`; the new items' strings follow the same voice
  and go through F2's catalogue or the owner's copy block.
