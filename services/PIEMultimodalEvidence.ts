import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import type { PIEQualifiedRealityEvidence } from './PIERealityModelSynchronization';

export const PIE_MULTIMODAL_EVIDENCE_VERSION = '2026.07.02-foundation';
export const PIE_VISUAL_POLICY_VERSION = '2026.07.02-visual-jarvis';

export type PIEEvidenceType =
  | 'photo'
  | 'drawing'
  | 'schedule'
  | 'contract'
  | 'inspection_report'
  | 'email'
  | 'meeting_note'
  | 'cost_report'
  | 'equipment_reading'
  | 'oee_feed'
  | 'field_measurement';

export type PIEEvidenceAuthority =
  | 'authoritative'
  | 'corroborating'
  | 'supporting'
  | 'weak'
  | 'unverified'
  | 'superseded';

export type PIEEvidenceProcessingState =
  | 'not_started'
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'degraded'
  | 'failed'
  | 'blocked';

export type PIEAnalysisAuthority =
  | 'visual_observation_only'
  | 'document_extraction'
  | 'reported_claim'
  | 'authoritative_record'
  | 'human_correction';

export type PIEStorageVariant = 'original' | 'analysis_derivative' | 'thumbnail';

export type PIEStorageReference = {
  bucket: string;
  path: string;
  variant: PIEStorageVariant;
  mimeType: string;
  sizeBytes: number | null;
};

export type PIEEvidenceLineage = {
  parentEvidenceIds: string[];
  derivedEvidenceIds: string[];
  analyzerRunIds: string[];
  correctionIds: string[];
};

export type PIEEvidenceAssociation = {
  type: 'reality_object' | 'decision' | 'schedule_item' | 'location' | 'work_package' | 'user';
  id: string;
  role: string;
};

export type PIEEvidenceRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  evidenceType: PIEEvidenceType;
  source: string;
  sourceSystem: string;
  capturedAt: string | null;
  effectiveAt: string | null;
  receivedAt: string;
  authorId: string | null;
  storage: PIEStorageReference[];
  contentHash: string;
  mimeType: string;
  version: number;
  authority: PIEEvidenceAuthority;
  processingState: PIEEvidenceProcessingState;
  analyzerId: string | null;
  analyzerVersion: string | null;
  lineage: PIEEvidenceLineage;
  supersededByEvidenceId: string | null;
  associations: PIEEvidenceAssociation[];
  relatedEvidenceIds: string[];
};

export type PIEExtractedMeasurement = {
  name: string;
  value: number | null;
  unit: string | null;
  evidenceText: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEStructuredEvidenceAnalysis = {
  analysisId: string;
  evidenceId: string;
  evidenceType: PIEEvidenceType;
  organizationId: string;
  projectId: string;
  analyzerId: string;
  analyzerVersion: string;
  modelName: string | null;
  modelVersion: string | null;
  observations: string[];
  inferences: string[];
  extractedEntities: string[];
  dates: string[];
  commitments: string[];
  owners: string[];
  measurements: PIEExtractedMeasurement[];
  risks: string[];
  conflicts: string[];
  missingInformation: string[];
  confidence: ProjectConfidenceLevel;
  limitations: string[];
  authority: PIEAnalysisAuthority;
  corroborationRequired: boolean;
  sourceEvidenceIds: string[];
  generatedAt: string;
};

export type PIEVisualFinding = {
  label: string;
  observation: string;
  region: string | null;
  confidence: ProjectConfidenceLevel;
  limitations: string[];
};

export type PIEPhotoVisionAnalysis = PIEStructuredEvidenceAnalysis & {
  evidenceType: 'photo';
  authority: 'visual_observation_only';
  visualFindings: PIEVisualFinding[];
  visibleProgress: 'none_visible' | 'some_visible' | 'clear_visible' | 'uncertain';
  unsafeClaimsRejected: string[];
};

export type PIEPhotoComparisonAnalysis = {
  comparisonId: string;
  organizationId: string;
  projectId: string;
  earlierEvidenceId: string;
  laterEvidenceId: string;
  comparable: 'strong_match' | 'probable_match' | 'weak_match' | 'not_comparable';
  observations: string[];
  inferredChanges: string[];
  deterministicChecks: PIEDeterministicPhotoCheckResult;
  confidence: ProjectConfidenceLevel;
  limitations: string[];
  requiresHumanReview: boolean;
};

export type PIEPhotoVisibleChangeType =
  | 'object_added'
  | 'object_removed'
  | 'object_moved'
  | 'condition_changed'
  | 'lighting_or_viewpoint_changed'
  | 'no_material_change'
  | 'unable_to_determine';

export type PIEPhotoSemanticComparisonResult = PIEPhotoComparisonAnalysis & {
  sameGeneralScene: boolean;
  materialVisibleChange: boolean;
  changeType: PIEPhotoVisibleChangeType;
  addedObject: string | null;
  removedObject: string | null;
  approximateRegion: string | null;
  progressConclusion:
    | 'progress_visible'
    | 'partial_progress_visible'
    | 'no_material_visible_change'
    | 'possible_regression'
    | 'no_progress_visible'
    | 'unable_to_determine';
  projectStatusImpact: 'none' | 'possible' | 'requires_scope_link';
  userFacingSummary: string;
};

export type PIEProductionSinglePhotoFindings = {
  scene: string;
  probableProjectArea: string | null;
  visibleSubjects: string[];
  equipment: string[];
  materials: string[];
  visibleWork: string[];
  installationState: string | null;
  visibleConditions: string[];
  possibleQualityConcerns: string[];
  possibleSafetyConcerns: string[];
  imageQuality: {
    lighting: ProjectConfidenceLevel;
    focus: ProjectConfidenceLevel;
    obstruction: ProjectConfidenceLevel;
    framing: ProjectConfidenceLevel;
  };
  directObservations: string[];
  inferences: string[];
  confidence: ProjectConfidenceLevel;
  limitations: string[];
  requiredCorroboration: string[];
  recommendedFollowUpEvidence: string[];
};

export type PIEProductionPhotoPairFindings = {
  sameSceneProbability: number;
  sameSubjectProbability: number;
  viewpointAssessment: string;
  lightingDifferences: string[];
  obstructionDifferences: string[];
  objectAdditions: Array<{ object: string; location: string; confidence: ProjectConfidenceLevel }>;
  objectRemovals: Array<{ object: string; location: string; confidence: ProjectConfidenceLevel }>;
  materialOrStructuralChanges: string[];
  unchangedConditions: string[];
  possibleRegression: string[];
  visibleConcerns: string[];
  comparabilityClassification: 'strong' | 'probable' | 'weak' | 'not_comparable';
  conclusion:
    | 'progress_visible'
    | 'partial_progress_visible'
    | 'no_material_visible_change'
    | 'possible_regression'
    | 'unable_to_determine';
  confidence: ProjectConfidenceLevel;
  limitations: string[];
  repeatPhotoGuidance: string[];
};

export type PIEPhotoAssetMetadata = {
  evidenceId: string;
  organizationId: string;
  projectId: string;
  originalStoragePath: string;
  analysisDerivativePath: string | null;
  thumbnailPath: string | null;
  contentHash: string;
  duplicateOfEvidenceId: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: number | null;
  captureSource: 'camera' | 'library' | 'upload' | 'import';
  capturedAt: string | null;
  exif: Record<string, unknown>;
  analysisStatus: PIEEvidenceProcessingState;
  currentAnalysisVersion: string | null;
};

export type PIEDeterministicPhotoCheckInput = {
  contentHash: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: number | null;
  perceptualHash?: string | null;
  orientation?: number | null;
};

export type PIEDeterministicPhotoCheckResult = {
  duplicateKey: string;
  mimeTypeAccepted: boolean;
  hasUsableDimensions: boolean;
  likelyBlankOrTiny: boolean;
  orientationKnown: boolean;
  perceptualHashPresent: boolean;
  warnings: string[];
};

export type PIEVisualJarvisValidationResult = {
  accepted: boolean;
  outcome:
    | 'supported'
    | 'supported_with_limitations'
    | 'needs_corroborating_evidence'
    | 'human_review_required'
    | 'blocked';
  rejectedClaims: string[];
  warnings: string[];
  limitations: string[];
};

export type PIEEvidenceCorrection = {
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
};

export type PIEPhotoVisionProviderRequest = {
  organizationId: string;
  projectId: string;
  evidenceId: string;
  storagePath: string;
  promptVersion: string;
  policyVersion: string;
};

export type PIEPhotoVisionProviderResult = {
  status: PIEEvidenceProcessingState;
  analysis: PIEPhotoVisionAnalysis | null;
  providerName: string | null;
  modelName: string | null;
  modelVersion: string | null;
  usage: Record<string, unknown>;
  error: string | null;
};

type EvidenceRecordInput = Omit<
  PIEEvidenceRecord,
  'version' | 'processingState' | 'lineage' | 'supersededByEvidenceId' | 'associations' | 'relatedEvidenceIds'
> & {
  version?: number;
  processingState?: PIEEvidenceProcessingState;
  lineage?: Partial<PIEEvidenceLineage>;
  supersededByEvidenceId?: string | null;
  associations?: PIEEvidenceAssociation[];
  relatedEvidenceIds?: string[];
};

export function buildEvidenceRecord(input: EvidenceRecordInput): PIEEvidenceRecord {
  return {
    ...input,
    version: input.version ?? 1,
    processingState: input.processingState ?? 'queued',
    lineage: {
      parentEvidenceIds: input.lineage?.parentEvidenceIds ?? [],
      derivedEvidenceIds: input.lineage?.derivedEvidenceIds ?? [],
      analyzerRunIds: input.lineage?.analyzerRunIds ?? [],
      correctionIds: input.lineage?.correctionIds ?? [],
    },
    supersededByEvidenceId: input.supersededByEvidenceId ?? null,
    associations: input.associations ?? [],
    relatedEvidenceIds: input.relatedEvidenceIds ?? [],
  };
}

export function buildPhotoStoragePath(input: {
  organizationId: string;
  projectId: string;
  evidenceId: string;
  variant: PIEStorageVariant;
  extension: string;
}): string {
  const extension = input.extension.replace(/^\./, '').toLowerCase() || 'bin';
  const sanitizedEvidenceId = sanitizePathSegment(input.evidenceId);
  return [
    sanitizePathSegment(input.organizationId),
    sanitizePathSegment(input.projectId),
    'photo',
    sanitizedEvidenceId,
    `${input.variant}.${extension}`,
  ].join('/');
}

export function buildPhotoEvidenceRecord(input: {
  id: string;
  organizationId: string;
  projectId: string;
  source: string;
  sourceSystem: string;
  capturedAt: string | null;
  receivedAt: string;
  authorId: string | null;
  bucket: string;
  mimeType: string;
  sizeBytes: number | null;
  contentHash: string;
  fileExtension: string;
  associations?: PIEEvidenceAssociation[];
}): PIEEvidenceRecord {
  const path = buildPhotoStoragePath({
    organizationId: input.organizationId,
    projectId: input.projectId,
    evidenceId: input.id,
    variant: 'original',
    extension: input.fileExtension,
  });
  return buildEvidenceRecord({
    id: input.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    evidenceType: 'photo',
    source: input.source,
    sourceSystem: input.sourceSystem,
    capturedAt: input.capturedAt,
    effectiveAt: input.capturedAt,
    receivedAt: input.receivedAt,
    authorId: input.authorId,
    storage: [{
      bucket: input.bucket,
      path,
      variant: 'original',
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    }],
    contentHash: input.contentHash,
    mimeType: input.mimeType,
    authority: 'supporting',
    analyzerId: null,
    analyzerVersion: null,
    associations: input.associations ?? [],
  });
}

export function stableContentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function validateStructuredEvidenceAnalysis(
  analysis: PIEStructuredEvidenceAnalysis,
): PIEVisualJarvisValidationResult {
  const warnings: string[] = [];
  const rejectedClaims: string[] = [];

  if (analysis.organizationId.length === 0 || analysis.projectId.length === 0) {
    rejectedClaims.push('analysis must preserve organization and project identity');
  }
  if (analysis.observations.length === 0) {
    rejectedClaims.push('analysis must include explicit observations');
  }
  if (analysis.limitations.length === 0) {
    rejectedClaims.push('analysis must include limitations');
  }
  if (analysis.inferences.some(assertsTruthWithoutSupport)) {
    rejectedClaims.push('inferences cannot be presented as authoritative truth');
  }
  if (analysis.confidence === 'high' && analysis.corroborationRequired && analysis.authority !== 'authoritative_record') {
    warnings.push('high confidence analysis still requires corroboration');
  }

  return buildJarvisResult(rejectedClaims, warnings, analysis.limitations);
}

export function validatePhotoVisionAnalysis(
  analysis: PIEPhotoVisionAnalysis,
): PIEVisualJarvisValidationResult {
  const base = validateStructuredEvidenceAnalysis(analysis);
  const rejectedClaims = [...base.rejectedClaims, ...analysis.unsafeClaimsRejected];
  const warnings = [...base.warnings];

  if (analysis.authority !== 'visual_observation_only') {
    rejectedClaims.push('photo analysis authority must remain visual_observation_only');
  }
  if (analysis.visualFindings.length === 0) {
    rejectedClaims.push('raw-pixel photo analysis must include visual findings');
  }
  const allClaims = [
    ...analysis.observations,
    ...analysis.inferences,
    ...analysis.risks,
    ...analysis.visualFindings.map(finding => finding.observation),
  ];
  rejectedClaims.push(...findUnsafeVisualClaims(allClaims));

  return buildJarvisResult(dedupe(rejectedClaims), warnings, analysis.limitations);
}

export function deterministicPhotoChecks(
  input: PIEDeterministicPhotoCheckInput,
): PIEDeterministicPhotoCheckResult {
  const mimeTypeAccepted = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp'].includes(
    input.mimeType.toLowerCase(),
  );
  const hasUsableDimensions = (input.width ?? 0) >= 320 && (input.height ?? 0) >= 320;
  const likelyBlankOrTiny = (input.sizeBytes ?? 0) > 0 && (input.sizeBytes ?? 0) < 4096;
  const orientationKnown = input.orientation !== undefined && input.orientation !== null;
  const perceptualHashPresent = Boolean(input.perceptualHash);
  const warnings: string[] = [];

  if (!mimeTypeAccepted) warnings.push('unsupported photo MIME type');
  if (!hasUsableDimensions) warnings.push('photo dimensions are missing or too small for visual analysis');
  if (likelyBlankOrTiny) warnings.push('photo file is unusually small');
  if (!orientationKnown) warnings.push('photo orientation is unknown');

  return {
    duplicateKey: [input.contentHash, input.width ?? 'unknown', input.height ?? 'unknown', input.perceptualHash ?? 'none'].join(':'),
    mimeTypeAccepted,
    hasUsableDimensions,
    likelyBlankOrTiny,
    orientationKnown,
    perceptualHashPresent,
    warnings,
  };
}

export function combineDeterministicAndSemanticPhotoAnalysis(input: {
  deterministic: PIEDeterministicPhotoCheckResult;
  analysis: PIEPhotoVisionAnalysis;
}): PIEVisualJarvisValidationResult {
  const semantic = validatePhotoVisionAnalysis(input.analysis);
  const rejectedClaims = [...semantic.rejectedClaims];
  const warnings = [...semantic.warnings, ...input.deterministic.warnings];

  if (!input.deterministic.mimeTypeAccepted || !input.deterministic.hasUsableDimensions) {
    rejectedClaims.push('photo failed deterministic eligibility checks');
  }

  return buildJarvisResult(dedupe(rejectedClaims), dedupe(warnings), input.analysis.limitations);
}

export function validatePhotoComparison(
  comparison: PIEPhotoComparisonAnalysis,
): PIEVisualJarvisValidationResult {
  const rejectedClaims = findUnsafeVisualClaims([...comparison.observations, ...comparison.inferredChanges]);
  const warnings = [...comparison.limitations, ...comparison.deterministicChecks.warnings];

  if (comparison.comparable === 'not_comparable' && comparison.inferredChanges.length > 0) {
    rejectedClaims.push('non-comparable photos cannot produce inferred change claims');
  }
  if (comparison.confidence === 'high' && comparison.comparable !== 'strong_match') {
    rejectedClaims.push('high confidence comparison requires strong comparability');
  }

  return buildJarvisResult(dedupe(rejectedClaims), dedupe(warnings), comparison.limitations);
}

export function validateSemanticPhotoComparison(
  comparison: PIEPhotoSemanticComparisonResult,
): PIEVisualJarvisValidationResult {
  const base = validatePhotoComparison(comparison);
  const rejectedClaims = [...base.rejectedClaims];
  const warnings = [...base.warnings];

  if (
    comparison.materialVisibleChange
    && comparison.projectStatusImpact === 'none'
    && !['unable_to_determine', 'no_material_visible_change'].includes(comparison.progressConclusion)
  ) {
    rejectedClaims.push('visible scene change cannot be treated as project progress without defined scope linkage');
  }
  if (comparison.projectStatusImpact !== 'none' && comparison.progressConclusion === 'unable_to_determine') {
    rejectedClaims.push('project status impact must remain none when progress is unable to determine');
  }
  if (
    ['weak_match', 'not_comparable'].includes(comparison.comparable)
    && ['progress_visible', 'partial_progress_visible', 'possible_regression'].includes(comparison.progressConclusion)
  ) {
    rejectedClaims.push('weak or non-comparable images cannot support a progress conclusion');
  }
  if (comparison.changeType === 'object_added' && !comparison.addedObject) {
    rejectedClaims.push('object_added comparison requires addedObject');
  }
  if (comparison.sameGeneralScene && comparison.comparable === 'not_comparable') {
    rejectedClaims.push('same general scene should not be classified as not_comparable');
  }

  return buildJarvisResult(dedupe(rejectedClaims), dedupe(warnings), comparison.limitations);
}

export function buildVisibleSceneChangeUserMessage(
  comparison: Pick<
    PIEPhotoSemanticComparisonResult,
    'addedObject' | 'approximateRegion' | 'limitations' | 'progressConclusion' | 'projectStatusImpact'
  >,
): string {
  const object = comparison.addedObject || 'newly visible object';
  const objectWithArticle = /^(a|an|the)\s/i.test(object) ? object : `A ${object}`;
  const viewpointChanged = comparison.limitations.some(limitation =>
    limitation.toLowerCase().includes('viewpoint') || limitation.toLowerCase().includes('framing'),
  );
  const viewpointSentence = viewpointChanged ? ' The viewpoint also changed slightly.' : '';
  const progressSentence = comparison.progressConclusion === 'unable_to_determine' || comparison.projectStatusImpact === 'none'
    ? ' This is a visible scene change, but it does not establish project progress.'
    : ' This visible scene change requires scope-linked review before it can affect project status.';
  return `${objectWithArticle.charAt(0).toUpperCase()}${objectWithArticle.slice(1)} appears in the newer photo.${viewpointSentence}${progressSentence}`;
}

export function buildQualifiedRealityEvidenceFromVisualAnalysis(
  analysis: PIEPhotoVisionAnalysis,
): PIEQualifiedRealityEvidence[] {
  const validation = validatePhotoVisionAnalysis(analysis);
  if (!validation.accepted) return [];

  return analysis.observations.map((observation, index) => ({
    id: `${analysis.analysisId}:visual-observation:${index + 1}`,
    evidenceType: 'photo',
    evidenceId: analysis.evidenceId,
    organizationId: analysis.organizationId,
    projectId: analysis.projectId,
    type: 'photo',
    name: observation,
    projectName: analysis.projectId,
    areaName: null,
    location: null,
    status: analysis.corroborationRequired ? 'needs_verification' : 'in_progress',
    confidence: analysis.confidence,
    evidenceSummary: `Photo visibly supports: ${observation}`,
    nextAction: analysis.corroborationRequired
      ? 'Corroborate this visual observation before treating it as project reality.'
      : 'Review the visible condition in context before acting.',
    owner: null,
    occurredAt: analysis.generatedAt,
    source: 'raw_photo_vision_analysis',
    evidenceQualified: true as const,
    identityConfidence: analysis.confidence === 'high' ? 'medium' : 'low',
  }));
}

export function recordEvidenceCorrection(input: {
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
  return {
    correctionId: input.correctionId,
    evidenceId: input.evidenceId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    correctedByUserId: input.correctedByUserId,
    reason: input.reason,
    originalAnalysisId: input.originalAnalysisId,
    correctedObservations: [...input.correctedObservations],
    correctedInferences: [...input.correctedInferences],
    supersedesAnalysisId: input.supersedesAnalysisId,
    createdAt: input.createdAt,
  };
}

export function shouldReuseAnalysisCache(input: {
  contentHash: string;
  cachedContentHash: string | null;
  analyzerVersion: string;
  cachedAnalyzerVersion: string | null;
  policyVersion: string;
  cachedPolicyVersion: string | null;
  explicitReanalysis?: boolean;
}): boolean {
  return Boolean(
    !input.explicitReanalysis
      && input.contentHash === input.cachedContentHash
      && input.analyzerVersion === input.cachedAnalyzerVersion
      && input.policyVersion === input.cachedPolicyVersion,
  );
}

export function classifyVisionProviderResult(
  result: PIEPhotoVisionProviderResult,
): PIEEvidenceProcessingState {
  if (result.status === 'succeeded' && result.analysis && validatePhotoVisionAnalysis(result.analysis).accepted) {
    return 'succeeded';
  }
  if (result.status === 'failed' || result.error) return 'failed';
  if (!result.analysis) return 'degraded';
  return 'blocked';
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

function assertsTruthWithoutSupport(claim: string): boolean {
  const normalized = claim.toLowerCase();
  return [
    'proves completion',
    'is complete',
    'fully compliant',
    'caused by',
    'responsible for',
    'percent complete',
  ].some(marker => normalized.includes(marker));
}

function findUnsafeVisualClaims(claims: string[]): string[] {
  const unsafeMarkers = [
    'behind the wall',
    'inside the conduit',
    'fully compliant',
    'code compliant',
    'caused by',
    'responsible for',
    '100% complete',
    'percent complete',
    'work was performed by',
    'passed inspection',
  ];
  return claims.flatMap(claim => {
    const normalized = claim.toLowerCase();
    return unsafeMarkers
      .filter(marker => normalized.includes(marker))
      .map(marker => `visual claim exceeds photo authority: ${marker}`);
  });
}

function buildJarvisResult(
  rejectedClaims: string[],
  warnings: string[],
  limitations: string[],
): PIEVisualJarvisValidationResult {
  const accepted = rejectedClaims.length === 0;
  return {
    accepted,
    outcome: accepted
      ? warnings.length > 0 || limitations.length > 0
        ? 'supported_with_limitations'
        : 'supported'
      : rejectedClaims.some(claim => claim.includes('authority') || claim.includes('eligibility'))
        ? 'blocked'
        : 'human_review_required',
    rejectedClaims,
    warnings,
    limitations,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
