# AWS deployment — click paths & IAM (ECS vs App Runner, S3 vs Amplify)

This doc narrows [CI/CD](CI_CD.md) into **two API options** and **two UI options** your GitHub Actions deploy step already supports (or a third UI path via **Amplify**).

Replace placeholders:

| Placeholder | Meaning |
|-------------|---------|
| `ACCOUNT_ID` | 12-digit AWS account ID |
| `REGION` | e.g. `us-east-1` (match GitHub Variable **`AWS_DEPLOY_REGION`** or default) |
| `REPO_NAME` | GitHub repo, e.g. `TrebleKlefy/cinelog` |
| `ECR_REPO` | Same string as GitHub Secret **`AWS_ECR_REPOSITORY`** (e.g. `cinelog-api`) |

---

## Choose your stack

| API | Pros | GitHub Secrets (deploy roll) |
|-----|------|------------------------------|
| **A. ECS Fargate + ALB** | Familiar scaling, VPC control, RDS in same VPC | **`AWS_ECS_CLUSTER_NAME`** + **`AWS_ECS_SERVICE_NAME`** |
| **B. App Runner** | Fewer moving parts; public HTTPS URL built-in | **`AWS_APP_RUNNER_SERVICE_ARN`** *(or rely on **ECR auto-deploy** after `:latest` push and omit ARN)* |

| UI | Fits this repo today? |
|-----|----------------------|
| **S3 + CloudFront** | **Yes** — [`deploy-aws-production.sh`](../scripts/deploy-aws-production.sh) syncs `ui/dist`. Set **`AWS_S3_UI_BUCKET`**, **`AWS_PUBLIC_API_URL_FOR_UI_BUILD`**, optional **`AWS_CLOUDFRONT_DISTRIBUTION_ID`**. |
| **Amplify Hosting** | **Yes (parallel pipeline)** — connect GitHub repo in Amplify Console; Amplify builds `ui/` on each push. **Do not set** **`AWS_S3_UI_BUCKET`** in GitHub unless you want *both*. Set **`VITE_API_URL`** in Amplify **Environment variables** to your API URL. |

Everything below assumes **RDS PostgreSQL** already exists and you will set **`DATABASE_URL`** (+ JWT secrets, **`CORS_ORIGINS`**) on the container service.

---

## 0. Prerequisites (both paths)

1. **AWS Console** → switch to **`REGION`**.
2. Create **VPC + subnets + security groups** if you don’t already have them (ECS needs them; App Runner manages networking for you; RDS needs subnets + SG rules allowing **ECS tasks or App Runner → 5432**).

---

## Path A — API on **ECS Fargate** (high-level clicks)

1. **ECR**
   - **Elastic Container Registry** → **Repositories** → **Create repository**.
   - Name = **`ECR_REPO`** (must match **`AWS_ECR_REPOSITORY`**).
   - **Create**.

2. **RDS PostgreSQL**
   - **RDS** → **Create database** → template **Free tier** or **Production**.
   - Engine **Postgres 16** (or compatible).
   - Note **endpoint**, **port**, **master username/password**.
   - **Security group**: inbound **PostgreSQL** from your **ECS task security group** (or VPC CIDR for testing — tighten later).

3. **ECS**
   - **Elastic Container Service** → **Create cluster** (e.g. `cinelog-cluster`) → **Networking only** → create.
   - **Task definitions** → **Create new** → **Fargate**:
     - **Container**: image **`ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/ECR_REPO:latest`** (after first Actions push image exists — or paste placeholder and update after CI).
     - **Port mapping**: container port **`8080`** (recommended) → set container env **`PORT=8080`**. Or use **4000** if ALB/target group expects it.
     - **Environment**: **`DATABASE_URL`**, **`JWT_ACCESS_SECRET`**, **`JWT_REFRESH_SECRET`**, **`CORS_ORIGINS`** (your SPA origin, e.g. `https://d123.cloudfront.net` or Amplify URL).
     - CPU/memory modest (0.25 vCPU / 512 MB to start).
   - **Clusters** → your cluster → **Create service** → **Fargate**:
     - **Load balancer**: **Application Load Balancer** (internet-facing) → listener **443** (ACM cert) or **80** for testing.
     - **Target group** → health check path **`/api/health`** (**GET**).

4. Copy for GitHub Secrets:
   - **`AWS_ECS_CLUSTER_NAME`** = cluster name exactly as in console.
   - **`AWS_ECS_SERVICE_NAME`** = service name exactly.

5. **Public URL** = ALB DNS name → **`https://YOUR_ALB_REGION.elb.amazonaws.com`** (or custom domain + ACM).

---

## Path B — API on **App Runner** (high-level clicks)

1. **ECR** — same as Path A step 1.

2. **RDS** — same as Path A step 2; **security group** must allow **App Runner’s outbound** or use **VPC connector** (advanced). Simplest MVP: RDS **publicly accessible** + strict SG from App Runner egress IPs (still fragile); production uses **VPC connector**.

3. **App Runner**
   - **App Runner** → **Create service** → **Container registry** → **Amazon ECR**.
   - Select **repository** **`ECR_REPO`**, deployment **automatic** whenever **`:latest`** updates (recommended with this repo’s workflow — it pushes **`:latest`** every deploy).
   - **Port** typically **8080** → env **`PORT=8080`** in App Runner overrides (or rely on defaults).
   - Add env vars **`DATABASE_URL`**, JWT, **`CORS_ORIGINS`**.

4. GitHub Secrets:
   - Optionally **`AWS_APP_RUNNER_SERVICE_ARN`** (full ARN of the service) so [`deploy-aws-production.sh`](../scripts/deploy-aws-production.sh) runs **`aws apprunner start-deployment`**.  
   - If deployment is **fully automatic from ECR**, you can omit the ARN and rely on `:latest`; the script logs a notice if neither ECS nor App Runner ARN rollout is configured.

5. **Public URL** = App Runner **Default domain** (`https://xxxxx.region.awsapprunner.com`).

---

## UI — **S3 + CloudFront** (pairs with ECS or App Runner)

1. **S3**
   - **Create bucket** (name globally unique) → e.g. `cinelog-ui-PROD-YOURNAME`.
   - **Block Public Access**: keep blocked.
   - You will serve via **CloudFront OAC**, not bucket public ACL.

2. **CloudFront**
   - **Create distribution** → **Origin** = **S3** REST origin (recommended with **Origin access**).
   - **Default root object**: `index.html`.
   - **Custom error responses** (SPA): HTTP **403** → **200** `/index.html` (and optionally **404** → **200** `/index.html`).

3. **Origin Access Control**: attach bucket policy granting CloudFront read (Console guides this when creating origin).

4. GitHub Secrets (for **`scripts/deploy-aws-production.sh`**):
   - **`AWS_S3_UI_BUCKET`** = bucket name only.
   - **`AWS_PUBLIC_API_URL_FOR_UI_BUILD`** = **`https://`** your **API** URL (ALB or App Runner), **no path** unless your UI expects it (`VITE_API_URL` semantics).
   - **`AWS_CLOUDFRONT_DISTRIBUTION_ID`** — distribution ID (for invalidation **`/*`**).

---

## UI — **Amplify Hosting** (GitHub-triggered SPA build)

1. **AWS Amplify** → **Create new app** → **Host web app** → **GitHub** → authorize → select **`REPO_NAME`**, branch **`main`**.
2. **Build settings** — monorepo:
   - **App root**: `ui`
   - **Build command**: `npm ci && npm run build`
   - **Artifact directory**: `dist`
3. **Environment variables**: **`VITE_API_URL`** = your public **API HTTPS** URL (`https://…..elb.amazonaws.com` or App Runner URL).
4. Deploy. Each push to `main` builds the UI (Amplify’s pipeline).

**Overlap with GitHub Actions:** Your workflow still runs **`ui` CI** tests. You **do not** need **`AWS_S3_UI_BUCKET`** for Amplify unless you also want the GitHub **`s3 sync`** deploy.

---

## GitHub OIDC + IAM (**exact snippets**)

### 1) Create OIDC identity provider (once per account)

**IAM** → **Identity providers** → **Add provider**:

- Provider URL: **`https://token.actions.githubusercontent.com`**
- Audience: **`sts.amazonaws.com`**

Thumbprints rotate — use current values from GitHub/AWS docs ([Configuring OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)).

### 2) Trust policy — role GitHub Actions will assume

**IAM** → **Roles** → **Create role** → **Web identity** → choose **`token.actions.githubusercontent.com`** → Audience **`sts.amazonaws.com`**.

Paste **trust policy** (choose **narrow** vs **repo-wide**):

**Narrow — only pushes to `main` on one repo:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:REPO_NAME:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

**Broader — any ref in repo (use with care):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:REPO_NAME:*"
        }
      }
    }
  ]
}
```

Create the role → note **Role ARN** → GitHub Secret **`AWS_ROLE_ARN`**.

### 3) Permission policy — attach to that role

Create **inline policy** `CineLogGitHubDeploy` and merge the **Statement blocks** you need.

**A) ECR (push + optional create repo)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRRepoMutation",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:CreateRepository",
        "ecr:DescribeRepositories"
      ],
      "Resource": "arn:aws:ecr:REGION:ACCOUNT_ID:repository/ECR_REPO"
    }
  ]
}
```

**B) ECS roll (Path A)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECSDeploy",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:DescribeClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

Tighten by replacing `"Resource":"*"` with your **cluster** and **service** ARNs from ECS console (**Copy ARN** buttons).

**C) App Runner (Path B — if using `start-deployment`)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppRunnerDeploy",
      "Effect": "Allow",
      "Action": ["apprunner:StartDeployment", "apprunner:DescribeService"],
      "Resource": "PASTE_APP_RUNNER_SERVICE_ARN"
    }
  ]
}
```

**D) S3 + CloudFront UI (GitHub **`s3 sync`** path)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UIS3",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_UI_BUCKET",
        "arn:aws:s3:::YOUR_UI_BUCKET/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/CLOUDFRONT_DISTRIBUTION_ID"
    }
  ]
}
```

Amplify-managed UI builds **do not** need sections **D** unless you also use **`s3 sync`**.

---

## GitHub Secrets checklist (minimal)

| Secret | ECS + S3 UI | App Runner + S3 UI | ECS + Amplify UI |
|--------|-------------|---------------------|-------------------|
| `AWS_ROLE_ARN` | ✓ | ✓ | ✓ |
| `AWS_ECR_REPOSITORY` | ✓ | ✓ | ✓ |
| `AWS_ECS_CLUSTER_NAME` / `AWS_ECS_SERVICE_NAME` | ✓ | — | ✓ |
| `AWS_APP_RUNNER_SERVICE_ARN` | — | ✓ *(optional if ECR auto-deploy)* | — |
| `AWS_S3_UI_BUCKET` | ✓ | ✓ *(if syncing from Actions)* | — *(omit)* |
| `AWS_PUBLIC_API_URL_FOR_UI_BUILD` | ✓ *(if S3 sync)* | ✓ *(if S3 sync)* | — *(set `VITE_API_URL` in Amplify instead)* |

**Variable**: **`AWS_DEPLOY_REGION`** = `REGION`.

---

## After first successful push

1. **`GET https://YOUR_API_ORIGIN/api/health`** → **`ok`**.
2. **`CORS_ORIGINS`** includes your SPA origin (CloudFront or Amplify URL).
3. SPA loads and XHR/API calls reach the backend.

---

Back to automation overview: [CI_CD.md](CI_CD.md).
