"""Bounded native PDF text retention, not semantic facts or answer authority.

The worker must open the exact source whose bytes it has already checked against
the job SHA-256. Returned boxes use UNROTATED crop-page coordinates, in PDF
points from the top left, matching PyMuPDF's get_text() coordinate system.
They do not use the rotated display rectangle or the MediaBox origin.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any
from uuid import UUID

from .models import HostedJob


SCHEMA_VERSION = "ecos-page-source-excerpts/2.0"
EXTRACTION_VERSION = "ecos-native-page-excerpts/2.0"
MAX_PAGE_TEXT_UTF8_BYTES = 128 * 1024
MAX_NATIVE_TEXT_BLOCKS = 256
MAX_BLOCK_TEXT_UTF8_BYTES = 16 * 1024
MAX_PAGE_DIMENSION_POINTS = 100_000
GEOMETRY_TOLERANCE_POINTS = 0.01
BASE_LIMITATION_CODES = (
    "native_text_only",
    "visual_understanding_pending",
    "semantic_fact_extraction_pending",
)


def _exact_identity(value: Any, maximum_bytes: int) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("native_excerpt_source_identity_invalid")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("native_excerpt_source_identity_invalid") from None
    if len(encoded) > maximum_bytes or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("native_excerpt_source_identity_invalid")
    return value


def _validate_source_page(job: HostedJob, page: Any, page_number: int) -> dict[str, Any]:
    if job.mode != "shadow":
        raise ValueError("native_excerpt_requires_shadow_job")
    job_id = _exact_identity(job.job_id, 100)
    try:
        if str(UUID(job_id)) != job_id:
            raise ValueError()
    except (ValueError, AttributeError):
        raise ValueError("native_excerpt_source_identity_invalid") from None
    if not isinstance(job.source_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", job.source_sha256):
        raise ValueError("native_excerpt_source_identity_invalid")
    if (
        type(job.source_page_count) is not int or not 1 <= job.source_page_count <= 10_000
        or type(page_number) is not int or not 1 <= page_number <= job.source_page_count
        or type(page.number) is not int or page.number != page_number - 1
    ):
        raise ValueError("native_excerpt_page_identity_invalid")
    return {
        "job_id": job_id,
        "organization_id": _exact_identity(job.organization_id, 500),
        "project_id": _exact_identity(job.project_id, 500),
        "source_id": _exact_identity(job.document_id, 300),
        "source_sha256": job.source_sha256,
        "source_revision": None if job.source_revision is None else _exact_identity(job.source_revision, 300),
        "page_number": page_number,
    }


def _page_dimensions(page: Any) -> tuple[float, float]:
    try:
        # cropbox dimensions stay unrotated; rect swaps axes for page rotation.
        width, height = page.cropbox.width, page.cropbox.height
        if (
            isinstance(width, bool) or isinstance(height, bool)
            or not isinstance(width, (int, float)) or not isinstance(height, (int, float))
            or not math.isfinite(width) or not math.isfinite(height)
            or not 0 < width <= MAX_PAGE_DIMENSION_POINTS
            or not 0 < height <= MAX_PAGE_DIMENSION_POINTS
        ):
            raise ValueError()
    except (AttributeError, TypeError, ValueError, OverflowError):
        raise ValueError("native_excerpt_page_dimensions_invalid") from None
    return float(width), float(height)


def _bounded_box(block: Any, width: float, height: float) -> list[float] | None:
    coordinates = block[:4]
    try:
        valid = len(coordinates) == 4 and all(
            not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
            for value in coordinates
        )
    except (ValueError, OverflowError):
        valid = False
    if not valid:
        return None
    x0, y0, x1, y1 = (float(value) for value in coordinates)
    tolerance = GEOMETRY_TOLERANCE_POINTS
    if x1 <= x0 or y1 <= y0 or x0 < -tolerance or y0 < -tolerance:
        return None
    if x1 > width + tolerance or y1 > height + tolerance:
        return None
    box = [max(0.0, x0), max(0.0, y0), min(width, x1), min(height, y1)]
    if box[2] <= box[0] or box[3] <= box[1]:
        return None
    return box


def extract_page_source_excerpts(page: Any, job: HostedJob, page_number: int) -> dict[str, Any]:
    """Retain exact native blocks with Unicode-codepoint spans and source boxes.

    Invalid source/page identities or unusable page dimensions raise a fixed,
    non-sensitive ValueError. A bounded content failure emits an empty failed
    envelope, never a clipped or silently truncated successful excerpt. Absence
    of native text does not distinguish a scan from a genuinely blank page.
    """
    source = _validate_source_page(job, page, page_number)
    content = _extract_native_content(page, page_number)
    # Keep the legacy wire and exact job provenance unchanged. Owner-preview
    # extraction calls the source-only entry point below, never a fabricated job.
    return {"schema_version": SCHEMA_VERSION, "extraction_version": EXTRACTION_VERSION,
            **source, **content}


def extract_original_page_observations(page: Any, *, source_sha256: str,
                                       source_page_count: int, page_number: int) -> dict[str, Any]:
    """Project-neutral raw native observations for a measured original page.

    The caller must hash/open the same original bytes and independently bind
    current owner/execution authority before persistence or retrieval. Supplied
    pins alone are not that proof. No legacy job, claim, manifest, project or
    ready-state identity is fabricated here. This shares the actual native
    extraction implementation with the existing worker.
    """
    source = _validate_original_page_pins(page, source_sha256, source_page_count, page_number)
    content = _extract_native_content(page, page_number)
    return {
        "schema_version": "ecos-original-native-observations/2.1",
        "extraction_version": EXTRACTION_VERSION,
        **source, **content,
        "retrieval_authorized": False, "semantic_verified": False,
        "source_identity_basis": "caller_supplied_pins_require_measured_bytes",
    }


def _validate_original_page_pins(page: Any, source_sha256: str,
                                 source_page_count: int, page_number: int) -> dict[str, Any]:
    """Validate source-only locators, not measured bytes or execution authority."""
    try:
        valid = (type(source_sha256) is str and re.fullmatch(r"[a-f0-9]{64}", source_sha256)
                 and type(source_page_count) is int and 1 <= source_page_count <= 10000
                 and type(page_number) is int and 1 <= page_number <= source_page_count
                 and type(page.number) is int and page.number == page_number - 1)
    except Exception:
        # A page wrapper can throw an exception containing source/path details.
        raise ValueError("original_native_source_identity_invalid") from None
    if not valid:
        raise ValueError("original_native_source_identity_invalid")
    return {"source_sha256": source_sha256, "source_page_count": source_page_count,
            "page_number": page_number}


def _extract_native_content(page: Any, page_number: int) -> dict[str, Any]:
    """One implementation of raw block extraction; no execution authority."""
    width, height = _page_dimensions(page)
    result: dict[str, Any] = {
        "page_width": width,
        "page_height": height,
        "coordinate_system": "pdf_points_top_left",
        "state": "unreadable",
        "page_text": "",
        "page_text_sha256": hashlib.sha256(b"").hexdigest(),
        "observed_native_block_count": 0,
        "excerpts": [],
        "limitation_codes": list(BASE_LIMITATION_CODES),
    }

    def failed(code: str) -> dict[str, Any]:
        result["state"] = "failed"
        result["limitation_codes"].append(code)
        return result

    try:
        blocks = page.get_text("blocks", sort=True)
    except Exception:
        # Provider/parser messages can contain source text. Never repeat them.
        raise ValueError("native_excerpt_extraction_failed") from None
    if not isinstance(blocks, (list, tuple)):
        raise ValueError("native_excerpt_block_structure_invalid")
    native_blocks = []
    malformed = False
    for block in blocks:
        if not isinstance(block, (list, tuple)) or len(block) < 7:
            malformed = True
            continue
        if type(block[6]) is not int or block[6] not in (0, 1):
            malformed = True
            continue
        if block[6] != 0:  # Image metadata from get_text("blocks") is not source prose.
            continue
        if not isinstance(block[4], str):
            malformed = True
            continue
        if block[4].strip():
            native_blocks.append(block)
    result["observed_native_block_count"] = len(native_blocks)
    if malformed:
        raise ValueError("native_excerpt_block_structure_invalid")
    if len(native_blocks) > MAX_NATIVE_TEXT_BLOCKS:
        return failed("native_extraction_limit_exceeded")
    if not native_blocks:
        result["limitation_codes"].append("native_text_unavailable")
        return result

    text_parts: list[str] = []
    excerpts: list[dict[str, Any]] = []
    codepoint_offset = 0
    text_bytes = 0
    for ordinal, block in enumerate(native_blocks, start=1):
        text = block[4]
        # UTF-8 cannot use fewer bytes than Python Unicode codepoints. Avoid
        # allocating another huge buffer merely to discover an oversized block.
        if len(text) > MAX_BLOCK_TEXT_UTF8_BYTES:
            return failed("native_extraction_limit_exceeded")
        try:
            encoded = text.encode("utf-8")
        except UnicodeEncodeError:
            return failed("unsupported_native_text_encoding")
        # PostgreSQL JSON/text cannot preserve NUL. Never let the existing
        # transport sanitizer silently change text after hashing/span creation.
        if "\x00" in text:
            return failed("unsupported_native_text_encoding")
        separator_length = 1 if text_parts else 0
        text_bytes += separator_length + len(encoded)
        if len(encoded) > MAX_BLOCK_TEXT_UTF8_BYTES or text_bytes > MAX_PAGE_TEXT_UTF8_BYTES:
            return failed("native_extraction_limit_exceeded")
        box = _bounded_box(block, width, height)
        if box is None:
            return failed("invalid_native_block_geometry")
        codepoint_offset += separator_length
        excerpts.append({
            "excerpt_id": f"page:{page_number}:block:{ordinal}",
            "block_ordinal": ordinal,
            "text_start": codepoint_offset,
            "text_end": codepoint_offset + len(text),
            "bbox": box,
        })
        text_parts.append(text)
        codepoint_offset += len(text)
    page_text = "\n".join(text_parts)
    result.update({
        "state": "partial",
        "page_text": page_text,
        "page_text_sha256": hashlib.sha256(page_text.encode("utf-8")).hexdigest(),
        "excerpts": excerpts,
    })
    return result
