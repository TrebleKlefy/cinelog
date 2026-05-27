# Supporting Documentation

## Project Overview

`cineLog` is a monorepo with:

- `backend/`: Node.js 22, Express, TypeScript, Prisma, PostgreSQL.
- `ui/`: React, Vite, TypeScript.
- Production deployment: Docker Compose on an AWS EC2 instance, with Nginx serving the built UI and proxying `/api` to the backend.

## Dependencies And Installation Requirements

Required local tools:

- Node.js `22.x`
- npm
- Docker
- Docker Compose v2
- PostgreSQL `16` for local or hosted database use
- Git

Backend install:

```bash
cd backend
npm ci
cp .env.example .env
npm run db:generate
npm run build
```

UI install:

```bash
cd ui
npm ci
npm run build
```

Local database with Docker:

```bash
docker compose up -d
cd backend
npm run db:migrate
npm run db:seed
```

Production EC2 deployment requirements:

- Amazon Linux EC2 instance
- Docker and Docker Compose installed
- `backend/.env.production` present on the server
- `docker-compose.prod.yml`
- `nginx.conf`
- EC2 security group allowing inbound HTTP `80`; SSH `22` should be restricted when possible

## Environment Variables And Configuration

Backend runtime variables:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
JWT_ACCESS_SECRET="replace-with-long-random-secret"
JWT_REFRESH_SECRET="replace-with-long-random-secret"
CORS_ORIGINS="http://localhost:5173,http://YOUR_PUBLIC_HOST"
PORT=4000
```

Docker Compose production database variables:

```bash
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="replace-with-db-password"
POSTGRES_DB="cinelog"
```

If using the Docker Postgres service in production, `DATABASE_URL` should use the Compose service hostname:

```bash
DATABASE_URL="postgresql://postgres:replace-with-db-password@postgres:5432/cinelog"
```

Optional AI and movie-data variables:

```bash
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
GROQ_API_KEY=""
TOGETHER_API_KEY=""
OMDB_API_KEY=""
TMDB_READ_ACCESS_TOKEN=""
TMDB_API_KEY=""
```

UI variable:

```bash
VITE_API_URL="http://localhost:4000"
```

For production behind the included Nginx reverse proxy, the UI is built with an empty `VITE_API_URL` so browser requests use the same origin:

```bash
VITE_API_URL= npm run build
```

GitHub Actions secrets for EC2 deployment:

```text
EC2_HOST
EC2_USER
EC2_SSH_KEY
```

The existing AWS/ECR deployment path also supports these optional secrets:

```text
AWS_ROLE_ARN
AWS_ECR_REPOSITORY
AWS_ECS_CLUSTER_NAME
AWS_ECS_SERVICE_NAME
AWS_APP_RUNNER_SERVICE_ARN
AWS_S3_UI_BUCKET
AWS_PUBLIC_API_URL_FOR_UI_BUILD
AWS_CLOUDFRONT_DISTRIBUTION_ID
```

## Unit Tests And Coverage Reports

Backend tests:

```bash
cd backend
npm test
npm run test:coverage
```

Backend integration tests require a migrated PostgreSQL database:

```bash
cd backend
RUN_DB_INTEGRATION=true DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE" npm run test:integration
```

UI tests:

```bash
cd ui
npm test
npm run test:coverage
```

Coverage configuration:

- Backend uses Vitest with V8 coverage in `backend/vitest.config.ts`.
- UI uses Vitest with V8 coverage in `ui/vitest.config.ts`.
- Both enforce at least `80%` lines, statements, functions, and branches.

Coverage report output:

```text
backend/coverage/
ui/coverage/
```

GitHub Actions uploads coverage artifacts from PRs and production branches.

## AI Integration Details

AI-related backend code lives primarily in:

- `backend/src/services/llm.ts`
- `backend/src/services/recommendationResolve.ts`
- `backend/src/routes/ai.ts`
- `backend/src/routes/admin.ts`

Providers and models:

- Default seeded provider: Groq.
- Default seeded Groq model: `meta-llama/llama-4-scout-17b-16e-instruct`.
- OpenAI chat completion support is implemented through `OPENAI_API_KEY`.
- Groq chat completion support is implemented through `GROQ_API_KEY`.
- Anthropic and Together keys are reserved in configuration, but the current live chat-completion adapter dispatches only OpenAI and Groq; unsupported or failing providers fall back to deterministic mock responses.

Prompting approach:

- AI natural-language search asks the model to return strict JSON with `matches`, optional `movieId`, and a short `reason`.
- Recommendations ask for strict JSON containing movie `title`, optional `year`, and concise `why` rationale.
- Recommendation generation initially asks for `11` candidates, targets `7` final recommendations, and uses up to `3` replacement rounds when TMDB/catalog resolution fails.
- The service strips Markdown JSON fences before parsing model output.
- Generated movie titles are matched against the local catalog first, then enriched through TMDB when possible.

Runtime behavior:

- Temperature is set to `0.3` for live OpenAI/Groq calls.
- Groq requests set `max_completion_tokens` to `2048`, `top_p` to `1`, and use non-streaming completions.
- If API keys are missing or provider calls fail, AI routes return mock data rather than breaking the user flow.

Cost and rate-limit notes:

- Live AI calls are billed by the selected provider according to that provider's pricing and token usage.
- Recommendation flows may use more than one LLM request because unresolved titles can trigger replacement rounds.
- TMDB and OMDb calls are separate external API usage and may have their own rate limits.
- Keep model output short and JSON-only to reduce token usage.
- Production keys must be stored in environment variables or deployment secrets, never committed to the repository.

## CI/CD Pipeline Overview

Primary CI workflow:

- File: `.github/workflows/ci.yml`
- Runs on every push and pull request.
- Backend job:
  - Starts PostgreSQL `16`.
  - Installs backend dependencies.
  - Generates Prisma client.
  - Applies migrations.
  - Seeds test data.
  - Runs backend coverage.
  - Runs PostgreSQL integration tests.
- UI job:
  - Installs UI dependencies.
  - Builds the Vite app.
  - Runs UI coverage.

Production EC2 deployment workflow:

- File: `.github/workflows/deploy-ec2.yml`
- Trigger: successful completion of the `CI` workflow on `main` or `master`.
- Uses GitHub secrets `EC2_HOST`, `EC2_USER`, and `EC2_SSH_KEY`.
- SSHes into the EC2 instance.
- Runs `git fetch` and `git reset --hard origin/<branch>`.
- Builds the UI inside a Node Docker container.
- Rebuilds/restarts production services with:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d --build
```

Production services:

- `postgres`: PostgreSQL container.
- `api`: Express/Prisma backend built from `backend/Dockerfile`.
- `web`: Nginx container serving `ui/dist` and proxying `/api` to the backend.

## Database Script

Database technology:

- PostgreSQL
- Prisma ORM

The canonical database scripts are the ordered SQL migration files generated by Prisma:

```text
backend/prisma/migrations/20250520000000_init/migration.sql
backend/prisma/migrations/20250520100000_movie_imdb_import_audit/migration.sql
backend/prisma/migrations/20250520120000_movie_tmdb/migration.sql
backend/prisma/migrations/20250520140000_ai_agent_chat/migration.sql
backend/prisma/migrations/20250521180000_user_hidden_movies/migration.sql
backend/prisma/migrations/20260522055718_hiddenmoviews/migration.sql
```

Apply the database script through Prisma:

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

For development migration creation:

```bash
cd backend
npm run db:migrate
```

For production Docker startup, migrations are applied automatically by `backend/Dockerfile` before the API starts:

```dockerfile
CMD ["npx prisma migrate deploy && exec node dist/index.js"]
```

The database seed script is:

```text
backend/prisma/seed.ts
```

Seeded demo accounts:

```text
admin@demo.com / Admin123!
user@demo.com / User123!
```
