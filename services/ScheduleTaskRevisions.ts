import type { ProjectItemActivity, ReferenceDocument, ScheduleDependency, ScheduleItem, SchedulePriority } from '../types';
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
   * the task as, or the shown row the update's own row replaced (A10 pass 9
   * L1); stored_task_name: a row saved before the earlier ids were kept,
   * found by the update's task name, project and area.
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
 * The task with every earlier id either copy knows (whole-app audit A8 pass
 * 10 L2, 1 Oct 2026): "Delete PDF + Items" on the web or another phone writes
 * the removed row's id onto the row that answers to it, and Keep Phone on
 * that row's conflict uploaded the phone's copy without it, so the field
 * update linked to the removed row became history everywhere. The union the
 * recovery merge keeps (scheduleTaskEarlierIdsOfBoth), in the other copy's
 * order when it names them all (so a copy that differs from the cloud's only
 * by that order uploads nothing new); the same object when nothing changes.
 */
export function withScheduleTaskEarlierIdsOf<T extends ScheduleItem>(
  item: T,
  other: Pick<ScheduleItem, 'revisedFromTaskIds'> | null | undefined,
): T {
  if (!other) return item;
  const both = scheduleTaskEarlierIdsOfBoth(item, other);
  if (both.length === 0) return item;
  const theirs = scheduleTaskEarlierIds({ id: item.id, revisedFromTaskIds: other.revisedFromTaskIds });
  const next = theirs.length === both.length ? theirs : both;
  return JSON.stringify(next) === JSON.stringify(item.revisedFromTaskIds) ? item : { ...item, revisedFromTaskIds: next };
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

/**
 * Whether a task is in the update's project: its app project
 * (scheduleTaskProjectKey) is one the update names. Whole-app audit A5 pass
 * 14 L2 (1 Oct 2026): separate North and South Microsoft Project masters
 * keep their shared root ("2400 Compliance Project") as every row's schedule
 * project, and the root counted as a project match, so after a newer North
 * master dropped ROOF DRAINS a North report linked by name to South's ROOF
 * DRAINS (evidence correlation: "completion_reported"). The root still
 * matches an update filed under the root itself (the web files a task's
 * update under its schedule project), unless the update's own saved row
 * names another app project. A row naming no app project keys by its root,
 * as before.
 */
function sameProject(item: ScheduleItem, reference: ScheduleTaskReference, saved?: ScheduleItem): boolean {
  const projects = [reference.scheduleProjectName, reference.projectName].map(nameKey).filter(Boolean);
  const project = scheduleTaskProjectKey(item);
  if (projects.includes(project)) return true;
  const root = nameKey(item.scheduleProjectName);
  return Boolean(root) && nameKey(reference.projectName || reference.scheduleProjectName) === root &&
    (!saved || [root, project].includes(scheduleTaskProjectKey(saved)));
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
 *
 * Whole-app audit A10 pass 9 L1 (30 Sep 2026): Lot had two "Pour slab" tasks
 * on master A; master B moved phase 1, and a report on B's row said "Pour
 * slab is complete." After Make Current back to A, B's row was hidden and no
 * shown row lists its id, so the report linked to no task (the twin guard
 * rightly refused the name) and Home said Pour slab "lacks recent field
 * evidence". Linking only went forward. Now, after that, the update's saved
 * row is looked up: when a row it lists as earlier is shown, in its app
 * project, the update links to the newest of those (earlier_task_id).
 *
 * Whole-app audit A10 pass 10 L1 (1 Oct 2026): master A had two "Pour slab"
 * tasks; master B moved phase 1 and a report was filed on B's row; after Make
 * Current back to A, corrected master D moved phase 1 again from A's row (the
 * import pairs only with the rows shown), so D's row recorded A's, not B's.
 * The report linked to no task and Home said D's phase 1 "lacks recent field
 * evidence": no shown row listed B's row, and A's row was hidden. Now, after
 * that, the update also links to the one task shown, in its app project,
 * that answers to a row the saved row replaced (D's lists A's). For a row
 * deleted since (Delete PDF + Items on B while C, whose row lists B's, was
 * current, then Make Current back to A), the saved rows that list it stand
 * in: the one task shown that is one of them or a row they replaced, or that
 * answers to one. Never a guess between two.
 */
export function scheduleTaskLinks(
  items: readonly ScheduleItem[],
  known: readonly ScheduleItem[] = [],
): (reference: ScheduleTaskReference) => ScheduleTaskLink | null {
  const knownIndex = savedTaskIndexOf(known);
  const knownById = knownIndex.byId;
  const inScheduleNamed = (key: string, name: string): ScheduleItem[] => {
    if (!knownIndex.bySchedule) {
      const index = new Map<string, ScheduleItem[]>();
      known.forEach(item => {
        const itemName = nameKey(item.taskName);
        if (itemName) scheduleKeys(item).forEach(schedule => {
          const entry = `${schedule}\n${itemName}`;
          const list = index.get(entry);
          if (list) list.push(item); else index.set(entry, [item]);
        });
      });
      knownIndex.bySchedule = index;
    }
    return knownIndex.bySchedule.get(`${key}\n${name}`) || [];
  };
  const nameSharedInOwnSchedule = (reference: ScheduleTaskReference, own: ScheduleItem, name: string): boolean => {
    const named = new Set(scheduleKeys(own).flatMap(key => inScheduleNamed(key, name)));
    return [...named].filter(item => sameProject(item, reference, own) && sameArea(item, reference)).length > 1;
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
  // The saved rows that list a task id as earlier (A10 pass 10 L1), indexed on first use.
  const knownListing = (taskId: string): ScheduleItem[] => {
    if (!knownIndex.byEarlierId) {
      const index = new Map<string, ScheduleItem[]>();
      known.forEach(item => scheduleTaskEarlierIds(item).forEach(id => {
        const list = index.get(id);
        if (list) list.push(item); else index.set(id, [item]);
      }));
      knownIndex.byEarlierId = index;
    }
    return knownIndex.byEarlierId.get(taskId) || [];
  };
  // The tasks shown, in each saved row's app project, that are the row or a row it replaced, or answer to one.
  const shownAnsweringTo = (rows: readonly ScheduleItem[]): ScheduleItem[] => {
    const found = new Set<ScheduleItem>();
    rows.forEach(row => {
      const project = scheduleTaskProjectKey(row);
      [idOf(row.id), ...scheduleTaskEarlierIds(row)].forEach(id => [byId.get(id), ...(byEarlierId.get(id) || [])].forEach(item => {
        if (item && scheduleTaskProjectKey(item) === project) found.add(item);
      }));
    });
    return [...found];
  };
  return reference => {
    const taskId = idOf(reference.scheduleItemId);
    if (!taskId) return null;
    const own = byId.get(taskId);
    if (own) return { item: own, basis: 'task_id' };
    const revised = byEarlierId.get(taskId) || [];
    if (revised.length === 1) return { item: revised[0], basis: 'earlier_task_id' };
    // The rows the update's saved row replaced, when one is shown (A10 pass 9 L1).
    const saved = knownById.get(taskId);
    const replaced = saved
      ? scheduleTaskEarlierIds(saved).map(id => byId.get(id))
        .filter((item): item is ScheduleItem => Boolean(item) && scheduleTaskProjectKey(item!) === scheduleTaskProjectKey(saved))
      : [];
    if (replaced.length > 0) return { item: replaced[replaced.length - 1], basis: 'earlier_task_id' };
    // The one task shown on another branch of the chain (A10 pass 10 L1).
    const branched = shownAnsweringTo(saved ? [saved] : knownListing(taskId));
    if (branched.length === 1) return { item: branched[0], basis: 'earlier_task_id' };
    // A deleted row that a saved row still lists (whole-app audit A8 pass 12
    // L1): once fd00285 wrote the deleted row's id onto the old master's
    // hidden row, the report stayed current, and with the deleted row gone
    // the twin guard could not see that its schedule had two tasks of that
    // name, so a phase 1 report landed on phase 2. 97190fb then refused the
    // name outright, and a report on a deleted newer master's row linked to
    // no task even when a corrected master brought the task back with the
    // same unique name (A5 pass 14 L1: "0 activities matched field
    // evidence"). The schedule of each saved row that lists it now stands in
    // for the twin guard: a name shared there still links to nothing.
    //
    // Whole-app audit A5 pass 15 L1 (1 Oct 2026, caused by d80184c): those
    // rows stood in for the twin guard but not for the project filter, which
    // still read the deleted row's saved row (none), and with none the shared
    // Microsoft Project root matched any building: a web-filed North report
    // on a deleted North row linked to South's ROOF DRAINS. They now stand in
    // for the project filter too.
    const owners = saved ? [saved] : knownListing(taskId);
    const name = nameKey(reference.scheduleTaskName);
    const named = name && !owners.some(own => nameSharedInOwnSchedule(reference, own, name))
      ? (byName.get(name) || []).filter(item => (owners.length > 0
        ? owners.every(own => sameProject(item, reference, own))
        : sameProject(item, reference)) && sameArea(item, reference))
      : [];
    return named.length === 1 ? { item: named[0], basis: 'stored_task_name' } : null;
  };
}

type SavedTaskIndex = {
  byId: Map<string, ScheduleItem>;
  bySchedule: Map<string, ScheduleItem[]> | null;
  /** The saved rows by each earlier id they list (A10 pass 10 L1). */
  byEarlierId: Map<string, ScheduleItem[]> | null;
};
const savedTaskIndexes = new WeakMap<readonly ScheduleItem[], SavedTaskIndex>();

/**
 * Whole-app audit A10 pass 8 L4 (30 Sep 2026): Home's overview rows and the
 * commitment register built this index again for every project on every
 * render. The saved tasks are an immutable state value, so the index is kept
 * with the array (by identity) and built once.
 */
function savedTaskIndexOf(known: readonly ScheduleItem[]): SavedTaskIndex {
  const cached = known.length > 0 ? savedTaskIndexes.get(known) : undefined;
  if (cached) return cached;
  const byId = new Map<string, ScheduleItem>();
  known.forEach(item => {
    const id = idOf(item.id);
    if (id && !byId.has(id)) byId.set(id, item);
  });
  const index: SavedTaskIndex = { byId, bySchedule: null, byEarlierId: null };
  if (known.length > 0) savedTaskIndexes.set(known, index);
  return index;
}

const savedTasksOfProjects = new WeakMap<readonly ScheduleItem[], Map<string, readonly ScheduleItem[]>>();

/**
 * The saved tasks, hidden ones included, of the projects a scope covers
 * (whole-app audit A10 pass 8 L4, 30 Sep 2026): those whose app project or
 * schedule project is one of the scope's projects or one of its tasks'. The
 * live authority took every project's saved tasks, which are part of its
 * evidence signature, so a task change in Beta rebuilt Alpha's intelligence.
 * An update's old row and its schedule's rows are always among these. The
 * same saved tasks and projects give the same array.
 */
export function scheduleSavedTasksOfProjects(
  saved: readonly ScheduleItem[],
  projectTasks: readonly ScheduleItem[],
  projectNames: readonly string[] = [],
): readonly ScheduleItem[] {
  const keys = new Set([
    ...projectNames.map(nameKey),
    ...projectTasks.flatMap(item => [nameKey(item.projectName), nameKey(item.scheduleProjectName)]),
  ].filter(Boolean));
  const signature = [...keys].sort().join('\n');
  let byProjects = savedTasksOfProjects.get(saved);
  if (!byProjects) {
    byProjects = new Map();
    savedTasksOfProjects.set(saved, byProjects);
  }
  const cached = byProjects.get(signature);
  if (cached) return cached;
  const own = saved.filter(item => keys.has(nameKey(item.projectName)) || keys.has(nameKey(item.scheduleProjectName)));
  byProjects.set(signature, own);
  return own;
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
 *
 * Whole-app audit A8 pass 9 L3 (30 Sep 2026): each removed row was compared
 * with every task shown and every saved task, about 2 s in Node at 1,500
 * removed of 3,300 saved, while the delete tap waited. The tasks are indexed
 * by name and project once per delete.
 *
 * Whole-app audit A5 pass 11 M-b (30 Sep 2026): master M moved Pour slab and
 * David entered 70% on M's row; deleting M with its items handed F's row the
 * removed id, never the 70%, so Pour slab went back to F's 40% everywhere.
 * And M was current, so F was retired: no task was shown after the delete
 * and not even the id went anywhere. The removed row's id now goes onto the
 * row it replaced even when that row is hidden (the newest the delete keeps,
 * in its project), and that row takes the progress progressGivenBack gives
 * (the caller's rule: David's own, judged later, ScheduleLookahead).
 *
 * Whole-app audit A8 pass 11 L1 (1 Oct 2026): after Make Current back to F,
 * corrected master N moved Pour slab again from F's row A (the import pairs
 * only with the rows shown), so N's row Y recorded A, not M's row X. Deleting
 * M then gave X's id only to the hidden A, and deleting F too took A: the
 * field report on X became "Historical evidence — linked task was deleted."
 * When no task shown is a row the removed row replaced, its id (and progress,
 * by the same rule) now also goes onto the newest task shown, in its project,
 * that answers to one of them (Y lists A). And a removed row a task shown
 * already answers to hands that task its own earlier ids (deleting F gives Y
 * the X that A recorded).
 *
 * Whole-app audit A5 pass 15 L2 (1 Oct 2026): F, then M (moving Pour slab),
 * then Delete PDF + Items on M while current (F's hidden row took M's row
 * id), then N; a report on M's row linked to N's Pour slab by name. Deleting
 * F too matched F's Pour slab to N's by name and gave N's row only F's id,
 * not the M row F's row listed: the report became "Historical evidence —
 * linked task was deleted." The name match now hands over those ids as well.
 */
export function scheduleTasksAnsweringToRemovedTasks(
  shown: readonly ScheduleItem[],
  removed: readonly ScheduleItem[],
  /** Every saved task the delete keeps, hidden ones included. */
  kept: readonly ScheduleItem[] = [],
  /** The full schedules (no lookahead), the deleted one included: when each import came in. */
  schedules: readonly Pick<ReferenceDocument, 'importBatchId' | 'importedAt'>[] = [],
  /** The progress the row a removed row replaced takes from it (A5 pass 11 M-b); none by default. */
  progressGivenBack: (task: ScheduleItem, removed: ScheduleItem) => Partial<ScheduleItem> | null = () => null,
): ScheduleItem[] {
  const answered = new Set(shown.flatMap(item => [idOf(item.id), ...scheduleTaskEarlierIds(item)]));
  const saved = [...kept, ...removed];
  const leftOutBetween = scheduleLeftTaskOut(saved, schedules);
  const shownById = new Map(shown.map(item => [idOf(item.id), item]));
  const keptById = new Map(kept.map(item => [idOf(item.id), item]));
  // The tasks shown by each earlier id they list (A8 pass 11 L1).
  const shownByEarlierId = new Map<string, ScheduleItem[]>();
  shown.forEach(item => scheduleTaskEarlierIds(item).forEach(id => shownByEarlierId.set(id, [...(shownByEarlierId.get(id) || []), item])));
  // By name and project, built once (A8 pass 9 L3: every removed row was compared with every task).
  const shownNamed = indexByNameAndProject(shown);
  const savedNamed = indexByNameAndProject(saved);
  const added = new Map<ScheduleItem, string[]>();
  const given = new Map<ScheduleItem, Partial<ScheduleItem>>();
  const add = (item: ScheduleItem, ...ids: string[]) => added.set(item, [...(added.get(item) || []), ...ids]);
  const giveBack = (item: ScheduleItem, gone: ScheduleItem) => {
    const progress = progressGivenBack({ ...item, ...given.get(item) }, gone);
    if (progress) given.set(item, { ...given.get(item), ...progress });
  };
  removed.forEach(gone => {
    const goneId = idOf(gone.id);
    if (!goneId) return;
    const inProject = (item: ScheduleItem | undefined): item is ScheduleItem =>
      Boolean(item) && scheduleTaskProjectKey(item!) === scheduleTaskProjectKey(gone);
    const earlierIds = scheduleTaskEarlierIds(gone);
    if (answered.has(goneId)) {
      // The task shown that answers to it also takes the rows it replaced (A8 pass 11 L1): deleting F after
      // M gives N's row the M row F's hidden row recorded.
      const answering = newestOf((shownByEarlierId.get(goneId) || []).filter(inProject));
      const listed = new Set(answering ? [idOf(answering.id), ...scheduleTaskEarlierIds(answering), ...(added.get(answering) || [])] : []);
      const missing = earlierIds.filter(id => !listed.has(id) && !shownById.has(id));
      if (answering && missing.length > 0) add(answering, ...missing);
      return;
    }
    // The row the removed row itself replaced, in its project: the newest shown (A8 pass 9 L2), else the
    // newest the delete keeps hidden (its master was retired: Set Active shows it again, A5 pass 11 M-b).
    const earlier = earlierIds.map(id => shownById.get(id)).filter(inProject);
    const replaced = earlier.length > 0 ? earlier[earlier.length - 1] : earlierIds.map(id => keptById.get(id)).filter(inProject).pop();
    // With none of those shown, the newest task shown that answers to one of them too (A8 pass 11 L1: a
    // master imported after Make Current back moved the task again from the row shown then).
    const answering = earlier.length > 0
      ? undefined
      : newestOf([...new Set(earlierIds.flatMap(id => shownByEarlierId.get(id) || []))].filter(inProject));
    if (replaced || answering) {
      [replaced, answering].forEach(item => {
        if (!item) return;
        add(item, goneId);
        giveBack(item, gone);
      });
      return;
    }
    const inSchedule = sameSchedule(gone);
    const matches = (shownNamed.get(nameAndProject(gone)) || []).filter(item => sameRemovedTask(item, gone));
    if (matches.length !== 1 || inSchedule(matches[0])) return;
    // A master's task, where its import would have paired the removed one (A8 pass 9 L1).
    if (scheduleItemImportBatchIds(matches[0]).length === 0 || leftOutBetween(gone, matches[0])) return;
    const ownRows = new Set((savedNamed.get(nameAndProject(gone)) || []).filter(item => inSchedule(item) && sameRemovedTask(item, gone)));
    if (ownRows.size !== 1) return;
    // With the rows the removed row listed (A5 pass 15 L2), as the answered path above (A8 pass 11 L1).
    add(matches[0], goneId, ...earlierIds.filter(id => !shownById.has(id)));
  });
  return [...added.entries()].map(([item, ids]) => ({
    ...item,
    ...given.get(item),
    revisedFromTaskIds: scheduleTaskEarlierIds({ id: item.id, revisedFromTaskIds: [...ids, ...scheduleTaskEarlierIds(item)] }),
  }));
}

/** The newest of some tasks, by when each came in (the later one on a tie); undefined for none. */
function newestOf(items: readonly ScheduleItem[]): ScheduleItem | undefined {
  const cameAt = (item: ScheduleItem) => {
    const at = Date.parse(item.importedAt || item.createdAt || '');
    return Number.isFinite(at) ? at : 0;
  };
  return items.reduce<ScheduleItem | undefined>((newest, item) => (!newest || cameAt(item) >= cameAt(newest) ? item : newest), undefined);
}

function nameAndProject(item: ScheduleItem): string {
  return `${nameKey(item.taskName)}\n${scheduleTaskProjectKey(item)}`;
}

function indexByNameAndProject(items: readonly ScheduleItem[]): Map<string, ScheduleItem[]> {
  const index = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const entry = nameAndProject(item);
    const list = index.get(entry);
    if (list) list.push(item); else index.set(entry, [item]);
  });
  return index;
}

function batchKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Whether a full schedule saved for the task's project, imported after the
 * removed task's last schedule and before the task's first, left the task
 * out (A8 pass 9 L1). The saved rows are indexed by import on first use.
 *
 * Whole-app audit A8 pass 10 (30 Sep 2026): each removed row filtered every
 * row of each import in between by project and compared each with it; at
 * 1,500 removed rows the delete took 424 ms with one full master in between
 * and 1,205 ms with three (jest). Each import's rows are now indexed by app
 * project and name once per delete; the rule is unchanged.
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
  // Each import's rows by app project and name (A8 pass 10: scanned for every removed row).
  let byBatch: Map<string, Map<string, Map<string, ScheduleItem[]>>> | null = null;
  const projectRowsOf = (batch: string, project: string): Map<string, ScheduleItem[]> | undefined => {
    if (!byBatch) {
      const index = new Map<string, Map<string, Map<string, ScheduleItem[]>>>();
      saved.forEach(item => {
        const project = scheduleTaskProjectKey(item);
        const name = nameKey(item.taskName);
        scheduleItemImportBatchIds(item).map(batchKey).forEach(key => {
          const projects = index.get(key) || new Map<string, Map<string, ScheduleItem[]>>();
          index.set(key, projects);
          const named = projects.get(project) || new Map<string, ScheduleItem[]>();
          projects.set(project, named);
          const list = named.get(name);
          if (list) list.push(item); else named.set(name, [item]);
        });
      });
      byBatch = index;
    }
    return byBatch.get(batch)?.get(project);
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
    const goneName = nameKey(gone.taskName);
    return [...importedAt.entries()].some(([batch, at]) => {
      if (at <= from || at >= to || own.has(batch)) return false;
      // A schedule with rows of the project, none of them the task.
      const named = projectRowsOf(batch, project);
      return Boolean(named) && !(named!.get(goneName) || []).some(row => sameRemovedTask(row, gone));
    });
  };
}

/**
 * Owner answer Q29 (David, 2 Oct 2026): "YES, he links tasks by hand. Hand
 * links follow a task to its new row when a new master moves it."
 *
 * A link is a task's predecessor (ScheduleItem.dependencies, "Framing after
 * Excavate"), made by hand on the web's Schedule Builder; no import brings
 * links today (dependency extraction is off), so every saved link is
 * David's. A link stayed on the exact row it was made on (whole-app audit A5
 * pass 15, A6 pass 15): when a new master moved the task onto a new row the
 * link was gone from it, a link to a moved task pointed at its old hidden
 * row (the web's Schedule showed "Missing"), and Delete PDF + Items moved a
 * link only to a row shown at that moment.
 *
 * Now a link follows the task. The rows of one task are known by the ids
 * they answer to (revisedFromTaskIds, ScheduleTaskRevisions) or by the
 * pairing the change itself made. When the row shown for a task changes (a
 * master approved, Set Active, Make Current, Delete PDF + Items), the row
 * now shown takes the links of the row that was shown (the one David saw and
 * edited), and every link to a row no longer shown points at the row shown
 * for that task. Of two rows of one task, the one whose links David changed
 * later holds them (dependenciesUpdatedAt); with neither changed since, the
 * row that has links. A link to a task no row of which is shown is kept
 * where it points (it comes back with its row), and one to a deleted row
 * nothing answers to is dropped, as before.
 */
export function scheduleTaskLinksOf(item: Pick<ScheduleItem, 'dependencies'>): ScheduleDependency[] {
  return Array.isArray(item.dependencies) ? item.dependencies.filter(link => Boolean(link) && Boolean(idOf(link.predecessorItemId))) : [];
}

/** The row whose links stand, of the row shown now and the row of the same task shown before (Q29). */
export function scheduleTaskLinksHeldBy<T extends Pick<ScheduleItem, 'dependencies' | 'dependenciesUpdatedAt'>>(shown: T, before: T): T {
  const at = (item: T) => {
    const parsed = Date.parse(item.dependenciesUpdatedAt || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  if (at(shown) || at(before)) return at(before) >= at(shown) ? before : shown;
  return scheduleTaskLinksOf(before).length > 0 ? before : shown;
}

/** The links of `from` on `to`, with when David changed them; null when they are the same. */
export function scheduleTaskWithLinksOf<T extends ScheduleItem>(to: T, from: Pick<ScheduleItem, 'dependencies' | 'dependenciesUpdatedAt'>): T | null {
  const links = scheduleTaskLinksOf(from).filter(link => idOf(link.predecessorItemId) !== idOf(to.id));
  const same = sameLinks(scheduleTaskLinksOf(to), links) && (to.dependenciesUpdatedAt ?? null) === (from.dependenciesUpdatedAt ?? null);
  if (same) return null;
  const { dependenciesUpdatedAt: _stamp, ...rest } = to;
  return {
    ...(rest as T),
    ...(links.length > 0 || Array.isArray(to.dependencies) ? { dependencies: links } : {}),
    ...(from.dependenciesUpdatedAt ? { dependenciesUpdatedAt: from.dependenciesUpdatedAt } : {}),
  };
}

function sameLinks(left: readonly ScheduleDependency[], right: readonly ScheduleDependency[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A task's links pointed at the rows `pointTo` names for the ids they point
 * at; a link that would point at the task itself, or repeat one it has, is
 * dropped, and one `pointTo` drops (null) too. The same task when nothing
 * changes.
 */
export function scheduleTaskLinksPointedAt<T extends ScheduleItem>(item: T, pointTo: (predecessorId: string) => string | null | undefined): T {
  const links = scheduleTaskLinksOf(item);
  if (links.length === 0) return item;
  const own = idOf(item.id);
  const targets = links.map(link => {
    const id = idOf(link.predecessorItemId);
    const target = pointTo(id);
    return { link, id, next: target === undefined ? id : target === null ? '' : idOf(target) };
  });
  // A link the task keeps as it is stands over one moved onto the same task (never doubled, as before).
  const standing = new Set(targets.filter(entry => entry.next === entry.id).map(entry => entry.id));
  const kept: ScheduleDependency[] = [];
  const seen = new Set<string>();
  let changed = links.length !== (Array.isArray(item.dependencies) ? item.dependencies.length : 0);
  targets.forEach(({ link, id, next }) => {
    if (!next || next === own || seen.has(next) || (next !== id && standing.has(next))) {
      changed = true;
      return;
    }
    seen.add(next);
    if (next !== id) changed = true;
    kept.push(next === id ? link : { ...link, predecessorItemId: next });
  });
  return changed ? { ...item, dependencies: kept } : item;
}

/**
 * The tasks whose links change when the tasks shown change (owner answer
 * Q29, above): each task shown now that was not takes the links of the task
 * shown before for it (its row by the ids rows answer to, else `paired`, the
 * change's own pairing), and every link points at the row shown for its
 * task. `removedIds`: rows the change deleted; a link to one nothing answers
 * to is dropped, on hidden rows too. Returns the changed tasks (from `after`,
 * or from `known` for hidden rows).
 */
export function scheduleTaskLinksFollowingShownTasks({
  before,
  after,
  known = [],
  paired,
  removedIds = [],
  now,
}: Readonly<{
  /** The tasks shown before the change. */
  before: readonly ScheduleItem[];
  /** The tasks shown after, with the change's other edits. */
  after: readonly ScheduleItem[];
  /** Every saved task after the change, hidden ones included. */
  known?: readonly ScheduleItem[];
  /** The change's own pairing of a task shown now with the task shown before for it. */
  paired?: (shown: ScheduleItem) => ScheduleItem | null | undefined;
  removedIds?: readonly string[];
  /** When the change was made: each changed task's updatedAt. */
  now?: string;
}>): ScheduleItem[] {
  const removed = new Set(removedIds.map(idOf).filter(Boolean));
  const linked = (items: readonly ScheduleItem[]) => items.some(item => scheduleTaskLinksOf(item).length > 0);
  if (!linked(before) && !linked(after) && (removed.size === 0 || !linked(known))) return [];
  const beforeIds = new Set(before.map(item => idOf(item.id)));
  const afterIds = new Set(after.map(item => idOf(item.id)));
  const nowHidden = before.filter(item => !afterIds.has(idOf(item.id)));
  const hiddenById = new Map(nowHidden.map(item => [idOf(item.id), item]));
  const hiddenByEarlierId = new Map<string, ScheduleItem[]>();
  nowHidden.forEach(hidden => scheduleTaskEarlierIds(hidden).forEach(id => hiddenByEarlierId.set(id, [...(hiddenByEarlierId.get(id) || []), hidden])));
  const changed = new Map<string, ScheduleItem>();
  // The task shown before for each task shown now: by the ids rows answer to, in its project, else the change's pairing.
  const shownFor = new Map<string, string>();
  const taken = new Set<string>();
  after.filter(item => !beforeIds.has(idOf(item.id))).forEach(shown => {
    const project = scheduleTaskProjectKey(shown);
    const byChain = [...new Set([
      ...[idOf(shown.id), ...scheduleTaskEarlierIds(shown)].map(id => hiddenById.get(id)),
      ...(hiddenByEarlierId.get(idOf(shown.id)) || []),
    ])].filter((hidden): hidden is ScheduleItem => Boolean(hidden) && scheduleTaskProjectKey(hidden!) === project);
    const previous = byChain.length === 1 ? byChain[0] : byChain.length === 0 ? paired?.(shown) ?? undefined : undefined;
    if (!previous || !hiddenById.has(idOf(previous.id)) || taken.has(idOf(previous.id))) return;
    taken.add(idOf(previous.id));
    shownFor.set(idOf(shown.id), idOf(previous.id));
    const holder = scheduleTaskLinksHeldBy(shown, previous);
    const moved = holder === previous ? scheduleTaskWithLinksOf(shown, previous) : null;
    if (moved) changed.set(idOf(shown.id), moved);
  });
  const afterNow = after.map(item => changed.get(idOf(item.id)) || item);
  const hiddenToShown = new Map([...shownFor.entries()].map(([shown, hidden]) => [hidden, shown]));
  const answeringShown = scheduleTaskLinks(afterNow, [...known, ...before]);
  const answeringSaved = scheduleTaskLinks(known, known);
  const pointTo = (task: ScheduleItem) => (id: string): string | null | undefined => {
    if (afterIds.has(id)) return undefined;
    const shown = hiddenToShown.get(id);
    if (shown) return shown;
    const link = answeringShown({ scheduleItemId: id, projectName: task.projectName, scheduleProjectName: task.scheduleProjectName });
    if (link && link.basis !== 'stored_task_name') return link.item.id;
    if (!removed.has(id)) return undefined;
    // A deleted row: the saved row that answers to it, hidden or not, else none (dropped, as before).
    const saved = answeringSaved({ scheduleItemId: id });
    return saved && saved.basis !== 'stored_task_name' && !removed.has(idOf(saved.item.id)) ? saved.item.id : null;
  };
  afterNow.forEach(item => {
    const pointed = scheduleTaskLinksPointedAt(item, pointTo(item));
    if (pointed !== item || changed.has(idOf(item.id))) changed.set(idOf(item.id), pointed);
  });
  // Review P5-2: the list already shows a link at the row shown for its task, while the saved row may still name a row
  // a master hid (the device that made the link, or the one that approved the master, had not heard of the other).
  // Such a link is saved here as shown, with every other link this change moves: left as saved, a link to a row this
  // change deletes was dropped afterwards.
  const savedById = new Map(known.map(item => [idOf(item.id), item] as const));
  afterNow.forEach(item => {
    const saved = savedById.get(idOf(item.id));
    if (saved && !changed.has(idOf(item.id)) && !sameLinks(scheduleTaskLinksOf(saved), scheduleTaskLinksOf(item))) changed.set(idOf(item.id), item);
  });
  if (removed.size > 0) {
    known.filter(item => !afterIds.has(idOf(item.id)) && !removed.has(idOf(item.id)) &&
      scheduleTaskLinksOf(item).some(link => removed.has(idOf(link.predecessorItemId))))
      .forEach(item => {
        const pointed = scheduleTaskLinksPointedAt(item, id => (removed.has(id) ? pointTo(item)(id) : undefined));
        if (pointed !== item) changed.set(idOf(item.id), pointed);
      });
  }
  // Only the tasks whose links (or who holds them) end up different: a row whose links moved away and back is not saved.
  const original = new Map([...after, ...known].map(item => [idOf(item.id), item]));
  return [...changed.values()]
    .filter(item => {
      const was = original.get(idOf(item.id));
      return !was || !sameLinks(scheduleTaskLinksOf(was), scheduleTaskLinksOf(item)) ||
        (was.dependenciesUpdatedAt ?? null) !== (item.dependenciesUpdatedAt ?? null);
    })
    .map(item => (now ? { ...item, updatedAt: now } : item));
}

/**
 * The task shown that a link's predecessor id names (owner answer Q29): the
 * task itself, or the row shown for it by the ids rows answer to; null when
 * none is shown. Links saved before 2 Oct 2026 can still point at a row a
 * master hid; the web's Schedule reads them as the row shown, not "Missing",
 * until the next change moves them.
 */
export function scheduleTaskLinkTargets(
  shown: readonly ScheduleItem[],
  known: readonly ScheduleItem[] = [],
): (predecessorId: string) => ScheduleItem | null {
  const answering = scheduleTaskLinks(shown, known);
  return predecessorId => {
    const link = answering({ scheduleItemId: predecessorId });
    return link && link.basis !== 'stored_task_name' ? link.item : null;
  };
}

/**
 * Schedule batch S5, item 1: a row's activity notes with those another row of
 * the same task holds that it lacks. A note is appended once and never
 * changed, and carries its own id, so two rows of one task are put together
 * as two copies of one row are (scheduleItemActivityOfBoth, ScheduleItemEditBase): every note of
 * both, each once. In the order of their dates, as the task's history reads
 * (the app shows the last three). Null when the row lacks none, so a row
 * that already holds them is never rewritten: two devices that each bring
 * the same notes forward end with each note once.
 */
export function scheduleItemActivityWithOtherRows(
  own: readonly ProjectItemActivity[] | null | undefined,
  ...others: Array<readonly ProjectItemActivity[] | null | undefined>
): ProjectItemActivity[] | null {
  const mine = Array.isArray(own) ? own : [];
  const known = new Set(mine.map(entry => entry?.id));
  const lacking: ProjectItemActivity[] = [];
  others.forEach(list => (Array.isArray(list) ? list : []).forEach(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || known.has(entry.id)) return;
    known.add(entry.id);
    lacking.push(entry);
  }));
  if (lacking.length === 0) return null;
  const when = (entry: ProjectItemActivity) => { const time = Date.parse(entry?.createdAt || ''); return Number.isFinite(time) ? time : 0; };
  return [...mine, ...lacking].map((entry, index) => ({ entry, index }))
    .sort((left, right) => when(left.entry) - when(right.entry) || left.index - right.index).map(({ entry }) => entry);
}

/**
 * Schedule batch S6, item 1 (7 Oct 2026; puts S5 item 1 right). S5 made a
 * task's priority follow it to the row a newer master moves it to, always. So
 * a task David never touched no longer turned High when a master moved it
 * into the coming week, and a file's Critical column no longer raised it.
 * Decided: only a priority he SET follows; one he never set is the new row's
 * own, as before S5.
 *
 * How the app tells. No stamp says who set a priority, so a row keeps what
 * its own import gave it (priorityAsImported, written once on every row an
 * import adds). The priority is his when
 *  - the row says it took it from the task with his text (textFromTask): it
 *    was his there, and whatever the row holds since was set on it; or
 *  - it reads otherwise than its own import gave it; or
 *  - the row was saved before rows kept that word, and it is Low: no import
 *    gives a Low. A Medium or a High there cannot be told from the file's.
 */
export function schedulePriorityAsRead(value: unknown): SchedulePriority {
  return value === 'Low' || value === 'High' ? value : 'Medium';
}

type PriorityRecord = Pick<ScheduleItem, 'priority' | 'priorityAsImported' | 'textFromTask'>;

/** What the row's own import gave it; for a row saved before that was kept, what it holds (Medium under a Low, which no import gives). */
export function schedulePriorityItsImportGave(row: PriorityRecord): SchedulePriority {
  const recorded = row.priorityAsImported;
  if (recorded === 'Low' || recorded === 'Medium' || recorded === 'High') return recorded;
  const held = schedulePriorityAsRead(row.priority);
  return held === 'Low' ? 'Medium' : held;
}

/** Whether the row's priority is one David set (above): only that follows the task. */
export function schedulePriorityIsHis(row: PriorityRecord | null | undefined): boolean {
  if (!row) return false;
  if (row.textFromTask && Object.prototype.hasOwnProperty.call(row.textFromTask, 'priority')) return true;
  return schedulePriorityAsRead(row.priority) !== schedulePriorityItsImportGave(row);
}

/**
 * Whether the row's priority is known to be its own import's, never set by
 * David: the row keeps what its import gave it and still holds that. A row
 * saved before rows kept that word is not known either way (unless Low).
 */
export function schedulePriorityIsItsImports(row: PriorityRecord | null | undefined): boolean {
  const recorded = row?.priorityAsImported;
  return Boolean(row) && (recorded === 'Low' || recorded === 'Medium' || recorded === 'High') && !schedulePriorityIsHis(row);
}
