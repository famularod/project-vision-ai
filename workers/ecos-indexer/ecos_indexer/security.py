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
    """The source itself violated a security policy and must not be retried."""

    def __init__(self, reason: str, *, engine: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.engine = engine


class SourceScanOperationalError(RuntimeError):
    """The protected scanner could not produce a verdict and may be retried."""

    def __init__(self, reason: str, *, engine: str = "clamav") -> None:
        super().__init__(reason)
        self.reason = reason
        self.engine = engine


def malware_scan_timeout_seconds() -> int:
    """Return the bounded ClamAV process timeout used by hosted workers."""

    try:
        configured = int(os.getenv("ECOS_MALWARE_SCAN_TIMEOUT_SECONDS", "300"))
    except ValueError:
        configured = 300
    return max(10, min(300, configured))


def scan_pdf_source(payload: bytes) -> SourceScanResult:
    """Fail closed before an untrusted source reaches the PDF parser."""

    if not payload.startswith(PDF_HEADER):
        raise SourceSecurityRejected("source_is_not_a_pdf", engine="source-policy")
    scanner = shutil.which("clamscan")
    require_scan = os.getenv("ECOS_REQUIRE_MALWARE_SCAN", "true").strip().lower() not in {
        "0", "false", "no",
    }
    if not scanner:
        if require_scan:
            raise SourceScanOperationalError("malware_scanner_unavailable")
        return SourceScanResult("clean", "development-header-check", len(payload))

    temporary_path = ""
    primary_failure = False
    try:
        try:
            with tempfile.NamedTemporaryFile(
                prefix="ecos-source-", suffix=".pdf", delete=False,
            ) as handle:
                # Bind the path before the first write so even a partial write
                # is removed by the fail-closed cleanup boundary below.
                temporary_path = handle.name
                handle.write(payload)
            completed = subprocess.run(
                [scanner, "--infected", "--no-summary", temporary_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=malware_scan_timeout_seconds(),
                text=True,
            )
            if completed.returncode == 0:
                return SourceScanResult("clean", "clamav", len(payload))
            if completed.returncode == 1:
                raise SourceSecurityRejected("malware_detected", engine="clamav")
            raise SourceScanOperationalError("malware_scan_failed")
        except subprocess.TimeoutExpired as error:
            raise SourceScanOperationalError("malware_scan_timeout") from error
        except OSError as error:
            raise SourceScanOperationalError("malware_scan_failed") from error
    except BaseException:
        # Cleanup is secondary to a known source or scanner verdict. In
        # particular, an unlink failure must never turn malware_detected into
        # a generic retryable worker error.
        primary_failure = True
        raise
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            except OSError as error:
                if not primary_failure:
                    raise SourceScanOperationalError(
                        "malware_scan_cleanup_failed"
                    ) from error
