"""Exact shadow-only table receipts and independent durable resume metadata.

These receipts account for raw source cells, including null grid slots. They
are not proposed records, semantic verification, task updates, or publication.
The canonical projection digest is produced by PostgreSQL, not recomputed from
Python JSON serialization. Scope/count validation is independent of that digest.
"""

from __future__ import annotations

import re
from typing import Any, Mapping
from uuid import UUID

from .models import HostedJob
from .page_table_sources import (
    EXTRACTION_VERSION,
    MAX_COLUMNS,
    MAX_ROWS_PER_TABLE,
    MAX_TABLES,
    MAX_TOTAL_CELLS,
    SCHEMA_VERSION,
)
from .source_accountability import SourceAccountabilityError


PAGE_TABLE_SOURCES_RPC = "ecos_record_hosted_page_table_sources"
PAGE_TABLE_SOURCE_HEADS_RPC = "ecos_load_hosted_page_table_source_heads"


def shadow_native_tables_enabled(environment: Mapping[str, str]) -> bool:
    value = environment.get("ECOS_V2_SHADOW_NATIVE_TABLES", "false")
    if value not in ("true", "false"):
        raise ValueError("ECOS_V2_SHADOW_NATIVE_TABLES must be exactly true or false")
    return value == "true"


def _scope(job: HostedJob) -> dict[str, Any]:
    if job.mode != "shadow" or type(job.source_page_count) is not int or not 1 <= job.source_page_count <= 10_000:
        raise SourceAccountabilityError("v2_native_table_source_scope_invalid")
    return {
        "schema_version": SCHEMA_VERSION,
        "extraction_version": EXTRACTION_VERSION,
        "job_id": job.job_id,
        "organization_id": job.organization_id,
        "project_id": job.project_id,
        "source_id": job.document_id,
        "source_sha256": job.source_sha256,
        "source_revision": job.source_revision,
    }


def _exact(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if any(key not in value or value[key] != item for key, item in expected.items()):
        raise SourceAccountabilityError("v2_native_table_identity_mismatch")


def _counts(state: Any, tables: Any, cells: Any) -> None:
    if (type(tables) is not int or type(cells) is not int
            or not 0 <= tables <= MAX_TABLES or not 0 <= cells <= MAX_TOTAL_CELLS
            or state not in ("partial", "failed", "unreadable")
            or (state == "partial" and not 1 <= tables <= cells)
            or (state != "partial" and (tables != 0 or cells != 0))):
        raise SourceAccountabilityError("v2_native_table_counts_invalid")


def _projection_identity(value: dict[str, Any]) -> str:
    identity = value.get("projection_id")
    try:
        if not isinstance(identity, str) or str(UUID(identity)) != identity:
            raise ValueError()
    except (ValueError, AttributeError):
        raise SourceAccountabilityError("v2_native_table_projection_id_invalid") from None
    digest = value.get("projection_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise SourceAccountabilityError("v2_native_table_projection_hash_invalid")
    return identity


def page_table_source_counts(value: Any, job: HostedJob, page_number: int) -> tuple[int, int]:
    """Bind the producer's page and grid counts before any persistence request.

    This is not a second native parser: exact cell text/geometry are checked by
    the producer and durable SQL validator. The bridge owns source/page identity
    and the bounded counts used to read back the persistence receipt.
    """
    scope = _scope(job)
    if not isinstance(value, dict) or set(value) != set(scope) | {
        "page_number", "page_width", "page_height", "coordinate_system", "state", "tables", "limitation_codes",
    }:
        raise SourceAccountabilityError("v2_native_table_projection_invalid")
    _exact(value, scope)
    if (type(page_number) is not int or not 1 <= page_number <= job.source_page_count
            or type(value.get("page_number")) is not int or value["page_number"] != page_number):
        raise SourceAccountabilityError("v2_native_table_page_invalid")
    if value.get("coordinate_system") != "pdf_points_top_left":
        raise SourceAccountabilityError("v2_native_table_projection_invalid")
    tables = value.get("tables")
    if not isinstance(tables, list) or len(tables) > MAX_TABLES:
        raise SourceAccountabilityError("v2_native_table_counts_invalid")
    cell_count = 0
    for number, table in enumerate(tables, start=1):
        if not isinstance(table, dict) or set(table) != {"table_id", "bbox", "rows"}:
            raise SourceAccountabilityError("v2_native_table_projection_invalid")
        if table["table_id"] != f"page:{page_number}:table:{number}":
            raise SourceAccountabilityError("v2_native_table_projection_invalid")
        rows = table["rows"]
        if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS_PER_TABLE:
            raise SourceAccountabilityError("v2_native_table_counts_invalid")
        width = None
        for row_number, row in enumerate(rows, start=1):
            if (not isinstance(row, dict) or set(row) != {"row_number", "cells"}
                    or type(row["row_number"]) is not int or row["row_number"] != row_number):
                raise SourceAccountabilityError("v2_native_table_projection_invalid")
            cells = row["cells"]
            if (not isinstance(cells, list) or not 1 <= len(cells) <= MAX_COLUMNS
                    or (width is not None and len(cells) != width)):
                raise SourceAccountabilityError("v2_native_table_counts_invalid")
            width = len(cells)
            for column_number, cell in enumerate(cells, start=1):
                if (not isinstance(cell, dict) or set(cell) != {"column_number", "bbox", "text"}
                        or type(cell["column_number"]) is not int or cell["column_number"] != column_number):
                    raise SourceAccountabilityError("v2_native_table_projection_invalid")
            cell_count += width
            if cell_count > MAX_TOTAL_CELLS:
                raise SourceAccountabilityError("v2_native_table_counts_invalid")
    _counts(value.get("state"), len(tables), cell_count)
    return len(tables), cell_count


def validate_page_table_sources_receipt(
    value: Any, job: HostedJob, projection: dict[str, Any],
) -> dict[str, Any]:
    scope = _scope(job)
    if not isinstance(value, dict) or set(value) != set(scope) | {
        "publication_mode", "page_number", "state", "table_count", "cell_count", "projection_id", "projection_sha256",
    }:
        raise SourceAccountabilityError("v2_native_table_receipt_invalid")
    counts = page_table_source_counts(projection, job, projection.get("page_number"))
    _exact(value, {**scope, "publication_mode": "shadow", "page_number": projection["page_number"],
                   "state": projection["state"]})
    if type(value["page_number"]) is not int:
        raise SourceAccountabilityError("v2_native_table_page_invalid")
    _counts(value["state"], value["table_count"], value["cell_count"])
    if (value["table_count"], value["cell_count"]) != counts:
        raise SourceAccountabilityError("v2_native_table_receipt_counts_mismatch")
    _projection_identity(value)
    return dict(value)


def validate_page_table_source_heads(value: Any, job: HostedJob) -> set[int]:
    scope = {**_scope(job), "publication_mode": "shadow", "source_page_count": job.source_page_count}
    if not isinstance(value, dict) or set(value) != set(scope) | {"heads"}:
        raise SourceAccountabilityError("v2_native_table_heads_invalid")
    _exact(value, scope)
    if type(value["source_page_count"]) is not int:
        raise SourceAccountabilityError("v2_native_table_heads_invalid")
    heads = value["heads"]
    if not isinstance(heads, list) or len(heads) > job.source_page_count:
        raise SourceAccountabilityError("v2_native_table_heads_invalid")
    pages: set[int] = set()
    identities: set[str] = set()
    for head in heads:
        if not isinstance(head, dict) or set(head) != {
            "page_number", "state", "table_count", "cell_count", "projection_id", "projection_sha256",
        }:
            raise SourceAccountabilityError("v2_native_table_head_invalid")
        number = head["page_number"]
        if type(number) is not int or not 1 <= number <= job.source_page_count or number in pages:
            raise SourceAccountabilityError("v2_native_table_head_invalid")
        _counts(head["state"], head["table_count"], head["cell_count"])
        identity = _projection_identity(head)
        if identity in identities:
            raise SourceAccountabilityError("v2_native_table_head_invalid")
        pages.add(number)
        identities.add(identity)
    return pages
