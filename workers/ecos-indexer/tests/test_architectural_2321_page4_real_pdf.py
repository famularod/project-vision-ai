"""Opt-in exact-SHA regression for Architectural 2321 page 4."""

import hashlib
import os
import unittest
from pathlib import Path

import pymupdf

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID,
    EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
    extract_page,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    validated_visual_resolution,
    visual_exception_fingerprint,
    visual_review_bounds,
    visual_review_tile_scale,
)
from ecos_indexer.worker import append_visual_evidence


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 4
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE4_PDF_TESTS") == "1"
TARGET_SOURCE = "exact_rendered_accessible_parking_note_composite_candidate"


def target_exception(result: dict[str, object]) -> dict[str, object]:
    matches = [
        item for item in result["unresolved"]
        if item.get("diagnosticCandidates") == [{
            "text": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
            "source": TARGET_SOURCE,
            "confidence": 0.0,
            "bounds": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
        }]
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one complete page-4 note, found {matches}")
    return matches[0]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE4_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page4ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SOURCE_PATH.open("rb") as source_handle:
            actual_sha = hashlib.file_digest(source_handle, "sha256").hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(
                f"Issued Architectural 2321 source SHA changed: {actual_sha}"
            )
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            cls.structural_identity = bookmark_sheet_identity_map(document).get(
                PAGE_NUMBER,
            )
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
            )
        finally:
            document.close()

    def test_full_note_replaces_only_the_truncated_review_authority(self) -> None:
        exception = target_exception(self.result)
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_BOUNDS,
            exception["bounds"],
        )
        self.assertEqual(1, exception["diagnosticCandidateCount"])

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composite = next(
            region for region in rejected
            if region.get("id")
            == EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_CANDIDATE_ID
        )
        self.assertFalse(composite["searchable"])
        self.assertEqual(TARGET_SOURCE, composite["source"])
        self.assertEqual(5, len(composite["constituentEvidence"]))

        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_accessible_parking_note_composite"
        ]
        self.assertEqual(2, len(superseded))
        self.assertEqual(
            {"5'-O\"", "5'-O\" MIN. TYP"},
            {str(region["text"]) for region in superseded},
        )
        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        for region in superseded:
            raw = raw_by_id[str(region["id"])]
            self.assertNotIn("visualAuthorityStatus", raw)
            self.assertEqual(region["text"], raw["text"])

        final_regions = self.result["final"]["regions"]
        self.assertFalse(any(
            region.get("source") == TARGET_SOURCE for region in final_regions
        ))
        self.assertNotIn(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
            self.result["final"]["text"],
        )

    def test_review_context_is_high_resolution_and_contains_the_full_note(self) -> None:
        exception = target_exception(self.result)
        candidate = exception["diagnosticCandidates"][0]
        self.assertEqual(6.0, visual_review_tile_scale([candidate]))
        review = visual_review_bounds(exception["bounds"], [candidate])
        candidate_bounds = candidate["bounds"]
        self.assertLessEqual(review["x"], candidate_bounds["x"])
        self.assertLessEqual(review["y"], candidate_bounds["y"])
        self.assertGreaterEqual(
            review["x"] + review["width"],
            candidate_bounds["x"] + candidate_bounds["width"],
        )
        self.assertGreaterEqual(
            review["y"] + review["height"],
            candidate_bounds["y"] + candidate_bounds["height"],
        )

    def test_checkpoint_replay_preserves_candidate_and_fingerprint(self) -> None:
        checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=self.result["ocr"]["visualTileRegions"],
            proofs=self.result["ocr"]["visualTileProofs"],
        )
        resumed_regions, resumed_proofs = resumed_visual_tile_work(
            checkpoint,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
        )
        self.assertEqual(self.result["ocr"]["visualTileRegions"], resumed_regions)
        self.assertEqual(self.result["ocr"]["visualTileProofs"], resumed_proofs)

        document = pymupdf.open(str(SOURCE_PATH))
        try:
            replayed = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=self.structural_identity,
                visual_tile_checkpoint=checkpoint,
            )
        finally:
            document.close()
        original = target_exception(self.result)
        replay = target_exception(replayed)
        self.assertEqual(original, replay)
        self.assertEqual(
            visual_exception_fingerprint(original),
            visual_exception_fingerprint(replay),
        )

    def test_dual_provider_acceptance_publishes_only_the_canonical_note(self) -> None:
        exception = target_exception(self.result)
        payload = {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "visionProvider": "provider-a",
            "model": "analysis-model",
            "assuranceProvider": "provider-b",
            "assuranceModel": "assurance-model",
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
                "subject": "accessible parking stall striped loading",
                "location": "site plan",
                "statement": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
                "evidenceText": EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
                "confidence": 0.97,
                "bounds": {"x": 806, "y": 924, "width": 30, "height": 18},
            }],
        }
        resolution = validated_visual_resolution(payload, exception)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        result = {"final": {"regions": []}}
        append_visual_evidence(result, exception, resolution.evidence)
        self.assertEqual(1, len(result["final"]["regions"]))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_ACCESSIBLE_PARKING_NOTE_TEXT,
            result["final"]["regions"][0]["text"],
        )
        self.assertTrue(result["final"]["regions"][0]["searchable"])

        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
            "dismissedCandidateIndexes": [],
        }
        self.assertFalse(validated_visual_resolution(mixed, exception).resolved)


if __name__ == "__main__":
    unittest.main()
