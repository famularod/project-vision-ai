"""Opt-in exact-SHA regression for hosted job 78949 page 9."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf

SOURCE_PATH = Path(os.getenv(
    "ECOS_78949_REGRESSION_PDF",
    str(Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved/2321 approved/HPSDrawing-PLZCorp-R1.pdf"),
))
SOURCE_SHA256 = "e358e80453258b8ab27dfcae9045108fd0c2d86db3dbd8766ede2d9709e97665"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 9
RUN_EXACT = os.getenv("ECOS_RUN_78949_PAGE9_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH.exists(),
    "Set ECOS_RUN_78949_PAGE9_PDF_TESTS=1 with the exact HPS source.",
)
class Exact78949Page9ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = SOURCE_PATH.read_bytes()
        if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued HPS source SHA changed")
        document = open_pdf(payload)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1], SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(PAGE_NUMBER),
            )
        finally:
            document.close()

    def test_incomplete_zero_inch_fragment_is_not_a_visual_authority(self) -> None:
        candidates = [
            candidate
            for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]

        self.assertNotIn('24\'-"', [candidate["text"] for candidate in candidates])
        self.assertFalse(any(
            candidate["bounds"] == {
                "x": 0.780635,
                "y": 0.328,
                "width": 0.009841,
                "height": 0.003333,
            }
            for candidate in candidates
        ))


if __name__ == "__main__":
    unittest.main()
