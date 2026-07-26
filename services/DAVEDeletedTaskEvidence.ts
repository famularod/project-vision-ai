import type { DAVESyncTombstone, ProjectUpdate } from '../types';

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
 * The field record remains available as audit history after task deletion,
 * but it must not influence current project status, totals, or reports.
 */
export function partitionProjectUpdatesByDeletedTask<T>(
  updates: readonly T[],
  tombstones: readonly DAVESyncTombstone[],
  readUpdate: (value: T) => Pick<ProjectUpdate, 'scheduleItemId'>,
): Readonly<{
  active: T[];
  historical: T[];
}> {
  const deletedIds = deletedScheduleItemIds(tombstones);
  const active: T[] = [];
  const historical: T[] = [];
  updates.forEach(value => {
    (projectUpdateIsLinkedToDeletedTask(readUpdate(value), deletedIds)
      ? historical
      : active).push(value);
  });
  return Object.freeze({ active, historical });
}

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
