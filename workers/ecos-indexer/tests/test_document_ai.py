import io
import json
import unittest

import pymupdf as fitz

from ecos_indexer import document_ai as D


def blank_page_with_text(width=42 * 72, height=30 * 72, words=()):
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    for x, y, text in words:
        page.insert_text((x, y), text, fontsize=12)
    return doc, page


class FakeClient:
    """Returns one line per tile, centred in the tile, unless told to fail."""
    def __init__(self, fail_every=0, confidence=0.95):
        self.calls = 0
        self.fail_every = fail_every
        self.confidence = confidence

    def lines(self, png):
        self.calls += 1
        if self.fail_every and self.calls % self.fail_every == 0:
            raise D.DocumentAIUnavailable("HTTPError")
        return [("W8X10 BEAM", 0.45, 0.49, 0.55, 0.51, self.confidence)]


class DocumentAIRegionsTest(unittest.TestCase):
    def test_off_without_a_processor(self):
        doc, page = blank_page_with_text()
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, [], None)
        self.assertEqual(regions, [])
        self.assertEqual(record, {"status": "off"})

    def test_tiles_cover_a_42x30_sheet_with_overlap(self):
        tiles = D.page_tiles(42 * 72, 30 * 72)
        self.assertEqual(len(tiles), 12)
        self.assertAlmostEqual(tiles[-1].x1, 42 * 72)
        self.assertAlmostEqual(tiles[-1].y1, 30 * 72)
        for t in tiles:
            self.assertLessEqual(t.width, D.TILE_POINTS + 1e-6)

    def test_lines_become_page_regions_marked_as_document_ai(self):
        words = [(x * 72, y * 72, "NOTE TEXT") for x in range(2, 40, 6) for y in range(3, 29, 6)]
        doc, page = blank_page_with_text(words=words)
        client = FakeClient()
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, [], client, workers=1)
        self.assertEqual(record["status"], "complete")
        self.assertEqual(record["failedTiles"], 0)
        self.assertTrue(regions)
        for r in regions:
            self.assertEqual(r["source"], D.SOURCE)
            self.assertEqual(r["textOrigin"], D.TEXT_ORIGIN)
            self.assertTrue(0 <= r["x"] <= 1 and 0 <= r["y"] <= 1)
            self.assertGreater(r["width"], 0)
        self.assertEqual(len({r["id"] for r in regions}), len(regions))

    def test_lines_over_exact_pdf_text_are_dropped(self):
        words = [(x * 72, y * 72, "NOTE TEXT") for x in range(2, 40, 6) for y in range(3, 29, 6)]
        doc, page = blank_page_with_text(words=words)
        everywhere = [{"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}]
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, everywhere, FakeClient(), workers=1)
        self.assertEqual(regions, [])
        self.assertGreater(record["droppedOverExactText"], 0)

    def test_low_confidence_lines_are_dropped(self):
        words = [(x * 72, y * 72, "NOTE TEXT") for x in range(2, 40, 6) for y in range(3, 29, 6)]
        doc, page = blank_page_with_text(words=words)
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, [], FakeClient(confidence=0.2), workers=1)
        self.assertEqual(regions, [])
        self.assertGreater(record["droppedLowConfidence"], 0)

    def test_a_failed_tile_is_recorded_not_hidden(self):
        words = [(x * 72, y * 72, "NOTE TEXT") for x in range(2, 40, 6) for y in range(3, 29, 6)]
        doc, page = blank_page_with_text(words=words)
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, [], FakeClient(fail_every=2), workers=1)
        self.assertEqual(record["status"], "partial")
        self.assertGreater(record["failedTiles"], 0)

    def test_blank_tiles_are_not_sent(self):
        doc, page = blank_page_with_text()
        client = FakeClient()
        regions, record = D.document_ai_regions(page, page.rect.width, page.rect.height, [], client, workers=1)
        self.assertEqual(client.calls, 0)
        self.assertEqual(record["tiles"], 0)

    def test_client_parses_the_process_response(self):
        payload = {"document": {"text": "HELLO\nW8X10", "pages": [{"lines": [
            {"layout": {"confidence": 0.9, "textAnchor": {"textSegments": [{"endIndex": "5"}]},
                        "boundingPoly": {"normalizedVertices": [{"x": 0.1, "y": 0.2}, {"x": 0.3, "y": 0.2}, {"x": 0.3, "y": 0.25}, {"x": 0.1, "y": 0.25}]}}},
            {"layout": {"confidence": 0.8, "textAnchor": {"textSegments": [{"startIndex": "6", "endIndex": "11"}]},
                        "boundingPoly": {"normalizedVertices": [{"x": 0.5, "y": 0.5}, {"x": 0.6, "y": 0.52}]}}}]}]}}

        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        seen = {}
        def opener(request, timeout):
            seen["url"] = request.full_url
            seen["auth"] = request.headers.get("Authorization")
            return Response(json.dumps(payload).encode())
        client = D.DocumentAIClient("projects/1/locations/us/processors/abc", lambda: "tok", opener=opener)
        lines = client.lines(b"png")
        self.assertEqual([l[0] for l in lines], ["HELLO", "W8X10"])
        self.assertEqual(lines[0][1:5], (0.1, 0.2, 0.3, 0.25))
        self.assertTrue(seen["url"].endswith("/processors/abc:process"))
        self.assertEqual(seen["auth"], "Bearer tok")

    def test_client_failure_raises_unavailable(self):
        def opener(request, timeout):
            raise OSError("down")
        client = D.DocumentAIClient("projects/1/locations/us/processors/abc", lambda: "tok", opener=opener)
        with self.assertRaises(D.DocumentAIUnavailable):
            client.lines(b"png")

    def test_processor_name_is_validated(self):
        with self.assertRaises(ValueError):
            D.DocumentAIClient("abc", lambda: "tok")


if __name__ == "__main__":
    unittest.main()
