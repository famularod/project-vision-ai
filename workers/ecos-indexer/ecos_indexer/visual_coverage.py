from __future__ import annotations

import re
import math
from typing import Any


SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
VISUAL_COVERAGE_SCHEMA_VERSION = "ecos-visual-coverage/1.0"
VISUAL_RENDER_METHOD = "pymupdf_rgb_png"
VISUAL_ANALYSIS_METHOD = "tesseract_coordinate_ocr_psm11"
VISUAL_ANALYSIS_SUBTILE_GRID = 3
VISUAL_ANALYSIS_SUBTILE_OVERLAP_PIXELS = 48
MIN_VISUAL_TILE_DPI = 150
MAX_VISUAL_TILE_DPI = 300
MAX_VISUAL_TILE_PIXEL_DIMENSION = 6_000
MAX_VISUAL_TILE_PIXELS = 18_000_000
REQUIRED_VISUAL_TILE_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    "0:0:333:500": (0.0, 0.0, 1.0 / 3.0, 0.5),
    "333:0:333:500": (1.0 / 3.0, 0.0, 1.0 / 3.0, 0.5),
    "667:0:333:500": (2.0 / 3.0, 0.0, 1.0 / 3.0, 0.5),
    "0:500:333:500": (0.0, 0.5, 1.0 / 3.0, 0.5),
    "333:500:333:500": (1.0 / 3.0, 0.5, 1.0 / 3.0, 0.5),
    "667:500:333:500": (2.0 / 3.0, 0.5, 1.0 / 3.0, 0.5),
}
REQUIRED_VISUAL_TILE_KEYS = frozenset(REQUIRED_VISUAL_TILE_BOUNDS)


def bounds_match(value: Any, expected: tuple[float, float, float, float]) -> bool:
    if not isinstance(value, dict):
        return False
    raw_values = [value.get(key) for key in ("x", "y", "width", "height")]
    if any(
        isinstance(item, bool)
        or not isinstance(item, (int, float))
        or not math.isfinite(item)
        for item in raw_values
    ):
        return False
    actual = tuple(float(item) for item in raw_values)
    return all(abs(left - right) <= 1e-9 for left, right in zip(actual, expected))


def valid_completed_visual_tile_proof(
    proof: Any,
    *,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
) -> bool:
    """Return true only for one exact, current, independently analyzed tile.

    Summary counters are deliberately excluded from this predicate. A tile is
    complete only when its render and OCR-analysis artifacts are fingerprinted,
    its exact page bounds are known, and its emitted region identifiers agree
    with the recorded analysis count.
    """
    if not isinstance(proof, dict):
        return False
    tile_key = str(proof.get("tileKey") or "").strip()
    expected_bounds = REQUIRED_VISUAL_TILE_BOUNDS.get(tile_key)
    analysis_region_ids = proof.get("analysisRegionIds")
    searchable_region_ids = proof.get("searchableRegionIds")
    subtile_proofs = proof.get("analysisSubtileProofs")
    integer_fields = [
        proof.get("renderDpi"),
        proof.get("renderPixelWidth"),
        proof.get("renderPixelHeight"),
        proof.get("analysisRegionCount"),
        proof.get("searchableRegionCount"),
    ]
    if any(isinstance(value, bool) or not isinstance(value, int) for value in integer_fields):
        return False
    render_dpi, image_width, image_height, analysis_region_count, searchable_region_count = integer_fields
    valid_top_level = (
        expected_bounds is not None
        and proof.get("state") == "completed"
        and proof.get("pageNumber") == expected_page_number
        and str(proof.get("sourceSha256") or "").strip().lower() == expected_source_sha256
        and str(proof.get("evidenceVersion") or "").strip() == expected_evidence_version
        and bounds_match(proof.get("bounds"), expected_bounds)
        and str(proof.get("renderMethod") or "").strip() == VISUAL_RENDER_METHOD
        and str(proof.get("analysisMethod") or "").strip() == VISUAL_ANALYSIS_METHOD
        and bool(SHA256_PATTERN.fullmatch(str(proof.get("renderSha256") or "").strip().lower()))
        and bool(SHA256_PATTERN.fullmatch(str(proof.get("analysisInputSha256") or "").strip().lower()))
        and bool(SHA256_PATTERN.fullmatch(str(proof.get("analysisSha256") or "").strip().lower()))
        and MIN_VISUAL_TILE_DPI <= render_dpi <= MAX_VISUAL_TILE_DPI
        and 1 <= image_width <= MAX_VISUAL_TILE_PIXEL_DIMENSION
        and 1 <= image_height <= MAX_VISUAL_TILE_PIXEL_DIMENSION
        and image_width * image_height <= MAX_VISUAL_TILE_PIXELS
        and analysis_region_count >= 0
        and searchable_region_count >= 0
        and searchable_region_count <= analysis_region_count
        and isinstance(analysis_region_ids, list)
        and len(analysis_region_ids) == analysis_region_count
        and len(set(str(value) for value in analysis_region_ids)) == analysis_region_count
        and all(str(value).startswith(f"visual-tile-{tile_key}-") for value in analysis_region_ids)
        and isinstance(searchable_region_ids, list)
        and len(searchable_region_ids) == searchable_region_count
        and len(set(str(value) for value in searchable_region_ids)) == searchable_region_count
        and set(str(value) for value in searchable_region_ids).issubset(
            set(str(value) for value in analysis_region_ids)
        )
    )
    if not valid_top_level or not isinstance(subtile_proofs, list):
        return False
    expected_subtiles = expected_visual_subtile_pixel_bounds(image_width, image_height)
    if len(subtile_proofs) != len(expected_subtiles):
        return False
    seen_keys: set[str] = set()
    subtile_region_ids: list[str] = []
    for subtile in subtile_proofs:
        if not isinstance(subtile, dict):
            return False
        key = str(subtile.get("subtileKey") or "")
        expected_pixels = expected_subtiles.get(key)
        ids = subtile.get("analysisRegionIds")
        count = subtile.get("analysisRegionCount")
        if (
            expected_pixels is None
            or key in seen_keys
            or subtile.get("state") != "completed"
            or not pixel_bounds_match(subtile.get("pixelBounds"), expected_pixels)
            or not SHA256_PATTERN.fullmatch(
                str(subtile.get("analysisInputSha256") or "").strip().lower()
            )
            or not SHA256_PATTERN.fullmatch(
                str(subtile.get("analysisSha256") or "").strip().lower()
            )
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            or not isinstance(ids, list)
            or len(ids) != count
            or len(set(str(value) for value in ids)) != count
            or not all(
                str(value).startswith(f"visual-tile-{tile_key}-subtile-{key}-")
                for value in ids
            )
        ):
            return False
        seen_keys.add(key)
        subtile_region_ids.extend(str(value) for value in ids)
    return (
        seen_keys == set(expected_subtiles)
        and len(set(subtile_region_ids)) == len(subtile_region_ids)
        and subtile_region_ids == [str(value) for value in analysis_region_ids]
    )


def expected_visual_subtile_pixel_bounds(
    image_width: int,
    image_height: int,
) -> dict[str, tuple[int, int, int, int]]:
    if image_width < 1 or image_height < 1:
        return {}
    result: dict[str, tuple[int, int, int, int]] = {}
    for row in range(VISUAL_ANALYSIS_SUBTILE_GRID):
        for column in range(VISUAL_ANALYSIS_SUBTILE_GRID):
            left = max(
                0,
                column * image_width // VISUAL_ANALYSIS_SUBTILE_GRID
                - (VISUAL_ANALYSIS_SUBTILE_OVERLAP_PIXELS if column else 0),
            )
            right = min(
                image_width,
                (column + 1) * image_width // VISUAL_ANALYSIS_SUBTILE_GRID
                + (
                    VISUAL_ANALYSIS_SUBTILE_OVERLAP_PIXELS
                    if column + 1 < VISUAL_ANALYSIS_SUBTILE_GRID
                    else 0
                ),
            )
            top = max(
                0,
                row * image_height // VISUAL_ANALYSIS_SUBTILE_GRID
                - (VISUAL_ANALYSIS_SUBTILE_OVERLAP_PIXELS if row else 0),
            )
            bottom = min(
                image_height,
                (row + 1) * image_height // VISUAL_ANALYSIS_SUBTILE_GRID
                + (
                    VISUAL_ANALYSIS_SUBTILE_OVERLAP_PIXELS
                    if row + 1 < VISUAL_ANALYSIS_SUBTILE_GRID
                    else 0
                ),
            )
            result[f"{row}:{column}"] = (left, top, right, bottom)
    return result


def pixel_bounds_match(value: Any, expected: tuple[int, int, int, int]) -> bool:
    if not isinstance(value, dict):
        return False
    values = [value.get(key) for key in ("x", "y", "width", "height")]
    if any(isinstance(item, bool) or not isinstance(item, int) for item in values):
        return False
    left, top, right, bottom = expected
    return (
        value.get("x") == left
        and value.get("y") == top
        and value.get("width") == right - left
        and value.get("height") == bottom - top
    )
