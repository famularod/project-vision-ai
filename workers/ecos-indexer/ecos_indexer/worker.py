from __future__ import annotations

import hashlib
import copy
import json
import math
import os
import re
import signal
import socket
import time
from contextlib import contextmanager
from typing import Any
from uuid import UUID

from . import EVIDENCE_VERSION
from .assurance import assure_page
from .document_structure import document_sheet_identity_map
from .embeddings import (
    EMBEDDING_DIMENSIONS,
    OpenAIEmbeddingProvider,
    SemanticIndexError,
)
from .extraction import (
    DocumentResourceRejected,
    VisualTileAnalysisFailed,
    extract_page,
    open_pdf,
)
from .gateway import SourceReconnectRequired, SourceRejected, SupabaseWorkerGateway
from .models import HostedJob
from .plan_dimensions import derive_verified_plan_dimensions
from .security import SourceSecurityRejected, scan_pdf_source
from .visual import (
    BoundedVisualResolver,
    MIN_ASSURED_VISUAL_CONFIDENCE,
    VISUAL_DISMISSAL_TYPE,
    VISUAL_SCHEMA_VERSION,
    validated_persisted_visual_dismissal,
    validated_persisted_visual_evidence,
    visual_exception_fingerprint,
    visual_exception_is_fact_resolvable,
)


class HostedIndexerWorker:
    def __init__(self) -> None:
        self.gateway = SupabaseWorkerGateway()
        self.worker_id = os.getenv("ECOS_WORKER_ID", f"ecos-indexer-{socket.gethostname()}").strip()
        self.exact_target = exact_target_from_environment()
        self.poll_seconds = max(2, min(60, int(os.getenv("ECOS_WORKER_POLL_SECONDS", "10"))))
        self.max_jobs_per_run = max(1, min(100, int(os.getenv("ECOS_MAX_JOBS_PER_RUN", "8"))))
        self.max_run_seconds = max(60, min(3500, int(os.getenv("ECOS_MAX_RUN_SECONDS", "3300"))))
        self.page_timeout_seconds = max(
            60,
            min(1800, int(os.getenv("ECOS_PAGE_TIMEOUT_SECONDS", "600"))),
        )
        self.visual = BoundedVisualResolver()
        self.semantic = OpenAIEmbeddingProvider()

    def run_forever(self) -> None:
        while True:
            job = self.claim_next_job()
            if not job:
                time.sleep(self.poll_seconds)
                continue
            self.process(job)

    def run_batch(self) -> None:
        started_at = time.monotonic()
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

    def process(self, job: HostedJob) -> None:
        try:
            job_started_at = time.monotonic()
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
            try:
                scan = scan_pdf_source(source)
            except SourceSecurityRejected as error:
                scan_engine = "clamav" if "malware" in str(error) else "source-policy"
                try:
                    self.gateway.record_source_scan(
                        job,
                        status="rejected",
                        engine=scan_engine,
                        byte_count=len(source),
                    )
                except Exception:
                    pass
                raise
            self.gateway.record_source_scan(
                job,
                status=scan.status,
                engine=scan.engine,
                byte_count=scan.byte_count,
            )
            document = open_pdf(source)
            try:
                structural_sheet_identities = document_sheet_identity_map(document)
                self.gateway.rpc("ecos_record_hosted_index_source", {
                    "p_job_id": job.job_id,
                    "p_claim_token": job.claim_token,
                    "p_source_sha256": actual_sha,
                    "p_source_page_count": document.page_count,
                })
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
                        proofs = payload.get("completedDeepReadRegionProofs")
                        proof_list = proofs if isinstance(proofs, list) else []
                        completed_keys = [
                            str(proof.get("tileKey") or "")
                            for proof in proof_list
                            if isinstance(proof, dict)
                        ]
                        self.gateway.rpc("ecos_checkpoint_hosted_index_page", {
                            "p_job_id": job.job_id,
                            "p_claim_token": job.claim_token,
                            "p_page_number": page_number,
                            "p_state": "extracted",
                            "p_native_page_data": {},
                            "p_ocr_page_data": {"visualTileCheckpoint": payload},
                            "p_deterministic_page_data": {},
                            "p_final_page_data": {
                                "pageNumber": page_number,
                                "sourceSha256": actual_sha,
                                "visualCoverage": {
                                    "schemaVersion": payload.get("schemaVersion"),
                                    "evidenceVersion": payload.get("evidenceVersion"),
                                    "sourceSha256": actual_sha,
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
                        })

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
                    self.gateway.rpc("ecos_checkpoint_hosted_index_page", {
                        "p_job_id": job.job_id,
                        "p_claim_token": job.claim_token,
                        "p_page_number": page_number,
                        "p_state": "assured" if assurance["accepted"] else "awaiting_visual" if unresolved else "rejected",
                        "p_native_page_data": result["native"],
                        "p_ocr_page_data": result["ocr"],
                        "p_deterministic_page_data": result["deterministic"],
                        "p_final_page_data": result["final"],
                        "p_assurance_result": assurance,
                        "p_unresolved_region_count": len(unresolved),
                    })
                    self.drain_shadow_materializations(job, max_pages=1)
                    if unresolved:
                        raise VisualExceptionUnresolvedError(
                            page_number=page_number,
                            failures=[
                                exception.get("workerResolutionDiagnostics") or {}
                                for exception in unresolved[:12]
                            ],
                        )
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
                if job.mode == "shadow":
                    self.gateway.extend_lease(job)
                    semantic_started_at = time.monotonic()
                    semantic_chunks = self.gateway.shadow_chunks_for_embedding(job)
                    semantic_rows = self.semantic.build_rows(semantic_chunks)
                    embedded_count = self.gateway.replace_shadow_chunk_embeddings(
                        job,
                        embedding_model=self.semantic.model,
                        embedding_dimensions=EMBEDDING_DIMENSIONS,
                        rows=semantic_rows,
                    )
                    self.gateway.record_usage(
                        job,
                        event_type="semantic_index_ready",
                        idempotency_key=(
                            f"semantic-index:{self.semantic.model}:{EMBEDDING_DIMENSIONS}:"
                            f"{job.source_sha256}"
                        ),
                        quantity=embedded_count,
                        duration_ms=int((time.monotonic() - semantic_started_at) * 1000),
                        details={
                            "embeddingModel": self.semantic.model,
                            "embeddingDimensions": EMBEDDING_DIMENSIONS,
                            "chunkCount": embedded_count,
                            "sourceSha256": job.source_sha256,
                        },
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
        except SourceReconnectRequired as error:
            self.fail(job, "source_reconnect_required", {"detail": str(error)}, retryable=False)
        except SourceRejected as error:
            self.fail(job, "source_rejected", {"detail": str(error)}, retryable=False)
        except SourceSecurityRejected as error:
            self.fail(job, "source_security_rejected", {"detail": str(error)}, retryable=False)
        except DocumentResourceRejected as error:
            self.fail(job, "document_resource_rejected", {"detail": str(error)}, retryable=False)
        except VisualTileAnalysisFailed as error:
            self.fail(job, "visual_tile_analysis_failed", {"detail": str(error)}, retryable=True)
        except SemanticIndexError as error:
            self.fail(job, str(error), {}, retryable=True)
        except PageProcessingTimeout as error:
            self.fail(job, "page_processing_timeout", {"detail": str(error)}, retryable=True)
        except VisualExceptionUnresolvedError as error:
            self.fail(job, "visual_exception_unresolved", error.diagnostics, retryable=True)
        except RetryableIndexError as error:
            self.fail(job, str(error), {}, retryable=True)
        except PermanentIndexError as error:
            self.fail(job, str(error), {}, retryable=False)
        except Exception as error:  # protected diagnostics never reach customer clients
            self.fail(job, "worker_internal_error", {"type": type(error).__name__, "detail": str(error)[:1000]}, retryable=True)

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
        if not result["unresolved"]:
            return unresolved
        resolved_regions = self.gateway.resolved_visual_regions(
            job, page_number=page_number,
        )
        for exception in result["unresolved"]:
            exception_fingerprint = visual_exception_fingerprint(exception)
            reusable_evidence = reusable_resolved_visual_evidence(
                exception,
                resolved_regions.get(str(exception.get("regionKey") or "")),
                evidence_version=EVIDENCE_VERSION,
                exception_fingerprint=exception_fingerprint,
            )
            if reusable_evidence:
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
                    "documentName": job.document_id,
                    "sourceSha256": job.source_sha256,
                    "pageNumber": page_number,
                    "hostedJobId": job.job_id,
                    "hostedClaimToken": job.claim_token,
                    "evidenceVersion": EVIDENCE_VERSION,
                },
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
            bounded_diagnostics = bounded_visual_resolution_diagnostics(
                resolution.internal_diagnostics if not resolution.resolved else {
                    "category": "visual_resolution_persistence_failed",
                },
                page_number=page_number,
                region_key=str(exception.get("regionKey") or ""),
                exception_fingerprint=exception_fingerprint,
            )
            log_event(
                "ecos_hosted_visual_exception_unresolved",
                jobId=job.job_id,
                documentId=job.document_id,
                **bounded_diagnostics,
            )
            unresolved.append({
                **exception,
                "workerResolutionDiagnostics": bounded_diagnostics,
            })
        derived, dimension_failures = derive_verified_plan_dimensions(
            result["final"].get("planDimensionAnalysis"), project_id=job.project_id,
            source_sha256=job.source_sha256, page_number=page_number,
            evidence_version=EVIDENCE_VERSION,
        )
        if derived:
            result["final"]["regions"].extend(derived)
            result["final"]["text"] = "\n".join(filter(None, [
                result["final"].get("text"), *[r["text"] for r in derived],
            ]))[:100000]
        if dimension_failures:
            unresolved.append({"regionKey": "plan-dimension-relationship-unverified",
                "reason": ",".join(dimension_failures),
                "bounds": {"x": 0, "y": 0, "width": 1, "height": 1}})
        return unresolved

    def fail(self, job: HostedJob, category: str, diagnostics: dict[str, Any], *, retryable: bool) -> None:
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


class RetryableIndexError(RuntimeError):
    pass


class VisualExceptionUnresolvedError(RetryableIndexError):
    def __init__(self, *, page_number: int, failures: list[dict[str, Any]]) -> None:
        super().__init__("visual_exception_unresolved")
        self.diagnostics = {
            "pageNumber": page_number,
            "failures": failures[:12],
        }


def bounded_visual_resolution_diagnostics(
    diagnostics: Any,
    *,
    page_number: int,
    region_key: str,
    exception_fingerprint: str,
) -> dict[str, Any]:
    source = diagnostics if isinstance(diagnostics, dict) else {}
    category = str(source.get("category") or "visual_resolution_unknown")[:120]
    result: dict[str, Any] = {
        "pageNumber": page_number,
        "regionKey": region_key[:300],
        "exceptionFingerprint": exception_fingerprint,
        "category": category,
    }
    status = source.get("status")
    if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599:
        result["status"] = status
    error = source.get("error")
    if isinstance(error, str) and re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,119}", error):
        result["error"] = error
    return result


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
        return validated_persisted_visual_dismissal(evidence, exception)
    return validated_persisted_visual_evidence(evidence, exception)


def visual_bounds_match(left: Any, right: Any) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    for key in ("x", "y", "width", "height"):
        try:
            left_value = float(left.get(key))
            right_value = float(right.get(key))
        except (TypeError, ValueError):
            return False
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
    plan_analysis = result["final"].get("planDimensionAnalysis")
    if isinstance(plan_analysis, dict) and any(
        t.get("regionKey") == exception.get("regionKey")
        for t in plan_analysis.get("targets", [])
    ):
        plan_analysis["reads"] = [
            r for r in plan_analysis.get("reads", []) if r.get("regionKey") != exception["regionKey"]
        ] + [{"regionKey": exception["regionKey"], "evidence": copy.deepcopy(evidence)}]
    for index, fact in enumerate(evidence.get("facts") or []):
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
            "visionProvider": fact.get("visionProvider"),
            "model": fact.get("model"),
            "assuranceProvider": fact.get("assuranceProvider"),
            "assuranceModel": fact.get("assuranceModel"),
            "evidenceVersion": evidence.get("evidenceVersion"),
            "exceptionFingerprint": evidence.get("exceptionFingerprint"),
        })


class PermanentIndexError(RuntimeError):
    pass


class PageProcessingTimeout(RuntimeError):
    pass


def log_event(event: str, **details: Any) -> None:
    print(json.dumps({"event": event, **details}, separators=(",", ":")), flush=True)


@contextmanager
def page_processing_deadline(timeout_seconds: int):
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
