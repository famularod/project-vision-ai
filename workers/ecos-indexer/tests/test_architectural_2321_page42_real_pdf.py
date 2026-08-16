"""Opt-in exact-SHA regression for Architectural 2321 page 42."""

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
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS,
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
PAGE_NUMBER = 42
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE42_PDF_TESTS") == "1"


def loading_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        exception for exception in result["unresolved"]
        if any(
            candidate.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE
            for candidate in exception.get("diagnosticCandidates", [])
        )
    ]


def accepted_payload(exception: dict[str, object]) -> dict[str, object]:
    candidates = exception["diagnosticCandidates"]
    indexes = list(range(len(candidates)))
    facts = []
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
                "x": x,
                "y": y,
                "width": x1 - x,
                "height": y1 - y,
            },
        })
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "primaryAcceptedCandidateIndexes": indexes,
        "primaryAcceptedCandidateIndexesValid": True,
        "assuranceAcceptedCandidateIndexes": indexes,
        "assuranceAcceptedCandidateIndexesValid": True,
        "primaryDismissedCandidateIndexes": [],
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexes": [],
        "assuranceDismissedCandidateIndexesValid": True,
        "dismissedCandidateIndexes": [],
        "facts": facts,
    }


def dismissed_payload(exception: dict[str, object]) -> dict[str, object]:
    indexes = list(range(len(exception["diagnosticCandidates"])))
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "primaryAcceptedCandidateIndexes": [],
        "primaryAcceptedCandidateIndexesValid": True,
        "assuranceAcceptedCandidateIndexes": [],
        "assuranceAcceptedCandidateIndexesValid": True,
        "primaryDismissedCandidateIndexes": indexes,
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexes": indexes,
        "assuranceDismissedCandidateIndexesValid": True,
        "dismissedCandidateIndexes": indexes,
        "facts": [],
    }


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE42_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page42ProductionTests(unittest.TestCase):
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

    def test_loading_dimension_is_one_complete_fail_closed_authority(self) -> None:
        exceptions = loading_exceptions(self.result)
        self.assertEqual(1, len(exceptions))
        self.assertEqual(1, len(exceptions[0]["diagnosticCandidates"]))
        candidate = exceptions[0]["diagnosticCandidates"][0]
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT, candidate["text"])
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_SOURCE, candidate["source"])
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["bounds"], candidate["bounds"])
        self.assertNotIn("searchable", candidate)

        all_candidates = [
            item
            for exception in self.result["unresolved"]
            for item in exception.get("diagnosticCandidates", [])
        ]
        self.assertFalse(any(
            item.get("text") == "12'-0\""
            for item in all_candidates
        ))
        self.assertEqual(1, sum(
            item.get("text") == "5'-O\" MIN."
            for item in all_candidates
        ))

        raw_by_id = {
            region["id"]: region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        expected_ids = {
            str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["id"]),
            *(str(spec[0]) for spec in EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_WORDS),
        }
        self.assertTrue(expected_ids.issubset(raw_by_id))
        self.assertEqual(
            EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["text"],
            raw_by_id[str(EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_LINE["id"])]["text"],
        )
        audited_ids = {
            str(region.get("id"))
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page42_loading_dimension_composite"
        }
        self.assertEqual(expected_ids, audited_ids)
        self.assertFalse(any(
            region.get("searchable") is True
            and region.get("text") in {
                EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT,
                "12'-0\"",
                "12'-0\" @ 5' WIDE LOADING!",
            }
            for region in self.result["final"]["regions"]
        ))
        assurance = assure_page(
            page_data=self.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=len(self.result["unresolved"]),
        )
        self.assertEqual(["unresolved_regions"], assurance["failureCodes"])

    def test_checkpoint_replay_preserves_loading_authority_and_fingerprint(self) -> None:
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
        self.assertEqual(loading_exceptions(self.result), loading_exceptions(replayed))
        self.assertEqual(
            visual_exception_fingerprint(loading_exceptions(self.result)[0]),
            visual_exception_fingerprint(loading_exceptions(replayed)[0]),
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        stale = copy.deepcopy(loading_exceptions(self.result)[0])
        stale["diagnosticCandidates"][0] = {
            **stale["diagnosticCandidates"][0],
            "text": "12'-0\"",
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        self.assertNotEqual(
            visual_exception_fingerprint(loading_exceptions(self.result)[0]),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_facts_are_required_and_full_page_can_assure(self) -> None:
        result = copy.deepcopy(self.result)
        loading = loading_exceptions(result)[0]
        payload = accepted_payload(loading)
        resolution = validated_visual_resolution(payload, loading)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)

        one_sided = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "facts": [],
        }
        self.assertFalse(validated_visual_resolution(one_sided, loading).resolved)
        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, loading).resolved)
        duplicate = {
            **payload,
            "primaryAcceptedCandidateIndexes": [0, 0],
            "primaryAcceptedCandidateIndexesValid": False,
        }
        self.assertFalse(validated_visual_resolution(duplicate, loading).resolved)

        append_visual_evidence(result, loading, resolution.evidence)
        for exception in result["unresolved"]:
            if exception["regionKey"] == loading["regionKey"]:
                continue
            dismissed = validated_visual_resolution(
                dismissed_payload(exception),
                exception,
            )
            self.assertTrue(
                dismissed.resolved,
                f"{exception.get('regionKey')}: {dismissed.internal_diagnostics}",
            )
            self.assertEqual([], dismissed.evidence.get("facts", []))

        published = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") == EXACT_ARCHITECTURAL_2321_PAGE42_LOADING_TEXT
        ]
        self.assertEqual(1, len(published))
        self.assertIs(published[0]["searchable"], True)
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
