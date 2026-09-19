from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from ecos_indexer.gateway import ProtectedGatewayError
from ecos_indexer.models import HostedJob
from ecos_indexer.semantic_backfill import exact_inventory, run_backfill, staged_identity


class SemanticBackfillTests(unittest.TestCase):
    def record(
        self,
        *,
        page_number: int = 1,
        region_id: str = "region-1",
        chunk_index: int = 0,
        sheet_number: str = "C6",
        chunk_text: str = "CONSTRUCT 6.0 INCH PCC PAVING",
    ) -> dict[str, object]:
        return {
            "page_number": page_number,
            "region_id": region_id,
            "chunk_index": chunk_index,
            "sheet_number": sheet_number,
            "chunk_text": chunk_text,
        }

    def test_inventory_hash_is_order_independent_and_text_sensitive(self) -> None:
        first = self.record()
        second = self.record(page_number=2, region_id="region-2")
        _, forward_hash = exact_inventory([first, second])
        _, reverse_hash = exact_inventory([second, first])
        _, changed_hash = exact_inventory([
            first,
            self.record(page_number=2, region_id="region-2", chunk_text="CHANGED"),
        ])

        self.assertEqual(forward_hash, reverse_hash)
        self.assertNotEqual(forward_hash, changed_hash)

    def test_inventory_rejects_duplicate_exact_chunk_identity(self) -> None:
        duplicate = self.record()
        with self.assertRaisesRegex(ProtectedGatewayError, "duplicate identities"):
            exact_inventory([duplicate, dict(duplicate)])

    def test_staged_identity_contains_no_embedding_or_source_text(self) -> None:
        identity = staged_identity({
            "page_number": 7,
            "region_id": "dimension-1",
            "chunk_index": 2,
            "chunk_sha256": "a" * 64,
            "embedding": [0.2] * 1536,
            "chunk_text": "must not be returned",
        })

        self.assertEqual(identity, (7, "dimension-1", 2, "a" * 64))

    @patch("ecos_indexer.semantic_backfill.OpenAIEmbeddingProvider")
    @patch("ecos_indexer.semantic_backfill.SupabaseWorkerGateway")
    def test_backfill_resumes_staging_then_materializes_before_commit(
        self,
        gateway_type: Mock,
        provider_type: Mock,
    ) -> None:
        records = [
            self.record(page_number=1, region_id="r1"),
            self.record(page_number=2, region_id="r2"),
            self.record(page_number=3, region_id="r3"),
        ]
        job = HostedJob(
            job_id="job-1",
            organization_id="org-1",
            project_id="project-1",
            document_id="document-1",
            source_provider="managed_upload",
            source_locator={},
            source_sha256="a" * 64,
            source_page_count=3,
            source_revision=None,
            mode="shadow",
            claim_token="semantic-backfill",
            retry_count=0,
        )
        gateway = gateway_type.return_value
        gateway.ready_shadow_job_for_semantic_backfill.return_value = job
        gateway.shadow_chunks_for_embedding.return_value = records
        gateway.begin_ready_shadow_semantic_backfill.return_value = {
            "runId": "run-1",
            "runToken": "token-1",
            "jobId": "job-1",
            "expectedChunkCount": 3,
            "stagedChunkCount": 1,
            "state": "staging",
        }
        gateway.staged_semantic_backfill_identities.return_value = [{
            "page_number": 1,
            "region_id": "r1",
            "chunk_index": 0,
            "chunk_sha256": staged_identity_for(records[0])[3],
        }]
        gateway.stage_ready_shadow_semantic_backfill_batch.return_value = 3
        gateway.materialize_ready_shadow_semantic_backfill_batch.side_effect = [2, 3]
        gateway.reconcile_queued_shadow_semantic_page.side_effect = [
            {
                "jobId": "job-1",
                "status": "complete",
                "pageNumber": 2,
                "chunkCount": 1,
                "remainingPageCount": 0,
            },
        ]
        gateway.commit_ready_shadow_semantic_backfill.return_value = 3
        provider = provider_type.return_value
        provider.configured = True
        provider.model = "text-embedding-3-small"
        provider.batch_size = 2
        provider.build_rows.side_effect = lambda batch: [{
            "pageNumber": row["page_number"],
            "regionId": row["region_id"],
            "chunkIndex": row["chunk_index"],
            "chunkSha256": staged_identity_for(row)[3],
            "embedding": [0.1] * 1536,
        } for row in batch]

        with TemporaryDirectory() as directory:
            receipt = run_backfill(
                job_id="job-1",
                source_sha256="a" * 64,
                receipt_dir=Path(directory),
            )
            receipt_text = Path(receipt["receiptPath"]).read_text(encoding="utf-8")

        self.assertEqual(receipt["previouslyStagedChunkCount"], 1)
        self.assertEqual(receipt["newlyEmbeddedChunkCount"], 2)
        self.assertEqual(receipt["materializedChunkCount"], 3)
        self.assertEqual(receipt["reconciledPageCount"], 1)
        self.assertEqual(
            gateway.materialize_ready_shadow_semantic_backfill_batch.call_count,
            2,
        )
        gateway.commit_ready_shadow_semantic_backfill.assert_called_once()
        self.assertNotIn("CONSTRUCT 6.0 INCH", receipt_text)
        self.assertNotIn('"embedding"', receipt_text)


def staged_identity_for(record: dict[str, object]) -> tuple[int, str, int, str]:
    from ecos_indexer.semantic_backfill import chunk_identity

    return chunk_identity(record)


if __name__ == "__main__":
    unittest.main()
