"""Opt-in exact-SHA regression for Architectural 2321 page 13."""

import hashlib
import math
import os
import unittest
from pathlib import Path

import pymupdf

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES,
    EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE,
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
PAGE_NUMBER = 13
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE13_PDF_TESTS") == "1"


def detail_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    matches = [
        item
        for item in result["unresolved"]
        if len(item.get("diagnosticCandidates") or []) == 1
        and item["diagnosticCandidates"][0].get("source")
        == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
    ]
    return sorted(matches, key=lambda item: (
        float(item["bounds"]["y"]), float(item["bounds"]["x"])
    ))


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE13_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page13ProductionTests(unittest.TestCase):
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

    def test_complete_detail_authorities_replace_only_malformed_fragments(self) -> None:
        expected = {
            str(spec["text"]): spec
            for spec in EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES
        }
        exceptions = detail_exceptions(self.result)
        self.assertEqual(4, len(exceptions))
        self.assertEqual(
            set(expected),
            {
                str(item["diagnosticCandidates"][0]["text"])
                for item in exceptions
            },
        )
        self.assertTrue(all(
            len(item.get("diagnosticCandidates") or []) == 1
            for item in exceptions
        ))

        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composites = [
            region for region in rejected
            if region.get("source") == EXACT_ARCHITECTURAL_2321_SITE_NOTE_SOURCE
        ]
        self.assertEqual(4, len(composites))
        for composite in composites:
            spec = expected[str(composite["text"])]
            self.assertEqual(spec["id"], composite["id"])
            self.assertEqual(spec["bounds"], {
                key: composite[key] for key in ("x", "y", "width", "height")
            })
            self.assertFalse(composite["searchable"])
            self.assertEqual(
                6.0,
                visual_review_tile_scale([{
                    "text": composite["text"],
                    "source": composite["source"],
                    "bounds": spec["bounds"],
                }]),
            )

        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_site_note_composite"
        ]
        self.assertGreaterEqual(len(superseded), 11)
        superseded_by_id = {
            str(region.get("id") or ""): region for region in superseded
        }
        for region_id in (
            "visual-tile-667:500:333:500-subtile-1:0-word-18",
            "visual-tile-667:500:333:500-subtile-0:0-line-37",
            "title-ocr-line-2",
        ):
            self.assertIn(region_id, superseded_by_id)
            self.assertFalse(superseded_by_id[region_id]["searchable"])
        for region in superseded:
            raw = raw_by_id.get(str(region["id"]))
            if raw is None:
                continue
            self.assertEqual(region["text"], raw["text"])
            self.assertNotIn("visualAuthorityStatus", raw)
            self.assertFalse(region["searchable"])

        dimension_exceptions = [
            item for item in exceptions
            if item["diagnosticCandidates"][0]["text"]
            in {"5'-0\"", "3'-4\""}
        ]
        self.assertEqual(2, len(dimension_exceptions))
        self.assertNotEqual(
            dimension_exceptions[0]["bounds"],
            dimension_exceptions[1]["bounds"],
        )
        self.assertFalse(any(
            region.get("source") == "vision"
            and str(region.get("text") or "") in expected
            for region in self.result["final"]["regions"]
        ))
        malformed_ids = set(
            EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES[3]["replacementIds"]
        )
        self.assertFalse(any(
            str(region.get("id") or "") in malformed_ids
            for region in self.result["final"]["regions"]
        ))

    def test_checkpoint_replay_preserves_detail_authorities_and_fingerprints(self) -> None:
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
        original = detail_exceptions(self.result)
        replay = detail_exceptions(replayed)
        self.assertEqual(original, replay)
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in original],
            [visual_exception_fingerprint(item) for item in replay],
        )
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )

        stale = {
            **original[0],
            "diagnosticCandidates": [{
                "text": "13'-I\" TOS",
                "source": "fixed_visual_tile_coordinate_ocr",
                "confidence": 0.0,
                "bounds": dict(original[0]["bounds"]),
            }],
        }
        self.assertNotEqual(
            visual_exception_fingerprint(original[0]),
            visual_exception_fingerprint(stale),
        )

    def test_dual_provider_exact_detail_facts_are_required_before_publication(self) -> None:
        appended: list[dict[str, object]] = []
        for exception in detail_exceptions(self.result):
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
            result = {"final": {"regions": []}}
            append_visual_evidence(result, exception, resolution.evidence)
            self.assertEqual(1, len(result["final"]["regions"]))
            self.assertEqual(text, result["final"]["regions"][0]["text"])
            self.assertTrue(result["final"]["regions"][0]["searchable"])
            appended.extend(result["final"]["regions"])

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
            partial = {
                **payload,
                "facts": [{
                    **payload["facts"][0],
                    "subject": "10'-0\"",
                    "statement": "10'-0\"",
                    "evidenceText": "10'-0\"",
                }],
            }
            self.assertFalse(validated_visual_resolution(partial, exception).resolved)

        self.assertEqual(
            {str(spec["text"]) for spec in EXACT_ARCHITECTURAL_2321_DETAIL_CANDIDATES},
            {str(region["text"]) for region in appended},
        )


if __name__ == "__main__":
    unittest.main()
