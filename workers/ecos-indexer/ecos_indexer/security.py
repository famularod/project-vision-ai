from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass


PDF_HEADER = b"%PDF-"


@dataclass(frozen=True)
class SourceScanResult:
    status: str
    engine: str
    byte_count: int


class SourceSecurityRejected(RuntimeError):
    pass


def scan_pdf_source(payload: bytes) -> SourceScanResult:
    """Fail closed before an untrusted source reaches the PDF parser."""

    if not payload.startswith(PDF_HEADER):
        raise SourceSecurityRejected("source_is_not_a_pdf")
    scanner = shutil.which("clamscan")
    require_scan = os.getenv("ECOS_REQUIRE_MALWARE_SCAN", "true").strip().lower() not in {
        "0", "false", "no",
    }
    if not scanner:
        if require_scan:
            raise SourceSecurityRejected("malware_scanner_unavailable")
        return SourceScanResult("clean", "development-header-check", len(payload))

    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="ecos-source-", suffix=".pdf", delete=False) as handle:
            handle.write(payload)
            temporary_path = handle.name
        completed = subprocess.run(
            [scanner, "--infected", "--no-summary", temporary_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=max(10, min(300, int(os.getenv("ECOS_MALWARE_SCAN_TIMEOUT_SECONDS", "120")))),
            text=True,
        )
        if completed.returncode == 0:
            return SourceScanResult("clean", "clamav", len(payload))
        if completed.returncode == 1:
            raise SourceSecurityRejected("malware_detected")
        raise SourceSecurityRejected("malware_scan_failed")
    except subprocess.TimeoutExpired as error:
        raise SourceSecurityRejected("malware_scan_timeout") from error
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
