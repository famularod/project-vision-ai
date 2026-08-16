"""Opt-in exact-SHA regression for hosted job 7ed9097d page 11."""

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
PAGE_NUMBER = 11
RUN_EXACT = os.getenv("ECOS_RUN_7ED9097D_PAGE11_PDF_TESTS") == "1"
LIVE_RAW_REGIONS = (
    {
        "id": "visual-tile-667:0:333:500-subtile-0:2-word-13",
        "text": "62'—",
        "x": 0.94303, "y": 0.11451,
        "width": 0.010606, "height": 0.003922,
        "confidence": 0.13,
        "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "word", "ocrBoundaryTruncated": False,
    },
    {
        "id": "visual-tile-333:500:333:500-subtile-1:1-word-8",
        "text": "65'-6\"",
        "x": 0.496667, "y": 0.700784,
        "width": 0.011818, "height": 0.003137,
        "confidence": 0.0,
        "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "word", "ocrBoundaryTruncated": False,
    },
)
LIVE_TRUSTED_SUFFIX = {
    "id": "visual-tile-667:0:333:500-subtile-0:2-word-17",
    "text": "7/8\"",
    "x": 0.960303, "y": 0.114118,
    "width": 0.010909, "height": 0.004314,
    "confidence": 0.71,
    "source": "fixed_visual_tile_coordinate_ocr",
    "ocrKind": "word",
}


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_7ED9097D_PAGE11_PDF_TESTS=1 with the exact source.",
)
class Exact7ed9097dPage11ProductionTests(unittest.TestCase):
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
            cls.live_accepted, cls.live_audited = (
                corroborated_bounded_measurement_ocr_regions(
                    page,
                    list(LIVE_RAW_REGIONS),
                    page_width=float(page.rect.width),
                    page_height=float(page.rect.height),
                    trusted_regions=[LIVE_TRUSTED_SUFFIX],
                )
            )
            cls.result = extract_page(
                page,
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER
                ),
            )
        finally:
            document.close()
        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(cls.result["unresolved"]),
        )

    def test_live_checkpoint_measurements_are_recovered_by_two_exact_reads(self) -> None:
        self.assertEqual(
            ["62'-2 7/8\"", "65'-8\""],
            [item["text"] for item in self.live_accepted],
        )
        self.assertTrue(all(
            item.get("rawOcrCorrected") is True
            and item.get("evidenceSources") == [
                "bounded_measurement_ocr_primary",
                "bounded_measurement_ocr_corroboration",
            ]
            for item in self.live_accepted
        ))
        self.assertEqual(
            ["validated_by_two_resolution_measurement_ocr"] * 2,
            [item.get("visualAuthorityStatus") for item in self.live_audited],
        )

    def test_fresh_page_has_no_paid_visual_queue_and_assurance_accepts(self) -> None:
        self.assertEqual([], self.result["unresolved"])
        recovered = [
            item.get("text") for item in self.result["final"]["regions"]
            if item.get("source") == "bounded_measurement_ocr_corroborated"
        ]
        self.assertIn("65'-8\"", recovered)
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
            replay = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER
                ),
                visual_tile_checkpoint=checkpoint,
            )
        finally:
            document.close()
        self.assertEqual(self.result["final"], replay["final"])
        self.assertEqual(self.result["unresolved"], replay["unresolved"])


if __name__ == "__main__":
    unittest.main()
