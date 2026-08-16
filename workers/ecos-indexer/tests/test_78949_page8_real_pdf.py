"""Opt-in exact-SHA regression for hosted job 78949 page 8."""

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
PAGE_NUMBER = 8
RUN_EXACT = os.getenv("ECOS_RUN_78949_PAGE8_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH.exists(),
    "Set ECOS_RUN_78949_PAGE8_PDF_TESTS=1 with the exact HPS source.",
)
class Exact78949Page8ProductionTests(unittest.TestCase):
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

    def test_spatially_distinct_measurements_have_single_candidate_authority(self) -> None:
        visual_exceptions = [
            item for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]
        self.assertTrue(visual_exceptions)
        self.assertTrue(all(
            item["diagnosticCandidateCount"] == 1
            for item in visual_exceptions
        ))

        fifty_foot_candidates = [
            item["diagnosticCandidates"][0]
            for item in visual_exceptions
            if item["diagnosticCandidates"][0]["text"] == '50\'-0"'
        ]
        self.assertEqual(4, len(fifty_foot_candidates))
        self.assertEqual(
            [0.134762, 0.209206, 0.506825, 0.655714],
            [candidate["bounds"]["x"] for candidate in fifty_foot_candidates],
        )


if __name__ == "__main__":
    unittest.main()
