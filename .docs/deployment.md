# Deploying the backend

How Linger's production backend is set up, in the order to do it. Photos are stored on Cloudflare
R2, the API and the worker run on Render, and Postgres runs on Neon. Staging uses the same setup
at a smaller size, and `device-testing.md` covers testing against it from a phone.

Steps marked **Naib** need your accounts. Steps marked **Claude** run from the terminal here.
Prices were checked on 2026-11-07 and should be read again on each provider's pricing page before
you commit to a plan.

## The shape

| Piece | Where | Size at launch | About |
| --- | --- | --- | --- |
| `linger-api` | Render web service, Ohio | Standard, 1 CPU, 2 GB | $25 a month |
| `linger-worker` | Render background worker, Ohio | Standard, 1 CPU, 2 GB | $25 a month |
| `linger-site`, `linger-join` | Render static sites | | Free |
| Postgres | Neon Launch, AWS us-east-2 (Ohio) | 0.5 to 2 CU, always on | $40 to $60 a month |
| Photos | Cloudflare R2 | Pay for what's stored | A few dollars at first |
| Email | Resend (or Postmark) | | Free tier, then $20 |

That's roughly $95 to $115 a month before traffic. Render's Hobby workspace is enough to start;
Pro ($25) adds autoscaling, which waits on F11 anyway.

**The API** answers requests and puts jobs on the queue, but runs none (`ROLE=api`). **The worker**
runs the job handlers, the crons and the photo develop step with sharp (`ROLE=worker`). Locally one
process does both, as before. Migrations run once per deploy in Render's pre-deploy step, before
the new API starts.

Both run in Ohio, and Neon's us-east-2 is in the same region, so a query is a few milliseconds
away. Tondo and Lumischool run the same pairing. Ohio is a little further from Vancouver than
Oregon, which matters far less than the API and the database sitting together.

### Why Neon for Postgres

Neon replaces the Render Postgres plan that B10 flagged (a tenth of a CPU and no point-in-time
recovery). On Neon's Launch plan the database autoscales between the sizes you set, you can
restore to any moment in the restore window, and a branch gives you a copy of the data in seconds
for testing a migration. Compute is billed by the hour at about $0.106 per CU-hour (1 CU is about
1 CPU and 4 GB), and storage at about $0.35 per GB-month.

Two settings matter for Linger:

- **Scale to zero stays off in production.** The job queue checks the database every few seconds,
  so the database would rarely sleep anyway, and waking it costs the first request a few hundred
  milliseconds.
- **Use the direct connection string,** the host without `-pooler`. pg-boss keeps a listening
  connection and takes session locks, which Neon's pooler doesn't support. The API and the worker
  are long-running servers with about 30 connections between them, well inside what a direct
  connection allows. Neon's strings include `channel_binding=require`; the API drops that one
  setting because the Postgres client would otherwise send it to the server and fail to connect,
  and TLS stays on through `sslmode=require` (`connectionUrl` in `apps/api/src/db.ts`).

### Why not Neon Auth

Linger doesn't need it. Hosts sign in with an emailed six-digit code, the session is a random
token whose hash is stored in Postgres, and guests have no account at all, only a device id per
event. That's about 200 lines in `apps/api/src/accounts.ts`, covered by tests, with the review
login built on it.

Neon Auth is a hosted Better Auth. Moving to it would mean rewriting sign-in in the API and the
app, fitting the device-based guests around it, and adding a second service to every sign-in, and
it doesn't fix anything Linger has today. It's worth looking at again if Linger adds Sign in with
Apple or Google, or teams. Apple only requires Sign in with Apple when an app offers another
company's sign-in, so email codes alone are fine for review.

## 1. Domains and DNS (Naib)

- [ ] Decide D4: `lingercam.app` for the site, `join.lingercam.app` for guest links,
      `api.lingercam.app` for the API, and `media.lingercam.app` for photos.
- [ ] Move the domain's DNS to Cloudflare (free plan) if it isn't there. R2's custom domain and
      its cache need the zone on Cloudflare.

## 2. Neon (Naib)

- [x] The Galleo organisation is on **Launch**.
- [x] 2026-11-07: project `lingercam` (`rough-rain-26031873`), Postgres 18, **AWS US East 2
      (Ohio)**, database `neondb`, role `neondb_owner`.
- [x] 2026-11-07: branch `production`, compute `ep-still-leaf-be8wvgtt`: autoscaling **0.5 to 2
      CU**, **scale to zero off** (set through the Neon API).
- [x] 2026-11-07: restore window 7 days.
- [ ] Copy the connection string with **pooling off**. It starts `postgresql://` and its host
      has no `-pooler`. It goes into Render as `DATABASE_URL`.
- [ ] For staging, a second project `lingercam-staging` in the same region at **0.25 CU** with scale
      to zero **on**. Suspend the staging service on Render between test runs and it costs close
      to nothing. Don't make staging a branch of production: a branch copies live guests' data.

## 3. Cloudflare R2 (Naib)

- [ ] R2 → Create bucket `linger` (location automatic). For staging, `linger-staging`.
- [ ] Manage API tokens → **Object Read & Write**, limited to those buckets. Keep the Access Key
      ID, the Secret Access Key and the endpoint `https://<account id>.r2.cloudflarestorage.com`.
- [ ] Bucket → Settings → CORS (B9), so browser guests can upload and save:
      ```json
      [{ "AllowedOrigins": ["https://join.lingercam.app"],
         "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"],
         "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
      ```
- [ ] Bucket → Settings → Custom domain `media.lingercam.app`. Nothing uses it until stage 3's
      code lands (below); today photos are served by signed URLs on the R2 endpoint.

## 4. Email (Naib)

- [ ] Resend: add the domain `lingercam.app`, and add the SPF, DKIM and DMARC records it lists
      in Cloudflare DNS. Wait for it to verify.
- [ ] Create an API key. `SMTP_URL` is `smtp://resend:<api key>@smtp.resend.com:587`.
- [ ] Make sure `support@galleo.app` receives mail, since reports go there.

## 5. Push and Expo (Naib)

- [ ] `cd apps/app && npx eas credentials` → iOS → production → Push Notifications → create a key.
- [ ] expo.dev → Account settings → Access tokens → create one for the API: `EXPO_ACCESS_TOKEN`.

## 6. Render (Naib, with Claude)

- [ ] render.com → New → **Blueprint** → this repository → `render.yaml`.
- [ ] Fill the env group `linger-backend`:
      - `DATABASE_URL`: Neon's direct string from step 2.
      - `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: from step 3.
      - `SMTP_URL`: from step 4.
      - `EXPO_ACCESS_TOKEN`: from step 5.
      - `REVIEW_EMAIL`, `REVIEW_CODE`: the App Review login (any email you control, six digits).
      - RevenueCat and Stripe: empty until S2 and S3; the free tier works without them.
- [ ] Apply. The order on each deploy is build, then `db:migrate` against Neon, then the API and
      the worker start. The API refuses to start if a required production setting is missing,
      and says which one in the log.
- [ ] Settings → Custom domains: add `api.lingercam.app`, `lingercam.app` and
      `join.lingercam.app`, and the CNAME records Render shows into Cloudflare DNS, **DNS only**
      (grey cloud) so Render can issue certificates.

**Checks (Claude):**

- [ ] `https://api.lingercam.app/health` answers `{"ok":true,"database":true}`, and
      `/health/deep` adds `"storage":true`.
- [ ] The worker's log shows `worker running` and no queue errors.
- [ ] Render Shell on `linger-api`: `pnpm --filter api review-seed`, then sign in with the review
      login on a phone.
- [ ] `https://join.lingercam.app/RVW4PP` shows the event's preview and opens the camera.
- [ ] A photo taken on a phone develops (the worker logs it), and appears in the gallery.

## 7. Watching it (Naib, with Claude)

- [ ] An uptime check on `/health/deep` every minute (Better Stack or UptimeRobot, both free at
      this size), alerting by email.
- [ ] Sentry for the API, the worker, the app and the web build (B11). Needs a Sentry project and
      its DSN; the code change is Claude's.
- [ ] Neon's monitoring page for connections and CPU, and Render's metrics for memory on the
      worker, during the first real events.

## What still needs code before real users

The setup above runs today's code. These items in `launch-review.md` change how it behaves in
production and should land before S6 (TestFlight with real people):

- **Stage 2, reveal correctness:** B4 (a reveal sweep every minute), B5 (one job per reveal email,
  marked sent after it goes), B6 (the code-miss limiter locking out a venue).
- **Stage 3, photos on the CDN:** the timed token URLs on `media.lingercam.app` behind Cloudflare's
  cache, a separate uploads bucket with a one-day expiry rule (B8), the develop checks and retries
  (F1 to F3), the 1024 px grid image.
- **Stage 4, operations:** Sentry (B11); the deep health check and the longer graceful stop are
  done (F18, F19). The rate limiter in Postgres (F11) before the API runs more than one instance.

## Recovering

- **A bad deploy:** Render → the service → Deploys → roll back to the previous one. A migration
  that already ran isn't undone by that, so migrations stay additive: add columns and tables,
  and remove old ones in a later deploy.
- **Lost or damaged data:** Neon → the project → Restore, to a moment before the problem, into a
  new branch first to check it. Then point `DATABASE_URL` at it or restore over production.
- **Photos:** R2 has no undo for deletes. Deleting an event deletes its photos for good, as the
  privacy policy says.
