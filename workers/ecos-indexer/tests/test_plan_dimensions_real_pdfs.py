"""Real detection test, NOT a substitute for protected reads/user acceptance."""
import hashlib
import os
from pathlib import Path
import unittest
import pymupdf as fitz
from ecos_indexer.extraction import extract_page
from ecos_indexer.plan_dimensions import derive_verified_plan_dimensions


@unittest.skipUnless(os.getenv("ECOS_REAL_DRAWING_ROOT"), "Private drawing source directory required")
class RealPlanDetectionTests(unittest.TestCase):
    def test_distinct_source_plans_are_detected_but_not_claimed_verified(self):
        sources = {
            "A": "3449c10a40a0524b0409c42a256d3ee8e5455718946896c2c80d113da16e34df",
            "B": "3da35b7fba15a676d8e40d8682920d4b7fcdf008d95996bfa311f1012b499b44",
            "C": "7a9624a8466d733f3b1f66f2c44224989d3141749a715f298332da7be7939c7a",
        }
        contexts = set()
        for label, sha in sources.items():
            with self.subTest(label=label):
                path = Path(os.environ["ECOS_REAL_DRAWING_ROOT"]) / f"08{label} - PLZ CORP - 2375 THIRD STREET - CANOPY '{label}'.pdf"
                with path.open("rb") as stream:
                    self.assertEqual(hashlib.file_digest(stream,"sha256").hexdigest(), sha)
                with fitz.open(path) as doc:
                    result = extract_page(doc[3], sha, project_id="real-source-test")
                analysis = result["final"]["planDimensionAnalysis"]
                self.assertIsNotNone(analysis)
                self.assertEqual(analysis["context"]["sourceSha256"], sha)
                self.assertEqual(analysis["context"]["pageNumber"], 4)
                self.assertEqual(len(analysis["targets"]), 2)
                self.assertTrue(all(len(t["diagnosticCandidates"]) == 1 for t in analysis["targets"]))
                self.assertTrue(all(t in result["unresolved"] for t in analysis["targets"]))
                contexts.add(analysis["contextHash"])
                regions, failures = derive_verified_plan_dimensions(analysis, project_id="real-source-test",
                    source_sha256=sha, page_number=4, evidence_version="ecos-hosted-evidence/1.3")
                self.assertEqual(regions, [])
                self.assertEqual(failures, ["plan_dimension_reads_incomplete"])
        self.assertEqual(len(contexts), 3)
