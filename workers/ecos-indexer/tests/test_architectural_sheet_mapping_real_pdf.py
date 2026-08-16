import hashlib
import os
import unittest
from pathlib import Path

import pymupdf as fitz

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    native_text_regions,
    page_bound_sheet_identity_ocr_regions,
    title_block_ocr_regions,
    trusted_ocr_regions,
)
from ecos_indexer.sheet_mapping import analyze_coordinate_sheet, map_sheet


ARCHITECTURAL_PDF = Path(os.getenv(
    "ECOS_ARCHITECTURAL_REGRESSION_PDF",
    "/tmp/vitruvius-arch-compare.WjRHDO/managed-architecture.pdf",
))
ARCHITECTURAL_SHA256 = (
    "75118aa5adf2696692db1413898f505bcda27128fe96977e68f217bd88e9e41e"
)
EXPECTED_BOOKMARKLESS_IDENTITIES = {
    1: "A-0.0",
    25: "A-1.18",
    34: "A-2.2A",
    36: "A-2.3A",
    44: "A-2.11",
    45: "A-2.12",
    55: "A-4.4",
    56: "A-4.5",
    57: "A-4.6",
}


@unittest.skipUnless(
    ARCHITECTURAL_PDF.exists(),
    "Exact managed 2375 Architectural source PDF is not present on this machine.",
)
class ExactArchitecturalSheetMappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = ARCHITECTURAL_PDF.read_bytes()
        if hashlib.sha256(payload).hexdigest() != ARCHITECTURAL_SHA256:
            raise AssertionError("Managed Architectural regression PDF SHA-256 changed.")
        cls.document = fitz.open(stream=payload, filetype="pdf")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.document.close()

    def test_exact_page_bound_title_cells_recover_all_nine_missing_identities(self) -> None:
        self.assertEqual(self.document.page_count, 68)
        structural_map = document_sheet_identity_map(self.document)
        self.assertTrue(
            set(EXPECTED_BOOKMARKLESS_IDENTITIES).isdisjoint(structural_map),
            "Regression pages must be proved from their own title cells, not bookmarks.",
        )

        for page_number, expected_sheet in EXPECTED_BOOKMARKLESS_IDENTITIES.items():
            with self.subTest(page_number=page_number, expected_sheet=expected_sheet):
                page = self.document[page_number - 1]
                regions = page_bound_sheet_identity_ocr_regions(
                    page, float(page.rect.width), float(page.rect.height),
                )
                self.assertEqual([region["text"] for region in regions], [expected_sheet])
                analysis = analyze_coordinate_sheet(
                    regions, float(page.rect.width), float(page.rect.height),
                )
                self.assertIsNotNone(analysis.strong_candidate)
                assert analysis.strong_candidate is not None
                self.assertEqual(analysis.strong_candidate.sheet_number, expected_sheet)
                mapping = map_sheet(
                    regions, float(page.rect.width), float(page.rect.height),
                )
                self.assertEqual(mapping["sheetMappingStatus"], "unverified")
                self.assertIsNone(mapping["sheetNumber"])
                self.assertEqual(mapping["sheetMappingSource"], "coordinate_text")
                self.assertEqual(
                    mapping["sheetMappingCandidates"][0]["sheetNumber"],
                    expected_sheet,
                )

    def test_noisy_full_title_block_cannot_replace_exact_suffix_identities(self) -> None:
        for page_number, expected_sheet in ((34, "A-2.2A"), (36, "A-2.3A")):
            with self.subTest(page_number=page_number):
                page = self.document[page_number - 1]
                page_width = float(page.rect.width)
                page_height = float(page.rect.height)
                raw_ocr = [
                    *title_block_ocr_regions(page, page_width, page_height),
                    *page_bound_sheet_identity_ocr_regions(page, page_width, page_height),
                ]
                trusted, _rejected = trusted_ocr_regions(raw_ocr)
                analysis = analyze_coordinate_sheet(
                    [*native_text_regions(page, page_width, page_height), *trusted],
                    page_width,
                    page_height,
                )
                self.assertIsNotNone(analysis.strong_candidate)
                assert analysis.strong_candidate is not None
                self.assertEqual(analysis.strong_candidate.sheet_number, expected_sheet)
                mapping = map_sheet(
                    [*native_text_regions(page, page_width, page_height), *trusted],
                    page_width,
                    page_height,
                )
                self.assertEqual(mapping["sheetMappingStatus"], "unverified")
                self.assertIsNone(mapping["sheetNumber"])
                self.assertEqual(
                    mapping["sheetMappingCandidates"][0]["sheetNumber"],
                    expected_sheet,
                )
                self.assertNotEqual(
                    mapping["sheetMappingCandidates"][0]["sheetNumber"],
                    "DATE06",
                )
                self.assertNotEqual(
                    mapping["sheetMappingCandidates"][0]["sheetNumber"],
                    "A-2",
                )

    def test_malformed_or_truncated_real_title_cells_remain_fail_closed(self) -> None:
        # These pages have authoritative bookmarks in production.  Their OCR
        # reads are intentionally distorted or truncated, so the OCR-only
        # title-cell rule must not manufacture a second identity.
        for page_number in (2, 6, 10):
            with self.subTest(page_number=page_number):
                page = self.document[page_number - 1]
                self.assertEqual(
                    page_bound_sheet_identity_ocr_regions(
                        page, float(page.rect.width), float(page.rect.height),
                    ),
                    [],
                )


if __name__ == "__main__":
    unittest.main()
