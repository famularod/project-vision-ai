from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from .embeddings import EMBEDDING_DIMENSIONS, OpenAIEmbeddingProvider, ShadowChunk
from .gateway import ProtectedGatewayError, SupabaseWorkerGateway


EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"


def chunk_identity(record: dict[str, Any]) -> tuple[int, str, int, str]:
    chunk = ShadowChunk.from_record(record)
    return (
        chunk.page_number,
        chunk.region_id,
        chunk.chunk_index,
        chunk.chunk_sha256,
    )


def exact_inventory(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    if not records or len(records) > 25000:
        raise ProtectedGatewayError("Semantic backfill inventory was outside the exact bounds")
    identities = [chunk_identity(record) for record in records]
    if len(set(identities)) != len(identities):
        raise ProtectedGatewayError("Semantic backfill inventory contains duplicate identities")
    canonical = sorted(identities)
    digest = hashlib.sha256(
        json.dumps(canonical, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return records, digest


def staged_identity(record: dict[str, Any]) -> tuple[int, str, int, str]:
    try:
        page_number = int(record.get("page_number"))
        region_id = str(record.get("region_id") or "")
        chunk_index = int(record.get("chunk_index"))
        chunk_sha256 = str(record.get("chunk_sha256") or "")
    except (TypeError, ValueError) as error:
        raise ProtectedGatewayError("Semantic staging identity was invalid") from error
    return page_number, region_id, chunk_index, chunk_sha256


def batched(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def receipt_path(receipt_dir: Path, job_id: str, started_at: datetime) -> Path:
    stamp = started_at.strftime("%Y%m%dT%H%M%SZ")
    return receipt_dir / f"ecos-semantic-backfill-{job_id[:8]}-{stamp}.json"


def write_receipt(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def run_backfill(
    *,
    job_id: str,
    source_sha256: str,
    receipt_dir: Path,
) -> dict[str, Any]:
    started_at = datetime.now(UTC)
    gateway = SupabaseWorkerGateway()
    provider = OpenAIEmbeddingProvider()
    if not provider.configured:
        raise ProtectedGatewayError("Semantic embedding provider is not configured")

    job = gateway.ready_shadow_job_for_semantic_backfill(
        job_id=job_id,
        source_sha256=source_sha256,
    )
    records, inventory_sha256 = exact_inventory(
        gateway.shadow_chunks_for_embedding(job)
    )
    run = gateway.begin_ready_shadow_semantic_backfill(
        job,
        embedding_model=provider.model,
        embedding_dimensions=EMBEDDING_DIMENSIONS,
    )
    expected_count = int(run["expectedChunkCount"])
    if expected_count != len(records):
        raise ProtectedGatewayError("Database and worker semantic inventories did not match")

    current_identities = {chunk_identity(record) for record in records}
    staged_rows = gateway.staged_semantic_backfill_identities(run_id=str(run["runId"]))
    staged_identities = {staged_identity(record) for record in staged_rows}
    if len(staged_identities) != len(staged_rows) or not staged_identities.issubset(current_identities):
        raise ProtectedGatewayError("Resumable semantic staging did not match the exact inventory")

    missing_records = [
        record for record in records if chunk_identity(record) not in staged_identities
    ]
    newly_embedded = 0
    for batch_number, record_batch in enumerate(
        batched(missing_records, provider.batch_size),
        start=1,
    ):
        semantic_rows = provider.build_rows(record_batch)
        staged_count = gateway.stage_ready_shadow_semantic_backfill_batch(
            run_id=str(run["runId"]),
            run_token=str(run["runToken"]),
            rows=semantic_rows,
        )
        newly_embedded += len(semantic_rows)
        print(
            json.dumps({
                "event": "ecos_semantic_backfill_batch_staged",
                "jobId": job.job_id,
                "batchNumber": batch_number,
                "batchChunkCount": len(semantic_rows),
                "stagedChunkCount": staged_count,
                "expectedChunkCount": expected_count,
            }),
            flush=True,
        )

    materialized_count = 0
    promotion_batch = 0
    while materialized_count < expected_count:
        previous_count = materialized_count
        materialized_count = gateway.materialize_ready_shadow_semantic_backfill_batch(
            run_id=str(run["runId"]),
            run_token=str(run["runToken"]),
            batch_size=64,
        )
        promotion_batch += 1
        if materialized_count <= previous_count or materialized_count > expected_count:
            raise ProtectedGatewayError("Semantic promotion made invalid bounded progress")
        print(
            json.dumps({
                "event": "ecos_semantic_backfill_batch_materialized",
                "jobId": job.job_id,
                "batchNumber": promotion_batch,
                "materializedChunkCount": materialized_count,
                "expectedChunkCount": expected_count,
            }),
            flush=True,
        )

    reconciled_page_count = 0
    previous_remaining: int | None = None
    while True:
        reconciliation = gateway.reconcile_queued_shadow_semantic_page(
            job_id=job.job_id,
            source_sha256=job.source_sha256,
        )
        remaining = int(reconciliation["remainingPageCount"])
        if reconciliation.get("pageNumber") is not None:
            if previous_remaining is not None and remaining >= previous_remaining:
                raise ProtectedGatewayError(
                    "Shadow semantic reconciliation made invalid bounded progress"
                )
            previous_remaining = remaining
            reconciled_page_count += 1
            print(
                json.dumps({
                    "event": "ecos_shadow_semantic_page_reconciled",
                    "jobId": job.job_id,
                    "pageNumber": reconciliation.get("pageNumber"),
                    "chunkCount": reconciliation.get("chunkCount"),
                    "remainingPageCount": remaining,
                }),
                flush=True,
            )
        if reconciliation["status"] == "complete":
            break

    committed_count = gateway.commit_ready_shadow_semantic_backfill(
        run_id=str(run["runId"]),
        run_token=str(run["runToken"]),
    )
    if committed_count != expected_count:
        raise ProtectedGatewayError("Semantic backfill promotion count was incomplete")

    completed_at = datetime.now(UTC)
    receipt = {
        "schemaVersion": "ecos-semantic-backfill-receipt/1.0",
        "status": "passed",
        "jobId": job.job_id,
        "organizationId": job.organization_id,
        "projectId": job.project_id,
        "documentId": job.document_id,
        "sourceSha256": job.source_sha256,
        "evidenceVersion": EVIDENCE_VERSION,
        "embeddingModel": provider.model,
        "embeddingDimensions": EMBEDDING_DIMENSIONS,
        "chunkInventorySha256": inventory_sha256,
        "expectedChunkCount": expected_count,
        "previouslyStagedChunkCount": len(staged_rows),
        "newlyEmbeddedChunkCount": newly_embedded,
        "materializedChunkCount": materialized_count,
        "reconciledPageCount": reconciled_page_count,
        "committedChunkCount": committed_count,
        "backfillRunId": str(run["runId"]),
        "startedAt": started_at.isoformat(),
        "completedAt": completed_at.isoformat(),
    }
    path = receipt_path(receipt_dir, job.job_id, started_at)
    write_receipt(path, receipt)
    receipt["receiptPath"] = str(path)
    receipt["receiptSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return receipt


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely resume preparation of one exact shadow document without re-extraction."
    )
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument(
        "--receipt-dir",
        default="validation/output",
        help="Directory for a sanitized identity-only completion receipt.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    receipt = run_backfill(
        job_id=args.job_id,
        source_sha256=args.source_sha256,
        receipt_dir=Path(args.receipt_dir).resolve(),
    )
    print(json.dumps(receipt, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
