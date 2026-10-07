import type { ReferenceDocument, ScheduleItem, ScheduleRowAwaitingCurrent } from '../types';
import { scheduleImportItemIdentity } from './PIEScheduleImportBatch';
import {
  currentScheduleDocumentsByProject,
  scheduleItemAsSaved,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
  scheduleDocumentAddsToMaster,
} from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';
import { sameScheduleCalendarDay, scheduleCalendarDay, scheduleCalendarDayKey } from './ScheduleCalendarDay';
import {
  schedulePriorityAsRead,
  schedulePriorityHeSet,
  schedulePriorityIsHis,
  scheduleTaskEarlierIds,
  scheduleTaskLinksFollowingShownTasks,
  scheduleTaskLinkTargets,
  scheduleTaskLinksOf,
  scheduleTaskLinksPointedAt,
  scheduleTaskRevisedFrom,
  scheduleTaskWithLinksOf,
} from './ScheduleTaskRevisions';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressCarriedFrom,
  scheduleManagersOwnPercent,
  scheduleProgressFlooredAtManagers,
  scheduleProgressLeftStanding,
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
  scheduleTasksOnNotedDatesWhenCurrent,
} from './ScheduleLookahead';
import { scheduleItemActivityWithOtherRows, scheduleItemAsLastSetOnItsOtherRow, scheduleItemFieldAsRead, scheduleTaskOfRowId } from './ScheduleItemEditBase';
import { mergeProjectControlsRevisions } from './VitruviusProjectControls';

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
 *
 * Review N2 P1 (5 Oct 2026, older: the same on Build 229): the row a master
 * moves a task to filled its blank owner, contractor and notes from the
 * task only when David had also entered a percent on it (the fill above, A5
 * pass 3 F3, sat in the branch for his own progress). An owner he assigned
 * or a note he typed on a task he had not started stayed on the hidden old
 * row when next week's master slipped the task, and the report said "Framing
 * owner changed from Mike to unassigned." Every row a master moves a task to
 * now fills them, by the same rule: the file's value wins, the task's fills
 * a blank (withBlanksFilledFrom), on the phone's approval and the web's
 * upload alike. A lookahead restates the task in place, so nothing moves.
 * Set Active and Make Current fill the row they show from the row they hide
 * when that row was changed later (scheduleTextCarriedToShownTask). What
 * earlier imports left behind goes with the task the next time a master
 * moves it, where it can be told from a blank David left
 * (textStrandedOnEarlierRows).
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

/** The highest percent a master's file has stated on a row, after one more that stands on it (fileProgressPeak). */
function scheduleFileProgressPeakAfter(saved: ScheduleItem, stands: Partial<ScheduleItem>, approvedAt: string): NonNullable<ScheduleItem['fileProgressPeak']> {
  const stated = percentOf({ percentComplete: stands.percentComplete } as ScheduleItem);
  const before = saved.fileProgressPeak;
  return before && typeof before.statedAt === 'string' && Number(before.percentComplete) > stated ? before : { percentComplete: stated, statedAt: approvedAt };
}

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
  // David's own percent the file's higher one replaces, kept as a lookahead's floor (A5 recorded Low, Q22), with when
  // he judged it (A6 pass 24 L1): one entered by hand with no source, when it was imported or created.
  const under = managers ? {
    managersPercentUnderFile: percentOf(saved),
    managersPercentUnderFileJudgedAt: scheduleProgressJudgedAt(saved) || saved.importedAt || saved.createdAt || null,
  } : {};
  // Taken at approval: a manager-ranked task stays manager-ranked, confirmed
  // by the approval, so every device's merge keeps the file's value.
  if (saved.progressSource === 'project_manager') {
    return { percentComplete: file.percentComplete, status: file.status, progressSource: 'project_manager', ...confirmed, ...under, updatedAt: approvedAt };
  }
  return owned
    ? { percentComplete: file.percentComplete, status: file.status, ...under, updatedAt: approvedAt }
    : { percentComplete: file.percentComplete, status: file.status, progressSource: 'schedule_import', ...confirmed, ...under, updatedAt: approvedAt };
}

/**
 * The row a master moves a task to, with David's own percent a file's
 * replaced on the task (managersPercentUnderFile) while the row carries a
 * file's percent: the floor follows the task to its new row, as its note
 * does (A5 recorded Low, Q22 floor gap).
 */
function withManagersPercentUnderFile(row: ScheduleItem, paired: ScheduleItem): ScheduleItem {
  const under = paired.managersPercentUnderFile;
  if (typeof under !== 'number' || typeof row.managersPercentUnderFile === 'number' || scheduleProgressIsManagers(paired)) return row;
  // With when David judged it (A6 pass 24 L1).
  const judgedAt = paired.managersPercentUnderFileJudgedAt;
  return { ...row, managersPercentUnderFile: under, ...(judgedAt !== undefined ? { managersPercentUnderFileJudgedAt: judgedAt } : {}) };
}

/** The fields David types on a task that a schedule file may also state (next step and milestone: review N3 C). */
const TYPED_TEXT_FIELDS = ['owner', 'contractor', 'notes', 'nextAction', 'milestone'] as const;

/**
 * Review N3 C (5 Oct 2026, Medium; older, already in Build 229): what else
 * David sets on a task stayed on the hidden old row when a master moved the
 * task. He set Paint's approval to Pending, or a schedule impact of 5 days;
 * a new master listed Paint on other dates; the new row started with none,
 * and the next report said "Paint approval changed from Pending to Not
 * Required." or "Survey schedule impact changed from 1 day to not set.",
 * though nobody had changed either. A row with the task's project controls
 * (approval status, schedule impact, assignee, checklist and the rest). No
 * schedule file states them, so a row from a file takes the task's as they
 * are; between two rows that both hold his (Set Active, Make Current), the
 * later entry of each field stands, as two copies of one task's are merged.
 * The same row when the task has none, or the row already holds them.
 */
function withControlsOf(row: ScheduleItem, task: Pick<ScheduleItem, 'projectControls'>, fromFile: boolean): ScheduleItem {
  if (!task.projectControls) return row;
  const controls = fromFile || !row.projectControls ? task.projectControls : mergeProjectControlsRevisions(row.projectControls, task.projectControls);
  return JSON.stringify(controls) === JSON.stringify(row.projectControls ?? null) ? row : { ...row, projectControls: controls };
}

/**
 * A row with its blank owner, contractor and notes filled from the task it
 * is a row of: the file's value wins, the task's fills a blank (A5 pass 3
 * F3; for every moved row since review N2 P1). The same row when nothing is
 * filled.
 */
function withBlanksFilledFrom<T extends ScheduleItem>(row: T, task: Pick<ScheduleItem, typeof TYPED_TEXT_FIELDS[number]>): T {
  const filled = TYPED_TEXT_FIELDS.filter(field => !key(row[field]) && key(task[field]));
  return filled.length === 0 ? row : { ...row, ...Object.fromEntries(filled.map(field => [field, task[field]])) };
}

/**
 * Review N3 R3 and review P4 F1: the new row a master saves for a task takes
 * his owner, contractor, note, next step and milestone from the copy of the
 * task the approving device holds. That copy may be behind (he changed or
 * cleared one on another device that this one has not heard), and the
 * approval may have no signal, so it cannot ask the cloud. The new row says
 * which row it replaces and, for every one of those fields the file left
 * unset, what that row had, a blank included (textFromTask). Everything that
 * later weighs the two rows reads it as the copy the new row started from
 * (ScheduleItemEditBase, scheduleItemAgainstItsTask).
 *
 * What the row had itself: text read back for it from a row before it
 * (review N2 P1, second part) is not what that row had, so on the new row it
 * reads as set there and is not weighed against that row's blank. A field
 * the file states has no entry: the file's value is not his to follow.
 * (At first only the values taken were recorded, and no record was kept when
 * none was. A master approved with no signal by a device that had heard
 * nothing of an owner, a note or an approval set elsewhere then had nothing
 * to weigh its new row against: the reviewer's A, A2, B and X.)
 */
function withTextTakenNoted(row: ScheduleItem, filled: ScheduleItem, task: ScheduleItem): ScheduleItem {
  const unset = TYPED_TEXT_FIELDS.filter(field => !key(row[field]));
  // Schedule batch S5, item 1 (Medium; older, the same on Build 229): and the task's priority, when it is one he set
  // (schedule batch S6, item 1: schedulePriorityIsHis). The row then says it took it, so it is weighed like the rest
  // wherever rows meet. A task whose priority he never set gets the row's own, as before S5: the file's Critical
  // column, or High when the finish is within a week of the import.
  const his = schedulePriorityIsHis(task) ? { priority: scheduleItemFieldAsRead('priority', task.priority) as ScheduleItem['priority'] } : {};
  // (With the mark his edit of it left, when the task's row has one: the priority he set, and when. Review pass 1, P1-1 / P1-2.)
  const mark = schedulePriorityHeSet(task);
  return { ...filled, ...his, ...(mark ? { prioritySetByHand: mark } : {}), textFromTask: { taskId: task.id, ...Object.fromEntries(unset.map(field => [field, task[field] ?? ''])), ...his } };
}

type TypedText = Partial<Pick<ScheduleItem, typeof TYPED_TEXT_FIELDS[number]>>;

/**
 * Review N2 P1, second part (5 Oct 2026): the owners, contractors and notes
 * that imports made before the fix above (Build 229 and earlier) left on
 * hidden rows. For each task shown, what it is missing that an earlier row
 * of the same task still holds. A row a master moves the task to takes them
 * with the task's own (mergeApprovedScheduleImportItems).
 *
 * The earlier rows of a task are known only by the ids its row answers to
 * (revisedFromTaskIds, kept since A10 pass 5 M1): the pairing an import
 * made, David's answers included. A row saved before that keeps no id, and
 * a guess by name could put one same-named task's note on another, so such
 * a row is never read. The row before a row is the one whose own ids are
 * exactly the rest of its chain: with a row between deleted, or ids added
 * out of order by a delete, the chain is not followed.
 *
 * A blank on the task shown cannot be told from a note David cleared, so
 * the earlier rows are read only for a task never changed since its import
 * (no update stamp: every edit of his, on the phone or the web, stamps the
 * task; a moved row is saved unstamped). The walk back likewise passes only
 * rows never changed since their import: a blank on a row he edited stands.
 * Never from a row that is itself shown, nor from one that two tasks shown
 * answer to (same-named tasks).
 *
 * Only for the row an import is saving anyway. Filling a task that stays on
 * its row was tried here and taken out: each device made that fill at its
 * own next approval, and the two copies of the same change met in Review
 * Conflicts as a card with nothing to choose, after which an offline
 * lookahead's percent on another task was lost (the reviewer's generator,
 * seed 20137). The sync's own carry does that part, sent as those fields
 * alone (DAVEScheduleRecovery, typedTextCarriedToRevisedTasks).
 */
function textStrandedOnEarlierRows(
  existing: readonly ScheduleItem[],
  isCurrent: (item: ScheduleItem) => boolean,
): Map<string, TypedText> {
  const stranded = new Map<string, TypedText>();
  const shown = existing.filter(isCurrent);
  if (!shown.some(item => scheduleTaskEarlierIds(item).length > 0)) return stranded;
  const idOf = (item: ScheduleItem) => item.id.trim();
  const rowById = new Map(existing.map(item => [idOf(item), item] as const));
  const shownIds = new Set(shown.map(idOf));
  const answering = new Map<string, number>();
  shown.forEach(item => scheduleTaskEarlierIds(item).forEach(id => answering.set(id, (answering.get(id) || 0) + 1)));
  const neverChanged = (row: ScheduleItem) => !key(row.updatedAt);
  const rowBefore = (row: ScheduleItem): ScheduleItem | undefined => {
    const chain = scheduleTaskEarlierIds(row);
    const before = chain.map(id => rowById.get(id)).filter((candidate): candidate is ScheduleItem => {
      if (!candidate) return false;
      const own = new Set([idOf(candidate), ...scheduleTaskEarlierIds(candidate)]);
      return own.size === chain.length && chain.every(id => own.has(id));
    });
    return before.length === 1 ? before[0] : undefined;
  };
  shown.forEach(task => {
    if (!neverChanged(task)) return;
    let blank = TYPED_TEXT_FIELDS.filter(field => !key(task[field]));
    const found: TypedText = {};
    let row = task;
    while (blank.length > 0) {
      const earlier = rowBefore(row);
      if (!earlier || shownIds.has(idOf(earlier)) || answering.get(idOf(earlier)) !== 1 || !sameTask(earlier, task)) break;
      blank.forEach(field => { if (key(earlier[field])) found[field] = earlier[field]; });
      blank = blank.filter(field => !(field in found));
      if (!neverChanged(earlier)) break;
      row = earlier;
    }
    if (Object.keys(found).length > 0) stranded.set(task.id, found);
  });
  return stranded;
}

/**
 * Whole-app audit A5 recorded Low (the Q22 floor gap, 1 Oct 2026; wrong at
 * c73ceab too): David entered 40% on a task, master G stated 60% (a file's
 * percent above his, so the task took it), and a newer lookahead stating
 * 30% took the task to 30%, below David's 40%. Q22 floors a lookahead's
 * percent at David's own, but once G's 60% replaced his percent nothing
 * kept it: the lookahead's note noted G's 60% as the schedule's. A file's
 * percent that replaces David's own now keeps his percent on the task
 * (managersPercentUnderFile), and while the task's percent is still a
 * file's, a lookahead's percent is never set below it. The floored percent
 * is the lookahead's (the file's, as its percent would have been), so
 * deleting the lookahead gives back the master's percent before it, as
 * for any percent a lookahead gave. A task entered by hand and an imported
 * task alike; a master's percent is unchanged (a later file may still
 * correct a file's percent, A5 pass 7 L2).
 */
function lookaheadProgressAboveManagersUnderFile(task: ScheduleItem, progress: Partial<ScheduleItem> | null): Partial<ScheduleItem> | null {
  const floor = task.managersPercentUnderFile;
  if (!progress || typeof floor !== 'number' || !Number.isFinite(floor) || scheduleProgressIsManagers(task)) return progress;
  if (percentOf(progress as ScheduleItem) >= floor) return progress;
  const kept = reconcileScheduleProgress(progress.status ?? task.status, floor);
  return { ...progress, percentComplete: kept.percentComplete, status: kept.status };
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
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  rows.forEach(row => {
    const twin = uniquelyNearest(saved, candidate => daysApart(row, candidate));
    if (twin && uniquelyNearest(rows, candidate => daysApart(candidate, twin)) === row) pairs.set(row, twin);
  });
  return pairs;
}

/** How far a lookahead's row is from a saved twin: from the days it shows, or the master's days its note keeps. */
function daysApart(row: ScheduleItem, twin: ScheduleItem): number | null {
  const span = spanOf(row);
  const spans = [spanOf(twin), twin.lookaheadOverlay ? spanOf(masterDays(twin)) : null]
    .filter((value): value is readonly [number, number] => value !== null);
  return span && spans.length > 0 ? Math.min(...spans.map(twinSpan => apart(span, twinSpan))) : null;
}

/**
 * Review N1 L5 (3 Oct 2026, older; owner answer Q30 says ask): a lookahead's
 * row as near to one saved twin as to another pairs with neither
 * (pairByNearestDays) and came in as a new task, unasked; so did the one row
 * of a master that lists fewer of the name than are saved. Whether the guess
 * leaves a row new that two of the saved twins it leaves unpaired are equally
 * nearest to, or leaves a saved twin unpaired that two such rows are equally
 * nearest to.
 *
 * Review N2 G2 (5 Oct 2026, Low, older: the same on Build 229): Pour slabs on
 * 10/01, 10/15 and 10/29; a lookahead lists the second one week later
 * (10/22) and the third two days later (10/31). The 10/22 row is as near to
 * the second as to the third, so it pairs with neither, but the third was
 * taken by the 10/31 row and no longer counted: no question, and 10/22 came
 * in as a new task (listed alone, it was asked). A row the guess leaves new
 * is also tied when two of all the saved twins are equally nearest to it,
 * whichever rows took them. Only a question more: confirmed as guessed, the
 * approval does what it did.
 */
function tiedBetweenTwins(
  rows: readonly ScheduleItem[],
  saved: readonly ScheduleItem[],
  guess: ReadonlyMap<ScheduleItem, ScheduleItem>,
): boolean {
  const paired = new Set(guess.values());
  const rowsLeft = rows.filter(row => !guess.has(row));
  const savedLeft = saved.filter(item => !paired.has(item));
  const tied = <T,>(candidates: readonly T[], scoreOf: (candidate: T) => number | null) => {
    const scores = candidates.map(scoreOf).filter((score): score is number => score !== null);
    const lowest = Math.min(...scores);
    return scores.filter(score => score === lowest).length > 1;
  };
  return rowsLeft.some(row => tied(savedLeft, twin => daysApart(row, twin)) || tied(saved, twin => daysApart(row, twin))) ||
    savedLeft.some(twin => tied(rowsLeft, row => daysApart(row, twin)));
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
  /** David's answers at import review: an imported row's id to the saved task's, or null for none (owner answer Q30). */
  choices?: ReadonlyMap<string, string | null>,
): Map<ScheduleItem, ScheduleItem> {
  const addedByLookahead = statedOnlyByLookaheads(existing);
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  revisionGroups(existing, imported, isCurrent, lookahead, inFile)
    .forEach(group => pairGroup(group, { lookahead, inFile, addedByLookahead }, choices).forEach((item, row) => pairs.set(row, item)));
  return pairs;
}

type RevisionGroup = Readonly<{
  rows: readonly ScheduleItem[];
  saved: readonly ScheduleItem[];
  /** The tasks of that name no longer shown that a row may be (scheduleTasksNoLongerShown): only by his answer or the same Unique ID. */
  returning?: readonly ScheduleItem[];
}>;

/**
 * Build 231, S2 item 1 (older Medium; the coordinator's decisions of 6 Oct
 * 2026): the tasks a master's row may be that are NO LONGER SHOWN. A master
 * left the task out; its last row is hidden, with his percent, note, owner,
 * controls and links on it. Listed again by a later master on other dates,
 * it came back as a new task at 0%.
 *
 * One row per such task: a row not shown, that no row answers to, whose
 * task shows on no other row (a task Set Active hid behind an older row is
 * shown), not a task only lookaheads listed (those return by their own rule,
 * review N1 M2), and not one he has said a row is not (owner answer Q30's
 * "new task", and "new work" here: the answer sticks).
 *
 * A row is paired with one only by its Unique ID or by his answer at the
 * import review (pairGroup); never by name and dates alone.
 */
function scheduleTasksNoLongerShown(existing: readonly ScheduleItem[], isCurrent: (item: ScheduleItem) => boolean): ScheduleItem[] {
  const taskOf = scheduleTaskOfRowId(existing);
  const shownTasks = new Set(existing.filter(isCurrent).map(item => taskOf(item.id)));
  const answered = new Set(existing.flatMap(scheduleTaskEarlierIds));
  const saidNot = new Set(existing.flatMap(item => item.notRevisionOfTaskIds || []));
  const last = new Map<string, ScheduleItem>();
  existing.filter(item => !isCurrent(item) && ownedByImport(item) && item.importedAsLookahead !== true && !statedOnlyByLookaheads(existing)(item) &&
    !answered.has(item.id) && !saidNot.has(item.id) && !shownTasks.has(taskOf(item.id)))
    .forEach(item => { const known = last.get(taskOf(item.id)); if (!known || timeOf(item.importedAt) > timeOf(known.importedAt)) last.set(taskOf(item.id), item); });
  return [...last.values()];
}
type TwinRule = Parameters<typeof pairSameNamedTasks>[2];

/** The rows of one task name, project and area, with the saved tasks they may revise (pairTaskRevisions). */
function revisionGroups(
  existing: readonly ScheduleItem[],
  imported: readonly ScheduleItem[],
  isCurrent: (item: ScheduleItem) => boolean,
  lookahead: boolean,
  inFile: boolean,
): RevisionGroup[] {
  const groups = new Map<string, ScheduleItem[]>();
  imported.forEach(item => {
    // Whole-app audit A6 pass 19 L1 (1 Oct 2026): Set Active back to G showed one Pour slab from F's import
    // (G found it unchanged) and one G moved. Grouped by import, each group met both of David's twins on H,
    // so neither paired and the report said "Pour slab was reopened at 0% complete." The tasks Set Active and
    // Make Current show (inFile false) are grouped by name, project and area only; an import's rows by import.
    const group = [item.taskName, projectKey(item), item.locationName, ...(inFile ? [item.importBatchId] : [])].map(key).join('|');
    groups.set(group, [...(groups.get(group) || []), item]);
  });
  // The tasks no longer shown that a master's row may be (S2 item 1): by his answer or its Unique ID only.
  const noLongerShown = inFile && !lookahead ? scheduleTasksNoLongerShown(existing, isCurrent) : [];
  const candidates = [...groups.values()].map(rows => {
    const eligible = existing.filter(item => isCurrent(item) || inImport(item, rows[0].importBatchId));
    const returningTasks = noLongerShown.filter(item => !inImport(item, rows[0].importBatchId) && sameTask(item, rows[0]));
    const strict = eligible.filter(item => sameTask(item, rows[0]));
    const saved = lookahead ? eligible.filter(item => sameTask(item, rows[0], true)) : strict;
    // Review N1 M2 (3 Oct 2026, caused by ada8ef6): a task only lookaheads listed leaves the list when a newer
    // lookahead leaves it out (owner answer Q25). Listed again by a later file, on any dates, it is that task again,
    // with David's note and percent, as it was while every lookahead stayed in effect; only when no task he sees
    // has the name, and never for the tasks Set Active and Make Current show.
    if (inFile && saved.length === 0) {
      const returning = existing.filter(item => item.importedAsLookahead === true && sameTask(item, rows[0], lookahead));
      const returningStrict = returning.filter(item => sameTask(item, rows[0]));
      if (returning.length > 0 || returningTasks.length === 0) return { rows, saved: returning, vague: returning.length !== returningStrict.length };
    }
    // A lookahead row matched only loosely pairs with the one task it can be, never with either of two.
    return { rows, saved, vague: saved.length !== strict.length, returning: returningTasks };
  });
  const groupCount = new Map<string, number>();
  candidates.forEach(({ saved }) => saved.forEach(item => groupCount.set(item.id, (groupCount.get(item.id) || 0) + 1)));
  return candidates
    .filter(({ rows, saved, vague }) => (!vague || (rows.length === 1 && saved.length === 1)) &&
      saved.every(item => groupCount.get(item.id) === 1))
    .map(({ rows, saved, returning }) => ({ rows, saved, ...(returning && returning.length > 0 ? { returning } : {}) }));
}

/**
 * One group's pairs (owner answer Q30, 2 Oct 2026). David's answers at the
 * import review decide for the rows he answered (scheduleImportPairingQuestions).
 * Otherwise a row's own identity first: Microsoft Project's Unique ID, for
 * same-named rows when the file and the saved twins carry it (rows that all
 * carry it pair only by it), and, for the saved tasks Set Active and Make
 * Current show again (inFile false), the ids rows answer to
 * (revisedFromTaskIds): the pairing an approval made, David's choice
 * included, holds when he switches back and forth. The rest by the rule for
 * twins (pairSameNamedTasks).
 */
function pairGroup(
  { rows, saved, returning = [] }: RevisionGroup,
  rule: TwinRule,
  choices?: ReadonlyMap<string, string | null>,
): Map<ScheduleItem, ScheduleItem> {
  const known = new Map<ScheduleItem, ScheduleItem>();
  const taken = new Set<ScheduleItem>();
  const take = (row: ScheduleItem, item: ScheduleItem) => { known.set(row, item); taken.add(item); };
  const answered = new Set<ScheduleItem>();
  if (choices) {
    rows.forEach(row => {
      if (!choices.has(row.id)) return;
      answered.add(row);
      const chosen = choices.get(row.id);
      // (His answer may name a task no longer shown: "the same task", S2 item 1.)
      const item = chosen ? [...saved, ...returning].find(candidate => candidate.id === chosen && !taken.has(candidate)) : undefined;
      if (item) take(row, item);
    });
  }
  const twins = rows.length > 1 || saved.length > 1;
  const uniqueId = (item: ScheduleItem) => key(item.sourceUniqueId);
  if (twins) {
    rows.filter(row => !answered.has(row) && uniqueId(row)).forEach(row => {
      const same = saved.filter(item => !taken.has(item) && uniqueId(item) === uniqueId(row));
      if (same.length === 1) take(row, same[0]);
    });
  }
  // S2 item 1 (a): the same Unique ID as a task no longer shown is that task, come back, whatever its dates. (After
  // the twins shown: a row is one of those first.)
  rows.filter(row => !answered.has(row) && !known.has(row) && uniqueId(row)).forEach(row => {
    const same = returning.filter(item => !taken.has(item) && uniqueId(item) === uniqueId(row));
    if (same.length === 1) take(row, same[0]);
  });
  if (!rule.inFile) {
    rows.filter(row => !answered.has(row) && !known.has(row)).forEach(row => {
      const own = new Set([row.id, ...scheduleTaskEarlierIds(row)]);
      const chained = saved.filter(item => !taken.has(item) && (own.has(item.id) || scheduleTaskEarlierIds(item).includes(row.id)));
      if (chained.length === 1) take(row, chained[0]);
    });
  }
  const identified = twins && [...rows, ...saved].every(item => uniqueId(item));
  const restRows = rows.filter(row => !answered.has(row) && !known.has(row));
  const restSaved = saved.filter(item => !taken.has(item));
  if (identified || restRows.length === 0 || restSaved.length === 0) return known;
  // David's answers and the rows' identity leave the rest as before: the rule for twins, never pairing a row with
  // a task he said at review it is not (notRevisionOfTaskIds).
  const ruled = restRows.length === rows.length && restSaved.length === saved.length
    ? pairSameNamedTasks(rows, saved, rule)
    : pairSameNamedTasks(restRows, restSaved, rule);
  // Review P4 P2-1: nor, for a master (its approval, the web's upload, Set Active, Make Current), with a task whose
  // Unique ID is another one. The id was looked at only among same-named twins; a master that dropped one Pour slab
  // and added another left one row and one task of the name at Make Current, and they were paired as "the task,
  // moved": the new task took the dropped one's note, owner, approval and schedule impact. (His own answer at the
  // review, and the ids an approval gave, stand as they are. A lookahead's rows pair as before: its file may number
  // tasks its own way.)
  ruled.forEach((item, row) => { if (!saidNotRevision(row, item) && !(differentUniqueIds(row, item) && !rule.lookahead)) known.set(row, item); });
  return known;
}

/** Both carry Microsoft Project's Unique ID, and not the same one: two tasks, whatever their names and dates (review P4 P2-1). */
function differentUniqueIds(left: ScheduleItem, right: ScheduleItem): boolean {
  const [one, other] = [key(left.sourceUniqueId), key(right.sourceUniqueId)];
  return Boolean(one) && Boolean(other) && one !== other;
}

/** Whether David said at review one of these is not the other (owner answer Q30). */
function saidNotRevision(left: ScheduleItem, right: ScheduleItem): boolean {
  return (left.notRevisionOfTaskIds || []).includes(right.id) || (right.notRevisionOfTaskIds || []).includes(left.id);
}

/**
 * The same-days reading with the rows left over paired with the saved tasks
 * left over (owner answer Q30): the unchanged twins stay, the rest moved. In
 * start order when as many of each are left, and each with its uniquely
 * nearest one (pairByNearestDays).
 */
function withRestPaired(
  pairs: ReadonlyMap<ScheduleItem, ScheduleItem>,
  rows: readonly ScheduleItem[],
  saved: readonly ScheduleItem[],
): Map<ScheduleItem, ScheduleItem>[] {
  const taken = new Set(pairs.values());
  const restRows = inStableOrder(rows.filter(row => !pairs.has(row)), true);
  const restSaved = inStableOrder(saved.filter(item => !taken.has(item)), false);
  if (restRows.length === 0 || restSaved.length === 0) return [];
  const inOrder = restRows.length === restSaved.length
    ? [new Map([...pairs, ...restRows.map((row, index) => [row, restSaved[index]] as const)])]
    : [];
  return [...inOrder, new Map([...pairs, ...pairByNearestDays(restRows, restSaved)])];
}

/**
 * The "every date slipped" readings of same-named rows (owner answer Q30):
 * the rows and the saved tasks each in start order, one side's run lined up
 * with the other's at each offset, where every row (two or more) starts the
 * same number of days after its saved task.
 */
function uniformSlipReadings(rows: readonly ScheduleItem[], saved: readonly ScheduleItem[]): Map<ScheduleItem, ScheduleItem>[] {
  const rowOrder = inStableOrder(rows, true);
  const savedOrder = inStableOrder(saved, false);
  const shorter = Math.min(rowOrder.length, savedOrder.length);
  const readings: Map<ScheduleItem, ScheduleItem>[] = [];
  // One pair is no pattern: a single row is any saved task "slipped" (the same days and nearest readings cover it).
  if (shorter < 2) return readings;
  for (let offset = 0; offset <= Math.abs(rowOrder.length - savedOrder.length); offset += 1) {
    const pairs = Array.from({ length: shorter }, (_, index) => rowOrder.length <= savedOrder.length
      ? [rowOrder[index], savedOrder[index + offset]] as const
      : [rowOrder[index + offset], savedOrder[index]] as const);
    const shifts = pairs.map(([row, item]) => {
      const rowStart = dayNumber(row.startDate);
      const savedStart = dayNumber(item.startDate);
      return rowStart === null || savedStart === null ? null : rowStart - savedStart;
    });
    if (shifts.every(shift => shift !== null && shift === shifts[0])) readings.push(new Map(pairs));
  }
  return readings;
}

/**
 * A question the import review asks David (owner answer Q30, 2 Oct 2026):
 * "YES, repeated task names within an area. The import review asks him to
 * confirm instead of guessing."
 */
export type ScheduleImportPairingQuestion = Readonly<{
  /** The task name, project and area. */
  key: string;
  taskName: string;
  projectName: string;
  areaName: string;
  /** "2 tasks named Pour slab in Lot A — confirm which is which". */
  title: string;
  /** The saved tasks of that name there, as David sees them, by start day. */
  saved: readonly ScheduleItem[];
  /** The file's rows of that name there, by start day. */
  rows: readonly ScheduleItem[];
  /** The app's best guess: each row's saved task, or null for a new task. */
  guess: Readonly<Record<string, string | null>>;
  /**
   * S2 item 1 (b): no task of this name is in his list; `saved` are tasks of the name that were on an earlier
   * schedule and are no longer shown. "The same task, or new work?" Nothing is carried unless he says the same task.
   */
  returning?: true;
  /** In a same-named question: the saved tasks among the choices that are no longer shown (S2 item 1). */
  earlierIds?: readonly string[];
}>;

/**
 * Same-named tasks in one area whose pairing the file's dates cannot settle
 * (owner answer Q30). Whole-app audit A5 passes 17-18 paired them by one rule
 * per schedule role: a master keeps their order (the slip reading), a
 * lookahead takes the nearest days (the rolling-window reading). Some
 * changes look identical by dates alone: "every date slipped one week" and
 * "the first was dropped and a new one added". The review now asks when the
 * readings disagree: the app's rule (its guess, pre-selected), the
 * same-days reading (a row on exactly a saved task's days is that task; the
 * rest moved: in order, or each to its nearest, withRestPaired) and the
 * slip readings (every row the same number of days after its saved task, in
 * order); a group is asked about when any of the others pairs a row
 * differently from the guess. Never when the rows sit on exactly the saved
 * tasks' days, when a slip reads the same every way, for one row and one
 * task, or when the file and the saved tasks carry Microsoft Project's
 * Unique ID. Given the tasks shown and the rows to approve, as the merge
 * pairs them (a lookahead when overlay).
 */
export function scheduleImportPairingQuestions({
  existing,
  imported,
  isCurrent = () => true,
  overlay = false,
  alsoAsk,
}: {
  existing: readonly ScheduleItem[];
  imported: readonly ScheduleItem[];
  isCurrent?: (item: ScheduleItem) => boolean;
  overlay?: boolean;
  /** Groups (by key) to ask about although these rows' dates settle them: unsettled from what David sees (review N2 G1). */
  alsoAsk?: ReadonlySet<string>;
}): ScheduleImportPairingQuestion[] {
  const rule: TwinRule = { lookahead: overlay, inFile: true, addedByLookahead: statedOnlyByLookaheads(existing) };
  return revisionGroups(existing, imported, isCurrent, overlay, true).flatMap((group): ScheduleImportPairingQuestion[] => {
    const { rows, saved } = group;
    // S2 item 1 (b): a task of this name that is no longer shown, and a row of the file it may be. Asked, never
    // guessed: what its Unique ID settles (the same: that task; another: not that task) is not asked about.
    const settled = pairGroup(group, rule);
    const earlier = (group.returning ?? []).filter(item => ![...settled.values()].includes(item) &&
      rows.some(row => !settled.has(row) && !differentUniqueIds(row, item) && !saidNotRevision(row, item)));
    const first = rows[0];
    const groupKey = [first.taskName, projectKey(first), first.locationName].map(key).join('|');
    const areaName = ([...saved, ...earlier].find(item => key(item.locationName))?.locationName || first.locationName || '').trim();
    const projectName = (first.projectName || first.scheduleProjectName || '').trim();
    const byStart = (items: readonly ScheduleItem[], inFile: boolean) => inStableOrder(items, inFile);
    if (earlier.length > 0 && saved.length === 0) {
      const open = rows.filter(row => !settled.has(row));
      // (A row on exactly the days the task had is the best guess for it: what the import took unasked before.)
      const onItsDays = (row: ScheduleItem) => earlier.filter(item => unchangedTask(item, row));
      return [{
        key: groupKey, taskName: first.taskName.trim(), projectName, areaName, returning: true as const,
        title: `${first.taskName.trim()} in ${areaName || projectName} was on an earlier schedule: the same task, or new work?`,
        saved: byStart(earlier, false),
        rows: byStart(open, true),
        guess: Object.fromEntries(open.map(row => [row.id, onItsDays(row).length === 1 ? onItsDays(row)[0].id : null])),
      }];
    }
    // More rows than tasks of the name shown, and one no longer shown: the same-named question, with it among the choices.
    const withEarlier = earlier.length > 0 && rows.length > saved.length;
    if (rows.length === 0 || saved.length === 0 || (rows.length < 2 && saved.length < 2)) return [];
    if (!withEarlier && [...rows, ...saved].every(item => key(item.sourceUniqueId))) return [];
    // Two rows of one task (one answers to the other) shown at once are not twins: nothing to ask about them.
    const savedIds = new Set(saved.map(item => item.id));
    if (saved.some(item => scheduleTaskEarlierIds(item).some(id => savedIds.has(id)))) return [];
    const guess = settled;
    const sameDays = pairOnSameDays(rows, saved, true);
    const readings = [sameDays, ...withRestPaired(sameDays, rows, saved), ...uniformSlipReadings(rows, saved)];
    // A reading that pairs a row with another saved task than the guess, or with one the guess leaves new.
    const disagrees = readings.some(reading => [...reading].some(([row, item]) => guess.get(row) !== item));
    if (!withEarlier && !disagrees && !tiedBetweenTwins(rows, saved, guess) && !alsoAsk?.has(groupKey)) return [];
    const offered = withEarlier ? [...saved, ...earlier] : saved;
    const count = Math.max(offered.length, rows.length);
    return [{
      key: groupKey,
      taskName: first.taskName.trim(),
      projectName,
      areaName,
      title: `${count} tasks named ${first.taskName.trim()} in ${areaName || projectName} — confirm which is which`,
      saved: byStart(offered, false),
      rows: byStart(rows, true),
      guess: Object.fromEntries(rows.map(row => [row.id, guess.get(row)?.id ?? null])),
      ...(withEarlier ? { earlierIds: earlier.map(item => item.id) } : {}),
    }];
  });
}

/**
 * Review N2 G1 (5 Oct 2026, Low; owner answer Q25's shown and saved dates,
 * ada8ef6, meeting owner answer Q30, 9a1c22d). The phone's import review
 * asked from the tasks as shown, while the approval pairs on the saved rows:
 * a task a replaced lookahead moved is shown on the master's dates and saved
 * on the lookahead's. Two Pour slabs, 10/01 (his 40%) and 10/15 (his 70%);
 * lookahead L1 moves the second to 10/11; L2 lists neither, so it shows
 * 10/15 again; L3 lists 10/15 and 10/06. From what he sees this is plain,
 * and the review asked nothing; the approval found the 10/06 row as near to
 * the second task's saved 10/11 as to the first, and saved it as a third
 * Pour slab (or put his percent and note on the other task).
 *
 * The questions the phone's review asks, worked out as the approval pairs:
 * on every saved task, with the tasks shown before this import as the ones
 * a row may revise (scheduleItemsVisibleBeforeImport). The guess shown is
 * then what the approval would do unasked. Each saved task of a question is
 * given as David sees it (the dates shown), since he is asked about the
 * tasks in his list; his answer names the task, so the approval pairs it
 * whatever its saved dates.
 *
 * And still whatever the tasks as shown leave unsettled, as before: the
 * saved dates he cannot see can also settle a pairing that is a toss-up
 * from what he sees (the same two tasks, then one row on 10/08: as near to
 * 10/01 as to 10/15 in his list, but on two days of the second task's saved
 * 10/11-10/15, so the approval takes the second, unasked). Either way of
 * reading the dates that leaves a doubt is a question, with the approval's
 * guess selected.
 */
export function scheduleImportReviewPairingQuestions({
  saved,
  documents,
  importBatchId,
  imported,
  overlay = false,
}: {
  /** Every saved task, hidden rows included. */
  saved: readonly ScheduleItem[];
  /** The schedules saved now. */
  documents: readonly ReferenceDocument[];
  /** The import under review. */
  importBatchId: string;
  imported: readonly ScheduleItem[];
  overlay?: boolean;
}): ScheduleImportPairingQuestion[] {
  const shown = new Map(selectAuthoritativeScheduleItems({
    scheduleItems: [...saved],
    scheduleDocuments: documents.filter(document => key(document.importBatchId) !== key(importBatchId)),
  }).map(item => [item.id, item] as const));
  const unsettledAsShown = new Set(scheduleImportPairingQuestions({ existing: [...shown.values()], imported, overlay }).map(question => question.key));
  return scheduleImportPairingQuestions({ existing: saved, imported, isCurrent: item => shown.has(item.id), overlay, alsoAsk: unsettledAsShown })
    .map(question => ({ ...question, saved: question.saved.map(item => shown.get(item.id) || item) }));
}

/**
 * Whether a saved task was stated only by lookaheads: every import it belongs
 * to is a lookahead (a task a lookahead added that no master has listed).
 * The lookaheads are known by the notes of the tasks they restated (A5 pass
 * 18 F3), and by the tasks they added.
 *
 * Whole-app audit A6 pass 19 M2 (1 Oct 2026): L1 added a third Pour slab and
 * L2 restated it; deleting L1 cleared L1 from every note, so the third pour
 * counted as a master's, the next master's two rows met three twins, nothing
 * paired, and David's 60% left the view. A task a lookahead added names its
 * lookahead itself (importedAsLookahead).
 */
function statedOnlyByLookaheads(existing: readonly ScheduleItem[]): (item: ScheduleItem) => boolean {
  const lookaheads = new Set([
    ...existing.flatMap(item => (item.lookaheadOverlay?.lookaheads || []).map(entry => key(entry.batchId))),
    ...existing.filter(item => item.importedAsLookahead === true).map(item => key(item.importBatchId)),
  ].filter(Boolean));
  return item => {
    const imports = scheduleItemImportBatchIds(item).map(key).filter(Boolean);
    return imports.length > 0 && imports.every(batch => lookaheads.has(batch));
  };
}

/**
 * The lookahead files saved when an approval's test of which tasks are shown
 * was made (review N2 F2, the other order; 5 Oct 2026). The approval is
 * given that test and not the saved schedules, and a lookahead that restates
 * a task needs to know whether the file of the lookahead the task is on has
 * been deleted (scheduleTaskRestatedByLookahead). Kept beside the test the
 * phone's approval already passes (scheduleItemsVisibleBeforeImport), so
 * what calls the approval is unchanged. The web's upload never restates as a
 * lookahead and is told nothing.
 */
const savedLookaheadBatchesKnown = new WeakMap<(item: ScheduleItem) => boolean, ReadonlySet<string>>();

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
  const shown = (item: ScheduleItem) => visible.has(item.id);
  savedLookaheadBatchesKnown.set(shown, new Set(documents.filter(scheduleDocumentAddsToMaster).map(document => key(document.importBatchId)).filter(Boolean)));
  return shown;
}

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
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
 * shown tasks to save. Given the schedules before and after, a task whose
 * lookahead note a master marked also takes the dates the note gives under
 * the master made current (A5 pass 21 R1, scheduleTasksOnNotedDatesWhenCurrent).
 */
export function scheduleProgressCarriedToShownTasks({
  before,
  after,
  documentsBefore,
  documentsAfter,
  now = new Date().toISOString(),
  known,
}: {
  /** The tasks shown before the schedule was made current. */
  before: readonly ScheduleItem[];
  /** The tasks shown after. */
  after: readonly ScheduleItem[];
  /** The schedules before and after: a task entered by hand waiting on one made current is restated (A5 pass 18 L3). */
  documentsBefore?: readonly ReferenceDocument[];
  documentsAfter?: readonly ReferenceDocument[];
  now?: string;
  /** Every saved task, hidden ones included, when known: the rows of each task, for its links (owner answer Q29). */
  known?: readonly ScheduleItem[];
}): ScheduleItem[] {
  const { carried, pairs } = progressCarried(before, after, now);
  const restated = documentsBefore && documentsAfter ? handTasksRestatedWhenCurrent(after, documentsBefore, documentsAfter, now) : [];
  const carriedIds = new Set(carried.map(item => item.id));
  const saved = [...carried, ...restated.filter(item => !carriedIds.has(item.id))];
  const changed = new Map(saved.map(item => [item.id, item]));
  // An owner or a note typed on the row now hidden, after the row now shown was last changed, follows the task (review N2 P1).
  pairs.forEach((hidden, shown) => {
    const filled = scheduleTextCarriedToShownTask(hidden, shown, changed.get(shown.id) || shown, now, known);
    if (filled) changed.set(shown.id, filled);
  });
  // A task back on the dates its lookahead note gives under the master made current (A5 pass 21 R1).
  if (documentsBefore && documentsAfter) {
    scheduleTasksOnNotedDatesWhenCurrent({
      after: after.map(item => changed.get(item.id) || item), documentsBefore, documentsAfter, now,
    }).forEach(item => changed.set(item.id, item));
  }
  // Owner answer Q29 (2 Oct 2026): David's hand links follow each task to the row shown for it now.
  const pairedById = new Map([...pairs].map(([shown, hidden]) => [shown.id, hidden]));
  scheduleTaskLinksFollowingShownTasks({
    before, after: after.map(item => changed.get(item.id) || item), known: known ?? [...before, ...after],
    paired: shown => pairedById.get(shown.id), now,
  }).forEach(item => changed.set(item.id, item));
  // Saved from the copies as shown: on their saved dates where the dates were only shown (owner answer Q25).
  return [...changed.values()].map(scheduleItemAsSaved);
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
      const target = scheduleNoteTakesManagersProgress(base);
      // Whole-app audit A5 pass 20 P2 (1 Oct 2026): David's 40%, G uploaded at 60%, a lookahead with no % column,
      // then Make Current: the task stayed at 40% (the phone's order, G then the lookahead, gives 60%). The
      // master's percent applies as at approval (only above David's, Q22), unless a newer word stands: a
      // lookahead newer than it that stated a percent (one noted before 30 Sep, unknown, counts as stated), or
      // David's own percent judged after it was uploaded.
      // Whole-app audit A5 pass 21 R3 (1 Oct 2026): a lookahead stating 30% under David's 40% gave none, so its
      // note read as "no % column" and G's older 60% applied; its row stating a percent counts (percentStated).
      const statedSince = (task.lookaheadOverlay?.lookaheads || []).some(noted => newerThanMaster(noted) && (noted.percentComplete !== null || noted.percentStated === true)) ||
        (scheduleProgressIsManagers(target) && timeOf(scheduleProgressJudgedAt(target)) > madeCurrentAt);
      const fileProgress = statedSince ? null : scheduleFileProgressAboveManagers(target, fileProgressFor(target, row, now), now);
      return [{ ...scheduleTaskMasterRestated(target, row, now, noted => !newerThanMaster(noted)), ...(fileProgress || {}), updatedAt: now }];
    }
    // Restated as the phone's approval restates it; a row that no longer pairs (renamed since) only drops the note.
    const { next } = mergeApprovedScheduleImportItems({
      existing: [base], imported: [row], completionMatch: () => null, mergeCompletion: item => item, approvedAt: now,
    });
    return [next[0]];
  });
}

/**
 * Review N2 P1 (5 Oct 2026, older): Set Active and Make Current carried only
 * progress and links to the row they show. A schedule uploaded on the web
 * saves a moved task's new row at the upload; an owner David assigned or a
 * note he typed on the task before he made that schedule current (on the row
 * he still saw) stayed on the row Make Current hid. The row now shown takes
 * them by the import's rule: its own value stands, the hidden row's fills a
 * blank. Only when the hidden row was changed after the shown row last was
 * (or the shown row never was): a blank David left on the row he edited
 * later stands, so a note he cleared does not come back when he switches
 * masters back and forth. `row` is the shown task with the activation's
 * other changes; null when nothing is filled.
 */
function scheduleTextCarriedToShownTask(
  hidden: ScheduleItem,
  shown: ScheduleItem,
  row: ScheduleItem,
  now: string,
  /** Every saved task, when known: the rows between the two (Set Active across two masters or more). */
  known?: readonly ScheduleItem[],
): ScheduleItem | null {
  // (The weighing itself is shared with a schedule's delete, which changes the row shown too: review P5 R-A.)
  return scheduleItemAsLastSetOnItsOtherRow(hidden, shown, row, now, known);
}

/**
 * Build 231, S3 item 1 (the A5 recorded Low; the independent review's F02):
 * G uploaded at 40%, David's 60% entered after it, H approved at 70% (above
 * his, so H's row shows the file's 70% with his 60% kept under it), then G
 * made current again showed G's 40%: the activation weighed only the row it
 * hides, and H's row holds a file's percent. The percent David entered
 * himself that the hidden row keeps under its file's (owner answer Q22's
 * floor) is his latest word on the task: a row made current whose own file
 * stated less, before he entered it, is floored at it, as a lookahead is.
 * Read from the hidden row alone, never by following the task's earlier
 * rows, which two devices can link differently.
 */
function scheduleProgressUnderHiddenFileCarried(hidden: ScheduleItem, shown: ScheduleItem, now: string): ScheduleItem | null {
  if (scheduleProgressIsManagers(hidden) || scheduleProgressIsManagers(shown)) return null;
  const his = scheduleManagersOwnPercent(hidden);
  if (!his || !his.judgedAt || timeOf(his.judgedAt) <= Math.max(timeOf(shown.progressConfirmedAt), timeOf(shown.importedAt || shown.createdAt))) return null;
  const floored = scheduleProgressFlooredAtManagers(shown, his.percent, his.judgedAt);
  return floored ? { ...shown, ...floored, updatedAt: now } : null;
}

function progressCarried(
  before: readonly ScheduleItem[],
  after: readonly ScheduleItem[],
  now: string,
): { carried: ScheduleItem[]; pairs: Map<ScheduleItem, ScheduleItem> } {
  const beforeIds = new Set(before.map(item => item.id));
  const afterIds = new Set(after.map(item => item.id));
  const nowShown = after.filter(item => !beforeIds.has(item.id));
  const nowHidden = before.filter(item => !afterIds.has(item.id));
  if (nowShown.length === 0 || nowHidden.length === 0) return { carried: [], pairs: new Map() };
  const pairs = pairTaskRevisions(nowHidden, nowShown, () => true, false, false);
  return {
    pairs,
    carried: nowShown.flatMap(shown => {
      const hidden = pairs.get(shown);
      if (!hidden) return [];
      const carried = scheduleProgressCarriedFrom(hidden, shown, now) ?? scheduleProgressUnderHiddenFileCarried(hidden, shown, now) ??
        scheduleProgressLeftStanding(hidden, shown, now);
      return carried ? [carried] : [];
    }),
  };
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
    before: shownWith(documentsBefore), after: shownWith(documentsAfter), documentsBefore, documentsAfter, now, known: items,
  });
}

/**
 * A task's new row with the links of the row it replaces, when the new row has none of its own (owner answer Q29),
 * and when David changed them: links he removed stay removed on the task's older rows' return.
 */
function withLinksOf(row: ScheduleItem, paired: ScheduleItem): ScheduleItem {
  if (scheduleTaskLinksOf(row).length > 0) return row;
  if (scheduleTaskLinksOf(paired).length === 0 && !paired.dependenciesUpdatedAt) return row;
  return scheduleTaskWithLinksOf(row, paired) ?? row;
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
  pairingChoices,
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
  /**
   * David's answers to the review's question about same-named tasks (owner
   * answer Q30): an imported row's id to the saved task it revises, or null
   * for a new task. They decide the pairing of those rows.
   */
  pairingChoices?: Readonly<Record<string, string | null>> | null;
}): ScheduleImportMergeResult {
  let next = [...existing];
  const additions: ScheduleItem[] = [];
  const rehomedIds: string[] = [];
  const carriedProgressIds: string[] = [];
  const fileProgressIds: string[] = [];
  const overlaidIds: string[] = [];
  const choices = pairingChoices ? new Map(Object.entries(pairingChoices)) : undefined;
  const pairs = pairTaskRevisions(existing, imported, isCurrent, overlay, true, choices);
  // A row David answered is a new task never pairs by the import identity either (owner answer Q30), and is never
  // paired with those saved tasks later (notRevisionOfTaskIds, Set Active and Make Current).
  const answeredNew = (row: ScheduleItem) => Boolean(choices?.has(row.id) && !choices.get(row.id));
  // (And the tasks no longer shown he was asked about: "new work" sticks, S2 item 1.)
  const noLongerShown = overlay ? [] : scheduleTasksNoLongerShown(existing, isCurrent);
  const twinsSaidNotOf = (row: ScheduleItem): Partial<ScheduleItem> => {
    const ids = answeredNew(row) ? [...existing.filter(item => isCurrent(item) && sameTask(item, row, overlay)), ...noLongerShown.filter(item => sameTask(item, row))].map(item => item.id) : [];
    return ids.length > 0 ? { notRevisionOfTaskIds: ids } : {};
  };
  const lookaheadsOnly = statedOnlyByLookaheads(existing);
  const claimed = new Set([...pairs.values()].map(item => item.id));
  const seen = new Set<string>();
  // What a task shown is missing that an earlier row of it still holds, from imports before review N2 P1: it goes
  // with the task to the row this master moves it to.
  const stranded = textStrandedOnEarlierRows(existing, isCurrent);
  // The earlier rows of the tasks shown (review P4 P2-2).
  const pastOfShownTasks = new Set(existing.filter(isCurrent).flatMap(scheduleTaskEarlierIds));

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
      const saved = pairedSaved || (answeredNew(importedItem) ? undefined
        : next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem)));
      if (!saved) {
        // Added by the lookahead: it says so itself, after the lookahead's notes are gone (A6 pass 19 M2).
        additions.push({ ...importedItem, importedAsLookahead: true, ...twinsSaidNotOf(importedItem) });
        return;
      }
      claimed.add(saved.id);
      const batchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      if (batchId && scheduleItemImportBatchIds(saved).map(key).includes(key(batchId))) return;
      // The note takes the progress the manager holds now before the file applies (A5 pass 7 M1).
      const target = scheduleNoteTakesManagersProgress(saved);
      const statedProgress = scheduleFileProgressAboveManagers(target, fileProgressFor(target, importedItem, approvedAt), approvedAt);
      // Never below David's own percent a file's replaced (A5 recorded Low, Q22 floor gap).
      const fileProgress = lookaheadProgressAboveManagersUnderFile(target, statedProgress);
      // The lookahead notes the percent it gave, so deleting it can give the master's back (A5 pass 5 H1):
      // the percent its row states whenever the task ends at it, unchanged too, so deleting an older lookahead
      // that said the same leaves it (A5 pass 6 M1); the floored percent when David's floored it.
      const endsAt = percentOf({ ...target, ...(fileProgress || {}) } as ScheduleItem);
      const givenPercent = scheduleRowStatesPercent(importedItem)
        ? (percentOf(importedItem) === endsAt || fileProgress !== statedProgress ? endsAt : null)
        : (fileProgress && statusStartsTask(target, importedItem) && endsAt === 1 ? 1 : null); // the 1% "In Progress" gave (A5 pass 10 L1)
      next = next.map(item => item.id === target.id
        ? { ...scheduleTaskRestatedByLookahead(target, importedItem, approvedAt, givenPercent, savedLookaheadBatchesKnown.get(isCurrent) ?? null), ...(fileProgress || {}) }
        : item);
      overlaidIds.push(target.id);
      if (fileProgress) fileProgressIds.push(target.id);
      return;
    }
    // A note takes the progress the manager holds now before the file applies (A5 pass 7 M1).
    const paired = pairedSaved && scheduleNoteTakesManagersProgress(pairedSaved);
    // A new master repeating what it said before a lookahead restated the task (Q22). Whole-app audit A6 pass 19
    // M1 (sweep): lookahead L3 added Cleanup on 12/21 and L5 moved it to 12/22; master M6 then listed it on 12/21,
    // read as a repeat, and kept L5's older dates. A task only lookaheads stated has no master's word to repeat:
    // the master's row is the newer file, as for any task it moves.
    // Review pass 1 of Build 231's schedule round, P1-13 (Low, rare; caused by S2 item 1, the returning task): nor a
    // task that was not in his list, which he called the same task. A lookahead moved Survey; a master left Survey out;
    // that lookahead was deleted with its items on a device whose copy of Survey had never heard of it, so nothing gave
    // the dates back; the next master listed Survey again on the days the master had it before, and it came back on the
    // deleted lookahead's dates. The repeat rule is for a task he sees on a lookahead's dates. One that is not shown is
    // held by no lookahead (it would be shown): the master's row is the newer word, as for any task it moves.
    const repeated = paired && !lookaheadsOnly(paired) && isCurrent(pairedSaved!)
      ? scheduleRowRepeatsMasterBeforeLookahead(paired, importedItem)
      : { dates: false, percent: false };
    // A task entered by hand, on new dates: restated in place on the master's dates (A5 pass 17 M1).
    const movedByHand = Boolean(paired) && !ownedByImport(paired!) && !unchangedTask(paired!, importedItem) && !repeated.dates;
    const found = paired
      ? (unchangedTask(paired, importedItem) || repeated.dates || movedByHand ? paired : undefined)
      : answeredNew(importedItem) ? undefined
        // (Never a saved row with another Unique ID: review P4 P2-1. Nor the earlier row of a task that is shown on a
        // newer row: review P4 P2-2. A Pour slab moved a week earlier; a later master added another Pour slab on exactly
        // its old days; the new one was taken for the task's own hidden old row, and both showed his percent and note.)
        : next.find(item => !claimed.has(item.id) && !pastOfShownTasks.has(item.id) && !differentUniqueIds(item, importedItem) && sameImportIdentity(item, importedItem));
    const duplicate = found && scheduleNoteTakesManagersProgress(found);
    // An import's task on new dates is a new row: it answers to the ids the task had before (A10 pass 5 M1), and keeps
    // its lookahead note, brought up to what this master says, as the task left on its dates does (A5 pass 8 L3).
    const note = paired?.lookaheadOverlay ? scheduleTaskMasterRestated(paired, importedItem, approvedAt).lookaheadOverlay : undefined;
    // David's hand links go with the task to its new row (owner answer Q29).
    // And his project controls (review N3 C); the row says which task's row it took them from, as for his owner and
    // note (review N3 R3).
    const revision = (row: ScheduleItem): ScheduleItem => {
      if (!paired || paired.id === row.id) return row;
      const moved = withLinksOf(scheduleTaskRevisedFrom(withManagersPercentUnderFile(note ? { ...row, lookaheadOverlay: note } : row, paired), paired), paired);
      // And its activity notes, each once (schedule batch S5, item 1): no file states any.
      const notes = scheduleItemActivityWithOtherRows(moved.activity, paired.activity);
      const withHis = withControlsOf(notes ? { ...moved, activity: notes } : moved, paired, true);
      return withHis === moved || withHis.textFromTask ? withHis : { ...withHis, textFromTask: { taskId: paired.id } };
    };
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
      const stands = repeated.percent ? null
        : scheduleFileProgressAboveManagers(duplicate, fileProgressFor(duplicate, importedItem, approvedAt), approvedAt);
      // A master's percent that stands on the row it restates: the row keeps the highest one stated on it, and when
      // (Build 231, S3 item 1; fileProgressPeak). A lookahead restates a task by its own rule, above, and writes none.
      const fileProgress = stands ? { ...stands, fileProgressPeak: scheduleFileProgressPeakAfter(duplicate, stands, approvedAt) } : stands;
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
              // What this master's file states for the row, standing or not (Build 231, S4 item 3; fileProgressLast).
              // On a task an import owns: one he entered by hand is weighed against a master by its own rules.
              ...(owned && scheduleRowStatesPercent(importedItem) ? { fileProgressLast: { percentComplete: percentOf(importedItem), statedAt: approvedAt } } : {}),
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
    // The task on new dates, on its new row: the file's owner, contractor and notes win, the task's fill a blank,
    // whether or not David entered a percent on it (review N2 P1; at first only beside his own progress, below).
    // (With what an import before the fix left on the task's earlier rows: review N2 P1, second part.)
    const filled = paired && key(paired.importBatchId) !== key(importedItem.importBatchId)
      ? withTextTakenNoted(importedItem, withBlanksFilledFrom(importedItem, { ...paired, ...(stranded.get(paired.id) || {}) }), paired)
      : importedItem;
    if (
      paired &&
      paired.progressSource === 'project_manager' &&
      key(paired.importBatchId) !== key(importedItem.importBatchId)
    ) {
      // The manager's progress, unless the file's is higher or the saved progress was a file's (A5 pass 4 #1),
      // never below the manager's own percent a lookahead's note shows (A5 pass 6 M2).
      const fileProgress = fileProgressFor(paired, importedItem, approvedAt);
      const floored = scheduleFileProgressAboveManagers(paired, fileProgress, approvedAt);
      if (fileProgress && floored === fileProgress) {
        // David's own percent the file's replaces stays with the task on its new row (A5 recorded Low, Q22 floor gap).
        const under = fileProgress.managersPercentUnderFile;
        additions.push(revision(typeof under === 'number'
          ? { ...filled, managersPercentUnderFile: under, managersPercentUnderFileJudgedAt: fileProgress.managersPercentUnderFileJudgedAt ?? null }
          : filled));
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
      additions.push(revision({ ...filled, percentComplete: 1, status: 'In Progress' }));
      fileProgressIds.push(importedItem.id);
      return;
    }
    if (paired && !scheduleRowStatesPercent(importedItem) && key(paired.importBatchId) !== key(importedItem.importBatchId)) {
      // The file states no percent: the task on its new dates keeps the progress it had (A5 pass 5 H1).
      additions.push(revision({
        ...filled,
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
    additions.push({ ...revision(filled), ...twinsSaidNotOf(importedItem) });
  });

  if (current && [...next, ...additions].some(item => scheduleTaskLinksOf(item).length > 0)) {
    // Owner answer Q29 (2 Oct 2026): a link to a task this master moved points at its new row, and one to a row
    // an earlier master hid at the row shown for its task. On the tasks shown before and the rows added; a
    // schedule not current yet (a web upload) re-points at Make Current.
    const newRowOf = new Map<string, string | null>();
    additions.forEach(item => scheduleTaskEarlierIds(item).forEach(id => newRowOf.set(id, newRowOf.has(id) ? null : item.id)));
    const replaced = new Set([...newRowOf.keys()]);
    const shownAfter = [...next.filter(item => isCurrent(item) && !replaced.has(item.id)), ...additions];
    const shownIds = new Set(shownAfter.map(item => item.id));
    const answering = scheduleTaskLinkTargets(shownAfter, [...existing, ...additions]);
    const pointTo = (id: string) => newRowOf.get(id) || (shownIds.has(id) ? undefined : answering(id)?.id);
    const pointed = (item: ScheduleItem) => {
      const moved = scheduleTaskLinksPointedAt(item, pointTo);
      return moved === item ? item : { ...moved, updatedAt: approvedAt };
    };
    next = next.map(item => isCurrent(item) && !replaced.has(item.id) ? pointed(item) : item);
    additions.splice(0, additions.length, ...additions.map(pointed));
  }

  // Review P5-2: a new row that says which row it replaces says which hand links it was made with too, none included
  // (as for his text: review P4 F1), so that whatever weighs the two rows later can tell links nobody changed on this
  // row from links set here. Not a row whose own file stated links: those are the file's.
  const fileStatesLinks = new Set(imported.filter(item => scheduleTaskLinksOf(item).length > 0).map(item => item.id));
  const withLinksTakenNoted = (item: ScheduleItem): ScheduleItem => (item.textFromTask && !fileStatesLinks.has(item.id)
    ? { ...item, textFromTask: { ...item.textFromTask, dependencies: scheduleTaskLinksOf(item) } } : item);

  // Schedule batch S6, item 1: every row an import adds keeps the priority its own import gave it (priorityAsImported),
  // also the row that took one he had set: what reads otherwise later is his, and the file's word is not lost.
  const asImported = new Map(imported.map(item => [item.id, schedulePriorityAsRead(item.priority)]));
  const withPriorityAsImported = (item: ScheduleItem): ScheduleItem => ({ ...item, priorityAsImported: asImported.get(item.id) ?? schedulePriorityAsRead(item.priority) });

  // A task changed here from a copy as shown is saved on its saved dates unless its dates changed (owner answer Q25).
  const unchanged = new Set(existing);
  return {
    next: next.map(item => (unchanged.has(item) ? item : scheduleItemAsSaved(item))),
    additions: additions.map(withLinksTakenNoted).map(withPriorityAsImported).map(scheduleRowAsTask), rehomedIds, carriedProgressIds, fileProgressIds, overlaidIds,
  };
}
