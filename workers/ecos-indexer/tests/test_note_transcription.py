import unittest
from ecos_indexer.note_transcription import note_read_exceptions, NOTE_SOURCE, verified_note_text
from ecos_indexer.measurement_correction import AGREEMENT_KEYS

def line(i,text,y,x=.2,**extra):
    return dict(id=f'visual-tile-test-line-{i}',text=text,x=x,y=y,width=.09,height=.004,
        confidence=.65,source='fixed_visual_tile_coordinate_ocr',**extra)

class NoteTranscriptionTests(unittest.TestCase):
    def test_discovers_original_aligned_block_without_question_or_replacement(self):
        rows=[line(1,'PROVIDE METAL FLASHING',.2),line(2,'AT ALL EXTERIOR OPENINGS',.208)]
        result=note_read_exceptions(rows)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['diagnosticCandidates'][0]['text'],'PROVIDE METAL FLASHING\nAT ALL EXTERIOR OPENINGS')
        self.assertEqual(result[0]['diagnosticCandidates'][0]['source'],NOTE_SOURCE)
        self.assertLess(result[0]['bounds']['height'],.02)

    def test_rejects_words_bad_geometry_and_quarantined_text(self):
        self.assertEqual(note_read_exceptions([line(1,'METAL',.2),line(2,'FLASHING',.208)]),[])
        rows=[line(1,'PROVIDE METAL FLASHING',.2),line(2,'AT ALL OPENINGS',.208,searchable=False)]
        self.assertEqual(note_read_exceptions(rows),[])
        self.assertEqual(note_read_exceptions([{**rows[0],'x':True},rows[1]]),[])

    def test_distant_notes_are_not_merged_and_calls_are_bounded(self):
        self.assertEqual(note_read_exceptions([line(1,'PROVIDE METAL FLASHING',.2),line(2,'AT ALL OPENINGS',.4)]),[])
        rows=[]
        for i in range(10):
            rows.extend([line(i*2,'PROVIDE METAL FLASHING',.1+i*.07),line(i*2+1,'AT ALL EXTERIOR OPENINGS',.108+i*.07)])
        self.assertEqual(len(note_read_exceptions(rows)),6)

    def test_note_text_requires_two_explicit_acceptances(self):
        agreement={'candidateAgreementMethod':'dual_provider_candidate_index_v1',
            **{k:True for k in AGREEMENT_KEYS if k.endswith('Valid')},
            'primaryAcceptedCandidateIndexes':[0],'assuranceAcceptedCandidateIndexes':[0],
            'primaryDismissedCandidateIndexes':[],'assuranceDismissedCandidateIndexes':[]}
        candidate={'source':NOTE_SOURCE,'text':'PROVIDE METAL FLASHING AT ALL OPENINGS'}
        fact={'statement':'PROVIDE METAL FLASHING AT ALL EXTERIOR OPENINGS','evidenceText':'PROVIDE METAL FLASHING AT ALL EXTERIOR OPENINGS'}
        self.assertEqual(verified_note_text(fact,candidate,agreement),fact['statement'])
        for wrong in [[],[True],[1],None]:
            self.assertIsNone(verified_note_text(fact,candidate,{**agreement,'assuranceAcceptedCandidateIndexes':wrong}))
        self.assertIsNone(verified_note_text({**fact,'statement':'Different conclusion'},candidate,agreement))
        self.assertIsNone(verified_note_text({'statement':'OTHER UNRELATED DETAIL','evidenceText':'OTHER UNRELATED DETAIL'},candidate,agreement))
