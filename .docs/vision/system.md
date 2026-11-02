# System-level details: what exists and what's missing

Scope: the things that cut across screens in `apps/app`, plus the API and `packages/core` as the
client sees them. Every claim about current behaviour cites the file and line it comes from. Lines
marked **Should** are proposals, not what the code does. Nothing here was run on the simulator; the
only live checks were read-only requests to the API (8171) and the Expo web server (8173) on
2026-11-02.

Paths below are relative to `apps/app/` unless they start with `apps/`, `packages/` or `.docs/`.

## 1. Navigation and routing

What exists

- One root `Stack` with `headerShown: false` (`app/_layout.tsx:46-60`). Settings is a stack modal
  (`:52`), join, camera and photo fade (`:53-55`), recap is a full-screen modal (`:56-59`).
- Routes are thin and pick a screen from `src/` (`app/index.tsx`, `app/e/[code]/*.tsx`), as the
  architecture rule says. `app/[code].tsx:4-7` redirects `/<code>` to `/j/<code>` for printed links.
- No `unstable_settings.initialRouteName`, no `+not-found.tsx` and no `+html.tsx` in `app/`.
- Join hands off with `router.replace('/e/<code>')` then `router.push('/e/<code>/camera')`
  (`src/join.tsx:72-75`), so leaving the camera lands on the event.
- Back is conditional everywhere: the event screen shows its back button only when
  `router.canGoBack()` (`src/event.tsx:457-465`); photo, recap, camera and create fall back to
  `router.replace` (`src/photo.tsx:65-68`, `src/recap.tsx:80-83`, `src/shutter.tsx:99-102`,
  `src/create.tsx:219-222`).
- Android hardware back is handled only in create (`src/create.tsx:233-239`). Sheets use
  `onRequestClose` (`src/ui.tsx:773`).
- Draft events reopen at step 5 through `/new?event=<id>` (`src/home.tsx:317-322`,
  `src/create.tsx:209-215`).

Gaps

- **A deep-linked event or join screen has no way home.** Cold-opening `linger://e/EMMADN` gives an
  event screen with no back button (`src/event.tsx:457`) and no home affordance, and the join sheet
  has no close at all (`src/join.tsx:217-240`). **Should**: set `initialRouteName: "index"` in the
  root layout so `/` sits under any deep link on native, and give the join sheet a close.
- **The app home is host-only.** `Events` lists `api.events.list()` (`src/home.tsx:267`), which is
  the host's own events. A guest who joined in the app has no list of joined events and no
  "enter a code" field; the only ways back are the QR code, a link or the reveal notification.
  `normalizeJoinCode` exists in core (`packages/core/src/events.ts:270-275`) but no screen accepts a
  typed code. Signed-out users see only "Continue with email" (`src/home.tsx:80-96`), which is a host
  sign-in. **Should**: home lists joined events (device-scoped, from MMKV plus a
  `GET /v1/me/joined`-style call keyed by `X-Device`) beside hosted ones, and offers "Join with a
  code" to signed-out and signed-in users alike.
- Notification taps always `router.push` (`src/event.tsx:248-251`), so tapping the reveal while
  already on that event stacks a second copy. On a cold start `getLastNotificationResponse()` runs
  inside `RootLayout` (`src/event.tsx:253`, called from `app/_layout.tsx:35`) while the layout still
  returns `null` until fonts and session load (`app/_layout.tsx:41`), so the push can fire before
  the navigator exists. Unverified on device; worth a test. **Should**: defer until the navigator is
  ready and use `navigate`/`dismissTo` so the event isn't duplicated.
- Unknown web paths fall into `[code]` and show "There's no event with that code" (via
  `app/[code].tsx`), which is acceptable for codes but wrong for typos like `/setings`.
- Typed routes are on (`app.config.ts:58`) yet nearly every navigation casts `as Href`
  (`src/join.tsx:73-74`, `src/event.tsx:344,432,438,582`, `src/shutter.tsx:66,101`), which turns
  the type check off.

## 2. Deep links and universal links

What exists

- Custom scheme `linger` (`app.config.ts:12`). QR and share links point to
  `${JOIN_URL}/j/<code>` in development and `${JOIN_URL}/<code>` in production
  (`src/api.ts:18-20`).
- The site's "Try Linger" QR and the invite QR are real join links.

Gaps

- **No universal links or App Links.** `app.config.ts` has no `ios.associatedDomains` and no
  Android `intentFilters`; `ios/Linger/Linger.entitlements` holds only `aps-environment`. There is
  no `public/` folder in `apps/app` (the architecture map promises `public/` with `.well-known`,
  `.docs/architecture.md:78`), and no `apple-app-site-association` or `assetlinks.json` anywhere in
  the repo. A guest with the app installed who scans a printed card lands in Safari, not the app.
- No App Clip (recorded in `.docs/plan.md` Results, phase 9), but the design still describes "an
  App Clip on iPhone" for joining. The web join is the real path for most guests, which raises the
  stakes on the web items in section 13.
- Join links have no per-event preview. The web build is a single-page app (`app.config.ts:35`)
  and the served HTML has only `<title>Linger</title>` and `theme-color` (checked with curl on
  8173), so a link shared in Messages or WhatsApp shows a bare URL. **Should**: the join domain
  serves `/<code>` with Open Graph tags (title, cover, "Join and take photos") from the API, and an
  `apple-itunes-app` smart banner once the listing exists.

## 3. State and data fetching

What exists

- `useLoad(key, load)` (`src/api.ts:359-390`): reloads when the key changes, keeps the last data
  while reloading, no cache shared across components, no persistence, no dedupe.
- `useAction` (`src/api.ts:400-420`) for mutations; never rejects.
- Session in a module store with `useSyncExternalStore` (`src/api.ts:126-167`), keychain on native,
  `localStorage` on web (`src/api.ts:110-123`).
- The gallery is a module-level store per join code (`src/event.tsx:66-174`) shared by the event,
  photo and recap screens, with generation numbers to drop stale pages (`src/event.tsx:93-117`).
- Upload queue and shots-left cache in MMKV (`src/uploads.ts`).

Gaps

- **The summary is fetched separately by every screen.** Event (`src/event.tsx:291`), join
  (`src/join.tsx:57`), camera (`src/shutter.tsx:56`), photo (`src/photo.tsx:37`) and recap
  (`src/recap.tsx:45`) each call `api.guest.summary` on mount; `me` is fetched twice on the
  join-to-camera path (`src/join.tsx:58`, `src/shutter.tsx:57`). Each push shows a spinner or
  blank first frame for data the previous screen already had.
- **"Am I the host?" costs a full events list.** `useHostEvent` loads every hosted event to find one
  (`src/event.tsx:183-189`) and runs on every photo screen mount (`src/photo.tsx:38`). It also uses a
  different key from home (`host-events:` vs `events:`, `src/event.tsx:185`, `src/home.tsx:266`), so
  nothing is shared. **Should**: the summary (or `me`) returns the viewer's role, guest id and shots
  left, which would remove `useHostEvent` and one of the two `me` calls.
- **No refetch on focus or foreground for the event screen.** Home refetches on focus through a
  visit counter (`src/home.tsx:264-267`). The event screen only refreshes on mount, when
  `shots.pending` changes (`src/event.tsx:312-314`) and on its poll interval. Coming back from the
  background after the reveal shows the old state for up to 30 s. Only the upload queue listens to
  `AppState` (`src/uploads.ts:193-198`).
- Polling: 30 s while developing, 60 s for right-away events while shooting, otherwise none
  (`src/event.tsx:270-333`). The people list only reloads on pull to refresh (`round`,
  `src/event.tsx:293-294,306-310`), and `peopleCount` prefers it over the polled summary
  (`src/event.tsx:398`), so the People stat goes stale while photos count up.
- Pull to refresh on the event screen passes `refreshing={false}` always (`src/event.tsx:565-566`),
  so the spinner never shows.
- `now` on the join screen is frozen at mount (`src/join.tsx:64`), so a sheet left open across the
  end time still offers "Open camera".
- The Live Activity makes one extra gallery request per photo to count moments
  (`src/activity.ts:28-36`).
- **Should**: one small query cache keyed like today's `useLoad` keys, with stale-while-revalidate,
  persisted to MMKV for `summary:<code>` and `me:<code>`, refetch on focus and on `AppState`
  active, and polling paused in the background.

## 4. Optimistic updates

- Likes are optimistic with rollback (`src/photo.tsx:94-103`).
- The shot counter is optimistic: shots left minus unreserved queue items (`src/uploads.ts:211-221`).
- Hide is not optimistic (`src/photo.tsx:126-133`); report waits too (`src/photo.tsx:117-124`).
- Create runs create, cover upload, claim, purchase and go-live in sequence with one spinner
  (`src/create.tsx:674-728`). Fine as is; the problem is error copy (section 5).

## 5. Error handling and copy

What exists

- API errors are `{ code, message }` (`apps/api/src/server.ts:73-84`, `apps/api/src/http.ts:8-17`).
  The client wraps them in `ApiError`, and anything thrown before a response becomes code `network`
  (`src/api.ts:71-86,191-200`).
- Per-screen mappers: `joinProblem` (`src/join.tsx:37-50`) and `errorMessage` (`src/home.tsx:586-588`).
  Errors render through `Notice`, a centred Candle line (`src/ui.tsx:1017-1030`).

Codes the API sends and how the client treats them (from `apps/api/src/*.ts`):

| Code | Status | Client handling now |
| --- | --- | --- |
| `not-found` | 404 | join, event: "no event with that code"; uploads: final at reserve (`src/uploads.ts:31`) or restart after reserve |
| `not-joined` | 403 | event and camera redirect to join (`src/event.tsx:343-345`, `src/shutter.tsx:65-67`) |
| `event-full`, `not-open` | 409 | join copy (`src/join.tsx:39-42`) |
| `no-shots-left`, `not-shooting` | 409 | uploads: counted as failed (`src/uploads.ts:136-139`) |
| `reservation-expired` | 410 | uploads: restart (`src/uploads.ts:142-157`) |
| `not-uploaded` | 409 | uploads: re-PUT (`src/uploads.ts:140-141`) |
| `too-large` | 413 | **unhandled**: confirm fails forever, retried every 60 s, and the line says "Photos will upload when you have signal again" (`src/uploads.ts:158-159`, `src/event.tsx:505-511`) |
| `too-many` | 429 | **unhandled**: the raw server message shows in sign-in (`src/home.tsx:153`); no `Retry-After` header is sent (`apps/api/src/http.ts:121-123`) |
| `wrong-code`, `code-expired`, `email-failed` | 400/502 | server English shown raw (`src/home.tsx:153`) |
| `signed-out` | 401 | any 401 clears the session (`src/api.ts:206-208`), including `no-device` |
| `bad-cursor` | 400 | shows "This event couldn't be loaded" in the header until a refresh (`src/event.tsx:531-533`) |
| `wrong-state`, `already-over`, `already-covered`, `needs-unlimited` | 409/400 | create shows "The payment didn't go through…" for any failure after creation (`src/create.tsx:720-726`) |
| `server-error`, `http` | 5xx | generic |

Gaps

- **Server messages and JS error text leak into the UI.** Sign-in shows `error.message`
  (`src/home.tsx:153`), so a network failure reads "Network request failed" and rate limits read in
  the server's words. Hide failures show the raw message too (`src/photo.tsx:131`). **Should**: one
  `problem(code)` in `copy.ts` that every screen uses, with keys for each code above; the server
  message is for logs only.
- A zod parse failure on a 200 response (`src/api.ts:213`) and a non-JSON error page
  (`src/api.ts:203`) both surface as `network`, so a contract mismatch tells the person to check
  their connection.
- No request timeout: `fetch` has no `AbortController` (`src/api.ts:193-197`, `src/api.ts:335-340`).
  The upload pump is serial (`src/uploads.ts:167-184`), so one hung request on a weak signal stalls
  every queued photo until the OS gives up.
- Any 401 signs the host out silently (`src/api.ts:206-208`). On the create flow the footer then
  returns early with no message (`src/create.tsx:675`). **Should**: clear only on `signed-out`, and
  tell the person ("You've been signed out. Sign in to continue.").
- Save all stops at the first failure and still reports "N photos saved" (`src/event.tsx:410-426`),
  so a refused photo-library permission reads as "0 photos saved to Photos" with no reason.
- Create maps every post-creation failure to the payment message (`src/create.tsx:720-722`), even
  when the go-live call failed for network reasons.
- Copy that claims more than the code does: "The host will be told" (`src/copy.ts:218-219`). The
  report route only counts and hides (`apps/api/src/shots.ts:487-511`); nothing notifies the host
  and the host has no list of reported photos.
- `Notice` uses Candle (`src/ui.tsx:1022`), and so do the delete-account row (`src/home.tsx:507`) and
  "Hidden from guests" (`src/photo.tsx:207`). The design reserves Candle for "progress, caret,
  badges" (scratchpad Design system), so errors, destructive actions and status share the accent.
  **Should**: an error tone and a destructive tone in the token set.

## 6. Offline behaviour

What exists

- Photos queue in MMKV with files in the app's documents (`src/camera.tsx:81-93`,
  `src/uploads.ts:12-24,100-108`), backoff up to 60 s (`src/uploads.ts:110-114`), retry on
  foreground (`src/uploads.ts:193-198`), reservation idempotent through `clientId`
  (`src/uploads.ts:121`). Late uploads accepted for 60 min after the end
  (`packages/core/src/shots.ts:134-148`).
- Shots left is cached per code so the counter works offline (`src/uploads.ts:75-98`).

Gaps

- **The camera can't open offline.** It needs the summary to decide `open`
  (`src/shutter.tsx:96`), and the summary isn't persisted; offline it shows "This event couldn't be
  loaded. Check your connection" over the viewfinder (`src/shutter.tsx:200-204`) and the shutter
  refuses (`src/shutter.tsx:105`). The queue is offline-ready but the screen in front of it isn't.
  **Should**: persist the last summary per code and let `canShoot` run on it.
- No connectivity signal. There's no NetInfo or banner; the only hint is "Photos will upload when
  you have signal again" after a failure (`src/copy.ts:245`).
- Web queue: photos are `data:` URLs in `localStorage` (`src/uploads.ts:15-16`). A full quota is
  swallowed (`src/uploads.ts:48-52`), so the queue then lives only in memory and a reload loses it
  without a word. At 1600 px (`src/camera.web.tsx:15`) the 5 MB quota holds roughly ten photos.
  **Should**: IndexedDB for blobs.
- No cap on retries for non-final errors, and a missing local file (after a reinstall or a cleared
  cache) fails at `fetch(uri)` as `network` and retries forever (`src/api.ts:335`).
- Server-side develop failures mark the shot `failed` and return it to the guest
  (`.docs/plan.md` Results, phase 8), but the client never hears about it.

## 7. Identity and session expiry

- Host sessions expire after 90 days unused (plan Results, phase 8). Expiry is noticed only on the
  next 401 (`src/api.ts:206`); there's no proactive check on launch beyond reading the keychain
  (`src/api.ts:136-145`).
- Guest identity is the MMKV device id (`src/api.ts:96-104`). A reinstall on iOS clears MMKV, so the
  same person becomes a new guest with a fresh allowance and a duplicate name in People. The web
  and the app are different devices too, so a guest who starts in the browser and installs the app
  later starts over. **Should**: keep the device id in the keychain (survives reinstall), and offer
  a way to carry a web guest into the app (for example a one-time link from the web session).
- Sign-out and delete leave per-device state behind: scheduled reveal notifications
  (`src/event.tsx:224-235`), `moment:<code>` flags, `reminder:<code>`, the upload queue and
  pending claims. `signOut` only clears the push key (`src/api.ts:239-244`); `me.delete` only the
  session (`src/api.ts:249-253`).
- No account name editing although `PATCH /v1/me` exists (plan Results, phase 2), so a host's name
  on the join sheet ("hostName") comes from the email local part unless seeded.

## 8. Time zones and time formatting

What exists

- Every date and time formatter is `en-GB` with `hourCycle: "h23"` in a given zone
  (`src/copy.ts:291-312`, `packages/core/src/reveal.ts:18-35`).
- The event's zone is the device zone at creation, with no way to change it
  (`src/create.tsx:166,174`).
- The server computes `revealsAt` (`apps/api/src/events.ts:157`), and clients use it.

Gaps

- **Zone use is inconsistent.** The host card line formats the day in the event zone but the
  reveal label in the device zone (`src/home.tsx:368,371`). Join phrases the reveal in the event
  zone (`src/join.tsx:25`); the create preview uses the device zone (`src/create.tsx:184-186`);
  the photo viewer uses the event zone with a device fallback (`src/photo.tsx:90`). A guest in
  another zone sees "tomorrow at 10:00" with no hint which 10:00. **Should**: pick one rule (event
  zone for event facts, with the zone abbreviation shown when it differs from the device) and route
  every screen through it.
- **24-hour time is forced.** The design shows "11:42 pm" in the photo viewer and Vancouver is the
  launch market; the code prints "23:42". The date picker is pinned to `locale="en-GB"`
  (`src/create.tsx:491`). **Should**: follow the device's hour cycle and locale for display, and
  keep 24-hour only in data.
- `formatDuration` builds "1d 4h" from literals outside the catalogue (`src/copy.ts:331-340`).
- Device clock is trusted. `canShoot` runs on the device clock (`src/shutter.tsx:96`) and `takenAt`
  is device time, which the server uses for late uploads (`packages/core/src/shots.ts:141-148`). A
  phone with a wrong clock opens or closes the camera at the wrong moment. **Should**: estimate
  server offset from the `Date` header and use it for every countdown.
- The custom reveal mode exists in core and copy (`src/copy.ts:122`) but isn't offered
  (`src/create.tsx:90`).
- Known simulator vs Node tzdata mismatch for America/Vancouver (plan Results, phase 7) is handled
  by using the server's `revealsAt`, but `revealCountdown` still computes "today"/"tomorrow" on the
  device.

## 9. Copy and terminology (`src/copy.ts`)

What exists

- One ICU catalogue, English only, cached `IntlMessageFormat`, plural rules polyfilled
  (`src/copy.ts:1-282`). Every key is used (checked by grep; the remainder are composed keys).

Gaps

- Terms drift between "photos", "shots", "moments", "film" and "roll": "Start my film" and "Your
  film is ready" (`src/copy.ts:107,112`), "That's your roll" and "{name}'s roll" (`:165,196`),
  "Moments" for the count (`:182`), "shots" for the allowance (`:139`), "photos" elsewhere. Each is
  defensible; there's no written rule for which to use where. **Should**: a short glossary at the top
  of `copy.ts` (film = the event, roll = one guest's shots, shot = allowance unit, photo = the
  result, moment = count on the cover).
- Strings outside the catalogue: `formatPrice` returns "Free" and "$" in core
  (`packages/core/src/pricing.ts:78-81`); `Tile` defaults to "Developing" (`src/ui.tsx:917`);
  duration units (`src/copy.ts:337-339`); the "›" in "People ›" lives in the string
  (`src/copy.ts:184`), which VoiceOver reads.
- Prices are always USD from core (`src/create.tsx:618,630,740`) even though the stores charge
  local prices (CAD in Canada). **Should**: show the store's localized price string on native.
- The reveal push is the title plus "The photos are ready." (`src/copy.ts:264-265`); the design's
  notification reads "Maya: the photos are ready. 212 moments from 31 people."
- `event.more` has identical plural branches (`src/copy.ts:203`).
- `common.offline` ("Linger couldn't reach the server…") and `join.loadFailed` ("…Check your
  connection…") say the same thing differently.

## 10. Design system (`src/ui.tsx`) and how screens use it

What exists

- Tokens: 21 colours (`src/ui.tsx:68-96`), one spacing token (`gutter = 22`, `:114`), a 9-step type
  scale (`:126-145`), fonts (`:98-112`). Components: Text, Icon and icon map, Mark, Wordmark,
  Button (primary cream, dark, glass; regular 56 and compact 48), IconButton (48), Segmented,
  OptionRow, TierRow, Toggle, Slider, Screen, Progress, Label, KeyValue, Field, Input, Sheet, Scrim,
  Cover, Stats, Tile, InviteCard, `confirm`, Notice.

Gaps

- **No spacing or radius scale.** Radii in use: 7, 10, 12, 15, 16, 18, 22, 25, 26, 32, 52
  (`src/ui.tsx:1036-1191`, `src/home.tsx:606`, `src/join.tsx:250,267`). Paddings and margins are
  literals in every screen.
- **Type sizes outside the scale:** 11 ad hoc `fontSize` values in screens (`src/event.tsx:878-879`,
  `src/home.tsx:594`, `src/create.tsx:874,885`, `src/photo.tsx:275`, `src/join.tsx:131`,
  `src/recap.tsx:249`, `src/shutter.tsx:447,465-466`) plus four inside `ui.tsx` itself
  (`:515,1172,1178`).
- **Colours outside the tokens:** `#E2DFD8` (`src/event.tsx:879`), `#E5E2DB` (`src/photo.tsx:272`),
  `#DDDDDD` (`src/shutter.tsx:291`, `src/recap.tsx:250`), `#2A2A27` and `#444444`
  (`src/shutter.tsx:476,483`), several `rgba` dims (`src/join.tsx:246`, `src/shutter.tsx:422,428`,
  `src/recap.tsx:236`, `src/create.tsx:886`).
- **Four sheet patterns.** `Sheet` (RN `Modal` plus Reanimated, `src/ui.tsx:770-803`); the join
  screen's own copy of the sheet styles (`src/join.tsx:249-266` duplicates `src/ui.tsx:1141-1157`);
  People as a native `pageSheet` modal (`src/event.tsx:710-715`); Settings as a stack modal route
  (`app/_layout.tsx:52`). The grab handle (`src/ui.tsx:796`) suggests swipe-to-dismiss, which no
  sheet supports.
- **Gradients are built three ways.** `Scrim` with per-instance ids (`src/ui.tsx:808-829`), and
  hand-written SVG gradients with fixed ids in home (`src/home.tsx:57-66,403-411`) and create
  (`src/create.tsx:582-583`).
- `IconButton` has no size or tint prop and always renders a 21 pt Paper icon (`src/ui.tsx:399`).
  The create back control is a bare `Pressable` with its own icon (`src/create.tsx:261-269`), and
  `SettingsRow`, `TextLink` and the people row are local components (`src/home.tsx:249-257,531-550`,
  `src/event.tsx:745-787`) that a shared `Row` would cover.
- Share is implemented twice: `shareLink` (`src/event.tsx:259-266`) and the invite's own
  `Share.share` (`src/create.tsx:771-776`).
- No toast. The photo viewer has a local timed note (`src/photo.tsx:59-63,212-216`); the event
  screen uses caption lines (`src/event.tsx:489-511`). **Should**: one `Toast` in `ui.tsx` with an
  accessibility announcement.
- Disabled state is `opacity: 0.4` (`src/ui.tsx:345`), which on Night makes the disabled primary
  button grey-cream with dark text; fine, but there's no disabled style for rows or segments.

## 11. Haptics and motion

- Haptics: one call in the whole app, the shutter (`src/shutter.tsx:108-110`). **Should**: light
  impact on like, selection on segmented, tier, slider stops and occasion rows, success on join
  and on "Saved to Photos", warning on "That's your roll", a soft notification pulse on the reveal
  moment.
- Motion in use: Sheet fade and slide (`src/ui.tsx:780-793`), Toggle (`:534-540`), join step fade
  (`src/join.tsx:233`), the reveal fan (`src/event.tsx:623-683`), the shutter blink
  (`src/shutter.tsx:111-113`), the recap's slow zoom (`src/recap.tsx:200-201`), image transitions.
- Reduced motion: no code reads it (`useReducedMotion`/`AccessibilityInfo` appear nowhere). It
  relies on Reanimated's default of following the system setting, which skips animations rather
  than replacing them; the recap still auto-advances on a `setInterval` (`src/recap.tsx:61-73`) and
  the reveal moment still waits 1.3 s on a plain `setTimeout` (`src/event.tsx:658`). Unverified on
  device. **Should**: an explicit reduced-motion path (cross-fades instead of the fan and zoom, no
  white flash) and a cleanup for the `setTimeout`.
- The reveal is the product's emotional peak and has no sound, haptic or staged build-up beyond the
  fan; the moment is shown once per device (`src/event.tsx:379-391`).

## 12. Accessibility

- VoiceOver labels exist on icon buttons, tiles, stats, tiers, slider and toggle
  (`src/ui.tsx:332-335,501,606-613,885,927`). Titles mark `accessibilityRole="header"` in most
  screens.
- Gaps:
  - No live announcements. `Notice` is `role="text"` (`src/ui.tsx:1025`), the viewer's notes and
    upload status lines aren't announced, and nothing uses `accessibilityLiveRegion` or
    `announceForAccessibility`.
  - The recap is one full-screen pressable labelled Play/Pause (`src/recap.tsx:107-117`); next and
    previous are tap zones by x position with no accessibility actions.
  - Like has no selected state (`src/photo.tsx:218-228`); the label says "Like, 38" whether liked
    or not.
  - Dynamic Type: no `maxFontSizeMultiplier` or `allowFontScaling` anywhere, while buttons are
    fixed at 56 and 48 pt (`src/ui.tsx:1035,1043-1046`), cards at 240 pt (`src/home.tsx:605`) and
    tiles at 3:4. Large sizes are untested and likely clip. **Should**: cap display and cover
    styles, let rows and buttons grow, and test at AX sizes.
  - Contrast: Faint `#6D6B65` on Night is about 3.6:1, used for legal text and placeholders
    (`src/home.tsx:103`, `src/ui.tsx:741,754`); below 4.5:1 for 13 pt text.
  - The welcome legal line is one link to Terms (`src/home.tsx:98-106`); Privacy isn't reachable
    from it.

## 13. Platform parity

Android (never built or run per the plan's Results)

- Keyboard avoidance is iOS-only in `Screen`, `Sheet` and join (`src/ui.tsx:653-656,775-778`,
  `src/join.tsx:228-231`); Android relies on window resizing, which edge-to-edge layouts can break.
  The name and email sheets are at risk.
- No Live Activity equivalent (an ongoing notification would be the Android analogue).
- `Share.share` sends the URL only on iOS (`src/event.tsx:265`, `src/create.tsx:774`); Android gets
  it inside the message, which works.
- Local API at `10.0.2.2` (`src/api.ts:11`), but signed media URLs point at `S3_ENDPOINT`, which an
  emulator can't reach (plan Results, phase 2).
- No notification channel is created; Android 13 notification permission is requested only when
  an event screen opens (`src/event.tsx:222`).

Web (the main guest path)

- **Web guests are never told about the reveal.** Local notifications and push are skipped on the
  web (`src/event.tsx:194,219,243`), there's no email or web push, and the browser tab is the only
  way back. **Should**: offer "Tell me when the photos are ready" on the web join with an email
  address (or web push for installed PWAs), stored against the guest.
- **Fonts block first paint.** The root waits for fonts (`app/_layout.tsx:25,41`) and loads four
  full Pretendard OTFs at about 1.57 MB each (`assets/fonts/`, `src/ui.tsx:101-104`), around 6.3 MB
  before a guest on cellular sees the join sheet. The site already ships a Latin subset (plan
  Results, phase 5). **Should**: Latin woff2 subsets for the web and system-font fallback while
  they load.
- JavaScript: the dev server's minified web bundle measured 3.3 MB, about 760 KB gzipped
  (2026-11-02, `lazy=true`, not a production export, so treat it as an estimate).
- Head: no description, Open Graph, apple-touch-icon or `viewport-fit=cover`; favicon is a 48 px PNG
  (`assets/favicon.png`). There's no `+html.tsx` to add them.
- Host screens show "Hosting happens in the app" with both store buttons linking to the site home
  (`src/home.tsx:566-571`), and the Stripe Checkout path is unreachable (plan Results, phase 3).
- Confirm dialogs use `window.confirm` (`src/ui.tsx:1006-1010`).

## 14. Dark theme, safe areas, launch

- Dark only: `userInterfaceStyle: "dark"` (`app.config.ts:16`), light status bar
  (`app/_layout.tsx:45`), navigation theme on Night (`app/_layout.tsx:17-20`), date picker forced
  dark (`src/create.tsx:487`). Consistent.
- Safe areas: handled per screen with `useSafeAreaInsets` (`src/ui.tsx:647-651`,
  `src/event.tsx:463,549`, `src/photo.tsx:77,159,198`, `src/recap.tsx:91,119,133`). Recap's close sits
  at `top + 22` while the bars sit at `top + 8`, which is intentional. Settings drops the top inset on
  iOS because it's a sheet (`src/home.tsx:461-462`).
- Icon 1024 px with no alpha, adaptive and monochrome layers present, splash is the mark on Night at
  120 pt (`app.config.ts:15,27-31,46-47`; sizes checked with `sips`). No iOS 18 dark or tinted icon
  variants.
- Launch: the splash stays until fonts load and the session is read (`app/_layout.tsx:23-41`);
  `claimPending`, `resumeUploads` and `endPastActivities` run in the same effect (`:27-34`). No
  timeout if the keychain read hangs.

## 15. Performance

- **Signed URLs defeat the image cache.** Every gallery request re-signs each URL
  (`apps/api/src/shots.ts:358-359`, one-hour lifetime at `apps/api/src/storage.ts:33`), and tiles and
  the viewer pass them straight to `expo-image` with no `cacheKey` (`src/event.tsx:576-583`,
  `src/photo.tsx:248-255`). Every poll and refresh downloads every visible thumbnail again; on a
  right-away event that's 30 thumbnails a minute per guest. **Should**: `cacheKey` of shot id plus
  variant, and `recyclingKey` in lists.
- URLs expire after an hour. A viewer or recap left open longer, or Save after that, fails with a
  403 and "couldn't be saved"; nothing re-signs on failure.
- People is a plain `ScrollView` (`src/event.tsx:729-791`), fine at 30, heavy at 250 with image
  avatars. Developing tiles cap at 40 (`src/event.tsx:273`).
- The last-shot thumbnail decodes the full QHD capture into Skia (`src/shutter.tsx` via
  `src/look.tsx:17`) for a small square.
- Bundle: four 1.57 MB OTFs and the demo photos (`src/demo.ts:2-15`, `src/home.tsx:39`; the folder
  is 7.9 MB) are bundled into every native build, production included. **Should**: require demo
  photos only in development and subset the fonts.
- Save all saves one photo at a time (`src/event.tsx:415-423`).

## 16. API from the client's point of view

- Envelopes are mixed: `{ event }`, `{ events }`, `{ guest, shotsLeft }`, `{ people, guestLimit }`,
  `{ shot }`, a bare `GalleryPage`, `{ liked, likes }`, `{ reported, hidden? }`
  (`src/api.ts:36-68,216-218`). Not wrong, but the client keeps a schema per shape.
- The summary carries the stored state (`apps/api/src/events.ts:149`), which lags `dueState` until
  the reveal job runs; the client compensates with `canShoot` on `endsAt` and with "photos with the
  camera closed means revealed" (`src/event.tsx:374-376`). **Should**: the summary returns
  `dueState(...)` so clients don't infer.
- Missing from the summary for the client's needs: viewer role, the viewer's shots left, the
  server time, and `photographers` before the reveal (it's in the gallery page only).
- No `Retry-After` on 429 and no ETag or `Cache-Control` on GETs; the cover redirect alone is cached
  (`apps/api/src/events.ts:319-320`).
- Core timing rules the client depends on: `canShoot` (`packages/core/src/shots.ts:129-131`),
  `canReserve` with `LATE_UPLOAD_MINUTES = 60` (`:134-148`), `RESERVATION_MINUTES = 10`
  (`:11`), `dueState` (`packages/core/src/events.ts:48-70`), next-morning at 10:00 with the
  `SMALL_HOURS_END = 4` rule (`packages/core/src/reveal.ts`), `COUNTDOWN_HOURS = 12`, archive after
  90 days (`packages/core/src/events.ts:27`). The client never shows the 60-minute late-upload
  window or the 90-day archive to anyone; an archived event shows the same as revealed.

## Top gaps, in order

1. Web guests get no reveal notification, and the app has no universal links, so most guests have
   no way to learn the photos are ready (sections 2, 13).
2. The camera can't open offline because the summary isn't persisted, which undercuts the offline
   upload queue (section 6).
3. The app home is host-only: no joined events, no "join with a code", and deep-linked screens
   have no way home (section 1).
4. No shared query cache, no refetch on focus or foreground, and stale People counts (section 3).
5. Error copy leaks server and JS messages; `too-large` and fetch timeouts can stall uploads forever
   (sections 5, 6).
6. Signed URLs change on every request, so images re-download on each poll and break after an hour
   (section 15).
7. Time zones and the 24-hour clock are applied inconsistently and against the design and the
   launch market (section 8).
8. Web first paint waits on about 6.3 MB of fonts (section 13).
9. Design system has no spacing, radius or error tokens; four sheet patterns; ad hoc sizes and
   colours across screens (section 10).
10. Accessibility: no announcements, inaccessible recap navigation, untested Dynamic Type, one
    haptic in the app, no explicit reduced-motion path (sections 11, 12).
