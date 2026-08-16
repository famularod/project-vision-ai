"""Opt-in exact-PDF production-path regressions for 2375 structured facts.

Set ``ECOS_RUN_2375_STRUCTURED_TABLE_PDF_TESTS=1`` to render and OCR the exact
SHA-pinned issued drawings.  These tests use the production extraction and
Assurance paths; no drawing-specific coordinates are added to worker code.
"""

import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf
from ecos_indexer.sheet_mapping import STRUCTURAL_IDENTITY_RENDERED_SOURCES


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
FULL_SET_SOURCE_VALUE = os.getenv("ECOS_2375_FULL_SET_REGRESSION_PATH", "").strip()
FULL_SET_SOURCE_PATH = Path(FULL_SET_SOURCE_VALUE) if FULL_SET_SOURCE_VALUE else None
FULL_SET_SOURCE_SHA256 = "7f69c250a1085df832dbda21daf4db2cfef5ae0cc21a61ecdfdb15d8884c48f6"
FULL_SET_PROJECT_ID = "72e941d8-8114-4082-a976-ae5b2b5daba9"


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
            document = open_pdf(payload)
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
        region_by_id = {region["id"]: region for region in page["regions"]}
        for item in page["sheetMappingEvidence"]:
            support_ids = item.get("renderedCorroboratingRegionIds") or []
            support_sources = item.get("renderedCorroboratingSources") or []
            self.assertIs(item.get("renderedCorroborated"), True)
            self.assertTrue(support_ids)
            self.assertEqual(len(support_ids), len(set(support_ids)))
            self.assertTrue(support_sources)
            self.assertTrue(set(support_sources) <= STRUCTURAL_IDENTITY_RENDERED_SOURCES)
            for region_id in support_ids:
                self.assertIn(region_id, region_by_id)
                self.assertIs(region_by_id[region_id].get("searchable"), True)
                self.assertIn(region_by_id[region_id].get("source"), support_sources)
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


@unittest.skipUnless(
    RUN_EXACT and FULL_SET_SOURCE_PATH is not None and FULL_SET_SOURCE_PATH.is_file(),
    "Set ECOS_RUN_2375_STRUCTURED_TABLE_PDF_TESTS=1 and "
    "ECOS_2375_FULL_SET_REGRESSION_PATH to the exact issued full-set PDF.",
)
class Exact2375FullSetLandscapeProductionTest(unittest.TestCase):
    """Replays the exact page that failed the controlled shadow canary."""

    def test_page_one_landscape_table_is_complete_without_phantom_hydrozone_rows(self):
        payload = FULL_SET_SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(payload).hexdigest()
        self.assertEqual(actual_sha, FULL_SET_SOURCE_SHA256)

        document = open_pdf(payload)
        try:
            identity = document_sheet_identity_map(document).get(1)
            result = extract_page(
                document[0],
                actual_sha,
                project_id=FULL_SET_PROJECT_ID,
                document_sheet_identity=identity,
            )
        finally:
            document.close()

        page = result["final"]
        analysis = page["structuredTableAnalysis"]
        self.assertEqual(page["sheetNumber"], "L-1")
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual([block["schema"] for block in analysis["blocks"]], ["landscape_summary"])
        self.assertFalse(any(block["schema"] == "hydrozone_summary" for block in analysis["blocks"]))
        self.assertEqual(analysis.get("targetedOcrProofs") or [], [])

        rows = {
            relationship["rowKey"]: relationship
            for relationship in analysis["relationships"]
            if relationship.get("type") == "landscape_metric"
        }
        self.assertEqual(set(rows), {
            "landscapeArea", "irrigatedArea", "requiredTrees", "providedTrees",
        })
        self.assertEqual(
            {row_key: row["roles"]["value"]["value"] for row_key, row in rows.items()},
            {
                "landscapeArea": 26532,
                "irrigatedArea": 21104,
                "requiredTrees": 71,
                "providedTrees": 78,
            },
        )
        for row in rows.values():
            self.assertEqual(row["status"], "complete")
            self.assertEqual(row["missingRoles"], [])
            self.assertEqual(row["conflictCodes"], [])
            candidate_values = {
                candidate.get("value")
                for candidate in row["roles"]["value"].get("candidates", [])
            }
            self.assertNotIn(532, candidate_values)
            self.assertNotIn(104, candidate_values)

        # The worker resolves bounded visual exceptions before Assurance.  This
        # assertion models that exact post-resolution boundary without weakening
        # or bypassing the exception gate itself.
        assurance = assure_page(
            page_data=page,
            expected_project_id=FULL_SET_PROJECT_ID,
            expected_page_number=1,
            expected_source_sha256=actual_sha,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(assurance["accepted"], assurance)
        self.assertEqual(assurance["failureCodes"], [])
        self.assertEqual(assurance["limitationCodes"], [])
        self.assertTrue(assurance["checks"]["structuredTableSearchFailClosed"])
        self.assertTrue(assurance["checks"]["structuredTableEvidenceComplete"])

    def test_page_two_keeps_only_real_hydrozone_and_water_budget_tables(self):
        payload = FULL_SET_SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(payload).hexdigest()
        self.assertEqual(actual_sha, FULL_SET_SOURCE_SHA256)

        document = open_pdf(payload)
        try:
            identity = document_sheet_identity_map(document).get(2)
            result = extract_page(
                document[1],
                actual_sha,
                project_id=FULL_SET_PROJECT_ID,
                document_sheet_identity=identity,
            )
        finally:
            document.close()

        page = result["final"]
        analysis = page["structuredTableAnalysis"]
        self.assertEqual(page["sheetNumber"], "L-2")
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual(
            {block["schema"] for block in analysis["blocks"]},
            {"hydrozone_summary", "water_budget"},
        )
        self.assertEqual(analysis.get("targetedOcrRequests") or [], [])
        self.assertEqual(analysis.get("targetedOcrProofs") or [], [])
        self.assertEqual(page.get("structuredTableLimitations") or [], [])

        relationships = {
            (relationship["type"], relationship["rowKey"]): relationship
            for relationship in analysis["relationships"]
        }
        self.assertEqual(
            set(relationships),
            {
                ("hydrozone_area", "high"),
                ("hydrozone_area", "medium"),
                ("hydrozone_area", "low"),
                ("water_budget", "ETWU"),
                ("water_budget", "MAWA"),
            },
        )
        self.assertEqual(
            {
                zone: relationships[("hydrozone_area", zone)]["roles"]["area"]["value"]
                for zone in ("high", "medium", "low")
            },
            {"high": 0, "medium": 146, "low": 9470},
        )
        self.assertEqual(
            {
                metric: relationships[("water_budget", metric)]["roles"]["value"]["value"]
                for metric in ("ETWU", "MAWA")
            },
            {"ETWU": 87952, "MAWA": 147191},
        )
        self.assertTrue(all(
            relationship["status"] == "complete"
            for relationship in relationships.values()
        ))
        fact_regions = [
            region for region in page["regions"]
            if region.get("source") == "deterministic_structured_table_relationship"
        ]
        self.assertEqual(len(fact_regions), 5)
        region_by_id = {region["id"]: region for region in page["regions"]}
        self.assertTrue(all(
            region_by_id[region_id].get("searchable") is False
            for block in analysis["blocks"]
            for region_id in block["regionIds"]
        ))
        self.assertEqual(result["unresolved"], [])

        assurance = assure_page(
            page_data=page,
            expected_project_id=FULL_SET_PROJECT_ID,
            expected_page_number=2,
            expected_source_sha256=actual_sha,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(result["unresolved"]),
        )
        self.assertTrue(assurance["accepted"], assurance)
        self.assertEqual(assurance["failureCodes"], [])
        self.assertEqual(assurance["limitationCodes"], [])
        self.assertTrue(assurance["checks"]["structuredTableSearchFailClosed"])
        self.assertTrue(assurance["checks"]["structuredTableEvidenceComplete"])


if __name__ == "__main__":
    unittest.main()
