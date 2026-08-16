"""Opt-in exact-SHA regression for Architectural 2321 page 18."""

import hashlib
import os
import unittest
from pathlib import Path

import pymupdf

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.assurance import assure_page
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS,
    extract_page,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 18
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE18_PDF_TESTS") == "1"


EXPECTED_RAW_ARTIFACT_IDS = {
    "visual-tile-0:0:333:500-subtile-1:0-word-5",
    "visual-tile-0:0:333:500-subtile-1:0-line-0",
    "visual-tile-333:0:333:500-subtile-1:0-word-9",
    "visual-tile-333:0:333:500-subtile-1:0-line-1",
    "visual-tile-333:0:333:500-subtile-2:0-word-68",
    "visual-tile-333:500:333:500-subtile-1:0-word-41",
    "visual-tile-0:500:333:500-subtile-2:1-word-65",
    "visual-tile-333:500:333:500-subtile-1:1-word-46",
    "visual-tile-333:500:333:500-subtile-2:0-word-34",
    "visual-tile-333:500:333:500-subtile-2:0-line-6",
    "visual-tile-333:500:333:500-subtile-2:0-word-40",
}
EXPECTED_REJECTED_ARTIFACT_IDS = {
    "visual-tile-0:0:333:500-subtile-1:0-word-5",
    "visual-tile-0:0:333:500-subtile-1:0-line-0",
    "visual-tile-0:500:333:500-subtile-2:1-word-65",
    "visual-tile-333:500:333:500-subtile-1:1-word-46",
    "visual-tile-333:500:333:500-subtile-2:0-word-34",
    "visual-tile-333:500:333:500-subtile-2:0-word-40",
}
EXPECTED_ACCEPTED_THEN_QUARANTINED_IDS = {
    "visual-tile-333:0:333:500-subtile-1:0-word-9",
    "visual-tile-333:0:333:500-subtile-2:0-word-68",
    "visual-tile-333:500:333:500-subtile-1:0-word-41",
}
EXPECTED_TITLE_BLOCK_QUARANTINED_IDS = {
    "title-ocr-word-54",
}


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE18_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page18ProductionTests(unittest.TestCase):
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

    def test_title_identifiers_and_scale_values_are_audited_not_reviewed(self) -> None:
        self.assertEqual([], self.result["unresolved"])
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        final_regions = self.result["final"]["regions"]
        quarantined = {
            str(region["id"]): region
            for region in rejected
            if region.get("visualAuthorityStatus") in {
                "quarantined_scale_legend",
                "quarantined_exact_drawing_title_identifier",
            }
        }
        self.assertEqual(EXPECTED_REJECTED_ARTIFACT_IDS, set(quarantined))
        self.assertEqual(
            3,
            sum(
                region["visualAuthorityStatus"] == "quarantined_scale_legend"
                for region in quarantined.values()
            ),
        )
        self.assertEqual(
            3,
            sum(
                region["visualAuthorityStatus"]
                == "quarantined_exact_drawing_title_identifier"
                for region in quarantined.values()
            ),
        )
        self.assertTrue(all(region["searchable"] is False for region in quarantined.values()))

        final_by_id = {
            str(region["id"]): region for region in final_regions
            if str(region.get("id") or "")
        }
        self.assertTrue(
            EXPECTED_ACCEPTED_THEN_QUARANTINED_IDS.issubset(final_by_id)
        )
        self.assertTrue(all(
            final_by_id[region_id]["searchable"] is False
            for region_id in EXPECTED_ACCEPTED_THEN_QUARANTINED_IDS
        ))
        self.assertTrue(EXPECTED_TITLE_BLOCK_QUARANTINED_IDS.issubset(final_by_id))
        self.assertTrue(all(
            final_by_id[region_id]["searchable"] is False
            for region_id in EXPECTED_TITLE_BLOCK_QUARANTINED_IDS
        ))
        ocr_by_id = {
            str(region["id"]): region for region in self.result["ocr"]["regions"]
            if str(region.get("id") or "")
        }
        self.assertTrue(all(
            ocr_by_id[region_id]["searchable"] is False
            and ocr_by_id[region_id]["visualAuthorityStatus"]
            == "quarantined_exact_drawing_title_identifier"
            for region_id in EXPECTED_TITLE_BLOCK_QUARANTINED_IDS
        ))
        self.assertEqual(
            EXPECTED_TITLE_BLOCK_QUARANTINED_IDS,
            {
                str(spec["id"])
                for spec in EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS
            },
        )

        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        self.assertEqual(
            EXPECTED_RAW_ARTIFACT_IDS,
            {
                str(spec["id"])
                for spec in EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS
            },
        )
        self.assertTrue(EXPECTED_RAW_ARTIFACT_IDS.issubset(raw_by_id))
        self.assertFalse(any(
            region.get("searchable") is not False
            and str(region.get("id") or "") in EXPECTED_RAW_ARTIFACT_IDS
            for region in final_regions
        ))
        self.assertFalse(any(
            region.get("source") == "vision"
            and str(region.get("text") or "") == "'1'"
            for region in final_regions
        ))
        self.assertFalse(any(
            region.get("searchable") is not False
            and str(region.get("text") or "").strip() in {"1", "'1'"}
            for region in final_regions
        ))
        proof_searchable_ids = {
            str(region_id)
            for proof in self.result["final"]["visualCoverage"][
                "completedDeepReadRegionProofs"
            ]
            for region_id in proof.get("searchableRegionIds") or []
        }
        self.assertTrue(EXPECTED_RAW_ARTIFACT_IDS.isdisjoint(proof_searchable_ids))

    def test_checkpoint_replay_is_identical_and_does_not_requeue_artifacts(self) -> None:
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
        self.assertEqual([], replayed["unresolved"])
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        self.assertEqual(self.result["final"], replayed["final"])

    def test_assurance_accepts_fresh_page_without_provider_facts(self) -> None:
        assurance = assure_page(
            page_data=self.result["final"],
            expected_project_id=PROJECT_ID,
            expected_page_number=PAGE_NUMBER,
            expected_source_sha256=SOURCE_SHA256,
            expected_evidence_version=EVIDENCE_VERSION,
            unresolved_region_count=0,
        )
        self.assertTrue(assurance["accepted"], assurance)
        self.assertEqual([], assurance["failureCodes"])


if __name__ == "__main__":
    unittest.main()
