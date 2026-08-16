import os
import unittest
from unittest.mock import Mock, patch

from ecos_indexer.gateway import (
    DEFAULT_RPC_READ_TIMEOUT_SECONDS,
    PAGE_CHECKPOINT_RPC_READ_TIMEOUT_SECONDS,
    ProtectedGatewayError,
    SourceRejected,
    SupabaseWorkerGateway,
)
from ecos_indexer.models import HostedJob


class GatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "protected-test-key",
                "ECOS_MAX_SOURCE_BYTES": "1048576",
            },
            clear=False,
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    def job(self) -> HostedJob:
        return HostedJob(
            job_id="job-1",
            organization_id="org-1",
            project_id="project-1",
            document_id="document-1",
            source_provider="managed_upload",
            source_locator={"gcsBucket": "private-source", "gcsObject": "org/document.pdf"},
            source_sha256="a" * 64,
            source_page_count=1,
            source_revision=None,
            mode="shadow",
            claim_token="claim-1",
            retry_count=0,
        )

    def test_hosted_job_preserves_exact_live_text_identity_without_trimming(self) -> None:
        record = {
            "job_id": "44444444-4444-4444-8444-444444444444",
            "organization_id": "pie-rls-validation-org-a",
            "project_id": " 2321 Compliance Project ",
            "document_id": "web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603",
            "source_provider": "managed_upload",
            "source_locator": {},
            "source_sha256": "a" * 64,
            "source_page_count": 17,
            "source_revision": None,
            "mode": "shadow",
            "claim_token": "55555555-5555-4555-8555-555555555555",
            "retry_count": 0,
        }

        job = HostedJob.from_record(record)

        self.assertEqual(record["organization_id"], job.organization_id)
        self.assertEqual(record["project_id"], job.project_id)
        self.assertEqual(record["document_id"], job.document_id)

    def test_hosted_job_rejects_malformed_or_over_budget_exact_text_identity(self) -> None:
        baseline = {
            "job_id": "44444444-4444-4444-8444-444444444444",
            "organization_id": "pie-rls-validation-org-a",
            "project_id": "2321 Compliance Project",
            "document_id": "web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603",
            "source_provider": "managed_upload",
            "source_locator": {},
            "source_sha256": "a" * 64,
            "source_page_count": 17,
            "source_revision": None,
            "mode": "shadow",
            "claim_token": "55555555-5555-4555-8555-555555555555",
            "retry_count": 0,
        }
        for field, invalid in (
            ("organization_id", "pie-rls-validation-org-a\nforged"),
            ("project_id", "p" * 501),
            ("project_id", "2321 Compliance Projéct"),
            ("document_id", "d" * 201),
            ("document_id", "   "),
        ):
            with self.subTest(field=field, invalid=invalid[:20]):
                with self.assertRaisesRegex(ValueError, "Invalid exact worker identity"):
                    HostedJob.from_record({**baseline, field: invalid})

    @patch("ecos_indexer.gateway.requests.get")
    def test_private_gcs_source_uses_runtime_identity(self, get: Mock) -> None:
        token = Mock(status_code=200)
        token.json.return_value = {"access_token": "runtime-token"}
        token.raise_for_status.return_value = None
        source = Mock(status_code=200, headers={"Content-Length": "12"})
        source.iter_content.return_value = [b"%PDF-1.7\nOK"]
        source.raise_for_status.return_value = None
        get.side_effect = [token, source]

        payload = SupabaseWorkerGateway().download_source(self.job())

        self.assertEqual(payload, b"%PDF-1.7\nOK")
        self.assertEqual(get.call_args_list[0].kwargs["headers"], {"Metadata-Flavor": "Google"})
        self.assertEqual(get.call_args_list[1].kwargs["headers"], {"Authorization": "Bearer runtime-token"})

    def test_content_length_limit_fails_before_streaming(self) -> None:
        response = Mock(headers={"Content-Length": str(2 * 1024 * 1024)})
        with self.assertRaisesRegex(SourceRejected, "exceeds"):
            SupabaseWorkerGateway()._bounded_response_bytes(response)
        response.iter_content.assert_not_called()

    @patch("ecos_indexer.gateway.requests.post")
    def test_rpc_failure_reports_bounded_gateway_code(self, post: Mock) -> None:
        response = Mock(status_code=400)
        response.json.return_value = {
            "code": "22023",
            "message": "Page number is outside the verified source",
            "details": "protected database details are not included",
        }
        post.return_value = response

        with self.assertRaisesRegex(
            ProtectedGatewayError,
            "RPC ecos_checkpoint_hosted_index_page returned HTTP 400: 22023: Page number",
        ):
            SupabaseWorkerGateway().rpc("ecos_checkpoint_hosted_index_page", {"p_page_number": 31})

    @patch("ecos_indexer.gateway.requests.post")
    def test_rpc_removes_database_invalid_unicode_from_nested_page_data(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response

        result = SupabaseWorkerGateway().rpc(
            "ecos_checkpoint_hosted_index_page",
            {
                "p_final_page_data": {
                    "regions": [
                        {"text": "CANOPY\x00 A"},
                        {"text": "invalid surrogate: \ud800"},
                    ]
                }
            },
        )

        self.assertTrue(result)
        sent = post.call_args.kwargs["json"]
        self.assertEqual(sent["p_final_page_data"]["regions"][0]["text"], "CANOPY A")
        self.assertEqual(sent["p_final_page_data"]["regions"][1]["text"], "invalid surrogate: ?")

    @patch("ecos_indexer.gateway.requests.post")
    def test_only_page_checkpoint_uses_bounded_extended_read_timeout(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response
        gateway = SupabaseWorkerGateway()

        self.assertTrue(gateway.rpc("ecos_checkpoint_hosted_index_page", {}))
        self.assertEqual(
            (10, PAGE_CHECKPOINT_RPC_READ_TIMEOUT_SECONDS),
            post.call_args.kwargs["timeout"],
        )

        self.assertTrue(gateway.rpc("ecos_extend_hosted_index_lease", {}))
        self.assertEqual(
            (10, DEFAULT_RPC_READ_TIMEOUT_SECONDS),
            post.call_args.kwargs["timeout"],
        )

    @patch("ecos_indexer.gateway.requests.post")
    def test_visual_reservation_is_namespaced_by_evidence_version(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response

        reserved = SupabaseWorkerGateway().reserve_visual_region(
            self.job(),
            page_number=4,
            region_key="low-confidence-ocr-3",
            evidence_version="ecos-hosted-evidence/1.3",
            exception_fingerprint="f" * 64,
        )

        self.assertTrue(reserved)
        self.assertTrue(
            post.call_args.args[0].endswith(
                "/rest/v1/rpc/ecos_reserve_hosted_visual_region_v2"
            )
        )
        self.assertEqual(
            post.call_args.kwargs["json"],
            {
                "p_job_id": "job-1",
                "p_claim_token": "claim-1",
                "p_page_number": 4,
                "p_region_key": "low-confidence-ocr-3",
                "p_evidence_version": "ecos-hosted-evidence/1.3",
                "p_exception_fingerprint": "f" * 64,
                "p_estimated_cost_microusd": 500,
            },
        )

    @patch("ecos_indexer.gateway.requests.get")
    def test_resolved_visual_regions_are_exact_job_and_page_scoped(self, get: Mock) -> None:
        response = Mock(status_code=200, content=b"[]")
        response.json.return_value = [
            {
                "region_key": "low-confidence-3",
                "bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                "evidence_version": "ecos-hosted-evidence/1.3",
                "exception_fingerprint": "f" * 64,
                "normalized_evidence": {"evidenceText": "12'-0\"", "confidence": 0.98},
                "assurance_result": {"accepted": True},
            }
        ]
        response.raise_for_status.return_value = None
        get.return_value = response

        rows = SupabaseWorkerGateway().resolved_visual_regions(self.job(), page_number=4)

        self.assertIn("low-confidence-3", rows)
        self.assertEqual(
            get.call_args.kwargs["params"],
            {
                "job_id": "eq.job-1",
                "page_number": "eq.4",
                "state": "eq.resolved",
                "select": (
                    "region_key,bounds,evidence_version,exception_fingerprint,"
                    "normalized_evidence,assurance_result"
                ),
            },
        )

    @patch("ecos_indexer.gateway.requests.post")
    def test_visual_exception_upsert_uses_exact_versioned_contract(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response
        exception = {
            "regionKey": "low-confidence-ocr-1",
            "bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            "reason": "Bounded OCR verification required.",
        }

        result = SupabaseWorkerGateway().upsert_visual_exception(
            self.job(),
            page_number=4,
            exception=exception,
            evidence_version="ecos-hosted-evidence/1.3",
            exception_fingerprint="f" * 64,
        )

        self.assertTrue(result)
        self.assertTrue(post.call_args.args[0].endswith(
            "/rest/v1/rpc/ecos_upsert_hosted_visual_exception_v2"
        ))
        self.assertEqual("f" * 64, post.call_args.kwargs["json"]["p_exception_fingerprint"])
        self.assertEqual(exception["bounds"], post.call_args.kwargs["json"]["p_bounds"])

    @patch("ecos_indexer.gateway.requests.post")
    def test_visual_resolution_returns_false_when_rpc_did_not_persist(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"false")
        response.json.return_value = False
        post.return_value = response

        result = SupabaseWorkerGateway().resolve_visual_exception(
            self.job(),
            page_number=4,
            exception={
                "regionKey": "low-confidence-ocr-1",
                "bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                "reason": "Bounded OCR verification required.",
            },
            evidence_version="ecos-hosted-evidence/1.3",
            exception_fingerprint="f" * 64,
            normalized_evidence={"schemaVersion": "ecos-drawing-page-analysis/2.0"},
            assurance_result={"accepted": True},
        )

        self.assertFalse(result)
        self.assertTrue(post.call_args.args[0].endswith(
            "/rest/v1/rpc/ecos_resolve_hosted_visual_exception_v2"
        ))
        self.assertEqual("f" * 64, post.call_args.kwargs["json"]["p_exception_fingerprint"])

    @patch("ecos_indexer.gateway.requests.post")
    def test_visual_dismissal_uses_exact_claim_bound_rpc(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response
        target = {
            "regionKey": "low-confidence-ocr-1",
            "bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            "reason": "Bounded OCR verification required.",
        }
        dismissal = {
            "schemaVersion": "ecos-drawing-page-analysis/2.0",
            "resolutionType": "independently_unverifiable_candidates",
            "facts": [],
        }

        result = SupabaseWorkerGateway().dismiss_visual_exception(
            self.job(),
            page_number=4,
            exception=target,
            evidence_version="ecos-hosted-evidence/1.3",
            exception_fingerprint="f" * 64,
            normalized_dismissal=dismissal,
            assurance_result={"accepted": True},
        )

        self.assertTrue(result)
        self.assertTrue(post.call_args.args[0].endswith(
            "/rest/v1/rpc/ecos_dismiss_hosted_visual_exception_v1"
        ))
        self.assertEqual(dismissal, post.call_args.kwargs["json"]["p_normalized_dismissal"])


if __name__ == "__main__":
    unittest.main()
