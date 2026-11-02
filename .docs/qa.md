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
      with email" and, in development, "Continue as demo host".
- [ ] Titles use Newsreader and controls use Pretendard. Candle (#E9C99A) is the only accent.

## Host on iOS

Sign-in and account

- [ ] "Continue with email": enter an address, a 6-digit code arrives in Mailpit, entering it signs
      you in.
- [ ] A wrong code shows an error; after 5 wrong tries the code stops working.
- [ ] Sign out from Settings, then "Continue as demo host" signs in as Alex Morgan.
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
      "Show join code" and the developing tiles. No photo is visible before the reveal.
- [ ] "People ›" opens the people sheet with names and when they joined.
- [ ] The notification prompt appears, and a local reminder is scheduled for the reveal.

## Guest on iOS

- [ ] `linger://j/MAYA3X` opens the join sheet over the blurred cover: "You're invited to shoot
      Maya turns thirty", the rules line and "Open camera".
- [ ] "What should we call you?" accepts a name; the camera permission step follows.
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
- [ ] "Download all photos" shows "Saving N of 24" and ends with "24 photos saved to Photos".
- [ ] To watch a live reveal: create an at-end event that ends in a few minutes, join and shoot,
      then wait. The gallery switches to photos within about 30 s, the local notification fires
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
- [ ] Host routes (`/`, `/new`) show "Hosting happens in the app" with store buttons.
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

## Known gaps

These are expected and don't need a bug report:

- The native camera preview has no live film look; the look shows on the thumbnail and the
  developed photos.
- Reveal pushes are skipped locally; the local notification stands in.
- No App Clip; guests without the app use the browser.
- The development client's gear button can overlap controls at the screen edges.
- The legal pages contain bracketed placeholders for a lawyer.
