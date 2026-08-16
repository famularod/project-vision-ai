"""Opt-in exact-SHA regression for hosted job 774d page 2."""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf

SOURCE_PATH_VALUE = os.getenv("ECOS_774D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "9e55cb9dccc0a20b5e02f0ed4c41bdca0ab09708aa7183a4d71d85734ea639cf"
PROJECT_ID = "72e941d8-8114-4082-a976-ae5b2b5daba9"
PAGE_NUMBER = 2
RUN_EXACT = os.getenv("ECOS_RUN_774D_PAGE2_PDF_TESTS") == "1"


def normalized_text(value: object) -> str:
    return str(value or "").replace("’", "'").replace("‘", "'")


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_774D_PAGE2_PDF_TESTS=1 with the exact 774d source.",
)
class Exact774dPage2ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued 774d source SHA changed")
        document = open_pdf(source)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(PAGE_NUMBER),
            )
        finally:
            document.close()
        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(cls.result["unresolved"]),
        )

    def test_exact_page_has_no_remaining_visual_exception(self) -> None:
        self.assertEqual([], self.result["unresolved"])
        self.assertTrue(self.assurance["accepted"])
        self.assertEqual([], self.assurance["failureCodes"])

    def test_incomplete_arithmetic_fragment_cannot_be_visual_fact_authority(self) -> None:
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        exact_fragment = [
            region for region in rejected
            if normalized_text(region.get("text")) == "(140'+"
            and region.get("x") == 0.099206
            and region.get("y") == 0.283333
        ]
        self.assertEqual(1, len(exact_fragment))

        visual_candidates = [
            candidate
            for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertFalse(any(
            normalized_text(candidate.get("text")) == "(140'+"
            and candidate.get("bounds") == {
                "x": 0.099206,
                "y": 0.283333,
                "width": 0.009365,
                "height": 0.005111,
            }
            for candidate in visual_candidates
        ))

    def test_complete_calculation_remains_auditable_but_quarantined(self) -> None:
        complete_calculations = [
            region
            for region in self.result["final"]["regions"]
            if normalized_text(region.get("text")) ==
            "(140'+ 5 ELLSX5) x 1.25/100"
        ]
        self.assertTrue(complete_calculations)
        self.assertTrue(all(
            region.get("searchable") is False
            for region in complete_calculations
        ))


if __name__ == "__main__":
    unittest.main()
