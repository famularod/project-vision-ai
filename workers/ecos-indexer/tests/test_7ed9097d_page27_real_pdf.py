"""Opt-in exact-SHA regression for hosted job 7ed9097d page 27."""

import copy
import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    extract_page,
    open_pdf,
    resumed_visual_tile_work,
    visual_subtile_analysis_sha256,
    visual_tile_analysis_sha256,
    visual_tile_checkpoint_payload,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_7ED9097D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "001423a1550ba1b786616a49ff1a80d2f2b4fc0ff21354091adde4da8e7eda44"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 27
RUN_EXACT = os.getenv("ECOS_RUN_7ED9097D_PAGE27_PDF_TESTS") == "1"
TARGET_WORD_ID = "visual-tile-333:0:333:500-subtile-1:2-word-128"
TARGET_CONTEXT_ID = "visual-tile-333:0:333:500-subtile-1:2-word-129"
TARGET_LINE_ID = "visual-tile-333:0:333:500-subtile-1:2-line-25"


def rehash_visual_checkpoint(
    regions: list[dict[str, object]],
    proofs: list[dict[str, object]],
) -> None:
    by_id = {str(region["id"]): region for region in regions}
    for proof in proofs:
        proof_region_ids = [str(value) for value in proof["analysisRegionIds"]]
        proof["analysisSha256"] = visual_tile_analysis_sha256(
            str(proof["tileKey"]),
            [by_id[region_id] for region_id in proof_region_ids],
        )
        for subtile in proof["analysisSubtileProofs"]:
            subtile_region_ids = [
                str(value) for value in subtile["analysisRegionIds"]
            ]
            subtile["analysisSha256"] = visual_subtile_analysis_sha256(
                [by_id[region_id] for region_id in subtile_region_ids]
            )


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_7ED9097D_PAGE27_PDF_TESTS=1 with the exact source.",
)
class Exact7ed9097dPage27ProductionTests(unittest.TestCase):
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
            baseline = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER
                ),
            )
        finally:
            document.close()

        # The deployed Tesseract 5.3 checkpoint is the production authority.
        # Pin its exact target records because newer local Tesseract versions
        # vary only the confidence and trailing colon for these same boxes.
        regions = copy.deepcopy(baseline["ocr"]["visualTileRegions"])
        proofs = copy.deepcopy(baseline["ocr"]["visualTileProofs"])
        by_id = {str(region.get("id") or ""): region for region in regions}
        required = {TARGET_WORD_ID, TARGET_CONTEXT_ID, TARGET_LINE_ID}
        if not required.issubset(by_id):
            raise AssertionError(
                f"Exact page-27 OCR target changed: {required - set(by_id)}"
            )
        by_id[TARGET_WORD_ID].update({"text": "12’—0\"", "confidence": 0.28})
        by_id[TARGET_CONTEXT_ID].update({"text": "COVERAGE", "confidence": 0.93})
        by_id[TARGET_LINE_ID].update({
            "text": "12’—0\" COVERAGE",
            "confidence": 0.28,
        })
        rehash_visual_checkpoint(regions, proofs)
        forced_checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=regions,
            proofs=proofs,
        )
        resumed_regions, resumed_proofs = resumed_visual_tile_work(
            forced_checkpoint,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
        )
        if resumed_regions != regions or resumed_proofs != proofs:
            raise AssertionError("Rehashed exact page-27 checkpoint was not accepted")

        document = open_pdf(source)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER
                ),
                visual_tile_checkpoint=forced_checkpoint,
            )
        finally:
            document.close()

    def test_coverage_measurement_is_locally_corroborated_not_queued(self) -> None:
        recovered = [
            item for item in self.result["final"]["regions"]
            if item.get("source") == "bounded_measurement_ocr_corroborated"
            and item.get("text") == "12'-0\""
        ]
        self.assertEqual(1, len(recovered))
        queued_text = " ".join(
            str(candidate.get("text") or "")
            for exception in self.result["unresolved"]
            for candidate in exception.get("diagnosticCandidates") or []
        )
        self.assertNotIn("COVERAGE", queued_text)

    def test_raw_measurement_and_context_line_remain_auditable(self) -> None:
        audited = {
            item.get("text"): item.get("visualAuthorityStatus")
            for item in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if item.get("text") in {"12’—0\"", "12’—0\" COVERAGE"}
        }
        self.assertEqual(
            {
                "12’—0\"": "validated_by_two_resolution_measurement_ocr",
                "12’—0\" COVERAGE": (
                    "superseded_by_two_resolution_measurement_context"
                ),
            },
            audited,
        )

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

        document = open_pdf(SOURCE_PATH.read_bytes())
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
