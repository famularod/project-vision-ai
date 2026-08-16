"""Opt-in exact-SHA regression for hosted job e175 page 1."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf


SOURCE_PATH_VALUE = os.getenv("ECOS_E175_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 1
RUN_EXACT = os.getenv("ECOS_RUN_E175_PAGE1_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_E175_PAGE1_PDF_TESTS=1 with the exact e175 source.",
)
class ExactE175Page1ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(source).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued e175 source SHA changed: {actual_sha}")

        document = open_pdf(source)
        try:
            structural_identity = document_sheet_identity_map(document).get(
                PAGE_NUMBER,
            )
            if structural_identity is None:
                raise AssertionError("Expected the page-1 structural bookmark identity")
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=structural_identity,
            )
        finally:
            document.close()

        # This page has one independent low-confidence dimension queued for
        # visual review.  The mapping regression is complete once that normal
        # queue is cleared, so exercise the standard Assurance boundary with
        # the title-block conflict absent and the independent queue resolved.
        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )

    def test_e00_is_verified_by_structural_and_exact_rendered_evidence(self) -> None:
        page = self.result["final"]
        validated = next(
            region for region in self.result["ocr"]["regions"]
            if region.get("id") == "sheet-identity-page-bound-validated-1"
        )
        self.assertEqual(validated["text"], "E-0.0")
        self.assertEqual(
            validated["ocrValidationStatus"],
            "corroborated_vertical_title_cell",
        )
        self.assertEqual(
            validated["sheetIdentityEvidence"]["ocrSources"],
            [
                "sheet_identity_ocr_vertical_value_primary",
                "sheet_identity_ocr_vertical_cell_corroboration",
            ],
        )

        structural_identity = self.result["deterministic"][
            "documentStructuralIdentity"
        ]
        self.assertEqual(structural_identity["sheetNumber"], "E-0.0")
        self.assertEqual(structural_identity["source"], "pdf_bookmark")
        self.assertEqual(structural_identity["evidence"][0]["text"], "E01-E0.0")
        self.assertTrue(
            structural_identity["evidence"][0]["renderedCorroborated"],
        )
        self.assertEqual(
            structural_identity["evidence"][0]["renderedCorroboratingRegionIds"],
            ["sheet-identity-page-bound-validated-1"],
        )

        self.assertEqual(page["sheetNumber"], "E-0.0")
        self.assertEqual(page["sheetMappingStatus"], "verified")
        self.assertNotEqual(page["sheetMappingStatus"], "conflicted")
        self.assertEqual(page["sheetMappingSource"], "pdf_bookmark")

        mapping_evidence = page["sheetMappingEvidence"]
        self.assertEqual(len(mapping_evidence), 1)
        self.assertEqual(mapping_evidence[0]["text"], "E01-E0.0")
        self.assertTrue(mapping_evidence[0]["renderedCorroborated"])
        self.assertEqual(
            mapping_evidence[0]["renderedCorroboratingSources"],
            ["sheet_identity_ocr_page_bound_validated"],
        )

    def test_title_conflict_is_absent_and_assurance_accepts(self) -> None:
        self.assertFalse(any(
            exception.get("key") == "title-block"
            for exception in self.result["unresolved"]
        ))
        self.assertTrue(self.assurance["accepted"], self.assurance["failureCodes"])
        self.assertEqual(self.assurance["failureCodes"], [])


if __name__ == "__main__":
    unittest.main()
