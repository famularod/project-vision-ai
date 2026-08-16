import os
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from ecos_indexer.security import (
    SourceScanOperationalError,
    SourceSecurityRejected,
    malware_scan_timeout_seconds,
    scan_pdf_source,
)


class SourceSecurityTests(unittest.TestCase):
    def test_rejects_non_pdf_before_scanner(self) -> None:
        with self.assertRaisesRegex(SourceSecurityRejected, "source_is_not_a_pdf") as raised:
            scan_pdf_source(b"not a pdf")
        self.assertEqual("source-policy", raised.exception.engine)

    def test_production_fails_closed_without_scanner(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value=None), patch.dict(
            os.environ, {"ECOS_REQUIRE_MALWARE_SCAN": "true"}, clear=False
        ):
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scanner_unavailable",
            ) as raised:
                scan_pdf_source(b"%PDF-1.7\n")
        self.assertEqual("clamav", raised.exception.engine)

    def test_explicit_development_mode_allows_header_only_check(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value=None), patch.dict(
            os.environ, {"ECOS_REQUIRE_MALWARE_SCAN": "false"}, clear=False
        ):
            result = scan_pdf_source(b"%PDF-1.7\n")
        self.assertEqual(result.status, "clean")
        self.assertEqual(result.engine, "development-header-check")

    def test_clean_clamav_verdict_uses_the_durable_timeout(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
        ) as run, patch.dict(
            os.environ,
            {
                "ECOS_REQUIRE_MALWARE_SCAN": "true",
                "ECOS_MALWARE_SCAN_TIMEOUT_SECONDS": "300",
            },
            clear=False,
        ):
            result = scan_pdf_source(b"%PDF-1.7\nclean fixture")

        self.assertEqual("clean", result.status)
        self.assertEqual("clamav", result.engine)
        self.assertEqual(300, run.call_args.kwargs["timeout"])
        self.assertEqual(
            ["/usr/bin/clamscan", "--infected", "--no-summary"],
            run.call_args.args[0][:3],
        )
        self.assertFalse(os.path.exists(run.call_args.args[0][-1]))

    def test_malware_verdict_remains_a_permanent_source_rejection(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.subprocess.run",
            return_value=SimpleNamespace(returncode=1, stdout="fixture FOUND", stderr=""),
        ):
            with self.assertRaisesRegex(SourceSecurityRejected, "malware_detected") as raised:
                scan_pdf_source(b"%PDF-1.7\nmalware fixture")
        self.assertEqual("clamav", raised.exception.engine)

    def test_scanner_error_is_retryable_operational_failure(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.subprocess.run",
            return_value=SimpleNamespace(returncode=2, stdout="", stderr="scanner error"),
        ):
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scan_failed",
            ) as raised:
                scan_pdf_source(b"%PDF-1.7\n")
        self.assertEqual("clamav", raised.exception.engine)

    def test_scanner_timeout_is_retryable_operational_failure(self) -> None:
        timeout = subprocess.TimeoutExpired(cmd="clamscan", timeout=300)
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.subprocess.run",
            side_effect=timeout,
        ):
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scan_timeout",
            ) as raised:
                scan_pdf_source(b"%PDF-1.7\n")
        self.assertEqual("clamav", raised.exception.engine)

    def test_scanner_launch_failure_is_retryable_operational_failure(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.subprocess.run",
            side_effect=OSError("temporary process failure"),
        ):
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scan_failed",
            ):
                scan_pdf_source(b"%PDF-1.7\n")

    def test_malware_verdict_survives_temporary_file_cleanup_failure(self) -> None:
        handle = MagicMock()
        handle.name = "/tmp/ecos-malware-verdict.pdf"
        handle.__enter__.return_value = handle
        handle.__exit__.return_value = False
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.tempfile.NamedTemporaryFile",
            return_value=handle,
        ), patch(
            "ecos_indexer.security.subprocess.run",
            return_value=SimpleNamespace(returncode=1, stdout="fixture FOUND", stderr=""),
        ), patch(
            "ecos_indexer.security.os.unlink",
            side_effect=PermissionError("cleanup denied"),
        ):
            with self.assertRaisesRegex(SourceSecurityRejected, "malware_detected"):
                scan_pdf_source(b"%PDF-1.7\nmalware fixture")

    def test_clean_verdict_becomes_operational_failure_when_cleanup_fails(self) -> None:
        handle = MagicMock()
        handle.name = "/tmp/ecos-clean-verdict.pdf"
        handle.__enter__.return_value = handle
        handle.__exit__.return_value = False
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.tempfile.NamedTemporaryFile",
            return_value=handle,
        ), patch(
            "ecos_indexer.security.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
        ), patch(
            "ecos_indexer.security.os.unlink",
            side_effect=PermissionError("cleanup denied"),
        ):
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scan_cleanup_failed",
            ):
                scan_pdf_source(b"%PDF-1.7\nclean fixture")

    def test_partial_temporary_file_is_cleaned_after_write_failure(self) -> None:
        handle = MagicMock()
        handle.name = "/tmp/ecos-partial-write.pdf"
        handle.__enter__.return_value = handle
        handle.__exit__.return_value = False
        handle.write.side_effect = OSError("partial write failed")
        with patch("ecos_indexer.security.shutil.which", return_value="/usr/bin/clamscan"), patch(
            "ecos_indexer.security.tempfile.NamedTemporaryFile",
            return_value=handle,
        ), patch("ecos_indexer.security.subprocess.run") as run, patch(
            "ecos_indexer.security.os.unlink",
        ) as unlink:
            with self.assertRaisesRegex(
                SourceScanOperationalError,
                "malware_scan_failed",
            ):
                scan_pdf_source(b"%PDF-1.7\npartial fixture")
        run.assert_not_called()
        unlink.assert_called_once_with(handle.name)

    def test_scan_timeout_configuration_is_bounded_and_invalid_values_fail_safe(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(300, malware_scan_timeout_seconds())
        for configured, expected in (("1", 10), ("301", 300), ("invalid", 300)):
            with self.subTest(configured=configured), patch.dict(
                os.environ,
                {"ECOS_MALWARE_SCAN_TIMEOUT_SECONDS": configured},
                clear=False,
            ):
                self.assertEqual(expected, malware_scan_timeout_seconds())


if __name__ == "__main__":
    unittest.main()
