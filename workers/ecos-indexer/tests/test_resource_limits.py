import multiprocessing
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pymupdf as fitz

from ecos_indexer.extraction import open_pdf
from ecos_indexer.resource_limits import (
    DocumentResourceRejected,
    bounded_drawing_shapes,
    bounded_page_render_png,
    bounded_text_dictionary,
    run_isolated_pdf_operation,
)


def stalled_decoder(*_args, **_kwargs):
    time.sleep(1)


def crashed_decoder(*_args, **_kwargs):
    os._exit(23)


class ResourceLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        source = fitz.open()
        page = source.new_page(width=612, height=792)
        page.insert_text((72, 72), "6 INCH PCC")
        self.pdf_bytes = source.tobytes()
        source.close()

    def assert_no_new_children(self, original_pids: set[int]) -> None:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            active = {
                child.pid for child in multiprocessing.active_children()
                if child.pid is not None and child.is_alive()
            }
            if active <= original_pids:
                return
            time.sleep(0.01)
        self.fail("isolated PDF decoder child was not cleaned up")

    def test_untrusted_text_and_vector_decodes_complete_in_isolated_child(self) -> None:
        document = open_pdf(self.pdf_bytes)
        try:
            page = document.load_page(0)
            text = bounded_text_dictionary(page, flags=fitz.TEXTFLAGS_TEXT)
            drawings = bounded_drawing_shapes(page)
        finally:
            document.close()

        self.assertEqual(text["blocks"][0]["lines"][0]["spans"][0]["text"], "6 INCH PCC")
        self.assertEqual(drawings, [])

    def test_parent_never_enumerates_untrusted_page_objects_before_isolation(self) -> None:
        parent = SimpleNamespace(
            page_count=1,
            _ecos_source_bytes=self.pdf_bytes,
            xref_length=Mock(side_effect=AssertionError("parent xref traversal started")),
        )
        page = SimpleNamespace(
            parent=parent,
            number=0,
            get_contents=Mock(side_effect=AssertionError("parent page traversal started")),
            get_xobjects=Mock(side_effect=AssertionError("parent page traversal started")),
            get_images=Mock(side_effect=AssertionError("parent page traversal started")),
            get_text=Mock(side_effect=AssertionError("parent text decode started")),
            get_drawings=Mock(side_effect=AssertionError("parent vector decode started")),
        )

        text = bounded_text_dictionary(page, flags=fitz.TEXTFLAGS_TEXT)
        drawings = bounded_drawing_shapes(page)

        self.assertEqual(text["blocks"][0]["lines"][0]["spans"][0]["text"], "6 INCH PCC")
        self.assertEqual(drawings, [])
        parent.xref_length.assert_not_called()
        page.get_contents.assert_not_called()
        page.get_xobjects.assert_not_called()
        page.get_images.assert_not_called()
        page.get_text.assert_not_called()
        page.get_drawings.assert_not_called()

    def test_render_pixel_budget_rejects_before_parent_render_and_inside_child(self) -> None:
        page = SimpleNamespace(
            get_pixmap=Mock(side_effect=AssertionError("oversized parent render started")),
        )
        with self.assertRaisesRegex(
            DocumentResourceRejected,
            "pdf_ocr_render_pixels_outside_limit",
        ):
            bounded_page_render_png(
                page,
                clip=fitz.Rect(0, 0, 20_000, 20_000),
                dpi=240,
            )
        page.get_pixmap.assert_not_called()

        with self.assertRaisesRegex(
            DocumentResourceRejected,
            "pdf_ocr_render_pixels_outside_limit",
        ):
            run_isolated_pdf_operation(
                ("bytes", self.pdf_bytes),
                "render",
                page_number=0,
                clip=[0, 0, 20_000, 20_000],
                dpi=240,
                timeout_seconds=1,
                timeout_code="pdf_ocr_render_timeout",
            )

    def test_stalled_decoder_is_killed_at_wall_deadline_and_cleaned_up(self) -> None:
        original_pids = {
            child.pid for child in multiprocessing.active_children()
            if child.pid is not None and child.is_alive()
        }
        with patch(
            "ecos_indexer.resource_limits._isolated_pdf_dispatch",
            side_effect=stalled_decoder,
        ):
            with self.assertRaisesRegex(
                DocumentResourceRejected,
                "pdf_native_text_decode_timeout",
            ):
                run_isolated_pdf_operation(
                    ("bytes", self.pdf_bytes),
                    "text",
                    page_number=0,
                    flags=fitz.TEXTFLAGS_TEXT,
                    timeout_seconds=0.05,
                    timeout_code="pdf_native_text_decode_timeout",
                )
        self.assert_no_new_children(original_pids)

    def test_crashed_decoder_fails_closed_and_is_reaped(self) -> None:
        original_pids = {
            child.pid for child in multiprocessing.active_children()
            if child.pid is not None and child.is_alive()
        }
        with patch(
            "ecos_indexer.resource_limits._isolated_pdf_dispatch",
            side_effect=crashed_decoder,
        ):
            with self.assertRaisesRegex(
                DocumentResourceRejected,
                "pdf_isolated_child_failed",
            ):
                run_isolated_pdf_operation(
                    ("bytes", self.pdf_bytes),
                    "text",
                    page_number=0,
                    flags=fitz.TEXTFLAGS_TEXT,
                    timeout_seconds=1,
                    timeout_code="pdf_native_text_decode_timeout",
                )
        self.assert_no_new_children(original_pids)


if __name__ == "__main__":
    unittest.main()
