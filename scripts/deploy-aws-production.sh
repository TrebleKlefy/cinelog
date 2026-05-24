#!/usr/bin/env bash
# CI/CD: push API image to ECR, optionally roll ECS/App Runner & sync UI to S3/CloudFront.
# Requires aws-actions/configure-aws-credentials (OIDC) run before this script.
#
# Env (from GitHub secrets / workflow):
#   AWS_REGION or AWS_REGION_SECRET
#   ECR_REPOSITORY   — repo name only, e.g. cinelog-api
#   ECS_CLUSTER_NAME, ECS_SERVICE_NAME — optional, ECS rolling deploy
#   AWS_APP_RUNNER_SERVICE_ARN        — optional, App Runner deployment
#   AWS_S3_UI_BUCKET                  — optional, static hosting bucket
#   VITE_PUBLIC_API_URL               — required if building UI for S3; passed to vite as VITE_API_URL
#   AWS_CLOUDFRONT_DISTRIBUTION_ID    — optional; invalidates /*
#
# ARG: image tag (normally github.sha)

set -euo pipefail

TAG="${1:?image tag argument required}"

REGION="${AWS_REGION_SECRET:-${AWS_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="$REGION"

if [[ "${SKIP_AWS_PUSH:-}" == "true" ]]; then
  echo "SKIP_AWS_PUSH=true — exiting without deploy."
  exit 0
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

if [[ -z "${ECR_REPOSITORY:-}" ]]; then
  echo "::error::ECR_REPOSITORY is not set (ECR repo name)." >&2
  exit 1
fi

IMAGE_URI="${REGISTRY}/${ECR_REPOSITORY}:${TAG}"

echo "Logging into ECR …"
aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${REGION}" &>/dev/null || \
  aws ecr create-repository --repository-name "${ECR_REPOSITORY}" --image-scanning-configuration scanOnPush=true --region "${REGION}"

aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"

echo "Building and pushing ${IMAGE_URI} …"
docker build --platform linux/amd64 \
  -f backend/Dockerfile \
  -t "${IMAGE_URI}" \
  backend

docker push "${IMAGE_URI}"

TAG_LATEST="${REGISTRY}/${ECR_REPOSITORY}:latest"
docker tag "${IMAGE_URI}" "${TAG_LATEST}"
docker push "${TAG_LATEST}"

if [[ -n "${ECS_CLUSTER_NAME:-}" ]] && [[ -n "${ECS_SERVICE_NAME:-}" ]]; then
  echo "Rolling ECS service ${ECS_SERVICE_NAME} in cluster ${ECS_CLUSTER_NAME} …"
  aws ecs update-service \
    --cluster "${ECS_CLUSTER_NAME}" \
    --service "${ECS_SERVICE_NAME}" \
    --force-new-deployment \
    --region "${REGION}" \
    --no-cli-pager
elif [[ -n "${AWS_APP_RUNNER_SERVICE_ARN:-}" ]]; then
  echo "Starting App Runner deployment …"
  aws apprunner start-deployment \
    --service-arn "${AWS_APP_RUNNER_SERVICE_ARN}" \
    --region "${REGION}" \
    --no-cli-pager
else
  echo "::notice title=Orchestration::New image pushed. If ECS is wired to pull :latest after push, ECS may still need --force-new-deployment. App Runner linked to ECR may auto-deploy; otherwise set AWS_APP_RUNNER_SERVICE_ARN or ECS_CLUSTER_NAME + ECS_SERVICE_NAME."
fi

if [[ -n "${AWS_S3_UI_BUCKET:-}" ]]; then
  if [[ -z "${VITE_PUBLIC_API_URL:-}" ]]; then
    echo "::error::AWS_S3_UI_BUCKET is set but VITE_PUBLIC_API_URL is empty — UI build requires public API URL for VITE_API_URL." >&2
    exit 1
  fi
  echo "Building UI with VITE_API_URL …"
  (
    cd ui
    npm ci
    VITE_API_URL="${VITE_PUBLIC_API_URL}" npm run build
  )
  echo "Syncing UI to s3://${AWS_S3_UI_BUCKET} …"
  aws s3 sync ui/dist "s3://${AWS_S3_UI_BUCKET}/" --delete --region "${REGION}"

  if [[ -n "${AWS_CLOUDFRONT_DISTRIBUTION_ID:-}" ]]; then
    echo "Invalidating CloudFront ${AWS_CLOUDFRONT_DISTRIBUTION_ID} …"
    aws cloudfront create-invalidation \
      --distribution-id "${AWS_CLOUDFRONT_DISTRIBUTION_ID}" \
      --paths '/*' \
      --no-cli-pager > /tmp/cf-inv.json || true
  fi
fi

echo "AWS deploy sequence finished."
