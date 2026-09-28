import unittest

import pymupdf as fitz

from ecos_indexer.extraction import extract_page, native_text_regions, public_region
from ecos_indexer.shx_text import SHX_COMMENT_TITLE, shx_comment_regions, shx_comment_text


def page_with_comments(comments, width=2592.0, height=1728.0, rotation=0):
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    for rect, text, title in comments:
        annot = page.add_rect_annot(fitz.Rect(*rect))
        annot.set_info(title=title, content=text)
        annot.update()
    if rotation:
        page.set_rotation(rotation)
    return doc, page


class ShxCommentTextTests(unittest.TestCase):
    def test_autocad_control_codes_become_characters(self):
        self.assertEqual(shx_comment_text("%%UKEYNOTES%%u"), "KEYNOTES")
        self.assertEqual(shx_comment_text("45%%D BEND"), "45° BEND")
        self.assertEqual(shx_comment_text("%%C3/4\" ROD"), "Ø3/4\" ROD")
        self.assertEqual(shx_comment_text("  6.62   ACRES "), "6.62 ACRES")

    def test_only_autocad_shx_comments_are_read_exactly_and_as_the_pdfs_own_text(self):
        doc, page = page_with_comments([
            ((100, 100, 160, 112), "SITE AREA:", SHX_COMMENT_TITLE),
            ((165, 100, 240, 112), "6.62 ACRES", SHX_COMMENT_TITLE),
            ((100, 300, 200, 312), "20'-0\" CLEAR", SHX_COMMENT_TITLE),
            ((400, 400, 500, 412), "reviewer markup", "Mobile User"),
        ])
        regions = shx_comment_regions(page, page.rect.width, page.rect.height)
        texts = [r["text"] for r in regions]
        self.assertIn("6.62 ACRES", texts)
        self.assertIn("20'-0\" CLEAR", texts)
        self.assertNotIn("reviewer markup", texts)
        # comments on one printed line are also joined, in reading order
        self.assertIn("SITE AREA: 6.62 ACRES", texts)
        for r in regions:
            self.assertEqual(r["source"], "embedded_text")
            self.assertEqual(r["textOrigin"], "autocad_shx_comment")
            self.assertEqual(r["confidence"], 0.99)
            self.assertTrue(0 <= r["x"] <= 1 and 0 <= r["y"] <= 1 and r["x"] + r["width"] <= 1.000001)
        joined = next(r for r in regions if r["text"] == "SITE AREA: 6.62 ACRES")
        first = next(a for a in page.annots() if a.info["content"] == "SITE AREA:")
        self.assertAlmostEqual(joined["x"], first.rect.x0 / page.rect.width, places=6)
        doc.close()

    def test_vertical_labels_are_not_joined_into_one_made_up_string(self):
        # Two rotated labels whose tall boxes sit 88 pt apart on the same band.
        doc, page = page_with_comments([
            ((100, 100, 112, 260), "EAST PROPERTY LINE", SHX_COMMENT_TITLE),
            ((200, 100, 212, 260), "10' UTILITY EASEMENT", SHX_COMMENT_TITLE),
        ])
        texts = [r["text"] for r in shx_comment_regions(page, page.rect.width, page.rect.height)]
        self.assertIn("EAST PROPERTY LINE", texts)
        self.assertIn("10' UTILITY EASEMENT", texts)
        self.assertNotIn("EAST PROPERTY LINE 10' UTILITY EASEMENT", texts)
        doc.close()

    def test_a_large_title_is_not_joined_to_small_text_beside_it(self):
        doc, page = page_with_comments([
            ((100, 100, 300, 130), "SITE PLAN", SHX_COMMENT_TITLE),
            ((310, 110, 380, 120), "SCALE: 1\"=20'", SHX_COMMENT_TITLE),
        ])
        texts = [r["text"] for r in shx_comment_regions(page, page.rect.width, page.rect.height)]
        self.assertNotIn("SITE PLAN SCALE: 1\"=20'", texts)
        doc.close()

    def test_words_on_different_lines_are_not_joined(self):
        doc, page = page_with_comments([
            ((100, 100, 160, 112), "FOOTING", SHX_COMMENT_TITLE),
            ((100, 130, 160, 142), "24\" WIDE", SHX_COMMENT_TITLE),
        ])
        texts = [r["text"] for r in shx_comment_regions(page, page.rect.width, page.rect.height)]
        self.assertNotIn("FOOTING 24\" WIDE", texts)
        doc.close()

    def test_rotated_pages_use_displayed_coordinates(self):
        doc, page = page_with_comments([((100, 100, 200, 112), "NOTE 7", SHX_COMMENT_TITLE)], rotation=90)
        w, h = page.rect.width, page.rect.height  # displayed (rotated) size
        [region] = shx_comment_regions(page, w, h)
        # annot.rect is in unrotated page space (checked against the drawn box)
        expected = fitz.Rect(next(page.annots()).rect) * page.rotation_matrix
        self.assertAlmostEqual(region["x"], expected.x0 / w, places=6)
        self.assertAlmostEqual(region["y"], expected.y0 / h, places=6)
        doc.close()

    def test_a_page_without_comments_is_unchanged(self):
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), "PLAIN TEXT", fontsize=12)
        self.assertEqual(shx_comment_regions(page, page.rect.width, page.rect.height), [])
        self.assertEqual([r["text"] for r in native_text_regions(page, 612, 792)], ["PLAIN TEXT"])
        doc.close()

    def test_extract_page_publishes_the_shx_text_as_searchable_text_with_its_origin(self):
        doc, page = page_with_comments([
            ((300, 300, 380, 312), "SITE AREA:", SHX_COMMENT_TITLE),
            ((385, 300, 470, 312), "6.62 ACRES", SHX_COMMENT_TITLE),
        ], width=36 * 72, height=24 * 72)
        result = extract_page(page, "0" * 64, project_id="p", evidence_version="test")
        final = result["final"]
        self.assertIn("6.62 ACRES", final["text"])
        shx = [r for r in final["regions"] if r.get("textOrigin") == "autocad_shx_comment"]
        self.assertTrue(shx)
        self.assertTrue(all(r["searchable"] is True and r["source"] == "embedded_text" for r in shx))
        self.assertEqual(public_region({"id": "a", "text": "x", "textOrigin": "autocad_shx_comment"})["textOrigin"],
                         "autocad_shx_comment")
        doc.close()


if __name__ == "__main__":
    unittest.main()
