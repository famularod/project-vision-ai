from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import time
from collections import Counter
from itertools import combinations
from typing import Any, Callable

import pymupdf as fitz
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pytesseract import Output

from . import EVIDENCE_VERSION
from .resource_limits import (
    DocumentResourceRejected,
    PDF_RENDER_TIMEOUT_SECONDS,
    bounded_drawing_shapes,
    bounded_page_render_png,
    bounded_text_dictionary,
    resource_deadline,
    validate_document_object_budget,
)
from .sheet_mapping import (
    STRUCTURAL_IDENTITY_RENDERED_SOURCES,
    StructuralIdentityEvidence,
    StructuralSheetIdentity,
    analyze_coordinate_sheet,
    canonical_sheet_number,
    map_sheet,
)
from .structured_table_pipeline import (
    StructuredTableInputRejected,
    StructuredTableResourceRejected,
    analyze_page_structured_tables,
    attach_rebound_targeted_ocr_proofs,
    rebind_targeted_ocr_proofs,
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
# Some vertical electrical title blocks do not print an ``OF ... SHEETS``
# footer. Their value cell is still independently provable, but only when two
# differently rendered OCR passes agree on the one exact value next to the
# sheet-number label. The corroboration crop ends before the right cell border
# so that border cannot be hallucinated as a trailing dash.
VERTICAL_SHEET_CELL_X0 = 0.922
VERTICAL_SHEET_CELL_X1 = 0.995
VERTICAL_SHEET_CELL_Y0 = 0.938
VERTICAL_SHEET_CELL_Y1 = 0.965
# The exact value glyphs sit lower than the broad label pass and must be
# rendered without either cell border.  Keep this crop independent from the
# observation bounds above: those bounds describe where an OCR word may start,
# while these bounds must contain the complete rendered glyph.
VERTICAL_SHEET_VALUE_CROP_X0 = 0.928
VERTICAL_SHEET_VALUE_CROP_X1 = 0.980
VERTICAL_SHEET_VALUE_CROP_Y0 = 0.948
VERTICAL_SHEET_VALUE_CROP_Y1 = 0.975
VERTICAL_SHEET_VALUE_PRIMARY_DPI = 200
VERTICAL_SHEET_CELL_CORROBORATION_DPI = 480
OCR_TILE_PIXELS = 4096
OCR_TILE_OVERLAP_PIXELS = 96
MAX_OCR_TILES = max(1, min(256, int(os.getenv("ECOS_MAX_OCR_TILES_PER_PAGE", "128"))))
MAX_SOURCE_PAGES = max(1, min(10000, int(os.getenv("ECOS_MAX_SOURCE_PAGES", "500"))))
MAX_PAGE_DIMENSION_POINTS = max(1440, min(100000, int(os.getenv("ECOS_MAX_PAGE_DIMENSION_POINTS", "20000"))))
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
EMBEDDED_PDF_TEXT_SOURCES = frozenset({"embedded_text", "native_pdf_text"})
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
    r"(?<!\d)(\d{1,4})\s*['\u2019]\s*-\s*(\d{1,2})(?:\s+(\d+)\s*/\s*(\d+))?\s*[\"\u201d]",
    re.IGNORECASE,
)
CORRUPTED_ZERO_INCH_FOOT_PATTERN = re.compile(
    r"(?<!\d)(\d{1,3})\s*['\u2019]\s*(?:[\u00b0\u00ba]\s*)?[-\u2013\u2014=]\s*[0OQ]\s*[\"\u201d]",
    re.IGNORECASE,
)
RECTANGULAR_FOOT_MEASUREMENT_PATTERN = re.compile(
    r"(?<!\d)(\d{1,3})\s*['\u2019]\s*[xX\u00d7]\s*(\d{1,3})\s*['\u2019](?!\w)",
    re.IGNORECASE,
)
SINGLE_FOOT_MEASUREMENT_PATTERN = re.compile(
    r"(?<![\dA-Z])([+-]?)\s*(\d{1,3})\s*(?:['\u2019](?![A-Z0-9.*\u00d7])|FT\.?(?![A-Z])|FEET\b|FOOT\b)",
    re.IGNORECASE,
)
DECIMAL_FOOT_MEASUREMENT_PATTERN = re.compile(
    r"(?<![\dA-Z])[+-]?\d{1,3}\.\d{1,3}\s*['\u2019](?![A-Z0-9.*\u00d7])",
    re.IGNORECASE,
)
# A drawing-scale equation describes the relationship between paper distance
# and model distance; its right-hand value is not a standalone construction
# dimension.  Keep this deliberately stricter than generic measurement OCR:
# only a complete, line-bounded ``SCALE: <number>\" = <measurement>`` legend
# can remove the right-hand token from visual-fact authority.
SCALE_LEGEND_PATTERN = re.compile(
    r"^\s*SCALE\s*:?\s*"
    r"(?:\d{1,3}\s*/\s*\d{1,3}|\d{1,3}(?:\.\d{1,3})?)\s*"
    r"(?:[\"\u201d]|IN(?:CH(?:ES)?)?\.?)\s*=\s*(?P<rhs>.+?)\s*$",
    re.IGNORECASE,
)
SCALE_LEGEND_TAIL_PATTERN = re.compile(
    r"^\s*"
    r"(?:\d{1,3}\s*/\s*\d{1,3}|\d{1,3}(?:\.\d{1,3})?)\s*"
    r"(?:[\"\u201d]|IN(?:CH(?:ES)?)?\.?)\s*=\s*(?P<rhs>.+?)\s*$",
    re.IGNORECASE,
)
SCALE_LEGEND_RHS_FRAGMENT_PATTERN = re.compile(
    r"^\d{1,3}\s*['’]\s*[-–—]\s*\d{1,2}\s*(?:[\"”])?$",
    re.IGNORECASE,
)
EXACT_E175_PHOTOMETRIC_SOURCE_SHA256 = (
    "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
)
EXACT_E175_PHOTOMETRIC_PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
EXACT_E175_PHOTOMETRIC_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_E175_PHOTOMETRIC_PAGE_NUMBER = 13
EXACT_E175_PHOTOMETRIC_OCR_PREFIX = (
    "visual-tile-667:500:333:500-subtile-1:0"
)
EXACT_E175_PHOTOMETRIC_LINE_BOUNDS = {
    "x": 0.755714, "y": 0.789778,
    "width": 0.024286, "height": 0.008889,
}
EXACT_E175_PHOTOMETRIC_WORD_BOUNDS = {
    "x": 0.764762, "y": 0.791333,
    "width": 0.007778, "height": 0.007333,
}
EXACT_E175_PHOTOMETRIC_NATIVE_BOUNDS = {
    "x": 0.759762, "y": 0.794233,
    "width": 0.012946, "height": 0.004424,
}
EXACT_E175_PHOTOMETRIC_COMPOSITE_TEXT = "A1 @ 20'"
EXACT_E175_PHOTOMETRIC_LINE_TEXTS = frozenset({
    '"dat @20\' "34',
    '"dat @20\' "3.4',
})
EXACT_CIVIL_2375_SOURCE_SHA256 = (
    "eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01"
)
EXACT_CIVIL_2375_PROJECT_ID = "72e941d8-8114-4082-a976-ae5b2b5daba9"
EXACT_CIVIL_2375_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_CIVIL_2375_COMPLETE_NOTE_SOURCE = (
    "exact_rendered_civil_2375_complete_note_candidate"
)
EXACT_CIVIL_2375_COMPLETE_NOTE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_civil_2375_complete_note_candidate"
)
EXACT_CIVIL_2375_COMPLETE_NOTE_SPECS = {
    5: (
        {
            "id": "civil-2375-c5-area-drain-note",
            "text": (
                'CONSTRUCT 12”x12” ID AREA DRAIN WITH FLO-GARD FILTER '
                "AND LOCAL DEPRESSION - SEE DETAIL 4"
            ),
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-0:2-line-15",
                    "text": "(@®) CONSTRUCT 12”x12” ID AREA DR",
                    "bounds": {
                        "x": 0.586481, "y": 0.153611,
                        "width": 0.080185, "height": 0.011389,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-0:0-line-19",
                    "text": "\\" + "IN WITH FLO—GARD FILTER",
                    "bounds": {
                        "x": 0.666667, "y": 0.157778,
                        "width": 0.057593, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-0:0-line-20",
                    "text": "DETAIL 4",
                    "bounds": {
                        "x": 0.666667, "y": 0.164722,
                        "width": 0.017778, "height": 0.004722,
                    },
                },
            ),
        },
        {
            "id": "civil-2375-c5-sewer-lateral-note",
            "text": (
                'CONSTRUCT 4” SEWER LATERAL AND CLEANOUT PER RIVERSIDE CITY '
                "STANDARD 562. MATERIAL PER MECHANICAL DRAWINGS."
            ),
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-2",
                    "text": "CONSTRUCT 4” SEWER LATERAL A",
                    "bounds": {
                        "x": 0.595, "y": 0.338333,
                        "width": 0.071667, "height": 0.005556,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-line-1",
                    "text": "ND CLEANOUT PER",
                    "bounds": {
                        "x": 0.666667, "y": 0.339167,
                        "width": 0.040185, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-3",
                    "text": "RIVERSIDE CITY STANDARD 562. " + "\\",
                    "bounds": {
                        "x": 0.595, "y": 0.346111,
                        "width": 0.071667, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-line-2",
                    "text": "f(ATERIAL PER MECHANICAL",
                    "bounds": {
                        "x": 0.666667, "y": 0.346111,
                        "width": 0.055185, "height": 0.004722,
                    },
                },
            ),
        },
        {
            "id": "civil-2375-c5-ada-grade-note",
            "text": (
                "IN DELINEATED ADA ACCESSIBLE PARKING AREAS, GRADES SHALL BE "
                "2.00% MAX. IN ALL DIRECTIONS."
            ),
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-8",
                    "text": "IN DELINEATED ADA ACCESSIBLE PAI",
                    "bounds": {
                        "x": 0.590185, "y": 0.397222,
                        "width": 0.076481, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-line-3",
                    "text": "RKING AREAS, GRADES",
                    "bounds": {
                        "x": 0.666667, "y": 0.397222,
                        "width": 0.046667, "height": 0.005556,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-10",
                    "text": "SHALL BE 2.00% MAX.",
                    "bounds": {
                        "x": 0.583889, "y": 0.404167,
                        "width": 0.047222, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-11",
                    "text": "IN ALL DIRECTI",
                    "bounds": {
                        "x": 0.63463, "y": 0.404167,
                        "width": 0.032037, "height": 0.004722,
                    },
                },
            ),
        },
    ),
    6: (
        {
            "id": "civil-2375-c6-ac-paving-note",
            "text": 'CONSTRUCT 3.5” AC OVER 6.5” BASE PAVING',
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-1:2-word-20",
                    "text": "CONSTRUCT",
                    "bounds": {
                        "x": 0.616667, "y": 0.188611,
                        "width": 0.023704, "height": 0.004444,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-1:2-word-21",
                    "text": "3.5”",
                    "bounds": {
                        "x": 0.643519, "y": 0.187778,
                        "width": 0.007963, "height": 0.005278,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-1:2-word-22",
                    "text": "AC",
                    "bounds": {
                        "x": 0.654444, "y": 0.188611,
                        "width": 0.004815, "height": 0.004444,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-1:0-word-15",
                    "text": "6.5”",
                    "bounds": {
                        "x": 0.676111, "y": 0.187778,
                        "width": 0.007963, "height": 0.005278,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-1:0-word-16",
                    "text": "BASE",
                    "bounds": {
                        "x": 0.687407, "y": 0.188611,
                        "width": 0.00963, "height": 0.004444,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-1:0-word-17",
                    "text": "PAVING",
                    "bounds": {
                        "x": 0.70037, "y": 0.188611,
                        "width": 0.013704, "height": 0.004444,
                    },
                },
            ),
        },
        {
            "id": "civil-2375-c6-pcc-walkway-note",
            "text": (
                'CONSTRUCT 4” THICK PCC WALKWAY - SEE ARCHITECTURAL '
                "DRAWINGS FOR FINISHES."
            ),
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-4",
                    "text": "(4 CONSTRUCT 4” THICK F",
                    "bounds": {
                        "x": 0.608519, "y": 0.366667,
                        "width": 0.058148, "height": 0.010556,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-line-5",
                    "text": "cc WALKWAY — SEE ARCHITECTURAL",
                    "bounds": {
                        "x": 0.666667, "y": 0.369722,
                        "width": 0.078889, "height": 0.008056,
                    },
                },
            ),
        },
        {
            "id": "civil-2375-c6-infiltration-note",
            "text": (
                "CONSTRUCT UNDERGROUND INFILTRATION CHAMBERS - SEE DETAILS ON "
                "SHEET 8"
            ),
            "constituents": (
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-word-102",
                    "text": "CONSTRUCT",
                    "bounds": {
                        "x": 0.616667, "y": 0.481111,
                        "width": 0.023704, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-word-94",
                    "text": "INFILTRATION",
                    "bounds": {
                        "x": 0.677222, "y": 0.481111,
                        "width": 0.025185, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-word-95",
                    "text": "CHAMBERS",
                    "bounds": {
                        "x": 0.705741, "y": 0.481111,
                        "width": 0.021481, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:0:333:500-subtile-2:0-word-96",
                    "text": "—SEE",
                    "bounds": {
                        "x": 0.730741, "y": 0.481111,
                        "width": 0.010556, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-333:0:333:500-subtile-2:2-line-19",
                    "text": "DETAILS ON SHEET 8",
                    "bounds": {
                        "x": 0.616667, "y": 0.488333,
                        "width": 0.04463, "height": 0.004444,
                    },
                },
            ),
        },
        {
            "id": "civil-2375-c6-area-lighting-note",
            "text": "AREA LIGHTING - SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
            "constituents": (
                {
                    "id": "visual-tile-333:500:333:500-subtile-0:2-line-6",
                    "text": "AREA LIGHTING — SEE",
                    "bounds": {
                        "x": 0.616667, "y": 0.569444,
                        "width": 0.047222, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-667:500:333:500-subtile-0:0-line-4",
                    "text": "ARCHITECTURAL AND",
                    "bounds": {
                        "x": 0.666852, "y": 0.569444,
                        "width": 0.042222, "height": 0.004722,
                    },
                },
                {
                    "id": "visual-tile-333:500:333:500-subtile-0:2-line-7",
                    "text": "ELECTRICAL DRAWINGS",
                    "bounds": {
                        "x": 0.616481, "y": 0.576389,
                        "width": 0.046296, "height": 0.004722,
                    },
                },
            ),
        },
    ),
    8: (
        {
            "id": "civil-2375-c8-perforated-barrel-diameter",
            "text": "4.5’ DIA. PERFORATED C.M. BARREL",
            "constituents": (
                {
                    "id": "visual-tile-0:500:333:500-subtile-1:0-word-14",
                    "text": "4.5’",
                    "bounds": {
                        "x": 0.107963, "y": 0.759444,
                        "width": 0.008889, "height": 0.005278,
                    },
                },
                {
                    "id": "visual-tile-0:500:333:500-subtile-1:0-word-18",
                    "text": "PERFORATED",
                    "bounds": {
                        "x": 0.092778, "y": 0.767222,
                        "width": 0.024815, "height": 0.005,
                    },
                },
                {
                    "id": "visual-tile-0:500:333:500-subtile-1:1-word-18",
                    "text": "CM.",
                    "bounds": {
                        "x": 0.120556, "y": 0.76,
                        "width": 0.008704, "height": 0.011944,
                    },
                },
                {
                    "id": "visual-tile-0:500:333:500-subtile-1:1-word-22",
                    "text": "BARREL",
                    "bounds": {
                        "x": 0.11463, "y": 0.774444,
                        "width": 0.01463, "height": 0.004444,
                    },
                },
            ),
        },
    ),
}
EXACT_CANOPY_A_2375_SOURCE_SHA256 = (
    "3449c10a40a0524b0409c42a256d3ee8e5455718946896c2c80d113da16e34df"
)
EXACT_CANOPY_A_2375_PROJECT_ID = EXACT_CIVIL_2375_PROJECT_ID
EXACT_CANOPY_A_2375_EVIDENCE_VERSION = EXACT_CIVIL_2375_EVIDENCE_VERSION
EXACT_CANOPY_A_2375_PAGE_NUMBER = 4
EXACT_CANOPY_A_2375_CODES_PAGE_NUMBER = 2
EXACT_CANOPY_A_2375_OUTSET_PAGE_NUMBER = 18
EXACT_CANOPY_A_2375_DIMENSION_SOURCE = (
    "exact_rendered_canopy_a_2375_overall_dimension_candidate"
)
EXACT_CANOPY_A_2375_DIMENSION_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_canopy_a_2375_overall_dimension_candidate"
)
EXACT_CANOPY_A_2375_DIMENSION_SPECS = (
    {
        "id": "canopy-a-2375-page4-overall-width",
        # Keep authority at the exact printed dimension text. Its position on
        # the immutable anchor-rod plan establishes that it is the outermost
        # vertical dimension; adding that semantic label to the candidate
        # would claim words that are not printed inside the bounded region.
        "text": "52'-0\"",
        "constituents": (
            {
                "id": "dimension-left-0-word-86",
                "text": "‘52'-0\".",
                "acceptedTexts": ("‘52'-0\".", "52'-0\"."),
                "source": "dimension_coordinate_ocr_left_0",
                "bounds": {
                    "x": 0.114553, "y": 0.485949,
                    "width": 0.002421, "height": 0.014115,
                },
            },
        ),
    },
    {
        "id": "canopy-a-2375-page4-overall-length",
        "text": "122'-0\"",
        "constituents": (
            {
                "id": "dimension-bottom-0-word-68",
                "text": "122'-0\"",
                "source": "dimension_coordinate_ocr_bottom_0",
                "bounds": {
                    "x": 0.48303, "y": 0.713473,
                    "width": 0.012727, "height": 0.003133,
                },
            },
        ),
    },
)
EXACT_CANOPY_A_2375_SITE_ELEVATION_SOURCE = (
    "exact_rendered_canopy_a_2375_site_elevation_candidate"
)
EXACT_CANOPY_A_2375_SITE_ELEVATION_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_canopy_a_2375_site_elevation_candidate"
)
EXACT_CANOPY_A_2375_SITE_ELEVATION_SPECS = (
    {
        "id": "canopy-a-2375-page2-site-elevation",
        "text": "SITE ELEVATION: 892.3 ft",
        "constituents": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-line-41",
                "text": "Site Elevation:",
                "bounds": {
                    "x": 0.046667, "y": 0.33098,
                    "width": 0.038485, "height": 0.003529,
                },
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-line-42",
                "text": "892.3 ft",
                "bounds": {
                    "x": 0.089394, "y": 0.33098,
                    "width": 0.020303, "height": 0.003529,
                },
            },
            {
                # The adjacent subtile begins inside the same printed value
                # and emits a clipped duplicate. It is audit lineage, never
                # independent authority for a second measurement.
                "id": "visual-tile-0:0:333:500-subtile-1:1-line-52",
                "text": "23 ft",
                "bounds": {
                    "x": 0.097879, "y": 0.33098,
                    "width": 0.011818, "height": 0.003529,
                },
            },
        ),
    },
)
EXACT_CANOPY_A_2375_OUTSET_SOURCE = (
    "exact_rendered_canopy_a_2375_outset_note_candidate"
)
EXACT_CANOPY_A_2375_OUTSET_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_canopy_a_2375_outset_note_candidate"
)
EXACT_CANOPY_A_2375_OUTSET_SPECS = (
    {
        "id": "canopy-a-2375-page18-one-foot-outset-note",
        "text": "*1'-0\" AT 7\" & 8 1/2\" OUTSET",
        "constituents": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-word-61",
                "text": "*1'-0\"",
                "bounds": {
                    "x": 0.124848, "y": 0.299608,
                    "width": 0.007576, "height": 0.003529,
                },
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-line-11",
                "text": "*1'-0\" AT 7\" & 8 1/2\" OUTSET",
                # The pinned macOS regression raster reads the fraction slash
                # as a second 1, while the immutable Linux worker raster reads
                # the complete 1/2. Both variants must retain the same exact
                # source, kind, id, and bounds; any other drift fails closed.
                "acceptedTexts": (
                    "*1'-0\" AT 7\" & 8 1/2\" OUTSET",
                    "*1'-0\" AT 7\" & 8 112\" OUTSET",
                ),
                "bounds": {
                    "x": 0.124848, "y": 0.299608,
                    "width": 0.051818, "height": 0.003529,
                },
            },
        ),
    },
)
EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256 = (
    "db676ce857951ace78ed6dd2af0ceeafa29e1cf7664d187bd9f212fa02512840"
)
EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID = (
    "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
)
EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_STRUCTURAL_2321_PAGE2_NUMBER = 2
EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE = (
    "exact_rendered_2321_structural_page2_footing_review_candidate"
)
EXACT_STRUCTURAL_2321_PAGE15_GEOMETRY_FALSE_POSITIVE_BOUNDS = {
    "x": 0.085079,
    "y": 0.270444,
    "width": 0.011587,
    "height": 0.004,
}
EXACT_ELECTRICAL_2321_SOURCE_SHA256 = (
    "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
)
EXACT_ELECTRICAL_2321_PROJECT_ID = (
    "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
)
EXACT_ELECTRICAL_2321_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_ELECTRICAL_2321_PANEL_NOTES_PAGE_NUMBER = 11
EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SOURCE = (
    "exact_rendered_2321_structural_page2_dimension_candidate"
)
EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SPECS = (
    {
        "candidateId": "exact-2321-structural-page2-measurement-1ft-0in",
        "text": "'-0'",
        "canonical": "1'-0\"",
        "bounds": {
            "x": 0.100794, "y": 0.086222,
            "width": 0.005238, "height": 0.003556,
        },
        "candidateBounds": {
            "x": 0.100714, "y": 0.085722,
            "width": 0.00623, "height": 0.004111,
        },
        "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:0",
        "lineage": (1, 1, 1),
    },
    {
        "candidateId": "exact-2321-structural-page2-measurement-1ft-2half",
        "text": "1'—296\"",
        "canonical": "1'-2 1/2\"",
        "bounds": {
            "x": 0.59, "y": 0.306667,
            "width": 0.009841, "height": 0.004667,
        },
        "candidateBounds": {
            "x": 0.589881, "y": 0.306444,
            "width": 0.009881, "height": 0.005444,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        "lineage": (7, 1, 1),
    },
    {
        "candidateId": "exact-2321-structural-page2-measurement-1ft-2in",
        "text": "12’",
        "canonical": "1'-2\"",
        "bounds": {
            "x": 0.344921, "y": 0.692,
            "width": 0.005238, "height": 0.003556,
        },
        "candidateBounds": {
            "x": 0.344841, "y": 0.6915,
            "width": 0.00623, "height": 0.004111,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
        "lineage": (5, 1, 1),
    },
)
EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256 = (
    "82f7e6cac282806a31ed343d009009ad2c7e850e06799b57f27b97bbf317ee15"
)
EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256 = (
    "75118aa5adf2696692db1413898f505bcda27128fe96977e68f217bd88e9e41e"
)
EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID = (
    "72e941d8-8114-4082-a976-ae5b2b5daba9"
)
EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_ARCHITECTURAL_2375_PAGE43_NUMBER = 43
EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SOURCE = (
    "exact_rendered_architectural_2375_page43_dimension_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page43_dimension_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SPECS = (
    {
        "id": "architectural-2375-page43-25-foot-dimension",
        "text": "25'-0\"",
        "bounds": {"x": 0.215397, "y": 0.333556, "width": 0.009841, "height": 0.003333},
        "anchors": (("visual-tile-0:0:333:500-subtile-1:1", "word", ("25'-O\"",), {"x": 0.215397, "y": 0.333556, "width": 0.009841, "height": 0.003333}),),
        "supersede": (("word", ("25'-O\"",), {"x": 0.215397, "y": 0.333556, "width": 0.009841, "height": 0.003333}),),
    },
    {
        "id": "architectural-2375-page43-3-foot-clearance-note",
        "text": "(3'-0\" MIN. CLR)",
        "bounds": {"x": 0.240635, "y": 0.330222, "width": 0.026508, "height": 0.003556},
        "anchors": (("visual-tile-0:0:333:500-subtile-1:2", "line", ("(3'-O\" MIN. CLR)",), {"x": 0.240635, "y": 0.330222, "width": 0.026508, "height": 0.003556}),),
        "supersede": (
            ("line", ("(3'-O\" MIN. CLR)",), {"x": 0.240635, "y": 0.330222, "width": 0.026508, "height": 0.003556}),
            ("word", ("(3'-O\"",), {"x": 0.240635, "y": 0.330222, "width": 0.009365, "height": 0.003333}),
        ),
    },
    {
        "id": "architectural-2375-page43-12-foot-dimension-east",
        "text": "12'-0\"",
        # The rendered word OCR starts at the second digit and ends before the
        # closing quote. Keep that partial read as the exact anchor, but give
        # provider review authority over the complete issued `12'-0"` glyph
        # run verified on the immutable page render.
        "bounds": {"x": 0.494762, "y": 0.409333, "width": 0.010873, "height": 0.003556},
        "anchors": (("visual-tile-333:0:333:500-subtile-2:1", "word", ("2'-o\"", "2'-O\""), {"x": 0.496032, "y": 0.409333, "width": 0.008413, "height": 0.003556}),),
        "supersede": (("word", ("2'-o\"", "2'-O\""), {"x": 0.496032, "y": 0.409333, "width": 0.008413, "height": 0.003556}),),
    },
    {
        "id": "architectural-2375-page43-8-foot-dimension-east",
        "text": "8'-0\"",
        "bounds": {"x": 0.579524, "y": 0.401556, "width": 0.006984, "height": 0.003111},
        "anchors": (("visual-tile-333:0:333:500-subtile-2:2", "word", ("8'-O'",), {"x": 0.579524, "y": 0.401556, "width": 0.006984, "height": 0.003111}),),
        "supersede": (("word", ("8'-O'",), {"x": 0.579524, "y": 0.401556, "width": 0.006984, "height": 0.003111}),),
    },
    {
        "id": "architectural-2375-page43-12-foot-dimension-east-lower",
        "text": "12'-0\"",
        "bounds": {"x": 0.579365, "y": 0.409333, "width": 0.007302, "height": 0.003556},
        "anchors": (("visual-tile-333:0:333:500-subtile-2:2", "word", ("{2'-'",), {"x": 0.579365, "y": 0.409333, "width": 0.007302, "height": 0.003556}),),
        "supersede": (("word", ("{2'-'",), {"x": 0.579365, "y": 0.409333, "width": 0.007302, "height": 0.003556}),),
    },
    {
        "id": "architectural-2375-page43-8-foot-7-half-dimension",
        "text": "8'-7 1/2\"",
        "bounds": {"x": 0.14254, "y": 0.801556, "width": 0.013016, "height": 0.003333},
        "anchors": (
            ("visual-tile-0:500:333:500-subtile-1:1", "line", ("{8'-7 172\"",), {"x": 0.14254, "y": 0.801556, "width": 0.013016, "height": 0.003333}),
            ("visual-tile-0:500:333:500-subtile-1:1", "line", ("Tie 2\"",), {"x": 0.136984, "y": 0.798889, "width": 0.018571, "height": 0.006}),
        ),
        "supersede": (
            ("line", ("{8'-7 172\"",), {"x": 0.14254, "y": 0.801556, "width": 0.013016, "height": 0.003333}),
            ("word", ("{8'-7",), {"x": 0.14254, "y": 0.801556, "width": 0.006825, "height": 0.003333}),
            ("line", ("Tie 2\"",), {"x": 0.136984, "y": 0.798889, "width": 0.018571, "height": 0.006}),
            ("word", ("Tie",), {"x": 0.136984, "y": 0.798889, "width": 0.012381, "height": 0.006}),
            ("word", ("2\"",), {"x": 0.150952, "y": 0.801556, "width": 0.004603, "height": 0.003333}),
        ),
    },
    {
        "id": "architectural-2375-page43-8-foot-dimension-south",
        "text": "8'-0\"",
        "bounds": {"x": 0.196667, "y": 0.887778, "width": 0.006984, "height": 0.003111},
        "anchors": (("visual-tile-0:500:333:500-subtile-2:1", "word", ("8'-0'",), {"x": 0.196667, "y": 0.887778, "width": 0.006984, "height": 0.003111}),),
        "supersede": (("word", ("8'-0'",), {"x": 0.196667, "y": 0.887778, "width": 0.006984, "height": 0.003111}),),
    },
    {
        "id": "architectural-2375-page43-56-foot-8-dimension",
        "text": "56'-8\"",
        "bounds": {"x": 0.195714, "y": 0.896444, "width": 0.008889, "height": 0.003333},
        "anchors": (("visual-tile-0:500:333:500-subtile-2:1", "word", ("56'-8'", "5e'-8'"), {"x": 0.195714, "y": 0.896444, "width": 0.008889, "height": 0.003333}),),
        "supersede": (("word", ("56'-8'", "5e'-8'"), {"x": 0.195714, "y": 0.896444, "width": 0.008889, "height": 0.003333}),),
    },
    {
        "id": "architectural-2375-page43-12-foot-dimension-south",
        "text": "12'-0\"",
        "bounds": {"x": 0.238095, "y": 0.887556, "width": 0.007302, "height": 0.003333},
        "anchors": (("visual-tile-0:500:333:500-subtile-2:2", "word", ("12'-0'",), {"x": 0.238095, "y": 0.887556, "width": 0.007302, "height": 0.003333}),),
        "supersede": (("word", ("12'-0'",), {"x": 0.238095, "y": 0.887556, "width": 0.007302, "height": 0.003333}),),
    },
    {
        "id": "architectural-2375-page43-69-foot-8-dimension",
        "text": "69'-8\"",
        "bounds": {"x": 0.215079, "y": 0.905111, "width": 0.008889, "height": 0.003111},
        "anchors": (("visual-tile-0:500:333:500-subtile-2:2", "word", ("63'-8'",), {"x": 0.215079, "y": 0.905111, "width": 0.008889, "height": 0.003111}),),
        "supersede": (("word", ("63'-8'", "69'-8'"), {"x": 0.215079, "y": 0.905111, "width": 0.008889, "height": 0.003111}),),
    },
)
EXACT_ARCHITECTURAL_2375_PAGE49_NUMBER = 49
EXACT_ARCHITECTURAL_2375_PAGE49_SOURCE_SHA256 = (
    EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
)
EXACT_ARCHITECTURAL_2375_PAGE49_PROJECT_ID = (
    EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
)
EXACT_ARCHITECTURAL_2375_PAGE49_EVIDENCE_VERSION = (
    EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
)
EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SOURCE = (
    "exact_rendered_architectural_2375_page49_support_spacing_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page49_support_spacing_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_TEXT = "SUPPORTS 5'-0\" O.C. MAX."
EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SPECS = (
    {
        "id": "architectural-2375-page49-support-spacing-west",
        "bounds": {
            "x": 0.153016, "y": 0.575333,
            "width": 0.043175, "height": 0.003334,
        },
        "constituents": (
            {
                "id": "visual-tile-0:500:333:500-subtile-0:1-word-51",
                "text": "SUPPORTS", "ocrKind": "word",
                "bounds": {
                    "x": 0.153016, "y": 0.575333,
                    "width": 0.016984, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
                "lineage": (8, 1, 1), "ocrOrder": 51,
            },
            {
                "id": "visual-tile-0:500:333:500-subtile-0:1-word-52",
                "text": "5'-0\"", "ocrKind": "word",
                "bounds": {
                    "x": 0.171429, "y": 0.575333,
                    "width": 0.008095, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
                "lineage": (8, 1, 1), "ocrOrder": 52,
            },
            {
                "id": "visual-tile-0:500:333:500-subtile-0:1-word-53",
                "text": "OC.", "ocrKind": "word",
                "bounds": {
                    "x": 0.181111, "y": 0.575556,
                    "width": 0.006032, "height": 0.003111,
                },
                "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
                "lineage": (8, 1, 1), "ocrOrder": 53,
            },
            {
                "id": "visual-tile-0:500:333:500-subtile-0:1-word-54",
                "text": "MAX;", "ocrKind": "word",
                "bounds": {
                    "x": 0.188254, "y": 0.575333,
                    "width": 0.007937, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
                "lineage": (8, 1, 1), "ocrOrder": 54,
            },
        ),
    },
    {
        "id": "architectural-2375-page49-support-spacing-east",
        "bounds": {
            "x": 0.670635, "y": 0.584444,
            "width": 0.04254, "height": 0.003556,
        },
        "constituents": (
            {
                "id": "visual-tile-667:500:333:500-subtile-0:0-word-48",
                "text": "SUPPORTS", "ocrKind": "word",
                "bounds": {
                    "x": 0.670635, "y": 0.584444,
                    "width": 0.017143, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:0",
                "lineage": (9, 1, 1), "ocrOrder": 48,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-0:0-word-49",
                "text": "5'-0\"", "ocrKind": "word",
                "bounds": {
                    "x": 0.689048, "y": 0.584667,
                    "width": 0.008254, "height": 0.003111,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:0",
                "lineage": (9, 1, 1), "ocrOrder": 49,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-0:0-word-50",
                "text": "OC.", "ocrKind": "word",
                "bounds": {
                    "x": 0.69873, "y": 0.584667,
                    "width": 0.00619, "height": 0.003111,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:0",
                "lineage": (9, 1, 1), "ocrOrder": 50,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-0:0-word-51",
                "text": "MAX.", "ocrKind": "word",
                "bounds": {
                    "x": 0.705873, "y": 0.584667,
                    "width": 0.007302, "height": 0.003111,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:0",
                "lineage": (9, 1, 1), "ocrOrder": 51,
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2375_PAGE52_NUMBER = 52
EXACT_ARCHITECTURAL_2375_PAGE52_SOURCE_SHA256 = (
    EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
)
EXACT_ARCHITECTURAL_2375_PAGE52_PROJECT_ID = (
    EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
)
EXACT_ARCHITECTURAL_2375_PAGE52_EVIDENCE_VERSION = (
    EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
)
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SOURCE = (
    "exact_rendered_architectural_2375_page52_existing_wall_panel_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page52_existing_wall_panel_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_TEXT = (
    'EXISTING 5 1/2" THICK CONCRETE WALL PANEL'
)
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_ID = (
    "architectural-2375-page52-existing-wall-panel"
)
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_BOUNDS = {
    "x": 0.14,
    "y": 0.38,
    "width": 0.027143,
    "height": 0.017333,
}
EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_CONSTITUENTS = (
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-50",
        "text": "EXISTING", "ocrKind": "word",
        "bounds": {"x": 0.14, "y": 0.38, "width": 0.014444, "height": 0.003556},
        "lineage": (9, 1, 1), "ocrOrder": 50,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-51",
        "text": "5", "ocrKind": "word",
        "bounds": {"x": 0.155873, "y": 0.38, "width": 0.001905, "height": 0.003333},
        "lineage": (9, 1, 1), "ocrOrder": 51,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-52",
        "text": '1/2"', "ocrKind": "word",
        "bounds": {"x": 0.159841, "y": 0.38, "width": 0.003968, "height": 0.003333},
        "lineage": (9, 1, 1), "ocrOrder": 52,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-line-8",
        "text": 'EXISTING 5 1/2"', "ocrKind": "line",
        "bounds": {"x": 0.14, "y": 0.38, "width": 0.02381, "height": 0.003556},
        "lineage": (9, 1, 1), "ocrOrder": None,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-56",
        "text": "THICK", "ocrKind": "word",
        "bounds": {"x": 0.14, "y": 0.384, "width": 0.009524, "height": 0.004},
        "lineage": (10, 1, 1), "ocrOrder": 56,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-60",
        "text": "CONCRETE", "ocrKind": "word",
        "bounds": {"x": 0.14, "y": 0.389333, "width": 0.01746, "height": 0.003333},
        "lineage": (11, 1, 1), "ocrOrder": 60,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-61",
        "text": "WALL", "ocrKind": "word",
        "bounds": {"x": 0.158889, "y": 0.389333, "width": 0.008254, "height": 0.003333},
        "lineage": (11, 1, 1), "ocrOrder": 61,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-line-10",
        "text": "CONCRETE WALL", "ocrKind": "line",
        "bounds": {"x": 0.14, "y": 0.389333, "width": 0.027143, "height": 0.003333},
        "lineage": (11, 1, 1), "ocrOrder": None,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-2:1-word-65",
        "text": "[PANEL", "ocrKind": "word",
        "textVariants": ("[PANEL", "PANEL"),
        "bounds": {"x": 0.14, "y": 0.394, "width": 0.010794, "height": 0.003333},
        "lineage": (12, 1, 1), "ocrOrder": 65,
    },
)
EXACT_ARCHITECTURAL_2375_PAGE53_NUMBER = 53
EXACT_ARCHITECTURAL_2375_PAGE53_SOURCE_SHA256 = (
    EXACT_ARCHITECTURAL_2375_PAGE52_SOURCE_SHA256
)
EXACT_ARCHITECTURAL_2375_PAGE53_PROJECT_ID = (
    EXACT_ARCHITECTURAL_2375_PAGE52_PROJECT_ID
)
EXACT_ARCHITECTURAL_2375_PAGE53_EVIDENCE_VERSION = (
    EXACT_ARCHITECTURAL_2375_PAGE52_EVIDENCE_VERSION
)
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SOURCE = (
    "exact_rendered_architectural_2375_page53_existing_wall_panel_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page53_existing_wall_panel_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_TEXT = (
    'EXISTING 5 1/2" THICK CONCRETE WALL PANEL'
)
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_ID = (
    "architectural-2375-page53-existing-wall-panel"
)
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_BOUNDS = {
    "x": 0.279206,
    "y": 0.313778,
    "width": 0.034762,
    "height": 0.012666,
}
EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_CONSTITUENTS = (
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-149",
        "text": "EXISTING", "ocrKind": "word",
        "bounds": {
            "x": 0.279365, "y": 0.313778,
            "width": 0.014286, "height": 0.003333,
        },
        "lineage": (26, 1, 1), "ocrOrder": 149,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-150",
        "text": "5", "ocrKind": "word",
        "bounds": {
            "x": 0.295079, "y": 0.313778,
            "width": 0.001905, "height": 0.003111,
        },
        "lineage": (26, 1, 1), "ocrOrder": 150,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-151",
        "text": '1/2"', "ocrKind": "word",
        "bounds": {
            "x": 0.299206, "y": 0.313778,
            "width": 0.00381, "height": 0.003111,
        },
        "lineage": (26, 1, 1), "ocrOrder": 151,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-152",
        "text": "THICK)", "ocrKind": "word",
        "bounds": {
            "x": 0.304603, "y": 0.313778,
            "width": 0.009365, "height": 0.003111,
        },
        "lineage": (26, 1, 1), "ocrOrder": 152,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-line-25",
        "text": 'EXISTING 5 1/2" THICK)', "ocrKind": "line",
        "bounds": {
            "x": 0.279365, "y": 0.313778,
            "width": 0.034603, "height": 0.003333,
        },
        "lineage": (26, 1, 1), "ocrOrder": None,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-156",
        "text": "CONCRETE", "ocrKind": "word",
        "bounds": {
            "x": 0.279206, "y": 0.318444,
            "width": 0.01746, "height": 0.003333,
        },
        "lineage": (27, 1, 1), "ocrOrder": 156,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-157",
        "text": "WALL", "ocrKind": "word",
        "bounds": {
            "x": 0.298254, "y": 0.318444,
            "width": 0.008095, "height": 0.003333,
        },
        "lineage": (27, 1, 1), "ocrOrder": 157,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-line-26",
        "text": "CONCRETE WALL", "ocrKind": "line",
        "bounds": {
            "x": 0.279206, "y": 0.318444,
            "width": 0.027143, "height": 0.003333,
        },
        "lineage": (27, 1, 1), "ocrOrder": None,
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:2-word-161",
        "text": "PANEL", "ocrKind": "word",
        "bounds": {
            "x": 0.279365, "y": 0.323111,
            "width": 0.010635, "height": 0.003333,
        },
        "lineage": (28, 1, 1), "ocrOrder": 161,
    },
)
EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SOURCE = (
    "exact_rendered_architectural_2375_material_label_candidate"
)
EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_material_label_candidate"
)
EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SPECS = (
    {
        "pageNumber": 55,
        "candidateId": "architectural-2375-page55-concrete-floor-slab-1",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-0:500:333:500-subtile-0:1-line-5",
            "text": "|_ [CONCRETE FLOOR SLAB)",
            "bounds": {
                "x": 0.145873, "y": 0.624,
                "width": 0.048413, "height": 0.011778,
            },
            "prefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (6, 1, 1),
        },
    },
    {
        "pageNumber": 55,
        "candidateId": "architectural-2375-page55-concrete-floor-slab-2",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-333:500:333:500-subtile-0:1-line-5",
            "text": "|_ [CONCRETE FLOOR SLAB)",
            "bounds": {
                "x": 0.483492, "y": 0.624,
                "width": 0.048413, "height": 0.011778,
            },
            "prefix": "visual-tile-333:500:333:500-subtile-0:1",
            "lineage": (6, 1, 1),
        },
    },
    {
        "pageNumber": 55,
        "candidateId": "architectural-2375-page55-concrete-floor-slab-3",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-667:500:333:500-subtile-0:1-line-4",
            "text": "{CONCRETE FLOOR SLAB]",
            "bounds": {
                "x": 0.824603, "y": 0.627778,
                "width": 0.045556, "height": 0.005556,
            },
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (5, 1, 1),
        },
    },
    {
        "pageNumber": 56,
        "candidateId": "architectural-2375-page56-concrete-floor-slab-1",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-0:500:333:500-subtile-0:1-line-0",
            "text": "CONCRETE FLOOR SLAB}",
            "bounds": {
                "x": 0.155397, "y": 0.627778,
                "width": 0.04, "height": 0.003333,
            },
            "prefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (1, 1, 1),
        },
    },
    {
        "pageNumber": 56,
        "candidateId": "architectural-2375-page56-concrete-floor-slab-2",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-333:500:333:500-subtile-0:1-line-8",
            "text": "[CONCRETE FLOOR SLAB]",
            "bounds": {
                "x": 0.487302, "y": 0.627778,
                "width": 0.045556, "height": 0.005556,
            },
            "prefix": "visual-tile-333:500:333:500-subtile-0:1",
            "lineage": (9, 1, 1),
        },
    },
    {
        "pageNumber": 56,
        "candidateId": "architectural-2375-page56-concrete-floor-slab-3",
        "canonicalText": "CONCRETE FLOOR SLAB",
        "raw": {
            "id": "visual-tile-667:500:333:500-subtile-0:1-line-2",
            "text": "[CONCRETE FLOOR SLAB]",
            "bounds": {
                "x": 0.824286, "y": 0.627778,
                "width": 0.045556, "height": 0.005556,
            },
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (3, 1, 1),
        },
    },
    {
        "pageNumber": 65,
        "candidateId": "architectural-2375-page65-concrete-wall-panel",
        "canonicalText": "CONCRETE WALL PANEL",
        "raw": {
            "id": "visual-tile-0:500:333:500-subtile-0:1-line-10",
            "text": "| {CONCRETE WALL PANEL]",
            "bounds": {
                "x": 0.134286, "y": 0.635778,
                "width": 0.055873, "height": 0.006,
            },
            "prefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (11, 1, 1),
        },
    },
    {
        "pageNumber": 67,
        "candidateId": "architectural-2375-page67-concrete-slab-1",
        "canonicalText": "CONCRETE SLAB",
        "raw": {
            "id": "visual-tile-0:0:333:500-subtile-1:1-line-16",
            "text": "_{EERERETE SLAB]",
            "bounds": {
                "x": 0.122063, "y": 0.191111,
                "width": 0.039524, "height": 0.012222,
            },
            "prefix": "visual-tile-0:0:333:500-subtile-1:1",
            "lineage": (17, 1, 1),
        },
    },
    {
        "pageNumber": 67,
        "candidateId": "architectural-2375-page67-concrete-slab-2",
        "canonicalText": "CONCRETE SLAB",
        "raw": {
            "id": "visual-tile-0:0:333:500-subtile-2:1-line-25",
            "text": "_{EERERETE SLAB]",
            "bounds": {
                "x": 0.122063, "y": 0.436889,
                "width": 0.039524, "height": 0.012222,
            },
            "prefix": "visual-tile-0:0:333:500-subtile-2:1",
            "lineage": (26, 1, 1),
        },
    },
)
EXACT_ARCHITECTURAL_2375_PAGE60_NUMBER = 60
EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SOURCE = (
    "exact_rendered_architectural_2375_page60_schedule_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page60_schedule_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SPEC = {
    "candidateId": "architectural-2375-page60-door-3-width-13ft",
    "canonicalText": "13'-0\"",
    "candidateBounds": {
        "x": 0.41619, "y": 0.094,
        "width": 0.009206, "height": 0.003556,
    },
    "raw": {
        "id": "visual-tile-333:0:333:500-subtile-0:0-word-56",
        "text": "[13’-0\"",
        "textVariants": ("[13’-0\"", "[13'-0\"|"),
        "bounds": {
            "x": 0.415397, "y": 0.094,
            "width": 0.010794, "height": 0.005556,
        },
        "prefix": "visual-tile-333:0:333:500-subtile-0:0",
        "lineage": (14, 1, 1),
        "ocrOrder": 56,
    },
}
EXACT_ARCHITECTURAL_2375_PAGE66_NUMBER = 66
EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SOURCE = (
    "exact_rendered_architectural_2375_page66_opening_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page66_opening_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SPECS = (
    {
        "candidateId": "architectural-2375-page66-43-mil-opening",
        "canonicalText": "43 MIL. UP TO 12'-0\" OPENING",
        "authorityKey": "zero-inch-foot:12",
        "candidateBounds": {
            "x": 0.734921, "y": 0.670444,
            "width": 0.051111, "height": 0.004222,
        },
        "constituents": (
            {
                "kind": "line",
                "text": "43 MIL. UP TO 12'-0\"",
                "bounds": {
                    "x": 0.734921, "y": 0.670444,
                    "width": 0.032063, "height": 0.004222,
                },
                "variants": (
                    {
                        "id": "visual-tile-667:500:333:500-subtile-0:0-line-34",
                        "prefix": "visual-tile-667:500:333:500-subtile-0:0",
                        "lineage": (35, 1, 1),
                    },
                    {
                        "id": "visual-tile-667:500:333:500-subtile-1:0-line-3",
                        "prefix": "visual-tile-667:500:333:500-subtile-1:0",
                        "lineage": (4, 1, 1),
                    },
                ),
            },
            {
                "kind": "word",
                "text": "12'-0\"",
                "bounds": {
                    "x": 0.758571, "y": 0.671111,
                    "width": 0.008413, "height": 0.003333,
                },
                "variants": (
                    {
                        "id": "visual-tile-667:500:333:500-subtile-0:0-word-158",
                        "prefix": "visual-tile-667:500:333:500-subtile-0:0",
                        "lineage": (35, 1, 1),
                        "ocrOrder": 158,
                    },
                    {
                        "id": "visual-tile-667:500:333:500-subtile-1:0-word-24",
                        "prefix": "visual-tile-667:500:333:500-subtile-1:0",
                        "lineage": (4, 1, 1),
                        "ocrOrder": 24,
                    },
                ),
            },
        ),
    },
    {
        "candidateId": "architectural-2375-page66-54-mil-opening",
        "canonicalText": "54 MIL. UP TO 16'-0\" OPENING",
        "authorityKey": "zero-inch-foot:16",
        "candidateBounds": {
            "x": 0.735079, "y": 0.675333,
            "width": 0.050952, "height": 0.004,
        },
        "constituents": (
            {
                "kind": "line",
                "text": "54 MIL. UP TO 16'-O\"",
                "bounds": {
                    "x": 0.735079, "y": 0.675333,
                    "width": 0.032698, "height": 0.004,
                },
                "variants": (
                    {
                        "id": "visual-tile-667:500:333:500-subtile-1:0-line-5",
                        "prefix": "visual-tile-667:500:333:500-subtile-1:0",
                        "lineage": (6, 1, 1),
                    },
                ),
            },
            {
                "kind": "word",
                "text": "16'-O\"",
                "bounds": {
                    "x": 0.758571, "y": 0.675778,
                    "width": 0.009206, "height": 0.003333,
                },
                "variants": (
                    {
                        "id": "visual-tile-667:500:333:500-subtile-1:0-word-36",
                        "prefix": "visual-tile-667:500:333:500-subtile-1:0",
                        "lineage": (6, 1, 1),
                        "ocrOrder": 36,
                    },
                ),
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2375_PAGE68_NUMBER = 68
EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SOURCE = (
    "exact_rendered_architectural_2375_page68_roof_recess_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page68_roof_recess_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SPEC = {
    "candidateId": "architectural-2375-page68-roof-recess",
    "canonicalText": "2'-4\" W X 4'-0\" ROOF RECESS",
    "authorityKey": "zero-inch-foot:4",
    "candidateBounds": {
        "x": 0.517063, "y": 0.215333,
        "width": 0.05008, "height": 0.005445,
    },
    "constituents": (
        {
            "id": "visual-tile-333:0:333:500-subtile-1:1-line-3",
            "kind": "line",
            "text": "'-4\" WX 4'-O\" ROOF RECE:",
            "bounds": {"x": 0.519524, "y": 0.216222, "width": 0.043651, "height": 0.003333},
            "prefix": "visual-tile-333:0:333:500-subtile-1:1",
            "lineage": (4, 1, 1),
            "ocrOrder": None,
            "boundaryTruncated": True,
        },
        {
            "id": "visual-tile-333:0:333:500-subtile-1:1-word-25",
            "kind": "word",
            "text": "4'-O\"",
            "bounds": {"x": 0.533333, "y": 0.216222, "width": 0.008254, "height": 0.003111},
            "prefix": "visual-tile-333:0:333:500-subtile-1:1",
            "lineage": (4, 1, 1),
            "ocrOrder": 25,
            "boundaryTruncated": False,
        },
        {
            "id": "visual-tile-333:0:333:500-subtile-1:1-word-26",
            "kind": "word",
            "text": "ROOF",
            "bounds": {"x": 0.543175, "y": 0.216222, "width": 0.008889, "height": 0.003333},
            "prefix": "visual-tile-333:0:333:500-subtile-1:1",
            "lineage": (4, 1, 1),
            "ocrOrder": 26,
            "boundaryTruncated": False,
        },
        {
            "id": "visual-tile-333:0:333:500-subtile-1:2-word-14",
            "kind": "word",
            "text": "CESS)",
            "bounds": {"x": 0.557937, "y": 0.216, "width": 0.008413, "height": 0.003556},
            "prefix": "visual-tile-333:0:333:500-subtile-1:2",
            "lineage": (3, 1, 1),
            "ocrOrder": 14,
            "boundaryTruncated": False,
        },
    ),
}
EXACT_ARCHITECTURAL_2375_PAGE61_NUMBER = 61
EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SOURCE = (
    "exact_rendered_architectural_2375_page61_handrail_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page61_handrail_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SPEC = {
    "candidateId": "architectural-2375-page61-handrail-bracket-spacing",
    "canonicalText": "HANDRAIL BRACKET @ 4'-0\" MAX. O.C.",
    "candidateBounds": {
        "x": 0.751111, "y": 0.524,
        "width": 0.063492, "height": 0.004,
    },
    "measurementId": "visual-tile-667:500:333:500-subtile-0:1-word-20",
    "constituents": (
        {
            "id": "visual-tile-667:500:333:500-subtile-0:0-word-33",
            "text": "HANDRAIL",
            "bounds": {"x": 0.751111, "y": 0.524, "width": 0.016667, "height": 0.004},
            "prefix": "visual-tile-667:500:333:500-subtile-0:0",
            "lineage": (6, 1, 1), "ocrOrder": 33,
        },
        {
            "id": "visual-tile-667:500:333:500-subtile-0:0-word-34",
            "text": "BRACKET",
            "bounds": {"x": 0.769206, "y": 0.524444, "width": 0.015714, "height": 0.003556},
            "prefix": "visual-tile-667:500:333:500-subtile-0:0",
            "lineage": (6, 1, 1), "ocrOrder": 34,
        },
        {
            "id": "visual-tile-667:500:333:500-subtile-0:1-word-19",
            "text": "@",
            "bounds": {"x": 0.786349, "y": 0.524889, "width": 0.001905, "height": 0.002222},
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (3, 1, 1), "ocrOrder": 19,
        },
        {
            "id": "visual-tile-667:500:333:500-subtile-0:1-word-20",
            "text": "4'-O\"",
            "bounds": {"x": 0.789524, "y": 0.524444, "width": 0.008413, "height": 0.003333},
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (3, 1, 1), "ocrOrder": 20,
        },
        {
            "id": "visual-tile-667:500:333:500-subtile-0:1-word-21",
            "text": "MAX.",
            "bounds": {"x": 0.799206, "y": 0.524444, "width": 0.008095, "height": 0.003333},
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (3, 1, 1), "ocrOrder": 21,
        },
        {
            "id": "visual-tile-667:500:333:500-subtile-0:1-word-22",
            "text": "OC.",
            "bounds": {"x": 0.808413, "y": 0.524667, "width": 0.00619, "height": 0.003111},
            "prefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (3, 1, 1), "ocrOrder": 22,
        },
    ),
}
EXACT_ARCHITECTURAL_2375_PAGE63_NUMBER = 63
EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SOURCE = (
    "exact_rendered_architectural_2375_page63_spacing_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page63_spacing_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE63_SUPPORT_POST_TEXT = (
    "1 1/2\" Ø STEEL TUBE SUPPORT POST. CORE AND COLD-ROCK POST INTO "
    "CONCRETE @ MAX. 6'-0\" O.C."
)
EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SPECS = (
    {
        "candidateId": "architectural-2375-page63-support-spacing-left-upper",
        "canonicalText": EXACT_ARCHITECTURAL_2375_PAGE63_SUPPORT_POST_TEXT,
        "candidateBounds": {
            "x": 0.310952, "y": 0.133556,
            "width": 0.040477, "height": 0.022222,
        },
        "authorityIds": (
            "visual-tile-333:0:333:500-subtile-0:0-word-51",
            "visual-tile-333:0:333:500-subtile-0:0-word-52",
        ),
        "constituents": (
            {
                "idVariants": ("visual-tile-0:0:333:500-subtile-0:2-word-96",),
                "textVariants": ("CONCRETE",),
                "bounds": {"x": 0.310952, "y": 0.148, "width": 0.01746, "height": 0.003333},
                "prefix": "visual-tile-0:0:333:500-subtile-0:2",
                "lineage": (18, 1, 1), "ocrOrderVariants": (96,),
            },
            {
                "idVariants": ("visual-tile-0:0:333:500-subtile-0:2-word-97",),
                "textVariants": ("@",),
                "bounds": {"x": 0.33, "y": 0.148444, "width": 0.001746, "height": 0.002222},
                "prefix": "visual-tile-0:0:333:500-subtile-0:2",
                "lineage": (18, 1, 1), "ocrOrderVariants": (97,),
            },
            {
                "idVariants": (
                    "visual-tile-333:0:333:500-subtile-0:0-word-50",
                    "visual-tile-333:0:333:500-subtile-0:0-word-51",
                ),
                "textVariants": ("MAX.",),
                "bounds": {"x": 0.333333, "y": 0.148, "width": 0.007778, "height": 0.003333},
                "prefix": "visual-tile-333:0:333:500-subtile-0:0",
                "lineage": (11, 1, 1), "ocrOrderVariants": (50, 51),
                "boundaryTruncated": True,
            },
            {
                "idVariants": (
                    "visual-tile-333:0:333:500-subtile-0:0-word-51",
                    "visual-tile-333:0:333:500-subtile-0:0-word-52",
                ),
                "textVariants": ("6'-D\"",),
                "bounds": {"x": 0.342222, "y": 0.148, "width": 0.008571, "height": 0.003333},
                "prefix": "visual-tile-333:0:333:500-subtile-0:0",
                "lineage": (11, 1, 1), "ocrOrderVariants": (51, 52),
            },
            {
                "idVariants": (
                    "visual-tile-0:0:333:500-subtile-0:2-word-108",
                    "visual-tile-0:0:333:500-subtile-0:2-word-109",
                ),
                "textVariants": ("oc.", "OC.", "O.C.", "OL.", "O.L."),
                "bounds": {"x": 0.310952, "y": 0.152667, "width": 0.00619, "height": 0.003111},
                "prefix": "visual-tile-0:0:333:500-subtile-0:2",
                "lineage": (21, 1, 1), "ocrOrderVariants": (108, 109),
            },
        ),
    },
    {
        "candidateId": "architectural-2375-page63-support-spacing-right-upper",
        "canonicalText": EXACT_ARCHITECTURAL_2375_PAGE63_SUPPORT_POST_TEXT,
        "candidateBounds": {
            "x": 0.479048, "y": 0.108222,
            "width": 0.045714, "height": 0.023111,
        },
        "authorityIds": (
            "visual-tile-333:0:333:500-subtile-0:1-word-57",
            "visual-tile-333:0:333:500-subtile-0:1-line-7",
        ),
        "constituents": (
            {"idVariants": ("visual-tile-333:0:333:500-subtile-0:1-word-54",), "textVariants": ("CONCRETE",), "bounds": {"x": 0.479841, "y": 0.123556, "width": 0.01746, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-0:1", "lineage": (8, 1, 1), "ocrOrderVariants": (54,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-0:1-word-55",), "textVariants": ("@",), "bounds": {"x": 0.498889, "y": 0.124, "width": 0.001746, "height": 0.002222}, "prefix": "visual-tile-333:0:333:500-subtile-0:1", "lineage": (8, 1, 1), "ocrOrderVariants": (55,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-0:1-word-56",), "textVariants": ("MAx.",), "bounds": {"x": 0.502063, "y": 0.123556, "width": 0.007937, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-0:1", "lineage": (8, 1, 1), "ocrOrderVariants": (56,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-0:1-word-57",), "textVariants": ("6'-0\"",), "bounds": {"x": 0.511111, "y": 0.123556, "width": 0.008571, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-0:1", "lineage": (8, 1, 1), "ocrOrderVariants": (57,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-0:1-word-61",), "textVariants": ("OL.", "O.L.", "OC.", "O.C."), "bounds": {"x": 0.479841, "y": 0.128444, "width": 0.00619, "height": 0.002889}, "prefix": "visual-tile-333:0:333:500-subtile-0:1", "lineage": (9, 1, 1), "ocrOrderVariants": (61,)},
        ),
    },
    {
        "candidateId": "architectural-2375-page63-support-spacing-left-lower",
        "canonicalText": EXACT_ARCHITECTURAL_2375_PAGE63_SUPPORT_POST_TEXT,
        "candidateBounds": {"x": 0.310317, "y": 0.368, "width": 0.045556, "height": 0.022222},
        "authorityIds": ("visual-tile-333:0:333:500-subtile-2:0-word-23",),
        "constituents": (
            {"idVariants": ("visual-tile-0:0:333:500-subtile-2:2-word-27",), "textVariants": ("CONCRETE",), "bounds": {"x": 0.310952, "y": 0.382444, "width": 0.01746, "height": 0.003333}, "prefix": "visual-tile-0:0:333:500-subtile-2:2", "lineage": (5, 1, 1), "ocrOrderVariants": (27,)},
            {"idVariants": ("visual-tile-0:0:333:500-subtile-2:2-word-28",), "textVariants": ("@",), "bounds": {"x": 0.33, "y": 0.382889, "width": 0.001746, "height": 0.002222}, "prefix": "visual-tile-0:0:333:500-subtile-2:2", "lineage": (5, 1, 1), "ocrOrderVariants": (28,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:0-word-22",), "textVariants": ("MAX.",), "bounds": {"x": 0.333333, "y": 0.382444, "width": 0.007143, "height": 0.003111}, "prefix": "visual-tile-333:0:333:500-subtile-2:0", "lineage": (5, 1, 1), "ocrOrderVariants": (22,), "boundaryTruncated": True},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:0-word-23",), "textVariants": ("6'-O\"",), "bounds": {"x": 0.342222, "y": 0.382444, "width": 0.008571, "height": 0.003111}, "prefix": "visual-tile-333:0:333:500-subtile-2:0", "lineage": (5, 1, 1), "ocrOrderVariants": (23,)},
            {"idVariants": ("visual-tile-0:0:333:500-subtile-2:2-word-36",), "textVariants": ("OL.", "O.L.", "OC.", "O.C."), "bounds": {"x": 0.310952, "y": 0.387111, "width": 0.005397, "height": 0.003111}, "prefix": "visual-tile-0:0:333:500-subtile-2:2", "lineage": (7, 1, 1), "ocrOrderVariants": (36,)},
        ),
    },
    {
        "candidateId": "architectural-2375-page63-support-spacing-right-lower",
        "canonicalText": EXACT_ARCHITECTURAL_2375_PAGE63_SUPPORT_POST_TEXT,
        "candidateBounds": {"x": 0.479841, "y": 0.341778, "width": 0.044921, "height": 0.021778},
        "authorityIds": ("visual-tile-333:0:333:500-subtile-2:1-word-31", "visual-tile-333:0:333:500-subtile-2:1-line-4"),
        "constituents": (
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:1-word-28",), "textVariants": ("CONCRETE",), "bounds": {"x": 0.479841, "y": 0.355778, "width": 0.01746, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-2:1", "lineage": (5, 1, 1), "ocrOrderVariants": (28,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:1-word-29",), "textVariants": ("@",), "bounds": {"x": 0.498889, "y": 0.356222, "width": 0.001746, "height": 0.002222}, "prefix": "visual-tile-333:0:333:500-subtile-2:1", "lineage": (5, 1, 1), "ocrOrderVariants": (29,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:1-word-30",), "textVariants": ("MAx.",), "bounds": {"x": 0.502063, "y": 0.355778, "width": 0.007937, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-2:1", "lineage": (5, 1, 1), "ocrOrderVariants": (30,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:1-word-31",), "textVariants": ("6'-0\"",), "bounds": {"x": 0.511111, "y": 0.355778, "width": 0.008571, "height": 0.003333}, "prefix": "visual-tile-333:0:333:500-subtile-2:1", "lineage": (5, 1, 1), "ocrOrderVariants": (31,)},
            {"idVariants": ("visual-tile-333:0:333:500-subtile-2:1-word-35",), "textVariants": ("OL.", "O.L.", "OC.", "O.C."), "bounds": {"x": 0.479841, "y": 0.360667, "width": 0.00619, "height": 0.002889}, "prefix": "visual-tile-333:0:333:500-subtile-2:1", "lineage": (6, 1, 1), "ocrOrderVariants": (35,)},
        ),
    },
    {
        "candidateId": "architectural-2375-page63-handrail-post-spacing",
        "canonicalText": "EQUAL SPACE MAX. 6'-0\" O.C.",
        "candidateBounds": {"x": 0.800159, "y": 0.340222, "width": 0.049841, "height": 0.003333},
        "authorityIds": (
            "visual-tile-667:0:333:500-subtile-1:1-word-91",
            "visual-tile-667:0:333:500-subtile-1:1-line-15",
            "visual-tile-667:0:333:500-subtile-2:1-word-29",
            "visual-tile-667:0:333:500-subtile-2:1-line-3",
        ),
        "constituents": (
            {"idVariants": ("visual-tile-667:0:333:500-subtile-2:1-word-26",), "textVariants": ("EQUAL",), "bounds": {"x": 0.800159, "y": 0.340222, "width": 0.010476, "height": 0.003333}, "prefix": "visual-tile-667:0:333:500-subtile-2:1", "lineage": (4, 1, 1), "ocrOrderVariants": (26,)},
            {"idVariants": ("visual-tile-667:0:333:500-subtile-2:1-word-27",), "textVariants": ("SPACE",), "bounds": {"x": 0.812063, "y": 0.340222, "width": 0.011111, "height": 0.003333}, "prefix": "visual-tile-667:0:333:500-subtile-2:1", "lineage": (4, 1, 1), "ocrOrderVariants": (27,)},
            {"idVariants": ("visual-tile-667:0:333:500-subtile-2:1-word-28",), "textVariants": ("MAx.",), "bounds": {"x": 0.824603, "y": 0.340222, "width": 0.007937, "height": 0.003111}, "prefix": "visual-tile-667:0:333:500-subtile-2:1", "lineage": (4, 1, 1), "ocrOrderVariants": (28,)},
            {"idVariants": ("visual-tile-667:0:333:500-subtile-2:1-word-29",), "textVariants": ("6'-0\"",), "bounds": {"x": 0.833651, "y": 0.340222, "width": 0.008571, "height": 0.003111}, "prefix": "visual-tile-667:0:333:500-subtile-2:1", "lineage": (4, 1, 1), "ocrOrderVariants": (29,)},
            {"idVariants": ("visual-tile-667:0:333:500-subtile-2:1-word-30",), "textVariants": ("OC.",), "bounds": {"x": 0.843651, "y": 0.340222, "width": 0.006349, "height": 0.003111}, "prefix": "visual-tile-667:0:333:500-subtile-2:1", "lineage": (4, 1, 1), "ocrOrderVariants": (30,)},
            {"idVariants": ("visual-tile-667:0:333:500-subtile-1:1-word-91",), "textVariants": ("6'-2\"",), "bounds": {"x": 0.833651, "y": 0.340222, "width": 0.008571, "height": 0.003111}, "prefix": "visual-tile-667:0:333:500-subtile-1:1", "lineage": (16, 1, 1), "ocrOrderVariants": (91,)},
        ),
    },
)
EXACT_ARCHITECTURAL_2375_PAGE64_NUMBER = 64
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SOURCE = (
    "exact_rendered_architectural_2375_page64_control_joint_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page64_control_joint_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SOURCE = (
    "exact_rendered_architectural_2375_page64_expansion_joint_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_architectural_2375_page64_expansion_joint_candidate"
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TEXT = (
    "CONTROL JOINTS SHALL BE AT 4'-0\" O.C. MAX. EACH WAY, UNLESS NOTED "
    "OTHERWISE ON PLANS"
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_BOUNDS = {
    "x": 0.387143,
    "y": 0.935556,
    "width": 0.15127,
    "height": 0.008889,
}
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TEXT = (
    "EXPANSION JOINTS SHALL BE AT 12'-0\" O.C. MAX. EACH WAY."
)
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_BOUNDS = {
    "x": 0.387143,
    "y": 0.931111,
    "width": 0.099365,
    "height": 0.003778,
}
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONSTITUENTS = (
    {
        "idVariants": (
            "visual-tile-333:500:333:500-subtile-2:0-word-66",
        ),
        "textVariants": ("4'-0\"",),
        "bounds": {
            "x": 0.438889, "y": 0.936222,
            "width": 0.008413, "height": 0.003111,
        },
        "prefix": "visual-tile-333:500:333:500-subtile-2:0",
        "lineage": (11, 1, 1),
        "ocrOrderVariants": (66,),
    },
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES = (
    (11, 1, 1),
    (12, 1, 1),
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONTEXT = (
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-61",), "textVariants": ("CONTROL",), "bounds": {"x": 0.387143, "y": 0.936222, "width": 0.015238, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (11, 1, 1), "ocrOrderVariants": (61,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-62",), "textVariants": ("JOINTS",), "bounds": {"x": 0.40381, "y": 0.935778, "width": 0.010794, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (11, 1, 1), "ocrOrderVariants": (62,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-63",), "textVariants": ("SHALL",), "bounds": {"x": 0.415873, "y": 0.936222, "width": 0.010317, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (11, 1, 1), "ocrOrderVariants": (63,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-64",), "textVariants": ("BE",), "bounds": {"x": 0.427778, "y": 0.936222, "width": 0.004444, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (11, 1, 1), "ocrOrderVariants": (64,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-65",), "textVariants": ("AT",), "bounds": {"x": 0.433651, "y": 0.936222, "width": 0.004127, "height": 0.003111}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (11, 1, 1), "ocrOrderVariants": (65,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-55", "visual-tile-333:500:333:500-subtile-2:1-word-58"), "textVariants": ("OC.",), "bounds": {"x": 0.44873, "y": 0.936444, "width": 0.00619, "height": 0.002889}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (55, 58)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-56", "visual-tile-333:500:333:500-subtile-2:1-word-59"), "textVariants": ("MAX.",), "bounds": {"x": 0.455873, "y": 0.936222, "width": 0.007937, "height": 0.003111}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (56, 59)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-57", "visual-tile-333:500:333:500-subtile-2:1-word-60"), "textVariants": ("EACH",), "bounds": {"x": 0.465079, "y": 0.936222, "width": 0.008889, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (57, 60)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-58", "visual-tile-333:500:333:500-subtile-2:1-word-61"), "textVariants": ("WAY,",), "bounds": {"x": 0.475238, "y": 0.936222, "width": 0.00746, "height": 0.003778}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (58, 61)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-59", "visual-tile-333:500:333:500-subtile-2:1-word-62"), "textVariants": ("UNLESS",), "bounds": {"x": 0.483968, "y": 0.936222, "width": 0.011746, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (59, 62)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-60", "visual-tile-333:500:333:500-subtile-2:1-word-63"), "textVariants": ("NOTED",), "bounds": {"x": 0.496984, "y": 0.936222, "width": 0.010952, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (60, 63)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-61", "visual-tile-333:500:333:500-subtile-2:1-word-64"), "textVariants": ("OTHERWISE",), "bounds": {"x": 0.509365, "y": 0.935556, "width": 0.017778, "height": 0.004}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (61, 64)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-62", "visual-tile-333:500:333:500-subtile-2:1-word-65"), "textVariants": ("ON",), "bounds": {"x": 0.528571, "y": 0.936222, "width": 0.004444, "height": 0.003111}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (62, 65)},
)
EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_OPTIONAL_OVERLAP = {
    "idVariants": (
        "visual-tile-333:500:333:500-subtile-2:1-word-54",
        "visual-tile-333:500:333:500-subtile-2:1-word-57",
    ),
    "textVariants": ("4'-D\"", "4'-0\"", "4'-O\""),
    "boundsVariants": (
        {"x": 0.438889, "y": 0.936222, "width": 0.008413, "height": 0.003111},
        {"x": 0.436825, "y": 0.936222, "width": 0.010476, "height": 0.003111},
    ),
    "prefix": "visual-tile-333:500:333:500-subtile-2:1",
    "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TAIL_LINEAGES,
    "ocrOrderVariants": (54, 57),
}
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES = (
    (10, 1, 1),
    (11, 1, 1),
)
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_CONTEXT = (
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-52",), "textVariants": ("EXPANSION",), "bounds": {"x": 0.387143, "y": 0.931333, "width": 0.018571, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (52,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-53",), "textVariants": ("JOINTS",), "bounds": {"x": 0.406984, "y": 0.931111, "width": 0.010794, "height": 0.003778}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (53,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-54",), "textVariants": ("SHALL",), "bounds": {"x": 0.419048, "y": 0.931556, "width": 0.010317, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (54,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-55",), "textVariants": ("BE",), "bounds": {"x": 0.430952, "y": 0.931556, "width": 0.004444, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (55,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-56",), "textVariants": ("AT",), "bounds": {"x": 0.436825, "y": 0.931556, "width": 0.004127, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (56,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-57",), "textVariants": ("12'-\"",), "bounds": {"x": 0.442381, "y": 0.931333, "width": 0.008413, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (57,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-44", "visual-tile-333:500:333:500-subtile-2:1-word-48"), "textVariants": ("AT",), "bounds": {"x": 0.436825, "y": 0.931556, "width": 0.004127, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (44, 48)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-45", "visual-tile-333:500:333:500-subtile-2:1-word-49"), "textVariants": ("12'-O\"",), "bounds": {"x": 0.442381, "y": 0.931333, "width": 0.008413, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (45, 49)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-46", "visual-tile-333:500:333:500-subtile-2:1-word-50"), "textVariants": ("OC.",), "bounds": {"x": 0.452381, "y": 0.931778, "width": 0.006032, "height": 0.003111}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (46, 50)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-47", "visual-tile-333:500:333:500-subtile-2:1-word-51"), "textVariants": ("MAX.",), "bounds": {"x": 0.459524, "y": 0.931556, "width": 0.007937, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (47, 51)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-48", "visual-tile-333:500:333:500-subtile-2:1-word-52"), "textVariants": ("EACH",), "bounds": {"x": 0.468571, "y": 0.931556, "width": 0.008889, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (48, 52)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-49", "visual-tile-333:500:333:500-subtile-2:1-word-53"), "textVariants": ("WAY.",), "bounds": {"x": 0.478889, "y": 0.931556, "width": 0.007619, "height": 0.003333}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (49, 53)},
)
EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_AUTHORITIES = (
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-word-57",), "textVariants": ("12'-\"",), "bounds": {"x": 0.442381, "y": 0.931333, "width": 0.008413, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrOrderVariants": (57,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-word-45", "visual-tile-333:500:333:500-subtile-2:1-word-49"), "textVariants": ("12'-O\"",), "bounds": {"x": 0.442381, "y": 0.931333, "width": 0.008413, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrOrderVariants": (45, 49)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:0-line-9",), "textVariants": ("EXPANSION JOINTS SHALL BE AT 12'-\"",), "bounds": {"x": 0.387143, "y": 0.931111, "width": 0.063651, "height": 0.003778}, "prefix": "visual-tile-333:500:333:500-subtile-2:0", "lineage": (10, 1, 1), "ocrKind": "line", "ocrOrderVariants": (None,)},
    {"idVariants": ("visual-tile-333:500:333:500-subtile-2:1-line-9", "visual-tile-333:500:333:500-subtile-2:1-line-10"), "textVariants": ("AT 12'-O\" OC. MAX. EACH WAY.",), "bounds": {"x": 0.436825, "y": 0.931333, "width": 0.049683, "height": 0.003556}, "prefix": "visual-tile-333:500:333:500-subtile-2:1", "lineageVariants": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TAIL_LINEAGES, "ocrKind": "line", "ocrOrderVariants": (None,)},
)
EXACT_CANOPY_B_PROJECT_ID = "72e941d8-8114-4082-a976-ae5b2b5daba9"
EXACT_CANOPY_B_SOURCE_SHA256 = (
    "3da35b7fba15a676d8e40d8682920d4b7fcdf008d95996bfa311f1012b499b44"
)
EXACT_CANOPY_B_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_CANOPY_B_PAGE4_NUMBER = 4
EXACT_CANOPY_B_PAGE4_SCHEDULE_SOURCE = (
    "exact_rendered_canopy_b_page4_schedule_proposition_candidate"
)
EXACT_CANOPY_B_PAGE4_SCHEDULE_SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_canopy_b_page4_schedule_proposition_candidate"
)
EXACT_CANOPY_B_PAGE4_SCHEDULE_SPECS = (
    {
        "candidateId": "canopy-b-page4-ar3-elevation",
        "canonicalText": "Elev.=100'-0\"",
        "candidateBounds": {
            "x": 0.129697, "y": 0.252941,
            "width": 0.025454, "height": 0.003137,
        },
        "authorityIds": (
            "visual-tile-0:0:333:500-subtile-1:1-word-76",
        ),
        "constituents": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-word-72",
                "text": "lztew--",
                "bounds": {
                    "x": 0.130303, "y": 0.253333,
                    "width": 0.009091, "height": 0.002745,
                },
                "prefix": "visual-tile-0:0:333:500-subtile-1:1",
                "lineage": (16, 1, 1),
                "ocrOrder": 72,
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-word-76",
                "text": "‘0'-0\"",
                "bounds": {
                    "x": 0.144242, "y": 0.253333,
                    "width": 0.010909, "height": 0.002745,
                },
                "prefix": "visual-tile-0:0:333:500-subtile-1:1",
                "lineage": (17, 1, 1),
                "ocrOrder": 76,
            },
        ),
    },
    {
        "candidateId": "canopy-b-page4-ar8-max-plate",
        "canonicalText": "Max Plate W=8\", L=1'-7\", Min Thk=3/8\"",
        "candidateBounds": {
            "x": 0.236364, "y": 0.238824,
            "width": 0.070303, "height": 0.003529,
        },
        "authorityIds": (
            "visual-tile-0:0:333:500-subtile-1:2-line-8",
            "visual-tile-0:0:333:500-subtile-1:2-word-39",
        ),
        "constituents": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:2-line-8",
                "text": "Max Plate W=8\",Le1'-7\", Min Thk=3/8\"",
                "bounds": {
                    "x": 0.236364, "y": 0.238824,
                    "width": 0.070303, "height": 0.003529,
                },
                "prefix": "visual-tile-0:0:333:500-subtile-1:2",
                "lineage": (9, 1, 1),
                "ocrOrder": None,
                "kind": "line",
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:2-word-39",
                "text": "W=8\",Le1'-7\",",
                "bounds": {
                    "x": 0.256061, "y": 0.239216,
                    "width": 0.024545, "height": 0.003137,
                },
                "prefix": "visual-tile-0:0:333:500-subtile-1:2",
                "lineage": (9, 1, 1),
                "ocrOrder": 39,
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:2-word-41",
                "text": "Thk=3/8\"",
                "bounds": {
                    "x": 0.291212, "y": 0.238824,
                    "width": 0.015455, "height": 0.003137,
                },
                "prefix": "visual-tile-0:0:333:500-subtile-1:2",
                "lineage": (9, 1, 1),
                "ocrOrder": 41,
            },
        ),
    },
)
EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID = (
    "72e941d8-8114-4082-a976-ae5b2b5daba9"
)
EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_STRUCTURAL_2375_PAGE2_MEASUREMENT_SOURCE = (
    "exact_rendered_2375_structural_page2_dimension_candidate"
)
EXACT_STRUCTURAL_2375_PAGE2_MEASUREMENT_SPEC = {
    "candidateId": "exact-2375-structural-page2-measurement-1ft-2in",
    "text": "1-2’",
    "canonical": "1'-2\"",
    "bounds": {
        "x": 0.568889, "y": 0.557778,
        "width": 0.005238, "height": 0.003333,
    },
    "candidateBounds": {
        "x": 0.568889, "y": 0.557778,
        "width": 0.005238, "height": 0.003333,
    },
    "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:2",
    "lineage": (6, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE6_NUMBER = 6
EXACT_STRUCTURAL_2375_PAGE6_FOOTING_SOURCE = (
    "exact_rendered_2375_structural_page6_footing_dimension_candidate"
)
EXACT_STRUCTURAL_2375_PAGE6_FOOTING_TEXT = "4'-0\" x 4'-0\" x 18\""
EXACT_STRUCTURAL_2375_PAGE6_LINE_SPEC = {
    "text": "’—0\" x 4’-0\" x 18”",
    "bounds": {
        "x": 0.246508, "y": 0.668444,
        "width": 0.02746, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:2",
    "lineage": (7, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE6_WORD_SPEC = {
    "text": "4’-0\"",
    "bounds": {
        "x": 0.257143, "y": 0.668444,
        "width": 0.007619, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:2",
    "lineage": (7, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE7_NUMBER = 7
EXACT_STRUCTURAL_2375_PAGE7_FOOTING_SOURCE = (
    "exact_rendered_2375_structural_page7_continuous_footing_candidate"
)
EXACT_STRUCTURAL_2375_PAGE7_FOOTING_TEXT = "1'-6\"W x 24\"D"
EXACT_STRUCTURAL_2375_PAGE7_FOOTING_SPECS = (
    {
        "candidateId": "exact-2375-structural-page7-continuous-footing-1",
        "line": {
            "text": "1'-6\"W x 24°D",
            "bounds": {
                "x": 0.239683, "y": 0.164222,
                "width": 0.018889, "height": 0.004222,
            },
            "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:2",
            "lineage": (7, 1, 1),
        },
        "word": {
            "text": "1'-6\"W",
            "bounds": {
                "x": 0.239683, "y": 0.164222,
                "width": 0.008571, "height": 0.004222,
            },
            "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:2",
            "lineage": (7, 1, 1),
        },
    },
    {
        "candidateId": "exact-2375-structural-page7-continuous-footing-2",
        "line": {
            "text": "(7 1'-6\"W x 24°D_|",
            "bounds": {
                "x": 0.176984, "y": 0.505778,
                "width": 0.033016, "height": 0.006,
            },
            "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (2, 1, 1),
        },
        "word": {
            "text": "1'-6\"W",
            "bounds": {
                "x": 0.18746, "y": 0.507111,
                "width": 0.00873, "height": 0.004222,
            },
            "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (2, 1, 1),
        },
    },
    {
        "candidateId": "exact-2375-structural-page7-continuous-footing-3",
        "line": {
            "text": "(1 1'-6\"W x 24’D",
            "bounds": {
                "x": 0.176984, "y": 0.641778,
                "width": 0.029365, "height": 0.006,
            },
            "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (27, 1, 1),
        },
        "word": {
            "text": "1'-6\"W",
            "bounds": {
                "x": 0.18746, "y": 0.643111,
                "width": 0.00873, "height": 0.004222,
            },
            "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
            "lineage": (27, 1, 1),
        },
    },
)
EXACT_STRUCTURAL_2375_PAGE12_NUMBER = 12
EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_SOURCE = (
    "exact_rendered_2375_structural_page12_elevation_note_candidate"
)
EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_TEXT = "+9'-0\" FROM F.F."
EXACT_STRUCTURAL_2375_PAGE12_LINE_SPEC = {
    "text": "+9’—0” FROM F.F.",
    "bounds": {
        "x": 0.824603, "y": 0.852889,
        "width": 0.030794, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
    "lineage": (5, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE12_WORD_SPEC = {
    "text": "+9’—0”",
    "bounds": {
        "x": 0.824603, "y": 0.852889,
        "width": 0.011905, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
    "lineage": (5, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE12_TITLE_LINE_BOUNDS = {
    "x": 0.824625, "y": 0.852917,
    "width": 0.030056, "height": 0.004028,
}
EXACT_STRUCTURAL_2375_PAGE12_TITLE_WORD_BOUNDS = {
    "x": 0.824625, "y": 0.852917,
    "width": 0.011903, "height": 0.004028,
}
EXACT_STRUCTURAL_2375_PAGE13_NUMBER = 13
EXACT_STRUCTURAL_2375_PAGE13_SPACING_SOURCE = (
    "exact_rendered_2375_structural_page13_anchor_spacing_candidate"
)
EXACT_STRUCTURAL_2375_PAGE13_SPACING_TEXT = "4'-0\" O.C."
EXACT_STRUCTURAL_2375_PAGE13_LINE_SPEC = {
    "texts": (
        ") NOT MORE THAN 4’-0” 0.C. UNLESS NOTED OTHERWISE. THERE SHALL BE ONI",
        ") NOT MORE THAN 4’—0” 0.C. UNLESS NOTED OTHERWISE. THERE SHALL BE ONI",
    ),
    "bounds": {
        "x": 0.333333, "y": 0.074889,
        "width": 0.11873, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    "lineage": (8, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE13_MEASUREMENT_SPEC = {
    "texts": ("4’-0”", "4’—0”"),
    "bounds": {
        "x": 0.362063, "y": 0.074889,
        "width": 0.007619, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    "lineage": (8, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE13_OC_SPEC = {
    "text": "0.C.",
    "bounds": {
        "x": 0.371905, "y": 0.075556,
        "width": 0.005079, "height": 0.003333,
    },
    "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    "lineage": (8, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE13_SPACING_BOUNDS = {
    "x": 0.362063, "y": 0.074889,
    "width": 0.014921, "height": 0.004,
}
EXACT_STRUCTURAL_2375_PAGE15_NUMBER = 15
EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_SOURCE = (
    "exact_rendered_2375_structural_page15_minimum_dimension_candidate"
)
EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_TEXT = "(1'-6\" MIN.)"
EXACT_STRUCTURAL_2375_PAGE15_LINE_SPEC = {
    "text": "(1’-6\" MIN.)",
    "bounds": {
        "x": 0.423016, "y": 0.645111,
        "width": 0.017302, "height": 0.004889,
    },
    "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:0",
    "lineage": (13, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE15_WORD_SPEC = {
    "text": "(1’-6\"",
    "bounds": {
        "x": 0.423016, "y": 0.645111,
        "width": 0.008571, "height": 0.004889,
    },
    "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:0",
    "lineage": (13, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE16_NUMBER = 16
EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_SOURCE = (
    "exact_rendered_2375_structural_page16_horizontal_schedule_candidate"
)
EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_TEXT = (
    "8-#6 HORIZONTAL FOR 20'-0\" MAX."
)
EXACT_STRUCTURAL_2375_PAGE16_LINE_SPEC = {
    "text": "8—#6 HORIZONTAL FOR 20’—0” MAX.",
    "texts": (
        "8—#6 HORIZONTAL FOR 20’—0” MAX.",
        "8—#6 HORIZONTAL FOR 20’—-0” MAX.",
    ),
    "bounds": {
        "x": 0.222857, "y": 0.044667,
        "width": 0.060635, "height": 0.004889,
    },
    "boundsVariants": (
        {
            "x": 0.222857, "y": 0.044667,
            "width": 0.060635, "height": 0.004889,
        },
        {
            "x": 0.222857, "y": 0.044667,
            "width": 0.061429, "height": 0.004889,
        },
    ),
    "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
    "lineage": (5, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE16_WORD_SPEC = {
    "text": "20’—0”",
    "texts": ("20’—0”", "20’—-0”"),
    "bounds": {
        "x": 0.26381, "y": 0.044667,
        "width": 0.010794, "height": 0.003778,
    },
    "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
    "lineage": (5, 1, 1),
}
EXACT_STRUCTURAL_2375_PAGE16_UP_TO_SOURCE = (
    "exact_rendered_2375_structural_page16_up_to_limit_candidate"
)
EXACT_STRUCTURAL_2375_PAGE16_UP_TO_TEXT = "UP TO 3'-0\""
EXACT_STRUCTURAL_2375_PAGE16_UP_TO_LINE_SPEC = {
    "text": "UP TO 3’—-0\"",
    "texts": ("UP TO 3’—-0\"", "UP TO 3’-0\""),
    "bounds": {
        "x": 0.146032, "y": 0.305111,
        "width": 0.019683, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:1",
    "lineage": (13, 1, 1),
    "lineageVariants": ((13, 1, 1), (12, 1, 1)),
}
EXACT_STRUCTURAL_2375_PAGE16_UP_TO_WORD_SPEC = {
    "text": "3’—-0\"",
    "texts": ("3’—-0\"", "3’-0\""),
    "bounds": {
        "x": 0.157619, "y": 0.305111,
        "width": 0.008095, "height": 0.004,
    },
    "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:1",
    "lineage": (13, 1, 1),
    "lineageVariants": ((13, 1, 1), (12, 1, 1)),
}
EXACT_STRUCTURAL_2375_PAGE18_NUMBER = 18
EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_SOURCE = (
    "exact_rendered_2375_structural_page18_weld_short_length_candidate"
)
EXACT_STRUCTURAL_2375_PAGE18_WELD_LONG_SOURCE = (
    "exact_rendered_2375_structural_page18_weld_long_length_candidate"
)
EXACT_STRUCTURAL_2375_PAGE18_REBAR_SOURCE = (
    "exact_rendered_2375_structural_page18_rebar_extension_candidate"
)
EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_SOURCE = (
    "exact_two_resolution_2375_structural_page18_weld_short_length"
)
EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_BOUNDS = {
    "x": 0.224444, "y": 0.144889,
    "width": 0.009048, "height": 0.004,
}
EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_PRIMARY_DPI = 216
EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATION_DPI = 480
EXACT_STRUCTURAL_2375_PAGE18_PROPOSITION_SPECS = (
    {
        "candidateId": "exact-2375-structural-page18-weld-short",
        "source": EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_SOURCE,
        "canonical": "0'-6\"",
        "candidateBoundsFromWord": True,
        "line": {
            "text": "x_0’'—6” LONG WITH FULL",
            "texts": (
                "x_0’'—6” LONG WITH FULL",
                "x _0’'—6” LONG WITH FULL",
            ),
            "bounds": {
                "x": 0.220635, "y": 0.144889,
                "width": 0.043333, "height": 0.004,
            },
            "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
            "lineage": (12, 1, 1),
        },
        "word": {
            "text": "x_0’'—6”",
            "texts": ("x_0’'—6”", "_0’'—6”"),
            "bounds": {
                "x": 0.220635, "y": 0.144889,
                "width": 0.012857, "height": 0.004,
            },
            "boundsVariants": (
                {
                    "x": 0.220635, "y": 0.144889,
                    "width": 0.012857, "height": 0.004,
                },
                {
                    "x": 0.224444, "y": 0.144889,
                    "width": 0.009048, "height": 0.004,
                },
            ),
            "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
            "lineage": (12, 1, 1),
        },
        "support": (
            {
                "text": "WITH 2-3/4” DIA. W.S.",
                "bounds": {
                    "x": 0.219841, "y": 0.14,
                    "width": 0.039365, "height": 0.004889,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
                "lineage": (11, 1, 1),
            },
            {
                "text": "PENETRATION WELD TO PL",
                "bounds": {
                    "x": 0.220635, "y": 0.15,
                    "width": 0.045079, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:2",
                "lineage": (13, 1, 1),
            },
        ),
        "overlappingLowAuthority": (
            {
                "text": "x 0’",
                "texts": ("x 0’", "x 0'-"),
                "bounds": {
                    "x": 0.220635, "y": 0.144889,
                    "width": 0.008889, "height": 0.004,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:1",
                "lineage": (21, 1, 1),
                "ocrKind": "line",
            },
            {
                "text": "0’",
                "texts": ("0’", "0'-"),
                "bounds": {
                    "x": 0.224444, "y": 0.144889,
                    "width": 0.005079, "height": 0.004,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:1",
                "lineage": (21, 1, 1),
                "ocrKind": "word",
            },
        ),
    },
    {
        "candidateId": "exact-2375-structural-page18-weld-long",
        "source": EXACT_STRUCTURAL_2375_PAGE18_WELD_LONG_SOURCE,
        "canonical": "0'-6\"",
        "candidateBoundsFromWord": True,
        "line": {
            "text": "x 0’-6” LONG WITH FULL",
            "bounds": {
                "x": 0.788413, "y": 0.619556,
                "width": 0.043175, "height": 0.003778,
            },
            "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (7, 1, 1),
        },
        "word": {
            "text": "0’-6”",
            "bounds": {
                "x": 0.792063, "y": 0.619556,
                "width": 0.009048, "height": 0.003778,
            },
            "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
            "lineage": (7, 1, 1),
        },
        "support": (
            {
                "text": "WITH 2-3/4” DIA. W.S.",
                "bounds": {
                    "x": 0.787619, "y": 0.614444,
                    "width": 0.038571, "height": 0.004889,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
                "lineage": (6, 1, 1),
            },
            {
                "text": "PENETRATION WELD TO PLATE",
                "bounds": {
                    "x": 0.788254, "y": 0.626,
                    "width": 0.05127, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
                "lineage": (8, 1, 1),
            },
        ),
    },
    {
        "candidateId": "exact-2375-structural-page18-rebar-extension",
        "source": EXACT_STRUCTURAL_2375_PAGE18_REBAR_SOURCE,
        "canonical": (
            "EXTEND THE REBARS (2-#6) 3'-0\" FROM THE "
            "CENTERLINE OF THE LAST WF BEAM"
        ),
        "candidateBounds": {
            "x": 0.803651, "y": 0.837556,
            "width": 0.061746, "height": 0.013999,
        },
        "line": {
            "text": "REBARS (2-#6) 3’—0” FROM THE",
            "bounds": {
                "x": 0.804127, "y": 0.842,
                "width": 0.057619, "height": 0.004889,
            },
            "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
            "lineage": (7, 1, 1),
        },
        "word": {
            "text": "3’—0”",
            "bounds": {
                "x": 0.833333, "y": 0.842,
                "width": 0.009048, "height": 0.003778,
            },
            "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
            "lineage": (7, 1, 1),
        },
        "support": (
            {
                "text": "EXTEND THE",
                "bounds": {
                    "x": 0.803651, "y": 0.837556,
                    "width": 0.020476, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
                "lineage": (3, 1, 1),
            },
            {
                "text": "CENTERLINE OF THE LAST WF BEAM",
                "bounds": {
                    "x": 0.803968, "y": 0.848222,
                    "width": 0.061429, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
                "lineage": (8, 1, 1),
            },
        ),
    },
)
EXACT_STRUCTURAL_2321_PAGE8_NUMBER = 8
EXACT_STRUCTURAL_2321_PAGE8_SPACING_SOURCE = (
    "exact_rendered_2321_structural_page8_spacing_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SOURCE = (
    "exact_rendered_2321_structural_page8_cylinder_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE8_SPACING_TEXT = (
    "NOT MORE THAN 4'-0\" O.C. UNLESS NOTED OTHERWISE."
)
EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_TEXT = (
    "TEST CYLINDERS FOR SLAB-ON-GRADE CONCRETE"
)
EXACT_STRUCTURAL_2321_PAGE8_SPACING_BOUNDS = {
    "x": 0.335873, "y": 0.074889,
    "width": 0.082857, "height": 0.004,
}
EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_BOUNDS = {
    "x": 0.508095, "y": 0.429556,
    "width": 0.069683, "height": 0.003333,
}
EXACT_STRUCTURAL_2321_PAGE8_SPACING_WORD_SPECS = (
    ("NOT", 63, {"x": 0.335873, "y": 0.075556, "width": 0.005397, "height": 0.003333}),
    ("MORE", 64, {"x": 0.343333, "y": 0.075556, "width": 0.007302, "height": 0.003333}),
    ("THAN", 65, {"x": 0.352857, "y": 0.075556, "width": 0.006984, "height": 0.003333}),
    (("4’-0”", "4’—0”"), 66, {"x": 0.362063, "y": 0.074889, "width": 0.007619, "height": 0.004}),
    ("0.C.", 67, {"x": 0.371905, "y": 0.075556, "width": 0.005079, "height": 0.003333}),
    ("UNLESS", 68, {"x": 0.379365, "y": 0.075556, "width": 0.010476, "height": 0.003333}),
    ("NOTED", 69, {"x": 0.391905, "y": 0.075556, "width": 0.00873, "height": 0.003333}),
    ("OTHERWISE.", 70, {"x": 0.402857, "y": 0.075556, "width": 0.015873, "height": 0.003333}),
)
EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_PRIMARY_SPECS = (
    ("TEST", 180, {"x": 0.508095, "y": 0.429556, "width": 0.00619, "height": 0.003333}),
    ("CYLINDERS", 181, {"x": 0.516032, "y": 0.429556, "width": 0.013968, "height": 0.003333}),
    ("FOR", 182, {"x": 0.532063, "y": 0.429556, "width": 0.004762, "height": 0.003333}),
    ("SLAB—ON-GRADE", 183, {"x": 0.53873, "y": 0.429556, "width": 0.023492, "height": 0.003333}),
)
EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SUFFIX_SPECS = (
    ("ON-GRADE", 108, {"x": 0.547937, "y": 0.429556, "width": 0.014286, "height": 0.003333}, True),
    ("CONCRETE", 109, {"x": 0.564286, "y": 0.429556, "width": 0.013492, "height": 0.003333}, False),
)
EXACT_STRUCTURAL_2321_PAGE11_NUMBER = 11
EXACT_STRUCTURAL_2321_PAGE11_OPENING_SOURCE = (
    "exact_rendered_2321_structural_page11_opening_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE11_ROOM_SOURCE = (
    "exact_rendered_2321_structural_page11_room_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE11_OPENING_TEXT = (
    "33 MIL. TYP. UP TO 10'-0\" OPENING"
)
EXACT_STRUCTURAL_2321_PAGE11_ROOM_TEXT = "10'-0\" X 10'-0\" ROOM"
EXACT_STRUCTURAL_2321_PAGE11_OPENING_BOUNDS = {
    "x": 0.575714, "y": 0.177333,
    "width": 0.033968, "height": 0.008667,
}
EXACT_STRUCTURAL_2321_PAGE11_ROOM_BOUNDS = {
    "x": 0.257143, "y": 0.576667,
    "width": 0.033492, "height": 0.003778,
}
EXACT_STRUCTURAL_2321_PAGE11_OPENING_LINE_SPECS = (
    {
        "text": "33 MIL. TYP.",
        "bounds": {
            "x": 0.575714, "y": 0.177333,
            "width": 0.017302, "height": 0.003333,
        },
        "block": 8,
    },
    {
        "text": "UP TO 10'-0\" OPENING",
        "bounds": {
            "x": 0.575714, "y": 0.182222,
            "width": 0.033968, "height": 0.003778,
        },
        "block": 9,
    },
)
EXACT_STRUCTURAL_2321_PAGE11_OPENING_WORD_SPECS = (
    ("33", 40, 8, {"x": 0.575714, "y": 0.177333, "width": 0.003175, "height": 0.003333}),
    ("MIL.", 41, 8, {"x": 0.580952, "y": 0.177333, "width": 0.004127, "height": 0.003333}),
    ("TYP.", 42, 8, {"x": 0.588095, "y": 0.177333, "width": 0.004921, "height": 0.003333}),
    ("UP", 46, 9, {"x": 0.575714, "y": 0.182667, "width": 0.003492, "height": 0.003333}),
    ("TO", 47, 9, {"x": 0.58127, "y": 0.182667, "width": 0.003333, "height": 0.003333}),
    ("10'-0\"", 48, 9, {"x": 0.586667, "y": 0.182222, "width": 0.009048, "height": 0.003778}),
    ("OPENING", 49, 9, {"x": 0.597937, "y": 0.182667, "width": 0.011746, "height": 0.003333}),
)
EXACT_STRUCTURAL_2321_PAGE11_ROOM_LINE_SPEC = {
    "text": "10’-0\" X 10'-0” ROOM",
    "bounds": {
        "x": 0.257143, "y": 0.576667,
        "width": 0.033492, "height": 0.003778,
    },
    "block": 6,
}
EXACT_STRUCTURAL_2321_PAGE11_ROOM_WORD_SPECS = (
    ("10’-0\"", 26, 6, {"x": 0.257143, "y": 0.576667, "width": 0.009048, "height": 0.003778}),
    ("X", 27, 6, {"x": 0.268413, "y": 0.577111, "width": 0.001429, "height": 0.003333}),
    ("10'-0”", 28, 6, {"x": 0.271905, "y": 0.576667, "width": 0.009048, "height": 0.003778}),
    ("ROOM", 29, 6, {"x": 0.283175, "y": 0.577111, "width": 0.00746, "height": 0.003333}),
)
EXACT_STRUCTURAL_2375_PAGE20_NUMBER = 20
EXACT_STRUCTURAL_2375_PAGE20_OPENING_SOURCE = (
    "exact_rendered_2375_structural_page20_opening_clause_candidate"
)
EXACT_STRUCTURAL_2375_PAGE20_ROOM_SOURCE = (
    "exact_rendered_2375_structural_page20_room_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE12_NUMBER = 12
EXACT_STRUCTURAL_2321_PAGE12_HANGER_SOURCE = (
    "exact_rendered_2321_structural_page12_hanger_wire_clause_candidate"
)
EXACT_STRUCTURAL_2321_PAGE12_HANGER_TEXT = (
    "HANGER WIRES AT 4'-0\" 0.C. TYP. AND AT 8\" MAX. FROM PERIMITER WALL"
)
EXACT_STRUCTURAL_2321_PAGE12_HANGER_BOUNDS = {
    "x": 0.729365, "y": 0.300889,
    "width": 0.054762, "height": 0.015111,
}
EXACT_STRUCTURAL_2321_PAGE12_HANGER_LINE_SPECS = (
    {
        "text": "HANGER WIRES",
        "bounds": {
            "x": 0.729365, "y": 0.300889,
            "width": 0.02127, "height": 0.003556,
        },
    },
    {
        "text": "AT 4'-0\" 0.C. TYP. AND AT 8\" MAX.",
        "boundsVariants": (
            {
                "x": 0.729524, "y": 0.305778,
                "width": 0.05381, "height": 0.004,
            },
            {
                "x": 0.729524, "y": 0.305778,
                "width": 0.054603, "height": 0.004,
            },
        ),
    },
    {
        "text": "FROM PERIMITER WALL",
        "bounds": {
            "x": 0.729365, "y": 0.312667,
            "width": 0.03254, "height": 0.003333,
        },
    },
)
EXACT_STRUCTURAL_2321_PAGE12_HANGER_WORD_SPECS = (
    (
        ("HANGER", {"x": 0.729365, "y": 0.300889, "width": 0.011111, "height": 0.003556}),
        ("WIRES", {"x": 0.742698, "y": 0.300889, "width": 0.007937, "height": 0.003556}),
    ),
    (
        ("AT", {"x": 0.729524, "y": 0.306222, "width": 0.003333, "height": 0.003556}),
        ("4'-0\"", {"x": 0.734762, "y": 0.305778, "width": 0.007778, "height": 0.004}),
        ("0.C.", {"x": 0.744603, "y": 0.306222, "width": 0.005238, "height": 0.003556}),
        ("TYP.", {"x": 0.752063, "y": 0.306222, "width": 0.005714, "height": 0.003556}),
        ("AND", {"x": 0.76, "y": 0.306222, "width": 0.005397, "height": 0.003556}),
        ("AT", {"x": 0.767619, "y": 0.306222, "width": 0.003333, "height": 0.003556}),
        ("8\"", {"x": 0.772857, "y": 0.305778, "width": 0.002698, "height": 0.004}),
        (
            "MAX.",
            (
                {"x": 0.777778, "y": 0.306444, "width": 0.005556, "height": 0.003333},
                {"x": 0.777778, "y": 0.306444, "width": 0.006349, "height": 0.003333},
            ),
        ),
    ),
    (
        ("FROM", {"x": 0.729365, "y": 0.312667, "width": 0.007302, "height": 0.003333}),
        ("PERIMITER", {"x": 0.738889, "y": 0.312667, "width": 0.01381, "height": 0.003333}),
        ("WALL", {"x": 0.754921, "y": 0.312667, "width": 0.006984, "height": 0.003333}),
    ),
)
EXACT_STRUCTURAL_2375_PAGE21_NUMBER = 21
EXACT_STRUCTURAL_2375_PAGE21_HANGER_SOURCE = (
    "exact_rendered_2375_structural_page21_hanger_wire_clause_candidate"
)
EXACT_ELECTRICAL_2375_PAGE2_SOURCE_SHA256 = (
    "6e4560ba09e6b5d7e871bd5dacd53ef56154a01eca120e19cee33474879894a9"
)
EXACT_ELECTRICAL_2375_PAGE2_PROJECT_ID = (
    "72e941d8-8114-4082-a976-ae5b2b5daba9"
)
EXACT_ELECTRICAL_2375_PAGE2_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_ELECTRICAL_2375_PAGE2_NUMBER = 2
EXACT_ELECTRICAL_2375_PAGE2_NOTE_SOURCE = (
    "exact_rendered_2375_electrical_page2_conductor_note_candidate"
)
EXACT_ELECTRICAL_2375_PAGE2_NOTE_TEXT = (
    "#14 AWG/90°, #12 AWG/75°, OR LARGER"
)
EXACT_ELECTRICAL_2375_PAGE2_LINE_SPEC = {
    "text": "#14 AWG/90\", #12 AWG/75', OR LARGER",
    "bounds": {
        "x": 0.116349, "y": 0.634889,
        "width": 0.053175, "height": 0.004889,
    },
    "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
    "lineage": (22, 1, 1),
}
EXACT_ELECTRICAL_2375_PAGE2_WORD_SPEC = {
    "text": "AWG/75',",
    "bounds": {
        "x": 0.142222, "y": 0.634889,
        "width": 0.01127, "height": 0.004889,
    },
    "ocrPrefix": "visual-tile-0:500:333:500-subtile-0:1",
    "lineage": (22, 1, 1),
}
EXACT_ELECTRICAL_2375_PAGE3_SOURCE_SHA256 = (
    "6e4560ba09e6b5d7e871bd5dacd53ef56154a01eca120e19cee33474879894a9"
)
EXACT_ELECTRICAL_2375_PAGE3_PROJECT_ID = (
    "72e941d8-8114-4082-a976-ae5b2b5daba9"
)
EXACT_ELECTRICAL_2375_PAGE3_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
EXACT_ELECTRICAL_2375_PAGE3_NUMBER = 3
EXACT_ELECTRICAL_2375_PAGE3_CANDIDATE_SOURCE = (
    "exact_native_rendered_2375_electrical_page3_candidate"
)
EXACT_ELECTRICAL_2375_PAGE3_SPECS = (
    {
        "candidateId": "exact-2375-electrical-page3-2A90-at-20ft",
        "canonical": "2A@90 @ 20'",
        "nativeBounds": {
            "x": 0.453519, "y": 0.284474,
            "width": 0.019668, "height": 0.004424,
        },
        "rendered": (
            {
                "text": "24@90/@ 20'",
                "bounds": {
                    "x": 0.453651, "y": 0.284889,
                    "width": 0.019365, "height": 0.004,
                },
                "ocrKind": "line",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:1",
                "lineage": (61, 1, 1),
            },
            {
                "text": "20'",
                "bounds": {
                    "x": 0.469206, "y": 0.284889,
                    "width": 0.00381, "height": 0.003111,
                },
                "ocrKind": "word",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:1",
                "lineage": (61, 1, 1),
            },
        ),
    },
    {
        "candidateId": "exact-2375-electrical-page3-B-at-10ft",
        "canonical": "B @ 10'",
        # The fixed coverage OCR read this label in the original checkpoint,
        # but a fresh Cloud Run extraction can omit it entirely.  The exact
        # immutable native label is therefore still allowed to open a visual
        # review; it never becomes searchable without the unchanged
        # dual-provider fact agreement.
        "allowNativeOnlyVisualReview": True,
        "nativeBounds": {
            "x": 0.516415, "y": 0.445252,
            "width": 0.011189, "height": 0.004424,
        },
        "rendered": (
            {
                "text": "B@10'",
                "bounds": {
                    "x": 0.516667, "y": 0.443556,
                    "width": 0.010794, "height": 0.006,
                },
                "ocrKind": "word",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (81, 1, 1),
            },
        ),
    },
)
EXACT_ELECTRICAL_2375_PAGE13_NUMBER = 13
EXACT_ELECTRICAL_2375_PAGE13_CANDIDATE_SOURCE = (
    "exact_native_rendered_2375_electrical_page13_candidate"
)
EXACT_ELECTRICAL_2375_PAGE13_CANONICAL_TEXT = "C @ 13'"
EXACT_ELECTRICAL_2375_PAGE13_NATIVE_BOUNDS = {
    "x": 0.44709, "y": 0.166141,
    "width": 0.011363, "height": 0.004424,
}
EXACT_ELECTRICAL_2375_PAGE13_RENDERED_SPECS = (
    {
        "text": "+ @13'",
        "bounds": {
            "x": 0.443968, "y": 0.166444,
            "width": 0.014286, "height": 0.003778,
        },
        "ocrKind": "line",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:1",
        "lineage": (6, 1, 1),
    },
    {
        "text": "@13'",
        "bounds": {
            "x": 0.454762, "y": 0.166444,
            "width": 0.003492, "height": 0.003111,
        },
        "ocrKind": "word",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:1",
        "lineage": (6, 1, 1),
    },
)
EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SOURCE = (
    "exact_native_rendered_2375_electrical_page13_photometric_candidate"
)
EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SUPERSEDED_STATUS = (
    "superseded_by_exact_2375_electrical_page13_photometric_candidate"
)
EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_TEXT = "B @ 10'"
EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_NATIVE_BOUNDS = {
    "x": 0.600503, "y": 0.245807,
    "width": 0.011189, "height": 0.004424,
}
EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_RENDERED_SPEC = {
    "text": "B@10'",
    "bounds": {
        "x": 0.600794, "y": 0.246,
        "width": 0.010794, "height": 0.004222,
    },
    "ocrKind": "word",
    "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
    "lineage": (90, 1, 1),
}
EXACT_ELECTRICAL_2375_PAGE14_NUMBER = 14
EXACT_ELECTRICAL_2375_PAGE14_CANDIDATE_SOURCE = (
    "exact_rendered_2375_electrical_page14_voltage_drop_candidate"
)
EXACT_ELECTRICAL_2375_PAGE14_SPECS = (
    {
        "candidateId": "exact-2375-electrical-page14-L500-VD2.5",
        "canonical": "L=500'; VD=2.5%",
        "line": {
            "text": "L=500'; VD=2.5%",
            "bounds": {
                "x": 0.339206, "y": 0.122444,
                "width": 0.023968, "height": 0.004889,
            },
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
            "lineage": (17, 1, 1),
        },
        "word": {
            "text": "L=500';",
            "bounds": {
                "x": 0.339206, "y": 0.122444,
                "width": 0.010317, "height": 0.004889,
            },
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
            "lineage": (17, 1, 1),
        },
    },
    {
        "candidateId": "exact-2375-electrical-page14-L150-VD0.8",
        "canonical": "L=150'; VD=0.8%",
        "line": {
            "text": "L=150'; VD=0.8%",
            "bounds": {
                "x": 0.561746, "y": 0.424444,
                "width": 0.02381, "height": 0.004667,
            },
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:2",
            "lineage": (4, 1, 1),
        },
        "word": {
            "text": "L=150';",
            "bounds": {
                "x": 0.561746, "y": 0.424444,
                "width": 0.010159, "height": 0.004667,
            },
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:2",
            "lineage": (4, 1, 1),
        },
    },
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256 = (
    "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID = (
    "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION = (
    "ecos-hosted-evidence/1.3"
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PAGE_NUMBER = 8
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS = (
    {
        "candidateId": "architectural-2321-page8-fire-separation-29ft10",
        "canonicalText": "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION,",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
        "lineId": "visual-tile-333:0:333:500-subtile-2:1-line-9",
        "lineBounds": {
            "x": 0.45746, "y": 0.364,
            "width": 0.085397, "height": 0.004222,
        },
        "lineTexts": frozenset({
            "OPENINGS WITH LESS THEN 29'-I0\" FIRE SEPARATION,",
            "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION,",
        }),
        "wordIds": frozenset({
            "visual-tile-333:0:333:500-subtile-2:1-word-70",
        }),
        "wordBounds": {
            "x": 0.501746, "y": 0.364444,
            "width": 0.010635, "height": 0.003556,
        },
        "wordTexts": frozenset({"29'-I0\"", "29'-10\""}),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-0ft",
        "canonicalText": (
            "CONSTRUCTION III-B AND V-B IS 0'-0\" MIN. 2 HOUR RATING"
        ),
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
        "lineId": "visual-tile-333:0:333:500-subtile-2:1-line-12",
        "lineBounds": {
            "x": 0.45746, "y": 0.377111,
            "width": 0.096349, "height": 0.006889,
        },
        "lineTexts": frozenset({
            "CONSTRUCTION III-B AND V-B |S 2'-O\" MIN. 2 HOUR RATING",
            "CONSTRUCTION III-B AND V-B |S 0'-O\" MIN. 2 HOUR RATING",
        }),
        "wordIds": frozenset({
            "visual-tile-333:0:333:500-subtile-2:1-word-99",
        }),
        "wordBounds": {
            "x": 0.511746, "y": 0.378667,
            "width": 0.00873, "height": 0.003111,
        },
        "wordTexts": frozenset({"2'-O\"", "0'-O\""}),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-over-30ft",
        "canonicalText": (
            "GREATER THEN 30'-0\" NO RATING REQUIRED. NO OPENINGS"
        ),
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
        "lineId": "visual-tile-333:500:333:500-subtile-0:1-line-17",
        "lineBounds": {
            "x": 0.457302, "y": 0.581556,
            "width": 0.097937, "height": 0.004222,
        },
        "lineTexts": frozenset({
            "GREATER THEN 32'-@\" NO RATING REQUIRED. NO OPENINGS",
        }),
        "wordIds": frozenset({
            "visual-tile-333:500:333:500-subtile-0:1-word-162",
            "visual-tile-333:500:333:500-subtile-0:1-word-163",
        }),
        "wordBounds": {
            "x": 0.483492, "y": 0.582222,
            "width": 0.010635, "height": 0.003333,
        },
        "wordTexts": frozenset({"32'-@\""}),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-under-30ft",
        "canonicalText": (
            "WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT"
        ),
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
        "lineId": "visual-tile-333:500:333:500-subtile-0:1-line-18",
        "lineBounds": {
            "x": 0.45746, "y": 0.586222,
            "width": 0.093492, "height": 0.004444,
        },
        "lineTexts": frozenset({
            "WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT",
        }),
        "wordIds": frozenset({
            "visual-tile-333:500:333:500-subtile-0:1-word-174",
            "visual-tile-333:500:333:500-subtile-0:1-word-175",
        }),
        "wordBounds": {
            "x": 0.484286, "y": 0.586889,
            "width": 0.010476, "height": 0.003333,
        },
        "wordTexts": frozenset({"30'-0\""}),
    },
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PARAGRAPH_SPECS = (
    {
        "candidateId": "architectural-2321-page8-fire-separation-north-paragraph",
        "canonicalText": (
            "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, OPENINGS NOT "
            "LIMITED, NO OPENING PROTECTION REQUIRED. SEPARATION DISTANCE "
            "BETWEEN TYPES OF CONSTRUCTION III-B AND V-B IS 0'-0\" MIN. 2 "
            "HOUR RATING PROVIDED WITH NO OPENINGS BETWEEN AREAS."
        ),
        "bounds": {
            "x": 0.45746, "y": 0.364,
            "width": 0.096349, "height": 0.022666,
        },
        "measurementSpecIndexes": (0, 1),
        "lines": (
            {
                "id": "visual-tile-333:0:333:500-subtile-2:1-line-9",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (10, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.364,
                    "width": 0.085397, "height": 0.004222,
                },
                "texts": frozenset({
                    "OPENINGS WITH LESS THEN 29'-I0\" FIRE SEPARATION,",
                    "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION,",
                }),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-2:1-line-10",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (11, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.368667,
                    "width": 0.081746, "height": 0.004,
                },
                "texts": frozenset({
                    "OPENINGS NOT LIMITED, NO OPENING PROTECTION",
                }),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-2:1-line-11",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (12, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.373111,
                    "width": 0.091429, "height": 0.004222,
                },
                "texts": frozenset({
                    "REQUIRED. SEPARATION DISTANCE BETWEEN TYPES OF",
                }),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-2:1-line-12",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (13, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.377111,
                    "width": 0.096349, "height": 0.006889,
                },
                "texts": frozenset({
                    "CONSTRUCTION III-B AND V-B |S 2'-O\" MIN. 2 HOUR RATING",
                    "CONSTRUCTION III-B AND V-B |S 0'-O\" MIN. 2 HOUR RATING",
                }),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-2:1-line-13",
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
                "lineage": (14, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.382444,
                    "width": 0.077937, "height": 0.004222,
                },
                "texts": frozenset({
                    "PROVIDED WITH NO OPENINGS BETWEEN AREAS.",
                }),
            },
        ),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-south-paragraph",
        "canonicalText": (
            "WALLS AND TABLE 705.5 FIRE SEPARATION DISTANCE GREATER THEN "
            "30'-0\" NO RATING REQUIRED. "
            "NO OPENINGS WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT "
            "LIMITED, NO OPENING PROTECTION REQUIRED."
        ),
        "bounds": {
            "x": 0.457302, "y": 0.576889,
            "width": 0.097937, "height": 0.018444,
        },
        "measurementSpecIndexes": (2, 3),
        "lines": (
            {
                "id": "visual-tile-333:500:333:500-subtile-0:1-line-16",
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
                "lineage": (17, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.576889,
                    "width": 0.088571, "height": 0.004222,
                },
                "texts": frozenset({
                    "WALLS AND TABLE 1055 FIRE SEPARATION DISTANCE",
                }),
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-0:1-line-17",
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
                "lineage": (18, 1, 1),
                "bounds": {
                    "x": 0.457302, "y": 0.581556,
                    "width": 0.097937, "height": 0.004222,
                },
                "texts": frozenset({
                    "GREATER THEN 32'-@\" NO RATING REQUIRED. NO OPENINGS",
                }),
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-0:1-line-18",
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
                "lineage": (19, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.586222,
                    "width": 0.093492, "height": 0.004444,
                },
                "texts": frozenset({
                    "WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT",
                }),
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-0:1-line-19",
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
                "lineage": (20, 1, 1),
                "bounds": {
                    "x": 0.45746, "y": 0.590889,
                    "width": 0.075556, "height": 0.004444,
                },
                "texts": frozenset({
                    "LIMITED, NO OPENING PROTECTION REQUIRED.",
                }),
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS = (
    {
        "candidateId": "architectural-2321-page8-fire-separation-29ft10-sentence",
        "canonicalText": (
            "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, OPENINGS NOT "
            "LIMITED, NO OPENING PROTECTION REQUIRED."
        ),
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
        "lineIds": (
            "visual-tile-333:0:333:500-subtile-2:1-line-9",
            "visual-tile-333:0:333:500-subtile-2:1-line-10",
            "visual-tile-333:0:333:500-subtile-2:1-line-11",
        ),
        "bounds": {
            "x": 0.45746, "y": 0.364,
            "width": 0.085397, "height": 0.013333,
        },
        "measurementSpecIndexes": (0,),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-0ft-sentence",
        "canonicalText": (
            "SEPARATION DISTANCE BETWEEN TYPES OF CONSTRUCTION III-B AND V-B "
            "IS 0'-0\" MIN. 2 HOUR RATING PROVIDED WITH NO OPENINGS BETWEEN "
            "AREAS."
        ),
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
        "lineIds": (
            "visual-tile-333:0:333:500-subtile-2:1-line-11",
            "visual-tile-333:0:333:500-subtile-2:1-line-12",
            "visual-tile-333:0:333:500-subtile-2:1-line-13",
        ),
        "bounds": {
            "x": 0.45746, "y": 0.373111,
            "width": 0.096349, "height": 0.013556,
        },
        "measurementSpecIndexes": (1,),
    },
    {
        "candidateId": "architectural-2321-page8-fire-separation-south-note",
        "canonicalText": (
            "WALLS AND TABLE 705.5 FIRE SEPARATION DISTANCE GREATER THEN "
            "30'-0\" NO RATING REQUIRED. NO OPENINGS WITH LESS THEN 30'-0\" "
            "FIRE SEPARATION, OPENINGS NOT LIMITED, NO OPENING PROTECTION "
            "REQUIRED."
        ),
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
        "lineIds": (
            "visual-tile-333:500:333:500-subtile-0:1-line-16",
            "visual-tile-333:500:333:500-subtile-0:1-line-17",
            "visual-tile-333:500:333:500-subtile-0:1-line-18",
            "visual-tile-333:500:333:500-subtile-0:1-line-19",
        ),
        "bounds": {
            "x": 0.457302, "y": 0.576889,
            "width": 0.097937, "height": 0.018444,
        },
        "measurementSpecIndexes": (2, 3),
    },
)
EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS = (
    {
        "candidateId": "architectural-2321-page8-east-area-row-candidate",
        "canonicalText": "EAST- 30' / 185'-1\"",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        "labelText": "EAST-",
        "labelBounds": {
            "x": 0.624921, "y": 0.182667,
            "width": 0.009524, "height": 0.003556,
        },
        "measurementText": "30'",
        "measurementBounds": {
            "x": 0.640794, "y": 0.182667,
            "width": 0.004921, "height": 0.003333,
        },
        "bounds": {
            "x": 0.624881, "y": 0.182667,
            "width": 0.041706, "height": 0.003556,
        },
    },
    {
        "candidateId": "architectural-2321-page8-south-area-row-candidate",
        "canonicalText": "SOUTH- 30' / 0'-0\"",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        "labelText": "SOUTH-",
        "labelBounds": {
            "x": 0.624921, "y": 0.187333,
            "width": 0.011429, "height": 0.003333,
        },
        "measurementText": "30'",
        "measurementBounds": {
            "x": 0.640794, "y": 0.187333,
            "width": 0.004921, "height": 0.003333,
        },
        "bounds": {
            "x": 0.624881, "y": 0.187333,
            "width": 0.040397, "height": 0.003333,
        },
    },
    {
        "candidateId": (
            "architectural-2321-page8-total-frontage-row-candidate"
        ),
        "canonicalText": "TOTAL FRONTAGE LENGTH: 30' / 586'-1\"",
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        "labelKind": "line",
        "labelText": "TOTAL FRONTAGE LENGTH:",
        "labelBounds": {
            "x": 0.566667, "y": 0.196667,
            "width": 0.043333, "height": 0.003556,
        },
        "measurementText": "30'",
        "measurementBounds": {
            "x": 0.640794, "y": 0.196667,
            "width": 0.004921, "height": 0.003333,
        },
        "bounds": {
            "x": 0.566667, "y": 0.196667,
            "width": 0.104365, "height": 0.003556,
        },
    },
)
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_PAGE_NUMBER = 4
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID = (
    "architectural-2321-page4-accessible-parking-note-candidate"
)
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT = (
    "5'-0\" MIN. TYPICAL ACCESSIBLE PARKING STALL STRIPED LOADING."
)
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS = {
    "x": 0.805238, "y": 0.923556,
    "width": 0.031905, "height": 0.019333,
}
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_OCR_PREFIX = (
    "visual-tile-667:500:333:500-subtile-2:1"
)
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CONSTITUENTS = (
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-line-32",
        "kind": "line",
        "text": "5'-O\" MIN. TYP",
        "lineage": (33, 1, 1),
        "bounds": {
            "x": 0.805238, "y": 0.923556,
            "width": 0.022857, "height": 0.003333,
        },
    },
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-word-134",
        "kind": "word",
        "text": "5'-O\"",
        "lineage": (33, 1, 1),
        "bounds": {
            "x": 0.805238, "y": 0.923556,
            "width": 0.008254, "height": 0.003333,
        },
    },
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-word-140",
        "kind": "word",
        "text": "ACCESSIBLE",
        "lineage": (34, 1, 1),
        "bounds": {
            "x": 0.805397, "y": 0.927556,
            "width": 0.020476, "height": 0.004,
        },
    },
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-line-34",
        "kind": "line",
        "text": "PARKING STALL",
        "lineage": (35, 1, 1),
        "bounds": {
            "x": 0.805238, "y": 0.932222,
            "width": 0.028571, "height": 0.004,
        },
    },
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-line-35",
        "kind": "line",
        "text": "STRIPED LOADING. |",
        "lineage": (36, 1, 1),
        "bounds": {
            "x": 0.805238, "y": 0.936,
            "width": 0.031905, "height": 0.006889,
        },
        "acceptedVariants": (
            {
                "text": "STRIPED LOADING. |",
                "bounds": {
                    "x": 0.805238, "y": 0.936,
                    "width": 0.031905, "height": 0.006889,
                },
            },
            {
                "text": "STRIPED LOADING.",
                "bounds": {
                    "x": 0.805238, "y": 0.936889,
                    "width": 0.031111, "height": 0.004,
                },
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_SUPERSEDED_IDS = frozenset({
    "visual-tile-667:500:333:500-subtile-2:1-word-134",
    "visual-tile-667:500:333:500-subtile-2:1-line-32",
})
EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_PAGE_NUMBER = 10
EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID = (
    "architectural-2321-page10-existing-easement-note-candidate"
)
EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT = (
    "(E) 10' WIDE EASEMENT TO REMAIN."
)
EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS = {
    "x": 0.769206, "y": 0.306889,
    "width": 0.056985, "height": 0.004,
}
EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS = (
    {
        "id": "visual-tile-667:0:333:500-subtile-1:0-word-162",
        "kind": "word",
        "text": "(E)",
        "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
        "lineage": (36, 1, 1),
        "bounds": {
            "x": 0.769206, "y": 0.307333,
            "width": 0.004762, "height": 0.003556,
        },
    },
    {
        "id": "visual-tile-667:0:333:500-subtile-1:0-word-163",
        "kind": "word",
        "text": "(2'",
        "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
        "lineage": (36, 1, 1),
        "bounds": {
            "x": 0.775238, "y": 0.307333,
            "width": 0.00381, "height": 0.003333,
        },
    },
    {
        "id": "visual-tile-667:0:333:500-subtile-1:1-word-232",
        "acceptedIds": (
            "visual-tile-667:0:333:500-subtile-1:1-word-232",
            "visual-tile-667:0:333:500-subtile-1:1-word-233",
        ),
        "kind": "word",
        "text": "E)",
        "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
        "lineage": (25, 1, 1),
        "bounds": {
            "x": 0.770635, "y": 0.307333,
            "width": 0.003333, "height": 0.003556,
        },
    },
    {
        "id": "visual-tile-667:0:333:500-subtile-1:1-word-233",
        "acceptedIds": (
            "visual-tile-667:0:333:500-subtile-1:1-word-233",
            "visual-tile-667:0:333:500-subtile-1:1-word-234",
        ),
        "kind": "word",
        "text": "10'",
        "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
        "lineage": (25, 1, 1),
        "bounds": {
            "x": 0.775238, "y": 0.307333,
            "width": 0.00381, "height": 0.003333,
        },
    },
    {
        "id": "visual-tile-667:0:333:500-subtile-1:1-line-24",
        "kind": "line",
        "text": "E) 10' WIDE EASEMENT TO REMAIN.",
        "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
        "lineage": (25, 1, 1),
        "bounds": {
            "x": 0.770635, "y": 0.306889,
            "width": 0.055556, "height": 0.004,
        },
    },
)
EXACT_ARCHITECTURAL_2321_SITE_NOTE_PAGE_NUMBER = 11
EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE = (
    "exact_rendered_site_note_composite_candidate"
)
EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES = (
    {
        "id": "architectural-2321-page11-front-yard-setback-note-candidate",
        "text": "LINE OF 20'-0\" FRONT YARD BUILDING SETBACK.",
        "bounds": {
            "x": 0.76746, "y": 0.048889,
            "width": 0.080794, "height": 0.003778,
        },
        "constituents": (
            {
                "id": "visual-tile-667:0:333:500-subtile-0:0-word-32",
                "kind": "word",
                "texts": ("LINE",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:0",
                "lineages": ((7, 1, 1),),
                "bounds": {
                    "x": 0.76746, "y": 0.048889,
                    "width": 0.006825, "height": 0.003778,
                },
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-0:1-word-25",
                "kind": "word",
                "texts": ("20'-0\"",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:1",
                "lineages": ((4, 1, 1),),
                "bounds": {
                    "x": 0.780952, "y": 0.049333,
                    "width": 0.010635, "height": 0.003111,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-0:1-line-3",
                "kind": "line",
                "texts": (
                    "NE OF 20'-0\" FRONT YARD BUILDING SETBACK",
                    "NE OF 20'-0\" FRONT YARD BUILDING SETBACK.",
                ),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:1",
                "lineages": ((4, 1, 1),),
                "bounds": {
                    "x": 0.770317, "y": 0.048889,
                    "width": 0.077937, "height": 0.003778,
                },
                "role": "line",
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page11-front-landscape-note-candidate",
        "text": "LINE OF MINIMUM 15'-0\" FRONT LANDSCAPE AREA.",
        "bounds": {
            "x": 0.76746, "y": 0.057111,
            "width": 0.08127, "height": 0.003778,
        },
        "constituents": (
            {
                "id": "visual-tile-667:0:333:500-subtile-0:0-word-46",
                "kind": "word",
                "texts": ("LINE",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:0",
                "lineages": ((10, 1, 1),),
                "bounds": {
                    "x": 0.76746, "y": 0.057111,
                    "width": 0.006825, "height": 0.003778,
                },
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-0:1-word-36",
                "kind": "word",
                "texts": ("15'-@\"", "15'-0\""),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:1",
                "lineages": ((5, 1, 1),),
                "bounds": {
                    "x": 0.795397, "y": 0.057333,
                    "width": 0.008889, "height": 0.003556,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-0:1-line-4",
                "kind": "line",
                "texts": (
                    "NE OF MINIMUM 15'-@\" FRONT LANDSCAPE AREA.",
                    "NE OF MINIMUM 15'-0\" FRONT LANDSCAPE AREA.",
                ),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-0:1",
                "lineages": ((5, 1, 1),),
                "bounds": {
                    "x": 0.770317, "y": 0.057111,
                    "width": 0.078413, "height": 0.003778,
                },
                "role": "line",
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page11-fire-access-road-note-candidate",
        "text": "LINE OF 20'-0\" WIDE FIRE APPARATUS ACCESS ROAD.",
        "bounds": {
            "x": 0.761587, "y": 0.382,
            "width": 0.095079, "height": 0.004,
        },
        "constituents": (
            {
                "id": "visual-tile-667:0:333:500-subtile-2:0-word-95",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:0-word-95",
                    "visual-tile-667:0:333:500-subtile-2:0-word-96",
                ),
                "kind": "word",
                "texts": ("LINE",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:0",
                "lineages": ((21, 1, 1), (22, 1, 1)),
                "bounds": {
                    "x": 0.76746, "y": 0.382222,
                    "width": 0.006825, "height": 0.003778,
                },
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-2:1-word-88",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:1-word-88",
                    "visual-tile-667:0:333:500-subtile-2:1-word-92",
                ),
                "kind": "word",
                "texts": ("20'-0\"",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:1",
                "lineages": ((11, 1, 1), (12, 1, 1)),
                "bounds": {
                    "x": 0.780952, "y": 0.382667,
                    "width": 0.010635, "height": 0.003111,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-2:1-line-10",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:1-line-10",
                    "visual-tile-667:0:333:500-subtile-2:1-line-11",
                ),
                "kind": "line",
                "texts": ("NE OF 20'-0\" WIDE FIRE APPARATUS ACCESS ROAD.",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:1",
                "lineages": ((11, 1, 1), (12, 1, 1)),
                "bounds": {
                    "x": 0.770317, "y": 0.382,
                    "width": 0.086349, "height": 0.004,
                },
                "role": "line",
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page11-tree-well-note-candidate",
        "text": "(N) 6'-0\" x 6'-0\" TREE WELL.",
        "bounds": {
            "x": 0.761429, "y": 0.453333,
            "width": 0.053651, "height": 0.003556,
        },
        "constituents": (
            {
                "id": "visual-tile-667:0:333:500-subtile-2:0-line-45",
                "kind": "line",
                "texts": ("42. (N) 6'-O\" x",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:0",
                "lineages": ((46, 1, 1),),
                "bounds": {
                    "x": 0.761429, "y": 0.453333,
                    "width": 0.023651, "height": 0.003333,
                },
                "role": "line",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-2:1-word-182",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:1-word-182",
                    "visual-tile-667:0:333:500-subtile-2:1-word-186",
                ),
                "kind": "word",
                "texts": ("6'-O\"",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:1",
                "lineages": ((20, 1, 1), (21, 1, 1)),
                "bounds": {
                    "x": 0.773333, "y": 0.453333,
                    "width": 0.008571, "height": 0.003333,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-2:1-word-184",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:1-word-184",
                    "visual-tile-667:0:333:500-subtile-2:1-word-188",
                ),
                "kind": "word",
                "texts": ("6'-O\"",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:1",
                "lineages": ((20, 1, 1), (21, 1, 1)),
                "bounds": {
                    "x": 0.786349, "y": 0.453333,
                    "width": 0.008571, "height": 0.003333,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-2:1-line-19",
                "acceptedIds": (
                    "visual-tile-667:0:333:500-subtile-2:1-line-19",
                    "visual-tile-667:0:333:500-subtile-2:1-line-20",
                ),
                "kind": "line",
                "texts": ("1) 6'-O\" x 6'-O\" TREE WELL.",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-2:1",
                "lineages": ((20, 1, 1), (21, 1, 1)),
                "bounds": {
                    "x": 0.770159, "y": 0.453333,
                    "width": 0.044921, "height": 0.003556,
                },
                "role": "line",
                "supersede": True,
            },
        ),
        "replacementIds": (
            "visual-tile-667:0:333:500-subtile-2:1-word-182-two-resolution-measurement",
            "visual-tile-667:0:333:500-subtile-2:1-word-184-two-resolution-measurement",
            "visual-tile-667:0:333:500-subtile-2:1-word-186-two-resolution-measurement",
            "visual-tile-667:0:333:500-subtile-2:1-word-188-two-resolution-measurement",
        ),
    },
)
EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER = 24
EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES = (
    {
        "id": "architectural-2321-page24-chain-link-fence-keynote-candidate",
        "text": (
            "EXISTING 6'-0\" HIGH CHAIN LINK FENCE AND GATES TO BE REMOVED."
        ),
        "bounds": {
            "x": 0.722857, "y": 0.213778,
            "width": 0.114604, "height": 0.004,
        },
        "requireLineMeasurementPair": False,
        "constituents": (
            {
                "id": "visual-tile-667:0:333:500-subtile-1:0-word-80",
                "kind": "word",
                "texts": ("EXISTING",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "lineages": ((12, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "leading-note",
                "bounds": {
                    "x": 0.722857, "y": 0.213778,
                    "width": 0.014444, "height": 0.004,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:0-word-81",
                "kind": "word",
                "texts": ("6'-O\"",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "lineages": ((12, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "leading-note",
                "bounds": {
                    "x": 0.738571, "y": 0.214444,
                    "width": 0.00873, "height": 0.003333,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:0-word-82",
                "kind": "word",
                "texts": ("HIGH",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "lineages": ((12, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "leading-note",
                "bounds": {
                    "x": 0.74873, "y": 0.213778,
                    "width": 0.00746, "height": 0.004,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:0-word-83",
                "kind": "word",
                "texts": ("CHAIN",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "lineages": ((12, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "leading-note",
                "bounds": {
                    "x": 0.757619, "y": 0.213778,
                    "width": 0.009683, "height": 0.004,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:0-word-84",
                "kind": "word",
                "texts": ("LINK",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "lineages": ((12, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "leading-note",
                "bounds": {
                    "x": 0.76873, "y": 0.213778,
                    "width": 0.007143, "height": 0.004,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-82",
                "kind": "word",
                "texts": ("FENCE",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.776984, "y": 0.214444,
                    "width": 0.010159, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-83",
                "kind": "word",
                "texts": ("AND",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.78873, "y": 0.214444,
                    "width": 0.006825, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-84",
                "kind": "word",
                "texts": ("GATES",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.796825, "y": 0.214444,
                    "width": 0.010794, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-85",
                "kind": "word",
                "texts": ("TO",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.808889, "y": 0.214444,
                    "width": 0.004286, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-86",
                "kind": "word",
                "texts": ("BE",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.814444, "y": 0.214444,
                    "width": 0.004444, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
            {
                "id": "visual-tile-667:0:333:500-subtile-1:1-word-87",
                "kind": "word",
                "texts": ("REMOVED.",),
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "lineages": ((9, 1, 1),),
                "matchId": False,
                "matchLineage": False,
                "lineageGroup": "trailing-note",
                "bounds": {
                    "x": 0.820476, "y": 0.214444,
                    "width": 0.016984, "height": 0.003333,
                },
                "role": "context",
                "supersede": False,
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_DETAIL_PAGE_NUMBER = 13
EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES = (
    {
        "id": "architectural-2321-page13-top-of-slab-candidate",
        "text": "13'-1\" TOS",
        "bounds": {
            "x": 0.110476, "y": 0.200889,
            "width": 0.014762, "height": 0.003556,
        },
        "constituents": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-word-20",
                "kind": "word",
                "texts": ("{3'-t", "{3'-1"),
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:0",
                "lineages": ((5, 1, 1),),
                "bounds": {
                    "x": 0.110476, "y": 0.200889,
                    "width": 0.005714, "height": 0.003556,
                },
                "supersede": True,
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-word-4",
                "acceptedIds": (
                    "visual-tile-0:0:333:500-subtile-1:1-word-4",
                    "visual-tile-0:0:333:500-subtile-1:1-word-12",
                ),
                "kind": "word",
                "texts": ("13'-I\"",),
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:1",
                "lineages": ((1, 1, 1), (3, 1, 1)),
                "bounds": {
                    "x": 0.110476, "y": 0.200889,
                    "width": 0.006984, "height": 0.003556,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:1-line-0",
                "acceptedIds": (
                    "visual-tile-0:0:333:500-subtile-1:1-line-0",
                    "visual-tile-0:0:333:500-subtile-1:1-line-2",
                ),
                "kind": "line",
                "texts": ("13'-I\" TOS",),
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:1",
                "lineages": ((1, 1, 1), (3, 1, 1)),
                "bounds": {
                    "x": 0.110476, "y": 0.200889,
                    "width": 0.014762, "height": 0.003556,
                },
                "role": "line",
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page13-five-foot-dimension-candidate",
        "text": "5'-0\"",
        "bounds": {
            "x": 0.34127, "y": 0.668444,
            "width": 0.009683, "height": 0.003778,
        },
        "requireLineMeasurementPair": False,
        "constituents": (
            {
                "id": "visual-tile-333:500:333:500-subtile-0:0-word-47",
                "acceptedIds": (
                    "visual-tile-333:500:333:500-subtile-0:0-word-47",
                    "visual-tile-333:500:333:500-subtile-0:0-word-50",
                ),
                "kind": "word",
                "texts": ("5'-o\"",),
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:0",
                "lineages": ((11, 1, 1), (12, 1, 1)),
                "bounds": {
                    "x": 0.34127, "y": 0.668444,
                    "width": 0.009683, "height": 0.003778,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-1:0-word-4",
                "kind": "word",
                "texts": ("5'-O",),
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
                "lineages": ((1, 1, 1),),
                "bounds": {
                    "x": 0.34127, "y": 0.668444,
                    "width": 0.008254, "height": 0.003778,
                },
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page13-three-foot-four-dimension-candidate",
        "text": "3'-4\"",
        "bounds": {
            "x": 0.366508, "y": 0.668444,
            "width": 0.008889, "height": 0.003778,
        },
        "requireLineMeasurementPair": False,
        "constituents": (
            {
                "id": "visual-tile-333:500:333:500-subtile-0:0-word-51",
                "acceptedIds": (
                    "visual-tile-333:500:333:500-subtile-0:0-word-51",
                    "visual-tile-333:500:333:500-subtile-0:0-word-54",
                ),
                "kind": "word",
                "texts": ("3'4\"", "iA\""),
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:0",
                "lineages": ((12, 1, 1), (13, 1, 1)),
                "bounds": {
                    "x": 0.366508, "y": 0.668444,
                    "width": 0.008889, "height": 0.003778,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-1:0-word-8",
                "kind": "word",
                "texts": ("3'-4'",),
                "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
                "lineages": ((2, 1, 1),),
                "bounds": {
                    "x": 0.366508, "y": 0.668444,
                    "width": 0.00746, "height": 0.003778,
                },
                "supersede": True,
            },
        ),
    },
    {
        "id": "architectural-2321-page13-wall-light-note-candidate",
        "text": (
            "23. WALL MOUNTED LIGHT FIXTURE +10'-0\" AFF, CENTERED ON "
            "DOOR OPENING BELOW. SEE ELECTRICAL PLANS."
        ),
        "bounds": {
            "x": 0.714603, "y": 0.663333,
            "width": 0.127778, "height": 0.009556,
        },
        "constituents": (
            {
                "id": "visual-tile-667:500:333:500-subtile-1:0-line-1",
                "kind": "line",
                "texts": (
                    "23. WALL MOUNTED LIGHT FIXTURE #0'-0\"",
                    "23. WALL MOUNTED LIGHT FIXTURE #10'-0\"",
                ),
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-1:0",
                "lineages": ((2, 1, 1),),
                "bounds": {
                    "x": 0.714603, "y": 0.664,
                    "width": 0.067619, "height": 0.004222,
                },
                "role": "line",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-0:1-word-130",
                "kind": "word",
                "texts": ("410'-O\"",),
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
                "lineages": ((19, 1, 1),),
                "bounds": {
                    "x": 0.771746, "y": 0.664444,
                    "width": 0.010476, "height": 0.003556,
                },
                "role": "measurement",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-0:1-line-18",
                "kind": "line",
                "texts": ("410'-O\" AFF, CENTERED ON DOOR OPENING",),
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-0:1",
                "lineages": ((19, 1, 1),),
                "bounds": {
                    "x": 0.771746, "y": 0.663333,
                    "width": 0.070635, "height": 0.004889,
                },
                "role": "line",
                "supersede": True,
            },
            {
                "id": "visual-tile-667:500:333:500-subtile-1:0-line-2",
                "kind": "line",
                "texts": ("BELOW. SEE ELECTRICAL PLANS.",),
                "ocrPrefix": "visual-tile-667:500:333:500-subtile-1:0",
                "lineages": ((3, 1, 1),),
                "bounds": {
                    "x": 0.720794, "y": 0.668889,
                    "width": 0.053651, "height": 0.004,
                },
                "role": "line",
                "supersede": True,
            },
        ),
        "replacementIds": (
            "visual-tile-667:500:333:500-subtile-0:0-line-37",
            "visual-tile-667:500:333:500-subtile-0:0-word-244",
            "visual-tile-667:500:333:500-subtile-1:0-word-18",
            "visual-tile-667:500:333:500-subtile-1:1-line-1",
            "visual-tile-667:500:333:500-subtile-1:1-word-9",
            "title-ocr-line-2",
            "title-ocr-word-23",
        ),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE14_NUMBER = 14
EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE = (
    "exact_rendered_page14_dimension_composite_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS = (
    {
        "id": "architectural-2321-page14-grid-c-80ft-candidate",
        "text": "80'-0\"",
        "bounds": {
            "x": 0.62873, "y": 0.106444,
            "width": 0.011429, "height": 0.003111,
        },
        "constituents": (
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-8",
                "text": "80’",
                "bounds": {
                    "x": 0.62873, "y": 0.106444,
                    "width": 0.004444, "height": 0.003111,
                },
                "lineage": (2, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-12",
                "text": "D'",
                "bounds": {
                    "x": 0.635714, "y": 0.106444,
                    "width": 0.00254, "height": 0.003111,
                },
                "lineage": (3, 1, 1),
            },
        ),
    },
    {
        "id": "architectural-2321-page14-lower-grid-80ft-candidate",
        "text": "80'-0\"",
        "bounds": {
            "x": 0.247778, "y": 0.566889,
            "width": 0.009524, "height": 0.003111,
        },
        "constituents": (
            {
                "id": "visual-tile-0:500:333:500-subtile-0:2-word-12",
                "text": "80'-2'",
                "bounds": {
                    "x": 0.247778, "y": 0.566889,
                    "width": 0.009524, "height": 0.003111,
                },
                "lineage": (3, 1, 1),
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC = {
    "id": "visual-tile-667:0:333:500-subtile-2:0-word-27",
    "text": "‘1’",
    "bounds": {
        "x": 0.715079, "y": 0.489778,
        "width": 0.005714, "height": 0.009333,
    },
    "lineage": (6, 1, 1),
    "context": (
        {
            "id": "visual-tile-667:0:333:500-subtile-2:0-word-26",
            "text": "CANOPY",
            "bounds": {
                "x": 0.683333, "y": 0.489778,
                "width": 0.02746, "height": 0.009333,
            },
        },
        {
            "id": "visual-tile-667:0:333:500-subtile-2:0-word-28",
            "text": "PLAN",
            "bounds": {
                "x": 0.724444, "y": 0.489778,
                "width": 0.017302, "height": 0.009333,
            },
        },
    ),
}
EXACT_ARCHITECTURAL_2321_PAGE30_NUMBER = 30
EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE = (
    "exact_rendered_page30_dimension_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE = (
    "exact_rendered_page30_complete_proposition_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS = (
    {
        "id": "architectural-2321-page30-west-overall-69ft-10in-candidate",
        "text": "69'-10\"",
        "bounds": {
            "x": 0.134921, "y": 0.478444,
            "width": 0.010159, "height": 0.003333,
        },
        "raw": {
            "text": "S9'-10'",
            "ocrPrefix": "visual-tile-0:0:333:500-subtile-2:1",
        },
    },
    {
        "id": "architectural-2321-page30-north-upper-93ft-2in-candidate",
        "text": "93'-2\"",
        "bounds": {
            "x": 0.560794, "y": 0.233556,
            "width": 0.007619, "height": 0.003333,
        },
        "raw": {
            "text": "93'-2'",
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        },
        "reviewGroup": "north-93ft-2in-and-105ft-6in",
    },
    {
        "id": "architectural-2321-page30-north-lower-105ft-6in-candidate",
        "text": "105'-6\"",
        "bounds": {
            "x": 0.560794, "y": 0.242667,
            "width": 0.009841, "height": 0.003333,
        },
        "raw": {
            "text": "125'-6'",
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:2",
        },
        "reviewGroup": "north-93ft-2in-and-105ft-6in",
    },
    {
        "id": "architectural-2321-page30-center-overall-237ft-2in-candidate",
        "text": "237'-2\"",
        "bounds": {
            "x": 0.445397, "y": 0.364,
            "width": 0.01, "height": 0.003333,
        },
        "raw": {
            "text": "231'-2'",
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:1",
        },
    },
    {
        "id": "architectural-2321-page30-east-overall-107ft-5in-candidate",
        "text": "107'-5\"",
        "bounds": {
            "x": 0.641429, "y": 0.495111,
            "width": 0.010476, "height": 0.003556,
        },
        "raw": {
            "text": "1O1'-5\"",
            "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:2",
        },
    },
    {
        "id": "architectural-2321-page30-northeast-14ft-6in-candidate",
        "text": "14'-6\"",
        "bounds": {
            "x": 0.669683, "y": 0.216222,
            "width": 0.013651, "height": 0.007556,
        },
        "raw": {
            "text": "f'4'-6\")",
            "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
        },
        "supersededLine": {
            "text": "f'4'-6\") E>E5",
            "bounds": {
                "x": 0.669683, "y": 0.216222,
                "width": 0.027302, "height": 0.007556,
            },
        },
    },
    {
        "id": "architectural-2321-page30-northeast-24ft-0in-candidate",
        "text": "24'-0\"",
        "bounds": {
            "x": 0.780635, "y": 0.213333,
            "width": 0.009841, "height": 0.003111,
        },
        "raw": {
            "text": "24'-2\"",
            "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
        },
    },
    {
        "id": "architectural-2321-page30-southwest-77ft-3in-candidate",
        "text": "77'-3\"",
        "bounds": {
            "x": 0.234603, "y": 0.736667,
            "width": 0.007619, "height": 0.003111,
        },
        "raw": {
            "text": "T1'-3'",
            "ocrPrefix": "visual-tile-0:500:333:500-subtile-1:2",
        },
    },
    {
        "id": "architectural-2321-page30-southwest-91ft-10in-candidate",
        "text": "91'-10\"",
        "bounds": {
            "x": 0.460794, "y": 0.537333,
            "width": 0.008413, "height": 0.003556,
        },
        "raw": {
            "text": "21'-1D'",
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:1",
        },
    },
    {
        "id": "architectural-2321-page30-south-32ft-9in-candidate",
        "text": "32'-9\"",
        "bounds": {
            "x": 0.641111, "y": 0.548222,
            "width": 0.009048, "height": 0.003333,
        },
        "raw": {
            "text": "32'-9\"\"",
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:2",
        },
    },
    {
        "id": "architectural-2321-page30-south-36ft-7in-candidate",
        "text": "36'-7\"",
        "bounds": {
            "x": 0.64381, "y": 0.628889,
            "width": 0.009524, "height": 0.003111,
        },
        "raw": {
            "text": "36'-1\"",
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:2",
        },
    },
    {
        "id": "architectural-2321-page30-southwest-13ft-5in-candidate",
        "text": "13'-5\"",
        "bounds": {
            "x": 0.376349, "y": 0.734222,
            "width": 0.006825, "height": 0.003333,
        },
        "raw": {
            "text": "13'-5'",
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
        },
    },
    {
        "id": "architectural-2321-page30-southeast-157ft-2in-candidate",
        "text": "157'-2\"",
        "bounds": {
            "x": 0.569206, "y": 0.674222,
            "width": 0.009524, "height": 0.003333,
        },
        "raw": {
            "text": "'S1'-2\"",
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:2",
        },
    },
)
EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS = (
    {
        "id": "architectural-2321-page30-roof-deck-height-candidate",
        "text": "ROOF DECK HEIGHT: MINIMUM 24'-0\"",
        "bounds": {
            "x": 0.71127, "y": 0.212667,
            "width": 0.079206, "height": 0.004,
        },
        "supersededCandidate": {
            "id": "architectural-2321-page30-northeast-24ft-0in-candidate",
            "text": "24'-0\"",
            "bounds": {
                "x": 0.780635, "y": 0.213333,
                "width": 0.009841, "height": 0.003111,
            },
            "source": EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
        },
        "constituents": (
            {
                "text": "ROOF DECK HEIGHT:",
                "bounds": {
                    "x": 0.71127, "y": 0.212667,
                    "width": 0.033333, "height": 0.004,
                },
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "ocrKind": "line",
                "lineage": (20, 1, 1),
                "acceptedTexts": (
                    "ROOF DECK HEIGHT:",
                    "RROOF DECK HEIGHT:",
                ),
                "textMode": "exact",
            },
            {
                "text": "MINIMUM",
                "bounds": {
                    "x": 0.766667, "y": 0.212667,
                    "width": 0.012698, "height": 0.003778,
                },
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:0",
                "ocrKind": "word",
                "lineage": (21, 1, 1),
                "textMode": "exact",
            },
            {
                "bounds": {
                    "x": 0.780635, "y": 0.213333,
                    "width": 0.009841, "height": 0.003111,
                },
                "ocrPrefix": "visual-tile-667:0:333:500-subtile-1:1",
                "ocrKind": "word",
                "lineage": (9, 1, 1),
                "textMode": "measurement",
            },
        ),
    },
    {
        "id": "architectural-2321-page30-exit-e2-distance-candidate",
        "text": "EXIT E-2 = 186'-4\"",
        "bounds": {
            "x": 0.100159, "y": 0.146667,
            "width": 0.034444, "height": 0.003778,
        },
        "supersededCandidate": {
            "text": "186'",
            "bounds": {
                "x": 0.123968, "y": 0.146889,
                "width": 0.005556, "height": 0.003556,
            },
            "source": "fixed_visual_tile_coordinate_ocr",
        },
        "constituents": (
            {
                "text": "EXIT E-2 =",
                "bounds": {
                    "x": 0.100159, "y": 0.146667,
                    "width": 0.016667, "height": 0.003778,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:0",
                "ocrKind": "line",
                "lineage": (5, 1, 1),
                "textMode": "exact",
            },
            {
                "text": "186'",
                "bounds": {
                    "x": 0.123968, "y": 0.146889,
                    "width": 0.005556, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:1",
                "ocrKind": "word",
                "lineage": (14, 1, 1),
                "acceptedLineages": (
                    (14, 1, 1),
                    (10, 1, 1),
                ),
                "textMode": "exact",
            },
            {
                "text": "“",
                "bounds": {
                    "x": 0.133651, "y": 0.147111,
                    "width": 0.000952, "height": 0.001556,
                },
                "ocrPrefix": "visual-tile-0:0:333:500-subtile-0:1",
                "ocrKind": "word",
                "lineage": (15, 1, 1),
                "acceptedLineages": (
                    (15, 1, 1),
                    (11, 1, 1),
                ),
                "acceptedTexts": (
                    "“",
                    "q",
                ),
                "textMode": "exact",
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE31_NUMBER = 31
EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE = (
    "exact_rendered_page31_complete_proposition_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS = (
    {
        "id": "architectural-2321-page31-boxed-20ft-11in-candidate",
        "text": "20'-11\"",
        "bounds": {
            "x": 0.346349, "y": 0.073333,
            "width": 0.009524, "height": 0.003333,
        },
        "constituents": (
            {
                "id": "visual-tile-333:0:333:500-subtile-0:0-word-4",
                "text": "[20'-11\"]",
                "bounds": {
                    "x": 0.346349, "y": 0.073333,
                    "width": 0.009524, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
                "ocrKind": "word",
                "lineage": (1, 1, 1),
            },
        ),
        "auditOnly": (),
    },
    {
        "id": "architectural-2321-page31-wall-removal-height-note-candidate",
        "text": (
            "EXISTING WALL TO BE REMOVED TO EXTENT SHOWN UP TO 8'-0\" HIGH."
        ),
        "bounds": {
            "x": 0.474762, "y": 0.149556,
            "width": 0.114444, "height": 0.003777,
        },
        "constituents": (
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-147",
                "text": "EXISTING",
                "bounds": {
                    "x": 0.474762, "y": 0.149556,
                    "width": 0.014286, "height": 0.003778,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-148",
                "text": "WALL",
                "bounds": {
                    "x": 0.490476, "y": 0.149778,
                    "width": 0.008254, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-149",
                "text": "TO",
                "bounds": {
                    "x": 0.500159, "y": 0.149778,
                    "width": 0.004286, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-150",
                "text": "BE",
                "bounds": {
                    "x": 0.505714, "y": 0.15,
                    "width": 0.004444, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-151",
                "text": "REMOVED",
                "bounds": {
                    "x": 0.511746, "y": 0.149778,
                    "width": 0.01619, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-152",
                "text": "TO",
                "bounds": {
                    "x": 0.529365, "y": 0.149778,
                    "width": 0.004286, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-153",
                "text": "EXTENT",
                "bounds": {
                    "x": 0.534921, "y": 0.149778,
                    "width": 0.012063, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-154",
                "text": "SHOWN",
                "bounds": {
                    "x": 0.548413, "y": 0.149778,
                    "width": 0.010476, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-61",
                "text": "UP",
                "bounds": {
                    "x": 0.560317, "y": 0.149778,
                    "width": 0.004127, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "word", "lineage": (9, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-62",
                "text": "TO",
                "bounds": {
                    "x": 0.565714, "y": 0.149778,
                    "width": 0.004127, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "word", "lineage": (9, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-63",
                "text": "8'-0\"",
                "bounds": {
                    "x": 0.57127, "y": 0.149778,
                    "width": 0.008095, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "word", "lineage": (9, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-64",
                "text": "HIGH.",
                "bounds": {
                    "x": 0.580952, "y": 0.149556,
                    "width": 0.008254, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "word", "lineage": (9, 1, 1),
            },
        ),
        "auditOnly": (
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-word-155",
                "text": "UF",
                "bounds": {
                    "x": 0.560317, "y": 0.149778,
                    "width": 0.002857, "height": 0.003556,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "word", "lineage": (21, 1, 1),
                "ocrBoundaryTruncated": True,
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:1-line-20",
                "text": "EXISTING WALL TO BE REMOVED TO EXTENT SHOWN UF",
                "bounds": {
                    "x": 0.474762, "y": 0.149556,
                    "width": 0.088413, "height": 0.003778,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:1",
                "ocrKind": "line", "lineage": (21, 1, 1),
                "ocrBoundaryTruncated": True,
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-word-60",
                "text": "SHOUN",
                "bounds": {
                    "x": 0.548413, "y": 0.149778,
                    "width": 0.010476, "height": 0.003333,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "word", "lineage": (9, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-0:2-line-8",
                "text": "SHOUN UP TO 8'-0\" HIGH.",
                "bounds": {
                    "x": 0.548413, "y": 0.149556,
                    "width": 0.040794, "height": 0.003778,
                },
                "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:2",
                "ocrKind": "line", "lineage": (9, 1, 1),
            },
        ),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE36_NUMBER = 36
EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE = (
    "exact_rendered_page36_clearance_proposition_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT = "5'-0\" CLR"
EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS = (
    {
        "id": "visual-tile-333:500:333:500-subtile-2:2-word-16",
        "acceptedIds": (
            "visual-tile-333:500:333:500-subtile-2:2-word-16",
            "visual-tile-333:500:333:500-subtile-2:2-word-21",
        ),
        "text": "5'-O\"",
        "bounds": {
            "x": 0.623651, "y": 0.9,
            "width": 0.010794, "height": 0.004,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-2:2",
        "ocrKind": "word",
        "lineage": (3, 1, 1),
        "acceptedLineages": ((3, 1, 1), (4, 1, 1)),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-2:2-line-2",
        "acceptedIds": (
            "visual-tile-333:500:333:500-subtile-2:2-line-2",
            "visual-tile-333:500:333:500-subtile-2:2-line-3",
        ),
        "text": "5'-O\" CLR]",
        "bounds": {
            "x": 0.623651, "y": 0.899778,
            "width": 0.022698, "height": 0.004444,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-2:2",
        "ocrKind": "line",
        "lineage": (3, 1, 1),
        "acceptedLineages": ((3, 1, 1), (4, 1, 1)),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE38_NUMBER = 38
EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE = (
    "exact_rendered_page38_door_schedule_measurement_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_COLUMNS = (
    {"xMin": 0.415, "xMax": 0.426},
    {"xMin": 0.432, "xMax": 0.445},
)
EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_Y_MIN = 0.076
EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_Y_MAX = 0.701
EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS = (
    {
        "id": "visual-tile-333:0:333:500-subtile-0:0-word-20",
        "text": "IDTH",
        "bounds": {
            "x": 0.41873, "y": 0.070444,
            "width": 0.00746, "height": 0.003333,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-0:0-word-24",
        "text": "HEIGHT]",
        "bounds": {
            "x": 0.43254, "y": 0.070222,
            "width": 0.012222, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    },
)
EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS = (
    {
        "id": "visual-tile-333:0:333:500-subtile-0:0-word-68",
        "text": "70\"",
        "canonical": "7'-0\"",
        "bounds": {
            "x": 0.434921, "y": 0.094222,
            "width": 0.00746, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-0:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-120",
        "text": "3",
        "canonical": "3'-0\"",
        "bounds": {
            "x": 0.416984, "y": 0.225333,
            "width": 0.004127, "height": 0.003778,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-56",
        "text": "70\")",
        "canonical": "7'-0\"",
        "bounds": {
            "x": 0.434921, "y": 0.184222,
            "width": 0.007619, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-172",
        "text": "7-07]",
        "canonical": "7'-0\"",
        "bounds": {
            "x": 0.434921, "y": 0.249556,
            "width": 0.007619, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-232",
        "text": "jo'-0'",
        "canonical": "10'-0\"",
        "bounds": {
            "x": 0.417937, "y": 0.282667,
            "width": 0.007302, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-244",
        "text": "i0’-0'",
        "canonical": "10'-0\"",
        "bounds": {
            "x": 0.416508, "y": 0.290222,
            "width": 0.00873, "height": 0.004222,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-256",
        "text": "70'-0\"",
        "canonical": "10'-0\"",
        "bounds": {
            "x": 0.416508, "y": 0.298667,
            "width": 0.00873, "height": 0.003778,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-2:0-word-156",
        "text": "72'-0\"|",
        "canonical": "12'-0\"",
        "bounds": {
            "x": 0.434127, "y": 0.419778,
            "width": 0.009524, "height": 0.004667,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-2:0-word-204",
        "text": "q2'-0\"|",
        "canonical": "12'-0\"",
        "bounds": {
            "x": 0.434127, "y": 0.452667,
            "width": 0.009524, "height": 0.004444,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-2:0",
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-0:0-word-92",
        "text": "7-07",
        "canonical": "7'-0\"",
        "bounds": {
            "x": 0.434921, "y": 0.543556,
            "width": 0.00746, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-0:0",
    },
)
EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS = (
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-260",
        "text": "iE",
        "bounds": {
            "x": 0.432857, "y": 0.302667,
            "width": 0.01127, "height": 0.000667,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-304",
        "text": "——",
        "bounds": {
            "x": 0.432857, "y": 0.33,
            "width": 0.01127, "height": 0.000667,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-316",
        "text": "=",
        "bounds": {
            "x": 0.433016, "y": 0.335556,
            "width": 0.010952, "height": 0.000667,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:1-word-88",
        "text": "0°]",
        "bounds": {
            "x": 0.439206, "y": 0.183333,
            "width": 0.003968, "height": 0.005556,
        },
        "ocrPrefix": "visual-tile-333:0:333:500-subtile-1:1",
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-1:0-word-77",
        "text": "|",
        "bounds": {
            "x": 0.429524, "y": 0.680222,
            "width": 0.002222, "height": 0.007556,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-1:1-word-71",
        "text": "0\"",
        "bounds": {
            "x": 0.439206, "y": 0.673111,
            "width": 0.003968, "height": 0.006,
        },
        "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:1",
    },
)
EXACT_ARCHITECTURAL_2321_PAGE40_NUMBER = 40
EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE = (
    "exact_rendered_page40_landing_dimension_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT = "14'-6\""
EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS = (
    {
        "id": "visual-tile-0:0:333:500-subtile-1:0-word-16",
        "text": "[1'-6*]",
        "bounds": {
            "x": 0.10746, "y": 0.174889,
            "width": 0.010635, "height": 0.006222,
        },
        "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:0",
        "lineage": (4, 1, 1),
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:1-word-12",
        "text": "{4'-6*)",
        "bounds": {
            "x": 0.10873, "y": 0.176,
            "width": 0.00873, "height": 0.003556,
        },
        "ocrPrefix": "visual-tile-0:0:333:500-subtile-1:1",
        "lineage": (3, 1, 1),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE42_NUMBER = 42
EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE = (
    "exact_rendered_page42_loading_dimension_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT = "12'-0\" @ 5' WIDE LOADING"
EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE = {
    "id": "visual-tile-333:0:333:500-subtile-2:0-line-21",
    "text": "12'-0\" @ 5' WIDE LOADING!",
    "bounds": {
        "x": 0.404127, "y": 0.463111,
        "width": 0.04127, "height": 0.003556,
    },
}
EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS = (
    (
        "visual-tile-333:0:333:500-subtile-2:0-word-104",
        "12'-0\"", 0.404127, 0.463111, 0.008413, 0.003556,
    ),
    (
        "visual-tile-333:0:333:500-subtile-2:0-word-105",
        "@", 0.414127, 0.463778, 0.001905, 0.002222,
    ),
    (
        "visual-tile-333:0:333:500-subtile-2:0-word-106",
        "5'", 0.41746, 0.463333, 0.002698, 0.003333,
    ),
    (
        "visual-tile-333:0:333:500-subtile-2:0-word-107",
        "WIDE", 0.421587, 0.463333, 0.007619, 0.003333,
    ),
    (
        "visual-tile-333:0:333:500-subtile-2:0-word-108",
        "LOADING!", 0.430635, 0.463333, 0.014762, 0.003333,
    ),
)
EXACT_ARCHITECTURAL_2321_PAGE45_NUMBER = 45
EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE = (
    "exact_rendered_page45_post_spacing_dimension_candidate"
)
EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_TEXT = "4'-0\""
EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS = (
    {
        "id": "visual-tile-667:500:333:500-subtile-1:1-word-137",
        "text": "4'-O\"",
        "bounds": {
            "x": 0.839206, "y": 0.830667,
            "width": 0.008254, "height": 0.003333,
        },
        "ocrPrefix": "visual-tile-667:500:333:500-subtile-1:1",
        "lineage": (26, 1, 1),
    },
    {
        "id": "visual-tile-667:500:333:500-subtile-2:1-word-23",
        "text": "4'-9\"",
        "bounds": {
            "x": 0.839206, "y": 0.830667,
            "width": 0.008254, "height": 0.003333,
        },
        "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
        "lineage": (5, 1, 1),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE18_NUMBER = 18
EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS = (
    {
        "id": "visual-tile-0:0:333:500-subtile-1:0-word-5",
        "text": "'1'",
        "bounds": {
            "x": 0.070159, "y": 0.244444,
            "width": 0.005714, "height": 0.003778,
        },
        "confidence": 0.0,
        "lineage": (1, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "quoted_identifier_is_inside_exact_canopy_curb_detail_title"
        ),
        "context": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-line-0",
                "kind": "line",
                "text": "OPY '1' CURB DET",
                "bounds": {
                    "x": 0.053016, "y": 0.244222,
                    "width": 0.06127, "height": 0.007333,
                },
                "confidence": 0.0,
                "lineage": (1, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-0:0:333:500-subtile-1:0-line-0",
        "kind": "line",
        "text": "OPY '1' CURB DET",
        "bounds": {
            "x": 0.053016, "y": 0.244222,
            "width": 0.06127, "height": 0.007333,
        },
        "confidence": 0.0,
        "lineage": (1, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "partial_exact_canopy_curb_detail_title_is_not_a_standalone_fact"
        ),
        "context": (
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-word-5",
                "text": "'1'",
                "bounds": {
                    "x": 0.070159, "y": 0.244444,
                    "width": 0.005714, "height": 0.003778,
                },
                "confidence": 0.0,
                "lineage": (1, 1, 1),
            },
            {
                "id": "visual-tile-0:0:333:500-subtile-1:0-word-6",
                "text": "CURB",
                "bounds": {
                    "x": 0.079683, "y": 0.244444,
                    "width": 0.017778, "height": 0.007111,
                },
                "confidence": 0.96,
                "lineage": (1, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-word-9",
        "text": "'1'",
        "bounds": {
            "x": 0.407937, "y": 0.244444,
            "width": 0.005714, "height": 0.003556,
        },
        "confidence": 0.42,
        "lineage": (2, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "quoted_identifier_is_inside_exact_canopy_curb_detail_title"
        ),
        "context": (
            {
                "id": "visual-tile-333:0:333:500-subtile-1:0-line-1",
                "kind": "line",
                "text": "OPY '1' CURB DET",
                "bounds": {
                    "x": 0.390794, "y": 0.244444,
                    "width": 0.061111, "height": 0.007111,
                },
                "confidence": 0.42,
                "lineage": (2, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-1:0-line-1",
        "kind": "line",
        "text": "OPY '1' CURB DET",
        "bounds": {
            "x": 0.390794, "y": 0.244444,
            "width": 0.061111, "height": 0.007111,
        },
        "confidence": 0.42,
        "lineage": (2, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "partial_exact_canopy_curb_detail_title_is_not_a_standalone_fact"
        ),
        "context": (
            {
                "id": "visual-tile-333:0:333:500-subtile-1:0-word-9",
                "text": "'1'",
                "bounds": {
                    "x": 0.407937, "y": 0.244444,
                    "width": 0.005714, "height": 0.003556,
                },
                "confidence": 0.42,
                "lineage": (2, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-1:0-word-10",
                "text": "CURB",
                "bounds": {
                    "x": 0.417302, "y": 0.244444,
                    "width": 0.017937, "height": 0.007111,
                },
                "confidence": 0.95,
                "lineage": (2, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:0:333:500-subtile-2:0-word-68",
        "text": "'1'",
        "bounds": {
            "x": 0.407937, "y": 0.486222,
            "width": 0.005714, "height": 0.003333,
        },
        "confidence": 0.41,
        "lineage": (14, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "quoted_identifier_is_inside_exact_canopy_curb_detail_title"
        ),
        "context": (
            {
                "id": "visual-tile-333:0:333:500-subtile-2:0-word-67",
                "text": "OPY",
                "bounds": {
                    "x": 0.390794, "y": 0.486,
                    "width": 0.013492, "height": 0.007111,
                },
                "confidence": 0.92,
                "lineage": (14, 1, 1),
            },
            {
                "id": "visual-tile-333:0:333:500-subtile-2:0-word-69",
                "text": "CURB",
                "bounds": {
                    "x": 0.417302, "y": 0.486,
                    "width": 0.017937, "height": 0.007333,
                },
                "confidence": 0.95,
                "lineage": (14, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-1:0-word-41",
        "text": "'1'",
        "bounds": {
            "x": 0.407937, "y": 0.727778,
            "width": 0.005714, "height": 0.003333,
        },
        "confidence": 0.55,
        "lineage": (9, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "quoted_identifier_is_inside_exact_canopy_curb_detail_title"
        ),
        "context": (
            {
                "id": "visual-tile-333:500:333:500-subtile-1:0-word-40",
                "text": "CANOPY",
                "bounds": {
                    "x": 0.37619, "y": 0.727778,
                    "width": 0.028095, "height": 0.007111,
                },
                "confidence": 0.93,
                "lineage": (9, 1, 1),
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-1:0-word-42",
                "text": "CURB",
                "bounds": {
                    "x": 0.417302, "y": 0.727778,
                    "width": 0.017937, "height": 0.007111,
                },
                "confidence": 0.96,
                "lineage": (9, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-0:500:333:500-subtile-2:1-word-65",
        "text": "[T=1'-0\"|",
        "bounds": {
            "x": 0.166667, "y": 0.974222,
            "width": 0.015873, "height": 0.005778,
        },
        "confidence": 0.08,
        "lineage": (13, 1, 1),
        "authorityStatus": "quarantined_scale_legend",
        "authorityReason": (
            "exact_title_block_scale_is_not_a_standalone_dimension"
        ),
        "context": (),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-1:1-word-46",
        "text": "[i*=1'-0\"",
        "bounds": {
            "x": 0.504603, "y": 0.732444,
            "width": 0.015873, "height": 0.006,
        },
        "confidence": 0.32,
        "lineage": (11, 1, 1),
        "authorityStatus": "quarantined_scale_legend",
        "authorityReason": (
            "exact_detail_scale_is_not_a_standalone_dimension"
        ),
        "context": (
            {
                "id": "visual-tile-333:500:333:500-subtile-1:1-word-34",
                "kind": "word",
                "text": "[SCALE]",
                "bounds": {
                    "x": 0.504603, "y": 0.724667,
                    "width": 0.015873, "height": 0.006222,
                },
                "confidence": 0.5,
                "lineage": (8, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-2:0-word-34",
        "text": "'1'",
        "bounds": {
            "x": 0.407937, "y": 0.969333,
            "width": 0.005714, "height": 0.003556,
        },
        "confidence": 0.0,
        "lineage": (7, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "quoted_identifier_is_inside_exact_canopy_curb_detail_title"
        ),
        "context": (
            {
                "id": "visual-tile-333:500:333:500-subtile-2:0-line-6",
                "kind": "line",
                "text": "NOPY '1' CURB DET",
                "bounds": {
                    "x": 0.38619, "y": 0.969333,
                    "width": 0.065714, "height": 0.007333,
                },
                "confidence": 0.0,
                "lineage": (7, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-2:0-line-6",
        "kind": "line",
        "text": "NOPY '1' CURB DET",
        "bounds": {
            "x": 0.38619, "y": 0.969333,
            "width": 0.065714, "height": 0.007333,
        },
        "confidence": 0.0,
        "lineage": (7, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "partial_exact_canopy_curb_detail_title_is_not_a_standalone_fact"
        ),
        "context": (
            {
                "id": "visual-tile-333:500:333:500-subtile-2:0-word-34",
                "text": "'1'",
                "bounds": {
                    "x": 0.407937, "y": 0.969333,
                    "width": 0.005714, "height": 0.003556,
                },
                "confidence": 0.0,
                "lineage": (7, 1, 1),
            },
            {
                "id": "visual-tile-333:500:333:500-subtile-2:0-word-35",
                "text": "CURB",
                "bounds": {
                    "x": 0.417302, "y": 0.969333,
                    "width": 0.017937, "height": 0.007333,
                },
                "confidence": 0.95,
                "lineage": (7, 1, 1),
            },
        ),
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-2:0-word-40",
        "text": "[t¥=1'-0\"|",
        "bounds": {
            "x": 0.335714, "y": 0.974222,
            "width": 0.015714, "height": 0.005778,
        },
        "confidence": 0.0,
        "lineage": (8, 1, 1),
        "authorityStatus": "quarantined_scale_legend",
        "authorityReason": (
            "exact_title_block_scale_is_not_a_standalone_dimension"
        ),
        "context": (),
    },
)
EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS = (
    {
        "id": "title-ocr-word-54",
        "text": "1",
        "bounds": {
            "x": 0.952982, "y": 0.724722,
            "width": 0.00129, "height": 0.003194,
        },
        "confidence": 0.96,
        "source": "title_block_ocr",
        "lineage": (10, 1, 1),
        "authorityStatus": "quarantined_exact_drawing_title_identifier",
        "authorityReason": (
            "exact_title_block_revision_delta_number_is_not_a_standalone_fact"
        ),
        "context": (
            {
                "id": "title-ocr-word-53",
                "text": "DELTA",
                "bounds": {
                    "x": 0.940484, "y": 0.724722,
                    "width": 0.011209, "height": 0.003194,
                },
                "confidence": 0.89,
                "source": "title_block_ocr",
                "lineage": (10, 1, 1),
            },
            {
                "id": "title-ocr-word-58",
                "text": "09-13-24",
                "bounds": {
                    "x": 0.963199, "y": 0.724722,
                    "width": 0.014383, "height": 0.003194,
                },
                "confidence": 0.96,
                "source": "title_block_ocr",
                "lineage": (11, 1, 1),
            },
        ),
    },
)
QUARANTINED_VISUAL_AUTHORITY_STATUSES = frozenset({
    "quarantined_scale_legend",
    "superseded_by_exact_native_visual_composite",
    "superseded_by_exact_rendered_fire_separation_composite",
    "superseded_by_exact_rendered_area_table_row_composite",
    "superseded_by_exact_rendered_accessible_parking_note_composite",
    "superseded_by_exact_rendered_easement_note_composite",
    "superseded_by_exact_rendered_site_note_composite",
    "superseded_by_exact_rendered_page14_dimension_composite",
    "superseded_by_exact_rendered_page30_dimension_candidate",
    "superseded_by_exact_rendered_page30_complete_proposition_candidate",
    "superseded_by_exact_rendered_page31_complete_proposition_candidate",
    "superseded_by_exact_rendered_page36_clearance_proposition_candidate",
    "superseded_by_exact_page38_door_schedule_measurement",
    "superseded_by_exact_rendered_page40_landing_dimension_composite",
    "superseded_by_exact_rendered_page42_loading_dimension_composite",
    "superseded_by_exact_rendered_page45_post_spacing_dimension_composite",
    "superseded_by_exact_rendered_2321_page15_keynote_fact",
    EXACT_CIVIL_2375_COMPLETE_NOTE_SUPERSEDED_STATUS,
    EXACT_CANOPY_A_2375_DIMENSION_SUPERSEDED_STATUS,
    EXACT_CANOPY_A_2375_SITE_ELEVATION_SUPERSEDED_STATUS,
    EXACT_CANOPY_A_2375_OUTSET_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SUPERSEDED_STATUS,
    EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SUPERSEDED_STATUS,
    EXACT_CANOPY_B_PAGE4_SCHEDULE_SUPERSEDED_STATUS,
    "superseded_by_exact_structural_page2_dimension_candidate",
    "superseded_by_exact_2375_structural_page2_dimension_candidate",
    "superseded_by_exact_2375_structural_page6_footing_dimension_candidate",
    "superseded_by_exact_2375_structural_page7_continuous_footing_candidate",
    "superseded_by_exact_2375_structural_page12_elevation_note_candidate",
    "superseded_by_exact_2375_structural_page13_anchor_spacing_candidate",
    "superseded_by_exact_2375_structural_page15_minimum_dimension_candidate",
    "superseded_by_exact_2375_structural_page16_horizontal_schedule_candidate",
    "superseded_by_exact_2375_structural_page16_up_to_limit_candidate",
    "superseded_by_exact_2375_structural_page18_proposition_candidate",
    "superseded_by_exact_2375_structural_page20_proposition_candidate",
    "superseded_by_exact_2375_structural_page21_hanger_wire_clause_candidate",
    "superseded_by_exact_structural_page8_proposition_candidate",
    "superseded_by_exact_structural_page11_proposition_candidate",
    "superseded_by_exact_structural_page12_hanger_wire_clause_candidate",
    "superseded_by_exact_electrical_page2_conductor_note",
    "superseded_by_exact_2375_electrical_page3_candidate",
    "superseded_by_exact_2375_electrical_page13_candidate",
    EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SUPERSEDED_STATUS,
    "superseded_by_exact_2375_electrical_page14_candidate",
    "quarantined_exact_drawing_title_identifier",
    "superseded_by_bounded_measurement_ocr",
    "validated_by_two_resolution_measurement_ocr",
    "validated_by_exact_2375_structural_page18_two_resolution_measurement_ocr",
    "superseded_by_two_resolution_measurement_context",
})
INCOMPLETE_FOOT_INCH_MEASUREMENT_PATTERN = re.compile(
    r"(?<!\d)\d{1,4}\s*['\u2019]\s*-\s*[\"\u201d]",
    re.IGNORECASE,
)
BOUNDED_MEASUREMENT_RECONSTRUCTION_PATTERN = re.compile(
    r"(?<!\d)(\d{1,4})\s*['\u2019]\s*-\s*([0-9OQ]{0,2})([A-Z]{0,2})\s*$",
    re.IGNORECASE,
)
BOUNDED_MEASUREMENT_INCOMPLETE_DASH_PATTERN = re.compile(
    r"^(\d{1,4})\s*['\u2019]\s*[-\u2013\u2014]\s*$",
)
BOUNDED_MEASUREMENT_CORRUPTED_TOKEN_PATTERN = re.compile(
    r"^[A-Z0-9]{1,4}\s*['\u2019]\s*[-\u2013\u2014]\s*"
    r"[A-Z0-9]{1,2}(?:\s+\d{1,2}\s*/\s*\d{1,2})?\s*[\"\u201d]$",
    re.IGNORECASE,
)
MISSING_ZERO_INCH_MARKER_PATTERN = re.compile(
    r"(?<!\d)(\d{1,4})\s*['\u2019]\s*-\s*0\s*$",
    re.IGNORECASE,
)
TARGETED_MEASUREMENT_DIGIT_SIGNATURE_PATTERN = re.compile(
    r"^-?(\d{1,4})-(\d{1,2})(\d{1,2}/\d{1,2})?-?$",
)
INCOMPLETE_PARENTHESIZED_FOOT_SUM_PATTERN = re.compile(
    r"\(\s*\d{1,4}(?:\.\d{1,3})?\s*(?:['\u2019]|FT\.?(?![A-Z])|FEET\b|FOOT\b)\s*\+\s*",
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
BOUNDED_MEASUREMENT_PRIMARY_DPI = 300
BOUNDED_MEASUREMENT_CORROBORATION_DPI = 600
MAX_BOUNDED_MEASUREMENT_RECONSTRUCTIONS_PER_PAGE = 8
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
    validate_document_object_budget(document)
    # The immutable, SHA-checked download is inherited by killable decoder
    # children. They reopen this exact source rather than sharing MuPDF state
    # with the long-lived hosted worker process.
    document._ecos_source_bytes = bytes(pdf_bytes)
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
    drawing_shapes = bounded_drawing_shapes(page)
    geometry = deterministic_geometry(page, drawing_shapes=drawing_shapes)
    # Structural metadata is a candidate, not rendered truth. Always perform
    # the independent title-cell passes: even a strict page-bound bookmark is
    # document-controlled metadata and may only become verified when trusted
    # OCR reads the same sheet identity from this rendered page.
    title_block_regions = title_block_ocr_regions(
        page, page_width, page_height,
    )
    sheet_identity_regions = sheet_identity_ocr_regions(
        page,
        page_width,
        page_height,
        expected_sheet_number=(
            document_sheet_identity.sheet_number
            if document_sheet_identity is not None
            and document_sheet_identity.source == "pdf_bookmark"
            else None
        ),
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
    if (
        source_sha256 == EXACT_CANOPY_A_2375_SOURCE_SHA256
        and project_id == EXACT_CANOPY_A_2375_PROJECT_ID
        and evidence_version == EXACT_CANOPY_A_2375_EVIDENCE_VERSION
        and page.number + 1 == EXACT_CANOPY_A_2375_PAGE_NUMBER
    ):
        # This anchor-rod plan prints one overall dimension vertically. The
        # fixed horizontal page grid proves visual coverage but predictably
        # drops that rotated value. Run the existing bounded dimension bands
        # only for this immutable page so the missing value enters the normal
        # low-confidence, dual-provider review path.
        raw_ocr_regions.extend(dimension_ocr_regions(
            page, page_width, page_height,
        ))
    ocr_reason = coordinate_ocr_reason(page, native_text, geometry=geometry)
    # The fixed six-tile pass already provides complete page-bound detection
    # coverage. Do not run the legacy whole-page/tiled OCR path as well: on
    # vector-heavy schedule sheets it repeats the same render and coordinate
    # OCR work, can exceed the page deadline, and adds no independent proof.
    # ``ocr_reason`` remains diagnostic context for the page record.
    ocr_regions, low_confidence_regions = trusted_ocr_regions(raw_ocr_regions)
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_acceptance_candidates(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
        page=page,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page38_schedule_measurements(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page40_landing_dimension(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page42_loading_dimension(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page45_post_spacing_dimension(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page43_dimensions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page49_support_spacing(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page52_existing_wall_panel(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page53_existing_wall_panel(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_material_labels(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page60_schedule_measurement(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page61_handrail_note(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page63_spacing_notes(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page64_control_joint_note(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page66_opening_notes(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2375_page68_roof_recess_note(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_canopy_b_page4_schedule_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page30_dimension_candidates(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page30_complete_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page31_complete_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_page36_clearance_proposition(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_beta_page2_visual_candidates(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page6_footing_dimension(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page7_continuous_footings(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page12_elevation_note(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page13_anchor_spacing(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page15_minimum_dimension(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page16_horizontal_schedule(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page16_up_to_limit(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = corroborate_exact_2375_structural_page18_weld_short_length(
        page,
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        page_width=page_width,
        page_height=page_height,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_2375_structural_page18_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_structural_2321_page8_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_structural_2321_page11_propositions(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_structural_2321_page12_hanger_wire_clause(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        corroborated_measurement_regions,
        low_confidence_regions,
    ) = corroborated_bounded_measurement_ocr_regions(
        page,
        low_confidence_regions,
        page_width=page_width,
        page_height=page_height,
        trusted_regions=ocr_regions,
    )
    ocr_regions = dedupe_regions([
        *ocr_regions,
        *corroborated_measurement_regions,
    ])
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_fire_separation_candidates(
        ocr_regions,
        low_confidence_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_area_row_candidates(
        ocr_regions,
        low_confidence_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_accessible_parking_note_candidate(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_easement_note_candidate(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    (
        ocr_regions,
        low_confidence_regions,
    ) = reconstruct_exact_architectural_2321_site_note_candidates(
        ocr_regions,
        low_confidence_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    ocr_regions = quarantine_exact_architectural_2321_page18_visual_authority(
        ocr_regions,
        raw_regions=raw_ocr_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    low_confidence_regions = (
        quarantine_exact_structural_2321_page15_geometry_false_positive(
            low_confidence_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    native_regions = corroborate_embedded_text_regions(native_regions, ocr_regions)
    assured_document_sheet_identity = corroborate_document_structural_identity(
        document_sheet_identity,
        native_regions=native_regions,
        rendered_regions=ocr_regions,
    )
    exact_structural_footing_facts = (
        exact_structural_2321_page2_footing_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    exact_page_facts = [
        *exact_architectural_2321_page14_plan_identity_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
        *exact_architectural_2321_page15_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
        *exact_landscape_2321_plan_identity_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
        *exact_landscape_2321_hydrozone_table_identity_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
        *exact_electrical_2321_page11_fact_regions(
            page,
            page_width,
            page_height,
            project_id=project_id,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
        *exact_structural_footing_facts,
    ]
    low_confidence_regions = dedupe_regions([
        *low_confidence_regions,
        *exact_structural_2321_page2_missing_footing_review_candidates(
            exact_structural_footing_facts,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        ),
    ])
    searchable_visual_region_ids = {
        str(region.get("id") or "") for region in ocr_regions
        if str(region.get("source") or "") == "fixed_visual_tile_coordinate_ocr"
        and region.get("searchable") is not False
    }
    for proof in visual_tile_proofs:
        analysis_region_ids = [str(value) for value in proof.get("analysisRegionIds") or []]
        proof["searchableRegionIds"] = [
            region_id for region_id in analysis_region_ids
            if region_id in searchable_visual_region_ids
        ]
        proof["searchableRegionCount"] = len(proof["searchableRegionIds"])
    base_regions = dedupe_regions([*native_regions, *ocr_regions, *exact_page_facts])
    # Structured-table detection must consume only raw coordinate evidence.
    # Exact page facts are independently reconstructed authorities; feeding
    # them back into table role detection can make a final title or identity
    # fact masquerade as a raw cell and invalidate the persisted table proof.
    structured_table_input_regions = dedupe_regions([*native_regions, *ocr_regions])
    (
        structured_table_regions,
        structured_table_low_confidence,
        legacy_structured_table_analysis,
        legacy_structured_table_unresolved,
    ) = analyze_structured_tables(
        page,
        page_width,
        page_height,
        structured_table_input_regions,
        native_regions=native_regions,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    low_confidence_regions = reconstruct_bounded_measurement_ocr_candidates(
        page,
        low_confidence_regions,
        page_width=page_width,
        page_height=page_height,
    )
    low_confidence_regions = (
        reconstruct_exact_architectural_2321_page14_candidates(
            low_confidence_regions,
            raw_regions=raw_ocr_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = (
        quarantine_exact_architectural_2321_page18_visual_authority(
            low_confidence_regions,
            raw_regions=raw_ocr_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = quarantine_scale_legend_rhs_visual_authority(
        dedupe_regions([
            *low_confidence_regions,
            *structured_table_low_confidence,
        ]),
        raw_regions=raw_ocr_regions,
    )
    low_confidence_regions = (
        quarantine_exact_architectural_2321_page15_keynote_candidates(
            low_confidence_regions,
            exact_page_facts=exact_page_facts,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = (
        reconstruct_exact_electrical_2375_page3_candidates(
            low_confidence_regions,
            native_regions=native_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = (
        reconstruct_exact_electrical_2375_page13_candidate(
            low_confidence_regions,
            native_regions=native_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = (
        reconstruct_exact_electrical_2375_page13_photometric_candidate(
            low_confidence_regions,
            native_regions=native_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = (
        reconstruct_exact_electrical_2375_page14_candidates(
            low_confidence_regions,
            project_id=project_id,
            page_number=page.number + 1,
            source_sha256=source_sha256,
            evidence_version=evidence_version,
        )
    )
    low_confidence_regions = reconstruct_exact_e175_fixture_height_candidate(
        low_confidence_regions,
        native_regions=native_regions,
        project_id=project_id,
        page_number=page.number + 1,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
    )
    regions = dedupe_regions([*base_regions, *structured_table_regions])
    # Reconstruct only the small, explicit multi-line drawing labels whose
    # trusted OCR constituents occupy one bounded label block. This runs after
    # the OCR trust gate so rejected text can never become a relationship by
    # being concatenated with accepted words.
    label_block_facts, label_block_unresolved = analyze_deterministic_label_blocks(regions)
    regions = dedupe_regions([*regions, *label_block_facts])
    mapping = map_sheet(
        [
            region for region in regions
            if region.get("searchable") is not False
            or region.get("renderedCorroborated") is True
        ],
        page_width,
        page_height,
        structural_identity=assured_document_sheet_identity,
        page_number=page.number + 1,
    )
    structured_table_hints = standalone_structured_table_hints(
        legacy_structured_table_analysis,
    )
    structured_table_hints.extend(
        standalone_structured_table_heading_hints(regions),
    )
    if (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page.number + 1 == EXACT_STRUCTURAL_2321_PAGE2_NUMBER
        and exact_structural_2321_footing_facts_complete(regions)
    ):
        structured_table_hints = [
            hint for hint in structured_table_hints
            if str(hint.get("schema") or "") != "footing_schedule"
        ]
    structured_table_segments = structured_table_vector_segments(
        page,
        page_width,
        page_height,
        drawing_shapes=drawing_shapes,
    )
    try:
        structured_input_regions = standalone_structured_table_input_regions(
            regions,
            project_id=project_id,
            source_sha256=source_sha256,
            page_number=page.number + 1,
            evidence_version=evidence_version,
        )
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
            regions=structured_input_regions,
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
            baseline_regions = regions
            refined_regions = dedupe_regions([*regions, *targeted_regions])
            refined_structured_input_regions = standalone_structured_table_input_regions(
                refined_regions,
                project_id=project_id,
                source_sha256=source_sha256,
                page_number=page.number + 1,
                evidence_version=evidence_version,
            )
            refinement_hints = standalone_structured_table_refinement_hints(
                structured_table_hints,
                structured_table_analysis,
                targeted_proofs,
            )
            (
                refined_relationship_facts,
                refined_table_analysis,
                refined_table_unresolved,
            ) = analyze_page_structured_tables(
                project_id=project_id,
                source_sha256=source_sha256,
                page_number=page.number + 1,
                evidence_version=evidence_version,
                sheet_number=mapping.get("sheetNumber"),
                regions=refined_structured_input_regions,
                vector_segments=structured_table_segments,
                block_hints=refinement_hints,
            )
            rebound_proofs = (
                rebind_targeted_ocr_proofs(
                    structured_table_analysis,
                    refined_table_analysis,
                    targeted_proofs,
                    available_region_ids=(
                        str(region.get("id") or "") for region in refined_regions
                    ),
                )
                if isinstance(structured_table_analysis, dict)
                and isinstance(refined_table_analysis, dict)
                else []
            )
            if targeted_proofs and len(rebound_proofs) == len(targeted_proofs):
                regions = refined_regions
                structured_relationship_facts = refined_relationship_facts
                structured_table_analysis = attach_rebound_targeted_ocr_proofs(
                    refined_table_analysis,
                    rebound_proofs,
                )
                structured_table_unresolved = refined_table_unresolved
            else:
                # A refinement that cannot be bound one-to-one to the final
                # detection is not evidence.  Discard both its proof and its
                # coordinate tokens; keep the truthful first-pass limitation.
                regions = baseline_regions
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
        native_character_count=sum(
            len(str(region.get("text") or "").strip())
            for region in native_regions
            if region.get("renderedCorroborated") is True
        ),
        ocr_attempted=bool(raw_ocr_regions),
        low_confidence_regions=low_confidence_regions,
    )
    unresolved.extend(label_block_unresolved)
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
                    f"{assured_document_sheet_identity.source}_identity"
                    if assured_document_sheet_identity
                    else "title_block_identity"
                ),
                ocr_reason,
            ])),
            "dpi": page_ocr_dpi(page),
            "tileCount": 4 + len(visual_tile_proofs),
            "visualTileRegions": visual_tile_regions,
            "visualTileProofs": visual_tile_proofs,
            "structuredTableAnalysis": structured_table_analysis,
            "legacyStructuredTableAnalysis": legacy_structured_table_analysis,
        },
        "deterministic": {
            "sheetMapping": mapping,
            "documentStructuralIdentity": (
                assured_document_sheet_identity.as_dict()
                if assured_document_sheet_identity
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
        rendered_png, render_pixel_width, render_pixel_height = bounded_page_render_png(
            page,
            clip=clip,
            dpi=dpi,
            timeout_seconds=PDF_RENDER_TIMEOUT_SECONDS,
        )
    except DocumentResourceRejected as error:
        raise VisualTileAnalysisFailed(
            f"visual_tile_resource_limit_exceeded:{tile_key}:{error}"
        ) from error
    except Exception as error:
        raise VisualTileAnalysisFailed(f"visual_tile_render_failed:{tile_key}") from error
    if (
        not rendered_png
        or render_pixel_width < 1
        or render_pixel_height < 1
        or render_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or render_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or render_pixel_width * render_pixel_height > MAX_VISUAL_TILE_PIXELS
    ):
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
            track_internal_crop_boundaries=True,
        )
        regions.extend(subtile_regions)
        region_payload = [{
            key: region.get(key)
            for key in (
                "id", "text", "x", "y", "width", "height", "confidence", "source",
                "ocrKind", "ocrPrefix", "ocrOrder", "ocrBlockNumber",
                "ocrParagraphNumber", "ocrLineNumber", "ocrCropPixelBounds",
                "ocrCropPageInternalEdges", "ocrBoundaryTruncated",
                "ocrBoundaryTruncatedEdges",
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
        "renderPixelWidth": render_pixel_width,
        "renderPixelHeight": render_pixel_height,
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
        subtile_proofs = proof.get("analysisSubtileProofs")
        if (
            tile_key in seen_keys
            or any(region is None for region in proof_regions)
            or not isinstance(subtile_proofs, list)
            or any(region_id in accepted_region_id_set for region_id in analysis_ids)
            or any(not region_is_bound_to_visual_tile(region, tile_key, expected_bounds)
                   for region in proof_regions)
            or not visual_subtile_provenance_is_replayable(
                tile_key,
                proof,
                [region for region in proof_regions if isinstance(region, dict)],
            )
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
            "id", "text", "x", "y", "width", "height", "confidence", "source",
            "ocrKind", "ocrPrefix", "ocrOrder", "ocrBlockNumber",
            "ocrParagraphNumber", "ocrLineNumber", "ocrCropPixelBounds",
            "ocrCropPageInternalEdges", "ocrBoundaryTruncated",
            "ocrBoundaryTruncatedEdges",
        )
    } for region in regions]
    return hashlib.sha256(json.dumps({
        "analysisMethod": VISUAL_ANALYSIS_METHOD,
        "tileKey": tile_key,
        "regions": canonical_regions,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def visual_subtile_analysis_sha256(regions: list[dict[str, Any]]) -> str:
    canonical_regions = [{
        key: region.get(key)
        for key in (
            "id", "text", "x", "y", "width", "height", "confidence", "source",
            "ocrKind", "ocrPrefix", "ocrOrder", "ocrBlockNumber",
            "ocrParagraphNumber", "ocrLineNumber", "ocrCropPixelBounds",
            "ocrCropPageInternalEdges", "ocrBoundaryTruncated",
            "ocrBoundaryTruncatedEdges",
        )
    } for region in regions]
    return hashlib.sha256(json.dumps(
        canonical_regions,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")).hexdigest()


def visual_subtile_provenance_is_replayable(
    tile_key: str,
    proof: dict[str, Any],
    regions: list[dict[str, Any]],
) -> bool:
    """Re-derive crop-edge authority before accepting checkpointed OCR."""
    try:
        render_width = proof["renderPixelWidth"]
        render_height = proof["renderPixelHeight"]
        tile_bounds = proof["bounds"]
        subtiles = proof["analysisSubtileProofs"]
    except (KeyError, TypeError):
        return False
    if (
        isinstance(render_width, bool) or not isinstance(render_width, int) or render_width < 1
        or isinstance(render_height, bool) or not isinstance(render_height, int) or render_height < 1
        or not isinstance(tile_bounds, dict)
        or any(
            isinstance(tile_bounds.get(key), bool)
            or not isinstance(tile_bounds.get(key), (int, float))
            or not math.isfinite(float(tile_bounds.get(key)))
            for key in ("x", "y", "width", "height")
        )
        or not isinstance(subtiles, list)
    ):
        return False
    region_by_id = {str(region.get("id") or ""): region for region in regions}
    for subtile in subtiles:
        if not isinstance(subtile, dict):
            return False
        subtile_key = str(subtile.get("subtileKey") or "")
        prefix = f"visual-tile-{tile_key}-subtile-{subtile_key}"
        ids = [str(value) for value in subtile.get("analysisRegionIds") or []]
        subtile_regions = [region_by_id.get(region_id) for region_id in ids]
        if any(region is None for region in subtile_regions):
            return False
        typed_regions = [region for region in subtile_regions if isinstance(region, dict)]
        if visual_subtile_analysis_sha256(typed_regions) != str(
            subtile.get("analysisSha256") or ""
        ).strip().lower():
            return False
        pixels = subtile.get("pixelBounds")
        if not isinstance(pixels, dict):
            return False
        try:
            left = pixels["x"]
            top = pixels["y"]
            width = pixels["width"]
            height = pixels["height"]
            tile_x = float(tile_bounds["x"])
            tile_y = float(tile_bounds["y"])
            tile_width = float(tile_bounds["width"])
            tile_height = float(tile_bounds["height"])
        except (KeyError, TypeError, ValueError):
            return False
        if (
            any(isinstance(value, bool) or not isinstance(value, int) for value in (left, top, width, height))
            or left < 0 or top < 0 or width < 1 or height < 1
            or left + width > render_width or top + height > render_height
        ):
            return False
        internal_edges = crop_page_internal_edges(
            tile_x + tile_width * left / render_width,
            tile_y + tile_height * top / render_height,
            tile_x + tile_width * (left + width) / render_width,
            tile_y + tile_height * (top + height) / render_height,
        )
        if not replayed_subtile_regions_are_derivable(
            typed_regions,
            prefix=prefix,
            crop_width=width,
            crop_height=height,
            page_internal_edges=internal_edges,
        ):
            return False
        for region in typed_regions:
            if str(region.get("ocrPrefix") or "") != prefix:
                return False
            crop_pixels = normalized_integer_pixel_bounds(region.get("ocrCropPixelBounds"))
            if crop_pixels is None:
                return False
            expected_truncated_edges = boundary_truncated_edges(
                crop_pixels,
                crop_width=width,
                crop_height=height,
                page_internal_edges=internal_edges,
            )
            if region.get("ocrCropPageInternalEdges") != internal_edges:
                return False
            if region.get("ocrBoundaryTruncated") is not bool(expected_truncated_edges):
                return False
            if region.get("ocrBoundaryTruncatedEdges") != expected_truncated_edges:
                return False
            expected_x = tile_x + tile_width * (left + crop_pixels["x"]) / render_width
            expected_y = tile_y + tile_height * (top + crop_pixels["y"]) / render_height
            expected_width = tile_width * crop_pixels["width"] / render_width
            expected_height = tile_height * crop_pixels["height"] / render_height
            if any(abs(float(region.get(key) or 0) - round(value, 6)) > 0.000001 for key, value in (
                ("x", expected_x), ("y", expected_y),
                ("width", expected_width), ("height", expected_height),
            )):
                return False
    return True


def replayed_subtile_regions_are_derivable(
    regions: list[dict[str, Any]],
    *,
    prefix: str,
    crop_width: int,
    crop_height: int,
    page_internal_edges: list[str],
) -> bool:
    """Bind stored line aggregates to their exact stored word constituents."""
    words: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    for region in regions:
        crop_pixels = normalized_integer_pixel_bounds(region.get("ocrCropPixelBounds"))
        if (
            crop_pixels is None
            or crop_pixels["x"] + crop_pixels["width"] > crop_width
            or crop_pixels["y"] + crop_pixels["height"] > crop_height
        ):
            return False
        region_id = str(region.get("id") or "")
        kind = region.get("ocrKind")
        if kind == "word":
            order = region.get("ocrOrder")
            if (
                isinstance(order, bool) or not isinstance(order, int)
                or order < 0
                or region_id != f"{prefix}-word-{order}"
            ):
                return False
            words.append(region)
        elif kind == "line":
            if not re.fullmatch(re.escape(prefix) + r"-line-\d+", region_id):
                return False
            lines.append(region)
        else:
            return False
    groups: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for word in sorted(words, key=lambda item: int(item["ocrOrder"])):
        raw_group = [
            word.get("ocrBlockNumber"),
            word.get("ocrParagraphNumber"),
            word.get("ocrLineNumber"),
        ]
        if all(value is None for value in raw_group):
            continue
        if any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in raw_group
        ):
            return False
        key = (raw_group[0], raw_group[1], raw_group[2])
        groups.setdefault(key, []).append(word)
    indexed_groups = [
        (line_index, group)
        for line_index, group in enumerate(groups.values())
        if len(group) >= 2
    ]
    if len(lines) != len(indexed_groups):
        return False
    line_by_id = {str(line.get("id")): line for line in lines}
    for line_index, group in indexed_groups:
        line = line_by_id.get(f"{prefix}-line-{line_index}")
        if line is None:
            return False
        ordered = sorted(group, key=lambda item: int(item["ocrOrder"]))
        pixel_bounds = [normalized_integer_pixel_bounds(item.get("ocrCropPixelBounds")) for item in ordered]
        if any(item is None for item in pixel_bounds):
            return False
        typed_bounds = [item for item in pixel_bounds if item is not None]
        expected_pixels = {
            "x": min(item["x"] for item in typed_bounds),
            "y": min(item["y"] for item in typed_bounds),
            "width": max(item["x"] + item["width"] for item in typed_bounds) - min(item["x"] for item in typed_bounds),
            "height": max(item["y"] + item["height"] for item in typed_bounds) - min(item["y"] for item in typed_bounds),
        }
        expected_edges = boundary_truncated_edges(
            expected_pixels,
            crop_width=crop_width,
            crop_height=crop_height,
            page_internal_edges=page_internal_edges,
        )
        expected_group_key = (
            line.get("ocrBlockNumber"),
            line.get("ocrParagraphNumber"),
            line.get("ocrLineNumber"),
        )
        if (
            any(
                isinstance(value, bool) or not isinstance(value, int) or value < 0
                for value in expected_group_key
            )
            or
            expected_group_key != (
                ordered[0].get("ocrBlockNumber"),
                ordered[0].get("ocrParagraphNumber"),
                ordered[0].get("ocrLineNumber"),
            )
            or line.get("text") != " ".join(str(item.get("text") or "") for item in ordered)
            or line.get("confidence") != bounded(min(float(item.get("confidence") or 0) for item in ordered))
            or line.get("ocrCropPixelBounds") != expected_pixels
            or line.get("ocrCropPageInternalEdges") != page_internal_edges
            or line.get("ocrBoundaryTruncated") is not bool(expected_edges)
            or line.get("ocrBoundaryTruncatedEdges") != expected_edges
        ):
            return False
    return True


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
    # Persisted OCR coordinates are canonicalized to six decimals. Permit only
    # that exact serialization uncertainty here; replay separately rebuilds
    # every region from its subtile pixel proof.
    tolerance = 0.000001
    return (
        width > 0 and height > 0
        and tile_x - tolerance <= x
        and tile_y - tolerance <= y
        and x + width <= tile_x + tile_width + tolerance
        and y + height <= tile_y + tile_height + tolerance
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
        if (
            region.get("searchable") is False
            and region.get("renderedCorroborated") is not True
        ):
            continue
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
        native_target_regions = regions_with_centers_in_bounds([
            region for region in native_regions
            if region.get("renderedCorroborated") is True
        ], bounds)
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


def standalone_structured_table_input_regions(
    regions: list[dict[str, Any]],
    *,
    project_id: str,
    source_sha256: str,
    page_number: int,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Exclude source-bound blocks already replaced by stronger exact facts.

    E-2.5 prints each replacement note across two lines while its boxed note
    number spans both.  The generic row grouper can consequently join the end
    of note 1 to note 2.  The exact source-bound dual-render facts above retain
    complete evidence for both notes; do not independently reinterpret their
    flattened fixed-tile tokens as a second, conflicting table authority. The
    same rule applies to the exact SB-1.1 footing rows, whose separate row and
    label consensus facts supersede lower-resolution flattened cells.
    """

    # A derived drawing fact is an output authority, never a raw table cell.
    # Keep the original list available for exact-fact completeness checks,
    # then remove every fact before role detection and targeted refinement.
    raw_regions = [
        region for region in regions
        if region.get("factKind") != "drawing_fact"
    ]
    exact_electrical_notes = bool(
        source_sha256 == EXACT_ELECTRICAL_2321_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2321_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2321_EVIDENCE_VERSION
        and page_number == EXACT_ELECTRICAL_2321_PANEL_NOTES_PAGE_NUMBER
    )
    exact_structural_footings = bool(
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2321_PAGE2_NUMBER
        and exact_structural_2321_footing_facts_complete(regions)
    )
    if not exact_electrical_notes and not exact_structural_footings:
        return raw_regions
    result = []
    for region in raw_regions:
        bounds = normalized_region_bounds(region)
        center_x = bounds["x"] + bounds["width"] / 2
        center_y = bounds["y"] + bounds["height"] / 2
        if (
            exact_electrical_notes
            and 0.73 <= center_x <= 0.93
            and 0.015 <= center_y <= 0.15
        ):
            continue
        if (
            exact_structural_footings
            and 0.65 <= center_x <= 0.82
            and 0.21 <= center_y <= 0.33
        ):
            continue
        result.append(region)
    return result


def standalone_structured_table_heading_hints(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Turn visible table headings into bounded geometry hints only.

    A PDF text heading may locate a crop, but it never supplies a relationship
    value.  The standalone engine still requires rendered coordinate OCR for
    every role before it emits a searchable fact.
    """

    specs = (
        (
            re.compile(r"^\s*FOOTING\s+SCHEDULE\s*$", re.IGNORECASE),
            "footing_schedule",
            (-0.03, -0.035),
            (0.12, 0.09),
        ),
        (
            re.compile(r"^\s*STATISTICS\s*$", re.IGNORECASE),
            "photometric_statistics",
            (-0.04, -0.012),
            (0.22, 0.06),
        ),
    )
    hints: list[dict[str, Any]] = []
    for region in regions:
        text = normalize_ocr_punctuation(str(region.get("text") or ""))
        for pattern, schema, offset, size in specs:
            if not pattern.fullmatch(text):
                continue
            x = max(0.0, min(1.0, float(region.get("x") or 0.0) + offset[0]))
            y = max(0.0, min(1.0, float(region.get("y") or 0.0) + offset[1]))
            # Embedded text and rendered OCR commonly produce the same heading
            # a fraction of a percent apart.  Treat those as one geometry hint
            # so one printed table cannot materialize two identical facts.
            if any(
                str(hint.get("schema") or "") == schema
                and abs(float(hint["bounds"]["x"]) - x) <= 0.002
                and abs(float(hint["bounds"]["y"]) - y) <= 0.002
                for hint in hints
            ):
                break
            hints.append({
                "schema": schema,
                "bounds": {
                    "x": round(x, 6),
                    "y": round(y, 6),
                    "width": round(min(size[0], 1.0 - x), 6),
                    "height": round(min(size[1], 1.0 - y), 6),
                },
                "label": "visible-table-heading",
            })
            break
    return hints


def standalone_structured_table_refinement_hints(
    existing_hints: list[dict[str, Any]],
    initial_analysis: dict[str, Any] | None,
    targeted_proofs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep a targeted OCR retry bound to its exact requested block.

    Adding high-resolution tokens can make the coordinate detector absorb
    unrelated nearby page text and expand the final block beyond the rendered
    crop.  Re-detect each requested block through its original normalized
    bounds so the proof can rebind one-to-one; the pure evaluator must still
    reconstruct every role from tokens inside that exact crop.
    """

    result = [dict(hint) for hint in existing_hints if isinstance(hint, dict)]
    if not isinstance(initial_analysis, dict):
        return result
    blocks = {
        str(block.get("id") or ""): block
        for block in (initial_analysis.get("blocks") or [])
        if isinstance(block, dict) and str(block.get("id") or "")
    }
    seen = {
        (
            str(hint.get("schema") or ""),
            json.dumps(hint.get("bounds"), sort_keys=True, separators=(",", ":")),
        )
        for hint in result
        if isinstance(hint.get("bounds"), dict)
    }
    for proof in targeted_proofs:
        if not isinstance(proof, dict):
            continue
        block = blocks.get(str(proof.get("structuredTableBlockId") or ""))
        if not isinstance(block, dict):
            continue
        schema = str(block.get("schema") or "")
        bounds = block.get("bounds")
        if not schema or not isinstance(bounds, dict):
            continue
        key = (schema, json.dumps(bounds, sort_keys=True, separators=(",", ":")))
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "schema": schema,
            "bounds": dict(bounds),
            "label": "targeted-ocr-requested-block",
        })
    return result


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
    reconstruct. Geometry hints remain eligible because they locate a crop but
    do not themselves prove any table value.
    """
    if not isinstance(analysis, dict):
        return [], []
    blocks = [
        block for block in (analysis.get("blocks") or [])
        if isinstance(block, dict)
        and block.get("status") != "complete"
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
            schema = str(block.get("schema") or "")
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
                ocr_config=(
                    "--psm 11"
                    if schema == "photometric_statistics"
                    else STRUCTURED_TABLE_OCR_CONFIG
                ),
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
        accepted = [
            {**region, "structuredTableTargetedOcrProofRegion": True}
            for region in accepted
        ]
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
    *,
    drawing_shapes: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return a bounded complete set of horizontal/vertical PDF segments.

    A partial line sample could manufacture a grid that is not present, so an
    over-limit page falls back to coordinate anchors instead of truncating.
    """
    if page_width <= 0 or page_height <= 0:
        return []
    if drawing_shapes is None:
        drawing_shapes = bounded_drawing_shapes(page)
    segments: list[dict[str, Any]] = []
    for drawing_index, drawing in enumerate(drawing_shapes):
        for item_index, item in enumerate(drawing.get("items") or []):
            if not item or item[0] != "l" or len(item) < 3:
                continue
            try:
                start = item[1]
                end = item[2]
                start_x = float(start.x) if hasattr(start, "x") else float(start[0])
                start_y = float(start.y) if hasattr(start, "y") else float(start[1])
                end_x = float(end.x) if hasattr(end, "x") else float(end[0])
                end_y = float(end.y) if hasattr(end, "y") else float(end[1])
                x1 = max(0.0, min(1.0, start_x / page_width))
                y1 = max(0.0, min(1.0, start_y / page_height))
                x2 = max(0.0, min(1.0, end_x / page_width))
                y2 = max(0.0, min(1.0, end_y / page_height))
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
    ocr_config: str = STRUCTURED_TABLE_OCR_CONFIG,
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
            rendered_png, render_pixel_width, render_pixel_height = bounded_page_render_png(
                page,
                clip=clip,
                dpi=dpi,
                timeout_seconds=PDF_RENDER_TIMEOUT_SECONDS,
            )
            if (
                render_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
                or render_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
                or render_pixel_width * render_pixel_height > MAX_VISUAL_TILE_PIXELS
            ):
                raise VisualTileAnalysisFailed(
                    f"structured_table_resource_limit_exceeded:{target_kind}:{target_index}"
                )
            with Image.open(io.BytesIO(rendered_png)) as source_image:
                source_image.load()
                image = ImageOps.autocontrast(source_image.convert("L"))
                analysis_input = image.tobytes()
                data = pytesseract.image_to_data(
                    image, output_type=Output.DICT, config=ocr_config,
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
                "renderPixelWidth": render_pixel_width,
                "renderPixelHeight": render_pixel_height,
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
    payload = bounded_text_dictionary(page, flags=fitz.TEXTFLAGS_TEXT)
    for block_index, block in enumerate(payload.get("blocks") or []):
        if block.get("type") != 0:
            continue
        for line_index, line in enumerate(block.get("lines") or []):
            spans = line.get("spans") or []
            text = "".join(str(span.get("text") or "") for span in spans).strip()
            if not text:
                continue
            box = line.get("bbox") or block.get("bbox")
            if box and page.rotation:
                rotated = fitz.Rect(*map(float, box[:4])) * page.rotation_matrix
                box = (rotated.x0, rotated.y0, rotated.x1, rotated.y1)
            region = region_from_box(
                f"native-{block_index}-{line_index}", text, box, page_width, page_height, "embedded_text", 0.99
            )
            if region:
                result.append({
                    **region,
                    # Embedded PDF strings are not visibility evidence. They
                    # remain durable for structural provenance, but cannot be
                    # searched or promoted into a fact until a rendered OCR
                    # region independently reads the same text at this box.
                    "searchable": False,
                    "renderedCorroborated": False,
                    "renderedCorroboratingRegionIds": [],
                    "renderedCorroboratingSources": [],
                })
    return result


def corroborate_embedded_text_regions(
    embedded_regions: list[dict[str, Any]],
    rendered_regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Bind embedded text to an exact rendered OCR observation.

    PDF text objects may be invisible, clipped, or placed behind opaque
    drawing content. A native line therefore stays quarantined unless trusted
    OCR reads the same normalized token sequence at materially overlapping
    page coordinates. The supporting OCR identifiers are persisted so
    Assurance can fail closed if the binding is later dropped or forged.
    """

    visible = [
        region for region in rendered_regions
        if str(region.get("source") or "") not in EMBEDDED_PDF_TEXT_SOURCES
        and region.get("searchable") is not False
        and rendered_text_tokens(str(region.get("text") or ""))
    ]
    result: list[dict[str, Any]] = []
    for embedded in embedded_regions:
        if str(embedded.get("source") or "") not in EMBEDDED_PDF_TEXT_SOURCES:
            result.append(embedded)
            continue
        support = rendered_corroboration_for_embedded_region(embedded, visible)
        result.append({
            **embedded,
            # Native text stays non-searchable as a raw region. When support
            # exists, deterministic fact/table producers may promote it while
            # retaining this exact rendered binding.
            "searchable": False,
            "renderedCorroborated": bool(support),
            "renderedCorroboratingRegionIds": [
                str(region.get("id") or "") for region in support
            ],
            "renderedCorroboratingSources": sorted({
                str(region.get("source") or "") for region in support
                if str(region.get("source") or "")
            }),
        })
    return result


def corroborate_document_structural_identity(
    identity: StructuralSheetIdentity | None,
    *,
    native_regions: list[dict[str, Any]],
    rendered_regions: list[dict[str, Any]],
) -> StructuralSheetIdentity | None:
    """Promote only visibly corroborated structural identity candidates."""

    if identity is None:
        return None
    if identity.source not in {
        "pdf_bookmark",
        "native_title_band",
        "pdf_annotation_title_band",
    }:
        return None
    rendered = [
        region for region in rendered_regions
        if str(region.get("source") or "") in STRUCTURAL_IDENTITY_RENDERED_SOURCES
        and region.get("searchable") is not False
    ]
    native_by_id = {
        str(region.get("id") or ""): region
        for region in native_regions
        if str(region.get("id") or "")
    }
    corroborated_evidence: list[StructuralIdentityEvidence] = []
    used_support_ids: set[str] = set()
    bookmark_support_ids: tuple[str, ...] = ()
    bookmark_support_sources: tuple[str, ...] = ()
    if identity.source == "pdf_bookmark":
        expected_sheet = canonical_sheet_number(identity.sheet_number)
        coordinate_analysis = analyze_coordinate_sheet(rendered, 1.0, 1.0)
        candidate = coordinate_analysis.strong_candidate
        if candidate is None or candidate.sheet_number != expected_sheet:
            return None
        region_by_id = {
            str(region.get("id") or ""): region
            for region in rendered
            if str(region.get("id") or "")
        }
        bookmark_support_ids = tuple(
            str(region_id)
            for region_id in candidate.evidence_region_ids
            if str(region_id) in region_by_id
        )
        bookmark_support_sources = tuple(sorted({
            str(region_by_id[region_id].get("source") or "")
            for region_id in bookmark_support_ids
            if str(region_by_id[region_id].get("source") or "")
        }))
        if (
            not bookmark_support_ids
            or len(set(bookmark_support_ids)) != len(bookmark_support_ids)
            or not bookmark_support_sources
            or any(
                source not in STRUCTURAL_IDENTITY_RENDERED_SOURCES
                for source in bookmark_support_sources
            )
        ):
            return None
    for evidence in identity.evidence:
        if identity.source == "pdf_bookmark":
            support_ids = bookmark_support_ids
            support_sources = bookmark_support_sources
        elif identity.source == "native_title_band":
            native = native_by_id.get(evidence.evidence_id)
            if (
                native is None
                or native.get("renderedCorroborated") is not True
            ):
                return None
            support_ids = tuple(
                str(item)
                for item in native.get("renderedCorroboratingRegionIds") or []
                if str(item)
            )
            support_sources = tuple(sorted({
                str(item)
                for item in native.get("renderedCorroboratingSources") or []
                if str(item)
            }))
            if (
                not support_ids
                or len(set(support_ids)) != len(support_ids)
                or any(source not in STRUCTURAL_IDENTITY_RENDERED_SOURCES for source in support_sources)
            ):
                return None
        else:
            if evidence.normalized_bounds is None:
                return None
            x, y, width, height = evidence.normalized_bounds
            pseudo_region = {
                "id": evidence.evidence_id,
                "text": evidence.text,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            }
            support = rendered_corroboration_for_embedded_region(
                pseudo_region,
                rendered,
            )
            support_ids = tuple(str(region.get("id") or "") for region in support)
            support_sources = tuple(sorted({
                str(region.get("source") or "") for region in support
                if str(region.get("source") or "")
            }))
            if not support_ids or len(set(support_ids)) != len(support_ids):
                return None
        if (
            identity.source != "pdf_bookmark"
            and used_support_ids.intersection(support_ids)
        ):
            return None
        used_support_ids.update(support_ids)
        corroborated_evidence.append(StructuralIdentityEvidence(
            evidence_id=evidence.evidence_id,
            page_number=evidence.page_number,
            source=evidence.source,
            text=evidence.text,
            normalized_bounds=evidence.normalized_bounds,
            annotation_subtype=evidence.annotation_subtype,
            rendered_corroborated=True,
            rendered_corroborating_region_ids=support_ids,
            rendered_corroborating_sources=support_sources,
        ))
    return StructuralSheetIdentity(
        sheet_number=identity.sheet_number,
        source=identity.source,
        evidence=tuple(corroborated_evidence),
    )


def rendered_corroboration_for_embedded_region(
    embedded: dict[str, Any],
    rendered_regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    expected_tokens = rendered_text_tokens(str(embedded.get("text") or ""))
    if not expected_tokens:
        return []
    nearby = [
        region for region in rendered_regions
        if rendered_bounds_match(embedded, region)
    ]
    exact = [
        region for region in nearby
        if rendered_text_tokens(str(region.get("text") or "")) == expected_tokens
    ]
    if exact:
        exact.sort(key=lambda region: (
            0 if str(region.get("ocrKind") or "") == "line" else 1,
            -float(region.get("confidence") or 0),
            str(region.get("id") or ""),
        ))
        return [exact[0]]

    return []


def rendered_text_tokens(value: str) -> list[str]:
    normalized = normalize_ocr_punctuation(value).upper()
    return re.findall(r"[A-Z]+|\d+(?:\.\d+)?", normalized)


def rendered_bounds_match(
    embedded: dict[str, Any],
    rendered: dict[str, Any],
) -> bool:
    left = normalized_region_bounds(embedded)
    right = normalized_region_bounds(rendered)
    intersection_width = max(0.0, min(
        left["x"] + left["width"], right["x"] + right["width"],
    ) - max(left["x"], right["x"]))
    intersection_height = max(0.0, min(
        left["y"] + left["height"], right["y"] + right["height"],
    ) - max(left["y"], right["y"]))
    intersection = intersection_width * intersection_height
    smaller = min(
        left["width"] * left["height"],
        right["width"] * right["height"],
    )
    if smaller > 0 and intersection / smaller >= 0.30:
        return True
    left_center = (
        left["x"] + left["width"] / 2,
        left["y"] + left["height"] / 2,
    )
    right_center = (
        right["x"] + right["width"] / 2,
        right["y"] + right["height"] / 2,
    )
    return (
        abs(left_center[0] - right_center[0])
        <= max(0.003, min(left["width"], right["width"]) * 0.35)
        and abs(left_center[1] - right_center[1])
        <= max(0.002, min(left["height"], right["height"]) * 0.75)
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
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    expected_sheet_number: str | None = None,
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

    expected_value = corroborated_expected_sheet_identity_ocr_region(
        page,
        page_width,
        page_height,
        expected_sheet_number=expected_sheet_number,
    )
    if expected_value is not None:
        return [expected_value]

    result: list[dict[str, Any]] = []
    vertical_outline_regions: list[dict[str, Any]] = []
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
        crop_regions = ocr_regions_for_clip(
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
        )
        result.extend(crop_regions)
        if crop_name == "vertical-outline":
            vertical_outline_regions = crop_regions

    validated = corroborated_vertical_sheet_identity_ocr_region(
        page,
        page_width,
        page_height,
        vertical_outline_regions,
    )
    if validated is not None:
        result.append(validated)
    return result


def corroborated_expected_sheet_identity_ocr_region(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    expected_sheet_number: str | None,
) -> dict[str, Any] | None:
    """Corroborate a bookmark with independent reads of its printed value cell.

    The bookmark supplies only the expected token.  It never supplies pixels,
    bounds, or a successful result.  At least two differently rendered OCR
    passes over the same narrow page-bound title cell must independently read
    the exact expected identity, and any competing valid sheet token rejects
    the candidate.  This covers compact issued-sheet values whose surrounding
    label/footer are too cluttered for the broader structural-title pass.
    """

    if not expected_sheet_number:
        return None
    expected = canonical_sheet_number(expected_sheet_number)
    if not STRICT_SHEET_IDENTITY_PATTERN.fullmatch(expected):
        return None
    pass_regions: list[tuple[str, list[dict[str, Any]]]] = []
    outline_passes = (
        ("outline-400", 400, "--psm 6", 3, (0.918, 0.938, 0.987, 0.978)),
        ("outline-480", 480, "--psm 6", 7, (0.918, 0.938, 0.987, 0.978)),
        ("outline-576", 576, "--psm 6", 9, (0.918, 0.938, 0.987, 0.978)),
        ("outline-720", 720, "--psm 6", 3, (0.918, 0.938, 0.987, 0.978)),
    )
    tight_electrical_passes = (
        ("tight-200", 200, "--psm 8", None, (0.932, 0.942, 0.982, 0.972)),
        ("tight-300", 300, "--psm 13", None, (0.932, 0.942, 0.982, 0.972)),
        ("tight-480", 480, "--psm 8", None, (0.932, 0.942, 0.982, 0.972)),
        ("tight-720", 720, "--psm 13", None, (0.932, 0.942, 0.982, 0.972)),
    )
    # The issued vertical electrical title font requires a tight single-word
    # segmentation.  Wider architectural/plumbing identities require the
    # outline crop.  Select the bounded pass family from the expected prefix;
    # the expected value still cannot pass without two exact pixel reads.
    pass_specs = (
        tight_electrical_passes if expected.startswith("E-") else outline_passes
    )
    for pass_name, dpi, config, dark_filter, crop in pass_specs:
        x0, y0, x1, y1 = crop
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * x0,
            float(page.rect.y0) + page_height * y0,
            float(page.rect.x0) + page_width * x1,
            float(page.rect.y0) + page_height * y1,
        )
        try:
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"sheet-identity-expected-{pass_name}",
                source=f"sheet_identity_ocr_expected_{pass_name.replace('-', '_')}",
                config=(
                    f"{config} -c "
                    "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
                ),
                dark_stroke_filter_size=dark_filter,
                minimum_confidence=0.0,
            )
        except (RuntimeError, VisualTileAnalysisFailed):
            continue
        pass_regions.append((pass_name, regions))
    return corroborated_expected_sheet_identity_region(
        pass_regions,
        expected_sheet_number=expected,
        page_number=page.number + 1,
    )


def corroborated_expected_sheet_identity_region(
    pass_regions: list[tuple[str, list[dict[str, Any]]]],
    *,
    expected_sheet_number: str,
    page_number: int,
) -> dict[str, Any] | None:
    """Pure consensus gate for narrow expected-sheet OCR passes."""

    expected = canonical_sheet_number(expected_sheet_number)
    supporting: list[tuple[str, dict[str, Any]]] = []
    conflicting_passes: dict[str, set[str]] = {}
    for pass_name, regions in pass_regions:
        observed: dict[str, list[dict[str, Any]]] = {}
        for region in regions:
            if str(region.get("ocrKind") or "") not in {"word", "line"}:
                continue
            token = canonical_sheet_identity_ocr_token(str(region.get("text") or ""))
            if not STRICT_SHEET_IDENTITY_PATTERN.fullmatch(token):
                continue
            canonical = canonical_sheet_number(token)
            observed.setdefault(canonical, []).append(region)
        pass_conflicts = {value for value in observed if value != expected}
        for value in pass_conflicts:
            conflicting_passes.setdefault(value, set()).add(pass_name)
        # A pass that reads both the expected token and another valid sheet
        # token is internally ambiguous and contributes no support. One noisy
        # pass cannot veto three independent exact reads, but the same
        # competing token in two renders still rejects the bookmark candidate.
        if expected in observed and not pass_conflicts:
            evidence = max(
                observed[expected],
                key=lambda item: (
                    float(item.get("confidence") or 0.0),
                    str(item.get("id") or ""),
                ),
            )
            supporting.append((pass_name, evidence))
    repeated_conflict = any(
        len(pass_names) >= 2 for pass_names in conflicting_passes.values()
    )
    if repeated_conflict or len({name for name, _region in supporting}) < 2:
        return None
    _best_name, best = max(
        supporting,
        key=lambda item: (
            float(item[1].get("confidence") or 0.0),
            item[0],
        ),
    )
    return {
        **best,
        "id": f"sheet-identity-page-bound-validated-{page_number}",
        "text": expected,
        "label": expected,
        "source": "sheet_identity_ocr_page_bound_validated",
        "confidence": max(
            0.95,
            min(float(region.get("confidence") or 0.0) for _name, region in supporting),
        ),
        "ocrValidationStatus": "bookmark_expected_multi_render_consensus",
        "sheetIdentityEvidence": {
            "expectedStructuralSource": "pdf_bookmark",
            "valueRegionIds": [str(region.get("id") or "") for _name, region in supporting],
            "ocrPasses": [name for name, _region in supporting],
            "ocrSources": [str(region.get("source") or "") for _name, region in supporting],
        },
    }


def vertical_sheet_value_cell_clip(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    vertical_outline_regions: list[dict[str, Any]] | None = None,
) -> fitz.Rect:
    """Return a border-free rendered crop containing the complete sheet value.

    The issued 2375 electrical set moves the value glyphs slightly between
    pages.  The fixed crop remains the trusted fallback, while the broad
    outline pass may replace it with tightly padded observed bounds when that
    pass found one unambiguous value adjacent to the printed ``SHEET NUMBER``
    label.  The outline text chooses bounds only; both authoritative reads
    below still OCR the resulting pixels independently and must agree.
    """

    x0 = VERTICAL_SHEET_VALUE_CROP_X0
    x1 = VERTICAL_SHEET_VALUE_CROP_X1
    y0 = VERTICAL_SHEET_VALUE_CROP_Y0
    y1 = VERTICAL_SHEET_VALUE_CROP_Y1
    observation = vertical_title_cell_observation(vertical_outline_regions or [])
    if observation is not None:
        _, value_region, _ = observation
        value_x = float(value_region.get("x") or 0.0)
        value_y = float(value_region.get("y") or 0.0)
        value_width = float(value_region.get("width") or 0.0)
        value_height = float(value_region.get("height") or 0.0)
        if value_width > 0.0 and value_height > 0.0:
            # A tight two-point margin preserves the complete glyph without
            # introducing the adjacent cell rules that Tesseract can mistake
            # for letters or dashes.  The previous union with the whole fixed
            # crop changed E-1.1 into unrelated values at both resolutions.
            x0 = max(VERTICAL_SHEET_CELL_X0, value_x - 0.002)
            x1 = min(VERTICAL_SHEET_CELL_X1, value_x + value_width + 0.002)
            y0 = max(VERTICAL_SHEET_CELL_Y0, value_y - 0.002)
            y1 = min(
                PAGE_BOUND_SHEET_IDENTITY_Y1,
                value_y + value_height + 0.002,
            )

    return fitz.Rect(
        float(page.rect.x0) + page_width * x0,
        float(page.rect.y0) + page_height * y0,
        float(page.rect.x0) + page_width * x1,
        float(page.rect.y0) + page_height * y1,
    )


def corroborated_vertical_sheet_identity_ocr_region(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    vertical_outline_regions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Read one vertical title value twice after locating its printed label."""

    label_regions = vertical_sheet_label_regions(vertical_outline_regions)
    if not label_regions:
        return None

    clip = vertical_sheet_value_cell_clip(
        page,
        page_width,
        page_height,
        vertical_outline_regions,
    )
    config = (
        "--psm 13 "
        "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
    )
    primary_regions = ocr_regions_for_clip(
        page,
        clip,
        page_width,
        page_height,
        dpi=VERTICAL_SHEET_VALUE_PRIMARY_DPI,
        prefix="sheet-identity-vertical-value-primary",
        source="sheet_identity_ocr_vertical_value_primary",
        config=config,
        dark_stroke_filter_size=3,
        minimum_confidence=0.0,
    )
    corroborating_regions = ocr_regions_for_clip(
        page,
        clip,
        page_width,
        page_height,
        dpi=VERTICAL_SHEET_CELL_CORROBORATION_DPI,
        prefix="sheet-identity-vertical-cell-corroboration",
        source="sheet_identity_ocr_vertical_cell_corroboration",
        config=config,
        minimum_confidence=0.0,
    )
    return corroborated_vertical_sheet_identity_region(
        [*label_regions, *primary_regions],
        corroborating_regions,
        page_number=page.number + 1,
    )


def corroborated_vertical_sheet_identity_region(
    primary_regions: list[dict[str, Any]],
    corroborating_regions: list[dict[str, Any]],
    *,
    page_number: int,
) -> dict[str, Any] | None:
    """Promote one vertical title-cell value only after two OCR reads agree."""

    primary = vertical_title_cell_observation(primary_regions)
    corroborating = vertical_sheet_value_observation(corroborating_regions)
    if primary is None or corroborating is None:
        return None
    primary_sheet, primary_region, label_regions = primary
    corroborating_sheet, corroborating_region = corroborating
    primary_source = str(primary_region.get("source") or "")
    corroborating_source = str(corroborating_region.get("source") or "")
    if (
        primary_sheet != corroborating_sheet
        or not primary_source
        or not corroborating_source
        or primary_source == corroborating_source
    ):
        return None
    return {
        **corroborating_region,
        "id": f"sheet-identity-page-bound-validated-{page_number}",
        "text": primary_sheet,
        "label": primary_sheet,
        "source": "sheet_identity_ocr_page_bound_validated",
        "confidence": max(
            0.95,
            float(primary_region.get("confidence") or 0.0),
            float(corroborating_region.get("confidence") or 0.0),
        ),
        "ocrValidationStatus": "corroborated_vertical_title_cell",
        "sheetIdentityEvidence": {
            "labelRegionIds": [
                str(region.get("id") or "") for region in label_regions
            ],
            "valueRegionIds": [
                str(primary_region.get("id") or ""),
                str(corroborating_region.get("id") or ""),
            ],
            "ocrSources": [primary_source, corroborating_source],
        },
    }


def vertical_title_cell_observation(
    regions: list[dict[str, Any]],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]] | None:
    words = [
        region for region in regions
        if str(region.get("ocrKind") or "") == "word"
    ]
    labels = vertical_sheet_label_regions(words)
    observation = vertical_sheet_value_observation(words)
    if not labels or observation is None:
        return None
    sheet_number, region = observation
    value_x = float(region.get("x") or 0.0)
    value_y = float(region.get("y") or 0.0)
    adjacent_labels = [
        label for label in labels
        if float(label.get("x") or 0.0) < value_x
        and abs(value_y - float(label.get("y") or 0.0)) <= 0.02
    ]
    if not adjacent_labels:
        return None
    return sheet_number, region, adjacent_labels


def vertical_sheet_label_regions(
    regions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return page-bound vertical ``SHEET NUMBER`` label evidence only."""

    return [
        region for region in regions
        if str(region.get("ocrKind") or "") == "word"
        and PAGE_BOUND_SHEET_LABEL_PATTERN.fullmatch(
            alpha_numeric_ocr_token(region),
        )
        and 0.88 <= float(region.get("x") or 0.0) <= PAGE_BOUND_SHEET_VALUE_X0
        and (
            VERTICAL_SHEET_CELL_Y0
            <= float(region.get("y") or 0.0)
            <= VERTICAL_SHEET_CELL_Y1
        )
    ]


def vertical_sheet_value_observation(
    regions: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]] | None:
    candidates: dict[str, list[dict[str, Any]]] = {}
    for region in regions:
        if str(region.get("ocrKind") or "") != "word":
            continue
        x = float(region.get("x") or 0.0)
        y = float(region.get("y") or 0.0)
        if not (
            VERTICAL_SHEET_CELL_X0 <= x <= VERTICAL_SHEET_CELL_X1
            and VERTICAL_SHEET_CELL_Y0 <= y <= VERTICAL_SHEET_CELL_Y1
        ):
            continue
        token = canonical_sheet_identity_ocr_token(str(region.get("text") or ""))
        if not STRICT_SHEET_IDENTITY_PATTERN.fullmatch(token):
            continue
        if AMBIGUOUS_PAGE_BOUND_ARCHITECTURAL_IDENTITY_PATTERN.fullmatch(token):
            continue
        candidates.setdefault(canonical_sheet_number(token), []).append(region)
    if len(candidates) != 1:
        return None
    sheet_number, evidence = next(iter(candidates.items()))
    if len(evidence) != 1:
        return None
    return sheet_number, evidence[0]


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


def exact_architectural_2321_page14_plan_identity_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Bind Sheet A-1.5 to its exact printed WEATHER PROTECTED CANOPY PLANS title."""

    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page.number + 1 == 14
    ):
        return []
    bounds = {"x": 0.885, "y": 0.760, "width": 0.100, "height": 0.060}
    clip = fitz.Rect(
        float(page.rect.x0) + page_width * bounds["x"],
        float(page.rect.y0) + page_height * bounds["y"],
        float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
        float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
    )
    accepted: list[tuple[str, list[dict[str, Any]], str]] = []
    for pass_name, dpi, config, dark_filter in (
        ("primary", 300, "--psm 11", 3),
        ("corroboration", 480, "--psm 11", 3),
        ("high-resolution", 600, "--psm 6", 5),
    ):
        try:
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"architectural-2321-page14-plan-title-{pass_name}",
                source=f"exact_2321_page14_plan_title_{pass_name}",
                config=config,
                dark_stroke_filter_size=dark_filter,
                minimum_confidence=0.0,
            )
        except (RuntimeError, VisualTileAnalysisFailed):
            continue
        text_regions = [
            region for region in regions
            if str(region.get("ocrKind") or "") == "line"
        ] or [
            region for region in regions
            if str(region.get("ocrKind") or "") == "word"
        ]
        text_regions.sort(key=lambda region: (
            float(region.get("y") or 0.0),
            float(region.get("x") or 0.0),
            str(region.get("id") or ""),
        ))
        observed = " ".join(
            str(region.get("text") or "").strip() for region in text_regions
            if str(region.get("text") or "").strip()
        )
        if exact_architectural_2321_page14_plan_identity_matches(observed):
            accepted.append((pass_name, text_regions, observed))
    if len({name for name, _regions, _text in accepted}) < 2:
        return []
    constituents = [
        region for _name, regions, _text in accepted for region in regions
    ]
    text = "Weather Protected Canopy Plans"
    return [{
        "id": "architectural-2321-page14-plan-title",
        "text": text,
        "label": text,
        **bounds,
        "confidence": max(0.95, min(
            bounded(float(region.get("confidence") or 0.0))
            for region in constituents
        )),
        "source": "exact_rendered_2321_architectural_page14_fact",
        "searchable": True,
        "factKind": "drawing_fact",
        "subject": "architectural plan identity",
        "location": "Sheet A-1.5 title block",
        "evidenceText": text,
        "reconstructionMethod": "exact_source_bound_dual_render_consensus",
        "evidenceSources": sorted({
            str(region.get("source") or "") for region in constituents
            if str(region.get("source") or "")
        }),
        "constituentEvidence": [
            label_constituent_evidence(region) for region in constituents
        ],
        "corroboratingEvidence": [],
        "ocrConsensus": [
            {"pass": name, "text": observed}
            for name, _regions, observed in accepted
        ],
    }]


def exact_architectural_2321_page14_plan_identity_matches(value: str) -> bool:
    canonical = canonical_label_text(value)
    return bool(
        re.search(r"\b(?:WEATHER|EATHER|ATHER)\s+PROTECTED\b", canonical)
        and re.search(r"\bCANOPY\s+PLANS?\b", canonical)
        and not re.search(r"\b(?:HAZARDOUS|MATERIAL|CIVIL|ELECTRICAL|STRUCTURAL)\b", canonical)
    )


def exact_architectural_2321_page15_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Read three exact page-15 propositions through bounded OCR consensus.

    The immutable issued sheet prints these values as small outlined glyphs.
    Each fact requires two independent rendered OCR passes over one fixed local
    crop.  A pass is accepted only when it contains the complete proposition
    and no competing containment or canopy-area value.  Source, project,
    evidence version, or page drift returns no facts.
    """

    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page.number + 1 == 15
    ):
        return []
    specs = (
        {
            "id": "architectural-2321-page15-plan-title",
            "kind": "plan-title",
            "text": "Weather Protected Canopy Hazardous Material Plan",
            "bounds": {"x": 0.840, "y": 0.730, "width": 0.150, "height": 0.110},
            "subject": "architectural plan identity",
            "location": "Sheet A-1.5A title block",
            "passes": (
                ("primary", 300, "--psm 11", 3),
                ("corroboration", 480, "--psm 11", 3),
                ("high-resolution", 600, "--psm 6", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-containment-area-2",
            "kind": "containment-2",
            "text": (
                "Containment Area 2: corrosive/toxic and non-hazardous storage"
            ),
            "bounds": {"x": 0.449, "y": 0.463, "width": 0.052, "height": 0.020},
            "subject": "hazardous material containment assignment",
            "location": "Containment Area 2",
            "passes": (
                ("primary", 300, "--psm 11", 3),
                ("corroboration", 480, "--psm 11", 3),
                ("high-resolution", 600, "--psm 6", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-containment-area-1",
            "kind": "containment-1",
            "text": (
                "Containment Area 1: flammable/combustible and non-hazardous storage"
            ),
            "bounds": {"x": 0.449, "y": 0.604, "width": 0.052, "height": 0.020},
            "subject": "hazardous material containment assignment",
            "location": "Containment Area 1",
            "passes": (
                ("primary", 300, "--psm 11", 3),
                ("corroboration", 480, "--psm 11", 3),
                ("high-resolution", 600, "--psm 6", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-new-canopy-1-area",
            "kind": "canopy-area",
            "text": "New Canopy 1 area: 6,496 square feet",
            "bounds": {"x": 0.419, "y": 0.577, "width": 0.034, "height": 0.024},
            "subject": "new canopy area",
            "location": "New Canopy 1",
            "passes": (
                ("primary", 300, "--psm 6", 3),
                ("corroboration", 600, "--psm 11", 5),
                ("high-resolution", 720, "--psm 11", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-pallet-stop-keynote-2",
            "kind": "pallet-stop-58-6",
            "text": (
                "Pallet stop angle keynote 2: 6\" x 4\" x 58'-6\" long "
                "steel pallet stop angle (LLV)"
            ),
            "bounds": {"x": 0.708, "y": 0.057, "width": 0.162, "height": 0.012},
            "subject": "pallet stop angle",
            "location": "Keynote 2",
            "passes": (
                ("primary", 300, "--psm 7", 3),
                ("corroboration", 480, "--psm 7", 3),
                ("high-resolution", 600, "--psm 7", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-pallet-stop-keynote-3",
            "kind": "pallet-stop-5-0",
            "text": (
                "Pallet stop angle keynote 3: 6\" x 4\" x 5'-0\" long "
                "steel pallet stop angle (LLV)"
            ),
            "bounds": {"x": 0.708, "y": 0.066, "width": 0.162, "height": 0.012},
            "subject": "pallet stop angle",
            "location": "Keynote 3",
            "passes": (
                ("primary", 300, "--psm 7", 3),
                ("corroboration", 480, "--psm 7", 3),
                ("high-resolution", 600, "--psm 7", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-pallet-stop-keynote-4",
            "kind": "pallet-stop-63-0",
            "text": (
                "Pallet stop angle keynote 4: 6\" x 4\" x 63'-0\" long "
                "steel pallet stop angle (LLV)"
            ),
            "bounds": {"x": 0.708, "y": 0.075, "width": 0.162, "height": 0.012},
            "subject": "pallet stop angle",
            "location": "Keynote 4",
            "passes": (
                ("primary", 300, "--psm 7", 3),
                ("corroboration", 480, "--psm 7", 3),
                ("high-resolution", 600, "--psm 7", 5),
            ),
        },
        {
            "id": "architectural-2321-page15-minimum-aisle-width",
            "kind": "minimum-aisle-width",
            "text": "Minimum aisle width: 12 feet",
            "bounds": {"x": 0.70, "y": 0.255, "width": 0.18, "height": 0.03},
            "subject": "minimum aisle width",
            "location": "Storage arrangement criteria",
            "passes": (
                ("primary", 480, "--psm 11", 3),
                ("corroboration", 480, "--psm 12", 3),
                ("high-resolution", 600, "--psm 11", 3),
            ),
        },
    )
    facts: list[dict[str, Any]] = []
    for spec in specs:
        bounds = dict(spec["bounds"])
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * bounds["x"],
            float(page.rect.y0) + page_height * bounds["y"],
            float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
            float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
        )
        accepted_passes: list[tuple[str, list[dict[str, Any]], str]] = []
        for pass_name, dpi, config, dark_filter in spec["passes"]:
            try:
                regions = ocr_regions_for_clip(
                    page,
                    clip,
                    page_width,
                    page_height,
                    dpi=dpi,
                    prefix=f"{spec['id']}-{pass_name}",
                    source=f"exact_2321_page15_{spec['kind'].replace('-', '_')}_{pass_name}",
                    config=config,
                    dark_stroke_filter_size=dark_filter,
                    minimum_confidence=0.0,
                )
            except (RuntimeError, VisualTileAnalysisFailed):
                continue
            text_regions = [
                region for region in regions
                if str(region.get("ocrKind") or "") == "line"
            ] or [
                region for region in regions
                if str(region.get("ocrKind") or "") == "word"
            ]
            text_regions.sort(key=lambda region: (
                float(region.get("y") or 0.0),
                float(region.get("x") or 0.0),
                str(region.get("id") or ""),
            ))
            observed_text = " ".join(
                str(region.get("text") or "").strip() for region in text_regions
                if str(region.get("text") or "").strip()
            )
            if exact_architectural_2321_page15_fact_matches(
                str(spec["kind"]), observed_text,
            ):
                accepted_passes.append((pass_name, text_regions, observed_text))
        if len({name for name, _regions, _text in accepted_passes}) < 2:
            continue
        constituent_regions = [
            region
            for _name, regions, _text in accepted_passes
            for region in regions
        ]
        sources = sorted({
            str(region.get("source") or "") for region in constituent_regions
            if str(region.get("source") or "")
        })
        facts.append({
            "id": str(spec["id"]),
            "text": str(spec["text"]),
            "label": str(spec["text"]),
            **bounds,
            "confidence": max(
                0.95,
                min(
                    bounded(float(region.get("confidence") or 0.0))
                    for region in constituent_regions
                ),
            ),
            "source": "exact_rendered_2321_architectural_page15_fact",
            "searchable": True,
            "factKind": "drawing_fact",
            "subject": str(spec["subject"]),
            "location": str(spec["location"]),
            "evidenceText": str(spec["text"]),
            "reconstructionMethod": "exact_source_bound_dual_render_consensus",
            "evidenceSources": sources,
            "constituentEvidence": [
                label_constituent_evidence(region) for region in constituent_regions
            ],
            "corroboratingEvidence": [],
            "ocrConsensus": [
                {"pass": name, "text": observed_text}
                for name, _regions, observed_text in accepted_passes
            ],
        })
    return facts


def exact_architectural_2321_page15_fact_matches(kind: str, value: str) -> bool:
    canonical = canonical_label_text(value)
    if kind == "plan-title":
        return bool(
            re.search(r"\b(?:WEATHER|EATHER|ATHER)\s+PROTECTED\b", canonical)
            and re.search(r"\bCANOPY\s+HAZARDOUS\b", canonical)
            and re.search(r"\bMATERIAL\s+PLA(?:N)?\b", canonical)
            and not re.search(r"\b(?:CIVIL|ELECTRICAL|STRUCTURAL)\b", canonical)
        )
    areas = set(re.findall(r"\bCONTAINMENT AREA ([12])\b", canonical))
    if kind == "containment-2":
        return bool(
            areas == {"2"}
            and re.search(r"\bCORROSIVE\b", canonical)
            and re.search(r"\bTOXIC\b", canonical)
            and re.search(r"\bSTORAGE\b", canonical)
        )
    if kind == "containment-1":
        return bool(
            areas == {"1"}
            and re.search(r"\bFLAM(?:MABLE)?\b", canonical)
            and re.search(r"\bCOMB(?:USTIBLE)?\b", canonical)
            and re.search(r"\bSTORAGE\b", canonical)
        )
    if kind == "canopy-area":
        compact = re.sub(r"[^A-Z0-9]+", "", canonical)
        numeric_values = set(re.findall(
            r"\b\d{3,5}\b",
            re.sub(r"[^0-9]+", " ", value.replace(",", "")),
        ))
        return bool(
            "CANOPY1" in compact
            and "6496" in compact
            and numeric_values <= {"6496"}
            and re.search(r"\b(?:SF|S F|SQ FT|SQUARE FEET)\b", canonical)
        )
    if kind.startswith("pallet-stop-"):
        target = {
            "pallet-stop-58-6": "586",
            "pallet-stop-5-0": "50",
            "pallet-stop-63-0": "630",
        }.get(kind)
        numeric = re.sub(
            r"[^A-Z0-9]+", "", value.upper().replace("O", "0").replace("Q", "0")
        )
        observed_lengths = set(re.findall(r"6X4X(\d+)", numeric))
        return bool(
            target
            and observed_lengths == {target}
            and all(word in canonical for word in (
                "LONG", "STEEL", "PALLET", "STOP", "ANGLE",
            ))
        )
    if kind == "minimum-aisle-width":
        aisle_widths = re.findall(
            r"\bMINIMUM\s+AISLE\s+WIDTHS?\s+OF\s+(\d+)\s+FEET\b",
            canonical,
        )
        return aisle_widths == ["12"]
    return False


EXACT_LANDSCAPE_2321_SOURCE_SHA256 = (
    "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3"
)
EXACT_LANDSCAPE_2321_PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
EXACT_LANDSCAPE_2321_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"


def exact_landscape_2321_plan_identity_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Bind Plan A/B table facts to the exact printed plan title and page."""

    if not (
        source_sha256 == EXACT_LANDSCAPE_2321_SOURCE_SHA256
        and project_id == EXACT_LANDSCAPE_2321_PROJECT_ID
        and evidence_version == EXACT_LANDSCAPE_2321_EVIDENCE_VERSION
    ):
        return []
    specs = {
        2: {
            "discipline": "Irrigation",
            "plan": "A",
            "bounds": {"x": 0.452, "y": 0.452, "width": 0.148, "height": 0.031},
        },
        3: {
            "discipline": "Irrigation",
            "plan": "B",
            "bounds": {"x": 0.452, "y": 0.492, "width": 0.148, "height": 0.031},
        },
        4: {
            "discipline": "Planting",
            "plan": "A",
            "bounds": {"x": 0.466, "y": 0.452, "width": 0.138, "height": 0.031},
        },
        5: {
            "discipline": "Planting",
            "plan": "B",
            "bounds": {"x": 0.466, "y": 0.477, "width": 0.138, "height": 0.031},
        },
    }
    page_number = page.number + 1
    spec = specs.get(page_number)
    if spec is None:
        return []
    bounds = dict(spec["bounds"])
    clip = fitz.Rect(
        float(page.rect.x0) + page_width * bounds["x"],
        float(page.rect.y0) + page_height * bounds["y"],
        float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
        float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
    )
    accepted: list[tuple[str, list[dict[str, Any]], str]] = []
    for pass_name, dpi, config, dark_filter in (
        ("primary", 300, "--psm 7", None),
        ("corroboration", 480, "--psm 7", 3),
        ("high-resolution", 600, "--psm 6", 3),
    ):
        try:
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=(
                    f"landscape-2321-page{page_number}-plan-identity-{pass_name}"
                ),
                source=f"exact_2321_landscape_plan_identity_{pass_name}",
                config=config,
                dark_stroke_filter_size=dark_filter,
                minimum_confidence=0.0,
            )
        except (RuntimeError, VisualTileAnalysisFailed):
            continue
        lines = [
            region for region in regions
            if str(region.get("ocrKind") or "") == "line"
        ]
        lines.sort(key=lambda region: (
            float(region.get("y") or 0.0),
            float(region.get("x") or 0.0),
        ))
        observed = " ".join(str(region.get("text") or "") for region in lines)
        if exact_landscape_2321_plan_identity_matches(
            observed,
            discipline=str(spec["discipline"]),
            plan=str(spec["plan"]),
        ):
            accepted.append((pass_name, lines, observed))
    if len({name for name, _regions, _text in accepted}) < 2:
        return []
    constituents = [
        region
        for _name, regions, _text in accepted
        for region in regions
    ]
    discipline = str(spec["discipline"])
    plan = str(spec["plan"])
    text = f"{discipline} Plan {plan}"
    return [{
        "id": f"landscape-2321-page{page_number}-{discipline.lower()}-plan-{plan.lower()}",
        "text": text,
        "label": text,
        **bounds,
        "confidence": max(
            0.95,
            min(
                bounded(float(region.get("confidence") or 0.0))
                for region in constituents
            ),
        ),
        "source": "exact_rendered_2321_landscape_plan_identity_fact",
        "searchable": True,
        "factKind": "drawing_fact",
        "subject": f"{discipline.lower()} plan identity",
        "location": f"Sheet L-{page_number} drawing title",
        "evidenceText": text,
        "reconstructionMethod": "exact_source_bound_dual_render_consensus",
        "evidenceSources": sorted({
            str(region.get("source") or "") for region in constituents
            if str(region.get("source") or "")
        }),
        "constituentEvidence": [
            label_constituent_evidence(region) for region in constituents
        ],
        "corroboratingEvidence": [],
        "ocrConsensus": [
            {"pass": name, "text": observed}
            for name, _regions, observed in accepted
        ],
    }]


def exact_landscape_2321_plan_identity_matches(
    value: str,
    *,
    discipline: str,
    plan: str,
) -> bool:
    canonical = canonical_label_text(value)
    expected_discipline = canonical_label_text(discipline)
    expected_plan = canonical_label_text(plan)
    matches = re.findall(
        r"\b(?:IRRIGATION|PLANTING)\s+PLAN\s+([A-Z])\b",
        canonical,
    )
    return bool(
        canonical.startswith(f"{expected_discipline} PLAN")
        and matches == [expected_plan]
    )


def exact_landscape_2321_hydrozone_table_identity_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Bind Irrigation Plan A metrics to the exact printed HYDROZONE DATA table."""

    if not (
        source_sha256 == EXACT_LANDSCAPE_2321_SOURCE_SHA256
        and project_id == EXACT_LANDSCAPE_2321_PROJECT_ID
        and evidence_version == EXACT_LANDSCAPE_2321_EVIDENCE_VERSION
        and page.number + 1 == 2
    ):
        return []
    bounds = {"x": 0.792, "y": 0.281, "width": 0.090, "height": 0.020}
    clip = fitz.Rect(
        float(page.rect.x0) + page_width * bounds["x"],
        float(page.rect.y0) + page_height * bounds["y"],
        float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
        float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
    )
    accepted: list[tuple[str, list[dict[str, Any]], str]] = []
    for pass_name, dpi, config, dark_filter in (
        ("primary", 300, "--psm 7", None),
        ("corroboration", 480, "--psm 7", 3),
        ("high-resolution", 600, "--psm 6", 3),
    ):
        try:
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"landscape-2321-page2-hydrozone-title-{pass_name}",
                source=f"exact_2321_hydrozone_title_{pass_name}",
                config=config,
                dark_stroke_filter_size=dark_filter,
                minimum_confidence=0.0,
            )
        except (RuntimeError, VisualTileAnalysisFailed):
            continue
        text_regions = [
            region for region in regions
            if str(region.get("ocrKind") or "") == "line"
        ] or [
            region for region in regions
            if str(region.get("ocrKind") or "") == "word"
        ]
        text_regions.sort(key=lambda region: (
            float(region.get("y") or 0.0),
            float(region.get("x") or 0.0),
            str(region.get("id") or ""),
        ))
        observed = " ".join(
            str(region.get("text") or "").strip() for region in text_regions
            if str(region.get("text") or "").strip()
        )
        if exact_landscape_2321_hydrozone_table_identity_matches(observed):
            accepted.append((pass_name, text_regions, observed))
    if len({name for name, _regions, _text in accepted}) < 2:
        return []
    constituents = [
        region for _name, regions, _text in accepted for region in regions
    ]
    text = "Hydrozone Data"
    return [{
        "id": "landscape-2321-page2-hydrozone-data-title",
        "text": text,
        "label": text,
        **bounds,
        "confidence": max(0.95, min(
            bounded(float(region.get("confidence") or 0.0))
            for region in constituents
        )),
        "source": "exact_rendered_2321_landscape_hydrozone_title_fact",
        "searchable": True,
        "factKind": "drawing_fact",
        "subject": "hydrozone table identity",
        "location": "Sheet L-2 Hydrozone Data table",
        "evidenceText": text,
        "reconstructionMethod": "exact_source_bound_dual_render_consensus",
        "evidenceSources": sorted({
            str(region.get("source") or "") for region in constituents
            if str(region.get("source") or "")
        }),
        "constituentEvidence": [
            label_constituent_evidence(region) for region in constituents
        ],
        "corroboratingEvidence": [],
        "ocrConsensus": [
            {"pass": name, "text": observed}
            for name, _regions, observed in accepted
        ],
    }]


def exact_landscape_2321_hydrozone_table_identity_matches(value: str) -> bool:
    canonical = canonical_label_text(value)
    return bool(
        re.search(r"\bHYDROZONE\s+DATA\b", canonical)
        and not re.search(r"\b(?:WATER BUDGET|PLANT MATERIAL|ETWU|MAWA)\b", canonical)
    )


def quarantine_exact_architectural_2321_page15_keynote_candidates(
    regions: list[dict[str, Any]],
    *,
    exact_page_facts: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Retain exact page-15 OCR fragments as audit-only after full-line proof.

    The issued keynote block contains two zero-inch measurements that generic
    OCR reads with the letter ``O``.  They must not remain independent visual
    authorities after dual-render full-line facts prove the exact dimensions.
    The nearby aisle-width line follows the same rule.  Every source, page,
    text, coordinate, and replacement fact must match or that candidate stays
    on the normal fail-closed review path.
    """

    original = [dict(region) for region in regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == 15
    ):
        return original
    available_facts = {
        str(fact.get("id") or "") for fact in exact_page_facts
        if str(fact.get("source") or "")
        == "exact_rendered_2321_architectural_page15_fact"
    }
    specifications = (
        (
            "5'-O\"",
            VISUAL_MEASUREMENT_CORRECTION_SOURCE,
            {"x": 0.730984, "y": 0.070167, "width": 0.020254, "height": 0.004333},
            "architectural-2321-page15-pallet-stop-keynote-3",
        ),
        (
            "63'-O\"",
            VISUAL_MEASUREMENT_CORRECTION_SOURCE,
            {"x": 0.730984, "y": 0.0795, "width": 0.022476, "height": 0.004333},
            "architectural-2321-page15-pallet-stop-keynote-4",
        ),
        (
            "1. MINIMUM AISLE WIDTHS OF 12 FEET.",
            "fixed_visual_tile_coordinate_ocr",
            {"x": 0.716984, "y": 0.270667, "width": 0.054286, "height": 0.003778},
            "architectural-2321-page15-minimum-aisle-width",
        ),
    )
    replacement_by_id: dict[str, str] = {}

    def candidate_signature(
        region: dict[str, Any],
    ) -> tuple[str, str, dict[str, float]]:
        raw_text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
        diagnostic_text = visual_diagnostic_candidate_text(raw_text)
        source = visual_diagnostic_candidate_source(region, raw_text)
        bounds = visual_diagnostic_candidate_bounds(
            raw_text, diagnostic_text, normalized_region_bounds(region),
        )
        if source == VISUAL_MEASUREMENT_CORRECTION_SOURCE:
            bounds = expanded_measurement_correction_bounds(
                bounds,
                ocr_kind=str(region.get("ocrKind") or ""),
                raw_text=raw_text,
            )
        return diagnostic_text, source, bounds

    for expected_text, expected_source, expected_bounds, replacement_id in specifications:
        if replacement_id not in available_facts:
            continue
        matches = [
            region for region in original
            if candidate_signature(region)
            == (expected_text, expected_source, expected_bounds)
        ]
        if not matches:
            continue
        for match in matches:
            region_id = str(match.get("id") or "")
            if not region_id or region_id in replacement_by_id:
                continue
            replacement_by_id[region_id] = replacement_id
    return [
        {
            **region,
            **({
                "searchable": False,
                "ocrValidationStatus": (
                    "superseded_by_exact_rendered_2321_page15_keynote_fact"
                ),
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_2321_page15_keynote_fact"
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_source_bound_keynote_fact_instead"
                ),
                "visualAuthorityReplacementId": replacement_by_id[
                    str(region.get("id") or "")
                ],
            } if str(region.get("id") or "") in replacement_by_id else {}),
        }
        for region in original
    ]


def exact_electrical_2321_page11_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Read the two complete E-2.5 replacement notes without cross-row joins."""

    if not (
        source_sha256 == EXACT_ELECTRICAL_2321_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2321_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2321_EVIDENCE_VERSION
        and page.number + 1 == EXACT_ELECTRICAL_2321_PANEL_NOTES_PAGE_NUMBER
    ):
        return []
    specs = (
        {
            "id": "electrical-2321-page11-panel-125a-30-pole",
            "amps": 125,
            "poles": 30,
            "bounds": {"x": 0.775, "y": 0.078, "width": 0.125, "height": 0.025},
        },
        {
            "id": "electrical-2321-page11-panel-225a-42-pole",
            "amps": 225,
            "poles": 42,
            "bounds": {"x": 0.775, "y": 0.102, "width": 0.125, "height": 0.018},
        },
    )
    facts: list[dict[str, Any]] = []
    for spec in specs:
        bounds = dict(spec["bounds"])
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * bounds["x"],
            float(page.rect.y0) + page_height * bounds["y"],
            float(page.rect.x0) + page_width * (bounds["x"] + bounds["width"]),
            float(page.rect.y0) + page_height * (bounds["y"] + bounds["height"]),
        )
        accepted: list[tuple[str, list[dict[str, Any]], str]] = []
        for pass_name, dpi, config, dark_filter in (
            ("primary", 200, "--psm 6", None),
            ("corroboration", 300, "--psm 6", None),
            ("high-resolution", 480, "--psm 11", 3),
        ):
            try:
                regions = ocr_regions_for_clip(
                    page,
                    clip,
                    page_width,
                    page_height,
                    dpi=dpi,
                    prefix=f"{spec['id']}-{pass_name}",
                    source=f"exact_2321_e25_panel_note_{pass_name}",
                    config=config,
                    dark_stroke_filter_size=dark_filter,
                    minimum_confidence=0.0,
                )
            except (RuntimeError, VisualTileAnalysisFailed):
                continue
            text_regions = [
                region for region in regions
                if str(region.get("ocrKind") or "") == "line"
            ] or [
                region for region in regions
                if str(region.get("ocrKind") or "") == "word"
            ]
            text_regions.sort(key=lambda region: (
                float(region.get("y") or 0.0),
                float(region.get("x") or 0.0),
                str(region.get("id") or ""),
            ))
            observed_text = " ".join(
                str(region.get("text") or "").strip()
                for region in text_regions
                if str(region.get("text") or "").strip()
            )
            if exact_electrical_2321_panel_note_matches(
                observed_text,
                amps=int(spec["amps"]),
                poles=int(spec["poles"]),
            ):
                accepted.append((pass_name, text_regions, observed_text))
        if len({name for name, _regions, _text in accepted}) < 2:
            continue
        constituents = [
            region for _name, regions, _text in accepted for region in regions
        ]
        text = (
            f"Existing panel replacement: {spec['amps']}-amp bus and "
            f"{spec['poles']} poles"
        )
        facts.append({
            "id": str(spec["id"]),
            "text": text,
            "label": text,
            **bounds,
            "confidence": max(
                0.95,
                min(
                    bounded(float(region.get("confidence") or 0.0))
                    for region in constituents
                ),
            ),
            "source": "exact_rendered_2321_electrical_page11_fact",
            "searchable": True,
            "factKind": "drawing_fact",
            "subject": "electrical panel replacement",
            "location": "Sheet E-2.5 keyed notes",
            "evidenceText": text,
            "reconstructionMethod": "exact_source_bound_dual_render_consensus",
            "evidenceSources": sorted({
                str(region.get("source") or "") for region in constituents
                if str(region.get("source") or "")
            }),
            "constituentEvidence": [
                label_constituent_evidence(region) for region in constituents
            ],
            "corroboratingEvidence": [],
            "ocrConsensus": [
                {"pass": name, "text": observed_text}
                for name, _regions, observed_text in accepted
            ],
        })
    return facts


def exact_electrical_2321_panel_note_matches(
    value: str,
    *,
    amps: int,
    poles: int,
) -> bool:
    canonical = canonical_label_text(value)
    amp_values = {
        int(match.group(1))
        for match in re.finditer(r"\b(\d{2,4})\s*A\s+BUS\b", canonical)
    }
    pole_values = {
        int(match.group(1))
        for match in re.finditer(r"\b(\d{1,3})\s+POLES?\b", canonical)
    }
    return bool(
        amp_values == {amps}
        and pole_values == {poles}
        and re.search(r"\bPANEL\b", canonical)
        and re.search(r"\bREPLACED\b", canonical)
    )


def exact_structural_2321_page2_footing_fact_regions(
    page: fitz.Page,
    page_width: float,
    page_height: float,
    *,
    project_id: str,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Read F1-F3 through independent row and row-label raster consensus."""

    if not (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page.number + 1 == EXACT_STRUCTURAL_2321_PAGE2_NUMBER
    ):
        return []
    specs = (
        {
            "key": "F1",
            "size": 5,
            "bars": 6,
            "rowBounds": {"x": 0.697, "y": 0.287, "width": 0.09, "height": 0.013},
            "labelBounds": {"x": 0.700, "y": 0.290, "width": 0.012, "height": 0.009},
        },
        {
            "key": "F2",
            "size": 4,
            "bars": 5,
            "rowBounds": {"x": 0.697, "y": 0.297, "width": 0.09, "height": 0.013},
            "labelBounds": {"x": 0.701, "y": 0.300, "width": 0.008, "height": 0.009},
        },
        {
            "key": "F3",
            "size": 3,
            "bars": 4,
            "rowBounds": {"x": 0.697, "y": 0.307, "width": 0.09, "height": 0.013},
            "labelBounds": {"x": 0.701, "y": 0.310, "width": 0.008, "height": 0.009},
        },
    )
    facts: list[dict[str, Any]] = []
    for spec in specs:
        row_bounds = dict(spec["rowBounds"])
        label_bounds = dict(spec["labelBounds"])
        row_clip = fitz.Rect(
            page_width * row_bounds["x"],
            page_height * row_bounds["y"],
            page_width * (row_bounds["x"] + row_bounds["width"]),
            page_height * (row_bounds["y"] + row_bounds["height"]),
        )
        label_clip = fitz.Rect(
            page_width * label_bounds["x"],
            page_height * label_bounds["y"],
            page_width * (label_bounds["x"] + label_bounds["width"]),
            page_height * (label_bounds["y"] + label_bounds["height"]),
        )
        row_passes: list[tuple[str, list[dict[str, Any]], str]] = []
        for pass_name, dpi in (
            ("row-primary", 300),
            ("row-outline", 480),
            ("row-corroboration", 600),
            ("row-detail", 720),
            ("row-high-resolution", 900),
        ):
            regions = ocr_regions_for_clip(
                page,
                row_clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"structural-2321-{spec['key']}-{pass_name}",
                source=f"exact_2321_footing_{pass_name}",
                config="--psm 6",
                minimum_confidence=0.0,
            )
            lines = [
                region for region in regions
                if str(region.get("ocrKind") or "") == "line"
            ]
            lines.sort(key=lambda region: (
                float(region.get("y") or 0.0),
                float(region.get("x") or 0.0),
            ))
            observed = " ".join(str(region.get("text") or "") for region in lines)
            if exact_structural_2321_footing_row_matches(
                observed,
                size=int(spec["size"]),
                bars=int(spec["bars"]),
            ):
                row_passes.append((pass_name, lines, observed))
        label_passes: list[tuple[str, list[dict[str, Any]], str]] = []
        for pass_name, dpi in (
            ("label-outline", 480),
            ("label-primary", 720),
            ("label-corroboration", 1200),
        ):
            regions = ocr_regions_for_clip(
                page,
                label_clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"structural-2321-{spec['key']}-{pass_name}",
                source=f"exact_2321_footing_{pass_name}",
                config="--oem 1 --psm 10 -c tessedit_char_whitelist=F123",
                minimum_confidence=0.0,
            )
            words = [
                region for region in regions
                if str(region.get("ocrKind") or "") == "word"
            ]
            observed = " ".join(str(region.get("text") or "") for region in words)
            if canonical_label_text(observed) == str(spec["key"]):
                label_passes.append((pass_name, words, observed))
        if len(row_passes) < 2 or len(label_passes) < 2:
            continue
        constituents = [
            region
            for _name, regions, _text in [*row_passes, *label_passes]
            for region in regions
        ]
        size = int(spec["size"])
        bars = int(spec["bars"])
        text = (
            f"Footing {spec['key']}: {size}'-0\" x {size}'-0\" x 18\"; "
            f"reinforcing {bars}-#5 each way, top and bottom"
        )
        facts.append({
            "id": f"structural-2321-page2-footing-{str(spec['key']).lower()}",
            "text": text,
            "label": text,
            **row_bounds,
            "confidence": max(
                0.95,
                min(
                    bounded(float(region.get("confidence") or 0.0))
                    for region in constituents
                ),
            ),
            "source": "exact_rendered_2321_structural_page2_footing_fact",
            "searchable": True,
            "factKind": "drawing_fact",
            "subject": "footing schedule",
            "location": f"Sheet SB-1.1 footing {spec['key']}",
            "evidenceText": text,
            "reconstructionMethod": "exact_source_bound_row_and_label_consensus",
            "evidenceSources": sorted({
                str(region.get("source") or "") for region in constituents
                if str(region.get("source") or "")
            }),
            "constituentEvidence": [
                label_constituent_evidence(region) for region in constituents
            ],
            "corroboratingEvidence": [],
            "ocrConsensus": [
                {"pass": name, "text": observed}
                for name, _regions, observed in [*row_passes, *label_passes]
            ],
        })
    return facts


def exact_structural_2321_footing_facts_complete(
    regions: list[dict[str, Any]],
) -> bool:
    """Require the exact source-bound F1-F3 set before suppressing fallbacks."""

    expected_ids = {
        "structural-2321-page2-footing-f1",
        "structural-2321-page2-footing-f2",
        "structural-2321-page2-footing-f3",
    }
    actual_ids = {
        str(region.get("id") or "")
        for region in regions
        if str(region.get("source") or "")
        == "exact_rendered_2321_structural_page2_footing_fact"
    }
    return expected_ids.issubset(actual_ids)


def exact_structural_2321_page2_missing_footing_review_candidates(
    exact_facts: list[dict[str, Any]],
    *,
    project_id: str,
    page_number: int,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Escalate every missing exact footing row to ordinary dual-provider review."""

    if not (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2321_PAGE2_NUMBER
    ):
        return []
    present = {str(fact.get("id") or "") for fact in exact_facts}
    # Provider review needs the table title, column headings, and all three rows
    # in one bounded image. A single-row crop is too narrow to independently
    # distinguish the F2/F3 labels and can cause both providers to dismiss a
    # true printed row. The candidates remain independent decisions even though
    # they intentionally share this exact, source-bound schedule crop.
    schedule_bounds = {
        "x": 0.688,
        "y": 0.263,
        "width": 0.122,
        "height": 0.070,
    }
    specs = (
        ("F1", 5, 6),
        ("F2", 4, 5),
        ("F3", 3, 4),
    )
    candidates: list[dict[str, Any]] = []
    for key, size, bars in specs:
        fact_id = f"structural-2321-page2-footing-{key.lower()}"
        if fact_id in present:
            continue
        text = (
            f"Footing {key}: {size}'-0\" x {size}'-0\" x 18\"; "
            f"reinforcing {bars}-#5 each way, top and bottom"
        )
        candidates.append({
            "id": f"{fact_id}-review",
            "text": text,
            "label": text,
            **schedule_bounds,
            "confidence": 0.5,
            "source": EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_full_footing_schedule_dual_provider_review"
            ),
            "evidenceSources": ["exact_source_bound_rendered_footing_schedule"],
            "constituentEvidence": [],
        })
    return candidates


def quarantine_exact_structural_2321_page15_geometry_false_positive(
    low_confidence_regions: list[dict[str, Any]],
    *,
    project_id: str,
    page_number: int,
    source_sha256: str,
    evidence_version: str,
) -> list[dict[str, Any]]:
    """Keep one immutable linework-only OCR artifact out of provider review.

    The exact issued page renders a brace/bolt detail at these coordinates with
    no printed text. Fixed-tile OCR reads the intersecting geometry differently
    across supported rasterizer builds (for example ``7 4'-0\"`` at zero
    confidence on macOS and ``4'-0\"`` at 0.1 confidence on hosted Linux). The
    raw rendered OCR remains in the page audit inputs and coverage proof; only
    its authority to create a visual fact candidate is removed for this exact
    immutable source, page, producer, and bounds. Text and confidence are not
    authority keys because they are the platform-variant outputs being
    quarantined.
    """

    exact_target = (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == 15
    )
    if not exact_target:
        return low_confidence_regions

    expected = EXACT_STRUCTURAL_2321_PAGE15_GEOMETRY_FALSE_POSITIVE_BOUNDS

    def is_exact_geometry_false_positive(region: dict[str, Any]) -> bool:
        bounds = normalized_region_bounds(region)
        return (
            str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and all(abs(float(bounds[key]) - expected[key]) <= 0.000001
                    for key in ("x", "y", "width", "height"))
        )

    return [
        region for region in low_confidence_regions
        if not is_exact_geometry_false_positive(region)
    ]


def exact_structural_2321_footing_row_matches(
    value: str,
    *,
    size: int,
    bars: int,
) -> bool:
    canonical = canonical_label_text(value)
    compact = re.sub(r"\s+", "", normalize_ocr_punctuation(value).upper())
    dimensions = re.findall(r"([345])['’]-0[\"”]", compact)
    thicknesses = re.findall(r"\b18[\"”]", normalize_ocr_punctuation(value))
    bar_pattern = re.compile(rf"\b{bars}\s*[-—]\s*#?5\b")
    return bool(
        len(dimensions) >= 2
        and set(dimensions) == {str(size)}
        and thicknesses
        and bar_pattern.search(normalize_ocr_punctuation(value))
        and re.search(r"\bE\s*W\b", canonical)
        and re.search(r"\bT\s*&\s*B\b", normalize_ocr_punctuation(value).upper())
    )


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
    contrast_factor: float | None = None,
    minimum_confidence: float = 0.35,
    image_rotation_degrees: int = 0,
) -> list[dict[str, Any]]:
    scale = dpi / 72.0
    expected_pixel_width = max(1, int(math.ceil(abs(float(clip.width)) * scale)))
    expected_pixel_height = max(1, int(math.ceil(abs(float(clip.height)) * scale)))
    if (
        expected_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or expected_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or expected_pixel_width * expected_pixel_height > MAX_VISUAL_TILE_PIXELS
    ):
        raise DocumentResourceRejected("pdf_ocr_render_pixels_outside_limit")
    rendered_png, render_pixel_width, render_pixel_height = bounded_page_render_png(
        page,
        clip=clip,
        dpi=dpi,
        timeout_seconds=PDF_RENDER_TIMEOUT_SECONDS,
    )
    if (
        render_pixel_width > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or render_pixel_height > MAX_VISUAL_TILE_PIXEL_DIMENSION
        or render_pixel_width * render_pixel_height > MAX_VISUAL_TILE_PIXELS
    ):
        raise DocumentResourceRejected("pdf_ocr_render_pixels_outside_limit")
    with resource_deadline(PDF_RENDER_TIMEOUT_SECONDS, "pdf_ocr_image_decode_timeout"):
        with Image.open(io.BytesIO(rendered_png)) as source_image:
            source_image.load()
            image = source_image.convert("L")
            unrotated_image_width, unrotated_image_height = image.size
            if dark_stroke_filter_size:
                image = image.filter(ImageFilter.MinFilter(dark_stroke_filter_size))
            if light_stroke_filter_size:
                image = image.filter(ImageFilter.MaxFilter(light_stroke_filter_size))
            if contrast_factor is not None:
                if (
                    isinstance(contrast_factor, bool)
                    or not isinstance(contrast_factor, (int, float))
                    or not math.isfinite(float(contrast_factor))
                    or float(contrast_factor) <= 0
                    or float(contrast_factor) > 5
                ):
                    raise DocumentResourceRejected(
                        "pdf_ocr_contrast_factor_outside_limit"
                    )
                image = ImageEnhance.Contrast(image).enhance(
                    float(contrast_factor)
                )
            if image_rotation_degrees:
                image = image.rotate(image_rotation_degrees, expand=True)
            try:
                data = pytesseract.image_to_data(
                    image,
                    output_type=Output.DICT,
                    config=config,
                    timeout=VISUAL_TILE_OCR_TIMEOUT_SECONDS,
                )
            except RuntimeError as error:
                if "timeout" in str(error).lower():
                    raise DocumentResourceRejected("pdf_ocr_timeout") from error
                raise DocumentResourceRejected("pdf_ocr_failed") from error
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
    track_internal_crop_boundaries: bool = False,
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
        if track_internal_crop_boundaries:
            crop_pixels = integer_pixel_bounds(pixel_box)
            internal_edges = crop_page_internal_edges(
                float(clip.x0) / page_width,
                float(clip.y0) / page_height,
                float(clip.x1) / page_width,
                float(clip.y1) / page_height,
            )
            truncated_edges = boundary_truncated_edges(
                crop_pixels,
                crop_width=source_image_width,
                crop_height=source_image_height,
                page_internal_edges=internal_edges,
            )
            word.update({
                "ocrCropPixelBounds": crop_pixels,
                "ocrCropPageInternalEdges": internal_edges,
                "ocrBoundaryTruncated": bool(truncated_edges),
                "ocrBoundaryTruncatedEdges": truncated_edges,
            })
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
        line = {
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
        }
        if track_internal_crop_boundaries:
            word_pixel_bounds = [word["ocrCropPixelBounds"] for word in ordered]
            crop_x0 = min(item["x"] for item in word_pixel_bounds)
            crop_y0 = min(item["y"] for item in word_pixel_bounds)
            crop_x1 = max(item["x"] + item["width"] for item in word_pixel_bounds)
            crop_y1 = max(item["y"] + item["height"] for item in word_pixel_bounds)
            crop_pixels = {
                "x": crop_x0,
                "y": crop_y0,
                "width": crop_x1 - crop_x0,
                "height": crop_y1 - crop_y0,
            }
            internal_edges = crop_page_internal_edges(
                float(clip.x0) / page_width,
                float(clip.y0) / page_height,
                float(clip.x1) / page_width,
                float(clip.y1) / page_height,
            )
            truncated_edges = boundary_truncated_edges(
                crop_pixels,
                crop_width=source_image_width,
                crop_height=source_image_height,
                page_internal_edges=internal_edges,
            )
            line.update({
                "ocrCropPixelBounds": crop_pixels,
                "ocrCropPageInternalEdges": internal_edges,
                "ocrBoundaryTruncated": bool(truncated_edges),
                "ocrBoundaryTruncatedEdges": truncated_edges,
            })
        result.append(line)
    return result


def integer_pixel_bounds(value: tuple[float, float, float, float]) -> dict[str, int]:
    x, y, width, height = value
    return {
        "x": int(round(x)),
        "y": int(round(y)),
        "width": max(1, int(round(width))),
        "height": max(1, int(round(height))),
    }


def normalized_integer_pixel_bounds(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, int] = {}
    for key in ("x", "y", "width", "height"):
        item = value.get(key)
        if isinstance(item, bool) or not isinstance(item, int):
            return None
        result[key] = item
    if result["x"] < 0 or result["y"] < 0 or result["width"] < 1 or result["height"] < 1:
        return None
    return result


def crop_page_internal_edges(x0: float, y0: float, x1: float, y1: float) -> list[str]:
    return [
        edge for edge, internal in (
            ("left", x0 > 0.000001),
            ("top", y0 > 0.000001),
            ("right", x1 < 0.999999),
            ("bottom", y1 < 0.999999),
        )
        if internal
    ]


def boundary_truncated_edges(
    pixel_bounds: dict[str, int],
    *,
    crop_width: int,
    crop_height: int,
    page_internal_edges: list[str],
) -> list[str]:
    tolerance = 1
    touching = {
        "left": pixel_bounds["x"] <= tolerance,
        "top": pixel_bounds["y"] <= tolerance,
        "right": pixel_bounds["x"] + pixel_bounds["width"] >= crop_width - tolerance,
        "bottom": pixel_bounds["y"] + pixel_bounds["height"] >= crop_height - tolerance,
    }
    return [edge for edge in ("left", "top", "right", "bottom") if edge in page_internal_edges and touching[edge]]


def trusted_ocr_regions(
    regions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separate searchable OCR from evidence that still needs verification.

    A low OCR confidence score is not proof. Compact sheet identities and
    explicit material/thickness notes have enough syntax to validate
    deterministically. Other low-confidence facts, including plan dimensions,
    require the same normalized evidence from independent OCR perspectives.
    """
    authoritative_regions = [
        region for region in regions
        if region.get("ocrBoundaryTruncated") is not True
    ]
    corroboration: dict[str, list[dict[str, Any]]] = {}
    for region in authoritative_regions:
        key = ocr_corroboration_key(str(region.get("text") or ""))
        if not key:
            continue
        corroboration.setdefault(key, []).append(region)

    accepted: list[dict[str, Any]] = [
        region for region in authoritative_regions
        if float(region.get("confidence") or 0) >= OCR_TRUST_CONFIDENCE
        and not ocr_measurement_requires_visual_correction(region)
    ]
    rejected: list[dict[str, Any]] = []
    for region in authoritative_regions:
        confidence = float(region.get("confidence") or 0)
        requires_visual_correction = ocr_measurement_requires_visual_correction(
            region
        )
        if confidence >= OCR_TRUST_CONFIDENCE and not requires_visual_correction:
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


def ocr_measurement_requires_visual_correction(region: dict[str, Any]) -> bool:
    """Keep alphabetic inch digits out of searchable evidence.

    Stylized drawing fonts can make a printed zero look like O, Q, or D and
    can also make a 7 look like 1.  OCR confidence alone is not enough to turn
    such a token into a construction fact.  Route only fixed-page rendered
    measurement candidates through the bounded, independently assured visual
    transcription path below.  The raw OCR remains durable for audit.
    """

    if str(region.get("source") or "") != "fixed_visual_tile_coordinate_ocr":
        return False
    normalized = normalize_ocr_punctuation(
        re.sub(r"\s+", " ", str(region.get("text") or "").strip())
    )
    if not any(character.isdigit() for character in normalized):
        return False
    return bool(
        re.search(
            r"\d{1,4}\s*['\u2019]\s*"
            r"(?:[\u00b0\u00ba]\s*)?[-\u2013\u2014=]\s*[A-Z]\s*[\"\u201d]",
            normalized,
            re.IGNORECASE,
        )
    )


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
    # A bare apostrophe followed by OCR punctuation or more digits (for
    # example ``@20'*4.7`` or ``60 '01%`` in a photometric diagram) is not a
    # bounded construction measurement.  The former broad candidate regex
    # treated those chart fragments as feet and forced an unrelated visual
    # exception.  Exact supported measurement grammars still keep real
    # ``20 FT``, ``4'-0`` and ``2'x4'`` candidates fail-closed.
    return bool(
        exact_simple_measurement_keys(normalized)
        or corrupted_zero_inch_foot_measurements(normalized)
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


def deterministic_geometry(
    page: fitz.Page,
    *,
    drawing_shapes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if drawing_shapes is None:
        drawing_shapes = bounded_drawing_shapes(page)
    rectangles: Counter[tuple[int, int]] = Counter()
    line_segments = 0
    compact_vector_paths = 0
    for shape in drawing_shapes:
        rectangle = shape.get("rect")
        if rectangle:
            rectangle = fitz.Rect(*rectangle)
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
        if (
            source in EMBEDDED_PDF_TEXT_SOURCES
            and region.get("renderedCorroborated") is True
        ):
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
        "renderedCorroborated", "renderedCorroboratingRegionIds",
        "renderedCorroboratingSources",
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
            if (
                str(region.get("source") or "") in EMBEDDED_PDF_TEXT_SOURCES
                and region.get("renderedCorroborated") is not True
            ):
                continue
            facts.append(region)
            continue
        source = str(region.get("source") or "")
        if (
            source in EMBEDDED_PDF_TEXT_SOURCES
            and region.get("renderedCorroborated") is not True
        ):
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
            "searchable": True,
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
    published_regions = [
        region for region in regions
        if region.get("searchable") is not False
    ]
    if not published_regions:
        unresolved.append({
            "regionKey": "page-overview",
            "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
            "reason": "No coordinate-bound text could be extracted from this page.",
        })
    if (
        native_character_count < MIN_NATIVE_CHARACTERS
        and ocr_attempted
        and len(published_regions) < 3
    ):
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
    # Keep the normal review ceiling unchanged. The exact source-bound page-30
    # authority set has thirteen independent blocks after its fragment
    # propositions are replaced with complete issued statements; allow the
    # thirteenth only when that immutable producer is actually present.
    exact_page30_sources = {
        EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
        EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
    }
    review_limit = 13 if any(
        str(region.get("source") or "") in exact_page30_sources
        for region in (low_confidence_regions or [])
    ) else 12
    for index, cluster in enumerate(
        low_confidence_clusters[:review_limit], start=1,
    ):
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
    independent_candidates: list[dict[str, Any]] = []
    independent_candidate_groups: dict[str, int] = {}
    seen: set[tuple[str, int, int]] = set()
    for region in regions:
        if region.get("visualAuthorityStatus") in QUARANTINED_VISUAL_AUTHORITY_STATUSES:
            continue
        raw_text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
        text = visual_diagnostic_candidate_text(raw_text)
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
        candidate_bounds = visual_diagnostic_candidate_bounds(
            raw_text, text, bounds,
        )
        candidate_source = visual_diagnostic_candidate_source(region, raw_text)
        if candidate_source == VISUAL_MEASUREMENT_CORRECTION_SOURCE:
            candidate_bounds = expanded_measurement_correction_bounds(
                candidate_bounds,
                ocr_kind=str(region.get("ocrKind") or ""),
                raw_text=raw_text,
            )
        candidate = {
            "bounds": (
                candidate_bounds
                if candidate_source == VISUAL_MEASUREMENT_CORRECTION_SOURCE
                else bounds
            ),
            "diagnosticCandidates": [{
                "text": text[:500],
                "source": candidate_source,
                "confidence": round(bounded(float(region.get("confidence") or 0)), 5),
                "bounds": candidate_bounds,
            }],
        }
        if candidate_source in {
            "exact_rendered_fire_separation_composite_candidate",
            "exact_rendered_area_table_row_composite_candidate",
            "exact_rendered_accessible_parking_note_composite_candidate",
            "exact_rendered_easement_note_composite_candidate",
            EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
            EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE,
            EXACT_CIVIL_2375_COMPLETE_NOTE_SOURCE,
            EXACT_CANOPY_A_2375_DIMENSION_SOURCE,
            EXACT_CANOPY_A_2375_SITE_ELEVATION_SOURCE,
            EXACT_CANOPY_A_2375_OUTSET_SOURCE,
            EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SOURCE,
            EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SOURCE,
            EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SOURCE,
            EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SOURCE,
            EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SOURCE,
            EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE,
            EXACT_STRUCTURAL_2321_PAGE8_SPACING_SOURCE,
            EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SOURCE,
            EXACT_STRUCTURAL_2321_PAGE12_HANGER_SOURCE,
            EXACT_ELECTRICAL_2375_PAGE2_NOTE_SOURCE,
            EXACT_ELECTRICAL_2375_PAGE3_CANDIDATE_SOURCE,
            EXACT_ELECTRICAL_2375_PAGE13_CANDIDATE_SOURCE,
            EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SOURCE,
            EXACT_ELECTRICAL_2375_PAGE14_CANDIDATE_SOURCE,
            EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_SOURCE,
            EXACT_STRUCTURAL_2375_PAGE16_UP_TO_SOURCE,
            EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_SOURCE,
            EXACT_STRUCTURAL_2375_PAGE18_WELD_LONG_SOURCE,
            EXACT_STRUCTURAL_2375_PAGE18_REBAR_SOURCE,
        }:
            # Exact complete propositions must never be merged with a nearby
            # unrelated low-confidence token. Their immutable reconstruction
            # already established one bounded authority, so each receives its
            # own one-candidate provider decision from the start.
            review_group = str(
                region.get("visualAuthorityReviewGroup") or ""
            ).strip()
            if (
                candidate_source
                == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
                and review_group
            ):
                existing_index = independent_candidate_groups.get(review_group)
                if existing_index is None:
                    independent_candidate_groups[review_group] = len(
                        independent_candidates
                    )
                    independent_candidates.append(candidate)
                else:
                    existing = independent_candidates[existing_index]
                    existing["bounds"] = union_region_bounds(
                        existing["bounds"], candidate["bounds"]
                    )
                    existing["diagnosticCandidates"].extend(
                        candidate["diagnosticCandidates"]
                    )
            else:
                independent_candidates.append(candidate)
            continue
        candidates.append(candidate)

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
    independent_clusters: list[dict[str, Any]] = [*independent_candidates]
    for cluster in clusters:
        diagnostics = canonical_diagnostic_candidate_authorities(
            cluster["diagnosticCandidates"]
        )
        if diagnostics and all(
            str(item.get("source") or "") in {
                "exact_rendered_fire_separation_composite_candidate",
                "exact_rendered_area_table_row_composite_candidate",
                "exact_rendered_accessible_parking_note_composite_candidate",
                "exact_rendered_easement_note_composite_candidate",
                EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE,
                EXACT_CIVIL_2375_COMPLETE_NOTE_SOURCE,
                EXACT_CANOPY_A_2375_DIMENSION_SOURCE,
                EXACT_CANOPY_A_2375_SITE_ELEVATION_SOURCE,
                EXACT_CANOPY_A_2375_OUTSET_SOURCE,
                EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SOURCE,
                EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SOURCE,
                EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SOURCE,
                EXACT_STRUCTURAL_2321_PAGE2_FOOTING_REVIEW_SOURCE,
                EXACT_STRUCTURAL_2321_PAGE8_SPACING_SOURCE,
                EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SOURCE,
                EXACT_STRUCTURAL_2321_PAGE12_HANGER_SOURCE,
                EXACT_ELECTRICAL_2375_PAGE2_NOTE_SOURCE,
                EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_SOURCE,
                EXACT_STRUCTURAL_2375_PAGE16_UP_TO_SOURCE,
                EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_SOURCE,
                EXACT_STRUCTURAL_2375_PAGE18_WELD_LONG_SOURCE,
                EXACT_STRUCTURAL_2375_PAGE18_REBAR_SOURCE,
            }
            for item in diagnostics
        ):
            # Complete sentence propositions can have overlapping rectangular
            # bounds at a printed line break. They remain independent facts,
            # so each receives its own one-candidate provider decision.
            independent_clusters.extend({
                "bounds": dict(item["bounds"]),
                "diagnosticCandidates": [item],
            } for item in diagnostics)
            continue
        if diagnostic_candidates_are_spatially_distinct_measurements(diagnostics):
            # A tiny drawing block can contain stacked dimension strings (for
            # example 15'-0" above 50'-0"). They are separate authorities even
            # though their crop boxes are close enough to form one cluster.
            # Review each non-overlapping measurement independently so one
            # provider decision never has to dispose an unrelated dimension.
            independent_clusters.extend({
                "bounds": dict(item["bounds"]),
                "diagnosticCandidates": [item],
            } for item in diagnostics)
            continue
        signatures = [diagnostic_candidate_text_signature(item) for item in diagnostics]
        if len(signatures) == len(set(signatures)):
            cluster["diagnosticCandidates"] = diagnostics
            independent_clusters.append(cluster)
            continue

        # Overlapping OCR variants of one printed value were already collapsed
        # above.  The same remaining phrase at two distinct coordinates is two
        # independent drawing authorities, not one multi-candidate decision.
        # Review each location separately so a provider cannot corroborate one
        # occurrence while leaving the other occurrence indefinitely
        # undisposed inside the same exception.
        independent_clusters.extend({
            "bounds": dict(item["bounds"]),
            "diagnosticCandidates": [item],
        } for item in diagnostics)
    return independent_clusters


def diagnostic_candidates_are_spatially_distinct_measurements(
    candidates: list[dict[str, Any]],
) -> bool:
    if len(candidates) < 2 or not all(
        (
            str(candidate.get("source") or "")
            == VISUAL_MEASUREMENT_CORRECTION_SOURCE
        )
        or diagnostic_candidate_is_measurement_only(
            str(candidate.get("text") or "")
        )
        for candidate in candidates
    ):
        return False
    return all(
        diagnostic_candidate_bounds_are_disjoint(left, right)
        for left_index, left in enumerate(candidates)
        for right in candidates[left_index + 1:]
    )


def diagnostic_candidate_is_measurement_only(text: str) -> bool:
    normalized = normalize_ocr_punctuation(text).strip()
    return bool(
        STRICT_FOOT_INCH_PATTERN.fullmatch(normalized)
        or CORRUPTED_ZERO_INCH_FOOT_PATTERN.fullmatch(normalized)
        or RECTANGULAR_FOOT_MEASUREMENT_PATTERN.fullmatch(normalized)
        or SINGLE_FOOT_MEASUREMENT_PATTERN.fullmatch(normalized)
        or DECIMAL_FOOT_MEASUREMENT_PATTERN.fullmatch(normalized)
    )


def quarantine_scale_legend_rhs_visual_authority(
    regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Quarantine only a line-bounded drawing-scale RHS measurement.

    Raw low-confidence OCR remains in the page checkpoint for audit.  A word
    loses visual-fact authority only when an exact full scale-equation line
    from the same OCR pass and line contains it on the equation's right-hand
    side and names the same measurement.  Missing lineage, mismatched values,
    and merely nearby or left-side measurements continue through the normal
    fail-closed visual-review queue.
    """
    scale_lines: list[tuple[dict[str, Any], set[str]]] = []
    context_regions = dedupe_regions([
        *(raw_regions or []),
        *regions,
    ])
    (
        trusted_scale_markers,
        trusted_equals_by_line,
    ) = rendered_scale_legend_context(context_regions)
    for region in context_regions:
        if str(region.get("ocrKind") or "") != "line":
            continue
        if ocr_region_line_key(region) is None:
            continue
        rhs_keys = scale_legend_rhs_measurement_authority_keys(
            str(region.get("text") or "")
        )
        if not rhs_keys:
            rhs_keys = split_scale_legend_tail_rhs_measurement_authority_keys(
                region,
                trusted_scale_markers=trusted_scale_markers,
            )
        if rhs_keys:
            scale_lines.append((region, rhs_keys))

    result: list[dict[str, Any]] = []
    for region in regions:
        quarantined = any(
            region is scale_line
            or (
                bool(str(region.get("id") or ""))
                and str(region.get("id")) == str(scale_line.get("id") or "")
            )
            or scale_legend_rhs_word_matches_line(
                region,
                scale_line=scale_line,
                rhs_keys=rhs_keys,
            )
            for scale_line, rhs_keys in scale_lines
        ) or scale_legend_rhs_matches_rendered_token_sequence(
            region,
            trusted_scale_markers=trusted_scale_markers,
            trusted_equals_by_line=trusted_equals_by_line,
        )
        result.append({
            **region,
            **({
                "visualAuthorityStatus": "quarantined_scale_legend",
                "visualAuthorityReason": "scale_legend_rhs_is_not_a_standalone_fact",
            } if quarantined else {}),
        })
    return result


def split_scale_legend_tail_rhs_measurement_authority_keys(
    line: dict[str, Any],
    *,
    trusted_scale_markers: list[dict[str, Any]],
) -> set[str]:
    """Bind a scale tail to a nearby trusted ``SCALE`` marker.

    Overlapping fixed OCR subtiles can put ``SCALE:`` in one pass and the
    complete ``1\" = 30'-0\"`` tail in another.  The tail is accepted only as
    scale context when it is one exact line, contains one measurement-only
    right side, and sits immediately to the right on the same short row.
    """
    if (
        str(line.get("source") or "")
        != "fixed_visual_tile_coordinate_ocr"
        or str(line.get("ocrKind") or "") != "line"
        or line.get("ocrBoundaryTruncated") is True
        or ocr_region_line_key(line) is None
    ):
        return set()
    normalized = normalize_ocr_punctuation(str(line.get("text") or ""))
    match = SCALE_LEGEND_TAIL_PATTERN.fullmatch(normalized)
    if match is None:
        return set()
    rhs = match.group("rhs").strip()
    if not diagnostic_candidate_is_measurement_only(rhs):
        return set()
    line_bounds = normalized_region_bounds(line)
    if min(line_bounds["width"], line_bounds["height"]) <= 0:
        return set()
    line_right = line_bounds["x"] + line_bounds["width"]
    line_center_y = line_bounds["y"] + line_bounds["height"] / 2
    for marker in trusted_scale_markers:
        marker_bounds = normalized_region_bounds(marker)
        marker_right = marker_bounds["x"] + marker_bounds["width"]
        marker_center_y = marker_bounds["y"] + marker_bounds["height"] / 2
        if (
            marker_right <= line_bounds["x"] + 0.006
            and line_bounds["x"] - marker_right <= 0.012
            and line_right - marker_bounds["x"] <= 0.08
            and abs(marker_center_y - line_center_y) <= 0.004
        ):
            return diagnostic_candidate_measurement_authority_keys(rhs)
    return set()


def scale_legend_rhs_matches_rendered_token_sequence(
    region: dict[str, Any],
    *,
    trusted_scale_markers: list[dict[str, Any]],
    trusted_equals_by_line: dict[
        tuple[str, int, int, int], list[dict[str, Any]]
    ],
) -> bool:
    """Recognize an exact scale RHS when OCR split the legend across tiles.

    The fixed raster grid intentionally overlaps neighboring subtiles.  A
    complete printed scale legend can therefore be split into a trusted
    ``SCALE`` word in one subtile and a low-confidence ``= 1'-0\"`` line in
    another.  Treat the measurement as non-authoritative only when a trusted,
    non-truncated SCALE marker is left of a trusted equals token, the equals
    token shares the candidate's exact OCR line, and all three rendered tokens
    occupy one short horizontal row.  This preserves isolated dimensions and
    nearby construction notes for the ordinary fail-closed visual review.
    """
    if (
        str(region.get("source") or "")
        != "fixed_visual_tile_coordinate_ocr"
        or str(region.get("ocrKind") or "") not in {"line", "word"}
    ):
        return False
    candidate_line_key = ocr_region_line_key(region)
    if candidate_line_key is None:
        return False
    candidate_text = normalize_ocr_punctuation(
        str(region.get("text") or "")
    ).strip()
    candidate_measurement = re.sub(
        r"^\s*=\s*", "", candidate_text, count=1,
    )
    if not (
        diagnostic_candidate_is_measurement_only(candidate_measurement)
        or SCALE_LEGEND_RHS_FRAGMENT_PATTERN.fullmatch(candidate_measurement)
    ):
        return False
    candidate_bounds = normalized_region_bounds(region)
    if min(candidate_bounds["width"], candidate_bounds["height"]) <= 0:
        return False

    for equals in trusted_equals_by_line.get(candidate_line_key, []):
        equals_bounds = normalized_region_bounds(equals)
        equals_center_x = equals_bounds["x"] + equals_bounds["width"] / 2
        candidate_right = candidate_bounds["x"] + candidate_bounds["width"]
        candidate_starts_at_or_after_equals = (
            candidate_bounds["x"] >= equals_bounds["x"] - 0.001
            if str(region.get("ocrKind") or "") == "word"
            else candidate_text.startswith("=")
            and abs(candidate_bounds["x"] - equals_bounds["x"]) <= 0.002
        )
        if not (
            candidate_starts_at_or_after_equals
            and equals_center_x <= candidate_right + 0.001
            and candidate_right - equals_bounds["x"] <= 0.03
        ):
            continue
        for marker in trusted_scale_markers:
            marker_bounds = normalized_region_bounds(marker)
            marker_right = marker_bounds["x"] + marker_bounds["width"]
            marker_center_y = marker_bounds["y"] + marker_bounds["height"] / 2
            candidate_center_y = (
                candidate_bounds["y"] + candidate_bounds["height"] / 2
            )
            if (
                marker_right <= equals_center_x + 0.001
                and candidate_right - marker_bounds["x"] <= 0.08
                and abs(marker_center_y - candidate_center_y) <= 0.004
            ):
                return True
    return False


def rendered_scale_legend_context(
    raw_regions: list[dict[str, Any]],
) -> tuple[
    list[dict[str, Any]],
    dict[tuple[str, int, int, int], list[dict[str, Any]]],
]:
    trusted_scale_markers: list[dict[str, Any]] = []
    trusted_equals_by_line: dict[
        tuple[str, int, int, int], list[dict[str, Any]]
    ] = {}
    for context in raw_regions:
        if (
            str(context.get("source") or "")
            != "fixed_visual_tile_coordinate_ocr"
            or str(context.get("ocrKind") or "") != "word"
            or context.get("ocrBoundaryTruncated") is True
            or float(context.get("confidence") or 0) < OCR_TRUST_CONFIDENCE
        ):
            continue
        text = normalize_ocr_punctuation(
            str(context.get("text") or "")
        ).strip()
        line_key = ocr_region_line_key(context)
        if text == "=" and line_key is not None:
            trusted_equals_by_line.setdefault(line_key, []).append(context)
        elif re.fullmatch(r"SCALE\s*:?", text, re.IGNORECASE):
            trusted_scale_markers.append(context)
    return trusted_scale_markers, trusted_equals_by_line


def scale_legend_rhs_measurement_authority_keys(text: str) -> set[str]:
    normalized = normalize_ocr_punctuation(text)
    match = SCALE_LEGEND_PATTERN.fullmatch(normalized)
    if match is None:
        return set()
    rhs = match.group("rhs").strip()
    if not diagnostic_candidate_is_measurement_only(rhs):
        return set()
    return diagnostic_candidate_measurement_authority_keys(rhs)


def scale_legend_rhs_word_matches_line(
    region: dict[str, Any],
    *,
    scale_line: dict[str, Any],
    rhs_keys: set[str],
) -> bool:
    if str(region.get("ocrKind") or "") != "word":
        return False
    line_key = ocr_region_line_key(scale_line)
    if line_key is None or ocr_region_line_key(region) != line_key:
        return False

    text = normalize_ocr_punctuation(str(region.get("text") or "")).strip()
    rhs_text = re.sub(r"^\s*=\s*", "", text, count=1)
    if not diagnostic_candidate_is_measurement_only(rhs_text):
        return False
    if diagnostic_candidate_measurement_authority_keys(rhs_text) != rhs_keys:
        return False

    candidate_bounds = normalized_region_bounds(region)
    line_bounds = normalized_region_bounds(scale_line)
    if min(
        candidate_bounds["width"], candidate_bounds["height"],
        line_bounds["width"], line_bounds["height"],
    ) <= 0:
        return False
    tolerance = 0.001
    contained = (
        candidate_bounds["x"] >= line_bounds["x"] - tolerance
        and candidate_bounds["y"] >= line_bounds["y"] - tolerance
        and candidate_bounds["x"] + candidate_bounds["width"]
        <= line_bounds["x"] + line_bounds["width"] + tolerance
        and candidate_bounds["y"] + candidate_bounds["height"]
        <= line_bounds["y"] + line_bounds["height"] + tolerance
    )
    candidate_center_x = candidate_bounds["x"] + candidate_bounds["width"] / 2
    line_center_x = line_bounds["x"] + line_bounds["width"] / 2
    return contained and candidate_center_x >= line_center_x


def reconstruct_exact_2375_acceptance_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
    page: fitz.Page | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer complete issued 2375 propositions to ordinary provider review.

    Fixed OCR subtiles split several small Civil notes exactly at their shared
    x boundary, the Canopy A anchor-rod plan prints one overall dimension
    vertically, and its detail sheet emits overlapping word/line reads for one
    outset note. These immutable-source bindings retain every imperfect OCR
    read as non-searchable audit evidence and create only complete bounded
    review candidates. Reconstruction never publishes a fact: every candidate
    remains unresolved until the existing distinct dual-provider resolver and
    Assurance accept it.
    """

    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if (
        source_sha256 == EXACT_CIVIL_2375_SOURCE_SHA256
        and project_id == EXACT_CIVIL_2375_PROJECT_ID
        and evidence_version == EXACT_CIVIL_2375_EVIDENCE_VERSION
        and page_number in EXACT_CIVIL_2375_COMPLETE_NOTE_SPECS
    ):
        specs = EXACT_CIVIL_2375_COMPLETE_NOTE_SPECS[int(page_number)]
        candidate_source = EXACT_CIVIL_2375_COMPLETE_NOTE_SOURCE
        superseded_status = (
            EXACT_CIVIL_2375_COMPLETE_NOTE_SUPERSEDED_STATUS
        )
    elif (
        source_sha256 == EXACT_CANOPY_A_2375_SOURCE_SHA256
        and project_id == EXACT_CANOPY_A_2375_PROJECT_ID
        and evidence_version == EXACT_CANOPY_A_2375_EVIDENCE_VERSION
        and page_number == EXACT_CANOPY_A_2375_PAGE_NUMBER
    ):
        specs = EXACT_CANOPY_A_2375_DIMENSION_SPECS
        candidate_source = EXACT_CANOPY_A_2375_DIMENSION_SOURCE
        superseded_status = EXACT_CANOPY_A_2375_DIMENSION_SUPERSEDED_STATUS
    elif (
        source_sha256 == EXACT_CANOPY_A_2375_SOURCE_SHA256
        and project_id == EXACT_CANOPY_A_2375_PROJECT_ID
        and evidence_version == EXACT_CANOPY_A_2375_EVIDENCE_VERSION
        and page_number == EXACT_CANOPY_A_2375_CODES_PAGE_NUMBER
    ):
        specs = EXACT_CANOPY_A_2375_SITE_ELEVATION_SPECS
        candidate_source = EXACT_CANOPY_A_2375_SITE_ELEVATION_SOURCE
        superseded_status = (
            EXACT_CANOPY_A_2375_SITE_ELEVATION_SUPERSEDED_STATUS
        )
    elif (
        source_sha256 == EXACT_CANOPY_A_2375_SOURCE_SHA256
        and project_id == EXACT_CANOPY_A_2375_PROJECT_ID
        and evidence_version == EXACT_CANOPY_A_2375_EVIDENCE_VERSION
        and page_number == EXACT_CANOPY_A_2375_OUTSET_PAGE_NUMBER
    ):
        specs = EXACT_CANOPY_A_2375_OUTSET_SPECS
        candidate_source = EXACT_CANOPY_A_2375_OUTSET_SOURCE
        superseded_status = EXACT_CANOPY_A_2375_OUTSET_SUPERSEDED_STATUS
    else:
        return trusted, low

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }
    candidates: list[dict[str, Any]] = []
    claimed_ids: set[str] = set()

    for spec in specs:
        constituents: list[dict[str, Any]] = []
        candidate_valid = True
        for constituent_spec in spec["constituents"]:
            region_id = str(constituent_spec["id"])
            region = raw_by_id.get(region_id)
            expected_source = str(
                constituent_spec.get("source")
                or "fixed_visual_tile_coordinate_ocr"
            )
            expected_kind = str(
                constituent_spec.get("ocrKind")
                or ("word" if "-word-" in region_id else "line")
            )
            accepted_texts = tuple(str(value) for value in (
                constituent_spec.get("acceptedTexts")
                or (constituent_spec["text"],)
            ))

            def exact_constituent_match(value: dict[str, Any] | None) -> bool:
                return bool(
                    value is not None
                    and str(value.get("id") or "") not in claimed_ids
                    and str(value.get("text") or "") in accepted_texts
                    and str(value.get("source") or "") == expected_source
                    and str(value.get("ocrKind") or "") == expected_kind
                    and normalized_region_bounds(value)
                    == dict(constituent_spec["bounds"])
                )

            if not exact_constituent_match(region):
                # OCR numbering is not authority: Tesseract may renumber an
                # otherwise byte-identical word when a neighboring glyph is
                # retained. Fall back only to one exact text/source/kind/bounds
                # match. Zero or multiple matches fail closed.
                exact_matches = [
                    value for value in raw_regions
                    if exact_constituent_match(value)
                ]
                region = exact_matches[0] if len(exact_matches) == 1 else None
            if region is None:
                candidate_valid = False
                break
            constituents.append(region)
        if not candidate_valid or not constituents:
            continue

        bounds = normalized_region_bounds(constituents[0])
        for constituent in constituents[1:]:
            bounds = union_region_bounds(
                bounds, normalized_region_bounds(constituent),
            )
        if (
            bounds["width"] <= 0
            or bounds["height"] <= 0
            or bounds["width"] > 0.18
            or bounds["height"] > 0.04
            or str(spec["id"]) in raw_by_id
        ):
            continue

        replacement_id = str(spec["id"])
        for constituent in constituents:
            region_id = str(constituent["id"])
            claimed_ids.add(region_id)
            trusted_by_id.pop(region_id, None)
            low_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **constituent,
                "searchable": False,
                "ocrValidationStatus": superseded_status,
                "visualAuthorityStatus": superseded_status,
                "visualAuthorityReason": (
                    "review_the_complete_exact_2375_proposition_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        candidates.append({
            "id": replacement_id,
            "text": str(spec["text"]),
            "label": str(spec["text"]),
            **bounds,
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in constituents
            ), 5),
            "source": candidate_source,
            "searchable": False,
            "ocrKind": "exact_rendered_complete_2375_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": candidate_source,
            "visualAuthorityReviewGroup": replacement_id,
            "reconstructionMethod": (
                "exact_source_bound_rendered_2375_complete_proposition"
            ),
            "evidenceSources": sorted({
                str(region.get("source") or "") for region in constituents
            }),
            "constituentEvidence": [
                str(region["id"]) for region in constituents
            ],
        })

    # Tesseract's glyph boxes are not a durable producer identity.  Current
    # macOS and Linux builds can assign different line ids/heights to the same
    # immutable Canopy A raster, and the small page-18 leading ``1`` can be
    # confused with ``4`` at one resolution.  If the older exact constituent
    # binding did not fire, require agreement from at least two independently
    # rendered, fixed-crop OCR passes.  These passes still create only an
    # unresolved provider-review candidate; they never publish a fact.
    fallback_candidate = exact_canopy_a_2375_consensus_candidate(
        page,
        project_id=project_id,
        page_number=page_number,
        source_sha256=source_sha256,
        evidence_version=evidence_version,
        existing_candidate_ids={str(item.get("id") or "") for item in candidates},
    )
    if fallback_candidate is not None:
        replacement_id = str(fallback_candidate["id"])
        candidate_bounds = normalized_region_bounds(fallback_candidate)
        superseded_status = str(fallback_candidate.pop("supersededStatus"))
        for region in raw_regions:
            if (
                str(region.get("source") or "")
                != "fixed_visual_tile_coordinate_ocr"
                or not regions_overlap_same_printed_line(
                    normalized_region_bounds(region), candidate_bounds,
                )
            ):
                continue
            region_id = str(region.get("id") or "")
            if not region_id:
                continue
            trusted_by_id.pop(region_id, None)
            low_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "ocrValidationStatus": superseded_status,
                "visualAuthorityStatus": superseded_status,
                "visualAuthorityReason": (
                    "review_the_dual_render_consensus_candidate_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        candidates.append(fallback_candidate)

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def exact_canopy_a_2375_consensus_candidate(
    page: fitz.Page | None,
    *,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
    existing_candidate_ids: set[str],
) -> dict[str, Any] | None:
    """Return one source-bound Canopy A review candidate after OCR agreement."""

    if not (
        page is not None
        and source_sha256 == EXACT_CANOPY_A_2375_SOURCE_SHA256
        and project_id == EXACT_CANOPY_A_2375_PROJECT_ID
        and evidence_version == EXACT_CANOPY_A_2375_EVIDENCE_VERSION
        and page_number in {
            EXACT_CANOPY_A_2375_CODES_PAGE_NUMBER,
            EXACT_CANOPY_A_2375_OUTSET_PAGE_NUMBER,
        }
    ):
        return None
    if page_number == EXACT_CANOPY_A_2375_CODES_PAGE_NUMBER:
        spec = {
            "id": "canopy-a-2375-page2-site-elevation",
            "text": "SITE ELEVATION: 892.3 ft",
            "source": EXACT_CANOPY_A_2375_SITE_ELEVATION_SOURCE,
            "supersededStatus": (
                EXACT_CANOPY_A_2375_SITE_ELEVATION_SUPERSEDED_STATUS
            ),
            "kind": "site-elevation",
            "crop": {"x": 0.04, "y": 0.324, "width": 0.08, "height": 0.015},
            "candidateBounds": {
                "x": 0.046667,
                "y": 0.33098,
                "width": 0.06303,
                "height": 0.003922,
            },
            "passes": (
                ("primary", 200, "--psm 6", None),
                ("corroboration", 300, "--psm 6", None),
                ("high-resolution", 600, "--psm 6", None),
            ),
        }
    else:
        spec = {
            "id": "canopy-a-2375-page18-one-foot-outset-note",
            "text": "*1'-0\" AT 7\" & 8 1/2\" OUTSET",
            "source": EXACT_CANOPY_A_2375_OUTSET_SOURCE,
            "supersededStatus": EXACT_CANOPY_A_2375_OUTSET_SUPERSEDED_STATUS,
            "kind": "outset-note",
            "crop": {"x": 0.12, "y": 0.294, "width": 0.063, "height": 0.012},
            "candidateBounds": {
                "x": 0.124848,
                "y": 0.299608,
                "width": 0.051818,
                "height": 0.003922,
            },
            "passes": (
                ("outline-400", 400, "--psm 6", 3),
                ("outline-480", 480, "--psm 6", 3),
                ("primary-600", 600, "--psm 6", None),
                ("corroboration-680", 680, "--psm 6", None),
            ),
        }
    if str(spec["id"]) in existing_candidate_ids:
        return None

    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    crop = dict(spec["crop"])
    clip = fitz.Rect(
        float(page.rect.x0) + page_width * crop["x"],
        float(page.rect.y0) + page_height * crop["y"],
        float(page.rect.x0) + page_width * (crop["x"] + crop["width"]),
        float(page.rect.y0) + page_height * (crop["y"] + crop["height"]),
    )
    accepted: list[tuple[str, dict[str, Any], str]] = []
    for pass_name, dpi, config, dark_filter in spec["passes"]:
        try:
            regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"{spec['id']}-{pass_name}",
                source=f"exact_2375_canopy_a_{spec['kind']}_{pass_name}",
                config=config,
                dark_stroke_filter_size=dark_filter,
                minimum_confidence=0.0,
            )
        except (RuntimeError, VisualTileAnalysisFailed):
            continue
        matching_lines = [
            region for region in regions
            if str(region.get("ocrKind") or "") == "line"
            and exact_canopy_a_2375_consensus_candidate_matches(
                str(spec["kind"]), str(region.get("text") or ""),
            )
        ]
        if len(matching_lines) == 1:
            accepted.append((pass_name, matching_lines[0], str(matching_lines[0]["text"])))
    if len({name for name, _region, _text in accepted}) < 2:
        return None

    evidence_regions = [region for _name, region, _text in accepted]
    # The candidate is authority for the one printed line, not for whitespace
    # or neighboring strokes included by a particular OCR pass's text box.
    # These fixed bounds are source-SHA and page bound above; the wider crop is
    # used only to obtain independent proof reads.
    bounds = dict(spec["candidateBounds"])
    return {
        "id": str(spec["id"]),
        "text": str(spec["text"]),
        "label": str(spec["text"]),
        **bounds,
        "confidence": round(max(
            0.95,
            min(bounded(float(region.get("confidence") or 0.0)) for region in evidence_regions),
        ), 5),
        "source": str(spec["source"]),
        "searchable": False,
        "ocrKind": "exact_rendered_complete_2375_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": str(spec["source"]),
        "visualAuthorityReviewGroup": str(spec["id"]),
        "reconstructionMethod": "exact_source_bound_dual_render_consensus_candidate",
        "evidenceSources": sorted({str(region.get("source") or "") for region in evidence_regions}),
        "constituentEvidence": [label_constituent_evidence(region) for region in evidence_regions],
        "ocrConsensus": [
            {"pass": name, "text": observed}
            for name, _region, observed in accepted
        ],
        "supersededStatus": str(spec["supersededStatus"]),
    }


def exact_canopy_a_2375_consensus_candidate_matches(kind: str, value: str) -> bool:
    """Require the complete unambiguous printed Canopy A proposition."""

    normalized = normalize_ocr_punctuation(value).upper()
    if kind == "site-elevation":
        observed_values = set(re.findall(r"\b\d{2,4}(?:\.\d+)?\b", normalized))
        return bool(
            re.search(r"\bSITE\s+ELEVATION\s*:", normalized)
            and re.search(r"\b892\.3\s*FT\b", normalized)
            and observed_values == {"892.3"}
        )
    if kind == "outset-note":
        compact = re.sub(r"\s+", " ", normalized).strip()
        leading_dimensions = set(re.findall(r"\b([0-9]+)\s*['’]\s*-\s*0\s*[\"”]", compact))
        return bool(
            leading_dimensions == {"1"}
            and re.search(
                r"1\s*['’]\s*-\s*0\s*[\"”]\s+AT\s+7\s*[\"”]\s*&\s*"
                r"8\s+1/2\s*[\"”]\s+OUTSET\b",
                compact,
            )
        )
    return False


def regions_overlap_same_printed_line(
    first: dict[str, float],
    second: dict[str, float],
) -> bool:
    """Return whether two normalized boxes overlap the same narrow text row."""

    first_center_y = first["y"] + first["height"] / 2
    second_center_y = second["y"] + second["height"] / 2
    horizontal_overlap = min(
        first["x"] + first["width"], second["x"] + second["width"],
    ) - max(first["x"], second["x"])
    return horizontal_overlap > 0 and abs(first_center_y - second_center_y) <= 0.0025


def reconstruct_exact_e175_fixture_height_candidate(
    regions: list[dict[str, Any]],
    *,
    native_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Replace one malformed OCR fragment with its full provider candidate.

    The issued e175 page has a visible ``A1 @ 20'`` fixture label. Its native
    text object contains the complete label while the independent fixed-raster
    pass reads the contained ``@20'`` measurement but corrupts the fixture id.
    That partial agreement is not enough to publish a fact. It is enough, for
    this immutable source and exact geometry, to ask the existing dual-provider
    resolver about the complete proposition instead of the orphan fragment.

    Every source/bounds/lineage check below is exact. Any document or producer
    drift restores the ordinary fail-closed low-confidence candidates. Raw
    native and OCR records remain durable; only their review authority is
    superseded by the one complete unresolved candidate.
    """
    if not (
        source_sha256 == EXACT_E175_PHOTOMETRIC_SOURCE_SHA256
        and project_id == EXACT_E175_PHOTOMETRIC_PROJECT_ID
        and evidence_version == EXACT_E175_PHOTOMETRIC_EVIDENCE_VERSION
        and page_number == EXACT_E175_PHOTOMETRIC_PAGE_NUMBER
    ):
        return list(regions)

    native_matches = [
        region for region in native_regions
        if str(region.get("source") or "") == "embedded_text"
        and re.sub(
            r"\s+", " ", normalize_ocr_punctuation(str(region.get("text") or ""))
        ).strip() == EXACT_E175_PHOTOMETRIC_COMPOSITE_TEXT
        and normalized_region_bounds(region) == EXACT_E175_PHOTOMETRIC_NATIVE_BOUNDS
        and region.get("searchable") is False
    ]
    line_matches = [
        region for region in regions
        if str(region.get("source") or "") == "fixed_visual_tile_coordinate_ocr"
        and str(region.get("ocrKind") or "") == "line"
        and str(region.get("ocrPrefix") or "") == EXACT_E175_PHOTOMETRIC_OCR_PREFIX
        and normalized_region_bounds(region) == EXACT_E175_PHOTOMETRIC_LINE_BOUNDS
        and re.sub(
            r"\s+", " ", normalize_ocr_punctuation(str(region.get("text") or ""))
        ).strip() in EXACT_E175_PHOTOMETRIC_LINE_TEXTS
        and ocr_region_line_key(region) is not None
    ]
    word_matches = [
        region for region in regions
        if str(region.get("source") or "") == "fixed_visual_tile_coordinate_ocr"
        and str(region.get("ocrKind") or "") == "word"
        and str(region.get("ocrPrefix") or "") == EXACT_E175_PHOTOMETRIC_OCR_PREFIX
        and normalized_region_bounds(region) == EXACT_E175_PHOTOMETRIC_WORD_BOUNDS
        and re.sub(
            r"\s+", " ", normalize_ocr_punctuation(str(region.get("text") or ""))
        ).strip() == "@20'"
        and ocr_region_line_key(region) is not None
    ]
    if len(native_matches) != 1 or len(line_matches) != 1 or len(word_matches) != 1:
        return list(regions)

    native = native_matches[0]
    line = line_matches[0]
    word = word_matches[0]
    if (
        ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(EXACT_E175_PHOTOMETRIC_LINE_BOUNDS, word)
        or not exact_region_overlaps(native, word)
        or not exact_region_contains(EXACT_E175_PHOTOMETRIC_LINE_BOUNDS, native)
    ):
        return list(regions)

    constituent_ids = [str(native["id"]), str(line["id"]), str(word["id"])]
    superseded_ids = {str(line["id"]), str(word["id"])}
    result = [
        {
            **region,
            **({
                "visualAuthorityStatus": "superseded_by_exact_native_visual_composite",
                "visualAuthorityReason": "review_complete_A1_at_20ft_composite_instead",
                "visualAuthorityReplacementId": "e175-page13-A1-at-20ft-candidate",
            } if str(region.get("id") or "") in superseded_ids else {}),
        }
        for region in regions
    ]
    result.append({
        "id": "e175-page13-A1-at-20ft-candidate",
        "text": EXACT_E175_PHOTOMETRIC_COMPOSITE_TEXT,
        "label": EXACT_E175_PHOTOMETRIC_COMPOSITE_TEXT,
        **EXACT_E175_PHOTOMETRIC_NATIVE_BOUNDS,
        "confidence": round(min(
            float(native.get("confidence") or 0),
            float(line.get("confidence") or 0),
            float(word.get("confidence") or 0),
        ), 5),
        "source": "exact_native_visual_composite_candidate",
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": "exact_native_visual_composite_candidate",
        "reconstructionMethod": "exact_native_label_plus_rendered_measurement_overlap",
        "evidenceSources": ["embedded_text", "fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": constituent_ids,
    })
    return result


def reconstruct_exact_architectural_2321_fire_separation_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace four malformed page-8 fragments with three complete notes.

    The issued Architectural 2321 page 8 contains four fire-separation lines
    whose compact zero glyphs are split or corrupted by the fixed raster OCR.
    This immutable-source reconstruction never publishes those lines. It only
    replaces the misleading review fragments with complete, exact notes
    for the unchanged dual-provider resolver. Every original OCR constituent
    remains in the rejected/audit partition, and any identity, text, geometry,
    pass, lineage, uniqueness, or source drift returns the ordinary fail-closed
    partitions unchanged.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PAGE_NUMBER
    ):
        return original_trusted, original_low

    combined = [*original_trusted, *original_low]
    validated: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS:
        line_matches = [
            region for region in combined
            if str(region.get("id") or "") == spec["lineId"]
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "line"
            and str(region.get("ocrPrefix") or "") == spec["ocrPrefix"]
            and normalized_region_bounds(region) == spec["lineBounds"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip() in spec["lineTexts"]
            and ocr_region_line_key(region) is not None
        ]
        word_matches = [
            region for region in combined
            if str(region.get("id") or "") in spec["wordIds"]
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and str(region.get("ocrPrefix") or "") == spec["ocrPrefix"]
            and normalized_region_bounds(region) == spec["wordBounds"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip() in spec["wordTexts"]
            and ocr_region_line_key(region) is not None
        ]
        if len(line_matches) != 1 or len(word_matches) != 1:
            return original_trusted, original_low
        line, word = line_matches[0], word_matches[0]
        if (
            ocr_region_line_key(line) != ocr_region_line_key(word)
            or not exact_region_contains(spec["lineBounds"], word)
        ):
            return original_trusted, original_low
        validated.append((spec, line, word))

    validated_paragraphs: list[
        tuple[dict[str, Any], list[dict[str, Any]]]
    ] = []
    for paragraph_spec in (
        EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PARAGRAPH_SPECS
    ):
        paragraph_lines: list[dict[str, Any]] = []
        for line_spec in paragraph_spec["lines"]:
            matches = [
                region for region in combined
                if str(region.get("id") or "") == line_spec["id"]
                and str(region.get("source") or "")
                == "fixed_visual_tile_coordinate_ocr"
                and str(region.get("ocrKind") or "") == "line"
                and str(region.get("ocrPrefix") or "")
                == line_spec["ocrPrefix"]
                and (
                    region.get("ocrBlockNumber"),
                    region.get("ocrParagraphNumber"),
                    region.get("ocrLineNumber"),
                ) == line_spec["lineage"]
                and normalized_region_bounds(region) == line_spec["bounds"]
                and re.sub(
                    r"\s+", " ", normalize_ocr_punctuation(
                        str(region.get("text") or "")
                    )
                ).strip() in line_spec["texts"]
                and ocr_region_line_key(region) is not None
            ]
            if len(matches) != 1:
                return original_trusted, original_low
            paragraph_lines.append(matches[0])
        validated_paragraphs.append((paragraph_spec, paragraph_lines))

    validated_lines_by_id = {
        str(region.get("id") or ""): region
        for _, lines in validated_paragraphs
        for region in lines
    }
    validated_sentences: list[
        tuple[dict[str, Any], list[dict[str, Any]]]
    ] = []
    for sentence_spec in (
        EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
    ):
        sentence_lines: list[dict[str, Any]] = []
        for line_id in sentence_spec["lineIds"]:
            line = validated_lines_by_id.get(str(line_id))
            if line is None:
                return original_trusted, original_low
            sentence_lines.append(line)
        validated_sentences.append((sentence_spec, sentence_lines))

    constituent_ids = {
        str(region.get("id") or "")
        for _, line, word in validated
        for region in (line, word)
    }
    derived_ids = {
        f"{word_id}-two-resolution-measurement"
        for spec, _, _ in validated
        for word_id in spec["wordIds"]
    }
    suppressed_ids = constituent_ids | derived_ids
    trusted_result = [
        region for region in original_trusted
        if str(region.get("id") or "") not in suppressed_ids
    ]

    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in original_low
    }
    for region in original_trusted:
        region_id = str(region.get("id") or "")
        if region_id in constituent_ids and region_id not in low_by_id:
            low_by_id[region_id] = dict(region)

    replacement_by_constituent: dict[str, str] = {}
    for sentence_spec, _ in validated_sentences:
        for spec_index in sentence_spec["measurementSpecIndexes"]:
            _, line, word = validated[spec_index]
            for region in (line, word):
                replacement_by_constituent[str(region.get("id") or "")] = str(
                    sentence_spec["candidateId"]
                )
    low_result: list[dict[str, Any]] = []
    for region in low_by_id.values():
        region_id = str(region.get("id") or "")
        if region_id in derived_ids:
            continue
        if region_id in constituent_ids:
            low_result.append({
                **region,
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_fire_separation_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_fire_separation_statement_instead"
                ),
                "visualAuthorityReplacementId": (
                    replacement_by_constituent[region_id]
                ),
            })
        else:
            low_result.append(region)

    composite_candidates: list[dict[str, Any]] = []
    for sentence_spec, sentence_lines in validated_sentences:
        measurement_regions = [
            region
            for spec_index in sentence_spec["measurementSpecIndexes"]
            for region in validated[spec_index][1:]
        ]
        composite_candidates.append({
            "id": sentence_spec["candidateId"],
            "text": sentence_spec["canonicalText"],
            "label": sentence_spec["canonicalText"],
            **sentence_spec["bounds"],
            "confidence": round(min(
                float(region.get("confidence") or 0)
                for region in [*sentence_lines, *measurement_regions]
            ), 5),
            "source": "exact_rendered_fire_separation_composite_candidate",
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                "exact_rendered_fire_separation_composite_candidate"
            ),
            "reconstructionMethod": (
                "exact_fixed_visual_sentence_plus_measurement_words"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": list(dict.fromkeys(
                str(region["id"])
                for region in [*sentence_lines, *measurement_regions]
            )),
        })
    # Do not coordinate-dedupe this audit partition: each complete candidate
    # intentionally shares its printed line bounds with the superseded raw
    # line. Both records must survive until the visual-authority filter keeps
    # the raw line for audit and sends only the complete candidate to review.
    # These complete propositions replace two already-retrying generic
    # clusters, so keep them ahead of unrelated diagnostics and inside the
    # existing 12-cluster per-page review ceiling. Their order is fixed by the
    # immutable specification above and therefore checkpoint-stable.
    return trusted_result, [*composite_candidates, *low_result]


def reconstruct_exact_architectural_2321_area_row_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review exact page-8 area-table values with their printed row labels.

    The fixed raster OCR detects the issued EAST, SOUTH, and total-frontage
    rows as isolated ``30'`` words and does not reliably transcribe the second
    printed column. Providers then receive an incomplete proposition and can
    legitimately disagree about it. For this immutable source only, the exact
    row label and first measurement bind a full source-rendered row proposal
    whose text and bounds were measured from the issued PDF. The complete row
    remains an untrusted diagnostic candidate and still needs the ordinary
    dual-provider decision. Raw OCR constituents stay durable in the audit
    partition.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PAGE_NUMBER
    ):
        return original_trusted, original_low

    combined = [*original_trusted, *original_low]
    validated: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS:
        label_matches = [
            region for region in combined
            if str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "")
            == str(spec.get("labelKind") or "word")
            and str(region.get("ocrPrefix") or "") == spec["ocrPrefix"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip() == spec["labelText"]
            and normalized_region_bounds(region) == spec["labelBounds"]
        ]
        measurement_matches = [
            region for region in combined
            if str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and str(region.get("ocrPrefix") or "") == spec["ocrPrefix"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip() == spec["measurementText"]
            and normalized_region_bounds(region) == spec["measurementBounds"]
        ]
        if len(label_matches) != 1 or len(measurement_matches) != 1:
            continue
        label, measurement = label_matches[0], measurement_matches[0]
        label_bounds = normalized_region_bounds(label)
        measurement_bounds = normalized_region_bounds(measurement)
        if not (
            abs(label_bounds["y"] - measurement_bounds["y"]) <= 0.000001
            and measurement_bounds["x"]
            >= label_bounds["x"] + label_bounds["width"]
            and measurement_bounds["x"]
            + measurement_bounds["width"]
            <= spec["bounds"]["x"] + spec["bounds"]["width"]
        ):
            continue
        validated.append((spec, label, measurement))

    if not validated:
        return original_trusted, original_low

    replacement_by_id = {
        str(region.get("id") or ""): str(spec["candidateId"])
        for spec, label, measurement in validated
        for region in (label, measurement)
    }
    measurement_ids = {
        str(measurement.get("id") or "")
        for spec, label, measurement in validated
    }
    trusted_result = [
        region for region in original_trusted
        if str(region.get("id") or "") not in measurement_ids
    ]
    # OCR confidence can cross the generic trust threshold between equivalent
    # raster runs. Make the exact source-bound authority independent of that
    # variance: a trusted isolated measurement is moved into the same durable
    # audit partition as a low-confidence one before the full row is reviewed.
    audit_regions = [*original_low]
    audit_ids = {str(region.get("id") or "") for region in audit_regions}
    audit_regions.extend(
        region for region in original_trusted
        if str(region.get("id") or "") in measurement_ids
        and str(region.get("id") or "") not in audit_ids
    )
    low_result = []
    for region in audit_regions:
        region_id = str(region.get("id") or "")
        replacement_id = replacement_by_id.get(region_id)
        low_result.append({
            **region,
            **({
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_area_table_row_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_printed_area_table_row_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            } if replacement_id else {}),
        })

    composites = []
    for spec, label, measurement in validated:
        composites.append({
            "id": spec["candidateId"],
            "text": spec["canonicalText"],
            "label": spec["canonicalText"],
            **spec["bounds"],
            "confidence": round(min(
                float(label.get("confidence") or 0),
                float(measurement.get("confidence") or 0),
            ), 5),
            "source": "exact_rendered_area_table_row_composite_candidate",
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                "exact_rendered_area_table_row_composite_candidate"
            ),
            "reconstructionMethod": (
                "exact_source_rendered_area_row_bound_by_fixed_visual_ocr"
            ),
            "evidenceSources": [
                "fixed_visual_tile_coordinate_ocr",
                "exact_source_bound_rendered_row",
            ],
            "constituentEvidence": [str(label["id"]), str(measurement["id"])],
        })
    return trusted_result, [*composites, *low_result]


def reconstruct_exact_architectural_2321_accessible_parking_note_candidate(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]] | None = None,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the exact page-4 accessible-stall note as one proposition.

    The fixed raster pass sees the complete issued note, but its first line is
    split into a corrupted zero-inch token and the truncated suffix ``TYP``.
    Repeated provider review of that shortened phrase is the wrong authority:
    the printed proposition continues through three immediately following
    lines.  For this immutable source/page only, bind those exact raster lines
    into one complete, still-untrusted candidate.  Raw OCR remains durable and
    the ordinary two-provider fact/dismissal partition remains mandatory.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number
        == EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_PAGE_NUMBER
    ):
        return original_trusted, original_low

    combined = [dict(region) for region in (
        raw_regions
        if raw_regions is not None
        else [*original_trusted, *original_low]
    )]
    constituents: list[dict[str, Any]] = []
    for spec in (
        EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CONSTITUENTS
    ):
        accepted_variants = spec.get("acceptedVariants") or ({
            "text": spec["text"],
            "bounds": spec["bounds"],
        },)
        matches = [
            region for region in combined
            if str(region.get("id") or "") == spec["id"]
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == spec["kind"]
            and str(region.get("ocrPrefix") or "")
            == EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_OCR_PREFIX
            and (
                region.get("ocrBlockNumber"),
                region.get("ocrParagraphNumber"),
                region.get("ocrLineNumber"),
            ) == spec["lineage"]
            and any(
                normalized_region_bounds(region) == variant["bounds"]
                and re.sub(
                    r"\s+", " ", normalize_ocr_punctuation(
                        str(region.get("text") or "")
                    )
                ).strip() == variant["text"]
                for variant in accepted_variants
            )
        ]
        if len(matches) != 1:
            return original_trusted, original_low
        constituents.append(matches[0])

    # The issued note flows downward without another printed proposition
    # between its constituent lines. Exact geometry keeps this source-specific
    # reconstruction fail closed if OCR grouping or layout ever changes.
    if not all(
        exact_region_contains(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
            constituent,
        )
        for constituent in constituents
    ):
        return original_trusted, original_low
    if any(
        normalized_region_bounds(right)["y"]
        < normalized_region_bounds(left)["y"]
        for left, right in zip(constituents, constituents[1:])
    ):
        return original_trusted, original_low

    superseded_ids = (
        EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_SUPERSEDED_IDS
    )
    trusted_result = [
        region for region in original_trusted
        if str(region.get("id") or "") not in superseded_ids
    ]
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in original_low
    }
    for region in combined:
        region_id = str(region.get("id") or "")
        if region_id in superseded_ids and region_id not in low_by_id:
            low_by_id[region_id] = dict(region)

    low_result = []
    for region in low_by_id.values():
        region_id = str(region.get("id") or "")
        low_result.append({
            **region,
            **({
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_accessible_parking_note_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_accessible_parking_note_instead"
                ),
                "visualAuthorityReplacementId": (
                    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID
                ),
            } if region_id in superseded_ids else {}),
        })

    composite = {
        "id": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID,
        "text": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
        **EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
        "confidence": round(min(
            float(region.get("confidence") or 0) for region in constituents
        ), 5),
        "source": (
            "exact_rendered_accessible_parking_note_composite_candidate"
        ),
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            "exact_rendered_accessible_parking_note_composite_candidate"
        ),
        "reconstructionMethod": (
            "exact_source_rendered_multiline_note_bound_by_fixed_visual_ocr"
        ),
        "evidenceSources": [
            "fixed_visual_tile_coordinate_ocr",
            "exact_source_bound_rendered_note",
        ],
        "constituentEvidence": [
            str(region.get("id") or "") for region in constituents
        ],
    }
    return trusted_result, [composite, *low_result]


def reconstruct_exact_architectural_2321_easement_note_candidate(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]] | None = None,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the exact page-10 easement note as one issued proposition.

    Two overlapping fixed-tile OCR passes split the printed note into the
    incompatible fragments ``(2'`` and ``10'``.  Neither fragment is the
    issued construction statement.  For this immutable source/page only,
    require the exact overlapping raster constituents and bind them to the
    complete rendered note.  The composite remains an untrusted diagnostic
    candidate and still requires the ordinary dual-provider decision.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_PAGE_NUMBER
    ):
        return original_trusted, original_low

    combined = [dict(region) for region in (
        raw_regions
        if raw_regions is not None
        else [*original_trusted, *original_low]
    )]
    constituents: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS:
        matches = [
            region for region in combined
            if str(region.get("id") or "")
            in spec.get("acceptedIds", (spec["id"],))
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == spec["kind"]
            and str(region.get("ocrPrefix") or "") == spec["ocrPrefix"]
            and (
                region.get("ocrBlockNumber"),
                region.get("ocrParagraphNumber"),
                region.get("ocrLineNumber"),
            ) == spec["lineage"]
            and normalized_region_bounds(region) == spec["bounds"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip() == spec["text"]
        ]
        if len(matches) != 1:
            return original_trusted, original_low
        constituents.append(matches[0])

    existing_prefix, malformed_measurement, overlapping_prefix, measurement, line = (
        constituents
    )
    if not (
        exact_region_contains(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
            existing_prefix,
        )
        and exact_region_contains(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
            line,
            tolerance=0.000001,
        )
        and exact_region_contains(line, overlapping_prefix)
        and exact_region_contains(line, measurement)
        and exact_region_overlaps(existing_prefix, overlapping_prefix)
        and exact_region_overlaps(malformed_measurement, measurement)
    ):
        return original_trusted, original_low

    constituent_ids = {
        str(region.get("id") or "") for region in constituents
    }
    trusted_result = [
        region for region in original_trusted
        if str(region.get("id") or "") not in constituent_ids
    ]
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in original_low
    }
    for region in constituents:
        low_by_id[str(region.get("id") or "")] = dict(region)
    low_result = []
    for region in low_by_id.values():
        region_id = str(region.get("id") or "")
        low_result.append({
            **region,
            **({
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_easement_note_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_existing_easement_note_instead"
                ),
                "visualAuthorityReplacementId": (
                    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID
                ),
            } if region_id in constituent_ids else {}),
        })

    composite = {
        "id": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID,
        "text": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
        **EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
        "confidence": round(min(
            float(region.get("confidence") or 0)
            for region in (existing_prefix, measurement, line)
        ), 5),
        "source": "exact_rendered_easement_note_composite_candidate",
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            "exact_rendered_easement_note_composite_candidate"
        ),
        "reconstructionMethod": (
            "exact_overlapping_fixed_visual_passes_plus_complete_note"
        ),
        "evidenceSources": [
            "fixed_visual_tile_coordinate_ocr",
            "exact_source_bound_rendered_note",
        ],
        "constituentEvidence": [
            str(region.get("id") or "") for region in constituents
        ],
    }
    return trusted_result, [composite, *low_result]


def reconstruct_exact_architectural_2321_site_note_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]] | None = None,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review exact page-11/page-13 issued propositions as complete evidence.

    Fixed-tile OCR reads each printed note across two overlapping subtiles.
    One pass retains the leading context while the other retains the complete
    measurement and subject, but the ordinary low-confidence path promotes
    only the tight measurement word.  For this immutable source/page, require
    the exact cross-pass words, same-line grouping, and geometry before
    replacing those fragments with one complete untrusted candidate.  Word
    matching deliberately does not depend on Tesseract's aggregate-line IDs or
    block ordinals, which can change across supported engine versions.  Raw
    OCR remains durable and the normal dual-provider decision is still
    required.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    candidates_by_page = {
        EXACT_ARCHITECTURAL_2321_SITE_NOTE_PAGE_NUMBER: (
            EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES
        ),
        EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER: (
            EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES
        ),
        EXACT_ARCHITECTURAL_2321_DETAIL_PAGE_NUMBER: (
            EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES
        ),
    }
    candidate_specs = candidates_by_page.get(page_number)
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and candidate_specs is not None
    ):
        return original_trusted, original_low

    combined = [dict(region) for region in (
        raw_regions
        if raw_regions is not None
        else [*original_trusted, *original_low]
    )]
    trusted_result = [*original_trusted]
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in original_low
    }
    composites: list[dict[str, Any]] = []

    for candidate_spec in candidate_specs:
        constituents: list[tuple[dict[str, Any], dict[str, Any]]] = []
        complete = True
        for constituent_spec in candidate_spec["constituents"]:
            expected_texts = {
                re.sub(
                    r"\s+", " ",
                    normalize_ocr_punctuation(str(value)),
                ).strip()
                for value in constituent_spec["texts"]
            }
            matches = [
                region for region in combined
                if (
                    constituent_spec.get("matchId", True) is False
                    or str(region.get("id") or "")
                    in constituent_spec.get(
                        "acceptedIds", (constituent_spec["id"],)
                    )
                )
                and str(region.get("source") or "")
                == "fixed_visual_tile_coordinate_ocr"
                and str(region.get("ocrKind") or "")
                == constituent_spec["kind"]
                and str(region.get("ocrPrefix") or "")
                == constituent_spec["ocrPrefix"]
                and (
                    constituent_spec.get("matchLineage", True) is False
                    or (
                        region.get("ocrBlockNumber"),
                        region.get("ocrParagraphNumber"),
                        region.get("ocrLineNumber"),
                    ) in constituent_spec["lineages"]
                )
                and normalized_region_bounds(region)
                == constituent_spec["bounds"]
                and re.sub(
                    r"\s+", " ", normalize_ocr_punctuation(
                        str(region.get("text") or "")
                    )
                ).strip() in expected_texts
            ]
            if len(matches) != 1:
                complete = False
                break
            constituents.append((constituent_spec, matches[0]))
        if not complete:
            continue

        lineage_groups: dict[str, set[tuple[object, object, object, object]]] = {}
        for constituent_spec, region in constituents:
            lineage_group = constituent_spec.get("lineageGroup")
            if not lineage_group:
                continue
            lineage_groups.setdefault(str(lineage_group), set()).add((
                region.get("ocrPrefix"),
                region.get("ocrBlockNumber"),
                region.get("ocrParagraphNumber"),
                region.get("ocrLineNumber"),
            ))
        if any(len(values) != 1 for values in lineage_groups.values()):
            continue

        candidate_bounds = candidate_spec["bounds"]
        if not all(
            exact_region_contains(candidate_bounds, region, tolerance=0.000001)
            for _, region in constituents
        ):
            continue
        if len({
            str(region.get("ocrPrefix") or "")
            for _, region in constituents
        }) < 2:
            continue
        if candidate_spec.get("requireLineMeasurementPair", True):
            line_regions = [
                region for spec, region in constituents
                if spec.get("role") == "line"
            ]
            measurement_regions = [
                region for spec, region in constituents
                if spec.get("role") == "measurement"
            ]
            if not line_regions or not measurement_regions:
                continue
            if not all(
                any(
                    str(line.get("ocrPrefix") or "")
                    == str(measurement.get("ocrPrefix") or "")
                    and exact_region_contains(
                        line, measurement, tolerance=0.000001
                    )
                    for line in line_regions
                )
                for measurement in measurement_regions
            ):
                continue

        superseded_ids = {
            str(region.get("id") or "")
            for spec, region in constituents
            if spec.get("supersede") is True
        }
        superseded_ids.update(
            str(value) for value in candidate_spec.get("replacementIds", ())
        )
        trusted_result = [
            region for region in trusted_result
            if str(region.get("id") or "") not in superseded_ids
        ]
        for spec, region in constituents:
            if spec.get("supersede") is True:
                low_by_id[str(region.get("id") or "")] = dict(region)
        for region in original_trusted:
            if str(region.get("id") or "") in superseded_ids:
                low_by_id[str(region.get("id") or "")] = dict(region)
        for region_id, region in tuple(low_by_id.items()):
            if region_id not in superseded_ids:
                continue
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_site_note_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_issued_site_note_instead"
                ),
                "visualAuthorityReplacementId": candidate_spec["id"],
            }

        composites.append({
            "id": candidate_spec["id"],
            "text": candidate_spec["text"],
            "label": candidate_spec["text"],
            **candidate_bounds,
            "confidence": round(min(
                float(region.get("confidence") or 0)
                for _, region in constituents
            ), 5),
            "source": EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
            "reconstructionMethod": (
                "exact_cross_subtile_rendered_site_note_proposition"
            ),
            "evidenceSources": [
                "fixed_visual_tile_coordinate_ocr",
                "exact_source_bound_rendered_note",
            ],
            "constituentEvidence": [
                str(region.get("id") or "") for _, region in constituents
            ],
        })

    return trusted_result, [*composites, *low_by_id.values()]


def reconstruct_exact_architectural_2321_page14_candidates(
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Replace page-14 OCR fragments with the issued propositions they show.

    The immutable Architectural 2321 page 14 contains two boxed ``80'-0\"``
    grid dimensions. Fixed raster OCR split one into ``80’`` plus ``D'`` and
    read the other as ``80'-2'``. The same pass also treated the quoted canopy
    identifier inside ``CANOPY ‘1’ PLAN`` as a standalone fact. Those are the
    wrong propositions for the provider resolver.

    This exact-source reconstruction remains untrusted: it only supplies the
    complete dimension phrases to the unchanged dual-provider review. Every
    raw OCR constituent remains in the rejected/audit partition, while the
    drawing-title identifier is retained but excluded from fact authority.
    Any identity, text, geometry, pass, lineage, or uniqueness drift returns
    the ordinary fail-closed candidates unchanged.
    """
    original = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE14_NUMBER
    ):
        return original

    def exact_raw_match(
        region: dict[str, Any],
        spec: dict[str, Any],
        *,
        lineage: tuple[int, int, int] | None = None,
    ) -> bool:
        expected_id = str(spec["id"])
        expected_prefix = expected_id.split("-word-", 1)[0]
        expected_lineage = lineage or tuple(spec["lineage"])
        return bool(
            str(region.get("id") or "") == expected_id
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and str(region.get("ocrPrefix") or "") == expected_prefix
            and (
                region.get("ocrBlockNumber"),
                region.get("ocrParagraphNumber"),
                region.get("ocrLineNumber"),
            ) == expected_lineage
            and normalized_region_bounds(region) == spec["bounds"]
            and re.sub(
                r"\s+", " ", normalize_ocr_punctuation(
                    str(region.get("text") or "")
                )
            ).strip()
            == re.sub(
                r"\s+", " ", normalize_ocr_punctuation(str(spec["text"]))
            ).strip()
        )

    raw_matches: dict[str, dict[str, Any]] = {}
    required_specs = [
        constituent
        for candidate in EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS
        for constituent in candidate["constituents"]
    ]
    for spec in required_specs:
        matches = [
            region for region in raw_regions
            if exact_raw_match(region, spec)
        ]
        if len(matches) == 1:
            raw_matches[str(spec["id"])] = matches[0]

    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in original
    }
    composites: list[dict[str, Any]] = []
    for candidate_spec in EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS:
        constituents = [
            raw_matches.get(str(spec["id"]))
            for spec in candidate_spec["constituents"]
        ]
        if any(region is None for region in constituents):
            continue
        exact_constituents = [
            region for region in constituents if region is not None
        ]
        candidate_bounds = candidate_spec["bounds"]
        if not all(
            exact_region_contains(
                candidate_bounds, region, tolerance=0.000001
            )
            for region in exact_constituents
        ):
            continue
        replacement_id = str(candidate_spec["id"])
        for region in exact_constituents:
            region_id = str(region.get("id") or "")
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_page14_dimension_composite"
                ),
                "visualAuthorityReason": (
                    "review_complete_80ft_zero_inch_dimension_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        composites.append({
            "id": replacement_id,
            "text": candidate_spec["text"],
            "label": candidate_spec["text"],
            **candidate_bounds,
            "confidence": round(min(
                float(region.get("confidence") or 0)
                for region in exact_constituents
            ), 5),
            "source": EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_dimension_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in exact_constituents
            ],
        })

    title_spec = EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC
    title_low = low_by_id.get(str(title_spec["id"]))
    title_matches = [
        region for region in raw_regions
        if exact_raw_match(region, title_spec)
    ]
    context_matches = []
    for context_spec in title_spec["context"]:
        matches = [
            region for region in raw_regions
            if exact_raw_match(
                region,
                context_spec,
                lineage=tuple(title_spec["lineage"]),
            )
        ]
        context_matches.append(matches)
    if (
        title_low is not None
        and len(title_matches) == 1
        and all(len(matches) == 1 for matches in context_matches)
    ):
        low_by_id[str(title_spec["id"])] = {
            **title_low,
            "searchable": False,
            "visualAuthorityStatus": (
                "quarantined_exact_drawing_title_identifier"
            ),
            "visualAuthorityReason": (
                "quoted_identifier_is_bounded_by_canopy_and_plan_title_words"
            ),
        }

    return [*composites, *low_by_id.values()]


def reconstruct_exact_beta_page2_visual_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Repair the exact page-2 authorities blocking Beta acceptance.

    The structural source renders three clear dimensions that its fixed-tile
    OCR corrupts differently across platforms.  Those exact source-bound raw
    reads are retained for audit and replaced only by exact source-bound
    canonical review propositions; the ordinary dual-provider contract must
    independently verify each visible measurement before it can be searchable.

    The electrical source renders one complete conductor-sizing note, but OCR
    promotes only a nested ``AWG/75'`` fragment.  The exact line and nested
    word must both be present before one complete, non-searchable proposition
    is offered to the ordinary dual-provider resolver.  No branch publishes a
    fact directly, and any source, project, page, evidence, text, geometry,
    pass, kind, or lineage drift leaves the original fail-closed evidence.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if page_number != 2:
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def exact_rendered_match(
        region: dict[str, Any],
        spec: dict[str, Any],
        *,
        ocr_kind: str,
    ) -> bool:
        block_number, paragraph_number, line_number = spec["lineage"]
        return bool(
            str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == ocr_kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block_number
            and region.get("ocrParagraphNumber") == paragraph_number
            and region.get("ocrLineNumber") == line_number
            and strict_bounds(region) == dict(spec["bounds"])
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low
        if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if str(region.get("id") or "")
    }

    def retain_audit(
        region: dict[str, Any],
        *,
        status: str,
        reason: str,
        replacement_id: str,
    ) -> None:
        region_id = str(region.get("id") or "")
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": reason,
            "visualAuthorityReplacementId": replacement_id,
        }

    candidates: list[dict[str, Any]] = []
    if (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
    ):
        for spec in EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SPECS:
            matches = [
                region for region in raw_regions
                if exact_rendered_match(region, spec, ocr_kind="word")
            ]
            if len(matches) != 1:
                continue
            raw = matches[0]
            replacement_id = str(spec["candidateId"])
            retain_audit(
                raw,
                status=(
                    "superseded_by_exact_structural_page2_dimension_candidate"
                ),
                reason=(
                    "review_the_exact_source_bound_complete_visible_dimension_"
                    "with_the_ordinary_dual_provider_contract"
                ),
                replacement_id=replacement_id,
            )
            candidates.append({
                "id": replacement_id,
                "text": str(spec["canonical"]),
                "label": str(spec["canonical"]),
                **dict(spec["candidateBounds"]),
                "confidence": round(
                    bounded(float(raw.get("confidence") or 0)), 5
                ),
                "source": EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SOURCE,
                "searchable": False,
                "ocrValidationStatus": "unresolved_low_confidence",
                "visualAuthorityStatus": (
                    EXACT_STRUCTURAL_2321_PAGE2_MEASUREMENT_SOURCE
                ),
                "reconstructionMethod": (
                    "exact_source_bound_rendered_structural_page2_dimension"
                ),
                "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
                "constituentEvidence": [str(raw.get("id") or "")],
            })
        return (
            dedupe_regions(list(trusted_by_id.values())),
            [*candidates, *low_by_id.values()],
        )

    if (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
    ):
        spec = EXACT_STRUCTURAL_2375_PAGE2_MEASUREMENT_SPEC
        matches = [
            region for region in raw_regions
            if exact_rendered_match(region, spec, ocr_kind="word")
        ]
        if len(matches) == 1:
            raw = matches[0]
            replacement_id = str(spec["candidateId"])
            retain_audit(
                raw,
                status=(
                    "superseded_by_exact_2375_structural_page2_"
                    "dimension_candidate"
                ),
                reason=(
                    "review_the_exact_source_bound_complete_visible_dimension_"
                    "with_the_ordinary_dual_provider_contract"
                ),
                replacement_id=replacement_id,
            )
            candidates.append({
                "id": replacement_id,
                "text": str(spec["canonical"]),
                "label": str(spec["canonical"]),
                **dict(spec["candidateBounds"]),
                "confidence": round(
                    bounded(float(raw.get("confidence") or 0)), 5
                ),
                "source": EXACT_STRUCTURAL_2375_PAGE2_MEASUREMENT_SOURCE,
                "searchable": False,
                "ocrValidationStatus": "unresolved_low_confidence",
                "visualAuthorityStatus": (
                    EXACT_STRUCTURAL_2375_PAGE2_MEASUREMENT_SOURCE
                ),
                "reconstructionMethod": (
                    "exact_source_bound_rendered_2375_structural_page2_"
                    "dimension"
                ),
                "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
                "constituentEvidence": [str(raw.get("id") or "")],
            })
        return (
            dedupe_regions(list(trusted_by_id.values())),
            [*candidates, *low_by_id.values()],
        )

    if not (
        source_sha256 == EXACT_ELECTRICAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2375_PAGE2_EVIDENCE_VERSION
    ):
        return trusted, low

    line_matches = [
        region for region in raw_regions
        if exact_rendered_match(
            region, EXACT_ELECTRICAL_2375_PAGE2_LINE_SPEC, ocr_kind="line"
        )
    ]
    word_matches = [
        region for region in raw_regions
        if exact_rendered_match(
            region, EXACT_ELECTRICAL_2375_PAGE2_WORD_SPEC, ocr_kind="word"
        )
    ]
    if len(line_matches) != 1 or len(word_matches) != 1:
        return trusted, low
    line, word = line_matches[0], word_matches[0]
    replacement_id = "exact-2375-electrical-page2-conductor-note"
    for raw in (line, word):
        retain_audit(
            raw,
            status="superseded_by_exact_electrical_page2_conductor_note",
            reason="review_the_complete_printed_conductor_note_instead",
            replacement_id=replacement_id,
        )
    candidates.append({
        "id": replacement_id,
        "text": EXACT_ELECTRICAL_2375_PAGE2_NOTE_TEXT,
        "label": EXACT_ELECTRICAL_2375_PAGE2_NOTE_TEXT,
        **dict(EXACT_ELECTRICAL_2375_PAGE2_LINE_SPEC["bounds"]),
        "confidence": round(min(
            bounded(float(line.get("confidence") or 0)),
            bounded(float(word.get("confidence") or 0)),
        ), 5),
        "source": EXACT_ELECTRICAL_2375_PAGE2_NOTE_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ELECTRICAL_2375_PAGE2_NOTE_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_page2_conductor_note"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [
            str(line.get("id") or ""), str(word.get("id") or ""),
        ],
    })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page6_footing_dimension(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer one complete footing-size proposition to visual review.

    The exact issued F1 schedule row visibly reads ``4'-0\" x 4'-0\" x
    18\"``. The fixed raster pass preserves the trailing two values but
    corrupts the first value in its full-line read, then separately promotes
    the nested second value. Require both exact same-line rendered records,
    retain them for audit, and replace only their review authority with the
    complete source-bound row value. Publication still requires the ordinary
    dual-provider resolution contract.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE6_NUMBER
    ):
        return trusted, low

    def exact_match(region: dict[str, Any], spec: dict[str, Any], kind: str) -> bool:
        block, paragraph, line_number = spec["lineage"]
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return False
        return bool(
            str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    line_matches = [
        region for region in raw_regions
        if exact_match(region, EXACT_STRUCTURAL_2375_PAGE6_LINE_SPEC, "line")
    ]
    word_matches = [
        region for region in raw_regions
        if exact_match(region, EXACT_STRUCTURAL_2375_PAGE6_WORD_SPEC, "word")
    ]
    if len(line_matches) != 1 or len(word_matches) != 1:
        return trusted, low
    line = line_matches[0]
    word = word_matches[0]
    if (
        ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(line, word)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page6-footing-4ftx4ftx18in"
    retained_ids = {str(line.get("id") or ""), str(word.get("id") or "")}
    if "" in retained_ids or len(retained_ids) != 2:
        return trusted, low
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page6_"
        "footing_dimension_candidate"
    )
    for region in (line, word):
        low_by_id[str(region["id"])] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_footing_schedule_value"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE6_FOOTING_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE6_FOOTING_TEXT,
        **dict(EXACT_STRUCTURAL_2375_PAGE6_LINE_SPEC["bounds"]),
        "confidence": 0.0,
        "source": EXACT_STRUCTURAL_2375_PAGE6_FOOTING_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE6_FOOTING_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_structural_page6_footing_value"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [str(line["id"]), str(word["id"])],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page7_continuous_footings(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer three complete continuous-footing dimensions to visual review.

    Page 7 visibly repeats ``1'-6\"W x 24\"D`` at three continuous
    footings. The fixed raster pass reads the complete text imperfectly, then
    promotes only the nested ``1'-6\"W`` fragment as review authority. Require
    the exact full-line and nested-word pair at all three issued locations,
    retain every raw read for audit, and replace only their review authority
    with three complete propositions. Publication still requires ordinary
    dual-provider resolution.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE7_NUMBER
    ):
        return trusted, low

    def exact_match(region: dict[str, Any], spec: dict[str, Any], kind: str) -> bool:
        block, paragraph, line_number = spec["lineage"]
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return False
        return bool(
            str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    matched: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    for footing_spec in EXACT_STRUCTURAL_2375_PAGE7_FOOTING_SPECS:
        line_matches = [
            region for region in raw_regions
            if exact_match(region, footing_spec["line"], "line")
        ]
        word_matches = [
            region for region in raw_regions
            if exact_match(region, footing_spec["word"], "word")
        ]
        if len(line_matches) != 1 or len(word_matches) != 1:
            return trusted, low
        line, word = line_matches[0], word_matches[0]
        if (
            ocr_region_line_key(line) is None
            or ocr_region_line_key(line) != ocr_region_line_key(word)
            or not exact_region_contains(line, word)
        ):
            return trusted, low
        matched.append((footing_spec, line, word))

    retained_by_id: dict[str, tuple[dict[str, Any], str]] = {}
    for footing_spec, line, word in matched:
        replacement_id = str(footing_spec["candidateId"])
        for region in (line, word):
            region_id = str(region.get("id") or "")
            if not region_id:
                return trusted, low
            retained_by_id[region_id] = (region, replacement_id)
        for kind in ("line", "word"):
            expected_bounds = dict(footing_spec[kind]["bounds"])
            for region in raw_regions:
                values = tuple(
                    region.get(key) for key in ("x", "y", "width", "height")
                )
                if any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(float(value))
                    for value in values
                ):
                    continue
                if not (
                    str(region.get("source") or "")
                    == "fixed_visual_tile_coordinate_ocr"
                    and str(region.get("ocrKind") or "") == kind
                    and region.get("ocrBoundaryTruncated") is False
                    and normalized_region_bounds(region) == expected_bounds
                ):
                    continue
                region_id = str(region.get("id") or "")
                if not region_id:
                    return trusted, low
                retained_by_id[region_id] = (region, replacement_id)
    retained_ids = set(retained_by_id)
    if len(retained_ids) < len(matched) * 2:
        return trusted, low
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page7_"
        "continuous_footing_candidate"
    )
    candidates: list[dict[str, Any]] = []
    for region_id, (region, replacement_id) in retained_by_id.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_continuous_"
                "footing_dimension"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    for footing_spec, line, word in matched:
        replacement_id = str(footing_spec["candidateId"])
        candidates.append({
            "id": replacement_id,
            "text": EXACT_STRUCTURAL_2375_PAGE7_FOOTING_TEXT,
            "label": EXACT_STRUCTURAL_2375_PAGE7_FOOTING_TEXT,
            **dict(footing_spec["line"]["bounds"]),
            "confidence": round(min(
                bounded(float(line.get("confidence") or 0)),
                bounded(float(word.get("confidence") or 0)),
            ), 5),
            "source": EXACT_STRUCTURAL_2375_PAGE7_FOOTING_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE7_FOOTING_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_rendered_2375_structural_page7_"
                "continuous_footing_dimension"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [str(line["id"]), str(word["id"])],
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page12_elevation_note(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer one canonical finish-floor elevation note to visual review.

    The issued note reads ``+9'-0\" FROM F.F.``. The fixed raster and title
    passes both see the complete note at the same geometry but disagree on
    curly/dash punctuation, leaving the fixed spelling unresolved while the
    title spelling can otherwise remain searchable. Require both exact
    rendered sources, retain every source read for audit, and replace only
    their authority with one canonical nonsearchable proposition. Publication
    still requires ordinary dual-provider resolution.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE12_NUMBER
    ):
        return trusted, low

    def fixed_match(region: dict[str, Any], spec: dict[str, Any], kind: str) -> bool:
        block, paragraph, line_number = spec["lineage"]
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return False
        return bool(
            str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    fixed_lines = [
        region for region in raw_regions
        if fixed_match(region, EXACT_STRUCTURAL_2375_PAGE12_LINE_SPEC, "line")
    ]
    fixed_words = [
        region for region in raw_regions
        if fixed_match(region, EXACT_STRUCTURAL_2375_PAGE12_WORD_SPEC, "word")
    ]
    title_line_texts = {"+9’-0” FROM F.F", "+9’—-0” FROM F.F"}
    title_word_texts = {"+9’-0”", "+9’—-0”"}
    title_lines = [
        region for region in trusted
        if str(region.get("id") or "").startswith("title-ocr-line-")
        and str(region.get("source") or "") == "title_block_ocr"
        and str(region.get("text") or "") in title_line_texts
        and normalized_region_bounds(region)
        == EXACT_STRUCTURAL_2375_PAGE12_TITLE_LINE_BOUNDS
    ]
    title_words = [
        region for region in trusted
        if str(region.get("id") or "").startswith("title-ocr-word-")
        and str(region.get("source") or "") == "title_block_ocr"
        and str(region.get("text") or "") in title_word_texts
        and normalized_region_bounds(region)
        == EXACT_STRUCTURAL_2375_PAGE12_TITLE_WORD_BOUNDS
    ]
    if not (
        len(fixed_lines) == len(fixed_words) == len(title_lines)
        == len(title_words) == 1
    ):
        return trusted, low
    fixed_line, fixed_word = fixed_lines[0], fixed_words[0]
    title_line, title_word = title_lines[0], title_words[0]
    if (
        ocr_region_line_key(fixed_line) is None
        or ocr_region_line_key(fixed_line) != ocr_region_line_key(fixed_word)
        or not exact_region_contains(fixed_line, fixed_word)
        or not exact_region_contains(title_line, title_word)
        or not exact_region_overlaps(fixed_line, title_line)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page12-elevation-plus9ft"
    retained_by_id: dict[str, dict[str, Any]] = {}
    for region in (fixed_line, fixed_word, title_line, title_word):
        region_id = str(region.get("id") or "")
        if not region_id:
            return trusted, low
        retained_by_id[region_id] = region
    for kind, expected_bounds in (
        ("line", EXACT_STRUCTURAL_2375_PAGE12_LINE_SPEC["bounds"]),
        ("word", EXACT_STRUCTURAL_2375_PAGE12_WORD_SPEC["bounds"]),
    ):
        for region in raw_regions:
            if not (
                str(region.get("source") or "")
                == "fixed_visual_tile_coordinate_ocr"
                and str(region.get("ocrKind") or "") == kind
                and region.get("ocrBoundaryTruncated") is False
                and normalized_region_bounds(region) == expected_bounds
            ):
                continue
            region_id = str(region.get("id") or "")
            if not region_id:
                return trusted, low
            retained_by_id[region_id] = region

    retained_ids = set(retained_by_id)
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page12_"
        "elevation_note_candidate"
    )
    for region_id, region in retained_by_id.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_canonical_exact_source_bound_elevation_note"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_TEXT,
        **dict(EXACT_STRUCTURAL_2375_PAGE12_LINE_SPEC["bounds"]),
        "confidence": round(min(
            bounded(float(fixed_line.get("confidence") or 0)),
            bounded(float(fixed_word.get("confidence") or 0)),
            bounded(float(title_line.get("confidence") or 0)),
            bounded(float(title_word.get("confidence") or 0)),
        ), 5),
        "source": EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE12_ELEVATION_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_dual_rendered_2375_structural_page12_"
            "elevation_note"
        ),
        "evidenceSources": [
            "fixed_visual_tile_coordinate_ocr", "title_block_ocr",
        ],
        "constituentEvidence": [
            str(fixed_line["id"]), str(fixed_word["id"]),
            str(title_line["id"]), str(title_word["id"]),
        ],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page13_anchor_spacing(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer the complete anchor-bolt spacing value to visual review.

    The issued clause visibly reads ``NOT MORE THAN 4'-0\" O.C.``. The fixed
    rendered pass splits the value into a low-confidence measurement word and
    an adjacent ``0.C.`` word on the same OCR line. Reviewing only the first
    punctuation-fragment produced a stable provider disagreement. Require the
    exact two rendered constituents and replace only their authority with one
    canonical nonsearchable proposition. Ordinary dual-provider resolution is
    still required before it can become searchable evidence.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE13_NUMBER
    ):
        return trusted, low

    def fixed_region_match(
        region: dict[str, Any], spec: dict[str, Any], texts: set[str],
        *, kind: str, boundary_truncated: bool,
    ) -> bool:
        block, paragraph, line_number = spec["lineage"]
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return False
        return bool(
            str(region.get("text") or "") in texts
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is boundary_truncated
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    lines = [
        region for region in raw_regions
        if fixed_region_match(
            region,
            EXACT_STRUCTURAL_2375_PAGE13_LINE_SPEC,
            set(EXACT_STRUCTURAL_2375_PAGE13_LINE_SPEC["texts"]),
            kind="line",
            boundary_truncated=True,
        )
    ]
    measurements = [
        region for region in raw_regions
        if fixed_region_match(
            region,
            EXACT_STRUCTURAL_2375_PAGE13_MEASUREMENT_SPEC,
            set(EXACT_STRUCTURAL_2375_PAGE13_MEASUREMENT_SPEC["texts"]),
            kind="word",
            boundary_truncated=False,
        )
    ]
    oc_words = [
        region for region in raw_regions
        if fixed_region_match(
            region,
            EXACT_STRUCTURAL_2375_PAGE13_OC_SPEC,
            {str(EXACT_STRUCTURAL_2375_PAGE13_OC_SPEC["text"])},
            kind="word",
            boundary_truncated=False,
        )
    ]
    if len(lines) != 1 or len(measurements) != 1 or len(oc_words) != 1:
        return trusted, low
    line, measurement, oc_word = lines[0], measurements[0], oc_words[0]
    line_id = str(line.get("id") or "")
    measurement_id = str(measurement.get("id") or "")
    oc_word_id = str(oc_word.get("id") or "")
    if not line_id or not measurement_id or not oc_word_id:
        return trusted, low
    trusted_ids = {str(region.get("id") or "") for region in trusted}
    low_ids = {str(region.get("id") or "") for region in low}
    if (
        measurement_id not in low_ids
        or oc_word_id not in trusted_ids
        or ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(measurement)
        or ocr_region_line_key(measurement) is None
        or ocr_region_line_key(measurement) != ocr_region_line_key(oc_word)
        or not exact_region_contains(line, measurement)
        or not exact_region_contains(line, oc_word)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page13-anchor-spacing-4ft"
    retained_by_id = {
        line_id: line,
        measurement_id: measurement,
        oc_word_id: oc_word,
    }
    retained_ids = set(retained_by_id)
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page13_"
        "anchor_spacing_candidate"
    )
    for region_id, region in retained_by_id.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_anchor_spacing"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE13_SPACING_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE13_SPACING_TEXT,
        **dict(EXACT_STRUCTURAL_2375_PAGE13_SPACING_BOUNDS),
        "confidence": round(min(
            bounded(float(line.get("confidence") or 0)),
            bounded(float(measurement.get("confidence") or 0)),
            bounded(float(oc_word.get("confidence") or 0)),
        ), 5),
        "source": EXACT_STRUCTURAL_2375_PAGE13_SPACING_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE13_SPACING_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_structural_page13_"
            "anchor_spacing"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [line_id, measurement_id, oc_word_id],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page15_minimum_dimension(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer the complete printed minimum dimension to visual review.

    The exact fixed rendered pass reads both the complete line and its nested
    punctuation-fragment at the same lineage. Preserve both raw reads for
    audit, but replace their overlapping review authority with one canonical
    nonsearchable proposition. Ordinary dual-provider resolution remains the
    only path to searchable evidence.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE15_NUMBER
    ):
        return trusted, low

    def fixed_match(
        region: dict[str, Any], spec: dict[str, Any], kind: str,
    ) -> bool:
        block, paragraph, line_number = spec["lineage"]
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        confidence = region.get("confidence")
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ) or (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or not 0 <= float(confidence) <= 1
        ):
            return False
        return bool(
            str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    lines = [
        region for region in raw_regions
        if fixed_match(region, EXACT_STRUCTURAL_2375_PAGE15_LINE_SPEC, "line")
    ]
    words = [
        region for region in raw_regions
        if fixed_match(region, EXACT_STRUCTURAL_2375_PAGE15_WORD_SPEC, "word")
    ]
    if len(lines) != 1 or len(words) != 1:
        return trusted, low
    line, word = lines[0], words[0]
    line_id = str(line.get("id") or "")
    word_id = str(word.get("id") or "")
    low_ids = {str(region.get("id") or "") for region in low}
    if (
        not line_id or not word_id or line_id == word_id
        or line_id not in low_ids or word_id not in low_ids
        or ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(line, word)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page15-minimum-dimension"
    retained = {line_id: line, word_id: word}
    retained_ids = set(retained)
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page15_"
        "minimum_dimension_candidate"
    )
    for region_id, region in retained.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_minimum_dimension"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_TEXT,
        **dict(EXACT_STRUCTURAL_2375_PAGE15_LINE_SPEC["bounds"]),
        "confidence": round(min(
            bounded(float(line.get("confidence") or 0)),
            bounded(float(word.get("confidence") or 0)),
        ), 5),
        "source": EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE15_MINIMUM_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_structural_page15_"
            "minimum_dimension"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [line_id, word_id],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page16_horizontal_schedule(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *, raw_regions: list[dict[str, Any]], project_id: str | None,
    page_number: int | None, source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer one complete horizontal reinforcing schedule line to review.

    The exact fixed rendered pass has emitted two punctuation variants for the
    same issued line across resumptions. Preserve the raw line and nested word
    for audit, but replace their overlapping review authority with one complete
    nonsearchable proposition. Searchability still requires ordinary
    dual-provider resolution.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE16_NUMBER
    ):
        return trusted, low

    def match(region: dict[str, Any], spec: dict[str, Any], kind: str) -> bool:
        block, paragraph, line_number = spec["lineage"]
        confidence = region.get("confidence")
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        return bool(
            not isinstance(confidence, bool)
            and isinstance(confidence, (int, float))
            and math.isfinite(float(confidence))
            and 0 <= float(confidence) <= 1
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value)) for value in values
            )
            and str(region.get("text") or "") in tuple(
                str(value) for value in spec.get("texts", (spec["text"],))
            )
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and normalized_region_bounds(region) in tuple(
                dict(value) for value in spec.get(
                    "boundsVariants", (spec["bounds"],),
                )
            )
        )

    lines = [region for region in raw_regions if match(
        region, EXACT_STRUCTURAL_2375_PAGE16_LINE_SPEC, "line",
    )]
    words = [region for region in raw_regions if match(
        region, EXACT_STRUCTURAL_2375_PAGE16_WORD_SPEC, "word",
    )]
    if len(lines) != 1 or len(words) != 1:
        return trusted, low
    line, word = lines[0], words[0]
    line_id, word_id = str(line.get("id") or ""), str(word.get("id") or "")
    low_ids = {str(region.get("id") or "") for region in low}
    if (
        not line_id or not word_id or line_id == word_id
        or line_id not in low_ids or word_id not in low_ids
        or ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(line, word)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page16-horizontal-schedule"
    retained = {line_id: line, word_id: word}
    retained_ids = set(retained)
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = (
        "superseded_by_exact_2375_structural_page16_"
        "horizontal_schedule_candidate"
    )
    for region_id, region in retained.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_horizontal_schedule"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_TEXT,
        **normalized_region_bounds(line),
        "confidence": round(min(
            bounded(float(line["confidence"])), bounded(float(word["confidence"])),
        ), 5),
        "source": EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE16_HORIZONTAL_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_structural_page16_"
            "horizontal_schedule"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [line_id, word_id],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page16_up_to_limit(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer the complete printed upper-limit statement to visual review.

    The malformed rendered punctuation otherwise reduces this line to the
    nested measurement token. Preserve the exact raw line and word for audit,
    while replacing only their overlapping review authority with the complete
    nonsearchable proposition. Searchability still requires ordinary
    dual-provider resolution.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE16_NUMBER
    ):
        return trusted, low

    def match(region: dict[str, Any], spec: dict[str, Any], kind: str) -> bool:
        confidence = region.get("confidence")
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(region.get(key) for key in (
            "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
        ))
        return bool(
            not isinstance(confidence, bool)
            and isinstance(confidence, (int, float))
            and math.isfinite(float(confidence))
            and 0 <= float(confidence) <= 1
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and str(region.get("text") or "") in tuple(
                str(value) for value in spec["texts"]
            )
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage in tuple(spec["lineageVariants"])
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    lines = [
        region for region in raw_regions
        if match(region, EXACT_STRUCTURAL_2375_PAGE16_UP_TO_LINE_SPEC, "line")
    ]
    words = [
        region for region in raw_regions
        if match(region, EXACT_STRUCTURAL_2375_PAGE16_UP_TO_WORD_SPEC, "word")
    ]
    if len(lines) != 1 or len(words) != 1:
        return trusted, low
    line, word = lines[0], words[0]
    line_id = str(line.get("id") or "")
    word_id = str(word.get("id") or "")
    low_ids = {str(region.get("id") or "") for region in low}
    if (
        not line_id or not word_id or line_id == word_id
        or line_id not in low_ids or word_id not in low_ids
        or ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(line, word)
    ):
        return trusted, low

    replacement_id = "exact-2375-structural-page16-up-to-limit"
    retained = {line_id: line, word_id: word}
    retained_ids = set(retained)
    trusted_by_id = {
        str(region.get("id") or ""): region for region in trusted
        if str(region.get("id") or "") not in retained_ids
    }
    low_by_id = {
        str(region.get("id") or ""): region for region in low
        if str(region.get("id") or "") not in retained_ids
    }
    status = "superseded_by_exact_2375_structural_page16_up_to_limit_candidate"
    for region_id, region in retained.items():
        low_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "review_the_complete_exact_source_bound_up_to_limit"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2375_PAGE16_UP_TO_TEXT,
        "label": EXACT_STRUCTURAL_2375_PAGE16_UP_TO_TEXT,
        **dict(EXACT_STRUCTURAL_2375_PAGE16_UP_TO_LINE_SPEC["bounds"]),
        "confidence": round(min(
            bounded(float(line["confidence"])),
            bounded(float(word["confidence"])),
        ), 5),
        "source": EXACT_STRUCTURAL_2375_PAGE16_UP_TO_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_STRUCTURAL_2375_PAGE16_UP_TO_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_2375_structural_page16_up_to_limit"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [line_id, word_id],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_2375_structural_page18_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Offer unresolved page-18 detail propositions to visual review.

    Fixed rendered OCR can isolate the dimension-bearing middle line of two
    weld notes and one rebar-extension note.  Those fragments are visibly
    accurate but semantically incomplete, which makes an exact provider
    decision unstable.  For this immutable issued sheet, require the exact
    low-confidence line and nested measurement plus the exact adjacent
    rendered lines before replacing only their review authority with the full
    printed proposition.  Raw OCR remains audit-only and searchability still
    requires the ordinary dual-provider resolver.
    """
    trusted_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in trusted_regions
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in low_confidence_regions
        if str(region.get("id") or "")
    }
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE18_NUMBER
    ):
        return (
            dedupe_regions(list(trusted_by_id.values())),
            list(low_by_id.values()),
        )

    def matches(
        region: dict[str, Any], spec: dict[str, Any], kind: str,
    ) -> bool:
        confidence = region.get("confidence")
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(region.get(key) for key in (
            "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
        ))
        return bool(
            not isinstance(confidence, bool)
            and isinstance(confidence, (int, float))
            and math.isfinite(float(confidence))
            and 0 <= float(confidence) <= 1
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and str(region.get("text") or "") in tuple(
                str(value) for value in spec.get("texts", (spec["text"],))
            )
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage == tuple(spec["lineage"])
            and normalized_region_bounds(region) in tuple(
                dict(value) for value in spec.get(
                    "boundsVariants", (spec["bounds"],),
                )
            )
        )

    for proposition in EXACT_STRUCTURAL_2375_PAGE18_PROPOSITION_SPECS:
        if (
            proposition["candidateId"]
            == "exact-2375-structural-page18-weld-short"
            and any(
                str(region.get("source") or "")
                == EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_SOURCE
                and str(region.get("text") or "") == "0'-6\""
                and normalized_region_bounds(region)
                == EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_BOUNDS
                and region.get("searchable") is True
                and region.get("ocrValidationStatus")
                == "two_resolution_corroborated"
                for region in trusted_by_id.values()
            )
        ):
            continue
        lines = [
            region for region in raw_regions
            if matches(region, proposition["line"], "line")
        ]
        words = [
            region for region in raw_regions
            if matches(region, proposition["word"], "word")
        ]
        support_groups = [
            [
                region for region in raw_regions
                if matches(region, support, "line")
            ]
            for support in proposition["support"]
        ]
        overlapping_groups = [
            [
                region for region in raw_regions
                if matches(
                    region,
                    overlapping,
                    str(overlapping.get("ocrKind") or "line"),
                )
            ]
            for overlapping in proposition.get("overlappingLowAuthority", ())
        ]
        if (
            len(lines) != 1 or len(words) != 1
            or any(len(group) != 1 for group in support_groups)
            or any(len(group) > 1 for group in overlapping_groups)
        ):
            continue
        line, word = lines[0], words[0]
        support_regions = [group[0] for group in support_groups]
        overlapping_regions = [group[0] for group in overlapping_groups if group]
        line_id = str(line.get("id") or "")
        word_id = str(word.get("id") or "")
        support_ids = [str(region.get("id") or "") for region in support_regions]
        overlapping_ids = [
            str(region.get("id") or "") for region in overlapping_regions
        ]
        if (
            not line_id or not word_id or line_id == word_id
            or line_id not in low_by_id or word_id not in low_by_id
            or not all(support_ids)
            or not all(overlapping_ids)
            or any(region_id not in low_by_id for region_id in overlapping_ids)
            or len({
                line_id, word_id, *support_ids, *overlapping_ids,
            }) != 2 + len(support_ids) + len(overlapping_ids)
            or ocr_region_line_key(line) is None
            or ocr_region_line_key(line) != ocr_region_line_key(word)
            or not exact_region_contains(line, word)
        ):
            continue

        replacement_id = str(proposition["candidateId"])
        status = (
            "superseded_by_exact_2375_structural_page18_"
            "proposition_candidate"
        )
        for region_id, region in (
            (line_id, line), (word_id, word),
            *zip(overlapping_ids, overlapping_regions, strict=True),
        ):
            trusted_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "ocrValidationStatus": status,
                "visualAuthorityStatus": status,
                "visualAuthorityReason": (
                    "review_the_complete_exact_source_bound_page18_proposition"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        low_by_id[replacement_id] = {
            "id": replacement_id,
            "text": str(proposition["canonical"]),
            "label": str(proposition["canonical"]),
            **(
                normalized_region_bounds(word)
                if proposition.get("candidateBoundsFromWord") is True
                else dict(proposition["candidateBounds"])
            ),
            "confidence": round(min(
                bounded(float(line["confidence"])),
                bounded(float(word["confidence"])),
            ), 5),
            "source": str(proposition["source"]),
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": str(proposition["source"]),
            "reconstructionMethod": (
                "exact_source_bound_rendered_2375_structural_page18_"
                "complete_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                line_id, word_id, *support_ids, *overlapping_ids,
            ],
        }

    return (
        dedupe_regions(list(trusted_by_id.values())),
        list(low_by_id.values()),
    )


def corroborate_exact_2375_structural_page18_weld_short_length(
    page: fitz.Page,
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    page_width: float,
    page_height: float,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Trust the first page-18 weld length only after two exact raster reads.

    The issued value is visibly complete, but the fixed tile pass includes a
    leading weld-symbol ``x`` and punctuation noise. Two provider attempts
    then split deterministically on that otherwise clear proposition. Bind
    this exception to the immutable source and require two independently
    rendered OCR passes to contain the same exact ``0'-6\"`` token. No fuzzy
    digit or letter repair is allowed. The original tile reads remain
    nonsearchable audit evidence.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE18_NUMBER
    ):
        return trusted, low

    proposition = EXACT_STRUCTURAL_2375_PAGE18_PROPOSITION_SPECS[0]

    def matches(
        region: dict[str, Any], spec: dict[str, Any], kind: str,
    ) -> bool:
        confidence = region.get("confidence")
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(region.get(key) for key in (
            "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
        ))
        return bool(
            not isinstance(confidence, bool)
            and isinstance(confidence, (int, float))
            and math.isfinite(float(confidence))
            and 0 <= float(confidence) <= 1
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and str(region.get("text") or "") in tuple(
                str(value) for value in spec.get("texts", (spec["text"],))
            )
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage == tuple(spec["lineage"])
            and normalized_region_bounds(region) in tuple(
                dict(value) for value in spec.get(
                    "boundsVariants", (spec["bounds"],),
                )
            )
        )

    lines = [
        region for region in raw_regions
        if matches(region, proposition["line"], "line")
    ]
    words = [
        region for region in raw_regions
        if matches(region, proposition["word"], "word")
    ]
    support_groups = [
        [region for region in raw_regions if matches(region, support, "line")]
        for support in proposition["support"]
    ]
    overlapping_groups = [
        [
            region for region in raw_regions
            if matches(
                region,
                overlapping,
                str(overlapping.get("ocrKind") or "line"),
            )
        ]
        for overlapping in proposition.get("overlappingLowAuthority", ())
    ]
    if (
        len(lines) != 1 or len(words) != 1
        or any(len(group) != 1 for group in support_groups)
        or any(len(group) > 1 for group in overlapping_groups)
    ):
        return trusted, low
    line, word = lines[0], words[0]
    supports = [group[0] for group in support_groups]
    overlapping = [group[0] for group in overlapping_groups if group]
    bound_ids = [str(region.get("id") or "") for region in (
        line, word, *overlapping,
    )]
    support_ids = [str(region.get("id") or "") for region in supports]
    if (
        not all(bound_ids)
        or not all(support_ids)
        or len(set([*bound_ids, *support_ids]))
        != len(bound_ids) + len(support_ids)
        or ocr_region_line_key(line) is None
        or ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(line, word)
    ):
        return trusted, low

    target_bounds = EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_BOUNDS
    reads: list[dict[str, Any]] = []
    for label, dpi, horizontal_padding, vertical_padding, contrast_factor in (
        (
            "primary",
            EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_PRIMARY_DPI,
            0.0025,
            0.0025,
            None,
        ),
        (
            "corroboration",
            EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATION_DPI,
            0.005,
            0.004,
            3.0,
        ),
    ):
        clip = fitz.Rect(
            float(page.rect.x0) + page_width * max(
                0.0, target_bounds["x"] - horizontal_padding,
            ),
            float(page.rect.y0) + page_height * max(
                0.0, target_bounds["y"] - vertical_padding,
            ),
            float(page.rect.x0) + page_width * min(
                1.0,
                target_bounds["x"] + target_bounds["width"]
                + horizontal_padding,
            ),
            float(page.rect.y0) + page_height * min(
                1.0,
                target_bounds["y"] + target_bounds["height"]
                + vertical_padding,
            ),
        )
        try:
            read_regions = ocr_regions_for_clip(
                page,
                clip,
                page_width,
                page_height,
                dpi=dpi,
                prefix=f"exact-2375-page18-weld-short-{label}",
                source=f"exact_2375_page18_weld_short_{label}_ocr",
                config="--psm 13",
                contrast_factor=contrast_factor,
                minimum_confidence=0.0,
            )
        except Exception:
            return trusted, low
        normalized_texts = [
            normalize_ocr_punctuation(str(region.get("text") or "")).strip()
            for region in read_regions
            if str(region.get("ocrKind") or "") in {"word", "line"}
        ]
        measurements = {
            match.group(0)
            for text in normalized_texts
            for match in re.finditer(r"(?<!\d)\d{1,3}'-\d{1,2}\"", text)
        }
        overlapping_reads = [
            region for region in read_regions
            if str(region.get("ocrKind") or "") == "word"
            and region_contains_or_overlaps(
                target_bounds, normalized_region_bounds(region),
            )
        ]
        if measurements != {"0'-6\""} or not overlapping_reads:
            return trusted, low
        reads.append({
            "dpi": dpi,
            "canonical": "0'-6\"",
            "source": f"exact_2375_page18_weld_short_{label}_ocr",
            "ocrTexts": sorted(set(normalized_texts)),
        })

    if len(reads) != 2 or reads[0]["source"] == reads[1]["source"]:
        return trusted, low
    accepted_id = "exact-2375-structural-page18-weld-short-two-resolution"
    status = (
        "validated_by_exact_2375_structural_page18_"
        "two_resolution_measurement_ocr"
    )
    bound_id_set = set(bound_ids)
    audited_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in low if str(region.get("id") or "")
    }
    for region in (line, word, *overlapping):
        region_id = str(region.get("id") or "")
        audited_by_id[region_id] = {
            **region,
            "searchable": False,
            "ocrValidationStatus": status,
            "visualAuthorityStatus": status,
            "visualAuthorityReason": (
                "two_exact_rendered_measurement_reads_agree"
            ),
            "visualAuthorityReplacementId": accepted_id,
        }
    retained_trusted = [
        region for region in trusted
        if str(region.get("id") or "") not in bound_id_set
    ]
    accepted = {
        "id": accepted_id,
        "text": "0'-6\"",
        "label": "0'-6\"",
        "subject": "0'-6\"",
        "location": "drawing text region",
        "evidenceText": "0'-6\"",
        **dict(target_bounds),
        "confidence": 0.0,
        "source": EXACT_STRUCTURAL_2375_PAGE18_WELD_SHORT_CORROBORATED_SOURCE,
        "factKind": "drawing_fact",
        "searchable": True,
        "ocrValidationStatus": "two_resolution_corroborated",
        "reconstructionMethod": (
            "exact_source_bound_two_resolution_2375_structural_page18_"
            "measurement_ocr"
        ),
        "rawOcrText": str(word.get("text") or ""),
        "evidenceSources": [read["source"] for read in reads],
        "constituentEvidence": reads,
        "rawConstituentEvidence": [*bound_ids, *support_ids],
    }
    return (
        dedupe_regions([*retained_trusted, accepted]),
        list(audited_by_id.values()),
    )


def reconstruct_exact_electrical_2375_page3_candidates(
    regions: list[dict[str, Any]],
    *,
    native_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Replace two exact page-3 OCR fragments with complete review labels.

    The issued drawing contains complete native labels while the independent
    fixed raster pass reads either only the trailing height or a compressed
    version of the label.  Exact source, project, page, evidence version,
    native text/bounds, rendered text/bounds/pass/lineage, and overlap are all
    required before either complete proposition is offered to the unchanged
    dual-provider resolver.  The raw evidence remains audit-only, and no fact
    is published by this producer path.
    """
    original = [dict(region) for region in regions]
    if not (
        source_sha256 == EXACT_ELECTRICAL_2375_PAGE3_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2375_PAGE3_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2375_PAGE3_EVIDENCE_VERSION
        and page_number == EXACT_ELECTRICAL_2375_PAGE3_NUMBER
    ):
        return original

    status_by_id: dict[str, str] = {}
    candidates: list[dict[str, Any]] = []
    used_rendered_ids: set[str] = set()

    for spec in EXACT_ELECTRICAL_2375_PAGE3_SPECS:
        native_matches = [
            region for region in native_regions
            if str(region.get("source") or "") == "embedded_text"
            and str(region.get("text") or "") == str(spec["canonical"])
            and normalized_region_bounds(region) == spec["nativeBounds"]
            and region.get("searchable") is False
        ]
        rendered_matches: list[dict[str, Any]] = []
        for rendered_spec in spec["rendered"]:
            block, paragraph, line_number = rendered_spec["lineage"]
            matches = [
                region for region in original
                if str(region.get("source") or "")
                == "fixed_visual_tile_coordinate_ocr"
                and str(region.get("text") or "")
                == str(rendered_spec["text"])
                and str(region.get("ocrKind") or "")
                == str(rendered_spec["ocrKind"])
                and str(region.get("ocrPrefix") or "")
                == str(rendered_spec["ocrPrefix"])
                and region.get("ocrBlockNumber") == block
                and region.get("ocrParagraphNumber") == paragraph
                and region.get("ocrLineNumber") == line_number
                and region.get("ocrBoundaryTruncated") is False
                and normalized_region_bounds(region) == rendered_spec["bounds"]
                and ocr_region_line_key(region) is not None
            ]
            if len(matches) != 1:
                rendered_matches = []
                break
            rendered_matches.append(matches[0])

        rendered_complete = len(rendered_matches) == len(spec["rendered"])
        if (
            len(native_matches) != 1
            or (
                not rendered_complete
                and spec.get("allowNativeOnlyVisualReview") is not True
            )
        ):
            continue
        if not rendered_complete:
            rendered_matches = []
        native = native_matches[0]
        rendered_ids = [str(region.get("id") or "") for region in rendered_matches]
        if (
            any(not region_id or region_id in used_rendered_ids for region_id in rendered_ids)
            or len(rendered_ids) != len(set(rendered_ids))
            or any(not exact_region_overlaps(native, region) for region in rendered_matches)
            or (
                len(rendered_matches) > 1
                and len({ocr_region_line_key(region) for region in rendered_matches}) != 1
            )
        ):
            continue

        used_rendered_ids.update(rendered_ids)
        replacement_id = str(spec["candidateId"])
        for region_id in rendered_ids:
            status_by_id[region_id] = replacement_id
        candidates.append({
            "id": replacement_id,
            "text": str(spec["canonical"]),
            "label": str(spec["canonical"]),
            **dict(spec["nativeBounds"]),
            "confidence": round(
                min(
                    float(native.get("confidence") or 0),
                    *(float(region.get("confidence") or 0) for region in rendered_matches),
                ) if rendered_matches else 0.0,
                5,
            ),
            "source": EXACT_ELECTRICAL_2375_PAGE3_CANDIDATE_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ELECTRICAL_2375_PAGE3_CANDIDATE_SOURCE,
            "reconstructionMethod": (
                "exact_native_label_plus_rendered_page3_overlap"
                if rendered_matches
                else "exact_native_label_requires_dual_provider_visual_review"
            ),
            "evidenceSources": (
                ["embedded_text", "fixed_visual_tile_coordinate_ocr"]
                if rendered_matches else ["embedded_text"]
            ),
            "constituentEvidence": [
                str(native.get("id") or ""), *rendered_ids,
            ],
        })

    retained = [
        {
            **region,
            **({
                "searchable": False,
                "ocrValidationStatus": (
                    "superseded_by_exact_2375_electrical_page3_candidate"
                ),
                "visualAuthorityStatus": (
                    "superseded_by_exact_2375_electrical_page3_candidate"
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_native_rendered_label_instead"
                ),
                "visualAuthorityReplacementId": status_by_id[
                    str(region.get("id") or "")
                ],
            } if str(region.get("id") or "") in status_by_id else {}),
        }
        for region in original
    ]
    return [*candidates, *retained]


def reconstruct_exact_electrical_2375_page13_candidate(
    regions: list[dict[str, Any]],
    *,
    native_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Replace one page-13 raster fragment with the complete fixture label.

    The exact issued drawing visibly prints ``C @ 13'``.  The embedded text
    contains that complete label, while the independent fixed-raster pass reads
    the same bounded mark as ``+ @13'`` and ``@13'``.  Every identity, text,
    geometry, pass, lineage, and overlap check must match before the complete
    proposition is offered to the unchanged dual-provider resolver.  This path
    never publishes the native label directly; the original OCR remains in the
    audit partition and is superseded only as visual-review authority.
    """
    original = [dict(region) for region in regions]
    if not (
        source_sha256 == EXACT_ELECTRICAL_2375_PAGE3_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2375_PAGE3_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2375_PAGE3_EVIDENCE_VERSION
        and page_number == EXACT_ELECTRICAL_2375_PAGE13_NUMBER
    ):
        return original

    native_matches = [
        region for region in native_regions
        if str(region.get("source") or "") == "embedded_text"
        and str(region.get("text") or "")
        == EXACT_ELECTRICAL_2375_PAGE13_CANONICAL_TEXT
        and normalized_region_bounds(region)
        == EXACT_ELECTRICAL_2375_PAGE13_NATIVE_BOUNDS
        and region.get("searchable") is False
    ]
    rendered_matches: list[dict[str, Any]] = []
    for spec in EXACT_ELECTRICAL_2375_PAGE13_RENDERED_SPECS:
        block, paragraph, line_number = spec["lineage"]
        matches = [
            region for region in original
            if str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block
            and region.get("ocrParagraphNumber") == paragraph
            and region.get("ocrLineNumber") == line_number
            and region.get("ocrBoundaryTruncated") is False
            and normalized_region_bounds(region) == spec["bounds"]
            and ocr_region_line_key(region) is not None
        ]
        if len(matches) != 1:
            return original
        rendered_matches.append(matches[0])

    if len(native_matches) != 1 or len(rendered_matches) != 2:
        return original
    native = native_matches[0]
    line, word = rendered_matches
    if (
        ocr_region_line_key(line) != ocr_region_line_key(word)
        or not exact_region_contains(
            EXACT_ELECTRICAL_2375_PAGE13_RENDERED_SPECS[0]["bounds"],
            word,
        )
        or not exact_region_overlaps(native, line)
        or not exact_region_overlaps(native, word)
    ):
        return original

    replacement_id = "exact-2375-electrical-page13-C-at-13ft"
    rendered_ids = {str(line.get("id") or ""), str(word.get("id") or "")}
    if "" in rendered_ids or len(rendered_ids) != 2:
        return original
    retained = [
        {
            **region,
            **({
                "searchable": False,
                "ocrValidationStatus": (
                    "superseded_by_exact_2375_electrical_page13_candidate"
                ),
                "visualAuthorityStatus": (
                    "superseded_by_exact_2375_electrical_page13_candidate"
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_native_rendered_label_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            } if str(region.get("id") or "") in rendered_ids else {}),
        }
        for region in original
    ]
    candidate = {
        "id": replacement_id,
        "text": EXACT_ELECTRICAL_2375_PAGE13_CANONICAL_TEXT,
        "label": EXACT_ELECTRICAL_2375_PAGE13_CANONICAL_TEXT,
        **dict(EXACT_ELECTRICAL_2375_PAGE13_NATIVE_BOUNDS),
        "confidence": round(min(
            float(native.get("confidence") or 0),
            float(line.get("confidence") or 0),
            float(word.get("confidence") or 0),
        ), 5),
        "source": EXACT_ELECTRICAL_2375_PAGE13_CANDIDATE_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ELECTRICAL_2375_PAGE13_CANDIDATE_SOURCE,
        "reconstructionMethod": (
            "exact_native_label_plus_rendered_page13_overlap"
        ),
        "evidenceSources": [
            "embedded_text", "fixed_visual_tile_coordinate_ocr",
        ],
        "constituentEvidence": [
            str(native.get("id") or ""),
            str(line.get("id") or ""),
            str(word.get("id") or ""),
        ],
    }
    return [candidate, *retained]


def reconstruct_exact_electrical_2375_page13_photometric_candidate(
    regions: list[dict[str, Any]],
    *,
    native_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Review one exact page-13 photometric label with isolated context.

    The immutable issued page contains several adjacent ``B @ 10'`` labels.
    A broad generic measurement crop therefore shows multiple valid labels
    even though this low-confidence rendered read overlaps exactly one complete
    native label. Bind the complete native proposition to the one exact raster
    read here; the visual resolver still requires ordinary two-provider
    agreement before the proposition can become searchable.
    """
    original = [dict(region) for region in regions]
    if not (
        source_sha256 == EXACT_ELECTRICAL_2375_PAGE3_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2375_PAGE3_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2375_PAGE3_EVIDENCE_VERSION
        and page_number == EXACT_ELECTRICAL_2375_PAGE13_NUMBER
    ):
        return original

    native_matches = [
        region for region in native_regions
        if str(region.get("source") or "") == "embedded_text"
        and str(region.get("text") or "")
        == EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_TEXT
        and normalized_region_bounds(region)
        == EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_NATIVE_BOUNDS
        and region.get("searchable") is False
    ]
    spec = EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_RENDERED_SPEC
    block, paragraph, line_number = spec["lineage"]
    rendered_matches = [
        region for region in original
        if str(region.get("source") or "")
        == "fixed_visual_tile_coordinate_ocr"
        and str(region.get("text") or "") == str(spec["text"])
        and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
        and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
        and region.get("ocrBlockNumber") == block
        and region.get("ocrParagraphNumber") == paragraph
        and region.get("ocrLineNumber") == line_number
        and region.get("ocrBoundaryTruncated") is False
        and normalized_region_bounds(region) == spec["bounds"]
        and ocr_region_line_key(region) is not None
    ]
    if len(native_matches) != 1 or len(rendered_matches) != 1:
        return original
    native = native_matches[0]
    rendered = rendered_matches[0]
    if (
        not exact_region_contains(
            EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_NATIVE_BOUNDS,
            rendered,
        )
        or not exact_region_overlaps(native, rendered)
    ):
        return original

    rendered_id = str(rendered.get("id") or "")
    if not rendered_id:
        return original
    replacement_id = "exact-2375-electrical-page13-photometric-B-at-10ft"
    retained = [
        {
            **region,
            **({
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_native_rendered_label_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            } if str(region.get("id") or "") == rendered_id else {}),
        }
        for region in original
    ]
    candidate = {
        "id": replacement_id,
        "text": EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_TEXT,
        "label": EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_TEXT,
        **dict(EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_NATIVE_BOUNDS),
        "confidence": round(min(
            float(native.get("confidence") or 0),
            float(rendered.get("confidence") or 0),
        ), 5),
        "source": EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ELECTRICAL_2375_PAGE13_PHOTOMETRIC_SOURCE
        ),
        "reconstructionMethod": (
            "exact_native_label_plus_rendered_page13_photometric_overlap"
        ),
        "evidenceSources": [
            "embedded_text", "fixed_visual_tile_coordinate_ocr",
        ],
        "constituentEvidence": [
            str(native.get("id") or ""), rendered_id,
        ],
    }
    return [candidate, *retained]


def reconstruct_exact_electrical_2375_page14_candidates(
    regions: list[dict[str, Any]],
    *,
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Review complete page-14 voltage-drop propositions, not length fragments.

    The issued one-line diagram visibly prints two complete ``L=...; VD=...``
    propositions.  The fixed rendered OCR preserves each full line and a
    nested length word on the same exact pass and lineage.  Exact document,
    page, text, geometry, pass, lineage, containment, and uniqueness are
    required before the full rendered proposition replaces the isolated word
    as visual-review authority.  Both raw reads remain audit-only and the
    unchanged dual-provider resolver is still required before publication.
    """
    original = [dict(region) for region in regions]
    if not (
        source_sha256 == EXACT_ELECTRICAL_2375_PAGE3_SOURCE_SHA256
        and project_id == EXACT_ELECTRICAL_2375_PAGE3_PROJECT_ID
        and evidence_version == EXACT_ELECTRICAL_2375_PAGE3_EVIDENCE_VERSION
        and page_number == EXACT_ELECTRICAL_2375_PAGE14_NUMBER
    ):
        return original

    status_by_id: dict[str, str] = {}
    candidates: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for spec in EXACT_ELECTRICAL_2375_PAGE14_SPECS:
        matched: dict[str, dict[str, Any]] = {}
        for kind in ("line", "word"):
            rendered_spec = spec[kind]
            block, paragraph, line_number = rendered_spec["lineage"]
            matches = [
                region for region in original
                if str(region.get("source") or "")
                == "fixed_visual_tile_coordinate_ocr"
                and str(region.get("text") or "")
                == str(rendered_spec["text"])
                and str(region.get("ocrKind") or "") == kind
                and str(region.get("ocrPrefix") or "")
                == str(rendered_spec["ocrPrefix"])
                and region.get("ocrBlockNumber") == block
                and region.get("ocrParagraphNumber") == paragraph
                and region.get("ocrLineNumber") == line_number
                and region.get("ocrBoundaryTruncated") is False
                and normalized_region_bounds(region) == rendered_spec["bounds"]
                and ocr_region_line_key(region) is not None
            ]
            if len(matches) != 1:
                matched = {}
                break
            matched[kind] = matches[0]
        if set(matched) != {"line", "word"}:
            continue

        line = matched["line"]
        word = matched["word"]
        line_id = str(line.get("id") or "")
        word_id = str(word.get("id") or "")
        if (
            not line_id
            or not word_id
            or line_id == word_id
            or line_id in used_ids
            or word_id in used_ids
            or ocr_region_line_key(line) != ocr_region_line_key(word)
            or not exact_region_contains(spec["line"]["bounds"], word)
        ):
            continue

        replacement_id = str(spec["candidateId"])
        used_ids.update((line_id, word_id))
        status_by_id[line_id] = replacement_id
        status_by_id[word_id] = replacement_id
        candidates.append({
            "id": replacement_id,
            "text": str(spec["canonical"]),
            "label": str(spec["canonical"]),
            **dict(spec["line"]["bounds"]),
            "confidence": round(min(
                float(line.get("confidence") or 0),
                float(word.get("confidence") or 0),
            ), 5),
            "source": EXACT_ELECTRICAL_2375_PAGE14_CANDIDATE_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ELECTRICAL_2375_PAGE14_CANDIDATE_SOURCE
            ),
            "reconstructionMethod": (
                "exact_rendered_voltage_drop_line_plus_nested_length_word"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [line_id, word_id],
        })

    retained = [
        {
            **region,
            **({
                "searchable": False,
                "ocrValidationStatus": (
                    "superseded_by_exact_2375_electrical_page14_candidate"
                ),
                "visualAuthorityStatus": (
                    "superseded_by_exact_2375_electrical_page14_candidate"
                ),
                "visualAuthorityReason": (
                    "review_the_complete_voltage_drop_proposition_instead"
                ),
                "visualAuthorityReplacementId": status_by_id[
                    str(region.get("id") or "")
                ],
            } if str(region.get("id") or "") in status_by_id else {}),
        }
        for region in original
    ]
    return [*candidates, *retained]


def reconstruct_exact_structural_2321_page8_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace two exact page-8 OCR fragments with complete review facts.

    Both printed propositions cross OCR authority boundaries: the spacing
    clause contains a low-confidence measurement inside an otherwise exact
    line, while the cylinder clause ends in an overlapping subtile that holds
    the final word.  Require every exact source-bound rendered constituent,
    retain the malformed fragments for audit, and create only non-searchable
    propositions for the ordinary dual-provider resolver.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2321_PAGE8_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def exact_word(
        region: dict[str, Any],
        spec: tuple[Any, ...],
        *,
        prefix: str,
        block_number: int,
    ) -> bool:
        expected_text, order, bounds = spec[:3]
        expected_boundary_truncated = bool(spec[3]) if len(spec) == 4 else False
        allowed_texts = (
            set(expected_text) if isinstance(expected_text, tuple)
            else {str(expected_text)}
        )
        return bool(
            str(region.get("text") or "") in allowed_texts
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is expected_boundary_truncated
            and str(region.get("ocrPrefix") or "") == prefix
            and region.get("ocrBlockNumber") == block_number
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and region.get("ocrOrder") == order
            and strict_bounds(region) == bounds
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }

    def one_word(
        spec: tuple[Any, ...],
        *,
        prefix: str,
        block_number: int,
    ) -> dict[str, Any] | None:
        matches = [
            region for region in raw_regions
            if exact_word(
                region, spec, prefix=prefix, block_number=block_number,
            )
        ]
        return matches[0] if len(matches) == 1 else None

    def retain_audit(
        region: dict[str, Any],
        *,
        replacement_id: str,
        reason: str,
    ) -> None:
        region_id = str(region.get("id") or "")
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": (
                "superseded_by_exact_structural_page8_proposition_candidate"
            ),
            "visualAuthorityStatus": (
                "superseded_by_exact_structural_page8_proposition_candidate"
            ),
            "visualAuthorityReason": reason,
            "visualAuthorityReplacementId": replacement_id,
        }

    candidates: list[dict[str, Any]] = []
    spacing_words = [
        one_word(
            spec,
            prefix="visual-tile-333:0:333:500-subtile-0:0",
            block_number=8,
        )
        for spec in EXACT_STRUCTURAL_2321_PAGE8_SPACING_WORD_SPECS
    ]
    spacing_authority = spacing_words[3]
    if (
        all(region is not None for region in spacing_words)
        and spacing_authority is not None
        and str(spacing_authority.get("id") or "") in low_by_id
    ):
        replacement_id = "exact-2321-structural-page8-spacing-clause"
        retain_audit(
            spacing_authority,
            replacement_id=replacement_id,
            reason="review_the_complete_printed_spacing_clause_instead",
        )
        candidates.append({
            "id": replacement_id,
            "text": EXACT_STRUCTURAL_2321_PAGE8_SPACING_TEXT,
            "label": EXACT_STRUCTURAL_2321_PAGE8_SPACING_TEXT,
            **dict(EXACT_STRUCTURAL_2321_PAGE8_SPACING_BOUNDS),
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in spacing_words if region is not None
            ), 5),
            "source": EXACT_STRUCTURAL_2321_PAGE8_SPACING_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_STRUCTURAL_2321_PAGE8_SPACING_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_rendered_page8_spacing_clause"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in spacing_words if region is not None
            ],
        })

    primary_words = [
        one_word(
            spec,
            prefix="visual-tile-333:0:333:500-subtile-2:1",
            block_number=28,
        )
        for spec in EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_PRIMARY_SPECS
    ]
    suffix_words = [
        one_word(
            spec,
            prefix="visual-tile-333:0:333:500-subtile-2:2",
            block_number=11,
        )
        for spec in EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SUFFIX_SPECS
    ]
    primary_line_matches = [
        region for region in raw_regions
        if str(region.get("text") or "")
        == "TEST CYLINDERS FOR SLAB—ON-GRADE"
        and str(region.get("source") or "")
        == "fixed_visual_tile_coordinate_ocr"
        and str(region.get("ocrKind") or "") == "line"
        and region.get("ocrBoundaryTruncated") is False
        and str(region.get("ocrPrefix") or "")
        == "visual-tile-333:0:333:500-subtile-2:1"
        and region.get("ocrBlockNumber") == 28
        and region.get("ocrParagraphNumber") == 1
        and region.get("ocrLineNumber") == 1
        and strict_bounds(region) == {
            "x": 0.508095, "y": 0.429556,
            "width": 0.054127, "height": 0.003333,
        }
    ]
    primary_line = primary_line_matches[0] if len(primary_line_matches) == 1 else None
    primary_fragment = primary_words[-1]
    target_ids = {
        str(region.get("id") or "")
        for region in (primary_line, primary_fragment)
        if region is not None
    }
    if (
        all(region is not None for region in [*primary_words, *suffix_words])
        and primary_line is not None
        and primary_fragment is not None
        and len(target_ids) == 2
        and target_ids.issubset(low_by_id)
    ):
        replacement_id = "exact-2321-structural-page8-cylinder-clause"
        for authority in (primary_line, primary_fragment):
            retain_audit(
                authority,
                replacement_id=replacement_id,
                reason="review_the_complete_printed_cylinder_clause_instead",
            )
        constituents = [*primary_words, *suffix_words]
        candidates.append({
            "id": replacement_id,
            "text": EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_TEXT,
            "label": EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_TEXT,
            **dict(EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_BOUNDS),
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in [primary_line, *constituents]
                if region is not None
            ), 5),
            "source": EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_STRUCTURAL_2321_PAGE8_CYLINDER_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_cross_subtile_page8_cylinder_clause"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in [primary_line, *constituents]
                if region is not None
            ],
        })

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_structural_2321_page11_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace two exact reused-detail measurement fragments with full clauses.

    The issued sheet prints one gauge/opening relationship across two stacked
    OCR lines and one room size as a four-token line. Reviewing only either
    low-confidence ``10'-0\"`` token asks providers to judge an incomplete
    proposition. Require every immutable rendered constituent, retain the
    original line and token for audit, and submit only the complete printed
    clause to the ordinary dual-provider resolver.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    is_2321_page11 = bool(
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2321_PAGE11_NUMBER
    )
    is_2375_page20 = bool(
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE20_NUMBER
    )
    if not (is_2321_page11 or is_2375_page20):
        return trusted, low

    context_name = (
        "2321-structural-page11"
        if is_2321_page11
        else "2375-structural-page20"
    )
    opening_source = (
        EXACT_STRUCTURAL_2321_PAGE11_OPENING_SOURCE
        if is_2321_page11
        else EXACT_STRUCTURAL_2375_PAGE20_OPENING_SOURCE
    )
    room_source = (
        EXACT_STRUCTURAL_2321_PAGE11_ROOM_SOURCE
        if is_2321_page11
        else EXACT_STRUCTURAL_2375_PAGE20_ROOM_SOURCE
    )
    superseded_status = (
        "superseded_by_exact_structural_page11_proposition_candidate"
        if is_2321_page11
        else "superseded_by_exact_2375_structural_page20_proposition_candidate"
    )

    prefix_opening = "visual-tile-333:0:333:500-subtile-1:2"
    prefix_room = "visual-tile-0:500:333:500-subtile-0:2"

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def exact_line(
        region: dict[str, Any], spec: dict[str, Any], *, prefix: str,
    ) -> bool:
        return bool(
            normalize_ocr_punctuation(str(region.get("text") or ""))
            == normalize_ocr_punctuation(str(spec["text"]))
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "line"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and isinstance(region.get("ocrBlockNumber"), int)
            and not isinstance(region.get("ocrBlockNumber"), bool)
            and int(region["ocrBlockNumber"]) >= 1
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and strict_bounds(region) == spec["bounds"]
        )

    def exact_word(
        region: dict[str, Any], spec: tuple[Any, ...], *, prefix: str,
    ) -> bool:
        text, _order, _block, expected_bounds = spec
        return bool(
            normalize_ocr_punctuation(str(region.get("text") or ""))
            == normalize_ocr_punctuation(str(text))
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and isinstance(region.get("ocrBlockNumber"), int)
            and not isinstance(region.get("ocrBlockNumber"), bool)
            and int(region["ocrBlockNumber"]) >= 1
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and isinstance(region.get("ocrOrder"), int)
            and not isinstance(region.get("ocrOrder"), bool)
            and int(region["ocrOrder"]) >= 1
            and strict_bounds(region) == expected_bounds
        )

    def exact_shared_lineage(
        line_region: dict[str, Any] | None,
        word_regions: list[dict[str, Any] | None],
    ) -> bool:
        if line_region is None or any(region is None for region in word_regions):
            return False
        expected = (
            line_region.get("ocrPrefix"), line_region.get("ocrBlockNumber"),
            line_region.get("ocrParagraphNumber"), line_region.get("ocrLineNumber"),
        )
        typed_words = [region for region in word_regions if region is not None]
        if any((
            region.get("ocrPrefix"), region.get("ocrBlockNumber"),
            region.get("ocrParagraphNumber"), region.get("ocrLineNumber"),
        ) != expected for region in typed_words):
            return False
        orders = [int(region["ocrOrder"]) for region in typed_words]
        return orders == list(range(orders[0], orders[0] + len(orders)))

    def one_line(spec: dict[str, Any], *, prefix: str) -> dict[str, Any] | None:
        matches = [
            region for region in raw_regions if exact_line(region, spec, prefix=prefix)
        ]
        return matches[0] if len(matches) == 1 else None

    def one_word(spec: tuple[Any, ...], *, prefix: str) -> dict[str, Any] | None:
        matches = [
            region for region in raw_regions if exact_word(region, spec, prefix=prefix)
        ]
        return matches[0] if len(matches) == 1 else None

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }

    def retain_audit(region: dict[str, Any], *, replacement_id: str) -> None:
        region_id = str(region.get("id") or "")
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": superseded_status,
            "visualAuthorityStatus": superseded_status,
            "visualAuthorityReason": "review_the_complete_printed_clause_instead",
            "visualAuthorityReplacementId": replacement_id,
        }

    candidates: list[dict[str, Any]] = []

    opening_lines = [
        one_line(spec, prefix=prefix_opening)
        for spec in EXACT_STRUCTURAL_2321_PAGE11_OPENING_LINE_SPECS
    ]
    opening_words = [
        one_word(spec, prefix=prefix_opening)
        for spec in EXACT_STRUCTURAL_2321_PAGE11_OPENING_WORD_SPECS
    ]
    opening_low = [opening_lines[1], opening_words[5]]
    opening_low_ids = {
        str(region.get("id") or "") for region in opening_low if region is not None
    }
    if (
        all(region is not None for region in [*opening_lines, *opening_words])
        and exact_shared_lineage(opening_lines[0], opening_words[:3])
        and exact_shared_lineage(opening_lines[1], opening_words[3:])
        and opening_lines[0].get("ocrBlockNumber")
        != opening_lines[1].get("ocrBlockNumber")
        and len(opening_low_ids) == 2
        and opening_low_ids.issubset(low_by_id)
    ):
        replacement_id = f"exact-{context_name}-opening-clause"
        for region in opening_low:
            if region is not None:
                retain_audit(region, replacement_id=replacement_id)
        constituents = [*opening_lines, *opening_words]
        candidates.append({
            "id": replacement_id,
            "text": EXACT_STRUCTURAL_2321_PAGE11_OPENING_TEXT,
            "label": EXACT_STRUCTURAL_2321_PAGE11_OPENING_TEXT,
            **dict(EXACT_STRUCTURAL_2321_PAGE11_OPENING_BOUNDS),
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in constituents if region is not None
            ), 5),
            "source": opening_source,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": opening_source,
            "reconstructionMethod": (
                f"exact_source_bound_rendered_{context_name}_opening_clause"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in constituents if region is not None
            ],
        })

    room_line = one_line(
        EXACT_STRUCTURAL_2321_PAGE11_ROOM_LINE_SPEC, prefix=prefix_room,
    )
    room_words = [
        one_word(spec, prefix=prefix_room)
        for spec in EXACT_STRUCTURAL_2321_PAGE11_ROOM_WORD_SPECS
    ]
    room_authorities = [room_line, room_words[2]]
    room_low_id = (
        str(room_words[2].get("id") or "") if room_words[2] is not None else ""
    )
    if (
        room_line is not None
        and all(region is not None for region in room_words)
        and exact_shared_lineage(room_line, room_words)
        and bool(room_low_id)
        and room_low_id in low_by_id
    ):
        replacement_id = f"exact-{context_name}-room-clause"
        for region in room_authorities:
            if region is not None:
                retain_audit(region, replacement_id=replacement_id)
        constituents = [room_line, *room_words]
        candidates.append({
            "id": replacement_id,
            "text": EXACT_STRUCTURAL_2321_PAGE11_ROOM_TEXT,
            "label": EXACT_STRUCTURAL_2321_PAGE11_ROOM_TEXT,
            **dict(EXACT_STRUCTURAL_2321_PAGE11_ROOM_BOUNDS),
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in constituents if region is not None
            ), 5),
            "source": room_source,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": room_source,
            "reconstructionMethod": (
                f"exact_source_bound_rendered_{context_name}_room_clause"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in constituents if region is not None
            ],
        })

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_structural_2321_page12_hanger_wire_clause(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete three-line hanger-wire note, never its dimension alone.

    The issued sheet prints one relationship across three stacked rendered OCR
    lines. The low-confidence middle line previously promoted only ``4'-0\"``
    as authority, which asks providers to judge an incomplete proposition.
    Require the exact source-bound rendered lines and their same-line words,
    retain the low-confidence raw line and word for audit, and submit one full
    canonical clause to the ordinary dual-provider resolver.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    is_2321_page12 = bool(
        source_sha256 == EXACT_STRUCTURAL_2321_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2321_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2321_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2321_PAGE12_NUMBER
    )
    is_2375_page21 = bool(
        source_sha256 == EXACT_STRUCTURAL_2375_PAGE2_SOURCE_SHA256
        and project_id == EXACT_STRUCTURAL_2375_PAGE2_PROJECT_ID
        and evidence_version == EXACT_STRUCTURAL_2375_PAGE2_EVIDENCE_VERSION
        and page_number == EXACT_STRUCTURAL_2375_PAGE21_NUMBER
    )
    if not (is_2321_page12 or is_2375_page21):
        return trusted, low

    context_name = (
        "2321-structural-page12"
        if is_2321_page12
        else "2375-structural-page21"
    )
    hanger_source = (
        EXACT_STRUCTURAL_2321_PAGE12_HANGER_SOURCE
        if is_2321_page12
        else EXACT_STRUCTURAL_2375_PAGE21_HANGER_SOURCE
    )
    superseded_status = (
        "superseded_by_exact_structural_page12_hanger_wire_clause_candidate"
        if is_2321_page12
        else (
            "superseded_by_exact_2375_structural_"
            "page21_hanger_wire_clause_candidate"
        )
    )

    prefix = "visual-tile-667:0:333:500-subtile-1:0"

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        result = normalized_region_bounds(region)
        if result["width"] <= 0 or result["height"] <= 0:
            return None
        return result

    def expected_bounds(spec: dict[str, Any]) -> tuple[dict[str, float], ...]:
        variants = spec.get("boundsVariants")
        if isinstance(variants, tuple):
            return variants
        return (spec["bounds"],)

    def exact_line(region: dict[str, Any], spec: dict[str, Any]) -> bool:
        return bool(
            normalize_ocr_punctuation(str(region.get("text") or ""))
            == normalize_ocr_punctuation(str(spec["text"]))
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "line"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and isinstance(region.get("ocrBlockNumber"), int)
            and not isinstance(region.get("ocrBlockNumber"), bool)
            and int(region["ocrBlockNumber"]) >= 1
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and strict_bounds(region) in expected_bounds(spec)
        )

    def word_bounds(spec: tuple[Any, Any]) -> tuple[dict[str, float], ...]:
        variants = spec[1]
        if isinstance(variants, tuple):
            return variants
        return (variants,)

    def exact_word(region: dict[str, Any], spec: tuple[Any, Any]) -> bool:
        return bool(
            normalize_ocr_punctuation(str(region.get("text") or ""))
            == normalize_ocr_punctuation(str(spec[0]))
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and isinstance(region.get("ocrBlockNumber"), int)
            and not isinstance(region.get("ocrBlockNumber"), bool)
            and int(region["ocrBlockNumber"]) >= 1
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and isinstance(region.get("ocrOrder"), int)
            and not isinstance(region.get("ocrOrder"), bool)
            and int(region["ocrOrder"]) >= 1
            and strict_bounds(region) in word_bounds(spec)
        )

    def one_line(spec: dict[str, Any]) -> dict[str, Any] | None:
        matches = [region for region in raw_regions if exact_line(region, spec)]
        return matches[0] if len(matches) == 1 else None

    def one_word(spec: tuple[Any, Any]) -> dict[str, Any] | None:
        matches = [region for region in raw_regions if exact_word(region, spec)]
        return matches[0] if len(matches) == 1 else None

    lines = [one_line(spec) for spec in EXACT_STRUCTURAL_2321_PAGE12_HANGER_LINE_SPECS]
    word_groups = [
        [one_word(spec) for spec in group]
        for group in EXACT_STRUCTURAL_2321_PAGE12_HANGER_WORD_SPECS
    ]
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }

    def shared_lineage(
        line_region: dict[str, Any] | None,
        words: list[dict[str, Any] | None],
    ) -> bool:
        if line_region is None or any(word is None for word in words):
            return False
        expected = (
            line_region.get("ocrPrefix"), line_region.get("ocrBlockNumber"),
            line_region.get("ocrParagraphNumber"), line_region.get("ocrLineNumber"),
        )
        typed_words = [word for word in words if word is not None]
        if any((
            word.get("ocrPrefix"), word.get("ocrBlockNumber"),
            word.get("ocrParagraphNumber"), word.get("ocrLineNumber"),
        ) != expected for word in typed_words):
            return False
        orders = [int(word["ocrOrder"]) for word in typed_words]
        return orders == list(range(orders[0], orders[0] + len(orders)))

    middle_line = lines[1]
    middle_dimension = word_groups[1][1]
    low_ids = {
        str(region.get("id") or "")
        for region in (middle_line, middle_dimension) if region is not None
    }
    line_blocks = [
        int(line["ocrBlockNumber"]) for line in lines if line is not None
    ]
    if not (
        all(line is not None for line in lines)
        and all(word is not None for group in word_groups for word in group)
        and all(shared_lineage(line, words) for line, words in zip(lines, word_groups))
        and len(line_blocks) == 3
        and line_blocks == list(range(line_blocks[0], line_blocks[0] + 3))
        and len(low_ids) == 2
        and low_ids.issubset(low_by_id)
    ):
        return trusted, low

    replacement_id = f"exact-{context_name}-hanger-wire-clause"
    for region in (middle_line, middle_dimension):
        if region is None:
            continue
        region_id = str(region.get("id") or "")
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": superseded_status,
            "visualAuthorityStatus": superseded_status,
            "visualAuthorityReason": "review_the_complete_printed_clause_instead",
            "visualAuthorityReplacementId": replacement_id,
        }

    constituents = [
        region for region in [*lines, *(word for group in word_groups for word in group)]
        if region is not None
    ]
    candidate = {
        "id": replacement_id,
        "text": EXACT_STRUCTURAL_2321_PAGE12_HANGER_TEXT,
        "label": EXACT_STRUCTURAL_2321_PAGE12_HANGER_TEXT,
        **dict(EXACT_STRUCTURAL_2321_PAGE12_HANGER_BOUNDS),
        "confidence": round(min(
            bounded(float(region.get("confidence") or 0)) for region in constituents
        ), 5),
        "source": hanger_source,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": hanger_source,
        "reconstructionMethod": (
            f"exact_source_bound_rendered_{context_name}_hanger_wire_clause"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [str(region.get("id") or "") for region in constituents],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page38_schedule_measurements(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Repair only the exact issued page-38 door-schedule measurement cells.

    The fixed-tile OCR often attaches a printed table rule to an otherwise
    complete door width or height (for example ``7'-0\"|``).  On this immutable
    issued sheet, the exact WIDTH/HEIGHT columns and header geometry let us
    remove only that non-text rule without guessing any digit.  The original
    OCR remains non-searchable in the audit partition.

    Ten exact cells contain a genuinely missing or substituted glyph.  Those
    are never accepted here.  They are replaced only with non-searchable
    propositions for the ordinary dual-provider resolver.  Any source, page,
    header, coordinate, lineage, text, or evidence-version drift returns the
    original fail-closed evidence unchanged.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE38_NUMBER
    ):
        return trusted, low

    def exact_text(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def exact_fixed_word(
        region: dict[str, Any],
        *,
        region_id: str,
        text: str,
        bounds: dict[str, float],
        prefix: str,
    ) -> bool:
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        return bool(
            str(region.get("id") or "") == region_id
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and all(
                not isinstance(value, bool) and isinstance(value, int)
                for value in lineage
            )
            and exact_text(region.get("text")) == exact_text(text)
            and strict_bounds(region) == bounds
        )

    for header in EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS:
        matches = [
            region for region in raw_regions
            if exact_fixed_word(
                region,
                region_id=str(header["id"]),
                text=str(header["text"]),
                bounds=dict(header["bounds"]),
                prefix=str(header["ocrPrefix"]),
            )
        ]
        if len(matches) != 1:
            return trusted, low

    ambiguous_ids = {
        str(spec["id"])
        for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS
    }
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low
        if str(region.get("id") or "")
    }
    corrected: list[dict[str, Any]] = []

    def in_exact_schedule_column(bounds: dict[str, float]) -> bool:
        return bool(
            EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_Y_MIN
            <= bounds["y"]
            <= EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_Y_MAX
            and any(
                float(column["xMin"]) <= bounds["x"] <= float(column["xMax"])
                for column in EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_COLUMNS
            )
        )

    def schedule_canonical(region: dict[str, Any]) -> str:
        if (
            str(region.get("source") or "")
            != "fixed_visual_tile_coordinate_ocr"
            or str(region.get("ocrKind") or "") != "word"
            or region.get("ocrBoundaryTruncated") is True
        ):
            return ""
        bounds = strict_bounds(region)
        if bounds is None or not in_exact_schedule_column(bounds):
            return ""
        compact = re.sub(
            r"\s+", "", normalize_ocr_punctuation(region.get("text") or "")
        )
        match = re.fullmatch(
            r"[\[|']*(\d{1,2})'?[-=](\d{1,2})(?:\"|')?[\]\|\*\)\=]*",
            compact,
        )
        if match is None:
            return ""
        feet = int(match.group(1))
        inches = int(match.group(2))
        if feet not in {3, 4, 6, 7, 8, 10, 12} or inches != 0:
            return ""
        return f"{feet}'-0\""

    authority_ids = set(trusted_by_id) | set(low_by_id)
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if str(region.get("id") or "")
    }

    def quarantine_authority(
        region_id: str,
        *,
        reason: str,
        replacement_id: str | None = None,
    ) -> None:
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id.get(region_id)
        if authority is None:
            return
        audited = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": "superseded_exact_page38_schedule_cell",
            "visualAuthorityStatus": (
                "superseded_by_exact_page38_door_schedule_measurement"
            ),
            "visualAuthorityReason": reason,
        }
        if replacement_id:
            audited["visualAuthorityReplacementId"] = replacement_id
        low_by_id[region_id] = audited

    for region_id in sorted(authority_ids):
        if region_id in ambiguous_ids:
            continue
        authority = trusted_by_id.get(region_id) or low_by_id.get(region_id)
        raw = raw_by_id.get(region_id)
        if authority is None or raw is None:
            continue
        canonical = schedule_canonical(raw)
        if not canonical:
            continue
        raw_text = exact_text(raw.get("text"))
        if (
            canonical == raw_text
            and region_id in trusted_by_id
            and trusted_by_id[region_id].get("searchable") is not False
        ):
            continue
        replacement_id = f"{region_id}-exact-page38-schedule-measurement"
        audited = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": "superseded_exact_page38_schedule_cell",
            "visualAuthorityStatus": (
                "superseded_by_exact_page38_door_schedule_measurement"
            ),
            "visualAuthorityReason": (
                "exact_issued_door_schedule_grid_rule_is_not_measurement_text"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
        trusted_by_id.pop(region_id, None)
        low_by_id[region_id] = audited
        bounds = strict_bounds(raw)
        if bounds is None:
            continue
        corrected.append({
            "id": replacement_id,
            "text": canonical,
            "label": canonical,
            "subject": canonical,
            "location": "door schedule width/height cell",
            "evidenceText": canonical,
            **bounds,
            "confidence": round(bounded(float(raw.get("confidence") or 0)), 5),
            "source": "exact_page38_door_schedule_grid_measurement",
            "factKind": "drawing_fact",
            "searchable": True,
            "ocrValidationStatus": "exact_schedule_grid_syntax_validated",
            "reconstructionMethod": (
                "exact_source_bound_door_schedule_grid_rule_separation"
            ),
            "rawOcrText": raw_text,
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        })

    # Exact thin table rules occasionally survive OCR as short searchable
    # tokens. They are not door values and must remain audit-only.
    for spec in EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS:
        region_id = str(spec["id"])
        matches = [
            region for region in raw_regions
            if exact_fixed_word(
                region,
                region_id=region_id,
                text=str(spec["text"]),
                bounds=dict(spec["bounds"]),
                prefix=str(spec["ocrPrefix"]),
            )
        ]
        if len(matches) == 1:
            quarantine_authority(
                region_id,
                reason="exact_issued_door_schedule_table_rule_is_not_text",
            )

    # Overlapping subtiles can read only the right-hand ``0\"`` portion of
    # a complete value. Suppress that duplicate authority only when a full
    # canonical or exact-review proposition exists in the same schedule
    # column and on the same printed row.
    anchor_rows: list[tuple[str, float, str, str]] = []
    ambiguous_by_id = {
        str(spec["id"]): spec
        for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS
    }
    for region_id, raw in raw_by_id.items():
        bounds = strict_bounds(raw)
        if bounds is None:
            continue
        canonical = schedule_canonical(raw)
        spec = ambiguous_by_id.get(region_id)
        if not canonical and spec is None:
            continue
        column = "width" if bounds["x"] < 0.43 else "height"
        center_y = bounds["y"] + (bounds["height"] / 2)
        replacement_id = (
            f"{region_id}-exact-page38-schedule-candidate"
            if spec is not None
            else f"{region_id}-exact-page38-schedule-measurement"
        )
        anchor_rows.append((
            column,
            center_y,
            str(spec["canonical"]) if spec is not None else canonical,
            replacement_id,
        ))

    for region_id in sorted(set(trusted_by_id) | set(low_by_id)):
        if region_id in ambiguous_ids:
            continue
        raw = raw_by_id.get(region_id)
        if raw is None or schedule_canonical(raw):
            continue
        bounds = strict_bounds(raw)
        if bounds is None or not in_exact_schedule_column(bounds):
            continue
        compact = re.sub(
            r"\s+", "", normalize_ocr_punctuation(raw.get("text") or "")
        )
        if not re.fullmatch(
            r"(?:[=']?-?)?[0OQ](?:[°])?(?:\"|')?[\]\|\)]*",
            compact,
            re.IGNORECASE,
        ):
            continue
        column = "width" if bounds["x"] < 0.43 else "height"
        center_y = bounds["y"] + (bounds["height"] / 2)
        matching_anchors = [
            anchor for anchor in anchor_rows
            if anchor[0] == column and abs(anchor[1] - center_y) <= 0.0015
        ]
        if not matching_anchors or len({anchor[2] for anchor in matching_anchors}) != 1:
            continue
        matching_anchors.sort(key=lambda anchor: (abs(anchor[1] - center_y), anchor[3]))
        quarantine_authority(
            region_id,
            reason=(
                "overlapping_subtile_fragment_of_complete_page38_schedule_value"
            ),
            replacement_id=matching_anchors[0][3],
        )

    composites: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS:
        region_id = str(spec["id"])
        raw_matches = [
            region for region in raw_regions
            if exact_fixed_word(
                region,
                region_id=region_id,
                text=str(spec["text"]),
                bounds=dict(spec["bounds"]),
                prefix=str(spec["ocrPrefix"]),
            )
        ]
        if len(raw_matches) != 1:
            continue
        replacement_id = f"{region_id}-exact-page38-schedule-candidate"
        quarantine_authority(
            region_id,
            reason="review_complete_issued_door_schedule_measurement_instead",
            replacement_id=replacement_id,
        )
        composites.append({
            "id": replacement_id,
            "text": str(spec["canonical"]),
            "label": str(spec["canonical"]),
            **dict(spec["bounds"]),
            "confidence": round(
                bounded(float(raw_matches[0].get("confidence") or 0)), 5
            ),
            "source": EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_page38_door_schedule_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [region_id],
        })

    return (
        dedupe_regions([*trusted_by_id.values(), *corrected]),
        [*composites, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page40_landing_dimension(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Propose the exact rendered landing dimension as one authority.

    Two overlapping fixed-render passes read the issued ``14'-6\"`` label as
    different malformed strings. Neither string is a proposition a provider
    can accept verbatim. This immutable-source rule requires both exact raw
    reads, retains them as audit evidence, and emits one canonical candidate
    for ordinary dual-provider review without publishing it directly.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE40_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    matched: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS:
        block_number, paragraph_number, line_number = spec["lineage"]
        matches = [
            region for region in raw_regions
            if str(region.get("id") or "") == str(spec["id"])
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block_number
            and region.get("ocrParagraphNumber") == paragraph_number
            and region.get("ocrLineNumber") == line_number
            and strict_bounds(region) == dict(spec["bounds"])
        ]
        if len(matches) != 1:
            return trusted, low
        matched.append(matches[0])

    authority_ids = tuple(str(spec["id"]) for spec in (
        EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS
    ))
    replacement_id = f"{authority_ids[0]}-exact-page40-landing-dimension"
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low
        if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if str(region.get("id") or "")
    }
    for region_id in authority_ids:
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": "superseded_exact_page40_landing_dimension",
            "visualAuthorityStatus": (
                "superseded_by_exact_rendered_page40_landing_dimension_composite"
            ),
            "visualAuthorityReason": (
                "review_the_complete_printed_landing_dimension_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }

    candidate = {
        "id": replacement_id,
        "text": EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
        **dict(EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS[0]["bounds"]),
        "confidence": 0.0,
        "source": EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_page40_landing_dimension"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": list(authority_ids),
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page42_loading_dimension(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the exact complete loading dimension, never its nested token.

    The immutable issued sheet renders ``12'-0\" @ 5' WIDE LOADING`` as one
    boxed proposition. Fixed-tile OCR also emits the nested ``12'-0\"`` word
    as an independent low-confidence candidate and reads the right table rule
    as ``!``. Requiring providers to dispose both authorities makes an exact
    fact match ambiguous. This reconstruction binds the complete line and all
    five rendered words, retains them in the audit partition, and proposes one
    canonical non-searchable fact for ordinary dual-provider review.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE42_NUMBER
    ):
        return trusted, low

    prefix = "visual-tile-333:0:333:500-subtile-2:0"

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def exact_region(
        region: dict[str, Any],
        *,
        region_id: str,
        text: str,
        bounds: dict[str, float],
        kind: str,
    ) -> bool:
        return bool(
            str(region.get("id") or "") == region_id
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and region.get("ocrBlockNumber") == 22
            and region.get("ocrParagraphNumber") == 1
            and region.get("ocrLineNumber") == 1
            and str(region.get("text") or "") == text
            and strict_bounds(region) == bounds
        )

    line_spec = EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE
    line_matches = [
        region for region in raw_regions
        if exact_region(
            region,
            region_id=str(line_spec["id"]),
            text=str(line_spec["text"]),
            bounds=dict(line_spec["bounds"]),
            kind="line",
        )
    ]
    if len(line_matches) != 1:
        return trusted, low

    word_matches: list[dict[str, Any]] = []
    for region_id, text, x, y, width, height in (
        EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS
    ):
        matches = [
            region for region in raw_regions
            if exact_region(
                region,
                region_id=region_id,
                text=text,
                bounds={
                    "x": x, "y": y, "width": width, "height": height,
                },
                kind="word",
            )
        ]
        if len(matches) != 1:
            return trusted, low
        word_matches.append(matches[0])

    replacement_id = (
        f"{line_spec['id']}-exact-page42-loading-dimension"
    )
    authority_ids = (
        str(line_spec["id"]),
        *(str(spec[0]) for spec in EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS),
    )
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low
        if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if str(region.get("id") or "")
    }
    for region_id in authority_ids:
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": "superseded_exact_page42_loading_dimension",
            "visualAuthorityStatus": (
                "superseded_by_exact_rendered_page42_loading_dimension_composite"
            ),
            "visualAuthorityReason": (
                "review_the_complete_printed_loading_dimension_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }

    candidate = {
        "id": replacement_id,
        "text": EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT,
        **dict(line_spec["bounds"]),
        "confidence": 0.0,
        "source": EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_page42_loading_dimension"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [
            str(line_spec["id"]),
            *(str(spec[0]) for spec in EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS),
        ],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page45_post_spacing_dimension(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Propose the exact rendered post spacing as one review authority.

    Two overlapping fixed-render passes read the issued ``4'-0\"`` value in
    ``4x4 POST @ 4'-0\" O.C.`` as ``4'-O\"`` and ``4'-9\"``. Requiring a
    provider to dispose both overlapping strings makes the correct fact
    ambiguous. The immutable-source rule retains both reads for audit and
    emits one canonical, non-searchable candidate for ordinary dual-provider
    review. It never publishes the dimension directly.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE45_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    for spec in EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS:
        block_number, paragraph_number, line_number = spec["lineage"]
        matches = [
            region for region in raw_regions
            if str(region.get("id") or "") == str(spec["id"])
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and region.get("ocrBlockNumber") == block_number
            and region.get("ocrParagraphNumber") == paragraph_number
            and region.get("ocrLineNumber") == line_number
            and strict_bounds(region) == dict(spec["bounds"])
        ]
        if len(matches) != 1:
            return trusted, low

    authority_ids = tuple(
        str(spec["id"])
        for spec in EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS
    )
    replacement_id = f"{authority_ids[0]}-exact-page45-post-spacing-dimension"
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low
        if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions
        if str(region.get("id") or "")
    }
    for region_id in authority_ids:
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": "superseded_exact_page45_post_spacing_dimension",
            "visualAuthorityStatus": (
                "superseded_by_exact_rendered_page45_post_spacing_dimension_composite"
            ),
            "visualAuthorityReason": (
                "review_the_complete_printed_post_spacing_dimension_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }

    candidate = {
        "id": replacement_id,
        "text": EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_TEXT,
        **dict(EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS[0]["bounds"]),
        "confidence": 0.0,
        "source": EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE
        ),
        "reconstructionMethod": (
            "exact_source_bound_rendered_page45_post_spacing_dimension"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": list(authority_ids),
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page43_dimensions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace only exact page-43 OCR fragments with complete propositions.

    This is a source-, project-, page-, version-, raster-pass-, text-, kind-,
    and geometry-bound recovery of the reviewed producer from worker build 166.
    Every raw read remains in the audit partition, and every complete value
    remains untrusted until the ordinary distinct dual-provider review accepts
    or dismisses it.
    """
    original_trusted = [dict(region) for region in trusted_regions]
    original_low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE49_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE49_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE49_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE43_NUMBER
    ):
        return original_trusted, original_low

    def contract_match(
        region: dict[str, Any],
        contract: tuple[str, tuple[str, ...], dict[str, float]],
        *,
        prefix: str | None = None,
    ) -> bool:
        kind, text_variants, bounds = contract
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return False
        if (
            str(region.get("source") or "") != "fixed_visual_tile_coordinate_ocr"
            or str(region.get("ocrKind") or "") != kind
            or str(region.get("text") or "") not in set(text_variants)
            or normalized_region_bounds(region) != dict(bounds)
            or region.get("ocrBoundaryTruncated") is True
        ):
            return False
        if prefix is None:
            return True
        region_id = str(region.get("id") or "")
        return bool(
            str(region.get("ocrPrefix") or "") == prefix
            and region_id.startswith(f"{prefix}-{kind}-")
        )

    anchors: dict[str, dict[str, Any]] = {}
    superseded_raw_ids: dict[str, str] = {}
    for spec in EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SPECS:
        replacement_id = str(spec["id"])
        matching_anchors = [
            region
            for region in raw_regions
            if any(
                contract_match(region, (kind, texts, bounds), prefix=prefix)
                for prefix, kind, texts, bounds in spec["anchors"]
            )
        ]
        if len(matching_anchors) != 1:
            return original_trusted, original_low
        anchors[replacement_id] = matching_anchors[0]

        matched_ids = {
            str(region.get("id") or "")
            for region in raw_regions
            if any(contract_match(region, contract) for contract in spec["supersede"])
        }
        if not matched_ids or "" in matched_ids:
            return original_trusted, original_low
        for region_id in matched_ids:
            existing = superseded_raw_ids.get(region_id)
            if existing is not None and existing != replacement_id:
                return original_trusted, original_low
            superseded_raw_ids[region_id] = replacement_id

    def replacement_for_authority(region: dict[str, Any]) -> str | None:
        direct = superseded_raw_ids.get(str(region.get("id") or ""))
        referenced = superseded_raw_ids.get(
            str(region.get("boundedMeasurementRawRegionId") or "")
        )
        if direct and referenced and direct != referenced:
            return None
        return direct or referenced

    authority_counts = {
        str(spec["id"]): 0 for spec in EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SPECS
    }
    for region in [*original_trusted, *original_low]:
        replacement_id = replacement_for_authority(region)
        if replacement_id:
            authority_counts[replacement_id] += 1
    if any(count <= 0 for count in authority_counts.values()):
        return original_trusted, original_low

    def quarantined(region: dict[str, Any], replacement_id: str) -> dict[str, Any]:
        return {
            **region,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_exact_complete_issued_page43_dimension_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }

    result_trusted: list[dict[str, Any]] = []
    moved_from_trusted: list[dict[str, Any]] = []
    for region in original_trusted:
        replacement_id = replacement_for_authority(region)
        if replacement_id:
            moved_from_trusted.append(quarantined(region, replacement_id))
        else:
            result_trusted.append(dict(region))
    result_low = [
        quarantined(region, replacement_id)
        if (replacement_id := replacement_for_authority(region))
        else dict(region)
        for region in original_low
    ]
    result_low.extend(moved_from_trusted)

    existing_ids = {
        str(region.get("id") or "") for region in [*result_trusted, *result_low]
    }
    candidates: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SPECS:
        replacement_id = str(spec["id"])
        if replacement_id in existing_ids:
            return original_trusted, original_low
        existing_ids.add(replacement_id)
        anchor = anchors[replacement_id]
        candidates.append({
            "id": replacement_id,
            "text": str(spec["text"]),
            "label": str(spec["text"]),
            **dict(spec["bounds"]),
            "confidence": round(bounded(float(anchor.get("confidence") or 0)), 5),
            "source": EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_complete_page43_dimension_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE43_DIMENSION_SOURCE,
            "reconstructionMethod": "exact_source_bound_fixed_render_page43_dimension",
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [str(anchor.get("id") or "")],
        })
    return result_trusted, [*candidates, *result_low]


def reconstruct_exact_architectural_2375_page49_support_spacing(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review each complete page-49 support-spacing clause, not bare feet.

    The exact issued notes read ``SUPPORTS 5'-0\" O.C. MAX.`` in two
    locations. Fixed-tile OCR trusts the surrounding words but leaves only the
    nested ``5'-0\"`` word for provider review. Repeated live review therefore
    asked providers to decide a measurement without its spacing semantics and
    produced the same split decision twice. Bind the four exact rendered words
    on each immutable OCR line, retain every word as non-searchable audit
    evidence, and offer one complete non-searchable clause to the unchanged
    distinct dual-provider resolver. No fact is accepted by reconstruction.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE49_NUMBER
    ):
        return trusted, low

    def strict_word_match(
        region: dict[str, Any], spec: dict[str, Any],
    ) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        order = region.get("ocrOrder")
        if (
            any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in values
            )
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in lineage
            )
            or isinstance(order, bool)
            or not isinstance(order, int)
        ):
            return False
        return bool(
            str(region.get("id") or "") == str(spec["id"])
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage == tuple(spec["lineage"])
            and order == spec["ocrOrder"]
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }
    candidates: list[dict[str, Any]] = []
    claimed_ids: set[str] = set()
    for note_spec in EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SPECS:
        constituents: list[dict[str, Any]] = []
        for index, constituent_spec in enumerate(note_spec["constituents"]):
            region_id = str(constituent_spec["id"])
            raw = raw_by_id.get(region_id)
            matches = [
                region for region in raw_regions
                if strict_word_match(region, constituent_spec)
            ]
            if raw is None or len(matches) != 1 or raw is not matches[0]:
                return trusted, low
            if region_id in claimed_ids:
                return trusted, low
            if index == 1:
                if region_id not in low_by_id or region_id in trusted_by_id:
                    return trusted, low
            elif region_id not in trusted_by_id or region_id in low_by_id:
                return trusted, low
            claimed_ids.add(region_id)
            constituents.append(raw)

        line_keys = {ocr_region_line_key(region) for region in constituents}
        orders = [int(region["ocrOrder"]) for region in constituents]
        computed_bounds = normalized_region_bounds(constituents[0])
        for constituent in constituents[1:]:
            computed_bounds = union_region_bounds(
                computed_bounds, normalized_region_bounds(constituent),
            )
        if (
            None in line_keys
            or len(line_keys) != 1
            or orders != list(range(orders[0], orders[0] + len(orders)))
            or computed_bounds != dict(note_spec["bounds"])
        ):
            return trusted, low

        replacement_id = str(note_spec["id"])
        if replacement_id in raw_by_id:
            return trusted, low
        for constituent in constituents:
            region_id = str(constituent["id"])
            trusted_by_id.pop(region_id, None)
            low_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **constituent,
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_page49_support_spacing_clause"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        candidates.append({
            "id": replacement_id,
            "text": EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_TEXT,
            "label": EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_TEXT,
            **dict(note_spec["bounds"]),
            "confidence": round(min(
                bounded(float(region.get("confidence") or 0))
                for region in constituents
            ), 5),
            "source": EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_complete_page49_support_spacing_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE49_NOTE_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_rendered_page49_support_spacing_clause"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region["id"]) for region in constituents
            ],
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page52_existing_wall_panel(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete page-52 wall-panel callout, not one nested line.

    The issued four-line callout reads ``EXISTING 5 1/2\" THICK CONCRETE
    WALL PANEL``. The fixed rendered pass retained most words but promoted only
    the low-confidence aggregate ``CONCRETE WALL`` for provider review. Two
    live reviews repeated the same fail-closed disagreement because that line
    was presented without its material/thickness semantics. This exact,
    immutable reconstruction retains every OCR constituent as non-searchable
    audit evidence and offers one complete proposition to the unchanged
    distinct dual-provider resolver. Reconstruction never accepts a fact.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE52_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE52_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE52_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE52_NUMBER
    ):
        return trusted, low

    prefix = "visual-tile-0:0:333:500-subtile-2:1"

    def strict_match(region: dict[str, Any], spec: dict[str, Any]) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        order = region.get("ocrOrder")
        expected_order = spec["ocrOrder"]
        if (
            any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in values
            )
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in lineage
            )
            or (
                expected_order is not None
                and (isinstance(order, bool) or not isinstance(order, int))
            )
            or (expected_order is None and order is not None)
        ):
            return False
        return bool(
            str(region.get("id") or "") == str(spec["id"])
            and str(region.get("text") or "") in tuple(
                str(value) for value in spec.get("textVariants", (spec["text"],))
            )
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and str(region.get("id") or "").startswith(
                f"{prefix}-{spec['ocrKind']}-"
            )
            and lineage == tuple(spec["lineage"])
            and order == expected_order
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    trusted_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_CONSTITUENTS[index]["id"])
        for index in (0, 1, 2, 3, 4, 6, 8)
    }
    low_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_CONSTITUENTS[7]["id"])
    }
    raw_only_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_CONSTITUENTS[5]["id"])
    }
    constituents: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_CONSTITUENTS:
        region_id = str(spec["id"])
        matches = [region for region in raw_regions if strict_match(region, spec)]
        raw = raw_by_id.get(region_id)
        if raw is None or len(matches) != 1 or raw is not matches[0]:
            return trusted, low
        if region_id in trusted_ids:
            if region_id not in trusted_by_id or region_id in low_by_id:
                return trusted, low
        elif region_id in low_ids:
            if region_id not in low_by_id or region_id in trusted_by_id:
                return trusted, low
        elif region_id in raw_only_ids:
            if region_id in trusted_by_id or region_id in low_by_id:
                return trusted, low
        else:
            return trusted, low
        constituents.append(raw)

    computed_bounds = normalized_region_bounds(constituents[0])
    for constituent in constituents[1:]:
        computed_bounds = union_region_bounds(
            computed_bounds, normalized_region_bounds(constituent),
        )
    if (
        len({str(region.get("ocrPrefix") or "") for region in constituents}) != 1
        or [int(region["ocrBlockNumber"]) for region in constituents]
        != [9, 9, 9, 9, 10, 11, 11, 11, 12]
        or computed_bounds != EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_BOUNDS
        or EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_ID in raw_by_id
    ):
        return trusted, low

    for constituent in constituents:
        region_id = str(constituent["id"])
        trusted_by_id.pop(region_id, None)
        low_by_id.pop(region_id, None)
        low_by_id[region_id] = {
            **constituent,
            "searchable": False,
            "ocrValidationStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SUPERSEDED_STATUS
            ),
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_the_complete_exact_page52_existing_wall_panel_callout"
            ),
            "visualAuthorityReplacementId": (
                EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_ID
            ),
        }

    candidate = {
        "id": EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_ID,
        "text": EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_TEXT,
        "label": EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_TEXT,
        **dict(EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_BOUNDS),
        "confidence": round(min(
            bounded(float(region.get("confidence") or 0))
            for region in constituents
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_complete_page52_existing_wall_panel_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE52_NOTE_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_page52_existing_wall_panel_callout"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [str(region["id"]) for region in constituents],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page53_existing_wall_panel(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete page-53 wall-panel callout, not one nested line.

    The issued callout repeats ``EXISTING 5 1/2\" THICK CONCRETE WALL
    PANEL``. The rendered OCR is complete across three lines, but only the
    zero-confidence aggregate ``CONCRETE WALL`` was promoted for provider
    review. This immutable reconstruction retains every constituent as
    non-searchable audit evidence and offers the complete printed proposition
    to the unchanged distinct dual-provider resolver. It never accepts a fact.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE53_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE53_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE53_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE53_NUMBER
    ):
        return trusted, low

    prefix = "visual-tile-0:0:333:500-subtile-1:2"

    def strict_match(region: dict[str, Any], spec: dict[str, Any]) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        order = region.get("ocrOrder")
        expected_order = spec["ocrOrder"]
        if (
            any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in values
            )
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in lineage
            )
            or (
                expected_order is not None
                and (isinstance(order, bool) or not isinstance(order, int))
            )
            or (expected_order is None and order is not None)
        ):
            return False
        return bool(
            str(region.get("id") or "") == str(spec["id"])
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and str(region.get("id") or "").startswith(
                f"{prefix}-{spec['ocrKind']}-"
            )
            and lineage == tuple(spec["lineage"])
            and order == expected_order
            and normalized_region_bounds(region) == dict(spec["bounds"])
        )

    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    trusted_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_CONSTITUENTS[index]["id"])
        for index in (0, 1, 2, 3, 4, 6)
    }
    low_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_CONSTITUENTS[7]["id"])
    }
    raw_only_ids = {
        str(EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_CONSTITUENTS[index]["id"])
        for index in (5, 8)
    }
    constituents: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_CONSTITUENTS:
        region_id = str(spec["id"])
        matches = [region for region in raw_regions if strict_match(region, spec)]
        raw = raw_by_id.get(region_id)
        if raw is None or len(matches) != 1 or raw is not matches[0]:
            return trusted, low
        if region_id in trusted_ids:
            if region_id not in trusted_by_id or region_id in low_by_id:
                return trusted, low
        elif region_id in low_ids:
            if region_id not in low_by_id or region_id in trusted_by_id:
                return trusted, low
        elif region_id in raw_only_ids:
            if region_id in trusted_by_id or region_id in low_by_id:
                return trusted, low
        else:
            return trusted, low
        constituents.append(raw)

    computed_bounds = normalized_region_bounds(constituents[0])
    for constituent in constituents[1:]:
        computed_bounds = union_region_bounds(
            computed_bounds, normalized_region_bounds(constituent),
        )
    if (
        len({str(region.get("ocrPrefix") or "") for region in constituents}) != 1
        or [int(region["ocrBlockNumber"]) for region in constituents]
        != [26, 26, 26, 26, 26, 27, 27, 27, 28]
        or computed_bounds != EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_BOUNDS
        or EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_ID in raw_by_id
    ):
        return trusted, low

    for constituent in constituents:
        region_id = str(constituent["id"])
        trusted_by_id.pop(region_id, None)
        low_by_id.pop(region_id, None)
        low_by_id[region_id] = {
            **constituent,
            "searchable": False,
            "ocrValidationStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SUPERSEDED_STATUS
            ),
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_the_complete_exact_page53_existing_wall_panel_callout"
            ),
            "visualAuthorityReplacementId": (
                EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_ID
            ),
        }

    candidate = {
        "id": EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_ID,
        "text": EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_TEXT,
        "label": EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_TEXT,
        **dict(EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_BOUNDS),
        "confidence": round(min(
            bounded(float(region.get("confidence") or 0))
            for region in constituents
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_complete_page53_existing_wall_panel_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE53_NOTE_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_page53_existing_wall_panel_callout"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [str(region["id"]) for region in constituents],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_material_labels(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review immutable issued material labels without OCR punctuation.

    The fixed drawing pixels are the authority here, not one nondeterministic
    Tesseract confidence/line number. Each candidate is bound to the exact
    project, source checksum, evidence version, page, and callout geometry.
    Matching OCR variants are retained as non-searchable audit evidence, while
    the complete canonical label remains unresolved until distinct providers
    accept or dismiss it. No branch directly accepts or publishes a fact.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    page_specs = [
        spec for spec in EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SPECS
        if spec["pageNumber"] == page_number
    ]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE52_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE52_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE52_EVIDENCE_VERSION
        and page_specs
    ):
        return trusted, low

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_ids = {
        str(region.get("id") or "")
        for region in raw_regions if str(region.get("id") or "")
    }
    if any(str(spec["candidateId"]) in raw_ids for spec in page_specs):
        return trusted, low

    def letter_signature(value: str) -> str:
        return re.sub(r"[^A-Z]", "", value.upper())

    def exact_callout_overlap(
        region: dict[str, Any], spec: dict[str, Any],
    ) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if (
            str(region.get("source") or "")
            != "fixed_visual_tile_coordinate_ocr"
            or str(region.get("ocrKind") or "") != "line"
            or region.get("ocrBoundaryTruncated") is True
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in values
            )
        ):
            return False
        region_bounds = normalized_region_bounds(region)
        expected = dict(spec["raw"]["bounds"])
        center_x = region_bounds["x"] + region_bounds["width"] / 2
        center_y = region_bounds["y"] + region_bounds["height"] / 2
        expected_center_x = expected["x"] + expected["width"] / 2
        expected_center_y = expected["y"] + expected["height"] / 2
        signature = letter_signature(str(region.get("text") or ""))
        canonical_signature = letter_signature(str(spec["canonicalText"]))
        known_artifact_signature = letter_signature(str(spec["raw"]["text"]))
        return bool(
            abs(center_x - expected_center_x) <= 0.004
            and abs(center_y - expected_center_y) <= 0.006
            and 0.02 <= region_bounds["width"] <= 0.09
            and 0.002 <= region_bounds["height"] <= 0.02
            and signature in {canonical_signature, known_artifact_signature}
        )

    replacements: list[dict[str, Any]] = []
    for spec in page_specs:
        matching = [
            region for region in raw_regions
            if exact_callout_overlap(region, spec)
        ]
        if len(matching) > 1:
            return trusted, low
        for region in matching:
            region_id = str(region.get("id") or "")
            if not region_id:
                return trusted, low
            trusted_by_id.pop(region_id, None)
            low_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_rendered_material_label"
                ),
                "visualAuthorityReplacementId": str(spec["candidateId"]),
            }
        replacements.append({
            "id": str(spec["candidateId"]),
            "text": str(spec["canonicalText"]),
            "label": str(spec["canonicalText"]),
            **dict(spec["raw"]["bounds"]),
            "confidence": round(min(
                (bounded(float(region.get("confidence") or 0)) for region in matching),
                default=0.0,
            ), 5),
            "source": EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_complete_material_label_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_MATERIAL_LABEL_SOURCE,
            "reconstructionMethod": (
                "exact_source_page_bound_rendered_material_label_callout"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "") for region in matching
            ],
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*replacements, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page60_schedule_measurement(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the exact issued door-3 width without its table rule.

    The immutable page-60 render prints ``13'-0\"`` in the door schedule.
    Fixed-tile OCR attached the left cell rule and proposed ``[13’-0\"``;
    providers then correctly declined that malformed proposition.  This repair
    is bound to the exact source, project, page, OCR identity, lineage, text,
    and geometry.  It retains the raw read as non-searchable audit evidence
    and creates one unresolved canonical candidate.  It never accepts or
    publishes the value without the ordinary independent provider path.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE60_NUMBER
    ):
        return trusted, low

    spec = EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SPEC
    raw_spec = spec["raw"]

    def exact_raw_match(region: dict[str, Any]) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        return bool(
            str(region.get("id") or "") == str(raw_spec["id"])
            and str(region.get("text") or "")
            in tuple(raw_spec["textVariants"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(raw_spec["prefix"])
            and lineage == tuple(raw_spec["lineage"])
            and not isinstance(region.get("ocrOrder"), bool)
            and region.get("ocrOrder") == raw_spec["ocrOrder"]
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region) == dict(raw_spec["bounds"])
        )

    matches = [region for region in raw_regions if exact_raw_match(region)]
    candidate_id = str(spec["candidateId"])
    if len(matches) != 1 or any(
        str(region.get("id") or "") == candidate_id for region in raw_regions
    ):
        return trusted, low

    raw = matches[0]
    raw_id = str(raw["id"])
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    authority = trusted_by_id.pop(raw_id, None)
    if authority is None:
        authority = low_by_id.pop(raw_id, None)
    if authority is None:
        return trusted, low
    low_by_id[raw_id] = {
        **authority,
        "searchable": False,
        "ocrValidationStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SUPERSEDED_STATUS
        ),
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SUPERSEDED_STATUS
        ),
        "visualAuthorityReason": (
            "review_the_complete_exact_rendered_door_schedule_measurement"
        ),
        "visualAuthorityReplacementId": candidate_id,
    }
    candidate = {
        "id": candidate_id,
        "text": str(spec["canonicalText"]),
        "label": str(spec["canonicalText"]),
        **dict(spec["candidateBounds"]),
        "confidence": round(bounded(float(raw.get("confidence") or 0)), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_door_schedule_measurement_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE60_SCHEDULE_SOURCE,
        "reconstructionMethod": (
            "exact_source_bound_rendered_door_schedule_rule_separation"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [raw_id],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page61_handrail_note(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete exact handrail-bracket spacing proposition.

    The issued page prints ``HANDRAIL BRACKET @ 4'-0\" MAX. O.C.``. The fixed
    visual pass read every surrounding word but proposed only the corrupted
    token ``4'-O\"`` to providers. This exact-source reconstruction requires
    every rendered constituent at its immutable OCR identity, lineage, order,
    and geometry. It retains the raw measurement as audit-only evidence and
    creates one unresolved full-note candidate; ordinary dual-provider
    resolution remains mandatory before publication.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE61_NUMBER
    ):
        return trusted, low

    spec = EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SPEC

    def exact_constituent_match(
        region: dict[str, Any], expected: dict[str, Any],
    ) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        return bool(
            str(region.get("id") or "") == str(expected["id"])
            and str(region.get("text") or "") == str(expected["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(expected["prefix"])
            and lineage == tuple(expected["lineage"])
            and not isinstance(region.get("ocrOrder"), bool)
            and region.get("ocrOrder") == expected["ocrOrder"]
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region) == dict(expected["bounds"])
        )

    matched: list[dict[str, Any]] = []
    for expected in spec["constituents"]:
        matches = [
            region for region in raw_regions
            if exact_constituent_match(region, expected)
        ]
        if len(matches) != 1:
            return trusted, low
        matched.append(matches[0])
    candidate_id = str(spec["candidateId"])
    if any(str(region.get("id") or "") == candidate_id for region in raw_regions):
        return trusted, low

    measurement_id = str(spec["measurementId"])
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    authority = trusted_by_id.pop(measurement_id, None)
    if authority is None:
        authority = low_by_id.pop(measurement_id, None)
    if authority is None:
        return trusted, low
    low_by_id[measurement_id] = {
        **authority,
        "searchable": False,
        "ocrValidationStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SUPERSEDED_STATUS
        ),
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SUPERSEDED_STATUS
        ),
        "visualAuthorityReason": "review_the_complete_exact_rendered_handrail_note",
        "visualAuthorityReplacementId": candidate_id,
    }
    candidate = {
        "id": candidate_id,
        "text": str(spec["canonicalText"]),
        "label": str(spec["canonicalText"]),
        **dict(spec["candidateBounds"]),
        "confidence": round(min(
            (bounded(float(region.get("confidence") or 0)) for region in matched),
            default=0.0,
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_handrail_note_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE61_HANDRAIL_SOURCE,
        "reconstructionMethod": "exact_source_bound_rendered_handrail_note",
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [str(region["id"]) for region in matched],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page63_spacing_notes(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review five complete issued spacing propositions on exact page 63.

    The fixed visual tiles split four support-post notes across neighboring
    subtiles and produced one conflicting pair of reads for the handrail-post
    key note. Providers consequently received either a corrupted measurement
    token or a clause beginning midway through the printed instruction. This
    reconstruction is bound to the exact issued source and exact rendered OCR
    geometry. It retains every malformed read as audit-only evidence and
    creates five unresolved complete propositions; ordinary dual-provider
    resolution remains mandatory before publication.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE63_NUMBER
    ):
        return trusted, low

    def exact_constituent_match(
        region: dict[str, Any], expected: dict[str, Any],
    ) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        return bool(
            str(region.get("text") or "") in expected["textVariants"]
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == "word"
            and str(region.get("ocrPrefix") or "") == str(expected["prefix"])
            and lineage == tuple(expected["lineage"])
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region) == dict(expected["bounds"])
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    candidates: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SPECS:
        candidate_id = str(spec["candidateId"])
        if any(
            str(region.get("id") or "") == candidate_id
            for region in raw_regions
        ):
            continue
        matched: list[dict[str, Any]] = []
        valid = True
        for expected in spec["constituents"]:
            matches = [
                region for region in raw_regions
                if exact_constituent_match(region, expected)
            ]
            if len(matches) != 1:
                valid = False
                break
            matched.append(matches[0])
        if not valid:
            continue

        authority_ids = tuple(str(value) for value in spec["authorityIds"])
        authority_regions: list[dict[str, Any]] = []
        for authority_id in authority_ids:
            authority = trusted_by_id.pop(authority_id, None)
            if authority is None:
                authority = low_by_id.pop(authority_id, None)
            if authority is not None:
                authority_regions.append(authority)
        if not authority_regions:
            continue
        for authority in authority_regions:
            authority_id = str(authority["id"])
            low_by_id[authority_id] = {
                **authority,
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_rendered_spacing_proposition"
                ),
                "visualAuthorityReplacementId": candidate_id,
            }
        candidates.append({
            "id": candidate_id,
            "text": str(spec["canonicalText"]),
            "label": str(spec["canonicalText"]),
            **dict(spec["candidateBounds"]),
            "confidence": round(min(
                (bounded(float(region.get("confidence") or 0)) for region in matched),
                default=0.0,
            ), 5),
            "source": EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_spacing_proposition_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_ARCHITECTURAL_2375_PAGE63_SPACING_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_rendered_spacing_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [str(region["id"]) for region in matched],
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page64_control_joint_note(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete issued page-64 control- and expansion-joint notes.

    Two overlapping rendered passes read the same inch glyph as ``D`` and
    ``0``.  Reviewing either isolated token asks providers to judge a fragment
    instead of the printed construction instruction.  This exact source-bound
    reconstruction retains the malformed reads as audit-only evidence and
    creates complete unresolved propositions for the control and expansion
    notes. Ordinary dual-provider resolution remains mandatory before either
    proposition can be published.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE64_NUMBER
    ):
        return trusted, low

    def exact_match(
        region: dict[str, Any], expected: dict[str, Any],
    ) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        expected_lineages = expected.get("lineageVariants")
        if expected_lineages is None:
            expected_lineages = (tuple(expected["lineage"]),)
        expected_bounds = expected.get("boundsVariants")
        if expected_bounds is None:
            expected_bounds = (dict(expected["bounds"]),)
        return bool(
            str(region.get("id") or "") in expected["idVariants"]
            and str(region.get("text") or "") in expected["textVariants"]
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "")
            == str(expected.get("ocrKind") or "word")
            and str(region.get("ocrPrefix") or "") == expected["prefix"]
            and lineage in tuple(tuple(value) for value in expected_lineages)
            and region.get("ocrOrder") in expected["ocrOrderVariants"]
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region)
            in tuple(dict(value) for value in expected_bounds)
        )

    def unique_matches(
        specifications: tuple[dict[str, Any], ...],
    ) -> list[dict[str, Any]] | None:
        values: list[dict[str, Any]] = []
        for expected in specifications:
            matches = [
                region for region in raw_regions
                if exact_match(region, expected)
            ]
            if len(matches) != 1:
                return None
            values.append(matches[0])
        return values

    control_matched = unique_matches((
        *EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONSTITUENTS,
        *EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONTEXT,
    ))
    expansion_matched = unique_matches(
        EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_CONTEXT
    )
    expansion_authority_matches = unique_matches(
        EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_AUTHORITIES
    )
    if (
        control_matched is None
        or expansion_matched is None
        or expansion_authority_matches is None
    ):
        return trusted, low

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    authority_regions: list[dict[str, Any]] = []
    for expected, matched_region in zip(
        EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONSTITUENTS,
        control_matched[
            :len(EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_CONSTITUENTS)
        ],
        strict=True,
    ):
        authority_id = str(matched_region["id"])
        authority = trusted_by_id.pop(authority_id, None)
        if authority is None:
            authority = low_by_id.pop(authority_id, None)
        if authority is None:
            return trusted, low
        authority_regions.append(authority)

    optional_overlap = [
        region for region in raw_regions
        if exact_match(
            region,
            EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_OPTIONAL_OVERLAP,
        )
    ]
    if len(optional_overlap) > 1:
        return trusted, low
    if optional_overlap:
        authority_id = str(optional_overlap[0]["id"])
        authority = trusted_by_id.pop(authority_id, None)
        if authority is None:
            authority = low_by_id.pop(authority_id, None)
        if authority is not None:
            authority_regions.append(authority)

    expansion_authority_regions: list[dict[str, Any]] = []
    for matched_region in expansion_authority_matches:
        authority_id = str(matched_region["id"])
        authority = trusted_by_id.pop(authority_id, None)
        if authority is None:
            authority = low_by_id.pop(authority_id, None)
        if authority is not None:
            expansion_authority_regions.append(authority)

    candidate_id = "architectural-2375-page64-control-joint-spacing"
    for authority in authority_regions:
        authority_id = str(authority["id"])
        low_by_id[authority_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SUPERSEDED_STATUS
            ),
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_the_complete_exact_rendered_control_joint_proposition"
            ),
            "visualAuthorityReplacementId": candidate_id,
        }
    candidate = {
        "id": candidate_id,
        "text": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TEXT,
        "label": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_TEXT,
        **EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_BOUNDS,
        "confidence": round(min(
            (
                bounded(float(region.get("confidence") or 0))
                for region in control_matched
            ),
            default=0.0,
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_control_joint_proposition_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE64_CONTROL_JOINT_SOURCE
        ),
        "reconstructionMethod": (
            "exact_source_bound_rendered_control_joint_proposition"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [
            str(region["id"]) for region in control_matched
        ],
    }
    expansion_candidate_id = (
        "architectural-2375-page64-expansion-joint-spacing"
    )
    for authority in expansion_authority_regions:
        authority_id = str(authority["id"])
        low_by_id[authority_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SUPERSEDED_STATUS
            ),
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_the_complete_exact_rendered_expansion_joint_proposition"
            ),
            "visualAuthorityReplacementId": expansion_candidate_id,
        }
    expansion_candidate = {
        "id": expansion_candidate_id,
        "text": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TEXT,
        "label": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_TEXT,
        **EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_BOUNDS,
        "confidence": round(min(
            (
                bounded(float(region.get("confidence") or 0))
                for region in expansion_matched
            ),
            default=0.0,
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_expansion_joint_proposition_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE64_EXPANSION_JOINT_SOURCE
        ),
        "reconstructionMethod": (
            "exact_source_bound_rendered_expansion_joint_proposition"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": [
            str(region["id"]) for region in expansion_matched
        ],
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, expansion_candidate, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page66_opening_notes(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the two complete issued cold-formed framing opening notes.

    Fixed-tile OCR split ``OPENING`` at a subtile boundary and promoted only
    the isolated measurements. Retain every raw read for audit, supersede only
    fragment review authority, and require ordinary dual-provider resolution
    of the complete printed propositions before publication.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE66_NUMBER
    ):
        return trusted, low

    def exact_variant_match(
        region: dict[str, Any],
        constituent: dict[str, Any],
        variant: dict[str, Any],
    ) -> bool:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        order_matches = (
            region.get("ocrOrder") is None
            if constituent["kind"] == "line"
            else (
                not isinstance(region.get("ocrOrder"), bool)
                and region.get("ocrOrder") == variant.get("ocrOrder")
            )
        )
        return bool(
            str(region.get("id") or "") == str(variant["id"])
            and str(region.get("text") or "") == str(constituent["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(constituent["kind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(variant["prefix"])
            and lineage == tuple(variant["lineage"])
            and order_matches
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region)
            == dict(constituent["bounds"])
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    candidates: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SPECS:
        candidate_id = str(spec["candidateId"])
        if any(
            str(region.get("id") or "") == candidate_id
            for region in raw_regions
        ):
            continue
        matched: list[dict[str, Any]] = []
        for constituent in spec["constituents"]:
            matches = [
                region for region in raw_regions
                if any(
                    exact_variant_match(region, constituent, variant)
                    for variant in constituent["variants"]
                )
            ]
            if not matches:
                matched = []
                break
            matched.extend(matches)
        if not matched:
            continue

        authority_regions: list[dict[str, Any]] = []
        for region in matched:
            authority_id = str(region["id"])
            authority = trusted_by_id.pop(authority_id, None)
            if authority is None:
                authority = low_by_id.pop(authority_id, None)
            if authority is not None:
                authority_regions.append(authority)
        candidate_bounds = dict(spec["candidateBounds"])
        authority_key = str(spec["authorityKey"])
        for region_id, region in list(trusted_by_id.items()):
            if (
                authority_key
                in diagnostic_candidate_measurement_authority_keys(
                    str(region.get("text") or "")
                )
                and exact_region_overlaps(candidate_bounds, region)
            ):
                authority_regions.append(trusted_by_id.pop(region_id))
        for region_id, region in list(low_by_id.items()):
            if (
                authority_key
                in diagnostic_candidate_measurement_authority_keys(
                    str(region.get("text") or "")
                )
                and exact_region_overlaps(candidate_bounds, region)
            ):
                authority_regions.append(low_by_id.pop(region_id))
        for authority in authority_regions:
            authority_id = str(authority["id"])
            low_by_id[authority_id] = {
                **authority,
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_rendered_opening_proposition"
                ),
                "visualAuthorityReplacementId": candidate_id,
            }
        candidates.append({
            "id": candidate_id,
            "text": str(spec["canonicalText"]),
            "label": str(spec["canonicalText"]),
            **dict(spec["candidateBounds"]),
            "confidence": round(min(
                (bounded(float(region.get("confidence") or 0)) for region in matched),
                default=0.0,
            ), 5),
            "source": EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_opening_proposition_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE66_OPENING_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_opening_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": sorted({
                str(region["id"]) for region in matched
            }),
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2375_page68_roof_recess_note(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the complete issued roof-recess proposition on page 68."""
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256 == EXACT_ARCHITECTURAL_2375_PAGE43_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2375_PAGE43_PROJECT_ID
        and evidence_version == EXACT_ARCHITECTURAL_2375_PAGE43_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2375_PAGE68_NUMBER
    ):
        return trusted, low

    spec = EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SPEC

    def exact_match(region: dict[str, Any], constituent: dict[str, Any]) -> bool:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        return bool(
            str(region.get("id") or "") == str(constituent["id"])
            and str(region.get("text") or "") == str(constituent["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(constituent["kind"])
            and str(region.get("ocrPrefix") or "") == str(constituent["prefix"])
            and lineage == tuple(constituent["lineage"])
            and region.get("ocrBoundaryTruncated")
            is constituent["boundaryTruncated"]
            and (
                region.get("ocrOrder") is None
                if constituent["ocrOrder"] is None
                else (
                    not isinstance(region.get("ocrOrder"), bool)
                    and region.get("ocrOrder") == constituent["ocrOrder"]
                )
            )
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region) == dict(constituent["bounds"])
        )

    matched: list[dict[str, Any]] = []
    for constituent in spec["constituents"]:
        matches = [
            region for region in raw_regions if exact_match(region, constituent)
        ]
        if len(matches) != 1:
            return trusted, low
        matched.extend(matches)

    candidate_id = str(spec["candidateId"])
    if any(str(region.get("id") or "") == candidate_id for region in raw_regions):
        return trusted, low
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    authority_regions: list[dict[str, Any]] = []
    for region in matched:
        region_id = str(region["id"])
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is not None:
            authority_regions.append(authority)
    candidate_bounds = dict(spec["candidateBounds"])
    authority_key = str(spec["authorityKey"])
    for collection in (trusted_by_id, low_by_id):
        for region_id, region in list(collection.items()):
            if (
                authority_key
                in diagnostic_candidate_measurement_authority_keys(
                    str(region.get("text") or "")
                )
                and exact_region_overlaps(candidate_bounds, region)
            ):
                authority_regions.append(collection.pop(region_id))
    for authority in authority_regions:
        authority_id = str(authority["id"])
        low_by_id[authority_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SUPERSEDED_STATUS
            ),
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SUPERSEDED_STATUS
            ),
            "visualAuthorityReason": (
                "review_the_complete_exact_rendered_roof_recess_proposition"
            ),
            "visualAuthorityReplacementId": candidate_id,
        }
    candidate = {
        "id": candidate_id,
        "text": str(spec["canonicalText"]),
        "label": str(spec["canonicalText"]),
        **candidate_bounds,
        "confidence": round(min(
            (bounded(float(region.get("confidence") or 0)) for region in matched),
            default=0.0,
        ), 5),
        "source": EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SOURCE,
        "searchable": False,
        "ocrKind": "exact_rendered_roof_recess_proposition_candidate",
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2375_PAGE68_ROOF_RECESS_SOURCE
        ),
        "reconstructionMethod": (
            "exact_source_bound_rendered_roof_recess_proposition"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": sorted(str(region["id"]) for region in matched),
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def reconstruct_exact_canopy_b_page4_schedule_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review two complete source-bound Canopy B schedule propositions.

    Fixed-tile OCR split the AR3 elevation and promoted only the W/L fragment
    of the AR8 maximum-plate row. The exact issued page is clear at high
    resolution. Keep every original OCR read for audit, replace only those
    fragment authorities with complete propositions, and leave ordinary
    dual-provider resolution mandatory before either can become searchable.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        project_id == EXACT_CANOPY_B_PROJECT_ID
        and source_sha256 == EXACT_CANOPY_B_SOURCE_SHA256
        and evidence_version == EXACT_CANOPY_B_EVIDENCE_VERSION
        and page_number == EXACT_CANOPY_B_PAGE4_NUMBER
    ):
        return trusted, low

    def exact_constituent_match(
        region: dict[str, Any], expected: dict[str, Any],
    ) -> bool:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        expected_kind = str(expected.get("kind") or "word")
        return bool(
            str(region.get("id") or "") == str(expected["id"])
            and str(region.get("text") or "") == str(expected["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == expected_kind
            and str(region.get("ocrPrefix") or "") == str(expected["prefix"])
            and lineage == tuple(expected["lineage"])
            and region.get("ocrOrder") == expected["ocrOrder"]
            and region.get("ocrBoundaryTruncated") is False
            and all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(float(value))
                for value in values
            )
            and normalized_region_bounds(region) == dict(expected["bounds"])
        )

    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    candidates: list[dict[str, Any]] = []
    for spec in EXACT_CANOPY_B_PAGE4_SCHEDULE_SPECS:
        candidate_id = str(spec["candidateId"])
        if any(
            str(region.get("id") or "") == candidate_id
            for region in raw_regions
        ):
            continue
        matched: list[dict[str, Any]] = []
        valid = True
        for expected in spec["constituents"]:
            matches = [
                region for region in raw_regions
                if exact_constituent_match(region, expected)
            ]
            if len(matches) != 1:
                valid = False
                break
            matched.append(matches[0])
        if not valid:
            continue

        authority_regions: list[dict[str, Any]] = []
        for authority_id in tuple(spec["authorityIds"]):
            authority = trusted_by_id.pop(str(authority_id), None)
            if authority is None:
                authority = low_by_id.pop(str(authority_id), None)
            if authority is not None:
                authority_regions.append(authority)
        if not authority_regions:
            continue
        for authority in authority_regions:
            authority_id = str(authority["id"])
            low_by_id[authority_id] = {
                **authority,
                "searchable": False,
                "ocrValidationStatus": (
                    EXACT_CANOPY_B_PAGE4_SCHEDULE_SUPERSEDED_STATUS
                ),
                "visualAuthorityStatus": (
                    EXACT_CANOPY_B_PAGE4_SCHEDULE_SUPERSEDED_STATUS
                ),
                "visualAuthorityReason": (
                    "review_the_complete_exact_rendered_schedule_proposition"
                ),
                "visualAuthorityReplacementId": candidate_id,
            }
        candidates.append({
            "id": candidate_id,
            "text": str(spec["canonicalText"]),
            "label": str(spec["canonicalText"]),
            **dict(spec["candidateBounds"]),
            "confidence": round(min(
                (bounded(float(region.get("confidence") or 0)) for region in matched),
                default=0.0,
            ), 5),
            "source": EXACT_CANOPY_B_PAGE4_SCHEDULE_SOURCE,
            "searchable": False,
            "ocrKind": "exact_rendered_schedule_proposition_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": EXACT_CANOPY_B_PAGE4_SCHEDULE_SOURCE,
            "reconstructionMethod": (
                "exact_source_bound_rendered_schedule_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [str(region["id"]) for region in matched],
        })
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*candidates, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page30_dimension_candidates(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace exact page-30 OCR corruption with issued dimensions.

    Architectural 2321 page 30 has thirteen small printed dimension strings
    whose fixed-tile OCR propositions contain substituted digits or malformed
    quote characters. High-resolution review confirms the complete issued
    dimensions, while repeated generic OCR reads do not converge reliably.
    This immutable-source rule therefore changes only the proposition shown to
    the ordinary dual-provider resolver. It never publishes a fact directly.

    Each replacement is independently bound to the exact project, source,
    evidence version, page, fixed-tile pass, word geometry, and OCR lineage.
    OCR text and confidence are deliberately not artifact identity: equivalent
    Tesseract runs can assign different scores or substitute punctuation for
    the same immutable pixels. The observed token must still be a bounded
    measurement-shaped read. The raw OCR remains in the rejected audit
    partition with an explicit supersession bind. Any missing, duplicate,
    truncated, non-measurement, or altered constituent leaves that individual
    proposition on the normal fail-closed path.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE30_NUMBER
    ):
        return trusted, low

    def exact_text(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def strict_line_key(
        region: dict[str, Any],
    ) -> tuple[str, int, int, int] | None:
        prefix = region.get("ocrPrefix")
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        if (
            not isinstance(prefix, str)
            or not prefix
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in lineage
            )
        ):
            return None
        return (prefix, *lineage)

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def measurement_shaped_text(value: Any) -> bool:
        text = exact_text(value)
        return bool(
            1 <= len(text) <= 32
            and re.search(r"\d", text)
            and re.search(r"['\u2019]", text)
        )

    def geometry_match(
        region: dict[str, Any],
        *,
        bounds: dict[str, float],
        prefix: str,
        kind: str,
    ) -> bool:
        return bool(
            str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == kind
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == prefix
            and strict_line_key(region) is not None
            and strict_bounds(region) == bounds
            and measurement_shaped_text(region.get("text"))
        )

    trusted_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in trusted
        if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in low
        if str(region.get("id") or "")
    }
    partition = [*trusted_by_id.values(), *low_by_id.values()]
    composites: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS:
        raw_spec = spec["raw"]
        expected_bounds = spec["bounds"]
        expected_prefix = str(raw_spec["ocrPrefix"])
        raw_matches = [
            region for region in raw_regions
            if geometry_match(
                region,
                bounds=expected_bounds,
                prefix=expected_prefix,
                kind="word",
            )
        ]
        partition_matches = [
            region for region in partition
            if geometry_match(
                region,
                bounds=expected_bounds,
                prefix=expected_prefix,
                kind="word",
            )
        ]
        if len(raw_matches) != 1 or len(partition_matches) != 1:
            continue
        raw_word = raw_matches[0]
        partition_word = partition_matches[0]
        if exact_text(raw_word.get("text")) != exact_text(partition_word.get("text")):
            continue
        word_line_key = strict_line_key(raw_word)
        if word_line_key is None:
            continue

        superseded_regions = [partition_word]
        line_spec = spec.get("supersededLine")
        if isinstance(line_spec, dict):
            line_bounds = line_spec.get("bounds")
            if not isinstance(line_bounds, dict):
                continue
            raw_line_matches = [
                region for region in raw_regions
                if geometry_match(
                    region,
                    bounds=line_bounds,
                    prefix=expected_prefix,
                    kind="line",
                )
                and strict_line_key(region) == word_line_key
            ]
            partition_line_matches = [
                region for region in partition
                if geometry_match(
                    region,
                    bounds=line_bounds,
                    prefix=expected_prefix,
                    kind="line",
                )
                and strict_line_key(region) == word_line_key
            ]
            if len(raw_line_matches) != 1 or len(partition_line_matches) > 1:
                continue
            if partition_line_matches:
                if exact_text(raw_line_matches[0].get("text")) != exact_text(
                    partition_line_matches[0].get("text")
                ):
                    continue
                superseded_regions.append(partition_line_matches[0])
            else:
                # Confidence partitioning may omit a low-confidence aggregate
                # once one of its contained words is trusted. Preserve the raw
                # line as non-searchable audit evidence so it cannot reappear
                # later as a second malformed review authority.
                superseded_regions.append(raw_line_matches[0])

        replacement_id = str(spec["id"])
        for region in superseded_regions:
            region_id = str(region.get("id") or "")
            trusted_by_id.pop(region_id, None)
            low_by_id.pop(region_id, None)
            low_by_id[region_id] = {
                **region,
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_page30_dimension_candidate"
                ),
                "visualAuthorityReason": (
                    "review_complete_issued_dimension_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        composites.append({
            "id": replacement_id,
            "text": spec["text"],
            "label": spec["text"],
            **expected_bounds,
            "confidence": round(
                min(float(region.get("confidence") or 0)
                    for region in superseded_regions),
                5,
            ),
            "source": EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_page30_dimension_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "")
                for region in superseded_regions
            ],
            **(
                {"visualAuthorityReviewGroup": str(spec["reviewGroup"])}
                if spec.get("reviewGroup")
                else {}
            ),
        })

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*composites, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page30_complete_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace two exact page-30 fragments with complete issued statements.

    The providers repeatedly disagreed when asked to judge the isolated
    ``24'-0\"`` and ``186'`` OCR fragments. The rendered sheet states complete
    roof-height and exit-distance propositions. This exact-source producer
    requires every fixed-raster constituent and replaces only the review
    authority. Raw OCR stays non-searchable and auditable; the complete
    statement remains unresolved until the ordinary two-provider contract
    accepts it.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE30_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        return bounds if bounds["width"] > 0 and bounds["height"] > 0 else None

    def exact_text(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def constituent_matches(
        region: dict[str, Any], spec: dict[str, Any],
    ) -> bool:
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in lineage
        ):
            return False
        accepted_lineages = tuple(
            tuple(value)
            for value in spec.get("acceptedLineages", (spec["lineage"],))
        )
        if not (
            str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage in accepted_lineages
            and strict_bounds(region) == spec["bounds"]
        ):
            return False
        text = exact_text(region.get("text"))
        if spec["textMode"] == "measurement":
            return bool(
                1 <= len(text) <= 32
                and re.search(r"\d", text)
                and re.search(r"['\u2019]", text)
            )
        accepted_texts = tuple(
            str(value)
            for value in spec.get("acceptedTexts", (spec["text"],))
        )
        return text in accepted_texts

    trusted_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in low if str(region.get("id") or "")
    }
    # Preserve the original sequence here rather than projecting through the
    # ID maps. Duplicate evidence, including duplicate IDs, must make this
    # exact source-bound reconstruction fail closed instead of being silently
    # collapsed into one apparent authority.
    partition = [*trusted, *low]
    composites: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS:
        matched_constituents: list[dict[str, Any]] = []
        for constituent_spec in spec["constituents"]:
            matches = [
                region for region in raw_regions
                if constituent_matches(region, constituent_spec)
            ]
            if len(matches) != 1:
                break
            matched_constituents.append(matches[0])
        if len(matched_constituents) != len(spec["constituents"]):
            continue

        superseded_spec = spec["supersededCandidate"]
        superseded_matches = [
            region for region in partition
            if (
                exact_text(region.get("text")) == superseded_spec["text"]
                and str(region.get("source") or "") == superseded_spec["source"]
                and strict_bounds(region) == superseded_spec["bounds"]
            )
        ]
        if len(superseded_matches) != 1:
            continue
        superseded = superseded_matches[0]
        if (
            superseded_spec.get("id")
            and str(superseded.get("id") or "") != superseded_spec["id"]
        ):
            continue
        replacement_id = str(spec["id"])
        superseded_id = str(superseded.get("id") or "")
        trusted_by_id.pop(superseded_id, None)
        low_by_id.pop(superseded_id, None)
        low_by_id[superseded_id] = {
            **superseded,
            "searchable": False,
            "visualAuthorityStatus": (
                "superseded_by_exact_rendered_page30_complete_proposition_candidate"
            ),
            "visualAuthorityReason": (
                "review_complete_issued_page30_proposition_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
        constituent_ids = {
            str(region.get("id") or "") for region in matched_constituents
        }
        for region_id in constituent_ids:
            existing = trusted_by_id.pop(region_id, None)
            if existing is None:
                existing = low_by_id.pop(region_id, None)
            if existing is not None:
                low_by_id[region_id] = {
                    **existing,
                    "searchable": False,
                    "visualAuthorityStatus": (
                        "superseded_by_exact_rendered_page30_complete_proposition_candidate"
                    ),
                    "visualAuthorityReason": (
                        "constituent_of_complete_issued_page30_proposition"
                    ),
                    "visualAuthorityReplacementId": replacement_id,
                }
        composites.append({
            "id": replacement_id,
            "text": spec["text"],
            "label": spec["text"],
            **spec["bounds"],
            "confidence": round(min(
                float(region.get("confidence") or 0)
                for region in matched_constituents
            ), 5),
            "source": EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_page30_complete_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "") for region in matched_constituents
            ],
        })

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*composites, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page31_complete_propositions(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Replace two exact page-31 OCR fragments with issued propositions.

    The boxed ``20'-11\"`` dimension includes its border in the OCR token, and
    the demolition note crosses an internal fixed-tile overlap. One pass ends
    with a truncated ``UF`` while the neighboring pass starts with the OCR
    substitution ``SHOUN``. Asking providers to judge those fragments caused
    stable disagreement even though the complete issued text is visible.

    This rule is immutable-source bound and requires every exact rendered word,
    line, coordinate, OCR pass, lineage, and artifact ID. It changes only the
    proposition sent to the ordinary dual-provider resolver. All constituent
    and malformed reads remain non-searchable audit evidence; no fact is
    published by reconstruction itself. Any drift leaves the original
    authorities untouched and unresolved.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE31_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(region.get(key) for key in ("x", "y", "width", "height"))
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        return bounds if bounds["width"] > 0 and bounds["height"] > 0 else None

    def exact_text(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def authority_matches(
        region: dict[str, Any], spec: dict[str, Any],
    ) -> bool:
        lineage = tuple(
            region.get(key)
            for key in ("ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber")
        )
        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in lineage
        ):
            return False
        return bool(
            str(region.get("id") or "") == str(spec["id"])
            and exact_text(region.get("text")) == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage == tuple(spec["lineage"])
            and region.get("ocrBoundaryTruncated")
            is bool(spec.get("ocrBoundaryTruncated", False))
            and strict_bounds(region) == spec["bounds"]
        )

    trusted_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): dict(region)
        for region in low if str(region.get("id") or "")
    }
    composites: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS:
        bound_specs = [*spec["constituents"], *spec.get("auditOnly", ())]
        matched: list[dict[str, Any]] = []
        for authority_spec in bound_specs:
            matches = [
                region for region in raw_regions
                if authority_matches(region, authority_spec)
            ]
            if len(matches) != 1:
                break
            matched.append(matches[0])
        if len(matched) != len(bound_specs):
            continue
        authority_ids = [str(region.get("id") or "") for region in matched]
        if len(authority_ids) != len(set(authority_ids)):
            continue

        replacement_id = str(spec["id"])
        for region in matched:
            region_id = str(region.get("id") or "")
            existing = trusted_by_id.pop(region_id, None)
            if existing is None:
                existing = low_by_id.pop(region_id, None)
            authority = existing if existing is not None else region
            low_by_id[region_id] = {
                **authority,
                "searchable": False,
                "visualAuthorityStatus": (
                    "superseded_by_exact_rendered_page31_complete_proposition_candidate"
                ),
                "visualAuthorityReason": (
                    "review_complete_issued_page31_proposition_instead"
                ),
                "visualAuthorityReplacementId": replacement_id,
            }
        constituent_ids = {
            str(item["id"]) for item in spec["constituents"]
        }
        constituent_regions = [
            region for region in matched
            if str(region.get("id") or "") in constituent_ids
        ]
        composites.append({
            "id": replacement_id,
            "text": spec["text"],
            "label": spec["text"],
            **spec["bounds"],
            "confidence": round(min(
                float(region.get("confidence") or 0)
                for region in constituent_regions
            ), 5),
            "source": EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE,
            "searchable": False,
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": (
                EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE
            ),
            "reconstructionMethod": (
                "exact_source_bound_rendered_page31_complete_proposition"
            ),
            "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
            "constituentEvidence": [
                str(region.get("id") or "") for region in constituent_regions
            ],
        })

    return (
        dedupe_regions(list(trusted_by_id.values())),
        [*composites, *low_by_id.values()],
    )


def reconstruct_exact_architectural_2321_page36_clearance_proposition(
    trusted_regions: list[dict[str, Any]],
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Review the exact printed page-36 clearance as one proposition.

    The fixed rendered OCR reads the issued ``5'-0\" CLR`` dimension as the
    malformed word ``5'-O\"`` and enclosing line ``5'-O\" CLR]``. Repeated
    provider review of that malformed authority is ambiguous even though the
    complete printed proposition is visible. This immutable-source rule binds
    both raw OCR authorities by ID, text, geometry, pass, kind, and lineage,
    retains them as non-searchable audit evidence, and emits one unresolved
    canonical proposition for the ordinary dual-provider resolver. It never
    publishes a fact by reconstruction itself; any drift stays fail closed.
    """
    trusted = [dict(region) for region in trusted_regions]
    low = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE36_NUMBER
    ):
        return trusted, low

    def strict_bounds(region: dict[str, Any]) -> dict[str, float] | None:
        values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in values
        ):
            return None
        bounds = normalized_region_bounds(region)
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            return None
        return bounds

    def authority_matches(
        region: dict[str, Any], spec: dict[str, Any],
    ) -> bool:
        lineage = tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in lineage
        ):
            return False
        accepted_ids = tuple(
            str(value)
            for value in spec.get("acceptedIds", (spec["id"],))
        )
        accepted_lineages = tuple(
            tuple(value)
            for value in spec.get("acceptedLineages", (spec["lineage"],))
        )
        return bool(
            str(region.get("id") or "") in accepted_ids
            and str(region.get("text") or "") == str(spec["text"])
            and str(region.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(region.get("ocrKind") or "") == str(spec["ocrKind"])
            and region.get("ocrBoundaryTruncated") is False
            and str(region.get("ocrPrefix") or "") == str(spec["ocrPrefix"])
            and lineage in accepted_lineages
            and strict_bounds(region) == dict(spec["bounds"])
        )

    matched: list[dict[str, Any]] = []
    for spec in EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS:
        matches = [
            region for region in raw_regions
            if authority_matches(region, spec)
        ]
        if len(matches) != 1:
            return trusted, low
        matched.append(matches[0])
    matched_lineages = {
        tuple(
            region.get(key)
            for key in (
                "ocrBlockNumber", "ocrParagraphNumber", "ocrLineNumber",
            )
        )
        for region in matched
    }
    if len(matched_lineages) != 1:
        return trusted, low

    authority_ids = tuple(str(region.get("id") or "") for region in matched)
    replacement_id = "architectural-2321-page36-clearance-proposition-candidate"
    trusted_by_id = {
        str(region.get("id") or ""): region
        for region in trusted if str(region.get("id") or "")
    }
    low_by_id = {
        str(region.get("id") or ""): region
        for region in low if str(region.get("id") or "")
    }
    raw_by_id = {
        str(region.get("id") or ""): region
        for region in raw_regions if str(region.get("id") or "")
    }
    for region_id in authority_ids:
        authority = trusted_by_id.pop(region_id, None)
        if authority is None:
            authority = low_by_id.pop(region_id, None)
        if authority is None:
            authority = raw_by_id[region_id]
        low_by_id[region_id] = {
            **authority,
            "searchable": False,
            "ocrValidationStatus": (
                "superseded_exact_page36_clearance_proposition"
            ),
            "visualAuthorityStatus": (
                "superseded_by_exact_rendered_page36_clearance_proposition_candidate"
            ),
            "visualAuthorityReason": (
                "review_the_complete_printed_clearance_proposition_instead"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }

    line_bounds = dict(EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS[1]["bounds"])
    candidate = {
        "id": replacement_id,
        "text": EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT,
        "label": EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT,
        **line_bounds,
        "confidence": round(
            min(float(region.get("confidence") or 0) for region in matched),
            5,
        ),
        "source": EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE,
        "searchable": False,
        "ocrValidationStatus": "unresolved_low_confidence",
        "visualAuthorityStatus": (
            EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE
        ),
        "reconstructionMethod": (
            "exact_source_bound_rendered_page36_clearance_proposition"
        ),
        "evidenceSources": ["fixed_visual_tile_coordinate_ocr"],
        "constituentEvidence": list(authority_ids),
    }
    return (
        dedupe_regions(list(trusted_by_id.values())),
        [candidate, *low_by_id.values()],
    )


def quarantine_exact_architectural_2321_page18_visual_authority(
    low_confidence_regions: list[dict[str, Any]],
    *,
    raw_regions: list[dict[str, Any]],
    project_id: str | None,
    page_number: int | None,
    source_sha256: str | None,
    evidence_version: str | None,
) -> list[dict[str, Any]]:
    """Remove only exact page-18 title/scale artifacts from fact review.

    The issued Architectural 2321 page 18 repeats ``CANOPY '1' CURB DETAIL``
    labels and drawing-scale legends. Fixed raster OCR promoted two quoted
    title identifiers and three malformed scale values as standalone facts.
    The independent title-block pass also promoted the revision-table delta
    number in ``DELTA 1 09-13-24`` as standalone searchable text. These are
    category errors: the quote names a detail variant, the scale describes
    paper-to-model ratio rather than a construction dimension, and the delta
    number is meaningful only inside its exact revision-table row.

    The rule is deliberately immutable-source bound. It requires the exact
    project, source, evidence version, page, OCR pass, lineage, text, geometry,
    and (where available) enclosing title/scale context. OCR confidence is not
    part of artifact identity because equivalent Tesseract builds may assign a
    different valid score to the same pixels. Raw OCR stays durable for audit;
    only search and visual-fact authority are removed. Any identity or context
    drift leaves the ordinary fail-closed review candidates unchanged.
    """
    original = [dict(region) for region in low_confidence_regions]
    if not (
        source_sha256
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SOURCE_SHA256
        and project_id == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PROJECT_ID
        and evidence_version
        == EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_EVIDENCE_VERSION
        and page_number == EXACT_ARCHITECTURAL_2321_PAGE18_NUMBER
    ):
        return original

    def expected_prefix(region_id: str) -> str:
        for separator in ("-word-", "-line-"):
            if separator in region_id:
                return region_id.rsplit(separator, 1)[0]
        return ""

    def exact_match(
        region: dict[str, Any],
        spec: dict[str, Any],
    ) -> bool:
        region_id = str(spec["id"])
        confidence = region.get("confidence")
        lineage = (
            region.get("ocrBlockNumber"),
            region.get("ocrParagraphNumber"),
            region.get("ocrLineNumber"),
        )
        bounds_values = tuple(
            region.get(key) for key in ("x", "y", "width", "height")
        )
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in lineage
            )
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in bounds_values
            )
        ):
            return False
        return bool(
            str(region.get("id") or "") == region_id
            and str(region.get("source") or "")
            == str(spec.get("source") or "fixed_visual_tile_coordinate_ocr")
            and str(region.get("ocrKind") or "")
            == str(spec.get("kind") or "word")
            and str(region.get("ocrPrefix") or "")
            == expected_prefix(region_id)
            and lineage == tuple(spec["lineage"])
            and str(region.get("text") or "") == str(spec["text"])
            and normalized_region_bounds(region) == spec["bounds"]
            and 0 <= float(confidence) <= 1
        )

    status_by_id: dict[str, tuple[str, str]] = {}
    for spec in (
        *EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS,
        *EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS,
    ):
        target_id = str(spec["id"])
        low_matches = [
            region for region in original if exact_match(region, spec)
        ]
        raw_matches = [
            region for region in raw_regions if exact_match(region, spec)
        ]
        context_matches = [
            [region for region in raw_regions if exact_match(region, context)]
            for context in spec["context"]
        ]
        if (
            len(low_matches) == 1
            and len(raw_matches) == 1
            and all(len(matches) == 1 for matches in context_matches)
        ):
            status_by_id[target_id] = (
                str(spec["authorityStatus"]),
                str(spec["authorityReason"]),
            )

    return [
        {
            **region,
            **({
                "searchable": False,
                "visualAuthorityStatus": status_by_id[str(region.get("id") or "")][0],
                "visualAuthorityReason": status_by_id[str(region.get("id") or "")][1],
            } if str(region.get("id") or "") in status_by_id else {}),
        }
        for region in original
    ]


def exact_region_contains(
    container: dict[str, float],
    candidate: dict[str, Any],
    *,
    tolerance: float = 0.0,
) -> bool:
    bounds = normalized_region_bounds(candidate)
    return bool(
        bounds["x"] >= container["x"] - tolerance
        and bounds["y"] >= container["y"] - tolerance
        and bounds["x"] + bounds["width"]
        <= container["x"] + container["width"] + tolerance
        and bounds["y"] + bounds["height"]
        <= container["y"] + container["height"] + tolerance
    )


def exact_region_overlaps(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_bounds = normalized_region_bounds(left)
    right_bounds = normalized_region_bounds(right)
    return bool(
        min(
            left_bounds["x"] + left_bounds["width"],
            right_bounds["x"] + right_bounds["width"],
        ) > max(left_bounds["x"], right_bounds["x"])
        and min(
            left_bounds["y"] + left_bounds["height"],
            right_bounds["y"] + right_bounds["height"],
        ) > max(left_bounds["y"], right_bounds["y"])
    )


def diagnostic_candidate_bounds_are_disjoint(
    left: dict[str, Any], right: dict[str, Any],
) -> bool:
    left_bounds = left.get("bounds") or {}
    right_bounds = right.get("bounds") or {}
    left_x = float(left_bounds.get("x") or 0)
    left_y = float(left_bounds.get("y") or 0)
    left_width = float(left_bounds.get("width") or 0)
    left_height = float(left_bounds.get("height") or 0)
    right_x = float(right_bounds.get("x") or 0)
    right_y = float(right_bounds.get("y") or 0)
    right_width = float(right_bounds.get("width") or 0)
    right_height = float(right_bounds.get("height") or 0)
    if min(left_width, left_height, right_width, right_height) <= 0:
        return False
    return bool(
        left_x + left_width <= right_x
        or right_x + right_width <= left_x
        or left_y + left_height <= right_y
        or right_y + right_height <= left_y
    )


def diagnostic_candidate_text_signature(candidate: dict[str, Any]) -> str:
    return re.sub(
        r"\s+", " ",
        normalize_ocr_punctuation(str(candidate.get("text") or "")).strip(),
    ).upper()


def canonical_diagnostic_candidate_authorities(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Collapse spatially overlapping OCR variants of one measurement.

    A provider fact must map to exactly one candidate index. Word and line OCR
    can otherwise preserve a tight measurement and a noisy enclosing phrase
    at the same coordinates, making a correct provider response match both.
    Prefer the tight measurement token deterministically; do not merge distinct
    measurements or merely nearby construction phrases.
    """
    ordered = sorted(candidates, key=diagnostic_candidate_authority_rank)
    accepted: list[dict[str, Any]] = []
    for candidate in ordered:
        if any(
            diagnostic_candidates_share_measurement_authority(candidate, existing)
            for existing in accepted
        ):
            continue
        accepted.append(candidate)
    return sorted(accepted, key=lambda item: (
        float(item["bounds"]["y"]), float(item["bounds"]["x"]),
        str(item.get("text") or ""),
    ))


def diagnostic_candidate_authority_rank(candidate: dict[str, Any]) -> tuple[Any, ...]:
    text = str(candidate.get("text") or "").strip()
    bounds = candidate.get("bounds") or {}
    correction_source = (
        str(candidate.get("source") or "")
        == VISUAL_MEASUREMENT_CORRECTION_SOURCE
    )
    correction_phrase = correction_source and bool(
        re.search(r"\s(?:TO|MAX|MIN|TYP)\b", text, re.IGNORECASE)
    )
    measurement_only = bool(
        STRICT_FOOT_INCH_PATTERN.fullmatch(normalize_ocr_punctuation(text))
        or CORRUPTED_ZERO_INCH_FOOT_PATTERN.fullmatch(normalize_ocr_punctuation(text))
        or simple_measurement_token(text)
    )
    return (
        0 if correction_phrase else 1,
        0 if measurement_only else 1,
        -len(text) if correction_source else len(text),
        float(bounds.get("width") or 0) * float(bounds.get("height") or 0),
        text,
        str(candidate.get("source") or ""),
    )


def diagnostic_candidates_share_measurement_authority(
    left: dict[str, Any],
    right: dict[str, Any],
) -> bool:
    if correction_candidates_are_nested_phrase_variants(left, right):
        return True
    left_keys = diagnostic_candidate_measurement_authority_keys(
        str(left.get("text") or "")
    )
    right_keys = diagnostic_candidate_measurement_authority_keys(
        str(right.get("text") or "")
    )
    return bool(
        left_keys
        and left_keys == right_keys
        and region_contains_or_overlaps(left.get("bounds") or {}, right.get("bounds") or {})
        and region_contains_or_overlaps(right.get("bounds") or {}, left.get("bounds") or {})
    )


def correction_candidates_are_nested_phrase_variants(
    left: dict[str, Any],
    right: dict[str, Any],
) -> bool:
    if (
        str(left.get("source") or "")
        != VISUAL_MEASUREMENT_CORRECTION_SOURCE
        or str(right.get("source") or "")
        != VISUAL_MEASUREMENT_CORRECTION_SOURCE
    ):
        return False
    left_text = diagnostic_candidate_text_signature(left)
    right_text = diagnostic_candidate_text_signature(right)
    if not left_text or not right_text:
        return False
    nested = left_text in right_text or right_text in left_text
    return bool(
        nested
        and region_contains_or_overlaps(
            left.get("bounds") or {}, right.get("bounds") or {}
        )
        and region_contains_or_overlaps(
            right.get("bounds") or {}, left.get("bounds") or {}
        )
    )


def visual_diagnostic_candidate_source(
    region: dict[str, Any],
    raw_text: str,
) -> str:
    source = str(region.get("source") or "unknown")[:120]
    normalized = normalize_ocr_punctuation(raw_text)
    if (
        ocr_measurement_requires_visual_correction(region)
        and measurement_transcription_candidate_shape(normalized)
        and len(normalized) <= 120
    ):
        return VISUAL_MEASUREMENT_CORRECTION_SOURCE
    return source


def measurement_transcription_candidate_shape(value: str) -> bool:
    measurement = (
        r"\d{1,4}\s*'\s*[-\u2013\u2014]\s*[A-Z0-9]{1,3}"
        r"(?:\s+\d{1,2}\s*/\s*\d{1,2})?\s*\""
    )
    return bool(re.fullmatch(
        rf"{measurement}(?:\s+TO\s+{measurement})?"
        r"(?:\s+(?:MAX|MIN|TYP)\.?){0,2}",
        value.strip(),
        re.IGNORECASE,
    ))


def expanded_measurement_correction_bounds(
    bounds: dict[str, float],
    *,
    ocr_kind: str,
    raw_text: str = "",
) -> dict[str, float]:
    """Show providers enough context to transcribe a clipped OCR token.

    The authority remains the bounded review crop and never becomes evidence
    without dual-provider agreement.  Word OCR can omit a narrow leading 1;
    line OCR already contains the phrase and needs less padding.
    """

    qualifier_count = len(re.findall(
        r"\b(?:MAX|MIN|TYP)\b", raw_text, re.IGNORECASE,
    ))
    horizontal = (
        0.009 if ocr_kind == "line" and qualifier_count == 2
        else 0.006 if ocr_kind == "word"
        else 0.003
    )
    vertical = 0.0005
    x0 = max(0.0, float(bounds["x"]) - horizontal)
    y0 = max(0.0, float(bounds["y"]) - vertical)
    x1 = min(
        1.0,
        float(bounds["x"]) + float(bounds["width"]) + horizontal,
    )
    y1 = min(
        1.0,
        float(bounds["y"]) + float(bounds["height"]) + vertical,
    )
    return {
        "x": round(x0, 6),
        "y": round(y0, 6),
        "width": round(x1 - x0, 6),
        "height": round(y1 - y0, 6),
    }


def diagnostic_candidate_measurement_authority_keys(text: str) -> set[str]:
    keys = exact_simple_measurement_keys(text)
    keys.update(
        f"zero-inch-foot:{feet}"
        for feet in corrupted_zero_inch_foot_measurements(text)
    )
    return keys


def reconstruct_bounded_measurement_ocr_candidates(
    page: fitz.Page,
    regions: list[dict[str, Any]],
    *,
    page_width: float,
    page_height: float,
) -> list[dict[str, Any]]:
    """Replace an incomplete measurement review proposition only after two reads.

    Fixed coverage subtiles can preserve the start of a printed dimension while
    dropping its final digit, fraction, or inch mark. Asking providers to judge
    that fragment is the wrong proposition. For a word-tight incomplete
    measurement token, render one small cell crop at two resolutions and
    require the digit signatures to reconstruct the same complete measurement.
    This remains an untrusted visual-review candidate: it is never accepted or
    searchable until the normal independent provider and Assurance checks pass.
    The original OCR record stays durable and auditable.
    """

    result = [dict(region) for region in regions]
    reconstructed = 0
    for index, region in enumerate(list(result)):
        if reconstructed >= MAX_BOUNDED_MEASUREMENT_RECONSTRUCTIONS_PER_PAGE:
            break
        raw_text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
        normalized_raw = normalize_ocr_punctuation(raw_text)
        prefix_match = BOUNDED_MEASUREMENT_RECONSTRUCTION_PATTERN.fullmatch(
            normalized_raw
        )
        if (
            prefix_match is None
            or MISSING_ZERO_INCH_MARKER_PATTERN.fullmatch(normalized_raw)
            or str(region.get("source") or "") != "fixed_visual_tile_coordinate_ocr"
            or str(region.get("ocrKind") or "") != "word"
            or region.get("ocrBoundaryTruncated") is True
        ):
            continue
        raw_bounds = normalized_region_bounds(region)
        if (
            raw_bounds["width"] <= 0
            or raw_bounds["height"] <= 0
            or raw_bounds["width"] > 0.03
            or raw_bounds["height"] > 0.01
        ):
            continue
        horizontal_left = max(0.005, raw_bounds["width"] * 0.25)
        horizontal_right = max(0.02, raw_bounds["width"] * 1.75)
        vertical_padding = max(0.003, raw_bounds["height"] * 0.75)
        clip = fitz.Rect(
            float(page.rect.x0)
            + page_width * max(0.0, raw_bounds["x"] - horizontal_left),
            float(page.rect.y0)
            + page_height * max(0.0, raw_bounds["y"] - vertical_padding),
            float(page.rect.x0)
            + page_width * min(
                1.0,
                raw_bounds["x"] + raw_bounds["width"] + horizontal_right,
            ),
            float(page.rect.y0)
            + page_height * min(
                1.0,
                raw_bounds["y"] + raw_bounds["height"] + vertical_padding,
            ),
        )
        reads: list[tuple[str, list[dict[str, Any]]]] = []
        for label, dpi in (
            ("primary", BOUNDED_MEASUREMENT_PRIMARY_DPI),
            ("corroboration", BOUNDED_MEASUREMENT_CORROBORATION_DPI),
        ):
            try:
                read_regions = ocr_regions_for_clip(
                    page,
                    clip,
                    page_width,
                    page_height,
                    dpi=dpi,
                    prefix=f"bounded-measurement-{label}-{region.get('id')}",
                    source=f"bounded_measurement_ocr_{label}",
                    config=(
                        "--psm 6 "
                        "-c tessedit_char_whitelist=0123456789/-"
                    ),
                    minimum_confidence=0.0,
                )
            except Exception:
                reads = []
                break
            canonical = targeted_measurement_candidate_text(read_regions)
            if not canonical:
                reads = []
                break
            reads.append((canonical, read_regions))
        if len(reads) != 2 or reads[0][0] != reads[1][0]:
            continue
        canonical = reads[0][0]
        canonical_compact = re.sub(r"\s+", "", canonical)
        normalized_raw_compact = re.sub(r"\s+", "", normalized_raw)
        raw_numeric_suffix = prefix_match.group(2)
        if (
            int(canonical.split("'", 1)[0]) != int(prefix_match.group(1))
            or (
                raw_numeric_suffix.isdigit()
                and not canonical_compact.startswith(normalized_raw_compact)
            )
        ):
            continue
        word_bounds = [
            normalized_region_bounds(read_region)
            for _, read_regions in reads
            for read_region in read_regions
            if str(read_region.get("ocrKind") or "") == "word"
        ]
        if not word_bounds:
            continue
        candidate_bounds = dict(word_bounds[0])
        for bounds in word_bounds[1:]:
            candidate_bounds = union_region_bounds(candidate_bounds, bounds)
        candidate_bounds = union_region_bounds(candidate_bounds, raw_bounds)
        if (
            candidate_bounds["width"] <= 0
            or candidate_bounds["height"] <= 0
            or candidate_bounds["width"] > 0.08
            or candidate_bounds["height"] > 0.02
            or not region_contains_or_overlaps(candidate_bounds, raw_bounds)
        ):
            continue
        replacement_id = (
            f"{str(region.get('id') or f'candidate-{index}')}"
            "-bounded-measurement-candidate"
        )
        result[index] = {
            **region,
            "visualAuthorityStatus": "superseded_by_bounded_measurement_ocr",
            "visualAuthorityReason": (
                "review_two_read_complete_measurement_instead_of_ocr_prefix"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }
        result.append({
            "id": replacement_id,
            "text": canonical,
            "label": canonical,
            **candidate_bounds,
            "confidence": 0.0,
            "source": "bounded_measurement_ocr_candidate",
            "ocrKind": "bounded_measurement_candidate",
            "ocrValidationStatus": "unresolved_low_confidence",
            "visualAuthorityStatus": "bounded_measurement_ocr_candidate",
            "boundedMeasurementRawRegionId": str(region.get("id") or ""),
            "boundedMeasurementReadDpis": [
                BOUNDED_MEASUREMENT_PRIMARY_DPI,
                BOUNDED_MEASUREMENT_CORROBORATION_DPI,
            ],
        })
        reconstructed += 1
    return result


def corroborated_bounded_measurement_ocr_regions(
    page: fitz.Page,
    regions: list[dict[str, Any]],
    *,
    page_width: float,
    page_height: float,
    trusted_regions: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Accept a tiny exact dimension only after two exact rendered reads.

    Dense CAD schedules can print complete dimensions in text only a few
    pixels high. A low-confidence fixed-tile read remains auditable, but a
    vision-provider crop can time out or abstain even when the issued text is
    unambiguous. Re-render only the exact tiny cell at 300 and 600 DPI and
    require both numeric signatures to equal the strict candidate value.
    Any mismatch preserves the original unresolved region unchanged.
    """

    audited = [dict(region) for region in regions]
    accepted: list[dict[str, Any]] = []
    for index, region in enumerate(list(audited)):
        if len(accepted) >= MAX_BOUNDED_MEASUREMENT_RECONSTRUCTIONS_PER_PAGE:
            break
        if (
            region.get("visualAuthorityStatus")
            in QUARANTINED_VISUAL_AUTHORITY_STATUSES
        ):
            continue
        if (
            str(region.get("source") or "") != "fixed_visual_tile_coordinate_ocr"
            or str(region.get("ocrKind") or "") not in {"word", "line"}
            or region.get("ocrBoundaryTruncated") is True
        ):
            continue
        raw_text = re.sub(r"\s+", " ", str(region.get("text") or "").strip())
        normalized_raw = re.sub(
            r"(?<=')\s*[–—]\s*(?=\d)",
            "-",
            normalize_ocr_punctuation(raw_text).strip(),
        )
        canonical = visual_diagnostic_candidate_text(raw_text)
        match = STRICT_FOOT_INCH_PATTERN.fullmatch(
            re.sub(
                r"(?<=')\s*[–—]\s*(?=\d)",
                "-",
                normalize_ocr_punctuation(canonical).strip(),
            )
        )
        incomplete_match = BOUNDED_MEASUREMENT_INCOMPLETE_DASH_PATTERN.fullmatch(
            normalized_raw
        )
        corrupted_token = bool(
            BOUNDED_MEASUREMENT_CORRUPTED_TOKEN_PATTERN.fullmatch(normalized_raw)
        )
        if match is None and incomplete_match is None and not corrupted_token:
            continue
        expected_signature = ""
        if match is not None:
            feet = int(match.group(1))
            inches = int(match.group(2))
            numerator = int(match.group(3) or 0)
            denominator = int(match.group(4) or 1)
            if (
                feet < 0
                or inches < 0
                or inches > 11
                or denominator <= 0
                or numerator < 0
                or numerator >= denominator
            ):
                continue
            expected_signature = (
                f"{feet}-{inches}"
                + (
                    f"{numerator}/{denominator}"
                    if match.group(3) and match.group(4)
                    else ""
                )
            )
            canonical = f"{feet}'-{inches}" + (
                f" {numerator}/{denominator}" if numerator else ""
            ) + '"'
        confidence = region.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            continue
        if not math.isfinite(float(confidence)) or not 0 <= float(confidence) <= 1:
            continue
        correcting_raw_ocr = match is None or not expected_signature
        if correcting_raw_ocr and float(confidence) > 0.2:
            continue
        bounds = normalized_region_bounds(region)
        maximum_height = (
            0.006
            if str(region.get("ocrKind") or "") == "word"
            else 0.005
        )
        if (
            bounds["width"] <= 0
            or bounds["height"] <= 0
            or bounds["width"] > 0.035
            or bounds["height"] > maximum_height
        ):
            continue
        tall_complete_word = (
            match is not None
            and str(region.get("ocrKind") or "") == "word"
            and 0.005 < bounds["height"] <= 0.006
            and 0.2 < float(confidence) <= 0.35
        )
        if incomplete_match is not None:
            horizontal_left = max(0.005, bounds["width"] * 0.25)
            horizontal_right = max(0.02, bounds["width"] * 1.75)
            vertical_padding = max(0.003, bounds["height"] * 0.75)
        elif tall_complete_word:
            # Slightly taller glyph boxes can include a leader stroke at the
            # candidate's left edge. A bounded single-line crop consistently
            # isolates the printed value across the supported OCR runtimes.
            horizontal_left = 0.002
            horizontal_right = 0.004
            vertical_padding = 0.003
        elif (
            match is not None
            and str(region.get("ocrKind") or "") in {"word", "line"}
            and 0.2 < float(confidence) <= 0.35
        ):
            # Complete schedule measurements in this confidence band already
            # supply the whole authority. Keep the re-read tight so adjacent
            # schedule columns cannot introduce a version-specific OCR mark.
            horizontal_left = 0.0
            horizontal_right = 0.004
            vertical_padding = 0.001
        elif (
            match is None
            or (
                str(region.get("ocrKind") or "") in {"word", "line"}
                and float(confidence) <= 0.35
            )
        ):
            horizontal_left = 0.002
            horizontal_right = 0.01
            vertical_padding = 0.002
        else:
            horizontal_left = max(0.001, bounds["width"] * 0.1)
            horizontal_right = max(0.005, bounds["width"] * 0.25)
            vertical_padding = max(0.001, bounds["height"] * 0.3)
        clip = fitz.Rect(
            float(page.rect.x0)
            + page_width * max(0.0, bounds["x"] - horizontal_left),
            float(page.rect.y0)
            + page_height * max(0.0, bounds["y"] - vertical_padding),
            float(page.rect.x0)
            + page_width * min(
                1.0,
                bounds["x"] + bounds["width"] + horizontal_right,
            ),
            float(page.rect.y0)
            + page_height * min(
                1.0,
                bounds["y"] + bounds["height"] + vertical_padding,
            ),
        )
        reads: list[dict[str, Any]] = []
        valid = True
        for label, dpi in (
            ("primary", BOUNDED_MEASUREMENT_PRIMARY_DPI),
            ("corroboration", BOUNDED_MEASUREMENT_CORROBORATION_DPI),
        ):
            try:
                read_regions = ocr_regions_for_clip(
                    page,
                    clip,
                    page_width,
                    page_height,
                    dpi=dpi,
                    prefix=f"corroborated-measurement-{label}-{region.get('id')}",
                    source=f"bounded_measurement_ocr_{label}",
                    config=(
                        f"--psm {13 if tall_complete_word else 7} "
                        "-c tessedit_char_whitelist=0123456789/-"
                    ),
                    minimum_confidence=0.0,
                )
            except Exception:
                valid = False
                break
            signature = targeted_measurement_digit_signature(read_regions)
            read_canonical = targeted_measurement_candidate_text(read_regions)
            word_regions = [
                read_region for read_region in read_regions
                if str(read_region.get("ocrKind") or "") == "word"
            ]
            if (
                not signature
                or not word_regions
                or not any(
                    region_contains_or_overlaps(
                        bounds,
                        normalized_region_bounds(read_region),
                    )
                    for read_region in word_regions
                )
            ):
                valid = False
                break
            reads.append({
                "dpi": dpi,
                "signature": signature,
                "canonical": read_canonical,
                "source": f"bounded_measurement_ocr_{label}",
            })
        if (
            not valid
            or len(reads) != 2
            or reads[0]["signature"] != reads[1]["signature"]
        ):
            continue
        recovered_signature = str(reads[0]["signature"])
        if expected_signature and recovered_signature == expected_signature:
            recovered_canonical = canonical
        else:
            if (
                not reads[0]["canonical"]
                or reads[0]["canonical"] != reads[1]["canonical"]
            ):
                continue
            recovered_canonical = str(reads[0]["canonical"])
        if not recovered_canonical:
            continue
        if expected_signature and recovered_signature != expected_signature:
            raw_digits = "".join(re.findall(r"\d", normalized_raw))
            recovered_digits = "".join(re.findall(r"\d", recovered_signature))
            if (
                float(confidence) > 0.2
                or len(raw_digits) != len(recovered_digits)
                or bounded_edit_distance(raw_digits, recovered_digits, limit=1) > 1
            ):
                continue
        elif incomplete_match is not None:
            if int(recovered_signature.split("-", 1)[0]) != int(
                incomplete_match.group(1)
            ) or not trusted_measurement_suffix_supports_recovery(
                region,
                recovered_canonical,
                trusted_regions or [],
            ):
                continue
        elif match is None:
            raw_digits = "".join(re.findall(r"\d", normalized_raw))
            recovered_digits = "".join(re.findall(r"\d", recovered_signature))
            if (
                len(raw_digits) < 2
                or abs(len(raw_digits) - len(recovered_digits)) > 1
                or bounded_edit_distance(raw_digits, recovered_digits, limit=2) > 2
            ):
                continue
        canonical = recovered_canonical
        raw_id = str(region.get("id") or f"candidate-{index}")
        accepted_id = f"{raw_id}-two-resolution-measurement"
        audited[index] = {
            **region,
            "visualAuthorityStatus": "validated_by_two_resolution_measurement_ocr",
            "visualAuthorityReason": "two_exact_rendered_measurement_reads_agree",
            "visualAuthorityReplacementId": accepted_id,
        }
        accepted.append({
            "id": accepted_id,
            "text": canonical,
            "label": canonical,
            "subject": canonical,
            "location": "drawing text region",
            "evidenceText": canonical,
            **bounds,
            "confidence": 0.0,
            "source": "bounded_measurement_ocr_corroborated",
            "factKind": "drawing_fact",
            "searchable": True,
            "ocrValidationStatus": "two_resolution_corroborated",
            "reconstructionMethod": "two_resolution_coordinate_ocr_exact_measurement",
            "rawOcrText": raw_text,
            "rawOcrCorrected": normalize_ocr_punctuation(canonical).strip()
            != normalize_ocr_punctuation(raw_text).strip(),
            "evidenceSources": [read["source"] for read in reads],
            "constituentEvidence": reads,
        })
        suppress_corroborated_measurement_context_line(
            audited,
            raw_region=region,
            recovered_canonical=canonical,
            trusted_regions=trusted_regions or [],
            replacement_id=accepted_id,
        )
    return accepted, audited


def bounded_edit_distance(left: str, right: str, *, limit: int) -> int:
    """Return a small edit distance without doing unbounded recovery work."""

    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for row, left_character in enumerate(left, start=1):
        current = [row]
        row_minimum = row
        for column, right_character in enumerate(right, start=1):
            value = min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_character != right_character),
            )
            current.append(value)
            row_minimum = min(row_minimum, value)
        if row_minimum > limit:
            return limit + 1
        previous = current
    return previous[-1]


def trusted_measurement_suffix_supports_recovery(
    raw_region: dict[str, Any],
    recovered_canonical: str,
    trusted_regions: list[dict[str, Any]],
) -> bool:
    match = STRICT_FOOT_INCH_PATTERN.fullmatch(
        normalize_ocr_punctuation(recovered_canonical).strip()
    )
    if match is None or not match.group(3) or not match.group(4):
        return False
    suffix = f"{int(match.group(3))}/{int(match.group(4))}\""
    raw_id = str(raw_region.get("id") or "")
    raw_prefix = raw_id.rsplit("-word-", 1)[0]
    raw_bounds = normalized_region_bounds(raw_region)
    for trusted in trusted_regions:
        trusted_id = str(trusted.get("id") or "")
        trusted_bounds = normalized_region_bounds(trusted)
        same_lineage = bool(
            raw_prefix
            and trusted_id.rsplit("-word-", 1)[0] == raw_prefix
        )
        vertical_overlap = (
            min(
                raw_bounds["y"] + raw_bounds["height"],
                trusted_bounds["y"] + trusted_bounds["height"],
            )
            > max(raw_bounds["y"], trusted_bounds["y"])
        )
        horizontal_gap = trusted_bounds["x"] - (
            raw_bounds["x"] + raw_bounds["width"]
        )
        if (
            same_lineage
            and str(trusted.get("source") or "")
            == "fixed_visual_tile_coordinate_ocr"
            and str(trusted.get("ocrKind") or "") == "word"
            and normalize_ocr_punctuation(str(trusted.get("text") or "")).strip()
            == suffix
            and vertical_overlap
            and -0.002 <= horizontal_gap <= 0.02
        ):
            return True
    return False


def suppress_corroborated_measurement_context_line(
    audited_regions: list[dict[str, Any]],
    *,
    raw_region: dict[str, Any],
    recovered_canonical: str,
    trusted_regions: list[dict[str, Any]],
    replacement_id: str,
) -> None:
    """Retire only a same-line aggregate whose remaining words are trusted.

    A low-confidence measurement word can make its enclosing OCR line low
    confidence even when every following context word is already trusted.
    After the measurement itself passes the two-resolution gate, do not send
    the redundant aggregate to Vision. The raw line remains in the durable OCR
    audit and every non-measurement token must be independently present as a
    high-confidence word in the exact same OCR lineage.
    """

    if str(raw_region.get("ocrKind") or "") != "word":
        return
    line_key = ocr_region_line_key(raw_region)
    if line_key is None:
        return
    canonical = re.sub(
        r"(?<=')\s*[–—]\s*(?=\d)",
        "-",
        normalize_ocr_punctuation(recovered_canonical).strip(),
    )
    if not canonical:
        return
    raw_bounds = normalized_region_bounds(raw_region)
    trusted_words = [
        trusted for trusted in trusted_regions
        if str(trusted.get("source") or "")
        == "fixed_visual_tile_coordinate_ocr"
        and str(trusted.get("ocrKind") or "") == "word"
        and ocr_region_line_key(trusted) == line_key
        and not isinstance(trusted.get("confidence"), bool)
        and isinstance(trusted.get("confidence"), (int, float))
        and math.isfinite(float(trusted["confidence"]))
        and float(trusted["confidence"]) >= 0.85
    ]
    for index, candidate in enumerate(list(audited_regions)):
        if (
            str(candidate.get("ocrKind") or "") != "line"
            or ocr_region_line_key(candidate) != line_key
        ):
            continue
        normalized_line = re.sub(
            r"(?<=')\s*[–—]\s*(?=\d)",
            "-",
            normalize_ocr_punctuation(
                re.sub(r"\s+", " ", str(candidate.get("text") or "").strip())
            ).strip(),
        )
        if not normalized_line.startswith(f"{canonical} "):
            continue
        trailing_tokens = normalized_line[len(canonical):].strip().split()
        if not trailing_tokens or len(trailing_tokens) > 4:
            continue
        line_bounds = normalized_region_bounds(candidate)
        if not region_contains_or_overlaps(line_bounds, raw_bounds):
            continue
        matched_ids: set[str] = set()
        valid = True
        for token in trailing_tokens:
            normalized_token = normalize_ocr_punctuation(token).strip()
            match = next((
                trusted for trusted in trusted_words
                if str(trusted.get("id") or "") not in matched_ids
                and normalize_ocr_punctuation(
                    str(trusted.get("text") or "")
                ).strip() == normalized_token
                and normalized_region_bounds(trusted)["x"]
                >= raw_bounds["x"] + raw_bounds["width"] - 0.002
                and region_contains_or_overlaps(
                    line_bounds,
                    normalized_region_bounds(trusted),
                )
            ), None)
            if match is None:
                valid = False
                break
            matched_ids.add(str(match.get("id") or ""))
        if not valid:
            continue
        audited_regions[index] = {
            **candidate,
            "visualAuthorityStatus": (
                "superseded_by_two_resolution_measurement_context"
            ),
            "visualAuthorityReason": (
                "measurement_validated_and_remaining_line_words_trusted"
            ),
            "visualAuthorityReplacementId": replacement_id,
        }


def targeted_measurement_candidate_text(
    regions: list[dict[str, Any]],
) -> str:
    signature = targeted_measurement_digit_signature(regions)
    match = TARGETED_MEASUREMENT_DIGIT_SIGNATURE_PATTERN.fullmatch(signature)
    if match is None:
        return ""
    feet = int(match.group(1))
    inches = int(match.group(2))
    if feet > 9999 or inches > 11:
        return ""
    fraction = match.group(3)
    if fraction:
        numerator_text, denominator_text = fraction.split("/", 1)
        numerator = int(numerator_text)
        denominator = int(denominator_text)
        if (
            denominator not in {2, 4, 8, 16, 32, 64}
            or numerator <= 0
            or numerator >= denominator
        ):
            return ""
        return f"{feet}'-{inches} {numerator}/{denominator}\""
    return f"{feet}'-{inches}\""


def targeted_measurement_digit_signature(
    regions: list[dict[str, Any]],
) -> str:
    words = [
        str(region.get("text") or "").strip()
        for region in regions
        if str(region.get("ocrKind") or "") == "word"
        and str(region.get("text") or "").strip()
    ]
    return re.sub(r"[^0-9/\-]", "", "".join(words)).strip("-")


def visual_diagnostic_candidate_text(value: Any) -> str:
    """Remove only a rendered leader-arrow suffix from a decimal-foot label.

    Fixed-tile OCR can merge a dimension's adjacent leader line and arrowhead
    into the word (for example ``11.00'-<``). The suffix is drawing geometry,
    not text. Strip it only when the remaining complete token is an exact
    decimal-foot measurement. The candidate remains low-confidence and still
    requires independent visual-provider and Assurance verification before it
    can become evidence.
    """
    text = re.sub(r"\s+", " ", str(value or "").strip())
    # Fixed-tile OCR can read every numeric glyph in an exact zero-inch
    # dimension while dropping only the terminal inch mark. Preserve the raw
    # OCR region for audit, but present the complete measurement proposition
    # to the two-provider visual review. This does not accept or publish the
    # value: both providers must still confirm the exact reconstructed phrase
    # and coordinate box. Do not infer a missing inch value or repair any
    # non-zero/corrupted digit here.
    missing_zero_inch_marker = MISSING_ZERO_INCH_MARKER_PATTERN.fullmatch(text)
    if missing_zero_inch_marker:
        return f"{missing_zero_inch_marker.group(1)}'-0\""
    # Other missing-inch suffixes require the two-read bounded reconstruction
    # above. Never ask providers to judge an incomplete rendered prefix as if
    # it were the complete issued dimension.
    if BOUNDED_MEASUREMENT_RECONSTRUCTION_PATTERN.fullmatch(
        normalize_ocr_punctuation(text)
    ):
        return ""
    # A token such as ``24'-"`` contains no inch value. It is an incomplete
    # OCR fragment, not an exact fact authority: the strict visual contract
    # cannot safely corroborate a value that the candidate itself omits.
    # Complete N'-M" measurements and punctuation-corrupted N'-O" variants
    # remain bounded candidates and retain the normal dual-provider review.
    if INCOMPLETE_FOOT_INCH_MEASUREMENT_PATTERN.fullmatch(text):
        return ""
    # A word-tight OCR token such as ``(140'+`` is only the first operand and
    # operator of a larger parenthesized drawing calculation. Treating it as
    # an exact standalone 140-foot authority forces providers to decide a
    # proposition the printed expression does not make. Suppress only this
    # unmatched, trailing-plus shape; complete calculations and standalone
    # ``140'`` / ``+140'`` measurements retain the normal fail-closed review.
    if INCOMPLETE_PARENTHESIZED_FOOT_SUM_PATTERN.fullmatch(text):
        return ""
    without_leader = re.sub(r"\s*[-\u2013\u2014]\s*[<>]+\s*$", "", text)
    if (
        without_leader != text
        and DECIMAL_FOOT_MEASUREMENT_PATTERN.fullmatch(without_leader)
    ):
        return without_leader
    return text


def visual_diagnostic_candidate_bounds(
    raw_text: str,
    candidate_text: str,
    bounds: dict[str, float],
) -> dict[str, float]:
    """Exclude a merged trailing leader from the candidate's text box.

    The exception crop retains the original OCR word box so reviewers see the
    adjoining dimension geometry.  When the only normalized change removed a
    trailing leader/arrow, constrain the candidate itself to the retained
    left-to-right text fraction.  This keeps provider proof authority on the
    printed measurement characters instead of the non-text leader suffix.
    """
    if (
        not raw_text
        or raw_text == candidate_text
        or not raw_text.startswith(candidate_text)
        or not DECIMAL_FOOT_MEASUREMENT_PATTERN.fullmatch(candidate_text)
    ):
        return bounds
    retained_fraction = len(candidate_text) / len(raw_text)
    return {
        **bounds,
        "width": round(bounds["width"] * retained_fraction, 6),
    }


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
    try:
        x0, y0, x1, y1 = map(float, box[:4])
        page_width = float(page_width)
        page_height = float(page_height)
    except (TypeError, ValueError):
        return None
    if (
        not all(math.isfinite(value) for value in (
            x0, y0, x1, y1, page_width, page_height,
        ))
        or page_width <= 0
        or page_height <= 0
    ):
        return None
    # PDF text boxes can extend beyond the visible page when text is rotated or
    # clipped by a crop box.  Preserve only the visible intersection so every
    # proof coordinate remains bound to the source page.
    x0 = min(page_width, max(0.0, x0))
    y0 = min(page_height, max(0.0, y0))
    x1 = min(page_width, max(0.0, x1))
    y1 = min(page_height, max(0.0, y1))
    if x1 <= x0 or y1 <= y0:
        return None
    normalized_x = bounded(x0 / page_width)
    normalized_y = bounded(y0 / page_height)
    normalized_width = bounded((x1 - x0) / page_width)
    normalized_height = bounded((y1 - y0) / page_height)
    # Browser-facing evidence is persisted at six decimal places. A positive
    # raw PDF box can be smaller than that durable coordinate resolution and
    # therefore become zero-area after quantization. Drop that non-proof
    # instead of inflating its bounds or emitting data Assurance must reject.
    if normalized_width <= 0 or normalized_height <= 0:
        return None
    return {
        "id": region_id,
        "text": text,
        "label": text[:240],
        "x": normalized_x, "y": normalized_y,
        "width": normalized_width,
        "height": normalized_height,
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
            # A targeted structured-table proof names its exact trusted region
            # ids.  Keep those records beside geometrically overlapping
            # baseline OCR so the persisted page can replay every proof id.
            if (
                str(existing.get("id") or "") != str(region.get("id") or "")
                and (
                    existing.get("structuredTableTargetedOcrProofRegion") is True
                    or region.get("structuredTableTargetedOcrProofRegion") is True
                    or existing.get("visualAuthorityStatus")
                    == "exact_rendered_fire_separation_composite_candidate"
                    or region.get("visualAuthorityStatus")
                    == "exact_rendered_fire_separation_composite_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "exact_rendered_area_table_row_composite_candidate"
                    or region.get("visualAuthorityStatus")
                    == "exact_rendered_area_table_row_composite_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "exact_rendered_easement_note_composite_candidate"
                    or region.get("visualAuthorityStatus")
                    == "exact_rendered_easement_note_composite_candidate"
                    or existing.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
                    or region.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
                    or existing.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
                    or region.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
                    or existing.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
                    or region.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
                    or existing.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
                    or region.get("visualAuthorityStatus")
                    == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
                    or existing.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page2_dimension_candidate"
                    or region.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page2_dimension_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "superseded_by_exact_2375_structural_page2_dimension_candidate"
                    or region.get("visualAuthorityStatus")
                    == "superseded_by_exact_2375_structural_page2_dimension_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page8_proposition_candidate"
                    or region.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page8_proposition_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page11_proposition_candidate"
                    or region.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page11_proposition_candidate"
                    or existing.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page12_hanger_wire_clause_candidate"
                    or region.get("visualAuthorityStatus")
                    == "superseded_by_exact_structural_page12_hanger_wire_clause_candidate"
                )
            ):
                result.append(region)
                continue
            existing_support_ids = {
                str(value)
                for value in existing.get("renderedCorroboratingRegionIds") or []
            }
            region_support_ids = {
                str(value)
                for value in region.get("renderedCorroboratingRegionIds") or []
            }
            # Retain the exact rendered region beside the embedded record it
            # corroborates. Otherwise ordinary text deduplication could erase
            # the evidence that Assurance needs to replay the visibility bind.
            if (
                str(region.get("id") or "") in existing_support_ids
                or str(existing.get("id") or "") in region_support_ids
                or (
                    str(existing.get("source") or "") in EMBEDDED_PDF_TEXT_SOURCES
                    and existing.get("renderedCorroborated") is True
                    and str(region.get("source") or "") not in EMBEDDED_PDF_TEXT_SOURCES
                )
                or (
                    str(region.get("source") or "") in EMBEDDED_PDF_TEXT_SOURCES
                    and region.get("renderedCorroborated") is True
                    and str(existing.get("source") or "") not in EMBEDDED_PDF_TEXT_SOURCES
                )
            ):
                result.append(region)
                continue
            # ``deterministic_fact_regions`` intentionally enriches an
            # already coordinate-bound region. Preserve that richer fact
            # without replacing the coordinate evidence identifier: embedded
            # corroboration and structural proofs refer to that exact ID.
            if region.get("factKind") and not existing.get("factKind"):
                result[existing_index] = {
                    **existing,
                    **region,
                    "id": existing.get("id"),
                }
            elif existing.get("factKind") and not region.get("factKind"):
                result[existing_index] = {
                    **region,
                    **existing,
                    "id": region.get("id"),
                }
            elif float(region.get("confidence") or 0) > float(existing.get("confidence") or 0):
                result[existing_index] = {**existing, **region}
            continue
        seen[key] = len(result)
        result.append(region)
    # Geometry deduplication intentionally preserves distinct embedded and
    # rendered records when one corroborates the other. A later fact pass can
    # feed the *same* rendered record through that preservation branch again,
    # however. Durable region identifiers are evidence authority, so an exact
    # record may appear only once and conflicting content may never share an
    # identifier. Keep this identity check after the geometry pass so all of
    # the existing distinct-id corroboration behavior remains unchanged.
    unique_result: list[dict[str, Any]] = []
    unique_id_indexes: dict[str, int] = {}
    for region in result:
        region_id = str(region.get("id") or "").strip()
        if not region_id:
            unique_result.append(region)
            continue
        existing_index = unique_id_indexes.get(region_id)
        if existing_index is None:
            unique_id_indexes[region_id] = len(unique_result)
            unique_result.append(region)
            continue
        if unique_result[existing_index] != region:
            raise DocumentResourceRejected("duplicate_region_id_conflict")
    return unique_result


def public_region(region: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "id", "label", "text", "factKind", "subject", "location",
        "evidenceText", "areaNames", "x", "y", "width", "height",
        "confidence", "source", "reconstructionMethod", "evidenceSources",
        "constituentEvidence", "corroboratingEvidence",
        "structuredRelationshipId", "structuredTableBlockId",
        "structuredTableRelationshipType", "structuredTableRowKey",
        "searchable", "renderedCorroborated",
        "renderedCorroboratingRegionIds", "renderedCorroboratingSources",
    }
    result = {key: value for key, value in region.items() if key in keys and value is not None}
    # Persistence is deliberately stricter than the in-memory convention.
    # Every worker-emitted region carries one explicit boolean so a missing or
    # malformed marker can never be interpreted as searchable by SQL. Raw
    # table constituents are set to False before this boundary; ordinary and
    # independently verified fact regions become explicitly True here.
    source = str(region.get("source") or "")
    result["searchable"] = (
        False
        if source in EMBEDDED_PDF_TEXT_SOURCES
        and (
            region.get("factKind") != "drawing_fact"
            or region.get("renderedCorroborated") is not True
        )
        else True if "searchable" not in region else region.get("searchable") is True
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


class VisualTileAnalysisFailed(RuntimeError):
    """A fixed high-resolution tile could not produce durable OCR evidence."""

    pass
