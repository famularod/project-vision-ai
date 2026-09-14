"""Read-only source regression; absent customer files are explicitly skipped.

This tests text eligibility, not whether an answer or measurement is correct.
Run the distinct real-drawing answer/proof tests for product acceptance.
"""
import hashlib
import os
import unittest
from pathlib import Path

import pymupdf as fitz
from ecos_indexer.extraction import native_text_is_readable, native_text_regions

SOURCE_ROOT = Path(os.getenv("ECOS_REAL_DRAWING_ROOT", "/nonexistent-private-fixtures"))
SOURCES = (
    ("08A - PLZ CORP - 2375 THIRD STREET - CANOPY 'A'.pdf", "3449c10a40a0524b0409c42a256d3ee8e5455718946896c2c80d113da16e34df"),
    ("08B - PLZ CORP - 2375 THIRD STREET - CANOPY 'B'.pdf", "3da35b7fba15a676d8e40d8682920d4b7fcdf008d95996bfa311f1012b499b44"),
    ("08C - PLZ CORP - 2375 THIRD STREET - CANOPY 'C'.pdf", "7a9624a8466d733f3b1f66f2c44224989d3141749a715f298332da7be7939c7a"),
)


class NativeTextRealDrawingTests(unittest.TestCase):
    @unittest.skipUnless(all((SOURCE_ROOT / name).exists() for name, _ in SOURCES), "Private exact drawing fixtures not supplied")
    def test_invalid_font_text_cannot_become_trusted_embedded_evidence(self):
        for name, expected_sha in SOURCES:
            with self.subTest(document=name):
                path = SOURCE_ROOT / name
                with path.open("rb") as handle:
                    self.assertEqual(hashlib.file_digest(handle, "sha256").hexdigest(), expected_sha)
                with fitz.open(path) as document:
                    rejected = 0
                    retained = 0
                    for page in document:
                        raw_lines = ["".join(span.get("text", "") for span in line.get("spans", []))
                            for block in page.get_text("dict").get("blocks", [])
                            for line in block.get("lines", [])]
                        rejected += sum(not native_text_is_readable(line) for line in raw_lines)
                        regions = native_text_regions(page, page.rect.width, page.rect.height)
                        retained += len(regions)
                        self.assertTrue(all(native_text_is_readable(region["text"]) for region in regions))
                    self.assertGreater(rejected, 0, "Fixture must exercise the observed font failure")
                    self.assertGreater(retained, 0, "Valid sheet labels must remain readable")

