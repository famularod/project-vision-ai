import {
  PIE_MULTIMODAL_EVIDENCE_VERSION,
  PIE_VISUAL_POLICY_VERSION,
  type PIEDeterministicPhotoCheckResult,
  type PIEEvidenceCorrection,
  type PIEEvidenceProcessingState,
  type PIEPhotoSemanticComparisonResult,
  type PIEPhotoVisionAnalysis,
  type PIEVisualJarvisValidationResult,
  recordEvidenceCorrection,
  shouldReuseAnalysisCache,
  validatePhotoVisionAnalysis,
  validateSemanticPhotoComparison,
} from './PIEMultimodalEvidence';
import type { PIEQualifiedRealityEvidence } from './PIERealityModelSynchronization';

export type PIEPhotoVisionRequestKind = 'single_photo' | 'photo_pair';

export type PIEPhotoVisionMobileState =
  | 'idle'
  | 'analysis_pending'
  | 'analysis_complete'
  | 'degraded'
  | 'review_required'
  | 'correction_pending'
  | 'accepted'
  | 'rejected';

export type PIEPhotoVisionPipelineRequest = {
  requestId: string;
  kind: PIEPhotoVisionRequestKind;
  organizationId: string;
  projectId: string;
  evidenceId: string;
  baselineEvidenceId?: string | null;
  currentEvidenceId?: string | null;
  deterministicSignature: string;
  analyzerVersion: string;
  policyVersion: string;
  forceReanalysis?: boolean;
};

export type PIEPhotoVisionPipelineResult = {
  requestId: string;
  kind: PIEPhotoVisionRequestKind;
  status: PIEEvidenceProcessingState;
  mobileState: PIEPhotoVisionMobileState;
  providerName: string | null;
  modelName: string | null;
  modelVersion: string | null;
  deterministicMetrics: PIEDeterministicPhotoCheckResult | Record<string, unknown>;
  singlePhotoAnalysis: PIEPhotoVisionAnalysis | null;
  comparisonAnalysis: PIEPhotoSemanticComparisonResult | null;
  jarvisResult: PIEVisualJarvisValidationResult;
  qualifiedRealityEvidence: PIEQualifiedRealityEvidence[];
  failureReason: string | null;
  retryAfterMs: number | null;
  latencyMs: number | null;
  usage: Record<string, unknown>;
};

export type PIEPhotoVisionHydratedState = {
  request: PIEPhotoVisionPipelineRequest;
  result: PIEPhotoVisionPipelineResult | null;
  corrections: PIEEvidenceCorrection[];
  mobileState: PIEPhotoVisionMobileState;
};

export function buildPhotoVisionRequest(input: Omit<
  PIEPhotoVisionPipelineRequest,
  'analyzerVersion' | 'policyVersion'
> & {
  analyzerVersion?: string;
  policyVersion?: string;
}): PIEPhotoVisionPipelineRequest {
  return {
    ...input,
    analyzerVersion: input.analyzerVersion ?? PIE_MULTIMODAL_EVIDENCE_VERSION,
    policyVersion: input.policyVersion ?? PIE_VISUAL_POLICY_VERSION,
  };
}

export function classifyPhotoVisionMobileState(
  result: Pick<PIEPhotoVisionPipelineResult, 'status' | 'jarvisResult' | 'failureReason'> | null,
): PIEPhotoVisionMobileState {
  if (!result) return 'analysis_pending';
  if (result.status === 'queued' || result.status === 'processing' || result.status === 'not_started') {
    return 'analysis_pending';
  }
  if (result.status === 'degraded' || result.status === 'failed') return 'degraded';
  if (!result.jarvisResult.accepted) return 'review_required';
  return 'analysis_complete';
}

export function buildPhotoVisionPipelineResult(input: Omit<
  PIEPhotoVisionPipelineResult,
  'mobileState' | 'jarvisResult' | 'qualifiedRealityEvidence'
> & {
  jarvisResult?: PIEVisualJarvisValidationResult;
  qualifiedRealityEvidence?: PIEQualifiedRealityEvidence[];
}): PIEPhotoVisionPipelineResult {
  const jarvisResult = input.jarvisResult
    ?? (input.comparisonAnalysis
      ? validateSemanticPhotoComparison(input.comparisonAnalysis)
      : input.singlePhotoAnalysis
        ? validatePhotoVisionAnalysis(input.singlePhotoAnalysis)
        : {
            accepted: false,
            outcome: 'blocked' as const,
            rejectedClaims: ['analysis unavailable'],
            warnings: [],
            limitations: [input.failureReason ?? 'Analysis unavailable.'],
          });

  return {
    ...input,
    jarvisResult,
    qualifiedRealityEvidence: input.qualifiedRealityEvidence ?? [],
    mobileState: classifyPhotoVisionMobileState({
      status: input.status,
      jarvisResult,
      failureReason: input.failureReason,
    }),
  };
}

export function shouldRetryPhotoVisionRequest(input: {
  attemptCount: number;
  maxAttempts: number;
  status: PIEEvidenceProcessingState;
  lastFailureReason: string | null;
}): boolean {
  if (input.attemptCount >= input.maxAttempts) return false;
  return input.status === 'failed' || input.status === 'degraded' || input.lastFailureReason === 'provider_timeout';
}

export function buildPhotoVisionRetryDelayMs(attemptCount: number): number {
  return Math.min(30_000, 1000 * Math.max(1, 2 ** attemptCount));
}

export function isPhotoVisionRetryIdempotent(input: {
  contentHash: string;
  cachedContentHash: string | null;
  analyzerVersion?: string;
  cachedAnalyzerVersion: string | null;
  policyVersion?: string;
  cachedPolicyVersion: string | null;
  forceReanalysis?: boolean;
}): boolean {
  return shouldReuseAnalysisCache({
    contentHash: input.contentHash,
    cachedContentHash: input.cachedContentHash,
    analyzerVersion: input.analyzerVersion ?? PIE_MULTIMODAL_EVIDENCE_VERSION,
    cachedAnalyzerVersion: input.cachedAnalyzerVersion,
    policyVersion: input.policyVersion ?? PIE_VISUAL_POLICY_VERSION,
    cachedPolicyVersion: input.cachedPolicyVersion,
    explicitReanalysis: input.forceReanalysis,
  });
}

export function hydratePhotoVisionState(input: {
  request: PIEPhotoVisionPipelineRequest;
  result: PIEPhotoVisionPipelineResult | null;
  corrections?: PIEEvidenceCorrection[];
}): PIEPhotoVisionHydratedState {
  return {
    request: input.request,
    result: input.result,
    corrections: input.corrections ?? [],
    mobileState: input.corrections?.length
      ? 'correction_pending'
      : classifyPhotoVisionMobileState(input.result),
  };
}

export function recordPhotoVisionUserCorrection(input: {
  correctionId: string;
  evidenceId: string;
  organizationId: string;
  projectId: string;
  correctedByUserId: string;
  reason: string;
  originalAnalysisId: string | null;
  correctedObservations: string[];
  correctedInferences: string[];
  supersedesAnalysisId: string | null;
  createdAt: string;
}): PIEEvidenceCorrection {
  return recordEvidenceCorrection(input);
}

export function buildQualifiedVisualEvidenceFromComparison(
  comparison: PIEPhotoSemanticComparisonResult,
): PIEQualifiedRealityEvidence[] {
  const validation = validateSemanticPhotoComparison(comparison);
  if (!validation.accepted || comparison.progressConclusion === 'unable_to_determine') {
    return [];
  }

  return comparison.observations.map((observation, index) => ({
    id: `${comparison.comparisonId}:comparison-observation:${index + 1}`,
    evidenceId: comparison.laterEvidenceId,
    organizationId: comparison.organizationId,
    projectId: comparison.projectId,
    type: 'photo',
    name: observation,
    projectName: comparison.projectId,
    areaName: null,
    location: null,
    status: comparison.progressConclusion === 'possible_regression' ? 'at_risk' : 'needs_verification',
    confidence: comparison.confidence,
    evidenceSummary: observation,
    nextAction: 'Verify this visual comparison against project scope before using it in Executive Judgment.',
    owner: null,
    occurredAt: new Date().toISOString(),
    source: 'production_photo_vision_pipeline',
    evidenceQualified: true as const,
    identityConfidence: comparison.comparable === 'strong_match' ? 'high' : 'medium',
  }));
}
