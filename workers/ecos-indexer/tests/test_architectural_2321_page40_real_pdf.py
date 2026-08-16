"""Opt-in exact-SHA regression for Architectural 2321 page 40."""

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
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_TEXT,
    EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_AUTHORITIES,
    EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT,
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
PAGE_NUMBER = 40
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE40_PDF_TESTS") == "1"


def landing_exception(result: dict[str, object]) -> dict[str, object]:
    matches = [
        exception for exception in result["unresolved"]
        if any(
            candidate.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE
            for candidate in exception.get("diagnosticCandidates", [])
        )
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one landing exception, found {len(matches)}")
    return matches[0]


def complete_note_exceptions(
    result: dict[str, object],
) -> list[dict[str, object]]:
    matches = [
        exception for exception in result["unresolved"]
        if any(
            candidate.get("source") in {
                EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_SOURCE,
            }
            for candidate in exception.get("diagnosticCandidates", [])
        )
    ]
    if len(matches) != 3:
        raise AssertionError(f"Expected three complete-note exceptions, found {len(matches)}")
    return matches


def provider_payload(
    exception: dict[str, object],
    *,
    accept: bool,
) -> dict[str, object]:
    candidates = exception["diagnosticCandidates"]
    indexes = list(range(len(candidates)))
    facts = []
    if accept:
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
    accepted = indexes if accept else []
    dismissed = [] if accept else indexes
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": "provider-b",
        "assuranceModel": "assurance-model",
        "primaryAcceptedCandidateIndexes": accepted,
        "primaryAcceptedCandidateIndexesValid": True,
        "assuranceAcceptedCandidateIndexes": accepted,
        "assuranceAcceptedCandidateIndexesValid": True,
        "primaryDismissedCandidateIndexes": dismissed,
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexes": dismissed,
        "assuranceDismissedCandidateIndexesValid": True,
        "dismissedCandidateIndexes": dismissed,
        "facts": facts,
    }


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE40_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page40ProductionTests(unittest.TestCase):
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
                document[PAGE_NUMBER - 1], SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
            )
        finally:
            document.close()

    def test_landing_authority_and_checkpoint_replay_are_exact(self) -> None:
        exception = landing_exception(self.result)
        self.assertEqual(1, len(exception["diagnosticCandidates"]))
        candidate = exception["diagnosticCandidates"][0]
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT, candidate["text"])
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SOURCE, candidate["source"])
        self.assertEqual(EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS[0]["bounds"], candidate["bounds"])
        self.assertNotIn("searchable", candidate)

        expected_ids = {
            str(spec["id"]) for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS
        }
        raw_by_id = {
            region["id"]: region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        self.assertTrue(expected_ids.issubset(raw_by_id))
        audited_ids = {
            str(region.get("id"))
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page40_landing_dimension_composite"
        }
        self.assertEqual(expected_ids, audited_ids)
        self.assertFalse(any(
            region.get("searchable") is True
            and region.get("text") in {
                EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT,
                *[str(spec["text"]) for spec in EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_SPECS],
            }
            for region in self.result["final"]["regions"]
        ))

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
                document[PAGE_NUMBER - 1], SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=self.structural_identity,
                visual_tile_checkpoint=checkpoint,
            )
        finally:
            document.close()
        self.assertEqual(exception, landing_exception(replayed))
        self.assertEqual(
            visual_exception_fingerprint(exception),
            visual_exception_fingerprint(landing_exception(replayed)),
        )
        stale = copy.deepcopy(exception)
        stale["diagnosticCandidates"][0] = {
            **stale["diagnosticCandidates"][0],
            "text": "[1'-6*]",
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        self.assertNotEqual(
            visual_exception_fingerprint(exception),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_acceptance_is_required_before_publication(self) -> None:
        result = copy.deepcopy(self.result)
        target = landing_exception(result)
        payload = provider_payload(target, accept=True)
        resolution = validated_visual_resolution(payload, target)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        append_visual_evidence(result, target, resolution.evidence)

        one_sided = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "facts": [],
        }
        self.assertFalse(validated_visual_resolution(one_sided, target).resolved)
        mixed = {
            **payload,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, target).resolved)
        duplicate = {
            **payload,
            "primaryAcceptedCandidateIndexes": [0, 0],
            "primaryAcceptedCandidateIndexesValid": False,
        }
        self.assertFalse(validated_visual_resolution(duplicate, target).resolved)

        for exception in result["unresolved"]:
            if exception["regionKey"] == target["regionKey"]:
                continue
            dismissed = validated_visual_resolution(
                provider_payload(exception, accept=False), exception,
            )
            self.assertTrue(
                dismissed.resolved,
                f"{exception.get('regionKey')}: {dismissed.internal_diagnostics}",
            )
        published = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") == EXACT_ARCHITECTURAL_2321_PAGE40_LANDING_TEXT
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

    def test_complete_printed_notes_require_dual_provider_acceptance(self) -> None:
        targets = complete_note_exceptions(self.result)
        candidates = [
            exception["diagnosticCandidates"][0] for exception in targets
        ]
        self.assertTrue(all(
            len(exception["diagnosticCandidates"]) == 1
            for exception in targets
        ))
        self.assertEqual(
            [
                EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_TEXT,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT,
            ],
            [candidate["text"] for candidate in candidates],
        )
        self.assertEqual(
            [
                EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_SOURCE,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_SOURCE,
            ],
            [candidate["source"] for candidate in candidates],
        )
        self.assertNotEqual(candidates[1]["bounds"], candidates[2]["bounds"])
        self.assertFalse(any(
            region.get("searchable") is True
            and region.get("text") in {
                EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_TEXT,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT,
            }
            for region in self.result["final"]["regions"]
        ))

        expected_audit_ids = {
            str(spec["id"])
            for spec in EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_SPECS
        }
        expected_audit_ids.update(
            str(spec["id"])
            for authority in EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_AUTHORITIES
            for spec in authority["specSets"][0]
        )
        audited_ids = {
            str(region.get("id"))
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page40_complete_note"
        }
        self.assertEqual(expected_audit_ids, audited_ids)

        regions = self.result["ocr"]["visualTileRegions"]
        proofs = self.result["ocr"]["visualTileProofs"]
        checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=regions,
            proofs=proofs,
        )
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            replayed = extract_page(
                document[PAGE_NUMBER - 1], SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=self.structural_identity,
                visual_tile_checkpoint=checkpoint,
            )
        finally:
            document.close()
        replayed_targets = complete_note_exceptions(replayed)
        self.assertEqual(targets, replayed_targets)
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in targets],
            [visual_exception_fingerprint(item) for item in replayed_targets],
        )

        handrail = targets[0]
        accepted = provider_payload(handrail, accept=True)
        one_sided = {
            **accepted,
            "assuranceAcceptedCandidateIndexes": [],
            "facts": [],
        }
        self.assertFalse(
            validated_visual_resolution(one_sided, handrail).resolved
        )
        mixed = {
            **accepted,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceDismissedCandidateIndexes": [0],
        }
        self.assertFalse(validated_visual_resolution(mixed, handrail).resolved)

        result = copy.deepcopy(self.result)
        target_keys = {target["regionKey"] for target in targets}
        for exception in result["unresolved"]:
            resolution = validated_visual_resolution(
                provider_payload(
                    exception,
                    accept=exception["regionKey"] in target_keys,
                ),
                exception,
            )
            self.assertTrue(
                resolution.resolved,
                f"{exception.get('regionKey')}: {resolution.internal_diagnostics}",
            )
            if resolution.evidence:
                append_visual_evidence(result, exception, resolution.evidence)

        published = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") in {
                EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_TEXT,
                EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT,
            }
        ]
        self.assertEqual(3, len(published))
        self.assertEqual(1, sum(
            region["text"] == EXACT_ARCHITECTURAL_2321_PAGE40_HANDRAIL_TEXT
            for region in published
        ))
        self.assertEqual(2, sum(
            region["text"] == EXACT_ARCHITECTURAL_2321_PAGE40_SUPPORT_POST_TEXT
            for region in published
        ))
        self.assertTrue(all(region["searchable"] is True for region in published))
        assurance = assure_page(
            page_data=result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(assurance["accepted"], assurance["failureCodes"])


if __name__ == "__main__":
    unittest.main()
