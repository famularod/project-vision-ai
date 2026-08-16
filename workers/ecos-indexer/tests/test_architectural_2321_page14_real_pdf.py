"""Opt-in exact-SHA regression for Architectural 2321 page 14."""

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
    EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS,
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
PAGE_NUMBER = 14
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE14_PDF_TESTS") == "1"


def dimension_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    matches = [
        item for item in result["unresolved"]
        if len(item.get("diagnosticCandidates") or []) == 1
        and item["diagnosticCandidates"][0].get("source")
        == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
    ]
    return sorted(matches, key=lambda item: (
        float(item["bounds"]["y"]), float(item["bounds"]["x"])
    ))


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE14_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page14ProductionTests(unittest.TestCase):
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

    def test_complete_80ft_dimensions_replace_only_malformed_authorities(self) -> None:
        exceptions = dimension_exceptions(self.result)
        self.assertEqual(2, len(exceptions))
        self.assertEqual(
            ["80'-0\"", "80'-0\""],
            [item["diagnosticCandidates"][0]["text"] for item in exceptions],
        )
        self.assertEqual(
            [spec["bounds"] for spec in EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS],
            [item["diagnosticCandidates"][0]["bounds"] for item in exceptions],
        )

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page14_dimension_composite"
        ]
        self.assertEqual(3, len(superseded))
        self.assertEqual(
            {"80’", "D'", "80'-2'"},
            {str(region["text"]) for region in superseded},
        )
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        self.assertFalse(any(
            candidate.get("text") in {"80’", "80'-2'", "‘1’"}
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ))
        self.assertFalse(any(
            region.get("source") == "vision"
            and region.get("text") == "80'-0\""
            for region in self.result["final"]["regions"]
        ))

    def test_checkpoint_replay_preserves_candidates_and_fingerprints(self) -> None:
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
        original = dimension_exceptions(self.result)
        replay = dimension_exceptions(replayed)
        self.assertEqual(original, replay)
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in original],
            [visual_exception_fingerprint(item) for item in replay],
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        stale = copy.deepcopy(original[0])
        stale["diagnosticCandidates"][0]["text"] = "80’"
        stale["diagnosticCandidates"][0]["source"] = (
            "fixed_visual_tile_coordinate_ocr"
        )
        self.assertNotEqual(
            visual_exception_fingerprint(original[0]),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_exact_dimensions_are_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exceptions = dimension_exceptions(result)
        for exception in exceptions:
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
            self.assertFalse(
                validated_visual_resolution(one_sided, exception).resolved
            )
            mixed = {
                **payload,
                "assuranceAcceptedCandidateIndexes": [],
                "assuranceDismissedCandidateIndexes": [0],
            }
            self.assertFalse(
                validated_visual_resolution(mixed, exception).resolved
            )

        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") == "80'-0\""
        ]
        self.assertEqual(2, len(accepted))
        self.assertTrue(all(region["searchable"] is True for region in accepted))
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
