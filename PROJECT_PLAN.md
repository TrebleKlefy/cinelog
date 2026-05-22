## Movie Tracker (Senior Consultant Assessment) — Project Plan

### Idea (What we are building)
A **movie tracking web application** for an enthusiast to maintain a personal collection of films they have watched.

The app supports:
- Searching movies by **cast**, **director**, and **genre**
- Displaying and tracking **third‑party ratings** (IMDb, Rotten Tomatoes)
- Submitting a **personal rating once per movie**
- Maintaining a **shareable personal collection**
- Integrating **AI** for:
  - Personalized movie recommendations based on viewing history and ratings
  - Natural-language movie search (e.g., “a 90s sci‑fi with time travel”)
- A persistent **audit log** of all significant actions
- A role-based **admin panel** for platform oversight and AI provider configuration

This plan is designed to meet all “Must Haves” in the assessment using:
- **Node.js** for the backend API
- **React** for the frontend

---

### Success criteria (Definition of done)
- **Functional**: All required features work end-to-end on a live deployed URL.
- **Polished UI**: High-fidelity design, consistent system, fully responsive (mobile/tablet/desktop).
- **Secure & correct**: Request validation, safe error handling, authentication, and data integrity constraints.
- **Auditable**: Audit log is persisted, read-only to end users, and covers all specified actions.
- **Tested**: \(\ge 80\%\) coverage enforced by CI; tests include DB/audit/AI mocks and endpoint validation.
- **Automated delivery**: CI/CD runs on every push/PR and performs automated deployments (no manual deploys).
- **Documented**: Setup, env vars, testing, AI prompting/cost notes, and CI/CD workflow are written down.
- **Operable**: Admin can view user activity/reviews and switch active LLM provider safely.

---

### Tech stack
### Backend (API)
- **Node.js + TypeScript**
- **Framework**: Express (simple + common) or Fastify (faster, built-in schema hooks). This plan assumes **Express**.
- **DB ORM / migrations**: **Prisma** (migrations + type-safe queries)
- **Validation**: **Zod** (request body/query validation)
- **Auth**: JWT access tokens + refresh tokens (or session cookies). Plan uses **JWT + refresh**.
- **Testing**: Jest or Vitest + Supertest

### Frontend (Web)
- **React + TypeScript**
- **Build tool**: Vite
- **Styling**: TailwindCSS
- **UI components**: shadcn/ui (Tailwind-based) or MUI. Plan assumes **shadcn/ui**.
- **State/data**: TanStack Query (React Query) for server state
- **Forms**: React Hook Form + Zod
- **Testing**: Vitest + React Testing Library

### Database
- **PostgreSQL** (hosted via Railway/Render/etc.)

### AI provider (LLM)
- Primary path: **OpenAI** or **Anthropic** hosted APIs (production-ready, stable).
- Bonus path: hosted open-source via **Groq / Together / Hugging Face Inference**.

---

### Repository structure (current and target)
Top-level separation requested:

- `backend/` — Node.js API/backend code
- `ui/` — React frontend code

Optional later expansion:
- `packages/shared/` — shared types/schemas (DTOs, Zod schemas, constants)
- `docs/` — additional documentation

---

### Domain model & database schema (normalized)
The database must be normalized, enforce constraints, and support migrations.

#### Core entities
- **User**: authenticates and owns collections/ratings/audit logs.
- **Movie**: canonical movie record in our DB.
- **Person**: people (actors, directors).
- **Genre**: list of genres.
- **External Rating**: per movie, by source (IMDb, Rotten Tomatoes).
- **Collection**: user’s watched list (shareable).
- **Personal Rating**: user’s rating for a movie (one per movie per user).
- **Audit Log**: immutable append-only record of actions.
- **Admin Settings**: selected LLM provider/model and admin configuration state.

#### Proposed tables (logical)
- `users`
  - `id (uuid pk)`
  - `email (unique)`
  - `password_hash`
  - `display_name`
  - `role` (enum: `USER`, `ADMIN`)
  - `created_at`

- `movies`
  - `id (uuid pk)`
  - `title`
  - `release_year`
  - `runtime_minutes` (nullable)
  - `synopsis` (nullable)
  - `poster_url` (nullable)
  - `created_at`

- `people`
  - `id (uuid pk)`
  - `name`

- `genres`
  - `id (uuid pk)`
  - `name (unique)`

- `movie_cast`
  - `movie_id (fk -> movies)`
  - `person_id (fk -> people)`
  - `character_name` (nullable)
  - **PK/unique**: (`movie_id`, `person_id`, `character_name`) or a surrogate PK

- `movie_directors`
  - `movie_id (fk -> movies)`
  - `person_id (fk -> people)`
  - **PK/unique**: (`movie_id`, `person_id`)

- `movie_genres`
  - `movie_id (fk -> movies)`
  - `genre_id (fk -> genres)`
  - **PK/unique**: (`movie_id`, `genre_id`)

- `movie_external_ratings`
  - `id (uuid pk)`
  - `movie_id (fk -> movies)`
  - `source` (enum: `IMDB`, `ROTTEN_TOMATOES`)
  - `rating_value` (numeric or text depending on representation)
  - `rating_scale` (e.g., 10, 100)
  - `rating_raw` (optional raw string like “93%”)
  - `updated_at`
  - **Unique**: (`movie_id`, `source`)

- `user_collections`
  - `id (uuid pk)`
  - `user_id (fk -> users)`
  - `slug (unique)` — used for shareable URLs
  - `title` (e.g. “Akeem’s Watched Movies”)
  - `is_public` (boolean)
  - `created_at`

- `collection_movies`
  - `collection_id (fk -> user_collections)`
  - `movie_id (fk -> movies)`
  - `added_at`
  - `notes` (nullable)
  - **Unique**: (`collection_id`, `movie_id`)

- `user_movie_ratings`
  - `user_id (fk -> users)`
  - `movie_id (fk -> movies)`
  - `rating` (e.g., integer 1–10)
  - `created_at`
  - **Unique**: (`user_id`, `movie_id`)  ✅ enforces “once per movie”

- `audit_logs`
  - `id (uuid pk)`
  - `user_id (fk -> users)`
  - `action_type` (enum, see below)
  - `resource_type` (e.g., `movie`, `collection`, `auth`, `ai`)
  - `resource_id` (uuid nullable)
  - `resource_label` (string nullable, e.g., movie title for search queries)
  - `metadata` (jsonb) — store query string, AI prompt id, etc.
  - `created_at_utc` (timestamp with time zone, default now())

- `reviews`
  - `id (uuid pk)`
  - `user_id (fk -> users)`
  - `movie_id (fk -> movies)`
  - `title` (nullable)
  - `body`
  - `created_at`
  - `updated_at`

- `llm_providers`
  - `id (uuid pk)`
  - `provider_key` (unique; e.g., `openai`, `anthropic`, `groq`, `together`)
  - `display_name`
  - `is_enabled` (boolean)
  - `created_at`

- `llm_models`
  - `id (uuid pk)`
  - `provider_id (fk -> llm_providers)`
  - `model_key` (e.g., `gpt-4.1-mini`, `claude-3-5-sonnet`)
  - `is_enabled` (boolean)
  - `input_cost_per_1m_tokens` (nullable)
  - `output_cost_per_1m_tokens` (nullable)
  - `created_at`
  - **Unique**: (`provider_id`, `model_key`)

- `app_settings`
  - `id (uuid pk)`
  - `active_llm_provider_id (fk -> llm_providers)`
  - `active_llm_model_id (fk -> llm_models)`
  - `updated_by_user_id (fk -> users)`
  - `updated_at`

#### Audit log action types (minimum set)
- `AUTH_LOGIN`
- `AUTH_LOGOUT`
- `COLLECTION_ADD_MOVIE`
- `COLLECTION_REMOVE_MOVIE`
- `RATING_SUBMIT`
- `SEARCH_STRUCTURED`
- `SEARCH_AI_NATURAL_LANGUAGE`
- `AI_RECOMMENDATION_REQUEST`
- `ADMIN_LLM_PROVIDER_CHANGED`
- `ADMIN_LLM_MODEL_CHANGED`

#### Immutability rules for audit logs
- No update/delete API endpoints for `audit_logs`.
- DB role for the app should not run destructive audit operations in normal code paths.
- UI is read-only and scoped to the authenticated user’s logs.

---

### Backend API design (REST + JSON)
All requests/inputs are validated. All responses use consistent error shapes.

#### Authentication
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- role-aware auth middleware:
  - `requireAuth`
  - `requireAdmin`

Audit log:
- login/logout must create `audit_logs` entries.

#### Movies
- `GET /api/movies` — list/search with query params:
  - `cast=`
  - `director=`
  - `genre=`
  - `q=` (title keyword)
  - `page=`, `pageSize=`
- `GET /api/movies/:movieId` — movie details including cast/directors/genres + external ratings + user rating (if authed)

Audit log:
- structured searches create `SEARCH_STRUCTURED`.

#### Collections (watched list)
- `GET /api/me/collection` — current user’s collection movies
- `POST /api/me/collection/movies` — add movie `{ movieId }`
- `DELETE /api/me/collection/movies/:movieId` — remove movie
- `PATCH /api/me/collection` — update `isPublic`, `title`

Shareable view:
- `GET /api/collections/:slug` — public collection view (if `is_public=true`)

Audit log:
- add/remove movie, and any share settings changes that matter.

#### Personal ratings
- `POST /api/me/ratings` — submit rating `{ movieId, rating }`
  - enforce once-per-movie per user via DB uniqueness + 409 conflict response on duplicates

Audit log:
- `RATING_SUBMIT`

#### Audit log read view
- `GET /api/me/audit-logs?page=&pageSize=`
  - read-only

#### AI features
Natural language search:
- `POST /api/ai/nl-search` — `{ query: string }` -> list of movies (ids + brief reasons)

Personalized recommendations:
- `POST /api/ai/recommendations` — optional filters `{ mood?, excludeWatched?, maxResults? }`
  - uses viewing history + personal ratings
  - uses active provider/model from `app_settings`

Audit log:
- NL search -> `SEARCH_AI_NATURAL_LANGUAGE`
- Recommendations -> `AI_RECOMMENDATION_REQUEST`

#### Reviews
- `POST /api/me/reviews` — create movie review
- `PATCH /api/me/reviews/:reviewId` — update own review
- `DELETE /api/me/reviews/:reviewId` — delete own review
- `GET /api/movies/:movieId/reviews` — list movie reviews

#### Admin endpoints
- `GET /api/admin/activity` — all users’ audit activity (paginated, filterable)
- `GET /api/admin/reviews` — platform-wide review list
- `GET /api/admin/llm/providers` — list configured providers/models
- `PATCH /api/admin/llm/active` — set active provider/model
  - body: `{ providerKey, modelKey }`
- `POST /api/admin/llm/providers` (optional) — add provider config metadata
- `POST /api/admin/llm/models` (optional) — add model metadata under provider

Audit log:
- changing provider/model creates `ADMIN_LLM_PROVIDER_CHANGED` or `ADMIN_LLM_MODEL_CHANGED`

---

### AI integration approach (prompting, parsing, reliability)
#### Provider choice
Pick a hosted LLM provider that will work in deployment (no local model). Options:
- OpenAI (e.g., `gpt-4.1-mini` style) or Anthropic (e.g., Claude)
- Bonus: Groq/Together/Hugging Face hosted inference with Llama/Mistral family

#### Multi-LLM provider routing
- Implement an `LLMAdapter` interface and provider-specific clients:
  - `OpenAIAdapter`
  - `AnthropicAdapter`
  - `GroqAdapter` (optional/bonus)
  - `TogetherAdapter` (optional/bonus)
- A runtime selector resolves the active provider/model from `app_settings`.
- Admin updates active provider/model via admin API (no redeploy needed).
- Failover policy:
  - if active provider fails (timeout/rate-limit), optional fallback to secondary configured provider
  - always log provider/model used in AI request metadata for traceability

#### Prompting strategy
Use **structured JSON outputs** so the API can validate and safely parse:
- NL search output schema:
  - `{ "matches": [{ "title": "...", "year": 1997, "reason": "..." }], "notes": "..." }`
- Recommendations output schema:
  - `{ "recommendations": [{ "title": "...", "year": 2014, "why": "..." }], "disclaimer": "..." }`

#### Grounding / retrieval
Two practical approaches:
- **Small catalog**: keep movies in DB and include relevant candidates in the prompt (top N by keyword/genre match).
- **Larger catalog**: integrate a movie metadata API (e.g., TMDb/OMDb) for enrichment, then store results in DB.

This assessment doesn’t explicitly require an external catalog provider; however, to make searches meaningful, we will either:
- seed a starter dataset and allow adding movies, or
- integrate a movie metadata API (recommended for realism).

#### Cost and rate-limit considerations (document)
- Set timeouts and retries.
- Implement request-level throttling for AI endpoints.
- Cache recommendation results per user for short TTL (optional).

#### Testing AI logic
- Mock external LLM calls
- Verify:
  - prompt construction includes correct user history context
  - output parsing/validation
  - fallback behavior if model returns invalid JSON

---

### Frontend UX plan (high fidelity + responsive)
#### Core pages/routes
- `/login`, `/register`
- `/` Dashboard: summary + quick actions + AI recommendations
- `/search` Search:
  - structured filters (cast/director/genre)
  - NL search box (AI)
- `/movies/:id` Movie detail:
  - cast/directors/genres
  - external ratings
  - user’s personal rating (or submit if missing)
  - add/remove from collection
- `/collection` My watched list:
  - list, remove, share settings + share link
- `/u/:slug` Public share view
- `/audit` Audit log timeline/table (read-only)
- `/admin` Admin dashboard (admin only)
- `/admin/activity` All-user activity view
- `/admin/reviews` Global review management view
- `/admin/llm` LLM provider/model configuration

#### UI quality requirements (how we’ll meet them)
- Design system tokens:
  - consistent spacing scale, typography scale, color palette
- Components:
  - buttons, inputs, cards, badges (genres), modal, toast notifications
- Responsive layouts:
  - mobile-first, grid changes at common breakpoints
- Accessibility:
  - focus states, form errors tied to inputs, keyboard nav
- States:
  - loading skeletons, empty states, error states

---

### Audit logging (implementation detail)
Create a single backend service function, e.g. `writeAuditLog({ userId, actionType, resourceType, resourceId, resourceLabel, metadata })`, called from:
- auth endpoints (login/logout)
- collection add/remove
- personal rating submit
- structured search endpoint
- AI NL search
- AI recommendations
- admin LLM provider/model switch actions

Rules:
- always store UTC timestamp
- store enough context to be useful (e.g., search query string)
- never expose other users’ audit logs

---

### Unit testing strategy (\(\ge 80\%\) coverage)
#### Backend
- Service tests: business rules (e.g., rating uniqueness)
- DB tests: queries + migrations behavior + audit log writes
- API tests: every endpoint:
  - success cases
  - validation errors (400)
  - auth errors (401/403)
  - conflict cases (409 for duplicate rating)
  - unexpected errors mapped to safe 500 responses
- AI tests: mock provider calls, verify prompt + parsing + fallback
- Admin tests:
  - access control (`ADMIN` only)
  - activity/reviews listing behavior
  - LLM active provider/model update correctness

#### Frontend
- Component tests for forms and validation
- Page tests for:
  - search results render
  - movie detail actions
  - audit log view rendering
  - admin route guard and admin pages rendering

Coverage:
- Configure coverage reporters locally and in CI.
- CI fails if < 80%.

---

### CI/CD pipeline plan (GitHub Actions)
Workflow triggers:
- on push
- on pull request

Jobs:
- `lint-and-typecheck`
- `test` (with coverage gate)
- `build`
- `deploy-api`
- `deploy-web`

Artifacts:
- coverage report (HTML + summary)

Secrets/environment variables (to document)
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `AI_API_KEY` (+ provider-specific values)
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY` (optional)
- `TOGETHER_API_KEY` (optional)
- `WEB_ORIGIN` / `CORS_ALLOWED_ORIGINS`
- deploy tokens/IDs for hosting

---

### Deployment plan (must be CI-driven)
Recommended practical path:
- **API**: Render or Railway (supports Node + managed Postgres easily)
- **DB**: managed Postgres on same platform or separate provider
- **Web**: Vercel

Requirements:
- Deployments triggered by CI only (merge to main or tagged release).
- App is publicly accessible with a live URL.

---

### Milestones (2-week schedule)
Day ranges are flexible; priority is meeting must-haves with quality.

- **Days 1–2**: repo scaffolding, DB schema + migrations, auth foundation, basic UI shell
- **Days 3–5**: movies endpoints + search + collection CRUD, frontend pages for search/detail/collection
- **Days 6–7**: audit log service + UI read view + tests around audit log writes
- **Days 8–9**: AI NL search + recommendations + multi-LLM adapter + mocked tests
- **Days 10–11**: UI polish (responsive, accessibility), error handling, consistent design system
- **Day 12**: admin panel pages (activity/reviews/LLM config) + admin APIs
- **Days 13–14**: increase coverage, bug fixing, docs, final packaging

---

### Documentation requirements (what we will produce)
At minimum:
- `PROJECT_PLAN.md` (this file)
- `README.md`:
  - setup and install
  - env vars
  - running locally
  - running tests + coverage
  - architecture overview
- `docs/AI.md` (optional but recommended):
  - provider/model choice
  - prompting strategy
  - cost/rate-limit notes
- `docs/CI_CD.md` (optional but recommended):
  - pipeline overview
  - deployment flow

Deliverables required by the assessment:
- source code zip
- DB script/migrations
- CI/CD config
- coverage report from pipeline
- live URL
- supporting documentation

---

### Living “Everything we add” log (keep updated)
This section is intentionally designed to be appended to whenever we add something to the project.

#### Dependencies added
- Backend: `express`, `prisma`, `@prisma/client`, `zod`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`
- Frontend: `react`, `react-dom`, `vite`, `react-router-dom`, `@tanstack/react-query`, `react-hook-form`, `zod`, `@hookform/resolvers`
- (to be filled) Shared/packages:

#### Project structure additions
- Added folder: `backend/` (Node.js API/backend boundary)
- Added folder: `ui/` (React frontend boundary)

#### Database changes
- Migration added: `20250520000000_init`
  - Added tables: `users`, `movies`, `people`, `genres`, `movie_cast`, `movie_directors`, `movie_genres`, `movie_external_ratings`, `user_collections`, `collection_movies`, `user_movie_ratings`, `reviews`, `audit_logs`, `llm_providers`, `llm_models`, `app_settings`
  - Added enums: `UserRole`, `ExternalRatingSource`, `AuditActionType`

#### API endpoints added/changed
- Added auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- Added movies: `GET /api/movies`, `GET /api/movies/:movieId`, `GET /api/movies/:movieId/reviews`
- Added collection/me: `GET /api/me/collection`, `POST /api/me/collection/movies`, `DELETE /api/me/collection/movies/:movieId`, `PATCH /api/me/collection`
- Added ratings/reviews: `POST /api/me/ratings`, `POST /api/me/reviews`, `PATCH /api/me/reviews/:reviewId`, `DELETE /api/me/reviews/:reviewId`
- Added audit/user: `GET /api/me/audit-logs`
- Added AI: `POST /api/ai/nl-search`, `POST /api/ai/recommendations`
- Added admin: `GET /api/admin/activity`, `GET /api/admin/reviews`, `GET /api/admin/llm/providers`, `PATCH /api/admin/llm/active`

#### UI routes/components added
- Routes added: `/`, `/search`, `/collection`, `/audit`, `/admin`
- Auth flow: login gate with token in localStorage
- Admin view includes activity, reviews, and active LLM switching form

#### Environment variables added
- Backend: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`
- UI: `VITE_API_URL`

#### CI/CD additions
- (to be filled) Workflow file:
  - Jobs:
  - Secrets required:

---

### Next steps (immediate)
1. Initialize repository structure inside `backend/` and `ui/`.
2. Implement Postgres + Prisma schema and first migration.
3. Build auth endpoints + role-based access (`USER`/`ADMIN`) + frontend auth flow.
4. Implement collection + ratings + reviews + audit logging service.
5. Add AI endpoints with multi-LLM adapter and admin-selectable active provider/model.
6. Implement admin portal (`/admin/activity`, `/admin/reviews`, `/admin/llm`).
7. Add CI/CD with coverage enforcement and automated deployments.

