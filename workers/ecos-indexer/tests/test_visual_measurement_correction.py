import copy
import unittest

from test_visual import exception, provider_payload
from ecos_indexer.visual import validated_visual_resolution, validated_persisted_visual_evidence, visual_exception_fingerprint

MARKER = "fixed_visual_tile_measurement_transcription_correction"


def correction_payload(text='82\'-0"'):
    value = provider_payload(statement=text, evidence_text=text)
    value.update({
        "candidateAgreementMethod": "dual_provider_candidate_index_v1",
        "primaryAcceptedCandidateIndexesValid": True,
        "assuranceAcceptedCandidateIndexesValid": True,
        "primaryDismissedCandidateIndexesValid": True,
        "assuranceDismissedCandidateIndexesValid": True,
        "primaryAcceptedCandidateIndexes": [0],
        "assuranceAcceptedCandidateIndexes": [0],
        "primaryDismissedCandidateIndexes": [],
        "assuranceDismissedCandidateIndexes": [],
    })
    return value


class VisualMeasurementCorrectionTests(unittest.TestCase):
    def target(self):
        value = exception(candidate="82'-0")
        value["diagnosticCandidates"][0]["source"] = MARKER
        return value

    def test_dual_verified_transcription_is_preserved_not_replaced_with_damaged_ocr(self):
        target = self.target()
        result = validated_visual_resolution(correction_payload(), target)
        self.assertTrue(result.resolved)
        self.assertEqual(result.evidence["facts"][0]["evidenceText"], '82\'-0"')
        self.assertEqual(result.evidence["facts"][0]["statement"], '82\'-0"')

    def test_persisted_retry_rechecks_correction_attestation_and_keeps_correct_text(self):
        target = self.target()
        evidence = validated_visual_resolution(correction_payload(), target).evidence
        evidence.update(evidenceVersion="test/1", exceptionFingerprint=visual_exception_fingerprint(target))
        for fact in evidence.get("facts", []):
            fact.update(evidenceVersion=evidence["evidenceVersion"], exceptionFingerprint=evidence["exceptionFingerprint"])
        restored = validated_persisted_visual_evidence(evidence, target)
        self.assertIsNotNone(restored)
        self.assertEqual(restored["facts"][0]["evidenceText"], '82\'-0"')
        corrupted = copy.deepcopy(evidence)
        corrupted["measurementCorrectionAgreement"]["assuranceAcceptedCandidateIndexes"] = []
        self.assertIsNone(validated_persisted_visual_evidence(corrupted, target))

    def test_saved_correction_cannot_be_replayed_for_another_exception(self):
        target = self.target()
        evidence = validated_visual_resolution(correction_payload(), target).evidence
        evidence.update(evidenceVersion="test/1", exceptionFingerprint=visual_exception_fingerprint(target))
        for fact in evidence["facts"]:
            fact.update(evidenceVersion=evidence["evidenceVersion"], exceptionFingerprint=evidence["exceptionFingerprint"])
        for change in ("region", "text", "bounds"):
            with self.subTest(change=change):
                other = copy.deepcopy(target)
                if change == "region":
                    other["regionKey"] = "low-confidence-ocr-2"
                elif change == "text":
                    other["diagnosticCandidates"][0]["text"] = "83'-0"
                else:
                    other["bounds"]["width"] += 0.001
                self.assertIsNone(validated_persisted_visual_evidence(evidence, other))

    def test_missing_or_conflicting_attestation_cannot_correct_text(self):
        for key, value in [("candidateAgreementMethod", ""), ("assuranceAcceptedCandidateIndexes", []),
                           ("primaryAcceptedCandidateIndexes", [False]), ("primaryDismissedCandidateIndexes", [0]),
                           ("assuranceAcceptedCandidateIndexesValid", False)]:
            with self.subTest(key=key):
                payload = correction_payload(); payload[key] = value
                self.assertFalse(validated_visual_resolution(payload, self.target()).resolved)

    def test_wrong_value_prose_invalid_inches_and_extra_facts_are_rejected(self):
        for text in ['125\'-0"', '82\'-12"', '82\'-0" overall width', '82\'-0" MAX']:
            with self.subTest(text=text):
                self.assertFalse(validated_visual_resolution(correction_payload(text), self.target()).resolved)
        payload = correction_payload(); payload["facts"] *= 2
        self.assertFalse(validated_visual_resolution(payload, self.target()).resolved)
