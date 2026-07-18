import {
  advancePhotoAnalysisTarget,
  createPhotoAnalysisTarget,
  isPhotoAnalysisCommitEligible,
  nextPhotoAnalysisGeneration,
  photoAnalysisTargetsMatch,
  type PhotoAnalysisTarget,
} from '../../services/PhotoAnalysisTarget';

const CONTENT_SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);
const REPLACEMENT_SHA256 = 'c'.repeat(64);

const TARGET: PhotoAnalysisTarget = {
  projectId: 'project-2375',
  updateId: 'update-1',
  photoId: 'photo-1',
  contentSha256: CONTENT_SHA256,
  capturedAt: '2026-07-18T12:00:00.000Z',
  generation: 4,
};

describe('PhotoAnalysisTarget', () => {
  it('creates an immutable exact target', () => {
    const target = createPhotoAnalysisTarget(TARGET);

    expect(target).toEqual(TARGET);
    expect(Object.isFrozen(target)).toBe(true);
  });

  it.each([
    ['projectId', ''],
    ['updateId', '   '],
    ['photoId', ''],
    ['contentSha256', ' '],
  ] as const)('rejects an empty %s', (field, value) => {
    expect(() => createPhotoAnalysisTarget({
      ...TARGET,
      [field]: value,
    })).toThrow(`Photo analysis ${field} must be a non-empty string.`);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid generation %s',
    generation => {
      expect(() => createPhotoAnalysisTarget({
        ...TARGET,
        generation,
      })).toThrow('Photo analysis generation must be a non-negative safe integer.');
    },
  );

  it.each([
    'sha-a',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
  ])('rejects a non-canonical content SHA-256: %s', contentSha256 => {
    expect(() => createPhotoAnalysisTarget({
      ...TARGET,
      contentSha256,
    })).toThrow(
      'Photo analysis contentSha256 must be a canonical 64-character lowercase hexadecimal SHA-256.',
    );
  });

  it('matches only when project, update, photo, bytes, and generation are exact', () => {
    expect(photoAnalysisTargetsMatch(TARGET, { ...TARGET })).toBe(true);

    const changes: PhotoAnalysisTarget[] = [
      { ...TARGET, projectId: 'project-other' },
      { ...TARGET, updateId: 'update-other' },
      { ...TARGET, photoId: 'photo-other' },
      { ...TARGET, contentSha256: OTHER_SHA256 },
      { ...TARGET, capturedAt: '2026-07-18T12:01:00.000Z' },
      { ...TARGET, generation: TARGET.generation + 1 },
    ];

    changes.forEach(current => {
      expect(photoAnalysisTargetsMatch(TARGET, current)).toBe(false);
    });
  });

  it('rejects an invalid immutable capture timestamp', () => {
    expect(() => createPhotoAnalysisTarget({
      ...TARGET,
      capturedAt: 'yesterday',
    })).toThrow('capturedAt must be a valid timestamp or null');
  });

  it('allows a commit only while the exact target still exists', () => {
    expect(isPhotoAnalysisCommitEligible(TARGET, { ...TARGET })).toBe(true);
    expect(isPhotoAnalysisCommitEligible(TARGET, undefined)).toBe(false);
    expect(isPhotoAnalysisCommitEligible(TARGET, null)).toBe(false);
    expect(isPhotoAnalysisCommitEligible(TARGET, {
      ...TARGET,
      generation: TARGET.generation + 1,
    })).toBe(false);
    expect(isPhotoAnalysisCommitEligible(TARGET, {
      ...TARGET,
      contentSha256: REPLACEMENT_SHA256,
    })).toBe(false);
  });

  it('increments a missing or current generation deterministically', () => {
    expect(nextPhotoAnalysisGeneration(undefined)).toBe(1);
    expect(nextPhotoAnalysisGeneration(null)).toBe(1);
    expect(nextPhotoAnalysisGeneration(0)).toBe(1);
    expect(nextPhotoAnalysisGeneration(4)).toBe(5);
  });

  it('rejects generation overflow instead of recycling an old identity', () => {
    expect(() => nextPhotoAnalysisGeneration(Number.MAX_SAFE_INTEGER))
      .toThrow('Photo analysis generation cannot exceed Number.MAX_SAFE_INTEGER.');
  });

  it('advances generation and optional bytes without mutating the prior target', () => {
    const current = createPhotoAnalysisTarget(TARGET);
    const retry = advancePhotoAnalysisTarget(current);
    const replacement = advancePhotoAnalysisTarget(retry, REPLACEMENT_SHA256);

    expect(current).toEqual(TARGET);
    expect(retry).toEqual({ ...TARGET, generation: 5 });
    expect(replacement).toEqual({
      ...TARGET,
      contentSha256: REPLACEMENT_SHA256,
      generation: 6,
    });
    expect(Object.isFrozen(retry)).toBe(true);
    expect(Object.isFrozen(replacement)).toBe(true);
  });
});
