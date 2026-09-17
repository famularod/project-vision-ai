"""Bounded sealed-original selected-page reader, not owner readiness.

The genuine local claim and sealed spool are required; no path, raw FD, source
bytes, engine command or environment can be supplied. The existing FD consumer
scans and measures first. Native/table/visual lanes use that same immutable
original without a whole-original Python buffer or temporary PDF snapshot.
Only derived PNGs use private scratch. memfd and engine working sets still use
cgroup memory. SQL action-time rechecks and artifact registration remain absent.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecos_indexer.owner_execution import OwnerExecutionResult
from ecos_indexer.owner_execution_gateway import OwnerExecutionGateway
from ecos_indexer.owner_original_spool import OwnerOriginalSpool, OwnerOriginalSpoolError, _assert_seals
from ecos_indexer.owner_original_fd_consumer import inspect_owner_original_spool, _inspect_descriptor
from ecos_indexer.owner_service_limits import OWNER_PAGE_READER_TIMEOUT_SECONDS
from ecos_indexer.original_document_reader import SCHEMA, MAX_PAGE_BYTES, MAX_BATCH_BYTES, _json_bytes, _failed
from ecos_indexer.original_page_image import SCHEMA as IMAGE_SCHEMA, COORDINATES, decode_original_page_image
from ecos_indexer.original_visual_reader import (
    DiagnosticError, LIMITATIONS, installed_engine, png_size, raster_size, run_bounded,
)
from ecos_indexer.page_visual_observations import parse_visual_observations, VisualObservationError

_TOKEN = "@ECOS_SEALED_ORIGINAL@"
_RENDERER = "/usr/bin/pdftoppm"
_OCR = "/usr/bin/tesseract"
_PAGE_KEYS = {"page_number", "rotation_degrees", "display_width_points", "display_height_points", "cropbox", "mediabox"}
_VISUAL_FAILURE_CODES = frozenset({
    "invalid_page_geometry", "raster_pixel_limit_exceeded", "invalid_rendered_png", "rendered_dimensions_mismatch",
    "unsupported_ocr_text_encoding", "subprocess_deadline_exceeded", "subprocess_output_limit_exceeded",
    "subprocess_failed", "subprocess_unavailable", "visual_observation_byte_limit", "visual_observation_confidence_invalid",
    "visual_observation_encoding_invalid", "visual_observation_engine_invalid", "visual_observation_geometry_invalid",
    "visual_observation_hierarchy_invalid", "visual_observation_invalid", "visual_observation_page_invalid",
    "visual_observation_page_missing", "visual_observation_projection_byte_limit", "visual_observation_raster_invalid",
    "visual_observation_raster_limit", "visual_observation_source_geometry_mismatch", "visual_observation_source_invalid",
    "visual_observation_tsv_invalid", "visual_observation_word_limit",
})


class OwnerOriginalFDPageReadError(Exception):
    def __init__(self, code, *, inspection_reason=None):
        self.code = code if code in {"invalid_request", "source_not_current", "cancelled", "deadline_exceeded",
            "source_integrity_failed", "source_inspection_failed", "page_payload_limit", "batch_retained_limit"} else "source_integrity_failed"
        self.partial_packet_returned = False
        self.diagnostic_reason = inspection_reason if type(inspection_reason) is str and inspection_reason in {
            "invalid_request", "source_not_current", "cancelled", "deadline_exceeded", "unsupported_kernel",
            "scan_not_clean", "scan_unavailable", "scan_limit_exceeded", "scan_size_limit",
            "scan_file_size_limit", "scan_file_count_limit", "scan_recursion_limit", "scan_time_limit",
            "pdf_identity_mismatch", "pdf_inspection_failed"} else self.code
        self.registration_performed = False
        self.retrieval_authorized = False
        super().__init__("Sealed original page reading not confirmed")


def _decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError()
            result[key] = value
        return result
    def constant(_): raise ValueError()
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_PAGE_BYTES: raise ValueError()
    result = json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=pairs, parse_constant=constant)
    _json_bytes(result)  # Reject nonfinite numeric overflow, including nested geometry.
    if type(result) is not dict or type(result.get("ok")) is not bool: raise ValueError()
    return result


def _geometry(page, number):
    if type(page) is not dict or page.keys() != _PAGE_KEYS: raise ValueError()
    if type(page["page_number"]) is not int or page["page_number"] != number: raise ValueError()
    if type(page["rotation_degrees"]) is not int or page["rotation_degrees"] not in (0, 90, 180, 270): raise ValueError()
    for name in ("display_width_points", "display_height_points"):
        value = page[name]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 100000: raise ValueError()
    for name in ("cropbox", "mediabox"):
        value = page[name]
        if (type(value) is not list or len(value) != 4 or
                any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 100000 for v in value)
                or value[2] <= value[0] or value[3] <= value[1]): raise ValueError()
    box = page["cropbox"]
    width, height = box[2]-box[0], box[3]-box[1]
    if page["rotation_degrees"] in (90, 270): width, height = height, width
    if abs(width-page["display_width_points"]) > .01 or abs(height-page["display_height_points"]) > .01: raise ValueError()
    return page


def _observation(value, lane, measured, number, geometry):
    # Strict child wire inspection, not a new retrieval/semantic authority.
    common = {"schema_version", "extraction_version", "source_sha256", "source_page_count", "page_number",
        "page_width", "page_height", "coordinate_system", "state", "limitation_codes",
        "retrieval_authorized", "semantic_verified", "source_identity_basis"}
    fields = {"page_text", "page_text_sha256", "observed_native_block_count", "excerpts"} if lane == "native" else {"tables"}
    if (type(value) is not dict or value.keys() != common | fields
            or value["schema_version"] != f"ecos-original-{'native' if lane == 'native' else 'table'}-observations/2.1"
            or value["extraction_version"] != ("ecos-native-page-excerpts/2.0" if lane == "native" else "ecos-native-table-sources/2.0")
            or value["source_sha256"] != measured["source_sha256"]
            or type(value["source_page_count"]) is not int or value["source_page_count"] != measured["source_page_count"]
            or type(value["page_number"]) is not int or value["page_number"] != number
            or value["coordinate_system"] != "pdf_points_top_left" or value["state"] not in ("partial", "unreadable", "failed")
            or value["retrieval_authorized"] is not False or value["semantic_verified"] is not False
            or value["source_identity_basis"] != "caller_supplied_pins_require_measured_bytes"
            or type(value["limitation_codes"]) is not list or not 3 <= len(value["limitation_codes"]) <= 16
            or any(type(v) is not str or not re.fullmatch(r"[a-z0-9_]{1,200}", v) for v in value["limitation_codes"])): raise ValueError()
    w, h = value["page_width"], value["page_height"]
    if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 < v <= 100000 for v in (w, h)): raise ValueError()
    if geometry is not None:
        crop = geometry["cropbox"]
        if abs(w-(crop[2]-crop[0])) > .01 or abs(h-(crop[3]-crop[1])) > .01: raise ValueError()
    def box(v, parent=None):
        if (type(v) is not list or len(v) != 4 or any(type(n) not in (int, float) or not math.isfinite(n) for n in v)
                or not 0 <= v[0] < v[2] <= w or not 0 <= v[1] < v[3] <= h): raise ValueError()
        if parent and not (parent[0] <= v[0] < v[2] <= parent[2] and parent[1] <= v[1] < v[3] <= parent[3]): raise ValueError()
    if lane == "native":
        text, excerpts, count = value["page_text"], value["excerpts"], value["observed_native_block_count"]
        if (type(text) is not str or "\0" in text or len(text.encode("utf-8")) > 128*1024
                or hashlib.sha256(text.encode("utf-8")).hexdigest() != value["page_text_sha256"]
                or type(count) is not int or not 0 <= count <= 9007199254740991
                or type(excerpts) is not list or len(excerpts) > 256): raise ValueError()
        if value["state"] != "partial":
            if text or excerpts: raise ValueError()
        elif not text.strip() or count != len(excerpts) or not excerpts: raise ValueError()
        end = 0
        for index, excerpt in enumerate(excerpts, 1):
            if (type(excerpt) is not dict or excerpt.keys() != {"excerpt_id", "block_ordinal", "text_start", "text_end", "bbox"}
                    or excerpt["excerpt_id"] != f"page:{number}:block:{index}"
                    or type(excerpt["block_ordinal"]) is not int or excerpt["block_ordinal"] != index
                    or type(excerpt["text_start"]) is not int or excerpt["text_start"] != end+(1 if index > 1 else 0)
                    or type(excerpt["text_end"]) is not int or not excerpt["text_start"] < excerpt["text_end"] <= len(text)): raise ValueError()
            if index > 1 and text[end:excerpt["text_start"]] != "\n": raise ValueError()
            part = text[excerpt["text_start"]:excerpt["text_end"]]
            if not part.strip() or len(part.encode("utf-8")) > 16*1024: raise ValueError()
            box(excerpt["bbox"]); end = excerpt["text_end"]
        if excerpts and end != len(text): raise ValueError()
    else:
        tables = value["tables"]
        if type(tables) is not list or len(tables) > 16 or (bool(tables) != (value["state"] == "partial")): raise ValueError()
        cells = 0; text_bytes = 0
        for index, table in enumerate(tables, 1):
            if (type(table) is not dict or table.keys() != {"table_id", "bbox", "rows"}
                    or table["table_id"] != f"page:{number}:table:{index}" or type(table["rows"]) is not list
                    or not 1 <= len(table["rows"]) <= 256): raise ValueError()
            box(table["bbox"]); columns = None; seen = set()
            for r, row in enumerate(table["rows"], 1):
                if (type(row) is not dict or row.keys() != {"row_number", "cells"} or type(row["row_number"]) is not int
                        or row["row_number"] != r or type(row["cells"]) is not list or not 1 <= len(row["cells"]) <= 32): raise ValueError()
                if columns is not None and columns != len(row["cells"]): raise ValueError()
                columns = len(row["cells"]); cells += columns
                if cells > 4096: raise ValueError()
                for c, cell in enumerate(row["cells"], 1):
                    if (type(cell) is not dict or cell.keys() != {"column_number", "bbox", "text"}
                            or type(cell["column_number"]) is not int or cell["column_number"] != c): raise ValueError()
                    if cell["bbox"] is None:
                        if cell["text"] is not None: raise ValueError()
                    else:
                        box(cell["bbox"], table["bbox"]); exact = tuple(cell["bbox"])
                        if exact in seen: raise ValueError()
                        seen.add(exact)
                        if type(cell["text"]) is not str or "\0" in cell["text"]: raise ValueError()
                        size = len(cell["text"].encode("utf-8")); text_bytes += size
                        if size > 16*1024 or text_bytes > 256*1024: raise ValueError()
    return {"state": value["state"], "observations": value, "limitation_codes": list(value["limitation_codes"])}


def _descriptor_page(path, digest, length, count, number, lane):
    """Fixed child only; the parent supplies one readonly sealed descriptor."""
    try:
        measured = _inspect_descriptor(path, digest, length, count)
    except Exception:
        return {"ok": False, "code": "original_snapshot_changed"}
    if type(number) is not int or not 1 <= number <= count or lane not in ("geometry", "native", "table"):
        return {"ok": False, "code": "original_page_request_invalid"}
    import pymupdf as fitz
    from ecos_indexer.page_source_excerpts import extract_original_page_observations
    from ecos_indexer.page_table_sources import extract_original_table_observations
    fd = int(path.rsplit("/", 1)[1])
    try: before = os.fstat(fd)
    except Exception: return {"ok": False, "code": "original_snapshot_changed"}
    with fitz.open(path, filetype="pdf") as document:
        if document.needs_pass or not document.is_pdf or document.page_count != count:
            return {"ok": False, "code": "original_pdf_identity_invalid"}
        page = document[number-1]
        if lane == "geometry":
            value = _geometry({"page_number": number, "rotation_degrees": page.rotation,
                "display_width_points": page.rect.width, "display_height_points": page.rect.height,
                "cropbox": list(page.cropbox), "mediabox": list(page.mediabox)}, number)
        else:
            extractor = extract_original_page_observations if lane == "native" else extract_original_table_observations
            value = extractor(page, source_sha256=digest, source_page_count=count, page_number=number)
    try: _assert_seals(fd); after = os.fstat(fd)
    except Exception: return {"ok": False, "code": "original_snapshot_changed"}
    if (before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size):
        return {"ok": False, "code": "original_snapshot_changed"}
    return {"ok": True, "measurement": measured, "observations": value}


def _invoke(original, measured, number, lane, timeout, cancel_event):
    raw, _ = run_bounded([sys.executable, "-B", str(Path(__file__).resolve()), _TOKEN,
        measured["source_sha256"], str(measured["byte_length"]), str(measured["source_page_count"]), str(number), lane],
        timeout, MAX_PAGE_BYTES, cancel_event=cancel_event, _original_spool=original)
    return _decode(raw)


def _engine(name, command, option, execute):
    executable, identity = installed_engine(name, command)
    out, err = execute([executable, option], 16384, 5)
    version = (out+err).decode("utf-8", "strict").splitlines()[0][:256]
    return executable, {**identity, "version": version}


def _renderer_engine(execute):return _engine("pdftoppm", _RENDERER, "-v", execute)
def _ocr_engine(execute):return _engine("tesseract", _OCR, "--version", execute)


def _engines(execute):
    renderer, renderer_identity = installed_engine("pdftoppm", _RENDERER)
    ocr, ocr_identity = installed_engine("tesseract", _OCR)
    versions = {}
    for name, argv, identity in (("renderer", [renderer, "-v"], renderer_identity),
                                 ("ocr", [ocr, "--version"], ocr_identity)):
        out, err = execute(argv, 16384, 5)
        version = (out+err).decode("utf-8", "strict").splitlines()[0][:256]
        versions[name] = {**identity, "version": version}
    return renderer, ocr, versions


def _render(original, measured, page, renderer, identity, directory, execute, check, dpi):
    limitations = list(LIMITATIONS)
    width, height = raster_size(page["display_width_points"], page["display_height_points"], dpi, 16_000_000, 6000)
    raster, _ = execute([renderer, "-q", "-scale-dimension-before-rotation", "-f", str(page["page_number"]),
        "-l", str(page["page_number"]), "-singlefile", "-cropbox", "-gray", "-r", str(dpi),
        "-scale-to-x", str(width), "-scale-to-y", str(height), "-png", _TOKEN], 32*1024*1024, original=original)
    if png_size(raster, 16_000_000, 6000) != (width, height):raise DiagnosticError("rendered_dimensions_mismatch")
    digest = hashlib.sha256(raster).hexdigest()
    path = directory / f"page-{page['page_number']}.png"
    path.write_bytes(raster);check()
    with path.open("rb") as stream:actual = stream.read(32*1024*1024+1)
    if len(actual) != len(raster) or hashlib.sha256(actual).hexdigest() != digest:
        raise OwnerOriginalFDPageReadError("source_integrity_failed")
    effective_dpi = min(width*72/page["display_width_points"], height*72/page["display_height_points"])
    if effective_dpi+1 < dpi:limitations.append("raster_resolution_reduced_to_fit_budget")
    raw = None
    if identity is not None:
        metadata = {"schema_version": IMAGE_SCHEMA, "source_sha256": measured["source_sha256"],
            "source_page_count": measured["source_page_count"], "page_number": page["page_number"], "state": "rendered",
            "raster_sha256": digest, "raster_byte_count": len(raster), "raster_width": width, "raster_height": height,
            "coordinate_system": COORDINATES, "renderer_sha256": identity["invoked_executable_sha256"],
            "renderer_version": identity["version"], "requested_dpi": dpi, "ocr_attempted": False,
            "semantic_verified": False, "retrieval_authorized": False}
        raw = _json_bytes(metadata).decode("utf-8")
        decode_original_page_image(raw, source_sha256=measured["source_sha256"],
            source_page_count=measured["source_page_count"], page_number=page["page_number"])
    return raster, path, raw, effective_dpi, limitations


def _ocr_visual(raster, path, measured, page, ocr, identity, execute, check, psm, effective_dpi, limitations):
    command = [ocr, str(path), "stdout", "-l", "eng", "--dpi", str(max(72, round(effective_dpi))), "--oem", "1", "--psm", str(psm)]
    text, _ = execute(command, 262144)
    try:
        decoded = text.decode("utf-8", "strict")
        if "\0" in decoded:raise UnicodeError()
    except UnicodeError:raise DiagnosticError("unsupported_ocr_text_encoding") from None
    if not decoded.strip():limitations.append("ocr_no_text_detected_not_verified_empty")
    raw_tsv, _ = execute([*command, "tsv"], 1024*1024)
    with path.open("rb") as stream:actual = stream.read(32*1024*1024+1)
    if len(actual) != len(raster) or hashlib.sha256(actual).hexdigest() != hashlib.sha256(raster).hexdigest():
        raise OwnerOriginalFDPageReadError("source_integrity_failed")
    observations = parse_visual_observations(raw_tsv, raster, source={
        "source_sha256": measured["source_sha256"], "source_page_count": measured["source_page_count"], **page},
        engine={"name": "tesseract", "version": identity["version"], "language": "eng", "oem": 1,
                "psm": psm, "invoked_executable_sha256": identity["invoked_executable_sha256"]})
    check()
    return {"state": observations["state"], "observations": observations, "limitation_codes": limitations}


def _visual(original, measured, page, engines, directory, execute, check, dpi, psm):
    renderer, ocr, versions = engines
    raster, path, _, effective_dpi, limitations = _render(original, measured, page, renderer,
        None, directory, execute, check, dpi)
    return _ocr_visual(raster, path, measured, page, ocr, versions["ocr"], execute, check, psm,
                       effective_dpi, limitations), raster


def read_owner_original_spool_pages(gateway: OwnerExecutionGateway, claim: OwnerExecutionResult,
                                    original: OwnerOriginalSpool, *, pages: list[int],
                                    total_timeout: float = 100, stage_timeout: float = 20,
                                    dpi: int = 250, psm: int = 11,
                                    cancel_event: threading.Event | None = None,
                                    caller_cancel_event: threading.Event | None = None,
                                    independent_images: bool = False,
                                    scanner_service=None) -> dict:
    """Exact legacy-neutral raw batch; no legacy job or authority is made.

    Scan, inspection, every child, raster scratch/readback and final assembly
    share the fixed background reader budget. Failed lanes remain visible; source/identity or
    whole-budget failure returns no packet. Caller still owns spool.close().
    Currentness means the genuine local claim, not a new SQL authorization.
    Bounds cover retained representations, not whole-process/cgroup memory.
    Default False returns the unchanged /2.1 packet. True returns a /2.2
    packet with a source-pinned rendered-image lane that survives OCR failure.
    """
    started = time.monotonic()
    try:
        if (type(gateway) is not OwnerExecutionGateway or type(claim) is not OwnerExecutionResult
                or type(original) is not OwnerOriginalSpool
                or any(event is not None and type(event) is not threading.Event
                       for event in (cancel_event, caller_cancel_event))
                or any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in (total_timeout, stage_timeout))
                or total_timeout > OWNER_PAGE_READER_TIMEOUT_SECONDS or stage_timeout > 60
                or type(dpi) is not int or not 72 <= dpi <= 400 or type(psm) is not int or psm not in (3, 6, 11)
                or type(independent_images) is not bool):
            raise ValueError()
        identity = gateway.require_download_identity(claim); pins = original.pins
        if (original.closed or pins["request"] != identity.request or pins["claim_id"] != claim.payload["claim"]["claim_id"]
                or pins["binding_version"] != claim.payload["binding_version"] or pins["byte_length"] != identity.expected_byte_length
                or pins["source_sha256"] != identity.request["source_sha256"] or pins["object_key"] != identity.object_key): raise ValueError()
        count = identity.request["source_page_count"]
        if (type(pages) is not list or not 1 <= len(pages) <= 8 or
                any(type(p) is not int or not 1 <= p <= count for p in pages) or pages != sorted(set(pages))): raise ValueError()
        selected = list(pages)
    except Exception: raise OwnerOriginalFDPageReadError("invalid_request") from None
    deadline = started+total_timeout
    def check():
        if any(event is not None and threading.Event.is_set(event)
               for event in (cancel_event, caller_cancel_event)): raise OwnerOriginalFDPageReadError("cancelled")
        if time.monotonic() >= deadline: raise OwnerOriginalFDPageReadError("deadline_exceeded")
        try:
            if gateway.require_download_identity(claim) is not identity or original.closed or original.pins is not pins: raise ValueError()
        except Exception: raise OwnerOriginalFDPageReadError("source_not_current") from None
        remaining = deadline-time.monotonic()
        if remaining <= 0: raise OwnerOriginalFDPageReadError("deadline_exceeded")
        return remaining
    check()
    # Existing bounded runners poll Event.is_set(). Give them a private exact
    # Event with a trusted predicate, not the caller's shadowable method. This
    # also stops the child group when this local claim expires; no watcher can
    # lag behind the caller, and no external callback or new signal API exists.
    child_cancel = threading.Event()
    def child_stopped():
        try: check(); return False
        except OwnerOriginalFDPageReadError: return True
    child_cancel.is_set = child_stopped
    measured = {"source_sha256": pins["source_sha256"], "source_page_count": count, "byte_length": pins["byte_length"]}
    try:
        from ecos_indexer.owner_service_limits import OWNER_INSPECTION_TIMEOUT_SECONDS
        inspection = inspect_owner_original_spool(gateway, claim, original, total_timeout=min(OWNER_INSPECTION_TIMEOUT_SECONDS, check()),
            cancel_event=child_cancel, scanner_service=scanner_service)
        check()
        if dict(inspection["measurement"]) != measured or inspection["source_pins"] is not pins: raise ValueError()
    except Exception as error:
        check()
        from ecos_indexer.owner_original_fd_consumer import OwnerOriginalFDConsumerError
        reason = error.code if type(error) is OwnerOriginalFDConsumerError else None
        raise OwnerOriginalFDPageReadError("source_inspection_failed", inspection_reason=reason) from None
    def execute(argv, limit, timeout=None, *, original=None):
        left = check()
        try:
            result = run_bounded(argv, min(stage_timeout if timeout is None else timeout, left), limit,
                cancel_event=child_cancel, _original_spool=original)
        except OwnerOriginalSpoolError:
            check()
            raise OwnerOriginalFDPageReadError("source_integrity_failed") from None
        except Exception:
            check(); raise
        check(); return result
    engines = None; renderer = None; ocr = None
    try:
        if independent_images:
            renderer = _renderer_engine(execute)
            try:ocr = _ocr_engine(execute)
            except OwnerOriginalFDPageReadError:raise
            except Exception:check()
        else:engines = _engines(execute)
    except OwnerOriginalFDPageReadError:raise
    except Exception:check()  # Keep native/table even if visual rendering is unavailable.
    entries = []; images = []; retained = 0
    with tempfile.TemporaryDirectory(prefix="ecos-sealed-page-rasters-") as directory:
        root = Path(directory)
        for number in selected:
            check(); item = {"page_number": number}; geometry = None
            for lane in ("geometry", "native", "table"):
                check()
                try:
                    result = _invoke(original, measured, number, lane, min(stage_timeout, check()), child_cancel)
                except OwnerOriginalSpoolError:
                    # A loan/seal/close failure is not a parser limitation. The
                    # shared runner has already attempted child-group cleanup;
                    # never return another lane as a successful source packet.
                    check()
                    raise OwnerOriginalFDPageReadError("source_integrity_failed") from None
                except OwnerOriginalFDPageReadError: raise
                except Exception:
                    check()
                    if lane != "geometry": item[lane] = _failed(f"original_{lane}_parser_failed")
                    continue
                check()
                if result.get("code") in ("original_snapshot_changed", "original_pdf_identity_invalid"):
                    raise OwnerOriginalFDPageReadError("source_integrity_failed")
                if result.get("ok") is not True:
                    if lane != "geometry": item[lane] = _failed(f"original_{lane}_parser_failed")
                    continue
                observed = result.get("observations")
                try:
                    if result.keys() != {"ok", "measurement", "observations"} or result["measurement"] != measured: raise ValueError()
                    if (type(result["measurement"]) is not dict or any(type(result["measurement"][key]) is not int
                            for key in ("source_page_count", "byte_length"))): raise ValueError()
                    if lane == "geometry": geometry = _geometry(observed, number)
                    else:
                        item[lane] = _observation(observed, lane, measured, number, geometry)
                except Exception: raise OwnerOriginalFDPageReadError("source_integrity_failed") from None
            raster = None; image = {"page_number":number,"image_payload_json":None,"raster_png":None}
            if independent_images and renderer is not None and geometry is not None:
                try:
                    independent, path, image_raw, effective_dpi, limitations = _render(original, measured, geometry,
                        renderer[0], renderer[1], root, execute, check, dpi)
                    image = {"page_number":number,"image_payload_json":image_raw,"raster_png":independent}
                    if ocr is None:item["visual"] = _failed("original_visual_parser_failed")
                    else:
                        try:
                            item["visual"] = _ocr_visual(independent, path, measured, geometry, ocr[0], ocr[1], execute,
                                check, psm, effective_dpi, limitations);raster = independent
                        except OwnerOriginalFDPageReadError:raise
                        except (DiagnosticError, VisualObservationError, OSError, ValueError) as error:
                            check();code = str(error) if isinstance(error,(DiagnosticError,VisualObservationError)) else ""
                            if code not in _VISUAL_FAILURE_CODES:code = "original_visual_parser_failed"
                            item["visual"] = {"state":"failed","observations":None,"limitation_codes":[*LIMITATIONS,code]}
                except OwnerOriginalFDPageReadError:raise
                except (DiagnosticError, OSError, ValueError) as error:
                    check();code = str(error) if isinstance(error,DiagnosticError) else ""
                    if code not in _VISUAL_FAILURE_CODES:code = "original_visual_parser_failed"
                    item["visual"] = {"state":"failed","observations":None,"limitation_codes":[*LIMITATIONS,code]}
            elif independent_images:item["visual"] = _failed("original_visual_parser_failed")
            elif engines is None or geometry is None:item["visual"] = _failed("original_visual_parser_failed")
            else:
                try:
                    item["visual"], raster = _visual(original, measured, geometry, engines, root, execute, check, dpi, psm)
                except OwnerOriginalFDPageReadError: raise
                except (DiagnosticError, VisualObservationError, OSError, ValueError) as error:
                    check()
                    code = str(error) if isinstance(error, (DiagnosticError, VisualObservationError)) else ""
                    if code not in _VISUAL_FAILURE_CODES: code = "original_visual_parser_failed"
                    item["visual"] = {"state": "failed", "observations": None, "limitation_codes": [*LIMITATIONS, code]}
            check()
            payload = {"schema_version": "ecos-original-page-observations/2.1", **measured, **item,
                       "retrieval_authorized": False, "semantic_verified": False}
            encoded = _json_bytes(payload)
            if len(encoded) > MAX_PAGE_BYTES: raise OwnerOriginalFDPageReadError("page_payload_limit")
            entry = {"payload": payload, "payload_sha256": hashlib.sha256(encoded).hexdigest(),
                     "payload_json": encoded.decode("utf-8"), "raster_png": raster}
            retained += len(_json_bytes({**entry, "raster_png": None}))+(len(raster) if raster is not None else 0)
            if independent_images:
                retained += len(_json_bytes({**image,"raster_png":None}))+(len(image["raster_png"]) if image["raster_png"] is not None else 0)
            if retained > MAX_BATCH_BYTES: raise OwnerOriginalFDPageReadError("batch_retained_limit")
            entries.append(entry)
            if independent_images:images.append(image)
            check()
    check()
    result = {"schema_version": SCHEMA, "measurement": measured, "selected_pages": selected,
            "coverage": "selected_pages_only", "pages": entries, "retrieval_authorized": False, "semantic_verified": False}
    if independent_images:result.update(schema_version="ecos-original-document-page-batch/2.2",images=images)
    return result


if __name__ == "__main__":
    try:
        if len(sys.argv) != 7: raise ValueError()
        with redirect_stdout(sys.stderr):
            result = _descriptor_page(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6])
        encoded = _json_bytes(result)
        if len(encoded) > MAX_PAGE_BYTES: raise ValueError()
        sys.stdout.buffer.write(encoded)
    except Exception:
        sys.stdout.write('{"ok":false,"code":"original_parser_failed"}')
