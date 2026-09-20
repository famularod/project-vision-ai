import hashlib
import os
import unittest
from pathlib import Path

import pymupdf as fitz

from ecos_indexer.document_structure import (
    document_sheet_identity_map,
    parse_bookmark_sheet_number,
    sheet_number_map,
)
from ecos_indexer.extraction import native_text_regions
from ecos_indexer.sheet_mapping import map_sheet


SOURCE_DIRECTORY = Path(os.getenv(
    "ECOS_2321_REGRESSION_DIRECTORY",
    str(
        Path.home()
        / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
        / "2321 approved"
    ),
))

SOURCES = {
    "01 - PLZ CORP - 2321 THIRD STREET - ARCHITECTURAL.pdf": {
        "sha256": "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb",
        "pages": {14: "A-1.5", 15: "A-1.5A"},
    },
    "03 - PLZ CORP - 2321 THIRD STREET - STRUCTURAL.pdf": {
        "sha256": "db676ce857951ace78ed6dd2af0ceeafa29e1cf7664d187bd9f212fa02512840",
        "pages": {2: "SB-1.1"},
    },
    "04 - PLZ CORP - 2321 THIRD STREET - MECHANICAL.pdf": {
        "sha256": "b77bc0725e5cd28017dfab8c7ab1a0356898a676e941d1ca420a9dcbabc88884",
        "pages": {2: "MB-1.2"},
    },
    "05 - PLZ CORP - 2321 THIRD STREET - PLUMBING.pdf": {
        "sha256": "b098fe54ea96aa02e8792df76c61e5825d4aafd38588fe03bea21d98c4a242b0",
        "pages": {2: "PB-1.2"},
    },
    "06 - PLZ CORP - 2321 THIRD STREET - ELECTRICAL.pdf": {
        "sha256": "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77",
        "pages": {11: "E-2.5", 13: "E-2.7"},
    },
    "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf": {
        "sha256": "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3",
        "pages": {1: "L-1", 2: "L-2", 4: "L-4"},
    },
}


def _exact_pinned_sources_present() -> bool:
    """Are the exact pinned benchmark PDFs on this machine?

    Existence alone is not enough. Every assertion in this class is written
    against one specific revision of each drawing set, identified by sha256, and
    the whole class is named for that. When a file exists but its content differs
    — a re-issued drawing set, a re-export, a different customer copy — these
    tests are INAPPLICABLE, not failing. Checking existence only (the previous
    guard) meant a changed source produced three hard failures that looked like
    code regressions and blocked gate layer 6, when nothing in the code had moved.
    """
    for filename, contract in SOURCES.items():
        path = SOURCE_DIRECTORY / filename
        if not path.exists():
            return False
        if hashlib.sha256(path.read_bytes()).hexdigest() != contract["sha256"]:
            return False
    return True


@unittest.skipUnless(
    _exact_pinned_sources_present(),
    "Exact sha-pinned issued 2321 benchmark PDFs are not present on this machine "
    "(absent, or a different revision than the one these assertions pin).",
)
class Exact2321SheetMappingTests(unittest.TestCase):
    def test_ten_benchmark_pages_map_from_exact_sha_pinned_sources(self) -> None:
        checked_pages = 0
        for filename, contract in SOURCES.items():
            with self.subTest(filename=filename):
                path = SOURCE_DIRECTORY / filename
                payload = path.read_bytes()
                self.assertEqual(
                    hashlib.sha256(payload).hexdigest(),
                    contract["sha256"],
                    f"Issued 2321 regression source changed: {filename}",
                )
                document = fitz.open(stream=payload, filetype="pdf")
                try:
                    structural_map = document_sheet_identity_map(document)
                    for page_number, expected_sheet in contract["pages"].items():
                        with self.subTest(
                            filename=filename,
                            page_number=page_number,
                            expected_sheet=expected_sheet,
                        ):
                            checked_pages += 1
                            identity = structural_map.get(page_number)
                            self.assertIsNotNone(identity)
                            assert identity is not None
                            self.assertEqual(
                                identity.sheet_number,
                                expected_sheet,
                            )
                            page = document[page_number - 1]
                            mapping = map_sheet(
                                [],
                                float(page.rect.width),
                                float(page.rect.height),
                                structural_identity=identity,
                                page_number=page_number,
                            )
                            self.assertEqual(mapping["sheetMappingStatus"], "verified")
                            self.assertEqual(mapping["sheetNumber"], expected_sheet)
                            expected_source = (
                                "native_title_band"
                                if "LANDSCAPE" in filename
                                else "pdf_bookmark"
                            )
                            self.assertEqual(mapping["sheetMappingSource"], expected_source)
                            self.assertEqual(
                                mapping["sheetMappingEvidence"],
                                [item.as_dict() for item in identity.evidence],
                            )
                            if expected_source == "pdf_bookmark":
                                toc_entries = [
                                    str(entry[1])
                                    for entry in document.get_toc(simple=True)
                                    if int(entry[2]) == page_number
                                ]
                                for evidence in identity.evidence:
                                    self.assertIn(evidence.text, toc_entries)
                                    self.assertEqual(
                                        parse_bookmark_sheet_number(evidence.text),
                                        expected_sheet,
                                    )
                                    self.assertIsNone(evidence.normalized_bounds)
                            else:
                                native_regions = {
                                    region["id"]: region
                                    for region in native_text_regions(
                                        page,
                                        float(page.rect.width),
                                        float(page.rect.height),
                                    )
                                }
                                for evidence in identity.evidence:
                                    self.assertEqual(evidence.source, "embedded_text")
                                    self.assertIsNotNone(evidence.normalized_bounds)
                                    self.assertIn(evidence.evidence_id, native_regions)
                                    self.assertEqual(
                                        native_regions[evidence.evidence_id]["text"],
                                        evidence.text,
                                    )
                finally:
                    document.close()

        self.assertEqual(checked_pages, 10)

    def test_exact_landscape_source_requires_unique_title_band_token_on_every_page(self) -> None:
        contract = SOURCES["07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf"]
        path = SOURCE_DIRECTORY / "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf"
        payload = path.read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), contract["sha256"])
        document = fitz.open(stream=payload, filetype="pdf")
        try:
            self.assertEqual(document.page_count, 6)
            identity_map = document_sheet_identity_map(document)
            self.assertEqual(sheet_number_map(identity_map), {
                1: "L-1",
                2: "L-2",
                3: "L-3",
                4: "L-4",
                5: "L-5",
                6: "L-6",
            })
            self.assertTrue(identity_map)
            for page_number, identity in identity_map.items():
                self.assertEqual(identity.source, "native_title_band")
                self.assertEqual(len(identity.evidence), 1)
                evidence = identity.evidence[0]
                self.assertEqual(evidence.page_number, page_number)
                self.assertEqual(evidence.source, "embedded_text")
                self.assertIsNotNone(evidence.normalized_bounds)
        finally:
            document.close()


if __name__ == "__main__":
    unittest.main()
