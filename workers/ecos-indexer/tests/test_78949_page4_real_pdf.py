"""Opt-in exact-PDF regression for hosted job 78949 page 4.

Set ``ECOS_RUN_78949_PAGE4_PDF_TESTS=1`` to execute the complete production
extraction and Assurance path against the SHA-pinned issued HPS drawing.
"""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page, valid_region
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, native_text_regions, open_pdf


SOURCE_PATH = Path(os.getenv(
    "ECOS_78949_REGRESSION_PDF",
    str(
        Path.home()
        / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
        / "2321 approved/HPSDrawing-PLZCorp-R1.pdf"
    ),
))
SOURCE_SHA256 = "e358e80453258b8ab27dfcae9045108fd0c2d86db3dbd8766ede2d9709e97665"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 4
RUN_EXACT = os.getenv("ECOS_RUN_78949_PAGE4_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH.exists(),
    "Set ECOS_RUN_78949_PAGE4_PDF_TESTS=1 with the exact HPS source to run.",
)
class Exact78949Page4ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(payload).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued HPS source changed: {actual_sha}")
        document = open_pdf(payload)
        try:
            if document.page_count != 9:
                raise AssertionError(f"Expected 9 HPS pages, found {document.page_count}")
            page = document[PAGE_NUMBER - 1]
            cls.native_regions = native_text_regions(
                page,
                float(page.rect.width),
                float(page.rect.height),
            )
            cls.result = extract_page(
                page,
                actual_sha,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER,
                ),
            )
        finally:
            document.close()

    def test_native_extraction_drops_sub_quantization_zero_area_boxes(self) -> None:
        self.assertTrue(self.native_regions)
        self.assertTrue(all(valid_region(region) for region in self.native_regions))
        self.assertFalse(any(
            str(region.get("id") or "").startswith(("native-129-", "native-130-"))
            for region in self.native_regions
        ))

    def test_full_page_assurance_accepts_with_resolvable_corroboration(self) -> None:
        page = self.result["final"]
        self.assertEqual(self.result["unresolved"], [])
        self.assertTrue(all(valid_region(region) for region in page["regions"]))
        region_by_id = {region["id"]: region for region in page["regions"]}
        ceiling_fact = next(
            region for region in page["regions"]
            if region.get("factKind") == "drawing_fact"
            and "CEILING HEIGHT" in str(region.get("text") or "").upper()
            and "25'-7\"" in str(region.get("text") or "")
        )
        support_ids = ceiling_fact.get("renderedCorroboratingRegionIds") or []
        self.assertEqual(ceiling_fact["id"], "native-472-2")
        self.assertTrue(support_ids)
        self.assertTrue(all(region_id in region_by_id for region_id in support_ids))

        assurance = assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(assurance["accepted"], assurance["failureCodes"])
        self.assertEqual(assurance["failureCodes"], [])


if __name__ == "__main__":
    unittest.main()
