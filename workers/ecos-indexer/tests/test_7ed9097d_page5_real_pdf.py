"""Opt-in exact-SHA regression for hosted job 7ed9097d page 5."""

import hashlib
import io
import os
import unittest
from pathlib import Path

from PIL import Image

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    crop_page,
    validated_visual_resolution,
    visual_review_bounds,
    visual_review_tile_scale,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_7ED9097D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "001423a1550ba1b786616a49ff1a80d2f2b4fc0ff21354091adde4da8e7eda44"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 5
RUN_EXACT = os.getenv("ECOS_RUN_7ED9097D_PAGE5_PDF_TESTS") == "1"
TARGET_BOUNDS = {
    "x": 0.51303,
    "y": 0.774118,
    "width": 0.01,
    "height": 0.003137,
}


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_7ED9097D_PAGE5_PDF_TESTS=1 with the exact source.",
)
class Exact7ed9097dPage5ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        cls.source = source
        actual_sha = hashlib.sha256(source).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued 7ed9097d source SHA changed: {actual_sha}")
        document = open_pdf(source)
        try:
            if document.page_count != 32:
                raise AssertionError(f"Expected 32 pages, found {document.page_count}")
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER,
                ),
            )
        finally:
            document.close()

    def test_raw_incomplete_ocr_is_retained_for_audit(self) -> None:
        matches = [
            region
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("text") == "82'-0"
            and {key: region.get(key) for key in TARGET_BOUNDS} == TARGET_BOUNDS
        ]
        self.assertEqual(1, len(matches))
        self.assertEqual("unresolved_low_confidence", matches[0]["ocrValidationStatus"])

    def test_visual_authority_is_the_complete_printed_dimension_only(self) -> None:
        candidates = [
            candidate
            for unresolved in self.result["unresolved"]
            if str(unresolved.get("regionKey") or "").startswith("low-confidence-ocr-")
            for candidate in unresolved.get("diagnosticCandidates") or []
            if candidate.get("bounds") == TARGET_BOUNDS
        ]
        self.assertEqual(1, len(candidates))
        self.assertEqual("82'-0\"", candidates[0]["text"])
        self.assertNotIn("82'-0", [
            candidate.get("text")
            for unresolved in self.result["unresolved"]
            for candidate in unresolved.get("diagnosticCandidates") or []
        ])
        self.assertFalse(any(
            "82'-0" in str(region.get("text") or "")
            for region in self.result["final"]["regions"]
            if region.get("searchable") is not False
        ))

    def test_only_two_provider_confirmation_of_complete_phrase_resolves(self) -> None:
        target = next(
            unresolved
            for unresolved in self.result["unresolved"]
            if unresolved.get("diagnosticCandidates") == [{
                "text": "82'-0\"",
                "source": "fixed_visual_tile_coordinate_ocr",
                "confidence": 0.0,
                "bounds": TARGET_BOUNDS,
            }]
        )

        def provider_payload(phrase: str) -> dict[str, object]:
            return {
                "schemaVersion": VISUAL_SCHEMA_VERSION,
                "candidateAgreementMethod": "dual_provider_candidate_index_v1",
                "visionProvider": "gemini",
                "model": "gemini-3.6-flash",
                "assuranceProvider": "openai",
                "assuranceModel": "gpt-4.1",
                "primaryAcceptedCandidateIndexes": [0],
                "primaryAcceptedCandidateIndexesValid": True,
                "assuranceAcceptedCandidateIndexes": [0],
                "assuranceAcceptedCandidateIndexesValid": True,
                "primaryDismissedCandidateIndexes": [],
                "primaryDismissedCandidateIndexesValid": True,
                "assuranceDismissedCandidateIndexes": [],
                "assuranceDismissedCandidateIndexesValid": True,
                "dismissedCandidateIndexes": [],
                "facts": [{
                    "subject": phrase,
                    "location": "",
                    "statement": phrase,
                    "evidenceText": phrase,
                    "confidence": 0.95,
                    "bounds": {"x": 514, "y": 775, "width": 8, "height": 2},
                }],
            }

        self.assertFalse(
            validated_visual_resolution(provider_payload("82'-0"), target).resolved
        )
        resolved = validated_visual_resolution(
            provider_payload("82'-0\""), target,
        )
        self.assertTrue(resolved.resolved)
        self.assertEqual("82'-0\"", resolved.evidence["facts"][0]["statement"])
        self.assertEqual("gemini", resolved.evidence["visionProvider"])
        self.assertEqual("openai", resolved.evidence["assuranceProvider"])

    def test_right_dimension_review_tile_has_legible_pixel_height(self) -> None:
        candidate = {"text": "20'-0\"", "bounds": {
            "x": 0.713939,
            "y": 0.764706,
            "width": 0.012121,
            "height": 0.003137,
        }}
        review_bounds = visual_review_bounds(candidate["bounds"], [candidate])
        self.assertEqual(6.0, visual_review_tile_scale([candidate]))
        document = open_pdf(self.source)
        try:
            payload = crop_page(
                document[PAGE_NUMBER - 1],
                review_bounds,
                scale=visual_review_tile_scale([candidate]),
            )
        finally:
            document.close()
        with Image.open(io.BytesIO(payload)) as image:
            image.load()
            self.assertGreaterEqual(image.width, 470)
            self.assertGreaterEqual(image.height, 50)


if __name__ == "__main__":
    unittest.main()
