import json
import random
import unittest

from ecos_indexer.structured_tables import (
    ResourceLimits,
    StructuredTableInputRejected,
    StructuredTableResourceRejected,
    detect_blocks,
    evaluate_blocks,
)


SOURCE_SHA = "a" * 64


def page_identity(*, project="2321-project", sheet="SB-1.1", page=2, sha=SOURCE_SHA):
    return {
        "projectId": project,
        "sourceSha256": sha,
        "pageNumber": page,
        "evidenceVersion": "ecos-hosted-evidence/structured-tables-v1",
        "sheetNumber": sheet,
    }


def word(region_id, text, x, y, width=0.06, height=0.014, *, source="coordinate_ocr", **extra):
    return {
        "id": region_id,
        "text": text,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "confidence": 0.98,
        "source": source,
        **extra,
    }


def evaluate(schema, regions, *, identity=None, bounds=None):
    selected_identity = identity or page_identity()
    selected_bounds = bounds or {"x": 0.01, "y": 0.01, "width": 0.98, "height": 0.98}
    blocks = detect_blocks(
        selected_identity,
        regions,
        block_hints=[{"schema": schema, "bounds": selected_bounds}],
    )
    return evaluate_blocks(selected_identity, blocks, regions)


def relationships_by_key(result):
    return {item["rowKey"]: item for item in result["relationships"]}


class StructuredTableContractTests(unittest.TestCase):
    def test_rejects_flattened_text_without_coordinate_bounds(self):
        with self.assertRaisesRegex(StructuredTableInputRejected, "coordinate_bounds_required"):
            detect_blocks(page_identity(), [{"id": "flat", "text": "F1 5x5 6-#5"}])

    def test_rejects_cross_project_source_page_and_version_inputs(self):
        identity = page_identity()
        variants = {
            "region_project_mismatch": {"projectId": "2375-project"},
            "region_source_mismatch": {"sourceSha256": "b" * 64},
            "region_page_mismatch": {"pageNumber": 3},
            "region_evidence_version_mismatch": {"evidenceVersion": "older"},
        }
        for code, extra in variants.items():
            with self.subTest(code=code):
                with self.assertRaisesRegex(StructuredTableInputRejected, code):
                    detect_blocks(identity, [word("r", "SLAB", 0.1, 0.1, **extra)])

    def test_vector_ruled_grid_detects_a_coordinate_bound_schema(self):
        regions = [
            word("thk", '6" THK.', 0.15, 0.15),
            word("reinforced", "REINFORCED", 0.23, 0.15),
            word("concrete", "CONCRETE", 0.32, 0.15),
            word("slab", "SLAB", 0.41, 0.15),
        ]
        segments = [
            {"id": "h1", "x1": 0.10, "y1": 0.10, "x2": 0.50, "y2": 0.10},
            {"id": "h2", "x1": 0.10, "y1": 0.25, "x2": 0.50, "y2": 0.25},
            {"id": "v1", "x1": 0.10, "y1": 0.10, "x2": 0.10, "y2": 0.25},
            {"id": "v2", "x1": 0.50, "y1": 0.10, "x2": 0.50, "y2": 0.25},
        ]
        blocks = detect_blocks(page_identity(), regions, segments)
        vector_blocks = [block for block in blocks if block["detectionMethod"] == "vector_ruled_grid"]
        self.assertEqual(len(vector_blocks), 1)
        self.assertEqual(vector_blocks[0]["schema"], "slab_legend")
        self.assertEqual(set(vector_blocks[0]["regionIds"]), {item["id"] for item in regions})

    def test_exact_pcc_paving_note_is_complete_without_inventing_reinforcement(self):
        regions = [
            word("construct", "CONSTRUCT 6.0\u201d THICK", 0.10, 0.15, width=0.20),
            word("pcc", "PCC PAVING", 0.31, 0.15, width=0.12),
            word("overlay", "2\u201d AC GRIND AND OVERLAY", 0.10, 0.42, width=0.24),
            word("walkway", "PCC WALKWAYS", 0.35, 0.42, width=0.12),
        ]

        blocks = detect_blocks(page_identity(sheet="C6"), regions)
        result = evaluate_blocks(page_identity(sheet="C6"), blocks, regions)

        self.assertEqual(len(result["relationships"]), 1)
        relationship = result["relationships"][0]
        self.assertEqual(relationship["status"], "complete")
        self.assertEqual(relationship["rowKey"], "pcc-paving")
        self.assertEqual(relationship["roles"]["thickness"]["value"], 6.0)
        self.assertEqual(relationship["roles"]["material"]["value"], "concrete")
        self.assertNotIn("reinforcement", relationship["requiredRoles"])
        self.assertNotIn("overlay", blocks[0]["regionIds"])

    def test_pcc_paving_label_without_thickness_cannot_become_a_fact(self):
        regions = [word("pcc", "PCC PAVING", 0.10, 0.15, width=0.12)]

        blocks = detect_blocks(page_identity(sheet="C6"), regions)

        self.assertFalse(any(block["schema"] == "slab_legend" for block in blocks))

    def test_structural_detail_reference_cannot_become_slab_thickness(self):
        regions = [
            word("detail", 'SEE DETAIL "4/SD-1” FOR TYPICAL EDGE OF SLAB.', 0.10, 0.15, width=0.42),
            word("slab", "SLAB", 0.54, 0.15),
        ]

        result = evaluate("slab_legend", regions)

        self.assertFalse(any(
            role.get("value") == 1.0
            for relationship in result["relationships"]
            for role in relationship.get("roles", {}).values()
            if isinstance(role, dict)
        ))

    def test_slab_relationship_is_complete_and_needs_no_ocr_when_native_boxes_suffice(self):
        regions = [
            word("thickness", '6" THK.', 0.10, 0.10, source="embedded_text"),
            word("reinforced", "REINFORCED", 0.18, 0.10, source="embedded_text"),
            word("concrete", "CONCRETE", 0.29, 0.10, source="embedded_text"),
            word("slab", "SLAB", 0.39, 0.10, source="embedded_text"),
            word("add", "ADD.", 0.47, 0.10, source="embedded_text"),
        ]
        result = evaluate("slab_legend", regions)
        relationship = result["relationships"][0]
        self.assertEqual(relationship["status"], "complete")
        self.assertEqual(relationship["roles"]["thickness"]["value"], 6.0)
        self.assertEqual(relationship["roles"]["thickness"]["unit"], "in")
        self.assertEqual(relationship["roles"]["material"]["value"], "concrete")
        self.assertEqual(relationship["roles"]["reinforcement"]["value"], "reinforced")
        self.assertNotIn("addition", json.dumps(relationship).lower())
        self.assertEqual(result["targetedOcrRequests"], [])

    def test_three_footing_rows_keep_exact_dimensions_and_reinforcing(self):
        regions = [
            word("mark", "MARK", 0.10, 0.05),
            word("footing", "FOOTING", 0.25, 0.05),
            word("reinforcing", "REINFORCING", 0.55, 0.05),
            word("f1", "F1", 0.10, 0.15),
            word("f1-d", "5'-0\" x 5'-0\" x 18\"", 0.25, 0.15, width=0.22),
            word("f1-r", "6-#5 E.W. (T&B)", 0.55, 0.15, width=0.18),
            word("f2", "F2", 0.10, 0.25),
            word("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.25, 0.25, width=0.22),
            word("f2-r", "5-#5", 0.55, 0.25),
            word("f3", "F3", 0.10, 0.35),
            word("f3-d", "3'-0\" x 3'-0\" x 18\"", 0.25, 0.35, width=0.22),
            word("f3-r", "4-#5", 0.55, 0.35),
        ]
        result = evaluate("footing_schedule", regions)
        rows = relationships_by_key(result)
        self.assertEqual(set(rows), {"F1", "F2", "F3"})
        self.assertTrue(all(row["status"] == "complete" for row in rows.values()))
        self.assertEqual(rows["F1"]["roles"]["reinforcing"]["value"], "6-#5 E.W. (T&B)")
        self.assertEqual(rows["F2"]["roles"]["dimensions"]["value"], "4'-0\" x 4'-0\" x 18\"")
        self.assertEqual(rows["F3"]["roles"]["reinforcing"]["value"], "4-#5")

    def test_missing_one_footing_cell_marks_only_that_row_incomplete_and_requests_one_retry(self):
        regions = [
            word("f1", "F1", 0.10, 0.15),
            word("f1-d", "5'-0\" x 5'-0\" x 18\"", 0.25, 0.15, width=0.22),
            word("f1-r", "6-#5", 0.55, 0.15),
            word("f2", "F2", 0.10, 0.25),
            word("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.25, 0.25, width=0.22),
            word("f3", "F3", 0.10, 0.35),
            word("f3-d", "3'-0\" x 3'-0\" x 18\"", 0.25, 0.35, width=0.22),
            word("f3-r", "4-#5", 0.55, 0.35),
        ]
        result = evaluate("footing_schedule", regions)
        rows = relationships_by_key(result)
        self.assertEqual(rows["F1"]["status"], "complete")
        self.assertEqual(rows["F2"]["status"], "incomplete")
        self.assertEqual(rows["F2"]["missingRoles"], ["reinforcing"])
        self.assertEqual(rows["F3"]["status"], "complete")
        self.assertEqual(len(result["targetedOcrRequests"]), 1)
        self.assertEqual(result["targetedOcrRequests"][0]["relationshipId"], rows["F2"]["id"])

    def test_footing_cells_do_not_infer_missing_foot_or_bar_marks(self):
        regions = [
            word("f1", "F1", 0.10, 0.15),
            word("f1-d", "5'-0\" x 5-0\" x 18\"", 0.25, 0.15, width=0.22),
            word("f1-r", "6-#5", 0.55, 0.15),
            word("f2", "F2", 0.10, 0.25),
            word("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.25, 0.25, width=0.22),
            word("f2-r", "5-5", 0.55, 0.25),
        ]
        rows = relationships_by_key(evaluate("footing_schedule", regions))
        self.assertEqual(rows["F1"]["status"], "incomplete")
        self.assertEqual(rows["F1"]["missingRoles"], ["dimensions"])
        self.assertNotIn("dimensions", rows["F1"]["roles"])
        self.assertEqual(rows["F2"]["status"], "incomplete")
        self.assertEqual(rows["F2"]["missingRoles"], ["reinforcing"])
        self.assertNotIn("reinforcing", rows["F2"]["roles"])

    def test_conflicting_reinforcing_stays_in_f2_and_never_fills_f3(self):
        regions = [
            word("f2", "F2", 0.10, 0.20),
            word("f2-d", "4'-0\" x 4'-0\" x 18\"", 0.25, 0.20, width=0.22),
            word("f2-r", "5-#5", 0.55, 0.20),
            word("moved-f3-r", "4-#5", 0.65, 0.20),
            word("f3", "F3", 0.10, 0.35),
            word("f3-d", "3'-0\" x 3'-0\" x 18\"", 0.25, 0.35, width=0.22),
        ]
        result = evaluate("footing_schedule", regions)
        rows = relationships_by_key(result)
        self.assertEqual(rows["F2"]["status"], "conflicted")
        self.assertIn("ambiguous_role:reinforcing", rows["F2"]["conflictCodes"])
        self.assertEqual(rows["F3"]["status"], "incomplete")
        self.assertNotIn("reinforcing", rows["F3"]["roles"])

    def test_equipment_records_preserve_airflow_and_service_by_identifier(self):
        regions = [
            word("ef1", "EF-1", 0.10, 0.10),
            word("ef1-air", "100 CFM", 0.25, 0.10),
            word("ef1-service", "4 RESTROOMS + 1 JANITOR CLOSET", 0.40, 0.10, width=0.30),
            word("ef2", "EF-2", 0.10, 0.22),
            word("ef2-air", "630 CFM", 0.25, 0.22),
            word("ef2-service", "3 CONTROL ROOMS", 0.40, 0.22, width=0.20),
            word("ef3", "EF-3", 0.10, 0.34),
            word("ef3-air", "630 CFM", 0.25, 0.34),
            word("ef3-service", "2 CONTROL ROOMS", 0.40, 0.34, width=0.20),
        ]
        result = evaluate("equipment_schedule", regions)
        rows = relationships_by_key(result)
        self.assertEqual(rows["EF-1"]["roles"]["airflow"]["value"], 100)
        self.assertEqual(rows["EF-1"]["roles"]["service"]["value"], "4 restrooms + 1 janitor closet")
        self.assertEqual(rows["EF-2"]["roles"]["service"]["value"], "3 control rooms")
        self.assertEqual(rows["EF-3"]["roles"]["service"]["value"], "2 control rooms")

    def test_unanchored_equipment_values_do_not_attach_to_previous_record(self):
        regions = [
            word("ef2", "EF-2", 0.10, 0.18),
            word("ef2-air", "630 CFM", 0.25, 0.18),
            word("ef2-service", "3 CONTROL ROOMS", 0.40, 0.18),
            word("loose-air", "630 CFM", 0.25, 0.44),
            word("loose-service", "2 CONTROL ROOMS", 0.40, 0.44),
        ]
        result = evaluate("equipment_schedule", regions)
        rows = relationships_by_key(result)
        self.assertEqual(set(rows), {"EF-2"})
        self.assertEqual(rows["EF-2"]["status"], "complete")
        self.assertEqual(rows["EF-2"]["roles"]["service"]["value"], "3 control rooms")

    def test_split_equipment_identifier_keeps_multiline_record_coordinate_bound(self):
        regions = [
            word("ef", "EF", 0.10, 0.10),
            word("dash", "-", 0.14, 0.10, width=0.01),
            word("one", "1", 0.16, 0.10, width=0.01),
            word("air", "100 CFM AT .2 IN SP", 0.25, 0.125, width=0.22),
            word("service", "TYPICAL FOR 4 RESTROOMS AND 1 JAN CLOSET", 0.25, 0.145, width=0.36),
        ]
        rows = relationships_by_key(evaluate("equipment_schedule", regions))
        self.assertEqual(set(rows), {"EF-1"})
        self.assertEqual(rows["EF-1"]["status"], "complete")
        self.assertEqual(rows["EF-1"]["roles"]["airflow"]["value"], 100)
        self.assertEqual(
            rows["EF-1"]["roles"]["service"]["value"],
            "4 restrooms + 1 janitor closet",
        )
        self.assertEqual(
            set(rows["EF-1"]["roles"]["identifier"]["constituentIds"]),
            {"ef", "dash", "one"},
        )

    def test_equipment_identifier_owns_following_multiline_cells_until_next_identifier(self):
        regions = [
            word("ef1", "EF-1", 0.10, 0.100),
            word("ef1-air", "100 CFM AT .2 IN SP", 0.25, 0.112, width=0.22),
            word("ef1-service", "TYPICAL FOR 4 RESTROOMS AND 1 JAN CLOSET", 0.25, 0.128, width=0.36),
            word("ef2", "EF-2", 0.10, 0.150),
            word("ef2-air", "630 CFM", 0.25, 0.162),
            word("ef2-service", "3 CONTROL ROOMS", 0.25, 0.178, width=0.20),
            word("ef3", "EF-3", 0.10, 0.200),
            word("ef3-air", "630 CFM", 0.25, 0.212),
            word("ef3-service", "2 CONTROL ROOMS", 0.25, 0.228, width=0.20),
        ]
        rows = relationships_by_key(evaluate("equipment_schedule", regions))
        self.assertEqual(set(rows), {"EF-1", "EF-2", "EF-3"})
        self.assertTrue(all(row["status"] == "complete" for row in rows.values()))
        self.assertEqual(rows["EF-1"]["roles"]["airflow"]["constituentIds"], ["ef1-air"])
        self.assertEqual(rows["EF-1"]["roles"]["service"]["constituentIds"], ["ef1-service"])
        self.assertNotIn("ef2", {
            item["id"] for item in rows["EF-1"]["constituents"]
        })

    def test_dense_mechanical_terms_without_hydrozone_primary_anchor_detect_no_hydrozone(self):
        regions = [
            word("high", "HIGH", 0.10, 0.10),
            word("medium", "MEDIUM", 0.20, 0.10),
            word("low", "LOW", 0.32, 0.10),
            word("air", "AIR PRESSURE", 0.10, 0.14),
            word("equipment", "MECHANICAL EQUIPMENT SCHEDULE", 0.10, 0.18, width=0.30),
            word("cfm", "CFM", 0.44, 0.18),
            word("ef1", "EF-1", 0.10, 0.22),
        ]
        blocks = detect_blocks(page_identity(sheet="MB-1.2"), regions)
        self.assertNotIn("hydrozone_summary", {block["schema"] for block in blocks})
        self.assertIn("equipment_schedule", {block["schema"] for block in blocks})

    def test_fixture_table_has_three_direct_facts_and_an_independent_sum_cross_check(self):
        regions = [
            word("center-head", "CENTER", 0.12, 0.08),
            word("center-total", "TOTAL", 0.12, 0.20),
            word("center-value", "35", 0.22, 0.20),
            word("east-head", "EAST", 0.55, 0.08),
            word("east-total", "TOTAL", 0.55, 0.20),
            word("east-value", "30", 0.65, 0.20),
            word("calc-label", "FIXTURE TOTAL", 0.20, 0.40, width=0.12),
            word("calc-center-value", "35", 0.35, 0.40),
            word("calc-center-label", "CENTER", 0.42, 0.40),
            word("calc-east-value", "30", 0.52, 0.40),
            word("calc-east-label", "EAST", 0.59, 0.40),
            word("calc-overall", "65", 0.75, 0.40),
        ]
        result = evaluate("fixture_unit_totals", regions)
        rows = relationships_by_key(result)
        self.assertEqual(rows["center"]["roles"]["totalFixtureUnits"]["value"], 35)
        self.assertEqual(rows["east"]["roles"]["totalFixtureUnits"]["value"], 30)
        self.assertEqual(rows["overall"]["type"], "fixture_unit_printed_overall")
        self.assertEqual(rows["overall"]["roles"]["totalFixtureUnits"]["value"], 65)
        self.assertEqual(len(result["derivations"]), 1)
        derivation = result["derivations"][0]
        self.assertEqual(derivation["operator"], "sum")
        self.assertEqual(derivation["value"], 65)
        self.assertEqual(derivation["classification"], "deterministic_derivation_not_visible_drawing_fact")
        self.assertEqual(derivation["printedCrossCheck"]["status"], "matches")
        self.assertIn("calc-overall", derivation["printedCrossCheck"]["constituentIds"])

    def test_vertical_fixture_tables_skip_total_column_headers(self):
        regions = [
            word("center-head", "CENTER", 0.12, 0.06),
            word("center-column-total", "TOTAL", 0.30, 0.08),
            word("center-total", "TOTAL", 0.12, 0.12),
            word("center-cw", "CW FU", 0.20, 0.12),
            word("center-value", "35", 0.30, 0.12),
            word("east-head", "EAST", 0.12, 0.20),
            word("east-column-total", "TOTAL", 0.30, 0.22),
            word("east-total", "TOTAL", 0.12, 0.27),
            word("east-cw", "CW FU", 0.20, 0.27),
            word("east-value", "30", 0.30, 0.27),
        ]

        result = evaluate("fixture_unit_totals", regions)
        rows = relationships_by_key(result)

        self.assertEqual(rows["center"]["roles"]["totalFixtureUnits"]["value"], 35)
        self.assertEqual(rows["east"]["roles"]["totalFixtureUnits"]["value"], 30)
        self.assertEqual(result["derivations"][0]["value"], 65)

    def test_printed_fixture_overall_conflict_marks_derivation_and_page_conflicted(self):
        regions = [
            word("center-head", "CENTER", 0.12, 0.08),
            word("center-total", "TOTAL", 0.12, 0.20),
            word("center-value", "35", 0.22, 0.20),
            word("east-head", "EAST", 0.55, 0.08),
            word("east-total", "TOTAL", 0.55, 0.20),
            word("east-value", "30", 0.65, 0.20),
            word("calc-label", "FIXTURE TOTAL", 0.20, 0.40, width=0.12),
            word("calc-center-value", "35", 0.35, 0.40),
            word("calc-center-label", "CENTER", 0.42, 0.40),
            word("calc-east-value", "30", 0.52, 0.40),
            word("calc-east-label", "EAST", 0.59, 0.40),
            word("calc-overall-conflict", "66", 0.75, 0.40),
        ]
        result = evaluate("fixture_unit_totals", regions)
        self.assertTrue(all(item["status"] == "complete" for item in result["relationships"]))
        self.assertEqual(result["derivations"][0]["value"], 65)
        self.assertEqual(result["derivations"][0]["status"], "conflicted")
        self.assertEqual(
            result["derivations"][0]["printedCrossCheck"]["status"],
            "conflicted",
        )
        self.assertEqual(result["status"], "conflicted")

    def test_unrelated_35_and_east_30_cannot_create_a_fixture_sum(self):
        regions = [
            word("unrelated", "35", 0.10, 0.10),
            word("east-head", "EAST", 0.55, 0.08),
            word("east-total", "TOTAL", 0.55, 0.20),
            word("east-value", "30", 0.65, 0.20),
        ]
        result = evaluate("fixture_unit_totals", regions)
        self.assertEqual(result["derivations"], [])
        self.assertNotIn("center", relationships_by_key(result))

    def test_numbered_notes_keep_125a_30_poles_and_225a_42_poles_separate(self):
        regions = [
            word("n1", "1.", 0.10, 0.15),
            word("n1-bus", "125A BUS", 0.25, 0.15),
            word("n1-poles", "30 POLES", 0.45, 0.15),
            word("n2", "2.", 0.10, 0.30),
            word("n2-bus", "225A BUS", 0.25, 0.30),
            word("n2-poles", "42 POLES", 0.45, 0.30),
        ]
        rows = relationships_by_key(evaluate("numbered_notes", regions))
        self.assertEqual(rows["1"]["roles"]["busAmps"]["value"], 125)
        self.assertEqual(rows["1"]["roles"]["poles"]["value"], 30)
        self.assertEqual(rows["2"]["roles"]["busAmps"]["value"], 225)
        self.assertEqual(rows["2"]["roles"]["poles"]["value"], 42)

    def test_boxed_note_numbers_are_valid_but_parenthesized_phone_prefix_is_not(self):
        regions = [
            word("n1", "[1]", 0.10, 0.15),
            word("n1-bus", "125A BUS", 0.25, 0.15),
            word("n1-poles", "30 POLES", 0.45, 0.15),
            word("n2", "[2]", 0.10, 0.30),
            word("n2-bus", "225A BUS", 0.25, 0.30),
            word("n2-poles", "42 POLES", 0.45, 0.30),
            word("phone", "(562)", 0.78, 0.42),
            word("phone-rest", "595-7032", 0.86, 0.42),
        ]

        rows = relationships_by_key(evaluate("numbered_notes", regions))

        self.assertEqual(set(rows), {"1", "2"})
        self.assertEqual(rows["1"]["roles"]["busAmps"]["value"], 125)
        self.assertEqual(rows["2"]["roles"]["poles"]["value"], 42)
        self.assertNotIn("562", rows)

    def test_numbered_note_auto_detection_stays_bounded_to_coherent_rows(self):
        regions = [
            word("n1", "1.", 0.10, 0.15),
            word("n1-bus", "125A BUS", 0.25, 0.15),
            word("n1-poles", "30 POLES", 0.45, 0.15),
            word("n2", "2.", 0.10, 0.30),
            word("n2-bus", "225A BUS", 0.25, 0.30),
            word("n2-poles", "42 POLES", 0.45, 0.30),
            word("unrelated-bus", "BUS", 0.80, 0.75),
            word("unrelated-pole", "POLE LED", 0.10, 0.80),
            word("unrelated-note", "99.", 0.12, 0.80),
        ]

        blocks = detect_blocks(page_identity(sheet="E-2.5"), regions)
        note_blocks = [block for block in blocks if block["schema"] == "numbered_notes"]

        self.assertEqual(len(note_blocks), 1)
        self.assertLess(note_blocks[0]["bounds"]["width"], 0.50)
        self.assertLess(note_blocks[0]["bounds"]["height"], 0.25)
        self.assertNotIn("unrelated-bus", note_blocks[0]["regionIds"])
        rows = relationships_by_key(
            evaluate_blocks(page_identity(sheet="E-2.5"), note_blocks, regions),
        )
        self.assertEqual(rows["1"]["roles"]["busAmps"]["value"], 125)
        self.assertEqual(rows["2"]["roles"]["poles"]["value"], 42)

    def test_far_bus_and_pole_labels_do_not_detect_a_numbered_note_block(self):
        regions = [
            word("note", "7.", 0.10, 0.10),
            word("bus", "125A BUS", 0.20, 0.10),
            word("pole", "30 POLES", 0.75, 0.70),
        ]

        blocks = detect_blocks(page_identity(sheet="E-2.5"), regions)

        self.assertFalse(any(block["schema"] == "numbered_notes" for block in blocks))

    def test_panel_row_with_only_one_numeric_role_does_not_open_note_table(self):
        regions = [
            word("panel-row", "562 125A BUS MAIN POLES PANEL", 0.10, 0.10, width=0.40),
        ]

        blocks = detect_blocks(page_identity(sheet="E-2.5"), regions)

        self.assertFalse(any(block["schema"] == "numbered_notes" for block in blocks))

    def test_split_note_roles_do_not_join_across_note_boundaries(self):
        regions = [
            word("n1", "1.", 0.10, 0.15),
            word("n1-bus", "225A BUS", 0.25, 0.15),
            word("n2", "2.", 0.10, 0.30),
            word("n2-poles", "42 POLES", 0.45, 0.30),
        ]
        rows = relationships_by_key(evaluate("numbered_notes", regions))
        self.assertEqual(rows["1"]["status"], "incomplete")
        self.assertEqual(rows["1"]["missingRoles"], ["poles"])
        self.assertEqual(rows["2"]["status"], "incomplete")
        self.assertEqual(rows["2"]["missingRoles"], ["busAmps"])

    def test_bare_pole_counts_cannot_be_promoted_to_numbered_note_anchors(self):
        regions = [
            word("bus-1", "125A BUS", 0.20, 0.15),
            word("poles-1-value", "30", 0.08, 0.15),
            word("poles-1-label", "POLES PANEL", 0.30, 0.15),
            word("bus-2", "225A BUS", 0.20, 0.30),
            word("poles-2-value", "42", 0.08, 0.30),
            word("poles-2-label", "POLES PANEL", 0.30, 0.30),
        ]
        result = evaluate("numbered_notes", regions)
        self.assertEqual(result["relationships"], [])
        self.assertEqual(result["status"], "incomplete")

    def test_photometric_all_row_is_2_6_21_1_0_0(self):
        regions = [
            word("avg", "AVG", 0.35, 0.08),
            word("max", "MAX", 0.50, 0.08),
            word("min", "MIN", 0.65, 0.08),
            word("all", "ALL", 0.10, 0.20),
            word("all-avg", "2.6", 0.35, 0.20),
            word("all-max", "21.1", 0.50, 0.20),
            word("all-min", "0.0", 0.65, 0.20),
            word("spill", "SPILL", 0.10, 0.34),
            word("spill-avg", "0.2", 0.35, 0.34),
            word("spill-max", "1.0", 0.50, 0.34),
            word("spill-min", "0.0", 0.65, 0.34),
        ]
        rows = relationships_by_key(evaluate("photometric_statistics", regions))
        self.assertEqual(rows["ALL"]["status"], "complete")
        self.assertEqual(rows["ALL"]["roles"]["avg"]["value"], 2.6)
        self.assertEqual(rows["ALL"]["roles"]["max"]["value"], 21.1)
        self.assertEqual(rows["ALL"]["roles"]["min"]["value"], 0.0)

    def test_spill_minimum_cannot_fill_a_missing_all_minimum(self):
        regions = [
            word("avg", "AVG", 0.35, 0.08),
            word("max", "MAX", 0.50, 0.08),
            word("min", "MIN", 0.65, 0.08),
            word("all", "ALL", 0.10, 0.20),
            word("all-avg", "2.6", 0.35, 0.20),
            word("all-max", "21.1", 0.50, 0.20),
            word("spill", "SPILL", 0.10, 0.34),
            word("spill-min", "0.0", 0.65, 0.34),
        ]
        rows = relationships_by_key(evaluate("photometric_statistics", regions))
        self.assertEqual(rows["ALL"]["status"], "incomplete")
        self.assertEqual(rows["ALL"]["missingRoles"], ["min"])

    def test_conflicted_spill_light_number_does_not_downgrade_complete_all_row(self):
        regions = [
            word("avg", "AVG", 0.35, 0.08),
            word("max", "MAX", 0.50, 0.08),
            word("min", "MIN", 0.65, 0.08),
            word("all", "ALL", 0.10, 0.20),
            word("all-avg", "2.6", 0.35, 0.20),
            word("all-max", "21.1", 0.50, 0.20),
            word("all-min", "0.0", 0.65, 0.20),
            word("spill", "SPILL", 0.10, 0.34),
            word("spill-light", "LIGHT", 0.24, 0.34),
            word("spill-number", "1", 0.31, 0.34),
            word("spill-avg", "0.1", 0.35, 0.34),
            word("spill-max", "0.4", 0.50, 0.34),
            word("spill-min", "0.0", 0.65, 0.34),
        ]

        rows = relationships_by_key(evaluate("photometric_statistics", regions))

        self.assertEqual(rows["ALL"]["status"], "complete")
        self.assertEqual(rows["ALL"]["roles"]["avg"]["value"], 2.6)
        self.assertEqual(rows["ALL"]["roles"]["max"]["value"], 21.1)
        self.assertEqual(rows["ALL"]["roles"]["min"]["value"], 0.0)
        self.assertEqual(rows["SPILL"]["status"], "conflicted")

    def test_landscape_summary_preserves_area_and_tree_counts(self):
        regions = [
            word("landscape-label", "LANDSCAPE AREA", 0.10, 0.10, width=0.16),
            word("landscape-value", "26,532 SF", 0.35, 0.10),
            word("irrigated-label", "IRRIGATED AREA", 0.10, 0.20, width=0.16),
            word("irrigated-value", "21,104 SF", 0.35, 0.20),
            word("required", "REQUIRED", 0.10, 0.30),
            word("required-value", "71", 0.35, 0.30),
            word("provided", "PROVIDED", 0.10, 0.40),
            word("provided-value", "78", 0.35, 0.40),
        ]
        rows = relationships_by_key(evaluate("landscape_summary", regions))
        self.assertEqual(rows["landscapeArea"]["roles"]["value"]["value"], 26532)
        self.assertEqual(rows["irrigatedArea"]["roles"]["value"]["value"], 21104)
        self.assertEqual(rows["requiredTrees"]["roles"]["value"]["value"], 71)
        self.assertEqual(rows["providedTrees"]["roles"]["value"]["value"], 78)

    def test_hydrozones_and_water_budget_are_separate_coordinate_blocks(self):
        hydro = [
            word("h", "H", 0.10, 0.10), word("h-v", "0 SF", 0.30, 0.10),
            word("m", "M", 0.10, 0.20), word("m-v", "146 SF", 0.30, 0.20),
            word("l", "L", 0.10, 0.30), word("l-v", "9,470 SF", 0.30, 0.30),
        ]
        water = [
            word("etwu", "ETWU", 0.55, 0.55), word("etwu-v", "87,952", 0.75, 0.55),
            word("mawa", "MAWA", 0.55, 0.65), word("mawa-v", "147,191", 0.75, 0.65),
        ]
        identity = page_identity(sheet="L-2")
        blocks = detect_blocks(identity, hydro + water, block_hints=[
            {"schema": "hydrozone_summary", "bounds": {"x": 0.05, "y": 0.05, "width": 0.40, "height": 0.35}},
            {"schema": "water_budget", "bounds": {"x": 0.50, "y": 0.50, "width": 0.45, "height": 0.25}},
        ])
        result = evaluate_blocks(identity, blocks, hydro + water)
        rows = relationships_by_key(result)
        self.assertEqual(rows["high"]["roles"]["area"]["value"], 0)
        self.assertEqual(rows["medium"]["roles"]["area"]["value"], 146)
        self.assertEqual(rows["low"]["roles"]["area"]["value"], 9470)
        self.assertEqual(rows["ETWU"]["roles"]["value"]["value"], 87952)
        self.assertEqual(rows["MAWA"]["roles"]["value"]["value"], 147191)

    def test_hydrozone_area_value_is_proved_by_numeric_cell_not_water_label(self):
        regions = [
            # Small y offsets reproduce the issued L-2 OCR geometry that used
            # to make _joined_text and _phrase_regions disagree about spans.
            word("h", "(H)", 0.10, 0.095, width=0.04, height=0.012),
            word("high", "HIGH", 0.15, 0.10),
            word("water", "WATER", 0.23, 0.10),
            word("zone", "ZONE", 0.32, 0.10),
            word("percent", "(0%)", 0.42, 0.10),
            word("area", "0", 0.55, 0.101),
            word("unit", "SF", 0.59, 0.101),
        ]

        rows = relationships_by_key(evaluate("hydrozone_summary", regions))
        area = rows["high"]["roles"]["area"]

        self.assertEqual(area["value"], 0)
        self.assertTrue(any(
            any(character.isdigit() for character in item["text"])
            for item in area["constituents"]
        ))
        self.assertNotIn("WATER", {item["text"] for item in area["constituents"]})

    def test_water_budget_does_not_borrow_unanchored_values_from_other_rows(self):
        regions = [
            word("etwu", "ETWU", 0.10, 0.10),
            word("mawa", "MAWA", 0.10, 0.20),
            word("loose-etwu", "87,952", 0.30, 0.40),
            word("loose-mawa", "147,191", 0.30, 0.50),
        ]
        rows = relationships_by_key(evaluate("water_budget", regions))
        self.assertEqual(rows["ETWU"]["status"], "incomplete")
        self.assertEqual(rows["ETWU"]["missingRoles"], ["value"])
        self.assertEqual(rows["MAWA"]["status"], "incomplete")
        self.assertEqual(rows["MAWA"]["missingRoles"], ["value"])

    def test_tree_section_excludes_shrub_rows(self):
        regions = [
            word("qty-head", "QTY", 0.10, 0.03),
            word("common-head", "COMMON NAME", 0.25, 0.03, width=0.16),
            word("pf-head", "PF ZONE", 0.60, 0.03),
            word("trees", "TREES", 0.10, 0.08),
            word("t1-q", "6", 0.10, 0.16), word("t1-n", "FOREST PANSY REDBUD", 0.25, 0.16, width=0.24),
            word("t2-q", "12", 0.10, 0.22), word("t2-n", "PALO VERDE", 0.25, 0.22, width=0.16),
            word("t3-q", "3", 0.10, 0.28), word("t3-n", "LEMON SCENTED GUM", 0.25, 0.28, width=0.22),
            word("t4-q", "9", 0.10, 0.34), word("t4-n", "GOLDEN RAIN TREE", 0.25, 0.34, width=0.22),
            word("shrubs", "SHRUBS", 0.10, 0.48),
            word("s1-q", "50", 0.10, 0.56), word("s1-n", "DWARF MYRTLE", 0.25, 0.56),
        ]
        result = evaluate("plant_material", regions)
        observed = {
            item["roles"]["commonName"]["value"]: item["roles"]["quantity"]["value"]
            for item in result["relationships"]
        }
        self.assertEqual(observed, {
            "Forest Pansy Redbud": 6,
            "Palo Verde": 12,
            "Lemon Scented Gum": 3,
            "Golden Rain Tree": 9,
        })
        self.assertNotIn("Dwarf Myrtle", observed)

    def test_missing_trees_boundary_fails_closed_instead_of_borrowing_shrubs(self):
        regions = [
            word("qty-head", "QTY", 0.10, 0.10),
            word("common-head", "COMMON NAME", 0.25, 0.10, width=0.16),
            word("shrubs", "SHRUBS", 0.10, 0.20),
            word("s1-q", "50", 0.10, 0.30), word("s1-n", "DWARF MYRTLE", 0.25, 0.30),
        ]
        result = evaluate("plant_material", regions)
        self.assertEqual(result["relationships"], [])
        self.assertEqual(result["status"], "incomplete")

    def test_duplicate_regions_and_shuffled_input_are_byte_stable(self):
        base = [
            word("thickness", '6" THK.', 0.10, 0.10),
            word("reinforced", "REINFORCED", 0.18, 0.10),
            word("concrete", "CONCRETE", 0.29, 0.10),
            word("slab", "SLAB", 0.39, 0.10),
        ]
        duplicated = base + [
            {**item, "id": f"z-duplicate-{item['id']}"}
            for item in base
        ]
        expected = evaluate("slab_legend", duplicated)
        for seed in range(5):
            shuffled = list(duplicated)
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(
                json.dumps(evaluate("slab_legend", shuffled), sort_keys=True),
                json.dumps(expected, sort_keys=True),
            )
        self.assertEqual(len(expected["relationships"]), 1)

    def test_resource_limits_reject_before_unbounded_processing(self):
        regions = [word(f"r{index}", "WORD", 0.01 * index, 0.10) for index in range(4)]
        with self.assertRaisesRegex(StructuredTableResourceRejected, "too_many_coordinate_regions"):
            detect_blocks(
                page_identity(),
                regions,
                limits=ResourceLimits(max_regions=3),
            )

    def test_targeted_retry_limit_rejects_an_unbounded_incomplete_page(self):
        regions = [
            word("required", "REQUIRED", 0.10, 0.10),
            word("provided", "PROVIDED", 0.10, 0.20),
            word("landscape", "LANDSCAPE AREA", 0.10, 0.30),
            word("irrigated", "IRRIGATED AREA", 0.10, 0.40),
        ]
        identity = page_identity(sheet="L-1")
        blocks = detect_blocks(
            identity,
            regions,
            block_hints=[{
                "schema": "landscape_summary",
                "bounds": {"x": 0.01, "y": 0.01, "width": 0.98, "height": 0.98},
            }],
        )
        with self.assertRaisesRegex(
            StructuredTableResourceRejected,
            "too_many_targeted_ocr_requests",
        ):
            evaluate_blocks(
                identity,
                blocks,
                regions,
                limits=ResourceLimits(max_targeted_ocr_requests=3),
            )

    def test_2321_and_2375_identical_coordinates_have_different_provenance_ids(self):
        regions = [
            word("thickness", '6" THK.', 0.10, 0.10),
            word("reinforced", "REINFORCED", 0.18, 0.10),
            word("concrete", "CONCRETE", 0.29, 0.10),
            word("slab", "SLAB", 0.39, 0.10),
        ]
        result_2321 = evaluate("slab_legend", regions, identity=page_identity(project="2321-project"))
        result_2375 = evaluate("slab_legend", regions, identity=page_identity(project="2375-project"))
        self.assertNotEqual(result_2321["pageIdentity"]["fingerprint"], result_2375["pageIdentity"]["fingerprint"])
        self.assertNotEqual(result_2321["relationships"][0]["id"], result_2375["relationships"][0]["id"])


if __name__ == "__main__":
    unittest.main()
