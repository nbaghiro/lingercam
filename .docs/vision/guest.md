# Guest experience: current state and target

Read-only review, 2026-11-02. Sources: `.docs/architecture.md`, `.docs/plan.md` (Results),
`.docs/qa.md`, the scratchpad `../smallwares/.scratchpad/linger/index.html` (act "Guests shoot" and
"The reveal"), and the code below. Paths are relative to `apps/app` unless they start with
`apps/api` or `packages/core`. Read-only HTTP checks against 8171/8173 only; no simulator, no data
written. "Now" means what the code does today; "Should" is my recommendation.

Severity: **P0** loses photos or strands a guest, **P1** clearly rough for a real wedding or party,
**P2** polish.

---

## 1. The journey as built

```
QR / link ─▶ join.lingercam.app/<code>  (app/[code].tsx redirects to /j/<code>)
          └▶ linger://j/<code>           (native, custom scheme only; no universal link)
                │
                ▼
     Join sheet over blurred cover (src/join.tsx)
       invite ──tap──▶ name ──Continue──▶ camera permission ──Allow──▶
                │
                ▼  router.replace(/e/<code>) then push(/e/<code>/camera)   join.tsx:72-75
     Camera (src/shutter.tsx frame + camera.tsx / camera.web.tsx lens)
       shutter ─▶ capture ─▶ enqueue (src/uploads.ts) ─▶ reserve ─▶ PUT ─▶ confirm ─▶ develop job
                │                └▶ trackShot ─▶ Live Activity (src/activity.ts)
                ▼
     Event screen (src/event.tsx): developing tiles from counts, polls every 30 s
                │  local notification at reveal (native only), push if EAS id exists
                ▼
     Reveal moment once ─▶ gallery ─▶ photo / recap
```

API behind it: `GET /v1/e/:code` (summary), `POST /v1/e/:code/join`, `GET /v1/e/:code/me`,
`POST /v1/e/:code/shots` (reserve), `POST /v1/shots/:id/confirm`, `GET /v1/e/:code/gallery`
(counts before the reveal), `GET /v1/e/:code/people`, `POST /v1/push`.

---

## 2. Entry: links, QR, codes

**Now**
- Printed QR and share link: `joinLink()` gives `${JOIN_URL}/j/<code>` in dev and
  `https://join.lingercam.app/<code>` in prod (`src/api.ts:18-20`). `app/[code].tsx:4-7` redirects
  `/<code>` to `/j/<code>`.
- Native deep link is the custom scheme `linger://j/<code>` only. `app.config.ts:19-24` has no
  `associatedDomains`, and `apps/app/public/` does not exist (architecture.md:78 lists
  `public/.well-known`). `GET :8173/.well-known/apple-app-site-association` returns the SPA HTML
  with 200. So an iPhone guest who has the app installed and scans the printed QR lands in Safari,
  not the app.
- No App Clip (plan.md Results, phase 9: over 15 MB). The scratchpad's join screen is captioned
  "App Clip, no install", so every iPhone guest without the app is on the web path.
- Web build is `output: "single"` (`app.config.ts:35`): served HTML has `<title>Linger</title>`, no
  Open Graph tags, no `viewport-fit=cover`, no event title or cover (checked with curl on
  `/j/MAYA3X`). A link shared in WhatsApp or iMessage previews as a bare "Linger".
- There is no way to type a code anywhere. Native home for a signed-out user is the host welcome
  (`src/home.tsx:41-45`); web `/` is "Hosting happens in the app" (`home.tsx:552-578`).
  `normalizeJoinCode` exists in core (`packages/core/src/events.ts:270`) but no screen takes input.

**Should**
- Universal links for `join.lingercam.app` (AASA + `associatedDomains`), so the QR opens the app
  when installed and the browser otherwise.
- Per-event link previews: a tiny server route (or static rewrite at the edge) that serves
  `og:title` "You're invited to shoot Maya turns thirty", `og:image` the cover, before the SPA.
- A "Have a code?" entry on the native welcome and on web `/`, six boxes, auto-advance, paste
  aware. Covers the guest whose camera app won't read the QR or who was told the code.

---

## 3. Join sheet (`src/join.tsx`)

**Now, invite step** (`join.tsx:111-149`)
- Full-bleed cover blurred 4 px, scale 1.08, 45% Night dim (`:219-227`, `:245-246`). Sheet: radius
  52, Raised colour, grab bar (decorative only, `:234`), cover image 220 pt tall (`:267`), mark +
  "Linger" byline (`:129-134`), "You're invited to shoot {title}" heading, rules line, CTA.
- Rules copy (`:24-35`, `copy.ts:138-142,156-157`): "24 shots each. Photos appear tomorrow at
  10:00." matches the scratchpad exactly. Variants for unlimited, right-away, ended, revealed.
- CTA is "Open camera" with camera icon while shooting, else "See the photos" (`:142-147`).
  Disabled for draft, full (when not joined), or while `me` loads.
- Loading: a centred `ActivityIndicator` inside the sheet (`:109`). Error: `Notice` + "Try again"
  (`:103-107`), mapped by `joinProblem` (`:37-50`): event-full, not-open, not-found, network.
- Animation: each step fades in over 220 ms (`:233`). No haptics anywhere in join.

**Now, name step** (`:150-185`)
- "What should we call you?", body "Your name goes on every photo you take, so everyone knows who
  took it." Field prefilled from the last name used on this device (`NAME_KEY`) or the signed-in
  host's name (`:62`). `autoFocus`, `given-name`, return key "go" submits. Continue shows a spinner
  (`join.busy`).
- On success: stores the name, seeds `shotsLeft` (`:88-89`), then camera step or straight in.
- No back control to the invite step, no way to dismiss the sheet.

**Now, camera step** (`:186-215`)
- Duotone camera icon, "Allow the camera", body `join.cameraBody`. "Allow camera" calls the OS
  prompt. Native and denied for good: "Open Settings" (`:201-202`) but the body still reads "Linger
  needs the camera ... You can change this in Settings at any time" instead of `camera.denied`.
  Web and denied: `camera.webDenied` and "Try again" (`:197-199`).
- `useCameraAccess` native (`src/camera.tsx:68-79`): no camera device (simulator) counts as granted.
  Web (`src/camera.web.tsx:33-71`): `navigator.permissions` where supported; where it isn't
  (`granted` false), the guest always sees the camera step, then `request()` opens and closes a
  stream, then the camera screen opens a second one. Safari may prompt twice.

**Rough or missing**
- **P0, dead end after the reveal for a new device.** A revealed event's sheet says "The camera has
  closed and the photos are ready" with "See the photos" enabled (`:142-147`). Tapping leads to the
  name step; `POST /join` then fails with `not-open` because only `live` and `ended` admit new
  guests (`apps/api/src/events.ts:194,346-348`), and the sheet shows "This event isn't open to
  guests right now." This is the normal case for a guest who joined in Instagram's in-app browser
  and opens the reveal in Safari, or who changed phones. Should: say so on the invite step ("These
  photos are for the people who were there") and offer recovery (see section 10).
- **P1, returning guest is asked again.** Every rescan shows invite then (if not joined on this
  device) name. A guest who has a stored name could get one button: "Join as Sam" with a small
  "Not Sam?" link. Saves one screen at the table.
- **P1, draft or full doesn't move.** No polling; if the host goes live or upgrades while the guest
  waits, nothing changes until "Try again" (which only appears on errors, not on draft/full).
- **P2.** `hostName` is in the summary (`events.ts:150`) but unused; the scratchpad shows "Linger",
  so this matches design, but "Alex invited you" is warmer and helps trust on a stranger's QR.
- **P2.** Grab bar implies a swipe-down that does nothing.
- **P2.** Camera step body on native when blocked should use `camera.denied`.

---

## 4. Camera (`src/shutter.tsx`, `src/camera.tsx`, `src/camera.web.tsx`)

**Now, layout** (matches scratchpad "The camera")
- Top bar: back (`:133-137`), title + "{time} left" (`:138-147`, refreshed every 30 s by
  `useCameraEvent` `:69-72`), QR button opening `InviteSheet` (`:148-153`, `:279-286`).
- Viewfinder: rounded 28, margin 12 (`:406-412`). White blink 0.85 then fade 260 ms on shutter
  (`:111-113`).
- Tools row: flash, zoom pill 0.5 / 1x, flip (`:209-237`). Flash and flip dim to 0.35 when
  unavailable. Zoom shows a static "1x" chip when the device has no ultra-wide (`:307-318`).
- Bottom: rolling counter (`:350-394`), shutter 84 pt (`:467-476`), last-shot thumbnail 62 pt
  (`:477-485`) which, when tapped, leaves to the event.

**Now, behaviour**
- `shoot()` (`:104-128`): guards on busy, closed, out, blocked; Medium impact haptic (native only);
  blink; capture; `enqueue`; set thumbnail; `trackShot` for the Live Activity. Shutter is disabled
  while a capture is in flight, so rapid bursts are throttled to capture speed.
- Native lens (`camera.tsx:95-194`): VisionCamera 5, `QHD_4_3`, JPEG q0.85; back camera prefers
  ultra-wide + wide; flash only `on`/`off` (`:170`); file moved into `Documents/uploads`
  (`:81-93`). Preview is plain, no film look (plan.md Results phase 4). Sample photos through
  the look when there's no camera in dev (`:118-134`).
- Web lens (`camera.web.tsx:97-232`): `getUserMedia` ideal 2048, `<video>` with the look as a CSS
  filter (`look.web.tsx:6-10`), front camera mirrored in preview only (`:192`), capture from the
  video frame via canvas at max 1600 px, JPEG 0.85 data URL (`:73-82`). Torch where the track
  supports it (Android Chrome), never on iOS Safari. No zoom.
- Covers inside the viewfinder (`:169-204`): closed ("This event has ended, so the camera is
  closed." + "See the event"), out of shots (section 5), blocked permission, and load failure
  (`join.loadFailed` Notice).
- Capture failure: `camera.failed` Notice between viewfinder and tools (`:207`), which shifts the
  layout until the next shot.

**Rough or missing**
- **P0, no shooting without signal on open.** `open` needs `summary` from the network
  (`shutter.tsx:95-96`, `useLoad` has no cache, `api.ts:359-390`). A guest who opens the camera in
  a basement hall with no signal gets the load-failed cover, and that cover has no retry button
  (`:200-204`). The queue was built for bad signal, but the camera can't start without it. Should:
  persist the last summary and `me` per code in MMKV, render from cache, revalidate in background,
  and decide `open` from cached `endsAt` + state.
- **P1, dark rooms.** Flash is on/off, default off, and forgotten between sessions. No auto, no
  front "screen flash" for selfies (front `hasFlash` is false so the button dims), no low-light
  hint. Weddings and parties are dark; the disposable-camera feel the product sells is flash. Should:
  default to auto on the back camera, remember the choice per device, add a front screen flash
  (white overlay at full brightness during capture).
- **P1, screen sleeps.** No keep-awake anywhere (grep for `KeepAwake` finds nothing). A guest
  waiting for the cake gets a dimmed, then locked phone. Should: `expo-keep-awake` while the camera
  is focused, and `navigator.wakeLock` on web.
- **P1, live look missing on native** (known gap). The scratchpad viewfinder shows the warm film
  (`f-warm`). The web shows a CSS approximation that differs from the server render, so the web
  preview and the developed photo disagree. Should: Skia frame processor on native; on web, a
  WebGL pass with `FILM_SHADER` or at least CSS tuned against `applyLook` output.
- **P1, one-handed.** No volume-button shutter, no pinch zoom, no tap to focus or exposure. Reach is
  fine (shutter low and centred), but these are expected camera behaviours.
- **P2, counter neighbours.** At a full roll it shows "23 24 25" (`:381-389`); 25 is past the
  allowance. Hide the right neighbour when `left === total`. Also blank while `me` loads with no
  cached value, yet the shutter is live then.
- **P2, last-shot thumbnail** lives in component state (`:88`), so it's empty every time the camera
  reopens. Keep the newest pending uri, or the last captured one, per code.
- **P2, upload status in camera.** Nothing on the camera says photos are waiting or sending. The
  event screen has it (`event.tsx:505-511`). A small Candle dot or ring on the thumbnail while
  `pending > 0` would reassure without breaking the film metaphor.
- **P2, failure Notice shifts the layout** (`:207`). Overlay it in the viewfinder and auto-hide.
- **P2, web front camera**: saved photo is unmirrored while the preview is mirrored. Decide one.
- **P2, sound.** No designed shutter sound on any platform. iOS may play the system sound; web is
  silent. Decide: a soft film-advance sound that respects the ring switch, or none.

---

## 5. Out of shots, closed, unlimited

**Now**
- `out = shots.left === 0` (`shutter.tsx:97`). Cover: "That's your roll" (title) + "You've used
  every shot. The photos appear {when}." + "See the event" (`:176-185`, `copy.ts:165-166`).
  Shutter at 50% and disabled. Not in the scratchpad; tone matches.
- Closed: "This event has ended, so the camera is closed." Checked against device time every 30 s.
- Unlimited: counter shows a serif "∞" (`:375-378`), LA reads "Unlimited shots".

**Rough or missing**
- **P2.** The last shot has no moment: no success haptic, no "Last one" hint at 1 left, and the
  Live Activity keeps showing "0 of 24 shots left" with a full bar rather than "Your roll is done".
- **P2.** When the camera closes while open, the cover just replaces the viewfinder; a guest
  mid-shot gets no notice. A gentle "The camera closes in 10 minutes" in the title line at <10 min
  would help.

---

## 6. Upload queue (`src/uploads.ts`, API `shots.ts:400-462`)

**Now**
- Persisted in MMKV (`QUEUE_KEY`), saved after every step (`:47-55`). Steps: reserve with
  `clientId` so a lost reply returns the same shot (`:121`, API `shots.ts:222-241`), PUT to the
  signed URL (`api.ts:330-344`), confirm, remove and delete the local file (`:62-73`).
- Serial pump (`:167-184`), exponential backoff 2 s to 60 s (`:110-114`), all retries reset when
  the app becomes active (`:193-198`), resumed on launch (`_layout.tsx:32`).
- Reservation expiry (10 min, `RESERVATION_MINUTES`) or 403 on the signed URL starts over with a new
  reservation (`:142-157`).
- Counter is optimistic: `left = knownLeft - unreserved` (`:211-221`).
- Final refusals (`FINAL`, `:31`) drop the photo and bump a per-event failed count shown on the
  event screen as "N photos couldn't be sent because the camera had closed or your shots had run
  out." (`event.tsx:498-504`, `copy.ts:246-247`). Tapping it dismisses.
- Server accepts late photos taken before the end for `LATE_UPLOAD_MINUTES = 60` after it
  (`packages/core/src/shots.ts:134-149`).

**Rough or missing**
- **P0, photos are deleted after an hour offline.** A guest shoots in a dead zone, pockets the
  phone, and opens the app next morning. The reserve returns `not-shooting` (past end + 60 min),
  which is in `FINAL`, so `remove()` deletes the JPEG from the device (`uploads.ts:136-139`,
  `:65-72`). The message then blames the guest ("the camera had closed or your shots had run
  out"). Should: accept any photo whose `takenAt` is before the end until the archive date (the
  reveal can absorb late arrivals, or late photos join with a "late arrivals" note), and never
  delete a local photo the server hasn't taken; at worst save it to the guest's camera roll and say
  so.
- **P0, no background upload on iOS.** Uploads only progress while the app is in the foreground.
  Phones get locked between shots constantly. Should: a background `URLSession` upload task (or
  `expo-background-task` / `BGProcessingTask` best effort), and a reveal-eve nudge if photos are
  still waiting.
- **P1, web queue stores data URLs in localStorage** (`uploads.ts:15-16`, `camera.web.tsx:81`).
  A 1600 px JPEG is roughly 300 KB to 1 MB as base64, so a 5 MB origin quota holds a handful of
  offline photos. `changed()` swallows the quota error (`:48-52`), so a reload loses the rest
  without a word. Should: IndexedDB with Blobs, and a visible warning when storing fails.
- **P1, bandwidth.** Native sends QHD 4:3 (about 2560x1920) at q0.85 (`camera.tsx:103-107`), and
  the server develops to 2048 px (`apps/api/src/shots.ts:60`). Resizing to 2048 on device before
  queueing cuts each upload by roughly a third on venue Wi-Fi.
- **P1, poison entries never leave.** A missing local file makes `fetch(uri)` throw, which is
  classed as `network` and backed off forever. `too-large` (413, `shots.ts:445-447`) isn't handled:
  the original is removed, the next confirm says `not-uploaded`, the client re-uploads the same file
  and loops. Should: cap attempts per cause and surface "1 photo couldn't be read".
- **P2.** No `online` / NetInfo trigger; recovery waits for the next backoff tick (up to 60 s) or
  an app switch.
- **P2.** `retrying` says "Photos will upload when you have signal again." for any failure,
  including server errors.
- **P2.** A develop failure (`shots.ts:146-155`) refunds the shot server side, but the guest is
  never told a photo was lost; the counter just goes up by one on the next `me`.

---

## 7. Event screen as a guest, before the reveal (`src/event.tsx`)

**Now**
- Matches the scratchpad "Before the reveal": cover with title, stats Moments / "6h 10m Left" /
  "People ›" (`:442-456`), action row with icon-only camera CTA, QR, download (`:466-488`), then a
  two-column grid of "Developing" tiles drawn from the blurred cover, capped at 40 with "N more
  developing" (`:401-408`, `:537-553`, `ui.tsx:913-966`).
- Polls the gallery and summary every 30 s while developing (`:323-333`); reloads the gallery each
  time the local queue length changes (`:312-314`). Pull to refresh.
- Upload lines: "N photos waiting to upload" / "Photos will upload when you have signal again." /
  failed count (`:498-511`).
- Empty states: "No photos yet. Open the camera to take the first one.", "No photos were taken
  before the camera closed." (`:522-530`).
- People sheet before the reveal: names, join time, shot counts, rows not tappable (`:687-795`).
- When developing, `remindAtReveal` schedules a local notification and asks permission
  (`:217-237`, `:347-349`).

**Rough or missing**
- **P1, the guest's own roll is invisible here.** The API already returns `mine` in the developing
  page (`apps/api/src/shots.ts:308-317`, `packages/core/src/shots.ts:47`) and the app never reads it
  (grep finds no use). The stats show the whole event; a guest can't see "You took 7, 17 left"
  without opening the camera. Should: a line under the actions, "Your roll: 7 taken, 17 left" (or
  replace the developing grid's first tiles with "yours" in Candle).
- **P1, notification permission arrives with no context, likely on top of the camera.** Join does
  `replace(/e/code)` then `push(/e/code/camera)` (`join.tsx:72-75`), so this screen mounts under
  the camera, loads a developing gallery and calls `requestPermissionsAsync()` (`event.tsx:222`).
  Expect the system prompt to appear right after the camera prompt, mid-shot. Not verified on the
  simulator in this run. Should: ask from a pre-prompt card ("Get a nudge at 10:00 when the photos
  are ready") on the event screen after the first time the guest leaves the camera, or on "That's
  your roll".
- **P2.** Disabled camera CTA after the end is an icon-only grey button (`:440`). A status chip
  "Reveals tomorrow at 10:00" says more.
- **P2.** No back for a guest who arrived by deep link (`:457-465`), and nowhere to go (home is the
  host welcome). Fine for one event, wrong for a guest with two.

---

## 8. Live Activity (`src/activity.ts`, `targets/activity/LingerActivity.swift`, `modules/live-activity`)

**Now**
- Starts on the first photo, updates every photo (`activity.ts:48-63`): title, "9 of 24 shots left",
  Candle bar of used shots, "212 moments so far", reveal phrase ("Reveals at 23:10" under 12 h,
  else "Reveals tomorrow at 10:00", `:38-45`). `staleDate` = reveal, so a stale card reads "The
  photos are ready." and hides the bar (`LingerActivity.swift:92-103`). Dynamic Island compact:
  mark + circular progress. Tap opens `linger://e/<code>` (`:119,167`). Ended when the gallery
  returns photos (`event.tsx:105`) or on launch if past the reveal (`_layout.tsx:33`).
- Scratchpad: "9 of 24 shots left", bar, "212 moments so far", "Reveals tomorrow". Matches.

**Rough or missing**
- **P1, broken for right-away events.** `revealTime` for right-away returns `startsAt`
  (plan.md core contract), so `revealsAt` is already past when the first photo is taken. The
  activity is created stale (`LiveActivityModule.swift:42`), shows "The photos are ready." with no
  bar from the first shot, and `endPast` kills it on the next launch (`:55-60`). Should: for
  right-away, use `endsAt` as the stale date and phrase it "Camera open until 23:00".
- **P1, iOS caps activities at 8 hours active (plus up to 4 on the lock screen).** A wedding that
  starts at 15:00 with a next-morning reveal loses its card overnight, so the "photos are ready"
  stale state is never seen. Should: treat the LA as a shooting companion that ends at `endsAt`
  (or at the 8 h cap), and leave the reveal to notifications; or add ActivityKit push (plan.md
  phase 9 gap) to start a fresh one at the reveal.
- **P2.** "Moments so far" is `max(gallery.total, local count)` fetched per shot
  (`activity.ts:28-36`), so it lags and costs a request per photo. It never moves between the
  guest's own shots.
- **P2.** Doesn't change when the camera closes or the roll runs out.

---

## 9. Notifications

**Now**
- Local notification at `revealsAt`, title = event title, body "The photos are ready.", data
  `url: /e/<code>` (`event.tsx:226-234`). Skipped on web and for right-away events (`:219`).
- Push token registers only with an EAS project id (`:205-215`); API reveal push uses the same text
  (`apps/api/src/reveal.ts:40-43`) and is skipped locally without `EXPO_ACCESS_TOKEN`.
- Tap handling opens `/e/<code>` (`useRevealLinks`, `event.tsx:240-257`).

**Rough or missing**
- **P0, web guests never hear about the reveal.** With no App Clip and no universal link, most
  iPhone and many Android guests are browser guests. They get no notification, no email, no SMS.
  The product promise ("everyone gets a notification") breaks for them. Should: optional "Tell me
  when the photos are ready" on the web after the first shot or on "That's your roll", by email
  (Mailpit locally, already wired for hosts) or Web Push where available (Android Chrome; iOS only
  for home-screen web apps). The email link should carry a guest token so it also restores identity
  (section 10).
- **P1, copy is thinner than the design.** Scratchpad: "Emma & Daniel's Wedding: the photos are
  ready. 4,293 moments from 203 people." Code: title only + "The photos are ready." The local one
  can't know counts at schedule time, but the push can.
- **P1, double notification once push works.** The local reminder and the server push will both
  fire at the reveal. Cancel the local one when a push token is stored, or keep only one channel.
- **P2.** Right-away events get nothing; a single "Photos are coming in" after the first developed
  batch, or nothing, should be a decision rather than an omission.

---

## 10. Identity and return visits

**Now**
- A guest is `X-Device` (random id in MMKV, `api.ts:96-104`), per event. On web MMKV is
  localStorage. The name is per device.
- Native: relaunching the app shows the host welcome (`home.tsx:41-45`). There is no list of events
  this device joined. The only ways back are the QR, the Live Activity, or a notification.
- Web: `/` is the host note. Closing the tab means rescanning.

**Rough or missing**
- **P0, a guest can't get back to their event.** Should: a guest home. On native, signed out:
  "Your events" from the joined codes kept in MMKV (title, state, reveal time, pending uploads),
  above the host welcome. On web `/`: the same list from localStorage plus "Have a code?".
- **P1, identity is tied to one browser.** In-app browsers (Instagram, WhatsApp, the iOS camera's
  QR sheet opening Safari vs Chrome) each get a new device id. After the reveal a second browser is
  refused (section 3). Safari also clears script-written storage after 7 days without a visit.
  Should: a recovery path that keeps "no account": an emailed magic link (same as the reveal email),
  or a short guest PIN shown on "That's your roll", which re-binds a new device to the guest row.

---

## 11. Guest web app specifics

- Host routes show "Hosting happens in the app" with two buttons that both go to `SITE_URL`
  (`home.tsx:567-573`), not to store listings (known: no listing yet).
- No PWA manifest beyond Expo defaults, no `apple-mobile-web-app-capable`, no `viewport-fit=cover`.
  Verify on iOS 26 Safari that the shutter row clears the floating toolbar; insets are 0 without
  `viewport-fit=cover` (`shutter.tsx:239` pads `max(inset, 12) + 12`).
- Web flash and zoom: torch on Android only, no zoom (`camera.web.tsx:202-213`).
- Web photo quality: frames from a video stream at up to 1600 px, not a still capture. In dim light
  that means motion blur and noise. `ImageCapture.takePhoto()` where supported (Chrome Android)
  gives a real still and flash.
- Web camera keeps running while the tab is hidden until the route unmounts (`camera.web.tsx:108-
  142`); pausing on `visibilitychange` saves battery.

---

## 12. Cross-cutting

**Haptics**: only the shutter, Medium impact, native only (`shutter.tsx:108-110`). Missing: join
success (light success), permission granted, last shot (warning), roll done (success), reveal moment
fan (soft), zoom/flash toggles (selection).

**Animation**: join step fade 220 ms, shutter blink, counter roll 260 ms, reveal fan 900 ms. None
of it reads Reduce Motion (no `useReducedMotion` anywhere). The white blink is the main one to
soften under Reduce Motion.

**Accessibility**: buttons are labelled (shutter "Take photo", counter label "N shots left",
thumbnail "See the event"). Missing: an announcement after each shot ("17 shots left") via
`AccessibilityInfo.announceForAccessibility` or a live region; flash label is "Flash on"/"Flash off"
as the name rather than a toggle state (`shutter.tsx:214`); no font scaling limits on the counter
and camera title, which will clip at large Dynamic Type; developing tiles each read "Developing"
(40 identical stops for VoiceOver), better as one summary element.

**Copy**: consistent with the design voice. Fixes: blocked camera body on native
(`join.tsx:197-199`), failed-uploads line blames the guest (`copy.ts:246-247`), revealed-event
invite promises "See the photos" to people who can't (`copy.ts:157-158`).

**Clock**: shooting window and countdowns use device time (`shutter.tsx:59-72`); a phone with a
wrong clock shows wrong "left" times and may disable the shutter while the server would accept.
Using a server time offset from the summary response `Date` header is cheap.

---

## 13. The target guest experience

What a guest at a real wedding or party should get, with no account, one hand, in the dark, on bad
signal:

1. **Scan, one tap, shooting in under 10 seconds.** QR opens the app if installed (universal link),
   otherwise the browser with a rich preview. Invite sheet shows the host's name, the rules line
   and one button. Returning devices skip the name step ("Join as Sam"). Camera permission is
   asked with the system prompt directly from that button; notifications are not asked yet.
2. **A camera that works in the room it's in.** Live film look in the viewfinder on both platforms,
   flash on auto by default and remembered, front screen flash, screen kept awake, volume-button
   shutter, pinch and 0.5/1/2. The counter rolls with a haptic; the last shot gives a warning tick;
   the final shot gives a success haptic and "That's your roll".
3. **Nothing is ever lost.** Every photo is safe on the device the moment the shutter fires. The
   camera opens from cache with no signal. Uploads continue in the background and after restarts.
   The server accepts any photo taken before the end until the event is archived. A small Candle
   dot on the thumbnail shows photos still sending; the event screen says "2 photos waiting, they'll
   send when you have signal".
4. **Developing is a feeling, not a void.** The event screen shows the guest's own roll ("You took
   7") alongside the room's count, a reveal countdown, and a single pre-prompt to be told when the
   photos are ready (native notification, or email / web push on the web).
5. **Lock screen companion while shooting.** Live Activity from the first shot to the end of the
   camera window (not the reveal), correct for right-away events, ends with "Your roll is done" or
   "The camera has closed. Photos at 10:00".
6. **Everyone hears about the reveal**, including browser guests, with the design's copy and
   counts, through one channel per guest, and the link restores the guest even in a different
   browser.
7. **The guest can always find their way back**: a guest home on native and web listing joined
   events, plus "Have a code?".

---

## 14. Gaps ranked

| # | Sev | Gap | Where |
| --- | --- | --- | --- |
| 1 | P0 | Offline photos older than end + 60 min are deleted from the device | `uploads.ts:31,136-139`; `core/shots.ts:134-149` |
| 2 | P0 | Camera can't open without signal (no cached summary), and its error cover has no retry | `shutter.tsx:95-96,200-204`; `api.ts:359-390` |
| 3 | P0 | Web guests get no reveal notification of any kind | `event.tsx:219`; no email/web push path |
| 4 | P0 | No way back for a guest: no joined-events list, no code entry, native home is host welcome | `home.tsx:41-45,552-578` |
| 5 | P0 | New device after the reveal reaches a dead end after typing a name | `join.tsx:142-147`; `api/events.ts:194,346-348` |
| 6 | P0 | No background upload on iOS; uploads stall when the phone locks | `uploads.ts:167-198` |
| 7 | P1 | No universal links / AASA; QR opens Safari even with the app installed | `app.config.ts:19-24`; missing `public/` |
| 8 | P1 | Live Activity created stale for right-away events; 8 h iOS cap hides next-morning reveals | `activity.ts:61`; `LiveActivityModule.swift:42,55-60` |
| 9 | P1 | Dark rooms: flash on/off only, default off, not remembered, no front flash, no keep-awake | `camera.tsx:108,170,178-182`; `shutter.tsx` |
| 10 | P1 | Web offline queue in localStorage overflows silently after a few photos | `uploads.ts:47-52`; `camera.web.tsx:81` |
| 11 | P1 | Guest's own roll (`mine`) never shown on the event screen | `api/shots.ts:308-317`; `event.tsx:442-456` |
| 12 | P1 | Notification permission asked without context, likely over the camera | `event.tsx:222,347-349`; `join.tsx:72-75` |
| 13 | P1 | Live film look absent on native preview; web CSS look differs from the developed photo | `camera.tsx:22-24`; `look.web.tsx:6-10` |
| 14 | P1 | Guest identity bound to one browser; no recovery | `api.ts:96-104` |
| 15 | P1 | Reveal notification copy lacks the design's counts; local + push will double up | `event.tsx:226-234`; `api/reveal.ts:40-43` |
| 16 | P1 | Uploads at full QHD; poison entries (missing file, too-large) retry forever | `camera.tsx:103-107`; `uploads.ts:142-160` |
| 17 | P1 | No link preview (OG) or event title for shared join links | web `output: "single"` |
| 18 | P2 | Haptics only on the shutter; no Reduce Motion; no per-shot VoiceOver announcement | `shutter.tsx:108-113` |
| 19 | P2 | Counter shows a neighbour above the allowance; blank before `me` loads | `shutter.tsx:381-389` |
| 20 | P2 | Last-shot thumbnail and upload status not shown on reopen | `shutter.tsx:88,269-275` |
| 21 | P2 | Returning guests re-enter their name; draft/full sheets don't refresh | `join.tsx:77-81` |
| 22 | P2 | Native blocked-camera copy, failed-upload copy blames guest | `join.tsx:197-199`; `copy.ts:246-247` |
| 23 | P2 | Web: video-frame captures, mirrored preview vs unmirrored photo, camera runs while tab hidden | `camera.web.tsx:73-82,192,108-142` |
| 24 | P2 | Device clock drives shooting window and countdowns | `shutter.tsx:59-72,95-96` |

## 15. Open questions for Naib

- Late photos: accept until archive and add them to the gallery after the reveal, or cut off at the
  reveal and save them to the guest's camera roll?
- Web reveal channel: email (simple, also solves identity) or web push (no address, but iOS only
  from the home screen)? Email seems the better fit for "no account".
- Flash default for the disposable feel: auto, or on?
- Live Activity scope: shooting window only, or keep pursuing the reveal via ActivityKit push?
- Should the native app show a guest home at all, or always land guests on their latest event?
