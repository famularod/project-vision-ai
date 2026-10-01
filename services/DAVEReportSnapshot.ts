import type { DAVEProjectTruth } from './DAVEProjectTruth';
import { parsePlainDate } from './ProjectDateTime';
import {
  normalizeScheduleStatus,
  scheduleProgressIsComplete,
} from './ScheduleProgressInvariant';

export const DAVE_REPORT_SNAPSHOT_VERSION = 'dave-report-snapshot/1.0' as const;

/**
 * The report format a reporting period belongs to. Owner answer Q17 (30 Sep
 * 2026): each format keeps its own "since the last report" period, so an
 * Executive Summary sent to leadership no longer starts the next period of
 * the team's Project Manager report, and the reverse.
 */
export type DAVEReportFormat = 'project_manager' | 'executive';

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
  /**
   * Exact authoritative document references used in the approved report.
   * Optional for backward compatibility with snapshots created before
   * document excerpts were connected.
   */
  sourceReferences?: readonly DAVEReportSnapshotSourceReference[];
  /**
   * The snapshot this one replaced, one level deep: the report the owner had
   * before this content was approved. Re-approving the same content (after
   * leaving the tab, or an unsent approval) must not make the report compare
   * against itself (whole-app audit A6, 29 Sep 2026).
   */
  supersedes?: DAVEReportSnapshot | null;
  /**
   * When this approved report was sent (email, text, copy or Outlook
   * completed); null while approved but not yet sent. Absent on snapshots
   * from before 30 Sep 2026, which count as sent. The reporting period runs
   * from the last report the owner received, not from an approval that was
   * never sent (whole-app audit A6, pass 2).
   */
  deliveredAt?: string | null;
  /**
   * The format whose period this is (owner answer Q17, 30 Sep 2026). Absent
   * on snapshots saved before then, when every format shared one period:
   * such a snapshot is each format's starting baseline until that format's
   * first report is sent.
   */
  reportFormat?: DAVEReportFormat;
}>;

/**
 * Which reporting period a snapshot is: its projects and, since owner answer
 * Q17, its report format. A Project Manager report and an Executive Summary
 * of the same projects share their facts and fingerprint, so the fingerprint
 * alone does not tell their periods apart.
 */
export function reportPeriodKey(snapshot: Pick<DAVEReportSnapshot, 'scopeKey' | 'reportFormat'>): string {
  return JSON.stringify([snapshot.scopeKey, snapshot.reportFormat ?? null]);
}

function wasDelivered(snapshot: DAVEReportSnapshot): boolean {
  return snapshot.deliveredAt !== null;
}

/** Saved before approvals kept their history: whether it went out is unknown, and it counts as sent. */
function isLegacySnapshot(snapshot: DAVEReportSnapshot): boolean {
  return snapshot.deliveredAt === undefined;
}

/**
 * The baseline a report with `currentFingerprint` is compared against: the
 * previous approved snapshot, unless that snapshot is this same content or
 * an approval that was never sent (then the one it superseded).
 *
 * The same content reads as it did when it was approved, before and after
 * it is sent: against the report it superseded, or, for a first report,
 * as the baseline it establishes (audit A6 pass 3: comparing a first
 * approval against itself changed the text under the approval and cleared
 * it). A legacy snapshot has no history and compares against itself with
 * zero change, as it always did.
 */
export function reportBaselineSnapshot(
  previous: DAVEReportSnapshot | null | undefined,
  currentFingerprint: string,
): DAVEReportSnapshot | null {
  if (!previous) return null;
  if (previous.sourceFingerprint === currentFingerprint) {
    return previous.supersedes ?? (isLegacySnapshot(previous) ? previous : null);
  }
  if (!wasDelivered(previous)) return previous.supersedes ?? null;
  return previous;
}

/**
 * What approving `current` saves: nothing when the same content is already
 * the saved snapshot; otherwise `current`, not yet sent, remembering the
 * report the owner has (the previous snapshot without its own history, or,
 * when that approval was never sent, the one it superseded).
 */
export function reportSnapshotToSave(
  current: DAVEReportSnapshot,
  previous: DAVEReportSnapshot | null | undefined,
): DAVEReportSnapshot | null {
  // The same projects and, since owner answer Q17, the same report format.
  const samePeriod = previous ? reportPeriodKey(previous) === reportPeriodKey(current) : false;
  if (previous && samePeriod && previous.sourceFingerprint === current.sourceFingerprint) {
    return null;
  }
  const pending = { ...current, deliveredAt: null };
  if (!previous || !samePeriod) return Object.freeze(pending);
  if (!wasDelivered(previous)) {
    return Object.freeze({ ...pending, supersedes: previous.supersedes ?? null });
  }
  const { supersedes: _older, ...superseded } = previous;
  return Object.freeze({ ...pending, supersedes: Object.freeze(superseded) });
}

/** The approved report went out. */
export function markReportSnapshotDelivered(snapshot: DAVEReportSnapshot, deliveredAt: string): DAVEReportSnapshot {
  return Object.freeze({ ...snapshot, deliveredAt });
}

/**
 * When the report this period runs from was sent: the snapshot's own send,
 * or, for an approval not yet sent, the send of the report it superseded;
 * null when none was sent. A legacy snapshot counts as sent when captured.
 */
export function reportPeriodSentAt(snapshot: DAVEReportSnapshot | null | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.deliveredAt === null) return reportPeriodSentAt(snapshot.supersedes);
  return snapshot.deliveredAt ?? snapshot.capturedAt;
}

function periodSentTime(snapshot: DAVEReportSnapshot) {
  const time = Date.parse(reportPeriodSentAt(snapshot) ?? '');
  return Number.isNaN(time) ? -Infinity : time;
}

/** Whether `snapshot`'s period runs from a report sent after `other`'s (or `other` has none). */
export function reportPeriodIsLater(snapshot: DAVEReportSnapshot, other: DAVEReportSnapshot | null | undefined): boolean {
  return !other || periodSentTime(snapshot) > periodSentTime(other);
}

/**
 * This device's period against the owner's shared copy (owner answer Q16, 30
 * Sep 2026: the phone and the iPad count from the same last sent report). The
 * later send wins. An approval not yet sent carries the send of the report it
 * superseded, so it never moves the period's start; on a tie this device's
 * own copy stays, with any approval of its own still waiting to be sent.
 */
export function laterReportPeriod(
  local: DAVEReportSnapshot | null,
  shared: DAVEReportSnapshot | null,
): DAVEReportSnapshot | null {
  if (!local) return shared;
  return shared && reportPeriodIsLater(shared, local) ? shared : local;
}

/**
 * `candidate` when its period runs from a report sent after the one `shown`
 * runs from, else null (whole-app audit A6 pass 7: the phone, left on the
 * Reports screen since morning, kept counting from its own morning send after
 * the iPad sent at midday, and its later send replaced the iPad's period with
 * its own older one). A period with no send (a first approval never sent) is
 * never later, and neither is one of `ownSends`: this device's own sends,
 * read back before the screen shows them. The other device can send the very
 * snapshot this one approved (it read the approval as its period), so only
 * the send time tells them apart.
 */
export function laterSentReportPeriod(
  candidate: DAVEReportSnapshot | null | undefined,
  shown: DAVEReportSnapshot | null | undefined,
  ownSends: ReadonlySet<string> = new Set(),
): DAVEReportSnapshot | null {
  return reportPeriodSentAfter(candidate, reportPeriodSentAt(shown), ownSends);
}

/**
 * `candidate` when its period runs from a report sent after `sentAt` (or
 * `sentAt` is null: no report sent), else null; never one of `ownSends`.
 * Whole-app audit A6 pass 8 M1 (30 Sep 2026): an approval is checked against
 * the period it was given on, which it remembers as this send time.
 */
export function reportPeriodSentAfter(
  candidate: DAVEReportSnapshot | null | undefined,
  sentAt: string | null,
  ownSends: ReadonlySet<string> = new Set(),
): DAVEReportSnapshot | null {
  const candidateSentAt = reportPeriodSentAt(candidate);
  if (!candidate || candidateSentAt === null || ownSends.has(candidateSentAt)) return null;
  const since = Date.parse(sentAt ?? '');
  return periodSentTime(candidate) > (Number.isNaN(since) ? -Infinity : since) ? candidate : null;
}

/** "at 12:05 PM" today; "on Sep 29 at 12:05 PM" another day (with the year when it is not this year). */
export function describeReportSendTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.toDateString() === now.toDateString()) return `at ${time}`;
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date);
  return `on ${day} at ${time}`;
}

export type DAVEReportSnapshotSourceReference = Readonly<{
  documentId: string;
  documentName: string;
  revision: string | null;
  pageNumber: number | null;
  sheetNumber: string | null;
  regionId: string | null;
  label: string;
  projectName: string;
  areaName: string;
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
  /** How many changes there were; `changes` lists the first 20 (A6 pass 8 L1). */
  changeCount?: number;
  /**
   * Every task (by its id now) with a change, the ones past the first 20
   * included, so a report adds no second "was updated." line for one (A6
   * pass 9 M1).
   */
  changedTaskIds?: readonly string[];
}>;

export function buildDAVEReportSnapshot({
  truths,
  scopeKey,
  sourceFingerprint,
  capturedAt,
  sourceReferences,
  reportFormat,
}: {
  truths: readonly DAVEProjectTruth[];
  scopeKey: string;
  sourceFingerprint: string;
  capturedAt?: string;
  sourceReferences?: readonly DAVEReportSnapshotSourceReference[];
  /** The format whose period this snapshot is (owner answer Q17). */
  reportFormat?: DAVEReportFormat;
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

  const snapshot: DAVEReportSnapshot = {
    version: DAVE_REPORT_SNAPSHOT_VERSION,
    scopeKey,
    capturedAt: validDate(capturedAt) || new Date().toISOString(),
    sourceFingerprint,
    tasks: Object.freeze(tasks),
    ...(sourceReferences
      ? {
          sourceReferences: Object.freeze(
            sourceReferences
              .map(reference => Object.freeze({ ...reference }))
              .sort((left, right) =>
                normalized(left.projectName).localeCompare(normalized(right.projectName)) ||
                normalized(left.areaName).localeCompare(normalized(right.areaName)) ||
                left.documentId.localeCompare(right.documentId),
              ),
          ),
        }
      : {}),
    ...(reportFormat ? { reportFormat } : {}),
  };
  return Object.freeze(snapshot);
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
  // A task on new dates in a revised schedule is a new row with the file's id
  // (whole-app audit A6 pass 8 M2): it is compared with the task the
  // previous report had, not listed as added and removed.
  const revisions = pairRevisedTasks(
    previous.tasks.filter(task => !currentById.has(task.taskId)),
    current.tasks.filter(task => !previousById.has(task.taskId)),
  );
  const revisedPriorIds = new Set([...revisions.values()].map(task => task.taskId));
  const changes: DAVEReportPeriodChange[] = [];

  for (const task of current.tasks) {
    const prior = previousById.get(task.taskId) ?? revisions.get(task);
    if (!prior) {
      changes.push(changeFor(task, 'added', `${task.taskName} was added to the project plan.`));
      continue;
    }
    const wasComplete = snapshotTaskIsComplete(prior);
    const isComplete = snapshotTaskIsComplete(task);
    const completionChanged = wasComplete !== isComplete;
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
    // "Was completed" (or reopened) already says it; the status line took a
    // second of the report's six lines for the same task (A6 pass 8 L1).
    if (!completionChanged && normalized(prior.status) !== normalized(task.status)) {
      changes.push(changeFor(task, 'status', `${task.taskName} changed from ${prior.status} to ${task.status}.`));
    }
    if (!sameCalendarDate(prior.finishDate, task.finishDate)) {
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
    if (currentById.has(task.taskId) || revisedPriorIds.has(task.taskId)) continue;
    changes.push(changeFor(task, 'removed', `${task.taskName} was removed from the current project plan.`));
  }

  const distinctChanges = dedupeChanges(changes);
  return Object.freeze({
    basis: 'previous_approved_report',
    label: `Since the report approved ${formatPeriodDate(previous.capturedAt)}`,
    startedAt: previous.capturedAt,
    endedAt: current.capturedAt,
    completeDelta: completeCount(current.tasks) - completeCount(previous.tasks),
    openDelta: openCount(current.tasks) - openCount(previous.tasks),
    overdueDelta: overdueCount(current.tasks) - overdueCount(previous.tasks),
    changes: Object.freeze(distinctChanges.slice(0, 20).map(change => Object.freeze(change))),
    changeCount: distinctChanges.length,
    changedTaskIds: Object.freeze([...new Set(distinctChanges.map(change => change.taskId))]),
  });
}

export function daveReportSnapshotScopeKey(projectNames: readonly string[]) {
  return projectNames
    .map(normalized)
    .filter(Boolean)
    .sort()
    .join('|') || 'selected-projects';
}

/**
 * The previous report's task each unmatched current task revises (whole-app
 * audit A6 pass 8 M2, 30 Sep 2026), paired as the schedule import pairs a
 * revised row with the saved task (ScheduleImportMerge pairTaskRevisions):
 * by project, task name and area, where a task the previous report had with
 * no area matches any area. Same-named tasks pair in finish-date order, and
 * only when there are as many of them before as now and no earlier task
 * could be either of two; otherwise they stay added and removed.
 *
 * Whole-app audit A6 pass 9 L1 (30 Sep 2026): finish order alone is not
 * enough. Two inspections whose finish order the revision swapped were
 * cross-paired: "+0 completed" yet "Inspection was completed." and "…was
 * reopened", owners swapped. The import pairs them in file order and keeps no
 * record of it on the new row, so same-named tasks pair in finish order only
 * when each pair also has the same status, completion and owner; otherwise
 * which is which cannot be told and they stay added and removed.
 */
function pairRevisedTasks(
  previous: readonly DAVEReportSnapshotTask[],
  current: readonly DAVEReportSnapshotTask[],
): Map<DAVEReportSnapshotTask, DAVEReportSnapshotTask> {
  const pairs = new Map<DAVEReportSnapshotTask, DAVEReportSnapshotTask>();
  if (!previous.length || !current.length) return pairs;
  const groups = new Map<string, DAVEReportSnapshotTask[]>();
  current.forEach(task => {
    const group = [task.projectName, task.taskName, task.areaName].map(normalized).join('|');
    groups.set(group, [...(groups.get(group) || []), task]);
  });
  const candidates = [...groups.values()].map(rows => ({
    rows,
    earlier: previous.filter(task => sameRevisedTask(task, rows[0])),
  }));
  const groupCount = new Map<DAVEReportSnapshotTask, number>();
  candidates.forEach(({ earlier }) => earlier.forEach(task => groupCount.set(task, (groupCount.get(task) || 0) + 1)));
  candidates
    .filter(({ rows, earlier }) => rows.length === earlier.length && earlier.every(task => groupCount.get(task) === 1))
    .forEach(({ rows, earlier }) => {
      const earlierInOrder = inFinishOrder(earlier);
      const rowsInOrder = inFinishOrder(rows);
      if (rows.length > 1 && !rowsInOrder.every((task, index) => sameStanding(earlierInOrder[index], task))) return;
      rowsInOrder.forEach((task, index) => pairs.set(task, earlierInOrder[index]));
    });
  return pairs;
}

/** The same status, completion and owner: what tells same-named tasks apart (A6 pass 9 L1). */
function sameStanding(earlier: DAVEReportSnapshotTask, now: DAVEReportSnapshotTask): boolean {
  return normalized(earlier.status) === normalized(now.status) &&
    snapshotTaskIsComplete(earlier) === snapshotTaskIsComplete(now) &&
    normalized(earlier.owner) === normalized(now.owner);
}

function sameRevisedTask(earlier: DAVEReportSnapshotTask, now: DAVEReportSnapshotTask): boolean {
  if (normalized(earlier.projectName) !== normalized(now.projectName)) return false;
  if (normalized(earlier.taskName) !== normalized(now.taskName)) return false;
  return !normalized(earlier.areaName) || normalized(earlier.areaName) === normalized(now.areaName);
}

function inFinishOrder(tasks: readonly DAVEReportSnapshotTask[]): DAVEReportSnapshotTask[] {
  const finish = (task: DAVEReportSnapshotTask) => parsePlainDate(task.finishDate) || '\uffff';
  return [...tasks].sort((left, right) =>
    finish(left).localeCompare(finish(right)) || left.taskId.localeCompare(right.taskId));
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

/**
 * The same calendar day in either stored form (whole-app audit A6 pass 5):
 * imported dates moved from "Jul 24, 2026" to "07/24/2026", and comparing the
 * text listed every imported task of the next report as a finish change.
 */
function sameCalendarDate(left: string | null | undefined, right: string | null | undefined) {
  if (left === right) return true;
  const leftDate = parsePlainDate(left);
  const rightDate = parsePlainDate(right);
  return Boolean(leftDate && rightDate && leftDate === rightDate);
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
