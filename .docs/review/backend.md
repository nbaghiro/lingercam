# Linger backend: runtime, scale and production plan

Reviewed 2026-11-04 against the working tree in /Users/naib/Documents/code/linger (last commit
c4a5698). Read only; no repo files changed. Benchmarks were run from the scratchpad, importing the
repo's own `developImage` and `downloadUrl`.

Paths below are relative to the repo root. `api/` means `apps/api/src/`.

---

## 1. Today's runtime model

### One process does everything

`render.yaml:10-16` defines a single `linger-api` web service on `plan: starter` (0.5 CPU, 512 MB),
plus two static sites (`linger-site`, `linger-join`). There is no background worker service.

`api/server.ts:103-129` (`main`):

1. Refuses to start in production if `productionProblems()` finds missing or local-default settings
   (`api/http.ts:77-88`: `SESSION_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, `SMTP_URL`, and `DEV_ROUTES=1`).
2. Runs Drizzle migrations in-process: `migrate()` (`api/server.ts:111`, `api/db.ts:243-245`). No
   advisory lock and no pre-deploy step.
3. `startWorkers()` (`api/server.ts:92-101`) starts pg-boss and registers every worker in the same
   process as the HTTP server:
   - `develop` (`api/shots.ts:233-235`): `batchSize: 2`, handled one after another, pg-boss default
     `localConcurrency` 1, so one photo at a time per process. Jobs are sent with `retryLimit: 3,
     retryDelay: 10` (`api/shots.ts:228`, `:651`).
   - `release-reservations` cron every minute (`api/shots.ts:236-239`).
   - `expire-sessions` cron hourly at :17 (`api/accounts.ts:95-100`).
   - `push-receipts`, delayed 15 min after each push batch (`api/notify.ts:88-91`, `:109-113`).
   - `reveal` (`api/reveal.ts:112-116`): runs `advance()` per job, serially.
   - Then a one-off catch-up: `revealOverdue()` and `releaseExpired()` (`api/server.ts:98-100`).
     This is the only sweep for overdue reveals; it runs at boot and never again.
4. Serves Hono on `PORT` (default 8171).
5. SIGTERM: closes the listener, `stopQueue()` with a 5 s graceful timeout (`api/db.ts:236-241`),
   then `sql.end({ timeout: 5 })` and exit (`api/server.ts:117-128`).

sharp and the film look run inside that same process. `developImage` (`api/shots.ts:95-115`)
decodes and resizes in sharp (libuv threadpool), then runs `applyLook`
(`packages/core/src/film.ts:197+`) as a plain JS loop over every pixel on the main thread, then two
more sharp encodes.

### pg-boss specifics (v12.38.0)

- Own pool `max: 4` (`api/db.ts:223`); app pool `postgres(..., { max: 10 })` (`api/db.ts:210`), so 14
  connections per process.
- Default polling 2 s (`pg-boss/dist/attorney.js:640-642`), and it uses LISTEN/NOTIFY as a fast
  path, which needs a session (not transaction-pooled) connection.
- Queue defaults: `retry_limit: 2`, `retry_delay: 0`, `expire_seconds` 15 min, retention 14 days
  counted from `start_after` (`pg-boss/dist/plans.js:85-94`, `:2855`), so the 90-day archive job is
  safe from retention.
- No `boss.on("error", ...)` anywhere in `api/`. pg-boss re-emits internal errors on its
  EventEmitter (`pg-boss/dist/index.js:129`, `boss.js:213`, `:235`, `:447`, `:478`). With no
  listener, Node throws on an `error` event, so a maintenance or supervise query failing (a DB
  restart, a failover) crashes the API.

### Health check

`GET /health` (`api/server.ts:58-68`) runs `select 1` and an R2 `HeadBucket`, and returns 503 if
either fails. Render uses it for deploys and instance health (`render.yaml:16`).

### Env vars production needs

Required by code (startup refuses without them): `SESSION_SECRET`, `S3_ENDPOINT`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_URL`, and `NODE_ENV=production`.

Set in `render.yaml:17-61`: `NODE_VERSION=26`, `NODE_ENV`, `TRUST_PROXY=1`, `DATABASE_URL`,
`API_URL`, `SITE_URL`, `JOIN_URL`, `CORS_ORIGINS`, `SESSION_SECRET` (generated), `S3_ENDPOINT`,
`S3_REGION=auto`, `S3_BUCKET=linger`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_URL`,
`MAIL_FROM`, `EXPO_ACCESS_TOKEN`, `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

Optional, with defaults: `PORT` (Render sets it), `S3_FORCE_PATH_STYLE` (defaults `"true"`, fine on
R2), `S3_PUBLIC_ENDPOINT` (leave empty in production), `JOIN_INDEX_URL`, `LOG_SILENT`.

Silently degraded if missing, and not checked at startup: `EXPO_ACCESS_TOKEN` (push is skipped with
an info log, `api/notify.ts:22-25`), `REVENUECAT_*` (claims 503, webhook 401 forever), `STRIPE_*`
(checkout 503). These should be in `productionProblems`.

Needed by the proposed split (section 3): an env such as `ROLE=web|worker`, and an environment group
so both services share secrets.

---

## 2. Load model

### Inputs

- Allowance: default 24 shots, max 36 (`packages/core/src/events.ts:21-23`); unlimited is a paid
  add-on. Largest tier 250 guests (`packages/core/src/pricing.ts:38`).
- One 250-guest event: up to 6,000 photos at the default (9,000 at max). I assume about half the
  allowance gets used, so ~3,000, and treat 6,000 as the high case.
- Photos arrive at about 2048 px: the native camera scales to 2048 px (`.docs/plan.md:506`), and
  `shrink.ts` retries at 2048 px when the server says too large.

### Polling (from the app)

`apps/app/src/event.tsx:100-107`, `:198-201`, `:236-258`:

- Each tick calls `reloadAll()` = gallery + summary: 2 requests.
- Developing, more than a minute before the reveal: every 30 s (`POLL_MS`).
- From one minute before the reveal until photos arrive: every 5 s (`REVEAL_POLL_MS`).
- One extra tick at `revealsAt + 3 s` (`REVEAL_GRACE_MS`), timed by the server's clock, so every open
  client fires in the same second.
- After the reveal, polling stops except a 4 s catch-up for 30 s when this device's own late photos
  are developing (`CATCH_UP_POLL_MS`).
- Polls are skipped while the app is backgrounded (`event.tsx:203-206`).
- Camera screen: summary every 60 s (`apps/app/src/shutter.tsx:94`, `:185-187`). Join sheet while
  waiting: summary every 15 s (`apps/app/src/join.tsx:56`, `:98-100`).

DB work per request for a guest (no bearer token):

- `GET /v1/e/:code` (summary): event by code, guest by device, host name, guest count, photo count
  plus distinct photographers: 5 queries (`api/events.ts:173-183`, `:272-323`).
- `GET /v1/e/:code/gallery` while developing: event, guest, counts, first 40 names: 4 queries
  (`api/shots.ts:363-397`).
- After the reveal, the gallery is 4 queries plus 2 signed URLs per item, 30 items by default
  (`api/shots.ts:330-345`, `:421-429`).

The count queries walk all of an event's shots through `shots_event_idx (event_id, taken_at)` and
filter on state, so each touches 3,000 to 6,000 index entries at the end of a big event.

### Requests per second at the reveal

Per foreground client: 0.067 rps far from the reveal, 0.4 rps in the last minute.

| Scenario | Foreground clients | Steady rps (last minute) | Burst at revealsAt+3 s | Queries/s |
| --- | --- | --- | --- | --- |
| 1 event, 250 guests, at-end reveal | 100 to 200 (40 to 80%) | 40 to 80 | 200 to 400 requests within ~1 s | 180 to 360 |
| 1 event, then everyone opens on the push | 250 opens over 1 to 2 min, ~5 API calls each (summary, gallery, people, me, highlights) | 10 to 20 on top | | |
| 20 events, staggered reveals (3 to 5 overlap) | 300 to 1,000 | 120 to 400 | | 540 to 1,800 |
| 20 events, same minute (midnight at-end, or 10:00 next-morning in one time zone) | 2,000 to 4,000 | 800 to 1,600 | 4,000 to 8,000 in ~1 s | 3,600 to 7,200 |

Next-morning reveals (`packages/core/src/reveal.ts:84-96`) always land at 10:00 local, so events in
one time zone align by design, though fewer people sit watching a countdown at 10:00.

Signing cost, measured: `downloadUrl` takes 0.08 ms wall, 0.10 ms CPU per URL on an M4 Pro. A
30-photo gallery page signs 60 URLs, about 6 ms CPU here, likely 12 to 20 ms on a cloud vCPU. That
matters only for the opening burst (250 openers x ~80 signatures = ~5 CPU-s per event on a cloud
vCPU), not for polling.

Node work per poll is small (a few ms), so one 1-CPU web instance should carry roughly 200 to 400
rps of these requests. That is an estimate; I didn't load test.

### Develop jobs at the end of shooting

Measured on this Mac (Apple M4 Pro, Node 26.10, `sharp.concurrency(1)`), 2048x1536 input,
`developImage` from `api/shots.ts`:

| Look | Wall per photo |
| --- | --- |
| natural@1 | 160 to 215 ms |
| warm-98@1 (halation) | 235 to 250 ms (one 566 ms outlier) |
| mono@1 | 156 to 161 ms |

Ten warm develops in a row: 2.38 s wall, 2.47 s CPU, peak RSS 371 MB for the whole process.
`applyLook` alone on 2048x1536 blocks the main thread for 26 ms (natural), 65 ms (mono) and 106 ms
(warm). A 4032x3024 input took 180 to 280 ms. This matches `.docs/plan.md:270` ("about 0.1 s per
2048 px photo") for the look step and is consistent with the test's 1,500 ms ceiling
(`api/shots.test.ts:587-598`), which is the "good time" it means.

Cloud estimate: a shared cloud vCPU is usually 1.5 to 3 times slower per core than an M4 Pro, so
about 0.4 to 0.7 s per photo on 1 CPU, and 1 to 1.5 s on Render Starter (0.5 CPU). Unverified.

Throughput with today's settings (1 photo at a time per process):

- Starter: ~40 to 60 photos/min. 1 CPU: ~90 to 150 photos/min.

Demand:

- One 250-guest event, 3,000 photos, 20% arriving in the last 15 minutes as queued uploads flush:
  ~40/min, with bursts of a few hundred when phones reconnect. One 1-CPU worker keeps up and drains a
  1,000-photo burst in ~7 to 11 minutes.
- 20 events on a Saturday: 60,000 to 120,000 photos a night, ~9 to 18 CPU-hours. Spread over 5
  hours that is 2 to 4 vCPUs on average; if the ends cluster around 23:00 to 01:00, peaks need 6 to
  12 vCPUs to stay real-time, or the queue backs up for tens of minutes. For an at-end reveal, photos
  still in the queue miss the reveal moment and the push line's count
  (`api/reveal.ts:12-20`, `:27-28`) is low.

Memory: a 2048 px develop holds the raw RGB buffer (9.4 MB), the output (9.4 MB) and two Float32
halation planes (12.6 MB each), plus libvips cache and JPEG buffers. Peak RSS of 371 MB for a
sequential run makes Starter's 512 MB unsafe, especially with sharp's cache and glibc fragmentation
on Linux.

### DB connections

14 per process (10 app + 4 pg-boss). Every Render Postgres plan up to 4 GB caps at 100 connections
(render.com/pricing.md).

- 2 web + 1 worker: 42. 4 web + 4 workers (an autoscale ceiling): 112, over the cap. Size pools per
  role (web: app 8, boss 2; worker: app 4, boss 4) or add PgBouncer for the app pool only.

### Push fan-out

- On reveal, `notifyReveal` sends to the host and every guest device with a stored token
  (`api/reveal.ts:26-37`, `api/notify.ts:116-134`): up to ~250 native guests plus the host. Web
  guests get the email instead.
- Expo chunks at 100, so ~3 sequential HTTP calls, about 1 s per event. 20 events: ~5,000 pushes,
  below Expo's documented 600 notifications/s per project as long as the sends aren't simultaneous
  (unverified figure).
- `eventTokens` with guests is a LEFT JOIN from `push_tokens` with an OR (`api/notify.ts:120-128`),
  so it scans the whole `push_tokens` table on every reveal and every silent push. Fine at launch,
  linear in all tokens ever stored.
- Emails are the real cost: the reveal job emails each guest who left an address, one by one
  (`api/reveal.ts:44-49`), through a nodemailer transport without `pool: true`
  (`api/notify.ts:15`), so each email opens a new SMTP connection: ~0.2 to 0.8 s each. 100 web
  guests is 20 to 80 s per event, inside the reveal job. The reveal worker processes jobs serially
  (`api/reveal.ts:113-115`, default concurrency 1), so with 20 events revealing in the same minute
  the last event's state flip waits behind the earlier events' emails: up to ~20 to 30 minutes.

---

## 3. Render

### What the blueprint gets wrong for production

- One service on Starter runs HTTP, crons, pg-boss and sharp (`render.yaml:10-16`). The film look
  stalls the event loop for 25 to 110 ms per photo here (more on a cloud vCPU), back to back while
  the queue is full, which is exactly when guests are polling.
- `basic-256mb` Postgres (`render.yaml:3-7`) is 0.1 CPU and is excluded from point-in-time recovery
  (PITR needs at least 0.5 CPU and 10 GB of storage). It won't carry the reveal queries above.
- No `region`, so everything defaults to Oregon. Fine, but make it explicit.
- No `preDeployCommand`; migrations run in every booting instance.
- `healthCheckPath` points at a deep check that includes R2.

### Recommended layout

| Service | Type | Plan | Notes |
| --- | --- | --- | --- |
| `linger-api` | web | 1c-2g ($25), 1 instance at launch, 2 once the limiter is shared | HTTP only. Starts pg-boss for `send` with supervise and schedule off and registers no workers. |
| `linger-worker` | background worker | 1c-2g ($25) | All `boss.work` handlers, crons, the startup catch-up and a new reveal sweep. Develop `localConcurrency` = vCPUs. Scale up for Saturday nights. |
| `linger-db` | Render Postgres | 0.5c-1g ($19) with 10 GB storage ($3) at launch; 1c-4g ($55) once weekends run 5+ events at once | Qualifies for PITR. Same region as the services, private network. |
| `linger-site`, `linger-join` | static | free | As today. |

Workspace: Pro ($25/month) for horizontal autoscaling and 7-day PITR (Hobby gets 3 days and no
autoscaling). Hobby also includes only 5 GB of bandwidth; photos go straight from R2, but gallery
JSON is ~40 KB a page with signed URLs, so watch it.

Other settings:

- `preDeployCommand: pnpm --filter api db:migrate` (the script exists, `apps/api/package.json:10`),
  and take `migrate()` out of `main`. Keep migrations expand-then-contract, because old instances
  serve against the new schema during a rollout.
- A shallow `/health` (process is up and the DB pool answers) for Render; keep the R2 check on a
  separate `/ready` for monitoring.
- `maxShutdownDelaySeconds` around 30 and pg-boss graceful stop around 25 s, so an in-flight develop
  finishes.
- An environment group holding the secrets, attached to both services.
- Region: Oregon (closest to Vancouver, good for the US West Coast). If the launch market is mostly
  US East, pick Ohio or Virginia. Put the R2 bucket's location hint in the same half of the
  continent (WNAM or ENAM).
- Node 26 native runtime via `NODE_VERSION`: I couldn't confirm that Render's native runtime offers
  26. If it doesn't, use the Docker runtime, which also lets the worker preload jemalloc for sharp.

### Autoscaling pitfalls

- In-memory rate limiter (`api/http.ts:106-136`): with N instances every limit becomes N times
  looser, and a deploy or scale event resets it. Move it to Postgres (an UNLOGGED counter table) or
  Render Key Value before running 2+ web instances.
- `cachedIndex` (`api/events.ts:383-391`) is per instance but harmless (a 5-minute cache of the
  join page).
- pg-boss is multi-instance safe: crons are singleton, `advance` locks the event row
  (`api/reveal.ts:58-69`), and the startup catch-up can run on several instances at once.
- Autoscaling reacts to CPU or memory over minutes, too slow for a reveal burst that lasts seconds.
  Size the web for the burst, or scale up by schedule (the API can change instance count) on
  Saturday evenings.
- Whether Render autoscales background workers, as opposed to web services, I couldn't confirm.
  Manual or scheduled scaling of the worker works either way.

### Cost estimates (Render list prices, render.com/pricing.md, fetched 2026-11-04)

| Setup | Monthly |
| --- | --- |
| Lean: Hobby workspace, one 1c-2g service doing both roles, 0.5c-1g DB + 10 GB | ~$47 |
| Recommended launch: Pro workspace, web 1c-2g, worker 1c-2g, 0.5c-1g DB + 10 GB | ~$97 |
| Busy weekends: web x2, DB 1c-4g, worker scaled to 4 for ~6 h on Fri and Sat (billed per second) | ~$165 to $180 |

R2 storage, Expo, the email provider and Sentry are separate.

### Other hosts

- Cloudflare Workers plus Hyperdrive: not a fit. sharp is a native libvips binding and won't run on
  Workers; the WASM route (CanvasKit) measured 6.8 to 11 s a photo (`.docs/plan.md:265-270`), past
  Workers' CPU limits. pg-boss needs a long-lived process, and nodemailer needs SMTP. You'd still
  need a container somewhere for developing.
- Fly.io: cheaper CPU, web and worker process groups in one app, and machines that can start on
  demand. But you'd run your own Postgres or pay for Fly's managed one, with more operational
  surface. Nothing in the code needs it.
- Railway: usage billing and simple services. Similar fit to Render, no specific advantage.

Recommendation: stay on Render with the split above. Nothing in the code is a reason to move.

### Render Postgres vs Neon vs Supabase

- Render Postgres: same private network, PITR (7 days on Pro), 100 connections up to 4 GB, no
  built-in pooler (run PgBouncer as a private service if needed). Simplest.
- Neon: PITR included, branching is nice for staging. pg-boss polls every 2 s, so compute never
  scales to zero: you pay for an always-on compute. The pooled endpoint is PgBouncer in
  transaction mode, which breaks pg-boss's LISTEN/NOTIFY and session state, so pg-boss needs the
  direct URL. A cross-provider hop adds a few ms to each of the ~9 queries per poll pair.
- Supabase (as plain Postgres): the Supavisor pooler has the same caveat. Daily backups on Pro, but
  PITR is a paid add-on.

Pick Render Postgres.

---

## 4. "Shared backend" vs keeping the Hono API

What exists and is tested: email-code sign-in with hashed sessions (`api/accounts.ts`), device-id
guests, a 10-table Drizzle schema with partial unique indexes and row locks for the guest limit and
shot allowance (`api/db.ts:25-192`, `api/events.ts:697-747`, `api/shots.ts:247-294`), the reveal
secret enforced on the server (`packages/core/src/shots.ts:94-139`), pg-boss jobs, signed S3 URLs,
purchases from RevenueCat and Stripe with idempotent application (`api/billing.ts:56-107`). That's
about 3,000 lines of API plus ~2,500 lines of tests (`wc -l api/*.ts`).

- **Supabase (full).** Auth has email OTP and anonymous users, so hosts and guests map. But the
  reveal secret, the allowance, the guest limit and the join window would become RLS policies and
  SQL functions duplicating `@linger/core`'s time logic; storage policies would have to encode "not
  before the reveal". Edge Functions run Deno, where sharp doesn't run, so developing still needs a
  Node worker. Purchases move to Edge Function webhooks. The app's `api.ts` client and every API
  test get rewritten. Several weeks, for a result that's harder to test than today's.
- **Firebase.** Firestore drops the relational schema and the single-UPDATE allowance check. Cloud
  Functions could run sharp. A full rewrite.
- **Convex.** Reactive queries would replace polling, which helps exactly the reveal spike, and
  scheduled functions fit reveals. Still a full rewrite off Postgres and Drizzle, with sharp in Node
  actions.
- **Appwrite.** Same rewrite cost, smaller ecosystem.

None of them removes a production problem found here; each one costs the tested code. The real
pain points (polling load, job fan-out, shared rate limits) are fixed in place in a few days.
Recommendation: keep the Hono API on Render Postgres. If polling ever becomes the bottleneck, add a
per-event cache or server-sent events driven by Postgres LISTEN, not a platform change.

---

## 5. Production gaps

Ratings: **Blocker** (fix before the first paid event), **Should-fix** (before real load or 2+
instances), **Later**.

### Blockers

1. **Reveal fan-out is serial and inline.** `advance` flips the state, then `notifyReveal` sends push
   and every email inside the same job (`api/reveal.ts:70-76`, `:26-51`); the worker is serial
   (`:113-115`); SMTP isn't pooled (`api/notify.ts:15`). Concurrent reveals queue behind each other's
   emails (section 2). Emails are claimed before sending (`api/reveal.ts:38-43`), so a restart or
   SMTP failure mid-loop loses them for good, and a throw after the commit is never retried because
   the next run sees `revealed`. Fix: `advance` only flips state and enqueues `reveal-notify`
   (one per event, singleton key); that job enqueues one `email` job per guest with retries;
   reveal worker concurrency of at least 4; pooled SMTP or the provider's HTTP API.
2. **No recurring reveal sweep, and the reveal depends on Node's clock agreeing with the DB's.**
   pg-boss starts the job when the DB's `now()` passes `start_after`; `advance` then checks with
   Node's `new Date()` (`api/reveal.ts:57-61`). If the job is picked up before Node thinks the time
   has come, `dueState` returns the same state, the job completes, and nothing re-checks until the
   next process boot (`api/server.ts:98`). The gallery keys off the stored state
   (`packages/core/src/shots.ts:106-120`), so guests would see "developing" indefinitely. Fix: a
   one-minute cron that runs `revealOverdue` (add an index on `events.state`; there isn't one), and
   in `advance`, re-send the job for the due time when it isn't due yet.
3. **Database plan.** `basic-256mb` is 0.1 CPU with no PITR (`render.yaml:3-7`). Use 0.5c-1g or
   larger with at least 10 GB storage, on a Pro workspace for 7-day PITR. Then do one restore
   drill into a scratch database before launch.
4. **pg-boss has no error listener** (`api/db.ts:223`). An emitted error crashes the process. Add
   `boss.on("error", ...)` that logs and reports. Add `process.on("unhandledRejection")` reporting
   too.
5. **sharp in the web process on Starter** (`render.yaml:13`, `api/shots.ts:100-114`, `:232-235`).
   Event-loop stalls and OOM risk at 512 MB. Split the worker (section 3).
6. **The code-miss limiter can lock out a whole venue.** `eventByCode` checks the miss limiter on
   every request with a code, hit or miss (`api/events.ts:173-181`), keyed by IP, 20 misses per 10
   minutes (`:167`). Guests on venue Wi-Fi or a carrier's CGNAT share one public IP; 20 mistyped
   codes from anyone there and every summary, gallery and shot request from that IP gets 429 for
   10 minutes, mid-event. Fix: key by device id when `X-Device` is present, with a much higher
   per-IP ceiling; leave strict per-IP limits for requests without a device.
7. **Error tracking and alerting don't exist.** Logs are JSON lines to stdout (`api/http.ts:53-57`);
   there's no Sentry or Rollbar, no uptime alert, and nothing that notices a reveal that didn't
   happen. Minimum: Sentry for the API (and the Expo app), an uptime check on `/health`, a log drain
   with retention (Better Stack or Axiom), and an alert when any event is past its reveal time and
   still `live` or `ended`. Sentry is the better fit than Rollbar here because one account covers the
   React Native app, the web build and the Node API, with release tracking for EAS builds; Rollbar
   works if you already pay for it.
8. **Email deliverability.** Sign-in depends on email (`api/accounts.ts:141-167`). SPF, DKIM and a
   DMARC record for lingercam.app with the chosen provider, a custom return-path, and bounce and
   complaint handling. I couldn't check DNS or which provider `SMTP_URL` will point at.

### Should-fix

9. **Shared rate limiter.** In memory per instance (`api/http.ts:106-136`, noted in
   `.docs/plan.md:360-361`). Also `check()` writes an empty entry for every IP it sees
   (`api/http.ts:109-113`), and above 50,000 keys every call walks the whole map, deleting only keys
   idle for 24 h: an O(n) cost per request under a distributed attack. Move to Postgres or Key Value.
10. **Client IP behind Render.** `clientIp` trusts the last `X-Forwarded-For` entry
    (`api/http.ts:94-98`). Confirm on a staging deploy what Render puts there, and if
    `api.lingercam.app` is ever proxied by Cloudflare, use `CF-Connecting-IP`. If it's wrong, every
    user shares one bucket and sign-in is capped at 20 starts per 15 minutes globally.
11. **Migrations at startup** without a lock (`api/server.ts:111`). Move to `preDeployCommand`.
12. **Deep health check** includes R2 (`api/server.ts:58-68`). An R2 blip fails every instance.
13. **Stripe refund idempotency.** `stripe.refunds.create` has no idempotency key
    (`api/billing.ts:366-369`); a retried webhook can refund twice. Use the Stripe event id as the
    key.
14. **Production config checks** miss `EXPO_ACCESS_TOKEN`, `REVENUECAT_*` and `STRIPE_*`
    (`api/http.ts:77-88`); push silently becomes a no-op (`api/notify.ts:22-25`).
15. **Graceful stop is 5 s** (`api/db.ts:240`). Raise it alongside Render's shutdown delay.
16. **Data deletion completeness.**
    - `deleteHost` (`api/accounts.ts:130-135`) doesn't send the "deleted" silent push that
      `deleteEvent` sends (`api/events.ts:363`), so guests' local reveal reminders still fire.
    - It cascades away `purchases` (`api/db.ts:175-192`), which conflicts with the tax-record
      retention question in `.docs/plan.md:495-497`. Keep purchase rows with the host detached.
    - `email_codes` rows (keyed by email, no FK) are never swept; the host's row survives deletion
      until the next sign-in attempt.
    - Storage is deleted before rows, and a develop job in flight can `put` the developed and thumb
      files after `removePrefix` (`api/shots.ts:163-164`), leaving orphans. Nothing sweeps orphans.
    - Guests can delete photos one at a time and clear their email, but there's no "remove me from
      this event" route.
    - Backups keep deleted data for the PITR window; say so in the privacy policy.
17. **Sign-in email spam.** Any address can be sent a code (`api/accounts.ts:141-167`), limited per
    instance. Add Cloudflare Turnstile on the web sign-in or a global hourly send cap, and rely on
    the provider's suppression list. Otherwise abuse hurts sender reputation and blocks real
    sign-ins.
18. **Thundering herd at revealsAt+3 s** (`apps/app/src/event.tsx:251-258`). Add 0 to 3 s of random
    jitter and stagger the 5 s polls. Cache the developing counts per event for 2 to 3 s on the
    server; per-instance caching is fine at that TTL.
19. **Develop concurrency.** Set `localConcurrency` to the worker's CPU count, `sharp.concurrency(1)`
    per job, a small `sharp.cache`, and `MALLOC_ARENA_MAX=2` or jemalloc.
20. **Query shapes that grow.** `eventTokens` scans all push tokens (`api/notify.ts:120-128`);
    `/v1/joined` filters guests by device alone, but `guests_event_device_idx` leads with
    `event_id` (`api/events.ts:618-627`, `api/db.ts:98`). Add an index on `guests(device)` and
    rewrite the token query to start from guests.
21. **Session touch on every request.** `currentHost` updates `sessions.expires_at` on every
    authenticated call (`api/accounts.ts:77-81`), so host polling writes. Extend at most once a day.
22. **Secrets.** Use a Render environment group; scope the R2 token to the one bucket; use a Stripe
    restricted key; rotate `SESSION_SECRET` only knowing it invalidates pending email codes (it
    keys their HMAC, `api/accounts.ts:43-45`), not sessions. `.env` is git-ignored and untracked.

### Later

23. **Job idempotency is mostly right.** Develop checks `state === "uploaded"` first and the writes
    are overwrites (`api/shots.ts:142-171`); `advance` locks the row and is safe to repeat; purchases
    apply once per store transaction; receipts and reservation release are repeatable. Small leaks:
    the failed path can leave files if `removePrefix` throws after the state change
    (`api/shots.ts:152-160`). Only email (blocker 1) is unsafe.
24. **Client clock skew** is handled: the app takes the server's offset from the `Date` header
    (`apps/app/src/api.ts:235-272`, exposed by CORS at `api/server.ts:43`).
25. **Signed URLs** stay valid for an hour (`api/storage.ts:51`), including after a photo is hidden
    (known gap, `.docs/plan.md:550-551`). Anyone holding a URL can fetch it; scraping needs a joined
    device first. Shorten full-size URLs to 15 minutes later.
26. **Code enumeration.** 30^6 ≈ 729 million codes (`packages/core/src/events.ts:334-335`). At 20
    misses per IP per 10 minutes and 1,000 joinable events, one IP finds an event about once every
    250 days; 1,000 IPs find a few a day. A found live event can be joined, and with visibility
    "everyone" the stranger sees the photos after the reveal. Acceptable at launch with a shared
    limiter and a Cloudflare rate rule; consider 7 characters later.
27. **CORS** is an explicit allowlist with bearer auth and no cookies (`api/server.ts:16-19`,
    `:37-47`). Fine. Add staging origins when staging exists.
28. **DEV_ROUTES guard** is sound: `DEV_ROUTES === "1" && !isProduction` (`api/http.ts:72`), startup
    refuses `DEV_ROUTES=1` in production (`:86`), and every dev route checks it
    (`api/accounts.ts:217`, `:227`; `api/billing.ts:253`). The only risk is a staging deploy without
    `NODE_ENV=production` sharing a real database.
29. **Request logs** lack a request id, and log the masked path only. Add an id for tracing once
    Sentry is in.

---

## What I couldn't verify

- Cloud CPU speed relative to the M4 Pro: develop times on Render are estimates (1.5 to 3 times
  slower per core), not measurements.
- No load test: the rps capacity per instance and DB query timings are estimates.
- What Render puts in `X-Forwarded-For`, and whether `api.lingercam.app` will sit behind Cloudflare.
- Whether Render's native runtime offers Node 26, whether background workers autoscale, and Render's
  log retention per plan.
- Expo's current push rate limit (600/s per project is the last figure I know).
- The email provider and the DNS records for lingercam.app.
- Current Neon and Supabase pricing.
- pg-boss options for a send-only web instance (`supervise: false`, `schedule: false`) are from
  memory of the v10+ API; check the v12 types before relying on them.

Render prices: render.com/pricing.md, fetched 2026-11-04. PITR thresholds: render.com/docs/postgresql-refresh.
