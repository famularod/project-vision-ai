"""Opt-in exact-SHA regression for Architectural 2321 page 41."""

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
    EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS,
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
PAGE_NUMBER = 41
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE41_PDF_TESTS") == "1"
SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_page41_complete_proposition_candidate"
)


def exact_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        item for item in result["unresolved"]
        if item.get("diagnosticCandidates")
        and all(
            candidate.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SOURCE
            for candidate in item["diagnosticCandidates"]
        )
    ]


def provider_payload(
    exception: dict[str, object], *, accepted: bool,
) -> dict[str, object]:
    candidates = exception["diagnosticCandidates"]
    indexes = list(range(len(candidates)))
    facts = []
    if accepted:
        for candidate in candidates:
            bounds = candidate["bounds"]
            x = math.ceil(float(bounds["x"]) * 1000)
            y = math.ceil(float(bounds["y"]) * 1000)
            x1 = math.floor(
                (float(bounds["x"]) + float(bounds["width"])) * 1000
            )
            y1 = math.floor(
                (float(bounds["y"]) + float(bounds["height"])) * 1000
            )
            text = str(candidate["text"])
            facts.append({
                "subject": text,
                "location": "",
                "statement": text,
                "evidenceText": text,
                "confidence": 0.97,
                "bounds": {
                    "x": x, "y": y,
                    "width": x1 - x, "height": y1 - y,
                },
            })
    accepted_indexes = indexes if accepted else []
    dismissed_indexes = [] if accepted else indexes
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "primaryAcceptedCandidateIndexes": accepted_indexes,
        "primaryAcceptedCandidateIndexesValid": True,
        "assuranceAcceptedCandidateIndexes": accepted_indexes,
        "assuranceAcceptedCandidateIndexesValid": True,
        "primaryDismissedCandidateIndexes": dismissed_indexes,
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexes": dismissed_indexes,
        "assuranceDismissedCandidateIndexesValid": True,
        "dismissedCandidateIndexes": dismissed_indexes,
        "facts": facts,
    }


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE41_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page41ProductionTests(unittest.TestCase):
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

    def test_exact_fragments_become_four_untrusted_complete_candidates(self) -> None:
        exact = exact_exceptions(self.result)
        self.assertEqual(4, len(exact))
        self.assertTrue(all(len(item["diagnosticCandidates"]) == 1 for item in exact))
        candidates = [item["diagnosticCandidates"][0] for item in exact]
        self.assertEqual(
            [
                spec["canonicalText"]
                for spec in EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS
            ],
            [candidate["text"] for candidate in candidates],
        )
        self.assertEqual(
            [
                spec["candidateBounds"]
                for spec in EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS
            ],
            [candidate["bounds"] for candidate in candidates],
        )
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus") == SUPERSEDED_STATUS
        ]
        self.assertEqual(4, len(superseded))
        self.assertEqual({"6'-O\""}, {region["text"] for region in superseded})
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        authority_ids = {
            str(spec["authority"]["id"])
            for spec in EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS
        }
        self.assertEqual(authority_ids, {str(region["id"]) for region in superseded})
        all_candidates = [
            candidate
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ]
        self.assertFalse(any(
            candidate["text"] == "6'-O\""
            and candidate.get("source") == "fixed_visual_tile_coordinate_ocr"
            for candidate in all_candidates
        ))
        canonical_texts = {
            spec["canonicalText"]
            for spec in EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS
        }
        self.assertFalse(any(
            region.get("source") == "vision"
            and region.get("text") in canonical_texts
            for region in self.result["final"]["regions"]
        ))

    def test_checkpoint_replay_preserves_authority_order_and_fingerprints(self) -> None:
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
        self.assertEqual(6, len(proofs))
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
        original = exact_exceptions(self.result)
        replay = exact_exceptions(replayed)
        self.assertEqual(original, replay)
        original_fingerprints = [
            visual_exception_fingerprint(item) for item in original
        ]
        self.assertEqual(
            original_fingerprints,
            [visual_exception_fingerprint(item) for item in replay],
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        stale = copy.deepcopy(original[0])
        stale["diagnosticCandidates"][0].update({
            "text": "6'-O\"",
            "source": "fixed_visual_tile_coordinate_ocr",
            "bounds": dict(
                EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS[0]["authority"]["bounds"]
            ),
        })
        self.assertNotIn(
            visual_exception_fingerprint(stale), original_fingerprints,
        )

    def test_dual_provider_exact_facts_are_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exact = exact_exceptions(result)
        self.assertEqual(4, len(exact))
        for exception in exact:
            payload = provider_payload(exception, accepted=True)
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
            self.assertFalse(validated_visual_resolution(mixed, exception).resolved)
            duplicate = {
                **payload,
                "primaryAcceptedCandidateIndexes": [0, 0],
                "primaryAcceptedCandidateIndexesValid": False,
            }
            self.assertFalse(
                validated_visual_resolution(duplicate, exception).resolved
            )
            partial = copy.deepcopy(payload)
            partial["facts"][0]["statement"] = "6'-0\""
            partial["facts"][0]["subject"] = "6'-0\""
            partial["facts"][0]["evidenceText"] = "6'-0\""
            self.assertFalse(validated_visual_resolution(partial, exception).resolved)

        def published_bounds(spec: dict[str, object]) -> dict[str, float]:
            bounds = spec["candidateBounds"]
            x = math.ceil(float(bounds["x"]) * 1000)
            y = math.ceil(float(bounds["y"]) * 1000)
            x1 = math.floor(
                (float(bounds["x"]) + float(bounds["width"])) * 1000
            )
            y1 = math.floor(
                (float(bounds["y"]) + float(bounds["height"])) * 1000
            )
            return {
                "x": x / 1000,
                "y": y / 1000,
                "width": (x1 - x) / 1000,
                "height": (y1 - y) / 1000,
            }

        canonical_pairs = [
            (spec["canonicalText"], published_bounds(spec))
            for spec in EXACT_ARCHITECTURAL_2321_PAGE41_PROPOSITION_SPECS
        ]
        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and any(region.get("text") == text for text, _ in canonical_pairs)
        ]
        self.assertEqual(4, len(accepted))
        self.assertEqual(
            canonical_pairs,
            [
                (
                    region["text"],
                    {key: region[key] for key in ("x", "y", "width", "height")},
                )
                for region in accepted
            ],
        )
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

        dismissed_result = copy.deepcopy(self.result)
        for exception in exact_exceptions(dismissed_result):
            dismissal = validated_visual_resolution(
                provider_payload(exception, accepted=False), exception,
            )
            self.assertTrue(dismissal.resolved, dismissal.internal_diagnostics)
            self.assertEqual([], dismissal.evidence["facts"])
        self.assertFalse(any(
            region.get("source") == "vision"
            and any(region.get("text") == text for text, _ in canonical_pairs)
            for region in dismissed_result["final"]["regions"]
        ))


if __name__ == "__main__":
    unittest.main()
