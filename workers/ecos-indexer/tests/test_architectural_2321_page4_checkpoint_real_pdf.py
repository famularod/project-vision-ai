"""Opt-in exact-SHA regression for Architectural 2321 page 4 checkpointing."""

import hashlib
import math
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
    hosted_checkpoint_diagnostic_sha256,
    hosted_page_checkpoint_request_bytes,
)
from ecos_indexer.visual import VISUAL_SCHEMA_VERSION, validated_visual_resolution


SOURCE_PATH_VALUE = os.getenv("ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
JOB_ID = "3b3bd0a7-33e1-496d-9e6e-c8d066b556d7"
PAGE_NUMBER = 4
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE4_PDF_TESTS") == "1"


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set the exact Architectural 2321 PDF path and page-4 opt-in flag.",
)
class ExactArchitectural2321Page4CheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued Architectural 2321 source SHA changed")
        document = open_pdf(source)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(
                    PAGE_NUMBER,
                ),
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

    def test_valid_no_table_page_builds_bounded_final_checkpoint(self) -> None:
        self.assertIsNone(self.result["ocr"]["structuredTableAnalysis"])
        self.assertIsNone(self.result["final"]["structuredTableAnalysis"])
        self.assertGreater(len(self.result["unresolved"]), 0)
        self.assertFalse(self.assurance["accepted"])

        payload = final_page_checkpoint_payload(
            SimpleNamespace(
                job_id=JOB_ID,
                claim_token="00000000-0000-0000-0000-000000000000",
            ),
            page_number=PAGE_NUMBER,
            result=self.result,
            assurance=self.assurance,
            unresolved_region_count=len(self.result["unresolved"]),
        )

        self.assertEqual("awaiting_visual", payload["p_state"])
        self.assertLessEqual(
            hosted_page_checkpoint_request_bytes(payload),
            MAX_HOSTED_PAGE_CHECKPOINT_REQUEST_BYTES,
        )
        self.assertEqual(self.result["final"], payload["p_final_page_data"])
        self.assertIsNone(payload["p_final_page_data"]["structuredTableAnalysis"])
        self.assertNotIn("structuredTableAnalysis", payload["p_ocr_page_data"])
        self.assertEqual(
            hosted_checkpoint_diagnostic_sha256(None),
            payload["p_ocr_page_data"]["structuredTableAnalysisSha256"],
        )

    def test_exact_minimum_typical_note_has_one_complete_visual_authority(self) -> None:
        matches = [
            item for item in self.result["unresolved"]
            if [
                candidate.get("text")
                for candidate in item.get("diagnosticCandidates") or []
            ] == ["5'-O\" MIN. TYP"]
        ]
        self.assertEqual(1, len(matches))
        exception = matches[0]
        candidate = exception["diagnosticCandidates"][0]
        self.assertEqual(
            "fixed_visual_tile_measurement_transcription_correction",
            candidate["source"],
        )
        bounds = candidate["bounds"]
        left = math.ceil(bounds["x"] * 1000)
        top = math.ceil(bounds["y"] * 1000)
        right = math.floor((bounds["x"] + bounds["width"]) * 1000)
        bottom = math.floor((bounds["y"] + bounds["height"]) * 1000)
        corrected = "5'-0\" MIN. TYPICAL"
        resolved = validated_visual_resolution({
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "visionProvider": "gemini",
            "model": "gemini-page4-exact",
            "assuranceProvider": "openai",
            "assuranceModel": "openai-page4-exact",
            "primaryAcceptedCandidateIndexes": [0],
            "primaryAcceptedCandidateIndexesValid": True,
            "assuranceAcceptedCandidateIndexes": [0],
            "assuranceAcceptedCandidateIndexesValid": True,
            "primaryDismissedCandidateIndexes": [],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [],
            "facts": [{
                "subject": "",
                "location": "",
                "statement": corrected,
                "evidenceText": corrected,
                "confidence": 0.98,
                "bounds": {
                    "x": left, "y": top,
                    "width": right - left, "height": bottom - top,
                },
            }],
        }, exception)

        self.assertTrue(resolved.resolved)
        self.assertEqual(
            "5'-0\" MIN TYP",
            resolved.evidence["facts"][0]["statement"],
        )


if __name__ == "__main__":
    unittest.main()
