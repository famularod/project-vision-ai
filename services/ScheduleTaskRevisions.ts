import type { ScheduleItem } from '../types';

/**
 * Which task a field update's task id answers to now.
 *
 * Whole-app audit A10 pass 5 M1 (30 Sep 2026): when a new master moved a
 * task's dates, the import saved the task as a new row with a new id and hid
 * the old row (owner answer Q22, ScheduleImportMerge). A field update linked
 * to the old id matched no task shown: Project Truth said "No connected
 * field, photo, or communication evidence is available" and the action inbox
 * said the task lacked recent field evidence, though the same update matched
 * before the revision. The A10 pass 2 fix only kept such updates in the right
 * project (ReportAuthorityScope).
 *
 * Now the row a new master saves for a task it moved keeps the ids the task
 * had before (revisedFromTaskIds), carried forward across further revisions
 * so A→B→C keeps A and B; the field is part of the task's JSON record, so it
 * reaches every device as lookaheadOverlay does. Reconciliation, evidence
 * correlation, Project Truth, the action inbox and the commitment register
 * resolve an update's task id here. A row saved before this fix carries no
 * earlier ids: an update whose task id is no task shown then matches by the
 * task name it stored, within its project and area, only when exactly one
 * task shown has that name; never a guess between two.
 */

/** What a field update says about its task. */
export type ScheduleTaskReference = Readonly<{
  scheduleItemId?: string | null;
  scheduleTaskName?: string | null;
  projectName?: string | null;
  scheduleProjectName?: string | null;
  selectedAreaName?: string | null;
  photos?: readonly Readonly<{ selectedAreaName?: string | null }>[];
}>;

export type ScheduleTaskLink = Readonly<{
  item: ScheduleItem;
  /**
   * task_id: the task itself; earlier_task_id: the row a new master saved
   * the task as; stored_task_name: a row saved before the earlier ids were
   * kept, found by the update's task name, project and area.
   */
  basis: 'task_id' | 'earlier_task_id' | 'stored_task_name';
}>;

function idOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nameKey(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
}

/** The ids a task had before new masters moved its dates, oldest first. */
export function scheduleTaskEarlierIds(item: Pick<ScheduleItem, 'id' | 'revisedFromTaskIds'>): string[] {
  const own = idOf(item.id);
  const listed = Array.isArray(item.revisedFromTaskIds) ? item.revisedFromTaskIds : [];
  return [...new Set(listed.map(idOf).filter(id => id && id !== own))];
}

/** The earlier ids of two copies of one task, oldest first (sync keeps every id either copy knows). */
export function scheduleTaskEarlierIdsOfBoth(
  task: Pick<ScheduleItem, 'id' | 'revisedFromTaskIds'>,
  other: Pick<ScheduleItem, 'revisedFromTaskIds'>,
): string[] {
  return scheduleTaskEarlierIds({ id: task.id, revisedFromTaskIds: [...(task.revisedFromTaskIds || []), ...(other.revisedFromTaskIds || [])] });
}

/**
 * The row a new master saves for a task it moved, answering to the saved
 * task's id and every id the saved task had before.
 */
export function scheduleTaskRevisedFrom<T extends ScheduleItem>(row: T, saved: Pick<ScheduleItem, 'id' | 'revisedFromTaskIds'>): T {
  const earlier = scheduleTaskEarlierIds({
    id: row.id,
    revisedFromTaskIds: [...scheduleTaskEarlierIds(saved), idOf(saved.id), ...scheduleTaskEarlierIds(row)],
  });
  return earlier.length > 0 ? { ...row, revisedFromTaskIds: earlier } : row;
}

function sameProject(item: ScheduleItem, reference: ScheduleTaskReference): boolean {
  const projects = [reference.scheduleProjectName, reference.projectName].map(nameKey).filter(Boolean);
  return [item.scheduleProjectName, item.projectName].map(nameKey).some(project => Boolean(project) && projects.includes(project));
}

function sameArea(item: ScheduleItem, reference: ScheduleTaskReference): boolean {
  const area = nameKey(item.locationName);
  const areas = [reference.selectedAreaName, ...(reference.photos || []).map(photo => photo.selectedAreaName)]
    .map(nameKey)
    .filter(Boolean);
  return !area || areas.length === 0 || areas.includes(area);
}

/**
 * Resolves field updates against the tasks shown (built once for many
 * updates). An update with no task id resolves to nothing here; each summary
 * keeps its own matching for those.
 */
export function scheduleTaskLinks(items: readonly ScheduleItem[]): (reference: ScheduleTaskReference) => ScheduleTaskLink | null {
  const byId = new Map<string, ScheduleItem>();
  const byEarlierId = new Map<string, ScheduleItem[]>();
  const byName = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const id = idOf(item.id);
    if (id && !byId.has(id)) byId.set(id, item);
    scheduleTaskEarlierIds(item).forEach(earlier => byEarlierId.set(earlier, [...(byEarlierId.get(earlier) || []), item]));
    const name = nameKey(item.taskName);
    if (name) byName.set(name, [...(byName.get(name) || []), item]);
  });
  return reference => {
    const taskId = idOf(reference.scheduleItemId);
    if (!taskId) return null;
    const own = byId.get(taskId);
    if (own) return { item: own, basis: 'task_id' };
    const revised = byEarlierId.get(taskId) || [];
    if (revised.length === 1) return { item: revised[0], basis: 'earlier_task_id' };
    const name = nameKey(reference.scheduleTaskName);
    const named = name
      ? (byName.get(name) || []).filter(item => sameProject(item, reference) && sameArea(item, reference))
      : [];
    return named.length === 1 ? { item: named[0], basis: 'stored_task_name' } : null;
  };
}

/** The task shown that a task id (with what the update stored about it) answers to, or null. */
export function scheduleItemAnsweringToTaskId(
  items: readonly ScheduleItem[],
  taskId: string | null | undefined,
  saved: Omit<ScheduleTaskReference, 'scheduleItemId'> = {},
): ScheduleItem | null {
  return scheduleTaskLinks(items)({ ...saved, scheduleItemId: taskId })?.item ?? null;
}

function sameRemovedTask(shown: ScheduleItem, removed: ScheduleItem): boolean {
  if (!nameKey(removed.taskName) || nameKey(shown.taskName) !== nameKey(removed.taskName)) return false;
  if (nameKey(shown.scheduleProjectName || shown.projectName) !== nameKey(removed.scheduleProjectName || removed.projectName)) return false;
  const area = nameKey(shown.locationName);
  const removedArea = nameKey(removed.locationName);
  return !area || !removedArea || area === removedArea;
}

/**
 * Whole-app audit A10 pass 6 M1 (30 Sep 2026): "Delete PDF + Items" on an old
 * master removes the old row of every task a new master moved. A row a new
 * master saved before the earlier ids were kept (79f49d3) does not answer to
 * the removed id, so its field updates read as evidence of a deleted task.
 * Before the deletions are recorded, each removed task's id goes onto the one
 * task shown after the delete with its name, project and area, when the
 * removed tasks hold no other task by that name there either (never a guess
 * between two). The tasks to save, with the ids added; none for a removed
 * task some task shown already answers to.
 */
export function scheduleTasksAnsweringToRemovedTasks(
  shown: readonly ScheduleItem[],
  removed: readonly ScheduleItem[],
): ScheduleItem[] {
  const answered = new Set(shown.flatMap(item => [idOf(item.id), ...scheduleTaskEarlierIds(item)]));
  const added = new Map<ScheduleItem, string[]>();
  removed.forEach(gone => {
    const goneId = idOf(gone.id);
    if (!goneId || answered.has(goneId)) return;
    const matches = shown.filter(item => sameRemovedTask(item, gone));
    if (matches.length !== 1) return;
    if (removed.filter(other => sameRemovedTask(matches[0], other)).length !== 1) return;
    added.set(matches[0], [...(added.get(matches[0]) || []), goneId]);
  });
  return [...added.entries()].map(([item, ids]) => ({
    ...item,
    revisedFromTaskIds: scheduleTaskEarlierIds({ id: item.id, revisedFromTaskIds: [...ids, ...scheduleTaskEarlierIds(item)] }),
  }));
}
