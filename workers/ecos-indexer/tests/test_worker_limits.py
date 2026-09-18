import copy
import time
import unittest
from types import SimpleNamespace

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.visual import (
    VISUAL_DISMISSAL_TYPE,
    VISUAL_SCHEMA_VERSION,
    VisualResolution,
    visual_exception_fingerprint,
)
from ecos_indexer.worker import (
    HostedIndexerWorker,
    PageProcessingTimeout,
    VisualExceptionUnresolvedError,
    bounded_visual_resolution_diagnostics,
    page_processing_deadline,
    reusable_resolved_visual_evidence,
    visual_exception_inventory,
)


BOUNDS = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
PROVIDER_BOUNDS = {"x": 100, "y": 200, "width": 300, "height": 400}


class ExceptionInventoryTests(unittest.TestCase):
    def test_inventory_binds_claim_without_persisting_the_capability(self):
        import hashlib
        job = hosted_job()
        exception = visual_exception()
        inventory = visual_exception_inventory(job, 4, [exception])
        self.assertEqual(inventory["sourceSha256"], job.source_sha256)
        self.assertEqual(inventory["claimSha256"], hashlib.sha256(job.claim_token.encode()).hexdigest())
        self.assertEqual(inventory["items"][0]["exceptionFingerprint"], visual_exception_fingerprint(exception))
        self.assertNotIn(job.claim_token, str(inventory))
        self.assertEqual(visual_exception_inventory(job, 4, [])["items"], [])
        with self.assertRaises(ValueError):
            visual_exception_inventory(job, 4, [exception, exception])


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
    fact_statement = statement or 'The plan specifies a 4" thick PCC walkway.'
    fact = {
        "subject": "PCC walkway thickness",
        "location": "bounded north-lot note",
        "statement": fact_statement,
        "evidenceText": '4" THICK PCC WALKWAY',
        "confidence": confidence,
        "bounds": dict(BOUNDS),
        "providerBounds": dict(PROVIDER_BOUNDS),
        "source": "vision",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "evidenceVersion": EVIDENCE_VERSION,
        "exceptionFingerprint": fingerprint,
    }
    evidence = {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "evidenceText": fact["evidenceText"],
        "confidence": confidence,
        "facts": [fact],
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
        "acceptedFactCount": 1,
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
        job_id="189bbdfe-6fc7-4f84-8a5e-8d8fa813b586",
        claim_token="859b4e84-85d0-4897-ab68-6426cf11aef3",
        organization_id="pie-rls-validation-org-a",
        project_id="project",
        document_id="document",
        source_sha256="7" * 64,
    )


class WorkerLimitTests(unittest.TestCase):
    def test_visual_failure_diagnostics_are_bounded_and_never_include_raw_provider_data(self) -> None:
        diagnostics = bounded_visual_resolution_diagnostics(
            {
                "category": "visual_service_request_rejected",
                "status": 400,
                "error": "analysis_operation_identity_invalid",
                "rawProviderBody": {"secret": "must-not-persist"},
            },
            page_number=1,
            region_key="low-confidence-ocr-1",
            exception_fingerprint="a" * 64,
        )

        self.assertEqual({
            "pageNumber": 1,
            "regionKey": "low-confidence-ocr-1",
            "exceptionFingerprint": "a" * 64,
            "category": "visual_service_request_rejected",
            "status": 400,
            "error": "analysis_operation_identity_invalid",
        }, diagnostics)
        self.assertNotIn("rawProviderBody", diagnostics)

    def test_visual_unresolved_error_carries_only_bounded_failures(self) -> None:
        error = VisualExceptionUnresolvedError(
            page_number=2,
            failures=[{"category": "one"}] * 20,
        )
        self.assertEqual("visual_exception_unresolved", str(error))
        self.assertEqual(2, error.diagnostics["pageNumber"])
        self.assertEqual(12, len(error.diagnostics["failures"]))

    def test_page_deadline_interrupts_stalled_work(self) -> None:
        with self.assertRaises(PageProcessingTimeout):
            with page_processing_deadline(0.02):
                time.sleep(0.2)

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

        self.assertEqual([exception], [
            {
                key: value for key, value in item.items()
                if key != "workerResolutionDiagnostics"
            }
            for item in unresolved
        ])
        self.assertEqual(
            "visual_resolution_persistence_failed",
            unresolved[0]["workerResolutionDiagnostics"]["category"],
        )
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual(1, len(worker.gateway.resolve_calls))
        self.assertEqual(1, len(worker.gateway.upsert_calls))

    def test_two_provider_dismissal_persists_without_search_evidence(self) -> None:
        exception = visual_exception()
        provider_resolution = VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "resolutionType": VISUAL_DISMISSAL_TYPE,
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
        self.assertEqual(
            "bounded_visual_exception_dismissal_v1",
            worker.gateway.dismiss_calls[0]["assurance_result"]["method"],
        )

    def test_unpersisted_dismissal_remains_unresolved(self) -> None:
        exception = visual_exception()
        provider_resolution = VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "resolutionType": VISUAL_DISMISSAL_TYPE,
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

        self.assertEqual(1, len(unresolved))
        self.assertEqual([], result["final"]["regions"])
        self.assertEqual([], worker.gateway.resolve_calls)
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

                # Nothing a provider could resolve: the page records a
                # limitation instead of an open exception that would burn
                # every retry and block the rest of the document.
                self.assertEqual([], unresolved)
                self.assertEqual([], worker.gateway.reserve_calls)
                self.assertEqual([], worker.visual.resolve_calls)
                self.assertEqual([], worker.gateway.upsert_calls)
                self.assertEqual(
                    [region_key],
                    [item["regionKey"] for item in result["final"]["pageLimitations"]],
                )

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

        for label, stored in cases.items():
            with self.subTest(label=label):
                self.assertIsNone(reusable_resolved_visual_evidence(
                    exception,
                    stored,
                    evidence_version=EVIDENCE_VERSION,
                    exception_fingerprint=visual_exception_fingerprint(exception),
                ))


if __name__ == "__main__":
    unittest.main()
