import type { ScheduleItem } from '../types';
import { scheduleImportItemIdentity } from './PIEScheduleImportBatch';
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
 * progress from the one earlier row for the same task in the same project
 * and area. A completion claim that names an existing task still merges into
 * it first, as before. The unchanged task keeps its own import identity: a
 * revision that rewrote it made "Set Active" on the older schedule hide it
 * and "Delete PDF + Items" on the revision delete it (audit A5 pass 2).
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

function sameTask(left: ScheduleItem, right: ScheduleItem): boolean {
  if (key(left.taskName) !== key(right.taskName)) return false;
  if (key(left.scheduleProjectName || left.projectName) !== key(right.scheduleProjectName || right.projectName)) return false;
  if (!sameArea(left, right)) return false;
  const leftActivity = key(left.sourceActivityId);
  const rightActivity = key(right.sourceActivityId);
  return !leftActivity || !rightActivity || leftActivity === rightActivity;
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
}: {
  existing: readonly ScheduleItem[];
  imported: readonly ScheduleItem[];
  /** An imported row that is a completion claim for one existing task. */
  completionMatch: (importedItem: ScheduleItem, items: readonly ScheduleItem[]) => ScheduleItem | null;
  mergeCompletion: (item: ScheduleItem, importedItem: ScheduleItem) => ScheduleItem;
}): ScheduleImportMergeResult {
  let next = [...existing];
  const additions: ScheduleItem[] = [];
  const rehomedIds: string[] = [];
  const carriedProgressIds: string[] = [];

  imported.forEach(importedItem => {
    const match = completionMatch(importedItem, next);
    if (match) {
      next = next.map(item => item.id === match.id ? mergeCompletion(item, importedItem) : item);
      return;
    }
    const identity = scheduleImportItemIdentity(importedItem);
    if (additions.some(item => scheduleImportItemIdentity(item) === identity)) return;
    const duplicate = next.find(item => sameImportIdentity(item, importedItem));
    if (duplicate) {
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
    const predecessors = next.filter(item =>
      item.progressSource === 'project_manager' &&
      key(item.importBatchId) !== key(importedItem.importBatchId) &&
      sameTask(item, importedItem));
    if (predecessors.length === 1) {
      const [predecessor] = predecessors;
      additions.push({
        ...importedItem,
        percentComplete: predecessor.percentComplete,
        status: predecessor.status,
        progressSource: predecessor.progressSource,
        progressConfirmedAt: predecessor.progressConfirmedAt ?? null,
        progressConfirmedBy: predecessor.progressConfirmedBy ?? null,
      });
      carriedProgressIds.push(importedItem.id);
      return;
    }
    additions.push(importedItem);
  });

  return { next, additions, rehomedIds, carriedProgressIds };
}
