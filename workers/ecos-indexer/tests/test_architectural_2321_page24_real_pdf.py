"""Opt-in exact-SHA regression for Architectural 2321 page 24."""

import copy
import hashlib
import math
import os
import unittest
from pathlib import Path

import pymupdf

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES,
    EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER,
    EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
    extract_page,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    validated_visual_resolution,
    visual_exception_fingerprint,
)
from ecos_indexer.worker import append_visual_evidence


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = EXACT_ARCHITECTURAL_2321_KEYNOTE_PAGE_NUMBER
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE24_PDF_TESTS") == "1"


def fence_exception(result: dict[str, object]) -> dict[str, object]:
    matches = [
        item for item in result["unresolved"]
        if len(item.get("diagnosticCandidates") or []) == 1
        and item["diagnosticCandidates"][0].get("source")
        == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one exact fence exception, got {matches!r}")
    return matches[0]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE24_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page24ProductionTests(unittest.TestCase):
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

    def test_complete_fence_keynote_replaces_only_malformed_authority(self) -> None:
        spec = EXACT_ARCHITECTURAL_2321_KEYNOTE_CANDIDATES[0]
        exception = fence_exception(self.result)
        self.assertEqual(spec["bounds"], exception["bounds"])
        self.assertEqual(spec["text"], exception["diagnosticCandidates"][0]["text"])
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
            exception["diagnosticCandidates"][0]["source"],
        )

        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        for constituent in spec["constituents"]:
            raw = raw_by_id[str(constituent["id"])]
            self.assertEqual(tuple(constituent["texts"])[0], raw["text"])
            self.assertNotIn("visualAuthorityStatus", raw)

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        fragment = next(
            region for region in rejected
            if region.get("id") == spec["constituents"][1]["id"]
        )
        self.assertEqual("6'-O\"", fragment["text"])
        self.assertFalse(fragment["searchable"])
        self.assertEqual(
            "superseded_by_exact_rendered_site_note_composite",
            fragment["visualAuthorityStatus"],
        )
        self.assertFalse(any(
            candidate.get("text") == "6'-O\""
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ))
        self.assertFalse(any(
            region.get("source") == "vision"
            and region.get("text") == spec["text"]
            for region in self.result["final"]["regions"]
        ))
        self.assertNotIn(str(spec["text"]), str(self.result["final"]["text"] or ""))

    def test_checkpoint_replay_preserves_fence_candidate_and_fingerprint(self) -> None:
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
        original = fence_exception(self.result)
        replay = fence_exception(replayed)
        self.assertEqual(original, replay)
        self.assertEqual(
            visual_exception_fingerprint(original),
            visual_exception_fingerprint(replay),
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )

        stale = copy.deepcopy(original)
        stale["diagnosticCandidates"][0] = {
            "text": "6'-O\"",
            "source": "fixed_visual_tile_measurement_transcription_correction",
            "confidence": 0.81,
            "bounds": {
                "x": 0.732571, "y": 0.213944,
                "width": 0.02073, "height": 0.004333,
            },
        }
        stale["bounds"] = dict(stale["diagnosticCandidates"][0]["bounds"])
        self.assertNotEqual(
            visual_exception_fingerprint(original),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_exact_fence_fact_is_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exception = fence_exception(result)
        candidate = exception["diagnosticCandidates"][0]
        bounds = candidate["bounds"]
        x = math.ceil(float(bounds["x"]) * 1000)
        y = math.ceil(float(bounds["y"]) * 1000)
        x1 = math.floor((float(bounds["x"]) + float(bounds["width"])) * 1000)
        y1 = math.floor((float(bounds["y"]) + float(bounds["height"])) * 1000)
        text = str(candidate["text"])
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
                "subject": text,
                "location": "",
                "statement": text,
                "evidenceText": text,
                "confidence": 0.97,
                "bounds": {
                    "x": x, "y": y,
                    "width": x1 - x, "height": y1 - y,
                },
            }],
        }
        resolution = validated_visual_resolution(payload, exception)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        append_visual_evidence(result, exception, resolution.evidence)

        one_sided = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "facts": [],
        }
        self.assertFalse(validated_visual_resolution(one_sided, exception).resolved)
        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, exception).resolved)

        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision" and region.get("text") == text
        ]
        self.assertEqual(1, len(accepted))
        self.assertTrue(accepted[0]["searchable"])
        assurance = assure_page(
            page_data=result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(assurance["accepted"], assurance["failureCodes"])
        self.assertEqual([], assurance["failureCodes"])


if __name__ == "__main__":
    unittest.main()
