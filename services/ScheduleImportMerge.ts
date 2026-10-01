import type { ReferenceDocument, ScheduleItem, ScheduleRowAwaitingCurrent } from '../types';
import { scheduleImportItemIdentity } from './PIEScheduleImportBatch';
import {
  currentScheduleDocumentsByProject,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay, scheduleCalendarDay, scheduleCalendarDayKey } from './ScheduleCalendarDay';
import { scheduleTaskRevisedFrom } from './ScheduleTaskRevisions';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressIsManagers,
  scheduleProgressJudgedAt,
  scheduleRowAsTask,
  scheduleRowStatesPercent,
} from './ScheduleProgressSource';
import {
  scheduleFileProgressAboveManagers,
  scheduleNoteTakesManagersProgress,
  scheduleRowRepeatsMasterBeforeLookahead,
  scheduleTaskMasterRestated,
  scheduleTaskRestatedByLookahead,
} from './ScheduleLookahead';

/**
 * How an approved schedule import joins the tasks already saved.
 *
 * Whole-app audit A5 (30 Sep 2026): a revised file for a project that
 * already had a schedule made most of its tasks vanish. An unchanged task
 * was left out of the new batch as a duplicate, so its only copy belonged
 * to the previous document, which the approval had just made inactive; a
 * changed task came in as a fresh row at 0% while the project manager's
 * progress stayed on the hidden old copy.
 *
 * Now an unchanged task that an earlier import owns also belongs to the new
 * import (alsoImportedInBatchIds; its id, progress and confirmations
 * intact), and a changed task takes the project manager's confirmed
 * progress from the earlier row for the same task in the same project and
 * area. A completion claim that names an existing task still merges into
 * it first, as before. The unchanged task keeps its own import identity: a
 * revision that rewrote it made "Set Active" on the older schedule hide it
 * and "Delete PDF + Items" on the revision delete it (audit A5 pass 2).
 *
 * Whole-app audit A5 pass 3 F3 (30 Sep 2026): a revised Microsoft Project
 * file with one task inserted renumbered the ID, row and WBS of every task
 * below it, so none of them matched and the manager's progress, owners and
 * notes stayed on hidden rows; a task changed in two revisions running lost
 * its progress because the hidden first copy made the match ambiguous. A
 * row now pairs with the task the manager sees by name, project and area
 * (pairTaskRevisions): on the same dates it is that task, re-homed; on new
 * dates it takes the manager's progress and fills its blank owner,
 * contractor and notes. The strict import identity de-duplicates one file
 * and still matches a row left unpaired.
 *
 * Whole-app audit A5 pass 4 #1 (30 Sep 2026): the scheduler's % Complete in
 * a weekly update was thrown away. A task on the same dates was re-homed at
 * its old 0% and read Overdue; a task the manager had at 40% that the update
 * said was 100% done (on an earlier actual finish) stayed 40%. The file's
 * progress now counts (fileProgressFor): over progress an earlier file gave,
 * the newer file's, higher or lower (a scheduler's correction); over the
 * manager's, only a higher percent, never lower. A task on the same dates is
 * updated in place (its id, owner, notes and history kept); approving a file
 * a task already belongs to again changes nothing.
 *
 * Owner answer Q22 (30 Sep 2026): a lookahead (overlay) adds to the master.
 * A row that pairs with a task the manager sees restates that task in place,
 * on the row's dates and with the file's progress by the rule above, and
 * the task notes what it said before (ScheduleLookahead); a row that pairs
 * with none is added. A later full schedule whose row repeats what the
 * master said before the lookahead leaves the lookahead's dates, and a
 * repeated percent leaves the lookahead's progress; one that changed the
 * task is the newer file, as before.
 *
 * Whole-app audit A5 pass 5 (30 Sep 2026): a file that states no percent for
 * a row (a contractor's lookahead with Task, Project, Area, Start, Finish,
 * Owner) said 0% Not Started, and took a master task's file progress of 60%
 * to 0%. Such a row now leaves progress alone, for a full schedule too (a
 * task on new dates keeps the progress it had); a stated 0% is still the
 * scheduler's (H1). A lookahead row with no area, or no parent project where
 * the master's rows name one, pairs with the one same-named task of its
 * project, never with either of two (M1). Dates compare by calendar day, so
 * 2026-10-05 (web) and 10/05/2026 (files) are the same day (A12 M2).
 *
 * Whole-app audit A5 pass 6 M2 / A10 pass 4 M1 (30 Sep 2026): master 20%,
 * David 40% by hand, a lookahead 60%; the next master repeating 20% took the
 * task to 20%, below David's. A task a lookahead restated now takes no
 * file's percent below the manager's own percent its note shows
 * (scheduleFileProgressAboveManagers), and a master row the manager's
 * percent stood over is a repeat (ScheduleLookahead).
 *
 * Whole-app audit A5 pass 6 M1 (30 Sep 2026): a lookahead stating the
 * percent the task already had noted none, so deleting an older lookahead
 * that said the same lowered a percent the newer one still stated. A
 * lookahead now notes the percent its row states whenever the task ends at
 * it.
 *
 * Whole-app audit A5 pass 7 M1 (30 Sep 2026): a percent the manager corrected
 * by hand after a lookahead noted it came back as the manager's when a later
 * file stated less than it. Before any file applies to a task with a note,
 * the note now takes the progress the manager holds then
 * (scheduleNoteTakesManagersProgress), and the floor uses that.
 *
 * Whole-app audit A10 pass 5 M1 (30 Sep 2026): a task a new master moved is
 * saved as a new row with a new id, and field updates linked to the old id
 * matched no task shown. The new row now keeps the ids the task had before
 * (revisedFromTaskIds, carried forward: A→B→C keeps A and B), and the
 * summaries resolve an update's task through them (ScheduleTaskRevisions).
 *
 * Whole-app audit A5 pass 8 L3 (30 Sep 2026): that new row left the task's
 * lookahead note on the hidden old row, so deleting the lookahead gave the
 * moved task nothing back (60% stayed where the task left on its dates went
 * back to David's 40%). The new row now carries the note, brought up to what
 * the new master says (scheduleTaskMasterRestated), as the task left on its
 * dates keeps it.
 *
 * Whole-app audit A5 pass 17 M1 (1 Oct 2026): a task David entered by hand
 * belongs to no import, so it always shows; a master moving it added a new
 * row as well and Pour slab showed twice, and the next master, with two
 * candidates for one row, paired with neither (0%). Such a task is now
 * restated in place on the master's dates, as a task on the same dates and
 * a lookahead's task are: its id, progress (only raised by a file, Q22), who
 * judged it and when, owner and notes stay, and it keeps no import.
 *
 * Whole-app audit A5 pass 17 M2 (1 Oct 2026): two same-named tasks in one
 * area paired by row order alone, so a master that dropped phase 1 gave
 * David's 80% to the unchanged phase 2. They now pair by calendar days
 * first, then only the one left with the one left (pairSameNamedTasks);
 * otherwise neither, for the import, Set Active's and Make Current's carry.
 *
 * Whole-app audit A5 pass 18 (1 Oct 2026): same days first swapped David's
 * progress when a slip landed one twin on the other's days, "file order" was
 * the order each device keeps tasks in, and a lookahead listing some twins
 * paired none. Twins now pair by one rule per schedule role
 * (pairSameNamedTasks). A schedule uploaded on the web restates a task
 * entered by hand only when it is made current (scheduleRowsAwaitingCurrent).
 */
export type ScheduleImportMergeResult = Readonly<{
  /** The saved tasks, with re-homed and completion-merged rows replaced. */
  next: ScheduleItem[];
  /** The imported rows to add. */
  additions: ScheduleItem[];
  rehomedIds: readonly string[];
  carriedProgressIds: readonly string[];
  /** Saved tasks updated to the file's progress, and added rows whose file progress beat the manager's. */
  fileProgressIds: readonly string[];
  /** Saved tasks a lookahead restated in place (owner answer Q22). */
  overlaidIds: readonly string[];
}>;

export { SCHEDULE_UPDATE_PROGRESS_CONFIRMER, scheduleProgressIsManagers };

function percentOf(item: ScheduleItem): number {
  const value = Number(item.percentComplete);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * The file's progress over the saved task's, or null to keep the saved
 * task's (A5 pass 4 #1). A task entered by hand, with nothing saying who set
 * its percent, counts as the manager's. A row that states no percent keeps
 * the saved task's (A5 pass 5 H1).
 *
 * Whole-app audit A5 pass 7 L2 / A10 pass 5 L2 (30 Sep 2026): a file's
 * percent on a task entered by hand was saved with no source on a task no
 * import owns, so the summaries' fallback for older records called it the
 * manager's judgment. It is now marked as the schedule's
 * (schedule_import, "Schedule update", confirmed at approval, so every
 * device's merge keeps it), and a later file may correct it either way.
 */
function fileProgressFor(
  saved: ScheduleItem,
  stated: ScheduleItem,
  approvedAt: string,
): Partial<ScheduleItem> | null {
  const startedByStatus = statusStartsTask(saved, stated);
  if (!scheduleRowStatesPercent(stated) && !startedByStatus) return null;
  const file = startedByStatus ? { ...stated, percentComplete: 1, status: 'In Progress' as const } : stated;
  const owned = ownedByImport(saved);
  const managers = scheduleProgressIsManagers(saved) || (!owned && !saved.progressSource);
  const change = percentOf(file) - percentOf(saved);
  if (managers ? change <= 0 : change === 0) return null;
  const confirmed = { progressConfirmedAt: approvedAt, progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER };
  // Taken at approval: a manager-ranked task stays manager-ranked, confirmed
  // by the approval, so every device's merge keeps the file's value.
  if (saved.progressSource === 'project_manager') {
    return { percentComplete: file.percentComplete, status: file.status, progressSource: 'project_manager', ...confirmed, updatedAt: approvedAt };
  }
  return owned
    ? { percentComplete: file.percentComplete, status: file.status, updatedAt: approvedAt }
    : { percentComplete: file.percentComplete, status: file.status, progressSource: 'schedule_import', ...confirmed, updatedAt: approvedAt };
}

function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/**
 * A task an import brought in; one entered by hand belongs to none and always shows.
 *
 * Whole-app audit A5 pass 18 L1 (1 Oct 2026): a task imported before import
 * batches and document ids, known only by the file it came from
 * (importedFrom), counted as entered by hand: a master restated it in place
 * on its dates, then the shown schedule hid it with its file, and Pour slab
 * left the view with David's percent. It belongs to its file, as the shown
 * schedule and Talk's Undo already count it.
 */
function ownedByImport(item: ScheduleItem): boolean {
  return Boolean(key(item.importBatchId) || key(item.sourceDocumentId) || key(item.importedFrom));
}

/**
 * Whole-app audit A5 pass 10 L1 (30 Sep 2026): a task saved at Not Started
 * 0% stayed Not Started when a newer master or lookahead row said "In
 * Progress" with no percent, since a row stating no percent never changes a
 * saved task's progress (A5 pass 5 H1). Over Not Started 0% such a row now
 * starts the task at 1%, as the progress rule reads it: upward only, never
 * lowering a percent and never over a percent stated.
 */
function statusStartsTask(saved: ScheduleItem, row: ScheduleItem): boolean {
  return !scheduleRowStatesPercent(row) && key(row.status) === 'in progress' &&
    percentOf(saved) === 0 && key(saved.status) === 'not started';
}

/**
 * An area saved empty matches the imported one (whole-app audit A5 pass 2):
 * rows imported before 30 Sep had an area the file named but the project
 * did not know cleared, and the revised file now keeps it, so no row moved
 * and no progress carried.
 */
function sameArea(existing: ScheduleItem, imported: ScheduleItem): boolean {
  const existingArea = key(existing.locationName);
  return !existingArea || existingArea === key(imported.locationName);
}

/**
 * The app project a row belongs to, the schedule's root only when it names
 * none (whole-app audit round 2, A8 pass 9 review, 30 Sep 2026): a Microsoft
 * Project master files Harbor North's and Harbor South's rows under one root
 * summary row ("PLZ 2400 Harbor Project"), and the merge paired them by the
 * root, so South's new Pour slab took North's 90% and answered to North's row.
 */
function projectKey(item: ScheduleItem): string {
  return key(item.projectName || item.scheduleProjectName);
}

/**
 * Name, project and area; a row's ID, number and WBS renumber on an insert.
 * Loosely, for a lookahead (A5 pass 5 M1): a row with no area matches a task
 * in any area. The project is the app project, never another project under
 * the same root (A8 pass 9 review).
 */
function sameTask(existing: ScheduleItem, imported: ScheduleItem, vague = false): boolean {
  if (key(existing.taskName) !== key(imported.taskName)) return false;
  const project = projectKey(imported);
  if (!project || projectKey(existing) !== project) return false;
  return sameArea(existing, imported) || (vague && !key(imported.locationName));
}

/** The same task on the same calendar days: unchanged by the revision. */
function unchangedTask(existing: ScheduleItem, imported: ScheduleItem): boolean {
  return sameTask(existing, imported) &&
    sameScheduleCalendarDay(existing.startDate, imported.startDate) &&
    sameScheduleCalendarDay(existing.finishDate, imported.finishDate);
}

function inImport(item: ScheduleItem, importBatchId: string | null | undefined): boolean {
  return Boolean(key(importBatchId)) && scheduleItemImportBatchIds(item).map(key).includes(key(importBatchId));
}

/** A row's start and finish as calendar days (2026-10-05 and 10/05/2026 are one day). */
function calendarDays(item: Pick<ScheduleItem, 'startDate' | 'finishDate'>): string {
  return `${scheduleCalendarDayKey(item.startDate)}\n${scheduleCalendarDayKey(item.finishDate)}`;
}

type Days = Pick<ScheduleItem, 'startDate' | 'finishDate'>;

/** What the master last said of a task's days: the days a lookahead's note keeps, else the task's own. */
function masterDays(item: ScheduleItem): Days {
  const note = item.lookaheadOverlay;
  return note ? { startDate: note.masterStartDate, finishDate: note.masterFinishDate } : item;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A day that sorts as a day (YYYY-MM-DD); one naming no day after every day. */
function dayOrder(value: unknown): string {
  return scheduleCalendarDay(value) ?? `~${key(value)}`;
}

function rowNumberOf(item: ScheduleItem): number {
  return Number.isFinite(item.sourceRowNumber) ? Number(item.sourceRowNumber) : Number.MAX_SAFE_INTEGER;
}

/**
 * Twins that all carry a Microsoft Project row number from one file, in that
 * file's order, or null. Microsoft Project keeps no identity a revision
 * leaves alone: the normalizer reads its ID, WBS / outline number and row,
 * and an inserted task renumbers all three below it (no Unique ID is read).
 * The order of a file's rows is its outline order, which an insert, a slip
 * or one twin passing the other does not change, so it is compared between
 * files, never the numbers themselves (A5 pass 3 F3: never by ID).
 */
function inMicrosoftProjectOrder(items: readonly ScheduleItem[]): ScheduleItem[] | null {
  // Whole-app audit A5 pass 19 L4 (1 Oct 2026): a twin a revision found unchanged kept only its first file's
  // row number, so after G moved the other twin no one file numbered both, the twins paired by date, and H
  // slipping the first past the second swapped David's progress. A twin also carries the row number its
  // latest import gave it (alsoImportedSourceRow); the twins pair in the order of a file that numbers them all.
  const rowsOf = (item: ScheduleItem) => [
    { file: key(item.alsoImportedSourceRow?.importBatchId), row: item.alsoImportedSourceRow?.sourceRowNumber },
    { file: key(item.importBatchId) || key(item.sourceDocumentId), row: item.sourceRowNumber },
  ].filter((entry): entry is { file: string; row: number } => Boolean(entry.file) && Number.isFinite(entry.row));
  const file = rowsOf(items[0]).map(entry => entry.file).find(candidate => items.every(item => rowsOf(item).some(entry => entry.file === candidate)));
  if (!file) return null;
  const rowIn = (item: ScheduleItem) => rowsOf(item).find(entry => entry.file === file)!.row;
  return [...items].sort((left, right) => rowIn(left) - rowIn(right));
}

/**
 * Twins in one stable order (whole-app audit A5 pass 18 F1/F2, 1 Oct 2026):
 * the master's start day, finish day, the file's row number, then the file's
 * own order (one import's rows) or the task id (saved tasks). Never the order
 * a device happens to keep saved tasks in: the phone saves a new row ahead of
 * the ones it re-homes and a task entered by hand at the top, the web reads
 * the newest updated first, so that order paired twins differently on each.
 */
function inStableOrder(items: readonly ScheduleItem[], inFile: boolean): ScheduleItem[] {
  return items
    .map((item, index) => ({ item, index, days: masterDays(item) }))
    .sort((left, right) =>
      compareText(dayOrder(left.days.startDate), dayOrder(right.days.startDate)) ||
      compareText(dayOrder(left.days.finishDate), dayOrder(right.days.finishDate)) ||
      (rowNumberOf(left.item) - rowNumberOf(right.item)) ||
      (inFile ? left.index - right.index : compareText(left.item.id, right.item.id)))
    .map(({ item }) => item);
}

/** A day as a whole number of days, or null when it names none. */
function dayNumber(value: unknown): number | null {
  const day = scheduleCalendarDay(value);
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / 86_400_000);
}

function spanOf(days: Days): readonly [number, number] | null {
  const start = dayNumber(days.startDate);
  const finish = dayNumber(days.finishDate);
  if (start === null && finish === null) return null;
  const from = start ?? finish!;
  const to = finish ?? start!;
  return from <= to ? [from, to] : [to, from];
}

/** How far apart two spans are: minus the days they share when they overlap, else the days between them. */
function apart(left: readonly [number, number], right: readonly [number, number]): number {
  const shared = Math.min(left[1], right[1]) - Math.max(left[0], right[0]) + 1;
  return shared > 0 ? -shared : Math.max(left[0], right[0]) - Math.min(left[1], right[1]);
}

/** The one candidate scoring lowest, or null when none scores or two tie. */
function uniquelyNearest<T>(candidates: readonly T[], scoreOf: (candidate: T) => number | null): T | null {
  let nearest: T | null = null;
  let lowest = Infinity;
  let tied = false;
  candidates.forEach(candidate => {
    const score = scoreOf(candidate);
    if (score === null) return;
    if (score < lowest) {
      nearest = candidate;
      lowest = score;
      tied = false;
    } else if (score === lowest) tied = true;
  });
  return tied ? null : nearest;
}

/**
 * A lookahead's twin rows by their dates (whole-app audit A5 pass 18 F3, 1 Oct
 * 2026). A lookahead is a rolling window: it lists the twins its weeks hold,
 * so a twin it does not list is not left over for another row. A row pairs
 * with the saved twin it overlaps most, else the one it is nearest to (the
 * days the twin shows, or the master's days its note keeps), when that twin
 * is uniquely its nearest and it is uniquely that twin's nearest row; else
 * with none (a new row, never David's progress on another task).
 */
function pairByNearestDays(rows: readonly ScheduleItem[], saved: readonly ScheduleItem[]): Map<ScheduleItem, ScheduleItem> {
  const score = (row: ScheduleItem, twin: ScheduleItem): number | null => {
    const span = spanOf(row);
    const spans = [spanOf(twin), twin.lookaheadOverlay ? spanOf(masterDays(twin)) : null]
      .filter((value): value is readonly [number, number] => value !== null);
    return span && spans.length > 0 ? Math.min(...spans.map(twinSpan => apart(span, twinSpan))) : null;
  };
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  rows.forEach(row => {
    const twin = uniquelyNearest(saved, candidate => score(row, candidate));
    if (twin && uniquelyNearest(rows, candidate => score(candidate, twin)) === row) pairs.set(row, twin);
  });
  return pairs;
}

/**
 * Rows on exactly a twin's days pair with it (the days it shows, then, for a
 * twin a lookahead restated, the master's days its note keeps), only when as
 * many rows as twins share them (whole-app audit A5 pass 17 M2).
 */
function pairOnSameDays(rows: readonly ScheduleItem[], saved: readonly ScheduleItem[], inFile: boolean): Map<ScheduleItem, ScheduleItem> {
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  let rowsLeft = inStableOrder(rows, inFile);
  let savedLeft = inStableOrder(saved, false);
  const pairOnDays = (daysOf: (item: ScheduleItem) => string | null) => {
    const twinsOn = new Map<string, ScheduleItem[]>();
    savedLeft.forEach(item => {
      const days = daysOf(item);
      if (days !== null) twinsOn.set(days, [...(twinsOn.get(days) || []), item]);
    });
    twinsOn.forEach((twins, days) => {
      const same = rowsLeft.filter(row => calendarDays(row) === days);
      if (same.length === twins.length) same.forEach((row, index) => pairs.set(row, twins[index]));
    });
    const taken = new Set(pairs.values());
    rowsLeft = rowsLeft.filter(row => !pairs.has(row));
    savedLeft = savedLeft.filter(item => !taken.has(item));
  };
  pairOnDays(calendarDays);
  pairOnDays(item => item.lookaheadOverlay ? calendarDays(masterDays(item)) : null);
  return pairs;
}

/**
 * Same-named rows paired with their saved twins (one project and area).
 *
 * Whole-app audit A5 pass 17 M2 (1 Oct 2026) paired them on the same calendar
 * days first, then the rest in file order. Whole-app audit A5 pass 18 (1 Oct
 * 2026): that swapped David's progress whenever a slip landed one twin on the
 * other's days (twins on 10/05 at 80% and 10/12, both slipped a week: the
 * new 10/12 row took the second twin, and the 80% went to 10/19), for a
 * master, Microsoft Project's one-day QUALITY INSPECTION twins, a lookahead
 * and Set Active (F1); "file order" was the order a device keeps saved tasks
 * in, which differs on the phone and the web (F2); and a lookahead listing
 * only some twins paired none, so Pour slab showed three times and the next
 * master paired none either (F3).
 *
 * Now, by the schedule's role:
 * - A master (and Set Active / Make Current) with as many rows as twins:
 *   when the rows are on exactly the twins' days (the master's days a note
 *   keeps), each pairs with the twin on its days, whatever order the file
 *   lists them in; otherwise Microsoft Project twins, every one with a row
 *   number from one file on each side, pair in each file's row order
 *   (inMicrosoftProjectOrder: its outline order; no identity of Project's
 *   survives a revision), and others pair both sides in one stable order
 *   (inStableOrder). A slip, of any size, keeps each twin's progress on its
 *   task.
 * - A master with a different count: a twin only a lookahead added (none of
 *   its imports a master's) is left to the lookahead when that makes the
 *   counts equal (the next master after a rolling lookahead, F3); else only
 *   twins on the same days pair (a twin added or dropped); none otherwise.
 * - A lookahead pairs by nearest days (pairByNearestDays).
 *
 * Dates alone cannot tell a slip by exactly the twin spacing from "drop the
 * first, keep the second, add a third", nor (outside Microsoft Project) from
 * "the first slipped past the second": a master reads it as the slip, a
 * lookahead (a rolling window) as the drop and add. That is the remaining
 * ambiguity. A single row and a single task always pair.
 */
function pairSameNamedTasks(
  rows: readonly ScheduleItem[],
  saved: readonly ScheduleItem[],
  { lookahead, inFile, addedByLookahead }: { lookahead: boolean; inFile: boolean; addedByLookahead: (item: ScheduleItem) => boolean },
): Map<ScheduleItem, ScheduleItem> {
  if (rows.length === 1 && saved.length === 1) return new Map([[rows[0], saved[0]]]);
  if (lookahead) return pairByNearestDays(rows, saved);
  if (rows.length === saved.length) return pairAsMany(rows, saved, inFile);
  // Whole-app audit A5 pass 19 L3 (1 Oct 2026): every row on a different saved twin's exact days pairs by
  // its days first. Leaving out a twin only a lookahead added ran before, so a master that dropped phase 1
  // and listed phases 2 and 3 on their days gave phase 1's 100% to phase 2, and 10/29 showed twice.
  const onSameDays = pairOnSameDays(rows, saved, inFile);
  if (onSameDays.size === rows.length) return onSameDays;
  const statedByMaster = saved.filter(item => !addedByLookahead(item));
  if (statedByMaster.length === rows.length && statedByMaster.length < saved.length) return pairAsMany(rows, statedByMaster, inFile);
  return onSameDays;
}

/** As many rows as twins (a master's, or Set Active's): see pairSameNamedTasks. */
function pairAsMany(rows: readonly ScheduleItem[], saved: readonly ScheduleItem[], inFile: boolean): Map<ScheduleItem, ScheduleItem> {
  const rowOrder = inStableOrder(rows, inFile);
  const savedOrder = inStableOrder(saved, false);
  const daysOf = (items: readonly ScheduleItem[]) => items.map(item => calendarDays(masterDays(item))).sort().join('\n\n');
  if (daysOf(rowOrder) === daysOf(savedOrder)) {
    // Unchanged twins (a file listing them in another order): each the twin on its days.
    const left = [...savedOrder];
    return new Map(rowOrder.map(row => [row, left.splice(left.findIndex(item => calendarDays(masterDays(item)) === calendarDays(masterDays(row))), 1)[0]]));
  }
  const rowsInProject = inMicrosoftProjectOrder(rows);
  const savedInProject = rowsInProject && inMicrosoftProjectOrder(saved);
  const [rowsPaired, savedPaired] = rowsInProject && savedInProject ? [rowsInProject, savedInProject] : [rowOrder, savedOrder];
  return new Map(rowsPaired.map((row, index) => [row, savedPaired[index]]));
}

/**
 * The saved task each imported row revises (whole-app audit A5 pass 3 F3,
 * 30 Sep 2026): among the tasks the manager sees and those this import
 * already saved, by name, project and area; same-named rows by the rule for
 * twins (pairSameNamedTasks: a master in one stable order, a lookahead by
 * nearest days, A5 pass 18), and only where no saved row could be either of
 * two tasks (an empty saved area matches every area); never by ID. A
 * lookahead row with no area or parent project pairs loosely, with a single
 * task only (A5 pass 5 M1). Set Active's and Make Current's carry pair the
 * tasks they show and hide as a master does (inFile false: both are saved
 * tasks, ordered by id where the days tie).
 */
function pairTaskRevisions(
  existing: readonly ScheduleItem[],
  imported: readonly ScheduleItem[],
  isCurrent: (item: ScheduleItem) => boolean,
  lookahead = false,
  inFile = true,
): Map<ScheduleItem, ScheduleItem> {
  const groups = new Map<string, ScheduleItem[]>();
  imported.forEach(item => {
    const group = [item.taskName, projectKey(item), item.locationName, item.importBatchId].map(key).join('|');
    groups.set(group, [...(groups.get(group) || []), item]);
  });
  const candidates = [...groups.values()].map(rows => {
    const eligible = existing.filter(item => isCurrent(item) || inImport(item, rows[0].importBatchId));
    const strict = eligible.filter(item => sameTask(item, rows[0]));
    const saved = lookahead ? eligible.filter(item => sameTask(item, rows[0], true)) : strict;
    // A lookahead row matched only loosely pairs with the one task it can be, never with either of two.
    return { rows, saved, vague: saved.length !== strict.length };
  });
  const groupCount = new Map<string, number>();
  candidates.forEach(({ saved }) => saved.forEach(item => groupCount.set(item.id, (groupCount.get(item.id) || 0) + 1)));
  // The lookaheads, known by the notes of the tasks they restated (A5 pass 18 F3), and by the tasks they added.
  // Whole-app audit A6 pass 19 M2 (1 Oct 2026): L1 added a third Pour slab and L2 restated it; deleting L1
  // cleared L1 from every note, so the third pour counted as a master's, the next master's two rows met three
  // twins, nothing paired, and David's 60% left the view. A task a lookahead added names its lookahead itself.
  const lookaheads = new Set([
    ...existing.flatMap(item => (item.lookaheadOverlay?.lookaheads || []).map(entry => key(entry.batchId))),
    ...existing.filter(item => item.importedAsLookahead === true).map(item => key(item.importBatchId)),
  ].filter(Boolean));
  const addedByLookahead = (item: ScheduleItem) => {
    const imports = scheduleItemImportBatchIds(item).map(key).filter(Boolean);
    return imports.length > 0 && imports.every(batch => lookaheads.has(batch));
  };
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  candidates
    .filter(({ rows, saved, vague }) => (!vague || (rows.length === 1 && saved.length === 1)) &&
      saved.every(item => groupCount.get(item.id) === 1))
    .forEach(({ rows, saved }) => pairSameNamedTasks(rows, saved, { lookahead, inFile, addedByLookahead })
      .forEach((item, row) => pairs.set(row, item)));
  return pairs;
}

/**
 * The tasks the manager saw before this import: the current schedules, with
 * this import's own documents left out so the rows a later Accept Selected
 * approves still pair with the tasks the first approval hid (A5 pass 3 F3).
 */
export function scheduleItemsVisibleBeforeImport(
  items: readonly ScheduleItem[],
  documents: readonly ReferenceDocument[],
  importBatchId: string,
): (item: ScheduleItem) => boolean {
  const visible = new Set(selectAuthoritativeScheduleItems({
    scheduleItems: [...items],
    scheduleDocuments: documents.filter(document => key(document.importBatchId) !== key(importBatchId)),
  }).map(item => item.id));
  return item => visible.has(item.id);
}

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
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
function progressStatedAt(item: ScheduleItem): number {
  const verification = item.completionVerification;
  return Math.max(
    timeOf(scheduleProgressJudgedAt(item)),
    verification?.status === 'pm_verified' ? timeOf(verification.verifiedAt || verification.reportedAt) : 0,
    scheduleProgressIsManagers(item) ? 0 : timeOf(item.importedAt || item.createdAt),
  );
}

/**
 * Whole-app audit A5 pass 4 #3 (30 Sep 2026): a revised schedule uploaded on
 * the web takes the manager's progress when it is uploaded; Make Current,
 * days later, only changes which schedule is current. Progress recorded in
 * between (80% on the phone) stayed on the task the revision hid, and every
 * device showed the 40% copied at upload. Set Active on the phone had the
 * same gap for a schedule imported earlier.
 *
 * When a schedule is made current, each task it now shows is paired, as the
 * import pairs (pairTaskRevisions: name, project and area), with the task it
 * hides; when the hidden task holds the manager's progress stated after the
 * shown copy's, the shown task takes it. A higher percent a file gave is
 * never lowered (A5 pass 4 #1); a manager's own older value is. Returns the
 * shown tasks to save.
 */
export function scheduleProgressCarriedToShownTasks({
  before,
  after,
  documentsBefore,
  documentsAfter,
  now = new Date().toISOString(),
}: {
  /** The tasks shown before the schedule was made current. */
  before: readonly ScheduleItem[];
  /** The tasks shown after. */
  after: readonly ScheduleItem[];
  /** The schedules before and after: a task entered by hand waiting on one made current is restated (A5 pass 18 L3). */
  documentsBefore?: readonly ReferenceDocument[];
  documentsAfter?: readonly ReferenceDocument[];
  now?: string;
}): ScheduleItem[] {
  const carried = progressCarried(before, after, now);
  const restated = documentsBefore && documentsAfter ? handTasksRestatedWhenCurrent(after, documentsBefore, documentsAfter, now) : [];
  const carriedIds = new Set(carried.map(item => item.id));
  return [...carried, ...restated.filter(item => !carriedIds.has(item.id))];
}

/**
 * A row of a schedule saved before it is current, noted on the task entered
 * by hand it restates (whole-app audit A5 pass 18 L3), replacing an earlier
 * row of the same schedule.
 */
function withRowAwaitingCurrent(task: ScheduleItem, row: ScheduleItem, at: string): ScheduleItem {
  const batchId = typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '';
  if (!batchId) return task;
  const entry: ScheduleRowAwaitingCurrent = {
    importBatchId: batchId,
    sourceDocumentId: row.sourceDocumentId ?? null,
    startDate: row.startDate,
    finishDate: row.finishDate,
    percentComplete: percentOf(row),
    ...(scheduleRowStatesPercent(row) ? {} : { percentCompleteStated: false }),
    status: row.status,
  };
  const others = (task.scheduleRowsAwaitingCurrent || []).filter(waiting => key(waiting.importBatchId) !== key(batchId));
  return { ...task, scheduleRowsAwaitingCurrent: [...others, entry], updatedAt: at };
}

/**
 * Whole-app audit A5 pass 18 L3 (1 Oct 2026): a schedule uploaded on the web
 * is not current until David makes it current ("must be reviewed"), but its
 * upload already moved his hand-entered Pour slab to the file's dates on
 * every device, and nothing undid that if he never made it current. The
 * upload now notes the row on the task (scheduleRowsAwaitingCurrent) and
 * changes nothing he sees. When a schedule becomes the current one for the
 * task's project (Make Current on the web, Set Active on the phone), its row
 * restates the task as approving it on the phone does: in place, on the
 * file's dates, the file's percent only over a lower one of his (owner answer
 * Q22), his owner and notes kept. The note is dropped then.
 */
function handTasksRestatedWhenCurrent(
  shown: readonly ScheduleItem[],
  documentsBefore: readonly ReferenceDocument[],
  documentsAfter: readonly ReferenceDocument[],
  now: string,
): ScheduleItem[] {
  const currentBefore = currentScheduleDocumentsByProject(documentsBefore);
  const currentAfter = currentScheduleDocumentsByProject(documentsAfter);
  return shown.flatMap(task => {
    const waiting = task.scheduleRowsAwaitingCurrent || [];
    if (waiting.length === 0 || ownedByImport(task)) return [];
    const project = scheduleProjectScopeKey(task.projectName || task.scheduleProjectName || '');
    const madeCurrent = currentAfter.get(project);
    if (!madeCurrent || currentBefore.get(project)?.id === madeCurrent.id) return [];
    const entry = waiting.find(row => key(row.importBatchId) === key(madeCurrent.importBatchId));
    if (!entry) return [];
    const { scheduleRowsAwaitingCurrent: _waiting, ...plain } = task;
    const rest = waiting.filter(row => row !== entry);
    const base = (rest.length > 0 ? { ...plain, scheduleRowsAwaitingCurrent: rest } : plain) as ScheduleItem;
    const row = {
      id: `${task.id}#${entry.importBatchId}`, projectName: task.projectName, scheduleProjectName: task.scheduleProjectName ?? null,
      locationName: task.locationName, taskName: task.taskName, startDate: entry.startDate, finishDate: entry.finishDate,
      milestone: task.milestone, owner: '', contractor: '', percentComplete: entry.percentComplete,
      ...(entry.percentCompleteStated === false ? { percentCompleteStated: false } : {}),
      status: entry.status, priority: task.priority, notes: '', importBatchId: entry.importBatchId,
      sourceDocumentId: entry.sourceDocumentId ?? null, createdAt: now,
    } as ScheduleItem;
    // Whole-app audit A5 pass 19 L1 (1 Oct 2026): a lookahead David approved after this schedule was
    // uploaded restated the task since (10/14, 60%), and Make Current put it back on the upload's older
    // row (10/08, his 40%); a task a file brought in keeps the lookahead's. The row now only brings the
    // note's master dates and percent up to it, as a master does under a lookahead; the task keeps what it shows.
    const madeCurrentAt = timeOf(madeCurrent.importedAt);
    const newerThanMaster = (noted: { batchId: string }) => madeCurrentAt > 0 && documentsAfter.some(document =>
      key(document.importBatchId) === key(noted.batchId) && timeOf(document.importedAt) > madeCurrentAt);
    const restatedSince = (task.lookaheadOverlay?.lookaheads || []).some(newerThanMaster);
    // Only the lookaheads older than this master have their dates replaced by it (A6 pass 19 M1).
    if (restatedSince) {
      return [{ ...scheduleTaskMasterRestated(scheduleNoteTakesManagersProgress(base), row, now, noted => !newerThanMaster(noted)), updatedAt: now }];
    }
    // Restated as the phone's approval restates it; a row that no longer pairs (renamed since) only drops the note.
    const { next } = mergeApprovedScheduleImportItems({
      existing: [base], imported: [row], completionMatch: () => null, mergeCompletion: item => item, approvedAt: now,
    });
    return [next[0]];
  });
}

function progressCarried(before: readonly ScheduleItem[], after: readonly ScheduleItem[], now: string): ScheduleItem[] {
  const beforeIds = new Set(before.map(item => item.id));
  const afterIds = new Set(after.map(item => item.id));
  const nowShown = after.filter(item => !beforeIds.has(item.id));
  const nowHidden = before.filter(item => !afterIds.has(item.id));
  if (nowShown.length === 0 || nowHidden.length === 0) return [];
  const pairs = pairTaskRevisions(nowHidden, nowShown, () => true, false, false);
  return nowShown.flatMap(shown => {
    const hidden = pairs.get(shown);
    if (!hidden || !scheduleProgressIsManagers(hidden)) return [];
    if (progressStatedAt(hidden) <= progressStatedAt(shown)) return [];
    if (!scheduleProgressIsManagers(shown) && percentOf(hidden) < percentOf(shown)) return [];
    if (percentOf(hidden) === percentOf(shown) && hidden.status === shown.status) return [];
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
    return [{
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
    }];
  });
}

/** The phone's form: every saved task, and the schedules before and after Set Active. */
export function scheduleProgressCarriedOnActivation({
  items,
  documentsBefore,
  documentsAfter,
  now,
}: {
  items: readonly ScheduleItem[];
  documentsBefore: readonly ReferenceDocument[];
  documentsAfter: readonly ReferenceDocument[];
  now?: string;
}): ScheduleItem[] {
  const shownWith = (documents: readonly ReferenceDocument[]) =>
    selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] });
  return scheduleProgressCarriedToShownTasks({
    before: shownWith(documentsBefore), after: shownWith(documentsAfter), documentsBefore, documentsAfter, now,
  });
}

/** The import identity, with an empty saved area matching the imported one. */
function sameImportIdentity(existing: ScheduleItem, imported: ScheduleItem): boolean {
  if (!sameArea(existing, imported)) return false;
  return scheduleImportItemIdentity({ ...existing, locationName: imported.locationName }) ===
    scheduleImportItemIdentity(imported);
}

export function mergeApprovedScheduleImportItems({
  existing,
  imported,
  completionMatch,
  mergeCompletion,
  isCurrent = () => true,
  approvedAt = new Date().toISOString(),
  overlay = false,
  current = true,
}: {
  existing: readonly ScheduleItem[];
  imported: readonly ScheduleItem[];
  /** An imported row that is a completion claim for one existing task. */
  completionMatch: (importedItem: ScheduleItem, items: readonly ScheduleItem[]) => ScheduleItem | null;
  mergeCompletion: (item: ScheduleItem, importedItem: ScheduleItem) => ScheduleItem;
  /** A saved task the manager sees; only these and this import's own pair with a revised row. */
  isCurrent?: (item: ScheduleItem) => boolean;
  /** When the owner approved the import: when a task's file progress is confirmed. */
  approvedAt?: string;
  /** A lookahead: it adds to the master and restates the master's tasks in place (owner answer Q22). */
  overlay?: boolean;
  /**
   * False for a schedule saved before it is current (a web upload "must be
   * reviewed"): a task entered by hand is restated only when the schedule is
   * made current (scheduleRowsAwaitingCurrent, A5 pass 18 L3).
   */
  current?: boolean;
}): ScheduleImportMergeResult {
  let next = [...existing];
  const additions: ScheduleItem[] = [];
  const rehomedIds: string[] = [];
  const carriedProgressIds: string[] = [];
  const fileProgressIds: string[] = [];
  const overlaidIds: string[] = [];
  const pairs = pairTaskRevisions(existing, imported, isCurrent, overlay);
  const claimed = new Set([...pairs.values()].map(item => item.id));
  const seen = new Set<string>();

  imported.forEach(importedItem => {
    const match = completionMatch(importedItem, next);
    if (match) {
      next = next.map(item => item.id === match.id ? mergeCompletion(item, importedItem) : item);
      return;
    }
    // The strict identity de-duplicates one file, a re-homed row included.
    const identity = scheduleImportItemIdentity(importedItem);
    if (seen.has(identity)) return;
    seen.add(identity);
    const pairedId = pairs.get(importedItem)?.id;
    const pairedSaved = pairedId ? next.find(item => item.id === pairedId) : undefined;
    if (overlay) {
      const saved = pairedSaved || next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem));
      if (!saved) {
        // Added by the lookahead: it says so itself, after the lookahead's notes are gone (A6 pass 19 M2).
        additions.push({ ...importedItem, importedAsLookahead: true });
        return;
      }
      claimed.add(saved.id);
      const batchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      if (batchId && scheduleItemImportBatchIds(saved).map(key).includes(key(batchId))) return;
      // The note takes the progress the manager holds now before the file applies (A5 pass 7 M1).
      const target = scheduleNoteTakesManagersProgress(saved);
      const fileProgress = scheduleFileProgressAboveManagers(target, fileProgressFor(target, importedItem, approvedAt), approvedAt);
      // The lookahead notes the percent it gave, so deleting it can give the master's back (A5 pass 5 H1):
      // the percent its row states whenever the task ends at it, unchanged too, so deleting an older lookahead
      // that said the same leaves it (A5 pass 6 M1).
      const endsAt = percentOf({ ...target, ...(fileProgress || {}) } as ScheduleItem);
      const givenPercent = scheduleRowStatesPercent(importedItem)
        ? (percentOf(importedItem) === endsAt ? endsAt : null)
        : (fileProgress && statusStartsTask(target, importedItem) && endsAt === 1 ? 1 : null); // the 1% "In Progress" gave (A5 pass 10 L1)
      next = next.map(item => item.id === target.id
        ? { ...scheduleTaskRestatedByLookahead(target, importedItem, approvedAt, givenPercent), ...(fileProgress || {}) }
        : item);
      overlaidIds.push(target.id);
      if (fileProgress) fileProgressIds.push(target.id);
      return;
    }
    // A note takes the progress the manager holds now before the file applies (A5 pass 7 M1).
    const paired = pairedSaved && scheduleNoteTakesManagersProgress(pairedSaved);
    // A new master repeating what it said before a lookahead restated the task (Q22).
    const repeated = paired ? scheduleRowRepeatsMasterBeforeLookahead(paired, importedItem) : { dates: false, percent: false };
    // A task entered by hand, on new dates: restated in place on the master's dates (A5 pass 17 M1).
    const movedByHand = Boolean(paired) && !ownedByImport(paired!) && !unchangedTask(paired!, importedItem) && !repeated.dates;
    const found = paired
      ? (unchangedTask(paired, importedItem) || repeated.dates || movedByHand ? paired : undefined)
      : next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem));
    const duplicate = found && scheduleNoteTakesManagersProgress(found);
    // An import's task on new dates is a new row: it answers to the ids the task had before (A10 pass 5 M1), and keeps
    // its lookahead note, brought up to what this master says, as the task left on its dates does (A5 pass 8 L3).
    const note = paired?.lookaheadOverlay ? scheduleTaskMasterRestated(paired, importedItem, approvedAt).lookaheadOverlay : undefined;
    const revision = (row: ScheduleItem): ScheduleItem => paired && paired.id !== row.id
      ? scheduleTaskRevisedFrom(note ? { ...row, lookaheadOverlay: note } : row, paired)
      : row;
    if (duplicate) {
      claimed.add(duplicate.id);
      // An unchanged task an earlier import owns now belongs to this import
      // too; a task entered by hand keeps its own provenance and stays visible.
      const owned = ownedByImport(duplicate);
      const newBatchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      const batches = scheduleItemImportBatchIds(duplicate).map(key);
      // A file the task already belongs to, approved again, changes nothing (A5 pass 4 #1).
      if (newBatchId && batches.includes(key(newBatchId))) return;
      const rehome = owned && Boolean(newBatchId);
      const fileProgress = repeated.percent ? null
        : scheduleFileProgressAboveManagers(duplicate, fileProgressFor(duplicate, importedItem, approvedAt), approvedAt);
      const noted = scheduleTaskMasterRestated(duplicate, importedItem, approvedAt);
      // On the master's dates, as a lookahead restates a task (A5 pass 17 M1); a date the row leaves blank stays.
      const dates = {
        startDate: key(importedItem.startDate) ? importedItem.startDate : noted.startDate,
        finishDate: key(importedItem.finishDate) ? importedItem.finishDate : noted.finishDate,
      };
      const restated = movedByHand && !unchangedTask(noted, { ...noted, ...dates })
        ? { ...noted, ...dates, updatedAt: approvedAt }
        : noted;
      if (!current && !owned) {
        // Not current yet: the row waits on the task until its schedule is made current (A5 pass 18 L3).
        if (fileProgress || restated !== duplicate) {
          next = next.map(item => item.id === duplicate.id ? withRowAwaitingCurrent(item, importedItem, approvedAt) : item);
        }
        return;
      }
      if (rehome || fileProgress || restated !== next.find(item => item.id === duplicate.id)) {
        next = next.map(item => item.id === duplicate.id
          ? {
              ...restated,
              ...(fileProgress || {}),
              ...(rehome ? {
                locationName: key(restated.locationName) ? restated.locationName : importedItem.locationName,
                alsoImportedInBatchIds: [...(restated.alsoImportedInBatchIds || []), newBatchId],
                // Its row in this file, for the twins' file order (A5 pass 19 L4).
                ...(Number.isFinite(importedItem.sourceRowNumber)
                  ? { alsoImportedSourceRow: { importBatchId: newBatchId, sourceRowNumber: Number(importedItem.sourceRowNumber) } }
                  : {}),
              } : {}),
            }
          : item);
      }
      if (rehome) rehomedIds.push(duplicate.id);
      if (fileProgress) fileProgressIds.push(duplicate.id);
      return;
    }
    if (
      paired &&
      paired.progressSource === 'project_manager' &&
      key(paired.importBatchId) !== key(importedItem.importBatchId)
    ) {
      // The file's owner, contractor and notes win; the manager's fill a blank.
      const kept = (value: string, saved: string) => key(value) || !key(saved) ? value : saved;
      const filled = {
        ...importedItem,
        owner: kept(importedItem.owner, paired.owner),
        contractor: kept(importedItem.contractor, paired.contractor),
        notes: kept(importedItem.notes, paired.notes),
      };
      // The manager's progress, unless the file's is higher or the saved progress was a file's (A5 pass 4 #1),
      // never below the manager's own percent a lookahead's note shows (A5 pass 6 M2).
      const fileProgress = fileProgressFor(paired, importedItem, approvedAt);
      const floored = scheduleFileProgressAboveManagers(paired, fileProgress, approvedAt);
      if (fileProgress && floored === fileProgress) {
        additions.push(revision(filled));
        fileProgressIds.push(importedItem.id);
        return;
      }
      if (floored) {
        additions.push(revision({ ...filled, ...floored, completionVerification: paired.completionVerification ?? null }));
        carriedProgressIds.push(importedItem.id);
        return;
      }
      additions.push(revision({
        ...filled,
        percentComplete: paired.percentComplete,
        status: paired.status,
        progressSource: paired.progressSource,
        progressConfirmedAt: paired.progressConfirmedAt ?? null,
        progressConfirmedBy: paired.progressConfirmedBy ?? null,
        // When David judged a percent given back to him goes with it (A10 pass 6 L1 / A5 pass 8 L2).
        ...(paired.progressJudgment ? { progressJudgment: paired.progressJudgment } : {}),
        completionVerification: paired.completionVerification ?? null,
      }));
      carriedProgressIds.push(importedItem.id);
      return;
    }
    if (paired && statusStartsTask(paired, importedItem) && key(paired.importBatchId) !== key(importedItem.importBatchId)) {
      // "In Progress" with no percent over Not Started 0%: the task on its new dates starts at 1% (A5 pass 10 L1).
      additions.push(revision({ ...importedItem, percentComplete: 1, status: 'In Progress' }));
      fileProgressIds.push(importedItem.id);
      return;
    }
    if (paired && !scheduleRowStatesPercent(importedItem) && key(paired.importBatchId) !== key(importedItem.importBatchId)) {
      // The file states no percent: the task on its new dates keeps the progress it had (A5 pass 5 H1).
      additions.push(revision({
        ...importedItem,
        percentComplete: paired.percentComplete,
        status: paired.status,
        progressSource: paired.progressSource ?? null,
        progressConfirmedAt: paired.progressConfirmedAt ?? null,
        progressConfirmedBy: paired.progressConfirmedBy ?? null,
        ...(paired.progressJudgment ? { progressJudgment: paired.progressJudgment } : {}), // A10 pass 6 L1
        completionVerification: paired.completionVerification ?? null,
      }));
      carriedProgressIds.push(importedItem.id);
      return;
    }
    additions.push(revision(importedItem));
  });

  return { next, additions: additions.map(scheduleRowAsTask), rehomedIds, carriedProgressIds, fileProgressIds, overlaidIds };
}
