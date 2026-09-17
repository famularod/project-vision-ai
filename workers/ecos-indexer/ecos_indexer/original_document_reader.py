"""One measured-original page reader for native text, ruled tables and images.

This module has no database, network, owner or HostedJob authority. The owner
worker must independently download, bind, register and checkpoint its result.
Every selected physical page remains present, with each lane's actual outcome.
Partial content is not complete coverage or verified construction guidance.
"""
from __future__ import annotations

import hashlib
from contextlib import redirect_stdout
import json
import math
from pathlib import Path
import re
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecos_indexer.original_visual_reader import DiagnosticError, read_original_visual_pages, run_bounded

SCHEMA = "ecos-original-document-page-batch/2.1"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PAGE_BYTES = 6 * 1024 * 1024
MAX_BATCH_BYTES = 64 * 1024 * 1024


class OriginalReadError(Exception):
    """Fixed non-sensitive processing failures, not answer insufficiency."""


def _json_bytes(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def _measurement(data: bytes, page_count: int) -> dict:
    return {"source_sha256": hashlib.sha256(data).hexdigest(),
            "source_page_count": page_count, "byte_length": len(data)}


def _child(path: str, digest: str, count: int, page_number: int, lane: str) -> dict:
    # Private parent snapshot; hash and parse exactly the captured bytes, not a
    # second path reopen. Child isolation bounds native parser wall time.
    import pymupdf as fitz
    from ecos_indexer.page_source_excerpts import extract_original_page_observations
    from ecos_indexer.page_table_sources import extract_original_table_observations
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_SOURCE_BYTES + 1)
    if not data or len(data) > MAX_SOURCE_BYTES or hashlib.sha256(data).hexdigest() != digest:
        return {"ok": False, "code": "original_snapshot_changed"}
    with fitz.open(stream=data, filetype="pdf") as document:
        if document.needs_pass or not document.is_pdf or document.page_count != count:
            return {"ok": False, "code": "original_pdf_identity_invalid"}
        measurement = _measurement(data, document.page_count)
        if lane == "inspect":
            return {"ok": True, "measurement": measurement}
        if lane not in ("native", "table") or not 1 <= page_number <= document.page_count:
            return {"ok": False, "code": "original_page_request_invalid"}
        extractor = extract_original_page_observations if lane == "native" else extract_original_table_observations
        observed = extractor(document[page_number - 1], source_sha256=digest,
                             source_page_count=count, page_number=page_number)
        return {"ok": True, "measurement": measurement, "observations": observed}


def _invoke(path: Path, digest: str, count: int, page: int, lane: str,
            timeout: float, *, cancel_event: threading.Event | None = None) -> dict:
    raw, _ = run_bounded([sys.executable, "-B", str(Path(__file__).resolve()),
                          str(path), digest, str(count), str(page), lane],
                         timeout, MAX_PAGE_BYTES, cancel_event=cancel_event)
    try:
        result = json.loads(raw.decode("utf-8"))
        if type(result) is not dict or type(result.get("ok")) is not bool:
            raise ValueError()
        return result
    except (ValueError, UnicodeError):
        raise OriginalReadError("original_parser_response_invalid") from None


def _failed(code: str) -> dict:
    return {"state": "failed", "observations": None, "limitation_codes": [code]}


def read_original_document_pages(original: bytes, *, expected_sha256: str,
                                 expected_page_count: int, pages: list[int],
                                 total_timeout: float = 100, stage_timeout: float = 20,
                                 dpi: int = 250, psm: int = 11,
                                 cancel_event: threading.Event | None = None) -> dict:
    """Measure and read all THREE modalities, including nonempty native pages.

    Native/table extraction runs in killable subprocesses; image processing
    uses the same bounded renderer/OCR implementation as the diagnostic. No
    image lane is skipped merely because native text exists. Lane-specific
    failures are retained while other pages/lanes continue; source-integrity
    or whole-batch deadline failures return no partial packet. Limits bound
    original bytes and encoded JSON plus raw raster bytes, not process-wide RSS
    or hosted dispatch duration. Both retained JSON representations are counted.
    """
    started = time.monotonic()
    if cancel_event is not None and type(cancel_event) is not threading.Event:
        raise OriginalReadError("original_cancellation_signal_invalid")
    def check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise OriginalReadError("original_processing_cancelled")
    check_cancel()
    if (type(original) is not bytes or not 1 <= len(original) <= MAX_SOURCE_BYTES or
            type(expected_sha256) is not str or not re.fullmatch("[a-f0-9]{64}", expected_sha256) or
            hashlib.sha256(original).hexdigest() != expected_sha256):
        raise OriginalReadError("original_bytes_or_hash_invalid")
    if type(expected_page_count) is not int or not 1 <= expected_page_count <= 10000:
        raise OriginalReadError("original_page_count_invalid")
    if (type(pages) is not list or not 1 <= len(pages) <= 8 or
            any(type(p) is not int or not 1 <= p <= expected_page_count for p in pages) or
            pages != sorted(set(pages))):
        raise OriginalReadError("original_page_selection_invalid")
    selected = list(pages)
    if (any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0
            for v in (total_timeout, stage_timeout)) or total_timeout > 110 or stage_timeout > 60 or
            type(dpi) is not int or not 72 <= dpi <= 400 or type(psm) is not int or psm not in (3, 6, 11)):
        raise OriginalReadError("original_processing_options_invalid")
    deadline = started + total_timeout
    def remaining() -> float:
        check_cancel()
        left = deadline - time.monotonic()
        if left <= 0:
            raise OriginalReadError("original_batch_deadline_exceeded")
        return left
    measured = _measurement(original, expected_page_count)
    entries = [{"page_number": p} for p in selected]
    with tempfile.TemporaryDirectory(prefix="ecos-original-document-reader-") as directory:
        snapshot = Path(directory) / "original.pdf"
        snapshot.write_bytes(original)
        try:
            inspected = _invoke(snapshot, expected_sha256, expected_page_count, selected[0],
                                "inspect", min(stage_timeout, remaining()), cancel_event=cancel_event)
        except (DiagnosticError, OriginalReadError):
            remaining()
            raise OriginalReadError("original_pdf_inspection_failed") from None
        if inspected != {"ok": True, "measurement": measured}:
            raise OriginalReadError("original_pdf_identity_invalid")
        for item in entries:
            for lane in ("native", "table"):
                remaining()
                try:
                    result = _invoke(snapshot, expected_sha256, expected_page_count, item["page_number"],
                                     lane, min(stage_timeout, remaining()), cancel_event=cancel_event)
                except (DiagnosticError, OriginalReadError):
                    remaining()
                    item[lane] = _failed("original_native_parser_failed" if lane == "native" else "original_table_parser_failed")
                    continue
                remaining()
                if result.get("code") in ("original_snapshot_changed", "original_pdf_identity_invalid"):
                    raise OriginalReadError("original_snapshot_identity_changed")
                if result.get("ok") is not True:
                    item[lane] = _failed("original_native_parser_failed" if lane == "native" else "original_table_parser_failed")
                    continue
                obs = result.get("observations")
                if (result.get("measurement") != measured or type(obs) is not dict or
                        obs.get("source_sha256") != expected_sha256 or obs.get("source_page_count") != expected_page_count or
                        obs.get("page_number") != item["page_number"] or obs.get("state") not in ("partial", "unreadable", "failed")):
                    raise OriginalReadError("original_observation_identity_changed")
                item[lane] = {"state": obs["state"], "observations": obs,
                              "limitation_codes": list(obs["limitation_codes"])}
        try:
            visual = read_original_visual_pages(original, expected_sha256=expected_sha256,
                expected_page_count=expected_page_count, pages=selected,
                total_timeout=min(110, remaining()), stage_timeout=min(stage_timeout, remaining()), dpi=dpi, psm=psm,
                cancel_event=cancel_event)
        except DiagnosticError as error:
            remaining()
            if str(error) in {"original_visual_source_sha256_mismatch", "original_visual_raster_path_rejected",
                              "original_visual_raster_drift", "original_visual_observation_identity_drift",
                              "source_sha256_mismatch", "source_page_count_mismatch"}:
                raise OriginalReadError("original_visual_integrity_failure") from None
            visual = None
        remaining()
        if visual is not None and (visual.get("source_sha256") != expected_sha256 or
                visual.get("source_page_count") != expected_page_count or visual.get("selected_pages") != selected or
                [p.get("page_number") for p in visual.get("pages", [])] != selected):
            raise OriginalReadError("original_visual_batch_identity_changed")
        retained = 0
        for index, item in enumerate(entries):
            if visual is None:
                item["visual"] = _failed("original_visual_parser_failed")
                raster = None
            else:
                result = visual["pages"][index]
                raster = result.get("raster_png")
                obs = result.get("observations")
                item["visual"] = {"state": result["state"], "observations": obs,
                                  "limitation_codes": list(result["limitation_codes"])}
                if result["state"] not in ("partial", "unreadable", "failed"):
                    raise OriginalReadError("original_visual_state_invalid")
                if result["state"] != "failed" and (type(raster) is not bytes or type(obs) is not dict or
                        hashlib.sha256(raster).hexdigest() != obs.get("raster", {}).get("sha256") or
                        obs.get("source", {}).get("source_sha256") != expected_sha256 or
                        obs.get("source", {}).get("page_number") != item["page_number"]):
                    raise OriginalReadError("original_visual_page_identity_changed")
                if result["state"] == "failed" and (raster is not None or obs is not None):
                    raise OriginalReadError("original_failed_visual_has_content")
            # Canonical raw payload hash, distinct from its original/raster hash.
            payload = {"schema_version": "ecos-original-page-observations/2.1",
                       **measured, **item, "retrieval_authorized": False, "semantic_verified": False}
            encoded = _json_bytes(payload)
            if len(encoded) > MAX_PAGE_BYTES:
                raise OriginalReadError("original_page_payload_limit")
            item.clear()
            item.update(payload=payload, payload_sha256=hashlib.sha256(encoded).hexdigest(),
                        payload_json=encoded.decode("utf-8"), raster_png=raster)
            # The convenience parsed payload and exact serialized payload are
            # both retained. Count both in their JSON wire representation, not
            # only one content copy. Raw PNG is counted separately, not base64.
            retained += len(_json_bytes({**item, "raster_png": None})) + (len(raster) if raster is not None else 0)
            if retained > MAX_BATCH_BYTES:
                raise OriginalReadError("original_batch_retained_limit")
        remaining()
    remaining()
    return {"schema_version": SCHEMA, "measurement": measured, "selected_pages": selected,
            "coverage": "selected_pages_only", "pages": entries,
            "retrieval_authorized": False, "semantic_verified": False}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 6:
            raise ValueError()
        # PyMuPDF's table package may print an advisory during its first call.
        # Keep library diagnostics on the bounded, discarded stderr channel;
        # stdout is exactly the machine-readable envelope, not mixed logs.
        with redirect_stdout(sys.stderr):
            value = _child(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
        encoded = _json_bytes(value)
        if len(encoded) > MAX_PAGE_BYTES:
            raise ValueError()
        sys.stdout.buffer.write(encoded)
    except Exception:
        # PDF/provider/path details never enter a worker control receipt.
        sys.stdout.write('{"ok":false,"code":"original_parser_failed"}')
