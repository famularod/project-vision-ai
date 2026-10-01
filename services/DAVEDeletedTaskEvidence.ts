import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../types';
import { selectAuthoritativeScheduleItems } from './PIEScheduleReconciliation';
import {
  scheduleTaskEarlierIds,
  scheduleTaskLinks,
  type ScheduleTaskReference,
} from './ScheduleTaskRevisions';

export const DELETED_TASK_EVIDENCE_LABEL =
  'Historical evidence — linked task was deleted.';

export function deletedScheduleItemIds(
  tombstones: readonly DAVESyncTombstone[],
): ReadonlySet<string> {
  return new Set(
    tombstones
      .filter(tombstone => tombstone.entityType === 'schedule_item')
      .map(tombstone => normalized(tombstone.recordId))
      .filter(Boolean),
  );
}

export function projectUpdateIsLinkedToDeletedTask(
  update: Pick<ProjectUpdate, 'scheduleItemId'>,
  deletedIds: ReadonlySet<string>,
): boolean {
  const linkedTaskId = normalized(update.scheduleItemId);
  return Boolean(linkedTaskId && deletedIds.has(linkedTaskId));
}

/**
 * The saved tasks, for telling whether a deleted task id still answers to a
 * task (whole-app audit A10 pass 6 M1).
 */
export type DeletedTaskScheduleContext = Readonly<{
  /** Every saved task, hidden ones included. */
  scheduleItems: readonly ScheduleItem[];
  /** The tasks shown, when the caller has them; else worked out from the saved schedules. */
  shownScheduleItems?: readonly ScheduleItem[];
  scheduleDocuments?: readonly ReferenceDocument[];
}>;

/**
 * Whole-app audit A10 pass 6 M1 (30 Sep 2026): "Delete PDF + Items" on an
 * old master records the deletion of the old row of every task a new master
 * moved, and a field update linked to that old id read as evidence of a
 * deleted task, though the task is still shown under its new row: it left
 * reconciliation, correlation, Project Truth, the inbox, the project stats
 * and the report scope, and the feed called it "Historical evidence — linked
 * task was deleted." An update is now that only when no saved task left
 * answers to its task id: by the ids a task had before a new master moved it
 * (revisedFromTaskIds), or, for a row saved before those were kept, by the
 * update's stored task name among the tasks shown (ScheduleTaskRevisions).
 */
function deletedTaskStillAnswered(
  schedule: DeletedTaskScheduleContext,
  deletedIds: ReadonlySet<string>,
): (reference: ScheduleTaskReference) => boolean {
  const living = schedule.scheduleItems.filter(item => !deletedIds.has(normalized(item.id)));
  const earlier = new Set(living.flatMap(item => scheduleTaskEarlierIds(item).map(normalized)));
  let linkOf: ReturnType<typeof scheduleTaskLinks> | null = null;
  return reference => {
    if (earlier.has(normalized(reference.scheduleItemId))) return true;
    if (!linkOf) {
      const shown = schedule.shownScheduleItems
        ? schedule.shownScheduleItems.filter(item => !deletedIds.has(normalized(item.id)))
        : selectAuthoritativeScheduleItems({ scheduleItems: living, scheduleDocuments: [...(schedule.scheduleDocuments || [])] });
      linkOf = scheduleTaskLinks(shown, living); // never by a name the update's own schedule shared (A10 pass 6 L2)
    }
    return Boolean(linkOf(reference));
  };
}

/**
 * The field record remains available as audit history after task deletion,
 * but it must not influence current project status, totals, or reports. A
 * task a saved task still answers to was not deleted (A10 pass 6 M1); without
 * the saved tasks, every update linked to a deleted id is history.
 */
export function partitionProjectUpdatesByDeletedTask<T>(
  updates: readonly T[],
  tombstones: readonly DAVESyncTombstone[],
  readUpdate: (value: T) => ScheduleTaskReference,
  schedule?: DeletedTaskScheduleContext,
): Readonly<{
  active: T[];
  historical: T[];
}> {
  const deletedIds = deletedScheduleItemIds(tombstones);
  let stillAnswered: ((reference: ScheduleTaskReference) => boolean) | null = null;
  const historicalEvidence = (reference: ScheduleTaskReference) => {
    if (!projectUpdateIsLinkedToDeletedTask(reference, deletedIds)) return false;
    if (!schedule) return true;
    stillAnswered = stillAnswered || deletedTaskStillAnswered(schedule, deletedIds);
    return !stillAnswered(reference);
  };
  const active: T[] = [];
  const historical: T[] = [];
  updates.forEach(value => {
    (historicalEvidence(readUpdate(value)) ? historical : active).push(value);
  });
  return Object.freeze({ active, historical });
}

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
