import {
  createPhotoAnalysisTarget,
  nextPhotoAnalysisGeneration,
  photoAnalysisTargetsMatch,
  type PhotoAnalysisTarget,
} from './PhotoAnalysisTarget';

export type PhotoAnalysisAttempt = Readonly<{
  projectId: string;
  updateId: string;
  photoId: string;
  generation: number;
}>;

export type PhotoAnalysisCommitResult =
  | Readonly<{ committed: true }>
  | Readonly<{
      committed: false;
      reason: 'missing_target' | 'stale_target';
    }>;

export type PhotoAnalysisCoordinator = Readonly<{
  beginAttempt: (
    target: Pick<PhotoAnalysisAttempt, 'projectId' | 'updateId' | 'photoId'>,
  ) => PhotoAnalysisAttempt;
  bindTargetIfCurrent: (
    attempt: PhotoAnalysisAttempt,
    target: Omit<PhotoAnalysisTarget, 'generation'>,
  ) => PhotoAnalysisTarget | null;
  commitAttemptIfCurrent: (
    attempt: PhotoAnalysisAttempt,
    commit: () => void,
  ) => PhotoAnalysisCommitResult;
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
  const attempts = new Map<string, PhotoAnalysisAttempt>();
  const lastGenerations = new Map<string, number>();

  const begin = (input: PhotoAnalysisTarget) => {
    const target = createPhotoAnalysisTarget(input);
    const key = photoAnalysisEntityKey(target);
    targets.set(key, target);
    attempts.set(key, entityAttempt(target));
    lastGenerations.set(key, Math.max(lastGenerations.get(key) || 0, target.generation));
    return target;
  };

  const beginAttempt = (
    input: Pick<PhotoAnalysisAttempt, 'projectId' | 'updateId' | 'photoId'>,
  ) => {
    const key = photoAnalysisEntityKey(input);
    const attempt = Object.freeze({
      ...input,
      generation: nextPhotoAnalysisGeneration(lastGenerations.get(key)),
    });
    attempts.set(key, attempt);
    lastGenerations.set(key, attempt.generation);
    targets.delete(key);
    return attempt;
  };

  const bindTargetIfCurrent = (
    attempt: PhotoAnalysisAttempt,
    input: Omit<PhotoAnalysisTarget, 'generation'>,
  ) => {
    const active = attempts.get(photoAnalysisEntityKey(attempt));
    if (!active || !photoAnalysisAttemptsMatch(attempt, active)) return null;
    if (!photoAnalysisAttemptsMatch(attempt, entityAttempt(input, attempt.generation))) return null;
    const target = createPhotoAnalysisTarget({ ...input, generation: attempt.generation });
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
    const activeAfterCommit = current(target);
    if (activeAfterCommit && photoAnalysisTargetsMatch(target, activeAfterCommit)) {
      const key = photoAnalysisEntityKey(target);
      targets.delete(key);
      const activeAttempt = attempts.get(key);
      if (activeAttempt && activeAttempt.generation === target.generation) attempts.delete(key);
    }
    return { committed: true };
  };

  const commitAttemptIfCurrent = (
    attempt: PhotoAnalysisAttempt,
    commit: () => void,
  ): PhotoAnalysisCommitResult => {
    const key = photoAnalysisEntityKey(attempt);
    const active = attempts.get(key);
    if (!active) return { committed: false, reason: 'missing_target' };
    if (!photoAnalysisAttemptsMatch(attempt, active)) {
      return { committed: false, reason: 'stale_target' };
    }
    commit();
    const activeAfterCommit = attempts.get(key);
    if (activeAfterCommit && photoAnalysisAttemptsMatch(attempt, activeAfterCommit)) {
      attempts.delete(key);
      targets.delete(key);
    }
    return { committed: true };
  };

  const invalidate = (
    target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
  ) => {
    const key = photoAnalysisEntityKey(target);
    const targetDeleted = targets.delete(key);
    const attemptDeleted = attempts.delete(key);
    return targetDeleted || attemptDeleted;
  };

  const invalidateMatching = (matches: (target: PhotoAnalysisAttempt) => boolean) => {
    const keys = new Set([...attempts, ...targets]
      .filter(([, target]) => matches(target))
      .map(([key]) => key));
    for (const key of keys) {
      targets.delete(key);
      attempts.delete(key);
    }
    return keys.size;
  };

  return {
    beginAttempt,
    bindTargetIfCurrent,
    commitAttemptIfCurrent,
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
    clear: () => {
      targets.clear();
      attempts.clear();
      // Retain per-entity generation watermarks so a late callback from
      // before an auth/scope reset can never match a later attempt.
    },
  };
}

function photoAnalysisEntityKey(
  target: Pick<PhotoAnalysisTarget, 'projectId' | 'updateId' | 'photoId'>,
) {
  return JSON.stringify([target.projectId, target.updateId, target.photoId]);
}

function entityAttempt(
  target: Pick<PhotoAnalysisAttempt, 'projectId' | 'updateId' | 'photoId'>,
  generation: number = (target as PhotoAnalysisAttempt).generation,
): PhotoAnalysisAttempt {
  return {
    projectId: target.projectId,
    updateId: target.updateId,
    photoId: target.photoId,
    generation,
  };
}

function photoAnalysisAttemptsMatch(
  left: PhotoAnalysisAttempt,
  right: PhotoAnalysisAttempt,
) {
  return left.projectId === right.projectId &&
    left.updateId === right.updateId &&
    left.photoId === right.photoId &&
    left.generation === right.generation;
}
