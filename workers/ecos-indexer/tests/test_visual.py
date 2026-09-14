import copy
import unittest
import requests
from unittest.mock import Mock, patch

from ecos_indexer.visual import (
    BoundedVisualResolver,
    VISUAL_DISMISSAL_TYPE,
    VISUAL_SCHEMA_VERSION,
    fact_directly_corroborates_candidate,
    validated_persisted_visual_dismissal,
    validated_persisted_visual_evidence,
    validated_visual_resolution,
    visual_exception_fingerprint,
    visual_provider_operation_identity,
    visual_tile_bounds,
)


BOUNDS = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
PROVIDER_CONTEXT = {
    "organizationId": "pie-rls-validation-org-a",
    "projectId": "72e941d8-8114-4082-a976-ae5b2b5daba9",
    "documentId": "web-document-73555e08-e464-4d6e-8dda-af3631987eeb",
    "sourceSha256": "7" * 64,
    "pageNumber": 4,
    "hostedJobId": "189bbdfe-6fc7-4f84-8a5e-8d8fa813b586",
    "hostedClaimToken": "859b4e84-85d0-4897-ab68-6426cf11aef3",
    "evidenceVersion": "ecos-hosted-evidence/1.3",
}


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


def provider_payload(*, statement='The note specifies a 4" thick PCC walkway.',
                     evidence_text='4" THICK PCC WALKWAY', confidence=0.97,
                     bounds=None, schema=VISUAL_SCHEMA_VERSION,
                     assurance_provider="provider-b",
                     subject="PCC walkway thickness",
                     location="north lot note"):
    return {
        "schemaVersion": schema,
        "visionProvider": "provider-a",
        "model": "analysis-model",
        "assuranceProvider": assurance_provider,
        "assuranceModel": "assurance-model",
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
    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_measurement_routing_never_sends_worker_credentials_to_another_host(self, post, _crop):
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/functions/v1/ecos-analyze-drawing-page"
        resolver.token = "unit-test-token"
        target = exception(region_key="low-confidence-ocr-plan-dimension-test-horizontal", candidate='20\'-0"')
        target["diagnosticCandidates"][0]["source"] = "fixed_visual_tile_measurement_transcription_correction"
        for url in ("https://other.example/functions/v1/ecos-analyze-drawing-page-preview",
                    "http://protected.example/functions/v1/ecos-analyze-drawing-page-preview",
                    "https://protected.example/functions/v1/ecos-analyze-drawing-page-preview?token=x"):
            resolver.measurement_endpoint = url
            result = resolver.resolve(page=Mock(rect=Mock(width=792,height=612)), exception=target, context=PROVIDER_CONTEXT)
            self.assertFalse(result.resolved)
            self.assertEqual(result.internal_diagnostics["category"], "visual_measurement_endpoint_invalid")
        post.assert_not_called()
        resolver.measurement_endpoint = "https://protected.example/functions/v1/ecos-analyze-drawing-page-preview"
        post.return_value = Mock(status_code=502)
        post.return_value.json.return_value = {"error": "analysis_timeout"}
        result = resolver.resolve(page=Mock(rect=Mock(width=792,height=612)), exception=target, context=PROVIDER_CONTEXT)
        self.assertEqual(post.call_args.args[0], resolver.measurement_endpoint)
        self.assertEqual(result.internal_diagnostics["error"], "analysis_timeout")

    @patch("ecos_indexer.visual.crop_page", return_value=b"png")
    @patch("ecos_indexer.visual.requests.post")
    def test_transport_failure_is_uncertain_and_never_retried(self, post, _crop):
        resolver = BoundedVisualResolver()
        resolver.endpoint = "https://protected.example/visual"
        resolver.token = "protected-token"
        for error, category in (
            (requests.ReadTimeout("private transport details"), "visual_service_timeout"),
            (requests.ConnectionError("private transport details"), "visual_service_transport_failed"),
        ):
            post.reset_mock()
            post.side_effect = error
            result = resolver.resolve(page=Mock(rect=Mock(width=792, height=612)),
                exception=exception(), context=PROVIDER_CONTEXT)
            self.assertFalse(result.resolved)
            self.assertEqual(result.evidence, {})
            self.assertEqual(result.internal_diagnostics, {"category": category, "outcomeUncertain": True})
            post.assert_called_once()
            self.assertEqual(post.call_args.kwargs["timeout"], (10, 120))

    def test_provider_operation_identity_matches_exact_canonical_contract(self) -> None:
        identity = visual_provider_operation_identity(PROVIDER_CONTEXT, exception())

        self.assertIsNotNone(identity)
        self.assertEqual(
            "3463e7826ece1534148ab7ab4ff09cfe95701dbf28194e271fbf5df51492be25",
            identity["providerOperationId"],
        )
        self.assertEqual(
            visual_exception_fingerprint(exception()),
            identity["visualExceptionFingerprint"],
        )

    def test_provider_operation_identity_rejects_incomplete_or_malformed_claims(self) -> None:
        for key, value in (
            ("organizationId", ""),
            ("sourceSha256", "ABC"),
            ("hostedJobId", "not-a-uuid"),
            ("hostedClaimToken", "not-a-uuid"),
            ("evidenceVersion", ""),
        ):
            with self.subTest(key=key):
                context = {**PROVIDER_CONTEXT, key: value}
                self.assertIsNone(visual_provider_operation_identity(context, exception()))

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
            "legacy schema": provider_payload(schema="ecos-drawing-page-analysis/1.0"),
            "no assurance": provider_payload(assurance_provider=""),
        }
        for label, payload in cases.items():
            with self.subTest(label=label):
                self.assertFalse(validated_visual_resolution(payload, exception()).resolved)

    def test_two_provider_exact_dismissal_resolves_without_creating_evidence(self) -> None:
        target = exception(candidate="[3 '< |")
        payload = {
            **provider_payload(),
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "primaryAcceptedCandidateIndexesValid": True,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexesValid": True,
            "primaryDismissedCandidateIndexes": [0],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [0],
        }

        resolved = validated_visual_resolution(payload, target)

        self.assertTrue(resolved.resolved)
        self.assertEqual("resolved_non_evidentiary", resolved.internal_diagnostics["category"])
        self.assertEqual(VISUAL_DISMISSAL_TYPE, resolved.evidence["resolutionType"])
        self.assertEqual([], resolved.evidence["facts"])
        self.assertEqual(
            target["diagnosticCandidates"],
            resolved.evidence["dismissedDiagnosticCandidates"],
        )
        self.assertIsNotNone(
            validated_persisted_visual_dismissal(resolved.evidence, target)
        )

    def test_one_sided_or_partial_dismissal_remains_unresolved(self) -> None:
        target = exception(candidate="[3 '< |")
        baseline = {
            **provider_payload(),
            "candidateAgreementMethod": "dual_provider_candidate_index_v1",
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "primaryAcceptedCandidateIndexesValid": True,
            "assuranceAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexesValid": True,
            "primaryDismissedCandidateIndexes": [0],
            "primaryDismissedCandidateIndexesValid": True,
            "assuranceDismissedCandidateIndexes": [0],
            "assuranceDismissedCandidateIndexesValid": True,
            "dismissedCandidateIndexes": [0],
        }
        cases = {
            "missing agreement method": {**baseline, "candidateAgreementMethod": None},
            "primary did not validate": {
                **baseline, "primaryDismissedCandidateIndexesValid": False,
            },
            "assurance did not validate": {
                **baseline, "assuranceDismissedCandidateIndexesValid": False,
            },
            "joint dismissal missing": {**baseline, "dismissedCandidateIndexes": []},
            "duplicate dismissal": {**baseline, "dismissedCandidateIndexes": [0, 0]},
        }
        for label, payload in cases.items():
            with self.subTest(label=label):
                self.assertFalse(validated_visual_resolution(payload, target).resolved)

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
            page=Mock(rect=Mock(width=792, height=612)),
            exception=target,
            context={**PROVIDER_CONTEXT, "documentName": "Protected drawing"},
        )

        self.assertTrue(resolved.resolved)
        request_json = post.call_args.kwargs["json"]
        self.assertEqual(VISUAL_SCHEMA_VERSION, request_json["schemaVersion"])
        self.assertEqual(PROVIDER_CONTEXT["organizationId"], request_json["organizationId"])
        self.assertEqual(PROVIDER_CONTEXT["hostedJobId"], request_json["hostedJobId"])
        self.assertRegex(request_json["providerOperationId"], r"^[a-f0-9]{64}$")
        self.assertEqual("page_tiles", request_json["analysisPass"])
        self.assertEqual(BOUNDS, request_json["tileBounds"])
        self.assertEqual(1, len(request_json["tileImages"]))
        self.assertEqual(BOUNDS, request_json["tileImages"][0]["bounds"])
        self.assertEqual(target["regionKey"], request_json["visualException"]["regionKey"])
        self.assertEqual(BOUNDS, request_json["visualException"]["bounds"])
        self.assertEqual(
            target["diagnosticCandidates"][0]["text"],
            request_json["visualException"]["diagnosticCandidates"][0]["text"],
        )


if __name__ == "__main__":
    unittest.main()
