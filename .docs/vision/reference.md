# Reference: what the best shared event cameras do

Research for the "finished product" pass, written 2026-11-02. It covers what the leading
shared-event-camera apps do in the small details, what people praise and complain about, and how
Linger compares today, both the approved scratchpad
(`../smallwares/.scratchpad/linger/index.html`) and the code in `apps/`. The last section ranks
what to adopt by how much it changes whether Linger feels finished.

Sources are store listings, vendor pages and review aggregators, read on 2026-11-02. Several
comparison pages are written by competitors (Knipsmig, Wedibox, Yogile), so their prices and
claims about other apps are treated as approximate. Nothing here was verified by installing the
other apps.

## 1. The field in late 2026

| App | Guest join | Reveal | Look | Pricing (one-off, per event) | Notable |
| --- | --- | --- | --- | --- | --- |
| **Once** (once.film, 10xCompany, iOS hosts) | QR to App Clip on iPhone, mobile web on Android; no account | Host-set time, or instant | Film look on photos; disposable-camera framing everywhere ("developing", "roll", "shots") | 10 guests $1.99, 25 $4.99, 50 $14.99, 100 $29.99, 150 $49.99; add 10/25/50 guests $3.99/$9.99/$19.99; 50 + unlimited shots $24.99, 100 + unlimited $39.99 | 4.8 from 710 ratings. Live Activity (shots and countdown in the Dynamic Island) since 1.2. Recent releases: Guest Book (a polaroid with a short note, 1.8.0), "Tapes", film branding, email sign-in, **remove participants**, "improved returning guest experience" and "photo recoverability" (1.8.1). Recap video. |
| **POV** (Untitled Tech) | QR or link, no install; NFC chips sold as add-on | Live during event or next day | Date stamp praised; some users wanted a stronger disposable filter | Free to 10 guests, about $4.99 for 25 up to $89.99 for 250; business tiers higher | 4.9 from 16K ratings, the category leader. Live slideshow, custom branded screens (stickers, text, backgrounds), audio guestbook, host web dashboard to delete, sort and favourite, "delete duplicates before you buy the album". 11 languages. |
| **Scene** (2026) | QR, no download or sign-up | Sealed until reveal, all at once | Original, Vintage, B&W for the whole event; original never altered | Free to 5 guests (first 10 events); 10 $2.99 ... 150 $59.99; unlimited shots $9.99; video $9.99 | Offline-first uploads. Full phone resolution, no watermark. Save all to camera roll at full size. Big-screen slideshow link with no login. Guests can add photos for 30 days after (host can turn off). Audio guestbook. Cover crop with live preview. Complaint: price only shown at the end. |
| **Lense** | Link or QR, name, shoot; lock-screen access on iPhone | Instant, delayed (12 to 24 h) or private | Optional vintage effect | Free to 7 guests; paid prices by email | Live Photo Wall on any TV with every event. Uploads from camera roll. Inappropriate-content filter. Host review and delete before the reveal. 12 months storage. |
| **Party Cam** | App Clip on iPhone | Live or delayed | Film filters | $1.99 (15) to $149.99 (500), no free tier | Full-res downloads, no watermark, moderation. |
| **Filmly** | QR, tap to join; web guest mode | Blurred until reveal | Film | Not listed | Live Activity with shots and countdown, 30-second "AI Reel" recap, full-res downloads, host moderation. |
| **Lapse** (friends, not events) | Install | Random develop, usually same day, with a notification | Warm grain on every photo | Free | Camera framed like Apple's, inset viewfinder, big white shutter, a fanned stack of recent shots bottom left, emoji reactions that animate on screen. Praised for the "mystery" of waiting. |
| **Dispo** | Install | Develops at 9am next day by default | Disposable look | Ads or subscription | Complaints about ads per develop and a $60/yr paywall. The 9am ritual is the part people remember. |
| **The Guest, Wedibox, Knipsmig, EventSnap** | Upload from the normal camera roll, browser | Mostly live | None | Varies | Album collectors, not cameras. Useful as the contrast: no scarcity, no reveal, ZIP downloads, Google Drive sync, co-hosts. |

### What people praise (across POV, Once, Scene reviews)

- Guests didn't have to download anything. This is the most repeated line in POV reviews.
- The delayed reveal: "the delayed photo release the day after the event added to the surprise"
  (Once), "the delayed gratification of the photos was well worth it" (POV).
- Seeing who took each photo (Scene).
- Cheaper than a photographer, and different angles from it.
- Reliability, called out as the reason to pick Once over others for a wedding.
- The vintage look and the date stamp (POV).

### What people complain about

- **Guest onboarding friction at the event**: registration steps, long setup (Once's host
  onboarding is 17 steps), Android guests excluded or forced to install. Top complaint in POV
  review analysis.
- **Missing photos**: "the album only has 2 of my pictures" with about 160 missing across a group
  (POV). Once's latest release note is about "photo recoverability". Lost photos are the one
  failure people never forgive.
- **No word when the gallery opens**: POV users asked for a text "when it closed to see the
  gallery", and reminders to keep shooting.
- **Only the host can see or export** (POV): guests wanted to save the photos themselves.
- **Watermark on exports** (Once): one reviewer switched apps over it.
- **Can't upload from the camera roll** after the event (Once, POV). This is the product
  working as designed, but it surprised people because it wasn't said up front.
- **Price shown late** (Scene), **charged twice** (POV), web and in-app prices that differ
  (Party Cam, POV).
- **Glitches**: previews not loading, events not showing up for some guests, printing QR codes
  failing.

## 2. The details that make these feel finished

Grouped by moment. Each line says what the best apps do, then where Linger is now.

### Joining in seconds

- **App Clip on iPhone from the printed QR.** Once and Party Cam ship one; it's the difference
  between "scan, tap Open, shoot" and "scan, open Safari, allow camera in the browser".
  Linger: none. `plan.md` Results (phase 9) measured a React Native clip at over the 15 MB
  physical-invocation limit, so it would have to be a small native SwiftUI join-and-camera clip.
  The scratchpad's shoot act says "an App Clip on iPhone, the browser on Android"
  (`index.html:295`).
- **No account, name only.** Everyone does this. Linger matches: invite, name, camera permission
  (`apps/app/src/join.tsx:22`, `:150-185`). The name step remembers the last name used
  (`join.tsx:62`).
- **Returning guest.** Once just shipped "improved returning guest experience". Linger keys a guest
  to a device id (`api.ts` `deviceId()`); a guest who clears browser storage or switches from
  Safari to the app is a new guest with a fresh allowance, and after the reveal "only guests who
  already joined get back in" (`plan.md` phase 8). There is no way to reclaim an identity.
- **Say the rules before the first shot.** Linger's invite line does this well: "24 shots each.
  Photos appear tomorrow at 10:00." (`copy.ts:139`, `join.tsx:24-35`). Nobody else is this clear.
  Worth adding the one rule that surprises people elsewhere: photos come from this camera only,
  not the camera roll.

### Camera feel

- **Film look live in the viewfinder.** Once, Scene and Lapse show the look before you shoot; the
  scratchpad draws the viewfinder through `f-warm` (`index.html:420`). Linger's native preview is
  plain (`apps/app/src/camera.tsx:22-24`, `qa.md` known gaps); only the thumbnail and the developed
  photo carry the look. The web camera does show it as a CSS filter (`camera.web.tsx:11-12`).
  This is the biggest gap between the design and the app on the camera.
- **Shutter sound and haptics.** A disposable camera is a click and a wind. Linger fires one
  medium impact (`shutter.tsx:108-110`) and a white blink (`:111-113`). No sound, no second
  "advance" tick after the capture, no distinct haptic for the last shot or for "That's your
  roll".
- **Counter by the shutter.** Linger's rolling serif counter (`shutter.tsx:350-394`) matches the
  scratchpad (`index.html:422`) and is better than the plain "17 shots" text elsewhere. Missing:
  a low-shots state (for example Candle on the last 3), which costs nothing and adds tension.
- **Flash, flip, 0.5x.** Present (`shutter.tsx:209-237`, `camera.tsx:178-190`). Missing details
  every native camera has: tap to focus and expose, pinch to zoom, a front-camera screen flash for
  selfies in the dark (party photos are mostly at night), and the flash state remembered between
  sessions.
- **Last shot.** Lapse shows a fanned stack of recent shots; the scratchpad shows one thumbnail
  (`index.html:422`). Linger's thumbnail leaves the camera for the event (`shutter.tsx:263-276`),
  which is abrupt for a guest who wanted a glance. A small "developing" card that springs from the
  shutter to the thumbnail would carry the metaphor.
- **Time left on the camera.** Present in the top bar (`shutter.tsx:142-146`), refreshed every
  30 s (`:69-72`).
- **Offline.** Linger's queue survives restarts (`uploads.ts`), matching Scene's offline-first
  claim. The camera itself says nothing while photos wait; the pending line only shows on the event
  screen (`event.tsx:503-509`).

### Anticipation before the reveal

- **Developing grid.** Once: "Ayla's 3 photos are developing...". Lapse: blurred, locked tiles.
  Linger draws developing tiles from the blurred cover, offset per tile (`ui.tsx:966`,
  `plan.md` phase 4), with counts only. Missing: a personal line ("Your 7 photos are
  developing") and the guest's own count, which is what a guest actually wants to know.
- **Live Activity.** Once and Filmly ship one with shots and countdown. Linger's is on par: title,
  shots left, a Candle bar, moments so far, reveal time (`targets/activity/LingerActivity.swift`,
  `src/activity.ts`). Gaps: it can't be ended or updated from the server (no ActivityKit push
  tokens, `plan.md` phase 9), so a phone that never reopens the app shows a stale "The photos are
  ready." without the counts.
- **Reveal reminder.** Native: a local notification at the reveal (`event.tsx:217-237`). Web: none
  (`event.tsx:219` returns on web). Browser guests, which is every Android guest and every iPhone
  guest until there's an App Clip, get no word at all. POV users asked for exactly this. Options:
  an optional email or phone number on the name step, an "Add to calendar" `.ics` link with the
  join URL, or both.

### The reveal moment

- **The notification is the event.** The scratchpad copy is "Emma & Daniel's Wedding: the photos
  are ready. 4,293 moments from 203 people." (`index.html:431`). The code sends the title and
  "The photos are ready." (`apps/api/src/reveal.ts:41-43`, `copy.ts:264-265`). The counts are the
  hook; they should be in the push and the local notification. Locally the push is skipped
  without `EXPO_ACCESS_TOKEN`, so this is untested end to end.
- **One moment for everyone.** Linger's fan of three cards (`event.tsx:621-685`) matches the
  scratchpad (`index.html:434-436`). Details to finish it:
  - The three cards are `items[0..2]` (`event.tsx:651`), and the gallery is ordered by `takenAt`
    ascending (`apps/api/src/shots.ts:352`), so the reveal shows the first three photos of the
    night, which are usually arrival shots. Pick three from different photographers spread across
    the event, or the guest's own best plus two others.
  - No haptic when the fan opens, and no sound. This is the one place a soft success haptic is
    earned.
  - The moment shows once per device when a revealed gallery first loads (`event.tsx:379`), and
    never for right-away events while they're live (`plan.md` phase 4), so right-away events get
    no closing moment at all.
  - A personal line: "12 of these are yours." Nobody else does this and it's cheap.

### Gallery and recap

- **Signed photos.** Linger signs every photo ("Photo by", `copy.ts:202`) and has per-person rolls
  (`event.tsx:687+`), matching the scratchpad's people screen. On par or ahead.
- **Viewer.** Position, share, like, save, report/hide are there (`photo.tsx`). Missing basics:
  pinch to zoom, double-tap to like, swipe down to close.
- **Recap.** Once and Filmly produce a recap video ("AI Reel", 30 s). The scratchpad promises "The
  whole night in 60 seconds" with "Save video" (`index.html:444-446`). Linger plays up to 12 photos
  for 5 s each in-app and saves the current photo (`recap.tsx:20-35`, `plan.md` phase 4). Two
  details: it ranks by likes, which are all zero at the moment of the reveal, so the first recap
  is the first 12 photos by time (`recap.tsx:33-35`); and it draws from the gallery pages already
  loaded, not the whole event. A server-rendered MP4 (or a still-image slideshow encoded on device)
  is what makes the recap shareable, and sharing is how the next host hears about Linger.
- **Live slideshow.** POV, Scene and Lense all offer a no-login big-screen link. For right-away
  events at a venue it's the feature hosts mention. Linger has nothing yet.

### Sharing and downloads

- **Anyone can save.** Linger lets every member save all (`event.tsx:410-426`), which answers the
  POV complaint that only the host could export. Keep it.
- **How "save all" works.** It saves photos one at a time to the library and stops at the first
  failure (`event.tsx:418-424`). For 300 photos that is minutes with the screen open. Competitors
  offer a ZIP by email or a web download for hosts. A host ZIP link (built by a job, emailed and
  shown on the event) covers weddings; the on-device loop can stay for guests but should resume
  rather than stop.
- **Resolution.** Scene and Party Cam advertise full phone resolution and no watermark. Linger
  keeps a 2048 px developed JPEG and deletes the original after developing (`plan.md` phase 2 and
  phase 8). That's a privacy win but a quality step down for a wedding; state it plainly or keep a
  full-size developed copy.
- **No watermark.** Correct. Once lost a reviewer over it.
- **Date stamp.** POV reviewers single it out. An optional orange date stamp on the Warm '98 look
  would be a small, very "disposable" detail (`packages/core/src/film.ts` has none).

### Host controls

What competitors let a host do after creating the event, against Linger's app:

| Control | Once / POV / Scene / Lense | Linger API | Linger app |
| --- | --- | --- | --- |
| Change reveal time, visibility | Once, Scene | `PATCH /v1/events/:id` | Not wired (`api.ts:256-268` has no update) |
| End early | Most | `POST /v1/events/:id/end` | Removed (`plan.md` phase 8) |
| Add guests when full | Once (+10/+25/+50 packs) | Tiers raise the limit | No path; a full event tells guests "Ask the host to make room" (`copy.ts:153`) and the host has no button |
| Remove a guest | Once (1.7.x) | None | None |
| Review or delete before reveal | POV, Lense | Not allowed by the reveal rule | None |
| Hide after reveal | All | `POST /v1/shots/:id/hide` | Yes (`photo.tsx:128`) |
| Live slideshow | POV, Scene, Lense | None | None |
| Branding / cover | POV, Once | Cover upload | Cover in step 2 |
| Co-hosts | Knipsmig | None | None |

### Moderation and safety

- Report copy promises "The host will be told." (`copy.ts:219`). Nothing tells the host: the
  report route only counts and hides at three (`apps/api/src/shots.ts:487-511`). Either notify the
  host (push, plus a "Reported" filter on the event) or change the copy.
- Lense runs an inappropriate-content filter. Linger's rule that nobody sees photos before the
  reveal makes pre-reveal host review a product decision, not a bug; the three-report hide is the
  backstop now.

### Notifications

Best-in-class set, as observed across the apps: reveal (all), "the camera closes in 30 minutes"
and "you have N shots left" reminders (requested in POV reviews), first-photo-at-your-event for
the host, "the gallery is open" for web guests by email or SMS. Linger sends one, the reveal
(`reveal.ts`, `event.tsx:217-237`), and asks for permission on first opening the event screen
before the reveal (`event.tsx:222`), which is a cold prompt with no explanation.

### App Clip and web fallback

Covered under joining. The web fallback is complete for shooting and viewing (`qa.md` web
section), and its host note is clear (`copy.ts:132-136`). What it lacks is the reminder above and
an "Add to Home Screen" hint for guests who will come back for the gallery.

### Pricing presentation

Linger is competitive and simple: free to 10, $9.99 to 30, $19.99 to 80 (Popular), $34.99 to 150,
$49.99 to 250, unlimited shots $9.99 (`packages/core/src/pricing.ts`). Once is cheaper at the low
end ($1.99 for 10) but Linger's free 10 beats it. What competitors do that Linger doesn't:
- **Top-up packs after going live** (Once: +10/+25/+50). Linger's tiers can be bought later in the
  API (`due()` in core) but not from the event screen.
- **Same price everywhere.** Party Cam and POV are criticised for web and in-app prices that
  differ. Linger reads one table from core for app and site; keep that true when store prices are
  set per region.
- **Price up front.** Scene is criticised for revealing the fee at the end. Linger shows the price
  on step 5 and in the button ("Start my film for $19.99", `copy.ts:108`); the site shows it too.
  Good as is.

### Empty and error states

Linger's copy here is already more complete than most competitors' (`copy.ts:42-47`, `:153-159`,
`:174-180`, `:197-201`, `:243-247`). The finishing details:
- The camera has no offline indicator; photos taken offline only show as pending on the event
  screen.
- "Something went wrong" (`copy.ts:16`) is the fallback in several places where a specific line
  exists elsewhere.
- Lost photos are the category's worst failure. Linger already reserves with a `clientId` and keeps
  files until upload; surfacing "All 12 of your photos are safe" after uploads finish would make
  that reliability visible.

## 3. Where Linger is already ahead

- The rules on the invite sheet are clearer than any competitor's.
- The server keeps the secret: no URLs before the reveal for anyone, host included
  (`architecture.md`). Competitors' "only the host can see" confused POV users; Linger avoids that.
- Photos are signed and browsable by person.
- Everyone can save, no watermark, one-off pricing with a free tier, and a design system with more
  restraint than any app in the table.

## 4. What to adopt, ranked by how finished it makes Linger feel

1. **Live film look in the native viewfinder.** The design shows it, the web has it, the native
   app doesn't (`camera.tsx:22-24`). It's the first thing a guest sees.
2. **Reveal notification with the counts, and a better reveal moment.** Push and local copy as in
   the scratchpad (`reveal.ts:41-43`, `copy.ts:264-265`); choose fan photos across photographers
   instead of the first three by time (`event.tsx:651`, `shots.ts:352`); one success haptic; a
   personal "N of these are yours" line.
3. **Reveal reminder for browser guests.** Email or SMS opt-in on the name step, plus an `.ics`
   link (`event.tsx:219`). Without it most web guests never come back.
4. **Shutter feel.** Sound (respecting the silent switch), a second advance haptic, a distinct
   last-shot haptic, low-shots Candle counter, tap to focus, pinch zoom, front screen flash
   (`shutter.tsx:104-128`, `:350-394`).
5. **Host controls on the event screen.** Edit reveal time and visibility (API exists), end early,
   add guests when full, remove a guest. "Ask the host to make room" needs a host button behind it
   (`copy.ts:153`).
6. **Recap as a video file** that can be saved and shared, built from the whole event and from a
   selection that works before anyone has liked anything (`recap.tsx:20-35`).
7. **Bulk download that suits a wedding.** A host ZIP by email or web link; the device loop resumes
   instead of stopping (`event.tsx:410-426`). Decide on full-size developed copies.
8. **Developing state that speaks to the guest.** "Your 7 photos are developing", their own count
   on the event and on the camera, and an offline indicator on the camera.
9. **Report flow that does what it says.** Tell the host, or change the copy (`copy.ts:219`,
   `shots.ts:487-511`).
10. **Returning-guest recovery.** A way to get back into an event from a new browser or after
    installing the app, keeping the same name and shot count.
11. **Viewer gestures.** Pinch zoom, double-tap like, swipe down to close (`photo.tsx`).
12. **Notification set and permission timing.** Ask after the first photo with a reason, add
    "camera closes in 30 minutes" and "N shots left" reminders, and Live Activity pushes so the
    lock screen ends with the counts.
13. **Native App Clip** (SwiftUI join and camera under 15 MB). Highest effort; the browser path
    works meanwhile.
14. **Smaller delights later**: optional date stamp on Warm '98, big-screen slideshow link for
    right-away events, a guest book note (Once 1.8.0), a closing moment for right-away events.

## Sources

- [Once site](https://once.film), [Once on the App Store](https://apps.apple.com/us/app/once-disposable-camera-event/id6754265953), [ScreensDesign: Once](https://screensdesign.com/showcase/once-disposable-camera-event)
- [POV on the App Store](https://apps.apple.com/US/app/id1636032890), [POV pricing](https://pov.camera/pricing), [POV reviews (JustUseApp)](https://justuseapp.com/en/app/1636032890/pov-disposable-camera-events/reviews), [POV business](https://pov.camera/business)
- [Scene on the App Store](https://apps.apple.com/app/id6758879648), [Filmly](https://mwm.ai/apps/filmly-shared-camera/6773657111), [Lense](https://lense.app/)
- [Knipsmig comparison, July 2026 (competitor-authored)](https://knipsmig.com/best/disposable-camera-apps)
- [Lapse on Fueled](https://fueled.com/blog/lapse-disposable-camera-provides-retro-vibes/), [Dispo on the App Store](https://apps.apple.com/us/app/-/id1491684197)
- [Wedibox comparison](https://www.wedibox.com/compare/best-wedding-photo-sharing-apps), [Airdroid roundup (The Guest)](https://airdroid.com/screen-mirror/best-wedding-photo-sharing-apps)
