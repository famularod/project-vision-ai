from __future__ import annotations

import hashlib
import io
import json
import os
import re
import time
from collections import Counter
from itertools import combinations
from typing import Any, Callable

import pymupdf as fitz
import pytesseract
from PIL import Image, ImageFilter, ImageOps
from pytesseract import Output

from . import EVIDENCE_VERSION
from .sheet_mapping import StructuralSheetIdentity, map_sheet
from .plan_dimensions import detect_plan_dimension_reads
from .structured_table_pipeline import (
    StructuredTableInputRejected,
    StructuredTableResourceRejected,
    analyze_page_structured_tables,
)
from .visual_coverage import (
    MAX_VISUAL_TILE_PIXEL_DIMENSION as CONTRACT_MAX_VISUAL_TILE_PIXEL_DIMENSION,
    MAX_VISUAL_TILE_PIXELS as CONTRACT_MAX_VISUAL_TILE_PIXELS,
    MAX_VISUAL_TILE_DPI,
    MIN_VISUAL_TILE_DPI,
    REQUIRED_VISUAL_TILE_BOUNDS,
    REQUIRED_VISUAL_TILE_KEYS,
    VISUAL_ANALYSIS_METHOD,
    VISUAL_COVERAGE_SCHEMA_VERSION,
    VISUAL_RENDER_METHOD,
    valid_completed_visual_tile_proof,
)


# Construction PDFs often preserve only a few title-block strings as embedded
# text while the actual notes and callouts are outlined vectors.  Treating 80
# metadata characters as a searchable page caused ECOS to skip OCR on pages
# such as Civil C6 even though the construction notes were plainly visible.
MIN_NATIVE_CHARACTERS = 600

# A single low-resolution page pass is both faster and more complete than many
# high-resolution sparse-text tiles.  On the reference 36x24 drawing sheets it
# preserves small construction-note text while keeping the rendered page below
# ten megapixels.  Oversized sheets still split into bounded tiles.
OCR_DPI = 100
MAX_OCR_DPI = 300
OCR_TARGET_LONG_EDGE_PIXELS = 3600
DENSE_TEXT_OCR_DPI = 300
DIMENSION_OCR_DPI = 450
TITLE_BLOCK_OCR_DPI = 240
TITLE_BLOCK_X = 0.68
TITLE_BLOCK_Y = 0.65
SHEET_IDENTITY_OCR_DPI = 200
SHEET_IDENTITY_X = 0.88
# A common issued architectural title block places DATE / SCALE / JOB NUMBER
# and SHEET NUMBER in a narrow page-bound band.  Outlined sheet-number glyphs
# need a higher-resolution, light-stroke pass than the rest of the title
# block.  These bounds deliberately include the label, value, and ``OF ...
# SHEETS`` footer so the value can be structurally validated instead of
# inferred from any nearby drawing token.
PAGE_BOUND_SHEET_IDENTITY_X0 = 0.885
PAGE_BOUND_SHEET_IDENTITY_X1 = 0.997
PAGE_BOUND_SHEET_IDENTITY_Y0 = 0.91
PAGE_BOUND_SHEET_IDENTITY_Y1 = 0.999
PAGE_BOUND_SHEET_IDENTITY_DPI = 576
PAGE_BOUND_SHEET_VALUE_X0 = 0.925
PAGE_BOUND_SHEET_VALUE_Y0 = 0.945
PAGE_BOUND_SHEET_VALUE_Y1 = 0.985
OCR_TILE_PIXELS = 4096
OCR_TILE_OVERLAP_PIXELS = 96
MAX_OCR_TILES = max(1, min(256, int(os.getenv("ECOS_MAX_OCR_TILES_PER_PAGE", "128"))))
MAX_SOURCE_PAGES = max(1, min(10000, int(os.getenv("ECOS_MAX_SOURCE_PAGES", "500"))))
MAX_PAGE_DIMENSION_POINTS = max(1440, min(100000, int(os.getenv("ECOS_MAX_PAGE_DIMENSION_POINTS", "20000"))))
MAX_VECTOR_PATHS = max(1000, min(1000000, int(os.getenv("ECOS_MAX_VECTOR_PATHS_PER_PAGE", "200000"))))
FACT_PATTERN = re.compile(
    r"\b(?:HAZ(?:ARDOUS)?\.?\s+(?:MAT(?:ERIAL)?\.?|WASTE)|CANOPY\s+[A-Z]|"
    r"\d+(?:\.\d+)?\s*(?:FEET|FOOT|FT\.?|'|INCH(?:ES)?|IN\.?|\"|SF|SQ\.?\s*FT\.?)|"
    r"LIGHT(?:ING|S)?|SLAB|PCC|CONCRETE)\b",
    re.IGNORECASE,
)
# Low-confidence OCR is allowed to consume a paid visual check only when it can
# carry a project fact. Generic drawing-navigation words are still searchable
# when OCR reads them confidently, but DETAIL / SECTION / REVISION alone are
# not evidence worth escalating to a visual provider.
VISUAL_EXCEPTION_FACT_PATTERN = re.compile(
    r"\b(?:HAZ(?:ARDOUS)?\.?\s+(?:MAT(?:ERIAL)?\.?|WASTE)|CANOPY\s+[A-Z]|"
    r"LIGHT(?:ING|S)?|SLAB|PCC|CONCRETE)\b",
    re.IGNORECASE,
)
DENSE_TEXT_HEADING_PATTERN = re.compile(
    r"\b(?:CONSTRUCTION|DEMOLITION|GENERAL|KEYED|PLAN)?\s*(?:NOTES?|SCHEDULES?)\b",
    re.IGNORECASE,
)
OCR_TRUST_CONFIDENCE = 0.35
VISUAL_MEASUREMENT_CORRECTION_SOURCE = (
    "fixed_visual_tile_measurement_transcription_correction"
)
OUTLINED_TEXT_COMPACT_PATH_LIMIT_POINTS = 24.0
OUTLINED_TEXT_MIN_COMPACT_PATHS = 48
STRICT_SHEET_IDENTITY_PATTERN = re.compile(
    r"^(?:(?:[A-Z]{1,4}(?:-[A-Z]{1,4}){1,2}-\d{1,3}(?:\.\d{1,3})?[A-Z]?)|"
    r"(?:[A-Z]{1,4}[-.]?\d{1,3}(?:\.\d{1,3})?[A-Z]?))$",
    re.IGNORECASE,
)
PAGE_BOUND_SHEET_LABEL_PATTERN = re.compile(r"^SHEET(?:NO|NUMBER|NUM)$", re.IGNORECASE)
PAGE_BOUND_SHEET_FOOTER_PATTERN = re.compile(r"^SHEETS?$", re.IGNORECASE)
# A one-letter architectural token with only an integer component is a common
# truncation of identities such as A-2.3A.  OCR alone cannot prove it is
# complete, so it remains unresolved unless a structural PDF identity exists.
AMBIGUOUS_PAGE_BOUND_ARCHITECTURAL_IDENTITY_PATTERN = re.compile(
    r"^A-\d{1,2}$", re.IGNORECASE,
)
STRICT_FOOT_INCH_PATTERN = re.compile(
    r"(?<!\w)(\d{1,4})\s*['\u2019]\s*-\s*(\d{1,2})(?:\s+(\d+)\s*/\s*(\d+))?\s*[\"\u201d]",
    re.IGNORECASE,
)
CORRUPTED_ZERO_INCH_FOOT_PATTERN = re.compile(
    r"(?<!\w)(\d{1,3})\s*['\u2019]\s*(?:[\u00b0\u00ba]\s*)?[-\u2013\u2014=]\s*[0OQ]\s*[\"\u201d]",
    re.IGNORECASE,
)
RECTANGULAR_FOOT_MEASUREMENT_PATTERN = re.compile(
    r"(?<!\w)(\d{1,3})\s*['\u2019]\s*[xX\u00d7]\s*(\d{1,3})\s*['\u2019](?!\w)",
    re.IGNORECASE,
)
SINGLE_FOOT_MEASUREMENT_PATTERN = re.compile(
    r"(?<![\dA-Z])([+-]?)\s*(\d{1,3})\s*(?:['\u2019](?![A-Z0-9.*\u00d7\-\u2013\u2014=])|FT\.?(?![A-Z])|FEET\b|FOOT\b)",
    re.IGNORECASE,
)
INCOMPLETE_SIMPLE_FOOT_INCH_PATTERN = re.compile(
    r"^\s*[+-]?\s*\d{1,3}\s*['\u2019]\s*[-\u2013\u2014=]\s*"
    r"(?:[0-9OQ]{0,2}(?:\s+\d+\s*/\s*\d+)?\s*)?[\"\u201d]?\s*$",
    re.IGNORECASE,
)
TRAILING_DASH_FOOT_FRAGMENT_PATTERN = re.compile(
    r"^\s*[+-]?\s*\d{1,3}\s*['\u2019]\s*[-\u2013\u2014=]+[.\s]*$",
    re.IGNORECASE,
)
FOOT_INCH_CANDIDATE_PATTERN = re.compile(
    r"(?<!\d)\d{1,4}\s*(?:['\u2019](?![A-Z])|FEET\b|FOOT\b|FT\.?(?![A-Z]))\s*-?\s*\d{0,2}"
    r"(?:\s+\d+\s*/\s*\d+)?\s*(?:[\"\u201d]|INCH(?:ES)?\b|IN\.?(?![A-Z]))?",
    re.IGNORECASE,
)
STRICT_CONSTRUCTION_MEASUREMENT_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:[\"\u201d]|INCH(?:ES)?|IN\.?)\s+THICK\s+(?:PCC|CONCRETE|SLAB|PAVING|WALKWAY)\b",
    re.IGNORECASE,
)
DIRECT_HAZARDOUS_STORAGE_AREA_LABEL_PATTERN = re.compile(
    r"(?:^|\s)(?:PROPOSED\s+NEW\s+)?WEATHER\s+PROTECTED\s+"
    r"(?:EXT\s+)?HAZ(?:ARDOUS)?\s+MAT(?:L|ERIAL)\s+STORAGE\s+"
    r"(?:AREA\s+)?C(?:\s|$)",
    re.IGNORECASE,
)
LABEL_BLOCK_DISALLOWED_CONTEXT_PATTERN = re.compile(
    r"\b(?:SUMMARY|DETAILS?|LAYOUT|PLANS?|SEE\s+SHEET|TITLE)\b",
    re.IGNORECASE,
)
EXPLICIT_AREA_IDENTIFIER_PATTERN = re.compile(r"\bAREA\s+([A-Z])\b", re.IGNORECASE)
LABEL_BLOCK_MAX_WIDTH = 0.14
LABEL_BLOCK_MAX_HEIGHT = 0.03
LABEL_BLOCK_MAX_LINE_GAP = 0.0045
LABEL_BLOCK_MAX_SAME_OCR_BLOCK_LINE_GAP = 0.008
# Six fixed tiles are a page-coverage detector, not the evidentiary deep read.
# At 2,400 px, dense civil linework could keep Tesseract busy beyond the page
# deadline even though the same issued sheet is legible at the contract's
# 150-DPI floor.  The 1,800-px target keeps a 36x24 drawing tile at 150 DPI;
# bounded table/label retries remain 200/300 DPI when exact facts need it.
VISUAL_TILE_TARGET_LONG_EDGE_PIXELS = 1800
VISUAL_TILE_OCR_CONFIG = "--psm 11"
VISUAL_TILE_SUBTILE_GRID = 3
VISUAL_TILE_SUBTILE_OVERLAP_PIXELS = 48
MAX_VISUAL_TILE_PIXEL_DIMENSION = max(
    1024,
    min(
        CONTRACT_MAX_VISUAL_TILE_PIXEL_DIMENSION,
        int(os.getenv("ECOS_MAX_VISUAL_TILE_PIXEL_DIMENSION", "6000")),
    ),
)
MAX_VISUAL_TILE_PIXELS = max(
    1_000_000,
    min(
        CONTRACT_MAX_VISUAL_TILE_PIXELS,
        int(os.getenv("ECOS_MAX_VISUAL_TILE_PIXELS", "18000000")),
    ),
)
VISUAL_TILE_OCR_TIMEOUT_SECONDS = max(
    5, min(300, int(os.getenv("ECOS_VISUAL_TILE_OCR_TIMEOUT_SECONDS", "45"))),
)
STRUCTURED_TABLE_OCR_DPI = 300
STRUCTURED_TABLE_CORROBORATION_DPI = 200
STRUCTURED_TABLE_OCR_CONFIG = "--psm 6"
STRUCTURED_TABLE_ANALYSIS_METHOD = "tesseract_coordinate_ocr_psm6_dual_dpi"
TARGETED_MEASUREMENT_CORROBORATION_DPI = 600
MAX_TARGETED_MEASUREMENT_CORROBORATION_REGIONS = 6
STRUCTURED_TABLE_HEADING_PATTERN = re.compile(
    r"\b(?:PLANT\s+MATERIALS\s+LIST|HYDROZONE\s+DATA|MWELO\s+CALCULATIONS)\b",
    re.IGNORECASE,
)
STRUCTURED_TABLE_TARGET_SPECS: tuple[dict[str, Any], ...] = (
    {
        "kind": "plant_materials",
        "pattern": re.compile(r"\bPLANT\s+MATERIALS\s+LIST\b", re.IGNORECASE),
        # Include the symbol/quantity columns to the left of the printed
        # heading and the next section boundary below the tree rows.
        "offset": (-0.04, -0.035),
        "size": (0.28, 0.45),
    },
    {
        "kind": "hydrozone_data",
        "pattern": re.compile(r"\bHYDROZONE\s+DATA\b", re.IGNORECASE),
        "offset": (-0.012, -0.012),
        "size": (0.14, 0.08),
    },
    {
        "kind": "water_budget",
        "pattern": re.compile(r"\bMWELO\s+CALCULATIONS\b", re.IGNORECASE),
        "offset": (-0.012, -0.012),
        "size": (0.24, 0.29),
    },
)


def open_pdf(pdf_bytes: bytes) -> fitz.Document:
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except (RuntimeError, ValueError) as error:
        raise DocumentResourceRejected("malformed_pdf") from error
    if document.needs_pass:
        document.close()
        raise DocumentResourceRejected("encrypted_pdf_not_supported")
    if document.page_count < 1 or document.page_count > MAX_SOURCE_PAGES:
        document.close()
        raise DocumentResourceRejected("pdf_page_count_outside_limit")
    return document


def extract_page(
    page: fitz.Page,
    source_sha256: str,
    *,
    project_id: str,
    document_sheet_identity: StructuralSheetIdentity | None = None,
    evidence_version: str = EVIDENCE_VERSION,
    visual_tile_checkpoint: dict[str, Any] | None = None,
    on_visual_tile_checkpoint: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    if min(page_width, page_height) <= 0 or max(page_width, page_height) > MAX_PAGE_DIMENSION_POINTS:
        raise DocumentResourceRejected("pdf_page_dimensions_outside_limit")
    native_regions = native_text_regions(page, page_width, page_height)
    native_text = "\n".join(region["text"] for region in native_regions)
    geometry = deterministic_geometry(page)
    # An exact page-bound structural identity is faster and more reliable than
    # asking OCR to interpret the same title-block glyphs again. Its true
    # bookmark or native-title-band provenance remains attached below.
    title_block_regions = [] if document_sheet_identity else title_block_ocr_regions(
        page, page_width, page_height,
    )
    sheet_identity_regions = [] if document_sheet_identity else sheet_identity_ocr_regions(
        page, page_width, page_height,
    )
    raw_ocr_regions: list[dict[str, Any]] = [*title_block_regions, *sheet_identity_regions]
    visual_tile_regions, visual_tile_proofs = fixed_visual_tile_ocr_regions(
        page,
        page_width,
        page_height,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
        checkpoint=visual_tile_checkpoint,
        on_checkpoint=on_visual_tile_checkpoint,
    )
    raw_ocr_regions.extend(visual_tile_regions)
    ocr_reason = coordinate_ocr_reason(page, native_text, geometry=geometry)
    # The fixed six-tile pass already provides complete page-bound detection
    # coverage. Do not run the legacy whole-page/tiled OCR path as well: on
    # vector-heavy schedule sheets it repeats the same render and coordinate
    # OCR work, can exceed the page deadline, and adds no independent proof.
    # ``ocr_reason`` remains diagnostic context for the page record.
    ocr_regions, low_confidence_regions = trusted_ocr_regions(raw_ocr_regions)
    targeted_measurement_regions = targeted_measurement_corroboration_regions(
        page,
        page_width,
        page_height,
        low_confidence_regions,
    )
    if targeted_measurement_regions:
        raw_ocr_regions.extend(targeted_measurement_regions)
        ocr_regions, low_confidence_regions = trusted_ocr_regions(raw_ocr_regions)
    searchable_visual_region_ids = {
        str(region.get("id") or "") for region in ocr_regions
        if str(region.get("source") or "") == "fixed_visual_tile_coordinate_ocr"
    }
    for proof in visual_tile_proofs:
        analysis_region_ids = [str(value) for value in proof.get("analysisRegionIds") or []]
        proof["searchableRegionIds"] = [
            region_id for region_id in analysis_region_ids
            if region_id in searchable_visual_region_ids
        ]
        proof["searchableRegionCount"] = len(proof["searchableRegionIds"])
    base_regions = dedupe_regions([*native_regions, *ocr_regions])
    plan_dimension_analysis, plan_dimension_targets = detect_plan_dimension_reads(
        page, base_regions, ocr_regions_for_clip, project_id=project_id,
        source_sha256=source_sha256, evidence_version=evidence_version,
    )
    (
        structured_table_regions,
        structured_table_low_confidence,
        legacy_structured_table_analysis,
        legacy_structured_table_unresolved,
    ) = analyze_structured_tables(
        page,
        page_width,
        page_height,
        base_regions,
        native_regions=native_regions,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    low_confidence_regions = dedupe_regions([
        *low_confidence_regions,
        *structured_table_low_confidence,
    ])
    regions = dedupe_regions([*base_regions, *structured_table_regions])
    # Reconstruct only the small, explicit multi-line drawing labels whose
    # trusted OCR constituents occupy one bounded label block. This runs after
    # the OCR trust gate so rejected text can never become a relationship by
    # being concatenated with accepted words.
    label_block_facts, label_block_unresolved = analyze_deterministic_label_blocks(regions)
    regions = dedupe_regions([*regions, *label_block_facts])
    mapping = map_sheet(
        regions,
        page_width,
        page_height,
        structural_identity=document_sheet_identity,
        page_number=page.number + 1,
    )
    structured_table_hints = standalone_structured_table_hints(
        legacy_structured_table_analysis,
    )
    structured_table_segments = structured_table_vector_segments(
        page,
        page_width,
        page_height,
    )
    try:
        (
            structured_relationship_facts,
            structured_table_analysis,
            structured_table_unresolved,
        ) = analyze_page_structured_tables(
            project_id=project_id,
            source_sha256=source_sha256,
            page_number=page.number + 1,
            evidence_version=evidence_version,
            sheet_number=mapping.get("sheetNumber"),
            regions=regions,
            vector_segments=structured_table_segments,
            block_hints=structured_table_hints,
        )
        targeted_regions, targeted_proofs = standalone_structured_table_targeted_ocr(
            page,
            page_width,
            page_height,
            structured_table_analysis,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
        if targeted_regions:
            regions = dedupe_regions([*regions, *targeted_regions])
            (
                structured_relationship_facts,
                structured_table_analysis,
                structured_table_unresolved,
            ) = analyze_page_structured_tables(
                project_id=project_id,
                source_sha256=source_sha256,
                page_number=page.number + 1,
                evidence_version=evidence_version,
                sheet_number=mapping.get("sheetNumber"),
                regions=regions,
                vector_segments=structured_table_segments,
                block_hints=structured_table_hints,
                targeted_ocr_proofs=targeted_proofs,
            )
    except (StructuredTableInputRejected, StructuredTableResourceRejected) as error:
        # A producer identity mismatch or deterministic resource-limit breach
        # cannot be softened into searchable flattened OCR.
        raise DocumentResourceRejected(f"structured_table_analysis_rejected:{error}") from error
    table_scoped_region_ids = {
        str(region_id)
        for block in (
            structured_table_analysis.get("blocks")
            if isinstance(structured_table_analysis, dict)
            and isinstance(structured_table_analysis.get("blocks"), list)
            else []
        )
        if isinstance(block, dict)
        for region_id in (block.get("regionIds") or [])
    }
    # Keep exact coordinate constituents in the durable page record so
    # Assurance can independently replay the relationship, but mark them as
    # non-searchable. Only a complete relationship fact may enter page text or
    # the database search materialization; flattened cells cannot bypass the
    # table gate.
    regions = [
        ({**region, "searchable": False}
         if str(region.get("id") or "") in table_scoped_region_ids
         else region)
        for region in regions
    ]
    structured_facts = deterministic_fact_regions(
        regions,
        excluded_region_ids=table_scoped_region_ids,
    )
    # Relationship facts are intentionally kept separate from their raw
    # constituents even when one single source region contains the complete
    # visible statement. Collapsing them together would either erase the
    # constituent needed for Assurance replay or inherit `searchable: false`
    # onto the independently verified fact.
    searchable_regions = [*dedupe_regions([
        *regions,
        *structured_facts,
    ]), *structured_relationship_facts]
    combined_text = "\n".join(
        region["text"] for region in searchable_regions
        if region.get("searchable") is not False
    )
    unresolved = unresolved_regions(
        searchable_regions,
        mapping,
        native_character_count=len(native_text.strip()),
        ocr_attempted=bool(raw_ocr_regions),
        low_confidence_regions=low_confidence_regions,
    )
    unresolved.extend(label_block_unresolved)
    unresolved.extend(plan_dimension_targets)
    # The legacy helper is now a bounded OCR/geometry producer only. Once the
    # standalone evaluator has detected a table, its relationship-level gaps
    # are authoritative; retaining the producer's older row-count gap as well
    # could reject a table that the stricter role/constituent check completed.
    if structured_table_analysis is None:
        unresolved.extend(legacy_structured_table_unresolved)
    final_page = {
        "pageNumber": page.number + 1,
        "sourceSha256": source_sha256,
        "sheetNumber": mapping["sheetNumber"],
        "sheetMappingStatus": mapping["sheetMappingStatus"],
        "sheetMappingConfidence": mapping["sheetMappingConfidence"],
        "sheetMappingSource": mapping.get("sheetMappingSource"),
        "sheetMappingEvidence": mapping.get("sheetMappingEvidence") or [],
        "sheetMappingCandidates": mapping["sheetMappingCandidates"],
        "title": first_meaningful_line(combined_text),
        "text": combined_text[:100000] or None,
        "regions": [public_region(region) for region in searchable_regions],
        "deterministicGeometry": geometry,
        "extractionStrategy": "pdf_structure_then_native_text_then_coordinate_ocr",
        "visualCoverage": completed_visual_coverage(
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
            proofs=visual_tile_proofs,
        ),
        # Table analysis is an evidentiary-completeness check. It is separate
        # from six-tile detection coverage because seeing every tile does not
        # prove that all cells in a dense schedule were reconstructed.
        "projectId": project_id,
        "structuredTableAnalysis": structured_table_analysis,
        # Relationship-level gaps remain explicit limitations and targeted OCR
        # work, but they do not invalidate independently complete facts or an
        # otherwise usable page. Raw constituents stay non-searchable above.
        "structuredTableLimitations": structured_table_unresolved,
        "planDimensionAnalysis": plan_dimension_analysis,
    }
    return {
        "native": {"regions": native_regions, "characterCount": len(native_text.strip())},
        "ocr": {
            "regions": ocr_regions,
            "rejectedLowConfidenceRegions": low_confidence_regions,
            "attempted": True,
            "used": bool(ocr_regions),
            "reason": "+".join(filter(None, [
                (
                    f"{document_sheet_identity.source}_identity"
                    if document_sheet_identity
                    else "title_block_identity"
                ),
                ocr_reason,
            ])),
            "dpi": page_ocr_dpi(page),
            "tileCount": (0 if document_sheet_identity else 4) + len(visual_tile_proofs),
            "visualTileRegions": visual_tile_regions,
            "visualTileProofs": visual_tile_proofs,
            "structuredTableAnalysis": structured_table_analysis,
            "legacyStructuredTableAnalysis": legacy_structured_table_analysis,
        },
        "deterministic": {
            "sheetMapping": mapping,
            "documentStructuralIdentity": (
                document_sheet_identity.as_dict()
                if document_sheet_identity
                else None
            ),
            "geometry": geometry,
            "labelBlockFactCount": len(label_block_facts),
            "unresolvedLabelBlockCount": len(label_block_unresolved),
            "structuredTableAnalysis": structured_table_analysis,
            "legacyStructuredTableAnalysis": legacy_structured_table_analysis,
        },
        "final": final_page,
        "unresolved": unresolved,
    }


def fixed_visual_tile_ocr_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    source_sha256: str,
    evidence_version: str,
    checkpoint: dict[str, Any] | None = None,
    on_checkpoint: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Render and OCR the six fixed page tiles, independent of exception detection.

    This is detection coverage, not proof that any requested project fact
    exists. Each completed tile is source/page/version bound and fingerprints
    both the rendered raster and exact OCR result. Valid checkpointed tiles are
    reused; incomplete or mismatched checkpoint material is ignored and
    re-analyzed.
    """
    page_number = page.number + 1
    completed_regions, completed_proofs = resumed_visual_tile_work(
        checkpoint,
        expected_page_number=page_number,
        expected_source_sha256=source_sha256,
        expected_evidence_version=evidence_version,
    )
    proof_by_key = {str(proof["tileKey"]): proof for proof in completed_proofs}
    region_by_id = {str(region.get("id") or ""): region for region in completed_regions}
    dpi = visual_tile_render_dpi(page_width, page_height)

    for tile_key, (x, y, width, height) in REQUIRED_VISUAL_TILE_BOUNDS.items():
        if tile_key in proof_by_key:
            continue
        clip = fitz.Rect(
            page_width * x,
            page_height * y,
            page_width * (x + width),
            page_height * (y + height),
        )
        try:
            regions, proof = analyze_fixed_visual_tile(
                page,
                clip,
                page_width,
                page_height,
                tile_key=tile_key,
                bounds=(x, y, width, height),
                page_number=page_number,
                source_sha256=source_sha256,
                evidence_version=evidence_version,
                dpi=dpi,
            )
        except VisualTileAnalysisFailed:
            raise
        except Exception as error:
            raise VisualTileAnalysisFailed(f"visual_tile_analysis_failed:{tile_key}") from error
        for region in regions:
            region_by_id[str(region["id"])] = region
        proof_by_key[tile_key] = proof
        if on_checkpoint:
            on_checkpoint(visual_tile_checkpoint_payload(
                page_number=page_number,
                source_sha256=source_sha256,
                evidence_version=evidence_version,
                regions=list(region_by_id.values()),
                proofs=list(proof_by_key.values()),
            ))

    ordered_proofs = [proof_by_key[key] for key in REQUIRED_VISUAL_TILE_BOUNDS]
    ordered_region_ids = [
        str(region_id)
        for proof in ordered_proofs
        for region_id in proof.get("analysisRegionIds") or []
    ]
    return [region_by_id[region_id] for region_id in ordered_region_ids], ordered_proofs


def analyze_fixed_visual_tile(
    page: fitz.Page,
    clip: fitz.Rect,
    page_width: float,
    page_height: float,
    *,
    tile_key: str,
    bounds: tuple[float, float, float, float],
    page_number: int,
    source_sha256: str,
    evidence_version: str,
    dpi: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started_at = time.monotonic()
    scale = dpi / 72.0
    expected_pixel_width = max(1, int(round(float(clip.width) * scale)))
    expected_pixel_height = max(1, int(round(float(clip.height) * scale)))
    if (
        expected_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or expected_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or expected_pixel_width * expected_pixel_height > MAX_VISUAL_TILE_PIXELS
    ):
        raise VisualTileAnalysisFailed(f"visual_tile_resource_limit_exceeded:{tile_key}")
    try:
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(scale, scale),
            clip=clip,
            alpha=False,
            colorspace=fitz.csRGB,
        )
        rendered_png = pixmap.tobytes("png")
    except Exception as error:
        raise VisualTileAnalysisFailed(f"visual_tile_render_failed:{tile_key}") from error
    if not rendered_png or pixmap.width < 1 or pixmap.height < 1:
        raise VisualTileAnalysisFailed(f"visual_tile_render_empty:{tile_key}")

    try:
        with Image.open(io.BytesIO(rendered_png)) as source_image:
            source_image.load()
            image = ImageOps.autocontrast(source_image.convert("L"))
            analysis_input = image.tobytes()
            image_width, image_height = image.size
    except RuntimeError as error:
        if "timeout" in str(error).lower():
            raise VisualTileAnalysisFailed(f"visual_tile_ocr_timeout:{tile_key}") from error
        raise VisualTileAnalysisFailed(f"visual_tile_ocr_failed:{tile_key}") from error
    except Exception as error:
        raise VisualTileAnalysisFailed(f"visual_tile_ocr_failed:{tile_key}") from error
    regions: list[dict[str, Any]] = []
    subtile_proofs: list[dict[str, Any]] = []
    # Dense vector drawings can make a single 1,800px Tesseract segmentation
    # super-linear and exceed the page deadline. Analyze a deterministic 3x3
    # overlap grid inside each of the six fixed coverage tiles. The outer tile
    # remains the coverage unit; the subtiles are explicit, fingerprinted
    # proof that every pixel band was actually inspected.
    for subtile_key, pixel_bounds in fixed_visual_tile_subtile_bounds(
        image_width, image_height,
    ):
        left, top, right, bottom = pixel_bounds
        crop = image.crop((left, top, right, bottom))
        crop_input = crop.tobytes()
        try:
            data = pytesseract.image_to_data(
                crop,
                output_type=Output.DICT,
                config=VISUAL_TILE_OCR_CONFIG,
                timeout=min(VISUAL_TILE_OCR_TIMEOUT_SECONDS, 20),
            )
        except RuntimeError as error:
            if "timeout" in str(error).lower():
                raise VisualTileAnalysisFailed(
                    f"visual_tile_subtile_ocr_timeout:{tile_key}:{subtile_key}"
                ) from error
            raise VisualTileAnalysisFailed(
                f"visual_tile_subtile_ocr_failed:{tile_key}:{subtile_key}"
            ) from error
        if not isinstance(data, dict) or not isinstance(data.get("text"), list):
            raise VisualTileAnalysisFailed(
                f"visual_tile_subtile_ocr_invalid:{tile_key}:{subtile_key}"
            )
        subtile_clip = fitz.Rect(
            float(clip.x0) + float(clip.width) * left / image_width,
            float(clip.y0) + float(clip.height) * top / image_height,
            float(clip.x0) + float(clip.width) * right / image_width,
            float(clip.y0) + float(clip.height) * bottom / image_height,
        )
        prefix = f"visual-tile-{tile_key}-subtile-{subtile_key}"
        subtile_regions = ocr_data_regions(
            data,
            clip=subtile_clip,
            image_width=right - left,
            image_height=bottom - top,
            page_width=page_width,
            page_height=page_height,
            prefix=prefix,
            source="fixed_visual_tile_coordinate_ocr",
            minimum_confidence=0.0,
        )
        regions.extend(subtile_regions)
        region_payload = [{
            key: region.get(key)
            for key in (
                "id", "text", "x", "y", "width", "height", "confidence", "ocrKind",
            )
        } for region in subtile_regions]
        subtile_proofs.append({
            "subtileKey": subtile_key,
            "state": "completed",
            "pixelBounds": {
                "x": left, "y": top, "width": right - left, "height": bottom - top,
            },
            "analysisInputSha256": hashlib.sha256(crop_input).hexdigest(),
            "analysisSha256": hashlib.sha256(json.dumps(
                region_payload,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
            ).encode("utf-8")).hexdigest(),
            "analysisRegionCount": len(subtile_regions),
            "analysisRegionIds": [str(region["id"]) for region in subtile_regions],
        })
    analysis_region_ids = [str(region["id"]) for region in regions]
    proof = {
        "tileKey": tile_key,
        "bounds": {
            "x": bounds[0], "y": bounds[1], "width": bounds[2], "height": bounds[3],
        },
        "state": "completed",
        "pageNumber": page_number,
        "sourceSha256": source_sha256,
        "evidenceVersion": evidence_version,
        "renderMethod": VISUAL_RENDER_METHOD,
        "analysisMethod": VISUAL_ANALYSIS_METHOD,
        "renderDpi": dpi,
        "renderPixelWidth": int(pixmap.width),
        "renderPixelHeight": int(pixmap.height),
        "renderSha256": hashlib.sha256(rendered_png).hexdigest(),
        "analysisInputSha256": hashlib.sha256(analysis_input).hexdigest(),
        "analysisSha256": visual_tile_analysis_sha256(tile_key, regions),
        "analysisSubtileProofs": subtile_proofs,
        "analysisRegionCount": len(analysis_region_ids),
        "analysisRegionIds": analysis_region_ids,
        # The trust gate runs after all six tiles. Until then no extracted OCR
        # region may be represented as searchable evidence.
        "searchableRegionCount": 0,
        "searchableRegionIds": [],
        "analysisDurationMs": max(0, int((time.monotonic() - started_at) * 1000)),
    }
    return regions, proof


def fixed_visual_tile_subtile_bounds(
    image_width: int,
    image_height: int,
) -> list[tuple[str, tuple[int, int, int, int]]]:
    if image_width < 1 or image_height < 1:
        return []
    result: list[tuple[str, tuple[int, int, int, int]]] = []
    for row in range(VISUAL_TILE_SUBTILE_GRID):
        for column in range(VISUAL_TILE_SUBTILE_GRID):
            left = max(
                0,
                column * image_width // VISUAL_TILE_SUBTILE_GRID
                - (VISUAL_TILE_SUBTILE_OVERLAP_PIXELS if column else 0),
            )
            right = min(
                image_width,
                (column + 1) * image_width // VISUAL_TILE_SUBTILE_GRID
                + (
                    VISUAL_TILE_SUBTILE_OVERLAP_PIXELS
                    if column + 1 < VISUAL_TILE_SUBTILE_GRID
                    else 0
                ),
            )
            top = max(
                0,
                row * image_height // VISUAL_TILE_SUBTILE_GRID
                - (VISUAL_TILE_SUBTILE_OVERLAP_PIXELS if row else 0),
            )
            bottom = min(
                image_height,
                (row + 1) * image_height // VISUAL_TILE_SUBTILE_GRID
                + (
                    VISUAL_TILE_SUBTILE_OVERLAP_PIXELS
                    if row + 1 < VISUAL_TILE_SUBTILE_GRID
                    else 0
                ),
            )
            result.append((f"{row}:{column}", (left, top, right, bottom)))
    return result


def visual_tile_render_dpi(page_width: float, page_height: float) -> int:
    override = str(os.getenv("ECOS_LOCAL_VISUAL_TILE_DPI") or "").strip()
    if override:
        try:
            return max(MIN_VISUAL_TILE_DPI, min(MAX_VISUAL_TILE_DPI, int(override)))
        except ValueError:
            pass
    largest_tile_dimension = max(page_width / 3.0, page_height / 2.0, 1.0)
    target_dpi = round((VISUAL_TILE_TARGET_LONG_EDGE_PIXELS * 72.0) / largest_tile_dimension)
    return max(MIN_VISUAL_TILE_DPI, min(MAX_VISUAL_TILE_DPI, target_dpi))


def resumed_visual_tile_work(
    checkpoint: dict[str, Any] | None,
    *,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(checkpoint, dict):
        return [], []
    raw_regions = checkpoint.get("regions")
    raw_proofs = checkpoint.get("completedDeepReadRegionProofs")
    if not isinstance(raw_regions, list) or not isinstance(raw_proofs, list):
        return [], []
    region_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if isinstance(region, dict) and str(region.get("id") or "")
    }
    accepted_proofs: list[dict[str, Any]] = []
    accepted_region_ids: list[str] = []
    accepted_region_id_set: set[str] = set()
    seen_keys: set[str] = set()
    for proof in raw_proofs:
        if not valid_completed_visual_tile_proof(
            proof,
            expected_page_number=expected_page_number,
            expected_source_sha256=expected_source_sha256,
            expected_evidence_version=expected_evidence_version,
        ):
            continue
        tile_key = str(proof["tileKey"])
        analysis_ids = [str(value) for value in proof.get("analysisRegionIds") or []]
        proof_regions = [region_by_id.get(region_id) for region_id in analysis_ids]
        expected_bounds = REQUIRED_VISUAL_TILE_BOUNDS[tile_key]
        if (
            tile_key in seen_keys
            or any(region is None for region in proof_regions)
            or any(region_id in accepted_region_id_set for region_id in analysis_ids)
            or any(not region_is_bound_to_visual_tile(region, tile_key, expected_bounds)
                   for region in proof_regions)
            or visual_tile_analysis_sha256(
                tile_key,
                [region for region in proof_regions if isinstance(region, dict)],
            ) != str(proof.get("analysisSha256") or "").strip().lower()
        ):
            continue
        seen_keys.add(tile_key)
        accepted_proofs.append(dict(proof))
        accepted_region_ids.extend(analysis_ids)
        accepted_region_id_set.update(analysis_ids)
    return [region_by_id[region_id] for region_id in accepted_region_ids], accepted_proofs


def visual_tile_analysis_sha256(tile_key: str, regions: list[dict[str, Any]]) -> str:
    canonical_regions = [{
        key: region.get(key)
        for key in (
            "id", "text", "x", "y", "width", "height", "confidence", "source", "ocrKind",
        )
    } for region in regions]
    return hashlib.sha256(json.dumps({
        "analysisMethod": VISUAL_ANALYSIS_METHOD,
        "tileKey": tile_key,
        "regions": canonical_regions,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def region_is_bound_to_visual_tile(
    region: Any,
    tile_key: str,
    bounds: tuple[float, float, float, float],
) -> bool:
    if not isinstance(region, dict):
        return False
    if (
        not str(region.get("id") or "").startswith(f"visual-tile-{tile_key}-")
        or str(region.get("source") or "") != "fixed_visual_tile_coordinate_ocr"
    ):
        return False
    try:
        x = float(region["x"])
        y = float(region["y"])
        width = float(region["width"])
        height = float(region["height"])
    except (KeyError, TypeError, ValueError):
        return False
    tile_x, tile_y, tile_width, tile_height = bounds
    return (
        width > 0 and height > 0
        and tile_x - 1e-9 <= x
        and tile_y - 1e-9 <= y
        and x + width <= tile_x + tile_width + 1e-9
        and y + height <= tile_y + tile_height + 1e-9
    )


def visual_tile_checkpoint_payload(
    *,
    page_number: int,
    source_sha256: str,
    evidence_version: str,
    regions: list[dict[str, Any]],
    proofs: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": VISUAL_COVERAGE_SCHEMA_VERSION,
        "evidenceVersion": evidence_version,
        "sourceSha256": source_sha256,
        "pageNumber": page_number,
        "regions": regions,
        "completedDeepReadRegionProofs": proofs,
    }


def completed_visual_coverage(
    *,
    page_number: int,
    source_sha256: str,
    evidence_version: str,
    proofs: list[dict[str, Any]],
) -> dict[str, Any]:
    completed_keys = [str(proof.get("tileKey") or "") for proof in proofs]
    complete = (
        len(completed_keys) == len(REQUIRED_VISUAL_TILE_KEYS)
        and set(completed_keys) == REQUIRED_VISUAL_TILE_KEYS
        and all(valid_completed_visual_tile_proof(
            proof,
            expected_page_number=page_number,
            expected_source_sha256=source_sha256,
            expected_evidence_version=evidence_version,
        ) for proof in proofs)
    )
    return {
        "schemaVersion": VISUAL_COVERAGE_SCHEMA_VERSION,
        "evidenceVersion": evidence_version,
        "sourceSha256": source_sha256,
        "pageNumber": page_number,
        "overviewAnalyzed": complete,
        "requestedDeepReadRegionCount": len(REQUIRED_VISUAL_TILE_KEYS),
        "completedDeepReadRegionCount": len(completed_keys),
        "coverageComplete": complete,
        "completedDeepReadRegionKeys": completed_keys,
        "completedDeepReadRegionProofs": proofs,
        "failureCodes": [] if complete else ["visual_tile_proofs_invalid"],
    }


def analyze_structured_tables(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    regions: list[dict[str, Any]],
    *,
    native_regions: list[dict[str, Any]],
    source_sha256: str,
    evidence_version: str,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Reconstruct bounded dense tables and fail closed on missing cells.

    Six-tile coverage only proves that the page was inspected. Dense schedules
    need a separate coordinate-row check before their cells are searchable.
    Embedded PDF coordinates are used first; a single bounded 300-DPI target
    is rendered only when those native rows are incomplete. This avoids the
    former whole-page OCR repeat on vector-heavy schedules while preserving an
    exact, independently fingerprinted fallback for outlined table text.
    """
    headings: list[tuple[dict[str, Any], dict[str, Any]]] = []
    seen_targets: set[tuple[str, int, int]] = set()
    for region in regions:
        text = str(region.get("text") or "")
        if not STRUCTURED_TABLE_HEADING_PATTERN.search(text):
            continue
        for spec in STRUCTURED_TABLE_TARGET_SPECS:
            if not spec["pattern"].search(text):
                continue
            key = (
                str(spec["kind"]),
                round(float(region.get("x") or 0) * 100),
                round(float(region.get("y") or 0) * 100),
            )
            if key not in seen_targets:
                seen_targets.add(key)
                headings.append((region, spec))
            break

    all_rows: list[dict[str, Any]] = []
    all_rejected: list[dict[str, Any]] = []
    analyses: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for target_index, (heading, spec) in enumerate(headings, start=1):
        kind = str(spec["kind"])
        bounds = structured_table_target_bounds(heading, spec)
        native_target_regions = regions_with_centers_in_bounds(native_regions, bounds)
        native_rows = reconstruct_coordinate_table_rows(
            native_target_regions,
            target_kind=kind,
            target_index=target_index,
            reconstruction_method="embedded_coordinate_row_grouping",
        )
        native_complete, native_checks = structured_table_completeness(kind, native_rows)
        if native_complete:
            proof = native_table_analysis_proof(
                native_rows,
                target_kind=kind,
                bounds=bounds,
                page_number=page.number + 1,
                source_sha256=source_sha256,
                evidence_version=evidence_version,
            )
            rows = native_rows
            checks = native_checks
        else:
            raw_target_regions, proof = analyze_structured_table_target(
                page,
                page_width,
                page_height,
                target_kind=kind,
                target_index=target_index,
                bounds=bounds,
                page_number=page.number + 1,
                source_sha256=source_sha256,
                evidence_version=evidence_version,
            )
            trusted_target_regions, rejected_target_regions = trusted_structured_table_regions(
                raw_target_regions
            )
            all_rejected.extend(rejected_target_regions)
            rows = reconstruct_coordinate_table_rows(
                trusted_target_regions,
                target_kind=kind,
                target_index=target_index,
                reconstruction_method="bounded_high_resolution_coordinate_row_grouping",
            )
            complete, checks = structured_table_completeness(kind, rows)
            proof["searchableRowIds"] = [str(row["id"]) for row in rows]
            proof["searchableRowCount"] = len(rows)
            native_complete = complete

        analysis = {
            "targetKind": kind,
            "bounds": bounds,
            "status": "complete" if native_complete else "incomplete",
            "rowCount": len(rows),
            "rowIds": [str(row["id"]) for row in rows],
            "completenessChecks": checks,
            "proof": proof,
        }
        analyses.append(analysis)
        all_rows.extend(rows)
        if not native_complete:
            unresolved.append({
                "regionKey": f"structured-table-{kind}-{target_index}",
                "bounds": bounds,
                "reason": (
                    f"The {kind.replace('_', ' ')} table was detected, but its "
                    "required coordinate rows or cells were incomplete after a "
                    "bounded high-resolution analysis. Detection coverage does "
                    "not make the missing cells factual evidence."
                ),
                "structuredTableTargetKind": kind,
                "completenessChecks": checks,
                "diagnosticCandidateCount": len(rows),
                "diagnosticCandidates": [label_constituent_evidence(row) for row in rows[:24]],
            })
    return dedupe_regions(all_rows), dedupe_regions(all_rejected), analyses, unresolved


def standalone_structured_table_hints(
    legacy_analyses: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Translate exact visible-heading targets into pure-engine geometry hints.

    The legacy bounded OCR helper contributes geometry only. It cannot supply
    a relationship or mark a fact complete; the standalone engine must still
    reconstruct every required role from coordinate regions inside the hint.
    """
    schema_by_target = {
        "plant_materials": "plant_material",
        "hydrozone_data": "hydrozone_summary",
        "water_budget": "water_budget",
    }
    hints: list[dict[str, Any]] = []
    for index, analysis in enumerate(legacy_analyses):
        if not isinstance(analysis, dict):
            continue
        schema = schema_by_target.get(str(analysis.get("targetKind") or ""))
        bounds = analysis.get("bounds")
        if not schema or not isinstance(bounds, dict):
            continue
        hints.append({
            "schema": schema,
            "bounds": bounds,
            "label": f"visible-heading-target-{index + 1}",
        })
    return hints


def standalone_structured_table_targeted_ocr(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    analysis: dict[str, Any] | None,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run one bounded local OCR retry for each incomplete detected block.

    Fixed six-tile OCR is the full-page detector.  This retry never expands a
    block and never creates a fact itself; it contributes higher-resolution
    coordinate tokens which the pure relationship evaluator must independently
    reconstruct.  Trusted-coordinate hints are skipped because their legacy
    producer already performed the same dual-DPI bounded pass.
    """
    if not isinstance(analysis, dict):
        return [], []
    blocks = [
        block for block in (analysis.get("blocks") or [])
        if isinstance(block, dict)
        and block.get("status") != "complete"
        and block.get("detectionMethod") != "trusted_coordinate_hint"
        and isinstance(block.get("bounds"), dict)
    ]
    # The pure engine already caps pages at twelve blocks.  A separate smaller
    # retry budget prevents a dense false-positive page from multiplying OCR
    # work while preserving the known 2321/2375 benchmark schedules.
    blocks = sorted(blocks, key=lambda block: (
        float(block["bounds"].get("y") or 0),
        float(block["bounds"].get("x") or 0),
        str(block.get("id") or ""),
    ))[:4]
    trusted_regions: list[dict[str, Any]] = []
    proofs: list[dict[str, Any]] = []
    for index, block in enumerate(blocks, start=1):
        try:
            raw_regions, proof = analyze_structured_table_target(
                page,
                page_width,
                page_height,
                target_kind=f"standalone_{str(block.get('schema') or 'table')}",
                target_index=index,
                bounds=dict(block["bounds"]),
                page_number=page.number + 1,
                source_sha256=source_sha256,
                evidence_version=evidence_version,
            )
        except VisualTileAnalysisFailed:
            # This is a bounded refinement pass, not the six-tile coverage
            # contract.  If its exact block is too large, times out, or cannot
            # be rendered, retain the evaluator's targetedOcrRequest and
            # incomplete relationship as the truthful limitation.  Failing
            # the entire page here would erase independently complete sibling
            # facts without creating any additional evidence.
            continue
        accepted, _rejected = trusted_structured_table_regions(raw_regions)
        proof = {
            **proof,
            "projectId": str(project_id or "").strip(),
            "structuredTableBlockId": str(block.get("id") or ""),
            "structuredTableSchema": str(block.get("schema") or ""),
            "trustedRegionIds": [str(region["id"]) for region in accepted],
            "trustedRegionCount": len(accepted),
            "rejectedRegionCount": max(0, len(raw_regions) - len(accepted)),
        }
        trusted_regions.extend(accepted)
        proofs.append(proof)
    return dedupe_regions(trusted_regions), proofs


def structured_table_vector_segments(
    page: fitz.Page,
    page_width: float,
    page_height: float,
) -> list[dict[str, Any]]:
    """Return a bounded complete set of horizontal/vertical PDF segments.

    A partial line sample could manufacture a grid that is not present, so an
    over-limit page falls back to coordinate anchors instead of truncating.
    """
    if page_width <= 0 or page_height <= 0:
        return []
    segments: list[dict[str, Any]] = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        for item_index, item in enumerate(drawing.get("items") or []):
            if not item or item[0] != "l" or len(item) < 3:
                continue
            try:
                start = item[1]
                end = item[2]
                # PyMuPDF vector coordinates are in unrotated page space,
                # while OCR and page.rect use the displayed page. Without
                # this transform a rotated drawing's geometry is clamped
                # onto the wrong edges before table/relationship detection.
                if page.rotation:
                    start = start * page.rotation_matrix
                    end = end * page.rotation_matrix
                x1 = max(0.0, min(1.0, float(start.x) / page_width))
                y1 = max(0.0, min(1.0, float(start.y) / page_height))
                x2 = max(0.0, min(1.0, float(end.x) / page_width))
                y2 = max(0.0, min(1.0, float(end.y) / page_height))
            except (AttributeError, TypeError, ValueError):
                continue
            if abs(y2 - y1) > 0.002 and abs(x2 - x1) > 0.002:
                continue
            segments.append({
                "id": f"pdf-line-{drawing_index}-{item_index}",
                "x1": round(x1, 6),
                "y1": round(y1, 6),
                "x2": round(x2, 6),
                "y2": round(y2, 6),
            })
            if len(segments) > 5_000:
                return []
    return segments


def structured_table_target_bounds(
    heading: dict[str, Any], spec: dict[str, Any],
) -> dict[str, float]:
    offset_x, offset_y = spec["offset"]
    target_width, target_height = spec["size"]
    x = max(0.0, min(1.0, float(heading.get("x") or 0) + float(offset_x)))
    y = max(0.0, min(1.0, float(heading.get("y") or 0) + float(offset_y)))
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "width": round(min(float(target_width), 1.0 - x), 6),
        "height": round(min(float(target_height), 1.0 - y), 6),
    }


def regions_with_centers_in_bounds(
    regions: list[dict[str, Any]], bounds: dict[str, float],
) -> list[dict[str, Any]]:
    x0 = float(bounds["x"])
    y0 = float(bounds["y"])
    x1 = x0 + float(bounds["width"])
    y1 = y0 + float(bounds["height"])
    result: list[dict[str, Any]] = []
    for region in regions:
        center_x = float(region.get("x") or 0) + float(region.get("width") or 0) / 2.0
        center_y = float(region.get("y") or 0) + float(region.get("height") or 0) / 2.0
        if x0 <= center_x <= x1 and y0 <= center_y <= y1:
            result.append(region)
    return result


def reconstruct_coordinate_table_rows(
    regions: list[dict[str, Any]],
    *,
    target_kind: str,
    target_index: int,
    reconstruction_method: str,
) -> list[dict[str, Any]]:
    # OCR line objects duplicate their constituent words. Reconstruct from the
    # words when available; embedded PDF extraction already emits one region
    # per coordinate line/cell and therefore uses all native constituents.
    words = [region for region in regions if region.get("ocrKind") == "word"]
    candidates = words or [
        region for region in regions
        if region.get("ocrKind") != "line"
    ]
    candidates = [
        region for region in candidates
        if str(region.get("text") or "").strip()
        and 0 < float(region.get("height") or 0) <= 0.035
    ]
    ordered = sorted(candidates, key=lambda region: (
        float(region.get("y") or 0) + float(region.get("height") or 0) / 2.0,
        float(region.get("x") or 0),
    ))
    groups: list[list[dict[str, Any]]] = []
    for region in ordered:
        center_y = float(region.get("y") or 0) + float(region.get("height") or 0) / 2.0
        best_group: list[dict[str, Any]] | None = None
        best_delta = 1.0
        for group in groups:
            group_center = sum(
                float(item.get("y") or 0) + float(item.get("height") or 0) / 2.0
                for item in group
            ) / len(group)
            tolerance = max(
                0.0015,
                min(0.006, max(
                    float(region.get("height") or 0),
                    *(float(item.get("height") or 0) for item in group),
                ) * 0.72),
            )
            delta = abs(center_y - group_center)
            if delta <= tolerance and delta < best_delta:
                best_group = group
                best_delta = delta
        if best_group is None:
            groups.append([region])
        else:
            best_group.append(region)

    rows: list[dict[str, Any]] = []
    for group_index, group in enumerate(groups, start=1):
        constituents = sorted(group, key=lambda region: float(region.get("x") or 0))
        text = re.sub(
            r"\s+", " ",
            " ".join(str(region.get("text") or "").strip() for region in constituents),
        ).strip()
        if not text:
            continue
        bounds = normalized_region_bounds(constituents[0])
        for constituent in constituents[1:]:
            bounds = union_region_bounds(bounds, normalized_region_bounds(constituent))
        identity = hashlib.sha256(json.dumps({
            "kind": target_kind,
            "text": text,
            "bounds": bounds,
            "constituents": [str(region.get("id") or "") for region in constituents],
        }, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
        rows.append({
            "id": f"structured-table-{target_kind}-{target_index}-{group_index}-{identity}",
            "text": text,
            "label": text[:240],
            **bounds,
            "confidence": bounded(min(
                float(region.get("confidence") or 0) for region in constituents
            )),
            "source": "deterministic_structured_table_row",
            "reconstructionMethod": reconstruction_method,
            "evidenceSources": sorted({
                str(region.get("source") or "") for region in constituents
            }),
            "constituentEvidence": [
                label_constituent_evidence(region) for region in constituents
            ],
        })
    return rows


def trusted_structured_table_regions(
    regions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Trust low-score table glyphs only when a second DPI reads them exactly.

    A standalone quantity such as ``3`` or ``9`` is not syntax-valid proof by
    itself. Dense schedules often assign it a low confidence even when the
    surrounding row is clear. The bounded table target is therefore read at
    two render resolutions, and a low-score word is admitted only when the
    second independent raster reads the exact normalized token at the same
    page coordinate. This preserves the value; it never guesses one from the
    row label or expected fixture.
    """
    accepted, rejected = trusted_ocr_regions(regions)
    accepted_ids = {str(region.get("id") or "") for region in accepted}
    for region in regions:
        if str(region.get("id") or "") in accepted_ids:
            continue
        text = re.sub(r"[^A-Z0-9]+", "", normalize_ocr_punctuation(
            str(region.get("text") or "")
        ).upper())
        if not text:
            continue
        source = str(region.get("source") or "")
        center_x = float(region.get("x") or 0) + float(region.get("width") or 0) / 2.0
        center_y = float(region.get("y") or 0) + float(region.get("height") or 0) / 2.0
        corroborated = False
        corroborating_sources: set[str] = set()
        for candidate in regions:
            candidate_source = str(candidate.get("source") or "")
            if candidate is region or not candidate_source or candidate_source == source:
                continue
            candidate_text = re.sub(r"[^A-Z0-9]+", "", normalize_ocr_punctuation(
                str(candidate.get("text") or "")
            ).upper())
            if candidate_text != text:
                continue
            candidate_x = float(candidate.get("x") or 0) + float(candidate.get("width") or 0) / 2.0
            candidate_y = float(candidate.get("y") or 0) + float(candidate.get("height") or 0) / 2.0
            if abs(center_x - candidate_x) <= 0.012 and abs(center_y - candidate_y) <= 0.004:
                corroborated = True
                corroborating_sources.add(candidate_source)
        if corroborated:
            accepted.append({
                **region,
                "ocrValidationStatus": "dual_dpi_coordinate_corroborated",
                "ocrCorroboratingSources": sorted({source, *corroborating_sources}),
            })
            accepted_ids.add(str(region.get("id") or ""))
    accepted = dedupe_structured_table_tokens(accepted)
    rejected = [
        region for region in rejected
        if str(region.get("id") or "") not in accepted_ids
    ]
    return accepted, rejected


def dedupe_structured_table_tokens(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    words = sorted(
        (region for region in regions if region.get("ocrKind") == "word"),
        key=lambda region: float(region.get("confidence") or 0),
        reverse=True,
    )
    retained_words: list[dict[str, Any]] = []
    for region in words:
        token = re.sub(r"[^A-Z0-9]+", "", normalize_ocr_punctuation(
            str(region.get("text") or "")
        ).upper())
        center_x = float(region.get("x") or 0) + float(region.get("width") or 0) / 2.0
        center_y = float(region.get("y") or 0) + float(region.get("height") or 0) / 2.0
        duplicate = False
        for existing in retained_words:
            existing_token = re.sub(r"[^A-Z0-9]+", "", normalize_ocr_punctuation(
                str(existing.get("text") or "")
            ).upper())
            existing_x = float(existing.get("x") or 0) + float(existing.get("width") or 0) / 2.0
            existing_y = float(existing.get("y") or 0) + float(existing.get("height") or 0) / 2.0
            if (
                token
                and token == existing_token
                and abs(center_x - existing_x) <= 0.004
                and abs(center_y - existing_y) <= 0.003
            ):
                duplicate = True
                break
        if not duplicate:
            retained_words.append(region)
    non_words = [region for region in regions if region.get("ocrKind") != "word"]
    return dedupe_regions([*retained_words, *non_words])


def structured_table_completeness(
    target_kind: str, rows: list[dict[str, Any]],
) -> tuple[bool, dict[str, Any]]:
    normalized_rows = [
        (row, normalize_ocr_punctuation(str(row.get("text") or "")).upper())
        for row in rows
    ]
    if target_kind == "hydrozone_data":
        categories: dict[str, bool] = {}
        for category in ("HIGH", "MEDIUM", "LOW"):
            matches = [text for _, text in normalized_rows if f"{category} WATER ZONE" in text]
            categories[category.lower()] = any(
                re.search(r"\(\s*\d{1,3}\s*%\s*\)", text)
                and re.search(r"\b\d[\d,]*\s*S\.?\s*F\.?", text)
                for text in matches
            )
        checks = {
            "requiredRows": ["high", "medium", "low"],
            "rowsWithPercentAndArea": categories,
        }
        return all(categories.values()), checks

    if target_kind == "water_budget":
        joined = "\n".join(text for _, text in normalized_rows)
        etwu = bool(re.search(r"\bETWU\s+TOTAL\D{0,16}\d[\d,]*\b", joined))
        mawa = bool(re.search(
            r"(?:MAXIMUM\s+ALLOWED\s+WATER\s+ALLOWANCE|\bMAWA\b)\D{0,24}\d[\d,]*\b",
            joined,
        ))
        checks = {"etwuTotalWithValue": etwu, "mawaWithValue": mawa}
        return etwu and mawa, checks

    if target_kind == "plant_materials":
        header = next((
            (row, text) for row, text in normalized_rows
            if "QTY" in text and "SIZE" in text
            and ("BOTANICAL" in text or "COMMON NAME" in text)
        ), None)
        trees = next(((row, text) for row, text in normalized_rows if "TREES" in text), None)
        shrubs = next(((row, text) for row, text in normalized_rows if "SHRUBS" in text), None)
        item_rows: list[tuple[dict[str, Any], str]] = []
        if trees and shrubs:
            trees_y = float(trees[0].get("y") or 0)
            shrubs_y = float(shrubs[0].get("y") or 0)
            for row, text in normalized_rows:
                row_y = float(row.get("y") or 0)
                if not (trees_y < row_y < shrubs_y):
                    continue
                size_match = re.search(
                    r"\b(?:\d{1,3}(?:\s*[\"”°»]){0,4}\s*BOX|"
                    r"\d{1,3}\s*GAL\.?)\b",
                    text,
                )
                if not size_match:
                    continue
                prefix = text[:size_match.start()].strip()
                has_quantity = bool(re.search(r"(?:^|\D)(\d{1,4})\s*$", prefix))
                descriptive_words = re.findall(r"[A-Z]{2,}", text[size_match.end():])
                if has_quantity and len(descriptive_words) >= 4:
                    item_rows.append((row, text))
        row_centers = [
            float(row.get("y") or 0) + float(row.get("height") or 0) / 2.0
            for row, _ in item_rows
        ]
        spacing_consistent = False
        if len(row_centers) >= 2 and trees and shrubs:
            anchors = [
                float(trees[0].get("y") or 0) + float(trees[0].get("height") or 0) / 2.0,
                *sorted(row_centers),
                float(shrubs[0].get("y") or 0) + float(shrubs[0].get("height") or 0) / 2.0,
            ]
            gaps = [right - left for left, right in zip(anchors, anchors[1:]) if right > left]
            median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 0.0
            spacing_consistent = bool(
                median_gap > 0 and max(gaps, default=1.0) <= median_gap * 2.35
            )
        checks = {
            "columnHeaderDetected": header is not None,
            "treeSectionBoundaryDetected": trees is not None,
            "nextSectionBoundaryDetected": shrubs is not None,
            "detectedTreeItemRowCount": len(item_rows),
            "allDetectedTreeRowsHaveQuantitySizeAndNames": len(item_rows) >= 2,
            "rowSpacingHasNoMissingBand": spacing_consistent,
        }
        return (
            header is not None
            and trees is not None
            and shrubs is not None
            and len(item_rows) >= 2
            and spacing_consistent
        ), checks

    return False, {"unsupportedTargetKind": target_kind}


def native_table_analysis_proof(
    rows: list[dict[str, Any]],
    *,
    target_kind: str,
    bounds: dict[str, float],
    page_number: int,
    source_sha256: str,
    evidence_version: str,
) -> dict[str, Any]:
    payload = [{
        "id": row.get("id"), "text": row.get("text"),
        "x": row.get("x"), "y": row.get("y"),
        "width": row.get("width"), "height": row.get("height"),
    } for row in rows]
    return {
        "targetKind": target_kind,
        "bounds": bounds,
        "state": "completed",
        "pageNumber": page_number,
        "sourceSha256": source_sha256,
        "evidenceVersion": evidence_version,
        "analysisMethod": "pymupdf_embedded_coordinate_row_grouping",
        "analysisSha256": hashlib.sha256(json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8")).hexdigest(),
        "searchableRowIds": [str(row["id"]) for row in rows],
        "searchableRowCount": len(rows),
    }


def analyze_structured_table_target(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    target_kind: str,
    target_index: int,
    bounds: dict[str, float],
    page_number: int,
    source_sha256: str,
    evidence_version: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started_at = time.monotonic()
    clip = fitz.Rect(
        page_width * float(bounds["x"]),
        page_height * float(bounds["y"]),
        page_width * (float(bounds["x"]) + float(bounds["width"])),
        page_height * (float(bounds["y"]) + float(bounds["height"])),
    )
    regions: list[dict[str, Any]] = []
    analysis_passes: list[dict[str, Any]] = []
    try:
        for pass_name, dpi in (
            ("primary", STRUCTURED_TABLE_OCR_DPI),
            ("corroboration", STRUCTURED_TABLE_CORROBORATION_DPI),
        ):
            scale = dpi / 72.0
            expected_pixel_width = max(1, int(round(float(clip.width) * scale)))
            expected_pixel_height = max(1, int(round(float(clip.height) * scale)))
            if (
                expected_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
                or expected_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
                or expected_pixel_width * expected_pixel_height > MAX_VISUAL_TILE_PIXELS
            ):
                raise VisualTileAnalysisFailed(
                    f"structured_table_resource_limit_exceeded:{target_kind}:{target_index}"
                )
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(scale, scale), clip=clip,
                alpha=False, colorspace=fitz.csRGB,
            )
            rendered_png = pixmap.tobytes("png")
            with Image.open(io.BytesIO(rendered_png)) as source_image:
                source_image.load()
                image = ImageOps.autocontrast(source_image.convert("L"))
                analysis_input = image.tobytes()
                data = pytesseract.image_to_data(
                    image, output_type=Output.DICT, config=STRUCTURED_TABLE_OCR_CONFIG,
                    timeout=VISUAL_TILE_OCR_TIMEOUT_SECONDS,
                )
                image_width, image_height = image.size
            pass_prefix = (
                f"structured-table-target-{target_kind}-{target_index}-{pass_name}"
            )
            pass_regions = ocr_data_regions(
                data,
                clip=clip,
                image_width=image_width,
                image_height=image_height,
                page_width=page_width,
                page_height=page_height,
                prefix=pass_prefix,
                source=f"structured_table_coordinate_ocr_{pass_name}",
                minimum_confidence=0.0,
            )
            regions.extend(pass_regions)
            pass_payload = [{
                key: region.get(key)
                for key in (
                    "id", "text", "x", "y", "width", "height", "confidence", "ocrKind",
                )
            } for region in pass_regions]
            analysis_passes.append({
                "pass": pass_name,
                "renderDpi": dpi,
                "renderPixelWidth": int(pixmap.width),
                "renderPixelHeight": int(pixmap.height),
                "renderSha256": hashlib.sha256(rendered_png).hexdigest(),
                "analysisInputSha256": hashlib.sha256(analysis_input).hexdigest(),
                "analysisSha256": hashlib.sha256(json.dumps(
                    pass_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                ).encode("utf-8")).hexdigest(),
                "analysisRegionIds": [str(region["id"]) for region in pass_regions],
                "analysisRegionCount": len(pass_regions),
            })
    except VisualTileAnalysisFailed:
        raise
    except RuntimeError as error:
        if "timeout" in str(error).lower():
            raise VisualTileAnalysisFailed(
                f"structured_table_ocr_timeout:{target_kind}:{target_index}"
            ) from error
        raise VisualTileAnalysisFailed(
            f"structured_table_analysis_failed:{target_kind}:{target_index}"
        ) from error
    except Exception as error:
        raise VisualTileAnalysisFailed(
            f"structured_table_analysis_failed:{target_kind}:{target_index}"
        ) from error
    analysis_payload = [{
        key: region.get(key)
        for key in ("id", "text", "x", "y", "width", "height", "confidence", "ocrKind")
    } for region in regions]
    proof = {
        "targetKind": target_kind,
        "bounds": bounds,
        "state": "completed",
        "pageNumber": page_number,
        "sourceSha256": source_sha256,
        "evidenceVersion": evidence_version,
        "renderMethod": VISUAL_RENDER_METHOD,
        "analysisMethod": STRUCTURED_TABLE_ANALYSIS_METHOD,
        "analysisPasses": analysis_passes,
        # Keep the primary raster fields available to existing evidence
        # readers while the complete dual-pass proof remains in analysisPasses.
        "renderDpi": analysis_passes[0]["renderDpi"],
        "renderPixelWidth": analysis_passes[0]["renderPixelWidth"],
        "renderPixelHeight": analysis_passes[0]["renderPixelHeight"],
        "renderSha256": analysis_passes[0]["renderSha256"],
        "analysisInputSha256": analysis_passes[0]["analysisInputSha256"],
        "analysisSha256": hashlib.sha256(json.dumps(
            analysis_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8")).hexdigest(),
        "analysisRegionIds": [str(region["id"]) for region in regions],
        "analysisRegionCount": len(regions),
        "analysisDurationMs": max(0, int((time.monotonic() - started_at) * 1000)),
    }
    return regions, proof


def native_text_regions(page: fitz.Page, page_width: float, page_height: float) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    font_eligibility: dict[str, bool] = {}
    payload = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    for block_index, block in enumerate(payload.get("blocks") or []):
        if block.get("type") != 0:
            continue
        for line_index, line in enumerate(block.get("lines") or []):
            spans = line.get("spans") or []
            # Unmapped Type3 glyph IDs can decode to perfectly printable but
            # meaningless ASCII. Character filtering alone cannot detect this.
            # Reject the whole mixed line, not just the suspect span: splicing
            # could remove a subject identifier or change a measurement.
            for span in spans:
                font = str(span.get("font") or "")
                if font not in font_eligibility:
                    font_eligibility[font] = native_font_has_unicode_authority(page, font)
            if any(not font_eligibility[str(span.get("font") or "")] for span in spans):
                continue
            text = "".join(str(span.get("text") or "") for span in spans).strip()
            if not text or not native_text_is_readable(text):
                continue
            box = line.get("bbox") or block.get("bbox")
            if box and page.rotation:
                rotated = fitz.Rect(*map(float, box[:4])) * page.rotation_matrix
                box = (rotated.x0, rotated.y0, rotated.x1, rotated.y1)
            region = region_from_box(
                f"native-{block_index}-{line_index}", text, box, page_width, page_height, "embedded_text", 0.99
            )
            if region:
                result.append(region)
    return result


def native_font_has_unicode_authority(page: fitz.Page, font: str) -> bool:
    """Require a Unicode mapping for custom Type3 glyph programs.

    PyMuPDF exposes these unnamed fonts as ``Type3 (xref generation R)``.
    Standard text fonts retain their normal extraction path. Missing or
    unreadable Type3 maps use page-bound optical extraction instead.
    """
    if not font.startswith("Type3"):
        return True
    match = re.fullmatch(r"Type3 \((\d+) \d+ R\)", font)
    if not match:
        return False
    try:
        kind, reference = page.parent.xref_get_key(int(match[1]), "ToUnicode")
        mapped = re.fullmatch(r"(\d+) \d+ R", reference) if kind == "xref" else None
        return bool(mapped and page.parent.xref_stream(int(mapped[1])))
    except (ValueError, RuntimeError):
        return False


def native_text_is_readable(text: str) -> bool:
    """An embedded font without a valid character map is not trusted text.

    Some drawing PDFs extract control codes instead of the visible glyphs.
    Presence in the PDF does not justify 0.99 confidence for that byte stream.
    Reject affected lines and let the existing page-bound OCR read the glyphs;
    never guess a substitution alphabet or silently strip corrupt characters.
    """
    return not any(
        (ord(character) < 32 and character not in "\t\r\n")
        or 0x7F <= ord(character) <= 0x9F
        or character == "\ufffd"
        for character in text
    )


def title_block_ocr_regions(
    page: fitz.Page, page_width: float, page_height: float,
) -> list[dict[str, Any]]:
    clip = fitz.Rect(
        float(page.rect.x0) + page_width * TITLE_BLOCK_X,
        float(page.rect.y0) + page_height * TITLE_BLOCK_Y,
        float(page.rect.x1),
        float(page.rect.y1),
    )
    return ocr_regions_for_clip(
        page,
        clip,
        page_width,
        page_height,
        dpi=TITLE_BLOCK_OCR_DPI,
        prefix="title-ocr",
        source="title_block_ocr",
        config="--psm 11",
    )


def sheet_identity_ocr_regions(
    page: fitz.Page, page_width: float, page_height: float,
) -> list[dict[str, Any]]:
    """Read the small sheet-number cell independently at higher resolution.

    A full title-block OCR pass can blur compact identities such as C5 into
    ``Co`` while still reading the nearby ``5 OF 8 SHTS`` footer. Keeping this
    crop separate prevents a sheet-count footer from becoming the page
    identity and also covers narrow vertical electrical title blocks.
    """
    validated_page_bound_identity = page_bound_sheet_identity_ocr_regions(
        page, page_width, page_height,
    )
    if validated_page_bound_identity:
        return validated_page_bound_identity

    result: list[dict[str, Any]] = []
    # Landscape civil sets commonly place the identity directly above the
    # "x OF y SHTS" footer. Stop above that footer so it cannot compete.
    # Narrow vertical title blocks commonly place the identity at the bottom.
    for crop_name, y0, y1, dpi, config, filter_size, minimum_confidence in (
        (
            "landscape-native",
            0.885,
            0.928,
            480,
            "--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-",
            None,
            0.35,
        ),
        (
            "landscape-outline",
            0.885,
            0.928,
            SHEET_IDENTITY_OCR_DPI,
            "--psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-",
            3,
            0.0,
        ),
        (
            "vertical-outline",
            0.938,
            0.999,
            SHEET_IDENTITY_OCR_DPI,
            "--psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-",
            3,
            0.0,
        ),
    ):
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * SHEET_IDENTITY_X,
            float(page.rect.y0) + page_height * y0,
            float(page.rect.x1),
            float(page.rect.y0) + page_height * y1,
        )
        result.extend(ocr_regions_for_clip(
            page,
            clip,
            page_width,
            page_height,
            dpi=dpi,
            prefix=f"sheet-identity-{crop_name}",
            source=f"sheet_identity_ocr_{crop_name.replace('-', '_')}",
            config=config,
            dark_stroke_filter_size=filter_size,
            minimum_confidence=minimum_confidence,
        ))
    return result


def page_bound_sheet_identity_ocr_regions(
    page: fitz.Page, page_width: float, page_height: float,
) -> list[dict[str, Any]]:
    """Return one exact title-cell identity or fail closed.

    The OCR pass covers one fixed page-bound title band, but a token is not
    trusted merely because it resembles a drawing number.  The candidate must
    occupy the sheet-value cell, follow an independently read ``SHEET NUMBER``
    label, precede the title-block ``SHEETS`` footer, and be the only distinct
    identity in that cell.  This prevents DATE values, job numbers, detail
    references, and truncated reads from becoming verified page identities.
    """

    clip = fitz.Rect(
        float(page.rect.x0) + page_width * PAGE_BOUND_SHEET_IDENTITY_X0,
        float(page.rect.y0) + page_height * PAGE_BOUND_SHEET_IDENTITY_Y0,
        float(page.rect.x0) + page_width * PAGE_BOUND_SHEET_IDENTITY_X1,
        float(page.rect.y0) + page_height * PAGE_BOUND_SHEET_IDENTITY_Y1,
    )
    raw_regions = ocr_regions_for_clip(
        page,
        clip,
        page_width,
        page_height,
        dpi=PAGE_BOUND_SHEET_IDENTITY_DPI,
        prefix="sheet-identity-page-bound",
        source="sheet_identity_ocr_page_bound_raw",
        config="--psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-",
        light_stroke_filter_size=9,
        minimum_confidence=0.0,
    )
    words = [
        region for region in raw_regions
        if str(region.get("ocrKind") or "") == "word"
    ]
    labels = [
        region for region in words
        if PAGE_BOUND_SHEET_LABEL_PATTERN.fullmatch(alpha_numeric_ocr_token(region))
    ]
    footers = [
        region for region in words
        if PAGE_BOUND_SHEET_FOOTER_PATTERN.fullmatch(alpha_numeric_ocr_token(region))
    ]
    if not labels or not footers:
        return []

    candidates: dict[str, list[dict[str, Any]]] = {}
    for region in words:
        token = canonical_sheet_identity_ocr_token(str(region.get("text") or ""))
        if not STRICT_SHEET_IDENTITY_PATTERN.fullmatch(token):
            continue
        if AMBIGUOUS_PAGE_BOUND_ARCHITECTURAL_IDENTITY_PATTERN.fullmatch(token):
            continue
        x = float(region.get("x") or 0.0)
        y = float(region.get("y") or 0.0)
        if not (
            PAGE_BOUND_SHEET_VALUE_X0 <= x <= PAGE_BOUND_SHEET_IDENTITY_X1
            and PAGE_BOUND_SHEET_VALUE_Y0 <= y <= PAGE_BOUND_SHEET_VALUE_Y1
        ):
            continue
        if not any(
            float(label.get("x") or 0.0) < x
            and -0.015 <= y - float(label.get("y") or 0.0) <= 0.035
            for label in labels
        ):
            continue
        if not any(
            float(footer.get("y") or 0.0) >= y
            and float(footer.get("y") or 0.0) - y <= 0.035
            for footer in footers
        ):
            continue
        candidates.setdefault(token, []).append(region)

    if len(candidates) != 1:
        return []
    sheet_number, evidence = next(iter(candidates.items()))
    region = max(evidence, key=lambda item: float(item.get("confidence") or 0.0))
    return [{
        **region,
        "id": f"sheet-identity-page-bound-validated-{page.number + 1}",
        "text": sheet_number,
        "label": sheet_number,
        "source": "sheet_identity_ocr_page_bound_validated",
        "confidence": max(0.95, float(region.get("confidence") or 0.0)),
        "ocrValidationStatus": "structural_title_cell",
        "sheetIdentityEvidence": {
            "labelRegionIds": [str(item.get("id") or "") for item in labels],
            "footerRegionIds": [str(item.get("id") or "") for item in footers],
        },
    }]


def alpha_numeric_ocr_token(region: dict[str, Any]) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(region.get("text") or "").upper())


def canonical_sheet_identity_ocr_token(value: str) -> str:
    return re.sub(r"\s+", "", value.upper().replace("–", "-").replace("—", "-"))


def coordinate_ocr_reason(
    page: fitz.Page | None,
    native_text: str,
    *,
    geometry: dict[str, Any] | None = None,
) -> str | None:
    compact_native_text = re.sub(r"\s+", "", native_text)
    if len(compact_native_text) < MIN_NATIVE_CHARACTERS:
        return "insufficient_native_text"
    invalid_character_count = sum(
        1
        for character in native_text
        if not character.isprintable() and not character.isspace()
    )
    if invalid_character_count / max(1, len(native_text)) > 0.02:
        return "unreadable_native_text_encoding"
    if page is None:
        return None
    page_area = max(1.0, float(page.rect.width) * float(page.rect.height))
    for image in page.get_images(full=True):
        try:
            rectangles = page.get_image_rects(int(image[0]))
        except (RuntimeError, ValueError):
            continue
        if any(max(0.0, float(rect.width) * float(rect.height)) / page_area >= 0.12 for rect in rectangles):
            return "significant_raster_region"
    page_geometry = geometry if geometry is not None else deterministic_geometry(page)
    if int(page_geometry.get("compactVectorPathCount") or 0) >= OUTLINED_TEXT_MIN_COMPACT_PATHS:
        return "outlined_vector_text"
    return None


def ocr_text_regions(page: fitz.Page, page_width: float, page_height: float) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    dpi = page_ocr_dpi(page)
    for tile_index, clip in enumerate(ocr_tile_rectangles(page)):
        result.extend(ocr_regions_for_clip(
            page,
            clip,
            page_width,
            page_height,
            dpi=dpi,
            prefix=f"ocr-{tile_index}",
            source="ocr",
            config="--psm 11",
        ))
    if dpi >= MAX_OCR_DPI:
        result.extend(ocr_regions_for_clip(
            page,
            page.rect,
            page_width,
            page_height,
            dpi=dpi,
            prefix="ocr-rotated-270",
            source="rotated_coordinate_ocr",
            config="--psm 11",
            image_rotation_degrees=270,
        ))
        result.extend(dimension_ocr_regions(page, page_width, page_height))
    else:
        result.extend(dense_text_ocr_regions(page, page_width, page_height, result))
    return result


def dimension_ocr_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
) -> list[dict[str, Any]]:
    """Read plan-edge dimensions from both orientations at bounded cost.

    Overall dimensions are frequently printed vertically at the drawing's
    left and right edges. A normal page pass can miss them, while a single
    rotated pass can reverse or blur the foot and inch marks. Narrow bands
    recover this evidence without rescanning the full page. Low-confidence
    results remain subject to ``trusted_ocr_regions`` before publication.
    """
    bands = (
        ("left", 0.05, 0.16, 0.14, 0.66),
        ("right", 0.80, 0.16, 0.15, 0.66),
        ("bottom", 0.08, 0.62, 0.84, 0.20),
    )
    result: list[dict[str, Any]] = []
    for band_name, x, y, width, height in bands:
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * x,
            float(page.rect.y0) + page_height * y,
            float(page.rect.x0) + page_width * (x + width),
            float(page.rect.y0) + page_height * (y + height),
        )
        rotations = (0,) if band_name == "bottom" else (0, 90, 270)
        for rotation in rotations:
            native_orientation = rotation == 0
            result.extend(ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                # Dimension ticks and the adjacent foot/inch marks are often
                # finer than the surrounding plan text. Raise resolution only
                # for these narrow bands; keep the 90/270 corroboration passes
                # at the existing bounded drawing OCR resolution.
                dpi=DIMENSION_OCR_DPI if native_orientation else DENSE_TEXT_OCR_DPI,
                prefix=f"dimension-{band_name}-{rotation}",
                source=f"dimension_coordinate_ocr_{band_name}_{rotation}",
                config="--psm 12" if native_orientation else "--psm 11",
                dark_stroke_filter_size=3 if native_orientation else None,
                minimum_confidence=0.0,
                image_rotation_degrees=rotation,
            ))
    return [
        region for region in result
        if dimension_candidate_text(str(region.get("text") or ""))
    ]


def targeted_measurement_corroboration_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    low_confidence_regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Re-read exact low-confidence dimensions with two OCR segmentations.

    A drawing can contain clear but very small foot-inch text that the fixed
    coverage pass reads with a low word confidence. Sending that same crop to
    two generative providers made page readiness stochastic. This bounded
    retry instead accepts a measurement only when PSM 6 and PSM 11 produce the
    same strict foot-inch value at overlapping source coordinates.
    """
    eligible = [
        region for region in low_confidence_regions
        if strict_foot_inch_measurement_keys(str(region.get("text") or ""))
    ]
    clusters = coalesce_low_confidence_regions(eligible)[
        :MAX_TARGETED_MEASUREMENT_CORROBORATION_REGIONS
    ]
    corroborated: list[dict[str, Any]] = []
    for target_index, cluster in enumerate(clusters):
        bounds = expanded_measurement_corroboration_bounds(cluster["bounds"])
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * bounds["x"],
            float(page.rect.y0) + page_height * bounds["y"],
            float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
            float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
        )
        passes: list[list[dict[str, Any]]] = []
        for pass_name, config in (("psm6", "--psm 6"), ("psm11", "--psm 11")):
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=TARGETED_MEASUREMENT_CORROBORATION_DPI,
                prefix=f"targeted-measurement-{target_index}-{pass_name}",
                source=f"targeted_measurement_coordinate_ocr_{pass_name}",
                config=config,
                minimum_confidence=0.0,
            )
            passes.append([
                region for region in regions
                if strict_foot_inch_measurement_keys(
                    str(region.get("text") or "")
                )
            ])
        if len(passes) != 2:
            continue
        primary, confirmation = passes
        for primary_region in primary:
            primary_keys = strict_foot_inch_measurement_keys(
                str(primary_region.get("text") or "")
            )
            matches = [
                region for region in confirmation
                if primary_keys.intersection(
                    strict_foot_inch_measurement_keys(
                        str(region.get("text") or "")
                    )
                )
                and region_contains_or_overlaps(primary_region, region)
            ]
            if not matches:
                continue
            confirmation_region = min(
                matches,
                key=lambda region: len(str(region.get("text") or "")),
            )
            corroborated.append({
                **primary_region,
                "id": f"targeted-measurement-corroborated-{target_index}-{len(corroborated)}",
                "source": "targeted_measurement_coordinate_ocr_dual_psm",
                "confidence": max(0.95, float(primary_region.get("confidence") or 0)),
                "ocrValidationStatus": "dual_psm_targeted_corroborated",
                "corroboratingEvidence": [
                    public_region(primary_region),
                    public_region(confirmation_region),
                ],
            })
    return dedupe_regions(corroborated)


def expanded_measurement_corroboration_bounds(
    bounds: dict[str, Any],
) -> dict[str, float]:
    source = normalized_region_bounds(bounds)
    width = min(0.20, max(0.08, source["width"] + 0.06))
    height = min(0.12, max(0.05, source["height"] + 0.04))
    center_x = source["x"] + source["width"] / 2
    center_y = source["y"] + source["height"] / 2
    x = min(1.0 - width, max(0.0, center_x - width / 2))
    y = min(1.0 - height, max(0.0, center_y - height / 2))
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "width": round(width, 6),
        "height": round(height, 6),
    }


def page_ocr_dpi(page: fitz.Page) -> int:
    longest_edge = max(1.0, float(page.rect.width), float(page.rect.height))
    fitted_dpi = round(OCR_TARGET_LONG_EDGE_PIXELS * 72.0 / longest_edge)
    return max(OCR_DPI, min(MAX_OCR_DPI, fitted_dpi))


def dense_text_ocr_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    coarse_regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Re-read bounded note and schedule blocks without rescanning the plan.

    The inexpensive full-page pass finds section headings reliably.  A single
    higher-resolution block below each heading recovers small dimensions and
    units that matter to field questions, while avoiding dozens of expensive
    full-resolution tiles.
    """
    clips: list[fitz.Rect] = []
    for region in coarse_regions:
        if "-line-" not in str(region.get("id") or ""):
            continue
        if not DENSE_TEXT_HEADING_PATTERN.search(str(region.get("text") or "")):
            continue
        x = float(region.get("x") or 0)
        y = float(region.get("y") or 0)
        width = float(region.get("width") or 0)
        clip = fitz.Rect(
            max(float(page.rect.x0), (x - 0.03) * page_width),
            max(float(page.rect.y0), (y - 0.03) * page_height),
            min(float(page.rect.x1), max(x + width + 0.08, x + 0.34) * page_width),
            min(float(page.rect.y1), (y + 0.48) * page_height),
        )
        if clip.width <= 0 or clip.height <= 0:
            continue
        if any(overlap_ratio(clip, existing) >= 0.65 for existing in clips):
            continue
        clips.append(clip)
        if len(clips) >= 6:
            break

    result: list[dict[str, Any]] = []
    for clip_index, clip in enumerate(clips):
        result.extend(ocr_regions_for_clip(
            page,
            clip,
            page_width,
            page_height,
            dpi=DENSE_TEXT_OCR_DPI,
            prefix=f"dense-text-{clip_index}",
            source="dense_text_coordinate_ocr",
            config="--psm 6",
            minimum_confidence=0.0,
        ))
    return result


def overlap_ratio(left: fitz.Rect, right: fitz.Rect) -> float:
    intersection = left & right
    if intersection.is_empty:
        return 0.0
    intersection_area = max(0.0, float(intersection.width) * float(intersection.height))
    smaller_area = min(
        max(1.0, float(left.width) * float(left.height)),
        max(1.0, float(right.width) * float(right.height)),
    )
    return intersection_area / smaller_area


def ocr_regions_for_clip(
    page: fitz.Page,
    clip: fitz.Rect,
    page_width: float,
    page_height: float,
    *,
    dpi: int,
    prefix: str,
    source: str,
    config: str,
    dark_stroke_filter_size: int | None = None,
    light_stroke_filter_size: int | None = None,
    minimum_confidence: float = 0.35,
    image_rotation_degrees: int = 0,
    timeout_seconds: float = 30,
) -> list[dict[str, Any]]:
    scale = dpi / 72.0
    pixmap = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False, colorspace=fitz.csRGB,
    )
    with Image.open(io.BytesIO(pixmap.tobytes("png"))) as source_image:
        image = source_image.convert("L")
        unrotated_image_width, unrotated_image_height = image.size
        if dark_stroke_filter_size:
            image = image.filter(ImageFilter.MinFilter(dark_stroke_filter_size))
        if light_stroke_filter_size:
            image = image.filter(ImageFilter.MaxFilter(light_stroke_filter_size))
        if image_rotation_degrees:
            image = image.rotate(image_rotation_degrees, expand=True)
        data = pytesseract.image_to_data(image, output_type=Output.DICT, config=config,
            timeout=timeout_seconds)
        image_width, image_height = image.size
    return ocr_data_regions(
        data,
        clip=clip,
        image_width=image_width,
        image_height=image_height,
        page_width=page_width,
        page_height=page_height,
        prefix=prefix,
        source=source,
        minimum_confidence=minimum_confidence,
        image_rotation_degrees=image_rotation_degrees,
        unrotated_image_width=unrotated_image_width,
        unrotated_image_height=unrotated_image_height,
    )


def ocr_data_regions(
    data: dict[str, Any],
    *,
    clip: fitz.Rect,
    image_width: int,
    image_height: int,
    page_width: float,
    page_height: float,
    prefix: str,
    source: str,
    minimum_confidence: float = 0.35,
    image_rotation_degrees: int = 0,
    unrotated_image_width: int | None = None,
    unrotated_image_height: int | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    grouped_lines: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for word_index, raw_text in enumerate(data.get("text") or []):
        text = str(raw_text or "").strip()
        try:
            confidence = float(data["conf"][word_index]) / 100.0
        except (KeyError, TypeError, ValueError, IndexError):
            confidence = 0.0
        if not text or confidence < minimum_confidence:
            continue
        pixel_box = unrotate_ocr_box(
            float(data["left"][word_index]),
            float(data["top"][word_index]),
            float(data["width"][word_index]),
            float(data["height"][word_index]),
            image_rotation_degrees=image_rotation_degrees,
            unrotated_image_width=unrotated_image_width or image_width,
            unrotated_image_height=unrotated_image_height or image_height,
        )
        pixel_x, pixel_y, pixel_width, pixel_height = pixel_box
        source_image_width = unrotated_image_width or image_width
        source_image_height = unrotated_image_height or image_height
        absolute_x = float(clip.x0) + (pixel_x / source_image_width) * float(clip.width)
        absolute_y = float(clip.y0) + (pixel_y / source_image_height) * float(clip.height)
        absolute_width = (pixel_width / source_image_width) * float(clip.width)
        absolute_height = (pixel_height / source_image_height) * float(clip.height)
        try:
            line_key: tuple[int, int, int] | None = (
                int(data["block_num"][word_index]),
                int(data["par_num"][word_index]),
                int(data["line_num"][word_index]),
            )
        except (KeyError, TypeError, ValueError, IndexError):
            line_key = None
        word = {
            "id": f"{prefix}-word-{word_index}",
            "text": text,
            "label": text[:240],
            "x": bounded(absolute_x / page_width), "y": bounded(absolute_y / page_height),
            "width": bounded(absolute_width / page_width), "height": bounded(absolute_height / page_height),
            "absoluteX": absolute_x,
            "absoluteY": absolute_y,
            "confidence": bounded(confidence),
            "source": source,
            "ocrOrder": word_index,
            "ocrKind": "word",
            "ocrPrefix": prefix,
            "ocrRotationDegrees": image_rotation_degrees,
        }
        if line_key is not None:
            word.update({
                "ocrBlockNumber": line_key[0],
                "ocrParagraphNumber": line_key[1],
                "ocrLineNumber": line_key[2],
            })
        result.append(word)
        if line_key is None:
            continue
        grouped_lines.setdefault(line_key, []).append({
            **word,
            "absoluteWidth": absolute_width,
            "absoluteHeight": absolute_height,
        })

    for line_index, words in enumerate(grouped_lines.values()):
        if len(words) < 2:
            continue
        ordered = sorted(words, key=lambda word: int(word["ocrOrder"]))
        x0 = min(float(word["absoluteX"]) for word in ordered)
        y0 = min(float(word["absoluteY"]) for word in ordered)
        x1 = max(float(word["absoluteX"]) + float(word["absoluteWidth"]) for word in ordered)
        y1 = max(float(word["absoluteY"]) + float(word["absoluteHeight"]) for word in ordered)
        line_text = " ".join(str(word["text"]) for word in ordered)
        result.append({
            "id": f"{prefix}-line-{line_index}",
            "text": line_text,
            "label": line_text[:240],
            "x": bounded(x0 / page_width), "y": bounded(y0 / page_height),
            "width": bounded((x1 - x0) / page_width), "height": bounded((y1 - y0) / page_height),
            "absoluteX": x0,
            "absoluteY": y0,
            "confidence": bounded(min(float(word["confidence"]) for word in ordered)),
            "source": source,
            "ocrKind": "line",
            "ocrPrefix": prefix,
            "ocrRotationDegrees": image_rotation_degrees,
            "ocrBlockNumber": int(ordered[0]["ocrBlockNumber"]),
            "ocrParagraphNumber": int(ordered[0]["ocrParagraphNumber"]),
            "ocrLineNumber": int(ordered[0]["ocrLineNumber"]),
        })
    return result


def trusted_ocr_regions(
    regions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separate searchable OCR from evidence that still needs verification.

    A low OCR confidence score is not proof. Compact sheet identities and
    explicit material/thickness notes have enough syntax to validate
    deterministically. Other low-confidence facts, including plan dimensions,
    require the same normalized evidence from independent OCR perspectives.
    """
    corroboration: dict[str, list[dict[str, Any]]] = {}
    for region in regions:
        key = ocr_corroboration_key(str(region.get("text") or ""))
        if not key:
            continue
        corroboration.setdefault(key, []).append(region)

    accepted: list[dict[str, Any]] = [
        region for region in regions
        if float(region.get("confidence") or 0) >= OCR_TRUST_CONFIDENCE
        and not trailing_dash_foot_fragment(str(region.get("text") or ""))
    ]
    rejected: list[dict[str, Any]] = []
    for region in regions:
        confidence = float(region.get("confidence") or 0)
        # A bare N'- / N'— token is only the clipped beginning of a
        # foot-inch phrase. It is neither searchable evidence nor a useful
        # visual candidate because the remaining value lies outside its
        # bounded crop. Keep processing the page without inventing N feet.
        if trailing_dash_foot_fragment(str(region.get("text") or "")):
            continue
        if confidence >= OCR_TRUST_CONFIDENCE:
            continue
        text = str(region.get("text") or "").strip()
        key = ocr_corroboration_key(text)
        if low_confidence_fact_is_already_supported(region, accepted):
            continue
        if syntax_validated_low_confidence_ocr(region):
            accepted.append({**region, "ocrValidationStatus": "syntax_validated"})
            continue
        corroborating_regions = corroboration.get(key) or []
        corroborating_sources = {
            str(candidate.get("source") or "unknown")
            for candidate in corroborating_regions
            if candidate is not region and region_contains_or_overlaps(region, candidate)
        }
        source = str(region.get("source") or "unknown")
        if key and any(candidate_source != source for candidate_source in corroborating_sources):
            accepted.append({
                **region,
                "ocrValidationStatus": "corroborated",
                "ocrCorroboratingSources": sorted({source, *corroborating_sources}),
            })
            continue
        if relevant_low_confidence_text(text):
            rejected.append({**region, "ocrValidationStatus": "unresolved_low_confidence"})
    accepted = dedupe_regions(accepted)
    rejected = [
        region for region in dedupe_regions(rejected)
        if not low_confidence_fact_is_already_supported(region, accepted)
    ]
    return accepted, rejected


def syntax_validated_low_confidence_ocr(region: dict[str, Any]) -> bool:
    text = re.sub(r"\s+", "", str(region.get("text") or "").strip())
    source = str(region.get("source") or "")
    if (
        source == "sheet_identity_ocr_page_bound_validated"
        and STRICT_SHEET_IDENTITY_PATTERN.fullmatch(text)
    ):
        return True
    readable_text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
    return bool(STRICT_CONSTRUCTION_MEASUREMENT_PATTERN.search(readable_text))


def dimension_candidate_text(text: str) -> bool:
    normalized = normalize_ocr_punctuation(text)
    # PDF creation timestamps such as ``23:40:59-08'00'`` otherwise look like
    # foot/inch notation and can create repeated, paid visual exceptions on
    # every cover sheet. They are metadata, not construction measurements.
    if timestamp_like_text(normalized):
        return False
    if trailing_dash_foot_fragment(normalized):
        return False
    # A bare apostrophe followed by OCR punctuation or more digits (for
    # example ``@20'*4.7`` or ``60 '01%`` in a photometric diagram) is not a
    # bounded construction measurement.  The former broad candidate regex
    # treated those chart fragments as feet and forced an unrelated visual
    # exception.  Exact supported measurement grammars still keep real
    # ``20 FT``, ``4'-0`` and ``2'x4'`` candidates fail-closed.
    return bool(
        exact_simple_measurement_keys(normalized)
        or corrupted_zero_inch_foot_measurements(normalized)
        or incomplete_simple_foot_inch_measurement(normalized)
    )


def timestamp_like_text(text: str) -> bool:
    return bool(re.search(r"\d{1,4}:\d{2}(?::\d{2})?", text))


def ocr_corroboration_key(text: str) -> str | None:
    normalized = normalize_ocr_punctuation(text)
    measurements = sorted(strict_foot_inch_measurement_keys(normalized))
    if not measurements and simple_measurement_token(normalized):
        measurements = sorted(exact_simple_measurement_keys(normalized))
    if measurements:
        return "measurement:" + "|".join(measurements)
    compact = re.sub(r"[^A-Z0-9]+", " ", normalized.upper()).strip()
    if len(compact) >= 8 and FACT_PATTERN.search(normalized):
        return "fact:" + compact
    return None


def relevant_low_confidence_text(text: str) -> bool:
    normalized = normalize_ocr_punctuation(text)
    if dimension_candidate_text(normalized):
        return True
    words = re.findall(r"[A-Z0-9]+", normalized.upper())
    return len(words) >= 2 and bool(VISUAL_EXCEPTION_FACT_PATTERN.search(normalized))


def low_confidence_fact_is_already_supported(
    candidate: dict[str, Any],
    accepted_regions: list[dict[str, Any]],
) -> bool:
    """Avoid paying to re-read a fact already bound to the same coordinates.

    Tesseract line confidence is the minimum confidence of its words. A single
    weak glyph can therefore reject a whole LIGHTING or CONCRETE line even
    though the important word was already accepted at the same location. Only
    exact fact subjects are compared, and measurements require their exact
    normalized value, so unique low-confidence dimensions remain unresolved
    and fail closed.
    """
    candidate_text = str(candidate.get("text") or "")
    if incomplete_measurement_is_supported_by_exact_region(
        candidate, accepted_regions,
    ):
        return True
    candidate_keys = low_confidence_fact_keys(candidate_text)
    if not candidate_keys:
        return False
    overlapping_keys: set[str] = set()
    for accepted in accepted_regions:
        if float(accepted.get("confidence") or 0) < OCR_TRUST_CONFIDENCE:
            continue
        if not region_contains_or_overlaps(candidate, accepted):
            continue
        overlapping_keys.update(low_confidence_fact_keys(str(accepted.get("text") or "")))
    if candidate_keys.issubset(overlapping_keys):
        return True

    # Dense schedule OCR commonly substitutes a degree sign, em dash, or Q
    # for the punctuation in an otherwise exact zero-inch dimension (for
    # example ``12'\u00b0-0\"`` or ``8'-Q\"``). Do not trust that corrupted text
    # by itself. It can only reuse the measurement when a trusted OCR region
    # at the same coordinates already contains the exact N'-0\" value.
    canonical_candidate_keys = set(candidate_keys)
    for feet in corrupted_zero_inch_foot_measurements(candidate_text):
        canonical_candidate_keys.discard(f"measurement:single-foot:{feet}ft")
        canonical_candidate_keys.add(
            f"measurement:foot-inch:{feet}ft:0in:0/1"
        )
    return (
        canonical_candidate_keys != candidate_keys
        and canonical_candidate_keys.issubset(overlapping_keys)
    )


def incomplete_measurement_is_supported_by_exact_region(
    candidate: dict[str, Any],
    accepted_regions: list[dict[str, Any]],
) -> bool:
    text = normalize_ocr_punctuation(str(candidate.get("text") or ""))
    if (
        not incomplete_simple_foot_inch_measurement(text)
        or trailing_dash_foot_fragment(text)
    ):
        return False
    candidate_digits = re.sub(r"\D", "", text)
    if not candidate_digits:
        return False
    for accepted in accepted_regions:
        if not region_contains_or_overlaps(candidate, accepted):
            continue
        accepted_text = normalize_ocr_punctuation(
            str(accepted.get("text") or "")
        )
        for match in STRICT_FOOT_INCH_PATTERN.finditer(accepted_text):
            exact_digits = "".join(
                str(match.group(index) or "") for index in range(1, 5)
            )
            if exact_digits.startswith(candidate_digits):
                return True
    return False


def low_confidence_fact_keys(text: str) -> set[str]:
    normalized = normalize_ocr_punctuation(text)
    keys = {
        f"measurement:{measurement}"
        for measurement in exact_simple_measurement_keys(normalized)
    }
    upper = normalized.upper()
    for pattern, key in (
        (r"\bHAZ(?:ARDOUS)?\.?\s+(?:MAT(?:ERIAL)?\.?|WASTE)\b", "hazardous"),
        (r"\bCANOPY\s+[A-Z]\b", "canopy"),
        (r"\bLIGHT(?:ING|S)?\b", "lighting"),
        (r"\bSLAB\b", "slab"),
        (r"\bPCC\b", "pcc"),
        (r"\bCONCRETE\b", "concrete"),
    ):
        if re.search(pattern, upper):
            keys.add(key)
    return keys


def exact_simple_measurement_keys(text: str) -> set[str]:
    """Return exact, normalized construction measurements in OCR text.

    These keys never make low-confidence OCR trustworthy by syntax alone. They
    only let an unresolved OCR region recognize the same numeric value in an
    overlapping trusted region (or in a separately corroborated OCR source).
    Spans are tracked so ``2'x4'`` cannot also be mistaken for two unrelated
    single-foot measurements, and ``52'-0\"`` cannot be reduced to ``52'``.
    """
    normalized = normalize_ocr_punctuation(text)
    keys: set[str] = set()
    compound_spans: list[tuple[int, int]] = []
    for match in STRICT_FOOT_INCH_PATTERN.finditer(normalized):
        keys.add(
            f"foot-inch:{int(match.group(1))}ft:{int(match.group(2))}in:"
            f"{int(match.group(3) or 0)}/{int(match.group(4) or 1)}"
        )
        compound_spans.append(match.span())
    for match in RECTANGULAR_FOOT_MEASUREMENT_PATTERN.finditer(normalized):
        keys.add(f"rectangle:{int(match.group(1))}ftx{int(match.group(2))}ft")
        compound_spans.append(match.span())
    for match in SINGLE_FOOT_MEASUREMENT_PATTERN.finditer(normalized):
        if any(
            match.start() < compound_end and match.end() > compound_start
            for compound_start, compound_end in compound_spans
        ):
            continue
        sign = match.group(1) or ""
        keys.add(f"single-foot:{sign}{int(match.group(2))}ft")
    return keys


def corrupted_zero_inch_foot_measurements(text: str) -> set[int]:
    """Return N values from punctuation-corrupted N'-0\" candidates.

    These values are aliases only; they never become accepted evidence on
    their own. ``low_confidence_fact_is_already_supported`` still requires an
    overlapping trusted exact foot-inch region. Incomplete tokens such as
    ``4'-0`` and unique single-foot tokens such as ``1'`` intentionally do not
    match this syntax and remain unresolved.
    """
    normalized = normalize_ocr_punctuation(text)
    return {
        int(match.group(1))
        for match in CORRUPTED_ZERO_INCH_FOOT_PATTERN.finditer(normalized)
    }


def incomplete_simple_foot_inch_measurement(text: str) -> bool:
    """Return whether OCR captured a bounded but incomplete foot-inch token.

    A token such as ``16'—`` or ``4'-0`` cannot be accepted as the exact
    single-foot value before the dash. It remains a visual exception and is
    explicitly routed to the dual-provider transcription-correction contract.
    Complete foot-inch measurements remain handled by the strict parser.
    """
    normalized = normalize_ocr_punctuation(text)
    return bool(
        INCOMPLETE_SIMPLE_FOOT_INCH_PATTERN.fullmatch(normalized)
        and not STRICT_FOOT_INCH_PATTERN.fullmatch(normalized)
    )


def trailing_dash_foot_fragment(text: str) -> bool:
    """Return whether OCR captured only the start of a foot-inch phrase."""
    return bool(
        TRAILING_DASH_FOOT_FRAGMENT_PATTERN.fullmatch(
            normalize_ocr_punctuation(text)
        )
    )


def strict_foot_inch_measurement_keys(text: str) -> set[str]:
    normalized = normalize_ocr_punctuation(text)
    return {
        f"foot-inch:{int(match.group(1))}ft:{int(match.group(2))}in:"
        f"{int(match.group(3) or 0)}/{int(match.group(4) or 1)}"
        for match in STRICT_FOOT_INCH_PATTERN.finditer(normalized)
    }


def simple_measurement_token(text: str) -> bool:
    normalized = normalize_ocr_punctuation(text).strip()
    return bool(
        RECTANGULAR_FOOT_MEASUREMENT_PATTERN.fullmatch(normalized)
        or SINGLE_FOOT_MEASUREMENT_PATTERN.fullmatch(normalized)
    )


def region_contains_or_overlaps(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_x = float(left.get("x") or 0)
    left_y = float(left.get("y") or 0)
    left_w = float(left.get("width") or 0)
    left_h = float(left.get("height") or 0)
    right_x = float(right.get("x") or 0)
    right_y = float(right.get("y") or 0)
    right_w = float(right.get("width") or 0)
    right_h = float(right.get("height") or 0)
    if min(left_w, left_h, right_w, right_h) <= 0:
        return False
    right_center_x = right_x + right_w / 2
    right_center_y = right_y + right_h / 2
    if (
        left_x <= right_center_x <= left_x + left_w
        and left_y <= right_center_y <= left_y + left_h
    ):
        return True
    intersection_w = max(0.0, min(left_x + left_w, right_x + right_w) - max(left_x, right_x))
    intersection_h = max(0.0, min(left_y + left_h, right_y + right_h) - max(left_y, right_y))
    intersection_area = intersection_w * intersection_h
    return intersection_area / max(1e-9, min(left_w * left_h, right_w * right_h)) >= 0.5


def normalize_ocr_punctuation(text: str) -> str:
    return (
        text.replace("`", "'")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )


def unrotate_ocr_box(
    left: float,
    top: float,
    width: float,
    height: float,
    *,
    image_rotation_degrees: int,
    unrotated_image_width: int,
    unrotated_image_height: int,
) -> tuple[float, float, float, float]:
    if image_rotation_degrees == 270:
        x0 = top
        x1 = top + height
        y0 = unrotated_image_height - (left + width)
        y1 = unrotated_image_height - left
        return x0, y0, x1 - x0, y1 - y0
    if image_rotation_degrees == 90:
        x0 = unrotated_image_width - (top + height)
        x1 = unrotated_image_width - top
        y0 = left
        y1 = left + width
        return x0, y0, x1 - x0, y1 - y0
    return left, top, width, height


def ocr_tile_rectangles(page: fitz.Page) -> list[fitz.Rect]:
    scale = page_ocr_dpi(page) / 72.0
    tile_points = OCR_TILE_PIXELS / scale
    overlap_points = OCR_TILE_OVERLAP_PIXELS / scale
    step = max(1.0, tile_points - overlap_points)
    rectangles: list[fitz.Rect] = []
    y = float(page.rect.y0)
    while y < float(page.rect.y1):
        x = float(page.rect.x0)
        while x < float(page.rect.x1):
            rectangles.append(fitz.Rect(
                x,
                y,
                min(float(page.rect.x1), x + tile_points),
                min(float(page.rect.y1), y + tile_points),
            ))
            if len(rectangles) > MAX_OCR_TILES:
                raise DocumentResourceRejected("pdf_page_requires_too_many_ocr_tiles")
            x += step
        y += step
    return rectangles


def ocr_tile_count(page: fitz.Page) -> int:
    return len(ocr_tile_rectangles(page))


def deterministic_geometry(page: fitz.Page) -> dict[str, Any]:
    drawing_shapes = page.get_drawings()
    if len(drawing_shapes) > MAX_VECTOR_PATHS:
        raise DocumentResourceRejected("pdf_page_vector_complexity_outside_limit")
    rectangles: Counter[tuple[int, int]] = Counter()
    line_segments = 0
    compact_vector_paths = 0
    for shape in drawing_shapes:
        rectangle = shape.get("rect")
        if rectangle:
            rectangles[(round(float(rectangle.width)), round(float(rectangle.height)))] += 1
            if (
                0.2 <= max(float(rectangle.width), float(rectangle.height))
                <= OUTLINED_TEXT_COMPACT_PATH_LIMIT_POINTS
            ):
                compact_vector_paths += 1
        line_segments += sum(1 for item in shape.get("items") or [] if item and item[0] == "l")
    repeated = [
        {"widthPoints": width, "heightPoints": height, "count": count}
        for (width, height), count in rectangles.most_common(12)
        if count >= 2 and width > 2 and height > 2
    ]
    return {
        "vectorPathCount": len(drawing_shapes),
        "compactVectorPathCount": compact_vector_paths,
        "lineSegmentCount": line_segments,
        "repeatedRectangles": repeated,
        "analysisMethod": "deterministic_pdf_vectors",
    }


def deterministic_label_block_regions(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    facts, _unresolved = analyze_deterministic_label_blocks(regions)
    return facts


def analyze_deterministic_label_blocks(
    regions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Reconstruct an explicit multi-line hazardous-storage drawing label.

    This is deliberately not semantic inference. The only supported relation
    is the literal ``WEATHER PROTECTED ... HAZ. MATL. STORAGE AREA C`` label,
    assembled from already trusted OCR constituents in one compact coordinate
    block. A nearby detail title, layout title, or hazardous-material summary
    cannot satisfy the grammar and cannot be concatenated into a relationship.
    """
    candidates = label_block_ocr_candidates(regions)
    if len(candidates) < 2:
        return [], []

    proposals: list[dict[str, Any]] = []
    unresolved_proposals: list[dict[str, Any]] = []
    proposal_constituents: set[tuple[str, ...]] = set()
    for anchor in candidates:
        anchor_text = canonical_label_text(str(anchor.get("text") or ""))
        if not re.search(r"\b(?:WEATHER|HAZ(?:ARDOUS)?)\b", anchor_text):
            continue
        source = str(anchor.get("source") or "")
        rotation = int(anchor.get("ocrRotationDegrees") or 0) % 360
        # Reading-order reconstruction is currently validated for normal
        # horizontal drawing labels only. Rotated candidates remain searchable
        # as independent regions rather than being joined with guessed order.
        if rotation != 0:
            continue
        nearby_all = [
            candidate for candidate in candidates
            if str(candidate.get("source") or "") == source
            and int(candidate.get("ocrRotationDegrees") or 0) % 360 == rotation
            and label_candidate_near_anchor(anchor, candidate)
        ]
        nearby_all.sort(key=lambda candidate: label_candidate_distance(anchor, candidate))
        # A legitimate drawing label occupies only a handful of lines. Keeping
        # the nearest twelve bounds the deterministic search on dense sheets.
        nearby = nearby_all[:12]
        if len(nearby) < 2:
            continue
        for constituent_count in range(2, min(5, len(nearby)) + 1):
            for group_tuple in combinations(nearby, constituent_count):
                if anchor not in group_tuple:
                    continue
                group = sorted(
                    group_tuple,
                    key=lambda region: (
                        round(float(region.get("y") or 0), 6),
                        round(float(region.get("x") or 0), 6),
                    ),
                )
                constituent_ids = tuple(sorted(str(region.get("id") or "") for region in group))
                if constituent_ids in proposal_constituents:
                    continue
                if not label_regions_form_tight_block(group):
                    continue
                text = " ".join(
                    re.sub(r"\s+", " ", str(region.get("text") or "").strip())
                    for region in group
                ).strip()
                canonical = canonical_label_text(text)
                if LABEL_BLOCK_DISALLOWED_CONTEXT_PATTERN.search(canonical):
                    continue
                if not DIRECT_HAZARDOUS_STORAGE_AREA_LABEL_PATTERN.search(canonical):
                    continue
                proposal_constituents.add(constituent_ids)
                area_identifiers = explicit_area_identifiers(nearby_all)
                conflicting_identifiers = sorted(area_identifiers - {"C"})
                if conflicting_identifiers:
                    unresolved_proposals.append(label_block_unresolved(
                        group,
                        code="conflicting_area_identifier",
                        reason=(
                            "The compact hazardous-material storage label block contains "
                            "a conflicting explicit area identifier "
                            f"({', '.join(conflicting_identifiers)} versus C). No location "
                            "relationship was created."
                        ),
                        related_regions=[
                            candidate for candidate in nearby_all
                            if explicit_area_identifiers([candidate])
                        ],
                    ))
                    continue
                corroborating_evidence = terminal_area_c_corroboration(group, regions)
                if not corroborating_evidence:
                    unresolved_proposals.append(label_block_unresolved(
                        group,
                        code="uncorroborated_area_identifier",
                        reason=(
                            "The compact hazardous-material storage label ends with Area C, "
                            "but that identifier is supported by only one OCR channel. No "
                            "location relationship was created without independent or "
                            "deterministic corroboration."
                        ),
                    ))
                    continue
                proposals.append(label_block_fact(
                    group,
                    text,
                    corroborating_evidence=corroborating_evidence,
                ))

    # When OCR supplies both a shorter valid suffix and the complete label,
    # retain the fact with the greatest constituent coverage and suppress its
    # overlapping subsets. This preserves provenance without duplicate facts.
    proposals.sort(
        key=lambda proposal: (
            len(proposal.get("constituentEvidence") or []),
            len(str(proposal.get("text") or "")),
        ),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    used_constituent_ids: set[str] = set()
    for proposal in proposals:
        proposal_ids = {
            str(evidence.get("id") or "")
            for evidence in proposal.get("constituentEvidence") or []
        }
        if proposal_ids & used_constituent_ids:
            continue
        selected.append(proposal)
        used_constituent_ids.update(proposal_ids)
    return selected, dedupe_label_block_unresolved(unresolved_proposals)


def label_block_ocr_candidates(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return OCR lines plus only words that have no emitted line region."""
    trusted = [
        region for region in regions
        if str(region.get("ocrKind") or "") in {"line", "word"}
        and float(region.get("confidence") or 0) >= OCR_TRUST_CONFIDENCE
        and label_component_text(str(region.get("text") or ""))
    ]
    emitted_line_keys = {
        ocr_region_line_key(region)
        for region in trusted
        if region.get("ocrKind") == "line" and ocr_region_line_key(region) is not None
    }
    return [
        region for region in trusted
        if region.get("ocrKind") == "line"
        or ocr_region_line_key(region) not in emitted_line_keys
    ]


def label_component_text(text: str) -> bool:
    canonical = canonical_label_text(text)
    return bool(re.search(
        r"\b(?:PROPOSED|NEW|WEATHER|PROTECTED|EXT|HAZ(?:ARDOUS)?|"
        r"MAT(?:L|ERIAL)|STORAGE|AREA|[A-Z])\b",
        canonical,
    ))


def canonical_label_text(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", normalize_ocr_punctuation(text).upper()).strip()


def explicit_area_identifiers(regions: list[dict[str, Any]]) -> set[str]:
    identifiers: set[str] = set()
    for region in regions:
        canonical = canonical_label_text(str(region.get("text") or ""))
        identifiers.update(
            match.group(1).upper()
            for match in EXPLICIT_AREA_IDENTIFIER_PATTERN.finditer(canonical)
        )

    ordered = sorted(
        regions,
        key=lambda region: (
            round(float(region.get("y") or 0), 6),
            round(float(region.get("x") or 0), 6),
        ),
    )
    for left, right in combinations(ordered, 2):
        left_text = canonical_label_text(str(left.get("text") or ""))
        right_text = canonical_label_text(str(right.get("text") or ""))
        if not left_text.endswith("AREA") or not re.fullmatch(r"[A-Z]", right_text):
            continue
        if label_regions_form_tight_block(sorted(
            [left, right],
            key=lambda region: (
                round(float(region.get("y") or 0), 6),
                round(float(region.get("x") or 0), 6),
            ),
        )):
            identifiers.add(right_text)
    return identifiers


def terminal_area_c_corroboration(
    label_regions: list[dict[str, Any]],
    all_regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return the independent evidence that makes terminal Area C usable.

    One OCR channel, even above the generic trust threshold, cannot establish
    the location relation. Acceptance requires a deterministic PDF text source,
    an independently overlapping OCR source, or the existing OCR trust gate's
    explicit multi-source corroboration metadata.
    """
    terminal_regions = [
        region for region in label_regions if region_supports_area_c(region)
    ]
    if not terminal_regions:
        return []
    channels = {
        str(region.get("source") or "")
        for region in terminal_regions
        if str(region.get("source") or "")
    }
    corroborating_evidence: list[dict[str, Any]] = []
    for region in terminal_regions:
        for source in region.get("ocrCorroboratingSources") or []:
            if str(source).strip():
                channels.add(str(source).strip())
        if len({
            str(source).strip()
            for source in region.get("ocrCorroboratingSources") or []
            if str(source).strip()
        }) >= 2:
            corroborating_evidence.append(label_constituent_evidence(region))

    label_ids = {str(region.get("id") or "") for region in label_regions}
    deterministic_support = False
    for region in all_regions:
        if str(region.get("id") or "") in label_ids:
            continue
        if not region_supports_area_c(region) or not region_near_label_block(
            region, label_regions
        ):
            continue
        source = str(region.get("source") or "").strip()
        if source in {"embedded_text", "native_pdf_text"}:
            deterministic_support = True
            corroborating_evidence.append(label_constituent_evidence(region))
            continue
        if source and source not in channels:
            channels.add(source)
            corroborating_evidence.append(label_constituent_evidence(region))
        for corroborating_source in region.get("ocrCorroboratingSources") or []:
            if str(corroborating_source).strip():
                channels.add(str(corroborating_source).strip())

    if not deterministic_support and len(channels) < 2:
        return []
    return dedupe_constituent_evidence(corroborating_evidence)


def region_supports_area_c(region: dict[str, Any]) -> bool:
    canonical = canonical_label_text(str(region.get("text") or ""))
    return bool(
        EXPLICIT_AREA_IDENTIFIER_PATTERN.search(canonical)
        and "C" in {
            match.group(1).upper()
            for match in EXPLICIT_AREA_IDENTIFIER_PATTERN.finditer(canonical)
        }
    ) or bool(re.fullmatch(r"C", canonical)) or bool(
        DIRECT_HAZARDOUS_STORAGE_AREA_LABEL_PATTERN.search(canonical)
    )


def region_near_label_block(
    region: dict[str, Any], label_regions: list[dict[str, Any]],
) -> bool:
    union = normalized_region_bounds(label_regions[0])
    for label_region in label_regions[1:]:
        union = union_region_bounds(union, normalized_region_bounds(label_region))
    combined = union_region_bounds(union, normalized_region_bounds(region))
    if combined["width"] > LABEL_BLOCK_MAX_WIDTH or combined["height"] > LABEL_BLOCK_MAX_HEIGHT:
        return False
    return any(label_candidate_near_anchor(label_region, region) for label_region in label_regions)


def dedupe_constituent_evidence(
    evidence: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int, int]] = set()
    for item in evidence:
        bounds = item.get("bounds") if isinstance(item.get("bounds"), dict) else {}
        key = (
            str(item.get("source") or ""),
            canonical_label_text(str(item.get("text") or "")),
            round(float(bounds.get("x") or 0) * 10000),
            round(float(bounds.get("y") or 0) * 10000),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def label_block_unresolved(
    regions: list[dict[str, Any]],
    *,
    code: str,
    reason: str,
    related_regions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    bounds = normalized_region_bounds(regions[0])
    for region in regions[1:]:
        bounds = union_region_bounds(bounds, normalized_region_bounds(region))
    diagnostic_regions = [*regions, *(related_regions or [])]
    diagnostics = dedupe_constituent_evidence([
        label_constituent_evidence(region) for region in diagnostic_regions
    ])
    fingerprint = hashlib.sha256(
        "|".join(sorted(str(region.get("id") or "") for region in regions)).encode("utf-8")
    ).hexdigest()[:12]
    return {
        "regionKey": f"label-block-{code}-{fingerprint}",
        "bounds": bounds,
        "reason": reason,
        "diagnosticCandidateCount": len(diagnostics),
        "diagnosticCandidates": diagnostics,
    }


def dedupe_label_block_unresolved(
    unresolved: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for item in unresolved:
        bounds = item.get("bounds") if isinstance(item.get("bounds"), dict) else {}
        key = (
            str(item.get("reason") or ""),
            round(float(bounds.get("x") or 0) * 10000),
            round(float(bounds.get("y") or 0) * 10000),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def ocr_region_line_key(region: dict[str, Any]) -> tuple[str, int, int, int] | None:
    try:
        return (
            str(region["ocrPrefix"]),
            int(region["ocrBlockNumber"]),
            int(region["ocrParagraphNumber"]),
            int(region["ocrLineNumber"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def label_candidate_near_anchor(
    anchor: dict[str, Any], candidate: dict[str, Any],
) -> bool:
    anchor_bounds = normalized_region_bounds(anchor)
    candidate_bounds = normalized_region_bounds(candidate)
    anchor_center_x = anchor_bounds["x"] + anchor_bounds["width"] / 2
    anchor_center_y = anchor_bounds["y"] + anchor_bounds["height"] / 2
    candidate_center_x = candidate_bounds["x"] + candidate_bounds["width"] / 2
    candidate_center_y = candidate_bounds["y"] + candidate_bounds["height"] / 2
    return (
        abs(anchor_center_x - candidate_center_x) <= LABEL_BLOCK_MAX_WIDTH
        and abs(anchor_center_y - candidate_center_y) <= LABEL_BLOCK_MAX_HEIGHT
    )


def label_candidate_distance(
    anchor: dict[str, Any], candidate: dict[str, Any],
) -> float:
    return (
        abs(float(anchor.get("x") or 0) - float(candidate.get("x") or 0))
        + 4 * abs(float(anchor.get("y") or 0) - float(candidate.get("y") or 0))
    )


def label_regions_form_tight_block(regions: list[dict[str, Any]]) -> bool:
    if len(regions) < 2:
        return False
    sources = {str(region.get("source") or "") for region in regions}
    rotations = {int(region.get("ocrRotationDegrees") or 0) % 360 for region in regions}
    if len(sources) != 1 or len(rotations) != 1 or rotations != {0}:
        return False
    union = normalized_region_bounds(regions[0])
    for region in regions[1:]:
        union = union_region_bounds(union, normalized_region_bounds(region))
    if union["width"] > LABEL_BLOCK_MAX_WIDTH or union["height"] > LABEL_BLOCK_MAX_HEIGHT:
        return False

    same_block = label_regions_share_ocr_block(regions)
    max_line_gap = (
        LABEL_BLOCK_MAX_SAME_OCR_BLOCK_LINE_GAP
        if same_block
        else LABEL_BLOCK_MAX_LINE_GAP
    )
    for previous, current in zip(regions, regions[1:]):
        previous_bounds = normalized_region_bounds(previous)
        current_bounds = normalized_region_bounds(current)
        previous_x1 = previous_bounds["x"] + previous_bounds["width"]
        previous_y1 = previous_bounds["y"] + previous_bounds["height"]
        current_x1 = current_bounds["x"] + current_bounds["width"]
        current_y1 = current_bounds["y"] + current_bounds["height"]
        vertical_gap = max(0.0, current_bounds["y"] - previous_y1)
        horizontal_gap = max(
            0.0,
            max(previous_bounds["x"], current_bounds["x"])
            - min(previous_x1, current_x1),
        )
        vertical_overlap = min(previous_y1, current_y1) > max(
            previous_bounds["y"], current_bounds["y"]
        )
        if vertical_overlap:
            if horizontal_gap > 0.012:
                return False
            continue
        if vertical_gap > max_line_gap:
            return False
        horizontal_overlap = horizontal_gap == 0
        left_alignment = abs(previous_bounds["x"] - current_bounds["x"]) <= 0.025
        previous_center = previous_bounds["x"] + previous_bounds["width"] / 2
        current_center = current_bounds["x"] + current_bounds["width"] / 2
        center_alignment = abs(previous_center - current_center) <= 0.04
        if not (horizontal_overlap or left_alignment or center_alignment):
            return False
    return True


def label_regions_share_ocr_block(regions: list[dict[str, Any]]) -> bool:
    block_keys: set[tuple[str, int, int]] = set()
    try:
        for region in regions:
            block_keys.add((
                str(region["ocrPrefix"]),
                int(region["ocrBlockNumber"]),
                int(region["ocrParagraphNumber"]),
            ))
    except (KeyError, TypeError, ValueError):
        return False
    return len(block_keys) == 1


def label_block_fact(
    regions: list[dict[str, Any]],
    text: str,
    *,
    corroborating_evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    bounds = normalized_region_bounds(regions[0])
    for region in regions[1:]:
        bounds = union_region_bounds(bounds, normalized_region_bounds(region))
    constituent_evidence = [label_constituent_evidence(region) for region in regions]
    constituent_key = "|".join(str(region.get("id") or "") for region in regions)
    fact_id = hashlib.sha256(constituent_key.encode("utf-8")).hexdigest()[:16]
    same_block = label_regions_share_ocr_block(regions)
    return {
        "id": f"label-block-{fact_id}",
        "text": text,
        "label": text[:240],
        **bounds,
        "confidence": bounded(min(float(region.get("confidence") or 0) for region in regions)),
        "source": "deterministic_label_block",
        "factKind": "drawing_fact",
        "subject": "hazardous material storage",
        "location": "Storage Area C",
        "areaNames": ["Storage Area C"],
        "evidenceText": text,
        "reconstructionMethod": (
            "trusted_same_ocr_block" if same_block else "trusted_tight_geometry"
        ),
        "evidenceSources": sorted({str(region.get("source") or "") for region in regions}),
        "constituentEvidence": constituent_evidence,
        "corroboratingEvidence": corroborating_evidence,
    }


def label_constituent_evidence(region: dict[str, Any]) -> dict[str, Any]:
    evidence = {
        "id": str(region.get("id") or ""),
        "text": str(region.get("text") or ""),
        "source": str(region.get("source") or ""),
        "confidence": bounded(float(region.get("confidence") or 0)),
        "bounds": normalized_region_bounds(region),
    }
    for key in (
        "ocrKind", "ocrPrefix", "ocrRotationDegrees", "ocrBlockNumber",
        "ocrParagraphNumber", "ocrLineNumber", "ocrOrder",
    ):
        if region.get(key) is not None:
            evidence[key] = region[key]
    return evidence


def deterministic_fact_regions(
    regions: list[dict[str, Any]],
    *,
    excluded_region_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    excluded = excluded_region_ids or set()
    for region in regions:
        if region.get("factKind") == "drawing_fact":
            facts.append(region)
            continue
        # Coordinate tokens claimed by a detected structured table may only
        # become facts through a complete, non-conflicted relationship. This
        # prevents a flattened value from bypassing the table completeness
        # gate simply because it also resembles a generic drawing fact.
        if str(region.get("id") or "") in excluded:
            continue
        text = str(region.get("text") or "")
        if timestamp_like_text(normalize_ocr_punctuation(text)):
            continue
        if not FACT_PATTERN.search(text) and not STRICT_FOOT_INCH_PATTERN.search(
            normalize_ocr_punctuation(text)
        ):
            continue
        facts.append({
            **region,
            "id": f"fact-{region['id']}",
            "factKind": "drawing_fact",
            "subject": fact_subject(text),
            "location": "drawing text region",
            "evidenceText": text,
        })
    return facts


def unresolved_regions(
    regions: list[dict[str, Any]],
    mapping: dict[str, Any],
    *,
    native_character_count: int,
    ocr_attempted: bool,
    low_confidence_regions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    unresolved: list[dict[str, Any]] = []
    if not regions:
        unresolved.append({
            "regionKey": "page-overview",
            "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            "reason": "No coordinate-bound text could be extracted from this page.",
        })
    if native_character_count < MIN_NATIVE_CHARACTERS and ocr_attempted and len(regions) < 3:
        unresolved.append({
            "regionKey": "low-text-page",
            "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            "reason": "Native extraction and OCR produced insufficient searchable evidence.",
        })
    if mapping.get("sheetMappingStatus") == "conflicted":
        unresolved.append({
            "regionKey": "title-block",
            "bounds": {"x": 0.62, "y": 0.65, "width": 0.38, "height": 0.35},
            "reason": "Deterministic sheet identity candidates conflict.",
        })
    low_confidence_clusters = coalesce_low_confidence_regions(
        low_confidence_regions or []
    )
    for index, cluster in enumerate(low_confidence_clusters[:12], start=1):
        candidate_count = len(cluster["diagnosticCandidates"])
        unresolved.append({
            "regionKey": f"low-confidence-ocr-{index}",
            "bounds": cluster["bounds"],
            "reason": (
                f"{candidate_count} potentially relevant OCR candidate"
                f"{'s were' if candidate_count != 1 else ' was'} below the trust "
                "threshold in the same bounded drawing block and were not "
                "independently corroborated or syntax-validated."
            ),
            # These diagnostics do not become searchable facts. They retain
            # each original candidate and coordinate so a grouped visual check
            # is auditable without paying once per duplicate OCR line.
            "diagnosticCandidateCount": candidate_count,
            "diagnosticCandidates": cluster["diagnosticCandidates"],
        })
    return unresolved


def coalesce_low_confidence_regions(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Group duplicate OCR variants inside one small schedule/detail block.

    The union is only a visual-review crop. Every candidate text and original
    coordinate remains in diagnostics, and no candidate becomes accepted
    evidence because it was grouped. Spatially separate measurements remain
    separate, fail-closed visual exceptions.
    """
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for region in regions:
        if word_is_covered_by_exact_ocr_line(region, regions):
            # Original word/line observations remain in rejected OCR data.
            # Require a visual read of the COMPLETE containing line, including
            # every qualifier, rather than two dispositions for the same ink.
            continue
        text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
        key = (
            text.lower(),
            round(float(region.get("x") or 0) * 100),
            round(float(region.get("y") or 0) * 100),
        )
        if not text or key in seen:
            continue
        seen.add(key)
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            continue
        candidates.append({
            "bounds": bounds,
            "diagnosticCandidates": [{
                "text": text[:500],
                "source": str(region.get("source") or "unknown")[:120],
                "confidence": round(bounded(float(region.get("confidence") or 0)), 5),
                "bounds": bounds,
            }],
        })

    clusters: list[dict[str, Any]] = []
    for candidate in candidates:
        merged = False
        for cluster in clusters:
            if low_confidence_regions_share_tiny_block(
                cluster["bounds"], candidate["bounds"]
            ):
                cluster["bounds"] = union_region_bounds(
                    cluster["bounds"], candidate["bounds"]
                )
                cluster["diagnosticCandidates"].extend(
                    candidate["diagnosticCandidates"]
                )
                merged = True
                break
        if not merged:
            clusters.append(candidate)

    # A large line can bridge two groups that were created earlier. Merge
    # transitively while the resulting union remains a small bounded block.
    changed = True
    while changed:
        changed = False
        for left_index in range(len(clusters)):
            for right_index in range(left_index + 1, len(clusters)):
                if not low_confidence_regions_share_tiny_block(
                    clusters[left_index]["bounds"], clusters[right_index]["bounds"]
                ):
                    continue
                clusters[left_index]["bounds"] = union_region_bounds(
                    clusters[left_index]["bounds"], clusters[right_index]["bounds"]
                )
                clusters[left_index]["diagnosticCandidates"].extend(
                    clusters[right_index]["diagnosticCandidates"]
                )
                del clusters[right_index]
                changed = True
                break
            if changed:
                break
    # The provider's correction contract is intentionally one-candidate-only:
    # it must transcribe one clipped token from one bounded tile. A grouped
    # block with multiple OCR candidates instead uses the ordinary dual-model
    # accept/dismiss contract, which can compare a complete candidate against
    # incomplete variants without treating either as trusted evidence.
    for cluster in clusters:
        diagnostics = cluster["diagnosticCandidates"]
        if (
            len(diagnostics) == 1
            and incomplete_simple_foot_inch_measurement(diagnostics[0]["text"])
        ):
            diagnostics[0]["source"] = VISUAL_MEASUREMENT_CORRECTION_SOURCE
    return clusters


def word_is_covered_by_exact_ocr_line(
    word: dict[str, Any], regions: list[dict[str, Any]],
) -> bool:
    if (word.get("ocrKind") != "word" or not word.get("ocrPrefix")
        or not word.get("source") or any(
            not isinstance(word.get(key), int) or isinstance(word.get(key), bool)
            or word[key] < 1
            for key in ("ocrLineNumber", "ocrBlockNumber", "ocrParagraphNumber")
        )):
        return False
    token = re.sub(r"\s+", " ", str(word.get("text") or "").strip())
    if not token:
        return False
    w = normalized_region_bounds(word)
    for line in regions:
        if line.get("ocrKind") != "line" or any(word.get(k) != line.get(k) for k in
            ("source", "ocrPrefix", "ocrLineNumber", "ocrBlockNumber", "ocrParagraphNumber")):
            continue
        phrase = re.sub(r"\s+", " ", str(line.get("text") or "").strip())
        if len(phrase) < len(token) or not re.search(r"(?:^|\s)" + re.escape(token) + r"(?=\s|$)", phrase):
            continue
        b = normalized_region_bounds(line)
        if (w["x"] >= b["x"] - .000002 and w["y"] >= b["y"] - .000002
            and w["x"] + w["width"] <= b["x"] + b["width"] + .000002
            and w["y"] + w["height"] <= b["y"] + b["height"] + .000002):
            return True
    return False


def normalized_region_bounds(region: dict[str, Any]) -> dict[str, float]:
    return {
        "x": bounded(float(region.get("x") or 0)),
        "y": bounded(float(region.get("y") or 0)),
        "width": bounded(float(region.get("width") or 0)),
        "height": bounded(float(region.get("height") or 0)),
    }


def union_region_bounds(
    left: dict[str, float], right: dict[str, float],
) -> dict[str, float]:
    x0 = min(left["x"], right["x"])
    y0 = min(left["y"], right["y"])
    x1 = max(left["x"] + left["width"], right["x"] + right["width"])
    y1 = max(left["y"] + left["height"], right["y"] + right["height"])
    return {
        "x": round(bounded(x0), 6),
        "y": round(bounded(y0), 6),
        "width": round(bounded(x1 - x0), 6),
        "height": round(bounded(y1 - y0), 6),
    }


def low_confidence_regions_share_tiny_block(
    left: dict[str, float], right: dict[str, float],
) -> bool:
    union = union_region_bounds(left, right)
    if (
        union["width"] > 0.4
        or union["height"] > 0.08
        or union["width"] * union["height"] > 0.025
    ):
        return False
    left_x1 = left["x"] + left["width"]
    left_y1 = left["y"] + left["height"]
    right_x1 = right["x"] + right["width"]
    right_y1 = right["y"] + right["height"]
    horizontal_gap = max(0.0, max(left["x"], right["x"]) - min(left_x1, right_x1))
    vertical_gap = max(0.0, max(left["y"], right["y"]) - min(left_y1, right_y1))
    horizontal_overlap = horizontal_gap == 0
    vertical_overlap = vertical_gap == 0
    return (
        (horizontal_overlap and vertical_gap <= 0.02)
        or (vertical_overlap and horizontal_gap <= 0.02)
    )


def region_from_box(
    region_id: str,
    text: str,
    box: Any,
    page_width: float,
    page_height: float,
    source: str,
    confidence: float,
) -> dict[str, Any] | None:
    if not isinstance(box, (list, tuple)) or len(box) < 4:
        return None
    x0, y0, x1, y1 = map(float, box[:4])
    # PDF text boxes can extend beyond the visible page when text is rotated or
    # clipped by a crop box.  Preserve only the visible intersection so every
    # proof coordinate remains bound to the source page.
    x0 = min(page_width, max(0.0, x0))
    y0 = min(page_height, max(0.0, y0))
    x1 = min(page_width, max(0.0, x1))
    y1 = min(page_height, max(0.0, y1))
    if x1 <= x0 or y1 <= y0:
        return None
    return {
        "id": region_id,
        "text": text,
        "label": text[:240],
        "x": bounded(x0 / page_width), "y": bounded(y0 / page_height),
        "width": bounded((x1 - x0) / page_width),
        "height": bounded((y1 - y0) / page_height),
        "absoluteX": x0, "absoluteY": y0,
        "confidence": confidence,
        "source": source,
    }


def dedupe_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[tuple[str, int, int], int] = {}
    result: list[dict[str, Any]] = []
    for region in regions:
        key = (
            re.sub(r"\s+", " ", str(region.get("text") or "").strip().lower()),
            round(float(region.get("x") or 0) * 100),
            round(float(region.get("y") or 0) * 100),
        )
        if not key[0]:
            continue
        existing_index = seen.get(key)
        if existing_index is not None:
            existing = result[existing_index]
            # ``deterministic_fact_regions`` intentionally enriches an
            # already coordinate-bound region. Preserve that richer fact
            # instead of allowing the earlier plain OCR copy to win.
            if region.get("factKind") and not existing.get("factKind"):
                result[existing_index] = {**existing, **region}
            elif existing.get("factKind") and not region.get("factKind"):
                result[existing_index] = {**region, **existing}
            elif float(region.get("confidence") or 0) > float(existing.get("confidence") or 0):
                result[existing_index] = {**existing, **region}
            continue
        seen[key] = len(result)
        result.append(region)
    return result


def public_region(region: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "id", "label", "text", "factKind", "subject", "location",
        "evidenceText", "areaNames", "x", "y", "width", "height",
        "confidence", "source", "reconstructionMethod", "evidenceSources",
        "constituentEvidence", "corroboratingEvidence",
        "structuredRelationshipId", "structuredTableBlockId",
        "structuredTableRelationshipType", "structuredTableRowKey",
        "searchable",
    }
    result = {key: value for key, value in region.items() if key in keys and value is not None}
    # Persistence is deliberately stricter than the in-memory convention.
    # Every worker-emitted region carries one explicit boolean so a missing or
    # malformed marker can never be interpreted as searchable by SQL. Raw
    # table constituents are set to False before this boundary; ordinary and
    # independently verified fact regions become explicitly True here.
    result["searchable"] = (
        True if "searchable" not in region else region.get("searchable") is True
    )
    return result


def first_meaningful_line(text: str) -> str | None:
    for line in text.splitlines():
        cleaned = line.strip()
        if len(cleaned) >= 4:
            return cleaned[:500]
    return None


def fact_subject(text: str) -> str:
    normalized = text.upper()
    for keyword, subject in (
        ("HAZ", "hazardous material storage"),
        ("CANOPY", "canopy"),
        ("LIGHT", "lighting"),
        ("CONCRETE", "concrete"),
        ("PCC", "concrete"),
        ("SLAB", "slab"),
    ):
        if keyword in normalized:
            return subject
    if STRICT_FOOT_INCH_PATTERN.search(normalize_ocr_punctuation(text)):
        return "dimension"
    return "drawing fact"


def bounded(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 6)


class DocumentResourceRejected(RuntimeError):
    pass


class VisualTileAnalysisFailed(RuntimeError):
    """A fixed high-resolution tile could not produce durable OCR evidence."""

    pass
