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
