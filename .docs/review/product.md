# Linger: core product and App Store readiness review

Reviewed 2026-11-04, read only. I read the code paths in `packages/core`, `apps/api/src` and the key
`apps/app/src` files (api, uploads, purchase, create footer, manage, camera.web, save, save.web,
gallery, shutter, activity, settings in home.tsx), plus `app.config.ts`, the generated iOS
`Info.plist` and `PrivacyInfo.xcprivacy`, `render.yaml` and the site's terms, privacy and support.

Tests: `packages/core` 109 passed; `apps/api` 105 passed (against `linger_test` and the
`linger-test` bucket, which the API test setup drops and recreates; the dev database was not
touched).

Already-known items from the brief and from `polish-plan.md` Results are not repeated: late join
hour, local times, Android, the open product calls, TEAMID, legal placeholders, remote push on a
device, ends-earlier moving the reveal, single-device restore, restore-link requests by address,
signed URLs living an hour after a hide.

---

## Blockers

### B1. App Review can't sign in as a host

- `apps/api/src/accounts.ts:141-214`: host sign-in is a six-digit email code only.
- `apps/api/src/accounts.ts:216-237`, `apps/api/src/http.ts:72`: the demo routes are off when
  `NODE_ENV=production`, and `productionProblems` refuses to start with `DEV_ROUTES=1`.
- `apps/app/src/dev.tsx:20`: the `linger://dev/<persona>` route is `__DEV__` only.

**Failure.** The reviewer types the demo email from the review notes and waits for a code that only
the mailbox owner gets. Creating an event, Manage, paid tiers, account deletion and the revealed
gallery all sit behind that sign-in. This is a guideline 2.1 rejection.

**Fix.** Add a production review login: `REVIEW_EMAIL` plus a fixed `REVIEW_CODE` from env that
`/v1/auth/email/verify` accepts for that one address, rate-limited like any other code. Seed that
account with three events: one live with a long window (its code goes in the review notes for the
guest flow), one revealed with photos, and one draft. Make the seed idempotent so a reviewer
deleting the account doesn't break the next review.

### B2. No `NSMicrophoneUsageDescription`, but VisionCamera's binary calls the audio permission APIs

- `apps/app/app.config.ts:26` and `:66` set `microphonePermission: false`.
- `react-native-vision-camera@5.2.3`, `ios/Hybrid Objects/HybridCameraFactory.swift:18,42`, calls
  `AVCaptureDevice.authorizationStatus(for: .audio)` and `requestAccess(for: .audio)`.
  `VisionCamera.podspec` compiles every Swift file in `ios/`, with no flag to drop the audio
  code.
- The generated `ios/Linger/Info.plist` has no microphone key.

**Failure.** App Store Connect's static scan flags code that references a protected API without a
purpose string (ITMS-90683). For missing purpose strings this has rejected the binary at upload or
in review.

**Fix.** Add an honest string, for example "Linger takes photos only. It never records sound.", to
`ios.infoPlist`. Never ask for the permission at runtime.

**Not verified.** Nothing has been uploaded to App Store Connect yet.

### B3. Guideline 1.2 (user-generated content) is only partly met

- **Report:** there (`shots.ts:683-711`, `photo.tsx:205-214`).
- **Hide:** the host can hide photos (`shots.ts:713-723`).
- **No block or remove:** there is no endpoint or UI to remove or block a guest
  (`events.ts:687-753`; grep for "block" finds nothing in the app). A guest can't hide another
  person's photos for themselves.
- **No moderation channel to the developer:** reports only reach the host, as a badge, plus a push
  once three reports hide a photo (`notify.ts:204-214`). The terms say "We may hide photos and
  suspend accounts or events" (`site terms.md:52`), but nothing ever tells Linger about a
  report, and there is no admin action.
- **No terms for guests:** guests never agree to terms. Only the host sees "By continuing you
  agree" (`home.tsx:219-224`). The join sheet has no terms or privacy link.

**Failure.** The reviewer joins as a guest and looks for "block user" and a terms acceptance. Both
are missing, so the app is rejected under 1.2.

**Fix.**
1. A host "Remove guest" action: delete or flag the guest row, hide their photos, free the place,
   refuse that device.
2. A per-viewer "Hide photos from this person".
3. A line on the join sheet: "By joining you agree to the Terms", with links.
4. Each report also goes to a moderation inbox (an email or a log alert) so you can act within
   24 hours, plus an admin route to hide or suspend.

Item 1 also fixes S5.

---

## Should fix

### S1. A develop that keeps failing strands the shot: no refund, original kept

- `shots.ts:651` and `:228` queue the job with `retryLimit: 3`.
- `developShot` (`:134-172`) throws on storage errors so the job retries. Once the retries run
  out, nothing else picks the shot up: `keepUploaded` only looks at `reserved`.

**Failure.** Storage has a bad few minutes during a wedding. Those shots stay `uploaded` forever:

- they count in `photoCount` and in `shotsTaken`;
- they never appear and are never refunded;
- the original keeps its EXIF and GPS data, which contradicts `privacy.md:41-43`.

**Fix.** Sweep shots that have been `uploaded` for more than about 30 minutes and queue them
again. After N tries, mark them `failed`, refund the shot and remove the folder, as the decode
failure path already does.

### S2. Originals left in storage with no database row

Three ways this happens:

1. **After a released reservation.** A PUT that lands after `releaseExpired` deleted the
   reservation (`shots.ts:178-205`): the queue re-reserves with a new id, and the first original
   stays.
2. **After a delete.** A PUT through a signed URL that is still valid (`storage.ts:47`, 15 minutes)
   after `deleteEvent` (`events.ts:362-367`) or `deleteHost` (`accounts.ts:130-135`) has removed
   the prefix.
3. **A develop already running during a delete** writes `developed.jpg` and `thumb.jpg` back
   (`shots.ts:163-164`).

**Failure.** A guest's offline phone reconnects 5 minutes after the host deleted the event, and a
full-size JPEG with GPS data is stored for good. That contradicts `privacy.md:84-86` ("When an
event is deleted, we delete ... the stored photo files").

**Fix.**
- Write originals under an `incoming/` prefix with an R2 lifecycle rule that expires them after a
  day.
- In `developShot`, re-check that the row exists before each `put`.
- Run a periodic sweep that removes `events/<id>/` prefixes with no `events` row.

### S3. An oversized object can be swapped in after confirm and crash the API

- `confirm` checks the size once (`shots.ts:637-644`).
- `developShot` then loads the whole object into memory (`storage.ts:102-106`). `limitInputPixels`
  only caps decoding, not the download.
- The signed PUT is valid for 15 minutes and can be reused.

**Failure.** A client uploads a small file and confirms, then finishes a multi-GB PUT to the same
URL before the worker picks the job up. `Buffer.from` on the Render `starter` instance (512 MB)
takes the API down for everyone.

**Fix.** In `developShot`, HEAD the object (or read `ContentLength` from the GET) and refuse
anything over `MAX_UPLOAD_BYTES` before buffering. Also delete the original key right after a
successful develop, as now, and reject confirms whose object `LastModified` is newer than the
check.

### S4. "Make room" is sold when nobody can join any more

- `manage.tsx:107-108` offers it while the state is `ended`.
- `billing.ts:30-44` only refuses `revealed` and `archived`.
- New guests are refused once `joinsOpen` closes, an hour after the end
  (`core events.ts:80-89`).

**Failure.** A next-morning event ends at 23:00. At 08:00 the host sees "8 of 10 guests · Make
room" and pays $9.99 for places no one can take.

**Fix.** Gate `canGrow` and `assertWorthBuying` on `joinsOpen(...)`.

### S5. Anyone with the code can fill an event, and the host can't undo it

- `POST /v1/e/:code/join` (`events.ts:687-753`) has no rate limit except on wrong codes. The
  device id is chosen by the client.
- There is no remove-guest endpoint.

**Failure.** Someone who photographs the printed QR code scripts 10 joins. The free event is full,
and the host's only way out is to pay.

**Fix.** Add a per-IP join limiter (for example 10 new guests per 10 minutes) and the host "Remove
guest" from B3.

### S6. Store charges that never reach the event are dropped without a word

- `purchase.ts:86-103` treats `not-found`, `wrong-state` and `already-covered` as hopeless and
  silently drops the pending claim after Apple has already charged.
- `applyPurchase` (`billing.ts:92-98`) records a tier that adds nothing (`guests <= guestLimit`)
  and returns 200.
- The claim path doesn't run `assertWorthBuying` at all.

**Failure.** The reveal passes while the Apple sheet is open, or a second device already bought a
bigger tier. The host is charged, gets nothing and sees nothing.

**Fix.**
- Re-fetch the event and re-check `due()` and the state right before `purchaseStoreProduct`. That
  covers MakeRoom too, which works from a cached event.
- On a hopeless claim, keep it and show "This payment couldn't be applied" with Apple's
  report-a-problem link and support.
- Alert on `purchase applied` with no change.

### S7. Missing purchase and push secrets aren't caught in production

- `productionProblems` (`http.ts:77-88`) doesn't require `REVENUECAT_SECRET_KEY`,
  `REVENUECAT_WEBHOOK_AUTH` or `EXPO_ACCESS_TOKEN`. Without the RevenueCat key, `claim` answers
  503 after Apple has charged (`billing.ts:185-187`). Without the Expo token, push is skipped and
  only logged (`notify.ts:22-25`).
- `eas.json:27-35` has no `EXPO_PUBLIC_REVENUECAT_IOS_KEY`. If it isn't set as an EAS environment
  variable, `testPurchases()` (`purchase.ts:112-114`) is true and production builds call
  `/v1/billing/dev-claim`, which answers 404.

**Failure.** The reviewer taps "Start for $19.99" and gets an error, so the app is rejected under
2.1.

**Fix.** Add these keys to `productionProblems`. In the app, treat a missing store key as an error
in release builds (`__DEV__ && !storeKey`).

### S8. Web guests lose their identity after 7 days without a visit

- On the web, the device id lives only in localStorage (`api.ts:131-145`). Safari deletes
  script-written storage after 7 days of browsing without a visit to the site.
- A server cookie wouldn't help: `api.lingercam.app` is a CNAME to Render, and Safari caps those
  cookies at 7 days too.

**Failure.** A wedding with a custom reveal two weeks out. The browser guest comes back on reveal
day as a new device, joins are closed, and they see "These photos are for the people who were
there." They can't recover unless they left an email.

**Fix.** On the web, ask for the reveal email firmly when the reveal is more than about 5 days
away, and say why.

**Not verified** on a device.

### S9. Saving and sharing in iOS Safari

- `save.web.ts:27-35` awaits the full download before calling `navigator.share`. Safari only allows
  `share` during a short window after the tap, so on a slow connection it throws, and the code
  swallows the error as if the sheet had been closed.
- `savePhoto` (`:22-24`) downloads into Files, not Photos.

**Failure.** On cellular, Share does nothing, and Save puts the photo where guests won't find it.

**Fix.** Fetch the blob when the viewer opens the photo, so `share` runs right away. On iOS, make
Share ("Save Image") the main save action.

**Not verified** on a device.

### S10. Opening the link inside an in-app browser

Instagram, Facebook and LinkedIn open links in their own WebViews.

- Without `getUserMedia` or permission, the camera shows "Linger couldn't find a camera on this
  device." (`camera.web.tsx:243,262-264`, `copy.ts:285`).
- The WebView also has its own storage, so the same person is a second guest in Safari.

**Fix.** Detect the common in-app user agents and say "Open this page in Safari (or Chrome) to use
the camera", with a copy-link button.

### S11. Deleting an account skips each event's teardown

`deleteHost` (`accounts.ts:130-135`) only removes the prefixes and the host row. It never sends the
`deleted` silent push or runs `cancelReveal`, which `deleteEvent` (`events.ts:362-367`) does.

**Failure.** Guests' local reveal reminders still fire ("the photos are ready") for an event that
no longer exists.

**Fix.** Call `deleteEvent` for each owned event before deleting the host.

### S12. A cover is marked present before it's uploaded, and HEIC covers are allowed

- `POST /v1/events/:id/cover` sets `hasCover: true` before the PUT (`events.ts:547-562`).
- `IMAGE_TYPES` includes `image/heic` (`storage.ts:64`), and the picker's `mimeType` is passed
  straight through (`manage.tsx:327`, `create.tsx:814`).

**Failure.** If the upload fails, the event goes live with a `coverUrl` that returns 404 in the app
and in `og:image`. A HEIC cover doesn't render in Chrome, on Android or in most link previews.

**Fix.**
- Convert the cover to JPEG on the device. `react-native-nitro-image` is already a dependency.
- Drop HEIC from `IMAGE_TYPES`.
- Set `hasCover` only after a HEAD confirms the object, or have the client call `removeCover` when
  the upload fails.

### S13. Late uploads trust the client's `takenAt`

- `shots.ts:592-603` with `core shots.ts:185-197`: after the camera closes, any guest with shots
  left can reserve until 7 days after the reveal by sending a `takenAt` inside the window.
- That includes guests who joined during the late hour, after the end.

**Failure.** Someone who joined at 23:30, after an 23:00 end, adds camera-roll images to a
revealed gallery the next week.

**Fix.** Require `takenAt >= guest.joinedAt` (minus a minute of skew) in the late path.

---

## Later

### Server and performance

- **L1. Developing runs on the API's own event loop** (`server.ts:92-101`, `shots.ts:233-235`).
  `applyLook` took 32 to 112 ms per 2048x1536 frame on this Mac (Node 26, the halation look is the
  slow one). It will be slower on Render's 0.5-CPU starter instance. That isn't measured; it's
  extrapolated. With batches of 2, a 250-guest peak means latency spikes for every request and a
  backlog at the reveal. Move developing to `worker_threads` or a separate worker service.
- **L2. Paging by `takenAt` misses some late uploads.** The gallery pages by the client's
  `takenAt` (`shots.ts:410-427`), so a late upload with an earlier `takenAt` lands behind a cursor
  that's already loaded. It only appears after a full refresh.
- **L3. Email race.** `POST /email` checks for a taken address and then updates, so two guests
  claiming the same address at once hit the unique index and get a 500 (`events.ts:812-831`).
  Catch `23505` and return `email-taken`.
- **L4. Names can change at any time.** Re-posting join renames the guest even after the reveal
  (`events.ts:708-716`). Names are content guests make too, and nobody can report one. Lock
  renames after the reveal, or let a name be reported.
- **L5. Data that's never cleaned up:**
  - abandoned server drafts, which are created at step 2 (`create.tsx:524-539`);
  - expired `email_codes` rows;
  - shared photo files in the cache (`save.ts:31-34`).
- **L6. No cap with unlimited shots.** There is no per-guest cap or rate limit on reserving
  (`shots.ts:275-286`), so storage can be abused. Set a soft cap, such as 500 a guest.
- **L7. RevenueCat edge cases:**
  - The webhook applies a purchase using the `eventId` attribute, which can be overwritten by a
    later purchase for another event (`billing.ts:295-315`).
  - A claim whose transaction was already recorded against another event returns 200 with this
    event unchanged (`billing.ts:73-82`).

### Product, copy and platform

- **L8. Upgrades cost the full tier price.** "Make room" charges the full price of the bigger tier
  even after a smaller one was bought (`manage.tsx:166`, `core due()`). The site says the price
  "depends only on how many guests can join". This is a product call: either charge the
  difference or say so.
- **L9. The report copy promises more than happens.** `photo.reportBody` says "The host will be
  told", but the host gets a badge, and a push only at three reports (`copy.ts:351-352`,
  `shots.ts:706-709`). Change the copy or push on the first report.
- **L10. Retrying the web camera after a denial.** In iOS Safari, after a denial, "Try again"
  calls `getUserMedia` again without reloading, which doesn't prompt again. The copy also says
  "Allow it from the address bar", but on iOS the setting is in the aA menu
  (`camera.web.tsx:357`, `copy.ts:282-283`).
- **L11. Info.plist strings nobody needs:**
  - `NSFaceIDUsageDescription` is the default "Allow $(PRODUCT_NAME) to access your Face ID
    biometric data." from expo-secure-store. Set `faceIDPermission: false`.
  - The dev launcher's local-network strings are also there. Check whether they survive a
    production prebuild.
- **L12. RevenueCat keeps the customer.** Account deletion leaves the RevenueCat record (app user
  id and purchase history) in place. You could call RevenueCat's delete-subscriber API.
- **L13. Refund wording.** The support page and the delete dialogs say "Payments aren't
  refunded". Apple can refund App Store purchases under its own process, which the terms
  acknowledge (`terms.md:28-31`). Align the wording.

---

## App Store readiness checklist

| Item | Status | Where / note |
| --- | --- | --- |
| In-app account deletion (5.1.1(v)) | Pass | Settings, Delete account (`home.tsx:1008,1026-1040`) calls `DELETE /v1/me` (`accounts.ts:271-276`); the confirm copy names the events. See S11. |
| Review demo account | **Fail** | B1 |
| Purchase type | Correct as consumables | Each tier and the add-on applies to one event and can be bought again (`pricing.ts:8`, `purchase.ts:133,174`). Create them as Consumable in App Store Connect. Restore Purchases isn't required for consumables, and there is none, which is fine. Say "per-event, consumable" in the review notes. Attach the products to the version. |
| Camera / Photos / Add-only strings | Pass | `app.config.ts:4-8`; specific and accurate. |
| Microphone string | **Fail** | B2 |
| Face ID string | Boilerplate | L11 |
| Privacy manifest, required-reason APIs | Probably fine | The app manifest declares UserDefaults CA92.1, FileTimestamp C617.1 and SystemBootTime 35F9.1. expo-file-system, -media-library, -notifications, -localization, -constants, -application, -system-ui and react-native ship their own. Not checked: VisionCamera, the Nitro modules, MMKV and RevenueCat. Run Xcode's privacy report on an archive. `NSPrivacyCollectedDataTypes` is empty. Fill it to match the labels below. |
| Privacy labels | To declare | All "linked to user, App Functionality, not tracking": Contact Info (email, name), User Content (photos), Identifiers (user id; device id), Purchases (purchase history, via RevenueCat). No analytics or diagnostics SDK found. |
| UGC 1.2 | **Fail risk** | B3 |
| Sign in with Apple | Not needed | Email code only, no third-party login. |
| Export compliance | Pass | `usesNonExemptEncryption: false` (`app.config.ts:25`); HTTPS only. |
| ATT | Not needed | No IDFA; `NSPrivacyTracking` false; RevenueCat device identifiers not collected. |
| Push entitlement | Config present | `aps-environment` from expo-notifications; App Store signing sets it to production. APNs key and `EXPO_ACCESS_TOKEN` not verified (S7). |
| Background modes | Pass | Only `remote-notification`, used for the reminder silent pushes. The background URLSession upload needs no mode. |
| Live Activity | Config present | `NSSupportsLiveActivities`; widget target `.activity`. Needs `ios.appleTeamId` (the known TEAMID work). |
| Age rating | To answer | Answer yes to user-generated content and sharing. Expect at least 13+ under the current questionnaire. The terms say hosts must be 18+ or have a parent's permission. |
| Support / Privacy / Terms URLs | Pass in app, partial for guests | Settings and welcome link to the site (`home.tsx:223-224,1140-1146`). The join sheet has no links (B3). Support URL `lingercam.app/support`, privacy `lingercam.app/privacy`. |
| iPad | Fine | `supportsTablet: false`, portrait. Reviewers may still run it on an iPad in compatibility mode. |

## Server enforcement audit (what holds)

**Photos and URLs**

- Host-only visibility is enforced on every route that returns photos or URLs:
  - `gallery` (`visibleFilters` with `own`, `shots.ts:356-361`);
  - `highlights` for both the moment and the recap, which also always exclude hidden photos
    (`:566`);
  - `like`, `report` and `delete` (`visibleShot` → `canSeeShot`);
  - people faces, which come from the gallery the client already has.
- `people` and `summary` return counts and names only.
- `cover` and `page` show only the host's title and cover.
- Hidden photos are left out for guests in the gallery and counts. The host sees them flagged.

**Shots**

- The allowance is enforced server-side in one conditional UPDATE (`shots.ts:275-286`). Retries
  are idempotent through `clientId`.
- Refunds happen on a failed decode and on a released reservation. Deleting your own photo is
  deliberately not refunded.

**Authorization**

- `confirm` checks that the shot is this guest's.
- `hide` checks the owner; `claim` and `checkout` use `ownedEvent`.
- The RevenueCat webhook checks the event's host against `app_user_id`.
- Push token re-binding is guarded by `setWhere`.
- I found no way to act on another event's shot ids.

**Races handled**

- Concurrent joins: the event row is locked.
- Concurrent reserves: the guest row is locked for retries, and the UPDATE is atomic.
- PATCH against the reveal job: the row is locked.
- Restore: the guest row is locked.
- Likes and reports: counts are recomputed in the transaction.

## Couldn't verify

- An App Store Connect upload: the B2 scan, the privacy report and the third-party SDK manifests.
- Whether `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and the server secrets are set in the EAS and Render
  dashboards.
- The R2 production CORS rules for browser PUT and GET. Only `docker/storage-cors.json` is in the
  repo.
- iOS Safari's share activation window and the 7-day storage deletion; in-app browser camera
  support.
- Whether a HEIC cover actually comes back from the picker with `allowsEditing: true`.
- Develop throughput on Render. The 32 to 112 ms figure was measured on this Mac only.
- Anything on a physical iPhone or the simulator: not touched, as asked.
