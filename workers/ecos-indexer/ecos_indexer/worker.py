from __future__ import annotations

import hashlib
import json
import math
import os
import re
import signal
import socket
import time
from contextlib import contextmanager
from dataclasses import replace
from typing import Any
from uuid import UUID

from . import EVIDENCE_VERSION
from .assurance import assure_page
from .document_structure import document_sheet_identity_map
from .extraction import (
    DocumentResourceRejected,
    EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE,
    VisualTileAnalysisFailed,
    extract_page,
    open_pdf,
)
from .gateway import (
    SourceReconnectRequired,
    SourceRejected,
    SupabaseWorkerGateway,
    sanitize_database_json,
)
from .models import HostedJob
from .page_source_excerpts import extract_page_source_excerpts
from .page_source_excerpts_bridge import (
    PAGE_EXCERPTS_RPC,
    PAGE_EXCERPT_HEADS_RPC,
    shadow_native_excerpts_enabled,
    validate_page_excerpt_heads,
    validate_page_excerpts_receipt,
)
from .page_table_sources import extract_page_table_sources
from .page_table_sources_bridge import (
    PAGE_TABLE_SOURCES_RPC,
    PAGE_TABLE_SOURCE_HEADS_RPC,
    page_table_source_counts,
    shadow_native_tables_enabled,
    validate_page_table_source_heads,
    validate_page_table_sources_receipt,
)
from .source_accountability import (
    SNAPSHOT_RPC,
    SourceAccountabilityError,
    shadow_accountability_enabled,
    snapshot_payload,
    validate_snapshot_receipt,
)
from .table_source_manifest_bridge import (
    TABLE_SOURCE_MANIFEST_SNAPSHOT_RPC,
    table_source_manifest_payload,
    validate_table_source_manifest,
)
from .security import (
    SourceScanOperationalError,
    SourceScanResult,
    SourceSecurityRejected,
    scan_pdf_source,
)
from .visual import (
    BoundedVisualResolver,
    MIN_ASSURED_VISUAL_CONFIDENCE,
    VISUAL_DISMISSAL_TYPE,
    VISUAL_SCHEMA_VERSION,
    validated_persisted_visual_evidence,
    validated_persisted_visual_dismissal,
    visual_exception_fingerprint,
    visual_exception_is_fact_resolvable,
)


# Keep page checkpoint requests below the hosted Data API boundary with
# material headroom. Intermediate visual OCR can be resumed from the last
# bounded snapshot. The final checkpoint retains authoritative page regions,
# exact visual proofs, structured analysis, rejected OCR, plus stable hashes
# and counts for duplicate OCR diagnostics omitted from the request.
MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES = 8 * 1024 * 1024


def hosted_page_checkpoint_request_bytes(payload: dict[str, Any]) -> int:
    """Return the exact JSON byte count used by the requests gateway."""

    try:
        encoded = json.dumps(
            sanitize_database_json(payload),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise DocumentResourceRejected("hosted_page_checkpoint_json_invalid") from error
    return len(encoded)


def hosted_checkpoint_diagnostic_sha256(value: Any) -> str:
    """Fingerprint one sanitized diagnostic value before omitting a duplicate."""

    try:
        encoded = json.dumps(
            sanitize_database_json(value),
            ensure_ascii=True,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise DocumentResourceRejected("hosted_page_checkpoint_json_invalid") from error
    return hashlib.sha256(encoded).hexdigest()


def final_page_checkpoint_payload(
    job: HostedJob,
    *,
    page_number: int,
    result: dict[str, Any],
    assurance: dict[str, Any],
    unresolved_region_count: int,
) -> dict[str, Any]:
    """Build one bounded durable checkpoint without changing extraction data."""

    ocr_page_data = result.get("ocr")
    if not isinstance(ocr_page_data, dict):
        raise DocumentResourceRejected("hosted_page_checkpoint_ocr_invalid")
    raw_visual_regions = ocr_page_data.get("visualTileRegions")
    if not isinstance(raw_visual_regions, list):
        raise DocumentResourceRejected("hosted_page_checkpoint_visual_regions_invalid")
    trusted_ocr_regions = ocr_page_data.get("regions")
    if not isinstance(trusted_ocr_regions, list):
        raise DocumentResourceRejected("hosted_page_checkpoint_ocr_regions_invalid")
    visual_tile_proofs = ocr_page_data.get("visualTileProofs")
    if not isinstance(visual_tile_proofs, list):
        raise DocumentResourceRejected("hosted_page_checkpoint_visual_proofs_invalid")
    structured_table_analysis = ocr_page_data.get("structuredTableAnalysis")
    if structured_table_analysis is not None and not isinstance(
        structured_table_analysis, dict,
    ):
        raise DocumentResourceRejected("hosted_page_checkpoint_structured_tables_invalid")

    # A shallow copy is sufficient because only top-level duplicate diagnostic
    # fields are changed. The authoritative final page retains its complete
    # regions, visualCoverage proofs, and structuredTableAnalysis. Raw rejected
    # candidates remain in OCR data for audit. Counts and stable hashes bind the
    # omitted copies without making dense pages exceed the Data API boundary.
    durable_ocr_page_data = dict(ocr_page_data)
    for key in (
        "regions",
        "visualTileRegions",
        "visualTileProofs",
        "structuredTableAnalysis",
        "legacyStructuredTableAnalysis",
    ):
        durable_ocr_page_data.pop(key, None)
    durable_ocr_page_data["ocrRegionCount"] = len(trusted_ocr_regions)
    durable_ocr_page_data["ocrRegionsSha256"] = hosted_checkpoint_diagnostic_sha256(
        trusted_ocr_regions,
    )
    durable_ocr_page_data["visualTileRegionCount"] = len(raw_visual_regions)
    durable_ocr_page_data["visualTileRegionsSha256"] = hosted_checkpoint_diagnostic_sha256(
        raw_visual_regions,
    )
    durable_ocr_page_data["visualTileProofCount"] = len(visual_tile_proofs)
    durable_ocr_page_data["visualTileProofsSha256"] = hosted_checkpoint_diagnostic_sha256(
        visual_tile_proofs,
    )
    durable_ocr_page_data["structuredTableAnalysisSha256"] = (
        hosted_checkpoint_diagnostic_sha256(structured_table_analysis)
    )
    payload = {
        "p_job_id": job.job_id,
        "p_claim_token": job.claim_token,
        "p_page_number": page_number,
        "p_state": (
            "assured" if assurance.get("accepted") is True
            else "awaiting_visual" if unresolved_region_count > 0
            else "rejected"
        ),
        "p_native_page_data": result["native"],
        "p_ocr_page_data": durable_ocr_page_data,
        "p_deterministic_page_data": result["deterministic"],
        "p_final_page_data": result["final"],
        "p_assurance_result": assurance,
        "p_unresolved_region_count": unresolved_region_count,
    }
    if hosted_page_checkpoint_request_bytes(payload) > MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES:
        raise DocumentResourceRejected("hosted_page_checkpoint_request_too_large")
    return payload


class HostedIndexerWorker:
    def __init__(self) -> None:
        self.gateway = SupabaseWorkerGateway()
        self.worker_id = os.getenv("ECOS_WORKER_ID", f"ecos-indexer-{socket.gethostname()}").strip()
        self.exact_target = exact_target_from_environment()
        self.v2_shadow_accountability = shadow_accountability_enabled(os.environ)
        self.v2_shadow_native_excerpts = shadow_native_excerpts_enabled(os.environ)
        self.v2_shadow_native_tables = shadow_native_tables_enabled(os.environ)
        if self.v2_shadow_accountability and self.exact_target is None:
            raise ValueError("V2 shadow accountability requires an exact controlled target")
        if self.v2_shadow_native_excerpts and not self.v2_shadow_accountability:
            raise ValueError("V2 native excerpts require shadow source accountability")
        if self.v2_shadow_native_tables and not self.v2_shadow_native_excerpts:
            raise ValueError("V2 native tables require native excerpts and source accountability")
        self.poll_seconds = max(2, min(60, int(os.getenv("ECOS_WORKER_POLL_SECONDS", "10"))))
        self.max_jobs_per_run = max(1, min(100, int(os.getenv("ECOS_MAX_JOBS_PER_RUN", "8"))))
        self.max_run_seconds = max(60, min(3500, int(os.getenv("ECOS_MAX_RUN_SECONDS", "3300"))))
        self.page_timeout_seconds = max(
            60,
            min(1800, int(os.getenv("ECOS_PAGE_TIMEOUT_SECONDS", "600"))),
        )
        self.visual = BoundedVisualResolver()

    def run_forever(self) -> None:
        while True:
            job = self.claim_next_job()
            if not job:
                time.sleep(self.poll_seconds)
                continue
            self.process(job)

    def run_batch(self) -> None:
        started_at = time.monotonic()
        self.run_deadline_monotonic = started_at + self.max_run_seconds
        processed = 0
        while processed < self.max_jobs_per_run and time.monotonic() - started_at < self.max_run_seconds:
            job = self.claim_next_job()
            if not job:
                break
            self.process(job)
            processed += 1
        # Controlled exact-target validation must not perform a global
        # maintenance mutation after its one bounded claim. Ordinary production
        # batches retain the existing cleanup behavior.
        if self.exact_target is None:
            try:
                self.gateway.cleanup_operations()
            except Exception:
                pass
        print(json.dumps({
            "event": "ecos_hosted_index_batch_finished",
            "jobsProcessed": processed,
            "elapsedSeconds": round(time.monotonic() - started_at, 3),
        }), flush=True)

    def claim_next_job(self) -> HostedJob | None:
        if self.exact_target is None:
            return self.gateway.claim(self.worker_id)
        target_job_id, target_source_sha256 = self.exact_target
        return self.gateway.claim(
            self.worker_id,
            target_job_id=target_job_id,
            target_source_sha256=target_source_sha256,
            expected_mode="shadow",
            expected_evidence_version=EVIDENCE_VERSION,
        )

    def checkpoint_final_page(
        self,
        job: HostedJob,
        *,
        page_number: int,
        result: dict[str, Any],
        assurance: dict[str, Any],
        unresolved_region_count: int,
    ) -> None:
        payload = final_page_checkpoint_payload(
            job,
            page_number=page_number,
            result=result,
            assurance=assurance,
            unresolved_region_count=unresolved_region_count,
        )
        self.gateway.rpc("ecos_checkpoint_hosted_index_page", payload)

    def checkpoint_visual_tile_page(
        self,
        job: HostedJob,
        *,
        page_number: int,
        source_sha256: str,
        visual_tile_checkpoint: dict[str, Any],
    ) -> bool:
        """Persist a resumable tile snapshot only while its request is bounded.

        Dense drawing pages can produce enough raw coordinate OCR for a late
        intermediate snapshot to exceed the hosted Data API boundary.  The
        extraction already retains the full current snapshot in memory, so it
        is safer to keep the last smaller durable snapshot and recompute only
        the remaining tiles after an interruption than to submit an oversized
        request.  The compact final page checkpoint remains mandatory.
        """

        proofs = visual_tile_checkpoint.get("completedDeepReadRegionProofs")
        proof_list = proofs if isinstance(proofs, list) else []
        completed_keys = [
            str(proof.get("tileKey") or "")
            for proof in proof_list
            if isinstance(proof, dict)
        ]
        payload = {
            "p_job_id": job.job_id,
            "p_claim_token": job.claim_token,
            "p_page_number": page_number,
            "p_state": "extracted",
            "p_native_page_data": {},
            "p_ocr_page_data": {"visualTileCheckpoint": visual_tile_checkpoint},
            "p_deterministic_page_data": {},
            "p_final_page_data": {
                "pageNumber": page_number,
                "sourceSha256": source_sha256,
                "visualCoverage": {
                    "schemaVersion": visual_tile_checkpoint.get("schemaVersion"),
                    "evidenceVersion": visual_tile_checkpoint.get("evidenceVersion"),
                    "sourceSha256": source_sha256,
                    "pageNumber": page_number,
                    "overviewAnalyzed": False,
                    "requestedDeepReadRegionCount": 6,
                    "completedDeepReadRegionCount": len(completed_keys),
                    "coverageComplete": False,
                    "completedDeepReadRegionKeys": completed_keys,
                    "completedDeepReadRegionProofs": proof_list,
                    "failureCodes": ["visual_coverage_incomplete"],
                },
            },
            "p_assurance_result": {
                "accepted": False,
                "failureCodes": ["visual_coverage_incomplete"],
            },
            "p_unresolved_region_count": 0,
        }
        request_bytes = hosted_page_checkpoint_request_bytes(payload)
        if request_bytes > MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES:
            log_event(
                "ecos_hosted_visual_tile_checkpoint_skipped_oversize",
                jobId=job.job_id,
                documentId=job.document_id,
                pageNumber=page_number,
                completedTileCount=len(completed_keys),
                requestBytes=request_bytes,
                requestLimitBytes=MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES,
            )
            return False
        self.gateway.rpc("ecos_checkpoint_hosted_index_page", payload)
        return True

    def scan_source(self, job: HostedJob, source: bytes) -> SourceScanResult:
        """Record one fail-closed scanner verdict with bounded diagnostics."""

        started_at = time.monotonic()
        try:
            scan = scan_pdf_source(source)
        except (SourceSecurityRejected, SourceScanOperationalError) as error:
            elapsed_seconds = round(time.monotonic() - started_at, 3)
            status = "rejected" if isinstance(error, SourceSecurityRejected) else "failed"
            try:
                self.gateway.record_source_scan(
                    job,
                    status=status,
                    engine=error.engine,
                    byte_count=len(source),
                )
            except Exception as audit_error:
                log_event(
                    "ecos_hosted_source_scan_audit_failed",
                    jobId=job.job_id,
                    documentId=job.document_id,
                    scanStatus=status,
                    engine=error.engine,
                    reason="source_scan_audit_persistence_failed",
                    errorType=type(audit_error).__name__[:120],
                )
            log_event(
                "ecos_hosted_source_scan_completed",
                jobId=job.job_id,
                documentId=job.document_id,
                status=status,
                engine=error.engine,
                reason=error.reason,
                byteCount=len(source),
                elapsedSeconds=elapsed_seconds,
            )
            raise

        elapsed_seconds = round(time.monotonic() - started_at, 3)
        self.gateway.record_source_scan(
            job,
            status=scan.status,
            engine=scan.engine,
            byte_count=scan.byte_count,
        )
        log_event(
            "ecos_hosted_source_scan_completed",
            jobId=job.job_id,
            documentId=job.document_id,
            status=scan.status,
            engine=scan.engine,
            byteCount=scan.byte_count,
            elapsedSeconds=elapsed_seconds,
        )
        return scan

    def process(self, job: HostedJob) -> None:
        # A mistakenly supplied live job must not reach any source, checkpoint,
        # publication, or failure RPC in the opt-in V2 worker.
        v2_enabled = getattr(self, "v2_shadow_accountability", False)
        if getattr(self, "v2_shadow_native_tables", False) and not (
            v2_enabled and getattr(self, "v2_shadow_native_excerpts", False)
        ):
            raise SourceAccountabilityError("v2_native_tables_require_excerpts_and_accountability")
        if getattr(self, "v2_shadow_native_excerpts", False) and not v2_enabled:
            raise SourceAccountabilityError("v2_native_excerpts_require_accountability")
        if v2_enabled and job.mode != "shadow":
            raise SourceAccountabilityError("v2_accountability_requires_shadow_job")
        if getattr(self, "v2_shadow_accountability", False) and getattr(self, "exact_target", None) != (
            job.job_id, job.source_sha256,
        ):
            raise SourceAccountabilityError("v2_accountability_exact_target_mismatch")
        job_started_at = time.monotonic()
        if getattr(self, "v2_shadow_native_tables", False):
            # A failed source/hash/security check must not freeze a previous
            # job's inventory or imply this run registered a usable source.
            self.v2_table_registered_job = None
            run_budget = getattr(self, "max_run_seconds", 3300)
            batch_deadline = getattr(self, "run_deadline_monotonic", None)
            if (isinstance(run_budget, bool) or not isinstance(run_budget, (int, float))
                    or not math.isfinite(run_budget) or run_budget <= 0
                    or (batch_deadline is not None and (
                        isinstance(batch_deadline, bool) or not isinstance(batch_deadline, (int, float))
                        or not math.isfinite(batch_deadline)))):
                raise SourceAccountabilityError("v2_native_table_deadline_invalid")
            table_deadline = job_started_at + run_budget
            if batch_deadline is not None:
                table_deadline = min(table_deadline, batch_deadline)
            self.v2_table_job_deadline_monotonic = table_deadline
        try:
            if getattr(self, "v2_shadow_native_tables", False) and self.v2_table_job_deadline_monotonic - time.monotonic() <= 45:
                raise RetryableIndexError("v2_native_table_budget_exhausted")
            log_event(
                "ecos_hosted_index_job_started",
                jobId=job.job_id,
                documentId=job.document_id,
                mode=job.mode,
            )
            self.drain_shadow_materializations(job)
            source = self.gateway.download_source(job)
            actual_sha = hashlib.sha256(source).hexdigest()
            if actual_sha != job.source_sha256:
                raise PermanentIndexError("source_fingerprint_mismatch")
            self.scan_source(job, source)
            document = open_pdf(source)
            try:
                self.gateway.rpc("ecos_record_hosted_index_source", {
                    "p_job_id": job.job_id,
                    "p_claim_token": job.claim_token,
                    "p_source_sha256": actual_sha,
                    "p_source_page_count": document.page_count,
                })
                if getattr(self, "v2_shadow_native_tables", False):
                    self.v2_table_registered_job = replace(job, source_page_count=document.page_count)
                    self.snapshot_table_source_accountability(
                        self.v2_table_registered_job,
                        deadline_monotonic=self.v2_table_job_deadline_monotonic,
                    )
                self.snapshot_source_accountability(job, expected_page_count=document.page_count)
                # Preserve native content for every page independently of the
                # legacy question-family extractor and its completed-page list.
                # This bounded phase never invokes a model or claims semantics.
                self.project_native_page_excerpts(job, document, deadline_monotonic=min(
                    getattr(self, "run_deadline_monotonic", float("inf")),
                    job_started_at + getattr(self, "max_run_seconds", 3300),
                ))
                self.project_native_page_tables(job, document, deadline_monotonic=min(
                    getattr(self, "run_deadline_monotonic", float("inf")),
                    job_started_at + getattr(self, "max_run_seconds", 3300),
                ))
                structural_sheet_identities = document_sheet_identity_map(document)
                completed_pages = self.gateway.completed_pages(job)
                for page_number in range(1, document.page_count + 1):
                    if page_number in completed_pages:
                        continue
                    self.gateway.extend_lease(job)
                    page_started_at = time.monotonic()
                    page = document.load_page(page_number - 1)
                    page_checkpoint = self.gateway.page_checkpoint(
                        job,
                        page_number=page_number,
                    )
                    checkpoint_ocr = (
                        page_checkpoint.get("ocr_page_data")
                        if isinstance(page_checkpoint, dict)
                        and isinstance(page_checkpoint.get("ocr_page_data"), dict)
                        else {}
                    )
                    visual_tile_checkpoint = checkpoint_ocr.get("visualTileCheckpoint")

                    def checkpoint_visual_tile(payload: dict[str, Any]) -> None:
                        self.checkpoint_visual_tile_page(
                            job,
                            page_number=page_number,
                            source_sha256=actual_sha,
                            visual_tile_checkpoint=payload,
                        )

                    with page_processing_deadline(self.page_timeout_seconds):
                        result = extract_page(
                            page,
                            actual_sha,
                            project_id=job.project_id,
                            document_sheet_identity=structural_sheet_identities.get(page_number),
                            evidence_version=EVIDENCE_VERSION,
                            visual_tile_checkpoint=(
                                visual_tile_checkpoint
                                if isinstance(visual_tile_checkpoint, dict)
                                else None
                            ),
                            on_visual_tile_checkpoint=checkpoint_visual_tile,
                        )
                        unresolved = self.resolve_visual_exceptions(job, page, page_number, result)
                        assurance = assure_page(
                            page_data=result["final"],
                            expected_project_id=job.project_id,
                            expected_page_number=page_number,
                            expected_source_sha256=actual_sha,
                            expected_evidence_version=EVIDENCE_VERSION,
                            unresolved_region_count=len(unresolved),
                        )
                    self.checkpoint_final_page(
                        job,
                        page_number=page_number,
                        result=result,
                        assurance=assurance,
                        unresolved_region_count=len(unresolved),
                    )
                    self.drain_shadow_materializations(job, max_pages=1)
                    if unresolved:
                        raise RetryableIndexError("visual_exception_unresolved")
                    if not assurance["accepted"]:
                        raise PermanentIndexError("assurance_rejected_page")
                    self.gateway.record_usage(
                        job,
                        event_type="page_assured",
                        idempotency_key=f"page-assured:{page_number}",
                        duration_ms=int((time.monotonic() - page_started_at) * 1000),
                        details={
                            "pageNumber": page_number,
                            "nativeCharacters": result["native"]["characterCount"],
                            "ocrAttempted": result["ocr"]["attempted"],
                            "ocrTileCount": result["ocr"].get("tileCount", 0),
                            "visualTileRegionCount": len(result["ocr"].get("visualTileRegions") or []),
                            "visualTileAnalysisDurationMs": sum(
                                int(proof.get("analysisDurationMs") or 0)
                                for proof in result["ocr"].get("visualTileProofs") or []
                                if isinstance(proof, dict)
                            ),
                            "visualExceptionCount": len(unresolved),
                        },
                    )
                    log_event(
                        "ecos_hosted_index_page_assured",
                        jobId=job.job_id,
                        documentId=job.document_id,
                        pageNumber=page_number,
                        pageCount=document.page_count,
                    )
                self.drain_shadow_materializations(job)
                self.snapshot_source_accountability(job, expected_page_count=document.page_count)
                self.snapshot_table_source_accountability(
                    replace(job, source_page_count=document.page_count),
                    deadline_monotonic=getattr(self, "v2_table_job_deadline_monotonic", None),
                )
                self.gateway.record_usage(
                    job,
                    event_type="document_ready",
                    idempotency_key="document-ready",
                    duration_ms=int((time.monotonic() - job_started_at) * 1000),
                    details={"pageCount": document.page_count, "mode": job.mode},
                )
                commit_rpc = (
                    "ecos_commit_hosted_shadow_preparation_job"
                    if job.mode == "shadow"
                    else "ecos_commit_hosted_index_job"
                )
                self.gateway.rpc(commit_rpc, {
                    "p_job_id": job.job_id,
                    "p_claim_token": job.claim_token,
                    "p_evidence_version": EVIDENCE_VERSION,
                })
                log_event(
                    "ecos_hosted_index_job_ready",
                    jobId=job.job_id,
                    documentId=job.document_id,
                    pageCount=document.page_count,
                    mode=job.mode,
                    elapsedSeconds=round(time.monotonic() - job_started_at, 3),
                )
            finally:
                document.close()
        except (KeyboardInterrupt, SystemExit):
            if getattr(self, "v2_shadow_native_tables", False):
                self.fail(job, "v2_native_table_worker_interrupted", {}, retryable=True)
            raise
        except SourceAccountabilityError as error:
            self.fail(job, "v2_source_accountability_failed", {"detail": str(error)}, retryable=True)
        except SourceReconnectRequired as error:
            self.fail(job, "source_reconnect_required", {"detail": str(error)}, retryable=False)
        except SourceRejected as error:
            self.fail(job, "source_rejected", {"detail": str(error)}, retryable=False)
        except SourceScanOperationalError as error:
            self.fail(job, "source_security_scan_failed", {"detail": str(error)}, retryable=True)
        except SourceSecurityRejected as error:
            self.fail(job, "source_security_rejected", {"detail": str(error)}, retryable=False)
        except DocumentResourceRejected as error:
            self.fail(job, "document_resource_rejected", {"detail": str(error)}, retryable=False)
        except VisualTileAnalysisFailed as error:
            self.fail(job, "visual_tile_analysis_failed", {"detail": str(error)}, retryable=True)
        except PageProcessingTimeout as error:
            self.fail(job, "page_processing_timeout", {"detail": str(error)}, retryable=True)
        except RetryableIndexError as error:
            self.fail(job, str(error), {}, retryable=True)
        except PermanentIndexError as error:
            self.fail(job, str(error), {}, retryable=False)
        except Exception as error:  # protected diagnostics never reach customer clients
            diagnostics = {"type": type(error).__name__}
            if not getattr(self, "v2_shadow_native_tables", False):
                diagnostics["detail"] = str(error)[:1000]
            self.fail(job, "worker_internal_error", diagnostics, retryable=True)

    def project_native_page_excerpts(
        self, job: HostedJob, document: Any, *, deadline_monotonic: float | None = None,
    ) -> None:
        if not getattr(self, "v2_shadow_native_excerpts", False):
            return
        if (
            not getattr(self, "v2_shadow_accountability", False)
            or job.mode != "shadow"
            or getattr(self, "exact_target", None) != (job.job_id, job.source_sha256)
        ):
            raise SourceAccountabilityError("v2_native_excerpts_exact_shadow_target_required")
        # The source has just been hashed, scanned, opened, and its actual count
        # registered. Do not rely on a stale optional count from the claim row.
        registered_job = replace(job, source_page_count=document.page_count)
        deadline = deadline_monotonic if deadline_monotonic is not None else (
            time.monotonic() + getattr(self, "max_run_seconds", 3300)
        )
        if deadline - time.monotonic() <= 45:
            raise RetryableIndexError("v2_native_page_budget_exhausted")
        try:
            with page_processing_deadline(min(25, max(0.001, deadline - time.monotonic() - 45))):
                heads = self.gateway.rpc(PAGE_EXCERPT_HEADS_RPC, {
                    "p_job_id": job.job_id, "p_claim_token": job.claim_token,
                })
        except Exception as error:
            raise SourceAccountabilityError("v2_native_page_heads_unavailable") from error
        completed = validate_page_excerpt_heads(heads, registered_job)
        for page_number in range(1, document.page_count + 1):
            if page_number in completed:
                continue
            # Reserve time for a bounded transport write plus failure snapshot
            # and lease release. A fresh claim resumes from exact native heads.
            remaining = deadline - time.monotonic() - 45
            if remaining <= 0:
                raise RetryableIndexError("v2_native_page_budget_exhausted")
            with page_processing_deadline(min(self.page_timeout_seconds, remaining)):
                self.gateway.extend_lease(job)
                if deadline - time.monotonic() <= 45:
                    raise RetryableIndexError("v2_native_page_budget_exhausted")
                try:
                    projection = extract_page_source_excerpts(
                        document.load_page(page_number - 1), registered_job, page_number,
                    )
                except (ValueError, TypeError) as error:
                    # Raw PDF text or provider details must not enter diagnostics.
                    raise SourceAccountabilityError("v2_native_page_extraction_invalid") from error
                try:
                    receipt = self.gateway.rpc(PAGE_EXCERPTS_RPC, {
                        "p_job_id": job.job_id,
                        "p_claim_token": job.claim_token,
                        "p_projection": projection,
                    })
                except Exception as error:
                    # Ambiguous writes are retried by a fresh valid claim; the
                    # immutable, content-bound RPC supplies idempotency.
                    raise SourceAccountabilityError("v2_native_page_persistence_failed") from error
                receipt = validate_page_excerpts_receipt(receipt, registered_job, projection)
            log_event(
                "ecos_v2_native_page_excerpts_recorded",
                jobId=job.job_id,
                pageNumber=page_number,
                projectionId=receipt["projection_id"],
                projectionSha256=receipt["projection_sha256"],
                excerptCount=receipt["excerpt_count"],
                state=receipt["state"],
                semanticVerification="pending",
            )

    def project_native_page_tables(
        self, job: HostedJob, document: Any, *, deadline_monotonic: float | None = None,
    ) -> None:
        if not getattr(self, "v2_shadow_native_tables", False):
            return
        if (
            not getattr(self, "v2_shadow_native_excerpts", False)
            or not getattr(self, "v2_shadow_accountability", False)
            or job.mode != "shadow"
            or getattr(self, "exact_target", None) != (job.job_id, job.source_sha256)
        ):
            raise SourceAccountabilityError("v2_native_tables_exact_shadow_target_required")
        if type(document.page_count) is not int or not 1 <= document.page_count <= 10_000:
            raise SourceAccountabilityError("v2_native_table_source_scope_invalid")
        registered_job = replace(job, source_page_count=document.page_count)
        deadline = deadline_monotonic if deadline_monotonic is not None else (
            time.monotonic() + getattr(self, "max_run_seconds", 3300)
        )
        if isinstance(deadline, bool) or not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
            raise SourceAccountabilityError("v2_native_table_deadline_invalid")

        def remaining_budget() -> float:
            remaining = deadline - time.monotonic() - 45
            if remaining <= 0:
                raise RetryableIndexError("v2_native_table_budget_exhausted")
            return remaining

        remaining = remaining_budget()
        try:
            with page_processing_deadline(min(25, remaining)):
                heads = self.gateway.rpc(PAGE_TABLE_SOURCE_HEADS_RPC, {
                    "p_job_id": job.job_id, "p_claim_token": job.claim_token,
                })
        except PageProcessingTimeout:
            raise
        except Exception as error:
            raise SourceAccountabilityError("v2_native_table_heads_unavailable") from error
        completed = validate_page_table_source_heads(heads, registered_job)
        for page_number in range(1, document.page_count + 1):
            if page_number in completed:
                continue
            remaining = remaining_budget()
            with page_processing_deadline(min(self.page_timeout_seconds, remaining)):
                try:
                    self.gateway.extend_lease(job)
                except PageProcessingTimeout:
                    raise
                except Exception as error:
                    raise SourceAccountabilityError("v2_native_table_lease_unavailable") from error
                remaining_budget()
                try:
                    projection = extract_page_table_sources(
                        document.load_page(page_number - 1), registered_job, page_number,
                    )
                except PageProcessingTimeout:
                    raise
                except Exception as error:
                    raise SourceAccountabilityError("v2_native_table_extraction_invalid") from error
                remaining_budget()
                page_table_source_counts(projection, registered_job, page_number)
                try:
                    receipt = self.gateway.rpc(PAGE_TABLE_SOURCES_RPC, {
                        "p_job_id": job.job_id, "p_claim_token": job.claim_token,
                        "p_projection": projection,
                    })
                except PageProcessingTimeout:
                    raise
                except Exception as error:
                    # An ambiguous commit is resolved by independently reading
                    # exact durable table heads after the next valid claim.
                    raise SourceAccountabilityError("v2_native_table_persistence_failed") from error
                receipt = validate_page_table_sources_receipt(receipt, registered_job, projection)
            log_event(
                "ecos_v2_native_page_tables_recorded", jobId=job.job_id,
                pageNumber=page_number, projectionId=receipt["projection_id"],
                projectionSha256=receipt["projection_sha256"],
                tableCount=receipt["table_count"], cellCount=receipt["cell_count"],
                state=receipt["state"], semanticVerification="pending",
            )
        # Also freeze an all-heads resume: unchanged database content reuses the
        # immutable snapshot rather than relying on an operator-only RPC.
        self.snapshot_table_source_accountability(registered_job, deadline_monotonic=deadline)

    def drain_shadow_materializations(self, job: HostedJob, *, max_pages: int = 10000) -> None:
        """Materialize durable shadow checkpoints outside their write transaction.

        A crash after the checkpoint leaves its queue row committed. The next
        claim drains that row before downloading and reprocessing the source.
        Live jobs never enter this validation-only path.
        """
        if job.mode != "shadow":
            return
        bounded_limit = max(1, min(10000, max_pages))
        for _ in range(bounded_limit):
            rows = self.gateway.rpc("ecos_materialize_next_hosted_shadow_page", {
                "p_job_id": job.job_id,
                "p_claim_token": job.claim_token,
            })
            if not isinstance(rows, list):
                raise RetryableIndexError("shadow_materialization_response_invalid")
            if not rows:
                return
            row = rows[0] if isinstance(rows[0], dict) else {}
            log_event(
                "ecos_hosted_shadow_page_materialized",
                jobId=job.job_id,
                documentId=job.document_id,
                pageNumber=row.get("page_number"),
                operation=row.get("operation"),
                chunkCount=row.get("chunk_count"),
            )
        # Page numbers are constrained to 1..10000, so the default bound can
        # exhaust every possible queue entry without an unbounded loop. The
        # ready-state database guard remains the final fail-closed backstop.

    def resolve_visual_exceptions(
        self,
        job: HostedJob,
        page: Any,
        page_number: int,
        result: dict[str, Any],
    ) -> list[dict[str, Any]]:
        unresolved: list[dict[str, Any]] = []
        current_exceptions = [{
            "regionKey": str(exception.get("regionKey") or ""),
            "exceptionFingerprint": visual_exception_fingerprint(exception),
        } for exception in result["unresolved"]]
        if not result["unresolved"]:
            self.gateway.prune_stale_visual_exceptions(
                job,
                page_number=page_number,
                evidence_version=EVIDENCE_VERSION,
                current_exceptions=current_exceptions,
            )
            return unresolved
        resolved_regions = self.gateway.resolved_visual_regions(
            job, page_number=page_number,
        )
        for exception in result["unresolved"]:
            exception_fingerprint = visual_exception_fingerprint(exception)
            reused_from_region_key: str | None = None
            reusable_evidence = reusable_resolved_visual_evidence(
                exception,
                resolved_regions.get(str(exception.get("regionKey") or "")),
                evidence_version=EVIDENCE_VERSION,
                exception_fingerprint=exception_fingerprint,
            )
            if not reusable_evidence:
                # Region keys are ordinal presentation labels. If an earlier
                # low-confidence cluster disappears after deterministic local
                # corroboration, prove that a stored resolution differs only
                # by that ordinal before reusing it. Recomputing the old-key
                # fingerprint binds the same reason, bounds, candidates, and
                # page-scoped query; any substantive change still fails.
                for old_region_key, stored_row in resolved_regions.items():
                    if old_region_key == str(exception.get("regionKey") or ""):
                        continue
                    rekeyed_exception = {
                        **exception,
                        "regionKey": old_region_key,
                    }
                    old_fingerprint = visual_exception_fingerprint(
                        rekeyed_exception
                    )
                    candidate_evidence = reusable_resolved_visual_evidence(
                        rekeyed_exception,
                        stored_row,
                        evidence_version=EVIDENCE_VERSION,
                        exception_fingerprint=old_fingerprint,
                    )
                    if candidate_evidence:
                        reusable_evidence = candidate_evidence
                        reused_from_region_key = old_region_key
                        break
            if reusable_evidence:
                if reused_from_region_key is not None:
                    reusable_evidence = self.persist_rekeyed_visual_resolution(
                        job,
                        page_number=page_number,
                        exception=exception,
                        exception_fingerprint=exception_fingerprint,
                        evidence=reusable_evidence,
                    )
                    if reusable_evidence is None:
                        self.gateway.upsert_visual_exception(
                            job,
                            page_number=page_number,
                            exception=exception,
                            evidence_version=EVIDENCE_VERSION,
                            exception_fingerprint=exception_fingerprint,
                        )
                        unresolved.append(exception)
                        continue
                if reusable_evidence.get("resolutionType") != VISUAL_DISMISSAL_TYPE:
                    append_visual_evidence(result, exception, reusable_evidence)
                continue
            if (
                not visual_exception_is_fact_resolvable(exception)
                or not self.visual.configured
                or not self.gateway.reserve_visual_region(
                    job,
                    page_number=page_number,
                    region_key=exception["regionKey"],
                    evidence_version=EVIDENCE_VERSION,
                    exception_fingerprint=exception_fingerprint,
                )
            ):
                self.gateway.upsert_visual_exception(
                    job,
                    page_number=page_number,
                    exception=exception,
                    evidence_version=EVIDENCE_VERSION,
                    exception_fingerprint=exception_fingerprint,
                )
                unresolved.append(exception)
                continue
            resolution = self.visual.resolve(
                page=page,
                exception=exception,
                context={
                    "organizationId": job.organization_id,
                    "projectId": job.project_id,
                    "documentId": job.document_id,
                    "sourceSha256": job.source_sha256,
                    "documentName": job.document_id,
                    "pageNumber": page_number,
                    "hostedJobId": job.job_id,
                    "hostedClaimToken": job.claim_token,
                    "evidenceVersion": EVIDENCE_VERSION,
                    "visualExceptionFingerprint": exception_fingerprint,
                    "visualRegionKey": exception["regionKey"],
                },
            )
            log_event(
                "ecos_hosted_visual_exception_resolution_completed",
                jobId=job.job_id,
                documentId=job.document_id,
                pageNumber=page_number,
                regionKey=str(exception.get("regionKey") or "")[:300],
                exceptionFingerprint=exception_fingerprint,
                resolved=resolution.resolved,
                resolutionCategory=str(
                    resolution.internal_diagnostics.get("category") or "unknown"
                )[:160],
                providerStatus=resolution.internal_diagnostics.get("status"),
                providerError=str(
                    resolution.internal_diagnostics.get("error") or ""
                )[:160] or None,
                assuranceProvider=str(
                    resolution.internal_diagnostics.get("assuranceProvider")
                    or ""
                )[:120] or None,
                assuranceModel=str(
                    resolution.internal_diagnostics.get("assuranceModel") or ""
                )[:160] or None,
                assuranceProviderStatus=resolution.internal_diagnostics.get(
                    "assuranceProviderStatus"
                ),
                assuranceProviderErrorCode=str(
                    resolution.internal_diagnostics.get(
                        "assuranceProviderErrorCode"
                    ) or ""
                )[:160] or None,
                acceptedFactCount=resolution.internal_diagnostics.get(
                    "acceptedFactCount"
                ),
                dismissedCandidateCount=resolution.internal_diagnostics.get(
                    "dismissedCandidateCount"
                ),
            )
            if resolution.resolved:
                if resolution.evidence.get("resolutionType") == VISUAL_DISMISSAL_TYPE:
                    durable_dismissal = {
                        **resolution.evidence,
                        "evidenceVersion": EVIDENCE_VERSION,
                        "exceptionFingerprint": exception_fingerprint,
                    }
                    assurance_result = {
                        "accepted": True,
                        "method": "bounded_visual_exception_dismissal_v1",
                        "schemaVersion": VISUAL_SCHEMA_VERSION,
                        "evidenceVersion": EVIDENCE_VERSION,
                        "exceptionFingerprint": exception_fingerprint,
                        "assuranceProvider": durable_dismissal.get("assuranceProvider"),
                        "assuranceModel": durable_dismissal.get("assuranceModel"),
                        "acceptedFactCount": 0,
                        "dismissedCandidateCount": len(
                            durable_dismissal.get("dismissedCandidateIndexes") or []
                        ),
                    }
                    if self.gateway.dismiss_visual_exception(
                        job,
                        page_number=page_number,
                        exception=exception,
                        evidence_version=EVIDENCE_VERSION,
                        exception_fingerprint=exception_fingerprint,
                        normalized_dismissal=durable_dismissal,
                        assurance_result=assurance_result,
                    ):
                        continue
                else:
                    versioned_facts = [{
                        **fact,
                        "evidenceVersion": EVIDENCE_VERSION,
                        "exceptionFingerprint": exception_fingerprint,
                    } for fact in resolution.evidence.get("facts") or []]
                    durable_evidence = {
                        **resolution.evidence,
                        "facts": versioned_facts,
                        "evidenceVersion": EVIDENCE_VERSION,
                        "exceptionFingerprint": exception_fingerprint,
                    }
                    assurance_result = {
                        "accepted": True,
                        "method": "bounded_visual_exception_v2",
                        "schemaVersion": VISUAL_SCHEMA_VERSION,
                        "evidenceVersion": EVIDENCE_VERSION,
                        "exceptionFingerprint": exception_fingerprint,
                        "assuranceProvider": durable_evidence.get("assuranceProvider"),
                        "assuranceModel": durable_evidence.get("assuranceModel"),
                        "minimumConfidence": MIN_ASSURED_VISUAL_CONFIDENCE,
                        "acceptedFactCount": len(durable_evidence.get("facts") or []),
                        "dismissedCandidateCount": len(
                            durable_evidence.get("dismissedCandidateIndexes") or []
                        ),
                    }
                    if self.gateway.resolve_visual_exception(
                        job,
                        page_number=page_number,
                        exception=exception,
                        evidence_version=EVIDENCE_VERSION,
                        exception_fingerprint=exception_fingerprint,
                        normalized_evidence=durable_evidence,
                        assurance_result=assurance_result,
                    ):
                        append_visual_evidence(result, exception, durable_evidence)
                        continue
            self.gateway.upsert_visual_exception(
                job,
                page_number=page_number,
                exception=exception,
                evidence_version=EVIDENCE_VERSION,
                exception_fingerprint=exception_fingerprint,
            )
            unresolved.append(exception)
        self.gateway.prune_stale_visual_exceptions(
            job,
            page_number=page_number,
            evidence_version=EVIDENCE_VERSION,
            current_exceptions=current_exceptions,
        )
        return unresolved

    def persist_rekeyed_visual_resolution(
        self,
        job: HostedJob,
        *,
        page_number: int,
        exception: dict[str, Any],
        exception_fingerprint: str,
        evidence: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Atomically bind exact reusable evidence to its current ordinal key.

        Low-confidence region keys are presentation ordinals. Deterministic
        extraction can insert or remove an earlier candidate while leaving a
        later candidate's reason, bounds, and authority unchanged. Reuse is
        allowed only after exact fingerprint validation against the old key;
        persisting the same validated result under the current key prevents a
        later retry from losing it when another shifted candidate overwrites
        the old ordinal row.
        """
        if evidence.get("resolutionType") == VISUAL_DISMISSAL_TYPE:
            durable_dismissal = {
                **evidence,
                "evidenceVersion": EVIDENCE_VERSION,
                "exceptionFingerprint": exception_fingerprint,
            }
            assurance_result = {
                "accepted": True,
                "method": "bounded_visual_exception_dismissal_v1",
                "schemaVersion": VISUAL_SCHEMA_VERSION,
                "evidenceVersion": EVIDENCE_VERSION,
                "exceptionFingerprint": exception_fingerprint,
                "assuranceProvider": durable_dismissal.get(
                    "assuranceProvider"
                ),
                "assuranceModel": durable_dismissal.get("assuranceModel"),
                "acceptedFactCount": 0,
                "dismissedCandidateCount": len(
                    durable_dismissal.get("dismissedCandidateIndexes") or []
                ),
            }
            if not self.gateway.dismiss_visual_exception(
                job,
                page_number=page_number,
                exception=exception,
                evidence_version=EVIDENCE_VERSION,
                exception_fingerprint=exception_fingerprint,
                normalized_dismissal=durable_dismissal,
                assurance_result=assurance_result,
            ):
                return None
            return durable_dismissal

        versioned_facts = [{
            **fact,
            "evidenceVersion": EVIDENCE_VERSION,
            "exceptionFingerprint": exception_fingerprint,
        } for fact in evidence.get("facts") or []]
        durable_evidence = {
            **evidence,
            "facts": versioned_facts,
            "evidenceVersion": EVIDENCE_VERSION,
            "exceptionFingerprint": exception_fingerprint,
        }
        assurance_result = {
            "accepted": True,
            "method": "bounded_visual_exception_v2",
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "evidenceVersion": EVIDENCE_VERSION,
            "exceptionFingerprint": exception_fingerprint,
            "assuranceProvider": durable_evidence.get("assuranceProvider"),
            "assuranceModel": durable_evidence.get("assuranceModel"),
            "minimumConfidence": MIN_ASSURED_VISUAL_CONFIDENCE,
            "acceptedFactCount": len(versioned_facts),
            "dismissedCandidateCount": len(
                durable_evidence.get("dismissedCandidateIndexes") or []
            ),
        }
        if not self.gateway.resolve_visual_exception(
            job,
            page_number=page_number,
            exception=exception,
            evidence_version=EVIDENCE_VERSION,
            exception_fingerprint=exception_fingerprint,
            normalized_evidence=durable_evidence,
            assurance_result=assurance_result,
        ):
            return None
        return durable_evidence

    def snapshot_table_source_accountability(
        self, job: HostedJob, *, deadline_monotonic: float | None = None,
        reserve_seconds: float = 40, max_seconds: float = 25,
    ) -> dict[str, Any] | None:
        if not getattr(self, "v2_shadow_native_tables", False):
            return None
        if (not getattr(self, "v2_shadow_native_excerpts", False)
                or not getattr(self, "v2_shadow_accountability", False)
                or job.mode != "shadow"
                or getattr(self, "exact_target", None) != (job.job_id, job.source_sha256)):
            raise SourceAccountabilityError("v2_native_tables_exact_shadow_target_required")
        payload = table_source_manifest_payload(job)
        deadline = deadline_monotonic if deadline_monotonic is not None else (
            time.monotonic() + getattr(self, "max_run_seconds", 3300)
        )
        if (any(type(number) not in (int, float) or not math.isfinite(number)
                for number in (deadline, reserve_seconds, max_seconds))
                or reserve_seconds < 0 or not 0 < max_seconds <= 25):
            raise SourceAccountabilityError("v2_native_table_deadline_invalid")
        remaining = deadline - time.monotonic() - reserve_seconds
        if remaining <= 0:
            raise RetryableIndexError("v2_native_table_budget_exhausted")
        call_deadline = time.monotonic() + min(max_seconds, remaining)
        try:
            # This method owns its one timer. Cleanup callers must not nest an
            # outer timer that would be reset by this bounded snapshot call.
            with page_processing_deadline(min(max_seconds, remaining)):
                receipt = validate_table_source_manifest(
                    self.gateway.rpc(TABLE_SOURCE_MANIFEST_SNAPSHOT_RPC, payload), job,
                )
        except (PageProcessingTimeout, SourceAccountabilityError):
            raise
        except Exception as error:
            raise SourceAccountabilityError("v2_table_manifest_persistence_failed") from error
        # An unavailable SIGALRM or a late-returning transport cannot turn a
        # durable but ambiguous snapshot into successful processing. It can be
        # read/reused on the next valid lease instead.
        finished = time.monotonic()
        if finished >= deadline - reserve_seconds:
            raise RetryableIndexError("v2_native_table_budget_exhausted")
        if finished >= call_deadline:
            raise PageProcessingTimeout("v2_table_manifest_deadline_exceeded")
        log_event(
            "ecos_v2_table_source_manifest_frozen", jobId=job.job_id,
            manifestId=receipt["manifest_id"], manifestSha256=receipt["manifest_sha256"],
            sourcePageCount=receipt["source_page_count"], reportedItemCount=receipt["reported_item_count"],
            gapItemCount=receipt["gap_item_count"], fullyAccounted=receipt["fully_accounted"],
            fullyUsable=receipt["fully_usable"], semanticVerification="pending",
        )
        return receipt

    def snapshot_source_accountability(
        self, job: HostedJob, *, expected_page_count: int | None = None,
    ) -> None:
        if not getattr(self, "v2_shadow_accountability", False):
            return
        payload = snapshot_payload(job)
        try:
            receipt = validate_snapshot_receipt(
                self.gateway.rpc(SNAPSHOT_RPC, payload), job,
                expected_page_count=expected_page_count,
            )
        except SourceAccountabilityError:
            raise
        except Exception as error:
            # Never include transport response bodies, tokens, or source text.
            raise SourceAccountabilityError("v2_accountability_persistence_failed") from error
        log_event(
            "ecos_v2_source_accountability_snapshotted",
            jobId=job.job_id,
            manifestId=receipt["manifest_id"],
            manifestSha256=receipt["manifest_sha256"],
            expectedItemCount=receipt["expected_item_count"],
            reportedItemCount=receipt["reported_item_count"],
            gapItemCount=receipt["gap_item_count"],
            fullyAccounted=receipt["fully_accounted"],
            fullyUsable=receipt["fully_usable"],
        )

    def fail(self, job: HostedJob, category: str, diagnostics: dict[str, Any], *, retryable: bool) -> None:
        if getattr(self, "v2_shadow_native_tables", False):
            self.fail_with_table_cleanup_budget(job, category, diagnostics, retryable=retryable)
            return
        # Capture durable progress before the existing failure RPC releases the
        # lease. Missing source inventory or an unavailable database cannot be
        # replaced with an invented complete manifest. A prior pending snapshot
        # and durable page checkpoints remain recoverable on the next claim.
        try:
            self.snapshot_source_accountability(job, expected_page_count=getattr(job, "source_page_count", None))
        except Exception as error:
            log_event(
                "ecos_v2_source_accountability_snapshot_unavailable",
                jobId=job.job_id,
                errorType=type(error).__name__,
            )
        log_event(
            "ecos_hosted_index_job_failed",
            jobId=job.job_id,
            documentId=job.document_id,
            category=category,
            retryable=retryable,
        )
        try:
            self.gateway.rpc("ecos_fail_hosted_index_job", {
                "p_job_id": job.job_id,
                "p_claim_token": job.claim_token,
                "p_category": category,
                "p_diagnostics": diagnostics,
                "p_retryable": retryable,
            })
        except Exception:
            pass

    def fail_with_table_cleanup_budget(
        self, job: HostedJob, category: str, diagnostics: dict[str, Any], *, retryable: bool,
    ) -> None:
        # Separate timers matter: snapshot_source_accountability wraps exceptions.
        # A single outer alarm could be swallowed there and leave the subsequent
        # existing 180-second failure RPC unbounded. Never nest these timers.
        started = time.monotonic()
        configured = getattr(self, "v2_table_job_deadline_monotonic", started + 40)
        deadline = min(configured, started + 40) if math.isfinite(configured) else started
        registered_job = getattr(self, "v2_table_registered_job", None)
        registered = isinstance(registered_job, HostedJob) and (
            registered_job.job_id, registered_job.claim_token, registered_job.source_sha256,
            registered_job.organization_id, registered_job.project_id, registered_job.document_id,
            registered_job.source_revision, registered_job.mode,
        ) == (job.job_id, job.claim_token, job.source_sha256, job.organization_id, job.project_id, job.document_id,
              job.source_revision, job.mode)
        if registered and deadline - time.monotonic() > 20:
            try:
                self.snapshot_table_source_accountability(
                    registered_job, deadline_monotonic=deadline, reserve_seconds=20, max_seconds=10,
                )
            except Exception as error:
                log_event("ecos_v2_table_source_manifest_unavailable", jobId=job.job_id,
                          errorType=type(error).__name__)
        remaining = deadline - time.monotonic()
        # Once a source is registered, split the same 40-second cleanup budget
        # between table freeze (10), legacy snapshot (10) and release (20).
        snapshot_budget = min(10, remaining - 20) if registered else min(20, remaining)
        if snapshot_budget > 0:
            try:
                with page_processing_deadline(snapshot_budget):
                    self.snapshot_source_accountability(
                        registered_job if registered else job,
                        expected_page_count=(registered_job.source_page_count if registered else job.source_page_count),
                    )
            except Exception as error:
                log_event("ecos_v2_source_accountability_snapshot_unavailable", jobId=job.job_id,
                          errorType=type(error).__name__)
        log_event("ecos_hosted_index_job_failed", jobId=job.job_id,
                  documentId=job.document_id, category=category, retryable=retryable)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            log_event("ecos_v2_table_cleanup_budget_exhausted", jobId=job.job_id)
            return
        try:
            with page_processing_deadline(min(20, remaining)):
                self.gateway.rpc("ecos_fail_hosted_index_job", {
                    "p_job_id": job.job_id, "p_claim_token": job.claim_token,
                    "p_category": category, "p_diagnostics": diagnostics, "p_retryable": retryable,
                })
        except Exception as error:
            # Durable table heads remain; an unavailable release is recovered
            # by the existing expiring lease, never by deleting page evidence.
            log_event("ecos_v2_table_lease_release_unavailable", jobId=job.job_id,
                      errorType=type(error).__name__)


class RetryableIndexError(RuntimeError):
    pass


def exact_target_from_environment() -> tuple[str, str] | None:
    """Return an immutable controlled target or preserve global claiming.

    Both values are required together. A partially configured Cloud Run job
    fails before it can call either claim RPC, so it cannot silently fall back
    to the global queue.
    """
    job_id_is_configured = "ECOS_TARGET_JOB_ID" in os.environ
    source_sha_is_configured = "ECOS_TARGET_SOURCE_SHA256" in os.environ
    if not job_id_is_configured and not source_sha_is_configured:
        return None
    target_job_id = os.getenv("ECOS_TARGET_JOB_ID", "").strip()
    target_source_sha256 = os.getenv("ECOS_TARGET_SOURCE_SHA256", "").strip().lower()
    if not target_job_id or not target_source_sha256:
        raise ValueError(
            "ECOS_TARGET_JOB_ID and ECOS_TARGET_SOURCE_SHA256 must be provided together"
        )
    try:
        canonical_job_id = str(UUID(target_job_id))
    except ValueError as error:
        raise ValueError("ECOS_TARGET_JOB_ID must be a valid UUID") from error
    if len(target_source_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in target_source_sha256
    ):
        raise ValueError("ECOS_TARGET_SOURCE_SHA256 must be a valid SHA-256 checksum")
    return canonical_job_id, target_source_sha256


def reusable_resolved_visual_evidence(
    exception: dict[str, Any],
    stored: dict[str, Any] | None,
    *,
    evidence_version: str,
    exception_fingerprint: str,
) -> dict[str, Any] | None:
    """Return exact previously assured evidence, otherwise fail closed.

    Region keys alone are not enough because extraction changes can assign the
    same ordinal key to a different crop. Reuse requires the stored bounds to
    match the newly extracted bounds, a prior explicit Assurance acceptance,
    and a bounded non-empty evidence payload.
    """
    if not isinstance(stored, dict):
        return None
    assurance = stored.get("assurance_result")
    evidence = stored.get("normalized_evidence")
    if (
        stored.get("evidence_version") != evidence_version
        or stored.get("exception_fingerprint") != exception_fingerprint
        or not isinstance(assurance, dict)
        or assurance.get("accepted") is not True
        or assurance.get("schemaVersion") != VISUAL_SCHEMA_VERSION
        or assurance.get("evidenceVersion") != evidence_version
        or assurance.get("exceptionFingerprint") != exception_fingerprint
        or not str(assurance.get("assuranceProvider") or "").strip()
        or not isinstance(evidence, dict)
        or assurance.get("assuranceProvider") != evidence.get("assuranceProvider")
    ):
        return None
    if not visual_bounds_match(
        exception.get("bounds"), stored.get("bounds")
    ):
        return None
    if (
        evidence.get("evidenceVersion") != evidence_version
        or evidence.get("exceptionFingerprint") != exception_fingerprint
    ):
        return None
    if evidence.get("resolutionType") == VISUAL_DISMISSAL_TYPE:
        accepted_count = assurance.get("acceptedFactCount")
        dismissed_count = assurance.get("dismissedCandidateCount")
        if (
            assurance.get("method") != "bounded_visual_exception_dismissal_v1"
            or isinstance(accepted_count, bool) or not isinstance(accepted_count, int)
            or accepted_count != 0
            or isinstance(dismissed_count, bool) or not isinstance(dismissed_count, int)
            or dismissed_count != len(
                evidence.get("dismissedCandidateIndexes") or []
            )
        ):
            return None
        return validated_persisted_visual_dismissal(evidence, exception)
    facts = evidence.get("facts")
    minimum_confidence = assurance.get("minimumConfidence")
    accepted_count = assurance.get("acceptedFactCount")
    dismissed_count = assurance.get("dismissedCandidateCount")
    if (
        assurance.get("method") != "bounded_visual_exception_v2"
        or not isinstance(facts, list)
        or not facts
        or isinstance(accepted_count, bool) or not isinstance(accepted_count, int)
        or accepted_count != len(facts)
        or isinstance(dismissed_count, bool) or not isinstance(dismissed_count, int)
        or dismissed_count != len(
            evidence.get("dismissedCandidateIndexes") or []
        )
        or isinstance(minimum_confidence, bool)
        or not isinstance(minimum_confidence, (int, float))
        or not math.isfinite(float(minimum_confidence))
        or abs(float(minimum_confidence) - MIN_ASSURED_VISUAL_CONFIDENCE) > 0.000001
    ):
        return None
    return validated_persisted_visual_evidence(evidence, exception)


def visual_bounds_match(left: Any, right: Any) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    for key in ("x", "y", "width", "height"):
        left_raw = left.get(key)
        right_raw = right.get(key)
        if (
            isinstance(left_raw, bool) or not isinstance(left_raw, (int, float))
            or isinstance(right_raw, bool) or not isinstance(right_raw, (int, float))
        ):
            return False
        left_value = float(left_raw)
        right_value = float(right_raw)
        if not math.isfinite(left_value) or not math.isfinite(right_value):
            return False
        if abs(left_value - right_value) > 0.000001:
            return False
    return True


def append_visual_evidence(
    result: dict[str, Any],
    exception: dict[str, Any],
    evidence: dict[str, Any],
) -> None:
    for index, fact in enumerate(evidence.get("facts") or []):
        corroborated_indexes = fact.get("corroboratedCandidateIndexes") or []
        candidate_index = (
            corroborated_indexes[0]
            if len(corroborated_indexes) == 1
            and type(corroborated_indexes[0]) is int
            else None
        )
        diagnostic_candidates = exception.get("diagnosticCandidates") or []
        candidate = (
            diagnostic_candidates[candidate_index]
            if candidate_index is not None
            and candidate_index < len(diagnostic_candidates)
            and isinstance(diagnostic_candidates[candidate_index], dict)
            else None
        )
        candidate_source = str((candidate or {}).get("source") or "").strip()
        footing_match = re.fullmatch(
            r"Footing\s+(F[123]):\s+.*",
            str((candidate or {}).get("text") or "").strip(),
            flags=re.IGNORECASE,
        ) if candidate_source == EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE else None
        consensus_metadata = ({
            "reconstructionMethod": (
                "exact_source_bound_dual_provider_candidate_consensus"
            ),
            "evidenceSources": [
                candidate_source,
                "dual_provider_analysis_candidate_receipt",
                "dual_provider_assurance_candidate_receipt",
            ],
            "constituentEvidence": [{
                "text": str(candidate.get("text") or "").strip(),
                "source": candidate_source,
                "bounds": dict(candidate.get("bounds") or {}),
                "confidence": candidate.get("confidence"),
                "candidateIndex": candidate_index,
            }],
            "corroboratingEvidence": [{
                "source": "dual_provider_analysis_candidate_receipt",
                "provider": evidence.get("visionProvider"),
                "model": evidence.get("model"),
                "candidateAgreementMethod": evidence.get("candidateAgreementMethod"),
                "acceptedCandidateIndexes": evidence.get(
                    "primaryAcceptedCandidateIndexes"
                ),
                "dismissedCandidateIndexes": evidence.get(
                    "primaryDismissedCandidateIndexes"
                ),
                "exceptionFingerprint": evidence.get("exceptionFingerprint"),
            }, {
                "source": "dual_provider_assurance_candidate_receipt",
                "provider": evidence.get("assuranceProvider"),
                "model": evidence.get("assuranceModel"),
                "candidateAgreementMethod": evidence.get("candidateAgreementMethod"),
                "acceptedCandidateIndexes": evidence.get(
                    "assuranceAcceptedCandidateIndexes"
                ),
                "dismissedCandidateIndexes": evidence.get(
                    "assuranceDismissedCandidateIndexes"
                ),
                "exceptionFingerprint": evidence.get("exceptionFingerprint"),
            }],
            **({
                "subject": "footing schedule",
                "structuredTableRelationshipType": "footing_schedule",
                "structuredTableRowKey": footing_match.group(1).upper(),
            } if footing_match else {}),
        } if candidate is not None and candidate_source else {})
        result["final"]["regions"].append({
            "id": f"visual-{exception['regionKey']}-{index + 1}",
            "text": fact["statement"],
            "label": fact["statement"][:240],
            "evidenceText": fact["evidenceText"],
            "factKind": "drawing_fact",
            "subject": fact.get("subject") or fact["evidenceText"],
            "location": fact.get("location") or "",
            **fact["bounds"],
            "providerBounds": fact.get("providerBounds"),
            "confidence": fact["confidence"],
            "source": "vision",
            "searchable": True,
            "visionProvider": fact.get("visionProvider"),
            "model": fact.get("model"),
            "assuranceProvider": fact.get("assuranceProvider"),
            "assuranceModel": fact.get("assuranceModel"),
            "evidenceVersion": evidence.get("evidenceVersion"),
            "exceptionFingerprint": evidence.get("exceptionFingerprint"),
            **consensus_metadata,
        })


class PermanentIndexError(RuntimeError):
    pass


class PageProcessingTimeout(RuntimeError):
    pass


def log_event(event: str, **details: Any) -> None:
    print(json.dumps({"event": event, **details}, separators=(",", ":")), flush=True)


@contextmanager
def page_processing_deadline(timeout_seconds: float):
    """Bound one drawing page so malformed content cannot consume a whole task."""

    if not hasattr(signal, "SIGALRM"):
        yield
        return

    def handle_timeout(_signum: int, _frame: Any) -> None:
        raise PageProcessingTimeout(f"page exceeded {timeout_seconds} seconds")

    prior_handler = signal.signal(signal.SIGALRM, handle_timeout)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, prior_handler)
