import {
  constructionMeasurementConflictsWithExtractedText,
  subjectMeasurementTokens,
} from '../../supabase/functions/_shared/ecos-drawing-measurement-assurance';

describe('ECOS drawing measurement assurance', () => {
  const flattenedC6Text = [
    'CONSTRUCTION NOTES',
    'CONSTRUCT 6.0" THICK PCC PAVING',
    'CONSTRUCT 4" THICK PCC WALKWAY — SEE ARCHITECTURAL DRAWINGS FOR FINISHES',
    'CONSTRUCT 6" BATTERLESS CURB — SEE DETAIL 8',
    'CONSTRUCT 4" SEWER LATERAL AND CLEANOUT PER RIVERSIDE CITY STANDARD 562.',
    'MATERIAL PER MECHANICAL DRAWINGS.',
  ].join(' ');

  it('extracts measurements by construction subject from flattened OCR text', () => {
    expect(subjectMeasurementTokens('pcc_walkway', flattenedC6Text)).toEqual(['4:inches']);
    expect(subjectMeasurementTokens('sewer_lateral', flattenedC6Text)).toEqual(['4:inches']);
    expect(subjectMeasurementTokens('pcc_paving', flattenedC6Text)).toEqual(['6:inches']);
  });

  it('rejects a visually proposed walkway measurement that contradicts OCR', () => {
    expect(constructionMeasurementConflictsWithExtractedText({
      subject: 'PCC walkways thickness',
      statement: 'CONSTRUCT 5" THICK PCC WALKWAY — SEE ARCHITECTURAL',
      evidenceText: 'CONSTRUCT 5" THICK PCC WALKWAY — SEE ARCHITECTURAL',
    }, flattenedC6Text)).toBe(true);
  });

  it('rejects a visually proposed sewer measurement that contradicts OCR', () => {
    expect(constructionMeasurementConflictsWithExtractedText({
      subject: 'Sewer lateral and cleanout city standard',
      statement: '6" PVC SEWER LATERAL AND CLEANOUT PER RIVERSIDE STANDARD 562',
      evidenceText: '6" PVC SEWER LATERAL AND CLEANOUT PER RIVERSIDE STANDARD 562',
    }, flattenedC6Text)).toBe(true);
  });

  it('accepts measurements that agree with the extracted construction notes', () => {
    expect(constructionMeasurementConflictsWithExtractedText({
      subject: 'PCC walkway',
      statement: 'CONSTRUCT 4" THICK PCC WALKWAY',
      evidenceText: 'CONSTRUCT 4" THICK PCC WALKWAY',
    }, flattenedC6Text)).toBe(false);
    expect(constructionMeasurementConflictsWithExtractedText({
      subject: 'PCC paving',
      statement: 'CONSTRUCT 6.0" THICK PCC PAVING',
      evidenceText: 'CONSTRUCT 6.0" THICK PCC PAVING',
    }, flattenedC6Text)).toBe(false);
  });
});
