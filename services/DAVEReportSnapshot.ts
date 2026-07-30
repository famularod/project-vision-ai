import type { DAVEProjectTruth } from './DAVEProjectTruth';
import {
  normalizeScheduleStatus,
  scheduleProgressIsComplete,
} from './ScheduleProgressInvariant';

export const DAVE_REPORT_SNAPSHOT_VERSION = 'dave-report-snapshot/1.0' as const;

export type DAVEReportSnapshotTask = Readonly<{
  taskId: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  owner: string | null;
  status: string;
  percentComplete: number;
  finishDate: string | null;
  urgency: DAVEProjectTruth['schedule'][number]['urgency'];
  approvalStatus: string | null;
  estimatedScheduleImpactDays: number | null;
}>;

export type DAVEReportSnapshot = Readonly<{
  version: typeof DAVE_REPORT_SNAPSHOT_VERSION;
  scopeKey: string;
  capturedAt: string;
  sourceFingerprint: string;
  tasks: readonly DAVEReportSnapshotTask[];
}>;

export type DAVEReportPeriodChange = Readonly<{
  id: string;
  taskId: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  kind:
    | 'added'
    | 'removed'
    | 'completed'
    | 'reopened'
    | 'progress'
    | 'status'
    | 'finish_date'
    | 'owner'
    | 'area'
    | 'approval'
    | 'schedule_impact';
  summary: string;
}>;

export type DAVEReportPeriodComparison = Readonly<{
  basis: 'previous_approved_report' | 'current_snapshot';
  label: string;
  startedAt: string | null;
  endedAt: string;
  completeDelta: number;
  openDelta: number;
  overdueDelta: number;
  changes: readonly DAVEReportPeriodChange[];
}>;

export function buildDAVEReportSnapshot({
  truths,
  scopeKey,
  sourceFingerprint,
  capturedAt,
}: {
  truths: readonly DAVEProjectTruth[];
  scopeKey: string;
  sourceFingerprint: string;
  capturedAt?: string;
}): DAVEReportSnapshot {
  const tasks = truths.flatMap(truth => truth.schedule.map(task => Object.freeze({
    taskId: task.taskId,
    projectName: truth.projectName,
    taskName: task.taskName,
    areaName: clean(task.areaName) || null,
    owner: clean(task.owner) || null,
    status: clean(task.status),
    percentComplete: boundedPercent(task.percentComplete),
    finishDate: clean(task.finishDate) || null,
    urgency: task.urgency,
    approvalStatus: clean(task.approvalStatus) || null,
    estimatedScheduleImpactDays: finiteNumber(task.estimatedScheduleImpactDays),
  }))).sort((left, right) =>
    normalized(left.projectName).localeCompare(normalized(right.projectName)) ||
    normalized(left.taskName).localeCompare(normalized(right.taskName)) ||
    left.taskId.localeCompare(right.taskId),
  );

  return Object.freeze({
    version: DAVE_REPORT_SNAPSHOT_VERSION,
    scopeKey,
    capturedAt: validDate(capturedAt) || new Date().toISOString(),
    sourceFingerprint,
    tasks: Object.freeze(tasks),
  });
}

export function compareDAVEReportSnapshots({
  current,
  previous,
}: {
  current: DAVEReportSnapshot;
  previous?: DAVEReportSnapshot | null;
}): DAVEReportPeriodComparison {
  if (!previous || previous.scopeKey !== current.scopeKey) {
    return Object.freeze({
      basis: 'current_snapshot',
      label: 'Current reporting period',
      startedAt: null,
      endedAt: current.capturedAt,
      completeDelta: 0,
      openDelta: 0,
      overdueDelta: 0,
      changes: Object.freeze([]),
    });
  }

  const previousById = new Map(previous.tasks.map(task => [task.taskId, task]));
  const currentById = new Map(current.tasks.map(task => [task.taskId, task]));
  const changes: DAVEReportPeriodChange[] = [];

  for (const task of current.tasks) {
    const prior = previousById.get(task.taskId);
    if (!prior) {
      changes.push(changeFor(task, 'added', `${task.taskName} was added to the project plan.`));
      continue;
    }
    const wasComplete = snapshotTaskIsComplete(prior);
    const isComplete = snapshotTaskIsComplete(task);
    if (!wasComplete && isComplete) {
      changes.push(changeFor(task, 'completed', `${task.taskName} was completed.`));
    } else if (wasComplete && !isComplete) {
      changes.push(changeFor(task, 'reopened', `${task.taskName} was reopened at ${task.percentComplete}% complete.`));
    } else if (prior.percentComplete !== task.percentComplete) {
      changes.push(changeFor(
        task,
        'progress',
        `${task.taskName} moved from ${prior.percentComplete}% to ${task.percentComplete}% complete.`,
      ));
    }
    if (normalized(prior.status) !== normalized(task.status)) {
      changes.push(changeFor(task, 'status', `${task.taskName} changed from ${prior.status} to ${task.status}.`));
    }
    if (prior.finishDate !== task.finishDate) {
      changes.push(changeFor(
        task,
        'finish_date',
        `${task.taskName} finish changed from ${prior.finishDate || 'not set'} to ${task.finishDate || 'not set'}.`,
      ));
    }
    if (normalized(prior.owner) !== normalized(task.owner)) {
      changes.push(changeFor(
        task,
        'owner',
        `${task.taskName} owner changed from ${prior.owner || 'unassigned'} to ${task.owner || 'unassigned'}.`,
      ));
    }
    if (normalized(prior.areaName) !== normalized(task.areaName)) {
      changes.push(changeFor(
        task,
        'area',
        `${task.taskName} moved from ${prior.areaName || 'unassigned area'} to ${task.areaName || 'unassigned area'}.`,
      ));
    }
    if (normalized(prior.approvalStatus) !== normalized(task.approvalStatus)) {
      changes.push(changeFor(
        task,
        'approval',
        `${task.taskName} approval changed from ${prior.approvalStatus || 'not set'} to ${task.approvalStatus || 'not set'}.`,
      ));
    }
    if (prior.estimatedScheduleImpactDays !== task.estimatedScheduleImpactDays) {
      changes.push(changeFor(
        task,
        'schedule_impact',
        `${task.taskName} schedule impact changed from ${days(prior.estimatedScheduleImpactDays)} to ${days(task.estimatedScheduleImpactDays)}.`,
      ));
    }
  }

  for (const task of previous.tasks) {
    if (currentById.has(task.taskId)) continue;
    changes.push(changeFor(task, 'removed', `${task.taskName} was removed from the current project plan.`));
  }

  return Object.freeze({
    basis: 'previous_approved_report',
    label: `Since the report approved ${formatPeriodDate(previous.capturedAt)}`,
    startedAt: previous.capturedAt,
    endedAt: current.capturedAt,
    completeDelta: completeCount(current.tasks) - completeCount(previous.tasks),
    openDelta: openCount(current.tasks) - openCount(previous.tasks),
    overdueDelta: overdueCount(current.tasks) - overdueCount(previous.tasks),
    changes: Object.freeze(dedupeChanges(changes).slice(0, 20).map(change => Object.freeze(change))),
  });
}

export function daveReportSnapshotScopeKey(projectNames: readonly string[]) {
  return projectNames
    .map(normalized)
    .filter(Boolean)
    .sort()
    .join('|') || 'selected-projects';
}

function changeFor(
  task: DAVEReportSnapshotTask,
  kind: DAVEReportPeriodChange['kind'],
  summary: string,
): DAVEReportPeriodChange {
  return {
    id: `${task.taskId}:${kind}`,
    taskId: task.taskId,
    projectName: task.projectName,
    taskName: task.taskName,
    areaName: task.areaName,
    kind,
    summary,
  };
}

function snapshotTaskIsComplete(task: DAVEReportSnapshotTask) {
  return scheduleProgressIsComplete({
    status: normalizeScheduleStatus(task.status),
    percentComplete: task.percentComplete,
  });
}

function completeCount(tasks: readonly DAVEReportSnapshotTask[]) {
  return tasks.filter(snapshotTaskIsComplete).length;
}

function openCount(tasks: readonly DAVEReportSnapshotTask[]) {
  return tasks.length - completeCount(tasks);
}

function overdueCount(tasks: readonly DAVEReportSnapshotTask[]) {
  return tasks.filter(task => !snapshotTaskIsComplete(task) && task.urgency === 'overdue').length;
}

function dedupeChanges(changes: readonly DAVEReportPeriodChange[]) {
  const seen = new Set<string>();
  return changes.filter(change => {
    const key = `${change.taskId}|${change.kind}|${normalized(change.summary)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function days(value: number | null) {
  if (value === null) return 'not set';
  return `${value} day${Math.abs(value) === 1 ? '' : 's'}`;
}

function formatPeriodDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'previously';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boundedPercent(value: unknown) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return Number.isNaN(new Date(value).getTime()) ? '' : new Date(value).toISOString();
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
