# Launch review

The final round before testing, verification and App Store submission. It covers how photos are
stored and served, where the backend runs and how it scales, and the correctness gaps in the
product. The findings come from three reviews of the code on 2026-11-04, and the blockers were
checked again against the code before they went in here. Full notes, with file and line
references for every item, are in `.docs/review/` (media.md, backend.md and product.md).

Measurements are from this Mac (an M4 Pro, local Postgres and RustFS). Anything said about
Render or Cloudflare is an estimate until it runs there.

## Status

Last updated 2026-11-07. Stage: 2 of 7, reveal correctness, with the deploy setup (stage 4)
started alongside. The steps to deploy are in `.docs/deployment.md`.

| Stage | State |
| --- | --- |
| 1. App Store blockers (B1 to B3) | Done 2026-11-04 |
| 2. Reveal correctness (B4 to B7) | In progress: B7 done |
| 3. Storage on R2 (B8, B9, F1 to F7) | Not started |
| 4. Deploy on Render and Neon (B10, B11, F18 to F21) | In progress: config, F18, F19 done |
| 5. Remaining fixes (F8 to F17) | Not started |
| 6. Device pass, TestFlight, App Store Connect | Not started |
| 7. Submission, launch and live users | Not started |

## How this document is kept

This is the one list Linger works from until it's in the store with live users. Every item has an
id (B for blockers, F for fixes, D for decisions, S for submission and launch) and a checkbox.

- When an item is done, tick it and add the date and how it was checked, for example
  `[x] 2026-11-05, API test and simulator`. Don't delete items.
- New problems found in testing, review or from live users go in as new items with the next id,
  under the right heading, and the stage table is updated.
- Decisions get their answer written next to them, and a dated line under Results in `plan.md`
  when they change the plan.
- The change log at the end gets one line per update.

## Recommendations

### Photos: Cloudflare R2 behind Cloudflare's cache

Today every gallery request signs two one-hour S3 URLs per photo, and nothing sits in front of the
bucket. On the phone, expo-image caches by photo id, so a fresh signature doesn't download a photo
again. On the web, expo-image ignores that cache key, so each refresh downloads every visible tile
again. The recap never renews its URLs, so slides that weren't cached fail after an hour.

The recommended setup:

- A `linger-media` R2 bucket on a custom domain, `media.lingercam.app`, served through Cloudflare's
  cache. Every object is stored with `Cache-Control: public, max-age=31536000, immutable`, and the
  cache key ignores the query string.
- Access by a timed HMAC token in the URL, checked by a WAF rule before the cache (or by a small
  Worker if the zone's plan lacks that rule). Tokens are cut on hour boundaries with a three-hour
  life, so a photo's URL stays the same within the hour. That fixes the web cache and lets the
  CDN serve the reveal spike.
- Hiding or deleting a photo purges its URLs from the cache. Covers stay outside the token rule,
  because link previews fetch them without a token.
- Uploads go to a separate private `linger-uploads` bucket with a one-day expiry rule, so an
  original can never outlive a failed develop or a deleted event.
- Keys: `e/{eventId}/{shotId}/full.jpg`, `grid.webp` and `thumb.webp`, and `c/{eventId}/{version}.jpg`
  for covers, so a new cover gets a new URL.
- A 1024 px WebP grid image (about 56 KB) for tiles. Today's 512 px tiles are stretched to between
  1.6 and 2 times their size on every 3x iPhone screen. The full photo stays JPEG, because that's
  what Save to Photos keeps.

Developing stays on sharp. Cloudflare Images can't apply the film looks, and would cost far more
than the rest of the setup. R2 has no egress fees, so the cost is storage and operations: about
1.2 GB per 6,000-photo event today, 1.7 GB with the grid image. At 1,000 events a month that's
roughly $18 to $26 of new storage a month plus about $100 of write operations, before archived
events move to Infrequent Access.

### Backend: stay on Render, split into two services

Nothing in the code calls for another host. Cloudflare Workers can't run sharp or pg-boss, and
Fly.io and Railway offer nothing specific here. The change is to stop running everything in one
process.

| Service | Plan | Runs |
| --- | --- | --- |
| `linger-api` (web) | 1 CPU, 2 GB, $25 | HTTP only; sends jobs but runs none |
| `linger-worker` (background) | 1 CPU, 2 GB, $25 | pg-boss workers, the crons, sharp |
| Postgres | 0.5 CPU, 1 GB, 10 GB disk, ~$22 | Moves to 1 CPU, 4 GB ($55) once weekends run 5+ events at once |
| Workspace | Pro, $25 | Autoscaling and 7 days of point-in-time recovery |

That's about $97 a month at launch and $165 to $180 with busy weekends. Migrations move to Render's
pre-deploy step, so they run once per deploy instead of on every instance. The region is Ohio, next
to the Neon database (changed from Oregon on 2026-11-07).

Developing a 2048 px photo takes 160 to 250 ms here, and the film look holds the event loop for 26
to 106 ms of that. On a Render CPU it's likely 0.4 to 0.7 s, so a busy Saturday (20 events, up to
120,000 photos) is 9 to 18 CPU-hours of developing. That's why it belongs on the worker, with its
concurrency tuned there.

### A shared backend

Supabase, Firebase, Convex and Appwrite were weighed against the current API. Each would mean
rewriting about 3,000 lines of tested API and 2,500 lines of tests, none of them runs sharp, so a
Node worker would still be needed, and none of them fixes the gaps below. The recommendation is to
keep the Hono API on Render and use managed pieces around it: R2 for photos, Neon for Postgres
(decided 2026-11-07, replacing Render Postgres; see B10), Sentry for errors, and an email
provider with SPF, DKIM and DMARC set up. Neon Auth isn't needed: sign-in is an emailed code and
guests have no accounts, so it would replace working code without fixing anything.

## Blockers

These stop submission or break a promise the product makes.

- [x] **B1.** **App Review can't sign in as a host.** Sign-in is by emailed code only, and the demo routes
      are off in production. Add a review account set by environment (`REVIEW_EMAIL` with a fixed
      code), seeded with a live event, a revealed event and a draft, and put its code in the review
      notes.
      Done 2026-11-04: `REVIEW_EMAIL` and `REVIEW_CODE` sign in with the fixed code and send no email (startup refuses an email without a six-digit code); `pnpm --filter api review-seed` gives the account a live right-away event RVW4PP, a revealed wedding RVW8TF and a draft. Checked by API tests and a local seed. Setting them on Render is in S2.
- [x] **B2.** **Missing microphone purpose string.** `app.config.ts` turns the microphone permission off, but
      VisionCamera always compiles `requestAccess(for: .audio)`. App Store Connect's binary check can
      reject that. Add an honest `NSMicrophoneUsageDescription` (Linger takes photos only, no sound)
      and never request it.
      Done 2026-11-04: `NSMicrophoneUsageDescription` set in `app.config.ts`, for expo-image-picker as well. Linger never requests the microphone. Checked in the built Info.plist.
- [x] **B3.** **User-generated content rules (guideline 1.2).** Report and hide exist. Missing: a way for the
      host to remove a guest, a way for anyone to hide a person, a terms and privacy line on the join
      sheet, and reports reaching Linger as well as the host, as the terms promise.
      Done 2026-11-04: the host removes a guest (with their photos and likes, and that phone can't rejoin) from the photo menu or by holding their name in People; anyone can hide a person's photos on their phone; the join sheet links the Terms and Privacy Policy; every report emails `MODERATION_EMAIL` (support@galleo.app). Checked by API tests and on the simulator.
- [x] **B4.** **Late reveals are only caught at startup.** `revealOverdue` runs once when the server boots. A
      reveal job that fires early, or is lost, leaves the event developing until the next restart.
      Add a sweep every minute, and an index on `events.state`.
      Done 2026-11-08: the worker runs `revealOverdue` every minute (`reveal-sweep`), and
      `events.state` has an index (migration 0006). API test: an event whose reveal job never ran is
      revealed by the sweep.
- [x] **B5.** **Reveal notifications don't scale and can be lost.** The reveal job sends the push and then
      each email in turn, over SMTP without pooling, one event at a time. With 20 events revealing
      together, the last could wait 20 to 30 minutes. Emails are marked sent before they go out, so a
      crash partway loses the rest. Send through a queue with one job per email, and mark each sent
      after it goes.
      Done 2026-11-08: the reveal sends the push, then queues one `reveal-email` job per guest
      (retried with backoff for about an hour) that marks `emailedAt` only after the send. SMTP
      connections are pooled, and four reveals and four emails run side by side per worker. API
      tests: a failed send stays unmarked and the retry delivers it once.
- [x] **B6.** **A venue's shared Wi-Fi can lock everyone out.** The code-miss limiter is checked on every
      request that carries a code, keyed by IP. Twenty mistyped codes from one venue's Wi-Fi or a
      carrier's network block gallery polling for every guest there for 10 minutes. Check it only
      when the code doesn't exist, and key it more finely.
      Done 2026-11-08: a device already in the event is never checked, so polling carries on. Misses
      count per address and device (20 in 10 minutes), and the address alone only against 300, so
      one phone mistyping on a venue Wi-Fi blocks only that phone. The limit is still checked before
      a lookup reveals whether a code exists, otherwise a 404 or 429 would tell a guesser which
      codes are real. API test: a phone over its limit is refused while a joined guest and a new
      guest on the same address carry on.
- [x] **B7.** **pg-boss has no error listener.** A database blip during its maintenance crashes the process.
      Done 2026-11-04: it happened in testing. The local storage container was killed, a pg-boss poll
      timed out, and the unhandled "error" event stopped the API. `db.ts` now logs pg-boss errors and
      pg-boss retries on its own. Checked by restarting the API and rerunning the Maestro suite.
- [x] **B8.** **Photos of deleted events can stay in storage.** A develop that finishes after a delete writes
      the photo back, and an upload URL stays valid for 15 minutes after its event or account is
      gone. Both leave full JPEGs, with location, that the privacy policy says are deleted. The
      uploads bucket's expiry rule fixes most of it; developing should also check the photo still
      exists before writing.
      Done 2026-11-08: a develop that finds its shot gone after writing removes what it wrote, and
      deleting an event, or a guest with photos still uploading, removes the files again after every
      upload URL has run out (`afterUploadsExpire`). The R2 expiry rule for originals is still worth
      adding as a backstop; originals share their folder with the developed photo, so it needs its
      own prefix first. API test: a photo developed while its event is deleted leaves nothing.
- [x] **B9.** **No production CORS on storage.** Only the local rules exist, so browser uploads and web Save
      and Share would fail on R2.
      Done 2026-11-07: the `lingercam` R2 bucket allows GET, PUT and HEAD from join.lingercam.app
      and lingercam.app (`wrangler r2 bucket cors list lingercam`). Checked from a browser when the
      API is live.
- [x] **B10.** **The database plan.** The current plan has a tenth of a CPU and no point-in-time recovery.
      2026-11-07: decided Neon Launch in AWS us-east-2 (Ohio), with Render in Ohio beside it, 0.5 to 2 CU, scale to zero off, the
      longest restore window. `render.yaml` takes Neon's direct connection string, and the API
      drops Neon's `channel_binding` parameter, which the Postgres client would otherwise send to
      the server and fail on (tested). Ticked when the project exists and production runs on it.
      Done 2026-11-07: production runs on it; `/health/deep` passes from api.lingercam.app.
- [ ] **B11.** **No error tracking or alerting.** Add Sentry across the app, the web build and the API, and an
       alert for any event past its reveal time that hasn't revealed.

## Fix before launch

Grouped by area. Each one has a failure that a real event can hit.

**Developing and storage**

- [x] **F1.** Develops give up after three quick retries, so a short storage outage leaves a shot uploaded
      forever: never shown, never refunded, original kept. Sweep old uploaded shots, retry with
      backoff, then mark failed and refund.
      Done 2026-11-08: develops retry with backoff for about three hours, and a sweep every 15
      minutes queues uploaded shots again when no job is waiting (after 30 minutes) and fails and
      refunds them after six hours. API test.
- [x] **F2.** Develop reads the whole upload into memory after only a size check at confirm, so a file swapped
      in afterwards can run the instance out of memory. Check the size again before reading.
      Done 2026-11-08: the develop checks the size again before reading the file, and fails and
      refunds an original that is missing or over the limit. API test.
- [x] **F3.** Deleting a photo removes its row before its files, so a storage failure orphans them.
      Done 2026-11-08: the row goes first and the files follow in a `remove-files` job retried for
      most of a day, so a storage failure delays the delete instead of orphaning the files. The same
      job removes a removed guest's photos.
- [x] **F4.** Deleting an event or an account runs inside the request: about 18,000 objects for a 6,000-photo
      event, against the app's 20-second timeout. Move it to a job.
      Done 2026-11-08: the rows are deleted in the request and the files in a `remove-files` job
      (`deletion.ts`). API tests wait for the job.
- [x] **F5.** Account deletion skips each event's teardown, so guests' reveal reminders still fire for deleted
      events. Run the event teardown for each one.
      Done 2026-11-08: account deletion runs `deleteEvent` for each event: devices hear quietly,
      queued checks are cancelled and the files go in a job. API test: a guest phone gets the quiet
      "deleted" push and the event's checks are gone.
- [ ] **F6.** Covers: `hasCover` is set before the upload, so a failed upload leaves a broken link. HEIC is
      accepted, which most link previews can't show, and covers up to 15 MB are served as the preview
      image. Convert to JPEG on the device, and set the flag after the upload.
- [ ] **F7.** The recap never renews its URLs, and Save all stops at about 6,000 photos.

**Joining and abuse**

- [ ] **F8.** "Make room" is still offered, and sold, after joins have closed. Gate it on `joinsOpen` in the
      app and the API.
- [ ] **F9.** Joins have no rate limit, so a script with the code can fill a free event's 10 places. Add a
      per-IP join limit alongside Remove guest.
- [ ] **F10.** Late uploads trust the phone's time, so someone who joined after the end can add photos for up
      to 7 days after the reveal. Require the photo's time to be after the guest joined.
- [ ] **F11.** The rate limiter lives in memory per instance, so it doesn't hold with two or more instances,
      and it slows down past 50,000 keys. Move it to Postgres.

**Purchases**

- [ ] **F12.** A purchase that can't be applied after Apple charged is dropped without telling the host.
      Re-check what's due just before buying, and show a refund path when applying fails.
- [ ] **F13.** The startup check doesn't require the RevenueCat key, its webhook secret or the Expo push token,
      and `eas.json` doesn't set the RevenueCat public key. A release build without it calls the
      development claim and fails the reviewer's paid start.
- [ ] **F14.** Stripe refunds have no idempotency key, so a retried webhook can refund twice.

**Web guests**

- [ ] **F15.** On the web, the guest's place lives in browser storage, which Safari clears after 7 days without
      a visit. A guest returning for a reveal two weeks out is locked out unless they left an email.
      Ask for the email when the reveal is more than a few days away.
- [ ] **F16.** In iOS Safari, Share starts after a download, which Safari refuses on slow connections, and Save
      goes to Files. Load the photo when the viewer opens, and make Share the main way to save on iOS.
- [ ] **F17.** In-app browsers (Instagram, Facebook) report no camera. Tell guests to open the link in Safari or
      Chrome.

**Operations**

- [x] **F18.** The health check includes storage, so a storage blip fails every instance. Keep a shallow check
      for Render and a deep one for alerts.
      Done 2026-11-07: `/health` checks the database only, `/health/deep` adds storage. API test.
- [x] **F19.** The 5-second graceful stop is too short for jobs in flight.
      Done 2026-11-07: jobs get 30 seconds to finish, and Render waits up to 60
      (`maxShutdownDelaySeconds`).
- [ ] **F20.** Every guest polls exactly 3 seconds after the reveal, a burst of 200 to 400 requests per event.
      Add jitter in the app and a short per-event cache.
- [ ] **F21.** Expired sign-in codes are never cleaned up, and deleting a host also deletes purchase records
      that may need keeping for tax.

**Found in testing**

- [x] **F22.** Storage and network errors were logged with an empty message, because AWS SDK
      errors keep the detail in their name, code and cause. Done 2026-11-04: `errorDetail` includes
      them. Checked by API tests.
- [ ] **F23.** Local only: Docker's 3.8 GB VM runs about 23 containers across projects, and it
      kills Linger's storage container (exit 137) under load, which takes uploads and deletes down
      with it. Raise Docker Desktop's memory to 8 GB, or stop other projects' containers while
      testing Linger. Production storage is R2, so this doesn't carry over.
      2026-11-06: it happened again during the device setup, this time reported as
      `OOMKilled=true`, and it cut the seed short.
- [ ] **F24.** A photo tile that fails to load stays grey until the app restarts: expo-image
      doesn't retry, and the gallery keeps the failed URLs. Found when storage went down during the
      device setup; guests on weak venue Wi-Fi would see the same. Retry failed tiles when the
      screen regains focus, on pull to refresh and when the network comes back.

- [ ] **F25.** Large events loaded slowly and showed grey cards. Found 2026-11-07 on the festival:
      the reveal's cards and the grid were grey until each photo downloaded. Part of it was the
      interrupted seed (F23), which left files missing; the rest is loading.
      2026-11-07: every developed photo now carries a thumbhash (about 25 bytes) that the grid,
      the reveal's cards, the viewer, the recap and People draw at once, in the photo's colours;
      photo URLs are signed from the start of the hour, so they repeat for an hour and can be
      cached; developed photos and thumbnails are stored with a one-year immutable Cache-Control;
      the gallery returns 60 photos a page and loads the next page two screens ahead (three photos
      ahead in the viewer). Still to do with stage 3: the CDN in front of R2 (needs
      `lingercam.app`'s DNS on Cloudflare, D4), and the 1024 px grid image.

## Later

Highlights read every shot per call; a partial index for gallery pages; serial checks when keeping
uploads; a second download when saving; a weekly orphan sweep; request ids in logs; gallery paging
that can miss late uploads until a refresh; guests renaming after the reveal; abandoned drafts;
upgrades charging the full tier price; and a few RevenueCat webhook edge cases.

## Decisions for Naib

- [ ] **D1.** Built as proposed, waiting for Naib to confirm. **The review account:** confirm a fixed review login is acceptable, and which events it shows.
- [ ] **D2.** Built as proposed (reports email support@lingercam.app since 2026-11-07, support@galleo.app before; removing a guest removes their photos), waiting for Naib to confirm. **Moderation:** where reports should reach Linger (an email to support@galleo.app is enough to
      start), and whether removing a guest also removes their photos.
- [ ] **D3.** **Plans:** Render Pro and the split services at about $97 a month, or the single-service $47
      setup to start.
      2026-11-07: with Neon, the split services on Render's Hobby workspace come to about $95 to
      $115 a month (two Standard services at $25 each, Neon at $40 to $60). Pro waits for F11.
      Waiting for Naib to confirm.
- [ ] **D4.** **The media domain and email provider,** and confirming `lingercam.app` for links and email.
- [ ] **D5.** **Purchase records:** how long to keep them after an account is deleted.

## Order of work

1. App Store blockers: the review account, the microphone string, and the content rules.
2. Reveal correctness: the sweep, the notification queue, the limiter fix, the pg-boss listener.
3. Storage: R2 buckets, tokens and cache, CORS, upload expiry, the develop checks and retries, and
   the grid image.
4. Deploy: split services, pre-deploy migrations, the database plan, Sentry and alerts.
5. The remaining fixes above, then the device pass on a real iPhone, TestFlight, and submission.

## Submission and launch

- [ ] **S1.** Apple Developer team id in `app.config.ts` and the association files (universal
      links).
- [ ] **S2.** Render: `REVIEW_EMAIL` and `REVIEW_CODE`, then `pnpm --filter api review-seed` after the
      first deploy. EAS secrets: the RevenueCat public key, the Expo access token; Render secrets: the
      RevenueCat webhook secret, Stripe, R2, email.
- [ ] **S3.** App Store Connect products for every tier and Unlimited shots, as consumables.
- [ ] **S4.** Privacy nutrition labels: email, name, photos, user and device ids, purchase
      history. Age rating answered for user-generated content.
- [ ] **S5.** Steps in `.docs/device-testing.md`. Device pass on a real iPhone: remote push, the film look, uploads with the phone
      locked, haptics, the front flash, the Live Activity, and Safari as a guest.
- [ ] **S6.** TestFlight build and a real event with a handful of people.
- [ ] **S7.** Store listing: screenshots, description, keywords, support and privacy URLs, and
      review notes with the review account and its event code.
- [ ] **S8.** Legal pages reviewed by a lawyer, with the postal address and governing law.
- [ ] **S9.** Submit, answer review, release.
- [ ] **S10.** Live: error rates, reveal-lag alerts and storage costs watched for the first weeks;
      problems from live users go in as new items here.

## Not verified

Nothing has run on Render or R2 yet. Unchecked: R2's CORS behaviour, whether it enforces a signed
content length, the WAF token rule on the zone's plan, what Render puts in `X-Forwarded-For`,
develop time and memory on a Render CPU, and Expo's push rate limit. Not checked on a phone: Safari
sharing and storage clearing, the camera in in-app browsers, and whether the photo picker returns
HEIC. No App Store Connect upload has run, so the binary checks and the privacy report are
unconfirmed.

## Change log

- 2026-11-04: written from the three code reviews in `.docs/review/`; blockers re-checked against
  the code.
- 2026-11-04: B1 to B3 done (review login and seed, microphone string, guest removal, hiding a
  person, terms on the join sheet, reports emailed to Linger). D1 and D2 built as proposed, waiting
  for confirmation. Stage 2 is next.
- 2026-11-04: B7 done after it crashed the local API during the Maestro run.
- 2026-11-04: F22 done and F23 added, both found while rerunning the Maestro suite. All six flows
  pass on the build with B1 to B3 and B7.
- 2026-11-05: S5 planned step by step in `.docs/device-testing.md`.
- 2026-11-06: device testing step 2 done (`pnpm device:on`). F24 added; F23 happened again.
- 2026-11-07: `device-testing.md` rewritten as a walkthrough for the QA run against the local backend
  and a staging backend (`render.staging.yaml`, `pnpm device:staging`, the `staging` EAS profile).
- 2026-11-07: deploy setup for R2, Render and Neon in `.docs/deployment.md`. The API and the worker
  are split by `ROLE`, migrations run in Render's pre-deploy step, both blueprints use Neon. F18
  and F19 done; B10 decided; Neon Auth ruled out.
- 2026-11-07: renamed to LingerCam everywhere people see the name. Neon project `lingercam` set up
  in AWS us-east-2 (0.5 to 2 CU, always on, 7-day restore), so Render moves to Ohio beside it.
  Render project `lingercam` exists with no services yet; the Blueprint needs the repository on
  GitHub first, and the first migration against Neon waits for Naib's go-ahead.
- 2026-11-07: production created from the CLI: R2 bucket `lingercam` with CORS (B9), the Render env
  group and the four `lingercam-*` services in Ohio, with domains added. Builds use
  `pnpm install --frozen-lockfile --prod=false`, because `corepack enable` fails on Render's
  read-only `/usr/bin`. Waiting on the R2 keys, Resend and the Expo token, and DNS at Squarespace.
- 2026-11-07: production is live: api, worker, lingercam.app and join.lingercam.app on Render, Neon,
  R2 and Resend (lingercam.app verified, a sending key limited to it). Review events seeded with a
  Render job and checked end to end. B10 done. Still to set: `EXPO_ACCESS_TOKEN`, and Render's
  GitHub app access for deploys on push.
- 2026-11-07: support and report emails moved from support@galleo.app to support@lingercam.app, on
  the site, in the API's default and in Render's `MODERATION_EMAIL`.
\n
- 2026-11-07: F25 added and mostly done (thumbhash placeholders, hour-stable photo URLs, immutable
  caching, bigger gallery pages). Local demo data can live on R2 (`pnpm storage:r2`, bucket
  `lingercam-dev`). The Welcome screen's demo button is gone: demo hosts sign in through email
  with the code 000000 in development.
- 2026-11-07: site pages for How it works, Guests, The reveal and Questions, linked from the nav and
  from each home section. Facts read from core where they can be; nothing planned is described.
- 2026-11-08: B4 done: a reveal sweep every minute and an index on events.state.
- 2026-11-08: B5 done: reveal emails go through a queue, one job per email, marked after sending,
  over pooled SMTP.
- 2026-11-08: B6 done: code misses are counted per device and address, and guests already in an
  event are never checked.
- 2026-11-08: B8 and F1 to F5 done: deletes move files to a retried job with a second pass after
  upload URLs expire, develops retry for hours and a sweep catches stuck uploads, and account
  deletion tears down each event.
