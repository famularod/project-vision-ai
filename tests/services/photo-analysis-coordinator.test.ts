import { createPhotoAnalysisCoordinator } from '../../services/PhotoAnalysisCoordinator';
import type { PhotoAnalysisTarget } from '../../services/PhotoAnalysisTarget';

const CONTENT_SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);

const TARGET: PhotoAnalysisTarget = {
  projectId: 'project-a',
  updateId: 'update-a',
  photoId: 'photo-a',
  contentSha256: CONTENT_SHA256,
  capturedAt: '2026-07-18T12:00:00.000Z',
  generation: 1,
};

describe('PhotoAnalysisCoordinator', () => {
  it('discards an early-return result when a newer entity generation has started', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const first = coordinator.beginAttempt(TARGET);
    const newer = coordinator.beginAttempt(TARGET);
    const commits: string[] = [];

    expect(coordinator.commitAttemptIfCurrent(first, () => commits.push('first'))).toEqual({
      committed: false,
      reason: 'stale_target',
    });
    expect(coordinator.bindTargetIfCurrent(first, {
      ...TARGET,
      contentSha256: OTHER_SHA256,
    })).toBeNull();
    expect(coordinator.commitAttemptIfCurrent(newer, () => commits.push('newer'))).toEqual({
      committed: true,
    });
    expect(commits).toEqual(['newer']);
  });

  it('never reuses an accepted or cleared entity generation', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const first = coordinator.beginAttempt(TARGET);
    expect(coordinator.commitAttemptIfCurrent(first, jest.fn()).committed).toBe(true);

    const second = coordinator.beginAttempt(TARGET);
    expect(second.generation).toBe(first.generation + 1);
    coordinator.clear();
    const afterClear = coordinator.beginAttempt(TARGET);
    expect(afterClear.generation).toBe(second.generation + 1);
    expect(coordinator.commitAttemptIfCurrent(first, jest.fn())).toEqual({
      committed: false,
      reason: 'stale_target',
    });
  });

  it('commits only the exact active project, update, photo, bytes, and generation', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    coordinator.begin(TARGET);
    const commit = jest.fn();

    expect(coordinator.commitIfCurrent(TARGET, commit)).toEqual({ committed: true });
    expect(commit).toHaveBeenCalledTimes(1);

    for (const staleTarget of [
      { ...TARGET, projectId: 'project-b' },
      { ...TARGET, updateId: 'update-b' },
      { ...TARGET, photoId: 'photo-b' },
      { ...TARGET, contentSha256: OTHER_SHA256 },
      { ...TARGET, capturedAt: '2026-07-18T12:01:00.000Z' },
      { ...TARGET, generation: 2 },
    ]) {
      expect(coordinator.commitIfCurrent(staleTarget, commit).committed).toBe(false);
    }
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('discards an out-of-order result after retry advances the generation', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const first = coordinator.begin(TARGET);
    const retry = coordinator.begin({ ...TARGET, generation: 2 });
    const commits: string[] = [];

    expect(coordinator.commitIfCurrent(first, () => commits.push('first'))).toEqual({
      committed: false,
      reason: 'stale_target',
    });
    expect(coordinator.commitIfCurrent(retry, () => commits.push('retry'))).toEqual({
      committed: true,
    });
    expect(commits).toEqual(['retry']);
  });

  it('consumes one accepted generation so duplicate callbacks cannot commit twice', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const submitted = coordinator.begin(TARGET);
    const commit = jest.fn();

    expect(coordinator.commitIfCurrent(submitted, commit)).toEqual({ committed: true });
    expect(coordinator.commitIfCurrent(submitted, commit)).toEqual({
      committed: false,
      reason: 'missing_target',
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not consume a newer generation started by the commit callback', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const submitted = coordinator.begin(TARGET);
    const newer = { ...TARGET, generation: TARGET.generation + 1 };

    expect(coordinator.commitIfCurrent(submitted, () => {
      coordinator.begin(newer);
    })).toEqual({ committed: true });
    expect(coordinator.isCurrent(newer)).toBe(true);
  });

  it('discards a result after the photo is deleted or replaced', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const submitted = coordinator.begin(TARGET);

    expect(coordinator.invalidate(TARGET)).toBe(true);
    expect(coordinator.commitIfCurrent(submitted, jest.fn())).toEqual({
      committed: false,
      reason: 'missing_target',
    });

    coordinator.begin(TARGET);
    coordinator.begin({ ...TARGET, contentSha256: OTHER_SHA256, generation: 2 });
    expect(coordinator.isCurrent(submitted)).toBe(false);
  });

  it('keeps same-named photos isolated by immutable project and update identity', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const other: PhotoAnalysisTarget = {
      ...TARGET,
      projectId: 'project-b',
      updateId: 'update-b',
    };

    coordinator.begin(TARGET);
    coordinator.begin(other);
    expect(coordinator.invalidateUpdate(TARGET.projectId, TARGET.updateId)).toBe(1);
    expect(coordinator.isCurrent(TARGET)).toBe(false);
    expect(coordinator.isCurrent(other)).toBe(true);
  });

  it('invalidates every in-flight result when a project is removed or scope is reset', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    coordinator.begin(TARGET);
    coordinator.begin({ ...TARGET, updateId: 'update-b', photoId: 'photo-b' });
    coordinator.begin({ ...TARGET, projectId: 'project-b', updateId: 'update-c' });

    expect(coordinator.invalidateProject(TARGET.projectId)).toBe(2);
    expect(coordinator.current(TARGET)).toBeNull();
    expect(coordinator.current({ ...TARGET, updateId: 'update-b', photoId: 'photo-b' })).toBeNull();

    coordinator.clear();
    expect(coordinator.current({ ...TARGET, projectId: 'project-b', updateId: 'update-c' })).toBeNull();
  });
});
