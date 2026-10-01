import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleImportItemIdentity } from './PIEScheduleImportBatch';
import { selectAuthoritativeScheduleItems } from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay } from './ScheduleCalendarDay';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressIsManagers,
  scheduleRowAsTask,
  scheduleRowStatesPercent,
} from './ScheduleProgressSource';
import {
  scheduleFileProgressAboveManagers,
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
 * task's (A5 pass 4 #1). A task entered by hand counts as the manager's. A
 * row that states no percent keeps the saved task's (A5 pass 5 H1).
 */
function fileProgressFor(
  saved: ScheduleItem,
  file: ScheduleItem,
  approvedAt: string,
): Partial<ScheduleItem> | null {
  if (!scheduleRowStatesPercent(file)) return null;
  const owned = Boolean(key(saved.importBatchId) || key(saved.sourceDocumentId));
  const managers = scheduleProgressIsManagers(saved) || !owned;
  const change = percentOf(file) - percentOf(saved);
  if (managers ? change <= 0 : change === 0) return null;
  // Taken at approval: a manager-ranked task stays manager-ranked, confirmed
  // by the approval, so every device's merge keeps the file's value.
  return saved.progressSource === 'project_manager'
    ? {
        percentComplete: file.percentComplete,
        status: file.status,
        progressSource: 'project_manager',
        progressConfirmedAt: approvedAt,
        progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
        updatedAt: approvedAt,
      }
    : { percentComplete: file.percentComplete, status: file.status, updatedAt: approvedAt };
}

function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
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
 * Name, project and area; a row's ID, number and WBS renumber on an insert.
 * Loosely, for a lookahead (A5 pass 5 M1): a row with no area matches a task
 * in any area, and a row with no parent project matches a task of its
 * project filed under a parent.
 */
function sameTask(existing: ScheduleItem, imported: ScheduleItem, vague = false): boolean {
  if (key(existing.taskName) !== key(imported.taskName)) return false;
  const project = key(imported.scheduleProjectName || imported.projectName);
  const sameProject = key(existing.scheduleProjectName || existing.projectName) === project ||
    (vague && !key(imported.scheduleProjectName) && Boolean(project) && key(existing.projectName) === project);
  if (!sameProject) return false;
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

function inFileOrder(items: readonly ScheduleItem[]): ScheduleItem[] {
  const row = (item: ScheduleItem) => Number.isFinite(item.sourceRowNumber) ? Number(item.sourceRowNumber) : Infinity;
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (row(left.item) - row(right.item)) || left.index - right.index)
    .map(({ item }) => item);
}

/**
 * The saved task each imported row revises (whole-app audit A5 pass 3 F3,
 * 30 Sep 2026): among the tasks the manager sees and those this import
 * already saved, by name, project and area. Same-named rows pair in file
 * order, and only when the file and the saved schedule have as many of them
 * and no saved row could be either of two tasks (an empty saved area
 * matches every area); never by ID. A lookahead row with no area or parent
 * project pairs loosely, with a single task only (A5 pass 5 M1).
 */
function pairTaskRevisions(
  existing: readonly ScheduleItem[],
  imported: readonly ScheduleItem[],
  isCurrent: (item: ScheduleItem) => boolean,
  lookahead = false,
): Map<ScheduleItem, ScheduleItem> {
  const groups = new Map<string, ScheduleItem[]>();
  imported.forEach(item => {
    const group = [item.taskName, item.scheduleProjectName || item.projectName, item.locationName, item.importBatchId].map(key).join('|');
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
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  candidates
    .filter(({ rows, saved, vague }) => rows.length === saved.length && (!vague || saved.length === 1) &&
      saved.every(item => groupCount.get(item.id) === 1))
    .forEach(({ rows, saved }) => {
      const savedInOrder = inFileOrder(saved);
      inFileOrder(rows).forEach((row, index) => pairs.set(row, savedInOrder[index]));
    });
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

/** When a task's progress was last stated: by the manager, or by the file it came from. */
function progressStatedAt(item: ScheduleItem): number {
  const verification = item.completionVerification;
  return Math.max(
    timeOf(item.progressConfirmedAt),
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
  now = new Date().toISOString(),
}: {
  /** The tasks shown before the schedule was made current. */
  before: readonly ScheduleItem[];
  /** The tasks shown after. */
  after: readonly ScheduleItem[];
  now?: string;
}): ScheduleItem[] {
  const beforeIds = new Set(before.map(item => item.id));
  const afterIds = new Set(after.map(item => item.id));
  const nowShown = after.filter(item => !beforeIds.has(item.id));
  const nowHidden = before.filter(item => !afterIds.has(item.id));
  if (nowShown.length === 0 || nowHidden.length === 0) return [];
  const pairs = pairTaskRevisions(nowHidden, nowShown, () => true);
  return nowShown.flatMap(shown => {
    const hidden = pairs.get(shown);
    if (!hidden || !scheduleProgressIsManagers(hidden)) return [];
    if (progressStatedAt(hidden) <= progressStatedAt(shown)) return [];
    if (!scheduleProgressIsManagers(shown) && percentOf(hidden) < percentOf(shown)) return [];
    if (percentOf(hidden) === percentOf(shown) && hidden.status === shown.status) return [];
    return [{
      ...shown,
      percentComplete: hidden.percentComplete,
      status: hidden.status,
      progressSource: hidden.progressSource ?? null,
      progressConfirmedAt: hidden.progressConfirmedAt ?? null,
      progressConfirmedBy: hidden.progressConfirmedBy ?? null,
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
  return scheduleProgressCarriedToShownTasks({ before: shownWith(documentsBefore), after: shownWith(documentsAfter), now });
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
    const paired = pairedId ? next.find(item => item.id === pairedId) : undefined;
    if (overlay) {
      const target = paired || next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem));
      if (!target) {
        additions.push(importedItem);
        return;
      }
      claimed.add(target.id);
      const batchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      if (batchId && scheduleItemImportBatchIds(target).map(key).includes(key(batchId))) return;
      const fileProgress = scheduleFileProgressAboveManagers(target, fileProgressFor(target, importedItem, approvedAt), approvedAt);
      // The lookahead notes the percent it gave, so deleting it can give the master's back (A5 pass 5 H1).
      const givenPercent = fileProgress ? Math.min(100, Math.max(0, Number(importedItem.percentComplete) || 0)) : null;
      next = next.map(item => item.id === target.id
        ? { ...scheduleTaskRestatedByLookahead(item, importedItem, approvedAt, givenPercent), ...(fileProgress || {}) }
        : item);
      overlaidIds.push(target.id);
      if (fileProgress) fileProgressIds.push(target.id);
      return;
    }
    // A new master repeating what it said before a lookahead restated the task (Q22).
    const repeated = paired ? scheduleRowRepeatsMasterBeforeLookahead(paired, importedItem) : { dates: false, percent: false };
    const duplicate = paired
      ? (unchangedTask(paired, importedItem) || repeated.dates ? paired : undefined)
      : next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem));
    if (duplicate) {
      claimed.add(duplicate.id);
      // An unchanged task an earlier import owns now belongs to this import
      // too; a task entered by hand keeps its own provenance and stays visible.
      const owned = Boolean(key(duplicate.importBatchId) || key(duplicate.sourceDocumentId));
      const newBatchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      const batches = scheduleItemImportBatchIds(duplicate).map(key);
      // A file the task already belongs to, approved again, changes nothing (A5 pass 4 #1).
      if (newBatchId && batches.includes(key(newBatchId))) return;
      const rehome = owned && Boolean(newBatchId);
      const fileProgress = repeated.percent ? null
        : scheduleFileProgressAboveManagers(duplicate, fileProgressFor(duplicate, importedItem, approvedAt), approvedAt);
      const restated = scheduleTaskMasterRestated(duplicate, importedItem, approvedAt);
      if (rehome || fileProgress || restated !== duplicate) {
        next = next.map(item => item.id === duplicate.id
          ? {
              ...restated,
              ...(fileProgress || {}),
              ...(rehome ? {
                locationName: key(restated.locationName) ? restated.locationName : importedItem.locationName,
                alsoImportedInBatchIds: [...(restated.alsoImportedInBatchIds || []), newBatchId],
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
        additions.push(filled);
        fileProgressIds.push(importedItem.id);
        return;
      }
      if (floored) {
        additions.push({ ...filled, ...floored, completionVerification: paired.completionVerification ?? null });
        carriedProgressIds.push(importedItem.id);
        return;
      }
      additions.push({
        ...filled,
        percentComplete: paired.percentComplete,
        status: paired.status,
        progressSource: paired.progressSource,
        progressConfirmedAt: paired.progressConfirmedAt ?? null,
        progressConfirmedBy: paired.progressConfirmedBy ?? null,
        completionVerification: paired.completionVerification ?? null,
      });
      carriedProgressIds.push(importedItem.id);
      return;
    }
    if (paired && !scheduleRowStatesPercent(importedItem) && key(paired.importBatchId) !== key(importedItem.importBatchId)) {
      // The file states no percent: the task on its new dates keeps the progress it had (A5 pass 5 H1).
      additions.push({
        ...importedItem,
        percentComplete: paired.percentComplete,
        status: paired.status,
        progressSource: paired.progressSource ?? null,
        progressConfirmedAt: paired.progressConfirmedAt ?? null,
        progressConfirmedBy: paired.progressConfirmedBy ?? null,
        completionVerification: paired.completionVerification ?? null,
      });
      carriedProgressIds.push(importedItem.id);
      return;
    }
    additions.push(importedItem);
  });

  return { next, additions: additions.map(scheduleRowAsTask), rehomedIds, carriedProgressIds, fileProgressIds, overlaidIds };
}
