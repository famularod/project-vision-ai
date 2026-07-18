export type PhotoAssessmentState =
  | 'not_assessed'
  | 'assessing'
  | 'assessed_clear'
  | 'assessed_finding'
  | 'baseline_only'
  | 'incomparable'
  | 'failed';

export type PhotoAnalysisLifecycleStatus =
  | 'analyzing'
  | 'analysis_complete'
  | 'completed_with_limitations'
  | 'comparison_unavailable'
  | 'analysis_failed_retry'
  | 'no_suitable_prior_photo';

export type PhotoAssessmentInput = Readonly<{
  relevant?: boolean;
  analysisStatus?: PhotoAnalysisLifecycleStatus | null;
  explicitClear?: boolean;
  hasExplicitFinding?: boolean;
  /**
   * Display-only prose is deliberately ignored when deciding whether a photo
   * contains a finding. It may be generic text such as "photo compared".
   */
  currentObservation?: string | null;
}>;

export type PhotoAssessmentAggregate = Readonly<{
  state: PhotoAssessmentState;
  totalRelevantPhotos: number;
  counts: Readonly<Record<PhotoAssessmentState, number>>;
  hasFinding: boolean;
  hasUnresolvedAssessment: boolean;
  allRelevantPhotosSuccessfullyAssessed: boolean;
  allRelevantPhotosExplicitlyClear: boolean;
}>;

const SUCCESSFUL_ANALYSIS_STATUSES = new Set<PhotoAnalysisLifecycleStatus>([
  'analysis_complete',
  'completed_with_limitations',
]);

/**
 * Derives one conservative assessment state from explicit analysis outcomes.
 * Generic observation prose never implies a finding or a clear result.
 */
export function derivePhotoAssessmentState(
  input: PhotoAssessmentInput,
): PhotoAssessmentState {
  if (!input.analysisStatus) return 'not_assessed';
  if (input.analysisStatus === 'analyzing') return 'assessing';
  if (input.analysisStatus === 'no_suitable_prior_photo') return 'baseline_only';
  if (input.analysisStatus === 'comparison_unavailable') return 'incomparable';
  if (input.analysisStatus === 'analysis_failed_retry') return 'failed';

  if (SUCCESSFUL_ANALYSIS_STATUSES.has(input.analysisStatus)) {
    if (input.hasExplicitFinding === true) return 'assessed_finding';
    if (input.explicitClear === true) return 'assessed_clear';

    // A completed provider call without an explicit finding/clear disposition
    // is not enough evidence to assure the user that the photo is clear.
    return 'incomparable';
  }

  return 'failed';
}

/**
 * Aggregates only relevant photos. Blocking or incomplete states take
 * precedence over successful states, while counts preserve any known finding.
 * Clear is returned only when every relevant photo is explicitly clear.
 */
export function aggregatePhotoAssessments(
  photos: readonly PhotoAssessmentInput[],
): PhotoAssessmentAggregate {
  const states = photos
    .filter(photo => photo.relevant !== false)
    .map(derivePhotoAssessmentState);

  return aggregatePhotoAssessmentStates(states);
}

export function aggregatePhotoAssessmentStates(
  states: readonly PhotoAssessmentState[],
): PhotoAssessmentAggregate {
  const counts: Record<PhotoAssessmentState, number> = {
    not_assessed: 0,
    assessing: 0,
    assessed_clear: 0,
    assessed_finding: 0,
    baseline_only: 0,
    incomparable: 0,
    failed: 0,
  };

  states.forEach(state => {
    counts[state] += 1;
  });

  const totalRelevantPhotos = states.length;
  const hasFinding = counts.assessed_finding > 0;
  const hasUnresolvedAssessment =
    counts.not_assessed > 0 ||
    counts.assessing > 0 ||
    counts.baseline_only > 0 ||
    counts.incomparable > 0 ||
    counts.failed > 0;
  const allRelevantPhotosSuccessfullyAssessed =
    totalRelevantPhotos > 0 &&
    counts.assessed_clear + counts.assessed_finding === totalRelevantPhotos;
  const allRelevantPhotosExplicitlyClear =
    totalRelevantPhotos > 0 &&
    counts.assessed_clear === totalRelevantPhotos;

  return Object.freeze({
    state: aggregateState(counts, totalRelevantPhotos),
    totalRelevantPhotos,
    counts: Object.freeze(counts),
    hasFinding,
    hasUnresolvedAssessment,
    allRelevantPhotosSuccessfullyAssessed,
    allRelevantPhotosExplicitlyClear,
  });
}

function aggregateState(
  counts: Readonly<Record<PhotoAssessmentState, number>>,
  totalRelevantPhotos: number,
): PhotoAssessmentState {
  if (totalRelevantPhotos === 0) return 'not_assessed';
  if (counts.failed > 0) return 'failed';
  if (counts.incomparable > 0) return 'incomparable';
  if (counts.baseline_only > 0) return 'baseline_only';
  if (counts.not_assessed > 0) return 'not_assessed';
  if (counts.assessing > 0) return 'assessing';
  if (counts.assessed_finding > 0) return 'assessed_finding';
  if (counts.assessed_clear === totalRelevantPhotos) return 'assessed_clear';

  return 'incomparable';
}
