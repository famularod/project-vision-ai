import os
import unittest
from pathlib import Path

import pymupdf as fitz

from ecos_indexer.assurance import valid_verified_sheet_provenance
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import native_text_regions


SOURCE_PATH = Path(os.getenv(
    "ECOS_2321_LANDSCAPE_SOURCE",
    str(
        Path.home()
        / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
        / "2321 approved"
        / "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf"
    ),
))


@unittest.skipUnless(SOURCE_PATH.exists(), "Exact 2321 Landscape PDF is not present.")
class ExactLandscapeAssuranceTests(unittest.TestCase):
    def test_all_six_native_title_band_identities_survive_public_coordinate_rounding(self):
        document = fitz.open(SOURCE_PATH)
        try:
            identity_map = document_sheet_identity_map(document)
            self.assertEqual(set(identity_map), set(range(1, 7)))
            for page_number in range(1, 7):
                with self.subTest(page_number=page_number):
                    page = document[page_number - 1]
                    identity = identity_map[page_number]
                    regions = native_text_regions(
                        page,
                        float(page.rect.width),
                        float(page.rect.height),
                    )
                    self.assertTrue(valid_verified_sheet_provenance(
                        {
                            "sheetNumber": identity.sheet_number,
                            "sheetMappingSource": identity.source,
                            "sheetMappingEvidence": [
                                item.as_dict() for item in identity.evidence
                            ],
                        },
                        regions=regions,
                        expected_page_number=page_number,
                    ))
        finally:
            document.close()


if __name__ == "__main__":
    unittest.main()
