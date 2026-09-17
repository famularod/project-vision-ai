"""Validate database-frozen raw table inventories, never semantic answer proof.

The database supplies immutable manifest/result digests in its canonical JSONB
encoding. Python validates their shape and independent job/source scope; it does
not pretend a different JSON serialization verifies those database digests.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .models import HostedJob
from .page_table_sources import EXTRACTION_VERSION, MAX_TABLES
from .source_accountability import SourceAccountabilityError


TABLE_SOURCE_MANIFEST_SNAPSHOT_RPC = "ecos_snapshot_hosted_table_source_accountability"
TABLE_SOURCE_MANIFEST_SCHEMA_VERSION = "ecos-table-source-manifest/2.0"
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
BASE_LIMITATIONS = (
    "native_ruled_tables_only", "visual_understanding_pending", "authority_resolution_pending",
)
MANIFEST_KEYS = {
    "schema_version", "publication_mode", "job_id", "manifest_id", "manifest_sha256",
    "organization_id", "project_id", "source_id", "source_sha256", "source_revision",
    "source_kind", "source_page_count", "extraction_version", "reported_item_count",
    "terminal_item_count", "usable_item_count", "gap_item_count", "fully_accounted", "fully_usable", "items",
}
ITEM_KEYS = {
    "page_number", "item_key", "state", "reported", "extraction_methods", "evidence_record_count",
    "limitation_codes", "gap_code", "result_sha256", "projection_id", "projection_sha256",
}


def _invalid(code: str) -> None:
    raise SourceAccountabilityError(f"v2_table_manifest_{code}")


def _pin(value: Any, *, uuid: bool = False) -> str:
    pattern = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}" if uuid else r"[a-f0-9]{64}"
    if type(value) is not str or not re.fullmatch(pattern, value):
        _invalid("pin_invalid")
    return value


def _identity(value: Any, maximum: int) -> str:
    if (type(value) is not str or not value or len(value) > maximum
            or value.strip() != value or value.startswith("\ufeff") or value.endswith("\ufeff")
            or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value)
            or len(value.encode("utf-8")) > maximum):
        _invalid("scope_invalid")
    return value


def _strings(value: Any, expected: tuple[str, ...]) -> list[str]:
    if (type(value) is not list or len(value) != len(expected)
            or any(type(item) is not str for item in value)
            or len(set(value)) != len(value) or set(value) != set(expected)):
        _invalid("item_state_invalid")
    return list(value)


def _expected_scope(job: HostedJob, expected_page_count: int | None = None) -> dict[str, Any]:
    count = job.source_page_count if expected_page_count is None else expected_page_count
    if job.mode != "shadow" or type(count) is not int or not 1 <= count <= 10_000:
        _invalid("scope_invalid")
    return {
        "schema_version": TABLE_SOURCE_MANIFEST_SCHEMA_VERSION,
        "publication_mode": "shadow", "job_id": _pin(job.job_id, uuid=True),
        "organization_id": _identity(job.organization_id, 500),
        "project_id": _identity(job.project_id, 500),
        "source_id": _identity(job.document_id, 300), "source_sha256": _pin(job.source_sha256),
        "source_revision": None if job.source_revision is None else _identity(job.source_revision, 300),
        "source_kind": "other", "source_page_count": count, "extraction_version": EXTRACTION_VERSION,
    }


def table_source_manifest_payload(job: HostedJob, *, expected_page_count: int | None = None) -> dict[str, str]:
    _expected_scope(job, expected_page_count)
    return {"p_job_id": _pin(job.job_id, uuid=True), "p_claim_token": _pin(job.claim_token, uuid=True)}


def validate_table_source_manifest(
    value: Any, job: HostedJob, *, expected_page_count: int | None = None,
) -> dict[str, Any]:
    """Return an independent data copy after exhaustive bounded wire checks.

    Counts are the registered source count, never the number of returned items.
    Native partial, failed, unreadable and missing pages all remain source gaps.
    """
    expected = _expected_scope(job, expected_page_count)
    count = expected["source_page_count"]
    if type(value) is not dict or set(value) != MANIFEST_KEYS:
        _invalid("wire_invalid")
    if any(type(value[key]) is not type(item) or value[key] != item for key, item in expected.items()):
        _invalid("scope_mismatch")
    result = {**expected, "manifest_id": _pin(value["manifest_id"], uuid=True),
              "manifest_sha256": _pin(value["manifest_sha256"])}
    items = value["items"]
    if type(items) is not list or len(items) != count:
        _invalid("inventory_invalid")
    copied = []
    reported_count = usable_count = 0
    projection_ids: set[str] = set()
    result_hashes: set[str] = set()
    for number, item in enumerate(items, start=1):
        if type(item) is not dict or set(item) != ITEM_KEYS:
            _invalid("item_invalid")
        if (type(item["page_number"]) is not int or item["page_number"] != number
                or type(item["item_key"]) is not str or item["item_key"] != f"page:{number}"):
            _invalid("inventory_invalid")
        state = item["state"]
        if type(state) is not str or state not in ("pending", "partial", "unreadable", "failed"):
            _invalid("item_state_invalid")
        reported = state != "pending"
        gap = {"pending": "missing_processing_result", "partial": "partially_readable",
               "unreadable": "unreadable_content", "failed": "processing_failed"}[state]
        if (type(item["reported"]) is not bool or item["reported"] != reported
                or type(item["gap_code"]) is not str or item["gap_code"] != gap):
            _invalid("item_state_invalid")
        methods = _strings(item["extraction_methods"], ("structured_table",) if state == "partial" else ())
        limitations = ("missing_processing_result",) if state == "pending" else BASE_LIMITATIONS + (
            ("native_ruled_table_unavailable",) if state == "unreadable" else
            ("native_table_processing_failed",) if state == "failed" else ()
        )
        codes = _strings(item["limitation_codes"], limitations)
        table_count = item["evidence_record_count"]
        if type(table_count) is not int or not (1 <= table_count <= MAX_TABLES if state == "partial" else table_count == 0):
            _invalid("item_count_invalid")
        result_hash = _pin(item["result_sha256"])
        if result_hash in result_hashes:
            _invalid("duplicate_result")
        result_hashes.add(result_hash)
        projection_id = projection_hash = None
        if reported:
            projection_id = _pin(item["projection_id"], uuid=True)
            projection_hash = _pin(item["projection_sha256"])
            if projection_id in projection_ids:
                _invalid("duplicate_projection")
            projection_ids.add(projection_id)
        elif item["projection_id"] is not None or item["projection_sha256"] is not None:
            _invalid("pending_projection_invalid")
        reported_count += reported
        usable_count += state == "partial"
        copied.append({
            "page_number": number, "item_key": f"page:{number}", "state": state, "reported": reported,
            "extraction_methods": methods, "evidence_record_count": table_count, "limitation_codes": codes,
            "gap_code": gap, "result_sha256": result_hash, "projection_id": projection_id,
            "projection_sha256": projection_hash,
        })
    summary = {
        "reported_item_count": reported_count, "terminal_item_count": reported_count,
        "usable_item_count": usable_count, "gap_item_count": count,
        "fully_accounted": reported_count == count, "fully_usable": False,
    }
    if any(type(value[key]) is not type(item) or value[key] != item for key, item in summary.items()):
        _invalid("aggregate_mismatch")
    result.update(summary)
    result["items"] = copied
    # Every field was bounded before serialization; there is no arbitrary raw
    # object traversal or private document text in this metadata-only response.
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_MANIFEST_BYTES:
        _invalid("size_exceeded")
    return result
