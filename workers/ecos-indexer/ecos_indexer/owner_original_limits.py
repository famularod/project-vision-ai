"""Source admission limits, separate from selected-page/output budgets.

Only the sealed-original FD path admits the larger source. Scanner expansion,
render output, page count per batch and processing deadlines remain bounded.
This is a candidate profile, not evidence of successful live large-PDF use.
"""
MAX_ORIGINAL_BYTES = 160 * 1024 * 1024
MAX_BUFFERED_ORIGINAL_BYTES = 64 * 1024 * 1024
SCANNER_MAX_FILE_SIZE = "160M"
SCANNER_MAX_SCAN_SIZE = "512M"
SCANNER_MAX_FILES = 50_000
