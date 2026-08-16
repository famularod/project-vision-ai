"""Opt-in exact-SHA regression for hosted job 7ed9097d page 8."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    corroborated_bounded_measurement_ocr_regions,
    extract_page,
    open_pdf,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_7ED9097D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "001423a1550ba1b786616a49ff1a80d2f2b4fc0ff21354091adde4da8e7eda44"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 8
RUN_EXACT = os.getenv("ECOS_RUN_7ED9097D_PAGE8_PDF_TESTS") == "1"
LIVE_RAW_REGIONS = (
    {
        "id": "page8-dimension-1", "text": "2'-0",
        "x": 0.132727, "y": 0.143137,
        "width": 0.010909, "height": 0.003922,
        "confidence": 0.12, "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "word", "ocrBoundaryTruncated": False,
    },
    {
        "id": "page8-dimension-2", "text": "14'-4 3/8\"",
        "x": 0.883939, "y": 0.128627,
        "width": 0.028182, "height": 0.004314,
        "confidence": 0.14, "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "line", "ocrBoundaryTruncated": False,
    },
    {
        "id": "page8-dimension-3", "text": "2'-2 13/16\"",
        "x": 0.040303, "y": 0.785098,
        "width": 0.031212, "height": 0.004314,
        "confidence": 0.18, "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "line", "ocrBoundaryTruncated": False,
    },
)
EXPECTED_TEXTS = ["2'-0\"", "14'-4 3/8\"", "2'-2 13/16\""]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_7ED9097D_PAGE8_PDF_TESTS=1 with the exact source.",
)
class Exact7ed9097dPage8ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(source).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued 7ed9097d source SHA changed: {actual_sha}")
        document = open_pdf(source)
        try:
            if document.page_count != 32:
                raise AssertionError(f"Expected 32 pages, found {document.page_count}")
            page = document[PAGE_NUMBER - 1]
            cls.structural_identity = document_sheet_identity_map(document).get(
                PAGE_NUMBER,
            )
            cls.accepted, cls.audited = (
                corroborated_bounded_measurement_ocr_regions(
                    page,
                    list(LIVE_RAW_REGIONS),
                    page_width=float(page.rect.width),
                    page_height=float(page.rect.height),
                )
            )
            cls.result = extract_page(
                page,
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
            )
        finally:
            document.close()

        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )

    def test_all_three_live_dimensions_require_matching_two_resolution_reads(self) -> None:
        self.assertEqual(EXPECTED_TEXTS, [item["text"] for item in self.accepted])
        self.assertTrue(all(
            item.get("source") == "bounded_measurement_ocr_corroborated"
            and item.get("searchable") is True
            and item.get("evidenceSources") == [
                "bounded_measurement_ocr_primary",
                "bounded_measurement_ocr_corroboration",
            ]
            for item in self.accepted
        ))
        self.assertEqual(
            ["validated_by_two_resolution_measurement_ocr"] * 3,
            [item.get("visualAuthorityStatus") for item in self.audited],
        )

    def test_fresh_page_has_no_paid_visual_queue_and_assurance_accepts(self) -> None:
        self.assertEqual([], self.result["unresolved"])
        corroborated = [
            item for item in self.result["final"]["regions"]
            if item.get("source") == "bounded_measurement_ocr_corroborated"
        ]
        self.assertIn("2'-0\"", [item.get("text") for item in corroborated])
        raw = [
            item for item in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if item.get("visualAuthorityStatus")
            == "validated_by_two_resolution_measurement_ocr"
        ]
        self.assertIn("2'-0", [item.get("text") for item in raw])
        self.assertTrue(self.assurance["accepted"], self.assurance["failureCodes"])
        self.assertEqual([], self.assurance["failureCodes"])

    def test_visual_checkpoint_replay_is_identical(self) -> None:
        regions = self.result["ocr"]["visualTileRegions"]
        proofs = self.result["ocr"]["visualTileProofs"]
        checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=regions,
            proofs=proofs,
        )
        resumed_regions, resumed_proofs = resumed_visual_tile_work(
            checkpoint,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
        )
        self.assertEqual(regions, resumed_regions)
        self.assertEqual(proofs, resumed_proofs)

        source = SOURCE_PATH.read_bytes()
        document = open_pdf(source)
        try:
            replayed = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=self.structural_identity,
                visual_tile_checkpoint=checkpoint,
            )
        finally:
            document.close()
        self.assertEqual(self.result["final"], replayed["final"])
        self.assertEqual(self.result["unresolved"], replayed["unresolved"])
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )


if __name__ == "__main__":
    unittest.main()
