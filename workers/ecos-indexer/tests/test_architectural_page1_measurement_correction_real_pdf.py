"""Opt-in exact-SHA regressions for the two Architectural page-1 OCR cases."""

import hashlib
import math
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import extract_page, open_pdf
from ecos_indexer.visual import (
    VISUAL_SCHEMA_VERSION,
    validated_visual_resolution,
    visual_exception_fingerprint,
)


RUN_EXACT = (
    os.getenv("ECOS_RUN_ARCHITECTURAL_MEASUREMENT_CORRECTION_PDF_TESTS") == "1"
)
CORRECTION_SOURCE = "fixed_visual_tile_measurement_transcription_correction"
CASES = {
    "2321": {
        "path": os.getenv("ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""),
        "sha": "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb",
        "project": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
        "raw": "24'-D\" TO 21'-O\" MAX.",
        "corrected": "24'-0\" TO 27'-0\" MAX",
        "bounds": {
            "x": 0.626365, "y": 0.312389,
            "width": 0.041873, "height": 0.004111,
        },
    },
    "2375": {
        "path": os.getenv("ECOS_ARCHITECTURAL_2375_REGRESSION_PDF", ""),
        "sha": "75118aa5adf2696692db1413898f505bcda27128fe96977e68f217bd88e9e41e",
        "project": "72e941d8-8114-4082-a976-ae5b2b5daba9",
        "raw": "2'-o\"",
        "corrected": None,
        "bounds": {
            "x": 0.623524, "y": 0.345944,
            "width": 0.020571, "height": 0.004333,
        },
    },
}


def exact_sources_available() -> bool:
    return all(
        value["path"] and Path(value["path"]).is_file()
        for value in CASES.values()
    )


def target_exception(result: dict, raw_text: str) -> dict:
    matches = [
        item
        for item in result["unresolved"]
        if item["regionKey"].startswith("low-confidence-ocr-")
        and len(item.get("diagnosticCandidates") or []) == 1
        and item["diagnosticCandidates"][0].get("text") == raw_text
        and item["diagnosticCandidates"][0].get("source") == CORRECTION_SOURCE
    ]
    if len(matches) != 1:
        raise AssertionError(
            f"Exact Architectural correction authority changed for {raw_text!r}: "
            f"matches={len(matches)}"
        )
    return matches[0]


def canonical_candidate_bounds(exception: dict) -> dict[str, int]:
    bounds = exception["diagnosticCandidates"][0]["bounds"]
    left = math.ceil(bounds["x"] * 1000)
    top = math.ceil(bounds["y"] * 1000)
    right = math.floor((bounds["x"] + bounds["width"]) * 1000)
    bottom = math.floor((bounds["y"] + bounds["height"]) * 1000)
    if right <= left or bottom <= top:
        raise AssertionError("Exact correction authority collapsed after canonicalization")
    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }


def provider_payload(exception: dict, corrected: str) -> dict:
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "gemini",
        "model": "gemini-correction-test",
        "assuranceProvider": "openai",
        "assuranceModel": "openai-correction-test",
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
            "subject": "",
            "location": "",
            "statement": corrected,
            "evidenceText": corrected,
            "confidence": 0.97,
            "bounds": canonical_candidate_bounds(exception),
        }],
    }


@unittest.skipUnless(
    RUN_EXACT and exact_sources_available(),
    "Set the exact Architectural 2321/2375 PDF paths and opt-in flag.",
)
class ExactArchitecturalPage1MeasurementCorrectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = {}
        for name, value in CASES.items():
            source = Path(value["path"]).read_bytes()
            if hashlib.sha256(source).hexdigest() != value["sha"]:
                raise AssertionError(f"Issued Architectural {name} source SHA changed")
            document = open_pdf(source)
            try:
                cls.results[name] = extract_page(
                    document[0],
                    value["sha"],
                    project_id=value["project"],
                    document_sheet_identity=document_sheet_identity_map(document).get(1),
                )
            finally:
                document.close()

    def test_corrupted_measurements_never_enter_search_before_resolution(self) -> None:
        forbidden = ("24'-D", "21'-O", "15'-o", "5'-o", "2'-o")
        for name, result in self.results.items():
            with self.subTest(name=name):
                searchable = [
                    str(region.get("text") or "")
                    for region in result["final"]["regions"]
                    if region.get("searchable") is True
                ]
                self.assertFalse(any(
                    token in text for token in forbidden for text in searchable
                ))

    def test_exact_correction_authorities_are_single_and_stable(self) -> None:
        for name, value in CASES.items():
            with self.subTest(name=name):
                exception = target_exception(self.results[name], value["raw"])
                candidate = exception["diagnosticCandidates"][0]
                self.assertEqual(CORRECTION_SOURCE, candidate["source"])
                self.assertEqual(1, exception["diagnosticCandidateCount"])
                self.assertEqual(value["bounds"], candidate["bounds"])
                self.assertEqual(64, len(visual_exception_fingerprint(exception)))

    def test_page_remains_fail_closed_without_provider_resolution(self) -> None:
        for name, value in CASES.items():
            result = self.results[name]
            assurance = assure_page(
                page_data=result["final"],
                expected_project_id=value["project"],
                expected_page_number=1,
                expected_source_sha256=value["sha"],
                expected_evidence_version=EVIDENCE_VERSION,
                unresolved_region_count=len(result["unresolved"]),
            )
            with self.subTest(name=name):
                self.assertFalse(assurance["accepted"])
                self.assertIn("unresolved_regions", assurance["failureCodes"])

    def test_dual_provider_exact_transcription_resolves_but_wrong_digit_does_not(self) -> None:
        for name, value in CASES.items():
            if value["corrected"] is None:
                continue
            exception = target_exception(self.results[name], value["raw"])
            accepted = validated_visual_resolution(
                provider_payload(exception, value["corrected"]),
                exception,
            )
            with self.subTest(name=name):
                self.assertTrue(accepted.resolved)
                self.assertEqual(
                    value["corrected"],
                    accepted.evidence["facts"][0]["statement"],
                )
                self.assertEqual(
                    value["raw"],
                    accepted.evidence["facts"][0]["rawOcrCandidateText"],
                )

        exception = target_exception(self.results["2321"], CASES["2321"]["raw"])
        wrong = provider_payload(exception, "24'-0\" TO 37'-0\" MAX")
        self.assertFalse(validated_visual_resolution(wrong, exception).resolved)


if __name__ == "__main__":
    unittest.main()
