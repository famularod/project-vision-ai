import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleImportItemIdentity } from './PIEScheduleImportBatch';
import { selectAuthoritativeScheduleItems } from './PIEScheduleReconciliation';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';

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
 */
export type ScheduleImportMergeResult = Readonly<{
  /** The saved tasks, with re-homed and completion-merged rows replaced. */
  next: ScheduleItem[];
  /** The imported rows to add. */
  additions: ScheduleItem[];
  rehomedIds: readonly string[];
  carriedProgressIds: readonly string[];
}>;

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

/** Name, project and area; a row's ID, number and WBS renumber on an insert. */
function sameTask(existing: ScheduleItem, imported: ScheduleItem): boolean {
  if (key(existing.taskName) !== key(imported.taskName)) return false;
  if (key(existing.scheduleProjectName || existing.projectName) !== key(imported.scheduleProjectName || imported.projectName)) return false;
  return sameArea(existing, imported);
}

/** The same task on the same dates: unchanged by the revision. */
function unchangedTask(existing: ScheduleItem, imported: ScheduleItem): boolean {
  return sameTask(existing, imported) &&
    key(existing.startDate) === key(imported.startDate) &&
    key(existing.finishDate) === key(imported.finishDate);
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
 * matches every area); never by ID.
 */
function pairTaskRevisions(
  existing: readonly ScheduleItem[],
  imported: readonly ScheduleItem[],
  isCurrent: (item: ScheduleItem) => boolean,
): Map<ScheduleItem, ScheduleItem> {
  const groups = new Map<string, ScheduleItem[]>();
  imported.forEach(item => {
    const group = [item.taskName, item.scheduleProjectName || item.projectName, item.locationName, item.importBatchId].map(key).join('|');
    groups.set(group, [...(groups.get(group) || []), item]);
  });
  const candidates = [...groups.values()].map(rows => ({
    rows,
    saved: existing.filter(item => (isCurrent(item) || inImport(item, rows[0].importBatchId)) && sameTask(item, rows[0])),
  }));
  const groupCount = new Map<string, number>();
  candidates.forEach(({ saved }) => saved.forEach(item => groupCount.set(item.id, (groupCount.get(item.id) || 0) + 1)));
  const pairs = new Map<ScheduleItem, ScheduleItem>();
  candidates
    .filter(({ rows, saved }) => rows.length === saved.length && saved.every(item => groupCount.get(item.id) === 1))
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
}: {
  existing: readonly ScheduleItem[];
  imported: readonly ScheduleItem[];
  /** An imported row that is a completion claim for one existing task. */
  completionMatch: (importedItem: ScheduleItem, items: readonly ScheduleItem[]) => ScheduleItem | null;
  mergeCompletion: (item: ScheduleItem, importedItem: ScheduleItem) => ScheduleItem;
  /** A saved task the manager sees; only these and this import's own pair with a revised row. */
  isCurrent?: (item: ScheduleItem) => boolean;
}): ScheduleImportMergeResult {
  let next = [...existing];
  const additions: ScheduleItem[] = [];
  const rehomedIds: string[] = [];
  const carriedProgressIds: string[] = [];
  const pairs = pairTaskRevisions(existing, imported, isCurrent);
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
    const duplicate = paired
      ? (unchangedTask(paired, importedItem) ? paired : undefined)
      : next.find(item => !claimed.has(item.id) && sameImportIdentity(item, importedItem));
    if (duplicate) {
      claimed.add(duplicate.id);
      // An unchanged task an earlier import owns now belongs to this import
      // too; a task entered by hand keeps its own provenance and stays visible.
      const owned = Boolean(key(duplicate.importBatchId) || key(duplicate.sourceDocumentId));
      const newBatchId = typeof importedItem.importBatchId === 'string' ? importedItem.importBatchId.trim() : '';
      const batches = scheduleItemImportBatchIds(duplicate).map(key);
      if (owned && newBatchId && !batches.includes(key(newBatchId))) {
        next = next.map(item => item.id === duplicate.id
          ? {
              ...item,
              locationName: key(item.locationName) ? item.locationName : importedItem.locationName,
              alsoImportedInBatchIds: [...(item.alsoImportedInBatchIds || []), newBatchId],
            }
          : item);
        rehomedIds.push(duplicate.id);
      }
      return;
    }
    if (
      paired &&
      paired.progressSource === 'project_manager' &&
      key(paired.importBatchId) !== key(importedItem.importBatchId)
    ) {
      // The file's owner, contractor and notes win; the manager's fill a blank.
      const kept = (value: string, saved: string) => key(value) || !key(saved) ? value : saved;
      additions.push({
        ...importedItem,
        owner: kept(importedItem.owner, paired.owner),
        contractor: kept(importedItem.contractor, paired.contractor),
        notes: kept(importedItem.notes, paired.notes),
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
    additions.push(importedItem);
  });

  return { next, additions, rehomedIds, carriedProgressIds };
}
