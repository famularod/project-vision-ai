import unittest
import copy

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.structured_table_pipeline import (
    analyze_page_structured_tables,
    structured_table_analysis_sha256,
)
from ecos_indexer.visual_coverage import (
    VISUAL_ANALYSIS_METHOD,
    expected_visual_subtile_pixel_bounds,
)


SOURCE_SHA = "a" * 64
PROJECT_ID = "test-project"
REQUIRED_TILE_BOUNDS = {
    "0:0:333:500": (0.0, 0.0, 1.0 / 3.0, 0.5),
    "333:0:333:500": (1.0 / 3.0, 0.0, 1.0 / 3.0, 0.5),
    "667:0:333:500": (2.0 / 3.0, 0.0, 1.0 / 3.0, 0.5),
    "0:500:333:500": (0.0, 0.5, 1.0 / 3.0, 0.5),
    "333:500:333:500": (1.0 / 3.0, 0.5, 1.0 / 3.0, 0.5),
    "667:500:333:500": (2.0 / 3.0, 0.5, 1.0 / 3.0, 0.5),
}


def visual_coverage_fixture():
    proofs = []
    for tile_key, (x, y, width, height) in REQUIRED_TILE_BOUNDS.items():
        proofs.append({
            "tileKey": tile_key,
            "bounds": {"x": x, "y": y, "width": width, "height": height},
            "state": "completed",
            "pageNumber": 6,
            "sourceSha256": SOURCE_SHA,
            "evidenceVersion": EVIDENCE_VERSION,
            "renderMethod": "pymupdf_rgb_png",
            "analysisMethod": VISUAL_ANALYSIS_METHOD,
            "renderDpi": 200,
            "renderPixelWidth": 2400,
            "renderPixelHeight": 2400,
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "3" * 64,
            "analysisSubtileProofs": [
                {
                    "subtileKey": key,
                    "state": "completed",
                    "pixelBounds": {
                        "x": pixels[0],
                        "y": pixels[1],
                        "width": pixels[2] - pixels[0],
                        "height": pixels[3] - pixels[1],
                    },
                    "analysisInputSha256": "4" * 64,
                    "analysisSha256": "5" * 64,
                    "analysisRegionCount": 0,
                    "analysisRegionIds": [],
                }
                for key, pixels in expected_visual_subtile_pixel_bounds(2400, 2400).items()
            ],
            "analysisRegionCount": 0,
            "analysisRegionIds": [],
            "searchableRegionCount": 0,
            "searchableRegionIds": [],
        })
    return {
        "schemaVersion": "ecos-visual-coverage/1.0",
        "evidenceVersion": EVIDENCE_VERSION,
        "sourceSha256": SOURCE_SHA,
        "pageNumber": 6,
        "overviewAnalyzed": True,
        "requestedDeepReadRegionCount": 6,
        "completedDeepReadRegionCount": 6,
        "coverageComplete": True,
        "completedDeepReadRegionKeys": list(REQUIRED_TILE_BOUNDS),
        "completedDeepReadRegionProofs": proofs,
        "failureCodes": [],
    }


def page_fixture():
    return {
        "projectId": PROJECT_ID,
        "pageNumber": 6,
        "sourceSha256": SOURCE_SHA,
        "sheetMappingStatus": "verified",
        "sheetNumber": "C6",
        "sheetMappingSource": "pdf_bookmark",
        "sheetMappingEvidence": [{
            "id": "pdf-bookmark-0-page-6",
            "pageNumber": 6,
            "source": "pdf_bookmark",
            "text": "C06-C6",
            "normalizedBounds": None,
        }],
        "visualCoverage": visual_coverage_fixture(),
        "text": "CONSTRUCT 6 INCH THICK PCC",
        "regions": [{
            "id": "fact-1",
            "text": "CONSTRUCT 6 INCH THICK PCC",
            "factKind": "drawing_fact",
            "evidenceText": "CONSTRUCT 6 INCH THICK PCC",
            "x": 0.2,
            "y": 0.3,
            "width": 0.3,
            "height": 0.04,
        }],
    }


class AssuranceTests(unittest.TestCase):
    def test_accepts_source_bound_coordinate_evidence(self) -> None:
        result = assure_page(
            page_data=page_fixture(),
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(result["accepted"])
        self.assertEqual(result["failureCodes"], [])
        self.assertEqual(result["evidenceVersion"], EVIDENCE_VERSION)
        self.assertEqual(result["sourceSha256"], SOURCE_SHA)
        self.assertEqual(result["projectId"], PROJECT_ID)
        self.assertEqual(result["pageNumber"], 6)

    def test_rejects_unresolved_visual_regions(self) -> None:
        result = assure_page(
            page_data=page_fixture(),
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=1,
        )
        self.assertFalse(result["accepted"])
        self.assertIn("unresolved_regions", result["failureCodes"])

    def test_rejects_wrong_source_and_invalid_proof_coordinates(self) -> None:
        page = page_fixture()
        page["sourceSha256"] = "b" * 64
        page["regions"][0]["x"] = 1.2
        result = assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertFalse(result["accepted"])
        self.assertIn("source_fingerprint_mismatch", result["failureCodes"])
        self.assertIn("invalid_proof_coordinates", result["failureCodes"])

    def test_rejects_a_fact_not_bound_to_exact_visible_evidence(self) -> None:
        page = page_fixture()
        page["regions"][0]["evidenceText"] = "6 INCH PCC"
        result = assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertFalse(result["accepted"])
        self.assertIn("fact_not_bound_to_visible_evidence", result["failureCodes"])

    def test_rejects_conflicted_sheet_mapping_until_identity_is_resolved(self) -> None:
        page = page_fixture()
        page["sheetMappingStatus"] = "conflicted"

        result = assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )

        self.assertFalse(result["accepted"])
        self.assertIn("sheet_mapping_conflicted", result["failureCodes"])
        self.assertFalse(result["checks"]["sheetMappingUsable"])

    def test_allows_unverified_nonconflicting_page_identity_for_page_citation(self) -> None:
        page = page_fixture()
        page["sheetMappingStatus"] = "unverified"

        result = assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )

        self.assertTrue(result["accepted"])
        self.assertTrue(result["checks"]["sheetMappingUsable"])

    def test_rejects_verified_mapping_without_sheet_number_source_or_evidence(self) -> None:
        for field in ("sheetNumber", "sheetMappingSource", "sheetMappingEvidence"):
            with self.subTest(field=field):
                page = page_fixture()
                page.pop(field)
                result = self.assure(page)
                self.assertFalse(result["accepted"])
                self.assertIn("sheet_provenance_invalid", result["failureCodes"])
                self.assertFalse(result["checks"]["sheetMappingUsable"])

    def test_rejects_fabricated_or_wrong_page_bookmark_provenance(self) -> None:
        page = page_fixture()
        page["sheetMappingEvidence"][0]["text"] = "C6"
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

        for non_integer_page in (6.9, "6", True):
            with self.subTest(non_integer_page=non_integer_page):
                page = page_fixture()
                page["sheetMappingEvidence"][0]["pageNumber"] = non_integer_page
                result = self.assure(page)
                self.assertFalse(result["accepted"])
                self.assertIn("sheet_provenance_invalid", result["failureCodes"])

        page = page_fixture()
        page["sheetMappingEvidence"][0]["pageNumber"] = 7
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_rejects_native_source_with_bookmark_evidence(self) -> None:
        page = page_fixture()
        page["sheetMappingSource"] = "native_title_band"
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_accepts_exact_pdf_annotation_title_band_provenance(self) -> None:
        page = page_fixture()
        page["sheetMappingSource"] = "pdf_annotation_title_band"
        page["sheetMappingEvidence"] = [
            {
                "id": "pdf-annotation-324-page-6",
                "pageNumber": 6,
                "source": "pdf_annotation",
                "annotationSubtype": "Square",
                "text": "C6",
                "normalizedBounds": {
                    "x": 0.952546,
                    "y": 0.907986,
                    "width": 0.013889,
                    "height": 0.013889,
                },
            },
            {
                "id": "pdf-annotation-210-page-6",
                "pageNumber": 6,
                "source": "pdf_annotation",
                "annotationSubtype": "Square",
                "text": "SHEET NO.",
                "normalizedBounds": {
                    "x": 0.946373,
                    "y": 0.893519,
                    "width": 0.02662,
                    "height": 0.009259,
                },
            },
        ]

        result = self.assure(page)

        self.assertTrue(result["accepted"])
        self.assertTrue(result["checks"]["sheetMappingUsable"])

    def test_rejects_forged_or_incomplete_pdf_annotation_title_band_provenance(self) -> None:
        valid = [
            {
                "id": "pdf-annotation-324-page-6",
                "pageNumber": 6,
                "source": "pdf_annotation",
                "annotationSubtype": "Square",
                "text": "C6",
                "normalizedBounds": {
                    "x": 0.952546, "y": 0.907986,
                    "width": 0.013889, "height": 0.013889,
                },
            },
            {
                "id": "pdf-annotation-210-page-6",
                "pageNumber": 6,
                "source": "pdf_annotation",
                "annotationSubtype": "Square",
                "text": "SHEET NO.",
                "normalizedBounds": {
                    "x": 0.946373, "y": 0.893519,
                    "width": 0.02662, "height": 0.009259,
                },
            },
        ]
        cases = {
            "missing-label": valid[:1],
            "wrong-token": [{**valid[0], "text": "C7"}, valid[1]],
            "forged-source": [{**valid[0], "source": "embedded_text"}, valid[1]],
            "forged-subtype": [{**valid[0], "annotationSubtype": "FreeText"}, valid[1]],
            "off-band": [
                {**valid[0], "normalizedBounds": {
                    "x": 0.5, "y": 0.5, "width": 0.02, "height": 0.02,
                }},
                valid[1],
            ],
        }
        for label, evidence in cases.items():
            with self.subTest(label=label):
                page = page_fixture()
                page["sheetMappingSource"] = "pdf_annotation_title_band"
                page["sheetMappingEvidence"] = evidence
                result = self.assure(page)
                self.assertFalse(result["accepted"])
                self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_rejects_non_numeric_or_boolean_native_title_bounds(self) -> None:
        for malformed_bounds in (
            {"x": "0.95", "y": 0.95, "width": 0.02, "height": 0.02},
            {"x": False, "y": False, "width": True, "height": True},
        ):
            with self.subTest(malformed_bounds=malformed_bounds):
                page = page_fixture()
                page["sheetNumber"] = "L-2"
                page["sheetMappingSource"] = "native_title_band"
                page["sheetMappingEvidence"] = [{
                    "id": "native-2-1",
                    "pageNumber": 6,
                    "source": "embedded_text",
                    "text": "L-2",
                    "normalizedBounds": malformed_bounds,
                }]
                result = self.assure(page)
                self.assertFalse(result["accepted"])
                self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_rejects_native_identity_outside_its_exact_title_band(self) -> None:
        page = page_fixture()
        page["sheetNumber"] = "L-2"
        page["sheetMappingSource"] = "native_title_band"
        page["sheetMappingEvidence"] = [{
            "id": "native-2-1",
            "pageNumber": 6,
            "source": "embedded_text",
            "text": "L-2",
            "normalizedBounds": {"x": 0.1, "y": 0.1, "width": 0.02, "height": 0.02},
        }]
        page["regions"].append({
            "id": "native-2-1",
            "text": "L-2",
            "source": "embedded_text",
            "x": 0.1,
            "y": 0.1,
            "width": 0.02,
            "height": 0.02,
        })
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_accepts_exact_native_title_band_provenance_bound_to_current_region(self) -> None:
        page = page_fixture()
        page["sheetNumber"] = "L-2"
        page["sheetMappingSource"] = "native_title_band"
        page["sheetMappingEvidence"] = [{
            "id": "native-2-1",
            "pageNumber": 6,
            "source": "embedded_text",
            "text": "L-2",
            "normalizedBounds": {"x": 0.95, "y": 0.95, "width": 0.02, "height": 0.02},
        }]
        page["regions"].append({
            "id": "native-2-1",
            "text": "L-2",
            "x": 0.95,
            "y": 0.95,
            "width": 0.02,
            "height": 0.02,
            "source": "embedded_text",
        })
        result = self.assure(page)
        self.assertTrue(result["accepted"], result["failureCodes"])

        page["sheetMappingEvidence"].append(dict(page["sheetMappingEvidence"][0]))
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_accepts_only_the_producer_rounding_loss_for_native_title_bounds(self) -> None:
        page = page_fixture()
        page["sheetNumber"] = "L-2"
        page["sheetMappingSource"] = "native_title_band"
        page["sheetMappingEvidence"] = [{
            "id": "native-2-1",
            "pageNumber": 6,
            "source": "embedded_text",
            "text": "L-2",
            "normalizedBounds": {
                "x": 0.95681213702,
                "y": 0.95698748213,
                "width": 0.02000173291,
                "height": 0.01999878124,
            },
        }]
        page["regions"].append({
            "id": "native-2-1",
            "text": "L-2",
            "source": "embedded_text",
            "x": 0.956812,
            "y": 0.956987,
            "width": 0.020002,
            "height": 0.019999,
        })
        result = self.assure(page)
        self.assertTrue(result["accepted"], result["failureCodes"])

        page["regions"][-1]["x"] -= 0.00001
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("sheet_provenance_invalid", result["failureCodes"])

    def test_rejects_missing_visual_coverage_even_when_no_exception_was_detected(self) -> None:
        page = page_fixture()
        page.pop("visualCoverage")

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_coverage_missing", result["failureCodes"])
        self.assertFalse(result["checks"]["visualDetectionCoverageComplete"])

    def test_rejects_duplicate_tile_proofs_and_fabricated_six_of_six_counts(self) -> None:
        page = page_fixture()
        coverage = page["visualCoverage"]
        coverage["completedDeepReadRegionProofs"][-1] = dict(
            coverage["completedDeepReadRegionProofs"][0]
        )

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_proof_copied_from_another_page(self) -> None:
        page = page_fixture()
        page["visualCoverage"]["completedDeepReadRegionProofs"][2]["pageNumber"] = 7

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_proof_copied_from_another_source(self) -> None:
        page = page_fixture()
        page["visualCoverage"]["completedDeepReadRegionProofs"][2]["sourceSha256"] = "b" * 64

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_stale_visual_coverage_and_stale_tile_proof(self) -> None:
        page = page_fixture()
        page["visualCoverage"]["evidenceVersion"] = "ecos-hosted-evidence/1.2"
        page["visualCoverage"]["completedDeepReadRegionProofs"][2]["evidenceVersion"] = (
            "ecos-hosted-evidence/1.2"
        )

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_coverage_stale", result["failureCodes"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_with_mismatched_bounds(self) -> None:
        page = page_fixture()
        page["visualCoverage"]["completedDeepReadRegionProofs"][2]["bounds"]["x"] = 0.5

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_without_render_or_analysis_fingerprints(self) -> None:
        page = page_fixture()
        proof = page["visualCoverage"]["completedDeepReadRegionProofs"][2]
        proof.pop("renderSha256")
        proof.pop("analysisSha256")

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_with_unproven_internal_pixel_band(self) -> None:
        page = page_fixture()
        proof = page["visualCoverage"]["completedDeepReadRegionProofs"][2]
        proof["analysisSubtileProofs"].pop()

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_coerced_or_over_budget_visual_tile_metadata(self) -> None:
        mutations = (
            ("renderDpi", "200"),
            ("renderPixelWidth", True),
            ("renderPixelWidth", 6001),
            ("renderPixelWidth", 5000),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                page = page_fixture()
                proof = page["visualCoverage"]["completedDeepReadRegionProofs"][2]
                proof[field] = value
                if field == "renderPixelWidth" and value == 5000:
                    proof["renderPixelHeight"] = 5000
                result = self.assure(page)
                self.assertFalse(result["accepted"])
                self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_searchable_region_ids_not_emitted_by_tile_analysis(self) -> None:
        page = page_fixture()
        proof = page["visualCoverage"]["completedDeepReadRegionProofs"][2]
        proof["searchableRegionCount"] = 1
        proof["searchableRegionIds"] = ["fabricated-region"]
        result = self.assure(page)
        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_rejects_tile_whose_region_count_does_not_match_its_exact_ids(self) -> None:
        page = page_fixture()
        proof = page["visualCoverage"]["completedDeepReadRegionProofs"][2]
        proof["analysisRegionCount"] = 1

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("visual_tile_proofs_invalid", result["failureCodes"])

    def test_detection_coverage_is_not_reported_as_evidentiary_fact(self) -> None:
        page = page_fixture()
        page["regions"] = [{
            "id": "text-1",
            "text": "GENERAL NOTES",
            "factKind": "searchable_text",
            "x": 0.2,
            "y": 0.3,
            "width": 0.3,
            "height": 0.04,
        }]

        result = self.assure(page)

        self.assertTrue(result["accepted"])
        self.assertTrue(result["checks"]["visualDetectionCoverageComplete"])
        self.assertEqual(result["checks"]["visualEvidentiaryProofCount"], 0)

    def test_accepts_complete_structured_relationship_with_exact_round_trip(self) -> None:
        inputs = [
            self.structured_region("thickness", '6" THK.', 0.10),
            self.structured_region("reinforced", "REINFORCED", 0.22),
            self.structured_region("concrete", "CONCRETE", 0.36),
            self.structured_region("slab", "SLAB", 0.49),
        ]
        facts, analysis, unresolved = analyze_page_structured_tables(
            project_id=PROJECT_ID,
            source_sha256=SOURCE_SHA,
            page_number=6,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="C6",
            regions=inputs,
            block_hints=[{
                "schema": "slab_legend",
                "bounds": {"x": 0.05, "y": 0.10, "width": 0.70, "height": 0.20},
            }],
        )
        self.assertEqual(unresolved, [])
        self.assertIsNotNone(analysis)
        assert analysis is not None
        page = page_fixture()
        page["regions"] = self.persisted_structured_regions(inputs, facts, analysis)
        page["text"] = "\n".join(region["text"] for region in facts)
        page["structuredTableAnalysis"] = analysis

        result = self.assure(page)

        self.assertTrue(result["accepted"], result["failureCodes"])
        self.assertTrue(result["checks"]["structuredTableEvidenceComplete"])

    def test_rejects_rehashed_structured_role_fabrication(self) -> None:
        inputs = [
            self.structured_region("thickness", '6" THK.', 0.10),
            self.structured_region("reinforced", "REINFORCED", 0.22),
            self.structured_region("concrete", "CONCRETE", 0.36),
            self.structured_region("slab", "SLAB", 0.49),
        ]
        facts, analysis, _ = analyze_page_structured_tables(
            project_id=PROJECT_ID,
            source_sha256=SOURCE_SHA,
            page_number=6,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="C6",
            regions=inputs,
            block_hints=[{
                "schema": "slab_legend",
                "bounds": {"x": 0.05, "y": 0.10, "width": 0.70, "height": 0.20},
            }],
        )
        assert analysis is not None
        fabricated = copy.deepcopy(analysis)
        fabricated["relationships"][0]["roles"]["thickness"]["value"] = 8.0
        fabricated["analysisSha256"] = structured_table_analysis_sha256(fabricated)
        page = page_fixture()
        page["regions"] = self.persisted_structured_regions(inputs, facts, fabricated)
        page["text"] = "\n".join(region["text"] for region in facts)
        page["structuredTableAnalysis"] = fabricated

        result = self.assure(page)

        self.assertFalse(result["accepted"])
        self.assertIn("structured_table_proof_invalid", result["failureCodes"])
        self.assertFalse(result["checks"]["structuredTableEvidenceComplete"])

    def test_accepts_complete_row_and_reports_incomplete_sibling_as_limitation(self) -> None:
        inputs = [
            {**self.structured_region("f1", "F1", 0.10), "y": 0.15},
            {**self.structured_region("f1-d", '5\'-0" x 5\'-0" x 18"', 0.24), "y": 0.15},
            {**self.structured_region("f1-r", "6-#5", 0.55), "y": 0.15},
            {**self.structured_region("f2", "F2", 0.10), "y": 0.28},
            {**self.structured_region("f2-d", '4\'-0" x 4\'-0" x 18"', 0.24), "y": 0.28},
        ]
        facts, analysis, limitations = analyze_page_structured_tables(
            project_id=PROJECT_ID,
            source_sha256=SOURCE_SHA,
            page_number=6,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="C6",
            regions=inputs,
            block_hints=[{
                "schema": "footing_schedule",
                "bounds": {"x": 0.05, "y": 0.10, "width": 0.70, "height": 0.30},
            }],
        )
        assert analysis is not None
        self.assertEqual(analysis["status"], "incomplete")
        self.assertEqual([item["structuredTableRowKey"] for item in facts], ["F1"])
        self.assertTrue(analysis["targetedOcrRequests"])
        self.assertTrue(limitations)
        page = page_fixture()
        page["regions"] = self.persisted_structured_regions(inputs, facts, analysis)
        page["text"] = facts[0]["text"]
        page["structuredTableAnalysis"] = analysis
        page["structuredTableLimitations"] = limitations

        result = self.assure(page)

        self.assertTrue(result["accepted"], result["failureCodes"])
        self.assertFalse(result["checks"]["structuredTableEvidenceComplete"])
        self.assertTrue(result["checks"]["structuredTableSearchFailClosed"])
        self.assertEqual(result["checks"]["structuredTableLimitationCount"], 1)
        self.assertIn("structured_table_analysis_incomplete", result["limitationCodes"])
        self.assertNotIn("F2", page["text"])

    @staticmethod
    def structured_region(region_id, text, x):
        return {
            "id": region_id,
            "text": text,
            "x": x,
            "y": 0.15,
            "width": 0.10,
            "height": 0.014,
            "confidence": 0.98,
            "source": "fixed_visual_tile_coordinate_ocr",
        }

    @staticmethod
    def persisted_structured_regions(inputs, facts, analysis):
        claimed = {
            str(region_id)
            for block in analysis.get("blocks") or []
            for region_id in block.get("regionIds") or []
        }
        return [
            ({**item, "searchable": False} if item.get("id") in claimed else item)
            for item in [*inputs, *facts]
        ]

    def assure(self, page):
        return assure_page(
            page_data=page,
            expected_project_id=PROJECT_ID,
            expected_page_number=6,
            expected_source_sha256=SOURCE_SHA,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )


if __name__ == "__main__":
    unittest.main()
