import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.gateway import ProtectedGatewayError, SupabaseWorkerGateway
from ecos_indexer.worker import HostedIndexerWorker, exact_target_from_environment


JOB_ID = "59736b43-7f82-49ed-876a-bdf6342810a0"
SOURCE_SHA = "a" * 64


class ExactTargetEnvironmentTests(unittest.TestCase):
    def test_both_target_values_absent_preserves_global_claiming(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(exact_target_from_environment())

    def test_one_target_value_never_falls_back_to_global_claiming(self) -> None:
        cases = (
            {"ECOS_TARGET_JOB_ID": JOB_ID},
            {"ECOS_TARGET_SOURCE_SHA256": SOURCE_SHA},
            {"ECOS_TARGET_JOB_ID": "", "ECOS_TARGET_SOURCE_SHA256": ""},
            {"ECOS_TARGET_JOB_ID": JOB_ID, "ECOS_TARGET_SOURCE_SHA256": " "},
            {"ECOS_TARGET_JOB_ID": " ", "ECOS_TARGET_SOURCE_SHA256": SOURCE_SHA},
        )
        for environment in cases:
            with self.subTest(environment=environment), patch.dict(
                os.environ, environment, clear=True
            ):
                with self.assertRaisesRegex(ValueError, "must be provided together"):
                    exact_target_from_environment()

    def test_invalid_uuid_or_checksum_fails_before_claiming(self) -> None:
        cases = (
            ({"ECOS_TARGET_JOB_ID": "not-a-uuid", "ECOS_TARGET_SOURCE_SHA256": SOURCE_SHA}, "valid UUID"),
            ({"ECOS_TARGET_JOB_ID": JOB_ID, "ECOS_TARGET_SOURCE_SHA256": "bad"}, "valid SHA-256"),
        )
        for environment, message in cases:
            with self.subTest(environment=environment), patch.dict(
                os.environ, environment, clear=True
            ):
                with self.assertRaisesRegex(ValueError, message):
                    exact_target_from_environment()

    def test_exact_target_is_canonicalized(self) -> None:
        with patch.dict(
            os.environ,
            {
                "ECOS_TARGET_JOB_ID": JOB_ID.upper(),
                "ECOS_TARGET_SOURCE_SHA256": SOURCE_SHA.upper(),
            },
            clear=True,
        ):
            self.assertEqual((JOB_ID, SOURCE_SHA), exact_target_from_environment())


class FakeClaimGateway:
    def __init__(self) -> None:
        self.calls = []
        self.cleanup_calls = 0

    def claim(self, worker_id, **kwargs):
        self.calls.append((worker_id, kwargs))
        return None

    def cleanup_operations(self):
        self.cleanup_calls += 1


class ExactTargetWorkerTests(unittest.TestCase):
    def worker(self, exact_target):
        worker = HostedIndexerWorker.__new__(HostedIndexerWorker)
        worker.gateway = FakeClaimGateway()
        worker.worker_id = "worker-test"
        worker.exact_target = exact_target
        worker.max_jobs_per_run = 1
        worker.max_run_seconds = 60
        return worker

    def test_default_worker_path_calls_only_global_claim(self) -> None:
        worker = self.worker(None)

        self.assertIsNone(worker.claim_next_job())

        self.assertEqual([("worker-test", {})], worker.gateway.calls)

    def test_exact_worker_path_binds_shadow_and_current_evidence_contract(self) -> None:
        worker = self.worker((JOB_ID, SOURCE_SHA))

        self.assertIsNone(worker.claim_next_job())

        self.assertEqual(
            [(
                "worker-test",
                {
                    "target_job_id": JOB_ID,
                    "target_source_sha256": SOURCE_SHA,
                    "expected_mode": "shadow",
                    "expected_evidence_version": EVIDENCE_VERSION,
                },
            )],
            worker.gateway.calls,
        )

    @patch("builtins.print")
    def test_default_batch_preserves_global_maintenance_cleanup(self, _print: Mock) -> None:
        worker = self.worker(None)

        worker.run_batch()

        self.assertEqual(1, worker.gateway.cleanup_calls)

    @patch("builtins.print")
    def test_exact_batch_never_runs_global_maintenance_cleanup(self, _print: Mock) -> None:
        worker = self.worker((JOB_ID, SOURCE_SHA))

        worker.run_batch()

        self.assertEqual(0, worker.gateway.cleanup_calls)


class ExactTargetGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "protected-test-key",
            },
            clear=True,
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    @patch("ecos_indexer.gateway.requests.post")
    def test_default_gateway_path_uses_existing_global_rpc(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"[]")
        response.json.return_value = []
        post.return_value = response

        self.assertIsNone(SupabaseWorkerGateway().claim("worker-test"))

        self.assertTrue(post.call_args.args[0].endswith("/rpc/ecos_claim_hosted_index_job"))
        self.assertEqual(
            {"p_worker_id": "worker-test", "p_lease_seconds": 1800},
            post.call_args.kwargs["json"],
        )

    @patch("ecos_indexer.gateway.requests.post")
    def test_exact_gateway_path_uses_only_exact_rpc_and_contract(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"[]")
        response.json.return_value = []
        post.return_value = response

        self.assertIsNone(SupabaseWorkerGateway().claim(
            "worker-test",
            target_job_id=JOB_ID,
            target_source_sha256=SOURCE_SHA.upper(),
            expected_mode="shadow",
            expected_evidence_version=EVIDENCE_VERSION,
        ))

        self.assertTrue(
            post.call_args.args[0].endswith("/rpc/ecos_claim_exact_hosted_index_job")
        )
        self.assertEqual(
            {
                "p_worker_id": "worker-test",
                "p_job_id": JOB_ID,
                "p_expected_source_sha256": SOURCE_SHA,
                "p_expected_mode": "shadow",
                "p_expected_evidence_version": EVIDENCE_VERSION,
                "p_lease_seconds": 1800,
            },
            post.call_args.kwargs["json"],
        )

    @patch("ecos_indexer.gateway.requests.post")
    def test_incomplete_or_wrong_exact_contract_never_calls_any_rpc(self, post: Mock) -> None:
        gateway = SupabaseWorkerGateway()
        cases = (
            ({"target_job_id": JOB_ID}, "incomplete"),
            ({
                "target_job_id": "wrong",
                "target_source_sha256": SOURCE_SHA,
                "expected_mode": "shadow",
                "expected_evidence_version": EVIDENCE_VERSION,
            }, "job id"),
            ({
                "target_job_id": JOB_ID,
                "target_source_sha256": "bad",
                "expected_mode": "shadow",
                "expected_evidence_version": EVIDENCE_VERSION,
            }, "checksum"),
            ({
                "target_job_id": JOB_ID,
                "target_source_sha256": SOURCE_SHA,
                "expected_mode": "live",
                "expected_evidence_version": EVIDENCE_VERSION,
            }, "mode"),
            ({
                "target_job_id": JOB_ID,
                "target_source_sha256": SOURCE_SHA,
                "expected_mode": "shadow",
                "expected_evidence_version": "ecos-hosted-evidence/1.2",
            }, "evidence"),
        )
        for payload, message in cases:
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(ProtectedGatewayError, message):
                    gateway.claim("worker-test", **payload)
        post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
