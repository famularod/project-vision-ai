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


class SeamClient:
    """Reads one printed line wherever a tile sees it: whole when the tile
    contains it, otherwise the visible fragment clipped at the tile edge (the
    way an OCR engine reads a label the tile cuts through)."""
    def __init__(self, tiles, line_rect, text, fragment_text):
        self.tiles = list(tiles)
        self.line = line_rect
        self.text = text
        self.fragment_text = fragment_text
        self.calls = 0

    def lines(self, png):
        tile = self.tiles[self.calls]
        self.calls += 1
        visible = fitz.Rect(self.line) & tile
        if visible.is_empty:
            return []
        whole = tile.contains(self.line)
        norm = ((visible.x0 - tile.x0) / tile.width, (visible.y0 - tile.y0) / tile.height,
                (visible.x1 - tile.x0) / tile.width, (visible.y1 - tile.y0) / tile.height)
        return [(self.text if whole else self.fragment_text, *norm, 0.95)]


class TileSeamTest(unittest.TestCase):
    def test_cores_split_every_overlap_so_each_point_has_one_owner(self):
        for width, height in ((42 * 72, 30 * 72), (36 * 72, 24 * 72), (24 * 72, 18 * 72)):
            cores = D.tile_cores(width, height)
            self.assertEqual(len(cores), len(D.page_tiles(width, height)))
            area = sum(c.width * c.height for c in cores.values())
            self.assertAlmostEqual(area, width * height, delta=1.0)
            for x in range(5, int(width), 37):
                for y in range(5, int(height), 41):
                    owners = [c for c in cores.values() if c.x0 < x < c.x1 and c.y0 < y < c.y1]
                    self.assertEqual(len(owners), 1, (width, height, x, y))

    def _publish(self, line_inches):
        width, height = 42 * 72, 30 * 72
        doc, page = blank_page_with_text(width=width, height=height)
        tiles = D.page_tiles(width, height)
        x0, y0, x1, y1 = (v * 72 for v in line_inches)
        client = SeamClient(tiles, fitz.Rect(x0, y0, x1, y1), "SITE AREA: 6.62 ACRES", "SITE AREA: 6.")
        original = D.is_blank
        D.is_blank = lambda page, tile: False
        try:
            regions, record = D.document_ai_regions(page, width, height, [], client, workers=1)
        finally:
            D.is_blank = original
        return [r["text"] for r in regions], record

    def test_a_label_cut_by_one_tile_is_published_once_and_whole(self):
        # Tiles on a 42-inch sheet start at 0, 10, 20 and 30 inches, so the
        # first two overlap from 10 to 12 inches. This label runs past 12.
        texts, record = self._publish((11.5, 5.0, 13.5, 5.15))
        self.assertEqual(texts, ["SITE AREA: 6.62 ACRES"])

    def test_a_label_both_tiles_cut_is_left_out_rather_than_published_in_pieces(self):
        # Longer than the 2-inch overlap: neither tile sees it whole. Missing
        # text is recoverable from the other readings; a fragment such as
        # "SITE AREA: 6." published as searchable text is a wrong value.
        texts, record = self._publish((9.5, 5.0, 13.0, 5.15))
        self.assertEqual(texts, [])
        self.assertEqual(record["droppedAtTileEdge"], 2)

    def test_a_label_the_next_tile_cuts_is_kept_from_the_tile_that_sees_it_whole(self):
        texts, record = self._publish((9.2, 5.0, 11.0, 5.15))
        self.assertEqual(texts, ["SITE AREA: 6.62 ACRES"])
