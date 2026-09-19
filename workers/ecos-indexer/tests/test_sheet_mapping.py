import unittest

from ecos_indexer.sheet_mapping import (
    StructuralIdentityEvidence,
    StructuralSheetIdentity,
    map_sheet,
)


class SheetMappingTests(unittest.TestCase):
    def test_prefers_repeated_title_block_identity(self) -> None:
        regions = [
            {"id": "body", "text": "REFER TO DETAIL A2.01", "x": 0.1, "y": 0.1},
            {"id": "title-label", "text": "SHEET NO.", "x": 0.86, "y": 0.78,
             "source": "title_block_ocr"},
            {"id": "title-number", "text": "C 6", "x": 0.91, "y": 0.84,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "C6")
        self.assertGreaterEqual(result["sheetMappingConfidence"], 0.9)

    def test_conflicting_title_block_candidates_fail_closed(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NUMBER", "x": 0.85, "y": 0.75,
             "source": "title_block_ocr"},
            {"id": "a", "text": "C5", "x": 0.9, "y": 0.82, "source": "title_block_ocr"},
            {"id": "b", "text": "C6", "x": 0.9, "y": 0.82, "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "conflicted")
        self.assertIsNone(result["sheetNumber"])

    def test_repeated_fixture_tags_do_not_outscore_sheet_number(self) -> None:
        regions = [
            *(
                {"id": f"fixture-{index}", "text": "F2", "x": 0.55, "y": 0.3}
                for index in range(30)
            ),
            {"id": "label", "text": "SHEET NUMBER", "x": 0.84, "y": 0.79,
             "source": "title_block_ocr"},
            {"id": "sheet", "text": "E — 2.1", "x": 0.88, "y": 0.86,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "E-2.1")

    def test_body_detail_without_title_evidence_is_not_verified(self) -> None:
        regions = [
            {"id": "detail", "text": "REFER TO DETAIL SE-6", "x": 0.78, "y": 0.55},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])

    def test_supports_legacy_multi_prefix_sheet_number(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NUMBER", "x": 0.84, "y": 0.79,
             "source": "title_block_ocr"},
            {"id": "sheet", "text": "X-E-2.4", "x": 0.88, "y": 0.86,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "X-E-2.4")

    def test_rejects_sheet_count_footer_as_page_identity(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NO.", "x": 0.95, "y": 0.89,
             "source": "title_block_ocr"},
            {"id": "footer", "text": "5 OF 8 SHTS", "x": 0.94, "y": 0.93,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])

    def test_exact_sheet_identity_ocr_outranks_sheet_count_footer(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NO.", "x": 0.95, "y": 0.89,
             "source": "title_block_ocr"},
            {"id": "identity", "text": "C5", "x": 0.95, "y": 0.91,
             "source": "sheet_identity_ocr_page_bound_validated"},
            {"id": "footer", "text": "5 OF 8 SHTS", "x": 0.94, "y": 0.93,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "C5")

    def test_title_block_text_without_label_proximity_is_not_identity(self) -> None:
        regions = [
            {"id": "title", "text": "SHEET TITLE", "x": 0.88, "y": 0.74,
             "source": "title_block_ocr"},
            {"id": "noise", "text": "TLE24", "x": 0.92, "y": 0.78,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])

    def test_exact_identity_wins_over_lower_resolution_misread(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NUMBER", "x": 0.89, "y": 0.95,
             "source": "title_block_ocr"},
            {"id": "misread", "text": "F-2.1", "x": 0.95, "y": 0.98,
             "source": "title_block_ocr"},
            {"id": "exact", "text": "E-2.1", "x": 0.95, "y": 0.98,
             "source": "sheet_identity_ocr_page_bound_validated"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "E-2.1")

    def test_pdf_bookmark_identity_outranks_conflicting_outline_ocr(self) -> None:
        regions = [
            {"id": "misread", "text": "F-1.1", "x": 0.95, "y": 0.98,
             "source": "sheet_identity_ocr"},
        ]

        result = map_sheet(
            regions,
            1000,
            800,
            structural_identity=StructuralSheetIdentity(
                sheet_number="E-1.1",
                source="pdf_bookmark",
                evidence=(StructuralIdentityEvidence(
                    evidence_id="pdf-bookmark-1-page-4",
                    page_number=4,
                    source="pdf_bookmark",
                    text="E04-E1.1",
                    normalized_bounds=None,
                ),),
            ),
            page_number=4,
        )

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "E-1.1")
        self.assertEqual(result["sheetMappingSource"], "pdf_bookmark")
        self.assertEqual(
            result["sheetMappingCandidates"][0]["evidenceRegionIds"],
            ["pdf-bookmark-1-page-4"],
        )

    def test_native_title_band_identity_preserves_source_id_and_bounds(self) -> None:
        evidence = StructuralIdentityEvidence(
            evidence_id="native-3-2",
            page_number=2,
            source="embedded_text",
            text="L-2",
            normalized_bounds=(0.95, 0.95, 0.02, 0.02),
        )

        result = map_sheet(
            [],
            1000,
            800,
            structural_identity=StructuralSheetIdentity(
                sheet_number="L-2",
                source="native_title_band",
                evidence=(evidence,),
            ),
            page_number=2,
        )

        self.assertEqual(result["sheetNumber"], "L-2")
        self.assertEqual(result["sheetMappingSource"], "native_title_band")
        self.assertEqual(result["sheetMappingEvidence"], [evidence.as_dict()])
        self.assertEqual(
            result["sheetMappingCandidates"][0]["evidenceRegionIds"],
            ["native-3-2"],
        )

    def test_pdf_annotation_title_band_requires_token_and_adjacent_label_proof(self) -> None:
        token = StructuralIdentityEvidence(
            evidence_id="pdf-annotation-324-page-6",
            page_number=6,
            source="pdf_annotation",
            text="C6",
            normalized_bounds=(0.952546, 0.907986, 0.013889, 0.013889),
            annotation_subtype="Square",
        )
        label = StructuralIdentityEvidence(
            evidence_id="pdf-annotation-210-page-6",
            page_number=6,
            source="pdf_annotation",
            text="SHEET NO.",
            normalized_bounds=(0.946373, 0.893519, 0.02662, 0.009259),
            annotation_subtype="Square",
        )

        result = map_sheet(
            [],
            2592,
            1728,
            structural_identity=StructuralSheetIdentity(
                sheet_number="C6",
                source="pdf_annotation_title_band",
                evidence=(token, label),
            ),
            page_number=6,
        )

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "C6")
        self.assertEqual(result["sheetMappingSource"], "pdf_annotation_title_band")
        self.assertEqual(result["sheetMappingEvidence"], [token.as_dict(), label.as_dict()])

        for label_name, evidence in (
            ("missing-label", (token,)),
            ("wrong-page", (
                token,
                StructuralIdentityEvidence(
                    evidence_id=label.evidence_id,
                    page_number=5,
                    source=label.source,
                    text=label.text,
                    normalized_bounds=label.normalized_bounds,
                    annotation_subtype=label.annotation_subtype,
                ),
            )),
            ("forged-source", (
                StructuralIdentityEvidence(
                    evidence_id=token.evidence_id,
                    page_number=token.page_number,
                    source="embedded_text",
                    text=token.text,
                    normalized_bounds=token.normalized_bounds,
                    annotation_subtype=token.annotation_subtype,
                ),
                label,
            )),
        ):
            with self.subTest(label=label_name):
                rejected = map_sheet(
                    [],
                    2592,
                    1728,
                    structural_identity=StructuralSheetIdentity(
                        sheet_number="C6",
                        source="pdf_annotation_title_band",
                        evidence=evidence,
                    ),
                    page_number=6,
                )
                self.assertEqual(rejected["sheetMappingStatus"], "unverified")
                self.assertIsNone(rejected["sheetNumber"])

    def test_pdf_bookmark_claim_with_native_evidence_fails_closed(self) -> None:
        result = map_sheet(
            [],
            1000,
            800,
            structural_identity=StructuralSheetIdentity(
                sheet_number="L-2",
                source="pdf_bookmark",
                evidence=(StructuralIdentityEvidence(
                    evidence_id="native-3-2",
                    page_number=2,
                    source="embedded_text",
                    text="L-2",
                    normalized_bounds=(0.95, 0.95, 0.02, 0.02),
                ),),
            ),
            page_number=2,
        )

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetMappingSource"])

    def test_pdf_bookmark_claim_without_exact_bookmark_text_fails_closed(self) -> None:
        result = map_sheet(
            [],
            1000,
            800,
            structural_identity=StructuralSheetIdentity(
                sheet_number="E-1.1",
                source="pdf_bookmark",
                evidence=(StructuralIdentityEvidence(
                    evidence_id="pdf-bookmark-1-page-4",
                    page_number=4,
                    source="pdf_bookmark",
                    # A bare sheet token is not an exact publisher bookmark.
                    text="E-1.1",
                    normalized_bounds=None,
                ),),
            ),
            page_number=4,
        )

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetMappingSource"])

    def test_structural_evidence_from_another_page_fails_closed(self) -> None:
        result = map_sheet(
            [],
            1000,
            800,
            structural_identity=StructuralSheetIdentity(
                sheet_number="E-1.1",
                source="pdf_bookmark",
                evidence=(StructuralIdentityEvidence(
                    evidence_id="pdf-bookmark-1-page-4",
                    page_number=4,
                    source="pdf_bookmark",
                    text="E04-E1.1",
                    normalized_bounds=None,
                ),),
            ),
            page_number=5,
        )

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetMappingSource"])

    def test_dedicated_landscape_identity_cell_outranks_footer_code(self) -> None:
        regions = [
            {"id": "identity", "text": "C7", "x": 0.95, "y": 0.91,
             "source": "sheet_identity_ocr_page_bound_validated"},
            {"id": "footer-code", "text": "S1", "x": 0.95, "y": 0.97,
             "source": "sheet_identity_ocr_vertical_outline"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "C7")

    def test_date_above_sheet_label_cannot_become_page_identity(self) -> None:
        regions = [
            {"id": "date", "text": "DATE 06-06-25", "x": 0.887, "y": 0.909,
             "source": "sheet_identity_ocr_landscape_native"},
            {"id": "label", "text": "SHEET NUMBER", "x": 0.887, "y": 0.950,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])
        self.assertNotIn(
            "DATE06",
            [candidate["sheetNumber"] for candidate in result["sheetMappingCandidates"]],
        )

    def test_truncated_architectural_ocr_fails_closed(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NUMBER", "x": 0.887, "y": 0.950,
             "source": "title_block_ocr"},
            {"id": "partial", "text": "A-2", "x": 0.940, "y": 0.956,
             "source": "title_block_ocr"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])

    def test_validated_page_bound_identity_preserves_suffix(self) -> None:
        regions = [{
            "id": "validated",
            "text": "A-2.2A",
            "x": 0.933,
            "y": 0.956,
            "source": "sheet_identity_ocr_page_bound_validated",
        }]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "verified")
        self.assertEqual(result["sheetNumber"], "A-2.2A")

    def test_distant_body_identifier_does_not_bind_to_sheet_label(self) -> None:
        regions = [
            {"id": "label", "text": "SHEET NUMBER", "x": 0.887, "y": 0.950,
             "source": "title_block_ocr"},
            {"id": "detail", "text": "REFER TO A-2.11", "x": 0.42, "y": 0.31,
             "source": "embedded_text"},
        ]

        result = map_sheet(regions, 1000, 800)

        self.assertEqual(result["sheetMappingStatus"], "unverified")
        self.assertIsNone(result["sheetNumber"])


if __name__ == "__main__":
    unittest.main()
