import type { ScheduleItem } from '../types';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { scheduleTaskEarlierIds } from './ScheduleTaskRevisions';

/**
 * Who confirmed progress taken from an approved schedule file over the
 * manager's (A5 pass 4 #1). Such a task keeps the manager's rank, so a device
 * still holding the older manager value cannot win it back in a merge
 * (DAVEScheduleRecovery), but its progress is the file's: the next file may
 * correct it either way.
 */
export const SCHEDULE_UPDATE_PROGRESS_CONFIRMER = 'Schedule update';

/** Progress the project manager recorded or verified, not taken from a schedule file. */
export function scheduleProgressIsManagers(item: ScheduleItem): boolean {
  if (item.completionVerification?.status === 'pm_verified') return true;
  return item.progressSource === 'project_manager' &&
    item.progressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER;
}

/**
 * Whether an imported row states its progress (whole-app audit A5 pass 5 H1,
 * 30 Sep 2026). A row its file gave no percent (no % Complete column, or a
 * blank cell) says nothing about progress; every row read before says it did.
 */
export function scheduleRowStatesPercent(row: Pick<ScheduleItem, 'percentCompleteStated'>): boolean {
  return row.percentCompleteStated !== false;
}

/** The task a row becomes, without the note about its file's row. */
export function scheduleRowAsTask<T extends Pick<ScheduleItem, 'percentCompleteStated'>>(row: T): T {
  if (!('percentCompleteStated' in row)) return row;
  const { percentCompleteStated: _fileRow, ...task } = row;
  return task as T;
}

/**
 * When the progress the task holds was judged (whole-app audit A10 pass 5
 * L1, 30 Sep 2026): the manager's own time for a percent given back later
 * (progressJudgment), else when it was confirmed. Field reports are weighed
 * against this, and records dated by it; sync orders copies by
 * progressConfirmedAt.
 */
export function scheduleProgressJudgedAt(
  item: Pick<ScheduleItem, 'progressConfirmedAt' | 'progressJudgment'>,
): string | null {
  const confirmedAt = item.progressConfirmedAt ?? null;
  const judgment = item.progressJudgment;
  return judgment && confirmedAt && judgment.givenBackAt === confirmedAt && judgment.judgedAt
    ? judgment.judgedAt
    : confirmedAt;
}

/**
 * A task's progress and who stated it, noted before Talk changes it (whole-app
 * audit A10 pass 5 L3, 30 Sep 2026).
 */
export type ScheduleProgressUndoPoint = Readonly<Pick<ScheduleItem,
  | 'status'
  | 'percentComplete'
  | 'progressSource'
  | 'progressConfirmedBy'
  | 'progressConfirmedAt'
  | 'progressJudgment'
  | 'completionVerification'
  | 'lookaheadOverlay'
  | 'importBatchId'
  | 'sourceDocumentId'
  | 'importedFrom'
  | 'importedAt'
  | 'createdAt'
>>;

/**
 * Whole-app audit A10 pass 5 L3 (30 Sep 2026): Talk's Undo put back only the
 * status and percent, through the task update that marks every progress
 * change as the manager's, so the file's 30% came back as "project manager
 * judgment" and a later master could no longer lower it. Talk notes this
 * before its change, and Undo gives it back (scheduleProgressRestored).
 */
export function scheduleProgressUndoPoint(task: ScheduleItem): ScheduleProgressUndoPoint {
  return {
    status: task.status,
    percentComplete: task.percentComplete,
    progressSource: task.progressSource ?? null,
    progressConfirmedBy: task.progressConfirmedBy ?? null,
    progressConfirmedAt: task.progressConfirmedAt ?? null,
    progressJudgment: task.progressJudgment ?? undefined,
    completionVerification: task.completionVerification ?? null,
    lookaheadOverlay: task.lookaheadOverlay ?? undefined,
    // Where the task came from: a percent with no source on a file's task is the file's (A10 pass 6 L3).
    importBatchId: task.importBatchId ?? null,
    sourceDocumentId: task.sourceDocumentId ?? null,
    importedFrom: task.importedFrom ?? null,
    // When a percent entered by hand with no source was stated (A10 pass 7 L3).
    importedAt: task.importedAt ?? null,
    createdAt: task.createdAt,
  };
}

/**
 * What Undo puts back (A10 pass 5 L3), as deleting a lookahead gives back
 * the percent before it (ScheduleLookahead): the percent, status, who stated
 * it, the completion record and the lookahead note. A manager-ranked percent
 * is confirmed again at the Undo, so every device takes it back
 * (DAVEScheduleRecovery keeps the newer confirmation), and the manager's own
 * keeps when the manager judged it (progressJudgment, A10 pass 5 L1). Never
 * marked as the manager's judgment by the Undo.
 *
 * Whole-app audit A10 pass 6 L3 (30 Sep 2026): the file's 30% came back with
 * no source, and another device still holding Talk's 50%, marked as the
 * manager's, won over it on Full Sync (DAVEScheduleRecovery ranks a manager's
 * copy above a file's). A percent that was not the manager's now comes back
 * the way a file's percent over the manager's is kept (ScheduleImportMerge):
 * project_manager, confirmed by "Schedule update" at the Undo, so it wins the
 * same sync while a later file can still lower it and the summaries read it
 * as the schedule's. A percent on a task entered by hand with nothing saying
 * who set it counts as the manager's (as the import and the summaries count
 * it) and comes back as the manager's, confirmed at the Undo.
 *
 * Whole-app audit A10 pass 7 L3 (30 Sep 2026): such a task came back judged
 * at the Undo, so a field report made before the Undo (29 Sep: "Pour slab is
 * complete") no longer counted against its 40% and the warning went away. It
 * now keeps when its percent was stated, as deleting a lookahead gives it back
 * (ScheduleLookahead): its confirmation time, else when it was imported, else
 * when it was created.
 */
export function scheduleProgressRestored(point: ScheduleProgressUndoPoint, at: string): Partial<ScheduleItem> {
  const fromFile = point.progressSource === 'schedule_import' || (point.progressSource !== 'project_manager' &&
    [point.importBatchId, point.sourceDocumentId, point.importedFrom].some(value => typeof value === 'string' && value.trim()));
  const byHand = !point.progressSource && !fromFile;
  const judgedAt = point.progressSource === 'project_manager' && point.progressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER
    ? scheduleProgressJudgedAt(point)
    : byHand ? point.progressConfirmedAt || point.importedAt || point.createdAt || null : null;
  return {
    status: point.status,
    percentComplete: point.percentComplete,
    progressSource: 'project_manager',
    progressConfirmedBy: fromFile ? SCHEDULE_UPDATE_PROGRESS_CONFIRMER : point.progressConfirmedBy ?? null,
    progressConfirmedAt: at,
    progressJudgment: judgedAt && judgedAt !== at ? { judgedAt, givenBackAt: at } : undefined,
    completionVerification: point.completionVerification ?? null,
    lookaheadOverlay: point.lookaheadOverlay ?? undefined,
  };
}

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentOf(item: Pick<ScheduleItem, 'percentComplete'>): number {
  const value = Number(item.percentComplete);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * When a task's progress was last stated: by the manager, or by the file it
 * came from.
 *
 * Whole-app audit A5 pass 10 M1 (30 Sep 2026): deleting a lookahead gives a
 * hidden old row David's earlier 40% back, confirmed at the delete with his
 * own time kept as when it was judged (progressJudgment). Dated by its
 * confirmation, it looked newer than the 70% David entered on the row a new
 * master moved the task to, so Set Active showed 40% and wrote it over 70%.
 * Progress is dated by when it was judged (scheduleProgressJudgedAt).
 */
function progressStatedAt(item: ScheduleItem, fileProgressDated = true): number {
  const verification = item.completionVerification;
  return Math.max(
    timeOf(scheduleProgressJudgedAt(item)),
    verification?.status === 'pm_verified' ? timeOf(verification.verifiedAt || verification.reportedAt) : 0,
    scheduleProgressIsManagers(item) || !fileProgressDated ? 0 : timeOf(item.importedAt || item.createdAt),
  );
}

/**
 * The shown task with the progress of the task it replaces, or null to keep
 * its own (whole-app audit A5 pass 4 #3, moved here from ScheduleImportMerge
 * for Full Sync, A6 pass 22 M1): only the manager's own progress, stated
 * after the shown task's; a higher percent a file gave is never lowered
 * (A5 pass 4 #1); a manager's own older value is. Full Sync (A6 pass 22 M1)
 * does not date a file's percent no one confirmed by its import: the device
 * that imported it did not know the manager's percent on the other device,
 * and a file's percent never goes below the manager's (owner answer Q22).
 */
export function scheduleProgressCarriedFrom(
  hidden: ScheduleItem,
  shown: ScheduleItem,
  now: string,
  { fileProgressDated = true }: Readonly<{ fileProgressDated?: boolean }> = {},
): ScheduleItem | null {
  if (!scheduleProgressIsManagers(hidden)) return null;
  if (progressStatedAt(hidden) <= progressStatedAt(shown, fileProgressDated)) return null;
  if (!scheduleProgressIsManagers(shown) && percentOf(hidden) < percentOf(shown)) return null;
  if (percentOf(hidden) === percentOf(shown) && hidden.status === shown.status) return null;
  // Whole-app audit A5 pass 11 L-1 (30 Sep 2026): sync orders copies by
  // progressConfirmedAt (DAVEScheduleRecovery). The shown row given David's
  // older 40% back at a lookahead delete (28 Sep) took his newer 70% with
  // its own older stamp (27 Sep), so the next sync kept the cloud's 40%.
  // Confirmed again, with when David judged it kept (progressJudgment).
  //
  // Whole-app audit A5 pass 12 L (1 Oct 2026): confirmed at the Set Active,
  // a device that had not caught up, repeating Set Active at 11:00, beat
  // the 50% David entered at 10:00 on the iPad's carried row. Confirmed 1 ms
  // after the later of the two rows' own confirmations instead: newer than
  // the copies it replaces, never newer than a percent entered since.
  const restampedAt = timeOf(hidden.progressConfirmedAt) < timeOf(shown.progressConfirmedAt)
    ? new Date(Math.max(timeOf(hidden.progressConfirmedAt), timeOf(shown.progressConfirmedAt)) + 1).toISOString()
    : null;
  const judgedAt = scheduleProgressJudgedAt(hidden);
  return {
    ...shown,
    percentComplete: hidden.percentComplete,
    status: hidden.status,
    progressSource: hidden.progressSource ?? null,
    progressConfirmedAt: restampedAt ?? hidden.progressConfirmedAt ?? null,
    progressConfirmedBy: hidden.progressConfirmedBy ?? null,
    ...(restampedAt
      ? { progressJudgment: judgedAt && judgedAt !== restampedAt ? { judgedAt, givenBackAt: restampedAt } : undefined }
      : hidden.progressJudgment ? { progressJudgment: hidden.progressJudgment } : {}),
    completionVerification: hidden.completionVerification ?? null,
    updatedAt: now,
  };
}

/**
 * Owner answer Q22 and the A5 recorded Low R-c (cab99c0): a lookahead never
 * takes a task below the percent David entered himself, whether his percent
 * is shown or kept under a file's higher one (managersPercentUnderFile); a
 * newer master's percent stands (owner answer Q32, option b). A task whose
 * percent is a file's, below his: floored at his percent (its status
 * reconciled), still the file's, with his percent kept under it. Null when
 * the percent is his own, or at or above his.
 */
export function scheduleProgressFlooredAtManagers(
  task: ScheduleItem,
  managersPercent: number,
  /** When David judged that percent (A6 pass 24 L1). */
  judgedAt: string | null = null,
): Partial<ScheduleItem> | null {
  const floor = percentOf({ percentComplete: managersPercent });
  if (scheduleProgressIsManagers(task) || percentOf(task) >= floor) return null;
  const floored = reconcileScheduleProgress(task.status, floor);
  return { percentComplete: floored.percentComplete, status: floored.status, managersPercentUnderFile: floor, managersPercentUnderFileJudgedAt: judgedAt };
}

/**
 * David's latest own percent a task holds, and when he judged it: the
 * lookahead floor (owner answer Q22). His own percent while it is shown;
 * the one a file's replaced (managersPercentUnderFile) only while a file's
 * percent is shown; else none.
 *
 * Whole-app audit A6 pass 24 L1 (Low, caused by cab99c0): David's 20%, then
 * lookahead L1 at 70% kept his 20% as the floor. He lowered the task to 10%
 * on the phone, which left the 20% in the task's record; before the iPad
 * heard of it, it approved lookahead L2 at 40%, and Full Sync took the floor
 * from the iPad's copy, whose 40% won. Lookahead L3 at 10% then gave 20% on
 * every device ("Framing moved from 40% to 20% complete"); one device gives
 * 10%. A floor left in the record under his own percent no longer counts,
 * and a merge keeps his latest entry either copy knows
 * (scheduleManagersPercentUnderFileOfBoth).
 */
export function scheduleManagersOwnPercent(item: ScheduleItem): Readonly<{ percent: number; judgedAt: string | null }> | null {
  if (scheduleProgressIsManagers(item)) return { percent: percentOf(item), judgedAt: scheduleProgressJudgedAt(item) };
  const floor = item.managersPercentUnderFile;
  return typeof floor === 'number' && Number.isFinite(floor)
    ? { percent: percentOf({ percentComplete: floor }), judgedAt: item.managersPercentUnderFileJudgedAt ?? null }
    : null;
}

/**
 * The floor of two copies of a task merged, where `progress` is the copy
 * whose progress the merge keeps (A6 pass 24 L1): the floor goes with the
 * file's percent (A5 recorded Low R-c, cab99c0), but when the other copy
 * knows a later entry of David's (his own percent shown there, judged after
 * this floor, or a later floor), that entry is the floor. Unchanged
 * otherwise, and when the kept copy shows his own percent.
 */
export function scheduleManagersPercentUnderFileOfBoth(
  progress: ScheduleItem,
  other: ScheduleItem,
): Partial<Pick<ScheduleItem, 'managersPercentUnderFile' | 'managersPercentUnderFileJudgedAt'>> {
  if (progress.managersPercentUnderFile === undefined && other.managersPercentUnderFile === undefined) return {};
  const kept = { managersPercentUnderFile: progress.managersPercentUnderFile, managersPercentUnderFileJudgedAt: progress.managersPercentUnderFileJudgedAt };
  const floor = scheduleProgressIsManagers(progress) ? null : scheduleManagersOwnPercent(progress);
  const later = scheduleManagersOwnPercent(other);
  if (!floor || !later || timeOf(later.judgedAt) <= timeOf(floor.judgedAt)) return kept;
  return { managersPercentUnderFile: later.percent, managersPercentUnderFileJudgedAt: later.judgedAt };
}

/**
 * The fields a carry gives the row it carries to (scheduleProgressCarriedFrom),
 * besides its stamp, with David's own percent a file's replaced
 * (managersPercentUnderFile) and when he judged it (A6 pass 24 L1), which go
 * with the file's percent: what the sync sends of a carried percent (A7 pass
 * 26 M-1).
 */
export const SCHEDULE_CARRIED_PROGRESS_FIELDS = [
  'status', 'percentComplete', 'progressSource', 'progressConfirmedBy', 'progressConfirmedAt', 'progressJudgment', 'completionVerification',
  'managersPercentUnderFile', 'managersPercentUnderFileJudgedAt',
] as const satisfies ReadonlyArray<keyof ScheduleItem>;

const WRITTEN_FIELDS = ['status', 'percentComplete', 'progressSource', 'progressConfirmedBy', 'progressConfirmedAt'] as const;

/**
 * The task a task id is now: the newest row a new master moved it to (by the
 * ids a task had before, ScheduleTaskRevisions), else the task itself.
 *
 * Whole-app audit A10 pass 8 L2 (30 Sep 2026): after Make Current back to
 * the old master, Talk changed the old row (shown), and Undo always refused:
 * it found the hidden newer row that answers to it, which does not hold what
 * Talk wrote. With the tasks shown known, the row Talk changed decides while
 * it is shown; the earlier ids are followed only when it no longer is.
 */
function scheduleTaskNow(items: readonly ScheduleItem[], taskId: string, shown?: readonly ScheduleItem[]): ScheduleItem | null {
  if (shown?.some(item => item.id === taskId)) return items.find(item => item.id === taskId) ?? null;
  const moved = items.filter(item => scheduleTaskEarlierIds(item).includes(taskId));
  const superseded = new Set(moved.flatMap(scheduleTaskEarlierIds));
  const newest = moved.filter(item => !superseded.has(item.id));
  return newest.length === 1 ? newest[0] : items.find(item => item.id === taskId) ?? null;
}

/**
 * Whole-app audit A10 pass 6 L4 (30 Sep 2026): Talk's Undo put back the old
 * progress blindly. A master that restated Roofing at 70% in place while the
 * alert was open lost its 70% to the Undo's 30%; a master that moved Roofing
 * left Talk's 50% on the row shown, and the Undo landed on the hidden old row.
 * Undo now finds the task as it is now (the row a new master moved it to) and
 * gives back the old progress (scheduleProgressRestored) only while that task
 * still holds what Talk wrote; otherwise nothing changes, and David is told
 * why. The lookahead note is given back only to the row Talk changed: a moved
 * row keeps the note the master gave it.
 */
export function scheduleTalkUndo(
  items: readonly ScheduleItem[],
  task: Pick<ScheduleItem, 'id' | 'taskName'>,
  before: ScheduleProgressUndoPoint,
  written: ScheduleProgressUndoPoint,
  at: string,
  /** The tasks shown now (A10 pass 8 L2); without them, the newest row first, as before. */
  shown?: readonly ScheduleItem[],
): Readonly<{ ok: true; taskId: string; edit: Partial<ScheduleItem> } | { ok: false; message: string }> {
  const now = scheduleTaskNow(items, task.id, shown);
  const holds = now && WRITTEN_FIELDS.every(field => (now[field] ?? null) === (written[field] ?? null));
  if (!now || !holds) return { ok: false, message: `${task.taskName} changed since Talk updated it, so it was not undone.` };
  const { lookaheadOverlay, ...edit } = scheduleProgressRestored(before, at);
  return { ok: true, taskId: now.id, edit: now.id === task.id ? { ...edit, lookaheadOverlay } : edit };
}
