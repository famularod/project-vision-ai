"""Opt-in exact-SHA regression for hosted job 7ed9097d page 6."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    extract_page,
    open_pdf,
    reconstruct_bounded_measurement_ocr_candidates,
    unresolved_regions,
)
from ecos_indexer.visual import VISUAL_SCHEMA_VERSION, validated_visual_resolution


SOURCE_PATH_VALUE = os.getenv("ECOS_7ED9097D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "001423a1550ba1b786616a49ff1a80d2f2b4fc0ff21354091adde4da8e7eda44"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 6
RUN_EXACT = os.getenv("ECOS_RUN_7ED9097D_PAGE6_PDF_TESTS") == "1"
LIVE_RAW_REGIONS = [
    {
        "id": "visual-tile-0:0:333:500-subtile-0:1-word-38",
        "text": "16'-",
        "x": 0.206364,
        "y": 0.121569,
        "width": 0.010909,
        "height": 0.003922,
        "confidence": 0.34,
        "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "word",
        "ocrBoundaryTruncated": False,
        "ocrValidationStatus": "unresolved_low_confidence",
    },
    {
        "id": "visual-tile-667:0:333:500-subtile-0:1-word-35",
        "text": "14'-5",
        "x": 0.883939,
        "y": 0.121569,
        "width": 0.013636,
        "height": 0.003922,
        "confidence": 0.25,
        "source": "fixed_visual_tile_coordinate_ocr",
        "ocrKind": "word",
        "ocrBoundaryTruncated": False,
        "ocrValidationStatus": "unresolved_low_confidence",
    },
]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_7ED9097D_PAGE6_PDF_TESTS=1 with the exact source.",
)
class Exact7ed9097dPage6ProductionTests(unittest.TestCase):
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
            cls.reconstructed = reconstruct_bounded_measurement_ocr_candidates(
                page,
                LIVE_RAW_REGIONS,
                page_width=float(page.rect.width),
                page_height=float(page.rect.height),
            )
            cls.result = extract_page(
                page,
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER,
                ),
            )
        finally:
            document.close()

    def test_exact_live_fragments_require_two_read_complete_candidates(self) -> None:
        self.assertEqual(
            ["16'-", "14'-5"],
            [item["text"] for item in self.reconstructed[:2]],
        )
        self.assertEqual(
            ["superseded_by_bounded_measurement_ocr"] * 2,
            [item.get("visualAuthorityStatus") for item in self.reconstructed[:2]],
        )
        candidates = self.reconstructed[2:]
        self.assertEqual(
            ["16'-0\"", "14'-5 1/2\""],
            [item["text"] for item in candidates],
        )
        self.assertTrue(all(
            item.get("source") == "bounded_measurement_ocr_candidate"
            and item.get("searchable") is not True
            for item in candidates
        ))

    def test_only_complete_candidates_enter_provider_review(self) -> None:
        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=self.reconstructed,
        )
        diagnostics = [
            candidate
            for item in unresolved
            for candidate in item.get("diagnosticCandidates") or []
        ]
        self.assertEqual(
            ["16'-0\"", "14'-5 1/2\""],
            [item["text"] for item in diagnostics],
        )
        self.assertFalse(any(
            item["text"] in {"16'-", "14'-5"} for item in diagnostics
        ))

    def test_exact_fact_needs_both_provider_identities(self) -> None:
        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=self.reconstructed,
        )
        target = next(
            item
            for item in unresolved
            if item.get("diagnosticCandidates", [{}])[0].get("text") == "16'-0\""
        )
        candidate_bounds = target["diagnosticCandidates"][0]["bounds"]
        proof = {
            "x": round(candidate_bounds["x"] * 1000),
            "y": round(candidate_bounds["y"] * 1000),
            "width": max(1, round(candidate_bounds["width"] * 1000) - 1),
            "height": max(1, round(candidate_bounds["height"] * 1000) - 1),
        }

        def payload(assurance_provider: str) -> dict[str, object]:
            return {
                "schemaVersion": VISUAL_SCHEMA_VERSION,
                "candidateAgreementMethod": "dual_provider_candidate_index_v1",
                "visionProvider": "gemini",
                "model": "gemini-3.6-flash",
                "assuranceProvider": assurance_provider,
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
                    "subject": "16'-0\"",
                    "location": "",
                    "statement": "16'-0\"",
                    "evidenceText": "16'-0\"",
                    "confidence": 0.95,
                    "bounds": proof,
                }],
            }

        self.assertFalse(validated_visual_resolution(payload("gemini"), target).resolved)
        accepted = validated_visual_resolution(payload("openai"), target)
        self.assertTrue(accepted.resolved)
        self.assertEqual("16'-0\"", accepted.evidence["facts"][0]["statement"])

    def test_fresh_extraction_never_reviews_an_incomplete_measurement_prefix(self) -> None:
        diagnostics = [
            candidate.get("text")
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ]
        self.assertFalse(any(
            text in {"16'-", "14'-5", "20'-om"} for text in diagnostics
        ))
        self.assertTrue(all(
            item.get("searchable") is not True
            for item in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if item.get("source") == "bounded_measurement_ocr_candidate"
        ))


if __name__ == "__main__":
    unittest.main()
