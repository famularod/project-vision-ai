import unittest
from ecos_indexer.owner_page_processing import OwnerPageProcessingError, safe_failure_reason
from ecos_indexer.owner_original_fd_page_reader import OwnerOriginalFDPageReadError
from ecos_indexer.owner_clamd_scanner import classify_scan_response


class SafeDiagnosticsTest(unittest.TestCase):
    def test_scan_alerts_remain_fail_closed(self):
        self.assertEqual(classify_scan_response(b'stream: OK\0'), 'clean')
        self.assertEqual(classify_scan_response(b'stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND\0'), 'scan_size_limit')
        for limit, code in ((b'MaxFiles', 'scan_file_count_limit'), (b'MaxFileSize', 'scan_file_size_limit'),
                            (b'MaxRecursion', 'scan_recursion_limit'), (b'MaxScanTime', 'scan_time_limit')):
            with self.subTest(limit=limit):
                self.assertEqual(classify_scan_response(b'stream: Heuristics.Limits.Exceeded.'+limit+b' FOUND\0'), code)
                wrapped = OwnerOriginalFDPageReadError('source_inspection_failed', inspection_reason=code)
                self.assertEqual(safe_failure_reason(wrapped), code)
        self.assertEqual(classify_scan_response(b'stream: Heuristics.Limits.Exceeded.UnknownPrivateValue FOUND\0'), 'scan_limit_exceeded')
        self.assertEqual(classify_scan_response(b'stream: Win.Test.EICAR_HDB-1 FOUND\0'), 'scan_not_clean')
        for value in (b'private file: OK\0', b'stream: ERROR\0', b'stream: OK', b''):
            self.assertEqual(classify_scan_response(value), 'scanner_unavailable')

    def test_unknown_exception_text_and_values_do_not_escape(self):
        error = ValueError('private credential and document path')
        error.code = 'private credential'
        self.assertEqual(safe_failure_reason(error), 'unclassified')
        wrapped = OwnerPageProcessingError('processing_failed', diagnostic_stage='private path',
            diagnostic_reason='private credential')
        self.assertEqual(wrapped.diagnostic_stage, 'input')
        self.assertEqual(wrapped.diagnostic_reason, 'unclassified')

    def test_inspection_reason_survives_only_as_fixed_code(self):
        error = OwnerOriginalFDPageReadError('source_inspection_failed', inspection_reason='scan_not_clean')
        self.assertEqual(safe_failure_reason(error), 'scan_not_clean')
        rejected = OwnerOriginalFDPageReadError('source_inspection_failed', inspection_reason='secret')
        self.assertEqual(safe_failure_reason(rejected), 'source_inspection_failed')

    def test_failed_status_and_no_successful_prefix_remain(self):
        error = OwnerPageProcessingError('processing_failed', diagnostic_stage='download',
            diagnostic_reason='deadline_exceeded')
        self.assertEqual(error.code, 'processing_failed')
        self.assertEqual(error.diagnostic_stage, 'download')
        self.assertFalse(error.successful_evidence_prefix)


if __name__ == '__main__': unittest.main()
