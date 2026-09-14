import unittest
import pymupdf as fitz
from ecos_indexer.visual import crop_page, visual_read_scale


class VisualResolutionScaleTests(unittest.TestCase):
    def test_tiny_drawing_text_is_magnified_and_large_crops_are_bounded(self):
        with fitz.open() as document:
            page = document.new_page(width=792, height=612)
            small = {"x": .49, "y": .76, "width": .02, "height": .01}
            self.assertEqual(visual_read_scale(page, small), 24)
            image = fitz.Pixmap(crop_page(page, small, scale=visual_read_scale(page, small)))
            self.assertGreater(image.height, 140)
            large = {"x": 0, "y": 0, "width": 1, "height": 1}
            image = fitz.Pixmap(crop_page(page, large, scale=visual_read_scale(page, large)))
            self.assertLessEqual(max(image.width, image.height), 1537)
            page.set_rotation(90)
            image = fitz.Pixmap(crop_page(page, large, scale=visual_read_scale(page, large)))
            self.assertLessEqual(max(image.width, image.height), 1537)
