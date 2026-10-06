import type { ReferenceDocument, ScheduleDependency, ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { parseFlexibleDate } from '../utils/date';
import {
  currentScheduleDocumentsByProject,
  scheduleDocumentAddsToMaster,
  scheduleDocumentDayLabel,
  scheduleFullCopyLeftUnshown,
  scheduleDocumentIsScheduleLike,
  scheduleItemAsSaved,
  scheduleLookaheadReplacement,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import type { PIEScheduleImportBatch } from './PIEScheduleImportBatch';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay } from './ScheduleCalendarDay';
import { scheduleEditWithDateChangedAlone } from './ScheduleDateEdit';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressIsManagers,
  scheduleProgressJudgedAt,
  scheduleRowStatesPercent,
} from './ScheduleProgressSource';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import {
  scheduleTaskEarlierIds,
  scheduleTaskLinks,
  scheduleTaskLinksFollowingShownTasks,
  scheduleTaskProjectKey,
  scheduleTasksAnsweringToRemovedTasks,
} from './ScheduleTaskRevisions';

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
 *
 * Review N2 F3 (5 Oct 2026, gap in ada8ef6, owner answer Q25): "Delete PDF
 * Only" on the lookahead in effect keeps its tasks on its dates and writes
 * nothing, so with the file gone nothing said when the lookahead that moved
 * a task was imported: a newer lookahead that left the task out never
 * returned it to the master's dates, though the deleted lookahead's own
 * detail tasks did leave (their rows say when they were imported). The entry
 * now notes when its row was imported (importedAt), and the shown schedule
 * reads it once the file is gone (PIEScheduleReconciliation). Noted here,
 * with the restatement, and not by the delete: a save made by the delete
 * stamped every task that lookahead had moved, and that stamp outranked a
 * newer lookahead approved offline on another device (the reviewer's
 * generator, seed 20137: Roof's 90% from the newer lookahead lost).
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
      {
        batchId, startDate: row.startDate, finishDate: row.finishDate, percentComplete: givenPercent,
        ...(typeof row.importedAt === 'string' && row.importedAt.trim() ? { importedAt: row.importedAt } : {}),
        // Its row stated a percent it did not give (at or below David's own): still a newer word (A5 pass 21 R3).
        ...(givenPercent === null && scheduleRowStatesPercent(row) ? { percentStated: true as const } : {}),
      },
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
 *
 * Whole-app audit A5 recorded Low (the b98824e remainder, 1 Oct 2026):
 * master G listed Framing on lookahead L2's 10/20, so the note's master
 * dates became G's and the older lookaheads were marked replaced. With F
 * current again and L2 deleted, Framing rightly showed L1's 10/18; a newer
 * master H listing G's 10/20 then read as a repeat, and Framing stayed on
 * L1's dates though H is newer than L1. The noted dates are what the master
 * said before a lookahead only when no master replaced that lookahead's
 * dates since: a task shown on a lookahead's dates that a master marked
 * replaced (and not on the noted dates) is no repeat, and the row's dates
 * are the newer master's word (owner answer Q22).
 */
export function scheduleRowRepeatsMasterBeforeLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
): { dates: boolean; percent: boolean } {
  const overlay = overlayOf(task);
  if (!overlay) return { dates: false, percent: false };
  const noted = { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate };
  // On a lookahead's dates a master marked replaced, the noted dates came after that lookahead: no repeat (A5 recorded Low).
  const onReplacedLookahead = !sameDates(task, noted) &&
    Boolean([...overlay.lookaheads].reverse().find(entry => sameDates(task, entry))?.datesReplacedByMaster);
  const dates = sameDates(noted, row) && !onReplacedLookahead;
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
 *
 * Whole-app audit A6 pass 19 M1 (1 Oct 2026): lookahead L1 put Framing on
 * 10/18-10/28, master G moved it to 10/23-11/02, and lookahead L2 to
 * 10/24-11/03. Deleting L2 gave Framing L1's 10/28 back ("finish changed
 * from 11/03 to 10/28" in the next report), and the next master repeating
 * G's dates read as "did not change the task", so the stale dates stayed.
 * A master that changes the task's dates now marks the lookaheads older than
 * it (olderThanMaster: every one, for a master approved now) as replaced;
 * deleting a later lookahead falls back only to one not replaced, else to the
 * master's dates (owner answer Q22: a newer master's dates replace older
 * lookahead dates).
 *
 * Whole-app audit A5 pass 20 P1 (1 Oct 2026): the mark said only "replaced".
 * Master G put Framing on lookahead L2's dates and marked L1; David made
 * master F current again and deleted L2, and Framing stayed on G's dates,
 * though G was not current and L1 is newer than F (the same for G uploaded
 * on the web and never made current). The mark is now the import batch id of
 * the master that changed the dates (the row's), and the delete counts it
 * only while that master, or one newer, is current (datesReplacedAtDelete).
 */
export function scheduleTaskMasterRestated(
  task: ScheduleItem,
  row: ScheduleItem,
  approvedAt = new Date().toISOString(),
  olderThanMaster: (entry: LookaheadEntry) => boolean = () => true,
): ScheduleItem {
  const overlay = overlayOf(task);
  if (!overlay) return task;
  // Whole-app audit A5 pass 18 L2 (1 Oct 2026): a master row with blank dates
  // noted blank master dates, so deleting the lookahead gave the task none. A
  // date the row leaves blank says nothing: the note keeps the master's.
  const days = {
    startDate: key(row.startDate) ? row.startDate : overlay.masterStartDate,
    finishDate: key(row.finishDate) ? row.finishDate : overlay.masterFinishDate,
  };
  const stated = scheduleRowStatesPercent(row) ? percentOf(row) : null;
  const managers = notedPercentIsManagers(overlay);
  const percent = stated === null || (managers && stated <= overlay.masterPercentComplete) ? {}
    : {
        masterPercentComplete: stated,
        ...(overlay.masterStatus !== undefined ? { masterStatus: row.status } : {}),
        ...(managers ? { masterProgressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER, masterProgressConfirmedAt: approvedAt } : {}),
      };
  const datesChanged = !sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, days);
  // Which master replaced them (A5 pass 20 P1); a row with no import says only that one did, as before.
  const replacedBy = (typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '') || true;
  const next: ScheduleLookaheadOverlay = {
    ...overlay,
    masterStartDate: days.startDate,
    masterFinishDate: days.finishDate,
    ...percent,
    ...(stated !== null && overlay.masterFilePercentComplete !== undefined ? { masterFilePercentComplete: stated } : {}),
    // The lookaheads' dates this master replaced (A6 pass 19 M1).
    ...(datesChanged ? {
      lookaheads: overlay.lookaheads.map(entry => entry.datesReplacedByMaster || !olderThanMaster(entry)
        ? entry
        : { ...entry, datesReplacedByMaster: replacedBy }),
    } : {}),
  };
  if (
    sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, days) &&
    next.masterPercentComplete === overlay.masterPercentComplete &&
    next.masterStatus === overlay.masterStatus &&
    next.masterProgressConfirmedBy === overlay.masterProgressConfirmedBy &&
    next.masterFilePercentComplete === overlay.masterFilePercentComplete
  ) return task;
  return withOverlay(task, next);
}

type LookaheadDeleted = Readonly<{ item: ScheduleItem; datesBack: boolean; percentBack: boolean }>;

/**
 * The lookaheads of a note whose dates a task can go back to: those after
 * the last one it left for the master's dates (datesLeftAt).
 *
 * Review N2 F2 (5 Oct 2026, residue of 3e1b312): lookahead L1 moved Framing
 * to 10/05, L2 (Roof only) replaced it, so Framing showed the master's
 * 10/01, and "Delete PDF Only" on L1 saved those dates. L3 then moved
 * Framing, and "Delete PDF + Items" on L3 put it on L1's 10/05: the entry of
 * a file deleted earlier, dates David had not seen since L2. The save that
 * takes a task from its lookahead's dates to the master's now notes it
 * (ScheduleDateEdit), and no entry up to there gives its dates back: the
 * task goes to the master's dates, where it was before L3.
 */
function entriesGivingDatesBack(entries: readonly LookaheadEntry[]): LookaheadEntry[] {
  const left = entries.map(entry => Boolean(entry.datesLeftAt)).lastIndexOf(true);
  return entries.slice(left + 1);
}

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
  /** The schedules saved after the delete, when known (A5 pass 20 P1). */
  documents?: readonly ReferenceDocument[],
): LookaheadDeleted[] {
  const batchId = key(document.importBatchId);
  if (!batchId) return [];
  const replaced = datesReplacedAtDelete(items, documents);
  return items.flatMap(item => {
    const overlay = overlayOf(item);
    const index = overlay ? overlay.lookaheads.findIndex(entry => key(entry.batchId) === batchId) : -1;
    if (!overlay || index < 0) return [];
    const entries = overlay.lookaheads;
    const remaining = entries.filter((_, position) => position !== index);
    const top = index === entries.length - 1 && sameDates(item, entries[index]);
    // An earlier lookahead's dates only when no newer master replaced them (A6 pass 19 M1); else the master's.
    // A master that is no longer current, nor any newer one, replaces nothing (A5 pass 20 P1).
    // An earlier lookahead a newer one replaced (owner answer Q25) is saved back too: the task is shown on the master's
    // dates while it is replaced (selectAuthoritativeScheduleItems), worked out the same on every device.
    // Nor a lookahead's the task had left for the master's dates before the deleted one moved it (review N2 F2).
    const back = entriesGivingDatesBack(remaining).reverse().find(entry => !replaced(entry, item)) ||
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
    // Given back with who stated it: the manager's percent reads as the manager's again. Confirmed over a
    // percent that carries a confirmation time, so no older copy of the task takes it back (A5 pass 8 L1),
    // just after it, never at the delete (A5 pass 12 K2, givenBackConfirmedAt).
    const confirmedAt = givenBackConfirmedAt(item, toNoted ? overlay.masterProgressConfirmedAt : null, updatedAt);
    const provenance = (toNoted && notedProvenance(overlay, confirmedAt, item)) ||
      (item.progressSource === 'project_manager' || item.progressConfirmedAt ? { progressConfirmedAt: confirmedAt } : {});
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
 * Whether a lookahead's dates still stand replaced by a master when a later
 * lookahead is deleted (whole-app audit A5 pass 20 P1, 1 Oct 2026): while the
 * master that replaced them is the one current for the task's project, or a
 * master newer than it is (owner answer Q22: a newer master's dates replace
 * older lookahead dates). An older master made current again (Set Active,
 * Make Current), or a master uploaded on the web and never made current,
 * leaves the lookahead's dates in effect. Only for a task shown after the
 * delete: a row the current master hides shows again only when one of its
 * own masters is made current, so it reads the mark as before. As before
 * (A6 pass 19 M1): a mark that names no master (true), the schedules not
 * given, or no master current for the project.
 *
 * Whole-app audit A5 recorded Low (from the pass 22 fixer, 1 Oct 2026): a
 * mark naming a master no longer saved still read as "replaced" here, as it
 * did at Set Active and Make Current before A5 pass 22 L1. Master H listed
 * Framing on lookahead L2's 10/20 and marked L1 and L2; H was deleted (Delete
 * PDF + Items, or a web upload deleted before Make Current) and F made
 * current, so Framing rightly showed L2's 10/20. Deleting L2 then gave the
 * note's master dates, H's own 10/20, though L1 (10/18) is newer than F and
 * H is gone (with a later L3 deleted instead, L1's 10/18 over L2's 10/20). A
 * mark naming a master no longer saved now replaces nothing at the delete
 * while the master current is older than the lookahead, as activation reads
 * it (notedDatesWhileCurrent, then a lookahead's dates only under a master
 * older than it): that master's dates are gone. Under a master newer than
 * the lookahead it reads as before: a mark keeps only the first master that
 * replaced the dates, and the newer one may have replaced them too.
 */
function datesReplacedAtDelete(
  items: readonly ScheduleItem[],
  documents?: readonly ReferenceDocument[],
): (entry: LookaheadEntry, task: ScheduleItem) => boolean {
  const current = documents ? currentScheduleDocumentsByProject(documents) : null;
  let shownIds: Set<string> | null = null;
  const shownAfter = (task: ScheduleItem) => {
    shownIds ||= new Set(selectAuthoritativeScheduleItems({
      scheduleItems: [...items],
      scheduleDocuments: [...(documents || [])],
    }).map(item => item.id));
    return shownIds.has(task.id);
  };
  return (entry, task) => {
    const by = entry.datesReplacedByMaster;
    if (!by) return false;
    if (by === true || !documents || !current || !shownAfter(task)) return true;
    const shown = current.get(scheduleProjectScopeKey(task.projectName || task.scheduleProjectName || ''));
    // A master no longer saved replaces nothing under a master older than the lookahead, as Set Active and
    // Make Current read it (A5 pass 22 L1, A5 pass 21 R1); under a newer one, as before.
    if (!documents.some(saved => key(saved.importBatchId) === key(by))) {
      const lookahead = documents.find(saved => key(saved.importBatchId) === key(entry.batchId));
      return !lookahead || !shown || !(timeOf(lookahead.importedAt) > timeOf(shown.importedAt));
    }
    return markedMasterInEffect(by, documents, shown);
  };
}

/**
 * Whether the master a mark names (its import batch id) has its dates in
 * effect while `shown` is the master current for the task's project: it is
 * that master or older than it (A5 pass 20 P1). As before: a master no
 * longer saved, or no master current.
 */
function markedMasterInEffect(by: string, documents: readonly ReferenceDocument[], shown: ReferenceDocument | undefined): boolean {
  const master = documents.find(saved => key(saved.importBatchId) === key(by));
  if (!master || !shown || shown.id === master.id) return true;
  const shownAt = timeOf(shown.importedAt);
  const masterAt = timeOf(master.importedAt);
  return !shownAt || !masterAt || shownAt >= masterAt;
}

/**
 * The dates a task's lookahead note gives while `shown` is the master
 * current for its project, as Delete PDF + Items falls back (A5 pass 20 P1):
 * the latest lookahead's whose dates no master in effect replaced, else the
 * master's. A mark naming a master no longer saved replaces nothing here
 * (A5 pass 22 L1): that master's dates are gone.
 */
function notedDatesWhileCurrent(
  overlay: ScheduleLookaheadOverlay,
  documents: readonly ReferenceDocument[],
  shown: ReferenceDocument | undefined,
): Pick<ScheduleItem, 'startDate' | 'finishDate'> & { batchId?: string } {
  return [...overlay.lookaheads].reverse().find(entry => {
    const by = entry.datesReplacedByMaster;
    return !by || (by !== true && (!documents.some(saved => key(saved.importBatchId) === key(by)) || !markedMasterInEffect(by, documents, shown)));
  }) || { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate };
}

/**
 * Whole-app audit A5 pass 21 R1 (1 Oct 2026, caused by b98824e): master F
 * had Framing 10/15-10/25, lookaheads L1 and L2 moved it to 10/18-10/28 and
 * 10/20-10/30, and master G listed it on L2's dates, so G restated the task
 * in place and marked L1's dates replaced. With F current again (Set
 * Active), or G uploaded on the web and not yet current, deleting L2 rightly
 * gave L1's 10/18-10/28 (L1 is newer than F). Making G current then left
 * Framing there, though G is newer than L1 and lists 10/20-10/30, and a later
 * master repeating G's dates read as "no change". The delete decides only at
 * the delete; Set Active and Make Current now decide again (owner answer
 * Q22: a newer master's dates replace older lookahead dates). A task shown
 * after, whose lookahead note a master marked, on dates its note holds (the
 * master's or a lookahead's), takes the dates the note gives under the
 * master made current, as the delete reads them: the master's own dates
 * once the master that marked them (or a newer one) is current, a
 * lookahead's again only when a master older than that lookahead is. Dates
 * David moved by hand, and notes no master marked, are left alone. Only for
 * a task an import owns: a task entered by hand takes a schedule uploaded
 * before the mark and made current after it then (A5 pass 18 L3, A5 pass 19
 * L1), which notes that older schedule's dates as the master's. Returns the
 * tasks to save.
 *
 * Whole-app audit A5 pass 22 L1 (1 Oct 2026, caused by 5aba116): three
 * shapes moved Framing onto dates no file in effect gives (at fb44926 it
 * kept its dates). (a) Master G copied lookahead L1's dates, L2 moved
 * Framing to 10/20, master H listed it there and marked L2; H was deleted
 * (Delete PDF + Items, or a web upload deleted before Make Current) and F
 * made current: the mark naming H read as "replaced", so Framing went to
 * L1's 10/18, though L2 is the newest lookahead and newer than F. A mark
 * naming a master no longer saved now replaces nothing here. (b) Master H,
 * which does not list Framing, made current gave the note's master dates
 * (G's 10/20), though L1 adds the task to H. (c) Going back to G after H
 * copied L2 gave H's 10/20, though G lists 10/18. The note's master dates
 * are the dates of the newest master that restated the task: they are given
 * only when the master made current is one of the task's imports and no
 * saved master of the task is newer than it.
 */
export function scheduleTasksOnNotedDatesWhenCurrent({
  after,
  documentsBefore,
  documentsAfter,
  now,
}: Readonly<{
  /** The tasks shown after the schedule was made current, with the activation's other changes. */
  after: readonly ScheduleItem[];
  documentsBefore: readonly ReferenceDocument[];
  documentsAfter: readonly ReferenceDocument[];
  now: string;
}>): ScheduleItem[] {
  const currentBefore = currentScheduleDocumentsByProject(documentsBefore);
  const currentAfter = currentScheduleDocumentsByProject(documentsAfter);
  return after.flatMap(task => {
    const overlay = overlayOf(task);
    const owned = key(task.importBatchId) || key(task.sourceDocumentId) || key(task.importedFrom);
    if (!overlay || !owned || !overlay.lookaheads.some(entry => typeof entry.datesReplacedByMaster === 'string')) return [];
    const project = scheduleProjectScopeKey(task.projectName || task.scheduleProjectName || '');
    const was = currentBefore.get(project);
    const is = currentAfter.get(project);
    if (!is || was?.id === is.id) return [];
    // On dates the note holds, not dates David moved by hand.
    const onNoted = sameDates(task, { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }) ||
      overlay.lookaheads.some(entry => sameDates(task, entry));
    const to = notedDatesWhileCurrent(overlay, documentsAfter, is);
    if (!onNoted || sameDates(task, to) || !key(to.startDate) || !key(to.finishDate)) return [];
    // The note's master dates are those of the newest master that restated the task: only under a master that
    // lists the task (b) and no saved master of the task newer than it (c) (A5 pass 22 L1).
    if (to.batchId === undefined) {
      const imports = scheduleItemImportBatchIds(task).map(key);
      const listsTask = imports.includes(key(is.importBatchId));
      const newerMaster = documentsAfter.some(master => imports.includes(key(master.importBatchId)) &&
        !scheduleDocumentAddsToMaster(master) && timeOf(master.importedAt) > timeOf(is.importedAt));
      if (!listsTask || newerMaster) return [];
    }
    // A lookahead's dates again only under a master older than that lookahead (Q22).
    if (to.batchId !== undefined) {
      const lookahead = documentsAfter.find(saved => key(saved.importBatchId) === key(to.batchId));
      if (!lookahead || !(timeOf(lookahead.importedAt) > timeOf(is.importedAt))) return [];
    }
    return [{ ...task, startDate: to.startDate, finishDate: to.finishDate, updatedAt: now }];
  });
}

/**
 * When a percent a lookahead's delete gives back is confirmed (whole-app
 * audit A5 pass 12 K2, 1 Oct 2026). It was confirmed at the delete, and sync
 * orders David's percents by that confirmation: Master 20%, David 40% (10
 * Sep), a lookahead 60% noting his 40% (20 Sep); David entered 50% on the
 * web (25 Sep); a phone not synced since the lookahead deleted it (30 Sep),
 * and its 40%, stamped the 30th, won the upload's merge over his 50%. It is
 * now confirmed 1 ms after the later of the task's own confirmation and the
 * noted one, as Set Active's carry and the Delete PDF + Items hand-over are
 * (A5 pass 12 L): newer than every older copy of the task, never than a later
 * entry made elsewhere. When the percent was judged is kept
 * (progressJudgment). A task and a note with no confirmation time at all (a
 * record from before either was kept) are confirmed at the delete, as before.
 */
function givenBackConfirmedAt(task: ScheduleItem, noted: string | null | undefined, deletedAt: string): string {
  const latest = Math.max(timeOf(task.progressConfirmedAt), timeOf(noted));
  return latest > 0 ? new Date(latest + 1).toISOString() : deletedAt;
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
  /** The schedules saved after the delete: which master is current (A5 pass 20 P1). */
  documents?: readonly ReferenceDocument[],
): ScheduleItem[] {
  return tasksAfterLookaheadDeleted(items, document, updatedAt, documents).map(entry => entry.item);
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
  fileOnly = false,
}: Readonly<{
  /** The saved tasks the delete keeps. */
  items: readonly ScheduleItem[];
  /** The tasks it removes. */
  removed: readonly ScheduleItem[];
  document: ReferenceDocument;
  /** The schedules saved after the delete. */
  documents: readonly ReferenceDocument[];
  updatedAt?: string;
  /**
   * "Delete PDF Only" (review N1): the schedules saved before the delete are given, no task is removed or given
   * back, and only the tasks shown on the master's dates because of this replaced lookahead are returned, on the
   * dates shown (scheduleDatesShownUnderReplacedLookahead).
   */
  fileOnly?: boolean;
}>): ScheduleItem[] {
  if (fileOnly) {
    const savedById = new Map(items.map(item => [item.id, item]));
    // Each as the phone's task save leaves it when given these two dates (the phone's delete passes only them): with
    // the note that the task left its lookahead's dates, or was kept on them (review N2 F2, F3; ScheduleDateEdit).
    return [...scheduleDatesShownUnderReplacedLookahead(items, documents, document), ...scheduleDatesKeptUnderDeletedLookahead(items, documents, document)]
      .flatMap(({ id, startDate, finishDate }) => {
        const saved = savedById.get(id);
        return saved ? [{ ...saved, ...scheduleEditWithDateChangedAlone(saved, { startDate, finishDate }, updatedAt), updatedAt }] : [];
      });
  }
  const changed = new Map(scheduleItemsAfterLookaheadDeleted(items, document, updatedAt, documents).map(item => [item.id, item])); // hidden rows too (A5 pass 9 L1)
  const kept = items.map(item => changed.get(item.id) || item);
  const shown = selectAuthoritativeScheduleItems({
    scheduleItems: kept,
    scheduleDocuments: [...documents],
  });
  const schedules = [document, ...documents].filter(saved => saved.importBatchId && scheduleDocumentIsScheduleLike(saved) && !scheduleDocumentAddsToMaster(saved)); // when each full schedule came in (A8 pass 9 L1)
  scheduleTasksAnsweringToRemovedTasks(shown, removed, kept, schedules, progressOfRemovedRow)
    .forEach(item => changed.set(item.id, { ...item, updatedAt })); // never a sibling (A8 pass 8 L1); David's newer progress (A5 pass 11 M-b, A5 pass 12 L)
  progressOfRowsNowHidden(items, removed, document, documents, kept, shown.map(item => changed.get(item.id) || item))
    .forEach(item => changed.set(item.id, { ...item, updatedAt })); // a row the delete hides gives David's newer progress (A6 pass 19 L2)
  // Owner answer Q29 (2 Oct 2026): David's hand links follow each task to the row shown for it after the delete
  // (the row that answers to a removed one included), on the phone and the web alike. A link to a removed row
  // nothing shown answers to is left to scheduleDependenciesAfterScheduleDeleted (the row that answers to it,
  // shown or not; dropped only when none does).
  const keptNow = items.map(item => changed.get(item.id) || item);
  scheduleTaskLinksFollowingShownTasks({
    before: selectAuthoritativeScheduleItems({ scheduleItems: [...items, ...removed], scheduleDocuments: [document, ...documents] }),
    after: selectAuthoritativeScheduleItems({ scheduleItems: keptNow, scheduleDocuments: [...documents] }),
    known: keptNow,
    now: updatedAt,
  }).forEach(item => changed.set(item.id, item));
  // Saved from the copies as shown: on their saved dates where the dates were only shown (owner answer Q25).
  return [...changed.values()].map(scheduleItemAsSaved);
}

/**
 * Whole-app audit A6 pass 19 L2 (1 Oct 2026): master F was current again
 * (Set Active), and lookahead L held master G's row of Framing on show, where
 * David entered 50%. Deleting L hid G's row (kept: G holds it) and showed F's
 * at 0%, and the report said "Framing moved from 50% to 0% complete." The
 * hand-over above covers only removed rows. A row the delete hides, not
 * removes, now gives David's newer progress to the row it shows in its place,
 * as Set Active's carry does: the one row shown since the delete that it
 * answers to, or that answers to it (revisedFromTaskIds), by the hand-over's
 * rule (progressOfRemovedRow: his own progress judged after the row's; a
 * file's higher percent is never lowered).
 */
function progressOfRowsNowHidden(
  /** The saved tasks the delete keeps, before its changes. */
  items: readonly ScheduleItem[],
  removed: readonly ScheduleItem[],
  document: ReferenceDocument,
  documents: readonly ReferenceDocument[],
  /** The same tasks with the delete's changes. */
  kept: readonly ScheduleItem[],
  /** The tasks shown after the delete, with its changes so far. */
  shown: readonly ScheduleItem[],
): ScheduleItem[] {
  const removedIds = new Set(removed.map(item => item.id));
  const shownBefore = new Set(selectAuthoritativeScheduleItems({
    scheduleItems: [...items, ...removed],
    scheduleDocuments: [document, ...documents],
  }).map(item => item.id).filter(id => !removedIds.has(id)));
  const shownAfter = new Set(shown.map(item => item.id));
  const nowShown = shown.filter(item => !shownBefore.has(item.id));
  const nowHidden = kept.filter(item => shownBefore.has(item.id) && !shownAfter.has(item.id));
  if (nowShown.length === 0 || nowHidden.length === 0) return [];
  const given = new Map<string, ScheduleItem>();
  nowHidden.forEach(hidden => {
    const hiddenId = hidden.id.trim();
    const linked = nowShown.filter(item => scheduleTaskEarlierIds(hidden).includes(item.id.trim()) ||
      scheduleTaskEarlierIds(item).includes(hiddenId));
    if (linked.length !== 1) return;
    const target = given.get(linked[0].id) || linked[0];
    const progress = progressOfRemovedRow(target, hidden);
    if (progress) given.set(target.id, { ...target, ...progress });
  });
  return [...given.values()];
}

/**
 * The links "Delete PDF + Items" changes on the tasks it keeps, each task's
 * new list of predecessors (whole-app audit A6 pass 14 L1, 1 Oct 2026).
 *
 * David linked Roofing after Framing while master F was current; master M
 * moved Framing onto a new row, and Roofing's link still pointed at F's,
 * now hidden. Deleting F with its items dropped the link and stamped
 * Roofing, so its predecessor count went from 1 to 0 and the next report
 * said "Alpha: Roofing was updated." with nothing visible changed. A link to
 * a removed row now moves to the task shown that answers to that row after
 * the delete (scheduleTaskLinks, as field updates on the row are linked: M's
 * Framing, which lists F's row as earlier, or the task the delete wrote the
 * row's id onto), keeping its type and lag. It is dropped only when no task
 * shown answers to the row (or two could), and never doubles a link the
 * task has or points a task at itself.
 */
export function scheduleDependenciesAfterScheduleDeleted(
  /** The saved tasks after the delete, its changes included (scheduleItemsAfterScheduleDeleted). */
  items: readonly ScheduleItem[],
  removedIds: readonly string[],
  /** The schedules saved after the delete. */
  documents: readonly ReferenceDocument[],
): Array<{ id: string; dependencies: ScheduleDependency[] }> {
  const removed = new Set(removedIds.map(id => id.trim()).filter(Boolean));
  const predecessorOf = (link: ScheduleDependency) =>
    typeof link?.predecessorItemId === 'string' ? link.predecessorItemId.trim() : '';
  const linksOf = (item: ScheduleItem) => (Array.isArray(item.dependencies) ? item.dependencies : []);
  const hit = items.filter(item => !removed.has(item.id.trim()) && linksOf(item).some(link => removed.has(predecessorOf(link))));
  if (hit.length === 0) return [];
  const answering = scheduleTaskLinks(selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }), items);
  // Owner answer Q29 (2 Oct 2026): with no task shown answering to it (a newer master not current at the delete),
  // the saved row that does, so the link follows the task when that row is shown again.
  const answeringSaved = scheduleTaskLinks(items, items);
  const answeringRow = (id: string) => {
    const shown = answering({ scheduleItemId: id });
    if (shown) return shown.item.id;
    const saved = answeringSaved({ scheduleItemId: id });
    return saved && saved.basis !== 'stored_task_name' ? saved.item.id : undefined;
  };
  return hit.map(item => {
    const own = item.id.trim();
    const linked = new Set(linksOf(item).map(predecessorOf).filter(id => !removed.has(id)));
    const dependencies = linksOf(item).flatMap(link => {
      const id = predecessorOf(link);
      if (!removed.has(id)) return [link];
      const now = answeringRow(id);
      const nowId = now?.trim() ?? '';
      if (!now || !nowId || removed.has(nowId) || nowId === own || linked.has(nowId)) return [];
      linked.add(nowId);
      return [{ ...link, predecessorItemId: now }];
    });
    return { id: item.id, dependencies };
  });
}

/**
 * Review N1 (3 Oct 2026, caused by ada8ef6, as web M1 on the phone): "Delete
 * PDF Only" on a lookahead a newer one replaced (owner answer Q25) removed
 * the file and wrote no task. A master task it had moved, shown on the
 * master's dates, jumped to the deleted lookahead's dates on the phone, the
 * iPad and the web: its saved dates were still that lookahead's, and nothing
 * replaces a file that is gone. The tasks shown on the master's dates
 * because of this lookahead, with the dates shown: the delete saves them
 * first, as a date David set, so the dates he sees do not move. None for a
 * lookahead still in effect (its tasks keep its dates, as before) or a master.
 * The phone asks through scheduleItemsAfterScheduleDeleted (fileOnly), which
 * its delete already calls.
 */
export function scheduleDatesShownUnderReplacedLookahead(
  items: readonly ScheduleItem[],
  documents: readonly ReferenceDocument[],
  document: ReferenceDocument,
): Array<Pick<ScheduleItem, 'id' | 'startDate' | 'finishDate'>> {
  const batch = (document.importBatchId || '').trim().toLowerCase();
  if (!batch || !scheduleDocumentAddsToMaster(document)) return [];
  return selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] })
    .filter(item => item.savedLookaheadDates &&
      (item.lookaheadOverlay?.lookaheads?.at(-1)?.batchId || '').trim().toLowerCase() === batch)
    .map(item => ({ id: item.id, startDate: item.startDate, finishDate: item.finishDate }));
}

/**
 * Review N2 F3 (5 Oct 2026, gap in ada8ef6, owner answer Q25), for a note
 * made before that review: "Delete PDF Only" on the lookahead in effect
 * keeps its tasks on its dates and wrote nothing. A newer lookahead that
 * then left a master task out never returned it to the master's dates,
 * though the deleted lookahead's own detail tasks did leave: with the file
 * gone, nothing said when the lookahead that moved the task was imported. A
 * note now says so itself (importedAt, scheduleTaskRestatedByLookahead) and
 * the delete writes nothing, as before. For a note with no import time (a
 * lookahead approved on Build 229 or earlier): the tasks shown on this
 * lookahead's dates, whose note names it last, with those same dates. The
 * delete saves them as kept (the same task save notes when,
 * ScheduleDateEdit), and the shown schedule reads a lookahead imported after
 * that as the newer one (PIEScheduleReconciliation). None for a replaced
 * lookahead (its tasks are saved on the dates shown, above) or a master.
 */
export function scheduleDatesKeptUnderDeletedLookahead(
  items: readonly ScheduleItem[],
  documents: readonly ReferenceDocument[],
  document: ReferenceDocument,
): Array<Pick<ScheduleItem, 'id' | 'startDate' | 'finishDate'>> {
  const batch = (document.importBatchId || '').trim().toLowerCase();
  if (!batch || !scheduleDocumentAddsToMaster(document)) return [];
  return selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] })
    .filter(item => {
      const latest = item.lookaheadOverlay?.lookaheads?.at(-1);
      return !item.savedLookaheadDates && Boolean(latest) && !latest!.importedAt && (latest!.batchId || '').trim().toLowerCase() === batch && sameDates(item, latest!);
    })
    .map(item => ({ id: item.id, startDate: item.startDate, finishDate: item.finishDate }));
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
  /** The button that does it: the phone's, or the web's "Delete Document + N Tasks" (review N2 W1). */
  button = 'Delete PDF + Items',
): string {
  if (!scheduleDocumentAddsToMaster(document)) return '';
  const removedIds = new Set(removed.map(item => item.id));
  const kept = items.filter(item => !removedIds.has(item.id));
  const after = documents?.filter(saved => saved.id !== document.id);
  const shown = after
    ? new Set(selectAuthoritativeScheduleItems({
      scheduleItems: kept,
      scheduleDocuments: after,
    }).map(item => item.id))
    : null;
  // Which master is current after the delete, as the delete reads it (A5 pass 20 P1).
  const given = tasksAfterLookaheadDeleted(kept.filter(item => !shown || shown.has(item.id)), document, '', after);
  // Review N2 (Low, wording; 5 Oct 2026): for a lookahead a newer one replaced (owner answer Q25) the question said
  // "puts back the earlier dates and progress", though the task already shows the master's dates and no date David
  // sees moves: only its saved dates go back. Dates are said only for a task whose dates shown change with the delete.
  const datesSeenToMove = (() => {
    if (!documents || !after) return () => true;
    const changed = new Map(given.map(entry => [entry.item.id, entry.item]));
    const seenOf = (tasks: ScheduleItem[], schedules: readonly ReferenceDocument[]) =>
      new Map(selectAuthoritativeScheduleItems({ scheduleItems: tasks, scheduleDocuments: [...schedules] }).map(item => [item.id, item] as const));
    const before = seenOf(kept, documents);
    const now = seenOf(kept.map(item => changed.get(item.id) || item), after);
    return (id: string) => { const was = before.get(id), is = now.get(id); return !was || !is || !sameDates(was, is); };
  })();
  const back = given.map(entry => ({ ...entry, datesBack: entry.datesBack && datesSeenToMove(entry.item.id) }))
    .filter(entry => entry.datesBack || entry.percentBack);
  const again = after && documents && shown ? lookaheadInEffectAgainNote(document, documents, after, kept, shown) : '';
  if (back.length === 0) return again;
  const dates = back.filter(entry => entry.datesBack).length;
  const percents = back.filter(entry => entry.percentBack).length;
  const what = percents === 0 ? 'dates'
    : dates === 0 ? 'progress'
      : dates === back.length && percents === back.length ? 'dates and progress' : 'dates or progress';
  return ` ${button} also puts back the earlier ${what} of ${back.length} ${back.length === 1 ? 'task' : 'tasks'} this lookahead changed.${again}`;
}

/**
 * " The lookahead of Oct 2, 2026 applies again.": deleting the newest
 * lookahead puts the one before it back in effect (owner answer Q25).
 */
function lookaheadInEffectAgainNote(
  document: ReferenceDocument,
  documents: readonly ReferenceDocument[],
  after: readonly ReferenceDocument[],
  /** The tasks the delete keeps, and those shown after it. */
  kept: readonly ScheduleItem[],
  shown: ReadonlySet<string>,
): string {
  const replacedCount = (lookahead: ReferenceDocument, saved: readonly ReferenceDocument[]) => {
    const replacement = scheduleLookaheadReplacement(lookahead, saved);
    return !replacement ? 0 : replacement.whole ? Number.MAX_SAFE_INTEGER : replacement.projectNames.length;
  };
  const again = after
    .filter(saved => saved.id !== document.id && scheduleDocumentAddsToMaster(saved))
    .filter(saved => replacedCount(saved, after) < replacedCount(saved, documents))
    .sort((left, right) => timeOf(right.importedAt) - timeOf(left.importedAt))[0];
  if (!again) return '';
  // Only when it changes something shown: tasks it lists show again, or take its dates again (not those the deleted
  // lookahead restated: the question counts them above).
  const before = new Map(selectAuthoritativeScheduleItems({ scheduleItems: [...kept], scheduleDocuments: [...documents] }).map(item => [item.id, item]));
  const batch = key(again.importBatchId);
  const deleted = key(document.importBatchId);
  const changes = selectAuthoritativeScheduleItems({ scheduleItems: [...kept], scheduleDocuments: [...after] }).some(item => {
    if (!shown.has(item.id)) return false;
    const was = before.get(item.id);
    if (!was) return scheduleItemImportBatchIds(item).map(key).includes(batch);
    const restatedByDeleted = (item.lookaheadOverlay?.lookaheads || []).some(entry => key(entry.batchId) === deleted);
    return !restatedByDeleted && !sameDates(was, item);
  });
  return changes ? ` The lookahead of ${scheduleDocumentDayLabel(again)} applies again.` : '';
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
 *
 * Whole-app audit A5 pass 12 K1 (1 Oct 2026): a Microsoft Project master
 * keeps its root ("2400 Compliance Project") as every row's schedule
 * project, with the building (Harbor North) as its app project. The master's
 * dates for a project were read from the rows whose root named it, so a
 * master for Harbor North had none, and a three-week lookahead was suggested
 * as a full schedule ("its dates could not be compared"). A row now counts
 * for its app project (scheduleTaskProjectKey, as the merge, the delete and
 * the shown schedule key it), or for its root when a master was saved for the
 * root itself.
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
  const distinct = (names: readonly string[]) =>
    [...new Map(names.map(name => name.trim()).filter(Boolean).map(name => [key(name), name] as const)).values()];
  // Each row's app project, not its Microsoft Project root (whole-app audit A5 pass 12 K1, above).
  const projects = distinct([
    ...batch.items.map(item => item.projectName || item.scheduleProjectName || ''),
    ...(file?.projectNames || []),
  ]);
  const current = currentScheduleDocumentsByProject(documents);
  // A master saved for the root itself (an app project made from it) is still the root's.
  const masters = distinct([...projects, ...batch.items.map(item => item.scheduleProjectName || '')])
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
      (scheduleTaskProjectKey(item) === scheduleTaskProjectKey({ projectName: project }) || key(item.scheduleProjectName) === key(project)) &&
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
