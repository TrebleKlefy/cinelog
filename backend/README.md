# Backend API

Node.js + Express + Prisma backend for cineLog.

## Main routes

- `/api/auth/*`
- `/api/movies/*`
- `/api/collections/:slug`
- `/api/me/*`
- `/api/ai/*`
- `/api/admin/*`

## Scripts

- `npm run dev`
- `npm run build`
- `npm test` — unit + route tests (`vitest.config.ts`; excludes `src/integration/**/*.test.ts`)
- `npm run test:coverage` — same as above with V8 coverage; **lines, statements, functions, and branches** must meet **80%** thresholds (`vitest.config.ts`)
- `npm run test:integration` — Postgres-backed probes (`vitest.integration.config.ts`). Skipped locally unless **`RUN_DB_INTEGRATION=true`** and **`DATABASE_URL`** point at a migrated database.
- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:seed`
