# Testing on a physical iPhone

A step-by-step walkthrough for the final manual QA run: install a development build of Linger on
an iPhone, test it against the local backend on this Mac, then against a deployed staging backend
on Render and Cloudflare R2. It covers S5 in `launch-review.md` and leads into TestFlight (S6).

Steps marked **Naib** need your accounts or your phone. Steps marked **Claude** can run from the
terminal here.

## How the pieces fit

- **The development build** is the Linger app with a developer menu. It loads its JavaScript from
  Metro on this Mac, so code changes reload on the phone. It's installed once, and rebuilt only
  for native changes (new packages, `app.config.ts`).
- **Which backend it talks to** is set when Metro starts:
  - `pnpm device:on`: the local API and storage on this Mac, over Wi-Fi.
  - `pnpm device:staging`: the deployed staging backend on Render.
  - `pnpm device:off`: back to localhost, for the simulator only.

  After switching, restart Metro with `--clear`.
- **The standalone staging build** is a Release build with the JavaScript inside and staging's
  addresses built in. It doesn't need this Mac or Metro, so it's the closest thing to what users
  will get. It's installed from EAS and replaces the development build, because both use the same
  bundle id.

## 1. Before you start (Naib)

- [ ] **Apple Developer Program** membership for GalleoApp, Inc. A free team can't sign push, the
      Live Activity or associated domains.
- [ ] **Team ID:** developer.apple.com → Account → Membership details → Team ID (10 characters).
      Add it to `apps/app/.env.local` as `APPLE_TEAM_ID=XXXXXXXXXX`; the device scripts keep it.
- [ ] **Xcode:** Settings → Accounts → add the Apple ID on that team.
- [ ] **The iPhone:** iOS 18 or later, on the same Wi-Fi as this Mac, plugged in by cable for the
      first install, unlocked, and set to trust this Mac.
- [ ] **Developer Mode** on the iPhone: Settings → Privacy & Security → Developer Mode → on, then
      restart the phone and confirm. (The option appears after Xcode has seen the phone once; if
      it's missing, open Xcode → Window → Devices and Simulators with the phone plugged in.)
- [ ] **Expo account:** `npx eas login` in this repo, with the account that owns the project.

## 2. Install the development build (Claude, with the phone plugged in)

```
cd ~/Documents/code/linger
pnpm device:on                       # the local backend for now
xcrun xctrace list devices           # find the phone's exact name
cd apps/app && npx expo run:ios --device "<phone name>"
```

- Xcode's automatic signing registers the phone and creates the bundle id `app.galleo.linger`
  and the Live Activity's `app.galleo.linger.activity`, with push and the app group.
- The first build takes 5 to 10 minutes. It installs and opens the app on the phone.
- **On the phone, if asked:** Settings → General → VPN & Device Management → trust the
  developer. Allow **Local Network** when Linger asks; the development build needs it to reach
  Metro.

Done when the app opens on the phone.

Fallback if local signing gets stuck: `npx eas device:create` (open the link on the phone to
register it), then `npx eas build --profile development-device --platform ios`, and install from
the link EAS prints. It loads its addresses from Metro like the local build.

## 3. Test against the local backend

**Start the servers in two terminal tabs (Naib).** Background servers started from Claude's
session get stopped after a while, so run these yourself:

```
cd ~/Documents/code/linger && pnpm --filter api dev
cd ~/Documents/code/linger && pnpm --filter app start --clear
```

Docker must be running (`pnpm device:on` starts storage), with Docker Desktop's memory raised to
8 GB (F23). For the Terms and Privacy links, also run
`pnpm --filter site dev --host`.

**Fresh demo data (Claude):** `pnpm --filter api seed` (about 80 seconds). Accounts and event
codes are in `demo-accounts.md`.

**On the phone:** open Linger. The development launcher lists the Metro server at
`http://10.0.0.109:8173`; tap it. Then:

- "Continue as demo host" opens the power host's 17 events.
- Other demo accounts: open `linger://dev/guest` (or `new`, `half`, `out`) in Safari on the phone.
- A real sign-in: any new email, with the code from Mailpit at http://localhost:8176 on this Mac.
- Joining as a guest: scan an event's QR from Show code with a second phone, or open
  `linger://j/<code>`.

Run the checklist in section 6 and note results in the Local column.

## 4. Deploy the staging backend (Naib, with Claude)

Staging runs the production code and settings (`NODE_ENV=production`, no demo routes) on
Render's own `onrender.com` addresses, with its own Neon database and R2 bucket. It's defined in
`render.staging.yaml`, separate from production's `render.yaml`, and runs the API and the jobs in
one service. It costs about $7 a month for the API (Starter) plus Neon's compute while it runs;
suspend the service between test runs. The two static sites are free. Production's setup is in
`deployment.md`.

**Neon (Naib):** a project `lingercam-staging` in AWS US East 2 (Ohio) at 0.25 CU with scale to zero on, as
in `deployment.md` step 2. Copy the connection string with pooling off.

**Cloudflare R2 (Naib):**

- [ ] Cloudflare dashboard → R2 → Create bucket `linger-staging` (location: automatic).
- [ ] R2 → Manage API tokens → Create token with **Object Read & Write** on `linger-staging`.
      Keep the Access Key ID, Secret Access Key and the S3 endpoint
      (`https://<account id>.r2.cloudflarestorage.com`).
- [ ] Bucket → Settings → CORS policy, so the browser guest page can upload:
      ```json
      [{ "AllowedOrigins": ["https://linger-staging-join.onrender.com"],
         "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
      ```

**Email (Naib):** an SMTP provider for sign-in codes and reveal emails. Resend is the quickest:
create an account, an API key, and use `smtp://resend:<api key>@smtp.resend.com:587`, with
`onboarding@resend.dev` as the sender until the Linger domain is verified there. Until then it
only delivers to the email on the Resend account, which is enough for this run.

**Push (Naib, once):** `npx eas credentials` → iOS → production → Push Notifications → create a
key. Then expo.dev → Account settings → Access tokens → create one for the API.

**Render (Naib):**

- [ ] render.com → New → Blueprint → this repository → Blueprint file `render.staging.yaml` →
      name it `linger-staging`.
- [ ] Fill the secrets it asks for:
      - `DATABASE_URL`: Neon's direct connection string.
      - `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: from R2.
      - `SMTP_URL` and `MAIL_FROM`: from Resend.
      - `EXPO_ACCESS_TOKEN`: from expo.dev.
      - `REVIEW_EMAIL` and `REVIEW_CODE`: any email and six digits. This is the login for the
        QA run and later for App Review.
      - Leave RevenueCat and Stripe empty for now (S2, S3).
- [ ] Apply. When the services are live, check each address. If Render added a suffix (for
      example `linger-staging-api-x7k2.onrender.com`), tell Claude: the URLs go in
      `render.staging.yaml`, `scripts/staging.json` and the `staging` profile in
      `apps/app/eas.json`.

**Checks and data (Claude):**

- [ ] `https://linger-staging-api.onrender.com/health` answers `{"ok":true,...}`.
- [ ] In the Render dashboard → `linger-staging-api` → Shell: `pnpm --filter api review-seed`,
      which gives the review login a live event (RVW4PP), a revealed wedding and a draft.
- [ ] The join page loads at `https://linger-staging-join.onrender.com/RVW4PP`.

## 5. Test against staging

Two ways, best done in this order.

**A. The development build, pointed at staging.** Quick to switch, and code changes still reload.

```
pnpm device:staging
pnpm --filter app start --clear
```

Open the app from the launcher as before. There are no demo accounts on staging. Sign in with the
review login, or with a real email (the code arrives by email), and create events as a real host
would.

**B. The standalone staging build.** No Mac or Metro needed, and real HTTPS end to end, so it's
the closest to TestFlight.

```
cd apps/app
npx eas device:create                                  # once, if the phone isn't registered
npx eas build --profile staging --platform ios
```

Open the install link from the build page on the phone. It replaces the development build; to go
back, run step 2 again.

Run the checklist in section 6 and note results in the Staging column. Paid tiers can't be bought
on staging until RevenueCat and the App Store products exist (S2, S3), so test the free tier
there.

## 6. The QA checklist

Run it once per backend. Mark each line ✓, ✗ (with a note) or n/a.

| Area | Check | Local | Staging |
| --- | --- | --- | --- |
| Sign-in | New email: code arrives, name sheet appears | | |
| Sign-in | Review login with the fixed code | | |
| Create | Free event with a cover from the library; invite, Copy link, Share, Print | | |
| Create | Paid tier via Test purchase | | n/a |
| Manage | Move the end and the reveal, Only me, End now, delete | | |
| Moderation | Remove a guest (People and photo menu); hide a person; report reaches support | | |
| Camera | Viewfinder with the film look; flash Auto and On; 0.5x; switch camera | | |
| Camera | Front flash in a dark room goes to full brightness and back | | |
| Camera | Haptics and shutter sound; silent switch mutes it | | |
| Uploads | Airplane mode: photos wait, then send | | |
| Uploads | Lock the phone straight after a shot: the photo arrives | | |
| Uploads | Running out of shots; the last three on the counter | | |
| Reveal | Short event (ends in 5 min, reveal at the end): countdown, push, "It's all here.", gallery, recap | | |
| Reveal | Live Activity counts down on the Lock Screen | | |
| Photos | Save one, Save all, Share | | |
| Scale | Festival (3,012 photos) and live wedding (1,500) scroll smoothly | | n/a |
| Guests | Join from a second iPhone with the app | | |
| Guests | Join from Safari without the app (staging, or a tunnel locally) | | |
| Guests | Link opened inside Instagram or WhatsApp | | |
| Guests | Join an ended event within the hour; refused after it | | |
| Everyday | Largest text size; VoiceOver on the join sheet and camera; Reduce Motion | | |
| Everyday | Notifications denied, then turned on from the card | | |
| Everyday | Background, kill and reopen during an upload | | |
| Everyday | Weak or dropped network: tiles load again when it's back (F24) | | |

Safari as a guest needs HTTPS for the camera, which staging has. To try it against the local
backend, run `cloudflared tunnel --url http://localhost:8173` and open the `trycloudflare.com`
address it prints; the API then needs a second tunnel and `pnpm device:on` won't cover it, so
staging is simpler for this one.

## 7. Record the results (Claude)

- [ ] Copy the filled table into the change log of `launch-review.md` with the phone model and iOS
      version.
- [ ] Tick S5 there, and add every ✗ as a new F or B item.
- [ ] When local and staging both pass, stage 6 moves on to TestFlight (S6).

## Troubleshooting

- **The launcher doesn't list Metro:** the phone and Mac aren't on the same Wi-Fi, Local Network
  is off for Linger (Settings → Linger), or Metro isn't running. Enter
  `http://10.0.0.109:8173` by hand in the launcher.
- **The app loads but nothing appears:** the API isn't running, or the Wi-Fi address changed. Run
  `pnpm device:on` again and restart the API and Metro.
- **Photos stay grey:** storage was stopped (check `docker ps`); restart it with `pnpm device:on`.
  Grey tiles then need the app reopened until F24 is fixed.
- **Signing errors:** in Xcode open `apps/app/ios/LingerCam.xcworkspace`, select the LingerCam and
  LingerActivity targets → Signing & Capabilities → Team, then build again.

## Step history

- 2026-11-06: the local stack reachable from a phone. `pnpm device:on` writes `.env.device` and the
  app's addresses, and opens storage to the network with `docker-compose.device.yml`. Development
  builds allow plain HTTP to local addresses only (`NSAllowsLocalNetworking`). Checked over the
  Wi-Fi address: health, signed photos, covers, and the app on the simulator.
- 2026-11-07: staging's database moved to Neon, as in `deployment.md`.
- 2026-11-07: `pnpm device:staging`, `render.staging.yaml`, the `staging` EAS profile and
  `APPLE_TEAM_ID` in `app.config.ts` added for the staging half of the run.
