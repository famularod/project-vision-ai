import copy
import unittest

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.structured_table_pipeline import (
    STRUCTURED_TABLE_FACT_SOURCE,
    analyze_page_structured_tables,
    attach_rebound_targeted_ocr_proofs,
    rebind_targeted_ocr_proofs,
    structured_table_analysis_sha256,
    validate_persisted_structured_table_analysis,
)


SOURCE_2321 = "db676ce857951ace78ed6dd2af0ceeafa29e1cf7664d187bd9f212fa02512840"
SOURCE_2375 = "82f7e6cac282806a31ed343d009009ad2c7e850e06799b57f27b97bbf317ee15"


def region(region_id, text, x, y, width=0.08, *, source="fixed_visual_tile_coordinate_ocr"):
    return {
        "id": region_id,
        "text": text,
        "x": x,
        "y": y,
        "width": width,
        "height": 0.014,
        "confidence": 0.98,
        "source": source,
    }


def analyze(*, project_id, source_sha256, sheet_number, schema, regions):
    return analyze_page_structured_tables(
        project_id=project_id,
        source_sha256=source_sha256,
        page_number=2,
        evidence_version=EVIDENCE_VERSION,
        sheet_number=sheet_number,
        regions=regions,
        block_hints=[{
            "schema": schema,
            "bounds": {"x": 0.05, "y": 0.05, "width": 0.85, "height": 0.60},
        }],
    )


def persisted_regions(inputs, facts, analysis):
    claimed = {
        str(region_id)
        for block in analysis.get("blocks") or []
        for region_id in block.get("regionIds") or []
    }
    return [
        ({**item, "searchable": False} if item.get("id") in claimed else item)
        for item in [*inputs, *facts]
    ]


class StructuredTableHostedPipelineTests(unittest.TestCase):
    def test_exact_2321_slab_relationship_becomes_one_provenance_bound_fact(self):
        inputs = [
            region("2321-thickness", '6" THK.', 0.10, 0.15),
            region("2321-reinforced", "REINFORCED", 0.22, 0.15),
            region("2321-concrete", "CONCRETE", 0.36, 0.15),
            region("2321-slab", "SLAB", 0.49, 0.15),
        ]
        facts, analysis, unresolved = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        self.assertIsNotNone(analysis)
        assert analysis is not None
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual(unresolved, [])
        self.assertEqual(len(facts), 1)
        fact = facts[0]
        self.assertEqual(fact["source"], STRUCTURED_TABLE_FACT_SOURCE)
        self.assertEqual(fact["factKind"], "drawing_fact")
        self.assertEqual(fact["evidenceText"], fact["text"])
        self.assertEqual(
            {item["projectId"] for item in fact["constituentEvidence"]},
            {"2321 Compliance Project"},
        )
        self.assertEqual(
            {item["sourceSha256"] for item in fact["constituentEvidence"]},
            {SOURCE_2321},
        )
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                analysis,
                regions=persisted_regions(inputs, facts, analysis),
                expected_project_id="2321 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2321,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SB-1.1",
            ),
            [],
        )

    def test_exact_2375_footing_schedule_keeps_rows_and_project_separate(self):
        inputs = [
            region("2375-f1", "F1", 0.10, 0.15),
            region("2375-f1-d", "5'-0\" x 5'-0\" x 18\"", 0.24, 0.15, 0.22),
            region("2375-f1-r", "6-#5 E.W. (T&B)", 0.55, 0.15, 0.18),
            region("2375-f2", "F2", 0.10, 0.28),
            region("2375-f2-d", "4'-0\" x 4'-0\" x 18\"", 0.24, 0.28, 0.22),
            region("2375-f2-r", "5-#5", 0.55, 0.28, 0.12),
        ]
        facts, analysis, unresolved = analyze(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            sheet_number="SA1.1",
            schema="footing_schedule",
            regions=inputs,
        )
        self.assertIsNotNone(analysis)
        assert analysis is not None
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual(unresolved, [])
        self.assertEqual(len(facts), 2)
        self.assertEqual(
            {fact["structuredTableRowKey"] for fact in facts},
            {"F1", "F2"},
        )
        self.assertTrue(all(
            item["projectId"] == "2375 Compliance Project"
            for fact in facts
            for item in fact["constituentEvidence"]
        ))

    def test_complete_row_survives_but_incomplete_sibling_never_becomes_a_fact(self):
        incomplete = [
            region("f1", "F1", 0.10, 0.15),
            region("f1-d", "5'-0\" x 5'-0\" x 18\"", 0.24, 0.15, 0.22),
            region("f1-r", "6-#5", 0.55, 0.15),
            region("f2", "F2", 0.10, 0.28),
            region("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.24, 0.28, 0.22),
        ]
        facts, analysis, unresolved = analyze(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            sheet_number="SA1.1",
            schema="footing_schedule",
            regions=incomplete,
        )
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["structuredTableRowKey"], "F1")
        self.assertNotIn("F2", [item["structuredTableRowKey"] for item in facts])
        self.assertIsNotNone(analysis)
        assert analysis is not None
        self.assertEqual(analysis["status"], "incomplete")
        self.assertTrue(unresolved)
        failures = validate_persisted_structured_table_analysis(
            analysis,
            regions=persisted_regions(incomplete, facts, analysis),
            expected_project_id="2375 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2375,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SA1.1",
        )
        self.assertEqual(failures, [])

    def test_2321_analysis_cannot_be_replayed_as_2375(self):
        inputs = [
            region("thickness", '6" THK.', 0.10, 0.15),
            region("reinforced", "REINFORCED", 0.22, 0.15),
            region("concrete", "CONCRETE", 0.36, 0.15),
            region("slab", "SLAB", 0.49, 0.15),
        ]
        facts, analysis, _ = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        assert analysis is not None
        failures = validate_persisted_structured_table_analysis(
            analysis,
            regions=persisted_regions(inputs, facts, analysis),
            expected_project_id="2375 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2375,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SA1.1",
        )
        self.assertIn("structured_table_identity_mismatch", failures)
        self.assertIn("structured_table_proof_invalid", failures)

    def test_tampered_constituent_or_fabricated_fact_fails_closed(self):
        inputs = [
            region("thickness", '6" THK.', 0.10, 0.15),
            region("reinforced", "REINFORCED", 0.22, 0.15),
            region("concrete", "CONCRETE", 0.36, 0.15),
            region("slab", "SLAB", 0.49, 0.15),
        ]
        facts, analysis, _ = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        assert analysis is not None
        tampered_regions = copy.deepcopy(persisted_regions(inputs, facts, analysis))
        tampered_regions[0]["text"] = '8" THK.'
        failures = validate_persisted_structured_table_analysis(
            analysis,
            regions=tampered_regions,
            expected_project_id="2321 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2321,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SB-1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

        fabricated_analysis = copy.deepcopy(analysis)
        fabricated_analysis["relationships"][0]["roles"]["thickness"]["value"] = 8.0
        fabricated_analysis["analysisSha256"] = structured_table_analysis_sha256(
            fabricated_analysis
        )
        failures = validate_persisted_structured_table_analysis(
            fabricated_analysis,
            regions=persisted_regions(inputs, facts, fabricated_analysis),
            expected_project_id="2321 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2321,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SB-1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

    def test_raw_table_constituent_cannot_be_marked_searchable(self):
        inputs = [
            region("thickness", '6" THK.', 0.10, 0.15),
            region("reinforced", "REINFORCED", 0.22, 0.15),
            region("concrete", "CONCRETE", 0.36, 0.15),
            region("slab", "SLAB", 0.49, 0.15),
        ]
        facts, analysis, _ = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        assert analysis is not None
        failures = validate_persisted_structured_table_analysis(
            analysis,
            regions=[*inputs, *facts],
            expected_project_id="2321 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2321,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SB-1.1",
        )
        self.assertIn("structured_table_search_provenance_invalid", failures)

    def test_forged_first_relationship_is_rejected_when_last_relationship_is_valid(self):
        inputs = [
            region("f1", "F1", 0.10, 0.15),
            region("f1-d", "5'-0\" x 5'-0\" x 18\"", 0.24, 0.15, 0.22),
            region("f1-r", "6-#5", 0.55, 0.15),
            region("f2", "F2", 0.10, 0.28),
            region("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.24, 0.28, 0.22),
            region("f2-r", "5-#5", 0.55, 0.28),
        ]
        facts, analysis, _ = analyze(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            sheet_number="SA1.1",
            schema="footing_schedule",
            regions=inputs,
        )
        assert analysis is not None
        self.assertEqual(len(analysis["relationships"]), 2)
        forged = copy.deepcopy(analysis)
        forged["relationships"][0]["constituents"][0]["text"] = "FORGED F9"
        forged["analysisSha256"] = structured_table_analysis_sha256(forged)
        failures = validate_persisted_structured_table_analysis(
            forged,
            regions=persisted_regions(inputs, facts, analysis),
            expected_project_id="2375 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2375,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SA1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

    def test_targeted_ocr_proof_is_bound_to_project_block_and_accepted_regions(self):
        inputs = [
            region("thickness", '6" THK.', 0.10, 0.15),
            region("reinforced", "REINFORCED", 0.22, 0.15),
            region("concrete", "CONCRETE", 0.36, 0.15),
            region("slab", "SLAB", 0.49, 0.15),
        ]
        _facts, initial, _unresolved = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        assert initial is not None
        block = initial["blocks"][0]
        pass_proof = {
            "pass": "primary",
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "3" * 64,
            "analysisRegionIds": ["thickness"],
        }
        proof = {
            "targetKind": "standalone_slab_legend",
            "bounds": block["bounds"],
            "state": "completed",
            "projectId": "2321 Compliance Project",
            "pageNumber": 2,
            "sourceSha256": SOURCE_2321,
            "evidenceVersion": EVIDENCE_VERSION,
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "4" * 64,
            "analysisRegionIds": ["thickness"],
            "analysisPasses": [pass_proof, {**pass_proof, "pass": "corroboration"}],
            "structuredTableBlockId": block["id"],
            "structuredTableSchema": block["schema"],
            "trustedRegionIds": ["thickness"],
            "trustedRegionCount": 1,
            "rejectedRegionCount": 0,
        }
        facts, analysis, _ = analyze_page_structured_tables(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            page_number=2,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="SB-1.1",
            regions=inputs,
            block_hints=[{
                "schema": "slab_legend",
                "bounds": {"x": 0.05, "y": 0.05, "width": 0.85, "height": 0.60},
            }],
        )
        assert analysis is not None
        rebound = rebind_targeted_ocr_proofs(
            initial,
            analysis,
            [proof],
            available_region_ids=[item["id"] for item in inputs],
        )
        self.assertEqual(len(rebound), 1)
        analysis = attach_rebound_targeted_ocr_proofs(analysis, rebound)
        self.assertEqual(
            analysis["targetedOcrProofs"][0]["requestedStructuredTableBlockId"],
            block["id"],
        )
        self.assertEqual(
            analysis["targetedOcrProofs"][0]["structuredTableBlockId"],
            analysis["blocks"][0]["id"],
        )
        persisted = persisted_regions(inputs, facts, analysis)
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                analysis,
                regions=persisted,
                expected_project_id="2321 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2321,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SB-1.1",
            ),
            [],
        )

        forged = copy.deepcopy(analysis)
        forged["targetedOcrProofs"][0]["projectId"] = "2375 Compliance Project"
        forged["analysisSha256"] = structured_table_analysis_sha256(forged)
        failures = validate_persisted_structured_table_analysis(
            forged,
            regions=persisted,
            expected_project_id="2321 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2321,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SB-1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

        forged = copy.deepcopy(analysis)
        forged["targetedOcrProofs"][0]["trustedRegionIds"] = ["reinforced"]
        forged["analysisSha256"] = structured_table_analysis_sha256(forged)
        failures = validate_persisted_structured_table_analysis(
            forged,
            regions=persisted,
            expected_project_id="2321 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2321,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SB-1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

        for mutate in (
            lambda proof: proof.update({
                "requestedStructuredTableBlockId": "block:forged-request",
            }),
            lambda proof: proof["requestedStructuredTableBlock"].update({
                "regionIds": ["reinforced"],
            }),
        ):
            forged = copy.deepcopy(analysis)
            mutate(forged["targetedOcrProofs"][0])
            forged["analysisSha256"] = structured_table_analysis_sha256(forged)
            failures = validate_persisted_structured_table_analysis(
                forged,
                regions=persisted,
                expected_project_id="2321 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2321,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SB-1.1",
            )
            self.assertIn("structured_table_proof_invalid", failures)

    def test_rebind_accepts_exact_live_geometry_drift_but_rejects_ambiguity(self):
        identity = {
            "projectId": "2321 Compliance Project",
            "sourceSha256": SOURCE_2321,
            "pageNumber": 2,
            "evidenceVersion": EVIDENCE_VERSION,
            "sheetNumber": "SB-1.1",
            "fingerprint": "page:test",
        }
        requested_bounds = {
            "x": 0.648175, "y": 0.123456,
            "width": 0.273809, "height": 0.100222,
        }
        final_bounds = {
            "x": 0.648096, "y": 0.123456,
            "width": 0.279024, "height": 0.100333,
        }
        initial = {
            "pageIdentity": identity,
            "blocks": [{
                "id": "block:requested",
                "pageFingerprint": identity["fingerprint"],
                "projectId": identity["projectId"],
                "sourceSha256": identity["sourceSha256"],
                "pageNumber": identity["pageNumber"],
                "evidenceVersion": identity["evidenceVersion"],
                "schema": "footing_schedule",
                "bounds": requested_bounds,
                "regionIds": ["baseline"],
                "detectionMethod": "coordinate_anchor_fallback",
                "label": None,
            }],
        }
        final_block = {
            "id": "block:final",
            "schema": "footing_schedule",
            "bounds": final_bounds,
            "regionIds": ["baseline", "targeted"],
        }
        refined = {"pageIdentity": identity, "blocks": [final_block]}
        proof = {
            "projectId": "2321 Compliance Project",
            "sourceSha256": SOURCE_2321,
            "pageNumber": 2,
            "evidenceVersion": EVIDENCE_VERSION,
            "structuredTableBlockId": "block:requested",
            "structuredTableSchema": "footing_schedule",
            "bounds": requested_bounds,
            "trustedRegionIds": ["targeted"],
        }

        rebound = rebind_targeted_ocr_proofs(
            initial, refined, [proof], available_region_ids=["baseline", "targeted"],
        )

        self.assertEqual(len(rebound), 1)
        self.assertEqual(rebound[0]["requestedStructuredTableBlockId"], "block:requested")
        self.assertEqual(rebound[0]["structuredTableBlockId"], "block:final")
        self.assertEqual(
            rebound[0]["structuredTableBindingMethod"],
            "trusted_regions_in_near_exact_final_bounds",
        )

        ambiguous = {
            **refined,
            "blocks": [
                final_block,
                {**final_block, "id": "block:ambiguous"},
            ],
        }
        self.assertEqual(
            rebind_targeted_ocr_proofs(
                initial,
                ambiguous,
                [proof],
                available_region_ids=["baseline", "targeted"],
            ),
            [],
        )

    def test_rebind_discards_mismatch_missing_and_unclaimed_trusted_ids(self):
        inputs = [
            region("f1", "F1", 0.10, 0.15),
            region("f1-d", '5\'-0" x 5\'-0" x 18"', 0.24, 0.15, 0.22),
        ]
        _facts, initial, _ = analyze(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            sheet_number="SA1.1",
            schema="footing_schedule",
            regions=inputs,
        )
        assert initial is not None
        block = initial["blocks"][0]
        base_proof = {
            "projectId": "2375 Compliance Project",
            "sourceSha256": SOURCE_2375,
            "pageNumber": 2,
            "evidenceVersion": EVIDENCE_VERSION,
            "structuredTableBlockId": block["id"],
            "structuredTableSchema": block["schema"],
            "bounds": block["bounds"],
            "trustedRegionIds": ["missing"],
        }
        for proof in (
            base_proof,
            {**base_proof, "sourceSha256": SOURCE_2321},
            {**base_proof, "structuredTableSchema": "slab_legend"},
            {**base_proof, "bounds": {"x": 0.8, "y": 0.8, "width": 0.1, "height": 0.1}},
        ):
            with self.subTest(proof=proof):
                self.assertEqual(
                    rebind_targeted_ocr_proofs(
                        initial,
                        initial,
                        [proof],
                        available_region_ids=[item["id"] for item in inputs],
                    ),
                    [],
                )

    def test_overlapping_targeted_id_survives_full_analysis_rebind_and_validation(self):
        inputs = [
            region("f1", "F1", 0.10, 0.15),
            region("f1-d", '5\'-0" x 5\'-0" x 18"', 0.24, 0.15, 0.22),
            region("f1-r", "6-#5", 0.55, 0.15),
            region("f2", "F2", 0.10, 0.28),
            region("f2-d", '4\'-0" x 4\'-0" x 18"', 0.24, 0.28, 0.22),
        ]
        hints = [{
            "schema": "footing_schedule",
            "bounds": {"x": 0.05, "y": 0.05, "width": 0.85, "height": 0.60},
        }]
        _initial_facts, initial, _ = analyze_page_structured_tables(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            page_number=2,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="SA1.1",
            regions=inputs,
            block_hints=hints,
        )
        assert initial is not None
        requested_block = initial["blocks"][0]
        targeted = [
            {
                **region("target-overlap", "6-#5", 0.55, 0.15),
                "source": "structured_table_coordinate_ocr_primary",
                "ocrKind": "word",
                "structuredTableTargetedOcrProofRegion": True,
            },
            {
                **region("target-f2-r", "5-#5", 0.55, 0.28),
                "source": "structured_table_coordinate_ocr_primary",
                "ocrKind": "word",
                "structuredTableTargetedOcrProofRegion": True,
            },
        ]
        facts, refined, _ = analyze_page_structured_tables(
            project_id="2375 Compliance Project",
            source_sha256=SOURCE_2375,
            page_number=2,
            evidence_version=EVIDENCE_VERSION,
            sheet_number="SA1.1",
            regions=[*inputs, *targeted],
            block_hints=hints,
        )
        assert refined is not None
        final_block = refined["blocks"][0]
        self.assertTrue({"target-overlap", "target-f2-r"}.issubset(
            set(final_block["regionIds"]),
        ))
        self.assertNotEqual(requested_block["id"], final_block["id"])
        pass_proof = {
            "pass": "primary",
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "3" * 64,
            "analysisRegionIds": ["target-overlap", "target-f2-r"],
        }
        proof = {
            "targetKind": "standalone_footing_schedule",
            "bounds": requested_block["bounds"],
            "state": "completed",
            "projectId": "2375 Compliance Project",
            "pageNumber": 2,
            "sourceSha256": SOURCE_2375,
            "evidenceVersion": EVIDENCE_VERSION,
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "4" * 64,
            "analysisRegionIds": ["target-overlap", "target-f2-r"],
            "analysisPasses": [
                pass_proof,
                {**pass_proof, "pass": "corroboration"},
            ],
            "structuredTableBlockId": requested_block["id"],
            "structuredTableSchema": requested_block["schema"],
            "trustedRegionIds": ["target-overlap", "target-f2-r"],
            "trustedRegionCount": 2,
            "rejectedRegionCount": 0,
        }
        rebound = rebind_targeted_ocr_proofs(
            initial,
            refined,
            [proof],
            available_region_ids=[
                item["id"] for item in [*inputs, *targeted]
            ],
        )
        self.assertEqual(len(rebound), 1)
        self.assertEqual(rebound[0]["structuredTableBlockId"], final_block["id"])
        analysis = attach_rebound_targeted_ocr_proofs(refined, rebound)
        persisted = persisted_regions([*inputs, *targeted], facts, analysis)
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                analysis,
                regions=persisted,
                expected_project_id="2375 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2375,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SA1.1",
            ),
            [],
        )

        duplicate = attach_rebound_targeted_ocr_proofs(
            refined,
            [rebound[0], dict(rebound[0])],
        )
        failures = validate_persisted_structured_table_analysis(
            duplicate,
            regions=persisted,
            expected_project_id="2375 Compliance Project",
            expected_page_number=2,
            expected_source_sha256=SOURCE_2375,
            expected_evidence_version=EVIDENCE_VERSION,
            expected_sheet_number="SA1.1",
        )
        self.assertIn("structured_table_proof_invalid", failures)

    def test_rebind_rejects_two_requested_proofs_mapping_to_one_final_block(self):
        identity = {
            "projectId": "2375 Compliance Project",
            "sourceSha256": SOURCE_2375,
            "pageNumber": 2,
            "evidenceVersion": EVIDENCE_VERSION,
            "sheetNumber": "SA1.1",
            "fingerprint": "page:test",
        }
        bounds = {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.2}
        initial = {
            "pageIdentity": identity,
            "blocks": [
                {
                    "id": "block:requested-a",
                    "pageFingerprint": identity["fingerprint"],
                    "projectId": identity["projectId"],
                    "sourceSha256": identity["sourceSha256"],
                    "pageNumber": identity["pageNumber"],
                    "evidenceVersion": identity["evidenceVersion"],
                    "schema": "footing_schedule",
                    "bounds": bounds,
                    "regionIds": ["a"],
                    "detectionMethod": "coordinate_anchor_fallback",
                    "label": None,
                },
                {
                    "id": "block:requested-b",
                    "pageFingerprint": identity["fingerprint"],
                    "projectId": identity["projectId"],
                    "sourceSha256": identity["sourceSha256"],
                    "pageNumber": identity["pageNumber"],
                    "evidenceVersion": identity["evidenceVersion"],
                    "schema": "footing_schedule",
                    "bounds": bounds,
                    "regionIds": ["b"],
                    "detectionMethod": "coordinate_anchor_fallback",
                    "label": None,
                },
            ],
        }
        refined = {
            "pageIdentity": identity,
            "blocks": [{
                "id": "block:final",
                "schema": "footing_schedule",
                "bounds": bounds,
                "regionIds": ["a", "b"],
            }],
        }
        base = {
            "projectId": "2375 Compliance Project",
            "sourceSha256": SOURCE_2375,
            "pageNumber": 2,
            "evidenceVersion": EVIDENCE_VERSION,
            "structuredTableSchema": "footing_schedule",
            "bounds": bounds,
        }
        proofs = [
            {
                **base,
                "structuredTableBlockId": "block:requested-a",
                "trustedRegionIds": ["a"],
            },
            {
                **base,
                "structuredTableBlockId": "block:requested-b",
                "trustedRegionIds": ["b"],
            },
        ]
        self.assertEqual(
            rebind_targeted_ocr_proofs(
                initial,
                refined,
                proofs,
                available_region_ids=["a", "b"],
            ),
            [],
        )
        self.assertEqual(
            rebind_targeted_ocr_proofs(
                initial,
                refined,
                [proofs[0], dict(proofs[0])],
                available_region_ids=["a", "b"],
            ),
            [],
        )

    def test_validator_accepts_legacy_v1_exact_block_proof_only(self):
        inputs = [
            region("thickness", '6" THK.', 0.10, 0.15),
            region("reinforced", "REINFORCED", 0.22, 0.15),
            region("concrete", "CONCRETE", 0.36, 0.15),
            region("slab", "SLAB", 0.49, 0.15),
        ]
        facts, analysis, _ = analyze(
            project_id="2321 Compliance Project",
            source_sha256=SOURCE_2321,
            sheet_number="SB-1.1",
            schema="slab_legend",
            regions=inputs,
        )
        assert analysis is not None
        block = analysis["blocks"][0]
        pass_proof = {
            "pass": "primary",
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "3" * 64,
            "analysisRegionIds": ["thickness"],
        }
        legacy_proof = {
            "targetKind": "standalone_slab_legend",
            "bounds": block["bounds"],
            "state": "completed",
            "projectId": "2321 Compliance Project",
            "pageNumber": 2,
            "sourceSha256": SOURCE_2321,
            "evidenceVersion": EVIDENCE_VERSION,
            "renderSha256": "1" * 64,
            "analysisInputSha256": "2" * 64,
            "analysisSha256": "4" * 64,
            "analysisRegionIds": ["thickness"],
            "analysisPasses": [
                pass_proof,
                {**pass_proof, "pass": "corroboration"},
            ],
            "structuredTableBlockId": block["id"],
            "structuredTableSchema": block["schema"],
            "trustedRegionIds": ["thickness"],
            "trustedRegionCount": 1,
            "rejectedRegionCount": 0,
        }
        legacy = attach_rebound_targeted_ocr_proofs(analysis, [legacy_proof])
        persisted = persisted_regions(inputs, facts, legacy)
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                legacy,
                regions=persisted,
                expected_project_id="2321 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2321,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SB-1.1",
            ),
            [],
        )
        forged = copy.deepcopy(legacy)
        forged["targetedOcrProofs"][0]["bounds"] = {
            "x": 0.10, "y": 0.10, "width": 0.10, "height": 0.10,
        }
        forged["analysisSha256"] = structured_table_analysis_sha256(forged)
        self.assertIn(
            "structured_table_proof_invalid",
            validate_persisted_structured_table_analysis(
                forged,
                regions=persisted,
                expected_project_id="2321 Compliance Project",
                expected_page_number=2,
                expected_source_sha256=SOURCE_2321,
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number="SB-1.1",
            ),
        )
if __name__ == "__main__":
    unittest.main()
