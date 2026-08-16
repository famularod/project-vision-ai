"""Opt-in exact-SHA regression for Architectural 2321 page 36."""

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
    EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT,
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
PAGE_NUMBER = 36
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE36_PDF_TESTS") == "1"
SUPERSEDED_STATUS = (
    "superseded_by_exact_rendered_page36_clearance_proposition_candidate"
)


def exact_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        item for item in result["unresolved"]
        if any(
            candidate.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_SOURCE
            for candidate in item.get("diagnosticCandidates") or []
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
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE36_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page36ProductionTests(unittest.TestCase):
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

    def test_exact_clearance_is_one_untrusted_complete_candidate(self) -> None:
        exact = exact_exceptions(self.result)
        self.assertEqual(1, len(exact))
        self.assertEqual(1, len(exact[0]["diagnosticCandidates"]))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT,
            exact[0]["diagnosticCandidates"][0]["text"],
        )
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus") == SUPERSEDED_STATUS
        ]
        self.assertEqual(
            {"5'-O\"", "5'-O\" CLR]"},
            {region["text"] for region in superseded},
        )
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        all_candidates = [
            candidate
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ]
        self.assertFalse(any(
            candidate["text"] in {"5'-O\"", "5'-O\" CLR]"}
            for candidate in all_candidates
        ))
        self.assertFalse(any(
            region.get("source") == "vision"
            and region.get("text") == EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT
            for region in self.result["final"]["regions"]
        ))

    def test_checkpoint_replay_preserves_authority_and_fingerprint(self) -> None:
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
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in original],
            [visual_exception_fingerprint(item) for item in replay],
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        stale = copy.deepcopy(original[0])
        stale["diagnosticCandidates"][0]["text"] = "5'-O\" CLR]"
        self.assertNotEqual(
            visual_exception_fingerprint(original[0]),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_exact_fact_is_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exact = exact_exceptions(result)
        self.assertEqual(1, len(exact))
        payload = provider_payload(exact[0], accepted=True)
        resolution = validated_visual_resolution(payload, exact[0])
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        append_visual_evidence(result, exact[0], resolution.evidence)
        one_sided = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "facts": [],
        }
        self.assertFalse(validated_visual_resolution(one_sided, exact[0]).resolved)
        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, exact[0]).resolved)
        duplicate = {
            **payload,
            "primaryAcceptedCandidateIndexes": [0, 0],
            "primaryAcceptedCandidateIndexesValid": False,
        }
        self.assertFalse(validated_visual_resolution(duplicate, exact[0]).resolved)

        for exception in result["unresolved"]:
            if exception in exact:
                continue
            dismissal = validated_visual_resolution(
                provider_payload(exception, accepted=False), exception,
            )
            self.assertTrue(dismissal.resolved, dismissal.internal_diagnostics)
            self.assertEqual([], dismissal.evidence["facts"])

        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") == EXACT_ARCHITECTURAL_2321_PAGE36_CLEARANCE_TEXT
        ]
        self.assertEqual(1, len(accepted))
        self.assertIs(accepted[0]["searchable"], True)
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
