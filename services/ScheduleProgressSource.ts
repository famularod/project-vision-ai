import type { ScheduleItem } from '../types';
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
 */
export function scheduleProgressRestored(point: ScheduleProgressUndoPoint, at: string): Partial<ScheduleItem> {
  const fromFile = point.progressSource === 'schedule_import' || (point.progressSource !== 'project_manager' &&
    [point.importBatchId, point.sourceDocumentId, point.importedFrom].some(value => typeof value === 'string' && value.trim()));
  const judgedAt = point.progressSource === 'project_manager' && point.progressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER
    ? scheduleProgressJudgedAt(point)
    : null;
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

const WRITTEN_FIELDS = ['status', 'percentComplete', 'progressSource', 'progressConfirmedBy', 'progressConfirmedAt'] as const;

/**
 * The task a task id is now: the newest row a new master moved it to (by the
 * ids a task had before, ScheduleTaskRevisions), else the task itself.
 */
function scheduleTaskNow(items: readonly ScheduleItem[], taskId: string): ScheduleItem | null {
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
): Readonly<{ ok: true; taskId: string; edit: Partial<ScheduleItem> } | { ok: false; message: string }> {
  const now = scheduleTaskNow(items, task.id);
  const holds = now && WRITTEN_FIELDS.every(field => (now[field] ?? null) === (written[field] ?? null));
  if (!now || !holds) return { ok: false, message: `${task.taskName} changed since Talk updated it, so it was not undone.` };
  const { lookaheadOverlay, ...edit } = scheduleProgressRestored(before, at);
  return { ok: true, taskId: now.id, edit: now.id === task.id ? { ...edit, lookaheadOverlay } : edit };
}
