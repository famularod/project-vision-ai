"""Bounded sealed-original scan/PDF inspection, not owner readiness.

No URL, source pathname, engine command, environment, download, SQL write or
legacy job conversion is accepted. ClamAV /proc FD behavior must additionally be
proven in the pinned Linux image; portable tests do not establish scanner safety.
The local claim is checked before/after stages, not reauthorized through SQL.
memfd and parser/scanner working sets still consume cgroup memory.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import threading
import time
from types import MappingProxyType

# Supports the fixed module-owned child entrypoint without inherited PYTHONPATH.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ecos_indexer.owner_execution import MAX_ORIGINAL_BYTES, OwnerExecutionResult, decode_json
from ecos_indexer.owner_original_limits import SCANNER_MAX_FILE_SIZE, SCANNER_MAX_SCAN_SIZE, SCANNER_MAX_FILES
from ecos_indexer.owner_service_limits import OWNER_SCAN_TIMEOUT_SECONDS, OWNER_INSPECTION_TIMEOUT_SECONDS
from ecos_indexer.owner_execution_gateway import OwnerExecutionGateway
from ecos_indexer.owner_original_spool import OwnerOriginalSpool, _assert_seals, _require_kernel
from ecos_indexer.original_visual_reader import DiagnosticProcessError, run_bounded

_TOKEN = "@ECOS_SEALED_ORIGINAL@"
_SCANNER = "/usr/bin/clamscan"
_DATABASE = "/var/lib/clamav"


class OwnerOriginalFDConsumerError(Exception):
    def __init__(self, code: str):
        self.code = code if code in {"invalid_request", "source_not_current", "cancelled", "deadline_exceeded",
            "scan_not_clean", "scan_unavailable", "scan_limit_exceeded", "scan_size_limit",
            "scan_file_size_limit", "scan_file_count_limit", "scan_recursion_limit", "scan_time_limit", "pdf_inspection_failed", "pdf_identity_mismatch",
            "unsupported_kernel"} else "pdf_inspection_failed"
        self.partial_result_returned = False
        self.retrieval_authorized = False
        super().__init__("Sealed original inspection not confirmed")


def scanner_failure_reason(code: str) -> str:
    """Preserve fixed scanner diagnostics across the consumer boundary.

    No scanner text leaves the process. Every result remains a failed scan.
    The earlier generic mapping hid precisely the limits we need to diagnose.
    """
    if code == "scan_deadline":
        return "scan_time_limit"
    if code in {"scan_not_clean", "scan_limit_exceeded", "scan_size_limit",
               "scan_file_size_limit", "scan_file_count_limit", "scan_recursion_limit", "scan_time_limit", "cancelled"}:
        return code
    return "scan_unavailable"


def _scan_summary(raw: bytes) -> None:
    # Exit0 alone can mean a skipped symlink/file. Require one scanned file,
    # not just a clean exit; captured diagnostics are never returned or logged.
    if type(raw) is not bytes or len(raw) > 16384:
        raise OwnerOriginalFDConsumerError("scan_unavailable")
    try:
        text = raw.decode("utf-8", "strict")
        if (re.findall(r"(?m)^Scanned files: ([0-9]+)\r?$", text) != ["1"]
                or re.findall(r"(?m)^Infected files: ([0-9]+)\r?$", text) != ["0"]):
            raise ValueError()
    except Exception:
        raise OwnerOriginalFDConsumerError("scan_unavailable") from None


def inspect_owner_original_spool(gateway: OwnerExecutionGateway, claim: OwnerExecutionResult,
                                 original: OwnerOriginalSpool, *,
                                 cancel_event: threading.Event | None = None,
                                 total_timeout: float = 40,
                                 scanner_service=None) -> MappingProxyType:
    """Scan then measure PDF count through the same sealed descriptor identity.

    No whole-file Python copy or source temp snapshot is made by this adapter.
    Scanner/PDF libraries can allocate memory or their own bounded work files.
    Caller retains/explicitly closes the spool; every lent FD closes here. A
    result is local source inspection only, not enrollment or a current grant.
    """
    started = time.monotonic()
    try:
        from ecos_indexer.owner_clamd_scanner import OwnerClamdScanner
        if (type(gateway) is not OwnerExecutionGateway or type(claim) is not OwnerExecutionResult
                or type(original) is not OwnerOriginalSpool
                or scanner_service is not None and type(scanner_service) is not OwnerClamdScanner
                or (cancel_event is not None and type(cancel_event) is not threading.Event)
                or type(total_timeout) not in (int, float) or not math.isfinite(total_timeout)
                or not 0 < total_timeout <= OWNER_INSPECTION_TIMEOUT_SECONDS):
            raise ValueError()
        identity = gateway.require_download_identity(claim)
        pins = original.pins  # Private brand checked by the spool property.
        if (original.closed or pins["request"] != identity.request
                or pins["claim_id"] != claim.payload["claim"]["claim_id"]
                or pins["binding_version"] != claim.payload["binding_version"]
                or pins["byte_length"] != identity.expected_byte_length
                or pins["source_sha256"] != identity.request["source_sha256"]
                or pins["object_key"] != identity.object_key):
            raise ValueError()
    except Exception:
        raise OwnerOriginalFDConsumerError("invalid_request") from None
    deadline = started + total_timeout
    def check():
        if cancel_event is not None and cancel_event.is_set():
            raise OwnerOriginalFDConsumerError("cancelled")
        if time.monotonic() >= deadline:
            raise OwnerOriginalFDConsumerError("deadline_exceeded")
        try:
            if gateway.require_download_identity(claim) is not identity or original.closed or original.pins is not pins:
                raise ValueError()
        except Exception:
            raise OwnerOriginalFDConsumerError("source_not_current") from None
        return deadline - time.monotonic()
    check()
    try:
        _require_kernel()
    except Exception:
        raise OwnerOriginalFDConsumerError("unsupported_kernel") from None
    try:
        if original.read_at(0, 5) != b"%PDF-":
            raise ValueError()
    except Exception:
        check()
        raise OwnerOriginalFDConsumerError("pdf_identity_mismatch") from None
    check()
    try:
        if scanner_service is None:
            out, _ = run_bounded([_SCANNER, "--infected", "--stdout", "--alert-exceeds-max=yes",
                "--max-filesize=" + SCANNER_MAX_FILE_SIZE, "--max-scansize=" + SCANNER_MAX_SCAN_SIZE,
                "--max-recursion=16", "--max-files=" + str(SCANNER_MAX_FILES),
                "--follow-file-symlinks=1", "--follow-dir-symlinks=0", "--database=" + _DATABASE, _TOKEN],
                min(25, check()), 16384, 16384, cancel_event=cancel_event, _original_spool=original)
            check()
            _scan_summary(out)
        else:
            # Background scan budget remains inside inspection, page-reader,
            # processing, claim and job deadlines. This is not a question wait.
            scanner_service.scan(original, cancel_event=cancel_event or threading.Event(),
                                 timeout_seconds=min(OWNER_SCAN_TIMEOUT_SECONDS, check()))
            check()
    except OwnerOriginalFDConsumerError:
        raise
    except Exception as error:
        from ecos_indexer.owner_clamd_scanner import OwnerClamdScannerError
        if type(error) is OwnerClamdScannerError:
            check()
            raise OwnerOriginalFDConsumerError(
                scanner_failure_reason(error.code)
            ) from None
        if type(error) is DiagnosticProcessError:
            check()
            raise OwnerOriginalFDConsumerError("scan_not_clean" if error.exit_code == 1 else "scan_unavailable") from None
        check()
        raise OwnerOriginalFDConsumerError("scan_unavailable") from None
    try:
        out, _ = run_bounded([sys.executable, "-B", str(Path(__file__).resolve()), "--inspect-sealed",
            _TOKEN, pins["source_sha256"], str(pins["byte_length"]), str(identity.request["source_page_count"])],
            min(20, check()), 4096, 16384, cancel_event=cancel_event, _original_spool=original)
        check()
        measurement = decode_json(out, 4096)
        expected = {"source_sha256": pins["source_sha256"], "source_page_count": identity.request["source_page_count"],
                    "byte_length": pins["byte_length"]}
        if type(measurement) is not dict or measurement.keys() != expected.keys() or measurement != expected:
            raise OwnerOriginalFDConsumerError("pdf_identity_mismatch")
        # bool==int must not admit a fabricated parsed count or length.
        if type(measurement["source_page_count"]) is not int or type(measurement["byte_length"]) is not int:
            raise OwnerOriginalFDConsumerError("pdf_identity_mismatch")
        check()
        return MappingProxyType({"schema_version": "ecos-owner-original-fd-inspection/1", "source_pins": pins,
            "measurement": MappingProxyType(measurement),
            "scan": "clean_local_daemon_stream" if scanner_service is not None else "clean_exit_and_one_file_reported",
            "authority_currentness": "local_claim_checked_only_action_time_sql_recheck_required",
            "source_transport": "supplied_sealed_spool_not_download_proof", "coverage": "pdf_identity_only_no_page_contents",
            "registration_performed": False, "retrieval_authorized": False, "semantic_verified": False})
    except OwnerOriginalFDConsumerError:
        raise
    except Exception:
        check()
        raise OwnerOriginalFDConsumerError("pdf_inspection_failed") from None


def _inspect_descriptor(path: str, expected_sha: str, length: int, count: int) -> dict:
    """Child-only inspection. No parent brand/owner receipt is minted here."""
    _require_kernel()
    if (type(path) is not str or not re.fullmatch(r"/proc/self/fd/[0-9]{1,10}", path)
            or type(expected_sha) is not str or not re.fullmatch(r"[a-f0-9]{64}", expected_sha)
            or type(length) is not int or not 5 <= length <= MAX_ORIGINAL_BYTES
            or type(count) is not int or not 1 <= count <= 10000):
        raise ValueError()
    fd = int(path.rsplit("/", 1)[1])
    if fd < 3:
        raise ValueError()
    # Popen made only this FD inheritable for exec; do not leak it onward.
    os.set_inheritable(fd, False)
    _assert_seals(fd)
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_size != length
            or fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY):
        raise ValueError()
    digest = hashlib.sha256()
    for at in range(0, length, 65536):
        part = os.pread(fd, min(65536, length-at), at)
        if len(part) != min(65536, length-at):
            raise ValueError()
        digest.update(part)
    if digest.hexdigest() != expected_sha:
        raise ValueError()
    import pymupdf as fitz
    with fitz.open(path, filetype="pdf") as document:
        if document.needs_pass or not document.is_pdf or document.page_count != count:
            raise ValueError()
        measured = document.page_count
    _assert_seals(fd)
    after = os.fstat(fd)
    if (after.st_dev, after.st_ino, after.st_size) != (info.st_dev, info.st_ino, info.st_size):
        raise ValueError()
    return {"source_sha256": expected_sha, "byte_length": length, "source_page_count": measured}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 6 or sys.argv[1] != "--inspect-sealed":
            raise ValueError()
        result = _inspect_descriptor(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    except Exception:
        # No engine messages, paths, source contents or credentials in output.
        sys.stderr.write("sealed_original_inspection_failed\n")
        raise SystemExit(1)
