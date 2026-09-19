from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass
from typing import Any, Iterable

import requests


EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings"


class SemanticIndexError(RuntimeError):
    pass


@dataclass(frozen=True)
class ShadowChunk:
    page_number: int
    region_id: str
    chunk_index: int
    sheet_number: str | None
    chunk_text: str

    @classmethod
    def from_record(cls, value: dict[str, Any]) -> "ShadowChunk":
        page_number = int(value.get("page_number") or 0)
        chunk_index = int(value.get("chunk_index") or 0)
        chunk_text = str(value.get("chunk_text") or "")
        if page_number < 1 or chunk_index < 0 or not chunk_text.strip():
            raise SemanticIndexError("semantic_chunk_identity_invalid")
        return cls(
            page_number=page_number,
            region_id=str(value.get("region_id") or ""),
            chunk_index=chunk_index,
            sheet_number=(
                str(value.get("sheet_number")).strip(" ")
                if value.get("sheet_number") is not None
                and str(value.get("sheet_number")).strip(" ")
                else None
            ),
            chunk_text=chunk_text,
        )

    @property
    def embedding_text(self) -> str:
        # Match the database identity contract exactly. PostgreSQL btrim()
        # removes literal spaces by default, but intentionally preserves
        # source newlines and tabs. Those bytes are part of the immutable
        # persisted chunk identity and must not be normalized here.
        return " ".join(
            part for part in (self.sheet_number, self.chunk_text) if part
        ).strip(" ")[:6000]

    @property
    def chunk_sha256(self) -> str:
        return hashlib.sha256(self.embedding_text.encode("utf-8")).hexdigest()


class OpenAIEmbeddingProvider:
    def __init__(self) -> None:
        self.api_key = (
            os.getenv("ECOS_EMBEDDING_PROVIDER_AUTH_TOKEN", "").strip()
            or
            os.getenv("ECOS_OPENAI_API_KEY", "").strip()
            or os.getenv("PIE_OPENAI_API_KEY", "").strip()
        )
        self.worker_token = os.getenv(
            "ECOS_EMBEDDING_PROVIDER_WORKER_TOKEN", ""
        ).strip()
        self.endpoint = os.getenv(
            "ECOS_EMBEDDING_PROVIDER_URL", DEFAULT_EMBEDDING_ENDPOINT
        ).strip()
        self.model = os.getenv(
            "ECOS_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL
        ).strip()
        self.batch_size = max(
            1, min(128, int(os.getenv("ECOS_EMBEDDING_BATCH_SIZE", "64")))
        )
        self.max_chunks = max(
            1,
            min(
                25000,
                int(os.getenv("ECOS_MAX_EMBEDDING_CHUNKS_PER_DOCUMENT", "25000")),
            ),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.endpoint and self.model)

    def build_rows(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not self.configured:
            raise SemanticIndexError("semantic_embedding_service_not_configured")
        if not records or len(records) > self.max_chunks:
            raise SemanticIndexError("semantic_chunk_count_out_of_bounds")
        chunks = [ShadowChunk.from_record(record) for record in records]
        texts = [chunk.embedding_text for chunk in chunks]
        embeddings: list[list[float]] = []
        for batch in batched(texts, self.batch_size):
            embeddings.extend(self._embed_batch(batch))
        if len(embeddings) != len(chunks):
            raise SemanticIndexError("semantic_embedding_count_mismatch")
        return [
            {
                "pageNumber": chunk.page_number,
                "regionId": chunk.region_id,
                "chunkIndex": chunk.chunk_index,
                "chunkSha256": chunk.chunk_sha256,
                "embedding": embedding,
            }
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        ]

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.worker_token:
            headers["x-ecos-worker-token"] = self.worker_token
        response = requests.post(
            self.endpoint,
            headers=headers,
            json={
                "model": self.model,
                "input": texts,
                "dimensions": EMBEDDING_DIMENSIONS,
                "encoding_format": "float",
            },
            timeout=(10, 90),
        )
        if response.status_code >= 400:
            category = (
                "semantic_embedding_temporarily_unavailable"
                if response.status_code == 429 or response.status_code >= 500
                else "semantic_embedding_request_rejected"
            )
            raise SemanticIndexError(f"{category}:{response.status_code}")
        try:
            payload = response.json()
        except (TypeError, ValueError) as error:
            raise SemanticIndexError("semantic_embedding_response_invalid") from error
        raw_rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(raw_rows, list) or len(raw_rows) != len(texts):
            raise SemanticIndexError("semantic_embedding_response_invalid")
        ordered = sorted(raw_rows, key=lambda item: int(item.get("index", -1)))
        vectors = [validated_embedding(row.get("embedding")) for row in ordered]
        if [int(row.get("index", -1)) for row in ordered] != list(range(len(texts))):
            raise SemanticIndexError("semantic_embedding_order_invalid")
        return vectors


def validated_embedding(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != EMBEDDING_DIMENSIONS:
        raise SemanticIndexError("semantic_embedding_dimensions_invalid")
    result: list[float] = []
    for item in value:
        try:
            candidate = float(item)
        except (TypeError, ValueError) as error:
            raise SemanticIndexError("semantic_embedding_value_invalid") from error
        if not math.isfinite(candidate):
            raise SemanticIndexError("semantic_embedding_value_invalid")
        result.append(candidate)
    return result


def batched(values: list[str], size: int) -> Iterable[list[str]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]
