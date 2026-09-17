"""Synthetic original parity and modeled scanner/descriptor tests.

Portable tests use genuine local claims/spools with modeled seals and a fixed
test-only path substitution for installed engines. This is not Linux memfd or
ClamAV proof. Linux-only tests separately run actual sealed descriptor children;
their scanner remains a clearly named stub until a pinned-image probe is run.
"""
from contextlib import ExitStack, contextmanager
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pymupdf as fitz
from ecos_indexer import owner_original_fd_page_reader as reader
from ecos_indexer import owner_original_fd_consumer as consumer
from ecos_indexer import owner_original_spool as spool
from ecos_indexer import original_document_reader as legacy
from ecos_indexer import original_visual_reader as visual
from ecos_indexer.owner_execution import OwnerExecutionResult
from ecos_indexer.owner_service_limits import OWNER_PAGE_READER_TIMEOUT_SECONDS
from test_owner_original_fd_consumer import actual_pdf_gateway, CLEAN_STUB
from test_owner_original_download import CLAIM_ID, source_gateway
import test_original_document_reader as original_fixture


class SealedPageReaderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original_fixture.OriginalDocumentReaderTests.setUpClass()
        cls.data = original_fixture.OriginalDocumentReaderTests.original
        cls.digest = hashlib.sha256(cls.data).hexdigest()
        cls.observed = {}
        with fitz.open(stream=cls.data, filetype="pdf") as document:
            from ecos_indexer.page_source_excerpts import extract_original_page_observations
            from ecos_indexer.page_table_sources import extract_original_table_observations
            for n in (1, 2):
                page = document[n-1]
                cls.observed[n, "geometry"] = {"page_number": n, "rotation_degrees": page.rotation,
                    "display_width_points": page.rect.width, "display_height_points": page.rect.height,
                    "cropbox": list(page.cropbox), "mediabox": list(page.mediabox)}
                for lane, extractor in (("native", extract_original_page_observations), ("table", extract_original_table_observations)):
                    cls.observed[n, lane] = extractor(page, source_sha256=cls.digest, source_page_count=2, page_number=n)

    def setUp(self):
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="ecos-fd-pages-test-")))
        self.pdf = self.directory/"generated.pdf"; self.pdf.write_bytes(self.data)
        self.fds = []
        def create():
            fd, path = tempfile.mkstemp(dir=self.directory); os.unlink(path); self.fds.append(fd); return fd
        for name in ("_require_kernel", "_seal", "_assert_seals"):
            self.stack.enter_context(patch.object(spool, name))
        self.stack.enter_context(patch.object(spool, "_new_fd", side_effect=create))
        self.stack.enter_context(patch.object(consumer, "_require_kernel"))
        self.gateway, self.claim = actual_pdf_gateway(self.data, 2)
        self.original = spool.spool_owner_original(self.gateway, self.claim, [self.data])
        self.addCleanup(self.original.close)
        self.measured = {"source_sha256": self.digest, "source_page_count": 2, "byte_length": len(self.data)}
        self.calls = []; self.raster_paths = []
        self.stack.enter_context(patch.object(consumer, "run_bounded", side_effect=self.inspect_run))
        self.stack.enter_context(patch.object(reader, "_invoke", side_effect=self.invoke))
        self.stack.enter_context(patch.object(reader, "_engines", side_effect=visual.DiagnosticError("not installed in modeled test")))

    def inspect_run(self, argv, timeout, limit, *_args, **options):
        self.calls.append((argv, options))
        self.assertIs(options["_original_spool"], self.original)
        return (CLEAN_STUB if argv[0] == "/usr/bin/clamscan" else json.dumps(self.measured).encode()), b""

    def invoke(self, original, measured, number, lane, timeout, cancel):
        self.calls.append((lane, number)); self.assertIs(original, self.original)
        return {"ok": True, "measurement": dict(measured), "observations": copy.deepcopy(self.observed[number, lane])}

    def read(self, **options):
        return reader.read_owner_original_spool_pages(self.gateway, self.claim, self.original,
            pages=options.pop("pages", [1, 2]), dpi=100, **options)

    def test_exact_native_table_batch_schema_hashes_and_failed_visual_denominator(self):
        result = self.read()
        with patch.object(legacy, "read_original_visual_pages", side_effect=visual.DiagnosticError("missing")):
            old = legacy.read_original_document_pages(self.data, expected_sha256=self.digest, expected_page_count=2, pages=[1, 2], dpi=100)
        self.assertEqual(result, old)
        self.assertIn("NOT INSTALLED", result["pages"][0]["payload"]["native"]["observations"]["page_text"])
        self.assertIn("NOT approved", result["pages"][0]["payload_json"])
        self.assertEqual(result["pages"][1]["payload"]["native"]["state"], "unreadable")
        self.assertEqual(result["pages"][1]["payload"]["table"]["state"], "unreadable")
        self.assertEqual(sum(isinstance(c[0], list) and c[0][0] == "/usr/bin/clamscan" for c in self.calls), 1)
        self.assertFalse(self.original.closed)

    def test_actual_generated_pdf_all_three_lane_parity_with_test_only_descriptor_mapping(self):
        # Engines are real on this host; source-path mapping and clean scan are
        # modeled. The production API never accepts this fixture path/adapter.
        real_engine = visual.installed_engine
        def installed(command, _supplied): return real_engine(command, None)
        def execute(argv, *args, **kwargs):
            if kwargs.pop("_original_spool", None) is not None:
                self.assertEqual(argv.count(reader._TOKEN), 1)
                argv = [str(self.pdf) if v == reader._TOKEN else v for v in argv]
            if len(argv) > 1 and argv[1].endswith(".png"): self.raster_paths.append(Path(argv[1]))
            return visual.run_bounded(argv, *args, **kwargs)
        with patch.object(reader, "_engines", side_effect=REAL_ENGINES), \
             patch.object(reader, "installed_engine", side_effect=installed), \
             patch.object(reader, "run_bounded", side_effect=execute):
            actual = self.read()
        old = legacy.read_original_document_pages(self.data, expected_sha256=self.digest, expected_page_count=2, pages=[1, 2], dpi=100)
        self.assertEqual(actual, old)
        self.assertTrue(self.raster_paths)
        self.assertTrue(all(not p.exists() and not p.parent.exists() for p in self.raster_paths))
        for entry in actual["pages"]:
            self.assertEqual(hashlib.sha256(entry["raster_png"]).hexdigest(), entry["payload"]["visual"]["observations"]["raster"]["sha256"])
        self.assertFalse(self.original.closed)

    def test_independent_sealed_image_survives_missing_or_failed_ocr(self):
        from PIL import Image
        from ecos_indexer.original_page_image import COORDINATES, SCHEMA as IMAGE_SCHEMA, decode_original_page_image
        buffer = io.BytesIO(); Image.new("L", (40, 30), 255).save(buffer, format="PNG"); png = buffer.getvalue()
        metadata = {"schema_version": IMAGE_SCHEMA, "source_sha256": self.digest, "source_page_count": 2,
            "page_number": 1, "state": "rendered", "raster_sha256": hashlib.sha256(png).hexdigest(),
            "raster_byte_count": len(png), "raster_width": 40, "raster_height": 30,
            "coordinate_system": COORDINATES, "renderer_sha256": "a"*64, "renderer_version": "fixture renderer",
            "requested_dpi": 100, "ocr_attempted": False, "semantic_verified": False,
            "retrieval_authorized": False}
        raw = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
        for ocr in (visual.DiagnosticError("missing"), ("ocr", {"version": "fixture", "invoked_executable_sha256": "b"*64})):
            with self.subTest(ocr=type(ocr).__name__), \
                 patch.object(reader, "_renderer_engine", return_value=("renderer", {"version": "fixture renderer", "invoked_executable_sha256": "a"*64})), \
                 patch.object(reader, "_ocr_engine", side_effect=ocr if isinstance(ocr, Exception) else None,
                              return_value=None if isinstance(ocr, Exception) else ocr), \
                 patch.object(reader, "_render", return_value=(png, self.directory/"page.png", raw, 100, list(visual.LIMITATIONS))), \
                 patch.object(reader, "_ocr_visual", side_effect=visual.DiagnosticError("subprocess_failed")):
                result = self.read(pages=[1], independent_images=True)
            self.assertEqual(result["schema_version"], "ecos-original-document-page-batch/2.2")
            self.assertIsNone(result["pages"][0]["raster_png"])
            self.assertEqual(result["pages"][0]["payload"]["visual"]["state"], "failed")
            image = result["images"][0]
            self.assertEqual(image["raster_png"], png); self.assertEqual(image["image_payload_json"], raw)
            self.assertEqual(decode_original_page_image(raw, source_sha256=self.digest,
                source_page_count=2, page_number=1)["raster_sha256"], hashlib.sha256(png).hexdigest())

    def test_actual_independent_sealed_render_survives_ocr_failure(self):
        from ecos_indexer.original_page_image import decode_original_page_image
        real_engine = visual.installed_engine
        def installed(command, _supplied): return real_engine(command, None)
        def execute(argv, *args, **kwargs):
            if kwargs.pop("_original_spool", None) is not None:
                self.assertEqual(argv.count(reader._TOKEN), 1)
                argv = [str(self.pdf) if value == reader._TOKEN else value for value in argv]
            return visual.run_bounded(argv, *args, **kwargs)
        with patch.object(reader, "installed_engine", side_effect=installed), \
             patch.object(reader, "run_bounded", side_effect=execute), \
             patch.object(reader, "_ocr_visual", side_effect=visual.DiagnosticError("subprocess_failed")):
            result = self.read(pages=[1], independent_images=True)
        image = result["images"][0]
        metadata = decode_original_page_image(image["image_payload_json"], source_sha256=self.digest,
            source_page_count=2, page_number=1)
        self.assertEqual(hashlib.sha256(image["raster_png"]).hexdigest(), metadata["raster_sha256"])
        self.assertIsNone(result["pages"][0]["raster_png"])
        self.assertEqual(result["pages"][0]["payload"]["visual"]["state"], "failed")

    def test_independent_sealed_render_failure_is_an_explicit_image_gap(self):
        with patch.object(reader, "_renderer_engine", side_effect=visual.DiagnosticError("missing")), \
             patch.object(reader, "_ocr_engine") as ocr:
            result = self.read(pages=[1], independent_images=True)
        ocr.assert_not_called()
        self.assertEqual(result["schema_version"], "ecos-original-document-page-batch/2.2")
        self.assertEqual(result["images"], [{"page_number": 1, "image_payload_json": None, "raster_png": None}])
        self.assertEqual(result["pages"][0]["payload"]["visual"]["state"], "failed")

    def test_invalid_forged_cross_scope_closed_precancel_and_options_before_scan(self):
        allowed = self.read(pages=[1], total_timeout=OWNER_PAGE_READER_TIMEOUT_SECONDS)
        self.assertEqual(allowed["selected_pages"], [1])
        self.calls.clear()
        other, _ = actual_pdf_gateway(self.data, 2)
        read_gateway, _, _ = source_gateway(); read_result = read_gateway.read()
        fake = OwnerExecutionResult(self.claim.payload, True, self.claim.claim_expires_at)
        for gateway, claim, original in ((other, self.claim, self.original), (self.gateway, fake, self.original),
                (read_gateway, read_result, self.original), (self.gateway, self.claim, 3),
                (self.gateway, self.claim, str(self.pdf)), (self.gateway, self.claim, object.__new__(spool.OwnerOriginalSpool))):
            with self.assertRaises(reader.OwnerOriginalFDPageReadError):
                reader.read_owner_original_spool_pages(gateway, claim, original, pages=[1])
        for opts in ({"pages": []}, {"pages": [1, 1]}, {"pages": [2, 1]}, {"pages": [True]}, {"pages": [3]},
                     {"pages": list(range(1, 10))}, *({"total_timeout": x} for x in (True, 0, OWNER_PAGE_READER_TIMEOUT_SECONDS + 1, float("nan"))),
                     {"stage_timeout": 61}, {"cancel_event": object()}, {"psm": 7}, {"independent_images": "true"}):
            with self.assertRaises(reader.OwnerOriginalFDPageReadError): self.read(**opts)
        event = threading.Event(); event.set()
        with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(cancel_event=event)
        self.assertEqual(error.exception.code, "cancelled")
        self.assertEqual(self.calls, [])
        self.original.close()
        with self.assertRaises(reader.OwnerOriginalFDPageReadError): self.read()

    def test_no_caller_selected_path_bytes_engine_or_size_limit(self):
        for key in ("path", "fd", "original_bytes", "environment", "pdftoppm", "source_byte_limit"):
            with self.assertRaises(TypeError): self.read(**{key: "arbitrary"})
        self.assertEqual(spool.MAX_ORIGINAL_BYTES, 167772160)

    def test_scan_failure_or_skipped_summary_never_dispatches_extractors(self):
        for raw in (b"", b"Scanned files: 0\nInfected files: 0\n", CLEAN_STUB+CLEAN_STUB):
            self.calls.clear()
            with patch.object(consumer, "run_bounded", return_value=(raw, b"")) as run:
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read()
            self.assertEqual(error.exception.code, "source_inspection_failed"); self.assertEqual(run.call_count, 1)
            self.assertEqual(self.calls, [])

    def test_lane_failures_preserve_all_selected_pages_without_shortening_batch(self):
        def invoke(*args):
            if args[3] == "table" and args[2] == 1: raise visual.DiagnosticError("subprocess_deadline_exceeded")
            return self.invoke(*args)
        with patch.object(reader, "_invoke", side_effect=invoke): result = self.read()
        self.assertEqual(result["selected_pages"], [1, 2])
        self.assertEqual(result["pages"][0]["payload"]["table"], legacy._failed("original_table_parser_failed"))
        self.assertEqual(result["pages"][1]["payload"]["table"]["state"], "unreadable")

    def test_descriptor_integrity_and_cleanup_errors_never_become_partial_lane_packets(self):
        for lane in ("geometry", "native", "table"):
            for code in ("seal_failed", "invalid_spool", "cleanup_failed"):
                def invoke(*args):
                    if args[3] == lane: raise spool.OwnerOriginalSpoolError(code)
                    return self.invoke(*args)
                with self.subTest(lane=lane, code=code), patch.object(reader, "_invoke", side_effect=invoke):
                    with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1])
                    self.assertEqual(error.exception.code, "source_integrity_failed")
                    self.assertFalse(error.exception.partial_packet_returned)

    def test_real_bounded_runner_lending_entry_and_exit_errors_reject_whole_source(self):
        # Real run_bounded control/cleanup, fault-injected loan boundary. The
        # Mac child fails its kernel check; no actual Linux seal proof here.
        for code in ("seal_failed", "invalid_spool", "cleanup_failed"):
            exits = []
            @contextmanager
            def borrow(value):
                self.assertIs(value, self.original)
                if code != "cleanup_failed": raise spool.OwnerOriginalSpoolError(code)
                fd = os.open(self.pdf, os.O_RDONLY)
                try: yield fd
                finally:
                    os.close(fd); exits.append(1)
                    raise spool.OwnerOriginalSpoolError("cleanup_failed")
            def invoke(*args):
                return REAL_INVOKE(*args) if args[3] == "native" else self.invoke(*args)
            with patch.object(spool, "_borrow_readonly_descriptor", side_effect=borrow), \
                 patch.object(reader, "_invoke", side_effect=invoke):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1])
            self.assertEqual(error.exception.code, "source_integrity_failed")
            self.assertEqual(exits, [1] if code == "cleanup_failed" else [])
        self.assertFalse(self.original.closed)

    def test_render_descriptor_failure_rejects_whole_packet_not_visual_gap(self):
        engines = ("/usr/bin/pdftoppm", "/usr/bin/tesseract", {"ocr": {"version": "synthetic", "invoked_executable_sha256": "a"*64}})
        for code in ("seal_failed", "invalid_spool", "cleanup_failed"):
            with patch.object(reader, "_engines", return_value=engines), \
                 patch.object(reader, "run_bounded", side_effect=spool.OwnerOriginalSpoolError(code)):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1])
            self.assertEqual(error.exception.code, "source_integrity_failed")

    def test_source_measurement_or_observation_pin_drift_rejects_whole_packet(self):
        for mutate in (lambda v: v.update(code="original_snapshot_changed", ok=False),
                       lambda v: v["measurement"].update(byte_length=True),
                       lambda v: v["measurement"].update(source_sha256="f"*64),
                       lambda v: v["observations"].update(page_number=2),
                       lambda v: v["observations"].update(source_page_count=True),
                       lambda v: v["observations"].update(retrieval_authorized=True)):
            def invoke(*args):
                value = self.invoke(*args)
                if args[3] == "native": mutate(value)
                return value
            with patch.object(reader, "_invoke", side_effect=invoke):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read()
            self.assertEqual(error.exception.code, "source_integrity_failed")
            self.assertFalse(error.exception.partial_packet_returned)

    def test_malformed_geometry_native_spans_and_table_cells_fail_closed(self):
        changes = [("geometry", lambda v: v.update(display_width_points=True)),
            ("geometry", lambda v: v.update(cropbox=[0, 0, float("inf"), 800])),
            ("geometry", lambda v: v.update(rotation_degrees=90)),
            ("native", lambda v: v["excerpts"][0].update(text_end=999999)),
            ("native", lambda v: v["excerpts"][0].update(bbox=[0, 0, float("nan"), 3])),
            ("native", lambda v: v.update(page_text="opposite")),
            ("table", lambda v: v["tables"][0]["rows"][0]["cells"][0].update(column_number=2)),
            ("table", lambda v: v["tables"][0]["rows"][0]["cells"][0].update(bbox=None)),
            ("table", lambda v: v["tables"][0]["rows"][0]["cells"][1].update(bbox=v["tables"][0]["rows"][0]["cells"][0]["bbox"]))]
        for lane, mutate in changes:
            def invoke(*args):
                value = self.invoke(*args)
                if args[3] == lane: mutate(value["observations"])
                return value
            with patch.object(reader, "_invoke", side_effect=invoke):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1])
            self.assertEqual(error.exception.code, "source_integrity_failed")

    def test_mutating_selection_after_validation_cannot_retarget_pages(self):
        pages = [1]
        def invoke(*args): pages[:] = [2]; return self.invoke(*args)
        with patch.object(reader, "_invoke", side_effect=invoke): result = self.read(pages=pages)
        self.assertEqual(result["selected_pages"], [1]); self.assertEqual(result["pages"][0]["payload"]["page_number"], 1)

    def test_claim_expiry_closed_spool_and_cancellation_after_stage_drop_packet(self):
        for mode in ("expired", "cancel"):
            event = threading.Event()
            def invoke(*args):
                result = self.invoke(*args)
                if mode == "expired": self.gateway._claims[self.claim] = (CLAIM_ID, time.monotonic()-1)
                else: event.set()
                return result
            with patch.object(reader, "_invoke", side_effect=invoke):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(cancel_event=event)
            self.assertEqual(error.exception.code, "source_not_current" if mode == "expired" else "cancelled")
            self.gateway._claims[self.claim] = (CLAIM_ID, time.monotonic()+60)
        def closed(*args): result = self.invoke(*args); self.original.close(); return result
        with patch.object(reader, "_invoke", side_effect=closed):
            with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read()
        self.assertEqual(error.exception.code, "source_not_current")

    def test_global_deadline_including_scan_and_final_encoding_has_no_partial_result(self):
        for stage in ("scan", "encode"):
            clock = [0]; encode = reader._json_bytes
            def late(*args, **kwargs): clock[0] = 101; return self.inspect_run(*args, **kwargs)
            def encoded(value):
                result = encode(value)
                if type(value) is dict and "payload_json" in value: clock[0] = 101
                return result
            with patch.object(reader.time, "monotonic", side_effect=lambda: clock[0]), \
                 patch.object(consumer, "run_bounded", side_effect=late if stage == "scan" else self.inspect_run), \
                 patch.object(reader, "_json_bytes", side_effect=encoded):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read()
            self.assertEqual(error.exception.code, "deadline_exceeded")

    def test_exact_page_and_both_retained_representation_limits(self):
        result = self.read(pages=[1]); size = len(result["pages"][0]["payload_json"].encode())
        for cap, value, code in (("MAX_PAGE_BYTES", size-1, "page_payload_limit"),
                                 ("MAX_BATCH_BYTES", size+1, "batch_retained_limit")):
            with patch.object(reader, cap, value):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1])
            self.assertEqual(error.exception.code, code)

    def test_child_decode_duplicate_nonfinite_overbound_and_wrong_shapes(self):
        for raw in (b'{"ok":true,"ok":true}', b'{"ok":true,"x":NaN}', b'{"ok":true,"x":1e999}',
                    b'{"ok":1}', b'[]', b'\xff', b'x'*(reader.MAX_PAGE_BYTES+1)):
            with self.assertRaises(Exception): reader._decode(raw)

    def test_visual_cancel_or_raster_mutation_drops_whole_packet_and_cleans_scratch(self):
        from PIL import Image
        from ecos_indexer.page_visual_observations import HEADER
        w, h = reader.raster_size(700, 800, 100, 16_000_000, 6000)
        buffer = io.BytesIO(); Image.new("L", (w, h), 255).save(buffer, format="PNG"); png = buffer.getvalue()
        raw_tsv = (HEADER+f"\n1\t1\t0\t0\t0\t0\t0\t0\t{w}\t{h}\t-1\t\n").encode()
        engines = ("/usr/bin/pdftoppm", "/usr/bin/tesseract", {"ocr": {"version": "synthetic", "invoked_executable_sha256": "a"*64}})
        for mode in ("cancel", "drift"):
            event = threading.Event(); paths = []
            def run(argv, *args, **options):
                if argv[0].endswith("pdftoppm"):
                    self.assertIs(options["_original_spool"], self.original); return png, b""
                path = Path(argv[1]); paths.append(path)
                if mode == "cancel": event.set()
                elif argv[-1] == "tsv": path.write_bytes(b"changed raster")
                return (raw_tsv if argv[-1] == "tsv" else b""), b""
            with patch.object(reader, "_engines", return_value=engines), patch.object(reader, "run_bounded", side_effect=run):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(pages=[1], cancel_event=event)
            self.assertEqual(error.exception.code, "cancelled" if mode == "cancel" else "source_integrity_failed")
            self.assertTrue(paths); self.assertTrue(all(not p.exists() and not p.parent.exists() for p in paths))
            self.assertFalse(self.original.closed)

    def test_child_post_parse_seal_failure_is_global_identity_error_not_lane_failure(self):
        measured = dict(self.measured)
        actual_open = fitz.open
        with patch.object(reader, "_inspect_descriptor", return_value=measured), \
             patch.object(reader.os, "fstat", return_value=os.stat(self.pdf)), \
             patch.object(fitz, "open", side_effect=lambda *_args, **_kwargs: actual_open(str(self.pdf))), \
             patch.object(reader, "_assert_seals", side_effect=ValueError("private seal failure")):
            result = reader._descriptor_page("/proc/self/fd/7", self.digest, len(self.data), 2, 1, "native")
        self.assertEqual(result, {"ok": False, "code": "original_snapshot_changed"})

    def test_actual_runner_cancellation_reaps_child_without_returning_failed_lane(self):
        event = threading.Event(); invoked = []
        def invoke(*args):
            invoked.append(1); timer = threading.Timer(.05, event.set); timer.start()
            try: visual.run_bounded([sys.executable, "-c", "import time;time.sleep(60)"], 5, 1024, cancel_event=args[-1])
            finally: timer.cancel(); timer.join()
        with patch.object(reader, "_invoke", side_effect=invoke):
            with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(cancel_event=event)
        self.assertEqual(error.exception.code, "cancelled"); self.assertEqual(invoked, [1])
        self.assertFalse(self.original.closed)

    def test_private_child_signal_observes_shadowed_caller_and_claim_expiry_without_watcher(self):
        for mode in ("cancel", "expired"):
            event = threading.Event(); event.is_set = lambda: False
            def invoke(*args):
                child_event = args[-1]
                self.assertIs(type(child_event), threading.Event); self.assertIsNot(child_event, event)
                if mode == "cancel": threading.Event.set(event)
                else: self.gateway._claims[self.claim] = (CLAIM_ID, time.monotonic()-1)
                self.assertTrue(child_event.is_set())
                raise visual.DiagnosticError("original_processing_cancelled")
            with patch.object(reader, "_invoke", side_effect=invoke):
                with self.assertRaises(reader.OwnerOriginalFDPageReadError) as error: self.read(cancel_event=event)
            self.assertEqual(error.exception.code, "cancelled" if mode == "cancel" else "source_not_current")
            self.gateway._claims[self.claim] = (CLAIM_ID, time.monotonic()+60)

    def test_parent_never_requests_whole_original_or_writes_pdf_snapshot(self):
        read_at = spool.OwnerOriginalSpool.read_at; write = Path.write_bytes; reads = []
        def bounded(handle, offset, length):
            reads.append((offset, length)); self.assertLessEqual(length, 5)
            return read_at(handle, offset, length)
        def derived(path, data):
            self.assertEqual(path.suffix, ".png"); return write(path, data)
        with patch.object(spool.OwnerOriginalSpool, "read_at", new=bounded), patch.object(Path, "write_bytes", new=derived):
            result = self.read()
        self.assertEqual(reads, [(0, 5)]); self.assertEqual(result["selected_pages"], [1, 2])


REAL_ENGINES = reader._engines
REAL_INVOKE = reader._invoke


@unittest.skipUnless(sys.platform == "linux" and hasattr(os, "memfd_create"), "requires actual Linux memfd/procFD kernel")
class LinuxSealedPageReaderTest(unittest.TestCase):
    def test_actual_sealed_fd_native_table_child_output_matches_existing_raw_extractors(self):
        original_fixture.OriginalDocumentReaderTests.setUpClass(); data = original_fixture.OriginalDocumentReaderTests.original
        gateway, claim = actual_pdf_gateway(data, 2)
        measured = {"source_sha256": hashlib.sha256(data).hexdigest(), "source_page_count": 2, "byte_length": len(data)}
        with spool.spool_owner_original(gateway, claim, [data]) as original:
            for n in (1, 2):
                for lane in ("geometry", "native", "table"):
                    result = reader._invoke(original, measured, n, lane, 10, None)
                    self.assertTrue(result["ok"]); self.assertEqual(result["measurement"], measured)
                    if lane == "geometry": reader._geometry(result["observations"], n)
                    else: reader._observation(result["observations"], lane, measured, n, None)
            self.assertFalse(original.closed)


if __name__ == "__main__": unittest.main()
