import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';

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
 *
 * Whole-app audit A10 pass 6 L2 (30 Sep 2026): Lot had two "Pour slab" tasks,
 * phase 1 finished and phase 2 not started. A new master dropped phase 1 and,
 * with one row against two saved, paired neither, so a field report on phase 1
 * fell back by name to phase 2, the one shown: "Possible progress is not
 * reflected in the schedule … Not Started at 0%". The name was unique among
 * the tasks shown but not in the update's own schedule. Given every saved task
 * (hidden ones included), the fallback now looks up the update's old row, and
 * when the schedule it came from had more than one task of that name in the
 * update's project and area, the update is matched to none.
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

/** The keys of the schedule a task came from: its imports, or its document for a task of no import. */
function scheduleKeys(item: ScheduleItem): string[] {
  const batches = scheduleItemImportBatchIds(item);
  return batches.length > 0 ? batches.map(batch => `import:${batch}`) : [`document:${idOf(item.sourceDocumentId)}`];
}

/** The tasks of the schedule a task came from: its imports', or the tasks entered by hand. */
function sameSchedule(own: ScheduleItem): (item: ScheduleItem) => boolean {
  const batches = scheduleItemImportBatchIds(own);
  if (batches.length > 0) return item => scheduleItemImportBatchIds(item).some(batch => batches.includes(batch));
  const document = idOf(own.sourceDocumentId);
  return item => scheduleItemImportBatchIds(item).length === 0 && idOf(item.sourceDocumentId) === document;
}

/**
 * Resolves field updates against the tasks shown (built once for many
 * updates). An update with no task id resolves to nothing here; each summary
 * keeps its own matching for those. With every saved task known, the stored
 * name is taken only when the update's own schedule had it once (A10 pass 6
 * L2).
 *
 * Whole-app audit A10 pass 7 L4 (30 Sep 2026): that check scanned every saved
 * task for each update that fell back by name; at 3,300 saved tasks and 800
 * such updates reconciliation, the commitment register and correlation each
 * took several times longer. The saved tasks are now indexed once per call,
 * by schedule and name, on the first update that needs it.
 */
export function scheduleTaskLinks(
  items: readonly ScheduleItem[],
  known: readonly ScheduleItem[] = [],
): (reference: ScheduleTaskReference) => ScheduleTaskLink | null {
  const knownById = new Map<string, ScheduleItem>();
  known.forEach(item => { if (idOf(item.id) && !knownById.has(idOf(item.id))) knownById.set(idOf(item.id), item); });
  let bySchedule: Map<string, ScheduleItem[]> | null = null;
  const inScheduleNamed = (key: string, name: string): ScheduleItem[] => {
    if (!bySchedule) {
      const index = new Map<string, ScheduleItem[]>();
      known.forEach(item => {
        const itemName = nameKey(item.taskName);
        if (itemName) scheduleKeys(item).forEach(schedule => {
          const entry = `${schedule}\n${itemName}`;
          const list = index.get(entry);
          if (list) list.push(item); else index.set(entry, [item]);
        });
      });
      bySchedule = index;
    }
    return bySchedule.get(`${key}\n${name}`) || [];
  };
  const nameSharedInOwnSchedule = (reference: ScheduleTaskReference, taskId: string, name: string): boolean => {
    const own = knownById.get(taskId);
    if (!own) return false;
    const named = new Set(scheduleKeys(own).flatMap(key => inScheduleNamed(key, name)));
    return [...named].filter(item => sameProject(item, reference) && sameArea(item, reference)).length > 1;
  };
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
    const named = name && !nameSharedInOwnSchedule(reference, taskId, name)
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
  known: readonly ScheduleItem[] = [],
): ScheduleItem | null {
  return scheduleTaskLinks(items, known)({ ...saved, scheduleItemId: taskId })?.item ?? null;
}

/**
 * The app project a task belongs to (whole-app audit A8 pass 9 M1, 30 Sep
 * 2026): a Microsoft Project master files every row under its root summary
 * row ("PLZ 2375 Campus Project") as scheduleProjectName, so 2375A's and
 * 2375B's Pour slab looked like one project's twins. The schedule's root only
 * when the task names no app project.
 */
export function scheduleTaskProjectKey(item: Pick<ScheduleItem, 'projectName' | 'scheduleProjectName'>): string {
  return nameKey(item.projectName || item.scheduleProjectName);
}

function sameRemovedTask(shown: ScheduleItem, removed: ScheduleItem): boolean {
  if (!nameKey(removed.taskName) || nameKey(shown.taskName) !== nameKey(removed.taskName)) return false;
  if (scheduleTaskProjectKey(shown) !== scheduleTaskProjectKey(removed)) return false; // the app project (A8 pass 9 M1)
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
 * task shown after the delete with its name, project and area (never a guess
 * between two). The tasks to save, with the ids added; none for a removed
 * task some task shown already answers to.
 *
 * Whole-app audit A8 pass 8 L1 (30 Sep 2026): old master F had two "Pour
 * slab" tasks; the new master kept phase 2 on its dates (so its row carries
 * F's import too) and dropped phase 1. Deleting F wrote phase 1's id onto
 * phase 2, its sibling, and phase 1's field report then warned "Field
 * progress may be ahead of the schedule" on phase 2. The id now never goes
 * onto a row that shares an import with the removed task (a task of the same
 * schedule, not a revision of it), and only when the removed task's name was
 * unique in its own schedule, counting the rows the delete keeps (kept) as
 * well as those it removes.
 *
 * Whole-app audit A8 pass 9 L1 (30 Sep 2026): master F had Pour slab phase
 * 1, master G dropped it, and master M added phase 2 as a new task; deleting
 * F wrote phase 1's id onto phase 2. A row saved before 79f49d3 and a row the
 * merge paired with nothing both list no earlier id (the merge leaves the
 * field off), so the row cannot tell them apart. The id now goes only onto a
 * task a master imported, never one entered by hand, and only when no full
 * schedule saved for its project between the removed task's last schedule
 * and the task's first (schedules) left the task out: the task came in where
 * the import would have paired it. With either import's date unknown, as
 * before.
 *
 * Whole-app audit A8 pass 9 L2 (30 Sep 2026): deleting the newer master M
 * brought F back, and F had two Pour slabs, so M's moved row's id went
 * nowhere, though that row names which of F's rows it was (its earlier ids):
 * its updates became history. A removed row's id now goes first onto the
 * task shown it answers to, in its project (the newest, if two are shown).
 */
export function scheduleTasksAnsweringToRemovedTasks(
  shown: readonly ScheduleItem[],
  removed: readonly ScheduleItem[],
  /** Every saved task the delete keeps, hidden ones included. */
  kept: readonly ScheduleItem[] = [],
  /** The full schedules (no lookahead), the deleted one included: when each import came in. */
  schedules: readonly Pick<ReferenceDocument, 'importBatchId' | 'importedAt'>[] = [],
): ScheduleItem[] {
  const answered = new Set(shown.flatMap(item => [idOf(item.id), ...scheduleTaskEarlierIds(item)]));
  const leftOutBetween = scheduleLeftTaskOut([...kept, ...removed], schedules);
  const shownById = new Map(shown.map(item => [idOf(item.id), item]));
  const added = new Map<ScheduleItem, string[]>();
  const add = (item: ScheduleItem, id: string) => added.set(item, [...(added.get(item) || []), id]);
  removed.forEach(gone => {
    const goneId = idOf(gone.id);
    if (!goneId || answered.has(goneId)) return;
    // The task shown the removed row itself answers to (A8 pass 9 L2).
    const earlier = scheduleTaskEarlierIds(gone).map(id => shownById.get(id))
      .filter((item): item is ScheduleItem => Boolean(item) && scheduleTaskProjectKey(item!) === scheduleTaskProjectKey(gone));
    if (earlier.length > 0) {
      add(earlier[earlier.length - 1], goneId);
      return;
    }
    const inSchedule = sameSchedule(gone);
    const matches = shown.filter(item => sameRemovedTask(item, gone));
    if (matches.length !== 1 || inSchedule(matches[0])) return;
    // A master's task, where its import would have paired the removed one (A8 pass 9 L1).
    if (scheduleItemImportBatchIds(matches[0]).length === 0 || leftOutBetween(gone, matches[0])) return;
    const ownRows = new Set([...kept, ...removed].filter(item => inSchedule(item) && sameRemovedTask(item, gone)));
    if (ownRows.size !== 1) return;
    add(matches[0], goneId);
  });
  return [...added.entries()].map(([item, ids]) => ({
    ...item,
    revisedFromTaskIds: scheduleTaskEarlierIds({ id: item.id, revisedFromTaskIds: [...ids, ...scheduleTaskEarlierIds(item)] }),
  }));
}

function batchKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Whether a full schedule saved for the task's project, imported after the
 * removed task's last schedule and before the task's first, left the task
 * out (A8 pass 9 L1). The saved rows are indexed by import on first use.
 */
function scheduleLeftTaskOut(
  saved: readonly ScheduleItem[],
  schedules: readonly Pick<ReferenceDocument, 'importBatchId' | 'importedAt'>[],
): (gone: ScheduleItem, task: ScheduleItem) => boolean {
  const importedAt = new Map<string, number>();
  schedules.forEach(document => {
    const batch = batchKey(document.importBatchId);
    const at = Date.parse(document.importedAt || '');
    if (batch && Number.isFinite(at)) importedAt.set(batch, at);
  });
  let byBatch: Map<string, ScheduleItem[]> | null = null;
  const rowsOf = (batch: string): ScheduleItem[] => {
    if (!byBatch) {
      const index = new Map<string, ScheduleItem[]>();
      saved.forEach(item => scheduleItemImportBatchIds(item).map(batchKey).forEach(key => {
        const list = index.get(key);
        if (list) list.push(item); else index.set(key, [item]);
      }));
      byBatch = index;
    }
    return byBatch.get(batch) || [];
  };
  const times = (item: ScheduleItem) => scheduleItemImportBatchIds(item)
    .map(batch => importedAt.get(batchKey(batch)))
    .filter((at): at is number => at !== undefined);
  return (gone, task) => {
    const goneTimes = times(gone);
    const taskTimes = times(task);
    if (goneTimes.length === 0 || taskTimes.length === 0) return false;
    const from = Math.max(...goneTimes);
    const to = Math.min(...taskTimes);
    const own = new Set([...scheduleItemImportBatchIds(gone), ...scheduleItemImportBatchIds(task)].map(batchKey));
    const project = scheduleTaskProjectKey(task);
    return [...importedAt.entries()].some(([batch, at]) => {
      if (at <= from || at >= to || own.has(batch)) return false;
      const rows = rowsOf(batch).filter(row => scheduleTaskProjectKey(row) === project);
      return rows.length > 0 && !rows.some(row => sameRemovedTask(row, gone));
    });
  };
}
