"""Opt-in exact-SHA regression for hosted job 774d page 1."""

import hashlib
import json
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

SOURCE_PATH_VALUE = os.getenv("ECOS_774D_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
CHECKPOINT_PATH_VALUE = os.getenv("ECOS_774D_PAGE1_CHECKPOINT_JSON", "").strip()
CHECKPOINT_PATH = Path(CHECKPOINT_PATH_VALUE) if CHECKPOINT_PATH_VALUE else None
SOURCE_SHA256 = "9e55cb9dccc0a20b5e02f0ed4c41bdca0ab09708aa7183a4d71d85734ea639cf"
PROJECT_ID = "72e941d8-8114-4082-a976-ae5b2b5daba9"
JOB_ID = "774d4b3c-fa72-48ea-9f0d-8a2624105b28"
PAGE_NUMBER = 1
RUN_EXACT = os.getenv("ECOS_RUN_774D_PAGE1_PDF_TESTS") == "1"


def persisted_visual_checkpoint() -> dict | None:
    if CHECKPOINT_PATH is None or not CHECKPOINT_PATH.is_file():
        return None
    payload = json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
    if isinstance(payload, list) and payload:
        payload = payload[0]
    if isinstance(payload, dict) and isinstance(payload.get("ocr_page_data"), dict):
        payload = payload["ocr_page_data"].get("visualTileCheckpoint")
    if not isinstance(payload, dict):
        raise AssertionError("774d page-1 checkpoint fixture is malformed")
    return payload


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_774D_PAGE1_PDF_TESTS=1 with the exact 774d source.",
)
class Exact774dPage1ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued 774d source SHA changed")
        document = open_pdf(source)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(PAGE_NUMBER),
                visual_tile_checkpoint=persisted_visual_checkpoint(),
            )
        finally:
            document.close()
        cls.assurance = assure_page(
            page_data=cls.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(cls.result["unresolved"]),
        )
        cls.job = SimpleNamespace(
            job_id=JOB_ID,
            claim_token="00000000-0000-0000-0000-000000000000",
        )

    def test_exact_page_remains_assured_and_final_checkpoint_is_bounded(self) -> None:
        self.assertTrue(self.assurance["accepted"])
        self.assertEqual([], self.assurance["failureCodes"])
        self.assertEqual([], self.result["unresolved"])

        compacted = final_page_checkpoint_payload(
            self.job,
            page_number=PAGE_NUMBER,
            result=self.result,
            assurance=self.assurance,
            unresolved_region_count=0,
        )
        compacted_bytes = hosted_page_checkpoint_request_bytes(compacted)
        uncompacted = {**compacted, "p_ocr_page_data": self.result["ocr"]}
        uncompacted_bytes = hosted_page_checkpoint_request_bytes(uncompacted)

        self.assertGreater(uncompacted_bytes, MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES)
        self.assertLessEqual(compacted_bytes, MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES)
        self.assertNotIn("visualTileRegions", compacted["p_ocr_page_data"])
        self.assertEqual(
            len(self.result["ocr"]["visualTileRegions"]),
            compacted["p_ocr_page_data"]["visualTileRegionCount"],
        )
        self.assertNotIn("visualTileProofs", compacted["p_ocr_page_data"])
        self.assertNotIn("regions", compacted["p_ocr_page_data"])
        self.assertNotIn("structuredTableAnalysis", compacted["p_ocr_page_data"])
        self.assertEqual(
            len(self.result["ocr"]["regions"]),
            compacted["p_ocr_page_data"]["ocrRegionCount"],
        )
        self.assertEqual(
            len(self.result["ocr"]["visualTileProofs"]),
            compacted["p_ocr_page_data"]["visualTileProofCount"],
        )
        self.assertIn("rejectedLowConfidenceRegions", compacted["p_ocr_page_data"])
        self.assertEqual(
            self.result["final"],
            compacted["p_final_page_data"],
        )
        self.assertIn("visualTileRegions", self.result["ocr"])


if __name__ == "__main__":
    unittest.main()
