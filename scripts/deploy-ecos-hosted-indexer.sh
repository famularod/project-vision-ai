#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${ECOS_GCP_PROJECT_ID:-vitruvius-project-intelligence}"
REGION="${ECOS_GCP_REGION:-us-west1}"
REPOSITORY="${ECOS_GCP_ARTIFACT_REPOSITORY:-vitruvius-workers}"
JOB_NAME="${ECOS_GCP_JOB_NAME:-ecos-hosted-indexer}"
SCHEDULE_NAME="${ECOS_GCP_SCHEDULE_NAME:-ecos-hosted-indexer-every-minute}"
RUNTIME_ACCOUNT="ecos-indexer-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_ACCOUNT="ecos-indexer-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_TAG="${ECOS_GCP_IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${JOB_NAME}:${IMAGE_TAG}"
EMBEDDING_PROVIDER_URL="${ECOS_EMBEDDING_PROVIDER_URL:-https://xdytqlpsqsseoeuxgzre.supabase.co/functions/v1/ecos-embedding-provider}"

for command in gcloud git; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  fi
done

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com \
  --project="${PROJECT_ID}" >/dev/null

if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" --repository-format=docker \
    --location="${REGION}" --project="${PROJECT_ID}" \
    --description="Vitruvius protected worker images" >/dev/null
fi

for account in ecos-indexer-runtime ecos-indexer-scheduler; do
  if ! gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${account}" --project="${PROJECT_ID}" \
      --display-name="${account}" >/dev/null
  fi
done

for secret in ecos-supabase-url ecos-supabase-service-role-key ecos-service-worker-token; do
  if ! gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Required secret is not configured: ${secret}" >&2
    exit 1
  fi
done

SECRET_BINDINGS="SUPABASE_URL=ecos-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=ecos-supabase-service-role-key:latest,ECOS_EMBEDDING_PROVIDER_AUTH_TOKEN=ecos-supabase-service-role-key:latest,ECOS_EMBEDDING_PROVIDER_WORKER_TOKEN=ecos-service-worker-token:latest"
if gcloud secrets describe ecos-visual-provider-url --project="${PROJECT_ID}" >/dev/null 2>&1 \
  && gcloud secrets describe ecos-service-worker-token --project="${PROJECT_ID}" >/dev/null 2>&1; then
  SECRET_BINDINGS="${SECRET_BINDINGS},ECOS_VISUAL_PROVIDER_URL=ecos-visual-provider-url:latest,ECOS_VISUAL_PROVIDER_TOKEN=ecos-service-worker-token:latest"
fi

for secret in ecos-supabase-url ecos-supabase-service-role-key ecos-openai-api-key \
  ecos-visual-provider-url ecos-service-worker-token; do
  if gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "${secret}" --project="${PROJECT_ID}" \
      --member="serviceAccount:${RUNTIME_ACCOUNT}" \
      --role=roles/secretmanager.secretAccessor >/dev/null
  fi
done

gcloud builds submit workers/ecos-indexer --project="${PROJECT_ID}" --tag="${IMAGE}"

gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --image="${IMAGE}" \
  --service-account="${RUNTIME_ACCOUNT}" --tasks=1 --parallelism=1 \
  --cpu=2 --memory=4Gi --task-timeout=60m --max-retries=1 \
  --set-secrets="${SECRET_BINDINGS}" \
  --set-env-vars="ECOS_WORKER_RUN_MODE=batch,ECOS_WORKER_LEASE_SECONDS=1800,ECOS_MAX_JOBS_PER_RUN=8,ECOS_MAX_RUN_SECONDS=3300,ECOS_MAX_SOURCE_BYTES=262144000,ECOS_MAX_SOURCE_PAGES=500,ECOS_MAX_OCR_TILES_PER_PAGE=128,ECOS_PAGE_TIMEOUT_SECONDS=600,ECOS_REQUIRE_MALWARE_SCAN=true,ECOS_MALWARE_SCAN_TIMEOUT_SECONDS=300,ECOS_VISUAL_ESTIMATED_COST_MICROUSD=500,ECOS_EMBEDDING_PROVIDER_URL=${EMBEDDING_PROVIDER_URL},ECOS_EMBEDDING_MODEL=text-embedding-3-small,ECOS_EMBEDDING_BATCH_SIZE=64,ECOS_MAX_EMBEDDING_CHUNKS_PER_DOCUMENT=25000"

gcloud run jobs add-iam-policy-binding "${JOB_NAME}" --project="${PROJECT_ID}" \
  --region="${REGION}" --member="serviceAccount:${SCHEDULER_ACCOUNT}" \
  --role=roles/run.invoker >/dev/null

RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"
if gcloud scheduler jobs describe "${SCHEDULE_NAME}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${SCHEDULE_NAME}" --location="${REGION}" --project="${PROJECT_ID}" \
    --schedule='* * * * *' --uri="${RUN_URI}" --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_ACCOUNT}" >/dev/null
else
  gcloud scheduler jobs create http "${SCHEDULE_NAME}" --location="${REGION}" --project="${PROJECT_ID}" \
    --schedule='* * * * *' --uri="${RUN_URI}" --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_ACCOUNT}" >/dev/null
fi

if [[ "${ECOS_EXECUTE_AFTER_DEPLOY:-false}" == "true" ]]; then
  gcloud run jobs execute "${JOB_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --wait
fi

echo "ECOS hosted indexer deployed in ${REGION} with shadow publication controls."
