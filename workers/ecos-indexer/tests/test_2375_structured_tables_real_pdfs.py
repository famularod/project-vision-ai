"""Opt-in exact-PDF production-path regressions for 2375 structured facts.

Set ``ECOS_RUN_2375_STRUCTURED_TABLE_PDF_TESTS=1`` to render and OCR the exact
SHA-pinned issued drawings.  These tests use the production extraction and
Assurance paths; no drawing-specific coordinates are added to worker code.
"""

import hashlib
import os
import unittest
from pathlib import Path

import pymupdf as fitz

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page


SOURCE_DIRECTORY = Path(os.getenv(
    "ECOS_2375_REGRESSION_DIRECTORY",
    str(
        Path.home()
        / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
        / "2375 Approved"
    ),
))
PROJECT_ID = "exact-issued-2375-regression"
SOURCES = {
    "civil": {
        "filename": "02A - PLZ CORP - 2375 THIRD STREET - CIVIL.pdf",
        "sha256": "eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01",
        "page": 6,
        "sheet": "C6",
    },
    "electrical": {
        "filename": "06 - PLZ CORP - 2375 THIRD STREET - ELECTRICAL.pdf",
        "sha256": "6e4560ba09e6b5d7e871bd5dacd53ef56154a01eca120e19cee33474879894a9",
        "page": 13,
        "sheet": "E-2.7",
    },
}
RUN_EXACT = os.getenv("ECOS_RUN_2375_STRUCTURED_TABLE_PDF_TESTS") == "1"
SOURCES_PRESENT = all(
    (SOURCE_DIRECTORY / source["filename"]).exists()
    for source in SOURCES.values()
)


@unittest.skipUnless(
    RUN_EXACT and SOURCES_PRESENT,
    "Set ECOS_RUN_2375_STRUCTURED_TABLE_PDF_TESTS=1 with exact issued PDFs to run.",
)
class Exact2375StructuredTableProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {}
        for source_key, source in SOURCES.items():
            path = SOURCE_DIRECTORY / source["filename"]
            payload = path.read_bytes()
            actual_sha = hashlib.sha256(payload).hexdigest()
            if actual_sha != source["sha256"]:
                raise AssertionError(
                    f"Issued 2375 source changed: {source['filename']}: {actual_sha}"
                )
            document = fitz.open(stream=payload, filetype="pdf")
            try:
                identity = document_sheet_identity_map(document).get(source["page"])
                cls.results[source_key] = extract_page(
                    document[source["page"] - 1],
                    actual_sha,
                    project_id=PROJECT_ID,
                    document_sheet_identity=identity,
                )
            finally:
                document.close()

    def test_exact_c6_is_verified_from_pdf_annotations_and_has_only_six_inch_pcc(self):
        source = SOURCES["civil"]
        result = self.results["civil"]
        page = result["final"]

        self.assertEqual(page["sheetNumber"], "C6")
        self.assertEqual(page["sheetMappingStatus"], "verified")
        self.assertEqual(page["sheetMappingSource"], "pdf_annotation_title_band")
        self.assertEqual(
            [(item["source"], item["annotationSubtype"]) for item in page["sheetMappingEvidence"]],
            [("pdf_annotation", "Square"), ("pdf_annotation", "Square")],
        )
        facts = self._structured_facts(page)
        self.assertEqual(len(facts), 1)
        normalized = facts[0]["text"].upper().replace("”", '"')
        self.assertIn('6.0" THICK', normalized)
        self.assertIn("PCC PAVING", normalized)
        self.assertNotIn('2.0"', normalized)
        self.assertNotIn('4.0"', normalized)
        analysis = page["structuredTableAnalysis"]
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual([block["schema"] for block in analysis["blocks"]], ["slab_legend"])
        self.assertLessEqual(analysis["blocks"][0]["bounds"]["width"], 0.13)
        self.assertLessEqual(analysis["blocks"][0]["bounds"]["height"], 0.03)
        self._assert_block_constituents_quarantined(page)
        self._assert_assured(source, result)

    def test_exact_e_2_7_all_row_is_2_8_21_1_0_0_with_exact_constituents(self):
        source = SOURCES["electrical"]
        result = self.results["electrical"]
        page = result["final"]

        self.assertEqual(page["sheetNumber"], "E-2.7")
        self.assertEqual(page["sheetMappingStatus"], "verified")
        self.assertEqual(page["sheetMappingSource"], "pdf_bookmark")
        analysis = page["structuredTableAnalysis"]
        relationships = [
            relationship for relationship in analysis["relationships"]
            if relationship.get("type") == "photometric_statistics"
            and relationship.get("rowKey") == "ALL"
        ]
        self.assertEqual(len(relationships), 1)
        relationship = relationships[0]
        self.assertEqual(relationship["status"], "complete")
        self.assertEqual(relationship["missingRoles"], [])
        self.assertEqual(relationship["conflictCodes"], [])
        self.assertEqual(
            {role: relationship["roles"][role]["value"] for role in ("avg", "max", "min")},
            {"avg": 2.8, "max": 21.1, "min": 0.0},
        )
        self.assertEqual(
            [item["text"] for item in relationship["constituents"]],
            ["ALL", "2.8", "21.1", "0.0"],
        )
        facts = self._structured_facts(page)
        self.assertEqual([fact["text"] for fact in facts], ["ALL 2.8 21.1 0.0"])
        self._assert_block_constituents_quarantined(page)
        self._assert_assured(source, result)

    def _assert_assured(self, source, result):
        assurance = assure_page(
            page_data=result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=source["page"],
            expected_source_sha256=source["sha256"],
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(result["unresolved"]),
        )
        self.assertTrue(assurance["accepted"], assurance)
        self.assertEqual(assurance["failureCodes"], [])
        self.assertTrue(assurance["checks"]["structuredTableSearchFailClosed"])
        self.assertTrue(assurance["checks"]["structuredTableEvidenceComplete"])
        self.assertTrue(assurance["checks"]["sheetMappingUsable"])

    def _assert_block_constituents_quarantined(self, page):
        block_ids = {
            region_id
            for block in page["structuredTableAnalysis"]["blocks"]
            for region_id in block["regionIds"]
        }
        block_regions = [region for region in page["regions"] if region.get("id") in block_ids]
        self.assertTrue(block_regions)
        self.assertTrue(all(region.get("searchable") is False for region in block_regions))

    @staticmethod
    def _structured_facts(page):
        return [
            region for region in page["regions"]
            if region.get("source") == "deterministic_structured_table_relationship"
        ]


if __name__ == "__main__":
    unittest.main()
