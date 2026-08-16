import copy
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pymupdf as fitz

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CONSTITUENTS,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_OCR_PREFIX,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
    EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES,
    EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES,
    EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER,
    EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_PRODUCTION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS,
    EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_TEXT,
    EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES,
    EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PARAGRAPH_SPECS,
    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS,
    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS,
    analyze_deterministic_label_blocks,
    boundary_truncated_edges,
    DocumentResourceRejected,
    VisualTileAnalysisFailed,
    VISUAL_MEASUREMENT_CORRECTION_SOURCE,
    coordinate_ocr_reason,
    corroborated_bounded_measurement_ocr_regions,
    corroborated_vertical_sheet_identity_ocr_region,
    corroborated_vertical_sheet_identity_region,
    corroborate_embedded_text_regions,
    corroborate_document_structural_identity,
    canonical_diagnostic_candidate_authorities,
    dedupe_regions,
    deterministic_fact_regions,
    deterministic_label_block_regions,
    dimension_ocr_regions,
    extract_page,
    native_text_regions,
    ocr_data_regions,
    ocr_regions_for_clip,
    open_pdf,
    ocr_tile_rectangles,
    page_bound_sheet_identity_ocr_regions,
    page_ocr_dpi,
    public_region,
    quarantine_scale_legend_rhs_visual_authority,
    reconstruct_bounded_measurement_ocr_candidates,
    reconstruct_exact_architectural_2321_fire_separation_candidates,
    reconstruct_exact_architectural_2321_area_row_candidates,
    reconstruct_exact_architectural_2321_accessible_parking_note_candidate,
    reconstruct_exact_architectural_2321_easement_note_candidate,
    reconstruct_exact_architectural_2321_site_note_candidates,
    reconstruct_exact_architectural_2321_page30_dimension_candidates,
    reconstruct_exact_architectural_2321_page30_complete_propositions,
    reconstruct_exact_architectural_2321_page31_complete_propositions,
    reconstruct_exact_architectural_2321_page36_clearance_proposition,
    reconstruct_exact_architectural_2321_page38_schedule_measurements,
    reconstruct_exact_architectural_2321_page39_complete_propositions,
    reconstruct_exact_architectural_2321_page40_landing_dimension,
    reconstruct_exact_architectural_2321_page42_loading_dimension,
    reconstruct_exact_architectural_2321_page45_post_spacing_dimension,
    reconstruct_exact_e175_fixture_height_candidate,
    replayed_subtile_regions_are_derivable,
    region_from_box,
    standalone_structured_table_targeted_ocr,
    title_block_ocr_regions,
    targeted_measurement_candidate_text,
    trusted_ocr_regions,
    unrotate_ocr_box,
    visual_diagnostic_candidate_text,
    visual_tile_render_dpi,
    vertical_sheet_value_cell_clip,
    unresolved_regions,
)
from ecos_indexer.sheet_mapping import (
    StructuralIdentityEvidence,
    StructuralSheetIdentity,
)
from ecos_indexer.structured_table_pipeline import (
    structured_table_analysis_sha256,
    validate_persisted_structured_table_analysis,
)


class ExtractionLimitTests(unittest.TestCase):
    def test_nested_measurement_candidate_authority_is_order_independent(self) -> None:
        tight = {
            "text": "421'-O\"", "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.2,
            "bounds": {"x": 0.278095, "y": 0.354, "width": 0.011587, "height": 0.003333},
        }
        noisy = {
            "text": "s 421'-O\"", "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.3,
            "bounds": {"x": 0.268095, "y": 0.352, "width": 0.021587, "height": 0.007556},
        }
        distinct = {
            "text": "8'-0\"", "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.2,
            "bounds": {"x": 0.4, "y": 0.4, "width": 0.01, "height": 0.004},
        }
        expected = [tight, distinct]
        self.assertEqual(expected, canonical_diagnostic_candidate_authorities([tight, noisy, distinct]))
        self.assertEqual(expected, canonical_diagnostic_candidate_authorities([distinct, noisy, tight]))

    def test_every_page_internal_crop_edge_is_detected(self) -> None:
        cases = {
            "left": {"x": 0, "y": 40, "width": 10, "height": 10},
            "top": {"x": 40, "y": 0, "width": 10, "height": 10},
            "right": {"x": 90, "y": 40, "width": 10, "height": 10},
            "bottom": {"x": 40, "y": 90, "width": 10, "height": 10},
        }
        for edge, bounds in cases.items():
            with self.subTest(edge=edge):
                self.assertEqual([edge], boundary_truncated_edges(
                    bounds,
                    crop_width=100,
                    crop_height=100,
                    page_internal_edges=[edge],
                ))

    def test_internal_crop_edge_line_is_diagnostic_only_but_words_remain_authoritative(self) -> None:
        data = {
            "text": ["USE", "INCLUD"],
            "conf": [99, 99],
            "left": [60, 90],
            "top": [30, 30],
            "width": [20, 10],
            "height": [10, 10],
            "block_num": [1, 1],
            "par_num": [1, 1],
            "line_num": [1, 1],
        }
        regions = ocr_data_regions(
            data,
            clip=fitz.Rect(200, 100, 400, 300),
            image_width=100,
            image_height=100,
            page_width=1000,
            page_height=1000,
            prefix="visual-tile-middle-left-subtile-r0-c0",
            source="fixed_visual_tile_coordinate_ocr",
            minimum_confidence=0,
            track_internal_crop_boundaries=True,
        )
        words = [region for region in regions if region["ocrKind"] == "word"]
        line = next(region for region in regions if region["ocrKind"] == "line")
        self.assertEqual(["right"], line["ocrBoundaryTruncatedEdges"])
        self.assertTrue(line["ocrBoundaryTruncated"])
        self.assertFalse(words[0]["ocrBoundaryTruncated"])
        self.assertTrue(words[1]["ocrBoundaryTruncated"])

        accepted, rejected = trusted_ocr_regions(regions)
        self.assertNotIn(line["id"], {region["id"] for region in accepted})
        self.assertNotIn(line["id"], {region["id"] for region in rejected})
        self.assertEqual({words[0]["id"]}, {region["id"] for region in accepted})
        self.assertTrue(replayed_subtile_regions_are_derivable(
            regions,
            prefix="visual-tile-middle-left-subtile-r0-c0",
            crop_width=100,
            crop_height=100,
            page_internal_edges=["left", "top", "right", "bottom"],
        ))

        forged_kind = [dict(region) for region in regions]
        forged_kind[-1].update({
            "ocrKind": "word",
            "ocrOrder": 999,
            "ocrBoundaryTruncated": False,
            "ocrBoundaryTruncatedEdges": [],
        })
        self.assertFalse(replayed_subtile_regions_are_derivable(
            forged_kind,
            prefix="visual-tile-middle-left-subtile-r0-c0",
            crop_width=100,
            crop_height=100,
            page_internal_edges=["left", "top", "right", "bottom"],
        ))

        forged_bounds = [dict(region) for region in regions]
        forged_bounds[-1]["ocrCropPixelBounds"] = {
            **forged_bounds[-1]["ocrCropPixelBounds"],
            "width": forged_bounds[-1]["ocrCropPixelBounds"]["width"] - 2,
        }
        forged_bounds[-1].update({
            "ocrBoundaryTruncated": False,
            "ocrBoundaryTruncatedEdges": [],
        })
        self.assertFalse(replayed_subtile_regions_are_derivable(
            forged_bounds,
            prefix="visual-tile-middle-left-subtile-r0-c0",
            crop_width=100,
            crop_height=100,
            page_internal_edges=["left", "top", "right", "bottom"],
        ))

        forged_outside = [dict(region) for region in regions]
        forged_outside[0] = {
            **forged_outside[0],
            "ocrCropPixelBounds": {"x": 99, "y": 30, "width": 2, "height": 10},
        }
        self.assertFalse(replayed_subtile_regions_are_derivable(
            forged_outside,
            prefix="visual-tile-middle-left-subtile-r0-c0",
            crop_width=100,
            crop_height=100,
            page_internal_edges=["left", "top", "right", "bottom"],
        ))

        for field, value in (
            ("ocrOrder", False),
            ("ocrBlockNumber", 1.0),
            ("ocrParagraphNumber", "1"),
            ("ocrLineNumber", True),
        ):
            with self.subTest(field=field, value=value):
                forged_group = [dict(region) for region in regions]
                forged_group[0][field] = value
                self.assertFalse(replayed_subtile_regions_are_derivable(
                    forged_group,
                    prefix="visual-tile-middle-left-subtile-r0-c0",
                    crop_width=100,
                    crop_height=100,
                    page_internal_edges=["left", "top", "right", "bottom"],
                ))

    def test_true_page_perimeter_is_not_an_internal_crop_edge(self) -> None:
        regions = ocr_data_regions(
            {
                "text": ["SITE", "SECURITY"], "conf": [99, 99],
                "left": [60, 90], "top": [30, 30], "width": [20, 10], "height": [10, 10],
                "block_num": [1, 1], "par_num": [1, 1], "line_num": [1, 1],
            },
            clip=fitz.Rect(0, 0, 1000, 1000),
            image_width=100,
            image_height=100,
            page_width=1000,
            page_height=1000,
            prefix="visual-tile-bottom-right-subtile-r2-c2",
            source="fixed_visual_tile_coordinate_ocr",
            minimum_confidence=0,
            track_internal_crop_boundaries=True,
        )
        line = next(region for region in regions if region["ocrKind"] == "line")
        self.assertFalse(line["ocrBoundaryTruncated"])
        self.assertEqual([], line["ocrCropPageInternalEdges"])

    def test_rotated_line_touching_internal_edge_is_detected_after_unrotation(self) -> None:
        regions = ocr_data_regions(
            {
                "text": ["ROTATED", "NOTE"], "conf": [99, 99],
                "left": [20, 45], "top": [0, 0], "width": [20, 20], "height": [10, 10],
                "block_num": [1, 1], "par_num": [1, 1], "line_num": [1, 1],
            },
            clip=fitz.Rect(200, 100, 400, 300),
            image_width=100,
            image_height=100,
            page_width=1000,
            page_height=1000,
            prefix="visual-tile-middle-subtile-rotated",
            source="fixed_visual_tile_coordinate_ocr",
            minimum_confidence=0,
            image_rotation_degrees=90,
            unrotated_image_width=100,
            unrotated_image_height=100,
            track_internal_crop_boundaries=True,
        )
        line = next(region for region in regions if region["ocrKind"] == "line")
        self.assertEqual(["right"], line["ocrBoundaryTruncatedEdges"])

    def test_untruncated_overlap_remains_when_higher_confidence_line_is_clipped(self) -> None:
        clipped = {
            "id": "clipped-line", "text": "EXACT INTERIOR WORD", "ocrKind": "line",
            "ocrBoundaryTruncated": True, "ocrBoundaryTruncatedEdges": ["right"],
            "confidence": 0.99, "source": "fixed_visual_tile_coordinate_ocr",
            "x": 0.2, "y": 0.2, "width": 0.1, "height": 0.01,
        }
        interior = {
            **clipped,
            "id": "interior-line", "ocrBoundaryTruncated": False,
            "ocrBoundaryTruncatedEdges": [], "confidence": 0.5,
            "source": "coordinate_ocr",
        }
        accepted, rejected = trusted_ocr_regions([clipped, interior])
        self.assertEqual(["interior-line"], [region["id"] for region in accepted])
        self.assertEqual([], rejected)

    def test_large_drawing_visual_detector_uses_bounded_150_dpi_tiles(self) -> None:
        self.assertEqual(visual_tile_render_dpi(36 * 72, 24 * 72), 150)

    def test_targeted_structured_table_retry_is_bounded_and_skips_existing_hint_passes(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        blocks = [
            {
                "id": "hinted",
                "schema": "plant_material",
                "status": "incomplete",
                "detectionMethod": "trusted_coordinate_hint",
                "bounds": {"x": 0.01, "y": 0.01, "width": 0.10, "height": 0.10},
            },
            *[
                {
                    "id": f"block-{index}",
                    "schema": "slab_legend",
                    "status": "incomplete",
                    "detectionMethod": "coordinate_anchor_fallback",
                    "bounds": {
                        "x": 0.10,
                        "y": 0.12 * index,
                        "width": 0.20,
                        "height": 0.08,
                    },
                }
                for index in range(1, 7)
            ],
        ]

        def fake_target(_page, _width, _height, **kwargs):
            target_index = kwargs["target_index"]
            region_id = f"target-{target_index}"
            return ([{
                "id": region_id,
                "text": '6" THK.',
                "x": kwargs["bounds"]["x"],
                "y": kwargs["bounds"]["y"],
                "width": 0.04,
                "height": 0.01,
                "confidence": 0.99,
                "source": "structured_table_coordinate_ocr_primary",
                "ocrKind": "word",
            }], {
                "targetKind": kwargs["target_kind"],
                "bounds": kwargs["bounds"],
                "state": "completed",
                "pageNumber": kwargs["page_number"],
                "sourceSha256": kwargs["source_sha256"],
                "evidenceVersion": kwargs["evidence_version"],
                "renderSha256": "1" * 64,
                "analysisInputSha256": "2" * 64,
                "analysisSha256": "3" * 64,
                "analysisPasses": [],
            })

        try:
            with patch(
                "ecos_indexer.extraction.analyze_structured_table_target",
                side_effect=fake_target,
            ) as analyze_target:
                regions, proofs = standalone_structured_table_targeted_ocr(
                    page,
                    page.rect.width,
                    page.rect.height,
                    {"blocks": blocks},
                    project_id="2321 Compliance Project",
                    source_sha256="a" * 64,
                    evidence_version="ecos-hosted-evidence/test",
                )
        finally:
            document.close()

        self.assertEqual(analyze_target.call_count, 4)
        self.assertEqual(len(regions), 4)
        self.assertEqual(len(proofs), 4)
        self.assertTrue(all(proof["projectId"] == "2321 Compliance Project" for proof in proofs))
        self.assertNotIn("hinted", {proof["structuredTableBlockId"] for proof in proofs})
        self.assertTrue(all(
            region.get("structuredTableTargetedOcrProofRegion") is True
            for region in regions
        ))

    def test_targeted_proof_region_survives_generic_overlap_dedupe(self) -> None:
        baseline = {
            "id": "baseline",
            "text": "6-#5",
            "x": 0.55,
            "y": 0.15,
            "width": 0.08,
            "height": 0.014,
            "confidence": 0.99,
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        targeted = {
            **baseline,
            "id": "targeted",
            "confidence": 0.97,
            "source": "structured_table_coordinate_ocr_primary",
            "structuredTableTargetedOcrProofRegion": True,
        }

        retained = dedupe_regions([baseline, targeted])

        self.assertEqual({item["id"] for item in retained}, {"baseline", "targeted"})

    def test_extract_page_rebinds_two_pass_proof_and_recomputes_analysis_hash(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        baseline = [
            {
                "id": region_id,
                "text": text,
                "x": x,
                "y": y,
                "width": width,
                "height": 0.014,
                "confidence": 0.98,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word",
                "searchable": True,
            }
            for region_id, text, x, y, width in (
                ("mark", "MARK", 0.10, 0.08, 0.06),
                ("footing", "FOOTING", 0.24, 0.08, 0.08),
                ("reinforcing", "REINFORCING", 0.55, 0.08, 0.12),
                ("f1", "F1", 0.10, 0.15, 0.04),
                ("f1-d", '5\'-0" x 5\'-0" x 18"', 0.24, 0.15, 0.22),
            )
        ]

        def targeted_retry(_page, _width, _height, initial, **_kwargs):
            block = next(
                item for item in initial["blocks"]
                if item["schema"] == "footing_schedule"
            )
            targeted = {
                "id": "targeted-f1-r",
                "text": "6-#5",
                "x": 0.32,
                "y": 0.15,
                "width": 0.08,
                "height": 0.014,
                "confidence": 0.99,
                "source": "structured_table_coordinate_ocr_primary",
                "ocrKind": "word",
                "structuredTableTargetedOcrProofRegion": True,
            }
            pass_proof = {
                "pass": "primary",
                "renderSha256": "1" * 64,
                "analysisInputSha256": "2" * 64,
                "analysisSha256": "3" * 64,
                "analysisRegionIds": [targeted["id"]],
            }
            proof = {
                "targetKind": "standalone_footing_schedule",
                "bounds": block["bounds"],
                "state": "completed",
                "projectId": "2375 Compliance Project",
                "pageNumber": 1,
                "sourceSha256": "c" * 64,
                "evidenceVersion": "ecos-hosted-evidence/1.3",
                "renderSha256": "1" * 64,
                "analysisInputSha256": "2" * 64,
                "analysisSha256": "4" * 64,
                "analysisRegionIds": [targeted["id"]],
                "analysisPasses": [
                    pass_proof,
                    {**pass_proof, "pass": "corroboration"},
                ],
                "structuredTableBlockId": block["id"],
                "structuredTableSchema": block["schema"],
                "trustedRegionIds": [targeted["id"]],
                "trustedRegionCount": 1,
                "rejectedRegionCount": 0,
            }
            return [targeted], [proof]

        try:
            with patch(
                "ecos_indexer.extraction.native_text_regions", return_value=[],
            ), patch(
                "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                return_value=(baseline, []),
            ), patch(
                "ecos_indexer.extraction.title_block_ocr_regions", return_value=[],
            ), patch(
                "ecos_indexer.extraction.sheet_identity_ocr_regions", return_value=[],
            ), patch(
                "ecos_indexer.extraction.standalone_structured_table_hints",
                return_value=[],
            ), patch(
                "ecos_indexer.extraction.standalone_structured_table_targeted_ocr",
                side_effect=targeted_retry,
            ):
                result = extract_page(
                    page,
                    "c" * 64,
                    project_id="2375 Compliance Project",
                )
        finally:
            document.close()

        analysis = result["final"]["structuredTableAnalysis"]
        self.assertIsNotNone(analysis)
        proof = analysis["targetedOcrProofs"][0]
        self.assertNotEqual(
            proof["requestedStructuredTableBlockId"],
            proof["structuredTableBlockId"],
        )
        self.assertEqual(
            proof["structuredTableBlockId"], analysis["blocks"][0]["id"],
        )
        self.assertEqual(
            analysis["analysisSha256"], structured_table_analysis_sha256(analysis),
        )
        self.assertIn(
            "targeted-f1-r",
            {region["id"] for region in result["final"]["regions"]},
        )
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                analysis,
                regions=result["final"]["regions"],
                expected_project_id="2375 Compliance Project",
                expected_page_number=1,
                expected_source_sha256="c" * 64,
                expected_evidence_version="ecos-hosted-evidence/1.3",
                expected_sheet_number=None,
            ),
            [],
        )

    def test_targeted_structured_table_retry_failure_retains_gap_without_failing_page(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        analysis = {"blocks": [{
            "id": "oversized-block",
            "schema": "numbered_notes",
            "status": "incomplete",
            "detectionMethod": "coordinate_anchor_fallback",
            "bounds": {"x": 0.01, "y": 0.01, "width": 0.98, "height": 0.98},
        }]}
        try:
            with patch(
                "ecos_indexer.extraction.analyze_structured_table_target",
                side_effect=VisualTileAnalysisFailed("structured_table_resource_limit_exceeded"),
            ):
                regions, proofs = standalone_structured_table_targeted_ocr(
                    page,
                    page.rect.width,
                    page.rect.height,
                    analysis,
                    project_id="2321 Compliance Project",
                    source_sha256="a" * 64,
                    evidence_version="ecos-hosted-evidence/test",
                )
        finally:
            document.close()

        self.assertEqual(regions, [])
        self.assertEqual(proofs, [])

    def test_rejects_malformed_pdf(self) -> None:
        with self.assertRaisesRegex(DocumentResourceRejected, "malformed_pdf"):
            open_pdf(b"%PDF-1.7\nmalformed")

    def test_accepts_small_valid_pdf(self) -> None:
        source = fitz.open()
        source.new_page()
        payload = source.tobytes()
        source.close()

        document = open_pdf(payload)
        try:
            self.assertEqual(document.page_count, 1)
        finally:
            document.close()

    def test_worker_style_bookmarks_do_not_verify_without_rendered_title_cells(self) -> None:
        document = fitz.open()
        for _index in range(20):
            document.new_page(width=1000, height=600)
        document.set_toc([
            [1, "A13-A1.6", 13],
            [1, "A20-A1.13", 20],
        ])
        try:
            structural_map = document_sheet_identity_map(document)
            self.assertEqual(structural_map[13].sheet_number, "A-1.6")
            self.assertEqual(structural_map[20].sheet_number, "A-1.13")
            with patch("ecos_indexer.extraction.coordinate_ocr_reason", return_value=None):
                a16 = extract_page(
                    document.load_page(12),
                    "a" * 64,
                    project_id="test-project",
                    document_sheet_identity=structural_map.get(13),
                )
                a113 = extract_page(
                    document.load_page(19),
                    "a" * 64,
                    project_id="test-project",
                    document_sheet_identity=structural_map.get(20),
                )
        finally:
            document.close()

        self.assertIsNone(a16["final"]["sheetNumber"])
        self.assertEqual(a16["final"]["sheetMappingStatus"], "unverified")
        self.assertIsNone(a16["final"]["sheetMappingSource"])
        self.assertIsNone(a113["final"]["sheetNumber"])
        self.assertEqual(a113["final"]["sheetMappingStatus"], "unverified")
        self.assertIsNone(a113["final"]["sheetMappingSource"])

    def test_title_block_ocr_returns_the_extracted_regions(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        expected = [{"id": "title-ocr-word-0", "text": "C5"}]
        try:
            with patch("ecos_indexer.extraction.ocr_regions_for_clip", return_value=expected):
                result = title_block_ocr_regions(page, page.rect.width, page.rect.height)
        finally:
            document.close()

        self.assertEqual(result, expected)

    def test_title_block_ocr_rejects_pixel_budget_before_render(self) -> None:
        page = SimpleNamespace(get_pixmap=Mock(side_effect=AssertionError(
            "oversized title-block render must not start",
        )))

        with self.assertRaisesRegex(
            DocumentResourceRejected,
            "pdf_ocr_render_pixels_outside_limit",
        ):
            ocr_regions_for_clip(
                page,
                fitz.Rect(0, 0, 20_000, 20_000),
                20_000,
                20_000,
                dpi=240,
                prefix="title-ocr",
                source="title_block_ocr",
                config="--psm 11",
            )

        page.get_pixmap.assert_not_called()

    def test_rejects_page_that_requires_excessive_ocr_tiles(self) -> None:
        document = fitz.open()
        page = document.new_page(width=5000, height=5000)
        try:
            with patch("ecos_indexer.extraction.MAX_OCR_TILES", 1):
                with self.assertRaisesRegex(DocumentResourceRejected, "too_many_ocr_tiles"):
                    ocr_tile_rectangles(page)
        finally:
            document.close()

    def test_clips_rotated_text_box_to_visible_page_bounds(self) -> None:
        region = region_from_box(
            "native-0-0",
            "MAINTENANCE SCHEDULE",
            (250.815, 969.648, 259.109, 1120.604),
            1000,
            1000,
            "embedded_text",
            0.99,
        )

        self.assertIsNotNone(region)
        assert region is not None
        self.assertLessEqual(region["x"] + region["width"], 1.001)
        self.assertLessEqual(region["y"] + region["height"], 1.001)
        self.assertAlmostEqual(region["y"] + region["height"], 1.0, places=6)

    def test_region_from_box_drops_area_lost_at_persistence_quantization(self) -> None:
        region = region_from_box(
            "native-microscopic",
            "MICROSCOPIC PDF TEXT",
            (1, 1, 1.0004, 1.0004),
            1000,
            1000,
            "embedded_text",
            0.99,
        )

        self.assertIsNone(region)

    def test_region_from_box_keeps_smallest_durable_positive_area(self) -> None:
        region = region_from_box(
            "native-smallest-durable",
            "SMALLEST DURABLE PDF TEXT",
            (1, 1, 1.0006, 1.0006),
            1000,
            1000,
            "embedded_text",
            0.99,
        )

        self.assertIsNotNone(region)
        assert region is not None
        self.assertEqual(region["width"], 0.000001)
        self.assertEqual(region["height"], 0.000001)

    def test_region_from_box_rejects_nonfinite_coordinates(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            for coordinate_index in range(4):
                with self.subTest(value=value, coordinate_index=coordinate_index):
                    box = [1.0, 1.0, 2.0, 2.0]
                    box[coordinate_index] = value
                    self.assertIsNone(region_from_box(
                        "native-nonfinite",
                        "NONFINITE PDF TEXT",
                        box,
                        1000,
                        1000,
                        "embedded_text",
                        0.99,
                    ))

    def test_region_from_box_rejects_nonpositive_or_nonfinite_page_size(self) -> None:
        for page_width, page_height in (
            (0, 1000),
            (-1, 1000),
            (1000, 0),
            (1000, -1),
            (float("nan"), 1000),
            (1000, float("inf")),
        ):
            with self.subTest(page_width=page_width, page_height=page_height):
                self.assertIsNone(region_from_box(
                    "native-invalid-page",
                    "INVALID PAGE SIZE",
                    (1, 1, 2, 2),
                    page_width,
                    page_height,
                    "embedded_text",
                    0.99,
                ))

    def test_native_regions_are_transformed_into_rotated_page_coordinates(self) -> None:
        document = fitz.open()
        page = document.new_page(width=600, height=1000)
        page.insert_text((500, 900), "SHEET C6")
        page.set_rotation(270)
        try:
            regions = native_text_regions(page, page.rect.width, page.rect.height)
        finally:
            document.close()

        self.assertTrue(regions)
        for region in regions:
            self.assertGreaterEqual(region["x"], 0)
            self.assertGreaterEqual(region["y"], 0)
            self.assertLessEqual(region["x"] + region["width"], 1.001)
            self.assertLessEqual(region["y"] + region["height"], 1.001)

    def test_ocr_words_are_joined_by_line_for_spaced_sheet_numbers(self) -> None:
        data = {
            "text": ["SHEET", "NUMBER", "E", "-", "2.1"],
            "conf": ["99", "99", "99", "99", "99"],
            "left": [0, 60, 0, 20, 35],
            "top": [0, 0, 40, 40, 40],
            "width": [50, 70, 15, 10, 30],
            "height": [20, 20, 20, 20, 20],
            "block_num": [1, 1, 2, 2, 2],
            "par_num": [1, 1, 1, 1, 1],
            "line_num": [1, 1, 1, 1, 1],
        }

        regions = ocr_data_regions(
            data,
            clip=fitz.Rect(600, 600, 1000, 1000),
            image_width=200,
            image_height=200,
            page_width=1000,
            page_height=1000,
            prefix="title-ocr",
            source="title_block_ocr",
        )

        lines = [region["text"] for region in regions if "-line-" in region["id"]]
        self.assertIn("SHEET NUMBER", lines)
        self.assertIn("E - 2.1", lines)
        sheet_number_line = next(region for region in regions if region["text"] == "E - 2.1")
        self.assertEqual(sheet_number_line["ocrKind"], "line")
        self.assertEqual(sheet_number_line["ocrPrefix"], "title-ocr")
        self.assertEqual(sheet_number_line["ocrRotationDegrees"], 0)
        self.assertEqual(sheet_number_line["ocrBlockNumber"], 2)
        self.assertEqual(sheet_number_line["ocrParagraphNumber"], 1)
        self.assertEqual(sheet_number_line["ocrLineNumber"], 1)

    def test_reconstructs_explicit_hazardous_storage_label_in_one_ocr_block(self) -> None:
        regions = [
            self._label_region(
                "label-line-1", "PROPOSED NEW WEATHER PROTECTED",
                x=0.50, y=0.10, width=0.12, height=0.006,
                block=7, line=1,
            ),
            self._label_region(
                "label-line-2", "EXT. HAZ. MATL. STORAGE",
                x=0.495, y=0.108, width=0.105, height=0.006,
                block=7, line=2,
            ),
            self._label_region(
                "label-line-3", "AREA 'C'",
                x=0.53, y=0.116, width=0.035, height=0.006,
                block=7, line=3,
            ),
            {
                "id": "native-area-c",
                "text": "AREA C",
                "label": "AREA C",
                "x": 0.53,
                "y": 0.116,
                "width": 0.035,
                "height": 0.006,
                "confidence": 0.99,
                "source": "embedded_text",
                "renderedCorroborated": True,
                "renderedCorroboratingRegionIds": ["label-line-3"],
                "renderedCorroboratingSources": ["ocr"],
            },
        ]

        facts = deterministic_label_block_regions(regions)

        self.assertEqual(len(facts), 1)
        fact = facts[0]
        self.assertEqual(fact["subject"], "hazardous material storage")
        self.assertEqual(fact["location"], "Storage Area C")
        self.assertEqual(fact["reconstructionMethod"], "trusted_same_ocr_block")
        self.assertEqual([item["id"] for item in fact["constituentEvidence"]], [
            "label-line-1", "label-line-2", "label-line-3",
        ])
        self.assertTrue(all(item["bounds"]["width"] > 0 for item in fact["constituentEvidence"]))
        self.assertEqual(fact["corroboratingEvidence"][0]["source"], "embedded_text")

        published = public_region(fact)
        self.assertEqual(published["source"], "deterministic_label_block")
        self.assertEqual(published["reconstructionMethod"], "trusted_same_ocr_block")
        self.assertEqual(published["evidenceSources"], ["ocr"])
        self.assertEqual(
            [item["id"] for item in published["constituentEvidence"]],
            ["label-line-1", "label-line-2", "label-line-3"],
        )
        self.assertEqual(published["corroboratingEvidence"][0]["id"], "native-area-c")

    def test_real_a16_label_stays_unresolved_without_terminal_c_corroboration(self) -> None:
        # Coordinate fixture captured from 2375 Architectural A1.6. Tesseract
        # split the terminal C into a trusted singleton word and assigned each
        # label line a separate OCR block. The geometry is tight enough to form
        # a candidate, but the location relation must remain unresolved until
        # another deterministic or independent channel corroborates Area C.
        regions = [
            self._label_region(
                "ocr-line-62", "WEATHER PROTECTED",
                x=0.592619, y=0.168333, width=0.045238, height=0.004,
                block=62, line=1, confidence=0.94,
            ),
            self._label_region(
                "ocr-line-69", "EXT. HAZ. MATL, STORAGE",
                x=0.587857, y=0.174, width=0.054524, height=0.004,
                block=69, line=1, confidence=0.88,
            ),
            self._label_region(
                "ocr-word-c", "c",
                x=0.613571, y=0.180333, width=0.002857, height=0.003667,
                block=74, line=1, confidence=0.43, kind="word",
            ),
        ]

        facts, unresolved = analyze_deterministic_label_blocks(regions)

        self.assertEqual(facts, [])
        self.assertEqual(len(unresolved), 1)
        self.assertIn("only one OCR channel", unresolved[0]["reason"])
        self.assertAlmostEqual(unresolved[0]["bounds"]["x"], 0.587857, places=6)
        self.assertAlmostEqual(unresolved[0]["bounds"]["y"], 0.168333, places=6)
        self.assertEqual(unresolved[0]["diagnosticCandidateCount"], 3)

    def test_conflicting_explicit_area_identifier_rejects_valid_c_subset(self) -> None:
        regions = [
            self._label_region(
                "conflict-line-1", "WEATHER PROTECTED",
                x=0.50, y=0.10, width=0.10, height=0.006,
                block=4, line=1,
            ),
            self._label_region(
                "conflict-line-2", "EXT. HAZ. MATL. STORAGE",
                x=0.50, y=0.108, width=0.11, height=0.006,
                block=4, line=2,
            ),
            self._label_region(
                "conflict-area-b", "AREA B",
                x=0.50, y=0.116, width=0.04, height=0.006,
                block=4, line=3,
            ),
            self._label_region(
                "conflict-lone-c", "C",
                x=0.56, y=0.116, width=0.008, height=0.006,
                block=5, line=1, kind="word",
            ),
            {
                "id": "native-corroborating-c",
                "text": "AREA C",
                "label": "AREA C",
                "x": 0.56,
                "y": 0.116,
                "width": 0.025,
                "height": 0.006,
                "confidence": 0.99,
                "source": "embedded_text",
            },
        ]

        facts, unresolved = analyze_deterministic_label_blocks(regions)

        self.assertEqual(facts, [])
        self.assertEqual(len(unresolved), 1)
        self.assertIn("conflicting explicit area identifier", unresolved[0]["reason"])
        self.assertIn("B versus C", unresolved[0]["reason"])

    def test_canopy_detail_and_hazardous_summary_cannot_synthesize_relation(self) -> None:
        regions = [
            self._label_region(
                "canopy-detail", "CANOPY C DETAIL PLANS",
                x=0.40, y=0.20, width=0.10, height=0.007,
                block=3, line=1,
            ),
            self._label_region(
                "hazmat-summary", "HAZARDOUS MATERIAL SUMMARY",
                x=0.40, y=0.209, width=0.12, height=0.007,
                block=3, line=2,
            ),
        ]

        self.assertEqual(deterministic_label_block_regions(regions), [])

    def test_real_a113_distant_titles_remain_separate_facts(self) -> None:
        # Exact coordinate pattern from 2375 Architectural A1.13: the plan's
        # CANOPY C identifier, hazardous-material summary, and layout title are
        # real searchable regions, but they are not one local label block.
        regions = [
            self._label_region(
                "a113-canopy-c", "CANOPY C",
                x=0.531429, y=0.223667, width=0.027381, height=0.004667,
                block=20, line=1,
            ),
            self._label_region(
                "a113-hazmat-summary", "HAZARDOUS MATERIAL SUMMARY",
                x=0.714286, y=0.724667, width=0.087143, height=0.006,
                block=80, line=1,
            ),
            self._label_region(
                "a113-layout-title", "HAZARDOUS MATERIAL STORAGE LAYOUT PLAN",
                x=0.441429, y=0.838667, width=0.139762, height=0.006667,
                block=95, line=1,
            ),
        ]

        self.assertEqual(deterministic_label_block_regions(regions), [])

    def test_distant_storage_identifier_cannot_complete_otherwise_explicit_label(self) -> None:
        regions = [
            self._label_region(
                "storage-label", "WEATHER PROTECTED EXT. HAZ. MATL. STORAGE",
                x=0.52, y=0.10, width=0.13, height=0.007,
                block=1, line=1,
            ),
            self._label_region(
                "distant-area-c", "AREA C",
                x=0.52, y=0.20, width=0.04, height=0.007,
                block=2, line=1,
            ),
        ]

        self.assertEqual(deterministic_label_block_regions(regions), [])

    def test_label_constituents_from_different_sources_or_orientation_are_not_joined(self) -> None:
        source_mismatch = [
            self._label_region(
                "weather", "WEATHER PROTECTED",
                x=0.50, y=0.10, width=0.08, height=0.006,
                block=1, line=1, source="ocr",
            ),
            self._label_region(
                "storage", "EXT HAZ MATL STORAGE AREA C",
                x=0.50, y=0.108, width=0.11, height=0.006,
                block=1, line=2, source="dense_text_coordinate_ocr",
            ),
        ]
        rotation_mismatch = [
            source_mismatch[0],
            self._label_region(
                "rotated-storage", "EXT HAZ MATL STORAGE AREA C",
                x=0.50, y=0.108, width=0.11, height=0.006,
                block=1, line=2, source="ocr", rotation=90,
            ),
        ]

        self.assertEqual(deterministic_label_block_regions(source_mismatch), [])
        self.assertEqual(deterministic_label_block_regions(rotation_mismatch), [])

    @staticmethod
    def _label_region(
        region_id: str,
        text: str,
        *,
        x: float,
        y: float,
        width: float,
        height: float,
        block: int,
        line: int,
        confidence: float = 0.9,
        kind: str = "line",
        source: str = "ocr",
        rotation: int = 0,
    ) -> dict:
        return {
            "id": region_id,
            "text": text,
            "label": text,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "confidence": confidence,
            "source": source,
            "ocrKind": kind,
            "ocrPrefix": "ocr-page",
            "ocrRotationDegrees": rotation,
            "ocrBlockNumber": block,
            "ocrParagraphNumber": 1,
            "ocrLineNumber": line,
        }

    def test_exact_identity_crop_can_retain_low_confidence_outline_text(self) -> None:
        data = {
            "text": ["E-1.1"],
            "conf": ["0"],
            "left": [50], "top": [20], "width": [80], "height": [30],
            "block_num": [1], "par_num": [1], "line_num": [1],
        }

        regions = ocr_data_regions(
            data,
            clip=fitz.Rect(880, 938, 1000, 999),
            image_width=200,
            image_height=100,
            page_width=1000,
            page_height=1000,
            prefix="sheet-identity",
            source="sheet_identity_ocr",
            minimum_confidence=0.0,
        )

        self.assertEqual([region["text"] for region in regions], ["E-1.1"])

    def test_sparse_title_block_metadata_does_not_suppress_page_ocr(self) -> None:
        metadata = (
            "ENGINEERING CONSULTANTS 200 South Main Street Suite 300 "
            "AutoCAD PDF High Quality Print Precise Grading drawing"
        )

        self.assertEqual(
            coordinate_ocr_reason(None, metadata),
            "insufficient_native_text",
        )

    def test_unreadable_embedded_font_encoding_does_not_suppress_ocr(self) -> None:
        unreadable_text = ("\x00\x01\x02W;26?XZ[" * 100)

        self.assertEqual(
            coordinate_ocr_reason(None, unreadable_text),
            "unreadable_native_text_encoding",
        )

    def test_outlined_vector_text_does_not_get_skipped_by_large_native_layer(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        for index in range(60):
            x = 20 + (index % 20) * 12
            y = 20 + (index // 20) * 12
            page.draw_rect(fitz.Rect(x, y, x + 5, y + 7))
        try:
            reason = coordinate_ocr_reason(page, "SEARCHABLE TITLE BLOCK " * 40)
        finally:
            document.close()

        self.assertEqual(reason, "outlined_vector_text")

    def test_deduplication_preserves_enriched_drawing_fact_metadata(self) -> None:
        plain = {
            "id": "ocr-1",
            "text": '122\'-0" OVERALL CANOPY DIMENSION',
            "label": '122\'-0" OVERALL CANOPY DIMENSION',
            "x": 0.2, "y": 0.7, "width": 0.2, "height": 0.02,
            "confidence": 0.91,
            "source": "ocr",
        }

        facts = deterministic_fact_regions([plain])
        result = dedupe_regions([plain, *facts])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["factKind"], "drawing_fact")
        self.assertEqual(result[0]["subject"], "canopy")
        self.assertEqual(result[0]["evidenceText"], plain["text"])

    def test_deduplication_preserves_coordinate_ids_used_by_corroboration(self) -> None:
        text = 'CEILING HEIGHT: 25\'-7"'
        rendered = {
            "id": "visual-ceiling-height",
            "text": text,
            "label": text,
            "x": 0.206,
            "y": 0.30,
            "width": 0.18,
            "height": 0.02,
            "confidence": 0.98,
            "source": "fixed_visual_tile_coordinate_ocr",
            "searchable": True,
        }
        embedded = {
            **rendered,
            "id": "native-ceiling-height",
            "x": 0.20,
            "source": "embedded_text",
            "searchable": False,
            "renderedCorroborated": True,
            "renderedCorroboratingRegionIds": [rendered["id"]],
            "renderedCorroboratingSources": [rendered["source"]],
        }

        facts = deterministic_fact_regions([embedded, rendered])
        result = dedupe_regions([embedded, rendered, *facts])
        region_by_id = {region["id"]: region for region in result}

        self.assertEqual(set(region_by_id), {embedded["id"], rendered["id"]})
        enriched = region_by_id[embedded["id"]]
        self.assertEqual(enriched["factKind"], "drawing_fact")
        self.assertEqual(
            enriched["renderedCorroboratingRegionIds"],
            [rendered["id"]],
        )
        self.assertIn(rendered["id"], region_by_id)

    def test_dimension_bands_check_both_vertical_orientations(self) -> None:
        document = fitz.open()
        page = document.new_page(width=792, height=612)

        def fake_ocr(*_args, **kwargs):
            source = kwargs["source"]
            text = '122\'-0"' if source.endswith("bottom_0") else '52\'-0"'
            return [{
                "id": source,
                "text": text,
                "x": 0.1, "y": 0.2, "width": 0.1, "height": 0.02,
                "confidence": 0.2,
                "source": source,
            }]

        try:
            with patch("ecos_indexer.extraction.ocr_regions_for_clip", side_effect=fake_ocr) as ocr:
                result = dimension_ocr_regions(page, page.rect.width, page.rect.height)
        finally:
            document.close()

        rotations = [call.kwargs["image_rotation_degrees"] for call in ocr.call_args_list]
        self.assertEqual(rotations, [0, 90, 270, 0, 90, 270, 0])
        native_passes = [
            call for call in ocr.call_args_list
            if call.kwargs["image_rotation_degrees"] == 0
        ]
        self.assertTrue(all(call.kwargs["dpi"] == 450 for call in native_passes))
        self.assertTrue(all(call.kwargs["config"] == "--psm 12" for call in native_passes))
        self.assertTrue(all(call.kwargs["dark_stroke_filter_size"] == 3 for call in native_passes))
        self.assertIn('122\'-0"', [region["text"] for region in result])
        self.assertIn('52\'-0"', [region["text"] for region in result])

    def test_low_confidence_dimension_requires_independent_corroboration(self) -> None:
        base = {
            "id": "dimension-left-90",
            "text": '52\'-0"',
            "x": 0.1, "y": 0.2, "width": 0.02, "height": 0.1,
            "confidence": 0.18,
            "source": "dimension_coordinate_ocr_left_90",
        }

        accepted, rejected = trusted_ocr_regions([base])
        self.assertEqual(accepted, [])
        self.assertEqual([region["text"] for region in rejected], ['52\'-0"'])

        corroborating = {
            **base,
            "id": "dimension-left-270",
            "source": "dimension_coordinate_ocr_left_270",
        }
        accepted, rejected = trusted_ocr_regions([base, corroborating])
        self.assertEqual(len(accepted), 1)
        self.assertEqual(rejected, [])
        self.assertEqual(accepted[0]["ocrValidationStatus"], "corroborated")
        self.assertEqual(len(accepted[0]["ocrCorroboratingSources"]), 2)

    def test_low_confidence_fact_remains_an_unresolved_region(self) -> None:
        candidate = {
            "id": "ocr-low-1",
            "text": "CANOPY A LIGHTING",
            "x": 0.1, "y": 0.2, "width": 0.2, "height": 0.03,
            "confidence": 0.12,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([candidate])
        unresolved = unresolved_regions(
            [],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=rejected,
        )

        self.assertEqual(accepted, [])
        self.assertTrue(any(
            item["regionKey"].startswith("low-confidence-ocr-") for item in unresolved
        ))

    def test_generic_drawing_navigation_does_not_reserve_visual_capacity(self) -> None:
        generic = [
            {
                "id": f"ocr-low-{index}",
                "text": text,
                "x": 0.1, "y": 0.1 + index * 0.04,
                "width": 0.3, "height": 0.02,
                "confidence": 0.12,
                "source": "dense_text_coordinate_ocr",
            }
            for index, text in enumerate((
                "DETAIL CALLOUT INDICATES DETAIL NUMBER",
                "BUILDING SECTION REFERENCE",
                "REVISION SCHEDULE",
            ))
        ]

        accepted, rejected = trusted_ocr_regions(generic)

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])

    def test_critical_low_confidence_facts_still_fail_closed(self) -> None:
        critical = [
            "CANOPY A LIGHTING",
            "HAZARDOUS MATERIAL STORAGE",
            "NEW CONCRETE SLAB",
            "4 INCH PCC",
            '122\'-0"',
        ]
        candidates = [
            {
                "id": f"ocr-critical-{index}",
                "text": text,
                "x": 0.1, "y": 0.1 + index * 0.04,
                "width": 0.3, "height": 0.02,
                "confidence": 0.12,
                "source": "dense_text_coordinate_ocr",
            }
            for index, text in enumerate(critical)
        ]

        accepted, rejected = trusted_ocr_regions(candidates)

        self.assertEqual(accepted, [])
        self.assertEqual([region["text"] for region in rejected], critical)

    def test_low_confidence_line_is_not_escalated_when_fact_word_is_supported(self) -> None:
        accepted_word = {
            "id": "ocr-word-lighting",
            "text": "LIGHTING",
            "x": 0.2, "y": 0.2, "width": 0.05, "height": 0.02,
            "confidence": 0.91,
            "source": "dense_text_coordinate_ocr",
        }
        weak_line = {
            "id": "ocr-line-lighting",
            "text": "LIGHTING FIXTURE CALLOUT INDICATES FIXTURE TYPE",
            "x": 0.18, "y": 0.19, "width": 0.4, "height": 0.04,
            "confidence": 0.12,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([accepted_word, weak_line])

        self.assertEqual([region["text"] for region in accepted], ["LIGHTING"])
        self.assertEqual(rejected, [])

    def test_unique_low_confidence_measurement_is_not_suppressed_by_nearby_fact(self) -> None:
        accepted_canopy = {
            "id": "ocr-word-canopy",
            "text": "CANOPY A",
            "x": 0.2, "y": 0.2, "width": 0.08, "height": 0.02,
            "confidence": 0.91,
            "source": "dense_text_coordinate_ocr",
        }
        weak_dimension = {
            "id": "ocr-line-dimension",
            "text": 'CANOPY A 122\'-0"',
            "x": 0.18, "y": 0.19, "width": 0.4, "height": 0.04,
            "confidence": 0.12,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([accepted_canopy, weak_dimension])

        self.assertEqual([region["text"] for region in accepted], ["CANOPY A"])
        self.assertEqual([region["text"] for region in rejected], ['CANOPY A 122\'-0"'])

    def test_exact_rectangular_fixture_measurement_reuses_overlapping_trusted_ocr(self) -> None:
        trusted_line = {
            "id": "ocr-line-troffer",
            "text": "2'x4' LED TROFFER",
            "x": 0.67, "y": 0.08, "width": 0.08, "height": 0.02,
            "confidence": 0.59,
            "source": "ocr",
        }
        weak_word = {
            "id": "dense-text-word-troffer-size",
            "text": "2'x4'",
            "x": 0.68, "y": 0.085, "width": 0.02, "height": 0.01,
            "confidence": 0.22,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_line, weak_word])

        self.assertEqual([region["text"] for region in accepted], ["2'x4' LED TROFFER"])
        self.assertEqual(rejected, [])

    def test_exact_signed_mounting_height_reuses_overlapping_trusted_ocr(self) -> None:
        trusted_word = {
            "id": "dense-text-word-mounting-height",
            "text": "+20'",
            "x": 0.59, "y": 0.12, "width": 0.02, "height": 0.01,
            "confidence": 0.81,
            "source": "dense_text_coordinate_ocr",
        }
        weak_line = {
            "id": "dense-text-line-mounting-height",
            "text": "4000K CCT +20' 0-10V DIMMING DRIVER",
            "x": 0.40, "y": 0.115, "width": 0.32, "height": 0.02,
            "confidence": 0.23,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_word, weak_line])

        self.assertEqual([region["text"] for region in accepted], ["+20'"])
        self.assertEqual(rejected, [])

    def test_measurement_punctuation_conflict_remains_fail_closed(self) -> None:
        trusted_inches = {
            "id": "ocr-word-height-conflict",
            "text": '+20"',
            "x": 0.59, "y": 0.12, "width": 0.02, "height": 0.01,
            "confidence": 0.81,
            "source": "ocr",
        }
        weak_feet = {
            "id": "dense-text-word-height-conflict",
            "text": "+20'",
            "x": 0.59, "y": 0.12, "width": 0.02, "height": 0.01,
            "confidence": 0.23,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_inches, weak_feet])

        self.assertEqual([region["text"] for region in accepted], ['+20"'])
        self.assertEqual([region["text"] for region in rejected], ["+20'"])

    def test_corrupted_zero_inch_variant_reuses_same_coordinate_exact_measurement(self) -> None:
        trusted_exact = {
            "id": "ocr-exact-height",
            "text": '12\'-0"',
            "x": 0.58, "y": 0.18, "width": 0.04, "height": 0.01,
            "confidence": 0.91,
            "source": "ocr",
        }
        corrupted_variant = {
            "id": "ocr-corrupted-height",
            "text": 'UP TO 12\'\u00b0-0\u201d PARTITION',
            "x": 0.45, "y": 0.175, "width": 0.25, "height": 0.02,
            "confidence": 0.18,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_exact, corrupted_variant])

        self.assertEqual([region["text"] for region in accepted], ['12\'-0"'])
        self.assertEqual(rejected, [])

    def test_corrupted_zero_inch_variant_at_another_coordinate_stays_unresolved(self) -> None:
        trusted_exact = {
            "id": "ocr-exact-height-row-one",
            "text": '8\'-0"',
            "x": 0.48, "y": 0.18, "width": 0.04, "height": 0.01,
            "confidence": 0.91,
            "source": "ocr",
        }
        corrupted_other_row = {
            "id": "ocr-corrupted-height-row-two",
            "text": '8\'-Q\u201d MAXIMUM',
            "x": 0.48, "y": 0.38, "width": 0.12, "height": 0.01,
            "confidence": 0.18,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_exact, corrupted_other_row])

        self.assertEqual([region["text"] for region in accepted], ['8\'-0"'])
        self.assertEqual([region["text"] for region in rejected], ['8\'-Q\u201d MAXIMUM'])

    def test_unique_single_foot_and_incomplete_dimensions_stay_unresolved(self) -> None:
        candidates = [
            {
                "id": "ocr-unique-single-foot",
                "text": "1' SCHEDULE",
                "x": 0.2, "y": 0.1, "width": 0.12, "height": 0.01,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "ocr-incomplete-foot-inch",
                "text": "4'-0",
                "x": 0.7, "y": 0.35, "width": 0.04, "height": 0.01,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
        ]

        accepted, rejected = trusted_ocr_regions(candidates)

        self.assertEqual(accepted, [])
        self.assertEqual([region["text"] for region in rejected], ["1' SCHEDULE", "4'-0"])

    def test_corrupted_zero_inch_does_not_reuse_different_exact_inches(self) -> None:
        trusted_exact = {
            "id": "ocr-exact-nonzero-inches",
            "text": '12\'-6"',
            "x": 0.5, "y": 0.2, "width": 0.04, "height": 0.01,
            "confidence": 0.9,
            "source": "ocr",
        }
        corrupted_zero = {
            "id": "ocr-corrupted-zero-inches",
            "text": '12\'\u20140\u201d',
            "x": 0.5, "y": 0.2, "width": 0.04, "height": 0.01,
            "confidence": 0.1,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_exact, corrupted_zero])

        self.assertEqual([region["text"] for region in accepted], ['12\'-6"'])
        self.assertEqual([region["text"] for region in rejected], ['12\'\u20140\u201d'])

    def test_same_measurement_on_a_different_schedule_row_remains_fail_closed(self) -> None:
        trusted_row = {
            "id": "ocr-line-row-one",
            "text": "2'x4' LED TROFFER",
            "x": 0.67, "y": 0.08, "width": 0.08, "height": 0.01,
            "confidence": 0.59,
            "source": "ocr",
        }
        weak_other_row = {
            "id": "dense-text-line-row-two",
            "text": "35W LED 2'x4' LED TROFFER",
            "x": 0.58, "y": 0.12, "width": 0.24, "height": 0.01,
            "confidence": 0.16,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([trusted_row, weak_other_row])

        self.assertEqual([region["text"] for region in accepted], ["2'x4' LED TROFFER"])
        self.assertEqual([region["text"] for region in rejected], ["35W LED 2'x4' LED TROFFER"])

    def test_pdf_creation_timestamp_is_not_a_construction_dimension(self) -> None:
        timestamp = {
            "id": "ocr-low-timestamp",
            "text": "2023.12.05 2349:59-08'00'",
            "x": 0.8, "y": 0.9, "width": 0.15, "height": 0.02,
            "confidence": 0.12,
            "source": "title_block_ocr",
        }

        accepted, rejected = trusted_ocr_regions([timestamp])

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])
        self.assertEqual(deterministic_fact_regions([timestamp]), [])

    def test_photometric_chart_fragments_are_not_construction_dimensions(self) -> None:
        candidates = [
            {
                "id": "ocr-low-photometric-one",
                "text": "@20'*4.7",
                "x": 0.72, "y": 0.662, "width": 0.03, "height": 0.02,
                "confidence": 0.0,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "ocr-low-photometric-two",
                "text": "60 '01% '70 \"40",
                "x": 0.72, "y": 0.68, "width": 0.03, "height": 0.02,
                "confidence": 0.12,
                "source": "dense_text_coordinate_ocr",
            },
        ]

        accepted, rejected = trusted_ocr_regions(candidates)

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])

    def test_exact_construction_dimensions_remain_fail_closed(self) -> None:
        candidates = [
            {
                "id": "ocr-low-exact-foot-inch",
                "text": "6'-0\"",
                "x": 0.1, "y": 0.1, "width": 0.05, "height": 0.01,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "ocr-low-textual-feet",
                "text": "MOUNT FIXTURE 20 FT HIGH",
                "x": 0.1, "y": 0.2, "width": 0.2, "height": 0.01,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "ocr-low-rectangle",
                "text": "2'x4' LED TROFFER",
                "x": 0.1, "y": 0.3, "width": 0.2, "height": 0.01,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
        ]

        accepted, rejected = trusted_ocr_regions(candidates)

        self.assertEqual(accepted, [])
        self.assertEqual(
            [region["text"] for region in rejected],
            ["6'-0\"", "MOUNT FIXTURE 20 FT HIGH", "2'x4' LED TROFFER"],
        )

    def test_footnote_and_circuit_labels_are_not_construction_dimensions(self) -> None:
        candidates = [
            {
                "id": "ocr-low-footnote",
                "text": "1FOOTNOTE: Design watts for qualifying luminaires",
                "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.02,
                "confidence": 0.12,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "ocr-low-circuit",
                "text": "1'C-2 #8B1 #8GND",
                "x": 0.1, "y": 0.3, "width": 0.2, "height": 0.02,
                "confidence": 0.12,
                "source": "dense_text_coordinate_ocr",
            },
        ]

        accepted, rejected = trusted_ocr_regions(candidates)

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])

    def test_textual_foot_measurement_still_fails_closed_without_corroboration(self) -> None:
        candidate = {
            "id": "ocr-low-height",
            "text": "MOUNT FIXTURE 20 FT HIGH",
            "x": 0.1, "y": 0.2, "width": 0.25, "height": 0.02,
            "confidence": 0.12,
            "source": "dense_text_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([candidate])

        self.assertEqual(accepted, [])
        self.assertEqual([region["text"] for region in rejected], ["MOUNT FIXTURE 20 FT HIGH"])

    def test_schedule_variants_share_one_bounded_visual_region_with_diagnostics(self) -> None:
        variants = [
            {
                "id": "schedule-small-word",
                "text": '3/4"x1\'-4" LONG',
                "x": 0.78, "y": 0.274, "width": 0.08, "height": 0.006,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "schedule-wide-line",
                "text": 'CONTROL JOINT 3/4"x1\'-4" LONG @ 24" O.C.',
                "x": 0.72, "y": 0.287, "width": 0.23, "height": 0.012,
                "confidence": 0.0,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "schedule-other-row",
                "text": '3/4"x1\'-4" LONG @ 12" O.C.',
                "x": 0.79, "y": 0.302, "width": 0.14, "height": 0.006,
                "confidence": 0.15,
                "source": "dense_text_coordinate_ocr",
            },
            {
                "id": "separate-detail",
                "text": '1\'-4"',
                "x": 0.52, "y": 0.77, "width": 0.03, "height": 0.006,
                "confidence": 0.1,
                "source": "dense_text_coordinate_ocr",
            },
        ]

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=variants,
        )
        visual_regions = [
            item for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]

        self.assertEqual(len(visual_regions), 2)
        grouped = next(
            item for item in visual_regions
            if item["diagnosticCandidateCount"] == 3
        )
        self.assertEqual(
            [candidate["text"] for candidate in grouped["diagnosticCandidates"]],
            [variant["text"] for variant in variants[:3]],
        )
        self.assertAlmostEqual(grouped["bounds"]["x"], 0.72)
        self.assertAlmostEqual(grouped["bounds"]["y"], 0.274)
        self.assertAlmostEqual(grouped["bounds"]["width"], 0.23)
        self.assertAlmostEqual(grouped["bounds"]["height"], 0.034)

    def test_repeated_text_at_distinct_coordinates_is_reviewed_independently(self) -> None:
        repeated_measurements = [
            {
                "id": "measurement-upper",
                "text": '8\'-0"',
                "x": 0.73, "y": 0.566,
                "width": 0.009, "height": 0.004,
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "measurement-lower",
                "text": '8\'-0"',
                "x": 0.73, "y": 0.576,
                "width": 0.009, "height": 0.004,
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        def visual_regions_for(regions: list[dict[str, object]]) -> list[dict[str, object]]:
            unresolved = unresolved_regions(
                [{"text": "trusted searchable text"}],
                {"sheetMappingStatus": "verified"},
                native_character_count=900,
                ocr_attempted=True,
                low_confidence_regions=regions,
            )
            return [
                item for item in unresolved
                if item["regionKey"].startswith("low-confidence-ocr-")
            ]

        visual_regions = visual_regions_for(repeated_measurements)

        self.assertEqual(2, len(visual_regions))
        self.assertTrue(all(
            item["diagnosticCandidateCount"] == 1
            for item in visual_regions
        ))
        self.assertEqual(
            [0.566, 0.576],
            [item["diagnosticCandidates"][0]["bounds"]["y"] for item in visual_regions],
        )
        self.assertEqual(
            visual_regions,
            visual_regions_for(list(reversed(repeated_measurements))),
        )

    def test_distinct_stacked_measurements_are_reviewed_independently(self) -> None:
        stacked_measurements = [
            {
                "id": "measurement-upper",
                "text": '15\'-O"',
                "x": 0.208889, "y": 0.072,
                "width": 0.01127, "height": 0.003333,
                "confidence": 0.19,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "measurement-lower",
                "text": '50\'-0"',
                "x": 0.209206, "y": 0.079556,
                "width": 0.010635, "height": 0.003111,
                "confidence": 0.10,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        def visual_regions_for(regions: list[dict[str, object]]) -> list[dict[str, object]]:
            unresolved = unresolved_regions(
                [{"text": "trusted searchable text"}],
                {"sheetMappingStatus": "verified"},
                native_character_count=900,
                ocr_attempted=True,
                low_confidence_regions=regions,
            )
            return [
                item for item in unresolved
                if item["regionKey"].startswith("low-confidence-ocr-")
            ]

        visual_regions = visual_regions_for(stacked_measurements)

        self.assertEqual(2, len(visual_regions))
        self.assertTrue(all(
            item["diagnosticCandidateCount"] == 1
            for item in visual_regions
        ))
        self.assertEqual(
            ['15\'-O"', '50\'-0"'],
            [item["diagnosticCandidates"][0]["text"] for item in visual_regions],
        )
        self.assertEqual(
            visual_regions,
            visual_regions_for(list(reversed(stacked_measurements))),
        )

    def test_overlapping_measurement_alternatives_remain_one_fail_closed_group(self) -> None:
        overlapping_alternatives = [
            {
                "id": "measurement-reading-a",
                "text": '15\'-0"',
                "x": 0.2089, "y": 0.072,
                "width": 0.0113, "height": 0.0034,
                "confidence": 0.19,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "measurement-reading-b",
                "text": '16\'-0"',
                "x": 0.2090, "y": 0.0721,
                "width": 0.0111, "height": 0.0032,
                "confidence": 0.10,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=overlapping_alternatives,
        )
        visual_regions = [
            item for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]

        self.assertEqual(1, len(visual_regions))
        self.assertEqual(2, visual_regions[0]["diagnosticCandidateCount"])

    def test_decimal_foot_diagnostic_removes_only_rendered_leader_arrow(self) -> None:
        variants = [
            {
                "id": "dimension-with-leader",
                "text": "11.00'-<",
                "x": 0.569444, "y": 0.177222,
                "width": 0.017593, "height": 0.008056,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "non-measurement-with-leader",
                "text": "AREA A-<",
                "x": 0.20, "y": 0.30,
                "width": 0.04, "height": 0.01,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=variants,
        )
        visual_regions = [
            item for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]

        self.assertEqual(len(visual_regions), 2)
        self.assertEqual(
            visual_regions[0]["diagnosticCandidates"][0]["text"],
            "11.00'",
        )
        self.assertAlmostEqual(
            visual_regions[0]["diagnosticCandidates"][0]["bounds"]["width"],
            round(0.017593 * 6 / 8, 6),
        )
        self.assertAlmostEqual(visual_regions[0]["bounds"]["width"], 0.017593)
        self.assertEqual(
            visual_regions[1]["diagnosticCandidates"][0]["text"],
            "AREA A-<",
        )
        self.assertAlmostEqual(
            visual_regions[1]["diagnosticCandidates"][0]["bounds"]["width"],
            0.04,
        )

    def test_incomplete_foot_inch_fragment_is_not_a_fact_authority(self) -> None:
        variants = [
            {
                "id": "missing-inch-value",
                "text": '24\'-"',
                "x": 0.780635, "y": 0.328,
                "width": 0.009841, "height": 0.003333,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "complete-measurement",
                "text": '30\'-5"',
                "x": 0.618254, "y": 0.408,
                "width": 0.01, "height": 0.003333,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=variants,
        )
        visual_regions = [
            item for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]

        self.assertEqual(1, len(visual_regions))
        self.assertEqual(
            '30\'-5"',
            visual_regions[0]["diagnosticCandidates"][0]["text"],
        )

    def test_incomplete_parenthesized_foot_sum_fragment_is_narrowly_rejected(self) -> None:
        rejected = [
            "(140'+",
            "(140’ +",
            "(140 FT +",
            "(140 FEET+",
            "(140.25 FOOT +",
        ]
        preserved = [
            "140'",
            "+140'",
            "(140')",
            "(140'+)",
            "140'+/-",
            "(140'+ 5 ELLSX5) x 1.25/100",
        ]

        for text in rejected:
            with self.subTest(rejected=text):
                self.assertEqual("", visual_diagnostic_candidate_text(text))
        for text in preserved:
            with self.subTest(preserved=text):
                self.assertEqual(text, visual_diagnostic_candidate_text(text))

    def test_missing_zero_inch_marker_is_only_completed_for_visual_review(self) -> None:
        self.assertEqual('82\'-0"', visual_diagnostic_candidate_text("82'-0"))
        self.assertEqual('7\'-0"', visual_diagnostic_candidate_text("7\u2019 - 0"))

        # Missing or non-zero inch values and corrupted digits are never
        # inferred by this narrow candidate-only normalization.
        for text in ('24\'-"', "82'-4", "82'-O", "82'-Q"):
            with self.subTest(text=text):
                self.assertNotEqual('82\'-0"', visual_diagnostic_candidate_text(text))

        raw = {
            "id": "raw-missing-inch-marker",
            "text": "82'-0",
            "x": 0.51303,
            "y": 0.774118,
            "width": 0.01,
            "height": 0.003137,
            "confidence": 0.0,
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=[raw],
        )
        candidates = unresolved[0]["diagnosticCandidates"]
        self.assertEqual('82\'-0"', candidates[0]["text"])
        self.assertEqual(
            {key: raw[key] for key in ("x", "y", "width", "height")},
            candidates[0]["bounds"],
        )

    def test_corrupted_measurement_never_bypasses_visual_correction_by_confidence(self) -> None:
        corrupted = {
            "id": "stylized-zero", "text": "21'-O\"",
            "x": 0.646032, "y": 0.312889,
            "width": 0.009683, "height": 0.003111,
            "confidence": 0.91,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
        }
        accepted, rejected = trusted_ocr_regions([corrupted])
        self.assertEqual([], accepted)
        self.assertEqual(["21'-O\""], [item["text"] for item in rejected])

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=rejected,
        )
        candidate = unresolved[0]["diagnosticCandidates"][0]
        self.assertEqual(
            "fixed_visual_tile_measurement_transcription_correction",
            candidate["source"],
        )
        self.assertLess(candidate["bounds"]["x"], corrupted["x"])
        self.assertGreater(candidate["bounds"]["width"], corrupted["width"])

        alternate_letter = {**corrupted, "id": "alternate-letter-zero",
                            "text": "20'-e\""}
        accepted, rejected = trusted_ocr_regions([alternate_letter])
        self.assertEqual([], accepted)
        self.assertEqual(["20'-e\""], [item["text"] for item in rejected])
        alternate_unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=rejected,
        )
        self.assertEqual(
            "fixed_visual_tile_measurement_transcription_correction",
            alternate_unresolved[0]["diagnosticCandidates"][0]["source"],
        )

    def test_measurement_correction_prefers_complete_same_line_phrase(self) -> None:
        common = {
            "y": 0.312889, "height": 0.003111,
            "confidence": 0.3,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-1",
            "ocrBlockNumber": 12,
            "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        raw = [
            {**common, "id": "word-1", "text": "24'-D\"",
             "ocrKind": "word", "x": 0.629365, "width": 0.009841},
            {**common, "id": "word-2", "text": "21'-O\"",
             "ocrKind": "word", "x": 0.646032, "width": 0.009683},
            {**common, "id": "line", "text": "24'-D\" TO 21'-O\" MAX.",
             "ocrKind": "line", "x": 0.629365, "width": 0.035873},
        ]
        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=raw,
        )
        self.assertEqual(1, len(unresolved))
        candidates = unresolved[0]["diagnosticCandidates"]
        self.assertEqual(1, len(candidates))
        self.assertEqual("24'-D\" TO 21'-O\" MAX.", candidates[0]["text"])
        self.assertEqual(
            "fixed_visual_tile_measurement_transcription_correction",
            candidates[0]["source"],
        )

    def test_measurement_correction_preserves_two_qualifier_phrase_and_context(self) -> None:
        common = {
            "x": 0.805238, "y": 0.923556,
            "confidence": 0.52,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-667:500:333:500-subtile-2:1",
            "ocrBlockNumber": 33, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        raw = [
            {**common, "id": "word", "text": "5'-O\"",
             "ocrKind": "word", "width": 0.008254, "height": 0.003333},
            {**common, "id": "line", "text": "5'-O\" MIN. TYP",
             "ocrKind": "line", "width": 0.022857, "height": 0.003333},
        ]

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=raw,
        )

        self.assertEqual(1, len(unresolved))
        candidate = unresolved[0]["diagnosticCandidates"][0]
        self.assertEqual("5'-O\" MIN. TYP", candidate["text"])
        self.assertEqual(VISUAL_MEASUREMENT_CORRECTION_SOURCE, candidate["source"])
        self.assertLessEqual(candidate["bounds"]["x"], 0.796238)
        self.assertGreaterEqual(
            candidate["bounds"]["x"] + candidate["bounds"]["width"],
            0.837095,
        )

    def test_bounded_measurement_reconstruction_requires_two_exact_reads(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        raw = [
            {
                "id": "left-prefix", "text": "16'-",
                "x": 0.206364, "y": 0.121569,
                "width": 0.010909, "height": 0.003922,
                "confidence": 0.34,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrBoundaryTruncated": False,
            },
            {
                "id": "right-prefix", "text": "14'-5",
                "x": 0.883939, "y": 0.121569,
                "width": 0.013636, "height": 0.003922,
                "confidence": 0.25,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrBoundaryTruncated": False,
            },
        ]

        def read_for_clip(_page, clip, *_args, **_kwargs):
            is_left = clip.x0 < 500
            return [{
                "id": "read",
                "text": "16-0" if is_left else "14-51/2",
                "x": 0.204 if is_left else 0.879,
                "y": 0.119,
                "width": 0.025 if is_left else 0.033,
                "height": 0.006,
                "confidence": 0.4,
                "source": "bounded_measurement_ocr_primary",
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=read_for_clip,
        ):
            result = reconstruct_bounded_measurement_ocr_candidates(
                page, raw, page_width=1000, page_height=1000,
            )

        self.assertEqual(4, len(result))
        self.assertEqual(
            ["superseded_by_bounded_measurement_ocr"] * 2,
            [item.get("visualAuthorityStatus") for item in result[:2]],
        )
        self.assertEqual(
            ["16'-0\"", "14'-5 1/2\""],
            [item["text"] for item in result[2:]],
        )
        self.assertEqual(
            ["bounded_measurement_ocr_candidate"] * 2,
            [item["source"] for item in result[2:]],
        )

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=[
                [{
                    "text": "16-0", "ocrKind": "word",
                    "x": 0.204, "y": 0.119, "width": 0.025, "height": 0.006,
                }],
                [{
                    "text": "16-5", "ocrKind": "word",
                    "x": 0.204, "y": 0.119, "width": 0.025, "height": 0.006,
                }],
            ],
        ):
            mismatch = reconstruct_bounded_measurement_ocr_candidates(
                page, [raw[0]], page_width=1000, page_height=1000,
            )
        self.assertEqual([raw[0]], mismatch)
        self.assertEqual("", visual_diagnostic_candidate_text("16'-"))
        self.assertEqual("", visual_diagnostic_candidate_text("14'-5"))
        self.assertEqual("", visual_diagnostic_candidate_text("20'-om"))

    def test_complete_measurement_corroboration_requires_two_exact_rendered_reads(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        raw = {
            "id": "tiny-complete-dimension", "text": "14'-4 3/8\"",
            "x": 0.883939, "y": 0.128627,
            "width": 0.028182, "height": 0.004314,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line", "ocrBoundaryTruncated": False,
            "ocrValidationStatus": "unresolved_low_confidence",
        }

        def exact_read(*_args, **kwargs):
            return [{
                "id": f"read-{kwargs['dpi']}",
                "text": "14-43/8",
                "x": 0.884, "y": 0.129,
                "width": 0.027, "height": 0.004,
                "confidence": 0.7,
                "source": kwargs["source"],
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=exact_read,
        ):
            accepted, audited = corroborated_bounded_measurement_ocr_regions(
                page, [raw], page_width=1000, page_height=1000,
            )

        self.assertEqual(["14'-4 3/8\""], [item["text"] for item in accepted])
        self.assertEqual(
            ["bounded_measurement_ocr_primary", "bounded_measurement_ocr_corroboration"],
            accepted[0]["evidenceSources"],
        )
        self.assertTrue(accepted[0]["searchable"])
        self.assertEqual(
            "validated_by_two_resolution_measurement_ocr",
            audited[0]["visualAuthorityStatus"],
        )
        self.assertEqual([], unresolved_regions(
            accepted,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=audited,
        ))

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=[exact_read(dpi=300, source="primary"), [{
                "text": "14-41/2", "ocrKind": "word",
                "x": 0.884, "y": 0.129, "width": 0.027, "height": 0.004,
            }]],
        ):
            mismatch_accepted, mismatch_audited = (
                corroborated_bounded_measurement_ocr_regions(
                    page, [raw], page_width=1000, page_height=1000,
                )
            )
        self.assertEqual([], mismatch_accepted)
        self.assertEqual([raw], mismatch_audited)

        fail_closed_variants = [
            {**raw, "source": "title_block_ocr"},
            {**raw, "ocrKind": "other"},
            {**raw, "ocrBoundaryTruncated": True},
            {**raw, "width": 0.04},
            {**raw, "text": "14'-12\""},
            {**raw, "text": "14'-4 8/8\""},
        ]
        with patch("ecos_indexer.extraction.ocr_regions_for_clip") as read:
            for variant in fail_closed_variants:
                with self.subTest(variant=variant):
                    rejected, retained = corroborated_bounded_measurement_ocr_regions(
                        page, [variant], page_width=1000, page_height=1000,
                    )
                    self.assertEqual([], rejected)
                    self.assertEqual([variant], retained)
        read.assert_not_called()

    def test_exact_page30_dimensions_replace_only_bound_raw_authorities(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def region_for_spec(
            spec: dict[str, object], index: int,
        ) -> tuple[dict[str, object], list[dict[str, object]]]:
            raw_spec = spec["raw"]
            self.assertIsInstance(raw_spec, dict)
            word = {
                "id": f"raw-page30-word-{index}",
                "text": raw_spec["text"],
                **spec["bounds"],
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word",
                "ocrBoundaryTruncated": False,
                "ocrPrefix": raw_spec["ocrPrefix"],
                "ocrBlockNumber": index + 1,
                "ocrParagraphNumber": 1,
                "ocrLineNumber": 1,
            }
            regions = [word]
            line_spec = spec.get("supersededLine")
            if isinstance(line_spec, dict):
                regions.append({
                    "id": f"raw-page30-line-{index}",
                    "text": line_spec["text"],
                    **line_spec["bounds"],
                    "confidence": 0.2,
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "ocrKind": "line",
                    "ocrBoundaryTruncated": False,
                    "ocrPrefix": raw_spec["ocrPrefix"],
                    "ocrBlockNumber": index + 1,
                    "ocrParagraphNumber": 1,
                    "ocrLineNumber": 1,
                })
            return word, regions

        raw: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for index, spec in enumerate(
            EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS
        ):
            _, regions = region_for_spec(spec, index)
            raw.extend(copy.deepcopy(regions))
            low.extend(copy.deepcopy(regions))
        unrelated = {
            "id": "unrelated-measurement",
            "text": "8'-0\"",
            "x": 0.1, "y": 0.1, "width": 0.01, "height": 0.004,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-unrelated",
            "ocrBlockNumber": 1, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        raw.append(copy.deepcopy(unrelated))
        low.append(copy.deepcopy(unrelated))

        trusted, result = reconstruct_exact_architectural_2321_page30_dimension_candidates(
            [],
            low,
            raw_regions=raw,
            project_id=project_id,
            page_number=30,
            source_sha256=source_sha256,
            evidence_version="ecos-hosted-evidence/1.3",
        )
        self.assertEqual([], trusted)
        composites = [
            region for region in result
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
        ]
        self.assertEqual(13, len(composites))
        self.assertEqual(
            [spec["text"] for spec in EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS],
            [region["text"] for region in composites],
        )
        self.assertTrue(all(region["searchable"] is False for region in composites))
        self.assertEqual(
            2,
            sum(bool(region.get("visualAuthorityReviewGroup")) for region in composites),
        )
        superseded = [
            region for region in result
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page30_dimension_candidate"
        ]
        self.assertEqual(14, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertIn(unrelated, result)

    def test_exact_page30_dimension_binding_fails_closed_on_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )
        spec = EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS[0]
        raw_spec = spec["raw"]
        baseline = {
            "id": "raw-page30-word",
            "text": raw_spec["text"],
            **spec["bounds"],
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word",
            "ocrBoundaryTruncated": False,
            "ocrPrefix": raw_spec["ocrPrefix"],
            "ocrBlockNumber": 1,
            "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }

        def run(
            trusted: list[dict[str, object]],
            low: list[dict[str, object]],
            raw: list[dict[str, object]],
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page30_dimension_candidates(
                trusted,
                low,
                raw_regions=raw,
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 30),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 29},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(
                    ([], [baseline]),
                    run([], [baseline], [baseline], **identity),
                )

        mutations = (
            {"text": "not a measurement"},
            {"x": 0.134922},
            {"ocrPrefix": "visual-tile-wrong"},
            {"source": "other"},
            {"ocrKind": "line"},
            {"ocrBoundaryTruncated": True},
            {"ocrBlockNumber": False},
        )
        for mutation in mutations:
            altered = {**baseline, **mutation}
            with self.subTest(mutation=mutation):
                self.assertEqual(
                    ([], [altered]),
                    run([], [altered], [copy.deepcopy(altered)]),
                )
        self.assertEqual(
            ([], [baseline]),
            run([], [baseline], [baseline, copy.deepcopy(baseline)]),
        )
        duplicate_low = {**baseline, "id": "duplicate-low-page30-word"}
        self.assertEqual(
            ([], [baseline, duplicate_low]),
            run([], [baseline, duplicate_low], [baseline]),
        )

        runtime_variant = {
            **baseline,
            "text": "231'-2!'",
            "confidence": 0.49,
        }
        runtime_spec = EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS[3]
        runtime_variant = {
            **runtime_variant,
            **runtime_spec["bounds"],
            "ocrPrefix": runtime_spec["raw"]["ocrPrefix"],
        }
        trusted_result, low_result = run(
            [runtime_variant], [], [copy.deepcopy(runtime_variant)]
        )
        self.assertEqual([], trusted_result)
        self.assertEqual(
            runtime_spec["text"],
            next(
                region["text"] for region in low_result
                if region.get("source")
                == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
            ),
        )
        self.assertEqual(
            "superseded_by_exact_rendered_page30_dimension_candidate",
            next(
                region["visualAuthorityStatus"] for region in low_result
                if region.get("id") == runtime_variant["id"]
            ),
        )

        line_spec = next(
            item for item in EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS
            if item.get("supersededLine")
        )
        line_raw = line_spec["raw"]
        word = {
            "id": "line-bound-word", "text": line_raw["text"],
            **line_spec["bounds"], "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr", "ocrKind": "word",
            "ocrBoundaryTruncated": False, "ocrPrefix": line_raw["ocrPrefix"],
            "ocrBlockNumber": 9, "ocrParagraphNumber": 1, "ocrLineNumber": 1,
        }
        self.assertEqual(([], [word]), run([], [word], [word]))

    def test_exact_page30_complete_propositions_replace_only_bound_fragments(
        self,
    ) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def constituent(
            spec: dict[str, object], proposition_index: int, index: int,
        ) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": f"page30-complete-{proposition_index}-{index}",
                "text": spec.get("text", "24'-2\""),
                **spec["bounds"],
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        raw: list[dict[str, object]] = []
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for proposition_index, proposition in enumerate(
            EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS
        ):
            constituents = [
                constituent(item, proposition_index, index)
                for index, item in enumerate(proposition["constituents"])
            ]
            raw.extend(copy.deepcopy(constituents))
            trusted.append(copy.deepcopy(constituents[0]))
            low.extend(copy.deepcopy(constituents[1:]))
            superseded = proposition["supersededCandidate"]
            fragment = {
                "id": superseded.get(
                    "id", f"page30-fragment-{proposition_index}"
                ),
                "text": superseded["text"],
                **superseded["bounds"],
                "confidence": 0.2,
                "source": superseded["source"],
                "searchable": False,
            }
            if not any(
                region.get("text") == fragment["text"]
                and region.get("source") == fragment["source"]
                and all(
                    region.get(key) == fragment.get(key)
                    for key in ("x", "y", "width", "height")
                )
                for region in low
            ):
                low.append(fragment)

        trusted_result, low_result = (
            reconstruct_exact_architectural_2321_page30_complete_propositions(
                trusted,
                low,
                raw_regions=raw,
                project_id=project_id,
                page_number=30,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        composites = [
            region for region in low_result
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
            and region.get("visualAuthorityStatus")
            == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
        ]
        self.assertEqual([], trusted_result)
        self.assertEqual(
            [spec["text"] for spec in EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS],
            [region["text"] for region in composites],
        )
        self.assertEqual(
            [spec["bounds"] for spec in EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS],
            [
                {key: region[key] for key in ("x", "y", "width", "height")}
                for region in composites
            ],
        )
        self.assertTrue(all(region["searchable"] is False for region in composites))
        superseded = [
            region for region in low_result
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page30_complete_proposition_candidate"
        ]
        self.assertEqual(7, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertNotIn("24'-0\"", {
            region["text"] for region in low_result
            if region.get("visualAuthorityStatus")
            == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
        })
        self.assertNotIn("186'", {
            region["text"] for region in low_result
            if region.get("visualAuthorityStatus")
            == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
        })

        production_raw = copy.deepcopy(raw)
        production_raw[0]["text"] = "RROOF DECK HEIGHT:"
        production_raw[4]["ocrBlockNumber"] = 10
        production_raw[5]["ocrBlockNumber"] = 11
        production_raw[5]["text"] = "q"
        _, production_low = (
            reconstruct_exact_architectural_2321_page30_complete_propositions(
                trusted,
                low,
                raw_regions=production_raw,
                project_id=project_id,
                page_number=30,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertEqual(
            [
                "ROOF DECK HEIGHT: MINIMUM 24'-0\"",
                "EXIT E-2 = 186'-4\"",
            ],
            [
                region["text"] for region in production_low
                if region.get("source")
                == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
            ],
        )

        wrong_quote_raw = copy.deepcopy(production_raw)
        wrong_quote_raw[5]["text"] = "r"
        _, wrong_quote_low = (
            reconstruct_exact_architectural_2321_page30_complete_propositions(
                trusted,
                low,
                raw_regions=wrong_quote_raw,
                project_id=project_id,
                page_number=30,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertEqual(
            ["ROOF DECK HEIGHT: MINIMUM 24'-0\""],
            [
                region["text"] for region in wrong_quote_low
                if region.get("source")
                == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
            ],
        )

    def test_exact_page30_complete_propositions_fail_closed_on_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )
        proposition = EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS[0]

        def constituent(spec: dict[str, object], index: int) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": f"page30-bound-{index}",
                "text": spec.get("text", "24'-2\""),
                **spec["bounds"],
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        raw = [
            constituent(spec, index)
            for index, spec in enumerate(proposition["constituents"])
        ]
        fragment_spec = proposition["supersededCandidate"]
        fragment = {
            "id": fragment_spec["id"],
            "text": fragment_spec["text"],
            **fragment_spec["bounds"],
            "confidence": 0.0,
            "source": fragment_spec["source"],
            "searchable": False,
        }

        def run(
            raw_regions: list[dict[str, object]],
            low: list[dict[str, object]] | None = None,
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page30_complete_propositions(
                [],
                low if low is not None else [fragment],
                raw_regions=raw_regions,
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 30),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 29},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(([], [fragment]), run(raw, **identity))

        mutations = (
            {"text": "ROOF HEIGHT:"},
            {"x": 0.7},
            {"ocrPrefix": "visual-tile-wrong"},
            {"source": "other"},
            {"ocrKind": "word"},
            {"ocrBoundaryTruncated": True},
            {"ocrBlockNumber": False},
        )
        for mutation in mutations:
            altered = [{**region} for region in raw]
            altered[0] = {**altered[0], **mutation}
            with self.subTest(mutation=mutation):
                self.assertEqual(([], [fragment]), run(altered))
        for mutation in (
            {"text": "RRROOF DECK HEIGHT:"},
            {"ocrBlockNumber": 19},
        ):
            altered = [{**region} for region in raw]
            altered[0] = {**altered[0], **mutation}
            with self.subTest(unapproved_production_variant=mutation):
                self.assertEqual(([], [fragment]), run(altered))
        self.assertEqual(([], [fragment]), run([*raw, copy.deepcopy(raw[0])]))
        self.assertEqual(
            ([], [fragment, {**fragment, "id": "duplicate-fragment"}]),
            run(raw, [fragment, {**fragment, "id": "duplicate-fragment"}]),
        )

    def test_exact_page31_complete_propositions_replace_only_bound_fragments(
        self,
    ) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def authority(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"],
                **spec["bounds"], "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": spec.get(
                    "ocrBoundaryTruncated", False,
                ),
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        raw = [
            authority(item)
            for proposition in EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS
            for item in (
                *proposition["constituents"],
                *proposition.get("auditOnly", ()),
            )
        ]
        trusted = copy.deepcopy(raw[1::2])
        low = copy.deepcopy(raw[::2])
        unrelated = {
            "id": "page31-unrelated", "text": "5'-0\"",
            "x": 0.2, "y": 0.2, "width": 0.01, "height": 0.004,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-unrelated",
            "ocrBlockNumber": 1, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        low.append(unrelated)
        trusted_result, low_result = (
            reconstruct_exact_architectural_2321_page31_complete_propositions(
                trusted,
                low,
                raw_regions=copy.deepcopy(raw),
                project_id=project_id,
                page_number=31,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertEqual([], trusted_result)
        composites = [
            region for region in low_result
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE
        ]
        self.assertEqual(
            [
                spec["text"]
                for spec in EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS
            ],
            [region["text"] for region in composites],
        )
        self.assertEqual(
            [
                spec["bounds"]
                for spec in EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS
            ],
            [
                {key: region[key] for key in ("x", "y", "width", "height")}
                for region in composites
            ],
        )
        self.assertTrue(all(region["searchable"] is False for region in composites))
        superseded = [
            region for region in low_result
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page31_complete_proposition_candidate"
        ]
        self.assertEqual(len(raw), len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertIn(unrelated, low_result)

    def test_exact_page31_complete_propositions_fail_closed_on_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def authority(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"],
                **spec["bounds"], "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": spec.get(
                    "ocrBoundaryTruncated", False,
                ),
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        def raw_for(proposition: dict[str, object]) -> list[dict[str, object]]:
            return [
                authority(item)
                for item in (
                    *proposition["constituents"],
                    *proposition.get("auditOnly", ()),
                )
            ]

        def run(
            raw: list[dict[str, object]], **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page31_complete_propositions(
                [], copy.deepcopy(raw), raw_regions=copy.deepcopy(raw),
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 31),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3",
                ),
            )

        for proposition in EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS:
            baseline = raw_for(proposition)
            with self.subTest(proposition=proposition["id"]):
                _, accepted = run(baseline)
                self.assertEqual(
                    [proposition["text"]],
                    [
                        region["text"] for region in accepted
                        if region.get("source")
                        == EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE
                    ],
                )
                for mutation in (
                    {"id": "wrong-id"},
                    {"text": "wrong"},
                    {"x": 0.1},
                    {"source": "other"},
                    {"ocrKind": "line"},
                    {"ocrPrefix": "visual-tile-wrong"},
                    {"ocrBlockNumber": False},
                    {
                        "ocrBoundaryTruncated": not bool(
                            baseline[0]["ocrBoundaryTruncated"]
                        ),
                    },
                ):
                    altered = copy.deepcopy(baseline)
                    altered[0] = {**altered[0], **mutation}
                    _, rejected = run(altered)
                    self.assertFalse(any(
                        region.get("source")
                        == EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE
                        for region in rejected
                    ))
                _, duplicated = run([*baseline, copy.deepcopy(baseline[0])])
                self.assertFalse(any(
                    region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SOURCE
                    for region in duplicated
                ))

        dimension = raw_for(EXACT_ARCHITECTURAL_2321_PAGE31_PROPOSITION_SPECS[0])
        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 30},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(([], dimension), run(dimension, **identity))

    def test_exact_page36_clearance_uses_one_complete_review_authority(self) -> None:
        def authority(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"],
                **spec["bounds"], "confidence": 0.55,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        raw = [
            authority(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS
        ]
        unrelated = {
            "id": "page36-unrelated", "text": "5'-0\"",
            "x": 0.2, "y": 0.2, "width": 0.01, "height": 0.004,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-unrelated",
            "ocrBlockNumber": 1, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        trusted, low = reconstruct_exact_architectural_2321_page36_clearance_proposition(
            [], [*copy.deepcopy(raw), unrelated],
            raw_regions=copy.deepcopy(raw),
            project_id="607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            page_number=36,
            source_sha256=(
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            evidence_version="ecos-hosted-evidence/1.3",
        )
        self.assertEqual([], trusted)
        composites = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE
        ]
        self.assertEqual(1, len(composites))
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT, composites[0]["text"])
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS[1]["bounds"],
            {key: composites[0][key] for key in ("x", "y", "width", "height")},
        )
        self.assertIs(composites[0]["searchable"], False)
        superseded = [
            region for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page36_clearance_proposition_candidate"
        ]
        self.assertEqual(2, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertIn(unrelated, low)

    def test_exact_page36_clearance_fails_closed_on_any_authority_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def authority(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"],
                **spec["bounds"], "confidence": 0.55,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        baseline = [
            authority(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SPECS
        ]

        def run(
            raw: list[dict[str, object]], **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page36_clearance_proposition(
                [], copy.deepcopy(raw), raw_regions=copy.deepcopy(raw),
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 36),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3",
                ),
            )

        for mutation in (
            {"id": "wrong-id"},
            {"text": "5'-0\" CLR"},
            {"x": 0.1},
            {"source": "other"},
            {"ocrKind": "word"},
            {"ocrPrefix": "visual-tile-wrong"},
            {"ocrBlockNumber": False},
            {"ocrBoundaryTruncated": True},
        ):
            altered = copy.deepcopy(baseline)
            altered[1] = {**altered[1], **mutation}
            with self.subTest(mutation=mutation):
                self.assertEqual(([], altered), run(altered))
        self.assertEqual(
            ([], [*baseline, copy.deepcopy(baseline[0])]),
            run([*baseline, copy.deepcopy(baseline[0])]),
        )
        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 35},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(([], baseline), run(baseline, **identity))

    def test_exact_page39_uses_two_complete_independent_review_authorities(
        self,
    ) -> None:
        def authority(spec: dict[str, object]) -> dict[str, object]:
            expected = spec["authority"]
            block, paragraph, line = expected["lineage"]
            return {
                "id": expected["acceptedIds"][0],
                "text": expected["acceptedTexts"][0],
                **expected["bounds"],
                "confidence": 0.22,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": expected["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": expected["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        raw = [
            authority(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS
        ]
        standalone = {
            "id": "unrelated-page39-dimension",
            "text": "4'-0\"",
            "x": 0.2, "y": 0.2, "width": 0.01, "height": 0.004,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-unrelated",
            "ocrBlockNumber": 1, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        trusted, low = reconstruct_exact_architectural_2321_page39_complete_propositions(
            [], [*copy.deepcopy(raw), standalone],
            raw_regions=copy.deepcopy(raw),
            project_id="607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            page_number=39,
            source_sha256=(
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            evidence_version="ecos-hosted-evidence/1.3",
        )
        self.assertEqual([], trusted)
        candidates = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SOURCE
        ]
        self.assertEqual(
            [spec["canonicalText"] for spec in EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS],
            [region["text"] for region in candidates],
        )
        self.assertEqual(
            [spec["candidateBounds"] for spec in EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS],
            [
                {key: region[key] for key in ("x", "y", "width", "height")}
                for region in candidates
            ],
        )
        self.assertTrue(all(region["searchable"] is False for region in candidates))
        superseded = [
            region for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page39_complete_proposition_candidate"
        ]
        self.assertEqual(2, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertIn(standalone, low)

    def test_exact_page39_binding_fails_closed_per_proposition_on_drift(
        self,
    ) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def authority(spec: dict[str, object]) -> dict[str, object]:
            expected = spec["authority"]
            block, paragraph, line = expected["lineage"]
            return {
                "id": expected["acceptedIds"][0],
                "text": expected["acceptedTexts"][0],
                **expected["bounds"],
                "confidence": 0.22,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": expected["ocrKind"],
                "ocrBoundaryTruncated": False,
                "ocrPrefix": expected["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        baseline = [
            authority(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS
        ]

        def run(
            raw: list[dict[str, object]], **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page39_complete_propositions(
                [], copy.deepcopy(raw), raw_regions=copy.deepcopy(raw),
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 39),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3",
                ),
            )

        for index, mutation in enumerate((
            {"id": "wrong-id"},
            {"text": "4'-0\""},
            {"x": 0.1},
            {"source": "other"},
            {"ocrKind": "line"},
            {"ocrPrefix": "visual-tile-wrong"},
            {"ocrBlockNumber": False},
            {"ocrBoundaryTruncated": True},
        )):
            affected = index % len(baseline)
            altered = copy.deepcopy(baseline)
            altered[affected] = {**altered[affected], **mutation}
            with self.subTest(mutation=mutation, affected=affected):
                _, low = run(altered)
                candidates = [
                    region for region in low
                    if region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SOURCE
                ]
                self.assertEqual(1, len(candidates))
                self.assertNotEqual(
                    EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS[affected]["canonicalText"],
                    candidates[0]["text"],
                )
        duplicated = [*baseline, copy.deepcopy(baseline[0])]
        _, low = run(duplicated)
        self.assertEqual(
            [EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SPECS[1]["canonicalText"]],
            [
                region["text"] for region in low
                if region.get("source")
                == EXACT_ARCHITECTURAL_2321_PAGE39_PROPOSITION_SOURCE
            ],
        )
        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 38},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(([], baseline), run(baseline, **identity))

    def test_exact_page38_schedule_repairs_grid_syntax_and_queues_ambiguity(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def fixed_word(spec: dict[str, object], index: int) -> dict[str, object]:
            return {
                "id": spec["id"],
                "text": spec["text"],
                **spec["bounds"],
                "confidence": 0.4,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word",
                "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": index + 1,
                "ocrParagraphNumber": 1,
                "ocrLineNumber": 1,
            }

        headers = [
            fixed_word(spec, index)
            for index, spec in enumerate(
                EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS
            )
        ]
        ambiguous = [
            fixed_word(spec, index + 10)
            for index, spec in enumerate(
                EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS
            )
        ]
        artifacts = [
            fixed_word(spec, index + 30)
            for index, spec in enumerate(
                EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS
            )
        ]
        direct = {
            "id": "page38-direct-grid-value", "text": "3-0\")",
            "x": 0.417, "y": 0.60, "width": 0.008, "height": 0.004,
            "confidence": 0.75,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-page38-direct",
            "ocrBlockNumber": 60, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }
        anchor = {
            **direct,
            "id": "page38-height-anchor", "text": "7-0\"",
            "x": 0.434, "y": 0.61, "width": 0.008, "height": 0.0035,
            "ocrBlockNumber": 61,
        }
        fragment = {
            **direct,
            "id": "page38-height-fragment", "text": "0\"",
            "x": 0.439, "y": 0.60875, "width": 0.004, "height": 0.006,
            "ocrPrefix": "visual-tile-page38-overlap",
            "ocrBlockNumber": 62,
        }
        unrelated = {
            **direct,
            "id": "unrelated-page38-measurement", "text": "9'-0\"",
            "x": 0.2, "y": 0.2,
        }
        raw = [
            *headers, *ambiguous, *artifacts,
            direct, anchor, fragment, unrelated,
        ]
        trusted, low = reconstruct_exact_architectural_2321_page38_schedule_measurements(
            [*artifacts, direct, anchor, fragment, unrelated],
            ambiguous,
            raw_regions=raw,
            project_id=project_id,
            page_number=38,
            source_sha256=source_sha256,
            evidence_version="ecos-hosted-evidence/1.3",
        )

        composites = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
        ]
        self.assertEqual(
            [spec["canonical"] for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS],
            [region["text"] for region in composites],
        )
        self.assertTrue(all(region["searchable"] is False for region in composites))
        corrected = [
            region for region in trusted
            if region.get("source") == "exact_page38_door_schedule_grid_measurement"
        ]
        self.assertEqual(["3'-0\"", "7'-0\""], [item["text"] for item in corrected])
        self.assertTrue(all(item["searchable"] is True for item in corrected))
        self.assertTrue(all(
            str(item["id"]).endswith("-exact-page38-schedule-measurement")
            for item in corrected
        ))
        audited_ids = {
            str(region.get("id")) for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_page38_door_schedule_measurement"
        }
        self.assertTrue({item["id"] for item in ambiguous}.issubset(audited_ids))
        self.assertTrue({item["id"] for item in artifacts}.issubset(audited_ids))
        self.assertIn(direct["id"], audited_ids)
        self.assertIn(anchor["id"], audited_ids)
        self.assertIn(fragment["id"], audited_ids)
        self.assertIn(unrelated, trusted)

    def test_exact_page38_schedule_binding_fails_closed_on_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def fixed_word(spec: dict[str, object], index: int) -> dict[str, object]:
            return {
                "id": spec["id"], "text": spec["text"], **spec["bounds"],
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": index + 1,
                "ocrParagraphNumber": 1, "ocrLineNumber": 1,
            }

        headers = [
            fixed_word(spec, index)
            for index, spec in enumerate(
                EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS
            )
        ]
        spec = EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS[0]
        baseline = fixed_word(spec, 10)

        def run(
            low: list[dict[str, object]],
            raw: list[dict[str, object]],
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page38_schedule_measurements(
                [], low,
                raw_regions=[*headers, *raw],
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 38),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 37},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(([], [baseline]), run([baseline], [baseline], **identity))

        wrong_header = {**headers[0], "text": "WIDTH"}
        saved_headers = headers
        try:
            headers = [wrong_header, headers[1]]
            self.assertEqual(([], [baseline]), run([baseline], [baseline]))
        finally:
            headers = saved_headers

        unknown_height_header = {**headers[1], "text": "HE1GHT"}
        try:
            headers = [headers[0], unknown_height_header]
            self.assertEqual(([], [baseline]), run([baseline], [baseline]))
        finally:
            headers = saved_headers

        # Raw OCR drift cannot become searchable authority. The immutable cell
        # still yields one untrusted proposition for ordinary dual-provider
        # review, while a nonmatching raw record remains in the audit set.
        for mutation in (
            {"text": "80\""}, {"x": 0.1},
            {"ocrPrefix": "visual-tile-wrong"}, {"source": "other"},
            {"ocrKind": "line"}, {"ocrBoundaryTruncated": True},
            {"ocrBlockNumber": False},
        ):
            altered = {**baseline, **mutation}
            with self.subTest(mutation=mutation):
                trusted, low = run([altered], [altered])
                self.assertEqual([], trusted)
                candidates = [
                    region for region in low
                    if region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
                ]
                self.assertEqual(10, len(candidates))
                self.assertTrue(all(
                    candidate.get("searchable") is False
                    for candidate in candidates
                ))
                self.assertTrue(any(
                    region.get("id") == altered.get("id")
                    for region in low
                ))

    def test_exact_page38_schedule_uses_cell_geometry_across_production_ocr_drift(
        self,
    ) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def fixed_word(spec: dict[str, object], index: int) -> dict[str, object]:
            return {
                "id": spec["id"], "text": spec["text"], **spec["bounds"],
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrBoundaryTruncated": False,
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": index + 1,
                "ocrParagraphNumber": 1, "ocrLineNumber": 1,
            }

        headers = [
            fixed_word(spec, index)
            for index, spec in enumerate(
                EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_HEADER_SPECS
            )
        ]
        headers[1] = {**headers[1], "text": "HEIGHT}"}
        specs = list(EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS)
        production: list[dict[str, object]] = []
        production_texts = (
            "7-0\"", "0\"", None, "7-07", "0'-0'",
            "i0’-0'", "70'-0\"", "12'-0\"|", "72'-0\"|", "7-07",
        )
        for index, (spec, text) in enumerate(zip(specs, production_texts)):
            if text is None:
                continue
            item = fixed_word(spec, index + 20)
            item["id"] = f"production-shifted-word-{index + 1}"
            item["text"] = text
            if index == 1:
                item.update({
                    "x": 0.421429, "y": 0.225333,
                    "width": 0.003175, "height": 0.003778,
                })
            production.append(item)

        bracketed_height = {
            "id": "production-row68-height", "text": "[10'-0\"]",
            "x": 0.432857, "y": 0.624667,
            "width": 0.01127, "height": 0.004889,
            "confidence": 0.02,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
            "ocrPrefix": "visual-tile-333:500:333:500-subtile-1:0",
            "ocrBlockNumber": 272,
            "ocrParagraphNumber": 1, "ocrLineNumber": 1,
        }
        raw = [*headers, *production, bracketed_height]
        trusted, low = reconstruct_exact_architectural_2321_page38_schedule_measurements(
            [], [*production, bracketed_height],
            raw_regions=raw,
            project_id=project_id,
            page_number=38,
            source_sha256=source_sha256,
            evidence_version="ecos-hosted-evidence/1.3",
        )

        spec_measurements = [
            region for region in trusted
            if str(region.get("id", "")).startswith(
                "exact-page38-schedule-cell-"
            )
        ]
        self.assertEqual(
            [("exact-page38-schedule-cell-01-measurement", "7'-0\""),
             ("exact-page38-schedule-cell-08-measurement", "12'-0\"")],
            [(region["id"], region["text"]) for region in spec_measurements],
        )
        candidates = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
        ]
        self.assertEqual(8, len(candidates))
        self.assertEqual(
            [spec["canonical"] for index, spec in enumerate(specs) if index not in {0, 7}],
            [candidate["text"] for candidate in candidates],
        )
        bracketed_correction = [
            region for region in trusted
            if region.get("rawOcrText") == "[10'-0\"]"
        ]
        self.assertEqual(1, len(bracketed_correction))
        self.assertEqual("10'-0\"", bracketed_correction[0]["text"])
        audited_ids = {
            str(region.get("id")) for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_page38_door_schedule_measurement"
        }
        self.assertTrue(
            {str(region["id"]) for region in production}.issubset(audited_ids)
        )
        self.assertIn(bracketed_height["id"], audited_ids)

    def test_exact_page40_landing_dimension_replaces_malformed_authorities(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def fixed_word(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"], **spec["bounds"],
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec.get("ocrKind", "word"),
                "ocrBoundaryTruncated": False,
                "ocrBoundaryTruncatedEdges": [],
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        malformed = [
            fixed_word(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS
        ]
        unrelated = {
            **malformed[0], "id": "unrelated-page40-measurement",
            "text": "8'-2\"", "x": 0.13, "y": 0.19,
        }

        def run(
            raw: list[dict[str, object]],
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page40_landing_dimension(
                [unrelated], malformed, raw_regions=raw,
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 40),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        trusted, low = run([*malformed, unrelated])
        composites = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
        ]
        self.assertEqual(1, len(composites))
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT, composites[0]["text"])
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS[0]["bounds"],
            {key: composites[0][key] for key in ("x", "y", "width", "height")},
        )
        self.assertIs(composites[0]["searchable"], False)
        audited_ids = {
            str(region.get("id")) for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page40_landing_dimension_composite"
        }
        self.assertEqual(
            {str(spec["id"]) for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS},
            audited_ids,
        )
        self.assertIn(unrelated, trusted)

        production = [
            fixed_word(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_PRODUCTION_SPECS
        ]
        production_trusted, production_low = (
            reconstruct_exact_architectural_2321_page40_landing_dimension(
                [unrelated], production, raw_regions=[*production, unrelated],
                project_id=project_id, page_number=40,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        production_composites = [
            region for region in production_low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
        ]
        self.assertEqual(1, len(production_composites))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
            production_composites[0]["text"],
        )
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_PRODUCTION_SPECS[0][
                "bounds"
            ],
            {
                key: production_composites[0][key]
                for key in ("x", "y", "width", "height")
            },
        )
        self.assertEqual([unrelated], production_trusted)
        self.assertEqual(
            {
                str(spec["id"])
                for spec in (
                    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_PRODUCTION_SPECS
                )
            },
            {
                str(region.get("id")) for region in production_low
                if region.get("visualAuthorityStatus")
                == (
                    "superseded_by_exact_rendered_page40_"
                    "landing_dimension_composite"
                )
            },
        )
        _, ambiguous_low = (
            reconstruct_exact_architectural_2321_page40_landing_dimension(
                [unrelated], [*malformed, *production],
                raw_regions=[*malformed, *production, unrelated],
                project_id=project_id, page_number=40,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertFalse(any(
            region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
            for region in ambiguous_low
        ))
        production_drift = {
            **production[0], "ocrKind": "word",
        }
        _, drifted_low = (
            reconstruct_exact_architectural_2321_page40_landing_dimension(
                [unrelated], production,
                raw_regions=[production_drift, production[1], unrelated],
                project_id=project_id, page_number=40,
                source_sha256=source_sha256,
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertFalse(any(
            region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
            for region in drifted_low
        ))

        for identity in (
            {"project_id": "wrong"}, {"source_sha256": "0" * 64},
            {"page_number": 39},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                unchanged = run([*malformed, unrelated], **identity)
                self.assertEqual(([unrelated], malformed), unchanged)

        for mutation in (
            {"text": "14'-6\""}, {"x": 0.107461},
            {"source": "other"}, {"ocrKind": "line"},
            {"ocrPrefix": "visual-tile-wrong"}, {"ocrBlockNumber": 5},
            {"ocrParagraphNumber": False}, {"ocrLineNumber": 2},
            {"ocrBoundaryTruncated": True},
        ):
            altered = {**malformed[0], **mutation}
            with self.subTest(mutation=mutation):
                _, low = run([altered, malformed[1], unrelated])
                self.assertFalse(any(
                    region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
                    for region in low
                ))
        _, low = run([malformed[0], copy.deepcopy(malformed[0]), malformed[1]])
        self.assertFalse(any(
            region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
            for region in low
        ))

    def test_exact_page42_loading_dimension_replaces_nested_authority(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )
        prefix = "visual-tile-333:0:333:500-subtile-2:0"

        def exact_region(
            region_id: str,
            text: str,
            bounds: dict[str, float],
            kind: str,
        ) -> dict[str, object]:
            return {
                "id": region_id,
                "text": text,
                **bounds,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": kind,
                "ocrBoundaryTruncated": False,
                "ocrBoundaryTruncatedEdges": [],
                "ocrPrefix": prefix,
                "ocrBlockNumber": 22,
                "ocrParagraphNumber": 1,
                "ocrLineNumber": 1,
            }

        line = exact_region(
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["id"]),
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["text"]),
            dict(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["bounds"]),
            "line",
        )
        words = [
            exact_region(
                region_id,
                text,
                {"x": x, "y": y, "width": width, "height": height},
                "word",
            )
            for region_id, text, x, y, width, height in (
                EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS
            )
        ]
        unrelated = {
            **words[0],
            "id": "unrelated-page42-measurement",
            "text": "5'-0\" MIN.",
            "x": 0.54,
            "y": 0.54,
        }
        trusted, low = reconstruct_exact_architectural_2321_page42_loading_dimension(
            [*words[1:], unrelated],
            [line, words[0]],
            raw_regions=[line, *words, unrelated],
            project_id=project_id,
            page_number=42,
            source_sha256=source_sha256,
            evidence_version="ecos-hosted-evidence/1.3",
        )

        composites = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE
        ]
        self.assertEqual(1, len(composites))
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT, composites[0]["text"])
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["bounds"],
            {key: composites[0][key] for key in ("x", "y", "width", "height")},
        )
        self.assertIs(composites[0]["searchable"], False)
        audited_ids = {
            str(region.get("id")) for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page42_loading_dimension_composite"
        }
        expected_ids = {
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["id"]),
            *(str(spec[0]) for spec in EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS),
        }
        self.assertEqual(expected_ids, audited_ids)
        self.assertTrue(all(region.get("searchable") is False for region in low if region.get("id") in audited_ids))
        self.assertIn(unrelated, trusted)
        self.assertNotIn(words[0], trusted)

    def test_exact_page42_loading_dimension_binding_fails_closed_on_drift(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )
        prefix = "visual-tile-333:0:333:500-subtile-2:0"

        def exact_region(
            region_id: str,
            text: str,
            bounds: dict[str, float],
            kind: str,
        ) -> dict[str, object]:
            return {
                "id": region_id, "text": text, **bounds,
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": kind, "ocrBoundaryTruncated": False,
                "ocrBoundaryTruncatedEdges": [], "ocrPrefix": prefix,
                "ocrBlockNumber": 22, "ocrParagraphNumber": 1,
                "ocrLineNumber": 1,
            }

        line = exact_region(
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["id"]),
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["text"]),
            dict(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["bounds"]),
            "line",
        )
        words = [
            exact_region(
                region_id, text,
                {"x": x, "y": y, "width": width, "height": height},
                "word",
            )
            for region_id, text, x, y, width, height in (
                EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS
            )
        ]

        def run(
            raw: list[dict[str, object]],
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page42_loading_dimension(
                words[1:], [line, words[0]], raw_regions=raw,
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 42),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        baseline = [line, *words]
        for identity in (
            {"project_id": "wrong"},
            {"source_sha256": "0" * 64},
            {"page_number": 41},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                trusted, low = run(baseline, **identity)
                self.assertFalse(any(
                    region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE
                    for region in low
                ))
                self.assertEqual(words[1:], trusted)
                self.assertEqual([line, words[0]], low)

        for mutation in (
            {"text": "12'-0\" @ 5' WIDE LOADING"},
            {"x": 0.404128},
            {"source": "other"},
            {"ocrKind": "word"},
            {"ocrPrefix": "visual-tile-wrong"},
            {"ocrBlockNumber": 23},
            {"ocrParagraphNumber": False},
            {"ocrLineNumber": 2},
            {"ocrBoundaryTruncated": True},
        ):
            altered = {**line, **mutation}
            with self.subTest(mutation=mutation):
                _, low = run([altered, *words])
                self.assertFalse(any(
                    region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE
                    for region in low
                ))
        _, low = run([line, copy.deepcopy(line), *words])
        self.assertFalse(any(
            region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE
            for region in low
        ))

    def test_exact_page45_post_spacing_replaces_overlapping_misread(self) -> None:
        project_id = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
        source_sha256 = (
            "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
        )

        def fixed_word(spec: dict[str, object]) -> dict[str, object]:
            block, paragraph, line = spec["lineage"]
            return {
                "id": spec["id"], "text": spec["text"], **spec["bounds"],
                "confidence": 0.0,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrBoundaryTruncated": False,
                "ocrBoundaryTruncatedEdges": [],
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
            }

        malformed = [
            fixed_word(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS
        ]
        unrelated = {
            **malformed[0], "id": "unrelated-page45-measurement",
            "text": "8'-2\"", "x": 0.81, "y": 0.88,
        }

        def run(
            raw: list[dict[str, object]],
            **identity: object,
        ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
            return reconstruct_exact_architectural_2321_page45_post_spacing_dimension(
                [unrelated], malformed, raw_regions=raw,
                project_id=identity.get("project_id", project_id),
                page_number=identity.get("page_number", 45),
                source_sha256=identity.get("source_sha256", source_sha256),
                evidence_version=identity.get(
                    "evidence_version", "ecos-hosted-evidence/1.3"
                ),
            )

        trusted, low = run([*malformed, unrelated])
        composites = [
            region for region in low
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE
        ]
        self.assertEqual(1, len(composites))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_TEXT,
            composites[0]["text"],
        )
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS[0]["bounds"],
            {key: composites[0][key] for key in ("x", "y", "width", "height")},
        )
        self.assertIs(composites[0]["searchable"], False)
        audited_ids = {
            str(region.get("id")) for region in low
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page45_post_spacing_dimension_composite"
        }
        self.assertEqual(
            {
                str(spec["id"])
                for spec in EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SPECS
            },
            audited_ids,
        )
        self.assertIn(unrelated, trusted)

        for identity in (
            {"project_id": "wrong"}, {"source_sha256": "0" * 64},
            {"page_number": 44},
            {"evidence_version": "ecos-hosted-evidence/1.2"},
        ):
            with self.subTest(identity=identity):
                self.assertEqual(
                    ([unrelated], malformed),
                    run([*malformed, unrelated], **identity),
                )

        for mutation in (
            {"text": "4'-0\""}, {"x": 0.839207},
            {"source": "other"}, {"ocrKind": "line"},
            {"ocrPrefix": "visual-tile-wrong"}, {"ocrBlockNumber": 6},
            {"ocrParagraphNumber": False}, {"ocrLineNumber": 2},
            {"ocrBoundaryTruncated": True},
        ):
            altered = {**malformed[0], **mutation}
            with self.subTest(mutation=mutation):
                _, changed_low = run([altered, malformed[1], unrelated])
                self.assertFalse(any(
                    region.get("source")
                    == EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE
                    for region in changed_low
                ))
        _, duplicate = run([
            malformed[0], copy.deepcopy(malformed[0]), malformed[1], unrelated,
        ])
        self.assertFalse(any(
            region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE45_POST_SPACING_SOURCE
            for region in duplicate
        ))

    def test_two_resolution_measurement_correction_is_bounded_and_fail_closed(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        corrupted = {
            "id": "tile-subtile-1:1-word-8", "text": "65'-6\"",
            "x": 0.496667, "y": 0.700784,
            "width": 0.011818, "height": 0.003137,
            "confidence": 0.0,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
        }

        def corrected_read(*_args, **kwargs):
            return [{
                "id": f"read-{kwargs['dpi']}", "text": "65-8",
                "x": 0.4947, "y": 0.699,
                "width": 0.014, "height": 0.004,
                "confidence": 0.8, "source": kwargs["source"],
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=corrected_read,
        ):
            accepted, audited = corroborated_bounded_measurement_ocr_regions(
                page, [corrupted], page_width=1000, page_height=1000,
            )
        self.assertEqual(["65'-8\""], [item["text"] for item in accepted])
        self.assertTrue(accepted[0]["rawOcrCorrected"])
        self.assertEqual("65'-6\"", accepted[0]["rawOcrText"])
        self.assertEqual(
            "validated_by_two_resolution_measurement_ocr",
            audited[0]["visualAuthorityStatus"],
        )

        mismatched_reads = [
            corrected_read(dpi=300, source="primary"),
            [{
                "text": "65-9", "ocrKind": "word",
                "x": 0.4947, "y": 0.699,
                "width": 0.014, "height": 0.004,
            }],
        ]
        for unsafe in (
            {**corrupted, "confidence": 0.21},
            {**corrupted, "text": "15'-1\""},
            {**corrupted, "text": "text"},
            {**corrupted, "confidence": True},
        ):
            with self.subTest(unsafe=unsafe), patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=corrected_read,
            ):
                rejected, retained = corroborated_bounded_measurement_ocr_regions(
                    page, [unsafe], page_width=1000, page_height=1000,
                )
                self.assertEqual([], rejected)
                self.assertEqual([unsafe], retained)
        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=mismatched_reads,
        ):
            rejected, retained = corroborated_bounded_measurement_ocr_regions(
                page, [corrupted], page_width=1000, page_height=1000,
            )
        self.assertEqual([], rejected)
        self.assertEqual([corrupted], retained)

    def test_two_resolution_measurement_never_adds_a_leading_digit(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        raw = {
            "id": "visual-word-174", "text": "30'-0\"",
            "x": 0.484286, "y": 0.586889,
            "width": 0.010476, "height": 0.003333,
            "confidence": 0.0,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
        }

        def unsafe_read(*_args, **kwargs):
            return [{
                "id": f"read-{kwargs['dpi']}", "text": "130-0",
                "x": 0.483, "y": 0.586,
                "width": 0.014, "height": 0.004,
                "confidence": 0.9, "source": kwargs["source"],
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=unsafe_read,
        ):
            accepted, audited = corroborated_bounded_measurement_ocr_regions(
                page, [raw], page_width=1000, page_height=1000,
            )
        self.assertEqual([], accepted)
        self.assertEqual([raw], audited)

    def test_complete_low_confidence_measurement_uses_precise_crop(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        raw = {
            "id": "tile-subtile-0:2-line-4", "text": "5'-11 1/4\"",
            "x": 0.209394, "y": 0.128627,
            "width": 0.028182, "height": 0.004314,
            "confidence": 0.30,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line", "ocrBoundaryTruncated": False,
        }
        clips = []

        def exact_read(_page, clip, *_args, **kwargs):
            clips.append(clip)
            return [{
                "id": f"read-{kwargs['dpi']}", "text": "5-111/4",
                "x": 0.209394, "y": 0.128627,
                "width": 0.028182, "height": 0.004314,
                "confidence": 0.8, "source": kwargs["source"],
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=exact_read,
        ):
            accepted, audited = corroborated_bounded_measurement_ocr_regions(
                page, [raw], page_width=1000, page_height=1000,
            )

        self.assertEqual(["5'-11 1/4\""], [item["text"] for item in accepted])
        self.assertEqual(
            "validated_by_two_resolution_measurement_ocr",
            audited[0]["visualAuthorityStatus"],
        )
        self.assertEqual(2, len(clips))
        for clip in clips:
            self.assertAlmostEqual(209.394, clip.x0, places=3)
            self.assertAlmostEqual(127.627, clip.y0, places=3)
            self.assertAlmostEqual(241.576, clip.x1, places=3)
            self.assertAlmostEqual(133.941, clip.y1, places=3)

    def test_measurement_context_line_requires_same_line_trusted_words(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        lineage = {
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrPrefix": "tile-subtile-1:2",
            "ocrBlockNumber": 26,
            "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
            "ocrBoundaryTruncated": False,
        }
        word = {
            **lineage,
            "id": "tile-subtile-1:2-word-128", "text": "12’—0\"",
            "x": 0.622121, "y": 0.272157,
            "width": 0.015152, "height": 0.00549,
            "confidence": 0.28, "ocrKind": "word",
        }
        line = {
            **lineage,
            "id": "tile-subtile-1:2-line-25",
            "text": "12’—0\" COVERAGE",
            "x": 0.622121, "y": 0.272157,
            "width": 0.042727, "height": 0.00549,
            "confidence": 0.28, "ocrKind": "line",
        }
        coverage = {
            **lineage,
            "id": "tile-subtile-1:2-word-129", "text": "COVERAGE",
            "x": 0.640909, "y": 0.272941,
            "width": 0.023939, "height": 0.004706,
            "confidence": 0.93, "ocrKind": "word",
        }

        def exact_read(*_args, **kwargs):
            return [{
                "id": f"read-{kwargs['dpi']}", "text": "12-0",
                "x": 0.622121, "y": 0.272157,
                "width": 0.015152, "height": 0.00549,
                "confidence": 0.8, "source": kwargs["source"],
                "ocrKind": "word",
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=exact_read,
        ):
            accepted, audited = corroborated_bounded_measurement_ocr_regions(
                page,
                [word, line],
                page_width=1000,
                page_height=1000,
                trusted_regions=[coverage],
            )
        self.assertEqual(["12'-0\""], [item["text"] for item in accepted])
        self.assertEqual(
            [
                "validated_by_two_resolution_measurement_ocr",
                "superseded_by_two_resolution_measurement_context",
            ],
            [item.get("visualAuthorityStatus") for item in audited],
        )

        for unsafe_coverage in (
            {**coverage, "confidence": 0.84},
            {**coverage, "ocrLineNumber": 2},
            {**coverage, "text": "OTHER"},
            {**coverage, "confidence": True},
        ):
            with self.subTest(unsafe=unsafe_coverage), patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=exact_read,
            ):
                _, retained = corroborated_bounded_measurement_ocr_regions(
                    page,
                    [word, line],
                    page_width=1000,
                    page_height=1000,
                    trusted_regions=[unsafe_coverage],
                )
                self.assertIsNone(retained[1].get("visualAuthorityStatus"))

    def test_incomplete_measurement_recovery_requires_same_line_trusted_suffix(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 1000, 1000))
        incomplete = {
            "id": "tile-subtile-0:2-word-13", "text": "62'—",
            "x": 0.94303, "y": 0.11451,
            "width": 0.010606, "height": 0.003922,
            "confidence": 0.13,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrBoundaryTruncated": False,
        }
        suffix = {
            "id": "tile-subtile-0:2-word-17", "text": "7/8\"",
            "x": 0.960303, "y": 0.114118,
            "width": 0.010909, "height": 0.004314,
            "confidence": 0.71,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word",
        }

        def complete_read(*_args, **kwargs):
            return [{
                "text": "62-27/8", "ocrKind": "word",
                "x": 0.938, "y": 0.112,
                "width": 0.033, "height": 0.006,
                "source": kwargs["source"],
            }]

        with patch(
            "ecos_indexer.extraction.ocr_regions_for_clip",
            side_effect=complete_read,
        ):
            accepted, _ = corroborated_bounded_measurement_ocr_regions(
                page, [incomplete], page_width=1000, page_height=1000,
                trusted_regions=[suffix],
            )
        self.assertEqual(["62'-2 7/8\""], [item["text"] for item in accepted])

        for unrelated_suffix in (
            {**suffix, "id": "other-subtile-word-17"},
            {**suffix, "text": "5/8\""},
            {**suffix, "y": 0.2},
            {**suffix, "source": "title_block_ocr"},
        ):
            with self.subTest(unrelated_suffix=unrelated_suffix), patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=complete_read,
            ):
                rejected, retained = corroborated_bounded_measurement_ocr_regions(
                    page, [incomplete], page_width=1000, page_height=1000,
                    trusted_regions=[unrelated_suffix],
                )
                self.assertEqual([], rejected)
                self.assertEqual([incomplete], retained)

    def test_targeted_measurement_digit_signature_is_strict(self) -> None:
        def words(value: str) -> list[dict[str, object]]:
            return [{"text": value, "ocrKind": "word"}]

        self.assertEqual("16'-0\"", targeted_measurement_candidate_text(words("16-0")))
        self.assertEqual(
            "14'-5 1/2\"",
            targeted_measurement_candidate_text(words("14-51/2")),
        )
        for invalid in ("14-121/2", "14-58/8", "14-511/16", "text"):
            with self.subTest(invalid=invalid):
                self.assertEqual("", targeted_measurement_candidate_text(words(invalid)))

    def test_parenthesized_sum_fragment_filter_is_order_independent(self) -> None:
        fragment = {
            "id": "incomplete-sum-fragment",
            "text": "(140'+",
            "x": 0.099206, "y": 0.283333,
            "width": 0.009365, "height": 0.005111,
            "confidence": 0.25,
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        standalone = {
            "id": "legitimate-standalone-measurement",
            "text": "140'",
            "x": 0.099365, "y": 0.283556,
            "width": 0.007778, "height": 0.004667,
            "confidence": 0.20,
            "source": "fixed_visual_tile_coordinate_ocr",
        }

        def visual_regions_for(
            candidates: list[dict[str, object]],
        ) -> list[dict[str, object]]:
            unresolved = unresolved_regions(
                [{"text": "trusted searchable text"}],
                {"sheetMappingStatus": "verified"},
                native_character_count=900,
                ocr_attempted=True,
                low_confidence_regions=candidates,
            )
            return [
                item for item in unresolved
                if item["regionKey"].startswith("low-confidence-ocr-")
            ]

        expected = visual_regions_for([fragment, standalone])
        self.assertEqual(expected, visual_regions_for([standalone, fragment]))
        self.assertEqual(1, len(expected))
        self.assertEqual(
            ["140'"],
            [
                candidate["text"]
                for item in expected
                for candidate in item["diagnosticCandidates"]
            ],
        )

    def test_scale_legend_rhs_is_quarantined_without_hiding_raw_ocr(self) -> None:
        scale_line = {
            "id": "page9-line-28",
            "text": "SCALE: 1/8\u201d =1\u2019-0\u201d",
            "x": 0.790476, "y": 0.964,
            "width": 0.04873, "height": 0.006889,
            "confidence": 0.33,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line", "ocrPrefix": "page9-tile-2:1",
            "ocrBlockNumber": 29, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
            "ocrValidationStatus": "unresolved_low_confidence",
        }
        rhs_word = {
            "id": "page9-word-123",
            "text": "=1\u2019-0\u201d",
            "x": 0.823492, "y": 0.964,
            "width": 0.015714, "height": 0.005556,
            "confidence": 0.33,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrPrefix": "page9-tile-2:1",
            "ocrBlockNumber": 29, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
            "ocrValidationStatus": "unresolved_low_confidence",
        }
        standalone = {
            **rhs_word,
            "id": "standalone-same-value",
            "text": "1'-0\"",
            "x": 0.52, "y": 0.77,
            "width": 0.03, "height": 0.006,
            "ocrBlockNumber": 12,
        }
        originals = [scale_line, rhs_word, standalone]

        def status_by_id(regions: list[dict[str, object]]) -> dict[str, object]:
            return {
                str(region["id"]): region.get("visualAuthorityStatus")
                for region in quarantine_scale_legend_rhs_visual_authority(regions)
            }

        expected_status = {
            "page9-line-28": "quarantined_scale_legend",
            "page9-word-123": "quarantined_scale_legend",
            "standalone-same-value": None,
        }
        self.assertEqual(expected_status, status_by_id(originals))
        self.assertEqual(expected_status, status_by_id(list(reversed(originals))))
        self.assertTrue(all("visualAuthorityStatus" not in item for item in originals))

        quarantined = quarantine_scale_legend_rhs_visual_authority(originals)
        audited = {str(region["id"]): region for region in quarantined}
        self.assertEqual("SCALE: 1/8\u201d =1\u2019-0\u201d", audited["page9-line-28"]["text"])
        self.assertEqual("=1\u2019-0\u201d", audited["page9-word-123"]["text"])
        self.assertEqual(
            "unresolved_low_confidence",
            audited["page9-word-123"]["ocrValidationStatus"],
        )

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=quarantined,
        )
        candidates = [
            candidate["text"]
            for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertEqual(["1'-0\""], candidates)

    def test_scale_legend_quarantine_rejects_lineage_value_and_geometry_lookalikes(self) -> None:
        scale_line = {
            "id": "scale-line",
            "text": "SCALE: 1/8\" = 1'-0\"",
            "x": 0.79, "y": 0.96, "width": 0.05, "height": 0.008,
            "confidence": 0.2,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line", "ocrPrefix": "tile-a",
            "ocrBlockNumber": 29, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
        }

        def word(region_id: str, **updates: object) -> dict[str, object]:
            result: dict[str, object] = {
                "id": region_id, "text": "=1'-0\"",
                "x": 0.823, "y": 0.961,
                "width": 0.015, "height": 0.005,
                "confidence": 0.2,
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word", "ocrPrefix": "tile-a",
                "ocrBlockNumber": 29, "ocrParagraphNumber": 1,
                "ocrLineNumber": 1,
            }
            result.update(updates)
            return result

        adversaries = [
            word("competing-value", text="=2'-0\""),
            word("different-line", ocrLineNumber=2),
            word("different-pass", ocrPrefix="tile-b"),
            word("outside-line-bounds", x=0.86),
            word("left-side-same-line", x=0.791, width=0.012),
        ]
        quarantined = quarantine_scale_legend_rhs_visual_authority(
            [*adversaries, scale_line]
        )
        status = {
            str(region["id"]): region.get("visualAuthorityStatus")
            for region in quarantined
        }
        self.assertEqual("quarantined_scale_legend", status["scale-line"])
        self.assertTrue(all(status[str(item["id"])] is None for item in adversaries))

        missing_label_line = {**scale_line, "id": "missing-label", "text": "1/8\" = 1'-0\""}
        trailing_fact_line = {
            **scale_line,
            "id": "trailing-fact",
            "text": "SCALE: 1/8\" = 1'-0\" 10'-0\"",
        }
        for invalid_line in (missing_label_line, trailing_fact_line):
            with self.subTest(line=invalid_line["id"]):
                result = quarantine_scale_legend_rhs_visual_authority(
                    [invalid_line, word("candidate")]
                )
                self.assertTrue(all(
                    region.get("visualAuthorityStatus") is None
                    for region in result
                ))

    def exact_e175_fixture_height_inputs(self) -> tuple[
        dict[str, object], dict[str, object], dict[str, object], dict[str, object]
    ]:
        prefix = "visual-tile-667:500:333:500-subtile-1:0"
        native = {
            "id": "native-2577-0", "text": "A1 @ 20'",
            "x": 0.759762, "y": 0.794233,
            "width": 0.012946, "height": 0.004424,
            "confidence": 0.99, "source": "embedded_text",
            "searchable": False, "renderedCorroborated": False,
        }
        line = {
            "id": "page13-line", "text": "“dat @20' “3.4",
            "x": 0.755714, "y": 0.789778,
            "width": 0.024286, "height": 0.008889,
            "confidence": 0.18,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line", "ocrPrefix": prefix,
            "ocrBlockNumber": 93, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
            "ocrValidationStatus": "unresolved_low_confidence",
        }
        word = {
            "id": "page13-word", "text": "@20'",
            "x": 0.764762, "y": 0.791333,
            "width": 0.007778, "height": 0.007333,
            "confidence": 0.18,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrPrefix": prefix,
            "ocrBlockNumber": 93, "ocrParagraphNumber": 1,
            "ocrLineNumber": 1,
            "ocrValidationStatus": "unresolved_low_confidence",
        }
        standalone = {
            **word, "id": "standalone", "text": "TYP @20' O.C.",
            "x": 0.52, "y": 0.72, "ocrBlockNumber": 12,
        }
        return native, line, word, standalone

    def reconstruct_e175_fixture_height(
        self,
        regions: list[dict[str, object]],
        native_regions: list[dict[str, object]],
        **updates: object,
    ) -> list[dict[str, object]]:
        arguments: dict[str, object] = {
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 13,
            "source_sha256": (
                "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_e175_fixture_height_candidate(
            regions,
            native_regions=native_regions,
            **arguments,
        )

    def test_exact_e175_fixture_height_becomes_one_full_unresolved_candidate(self) -> None:
        native, line, word, standalone = self.exact_e175_fixture_height_inputs()
        originals = [line, word, standalone]

        reconstructed = self.reconstruct_e175_fixture_height(
            originals, [native],
        )
        by_id = {str(region["id"]): region for region in reconstructed}
        candidate = by_id["e175-page13-A1-at-20ft-candidate"]
        self.assertEqual("A1 @ 20'", candidate["text"])
        self.assertEqual(
            {key: native[key] for key in ("x", "y", "width", "height")},
            {key: candidate[key] for key in ("x", "y", "width", "height")},
        )
        self.assertFalse(candidate["searchable"])
        self.assertEqual(0.18, candidate["confidence"])
        self.assertEqual(
            [native["id"], line["id"], word["id"]],
            candidate["constituentEvidence"],
        )
        for region_id in ("page13-line", "page13-word"):
            self.assertEqual(
                "superseded_by_exact_native_visual_composite",
                by_id[region_id]["visualAuthorityStatus"],
            )
        self.assertIsNone(by_id["standalone"].get("visualAuthorityStatus"))
        self.assertTrue(all("visualAuthorityStatus" not in item for item in originals))

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=reconstructed,
        )
        candidates = [
            candidate
            for item in unresolved
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertEqual(
            ["TYP @20' O.C.", "A1 @ 20'"],
            [candidate["text"] for candidate in candidates],
        )
        self.assertNotIn("@20'", [candidate["text"] for candidate in candidates])

    def test_exact_e175_fixture_height_reconstruction_fails_closed_on_any_binding_drift(self) -> None:
        native, line, word, _ = self.exact_e175_fixture_height_inputs()
        identity_cases = {
            "wrong-project": {"project_id": "other-project"},
            "wrong-page": {"page_number": 12},
            "wrong-sha": {"source_sha256": "0" * 64},
            "wrong-version": {"evidence_version": "ecos-hosted-evidence/1.2"},
        }
        for name, updates in identity_cases.items():
            with self.subTest(name=name):
                result = self.reconstruct_e175_fixture_height(
                    [line, word], [native], **updates,
                )
                self.assertEqual([line, word], result)

        region_cases = {
            "missing-native": ([line, word], []),
            "duplicate-native": ([line, word], [native, {**native, "id": "duplicate"}]),
            "wrong-native-source": ([line, word], [{**native, "source": "other"}]),
            "wrong-native-text": ([line, word], [{**native, "text": "B1 @ 20'"}]),
            "wrong-native-bounds": ([line, word], [{**native, "x": 0.759763}]),
            "forged-searchable-native": ([line, word], [{**native, "searchable": True}]),
            "missing-line": ([word], [native]),
            "wrong-line-text": ([{**line, "text": "TYP @20' O.C."}, word], [native]),
            "wrong-line-bounds": ([{**line, "x": 0.755715}, word], [native]),
            "wrong-line-pass": ([{**line, "ocrPrefix": "other-pass"}, word], [native]),
            "wrong-line-source": ([{**line, "source": "other"}, word], [native]),
            "missing-lineage": ([{key: value for key, value in line.items() if key != "ocrLineNumber"}, word], [native]),
            "missing-word": ([line], [native]),
            "wrong-word-text": ([line, {**word, "text": "@21'"}], [native]),
            "wrong-word-bounds": ([line, {**word, "x": 0.82}], [native]),
            "wrong-word-pass": ([line, {**word, "ocrPrefix": "other-pass"}], [native]),
            "wrong-word-source": ([line, {**word, "source": "other"}], [native]),
            "wrong-word-lineage": ([line, {**word, "ocrLineNumber": 2}], [native]),
        }
        for name, (regions, native_regions) in region_cases.items():
            with self.subTest(name=name):
                result = self.reconstruct_e175_fixture_height(
                    regions, native_regions,
                )
                self.assertEqual(regions, result)
                self.assertFalse(any(
                    item.get("id") == "e175-page13-A1-at-20ft-candidate"
                    for item in result
                ))

    def test_true_height_and_spacing_authorities_are_never_suppressed_generically(self) -> None:
        native, line, word, _ = self.exact_e175_fixture_height_inputs()
        for text in (
            "T.O. WALL @20'-0\" EAST", "WALL @20' EAST",
            "PIPE A @20' ZONE B", "TYP @20' O.C.",
            "A1 @20' SPACING", "MOUNT FIXTURE A1 @20' AFF",
        ):
            with self.subTest(text=text):
                regions = [{**line, "text": text}, word]
                result = self.reconstruct_e175_fixture_height(regions, [native])
                self.assertEqual(regions, result)
                self.assertTrue(all(
                    item.get("visualAuthorityStatus") is None for item in result
                ))

    def architectural_2321_fire_separation_inputs(self) -> list[dict[str, object]]:
        regions: list[dict[str, object]] = []
        for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS:
            exact_line = next(
                line
                for paragraph in
                EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PARAGRAPH_SPECS
                for line in paragraph["lines"]
                if line["id"] == spec["lineId"]
            )
            common = {
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": exact_line["lineage"][0],
                "ocrParagraphNumber": exact_line["lineage"][1],
                "ocrLineNumber": exact_line["lineage"][2],
                "confidence": 0.18,
                "searchable": False,
            }
            regions.extend([
                {
                    **common,
                    "id": spec["lineId"],
                    "text": next(iter(spec["lineTexts"])),
                    **spec["lineBounds"],
                    "ocrKind": "line",
                },
                {
                    **common,
                    "id": sorted(spec["wordIds"])[0],
                    "text": next(iter(spec["wordTexts"])),
                    **spec["wordBounds"],
                    "ocrKind": "word",
                },
            ])
        existing_ids = {str(region["id"]) for region in regions}
        for paragraph in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_PARAGRAPH_SPECS:
            for line in paragraph["lines"]:
                if str(line["id"]) in existing_ids:
                    continue
                regions.append({
                    "id": line["id"],
                    "text": next(iter(line["texts"])),
                    **line["bounds"],
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "ocrPrefix": line["ocrPrefix"],
                    "ocrBlockNumber": line["lineage"][0],
                    "ocrParagraphNumber": line["lineage"][1],
                    "ocrLineNumber": line["lineage"][2],
                    "ocrKind": "line",
                    "confidence": 0.91,
                    "searchable": True,
                })
                existing_ids.add(str(line["id"]))
        return regions

    def reconstruct_architectural_2321_fire_separation(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 8,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_fire_separation_candidates(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_fire_separation_uses_complete_candidates(self) -> None:
        raw = self.architectural_2321_fire_separation_inputs()
        fourth_word_id = str(
            sorted(
                EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS[3]["wordIds"]
            )[0]
        )
        unsafe_derived = {
            "id": f"{fourth_word_id}-two-resolution-measurement",
            "text": "130'-0\"",
            "x": 0.484286, "y": 0.586889,
            "width": 0.010476, "height": 0.003333,
            "source": "bounded_measurement_ocr_corroborated",
            "searchable": True, "factKind": "drawing_fact",
        }
        malformed_ids = {
            str(spec["lineId"])
            for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS
        } | {
            str(word_id)
            for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS
            for word_id in spec["wordIds"]
        }
        trusted_input = [
            *raw[:4],
            *(region for region in raw if str(region["id"]) not in malformed_ids),
            unsafe_derived,
        ]
        low_input = [
            region for region in raw[4:]
            if str(region["id"]) in malformed_ids
        ]

        trusted, low = self.reconstruct_architectural_2321_fire_separation(
            trusted_input, low_input,
        )
        trusted_ids = {str(region["id"]) for region in trusted}
        self.assertNotIn(unsafe_derived["id"], trusted_ids)
        self.assertFalse(any(
            str(region.get("id") or "") in {
                str(spec["lineId"]) for spec in
                EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS
            } | {
                str(word_id) for spec in
                EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS
                for word_id in spec["wordIds"]
            }
            for region in trusted
        ))

        by_id = {str(region["id"]): region for region in low}
        for sentence in (
            EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
        ):
            candidate = by_id[str(sentence["candidateId"])]
            self.assertEqual(sentence["canonicalText"], candidate["text"])
            self.assertEqual(
                sentence["bounds"],
                {key: candidate[key] for key in ("x", "y", "width", "height")},
            )
            self.assertFalse(candidate["searchable"])

        for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS:
            matched_word_id = next(
                word_id for word_id in spec["wordIds"] if word_id in by_id
            )
            for constituent_id in (spec["lineId"], matched_word_id):
                self.assertEqual(
                    "superseded_by_exact_rendered_fire_separation_composite",
                    by_id[str(constituent_id)]["visualAuthorityStatus"],
                )

        unresolved = unresolved_regions(
            [{"text": "trusted searchable text"}],
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low,
        )
        candidates = [
            candidate
            for item in unresolved
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertEqual(
            {
                str(spec["canonicalText"])
                for spec in
                EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
            },
            {str(candidate["text"]) for candidate in candidates},
        )
        target_exceptions = [
            item for item in unresolved
            if any(
                str(candidate["text"]) in {
                    str(spec["canonicalText"])
                    for spec in
                    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
                }
                for candidate in item["diagnosticCandidates"]
            )
        ]
        self.assertEqual(3, len(target_exceptions))
        self.assertTrue(all(
            len(item["diagnosticCandidates"]) == 1
            for item in target_exceptions
        ))
        self.assertNotIn("130'-0\"", {str(item["text"]) for item in candidates})

    def test_exact_architectural_2321_fire_separation_fails_closed_on_drift(self) -> None:
        raw = self.architectural_2321_fire_separation_inputs()
        identity_cases = {
            "project_id": "other-project",
            "page_number": 7,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }
        for key, value in identity_cases.items():
            with self.subTest(binding=key):
                trusted, low = self.reconstruct_architectural_2321_fire_separation(
                    [], raw, **{key: value},
                )
                self.assertEqual([], trusted)
                self.assertEqual(raw, low)

        for name, replacement in (
            ("text", {**raw[0], "text": "OPENINGS WITH LESS THAN 29'-10\""}),
            ("bounds", {**raw[0], "x": 0.457461}),
            ("pass", {**raw[0], "ocrPrefix": "other-pass"}),
            ("lineage", {**raw[1], "ocrLineNumber": 2}),
            ("source", {**raw[1], "source": "other"}),
        ):
            with self.subTest(region=name):
                drifted = [replacement, *raw[1:]]
                trusted, low = self.reconstruct_architectural_2321_fire_separation(
                    [], drifted,
                )
                self.assertEqual([], trusted)
                self.assertEqual(drifted, low)

        joining_line = next(
            region for region in raw
            if str(region["id"]).endswith("subtile-2:1-line-10")
        )
        for name, replacement in (
            ("paragraph-text", {**joining_line, "text": "OPENINGS NOT LIMITED"}),
            ("paragraph-bounds", {**joining_line, "height": 0.004001}),
            ("paragraph-pass", {**joining_line, "ocrPrefix": "other-pass"}),
            ("paragraph-lineage", {**joining_line, "ocrLineNumber": 99}),
            ("paragraph-source", {**joining_line, "source": "other"}),
        ):
            with self.subTest(region=name):
                drifted = [
                    replacement if region is joining_line else region
                    for region in raw
                ]
                trusted, low = self.reconstruct_architectural_2321_fire_separation(
                    [], drifted,
                )
                self.assertEqual([], trusted)
                self.assertEqual(drifted, low)

    def architectural_2321_area_row_inputs(
        self,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for index, spec in enumerate(EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS):
            trusted.append({
                "id": f"area-row-label-{index}",
                "text": spec["labelText"],
                **spec["labelBounds"],
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec.get("labelKind", "word"),
                "ocrPrefix": spec["ocrPrefix"],
                "confidence": 0.91,
                "searchable": True,
            })
            low.append({
                "id": f"area-row-measurement-{index}",
                "text": spec["measurementText"],
                **spec["measurementBounds"],
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "word",
                "ocrPrefix": spec["ocrPrefix"],
                "confidence": 0.2,
                "searchable": False,
            })
        return trusted, low

    def reconstruct_architectural_2321_area_rows(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 8,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_area_row_candidates(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_area_rows_use_complete_printed_phrases(self) -> None:
        trusted, low = self.architectural_2321_area_row_inputs()
        unrelated = {
            "id": "unrelated-30ft", "text": "30'",
            "x": 0.2, "y": 0.3, "width": 0.01, "height": 0.004,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "word", "ocrPrefix": "other-pass",
            "confidence": 0.2, "searchable": False,
        }
        trusted_result, low_result = self.reconstruct_architectural_2321_area_rows(
            trusted, [*low, unrelated],
        )
        self.assertEqual(trusted, trusted_result)
        by_id = {str(region["id"]): region for region in low_result}
        for index, spec in enumerate(EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS):
            candidate = by_id[str(spec["candidateId"])]
            self.assertEqual(spec["canonicalText"], candidate["text"])
            self.assertEqual(spec["bounds"], {
                key: candidate[key] for key in ("x", "y", "width", "height")
            })
            self.assertFalse(candidate["searchable"])
            self.assertEqual(
                "superseded_by_exact_rendered_area_table_row_composite",
                by_id[f"area-row-measurement-{index}"]["visualAuthorityStatus"],
            )
        self.assertNotIn("visualAuthorityStatus", by_id["unrelated-30ft"])

        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        target = [
            item for item in unresolved
            if any(
                str(candidate["text"]) in {
                    str(spec["canonicalText"])
                    for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS
                }
                for candidate in item["diagnosticCandidates"]
            )
        ]
        self.assertEqual(3, len(target))
        self.assertTrue(all(len(item["diagnosticCandidates"]) == 1 for item in target))
        candidate_texts = {
            str(candidate["text"])
            for item in target
            for candidate in item["diagnosticCandidates"]
        }
        self.assertNotIn("EAST- 30'", candidate_texts)
        self.assertNotIn("SOUTH- 30'", candidate_texts)

        # Equivalent raster runs can place the same issued value just above
        # the generic OCR confidence threshold. The exact row authority and
        # provider decision must not change with that confidence partition.
        trusted_measurement = {**low[1], "confidence": 0.54, "searchable": True}
        trusted_variant, low_variant = self.reconstruct_architectural_2321_area_rows(
            [*trusted, trusted_measurement], [low[0], low[2]],
        )
        self.assertNotIn(
            trusted_measurement["id"],
            {region["id"] for region in trusted_variant},
        )
        self.assertEqual(
            {
                str(spec["canonicalText"])
                for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS
            },
            {
                str(region["text"])
                for region in low_variant
                if region.get("source")
                == "exact_rendered_area_table_row_composite_candidate"
            },
        )
        moved = next(
            region for region in low_variant
            if region["id"] == trusted_measurement["id"]
        )
        self.assertEqual(
            "superseded_by_exact_rendered_area_table_row_composite",
            moved["visualAuthorityStatus"],
        )

    def test_exact_architectural_2321_area_rows_fail_closed_on_drift(self) -> None:
        trusted, low = self.architectural_2321_area_row_inputs()
        identity_cases = {
            "project_id": "other-project",
            "page_number": 9,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }
        for key, value in identity_cases.items():
            with self.subTest(binding=key):
                trusted_result, low_result = self.reconstruct_architectural_2321_area_rows(
                    trusted, low, **{key: value},
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(low, low_result)

        first_candidate_id = str(EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS[0]["candidateId"])
        for name, trusted_update, low_update in (
            ("label-text", {"text": "WEST-"}, {}),
            ("label-bounds", {"x": 0.624922}, {}),
            ("label-source", {"source": "other"}, {}),
            ("label-pass", {"ocrPrefix": "other-pass"}, {}),
            ("measurement-text", {}, {"text": "20'"}),
            ("measurement-bounds", {}, {"y": 0.182668}),
            ("measurement-source", {}, {"source": "other"}),
            ("measurement-pass", {}, {"ocrPrefix": "other-pass"}),
        ):
            with self.subTest(drift=name):
                drifted_trusted = [{**trusted[0], **trusted_update}, trusted[1]]
                drifted_low = [{**low[0], **low_update}, low[1]]
                _, low_result = self.reconstruct_architectural_2321_area_rows(
                    drifted_trusted, drifted_low,
                )
                self.assertNotIn(first_candidate_id, {
                    str(region.get("id") or "") for region in low_result
                })

        duplicate_label = [trusted[0], {**trusted[0], "id": "duplicate-label"}, trusted[1]]
        _, low_result = self.reconstruct_architectural_2321_area_rows(
            duplicate_label, low,
        )
        self.assertNotIn(first_candidate_id, {
            str(region.get("id") or "") for region in low_result
        })

    def architectural_2321_accessible_note_inputs(
        self,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for index, spec in enumerate(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CONSTITUENTS
        ):
            region = {
                "id": spec["id"],
                "text": spec["text"],
                **spec["bounds"],
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["kind"],
                "ocrPrefix": (
                    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_OCR_PREFIX
                ),
                "ocrBlockNumber": spec["lineage"][0],
                "ocrParagraphNumber": spec["lineage"][1],
                "ocrLineNumber": spec["lineage"][2],
                "confidence": 0.52 if index in {0, 1, 4} else 0.95,
                "searchable": index not in {0, 1, 4},
            }
            (low if index in {0, 1, 4} else trusted).append(region)
        return trusted, low

    def reconstruct_architectural_2321_accessible_note(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 4,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_accessible_parking_note_candidate(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_accessible_note_uses_complete_phrase(self) -> None:
        trusted, low = self.architectural_2321_accessible_note_inputs()
        trusted_result, low_result = self.reconstruct_architectural_2321_accessible_note(
            trusted, low,
        )
        by_id = {str(region["id"]): region for region in low_result}
        candidate = by_id[
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID
        ]
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
            candidate["text"],
        )
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
            {key: candidate[key] for key in ("x", "y", "width", "height")},
        )
        self.assertFalse(candidate["searchable"])
        self.assertEqual(
            "exact_rendered_accessible_parking_note_composite_candidate",
            candidate["source"],
        )
        for constituent_id in (
            "visual-tile-667:500:333:500-subtile-2:1-word-134",
            "visual-tile-667:500:333:500-subtile-2:1-line-32",
        ):
            self.assertEqual(
                "superseded_by_exact_rendered_accessible_parking_note_composite",
                by_id[constituent_id]["visualAuthorityStatus"],
            )
        self.assertEqual(trusted, trusted_result)

        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        target = [
            item for item in unresolved
            if any(
                candidate_item["text"]
                == EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT
                for candidate_item in item["diagnosticCandidates"]
            )
        ]
        self.assertEqual(1, len(target))
        self.assertEqual(1, len(target[0]["diagnosticCandidates"]))
        candidate_texts = {
            str(candidate_item["text"])
            for item in unresolved
            for candidate_item in item["diagnosticCandidates"]
        }
        self.assertNotIn("5'-O\" MIN. TYP", candidate_texts)

    def test_exact_architectural_2321_accessible_note_accepts_production_borderless_line(self) -> None:
        trusted, low = self.architectural_2321_accessible_note_inputs()
        target_id = "visual-tile-667:500:333:500-subtile-2:1-line-35"
        production_variant = {
            "text": "STRIPED LOADING.",
            "x": 0.805238,
            "y": 0.936889,
            "width": 0.031111,
            "height": 0.004,
            "confidence": 0.94,
        }
        production_low = [
            {**region, **production_variant}
            if str(region.get("id") or "") == target_id
            else region
            for region in low
        ]

        trusted_result, low_result = (
            self.reconstruct_architectural_2321_accessible_note(
                trusted,
                production_low,
            )
        )

        self.assertEqual(trusted, trusted_result)
        candidate = next(
            region for region in low_result
            if region.get("id")
            == EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID
        )
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
            candidate["text"],
        )
        self.assertEqual(0.52, candidate["confidence"])

    def test_exact_architectural_2321_accessible_note_fails_closed_on_drift(self) -> None:
        trusted, low = self.architectural_2321_accessible_note_inputs()
        identity_cases = {
            "project_id": "other-project",
            "page_number": 5,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }
        for key, value in identity_cases.items():
            with self.subTest(binding=key):
                trusted_result, low_result = (
                    self.reconstruct_architectural_2321_accessible_note(
                        trusted, low, **{key: value},
                    )
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(low, low_result)

        target = next(
            region for region in low
            if str(region["id"]).endswith("line-32")
        )
        for name, update in (
            ("text", {"text": "5'-0\" MIN. TYPICAL"}),
            ("bounds", {"width": 0.022858}),
            ("source", {"source": "other"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted = [
                    {**region, **update} if region is target else region
                    for region in low
                ]
                trusted_result, low_result = (
                    self.reconstruct_architectural_2321_accessible_note(
                        trusted, drifted,
                    )
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(drifted, low_result)
                self.assertNotIn(
                    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID,
                    {str(region.get("id") or "") for region in low_result},
                )

        final_line = next(
            region for region in low
            if str(region["id"]).endswith("line-35")
        )
        for name, update in (
            ("unapproved_text", {"text": "STRIPED LOADING AREA."}),
            ("unapproved_bounds", {"y": 0.936888}),
        ):
            with self.subTest(final_line=name):
                drifted = [
                    {**region, **update} if region is final_line else region
                    for region in low
                ]
                trusted_result, low_result = (
                    self.reconstruct_architectural_2321_accessible_note(
                        trusted,
                        drifted,
                    )
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(drifted, low_result)
                self.assertNotIn(
                    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID,
                    {str(region.get("id") or "") for region in low_result},
                )

    def architectural_2321_easement_note_inputs(
        self,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for index, spec in enumerate(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS
        ):
            region = {
                "id": spec["id"],
                "text": spec["text"],
                **spec["bounds"],
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": spec["kind"],
                "ocrPrefix": spec["ocrPrefix"],
                "ocrBlockNumber": spec["lineage"][0],
                "ocrParagraphNumber": spec["lineage"][1],
                "ocrLineNumber": spec["lineage"][2],
                "confidence": (0.86, 0.0, 0.84, 0.32, 0.32)[index],
                "searchable": index in {0, 2},
            }
            (trusted if index in {0, 2} else low).append(region)
        return trusted, low

    def reconstruct_architectural_2321_easement_note(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 10,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_easement_note_candidate(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_easement_note_uses_complete_phrase(self) -> None:
        trusted, low = self.architectural_2321_easement_note_inputs()
        trusted_result, low_result = (
            self.reconstruct_architectural_2321_easement_note(trusted, low)
        )
        by_id = {str(region["id"]): region for region in low_result}
        candidate = by_id[EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID]
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
            candidate["text"],
        )
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
            {key: candidate[key] for key in ("x", "y", "width", "height")},
        )
        self.assertEqual(0.32, candidate["confidence"])
        self.assertFalse(candidate["searchable"])
        self.assertEqual(
            "exact_rendered_easement_note_composite_candidate",
            candidate["source"],
        )
        self.assertEqual([], trusted_result)
        for spec in EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS:
            self.assertEqual(
                "superseded_by_exact_rendered_easement_note_composite",
                by_id[str(spec["id"])]["visualAuthorityStatus"],
            )

        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        target = [
            item for item in unresolved
            if any(
                diagnostic["text"]
                == EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT
                for diagnostic in item.get("diagnosticCandidates") or []
            )
        ]
        self.assertEqual(1, len(target))
        self.assertEqual(1, len(target[0]["diagnosticCandidates"]))
        candidate_texts = {
            str(diagnostic["text"])
            for item in unresolved
            for diagnostic in item.get("diagnosticCandidates") or []
        }
        self.assertNotIn("(2'", candidate_texts)
        self.assertNotIn("10'", candidate_texts)

    def test_exact_architectural_2321_easement_note_fails_closed_on_drift(self) -> None:
        trusted, low = self.architectural_2321_easement_note_inputs()
        identity_cases = {
            "project_id": "other-project",
            "page_number": 9,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }
        for key, value in identity_cases.items():
            with self.subTest(binding=key):
                trusted_result, low_result = (
                    self.reconstruct_architectural_2321_easement_note(
                        trusted, low, **{key: value},
                    )
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(low, low_result)

        target = low[-1]
        for name, update in (
            ("text", {"text": "E) 20' WIDE EASEMENT TO REMAIN."}),
            ("bounds", {"width": 0.055555}),
            ("source", {"source": "other"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted = [
                    {**region, **update} if region is target else region
                    for region in low
                ]
                trusted_result, low_result = (
                    self.reconstruct_architectural_2321_easement_note(
                        trusted, drifted,
                    )
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(drifted, low_result)
                self.assertNotIn(
                    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID,
                    {str(region.get("id") or "") for region in low_result},
                )

        duplicate_raw = [*trusted, *low, {**low[-1], "id": low[-1]["id"]}]
        trusted_result, low_result = (
            reconstruct_exact_architectural_2321_easement_note_candidate(
                trusted,
                low,
                raw_regions=duplicate_raw,
                project_id="607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
                page_number=10,
                source_sha256=(
                    "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
                ),
                evidence_version="ecos-hosted-evidence/1.3",
            )
        )
        self.assertEqual(trusted, trusted_result)
        self.assertEqual(low, low_result)

    def test_exact_architectural_2321_easement_note_accepts_linux_word_order(self) -> None:
        trusted, low = self.architectural_2321_easement_note_inputs()
        linux_ids = {
            "visual-tile-667:0:333:500-subtile-1:1-word-232": (
                "visual-tile-667:0:333:500-subtile-1:1-word-233"
            ),
            "visual-tile-667:0:333:500-subtile-1:1-word-233": (
                "visual-tile-667:0:333:500-subtile-1:1-word-234"
            ),
        }
        linux_trusted = [
            {**region, "id": linux_ids.get(str(region["id"]), region["id"])}
            for region in trusted
        ]
        linux_low = [
            {**region, "id": linux_ids.get(str(region["id"]), region["id"])}
            for region in low
        ]

        trusted_result, low_result = (
            self.reconstruct_architectural_2321_easement_note(
                linux_trusted, linux_low,
            )
        )

        self.assertEqual([], trusted_result)
        candidate = next(
            region for region in low_result
            if region.get("id")
            == EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID
        )
        self.assertEqual(
            [
                "visual-tile-667:0:333:500-subtile-1:0-word-162",
                "visual-tile-667:0:333:500-subtile-1:0-word-163",
                "visual-tile-667:0:333:500-subtile-1:1-word-233",
                "visual-tile-667:0:333:500-subtile-1:1-word-234",
                "visual-tile-667:0:333:500-subtile-1:1-line-24",
            ],
            candidate["constituentEvidence"],
        )

    def architectural_2321_site_note_inputs(
        self,
        *,
        linux: bool = False,
    ) -> tuple[
        list[dict[str, object]],
        list[dict[str, object]],
        list[dict[str, object]],
    ]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        raw: list[dict[str, object]] = []
        for candidate in EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES:
            for spec in candidate["constituents"]:
                accepted_ids = tuple(spec.get("acceptedIds", (spec["id"],)))
                accepted_texts = tuple(spec["texts"])
                accepted_lineages = tuple(spec["lineages"])
                region = {
                    "id": accepted_ids[-1] if linux else accepted_ids[0],
                    "text": accepted_texts[-1] if linux else accepted_texts[0],
                    **spec["bounds"],
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "ocrKind": spec["kind"],
                    "ocrPrefix": spec["ocrPrefix"],
                    "ocrBlockNumber": (
                        accepted_lineages[-1][0]
                        if linux else accepted_lineages[0][0]
                    ),
                    "ocrParagraphNumber": 1,
                    "ocrLineNumber": 1,
                    "confidence": 0.32,
                    "searchable": spec.get("supersede") is not True,
                }
                raw.append(dict(region))
                (low if spec.get("supersede") is True else trusted).append(
                    dict(region)
                )
        return trusted, low, raw

    def reconstruct_architectural_2321_site_notes(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        raw: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "raw_regions": raw,
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 11,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_site_note_candidates(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_site_notes_replace_measurement_fragments(self) -> None:
        trusted, low, raw = self.architectural_2321_site_note_inputs()
        trusted_result, low_result = self.reconstruct_architectural_2321_site_notes(
            trusted, low, raw,
        )
        expected_by_id = {
            str(candidate["id"]): candidate
            for candidate in EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES
        }
        actual_by_id = {
            str(region.get("id") or ""): region for region in low_result
        }
        self.assertEqual(
            set(expected_by_id),
            set(expected_by_id).intersection(actual_by_id),
        )
        for candidate_id, spec in expected_by_id.items():
            candidate = actual_by_id[candidate_id]
            self.assertEqual(spec["text"], candidate["text"])
            self.assertEqual(spec["bounds"], {
                key: candidate[key] for key in ("x", "y", "width", "height")
            })
            self.assertEqual(EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE, candidate["source"])
            self.assertFalse(candidate["searchable"])
            for constituent in spec["constituents"]:
                if constituent.get("supersede") is not True:
                    continue
                matching_ids = set(constituent.get("acceptedIds", (constituent["id"],)))
                superseded = [
                    region for region in low_result
                    if str(region.get("id") or "") in matching_ids
                ]
                self.assertEqual(1, len(superseded))
                self.assertEqual(
                    "superseded_by_exact_rendered_site_note_composite",
                    superseded[0]["visualAuthorityStatus"],
                )
                self.assertEqual(candidate_id, superseded[0]["visualAuthorityReplacementId"])

        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        diagnostics = [
            diagnostic
            for item in unresolved
            for diagnostic in item.get("diagnosticCandidates") or []
        ]
        site_diagnostics = [
            item for item in diagnostics
            if item.get("source") == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
        ]
        self.assertEqual(
            {str(candidate["text"]) for candidate in EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES},
            {str(candidate["text"]) for candidate in site_diagnostics},
        )
        self.assertTrue(all(
            len(item.get("diagnosticCandidates") or []) == 1
            for item in unresolved
            if any(
                candidate.get("source") == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
                for candidate in item.get("diagnosticCandidates") or []
            )
        ))
        self.assertNotIn(
            "15'-@\"",
            {str(candidate.get("text") or "") for candidate in diagnostics},
        )
        self.assertNotIn(
            "6'-O\"",
            {str(candidate.get("text") or "") for candidate in diagnostics},
        )

    def test_exact_architectural_2321_site_notes_fail_closed_on_drift(self) -> None:
        trusted, low, raw = self.architectural_2321_site_note_inputs()
        for key, value in {
            "project_id": "other-project",
            "page_number": 10,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }.items():
            with self.subTest(binding=key):
                trusted_result, low_result = self.reconstruct_architectural_2321_site_notes(
                    trusted, low, raw, **{key: value},
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(low, low_result)

        target_id = str(
            EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES[2]["constituents"][1]["id"]
        )
        for name, update in (
            ("text", {"text": "30'-0\""}),
            ("bounds", {"x": 0.780951}),
            ("source", {"source": "other"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted_raw = [
                    {**region, **update}
                    if str(region.get("id") or "") == target_id else region
                    for region in raw
                ]
                trusted_result, low_result = self.reconstruct_architectural_2321_site_notes(
                    trusted, low, drifted_raw,
                )
                candidate_ids = {
                    str(region.get("id") or "") for region in low_result
                }
                self.assertNotIn(
                    EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES[2]["id"],
                    candidate_ids,
                )
                self.assertIn(
                    EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES[0]["id"],
                    candidate_ids,
                )
                self.assertEqual(trusted, trusted_result)

        duplicate_raw = [*raw, dict(raw[0])]
        _, low_result = self.reconstruct_architectural_2321_site_notes(
            trusted, low, duplicate_raw,
        )
        self.assertNotIn(
            EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES[0]["id"],
            {str(region.get("id") or "") for region in low_result},
        )

    def test_exact_architectural_2321_site_notes_accept_linux_ocr_order(self) -> None:
        trusted, low, raw = self.architectural_2321_site_note_inputs(linux=True)
        _, low_result = self.reconstruct_architectural_2321_site_notes(
            trusted, low, raw,
        )
        candidates = [
            region for region in low_result
            if region.get("source") == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
        ]
        self.assertEqual(4, len(candidates))
        self.assertEqual(
            {str(spec["text"]) for spec in EXACT_ARCHITECTURAL_2321_SITE_NOTE_CANDIDATES},
            {str(candidate["text"]) for candidate in candidates},
        )

    def architectural_2321_keynote_inputs(
        self,
    ) -> tuple[
        list[dict[str, object]],
        list[dict[str, object]],
        list[dict[str, object]],
    ]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        raw: list[dict[str, object]] = []
        spec = EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]
        for constituent in spec["constituents"]:
            block, paragraph, line = tuple(constituent["lineages"])[0]
            region = {
                "id": constituent["id"],
                "text": tuple(constituent["texts"])[0],
                **constituent["bounds"],
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": constituent["kind"],
                "ocrPrefix": constituent["ocrPrefix"],
                "ocrBlockNumber": block,
                "ocrParagraphNumber": paragraph,
                "ocrLineNumber": line,
                "confidence": (
                    0.18 if constituent.get("role") == "measurement" else 0.95
                ),
                "searchable": constituent.get("supersede") is not True,
            }
            raw.append(dict(region))
            (low if constituent.get("supersede") is True else trusted).append(
                dict(region)
            )
        return trusted, low, raw

    def reconstruct_architectural_2321_keynote(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        raw: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "raw_regions": raw,
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_site_note_candidates(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_keynote_reviews_complete_fence_fact(self) -> None:
        trusted, low, raw = self.architectural_2321_keynote_inputs()
        trusted_result, low_result = self.reconstruct_architectural_2321_keynote(
            trusted, low, raw,
        )
        spec = EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]
        composite = next(
            region for region in low_result
            if region.get("id") == spec["id"]
        )
        self.assertEqual(spec["text"], composite["text"])
        self.assertEqual(EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE, composite["source"])
        self.assertFalse(composite["searchable"])
        self.assertEqual(trusted, trusted_result)

        fragment = next(
            region for region in low_result
            if region.get("id") == spec["constituents"][1]["id"]
        )
        self.assertEqual(
            "superseded_by_exact_rendered_site_note_composite",
            fragment["visualAuthorityStatus"],
        )
        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        candidates = [
            candidate
            for item in unresolved
            for candidate in item.get("diagnosticCandidates") or []
        ]
        self.assertEqual([spec["text"]], [
            candidate["text"] for candidate in candidates
            if candidate.get("source") == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
        ])
        self.assertNotIn("6'-O\"", {
            str(candidate.get("text") or "") for candidate in candidates
        })

    def test_exact_architectural_2321_keynote_fails_closed_on_any_drift(self) -> None:
        trusted, low, raw = self.architectural_2321_keynote_inputs()
        for key, value in {
            "project_id": "other-project",
            "page_number": 23,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }.items():
            with self.subTest(binding=key):
                self.assertEqual(
                    (trusted, low),
                    self.reconstruct_architectural_2321_keynote(
                        trusted, low, raw, **{key: value},
                    ),
                )

        target_id = str(
            EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]["constituents"][1]["id"]
        )
        for name, update in (
            ("text", {"text": "6'-0\""}),
            ("bounds", {"x": 0.738572}),
            ("source", {"source": "other"}),
            ("kind", {"ocrKind": "line"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted = [
                    {**region, **update}
                    if str(region.get("id") or "") == target_id else region
                    for region in raw
                ]
                _, low_result = self.reconstruct_architectural_2321_keynote(
                    trusted, low, drifted,
                )
                self.assertNotIn(
                    EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]["id"],
                    {str(region.get("id") or "") for region in low_result},
                )

        duplicate = [*raw, dict(raw[0])]
        _, low_result = self.reconstruct_architectural_2321_keynote(
            trusted, low, duplicate,
        )
        self.assertNotIn(
            EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]["id"],
            {str(region.get("id") or "") for region in low_result},
        )

    def test_exact_architectural_2321_keynote_accepts_engine_ordinal_variance(self) -> None:
        trusted, low, raw = self.architectural_2321_keynote_inputs()
        varied_raw = []
        for index, region in enumerate(raw):
            leading = str(region.get("ocrPrefix") or "").endswith("subtile-1:0")
            varied_raw.append({
                **region,
                "id": f"engine-word-{index}",
                "ocrBlockNumber": 120 if leading else 90,
            })
        varied_trusted = [
            dict(region) for region in varied_raw
            if str(region.get("text") or "") != "6'-O\""
        ]
        varied_low = [
            dict(region) for region in varied_raw
            if str(region.get("text") or "") == "6'-O\""
        ]
        trusted_result, low_result = self.reconstruct_architectural_2321_keynote(
            varied_trusted, varied_low, varied_raw,
        )
        spec = EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]
        composite = next(
            region for region in low_result if region.get("id") == spec["id"]
        )
        self.assertEqual(spec["text"], composite["text"])
        self.assertEqual(varied_trusted, trusted_result)
        self.assertIn("engine-word-1", composite["constituentEvidence"])

    def architectural_2321_detail_inputs(
        self,
    ) -> tuple[
        list[dict[str, object]],
        list[dict[str, object]],
        list[dict[str, object]],
    ]:
        trusted: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        raw: list[dict[str, object]] = []
        for candidate in EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES:
            for spec in candidate["constituents"]:
                region = {
                    "id": tuple(spec.get("acceptedIds", (spec["id"],)))[0],
                    "text": tuple(spec["texts"])[0],
                    **spec["bounds"],
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "ocrKind": spec["kind"],
                    "ocrPrefix": spec["ocrPrefix"],
                    "ocrBlockNumber": tuple(spec["lineages"])[0][0],
                    "ocrParagraphNumber": tuple(spec["lineages"])[0][1],
                    "ocrLineNumber": tuple(spec["lineages"])[0][2],
                    "confidence": 0.18,
                    "searchable": False,
                }
                raw.append(dict(region))
                low.append(dict(region))
        return trusted, low, raw

    def reconstruct_architectural_2321_details(
        self,
        trusted: list[dict[str, object]],
        low: list[dict[str, object]],
        raw: list[dict[str, object]],
        **updates: object,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        arguments: dict[str, object] = {
            "raw_regions": raw,
            "project_id": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
            "page_number": 13,
            "source_sha256": (
                "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
            ),
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_site_note_candidates(
            trusted, low, **arguments,
        )

    def test_exact_architectural_2321_detail_candidates_are_complete_and_separate(self) -> None:
        trusted, low, raw = self.architectural_2321_detail_inputs()
        trusted_result, low_result = self.reconstruct_architectural_2321_details(
            trusted, low, raw,
        )
        expected = {
            str(spec["id"]): spec
            for spec in EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES
        }
        actual = {
            str(region.get("id") or ""): region for region in low_result
        }
        self.assertEqual([], trusted_result)
        self.assertEqual(set(expected), set(expected).intersection(actual))
        for candidate_id, spec in expected.items():
            candidate = actual[candidate_id]
            self.assertEqual(spec["text"], candidate["text"])
            self.assertEqual(spec["bounds"], {
                key: candidate[key] for key in ("x", "y", "width", "height")
            })
            self.assertEqual(
                EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
                candidate["source"],
            )
            self.assertFalse(candidate["searchable"])

        unresolved = unresolved_regions(
            trusted_result,
            {"sheetMappingStatus": "verified"},
            native_character_count=900,
            ocr_attempted=True,
            low_confidence_regions=low_result,
        )
        detail_exceptions = [
            item for item in unresolved
            if any(
                candidate.get("source")
                == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
                for candidate in item.get("diagnosticCandidates") or []
            )
        ]
        self.assertEqual(4, len(detail_exceptions))
        self.assertTrue(all(
            len(item.get("diagnosticCandidates") or []) == 1
            for item in detail_exceptions
        ))
        self.assertEqual(
            {str(spec["text"]) for spec in EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES},
            {
                str(item["diagnosticCandidates"][0]["text"])
                for item in detail_exceptions
            },
        )
        dimension_bounds = [
            item["bounds"] for item in detail_exceptions
            if item["diagnosticCandidates"][0]["text"]
            in {"5'-0\"", "3'-4\""}
        ]
        self.assertEqual(2, len(dimension_bounds))
        self.assertNotEqual(dimension_bounds[0], dimension_bounds[1])

        superseded = [
            region for region in low_result
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_site_note_composite"
        ]
        self.assertGreaterEqual(len(superseded), 11)
        self.assertTrue(all(region.get("searchable") is False for region in superseded))

    def test_exact_architectural_2321_detail_candidates_fail_closed_on_drift(self) -> None:
        trusted, low, raw = self.architectural_2321_detail_inputs()
        for key, value in {
            "project_id": "other-project",
            "page_number": 12,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }.items():
            with self.subTest(binding=key):
                trusted_result, low_result = self.reconstruct_architectural_2321_details(
                    trusted, low, raw, **{key: value},
                )
                self.assertEqual(trusted, trusted_result)
                self.assertEqual(low, low_result)

        target = EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES[3]
        constituent = target["constituents"][1]
        target_id = str(constituent["id"])
        for name, update in (
            ("text", {"text": "10'-0\""}),
            ("bounds", {"x": 0.771745}),
            ("source", {"source": "other"}),
            ("kind", {"ocrKind": "line"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted = [
                    {**region, **update}
                    if str(region.get("id") or "") == target_id else region
                    for region in raw
                ]
                _, low_result = self.reconstruct_architectural_2321_details(
                    trusted, low, drifted,
                )
                candidate_ids = {
                    str(region.get("id") or "") for region in low_result
                }
                self.assertNotIn(target["id"], candidate_ids)
                self.assertIn(
                    EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES[1]["id"],
                    candidate_ids,
                )

        duplicate = [*raw, dict(raw[0])]
        _, low_result = self.reconstruct_architectural_2321_details(
            trusted, low, duplicate,
        )
        self.assertNotIn(
            EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES[0]["id"],
            {str(region.get("id") or "") for region in low_result},
        )

    def test_generic_drawing_navigation_remains_text_but_not_a_drawing_fact(self) -> None:
        generic = {
            "id": "native-detail",
            "text": "DETAIL CALLOUT SECTION REVISION",
            "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.02,
            "confidence": 0.99,
            "source": "embedded_text",
        }

        self.assertEqual(deterministic_fact_regions([generic]), [])

    def test_embedded_fact_requires_overlapping_rendered_text(self) -> None:
        embedded = {
            "id": "native-fact",
            "text": '6" THICK PCC WALKWAY',
            "x": 0.10, "y": 0.20, "width": 0.20, "height": 0.02,
            "confidence": 0.99,
            "source": "embedded_text",
            "searchable": False,
        }
        distant = {
            "id": "ocr-distant",
            "text": '6" THICK PCC WALKWAY',
            "x": 0.60, "y": 0.70, "width": 0.20, "height": 0.02,
            "confidence": 0.98,
            "source": "fixed_visual_tile_coordinate_ocr",
            "ocrKind": "line",
        }

        hidden = corroborate_embedded_text_regions([embedded], [distant])[0]
        self.assertFalse(hidden["renderedCorroborated"])
        self.assertEqual(deterministic_fact_regions([hidden]), [])
        self.assertFalse(public_region(hidden)["searchable"])

        rendered = {
            **distant,
            "id": "ocr-overlap",
            "x": 0.101,
            "y": 0.201,
        }
        visible = corroborate_embedded_text_regions([embedded], [rendered])[0]
        self.assertTrue(visible["renderedCorroborated"])
        self.assertEqual(visible["renderedCorroboratingRegionIds"], ["ocr-overlap"])
        facts = deterministic_fact_regions([visible])
        self.assertEqual(len(facts), 1)
        self.assertTrue(facts[0]["searchable"])
        self.assertTrue(public_region(facts[0])["searchable"])

    def test_low_confidence_unvalidated_sheet_identity_is_rejected(self) -> None:
        candidate = {
            "id": "sheet-low-1",
            "text": "E-2.1",
            "x": 0.9, "y": 0.9, "width": 0.05, "height": 0.03,
            "confidence": 0.0,
            "source": "sheet_identity_ocr_landscape_outline",
        }

        accepted, rejected = trusted_ocr_regions([candidate])

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])

    def test_page_bound_sheet_identity_requires_label_value_and_footer(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        validated_regions = [
            {
                "id": "label", "text": "SHEETNUMBER", "x": 0.89, "y": 0.95,
                "width": 0.03, "height": 0.01, "confidence": 0.2,
                "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
            },
            {
                "id": "identity", "text": "A-2.2A", "x": 0.94, "y": 0.956,
                "width": 0.04, "height": 0.01, "confidence": 0.1,
                "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
            },
            {
                "id": "footer", "text": "SHEETS", "x": 0.96, "y": 0.98,
                "width": 0.03, "height": 0.01, "confidence": 0.3,
                "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
            },
        ]
        try:
            with patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                return_value=validated_regions,
            ):
                result = page_bound_sheet_identity_ocr_regions(
                    page, page.rect.width, page.rect.height,
                )
        finally:
            document.close()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "A-2.2A")
        self.assertEqual(result[0]["ocrValidationStatus"], "structural_title_cell")

    def test_page_bound_sheet_identity_rejects_missing_context_and_conflict(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        base = [
            {
                "id": "label", "text": "SHEETNUMBER", "x": 0.89, "y": 0.95,
                "confidence": 0.2, "source": "sheet_identity_ocr_page_bound_raw",
                "ocrKind": "word",
            },
            {
                "id": "identity", "text": "A-2.2A", "x": 0.94, "y": 0.956,
                "confidence": 0.1, "source": "sheet_identity_ocr_page_bound_raw",
                "ocrKind": "word",
            },
        ]
        cases = {
            "missing_footer": base,
            "truncated_identity": [
                {**base[0]},
                {**base[1], "text": "A-2"},
                {
                    "id": "footer", "text": "SHEETS", "x": 0.96, "y": 0.98,
                    "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
                },
            ],
            "conflicting_values": [
                *base,
                {**base[1], "id": "other", "text": "A-2.3A"},
                {
                    "id": "footer", "text": "SHEETS", "x": 0.96, "y": 0.98,
                    "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
                },
            ],
            "distant_value": [
                {**base[0]},
                {**base[1], "x": 0.50, "y": 0.40},
                {
                    "id": "footer", "text": "SHEETS", "x": 0.96, "y": 0.98,
                    "source": "sheet_identity_ocr_page_bound_raw", "ocrKind": "word",
                },
            ],
        }
        try:
            for name, regions in cases.items():
                with self.subTest(name=name):
                    with patch(
                        "ecos_indexer.extraction.ocr_regions_for_clip",
                        return_value=regions,
                    ):
                        self.assertEqual(
                            page_bound_sheet_identity_ocr_regions(
                                page, page.rect.width, page.rect.height,
                            ),
                            [],
                        )
        finally:
            document.close()

    def test_vertical_title_cell_requires_two_independent_agreeing_ocr_reads(self) -> None:
        label = {
            "id": "vertical-label", "text": "SHEETNUMBER",
            "x": 0.889, "y": 0.944, "width": 0.029, "height": 0.004,
            "confidence": 0.0, "source": "sheet_identity_ocr_vertical_outline",
            "ocrKind": "word",
        }
        primary = {
            "id": "vertical-value", "text": "E-2.7",
            "x": 0.928, "y": 0.945, "width": 0.038, "height": 0.013,
            "confidence": 0.0, "source": "sheet_identity_ocr_vertical_outline",
            "ocrKind": "word",
        }
        corroborating = {
            **primary,
            "id": "vertical-value-corroborating",
            "source": "sheet_identity_ocr_vertical_cell_corroboration",
        }

        validated = corroborated_vertical_sheet_identity_region(
            [label, primary],
            [corroborating],
            page_number=13,
        )

        self.assertIsNotNone(validated)
        assert validated is not None
        self.assertEqual(validated["text"], "E-2.7")
        self.assertEqual(
            validated["source"],
            "sheet_identity_ocr_page_bound_validated",
        )
        self.assertEqual(validated["confidence"], 0.95)
        self.assertEqual(
            validated["sheetIdentityEvidence"]["valueRegionIds"],
            ["vertical-value", "vertical-value-corroborating"],
        )
        accepted, rejected = trusted_ocr_regions([validated])
        self.assertEqual(accepted, [validated])
        self.assertEqual(rejected, [])

        for name, primary_regions, corroborating_regions in (
            ("missing-label", [primary], [corroborating]),
            (
                "mismatch",
                [label, primary],
                [{**corroborating, "text": "E-2.8"}],
            ),
            (
                "same-source",
                [label, primary],
                [{**corroborating, "source": primary["source"]}],
            ),
            (
                "competing-value",
                [
                    label,
                    primary,
                    {**primary, "id": "vertical-value-other", "text": "E-2.8"},
                ],
                [corroborating],
            ),
        ):
            with self.subTest(name=name):
                self.assertIsNone(corroborated_vertical_sheet_identity_region(
                    primary_regions,
                    corroborating_regions,
                    page_number=13,
                ))

    def test_vertical_title_cell_producer_uses_two_precise_value_reads(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=1000)
        label = {
            "id": "vertical-label", "text": "SHEETNUMBER",
            "x": 0.889, "y": 0.949667, "width": 0.029, "height": 0.004,
            "confidence": 0.0, "source": "sheet_identity_ocr_vertical_outline",
            "ocrKind": "word",
        }
        primary = {
            "id": "vertical-value-primary", "text": "E-0.0",
            "x": 0.938, "y": 0.955, "width": 0.039, "height": 0.014,
            "confidence": 0.0, "source": "sheet_identity_ocr_vertical_value_primary",
            "ocrKind": "word",
        }
        corroborating = {
            **primary,
            "id": "vertical-value-corroborating",
            "source": "sheet_identity_ocr_vertical_cell_corroboration",
        }
        try:
            with patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=[[primary], [corroborating]],
            ) as read_value:
                validated = corroborated_vertical_sheet_identity_ocr_region(
                    page,
                    page.rect.width,
                    page.rect.height,
                    [label],
                )

            self.assertIsNotNone(validated)
            assert validated is not None
            self.assertEqual(validated["text"], "E-0.0")
            self.assertEqual(read_value.call_count, 2)
            primary_call, corroborating_call = read_value.call_args_list
            self.assertEqual(primary_call.kwargs["dpi"], 200)
            self.assertEqual(primary_call.kwargs["dark_stroke_filter_size"], 3)
            self.assertIn("--psm 13", primary_call.kwargs["config"])
            self.assertEqual(corroborating_call.kwargs["dpi"], 480)
            self.assertNotIn("dark_stroke_filter_size", corroborating_call.kwargs)
            self.assertIn("--psm 13", corroborating_call.kwargs["config"])
            self.assertEqual(primary_call.args[1], corroborating_call.args[1])

            with patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
            ) as read_value_without_label:
                self.assertIsNone(corroborated_vertical_sheet_identity_ocr_region(
                    page,
                    page.rect.width,
                    page.rect.height,
                    [],
                ))
                read_value_without_label.assert_not_called()
        finally:
            document.close()

    def test_vertical_title_value_crop_contains_the_complete_deployed_glyph(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=1000)
        try:
            clip = vertical_sheet_value_cell_clip(
                page,
                page.rect.width,
                page.rect.height,
            )
        finally:
            document.close()

        self.assertEqual(clip, fitz.Rect(928, 948, 980, 975))
        deployed_value_bounds = fitz.Rect(
            938.214,
            955.167,
            938.214 + 38.452,
            955.167 + 13.333,
        )
        self.assertTrue(clip.contains(deployed_value_bounds))

    def test_low_confidence_explicit_thickness_note_is_syntax_validated(self) -> None:
        candidate = {
            "id": "dimension-note-low-1",
            "text": '4" THICK PCC WALKWAY',
            "x": 0.2, "y": 0.4, "width": 0.18, "height": 0.02,
            "confidence": 0.21,
            "source": "dimension_coordinate_ocr_bottom_0",
        }

        accepted, rejected = trusted_ocr_regions([candidate])

        self.assertEqual(rejected, [])
        self.assertEqual(accepted[0]["ocrValidationStatus"], "syntax_validated")

    def test_page_ocr_resolution_targets_consistent_rendered_size(self) -> None:
        document = fitz.open()
        large_drawing = document.new_page(width=2592, height=1728)
        try:
            self.assertEqual(page_ocr_dpi(large_drawing), 100)
        finally:
            document.close()

        document = fitz.open()
        small_scanned_sheet = document.new_page(width=792, height=612)
        try:
            self.assertEqual(page_ocr_dpi(small_scanned_sheet), 300)
        finally:
            document.close()

    def test_clockwise_ocr_box_maps_back_to_source_coordinates(self) -> None:
        self.assertEqual(
            unrotate_ocr_box(
                20,
                30,
                40,
                10,
                image_rotation_degrees=270,
                unrotated_image_width=200,
                unrotated_image_height=100,
            ),
            (30, 40, 10, 40),
        )

    def test_bookmark_identity_requires_independent_title_cell_ocr(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        page.insert_text((100, 100), "EXTERIOR LIGHTING PLAN WITH SEARCHABLE NOTES " * 3)
        identity = StructuralSheetIdentity(
            sheet_number="E-1.1",
            source="pdf_bookmark",
            evidence=(StructuralIdentityEvidence(
                evidence_id="pdf-bookmark-0-page-1",
                page_number=1,
                source="pdf_bookmark",
                text="E04-E1.1",
                normalized_bounds=None,
            ),),
        )
        rendered_identity = {
            "id": "sheet-identity-page-bound-validated-1",
            "text": "E-1.1",
            "label": "E-1.1",
            "x": 0.95,
            "y": 0.95,
            "width": 0.02,
            "height": 0.02,
            "confidence": 0.99,
            "source": "sheet_identity_ocr_page_bound_validated",
            "searchable": True,
        }
        try:
            with patch(
                "ecos_indexer.extraction.title_block_ocr_regions",
                return_value=[],
            ) as title_ocr:
                with patch(
                    "ecos_indexer.extraction.sheet_identity_ocr_regions",
                    return_value=[rendered_identity],
                ) as identity_ocr:
                    with patch("ecos_indexer.extraction.ocr_text_regions", return_value=[]):
                        result = extract_page(
                            page,
                            "a" * 64,
                            project_id="test-project",
                            document_sheet_identity=identity,
                        )
        finally:
            document.close()

        title_ocr.assert_called_once()
        identity_ocr.assert_called_once()
        self.assertEqual(result["final"]["sheetNumber"], "E-1.1")
        self.assertEqual(result["final"]["sheetMappingSource"], "pdf_bookmark")
        persisted_evidence = result["final"]["sheetMappingEvidence"][0]
        self.assertIs(persisted_evidence["renderedCorroborated"], True)
        self.assertEqual(
            persisted_evidence["renderedCorroboratingRegionIds"],
            ["sheet-identity-page-bound-validated-1"],
        )
        self.assertEqual(
            result["deterministic"]["documentStructuralIdentity"],
            {
                "sheetNumber": "E-1.1",
                "source": "pdf_bookmark",
                "evidence": [persisted_evidence],
            },
        )

    def test_bookmark_identity_is_rejected_when_rendered_ocr_disagrees(self) -> None:
        identity = StructuralSheetIdentity(
            sheet_number="E-1.1",
            source="pdf_bookmark",
            evidence=(StructuralIdentityEvidence(
                evidence_id="pdf-bookmark-0-page-1",
                page_number=1,
                source="pdf_bookmark",
                text="E04-E1.1",
                normalized_bounds=None,
            ),),
        )
        rendered = [{
            "id": "sheet-identity-page-bound-validated-1",
            "text": "F-1.1",
            "x": 0.95,
            "y": 0.95,
            "source": "sheet_identity_ocr_page_bound_validated",
            "searchable": True,
        }]

        result = corroborate_document_structural_identity(
            identity,
            native_regions=[],
            rendered_regions=rendered,
        )

        self.assertIsNone(result)

    def test_hosted_extraction_persists_complete_structured_table_facts(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        page.insert_text((120, 120), '6" THK. REINFORCED CONCRETE SLAB')
        identity = StructuralSheetIdentity(
            sheet_number="C6",
            source="pdf_bookmark",
            evidence=(StructuralIdentityEvidence(
                evidence_id="pdf-bookmark-0-page-1",
                page_number=1,
                source="pdf_bookmark",
                text="C06-C6",
                normalized_bounds=None,
            ),),
        )
        try:
            rendered_regions = [{
                **region,
                "id": f"render-{region['id']}",
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "line",
                "searchable": True,
            } for region in native_text_regions(page, page.rect.width, page.rect.height)]
            with patch(
                "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                return_value=(rendered_regions, []),
            ):
                result = extract_page(
                    page,
                    "a" * 64,
                    project_id="2375 Compliance Project",
                    document_sheet_identity=identity,
                )
        finally:
            document.close()

        analysis = result["final"]["structuredTableAnalysis"]
        self.assertIsNotNone(analysis)
        self.assertEqual(analysis["status"], "complete")
        self.assertEqual(
            result["final"]["projectId"],
            "2375 Compliance Project",
        )
        facts = [
            region for region in result["final"]["regions"]
            if region.get("source") == "deterministic_structured_table_relationship"
        ]
        self.assertTrue(all(
            isinstance(region.get("searchable"), bool)
            for region in result["final"]["regions"]
        ))
        self.assertEqual(len(facts), 1)
        self.assertIs(facts[0]["searchable"], True)
        self.assertEqual(facts[0]["factKind"], "drawing_fact")
        self.assertEqual(facts[0]["evidenceText"], facts[0]["text"])
        self.assertTrue(facts[0]["constituentEvidence"])
        self.assertEqual(
            {item["projectId"] for item in facts[0]["constituentEvidence"]},
            {"2375 Compliance Project"},
        )
        claimed_ids = {
            region_id
            for block in analysis["blocks"]
            for region_id in block["regionIds"]
        }
        claimed_regions = [
            region for region in result["final"]["regions"]
            if region.get("id") in claimed_ids
        ]
        self.assertTrue(claimed_regions)
        self.assertTrue(all(region.get("searchable") is False for region in claimed_regions))
        self.assertEqual(result["final"]["text"], facts[0]["text"])

    def test_incomplete_structured_table_tokens_cannot_enter_searchable_page_text(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        page.insert_text((100, 80), "FOOTING SCHEDULE MARK FOOTING REINFORCING")
        page.insert_text((100, 130), 'F1 5\'-0" x 5\'-0" x 18" 6-#5')
        page.insert_text((100, 180), 'F2 4\'-0" x 4\'-0" x 18"')
        identity = StructuralSheetIdentity(
            sheet_number="SA1.1",
            source="pdf_bookmark",
            evidence=(StructuralIdentityEvidence(
                evidence_id="pdf-bookmark-0-page-1",
                page_number=1,
                source="pdf_bookmark",
                text="SA1.1",
                normalized_bounds=None,
            ),),
        )
        try:
            rendered_regions = [{
                **region,
                "id": f"render-{region['id']}",
                "source": "fixed_visual_tile_coordinate_ocr",
                "ocrKind": "line",
                "searchable": True,
            } for region in native_text_regions(page, page.rect.width, page.rect.height)]
            with patch(
                "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                return_value=(rendered_regions, []),
            ):
                with patch(
                    "ecos_indexer.extraction.standalone_structured_table_hints",
                    return_value=[{
                        "schema": "footing_schedule",
                        "bounds": {"x": 0.05, "y": 0.05, "width": 0.75, "height": 0.40},
                    }],
                ):
                    result = extract_page(
                        page,
                        "b" * 64,
                        project_id="2375 Compliance Project",
                        document_sheet_identity=identity,
                    )
        finally:
            document.close()

        analysis = result["final"]["structuredTableAnalysis"]
        self.assertIsNotNone(analysis)
        self.assertEqual(analysis["status"], "incomplete")
        facts = [
            region for region in result["final"]["regions"]
            if region.get("source") == "deterministic_structured_table_relationship"
        ]
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["structuredTableRowKey"], "F1")
        claimed_ids = {
            region_id
            for block in analysis["blocks"]
            for region_id in block["regionIds"]
        }
        self.assertTrue(claimed_ids)
        self.assertTrue(all(
            region.get("searchable") is False
            for region in result["final"]["regions"]
            if region.get("id") in claimed_ids
        ))
        searchable_text = result["final"]["text"] or ""
        self.assertIn("5'-0", searchable_text)
        self.assertNotIn("4'-0", searchable_text)
        self.assertFalse(any(
            str(item.get("regionKey") or "").startswith("structured-table-")
            for item in result["unresolved"]
        ))
        self.assertTrue(result["final"]["structuredTableLimitations"])

    def test_public_region_emits_only_explicit_boolean_search_markers(self) -> None:
        base = {
            "id": "region-1", "text": "visible", "x": 0.1, "y": 0.1,
            "width": 0.1, "height": 0.1, "source": "embedded_text",
        }

        self.assertIs(public_region(base)["searchable"], False)
        self.assertIs(public_region({**base, "searchable": True})["searchable"], False)
        self.assertIs(public_region({**base, "searchable": False})["searchable"], False)
        self.assertIs(public_region({**base, "searchable": "true"})["searchable"], False)
        self.assertIs(public_region({**base, "searchable": None})["searchable"], False)
        self.assertIs(public_region({**base, "searchable": {"value": True}})["searchable"], False)

    def test_native_title_band_structural_identity_keeps_true_provenance(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        evidence = StructuralIdentityEvidence(
            evidence_id="native-0-0",
            page_number=1,
            source="embedded_text",
            text="L-1",
            normalized_bounds=(0.95, 0.95, 0.02, 0.02),
        )
        identity = StructuralSheetIdentity(
            sheet_number="L-1",
            source="native_title_band",
            evidence=(evidence,),
        )
        native_region = {
            "id": "native-0-0",
            "text": "L-1",
            "label": "L-1",
            "x": 0.95,
            "y": 0.95,
            "width": 0.02,
            "height": 0.02,
            "confidence": 0.99,
            "source": "embedded_text",
            "searchable": False,
        }
        rendered_region = {
            **native_region,
            "id": "title-visible-l1",
            "source": "title_block_ocr",
            "searchable": True,
            "ocrKind": "line",
        }
        try:
            with patch(
                "ecos_indexer.extraction.native_text_regions",
                return_value=[native_region],
            ):
                with patch(
                    "ecos_indexer.extraction.title_block_ocr_regions",
                    return_value=[rendered_region],
                ) as title_ocr:
                    with patch(
                        "ecos_indexer.extraction.sheet_identity_ocr_regions",
                        return_value=[],
                    ) as identity_ocr:
                        with patch(
                            "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                            return_value=([], []),
                        ):
                            with patch(
                                "ecos_indexer.extraction.coordinate_ocr_reason",
                                return_value=None,
                            ):
                                result = extract_page(
                                    page,
                                    "a" * 64,
                                    project_id="test-project",
                                    document_sheet_identity=identity,
                                )
        finally:
            document.close()

        title_ocr.assert_called_once()
        identity_ocr.assert_called_once()
        self.assertEqual(result["final"]["sheetNumber"], "L-1")
        self.assertEqual(result["final"]["sheetMappingSource"], "native_title_band")
        self.assertNotEqual(result["final"]["sheetMappingSource"], "pdf_bookmark")
        corroborated_evidence = {
            **evidence.as_dict(),
            "renderedCorroborated": True,
            "renderedCorroboratingRegionIds": ["title-visible-l1"],
            "renderedCorroboratingSources": ["title_block_ocr"],
        }
        self.assertEqual(
            result["final"]["sheetMappingEvidence"],
            [corroborated_evidence],
        )
        self.assertEqual(
            result["deterministic"]["documentStructuralIdentity"]["evidence"],
            [corroborated_evidence],
        )
        self.assertIn("native_title_band_identity", result["ocr"]["reason"])
        native = next(
            region for region in result["final"]["regions"]
            if region.get("id") == "native-0-0"
        )
        self.assertIs(native["searchable"], False)
        self.assertFalse(any(
            region.get("factKind") == "drawing_fact"
            and region.get("source") == "embedded_text"
            for region in result["final"]["regions"]
        ))

    def test_annotation_structural_candidate_requires_rendered_token_and_label(self) -> None:
        identity = StructuralSheetIdentity(
            sheet_number="C6",
            source="pdf_annotation_title_band",
            evidence=(
                StructuralIdentityEvidence(
                    "pdf-annotation-token-page-1", 1, "pdf_annotation", "C6",
                    (0.95, 0.90, 0.02, 0.02), "Square",
                ),
                StructuralIdentityEvidence(
                    "pdf-annotation-label-page-1", 1, "pdf_annotation", "SHEET NO.",
                    (0.94, 0.88, 0.04, 0.02), "Square",
                ),
            ),
        )
        rendered = [
            {
                "id": "rendered-c6", "text": "C6",
                "x": 0.95, "y": 0.90, "width": 0.02, "height": 0.02,
                "source": "fixed_visual_tile_coordinate_ocr", "searchable": True,
                "ocrKind": "line",
            },
            {
                "id": "rendered-label", "text": "SHEET NO.",
                "x": 0.94, "y": 0.88, "width": 0.04, "height": 0.02,
                "source": "fixed_visual_tile_coordinate_ocr", "searchable": True,
                "ocrKind": "line",
            },
        ]

        corroborated = corroborate_document_structural_identity(
            identity,
            native_regions=[],
            rendered_regions=rendered,
        )
        self.assertIsNotNone(corroborated)
        assert corroborated is not None
        self.assertTrue(all(
            item.rendered_corroborated for item in corroborated.evidence
        ))
        self.assertIsNone(corroborate_document_structural_identity(
            identity,
            native_regions=[],
            rendered_regions=rendered[:1],
        ))


if __name__ == "__main__":
    unittest.main()
