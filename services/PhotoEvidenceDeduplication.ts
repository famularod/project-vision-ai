export type ExistingPhotoEvidenceVersion = Readonly<{
  id: string;
  evidenceVersion: number;
  analyzerId: string | null;
  analyzerVersion: string | null;
  processingState: string | null;
  duplicateOfEvidenceId: string | null;
  currentAnalysisVersion: string | null;
  originalStoragePath: string | null;
}>;

export type PhotoEvidenceDeduplicationPlan = Readonly<{
  mode: 'new_root' | 'idempotent_existing' | 'duplicate_lineage';
  evidenceId: string;
  evidenceVersion: number;
  duplicateOfEvidenceId: string | null;
  parentEvidenceIds: readonly string[];
  analyzerId: string;
  analyzerVersion: string;
  currentAnalysisVersion: string | null;
  analysisReuse: 'current_version_available' | 'analysis_required';
  existingStoragePath: string | null;
}>;

export type PhotoEvidencePairDecision = Readonly<{
  kind: 'analyze' | 'duplicate_bytes';
  analysisStatus: 'analyzing' | 'completed_with_limitations';
  projectProgress: 'unable_to_determine' | 'unsupported';
  providerInvocationRequired: boolean;
}>;

/**
 * Plans one write under the existing `(organization, project, content hash,
 * evidence version)` uniqueness rule. A new capture with known bytes receives
 * an explicit versioned lineage row instead of colliding with version 1.
 */
export function buildPhotoEvidenceDeduplicationPlan(input: Readonly<{
  intendedEvidenceId: string;
  analyzerId: string;
  analyzerVersion: string;
  existingVersions: readonly ExistingPhotoEvidenceVersion[];
}>): PhotoEvidenceDeduplicationPlan {
  const intendedEvidenceId = requiredText('intendedEvidenceId', input.intendedEvidenceId);
  const analyzerId = requiredText('analyzerId', input.analyzerId);
  const analyzerVersion = requiredText('analyzerVersion', input.analyzerVersion);
  const existingVersions = input.existingVersions
    .map(normalizeExistingVersion)
    .sort(compareEvidenceVersions);
  const exact = existingVersions.find(item => item.id === intendedEvidenceId) ?? null;

  if (exact) {
    const duplicateOfEvidenceId = exact.duplicateOfEvidenceId;
    return Object.freeze({
      mode: 'idempotent_existing',
      evidenceId: intendedEvidenceId,
      evidenceVersion: exact.evidenceVersion,
      duplicateOfEvidenceId,
      parentEvidenceIds: duplicateOfEvidenceId ? Object.freeze([duplicateOfEvidenceId]) : Object.freeze([]),
      analyzerId,
      analyzerVersion,
      currentAnalysisVersion: exact.currentAnalysisVersion,
      analysisReuse: exact.currentAnalysisVersion === analyzerVersion
        ? 'current_version_available'
        : 'analysis_required',
      existingStoragePath: exact.originalStoragePath,
    });
  }

  if (existingVersions.length === 0) {
    return Object.freeze({
      mode: 'new_root',
      evidenceId: intendedEvidenceId,
      evidenceVersion: 1,
      duplicateOfEvidenceId: null,
      parentEvidenceIds: Object.freeze([]),
      analyzerId,
      analyzerVersion,
      currentAnalysisVersion: null,
      analysisReuse: 'analysis_required',
      existingStoragePath: null,
    });
  }

  const lastVersion = existingVersions[existingVersions.length - 1].evidenceVersion;
  if (!Number.isSafeInteger(lastVersion + 1)) {
    throw new Error('photo_evidence_version_exhausted');
  }
  const canonicalRoot = findCanonicalRoot(existingVersions);

  return Object.freeze({
    mode: 'duplicate_lineage',
    evidenceId: intendedEvidenceId,
    evidenceVersion: lastVersion + 1,
    duplicateOfEvidenceId: canonicalRoot.id,
    parentEvidenceIds: Object.freeze([canonicalRoot.id]),
    analyzerId,
    analyzerVersion,
    currentAnalysisVersion: null,
    analysisReuse: 'analysis_required',
    existingStoragePath: canonicalRoot.originalStoragePath,
  });
}

/**
 * Identical files are valid evidence lineage, but not independent evidence of
 * change. They complete conservatively without invoking a provider or being
 * mislabeled as an analysis failure.
 */
export function decidePhotoEvidencePair(input: Readonly<{
  baselineEvidenceId: string;
  currentEvidenceId: string;
  baselineContentHash: string;
  currentContentHash: string;
  baselineSizeBytes: number;
  currentSizeBytes: number;
}>): PhotoEvidencePairDecision {
  if (input.baselineEvidenceId === input.currentEvidenceId) {
    throw new Error('photo_pair_same_evidence_id');
  }
  if (input.baselineSizeBytes <= 0 || input.currentSizeBytes <= 0) {
    throw new Error('photo_pair_empty_file');
  }
  if (input.baselineContentHash === input.currentContentHash) {
    return Object.freeze({
      kind: 'duplicate_bytes',
      analysisStatus: 'completed_with_limitations',
      projectProgress: 'unsupported',
      providerInvocationRequired: false,
    });
  }
  return Object.freeze({
    kind: 'analyze',
    analysisStatus: 'analyzing',
    projectProgress: 'unable_to_determine',
    providerInvocationRequired: true,
  });
}

function findCanonicalRoot(
  versions: readonly ExistingPhotoEvidenceVersion[],
): ExistingPhotoEvidenceVersion {
  const root = versions.find(item => !item.duplicateOfEvidenceId);
  if (root) return root;

  const referencedRootId = versions[0].duplicateOfEvidenceId;
  return versions.find(item => item.id === referencedRootId) ?? {
    ...versions[0],
    id: referencedRootId || versions[0].id,
  };
}

function normalizeExistingVersion(
  value: ExistingPhotoEvidenceVersion,
): ExistingPhotoEvidenceVersion {
  const evidenceVersion = value.evidenceVersion;
  if (!Number.isSafeInteger(evidenceVersion) || evidenceVersion <= 0) {
    throw new Error('invalid_photo_evidence_version');
  }
  return Object.freeze({
    ...value,
    id: requiredText('existingEvidenceId', value.id),
    evidenceVersion,
    analyzerId: optionalText(value.analyzerId),
    analyzerVersion: optionalText(value.analyzerVersion),
    processingState: optionalText(value.processingState),
    duplicateOfEvidenceId: optionalText(value.duplicateOfEvidenceId),
    currentAnalysisVersion: optionalText(value.currentAnalysisVersion),
    originalStoragePath: optionalText(value.originalStoragePath),
  });
}

function compareEvidenceVersions(
  left: ExistingPhotoEvidenceVersion,
  right: ExistingPhotoEvidenceVersion,
) {
  return left.evidenceVersion - right.evidenceVersion || left.id.localeCompare(right.id);
}

function requiredText(label: string, value: string) {
  const normalized = optionalText(value);
  if (!normalized) throw new Error(`missing_${label}`);
  return normalized;
}

function optionalText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
