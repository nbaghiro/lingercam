# Linger build plan

This is the contract the build follows, phase by phase. Each phase ends with checks that must pass
before the next one starts. `architecture.md` holds the rules and the folder map; this file holds
the decisions every part of the code has to agree on.

## Stack and versions

- pnpm 10 workspaces (`apps/*`, `packages/*`), no turbo. Root scripts run `pnpm -r`.
- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Vitest for `core` and `api`.
- API: Node 26, Hono 4, Drizzle ORM 0.45 with `postgres` (postgres.js), zod 4, pg-boss,
  `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, nodemailer, `sharp`. Server-side film
  developing uses `canvaskit-wasm` when the spike passes, otherwise `sharp`.
- App: Expo SDK 58 with the versions pinned in `../smallwares/pnpm-workspace.yaml`
  (expo ~58.0.21, react-native 0.88.1, react 19.3.0, expo-router ~58.0.28, Reanimated 4.7.1,
  worklets 0.13.0, Skia 2.14.0, react-native-purchases 10.16.0, react-native-mmkv 4.3.2,
  expo-notifications ~58.1.7). Plus `react-native-vision-camera` at the version that supports
  SDK 58, `phosphor-react-native`, `expo-image`, `expo-secure-store`, `@expo-google-fonts/newsreader`,
  Pretendard bundled as font files, `react-native-qrcode-svg`. New Architecture, React Compiler on,
  typed routes. Check `https://docs.expo.dev/versions/v58.0.0/` before using an Expo API.
- Site: Astro (current stable), static output.
- Identifiers: bundle id and package `app.galleo.linger`, scheme `linger`, Expo slug `linger`.
- Domains: `lingercam.app` for the site and `join.lingercam.app` for the guest web app. Locally
  these are `http://localhost:8170` and `http://localhost:8173`.

## Brand

- The mark is two circles: an outline on the left and a solid circle overlapping it on the right
  (viewBox 0 0 32 32, outline circle cx 12 cy 16 r 9 stroke 2.2, solid circle cx 20 cy 16 r 9 at
  90% opacity). Source: `brand/mark.svg`.
- Wordmark: "Linger" in Newsreader, weight 400, letter-spacing -0.01em.
- App icon: the mark in Paper (#F3F1EC) on Night (#0D0D0D), centred at about 52% of the canvas.
  1024 px PNG with no transparency. Android adaptive icon foreground and a monochrome layer.
- Splash: the mark on Night. Favicon: SVG plus 32 px ICO and 180 px apple-touch-icon. Social
  image 1200x630: the mark, the wordmark and the hero line on Night.
- Tokens: Night #0D0D0D, Surface #1C1C19, Raised #262622, Paper #F3F1EC, Ash #AAA79F,
  Faint #6D6B65, Candle #E9C99A (the only accent: progress, caret, badges). Serif Newsreader for
  titles, numbers and names; Pretendard for controls; sizes in iOS points as in the scratchpad.
- Icons: Phosphor. Regular for controls, duotone for occasions (duotone layer in the icon colour at
  30%), fill for selected states.
- Placeholder photography: the Pexels set in `../smallwares/.scratchpad/linger/photos`, copied into
  `apps/app/assets/demo` and `apps/site/public/photos` with its CREDITS file.

## Core contract (`packages/core`)

`events.ts`
- `Occasion`: `wedding | birthday | trip | party | everyday`.
- `EventState`: `draft | live | ended | revealed | archived`, with `canTransition(from, to)`.
- `RevealMode`: `right-away | at-end | next-morning | custom`.
- `Visibility`: `everyone | host-only`.
- `EventSettings` zod schema: occasion, title (1 to 60 chars), startsAt, endsAt, timeZone,
  revealMode, revealAt (only for custom), shotsPerGuest (5 to 36, or `null` for unlimited when the
  add-on is bought), visibility, look.
- `Event`, `EventSummary` (what a guest may see before joining) and `Guest` types.
  - `Event` also carries `photoCount` (photos taken, hidden ones included) and `guestCount`
    (guests who joined, not the host), so the host's list can say what matters per state.
  - `EventSummary.state` is the time-driven state from `dueState`, so it reads `revealed` the moment
    the reveal passes. It also carries `viewer` (`SummaryViewer`: `role` host, guest or none,
    `guestId` the viewer's photos are filed under, `shotsTaken`, `shotsLeft`, null when unlimited;
    for "none", the allowance a new guest gets), `photoCount` and `photographerCount` (every photo
    taken before the reveal, after it the photos guests can see), `guestLimit` (the host only, null
    for anyone else) and `now` (the server's clock). `guestCount` and `full` leave the host out.
- `Person`: a row of the people list, `{ id, name, shots, joinedAt, host }`.
- `firstName(name)`: the first word, for developing tiles.
- `GuestEmailRequest` (`{ email }`, null forgets it), `RestoreSendRequest` (`{ email }`) and
  `RestoreRequest` (`{ token, device }`) for the browser guest's email (D2).
- `joinCode()`: 6 characters from an unambiguous alphabet. `JoinRequest`: name (1 to 40) and device.

`reveal.ts`
- `revealTime(settings)`: right-away returns `startsAt`, at-end returns `endsAt`, next-morning
  returns 10:00 on the day after `endsAt` in the event's time zone, custom returns `revealAt`.
- `revealCountdown(now, at, timeZone?)`: how far off the reveal is, as data (a countdown in hours
  and minutes, today, tomorrow, a weekday or a date), which the app phrases as "Reveals in 10h
  18m", "Reveals tomorrow at 10:00" and so on, for screens and the Live Activity.
- `zonesDiffer(at, eventZone, viewerZone)`: whether the two zones show a different clock at that
  instant, so a time in the event's zone needs the zone named for this viewer.

`shots.ts`
- `Shot`, `GalleryItem` and `GalleryPage` schemas. `GalleryItem.reports` is the report count for the
  host and 0 for everyone else. The developing page has `names`: the first name of whoever took
  each photo, in the order taken, at most `PENDING_NAMES` (40). The photos page has `mine`, the
  viewer's own photos within the page's filter.
- `Highlights` (`{ items: GalleryItem[] }`) and `HIGHLIGHT_COUNTS` (moment 3, recap 12).
- `shootingPhase(event, now)`: `before` (a draft, or live before `startsAt`), `open` (live from
  `startsAt` until `endsAt`) or `closed`. `canShoot` is `open`. `ShootingWindow` is
  `{ state, startsAt, endsAt }`, which an `EventSummary` satisfies.
- `canReserve(window & { revealsAt }, takenAt, now)`: any photo while open; after the end, a photo
  taken between the start and the end until `lateUploadsUntil` (`LATE_UPLOAD_DAYS`, 7 days, after
  the reveal, or after the end when the reveal comes first). The allowance still caps it.
- `canSeePhotos(event, viewer, now)`: true only when the event is `revealed`, or the reveal mode is
  right-away and the event is live or later. Hosts get no exception. Visibility `host-only` limits
  revealed photos to the host and the photographer.

`pricing.ts`
- Tiers: free up to 10 guests, $9.99 up to 30, $19.99 up to 80 (marked popular), $34.99 up to 150,
  $49.99 up to 250. Add-on: unlimited shots $9.99. Prices in cents.
- Store product ids: `linger.tier.30`, `linger.tier.80`, `linger.tier.150`, `linger.tier.250`,
  `linger.addon.unlimited` (consumables on both stores).
- `formatPrice(cents, locale = "en-US")`: the amount through `Intl.NumberFormat` in USD, so zero is
  "$0.00". The word "Free" belongs to each app's copy.

`film.ts`
- Looks `natural@1`, `warm-98@1`, `mono@1` with display names Natural, Warm '98, Mono, a one-line
  description each, and parameters: colour matrix (4x5), grain amount, vignette, halation, warmth.
- `FILM_SHADER`: one SkSL runtime effect that applies those parameters. Used by the app preview and
  by the server when developing.

## API contract (`apps/api`)

Base path `/v1`. Hosts authenticate with `Authorization: Bearer <session>`. Guests authenticate
per event with `X-Device: <device id>`, a random id the app stores on first launch. Errors are
JSON `{ code, message }` with codes from the concept that raised them.

| Method and path | Who | Does |
| --- | --- | --- |
| `GET /health` | anyone | Liveness, database and storage check |
| `POST /v1/auth/email/start` | anyone | Sends a 6-digit code (Mailpit locally) |
| `POST /v1/auth/email/verify` | anyone | Returns a session and the host |
| `POST /v1/auth/demo` | development only | Session for the seeded demo host |
| `GET /v1/me`, `DELETE /v1/me` | host | Profile; deletes the host, events, shots and stored files |
| `PATCH /v1/me` | host | Changes the name, also on the host's own rows at their events |
| `GET /v1/events` | host | The host's events, newest first |
| `POST /v1/events` | host | Creates a draft from `EventSettings` |
| `PATCH /v1/events/:id` | host | Edits settings that the current state allows |
| `POST /v1/events/:id/cover` | host | Signed upload URL for the cover photo |
| `DELETE /v1/events/:id/cover` | host | Removes the cover photo |
| `POST /v1/events/:id/live` | host | Goes live on the free tier or a paid one |
| `POST /v1/events/:id/end` | host | Ends early |
| `DELETE /v1/events/:id` | host | Deletes the event, its stored files and queued jobs; 204 |
| `GET /v1/e/:code` | anyone | `EventSummary`, with `viewer` for whoever is asking |
| `GET /v1/joined` | device | `{ events: EventSummary[] }` this device joined as a guest, newest first |
| `GET /v1/e/:code/page` | anyone | The join app's `index.html` with the event's link preview tags |
| `GET /v1/e/:code/calendar.ics` | anyone | One calendar entry at the reveal with the event link |
| `POST /v1/e/:code/join` | guest or host | Creates or returns the guest for this device; the host gets their own row |
| `GET /v1/e/:code/me` | guest or host | `{ guest, shotsLeft, returned }`; `returned` counts photos that failed to develop |
| `GET /v1/e/:code/gallery` | host or guest | Counts and names before the reveal; pages of photos after; `?guest=<id>` for one roll |
| `GET /v1/e/:code/highlights?for=moment\|recap` | host or guest | `Highlights`, signed; `not-revealed` before the reveal |
| `GET /v1/e/:code/people` | host or guest | `{ people: Person[], guestLimit }`, host first |
| `POST /v1/e/:code/email` | guest | `{ email }` for the reveal email; null forgets it; sent at once after the reveal |
| `POST /v1/e/:code/restore/send` | anyone | Emails a fresh link to the guest with that address; always `{ sent: true }` |
| `POST /v1/e/:code/restore` | anyone | `{ token, device }` moves that guest to this device; `{ guest, shotsLeft }` |
| `POST /v1/e/:code/shots` | guest or host | Reserves a shot, returns `{ shotId, uploadUrl, shotsLeft }` |
| `POST /v1/shots/:id/confirm` | guest or host | Marks the upload done and queues developing |
| `POST /v1/shots/:id/like` | host or guest | Toggles a like, after the reveal |
| `POST /v1/shots/:id/report` | host or guest | Reports a photo; three reports hide it and push the host |
| `POST /v1/shots/:id/hide` | host | Hides or unhides a photo |
| `DELETE /v1/shots/:id` | photographer | Removes their own photo after the reveal; the shot isn't given back; 204 |
| `POST /v1/push` | host or guest | Stores an Expo push token |
| `GET /v1/pricing` | anyone | Tiers from core |
| `POST /v1/billing/claim` | host | Verifies a store purchase with RevenueCat and applies it |
| `POST /v1/billing/checkout` | host | Stripe Checkout URL for web hosts |
| `POST /v1/billing/dev-claim` | development only | Applies a tier without a store |
| `POST /v1/billing/webhooks/revenuecat`, `/stripe` | stores | Backstop for claims and refunds |

Rules the tests must prove:

- A guest can never exceed the shot allowance, including with parallel reservations. Reservation is
  one conditional `UPDATE`. Unconfirmed reservations are released after ten minutes.
- Before the reveal, no endpoint returns a photo URL or a thumbnail, for hosts or guests.
- The reveal job moves the event to `revealed` at `revealTime(settings)` and sends notifications.
- Paid tiers raise the guest limit; joining past the limit returns `event-full`.
- `DELETE /v1/me` removes the host's rows and stored objects.
- The host shoots under their own guest row (`guests.is_host`, device `host:<host id>`, which no
  `X-Device` can carry), made with the event. A bearer token for the event's host picks that row on
  every guest route, and it never counts against the guest limit.
- Error codes added: `not-member` (403, joining a revealed event this device never joined),
  `code-locked` (sign-in code with too many wrong tries), `not-revealed` (highlights before the
  reveal), `bad-link` (restore token unknown), `already-joined` (restore onto a device that shot as
  someone else), `not-yours` (removing someone else's photo).
- Pushes. Reveal: "Maya turns thirty: the photos are ready. 612 moments from 34 people." as the
  body, `data { type: "revealed", url, code }`, the same line in the reveal email. Full: "Maya
  turns thirty is full. Make room for more guests." to the host, once per guest limit. Reports:
  "A photo at Maya turns thirty was hidden after reports." to the host. Silent
  (`contentAvailable`, no body) to the host and every guest device: `{ type: "reveal-changed",
  revealsAt, code }` when a PATCH or `/end` moves the reveal, `{ type: "deleted", code }` before a
  delete. Tickets with `DeviceNotRegistered` drop the token at once; the rest are checked against
  Expo's receipts 15 minutes later by the `push-receipts` job.
- The reveal email and the "another device" email link to `/j/<code>?restore=<token>`. Each new
  link replaces the last. The app posts the token to `/restore`.
- `S3_PUBLIC_ENDPOINT` (optional) makes signed URLs point at an address phones on the network can
  reach in development; the API still talks to `S3_ENDPOINT`.
- CORS exposes `Date`, so the web app can read the server's clock.

## App behaviour (`apps/app`)

Screens follow the scratchpad one to one: layout, copy, type sizes in points and icon weights.

- `home.tsx`: signed-out welcome with email sign-in and, in development, "Continue as demo host";
  the host's events as cover cards with state and reveal label; settings with sign-out and account
  deletion.
- `create.tsx`: the five steps from the scratchpad (occasion, name with date and cover, rules, look,
  guests and price), then the invite card with the QR code. Paid tiers go through `purchase`.
- `join.tsx`: the App Clip style sheet, name entry, camera permission.
- `camera.tsx`: VisionCamera with the look applied live through Skia, the rolling shot counter,
  flash, zoom 0.5 and 1x, flip, last-shot thumbnail. With no camera device (the simulator) it uses
  the demo photos. `camera.web.tsx` uses `getUserMedia`.
- `event.tsx`: cover, title, stats, camera, QR and download actions, the developing grid before the
  reveal, the reveal moment once, then the signed gallery; people; invite.
- `photo.tsx`, `recap.tsx` as in the scratchpad.
- `uploads.ts`: a persisted queue in MMKV; retries with backoff; the shot counter is optimistic.
- On the web the app serves guests (join, camera, event, photo). Host screens show a note to use
  the app, with store links.

## Site behaviour (`apps/site`)

The scratchpad page, ported to Astro: hero with three phones and the occasion pills, how it works,
guests, the reveal, pricing from `core/pricing.ts`, FAQ, footer with legal links. Plus pricing,
privacy, terms, support and delete-account pages. Operator: GalleoApp, Inc. Contact:
support@lingercam.app. Legal text is a first draft for a lawyer to review and says so at the top.

## Phases and their checks

1. **Foundations.** Root config, `docker-compose.yml`, `packages/core` complete with tests, `brand/`
   and every generated icon. Check: `pnpm install`, `pnpm check`, `docker compose up -d` healthy.
2. **API.** Every file in `apps/api` with migrations, seed and integration tests against the
   Docker services. Check: `pnpm --filter api test` covers the rules above; `/health` returns 200.
   The server-side developing spike result is written into this file under "Results".
3. **App shell and host screens.** Expo app scaffold, `ui.tsx`, `copy.ts`, `api.ts`, routes,
   `home.tsx`, `create.tsx`, `purchase.ts`, `purchase.web.ts`. Check: typecheck, lint,
   `npx expo export --platform ios` and `--platform web`.
4. **Guest screens.** `join`, `camera`, `camera.web`, `event`, `photo`, `recap`, `uploads`. Same
   checks as phase 3.
5. **Site.** Check: `astro build`, every page renders, links resolve.
6. **Integration.** Everything running together. Playwright drives the web build through a full
   event (host creates through the API, guests join and shoot with a fake camera stream, the reveal
   runs, the gallery shows signed photos). Fix what breaks.
7. **Native.** Dev build on the iPhone 17 Pro simulator. Maestro flows for host sign-in, create,
   camera with the demo photos, and the gallery. Screenshots compared against the scratchpad.
8. **Review.** Independent reviews for the rules in `architecture.md`, correctness, and security
   (the reveal secret, shot limits, auth on every route), then fixes.
9. **Extensions.** App Clip and Live Activity targets, best effort. They must not break the main
   build; if one is not feasible yet, the reason goes under "Results".
10. **Hand-off.** `pnpm check`, the API tests and the web end-to-end run pass. Services running,
    the seeded demo data loaded, the app open on the simulator signed in as the demo host.

## Results

Filled in as phases complete.

- 2026-11-01, phase 1: MinIO no longer publishes Docker images (`minio/minio` pulls are denied), so
  the `storage` service is RustFS, pinned to the digest Clientbridge and Tondo use. Same S3 API on
  8174, console on 8175 at `/rustfs/console/`, buckets and CORS created by `storage-init` (aws-cli).
- 2026-11-01, phase 1: next-morning reveals at 10:00 the day after the end, except an event that
  ends before 04:00 local reveals at 10:00 the same morning (a party ending at 1am reveals 9 hours
  later, not 33). `SMALL_HOURS_END` in `core/reveal.ts`.
- 2026-11-01, phase 1: archived events still show photos to members; `canSeePhotos` treats
  archived like revealed. `canSeePhotos` builds on `photoAccess` ("none", "own", "all") and
  `canSeeShot` covers hidden photos and host-only visibility per photo.
- 2026-11-01, phase 1: `revealLabel(now, at, timeZone?)` takes an optional zone (device zone by
  default); it counts down under 12 hours, then says today, tomorrow, the weekday within a week, or
  the date. Core imports use `.ts` extensions so Node can run them without a build step.
- 2026-11-01, phase 1: Pretendard comes from the `pretendard@1.3.9` npm package on jsDelivr (the
  GitHub path is over jsDelivr's size limit). The full woff2 files are about 770 KB each because
  they include Korean; the site can switch to a Latin subset.
- 2026-11-01, phase 5: the site renders every phone screen for all five occasions at build time and
  the pill script only toggles `hidden`, so the page works without JavaScript and hidden images
  stay lazy. Two small files beyond the map: `src/occasions.ts` (the demo events the phones show)
  and `src/icon.astro` (Phosphor SVGs read from `@phosphor-icons/core`), plus `src/tiers.astro`
  shared by the home pricing section and `/pricing/`. Pages use trailing slashes (`/privacy/`).
- 2026-11-01, phase 5: the "Try Linger" card is a real QR code for `PUBLIC_TRY_URL` (default
  `https://join.lingercam.app`), and the nav's App Store button goes to `PUBLIC_APP_STORE_URL`,
  falling back to `/support/#get-the-app` until the listing exists. Pretendard on the site is a
  Latin subset (about 33 KB per weight). Prettier now formats `.astro` files through
  `prettier-plugin-astro`. Playwright is a root devDependency with Chromium installed.
- 2026-11-01, phase 2: server-side developing spike. CanvasKit (`canvaskit-wasm` 0.42, CPU raster)
  ran `FILM_SHADER` correctly but took 6.8 to 11 s per demo photo at 2048 px on this Mac, so it is
  out. `applyLook` in `api/src/shots.ts` ports the shader step for step to a loop over raw pixels
  (halation, colour matrix, warmth, vignette, grain), with `sharp` decoding, resizing and encoding:
  about 0.1 s per 2048 px photo, and side by side it matches the CanvasKit render. Developed photos
  are 2048 px JPEG q85, thumbnails 512 px.
- 2026-11-01, phase 2: the API runs on Node's own TypeScript support (`node --watch src/server.ts`),
  no tsx. Migrations run on boot and with `pnpm --filter api db:migrate`. `postgres` is pinned to
  3.4.x (4.0.0 was three days old). Two small files beyond the map: `http.ts` (the `{ code, message }`
  error, body validation, JSON logging, since `console` is off limits) and `testing.ts` (test helpers
  and the global setup that resets `linger_test` and empties `linger-test` each run).
- 2026-11-01, phase 2: API decisions. `POST /v1/push` lives in `events.ts` next to device handling.
  Covers are served through `GET /v1/e/:code/cover`, a redirect to a short signed URL, so
  `coverUrl` is stable. Ending early moves `endsAt` to now. Hosts may join their own event as a
  guest to shoot. A photo taken before the end can be reserved up to an hour after it (offline
  uploads), with `takenAt` in the body. Refunds are recorded but don't shrink an event. Extra routes
  for the app: `GET /v1/events/:id`, `PATCH /v1/me` (name), `POST /v1/auth/sign-out`.
- 2026-11-01, phase 2: the seed (`pnpm --filter api seed`) recreates four events with fixed join
  codes on each run: EMMADN (wedding, revealed, 24 photos, 8 guests), MAYA3X (birthday, live, 8
  developing), JNHSWM (housewarming, ended, reveals tomorrow 10:00 Vancouver time), TFNWKD (Tofino,
  draft). The demo host is Alex Morgan, demo@lingercam.app.
- 2026-11-01, phase 3: VisionCamera 5 (5.2.3, Nitro based, with `react-native-nitro-image`) has no
  Expo config plugin, so the camera sentence is set in `ios.infoPlist` and the Android `CAMERA`
  permission in `app.config.ts`; the image picker plugin reuses the same sentence. SDK 58 dropped
  `newArchEnabled` from the config type (the New Architecture is the only one), so it's omitted.
- 2026-11-01, phase 3: Phosphor icons are imported one file at a time
  (`phosphor-react-native/src/icons/Camera`); the package barrel added about 6 MB to the iOS
  bundle. `tsconfig.json` maps those paths to the shipped `.d.ts` files because the package's
  source doesn't compile under `exactOptionalPropertyTypes`.
- 2026-11-01, phase 3: Hermes may lack `Intl.PluralRules`, so `copy.ts` loads the
  `@formatjs/intl-pluralrules` polyfill (installed only when missing). Dates use en-GB formats in
  the event's time zone and 24-hour time, to match the design and `revealLabel`. The app ESLint
  block allows `require()` for images and fonts only.
- 2026-11-01, phase 3: the film looks preview through Skia with `FILM_SHADER` in `src/look.tsx`;
  `src/look.web.tsx` approximates them with CSS filters, since the web build doesn't load
  CanvasKit. Guest screens can reuse `LookImage`. Unlimited shots are created as 36 per guest and
  switched to unlimited by the add-on purchase, so a cancelled payment leaves a valid draft. Paid
  drafts reopen from the events list at the price step (`/new?event=<id>`).
- 2026-11-01, phase 3: QR codes point to `${JOIN_URL}/j/<code>` in development and
  `https://join.lingercam.app/<code>` in production (`joinLink` in `src/api.ts`). The join
  domain therefore needs `/:code` to reach the `j/[code]` route (a rewrite or a root route).
- 2026-11-01, phase 4: VisionCamera 5 draws its preview natively, and a live film look needs its
  separate Skia frame processor package, so the native preview is plain. The look shows on the
  last-shot thumbnail (Skia with `FILM_SHADER`) and on every developed photo. In development, with
  no camera (the simulator, a headless browser), the camera uses the bundled sample photos drawn
  through the look. The browser camera shows the look live as a CSS filter and sends photos at
  1600 px so a queue of them fits in browser storage.
- 2026-11-01, phase 4: files beyond the map: `src/shutter.tsx` (the camera frame both cameras
  share: top bar, tools, rolling counter, shutter, last shot), `src/save.ts` and `save.web.ts`
  (save and share a photo: the photo library on iOS and Android, a download on the web),
  `src/demo.ts` (the sample photos) and the route `app/[code].tsx`, which sends
  `join.lingercam.app/<code>` to `/j/<code>`. Added `expo-file-system` (photos wait in the app's
  documents until they upload) and `expo-asset`; the dev client needs a rebuild for them.
- 2026-11-01, phase 4: the recap's "Save video" is "Save photo" (it saves the photo on screen),
  since the app doesn't render video. It plays the twelve most liked photos for 5 s each, so the
  subtitle gives the real length. Developing tiles show the event's cover (already public),
  blurred and offset per tile; nothing from the shots themselves. The reveal moment shows once per
  device after an event is revealed, not for right-away events while they're live.
- 2026-11-01, phase 4: the reveal reminder is a local notification scheduled when the event screen
  opens before the reveal. Push tokens register only when an EAS project id exists, since Expo push
  tokens need one. Joining puts the event under the camera, so leaving the camera lands on it.
- 2026-11-01, phase 6: the web end-to-end run (`pnpm test:e2e`, `apps/app/web.e2e.ts`) signs a
  fresh host in through email and Mailpit instead of `/v1/auth/demo`, and deletes that host at the
  end, so repeated runs leave the seeded demo host's events alone. The reveal is driven by moving
  `endsAt` a few seconds out on an at-end event, so the pg-boss reveal job does the work. Playwright
  starts the API and the Expo web dev server itself, or reuses them when they're already running.
  CI installs Chromium and runs it after `pnpm check`.
- 2026-11-01, phase 7: the dev build runs on the iPhone 17 Pro simulator, and `apps/app/flows`
  holds three Maestro flows (`host`, `guest`, `gallery`, sharing `open.yaml`), run with
  `pnpm --filter app flows` against the seeded data. Screens were compared with the scratchpad
  at 402x874 points. Fixes: the create steps' back button sits on the progress line so titles
  start where the design has them, the event name field wraps instead of scrolling sideways, the
  invite's close button sits beside the title, and the iOS settings sheet drops the extra
  safe-area top. The seed now also removes any other events the demo host has, so QA starts clean.
- 2026-11-01, phase 7: the iOS 26.5 simulator's time zone data puts America/Vancouver at UTC-7 on
  2 November 2026, while Node's tzdata (2026a) says UTC-8, so a next-morning reveal computed on
  the device can be an hour off the server's. Host event cards compute it with `revealTime`;
  guest screens use the server's `revealsAt`. Worth adding `revealsAt` to `Event` so clients
  never recompute it.
- 2026-11-01, phase 8: rules moved into core so every app and the API share them. `canShoot`
  takes `{ state, endsAt }` (an Event's settings or an EventSummary); `canReserve` and
  `LATE_UPLOAD_MINUTES` (60) let a photo taken before the end through after it, also once the
  event has revealed, which fixes late photos being refused for at-end and right-away events.
  `dueState` (the time-driven lifecycle) is in `core/events.ts`; `applyLook` sits beside
  `FILM_SHADER` in `core/film.ts` and a test checks it against the shader through CanvasKit.
  `revealCountdown` returns data that `copy.ts` phrases, replacing the English `revealLabel`.
  `Event` carries the server's `revealsAt`, so host cards no longer recompute it. `due()`
  (replacing `totalCents`) says what an event still needs to buy, so nothing is bought twice.
- 2026-11-01, phase 8: once an event is live, visibility can only go from everyone to host-only and
  the reveal can only move later; ending early through `/end` is the one way to bring it forward.
  The app has no in-app "end early" (it wasn't in the design), so its unused strings and client
  calls are gone. After the reveal only guests who already joined get back in.
- 2026-11-01, phase 8: security fixes. Email codes count attempts atomically; starts are limited
  per address (3 per 15 minutes, 10 a day) and per IP, verifies per IP, and unknown join codes per
  IP (20 per 10 minutes), all in memory, which is enough for one API instance (`TRUST_PROXY=1` on
  Render reads the client address from X-Forwarded-For). Bodies are capped at 256 KB. Signed
  uploads sign the content type (JPEG for shots; a cover declares JPEG, PNG, HEIC or WebP); the
  15 MB size cap is checked at confirm and on the cover redirect. sharp refuses inputs over 50 MP,
  a photo that can't be decoded is marked `failed` and its shot goes back to the guest, and the
  original is deleted after developing, so no camera metadata is kept. Sessions expire after 90
  days without use. Reservations take an optional `clientId` (the app's queue id), so a retry
  after a lost reply returns the same shot. Push tokens only move for their owner, sign-out
  detaches the device's token from the host, and request logs replace join codes with `:code`.
- 2026-11-01, phase 8: the demo sign-in and dev-claim need `DEV_ROUTES=1` (never in production)
  instead of "anything but production". `pnpm --filter api dev`, `.env.example` and the API tests
  set it; `pnpm --filter api start` without a `.env` has no demo sign-in. In production the API
  refuses to start while `SESSION_SECRET`, `S3_*` or `SMTP_URL` are missing or local defaults, and
  the seed refuses to run.
- 2026-11-01, phase 8: purchases. Each store transaction is saved in MMKV before its claim and
  removed once the claim succeeds; leftovers are retried on launch and before buying. The app sets
  the RevenueCat attribute `eventId`, and the RevenueCat webhook applies `NON_RENEWING_PURCHASE`
  events with it, once per transaction. Checkout and dev-claim refuse finished events and tiers the
  event already has; a Stripe payment the event can no longer use is refunded for that product.
  RevenueCat refunds match the transaction exactly. Reveal pushes say "The photos are ready." with
  `url: /e/<code>`, the same as the local notification.
- 2026-11-01, phase 9: the Live Activity ships. `apps/app/targets/activity` is a SwiftUI widget
  extension built by `@bacons/apple-targets` 5.0.0, and `apps/app/modules/live-activity` is a
  local Expo module with three calls (`show`, `end`, `endPast`); `src/activity.ts` drives it. It
  starts on a guest's first photo, updates on each one (shots left, a Candle bar of shots used,
  moments so far, the reveal) and ends when the gallery comes back as photos. Its `staleDate` is
  the reveal, so a phone that never reopens the app shows "The photos are ready." and the app ends
  it on next launch. All strings come from copy.ts. A countdown such as "in 3h" would go stale on
  the lock screen, so a reveal less than a day away reads "Reveals at 23:10".
- 2026-11-01, phase 9: no Live Activity pushes from the API yet. Ending or updating an activity
  from the server needs its ActivityKit push token stored per guest (a new column and route) and
  direct APNs with a .p8 key, since the Expo push service does not send Live Activity updates. The
  stale date covers the reveal until then. `apps/api/src/reveal.ts` is unchanged.
- 2026-11-01, phase 9: no App Clip. Guests reach it from printed QR codes, which is a physical
  invocation, so the clip must stay under 15 MB uncompressed. Measured on this build (arm64): the
  Hermes bytecode bundle is 8.5 MB and hermesvm.framework is 7.3 MB, already 15.8 MB before React
  (React.framework is 70.8 MB in the prebuilt debug flavour), Skia and VisionCamera. A React Native
  clip can't fit; a native SwiftUI join and camera clip would be a separate product to build and
  keep in step. The browser join at join.lingercam.app stays the no-install path.
- 2026-11-02, polish F2: `event.tsx` and `create.tsx` are split by concept (decision Q1), with no
  change in behaviour: `gallery.ts` (the gallery store), `notify.tsx` (reminders, push token,
  notification taps, plus `handleNotificationOpen` and `resyncReminders`, which the root layout
  calls), `moment.tsx`, `people.tsx` and `invite.tsx` (invite card, invite sheet, table cards and
  `shareLink`). `manage.tsx` (`HostRow`, `ManageButton`, already placed on the event screen) and
  `joined.tsx` (`JoinedEvents`, `CodeEntry`) are stubs that render nothing yet. Download all is
  `saveAll` in `save.ts` and `save.web.ts`, beside `keepInPhotos` for refused photos.
- 2026-11-02, polish F2: `useLoad` now reads through one shared cache in `api.ts`. Data younger than
  30 s is reused instead of fetched again, `summary:<code>` and `me:<code>` are kept in MMKV so the
  camera and the event can open offline, and keys reload on focus, on returning to the foreground
  and every `intervalMs` while the app is active. `invalidate(prefix)` reloads at once. Requests
  time out after 20 s (90 s for a photo PUT) with the code `timeout`; a response the app can't
  read is `bad-response`; `problem(code)` in `copy.ts` turns any code into a line to show.
- 2026-11-02, polish F2: the guest device id is kept in the iOS keychain (readable after first
  unlock) with a copy in MMKV, and an existing MMKV id moves to the keychain on first launch.
  `serverNow()` uses the offset from each response's `Date` header. Browsers only see that header
  if the API lists `Date` in `Access-Control-Expose-Headers`; until then the web uses the device
  clock.
- 2026-11-02, polish F2: Newsreader comes in two cuts made from the Google Fonts variable font with
  fontTools: Text at optical size 16 for serif text up to 23 pt, and Display at 36 (italic at 28)
  for 24 pt and up. They and Pretendard are Latin subsets (Basic Latin, Latin-1, Latin Extended-A,
  general punctuation), TTF or OTF on native and woff2 on the web, about 80 KB and 30 KB per file
  instead of 1.57 MB per Pretendard weight. `@expo-google-fonts/newsreader` is gone. The web no
  longer waits for fonts; it shows a system font until they load. The Live Activity can bundle
  `assets/fonts/Newsreader-Display.ttf`.
- 2026-11-02, polish F2: times follow the device's 12 or 24-hour setting (D7) through `formatTime`,
  and a clock time names the event's zone when the device's differs ("tomorrow at 10:00 Vancouver
  time"). `formatDuration` returns "Now" at zero. Prices are formatted in `copy.ts`.
- 2026-11-02, polish F2: the camera's sample photos are required only in development, so the iOS
  export carries 6 JPEGs (the welcome photo and the create step's look samples) instead of 18.
  `camera.tsx` keeps its import because `demo.ts` makes the switch.
- 2026-11-02, polish F2: new dependencies, which need a dev client rebuild: `expo-keep-awake`,
  `@react-native-community/netinfo`, and `react-native-vision-camera-skia` with
  `react-native-vision-camera-worklets` at 5.2.3 to match VisionCamera (decision Q7). Background
  upload needs no new package: `expo-file-system/legacy` `uploadAsync` runs in a background
  `URLSession` by default (decision Q5, for W4). The config adds `applinks:join.lingercam.app`, a
  verified Android intent filter for the same host, and background remote notifications for the
  silent reveal-change push.
- 2026-11-02, polish decisions: Naib approved every recommendation in section 4 of
  `polish-plan.md`. D1: a photo taken while the camera was open is accepted until 7 days after the
  reveal (`LATE_UPLOAD_DAYS`), still capped by the allowance. D2: browser guests can leave an
  email for the reveal and add a calendar entry; the email link also restores them on another
  device. No SMS or web push. D3: archived stays a label; photos, saving and the gallery keep
  working and lists move the event to "Past". D4: the host shoots without using a guest place.
  D5: an event can be live before it starts; guests join and read the rules, and the camera opens
  at the start. D6: the app offers the custom reveal as "Pick a time". D7: times follow the
  device's 12 or 24-hour setting. D8: the recap keeps "Save photo". D9: double-tap zooms in the
  viewer and liking stays on the button.
- 2026-11-02, polish decisions: Q1, `event.tsx` and `create.tsx` are split by concept before the
  parallel work. Q2, the repo has its first commit and each workstream works from it. Q3, the EAS
  project id is in `app.config.ts`, so devices can register for push. Q4, `join.lingercam.app/<code>`
  is served by the API's `/v1/e/:code/page` with the event's tags, and everything else by the
  static build; the Render routing is W7's. Q5, background uploads try `expo-file-system` first and
  the result is recorded. Q6, Naib's QA API still uses the dev database, so foundations ran
  migrations and the seed only on `linger_test`. Q7, the live film look goes into the native
  viewfinder. Q8, guests are asked for notifications after they leave the camera or finish the
  roll, hosts on the invite.
  Q9, Android is left out of this run for a pass of its own. Q10, flash defaults to Auto,
  remembered per device. Q11, a soft shutter sound that is silent when the device is silenced.
  Q12, guests can remove their own photos after the reveal, from the viewer's More menu. Q13, the
  legal placeholders and the support link for the App Store stay until a lawyer and the listing
  are ready. Q14, reports reach the host as a push and badges on tiles; a reported list is Later.
  Q15, right-away events get a closing line and the recap, without a separate moment.
- 2026-11-02, polish F1: the contract above is what the app workstreams code against. One file
  beyond the map: `api/src/notify.ts` holds Expo push (tickets, receipts, pruning) and email for
  every concept, with the reveal, full and report lines; `reveal.ts` keeps the reveal job and
  calls it. Highlights are picked in `api/src/shots.ts` (`pickHighlights`): the moment takes the
  viewer's most liked photo when they have one, then the photographer picked least so far in
  each stretch of the night; the recap does the same for 12 until anyone likes a photo, then
  takes the 12 most liked. Both come back in the order taken. Hidden photos are never picked.
- 2026-11-02, polish F1: migration `0002_guests_email_host` adds `guests.is_host`, `email`,
  `emailed_at` and `restore_hash`, and `events.full_notice_limit`, and gives every existing event
  its host row. A restore link moves the guest to the device that opens it, so the old device
  needs a new link; a device that already shot there as someone else is refused. The reveal email
  is sent once per address (`emailed_at`), and an address left after the reveal gets it at once.
- 2026-11-02, polish F1: `formatPrice` no longer says "Free"; `app/src/create.tsx` and the site's
  `tiers.astro`, `phone.astro` and `pricing.astro` need their own word for a zero price, or the
  free tier shows "$0.00". The per-event page needs a Render rewrite from the join domain's
  `/<code>` to `https://api.lingercam.app/v1/e/<code>/page` (W7); it fetches the static
  `index.html` from `JOIN_INDEX_URL` (default `JOIN_URL/index.html`) and caches it for 5 minutes.
- 2026-11-02, polish F1: the seed adds five events beside the four there were: SATWED (live,
  starts in three days, three guests), GAMENT (free, nine of ten guests), BRNCH5 (right-away and
  shooting, photos visible), BKCB27 (revealed, one photo with a report and one hidden by three) and
  FSTV28 (revealed, 250 guests, 12 photos). Every seeded event has its host row.
- 2026-11-02, polish W7: the web app uses `output: "single"`, which never renders `+html.tsx`
  (Expo reads it only for static output), so the guest web app's head is `app/public/index.html`,
  the template Expo fills with the bundle, the title, `theme-color` and the favicon. It adds
  `viewport-fit=cover`, a description, the apple-touch-icon and a Night background. Two files
  beyond the map: `app/src/missing.tsx` (the "This page doesn't exist" screen, used by
  `+not-found.tsx` and by `[code].tsx` for one-segment paths that can't be a join code) and
  `site/src/price.ts` (a tier price, "Free" at zero, since core's `formatPrice` no longer says it).
  The join domain on Render rewrites `/new` and `/settings` to `index.html`, `/:code` to the API's
  `/v1/e/:code/page`, and everything else to `index.html`; files in the build are served first.
  `apple-app-site-association` is served as JSON by a Render header and claims `/??????`, `/j/*`
  and `/e/*`. Its app id carries the placeholder team `TEAMID` and `assetlinks.json` has no
  certificate fingerprints yet; both need the real values before a device build can open links.
  Legal placeholders left for a lawyer (decision Q13): privacy, the email provider's name, backup
  and tax record retention, minimum ages per region, the postal address; terms, the minimum age
  per region, the refund policy, liability per jurisdiction, the postal address and governing law.
- 2026-11-02, polish W1: the create flow makes the server draft when the host leaves step 2, so
  the cover uploads as soon as it's chosen, and later edits are sent with PATCH at Start. Discard
  deletes the draft only when this visit created it and Start hasn't been tried. New events start
  at the next half hour today, or 18:00 on a later day, so an event started straight away sits
  under "Coming up" until then. A draft open when the session drops is kept on the device under
  `createDraft:<hostId>` and restored on the next New event; if its server draft already existed,
  the restored draft creates a second one.
- 2026-11-02, polish W3: the native viewfinder draws `FILM_SHADER` through
  `react-native-vision-camera-skia`. Photos are scaled to 2048 px with a 192 px thumbnail. The web
  look is built from core's matrix, warmth and vignette as an SVG `feColorMatrix` and a gradient,
  without grain or halation. The system shutter sound stands in for Q11. The Live Activity covers
  the shooting window: it goes stale at `endsAt`, shows the closed line, and leaves the lock
  screen within 4 hours and never after the reveal. The volume-button shutter moves to Later,
  because VisionCamera 5 has no event for it. The front screen flash fires on On, not Auto, and
  has no brightness boost, since `expo-brightness` isn't installed. The Live Activity module's
  `ios/` folder was hidden by the root `.gitignore` and is now committed, with an exception for
  `apps/app/modules/*/ios/`.
- 2026-11-02, polish W5: a device registered for push gets no local reveal reminder. `notify.tsx`
  exports `NotifyCard` (host and guest), `EmailCard`, `cancelReminder` and `useEventOnScreen`; the
  invite and the event screen share the card and its per-event answer. The moment sits over the
  revealed grid and settles its cards into the first tiles. Silent pushes are handled while the
  app is open and caught up by `resyncReminders` at launch. A background task wasn't added:
  silent pushes only reach devices registered for push, and those never hold a local reminder.
- 2026-11-02, polish W6: the people sheet reads the summary for the host's guest limit. Download
  all runs in `gallery.ts` outside any screen and saves into an album named after the event with
  full access, or into the library with add-only access; the event screen shows its line with
  Stop or Open Settings. The viewer takes `?guest=` to page within a roll, and the roll is a
  gallery of its own paged by the server. The recap plays the server's highlights, fixed when it
  opens. The iOS photo library sentence now mentions the album.
- 2026-11-02, polish merge: `PATCH /v1/events/:id` drops `revealAt` when the reveal mode changes
  to a preset, so a custom reveal can be switched back. `DELETE /v1/events/:id/cover` removes a
  cover, used by "Remove photo" in create. A reservation that expires with its original already
  uploaded intact is confirmed and developed instead of released, so a photo the phone sent in
  the background while locked is kept even if the app confirms it later. `/v1/e/:code/page`
  returns the plain app page when the code-miss limit is reached, instead of a 429. Copy link
  uses `expo-clipboard` (a dev client rebuild is needed). Open question for Naib: moving Ends
  earlier on an at-end event also moves the reveal earlier, which `lockedSettings` allows.
- 2026-11-02, polish native pass: Dynamic Type stops at 2x for body, small and caption text and at
  1.3x (`CHROME_SCALE`) for labels inside fixed-size chrome (stats, tiles, segments, camera
  controls); the camera counter and the wordmark don't scale. A `Sheet` closes when its screen
  loses focus, so a link or notification never opens a screen under it. The join sheet treats a
  right-away event as open, not revealed, while its camera can open. The Maestro flows take
  `METRO_PORT` and `API_URL`, because the pass ran on 8178 and 8179 beside Naib's servers.
  Results and the device and Android lists are in `.docs/qa.md`.
### Status by phase

Checked at hand-off on 2026-11-01. "Passed" means the command was run in that phase and passed.

- 2026-11-01, phase 1, foundations: passed `pnpm install`, `pnpm check` and healthy compose
  services. Storage is RustFS in place of MinIO. Icons, splash, favicons and the social image are
  generated from `brand/mark.svg`.
- 2026-11-01, phase 2, API: passed `pnpm --filter api test` and `/health`. Gaps: no Live Activity
  pushes, rate limits are in memory per instance, signed photo URLs stay valid for up to an hour
  after a photo is hidden, and signed URLs point at `S3_ENDPOINT`, which an Android emulator or a
  physical device can't reach locally.
- 2026-11-01, phase 3, host screens: passed typecheck, lint, both Expo exports and a Maestro run of
  the host flow on the iPhone 17 Pro simulator. Gap: the Stripe Checkout path for web hosts is not
  reachable, because host screens on the web show a note to use the app.
- 2026-11-01, phase 4, guest screens: passed typecheck, lint, both exports, a Playwright run in
  Chromium with a fake camera and a Maestro run on the simulator. Gaps: no live film look on the
  native camera preview, push registration waits for an EAS project id, and "Save all" saves photos
  one at a time.
- 2026-11-01, phase 5, site: passed `astro build` and `astro check`; every page renders and links
  resolve. Gaps: the legal drafts have bracketed placeholders for a lawyer, and there is no App
  Store listing for the nav button yet.
- 2026-11-01, phase 6, integration: passed `pnpm test:e2e` (one event in Chromium from host
  sign-in to the revealed gallery).
- 2026-11-01, phase 7, native: passed a dev build on the simulator and the three Maestro flows;
  screens compared against the scratchpad at 402x874 points. Gap: the reveal moment wasn't
  compared, because the device had already seen it.
- 2026-11-01, phase 8, review: 36 of 37 findings fixed, with tests; three optional items skipped
  (shorter photo URL lifetime, an image header check at confirm, signing out other sessions). The
  native app changes from this phase passed typecheck, lint, the exports and the web e2e run, but
  were not re-run through Maestro in that phase.
- 2026-11-01, phase 9, extensions: the Live Activity builds and runs on the simulator. No App Clip
  (over the 15 MB limit) and no Live Activity pushes from the API, as recorded above.
- 2026-11-01, phase 10, hand-off: `pnpm install`, `pnpm check` (100 core tests, 73 API tests,
  format, lint and typecheck for every package), `pnpm --filter api test` and `pnpm test:e2e` all
  passed with no changes needed. `.env` was created from `.env.example`, so `pnpm --filter api
  start` also has the demo sign-in. The seed was re-run. README covers local setup, ports, demo
  data, deep links and stand-ins, and `.docs/qa.md` holds the manual QA checklist. Remaining gaps
  are the ones listed per phase; `@bacons/apple-targets` warns that `ios.appleTeamId` is unset,
  which needs a real team id before a device or App Store build.
- 2026-11-02, polish, upload queue (G12, decision Q5): SDK 58's `expo-file-system` has
  background upload sessions (`File.upload` with `sessionType: "background"`), so on iOS the PUT
  of a queued photo now carries on after the app is suspended. Reserving and confirming the shot
  are API calls that still need the app running, so a photo whose PUT finishes while the phone is
  locked is confirmed when Linger next comes to the foreground; if that is more than 10 minutes
  later, the reservation has been released and the photo is reserved and sent again. Confirming in
  the background needs either a background task or the API confirming uploaded originals itself.
  The Android foreground service is not built (Android is out of this run, Q9).
