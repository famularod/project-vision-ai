"""Fixed owner-preview background service budgets.

These values are trusted deployment configuration, never customer request
fields. Page work must finish before processing, processing before the SQL
claim, and the Cloud Run job must outlive every inner budget.
"""

OWNER_CLAIM_LIFETIME_SECONDS = 900
OWNER_SCAN_TIMEOUT_SECONDS = 240
OWNER_INSPECTION_TIMEOUT_SECONDS = 300
OWNER_PROCESSING_TIMEOUT_SECONDS = 840
OWNER_PAGE_READER_TIMEOUT_SECONDS = 810
OWNER_JOB_TIMEOUT_SECONDS = 1200


def validate_owner_service_limits() -> None:
    if not (
        0 < OWNER_SCAN_TIMEOUT_SECONDS
        < OWNER_INSPECTION_TIMEOUT_SECONDS
        < OWNER_PAGE_READER_TIMEOUT_SECONDS
        < OWNER_PROCESSING_TIMEOUT_SECONDS
        < OWNER_CLAIM_LIFETIME_SECONDS
        < OWNER_JOB_TIMEOUT_SECONDS
        <= 3600
    ):
        raise RuntimeError("invalid_owner_service_limits")


validate_owner_service_limits()
