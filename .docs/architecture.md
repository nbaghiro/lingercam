# Linger architecture

Linger is a shared event camera. A host creates an event, guests join from a QR code and shoot a
limited number of photos, and nothing is visible until the reveal, when everyone receives the whole
event at once. The approved visual design is the scratchpad at
`../smallwares/.scratchpad/linger/index.html`. Apps ship under GalleoApp, Inc.

## Rules

Simplicity comes first, including in how files and folders are split.

1. One file per concept. A file is split only when it holds two concepts, never because it is long.
2. One shared package, `packages/core`: plain TypeScript with no React, React Native or server code.
3. Routes are a few lines and only pick a screen from `src/`.
4. No barrel `index.ts` files and no `utils`, `helpers`, `types` or `components` folders. Code lives
   with the concept it belongs to.
5. Tests sit beside the code they test (`shots.ts` and `shots.test.ts`) in `core` and `api`.
6. Config lives at the root unless a tool requires it inside an app.
7. Apps never import each other. `core` imports nothing from the repo. ESLint enforces both.
8. Files are created when their phase needs them, not ahead of time.
9. Style: 4-space indent, double quotes, semicolons, width 100, no `any`, no `console` in app code,
   no `void` on floating promises (call bare and catch at the source), comments only for a
   non-obvious reason, no phase numbers in code.

## Repo

```
linger/
├── .docs/
│   ├── architecture.md          this file
│   └── plan.md                  phases, contracts and acceptance checks
├── .github/workflows/ci.yml     format, lint, typecheck, test on every push
│
├── apps/
│   ├── api/                     Hono on Node, Postgres via Drizzle, pg-boss jobs, R2 media
│   │   ├── src/
│   │   │   ├── server.ts        Hono app, middleware, mounts each concept's routes, starts workers
│   │   │   ├── db.ts            Drizzle schema for every table, client, pg-boss queue
│   │   │   ├── storage.ts       S3 client (R2 in production, RustFS locally), keys, signed URLs
│   │   │   ├── accounts.ts      host sign-in, sessions, account deletion
│   │   │   ├── events.ts        create, settings, go live, end early, join by code, guests
│   │   │   ├── shots.ts         reserve, signed upload, confirm, develop job, gallery, report, hide
│   │   │   ├── reveal.ts        schedule and run the reveal
│   │   │   ├── notify.ts        push tokens, push and receipts, reveal and restore email
│   │   │   ├── billing.ts       RevenueCat claim and webhook, Stripe Checkout and webhook
│   │   │   ├── seed.ts          demo host and events for local QA
│   │   │   └── *.test.ts        beside each concept
│   │   ├── drizzle/             generated migrations
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── app/                     one Expo app: iOS, Android and the guest web app
│   │   ├── app/                 routes, a few lines each
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx        my events
│   │   │   ├── new.tsx          create an event
│   │   │   ├── settings.tsx
│   │   │   ├── [code].tsx       a bare join code, sent on to j/<CODE>
│   │   │   ├── +not-found.tsx
│   │   │   ├── j/[code].tsx     join: QR code, the app or the browser
│   │   │   └── e/[code]/
│   │   │       ├── index.tsx    the event
│   │   │       ├── camera.tsx
│   │   │       ├── recap.tsx
│   │   │       └── [photo].tsx
│   │   ├── src/
│   │   │   ├── home.tsx         my events, sign-in, settings, account deletion
│   │   │   ├── create.tsx       occasion, name, rules, look, guests and price
│   │   │   ├── join.tsx         join sheet, name, camera permission
│   │   │   ├── shutter.tsx      the camera frame both platforms share: states, counter, flash
│   │   │   ├── camera.tsx       native camera: VisionCamera with the live film look
│   │   │   ├── camera.web.tsx   browser camera
│   │   │   ├── look.tsx         the film look for still photos (.web.tsx in the browser)
│   │   │   ├── activity.ts      the Live Activity for the shooting window
│   │   │   ├── demo.ts          sample photos for a device without a camera, in development
│   │   │   ├── event.tsx        cover, stats, actions, developing grid, gallery
│   │   │   ├── gallery.ts       gallery store shared by the event, viewer and recap
│   │   │   ├── moment.tsx       the reveal moment
│   │   │   ├── people.tsx       people sheet and rolls
│   │   │   ├── invite.tsx       invite card, invite sheet, table cards, share link
│   │   │   ├── manage.tsx       the host row and the Manage sheet
│   │   │   ├── joined.tsx       events this device joined, code entry
│   │   │   ├── notify.tsx       permission card, reminders, push token, notification taps
│   │   │   ├── photo.tsx        viewer: photographer, save, like, report
│   │   │   ├── save.ts          saving to Photos, one or every photo (.web.ts in the browser)
│   │   │   ├── recap.tsx        the recap: the event's best photos as a story
│   │   │   ├── purchase.ts      RevenueCat on iOS and Android
│   │   │   ├── purchase.web.ts  Stripe Checkout on the web
│   │   │   ├── uploads.ts       upload queue that survives bad signal and restarts
│   │   │   ├── shrink.ts        makes a queued photo smaller after a too-large refusal (.web.ts on the web)
│   │   │   ├── missing.tsx      the page for a link that doesn't exist
│   │   │   ├── api.ts           typed client from core schemas, session, guest device token
│   │   │   ├── ui.tsx           tokens, Text, Button, Segmented, Sheet, Tile, icons
│   │   │   └── copy.ts          every user-facing string, in ICU format
│   │   ├── modules/             the Live Activity native module
│   │   ├── targets/             the Live Activity widget
│   │   ├── flows/               Maestro flows for the iOS simulator
│   │   ├── *.e2e.ts             Playwright tests against the web build
│   │   ├── public/              index.html template, touch icon, .well-known for join.<domain>
│   │   ├── assets/              icon, adaptive icon, splash, fonts, demo photos
│   │   ├── app.config.ts
│   │   ├── eas.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── site/                    Astro, static
│       ├── src/
│       │   ├── layout.astro     head, nav, footer, fonts, favicon
│       │   ├── phone.astro      device frame and screen mockups
│       │   └── pages/
│       │       ├── index.astro
│       │       ├── pricing.astro       reads core/pricing.ts
│       │       ├── delete-account.astro
│       │       ├── privacy.md
│       │       ├── terms.md
│       │       └── support.md
│       ├── public/              photos, social image, favicon, mark
│       ├── astro.config.ts
│       └── package.json
│
├── packages/
│   └── core/                    rules every app agrees on
│       ├── src/
│       │   ├── events.ts        event and guest types, lifecycle, settings rules, request schemas
│       │   ├── shots.ts         shot type, what is visible in each event state, gallery schema
│       │   ├── reveal.ts        reveal modes and time math
│       │   ├── pricing.ts       tiers, add-ons, store product ids
│       │   ├── film.ts          looks: parameters and the Skia shader source
│       │   └── *.test.ts
│       └── package.json
│
├── brand/                       the mark as SVG, the source for every icon and favicon
├── .env.example
├── .gitignore
├── CLAUDE.md
├── README.md
├── docker-compose.yml           Postgres, RustFS, Mailpit
├── eslint.config.js
├── package.json
├── pnpm-workspace.yaml
├── prettier.config.json
├── render.yaml                API and worker on Render, Postgres on Neon (.docs/deployment.md)
└── tsconfig.base.json
```

## Domain

```
Host ──creates──▶ Event ◀──joins── Guest ──takes──▶ Shot
                    │                                  │
                    ├── Purchase                       ├── original (private)
                    └── reveal job                     ├── developed and thumb
                                                       └── Report
```

Event lifecycle, owned by `core/events.ts`:

```
draft ──free tier or paid──▶ live ──ends──▶ ended ──reveal time──▶ revealed ──90 days──▶ archived
```

An event can go straight from `live` to `revealed` when the reveal mode is "right away" (each photo
shows as soon as it is developed) or when the end and reveal times are the same.

The server keeps the secret. Before the reveal the API never returns a photo, a thumbnail or a
signed URL to anyone, the host included. The client's "Developing" tiles are drawn from counts.

## Local development

| Port | Service |
| --- | --- |
| 8170 | site (Astro dev) |
| 8171 | api |
| 8172 | Postgres |
| 8173 | Expo dev server (native and web) |
| 8174 | RustFS S3 API |
| 8175 | RustFS console |
| 8176 | Mailpit web |
| 8177 | Mailpit SMTP |
| 8178 | Drizzle Studio |
| 8179 | spare |

Services without keys locally use stand-ins, all switched by environment variables:

- Photos go to RustFS (an S3-compatible stand-in) instead of R2 through the same S3 client.
- Sign-in emails go to Mailpit. A "Continue as demo host" button appears only in development.
- Purchases complete through a development claim endpoint when no RevenueCat or Stripe keys are set.
- Push notifications go through Expo's push service when `EXPO_ACCESS_TOKEN` is set. The app also
  schedules a local notification for the reveal time, which works without any keys.
- The iOS simulator has no camera, so in development the camera falls back to the bundled demo
  photos, still passed through the film look.
