# CI/CD (GitHub Actions + AWS)

GitHub Actions runs tests and **≥80% coverage** thresholds on **[every push and every pull request](https://docs.github.com/en/actions)** (`on: [push, pull_request]` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

Production **deploy runs only on push to `main` or `master`**, after **backend** and **ui** jobs succeed.

---

## CI: unit tests & coverage gates

| Area | Command in CI | Config |
|------|----------------|--------|
| Backend | `npm run test:coverage` | [`backend/vitest.config.ts`](../backend/vitest.config.ts): lines/statements/functions/branches **≥ 80%** |
| Backend DB probes | `RUN_DB_INTEGRATION=true npm run test:integration` | Postgres **service** container in Actions |
| UI | `npm run build`, `npm run test:coverage` | [`ui/vitest.config.ts`](../ui/vitest.config.ts): **≥ 80%** on its `coverage.include` slice |

Failing thresholds cause **Vitest exit code ≠ 0** → workflow **fails**.

**Artefacts** (PR / `main` / `master`): `backend-coverage`, `ui-coverage` uploads for debugging.

---

## CD: AWS (primary)

The **deploy** job picks the target automatically:

| Priority | When it runs |
|----------|----------------|
| **1. AWS** | `secrets.AWS_ROLE_ARN` **and** `secrets.AWS_ECR_REPOSITORY` are set |
| **2. Render (legacy)** | Otherwise, if **`RENDER_DEPLOY_HOOK_API`** and **`RENDER_DEPLOY_HOOK_UI`** are both set → POST hooks |
| **3. Notice** | If neither bundle is configured → workflow logs a skip **notice** (does not fail the job) |

### What the AWS path does

1. **OIDC** — [`aws-actions/configure-aws-credentials`](https://github.com/aws-actions/configure-aws-credentials) assumes your IAM role (no static `AWS_ACCESS_KEY_ID` required in-repo).
2. **ECR** — Creates the repository if missing, then **`docker build -f backend/Dockerfile`** (context **`backend/`**), **`docker push`** both **`${GIT_SHA}`** and **`:latest`**.
3. **Rollout (pick one)**  
   - **ECS Fargate / EC2 launch type:** set **`AWS_ECS_CLUSTER_NAME`** + **`AWS_ECS_SERVICE_NAME`** → **`aws ecs update-service --force-new-deployment`**. Ensure the task definition points at **the pushed image**.  
   - **App Runner:** set **`AWS_APP_RUNNER_SERVICE_ARN`** → **`aws apprunner start-deployment`** *or* enable **automatic deploy from ECR** so a push to `:latest` is enough without the ARN secret.
4. **Static UI (optional)** — if **`AWS_S3_UI_BUCKET`** is set:
   - Requires **`AWS_PUBLIC_API_URL_FOR_UI_BUILD`** → passed as **`VITE_API_URL`** during `vite build`.
   - Syncs **`ui/dist`** → **S3** (`aws s3 sync … --delete`).
   - Optionally **`AWS_CLOUDFRONT_DISTRIBUTION_ID`** → invalidates **`/*`**.

Script: [`scripts/deploy-aws-production.sh`](../scripts/deploy-aws-production.sh).

**API container:** [`backend/Dockerfile`](../backend/Dockerfile) runs **`prisma migrate deploy`** before **`node dist/index.js`**. Provide **`DATABASE_URL`** (RDS) at runtime via ECS task definition / App Runner env / Secrets Manager.

---

### One-time AWS + GitHub OIDC checklist

These steps happen in AWS Console / IaC tools; values then map to repo **Secrets** / **Variables**.

1. **Amazon ECR**  
   Repository name matching **`AWS_ECR_REPOSITORY`** secret (script can auto-create repo if IAM allows `ecr:CreateRepository`).

2. **IAM role for GitHub Actions (OIDC)**  
   - Create an IAM **OpenID Connect** identity provider: `token.actions.githubusercontent.com` (issuer + thumbprints per [AWS docs](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)).  
   - Create role **trusted** for **`sts:AssumeRoleWithWebIdentity`** with condition **`StringLike`: `repo:OWNER/REPO:*`** (narrow to **`ref:refs/heads/main`** when possible).  
   - Attach policies (inline or managed) minimally like:
     - **ECR:** `GetAuthorizationToken`, push/pull on your repo ARN  
     - **ECS:** `ecs:UpdateService`, `ecs:DescribeServices` … on your cluster/service  
     - **App Runner:** `apprunner:StartDeployment`  
     - **S3 / CloudFront** (only if deploying UI bucket)

3. **GitHub Secrets** (`Settings → Secrets and variables → Actions`)

| Secret | Required for AWS deploy? | Purpose |
|--------|--------------------------|---------|
| `AWS_ROLE_ARN` | **Yes** (with ECR repo) | IAM role ARN OIDC assumption |
| `AWS_ECR_REPOSITORY` | **Yes** | Repo name segment only (e.g. `cinelog-api`) |
| `AWS_ECS_CLUSTER_NAME` | No* | ECS cluster with API service |
| `AWS_ECS_SERVICE_NAME` | No* | Service to roll |
| `AWS_APP_RUNNER_SERVICE_ARN` | No* | App Runner service ARN for `start-deployment` |
| `AWS_S3_UI_BUCKET` | No | UI static bucket name |
| `AWS_PUBLIC_API_URL_FOR_UI_BUILD` | If S3 sync | **`https://`** public API URL for **VITE_API_URL** at build |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | No | UI CDN invalidation |

\* At least **one** rollout mechanism (ECS pair, App Runner ARN, or console **auto-deploy** from ECR) should be wired so production sees new images.

4. **GitHub Variables** (`Settings → Secrets and variables → Actions → Variables`)

| Variable | Purpose |
|---------|---------|
| `AWS_DEPLOY_REGION` | Default **`us-east-1`** when unset; OIDC session + `aws` CLI calls use this |

5. **Runtime env for the API container** — set **outside** CI (RDS URL, JWT secrets, CORS origins, optional LLM keys). Mirror [`backend/.env.example`](../backend/.env.example).

6. **`PORT`** — App Runner / many ALBs expect **8080**. Set **`PORT=8080`** in the task/App Runner env or map the target group to **4000** if you leave the default ([`backend/src/index.ts`](../backend/src/index.ts)).

---

## CD: Render (optional fallback)

If you still use Render deploy hooks, set **`RENDER_DEPLOY_HOOK_API`** and **`RENDER_DEPLOY_HOOK_UI`** and **omit** **`AWS_ROLE_ARN`** **or** **`AWS_ECR_REPOSITORY`** so the router chooses Render (otherwise AWS wins).

---

## Local parity & Docker smoke test

```bash
docker build -f backend/Dockerfile -t cinelog-api:local backend
docker run --rm -e DATABASE_URL="postgresql://…" -e PORT=4000 -p 4000:4000 cinelog-api:local
```

---

## Frontend build note

[Vite](https://vitejs.dev) bakes **`VITE_API_URL`** at build time. For S3/deploy-from-Actions, **`AWS_PUBLIC_API_URL_FOR_UI_BUILD`** must be the HTTPS origin users hit for the API (no trailing **`/api`** unless your client code expects that).

---

More project context: [README.md](../README.md).
