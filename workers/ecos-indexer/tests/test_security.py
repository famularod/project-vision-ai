import os
import unittest
from unittest.mock import patch

from ecos_indexer.security import SourceSecurityRejected, scan_pdf_source


class SourceSecurityTests(unittest.TestCase):
    def test_rejects_non_pdf_before_scanner(self) -> None:
        with self.assertRaisesRegex(SourceSecurityRejected, "source_is_not_a_pdf"):
            scan_pdf_source(b"not a pdf")

    def test_production_fails_closed_without_scanner(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value=None), patch.dict(
            os.environ, {"ECOS_REQUIRE_MALWARE_SCAN": "true"}, clear=False
        ):
            with self.assertRaisesRegex(SourceSecurityRejected, "malware_scanner_unavailable"):
                scan_pdf_source(b"%PDF-1.7\n")

    def test_explicit_development_mode_allows_header_only_check(self) -> None:
        with patch("ecos_indexer.security.shutil.which", return_value=None), patch.dict(
            os.environ, {"ECOS_REQUIRE_MALWARE_SCAN": "false"}, clear=False
        ):
            result = scan_pdf_source(b"%PDF-1.7\n")
        self.assertEqual(result.status, "clean")
        self.assertEqual(result.engine, "development-header-check")


if __name__ == "__main__":
    unittest.main()
