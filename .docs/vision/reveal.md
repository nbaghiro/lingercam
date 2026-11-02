# Reveal and gallery: current behaviour, target experience, gaps

Scope: the reveal job and notifications, the anticipation before it, the reveal moment, the event
screen once revealed (cover, stats, actions, grid, people), the photo viewer, the recap, download
all, sharing, the archived state, and how hosts, guests and web guests differ. Read-only pass on
2026-11-02 against the working tree (no commits yet). References are `file:line` from the repo root
`linger/`. Design reference: `../smallwares/.scratchpad/linger/index.html`, act `reveal`
(lines 438-454) plus `home()` (lines 384-389) and CSS lines 150-240.

"Now" means what the code does today. "Should" is my proposal.

---

## 1. The timeline, state by state

### 1.1 Before the reveal (anticipation)

Now
- Server keeps the secret: `photoAccess` returns "none" before the reveal for everyone, host
  included (`packages/core/src/shots.ts:75-101`). The gallery endpoint then returns only counts:
  `{ kind: "developing", total, mine, photographers, revealsAt }` (`apps/api/src/shots.ts:301-320`).
- Event screen draws up to 40 "Developing" tiles from the count, each a blurred, shifted crop of
  the public cover (`apps/app/src/event.tsx:273-282`, `:402-408`, `:584-590`; blur radius 42 native
  / 18 web, `apps/app/src/ui.tsx:966`). Beyond 40: "N more developing" footer (`event.tsx:550-554`).
- Stats: Moments = `first.total`; middle stat is "Left" (time until end) while shooting, else
  "To reveal" (`event.tsx:393-397`). `formatDuration` clamps at 0, so after the reveal time and
  before the server flips it reads "0m To reveal" (`apps/app/src/copy.ts:332-340`).
- Polling: every 30 s while developing (`event.tsx:270`, `:323-333`); the summary reloads in the
  same tick. There is no timer aimed at `revealsAt`, so the flip can lag the reveal by up to 30 s
  plus job latency, and the countdown only moves every 30 s (no minute or second precision near
  the end).
- Local reminder: `remindAtReveal` (`event.tsx:217-237`) runs when the event screen mounts while
  developing (`:347-349`). Skipped on web, for right-away events and when the time is past. It asks
  for notification permission with no priming copy, then schedules a DATE trigger at `revealsAt`
  with id `reveal-<code>`, title = event title, body "The photos are ready." (`copy.ts:264-265`).
  It is rescheduled only when the screen is opened again and `revealsAt` has changed
  (`event.tsx:220-221`). A host who moves the reveal later or ends early (at-end mode) leaves a
  wrong reminder on every guest phone that doesn't reopen the event.
- Join flow lands on the event and pushes the camera on top (`apps/app/src/join.tsx:69-74`), so the
  permission prompt fires from the event screen underneath while the guest is in the camera.
- Push registration piggybacks on the reminder (`event.tsx:236`, `:205-215`) and silently does
  nothing without an EAS project id (`:206-209`). Today there is none, so no device is ever push
  registered.
- Live Activity (iOS, guests who shot): shots left, a Candle bar, moments so far, reveal time;
  `staleDate` = reveal so the lock screen reads "The photos are ready." if the app isn't opened
  (`apps/app/src/activity.ts:47-63`, plan Results phase 9). Ended when the gallery first comes back
  as photos (`event.tsx:105`) or on next launch (`apps/app/app/_layout.tsx:33`).
- People sheet before the reveal: "Shot counts so far. Everyone's photos appear at the reveal."
  (`copy.ts:241`), rows not tappable (`event.tsx:748`).

Rough or missing
- Nothing builds anticipation beyond a static number. No "camera closes in 30 minutes" nudge, no
  "camera closed: 212 moments developing" at the end, no "reveal in 1 hour", no ticking final
  minute, no visual change as the time approaches.
- Developing tiles are all the same blurred cover. They do not reflect who shot or when (allowed:
  counts and photographer names are not secret, the server already returns `photographers`).
- Web guests (the main no-install path, since there is no App Clip) get no reminder at all and no
  way to be told the photos are ready: no calendar file, no email or SMS opt-in, no web push.

### 1.2 The reveal job and notifications

Now
- `scheduleReveal` queues a pg-boss "reveal" job at `endsAt` and at `revealTime(settings)`
  (`apps/api/src/reveal.ts:84-93`). Each job runs `advance` (`:60-81`): row lock, `dueState`
  (`packages/core/src/events.ts:48-66`), sets `revealedAt` on the flip, queues the archive check
  90 days out (`reveal.ts:76-77`), then `notifyReveal`.
- `revealOverdue` sweeps live/ended and 90-day-old revealed events after downtime (`reveal.ts:96-113`).
- `notifyReveal` (`reveal.ts:31-54`): distinct Expo tokens for the host plus every guest device of
  the event; title = event title, body "The photos are ready.", `data: { url: /e/<code>, code }`.
  Skipped with a log line when `EXPO_ACCESS_TOKEN` is unset (`:13-16`). Ticket errors are logged,
  receipts are never checked, dead tokens are never pruned.
- Tapping either notification: `useRevealLinks` (`event.tsx:240-257`) pushes `/e/<code>`. On cold
  start it calls `getLastNotificationResponse()` once (`:253`) and never clears it; worth checking
  whether a later cold start re-opens the same event (Expo keeps the last response; SDK 58 has a
  clear call). For a guest the stack under the event is the signed-out Welcome screen
  (`apps/app/src/home.tsx:41-44`), so Back lands on "Continue with email".
- Foreground: the handler shows a banner even when the person is already on that event
  (`event.tsx:194-203`).

Rough or missing
- Scratchpad notification copy is richer: "<short title>: the photos are ready. 4,293 moments from
  203 people." (`index.html:439-441`). The server knows both numbers at reveal time; the local
  notification cannot.
- Once push is enabled, devices get two banners (local at `revealsAt`, push at the flip). Needs a
  dedupe rule (for example: a registered device cancels its local reminder, or both use the same
  thread/collapse id and the push replaces it).
- The local trigger uses the device clock and the device's tz data. Plan Results phase 7 recorded
  an hour mismatch on the simulator for Vancouver; the trigger is an absolute instant, so that
  case is fine, but it fires before the server flip by the job latency, so the tap opens a
  "developing, 0m" screen until the next 30 s poll.
- Only one notification in the whole lifecycle. Nothing after the reveal (likes on your photos,
  "the recap is ready", "you haven't saved your 14 photos", the archive warning).

### 1.3 The reveal moment

Now (`event.tsx:379-391`, `:621-683`)
- Shown when the gallery returns photos, the event counts as revealed, at least one item is loaded
  and `moment:<code>` is not set in MMKV (localStorage on web). Host and guests both get it, once
  per device per event.
- "It's all here." / "N moments, M photographers." / button "See every moment" (`copy.ts:205-208`),
  matching the scratchpad (`index.html:442-444`).
- Three cards from `items[0..2]`, i.e. the three earliest photos by `takenAt` (gallery order is
  `takenAt asc`, `apps/api/src/shots.ts:352`), using 512 px thumbs (`event.tsx:675`). Tapping the
  button fans them (900 ms, overshoot bezier, `:657`) and after 1300 ms swaps the whole screen for
  the gallery with no transition (`:658`, `:385-388`).
- No haptic, no sound, no back or skip control, no way to see it again.
- When the flip happens while the screen is open, the moment replaces the developing grid on the
  next poll (`:336-341`), which is the right instinct.
- Right-away events show the moment only after the camera closes (`:375-376`), over photos people
  have already seen.

Rough or missing
- The three earliest photos are usually the dullest (test shots, arrivals). The hero card should
  be chosen: spread across photographers and the timeline, prefer the host's own shots or the
  cover, or let the host pin "the reveal photo" while the event is developing.
- The moment ends in a hard cut. It should hand off to the grid (cards settle into the first tiles,
  or the grid fades up under them) so it reads as one gesture.
- No sense of "everyone is seeing this now": no count of people who have opened it, no "Sofia and
  12 others are looking", nothing shared.
- Plan Results phase 7 notes the moment was never compared on device. It still needs a QA pass on
  a fresh device (`moment:EMMADN` cleared).

### 1.4 The event screen once revealed

Now
- Cover and title unchanged from before the reveal (host's cover photo) (`event.tsx:444-456`).
- Stats: Moments (`first.total`, includes hidden photos for the host), "Revealed" over
  `dayLabel(revealsAt)` = Today / Yesterday / "14 June" (`:393-394`, `copy.ts:384-392`), People ›
  opens the sheet. Matches the scratchpad (`index.html:387`). For right-away events the day shown
  is the start, since `revealsAt` = `startsAt`.
- Actions row: primary white button becomes an icon-only play button for "Watch the recap"
  (`event.tsx:428-440`, label only as accessibility); QR still opens the invite sheet (`:475-479`);
  download saves all (`:480-487`). The scratchpad keeps the camera icon on the revealed gallery
  (`index.html:388`), so the play icon is a deliberate change but undiscoverable without a label.
- After the reveal new people can't join (`apps/api/src/events.ts:191-194`, `:346`), so the QR and
  "Share link" in the invite sheet now lead others to a dead end.
- Grid: two columns, 3:4 tiles, photographer name in serif italic in the corner
  (`apps/app/src/ui.tsx:956-960`), chronological oldest first, 30 per page, infinite scroll
  (`event.tsx:541-594`, `apps/api/src/shots.ts:64`). No sections, no time markers, no "mine",
  no "most loved", no hidden badge on tiles for the host.
- Roll filter: People sheet → tap a person → "<name>'s roll" / "Show everyone" (`event.tsx:400`,
  `:512-521`). It filters only the pages already loaded, client side; there is no `guest` filter on
  the gallery API. A person whose photos are on unloaded pages shows a partial roll.
- The viewer opened from a roll pages through the whole gallery, not the roll (`photo.tsx:44-46`).
- Pull to refresh reloads everything; there is no polling after the reveal (except right-away
  while shooting), so new likes and late uploads (allowed for 60 min after the end,
  `packages/core/src/shots.ts:134-149`) only appear on refresh.

### 1.5 People

Now (`event.tsx:687-795`, API `apps/api/src/events.ts:372-395`)
- Sorted by shot count, then join time. Each row: face (their first loaded photo's thumb, or an
  initial), name, "Joined 21:14", count in serif italic.
- Counts are `uploaded + developed` including hidden photos (`events.ts:41`, `:384`), so the number
  can exceed what the roll shows. Visibility `host-only` is not applied: guests still see everyone's
  names and counts (acceptable, but undecided).
- Scratchpad rows carry a role line ("Host", "Bride's side", "Guest") instead of the join time
  (`index.html:453-454`). The host is not marked at all today, and a host who never joined as a
  guest is absent from the list.

### 1.6 The photo viewer (`apps/app/src/photo.tsx`)

Now
- Horizontal paging `FlatList` over `gallery.items`, loads more at the end (`:137-156`).
- Top: back, "N of total" (`:166-168`), then host: hide/unhide (no confirm) or guest: report, then
  share (`:169-195`). The scratchpad top bar is back, position, share only (`index.html:446-448`).
- Bottom: photographer name in 32 pt serif italic, "time, look" (`:198-205`), "Hidden from guests"
  in Candle for the host (`:206-210`), like (optimistic, rolled back on error, `:94-103`) and Save
  (`:105-115`). Toast-like note for 2.6 s (`:59-63`).
- Image: portrait photos use `contentFit="cover"` (`:252`). A 3:4 photo on a 402x874 screen loses
  roughly a third of its width; landscape uses contain. Photos are cropped in the one place people
  look at them properly.
- No pinch or double-tap zoom, no double-tap to like, no swipe down to close, no tap to hide chrome,
  no keyboard arrows on web.
- Share downloads the full photo first (`apps/app/src/save.ts:26-29`) with no loading state.
- Report: confirm, then "Thanks. The photo has been reported." (`photo.tsx:117-124`). The confirm
  copy says "The host will be told." (`copy.ts:218-219`); nothing tells the host
  (`apps/api/src/shots.ts:487-512` only logs when the threshold hides it). The host can't see
  report counts either (`GalleryItem` has no `reports`, `packages/core/src/shots.ts:27-39`).
- The photographer's name is not a link to their roll. A guest can't delete or hide their own
  photo (terms say so, `apps/site/src/pages/terms.md:37`).

### 1.7 The recap (`apps/app/src/recap.tsx`)

Now
- Loads the first page, then every page (`:50-54`, `loadWholeGallery` up to 200 pages,
  `event.tsx:147-155`), and picks the 12 most liked, ties broken by earliest, played in time order
  (`recap.tsx:31-36`). 5 s per slide with a slow 1.0 → 1.12 zoom (`:193-218`), story bars
  (`:119-132`), tap left third back / elsewhere forward, hold to pause (`:107-117`).
- Title overlay stays on every slide with "The whole night in N seconds" (`:146-153`). Buttons:
  "Save photo" (saves the slide on screen) and "Share" (shares the join link with "The photos from
  {title} are on Linger") (`:159-187`). Scratchpad: "Save video" and Share (`index.html:449-452`);
  plan Results phase 4 records the swap to "Save photo".
- Recap screen is a full-screen modal with a fade (`_layout.tsx:56-59`).

Rough or missing
- `slides` is recomputed on every render while the remaining pages stream in, so on a large event
  the slide set and order change under the player and `key={slide.id}` jumps mid-play. It also
  signs every photo URL in the event (4,000 photos = 134 requests, 8,000 presigns) to choose 12.
- On reveal day nobody has liked anything, so the recap is the first 12 photos taken. The most
  likely moment to watch it is the worst moment for this selection.
- No photographer credit per slide, no ending card, no replay, no music, no export. Sharing the
  join link sends non-members to a join sheet that refuses them.

### 1.8 Download all

Now (`event.tsx:410-426`, `:480-497`; `apps/app/src/save.ts:14-23`; `save.web.ts:10-20`)
- Loads every page, then saves one photo at a time, "Saving N of M", ending "N photos saved to
  Photos". Each save re-requests permission and downloads the 2048 px JPEG to cache.
- Stops at the first failure without saying why (`event.tsx:420-422`); the final line then reports
  a partial count as if it were done. No cancel. Leaving the screen doesn't stop it.
- No album: photos land loose in the camera roll among the person's own.
- The host's run includes hidden photos. Signed URLs live 1 h (`apps/api/src/storage.ts:33`); a
  save started from a gallery loaded more than an hour earlier fails on the old URLs (see 1.10).
- Web: one `<a download>` per photo; mobile Safari puts them in Files, desktop browsers block or
  prompt after the first few. No zip.
- Originals are deleted after developing (plan Results phase 8), so the best anyone can get is the
  2048 px developed JPEG at q85. That is a product decision worth stating to hosts (weddings).

### 1.9 Archived

Now
- `revealed → archived` 90 days after `revealedAt` (`packages/core/src/events.ts:26-27`,
  `:63-66`; job queued at `apps/api/src/reveal.ts:76-77`).
- Archived behaves exactly like revealed for photos (`packages/core/src/shots.ts:91-93`), join
  (`apps/app/src/join.tsx:26`) and the event screen (`event.tsx:376`). Nothing is deleted or
  downsized. The host's card shows "Archived" (`copy.ts:53`). No settings can change
  (`packages/core/src/events.ts:147`).
- Privacy says events and photos stay until the host deletes their account
  (`apps/site/src/pages/privacy.md:76`). There is no per-event delete for hosts.

So "archived" is a label with no consequence. It needs a decision (section 3).

### 1.10 Cross-cutting: signed URLs and caching

- Every gallery page returns fresh presigned URLs valid for 1 h (`apps/api/src/shots.ts:357-358`,
  `apps/api/src/storage.ts:33`, `:61-64`). The gallery store is kept in memory per code
  (`event.tsx:85-91`) and is not refreshed after the reveal, so a screen left open for over an hour
  (or the app resumed next morning) shows broken images on scroll, and viewer save/share and
  download all fail with "The photo couldn't be saved."
- `expo-image` caches by URL; the URL changes on every fetch, so nothing is reused between visits
  and every revisit re-downloads every thumbnail. No `cacheKey` is set anywhere in `apps/app/src`.
  Should: stable `cacheKey` = shot id (+ size), and refresh the gallery on focus or when the oldest
  URL is near expiry.

### 1.11 Hosts, guests, web guests

| | Host (app) | Guest (app) | Guest (web) |
| --- | --- | --- | --- |
| Finds the event later | "Your events" list (`home.tsx:260-330`) | Only the notification or the original link; no list of joined events (`home.tsx:41-44` shows Welcome) | Only the original link in the same browser |
| Identity | Session | Device id in MMKV (`apps/app/src/api.ts:88-101`), not Keychain: reinstall = locked out after the reveal | localStorage: new browser or cleared data = locked out after the reveal |
| Reveal notice | Local + push (when enabled) | Local + push (when enabled) | None |
| Sees hidden photos | Yes, viewer label only | No | No |
| Moderation | Hide/unhide, no report counts, no queue | Report | Report |
| Moment | Once per device | Once per device | Once per browser |

The lock-out row matters most: after the reveal `join` refuses new devices (`events.ts:191-194`),
so a guest who changes phone, reinstalls, or opens the link in a different browser can never see
the photos they took.

---

## 2. What the reveal should feel like

Three beats, each needing its own care.

**Anticipation (from camera close to the reveal).** The event screen should feel like a darkroom:
the count and the photographers visible, the developing tiles varying (photographer initials or
names on the blur are not secret), a countdown that becomes live in the last hour and ticks in the
last minute, and a gentle "camera closes in 30 minutes" / "camera closed, 212 moments developing,
reveal tomorrow at 10:00" pair of notifications. Every guest, including web guests, leaves the
event with a way to be told: notifications in the app, and on the web an "Add to calendar" file
and an optional "email me when they're ready".

**The moment.** At the reveal everyone is told at once with the real numbers ("Maya turns thirty:
the photos are ready. 612 moments from 34 people."). Opening it, whether from the banner, the lock
screen or a screen already open, lands on "It's all here." within a second or two, never on a
"0m To reveal" developing grid. The three cards are chosen, not the first three. The fan has a
haptic and hands off into the grid in one continuous motion. The first screen after it could
start with "Your photos" (the guest's own roll, what they most want to see) before everyone's.

**Revisiting.** Days and months later the event is easy to find (a guest list of joined events,
not just the host's), loads fast (cached thumbs), and has structure: highlights (most loved), by
person, by hour, mine, liked by me. Saving is one action that puts the event in its own album.
The recap is a real highlight reel from the first viewing, credits who took each shot, and has an
ending. Sharing either shares the photo itself or a link that actually opens for the person it's
sent to. Archive means something people were told about in advance.

---

## 3. Gaps, ranked

P0: breaks the promise or loses people's photos
1. **Guests get locked out after the reveal on a new device or browser.** Device id lives in MMKV
   / localStorage and post-reveal joins are refused. Needs a recovery path: Keychain-backed device
   id on iOS, and a claim mechanism (for example a per-guest link or code shown at join and in the
   reminder, or email capture) so a guest can get back to their event. Decide whether a member can
   share a view link with non-members.
2. **Web guests are never told the photos are ready.** No reminder, no push, no email. Add an
   .ics "Add to calendar" at join and on the event screen, and an optional email opt-in at join
   that the reveal job mails. (Web push is limited to installed web apps on iOS.)
3. **Push is effectively off.** No EAS project id, so no device registers (`event.tsx:206-209`).
   Everyone relies on a local reminder scheduled only if the event screen was opened, which goes
   stale when the reveal moves. Set up the project id, prune bad tokens from receipts, and dedupe
   against the local reminder.
4. **Signed URLs expire under an open or resumed gallery.** Broken images and failed saves after an
   hour (1.10). Refresh on focus/resume and before save-all; set `cacheKey` per shot.
5. **Viewer crops portrait photos** (`photo.tsx:252`). Use contain on a blurred or Night backdrop,
   with pinch and double-tap zoom.

P1: the reveal doesn't land as an event
6. Land on the moment, not on "0m To reveal": schedule a refresh at `revealsAt` (+ a few seconds)
   and poll every few seconds in the last minute, instead of a flat 30 s (`event.tsx:270`, `:323`).
7. Choose the moment's three cards deliberately (different photographers, spread over the night,
   or a host-pinned photo) instead of `items[0..2]`; use the full-size URL for the front card.
8. Make the moment one motion: haptic on the fan, cards settle into the grid, no hard cut at
   1300 ms (`event.tsx:658`).
9. Richer reveal notification with counts from the server (`reveal.ts:41-43`), matching the
   scratchpad line; same copy for the Live Activity's stale state where possible.
10. Recap: a server "highlights" selection (one call, stable list) instead of loading every page;
    on reveal day, when there are no likes, spread picks across photographers and time; credit the
    photographer per slide; an end card with replay and share; fix the slide set changing during
    playback (`recap.tsx:56`).
11. Notify the host about reports (the copy already promises it, `copy.ts:218-219`), show report
    counts and a "Hidden" badge on host tiles, and a small review list.
12. After the reveal, change the QR action into "share the photos" and fix the share targets: the
    recap and invite links currently send non-members to a join sheet that refuses them.
13. Label the recap action (the icon-only play button reads as video controls), or restore the
    scratchpad layout with the recap as a labelled row under the actions.

P2: revisiting and polish
14. A guest's "Your events" list on the app home, built from the events this device joined, with
    the host list for signed-in hosts. Today a guest's app home is the sign-in screen.
15. Server-side roll filter (`?guest=`) so a person's roll is complete, and the viewer pages within
    the roll it was opened from. Photographer name in the viewer opens their roll.
16. Gallery structure: "Yours" first after the reveal, highlights, by hour markers, liked by me.
17. Download all into an album named after the event, with an error line when it stops, a cancel,
    and a zip on the web. Say plainly that photos are kept at 2048 px.
18. Viewer polish from the scratchpad: top bar back, position, share only (move report/hide to a
    "more" menu or the bottom), swipe down to close, tap to hide chrome, double-tap to like,
    loading state on share.
19. People rows: mark the host, decide what the second line says (role vs joined time), count only
    visible photos.
20. Post-reveal notifications: "N people loved your photos", recap ready, a reminder to save before
    any archive change, and an anniversary nudge if wanted.

Decisions needed before planning
- **Archive.** Either drop the state, or make it real: for example originals are already gone, so
  archive could mean "thumbnails and developed photos kept, download stays open, the event moves
  to a Past section", with a notice to members before it happens. Privacy currently promises
  retention until account deletion; whatever is chosen has to match it. Hosts also have no way to
  delete one event.
- **Who can see the photos after the reveal.** Members only (today) vs a host-controlled view link
  for people who weren't there. This decides what "Share" means in the recap and the invite sheet.
- **Does the host see the moment and the photos at the same instant as guests.** Today yes; keep
  it (the design says hosts get no exception).
- **Recap as video.** "Save video" is in the design; the app renders none. Server-side rendering
  with ffmpeg from the developed JPEGs (Ken Burns, title card, credits) is feasible but new infra.
- **Full resolution.** Keep only 2048 px developed photos, or keep a full-size developed copy for
  paid tiers.

## 4. QA notes for this area

- The moment has never been compared on device (plan Results, phase 7). To see it again on the
  simulator the `moment:<code>` MMKV key has to be cleared (or a new seed code used).
- `apps/app/flows/gallery.yaml` and `apps/app/web.e2e.ts:188` cover "See every moment" → grid →
  viewer → recap; nothing covers download all, report/hide, notifications or the live flip.
- Things to verify by hand that the code suggests may misbehave: cold start after tapping an old
  reveal notification re-opening the event on a later launch (`event.tsx:253`); images after
  leaving the revealed gallery open for over an hour; a roll view on EMMADN before scrolling; the
  recap on an event with more than 30 photos while pages are still loading.
