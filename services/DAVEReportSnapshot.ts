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
  /**
   * The ids this task had before new masters moved its dates, oldest first:
   * the ids the import recorded on the revised row (revisedFromTaskIds).
   * Whole-app audit A6 pass 12 L1 (30 Sep 2026): a revised task is paired
   * with the earlier report's task by these first. Absent when there are
   * none, and on snapshots saved before then (read with `earlierIdsOf`).
   */
  earlierTaskIds?: readonly string[];
  /**
   * What the task says, as one key (`reportTaskContentKey`): every field
   * David can see or edit on it, never its ids or times. Whole-app audit A6
   * pass 13 M1 (1 Oct 2026): a task whose key is the one the earlier report
   * saved gets no "was updated." line. Absent on snapshots saved before then
   * (those count as before), and ignored by builds before then.
   */
  contentKey?: string;
  /**
   * The task's latest activity, as one short key (`reportTaskActivityKey`):
   * its time and text hashed, never the text. Whole-app audit A6 pass 14 L2
   * (1 Oct 2026): a task whose latest activity is not the one the earlier
   * report saved says it, whatever its time. Absent on snapshots saved before
   * then (those go by the activity's time), and ignored by builds before then.
   */
  activityKey?: string;
  /**
   * When the task's latest activity was made (its time only, never its
   * text). Whole-app audit A6 pass 15 L2 (1 Oct 2026): against a row that
   * saved one, a different latest activity is said only when it is newer, so
   * a latest note lost to the other device's copy does not bring back the
   * older one. Absent for a task with no activity, on snapshots saved before
   * then (those keep the key's rule), and ignored by builds before then.
   */
  activityAt?: string;
  /**
   * When this task last changed on the device that saved the snapshot, saved
   * by A6 pass 9 M2 only (30 Sep 2026). No longer saved or read: a row's
   * update time also moves for a note or an owner change, so it could not
   * tell whose copy of the task was behind (A6 pass 10 M1). Whether this
   * device has the other device's changes is told by when it last downloaded
   * the tasks instead (`otherDeviceSendNotReceived`).
   */
  updatedAt?: string | null;
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
   * The snapshot this one replaced: the report the owner had before this
   * content was approved. Re-approving the same content (after leaving the
   * tab, or an unsent approval) must not make the report compare against
   * itself (whole-app audit A6, 29 Sep 2026). That report keeps the one it
   * replaced in turn, and no more (A6 pass 16 L1, 1 Oct 2026: a task a master
   * change moved onto another row is checked against it), so the report
   * reads the same once approved and once sent.
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
  /**
   * The install that sent this report: a random id each installed app makes
   * once and keeps on that device (never an account or anything that
   * identifies the owner). Whole-app audit A6 pass 9 L2 (30 Sep 2026): after
   * a relaunch the app could not tell its own send from the other device's,
   * and nothing said the other device had already sent the report on screen.
   * Absent on reports sent before then, and on approvals not yet sent.
   */
  sentBy?: string;
  /**
   * When the owner recorded, in Reports, a report he sent another way: a
   * Mail draft he sent later, Outlook after "Not yet", or the Word file from
   * a laptop (everyday item 1, 2 Oct 2026). `deliveredAt` is when he says it
   * went out; this is when he said so. Absent on a send from the app, which
   * is recorded as it completes. Another device's download counts as having
   * this report's changes only once it started after both (`reportSendCountsFrom`).
   */
  markedSentAt?: string;
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
 * report the owner has (the previous snapshot, or, when that approval was
 * never sent, the one it superseded), with the report before that one and
 * no more (A6 pass 16 L1).
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
    return Object.freeze({ ...pending, supersedes: previous.supersedes ? withReportBefore(previous.supersedes) : null });
  }
  return Object.freeze({ ...pending, supersedes: withReportBefore(previous) });
}

/**
 * A saved report with the report it replaced, but not that one's own history
 * (whole-app audit A6 pass 16 L1, 1 Oct 2026). The comparison reads the
 * report before the one a period counts from. Once David approved, the
 * period counted from the approval's history, which kept one level, so that
 * report was gone and the text changed under the approval (A6 pass 3).
 */
function withReportBefore(snapshot: DAVEReportSnapshot): DAVEReportSnapshot {
  const { supersedes: older, ...report } = snapshot;
  if (!older) return Object.freeze(report);
  const { supersedes: _deeper, ...before } = older;
  return Object.freeze({ ...report, supersedes: Object.freeze(before) });
}

/**
 * The approved report went out, from the install `sentBy` when it is known (A6 pass 9 L2).
 * `markedSentAt`: the owner recorded the send afterwards, at that time (everyday item 1).
 */
export function markReportSnapshotDelivered(
  snapshot: DAVEReportSnapshot,
  deliveredAt: string,
  sentBy?: string | null,
  markedSentAt?: string | null,
): DAVEReportSnapshot {
  const { sentBy: _earlierSender, markedSentAt: _earlierMark, ...approved } = snapshot;
  return Object.freeze({
    ...approved,
    deliveredAt,
    ...(sentBy ? { sentBy } : {}),
    ...(markedSentAt ? { markedSentAt } : {}),
  });
}

/**
 * The time another device's download must start after to have the changes
 * behind `send`: its send time, or, for a send the owner recorded afterwards
 * (everyday item 1), the later of that and when he recorded it. Until then
 * the sending device may not have uploaded them.
 */
export function reportSendCountsFrom(send: Pick<DAVEReportSnapshot, 'deliveredAt' | 'markedSentAt'>): number {
  const sent = Date.parse(send.deliveredAt ?? '');
  const marked = Date.parse(send.markedSentAt ?? '');
  return Number.isNaN(marked) ? sent : Math.max(sent, marked);
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

/**
 * The sent report a period runs from: the snapshot itself once sent, or, for
 * an approval not yet sent, the report it superseded; null when none was sent.
 */
export function reportPeriodSend(snapshot: DAVEReportSnapshot | null | undefined): DAVEReportSnapshot | null {
  if (!snapshot) return null;
  return snapshot.deliveredAt === null ? reportPeriodSend(snapshot.supersedes) : snapshot;
}

/**
 * The other device's send this device may not have the changes behind, or
 * null (whole-app audit A6 pass 10 M1, M2, L2, 30 Sep 2026).
 *
 * The report this one counts from (`period`) was sent by the other install
 * (it carries a sender id and is not one of `ownSends`) and its facts differ
 * from this device's (`currentFingerprint`); this device is behind when it
 * has not downloaded every task since. A download counts when it started
 * after the send (`pulledAt` later than the send time), or, whatever the
 * other device's clock said, at or after this app session first saw the send
 * (`seenAt`, this device's clock). So it never waits once such a download
 * has landed, and Settings › Sync Now always ends it. A send with the same
 * facts as this device has never waits.
 *
 * Whole-app audit A6 pass 11 L3 (30 Sep 2026): a send without a sender id
 * never waited either, so an iPad that could not read its Keychain at send
 * turned the rule off on the phone. A send with no id (one made while the
 * Keychain could not be read, or by a build before A6 pass 9) that is not one
 * of `ownSends` (this device knows its own by their send time) is now taken
 * for the other install's: at worst this device waits for a download.
 *
 * Everyday item 1 (2 Oct 2026): a send the owner recorded afterwards counts
 * from when he recorded it too (`reportSendCountsFrom`), so a download made
 * between the send he names and his record is not taken as having it.
 */
export function otherDeviceSendNotReceived({
  period,
  currentFingerprint,
  ownSends,
  pulledAt,
  seenAt,
}: {
  period: DAVEReportSnapshot | null | undefined;
  currentFingerprint: string;
  ownSends: ReadonlySet<string>;
  /** When this device's last download of every task started, or null for none recorded. */
  pulledAt: string | null;
  /** When this app session first saw the send, or null. */
  seenAt?: string | null;
}): DAVEReportSnapshot | null {
  const send = reportPeriodSend(period);
  if (typeof send?.deliveredAt !== 'string' || ownSends.has(send.deliveredAt)) return null;
  if (send.sourceFingerprint === currentFingerprint) return null;
  const pulled = Date.parse(pulledAt ?? '');
  if (Number.isNaN(pulled)) return send;
  if (pulled > reportSendCountsFrom(send)) return null;
  const seen = Date.parse(seenAt ?? '');
  return !Number.isNaN(seen) && pulled >= seen ? null : send;
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
  /**
   * Every task (by its id now) paired with a task of the earlier report (by
   * id, by its earlier ids, or as a revision) whose content key is its own:
   * nothing David can see on it changed, so the report adds no "was
   * updated." line for it (A6 pass 13 M1). Not listed against a task saved
   * with no content key.
   */
  unchangedTaskIds?: readonly string[];
  /**
   * Every task (by its id now) whose own row in the earlier report saved a
   * latest activity that is not its own: the report says that activity even
   * when its time is before the earlier report (A6 pass 14 L2: a note made
   * offline on the other device before the send). Not listed against a task
   * saved with no activity key. A task paired with a different row across a
   * master change (A6 pass 15 L1) is listed by its own row in the report
   * before the earlier one, or when its activity is newer than that report
   * (A6 pass 16 L1); otherwise it goes by time.
   */
  newActivityTaskIds?: readonly string[];
  /**
   * Every task whose own row in the earlier report saved its latest
   * activity: that activity was there for the earlier report, so it is not
   * said again, whatever its time (A6 pass 14 L2). Also every task whose
   * latest activity is no newer than the one its row saved (A6 pass 15 L2:
   * a lost latest note does not bring back the older one), the row in the
   * report before the earlier one for a task paired across a master change
   * (A6 pass 16 L1).
   */
  sameActivityTaskIds?: readonly string[];
  /**
   * Not counted: the report this one counts from was sent by the other
   * device after this device last downloaded the tasks, so any difference
   * could be the other device's change read backwards (A6 pass 10 M1, M2).
   * No deltas and no changes until this device has the tasks.
   */
  waitingForOtherDevice?: boolean;
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
    ...withEarlierIds(task),
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
    contentKey: reportTaskContentKey(truth.projectName, task),
    activityKey: reportTaskActivityKey(task),
    ...(validDate(task.latestActivityAt) ? { activityAt: validDate(task.latestActivityAt) } : {}),
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
  // previous report had, not listed as added and removed. By the ids the
  // import recorded first (A6 pass 12 L1); by name only for tasks with none.
  const linked = linkTasksById(previous.tasks, current.tasks);
  const revisions = pairRevisedTasks(
    previous.tasks.filter(task => !currentById.has(task.taskId) && !linked.previous.has(task)),
    current.tasks.filter(task => !previousById.has(task.taskId) && !linked.current.has(task)),
  );
  const revisedPriorIds = new Set([...linked.pairs.values(), ...revisions.values()].map(task => task.taskId));
  const changes: DAVEReportPeriodChange[] = [];
  const unchangedTaskIds = new Set<string>();
  const newActivityTaskIds = new Set<string>();
  const sameActivityTaskIds = new Set<string>();
  // The report before the earlier one, when it was kept (A6 pass 16 L1).
  const reportBefore = previous.supersedes?.scopeKey === previous.scopeKey ? previous.supersedes : null;
  const reportBeforeById = new Map((reportBefore?.tasks ?? []).map(task => [task.taskId, task]));

  // Whole-app audit A6 pass 10 M1 (30 Sep 2026): pass 9 held back a task
  // whose copy in the earlier report was the newer row. A note or owner
  // change on this device stamps the row too, so a device behind on the
  // other device's progress read it backwards anyway. Whether this device
  // has the other device's changes is now told for the whole report, by
  // when it last downloaded the tasks (`otherDeviceSendNotReceived`).
  for (const task of current.tasks) {
    const prior = previousById.get(task.taskId) ?? linked.pairs.get(task) ?? revisions.get(task);
    if (!prior) {
      changes.push(changeFor(task, 'added', `${task.taskName} was added to the project plan.`));
      // Whole-app audit A6 pass 19 L3 (1 Oct 2026): a report went out while a master without Cleanup was
      // current, and Cleanup came back. Its note made after the report before that one ("Dumpster
      // ordered.") was older than the earlier report, so the time rule never said it. A task the earlier
      // report did not have is checked against the report before it, as a row paired across a master
      // change is (A6 pass 16 L1); failing that, the time rule stands.
      const activity = activityAgainstReportBefore(task, reportBefore, reportBeforeById.get(task.taskId));
      if (activity) (activity === 'new' ? newActivityTaskIds : sameActivityTaskIds).add(task.taskId);
      continue;
    }
    if (sameContent(prior, task)) unchangedTaskIds.add(task.taskId);
    // Whole-app audit A6 pass 15 L1 (1 Oct 2026): the keys only for the same
    // row. Going back to master F paired F's row with M's row through M's
    // earlier ids; M's row had no note, so F's old note read as new. A row
    // paired across a master change is checked against the report before the
    // earlier one (A6 pass 16 L1), and failing that keeps the time rule.
    const activity = prior.taskId === task.taskId
      ? activityAgainstOwnRow(prior, task)
      : activityAgainstReportBefore(task, reportBefore, reportBeforeById.get(task.taskId));
    if (activity) (activity === 'new' ? newActivityTaskIds : sameActivityTaskIds).add(task.taskId);
    changes.push(...changesBetween(prior, task));
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
    unchangedTaskIds: Object.freeze([...unchangedTaskIds]),
    newActivityTaskIds: Object.freeze([...newActivityTaskIds]),
    sameActivityTaskIds: Object.freeze([...sameActivityTaskIds]),
  });
}

/**
 * The comparison, not counted while this device waits for the other
 * device's changes (A6 pass 10 M1, M2): no deltas and no changes.
 */
export function reportPeriodWaitingForOtherDevice(period: DAVEReportPeriodComparison): DAVEReportPeriodComparison {
  if (period.basis !== 'previous_approved_report') return period;
  return Object.freeze({
    ...period,
    completeDelta: 0,
    openDelta: 0,
    overdueDelta: 0,
    changes: Object.freeze([]),
    changeCount: 0,
    changedTaskIds: Object.freeze([]),
    unchangedTaskIds: Object.freeze([]),
    newActivityTaskIds: Object.freeze([]),
    sameActivityTaskIds: Object.freeze([]),
    waitingForOtherDevice: true,
  });
}

/** What changed in one task between the earlier report and now. */
function changesBetween(prior: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask): DAVEReportPeriodChange[] {
  const changes: DAVEReportPeriodChange[] = [];
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
  return changes;
}

export function daveReportSnapshotScopeKey(projectNames: readonly string[]) {
  return projectNames
    .map(normalized)
    .filter(Boolean)
    .sort()
    .join('|') || 'selected-projects';
}

/** The earlier ids a snapshot task carries, read as stored (a snapshot saved before A6 pass 12 has none). */
function earlierIdsOf(task: Pick<DAVEReportSnapshotTask, 'taskId' | 'earlierTaskIds'>): string[] {
  const listed: readonly unknown[] = Array.isArray(task.earlierTaskIds) ? task.earlierTaskIds : [];
  return [...new Set(listed.map(clean).filter(id => id && id !== task.taskId))];
}

function withEarlierIds(task: Pick<DAVEReportSnapshotTask, 'taskId' | 'earlierTaskIds'>) {
  const earlierTaskIds = earlierIdsOf(task);
  return earlierTaskIds.length > 0 ? { earlierTaskIds: Object.freeze(earlierTaskIds) } : {};
}

/** Which fields a content key covers; a key made from another list never equals this one's. */
const TASK_CONTENT_KEY_VERSION = 'task-content/1';

/**
 * What a task says, as one key (whole-app audit A6 pass 13 M1, 1 Oct 2026).
 * "Delete PDF + Items" writes the removed rows' ids onto the tasks shown that
 * answer to them and stamps their update time, so every device takes the ids
 * (that stamp stays: rows sync by it). The report said "<task> was updated."
 * for any task stamped since the last report with no compared change, so an
 * ids-only write read as one line per moved task to the client.
 *
 * The key covers what David can see or edit on the task: its project, name,
 * type, area, owner, assignee, contractor, trade and next step; status,
 * percent, duration, start, finish and baseline dates, milestone and how many
 * predecessors it has; approval, workflow stage, response date and
 * reference; checklist counts; schedule impact days, confidence and impact
 * notes. The task's own notes are not in Project Truth, so not here: a
 * notes-only change no longer reads "was updated." It leaves out ids (its own, its earlier ids and its predecessors' ids,
 * which change when masters move rows), times (updated, updated by, latest
 * activity, which has its own line), and what is worked out from today or
 * from evidence (urgency, completion state, verification, related evidence,
 * contradictions). Dates are compared as calendar days.
 */
function reportTaskContentKey(projectName: string, task: DAVEProjectTruth['schedule'][number]): string {
  const text = (value: unknown) => clean(value) || null;
  const day = (value: unknown) => parsePlainDate(value) || text(value);
  const predecessors = Array.isArray(task.predecessorTaskIds) ? task.predecessorTaskIds.length : 0;
  return `${TASK_CONTENT_KEY_VERSION}:${contentHash(JSON.stringify([
    text(projectName), text(task.taskName), text(task.itemType), text(task.areaName),
    text(task.owner), text(task.assignee), text(task.contractor), text(task.trade), text(task.nextAction),
    text(task.status), finiteNumber(task.percentComplete), finiteNumber(task.durationWeight),
    day(task.startDate), day(task.finishDate), day(task.baselineStartDate), day(task.baselineFinishDate),
    Boolean(task.isMilestone), predecessors,
    text(task.approvalStatus), text(task.workflowStage), day(task.responseDueDate), text(task.referenceNumber),
    finiteNumber(task.checklistTotal), finiteNumber(task.checklistComplete),
    finiteNumber(task.estimatedScheduleImpactDays), text(task.impactConfidence), text(task.impactNotes),
  ]))}`;
}

/** Which activity fields an activity key covers. */
const TASK_ACTIVITY_KEY_VERSION = 'task-activity/1';

/**
 * The task's latest activity, as one key (whole-app audit A6 pass 14 L2, 1
 * Oct 2026): its time and its text, hashed together (the text is never
 * saved); the same key for every task with none. a1d5e2f said an activity
 * only when its time fell after the earlier report, so a note David made on
 * the iPad offline at 17:00, before the phone sent at 18:00 without it and
 * received the next day, was never said, and a later edit read "Pour slab
 * was updated." instead. Project Truth keeps no activity id, so the time and
 * text stand for it.
 */
function reportTaskActivityKey(task: DAVEProjectTruth['schedule'][number]): string {
  const at = clean(task.latestActivityAt);
  return `${TASK_ACTIVITY_KEY_VERSION}:${contentHash(JSON.stringify([validDate(at) || at, clean(task.latestActivitySummary)]))}`;
}

/**
 * Whether the task's latest activity is newer than the one its row saved in
 * the earlier report (whole-app audit A6 pass 15 L2, 1 Oct 2026). Pour slab
 * had N1 (Sep 20) and N2 (Sep 28) and a report said N2; the row's notes then
 * came from the other device's copy, which never had N2, and the next report
 * said N1 again as new. An older or same-time activity is not new. A row
 * saved with no time (no activity then, or a snapshot from before this)
 * counts as newer, so the key alone decides, as in A6 pass 14 L2.
 */
function activityAfterSaved(prior: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask): boolean {
  const saved = validDate(prior.activityAt);
  if (!saved) return true;
  return activityAfter(task, saved);
}

/** Whether the task's latest activity was made after `time`; false when it has none. */
function activityAfter(task: DAVEReportSnapshotTask, time: string): boolean {
  const latest = validDate(task.activityAt);
  return Boolean(latest) && new Date(latest).getTime() > new Date(time).getTime();
}

/**
 * The task's latest activity against its own row in a saved report (A6 pass
 * 14 L2, pass 15 L2): new when it is not the one the row saved and is newer;
 * otherwise the same. Unknown (null) against a row saved with no key.
 */
function activityAgainstOwnRow(saved: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask): 'new' | 'same' | null {
  if (typeof saved.activityKey !== 'string') return null;
  return saved.activityKey !== task.activityKey && activityAfterSaved(saved, task) ? 'new' : 'same';
}

/**
 * The latest activity of a task paired with a different row of the earlier
 * report across a master change (whole-app audit A6 pass 16 L1, 1 Oct 2026).
 * 131a9b9 (A6 pass 15 L1) left these to the activity's time, so a note that
 * never reached a report was dropped: the iPad, offline, approved master M
 * at 17:30 and noted M's Pour slab at 17:45, the phone sent its report under
 * F at 18:00, and the next report said only the finish change. So too a note
 * made on F's row after a report, when M was approved before the next one
 * and F set active again after it.
 *
 * The earlier report never had this row, so it is checked against the report
 * before that one (`reportBefore`): against its own row there, as for the
 * same row; with no own row there (or one saved with no key), an activity
 * made after that report is new (no report that showed the row was made
 * after it). Otherwise unknown (null) and the time decides. Known gap: a note older than `reportBefore`, on a row
 * neither report had (masters switched back and forth more than two reports
 * deep, or no report before the earlier one), still goes by the time.
 */
function activityAgainstReportBefore(
  task: DAVEReportSnapshotTask,
  reportBefore: DAVEReportSnapshot | null,
  ownRow: DAVEReportSnapshotTask | undefined,
): 'new' | 'same' | null {
  if (!reportBefore) return null;
  const againstOwnRow = ownRow ? activityAgainstOwnRow(ownRow, task) : null;
  if (againstOwnRow) return againstOwnRow;
  const before = validDate(reportBefore.capturedAt);
  return before && activityAfter(task, before) ? 'new' : null;
}

/** Whether a task says what the earlier report's task said; unknown (false) when either was saved with no key. */
function sameContent(prior: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask): boolean {
  return typeof prior.contentKey === 'string' && prior.contentKey === task.contentKey;
}

/** FNV-1a, as the report's fingerprint hashes (DAVEReportIntelligence). */
function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type TaskIdLinks = Readonly<{
  /** Each current task and the earlier report's task it is by id. */
  pairs: ReadonlyMap<DAVEReportSnapshotTask, DAVEReportSnapshotTask>;
  /** Earlier tasks a current task answers to: never paired by name. */
  previous: ReadonlySet<DAVEReportSnapshotTask>;
  /** Current tasks that answer to an earlier task: never paired by name. */
  current: ReadonlySet<DAVEReportSnapshotTask>;
}>;

/**
 * Whole-app audit A6 pass 12 L1 (30 Sep 2026): the report paired a revised
 * task by name, area and a tie-break, and cross-paired two "Inspection" tasks
 * the import had paired by file order: "moved from 40% to 50%" and "finish
 * changed from 2026-10-01 to 2026-12-08", which no task did, while field
 * updates and Project Truth followed the import. A task now answers to its
 * own id and the ids it had before new masters moved it (the import's
 * revisedFromTaskIds): a current task not in the earlier report by its own
 * id is the earlier task that answers to one of the same ids. Only one to
 * one: a task that could be either of two earlier tasks, or one of two that
 * could be the same earlier task, is neither, and none of them is paired by
 * name (never a guess against the ids). Tasks with no such link (rows saved
 * before the import kept earlier ids) are left to `pairRevisedTasks`.
 */
function linkTasksById(
  previous: readonly DAVEReportSnapshotTask[],
  current: readonly DAVEReportSnapshotTask[],
): TaskIdLinks {
  const answersTo = (task: DAVEReportSnapshotTask) => [task.taskId, ...earlierIdsOf(task)];
  const previousIds = new Set(previous.map(task => task.taskId));
  const currentIds = new Set(current.map(task => task.taskId));
  const previousByAnyId = new Map<string, DAVEReportSnapshotTask[]>();
  previous.forEach(task => answersTo(task).forEach(id => {
    previousByAnyId.set(id, [...(previousByAnyId.get(id) || []), task]);
  }));
  const linkedPrevious = new Set<DAVEReportSnapshotTask>();
  const linkedCurrent = new Set<DAVEReportSnapshotTask>();
  const claims = new Map<DAVEReportSnapshotTask, DAVEReportSnapshotTask[]>();
  const matchesOf = new Map<DAVEReportSnapshotTask, DAVEReportSnapshotTask[]>();
  current.filter(task => !previousIds.has(task.taskId)).forEach(task => {
    const matches = [...new Set(answersTo(task).flatMap(id => previousByAnyId.get(id) || []))];
    if (matches.length === 0) return;
    linkedCurrent.add(task);
    matchesOf.set(task, matches);
    matches
      .filter(prior => !currentIds.has(prior.taskId))
      .forEach(prior => {
        linkedPrevious.add(prior);
        claims.set(prior, [...(claims.get(prior) || []), task]);
      });
  });
  const pairs = new Map<DAVEReportSnapshotTask, DAVEReportSnapshotTask>();
  matchesOf.forEach((matches, task) => {
    const [prior] = matches;
    if (matches.length === 1 && !currentIds.has(prior.taskId) && claims.get(prior)?.length === 1) pairs.set(task, prior);
  });
  return Object.freeze({ pairs, previous: linkedPrevious, current: linkedCurrent });
}

/**
 * The previous report's task each unmatched current task revises (whole-app
 * audit A6 pass 8 M2, 30 Sep 2026), paired as the schedule import pairs a
 * revised row with the saved task (ScheduleImportMerge pairTaskRevisions):
 * by project, task name and area, where a task the previous report had with
 * no area matches any area. Same-named tasks pair only when there are as
 * many of them before as now and no earlier task could be either of two;
 * otherwise they stay added and removed.
 *
 * Whole-app audit A6 pass 9 L1 (30 Sep 2026): finish order alone is not
 * enough. Two inspections whose finish order the revision swapped were
 * cross-paired: "+0 completed" yet "Inspection was completed." and "…was
 * reopened", owners swapped. The import pairs them in file order and keeps no
 * record of it on the new row.
 *
 * Whole-app audit A6 pass 10 L1 (30 Sep 2026): pass 9 then paired them only
 * when every pair in finish order had the same status, completion and owner,
 * so Dana's and Eli's inspections, both moved and Dana's completed, read as
 * two added and two removed and the completion was never named. Same-named
 * tasks now pair the way with the fewest status, completion and owner
 * differences (`pairByStanding`); only a tie between ways that would say
 * different things leaves them added and removed.
 *
 * Since A6 pass 12 L1 only tasks with no id link reach here
 * (`linkTasksById`): rows a new master saved before the import kept the ids
 * a task had before.
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
      const order = pairByStanding(inFinishOrder(earlier), inFinishOrder(rows));
      order?.forEach(([prior, task]) => pairs.set(task, prior));
    });
  return pairs;
}

/** Above this many same-named tasks the ways to pair them are not tried; they pair only when finish order agrees. */
const MOST_SAME_NAMED_TO_PAIR = 6;

/**
 * How same-named tasks pair (A6 pass 10 L1): the way with the fewest status,
 * completion and owner differences. Several ways tie when the tasks cannot be
 * told apart by those; when tied ways say different things about status,
 * completion or owner (both reassigned, to whom unknown), none: null. Both
 * lists are in finish order and the same length.
 *
 * Whole-app audit A6 pass 11 L2 (30 Sep 2026): finish order then picked
 * among the tied ways, and could print a change no task made. A at 50% due
 * Oct 1 and B at 10% due Oct 20; the revision completed B on Oct 2 and moved
 * A to Oct 30. Finish order paired A with the completed task and B with A's
 * row: "Inspection moved from 10% to 50% complete." and two false finish
 * changes. A tie now goes to the way that moves the tasks least
 * (`movement`), finish order first among equals; when ways that move as
 * little would still print different lines, none.
 *
 * Whole-app audit A6 pass 12 L1 (30 Sep 2026): the percent change came
 * first, so a revision that re-dated both by a week, one percent raised and
 * the other lowered, was cross-paired by the smaller percent change and
 * printed two finish changes of two months. How far the finish dates moved
 * now comes first, as finish order did in pass 10 and as the import pairs a
 * revision (in file order). Pass 11's case pairs the same way the import
 * does: the task due first is the one completed.
 */
function pairByStanding(
  earlier: readonly DAVEReportSnapshotTask[],
  now: readonly DAVEReportSnapshotTask[],
): [DAVEReportSnapshotTask, DAVEReportSnapshotTask][] | null {
  type Pairs = [DAVEReportSnapshotTask, DAVEReportSnapshotTask][];
  const inOrder = now.map((task, index) => [earlier[index], task] as [DAVEReportSnapshotTask, DAVEReportSnapshotTask]);
  if (now.length === 1) return inOrder;
  if (now.length > MOST_SAME_NAMED_TO_PAIR) {
    return inOrder.every(([prior, task]) => standingDifferences(prior, task) === 0) ? inOrder : null;
  }
  // The ways with the fewest status, completion and owner differences, finish order first.
  let fewest: Pairs[] = [];
  let fewestCost = Infinity;
  for (const order of orderings(now.length)) {
    const pairs: Pairs = order.map((nowIndex, index) => [earlier[index], now[nowIndex]]);
    const cost = pairs.reduce((total, [prior, task]) => total + standingDifferences(prior, task), 0);
    if (cost > fewestCost) continue;
    if (cost < fewestCost) fewest = [];
    fewestCost = cost;
    fewest.push(pairs);
  }
  if (new Set(fewest.map(pairs => saidBy(pairs, (prior, task) => [standingChange(prior, task)]))).size > 1) return null;
  const measured = fewest.map(pairs => ({ pairs, movement: movement(pairs) }));
  const least = measured.reduce((best, way) => lessMovement(way.movement, best.movement) < 0 ? way : best);
  const asLittle = measured.filter(way => lessMovement(way.movement, least.movement) === 0);
  const lines = (prior: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask) =>
    changesBetween(prior, task).map(change => `${change.kind}|${normalized(change.summary)}`);
  return new Set(asLittle.map(way => saidBy(way.pairs, lines))).size > 1 ? null : least.pairs;
}

/** Everything a pairing says, in one comparable text (which task says it does not matter). */
function saidBy(
  pairs: readonly (readonly [DAVEReportSnapshotTask, DAVEReportSnapshotTask])[],
  say: (prior: DAVEReportSnapshotTask, task: DAVEReportSnapshotTask) => string[],
): string {
  return pairs.flatMap(([prior, task]) => say(prior, task)).sort().join('\n');
}

/** A finish date missing on one side only counts as this many days moved. */
const FINISH_SET_OR_CLEARED_DAYS = 3650;

/**
 * How much a pairing moves the tasks (A6 pass 11 L2), compared in order: how
 * far the finish dates moved, squared per task so a schedule shifted by more
 * than the gap between two same-named tasks still pairs them in finish order
 * (first since A6 pass 12 L1); then the percent change of tasks whose
 * completion did not change (a completion is said as completed or reopened,
 * not as a percent); then how many approval and schedule-impact changes it
 * would print.
 */
function movement(pairs: readonly (readonly [DAVEReportSnapshotTask, DAVEReportSnapshotTask])[]): number[] {
  let percent = 0;
  let finish = 0;
  let other = 0;
  for (const [prior, task] of pairs) {
    if (snapshotTaskIsComplete(prior) === snapshotTaskIsComplete(task)) {
      percent += Math.abs(prior.percentComplete - task.percentComplete);
    }
    finish += finishDaysMoved(prior.finishDate, task.finishDate) ** 2;
    other += Number(normalized(prior.approvalStatus) !== normalized(task.approvalStatus)) +
      Number(prior.estimatedScheduleImpactDays !== task.estimatedScheduleImpactDays);
  }
  return [finish, percent, other];
}

function lessMovement(left: readonly number[], right: readonly number[]): number {
  const differs = left.findIndex((value, index) => value !== right[index]);
  return differs < 0 ? 0 : left[differs] - right[differs];
}

function finishDaysMoved(earlier: string | null | undefined, now: string | null | undefined): number {
  const from = parsePlainDate(earlier);
  const to = parsePlainDate(now);
  if (!from || !to) return from === to ? 0 : FINISH_SET_OR_CLEARED_DAYS;
  return Math.abs(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** How many of status, completion and owner differ: what tells same-named tasks apart (A6 pass 9 L1). */
function standingDifferences(earlier: DAVEReportSnapshotTask, now: DAVEReportSnapshotTask): number {
  return Number(normalized(earlier.status) !== normalized(now.status)) +
    Number(snapshotTaskIsComplete(earlier) !== snapshotTaskIsComplete(now)) +
    Number(normalized(earlier.owner) !== normalized(now.owner));
}

/** What a pairing says about one task's status, completion and owner. */
function standingChange(earlier: DAVEReportSnapshotTask, now: DAVEReportSnapshotTask): string {
  return JSON.stringify([
    normalized(earlier.status), snapshotTaskIsComplete(earlier), normalized(earlier.owner),
    normalized(now.status), snapshotTaskIsComplete(now), normalized(now.owner),
  ]);
}

/** Every order of 0…count-1, the identity first. */
function orderings(count: number): number[][] {
  if (count <= 1) return [Array.from({ length: count }, (_, index) => index)];
  return orderings(count - 1).flatMap(order =>
    Array.from({ length: count }, (_, at) => [...order.slice(0, at), count - 1, ...order.slice(at)]))
    .sort((left, right) => {
      const differs = left.findIndex((value, index) => value !== right[index]);
      return differs < 0 ? 0 : left[differs] - right[differs];
    });
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
