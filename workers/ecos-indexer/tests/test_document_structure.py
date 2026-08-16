import hashlib
import unittest
import time
from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz

from ecos_indexer.document_structure import (
    document_sheet_identity_map,
    pdf_annotation_title_band_identities_for_page,
    parse_bookmark_sheet_number,
    sheet_number_map,
)
from ecos_indexer.sheet_mapping import map_sheet
from ecos_indexer.resource_limits import DocumentResourceRejected


class FakeDocument:
    page_count = 20

    def __init__(self, entries):
        self.entries = entries

    def get_toc(self, *, simple=True):
        return self.entries


class FakeNativePage:
    rect = fitz.Rect(0, 0, 1000, 1000)
    rotation = 0

    def __init__(self, lines):
        self.lines = lines

    def get_text(self, kind, *, flags=None):
        self.assertions = (kind, flags)
        return {
            "blocks": [{
                "type": 0,
                "lines": [{
                    "bbox": bbox,
                    "spans": [{"text": text}],
                } for text, bbox in self.lines],
            }],
        }


class FakeRotatedNativePage(FakeNativePage):
    rect = fitz.Rect(0, 0, 792, 612)
    rotation = 90
    rotation_matrix = fitz.Matrix(0, 1, -1, 0, 792, 0)


class FakeNativeDocument:
    def __init__(self, pages, entries=None):
        self.pages = pages
        self.page_count = len(pages)
        self.entries = entries or []

    def get_toc(self, *, simple=True):
        return self.entries

    def load_page(self, page_index):
        return self.pages[page_index]


IDENTITY_BOX = (700, 780, 800, 810)
OUTSIDE_IDENTITY_BOX = (700, 700, 800, 730)
LANDSCAPE_IDENTITY_BOX = (950, 950, 970, 970)
OUTSIDE_LANDSCAPE_IDENTITY_BOX = (850, 850, 880, 880)
STREET_IMPROVEMENT_PDF = (
    Path.home()
    / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
    / "2375 Approved/02B - PLZ CORP - 2375 THIRD STREET - STREET IMPROVEMENT PLANS.pdf"
)
STREET_IMPROVEMENT_SHA256 = (
    "77619970ab0a9f1c1928f670e8ac31076d51a4749e51efa1318e9d3a205571c5"
)
CIVIL_PDF = (
    Path.home()
    / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
    / "2375 Approved/02A - PLZ CORP - 2375 THIRD STREET - CIVIL.pdf"
)
CIVIL_SHA256 = "eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01"


class FakeAnnotation:
    def __init__(self, text, rect, *, kind="Square", next_annotation=None):
        self.info = {"content": text}
        self.rect = fitz.Rect(*rect)
        self.type = (4, kind)
        self.next = next_annotation


class FakeAnnotationPage:
    rect = fitz.Rect(0, 0, 1000, 1000)
    rotation = 0

    def __init__(self, annotations):
        next_annotation = None
        for annotation in reversed(annotations):
            annotation.next = next_annotation
            next_annotation = annotation
        self.first_annot = next_annotation


class DocumentStructureTests(unittest.TestCase):
    def annotation_page(self, *, token="C6", label="SHEET NO.", extras=()):
        return FakeAnnotationPage([
            FakeAnnotation(token, (952, 908, 966, 922)),
            FakeAnnotation(label, (946, 894, 973, 903)),
            *extras,
        ])

    def test_whole_document_structural_scan_has_a_hard_deadline(self) -> None:
        class SlowDocument:
            page_count = 2

            @staticmethod
            def get_toc(*, simple=True):
                time.sleep(0.05)
                return []

        with patch(
            "ecos_indexer.resource_limits.STRUCTURAL_SCAN_TIMEOUT_SECONDS",
            0.01,
        ):
            with self.assertRaisesRegex(
                DocumentResourceRejected,
                "pdf_structural_scan_timeout",
            ):
                document_sheet_identity_map(SlowDocument())

    def test_accepts_exact_pdf_annotation_title_cell_with_adjacent_label(self) -> None:
        identities = pdf_annotation_title_band_identities_for_page(
            self.annotation_page(),
            6,
        )

        self.assertEqual(len(identities), 1)
        identity = identities[0]
        self.assertEqual(identity.sheet_number, "C6")
        self.assertEqual(identity.source, "pdf_annotation_title_band")
        self.assertEqual([item.source for item in identity.evidence], [
            "pdf_annotation", "pdf_annotation",
        ])
        self.assertEqual(
            [item.annotation_subtype for item in identity.evidence],
            ["Square", "Square"],
        )
        self.assertEqual([item.text for item in identity.evidence], ["C6", "SHEET NO."])
        self.assertTrue(all(item.page_number == 6 for item in identity.evidence))

    def test_rejects_missing_duplicate_conflicted_off_band_or_non_square_annotations(self) -> None:
        cases = {
            "missing-label": FakeAnnotationPage([
                FakeAnnotation("C6", (952, 908, 966, 922)),
            ]),
            "duplicate-token": self.annotation_page(extras=(
                FakeAnnotation("C6", (953, 909, 967, 923)),
            )),
            "conflicting-token": self.annotation_page(extras=(
                FakeAnnotation("C7", (953, 909, 967, 923)),
            )),
            "off-band-token": FakeAnnotationPage([
                FakeAnnotation("C6", (500, 500, 520, 520)),
                FakeAnnotation("SHEET NO.", (946, 894, 973, 903)),
            ]),
            "off-band-label": FakeAnnotationPage([
                FakeAnnotation("C6", (952, 908, 966, 922)),
                FakeAnnotation("SHEET NO.", (500, 500, 550, 520)),
            ]),
            "non-square-token": FakeAnnotationPage([
                FakeAnnotation("C6", (952, 908, 966, 922), kind="FreeText"),
                FakeAnnotation("SHEET NO.", (946, 894, 973, 903)),
            ]),
        }
        for label, page in cases.items():
            with self.subTest(label=label):
                self.assertEqual(
                    pdf_annotation_title_band_identities_for_page(page, 6),
                    [],
                )

    def test_parses_observed_electrical_bookmark_identities(self) -> None:
        expected = {
            "E01-E0.0": "E-0.0",
            "E04-E1.1": "E-1.1",
            "E13-E2.7": "E-2.7",
            "E14-XE0.1": "X-E-0.1",
            "E20-XE2.4": "X-E-2.4",
        }

        for title, sheet_number in expected.items():
            with self.subTest(title=title):
                self.assertEqual(parse_bookmark_sheet_number(title), sheet_number)

    def test_parses_2321_discipline_bookmarks_with_canonical_dashes(self) -> None:
        expected = {
            "A12-A1.5": "A-1.5",
            "A12A-A1.5A": "A-1.5A",
            "S02-SB1.1": "SB-1.1",
            "M02-MB1.2": "MB-1.2",
            "P02-PB1.2": "PB-1.2",
        }

        for title, sheet_number in expected.items():
            with self.subTest(title=title):
                self.assertEqual(parse_bookmark_sheet_number(title), sheet_number)

    def test_misdirected_unapproved_publisher_suffix_remains_rejected(self) -> None:
        # The exact 2321 Architectural outline points this entry at PDF page 1,
        # where it conflicts with A0.0.  Only the observed inserted-sheet ``A``
        # publisher suffix is trusted by the structural parser.
        self.assertIsNone(parse_bookmark_sheet_number("A11B-A1.4B"))

    def test_parses_exact_street_improvement_structural_bookmarks(self) -> None:
        self.assertEqual(parse_bookmark_sheet_number("SIP SHT 1--"), "SIP-SHT-1")
        self.assertEqual(parse_bookmark_sheet_number("SIP SHT 2--"), "SIP-SHT-2")

    def test_rejects_generic_or_malformed_street_improvement_bookmarks(self) -> None:
        for title in (
            "Sheet 1",
            "SHEET 1 OF 2",
            "SIP SHT 1",
            "SIP SHT 1-",
            "SIP SHT 01--",
            "SIP SHT A--",
            "SIP SHT 1-- Street Plan",
            "SIP PLAN 1--",
            "1--",
        ):
            with self.subTest(title=title):
                self.assertIsNone(parse_bookmark_sheet_number(title))

    def test_conflicting_street_improvement_page_bookmarks_fail_closed(self) -> None:
        document = FakeDocument([
            [1, "SIP SHT 1--", 1],
            [2, "SIP SHT 2--", 1],
            [1, "SIP SHT 2--", 2],
        ])

        self.assertEqual(sheet_number_map(document_sheet_identity_map(document)), {
            2: "SIP-SHT-2",
        })

    @unittest.skipUnless(
        STREET_IMPROVEMENT_PDF.exists(),
        "Exact 2375 Street Improvement source PDF is not present on this machine.",
    )
    def test_exact_2375_street_improvement_pdf_maps_both_pages(self) -> None:
        self.assertEqual(
            hashlib.sha256(STREET_IMPROVEMENT_PDF.read_bytes()).hexdigest(),
            STREET_IMPROVEMENT_SHA256,
        )

        document = fitz.open(STREET_IMPROVEMENT_PDF)
        try:
            self.assertEqual(document.page_count, 2)
            structural_entries = [
                entry
                for entry in document.get_toc(simple=True)
                if str(entry[1]).startswith("SIP SHT ")
            ]
            self.assertEqual(structural_entries, [
                [1, "SIP SHT 1--", 1],
                [1, "SIP SHT 2--", 2],
            ])
            structural_map = document_sheet_identity_map(document)
            self.assertEqual(sheet_number_map(structural_map), {
                1: "SIP-SHT-1",
                2: "SIP-SHT-2",
            })
            for page_number, identity in structural_map.items():
                with self.subTest(page_number=page_number):
                    mapping = map_sheet(
                        [],
                        document[page_number - 1].rect.width,
                        document[page_number - 1].rect.height,
                        structural_identity=identity,
                        page_number=page_number,
                    )
                    # Bookmark text is only a structural candidate. The
                    # extraction boundary must attach independent same-page
                    # rendered OCR before it may become verified identity.
                    self.assertEqual(mapping["sheetMappingStatus"], "unverified")
                    self.assertIsNone(mapping["sheetNumber"])
                    self.assertIsNone(mapping["sheetMappingSource"])
        finally:
            document.close()

    @unittest.skipUnless(
        CIVIL_PDF.exists(),
        "Exact 2375 Civil source PDF is not present on this machine.",
    )
    def test_exact_2375_civil_pdf_discovers_all_annotation_title_cell_candidates(self) -> None:
        self.assertEqual(hashlib.sha256(CIVIL_PDF.read_bytes()).hexdigest(), CIVIL_SHA256)

        document = fitz.open(CIVIL_PDF)
        try:
            identity_map = document_sheet_identity_map(document)
            self.assertEqual(sheet_number_map(identity_map), {
                page_number: f"C{page_number}"
                for page_number in range(1, 9)
            })
            for page_number, identity in identity_map.items():
                with self.subTest(page_number=page_number):
                    self.assertEqual(identity.source, "pdf_annotation_title_band")
                    self.assertEqual(len(identity.evidence), 2)
                    self.assertEqual(
                        [item.source for item in identity.evidence],
                        ["pdf_annotation", "pdf_annotation"],
                    )
                    mapping = map_sheet(
                        [],
                        document[page_number - 1].rect.width,
                        document[page_number - 1].rect.height,
                        structural_identity=identity,
                        page_number=page_number,
                    )
                    # Annotation /Contents is only a prescan candidate. It
                    # cannot cross the verified mapping boundary until the
                    # producer binds both token and label to rendered OCR.
                    self.assertEqual(mapping["sheetMappingStatus"], "unverified")
                    self.assertIsNone(mapping["sheetNumber"])
                    self.assertIsNone(mapping["sheetMappingSource"])
        finally:
            document.close()

    def test_ignores_prose_and_nested_layout_bookmarks(self) -> None:
        for title in ("Sheets and Views", "Layout1", "EXTERIOR LIGHTING PLAN", "E-2.7"):
            with self.subTest(title=title):
                self.assertIsNone(parse_bookmark_sheet_number(title))

    def test_builds_page_map_and_accepts_agreeing_duplicate_bookmarks(self) -> None:
        document = FakeDocument([
            [1, "E01-E0.0", 1],
            [1, "E04-E1.1", 4],
            [2, "E04-E1.1", 4],
            [2, "Layout1", 10],
        ])

        identity_map = document_sheet_identity_map(document)
        self.assertEqual(sheet_number_map(identity_map), {
            1: "E-0.0",
            4: "E-1.1",
        })
        identity = identity_map[4]
        self.assertEqual(identity.source, "pdf_bookmark")
        self.assertEqual(
            [evidence.text for evidence in identity.evidence],
            ["E04-E1.1", "E04-E1.1"],
        )
        self.assertTrue(all(
            evidence.source == "pdf_bookmark"
            and evidence.page_number == 4
            and evidence.normalized_bounds is None
            for evidence in identity.evidence
        ))

    def test_conflicting_page_bookmarks_fail_closed(self) -> None:
        document = FakeDocument([
            [1, "E04-E1.1", 4],
            [1, "E05-E1.2", 4],
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_exact_native_canopy_series_preserves_observed_page_identities(self) -> None:
        fixtures = {
            "A": (("WPA - 1", 1), ("WPA – 4", 4), ("WPA—30", 30)),
            "B": (("WPB - 2", 2), ("WPB – 7", 7), ("WPB—99", 99)),
            "C": (("WPC - 3", 3), ("WPC – 8", 8), ("WPC—100", 100)),
        }

        for family, tokens in fixtures.items():
            with self.subTest(family=family):
                document = FakeNativeDocument([
                    FakeNativePage([(token, IDENTITY_BOX)])
                    for token, _ in tokens
                ])
                self.assertEqual(sheet_number_map(document_sheet_identity_map(document)), {
                    page_number: f"WP{family}-{number}"
                    for page_number, (_, number) in enumerate(tokens, start=1)
                })

    def test_multiple_native_tokens_on_one_page_reject_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
            FakeNativePage([
                ("WPA - 2", IDENTITY_BOX),
                ("WPA - 22", (810, 780, 900, 810)),
            ]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_native_family_mismatch_rejects_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
            FakeNativePage([("WPB - 2", IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_missing_native_page_token_rejects_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
            FakeNativePage([("ANCHOR ROD PLAN", IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_duplicate_canonical_identity_rejects_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 01", IDENTITY_BOX)]),
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_exp_date_lone_a2_and_out_of_band_identity_are_not_candidates(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([
                ("EXP - 10", IDENTITY_BOX),
                ("08/08/2026", IDENTITY_BOX),
                ("A2", IDENTITY_BOX),
                ("WPA - 99", OUTSIDE_IDENTITY_BOX),
                ("WPA - 7", IDENTITY_BOX),
            ]),
            FakeNativePage([("WPA - 11", IDENTITY_BOX)]),
        ])

        self.assertEqual(sheet_number_map(document_sheet_identity_map(document)), {
            1: "WPA-7",
            2: "WPA-11",
        })

    def test_single_page_native_token_is_not_used_as_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_rotated_native_title_band_is_normalized_before_validation(self) -> None:
        document = FakeNativeDocument([
            FakeRotatedNativePage([("WPA - 1", (492, 18, 498, 33))]),
            FakeRotatedNativePage([("WPA - 4", (492, 18, 498, 33))]),
        ])

        self.assertEqual(sheet_number_map(document_sheet_identity_map(document)), {
            1: "WPA-1",
            2: "WPA-4",
        })

    def test_existing_bookmark_mapping_is_preserved_on_native_conflict(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("WPA - 1", IDENTITY_BOX)]),
            FakeNativePage([("WPA - 2", IDENTITY_BOX)]),
        ], entries=[[1, "E01-E0.0", 1]])

        self.assertEqual(
            sheet_number_map(document_sheet_identity_map(document)),
            {1: "E-0.0"},
        )

    def test_exact_native_landscape_series_preserves_page_bound_identities(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("L-6", LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([("L – 2", LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([("L—4", LANDSCAPE_IDENTITY_BOX)]),
        ])

        # Deliberately non-ordinal values prove the map uses each page's own
        # title-band token instead of manufacturing L-1/L-2/L-3 from order.
        identity_map = document_sheet_identity_map(document)
        self.assertEqual(sheet_number_map(identity_map), {
            1: "L-6",
            2: "L-2",
            3: "L-4",
        })
        identity = identity_map[2]
        self.assertEqual(identity.source, "native_title_band")
        self.assertEqual(len(identity.evidence), 1)
        evidence = identity.evidence[0]
        self.assertEqual(evidence.evidence_id, "native-0-0")
        self.assertEqual(evidence.page_number, 2)
        self.assertEqual(evidence.source, "embedded_text")
        self.assertEqual(evidence.text, "L – 2")
        self.assertIsNotNone(evidence.normalized_bounds)
        assert evidence.normalized_bounds is not None
        for actual, expected in zip(
            evidence.normalized_bounds,
            (0.95, 0.95, 0.02, 0.02),
        ):
            self.assertAlmostEqual(actual, expected)

        mapping = map_sheet(
            [],
            1000,
            1000,
            structural_identity=identity,
            page_number=2,
        )
        # Embedded title-band text is likewise only a prescan candidate; a
        # rendered title-cell observation promotes it later in extraction.
        self.assertEqual(mapping["sheetMappingStatus"], "unverified")
        self.assertIsNone(mapping["sheetMappingSource"])
        self.assertEqual(mapping["sheetMappingEvidence"], [])

    def test_missing_native_landscape_page_token_rejects_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("L-1", LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([("PLANTING PLAN", LANDSCAPE_IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_duplicate_native_landscape_identity_rejects_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("L-1", LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([("L-1", LANDSCAPE_IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_conflicting_native_landscape_page_tokens_reject_entire_fallback(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("L-1", LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([
                ("L-2", LANDSCAPE_IDENTITY_BOX),
                ("L-22", (940, 940, 960, 960)),
            ]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})

    def test_out_of_band_landscape_tokens_do_not_create_page_identity(self) -> None:
        document = FakeNativeDocument([
            FakeNativePage([("L-1", OUTSIDE_LANDSCAPE_IDENTITY_BOX)]),
            FakeNativePage([("L-2", OUTSIDE_LANDSCAPE_IDENTITY_BOX)]),
        ])

        self.assertEqual(document_sheet_identity_map(document), {})


if __name__ == "__main__":
    unittest.main()
