export type VisionAuthorityMode = 'single_photo' | 'photo_pair';

type SpatialFinding = {
  normalizedObjectName?: unknown;
  rawObjectDescription?: unknown;
  findingType?: unknown;
  locationConfidence?: unknown;
  imageHorizontalRegion?: unknown;
  surfaceOrArea?: unknown;
  normalizationReasons?: unknown;
  rawLocationText?: unknown;
};

export function validateVisionAuthority(
  mode: VisionAuthorityMode,
  normalized: Record<string, unknown> | null,
) {
  const observationReasons: string[] = [];
  const progressReasons: string[] = [];
  const authorityBoundaryReasons: string[] = [];
  const rejectedClaims: string[] = [];
  const warnings: string[] = [];
  if (!normalized) observationReasons.push('provider output missing or malformed');
  if (normalized && stringArray(normalized.limitations).length === 0) {
    warnings.push('limitations not supplied by provider');
  }
  for (const reason of stringArray(normalized?.comparabilityNormalizationReasons)) {
    warnings.push(reason);
  }
  const claims = JSON.stringify(normalized ?? {}).toLowerCase();
  for (const unsafe of [
    'fully compliant',
    'passed inspection',
    'caused by',
    'responsible for',
    '100% complete',
    'percent complete',
    'hidden work',
    'cost impact',
    'schedule impact',
    'milestone complete',
  ]) {
    if (claims.includes(unsafe)) observationReasons.push(`unsafe visual claim: ${unsafe}`);
  }

  let pairConclusion = '';
  if (mode === 'photo_pair' && normalized) {
    const comparable = normalized.comparabilityClassification;
    pairConclusion = String(normalized.conclusion);
    if (
      (comparable === 'weak' || comparable === 'not_comparable') &&
      ['progress_visible', 'partial_progress_visible', 'possible_regression'].includes(pairConclusion)
    ) {
      progressReasons.push('weak or not-comparable images cannot support progress conclusion');
    }
    for (const finding of spatialFindings(normalized.normalizedSpatialFindings)) {
      const objectName = stringValue(
        finding.normalizedObjectName || finding.rawObjectDescription || finding.findingType,
      );
      if (objectName) observationReasons.push(`${objectName} visibly observed`);
      if (finding.locationConfidence === 'high' || finding.locationConfidence === 'medium') {
        const locationParts = [
          finding.imageHorizontalRegion !== 'unknown' ? finding.imageHorizontalRegion : '',
          finding.surfaceOrArea !== 'unknown' ? finding.surfaceOrArea : '',
        ].filter(Boolean).join(' ');
        observationReasons.push(
          locationParts ? `location supported as ${locationParts}` : 'location reasonably supported',
        );
      }
      for (const reason of stringArray(finding.normalizationReasons)) {
        if (reason.includes('spatial location normalized from provider text')) warnings.push(reason);
      }
      if (finding.locationConfidence === 'low' && stringValue(finding.rawLocationText)) {
        warnings.push(
          `low confidence spatial location for ${stringValue(
            finding.normalizedObjectName || finding.findingType,
          )}`,
        );
      }
    }
    if (stringValue(normalized.viewpointAssessment)) {
      observationReasons.push(
        `viewpoint/framing limitation disclosed: ${stringValue(normalized.viewpointAssessment)}`,
      );
    }
  }

  const blockingObservationReasons = observationReasons.filter(reason =>
    reason.includes('provider output missing or malformed') ||
    reason.includes('unsafe visual claim') ||
    reason.includes('location confidence insufficient') ||
    reason.includes('unsupported') ||
    reason.includes('conflict')
  );

  let progressDisposition = 'unable_to_determine';
  let progressAccepted = false;
  if (mode === 'photo_pair' && normalized) {
    if (['progress_visible', 'partial_progress_visible', 'possible_regression'].includes(pairConclusion)) {
      progressAccepted = progressReasons.length === 0 && blockingObservationReasons.length === 0;
      progressDisposition = progressAccepted ? 'supported' : 'blocked';
    } else if (pairConclusion === 'unable_to_determine') {
      progressDisposition = 'unable_to_determine';
      progressReasons.push('visual observation does not establish project progress');
    } else {
      progressDisposition = 'unsupported';
      progressReasons.push('no material visible project progress conclusion');
    }
  } else if (mode === 'single_photo' && normalized) {
    progressDisposition = 'unable_to_determine';
    progressReasons.push('single-photo analysis is visual observation only');
  }

  let realityDisposition = 'not_eligible';
  let realityEligible = false;
  const observationAccepted = blockingObservationReasons.length === 0 && Boolean(normalized);
  const observationDisposition = observationAccepted
    ? warnings.length > 0 || stringArray(normalized?.limitations).length > 0
      ? 'accepted_with_limitations'
      : 'accepted'
    : normalized
      ? 'rejected'
      : 'quarantined';
  if (observationAccepted) {
    realityEligible = true;
    realityDisposition = 'eligible_as_observation';
    authorityBoundaryReasons.push(
      progressAccepted
        ? 'progress-supporting visual evidence still requires normal downstream authority checks'
        : 'accepted as limited visual observation only; no authoritative project-progress assertion',
    );
  } else if (normalized) {
    realityDisposition = 'evidence_request_only';
    authorityBoundaryReasons.push('observation rejected or unsafe; request corroborating evidence');
  } else {
    authorityBoundaryReasons.push('provider output unavailable or malformed');
  }
  rejectedClaims.push(
    ...blockingObservationReasons,
    ...progressReasons.filter(reason => reason.includes('cannot support')),
  );
  return {
    accepted: observationAccepted,
    outcome: observationAccepted ? 'supported_with_limitations' : 'blocked',
    observationDisposition,
    observationAccepted,
    observationReasons,
    progressDisposition,
    progressAccepted,
    progressReasons,
    realityDisposition,
    realityEligible,
    authorityBoundaryReasons,
    authoritativeProgressAssertionCount: progressAccepted ? 1 : 0,
    rejectedClaims,
    warnings,
    limitations: normalized ? stringArray(normalized.limitations) : ['Provider output unavailable.'],
  };
}

function spatialFindings(value: unknown): SpatialFinding[] {
  return Array.isArray(value)
    ? value.filter((item): item is SpatialFinding => Boolean(item && typeof item === 'object'))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
