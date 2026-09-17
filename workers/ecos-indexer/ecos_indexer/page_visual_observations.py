"""Raw pixel OCR observations, NOT native PDF text or answer authority.

This pure parser is shared with the offline renderer diagnostic. It does not
open a source, run an engine, register an execution, authorize a project, or
correct OCR. Its caller must independently bind the measured original/raster
and current execution before persistence/retrieval. Retained OCR confidence is
engine output, not confidence in the drawing's meaning or a factual answer.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct

SCHEMA = "ecos-page-visual-observations/2.1"
HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
MAX_TSV_BYTES = 1024 * 1024
MAX_ROWS = 16000
MAX_WORDS = 10000
MAX_WORD_BYTES = 4096
MAX_PROJECTED_BYTES = 4 * 1024 * 1024
LIMITATIONS = (
    "pixel_ocr_not_native_text",
    "ocr_transcription_not_visually_verified",
    "layout_grouping_is_engine_observation_not_semantic_association",
    "reading_order_not_verified",
    "unrecognized_visual_content_not_accounted",
    "no_project_or_execution_authority",
)


class VisualObservationError(ValueError):
    """Fixed codes only; never echo source text or subprocess diagnostics."""


def _fail(code="visual_observation_invalid"):
    raise VisualObservationError(code)


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        _fail()
    return value


def _text(value, maximum=500):
    if type(value) is not str or not value or len(value) > maximum:
        _fail()
    try:
        if len(value.encode("utf-8")) > maximum:
            _fail()
    except UnicodeError:
        _fail()
    if any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value):
        _fail()
    return value


def _sha(value):
    if type(value) is not str or not re.fullmatch(r"[0-9a-f]{64}", value):
        _fail()
    return value


def parse_visual_observations(tsv: bytes, raster: bytes, *, source: dict, engine: dict) -> dict:
    """Preserve complete TSV words and line boxes, without trimming/filtering.

    Strictly validates one raster page and retains even zero-confidence words.
    An invalid/oversized row fails the WHOLE projection, never a successful
    prefix. No page-wide flattened text is generated: neighboring columns,
    dimensions and notes must not become unsupported label/value statements.
    """
    if type(tsv) is not bytes or not 1 <= len(tsv) <= MAX_TSV_BYTES:
        _fail("visual_observation_byte_limit")
    if type(raster) is not bytes or not 33 <= len(raster) <= 32 * 1024 * 1024:
        _fail("visual_observation_raster_invalid")
    if raster[:8] != b"\x89PNG\r\n\x1a\n" or raster[12:16] != b"IHDR":
        _fail("visual_observation_raster_invalid")
    width, height = struct.unpack(">II", raster[16:24])
    if width < 1 or height < 1 or max(width, height) > 8000 or width * height > 24_000_000:
        _fail("visual_observation_raster_limit")
    # PNG is supplied by the already checked renderer. Header/hash checking is
    # not independent PNG decoding or proof that bytes came from this PDF.
    if type(source) is not dict or set(source) != {
        "source_sha256", "source_page_count", "page_number", "rotation_degrees",
        "display_width_points", "display_height_points", "cropbox", "mediabox",
    }:
        _fail("visual_observation_source_invalid")
    _sha(source["source_sha256"])
    count = _integer(source["source_page_count"], 1, 10000)
    _integer(source["page_number"], 1, count)
    if type(source["rotation_degrees"]) is not int or source["rotation_degrees"] not in (0, 90, 180, 270):
        _fail("visual_observation_source_invalid")
    for key in ("display_width_points", "display_height_points"):
        value = source[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 100000:
            _fail("visual_observation_source_invalid")
    for key in ("cropbox", "mediabox"):
        box = source[key]
        if (type(box) is not list or len(box) != 4 or
                any(type(n) not in (int, float) or not math.isfinite(n) or abs(n) > 100000 for n in box)
                or box[2] <= box[0] or box[3] <= box[1]):
            _fail("visual_observation_source_invalid")
    crop = source["cropbox"]
    displayed = (crop[2] - crop[0], crop[3] - crop[1])
    if source["rotation_degrees"] in (90, 270):
        displayed = tuple(reversed(displayed))
    if (abs(source["display_width_points"] - displayed[0]) > 0.01 or
            abs(source["display_height_points"] - displayed[1]) > 0.01):
        _fail("visual_observation_source_geometry_mismatch")
    if type(engine) is not dict or set(engine) != {"name", "version", "language", "oem", "psm", "invoked_executable_sha256"}:
        _fail("visual_observation_engine_invalid")
    if engine["name"] != "tesseract" or engine["oem"] != 1 or type(engine["oem"]) is not int:
        _fail("visual_observation_engine_invalid")
    if type(engine["psm"]) is not int or engine["psm"] not in (3, 6, 11):
        _fail("visual_observation_engine_invalid")
    _text(engine["version"], 256)
    _text(engine["language"], 100)
    _sha(engine["invoked_executable_sha256"])
    try:
        text = tsv.decode("utf-8", "strict")
    except UnicodeError:
        _fail("visual_observation_encoding_invalid")
    # TSV rows may use CRLF. Other text is preserved exactly; no normalization.
    rows = text.split("\n")
    if rows[-1] == "":
        rows.pop()
    rows = [row[:-1] if row.endswith("\r") else row for row in rows]
    if not rows or rows[0] != HEADER or len(rows) > MAX_ROWS + 1:
        _fail("visual_observation_tsv_invalid")
    if len(rows) < 2:
        _fail("visual_observation_page_missing")
    parents = {}
    line_records = []
    last_key = None
    word_count = 0
    low_confidence_count = 0
    geometry_conflicts = []
    for row in rows[1:]:
        columns = row.split("\t")
        if len(columns) != 12:
            _fail("visual_observation_tsv_invalid")
        if any(not re.fullmatch(r"(?:0|[1-9][0-9]{0,5})", n) for n in columns[:10]):
            _fail("visual_observation_tsv_invalid")
        level, page, block, paragraph, line, word, x, y, w, h = map(int, columns[:10])
        if not 1 <= level <= 5 or page != 1 or w < 1 or h < 1 or x + w > width or y + h > height:
            _fail("visual_observation_geometry_invalid")
        parts = (page, block, paragraph, line, word)
        if any(n < 1 for n in parts[:level]) or any(n != 0 for n in parts[level:]):
            _fail("visual_observation_hierarchy_invalid")
        key = parts[:level]
        if last_key is not None and key <= last_key:
            _fail("visual_observation_hierarchy_invalid")
        last_key = key
        if level > 1 and key[:-1] not in parents:
            _fail("visual_observation_hierarchy_invalid")
        box = [x, y, x + w, y + h]
        parent_contains = True
        if level > 1:
            parent_box = parents[key[:-1]]["bbox"]
            if x < parent_box[0] or y < parent_box[1] or x + w > parent_box[2] or y + h > parent_box[3]:
                # Real Tesseract output on the original drawings contains
                # inconsistent parent/child boxes, sometimes at high confidence.
                # These are observable extraction defects, not invalid raster
                # coordinates. Preserve both boxes; do not clip, drop text,
                # expand a region silently, or invent a semantic association.
                parent_contains = False
                geometry_conflicts.append({"hierarchy": list(key), "bbox": box, "reported_parent_bbox": list(parent_box)})
        if level < 5:
            if columns[10] != "-1" or columns[11] != "":
                _fail("visual_observation_tsv_invalid")
            record = {"bbox": box}
            if level == 1 and (len(parents) or box != [0, 0, width, height]):
                _fail("visual_observation_page_invalid")
            if level == 4:
                record.update(line_id=f"b{block}:p{paragraph}:l{line}", words=[],
                              reported_block_bbox=list(parents[key[:2]]["bbox"]),
                              reported_paragraph_bbox=list(parents[key[:3]]["bbox"]),
                              contained_in_reported_parent=parent_contains)
                line_records.append(record)
            parents[key] = record
            continue
        if not re.fullmatch(r"(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,12})?", columns[10]):
            _fail("visual_observation_confidence_invalid")
        confidence = float(columns[10])
        if confidence > 100:
            _fail("visual_observation_confidence_invalid")
        _text(columns[11], MAX_WORD_BYTES)
        word_count += 1
        if word_count > MAX_WORDS:
            _fail("visual_observation_word_limit")
        low_confidence_count += confidence < 50
        parents[key[:-1]]["words"].append({
            "word_id": f"b{block}:p{paragraph}:l{line}:w{word}",
            "text": columns[11], "bbox": box, "engine_confidence": confidence,
            "engine_confidence_raw": columns[10],
            "contained_in_reported_line": parent_contains,
        })
    result = {
        "schema_version": SCHEMA,
        "source": json.loads(json.dumps(source, allow_nan=False)),
        "raster": {"sha256": hashlib.sha256(raster).hexdigest(), "byte_count": len(raster),
                   "width": width, "height": height, "coordinate_system": "rotated_display_cropbox_pixels_top_left",
                   "hash_scope": "exact_png_bytes", "decode_verified_by_parser": False},
        "engine": dict(engine), "raw_tsv_sha256": hashlib.sha256(tsv).hexdigest(),
        "raw_tsv_bytes": len(tsv), "observed_row_count": len(rows) - 1,
        "observed_word_count": word_count, "low_engine_confidence_word_count": low_confidence_count,
        "geometry_conflicts": geometry_conflicts,
        "state": "partial" if word_count else "unreadable",
        "lines": line_records, "limitation_codes": list(LIMITATIONS),
        "retrieval_authorized": False, "semantic_verified": False,
    }
    if not word_count:
        result["limitation_codes"].append("ocr_no_text_detected_not_verified_empty")
    if geometry_conflicts:
        result["limitation_codes"].append("ocr_parent_child_geometry_conflicts_unresolved")
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()) > MAX_PROJECTED_BYTES:
        _fail("visual_observation_projection_byte_limit")
    return result
