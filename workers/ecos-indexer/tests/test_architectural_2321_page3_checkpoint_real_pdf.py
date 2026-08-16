"""Opt-in exact-SHA regression for Architectural 2321 page 3 checkpointing."""

import hashlib
import os
import unittest
from pathlib import Path
from types import SimpleNamespace

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf
from ecos_indexer.worker import (
    MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES,
    final_page_checkpoint_payload,
    hosted_page_checkpoint_request_bytes,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
JOB_ID = "3b3bd0a7-33e1-496d-9e6e-c8d066b556d7"
PAGE_NUMBER = 3
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE3_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set the exact Architectural 2321 PDF path and page-3 opt-in flag.",
)
class ExactArchitectural2321Page3CheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued Architectural 2321 source SHA changed")
        document = open_pdf(source)
        try:
            result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER,
                ),
            )
        finally:
            document.close()
        assurance = assure_page(
            page_data=result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(result["unresolved"]),
        )
        cls.result = result
        cls.assurance = assurance
        cls.payload = final_page_checkpoint_payload(
            SimpleNamespace(
                job_id=JOB_ID,
                claim_token="00000000-0000-0000-0000-000000000000",
            ),
            page_number=PAGE_NUMBER,
            result=result,
            assurance=assurance,
            unresolved_region_count=len(result["unresolved"]),
        )

    def test_dense_page_is_assured_and_bounded_for_protected_checkpoint(self) -> None:
        request_bytes = hosted_page_checkpoint_request_bytes(self.payload)

        self.assertEqual([], self.result["unresolved"])
        self.assertTrue(self.assurance["accepted"])
        self.assertEqual("assured", self.payload["p_state"])
        self.assertGreater(len(self.result["final"]["regions"]), 12_000)
        self.assertGreater(request_bytes, 6 * 1024 * 1024)
        self.assertLessEqual(request_bytes, MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES)

    def test_compaction_preserves_authoritative_final_page(self) -> None:
        self.assertEqual(self.result["final"], self.payload["p_final_page_data"])
        self.assertNotIn("visualTileRegions", self.payload["p_ocr_page_data"])
        self.assertNotIn("regions", self.payload["p_ocr_page_data"])
        self.assertEqual(
            len(self.result["ocr"]["visualTileRegions"]),
            self.payload["p_ocr_page_data"]["visualTileRegionCount"],
        )


if __name__ == "__main__":
    unittest.main()
