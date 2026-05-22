# CI/CD (GitHub Actions)

This repo uses **[GitHub Actions](https://docs.github.com/en/actions)** to run tests + coverage gates on **every push and every pull request**, and to trigger **automated deployments** when changes land on the default branch.

## Workflow file

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — install, migrate/seed DB (backend job), **`npm run test:coverage`** (backend + UI), integration tests against Postgres, optional **deploy** step.

Jobs run in parallel where possible; **deploy** waits for both **backend** and **ui** to succeed.

## CI: tests and 80% coverage

| Package   | Command                 | Enforcement |
|----------|-------------------------|-------------|
| Backend  | `npm run test:coverage` | Vitest **lines, statements, functions, and branches** must be **≥ 80%** (`backend/vitest.config.ts` `coverage.thresholds`). |
| UI       | `npm run test:coverage` | Vitest **lines, statements, functions, and branches** must be **≥ 80%** (`ui/vitest.config.ts` `coverage.thresholds`). |

If any threshold is not met, Vitest exits non‑zero and the workflow **fails**.

### Backend integration tests

The backend job starts **Postgres 16**, sets `DATABASE_URL`, runs `prisma migrate deploy`, seeds the DB, then runs:

- `npm run test:coverage`
- `RUN_DB_INTEGRATION=true npm run test:integration`

### Coverage artefacts

On pull requests and on pushes to `main` / `master`, HTML/LCOV coverage output is uploaded as workflow **artefacts** (`backend-coverage`, `ui-coverage`) for 14 days.

## CD: deployment (Render deploy hooks)

We use **[Render](https://render.com)** as the reference hosting model: one **Web Service** (Node API) and one **Static Site** (Vite build). Render can rebuild/redeploy when it receives an HTTP **POST** to a service-specific **Deploy Hook** URL.

### 1. Create services on Render (one-time)

1. **API (Web Service)**  
   - Root directory: `backend`  
   - Build: e.g. `npm ci && npx prisma generate && npm run build`  
   - Start: e.g. `npx prisma migrate deploy && node dist/index.js` (or your chosen start command)  
   - Set **environment variables** (see below) in the Render dashboard.

2. **UI (Static Site)**  
   - Root directory: `ui`  
   - Build: e.g. `npm ci && npm run build`  
   - Publish directory: `dist` (Vite default)  
   - Set **`VITE_API_URL`** to your **public API base URL** (e.g. `https://your-api.onrender.com`).

3. In each service, open **Settings → Deploy Hook**, create a hook, and copy the URL.

### 2. Configure GitHub repository secrets

In **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `RENDER_DEPLOY_HOOK_API` | POST URL that triggers redeploy of the **backend** Render service |
| `RENDER_DEPLOY_HOOK_UI` | POST URL that triggers redeploy of the **UI** Static Site |

If either secret is **missing**, the **deploy** job still runs but **skips** the HTTP POST steps and prints a **notice** in the Actions log. Add both secrets when you want real deploys after every successful push to **`main`** or **`master`**.

Deploy runs only on **`push`** to **`main`** or **`master`** (not on pull requests).

### Alternative platforms

The same CI job can drive other hosts by swapping the deploy step:

- **Railway / Fly.io / Google Cloud Run / AWS ECS**: use their CLI or API in a workflow step with a token stored as **`RAILWAY_TOKEN`**, **`FLY_API_TOKEN`**, etc., instead of curl to Render hooks.
- **Vercel (UI)** + API elsewhere: **`vercel pull && vercel build && vercel deploy --prod --token`** with **`VERCEL_ORG_ID`**, **`VERCEL_PROJECT_ID`**, **`VERCEL_TOKEN`**.

Keep tokens in **Secrets**, never commit them.

---

## Runtime environment variables (staging / production)

Mirrors **`backend/.env.example`**. Configure these on the **API host** (e.g. Render Web Service dashboard).

### Required for a working API

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string for production/staging |

### Recommended

| Variable | Purpose |
|----------|---------|
| `JWT_ACCESS_SECRET` | Signing key for access tokens |
| `JWT_REFRESH_SECRET` | Signing key for refresh tokens |
| `CORS_ORIGINS` | Allowed browser origins for the deployed UI |

### Optional (features degrade gracefully without them)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY`, `GROQ_API_KEY`, … | Live LLM / AI routes |
| `OMDB_API_KEY`, `TMDB_API_KEY` / `TMDB_READ_ACCESS_TOKEN` | External movie metadata |

---

## Frontend build (`ui`)

Static hosting needs the API URL **at build time** for `import.meta.env.VITE_*`:

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Base URL of the deployed API (e.g. `https://api.example.com`) |

Set this on **Render Static Site → Environment**, or in the CI build step env if you build in Actions and upload artefacts.

---

## Local parity with CI

Backend:

```bash
cd backend
npm ci
npx prisma generate
DATABASE_URL='postgresql://...' npx prisma migrate deploy
DATABASE_URL='postgresql://...' npm run db:seed
npm run test:coverage
RUN_DB_INTEGRATION=true DATABASE_URL='postgresql://...' npm run test:integration
```

UI:

```bash
cd ui
npm ci
npm run build
npm run test:coverage
```
