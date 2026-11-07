# Manual QA checklist

This list covers a full pass over the iOS app as host and guest, the guest web app and the site.
Each item says what to do and what should happen. Mark anything that doesn't match the design in
`../smallwares/.scratchpad/linger/index.html`, including type sizes, spacing and copy.

## Before you start

- Docker services are up (`docker compose ps` shows linger-pg, linger-s3 and linger-mail healthy).
- The API runs with `pnpm --filter api dev` (8171), Metro with `pnpm --filter app start` (8173) and
  the site with `pnpm --filter site dev` (8170).
- The seed was run within the last few hours (`pnpm --filter api seed`). MAYA3X stays live for 4
  hours after a seed.
- Mailpit is open at http://localhost:8176 for sign-in codes.
- For a second guest, use the web app at http://localhost:8173 in a private window, or a second
  simulator if one is free.

Useful commands, with `<udid>` the iPhone 17 Pro simulator:

```sh
xcrun simctl openurl <udid> linger://j/MAYA3X   # join as a guest
xcrun simctl openurl <udid> linger://e/EMMADN   # open the revealed wedding
xcrun simctl privacy <udid> reset all app.galleo.linger   # ask for permissions again
```

## Brand and first launch

- [ ] The home screen icon is the two-circle mark in Paper on Night, and the name under it reads
      "Linger".
- [ ] A cold launch shows the mark centred on Night, then the welcome screen without a white flash.
- [ ] The welcome screen reads "Every guest gets a camera. Everyone gets the night." with "Continue
      with email" as the only sign-in.
- [ ] Titles use Newsreader and controls use Pretendard. Candle (#E9C99A) is the only accent.

## Host on iOS

Sign-in and account

- [ ] "Continue with email": enter an address, a 6-digit code arrives in Mailpit, entering it signs
      you in.
- [ ] A wrong code shows an error; after 5 wrong tries the code stops working.
- [ ] Sign out from Settings, then sign in with email as demo@lingercam.app and the code 000000
      (development only): it's Alex Morgan, and no email arrives in Mailpit.
- [ ] Settings shows "Signed in as demo@lingercam.app", the support, privacy and terms links (they
      open the site on 8170) and the version.

Events list

- [ ] "Your events" lists the four seeded events as cover cards with their state: Maya (Live),
      Tofino (Draft), Jun (Ended, with the next-morning reveal time) and the wedding (Revealed).
- [ ] The Tofino draft says "Not live yet. Finish setting it up to get the code." and tapping it
      reopens setup.
- [ ] Pull to refresh works, and turning off the API shows "Your events couldn't be loaded." with
      a retry.

Create an event

- [ ] "New event" opens step 1, "What are we capturing?", with the five occasions in duotone icons.
- [ ] Step 2, "What's it called?": the placeholder matches the occasion, a long name wraps, the
      date and end pickers open, an end before the start shows "The end needs to be after the
      start.", and a cover photo can be chosen and changed.
- [ ] Step 3, "How should it work?": each reveal mode updates the note under it, the shots slider
      moves through its stops, and "Only me" shows the host-only note.
- [ ] Step 4, "Pick a look": Natural, Warm '98 and Mono previews differ visibly on the photo.
- [ ] Step 5, "How many guests?": the five tiers with "Popular" on 80, the unlimited add-on, and
      the button reads "Start my film" for free or "Start my film for $X" for a paid tier.
- [ ] Back steps keep what you entered. The progress line advances per step.
- [ ] A paid tier completes through the development claim and the event goes live.
- [ ] The invite card reads "Your film is ready" with a scannable QR code. Scan it with a phone
      camera or the simulator's camera; it should open `localhost:8173/j/<code>`.
- [ ] "Print table cards" opens the print preview with four cards. "Share link" opens the share
      sheet with the join message.
- [ ] "Done" returns to the list with the new event at the top.

Hosting a live event

- [ ] Open MAYA3X from the list: cover, title, stats (Left, To reveal, Revealed), "Open camera",
      "Show code" and the developing tiles. No photo is visible before the reveal.
- [ ] "People ›" opens the people sheet with names and when they joined.
- [ ] The notification prompt appears, and a local reminder is scheduled for the reveal.

## Guest on iOS

- [ ] `linger://j/MAYA3X` opens the join sheet over the blurred cover: "You're invited to shoot
      Maya turns thirty", the rules line and "Open camera".
- [ ] "What should we call you?" accepts a name; the system camera prompt follows, with no
      screen of Linger's own before it.
- [ ] On the simulator the camera says it's using sample photos. Taking a photo flashes, gives a
      haptic, rolls the counter down by one and shows the last shot thumbnail with the look.
- [ ] Flash, 0.5 (where the device has it) and flip respond. The top bar shows the time left.
- [ ] Back from the camera lands on the event, and the new photos count as developing.
- [ ] After the first photo the Live Activity appears on the lock screen: title, "N of M shots
      left", the Candle bar, moments so far and the reveal time. The Dynamic Island shows the
      mark with a ring.
- [ ] Turn off the network (stop the API), take two photos, turn it back on: both upload and the
      event's count goes up.
- [ ] Use every shot on a small allowance: "That's your roll" appears and the shutter stops.
- [ ] Join an ended event (JNHSWM) from a new device: "The camera has closed. Photos appear ...".
- [ ] A bad code (`linger://j/AAAAAA`) shows "There's no event with that code."

## Reveal and gallery

- [ ] `linger://e/EMMADN` on a device that hasn't seen it shows the reveal moment "It's all here."
      once, then "See every moment" opens the gallery.
- [ ] The gallery shows 24 photos, pages smoothly, and pull to refresh works.
- [ ] Tapping a photo opens the viewer with "Photo by ...", the time and the look, and "N of 24".
      Swipe left and right.
- [ ] Like toggles immediately and the count changes. Save asks for photo access, then "Saved to
      Photos". Share opens the share sheet.
- [ ] As a guest, "Report photo" asks to confirm and then thanks you. As the host (demo account),
      the same place shows "Hide photo"; a hidden photo reads "Hidden from guests" and disappears
      for guests.
- [ ] People: tapping a person shows "<name>'s roll"; "Show everyone" goes back.
- [ ] "Watch the recap" plays up to 12 photos, 5 s each, with progress bars; tap right and left to
      move, hold to pause, "Save photo" and "Share" work, close returns to the event.
- [ ] "Save all photos" shows "Saving N of 24" and ends with "24 photos saved to Photos".
- [ ] To watch a live reveal: create an at-end event that ends in a few minutes, join and shoot,
      then wait. The moment appears within a few seconds of the reveal, the local notification fires
      and tapping it opens the event. The Live Activity ends.

## Guest web app (http://localhost:8173)

Use Chrome or Safari, ideally at phone width in the device toolbar.

- [ ] `/MAYA3X` redirects to `/j/MAYA3X` and shows the join sheet.
- [ ] Joining asks for a name, then the browser's camera permission. The live preview shows the
      look as a filter. Taking a photo drops the counter and the photo uploads.
- [ ] Without a camera in development, the sample photos are used.
- [ ] `/e/EMMADN` shows the gallery after the reveal moment; the viewer, likes, save (a download)
      and the recap work.
- [ ] Reloading the page keeps you joined (the device id is in browser storage).
- [ ] `/` is the guest home: events this browser joined, "Have a code?" and a link to the site.
      Host routes (`/new`, `/settings`) show "Hosting happens in the app" with one button per
      store.
- [ ] The tab shows the Linger favicon and title.
- [ ] No errors in the console, apart from the known expo-notifications warning about push tokens
      on the web.

## Site (http://localhost:8170)

- [ ] The home page matches the scratchpad: hero with three phones, the occasion pills switch
      every phone, the three acts, pricing, the FAQ and the footer.
- [ ] The "Try Linger" QR code scans.
- [ ] Phone rows scroll sideways without clipping the first phone; the page has no horizontal
      scroll at 375 px.
- [ ] `/pricing/` shows the same tiers and add-on as the app's step 5.
- [ ] `/privacy/`, `/terms/`, `/support/` and `/delete-account/` render, start with the draft note
      where they should, and every footer link resolves.
- [ ] The favicon, apple-touch-icon and social image (`/og.png`) are the Linger mark. Paste the
      page into a link preview tool if you want to check the social card.
- [ ] Light reading on a phone: text sizes, line lengths and tap targets are comfortable.

## Account deletion

Do this last, with an email account rather than the demo host.

- [ ] Sign in with a new email, create a free event, take a photo as a guest on it.
- [ ] Settings, "Delete account", "Delete everything": the app returns to the welcome screen.
- [ ] The event's join link now shows "There's no event with that code."

## Native pass, 2026-11-02

The polish run's native pass on the iPhone 17 Pro simulator (iOS 26.5), with a dev client
rebuilt from `expo prebuild --clean`. Naib's own API, Metro and site from the main checkout were
still running on 8171, 8173 and 8170, so this pass ran its own API on 8179 and Metro on 8178
(`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_JOIN_URL` pointed at them) and left those servers alone.

### Running the flows

```sh
xcrun simctl spawn <udid> defaults write app.galleo.linger EXDevMenuShowFloatingActionButton -bool false
pnpm --filter api seed
cd apps/app/flows && maestro --device <udid> test .
```

`open.yaml` reads `METRO_PORT` (default 8173) and `uploads.js` reads `API_URL` (default
`http://localhost:8171`), so `maestro test -e METRO_PORT=8178 -e API_URL=http://localhost:8179 .`
runs the same flows against other ports. `notify.yaml` clears the app's state, which also clears
the floating button setting, so run the `defaults write` again before taking screenshots.

All six flows passed in one ordered run on the final code: host, guest, uploads, gallery, notify
and manage (6m 45s). `manage.yaml` deletes Game night, so reseed before running it again.

### What the pass fixed

App bugs found on the simulator, each fixed in the file that owns it:

- Discard on a half-made event brought the question straight back. Expo Router 58's
  `usePreventRemove` needs `repeat()` to continue a blocked leave (`create.tsx`).
- A sheet stayed on top when a link or notification opened another screen: the Manage sheet
  covered the next event and its reveal moment. `Sheet` now closes when its screen loses focus;
  the root layout's confirm uses the plain sheet (`ui.tsx`).
- The join sheet's byline read "Alex Morgan invited you"; it now uses the first name, as the spec
  says (`join.tsx`).
- A right-away event that was still shooting told new guests "These photos are for the people who
  were there". While the camera can open, the sheet now invites them to shoot (`join.tsx`).
- The code sheet showed "Have a code?" and its line twice; `CodeEntry` no longer draws its own
  heading (`joined.tsx`).
- The Manage sheet's "Saved" line moved every row when it disappeared, so a tap 2 s after a save
  could land on the wrong row. The line keeps its slot (`manage.tsx`).
- With a long event name the fourth table card spilled onto a second page. Cards have a fixed
  height, the title is smaller for long names, and the page margin is set once in the print call
  (`invite.tsx`).
- The invite card's VoiceOver label read "No download needed.. Code" (`invite.tsx`).
- At the largest text size, stat labels and tiles broke mid-word ("Mom ents", "Devel oping"), the
  camera counter was clipped, the wordmark grew like body text and step 3's options truncated to
  "Right…". Body, small and caption text now stop at 2x, labels inside fixed chrome stop at 1.3x,
  the wordmark keeps its size, and segment labels wrap to two lines (`ui.tsx`, `event.tsx`,
  `shutter.tsx`).
- The sign-in code field was announced as "Check your email"; it is now "Sign-in code"
  (`home.tsx`, `copy.ts`).

Flow fixes: waits on controls that stay on screen instead of titles that scroll away, the dev
menu sheet after a cleared install, the guest flow signs the host out first and now covers a
right-away event, the gallery flow signs in as the host and handles the Photos app's first-run
screen, the uploads flow ends the event right after reopening the camera (the camera now hears
about an end within 60 s) and sends a JSON body on every POST, the notify flow sets the
permission through the system prompt (Maestro's `applesimutils` can't preset notifications on
iOS 26), and the manage flow picks the confirm button beside Cancel.

Maestro's XCTest driver crashed SpringBoard once while reading an alert (16:01), and once
refused to start (`LSApplicationWorkspaceErrorDomain` 115) while Notification Center was open.
Both cleared on a rerun.

### Screenshots

`after-*.png` in `.docs/vision/shots/` at 804 px wide (402 points at 2x), compared with the
scratchpad screens (`design-*.png`) and `product.md`. They match unless a line says otherwise.

| Shot | Compared with | Notes |
| --- | --- | --- |
| `after-welcome`, `after-code-entry`, `after-join-notfound` | product 1.1, 4.1, 4.2 | Joined list on Welcome; unknown code keeps the code |
| `after-home`, `after-card-menu`, `after-home-offline` | product 1.3 | Grouped by state; long-press menu; reload without the API |
| `after-create-*` | setup 1 to 5 | Starts row, "6 left", disabled Continue, slider stops, unlimited note, "Test purchase" |
| `after-invite`, `after-print-preview` | setup 6, product 2.3 | Code under the QR, Copy link; four cards on one page |
| `after-event-host-live`, `after-manage`, `after-event-guest` | shoot 3 | Tiles use hues and first names (G41), not a blurred photo |
| `after-join`, `-before`, `-draft`, `-ended`, `-revealed`, `-rightaway`, `after-join-name` | shoot 1, product 4.2 table | Every state's title, line and button |
| `after-camera`, `-after-shot`, `-last-three`, `-roll-done`, `-closed`, `-offline` | shoot 2 | Nothing above the allowance; last three in Candle |
| `after-live-activity-roll-done`, `after-live-activity-closed` | shoot 4 | "Your roll is done"; "The camera has closed. Photos at 10:00 am." |
| `after-moment` | reveal 2 | |
| `after-gallery-host`, `after-gallery-badges` | reveal 3 | Report and hidden badges on host tiles |
| `after-viewer-portrait`, `-landscape`, `-hidden` | reveal 4 | Whole photo, centred position, "Hidden from guests." |
| `after-recap`, `-slide`, `-end` | reveal 5 | Photographer credit, end card |
| `after-people-host` | reveal 6 | Host first, "8 of 150 guests" |
| `after-settings`, `after-delete-account-confirm` | product 12 | |
| `after-sign-in-code`, `after-sign-in-wrong-code` | product 1.2 | Cooldown, Open Mail, the mismatch line |
| `after-xl-*` | | The largest accessibility text size, after the fixes above |
| `after-safari-camera-blocked` | product 13.2 | See G21 below |

Left as they are, for Naib to decide:

- The Live Activity's reveal line truncates ("Reveals tomorrow at 11:00 am Va…") when the device's
  time zone differs from the event's, because the zone name is added.
- Body lines can end on a single word ("…from this camera / only."); the orphan rule (G65)
  covers titles only.
- Right after a host creates an event it sits under "Coming up", above the list's scroll
  position, so it isn't on screen when the invite closes.

### Review items checked by hand

- VoiceOver labels, read from the accessibility hierarchy: icon buttons on the event, camera,
  viewer and sheets are named; Flash reports its state as a value; zoom stops are radios with a
  selected state; Like reports selected after a tap; the developing grid is one element ("10
  photos developing"); "Step 3 of 5" on create; "People" without the "›". Spoken announcements
  (shots left after each shot, sign-in errors) can't be read from the hierarchy and were checked
  in the code only.
- The largest text size (accessibility extra extra extra large): checked on Welcome, the events
  list, Settings, create step 3, the invite, the join sheets, the event and the camera.
- Reduce Motion: a screen recording of the Manage sheet with the setting off and on shows a slide
  and an in-place appearance, so the app reads the simulator setting. The other animations named
  in G189 call the same hook (code read).
- Haptics, sounds and timing (G88, G94, G95, G130, G132, G160, G161, G170, G186, G190, G196,
  G198 to G200, G203, G205, G209, G212, G214, G215, G217, G219, G221, G223, G226 to G229, G232,
  G239, G240, G245): not checked one by one in this pass. The code calls the haptics helper from
  create, sign-in, join, the camera, the invite, Manage, the moment, the viewer and the recap, but
  the simulator gives no haptics, so whether each fires at the right moment waits for the device
  pass and a code review against the spec's tables.

### Built, not verified

These need a physical iPhone (the device pass, decision Q16):

- G14, G37, G147, G148: remote push registration, the reveal push with counts, the silent push
  after a reveal change, and a registered device skipping its local reminder.
- G16: the live film look in the native viewfinder. The simulator has no camera, so the sample
  photos stand in and the frame processor never runs.
- G17: universal links from `join.lingercam.app`. The AASA file still has the placeholder team
  id.
- G21: the shutter row above Safari's floating toolbar. Simulator Safari has no camera and refuses
  `getUserMedia` as not allowed, so the web camera never opens there; the join and name sheets do
  sit clear of the toolbar.
- G55 (the flash firing), G134 (the front screen flash), G135 (pinch zoom and tap to focus).
- G216: the volume-button shutter moved to Later (plan Results, W3).

These wait for the Android pass (decision Q9):

- G191: the app has not run on Android. Its parts written in this run are untested there: the
  upload foreground service (G12), App Links (G17), Android back on create (G68), and
  `ImageCapture.takePhoto()` in Android Chrome (G239).

## Hand-off, 2026-11-02

### Running the web tests beside other servers

Naib's servers from the main checkout held 8170, 8171 and 8173 for the whole run, so the web tests
ran against this branch on the two spare ports: the API on 8179 and, in turn, the Expo web app or
the site on 8178. The e2e files and `playwright.config.ts` read `E2E_API_URL`, `E2E_APP_URL` and
`E2E_SITE_URL`, with the usual ports as defaults, and the storage CORS rules allow 8178.

```sh
cd apps/api && PORT=8179 API_URL=http://localhost:8179 JOIN_URL=http://localhost:8178 \
  CORS_ORIGINS=http://localhost:8178 node --env-file-if-exists=../../.env src/server.ts
cd apps/app && CI=1 EXPO_PUBLIC_API_URL=http://localhost:8179 \
  EXPO_PUBLIC_JOIN_URL=http://localhost:8178 npx expo start --web --port 8178
E2E_API_URL=http://localhost:8179 E2E_APP_URL=http://localhost:8178 \
  E2E_SITE_URL=http://localhost:8178 npx playwright test apps/app
```

For the four site page tests, serve the site instead (`npx astro dev --port 8178` in `apps/site`)
and set `E2E_SITE_URL=http://127.0.0.1:8178`. Metro started with `CI=1` doesn't reload, so restart
it after changing app code. The API keeps its rate limits in memory, so restart it between full
runs.

### Screens and states covered by the web tests

All 54 tests pass on this branch, run in groups because only two ports were free. Each new screen
and state from the polish run has a test:

- Guest home on the web root, "Have a code?", the joined list (a deleted event drops out), and
  one store button per host route.
- Join sheet: live, loading shape, before the start, draft, full, ended, revealed as a member and
  not a member, unknown code with the code prefilled, a pasted link, offline, a returning guest
  ("Join as Sam", "Not Sam?"), a sheet left open as the clock passes, and the email link that
  moves a guest to another browser.
- Camera: before the start, closing soon, closed while open (End now and the end passing), after
  the reveal, the server's clock against a wrong device clock, offline with and without a cached
  event, flash and zoom, the last shot after reopening, staying awake, a hidden tab, and a deleted
  event.
- Uploads: thirty photos offline across a reload, an immediate retry on reconnecting, a refused
  photo kept until Download, a too-large photo shrunk and sent again, and a missing file reported.
- Event screen and reveal: the roll line, the developing grid, "Left" then "Now", the moment with
  the server's three cards and the personal line, late photos slotting in, the seconds countdown,
  and a right-away event's "Live" and closing line.
- Gallery: a roll paged by the server, the viewer's arrow keys, renewed signed URLs, the recap's
  fixed set, end card and share, Save all past a failure, the phone-browser line and the 250-guest
  people list.
- Site and join domain: the copy that ships, Try Linger, privacy and support, the link files,
  the page shell, per-event preview tags, missing pages and a bare code path.

### What the hand-off fixed

- The web camera's first shot as it opened failed with "The photo didn't take". It now waits for
  the first video frame.
- Pasting a different whole code or link over a full code entry didn't join.
- Share and save in the browser failed for a photo already shown, because the browser reused the
  `<img>` copy without CORS headers.

### Maestro at hand-off

The review fixes after the native pass changed app code (refused photos and the Save line,
`useNotificationTaps`, renamed buttons) but no native modules, so the dev client from the native
pass was reused with Metro on 8178 and the API on 8179, after a fresh seed. All six flows passed
in one ordered run (host, guest, uploads, gallery, notify, manage; 6m 34s).

### Built, not verified at hand-off

Beyond the lists in the native pass above:

- Device (Q16): a refused photo saved to Photos straight away when access is granted, and the
  Save line with Open Settings when it isn't; a photo sent while the phone is locked and confirmed
  on the next foreground (G12); the restore email link opened on a second iPhone.
- Android (Q9): nothing new; the list above still holds.

## Known gaps

These are expected and don't need a bug report:

- The native camera's live film look is built but has only run on the simulator, which uses
  sample photos.
- Reveal pushes are skipped locally; the local notification stands in.
- No App Clip; guests without the app use the browser.
- The development client's gear button can overlap controls at the screen edges; the `defaults
  write` command above hides it.
- The legal pages contain bracketed placeholders for a lawyer.
