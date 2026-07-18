import {
  createPhotoAnalysisTarget,
  photoAnalysisTargetsMatch,
  type PhotoAnalysisTarget,
} from './PhotoAnalysisTarget';

export type PhotoAnalysisCommitResult =
  | Readonly<{ committed: true }>
  | Readonly<{
      committed: false;
      reason: 'missing_target' | 'stale_target';
    }>;

export type PhotoAnalysisCoordinator = Readonly<{
  begin: (target: PhotoAnalysisTarget) => PhotoAnalysisTarget;
  current: (target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>) =>
    PhotoAnalysisTarget | null;
  isCurrent: (target: PhotoAnalysisTarget) => boolean;
  commitIfCurrent: (
    target: PhotoAnalysisTarget,
    commit: () => void,
  ) => PhotoAnalysisCommitResult;
  invalidate: (
    target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
  ) => boolean;
  invalidateUpdate: (projectId: string, updateId: string) => number;
  invalidateProject: (projectId: string) => number;
  clear: () => void;
}>;

/**
 * Owns the exact async-analysis generation currently permitted to write.
 * Results are committed only when project, update, photo, content bytes, and
 * generation still match the submitted target.
 */
export function createPhotoAnalysisCoordinator(): PhotoAnalysisCoordinator {
  const targets = new Map<string, PhotoAnalysisTarget>();

  const begin = (input: PhotoAnalysisTarget) => {
    const target = createPhotoAnalysisTarget(input);
    targets.set(photoAnalysisEntityKey(target), target);
    return target;
  };

  const current = (
    target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
  ) => targets.get(photoAnalysisEntityKey(target)) || null;

  const isCurrent = (target: PhotoAnalysisTarget) => {
    const active = current(target);
    return Boolean(active && photoAnalysisTargetsMatch(target, active));
  };

  const commitIfCurrent = (
    target: PhotoAnalysisTarget,
    commit: () => void,
  ): PhotoAnalysisCommitResult => {
    const active = current(target);
    if (!active) return { committed: false, reason: 'missing_target' };
    if (!photoAnalysisTargetsMatch(target, active)) {
      return { committed: false, reason: 'stale_target' };
    }

    commit();
    return { committed: true };
  };

  const invalidate = (
    target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
  ) => targets.delete(photoAnalysisEntityKey(target));

  const invalidateMatching = (matches: (target: PhotoAnalysisTarget) => boolean) => {
    let invalidated = 0;
    for (const [key, target] of targets.entries()) {
      if (!matches(target)) continue;
      targets.delete(key);
      invalidated += 1;
    }
    return invalidated;
  };

  return {
    begin,
    current,
    isCurrent,
    commitIfCurrent,
    invalidate,
    invalidateUpdate: (projectId, updateId) =>
      invalidateMatching(target =>
        target.projectId === projectId && target.updateId === updateId,
      ),
    invalidateProject: projectId =>
      invalidateMatching(target => target.projectId === projectId),
    clear: () => targets.clear(),
  };
}

function photoAnalysisEntityKey(
  target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
) {
  return JSON.stringify([target.projectId, target.updateId, target.photoId]);
}
