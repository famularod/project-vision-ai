import os
import unittest
from unittest.mock import Mock, patch

from ecos_indexer.gateway import ProtectedGatewayError, SourceRejected, SupabaseWorkerGateway
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
    def test_visual_dismissal_uses_exact_claim_bound_rpc(self, post: Mock) -> None:
        response = Mock(status_code=200, content=b"true")
        response.json.return_value = True
        post.return_value = response
        dismissal = {
            "schemaVersion": "ecos-drawing-page-analysis/2.0",
            "resolutionType": "independently_unverifiable_candidates",
            "facts": [],
        }

        result = SupabaseWorkerGateway().dismiss_visual_exception(
            self.job(),
            page_number=1,
            exception={
                "regionKey": "low-confidence-ocr-1",
                "bounds": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                "reason": "Bounded OCR verification required.",
            },
            evidence_version="ecos-hosted-evidence/1.3",
            exception_fingerprint="f" * 64,
            normalized_dismissal=dismissal,
            assurance_result={"accepted": True},
        )

        self.assertTrue(result)
        self.assertTrue(post.call_args.args[0].endswith(
            "/rest/v1/rpc/ecos_dismiss_hosted_visual_exception_v1"
        ))
        self.assertEqual(
            dismissal,
            post.call_args.kwargs["json"]["p_normalized_dismissal"],
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

    @patch("ecos_indexer.gateway.requests.get")
    def test_shadow_embedding_inventory_is_exact_job_and_source_scoped(self, get: Mock) -> None:
        response = Mock(status_code=200, content=b"[]")
        response.json.return_value = [{
            "page_number": 4,
            "region_id": "dimension-note",
            "chunk_index": 0,
            "chunk_text": "6 inch PCC paving",
            "sheet_number": "C6",
        }]
        response.raise_for_status.return_value = None
        get.return_value = response

        rows = SupabaseWorkerGateway().shadow_chunks_for_embedding(self.job())

        self.assertEqual(len(rows), 1)
        self.assertTrue(get.call_args.args[0].endswith("/rest/v1/ecos_hosted_shadow_chunks"))
        self.assertEqual(get.call_args.kwargs["params"], {
            "job_id": "eq.job-1",
            "organization_id": "eq.org-1",
            "project_id": "eq.project-1",
            "document_id": "eq.document-1",
            "source_sha256": f"eq.{'a' * 64}",
            "select": "page_number,region_id,chunk_index,chunk_text,sheet_number",
            "order": "page_number.asc,region_id.asc,chunk_index.asc",
            "limit": "1000",
            "offset": "0",
        })

    def test_live_job_cannot_read_shadow_embedding_inventory(self) -> None:
        live_job = HostedJob(**{**self.job().__dict__, "mode": "live"})
        with self.assertRaisesRegex(ProtectedGatewayError, "requires a shadow job"):
            SupabaseWorkerGateway().shadow_chunks_for_embedding(live_job)

    @patch.object(SupabaseWorkerGateway, "rpc")
    def test_semantic_replacement_is_atomic_and_count_checked(self, rpc: Mock) -> None:
        rows = [{
            "pageNumber": 4,
            "regionId": "dimension-note",
            "chunkIndex": 0,
            "chunkSha256": "b" * 64,
            "embedding": [0.0] * 1536,
        }]
        rpc.return_value = 1

        count = SupabaseWorkerGateway().replace_shadow_chunk_embeddings(
            self.job(),
            embedding_model="text-embedding-3-small",
            embedding_dimensions=1536,
            rows=rows,
        )

        self.assertEqual(count, 1)
        rpc.assert_called_once_with("ecos_replace_hosted_shadow_chunk_embeddings", {
            "p_job_id": "job-1",
            "p_claim_token": "claim-1",
            "p_embedding_model": "text-embedding-3-small",
            "p_embedding_dimensions": 1536,
            "p_rows": rows,
        })

        rpc.reset_mock()
        rpc.return_value = 0
        with self.assertRaisesRegex(ProtectedGatewayError, "count was incomplete"):
            SupabaseWorkerGateway().replace_shadow_chunk_embeddings(
                self.job(),
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                rows=rows,
            )

    @patch.object(SupabaseWorkerGateway, "extend_lease")
    @patch.object(SupabaseWorkerGateway, "rpc")
    def test_claimed_embeddings_are_bounded_and_finalized(self, rpc: Mock, lease: Mock) -> None:
        rows = [{"pageNumber": 1, "regionId": str(i)} for i in range(35)]
        rpc.side_effect = [35, 16, 16, 3, 35]
        with patch.dict(os.environ, {"ECOS_CLAIMED_SEMANTIC_BATCHES": "enabled"}):
            count = SupabaseWorkerGateway().replace_shadow_chunk_embeddings(self.job(),
                embedding_model="text-embedding-3-small", embedding_dimensions=1536, rows=rows)
        self.assertEqual(count, 35)
        self.assertEqual(lease.call_count, 3)
        calls = rpc.call_args_list
        self.assertEqual(calls[0].args[0], "ecos_begin_claimed_shadow_embeddings")
        self.assertEqual([len(c.args[1]["p_rows"]) for c in calls[1:4]], [16,16,3])
        self.assertEqual(calls[-1].args[0], "ecos_finish_claimed_shadow_embeddings")
        self.assertTrue(all(c.args[1]["p_claim_token"] == "claim-1" for c in calls))

    @patch.object(SupabaseWorkerGateway, "extend_lease")
    @patch.object(SupabaseWorkerGateway, "rpc")
    def test_incomplete_batch_never_finishes_and_live_jobs_cannot_batch(self, rpc: Mock, lease: Mock) -> None:
        rpc.side_effect = [20, 15]
        gateway = SupabaseWorkerGateway()
        with self.assertRaisesRegex(ProtectedGatewayError, "batch count"):
            gateway.replace_claimed_shadow_embeddings_bounded(self.job(),
                embedding_model="text-embedding-3-small", embedding_dimensions=1536, rows=[{}]*20)
        self.assertNotIn("ecos_finish_claimed_shadow_embeddings", [c.args[0] for c in rpc.call_args_list])
        rpc.reset_mock()
        with self.assertRaisesRegex(ProtectedGatewayError, "exact shadow inventory"):
            gateway.replace_claimed_shadow_embeddings_bounded(HostedJob(**{**self.job().__dict__, "mode": "live"}),
                embedding_model="text-embedding-3-small", embedding_dimensions=1536, rows=[{}])
        rpc.assert_not_called()

    @patch.object(SupabaseWorkerGateway, "extend_lease")
    @patch.object(SupabaseWorkerGateway, "rpc")
    def test_claimed_embeddings_reject_incomplete_or_malformed_final_count(self, rpc: Mock, lease: Mock) -> None:
        for wrong in (0, True, "1", None):
            rpc.side_effect = [1, 1, wrong]
            with self.assertRaisesRegex(ProtectedGatewayError, "final count"):
                SupabaseWorkerGateway().replace_claimed_shadow_embeddings_bounded(self.job(),
                    embedding_model="text-embedding-3-small", embedding_dimensions=1536, rows=[{}])

    @patch("ecos_indexer.gateway.requests.get")
    def test_ready_semantic_backfill_job_is_exact_and_idle(self, get: Mock) -> None:
        response = Mock(status_code=200, content=b"[]")
        response.json.return_value = [{
            "id": "cfbc09b0-3206-4d39-b780-5f28fc6a4ab6",
            "organization_id": "org-1",
            "project_id": "project-1",
            "document_id": "document-1",
            "source_provider": "managed_upload",
            "source_locator": {"gcsObject": "private/document.pdf"},
            "source_sha256": "a" * 64,
            "source_page_count": 8,
            "source_revision": None,
            "mode": "shadow",
            "retry_count": 0,
        }]
        response.raise_for_status.return_value = None
        get.return_value = response

        job = SupabaseWorkerGateway().ready_shadow_job_for_semantic_backfill(
            job_id="cfbc09b0-3206-4d39-b780-5f28fc6a4ab6",
            source_sha256="a" * 64,
        )

        self.assertEqual(job.job_id, "cfbc09b0-3206-4d39-b780-5f28fc6a4ab6")
        self.assertEqual(job.mode, "shadow")
        self.assertEqual(job.claim_token, "semantic-backfill")
        self.assertEqual(get.call_args.kwargs["params"]["state"], "in.(ready,assuring)")
        self.assertEqual(
            get.call_args.kwargs["params"]["committed_evidence_version"],
            "eq.ecos-hosted-evidence/1.3",
        )

    @patch.object(SupabaseWorkerGateway, "rpc")
    def test_ready_semantic_backfill_rpc_sequence_is_token_bound(self, rpc: Mock) -> None:
        rpc.side_effect = [
            {
                "runId": "run-1",
                "runToken": "token-1",
                "jobId": "job-1",
                "expectedChunkCount": 2,
                "stagedChunkCount": 0,
                "state": "staging",
            },
            2,
            2,
            {
                "jobId": "job-1",
                "status": "complete",
                "remainingPageCount": 0,
            },
            2,
            True,
        ]
        gateway = SupabaseWorkerGateway()
        run = gateway.begin_ready_shadow_semantic_backfill(
            self.job(),
            embedding_model="text-embedding-3-small",
            embedding_dimensions=1536,
        )
        staged = gateway.stage_ready_shadow_semantic_backfill_batch(
            run_id=run["runId"],
            run_token=run["runToken"],
            rows=[{
                "pageNumber": 1,
                "regionId": "r1",
                "chunkIndex": 0,
                "chunkSha256": "b" * 64,
                "embedding": [0.0] * 1536,
            }],
        )
        materialized = gateway.materialize_ready_shadow_semantic_backfill_batch(
            run_id=run["runId"],
            run_token=run["runToken"],
        )
        reconciled = gateway.reconcile_queued_shadow_semantic_page(
            job_id="job-1",
            source_sha256="a" * 64,
        )
        committed = gateway.commit_ready_shadow_semantic_backfill(
            run_id=run["runId"],
            run_token=run["runToken"],
        )
        cancelled = gateway.cancel_ready_shadow_semantic_backfill(
            run_id=run["runId"],
            run_token=run["runToken"],
        )

        self.assertEqual(staged, 2)
        self.assertEqual(materialized, 2)
        self.assertEqual(reconciled["status"], "complete")
        self.assertEqual(committed, 2)
        self.assertTrue(cancelled)
        self.assertEqual(
            rpc.call_args_list[1].args[0],
            "ecos_stage_ready_shadow_semantic_backfill_batch",
        )
        self.assertEqual(rpc.call_args_list[1].args[1]["p_run_token"], "token-1")
        self.assertEqual(
            rpc.call_args_list[2].args[0],
            "ecos_materialize_ready_shadow_semantic_backfill_batch",
        )
        self.assertEqual(
            rpc.call_args_list[3].args[0],
            "ecos_reconcile_queued_shadow_semantic_page",
        )
        self.assertEqual(
            rpc.call_args_list[4].args[0],
            "ecos_commit_ready_shadow_semantic_backfill",
        )


if __name__ == "__main__":
    unittest.main()
