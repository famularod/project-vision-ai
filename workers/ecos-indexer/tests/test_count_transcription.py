import unittest
import copy
from test_visual import exception,provider_payload
from ecos_indexer.visual import validated_visual_resolution,validated_persisted_visual_evidence,visual_exception_fingerprint
from ecos_indexer.count_transcription import COUNT_SOURCE,count_read_exceptions,verified_count_text
from ecos_indexer.labeled_counts import count_label_targets
from ecos_indexer.measurement_correction import AGREEMENT_KEYS

class CountTranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.c={'source':COUNT_SOURCE,'text':'OCC! LOAD:'}
        self.a={'candidateAgreementMethod':'dual_provider_candidate_index_v1',
            **{k:True for k in AGREEMENT_KEYS if k.endswith('Valid')},
            'primaryAcceptedCandidateIndexes':[0],'assuranceAcceptedCandidateIndexes':[0],
            'primaryDismissedCandidateIndexes':[],'assuranceDismissedCandidateIndexes':[]}

    def read(self,text,**changes):
        return verified_count_text({'statement':text,'evidenceText':text},self.c,{**self.a,**changes})

    def test_exact_printed_label_and_integer_only(self):
        self.assertEqual(self.read('OCC. LOAD: 137'),'OCC. LOAD: 137')
        for text in ['137','COUNT: 137','OCC. LOAD: 13O','OCC. LOAD: 137.5',
                     'OCC. LOAD: 137 people','OCC. LOAD: 137 or 138','OCC. LOAD: -137']:
            self.assertIsNone(self.read(text))

    def test_both_readers_must_explicitly_agree(self):
        for key in ['primaryAcceptedCandidateIndexes','assuranceAcceptedCandidateIndexes']:
            for value in [[],[True],[1],[0,1],None]:self.assertIsNone(self.read('OCC. LOAD: 137',**{key:value}))
        for key in AGREEMENT_KEYS:
            if key.endswith('Valid'):self.assertIsNone(self.read('OCC. LOAD: 137',**{key:False}))
        self.assertIsNone(self.read('OCC. LOAD: 137',assuranceDismissedCandidateIndexes=[0]))

    def test_statement_cannot_add_a_conclusion(self):
        self.assertIsNone(verified_count_text({'evidenceText':'OCC. LOAD: 137',
            'statement':'OCC. LOAD: 137 is approved'},self.c,self.a))

    def test_exception_contains_no_guessed_number(self):
        target=count_label_targets([{'text':'COUNT:','x':.2,'y':.3,'width':.03,'height':.005,
            'confidence':.9,'source':'coordinate_ocr'}])
        e=count_read_exceptions(target)[0]
        self.assertEqual(e['diagnosticCandidates'][0]['text'],'COUNT:')
        self.assertEqual(e['diagnosticCandidates'][0]['source'],COUNT_SOURCE)
        self.assertLess(e['bounds']['width'],.07)
        self.assertEqual(count_read_exceptions(target*20).__len__(),2)

    def test_real_worker_validator_and_persisted_proof_roundtrip(self):
        target=exception(candidate='OCC. LOAD:')
        target['diagnosticCandidates'][0]['source']=COUNT_SOURCE
        payload={**provider_payload(statement='OCC. LOAD: 137',evidence_text='OCC. LOAD: 137'),**self.a}
        result=validated_visual_resolution(payload,target)
        self.assertTrue(result.resolved)
        evidence=result.evidence
        evidence.update(evidenceVersion='test/1',exceptionFingerprint=visual_exception_fingerprint(target))
        for fact in evidence['facts']:
            fact.update(evidenceVersion='test/1',exceptionFingerprint=evidence['exceptionFingerprint'])
        self.assertIsNotNone(validated_persisted_visual_evidence(evidence,target))
        corrupted=copy.deepcopy(evidence)
        corrupted['measurementCorrectionAgreement']['assuranceAcceptedCandidateIndexes']=[]
        self.assertIsNone(validated_persisted_visual_evidence(corrupted,target))

    def test_label_read_cannot_be_dismissed_as_a_completed_count(self):
        target=exception(candidate='OCC. LOAD:')
        target['diagnosticCandidates'][0]['source']=COUNT_SOURCE
        payload={**provider_payload(statement='OCC. LOAD: 137',evidence_text='OCC. LOAD: 137'),**self.a}
        payload['facts']=[]
        self.assertFalse(validated_visual_resolution(payload,target).resolved)
