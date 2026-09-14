import copy
import unittest
from unittest.mock import Mock
import pymupdf as fitz

from ecos_indexer.plan_dimensions import detect_plan_dimension_reads, derive_verified_plan_dimensions, rectangular_plan_candidates, single_dimension_stroke
from ecos_indexer.visual import VISUAL_SCHEMA_VERSION, visual_exception_fingerprint
from ecos_indexer.extraction import exact_simple_measurement_keys, corrupted_zero_inch_foot_measurements
from ecos_indexer.worker import append_visual_evidence

IDENTITY = dict(project_id="test-project", source_sha256="a"*64, page_number=1,
                evidence_version="ecos-hosted-evidence/1.3")


def fixture():
    doc = fitz.open()
    page = doc.new_page(width=1000, height=1000)
    for line in [(300,200,500,200),(300,600,500,600),(300,200,300,600),
                 (500,200,500,600),(280,200,280,600),(300,620,500,620)]:
        page.draw_line(line[:2], line[2:])
    heading = dict(id="heading", text="ANCHOR ROD PLAN", x=.35, y=.64, width=.1, height=.01)
    def reader(_page, _clip, _w, _h, **kwargs):
        vertical = kwargs["image_rotation_degrees"] == 270
        return [dict(text='40\'-0"' if vertical else '20\'-0"', confidence=.9,
            x=.279 if vertical else .395, y=.395 if vertical else .619,
            width=.002 if vertical else .01, height=.01 if vertical else .002)]
    analysis, targets = detect_plan_dimension_reads(page, [heading], reader,
        **{k:v for k,v in IDENTITY.items() if k != "page_number"})
    doc.close()
    assert analysis is not None
    return analysis


def verified_read(target):
    candidate = target["diagnosticCandidates"][0]
    fp = visual_exception_fingerprint(target)
    epoch = IDENTITY["evidence_version"]
    bounds = candidate["bounds"]
    providers = dict(visionProvider="test-reader", model="test-reader-model",
                     assuranceProvider="test-reviewer", assuranceModel="test-reviewer-model")
    agreement = {"candidateAgreementMethod": "dual_provider_candidate_index_v1"}
    for prefix in ("primary", "assurance"):
        agreement.update({f"{prefix}AcceptedCandidateIndexesValid": True,
            f"{prefix}DismissedCandidateIndexesValid": True,
            f"{prefix}AcceptedCandidateIndexes": [0], f"{prefix}DismissedCandidateIndexes": []})
    fact = dict(statement=candidate["text"], evidenceText=candidate["text"], subject=candidate["text"],
        location="", confidence=.99, bounds=bounds,
        providerBounds={k:round(v*1000) for k,v in bounds.items()},
        evidenceVersion=epoch, exceptionFingerprint=fp, **providers)
    return dict(regionKey=target["regionKey"], evidence=dict(
        schemaVersion=VISUAL_SCHEMA_VERSION, facts=[fact], confidence=.99,
        evidenceText=candidate["text"], evidenceVersion=epoch, exceptionFingerprint=fp,
        measurementCorrectionAgreement=agreement, **providers))


class PlanDimensionTests(unittest.TestCase):
    def test_interrupted_dimension_and_extended_grid_lines_are_supported(self):
        with fitz.open() as doc:
            page = doc.new_page(width=1000, height=1000)
            for line in [(290,200,510,200),(290,600,510,600),(300,190,300,610),(500,190,500,610),
                         (280,200,280,392),(280,408,280,600),(300,620,392,620),(408,620,500,620)]:
                page.draw_line(line[:2],line[2:])
            plans = rectangular_plan_candidates(page)
            self.assertEqual(len(plans), 1)
            self.assertEqual(plans[0]["bounds"], (.3,.2,.5,.6))
        self.assertFalse(single_dimension_stroke({"strokes": [[.2,.28,"a"],[.3,.38,"b"],[.4,.6,"c"]]}))

    def test_garbled_leading_glyph_cannot_silently_become_a_smaller_measurement(self):
        for text in ('g2\'-0"', 'A52\'-0"', 'g2\'-O"'):
            self.assertEqual(exact_simple_measurement_keys(text), set())
            self.assertEqual(corrupted_zero_inch_foot_measurements(text), set())
        self.assertEqual(exact_simple_measurement_keys('WIDTH=82\'-0"'), {"foot-inch:82ft:0in:0/1"})

    def test_detection_does_not_publish_ocr_as_measurements(self):
        analysis = fixture()
        self.assertEqual(len(analysis["targets"]), 2)
        self.assertEqual(derive_verified_plan_dimensions(analysis, **IDENTITY),
                         ([], ["plan_dimension_reads_incomplete"]))

    def test_two_verified_reads_produce_replayable_relationships(self):
        analysis = fixture()
        analysis["reads"] = [verified_read(t) for t in analysis["targets"]]
        regions, errors = derive_verified_plan_dimensions(analysis, **IDENTITY)
        self.assertEqual(errors, [])
        self.assertEqual([r["text"] for r in regions], ['OVERALL WIDTH: 20\'-0"', 'OVERALL LENGTH: 40\'-0"'])
        self.assertTrue(all(r["constituentEvidence"] and r["corroboratingEvidence"] for r in regions))
        self.assertTrue(all(r["evidenceText"] != r["text"] for r in regions))

    def test_verified_relationship_and_visual_facts_cross_explicit_search_boundary(self):
        analysis = fixture()
        result = {"final": {"regions": [], "planDimensionAnalysis": analysis}}
        for target in analysis["targets"]:
            append_visual_evidence(result, target, verified_read(target)["evidence"])
        derived, errors = derive_verified_plan_dimensions(analysis, **IDENTITY)
        self.assertEqual(errors, [])
        all_facts = result["final"]["regions"] + derived
        # The deployed shadow materializer requires JSON boolean true, not
        # merely absence of false. Exercise the producer's actual output.
        self.assertEqual(len(all_facts), 4)
        self.assertTrue(all(r.get("searchable") is True for r in all_facts))

    def test_cross_project_source_page_and_epoch_cannot_reuse_reads(self):
        analysis = fixture()
        analysis["reads"] = [verified_read(t) for t in analysis["targets"]]
        for field, wrong in (("project_id","other"),("source_sha256","b"*64),
                             ("page_number",2),("evidence_version","ecos-hosted-evidence/1.2")):
            with self.subTest(field=field):
                regions, errors = derive_verified_plan_dimensions(analysis, **{**IDENTITY,field:wrong})
                self.assertEqual(regions, [])
                self.assertTrue(errors)

    def test_tampered_read_axis_outline_and_partial_reads_fail_closed(self):
        baseline = fixture()
        baseline["reads"] = [verified_read(t) for t in baseline["targets"]]
        changes = [
            lambda a: a["reads"].pop(),
            lambda a: a["context"]["plan"]["outline"].pop(),
            lambda a: a["targets"][0].update(planAxis="vertical"),
            lambda a: a["reads"][0]["evidence"]["facts"][0].update(evidenceText='30\'-0"'),
            lambda a: a["reads"][0]["evidence"].update(exceptionFingerprint="c"*64),
            lambda a: a["reads"][0]["evidence"].update(assuranceProvider="test-reader"),
        ]
        for change in changes:
            a = copy.deepcopy(baseline)
            change(a)
            regions, errors = derive_verified_plan_dimensions(a, **IDENTITY)
            self.assertEqual(regions, [])
            self.assertTrue(errors)

    def test_no_heading_means_no_rectangle_to_plan_inference(self):
        page, reader = Mock(), Mock()
        self.assertEqual(detect_plan_dimension_reads(page, [], reader,
            project_id="p", source_sha256="a"*64, evidence_version="v"), (None, []))
        reader.assert_not_called()
        page.get_drawings.assert_not_called()


if __name__ == "__main__":
    unittest.main()
