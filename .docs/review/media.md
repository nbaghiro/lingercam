# Linger media: how photos are stored and served today, and a production design on R2

Read-only review of `/Users/naib/Documents/code/linger`, 4 November 2026. No repo files were
changed. Line references are to the files as they stand today. Measurements marked "this Mac"
were taken on the review machine with scripts in this folder (`bench.ts`, `sizes.mjs`,
`sign.mjs`), not on Render, and the image sizes come from the 34 bundled demo photos without the
film look, so treat them as estimates.

## Summary

- Today every photo URL is a SigV4 presigned GET against the S3 endpoint, valid for an hour and
  re-signed on every gallery request. On R2 that means no Cloudflare cache: every view is a
  Class B read served from the bucket's region.
- Native clients cope well, because expo-image caches by `id:size`. The web build doesn't:
  expo-image on web ignores `cacheKey`, so each re-signed URL is a new download.
- Recommendation: option (b). Serve developed photos from a custom domain on a dedicated media
  bucket (`media.lingercam.app`) behind Cloudflare's cache, gated by a WAF timed-HMAC token in the
  query string that is left out of the cache key. Originals go to a separate private uploads
  bucket with a one-day lifecycle rule. Tokens are issued in fixed time windows so URLs stay
  identical between refreshes, which also fixes the web cache.
- Blockers before production: R2 CORS isn't configured for production anywhere (web uploads
  will fail preflight), and the develop and delete paths can leave photos of deleted events in
  storage, which contradicts the privacy policy.

## 1. Today's lifecycle

### Upload and confirm

1. **Reserve.** `POST /v1/e/:code/shots` (`api/src/shots.ts:585-615`) takes one shot from the
   guest's allowance in a conditional UPDATE (`shots.ts:247-294`), creates a `reserved` row and
   returns a presigned PUT for `events/{eventId}/shots/{shotId}/original.jpg`
   (`shots.ts:610`, keys at `storage.ts:55-61`).
2. **Presigned PUT.** `uploadUrl` (`storage.ts:71-77`) signs `content-type: image/jpeg` only,
   valid 15 minutes (`storage.ts:47`). There is no size limit in the signature, and the R2/S3 PUT
   would accept up to about 5 GiB. The type is enforced only in the sense that the stored object
   is labelled `image/jpeg`; the bytes can be anything.
3. **Client PUT.** The app's queue (`app/src/uploads.ts:354-422`) reserves with its queue id as
   `clientId`, PUTs (`uploads.ts:252-273`: an iOS background `URLSession` upload, otherwise
   `uploadFile` at `api.ts:541-555` with a 90 s timeout), then confirms. A 403 from storage (an
   expired URL) starts a new reservation (`uploads.ts:399-415`). Native photos are already at most
   2048 px, JPEG 0.9 (`camera.tsx:35,131,275`); web photos at most 1600 px, JPEG 0.85
   (`camera.web.tsx:16,134`).
4. **Confirm.** `POST /v1/shots/:id/confirm` (`shots.ts:617-658`) HEADs the original
   (`shots.ts:637`), deletes it and returns 413 when it is over 15 MB (`storage.ts:49`,
   `shots.ts:641-644`), moves the row to `uploaded` and queues a `develop` job with
   `retryLimit: 3, retryDelay: 10` (`shots.ts:651`).
5. **Late confirms.** Every minute `releaseExpired` (`shots.ts:178-205`) first confirms expired
   reservations whose original did arrive (`keepUploaded`, `shots.ts:211-230`, one HEAD per stale
   row, in series), then deletes the rest and refunds the shot, removing their storage folder.

### Develop

`developShot` (`shots.ts:134-172`), two jobs per fetch in the API process (`shots.ts:232-235`):

- Downloads the original into memory, `sharp(...).rotate()`, resizes to 2048 px inside
  (`shots.ts:66,100-106`), refuses inputs over 50 MP (`shots.ts:69`), then runs `applyLook` in
  plain JavaScript over every pixel (`shots.ts:107`, `core/src/film.ts:197`).
- Encodes the developed photo as JPEG q85 mozjpeg and a 512 px thumbnail as JPEG q80 mozjpeg
  (`shots.ts:109-113`). Sharp's default drops EXIF, and the raw-pixel round trip guarantees it,
  so the privacy line that developed copies carry no camera metadata holds
  (`site/src/pages/privacy.md:40-43`).
- PUTs `developed.jpg` and `thumb.jpg` (`shots.ts:163-164`, `storage.ts:89-93`, with no
  `Cache-Control`), sets `developed` with width and height, then deletes the original
  (`shots.ts:165-170`).
- A file sharp can't decode marks the shot `failed`, refunds it and removes the folder
  (`shots.ts:145-161`). Storage errors throw so pg-boss retries.

`applyLook` alone takes 32 to 113 ms per 2048 x 1536 frame on this Mac depending on the look
(`warm-98` is the slowest, because of the halation pass). It is synchronous, so it blocks the
API's event loop for that long per photo, and longer on a Render starter instance.

### What stays

Per developed shot: `developed.jpg` (2048 px) and `thumb.jpg` (512 px). The original is deleted.
The demo photos come to about 216 KB + 26 KB without the look; your measurement with the look is
about 200 KB for both.

### Covers

- `POST /v1/events/:id/cover` (`events.ts:547-562`) sets `hasCover` and bumps `coverVersion`
  before anything is uploaded, then returns a presigned PUT to the fixed key
  `events/{id}/cover.jpg` for any of JPEG, PNG, HEIC or WebP (`storage.ts:64`).
- The cover is never processed. It is stored and served exactly as uploaded, so a HEIC cover
  won't display in Chrome or Firefox or in link previews, a cover can be up to 15 MB, and a cover
  picked on the web keeps its EXIF, including location. On iOS the picker crops with
  `allowsEditing` (`create.tsx:807-814`, `manage.tsx:319-327`), which usually re-encodes, but I
  didn't verify that it strips location.
- `GET /v1/e/:code/cover` (`events.ts:633-641`) is public to anyone with the join code. It HEADs
  the object on every request and 302s to a one-hour signed URL, with `Cache-Control: public,
  max-age=600` on the redirect. `coverUrl` is the stable API URL with `?v={coverVersion}`
  (`events.ts:86-88`), which is also the `og:image` (`events.ts:675-676`).

### URLs handed to clients

- Gallery pages, 30 by default and at most 100 (`shots.ts:70,538-541`): each item carries two
  presigned GETs, `url` and `thumbUrl` (`shots.ts:330-345`), valid one hour
  (`storage.ts:51,79-87`).
- Highlights (moment 3, recap 12): the same `galleryItem` shape (`shots.ts:581`).
- Nothing is signed before the reveal (`photoAccess`, `core/src/shots.ts:94-104`). Hidden photos
  are signed only for the host (`shots.ts:356-361`); highlights exclude hidden photos even for the
  host (`shots.ts:566`).
- Each presigned URL is about 470 characters, so a 30-item page carries about 28 KB of URLs.
  Signing takes about 96 µs per URL on this Mac, so about 6 ms of a page's 10 ms.

### Deleting

- **A photo** (photographer only, after the reveal): row deleted, then the folder
  (`shots.ts:726-735`).
- **An event:** `deleteEvent` (`events.ts:362-367`) pushes "deleted", cancels the reveal jobs,
  lists and deletes everything under `events/{id}/` (`storage.ts:143-155`, ListObjectsV2 plus
  DeleteObjects in batches of 1000), then deletes the row, which cascades guests, shots, likes and
  reports. It runs inside the HTTP request (`events.ts:540-545`).
- **An account:** `deleteHost` (`accounts.ts:130-135`) runs `removePrefix` for each event in
  series, then deletes the host; rows cascade. It doesn't cancel the events' reveal jobs (they find
  no event and do nothing) or push "deleted".
- **Archive:** 90 days after the reveal the state becomes `archived` and nothing else changes
  (`core/src/events.ts:27`, `.docs/product.md:77-79,822-825`). Photos are kept until the host
  deletes the event or the account (`privacy.md:80-90`).

## 2. How the client caches images

- **Native.** Every photo image goes through `photoSource(url, id, size)`, which sets
  `cacheKey: "{id}:{thumb|full}"` (`ui.tsx:1488-1490`; used in `event.tsx:856`,
  `photo.tsx:615-627`, `recap.tsx:422-447`, `moment.tsx:84-85`, `people.tsx:127`). expo-image's
  memory and disk caches are keyed by that, not by the URL, so a re-signed URL doesn't download
  the photo again. The product spec claims this (`.docs/product.md:724-726`) and it holds on
  iOS and Android.
- **Web.** expo-image's web implementation renders a plain image element and doesn't use
  `cacheKey` at all (there is no reference to it under `expo-image/src/web/` in the installed
  58.0.18). The browser cache is keyed by the full URL, signature included, so every gallery
  refresh is a fresh download of every visible tile. Refreshes happen on focus, on returning to
  the tab, every 30 s while a right-away event is shooting, every 5 s around the reveal and every
  4 s while catching up on late photos (`event.tsx:100-107,236-249`). On top of that the objects
  carry no `Cache-Control`, so even an unchanged URL only gets heuristic caching. Most guests use
  the web build, so this is where the reveal bandwidth goes.
- **Expiry while open.** The event screen and the viewer call `useFreshGallery`
  (`event.tsx:219-220`, `photo.tsx:94`), which re-signs every loaded page 10 minutes before the
  earliest URL expires, on focus, on foreground and on a timer (`gallery.ts:183-230`). Renewal
  refetches as many pages as were loaded, so a guest who scrolled 3,000 photos refetches 100
  pages every 50 minutes. The recap fetches its slides once (`recap.tsx:79-92`) and never renews
  them: after an hour, slides that aren't in the native cache fail to load with no error handling
  (there is no `onError`, `recap.tsx:431-452`), and Save and Share use the stale URL and fail
  with the generic toast. On the web, every slide is affected because nothing is cached by id.
  The moment has the same shape but is short-lived.
- **Save to Photos (native).** `savePhoto` and `sharePhoto` download `item.url`, the 2048 px
  developed JPEG, to the cache folder with `File.downloadFileAsync` and add it to the library
  (`save.ts:10-34`). That is a second download even when expo-image already has the image. The
  saved file has no EXIF, so Photos files it under the day it was saved, not the day it was taken.
- **Save all (native).** `saveWholeGallery` (`gallery.ts:323-386`) fetches every page, then
  downloads each 2048 px photo in turn into an album. When a URL is within 2 minutes of expiry it
  refetches every page again (`gallery.ts:362-373`). Both page loops stop after 200 extra pages
  (`gallery.ts:153,169`), and the client never sends `limit`, so a gallery stops at 6,030 photos.
  A 6,000-photo event is right at that edge.
- **Web saves.** `save.web.ts:5` fetches with `cache: "no-store"` because an image element
  already cached the URL without CORS headers. This needs CORS on GET from the storage origin.
  Save all is limited to desktop browsers (`save.web.ts:41`).

## 3. Production design on R2

R2 has no egress fees on any of these paths, so egress cost doesn't separate the options.
What does is Class B reads, whether Cloudflare's cache is used, how access is revoked, and the
work involved.

### (a) Private bucket, presigned S3 URLs (today's design)

- **Privacy:** strong. Nothing is readable without a signature, and the API decides per request.
  Host-only visibility, hidden photos and pre-reveal secrecy all fall out of who gets signed.
- **Cache at the reveal:** none at Cloudflare. Presigned requests to
  `<account>.r2.cloudflarestorage.com` aren't cached. Native devices cache locally by id; web
  browsers re-download on every refresh.
- **Cost:** every view is a Class B read ($0.36 per million). For one 6,000-photo event with 250
  guests who each view about 600 tiles and 60 full photos, that is about 170,000 reads, or about
  $0.06. At 1,000 such events a month, about 170 million reads, or about $58 a month after the
  free 10 million.
- **Latency abroad:** each object comes from the bucket's region. A guest on another continent
  pays a full intercontinental round trip per uncached object, plus R2's own read time.
- **Revocation:** good. A URL lasts at most its expiry (one hour today). Deleting an object makes
  existing URLs 404 at once.
- **Work:** none, plus three small fixes if you keep it: set `Cache-Control` on PUT, round the
  signing time to a window with the presigner's `signingDate` so URLs stay identical between
  refreshes, and configure CORS.

### (b) Custom domain behind Cloudflare's cache, token-gated

A media bucket connected to `media.lingercam.app`, with access checked at the edge before the
cache. Two ways to check the token:

- **(b1) WAF custom rule** with `is_timed_hmac_valid_v0`: blocks any request whose
  `?verify={timestamp}-{mac}` isn't a valid HMAC of the path within the TTL. WAF runs before the
  cache, so cache hits are still checked. No Worker, and a cache hit costs nothing. This needs a
  paid zone plan; I believe Pro or above, but check before relying on it.
- **(b2) Worker** on the route: verifies the token, reads from the R2 binding and stores in the
  Cache API keyed by the path without the token. It works on any plan and allows richer checks
  (for example a deny-list of deleted events), but every request invokes the Worker, cache hit or
  not: about $0.30 per million after the 10 million included in the $5 Workers plan. At 170
  million requests a month, about $50.

For both:

- **Privacy:** same decisions as (a), since the API still issues tokens only for what the viewer
  may see. The difference is that an issued token is valid until its TTL even after a hide, and
  the cached copy stays at the edge until it expires or is purged.
- **Cache at the reveal:** high. A wedding's guests are mostly in one city and hit one or two
  Cloudflare data centres, so the first view of each object fills the cache and the other 249
  viewers hit it. Tiered Cache helps viewers elsewhere; I believe Smart Tiered Cache is on by
  default for R2 custom domains, but that needs checking.
- **Cost:** Class B reads only on misses, so for 1,000 events a month roughly a tenth of (a)'s
  reads, a few dollars, plus the zone plan for (b1) or Workers for (b2).
- **Latency abroad:** cache hits are served from the nearest data centre, typically tens of
  milliseconds instead of an intercontinental round trip. A relative abroad who is the first
  viewer in their region still takes a miss.
- **Revocation:** a hidden photo stops getting new tokens at once. Old tokens stay valid until
  their TTL (the same bound as today), and the edge copy can be purged by URL when a photo is
  hidden or deleted. A deleted event's rows are gone, so no new tokens are issued, and its edge
  copies age out within the edge TTL or are purged. I believe purge by prefix is now available
  on all plans, but check that too; purge by URL works everywhere.
- **Work:** moderate. A Cloudflare zone for `lingercam.app` (DNS has to be on Cloudflare), a
  second bucket, a WAF rule, a Cache Rule, a Transform Rule for CORS, token signing in the API
  (one HMAC per URL, about 1.2 µs on this Mac against 96 µs for a presign), an explicit expiry
  in the gallery response and purge calls on hide and delete.

### (c) Public objects under unguessable keys

- **Privacy:** weakest. Anyone holding a URL can fetch it until the object is deleted or moved,
  with no expiry. URLs end up in shares, browser history and logs. Pre-reveal secrecy rests
  entirely on nobody having seen a key.
- **Cache at the reveal:** best, and the simplest to configure.
- **Cost:** lowest; no token checking at all.
- **Latency abroad:** same as (b).
- **Revocation:** poor. Hiding a photo means copying it to a new random key, deleting the old one
  and purging the old URL. A guest who forwarded the old URL keeps access to the edge copy until
  the purge lands.
- **Work:** least.

### Recommendation: (b1), with (b2) as the fallback if the WAF HMAC function isn't on your plan

It keeps (a)'s access model, adds the CDN and fixes the web cache with one mechanism. (c)
doesn't fit a product whose promise is that nothing is visible until the reveal and that hidden
and deleted photos go away.

**Buckets and keys**

- `linger-uploads`: private, S3 API only, never on a custom domain. Key
  `originals/{eventId}/{shotId}.jpg`. A lifecycle rule deletes every object after one day, which
  cleans up abandoned and raced uploads without code.
- `linger-media`: connected to `media.lingercam.app`. Keys
  `e/{eventId}/{shotId}/full.jpg`, `e/{eventId}/{shotId}/grid.webp`,
  `e/{eventId}/{shotId}/thumb.webp`. A developed shot never changes, so the key needs no version.
  Covers at `c/{eventId}/{coverVersion}.jpg`, outside the token rule, because link previews must
  fetch them without a token. The cover version belongs in the key, so a new cover is a new
  object instead of a stale cache entry.

**Object headers, set on every PUT from the develop job**

- `Content-Type: image/jpeg` or `image/webp`.
- `Cache-Control: public, max-age=31536000, immutable`. Safe because a key never changes
  content; revocation is handled by tokens and purges, not by cache lifetimes.

**Zone rules for `media.lingercam.app`**

- WAF custom rule, action Block:
  `http.host eq "media.lingercam.app" and starts_with(http.request.uri.path, "/e/") and not
  is_timed_hmac_valid_v0("<secret>", http.request.uri, 10800, http.request.timestamp.sec, 8)`.
  The separator length 8 is `?verify=`.
- Cache Rule: eligible for cache, Edge TTL 7 days (so deleted content ages out within a week even
  without a purge), Browser TTL respects origin, cache key ignores the query string. The token
  then never fragments the edge cache.
- Response header Transform Rule: `Access-Control-Allow-Origin: https://join.lingercam.app`.
  A static header avoids the problem where an image element's request (without `Origin`) fills
  the cache with a response that has no CORS header, which then breaks `save.web.ts`'s `fetch`.

**URL expiry and a stable cache key**

- Token timestamp = issue time floored to a one-hour window, so every gallery fetch in the same
  hour gets the identical URL. With a TTL of three hours, a URL works for two to three hours,
  close to today's one hour.
- The cache key at the edge is the path. On native it stays `cacheKey: "{id}:{size}"`. On the web
  the browser cache keeps working within a window and re-downloads at most once an hour.
- Return an explicit `urlsExpireAt` on gallery pages and highlights, and have `useFreshGallery`
  read it, instead of parsing `X-Amz-Date` from the URL (`api.ts:561-572`), which won't exist
  any more.

**Hide, delete and the reveal**

- Pre-reveal: unchanged; no tokens are issued.
- Hide: stop issuing guest tokens (already the case) and purge the shot's three URLs.
- Photo delete, event delete, account delete: delete rows, delete objects, purge (by prefix
  where available, otherwise let the 7-day edge TTL and the 3-hour token TTL bound it). Say in the
  privacy policy that removed photos can stay in Cloudflare's cache for a limited time.

## 4. Upload path on R2

- **Presigned PUT directly to R2** stays. R2 supports SigV4 presigned PUT with a signed
  `Content-Type`; keep `requestChecksumCalculation: "WHEN_REQUIRED"` (`storage.ts:26-27`), which
  avoids the default CRC32 checksum headers newer SDKs add.
- **CORS for the web build.** Production has none. `docker/storage-cors.json` only lists
  localhost origins and is applied by `storage-init` locally (`docker-compose.yml:47-67`).
  `linger-uploads` needs a CORS policy allowing `PUT` from `https://join.lingercam.app` with
  `Content-Type` as an allowed header; `linger-media` needs `GET` and `HEAD` (or the Transform
  Rule above). Without it, every browser upload fails at the preflight. Check it with a real
  browser against the real bucket before launch, since local testing only exercises RustFS.
- **Content length.** R2 doesn't support presigned POST policies, so there is no
  `content-length-range`. Options, in order of preference:
  1. Have the client send the file size with the reservation and sign `Content-Length` as a
     signed header, so R2 rejects any other length. The app knows the size before reserving.
     I believe R2 enforces signed `content-length`, but test it.
  2. Keep the check at confirm (today), plus the one-day lifecycle rule on the uploads bucket.
     Storage abuse is then bounded to one day and costs very little, since ingress is free.
  Lower `MAX_UPLOAD_BYTES` from 15 MB to about 8 MB either way; the app's photos are 2048 px.
- **Multipart:** not needed. Photos are 0.3 to 2 MB and multipart parts must be at least 5 MiB.
- **Where to develop.**
  - **Sharp on Render (keep).** The look is custom pixel math (`film.ts`), which Cloudflare Images
    can't reproduce. Move it out of the API process into a Render background worker that runs the
    same pg-boss `develop` queue, or at least into a `worker_threads` pool, so `applyLook` doesn't
    block requests. Set `sharp.concurrency(1)` and a small `sharp.cache` on a 512 MB instance.
  - **Cloudflare Images transformations:** useful for resizing, not for the look, and billed per
    unique transformation ($0.50 per 1,000 after 5,000 free a month, if pricing hasn't changed).
    Two variants of 6 million photos a month would be about $6,000, so not for derived sizes.
  - **A Worker:** no sharp, only WASM codecs with tight memory and CPU limits. Possible, but it
    means porting the look and encoders for no gain at this scale.
- **Bandwidth through Render.** Each develop downloads the original (inbound) and uploads about
  300 KB (outbound). At 6 million photos a month that is about 1.8 TB outbound from Render.
  I didn't verify Render's current bandwidth allowance and price; check it, because it could
  cost more than R2 itself at that scale.

## 5. Sizes and formats

**Grid tiles are soft on every 3x phone today.** Tiles are 3:4 and two to a row
(`ui.tsx:144,1177-1180,1663-1667`). On a 440 pt phone a tile is 205 x 273 pt, or 615 x 820 px. A
portrait 512 px thumb is 384 x 512, so it is upscaled 1.6x; a landscape one cropped to fill the
tile is upscaled about 2x. Even a 390 pt phone needs 540 x 720 px.

**Recommended variants** (sizes from the demo photos on this Mac, without the look, which adds
grain and makes files somewhat bigger):

| Variant | Use | Today | Proposed | Avg size |
| --- | --- | --- | --- | --- |
| full | viewer, recap, save, share | JPEG q85, 2048 px | unchanged | 216 KB |
| grid | grid tiles, moment cards | (none) | WebP q75, 1024 px | 56 KB (JPEG q80: 84 KB) |
| thumb | blurred backdrop, faces, placeholder | JPEG q80, 512 px | WebP q75, 384 px, or drop for a thumbhash | about 13 to 19 KB |

- **WebP everywhere for grid and thumb.** iOS Safari 14+ and expo-image on iOS and Android decode
  WebP, so one stored format serves every client, with no content negotiation. That is about 30%
  smaller than JPEG at the same visual quality.
- **AVIF isn't worth it yet.** About 82 KB for the full size and 13 KB for a thumb, but encoding
  is much slower on the develop worker and support on older phones is patchier. Revisit if
  bandwidth for guests abroad becomes a complaint.
- **Keep `full` as JPEG.** It is what goes to Photos and the share sheet, and JPEG is the safest
  there. Consider writing `DateTimeOriginal` into it (sharp `withExif`) so saved photos land on
  the right day in Photos; it would carry no location.

**Storage math**, using about 290 KB per photo with the grid variant, or 200 KB today:

- One 6,000-photo event: 1.2 GB today, about 1.7 GB with the grid variant.
- 1,000 such events a month: 1.2 TB a month today (+$18 a month of storage per month of events),
  about 1.7 TB with the grid variant (+$26). Because photos are kept until deletion, storage
  accumulates: after 12 months about 14 TB ($216 a month) today, or 21 TB ($310 a month) with
  the grid variant, before any Infrequent Access savings.

**Operations math**, per photo: PUT original, HEAD at confirm, GET original, PUT each variant,
DELETE original (free). With three variants that is 4 Class A and 2 Class B, so 6 million photos
a month is about 24 million Class A ($104 a month) and 12 million Class B ($4).

**Bytes at the reveal**, for a guest who views 600 tiles and 60 full photos: about 28 MB today
(512 px JPEG tiles), about 47 MB with 1024 px WebP tiles. That is 7 to 12 GB per 250-guest event.
It's free on R2, but it is real data for guests on mobile plans; the grid variant is the right
trade because today's tiles are visibly soft.

## 6. Lifecycle and cost

**R2 pricing** as I know it (check the current page before budgeting): Standard storage $0.015
per GB-month, Class A $4.50 per million, Class B $0.36 per million, egress free, with a monthly
free tier of 10 GB, 1 million Class A and 10 million Class B. Infrequent Access storage $0.01 per
GB-month, Class A $9 and Class B $0.90 per million, $0.01 per GB retrieved, and a 30-day minimum.

- **Originals:** keep deleting them. The app already uploads at 2048 px, so the original adds
  little that the developed photo lacks, it carries the camera's metadata, and the privacy policy
  says it is deleted (`privacy.md:40-43`). The uploads bucket's one-day lifecycle rule is the
  safety net.
- **Archived events:** a lifecycle rule on `linger-media` moving objects older than 120 days to
  Infrequent Access approximates "90 days after the reveal" (lifecycle rules work on object age,
  not tags). That saves about a third of storage. Archived events are rarely viewed, and cache
  hits don't count as retrievals.
- **Deleted events:** delete objects immediately as today, or keep a short soft-delete (rows
  marked deleted, no tokens issued, objects removed by a job after 7 days) to recover from a
  mistaken delete. If you add a soft-delete, the privacy policy has to say "within 7 days".
- **Backups:** R2 has no object versioning, and once a photo is uploaded the device deletes its
  copy, so R2 holds the only copy. R2's durability covers hardware; it doesn't cover a bug in
  `removePrefix`, a leaked key or a mistaken delete. For launch: give the API an R2 token scoped
  to the two buckets with no bucket-admin rights, rely on the soft-delete above, and back up
  Postgres (it is the index of what exists). A copy to a second bucket in another account doubles
  storage and Class A cost; worth it later for paid events, not at launch. Fill in the backup
  retention line the privacy draft leaves open (`privacy.md:89-90`).

## 7. Gaps and bugs in the current storage code

### Blockers

1. **No production CORS for R2.** Only localhost origins exist (`docker/storage-cors.json`,
   `docker-compose.yml:37,58-65`). Browser guests can't PUT photos or covers, and web Save and
   Share fail on the CORS fetch (`save.web.ts:5`). Nothing in `render.yaml` or `productionProblems`
   (`http.ts:77-88`) would catch it.
2. **Develop and delete race, leaving photos of deleted events in storage.** `developShot`
   writes `developed` and `thumb` (`shots.ts:163-164`) and then updates the row with no state
   guard (`shots.ts:165-169`). If the event or the shot was deleted while the job ran, the update
   matches nothing, but the two objects stay forever with no row pointing at them. Likewise, an
   upload URL stays valid for 15 minutes (`storage.ts:47`) after `deleteEvent` has emptied the
   prefix (`events.ts:365`), so a late PUT recreates an original with no row. The privacy policy
   says these files are deleted (`privacy.md:82-87`). Fix: check the update's result and delete
   what was written when it matches nothing; send uploads to the lifecycle-cleaned uploads bucket;
   and run a second sweep of the prefix 20 minutes after an event is deleted.

### Should-fix

3. **Develop runs in the API process.** `applyLook` blocks the event loop for 32 to 113 ms per
   photo on this Mac (`shots.ts:107`), more on Render starter, while the same process serves the
   gallery. Move it to a background worker.
4. **Develop jobs give up after three quick retries** (`shots.ts:228,651`: `retryLimit: 3,
   retryDelay: 10`). An R2 or network blip of about 30 s leaves the shot `uploaded` forever:
   counted as taken, never shown, with its original (and its metadata) kept. Use
   `retryBackoff: true` with a longer limit, and sweep stale `uploaded` shots back into the queue.
5. **Web re-downloads every tile on every refresh.** Fresh signatures each time
   (`shots.ts:334-335`), expo-image on web ignores `cacheKey` (`ui.tsx:1488-1490`), frequent polls
   (`event.tsx:236-249`). Option (b) fixes it; with (a), round `signingDate` to the hour.
6. **No `Cache-Control` on stored objects** (`storage.ts:89-93`). One line in `put`.
7. **Event and account deletion run inside the request.** An event of 6,000 photos is about
   18,000 objects: 18 list calls and 18 batch deletes (`storage.ts:143-155`), several seconds,
   while the app's API timeout is 20 s. `deleteHost` does this for every event in series
   (`accounts.ts:130-135`). Move both into a pg-boss job after the rows are deleted or marked.
8. **Photo delete removes the row before the objects** (`shots.ts:732-733`). If storage fails,
   the row is gone, a retry 404s, and the files stay. Reverse the order, or let a sweep catch it.
9. **Covers are stored raw.** HEIC is accepted (`storage.ts:64`) but most browsers and link
   preview crawlers can't render it; up to 15 MB is served as `og:image`; web uploads keep EXIF
   location; `hasCover` is set before any upload (`events.ts:552-556`), so a failed upload leaves
   an event pointing at a missing cover until the HEAD 404s; and the fixed key
   (`storage.ts:57`) will serve a stale cover from a CDN. Develop covers through sharp (rotate,
   about 1600 px JPEG, no metadata) behind a confirm step, and version the key.
10. **Save all and "load whole gallery" stop at 6,030 photos** (`gallery.ts:153,169`, no `limit`
    sent from `api.ts:467-471`), and the mid-run renewal refetches every page
    (`gallery.ts:362-373`). Ask for `limit=100`, raise the guard, and renew only the remaining
    items, ideally through a light endpoint returning ids and full URLs only.
11. **Recap slides never renew** (`recap.tsx:79-92`). After an hour, uncached slides fail to load
    silently and Save or Share fail. Refetch highlights when the earliest expiry is near, or reuse
    `useFreshGallery`'s timer.
12. **The health check depends on R2** (`server.ts:58-68`, `storage.ts:157-164`). A short R2 issue
    makes Render mark the API unhealthy even though everything except photos works. Keep storage
    in a readiness detail, not the status code.

### Later

13. **Highlights read every visible shot of the event per call** (`shots.ts:563-567`): 6,000 rows
    for each of 250 guests opening the moment at the reveal. Fine at launch; cache the pick per
    event and viewer kind for a minute if it shows up.
14. **Gallery counts run on every page** (`shots.ts:401-408`). Cheap at 6,000 rows (your 10 ms
    page includes it). A partial index `(event_id, taken_at, id) where state = 'developed'` would
    match the page query and its tie-break better than `shots_event_idx (event_id, taken_at)`
    (`db.ts:131`).
15. **Signing cost and response size.** About 6 ms and 28 KB of URLs per 30-item page today; at
    the reveal 250 first pages arrive together. HMAC tokens bring this to well under 1 ms and
    about a third of the bytes.
16. **`keepUploaded` HEADs stale reservations one by one every minute** (`shots.ts:217-220`).
    Run them with limited concurrency if many reservations go stale at a venue with poor signal.
17. **Saving downloads the photo again** even when expo-image has it (`save.ts:10-12`). With the
    stable media URLs it is a cache hit at the edge, so this matters less after (b).
18. **No location hint or jurisdiction chosen for the bucket.** Pick the hint closest to the
    first markets, and consider the EU jurisdiction if EU events are expected.
19. **An orphan reconcile job.** A weekly listing of `e/` with `Delimiter: "/"` returns one entry
    per event folder (cheap) and catches whole-event orphans whose row no longer exists.

## Not verified

- Behaviour against real R2: CORS strictness, signed `Content-Length` enforcement, and
  `DeleteObjects` limits. Everything here was checked against RustFS behaviour in the code and
  R2's documented API, not a live bucket.
- Whether `is_timed_hmac_valid_v0` is on the zone plan you'll use (I believe Pro or above),
  whether Smart Tiered Cache is on by default for R2 custom domains, and whether purge by prefix
  is available on that plan.
- Current R2, Cloudflare Images and Render bandwidth pricing. The numbers above use the prices I
  know and should be checked before budgeting; Render bandwidth in particular.
- Whether the iOS picker with `allowsEditing` strips location from covers.
- Develop time and memory on a Render starter instance. The `applyLook` timings and image sizes
  come from this Mac and the demo photos without the look.
- Cache hit rates and latency figures are estimates from how Cloudflare's cache works, not
  measurements.
