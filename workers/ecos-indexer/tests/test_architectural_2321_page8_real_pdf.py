"""Opt-in exact-SHA regression for Architectural 2321 page 8."""

import hashlib
import io
import math
import os
import unittest
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image

from ecos_indexer import EVIDENCE_VERSION
from ecos_indexer.document_structure import bookmark_sheet_identity_map
from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS,
    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS,
    EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS,
    extract_page,
    resumed_visual_tile_work,
    visual_tile_checkpoint_payload,
)
from ecos_indexer.visual import (
    EXACT_FIRE_SEPARATION_NORTH_OPENINGS_DETAIL_SPECS,
    VISUAL_SCHEMA_VERSION,
    crop_page,
    suppress_exact_area_row_crossing_rule,
    validated_visual_resolution,
    visual_exception_fingerprint,
    visual_review_bounds,
    visual_review_tile_scale,
)
from ecos_indexer.worker import append_visual_evidence


SOURCE_PATH_VALUE = os.getenv(
    "ECOS_ARCHITECTURAL_2321_REGRESSION_PDF", ""
).strip()
SOURCE_PATH = Path(SOURCE_PATH_VALUE) if SOURCE_PATH_VALUE else None
SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"
PAGE_NUMBER = 8
RUN_EXACT = os.getenv("ECOS_RUN_ARCHITECTURAL_2321_PAGE8_PDF_TESTS") == "1"
FIRE_CANONICAL_TEXTS = {
    str(spec["canonicalText"])
    for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
}
AREA_CANONICAL_TEXTS = {
    str(spec["canonicalText"])
    for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS
}
CANONICAL_TEXTS = FIRE_CANONICAL_TEXTS | AREA_CANONICAL_TEXTS


def target_candidates(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        candidate
        for item in result["unresolved"]
        if str(item.get("regionKey") or "").startswith("low-confidence-ocr-")
        for candidate in item.get("diagnosticCandidates") or []
        if str(candidate.get("text") or "") in CANONICAL_TEXTS
    ]


def target_exceptions(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        item
        for item in result["unresolved"]
        if any(
            str(candidate.get("text") or "") in CANONICAL_TEXTS
            for candidate in item.get("diagnosticCandidates") or []
        )
    ]


@unittest.skipUnless(
    RUN_EXACT and SOURCE_PATH is not None and SOURCE_PATH.is_file(),
    "Set ECOS_RUN_ARCHITECTURAL_2321_PAGE8_PDF_TESTS=1 with the exact source.",
)
class ExactArchitectural2321Page8ProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SOURCE_PATH.open("rb") as source_handle:
            actual_sha = hashlib.file_digest(source_handle, "sha256").hexdigest()
        if actual_sha != SOURCE_SHA256:
            raise AssertionError(
                f"Issued Architectural 2321 source SHA changed: {actual_sha}"
            )
        # This issued set is 111 MB. Opening the exact file through PyMuPDF's
        # path-backed reader avoids keeping a second full in-memory PDF copy
        # while exercising the same page extraction and OCR production path.
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            # This regression exercises page-8 extraction authority. The exact
            # page-bound bookmark is sufficient input here; a separate suite
            # covers the full-document structural scanner across all 46 pages.
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

    def test_complete_fire_separation_candidates_replace_only_raw_fragments(self) -> None:
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composites = [
            region for region in rejected
            if region.get("source")
            == "exact_rendered_fire_separation_composite_candidate"
        ]
        self.assertEqual(3, len(composites))
        self.assertEqual(FIRE_CANONICAL_TEXTS, {item["text"] for item in composites})
        self.assertTrue(all(item["searchable"] is False for item in composites))

        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_fire_separation_composite"
        ]
        self.assertEqual(8, len(superseded))
        self.assertEqual(
            {
                str(spec["lineId"])
                for spec in EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SPECS
            },
            {
                str(region["id"])
                for region in superseded
                if region.get("ocrKind") == "line"
            },
        )
        self.assertEqual(4, len([
            region for region in superseded if region.get("ocrKind") == "word"
        ]))

        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        for region in superseded:
            raw = raw_by_id[str(region["id"])]
            self.assertNotIn("visualAuthorityStatus", raw)
            self.assertEqual(region["text"], raw["text"])
            self.assertEqual(
                {key: region[key] for key in ("x", "y", "width", "height")},
                {key: raw[key] for key in ("x", "y", "width", "height")},
            )

    def test_complete_area_row_candidates_replace_only_isolated_measurements(self) -> None:
        rejected = self.result["ocr"]["rejectedLowConfidenceRegions"]
        composites = [
            region for region in rejected
            if region.get("source")
            == "exact_rendered_area_table_row_composite_candidate"
        ]
        self.assertEqual(3, len(composites))
        self.assertEqual(AREA_CANONICAL_TEXTS, {item["text"] for item in composites})
        self.assertTrue(all(item["searchable"] is False for item in composites))
        self.assertNotIn("EAST- 30'", AREA_CANONICAL_TEXTS)
        self.assertNotIn("SOUTH- 30'", AREA_CANONICAL_TEXTS)
        self.assertNotIn("TOTAL FRONTAGE LENGTH: 30'", AREA_CANONICAL_TEXTS)
        for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS:
            candidate = next(
                region for region in composites
                if region["text"] == spec["canonicalText"]
            )
            self.assertEqual(spec["bounds"], {
                key: candidate[key] for key in ("x", "y", "width", "height")
            })

        east = next(
            candidate for candidate in composites
            if candidate["text"] == "EAST- 30' / 185'-1\""
        )
        south = next(
            candidate for candidate in composites
            if candidate["text"] == "SOUTH- 30' / 0'-0\""
        )
        total = next(
            candidate for candidate in composites
            if candidate["text"]
            == "TOTAL FRONTAGE LENGTH: 30' / 586'-1\""
        )
        east_diagnostic = {
            "text": east["text"], "source": east["source"],
            "bounds": {key: east[key] for key in ("x", "y", "width", "height")},
        }
        south_diagnostic = {
            "text": south["text"], "source": south["source"],
            "bounds": {key: south[key] for key in ("x", "y", "width", "height")},
        }
        total_diagnostic = {
            "text": total["text"], "source": total["source"],
            "bounds": {key: total[key] for key in ("x", "y", "width", "height")},
        }
        east_review = visual_review_bounds(east_diagnostic["bounds"], [east_diagnostic])
        south_review = visual_review_bounds(
            south_diagnostic["bounds"], [south_diagnostic],
        )
        self.assertEqual(6.0, visual_review_tile_scale([east_diagnostic]))
        self.assertEqual(6.0, visual_review_tile_scale([south_diagnostic]))
        self.assertEqual(6.0, visual_review_tile_scale([total_diagnostic]))
        self.assertEqual(
            {"x": 0.617, "y": 0.171, "width": 0.058, "height": 0.034},
            east_review,
        )
        self.assertEqual(east_review, south_review)
        self.assertEqual(
            {"x": 0.558, "y": 0.171, "width": 0.118, "height": 0.036},
            visual_review_bounds(total_diagnostic["bounds"], [total_diagnostic]),
        )

        superseded = [
            region for region in rejected
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_area_table_row_composite"
        ]
        self.assertEqual(3, len(superseded))
        self.assertEqual({"30'"}, {str(region["text"]) for region in superseded})
        self.assertEqual(
            {
                tuple(spec["measurementBounds"][key]
                      for key in ("x", "y", "width", "height"))
                for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS
            },
            {
                tuple(region[key] for key in ("x", "y", "width", "height"))
                for region in superseded
            },
        )

        raw_by_id = {
            str(region["id"]): region
            for region in self.result["ocr"]["visualTileRegions"]
        }
        for region in superseded:
            raw = raw_by_id[str(region["id"])]
            self.assertNotIn("visualAuthorityStatus", raw)
            self.assertEqual(region["text"], raw["text"])
            self.assertEqual(
                {key: region[key] for key in ("x", "y", "width", "height")},
                {key: raw[key] for key in ("x", "y", "width", "height")},
            )

    def test_east_row_readability_view_suppresses_only_exact_vertical_rules(self) -> None:
        east = next(
            region
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("source")
            == "exact_rendered_area_table_row_composite_candidate"
            and region.get("text") == "EAST- 30' / 185'-1\""
        )
        bounds = {
            key: east[key] for key in ("x", "y", "width", "height")
        }
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            raw_payload = crop_page(
                document[PAGE_NUMBER - 1], bounds, scale=18.0,
            )
        finally:
            document.close()
        cleaned_payload = suppress_exact_area_row_crossing_rule(raw_payload)
        with Image.open(io.BytesIO(raw_payload)) as source_image:
            raw = source_image.convert("RGB")
            raw.load()
        with Image.open(io.BytesIO(cleaned_payload)) as cleaned_image:
            cleaned = cleaned_image.convert("RGB")
            cleaned.load()

        self.assertEqual((2271, 139), raw.size)
        self.assertEqual(raw.size, cleaned.size)
        changed_columns = [
            x for x in range(raw.width)
            if any(
                raw.getpixel((x, y)) != cleaned.getpixel((x, y))
                for y in range(raw.height)
            )
        ]
        self.assertEqual(
            list(range(1843, 1861)),
            changed_columns,
        )
        minimum_dark_rows = math.ceil(raw.height * 0.78)
        for x in changed_columns:
            self.assertGreaterEqual(
                sum(
                    1 for y in range(raw.height)
                    if max(raw.getpixel((x, y))) < 100
                ),
                minimum_dark_rows,
            )
            self.assertTrue(all(
                cleaned.getpixel((x, y)) == (255, 255, 255)
                for y in range(cleaned.height)
            ))
        unchanged_columns = set(range(raw.width)) - set(changed_columns)
        self.assertTrue(all(
            raw.getpixel((x, y)) == cleaned.getpixel((x, y))
            for x in unchanged_columns for y in range(raw.height)
        ))

    def test_fire_separation_detail_is_unmodified_dense_exact_bounds(self) -> None:
        text = (
            "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, OPENINGS NOT "
            "LIMITED, NO OPENING PROTECTION REQUIRED."
        )
        candidate = next(
            region
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("source")
            == "exact_rendered_fire_separation_composite_candidate"
            and region.get("text") == text
        )
        bounds = {
            key: candidate[key] for key in ("x", "y", "width", "height")
        }
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            detail_payload = crop_page(
                document[PAGE_NUMBER - 1], bounds, scale=6.0,
            )
        finally:
            document.close()
        with Image.open(io.BytesIO(detail_payload)) as detail_image:
            detail = detail_image.convert("RGB")
            detail.load()

        self.assertEqual((1550, 174), detail.size)
        self.assertGreater(sum(
            1 for pixel in detail.getdata() if min(pixel) < 160
        ), 1000)

    def test_south_fire_separation_note_has_one_complete_readability_view(self) -> None:
        text = (
            "WALLS AND TABLE 705.5 FIRE SEPARATION DISTANCE GREATER THEN "
            "30'-0\" NO RATING REQUIRED. NO OPENINGS WITH LESS THEN 30'-0\" "
            "FIRE SEPARATION, OPENINGS NOT LIMITED, NO OPENING PROTECTION "
            "REQUIRED."
        )
        candidate = next(
            region
            for region in self.result["ocr"]["rejectedLowConfidenceRegions"]
            if region.get("source")
            == "exact_rendered_fire_separation_composite_candidate"
            and region.get("text") == text
        )
        bounds = {
            key: candidate[key] for key in ("x", "y", "width", "height")
        }
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            detail_payload = crop_page(
                document[PAGE_NUMBER - 1], bounds, scale=6.0,
            )
        finally:
            document.close()
        with Image.open(io.BytesIO(detail_payload)) as detail_image:
            detail_image.load()
            detail_text = pytesseract.image_to_string(
                detail_image, config="--psm 6",
            ).strip()
            self.assertEqual((1778, 240), detail_image.size)

        self.assertIn("WALLS AND TABLE", detail_text)
        self.assertIn(
            "GREATER THEN 30'-0\" NO RATING REQUIRED. NO OPENINGS",
            detail_text,
        )
        self.assertIn(
            "WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT",
            detail_text,
        )
        self.assertIn("LIMITED, NO OPENING PROTECTION REQUIRED.", detail_text)

    def test_repeated_north_sentence_has_three_legible_direct_detail_crops(
        self,
    ) -> None:
        document = pymupdf.open(str(SOURCE_PATH))
        try:
            detail_texts = []
            detail_sizes = []
            for bounds, scale in (
                EXACT_FIRE_SEPARATION_NORTH_OPENINGS_DETAIL_SPECS
            ):
                payload = crop_page(
                    document[PAGE_NUMBER - 1], bounds, scale=scale,
                )
                with Image.open(io.BytesIO(payload)) as detail_image:
                    detail_image.load()
                    detail_sizes.append(detail_image.size)
                    detail_texts.append(
                        pytesseract.image_to_string(
                            detail_image, config="--psm 6",
                        ).strip()
                    )
        finally:
            document.close()

        self.assertEqual([(3100, 111), (2967, 105), (606, 105)], detail_sizes)
        self.assertIn(
            "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION",
            detail_texts[0],
        )
        self.assertIn("OPENINGS NOT LIMITED", detail_texts[1])
        self.assertIn("NO OPENING PROTECTION", detail_texts[1])
        self.assertEqual("REQUIRED", detail_texts[2].rstrip("."))

    def test_pre_provider_state_queues_complete_statements_and_publishes_none(self) -> None:
        candidates = target_candidates(self.result)
        self.assertEqual(6, len(candidates))
        self.assertEqual(CANONICAL_TEXTS, {item["text"] for item in candidates})
        self.assertEqual(6, len(target_exceptions(self.result)))
        self.assertTrue(all(
            len(item["diagnosticCandidates"]) == 1
            for item in target_exceptions(self.result)
        ))

        candidate_texts = {
            str(candidate.get("text") or "")
            for item in self.result["unresolved"]
            for candidate in item.get("diagnosticCandidates") or []
        }
        self.assertNotIn("29'-I0\"", candidate_texts)
        self.assertNotIn("2'-O\"", candidate_texts)
        self.assertNotIn("32'-@\"", candidate_texts)
        self.assertNotIn("130'-0\"", candidate_texts)
        self.assertNotIn("30'", candidate_texts)
        self.assertNotIn("EAST- 30'", candidate_texts)
        self.assertNotIn("SOUTH- 30'", candidate_texts)
        self.assertNotIn("TOTAL FRONTAGE LENGTH: 30'", candidate_texts)
        self.assertNotIn(
            "FIRE SEPARATION DISTANCE GREATER THEN 30'-0\" NO RATING REQUIRED.",
            candidate_texts,
        )
        self.assertNotIn(
            "NO OPENINGS WITH LESS THEN 30'-0\" FIRE SEPARATION, OPENINGS NOT "
            "LIMITED, NO OPENING PROTECTION REQUIRED.",
            candidate_texts,
        )
        self.assertIn(
            "WALLS AND TABLE 705.5 FIRE SEPARATION DISTANCE GREATER THEN "
            "30'-0\" NO RATING REQUIRED. NO OPENINGS WITH LESS THEN 30'-0\" "
            "FIRE SEPARATION, OPENINGS NOT LIMITED, NO OPENING PROTECTION "
            "REQUIRED.",
            candidate_texts,
        )

        searchable = [
            region for region in self.result["final"]["regions"]
            if region.get("searchable") is True
        ]
        target_authorities = {
            (
                str(spec["canonicalText"]),
                tuple(spec["bounds"][key]
                      for key in ("x", "y", "width", "height")),
            )
            for spec in
            EXACT_ARCHITECTURAL_2321_FIRE_SEPARATION_SENTENCE_SPECS
        } | {
            (
                str(spec["canonicalText"]),
                tuple(spec["bounds"][key]
                      for key in ("x", "y", "width", "height")),
            )
            for spec in EXACT_ARCHITECTURAL_2321_AREA_ROW_SPECS
        }
        prepublished = [
            region for region in searchable
            if (
                str(region.get("text") or ""),
                tuple(region.get(key) for key in ("x", "y", "width", "height")),
            ) in target_authorities
        ]
        self.assertEqual([], prepublished, prepublished)
        self.assertFalse(any(
            "130'-0\"" in str(region.get("text") or "")
            for region in searchable
        ))
        self.assertFalse(any(
            region.get("source") == "bounded_measurement_ocr_corroborated"
            and str(region.get("rawOcrText") or "") == "30'-0\""
            for region in searchable
        ))

    def test_checkpoint_replay_preserves_candidates_order_and_fingerprints(self) -> None:
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
        self.assertEqual(self.result["final"], replayed["final"])
        self.assertEqual(self.result["unresolved"], replayed["unresolved"])
        self.assertEqual(
            self.result["ocr"]["rejectedLowConfidenceRegions"],
            replayed["ocr"]["rejectedLowConfidenceRegions"],
        )
        self.assertEqual(
            [visual_exception_fingerprint(item) for item in target_exceptions(self.result)],
            [visual_exception_fingerprint(item) for item in target_exceptions(replayed)],
        )
        area_fingerprints = {
            visual_exception_fingerprint(item)
            for item in target_exceptions(self.result)
            if any(
                candidate.get("text") in AREA_CANONICAL_TEXTS
                for candidate in item["diagnosticCandidates"]
            )
        }
        self.assertEqual(3, len(area_fingerprints))
        self.assertNotIn(
            "2ea47807d6de38693b0324993777276532d01fc29f4d605593401a3629899277",
            area_fingerprints,
        )
        for item in target_exceptions(self.result):
            candidate = item["diagnosticCandidates"][0]
            text = str(candidate["text"])
            if text not in AREA_CANONICAL_TEXTS:
                continue
            if text.startswith("TOTAL FRONTAGE"):
                old_text = "30'"
                old_bounds = {
                    "x": 0.640794,
                    "y": 0.196667,
                    "width": 0.004921,
                    "height": 0.003333,
                }
            else:
                old_text = (
                    "EAST- 30'" if text.startswith("EAST-") else "SOUTH- 30'"
                )
                old_bounds = {
                    "x": 0.624921,
                    "y": candidate["bounds"]["y"],
                    "width": 0.020794,
                    "height": candidate["bounds"]["height"],
                }
            old_fragment_exception = {
                **item,
                "bounds": old_bounds,
                "diagnosticCandidates": [{
                    **candidate, "text": old_text, "bounds": old_bounds,
                }],
            }
            self.assertNotEqual(
                visual_exception_fingerprint(item),
                visual_exception_fingerprint(old_fragment_exception),
            )

    def test_dual_provider_acceptance_requires_the_complete_candidate_partition(self) -> None:
        appended = {"final": {"regions": []}}
        for exception in target_exceptions(self.result):
            facts = []
            for candidate in exception["diagnosticCandidates"]:
                bounds = candidate["bounds"]
                text = candidate["text"]
                facts.append({
                    "subject": text,
                    "location": "",
                    "statement": text,
                    "evidenceText": text,
                    "confidence": 0.97,
                    "bounds": {
                        key: max(1, round(bounds[key] * 1000))
                        if key in {"width", "height"}
                        else round(bounds[key] * 1000)
                        for key in ("x", "y", "width", "height")
                    },
                })
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
                "facts": facts,
            }
            resolution = validated_visual_resolution(payload, exception)
            self.assertTrue(resolution.resolved, resolution.internal_diagnostics)
            self.assertEqual(
                [candidate["text"] for candidate in exception["diagnosticCandidates"]],
                [fact["statement"] for fact in resolution.evidence["facts"]],
            )
            append_visual_evidence(appended, exception, resolution.evidence)

            incomplete = {
                **payload,
                "assuranceAcceptedCandidateIndexes": [],
                "assuranceDismissedCandidateIndexes": [0],
            }
            self.assertFalse(
                validated_visual_resolution(incomplete, exception).resolved
            )

        published = appended["final"]["regions"]
        self.assertEqual(6, len(published))
        self.assertEqual(CANONICAL_TEXTS, {item["text"] for item in published})
        self.assertTrue(all(item["searchable"] is True for item in published))


if __name__ == "__main__":
    unittest.main()
