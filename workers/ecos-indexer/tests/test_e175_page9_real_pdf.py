"""Opt-in exact-SHA regression for hosted job e175 page 9."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    extract_page,
    open_pdf,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_E175_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 9
RUN_EXACT = os.getenv("ECOS_RUN_E175_PAGE9_PDF_TESTS") == "1"


def normalized_text(value: object) -> str:
    return (
        str(value or "")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201d", '"')
        .replace("\u201c", '"')
    )


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_E175_PAGE9_PDF_TESTS=1 with the exact e175 source.",
)
class ExactE175Page9ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(source).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued e175 source SHA changed: {actual_sha}")

        document = open_pdf(source)
        try:
            cls.structural_identity = document_sheet_identity_map(document).get(
                PAGE_NUMBER,
            )
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
            )
        finally:
            document.close()

        # Exercise the standard Assurance boundary after all normal visual
        # queues have been resolved. The scale legend itself must not create a
        # visual queue because its RHS is not a standalone drawing fact.
        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )

    def test_scale_legend_raw_ocr_is_retained_but_has_no_visual_authority(self) -> None:
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        expected = {
            "visual-tile-667:500:333:500-subtile-2:1-line-28": {
                "text": "SCALE: 1/8\" =1'-0\"",
                "bounds": {
                    "x": 0.790476, "y": 0.964,
                    "width": 0.04873, "height": 0.006889,
                },
            },
            "visual-tile-667:500:333:500-subtile-2:1-word-123": {
                "text": "=1'-0\"",
                "bounds": {
                    "x": 0.823492, "y": 0.964,
                    "width": 0.015714, "height": 0.005556,
                },
            },
        }
        by_id = {str(region.get("id") or ""): region for region in rejected}
        for region_id, expectation in expected.items():
            with self.subTest(region_id=region_id):
                region = by_id[region_id]
                self.assertEqual(expectation["text"], normalized_text(region["text"]))
                self.assertEqual(
                    expectation["bounds"],
                    {
                        key: region[key]
                        for key in ("x", "y", "width", "height")
                    },
                )
                self.assertEqual(
                    "unresolved_low_confidence",
                    region["ocrValidationStatus"],
                )
                self.assertEqual(
                    "quarantined_scale_legend",
                    region["visualAuthorityStatus"],
                )

        visual_candidates = [
            candidate
            for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertFalse(any(
            normalized_text(candidate.get("text")) == "=1'-0\""
            and candidate.get("bounds") == expected[
                "visual-tile-667:500:333:500-subtile-2:1-word-123"
            ]["bounds"]
            for candidate in visual_candidates
        ))
        self.assertFalse(any(
            item.get("bounds") == expected[
                "visual-tile-667:500:333:500-subtile-2:1-line-28"
            ]["bounds"]
            for item in self.result["unresolved"]
        ))

        searchable_regions = [
            region for region in self.result["final"]["regions"]
            if region.get("searchable") is True
        ]
        self.assertFalse(any(
            normalized_text(region.get("text"))
            in {"SCALE: 1/8\" =1'-0\"", "=1'-0\""}
            for region in searchable_regions
        ))
        self.assertNotIn(
            "SCALE: 1/8\" =1'-0\"",
            normalized_text(self.result["final"]["text"]),
        )
        self.assertNotIn(
            "=1'-0\"",
            normalized_text(self.result["final"]["text"]),
        )

    def test_visual_tile_checkpoint_replay_is_exact_and_deterministic(self) -> None:
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
        self.assertEqual(6, len(resumed_proofs))
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

    def test_normal_queues_clear_and_assurance_accepts(self) -> None:
        self.assertEqual([], self.result["unresolved"])
        self.assertTrue(self.assurance["accepted"], self.assurance["failureCodes"])
        self.assertEqual([], self.assurance["failureCodes"])


if __name__ == "__main__":
    unittest.main()
