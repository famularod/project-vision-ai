#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${ECOS_GCP_PROJECT_ID:-vitruvius-project-intelligence}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
VERSION_OUTPUT="${ECOS_HOSTED_SECRET_VERSION_OUTPUT:-}"

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
  local version_resource
  local version
  if ! gcloud secrets describe "${name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${name}" --project="${PROJECT_ID}" --replication-policy=automatic >/dev/null
  fi
  version_resource="$(
    printf '%s' "${value}" | gcloud secrets versions add "${name}" \
      --project="${PROJECT_ID}" --data-file=- --format='value(name)'
  )"
  version="${version_resource##*/}"
  if [[ ! "${version}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Secret Manager did not return one immutable numeric version for ${name}." >&2
    exit 1
  fi
  printf '%s' "${version}"
}

require_value SUPABASE_URL
require_value SUPABASE_SERVICE_ROLE_KEY

gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}" >/dev/null
SUPABASE_URL_VERSION="$(put_secret ecos-supabase-url "${SUPABASE_URL}")"
SUPABASE_SERVICE_ROLE_KEY_VERSION="$(
  put_secret ecos-supabase-service-role-key "${SUPABASE_SERVICE_ROLE_KEY}"
)"
VISUAL_PROVIDER_ENABLED=false
VISUAL_PROVIDER_URL_VERSION=''
SERVICE_WORKER_TOKEN_VERSION=''

if [[ -n "${ECOS_VISUAL_PROVIDER_URL:-}" || -n "${ECOS_SERVICE_WORKER_TOKEN:-}" ]]; then
  require_value ECOS_VISUAL_PROVIDER_URL
  require_value ECOS_SERVICE_WORKER_TOKEN
  require_value SUPABASE_PROJECT_REF
  VISUAL_PROVIDER_ENABLED=true
  VISUAL_PROVIDER_URL_VERSION="$(
    put_secret ecos-visual-provider-url "${ECOS_VISUAL_PROVIDER_URL}"
  )"
  SERVICE_WORKER_TOKEN_VERSION="$(
    put_secret ecos-service-worker-token "${ECOS_SERVICE_WORKER_TOKEN}"
  )"
  npx supabase secrets set --project-ref "${SUPABASE_PROJECT_REF}" \
    "ECOS_SERVICE_WORKER_TOKEN=${ECOS_SERVICE_WORKER_TOKEN}" >/dev/null
fi

write_version_manifest() {
  printf 'ECOS_SUPABASE_URL_SECRET_VERSION=%s\n' "${SUPABASE_URL_VERSION}"
  printf 'ECOS_SUPABASE_SERVICE_ROLE_KEY_SECRET_VERSION=%s\n' \
    "${SUPABASE_SERVICE_ROLE_KEY_VERSION}"
  printf 'ECOS_VISUAL_PROVIDER_ENABLED=%s\n' "${VISUAL_PROVIDER_ENABLED}"
  if [[ "${VISUAL_PROVIDER_ENABLED}" == "true" ]]; then
    printf 'ECOS_VISUAL_PROVIDER_URL_SECRET_VERSION=%s\n' \
      "${VISUAL_PROVIDER_URL_VERSION}"
    printf 'ECOS_SERVICE_WORKER_TOKEN_SECRET_VERSION=%s\n' \
      "${SERVICE_WORKER_TOKEN_VERSION}"
  fi
}

if [[ -n "${VERSION_OUTPUT}" ]]; then
  VERSION_DIRECTORY="$(dirname "${VERSION_OUTPUT}")"
  mkdir -p "${VERSION_DIRECTORY}"
  VERSION_TEMPORARY="$(mktemp "${VERSION_OUTPUT}.tmp.XXXXXX")"
  chmod 0600 "${VERSION_TEMPORARY}"
  write_version_manifest > "${VERSION_TEMPORARY}"
  mv "${VERSION_TEMPORARY}" "${VERSION_OUTPUT}"
  echo "Protected hosted-indexer secrets were updated; exact version manifest: ${VERSION_OUTPUT}"
else
  echo "Protected hosted-indexer secrets were updated; capture these exact version inputs:"
  write_version_manifest
fi
