# App Store privacy labels

The answers for App Store Connect → App Privacy, written from what the code collects on
2026-11-08. Each one names where the data comes from, so it can be checked again before
submission and whenever a feature or an SDK changes. Google Play's Data safety form asks for the
same facts in a different shape; the last section maps them.

Apple counts data as collected when it leaves the device and is kept longer than it takes to
answer the request. Everything below is used only to run the app, so every purpose is App
Functionality, except where noted.

## Tracking

**Do you or your third-party partners use data for tracking?** No.

LingerCam has no advertising SDK, doesn't read the advertising identifier, and doesn't share data
with data brokers. RevenueCat, Expo, Sentry and the email provider process data on our behalf
only.

## Data types collected

| Apple's type | What it is in LingerCam | Linked to the user | Purposes | Source in the code |
| --- | --- | --- | --- | --- |
| Contact Info: Name | The host's name, and the name a guest joins under | Yes | App Functionality | `hosts.name`, `guests.name` |
| Contact Info: Email Address | The host's sign-in email. A browser guest can also leave one for the reveal email | Yes | App Functionality | `hosts.email`, `guests.email` |
| User Content: Photos or Videos | Guests' photos (the developed copy and a thumbnail) and the host's cover photo | Yes | App Functionality | `shots`, `storage.ts` keys |
| User Content: Other User Content | Event details (title, occasion, times, settings), likes and reports | Yes | App Functionality | `events.settings`, `likes`, `reports` |
| Identifiers: User ID | The host's account id, also used as RevenueCat's app user id | Yes | App Functionality | `hosts.id`, `purchase.ts` |
| Identifiers: Device ID | The random id the app creates on first launch (`X-Device`), and Expo push tokens | Yes | App Functionality | `guests.device`, `push_tokens` |
| Purchases: Purchase History | Which event was paid for, the product, the store and the transaction id | Yes | App Functionality | `purchases`, RevenueCat |
| Diagnostics: Crash Data | Crash reports, once Sentry has a DSN | No | App Functionality | `apps/app/src/monitoring.ts` |
| Diagnostics: Other Diagnostic Data | Error reports with the device model and OS version, once Sentry has a DSN | No | App Functionality | `apps/app/src/monitoring.ts` |

Not collected: location, contacts, health, financial info (card numbers stay with Apple, Google
and Stripe), sensitive info, browsing or search history, usage data or analytics, audio, and
performance data (Sentry's tracing is off, `tracesSampleRate: 0`).

The diagnostics rows apply only once `EXPO_PUBLIC_SENTRY_DSN` is set for the build. If the first
submission ships without it, leave them out and add them with the build that turns Sentry on.

## Points to check before submitting

- **Location inside photos.** The app never asks for location, and the in-app camera doesn't add
  GPS to the photos it takes. A host's cover photo is picked from the library and uploaded as it
  is, so it can carry the location the phone's camera recorded, and it's served as the event's
  link preview (F6). Stripping metadata from covers on the device removes the question; until
  then, Apple's Photos type covers the file, but the privacy policy should say covers keep their
  metadata. Check one cover from the library on a real iPhone (S5).
- **Originals.** A guest's original upload is deleted once it's developed, usually within
  seconds and at most six hours later if developing keeps failing (F1). That's long enough to
  count as collected, and it's covered by the Photos row.
- **Guest emails** come from the guest web app, not the iOS app, but Apple asks about the app's
  whole service, so the row stays.
- **IP addresses** are held in memory for rate limits and not stored or logged. Neither Sentry
  SDK sends them (`sendDefaultPii` is off in the app, and the API sets no user).

## Age rating

The questionnaire sets the rating. The answers that matter:

- **User-generated content:** yes. Guests share photos with the people at one event. There's no
  public feed, no messaging and no profile search.
- **Moderation:** anyone at an event can report a photo, three reports hide it, the host can hide
  any photo and remove a guest, and every report emails support@lingercam.app (B3).
- **Unrestricted web access:** no. The app opens only LingerCam's own pages and the store.
- Everything else (violence, mature themes, gambling, medical, contests) is none.

## Google Play Data safety

| Play's category | Data | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info | Name, email address | Yes | No | Email is optional for guests | App functionality, account management |
| Photos and videos | Photos | Yes | No | No | App functionality |
| App activity | Other user-generated content (event details, likes, reports) | Yes | No | No | App functionality |
| Financial info | Purchase history | Yes | No | Yes | App functionality |
| Device or other IDs | App-created device id, push token | Yes | No | No | App functionality |
| App info and performance | Crash logs, diagnostics (once Sentry is on) | Yes | No | No | App functionality |

Data is encrypted in transit (HTTPS everywhere, including R2's signed URLs), and people can ask
for deletion: hosts in Settings or at lingercam.app/delete-account, guests by email.
