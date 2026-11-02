# Visual detail audit

Date: 2026-11-02. Scope: every screen in the approved scratchpad
(`../smallwares/.scratchpad/linger/index.html`) against the app as it renders now, plus code reading
for what the web build can't show. No code or data was changed.

## How this was done

- Scratchpad: each phone screen rendered unscaled (402x874 pt at 2x) for the wedding and birthday
  occasions: `shots/design-<occasion>-<act>-<n>.png` (setup 1-6, shoot 1-4, reveal 1-6).
- App: my own Playwright Chromium at 402x874, deviceScaleFactor 3, mobile and touch, against the
  live Expo web server on 8173: `shots/app-*.png`. The seeded MAYA3X had already revealed and
  EMMADN only lets in guests who joined before the reveal, so the `/v1/e/:code` routes were mocked
  in the browser (live MAYA3X with 12 developing, revealed EMMADN with 12 demo photos). Covers and
  photos are the bundled demo JPEGs. Every non-GET to the API was blocked in the browser, so
  nothing was written to the dev database. `/j/AAAAAA`, `/j/JNHSWM`, `/j/EMMADN` and `/` were read
  live.
- Host screens (welcome, events, create, invite, settings) only render natively (`home.tsx:43`,
  `create.tsx:194`), so they are audited from code against the scratchpad CSS. Those findings are
  marked **unverified**.
- One note on process: the first camera run used Chromium's auto-grant flag without a fake device
  and captured a frame from this Mac's real webcam. I deleted those two screenshots immediately and
  re-ran with `--use-fake-device-for-media-stream` (the green test pattern in `app-camera.png`).

Overall: the guest screens are close to the design. Layout, sizes, radii and colours match the
scratchpad to within a point or two on the join sheet, event cover, stats row, action row, grid,
moment, people list, viewer and recap. The gaps are in type rendering (the wrong Newsreader cut),
image handling (landscape photos, thumbnails at large sizes), a few states the design never drew
(errors, empty, ended, revealed join, disabled), and small consistency issues.

## Top gaps, in order

1. **Newsreader is the 16 pt text cut, everywhere.** `ui.tsx:1-2,98-105` load
   `@expo-google-fonts/newsreader` 400 Regular and Italic, whose TTF name table reads "Newsreader
   16pt". The scratchpad loads the variable font with `opsz 6..72`, so browsers pick the display
   optical size for 30 to 48 pt titles ("Newsreader for titles ... at its display optical size",
   scratchpad Type card). The 16 pt cut has lower contrast, wider letters and heavier hairlines, so
   every title, number and name looks blunter than the design: compare `app-moment.png` with
   `design-wedding-reveal-2.png`, or the cover titles. This is the single largest fidelity gap. Fix:
   bundle static display cuts (Google's static set has 24, 36, 48, 60 and 72 pt files) and map the
   `display`, `title`, `cover`, `heading` and recap variants to a display cut, keeping 16 pt for 19 to
   23 pt names. The Live Activity bundles its own `targets/activity/Newsreader-Regular.ttf`, which
   should get the same treatment (unverified which cut it is).
2. **Landscape photos letterbox in the viewer.** `photo.tsx:245-252` uses `contain` for landscape
   photos, so a 3:2 photo sits in a band with about 280 pt of black above and below it
   (`app-viewer-landscape.png`). The name, meta line and buttons then sit on flat black instead of
   over the photo, which loses the design's character (`design-wedding-reveal-4.png` is full
   bleed). Most phone photos taken in landscape and most of the demo set are 3:2. Showing the whole
   photo is right, but the frame needs work: draw the same photo blurred and darkened behind it
   (as the join sheet does), and add pinch to zoom.
3. **Text wraps with orphans.** The scratchpad sets `text-wrap: balance` on titles and `pretty` on
   body text (scratchpad CSS lines 28-29). React Native has neither, so titles leave single words:
   "Emma & Daniel's Wedding / day" on the join sheet (`app-join-revealed.png`), "Hosting happens in
   the / app" (`app-host-note.png`), and "...appear at the / reveal." under People
   (`app-people-before.png`). Fix: on iOS set `lineBreakStrategyIOS="push-out"` on serif titles
   (unverified, native only), and for the web and Android join the last two words of titles with a
   no-break space in `Text` when the variant is a title.
4. **Developing tiles repeat and look muddy.** Every tile is the same cover, blurred and shifted
   through six offsets (`event.tsx:275-282,585-590`; `ui.tsx:933-947`). In
   `app-event-developing-scrolled.png` the grid is a uniform beige wash with an obvious period of
   six; the scratchpad's tiles each have their own colour because they blur different photos. Web
   also shows lighter fringes along tile edges where the blur samples past the image. Native uses
   `blurRadius` 42 (`ui.tsx:966`), unverified. Options that keep the secret: vary hue and
   brightness per tile, use the occasion's sample photos, or draw a film-frame motif per tile.
5. **The shot counter clips its neighbours.** `shutter.tsx:455-463` gives the counter
   `overflow: "hidden"` at 82 pt wide, so "20" and "22" are cut in half (`app-camera.png`). In the
   design (`design-birthday-shoot-2.png`) the neighbours spill past the chip and fade into Night.
   Remove the clip, or fade the edges with a mask, and keep the roll animation (`shutter.tsx:351-364`).
6. **Thumbnails at hero sizes.** The reveal moment's fan cards use `thumbUrl`
   (`event.tsx:675`), which is 512 px, shown at 210 pt (630 px on a 3x phone), so the most
   important screen in the app shows soft photos. People avatars and grid tiles are fine with
   thumbs. The recap also upscales: it scales the 2048 px developed photo by 1.12 over five seconds
   (`recap.tsx:193-216`), and a landscape photo cropped to a 874 pt tall screen is already about 1.9x
   upscaled on a 3x device; `app-recap.png` shows the softness. Use `url` for the fan, and consider
   a 2732 px long-side develop or a Ken Burns pan instead of a crop for landscape slides.
7. **States the design didn't draw look unfinished.**
   - Unknown code (`app-join-notfound.png`): an empty black screen with a sheet holding one line of
     Candle text and "Try again", which retries the same bad code (`join.tsx:103-107`). Should show
     the mark, a short title and a field to type the code.
   - Revealed event, not joined (`app-join-revealed.png`): the title still reads "You're invited to
     shoot ..." (`join.tsx:135-137`, `copy.ts:138`) above "The camera has closed and the photos are
     ready." The title should change with the state.
   - Gallery failure (first run of `app-event-developing.png` before the mock was fixed): the stats
     show "0 Moments" as if real, and the grid area is one Candle line with no retry
     (`event.tsx:447,531-533`).
   - Download before the reveal shows a dimmed icon button with no explanation (`event.tsx:485`,
     `ui.tsx:394`); the design shows it normal. Either hide it until photos exist or explain on
     press.
8. **Candle is used for errors.** `Notice` (`ui.tsx:1017-1030`) puts every failure in Candle, and
   so do "Delete account" (`home.tsx:504-510`) and "Hidden from guests" (`photo.tsx:207`). The
   brand says Candle is the one accent for progress, caret and badges (`plan.md` Brand). Warm gold
   reads as celebratory, not as a problem. Suggest Paper or Ash text with an icon for errors, and
   keep Candle for the live dot, progress, the caret and the Popular tag.
9. **The photo viewer's top bar is off centre.** The guest view adds Report beside Share
   (`photo.tsx:169-195`), so `space-between` puts "3 of 24" at 172 pt instead of 201 pt
   (`app-viewer-portrait.png`). The design has one button each side. Move Report into a long-press
   or a "..." menu, or give the position label absolute centring.
10. **Time formats disagree.** `formatTime` strips the leading zero ("1:42", `copy.ts:309-312`),
    while reveal lines use core's time with one ("tomorrow at 08:21", `app-join-invite.png`). The
    design uses "11:42 pm" on the viewer but 24-hour everywhere else; pick one rule and apply it in
    both `copy.ts` and `core/reveal.ts`.

## Screen by screen

### Join sheet (`join.tsx`) vs shoot 1

- Matches: sheet radius 52, side inset 10, padding 12/24/40, gap 14, grab 40x5, photo 220 tall at
  radius 26, the "Linger" byline at 14 pt Ash, serif 30 title, Sans 15 rules, primary button.
  `app-join-invite.png` vs `design-birthday-shoot-1.png` is within a few points.
- Backdrop: design dims with `brightness(0.55)` on a 4 px blur (scratchpad `.clip > img`); the app
  uses a 4 px blur under a 45% Night layer (`join.tsx:221-227,246`). Close enough; on iOS
  `blurRadius` 4 is in points and may look sharper (`ui.tsx:965` notes the same for tiles),
  unverified.
- Name step (`app-join-name-typed.png`): the field is centred serif 34 with a rule, and the disabled
  Continue is the cream button at 40% opacity, which reads as grey on the dark sheet
  (`ui.tsx:345`). A disabled primary would read better as Raised with Faint text. Typing into the
  field did not show in the screenshot because autofocus doesn't take focus in headless Chromium;
  not a product issue.
- Camera permission step (`join.tsx:186-214`): a duotone 40 pt camera icon in Paper. Fine, but the
  scratchpad uses duotone only for occasions and features; unverified visually.
- Step transitions are a 220 ms fade of the whole sheet (`join.tsx:233`); the sheet height jumps
  between steps with no layout animation. A height animation would feel smoother.
- The sheet has no top safe-area handling for very short screens with the keyboard up; with the
  name step and the iOS keyboard the photo isn't shown, so it fits (unverified).

### Camera (`shutter.tsx`, `camera.web.tsx`, `camera.tsx`) vs shoot 2

- Top bar, viewfinder radius 28 and 12 pt margins, tools row, zoom chip, shutter 84/68 and last-shot
  62/17 all match the CSS values.
- Counter clipping: see gap 5.
- Web viewfinder: thin light slivers show down the left and right edges of the rounded viewfinder
  (`app-camera.png`, x 0-1 pt at both sides). The `<video>` has a CSS `filter`
  (`camera.web.tsx:184-192`), which in Chromium can escape the parent's rounded `overflow: hidden`
  clip. Put the radius and `overflow: hidden` on the video's own wrapper too, or apply the filter to
  the wrapper. Safari unverified.
- Web: flash is greyed at 35% and the zoom chip shows a single "1×" (`shutter.tsx:217,308-317`). A
  lone selected segment looks like a broken control; hide the chip when only one lens exists.
- Last-shot well before the first photo is an empty bordered square (`shutter.tsx:263-276`). The
  design always shows a photo. A faint mark or the cover at low opacity would read better.
- Native camera preview has no film look (known gap in `qa.md`), so what guests see differs from the
  design's warm viewfinder. The design's viewfinder is `f-warm`. Unverified on device.
- The shutter's disabled state is 50% opacity on the inner disc only (`shutter.tsx:258`); the ring
  stays full. Fine, but out-of-shots and closed states are only communicated by the overlay.
- Native: the white blink is 85% for 60 ms then 260 ms out (`shutter.tsx:111-113`), unverified.

### Event before the reveal (`event.tsx`) vs shoot 3

- Cover 470 tall, scrim stops identical to the CSS gradient (`ui.tsx:831-836`), title serif 38,
  stats serif italic 27 and 13 pt Soft labels, actions 48 pt with radius 15, two-column grid with
  6 pt gaps and 12 pt sides, tile radius 16 and 3:4. All measured within 1 to 6 pt of
  `design-birthday-shoot-3.png`.
- The camera button is icon only, as in the design. Its accessibility label is set, but a sighted
  first-time guest sees only a camera glyph in a large white bar; consider "Open camera" as a label
  when there is room.
- Tile grid width is `48.9%` with `space-between` (`ui.tsx:1161`, `event.tsx:849`), so the gutter
  between columns varies with screen width instead of being 6 pt. Use a fixed gap.
- No back button on web because there is no history (`event.tsx:457`); on iOS a glass back sits at
  `insets.top + 8` over the cover photo, which the design doesn't show (unverified).
- "N more developing" footer uses serif italic Ash (`event.tsx:551`). Fine.
- Upload lines ("Uploading 2 photos" and so on) are 13 pt Ash centred above the grid
  (`event.tsx:489-511`). They push the grid down and back up as uploads finish; a fixed slot or an
  overlay chip would avoid the jump.

### People (`event.tsx:687-795`) vs reveal 6

- Matches the design: serif 33 count, Sans 15 subtitle, 50 pt faces, 17 pt medium names, serif
  italic 23 counts in `#E2DFD8` (`app-people-after.png`).
- Divider weight: rows use `hairlineWidth * 2` (`event.tsx:873`), which is 2 px on the web and
  visibly heavier than the design's 1 px line. The settings rows use plain `hairlineWidth`
  (`home.tsx:642`) and KeyValue uses `* 2` (`ui.tsx:1117`). Pick one line token.
- Before the reveal, initials sit on Raised circles (`app-people-before.png`). Good, but the serif
  initials are 21 pt and look heavy with the 16 pt cut (gap 1).
- The second line is "Joined 10:22"; the design shows a role ("Bride's side", "Host"). The host
  isn't marked at all; a "Host" line for the host would help.
- The close button is a 48 pt Raised square at top right. The design has none (it's a full screen);
  on iOS this is a page sheet (`event.tsx:713`) with its own grabber, so the close may be redundant
  there (unverified).

### Reveal moment (`event.tsx:621-683`) vs reveal 2

- Title display 42, subtitle, fan geometry (210 pt cards, 26 pt then 92 pt spread, 5 then 11
  degrees, 18 pt drop, 900 ms with the same cubic bezier) all match `design-wedding-reveal-2.png`
  (`app-moment.png`, `app-moment-open.png`).
- Thumbnails at 210 pt: see gap 6.
- After the fan opens the screen waits 1300 ms and swaps to the gallery with no transition
  (`event.tsx:658`); the moment ends with a hard cut. A cross-fade, or the fan cards flying into the
  first grid tiles, would land the moment.
- Web top spacing: with no safe-area inset the title sits 32 pt from the top; on iOS it would be
  about 94 pt, close to the design's 107 pt (unverified).
- A haptic on "See every moment" would suit the moment (none today, native only).

### Gallery (`event.tsx`) vs reveal 3

- `app-gallery.png` matches the design: "Revealed / Yesterday", tile names in serif italic 19 with
  the text shadow, same grid.
- The primary action becomes a play icon for the recap (`event.tsx:434-439`). The design keeps the
  camera glyph. A play glyph alone in a wide white bar is unclear; "Watch the recap" with the icon
  would fit.
- Hidden photos (host view) aren't marked on tiles, only in the viewer (`photo.tsx:206-210`).
  Unverified visually; a small Eye-slash badge on the tile would help.
- Empty revealed gallery shows one centred Ash line (`event.tsx:522-530`); fine but plain.

### Photo viewer (`photo.tsx`) vs reveal 4

- Scrim stops match the CSS (`photo.tsx:22-27`), name serif italic 32, meta 15 Soft, heart and save
  buttons at 1:2 flex, glass buttons.
- Landscape letterboxing: gap 2. Off-centre position label: gap 9.
- The like state uses the fill weight in Paper (`photo.tsx:226`). The brand reserves fill for
  selected states, so that's right, but there's no animation; a small scale bounce would help.
- The toast for saved and reported (`photo.tsx:212-216`) appears between the name and the buttons
  and pushes the buttons down by about 40 pt while it shows. Float it instead.
- The image `transition` is 150 ms from the thumb placeholder (`photo.tsx:248-253`); on the web the
  swap from 512 px to full size is visible as a sharpen. Fine.

### Recap (`recap.tsx`) vs reveal 5

- Bars, title serif 48, subtitle 15, two glass and primary buttons match. "Save photo" replaces
  "Save video" by decision (`plan.md` Results, phase 4).
- With 12 slides the bars become short dashes (`app-recap.png`); fine.
- The close button sits 14 pt under the bars (`recap.tsx:133`) and is a 48 pt glass square. The
  design has no close; a smaller X aligned with the bars' right end would feel lighter.
- Upscaling: gap 6. There is no fade between slides (`recap.tsx:105` remounts `Slide` with a 400 ms
  image transition from the thumb placeholder, so each slide starts soft then sharpens).
- Paused state has no visual indicator (`recap.tsx:110-113`).

### Invite sheet from the camera and event (`event.tsx:799-826`)

- `app-camera-invite.png`: the cream card in the dark sheet, QR 200, title serif 30, then a dark
  "Share link" button. Looks right. The sheet slides over the camera with a 55% backdrop
  (`ui.tsx:1140`).

### Host note on the web (`home.tsx:554-576`)

- `app-host-note.png`: wordmark, serif 33 title with an orphan "app" (gap 3), and two buttons that
  both open the site home (`home.tsx:566-570`). The scratchpad's store button style (`.store`) isn't
  used. Real store badges or one button per platform with the right link would look finished.

### Host screens (native only, unverified)

- Create step header: the back arrow is placed on the progress line with `marginTop: -15`
  (`create.tsx:858-866`). The design has no back control there; the arrow is fine, but negative
  margins are fragile with larger text.
- Invite after creating (`create.tsx:797-808,894-896`): the close button is absolutely positioned at
  the left of a centred 33 pt title. "Your film is ready" is about 260 pt wide in 358 pt, leaving
  about 49 pt each side for a 48 pt button: they nearly touch, and with Dynamic Type or a longer
  string they will overlap. Put Done in the footer, or put the close in its own row.
- Invite buttons add Printer and Export icons (`create.tsx:782-793`); the design has text only.
  Minor, but the rest of the app keeps text-only buttons for screen actions.
- Look cards (`create.tsx:567-599`) reproduce the design's gradient and type. Natives use the Skia
  shader, so previews differ from the scratchpad's CSS filters by design.
- Slider ticks are `space-between` under a track inset 6 pt (`ui.tsx:1077,1101`), so the middle
  labels don't sit under their stops (15, 24 and 36 aren't at 25/50/75%). Same in the design, but
  the thumb snapping makes it noticeable. Position labels at their stop fractions.
- Toggle on-state is a Paper track with a Night knob (`ui.tsx:533-554`); the design only draws the
  off state. Fits "white as the only button colour".
- Disabled Continue (step 2 without a title) is cream at 40% (`ui.tsx:345`), the same grey as the
  join name step.
- Events list cards (`home.tsx:376-428`) aren't in the design. 240 pt cards with radius 22, a glass
  chip and a Candle live dot. Every card's gradient uses the same SVG id `card`
  (`home.tsx:405`); identical definitions so no visible bug, but `Scrim` already solves this with
  `useId`.
- Welcome (`home.tsx:50-111`) isn't in the design either; it uses the wedding hero photo at 62%
  height. Unverified.
- Settings (`home.tsx:432-521`): grouped Surface rows with hairline dividers, "Delete account" in
  Candle (gap 8).

### Live Activity (`targets/activity/LingerActivity.swift`), unverified

- The palette is hard-coded in Swift (`LingerActivity.swift:21-27`), matching `ui.tsx` today but
  with nothing keeping them in step. The design's bar is Candle on `#333`; Swift `track` is `#333`,
  matching. Not rendered here.

## Native-only items to check on the simulator (unverified)

- Newsreader optical size on iOS (same TTF, so expected to match gap 1).
- `blurRadius` 42 on developing tiles and 4 on the join backdrop look the same as the web's 18 and 4.
- `lineBreakStrategyIOS` behaviour for titles.
- Page-sheet People modal with its extra close button.
- Moment top spacing with real safe areas.
- Invite close button against the title on an iPhone SE width (375 pt) and with larger text.
- Haptics: only the shutter has one (`shutter.tsx:108-110`); the reveal, likes and the toggle
  don't.

## Files

- Screenshots: `.docs/vision/shots/design-*.png` (32) and `.docs/vision/shots/app-*.png`.
- The Playwright scripts were kept in the session scratchpad, not in the repo.
