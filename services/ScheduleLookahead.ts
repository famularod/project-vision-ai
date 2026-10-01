import type { ReferenceDocument, ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { parseFlexibleDate } from '../utils/date';
import {
  currentScheduleDocumentsByProject,
  scheduleDocumentAddsToMaster,
  scheduleFullCopyLeftUnshown,
  scheduleDocumentIsScheduleLike,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import type { PIEScheduleImportBatch } from './PIEScheduleImportBatch';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay } from './ScheduleCalendarDay';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressIsManagers,
  scheduleProgressJudgedAt,
  scheduleRowStatesPercent,
} from './ScheduleProgressSource';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { scheduleTasksAnsweringToRemovedTasks } from './ScheduleTaskRevisions';

/**
 * Owner answer Q22 (30 Sep 2026): "a shorter schedule should be made to
 * compliment the master long term schedule", clarified "merge into master".
 * A lookahead and the master both stay in effect for the project. A task in
 * both files shows once, with the lookahead's newer dates and progress;
 * tasks only in the lookahead are added; the master's other tasks stay.
 *
 * The task keeps one record, the master's: approving a lookahead restates
 * the master's task in place (its dates, and its progress by the rule of
 * whole-app audit A5 pass 4: the newer file's over a file's, only upward
 * over the manager's) and notes what the task said before, so progress
 * recorded on it is never split between two copies, survives a new master
 * or a new lookahead, and deleting the lookahead gives the task back its
 * master dates.
 *
 * Whole-app audit A5 pass 5 (30 Sep 2026): the lookahead also notes the
 * percent it gave (none when its file states no percent), and deleting it
 * gives back the percent before it when the task still has the one it gave
 * and the manager has not recorded progress since (H1). Dates compare by
 * calendar day (A12 M2).
 *
 * Whole-app audit A5 pass 6 M2 / A10 pass 4 M1 (30 Sep 2026): the note did
 * not say whether the percent before the lookahead was the manager's own.
 * Master 20%, David 40% by hand, lookahead 60%: a new master repeating 20%
 * took the task to 20%, and deleting the lookahead gave back 40% marked as
 * the schedule's, so summaries called it the scheduler's and the next
 * master lowered it. The note now keeps who stated the percent before the
 * lookahead and what the master file itself last stated; a master row the
 * manager's percent stood over changes nothing, no file sets the task below
 * the manager's noted percent, and the delete gives the percent back as the
 * manager's.
 *
 * Whole-app audit A5 pass 7 M1 (30 Sep 2026): the note kept the manager's
 * percent from when the lookahead came, after the manager had corrected it.
 * Master 20%, David 40% by mistake, lookahead 60% (noted: 40%, David), David
 * corrects to 20%; masters at 30% then 35% left the task at 40%, David's,
 * confirmed on the 35% master's approval. Before any file applies to a task
 * with a note, the note now takes the progress the manager holds on it then
 * (scheduleNoteTakesManagersProgress), so the floor is the manager's newest
 * word, and a hand edit made on the phone or the web counts at the next file.
 */
export type ScheduleImportRole = 'master' | 'lookahead';

function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function percentOf(item: Pick<ScheduleItem, 'percentComplete'>): number {
  const value = Number(item.percentComplete);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function sameDates(
  left: Pick<ScheduleItem, 'startDate' | 'finishDate'>,
  right: Pick<ScheduleItem, 'startDate' | 'finishDate'>,
): boolean {
  return sameScheduleCalendarDay(left.startDate, right.startDate) && sameScheduleCalendarDay(left.finishDate, right.finishDate);
}

type LookaheadEntry = ScheduleLookaheadOverlay['lookaheads'][number];

/**
 * The percent a lookahead gave the task, or null when it gave none. A
 * lookahead approved before the percent was noted (undefined) is taken to
 * have given the task's percent while it is the latest, for its delete.
 */
function percentGiven(entry: LookaheadEntry, latest: boolean, item: ScheduleItem): number | null {
  if (entry.percentComplete === undefined) return latest ? percentOf(item) : null;
  return entry.percentComplete === null ? null : percentOf({ percentComplete: entry.percentComplete });
}

/**
 * Whether the task's percent is one a lookahead stated, which a master
 * repeating its old percent leaves. Before the percent was noted, a 0% was
 * a file with no % column, not a statement (A5 pass 5 H1).
 */
function percentHeldFromLookahead(item: ScheduleItem, overlay: ScheduleLookaheadOverlay): boolean {
  const entries = overlay.lookaheads;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.percentComplete === undefined) {
      return index === entries.length - 1 && percentOf(item) > 0 && percentOf(item) !== overlay.masterPercentComplete;
    }
    if (entry.percentComplete !== null) return percentOf({ percentComplete: entry.percentComplete }) === percentOf(item);
  }
  return false;
}

function overlayOf(item: ScheduleItem): ScheduleLookaheadOverlay | null {
  const overlay = item.lookaheadOverlay;
  return overlay && Array.isArray(overlay.lookaheads) ? overlay : null;
}

function withOverlay(item: ScheduleItem, overlay: ScheduleLookaheadOverlay | null): ScheduleItem {
  const { lookaheadOverlay: _previous, ...rest } = item;
  return overlay && overlay.lookaheads.length > 0 ? { ...rest, lookaheadOverlay: overlay } : rest;
}

/**
 * Whether the note shows the percent before the lookaheads was the manager's
 * own (A5 pass 6 M2). A note made before says nothing: taken as not, as then.
 */
function notedPercentIsManagers(overlay: ScheduleLookaheadOverlay): boolean {
  return overlay.masterProgressSource === 'project_manager' &&
    overlay.masterProgressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER;
}

/** What the master file itself last stated, or null when unknown; a note made before noted the file's percent as the task's. */
function masterFilePercent(overlay: ScheduleLookaheadOverlay): number | null {
  return overlay.masterFilePercentComplete === undefined ? overlay.masterPercentComplete : overlay.masterFilePercentComplete;
}

/**
 * Whether the noted percent is a task entered by hand with nothing saying who
 * set it: the manager's, as the import and the summaries count it.
 */
function notedPercentEnteredByHand(overlay: ScheduleLookaheadOverlay, task: ScheduleItem): boolean {
  return !overlay.masterProgressSource && !key(task.importBatchId) && !key(task.sourceDocumentId);
}

/**
 * The noted percent's provenance, put back with it (A5 pass 6 M2). The
 * manager's is confirmed now, so every device takes it back
 * (DAVEScheduleRecovery keeps the newer confirmation), and keeps when the
 * manager judged it (progressJudgment, A10 pass 5 L1): a field report made
 * after that still counts against it, and the record keeps the manager's
 * date. Null for a note made before, which noted none.
 *
 * Whole-app audit A5 pass 8 L1 (30 Sep 2026): a task entered by hand at 40%
 * with no source, raised to 50% by a lookahead (the schedule's, confirmed at
 * approval, 80ccee6), got 40% back with no confirmation time, and the
 * upload's merge with the cloud's 50% preferred the confirmed copy, so 50%
 * came back on every device. The give-back is now confirmed at the delete
 * whenever the task's percent carries a confirmation time, or the noted
 * percent counts as the manager's (one entered by hand with no source
 * included); the manager's keeps when it was judged, for one entered by hand
 * the date the summaries gave it (importedAt, else createdAt).
 *
 * Whole-app audit A5 pass 9 L3 (30 Sep 2026): Talk's Undo had left the
 * lookahead's 60% manager-rank (project_manager, confirmed by "Schedule
 * update", b03042f), and the delete gave back the master's 20% with the
 * file's own source, which ranks below it: the upload's merge and Full Sync
 * took the Undo's 60% back. When the task's percent is manager-rank, the
 * noted percent keeps that rank: a file's comes back as project_manager,
 * confirmed by "Schedule update" at the delete (still the file's for the
 * summaries), and one entered by hand as the manager's.
 */
function notedProvenance(overlay: ScheduleLookaheadOverlay, at: string, task?: ScheduleItem): Partial<ScheduleItem> | null {
  if (overlay.masterProgressSource === undefined) return null;
  const byHand = Boolean(task && notedPercentEnteredByHand(overlay, task));
  const confirmedNow = overlay.masterProgressSource === 'project_manager' || byHand || Boolean(task?.progressConfirmedAt);
  // A file's percent confirmed again here keeps the time it carried, for dating it, as the manager's does.
  const judgedAt = notedPercentIsManagers(overlay) ? overlay.masterProgressConfirmedAt
    : byHand ? overlay.masterProgressConfirmedAt || task?.importedAt || task?.createdAt || null
      : overlay.masterProgressSource !== 'project_manager' && confirmedNow ? overlay.masterProgressConfirmedAt : null;
  const keepsRank = task?.progressSource === 'project_manager' && overlay.masterProgressSource !== 'project_manager';
  return {
    progressSource: keepsRank ? 'project_manager' : overlay.masterProgressSource,
    progressConfirmedBy: keepsRank && !byHand ? SCHEDULE_UPDATE_PROGRESS_CONFIRMER : overlay.masterProgressConfirmedBy ?? null,
    progressConfirmedAt: confirmedNow ? at : overlay.masterProgressConfirmedAt ?? null,
    ...(judgedAt && at && judgedAt !== at ? { progressJudgment: { judgedAt, givenBackAt: at } } : {}),
  };
}

/**
 * The task with its note brought up to the progress the manager holds on it
 * now (whole-app audit A5 pass 7 M1): the manager's percent, who, when, and
 * the percents the lookaheads gave no longer stand (the manager's word is
 * newer). Applied before any file (a lookahead or a master) applies to the
 * task, so a percent the manager corrected by hand, on the phone or the web,
 * never comes back from the note. The same task when its progress is not
 * the manager's own, or the note already says so.
 */
export function scheduleNoteTakesManagersProgress(task: ScheduleItem): ScheduleItem {
  const overlay = overlayOf(task);
  if (!overlay || !scheduleProgressIsManagers(task)) return task;
  const stated = managersStatement(task);
  const next: ScheduleLookaheadOverlay = {
    ...overlay,
    ...stated,
    masterFilePercentComplete: masterFilePercent(overlay),
    lookaheads: overlay.lookaheads.map(entry => ({ ...entry, percentComplete: null })),
  };
  const same = (Object.keys(stated) as Array<keyof typeof stated>).every(field => overlay[field] === next[field]) &&
    overlay.masterFilePercentComplete === next.masterFilePercentComplete &&
    overlay.lookaheads.every(entry => entry.percentComplete === null);
  return same ? task : withOverlay(task, next);
}

/**
 * What the task states now, for the note: its percent, and who stated it
 * when: the manager's own time for a percent given back earlier, never the
 * give-back (A5 pass 7 M1, A10 pass 5 L1).
 */
function managersStatement(task: ScheduleItem) {
  return {
    masterPercentComplete: percentOf(task),
    // With its status, given back with it (A5 pass 7 L3).
    masterStatus: task.status,
    masterProgressSource: task.progressSource ?? null,
    masterProgressConfirmedBy: task.progressConfirmedBy ?? null,
    masterProgressConfirmedAt: scheduleProgressJudgedAt(task),
  };
}

/** The noted percent with the status noted with it (A5 pass 7 L3); a note made before, with the task's status. */
function notedProgress(overlay: ScheduleLookaheadOverlay, task: ScheduleItem) {
  return reconcileScheduleProgress(overlay.masterStatus ?? task.status, overlay.masterPercentComplete);
}

/**
 * Progress a file sets on a task a lookahead restated, never below the
 * manager's own percent its note shows (whole-app audit A5 pass 6 M2): at or
 * below it, the task takes the manager's percent back as the manager's. A
 * task whose progress is the manager's own now keeps it by the file rule
 * (only a higher percent), so the note does not apply.
 */
export function scheduleFileProgressAboveManagers(
  task: ScheduleItem,
  progress: Partial<ScheduleItem> | null,
  approvedAt: string,
): Partial<ScheduleItem> | null {
  const overlay = overlayOf(task);
  if (!progress || !overlay || !notedPercentIsManagers(overlay) || scheduleProgressIsManagers(task)) return progress;
  if (percentOf({ percentComplete: Number(progress.percentComplete) }) > overlay.masterPercentComplete) return progress;
  const kept = notedProgress(overlay, task);
  return { percentComplete: kept.percentComplete, status: kept.status, ...notedProvenance(overlay, approvedAt), updatedAt: approvedAt };
}

/**
 * The master's task restated by a lookahead row, in place: the row's dates,
 * the area when the task had none, the lookahead added to the imports the
 * task belongs to (a task entered by hand keeps its own provenance), and a
 * note of the lookahead and of what the task said before the first one: its
 * dates, its percent and who stated it, and the master file's own percent
 * (A5 pass 6 M2). Progress the manager recorded under an earlier lookahead
 * is the manager's newer word: the note takes it, and the percents the
 * earlier lookaheads gave no longer stand.
 * Progress is the caller's (fileProgressFor), and givenPercent the percent
 * it gave the task, or null when it left progress alone.
 */
export function scheduleTaskRestatedByLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
  approvedAt: string,
  givenPercent: number | null = null,
): ScheduleItem {
  const batchId = typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '';
  const owned = Boolean(key(task.importBatchId) || key(task.sourceDocumentId));
  // Who stated the percent (A5 pass 6 M2): a manager's word recorded under an earlier lookahead is the
  // newer one, and the percents those lookaheads gave no longer stand (the step every file takes, A5 pass 7 M1).
  const previous = overlayOf(scheduleNoteTakesManagersProgress(task));
  const overlay: ScheduleLookaheadOverlay = {
    ...(previous || {
      masterStartDate: task.startDate,
      masterFinishDate: task.finishDate,
      ...managersStatement(task),
      // The master file's own percent, unless the manager's stands over it.
      masterFilePercentComplete: scheduleProgressIsManagers(task) || !owned ? null : percentOf(task),
    }),
    lookaheads: [
      ...(previous?.lookaheads || []).filter(entry => key(entry.batchId) !== key(batchId)),
      { batchId, startDate: row.startDate, finishDate: row.finishDate, percentComplete: givenPercent },
    ],
  };
  return withOverlay({
    ...task,
    startDate: row.startDate,
    finishDate: row.finishDate,
    locationName: key(task.locationName) ? task.locationName : row.locationName,
    ...(owned && batchId ? { alsoImportedInBatchIds: [...(task.alsoImportedInBatchIds || []), batchId] } : {}),
    updatedAt: approvedAt,
  }, overlay);
}

/**
 * A full schedule's row that says what the master said before a lookahead
 * restated the task: the new master did not change the task, so the
 * lookahead's dates stay. With the row's percent the same too, the master's
 * old percent is not taken over the percent a lookahead stated; a task that
 * holds no lookahead's percent takes the master's (A5 pass 5 H1). The percent
 * compared is the master file's own, and a percent at or below the
 * manager's noted one changes nothing either: the manager's stood over it
 * (A5 pass 6 M2).
 */
export function scheduleRowRepeatsMasterBeforeLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
): { dates: boolean; percent: boolean } {
  const overlay = overlayOf(task);
  if (!overlay) return { dates: false, percent: false };
  const dates = sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row);
  const stated = scheduleRowStatesPercent(row) ? percentOf(row) : null;
  const repeats = stated !== null && (
    stated === masterFilePercent(overlay) ||
    (notedPercentIsManagers(overlay) && stated <= overlay.masterPercentComplete));
  return { dates, percent: dates && repeats && percentHeldFromLookahead(task, overlay) };
}

/**
 * A full schedule that states the task takes over from the lookaheads' note
 * of what the master said: its dates and percent are what the master says
 * now (a row stating no percent leaves the noted percent). The same task
 * when nothing changes. The master file's own percent is noted as stated;
 * the percent given back stays the manager's when the manager's own stood
 * over the row's, and is the file's, confirmed at approval, when the row's
 * is higher (the file rule, A5 pass 4 #1; A5 pass 6 M2).
 */
export function scheduleTaskMasterRestated(
  task: ScheduleItem,
  row: ScheduleItem,
  approvedAt = new Date().toISOString(),
): ScheduleItem {
  const overlay = overlayOf(task);
  if (!overlay) return task;
  const stated = scheduleRowStatesPercent(row) ? percentOf(row) : null;
  const managers = notedPercentIsManagers(overlay);
  const percent = stated === null || (managers && stated <= overlay.masterPercentComplete) ? {}
    : {
        masterPercentComplete: stated,
        ...(overlay.masterStatus !== undefined ? { masterStatus: row.status } : {}),
        ...(managers ? { masterProgressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER, masterProgressConfirmedAt: approvedAt } : {}),
      };
  const next: ScheduleLookaheadOverlay = {
    ...overlay,
    masterStartDate: row.startDate,
    masterFinishDate: row.finishDate,
    ...percent,
    ...(stated !== null && overlay.masterFilePercentComplete !== undefined ? { masterFilePercentComplete: stated } : {}),
  };
  if (
    sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row) &&
    next.masterPercentComplete === overlay.masterPercentComplete &&
    next.masterStatus === overlay.masterStatus &&
    next.masterProgressConfirmedBy === overlay.masterProgressConfirmedBy &&
    next.masterFilePercentComplete === overlay.masterFilePercentComplete
  ) return task;
  return withOverlay(task, next);
}

type LookaheadDeleted = Readonly<{ item: ScheduleItem; datesBack: boolean; percentBack: boolean }>;

/**
 * Whole-app audit A5 pass 8 L3 (30 Sep 2026): after a master moved a task a
 * lookahead restated, the question promised "the earlier dates and progress
 * of 1 task" while nothing shown changed: it counted the hidden old row. The
 * question counts only the tasks shown (scheduleLookaheadDeleteNote; the row
 * a master moved the task to carries its note, ScheduleImportMerge).
 *
 * Whole-app audit A5 pass 9 L1 (30 Sep 2026): the delete then left the
 * hidden old row on the lookahead's dates and percent, its note still
 * listing the deleted lookahead; deleting the new master, or Set Active on
 * the old one, showed them again. Every row the lookahead restated, hidden
 * ones included, is given back.
 */
function tasksAfterLookaheadDeleted(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  updatedAt: string,
): LookaheadDeleted[] {
  const batchId = key(document.importBatchId);
  if (!batchId) return [];
  return items.flatMap(item => {
    const overlay = overlayOf(item);
    const index = overlay ? overlay.lookaheads.findIndex(entry => key(entry.batchId) === batchId) : -1;
    if (!overlay || index < 0) return [];
    const entries = overlay.lookaheads;
    const remaining = entries.filter((_, position) => position !== index);
    const top = index === entries.length - 1 && sameDates(item, entries[index]);
    const back = remaining[remaining.length - 1] ||
      { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate };
    const datesBack = top && !sameDates(item, back);
    // The percent it gave, when no later lookahead gave one, the task still has it, and it is not the manager's own (H1).
    // A later lookahead that states the same percent still gives it (A5 pass 6 M1): the task keeps it.
    const given = percentGiven(entries[index], index === entries.length - 1, item);
    const laterGave = entries.slice(index + 1).some((entry, offset) =>
      percentGiven(entry, index + 1 + offset === entries.length - 1, item) !== null);
    const earlier = entries.slice(0, index).map((entry, position) => percentGiven(entry, false, item))
      .filter((value): value is number => value !== null);
    // Back to the earlier lookahead's percent, or the noted one; never below the manager's noted percent (A5 pass 6 M2).
    const managersFloor = notedPercentIsManagers(overlay) ? overlay.masterPercentComplete : -1;
    const toNoted = earlier.length === 0 || earlier[earlier.length - 1] <= managersFloor;
    const backPercent = toNoted ? overlay.masterPercentComplete : earlier[earlier.length - 1];
    const percentBack = given !== null && !laterGave && given === percentOf(item) && backPercent !== percentOf(item) &&
      !scheduleProgressIsManagers(item);
    // The noted percent comes back with the status noted with it (A5 pass 7 L3).
    const progress = !percentBack ? null
      : toNoted ? notedProgress(overlay, item) : reconcileScheduleProgress(item.status, backPercent);
    // Given back with who stated it: the manager's percent reads as the manager's again. Confirmed at the
    // delete over a percent that carries a confirmation time, so no device's copy takes it back (A5 pass 8 L1).
    const provenance = (toNoted && notedProvenance(overlay, updatedAt, item)) ||
      (item.progressSource === 'project_manager' || item.progressConfirmedAt ? { progressConfirmedAt: updatedAt } : {});
    return [{
      datesBack,
      percentBack,
      item: withOverlay({
        ...item,
        ...(top ? { startDate: back.startDate, finishDate: back.finishDate } : {}),
        ...(progress ? { percentComplete: progress.percentComplete, status: progress.status, ...provenance } : {}),
        updatedAt,
      }, { ...overlay, lookaheads: remaining }),
    }];
  });
}

/**
 * The tasks a deleted lookahead restated, without it (Delete PDF + Items).
 * A task on the dates the lookahead gave, that no later lookahead restated,
 * goes back to the dates before it: the previous lookahead's, or the
 * master's. A task still at the percent it gave goes back to the percent
 * before it (A5 pass 5 H1). Dates and progress the manager changed since
 * are kept.
 */
export function scheduleItemsAfterLookaheadDeleted(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  updatedAt = new Date().toISOString(),
): ScheduleItem[] {
  return tasksAfterLookaheadDeleted(items, document, updatedAt).map(entry => entry.item);
}

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** When a task's progress was last stated, as Set Active's carry dates it (ScheduleImportMerge). */
function progressStatedAt(item: ScheduleItem): number {
  const verification = item.completionVerification;
  return Math.max(
    timeOf(scheduleProgressJudgedAt(item)),
    verification?.status === 'pm_verified' ? timeOf(verification.verifiedAt || verification.reportedAt) : 0,
    scheduleProgressIsManagers(item) ? 0 : timeOf(item.importedAt || item.createdAt),
  );
}

/**
 * Whole-app audit A5 pass 11 M-b (30 Sep 2026): deleting master M with its
 * items took the row M saved for a task it moved, and David's 70% on it, and
 * F's row of the task came back at his older 40% on every device. The row a
 * removed row replaced now takes its progress when that progress is David's
 * own (not a file's) and was judged after the row's, by Set Active's rule
 * (scheduleProgressCarriedToShownTasks: a file's higher percent is never
 * lowered). It is confirmed at the delete, so every device takes it
 * (DAVEScheduleRecovery keeps the newer confirmation), with David's own time
 * kept as when it was judged (progressJudgment), so a field report made after
 * it still counts against it.
 *
 * Whole-app audit A5 pass 12 L (1 Oct 2026): confirmed at the delete, it
 * outranked a later entry on another device. David entered 70% on M's row
 * (27 Sep), then on the web made F current and corrected F's row to 50% (28
 * Sep); a phone not synced since the 27th deleted M with its items (30 Sep),
 * and its 70%, stamped the 30th, won the upload's merge over the 50%. It is
 * now confirmed 1 ms after the later of the row's own confirmation and the
 * removed row's: newer than every older copy of the row, never than a later
 * entry made elsewhere.
 */
function progressOfRemovedRow(task: ScheduleItem, removed: ScheduleItem): Partial<ScheduleItem> | null {
  if (!scheduleProgressIsManagers(removed)) return null;
  const judgedAt = scheduleProgressJudgedAt(removed);
  if (timeOf(judgedAt) <= progressStatedAt(task)) return null;
  if (!scheduleProgressIsManagers(task) && percentOf(removed) < percentOf(task)) return null;
  if (percentOf(removed) === percentOf(task) && removed.status === task.status) return null;
  const at = new Date(Math.max(timeOf(task.progressConfirmedAt), timeOf(removed.progressConfirmedAt)) + 1).toISOString();
  return {
    percentComplete: removed.percentComplete,
    status: removed.status,
    progressSource: removed.progressSource ?? null,
    progressConfirmedBy: removed.progressConfirmedBy ?? null,
    progressConfirmedAt: at,
    progressJudgment: judgedAt && judgedAt !== at ? { judgedAt, givenBackAt: at } : undefined,
    completionVerification: removed.completionVerification ?? null,
  };
}

/**
 * Every task "Delete PDF + Items" saves besides those it removes: the tasks a
 * deleted lookahead restated, given back (scheduleItemsAfterLookaheadDeleted),
 * and the task shown after the delete that each removed task was, answering
 * to the removed id (whole-app audit A10 pass 6 M1,
 * scheduleTasksAnsweringToRemovedTasks), so its field updates stay current;
 * the row a removed row replaced also takes David's newer progress from it
 * (A5 pass 11 M-b).
 */
export function scheduleItemsAfterScheduleDeleted({
  items,
  removed,
  document,
  documents,
  updatedAt = new Date().toISOString(),
}: Readonly<{
  /** The saved tasks the delete keeps. */
  items: readonly ScheduleItem[];
  /** The tasks it removes. */
  removed: readonly ScheduleItem[];
  document: ReferenceDocument;
  /** The schedules saved after the delete. */
  documents: readonly ReferenceDocument[];
  updatedAt?: string;
}>): ScheduleItem[] {
  const changed = new Map(scheduleItemsAfterLookaheadDeleted(items, document, updatedAt).map(item => [item.id, item])); // hidden rows too (A5 pass 9 L1)
  const kept = items.map(item => changed.get(item.id) || item);
  const shown = selectAuthoritativeScheduleItems({
    scheduleItems: kept,
    scheduleDocuments: [...documents],
  });
  const schedules = [document, ...documents].filter(saved => saved.importBatchId && scheduleDocumentIsScheduleLike(saved) && !scheduleDocumentAddsToMaster(saved)); // when each full schedule came in (A8 pass 9 L1)
  scheduleTasksAnsweringToRemovedTasks(shown, removed, kept, schedules, progressOfRemovedRow)
    .forEach(item => changed.set(item.id, { ...item, updatedAt })); // never a sibling (A8 pass 8 L1); David's newer progress (A5 pass 11 M-b, A5 pass 12 L)
  return [...changed.values()];
}

/**
 * What "Delete PDF + Items" also does to the tasks a lookahead changed, for
 * the delete question: only the tasks whose dates or progress go back, not
 * those the delete removes (removed) or whose dates the manager changed
 * since (whole-app audit A5 pass 5 L1). A lookahead's own task restated by a
 * later one goes back to the earlier lookahead's dates, so none is called a
 * master task.
 */
export function scheduleLookaheadDeleteNote(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  removed: readonly ScheduleItem[] = [],
  /**
   * The schedules saved: only the tasks shown after the delete are counted
   * (A5 pass 8 L3), worked out as the delete does, without this document (A5
   * pass 9 L1: a task shown only because of the lookahead is not).
   */
  documents?: readonly ReferenceDocument[],
): string {
  if (!scheduleDocumentAddsToMaster(document)) return '';
  const removedIds = new Set(removed.map(item => item.id));
  const kept = items.filter(item => !removedIds.has(item.id));
  const shown = documents
    ? new Set(selectAuthoritativeScheduleItems({
      scheduleItems: kept,
      scheduleDocuments: documents.filter(saved => saved.id !== document.id),
    }).map(item => item.id))
    : null;
  const back = tasksAfterLookaheadDeleted(kept.filter(item => !shown || shown.has(item.id)), document, '')
    .filter(entry => entry.datesBack || entry.percentBack);
  if (back.length === 0) return '';
  const dates = back.filter(entry => entry.datesBack).length;
  const percents = back.filter(entry => entry.percentBack).length;
  const what = percents === 0 ? 'dates'
    : dates === 0 ? 'progress'
      : dates === back.length && percents === back.length ? 'dates and progress' : 'dates or progress';
  return ` Delete PDF + Items also puts back the earlier ${what} of ${back.length} ${back.length === 1 ? 'task' : 'tasks'} this lookahead changed.`;
}

/** Whether approving this import adds to the master: its document, or the one an earlier Accept Selected saved. */
export function scheduleImportAddsToMaster(
  batch: Pick<PIEScheduleImportBatch, 'id' | 'documents'>,
  savedDocuments: readonly ReferenceDocument[],
): boolean {
  if (batch.documents.some(scheduleDocumentAddsToMaster)) return true;
  if (batch.documents.some(document => document.category === 'Schedules')) return false;
  return savedDocuments.some(document => key(document.importBatchId) === key(batch.id) && scheduleDocumentAddsToMaster(document));
}

/** The import with its schedule file marked as David chose at review. */
export function withScheduleImportRole<T extends Pick<PIEScheduleImportBatch, 'documents'>>(
  batch: T,
  role: ScheduleImportRole,
): T {
  return {
    ...batch,
    documents: batch.documents.map(document => document.category === 'Schedules'
      ? { ...document, scheduleRole: role }
      : document),
  };
}

/** Whether the review asks how the schedule is used: an import that brings a schedule file. */
export function scheduleImportAsksRole(batch: Pick<PIEScheduleImportBatch, 'kind' | 'documents'>): boolean {
  return batch.kind === 'schedule_file' && batch.documents.some(document => document.category === 'Schedules');
}

export type ScheduleImportRoleSuggestion = Readonly<{
  role: ScheduleImportRole;
  /** Plain words: "Suggested: … because …". */
  reason: string;
  /** The only role that saves (a full schedule's file imported again, A8 pass 5 L3). */
  only?: true;
}>;

const DAY_MS = 86_400_000;
/** A file covering at most nine weeks, and at most half the master's span, reads as a lookahead. */
const LOOKAHEAD_MAX_DAYS = 63;
const WEEK_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * The words of a file name that call it a lookahead (whole-app audit A5
 * pass 5 M3, 30 Sep 2026): "lookahead", "look-ahead" or "look ahead", or a
 * span of at most six weeks ("3 Week", "six wk"). "12 Week Schedule" is a
 * full schedule's span, and the "30 Wk" of "2026-09-30 Wk 40" is a date's
 * day. The first such words in the name, or null.
 */
function lookaheadNameWords(name: string): string | null {
  const found: Array<{ index: number; words: string }> = [];
  const looks = /look[\s_-]?ahead/gi;
  for (let match = looks.exec(name); match; match = looks.exec(name)) found.push({ index: match.index, words: match[0] });
  const weeks = /(\d{1,2}|one|two|three|four|five|six)[\s_-]?(?:weeks?|wks?)(?![a-z])/gi;
  for (let match = weeks.exec(name); match; match = weeks.exec(name)) {
    const before = name.slice(0, match.index);
    if (/[a-z0-9]$/i.test(before) || /\d[-/.]$/.test(before)) continue;
    const count = Number(match[1]) || WEEK_WORDS[match[1].toLowerCase()] || 0;
    if (count >= 1 && count <= 6) found.push({ index: match.index, words: match[0] });
  }
  return found.sort((left, right) => left.index - right.index)[0]?.words ?? null;
}

function span(items: readonly ScheduleItem[]): { from: number; to: number } | null {
  const times = items.flatMap(item => [item.startDate, item.finishDate])
    .map(value => (typeof value === 'string' ? parseFlexibleDate(value)?.getTime() : undefined))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return times.length > 0 ? { from: Math.min(...times), to: Math.max(...times) } : null;
}

function days(range: { from: number; to: number }): number {
  return Math.max(1, Math.round((range.to - range.from) / DAY_MS) + 1);
}

function spanWords(count: number): string {
  if (count < 14) return `${count} ${count === 1 ? 'day' : 'days'}`;
  if (count < 120) return `${Math.round(count / 7)} weeks`;
  return `about ${Math.round(count / 30.4)} months`;
}

/**
 * The review's default (owner answer Q22): a full schedule, unless one of
 * the file's projects already has a master and the file's dates read as a
 * lookahead: a few weeks (at most nine) where the master covers at least
 * twice as long. A name that says so ("3 Week Lookahead") is the reason
 * given, but never decides alone (whole-app audit A5 pass 5 M3: "Alpha 12
 * Week Schedule rev2" and "Schedule Update 2026-09-30 Wk 40" were suggested
 * as lookaheads). A file already saved as a full schedule, imported again,
 * comes preset as a lookahead (A8 pass 5 L3). David can change it. While
 * the file's full copy is the schedule shown, it can be neither: the master
 * must be made current first (A8 pass 5 M1, A5 pass 6 L1); while a project
 * it covers shows no full schedule, neither: Set Active shows it again (A8
 * pass 6 L1).
 */
export function suggestScheduleImportRole({
  batch,
  documents,
  scheduleItems,
}: Readonly<{
  batch: Pick<PIEScheduleImportBatch, 'documents' | 'items'>;
  /** The schedules saved now. */
  documents: readonly ReferenceDocument[];
  /** The tasks saved now. */
  scheduleItems: readonly ScheduleItem[];
}>): ScheduleImportRoleSuggestion {
  const file = batch.documents.find(document => document.category === 'Schedules');
  if (file && scheduleDocumentAddsToMaster(file)) {
    const inUse = scheduleFileFullCopyInUse(file, documents);
    return { role: 'lookahead', reason: inUse === 'shown' ? SHOWN_AS_FULL_SCHEDULE : inUse === 'set_active' ? SAVED_SET_ACTIVE
      : inUse === 'other_shown' ? SAVED_UNDER_SOURCES : SAVED_AS_FULL_SCHEDULE, only: true };
  }
  const projects = [...new Map([
    ...batch.items.map(item => item.scheduleProjectName || item.projectName || ''),
    ...(file?.projectNames || []),
  ].map(name => name.trim()).filter(Boolean).map(name => [key(name), name] as const)).values()];
  const current = currentScheduleDocumentsByProject(documents);
  const masters = projects
    .map(project => ({ project, master: current.get(scheduleProjectScopeKey(project)) }))
    .filter((entry): entry is { project: string; master: ReferenceDocument } => Boolean(entry.master));
  if (masters.length === 0) {
    return {
      role: 'master',
      reason: `there is no master schedule${projects.length > 0 ? ` for ${projects.join(', ')}` : ''} yet`,
    };
  }
  const named = lookaheadNameWords(`${file?.name || ''} ${file?.originalFileName || ''}`);
  const fileSpan = span(batch.items);
  const [longest] = masters.map(({ project, master }) => {
    const batchId = key(master.importBatchId);
    const rows = scheduleItems.filter(item =>
      key(item.scheduleProjectName || item.projectName) === key(project) &&
      ((Boolean(batchId) && scheduleItemImportBatchIds(item).map(key).includes(batchId)) ||
        key(item.sourceDocumentId) === key(master.id)));
    const range = span(rows);
    return { project, days: range ? days(range) : 0 };
  }).sort((left, right) => right.days - left.days);
  if (!fileSpan || longest.days === 0) {
    return { role: 'master', reason: `its dates could not be compared with the master for ${longest.project}` };
  }
  const fileDays = days(fileSpan);
  const words = `its dates cover ${spanWords(fileDays)} and the master for ${longest.project} covers ${spanWords(longest.days)}`;
  return fileDays <= LOOKAHEAD_MAX_DAYS && longest.days >= fileDays * 2
    ? { role: 'lookahead', reason: named ? `its name says “${named.trim()}”` : words }
    : { role: 'master', reason: words };
}

const SAVED_AS_FULL_SCHEDULE = 'this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead';
const SHOWN_AS_FULL_SCHEDULE = 'this exact file is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead';
const SAVED_SET_ACTIVE = 'this schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again';
/** Another project it covers shows a different schedule, which Set Active would replace: no advice (A8 pass 7 L1). */
const SAVED_UNDER_SOURCES = 'this schedule file is already saved under Schedule Sources';

function scopeOf(document: ReferenceDocument): string {
  const names = (document.projectNames || []).map(key).filter(Boolean);
  return [...new Set(names.length > 0 ? names : [key(document.projectName)].filter(Boolean))].sort().join('|');
}

/**
 * Whether a saved full schedule of these same bytes and projects is in use
 * (A8 pass 5 M1, A5 pass 6 L1): 'shown' while it is the schedule shown for
 * its projects (added as a lookahead now, the file would restate its own
 * copy's tasks, not the master's); 'left_unshown' while some project it
 * covers shows no full schedule (whole-app audit A8 pass 6 L1, 30 Sep 2026:
 * its master was replaced and the replacement deleted, so Set Active shows
 * it again, and a lookahead of it would be the master as its own
 * lookahead); null otherwise. Left unshown, 'set_active' when Set Active
 * replaces nothing, 'other_shown' when another project it covers shows a
 * different schedule (A8 pass 7 L1, scheduleFullCopyLeftUnshown).
 */
function scheduleFileFullCopyInUse(file: ReferenceDocument, documents: readonly ReferenceDocument[]): 'shown' | 'set_active' | 'other_shown' | null {
  const sha = typeof file.contentSha256 === 'string' ? file.contentSha256.trim() : '';
  if (!sha) return null;
  const copies = documents.filter(document => document.id !== file.id &&
    document.contentSha256 === sha && scopeOf(document) === scopeOf(file));
  const shown = new Set([...currentScheduleDocumentsByProject(documents).values()].map(document => document.id));
  if (copies.some(document => shown.has(document.id))) return 'shown';
  const unshown = copies.map(document => scheduleFullCopyLeftUnshown(document, documents));
  return unshown.includes('other_shown') ? 'other_shown' : unshown.includes('set_active') ? 'set_active' : null;
}

/**
 * Why Accept is refused, or null (whole-app audit A8 pass 5 L3, 30 Sep
 * 2026): a schedule file already saved as a full schedule, imported again,
 * comes preset as a lookahead (the way to turn a lookahead imported before
 * owner answer Q22 into one); saving it as a full schedule again would only
 * duplicate it. While that full copy is the schedule shown, saving it either
 * way is refused: the master is made current first (A8 pass 5 M1, A5 pass 6
 * L1). While a project it covers shows no full schedule, either way is
 * refused too: Set Active shows it again (A8 pass 6 L1).
 */
export function scheduleImportRoleRefusal(
  batch: Pick<PIEScheduleImportBatch, 'documents'>,
  role: ScheduleImportRole,
  /** The schedules saved now. */
  documents: readonly ReferenceDocument[] = [],
): string | null {
  const preset = batch.documents.find(document => document.category === 'Schedules' && scheduleDocumentAddsToMaster(document));
  if (!preset) return null;
  const inUse = scheduleFileFullCopyInUse(preset, documents);
  if (inUse === 'shown') {
    return 'This exact schedule is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead.';
  }
  // A project it covers shows no full schedule: either choice is refused (A8 pass 6 L1); Set Active is the
  // advice only when it replaces no schedule another project shows (A8 pass 7 L1).
  if (inUse === 'set_active') return 'This schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.';
  if (inUse === 'other_shown') return 'This schedule file is already saved under Schedule Sources.';
  return role === 'master'
    ? 'This exact schedule is already saved as a full schedule for these projects. Choose Lookahead to add it to the master schedule, or Reject Import.'
    : null;
}
