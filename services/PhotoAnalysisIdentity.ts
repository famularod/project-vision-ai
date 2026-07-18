export const PHOTO_ANALYSIS_IDENTITY_VERSION = 'photo-analysis-run/v2' as const;
export const PHOTO_EVIDENCE_IDENTITY_VERSION = 'photo-evidence/v2' as const;

export const CURRENT_PHOTO_ANALYSIS_VERSIONS = Object.freeze({
  analyzerId: 'pie-production-photo-vision',
  analyzerVersion: '2026.07.13-structured-comparability-impact',
  promptVersion: '2026.07.13-structured-comparability-impact',
  schemaVersion: '2026-07-p1-v1',
  policyVersion: '2026.07.13-structured-comparability-impact',
});

export type PhotoAnalysisVersions = Readonly<{
  analyzerId: string;
  analyzerVersion: string;
  promptVersion: string;
  schemaVersion: string;
  policyVersion: string;
}>;

export type PhotoEvidenceIdentity = Readonly<{
  identityVersion: typeof PHOTO_EVIDENCE_IDENTITY_VERSION;
  evidenceId: string;
  assetId: string;
  stagingCacheKey: string;
  contentSha256: string;
}>;

export type PhotoAnalysisRunIdentity = Readonly<{
  identityVersion: typeof PHOTO_ANALYSIS_IDENTITY_VERSION;
  requestId: string;
  cacheKey: string;
  priorContentSha256: string;
  currentContentSha256: string;
  versions: PhotoAnalysisVersions;
}>;

export type ImmutablePhotoCaptureTimestamp = Readonly<{
  value: string | null;
  epochMs: number | null;
  status: 'valid' | 'missing' | 'invalid';
  source: 'capturedAt' | 'legacy_locationCapturedAt' | null;
}>;

export type ImmutablePhotoCaptureOrder =
  | 'earlier'
  | 'equal'
  | 'later'
  | 'candidate_missing'
  | 'candidate_invalid'
  | 'current_missing'
  | 'current_invalid';

const SHA256_RE = /^[a-f0-9]{64}$/;
const EXPLICIT_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * Immutable asset identity includes the bytes. Reusing update/photo IDs with
 * changed bytes therefore creates a different evidence ID and staging key.
 */
export function createPhotoEvidenceIdentity(input: Readonly<{
  organizationId: string;
  projectId: string;
  updateId: string;
  photoId: string;
  contentSha256: string;
}>): PhotoEvidenceIdentity {
  const organizationId = requireIdentityPart('organizationId', input.organizationId);
  const projectId = requireIdentityPart('projectId', input.projectId);
  const updateId = requireIdentityPart('updateId', input.updateId);
  const photoId = requireIdentityPart('photoId', input.photoId);
  const contentSha256 = requireSha256(input.contentSha256);
  const scopeKey = canonicalIdentityKey(PHOTO_EVIDENCE_IDENTITY_VERSION, {
    organizationId,
    projectId,
    updateId,
    photoId,
    contentSha256,
  });
  const evidenceId = `pie-mobile-photo-v2-${stableHash(scopeKey)}-${contentSha256}`;

  return Object.freeze({
    identityVersion: PHOTO_EVIDENCE_IDENTITY_VERSION,
    evidenceId,
    assetId: evidenceId,
    stagingCacheKey: scopeKey,
    contentSha256,
  });
}

/**
 * Canonical identity for one analyzer run and any result cache. Every input
 * that can change the meaning of a comparison is retained in the key.
 */
export function createPhotoAnalysisRunIdentity(input: Readonly<{
  organizationId: string;
  projectId: string;
  priorEvidenceId: string;
  currentEvidenceId: string;
  priorContentSha256: string;
  currentContentSha256: string;
  versions?: PhotoAnalysisVersions;
}>): PhotoAnalysisRunIdentity {
  const versions = validateVersions(input.versions ?? CURRENT_PHOTO_ANALYSIS_VERSIONS);
  const components = {
    organizationId: requireIdentityPart('organizationId', input.organizationId),
    projectId: requireIdentityPart('projectId', input.projectId),
    priorEvidenceId: requireIdentityPart('priorEvidenceId', input.priorEvidenceId),
    currentEvidenceId: requireIdentityPart('currentEvidenceId', input.currentEvidenceId),
    priorContentSha256: requireSha256(input.priorContentSha256),
    currentContentSha256: requireSha256(input.currentContentSha256),
    analyzerId: versions.analyzerId,
    analyzerVersion: versions.analyzerVersion,
    promptVersion: versions.promptVersion,
    schemaVersion: versions.schemaVersion,
    policyVersion: versions.policyVersion,
  };
  const canonicalKey = canonicalIdentityKey(PHOTO_ANALYSIS_IDENTITY_VERSION, components);

  return Object.freeze({
    identityVersion: PHOTO_ANALYSIS_IDENTITY_VERSION,
    requestId: canonicalKey,
    cacheKey: canonicalKey,
    priorContentSha256: components.priorContentSha256,
    currentContentSha256: components.currentContentSha256,
    versions,
  });
}

/**
 * Resolves only an immutable per-photo capture instant. `capturedAt` is the
 * canonical field. `locationCapturedAt` remains a narrowly scoped legacy
 * compatibility source because existing captures already persisted it on the
 * photo itself. Update, import, analysis, and send timestamps are never used.
 */
export function resolveImmutablePhotoCapturedAt(
  value: unknown,
): ImmutablePhotoCaptureTimestamp {
  if (!isRecord(value)) return missingCaptureTimestamp();

  if (Object.prototype.hasOwnProperty.call(value, 'capturedAt')) {
    return parseCaptureTimestamp(value.capturedAt, 'capturedAt');
  }

  if (Object.prototype.hasOwnProperty.call(value, 'locationCapturedAt')) {
    return parseCaptureTimestamp(
      value.locationCapturedAt,
      'legacy_locationCapturedAt',
    );
  }

  return missingCaptureTimestamp();
}

export function compareImmutablePhotoCapturedAt(
  candidate: ImmutablePhotoCaptureTimestamp,
  current: ImmutablePhotoCaptureTimestamp,
): ImmutablePhotoCaptureOrder {
  if (current.status === 'missing') return 'current_missing';
  if (current.status === 'invalid') return 'current_invalid';
  if (candidate.status === 'missing') return 'candidate_missing';
  if (candidate.status === 'invalid') return 'candidate_invalid';

  if (candidate.epochMs! < current.epochMs!) return 'earlier';
  if (candidate.epochMs! > current.epochMs!) return 'later';
  return 'equal';
}

function validateVersions(value: PhotoAnalysisVersions): PhotoAnalysisVersions {
  return Object.freeze({
    analyzerId: requireIdentityPart('analyzerId', value.analyzerId),
    analyzerVersion: requireIdentityPart('analyzerVersion', value.analyzerVersion),
    promptVersion: requireIdentityPart('promptVersion', value.promptVersion),
    schemaVersion: requireIdentityPart('schemaVersion', value.schemaVersion),
    policyVersion: requireIdentityPart('policyVersion', value.policyVersion),
  });
}

function canonicalIdentityKey(
  version: string,
  components: Readonly<Record<string, string>>,
) {
  return [
    version,
    ...Object.entries(components).map(([key, value]) =>
      `${key}=${encodeURIComponent(value)}`
    ),
  ].join('|');
}

function requireIdentityPart(field: string, value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Photo analysis ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireSha256(value: unknown) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new TypeError(
      'Photo analysis content SHA-256 must be 64 lowercase hexadecimal characters.',
    );
  }
  return value;
}

function parseCaptureTimestamp(
  raw: unknown,
  source: NonNullable<ImmutablePhotoCaptureTimestamp['source']>,
): ImmutablePhotoCaptureTimestamp {
  if (raw === null || raw === undefined || raw === '') {
    return Object.freeze({ value: null, epochMs: null, status: 'missing', source });
  }

  if (typeof raw !== 'string') {
    return Object.freeze({ value: null, epochMs: null, status: 'invalid', source });
  }

  const value = raw.trim();
  const epochMs = EXPLICIT_INSTANT_RE.test(value)
    ? new Date(value).getTime()
    : Number.NaN;

  if (!Number.isFinite(epochMs)) {
    return Object.freeze({ value: null, epochMs: null, status: 'invalid', source });
  }

  return Object.freeze({ value, epochMs, status: 'valid', source });
}

function missingCaptureTimestamp(): ImmutablePhotoCaptureTimestamp {
  return Object.freeze({ value: null, epochMs: null, status: 'missing', source: null });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
