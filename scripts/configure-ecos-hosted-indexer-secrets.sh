#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${ECOS_GCP_PROJECT_ID:-vitruvius-project-intelligence}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required protected value: ${name}" >&2
    exit 1
  fi
}

put_secret() {
  local name="$1"
  local value="$2"
  if ! gcloud secrets describe "${name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${name}" --project="${PROJECT_ID}" --replication-policy=automatic >/dev/null
  fi
  printf '%s' "${value}" | gcloud secrets versions add "${name}" \
    --project="${PROJECT_ID}" --data-file=- >/dev/null
}

require_value SUPABASE_URL
require_value SUPABASE_SERVICE_ROLE_KEY
require_value ECOS_OPENAI_API_KEY

gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}" >/dev/null
put_secret ecos-supabase-url "${SUPABASE_URL}"
put_secret ecos-supabase-service-role-key "${SUPABASE_SERVICE_ROLE_KEY}"
put_secret ecos-openai-api-key "${ECOS_OPENAI_API_KEY}"

if [[ -n "${ECOS_VISUAL_PROVIDER_URL:-}" || -n "${ECOS_SERVICE_WORKER_TOKEN:-}" ]]; then
  require_value ECOS_VISUAL_PROVIDER_URL
  require_value ECOS_SERVICE_WORKER_TOKEN
  require_value SUPABASE_PROJECT_REF
  put_secret ecos-visual-provider-url "${ECOS_VISUAL_PROVIDER_URL}"
  put_secret ecos-service-worker-token "${ECOS_SERVICE_WORKER_TOKEN}"
  npx supabase secrets set --project-ref "${SUPABASE_PROJECT_REF}" \
    "ECOS_SERVICE_WORKER_TOKEN=${ECOS_SERVICE_WORKER_TOKEN}" >/dev/null
fi

echo "Protected hosted-indexer secrets were updated in Google Secret Manager."
