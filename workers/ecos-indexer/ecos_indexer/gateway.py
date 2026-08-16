from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import quote
from uuid import UUID

import requests

from .models import HostedJob


DEFAULT_RPC_READ_TIMEOUT_SECONDS = 180
PAGE_CHECKPOINT_RPC_READ_TIMEOUT_SECONDS = 330


class SupabaseWorkerGateway:
    def __init__(self) -> None:
        self.base_url = os.environ["SUPABASE_URL"].rstrip("/")
        self.service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
        self.max_source_bytes = max(
            1_048_576,
            min(1_073_741_824, int(os.getenv("ECOS_MAX_SOURCE_BYTES", str(250 * 1024 * 1024)))),
        )
        self.headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        self.lease_seconds = max(300, min(3600, int(os.getenv("ECOS_WORKER_LEASE_SECONDS", "1800"))))
        self.visual_estimated_cost_microusd = max(
            0,
            min(10_000_000, int(os.getenv("ECOS_VISUAL_ESTIMATED_COST_MICROUSD", "500"))),
        )

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        # Dense issued-drawing pages can legitimately take longer than the
        # default Data API window while PostgreSQL is completing a storage
        # checkpoint.  The protected page RPC has its own bounded 300-second
        # database statement limit; allow a small transport margin without
        # weakening timeouts for any other operation.
        read_timeout_seconds = (
            PAGE_CHECKPOINT_RPC_READ_TIMEOUT_SECONDS
            if name == "ecos_checkpoint_hosted_index_page"
            else DEFAULT_RPC_READ_TIMEOUT_SECONDS
        )
        response = requests.post(
            f"{self.base_url}/rest/v1/rpc/{quote(name, safe='')}",
            headers=self.headers,
            json=sanitize_database_json(payload),
            timeout=(10, read_timeout_seconds),
        )
        if response.status_code >= 400:
            raise ProtectedGatewayError(
                f"RPC {name} returned HTTP {response.status_code}: {bounded_error_code(response)}"
            )
        return response.json() if response.content else None

    def claim(
        self,
        worker_id: str,
        *,
        target_job_id: str | None = None,
        target_source_sha256: str | None = None,
        expected_mode: str | None = None,
        expected_evidence_version: str | None = None,
    ) -> HostedJob | None:
        exact_values = (
            target_job_id,
            target_source_sha256,
            expected_mode,
            expected_evidence_version,
        )
        if any(value is not None for value in exact_values):
            if not all(isinstance(value, str) and value.strip() for value in exact_values):
                raise ProtectedGatewayError("Exact target claim contract is incomplete")
            try:
                canonical_job_id = str(UUID(str(target_job_id).strip()))
            except (AttributeError, TypeError, ValueError) as error:
                raise ProtectedGatewayError("Exact target job id is invalid") from error
            canonical_source_sha256 = str(target_source_sha256).strip().lower()
            if not re.fullmatch(r"[a-f0-9]{64}", canonical_source_sha256):
                raise ProtectedGatewayError("Exact target source checksum is invalid")
            if str(expected_mode).strip().lower() != "shadow":
                raise ProtectedGatewayError("Exact target mode must be shadow")
            canonical_evidence_version = str(expected_evidence_version).strip()
            if canonical_evidence_version != "ecos-hosted-evidence/1.3":
                raise ProtectedGatewayError("Exact target evidence contract is unsupported")
            records = self.rpc("ecos_claim_exact_hosted_index_job", {
                "p_worker_id": worker_id,
                "p_job_id": canonical_job_id,
                "p_expected_source_sha256": canonical_source_sha256,
                "p_expected_mode": "shadow",
                "p_expected_evidence_version": canonical_evidence_version,
                "p_lease_seconds": self.lease_seconds,
            })
        else:
            records = self.rpc("ecos_claim_hosted_index_job", {
                "p_worker_id": worker_id,
                "p_lease_seconds": self.lease_seconds,
            })
        if not isinstance(records, list) or not records:
            return None
        return HostedJob.from_record(records[0])

    def record_source_scan(self, job: HostedJob, *, status: str, engine: str, byte_count: int) -> None:
        self.rpc("ecos_record_hosted_source_scan", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_scan_status": status,
            "p_scan_engine": engine,
            "p_source_byte_count": max(0, byte_count),
        })

    def record_usage(
        self,
        job: HostedJob,
        *,
        event_type: str,
        idempotency_key: str,
        quantity: int = 1,
        duration_ms: int = 0,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.rpc("ecos_record_hosted_index_usage", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_event_type": event_type,
            "p_idempotency_key": idempotency_key,
            "p_quantity": max(0, quantity),
            "p_duration_ms": max(0, duration_ms),
            "p_details": details or {},
        })

    def reserve_visual_region(
        self,
        job: HostedJob,
        *,
        page_number: int,
        region_key: str,
        evidence_version: str,
        exception_fingerprint: str,
    ) -> bool:
        result = self.rpc("ecos_reserve_hosted_visual_region_v2", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_page_number": page_number,
            "p_region_key": region_key,
            "p_evidence_version": evidence_version,
            "p_exception_fingerprint": exception_fingerprint,
            "p_estimated_cost_microusd": self.visual_estimated_cost_microusd,
        })
        return result is True

    def resolved_visual_regions(
        self, job: HostedJob, *, page_number: int,
    ) -> dict[str, dict[str, Any]]:
        """Load previously assured visual evidence for an exact retry page.

        The service-role query is job- and page-scoped. Evidence-version resets
        delete these rows before a new extraction algorithm can run, so a retry
        can only reuse a resolution from the current exact job/source cycle.
        """
        response = requests.get(
            f"{self.base_url}/rest/v1/ecos_hosted_visual_exceptions",
            headers=self.headers,
            params={
                "job_id": f"eq.{job.job_id}",
                "page_number": f"eq.{page_number}",
                "state": "eq.resolved",
                "select": (
                    "region_key,bounds,evidence_version,exception_fingerprint,"
                    "normalized_evidence,assurance_result"
                ),
            },
            timeout=(10, 60),
        )
        response.raise_for_status()
        rows = response.json() if response.content else []
        return {
            str(row["region_key"]): row
            for row in rows
            if isinstance(row, dict) and str(row.get("region_key") or "").strip()
        }

    def upsert_visual_exception(
        self,
        job: HostedJob,
        *,
        page_number: int,
        exception: dict[str, Any],
        evidence_version: str,
        exception_fingerprint: str,
    ) -> bool:
        result = self.rpc("ecos_upsert_hosted_visual_exception_v2", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_page_number": page_number,
            "p_region_key": str(exception.get("regionKey") or ""),
            "p_bounds": exception.get("bounds") or {},
            "p_reason": str(exception.get("reason") or ""),
            "p_evidence_version": evidence_version,
            "p_exception_fingerprint": exception_fingerprint,
        })
        return result is True

    def resolve_visual_exception(
        self,
        job: HostedJob,
        *,
        page_number: int,
        exception: dict[str, Any],
        evidence_version: str,
        exception_fingerprint: str,
        normalized_evidence: dict[str, Any],
        assurance_result: dict[str, Any],
    ) -> bool:
        result = self.rpc("ecos_resolve_hosted_visual_exception_v2", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_page_number": page_number,
            "p_region_key": str(exception.get("regionKey") or ""),
            "p_bounds": exception.get("bounds") or {},
            "p_reason": str(exception.get("reason") or ""),
            "p_evidence_version": evidence_version,
            "p_exception_fingerprint": exception_fingerprint,
            "p_normalized_evidence": normalized_evidence,
            "p_assurance_result": assurance_result,
        })
        return result is True

    def dismiss_visual_exception(
        self,
        job: HostedJob,
        *,
        page_number: int,
        exception: dict[str, Any],
        evidence_version: str,
        exception_fingerprint: str,
        normalized_dismissal: dict[str, Any],
        assurance_result: dict[str, Any],
    ) -> bool:
        result = self.rpc("ecos_dismiss_hosted_visual_exception_v1", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_page_number": page_number,
            "p_region_key": str(exception.get("regionKey") or ""),
            "p_bounds": exception.get("bounds") or {},
            "p_reason": str(exception.get("reason") or ""),
            "p_evidence_version": evidence_version,
            "p_exception_fingerprint": exception_fingerprint,
            "p_normalized_dismissal": normalized_dismissal,
            "p_assurance_result": assurance_result,
        })
        return result is True

    def extend_lease(self, job: HostedJob) -> None:
        self.rpc("ecos_extend_hosted_index_lease", {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_lease_seconds": self.lease_seconds,
        })

    def cleanup_operations(self) -> None:
        self.rpc("ecos_cleanup_hosted_index_operations", {})

    def download_source(self, job: HostedJob) -> bytes:
        gcs_bucket = str(job.source_locator.get("gcsBucket") or "").strip()
        gcs_object = str(job.source_locator.get("gcsObject") or "").strip()
        if gcs_bucket and gcs_object:
            return self._download_gcs_source(gcs_bucket, gcs_object)
        bucket = str(job.source_locator.get("bucket") or "").strip()
        path = str(job.source_locator.get("path") or "").strip()
        if not bucket or not path:
            raise SourceReconnectRequired("A durable managed source is not available")
        response = requests.get(
            f"{self.base_url}/storage/v1/object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
            headers={"apikey": self.service_key, "Authorization": f"Bearer {self.service_key}"},
            timeout=(10, 180),
            stream=True,
        )
        if response.status_code in {401, 403, 404}:
            raise SourceReconnectRequired("Managed source could not be read")
        response.raise_for_status()
        return self._bounded_response_bytes(response)

    def _download_gcs_source(self, bucket: str, object_name: str) -> bytes:
        token_response = requests.get(
            "http://metadata.google.internal/computeMetadata/v1/instance/"
            "service-accounts/default/token",
            headers={"Metadata-Flavor": "Google"},
            timeout=(2, 10),
        )
        if token_response.status_code in {401, 403, 404}:
            raise SourceReconnectRequired("Managed staging credentials are unavailable")
        token_response.raise_for_status()
        access_token = str(token_response.json().get("access_token") or "").strip()
        if not access_token:
            raise SourceReconnectRequired("Managed staging credentials are unavailable")
        response = requests.get(
            f"https://storage.googleapis.com/download/storage/v1/b/{quote(bucket, safe='')}/"
            f"o/{quote(object_name, safe='')}?alt=media",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=(10, 180),
            stream=True,
        )
        if response.status_code in {401, 403, 404}:
            raise SourceReconnectRequired("Managed staging source could not be read")
        response.raise_for_status()
        return self._bounded_response_bytes(response)

    def _bounded_response_bytes(self, response: requests.Response) -> bytes:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > self.max_source_bytes:
            raise SourceRejected("Managed source exceeds the hosted processing limit")
        payload = bytearray()
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            payload.extend(chunk)
            if len(payload) > self.max_source_bytes:
                raise SourceRejected("Managed source exceeds the hosted processing limit")
        return bytes(payload)

    def completed_pages(self, job: HostedJob) -> set[int]:
        response = requests.get(
            f"{self.base_url}/rest/v1/ecos_hosted_index_pages",
            headers=self.headers,
            params={
                "job_id": f"eq.{job.job_id}",
                "state": "eq.assured",
                "select": "page_number",
            },
            timeout=(10, 60),
        )
        response.raise_for_status()
        rows = response.json() if response.content else []
        return {int(row["page_number"]) for row in rows if isinstance(row, dict) and row.get("page_number")}

    def page_checkpoint(self, job: HostedJob, *, page_number: int) -> dict[str, Any] | None:
        """Read an unfinished, source-bound page checkpoint for tile resume.

        Only the protected worker can call this gateway. The extraction layer
        independently validates every proof against the current source, page,
        evidence version, and exact tile bounds before reusing it.
        """
        response = requests.get(
            f"{self.base_url}/rest/v1/ecos_hosted_index_pages",
            headers=self.headers,
            params={
                "job_id": f"eq.{job.job_id}",
                "page_number": f"eq.{page_number}",
                "source_sha256": f"eq.{job.source_sha256}",
                "select": "state,ocr_page_data,final_page_data",
                "limit": "1",
            },
            timeout=(10, 60),
        )
        response.raise_for_status()
        rows = response.json() if response.content else []
        row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
        return row


class SourceReconnectRequired(RuntimeError):
    pass


class SourceRejected(RuntimeError):
    pass


class ProtectedGatewayError(RuntimeError):
    pass


def sanitize_database_json(value: Any) -> Any:
    """Remove Unicode values PostgreSQL JSONB cannot represent.

    PDF text extraction can preserve embedded NULs or lone UTF-16 surrogate
    code points. Neither is visible drawing evidence, and PostgreSQL rejects
    them before a page checkpoint can be stored. Sanitize only at the durable
    RPC boundary so extraction and Assurance otherwise receive the original
    text and geometry.
    """
    if isinstance(value, str):
        without_nul = value.replace("\x00", "")
        return without_nul.encode("utf-8", errors="replace").decode("utf-8")
    if isinstance(value, dict):
        return {
            sanitize_database_json(key): sanitize_database_json(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_database_json(item) for item in value]
    return value


def bounded_error_code(response: requests.Response) -> str:
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return "unstructured_gateway_error"
    if not isinstance(payload, dict):
        return "unstructured_gateway_error"
    code = str(payload.get("code") or "gateway_error").strip()[:80]
    message = str(payload.get("message") or payload.get("error") or "request_rejected").strip()[:300]
    return f"{code}: {message}"
