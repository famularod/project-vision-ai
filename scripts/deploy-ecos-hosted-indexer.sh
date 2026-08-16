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
IMAGE_REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${JOB_NAME}"
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
VISUAL_PROVIDER_ENABLED="${ECOS_VISUAL_PROVIDER_ENABLED:-}"

require_exact_secret_version() {
  local name="$1"
  local value="${!name:-}"
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "${name} must be one immutable numeric Secret Manager version; aliases such as latest are forbidden." >&2
    exit 1
  fi
}

require_exact_secret_version ECOS_SUPABASE_URL_SECRET_VERSION
require_exact_secret_version ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION
case "${VISUAL_PROVIDER_ENABLED}" in
  true)
    require_exact_secret_version ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION
    require_exact_secret_version ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION
    ;;
  false)
    if [[ -n "${ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION:-}" \
      || -n "${ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION:-}" ]]; then
      echo "Visual secret versions require ECOS_VISUAL_PROVIDER_ENABLED=true." >&2
      exit 1
    fi
    ;;
  *)
    echo "ECOS_VISUAL_PROVIDER_ENABLED must explicitly equal true or false." >&2
    exit 1
    ;;
esac

SECRET_BINDINGS="SUPABASE_URL=ecos-supabase-url:${ECOS_SUPABASE_URL_SECRET_VERSION},SUPABASE_SERVICE_ROLE_KEY=ecos-supabase-service-role-key:${ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION}"
BOUND_SECRET_NAMES=(ecos-supabase-url ecos-supabase-service-role-key)
BOUND_SECRET_VERSIONS=(
  "${ECOS_SUPABASE_URL_SECRET_VERSION}"
  "${ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION}"
)
if [[ "${VISUAL_PROVIDER_ENABLED}" == "true" ]]; then
  SECRET_BINDINGS="${SECRET_BINDINGS},ECOS_VISUAL_PROVIDER_URL=ecos-visual-provider-url:${ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION},ECOS_VISUAL_PROVIDER_TOKEN=ecos-service-worker-token:${ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION}"
  BOUND_SECRET_NAMES+=(ecos-visual-provider-url ecos-service-worker-token)
  BOUND_SECRET_VERSIONS+=(
    "${ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION}"
    "${ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION}"
  )
fi

for command in gcloud git node; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  fi
done

gcloud config set project "${PROJECT_ID}" >/dev/null

SCHEDULER_API_STATE="$(
  gcloud services list --enabled --project="${PROJECT_ID}" \
    --filter='config.name=cloudscheduler.googleapis.com' --format='value(config.name)'
)"
if [[ "${SCHEDULER_API_STATE}" != "cloudscheduler.googleapis.com" ]]; then
  echo "Cloud Scheduler API must be enabled through a separately controlled bootstrap before deployment." >&2
  exit 1
fi

RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"
HELD_SCHEDULE='0 0 31 2 *'
read_scheduler_state() {
  gcloud scheduler jobs describe "${SCHEDULE_NAME}" --location="${REGION}" \
    --project="${PROJECT_ID}" --format='value(state)'
}

SCHEDULER_EXISTS=false
EXPECTED_SCHEDULER_RESOURCE="projects/${PROJECT_ID}/locations/${REGION}/jobs/${SCHEDULE_NAME}"
SCHEDULER_RESOURCE_LIST="$(
  gcloud scheduler jobs list --location="${REGION}" --project="${PROJECT_ID}" \
    --filter="name=${EXPECTED_SCHEDULER_RESOURCE}" --format='value(name)'
)"
if [[ -n "${SCHEDULER_RESOURCE_LIST}" && "${SCHEDULER_RESOURCE_LIST}" != "${SCHEDULE_NAME}" ]]; then
  echo "Scheduler discovery returned an ambiguous resource; refusing to continue." >&2
  exit 1
fi
if [[ "${SCHEDULER_RESOURCE_LIST}" == "${SCHEDULE_NAME}" ]]; then
  SCHEDULER_EXISTS=true
  EXISTING_SCHEDULER_STATE="$(read_scheduler_state)"
  case "${EXISTING_SCHEDULER_STATE}" in
    PAUSED) ;;
    ENABLED)
      gcloud scheduler jobs pause "${SCHEDULE_NAME}" --location="${REGION}" \
        --project="${PROJECT_ID}" >/dev/null
      ;;
    *)
      echo "Scheduler is in an unsafe or unknown state: ${EXISTING_SCHEDULER_STATE}" >&2
      exit 1
      ;;
  esac
  EARLY_SCHEDULER_STATE="$(read_scheduler_state)"
  if [[ "${EARLY_SCHEDULER_STATE}" != "PAUSED" ]]; then
    echo "Existing scheduler could not be paused before build; refusing to continue." >&2
    exit 1
  fi
fi

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}" >/dev/null

# A previously configured scheduler identity may retain invocation access even
# while the scheduler is paused. Remove and verify that access before building
# or replacing the job, then restore it only after the final PAUSED readback.
RUN_JOB_NAME_LIST="$(
  gcloud run jobs list --project="${PROJECT_ID}" --region="${REGION}" \
    --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)'
)"
if [[ -n "${RUN_JOB_NAME_LIST}" && "${RUN_JOB_NAME_LIST}" != "${JOB_NAME}" ]]; then
  echo "Cloud Run job discovery returned an ambiguous resource; refusing to continue." >&2
  exit 1
fi
if [[ "${RUN_JOB_NAME_LIST}" == "${JOB_NAME}" ]]; then
  gcloud run jobs remove-iam-policy-binding "${JOB_NAME}" --project="${PROJECT_ID}" \
    --region="${REGION}" --member="serviceAccount:${SCHEDULER_ACCOUNT}" \
    --role=roles/run.invoker --quiet >/dev/null 2>&1 || true
  REMAINING_SCHEDULER_INVOKER_ROLE="$(
    gcloud run jobs get-iam-policy "${JOB_NAME}" --project="${PROJECT_ID}" --region="${REGION}" \
      --flatten='bindings[].members' \
      --filter="bindings.role=roles/run.invoker AND bindings.members=serviceAccount:${SCHEDULER_ACCOUNT}" \
      --format='value(bindings.role)'
  )"
  if [[ -n "${REMAINING_SCHEDULER_INVOKER_ROLE}" ]]; then
    echo "Existing scheduler invocation access could not be removed before build." >&2
    exit 1
  fi
fi

if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" --repository-format=docker \
    --location="${REGION}" --project="${PROJECT_ID}" \
    --description="Vitruvius protected worker images" --immutable-tags >/dev/null
else
  gcloud artifacts repositories update "${REPOSITORY}" --location="${REGION}" \
    --project="${PROJECT_ID}" --immutable-tags >/dev/null
fi

REPOSITORY_IMMUTABLE_TAGS="$(
  gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" \
    --project="${PROJECT_ID}" --format='value(dockerConfig.immutableTags)'
)"
case "${REPOSITORY_IMMUTABLE_TAGS}" in
  true|True|TRUE) ;;
  *)
    echo "Artifact repository does not enforce immutable Docker tags: ${REPOSITORY}" >&2
    exit 1
    ;;
esac

for account in ecos-indexer-runtime ecos-indexer-scheduler; do
  if ! gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${account}" --project="${PROJECT_ID}" \
      --display-name="${account}" >/dev/null
  fi
done

for index in "${!BOUND_SECRET_NAMES[@]}"; do
  secret="${BOUND_SECRET_NAMES[${index}]}"
  version="${BOUND_SECRET_VERSIONS[${index}]}"
  if ! gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Required bound secret is not configured: ${secret}" >&2
    exit 1
  fi
  SECRET_VERSION_STATE="$(
    gcloud secrets versions describe "${version}" --secret="${secret}" \
      --project="${PROJECT_ID}" --format='value(state)'
  )"
  if [[ "${SECRET_VERSION_STATE}" != "ENABLED" ]]; then
    echo "Required bound secret version is not enabled: ${secret}:${version}" >&2
    exit 1
  fi
  gcloud secrets add-iam-policy-binding "${secret}" --project="${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_ACCOUNT}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

gcloud builds submit workers/ecos-indexer --project="${PROJECT_ID}" --tag="${IMAGE}"

IMAGE_DIGEST="$(
  gcloud artifacts docker images describe "${IMAGE}" --project="${PROJECT_ID}" \
    --format='value(image_summary.fully_qualified_digest)'
)"
if [[ "${IMAGE_DIGEST}" != "${IMAGE_REPOSITORY}@sha256:"* ]]; then
  echo "Cloud Build output did not resolve inside the expected worker repository." >&2
  exit 1
fi
IMAGE_SHA256="${IMAGE_DIGEST#"${IMAGE_REPOSITORY}@sha256:"}"
if [[ ! "${IMAGE_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Cloud Build output did not resolve to a valid SHA-256 image digest." >&2
  exit 1
fi

gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --image="${IMAGE_DIGEST}" \
  --service-account="${RUNTIME_ACCOUNT}" --tasks=1 --parallelism=1 \
  --cpu=2 --memory=4Gi --task-timeout=60m --max-retries=1 \
  --set-secrets="${SECRET_BINDINGS}" \
  --set-env-vars="ECOS_WORKER_RUN_MODE=batch,ECOS_WORKER_LEASE_SECONDS=1800,ECOS_MAX_JOBS_PER_RUN=8,ECOS_MAX_RUN_SECONDS=3300,ECOS_MAX_SOURCE_BYTES=262144000,ECOS_MAX_SOURCE_PAGES=500,ECOS_MAX_OCR_TILES_PER_PAGE=128,ECOS_PAGE_TIMEOUT_SECONDS=600,ECOS_REQUIRE_MALWARE_SCAN=true,ECOS_MALWARE_SCAN_TIMEOUT_SECONDS=300,ECOS_VISUAL_ESTIMATED_COST_MICROUSD=500"

DEPLOYED_JOB_JSON="$(
  gcloud run jobs describe "${JOB_NAME}" --project="${PROJECT_ID}" --region="${REGION}" \
    --format=json
)"
ECOS_DEPLOYED_JOB_JSON="${DEPLOYED_JOB_JSON}" \
ECOS_EXPECTED_IMAGE="${IMAGE_DIGEST}" \
ECOS_EXPECTED_SECRET_BINDINGS="${SECRET_BINDINGS}" \
node -e '
  const job = JSON.parse(process.env.ECOS_DEPLOYED_JOB_JSON || "null");
  const container = job?.spec?.template?.spec?.template?.spec?.containers?.[0];
  if (container?.image !== process.env.ECOS_EXPECTED_IMAGE) {
    console.error("Cloud Run image digest verification failed; refusing to continue deployment setup.");
    process.exit(1);
  }
  const actual = Object.fromEntries((container.env || []).flatMap(row => {
    const ref = row?.valueFrom?.secretKeyRef || row?.valueSource?.secretKeyRef;
    const secret = String(ref?.name || ref?.secret || "");
    const version = String(ref?.key || ref?.version || "");
    return secret && version ? [[row.name, `${secret}:${version}`]] : [];
  }));
  const expected = Object.fromEntries(
    String(process.env.ECOS_EXPECTED_SECRET_BINDINGS || "").split(",").map(binding => {
      const equals = binding.indexOf("=");
      return [binding.slice(0, equals), binding.slice(equals + 1)];
    }),
  );
  if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort())) {
    console.error("Cloud Run secret binding verification failed; refusing to continue deployment setup.");
    process.exit(1);
  }
'

if [[ "${SCHEDULER_EXISTS}" != "true" ]]; then
  gcloud scheduler jobs create http "${SCHEDULE_NAME}" --location="${REGION}" --project="${PROJECT_ID}" \
    --schedule="${HELD_SCHEDULE}" --time-zone='UTC' --uri="${RUN_URI}" --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_ACCOUNT}" >/dev/null
  gcloud scheduler jobs pause "${SCHEDULE_NAME}" --location="${REGION}" \
    --project="${PROJECT_ID}" >/dev/null
fi

PRE_UPDATE_SCHEDULER_STATE="$(read_scheduler_state)"
if [[ "${PRE_UPDATE_SCHEDULER_STATE}" != "PAUSED" ]]; then
  echo "Scheduler was not paused before configuration update; refusing to grant invocation access." >&2
  exit 1
fi

gcloud scheduler jobs update http "${SCHEDULE_NAME}" --location="${REGION}" --project="${PROJECT_ID}" \
  --schedule='* * * * *' --time-zone='UTC' --uri="${RUN_URI}" --http-method=POST \
  --oauth-service-account-email="${SCHEDULER_ACCOUNT}" >/dev/null

SCHEDULER_STATE="$(read_scheduler_state)"
if [[ "${SCHEDULER_STATE}" != "PAUSED" ]]; then
  echo "Scheduler did not remain paused after configuration update; refusing to grant invocation access." >&2
  exit 1
fi

gcloud run jobs add-iam-policy-binding "${JOB_NAME}" --project="${PROJECT_ID}" \
  --region="${REGION}" --member="serviceAccount:${SCHEDULER_ACCOUNT}" \
  --role=roles/run.invoker >/dev/null

if [[ "${ECOS_EXECUTE_AFTER_DEPLOY:-false}" == "true" ]]; then
  gcloud run jobs execute "${JOB_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --wait
fi

echo "ECOS hosted indexer deployed in ${REGION} with shadow publication controls."
