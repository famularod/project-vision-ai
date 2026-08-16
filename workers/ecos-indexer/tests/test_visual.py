import copy
import base64
import io
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image, ImageDraw

from ecos_indexer.visual import (
    BoundedVisualResolver,
    VISUAL_DISMISSAL_TYPE,
    VISUAL_SCHEMA_VERSION,
    fact_directly_corroborates_candidate,
    validated_persisted_visual_evidence,
    validated_persisted_visual_dismissal,
    validated_visual_resolution,
    visual_exception_fingerprint,
    visual_provider_operation_id,
    visual_provider_request_identity,
    visual_review_bounds,
    visual_review_tile_scale,
    visual_tile_bounds,
    suppress_exact_area_row_crossing_rule,
)


BOUNDS = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
ORGANIZATION_ID = "pie-rls-validation-org-a"
PROJECT_ID = "2321 Compliance Project"
DOCUMENT_ID = "web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603"
HOSTED_JOB_ID = "44444444-4444-4444-8444-444444444444"
HOSTED_CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555"
SOURCE_SHA256 = "a" * 64
EVIDENCE_VERSION = "ecos-hosted-evidence/1.3"
GOLDEN_OPERATION_ID = json.loads(
    Path(__file__).with_name("visual_provider_operation_id_v1.json").read_text(
        encoding="utf-8",
    )
)


def exception(*, region_key="low-confidence-ocr-1", candidate='4" THICK PCC WALKWAY'):
    return {
        "regionKey": region_key,
        "reason": "Verify the low-confidence OCR candidate in this exact crop.",
        "bounds": dict(BOUNDS),
        "diagnosticCandidates": [{
            "text": candidate,
            "source": "native_pdf_text",
            "confidence": 0.44,
            "bounds": dict(BOUNDS),
        }],
    }


def provider_context(target=None, **overrides):
    selected = target or exception()
    context = {
        "organizationId": ORGANIZATION_ID,
        "projectId": PROJECT_ID,
        "documentId": DOCUMENT_ID,
        "sourceSha256": SOURCE_SHA256,
        "pageNumber": 4,
        "hostedJobId": HOSTED_JOB_ID,
        "hostedClaimToken": HOSTED_CLAIM_TOKEN,
        "evidenceVersion": EVIDENCE_VERSION,
        "visualExceptionFingerprint": visual_exception_fingerprint(selected),
        "visualRegionKey": selected["regionKey"],
        "documentName": "Protected drawing",
    }
    context.update(overrides)
    return context


def provider_payload(*, statement='The note specifies a 4" thick PCC walkway.',
                     evidence_text='4" THICK PCC WALKWAY', confidence=0.97,
                     bounds=None, schema=VISUAL_SCHEMA_VERSION,
                     assurance_provider="provider-b",
                     subject="PCC walkway thickness",
                     location="north lot note"):
    return {
        "schemaVersion": schema,
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": assurance_provider,
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
            "subject": subject,
            "location": location,
            "statement": statement,
            "evidenceText": evidence_text,
            "confidence": confidence,
            "bounds": bounds or {"x": 100, "y": 200, "width": 300, "height": 400},
        }],
    }


class VisualTileTests(unittest.TestCase):
    def test_review_rule_suppression_removes_only_exact_crossing_rule(self) -> None:
        image = Image.new("RGB", (2271, 139), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((1734, 0, 1752, 138), fill="black")
        draw.rectangle((1843, 0, 1860, 138), fill="black")
        draw.rectangle((1883, 0, 1893, 138), fill="black")
        source = io.BytesIO()
        image.save(source, format="PNG")

        cleaned = Image.open(io.BytesIO(
            suppress_exact_area_row_crossing_rule(source.getvalue()),
        )).convert("RGB")

        self.assertTrue(all(
            cleaned.getpixel((x, y)) == (255, 255, 255)
            for x in range(1843, 1861) for y in range(139)
        ))
        self.assertTrue(all(
            cleaned.getpixel((x, y)) == (0, 0, 0)
            for x in range(1734, 1753) for y in range(139)
        ))
        self.assertTrue(all(
            cleaned.getpixel((x, y)) == (0, 0, 0)
            for x in range(1883, 1894) for y in range(139)
        ))

        drifted = Image.new("RGB", (2270, 139), "white")
        drifted_payload = io.BytesIO()
        drifted.save(drifted_payload, format="PNG")
        self.assertEqual(
            drifted_payload.getvalue(),
            suppress_exact_area_row_crossing_rule(drifted_payload.getvalue()),
        )

    def test_large_region_is_split_into_six_high_resolution_tiles(self) -> None:
        tiles = visual_tile_bounds({"x": 0, "y": 0, "width": 1, "height": 1})
        self.assertEqual(len(tiles), 6)
        self.assertEqual(tiles[0]["x"], 0)
        self.assertEqual(tiles[0]["y"], 0)
        self.assertAlmostEqual(tiles[-1]["x"] + tiles[-1]["width"], 1)
        self.assertAlmostEqual(tiles[-1]["y"] + tiles[-1]["height"], 1)

    def test_small_exception_stays_one_bounded_crop(self) -> None:
        bounds = {"x": 0.7, "y": 0.7, "width": 0.2, "height": 0.2}
        self.assertEqual(visual_tile_bounds(bounds), [bounds])

    def test_word_tight_exception_gets_context_without_changing_authority(self) -> None:
        bounds = {"x": 0.569444, "y": 0.177222, "width": 0.017593, "height": 0.008056}
        review = visual_review_bounds(bounds, [{"text": "11.00'"}])

        self.assertEqual(review["width"], 0.1)
        self.assertEqual(review["height"], 0.016112)
        self.assertLessEqual(review["x"], bounds["x"])
        self.assertLessEqual(review["y"], bounds["y"])
        self.assertGreaterEqual(review["x"] + review["width"], bounds["x"] + bounds["width"])
        self.assertGreaterEqual(review["y"] + review["height"], bounds["y"] + bounds["height"])
        noisy_review = visual_review_bounds(bounds, [{"text": "[3 '< |"}])
        self.assertGreater(noisy_review["width"], bounds["width"])
        self.assertGreater(noisy_review["height"], bounds["height"])

    def test_nearby_measurement_rows_receive_separate_review_context(self) -> None:
        upper = {"x": 0.733651, "y": 0.566222, "width": 0.008095, "height": 0.003111}
        lower = {"x": 0.733651, "y": 0.575556, "width": 0.008095, "height": 0.003111}

        upper_review = visual_review_bounds(upper, [{"text": "8'-0\""}])
        lower_review = visual_review_bounds(lower, [{"text": "8'-0\""}])

        self.assertEqual(upper_review["width"], 0.1)
        self.assertEqual(upper_review["height"], 0.014)
        self.assertEqual(upper_review["x"], 0.718651)
        self.assertEqual(lower_review["x"], 0.718651)
        self.assertLessEqual(
            upper["x"] - upper_review["x"], 0.02,
        )
        self.assertGreater(
            upper_review["x"] + upper_review["width"]
            - (upper["x"] + upper["width"]),
            0.07,
        )
        self.assertLessEqual(
            upper_review["y"] + upper_review["height"], lower["y"],
        )
        self.assertGreaterEqual(
            lower_review["y"], upper["y"] + upper["height"],
        )
        for authority, review in ((upper, upper_review), (lower, lower_review)):
            self.assertLessEqual(review["x"], authority["x"])
            self.assertLessEqual(review["y"], authority["y"])
            self.assertGreaterEqual(
                review["x"] + review["width"], authority["x"] + authority["width"],
            )
            self.assertGreaterEqual(
                review["y"] + review["height"], authority["y"] + authority["height"],
            )

    def test_only_word_tight_measurements_receive_double_resolution(self) -> None:
        tiny_measurement = [{
            "text": "20'-0\"",
            "bounds": {
                "x": 0.713939,
                "y": 0.764706,
                "width": 0.012121,
                "height": 0.003137,
            },
        }]
        self.assertEqual(6.0, visual_review_tile_scale(tiny_measurement))
        self.assertEqual(3.0, visual_review_tile_scale([{
            "text": "20'-0\"",
            "bounds": {"x": 0.2, "y": 0.2, "width": 0.05, "height": 0.01},
        }]))
        self.assertEqual(3.0, visual_review_tile_scale([{
            "text": "CANOPY NOTE",
            "bounds": tiny_measurement[0]["bounds"],
        }]))
        self.assertEqual(6.0, visual_review_tile_scale([{
            "text": "(E) 10' WIDE EASEMENT TO REMAIN.",
            "source": "exact_rendered_easement_note_composite_candidate",
            "bounds": {
                "x": 0.769206, "y": 0.306889,
                "width": 0.056985, "height": 0.004,
            },
        }]))
        self.assertEqual(6.0, visual_review_tile_scale([{
            "text": "LINE OF 20'-0\" WIDE FIRE APPARATUS ACCESS ROAD.",
            "source": "exact_rendered_site_note_composite_candidate",
            "bounds": {
                "x": 0.761587, "y": 0.382,
                "width": 0.095079, "height": 0.004,
            },
        }]))
        self.assertEqual(6.0, visual_review_tile_scale([{
            "text": "ROOF DECK HEIGHT: MINIMUM 24'-0\"",
            "source": "exact_rendered_page30_complete_proposition_candidate",
            "bounds": {
                "x": 0.71127, "y": 0.212667,
                "width": 0.079206, "height": 0.004,
            },
        }]))

    def test_exact_area_rows_receive_full_table_high_resolution_context(self) -> None:
        east = {
            "text": "EAST- 30' / 185'-1\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "bounds": {
                "x": 0.624881, "y": 0.182667,
                "width": 0.041706, "height": 0.003556,
            },
        }
        south = {
            "text": "SOUTH- 30' / 0'-0\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "bounds": {
                "x": 0.624881, "y": 0.187333,
                "width": 0.040397, "height": 0.003333,
            },
        }
        total = {
            "text": "TOTAL FRONTAGE LENGTH: 30' / 586'-1\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "bounds": {
                "x": 0.566667, "y": 0.196667,
                "width": 0.104365, "height": 0.003556,
            },
        }

        east_review = visual_review_bounds(east["bounds"], [east])
        south_review = visual_review_bounds(south["bounds"], [south])
        total_review = visual_review_bounds(total["bounds"], [total])

        self.assertEqual(6.0, visual_review_tile_scale([east]))
        self.assertEqual(6.0, visual_review_tile_scale([south]))
        self.assertEqual(6.0, visual_review_tile_scale([total]))
        self.assertEqual(
            {"x": 0.617, "y": 0.171, "width": 0.058, "height": 0.034},
            east_review,
        )
        self.assertEqual(east_review, south_review)
        self.assertEqual(
            {"x": 0.558, "y": 0.171, "width": 0.118, "height": 0.036},
            total_review,
        )
        for authority, review in ((east["bounds"], east_review),
                                  (south["bounds"], south_review),
                                  (total["bounds"], total_review)):
            self.assertLessEqual(review["x"], authority["x"])
            self.assertLessEqual(review["y"], authority["y"])
            self.assertGreaterEqual(
                review["x"] + review["width"],
                authority["x"] + authority["width"],
            )
            self.assertGreaterEqual(
                review["y"] + review["height"],
                authority["y"] + authority["height"],
            )

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch(
        "ecos_indexer.visual.suppress_exact_area_row_crossing_rule",
        return_value=b"cleaned-png",
    )
    @patch("ecos_indexer.visual.requests.post")
    def test_exact_area_row_adds_immutable_dense_detail_tile(
        self, post: Mock, suppress_rules: Mock, crop_page: Mock,
    ) -> None:
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = provider_payload()
        post.return_value = response
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        area_bounds = {
            "x": 0.624881, "y": 0.182667,
            "width": 0.041706, "height": 0.003556,
        }
        target = exception()
        target["bounds"] = dict(area_bounds)
        target["diagnosticCandidates"] = [{
            "text": "EAST- 30' / 185'-1\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "confidence": 0.2,
            "bounds": dict(area_bounds),
        }]
        context = provider_context(target)

        resolver.resolve(page=object(), exception=target, context=context)

        request_json = post.call_args.kwargs["json"]
        table_bounds = {
            "x": 0.617, "y": 0.171, "width": 0.058, "height": 0.034,
        }
        self.assertEqual(
            [table_bounds, area_bounds, area_bounds],
            [tile["bounds"] for tile in request_json["tileImages"]],
        )
        crop_scales = [call.kwargs["scale"] for call in crop_page.call_args_list]
        self.assertEqual([1.25, 6.0, 18.0], crop_scales)
        suppress_rules.assert_called_once_with(b"png")
        self.assertEqual(
            b"cleaned-png",
            base64.b64decode(
                request_json["tileImages"][-1]["imageDataUrl"].split(",", 1)[1],
            ),
        )

        south_bounds = {
            "x": 0.624881, "y": 0.187333,
            "width": 0.040397, "height": 0.003333,
        }
        south = exception()
        south["bounds"] = dict(south_bounds)
        south["diagnosticCandidates"] = [{
            "text": "SOUTH- 30' / 0'-0\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "confidence": 0.2,
            "bounds": dict(south_bounds),
        }]
        resolver.resolve(
            page=object(), exception=south, context=provider_context(south),
        )
        south_request = post.call_args.kwargs["json"]
        self.assertEqual(
            [table_bounds, south_bounds],
            [tile["bounds"] for tile in south_request["tileImages"]],
        )
        suppress_rules.assert_called_once_with(b"png")

        crop_page.reset_mock()
        suppress_rules.reset_mock()
        total_bounds = {
            "x": 0.566667, "y": 0.196667,
            "width": 0.104365, "height": 0.003556,
        }
        total = exception()
        total["bounds"] = dict(total_bounds)
        total["diagnosticCandidates"] = [{
            "text": "TOTAL FRONTAGE LENGTH: 30' / 586'-1\"",
            "source": "exact_rendered_area_table_row_composite_candidate",
            "confidence": 0.2,
            "bounds": dict(total_bounds),
        }]
        resolver.resolve(
            page=object(), exception=total, context=provider_context(total),
        )
        total_request = post.call_args.kwargs["json"]
        total_review = {
            "x": 0.558, "y": 0.171, "width": 0.118, "height": 0.036,
        }
        self.assertEqual(
            [total_review, total_bounds, total_bounds],
            [tile["bounds"] for tile in total_request["tileImages"]],
        )
        self.assertEqual(
            [1.25, 6.0, 6.0],
            [call.kwargs["scale"] for call in crop_page.call_args_list],
        )
        suppress_rules.assert_called_once_with(b"png")

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_exact_fire_separation_adds_unmodified_dense_detail_tile(
        self, post: Mock, crop_page: Mock,
    ) -> None:
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = provider_payload()
        post.return_value = response
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        fire_bounds = {
            "x": 0.45746, "y": 0.364,
            "width": 0.085397, "height": 0.013333,
        }
        target = exception()
        target["bounds"] = dict(fire_bounds)
        target["diagnosticCandidates"] = [{
            "text": (
                "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, "
                "OPENINGS NOT LIMITED, NO OPENING PROTECTION REQUIRED."
            ),
            "source": "exact_rendered_fire_separation_composite_candidate",
            "confidence": 0.03,
            "bounds": dict(fire_bounds),
        }]

        resolver.resolve(
            page=object(), exception=target, context=provider_context(target),
        )

        request_json = post.call_args.kwargs["json"]
        review_bounds = visual_review_bounds(fire_bounds, target["diagnosticCandidates"])
        self.assertEqual(
            [
                review_bounds,
                fire_bounds,
                {
                    "x": 0.45746, "y": 0.364,
                    "width": 0.085397, "height": 0.004222,
                },
                {
                    "x": 0.45746, "y": 0.368667,
                    "width": 0.081746, "height": 0.004,
                },
                {
                    "x": 0.45746, "y": 0.373333,
                    "width": 0.016667, "height": 0.004,
                },
            ],
            [tile["bounds"] for tile in request_json["tileImages"]],
        )
        self.assertEqual(
            [1.25, 3.0, 6.0, 12.0, 12.0, 12.0],
            [call.kwargs["scale"] for call in crop_page.call_args_list],
        )
        self.assertEqual(
            b"png",
            base64.b64decode(
                request_json["tileImages"][-1]["imageDataUrl"].split(",", 1)[1],
            ),
        )

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_exact_north_sentence_extra_tiles_require_immutable_bounds(
        self, post: Mock, crop_page: Mock,
    ) -> None:
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = provider_payload()
        post.return_value = response
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        changed_bounds = {
            "x": 0.457461, "y": 0.364,
            "width": 0.085397, "height": 0.013333,
        }
        target = exception()
        target["bounds"] = dict(changed_bounds)
        target["diagnosticCandidates"] = [{
            "text": (
                "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, "
                "OPENINGS NOT LIMITED, NO OPENING PROTECTION REQUIRED."
            ),
            "source": "exact_rendered_fire_separation_composite_candidate",
            "confidence": 0.53,
            "bounds": dict(changed_bounds),
        }]

        resolver.resolve(
            page=object(), exception=target, context=provider_context(target),
        )

        review_bounds = visual_review_bounds(
            changed_bounds, target["diagnosticCandidates"],
        )
        request_json = post.call_args.kwargs["json"]
        self.assertEqual(
            [review_bounds, changed_bounds],
            [tile["bounds"] for tile in request_json["tileImages"]],
        )
        self.assertEqual(
            [1.25, 3.0, 6.0],
            [call.kwargs["scale"] for call in crop_page.call_args_list],
        )

    def test_fingerprint_is_stable_but_changes_with_bounds_reason_or_candidates(self) -> None:
        baseline = exception()
        self.assertEqual(visual_exception_fingerprint(baseline), visual_exception_fingerprint(dict(baseline)))
        for changed in (
            {**baseline, "reason": "A different extraction reason."},
            {**baseline, "bounds": {**BOUNDS, "x": 0.11}},
            exception(candidate='6" THICK PCC WALKWAY'),
        ):
            self.assertNotEqual(visual_exception_fingerprint(baseline), visual_exception_fingerprint(changed))

    def test_matching_assured_fact_resolves_with_exact_provider_bounds(self) -> None:
        provider_bounds = {"x": 150, "y": 250, "width": 100, "height": 100}
        resolved = validated_visual_resolution(
            provider_payload(bounds=provider_bounds), exception(),
        )

        self.assertTrue(resolved.resolved)
        self.assertEqual(0.97, resolved.evidence["confidence"])
        self.assertEqual(
            {"x": 0.15, "y": 0.25, "width": 0.1, "height": 0.1},
            resolved.evidence["facts"][0]["bounds"],
        )
        self.assertEqual(
            provider_bounds,
            resolved.evidence["facts"][0]["providerBounds"],
        )
        self.assertEqual([0], resolved.evidence["facts"][0]["corroboratedCandidateIndexes"])
        self.assertEqual('4" THICK PCC WALKWAY', resolved.evidence["facts"][0]["subject"])
        self.assertEqual("", resolved.evidence["facts"][0]["location"])

    def test_unrelated_or_misaligned_fact_does_not_resolve_candidate(self) -> None:
        cases = {
            "unrelated": provider_payload(
                statement="Door D-101 has a 90-minute rating.",
                evidence_text="90 MIN FIRE DOOR",
            ),
            "wrong measurement": provider_payload(
                statement='The note specifies a 6" thick PCC walkway.',
                evidence_text='6" THICK PCC WALKWAY',
            ),
            "wrong object with same measurement": provider_payload(
                statement='The note specifies a 4" thick PCC wall.',
                evidence_text='4" THICK PCC WALL',
            ),
            "misaligned": provider_payload(
                bounds={"x": 700, "y": 700, "width": 100, "height": 100},
            ),
            "edge touching target": provider_payload(
                bounds={"x": 400, "y": 250, "width": 100, "height": 100},
            ),
            "adjacent to target": provider_payload(
                bounds={"x": 405, "y": 250, "width": 100, "height": 100},
            ),
            "low confidence": provider_payload(confidence=0.84),
            "non-finite confidence": provider_payload(confidence=float("inf")),
            "boolean confidence": provider_payload(confidence=True),
            "string confidence": provider_payload(confidence="0.97"),
            "legacy schema": provider_payload(schema="ecos-drawing-page-analysis/1.0"),
            "no assurance": provider_payload(assurance_provider=""),
        }
        for label, payload in cases.items():
            with self.subTest(label=label):
                self.assertFalse(validated_visual_resolution(payload, exception()).resolved)

    def test_no_fact_resolves_only_after_both_providers_dismiss_every_exact_candidate(self) -> None:
        target = exception()
        payload = {
            **provider_payload(),
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": [0],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [0],
        }
        resolved = validated_visual_resolution(payload, target)

        self.assertTrue(resolved.resolved)
        self.assertEqual(VISUAL_DISMISSAL_TYPE, resolved.evidence["resolutionType"])
        self.assertEqual([], resolved.evidence["facts"])
        self.assertEqual([0], resolved.evidence["dismissedCandidateIndexes"])
        self.assertEqual(
            target["diagnosticCandidates"],
            resolved.evidence["dismissedDiagnosticCandidates"],
        )

    def test_partial_one_sided_or_contradictory_dismissal_remains_unresolved(self) -> None:
        target = exception()
        target["diagnosticCandidates"].append({
            "text": "SECOND CANDIDATE",
            "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.41,
            "bounds": dict(BOUNDS),
        })
        baseline = {
            **provider_payload(),
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": [0, 1],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [0, 1],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [0, 1],
        }
        cases = {
            "primary partial": {**baseline, "primaryDismissedCandidateIndexes": [0]},
            "assurance partial": {**baseline, "assuranceDismissedCandidateIndexes": [0]},
            "joint partial": {**baseline, "dismissedCandidateIndexes": [0]},
            "duplicate": {**baseline, "dismissedCandidateIndexes": [0, 0]},
        }
        for label, payload in cases.items():
            with self.subTest(label=label):
                self.assertFalse(validated_visual_resolution(payload, target).resolved)

        proposed_fact = validated_visual_resolution(
            {**baseline, "facts": provider_payload()["facts"]}, target,
        )
        self.assertFalse(proposed_fact.resolved)

    def test_mixed_fact_and_dual_dismissal_requires_exact_durable_partition(self) -> None:
        target = exception()
        target["diagnosticCandidates"].append({
            "text": "SECOND CANDIDATE",
            "source": "fixed_visual_tile_coordinate_ocr",
            "confidence": 0.41,
            "bounds": {"x": 0.25, "y": 0.45, "width": 0.1, "height": 0.1},
        })
        payload = {
            **provider_payload(bounds={"x": 150, "y": 250, "width": 100, "height": 100}),
            "primaryDismissedCandidateIndexes": [1],
            "assuranceDismissedCandidateIndexes": [1],
            "dismissedCandidateIndexes": [1],
        }
        resolved = validated_visual_resolution(payload, target)
        self.assertTrue(resolved.resolved)
        self.assertEqual([0], resolved.evidence["acceptedCandidateIndexes"])
        self.assertEqual([1], resolved.evidence["dismissedCandidateIndexes"])
        self.assertEqual(
            [target["diagnosticCandidates"][1]],
            resolved.evidence["dismissedDiagnosticCandidates"],
        )

        fingerprint = visual_exception_fingerprint(target)
        persisted = copy.deepcopy(resolved.evidence)
        persisted.update({
            "evidenceVersion": EVIDENCE_VERSION,
            "exceptionFingerprint": fingerprint,
        })
        for fact in persisted["facts"]:
            fact.update({
                "evidenceVersion": EVIDENCE_VERSION,
                "exceptionFingerprint": fingerprint,
            })
        self.assertIsNotNone(validated_persisted_visual_evidence(persisted, target))
        for field, forged in (
            ("primaryAcceptedCandidateIndexes", []),
            ("assuranceAcceptedCandidateIndexes", []),
            ("primaryAcceptedCandidateIndexes", [False]),
            ("primaryDismissedCandidateIndexes", []),
            ("assuranceDismissedCandidateIndexes", []),
            ("dismissedCandidateIndexes", []),
            ("dismissedCandidateIndexes", [1, 1]),
            ("dismissedDiagnosticCandidates", []),
            ("acceptedCandidateIndexes", [1]),
            ("acceptedCandidateIndexes", [False]),
            ("dismissedCandidateIndexes", [True]),
        ):
            with self.subTest(field=field, forged=forged):
                tampered = copy.deepcopy(persisted)
                tampered[field] = forged
                self.assertIsNone(validated_persisted_visual_evidence(tampered, target))

        tampered_candidate = copy.deepcopy(persisted)
        tampered_candidate["acceptedDiagnosticCandidates"][0]["bounds"]["x"] = False
        self.assertIsNone(validated_persisted_visual_evidence(tampered_candidate, target))
        for field, value in (
            ("confidence", 2.0),
            ("confidence", -1.0),
            ("confidence", float("nan")),
            ("text", '  4" THICK PCC WALKWAY  '),
        ):
            with self.subTest(candidate_field=field, value=value):
                tampered_candidate = copy.deepcopy(persisted)
                tampered_candidate["acceptedDiagnosticCandidates"][0][field] = value
                self.assertIsNone(validated_persisted_visual_evidence(tampered_candidate, target))
        extra_candidate_key = copy.deepcopy(persisted)
        extra_candidate_key["acceptedDiagnosticCandidates"][0]["unexpected"] = True
        self.assertIsNone(validated_persisted_visual_evidence(extra_candidate_key, target))

    def test_invalid_dismissal_index_is_not_equivalent_to_valid_empty(self) -> None:
        for indexes in ([0, 0], [2], ["0"]):
            with self.subTest(indexes=indexes):
                payload = provider_payload()
                payload["primaryDismissedCandidateIndexes"] = indexes
                payload["primaryDismissedCandidateIndexesValid"] = False
                self.assertFalse(validated_visual_resolution(payload, exception()).resolved)

    def test_dual_provider_candidate_indexes_must_match_the_exact_fact_partition(self) -> None:
        baseline = provider_payload()
        self.assertTrue(validated_visual_resolution(baseline, exception()).resolved)
        cases = {
            "missing method": {**baseline, "candidateAgreementMethod": None},
            "primary abstains": {**baseline, "primaryAcceptedCandidateIndexes": []},
            "assurance abstains": {**baseline, "assuranceAcceptedCandidateIndexes": []},
            "primary invalid": {
                **baseline,
                "primaryAcceptedCandidateIndexes": [False],
                "primaryAcceptedCandidateIndexesValid": False,
            },
            "assurance string": {
                **baseline,
                "assuranceAcceptedCandidateIndexes": ["0"],
                "assuranceAcceptedCandidateIndexesValid": False,
            },
            "accepted and dismissed": {
                **baseline,
                "primaryDismissedCandidateIndexes": [0],
                "assuranceDismissedCandidateIndexes": [0],
                "dismissedCandidateIndexes": [0],
            },
        }
        for label, payload in cases.items():
            with self.subTest(label=label):
                self.assertFalse(
                    validated_visual_resolution(payload, exception()).resolved
                )

    def test_persisted_dismissal_revalidates_exact_candidate_set_only(self) -> None:
        target = exception()
        evidence = validated_visual_resolution({
            **provider_payload(),
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": [0],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [0],
        }, target).evidence
        self.assertIsNotNone(validated_persisted_visual_dismissal(evidence, target))

        changed = copy.deepcopy(evidence)
        changed["dismissedDiagnosticCandidates"][0]["text"] = "FORGED CANDIDATE"
        self.assertIsNone(validated_persisted_visual_dismissal(changed, target))
        for field, value in (
            ("confidence", 2.0),
            ("confidence", -1.0),
            ("confidence", float("nan")),
            ("text", '  4" THICK PCC WALKWAY  '),
        ):
            with self.subTest(candidate_field=field, value=value):
                changed = copy.deepcopy(evidence)
                changed["dismissedDiagnosticCandidates"][0][field] = value
                self.assertIsNone(validated_persisted_visual_dismissal(changed, target))
        extra = copy.deepcopy(evidence)
        extra["dismissedDiagnosticCandidates"][0]["unexpected"] = True
        self.assertIsNone(validated_persisted_visual_dismissal(extra, target))

    def test_fact_must_materially_intersect_the_diagnostic_candidate(self) -> None:
        target = exception()
        target["diagnosticCandidates"][0]["bounds"] = {
            "x": 0.1, "y": 0.2, "width": 0.1, "height": 0.1,
        }
        for label, bounds in {
            "candidate edge touch": {"x": 200, "y": 200, "width": 100, "height": 100},
            "candidate sliver": {"x": 190, "y": 200, "width": 100, "height": 100},
        }.items():
            with self.subTest(label=label):
                self.assertFalse(validated_visual_resolution(
                    provider_payload(bounds=bounds), target,
                ).resolved)

    def test_fact_must_be_contained_by_the_diagnostic_candidate(self) -> None:
        target = exception()
        target["diagnosticCandidates"][0]["bounds"] = {
            "x": 0.1, "y": 0.2, "width": 0.1, "height": 0.1,
        }
        extending_bounds = {"x": 150, "y": 200, "width": 100, "height": 100}
        self.assertFalse(validated_visual_resolution(
            provider_payload(bounds=extending_bounds), target,
        ).resolved)

        exact_fingerprint = visual_exception_fingerprint(target)
        persisted = provider_payload(bounds=extending_bounds)
        persisted.update({
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": exact_fingerprint,
            "evidenceText": '4" THICK PCC WALKWAY',
            "confidence": 0.97,
        })
        persisted_fact = persisted["facts"][0]
        persisted_fact.update({
            "bounds": {"x": 0.15, "y": 0.2, "width": 0.1, "height": 0.1},
            "providerBounds": extending_bounds,
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": exact_fingerprint,
            "visionProvider": persisted["visionProvider"],
            "model": persisted["model"],
            "assuranceProvider": persisted["assuranceProvider"],
            "assuranceModel": persisted["assuranceModel"],
            "corroboratedCandidateIndexes": [0],
            "source": "vision",
        })
        self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_one_pixel_box_outside_candidate_cannot_use_quantization_tolerance(self) -> None:
        target = exception()
        target["diagnosticCandidates"][0]["bounds"] = {
            "x": 0.1, "y": 0.2, "width": 0.1, "height": 0.1,
        }
        adjacent_bounds = {"x": 200, "y": 250, "width": 1, "height": 1}
        self.assertFalse(validated_visual_resolution(
            provider_payload(bounds=adjacent_bounds), target,
        ).resolved)

        fingerprint = visual_exception_fingerprint(target)
        persisted = provider_payload(bounds=adjacent_bounds)
        persisted.update({
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": fingerprint,
            "evidenceText": '4" THICK PCC WALKWAY',
            "confidence": 0.97,
        })
        fact = persisted["facts"][0]
        fact.update({
            "bounds": {"x": 0.2, "y": 0.25, "width": 0.001, "height": 0.001},
            "providerBounds": adjacent_bounds,
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": fingerprint,
            "visionProvider": persisted["visionProvider"],
            "model": persisted["model"],
            "assuranceProvider": persisted["assuranceProvider"],
            "assuranceModel": persisted["assuranceModel"],
            "corroboratedCandidateIndexes": [0],
            "source": "vision",
        })
        self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_one_pixel_candidate_outside_exception_cannot_use_tolerance(self) -> None:
        target = exception()
        target["diagnosticCandidates"][0]["bounds"] = {
            "x": 0.4, "y": 0.25, "width": 0.001, "height": 0.001,
        }
        adjacent_bounds = {"x": 400, "y": 250, "width": 1, "height": 1}
        self.assertFalse(validated_visual_resolution(
            provider_payload(bounds=adjacent_bounds), target,
        ).resolved)

        fingerprint = visual_exception_fingerprint(target)
        persisted = provider_payload(bounds=adjacent_bounds)
        persisted.update({
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": fingerprint,
            "evidenceText": '4" THICK PCC WALKWAY',
            "confidence": 0.97,
        })
        fact = persisted["facts"][0]
        fact.update({
            "bounds": {"x": 0.4, "y": 0.25, "width": 0.001, "height": 0.001},
            "providerBounds": adjacent_bounds,
            "evidenceVersion": "ecos-hosted-evidence/1.3",
            "exceptionFingerprint": fingerprint,
            "visionProvider": persisted["visionProvider"],
            "model": persisted["model"],
            "assuranceProvider": persisted["assuranceProvider"],
            "assuranceModel": persisted["assuranceModel"],
            "corroboratedCandidateIndexes": [0],
            "source": "vision",
        })
        self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_generic_fact_cannot_clear_title_or_completeness_exception(self) -> None:
        for region_key in ("title-block", "page-overview", "low-text-page"):
            with self.subTest(region_key=region_key):
                self.assertFalse(validated_visual_resolution(
                    provider_payload(), exception(region_key=region_key),
                ).resolved)

    def test_direct_candidate_corroboration_rejects_keyword_only_coincidence(self) -> None:
        cases = (
            ({
                "subject": "PCC note",
                "location": "different area",
                "statement": "PCC is shown elsewhere.",
                "evidenceText": "PCC",
            }, '4" THICK PCC WALKWAY'),
            ({"statement": "2 HOUR", "evidenceText": "FIRE"}, "2 HOUR FIRE BARRIER"),
            ({"statement": "STEEL", "evidenceText": "BEAM TYPE"}, "STEEL BEAM TYPE A"),
        )
        for fact, candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertFalse(fact_directly_corroborates_candidate(fact, candidate))

    def test_drawing_critical_measurements_and_identifiers_are_exactly_bound(self) -> None:
        cases = (
            ('4 1/2" THICK PCC WALKWAY', '5 1/2" THICK PCC WALKWAY'),
            ('4-1/2" THICK PCC WALKWAY', '5-1/2" THICK PCC WALKWAY'),
            ('1/2" PLATE', '3/2" PLATE'),
            ('4 FT 6 1/2 IN CONDUIT', '5 FT 6 1/2 IN CONDUIT'),
            ('4½" THICK PCC WALKWAY', '4¼" THICK PCC WALKWAY'),
            ('½" PLATE', '¼" PLATE'),
            ('4\'-6½" CONDUIT', '4\'-6¼" CONDUIT'),
            ('4.5" THICK PCC WALKWAY', '4.25" THICK PCC WALKWAY'),
            ("4' WIDE WALKWAY", "5' WIDE WALKWAY"),
            ('#4 REBAR AT 12 IN', '#5 REBAR AT 12 IN'),
            ('AREA C HAZARDOUS WASTE', 'AREA D HAZARDOUS WASTE'),
            ('DETAIL 4/A501 PCC WALKWAY', 'DETAIL 5/A501 PCC WALKWAY'),
            ('GRID A-4 PCC WALKWAY', 'GRID A-5 PCC WALKWAY'),
            ('NOTE 4 PCC WALKWAY', 'NOTE 5 PCC WALKWAY'),
            ('STEEL BEAM A', 'STEEL BEAM B'),
            ('WALL A', 'WALL B'),
            ('DOOR A', 'DOOR B'),
            ('PLAN A', 'PLAN B'),
            ('SECTION A', 'SECTION B'),
            ('LIGHTING PROVIDED', 'NO LIGHTING PROVIDED'),
            ('LIGHTING PROVIDED', 'LIGHTING NOT PROVIDED'),
            ('FIRE BARRIER REQUIRED', 'FIRE BARRIER NOT REQUIRED'),
            ('PCC WALKWAY', 'NO PCC WALKWAY'),
            ('DOOR SHALL REMAIN', 'DOOR SHALL NOT REMAIN'),
            ('WALL WITH DOOR', 'WALL WITHOUT DOOR'),
            ('NEW WALL', 'EXISTING WALL'),
            ('NEW LIGHTING', 'EXISTING LIGHTING'),
            ('NEW PCC WALKWAY', 'EXISTING PCC WALKWAY'),
            ('NEW DOOR A', 'EXISTING DOOR A'),
            ('PIPE IN WALL', 'PIPE ON WALL'),
            ('PIPE FROM A TO B', 'PIPE FROM B TO A'),
        )
        evidence_version = "ecos-hosted-evidence/1.3"
        for candidate, conflicting_fact in cases:
            with self.subTest(candidate=candidate, conflicting_fact=conflicting_fact):
                target = exception(candidate=candidate)
                self.assertFalse(validated_visual_resolution(
                    provider_payload(
                        statement=conflicting_fact,
                        evidence_text=conflicting_fact,
                        subject="",
                        location="",
                    ),
                    target,
                ).resolved)

                accepted = validated_visual_resolution(
                    provider_payload(
                        statement=candidate,
                        evidence_text=candidate,
                        subject="",
                        location="",
                    ),
                    target,
                )
                self.assertTrue(accepted.resolved)
                fingerprint = visual_exception_fingerprint(target)
                persisted = copy.deepcopy(accepted.evidence)
                persisted.update({
                    "evidenceVersion": evidence_version,
                    "exceptionFingerprint": fingerprint,
                })
                for fact in persisted["facts"]:
                    fact.update({
                        "statement": conflicting_fact,
                        "evidenceText": conflicting_fact,
                        "evidenceVersion": evidence_version,
                        "exceptionFingerprint": fingerprint,
                    })
                self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_dual_provider_measurement_transcription_is_narrow_and_replay_safe(self) -> None:
        target = exception(candidate="24'-D\" TO 21'-O\" MAX.")
        target["diagnosticCandidates"][0]["source"] = (
            "fixed_visual_tile_measurement_transcription_correction"
        )
        corrected = "24'-0\" TO 27'-0\" MAX"
        accepted = validated_visual_resolution(
            provider_payload(
                statement=corrected,
                evidence_text=corrected,
                subject="",
                location="",
            ),
            target,
        )
        self.assertTrue(accepted.resolved)
        self.assertEqual(corrected, accepted.evidence["facts"][0]["statement"])
        self.assertEqual(
            "dual_provider_exact_measurement_transcription",
            accepted.evidence["facts"][0]["ocrCorrectionMethod"],
        )

        fingerprint = visual_exception_fingerprint(target)
        persisted = copy.deepcopy(accepted.evidence)
        persisted.update({
            "evidenceVersion": EVIDENCE_VERSION,
            "exceptionFingerprint": fingerprint,
        })
        for fact in persisted["facts"]:
            fact.update({
                "evidenceVersion": EVIDENCE_VERSION,
                "exceptionFingerprint": fingerprint,
            })
        replayed = validated_persisted_visual_evidence(persisted, target)
        self.assertIsNotNone(replayed)
        self.assertEqual(corrected, replayed["facts"][0]["statement"])

        invalid = (
            "24'-0\" TO 37'-0\" MAX",
            "24'-0\" TO 27'-0\"",
            "24'-0\" TO 27'-0\" MAX nearby note",
            "24'-0\" TO 27'-12\" MAX",
            "24'-0\" TO 27'-0\" MIN",
        )
        for value in invalid:
            with self.subTest(value=value):
                self.assertFalse(validated_visual_resolution(
                    provider_payload(
                        statement=value,
                        evidence_text=value,
                        subject="",
                        location="",
                    ),
                    target,
                ).resolved)

        one_sided = provider_payload(
            statement=corrected,
            evidence_text=corrected,
            subject="",
            location="",
        )
        one_sided["assuranceProvider"] = one_sided["visionProvider"]
        self.assertFalse(validated_visual_resolution(one_sided, target).resolved)

        alternate_letter = exception(candidate="20'-e\"")
        alternate_letter["diagnosticCandidates"][0]["source"] = (
            "fixed_visual_tile_measurement_transcription_correction"
        )
        corrected_alternate = "20'-0\""
        self.assertTrue(validated_visual_resolution(
            provider_payload(
                statement=corrected_alternate,
                evidence_text=corrected_alternate,
                subject="",
                location="",
            ),
            alternate_letter,
        ).resolved)

    def test_measurement_transcription_marker_cannot_correct_non_measurement(self) -> None:
        target = exception(candidate="WALL TYPE D")
        target["diagnosticCandidates"][0]["source"] = (
            "fixed_visual_tile_measurement_transcription_correction"
        )
        self.assertFalse(validated_visual_resolution(
            provider_payload(
                statement="WALL TYPE B",
                evidence_text="WALL TYPE B",
                subject="",
                location="",
            ),
            target,
        ).resolved)

    def test_dual_provider_measurement_transcription_accepts_min_typical_expansion(self) -> None:
        target = exception(candidate="5'-O\" MIN. TYP")
        target["diagnosticCandidates"][0].update({
            "source": "fixed_visual_tile_measurement_transcription_correction",
            "bounds": {"x": 0.796238, "y": 0.923056,
                       "width": 0.040857, "height": 0.004333},
        })
        target["bounds"] = dict(target["diagnosticCandidates"][0]["bounds"])
        corrected = "5'-0\" MIN. TYPICAL"
        payload = provider_payload(
            statement=corrected,
            evidence_text=corrected,
            subject="",
            location="",
        )
        payload["facts"][0]["bounds"] = {
            "x": 797, "y": 924, "width": 39, "height": 3,
        }

        accepted = validated_visual_resolution(payload, target)

        self.assertTrue(accepted.resolved)
        self.assertEqual(
            "5'-0\" MIN TYP",
            accepted.evidence["facts"][0]["statement"],
        )

    def test_candidate_cannot_be_assembled_across_provider_fields(self) -> None:
        cases = (
            ('FIRE BARRIER', "FIRE", "BARRIER", "other", "unrelated"),
            ('4 IN PCC WALKWAY', "4 IN", "PCC", "WALKWAY", "unrelated"),
            ('HAZARDOUS WASTE', "HAZARDOUS", "WASTE", "other", "unrelated"),
        )
        evidence_version = "ecos-hosted-evidence/1.3"
        for candidate, subject, location, statement, evidence_text in cases:
            with self.subTest(candidate=candidate):
                target = exception(candidate=candidate)
                payload = provider_payload(
                    subject=subject,
                    location=location,
                    statement=statement,
                    evidence_text=evidence_text,
                )
                self.assertFalse(validated_visual_resolution(payload, target).resolved)

                accepted = validated_visual_resolution(
                    provider_payload(
                        subject="", location="", statement=candidate,
                        evidence_text=candidate,
                    ),
                    target,
                )
                self.assertTrue(accepted.resolved)
                fingerprint = visual_exception_fingerprint(target)
                persisted = copy.deepcopy(accepted.evidence)
                persisted.update({
                    "evidenceVersion": evidence_version,
                    "exceptionFingerprint": fingerprint,
                })
                for fact in persisted["facts"]:
                    fact.update({
                        "subject": subject,
                        "location": location,
                        "statement": statement,
                        "evidenceText": evidence_text,
                        "evidenceVersion": evidence_version,
                        "exceptionFingerprint": fingerprint,
                    })
                self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_saved_statement_cannot_contradict_exact_visual_quote(self) -> None:
        cases = (
            ('4" THICK PCC WALKWAY', 'The PCC walkway is 6 inches thick.'),
            ('FIRE BARRIER REQUIRED', 'The fire barrier is not required.'),
            ('NEW WALL', 'The existing wall remains.'),
            ('WALL A', 'Wall B is shown.'),
            ('PCC WALKWAY', 'A PCC wall is shown.'),
        )
        evidence_version = "ecos-hosted-evidence/1.3"
        for candidate, contradictory_statement in cases:
            with self.subTest(candidate=candidate):
                target = exception(candidate=candidate)
                self.assertFalse(validated_visual_resolution(
                    provider_payload(
                        statement=contradictory_statement,
                        evidence_text=candidate,
                        subject="",
                        location="",
                    ),
                    target,
                ).resolved)

                accepted = validated_visual_resolution(
                    provider_payload(
                        statement=candidate,
                        evidence_text=candidate,
                        subject="",
                        location="",
                    ),
                    target,
                )
                self.assertTrue(accepted.resolved)
                fingerprint = visual_exception_fingerprint(target)
                persisted = copy.deepcopy(accepted.evidence)
                persisted.update({
                    "evidenceVersion": evidence_version,
                    "exceptionFingerprint": fingerprint,
                })
                for fact in persisted["facts"]:
                    fact.update({
                        "statement": contradictory_statement,
                        "evidenceVersion": evidence_version,
                        "exceptionFingerprint": fingerprint,
                    })
                self.assertIsNone(validated_persisted_visual_evidence(persisted, target))

    def test_provider_subject_and_location_cannot_retag_verified_quote(self) -> None:
        target = exception(candidate='4" THICK PCC WALKWAY')
        resolved = validated_visual_resolution(
            provider_payload(
                statement='4" THICK PCC WALKWAY',
                evidence_text='4" THICK PCC WALKWAY',
                subject="fire barrier",
                location="Canopy B",
            ),
            target,
        )
        self.assertTrue(resolved.resolved)
        fact = resolved.evidence["facts"][0]
        self.assertEqual('4" THICK PCC WALKWAY', fact["subject"])
        self.assertEqual("", fact["location"])

        evidence_version = "ecos-hosted-evidence/1.3"
        fingerprint = visual_exception_fingerprint(target)
        persisted = copy.deepcopy(resolved.evidence)
        persisted.update({
            "evidenceVersion": evidence_version,
            "exceptionFingerprint": fingerprint,
        })
        for stored_fact in persisted["facts"]:
            stored_fact.update({
                "subject": "fire barrier",
                "location": "Canopy B",
                "evidenceVersion": evidence_version,
                "exceptionFingerprint": fingerprint,
            })
        revalidated = validated_persisted_visual_evidence(persisted, target)
        self.assertIsNotNone(revalidated)
        self.assertEqual('4" THICK PCC WALKWAY', revalidated["facts"][0]["subject"])
        self.assertEqual("", revalidated["facts"][0]["location"])

    def test_provider_appendages_are_removed_from_fresh_and_persisted_proof(self) -> None:
        candidate = '4" THICK PCC WALKWAY'
        appended_claims = (
            f"{candidate} and Canopy B stores hazardous waste",
            f"{candidate} and lighting is provided at Canopy B",
            f"{candidate} and it has a 2 hour fire rating",
        )
        evidence_version = "ecos-hosted-evidence/1.3"
        for appended in appended_claims:
            with self.subTest(appended=appended):
                target = exception(candidate=candidate)
                resolved = validated_visual_resolution(
                    provider_payload(
                        statement=appended,
                        evidence_text=appended,
                        subject="unsupported subject",
                        location="unsupported location",
                    ),
                    target,
                )
                self.assertTrue(resolved.resolved)
                self.assertEqual(candidate, resolved.evidence["evidenceText"])
                fact = resolved.evidence["facts"][0]
                self.assertEqual(candidate, fact["statement"])
                self.assertEqual(candidate, fact["evidenceText"])
                self.assertEqual(candidate, fact["subject"])
                self.assertEqual("", fact["location"])

                fingerprint = visual_exception_fingerprint(target)
                persisted = copy.deepcopy(resolved.evidence)
                persisted.update({
                    "evidenceVersion": evidence_version,
                    "exceptionFingerprint": fingerprint,
                })
                for stored_fact in persisted["facts"]:
                    stored_fact.update({
                        "statement": appended,
                        "evidenceText": appended,
                        "subject": "unsupported subject",
                        "location": "unsupported location",
                        "evidenceVersion": evidence_version,
                        "exceptionFingerprint": fingerprint,
                    })
                revalidated = validated_persisted_visual_evidence(persisted, target)
                self.assertIsNotNone(revalidated)
                self.assertEqual(candidate, revalidated["evidenceText"])
                stored = revalidated["facts"][0]
                self.assertEqual(candidate, stored["statement"])
                self.assertEqual(candidate, stored["evidenceText"])
                self.assertEqual(candidate, stored["subject"])
                self.assertEqual("", stored["location"])

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_provider_receives_exact_bounded_diagnostic_candidates(
        self, post: Mock, _crop_page: Mock,
    ) -> None:
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = provider_payload()
        post.return_value = response
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        target = exception()

        resolved = resolver.resolve(
            page=object(),
            exception=target,
            context=provider_context(target),
        )

        self.assertTrue(resolved.resolved)
        request_json = post.call_args.kwargs["json"]
        review_bounds = visual_review_bounds(
            BOUNDS, target["diagnosticCandidates"],
        )
        self.assertEqual(VISUAL_SCHEMA_VERSION, request_json["schemaVersion"])
        self.assertEqual("page_tiles", request_json["analysisPass"])
        self.assertEqual(review_bounds, request_json["tileBounds"])
        self.assertEqual(
            visual_tile_bounds(review_bounds),
            [tile["bounds"] for tile in request_json["tileImages"]],
        )
        self.assertEqual(target["regionKey"], request_json["visualException"]["regionKey"])
        self.assertEqual(BOUNDS, request_json["visualException"]["bounds"])
        self.assertEqual(
            target["diagnosticCandidates"][0]["text"],
            request_json["visualException"]["diagnosticCandidates"][0]["text"],
        )
        expected_identity = visual_provider_request_identity(provider_context(target), target)
        self.assertEqual(
            expected_identity,
            {key: request_json[key] for key in expected_identity},
        )
        self.assertEqual((10, 240), post.call_args.kwargs["timeout"])

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_missing_or_malformed_provider_identity_fails_before_crop_or_http(
        self, post: Mock, crop: Mock,
    ) -> None:
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        target = exception()
        valid_context = provider_context(target)
        required_fields = (
            "organizationId",
            "projectId",
            "documentId",
            "sourceSha256",
            "pageNumber",
            "hostedJobId",
            "hostedClaimToken",
            "evidenceVersion",
            "visualExceptionFingerprint",
            "visualRegionKey",
        )
        cases = {
            **{
                f"missing {field}": {
                    key: value for key, value in valid_context.items() if key != field
                }
                for field in required_fields
            },
            "control in organization": {
                **valid_context,
                "organizationId": "pie-rls-validation-org-a\nforged",
            },
            "blank project": {**valid_context, "projectId": "   "},
            "non-ASCII project": {
                **valid_context,
                "projectId": "2321 Compliance Projéct",
            },
            "oversized project": {**valid_context, "projectId": "p" * 501},
            "oversized document": {**valid_context, "documentId": "d" * 201},
            "non-canonical hosted job": {
                **valid_context,
                "hostedJobId": "44444444-4444-4444-8444-44444444444A",
            },
            "invalid source checksum": {**valid_context, "sourceSha256": "a" * 63},
            "string page number": {**valid_context, "pageNumber": "4"},
            "zero page number": {**valid_context, "pageNumber": 0},
            "control in evidence version": {
                **valid_context,
                "evidenceVersion": "ecos-hosted-evidence/1.3\nforged",
            },
            "wrong exception fingerprint": {
                **valid_context,
                "visualExceptionFingerprint": "b" * 64,
            },
            "wrong exception region": {
                **valid_context,
                "visualRegionKey": "low-confidence-ocr-other",
            },
        }
        for label, context in cases.items():
            with self.subTest(label=label):
                post.reset_mock()
                crop.reset_mock()
                resolution = resolver.resolve(page=object(), exception=target, context=context)
                self.assertFalse(resolution.resolved)
                self.assertEqual(
                    "visual_request_identity_invalid",
                    resolution.internal_diagnostics.get("category"),
                )
                crop.assert_not_called()
                post.assert_not_called()

    def test_provider_operation_identity_is_stable_and_binds_source_page_and_exception(
        self,
    ) -> None:
        target = exception()
        baseline = visual_provider_request_identity(provider_context(target), target)
        repeated = visual_provider_request_identity(provider_context(target), target)
        self.assertEqual(baseline["providerOperationId"], repeated["providerOperationId"])
        self.assertRegex(baseline["providerOperationId"], r"^[a-f0-9]{64}$")

        golden_canonical_input = GOLDEN_OPERATION_ID["canonicalInput"]
        golden_request_identity = {
            key: value for key, value in GOLDEN_OPERATION_ID["requestIdentity"].items()
            if key != "providerOperationId"
        }
        self.assertEqual(
            golden_request_identity,
            {
                key: value for key, value in golden_canonical_input.items()
                if key != "schemaVersion"
            },
        )
        self.assertEqual(
            GOLDEN_OPERATION_ID["canonicalBytes"],
            json.dumps(
                golden_canonical_input,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
            ),
        )
        self.assertEqual(
            GOLDEN_OPERATION_ID["requestIdentity"]["providerOperationId"],
            visual_provider_operation_id(golden_request_identity),
        )

        changed_source = visual_provider_request_identity(
            provider_context(target, sourceSha256="b" * 64), target,
        )
        changed_page = visual_provider_request_identity(
            provider_context(target, pageNumber=5), target,
        )
        changed_claim = visual_provider_request_identity(
            provider_context(
                target,
                hostedClaimToken="66666666-6666-4666-8666-666666666666",
            ),
            target,
        )
        changed_exception = exception(candidate='6" THICK PCC WALKWAY')
        changed_exception_identity = visual_provider_request_identity(
            provider_context(changed_exception), changed_exception,
        )
        changed_organization = visual_provider_request_identity(
            provider_context(target, organizationId="pie-rls-validation-org-b"), target,
        )
        changed_project = visual_provider_request_identity(
            provider_context(target, projectId="2375 Compliance Project"), target,
        )
        changed_document = visual_provider_request_identity(
            provider_context(target, documentId="web-document-other"), target,
        )
        exact_outer_space_project = visual_provider_request_identity(
            provider_context(target, projectId=" 2321 Compliance Project "), target,
        )
        self.assertEqual(
            " 2321 Compliance Project ",
            exact_outer_space_project["projectId"],
        )
        for changed in (
            changed_source,
            changed_page,
            changed_claim,
            changed_exception_identity,
            changed_organization,
            changed_project,
            changed_document,
            exact_outer_space_project,
        ):
            self.assertNotEqual(
                baseline["providerOperationId"], changed["providerOperationId"],
            )


if __name__ == "__main__":
    unittest.main()
