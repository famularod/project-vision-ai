"""Pure, fail-closed reconstruction of coordinate-bound drawing tables.

This module deliberately has no PDF, OCR, provider, database, or network
dependencies.  A producer supplies normalized word boxes (and, optionally,
vector line segments or trusted block bounds).  The functions below preserve
those boxes as constituents, reconstruct only relationships whose required
roles occur inside the same coordinate-bound row or record, and return explicit
``complete``, ``incomplete``, or ``conflicted`` states.

The public integration seam is intentionally small:

``detect_blocks(page_identity, word_regions, vector_segments, block_hints)``
    Detect bounded candidate tables/records without making factual claims.

``evaluate_blocks(page_identity, blocks, word_regions)``
    Evaluate supported schemas, add typed deterministic derivations, and emit
    bounded OCR retry requests for incomplete relationships.  It never performs
    those retries itself.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from statistics import median
from typing import Any, Iterable, Mapping, Sequence


SUPPORTED_SCHEMAS = (
    "slab_legend",
    "footing_schedule",
    "equipment_schedule",
    "fixture_unit_totals",
    "numbered_notes",
    "photometric_statistics",
    "landscape_summary",
    "hydrozone_summary",
    "water_budget",
    "plant_material",
)


@dataclass(frozen=True)
class ResourceLimits:
    """Hard limits that keep reconstruction deterministic and bounded."""

    max_regions: int = 20_000
    max_words: int = 30_000
    max_vector_segments: int = 5_000
    max_blocks: int = 12
    max_rows_per_block: int = 250
    max_columns_per_block: int = 32
    max_targeted_ocr_requests: int = 32


DEFAULT_LIMITS = ResourceLimits()


class StructuredTableInputRejected(ValueError):
    """Coordinate, identity, or provenance input violated the safe contract."""

    def __init__(self, code: str, detail: str = "") -> None:
        self.code = code
        suffix = f": {detail}" if detail else ""
        super().__init__(f"{code}{suffix}")


class StructuredTableResourceRejected(RuntimeError):
    """A document exceeded a deterministic reconstruction resource limit."""

    def __init__(self, code: str, actual: int, maximum: int) -> None:
        self.code = code
        self.actual = actual
        self.maximum = maximum
        super().__init__(f"{code}: {actual} exceeds {maximum}")


_SCHEMA_ANCHORS: dict[str, tuple[re.Pattern[str], ...]] = {
    "slab_legend": (
        re.compile(r"\bTH(?:K|ICK)\b", re.I),
        re.compile(r"\bREINFORCED\b", re.I),
        re.compile(r"\b(?:CONCRETE|PCC)\b", re.I),
        re.compile(r"\b(?:SLAB|PAVING|WALKWAYS?)\b", re.I),
    ),
    "footing_schedule": (
        re.compile(r"\bMARK\b", re.I),
        re.compile(r"\bFOOTING\b", re.I),
        re.compile(r"\bREINFORCING\b", re.I),
        re.compile(r"^F\s*[1-9]\d*$", re.I),
    ),
    "equipment_schedule": (
        re.compile(r"\bEQUIPMENT\b", re.I),
        re.compile(r"\bCFM\b", re.I),
        re.compile(r"^EF\s*[- ]?\s*[1-9]\d*$", re.I),
    ),
    "fixture_unit_totals": (
        re.compile(r"\bCENTER\b", re.I),
        re.compile(r"\bEAST\b", re.I),
        re.compile(r"\bTOTAL\b", re.I),
        re.compile(r"\bFIXTURE\b", re.I),
    ),
    "numbered_notes": (
        re.compile(r"\bNOTES?\b", re.I),
        re.compile(r"\bBUS\b", re.I),
        re.compile(r"\bPOLES?\b", re.I),
        re.compile(r"^\(?[1-9]\d*[.)]?$", re.I),
    ),
    "photometric_statistics": (
        re.compile(r"\bAVG\b", re.I),
        re.compile(r"\bMAX\b", re.I),
        re.compile(r"\bMIN\b", re.I),
        re.compile(r"\bALL\b", re.I),
    ),
    "landscape_summary": (
        re.compile(r"\bLANDSCAPE\b", re.I),
        re.compile(r"\bIRRIGATED\b", re.I),
        re.compile(r"\bREQUIRED\b", re.I),
        re.compile(r"\bPROVIDED\b", re.I),
    ),
    "hydrozone_summary": (
        re.compile(r"\bHYDROZONE\b", re.I),
        re.compile(r"\bHIGH\b", re.I),
        re.compile(r"\bMEDIUM\b", re.I),
        re.compile(r"\bLOW\b", re.I),
    ),
    "water_budget": (
        re.compile(r"\bETWU\b", re.I),
        re.compile(r"\bMAWA\b", re.I),
    ),
    "plant_material": (
        re.compile(r"\bTREES?\b", re.I),
        re.compile(r"\bSHRUBS?\b", re.I),
        re.compile(r"\bCOMMON\s+NAME\b", re.I),
        re.compile(r"\bQTY\b", re.I),
    ),
}

_SCHEMA_MIN_ANCHORS = {
    "slab_legend": 3,
    "footing_schedule": 3,
    "equipment_schedule": 2,
    "fixture_unit_totals": 3,
    "numbered_notes": 3,
    "photometric_statistics": 4,
    "landscape_summary": 3,
    "hydrozone_summary": 2,
    "water_budget": 2,
    "plant_material": 2,
}

# Anchor fallback is intentionally conservative.  Generic schedule words such
# as HIGH/MEDIUM/LOW, TOTAL, or QTY occur throughout dense construction
# drawings and cannot identify a table on their own.  Every automatically
# detected schema therefore needs at least one schema-specific primary anchor
# in addition to the minimum aggregate score above.  Trusted coordinate hints
# are unaffected: they contribute geometry only and the evaluator must still
# reconstruct every required role from exact constituents.
_SCHEMA_PRIMARY_ANCHORS: dict[str, tuple[re.Pattern[str], ...]] = {
    "slab_legend": (
        re.compile(r"\b(?:SLAB|PCC\s+(?:PAVING|WALKWAYS?))\b", re.I),
    ),
    "footing_schedule": (re.compile(r"\bFOOTING\b", re.I),),
    "equipment_schedule": (re.compile(r"\bEF\s*[- ]?\s*[1-9]\d*\b", re.I),),
    "fixture_unit_totals": (re.compile(r"\bFIXTURE\b", re.I),),
    # BUS and POLES identify the bounded replacement-note group.  A generic
    # NOTES heading can cover dozens of unrelated numbered notes on the same
    # sheet and previously exhausted the targeted-OCR request budget.
    "numbered_notes": (re.compile(r"\bBUS\b", re.I), re.compile(r"\bPOLES?\b", re.I)),
    "photometric_statistics": (re.compile(r"\bALL\b", re.I),),
    "landscape_summary": (re.compile(r"\bLANDSCAPE\b", re.I),),
    "hydrozone_summary": (re.compile(r"\bHYDROZONE\b", re.I),),
    "water_budget": (re.compile(r"\bETWU\b", re.I), re.compile(r"\bMAWA\b", re.I)),
    "plant_material": (re.compile(r"\bTREES?\b", re.I), re.compile(r"\bQTY\b", re.I)),
}


def detect_blocks(
    page_identity: Mapping[str, Any],
    word_regions: Iterable[Mapping[str, Any]],
    vector_segments: Iterable[Mapping[str, Any]] | None = None,
    block_hints: Iterable[Mapping[str, Any]] | None = None,
    *,
    limits: ResourceLimits = DEFAULT_LIMITS,
) -> list[dict[str, Any]]:
    """Return deterministic coordinate-bound candidate blocks.

    ``block_hints`` are trusted only as geometry hints.  They do not supply
    facts and cannot override page/project/source identity.  In production the
    preferred producer contract is a vector-derived or reviewed block bound;
    anchor detection is a conservative fallback.
    """

    identity = _normalize_page_identity(page_identity)
    regions = _normalize_regions(word_regions, identity, limits)
    segments = _normalize_segments(vector_segments or (), identity, limits)
    hints = list(block_hints or ())
    if len(hints) > limits.max_blocks:
        raise StructuredTableResourceRejected(
            "too_many_block_hints", len(hints), limits.max_blocks,
        )

    blocks: list[dict[str, Any]] = []
    for index, hint in enumerate(hints):
        blocks.append(_hint_block(identity, regions, hint, index))

    hinted_schemas = {
        block["schema"]
        for block in blocks
        if block["schema"] in SUPPORTED_SCHEMAS
    }
    for candidate in _vector_grid_candidates(identity, regions, segments):
        if _overlaps_existing(candidate, blocks):
            continue
        blocks.append(candidate)

    for schema in SUPPORTED_SCHEMAS:
        if schema in hinted_schemas:
            continue
        candidate = _anchor_candidate(identity, regions, schema)
        if candidate is None or _overlaps_existing(candidate, blocks, same_schema=True):
            continue
        blocks.append(candidate)

    if len(blocks) > limits.max_blocks:
        raise StructuredTableResourceRejected(
            "too_many_detected_blocks", len(blocks), limits.max_blocks,
        )
    return sorted(blocks, key=_block_sort_key)


def evaluate_blocks(
    page_identity: Mapping[str, Any],
    blocks: Iterable[Mapping[str, Any]],
    word_regions: Iterable[Mapping[str, Any]],
    *,
    limits: ResourceLimits = DEFAULT_LIMITS,
) -> dict[str, Any]:
    """Evaluate blocks into coordinate-bound relationships and derivations."""

    identity = _normalize_page_identity(page_identity)
    regions = _normalize_regions(word_regions, identity, limits)
    normalized_blocks = [_normalize_block(block, identity) for block in blocks]
    if len(normalized_blocks) > limits.max_blocks:
        raise StructuredTableResourceRejected(
            "too_many_evaluation_blocks", len(normalized_blocks), limits.max_blocks,
        )

    by_id = {region["id"]: region for region in regions}
    relationships: list[dict[str, Any]] = []
    evaluated_blocks: list[dict[str, Any]] = []
    for block in sorted(normalized_blocks, key=_block_sort_key):
        scoped = [
            by_id[region_id]
            for region_id in block["regionIds"]
            if region_id in by_id
        ]
        row_clusters = _line_clusters(scoped)
        if len(row_clusters) > limits.max_rows_per_block:
            raise StructuredTableResourceRejected(
                "too_many_rows_in_block",
                len(row_clusters),
                limits.max_rows_per_block,
            )
        columns = _estimated_column_count(scoped)
        if columns > limits.max_columns_per_block:
            raise StructuredTableResourceRejected(
                "too_many_columns_in_block", columns, limits.max_columns_per_block,
            )
        evaluator = _EVALUATORS.get(block["schema"])
        block_relationships = evaluator(identity, block, scoped) if evaluator else []
        block_relationships = sorted(block_relationships, key=_relationship_sort_key)
        relationships.extend(block_relationships)
        block_status = _aggregate_status(block_relationships)
        evaluated_blocks.append({
            **block,
            "status": block_status,
            "relationshipIds": [item["id"] for item in block_relationships],
        })

    relationships = sorted(relationships, key=_relationship_sort_key)
    derivations = _typed_derivations(identity, relationships)
    requests = _targeted_ocr_requests(identity, relationships, limits)
    return {
        "pageIdentity": identity,
        "blocks": evaluated_blocks,
        "relationships": relationships,
        "derivations": derivations,
        "targetedOcrRequests": requests,
        "status": _aggregate_status([*relationships, *derivations]),
    }


def _normalize_page_identity(payload: Mapping[str, Any]) -> dict[str, Any]:
    project_id = str(payload.get("projectId") or payload.get("project_id") or "").strip()
    source_sha = str(
        payload.get("sourceSha256") or payload.get("source_sha256") or "",
    ).strip().lower()
    evidence_version = str(
        payload.get("evidenceVersion") or payload.get("evidence_version") or "",
    ).strip()
    sheet_number = str(payload.get("sheetNumber") or payload.get("sheet_number") or "").strip()
    try:
        page_number = int(payload.get("pageNumber") or payload.get("page_number") or 0)
    except (TypeError, ValueError) as error:
        raise StructuredTableInputRejected("invalid_page_number") from error
    if not project_id:
        raise StructuredTableInputRejected("project_id_required")
    if not re.fullmatch(r"[a-f0-9]{64}", source_sha):
        raise StructuredTableInputRejected("source_sha256_required")
    if page_number < 1:
        raise StructuredTableInputRejected("invalid_page_number")
    if not evidence_version:
        raise StructuredTableInputRejected("evidence_version_required")
    canonical = {
        "projectId": project_id,
        "sourceSha256": source_sha,
        "pageNumber": page_number,
        "evidenceVersion": evidence_version,
        "sheetNumber": sheet_number or None,
    }
    canonical["fingerprint"] = _stable_id("page", canonical)
    return canonical


def _normalize_regions(
    values: Iterable[Mapping[str, Any]],
    identity: Mapping[str, Any],
    limits: ResourceLimits,
) -> list[dict[str, Any]]:
    raw = list(values)
    if len(raw) > limits.max_regions:
        raise StructuredTableResourceRejected(
            "too_many_coordinate_regions", len(raw), limits.max_regions,
        )
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    word_count = 0
    for index, item in enumerate(raw):
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        region_id = str(item.get("id") or "").strip()
        if not region_id:
            raise StructuredTableInputRejected("region_id_required", str(index))
        if region_id in seen_ids:
            raise StructuredTableInputRejected("duplicate_region_id", region_id)
        seen_ids.add(region_id)
        _assert_identity_match(item, identity, "region")
        bounds = _bounds_from_payload(item)
        try:
            confidence = float(item.get("confidence", 1.0))
        except (TypeError, ValueError):
            confidence = 0.0
        word_count += len(re.findall(r"\S+", text))
        normalized.append({
            "id": region_id,
            "text": text,
            "normalizedText": _normalized_text(text),
            "bounds": bounds,
            "confidence": round(max(0.0, min(1.0, confidence)), 6),
            "source": str(item.get("source") or "unknown"),
            "projectId": identity["projectId"],
        })
    if word_count > limits.max_words:
        raise StructuredTableResourceRejected(
            "too_many_coordinate_words", word_count, limits.max_words,
        )
    return _dedupe_regions(sorted(normalized, key=_region_sort_key))


def _normalize_segments(
    values: Iterable[Mapping[str, Any]],
    identity: Mapping[str, Any],
    limits: ResourceLimits,
) -> list[dict[str, Any]]:
    raw = list(values)
    if len(raw) > limits.max_vector_segments:
        raise StructuredTableResourceRejected(
            "too_many_vector_segments", len(raw), limits.max_vector_segments,
        )
    result = []
    for index, value in enumerate(raw):
        _assert_identity_match(value, identity, "segment")
        try:
            x1 = float(value["x1"])
            y1 = float(value["y1"])
            x2 = float(value["x2"])
            y2 = float(value["y2"])
        except (KeyError, TypeError, ValueError) as error:
            raise StructuredTableInputRejected("invalid_vector_segment", str(index)) from error
        if not all(math.isfinite(number) and -0.001 <= number <= 1.001 for number in (x1, y1, x2, y2)):
            raise StructuredTableInputRejected("invalid_vector_segment", str(index))
        orientation = (
            "horizontal" if abs(y2 - y1) <= 0.002
            else "vertical" if abs(x2 - x1) <= 0.002
            else "diagonal"
        )
        result.append({
            "id": str(value.get("id") or f"segment-{index}"),
            "x1": round(x1, 6),
            "y1": round(y1, 6),
            "x2": round(x2, 6),
            "y2": round(y2, 6),
            "orientation": orientation,
        })
    return sorted(result, key=lambda item: (
        item["orientation"], item["y1"], item["x1"], item["y2"], item["x2"], item["id"],
    ))


def _assert_identity_match(
    payload: Mapping[str, Any],
    identity: Mapping[str, Any],
    kind: str,
) -> None:
    supplied_project = payload.get("projectId") or payload.get("project_id")
    if supplied_project is not None and str(supplied_project) != identity["projectId"]:
        raise StructuredTableInputRejected(f"{kind}_project_mismatch")
    supplied_sha = payload.get("sourceSha256") or payload.get("source_sha256")
    if supplied_sha is not None and str(supplied_sha).lower() != identity["sourceSha256"]:
        raise StructuredTableInputRejected(f"{kind}_source_mismatch")
    supplied_page = payload.get("pageNumber") or payload.get("page_number")
    if supplied_page is not None and int(supplied_page) != identity["pageNumber"]:
        raise StructuredTableInputRejected(f"{kind}_page_mismatch")
    supplied_version = payload.get("evidenceVersion") or payload.get("evidence_version")
    if supplied_version is not None and str(supplied_version) != identity["evidenceVersion"]:
        raise StructuredTableInputRejected(f"{kind}_evidence_version_mismatch")


def _bounds_from_payload(payload: Mapping[str, Any]) -> dict[str, float]:
    raw = payload.get("normalizedBounds") or payload.get("bounds")
    if isinstance(raw, Mapping):
        values = (raw.get("x"), raw.get("y"), raw.get("width"), raw.get("height"))
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)) and len(raw) >= 4:
        values = raw[:4]
    elif all(key in payload for key in ("x", "y", "width", "height")):
        values = (payload["x"], payload["y"], payload["width"], payload["height"])
    else:
        raise StructuredTableInputRejected("coordinate_bounds_required")
    try:
        x, y, width, height = (float(value) for value in values)
    except (TypeError, ValueError) as error:
        raise StructuredTableInputRejected("invalid_coordinate_bounds") from error
    if not all(math.isfinite(value) for value in (x, y, width, height)):
        raise StructuredTableInputRejected("invalid_coordinate_bounds")
    if x < -0.001 or y < -0.001 or width <= 0 or height <= 0:
        raise StructuredTableInputRejected("invalid_coordinate_bounds")
    if x + width > 1.001 or y + height > 1.001:
        raise StructuredTableInputRejected("invalid_coordinate_bounds")
    return {
        "x": round(max(0.0, x), 6),
        "y": round(max(0.0, y), 6),
        "width": round(min(1.0, width), 6),
        "height": round(min(1.0, height), 6),
    }


def _dedupe_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    spatial: dict[tuple[str, int, int], list[dict[str, Any]]] = {}
    for region in regions:
        bounds = region["bounds"]
        bucket_x = int(_center_x(bounds) / 0.01)
        bucket_y = int(_center_y(bounds) / 0.01)
        nearby = [
            existing
            for x_offset in (-1, 0, 1)
            for y_offset in (-1, 0, 1)
            for existing in spatial.get(
                (region["normalizedText"], bucket_x + x_offset, bucket_y + y_offset),
                (),
            )
        ]
        duplicate = next((
            existing for existing in nearby
            if _iou(existing["bounds"], region["bounds"]) >= 0.72
        ), None)
        if duplicate is None:
            canonical = {**region, "duplicateRegionIds": []}
            result.append(canonical)
            spatial.setdefault(
                (region["normalizedText"], bucket_x, bucket_y), [],
            ).append(canonical)
            continue
        duplicate["duplicateRegionIds"].append(region["id"])
        duplicate["duplicateRegionIds"].sort()
        duplicate["confidence"] = max(duplicate["confidence"], region["confidence"])
    return result


def _hint_block(
    identity: Mapping[str, Any],
    regions: list[dict[str, Any]],
    hint: Mapping[str, Any],
    index: int,
) -> dict[str, Any]:
    _assert_identity_match(hint, identity, "block")
    schema = str(hint.get("schema") or "").strip()
    if schema not in SUPPORTED_SCHEMAS:
        raise StructuredTableInputRejected("unsupported_block_schema", schema)
    bounds = _bounds_from_payload(hint)
    selected = [region for region in regions if _center_inside(region["bounds"], bounds)]
    return _block(
        identity,
        schema,
        bounds,
        selected,
        "trusted_coordinate_hint",
        label=str(hint.get("label") or f"hint-{index}"),
    )


def _vector_grid_candidates(
    identity: Mapping[str, Any],
    regions: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    horizontal = [segment for segment in segments if segment["orientation"] == "horizontal"]
    vertical = [segment for segment in segments if segment["orientation"] == "vertical"]
    if len(horizontal) < 2 or len(vertical) < 2:
        return []
    # Split linework into coarse spatial components.  Long construction lines
    # may cross a table but cannot create one without at least two separators of
    # both orientations in the same component.
    components: list[list[dict[str, Any]]] = []
    for segment in horizontal + vertical:
        envelope = _segment_bounds(segment)
        connected = [
            component
            for component in components
            if any(_expanded_intersects(envelope, _segment_bounds(other), 0.004) for other in component)
        ]
        if not connected:
            components.append([segment])
            continue
        target = connected[0]
        target.append(segment)
        for extra in connected[1:]:
            target.extend(extra)
            components.remove(extra)

    result = []
    for component in components:
        hs = [segment for segment in component if segment["orientation"] == "horizontal"]
        vs = [segment for segment in component if segment["orientation"] == "vertical"]
        if len(_snapped_coordinates(hs, "y1")) < 2 or len(_snapped_coordinates(vs, "x1")) < 2:
            continue
        bounds = _envelope([_segment_bounds(segment) for segment in component])
        selected = [region for region in regions if _center_inside(region["bounds"], bounds)]
        schema = _infer_schema(selected)
        if schema is None:
            continue
        result.append(_block(identity, schema, bounds, selected, "vector_ruled_grid"))
    return result


def _anchor_candidate(
    identity: Mapping[str, Any],
    regions: list[dict[str, Any]],
    schema: str,
) -> dict[str, Any] | None:
    if schema == "slab_legend":
        return _slab_anchor_candidate(identity, regions)
    if schema == "numbered_notes":
        return _numbered_note_anchor_candidate(identity, regions)
    if not _has_primary_anchors(schema, regions):
        return None
    patterns = _SCHEMA_ANCHORS[schema]
    all_matched_groups = [
        [region for region in regions if pattern.search(region["text"])]
        for pattern in patterns
    ]
    if sum(bool(group) for group in all_matched_groups) < _SCHEMA_MIN_ANCHORS[schema]:
        return None
    primary_regions = _primary_anchor_regions(schema, regions)
    local_candidates: list[tuple[tuple[Any, ...], list[dict[str, Any]]]] = []
    for primary in primary_regions:
        # A single issued drawing page can contain several unrelated schedules
        # and note groups.  Score a bounded neighborhood around each strong
        # schema anchor instead of enveloping every matching word on the page.
        window = _pad_bounds(primary["bounds"], x_pad=0.28, y_pad=0.20)
        local_groups = [
            [region for region in group if _center_inside(region["bounds"], window)]
            for group in all_matched_groups
        ]
        local_regions = [region for group in local_groups for region in group]
        if (
            sum(bool(group) for group in local_groups) < _SCHEMA_MIN_ANCHORS[schema]
            or not _has_primary_anchors(schema, local_regions)
        ):
            continue
        anchors = list({region["id"]: region for region in local_regions}.values())
        envelope = _envelope([region["bounds"] for region in anchors])
        area = envelope["width"] * envelope["height"]
        score = (
            sum(bool(group) for group in local_groups),
            len(_primary_anchor_regions(schema, local_regions)),
            -area,
            -envelope["y"],
            -envelope["x"],
        )
        local_candidates.append((score, anchors))
    if not local_candidates:
        return None
    _score, anchors = max(local_candidates, key=lambda item: item[0])
    anchor_bounds = _envelope([region["bounds"] for region in anchors])
    # Anchor fallback is deliberately local.  It may return an incomplete block
    # (and a targeted OCR request), but it must not sweep an entire page and
    # create cross-table relationships.
    padded = _pad_bounds(anchor_bounds, x_pad=0.045, y_pad=0.045)
    selected = [region for region in regions if _center_inside(region["bounds"], padded)]
    return _block(identity, schema, padded, selected, "coordinate_anchor_fallback")


def _slab_anchor_candidate(
    identity: Mapping[str, Any],
    regions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Select one exact compact slab/PCC note, never a page-wide legend area."""

    candidates: list[tuple[tuple[Any, ...], list[dict[str, Any]]]] = []
    thickness_pattern = re.compile(
        r"(?<!\d)\d+(?:\.\d+)?\s*(?:[\"”″]|IN(?:CH(?:ES)?)?\b)",
        re.I,
    )
    context_pattern = re.compile(
        r"\b(?:SLAB|PCC\s+(?:PAVING|WALKWAYS?))\b",
        re.I,
    )
    material_pattern = re.compile(r"\b(?:CONCRETE|PCC)\b", re.I)
    primary_regions = _matching_regions(regions, context_pattern.pattern)
    for primary in primary_regions:
        neighborhood = _pad_bounds(primary["bounds"], x_pad=0.22, y_pad=0.014)
        local = [
            region for region in regions
            if _center_inside(region["bounds"], neighborhood)
        ]
        for row in _line_clusters(local):
            if primary["id"] not in {region["id"] for region in row}:
                continue
            joined = _joined_text(row)
            if (
                not thickness_pattern.search(joined)
                or not context_pattern.search(joined)
                or not material_pattern.search(joined)
            ):
                continue
            matched = {
                region["id"]: region
                for region in row
                if (
                    thickness_pattern.search(region["text"])
                    or context_pattern.search(region["text"])
                    or material_pattern.search(region["text"])
                    or re.search(r"\bREINFORCED\b", region["text"], re.I)
                )
            }
            if not matched:
                continue
            exact = list(matched.values())
            bounds = _envelope([region["bounds"] for region in exact])
            score = (
                1 if re.search(r"\bCONSTRUCT\b", joined, re.I) else 0,
                1 if re.search(r"\bPCC\s+PAVING\b", joined, re.I) else 0,
                1 if re.search(r"\bREINFORCED\b", joined, re.I) else 0,
                -bounds["y"],
                -bounds["x"],
            )
            candidates.append((score, exact))
    if not candidates:
        return None
    _score, anchors = max(candidates, key=lambda item: item[0])
    bounds = _pad_bounds(
        _envelope([region["bounds"] for region in anchors]),
        x_pad=0.015,
        y_pad=0.007,
    )
    selected = [region for region in regions if _center_inside(region["bounds"], bounds)]
    return _block(
        identity,
        "slab_legend",
        bounds,
        selected,
        "coordinate_anchor_fallback",
    )


def _numbered_note_anchor_candidate(
    identity: Mapping[str, Any],
    regions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Detect only a compact note group with coordinate-bound BUS/POLES text.

    Construction sheets routinely contain the words ``BUS`` and ``POLE`` in
    unrelated panel schedules and lighting callouts.  Enveloping all such
    words can quarantine a large fraction of the page.  A numbered-note block
    therefore needs a single coordinate row that contains both labels, a note
    number, and at least one of the two expected numeric roles.  Nearby rows
    with the same shape may join the same block; distant page text may not.
    """
    candidate_rows: list[list[dict[str, Any]]] = []
    for row in _line_clusters(regions):
        joined = _joined_text(row)
        if not re.search(r"\bBUS\b", joined, re.I) or not re.search(r"\bPOLES?\b", joined, re.I):
            continue
        has_note_number = any(
            re.fullmatch(r"\(?[1-9]\d*[.)]?", region["normalizedText"])
            for region in row
        ) or bool(re.match(r"^\s*\(?[1-9]\d*[.)]\s*", joined))
        # Both numeric roles must be present in this exact row.  Requiring
        # only one allowed unrelated panel text such as ``562 ... BUS ...
        # POLES`` to open a table block even though no coordinate-bound pair
        # of values existed.  A partial row can still be represented when a
        # trusted geometry hint identifies the real note table, but automatic
        # detection itself needs the complete structural signature.
        has_bus_amps = bool(
            re.search(r"(?<!\d)\d{2,4}\s*A\s+BUS\b", joined, re.I)
        )
        has_pole_count = bool(
            re.search(r"(?<!\d)\d{1,3}\s+POLES?\b", joined, re.I)
        )
        if has_note_number and has_bus_amps and has_pole_count:
            candidate_rows.append(row)
    if not candidate_rows:
        return None

    groups: list[list[list[dict[str, Any]]]] = []
    for seed in candidate_rows:
        seed_bounds = _envelope([region["bounds"] for region in seed])
        seed_y = seed_bounds["y"] + seed_bounds["height"] / 2
        seed_x = seed_bounds["x"] + seed_bounds["width"] / 2
        group = []
        for row in candidate_rows:
            bounds = _envelope([region["bounds"] for region in row])
            center_y = bounds["y"] + bounds["height"] / 2
            center_x = bounds["x"] + bounds["width"] / 2
            if abs(center_y - seed_y) <= 0.18 and abs(center_x - seed_x) <= 0.30:
                group.append(row)
        groups.append(group)
    selected_rows = max(
        groups,
        key=lambda group: (
            len(group),
            -_envelope([region["bounds"] for row in group for region in row])["y"],
        ),
    )
    primary_bounds = _envelope([
        region["bounds"] for row in selected_rows for region in row
    ])
    bounds = _pad_bounds(primary_bounds, x_pad=0.04, y_pad=0.025)
    selected = [region for region in regions if _center_inside(region["bounds"], bounds)]
    return _block(
        identity,
        "numbered_notes",
        bounds,
        selected,
        "coordinate_anchor_fallback",
    )


def _block(
    identity: Mapping[str, Any],
    schema: str,
    bounds: Mapping[str, float],
    regions: list[dict[str, Any]],
    method: str,
    *,
    label: str = "",
) -> dict[str, Any]:
    payload = {
        "pageFingerprint": identity["fingerprint"],
        "projectId": identity["projectId"],
        "sourceSha256": identity["sourceSha256"],
        "pageNumber": identity["pageNumber"],
        "evidenceVersion": identity["evidenceVersion"],
        "schema": schema,
        "bounds": dict(bounds),
        "regionIds": sorted(region["id"] for region in regions),
        "detectionMethod": method,
        "label": label or None,
    }
    return {"id": _stable_id("block", payload), **payload}


def _normalize_block(
    payload: Mapping[str, Any],
    identity: Mapping[str, Any],
) -> dict[str, Any]:
    _assert_identity_match(payload, identity, "block")
    if payload.get("pageFingerprint") != identity["fingerprint"]:
        raise StructuredTableInputRejected("block_page_fingerprint_mismatch")
    schema = str(payload.get("schema") or "")
    if schema not in SUPPORTED_SCHEMAS:
        raise StructuredTableInputRejected("unsupported_block_schema", schema)
    bounds = _bounds_from_payload({"bounds": payload.get("bounds")})
    region_ids = sorted({str(value) for value in payload.get("regionIds") or []})
    normalized = {
        "id": str(payload.get("id") or ""),
        "pageFingerprint": identity["fingerprint"],
        "projectId": identity["projectId"],
        "sourceSha256": identity["sourceSha256"],
        "pageNumber": identity["pageNumber"],
        "evidenceVersion": identity["evidenceVersion"],
        "schema": schema,
        "bounds": bounds,
        "regionIds": region_ids,
        "detectionMethod": str(payload.get("detectionMethod") or "unknown"),
        "label": payload.get("label"),
    }
    expected = _stable_id("block", {key: value for key, value in normalized.items() if key != "id"})
    if normalized["id"] != expected:
        raise StructuredTableInputRejected("block_integrity_mismatch")
    return normalized


def _evaluate_slab(
    identity: Mapping[str, Any],
    block: Mapping[str, Any],
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = _line_clusters(regions)
    candidates = []
    for row in rows:
        text = _joined_text(row)
        if not re.search(r"\b(?:SLAB|PAVING|WALKWAYS?)\b", text, re.I):
            continue
        thickness = _regex_role_candidates(
            row,
            r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:[\"”″]|IN(?:CH(?:ES)?)?\b)",
            lambda value: float(value),
            unit="in",
        )
        # A structural detail reference such as ``4/SD-1”`` contains a
        # digit followed by a quote, but it is not a thickness.  Keep the
        # rejection tied to the exact numeric constituent so the surrounding
        # row cannot turn a sheet/detail callout into a drawing fact.
        thickness = [
            candidate for candidate in thickness
            if not any(
                re.search(r"/\s*[A-Z]{1,5}\s*[-.]?\s*\d", constituent["text"], re.I)
                for constituent in candidate["constituents"]
            )
        ]
        material = _literal_role_candidates(row, {"concrete": r"\b(?:CONCRETE|PCC)\b"})
        reinforcing = _literal_role_candidates(row, {"reinforced": r"\bREINFORCED\b"})
        is_pcc_paving = bool(re.search(
            r"\bPCC\s+(?:PAVING|WALKWAYS?)\b",
            text,
            re.I,
        ))
        required = (
            ("thickness", "material")
            if is_pcc_paving
            else ("thickness", "material", "reinforcement")
        )
        if not thickness and not reinforcing:
            continue
        candidates.append(_relationship(
            identity,
            block,
            "slab_legend",
            "pcc-paving" if is_pcc_paving else "slab",
            _envelope([region["bounds"] for region in row]),
            {
                "thickness": thickness,
                "material": material,
                "reinforcement": reinforcing,
            },
            required=required,
        ))
    return candidates


def _evaluate_footings(identity, block, regions):
    records = _anchored_records(
        regions,
        r"^F\s*([1-9]\d*)$",
        line_pattern=r"\bF\s*([1-9]\d*)\b",
    )
    result = []
    for key, row in records:
        mark_regions = _exact_phrase_regions(row, rf"\bF\s*{key}\b")
        if not mark_regions:
            continue
        dimensions = _regex_role_candidates(
            row,
            r"((?:\d+\s*['’]?\s*[-–—]\s*\d+\s*[\"”]?)\s*[xX×]\s*"
            r"(?:\d+\s*['’]?\s*[-–—]\s*\d+\s*[\"”]?)\s*[xX×]\s*"
            r"(?:\d+(?:\.\d+)?\s*(?:[\"”]|IN(?:CH(?:ES)?)?)))",
            _normalize_footing_dimensions,
        )
        reinforcing = _regex_role_candidates(
            row,
            r"((?:\d+)\s*[-–—]\s*#?\s*\d+(?:\s+E\.?\s*W\.?)?(?:\s*\([^)]*\))?)",
            _normalize_footing_reinforcing,
        )
        if reinforcing:
            specificity = max(
                (
                    int("E.W." in str(candidate["value"]))
                    + int("(T&B)" in str(candidate["value"]))
                )
                for candidate in reinforcing
            )
            reinforcing = [
                candidate for candidate in reinforcing
                if (
                    int("E.W." in str(candidate["value"]))
                    + int("(T&B)" in str(candidate["value"]))
                ) == specificity
            ]
        roles = {
            "mark": [_candidate(f"F{key}", mark_regions)],
            "dimensions": dimensions,
            "reinforcing": reinforcing,
        }
        result.append(_relationship(
            identity, block, "footing_schedule", f"F{key}",
            _envelope([region["bounds"] for region in row]), roles,
            required=("mark", "dimensions", "reinforcing"),
        ))
    return result


def _evaluate_equipment(identity, block, regions):
    records = _anchored_records(
        regions,
        r"^EF\s*[- ]?\s*([1-9]\d*)$",
        line_pattern=r"\bEF\s*[-–— ]\s*([1-9]\d*)\b",
        forward=True,
    )
    result = []
    for key, row in records:
        identifier_regions = _exact_phrase_regions(
            row,
            rf"\bEF\s*[-–— ]?\s*{key}\b",
        )
        if not identifier_regions:
            continue
        airflow = _regex_role_candidates(
            row, r"(?<!\d)(\d{2,5})\s*CFM\b", lambda value: int(value), unit="cfm",
        )
        service = _service_candidates(row)
        result.append(_relationship(
            identity, block, "equipment_record", f"EF-{key}",
            _envelope([region["bounds"] for region in row]),
            {
                "identifier": [_candidate(
                    f"EF-{key}",
                    identifier_regions,
                )],
                "airflow": airflow,
                "service": service,
            },
            required=("identifier", "airflow", "service"),
        ))
    return result


def _evaluate_fixture_units(identity, block, regions):
    headers = []
    for section in ("CENTER", "EAST"):
        matches = _matching_regions(regions, rf"\b{section}\b")
        if matches:
            headers.append((section.lower(), min(matches, key=_region_sort_key)))
    if not headers:
        return []
    result = []
    vertical = (
        len(headers) > 1
        and max(_center_y(header["bounds"]) for _, header in headers)
        - min(_center_y(header["bounds"]) for _, header in headers)
        > max(0.025, _median_height(regions) * 3)
    )
    if vertical:
        headers.sort(key=lambda item: (_center_y(item[1]["bounds"]), item[0]))
        for index, (section, header) in enumerate(headers):
            top = _center_y(header["bounds"])
            bottom = (
                _center_y(headers[index + 1][1]["bounds"])
                if index + 1 < len(headers)
                else block["bounds"]["y"] + block["bounds"]["height"]
            )
            totals = [
                region for region in regions
                if top <= _center_y(region["bounds"]) < bottom
                and re.fullmatch(r"TOTAL", region["normalizedText"], re.I)
            ]
            if not totals:
                row = [header]
                values = []
            else:
                total_rows = [
                    (
                        total,
                        _same_line_regions(total, regions),
                    )
                    for total in totals
                ]
                total, row = max(
                    total_rows,
                    key=lambda item: (
                        bool(_integer_candidates(
                            item[1],
                            exclude={"TOTAL", "CW", "FU"},
                            unit="fixture_units",
                        )),
                        bool(re.search(r"\bCW\b", _joined_text(item[1]), re.I)),
                        _center_y(item[0]["bounds"]),
                    ),
                )
                values = _integer_candidates(
                    row,
                    exclude={"TOTAL", "CW", "FU"},
                    unit="fixture_units",
                )
            result.append(_relationship(
                identity, block, "fixture_unit_total", section,
                _envelope([region["bounds"] for region in row]),
                {
                    "section": [_candidate(section, [header])],
                    "totalFixtureUnits": values,
                },
                required=("section", "totalFixtureUnits"),
            ))
    else:
        headers.sort(key=lambda item: _center_x(item[1]["bounds"]))
        boundaries = _column_boundaries([item[1] for item in headers], block["bounds"])
        for (section, header), (left, right) in zip(headers, boundaries):
            totals = [
                region for region in regions
                if left <= _center_x(region["bounds"]) <= right
                and _center_y(region["bounds"]) >= _center_y(header["bounds"])
                and re.fullmatch(r"TOTAL", region["normalizedText"], re.I)
            ]
            if not totals:
                row = [header]
                values = []
            else:
                total = min(totals, key=lambda region: (_center_y(region["bounds"]), region["id"]))
                row = _same_line_regions(total, regions, x_min=left, x_max=right)
                values = _integer_candidates(row, exclude={"TOTAL"})
            result.append(_relationship(
                identity, block, "fixture_unit_total", section,
                _envelope([region["bounds"] for region in row]),
                {
                    "section": [_candidate(section, [header])],
                    "totalFixtureUnits": values,
                },
                required=("section", "totalFixtureUnits"),
            ))

    # PB-1.2 also contains a separate printed calculation block.  Keep that
    # direct visible statement distinct from the two table-row totals.  The
    # deterministic sum below may cross-check it, but must never impersonate
    # the printed relationship or borrow its constituents for a missing table
    # cell.
    for row in _line_clusters(regions):
        text = _joined_text(row)
        if not re.search(r"\b(?:FIXTURE\s+TOTAL|OVERALL\s+TOTAL)\b", text, re.I):
            continue
        if not re.search(r"\bCENTER\b", text, re.I) or not re.search(r"\bEAST\b", text, re.I):
            continue
        numeric = _integer_candidates(
            row,
            exclude={"FIXTURE", "TOTAL", "CENTER", "EAST"},
            unit="fixture_units",
        )
        values = [candidate["value"] for candidate in numeric]
        overall = [candidate for candidate in numeric if values.count(candidate["value"]) == 1]
        if len(numeric) >= 3:
            overall = [numeric[-1]]
        result.append(_relationship(
            identity, block, "fixture_unit_printed_overall", "overall",
            _envelope([region["bounds"] for region in row]),
            {
                "label": [_candidate("fixture total", _matching_regions(row, r"\b(?:FIXTURE|OVERALL|TOTAL)\b"))],
                "totalFixtureUnits": overall,
            },
            required=("label", "totalFixtureUnits"),
        ))
        break
    return result


def _evaluate_notes(identity, block, regions):
    records = _anchored_records(
        regions,
        r"^(?:\[\s*)?([1-9]\d*)\s*(?:\]|[.)])$",
        require_terminal=True,
        line_pattern=r"^\s*(?:\[\s*)?([1-9]\d*)\s*(?:\]|[.)])\s*",
    )
    result = []
    for key, row in records:
        note_number_regions = _matching_regions(
            row,
            rf"^(?:\[\s*)?{key}\s*(?:\]|[.)])$",
        )
        if not note_number_regions:
            # A line-level OCR substring such as ``3]!`` may suggest a retry,
            # but without an exact terminated note-number constituent it must
            # not create a relationship that cannot pass provenance replay.
            continue
        amps = _regex_role_candidates(
            row, r"(?<!\d)(\d{2,4})\s*A\b", lambda value: int(value), unit="A",
        )
        poles = _regex_role_candidates(
            row, r"(?<!\d)(\d{1,3})\s*POLES?\b", lambda value: int(value), unit="poles",
        )
        result.append(_relationship(
            identity, block, "numbered_note", str(key),
            _envelope([region["bounds"] for region in row]),
            {
                "noteNumber": [_candidate(
                    int(key),
                    note_number_regions,
                )],
                "busAmps": amps,
                "poles": poles,
            },
            required=("noteNumber", "busAmps", "poles"),
        ))
    return result


def _evaluate_statistics(identity, block, regions):
    header_names = ("AVG", "MAX", "MIN")
    headers = {}
    for name in header_names:
        matches = _matching_regions(regions, rf"^{name}$")
        if matches:
            headers[name.lower()] = min(matches, key=_region_sort_key)
    rows = _anchored_records(regions, r"^(ALL|SPILL(?:AGE)?)$", require_terminal=True)
    result = []
    for key, row in rows:
        role_candidates: dict[str, list[dict[str, Any]]] = {
            "description": [_candidate(key.upper(), _matching_regions(row, rf"^{re.escape(key)}$"))],
        }
        for role in ("avg", "max", "min"):
            header = headers.get(role)
            if header is None:
                role_candidates[role] = []
                continue
            role_candidates[role] = _numeric_in_column(row, header, headers.values())
        result.append(_relationship(
            identity, block, "photometric_statistics", key.upper(),
            _envelope([region["bounds"] for region in row]), role_candidates,
            required=("description", "avg", "max", "min"),
        ))
    return result


def _evaluate_landscape(identity, block, regions):
    rows = _line_clusters(regions)
    definitions = (
        (
            "landscapeArea",
            r"\b(?:TOTAL\s+)?LANDSCAPE\s+AREA\b",
            r"\bLANDSCAPE\s+AREA\b",
            "sf",
        ),
        (
            "irrigatedArea",
            r"\bTOTA(?:L)?\s+IRRIGATED\s+LANDSCAPE\s+AREA\b|\bIRRIGATED\s+AREA\b",
            r"\bIRRIGATED(?:\s+LANDSCAPE)?\s+AREA\b",
            "sf",
        ),
        (
            "requiredTrees",
            r"^REQUIRED\b|\bTREES?\s+REQUIRED\b|\bREQUIRED\s+\d+\s+TREES?\b",
            r"\b(?:TREES?\s+)?REQUIRED\b",
            "count",
        ),
        (
            "providedTrees",
            r"^PROVIDED\b|\bTREES?\s+PROVIDED\b|\bPROVIDED\s+\d+\s+TREES?\b",
            r"\b(?:TREES?\s+)?PROVIDED\b",
            "count",
        ),
    )
    result = []
    for role, row_pattern, label_pattern, unit in definitions:
        matching_row = next((
            row for row in rows
            if re.search(row_pattern, _joined_text(row), re.I)
        ), None)
        row = matching_row or []
        values = _integer_candidates(row, exclude={"LANDSCAPE", "IRRIGATED", "REQUIRED", "PROVIDED"}, unit=unit)
        result.append(_relationship(
            identity, block, "landscape_metric", role,
            _envelope([region["bounds"] for region in row]) if row else block["bounds"],
            {
                "metric": [_candidate(role, _matching_regions(row, label_pattern))] if row else [],
                "value": values,
            },
            required=("metric", "value"),
        ))
    return result


def _evaluate_hydrozones(identity, block, regions):
    rows = _line_clusters(regions)
    definitions = (
        ("high", r"(?:^|\W)(?:H|HIGH)(?:\W|$).*\b(?:WATER\s+ZONE|SF\b)"),
        ("medium", r"(?:^|\W)(?:M|MEDIUM)(?:\W|$).*\b(?:WATER\s+ZONE|SF\b)"),
        ("low", r"(?:^|\W)(?:L|LOW)(?:\W|$).*\b(?:WATER\s+ZONE|SF\b)"),
    )
    result = []
    for zone, pattern in definitions:
        row = next((candidate for candidate in rows if re.search(pattern, _joined_text(candidate), re.I)), [])
        zone_constituents = _matching_regions(row, pattern) if row else []
        result.append(_relationship(
            identity, block, "hydrozone_area", zone,
            _envelope([region["bounds"] for region in row]) if row else block["bounds"],
            {
                "hydrozone": [_candidate(zone, zone_constituents)] if zone_constituents else [],
                "area": _regex_role_candidates(
                    row,
                    r"(?<!\d)([\d,]+)\s*S\.?\s*F\b\.?",
                    lambda value: int(value.replace(",", "")),
                    unit="sf",
                ),
            },
            required=("hydrozone", "area"),
        ))
    return result


def _evaluate_water_budget(identity, block, regions):
    rows = _line_clusters(regions)
    result = []
    for metric in ("ETWU", "MAWA"):
        row = next((candidate for candidate in rows if re.search(rf"\b{metric}\b", _joined_text(candidate), re.I)), [])
        metric_constituents = _matching_regions(row, rf"\b{metric}\b") if row else []
        result.append(_relationship(
            identity, block, "water_budget", metric,
            _envelope([region["bounds"] for region in row]) if row else block["bounds"],
            {
                "metric": [_candidate(metric, metric_constituents)] if metric_constituents else [],
                "value": _integer_candidates(row, exclude={metric}),
            },
            required=("metric", "value"),
        ))
    return result


def _evaluate_plant_material(identity, block, regions):
    trees = sorted(_matching_regions(regions, r"^TREES?$"), key=_region_sort_key)
    shrubs = sorted(_matching_regions(regions, r"^SHRUBS?$"), key=_region_sort_key)
    qty_headers = sorted(_matching_regions(regions, r"^QTY\.?$"), key=_region_sort_key)
    common_headers = sorted(_matching_regions(regions, r"\bCOMMON(?:\s+NAME)?\b"), key=_region_sort_key)
    if not trees or not qty_headers or not common_headers:
        return []
    qty_header = qty_headers[0]
    common_header = common_headers[0]
    header_row = _same_line_regions(common_header, regions)
    header_centers = sorted({
        _center_x(region["bounds"])
        for region in header_row
        if re.search(r"\b(?:SYM|QTY|SIZE|BOTANICAL|COMMON|NAME|PF|ZONE)\b", region["normalizedText"])
    })
    qty_range = _range_around_center(_center_x(qty_header["bounds"]), header_centers, block["bounds"])
    common_range = _range_around_center(_center_x(common_header["bounds"]), header_centers, block["bounds"])
    size_headers = sorted(_matching_regions(header_row, r"^SIZE$"), key=_region_sort_key)
    if size_headers:
        qty_range = (
            max(block["bounds"]["x"], float(qty_header["bounds"]["x"]) - 0.006),
            float(size_headers[0]["bounds"]["x"]),
        )
    pf_headers = sorted(_matching_regions(header_row, r"^PF$"), key=_region_sort_key)
    if pf_headers:
        # Printed common names are left-aligned under COMMON NAME and may be
        # much wider than the header itself.  The next semantic header (PF),
        # not the adjacent NAME word, is the truthful right column boundary.
        common_range = (
            max(block["bounds"]["x"], float(common_header["bounds"]["x"]) - 0.006),
            float(pf_headers[0]["bounds"]["x"]),
        )
    start_y = _center_y(trees[0]["bounds"])
    end_y = _center_y(shrubs[0]["bounds"]) if shrubs else block["bounds"]["y"] + block["bounds"]["height"]
    scoped = [
        region for region in regions
        if start_y < _center_y(region["bounds"]) < end_y
    ]
    rows = _line_clusters(scoped)
    result = []
    for row in rows:
        quantity_regions = [
            region for region in row
            if re.fullmatch(r"\d{1,3}", region["normalizedText"])
            and qty_range[0] <= _center_x(region["bounds"]) <= qty_range[1]
        ]
        quantity_region = (
            min(quantity_regions, key=lambda region: (_center_x(region["bounds"]), region["id"]))
            if quantity_regions
            else None
        )
        name_regions = [
            region for region in row
            if common_range[0] <= _center_x(region["bounds"]) <= common_range[1]
            and not re.search(r"\b(?:GAL|BOX|CONT|CAL|SIZE|QTY)\b", region["normalizedText"], re.I)
        ]
        name_text = _joined_text(name_regions).strip(" -")
        if not name_text:
            continue
        quantity = (
            int(re.search(r"\d+", quantity_region["normalizedText"]).group())
            if quantity_region is not None
            else None
        )
        result.append(_relationship(
            identity, block, "plant_material", name_text.title(),
            _envelope([region["bounds"] for region in row]),
            {
                "section": [_candidate("trees", [trees[0]])],
                "quantity": (
                    [_candidate(quantity, [quantity_region], unit="count")]
                    if quantity_region is not None
                    else []
                ),
                "commonName": [_candidate(name_text.title(), name_regions)],
            },
            required=("section", "quantity", "commonName"),
        ))
    return result


_EVALUATORS = {
    "slab_legend": _evaluate_slab,
    "footing_schedule": _evaluate_footings,
    "equipment_schedule": _evaluate_equipment,
    "fixture_unit_totals": _evaluate_fixture_units,
    "numbered_notes": _evaluate_notes,
    "photometric_statistics": _evaluate_statistics,
    "landscape_summary": _evaluate_landscape,
    "hydrozone_summary": _evaluate_hydrozones,
    "water_budget": _evaluate_water_budget,
    "plant_material": _evaluate_plant_material,
}


def _relationship(
    identity: Mapping[str, Any],
    block: Mapping[str, Any],
    relation_type: str,
    row_key: str,
    row_bounds: Mapping[str, float],
    candidates_by_role: Mapping[str, list[dict[str, Any]]],
    *,
    required: Sequence[str],
) -> dict[str, Any]:
    roles: dict[str, Any] = {}
    missing = []
    conflicts = []
    all_constituents: dict[str, dict[str, Any]] = {}
    for role in sorted(candidates_by_role):
        candidates = _unique_candidates(candidates_by_role[role])
        if not candidates:
            if role in required:
                missing.append(role)
            continue
        if len(candidates) > 1:
            conflicts.append(f"ambiguous_role:{role}")
            roles[role] = {
                "state": "conflicted",
                "candidates": candidates,
            }
            for candidate in candidates:
                for constituent in candidate["constituents"]:
                    all_constituents[constituent["id"]] = constituent
            continue
        candidate = candidates[0]
        roles[role] = {"state": "complete", **candidate}
        for constituent in candidate["constituents"]:
            all_constituents[constituent["id"]] = constituent
    status = "conflicted" if conflicts else "incomplete" if missing else "complete"
    payload = {
        "pageFingerprint": identity["fingerprint"],
        "projectId": identity["projectId"],
        "sourceSha256": identity["sourceSha256"],
        "pageNumber": identity["pageNumber"],
        "evidenceVersion": identity["evidenceVersion"],
        "sheetNumber": identity["sheetNumber"],
        "blockId": block["id"],
        "type": relation_type,
        "rowKey": row_key,
        "rowBounds": dict(row_bounds),
        "status": status,
        "roles": roles,
        "requiredRoles": list(required),
        "missingRoles": sorted(missing),
        "conflictCodes": sorted(conflicts),
        "constituents": sorted(all_constituents.values(), key=lambda item: (
            item["bounds"]["y"], item["bounds"]["x"], item["id"],
        )),
    }
    return {"id": _stable_id("relationship", payload), **payload}


def _candidate(
    value: Any,
    regions: Iterable[Mapping[str, Any] | None],
    *,
    unit: str | None = None,
) -> dict[str, Any]:
    constituents = []
    for region in regions:
        if not region:
            continue
        constituents.append({
            "id": region["id"],
            "text": region["text"],
            "bounds": dict(region["bounds"]),
            "source": region["source"],
            "confidence": region["confidence"],
            "duplicateRegionIds": list(region.get("duplicateRegionIds") or []),
        })
    return {
        "value": value,
        "unit": unit,
        "constituentIds": [item["id"] for item in constituents],
        "constituents": constituents,
    }


def _unique_candidates(candidates: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    by_value: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        # A parsed value without exact coordinate constituents is not evidence.
        # Silently discarding it here makes this invariant apply to every schema
        # even if a future evaluator accidentally constructs an empty candidate.
        if not candidate.get("constituents"):
            continue
        key = json.dumps(
            {"value": candidate["value"], "unit": candidate.get("unit")},
            sort_keys=True,
            separators=(",", ":"),
        )
        existing = by_value.get(key)
        if existing is None:
            by_value[key] = candidate
            continue
        merged = {item["id"]: item for item in existing["constituents"]}
        merged.update({item["id"]: item for item in candidate["constituents"]})
        existing["constituents"] = sorted(merged.values(), key=lambda item: (
            item["bounds"]["y"], item["bounds"]["x"], item["id"],
        ))
        existing["constituentIds"] = [item["id"] for item in existing["constituents"]]
    return [by_value[key] for key in sorted(by_value)]


def _typed_derivations(
    identity: Mapping[str, Any],
    relationships: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    totals = {
        relationship["rowKey"]: relationship
        for relationship in relationships
        if relationship["type"] == "fixture_unit_total"
        and relationship["status"] == "complete"
        and relationship["rowKey"] in {"center", "east"}
    }
    if set(totals) != {"center", "east"}:
        return []
    operands = []
    for section in ("center", "east"):
        relationship = totals[section]
        role = relationship["roles"]["totalFixtureUnits"]
        operands.append({
            "relationshipId": relationship["id"],
            "role": "totalFixtureUnits",
            "value": role["value"],
            "unit": role.get("unit"),
        })
    value = sum(int(operand["value"]) for operand in operands)
    printed = next((
        relationship
        for relationship in relationships
        if relationship["type"] == "fixture_unit_printed_overall"
        and relationship["status"] == "complete"
    ), None)
    cross_check = None
    if printed is not None:
        printed_value = printed["roles"]["totalFixtureUnits"]["value"]
        constituent_ids = sorted({
            constituent["id"]
            for relationship in (*totals.values(), printed)
            for constituent in relationship["constituents"]
        })
        cross_check = {
            "relationshipId": printed["id"],
            "printedValue": printed_value,
            "status": "matches" if int(printed_value) == value else "conflicted",
            "constituentIds": constituent_ids,
        }
    payload = {
        "pageFingerprint": identity["fingerprint"],
        "projectId": identity["projectId"],
        "sourceSha256": identity["sourceSha256"],
        "pageNumber": identity["pageNumber"],
        "evidenceVersion": identity["evidenceVersion"],
        "type": "fixture_unit_total_sum",
        "operator": "sum",
        "value": value,
        "unit": "fixture_units",
        "status": (
            "conflicted"
            if cross_check is not None and cross_check["status"] == "conflicted"
            else "complete"
        ),
        "operands": operands,
        "printedCrossCheck": cross_check,
        "classification": "deterministic_derivation_not_visible_drawing_fact",
    }
    return [{"id": _stable_id("derivation", payload), **payload}]


def _targeted_ocr_requests(
    identity: Mapping[str, Any],
    relationships: list[dict[str, Any]],
    limits: ResourceLimits,
) -> list[dict[str, Any]]:
    requests = []
    for relationship in relationships:
        if relationship["status"] == "complete":
            continue
        payload = {
            "pageFingerprint": identity["fingerprint"],
            "projectId": identity["projectId"],
            "sourceSha256": identity["sourceSha256"],
            "pageNumber": identity["pageNumber"],
            "evidenceVersion": identity["evidenceVersion"],
            "relationshipId": relationship["id"],
            "bounds": relationship["rowBounds"],
            "missingRoles": relationship["missingRoles"],
            "conflictCodes": relationship["conflictCodes"],
            "reason": "coordinate_bound_relationship_incomplete",
        }
        requests.append({"id": _stable_id("ocr-request", payload), **payload})
    if len(requests) > limits.max_targeted_ocr_requests:
        raise StructuredTableResourceRejected(
            "too_many_targeted_ocr_requests",
            len(requests),
            limits.max_targeted_ocr_requests,
        )
    return sorted(requests, key=lambda item: (
        item["bounds"]["y"], item["bounds"]["x"], item["relationshipId"],
    ))


def _anchored_records(
    regions: list[dict[str, Any]],
    pattern: str,
    *,
    require_terminal: bool = False,
    line_pattern: str | None = None,
    forward: bool = False,
) -> list[tuple[str, list[dict[str, Any]]]]:
    regex = re.compile(pattern, re.I)
    anchors: list[tuple[str, list[dict[str, Any]], float]] = []
    for region in regions:
        match = regex.fullmatch(region["normalizedText"])
        # A numbered-note boundary must retain visible terminal punctuation.
        # Treating a bare number in the leftmost detected band as an anchor is
        # unsafe when OCR misses the actual note glyph: values such as the
        # ``30`` and ``42`` in ``30 POLES`` / ``42 POLES`` then become false
        # rows.  The producer may retry the missing note-number tile instead.
        terminal = bool(re.search(r"(?:[.)]|\])$", region["normalizedText"]))
        is_numeric_anchor = bool(match and str(match.group(1)).isdigit())
        if match and (not require_terminal or terminal or not is_numeric_anchor):
            anchors.append((match.group(1), [region], _center_y(region["bounds"])))
    if line_pattern:
        line_regex = re.compile(line_pattern, re.I)
        for line in _line_clusters(regions):
            line_text = _joined_text(line)
            for match in line_regex.finditer(line_text):
                constituents = _phrase_regions(line, line_regex, exact_match=match)
                if not constituents:
                    continue
                center = sum(_center_y(item["bounds"]) for item in constituents) / len(constituents)
                anchors.append((match.group(1), constituents, center))

    anchors = sorted(anchors, key=lambda item: (
        item[2], min(_center_x(region["bounds"]) for region in item[1]),
        tuple(region["id"] for region in item[1]),
    ))
    # The fixed-tile producer retains both words and line regions.  Treat
    # same-key anchors on the same visual line as one record, preferring the
    # smallest exact constituent set.  Without this tolerance a duplicate OCR
    # line can manufacture an empty sibling record a fraction of a pixel away.
    anchor_tolerance = max(0.004, _median_height(regions) * 0.9)
    deduped_anchors: list[tuple[str, list[dict[str, Any]], float]] = []
    for raw_key, constituents, center in anchors:
        key = str(raw_key)
        duplicate_index = next((
            index
            for index, (existing_key, _existing_constituents, existing_center)
            in enumerate(deduped_anchors)
            if existing_key == key and abs(existing_center - center) <= anchor_tolerance
        ), None)
        if duplicate_index is None:
            deduped_anchors.append((key, constituents, center))
            continue
        existing = deduped_anchors[duplicate_index]
        if len(constituents) < len(existing[1]):
            deduped_anchors[duplicate_index] = (key, constituents, center)
    anchors = deduped_anchors
    if not anchors:
        return []
    result = []
    for index, (key, _anchor_constituents, center) in enumerate(anchors):
        previous_center = anchors[index - 1][2] if index else None
        next_center = anchors[index + 1][2] if index + 1 < len(anchors) else None
        if forward:
            height = _median_height(regions)
            top = max(0.0, center - max(0.006, height * 1.25))
            bottom = (
                max(top + 0.000001, next_center - max(0.001, height * 0.2))
                if next_center is not None
                else min(1.0, center + max(0.05, height * 6.0))
            )
        else:
            top = (previous_center + center) / 2 if previous_center is not None else max(0.0, center - 0.035)
            bottom = (center + next_center) / 2 if next_center is not None else min(1.0, center + 0.05)
        row = [region for region in regions if top <= _center_y(region["bounds"]) < bottom]
        if require_terminal:
            row = [region for region in row if abs(_center_y(region["bounds"]) - center) <= max(0.012, _median_height(row) * 2.25)]
        result.append((key, sorted(row, key=_region_sort_key)))
    return result


def _line_clusters(regions: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if not regions:
        return []
    tolerance = max(0.0025, _median_height(regions) * 0.72)
    rows: list[list[dict[str, Any]]] = []
    centers: list[float] = []
    for region in sorted(regions, key=lambda item: (
        _center_y(item["bounds"]), _center_x(item["bounds"]), item["id"],
    )):
        center = _center_y(region["bounds"])
        candidates = []
        # Input is y-sorted, so only the recent row centers can overlap this
        # word.  Walking backward until the tolerance is exceeded avoids the
        # quadratic all-rows scan on large native-text pages.
        for index in range(len(centers) - 1, -1, -1):
            row_center = centers[index]
            if center - row_center > tolerance:
                break
            if abs(center - row_center) <= tolerance:
                candidates.append((abs(center - row_center), index))
        if not candidates:
            rows.append([region])
            centers.append(center)
            continue
        _, index = min(candidates)
        rows[index].append(region)
        centers[index] = sum(_center_y(item["bounds"]) for item in rows[index]) / len(rows[index])
    return [sorted(row, key=lambda item: (_center_x(item["bounds"]), item["id"])) for row in rows]


def _same_line_regions(
    anchor: Mapping[str, Any] | None,
    regions: list[dict[str, Any]],
    *,
    x_min: float = 0.0,
    x_max: float = 1.0,
) -> list[dict[str, Any]]:
    if anchor is None:
        return []
    center = _center_y(anchor["bounds"])
    tolerance = max(0.004, _median_height(regions) * 0.9)
    return sorted([
        region for region in regions
        if abs(_center_y(region["bounds"]) - center) <= tolerance
        and x_min <= _center_x(region["bounds"]) <= x_max
    ], key=lambda item: (_center_x(item["bounds"]), item["id"]))


def _regex_role_candidates(
    regions: list[dict[str, Any]],
    pattern: str,
    convert,
    *,
    unit: str | None = None,
) -> list[dict[str, Any]]:
    regex = re.compile(pattern, re.I)
    candidates = []
    for region in regions:
        for match in regex.finditer(region["text"]):
            captured = match.group(1)
            try:
                value = convert(captured)
            except (TypeError, ValueError):
                continue
            candidates.append(_candidate(value, [region], unit=unit))
    for line in _line_clusters(regions):
        text = _joined_text(line)
        for match in regex.finditer(text):
            try:
                value = convert(match.group(1))
            except (TypeError, ValueError):
                continue
            constituents = _phrase_regions(line, regex, exact_match=match)
            # Every numeric regex in this helper has a numeric capture.  Its
            # proof must therefore include at least one exact source region
            # containing a digit.  This prevents span-order mistakes from
            # making a nearby label (for example WATER) prove an area value.
            if constituents and any(
                re.search(r"\d", str(region.get("text") or ""))
                for region in constituents
            ):
                candidates.append(_candidate(value, constituents, unit=unit))
    return candidates


def _literal_role_candidates(
    regions: list[dict[str, Any]],
    values: Mapping[str, str],
) -> list[dict[str, Any]]:
    result = []
    for value, pattern in values.items():
        matches = _matching_regions(regions, pattern)
        if matches:
            result.append(_candidate(value, matches))
    return result


def _integer_candidates(
    regions: list[dict[str, Any]],
    *,
    exclude: set[str],
    unit: str | None = None,
) -> list[dict[str, Any]]:
    result = []
    excluded = {_normalized_text(value) for value in exclude}
    for region in regions:
        if region["normalizedText"] in excluded:
            continue
        cleaned = region["text"].replace(",", "")
        match = re.fullmatch(r"\s*(\d+)\s*(?:SF|SQ\.?\s*FT\.?)?\s*", cleaned, re.I)
        if match:
            result.append(_candidate(int(match.group(1)), [region], unit=unit))
    return result


def _service_candidates(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    patterns = (
        r"(\d+\s+RESTROOMS?(?:\s*(?:\+|AND)\s*\d+\s+JAN(?:ITOR)?\s+CLOSET)?)",
        r"(\d+\s+CONTROL\s+ROOMS?)",
    )
    result = []
    for pattern in patterns:
        regex = re.compile(pattern, re.I)
        direct = []
        for region in regions:
            for match in regex.finditer(region["text"]):
                direct.append((match, [region]))
        matches = direct
        if not matches:
            matches = [
                (match, constituents)
                for line in _line_clusters(regions)
                for match in regex.finditer(_joined_text(line))
                for constituents in [_phrase_regions(line, regex, exact_match=match)]
                if constituents
            ]
        for match, constituents in matches:
            normalized = _clean_spacing(match.group(1)).lower()
            normalized = re.sub(r"\s+and\s+", " + ", normalized)
            normalized = re.sub(r"\bjan\s+closet\b", "janitor closet", normalized)
            result.append(_candidate(normalized, constituents))
    return result


def _numeric_in_column(
    row: list[dict[str, Any]],
    header: Mapping[str, Any],
    headers: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    centers = sorted(_center_x(item["bounds"]) for item in headers)
    target = _center_x(header["bounds"])
    index = centers.index(target)
    left = (centers[index - 1] + target) / 2 if index else target - 0.05
    right = (target + centers[index + 1]) / 2 if index + 1 < len(centers) else target + 0.05
    result = []
    for region in row:
        if not left <= _center_x(region["bounds"]) <= right:
            continue
        try:
            value = float(region["text"].replace(",", "").strip())
        except ValueError:
            continue
        result.append(_candidate(value, [region], unit="fc"))
    return result


def _matching_regions(regions: Iterable[dict[str, Any]], pattern: str) -> list[dict[str, Any]]:
    regex = re.compile(pattern, re.I)
    scoped = list(regions)
    direct = [
        region for region in scoped
        if regex.search(str(region.get("text") or "").replace("_", " "))
    ]
    if direct:
        return direct
    matched: dict[str, dict[str, Any]] = {}
    for line in _line_clusters(scoped):
        for region in _phrase_regions(line, regex):
            matched[region["id"]] = region
    return sorted(matched.values(), key=_region_sort_key)


def _exact_phrase_regions(
    regions: Iterable[dict[str, Any]],
    pattern: str,
) -> list[dict[str, Any]]:
    """Return only the exact same-line span that proves ``pattern``.

    A full row/line region is accepted only when the entire normalized region
    is the identifier.  Otherwise the phrase mapper returns just the word boxes
    intersecting the match, preventing unrelated row cells from being carried
    into identifier provenance.
    """

    regex = re.compile(pattern, re.I)
    scoped = list(regions)
    direct = [
        region for region in scoped
        if regex.fullmatch(str(region.get("text") or "").replace("_", " ").strip())
    ]
    if direct:
        return sorted(direct, key=_region_sort_key)
    matched: dict[str, dict[str, Any]] = {}
    for line in _line_clusters(scoped):
        text = _joined_text(line)
        for match in regex.finditer(text):
            for region in _phrase_regions(line, regex, exact_match=match):
                matched[region["id"]] = region
    return sorted(matched.values(), key=_region_sort_key)


def _phrase_regions(
    regions: Iterable[dict[str, Any]],
    regex: re.Pattern[str],
    *,
    exact_match: re.Match[str] | None = None,
) -> list[dict[str, Any]]:
    """Return only coordinate constituents intersecting a same-line phrase."""

    # ``exact_match`` is an offset into ``_joined_text(regions)``.  Rebuild the
    # text with that exact order before mapping the span back to coordinates;
    # x-only ordering can differ when OCR boxes on one visual row have small
    # y offsets and previously attached a hydrozone value to WATER.
    ordered = list(regions)
    fragments: list[str] = []
    spans: list[tuple[int, int, dict[str, Any]]] = []
    cursor = 0
    for region in ordered:
        fragment = _clean_spacing(str(region.get("text") or "").replace("_", " "))
        if not fragment:
            continue
        if fragments:
            cursor += 1
        start = cursor
        fragments.append(fragment)
        cursor += len(fragment)
        spans.append((start, cursor, region))
    joined = " ".join(fragments)
    match = exact_match or regex.search(joined)
    if match is None:
        return []
    return [
        region for start, end, region in spans
        if start < match.end() and end > match.start()
    ]


def _infer_schema(regions: list[dict[str, Any]]) -> str | None:
    scored = []
    for schema, patterns in _SCHEMA_ANCHORS.items():
        if not _has_primary_anchors(schema, regions):
            continue
        score = sum(any(pattern.search(region["text"]) for region in regions) for pattern in patterns)
        if score >= _SCHEMA_MIN_ANCHORS[schema]:
            scored.append((score, schema))
    if not scored:
        return None
    return max(scored, key=lambda item: (item[0], item[1]))[1]


def _has_primary_anchors(schema: str, regions: list[dict[str, Any]]) -> bool:
    patterns = _SCHEMA_PRIMARY_ANCHORS.get(schema, ())
    return all(any(
        pattern.search(str(region.get("text") or "").replace("_", " "))
        for region in regions
    ) for pattern in patterns)


def _primary_anchor_regions(
    schema: str,
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    patterns = _SCHEMA_PRIMARY_ANCHORS.get(schema, ())
    matched = {
        region["id"]: region
        for pattern in patterns
        for region in regions
        if pattern.search(str(region.get("text") or "").replace("_", " "))
    }
    return sorted(matched.values(), key=_region_sort_key)


def _aggregate_status(items: Sequence[Mapping[str, Any]]) -> str:
    if not items:
        return "incomplete"
    statuses = {str(item.get("status")) for item in items}
    if "conflicted" in statuses:
        return "conflicted"
    if "incomplete" in statuses:
        return "incomplete"
    return "complete"


def _estimated_column_count(regions: list[dict[str, Any]]) -> int:
    if not regions:
        return 0
    centers = sorted(_center_x(region["bounds"]) for region in regions)
    clusters = []
    for center in centers:
        # Word centers are not columns.  Use a deliberately coarse snap so a
        # prose-heavy cell does not consume one logical column per word.
        if not clusters or abs(center - clusters[-1][-1]) > 0.025:
            clusters.append([center])
        else:
            clusters[-1].append(center)
    return len(clusters)


def _column_boundaries(
    headers: list[dict[str, Any]],
    block_bounds: Mapping[str, float],
) -> list[tuple[float, float]]:
    centers = [_center_x(header["bounds"]) for header in headers]
    left_edge = block_bounds["x"]
    right_edge = block_bounds["x"] + block_bounds["width"]
    result = []
    for index, center in enumerate(centers):
        left = (centers[index - 1] + center) / 2 if index else left_edge
        right = (center + centers[index + 1]) / 2 if index + 1 < len(centers) else right_edge
        result.append((left, right))
    return result


def _range_around_center(
    target: float,
    centers: list[float],
    block_bounds: Mapping[str, float],
) -> tuple[float, float]:
    ordered = sorted(set(centers + [target]))
    index = ordered.index(target)
    left_edge = block_bounds["x"]
    right_edge = block_bounds["x"] + block_bounds["width"]
    left = (ordered[index - 1] + target) / 2 if index else left_edge
    right = (target + ordered[index + 1]) / 2 if index + 1 < len(ordered) else right_edge
    return left, right


def _normalized_text(value: str) -> str:
    text = (
        value.upper()
        .replace("_", " ")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("″", '"')
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_spacing(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalize_footing_dimensions(value: str) -> str:
    """Canonicalize a proved W x L x T footing cell.

    Both feet values must retain their literal foot marks.  A missing mark is
    incomplete evidence rather than permission to infer drawing punctuation.
    """

    raw = _clean_spacing(value)
    if len(re.findall(r"['’]", raw)) < 2:
        raise ValueError("foot_mark_required")
    normalized = (
        raw.replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("″", '"')
        .replace("×", "x")
        .replace("–", "-")
        .replace("—", "-")
    )
    match = re.fullmatch(
        r"\s*(\d+)\s*'?\s*-\s*(\d+)\s*\"?\s*x\s*"
        r"(\d+)\s*'?\s*-\s*(\d+)\s*\"?\s*x\s*"
        r"(\d+(?:\.\d+)?)\s*(?:\"|IN(?:CH(?:ES)?)?)\s*",
        normalized,
        re.I,
    )
    if match is None:
        raise ValueError("invalid_footing_dimensions")
    width_feet, width_inches, length_feet, length_inches, thickness = match.groups()
    if int(width_inches) >= 12 or int(length_inches) >= 12 or float(thickness) <= 0:
        raise ValueError("invalid_footing_dimensions")
    return (
        f"{int(width_feet)}'-{int(width_inches)}\" x "
        f"{int(length_feet)}'-{int(length_inches)}\" x "
        f"{float(thickness):g}\""
    )


def _normalize_footing_reinforcing(value: str) -> str:
    raw = (
        _clean_spacing(value)
        .replace("–", "-")
        .replace("—", "-")
    )
    match = re.fullmatch(
        r"(\d+)\s*-\s*(#?)\s*(\d+)"
        r"(?:\s+E\.?\s*W\.?)?"
        r"(?:\s*\(\s*T\s*&\s*B\s*\))?",
        raw,
        re.I,
    )
    if match is None:
        raise ValueError("invalid_footing_reinforcing")
    bar_count, hash_mark, bar_size = match.groups()
    if not hash_mark:
        raise ValueError("bar_mark_required")
    if not (1 <= int(bar_count) <= 99 and 1 <= int(bar_size) <= 18):
        raise ValueError("invalid_footing_reinforcing")
    suffix = " E.W." if re.search(r"\bE\.?\s*W\b\.?", raw, re.I) else ""
    if re.search(r"\(\s*T\s*&\s*B\s*\)", raw, re.I):
        suffix += " (T&B)"
    return f"{int(bar_count)}-#{int(bar_size)}{suffix}"


def _joined_text(regions: Iterable[Mapping[str, Any]]) -> str:
    # Callers supply deterministic geometry order: normalized record regions
    # are y/x ordered, while _line_clusters deliberately returns x-ordered
    # visual rows.  Re-sorting a line by tiny OCR y differences scrambled table
    # cells (and split ``EF - 1`` into ``- 1 EF``), so preserve that order.
    return " ".join(
        _clean_spacing(str(region["text"]).replace("_", " "))
        for region in regions
        if str(region["text"]).strip()
    )


def _stable_id(prefix: str, payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"{prefix}:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:24]}"


def _region_sort_key(region: Mapping[str, Any]) -> tuple[Any, ...]:
    bounds = region["bounds"]
    return (bounds["y"], bounds["x"], bounds["height"], bounds["width"], region["id"])


def _block_sort_key(block: Mapping[str, Any]) -> tuple[Any, ...]:
    bounds = block["bounds"]
    return (bounds["y"], bounds["x"], block["schema"], block["id"])


def _relationship_sort_key(relationship: Mapping[str, Any]) -> tuple[Any, ...]:
    bounds = relationship["rowBounds"]
    return (bounds["y"], bounds["x"], relationship["type"], relationship["rowKey"], relationship["id"])


def _center_x(bounds: Mapping[str, float]) -> float:
    return float(bounds["x"]) + float(bounds["width"]) / 2


def _center_y(bounds: Mapping[str, float]) -> float:
    return float(bounds["y"]) + float(bounds["height"]) / 2


def _center_inside(inner: Mapping[str, float], outer: Mapping[str, float]) -> bool:
    x = _center_x(inner)
    y = _center_y(inner)
    return (
        outer["x"] <= x <= outer["x"] + outer["width"]
        and outer["y"] <= y <= outer["y"] + outer["height"]
    )


def _expanded_intersects(
    left: Mapping[str, float],
    right: Mapping[str, float],
    padding: float,
) -> bool:
    return not (
        left["x"] + left["width"] + padding < right["x"]
        or right["x"] + right["width"] + padding < left["x"]
        or left["y"] + left["height"] + padding < right["y"]
        or right["y"] + right["height"] + padding < left["y"]
    )


def _iou(left: Mapping[str, float], right: Mapping[str, float]) -> float:
    x1 = max(left["x"], right["x"])
    y1 = max(left["y"], right["y"])
    x2 = min(left["x"] + left["width"], right["x"] + right["width"])
    y2 = min(left["y"] + left["height"], right["y"] + right["height"])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if intersection <= 0:
        return 0.0
    union = left["width"] * left["height"] + right["width"] * right["height"] - intersection
    return intersection / union if union else 0.0


def _envelope(bounds_values: Iterable[Mapping[str, float]]) -> dict[str, float]:
    values = list(bounds_values)
    if not values:
        return {"x": 0.0, "y": 0.0, "width": 0.000001, "height": 0.000001}
    x1 = min(value["x"] for value in values)
    y1 = min(value["y"] for value in values)
    x2 = max(value["x"] + value["width"] for value in values)
    y2 = max(value["y"] + value["height"] for value in values)
    return {
        "x": round(x1, 6),
        "y": round(y1, 6),
        "width": round(max(0.000001, x2 - x1), 6),
        "height": round(max(0.000001, y2 - y1), 6),
    }


def _pad_bounds(bounds: Mapping[str, float], *, x_pad: float, y_pad: float) -> dict[str, float]:
    x1 = max(0.0, bounds["x"] - x_pad)
    y1 = max(0.0, bounds["y"] - y_pad)
    x2 = min(1.0, bounds["x"] + bounds["width"] + x_pad)
    y2 = min(1.0, bounds["y"] + bounds["height"] + y_pad)
    return {
        "x": round(x1, 6), "y": round(y1, 6),
        "width": round(x2 - x1, 6), "height": round(y2 - y1, 6),
    }


def _segment_bounds(segment: Mapping[str, Any]) -> dict[str, float]:
    x1 = min(segment["x1"], segment["x2"])
    y1 = min(segment["y1"], segment["y2"])
    x2 = max(segment["x1"], segment["x2"])
    y2 = max(segment["y1"], segment["y2"])
    return {
        "x": x1,
        "y": y1,
        "width": max(0.000001, x2 - x1),
        "height": max(0.000001, y2 - y1),
    }


def _snapped_coordinates(segments: list[dict[str, Any]], key: str) -> list[float]:
    result = []
    for value in sorted(segment[key] for segment in segments):
        if not result or abs(value - result[-1]) > 0.002:
            result.append(value)
    return result


def _overlaps_existing(
    candidate: Mapping[str, Any],
    existing: list[Mapping[str, Any]],
    *,
    same_schema: bool = False,
) -> bool:
    return any(
        (not same_schema or block["schema"] == candidate["schema"])
        and _iou(block["bounds"], candidate["bounds"]) >= 0.45
        for block in existing
    )


def _median_height(regions: Sequence[Mapping[str, Any]]) -> float:
    values = [float(region["bounds"]["height"]) for region in regions if region["bounds"]["height"] > 0]
    return median(values) if values else 0.01
