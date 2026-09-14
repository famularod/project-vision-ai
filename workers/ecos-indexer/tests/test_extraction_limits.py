import unittest
from unittest.mock import patch

import pymupdf as fitz

from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    analyze_deterministic_label_blocks,
    coalesce_low_confidence_regions,
    DocumentResourceRejected,
    VisualTileAnalysisFailed,
    coordinate_ocr_reason,
    dedupe_regions,
    deterministic_fact_regions,
    deterministic_label_block_regions,
    dimension_candidate_text,
    dimension_ocr_regions,
    exact_simple_measurement_keys,
    incomplete_simple_foot_inch_measurement,
    extract_page,
    native_text_regions,
    native_text_is_readable,
    ocr_data_regions,
    open_pdf,
    ocr_tile_rectangles,
    page_bound_sheet_identity_ocr_regions,
    page_ocr_dpi,
    public_region,
    region_from_box,
    standalone_structured_table_targeted_ocr,
    structured_table_vector_segments,
    targeted_measurement_corroboration_regions,
    title_block_ocr_regions,
    trusted_ocr_regions,
    trailing_dash_foot_fragment,
    unrotate_ocr_box,
    visual_tile_render_dpi,
    unresolved_regions,
)
from ecos_indexer.sheet_mapping import (
    StructuralIdentityEvidence,
    StructuralSheetIdentity,
)


class ExtractionLimitTests(unittest.TestCase):
    def test_vector_evidence_uses_displayed_page_coordinates_at_every_rotation(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation), fitz.open() as document:
                page = document.new_page(width=800, height=600)
                start, end = fitz.Point(80, 120), fitz.Point(640, 120)
                page.draw_line(start, end)
                page.set_rotation(rotation)
                expected_start = start * page.rotation_matrix
                expected_end = end * page.rotation_matrix
                actual = structured_table_vector_segments(page, page.rect.width, page.rect.height)
                self.assertEqual(len(actual), 1)
                self.assertAlmostEqual(actual[0]["x1"], expected_start.x / page.rect.width, places=5)
                self.assertAlmostEqual(actual[0]["y1"], expected_start.y / page.rect.height, places=5)
                self.assertAlmostEqual(actual[0]["x2"], expected_end.x / page.rect.width, places=5)
                self.assertAlmostEqual(actual[0]["y2"], expected_end.y / page.rect.height, places=5)

    def test_embedded_font_control_codes_are_not_high_confidence_text(self) -> None:
        for text in ["CANOPY\x00B", "\x01\x02\x03", "AREA \ufffd SF", "ROOM\x85B"]:
            self.assertFalse(native_text_is_readable(text))
        for text in ["CANOPY B", "AREA: 5,248 SF", "室内 101", "WIDTH\t82'-0\""]:
            self.assertTrue(native_text_is_readable(text))

    def test_corrupt_native_line_is_rejected_not_silently_repaired(self) -> None:
        from unittest.mock import Mock
        page = Mock(rotation=0)
        page.get_text.return_value = {"blocks": [{"type": 0, "lines": [
            {"bbox": [10, 10, 80, 20], "spans": [{"text": "Canopy\x01B"}]},
            {"bbox": [10, 30, 80, 40], "spans": [{"text": "Sheet WPB-5"}]},
        ]}]}
        regions = native_text_regions(page, 100, 100)
        self.assertEqual([region["text"] for region in regions], ["Sheet WPB-5"])

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

    def test_worker_style_structural_map_keeps_a16_and_a113_exact(self) -> None:
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

        self.assertEqual(a16["final"]["sheetNumber"], "A-1.6")
        self.assertEqual(a16["final"]["sheetMappingStatus"], "verified")
        self.assertEqual(a16["final"]["sheetMappingSource"], "pdf_bookmark")
        self.assertEqual(a113["final"]["sheetNumber"], "A-1.13")
        self.assertEqual(a113["final"]["sheetMappingStatus"], "verified")
        self.assertEqual(a113["final"]["sheetMappingSource"], "pdf_bookmark")

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

    def test_clipped_single_foot_token_is_not_treated_as_exact_measurement(self) -> None:
        for clipped in ("16'-", "16'\u2013", "16'\u2014", "16'=", "16'-."):
            with self.subTest(clipped=clipped):
                self.assertEqual(exact_simple_measurement_keys(clipped), set())
                self.assertTrue(trailing_dash_foot_fragment(clipped))
                self.assertFalse(dimension_candidate_text(clipped))

    def test_complete_single_foot_tokens_remain_exact_measurements(self) -> None:
        for complete in ("16'", "16' CLEAR", "16 FT"):
            with self.subTest(complete=complete):
                self.assertEqual(
                    exact_simple_measurement_keys(complete),
                    {"single-foot:16ft"},
                )
                self.assertTrue(dimension_candidate_text(complete))

    def test_incomplete_dimension_with_inches_routes_to_visual_transcription_correction(self) -> None:
        region = {
            "id": "rotated-coordinate-clipped-dimension",
            "text": "4'-0",
            "x": 0.20,
            "y": 0.12,
            "width": 0.02,
            "height": 0.01,
            "confidence": 0.27,
            "source": "fixed_visual_tile_coordinate_ocr",
        }

        clusters = coalesce_low_confidence_regions([region])

        self.assertEqual(len(clusters), 1)
        self.assertEqual(
            clusters[0]["diagnosticCandidates"][0]["source"],
            "fixed_visual_tile_measurement_transcription_correction",
        )

    def test_trailing_dash_fragments_never_become_evidence_or_visual_exceptions(self) -> None:
        regions = [
            {
                "id": "trusted-but-clipped",
                "text": "16'-",
                "x": 0.20,
                "y": 0.12,
                "width": 0.02,
                "height": 0.01,
                "confidence": 0.63,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "weak-and-clipped",
                "text": "16'\u2014",
                "x": 0.20,
                "y": 0.12,
                "width": 0.02,
                "height": 0.01,
                "confidence": 0.27,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        accepted, rejected = trusted_ocr_regions(regions)

        self.assertEqual(accepted, [])
        self.assertEqual(rejected, [])

    def test_targeted_measurement_retry_requires_dual_psm_coordinate_agreement(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        low_confidence = [{
            "id": "weak-exact-dimension",
            "text": '14\'-3 1/2"',
            "x": 0.88,
            "y": 0.12,
            "width": 0.03,
            "height": 0.01,
            "confidence": 0.21,
            "source": "fixed_visual_tile_coordinate_ocr",
        }]
        psm6 = [{
            **low_confidence[0],
            "id": "psm6-dimension",
            "confidence": 0.84,
            "source": "targeted_measurement_coordinate_ocr_psm6",
        }]
        psm11 = [{
            **low_confidence[0],
            "id": "psm11-dimension",
            "confidence": 0.91,
            "source": "targeted_measurement_coordinate_ocr_psm11",
        }]
        try:
            with patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=[psm6, psm11],
            ):
                result = targeted_measurement_corroboration_regions(
                    page, 1000, 600, low_confidence,
                )
        finally:
            document.close()

        self.assertEqual(len(result), 1)
        self.assertEqual(
            result[0]["source"],
            "targeted_measurement_coordinate_ocr_dual_psm",
        )
        self.assertEqual(result[0]["ocrValidationStatus"], "dual_psm_targeted_corroborated")
        self.assertEqual(len(result[0]["corroboratingEvidence"]), 2)

    def test_targeted_measurement_retry_rejects_psm_value_disagreement(self) -> None:
        document = fitz.open()
        page = document.new_page(width=1000, height=600)
        low_confidence = [{
            "id": "weak-exact-dimension",
            "text": '14\'-3 1/2"',
            "x": 0.88,
            "y": 0.12,
            "width": 0.03,
            "height": 0.01,
            "confidence": 0.21,
            "source": "fixed_visual_tile_coordinate_ocr",
        }]
        psm6 = [{**low_confidence[0], "text": '14\'-3 1/2"'}]
        psm11 = [{**low_confidence[0], "text": '14\'-8 1/2"'}]
        try:
            with patch(
                "ecos_indexer.extraction.ocr_regions_for_clip",
                side_effect=[psm6, psm11],
            ):
                result = targeted_measurement_corroboration_regions(
                    page, 1000, 600, low_confidence,
                )
        finally:
            document.close()

        self.assertEqual(result, [])

    def test_exact_corroborated_measurement_suppresses_overlapping_incomplete_variant(self) -> None:
        exact = {
            "id": "targeted-exact",
            "text": '1(CX002): 14\'-3 1/2"',
            "x": 0.85,
            "y": 0.12,
            "width": 0.07,
            "height": 0.01,
            "confidence": 0.95,
            "source": "targeted_measurement_coordinate_ocr_dual_psm",
        }
        incomplete = {
            "id": "weak-incomplete",
            "text": "14'-3",
            "x": 0.88,
            "y": 0.12,
            "width": 0.02,
            "height": 0.01,
            "confidence": 0.21,
            "source": "fixed_visual_tile_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([exact, incomplete])

        self.assertEqual([region["id"] for region in accepted], ["targeted-exact"])
        self.assertEqual(rejected, [])

    def test_different_exact_measurement_does_not_suppress_incomplete_variant(self) -> None:
        exact = {
            "id": "targeted-different",
            "text": '1(CX002): 14\'-8 1/2"',
            "x": 0.85,
            "y": 0.12,
            "width": 0.07,
            "height": 0.01,
            "confidence": 0.95,
            "source": "targeted_measurement_coordinate_ocr_dual_psm",
        }
        incomplete = {
            "id": "weak-incomplete",
            "text": "14'-3",
            "x": 0.88,
            "y": 0.12,
            "width": 0.02,
            "height": 0.01,
            "confidence": 0.21,
            "source": "fixed_visual_tile_coordinate_ocr",
        }

        accepted, rejected = trusted_ocr_regions([exact, incomplete])

        self.assertEqual([region["id"] for region in accepted], ["targeted-different"])
        self.assertEqual([region["id"] for region in rejected], ["weak-incomplete"])

    def test_grouped_dimension_candidates_use_ordinary_dual_model_review(self) -> None:
        regions = [
            {
                "id": "rotated-coordinate-clipped-dimension",
                "text": "14'-3",
                "x": 0.88,
                "y": 0.12,
                "width": 0.014,
                "height": 0.004,
                "confidence": 0.22,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
            {
                "id": "rotated-coordinate-complete-dimension",
                "text": '14\'-3 1/2"',
                "x": 0.88,
                "y": 0.12,
                "width": 0.028,
                "height": 0.004,
                "confidence": 0.22,
                "source": "fixed_visual_tile_coordinate_ocr",
            },
        ]

        clusters = coalesce_low_confidence_regions(regions)

        self.assertEqual(len(clusters), 1)
        self.assertEqual(
            [candidate["source"] for candidate in clusters[0]["diagnosticCandidates"]],
            ["fixed_visual_tile_coordinate_ocr", "fixed_visual_tile_coordinate_ocr"],
        )

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

    def test_generic_drawing_navigation_remains_text_but_not_a_drawing_fact(self) -> None:
        generic = {
            "id": "native-detail",
            "text": "DETAIL CALLOUT SECTION REVISION",
            "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.02,
            "confidence": 0.99,
            "source": "embedded_text",
        }

        self.assertEqual(deterministic_fact_regions([generic]), [])

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

    def test_structural_identity_skips_redundant_title_block_ocr(self) -> None:
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
        try:
            with patch("ecos_indexer.extraction.title_block_ocr_regions") as title_ocr:
                with patch("ecos_indexer.extraction.sheet_identity_ocr_regions") as identity_ocr:
                    with patch("ecos_indexer.extraction.ocr_text_regions", return_value=[]):
                        result = extract_page(
                            page,
                            "a" * 64,
                            project_id="test-project",
                            document_sheet_identity=identity,
                        )
        finally:
            document.close()

        title_ocr.assert_not_called()
        identity_ocr.assert_not_called()
        self.assertEqual(result["final"]["sheetNumber"], "E-1.1")
        self.assertEqual(result["final"]["sheetMappingSource"], "pdf_bookmark")
        self.assertEqual(
            result["final"]["sheetMappingEvidence"],
            [identity.evidence[0].as_dict()],
        )
        self.assertEqual(
            result["deterministic"]["documentStructuralIdentity"],
            identity.as_dict(),
        )

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
            with patch(
                "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                return_value=([], []),
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
            with patch(
                "ecos_indexer.extraction.fixed_visual_tile_ocr_regions",
                return_value=([], []),
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

        self.assertIs(public_region(base)["searchable"], True)
        self.assertIs(public_region({**base, "searchable": True})["searchable"], True)
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
        try:
            with patch("ecos_indexer.extraction.title_block_ocr_regions") as title_ocr:
                with patch("ecos_indexer.extraction.sheet_identity_ocr_regions") as identity_ocr:
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

        title_ocr.assert_not_called()
        identity_ocr.assert_not_called()
        self.assertEqual(result["final"]["sheetNumber"], "L-1")
        self.assertEqual(result["final"]["sheetMappingSource"], "native_title_band")
        self.assertNotEqual(result["final"]["sheetMappingSource"], "pdf_bookmark")
        self.assertEqual(result["final"]["sheetMappingEvidence"], [evidence.as_dict()])
        self.assertEqual(
            result["deterministic"]["documentStructuralIdentity"],
            identity.as_dict(),
        )
        self.assertIn("native_title_band_identity", result["ocr"]["reason"])


if __name__ == "__main__":
    unittest.main()
