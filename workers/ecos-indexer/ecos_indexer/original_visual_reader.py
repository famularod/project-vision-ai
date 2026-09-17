#!/usr/bin/env python3
"""Shared bounded original-PDF rendering and raw OCR observations.

No project, execution or retrieval authority is constructed here. Callers must
bind measured originals to current owner execution separately. The diagnostic
CLI uses this same implementation. Default diagnostic output omits source text.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecos_indexer.page_visual_observations import parse_visual_observations, VisualObservationError

SCHEMA = "ecos-rendered-page-ocr-diagnostic/1.0"
LIMITATIONS = ["diagnostic_only_no_retrieval_authority", "pixel_ocr_only",
              "reading_order_not_verified", "ocr_text_requires_visual_review",
              "semantic_fact_extraction_pending", "renderer_messages_suppressed_exit_status_checked"]


class DiagnosticError(Exception):
    """Sanitized stable diagnostic failure; subprocess messages are not exposed."""


class DiagnosticProcessError(DiagnosticError):
    """Only the numeric exit status, never captured scanner/parser output."""
    def __init__(self, exit_code: int):
        self.exit_code = exit_code
        super().__init__("subprocess_failed")


def parser_environment(executable: str) -> dict[str, str]:
    """Deterministic child configuration, NOT a sandbox or network boundary.

    No inherited secrets, Python/module hooks, loader overrides, proxies,
    user font/Tesseract config or caller PATH. Internal callers supply an
    absolute installed executable; its directory permits explicit wrappers.
    """
    if type(executable) is not str or not os.path.isabs(executable) or "\0" in executable:
        raise DiagnosticError("absolute_installed_engine_required")
    executable_path = Path(executable).resolve(strict=True)
    if not executable_path.is_file() or not os.access(executable_path, os.X_OK):
        raise DiagnosticError("installed_engine_unavailable")
    return {"PATH": os.pathsep.join(dict.fromkeys((str(executable_path.parent), "/usr/bin", "/bin"))),
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC",
            "OMP_THREAD_LIMIT": "1", "OMP_NUM_THREADS": "1",
            "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def installed_engine(command: str, supplied: str | None) -> tuple[str, dict]:
    candidate = supplied if supplied is not None else shutil.which(command)
    if not candidate or not os.path.isabs(candidate):
        raise DiagnosticError("absolute_installed_engine_required")
    path = Path(candidate).resolve(strict=True)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise DiagnosticError("installed_engine_unavailable")
    with path.open("rb") as stream:
        data = stream.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise DiagnosticError("engine_identity_byte_limit_exceeded")
    return str(path), {"invoked_executable_path": str(path), "invoked_executable_sha256": sha(data),
                       "executable_hash_scope": "invoked_file_only_not_transitive_libraries_or_wrapper_targets"}


def integer(value, lower: int, upper: int, code: str) -> int:
    if type(value) is not int or not lower <= value <= upper:
        raise DiagnosticError(code)
    return value


def run_bounded(argv: list[str], timeout: float, stdout_limit: int,
                stderr_limit: int = 16384, *, cancel_event: threading.Event | None = None,
                _original_spool=None) -> tuple[bytes, bytes]:
    """Drain both pipes with byte limits enforced DURING capture; no shell.

    A cancellation/timeout/output-limit/failure kills the isolated process group (including
    children), waits for it, discards all partial stdout and closes every pipe.
    """
    if cancel_event is not None and type(cancel_event) is not threading.Event:
        raise DiagnosticError("invalid_cancellation_signal")
    if cancel_event is not None and cancel_event.is_set():
        raise DiagnosticError("original_processing_cancelled")
    if not math.isfinite(timeout) or timeout <= 0:
        raise DiagnosticError("subprocess_deadline_exceeded")
    if not argv or not all(isinstance(v, str) and "\0" not in v for v in argv):
        raise DiagnosticError("invalid_subprocess_arguments")
    integer(stdout_limit, 1, 32 * 1024 * 1024, "invalid_capture_limit")
    integer(stderr_limit, 1, 65536, "invalid_capture_limit")
    deadline = time.monotonic() + timeout
    def check():
        if cancel_event is not None and cancel_event.is_set():
            raise DiagnosticError("original_processing_cancelled")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DiagnosticError("subprocess_deadline_exceeded")
        return remaining
    proc = None
    scratch = None
    completed = False
    captured = {"stdout": bytearray(), "stderr": bytearray()}
    descriptor_scope = ExitStack()
    try:
        check()
        descriptor_options = {}
        if _original_spool is not None:
            # Internal exact-spool handoff only. Never accept a raw FD/path.
            # The caller's reviewed argv has exactly one fixed placeholder.
            from ecos_indexer.owner_original_spool import _borrow_readonly_descriptor
            if argv.count("@ECOS_SEALED_ORIGINAL@") != 1:
                raise DiagnosticError("invalid_original_descriptor_request")
            fd = descriptor_scope.enter_context(_borrow_readonly_descriptor(_original_spool))
            argv = [f"/proc/self/fd/{fd}" if arg == "@ECOS_SEALED_ORIGINAL@" else arg for arg in argv]
            descriptor_options = {"pass_fds": (fd,)}
            check()
        environment = parser_environment(argv[0])
        # Fontconfig requires a writable cache on some installed renderers.
        # Never reuse the account HOME/cache; each child receives an empty,
        # private directory that is removed after process-group cleanup.
        scratch = tempfile.TemporaryDirectory(prefix="ecos-parser-env-")
        environment.update(HOME=scratch.name, XDG_CACHE_HOME=scratch.name)
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                shell=False, start_new_session=True,
                                env=environment, **descriptor_options)
        with selectors.DefaultSelector() as selector:
            for label, pipe in (("stdout", proc.stdout), ("stderr", proc.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, label)
            while selector.get_map():
                remaining = check()
                for key, _ in selector.select(min(remaining, 0.05)):
                    block = os.read(key.fileobj.fileno(), 8192)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    limit = stdout_limit if key.data == "stdout" else stderr_limit
                    if len(captured[key.data]) + len(block) > limit:
                        raise DiagnosticError("subprocess_output_limit_exceeded")
                    captured[key.data].extend(block)
            # Pipes can close before the child exits. Keep cancellation responsive
            # during that interval rather than waiting the whole remaining budget.
            while True:
                remaining = check()
                try:
                    returncode = proc.wait(timeout=min(remaining, 0.05))
                    break
                except subprocess.TimeoutExpired:
                    continue
            check()
            if returncode != 0:
                raise DiagnosticProcessError(returncode)
        result = bytes(captured["stdout"]), bytes(captured["stderr"])
        check()
        completed = True
        return result
    except (OSError, ValueError) as exc:
        raise DiagnosticError("subprocess_unavailable") from exc
    finally:
        try:
            if proc is not None:
                # Kill descendants even if the group leader already exited while a
                # descendant still held a pipe. Our process always has its own group.
                if not completed or _original_spool is not None:
                    # A descriptor-capable child must not leave a descendant
                    # retaining the borrowed source after its leader succeeds.
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                proc.wait()
                proc.stdout.close()
                proc.stderr.close()
        finally:
            try:
                if scratch is not None:
                    scratch.cleanup()
            finally:
                descriptor_scope.close()


def raster_size(width: float, height: float, dpi: int, max_pixels: int,
                max_dimension: int) -> tuple[int, int]:
    if not all(math.isfinite(x) and 0 < x <= 100000 for x in (width, height)):
        raise DiagnosticError("invalid_page_geometry")
    scale = min(dpi / 72, max_dimension / width, max_dimension / height,
                math.sqrt(max_pixels / (width * height)))
    w, h = max(1, math.floor(width * scale)), max(1, math.floor(height * scale))
    if w * h > max_pixels or max(w, h) > max_dimension:
        raise DiagnosticError("raster_pixel_limit_exceeded")
    return w, h


def png_size(data: bytes, max_pixels: int, max_dimension: int) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise DiagnosticError("invalid_rendered_png")
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0 or width * height > max_pixels or max(width, height) > max_dimension:
        raise DiagnosticError("raster_pixel_limit_exceeded")
    return width, height


def inspect_pdf(path: str, pages: list[int]) -> dict:
    # Invoked only in an isolated child with bounded stdout and wall-clock time.
    import pymupdf as fitz
    with fitz.open(path) as doc:
        if doc.needs_pass or not doc.is_pdf:
            raise DiagnosticError("encrypted_or_invalid_pdf")
        if any(p > doc.page_count for p in pages):
            raise DiagnosticError("selected_page_out_of_range")
        metadata = []
        for number in pages:
            page = doc[number - 1]
            metadata.append({"page_number": number, "rotation_degrees": page.rotation,
                             "display_width_points": page.rect.width,
                             "display_height_points": page.rect.height,
                             "cropbox": list(page.cropbox), "mediabox": list(page.mediabox)})
        return {"source_page_count": doc.page_count, "pages": metadata,
                "inspection_engine": f"PyMuPDF {fitz.VersionBind}"}


def diagnose(source_path: str, expected_sha256: str, pages: list[int], *,
             expected_page_count: int | None = None, dpi: int = 250,
             max_pixels: int = 16_000_000, max_dimension: int = 6000,
             source_byte_limit: int = 128 * 1024 * 1024,
             stage_timeout: float = 45, total_timeout: float = 300,
             ocr_byte_limit: int = 262144, include_text: bool = False,
             raster_directory: str | None = None, tesseract: str | None = None,
             pdftoppm: str | None = None, psm: int = 11,
             include_visual_observations: bool = False,
             cancel_event: threading.Event | None = None) -> dict:
    if cancel_event is not None and type(cancel_event) is not threading.Event:
        raise DiagnosticError("invalid_cancellation_signal")
    if cancel_event is not None and cancel_event.is_set():
        raise DiagnosticError("original_processing_cancelled")
    if not isinstance(source_path, str) or not Path(source_path).is_absolute():
        raise DiagnosticError("absolute_source_path_required")
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise DiagnosticError("canonical_expected_sha256_required")
    if not isinstance(pages, list) or not 1 <= len(pages) <= 8 or any(type(p) is not int or p < 1 for p in pages) or pages != sorted(set(pages)):
        raise DiagnosticError("explicit_sorted_unique_selected_pages_required")
    integer(dpi, 72, 400, "dpi_out_of_bounds")
    integer(max_pixels, 10000, 24_000_000, "pixel_budget_out_of_bounds")
    integer(max_dimension, 100, 8000, "dimension_budget_out_of_bounds")
    integer(source_byte_limit, 1024, 256 * 1024 * 1024, "source_budget_out_of_bounds")
    integer(ocr_byte_limit, 1, 1048576, "ocr_budget_out_of_bounds")
    integer(psm, 3, 11, "psm_out_of_bounds")
    if psm not in (3, 6, 11) or not 0 < stage_timeout <= 60 or not 0 < total_timeout <= 600:
        raise DiagnosticError("timeout_or_psm_out_of_bounds")
    if expected_page_count is not None:
        integer(expected_page_count, 1, 10000, "page_count_out_of_bounds")
    if type(include_text) is not bool or type(include_visual_observations) is not bool:
        raise DiagnosticError("invalid_text_retention_option")
    deadline = time.monotonic() + total_timeout
    def check_deadline():
        if cancel_event is not None and cancel_event.is_set():
            raise DiagnosticError("original_processing_cancelled")
        if time.monotonic() >= deadline:
            raise DiagnosticError("diagnostic_deadline_exceeded")
    with open(source_path, "rb") as stream:
        original = stream.read(source_byte_limit + 1)
    if len(original) > source_byte_limit:
        raise DiagnosticError("source_byte_limit_exceeded")
    if sha(original) != expected_sha256:
        raise DiagnosticError("source_sha256_mismatch")
    renderer, renderer_identity = installed_engine("pdftoppm", pdftoppm)
    tesseract, ocr_identity = installed_engine("tesseract", tesseract)
    def execute(argv, stdout_limit, timeout=None):
        check_deadline()
        return run_bounded(argv, min(stage_timeout if timeout is None else timeout,
                                     deadline - time.monotonic()), stdout_limit,
                           cancel_event=cancel_event)
    versions = {}
    for name, argv in (("renderer", [renderer, "-v"]), ("ocr", [tesseract, "--version"])):
        out, err = execute(argv, 16384, 5)
        combined = out + err
        versions[name] = {**(renderer_identity if name == "renderer" else ocr_identity),
                          "version": combined.decode("utf-8", "strict").splitlines()[0][:256],
                          "version_output_sha256": sha(combined)}
    retained = None
    if raster_directory is not None:
        target = Path(raster_directory)
        if not target.is_absolute() or not target.is_dir():
            raise DiagnosticError("existing_absolute_raster_directory_required")
        retained = Path(tempfile.mkdtemp(prefix="ecos-ocr-rasters-", dir=target))
    output = {"schema_version": SCHEMA, "authority": "diagnostic_only", "semantic_verification": "not_performed",
              "source_sha256": expected_sha256, "source_byte_count": len(original), "selected_pages": list(pages),
              "renderer": versions["renderer"], "ocr_engine": versions["ocr"],
              "ocr_config": {"language": "eng", "oem": 1, "psm": psm, "requested_dpi": dpi,
                             "max_pixels": max_pixels, "max_dimension": max_dimension},
              "source_byte_limit": source_byte_limit,
              "renderer_config": {"cropbox": True, "grayscale": True, "quiet": True,
                                  "scale_dimension_before_rotation": True, "format": "png"},
              "transcripts_persisted": False, "text_included_in_return": include_text,
              "visual_observations_included_in_return": include_visual_observations, "pages": []}
    with tempfile.TemporaryDirectory(prefix="ecos-ocr-original-") as directory:
        root = Path(directory)
        snapshot = root / "source.pdf"
        snapshot.write_bytes(original)
        del original
        info, _ = execute([sys.executable, str(Path(__file__).resolve()), "--inspect", str(snapshot),
                           "--pages", ",".join(map(str, pages))], 16384, 15)
        try:
            metadata = json.loads(info)
        except (UnicodeError, ValueError) as exc:
            raise DiagnosticError("invalid_pdf_inspection_response") from exc
        if "failure_code" in metadata:
            raise DiagnosticError(metadata["failure_code"])
        if expected_page_count is not None and metadata["source_page_count"] != expected_page_count:
            raise DiagnosticError("source_page_count_mismatch")
        output["source_page_count"] = metadata["source_page_count"]
        output["inspection_engine"] = metadata["inspection_engine"]
        for page in metadata["pages"]:
            check_deadline()
            identity = {"source_sha256": expected_sha256, **page}
            result = {**page, "page_identity_sha256": sha(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()),
                      "page_identity_hash_domain": "source_hash_plus_page_locator_and_geometry_not_standalone_pdf_page_bytes",
                      "coordinate_system": "rotated_display_cropbox_pixels_top_left",
                      "coordinate_limitation": ("Optional word/line boxes are raw rotated raster pixels; not native unrotated PDF-point locators."
                                                if include_visual_observations else
                                                "No boxes emitted; not interchangeable with native unrotated PDF-point locators."),
                      "state": "failed", "limitation_codes": list(LIMITATIONS), "ocr_text_sha256": None,
                      "ocr_text_bytes": 0, "ocr_non_whitespace_characters": 0, "raster_sha256": None}
            try:
                width, height = raster_size(page["display_width_points"], page["display_height_points"], dpi, max_pixels, max_dimension)
                # Poppler otherwise treats scale-to X/Y as unrotated dimensions;
                # this option makes the requested bounds the displayed raster.
                raster, _ = execute([renderer, "-q", "-scale-dimension-before-rotation", "-f", str(page["page_number"]), "-l", str(page["page_number"]),
                                     "-singlefile", "-cropbox", "-gray", "-r", str(dpi), "-scale-to-x", str(width),
                                     "-scale-to-y", str(height), "-png", str(snapshot)], 32 * 1024 * 1024)
                actual_width, actual_height = png_size(raster, max_pixels, max_dimension)
                if (actual_width, actual_height) != (width, height):
                    raise DiagnosticError("rendered_dimensions_mismatch")
                raster_path = root / f"page-{page['page_number']}.png"
                raster_path.write_bytes(raster)
                effective_dpi = min(actual_width * 72 / page["display_width_points"], actual_height * 72 / page["display_height_points"])
                result.update(raster_sha256=sha(raster), raster_byte_count=len(raster), raster_width=actual_width,
                              raster_height=actual_height, effective_dpi=effective_dpi, raster_hash_domain="exact_png_bytes_sent_to_ocr")
                if effective_dpi + 1 < dpi:
                    result["limitation_codes"].append("raster_resolution_reduced_to_fit_budget")
                if retained is not None:
                    saved = retained / raster_path.name
                    saved.write_bytes(raster)
                    result["retained_raster_path"] = str(saved)
                text_bytes, _ = execute([tesseract, str(raster_path), "stdout", "-l", "eng", "--dpi", str(max(72, round(effective_dpi))),
                                         "--oem", "1", "--psm", str(psm)], ocr_byte_limit)
                try:
                    text = text_bytes.decode("utf-8", "strict")
                except UnicodeError as exc:
                    raise DiagnosticError("unsupported_ocr_text_encoding") from exc
                if "\0" in text:
                    raise DiagnosticError("unsupported_ocr_text_encoding")
                result.update(ocr_text_sha256=sha(text_bytes), ocr_text_bytes=len(text_bytes),
                              ocr_non_whitespace_characters=sum(not c.isspace() for c in text))
                if text.strip():
                    result["state"] = "partial"
                else:
                    result["state"] = "unreadable"
                    result["limitation_codes"].append("ocr_no_text_detected_not_verified_empty")
                if include_text:
                    result["ocr_text"] = text
                if include_visual_observations:
                    raw_tsv, _ = execute([tesseract, str(raster_path), "stdout", "-l", "eng", "--dpi", str(max(72, round(effective_dpi))),
                                          "--oem", "1", "--psm", str(psm), "tsv"], 1024 * 1024)
                    result["visual_observations"] = parse_visual_observations(raw_tsv, raster, source={
                        "source_sha256": expected_sha256, "source_page_count": metadata["source_page_count"], **page,
                    }, engine={"name": "tesseract", "version": versions["ocr"]["version"], "language": "eng",
                               "oem": 1, "psm": psm, "invoked_executable_sha256": versions["ocr"]["invoked_executable_sha256"]})
                check_deadline()
            except (DiagnosticError, VisualObservationError) as exc:
                check_deadline()
                result.update(state="failed", ocr_text_sha256=None, ocr_text_bytes=0, ocr_non_whitespace_characters=0)
                result.pop("ocr_text", None)
                result.pop("visual_observations", None)
                result["limitation_codes"].append(str(exc))
            output["pages"].append(result)
        check_deadline()
    return output


def read_original_visual_pages(original: bytes, *, expected_sha256: str,
                               expected_page_count: int, pages: list[int],
                               total_timeout: float = 90, stage_timeout: float = 30,
                               dpi: int = 250, psm: int = 11,
                               cancel_event: threading.Event | None = None) -> dict:
    """Reusable raw-byte reader; the diagnostic invokes the same engine below.

    Only measured original bytes are accepted, not a mutable path or a hosted
    job alias. Returned PNG bytes and raw OCR observations stay in memory;
    private scratch files are removed on success/failure. This is NOT an owner
    claim, artifact commit or permission to answer. Caller must bind current
    source/execution and persist a versioned artifact before retrieval.

    A selected failed page remains an explicit failed page, never a missing
    denominator entry. Whole-call deadline/output failures return no packet.
    These limits bound source and returned bytes, not total process RSS.
    """
    started = time.monotonic()
    if cancel_event is not None and type(cancel_event) is not threading.Event:
        raise DiagnosticError("invalid_cancellation_signal")
    def check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise DiagnosticError("original_processing_cancelled")
    check_cancel()
    if type(original) is not bytes or not 1 <= len(original) <= 64 * 1024 * 1024:
        raise DiagnosticError("original_visual_source_byte_limit")
    if type(expected_sha256) is not str or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256) or sha(original) != expected_sha256:
        raise DiagnosticError("original_visual_source_sha256_mismatch")
    integer(expected_page_count, 1, 10000, "page_count_out_of_bounds")
    if (type(pages) is not list or not 1 <= len(pages) <= 8 or
            any(type(p) is not int or not 1 <= p <= expected_page_count for p in pages) or
            pages != sorted(set(pages))):
        raise DiagnosticError("explicit_sorted_unique_selected_pages_required")
    pages = list(pages)
    if (type(total_timeout) not in (int, float) or not math.isfinite(total_timeout) or not 0 < total_timeout <= 110
            or type(stage_timeout) not in (int, float) or not math.isfinite(stage_timeout) or not 0 < stage_timeout <= 60):
        raise DiagnosticError("original_visual_timeout_out_of_bounds")
    deadline = started + total_timeout
    # No document content or derivative is retained beyond this private scope.
    with tempfile.TemporaryDirectory(prefix="ecos-original-visual-reader-") as directory:
        root = Path(directory)
        snapshot = root / "original.pdf"
        snapshot.write_bytes(original)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DiagnosticError("original_visual_deadline_exceeded")
        raw = diagnose(str(snapshot), expected_sha256, pages,
                       expected_page_count=expected_page_count, dpi=dpi, psm=psm,
                       source_byte_limit=64 * 1024 * 1024,
                       total_timeout=remaining, stage_timeout=min(stage_timeout, remaining),
                       include_visual_observations=True, raster_directory=directory,
                       cancel_event=cancel_event)
        observed = []
        retained_bytes = 0
        for page in raw["pages"]:
            check_cancel()
            item = {"page_number": page["page_number"], "state": page["state"],
                    "limitation_codes": list(page["limitation_codes"])}
            if page["state"] != "failed":
                raster_path = Path(page["retained_raster_path"])
                # This path came only from our private child directory, never
                # from a caller/metadata/provider. Recheck path/hash before use.
                if not raster_path.resolve().is_relative_to(root.resolve()):
                    raise DiagnosticError("original_visual_raster_path_rejected")
                with raster_path.open("rb") as stream:
                    raster = stream.read(32 * 1024 * 1024 + 1)
                if len(raster) > 32 * 1024 * 1024 or sha(raster) != page["raster_sha256"]:
                    raise DiagnosticError("original_visual_raster_drift")
                observations = page["visual_observations"]
                if (observations["source"]["source_sha256"] != expected_sha256 or
                        observations["source"]["page_number"] != page["page_number"] or
                        observations["raster"]["sha256"] != page["raster_sha256"]):
                    raise DiagnosticError("original_visual_observation_identity_drift")
                retained_bytes += len(raster) + len(json.dumps(observations, ensure_ascii=False).encode("utf-8"))
                if retained_bytes > 64 * 1024 * 1024:
                    raise DiagnosticError("original_visual_retained_byte_limit")
                item.update(state=observations["state"], observations=observations, raster_png=raster)
            observed.append(item)
        if time.monotonic() >= deadline:
            raise DiagnosticError("original_visual_deadline_exceeded")
        check_cancel()
        result = {"schema_version": "ecos-original-visual-page-batch/2.1",
                "source_sha256": expected_sha256, "source_byte_count": len(original),
                "source_page_count": expected_page_count, "selected_pages": list(pages),
                "coverage": "selected_pages_only", "pages": observed,
                "renderer": raw["renderer"], "ocr_engine": raw["ocr_engine"],
                "retrieval_authorized": False, "semantic_verified": False}
    if time.monotonic() >= deadline:
        raise DiagnosticError("original_visual_deadline_exceeded")
    check_cancel()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--pages", required=True)
    parser.add_argument("--expected-page-count", type=int)
    parser.add_argument("--dpi", type=int, default=250)
    parser.add_argument("--psm", type=int, default=11)
    parser.add_argument("--source-byte-limit", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--tesseract", help="Explicit installed absolute engine path; otherwise resolve PATH")
    parser.add_argument("--pdftoppm", help="Explicit installed absolute renderer path; otherwise resolve PATH")
    parser.add_argument("--include-text", action="store_true", help="Include OCR text in stdout only; never persist it automatically")
    parser.add_argument("--include-visual-observations", action="store_true", help="Return raw word/line pixel observations without evidence authority; never persist automatically")
    parser.add_argument("--raster-directory", help="Explicit existing directory for unique retained raster images only")
    parser.add_argument("--inspect", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        pages = [int(n) for n in args.pages.split(",")]
        output = inspect_pdf(args.inspect, pages) if args.inspect else diagnose(
            args.source, args.sha256, pages, expected_page_count=args.expected_page_count, dpi=args.dpi,
            psm=args.psm, include_text=args.include_text, raster_directory=args.raster_directory,
            source_byte_limit=args.source_byte_limit, tesseract=args.tesseract, pdftoppm=args.pdftoppm,
            include_visual_observations=args.include_visual_observations)
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except (DiagnosticError, OSError, ValueError) as exc:
        code = str(exc) if isinstance(exc, DiagnosticError) else "diagnostic_input_or_pdf_failure"
        print(json.dumps({"schema_version": SCHEMA, "state": "failed", "failure_code": code, "authority": "diagnostic_only"}))
        return 0 if args.inspect else 1


if __name__ == "__main__":
    raise SystemExit(main())
