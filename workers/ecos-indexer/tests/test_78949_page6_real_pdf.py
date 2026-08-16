"""Opt-in exact-SHA regression for hosted job 78949 page 6."""

import copy
import hashlib
import os
import unittest
from pathlib import Path

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import document_sheet_identity_map
from ecos_indexer.extraction import (
    extract_page,
    open_pdf,
    resumed_visual_tile_work,
    visual_subtile_analysis_sha256,
    visual_tile_analysis_sha256,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import visual_review_bounds

SOURCE_PATH = Path(os.getenv(
    "ECOS_78949_REGRESSION_PDF",
    str(Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved/2321 approved/HPSDrawing-PLZCorp-R1.pdf"),
))
SOURCE_SHA256 = "e358e80453258b8ab27dfcae9045108fd0c2d86db3dbd8766ede2d9709e97665"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 6
RUN_EXACT = os.getenv("ECOS_RUN_78949_PAGE6_PDF_TESTS") == "1"


@unittest.skipUnless(RUN_EXACT and SOURCE_PATH.exists(), "Set ECOS_RUN_78949_PAGE6_PDF_TESTS=1 with the exact HPS source.")
class Exact78949Page6ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = SOURCE_PATH.read_bytes()
        if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
            raise AssertionError("Issued HPS source SHA changed")
        document = open_pdf(payload)
        try:
            cls.result = extract_page(
                document[PAGE_NUMBER - 1], SOURCE_SHA256, project_id=PROJECT_ID,
                document_sheet_identity=document_sheet_identity_map(document).get(PAGE_NUMBER),
            )
        finally:
            document.close()

    def test_boundary_lines_remain_diagnostic_but_cannot_be_candidates(self) -> None:
        raw = self.result["ocr"]["visualTileRegions"]
        fragments = (
            "USE OF 8'-O\" HIGH FENCING. SEE INCLUD",
            "NEW 8'-0\" HIGH STEEL SITE SECURIT",
        )
        for fragment in fragments:
            matched = [region for region in raw if region.get("text") == fragment]
            self.assertTrue(matched, fragment)
            self.assertTrue(all(region.get("ocrBoundaryTruncatedEdges") == ["right"] for region in matched))
        candidate_texts = [
            candidate["text"]
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        ]
        visual_exceptions = [
            item for item in self.result["unresolved"]
            if item["regionKey"].startswith("low-confidence-ocr-")
        ]
        # The fifth exception is the issued page's high-confidence but still
        # alphabetically corrupted ``30'-o\"`` OCR.  Confidence must never
        # turn that letter-for-digit reading into searchable evidence.
        self.assertEqual(5, len(visual_exceptions))
        self.assertTrue(all(
            item["diagnosticCandidateCount"] == 1
            for item in visual_exceptions
        ))
        self.assertNotIn(fragments[0], candidate_texts)
        self.assertNotIn(fragments[1], candidate_texts)
        self.assertIn("8'-O\"", candidate_texts)
        self.assertIn("8'-0\"", candidate_texts)
        self.assertIn("30'-o\"", candidate_texts)
        self.assertFalse(any(
            "30'-o\"" in str(region.get("text") or "")
            for region in self.result["final"]["regions"]
            if region.get("searchable") is True
        ))
        candidate_authorities: set[tuple[str, float, float, float, float]] = set()
        for item in self.result["unresolved"]:
            candidates = item.get("diagnosticCandidates") or []
            for left_index, left in enumerate(candidates):
                for right in candidates[left_index + 1:]:
                    left_text = left["text"].upper()
                    right_text = right["text"].upper()
                    self.assertFalse(
                        left_text in right_text or right_text in left_text,
                        f"Ambiguous nested candidate authority: {left_text!r}, {right_text!r}",
                    )
            for candidate in candidates:
                bounds = candidate["bounds"]
                authority = (
                    candidate["text"], bounds["x"], bounds["y"],
                    bounds["width"], bounds["height"],
                )
                self.assertNotIn(authority, candidate_authorities)
                candidate_authorities.add(authority)
        final_ids = {str(region.get("id") or "") for region in self.result["final"]["regions"]}
        clipped_words = [
            region for region in raw
            if str(region.get("text") or "").strip().upper() in {"INCLUD", "SECURIT", "AL", "ANCE"}
            and region.get("ocrBoundaryTruncated") is True
        ]
        self.assertTrue(clipped_words)
        self.assertTrue(all(region["id"] not in final_ids for region in clipped_words))
        for unique_clipped_token in ("INCLUD", "SECURIT"):
            self.assertNotIn(unique_clipped_token, self.result["final"]["text"].split())

        exact_measurements = sorted(
            (
                candidate for item in visual_exceptions
                for candidate in item["diagnosticCandidates"]
                if candidate["text"] == "8'-0\""
            ),
            key=lambda candidate: candidate["bounds"]["y"],
        )
        self.assertTrue(exact_measurements)
        for measurement in exact_measurements:
            review = visual_review_bounds(
                measurement["bounds"], [measurement],
            )
            self.assertEqual(0.1, review["width"])
            self.assertEqual(0.014, review["height"])
            self.assertLessEqual(
                measurement["bounds"]["x"] - review["x"], 0.02,
            )
            self.assertGreater(
                review["x"] + review["width"]
                - (measurement["bounds"]["x"] + measurement["bounds"]["width"]),
                0.07,
            )

    def test_checkpoint_replay_rederives_boundary_authority_even_after_rehash(self) -> None:
        regions = self.result["ocr"]["visualTileRegions"]
        proofs = self.result["ocr"]["visualTileProofs"]
        checkpoint = visual_tile_checkpoint_payload(
            page_number=PAGE_NUMBER, source_sha256=SOURCE_SHA256,
            evidence_version=EVIDENCE_VERSION, regions=regions, proofs=proofs,
        )
        accepted_regions, accepted = resumed_visual_tile_work(
            checkpoint, expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256, expected_evidence_version=EVIDENCE_VERSION,
        )
        self.assertEqual(6, len(accepted))
        self.assertEqual(regions, accepted_regions)
        self.assertEqual(proofs, accepted)

        tampered = copy.deepcopy(checkpoint)
        target = next(region for region in tampered["regions"] if region.get("text") == "USE OF 8'-O\" HIGH FENCING. SEE INCLUD")
        target.update({"ocrBoundaryTruncated": False, "ocrBoundaryTruncatedEdges": []})
        proof = next(item for item in tampered["completedDeepReadRegionProofs"] if target["id"] in item["analysisRegionIds"])
        region_by_id = {region["id"]: region for region in tampered["regions"]}
        subtile = next(item for item in proof["analysisSubtileProofs"] if target["id"] in item["analysisRegionIds"])
        subtile["analysisSha256"] = visual_subtile_analysis_sha256([region_by_id[item] for item in subtile["analysisRegionIds"]])
        proof["analysisSha256"] = visual_tile_analysis_sha256(proof["tileKey"], [region_by_id[item] for item in proof["analysisRegionIds"]])
        _, accepted_after_tamper = resumed_visual_tile_work(
            tampered, expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256, expected_evidence_version=EVIDENCE_VERSION,
        )
        self.assertEqual(5, len(accepted_after_tamper))
        self.assertNotIn(proof["tileKey"], {item["tileKey"] for item in accepted_after_tamper})


if __name__ == "__main__":
    unittest.main()
