import { createPhotoAnalysisCoordinator } from '../../services/PhotoAnalysisCoordinator';
import type { PhotoAnalysisTarget } from '../../services/PhotoAnalysisTarget';

const TARGET: PhotoAnalysisTarget = {
  projectId: 'project-a',
  updateId: 'update-a',
  photoId: 'photo-a',
  contentSha256: 'sha-a',
  generation: 1,
};

describe('PhotoAnalysisCoordinator', () => {
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
      { ...TARGET, contentSha256: 'sha-b' },
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

  it('discards a result after the photo is deleted or replaced', () => {
    const coordinator = createPhotoAnalysisCoordinator();
    const submitted = coordinator.begin(TARGET);

    expect(coordinator.invalidate(TARGET)).toBe(true);
    expect(coordinator.commitIfCurrent(submitted, jest.fn())).toEqual({
      committed: false,
      reason: 'missing_target',
    });

    coordinator.begin(TARGET);
    coordinator.begin({ ...TARGET, contentSha256: 'replacement-sha', generation: 2 });
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
