export type PhotoAnalysisTarget = Readonly<{
  projectId: string;
  updateId: string;
  photoId: string;
  contentSha256: string;
  capturedAt: string | null;
  generation: number;
}>;

const CANONICAL_SHA256 = /^[a-f0-9]{64}$/;

/**
 * Creates the immutable identity for one photo-analysis attempt.
 *
 * Callers must persist the same values on the current photo entity and compare
 * them again before committing an asynchronous result.
 */
export function createPhotoAnalysisTarget(
  input: PhotoAnalysisTarget,
): PhotoAnalysisTarget {
  assertNonEmpty('projectId', input.projectId);
  assertNonEmpty('updateId', input.updateId);
  assertNonEmpty('photoId', input.photoId);
  assertNonEmpty('contentSha256', input.contentSha256);
  assertCanonicalSha256(input.contentSha256);
  assertCapturedAt(input.capturedAt);
  assertGeneration(input.generation);

  return Object.freeze({
    projectId: input.projectId,
    updateId: input.updateId,
    photoId: input.photoId,
    contentSha256: input.contentSha256,
    capturedAt: input.capturedAt,
    generation: input.generation,
  });
}

/**
 * Exact matching is intentional. Project, update, photo, bytes, and generation
 * must all still be the same when an asynchronous result returns.
 */
export function photoAnalysisTargetsMatch(
  submitted: PhotoAnalysisTarget,
  current: PhotoAnalysisTarget,
): boolean {
  return submitted.projectId === current.projectId &&
    submitted.updateId === current.updateId &&
    submitted.photoId === current.photoId &&
    submitted.contentSha256 === current.contentSha256 &&
    submitted.capturedAt === current.capturedAt &&
    submitted.generation === current.generation;
}

/**
 * A removed entity has no current target and therefore can never accept a late
 * result. Replaced bytes or a newer retry also fail the exact comparison.
 */
export function isPhotoAnalysisCommitEligible(
  submitted: PhotoAnalysisTarget,
  current: PhotoAnalysisTarget | null | undefined,
): boolean {
  return current !== null &&
    current !== undefined &&
    photoAnalysisTargetsMatch(submitted, current);
}

export function nextPhotoAnalysisGeneration(
  current: number | null | undefined,
): number {
  if (current === null || current === undefined) return 1;

  assertGeneration(current);

  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Photo analysis generation cannot exceed Number.MAX_SAFE_INTEGER.');
  }

  return current + 1;
}

/**
 * Returns a new immutable target for a retry or byte replacement without
 * mutating the prior attempt identity.
 */
export function advancePhotoAnalysisTarget(
  current: PhotoAnalysisTarget,
  contentSha256: string = current.contentSha256,
): PhotoAnalysisTarget {
  return createPhotoAnalysisTarget({
    ...current,
    contentSha256,
    generation: nextPhotoAnalysisGeneration(current.generation),
  });
}

function assertNonEmpty(
  field: 'projectId' | 'updateId' | 'photoId' | 'contentSha256',
  value: string,
) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Photo analysis ${field} must be a non-empty string.`);
  }
}

function assertGeneration(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Photo analysis generation must be a non-negative safe integer.');
  }
}

function assertCanonicalSha256(value: string) {
  if (!CANONICAL_SHA256.test(value)) {
    throw new TypeError(
      'Photo analysis contentSha256 must be a canonical 64-character lowercase hexadecimal SHA-256.',
    );
  }
}

function assertCapturedAt(value: string | null) {
  if (value === null) return;
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('Photo analysis capturedAt must be a valid timestamp or null.');
  }
}
