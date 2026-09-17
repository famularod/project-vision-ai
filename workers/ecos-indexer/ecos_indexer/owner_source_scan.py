"""Bounded owner-only scan of the exact downloaded bytes before PDF parsing.

This is a scanner verdict, not semantic approval or a parser sandbox. The owner
image separately verifies its immutable definition checksums at startup. No
network database update, opt-out environment flag, or development-clean fallback.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import tempfile
import threading
import time

from .original_visual_reader import DiagnosticError, DiagnosticProcessError, parser_environment, run_bounded


class OwnerSourceScanError(Exception):
    def __init__(self, code: str):
        self.code = code if code in {"invalid_scan_input", "source_scan_not_clean", "source_scan_unavailable", "source_scan_cancelled", "source_scan_deadline"} else "source_scan_unavailable"
        super().__init__("Owner original scan was not confirmed clean")


class OwnerSourceScanner:
    def __init__(self, *, scanner_path: str = "/usr/bin/clamscan", database_directory: str = "/var/lib/clamav",
                 timeout_seconds: float = 25):
        try:
            if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 25:
                raise ValueError()
            parser_environment(scanner_path)
            directory = Path(database_directory)
            if not directory.is_absolute() or not directory.is_dir():raise ValueError()
            self._scanner = str(Path(scanner_path).resolve(strict=True))
            self._database = str(directory.resolve(strict=True))
            self._timeout = float(timeout_seconds)
        except Exception:
            raise OwnerSourceScanError("source_scan_unavailable") from None

    def scan(self, original: bytes, *, expected_sha256: str, deadline_monotonic: float,
             cancel_event: threading.Event) -> None:
        started = time.monotonic()
        if (type(original) is not bytes or not 5 <= len(original) <= 64 * 1024 * 1024 or not original.startswith(b"%PDF-")
                or type(expected_sha256) is not str or hashlib.sha256(original).hexdigest() != expected_sha256
                or type(deadline_monotonic) not in (int, float) or not math.isfinite(deadline_monotonic)
                or type(cancel_event) is not threading.Event):
            raise OwnerSourceScanError("invalid_scan_input")
        deadline = min(deadline_monotonic, started + self._timeout)
        def check():
            if cancel_event.is_set():raise OwnerSourceScanError("source_scan_cancelled")
            if time.monotonic() >= deadline:raise OwnerSourceScanError("source_scan_deadline")
        try:
            check()
            with tempfile.TemporaryDirectory(prefix="ecos-owner-scan-") as directory:
                path = Path(directory) / "source.pdf"
                path.write_bytes(original)
                check()
                # Limits fail closed instead of silently accepting a partially
                # scanned large/nested document. Captured scanner text is never
                # returned or logged; only exit 0 permits the first PDF parser.
                run_bounded([self._scanner, "--infected", "--no-summary", "--stdout",
                    "--alert-exceeds-max=yes", "--max-filesize=64M", "--max-scansize=256M",
                    "--max-recursion=16", "--max-files=10000", "--database=" + self._database, str(path)],
                    max(0.001, deadline - time.monotonic()), 16384, 16384, cancel_event=cancel_event)
                check()
            check()
        except OwnerSourceScanError:
            raise
        except DiagnosticProcessError as error:
            raise OwnerSourceScanError("source_scan_not_clean" if error.exit_code == 1 else "source_scan_unavailable") from None
        except (DiagnosticError, OSError):
            check()
            raise OwnerSourceScanError("source_scan_unavailable") from None
