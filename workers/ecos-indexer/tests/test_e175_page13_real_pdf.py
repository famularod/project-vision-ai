"""Opt-in exact-SHA regression for hosted job e175 page 13."""

import copy
import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    extract_page,
    open_pdf,
    resumed_visual_tile_work,
    visual_subtile_analysis_sha256,
    visual_tile_analysis_sha256,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    validated_visual_resolution,
    visual_exception_fingerprint,
)
from ecos_indexer.worker import (
    append_visual_evidence,
    reusable_resolved_visual_evidence,
)


SOURCE_PATH_VALUE = os.getenv("ECOS_E175_REGRESSION_PDF", "").strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 13
RUN_EXACT = os.getenv("ECOS_RUN_E175_PAGE13_PDF_TESTS") == "1"
TARGET_LINE_BOUNDS = {
    "x": 0.755714, "y": 0.789778,
    "width": 0.024286, "height": 0.008889,
}
TARGET_WORD_BOUNDS = {
    "x": 0.764762, "y": 0.791333,
    "width": 0.007778, "height": 0.007333,
}
TARGET_NATIVE_BOUNDS = {
    "x": 0.759762, "y": 0.794233,
    "width": 0.012946, "height": 0.004424,
}


def normalized_text(value: object) -> str:
    return (
        str(value or "")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201d", '"')
        .replace("\u201c", '"')
    )


def exact_bounds(region: dict[str, object]) -> dict[str, object]:
    return {key: region.get(key) for key in ("x", "y", "width", "height")}


def target_visual_regions(
    regions: list[dict[str, object]],
) -> tuple[dict[str, object], dict[str, object]]:
    lines = [
        region for region in regions
        if region.get("ocrKind") == "line"
        and exact_bounds(region) == TARGET_LINE_BOUNDS
        and "@20'" in normalized_text(region.get("text"))
    ]
    words = [
        region for region in regions
        if region.get("ocrKind") == "word"
        and exact_bounds(region) == TARGET_WORD_BOUNDS
        and normalized_text(region.get("text")) == "@20'"
    ]
    if len(lines) != 1 or len(words) != 1:
        raise AssertionError(
            "Exact e175 page-13 photometric target changed: "
            f"lines={len(lines)}, words={len(words)}"
        )
    return lines[0], words[0]


def target_exception(result: dict[str, object]) -> dict[str, object]:
    matches = [
        item
        for item in result["unresolved"]
        if item.get("regionKey", "").startswith("low-confidence-ocr-")
        and item.get("diagnosticCandidates") == [{
            "text": "A1 @ 20'",
            "source": "exact_native_visual_composite_candidate",
            "confidence": 0.18,
            "bounds": TARGET_NATIVE_BOUNDS,
        }]
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one exact composite exception, found {matches}")
    return matches[0]


def rehash_visual_checkpoint(
    regions: list[dict[str, object]],
    proofs: list[dict[str, object]],
) -> None:
    by_id = {str(region["id"]): region for region in regions}
    for proof in proofs:
        proof_region_ids = [str(value) for value in proof["analysisRegionIds"]]
        proof["analysisSha256"] = visual_tile_analysis_sha256(
            str(proof["tileKey"]),
            [by_id[region_id] for region_id in proof_region_ids],
        )
        for subtile in proof["analysisSubtileProofs"]:
            subtile_region_ids = [
                str(value) for value in subtile["analysisRegionIds"]
            ]
            subtile["analysisSha256"] = visual_subtile_analysis_sha256(
                [by_id[region_id] for region_id in subtile_region_ids]
            )


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_E175_PAGE13_PDF_TESTS=1 with the exact e175 source.",
)
class ExactE175Page13ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = SOURCE_PATH.read_bytes()
        actual_sha = hashlib.sha256(source).hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(f"Issued e175 source SHA changed: {actual_sha}")

        document = open_pdf(source)
        try:
            cls.structural_identity = document_sheet_identity_map(document).get(
                PAGE_NUMBER,
            )
            baseline = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
            )
        finally:
            document.close()

        regions = copy.deepcopy(baseline["ocr"]["visualTileRegions"])
        proofs = copy.deepcopy(baseline["ocr"]["visualTileProofs"])
        target_line, target_word = target_visual_regions(regions)
        target_line["confidence"] = 0.18
        target_word["confidence"] = 0.18
        target_ids = {str(target_line["id"]), str(target_word["id"])}
        for proof in proofs:
            searchable_ids = [
                str(value) for value in proof.get("searchableRegionIds") or []
                if str(value) not in target_ids
            ]
            proof["searchableRegionIds"] = searchable_ids
            proof["searchableRegionCount"] = len(searchable_ids)
        rehash_visual_checkpoint(regions, proofs)
        cls.forced_regions = regions
        cls.forced_proofs = proofs
        cls.forced_checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER,
            source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION,
            regions=regions,
            proofs=proofs,
        )
        resumed_regions, resumed_proofs = resumed_visual_tile_work(
            cls.forced_checkpoint,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
        )
        if resumed_regions != regions or resumed_proofs != proofs:
            raise AssertionError("Rehashed exact page-13 checkpoint was not accepted")

        document = open_pdf(source)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1],
                SOURCE_SHA256,
                project_id=PROJECT_ID,
                document_sheet_identity=cls.structural_identity,
                visual_tile_checkpoint=cls.forced_checkpoint,
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

    def test_raw_native_line_and_word_are_retained_with_composite_provenance(self) -> None:
        raw_line, raw_word = target_visual_regions(
            self.result["ocr"]["visualTileRegions"]
        )
        self.assertEqual('"dat @20\' "3.4', normalized_text(raw_line["text"]))
        self.assertEqual("@20'", normalized_text(raw_word["text"]))
        self.assertEqual(0.18, raw_line["confidence"])
        self.assertEqual(0.18, raw_word["confidence"])
        self.assertNotIn("visualAuthorityStatus", raw_line)
        self.assertNotIn("visualAuthorityStatus", raw_word)

        native_matches = [
            region for region in self.result["native"]["regions"]
            if normalized_text(region.get("text")) == "A1 @ 20'"
            and exact_bounds(region) == TARGET_NATIVE_BOUNDS
        ]
        self.assertEqual(1, len(native_matches))
        self.assertEqual("embedded_text", native_matches[0]["source"])
        self.assertFalse(native_matches[0]["searchable"])

        rejected_line, rejected_word = target_visual_regions(
            self.result["ocr"]["rejectedLowConfidenceRegions"]
        )
        for region in (rejected_line, rejected_word):
            with self.subTest(region=region["ocrKind"]):
                self.assertEqual(
                    "unresolved_low_confidence",
                    region["ocrValidationStatus"],
                )
                self.assertEqual(
                    "superseded_by_exact_native_visual_composite",
                    region["visualAuthorityStatus"],
                )
                self.assertEqual(
                    "review_complete_A1_at_20ft_composite_instead",
                    region["visualAuthorityReason"],
                )

        composites = [
            region for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("id") == "e175-page13-A1-at-20ft-candidate"
        ]
        self.assertEqual(1, len(composites))
        self.assertEqual(
            [native_matches[0]["id"], rejected_line["id"], rejected_word["id"]],
            composites[0]["constituentEvidence"],
        )
        self.assertFalse(composites[0]["searchable"])

    def test_pre_provider_state_has_one_full_candidate_and_no_publication(self) -> None:
        exception = target_exception(self.result)
        self.assertEqual(TARGET_NATIVE_BOUNDS, exception["bounds"])
        self.assertEqual(1, exception["diagnosticCandidateCount"])
        all_candidates = [
            candidate
            for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
            for candidate in item["diagnosticCandidates"]
        ]
        self.assertEqual(["A1 @ 20'"], [item["text"] for item in all_candidates])
        self.assertNotIn("@20'", [item["text"] for item in all_candidates])

        final_regions = self.result["final"]["regions"]
        self.assertFalse(any(
            region.get("source") == "exact_native_visual_composite_candidate"
            for region in final_regions
        ))
        searchable_regions = [
            region for region in final_regions
            if region.get("searchable") is not False
        ]
        self.assertFalse(any(
            normalized_text(region.get("text")) == "A1 @ 20'"
            for region in searchable_regions
        ))
        self.assertNotIn("A1 @ 20'", normalized_text(self.result["final"]["text"]))

    def test_visual_checkpoint_replay_preserves_raw_audit_and_outcome(self) -> None:
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
        self.assertEqual(6, len(resumed_proofs))
        self.assertEqual(regions, resumed_regions)
        self.assertEqual(proofs, resumed_proofs)

        source = SOURCE_PATH.read_bytes()
        document = open_pdf(source)
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

        self.assertEqual(self.result["final"], replayed["final"])
        self.assertEqual(self.result["unresolved"], replayed["unresolved"])
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        self.assertEqual(
            self.result["ocr"]["visualTileRegions"],
            replayed["ocr"]["visualTileRegions"],
        )

        original_exception = target_exception(self.result)
        replayed_exception = target_exception(replayed)
        self.assertEqual(original_exception["regionKey"], replayed_exception["regionKey"])
        self.assertEqual(original_exception, replayed_exception)
        self.assertEqual(
            visual_exception_fingerprint(original_exception),
            visual_exception_fingerprint(replayed_exception),
        )

    def test_no_provider_keeps_page_unresolved_and_assurance_fail_closed(self) -> None:
        self.assertEqual(1, len(self.result["unresolved"]))
        target_exception(self.result)
        self.assertFalse(self.assurance["accepted"])

    def test_dual_provider_acceptance_appends_only_canonical_searchable_fact(self) -> None:
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
                "subject": "fixture A1 mounting height",
                "location": "site plan",
                "statement": "A1 @ 20'",
                "evidenceText": "A1 @ 20'",
                "confidence": 0.97,
                "bounds": {"x": 760, "y": 794, "width": 12, "height": 4},
            }],
        }
        resolution = validated_visual_resolution(payload, exception)
        self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
        self.assertEqual("A1 @ 20'", resolution.evidence["facts"][0]["statement"])
        self.assertEqual([0], resolution.evidence["acceptedCandidateIndexes"])

        result = {"final": {"regions": []}}
        append_visual_evidence(result, exception, resolution.evidence)
        self.assertEqual(1, len(result["final"]["regions"]))
        self.assertEqual("A1 @ 20'", result["final"]["regions"][0]["text"])
        self.assertTrue(result["final"]["regions"][0]["searchable"])

    def test_one_sided_or_mixed_provider_disposition_remains_unresolved(self) -> None:
        exception = target_exception(self.result)
        baseline = {
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
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexesValid": True,
            "facts": [],
            "primaryDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexes": [0],
            "dismissedCandidateIndexes": [0],
        }
        cases = {
            "primary-only": {**baseline, "assuranceDismissedCandidateIndexes": []},
            "assurance-only": {**baseline, "primaryDismissedCandidateIndexes": []},
            "joint-missing": {**baseline, "dismissedCandidateIndexes": []},
            "fact-plus-dismissal": {
                **baseline,
                "facts": [{
                    "subject": "fixture", "location": "site plan",
                    "statement": "A1 @ 20'", "evidenceText": "A1 @ 20'",
                    "confidence": 0.97,
                    "bounds": {"x": 760, "y": 794, "width": 12, "height": 4},
                }],
            },
        }
        for name, payload in cases.items():
            with self.subTest(name=name):
                self.assertFalse(
                    validated_visual_resolution(payload, exception).resolved
                )

    def test_old_fragment_or_other_ordinal_resolution_cannot_cross_bind(self) -> None:
        composite = target_exception(self.result)
        composite_fingerprint = visual_exception_fingerprint(composite)
        old_fragment = {
            **composite,
            "bounds": TARGET_WORD_BOUNDS,
            "diagnosticCandidates": [{
                "text": "@20'", "source": "fixed_visual_tile_coordinate_ocr",
                "confidence": 0.18, "bounds": TARGET_WORD_BOUNDS,
            }],
        }
        other_ordinal = {**composite, "regionKey": "low-confidence-ocr-2"}
        for stale in (old_fragment, other_ordinal):
            stale_fingerprint = visual_exception_fingerprint(stale)
            self.assertNotEqual(composite_fingerprint, stale_fingerprint)
            stored = {
                "bounds": stale["bounds"],
                "evidence_version": EVIDENCE_VERSION,
                "exception_fingerprint": stale_fingerprint,
                "normalized_evidence": {},
                "assurance_result": {},
            }
            self.assertIsNone(reusable_resolved_visual_evidence(
                composite,
                stored,
                evidence_version=EVIDENCE_VERSION,
                exception_fingerprint=composite_fingerprint,
            ))


if __name__ == "__main__":
    unittest.main()
