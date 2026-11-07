# Demo accounts

Linger has two kinds of test account. Demo accounts exist only in development builds against the
local API, and the seed resets them. The App Review account is set by environment and works in
production. Real email sign-ins use the same code paths as production, with the local Mailpit
standing in for email.

## Switching on the simulator

`linger://dev/<account>` signs the app out, clears what the device has cached, and opens Home as
that account. `?shots=1` hides the controls only development builds have (the demo button, the
"Test purchase" caption, "Using sample photos") for screenshots, and `?shots=0` brings them back.
Both links do nothing in a release build.

```
xcrun simctl openurl C810B885-A2A2-43E9-A7CB-55C06C339262 "linger://dev/power?shots=0"
```

Reset everything with `pnpm --filter api seed` (about 80 seconds, most of it the two large
events). The seed needs the local services running: `docker compose up -d`, the API on 8171 and
Metro on 8173.

## The accounts

| Link | Who | Sign-in email | State |
| --- | --- | --- | --- |
| `linger://dev/out` | Signed out | None | Nothing joined. Every join sheet state. |
| `linger://dev/guest` | A guest, no account | None | Places at 11 of the power host's events. |
| `linger://dev/new` | Sam Rivera | `new@lingercam.app` | A host with no events. |
| `linger://dev/half` | Jordan Lee | `half@lingercam.app` | One event with no guests yet, one draft. |
| `linger://dev/power` | Alex Morgan | `demo@lingercam.app` | 17 events in every state, including two large ones. |

"Continue as demo host" on Welcome signs in as the power host, as the Maestro flows expect.

### Power host's events

Open any of them with `linger://e/<code>`, or as someone new with `linger://j/<code>`.

| Code | Event | State it shows |
| --- | --- | --- |
| EMMADN | Emma & Daniel's Wedding day | Revealed, 24 photos with likes, 8 of 150 guests |
| MAYA3X | Maya turns thirty | Live, camera open, photos developing |
| JNHSWM | Jun's housewarming | Ended two hours ago, waiting for the reveal; closed to new guests |
| KRK2NT | Karaoke night | Ended 20 minutes ago; someone new can still join for the hour |
| SATWED | Sam & Ria's wedding | Live but opens in three days |
| GAMENT | Game night | Free, 9 of 10 guests, Make room |
| SPPR6C | Supper club | Free and full, 10 of 10, while the camera is open |
| BRNCH5 | Sunday brunch | Right away: photos show while shooting |
| TRVA7M | Market morning | Right away, after it ended ("That's the night") |
| FFCE7D | Friday office drinks | Closes 9 minutes after the seed runs |
| RTRT5W | Team retreat | Unlimited shots, Only me, a reveal at a picked time |
| DRNKS4 | Ines's leaving drinks | The guest has used all 10 shots |
| BKCB27 | Book club | Revealed, one reported photo and one hidden by three reports |
| FSTV28 | Street festival | Revealed, 250 of 250 guests, 3,012 photos |
| PRYA5M | Priya & Sam's wedding | Live, 150 of 150 guests, 1,500 photos developing |
| PCNC3S | Summer picnic | Archived, in the Past group |
| TFNWKD | Tofino, the long weekend | Draft, resumes at step 5 |

The guest has places at EMMADN, MAYA3X, JNHSWM, SATWED, BRNCH5, BKCB27, FSTV28, DRNKS4, FFCE7D,
RTRT5W and TRVA7M, with photos of their own at most of them.

### Half set-up host's events

| Code | Event | State it shows |
| --- | --- | --- |
| DNNR7T | Dinner at ours | Live, opens tomorrow, no guests yet |
| BABY2Y | Leo turns one | Draft without a cover |

## What the demo data is and isn't

- The power host's guests are database rows, not real devices; only the guest account takes over
  some of their places.
- Photos are 34 sample images, each in four versions (as is, mirrored, cropped, both), so large
  galleries repeat. Crowd names are generated.
- The large events are seeded: each distinct image is developed through the real develop step,
  and the rest are copies made inside storage.
- Purchases go through the development claim, not the App Store.

## Real sign-ins

- **A new host by email:** sign in with any new address. The code arrives in Mailpit at
  http://localhost:8176. A brand-new account is asked for the name guests see.
  `apps/app/flows/screens/signin.yaml` does this automatically.
- **A new guest:** open `linger://j/<code>` on the simulator, or
  `http://localhost:8173/j/<code>` in a browser.

## App Review account

For App Store review and production checks. Set `REVIEW_EMAIL` and a six-digit `REVIEW_CODE` on
the API; signing in with that email then takes the code and sends no email. The server won't
start with an email and no valid code. `pnpm --filter api review-seed` gives it:

| Code | Event | State |
| --- | --- | --- |
| RVW4PP | App Review party | Live for 30 days, photos show right away |
| RVW8TF | Emma & Daniel's wedding | Revealed, 8 photos |
| RVW2DR | Maya turns thirty | Draft |

Running it again resets those events. The email and code go in the App Store review notes (S7 in
`launch-review.md`).

## Screens of every state

`.scratchpad/screens/index.html` shows each screen in each of these states, captured from the
simulator. `.scratchpad/screens/README.md` explains how to capture them again.
