export const PHOTO_VISION_PAIR_REQUEST_ID_VERSION =
  'photo-analysis-run/v2' as const;
export const PHOTO_VISION_SINGLE_REQUEST_ID_VERSION =
  'photo-analysis-single-run/v1' as const;
export const PHOTO_VISION_PREFLIGHT_REQUEST_ID_VERSION =
  'photo-analysis-preflight/v1' as const;

export type PhotoVisionRequestIdentityVersions = Readonly<{
  contractVersion: string;
  analyzerId: string;
  analyzerVersion: string;
  promptVersion: string;
  schemaVersion: string;
  policyVersion: string;
}>;

export type PhotoVisionRequestIdentityInput = Readonly<{
  mode: 'single_photo' | 'photo_pair';
  organizationId: string;
  projectId: string;
  evidenceId?: string | null;
  baselineEvidenceId?: string | null;
  currentEvidenceId?: string | null;
  evidenceContentSha256?: string | null;
  baselineContentSha256?: string | null;
  currentContentSha256?: string | null;
  versions: PhotoVisionRequestIdentityVersions;
}>;

const SHA256_RE = /^[a-f0-9]{64}$/;

export type BoundedJsonReadResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: 'request_too_large' | 'invalid_json';
    }>;

/**
 * Reads and bounds the bytes delivered by the request stream itself. A
 * Content-Length header remains useful as an early rejection, but it is not
 * authoritative: HTTP/2/chunked bodies may omit it and clients may lie.
 * JSON parsing happens only after the complete UTF-8 byte sequence is known
 * to be within the limit.
 */
export async function readBoundedUtf8Json<T>(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonReadResult<T>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('Photo vision request byte limit must be positive.');
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: 'invalid_json' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('request_too_large').catch(() => undefined);
        return { ok: false, error: 'request_too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: 'invalid_json' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

/**
 * Builds the only IDs the service-role edge function may persist. The caller
 * may supply an expected ID for drift detection, but never chooses the cloud
 * primary key. Pair IDs intentionally match the mobile v2 content-addressed
 * identity so existing result lookup remains compatible.
 */
export function buildServerPhotoVisionRequestId(
  input: PhotoVisionRequestIdentityInput,
): string {
  const common = {
    organizationId: identityPart('organizationId', input.organizationId),
    projectId: identityPart('projectId', input.projectId),
  };
  const versions = validatedVersions(input.versions);

  if (input.mode === 'photo_pair') {
    return canonicalIdentityKey(PHOTO_VISION_PAIR_REQUEST_ID_VERSION, {
      ...common,
      priorEvidenceId: identityPart(
        'baselineEvidenceId',
        input.baselineEvidenceId,
      ),
      currentEvidenceId: identityPart(
        'currentEvidenceId',
        input.currentEvidenceId,
      ),
      priorContentSha256: sha256(
        'baselineContentSha256',
        input.baselineContentSha256,
      ),
      currentContentSha256: sha256(
        'currentContentSha256',
        input.currentContentSha256,
      ),
      ...versions,
    });
  }

  return canonicalIdentityKey(PHOTO_VISION_SINGLE_REQUEST_ID_VERSION, {
    ...common,
    evidenceId: identityPart('evidenceId', input.evidenceId),
    contentSha256: sha256(
      'evidenceContentSha256',
      input.evidenceContentSha256,
    ),
    ...versions,
  });
}

/**
 * Safe diagnostic identity for a request rejected before all image hashes can
 * be verified. It is still owner/project/evidence scoped and ignores any
 * caller-provided primary key.
 */
export function buildServerPhotoVisionPreflightId(
  input: Omit<PhotoVisionRequestIdentityInput,
    | 'evidenceContentSha256'
    | 'baselineContentSha256'
    | 'currentContentSha256'>,
): string {
  const evidenceIds = input.mode === 'photo_pair'
    ? [
        identityPart('baselineEvidenceId', input.baselineEvidenceId),
        identityPart('currentEvidenceId', input.currentEvidenceId),
      ].join(':')
    : identityPart('evidenceId', input.evidenceId);

  return canonicalIdentityKey(PHOTO_VISION_PREFLIGHT_REQUEST_ID_VERSION, {
    organizationId: identityPart('organizationId', input.organizationId),
    projectId: identityPart('projectId', input.projectId),
    mode: input.mode,
    evidenceIds,
    ...validatedVersions(input.versions),
  });
}

export function callerPhotoVisionRequestIdMatches(
  callerRequestId: unknown,
  serverRequestId: string,
): boolean {
  return callerRequestId === undefined ||
    callerRequestId === null ||
    callerRequestId === serverRequestId;
}

export function photoVisionCallerScopeIsAuthorized({
  isAppOwner,
  authenticatedUserId,
  organizationId,
  projectId,
}: Readonly<{
  isAppOwner: unknown;
  authenticatedUserId: unknown;
  organizationId: unknown;
  projectId: unknown;
}>): boolean {
  if (isAppOwner !== true || typeof authenticatedUserId !== 'string') return false;
  if (organizationId !== authenticatedUserId || typeof projectId !== 'string') {
    return false;
  }
  try {
    safeStorageSegment(authenticatedUserId);
    safeStorageSegment(projectId);
    return true;
  } catch {
    return false;
  }
}

export function isCanonicalPhotoEvidenceStoragePath({
  path,
  organizationId,
  projectId,
  evidenceId,
}: Readonly<{
  path: string;
  organizationId: string;
  projectId: string;
  evidenceId: string;
}>): boolean {
  const normalized = path.toLowerCase();
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('//') ||
    /%2e|%2f|%5c/.test(normalized)
  ) {
    return false;
  }
  if (path.split('/').some(segment => segment === '.' || segment === '..')) {
    return false;
  }

  try {
    const expectedPrefix = [
      safeStorageSegment(organizationId),
      safeStorageSegment(projectId),
      'photo',
      safeStorageSegment(evidenceId),
    ].join('/');
    return path.startsWith(`${expectedPrefix}/`) &&
      path.length > expectedPrefix.length + 1;
  } catch {
    return false;
  }
}

function validatedVersions(
  versions: PhotoVisionRequestIdentityVersions,
): PhotoVisionRequestIdentityVersions {
  return {
    contractVersion: identityPart('contractVersion', versions.contractVersion),
    analyzerId: identityPart('analyzerId', versions.analyzerId),
    analyzerVersion: identityPart('analyzerVersion', versions.analyzerVersion),
    promptVersion: identityPart('promptVersion', versions.promptVersion),
    schemaVersion: identityPart('schemaVersion', versions.schemaVersion),
    policyVersion: identityPart('policyVersion', versions.policyVersion),
  };
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

function identityPart(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Photo vision ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function sha256(field: string, value: unknown): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new TypeError(
      `Photo vision ${field} must be a lowercase SHA-256 value.`,
    );
  }
  return value;
}

function safeStorageSegment(value: string): string {
  const segment = identityPart('storage path segment', value);
  if (
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\')
  ) {
    throw new TypeError('Photo vision storage path segment is unsafe.');
  }
  return segment;
}
