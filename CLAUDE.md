# Working on Linger

Read `.docs/architecture.md` and `.docs/plan.md` before changing anything. They hold the folder
map, the rules, the contracts between core, API and app, the versions, the ports and the brand.

- Simplicity first: one file per concept, no `utils`, `helpers`, `types` or `components` folders,
  no barrel files, routes only pick a screen from `src/`.
- `packages/core` is plain TypeScript and imports nothing from the repo. Apps never import each
  other.
- Tests sit beside the code they test. Run `pnpm check` before calling something done.
- Style: 4 spaces, double quotes, semicolons, width 100, no `any`, no `console` in app code, no
  `void` on floating promises, comments only for a non-obvious reason, no phase numbers in code.
- Local ports are 8170 to 8179 only. `docker compose up -d` starts Postgres, storage and Mailpit.
- User-facing copy is plain, warm and precise, with no em dashes.
- Text over a photo always sits on a `Scrim` (or inside `Cover`), never straight on the image, and
  sentences wrap to a second line rather than cut off with an ellipsis. Check new screens with the
  capture in `.scratchpad/screens/`.
- Decisions that change the plan get a dated line under "Results" in `.docs/plan.md`.
- Demo and review accounts, their event codes and how to switch between them are in
  `.docs/demo-accounts.md`; keep it in step with `apps/api/src/seed.ts` and `review.ts`.
- `.docs/launch-review.md` is the list Linger works from until it's live in the store. Read it
  before starting work; when an item is done, found or decided, update it in the same change
  (tick and date it, add new items with the next id, refresh the stage table and the change log).
