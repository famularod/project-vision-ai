import type { ScheduleItem } from '../types';

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
  };
}

/**
 * What Undo puts back (A10 pass 5 L3), as deleting a lookahead gives back
 * the percent before it (ScheduleLookahead): the percent, status, who stated
 * it, the completion record and the lookahead note. A manager-ranked percent
 * is confirmed again at the Undo, so every device takes it back
 * (DAVEScheduleRecovery keeps the newer confirmation), and the manager's own
 * keeps when the manager judged it (progressJudgment, A10 pass 5 L1); a
 * file's keeps its own time. Never marked as the manager's by the Undo.
 */
export function scheduleProgressRestored(point: ScheduleProgressUndoPoint, at: string): Partial<ScheduleItem> {
  const managerRanked = point.progressSource === 'project_manager';
  const judgedAt = managerRanked && point.progressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER
    ? scheduleProgressJudgedAt(point)
    : null;
  return {
    status: point.status,
    percentComplete: point.percentComplete,
    progressSource: point.progressSource ?? null,
    progressConfirmedBy: point.progressConfirmedBy ?? null,
    progressConfirmedAt: managerRanked ? at : point.progressConfirmedAt ?? null,
    progressJudgment: judgedAt && judgedAt !== at ? { judgedAt, givenBackAt: at } : undefined,
    completionVerification: point.completionVerification ?? null,
    lookaheadOverlay: point.lookaheadOverlay ?? undefined,
  };
}
