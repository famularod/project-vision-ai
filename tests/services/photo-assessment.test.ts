import {
  aggregatePhotoAssessments,
  aggregatePhotoDisplayResults,
  derivePhotoAssessmentDisposition,
  derivePhotoAssessmentState,
  photoAssessmentReviewCopy,
  photoDisplayResultHasExplicitFinding,
  photoProjectProgressFromAuthority,
  type PhotoAssessmentInput,
} from '../../services/PhotoAssessment';

function photo(
  overrides: Partial<PhotoAssessmentInput> = {},
): PhotoAssessmentInput {
  return {
    analysisStatus: 'analysis_complete',
    explicitClear: true,
    ...overrides,
  };
}

describe('PhotoAssessment', () => {
  it.each([
    ['supported', 'supported'],
    ['unsupported', 'unsupported'],
    ['blocked', 'unable_to_determine'],
    ['unable_to_determine', 'unable_to_determine'],
    ['', 'unable_to_determine'],
    [null, 'unable_to_determine'],
  ] as const)(
    'uses only validated photo progress authority for %s',
    (disposition, expected) => {
      expect(photoProjectProgressFromAuthority(disposition)).toBe(expected);
    },
  );

  it.each([
    [true, 'no_material_visible_change', 'strong', 0, 'explicit_clear'],
    [true, 'no_material_visible_change', 'probable', 0, 'explicit_clear'],
    [true, 'no_material_visible_change', 'weak', 0, 'indeterminate'],
    [true, 'no_material_visible_change', 'not_comparable', 0, 'indeterminate'],
    [true, 'no_material_visible_change', null, 0, 'indeterminate'],
    [true, 'progress_visible', 'weak', 1, 'finding'],
    [true, 'no_progress_visible', 'strong', 0, 'indeterminate'],
    [false, 'no_material_visible_change', 'strong', 0, 'indeterminate'],
    [true, 'no_material_visible_change', 'strong', -1, 'indeterminate'],
  ] as const)(
    'derives structured disposition for accepted=%s conclusion=%s comparability=%s findings=%s',
    (
      observationAccepted,
      conclusion,
      comparabilityClassification,
      normalizedFindingCount,
      expected,
    ) => {
      expect(derivePhotoAssessmentDisposition({
        observationAccepted,
        conclusion,
        comparabilityClassification,
        normalizedFindingCount,
      })).toBe(expected);
    },
  );

  it.each([
    [{ analysisStatus: null }, 'not_assessed'],
    [{ analysisStatus: 'analyzing' }, 'assessing'],
    [{ analysisStatus: 'no_suitable_prior_photo' }, 'baseline_only'],
    [{ analysisStatus: 'comparison_unavailable' }, 'incomparable'],
    [{ analysisStatus: 'analysis_failed_retry' }, 'failed'],
  ] as const)('derives conservative lifecycle state for %o', (input, expected) => {
    expect(derivePhotoAssessmentState(input)).toBe(expected);
  });

  it('requires a successful result and explicit clear disposition for assessed_clear', () => {
    expect(derivePhotoAssessmentState(photo())).toBe('assessed_clear');
    expect(derivePhotoAssessmentState(photo({
      analysisStatus: 'completed_with_limitations',
    }))).toBe('assessed_clear');
    expect(derivePhotoAssessmentState(photo({
      explicitClear: false,
    }))).toBe('incomparable');
  });

  it('accepts only an explicit structured disposition as a clear result', () => {
    expect(derivePhotoAssessmentState({
      analysisStatus: 'analysis_complete',
      assessmentDisposition: 'explicit_clear',
    })).toBe('assessed_clear');
    expect(derivePhotoAssessmentState({
      analysisStatus: 'analysis_complete',
      assessmentDisposition: 'indeterminate',
      currentObservation: 'No issues were mentioned in generic prose.',
    })).toBe('incomparable');
  });

  it('lets an explicit finding override an inconsistent clear flag', () => {
    expect(derivePhotoAssessmentState(photo({
      hasExplicitFinding: true,
    }))).toBe('assessed_finding');
  });

  it('never treats generic observation prose as a finding or clear result', () => {
    expect(derivePhotoAssessmentState({
      analysisStatus: 'analysis_complete',
      currentObservation: 'The current photo was compared with prior visual evidence.',
    })).toBe('incomparable');
  });

  it('maps display results without promoting generic observation prose', () => {
    expect(photoDisplayResultHasExplicitFinding({
      status: 'analysis_complete',
      currentObservation: 'The current photo was compared with prior visual evidence.',
    })).toBe(false);
    expect(photoDisplayResultHasExplicitFinding({
      status: 'analysis_complete',
      findings: [{ description: 'Visible crack' }],
    })).toBe(true);
    expect(aggregatePhotoDisplayResults([
      { status: 'analysis_complete', assessmentDisposition: 'explicit_clear' },
      { status: 'analyzing', currentObservation: 'Photo queued.' },
    ]).state).toBe('assessing');
  });

  it.each([
    ['assessed_clear', 'No visible safety concern identified in the completed photo review'],
    ['assessed_finding', 'Photo findings require safety concern review'],
    ['assessing', 'Safety review is not complete'],
    ['not_assessed', 'Safety review is not complete'],
    ['baseline_only', 'A baseline photo cannot confirm the absence of a safety concern'],
    ['incomparable', 'The photos could not confirm whether a safety concern is present'],
    ['failed', 'The photos could not confirm whether a safety concern is present'],
  ] as const)('uses conservative safety copy for %s', (state, expected) => {
    expect(photoAssessmentReviewCopy(state, 'safety concern')).toBe(expected);
  });

  it('returns not_assessed when there are no relevant photos', () => {
    const result = aggregatePhotoAssessments([]);

    expect(result.state).toBe('not_assessed');
    expect(result.totalRelevantPhotos).toBe(0);
    expect(result.allRelevantPhotosSuccessfullyAssessed).toBe(false);
    expect(result.allRelevantPhotosExplicitlyClear).toBe(false);
  });

  it('returns clear only when every relevant photo is explicitly clear', () => {
    const clear = aggregatePhotoAssessments([
      photo(),
      photo({ analysisStatus: 'completed_with_limitations' }),
      photo({ relevant: false, analysisStatus: 'analysis_failed_retry' }),
    ]);

    expect(clear.state).toBe('assessed_clear');
    expect(clear.totalRelevantPhotos).toBe(2);
    expect(clear.counts.assessed_clear).toBe(2);
    expect(clear.allRelevantPhotosSuccessfullyAssessed).toBe(true);
    expect(clear.allRelevantPhotosExplicitlyClear).toBe(true);
    expect(clear.hasUnresolvedAssessment).toBe(false);
  });

  it('preserves an explicit finding when all relevant photos finished successfully', () => {
    const result = aggregatePhotoAssessments([
      photo(),
      photo({ explicitClear: false, hasExplicitFinding: true }),
    ]);

    expect(result.state).toBe('assessed_finding');
    expect(result.hasFinding).toBe(true);
    expect(result.allRelevantPhotosSuccessfullyAssessed).toBe(true);
    expect(result.allRelevantPhotosExplicitlyClear).toBe(false);
  });

  it.each([
    ['assessing', photo({ analysisStatus: 'analyzing', explicitClear: false })],
    ['not_assessed', photo({ analysisStatus: null, explicitClear: false })],
    ['baseline_only', photo({ analysisStatus: 'no_suitable_prior_photo', explicitClear: false })],
    ['incomparable', photo({ analysisStatus: 'comparison_unavailable', explicitClear: false })],
    ['failed', photo({ analysisStatus: 'analysis_failed_retry', explicitClear: false })],
  ] as const)(
    'does not return clear when one relevant photo is %s',
    (expected, unresolved) => {
      const result = aggregatePhotoAssessments([photo(), unresolved]);

      expect(result.state).toBe(expected);
      expect(result.allRelevantPhotosSuccessfullyAssessed).toBe(false);
      expect(result.allRelevantPhotosExplicitlyClear).toBe(false);
      expect(result.hasUnresolvedAssessment).toBe(true);
    },
  );

  it('keeps known findings in counts while a more conservative failure state leads', () => {
    const result = aggregatePhotoAssessments([
      photo({ explicitClear: false, hasExplicitFinding: true }),
      photo({ analysisStatus: 'analysis_failed_retry', explicitClear: false }),
    ]);

    expect(result.state).toBe('failed');
    expect(result.hasFinding).toBe(true);
    expect(result.counts.assessed_finding).toBe(1);
    expect(result.counts.failed).toBe(1);
    expect(result.allRelevantPhotosExplicitlyClear).toBe(false);
  });

  it('returns immutable aggregate output', () => {
    const result = aggregatePhotoAssessments([photo()]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.counts)).toBe(true);
  });
});
