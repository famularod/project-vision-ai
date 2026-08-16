import unittest
from types import SimpleNamespace

from ecos_indexer.worker import HostedIndexerWorker, RetryableIndexError


class FakeGateway:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        return self.responses.pop(0)


class ShadowMaterializationTests(unittest.TestCase):
    def worker_with(self, responses):
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeGateway(responses)
        return worker

    def test_shadow_retry_drains_durable_queue_before_continuing(self) -> None:
        worker = self.worker_with([
            [{"page_number": 4, "operation": "refresh", "chunk_count": 7}],
            [],
        ])
        job = SimpleNamespace(
            mode="shadow",
            job_id="job-1",
            claim_token="claim-1",
            document_id="document-1",
        )

        worker.drain_shadow_materializations(job)

        self.assertEqual(2, len(worker.gateway.calls))
        self.assertTrue(all(
            call[0] == "ecos_materialize_next_hosted_shadow_page"
            for call in worker.gateway.calls
        ))
        self.assertEqual({
            "p_job_id": "job-1",
            "p_claim_token": "claim-1",
        }, worker.gateway.calls[0][1])

    def test_live_job_never_uses_shadow_materializer(self) -> None:
        worker = self.worker_with([])
        job = SimpleNamespace(
            mode="live",
            job_id="job-live",
            claim_token="claim-live",
            document_id="document-live",
        )

        worker.drain_shadow_materializations(job)

        self.assertEqual([], worker.gateway.calls)

    def test_invalid_materializer_response_fails_closed(self) -> None:
        worker = self.worker_with([None])
        job = SimpleNamespace(
            mode="shadow",
            job_id="job-1",
            claim_token="claim-1",
            document_id="document-1",
        )

        with self.assertRaisesRegex(
            RetryableIndexError,
            "shadow_materialization_response_invalid",
        ):
            worker.drain_shadow_materializations(job)


if __name__ == "__main__":
    unittest.main()
