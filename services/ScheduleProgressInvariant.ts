import type { ScheduleStatus } from '../types';
import {
  classifyDAVECompletion,
  parseDAVEAssertions,
} from './DAVEAssertionParser';

const CANONICAL_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'Complete',
];

export type CanonicalScheduleProgress = Readonly<{
  status: ScheduleStatus;
  percentComplete: number;
}>;

export type ScheduleProgressEdit = Readonly<{
  status?: unknown;
  percentComplete?: unknown;
}>;

/**
 * Parses schedule status without treating negative completion phrases as
 * completion. Display variants are normalized to the four persisted enums.
 */
export function normalizeScheduleStatus(value: unknown): ScheduleStatus {
  if (typeof value !== 'string') return 'Not Started';
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const direct = CANONICAL_SCHEDULE_STATUSES.find(
    status => status.toLowerCase() === normalized,
  );
  if (direct) return direct;

  if (/\b(?:not\s+started|planned|scheduled)\b/.test(normalized)) return 'Not Started';
  if (/\b(?:waiting|on\s+hold|held)\b/.test(normalized)) return 'Waiting';
  if (/\b(?:in\s+progress|active|started|underway)\b/.test(normalized)) {
    return 'In Progress';
  }
  const parsed = parseDAVEAssertions(normalized);
  const completion = classifyDAVECompletion(parsed);
  if (completion === 'complete') return 'Complete';
  if (
    completion === 'not_complete' ||
    parsed.assertions.some(assertion => assertion.predicate === 'complete')
  ) return 'In Progress';
  return 'Not Started';
}

/**
 * Enforces the persisted invariant: a task is Complete exactly when its
 * bounded percent is 100. Positive progress cannot remain Not Started.
 */
export function reconcileScheduleProgress(
  statusValue: unknown,
  percentValue: unknown,
): CanonicalScheduleProgress {
  const status = normalizeScheduleStatus(statusValue);
  const numericPercent = typeof percentValue === 'number'
    ? percentValue
    : typeof percentValue === 'string' && percentValue.trim()
      ? Number(percentValue.replace('%', '').trim())
      : Number.NaN;
  let percentComplete = Number.isFinite(numericPercent)
    ? Math.max(0, Math.min(100, Math.round(numericPercent)))
    : status === 'Complete' ? 100 : 0;

  if (status === 'Complete' || percentComplete === 100) {
    return Object.freeze({ status: 'Complete', percentComplete: 100 });
  }
  if (status === 'Not Started' && percentComplete > 0) {
    return Object.freeze({ status: 'In Progress', percentComplete });
  }
  if (status === 'Not Started') percentComplete = 0;
  return Object.freeze({ status, percentComplete });
}

/**
 * Reconciles an intentional progress edit against the current task. This is
 * different from normalizing a stored record: changing just one control must
 * be allowed to reopen a completed task instead of the unchanged 100%/Complete
 * counterpart immediately forcing it closed again.
 */
export function reconcileScheduleProgressEdit(
  current: Pick<CanonicalScheduleProgress, 'status' | 'percentComplete'>,
  changes: ScheduleProgressEdit,
): CanonicalScheduleProgress {
  const statusProvided = Object.prototype.hasOwnProperty.call(changes, 'status');
  const percentProvided = Object.prototype.hasOwnProperty.call(changes, 'percentComplete');

  if (statusProvided && percentProvided) {
    return reconcileScheduleProgress(changes.status, changes.percentComplete);
  }

  const currentProgress = reconcileScheduleProgress(
    current.status,
    current.percentComplete,
  );

  if (statusProvided) {
    const status = normalizeScheduleStatus(changes.status);
    if (status === 'Complete') {
      return Object.freeze({ status: 'Complete', percentComplete: 100 });
    }
    if (status === 'Not Started') {
      return Object.freeze({ status: 'Not Started', percentComplete: 0 });
    }
    return Object.freeze({
      status,
      percentComplete: currentProgress.percentComplete === 100
        ? 99
        : currentProgress.percentComplete,
    });
  }

  if (percentProvided) {
    const numericPercent = typeof changes.percentComplete === 'number'
      ? changes.percentComplete
      : typeof changes.percentComplete === 'string' && changes.percentComplete.trim()
        ? Number(changes.percentComplete.replace('%', '').trim())
        : Number.NaN;
    const percentComplete = Number.isFinite(numericPercent)
      ? Math.max(0, Math.min(100, Math.round(numericPercent)))
      : currentProgress.percentComplete;

    if (percentComplete === 100) {
      return Object.freeze({ status: 'Complete', percentComplete: 100 });
    }
    return Object.freeze({
      status: percentComplete === 0 ? 'Not Started' : 'In Progress',
      percentComplete,
    });
  }

  return currentProgress;
}

export function scheduleProgressIsComplete(
  value: Pick<CanonicalScheduleProgress, 'status' | 'percentComplete'>,
) {
  return value.status === 'Complete' && value.percentComplete === 100;
}
