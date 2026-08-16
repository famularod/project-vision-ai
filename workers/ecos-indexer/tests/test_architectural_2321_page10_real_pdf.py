"""Opt-in exact-SHA regression for Architectural 2321 page 10."""

import hashlib
import os
import unittest
from pathlib import Path

import pymupdf

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS,
    EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
    extract_page,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    validated_visual_resolution,
    visual_exception_fingerprint,
    visual_review_tile_scale,
)
from ecos_indexer.worker import append_visual_evidence


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 10
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE10_PDF_TESTS") == "1"


def target_exception(result: dict[str, object]) -> dict[str, object]:
    matches = [
        item
        for item in result["unresolved"]
        if any(
            str(candidate.get("text") or "")
            == EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT
            for candidate in item.get("diagnosticCandidates") or []
        )
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one easement exception, found {len(matches)}")
    return matches[0]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE10_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page10ProductionTests(unittest.TestCase):
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

    def test_complete_note_replaces_only_overlapping_ocr_fragments(self) -> None:
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composites = [
            region for region in rejected
            if region.get("source")
            == "exact_rendered_easement_note_composite_candidate"
        ]
        self.assertEqual(1, len(composites))
        composite = composites[0]
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CANDIDATE_ID,
            composite["id"],
        )
        self.assertEqual(EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT, composite["text"])
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_BOUNDS,
            {key: composite[key] for key in ("x", "y", "width", "height")},
        )
        self.assertFalse(composite["searchable"])
        self.assertEqual(6.0, visual_review_tile_scale([{
            "text": composite["text"],
            "source": composite["source"],
            "bounds": {
                key: composite[key] for key in ("x", "y", "width", "height")
            },
        }]))

        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_easement_note_composite"
        ]
        self.assertEqual(
            {str(spec["id"]) for spec in EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_CONSTITUENTS},
            {str(region["id"]) for region in superseded},
        )
        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        for region in superseded:
            raw = raw_by_id[str(region["id"])]
            self.assertNotIn("visualAuthorityStatus", raw)
            self.assertEqual(region["text"], raw["text"])
            self.assertEqual(
                {key: region[key] for key in ("x", "y", "width", "height")},
                {key: raw[key] for key in ("x", "y", "width", "height")},
            )

        exception = target_exception(self.result)
        self.assertEqual(1, len(exception["diagnosticCandidates"]))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
            exception["diagnosticCandidates"][0]["text"],
        )
        all_diagnostic_texts = {
            str(candidate.get("text") or "")
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        }
        self.assertNotIn("(2'", all_diagnostic_texts)
        self.assertNotIn("10'", all_diagnostic_texts)
        self.assertIn("20'-0\"", all_diagnostic_texts)

        searchable_texts = {
            str(region.get("text") or "")
            for region in self.result["final"]["regions"]
            if region.get("searchable") is True
        }
        self.assertNotIn(EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT, searchable_texts)

    def test_checkpoint_replay_preserves_candidate_and_rejects_stale_fragments(self) -> None:
        regions = self.result["ocr"]["visualTileRegions"]
        proofs = self.result["ocr"]["visualTileProofs"]
        checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=regions,
            proofs=proofs,
        )
        resumed_regions, resumed_proofs = resumed_visual_tile_work(
            checkpoint,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
        )
        self.assertEqual(regions, resumed_regions)
        self.assertEqual(proofs, resumed_proofs)
        self.assertEqual(6, len(resumed_proofs))

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
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )

        old_bounds = {
            "x": 0.769206, "y": 0.306889,
            "width": 0.010159, "height": 0.004,
        }
        stale = {
            **original,
            "bounds": old_bounds,
            "diagnosticCandidates": [
                {
                    "text": "(2'",
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "confidence": 0.0,
                    "bounds": {
                        "x": 0.775238, "y": 0.307333,
                        "width": 0.00381, "height": 0.003333,
                    },
                },
                {
                    "text": "10'",
                    "source": "fixed_visual_tile_coordinate_ocr",
                    "confidence": 0.32,
                    "bounds": {
                        "x": 0.775238, "y": 0.307333,
                        "width": 0.00381, "height": 0.003333,
                    },
                },
            ],
        }
        self.assertNotEqual(
            visual_exception_fingerprint(original),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_exact_fact_is_required_before_publication(self) -> None:
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
                "subject": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
                "location": "",
                "statement": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
                "evidenceText": EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
                "confidence": 0.97,
                "bounds": {"x": 770, "y": 307, "width": 55, "height": 4},
            }],
        }
        resolution = validated_visual_resolution(payload, exception)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        result = {"final": {"regions": []}}
        append_visual_evidence(result, exception, resolution.evidence)
        self.assertEqual(1, len(result["final"]["regions"]))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_EASEMENT_NOTE_TEXT,
            result["final"]["regions"][0]["text"],
        )
        self.assertTrue(result["final"]["regions"][0]["searchable"])

        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, exception).resolved)


if __name__ == "__main__":
    unittest.main()
