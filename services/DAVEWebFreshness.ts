export const DAVE_WEB_FRESHNESS_STALE_AFTER_MS = 60_000;

export type DAVEWebFreshnessStatus =
  | 'connected'
  | 'reconnecting'
  | 'stale';

export type DAVEWebFreshnessState = Readonly<{
  status: DAVEWebFreshnessStatus;
  lastSuccessfulRefreshAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
}>;

export type DAVEWebFreshnessPresentation = Readonly<{
  title: string;
  badge: string;
  detail: string;
  tone: 'good' | 'attention' | 'danger';
  icon: 'cloud-done-outline' | 'sync-outline' | 'cloud-offline-outline';
}>;

export function presentDAVEWebFreshness(
  freshness: DAVEWebFreshnessState,
): DAVEWebFreshnessPresentation {
  if (freshness.status === 'reconnecting') {
    return Object.freeze({
      title: 'Reconnecting to the shared record',
      badge: 'Reconnecting',
      detail: 'The last confirmed project data remains available while Vitruvius retries.',
      tone: 'attention',
      icon: 'sync-outline',
    });
  }
  if (freshness.status === 'stale') {
    return Object.freeze({
      title: 'Cloud data needs a refresh',
      badge: 'Stale',
      detail: 'Use Sync Now before relying on this screen for current project decisions.',
      tone: 'danger',
      icon: 'cloud-offline-outline',
    });
  }
  return Object.freeze({
    title: 'Connected and up to date',
    badge: 'Connected',
    detail: 'This workspace reflects the latest confirmed shared project record.',
    tone: 'good',
    icon: 'cloud-done-outline',
  });
}

export function initialDAVEWebFreshnessState(): DAVEWebFreshnessState {
  return Object.freeze({
    status: 'stale',
    lastSuccessfulRefreshAt: null,
    lastAttemptAt: null,
    consecutiveFailures: 0,
  });
}

export function recordDAVEWebRefreshSuccess(
  refreshedAt: string,
): DAVEWebFreshnessState {
  return Object.freeze({
    status: 'connected',
    lastSuccessfulRefreshAt: refreshedAt,
    lastAttemptAt: refreshedAt,
    consecutiveFailures: 0,
  });
}

export function recordDAVEWebRefreshFailure(
  current: DAVEWebFreshnessState,
  attemptedAt: string,
  staleAfterMs = DAVE_WEB_FRESHNESS_STALE_AFTER_MS,
): DAVEWebFreshnessState {
  const lastSuccessMs = parseTimestamp(current.lastSuccessfulRefreshAt);
  const attemptMs = parseTimestamp(attemptedAt);
  const stale = lastSuccessMs === null ||
    attemptMs === null ||
    attemptMs - lastSuccessMs >= staleAfterMs;

  return Object.freeze({
    status: stale ? 'stale' : 'reconnecting',
    lastSuccessfulRefreshAt: current.lastSuccessfulRefreshAt,
    lastAttemptAt: attemptedAt,
    consecutiveFailures: current.consecutiveFailures + 1,
  });
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
