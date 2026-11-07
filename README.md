# LingerCam

LingerCam is a shared camera for events. A host creates an event, guests join by scanning a QR code
and each takes a set number of photos. Nothing is visible until the reveal, when everyone receives
every photo from the event at once, each signed by the guest who took it.

The repo holds the API (`apps/api`), one Expo app for iOS, Android and the guest web app
(`apps/app`), the marketing site (`apps/site`) and the rules they share (`packages/core`). How it
fits together is in [`.docs/architecture.md`](.docs/architecture.md), and the build plan with its
contracts is in [`.docs/plan.md`](.docs/plan.md).

## Running it locally

You need Node 26, pnpm 10 and Docker. The iOS app also needs Xcode and an iOS simulator, and the
native flows need [Maestro](https://maestro.mobile.dev).

```sh
pnpm install
cp .env.example .env          # every value works with docker compose as it is
docker compose up -d          # Postgres, S3 storage (RustFS) and Mailpit
pnpm --filter api db:migrate  # the API also migrates on boot
pnpm --filter api seed        # the demo host and four events; safe to re-run
```

Then start what you need, each in its own terminal:

```sh
pnpm --filter api dev         # API on 8171, with the demo sign-in and dev purchases
pnpm --filter site dev        # marketing site on 8170
pnpm --filter app web         # guest web app on 8173
pnpm --filter app start       # Metro on 8173 for the iOS dev build (instead of web)
```

The web app and Metro share port 8173, so run one or the other. Metro serves the web build too:
press `w` in its terminal.

To build and install the iOS dev client on the simulator (only needed after native changes):

```sh
cd apps/app
npx expo run:ios --device <simulator udid> --port 8173
```

Once it's installed, `pnpm --filter app start` and opening LingerCam on the simulator is enough.

### Checks

```sh
pnpm check                    # format, lint, typecheck, core and API tests
pnpm --filter api test        # API integration tests on linger_test and the linger-test bucket
pnpm test:e2e                 # a whole event in Chromium; starts the API and web app if needed
pnpm --filter app flows       # Maestro on the iOS simulator; needs the API, Metro and the dev build
```

The API tests and the e2e run need the Docker services. The e2e run signs in a fresh host through
Mailpit and deletes it at the end, so it leaves the demo data alone.

### Demo data and QA

The seed creates the demo host Alex Morgan (`demo@lingercam.app`). In the app, tap "Continue as
demo host" on the welcome screen. That button and the development purchase claim only exist when
the API runs with `DEV_ROUTES=1`, which `pnpm --filter api dev` and `.env` both set.

| Code     | Event                       | State                                         |
| -------- | --------------------------- | --------------------------------------------- |
| `EMMADN` | Emma & Daniel's Wedding day | Revealed: 24 photos from 8 guests, with likes |
| `MAYA3X` | Maya turns thirty           | Live, 8 photos developing, reveals at the end |
| `JNHSWM` | Jun's housewarming          | Ended, reveals the next morning at 10:00      |
| `TFNWKD` | Tofino, the long weekend    | Draft                                         |

MAYA3X ends 4 hours after the seed runs, so re-run the seed before a QA session to reset the
states and remove test guests.

Deep links for QA:

- iOS app: `linger://j/<code>` joins as a guest, `linger://e/<code>` opens the event. On the
  simulator: `xcrun simctl openurl <udid> linger://e/EMMADN`.
- Web: `http://localhost:8173/j/<code>` joins, `http://localhost:8173/e/<code>` opens the event,
  and `http://localhost:8173/<code>` redirects to the join page, as the production QR links do.

Sign-in codes for email sign-in go to Mailpit at http://localhost:8176.

### Local stand-ins

Nothing needs a key locally. These parts behave differently from production:

- Photos are stored in RustFS, an S3-compatible server on 8174, in place of Cloudflare R2. MinIO
  no longer publishes Docker images, so RustFS took its place.
- Sign-in emails go to Mailpit and are never delivered.
- Purchases complete through `POST /v1/billing/dev-claim` when no RevenueCat or Stripe key is set.
- Reveal pushes are skipped unless `EXPO_ACCESS_TOKEN` is set; the app schedules a local
  notification for the reveal.
- Signed photo URLs point at `localhost:8174`, which the iOS simulator and the browser can reach.
  An Android emulator or a physical device can't.
- The Live Activity works on the simulator, but the API doesn't send Live Activity pushes, so it
  updates only while the app is used and goes stale at the reveal.

## Ports

Every port sits in the 8170 block so LingerCam can run beside the other projects on this machine.

| Port | Service                                                           |
| ---- | ----------------------------------------------------------------- |
| 8170 | Site (Astro dev)                                                  |
| 8171 | API                                                               |
| 8172 | Postgres (`linger`, and `linger_test` for tests)                  |
| 8173 | Expo dev server (native and web)                                  |
| 8174 | S3 API (buckets `linger` and `linger-test`)                       |
| 8175 | S3 console, at `/rustfs/console/` (user `linger`, `linger-local`) |
| 8176 | Mailpit web                                                       |
| 8177 | Mailpit SMTP                                                      |
| 8178 | Drizzle Studio                                                    |
| 8179 | Spare                                                             |

## Brand

`brand/mark.svg` is the source for the app icon, splash, favicons and social image. The palette and
type are listed in the plan.

LingerCam is made by GalleoApp, Inc.
