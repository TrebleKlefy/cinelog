# cineLog monorepo

Git repository: [github.com/TrebleKlefy/cinelog](https://github.com/TrebleKlefy/cinelog)

This repository is now split into two separate folders:

- `backend/` — Node.js + Express + Prisma API
- `ui/` — React + Vite frontend

## Quick start

1. Backend install:
   - `cd /Users/akeemshaw/Documents/moseView/backend`
   - `npm install`
   - `cp .env.example .env`
2. UI install:
   - `cd /Users/akeemshaw/Documents/moseView/ui`
   - `npm install`

## Run backend

From `backend/`:

- `npm run db:generate`
- `npm run build`
- `npm run dev`

The API runs on `http://localhost:4000`.

## Run UI

From `ui/`:

- `npm run dev`

The UI runs on `http://localhost:5173` and talks to `http://localhost:4000` by default.

Set `VITE_API_URL` in `ui/.env` if needed.

## Tests

We use **[Vitest](https://vitest.dev/)**: it matches **Vite** on the UI, supports **native ESM** (same posture as `"type": "module"` / `NodeNext` on the backend), and lines up closely with **Jest**‑style APIs (`describe` / `expect` / `vi`).

Backend (from `backend/`):

```bash
npm test
npm run test:coverage

# Postgres integration (requires DATABASE_URL + migrated DB):
RUN_DB_INTEGRATION=true DATABASE_URL='postgresql://...' npm run test:integration
```

UI (from `ui/`):

```bash
npm test
npm run test:coverage
```

**Coverage**: `npm run test:coverage` enforces **≥80%** for **lines, statements, functions, and branches** when measured:

- Backend: thresholds in [`backend/vitest.config.ts`](backend/vitest.config.ts).
- UI: thresholds in [`ui/vitest.config.ts`](ui/vitest.config.ts) (coverage is scoped to explicit `coverage.include` files; widen that list as you add tests).

Reports: `backend/coverage/` and `ui/coverage/` (also uploaded as Actions artefacts from PRs / `main`).

## CI/CD

On **every push and pull request**, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the backend job (Postgres service, **`prisma migrate deploy`**, seed), **`npm run test:coverage`** for backend and UI, then **`RUN_DB_INTEGRATION=true`** integration tests.

On **`push`** to **`main`** or **`master`** only (after CI passes), a **deploy** job POSTs **[Render Deploy Hook](https://render.com/docs/deploy-hooks)** URLs from repository secrets **`RENDER_DEPLOY_HOOK_API`** and **`RENDER_DEPLOY_HOOK_UI`**. Without those secrets, deploy is skipped with a notice in the log.

Full pipeline setup, alternatives (Railway/Fly/Vercel), runtime env vars for production UI/API: **`docs/CI_CD.md`**.

## Seeded demo users

After DB migration + seed:

- Admin: `admin@demo.com` / `Admin123!`
- User: `user@demo.com` / `User123!`

## Current status

- Backend scaffolded with routes for auth, movies, collections, ratings, reviews, audit, AI, and admin.
- UI scaffolded with login/dashboard/search/collection/audit/admin pages.
- Build validation completed for backend and UI.
