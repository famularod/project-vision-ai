import hashlib
import json
import unittest
from unittest.mock import patch

from ecos_indexer.models import HostedJob
from ecos_indexer.security import SourceScanOperationalError, SourceSecurityRejected
from ecos_indexer.worker import HostedIndexerWorker


SOURCE = b"%PDF-1.7\nprotected source fixture"


class FakeGateway:
    def __init__(self, *, source_scan_error: Exception | None = None) -> None:
        self.source_scans = []
        self.rpc_calls = []
        self.source_scan_error = source_scan_error

    def download_source(self, _job):
        return SOURCE

    def record_source_scan(self, _job, **payload):
        self.source_scans.append(payload)
        if self.source_scan_error is not None:
            raise self.source_scan_error

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        if name == "ecos_materialize_next_hosted_shadow_page":
            return []
        return True


def hosted_job() -> HostedJob:
    return HostedJob(
        job_id="11111111-1111-4111-8111-111111111111",
        organization_id="pie-rls-validation-org-a",
        project_id="project-a",
        document_id="document-a",
        source_provider="managed_upload",
        source_locator={},
        source_sha256=hashlib.sha256(SOURCE).hexdigest(),
        source_page_count=1,
        source_revision="1",
        mode="shadow",
        claim_token="22222222-2222-4222-8222-222222222222",
        retry_count=0,
    )


def structured_events(mocked_print) -> list[dict]:
    events = []
    for call in mocked_print.call_args_list:
        if not call.args or not isinstance(call.args[0], str):
            continue
        try:
            value = json.loads(call.args[0])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            events.append(value)
    return events


class WorkerSourceSecurityTests(unittest.TestCase):
    def test_batch_cleanup_failure_remains_best_effort(self) -> None:
        class CleanupFailureGateway:
            def cleanup_operations(self) -> None:
                raise RuntimeError("bounded cleanup failure")

        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = CleanupFailureGateway()
        worker.max_jobs_per_run = 1
        worker.max_run_seconds = 60
        worker.exact_target = None
        with patch.object(
            worker,
            "claim_next_job",
            return_value=None,
        ), patch("builtins.print") as mocked_print:
            worker.run_batch()

        events = structured_events(mocked_print)
        self.assertEqual(
            1,
            sum(
                event.get("event") == "ecos_hosted_index_batch_finished"
                for event in events
            ),
        )
        self.assertFalse(any(
            event.get("event") == "ecos_hosted_source_scan_audit_failed"
            for event in events
        ))

    def test_scanner_timeout_records_failed_and_retries_without_needs_review(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway()
        error = SourceScanOperationalError("malware_scan_timeout")

        with patch("ecos_indexer.worker.scan_pdf_source", side_effect=error), patch(
            "builtins.print",
        ) as mocked_print:
            worker.process(hosted_job())

        self.assertEqual([{
            "status": "failed",
            "engine": "clamav",
            "byte_count": len(SOURCE),
        }], worker.gateway.source_scans)
        failure_calls = [call for call in worker.gateway.rpc_calls if call[0] == "ecos_fail_hosted_index_job"]
        self.assertEqual(1, len(failure_calls))
        self.assertEqual("source_security_scan_failed", failure_calls[0][1]["p_category"])
        self.assertIs(failure_calls[0][1]["p_retryable"], True)
        self.assertEqual({"detail": "malware_scan_timeout"}, failure_calls[0][1]["p_diagnostics"])

        scan_events = [
            event for event in structured_events(mocked_print)
            if event.get("event") == "ecos_hosted_source_scan_completed"
        ]
        self.assertEqual(1, len(scan_events))
        self.assertEqual("failed", scan_events[0]["status"])
        self.assertEqual("clamav", scan_events[0]["engine"])
        self.assertEqual("malware_scan_timeout", scan_events[0]["reason"])
        self.assertEqual(len(SOURCE), scan_events[0]["byteCount"])
        self.assertIsInstance(scan_events[0]["elapsedSeconds"], float)

    def test_malware_detection_remains_rejected_and_nonretryable(self) -> None:
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway()
        error = SourceSecurityRejected("malware_detected", engine="clamav")

        with patch("ecos_indexer.worker.scan_pdf_source", side_effect=error), patch("builtins.print"):
            worker.process(hosted_job())

        self.assertEqual([{
            "status": "rejected",
            "engine": "clamav",
            "byte_count": len(SOURCE),
        }], worker.gateway.source_scans)
        failure_calls = [call for call in worker.gateway.rpc_calls if call[0] == "ecos_fail_hosted_index_job"]
        self.assertEqual(1, len(failure_calls))
        self.assertEqual("source_security_rejected", failure_calls[0][1]["p_category"])
        self.assertIs(failure_calls[0][1]["p_retryable"], False)
        self.assertEqual({"detail": "malware_detected"}, failure_calls[0][1]["p_diagnostics"])

    def test_failed_and_rejected_scan_audit_persistence_failures_are_logged(self) -> None:
        cases = (
            (
                "failed",
                SourceScanOperationalError("malware_scan_timeout"),
                "source_security_scan_failed",
                True,
            ),
            (
                "rejected",
                SourceSecurityRejected("malware_detected", engine="clamav"),
                "source_security_rejected",
                False,
            ),
        )
        for status, error, expected_category, expected_retryable in cases:
            with self.subTest(status=status):
                worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
                worker.gateway = FakeGateway(
                    source_scan_error=RuntimeError(
                        "database detail must stay private"
                    ),
                )
                with patch(
                    "ecos_indexer.worker.scan_pdf_source",
                    side_effect=error,
                ), patch("builtins.print") as mocked_print:
                    worker.process(hosted_job())

                failure_calls = [
                    call for call in worker.gateway.rpc_calls
                    if call[0] == "ecos_fail_hosted_index_job"
                ]
                self.assertEqual(1, len(failure_calls))
                self.assertEqual(
                    expected_category,
                    failure_calls[0][1]["p_category"],
                )
                self.assertIs(
                    failure_calls[0][1]["p_retryable"],
                    expected_retryable,
                )

                audit_events = [
                    event for event in structured_events(mocked_print)
                    if event.get("event")
                    == "ecos_hosted_source_scan_audit_failed"
                ]
                self.assertEqual(1, len(audit_events))
                self.assertEqual(status, audit_events[0]["scanStatus"])
                self.assertEqual("clamav", audit_events[0]["engine"])
                self.assertEqual(
                    "source_scan_audit_persistence_failed",
                    audit_events[0]["reason"],
                )
                self.assertNotIn(
                    "database detail",
                    json.dumps(audit_events[0]),
                )


if __name__ == "__main__":
    unittest.main()
