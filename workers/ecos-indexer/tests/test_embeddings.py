from __future__ import annotations

import hashlib
import os
import unittest
from unittest.mock import Mock, patch

from ecos_indexer.embeddings import (
    EMBEDDING_DIMENSIONS,
    OpenAIEmbeddingProvider,
    SemanticIndexError,
    ShadowChunk,
    validated_embedding,
)


class EmbeddingTests(unittest.TestCase):
    def test_shadow_chunk_identity_matches_database_contract(self) -> None:
        chunk = ShadowChunk.from_record({
            "page_number": 7,
            "region_id": "north-lot-note",
            "chunk_index": 2,
            "sheet_number": "C6",
            "chunk_text": "CONSTRUCT 6.0 INCH PCC PAVING",
        })

        self.assertEqual(chunk.embedding_text, "C6 CONSTRUCT 6.0 INCH PCC PAVING")
        self.assertEqual(chunk.chunk_sha256, hashlib.sha256(
            chunk.embedding_text.encode("utf-8")
        ).hexdigest())

    def test_shadow_chunk_identity_preserves_source_newlines_and_tabs(self) -> None:
        chunk = ShadowChunk.from_record({
            "page_number": 2,
            "region_id": "page-text-1",
            "chunk_index": 1,
            "sheet_number": " SIP-SHT-2 ",
            "chunk_text": "\n+\nLATERAL\nNW\t",
        })

        self.assertEqual(chunk.sheet_number, "SIP-SHT-2")
        self.assertEqual(chunk.embedding_text, "SIP-SHT-2 \n+\nLATERAL\nNW\t")
        self.assertEqual(
            chunk.chunk_sha256,
            "bdeda7327fff2c817eb5dac67424577595f50cde7c4feca8e99da3f7d8a19db0",
        )

    def test_embedding_validation_fails_closed(self) -> None:
        with self.assertRaisesRegex(SemanticIndexError, "dimensions"):
            validated_embedding([0.1, 0.2])
        with self.assertRaisesRegex(SemanticIndexError, "value"):
            validated_embedding(
                [0.1] * (EMBEDDING_DIMENSIONS - 1) + [float("nan")]
            )

    @patch.dict(os.environ, {}, clear=True)
    def test_provider_requires_server_side_credentials(self) -> None:
        provider = OpenAIEmbeddingProvider()

        self.assertFalse(provider.configured)
        with self.assertRaisesRegex(SemanticIndexError, "not_configured"):
            provider.build_rows([{
                "page_number": 1,
                "chunk_index": 0,
                "chunk_text": "bounded evidence",
            }])

    @patch.dict(os.environ, {
        "ECOS_EMBEDDING_PROVIDER_URL": "https://example.supabase.co/functions/v1/ecos-embedding-provider",
        "ECOS_EMBEDDING_PROVIDER_AUTH_TOKEN": "service-role-token",
        "ECOS_EMBEDDING_PROVIDER_WORKER_TOKEN": "worker-token",
    }, clear=True)
    @patch("ecos_indexer.embeddings.requests.post")
    def test_private_bridge_uses_separate_service_credentials(self, post: Mock) -> None:
        post.return_value.status_code = 200
        post.return_value.json.return_value = {
            "data": [{
                "index": 0,
                "embedding": [0.001] * EMBEDDING_DIMENSIONS,
            }],
        }
        provider = OpenAIEmbeddingProvider()

        rows = provider.build_rows([{
            "page_number": 1,
            "chunk_index": 0,
            "chunk_text": "bounded evidence",
        }])

        self.assertEqual(len(rows), 1)
        _, kwargs = post.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer service-role-token")
        self.assertEqual(kwargs["headers"]["x-ecos-worker-token"], "worker-token")
        self.assertNotIn("service-role-token", str(kwargs["json"]))
        self.assertNotIn("worker-token", str(kwargs["json"]))


if __name__ == "__main__":
    unittest.main()
