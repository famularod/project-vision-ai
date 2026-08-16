"""Opt-in exact-SHA regression for Architectural 2321 page 30."""

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
    EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS,
    extract_page,
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
from ecos_indexer.worker import append_visual_evidence


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 30
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE30_PDF_TESTS") == "1"
EXPECTED_SPECS = [
    *EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SPECS,
    *(
        spec for spec in EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS
        if spec["id"]
        != "architectural-2321-page30-northeast-24ft-0in-candidate"
    ),
]
EXPECTED_SOURCES = {
    EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE,
}


def dimension_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    matches = []
    for item in result["unresolved"]:
        candidates = item.get("diagnosticCandidates") or []
        if candidates and all(
            candidate.get("source") in EXPECTED_SOURCES
            for candidate in candidates
        ):
            matches.append(item)
    return matches


def dimension_candidates(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        candidate
        for exception in dimension_exceptions(result)
        for candidate in exception["diagnosticCandidates"]
    ]


def accepted_payload(exception: dict[str, object]) -> dict[str, object]:
    candidates = exception["diagnosticCandidates"]
    accepted_indexes = list(range(len(candidates)))
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
                "x": x, "y": y,
                "width": x1 - x, "height": y1 - y,
            },
        })
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
        "primaryDismissedCandidateIndexes": [],
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexes": [],
        "assuranceDismissedCandidateIndexesValid": True,
        "dismissedCandidateIndexes": [],
        "facts": facts,
    }


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE30_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page30ProductionTests(unittest.TestCase):
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

    def test_complete_dimensions_replace_only_malformed_authorities(self) -> None:
        exceptions = dimension_exceptions(self.result)
        candidates = dimension_candidates(self.result)
        self.assertEqual(13, len(exceptions))
        self.assertEqual(
            [1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [len(item["diagnosticCandidates"]) for item in exceptions],
        )
        self.assertEqual(14, len(candidates))
        self.assertEqual(
            [spec["text"] for spec in EXPECTED_SPECS],
            [candidate["text"] for candidate in candidates],
        )
        self.assertEqual(
            [spec["bounds"] for spec in EXPECTED_SPECS],
            [candidate["bounds"] for candidate in candidates],
        )

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composites = [
            region for region in rejected
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SOURCE
        ]
        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page30_dimension_candidate"
        ]
        self.assertEqual(13, len(composites))
        self.assertEqual(13, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in composites))
        self.assertTrue(all(region["searchable"] is False for region in superseded))
        malformed_texts = {
            str(spec["raw"]["text"])
            for spec in EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS
        }
        complete = [
            region for region in rejected
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE30_COMPLETE_PROPOSITION_SOURCE
        ]
        complete_superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page30_complete_proposition_candidate"
        ]
        self.assertEqual(2, len(complete))
        self.assertEqual(6, len(complete_superseded))
        self.assertTrue(all(region["searchable"] is False for region in complete))
        self.assertTrue(all(
            region["searchable"] is False for region in complete_superseded
        ))
        self.assertFalse(any(
            candidate["text"] in malformed_texts
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ))
        self.assertFalse(any(
            region.get("source") == "vision"
            and region.get("text") in {spec["text"] for spec in EXPECTED_SPECS}
            for region in self.result["final"]["regions"]
        ))
        self.assertNotIn("24'-0\"", {candidate["text"] for candidate in candidates})
        self.assertNotIn("186'", {candidate["text"] for candidate in candidates})

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
        stale["diagnosticCandidates"][0] = {
            **stale["diagnosticCandidates"][0],
            "text": "S9'-10'",
            "source": "fixed_visual_tile_coordinate_ocr",
        }
        self.assertNotEqual(
            visual_exception_fingerprint(original[0]),
            visual_exception_fingerprint(stale),
        )

    def test_checkpoint_replay_tolerates_production_ocr_score_and_text_variance(
        self,
    ) -> None:
        regions = copy.deepcopy(self.result["ocr"]["visualTileRegions"])
        proofs = copy.deepcopy(self.result["ocr"]["visualTileProofs"])

        def matches_spec(
            region: dict[str, object],
            spec: dict[str, object],
            *,
            kind: str,
            bounds: dict[str, float],
        ) -> bool:
            raw_spec = spec["raw"]
            return bool(
                region.get("source") == "fixed_visual_tile_coordinate_ocr"
                and region.get("ocrKind") == kind
                and region.get("ocrBoundaryTruncated") is False
                and region.get("ocrPrefix") == raw_spec["ocrPrefix"]
                and all(region.get(key) == value for key, value in bounds.items())
            )

        for index, spec in enumerate(
            EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS
        ):
            word_matches = [
                region for region in regions
                if matches_spec(
                    region,
                    spec,
                    kind="word",
                    bounds=spec["bounds"],
                )
            ]
            self.assertEqual(1, len(word_matches), spec["id"])
            word = word_matches[0]
            word["confidence"] = 0.49 if index % 2 else 0.2
            if spec["text"] == "237'-2\"":
                word["text"] = "231'-2!'"

        roof_words = [
            region for region in regions
            if (
                region.get("source") == "fixed_visual_tile_coordinate_ocr"
                and region.get("ocrKind") == "word"
                and region.get("ocrPrefix")
                == "visual-tile-667:0:333:500-subtile-1:0"
                and region.get("text") == "ROOF"
                and all(
                    region.get(key) == value
                    for key, value in {
                        "x": 0.71127,
                        "y": 0.213333,
                        "width": 0.008889,
                        "height": 0.003333,
                    }.items()
                )
            )
        ]
        self.assertEqual(1, len(roof_words))
        roof_words[0]["text"] = "RROOF"

        words_by_line: dict[tuple[object, object, object, object], list[dict[str, object]]] = {}
        for region in regions:
            if region.get("ocrKind") != "word":
                continue
            key = (
                region.get("ocrPrefix"),
                region.get("ocrBlockNumber"),
                region.get("ocrParagraphNumber"),
                region.get("ocrLineNumber"),
            )
            words_by_line.setdefault(key, []).append(region)
        for line in regions:
            if line.get("ocrKind") != "line":
                continue
            key = (
                line.get("ocrPrefix"),
                line.get("ocrBlockNumber"),
                line.get("ocrParagraphNumber"),
                line.get("ocrLineNumber"),
            )
            words = sorted(
                words_by_line.get(key, []),
                key=lambda item: int(item["ocrOrder"]),
            )
            if len(words) < 2:
                continue
            line["text"] = " ".join(str(item.get("text") or "") for item in words)
            line["confidence"] = round(
                min(float(item.get("confidence") or 0) for item in words), 6
            )

        region_by_id = {
            str(region["id"]): region for region in regions
        }
        for proof in proofs:
            proof["analysisSha256"] = visual_tile_analysis_sha256(
                str(proof["tileKey"]),
                [region_by_id[str(value)] for value in proof["analysisRegionIds"]],
            )
            for subtile in proof["analysisSubtileProofs"]:
                subtile["analysisSha256"] = visual_subtile_analysis_sha256(
                    [
                        region_by_id[str(value)]
                        for value in subtile["analysisRegionIds"]
                    ]
                )

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

        candidates = dimension_candidates(replayed)
        northeast_spec = EXACT_ARCHITECTURAL_2321_PAGE30_DIMENSION_SPECS[5]
        northeast_audit = [
            {
                "text": region.get("text"),
                "kind": region.get("ocrKind"),
                "confidence": region.get("confidence"),
                "status": region.get("visualAuthorityStatus"),
                "source": region.get("source"),
            }
            for region in replayed["ocr"]["rejectedLowConfidenceRegions"]
            if all(
                region.get(key) == value
                for key, value in northeast_spec["bounds"].items()
            )
        ]
        self.assertEqual(
            14,
            len(candidates),
            {
                "candidates": [candidate["text"] for candidate in candidates],
                "northeastAudit": northeast_audit,
            },
        )
        self.assertEqual(
            [spec["text"] for spec in EXPECTED_SPECS],
            [candidate["text"] for candidate in candidates],
        )
        all_candidates = [
            candidate
            for exception in replayed["unresolved"]
            for candidate in exception.get("diagnosticCandidates") or []
        ]
        self.assertNotIn("231'-2!'", {candidate["text"] for candidate in all_candidates})

    def test_dual_provider_exact_dimensions_are_required_before_assurance(self) -> None:
        result = copy.deepcopy(self.result)
        exceptions = dimension_exceptions(result)
        self.assertEqual(13, len(exceptions))
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
            self.assertFalse(
                validated_visual_resolution(one_sided, exception).resolved
            )
            mixed = {
                **payload,
                "assuranceAcceptedCandidateIndexes": [],
                "assuranceDismissedCandidateIndexes": list(
                    range(len(exception["diagnosticCandidates"]))
                ),
            }
            self.assertFalse(
                validated_visual_resolution(mixed, exception).resolved
            )
            duplicate = {
                **payload,
                "primaryAcceptedCandidateIndexes": [0, 0],
                "primaryAcceptedCandidateIndexesValid": False,
            }
            self.assertFalse(
                validated_visual_resolution(duplicate, exception).resolved
            )

        expected_texts = [spec["text"] for spec in EXPECTED_SPECS]
        accepted = [
            region for region in result["final"]["regions"]
            if region.get("source") == "vision"
            and region.get("text") in set(expected_texts)
        ]
        self.assertEqual(14, len(accepted))
        self.assertEqual(expected_texts, [region["text"] for region in accepted])
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
