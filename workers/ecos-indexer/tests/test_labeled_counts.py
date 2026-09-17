import copy
import unittest
from unittest.mock import Mock

import pymupdf as fitz

from ecos_indexer.labeled_counts import count_label_targets, reread_labeled_counts


def word(text, x=.2, y=.3, width=.02, height=.005, confidence=.9):
    return dict(id=text, text=text, x=x, y=y, width=width, height=height,
                confidence=confidence, source="fixed_visual_tile_coordinate_ocr", ocrKind="word")


class LabeledCountsTests(unittest.TestCase):
    def read(self, first="125", second="125", *, confidence=.8, shift=0, extras=None):
        label = word("COUNT:")
        targets = count_label_targets([label])
        reader = Mock(side_effect=[
            [word(first, x=.225, confidence=confidence), *(extras or [])],
            [word(second, x=.225 + shift, confidence=.88), *(extras or [])],
        ])
        with fitz.open() as document:
            page = document.new_page(width=1000, height=1000)
            return reread_labeled_counts(page, targets, reader), reader

    def test_agreement_retains_raw_observations_and_actual_confidence(self):
        result, reader = self.read(first="125]", second="125)")
        self.assertEqual(result[0]["text"], "COUNT: 125]")
        self.assertEqual(result[0]["confidence"], .8)
        self.assertEqual([r["text"] for r in result[0]["corroboratingEvidence"]], ["125]", "125)"])
        self.assertEqual([c.kwargs["dpi"] for c in reader.call_args_list], [450, 600])
        self.assertEqual(result[0]["constituentEvidence"][0]["text"], "COUNT:")

    def test_no_digit_correction_or_disagreement_promotion(self):
        for a, b in [("200", "206"), ("2OO", "200"), ("200.5", "200"), ("-200", "200"), ("200SF", "200")]:
            with self.subTest(a=a, b=b):
                self.assertEqual(self.read(first=a, second=b)[0], [])

    def test_low_confidence_and_shifted_numbers_fail_closed(self):
        self.assertEqual(self.read(confidence=.3)[0], [])
        self.assertEqual(self.read(shift=.01)[0], [])

    def test_units_or_another_number_are_not_silently_discarded(self):
        for suffix in ("SF", "PSF", "people", "126"):
            self.assertEqual(self.read(extras=[word(suffix, x=.235)])[0], [])
            self.assertEqual(self.read(extras=[word(suffix, x=.245)])[0], [])

    def test_load_requires_explicit_adjacent_occupancy_label(self):
        load = word("LOAD:", x=.213)
        self.assertEqual(count_label_targets([load]), [])
        self.assertEqual(len(count_label_targets([word("OCC!", width=.01), load])), 1)
        self.assertEqual(count_label_targets([word("OCC!", width=.01, y=.5), load]), [])
        self.assertEqual(count_label_targets([word("DEAD", width=.01), load]), [])

    def test_invalid_or_untrusted_anchor_geometry_is_rejected(self):
        base = word("QTY:")
        for change in ({"x":None}, {"x":True}, {"width":float("nan")}, {"height":0},
                       {"x":.99}, {"confidence":.2}, {"searchable":False}, {"ocrRotationDegrees":90}):
            self.assertEqual(count_label_targets([{**base, **change}]), [])

    def test_targets_are_bounded_and_input_is_not_changed(self):
        regions = [word("COUNT:", y=.1 + i*.03) for i in range(20)]
        before = copy.deepcopy(regions)
        self.assertEqual(len(count_label_targets(regions)), 2)
        self.assertEqual(regions, before)

    def test_oversized_renders_are_rejected_before_ocr(self):
        reader = Mock()
        with fitz.open() as document:
            page = document.new_page(width=20000, height=20000)
            self.assertEqual(reread_labeled_counts(page, count_label_targets([word("QTY")]), reader), [])
        reader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
