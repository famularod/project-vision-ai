"""Retain bounded ruled-table cells, not verified facts or task updates.

The caller must open bytes verified against the registered job's source hash.
Cell strings are exactly what the native table parser reports, not byte-exact
PDF text. Missing/merged cells are never filled from their neighbours. Table
detection has no model, OCR, flattened-text, layout, or project-specific fallback.
Coordinates are unrotated crop-page PDF points from the top left. Rotated pages
are explicitly unsupported because PyMuPDF's rotated table path rewrites the
in-memory page and cannot currently preserve that coordinate contract safely.
"""

from __future__ import annotations

from typing import Any

from .models import HostedJob
from .page_source_excerpts import (
    _bounded_box,
    _page_dimensions,
    _validate_original_page_pins,
    _validate_source_page,
)


SCHEMA_VERSION = "ecos-page-table-sources/2.0"
EXTRACTION_VERSION = "ecos-native-table-sources/2.0"
MAX_TABLES = 16
MAX_ROWS_PER_TABLE = 256
MAX_COLUMNS = 32
MAX_TOTAL_CELLS = 4096
MAX_CELL_TEXT_UTF8_BYTES = 16 * 1024
MAX_PAGE_CELL_TEXT_UTF8_BYTES = 256 * 1024
BASE_LIMITATION_CODES = (
    "native_ruled_tables_only",
    "visual_understanding_pending",
    "authority_resolution_pending",
)


def _box(value: Any, width: float, height: float) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    return _bounded_box(value, width, height)


def _inside(inner: list[float], outer: list[float]) -> bool:
    # Page-edge floating point tolerance is handled by _bounded_box. Do not
    # extend it to the table: emitted cells must satisfy the consumer's exact
    # parent containment without silently moving text between table regions.
    return (
        inner[0] >= outer[0] and inner[1] >= outer[1]
        and inner[2] <= outer[2] and inner[3] <= outer[3]
    )


def extract_page_table_sources(page: Any, job: HostedJob, page_number: int) -> dict[str, Any]:
    """Return every detected ruled cell within the explicit page-wide bounds.

    Identity and native-parser structural errors raise fixed non-sensitive
    ValueErrors. Unsupported layouts, bad geometry, unsupported text encoding,
    and content-limit failures return an empty failed envelope, never a retained
    prefix. This local extractor does not claim complete document visibility.
    Its eventual worker caller must also enforce a processing-time deadline.
    """
    try:
        source = _validate_source_page(job, page, page_number)
        width, height = _page_dimensions(page)
    except ValueError as error:
        # Shared helpers use fixed error codes only, never source text.
        raise ValueError(str(error).replace("native_excerpt_", "native_table_")) from None
    except Exception:
        raise ValueError("native_table_source_identity_invalid") from None
    content = _extract_table_content(page, page_number, width, height)
    # Preserve the legacy job wire; the source-only caller below never creates
    # or borrows a HostedJob identity to reuse the native parser.
    return {"schema_version": SCHEMA_VERSION, "extraction_version": EXTRACTION_VERSION,
            **source, **content}


def extract_original_table_observations(page: Any, *, source_sha256: str,
                                        source_page_count: int, page_number: int) -> dict[str, Any]:
    """Project-neutral raw ruled tables from one original page, not facts.

    The caller must hash/open the same bytes and bind current source/execution
    authority before persistence or retrieval. Supplied pins alone are not
    measured-byte proof. Raw cells, unknown headers, blank/merged slots and
    parser limitations are retained by the exact existing implementation.
    No OCR fallback, rotated-page mutation, deadline preemption, or semantic
    verification is added here; callers must enforce their processing budget.
    """
    try:
        source = _validate_original_page_pins(page, source_sha256, source_page_count, page_number)
        width, height = _page_dimensions(page)
    except ValueError as error:
        raise ValueError(str(error).replace("original_native_", "original_table_")
                         .replace("native_excerpt_", "original_table_")) from None
    except Exception:
        raise ValueError("original_table_source_identity_invalid") from None
    content = _extract_table_content(page, page_number, width, height)
    return {
        "schema_version": "ecos-original-table-observations/2.1",
        "extraction_version": EXTRACTION_VERSION,
        **source, **content,
        "retrieval_authorized": False, "semantic_verified": False,
        "source_identity_basis": "caller_supplied_pins_require_measured_bytes",
    }


def _extract_table_content(page: Any, page_number: int, width: float,
                           height: float) -> dict[str, Any]:
    """One bounded native table implementation, with no execution identity."""
    result: dict[str, Any] = {
        "page_width": width,
        "page_height": height,
        "coordinate_system": "pdf_points_top_left",
        "state": "unreadable",
        "tables": [],
        "limitation_codes": list(BASE_LIMITATION_CODES),
    }

    def failed(code: str) -> dict[str, Any]:
        result["state"] = "failed"
        result["limitation_codes"].append(code)
        return result

    try:
        rotation = page.rotation
    except Exception:
        raise ValueError("native_table_page_rotation_invalid") from None
    if type(rotation) is not int or rotation not in (0, 90, 180, 270):
        raise ValueError("native_table_page_rotation_invalid")
    if rotation != 0:
        # Do not call find_tables: its internal rotation helper mutates the
        # content and resets CropBox while restoring MediaBox in PyMuPDF 1.28.2.
        return failed("unsupported_native_table_layout")
    try:
        finder = page.find_tables(
            strategy="lines_strict", use_layout=False, union=False, refine=False,
        )
        native_tables = finder.tables
    except Exception:
        raise ValueError("native_table_extraction_failed") from None
    if not isinstance(native_tables, (list, tuple)):
        raise ValueError("native_table_structure_invalid")
    if len(native_tables) > MAX_TABLES:
        return failed("native_table_extraction_limit_exceeded")
    if not native_tables:
        result["limitation_codes"].append("native_ruled_table_unavailable")
        return result

    bounded_tables: list[tuple[list[float], Any, set[tuple[float, ...]]]] = []
    for table in native_tables:
        try:
            cells = table.cells
            native_box = table.bbox
        except Exception:
            raise ValueError("native_table_structure_invalid") from None
        if not isinstance(cells, (list, tuple)) or not cells:
            raise ValueError("native_table_structure_invalid")
        # Check before Table.rows and extract(), which expand the native grid.
        if len(cells) > MAX_TOTAL_CELLS:
            return failed("native_table_extraction_limit_exceeded")
        box = _box(native_box, width, height)
        if box is None:
            return failed("invalid_native_table_geometry")
        inventory: set[tuple[float, ...]] = set()
        for native_cell in cells:
            cell_box = _box(native_cell, width, height)
            if cell_box is None or not _inside(cell_box, box):
                return failed("invalid_native_table_geometry")
            if tuple(cell_box) in inventory:
                return failed("unsupported_native_table_layout")
            inventory.add(tuple(cell_box))
        bounded_tables.append((box, table, inventory))
    bounded_tables.sort(key=lambda pair: (pair[0][1], pair[0][0], pair[0][3], pair[0][2]))

    tables: list[dict[str, Any]] = []
    total_cells = 0
    total_text_bytes = 0
    for table_number, (table_box, table, inventory) in enumerate(bounded_tables, start=1):
        try:
            native_rows = table.rows
        except Exception:
            raise ValueError("native_table_structure_invalid") from None
        if not isinstance(native_rows, (list, tuple)) or not native_rows:
            raise ValueError("native_table_structure_invalid")
        if len(native_rows) > MAX_ROWS_PER_TABLE:
            return failed("native_table_extraction_limit_exceeded")
        row_boxes: list[Any] = []
        columns: int | None = None
        column_origins = sorted({box[0] for box in inventory})
        row_origins = sorted({box[1] for box in inventory})
        if len(column_origins) > MAX_COLUMNS or len(row_origins) > MAX_ROWS_PER_TABLE:
            return failed("native_table_extraction_limit_exceeded")
        if len(native_rows) != len(row_origins):
            return failed("unsupported_native_table_layout")
        represented: set[tuple[float, ...]] = set()
        for row_number, row in enumerate(native_rows):
            try:
                cells = row.cells
            except Exception:
                raise ValueError("native_table_structure_invalid") from None
            if not isinstance(cells, (list, tuple)) or not cells:
                raise ValueError("native_table_structure_invalid")
            if len(cells) > MAX_COLUMNS:
                return failed("native_table_extraction_limit_exceeded")
            if columns is not None and len(cells) != columns:
                return failed("unsupported_native_table_layout")
            columns = len(cells)
            if columns != len(column_origins):
                return failed("unsupported_native_table_layout")
            total_cells += columns
            if total_cells > MAX_TOTAL_CELLS:
                return failed("native_table_extraction_limit_exceeded")
            normalized_cells = []
            for column_number, native_cell in enumerate(cells):
                if native_cell is None:
                    normalized_cells.append(None)
                    continue
                cell_box = _box(native_cell, width, height)
                if cell_box is None or not _inside(cell_box, table_box):
                    return failed("invalid_native_table_geometry")
                exact_box = tuple(cell_box)
                if (exact_box not in inventory or exact_box in represented
                        or cell_box[0] != column_origins[column_number]
                        or cell_box[1] != row_origins[row_number]):
                    return failed("unsupported_native_table_layout")
                represented.add(exact_box)
                normalized_cells.append(cell_box)
            row_boxes.append(normalized_cells)
        if represented != inventory:
            # Table.rows can otherwise collapse inconsistent native cells into
            # a plausible grid. Do not let that silently shorten the inventory.
            return failed("unsupported_native_table_layout")
        try:
            extracted = table.extract()
        except Exception:
            raise ValueError("native_table_extraction_failed") from None
        if not isinstance(extracted, (list, tuple)) or len(extracted) != len(row_boxes):
            raise ValueError("native_table_structure_invalid")
        rows: list[dict[str, Any]] = []
        for row_number, (cells, texts) in enumerate(zip(row_boxes, extracted), start=1):
            if not isinstance(texts, (list, tuple)) or len(texts) != columns:
                raise ValueError("native_table_structure_invalid")
            output_cells: list[dict[str, Any]] = []
            for column_number, (native_box, text) in enumerate(zip(cells, texts), start=1):
                if native_box is None:
                    if text is not None:
                        # A text value without a corresponding cell locator
                        # cannot be silently dropped or reassigned to a neighbour.
                        return failed("unsupported_native_table_layout")
                    box = None
                else:
                    box = _box(native_box, width, height)
                    if box is None or not _inside(box, table_box):
                        return failed("invalid_native_table_geometry")
                    if not isinstance(text, str):
                        raise ValueError("native_table_structure_invalid")
                    if len(text) > MAX_CELL_TEXT_UTF8_BYTES:
                        return failed("native_table_extraction_limit_exceeded")
                    try:
                        encoded = text.encode("utf-8")
                    except UnicodeEncodeError:
                        return failed("unsupported_native_table_text_encoding")
                    if "\x00" in text:
                        return failed("unsupported_native_table_text_encoding")
                    total_text_bytes += len(encoded)
                    if len(encoded) > MAX_CELL_TEXT_UTF8_BYTES or total_text_bytes > MAX_PAGE_CELL_TEXT_UTF8_BYTES:
                        return failed("native_table_extraction_limit_exceeded")
                output_cells.append({"column_number": column_number, "bbox": box, "text": text})
            rows.append({"row_number": row_number, "cells": output_cells})
        tables.append({"table_id": f"page:{page_number}:table:{table_number}", "bbox": table_box, "rows": rows})
    result.update({"state": "partial", "tables": tables})
    return result
