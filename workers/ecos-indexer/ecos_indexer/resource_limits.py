from __future__ import annotations

import os
import re
import signal
import threading
import time
import base64
import json
import multiprocessing
from multiprocessing.connection import Connection
from contextlib import contextmanager
from typing import Any, Iterator

from .visual_coverage import (
    MAX_VISUAL_TILE_PIXEL_DIMENSION as CONTRACT_MAX_VISUAL_TILE_PIXEL_DIMENSION,
    MAX_VISUAL_TILE_PIXELS as CONTRACT_MAX_VISUAL_TILE_PIXELS,
)


MAX_PDF_XREF_OBJECTS = max(
    10_000,
    min(1_000_000, int(os.getenv("ECOS_MAX_PDF_XREF_OBJECTS", "200000"))),
)
MAX_PAGE_REFERENCED_OBJECTS = max(
    256,
    min(100_000, int(os.getenv("ECOS_MAX_PAGE_REFERENCED_OBJECTS", "4096"))),
)
MAX_PAGE_DECLARED_STREAM_BYTES = max(
    1_000_000,
    min(
        250_000_000,
        int(os.getenv("ECOS_MAX_PAGE_DECLARED_STREAM_BYTES", "33554432")),
    ),
)
MAX_DECODED_TEXT_BLOCKS = max(
    1_000,
    min(500_000, int(os.getenv("ECOS_MAX_DECODED_TEXT_BLOCKS", "50000"))),
)
MAX_DECODED_TEXT_LINES = max(
    5_000,
    min(1_000_000, int(os.getenv("ECOS_MAX_DECODED_TEXT_LINES", "200000"))),
)
MAX_DECODED_TEXT_SPANS = max(
    10_000,
    min(2_000_000, int(os.getenv("ECOS_MAX_DECODED_TEXT_SPANS", "400000"))),
)
MAX_DECODED_TEXT_CHARACTERS = max(
    100_000,
    min(
        20_000_000,
        int(os.getenv("ECOS_MAX_DECODED_TEXT_CHARACTERS", "5000000")),
    ),
)
MAX_DECODED_VECTOR_PATHS = max(
    1_000,
    min(1_000_000, int(os.getenv("ECOS_MAX_VECTOR_PATHS_PER_PAGE", "200000"))),
)
MAX_DECODED_VECTOR_ITEMS = max(
    10_000,
    min(5_000_000, int(os.getenv("ECOS_MAX_VECTOR_ITEMS_PER_PAGE", "1000000"))),
)
STRUCTURAL_SCAN_TIMEOUT_SECONDS = max(
    5,
    min(120, int(os.getenv("ECOS_STRUCTURAL_SCAN_TIMEOUT_SECONDS", "30"))),
)
NATIVE_DECODE_TIMEOUT_SECONDS = max(
    2,
    min(120, int(os.getenv("ECOS_NATIVE_DECODE_TIMEOUT_SECONDS", "15"))),
)
PDF_RENDER_TIMEOUT_SECONDS = max(
    2,
    min(120, int(os.getenv("ECOS_PDF_RENDER_TIMEOUT_SECONDS", "30"))),
)
ISOLATED_PDF_MEMORY_BYTES = max(
    256 * 1024 * 1024,
    min(
        4 * 1024 * 1024 * 1024,
        int(os.getenv("ECOS_ISOLATED_PDF_MEMORY_BYTES", str(2 * 1024 * 1024 * 1024))),
    ),
)
ISOLATED_PDF_RESULT_BYTES = max(
    1 * 1024 * 1024,
    min(
        128 * 1024 * 1024,
        int(os.getenv("ECOS_ISOLATED_PDF_RESULT_BYTES", str(96 * 1024 * 1024))),
    ),
)
ISOLATED_PDF_EXIT_GRACE_SECONDS = 1.0
MAX_STRUCTURAL_TOC_ENTRIES = max(
    100,
    min(100_000, int(os.getenv("ECOS_MAX_STRUCTURAL_TOC_ENTRIES", "20000"))),
)
MAX_STRUCTURAL_ANNOTATIONS_PER_PAGE = max(
    32,
    min(
        100_000,
        int(os.getenv("ECOS_MAX_STRUCTURAL_ANNOTATIONS_PER_PAGE", "4096")),
    ),
)
MAX_PDF_RENDER_PIXEL_DIMENSION = max(
    1024,
    min(
        CONTRACT_MAX_VISUAL_TILE_PIXEL_DIMENSION,
        int(os.getenv("ECOS_MAX_VISUAL_TILE_PIXEL_DIMENSION", "6000")),
    ),
)
MAX_PDF_RENDER_PIXELS = max(
    1_000_000,
    min(
        CONTRACT_MAX_VISUAL_TILE_PIXELS,
        int(os.getenv("ECOS_MAX_VISUAL_TILE_PIXELS", "18000000")),
    ),
)

_ISOLATED_CHILD = False


class DocumentResourceRejected(RuntimeError):
    """The document exceeded a deterministic hosted-parser resource budget."""


@contextmanager
def resource_deadline(timeout_seconds: float, failure_code: str) -> Iterator[None]:
    """Bound one parser operation without extending an existing outer alarm.

    Hosted production runs on the main thread and can use ``SIGALRM`` to stop
    Python-visible parser/OCR work. Tests and non-main-thread callers retain a
    monotonic postcondition, so an operation that returns after its budget is
    still rejected rather than published.
    """

    timeout = max(0.001, float(timeout_seconds))
    started_at = time.monotonic()
    installed_alarm = False
    prior_handler: Any = None
    prior_delay = 0.0
    prior_interval = 0.0

    can_alarm = (
        threading.current_thread() is threading.main_thread()
        and hasattr(signal, "SIGALRM")
        and hasattr(signal, "setitimer")
        and hasattr(signal, "getitimer")
    )
    if can_alarm:
        prior_delay, prior_interval = signal.getitimer(signal.ITIMER_REAL)
        # A shorter outer page/job alarm remains authoritative. Do not replace
        # its handler or accidentally convert its timeout classification.
        if prior_delay <= 0 or timeout < prior_delay:
            prior_handler = signal.getsignal(signal.SIGALRM)

            def reject_on_timeout(_signum: int, _frame: Any) -> None:
                raise DocumentResourceRejected(failure_code)

            signal.signal(signal.SIGALRM, reject_on_timeout)
            signal.setitimer(signal.ITIMER_REAL, timeout)
            installed_alarm = True

    try:
        yield
    finally:
        elapsed = time.monotonic() - started_at
        if installed_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, prior_handler)
            if prior_delay > 0:
                signal.setitimer(
                    signal.ITIMER_REAL,
                    max(0.001, prior_delay - elapsed),
                    prior_interval,
                )

    if time.monotonic() - started_at > timeout:
        raise DocumentResourceRejected(failure_code)


def validate_document_object_budget(document: Any) -> None:
    xref_length = getattr(document, "xref_length", None)
    if not callable(xref_length):
        return
    try:
        object_count = int(xref_length())
    except (RuntimeError, TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_object_count_unavailable") from error
    if object_count < 1 or object_count > MAX_PDF_XREF_OBJECTS:
        raise DocumentResourceRejected("pdf_object_count_outside_limit")


def validate_page_object_budget(page: Any, document: Any | None = None) -> None:
    owner = document if document is not None else getattr(page, "parent", None)
    if owner is not None:
        validate_document_object_budget(owner)

    referenced_xrefs: set[int] = set()
    get_contents = getattr(page, "get_contents", None)
    if callable(get_contents):
        try:
            referenced_xrefs.update(int(value) for value in (get_contents() or []))
        except (RuntimeError, TypeError, ValueError) as error:
            raise DocumentResourceRejected("pdf_page_object_index_invalid") from error
    for method_name in ("get_xobjects", "get_images"):
        method = getattr(page, method_name, None)
        if not callable(method):
            continue
        try:
            values = method(full=True) if method_name == "get_images" else method()
            referenced_xrefs.update(
                int(value[0])
                for value in (values or [])
                if isinstance(value, (list, tuple)) and value
            )
        except (RuntimeError, TypeError, ValueError) as error:
            raise DocumentResourceRejected("pdf_page_object_index_invalid") from error

    if len(referenced_xrefs) > MAX_PAGE_REFERENCED_OBJECTS:
        raise DocumentResourceRejected("pdf_page_object_count_outside_limit")
    if owner is None or not referenced_xrefs:
        return

    declared_bytes = 0
    for xref in referenced_xrefs:
        declared_bytes += declared_stream_length(owner, xref)
        if declared_bytes > MAX_PAGE_DECLARED_STREAM_BYTES:
            raise DocumentResourceRejected("pdf_page_declared_stream_bytes_outside_limit")


def declared_stream_length(document: Any, xref: int) -> int:
    get_key = getattr(document, "xref_get_key", None)
    if not callable(get_key):
        return 0
    try:
        kind, raw_value = get_key(int(xref), "Length")
    except (RuntimeError, TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_stream_length_invalid") from error
    if kind == "null":
        return 0
    if kind == "int":
        try:
            value = int(raw_value)
        except (TypeError, ValueError) as error:
            raise DocumentResourceRejected("pdf_stream_length_invalid") from error
        if value < 0:
            raise DocumentResourceRejected("pdf_stream_length_invalid")
        return value
    if kind != "xref":
        raise DocumentResourceRejected("pdf_stream_length_unbounded")

    match = re.fullmatch(r"\s*([1-9]\d*)\s+\d+\s+R\s*", str(raw_value))
    get_object = getattr(document, "xref_object", None)
    if not match or not callable(get_object):
        raise DocumentResourceRejected("pdf_stream_length_unbounded")
    try:
        indirect_value = str(get_object(int(match.group(1)), compressed=False)).strip()
        value = int(indirect_value)
    except (RuntimeError, TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_stream_length_unbounded") from error
    if value < 0:
        raise DocumentResourceRejected("pdf_stream_length_invalid")
    return value


def bounded_text_dictionary(
    page: Any,
    *,
    flags: Any,
    document: Any | None = None,
) -> dict[str, Any]:
    source = pdf_decode_source(page)
    if source is not None and not _ISOLATED_CHILD:
        payload = run_isolated_pdf_operation(
            source,
            "text",
            page_number=page_number_for(page),
            flags=int(flags),
            timeout_seconds=NATIVE_DECODE_TIMEOUT_SECONDS,
            timeout_code="pdf_native_text_decode_timeout",
        )
    else:
        validate_page_object_budget(page, document)
        with resource_deadline(NATIVE_DECODE_TIMEOUT_SECONDS, "pdf_native_text_decode_timeout"):
            payload = page.get_text("dict", flags=flags)
    return normalize_text_dictionary(payload)


def normalize_text_dictionary(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise DocumentResourceRejected("pdf_native_text_payload_invalid")

    blocks = payload.get("blocks") or []
    if not isinstance(blocks, list) or len(blocks) > MAX_DECODED_TEXT_BLOCKS:
        raise DocumentResourceRejected("pdf_native_text_block_count_outside_limit")
    normalized_blocks: list[dict[str, Any]] = []
    line_count = 0
    span_count = 0
    character_count = 0
    for block in blocks:
        if not isinstance(block, dict):
            continue
        lines = block.get("lines") or []
        if not isinstance(lines, list):
            raise DocumentResourceRejected("pdf_native_text_payload_invalid")
        line_count += len(lines)
        if line_count > MAX_DECODED_TEXT_LINES:
            raise DocumentResourceRejected("pdf_native_text_line_count_outside_limit")
        normalized_lines: list[dict[str, Any]] = []
        for line in lines:
            if not isinstance(line, dict):
                continue
            spans = line.get("spans") or []
            if not isinstance(spans, list):
                raise DocumentResourceRejected("pdf_native_text_payload_invalid")
            span_count += len(spans)
            if span_count > MAX_DECODED_TEXT_SPANS:
                raise DocumentResourceRejected("pdf_native_text_span_count_outside_limit")
            normalized_spans: list[dict[str, str]] = []
            for span in spans:
                if isinstance(span, dict):
                    text = str(span.get("text") or "")
                    character_count += len(text)
                    if character_count > MAX_DECODED_TEXT_CHARACTERS:
                        raise DocumentResourceRejected(
                            "pdf_native_text_character_count_outside_limit",
                        )
                    normalized_spans.append({"text": text})
            normalized_line: dict[str, Any] = {"spans": normalized_spans}
            bbox = finite_box(line.get("bbox"))
            if bbox is not None:
                normalized_line["bbox"] = bbox
            normalized_lines.append(normalized_line)
        normalized_block: dict[str, Any] = {
            "type": safe_int(block.get("type"), default=-1),
            "lines": normalized_lines,
        }
        bbox = finite_box(block.get("bbox"))
        if bbox is not None:
            normalized_block["bbox"] = bbox
        normalized_blocks.append(normalized_block)
    return {"blocks": normalized_blocks}


def bounded_drawing_shapes(page: Any) -> list[dict[str, Any]]:
    source = pdf_decode_source(page)
    if source is not None and not _ISOLATED_CHILD:
        shapes = run_isolated_pdf_operation(
            source,
            "drawings",
            page_number=page_number_for(page),
            timeout_seconds=NATIVE_DECODE_TIMEOUT_SECONDS,
            timeout_code="pdf_vector_decode_timeout",
        )
    else:
        validate_page_object_budget(page)
        with resource_deadline(NATIVE_DECODE_TIMEOUT_SECONDS, "pdf_vector_decode_timeout"):
            shapes = page.get_drawings()
    return normalize_drawing_shapes(shapes)


def normalize_drawing_shapes(shapes: Any) -> list[dict[str, Any]]:
    if not isinstance(shapes, list) or len(shapes) > MAX_DECODED_VECTOR_PATHS:
        raise DocumentResourceRejected("pdf_page_vector_complexity_outside_limit")
    normalized_shapes: list[dict[str, Any]] = []
    item_count = 0
    for shape in shapes:
        if not isinstance(shape, dict):
            raise DocumentResourceRejected("pdf_vector_payload_invalid")
        items = shape.get("items") or []
        if not isinstance(items, list):
            raise DocumentResourceRejected("pdf_vector_payload_invalid")
        item_count += len(items)
        if item_count > MAX_DECODED_VECTOR_ITEMS:
            raise DocumentResourceRejected("pdf_page_vector_items_outside_limit")
        normalized_items: list[list[Any]] = []
        for item in items:
            if not isinstance(item, (list, tuple)) or not item:
                continue
            if item[0] != "l" or len(item) < 3:
                continue
            start = finite_point(item[1])
            end = finite_point(item[2])
            if start is not None and end is not None:
                normalized_items.append(["l", start, end])
        normalized_shape: dict[str, Any] = {"items": normalized_items}
        rect = finite_box(shape.get("rect"))
        if rect is not None:
            normalized_shape["rect"] = rect
        normalized_shapes.append(normalized_shape)
    return normalized_shapes


def bounded_page_render_png(
    page: Any,
    *,
    clip: Any,
    dpi: int,
    timeout_seconds: float = PDF_RENDER_TIMEOUT_SECONDS,
) -> tuple[bytes, int, int]:
    """Render one pre-sized clip outside the hosted worker process when possible."""

    clip_box = finite_box(clip)
    try:
        selected_dpi = int(dpi)
    except (TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_ocr_render_parameters_invalid") from error
    expected_width, expected_height = validate_render_pixel_budget(
        clip_box,
        selected_dpi,
    )

    source = pdf_decode_source(page)
    if source is not None and not _ISOLATED_CHILD:
        result = run_isolated_pdf_operation(
            source,
            "render",
            page_number=page_number_for(page),
            clip=clip_box,
            dpi=selected_dpi,
            timeout_seconds=timeout_seconds,
            timeout_code="pdf_ocr_render_timeout",
        )
        try:
            rendered = base64.b64decode(str(result["pngBase64"]), validate=True)
            width = int(result["width"])
            height = int(result["height"])
        except (KeyError, TypeError, ValueError) as error:
            raise DocumentResourceRejected("pdf_ocr_render_payload_invalid") from error
        if not rendered or width < 1 or height < 1:
            raise DocumentResourceRejected("pdf_ocr_render_empty")
        validate_rendered_dimensions(width, height, expected_width, expected_height)
        return rendered, width, height

    scale = selected_dpi / 72.0
    with resource_deadline(timeout_seconds, "pdf_ocr_render_timeout"):
        pixmap = page.get_pixmap(
            matrix=__import__("pymupdf").Matrix(scale, scale),
            clip=clip,
            alpha=False,
            colorspace=__import__("pymupdf").csRGB,
        )
        rendered = pixmap.tobytes("png")
    if not rendered or int(pixmap.width) < 1 or int(pixmap.height) < 1:
        raise DocumentResourceRejected("pdf_ocr_render_empty")
    validate_rendered_dimensions(
        int(pixmap.width),
        int(pixmap.height),
        expected_width,
        expected_height,
    )
    return rendered, int(pixmap.width), int(pixmap.height)


def validate_render_pixel_budget(
    clip_box: list[float] | None,
    dpi: int,
) -> tuple[int, int]:
    import math

    if clip_box is None or dpi < 1:
        raise DocumentResourceRejected("pdf_ocr_render_parameters_invalid")
    x0, y0, x1, y1 = clip_box
    scale = dpi / 72.0
    width = max(1, int(math.ceil(abs(x1 - x0) * scale)))
    height = max(1, int(math.ceil(abs(y1 - y0) * scale)))
    if (
        width > MAX_PDF_RENDER_PIXEL_DIMENSION
        or height > MAX_PDF_RENDER_PIXEL_DIMENSION
        or width * height > MAX_PDF_RENDER_PIXELS
    ):
        raise DocumentResourceRejected("pdf_ocr_render_pixels_outside_limit")
    return width, height


def validate_rendered_dimensions(
    width: int,
    height: int,
    expected_width: int,
    expected_height: int,
) -> None:
    if (
        width < 1
        or height < 1
        or width > MAX_PDF_RENDER_PIXEL_DIMENSION
        or height > MAX_PDF_RENDER_PIXEL_DIMENSION
        or width * height > MAX_PDF_RENDER_PIXELS
        # MuPDF rounding may differ by one pixel; anything larger indicates
        # that the child did not render the parent-approved clip geometry.
        or width > expected_width + 1
        or height > expected_height + 1
    ):
        raise DocumentResourceRejected("pdf_ocr_render_pixels_outside_limit")


def pdf_decode_source(target: Any) -> tuple[str, Any] | None:
    document = target if hasattr(target, "page_count") else getattr(target, "parent", None)
    if document is None:
        return None
    source_bytes = getattr(document, "_ecos_source_bytes", None)
    if isinstance(source_bytes, bytes) and source_bytes:
        return ("bytes", source_bytes)
    source_path = str(getattr(document, "name", "") or "").strip()
    if source_path and os.path.isfile(source_path):
        return ("path", source_path)
    return None


def page_number_for(page: Any) -> int:
    try:
        page_number = int(getattr(page, "number"))
    except (TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_page_number_invalid") from error
    if page_number < 0:
        raise DocumentResourceRejected("pdf_page_number_invalid")
    return page_number


def run_isolated_pdf_operation(
    source: tuple[str, Any],
    operation: str,
    *,
    timeout_seconds: float,
    timeout_code: str,
    **parameters: Any,
) -> Any:
    """Run an untrusted MuPDF materialization in a killable resource sandbox.

    Hosted workers are Linux processes, where ``fork`` lets the child inherit
    the already-downloaded immutable source without copying it through an IPC
    queue. The child reopens that source, applies hard CPU/address-space limits,
    normalizes the result, and emits at most one bounded JSON message. A crash,
    timeout, malformed response, or unsupported platform fails closed.
    """

    timeout = max(0.01, float(timeout_seconds))
    try:
        context = multiprocessing.get_context("fork")
    except ValueError as error:
        raise DocumentResourceRejected("pdf_isolation_unavailable") from error
    parent_connection, child_connection = context.Pipe(duplex=False)
    process = context.Process(
        target=_isolated_pdf_child,
        args=(child_connection, source, operation, parameters, timeout),
        daemon=True,
    )
    process.start()
    child_connection.close()
    try:
        if not parent_connection.poll(timeout):
            _terminate_isolated_process(process)
            raise DocumentResourceRejected(timeout_code)
        try:
            response_bytes = parent_connection.recv_bytes(ISOLATED_PDF_RESULT_BYTES)
        except EOFError as error:
            _terminate_isolated_process(process)
            raise DocumentResourceRejected("pdf_isolated_child_failed") from error
        except OSError as error:
            _terminate_isolated_process(process)
            raise DocumentResourceRejected("pdf_isolated_result_outside_limit") from error
        process.join(ISOLATED_PDF_EXIT_GRACE_SECONDS)
        if process.is_alive():
            _terminate_isolated_process(process)
            raise DocumentResourceRejected(timeout_code)
        try:
            response = json.loads(response_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DocumentResourceRejected("pdf_isolated_result_invalid") from error
        if not isinstance(response, dict) or response.get("ok") is not True:
            error_code = str(
                response.get("error") if isinstance(response, dict) else ""
            ).strip()
            if error_code.startswith("pdf_"):
                raise DocumentResourceRejected(error_code)
            raise DocumentResourceRejected("pdf_isolated_child_failed")
        return response.get("result")
    finally:
        parent_connection.close()
        if process.is_alive():
            _terminate_isolated_process(process)
        process.close()


def _terminate_isolated_process(process: Any) -> None:
    if not process.is_alive():
        process.join(timeout=ISOLATED_PDF_EXIT_GRACE_SECONDS)
        return
    process.terminate()
    process.join(timeout=ISOLATED_PDF_EXIT_GRACE_SECONDS)
    if process.is_alive() and hasattr(process, "kill"):
        process.kill()
        process.join(timeout=ISOLATED_PDF_EXIT_GRACE_SECONDS)


def _isolated_pdf_child(
    connection: Connection,
    source: tuple[str, Any],
    operation: str,
    parameters: dict[str, Any],
    timeout_seconds: float,
) -> None:
    global _ISOLATED_CHILD
    _ISOLATED_CHILD = True
    try:
        _apply_child_resource_limits(timeout_seconds)
        result = _isolated_pdf_dispatch(source, operation, parameters)
        response = {"ok": True, "result": result}
    except DocumentResourceRejected as error:
        response = {"ok": False, "error": str(error)}
    except MemoryError:
        response = {"ok": False, "error": "pdf_isolated_memory_limit"}
    except BaseException:
        response = {"ok": False, "error": "pdf_isolated_child_failed"}
    try:
        encoded = json.dumps(
            response,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        if len(encoded) > ISOLATED_PDF_RESULT_BYTES:
            encoded = b'{"error":"pdf_isolated_result_outside_limit","ok":false}'
        connection.send_bytes(encoded)
    except BaseException:
        pass
    finally:
        connection.close()


def _apply_child_resource_limits(timeout_seconds: float) -> None:
    try:
        import resource

        if hasattr(resource, "RLIMIT_AS"):
            current_virtual_bytes = _current_virtual_memory_bytes()
            memory_ceiling = current_virtual_bytes + ISOLATED_PDF_MEMORY_BYTES
            _soft_limit, hard_limit = resource.getrlimit(resource.RLIMIT_AS)
            if hard_limit != resource.RLIM_INFINITY:
                memory_ceiling = min(memory_ceiling, hard_limit)
            if memory_ceiling <= current_virtual_bytes:
                raise DocumentResourceRejected("pdf_isolation_limit_unavailable")
            resource.setrlimit(
                resource.RLIMIT_AS,
                (memory_ceiling, memory_ceiling),
            )
        cpu_seconds = max(1, int(timeout_seconds) + 1)
        if hasattr(resource, "RLIMIT_CPU"):
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        if hasattr(resource, "RLIMIT_FSIZE"):
            resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        if hasattr(resource, "RLIMIT_NOFILE"):
            current_soft, current_hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            descriptor_limit = min(current_soft, current_hard, 64)
            resource.setrlimit(resource.RLIMIT_NOFILE, (descriptor_limit, descriptor_limit))
    except (ImportError, OSError, ValueError) as error:
        raise DocumentResourceRejected("pdf_isolation_limit_unavailable") from error


def _current_virtual_memory_bytes() -> int:
    """Return inherited VM so RLIMIT_AS can cap growth on Linux and macOS.

    macOS reserves a very large sparse address range for the Python runtime;
    an absolute 2 GiB RLIMIT_AS would therefore reject before MuPDF runs. The
    child instead receives a hard, configured growth allowance over the VM it
    inherited at fork. Linux obtains the same conservative baseline from proc.
    """

    try:
        with open("/proc/self/statm", "r", encoding="ascii") as handle:
            page_count = int(handle.read().split()[0])
        return max(0, page_count * int(os.sysconf("SC_PAGE_SIZE")))
    except (FileNotFoundError, IndexError, OSError, TypeError, ValueError):
        pass
    try:
        import subprocess

        raw_kib = subprocess.check_output(
            ["/bin/ps", "-o", "vsz=", "-p", str(os.getpid())],
            text=True,
            timeout=2,
        ).strip()
        return max(0, int(raw_kib) * 1024)
    except (OSError, subprocess.SubprocessError, TypeError, ValueError) as error:
        raise DocumentResourceRejected("pdf_isolation_limit_unavailable") from error


def _isolated_pdf_dispatch(
    source: tuple[str, Any],
    operation: str,
    parameters: dict[str, Any],
) -> Any:
    import pymupdf as fitz

    source_kind, source_value = source
    if source_kind == "bytes" and isinstance(source_value, bytes):
        document = fitz.open(stream=source_value, filetype="pdf")
    elif source_kind == "path" and isinstance(source_value, str):
        document = fitz.open(source_value)
    else:
        raise DocumentResourceRejected("pdf_isolated_source_invalid")
    try:
        validate_document_object_budget(document)
        if operation == "structure":
            from .document_structure import _document_sheet_identity_map_direct

            mapping = _document_sheet_identity_map_direct(document)
            return {
                str(page_number): identity.as_dict()
                for page_number, identity in mapping.items()
            }

        try:
            page_number = int(parameters["page_number"])
            page = document.load_page(page_number)
        except (KeyError, RuntimeError, TypeError, ValueError) as error:
            raise DocumentResourceRejected("pdf_page_number_invalid") from error
        validate_page_object_budget(page, document)

        if operation == "text":
            flags = int(parameters.get("flags", fitz.TEXTFLAGS_TEXT))
            return normalize_text_dictionary(page.get_text("dict", flags=flags))
        if operation == "drawings":
            return normalize_drawing_shapes(page.get_drawings())
        if operation == "render":
            box = finite_box(parameters.get("clip"))
            try:
                dpi = int(parameters["dpi"])
            except (KeyError, TypeError, ValueError) as error:
                raise DocumentResourceRejected("pdf_ocr_render_parameters_invalid") from error
            expected_width, expected_height = validate_render_pixel_budget(box, dpi)
            clip = fitz.Rect(*box)
            scale = dpi / 72.0
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(scale, scale),
                clip=clip,
                alpha=False,
                colorspace=fitz.csRGB,
            )
            rendered = pixmap.tobytes("png")
            if not rendered:
                raise DocumentResourceRejected("pdf_ocr_render_empty")
            validate_rendered_dimensions(
                int(pixmap.width),
                int(pixmap.height),
                expected_width,
                expected_height,
            )
            return {
                "pngBase64": base64.b64encode(rendered).decode("ascii"),
                "width": int(pixmap.width),
                "height": int(pixmap.height),
            }
        raise DocumentResourceRejected("pdf_isolated_operation_invalid")
    finally:
        document.close()


def finite_point(value: Any) -> list[float] | None:
    import math

    try:
        if hasattr(value, "x") and hasattr(value, "y"):
            result = [float(value.x), float(value.y)]
        else:
            result = [float(value[0]), float(value[1])]
    except (AttributeError, IndexError, TypeError, ValueError):
        return None
    return result if all(math.isfinite(item) for item in result) else None


def finite_box(value: Any) -> list[float] | None:
    import math

    try:
        if all(hasattr(value, key) for key in ("x0", "y0", "x1", "y1")):
            result = [float(value.x0), float(value.y0), float(value.x1), float(value.y1)]
        else:
            result = [float(value[index]) for index in range(4)]
    except (AttributeError, IndexError, TypeError, ValueError):
        return None
    return result if all(math.isfinite(item) for item in result) else None


def safe_int(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
