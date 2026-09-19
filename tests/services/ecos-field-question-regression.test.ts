import {
  analyzeECOSProjectQuestion,
  buildECOSDrawingMeasurementFallback,
  buildECOSInstalledDesignFallback,
  ecosEvidenceMatchesQuestionRequirement,
  ecosEvidenceQuestionContextScore,
  ecosFactAnswersQuestion,
  sanitizeECOSAnswerStatement,
} from '../../supabase/functions/_shared/ecos-project-answer-policy';

const thicknessQuestion = 'How thick is the new concrete that was poured on the north side of 2375?';
const northLotPage = [
  '2375 THIRD STREET',
  'PRECISE GRADING PLAN — NORTH LOT PLAN — SHEET C6',
  'CONSTRUCTION NOTE 1: CONSTRUCT 6.0\" THICK PCC PAVING',
  'CONSTRUCTION NOTE 14: CONSTRUCT 4\" THICK PCC WALKWAY — SEE ARCHITECTURAL',
  'ECOS VISUAL DRAWING FACT. Subject: PCC paving. Location: North Lot construction notes. Fact: The plan specifies construction of 6.0-inch-thick PCC paving. Visible evidence: CONSTRUCT 6.0\" THICK PCC PAVING',
  'ECOS VISUAL DRAWING FACT. Subject: PCC walkway. Location: North Lot construction notes. Fact: A 4-inch-thick PCC walkway is specified. Visible evidence: CONSTRUCT 4\" THICK PCC WALKWAY',
].join('\n');
const unrelatedTask = 'Task: Make water shutoff cover flush with cement. Location: 2375 North Side. Status: Complete. Percent complete: 100.';
const canopyQuestion = 'Do the canopies at 2375 have lighting?';
const ambiguousUpdate = 'Field updates for Canopies A, B, and C state that a flooring change indicated either a lighting difference or a material difference at the entrance.';
const canopyDrawing = 'ECOS VISUAL DRAWING FACT. Subject: Canopies A, B, and C. Location: 2375 exterior storage areas. Fact: The electrical plan shows lighting fixtures within each canopy. Visible evidence: EXTERIOR STORAGE AREAS 1, 2, 3 LIGHTING PLAN; FIXTURE TYPE 24 SHOWN.';
const actualCanopyQuestion = 'Are lights scheduled to be installed in the canopies at 2375?';
const actualSlabQuestion = 'About how many inches is the new concrete slab on the north side of 2375?';

describe('ECOS field-question regression acceptance', () => {
  it.each(Array.from({ length: 20 }, (_, index) => index + 1))(
    'passes the real 2375 evidence and rejection set — clean cycle %i',
    () => {
      expect(analyzeECOSProjectQuestion(thicknessQuestion)).toMatchObject({
        kind: 'measurement',
        attribute: 'thickness',
      });
      expect(ecosFactAnswersQuestion({
        question: thicknessQuestion,
        statement: 'The current C6 North Lot drawing specifies 6.0-inch-thick PCC paving. The drawing does not field-verify the installed thickness.',
        sourceExcerpts: [northLotPage],
      })).toBe(true);
      expect(buildECOSInstalledDesignFallback(thicknessQuestion, [{
        id: 'document:c6',
        sourceType: 'document',
        excerpt: northLotPage,
      }])).toEqual({
        statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving, and separately a 4-inch-thick PCC walkway. The drawing does not field-verify the actual installed condition.',
        sourceIds: ['document:c6'],
      });
      expect(buildECOSDrawingMeasurementFallback(
        'How many inches thick is the PCC paving at the 2375 north lot?',
        [{
          id: 'document:c6',
          sourceType: 'document',
          title: '02A - 2375 CIVIL, Sheet C6, Rev 1',
          excerpt: northLotPage,
        }],
      )).toEqual({
        statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving.',
        sourceIds: ['document:c6'],
      });
      expect(buildECOSDrawingMeasurementFallback(
        'What thickness does C6 specify for north lot PCC paving?',
        [{
          id: 'document:c6',
          sourceType: 'document',
          title: '02A - 2375 CIVIL, Sheet C6, Rev 1',
          excerpt: northLotPage,
        }],
      )).toEqual({
        statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving.',
        sourceIds: ['document:c6'],
      });
      expect(ecosEvidenceMatchesQuestionRequirement(thicknessQuestion, unrelatedTask)).toBe(false);
      expect(ecosEvidenceQuestionContextScore(thicknessQuestion, northLotPage))
        .toBeGreaterThan(ecosEvidenceQuestionContextScore(
          thicknessQuestion,
          'CONSTRUCT 4\" THICK PCC WALKWAY — SEE ARCHITECTURAL',
        ));

      expect(analyzeECOSProjectQuestion(canopyQuestion)).toMatchObject({
        kind: 'presence',
        attribute: 'lighting',
      });
      expect(ecosEvidenceMatchesQuestionRequirement(canopyQuestion, ambiguousUpdate)).toBe(false);
      expect(ecosFactAnswersQuestion({
        question: canopyQuestion,
        statement: 'The current electrical plan shows lighting fixtures within Canopies A, B, and C.',
        sourceExcerpts: [canopyDrawing],
      })).toBe(true);
      expect(sanitizeECOSAnswerStatement(
        'The canopies have lighting. [update:mrcu2abk-63b55h5l] [document:drawing-1:4:vision-2]',
      )).toBe('The canopies have lighting.');

      expect(analyzeECOSProjectQuestion(actualCanopyQuestion)).toMatchObject({
        kind: 'presence',
        attribute: 'lighting',
      });
      expect(ecosFactAnswersQuestion({
        question: actualCanopyQuestion,
        statement: 'The current electrical plan shows lighting fixtures within the exterior storage areas corresponding to the canopies.',
        sourceExcerpts: [canopyDrawing],
      })).toBe(true);
      expect(analyzeECOSProjectQuestion(actualSlabQuestion)).toMatchObject({
        kind: 'measurement',
        attribute: 'thickness',
      });
      expect(buildECOSDrawingMeasurementFallback(actualSlabQuestion, [{
        id: 'document:c6',
        sourceType: 'document',
        title: '02A - 2375 CIVIL, Sheet C6, Rev 1',
        excerpt: northLotPage,
      }])).toEqual({
        statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving.',
        sourceIds: ['document:c6'],
      });
    },
  );
});
