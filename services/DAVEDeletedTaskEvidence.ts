import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../types';
import { selectAuthoritativeScheduleItems } from './PIEScheduleReconciliation';
import { scheduleTaskEarlierIds, scheduleTaskProjectKey, type ScheduleTaskReference } from './ScheduleTaskRevisions';

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
}>;

/**
 * Whole-app audit A10 pass 6 M1 (30 Sep 2026): "Delete PDF + Items" on an
 * old master records the deletion of the old row of every task a new master
 * moved, and a field update linked to that old id read as evidence of a
 * deleted task, though the task is still shown under its new row: it left
 * reconciliation, correlation, Project Truth, the inbox, the project stats
 * and the report scope, and the feed called it "Historical evidence — linked
 * task was deleted." An update is now that only when no saved task left
 * answers to its task id by the ids a task had before a new master moved it
 * (revisedFromTaskIds); "Delete PDF + Items" writes the removed id onto a row
 * saved before those were kept, when it is safe (ScheduleTaskRevisions).
 *
 * Whole-app audit A10 pass 7 L1 (30 Sep 2026): the check also fell back by
 * the update's stored task name among the tasks shown. The deleted row is
 * gone, so its own schedule could not be checked (the A10 pass 6 L2 guard):
 * David deleted phase 1 of two "Pour slab" tasks, and its "complete" report
 * stayed current on phase 2 ("… complete while the schedule remains Not
 * Started at 0%"), with its open action. A deleted id never falls back by
 * name now.
 */
function deletedTaskStillAnswered(
  schedule: DeletedTaskScheduleContext,
  deletedIds: ReadonlySet<string>,
): (reference: ScheduleTaskReference) => boolean {
  const earlier = new Set(schedule.scheduleItems
    .filter(item => !deletedIds.has(normalized(item.id)))
    .flatMap(item => scheduleTaskEarlierIds(item).map(normalized)));
  return reference => earlier.has(normalized(reference.scheduleItemId));
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

/**
 * Whole-app audit A10 pass 7 L5 (30 Sep 2026): a new master that moved Pour
 * slab saved it as a new row answering to the old row's id and hid the old
 * row. Deleting Pour slab recorded only the new row's deletion, so a field
 * update linked to the old id stayed current evidence of a task that was
 * gone. The ids a task delete removes: the task, and the saved hidden rows it
 * answers to (its earlier ids), in its project. A row still shown is left.
 */
export function scheduleItemIdsDeletedWithTask(
  items: readonly ScheduleItem[],
  task: ScheduleItem,
  documents: readonly ReferenceDocument[],
): string[] {
  const earlier = new Set(scheduleTaskEarlierIds(task));
  const project = scheduleTaskProjectKey(task); // the app project, not a Gantt root's (A8 pass 9 M1)
  const rows = items.filter(item => item.id !== task.id && earlier.has(item.id) &&
    scheduleTaskProjectKey(item) === project);
  if (rows.length === 0) return [task.id];
  const shown = new Set(selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }).map(item => item.id));
  return [task.id, ...rows.filter(item => !shown.has(item.id)).map(item => item.id)];
}

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
