export type PIELiveAuthorityStateName =
  | 'loading'
  | 'ready'
  | 'degraded_local_only'
  | 'queued_for_cloud'
  | 'stale_model'
  | 'conflict_blocked'
  | 'blocked_identity'
  | 'blocked_organization'
  | 'persistence_failed'
  | 'unavailable';

export type PIELiveAuthorityMachinePhase =
  | 'loading'
  | 'fresh'
  | 'stale'
  | 'failed_retryable'
  | 'blocked';

export type PIELiveAuthorityResolution = {
  state: PIELiveAuthorityStateName;
  phase: PIELiveAuthorityMachinePhase;
  coreIsCurrent: boolean;
  mayPersistProjectTruth: boolean;
};

export const LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS = 3;
export const LIVE_AUTHORITY_RETRY_BASE_DELAY_MS = 1_000;

export function liveAuthorityRetryDelayMs(attempt: number) {
  const normalizedAttempt = Math.max(
    1,
    Math.min(LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS, Math.floor(attempt)),
  );
  return LIVE_AUTHORITY_RETRY_BASE_DELAY_MS * (2 ** (normalizedAttempt - 1));
}

export function resolvePIELiveAuthorityState({
  hydrated,
  refreshState,
  corePresent,
  currentSignature,
  acceptedSignature,
  currentGeneration,
  acceptedGeneration,
}: {
  hydrated: boolean;
  refreshState: PIELiveAuthorityStateName;
  corePresent: boolean;
  currentSignature: string;
  acceptedSignature: string | null;
  currentGeneration: string;
  acceptedGeneration: string | null;
}): PIELiveAuthorityResolution {
  if (!hydrated) {
    return resolution('loading', 'loading', false);
  }

  const coreIsCurrent = Boolean(
    corePresent &&
    acceptedSignature &&
    acceptedSignature === currentSignature &&
    acceptedGeneration !== null &&
    acceptedGeneration === currentGeneration,
  );

  if (!coreIsCurrent) {
    if (refreshState === 'loading' && !corePresent && acceptedSignature === null) {
      return resolution('loading', 'loading', false);
    }
    if (refreshState === 'unavailable') {
      return resolution('unavailable', 'failed_retryable', false);
    }
    if (
      refreshState === 'blocked_identity' ||
      refreshState === 'blocked_organization' ||
      refreshState === 'conflict_blocked' ||
      refreshState === 'persistence_failed'
    ) {
      return resolution(refreshState, 'blocked', false);
    }
    return resolution('stale_model', 'stale', false);
  }

  if (refreshState === 'loading') {
    return resolution('loading', 'loading', true);
  }
  if (refreshState === 'stale_model') {
    return resolution('stale_model', 'stale', true);
  }
  if (refreshState === 'unavailable') {
    return resolution('unavailable', 'failed_retryable', true);
  }
  if (
    refreshState === 'blocked_identity' ||
    refreshState === 'blocked_organization' ||
    refreshState === 'conflict_blocked' ||
    refreshState === 'persistence_failed'
  ) {
    return resolution(refreshState, 'blocked', true);
  }

  return resolution(refreshState, 'fresh', true, true);
}

function resolution(
  state: PIELiveAuthorityStateName,
  phase: PIELiveAuthorityMachinePhase,
  coreIsCurrent: boolean,
  mayPersistProjectTruth = false,
): PIELiveAuthorityResolution {
  return {
    state,
    phase,
    coreIsCurrent,
    mayPersistProjectTruth,
  };
}
