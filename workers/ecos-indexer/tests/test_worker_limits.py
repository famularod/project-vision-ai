import copy
import json
import time
import unittest
from types import SimpleNamespace

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.extraction import DocumentResourceRejected
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    VisualResolution,
    visual_exception_fingerprint,
)
from ecos_indexer.worker import (
    HostedIndexerWorker,
    MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES,
    PageProcessingTimeout,
    append_visual_evidence,
    final_page_checkpoint_payload,
    hosted_checkpoint_diagnostic_sha256,
    hosted_page_checkpoint_request_bytes,
    page_processing_deadline,
    reusable_resolved_visual_evidence,
)


BOUNDS = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
PROVIDER_BOUNDS = {"x": 100, "y": 200, "width": 300, "height": 400}
ORGANIZATION_ID = "pie-rls-validation-org-a"
PROJECT_ID = "2321 Compliance Project"
DOCUMENT_ID = "web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603"
HOSTED_JOB_ID = "44444444-4444-4444-8444-444444444444"
HOSTED_CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555"
SOURCE_SHA256 = "a" * 64


def visual_exception(*, region_key="low-confidence-ocr-1", bounds=None, reason=None):
    selected_bounds = dict(bounds or BOUNDS)
    return {
        "regionKey": region_key,
        "bounds": selected_bounds,
        "reason": reason or "Low-confidence OCR requires bounded visual verification.",
        "diagnosticCandidates": [{
            "text": '4" THICK PCC WALKWAY',
            "source": "native_pdf_text",
            "confidence": 0.42,
            "bounds": dict(selected_bounds),
        }],
    }


def assured_evidence(exception, *, confidence=0.97, statement=None):
    fingerprint = visual_exception_fingerprint(exception)
    selected_bounds = dict(exception["bounds"])
    provider_bounds = {
        key: int(round(float(selected_bounds[key]) * 1000))
        for key in ("x", "y", "width", "height")
    }
    fact_statement = statement or 'The plan specifies a 4" thick PCC walkway.'
    fact = {
        "subject": "PCC walkway thickness",
        "location": "bounded north-lot note",
        "statement": fact_statement,
        "evidenceText": '4" THICK PCC WALKWAY',
        "confidence": confidence,
        "bounds": selected_bounds,
        "providerBounds": provider_bounds,
        "source": "vision",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
        "corroboratedCandidateIndexes": [0],
    }
    evidence = {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "evidenceText": fact["evidenceText"],
        "confidence": confidence,
        "facts": [fact],
        "resolutionType": "independently_resolved_candidate_partition",
        "acceptedCandidateIndexes": [0],
        "primaryAcceptedCandidateIndexes": [0],
        "assuranceAcceptedCandidateIndexes": [0],
        "primaryDismissedCandidateIndexes": [],
        "assuranceDismissedCandidateIndexes": [],
        "dismissedCandidateIndexes": [],
        "acceptedDiagnosticCandidates": exception["diagnosticCandidates"],
        "dismissedDiagnosticCandidates": [],
        "resolvedDiagnosticCandidates": exception["diagnosticCandidates"],
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
    }
    assurance = {
        "accepted": True,
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
        "assuranceProvider": "provider-b",
        "method": "bounded_visual_exception_v2",
        "minimumConfidence": 0.85,
        "acceptedFactCount": 1,
        "dismissedCandidateCount": 0,
    }
    return evidence, assurance


def stored_resolution(exception):
    evidence, assurance = assured_evidence(exception)
    return {
        "bounds": dict(exception["bounds"]),
        "evidence_version": EVIDENCE_VERSION,
        "exception_fingerprint": visual_exception_fingerprint(exception),
        "normalized_evidence": evidence,
        "assurance_result": assurance,
    }


def stored_dismissal(exception):
    fingerprint = visual_exception_fingerprint(exception)
    evidence = {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "resolutionType": "independently_unverifiable_candidates",
        "facts": [],
        "acceptedCandidateIndexes": [],
        "primaryAcceptedCandidateIndexes": [],
        "assuranceAcceptedCandidateIndexes": [],
        "primaryDismissedCandidateIndexes": [0],
        "assuranceDismissedCandidateIndexes": [0],
        "dismissedCandidateIndexes": [0],
        "dismissedDiagnosticCandidates": exception["diagnosticCandidates"],
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
    }
    assurance = {
        "accepted": True,
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
        "assuranceProvider": "provider-b",
        "method": "bounded_visual_exception_dismissal_v1",
        "acceptedFactCount": 0,
        "dismissedCandidateCount": 1,
    }
    return {
        "bounds": dict(exception["bounds"]),
        "evidence_version": EVIDENCE_VERSION,
        "exception_fingerprint": fingerprint,
        "normalized_evidence": evidence,
        "assurance_result": assurance,
    }


class FakeGateway:
    def __init__(self, resolved=None, *, resolution_persists=True):
        self.resolved = resolved or {}
        self.resolution_persists = resolution_persists
        self.rpc_calls = []
        self.reserve_calls = []
        self.upsert_calls = []
        self.resolve_calls = []
        self.dismiss_calls = []

    def resolved_visual_regions(self, _job, *, page_number):
        self.resolved_page = page_number
        return self.resolved

    def reserve_visual_region(self, _job, **payload):
        self.reserve_calls.append(payload)
        return True

    def upsert_visual_exception(self, _job, **payload):
        self.upsert_calls.append(payload)
        return True

    def resolve_visual_exception(self, _job, **payload):
        self.resolve_calls.append(payload)
        return self.resolution_persists

    def dismiss_visual_exception(self, _job, **payload):
        self.dismiss_calls.append(payload)
        return self.resolution_persists

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        return True


class FakeVisual:
    def __init__(self, configured=False, resolution=None):
        self.configured = configured
        self.resolution = resolution
        self.resolve_calls = []

    def resolve(self, **payload):
        self.resolve_calls.append(payload)
        if self.resolution is None:
            raise AssertionError("Visual provider should not have been called")
        return self.resolution


def hosted_job():
    return SimpleNamespace(
        job_id=HOSTED_JOB_ID,
        claim_token=HOSTED_CLAIM_TOKEN,
        organization_id=ORGANIZATION_ID,
        project_id=PROJECT_ID,
        document_id=DOCUMENT_ID,
        source_sha256=SOURCE_SHA256,
    )


class WorkerLimitTests(unittest.TestCase):
    def test_page_deadline_interrupts_stalled_work(self) -> None:
        with self.assertRaises(PageProcessingTimeout):
            with page_processing_deadline(0.02):
                time.sleep(0.2)

    def test_final_checkpoint_compacts_raw_visual_regions_on_a_copy(self) -> None:
        raw_regions = [{"id": "raw-1"}, {"id": "raw-2"}]
        retained = {
            "regions": [{"id": "trusted-1"}],
            "rejectedLowConfidenceRegions": [{"id": "rejected-1"}],
            "visualTileProofs": [{"tileKey": "0:0:333:500"}],
            "structuredTableAnalysis": {"tables": []},
            "legacyStructuredTableAnalysis": {},
            "attempted": True,
            "used": True,
            "reason": "fixed_visual_tile_coordinate_ocr",
            "dpi": 150,
            "tileCount": 6,
        }
        result = {
            "native": {"regions": [], "characterCount": 0},
            "ocr": {**retained, "visualTileRegions": raw_regions},
            "deterministic": {},
            "final": {
                "regions": [{"id": "trusted-1", "searchable": True}],
                "visualCoverage": {
                    "completedDeepReadRegionProofs": retained["visualTileProofs"],
                },
                "structuredTableAnalysis": retained["structuredTableAnalysis"],
            },
        }

        payload = final_page_checkpoint_payload(
            hosted_job(),
            page_number=1,
            result=result,
            assurance={"accepted": True},
            unresolved_region_count=0,
        )

        durable_ocr = payload["p_ocr_page_data"]
        for key in (
            "regions",
            "visualTileRegions",
            "visualTileProofs",
            "structuredTableAnalysis",
            "legacyStructuredTableAnalysis",
        ):
            self.assertNotIn(key, durable_ocr)
        self.assertEqual(1, durable_ocr["ocrRegionCount"])
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(retained["regions"]),
            durable_ocr["ocrRegionsSha256"],
        )
        self.assertEqual(2, durable_ocr["visualTileRegionCount"])
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(raw_regions),
            durable_ocr["visualTileRegionsSha256"],
        )
        self.assertEqual(1, durable_ocr["visualTileProofCount"])
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(retained["visualTileProofs"]),
            durable_ocr["visualTileProofsSha256"],
        )
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(retained["structuredTableAnalysis"]),
            durable_ocr["structuredTableAnalysisSha256"],
        )
        for key in (
            "rejectedLowConfidenceRegions",
            "attempted",
            "used",
            "reason",
            "dpi",
            "tileCount",
        ):
            value = retained[key]
            self.assertEqual(value, durable_ocr[key])
        self.assertIs(raw_regions, result["ocr"]["visualTileRegions"])
        self.assertNotIn("visualTileRegionCount", result["ocr"])
        self.assertEqual(
            "trusted-1",
            payload["p_final_page_data"]["regions"][0]["id"],
        )
        self.assertEqual(
            retained["visualTileProofs"],
            payload["p_final_page_data"]["visualCoverage"]["completedDeepReadRegionProofs"],
        )
        self.assertEqual(
            retained["structuredTableAnalysis"],
            payload["p_final_page_data"]["structuredTableAnalysis"],
        )
        self.assertEqual("assured", payload["p_state"])

    def test_final_checkpoint_fails_before_rpc_when_compacted_payload_is_too_large(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway()
        result = {
            "native": {"regions": [], "characterCount": 0},
            "ocr": {
                "regions": [],
                "rejectedLowConfidenceRegions": [],
                "visualTileProofs": [],
                "visualTileRegions": [],
                "structuredTableAnalysis": {},
                "attempted": True,
                "used": True,
                "reason": "bounded-test",
                "dpi": 150,
                "tileCount": 6,
            },
            "deterministic": {},
            "final": {
                "regions": [{"text": "x" * MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES}],
            },
        }

        with self.assertRaisesRegex(
            DocumentResourceRejected,
            "^hosted_page_checkpoint_request_too_large$",
        ):
            worker.checkpoint_final_page(
                hosted_job(),
                page_number=1,
                result=result,
                assurance={"accepted": True},
                unresolved_region_count=0,
            )
        self.assertEqual([], worker.gateway.rpc_calls)

    def test_final_checkpoint_accepts_page_without_structured_table_analysis(self) -> None:
        result = {
            "native": {"regions": [], "characterCount": 0},
            "ocr": {
                "regions": [{"id": "trusted-1"}],
                "rejectedLowConfidenceRegions": [],
                "visualTileProofs": [{"tileKey": "0:0:333:500"}],
                "visualTileRegions": [{"id": "raw-1"}],
                "structuredTableAnalysis": None,
            },
            "deterministic": {"structuredTableAnalysis": None},
            "final": {
                "regions": [{"id": "trusted-1", "searchable": True}],
                "structuredTableAnalysis": None,
                "visualCoverage": {
                    "completedDeepReadRegionProofs": [{"tileKey": "0:0:333:500"}],
                },
            },
        }

        payload = final_page_checkpoint_payload(
            hosted_job(),
            page_number=4,
            result=result,
            assurance={"accepted": False, "failureCodes": ["unresolved_regions"]},
            unresolved_region_count=1,
        )

        self.assertEqual("awaiting_visual", payload["p_state"])
        self.assertIsNone(payload["p_final_page_data"]["structuredTableAnalysis"])
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(None),
            payload["p_ocr_page_data"]["structuredTableAnalysisSha256"],
        )
        self.assertNotIn("structuredTableAnalysis", payload["p_ocr_page_data"])

    def test_page_checkpoint_size_uses_exact_gateway_json_encoding(self) -> None:
        payload = {"ascii": "text", "unicode": "drawing \u2014 note"}
        expected = len(json.dumps(payload, ensure_ascii=True, allow_nan=False).encode("utf-8"))
        self.assertEqual(expected, hosted_page_checkpoint_request_bytes(payload))

    def test_intermediate_visual_checkpoint_persists_while_request_is_bounded(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway()
        checkpoint = {
            "schemaVersion": "ecos-visual-coverage/1.0",
            "evidenceVersion": EVIDENCE_VERSION,
            "sourceSha256": SOURCE_SHA256,
            "pageNumber": 3,
            "regions": [{"id": "visual-tile-0:0:333:500-subtile-0:0-word-1"}],
            "completedDeepReadRegionProofs": [{"tileKey": "0:0:333:500"}],
        }

        persisted = worker.checkpoint_visual_tile_page(
            hosted_job(),
            page_number=3,
            source_sha256=SOURCE_SHA256,
            visual_tile_checkpoint=checkpoint,
        )

        self.assertTrue(persisted)
        self.assertEqual(1, len(worker.gateway.rpc_calls))
        name, payload = worker.gateway.rpc_calls[0]
        self.assertEqual("ecos_checkpoint_hosted_index_page", name)
        self.assertIs(
            checkpoint,
            payload["p_ocr_page_data"]["visualTileCheckpoint"],
        )
        self.assertEqual(1, payload["p_final_page_data"]["visualCoverage"]["completedDeepReadRegionCount"])

    def test_intermediate_visual_checkpoint_skips_oversize_request_without_rpc(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway()
        checkpoint = {
            "schemaVersion": "ecos-visual-coverage/1.0",
            "evidenceVersion": EVIDENCE_VERSION,
            "sourceSha256": SOURCE_SHA256,
            "pageNumber": 3,
            "regions": [{
                "id": "visual-tile-0:0:333:500-subtile-0:0-line-1",
                "text": "x" * MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES,
            }],
            "completedDeepReadRegionProofs": [{"tileKey": "0:0:333:500"}],
        }

        persisted = worker.checkpoint_visual_tile_page(
            hosted_job(),
            page_number=3,
            source_sha256=SOURCE_SHA256,
            visual_tile_checkpoint=checkpoint,
        )

        self.assertFalse(persisted)
        self.assertEqual([], worker.gateway.rpc_calls)

    def test_retry_reuses_only_exact_previously_assured_visual_evidence(self) -> None:
        exception = visual_exception()
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway({exception["regionKey"]: stored_resolution(exception)})
        worker.visual = FakeVisual(configured=True)
        result = {"unresolved": [exception], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

        self.assertEqual([], unresolved)
        self.assertEqual([], worker.gateway.reserve_calls)
        self.assertEqual([], worker.gateway.upsert_calls)
        self.assertEqual([], worker.gateway.resolve_calls)
        self.assertEqual([], worker.visual.resolve_calls)
        self.assertEqual('4" THICK PCC WALKWAY', result["final"]["regions"][0]["text"])
        self.assertEqual(BOUNDS, {key: result["final"]["regions"][0][key] for key in BOUNDS})
        self.assertEqual(PROVIDER_BOUNDS, result["final"]["regions"][0]["providerBounds"])
        self.assertIs(result["final"]["regions"][0]["searchable"], True)

    def test_retry_reuses_resolution_after_only_ordinal_region_key_shifts(self) -> None:
        current = visual_exception()
        current["regionKey"] = "low-confidence-ocr-1"
        stored_exception = {
            **current,
            "regionKey": "low-confidence-ocr-2",
        }
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway({
            stored_exception["regionKey"]: stored_resolution(stored_exception),
        })
        worker.visual = FakeVisual(configured=True)
        result = {"unresolved": [current], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 4, result,
        )

        self.assertEqual([], unresolved)
        self.assertEqual([], worker.gateway.reserve_calls)
        self.assertEqual([], worker.gateway.upsert_calls)
        self.assertEqual([], worker.visual.resolve_calls)
        self.assertEqual(1, len(worker.gateway.resolve_calls))
        persisted = worker.gateway.resolve_calls[0]
        current_fingerprint = visual_exception_fingerprint(current)
        self.assertEqual(current_fingerprint, persisted["exception_fingerprint"])
        self.assertEqual(
            current_fingerprint,
            persisted["normalized_evidence"]["exceptionFingerprint"],
        )
        self.assertEqual(
            current_fingerprint,
            persisted["normalized_evidence"]["facts"][0]["exceptionFingerprint"],
        )
        self.assertEqual(
            current_fingerprint,
            persisted["assurance_result"]["exceptionFingerprint"],
        )
        self.assertEqual('4" THICK PCC WALKWAY', result["final"]["regions"][0]["text"])

        changed = {
            **current,
            "diagnosticCandidates": [{
                **current["diagnosticCandidates"][0],
                "text": "DIFFERENT FACT",
            }],
        }
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway({
            stored_exception["regionKey"]: stored_resolution(stored_exception),
        })
        worker.visual = FakeVisual(configured=False)
        changed_result = {"unresolved": [changed], "final": {"regions": []}}
        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 4, changed_result,
        )
        self.assertEqual([changed], unresolved)
        self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_shifted_resolution_cycle_is_persisted_without_provider_replay(self) -> None:
        current_a = visual_exception(
            region_key="low-confidence-ocr-1",
        )
        current_b = visual_exception(
            region_key="low-confidence-ocr-2",
            bounds={"x": 0.5, "y": 0.2, "width": 0.2, "height": 0.4},
        )
        stored_a = {**current_a, "regionKey": "low-confidence-ocr-2"}
        stored_b = {**current_b, "regionKey": "low-confidence-ocr-1"}
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway({
            stored_a["regionKey"]: stored_resolution(stored_a),
            stored_b["regionKey"]: stored_resolution(stored_b),
        })
        worker.visual = FakeVisual(configured=True)
        result = {
            "unresolved": [current_a, current_b],
            "final": {"regions": []},
        }

        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 13, result,
        )

        self.assertEqual([], unresolved)
        self.assertEqual([], worker.gateway.reserve_calls)
        self.assertEqual([], worker.gateway.upsert_calls)
        self.assertEqual([], worker.visual.resolve_calls)
        self.assertEqual(2, len(worker.gateway.resolve_calls))
        self.assertEqual(
            ["low-confidence-ocr-1", "low-confidence-ocr-2"],
            [
                call["exception"]["regionKey"]
                for call in worker.gateway.resolve_calls
            ],
        )
        self.assertEqual(2, len(result["final"]["regions"]))
        for current, call in zip(
            (current_a, current_b), worker.gateway.resolve_calls,
        ):
            fingerprint = visual_exception_fingerprint(current)
            self.assertEqual(fingerprint, call["exception_fingerprint"])
            self.assertEqual(
                fingerprint,
                call["normalized_evidence"]["exceptionFingerprint"],
            )
            self.assertEqual(
                fingerprint,
                call["assurance_result"]["exceptionFingerprint"],
            )

    def test_shifted_dismissal_is_persisted_without_search_or_provider_replay(self) -> None:
        current = visual_exception(region_key="low-confidence-ocr-1")
        stored_exception = {
            **current,
            "regionKey": "low-confidence-ocr-9",
        }
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway({
            stored_exception["regionKey"]: stored_dismissal(stored_exception),
        })
        worker.visual = FakeVisual(configured=True)
        result = {"unresolved": [current], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 13, result,
        )

        self.assertEqual([], unresolved)
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual([], worker.gateway.reserve_calls)
        self.assertEqual([], worker.gateway.resolve_calls)
        self.assertEqual([], worker.visual.resolve_calls)
        self.assertEqual(1, len(worker.gateway.dismiss_calls))
        persisted = worker.gateway.dismiss_calls[0]
        fingerprint = visual_exception_fingerprint(current)
        self.assertEqual(fingerprint, persisted["exception_fingerprint"])
        self.assertEqual(
            fingerprint,
            persisted["normalized_dismissal"]["exceptionFingerprint"],
        )
        self.assertEqual(
            fingerprint,
            persisted["assurance_result"]["exceptionFingerprint"],
        )

    def test_shifted_resolution_that_cannot_persist_remains_unresolved(self) -> None:
        current = visual_exception(region_key="low-confidence-ocr-1")
        stored_exception = {
            **current,
            "regionKey": "low-confidence-ocr-2",
        }
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(
            {stored_exception["regionKey"]: stored_resolution(stored_exception)},
            resolution_persists=False,
        )
        worker.visual = FakeVisual(configured=True)
        result = {"unresolved": [current], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 13, result,
        )

        self.assertEqual([current], unresolved)
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual([], worker.gateway.reserve_calls)
        self.assertEqual([], worker.visual.resolve_calls)
        self.assertEqual(1, len(worker.gateway.resolve_calls))
        self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_first_provider_success_is_used_only_after_atomic_resolution_persists(self) -> None:
        exception = visual_exception()
        evidence, _ = assured_evidence(exception)
        provider_resolution = VisualResolution(True, {
            key: value for key, value in evidence.items()
            if key not in {"evidenceVersion", "exceptionFingerprint"}
        }, {"category": "resolved"})
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(resolution_persists=True)
        worker.visual = FakeVisual(configured=True, resolution=provider_resolution)
        result = {"unresolved": [exception], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

        self.assertEqual([], unresolved)
        self.assertEqual(1, len(worker.gateway.reserve_calls))
        self.assertEqual(
            visual_exception_fingerprint(exception),
            worker.gateway.reserve_calls[0]["exception_fingerprint"],
        )
        self.assertEqual(1, len(worker.gateway.resolve_calls))
        self.assertEqual([], worker.gateway.upsert_calls)
        self.assertEqual(1, len(result["final"]["regions"]))
        provider_context = worker.visual.resolve_calls[0]["context"]
        self.assertEqual({
            "organizationId": ORGANIZATION_ID,
            "projectId": PROJECT_ID,
            "documentId": DOCUMENT_ID,
            "sourceSha256": SOURCE_SHA256,
            "pageNumber": 4,
            "hostedJobId": HOSTED_JOB_ID,
            "hostedClaimToken": HOSTED_CLAIM_TOKEN,
            "evidenceVersion": EVIDENCE_VERSION,
            "visualExceptionFingerprint": visual_exception_fingerprint(exception),
            "visualRegionKey": exception["regionKey"],
            "documentName": DOCUMENT_ID,
        }, provider_context)
        persisted = worker.gateway.resolve_calls[0]
        self.assertEqual(EVIDENCE_VERSION, persisted["evidence_version"])
        self.assertEqual(visual_exception_fingerprint(exception), persisted["exception_fingerprint"])
        self.assertEqual(PROVIDER_BOUNDS, persisted["normalized_evidence"]["facts"][0]["providerBounds"])

    def test_provider_success_that_database_did_not_persist_remains_unresolved(self) -> None:
        exception = visual_exception()
        evidence, _ = assured_evidence(exception)
        provider_resolution = VisualResolution(True, {
            key: value for key, value in evidence.items()
            if key not in {"evidenceVersion", "exceptionFingerprint"}
        }, {"category": "resolved"})
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(resolution_persists=False)
        worker.visual = FakeVisual(configured=True, resolution=provider_resolution)
        result = {"unresolved": [exception], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

        self.assertEqual([exception], unresolved)
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual(1, len(worker.gateway.resolve_calls))
        self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_mixed_fact_and_dismissal_uses_v2_and_appends_only_searchable_fact(self) -> None:
        exception = visual_exception()
        exception["diagnosticCandidates"].append({
            "text": "SECOND CANDIDATE",
            "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.41,
            "bounds": {"x": 0.25, "y": 0.45, "width": 0.1, "height": 0.1},
        })
        evidence, _ = assured_evidence(exception)
        evidence.update({
            "acceptedDiagnosticCandidates": [exception["diagnosticCandidates"][0]],
            "dismissedDiagnosticCandidates": [exception["diagnosticCandidates"][1]],
            "primaryDismissedCandidateIndexes": [1],
            "assuranceDismissedCandidateIndexes": [1],
            "dismissedCandidateIndexes": [1],
        })
        provider_resolution = VisualResolution(True, {
            key: value for key, value in evidence.items()
            if key not in {"evidenceVersion", "exceptionFingerprint"}
        }, {"category": "resolved", "acceptedFactCount": 1, "dismissedCandidateCount": 1})
        for persists in (True, False):
            with self.subTest(persists=persists):
                worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
                worker.gateway = FakeGateway(resolution_persists=persists)
                worker.visual = FakeVisual(configured=True, resolution=provider_resolution)
                result = {"unresolved": [exception], "final": {"regions": []}}
                unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)
                self.assertEqual(1, len(worker.gateway.resolve_calls))
                self.assertEqual([], worker.gateway.dismiss_calls)
                persisted = worker.gateway.resolve_calls[0]
                self.assertEqual([1], persisted["normalized_evidence"]["dismissedCandidateIndexes"])
                self.assertEqual("bounded_visual_exception_v2", persisted["assurance_result"]["method"])
                self.assertEqual(1, persisted["assurance_result"]["acceptedFactCount"])
                self.assertEqual(1, persisted["assurance_result"]["dismissedCandidateCount"])
                self.assertEqual(0.85, persisted["assurance_result"]["minimumConfidence"])
                if persists:
                    self.assertEqual([], unresolved)
                    self.assertEqual(1, len(result["final"]["regions"]))
                    self.assertIs(result["final"]["regions"][0]["searchable"], True)
                else:
                    self.assertEqual([exception], unresolved)
                    self.assertEqual([], result["final"]["regions"])

    def test_dual_provider_dismissal_resolves_without_appending_search_evidence(self) -> None:
        exception = visual_exception()
        provider_resolution = VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "resolutionType": "independently_unverifiable_candidates",
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexes": [0],
            "dismissedCandidateIndexes": [0],
            "dismissedDiagnosticCandidates": exception["diagnosticCandidates"],
            "visionProvider": "provider-a",
            "model": "analysis-model",
            "assuranceProvider": "provider-b",
            "assuranceModel": "assurance-model",
        }, {"category": "resolved_non_evidentiary"})
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(resolution_persists=True)
        worker.visual = FakeVisual(configured=True, resolution=provider_resolution)
        result = {"unresolved": [exception], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

        self.assertEqual([], unresolved)
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual([], worker.gateway.resolve_calls)
        self.assertEqual(1, len(worker.gateway.dismiss_calls))
        persisted = worker.gateway.dismiss_calls[0]
        self.assertEqual(
            "bounded_visual_exception_dismissal_v1",
            persisted["assurance_result"]["method"],
        )
        self.assertEqual(0, persisted["assurance_result"]["acceptedFactCount"])

    def test_dismissal_that_database_did_not_persist_remains_unresolved(self) -> None:
        exception = visual_exception()
        provider_resolution = VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "resolutionType": "independently_unverifiable_candidates",
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexes": [0],
            "dismissedCandidateIndexes": [0],
            "dismissedDiagnosticCandidates": exception["diagnosticCandidates"],
            "visionProvider": "provider-a",
            "model": "analysis-model",
            "assuranceProvider": "provider-b",
            "assuranceModel": "assurance-model",
        }, {"category": "resolved_non_evidentiary"})
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(resolution_persists=False)
        worker.visual = FakeVisual(configured=True, resolution=provider_resolution)
        result = {"unresolved": [exception], "final": {"regions": []}}

        unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

        self.assertEqual([exception], unresolved)
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual(1, len(worker.gateway.dismiss_calls))
        self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_non_fact_completeness_exceptions_never_call_provider_or_reservation(self) -> None:
        for region_key in ("page-overview", "low-text-page", "title-block"):
            with self.subTest(region_key=region_key):
                exception = visual_exception(region_key=region_key)
                worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
                worker.gateway = FakeGateway()
                worker.visual = FakeVisual(configured=True)
                result = {"unresolved": [exception], "final": {"regions": []}}

                unresolved = worker.resolve_visual_exceptions(hosted_job(), object(), 4, result)

                self.assertEqual([exception], unresolved)
                self.assertEqual([], worker.gateway.reserve_calls)
                self.assertEqual([], worker.visual.resolve_calls)
                self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_page_without_visual_exceptions_avoids_retry_lookup(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = SimpleNamespace()
        worker.visual = FakeVisual(configured=True)
        unresolved = worker.resolve_visual_exceptions(
            hosted_job(), object(), 4, {"unresolved": [], "final": {"regions": []}},
        )
        self.assertEqual([], unresolved)

    def test_retry_rejects_stale_malformed_unrelated_or_misaligned_evidence(self) -> None:
        exception = visual_exception()
        baseline = stored_resolution(exception)
        cases = {}

        stale_version = copy.deepcopy(baseline)
        stale_version["evidence_version"] = "ecos-hosted-evidence/1.2"
        cases["stale row version"] = stale_version

        stale_fingerprint = copy.deepcopy(baseline)
        stale_fingerprint["exception_fingerprint"] = "0" * 64
        cases["stale fingerprint"] = stale_fingerprint

        wrong_bounds = copy.deepcopy(baseline)
        wrong_bounds["bounds"]["x"] = 0.11
        cases["wrong exception bounds"] = wrong_bounds

        unassured = copy.deepcopy(baseline)
        unassured["assurance_result"]["accepted"] = False
        cases["unassured"] = unassured

        malformed_schema = copy.deepcopy(baseline)
        malformed_schema["normalized_evidence"]["schemaVersion"] = "ecos-drawing-page-analysis/1.0"
        cases["legacy schema"] = malformed_schema

        missing_assurance_provider = copy.deepcopy(baseline)
        missing_assurance_provider["assurance_result"]["assuranceProvider"] = ""
        cases["missing independent assurance"] = missing_assurance_provider

        mismatched_assurance_provider = copy.deepcopy(baseline)
        mismatched_assurance_provider["assurance_result"]["assuranceProvider"] = "provider-c"
        cases["mismatched assurance provenance"] = mismatched_assurance_provider

        low_confidence = copy.deepcopy(baseline)
        low_confidence["normalized_evidence"]["facts"][0]["confidence"] = 0.84
        cases["low confidence"] = low_confidence

        unrelated = copy.deepcopy(baseline)
        unrelated["normalized_evidence"]["facts"][0].update({
            "subject": "door rating",
            "statement": "Door D-101 has a 90-minute rating.",
            "evidenceText": "90 MIN FIRE DOOR",
        })
        cases["unrelated fact"] = unrelated

        misaligned = copy.deepcopy(baseline)
        misaligned["normalized_evidence"]["facts"][0].update({
            "bounds": {"x": 0.7, "y": 0.7, "width": 0.1, "height": 0.1},
            "providerBounds": {"x": 700, "y": 700, "width": 100, "height": 100},
        })
        cases["misaligned proof"] = misaligned

        edge_touching = copy.deepcopy(baseline)
        edge_touching["normalized_evidence"]["facts"][0].update({
            "bounds": {"x": 0.4, "y": 0.25, "width": 0.1, "height": 0.1},
            "providerBounds": {"x": 400, "y": 250, "width": 100, "height": 100},
        })
        cases["edge-touching proof"] = edge_touching

        adjacent = copy.deepcopy(baseline)
        adjacent["normalized_evidence"]["facts"][0].update({
            "bounds": {"x": 0.405, "y": 0.25, "width": 0.1, "height": 0.1},
            "providerBounds": {"x": 405, "y": 250, "width": 100, "height": 100},
        })
        cases["adjacent proof"] = adjacent

        for label, field, value in (
            ("wrong method", "method", "bounded_visual_exception_v1"),
            ("wrong accepted count", "acceptedFactCount", 2),
            ("boolean accepted count", "acceptedFactCount", True),
            ("string accepted count", "acceptedFactCount", "1"),
            ("float accepted count", "acceptedFactCount", 1.0),
            ("wrong dismissed count", "dismissedCandidateCount", 1),
            ("boolean dismissed count", "dismissedCandidateCount", False),
            ("string dismissed count", "dismissedCandidateCount", "0"),
            ("float dismissed count", "dismissedCandidateCount", 0.0),
            ("wrong confidence policy", "minimumConfidence", 0.84),
        ):
            tampered = copy.deepcopy(baseline)
            tampered["assurance_result"][field] = value
            cases[label] = tampered

        same_provider = copy.deepcopy(baseline)
        same_provider["normalized_evidence"]["visionProvider"] = "provider-b"
        same_provider["normalized_evidence"]["facts"][0]["visionProvider"] = "provider-b"
        cases["same analysis and assurance provider"] = same_provider

        boolean_bounds = copy.deepcopy(baseline)
        boolean_bounds["bounds"]["x"] = False
        cases["boolean stored exception bounds"] = boolean_bounds
        for label, value in (
            ("string stored exception bounds", "0.1"),
            ("nonfinite stored exception bounds", float("inf")),
        ):
            changed_bounds = copy.deepcopy(baseline)
            changed_bounds["bounds"]["x"] = value
            cases[label] = changed_bounds

        for label, stored in cases.items():
            with self.subTest(label=label):
                self.assertIsNone(reusable_resolved_visual_evidence(
                    exception,
                    stored,
                    evidence_version=EVIDENCE_VERSION,
                    exception_fingerprint=visual_exception_fingerprint(exception),
                ))

    def test_append_visual_fact_is_explicitly_searchable_without_rebuilding_page_text(self) -> None:
        exception = visual_exception()
        evidence, _ = assured_evidence(exception)
        result = {"final": {"text": "native text remains authoritative", "regions": []}}
        append_visual_evidence(result, exception, evidence)
        self.assertEqual("native text remains authoritative", result["final"]["text"])
        self.assertIs(result["final"]["regions"][0]["searchable"], True)


if __name__ == "__main__":
    unittest.main()
