"""Admission contract tests, not real large-document or customer acceptance."""
from pathlib import Path
import unittest
from ecos_indexer.owner_execution import OwnerExecutionIdentity, OwnerExecutionError
from ecos_indexer.owner_original_limits import MAX_ORIGINAL_BYTES, MAX_BUFFERED_ORIGINAL_BYTES
from ecos_indexer.owner_original_download import MAX_ORIGINAL_BYTES as BUFFER_LIMIT
from ecos_indexer.owner_page_processing import MAX_RETAINED_BYTES
from ecos_indexer.owner_service_limits import OWNER_SCAN_TIMEOUT_SECONDS
from ecos_indexer.owner_original_limits import SCANNER_MAX_FILES
from test_owner_execution import fixture_request


class LargeOriginalLimitTests(unittest.TestCase):
    def test_exact_large_source_and_boundary_admitted(self):
        for size in (64*1024*1024, 140164269, MAX_ORIGINAL_BYTES):
            self.assertEqual(OwnerExecutionIdentity.from_service_request(fixture_request(),
                expected_byte_length=size).expected_byte_length, size)

    def test_over_limit_invalid_types_and_too_short_rejected(self):
        for size in (MAX_ORIGINAL_BYTES+1, True, 140164269.0, 4, -1):
            with self.assertRaises(OwnerExecutionError):
                OwnerExecutionIdentity.from_service_request(fixture_request(), expected_byte_length=size)

    def test_output_and_legacy_download_are_not_expanded(self):
        self.assertEqual(MAX_BUFFERED_ORIGINAL_BYTES, 64*1024*1024)
        self.assertEqual(BUFFER_LIMIT, MAX_BUFFERED_ORIGINAL_BYTES)
        self.assertEqual(MAX_RETAINED_BYTES, MAX_BUFFERED_ORIGINAL_BYTES)

    def test_scanner_contract_and_fail_closed_limits(self):
        config = (Path(__file__).resolve().parents[1]/'ecos-clamd.conf').read_text()
        self.assertIn('MaxFileSize 160M\n', config)
        self.assertIn('StreamMaxLength 160M\n', config)
        self.assertIn('MaxScanSize 512M\n', config)
        self.assertIn('AlertExceedsMax yes\n', config)
        self.assertEqual(OWNER_SCAN_TIMEOUT_SECONDS, 240)
        self.assertEqual(SCANNER_MAX_FILES, 50_000)
        self.assertIn(f'MaxScanTime {OWNER_SCAN_TIMEOUT_SECONDS * 1000}\n', config)
        self.assertIn(f'MaxFiles {SCANNER_MAX_FILES}\n', config)


if __name__ == '__main__': unittest.main()
