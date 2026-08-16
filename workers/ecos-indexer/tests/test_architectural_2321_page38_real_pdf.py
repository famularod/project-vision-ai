"""Opt-in exact-SHA regression for Architectural 2321 page 38."""

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
    EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE,
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
PAGE_NUMBER = 38
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE38_PDF_TESTS") == "1"


def schedule_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        item for item in result["unresolved"]
        if item.get("diagnosticCandidates")
        and all(
            candidate.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE38_SCHEDULE_SOURCE
            for candidate in item["diagnosticCandidates"]
        )
    ]


def schedule_candidates(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        candidate
        for exception in schedule_exceptions(result)
        for candidate in exception["diagnosticCandidates"]
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


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE38_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page38ProductionTests(unittest.TestCase):
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

    def test_schedule_authority_is_complete_clean_and_fail_closed(self) -> None:
        candidates = schedule_candidates(self.result)
        self.assertEqual(
            [spec["canonical"] for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS],
            [candidate["text"] for candidate in candidates],
        )
        self.assertEqual(
            [spec["bounds"] for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS],
            [candidate["bounds"] for candidate in candidates],
        )
        self.assertEqual(len(candidates), len(schedule_exceptions(self.result)))
        self.assertTrue(all("searchable" not in candidate for candidate in candidates))

        raw_by_id = {
            region["id"]: region for region in self.result["ocr"]["visualTileRegions"]
        }
        for spec in (
            *EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS,
            *EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS,
        ):
            self.assertEqual(spec["text"], raw_by_id[spec["id"]]["text"])
            self.assertEqual(spec["bounds"], {
                key: raw_by_id[spec["id"]][key]
                for key in ("x", "y", "width", "height")
            })

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        audited_ids = {
            str(region.get("id")) for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_page38_door_schedule_measurement"
        }
        self.assertTrue({spec["id"] for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS}.issubset(audited_ids))
        self.assertTrue({spec["id"] for spec in EXACT_ARCHITECTURAL_2321_PAGE38_GRID_ARTIFACT_SPECS}.issubset(audited_ids))

        canonical = {f"{feet}'-0\"" for feet in (3, 4, 6, 7, 8, 10, 12)}
        schedule_searchable = []
        for region in self.result["final"]["regions"]:
            x = region.get("x")
            y = region.get("y")
            if (
                region.get("searchable") is True
                and isinstance(x, (int, float))
                and isinstance(y, (int, float))
                and 0.076 <= y <= 0.701
                and 0.414 <= x <= 0.445
            ):
                schedule_searchable.append(region)
        self.assertTrue(schedule_searchable)
        self.assertTrue(all(region["text"] in canonical for region in schedule_searchable))
        corrected = [
            region for region in schedule_searchable
            if region.get("source") == "exact_page38_door_schedule_grid_measurement"
        ]
        self.assertEqual(66, len(corrected))
        self.assertTrue(all(
            region.get("evidenceSources") == ["fixed_visual_tile_coordinate_ocr"]
            and region.get("reconstructionMethod")
            == "exact_source_bound_door_schedule_grid_rule_separation"
            for region in corrected
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

    def test_checkpoint_replay_preserves_schedule_authority(self) -> None:
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
        self.assertEqual(schedule_exceptions(self.result), schedule_exceptions(replayed))
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in schedule_exceptions(self.result)],
            [visual_exception_fingerprint(item) for item in schedule_exceptions(replayed)],
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        stale = copy.deepcopy(schedule_exceptions(self.result)[0])
        stale["diagnosticCandidates"][0] = {
            **stale["diagnosticCandidates"][0],
            "text": "70\"",
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        self.assertNotEqual(
            visual_exception_fingerprint(schedule_exceptions(self.result)[0]),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_schedule_facts_are_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exceptions = schedule_exceptions(result)
        self.assertEqual(
            len(EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS),
            len(exceptions),
        )
        for exception in exceptions:
            payload = accepted_payload(exception)
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
            duplicate = {
                **payload,
                "primaryAcceptedCandidateIndexes": [0, 0],
                "primaryAcceptedCandidateIndexesValid": False,
            }
            self.assertFalse(validated_visual_resolution(duplicate, exception).resolved)

        expected = [
            spec["canonical"]
            for spec in EXACT_ARCHITECTURAL_2321_PAGE38_AMBIGUOUS_SPECS
        ]
        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") in set(expected)
        ]
        self.assertEqual(expected, [region["text"] for region in accepted])
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
