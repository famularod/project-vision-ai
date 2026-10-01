/**
 * Audit round 2, A10 pass 7 L4 (30 Sep 2026): slower screens.
 *
 * (a) The A10 pass 6 L2 guard (ad78f05) scanned every saved task once for
 * each update that fell back by name, working out each task's imports again
 * each time. At 3,300 saved tasks and 800 such updates, reconciliation,
 * the commitment register and evidence correlation each took several times
 * longer, and Home runs them per project per render. The saved tasks are now
 * indexed once per call, by schedule and name, on the first update that needs
 * it.
 *
 * (b) Once any deleted task had a field update, every task change re-ran
 * selectAuthoritativeScheduleItems inside the phone's deleted-task check (67 ms
 * at 3,300 tasks). With no name fallback for a deleted id (A10 pass 7 L1) the
 * check reads the saved tasks once and never works out the tasks shown.
 *
 * Timings are measured in plain Node (see the commit); these tests pin the
 * work done, which does not depend on the machine. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import * as reconciliation from '../../services/PIEScheduleReconciliation';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';

const TASKS = 40;
const AREAS = 4;
type Counted = { items: ScheduleItem[]; reads: () => number };

/** Three masters' rows of the same tasks, saved before 79f49d3 (no earlier ids), counting reads of each task's name. */
function savedTasks(): Counted {
  let reads = 0;
  const items: ScheduleItem[] = [];
  ['M1', 'M2', 'M3'].forEach((master, index) => {
    for (let task = 0; task < TASKS; task += 1) {
      const row = {
        id: `${master}-${task}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: `Area ${task % AREAS}`,
        startDate: '10/01/2026', finishDate: '10/02/2026', milestone: '', owner: '', contractor: '', percentComplete: 0,
        status: 'Not Started', priority: 'Medium', notes: '', importBatchId: `batch-${master}`, sourceDocumentId: master,
        importedAt: `2026-09-0${index + 1}T12:00:00.000Z`,
      } as unknown as ScheduleItem;
      const name = `Task ${Math.floor(task / AREAS)}`;
      Object.defineProperty(row, 'taskName', { enumerable: true, get: () => { reads += 1; return name; } });
      items.push(row);
    }
  });
  return { items, reads: () => reads };
}

/** Field updates linked to the oldest master's rows: none is a task shown, so each falls back by its stored name. */
const updates = (count: number): ProjectUpdate[] => Array.from({ length: count }, (_, index) => {
  const task = (index * 7) % TASKS;
  return {
    id: `u-${index}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-25T15:00:00.000Z', photos: [],
    recipients: { contactIds: [] }, notes: 'In progress.', scheduleItemId: `M1-${task}`,
    scheduleTaskName: `Task ${Math.floor(task / AREAS)}`, selectedAreaName: `Area ${task % AREAS}`,
  } as ProjectUpdate;
});

describe('A10 p7 L4 (a): the name fallback reads the saved tasks once per call, not once per update', () => {
  it('60 updates falling back by name read each saved task\'s name about once', () => {
    const saved = savedTasks();
    const shown = saved.items.filter(item => item.id.startsWith('M3-')).map(item => ({ ...item }));
    const before = saved.reads();
    const linkOf = scheduleTaskLinks(shown, saved.items);
    const links = updates(60).map(update => linkOf(update));
    expect(links.every(link => link?.basis === 'stored_task_name')).toBe(true);
    expect(saved.reads() - before).toBeLessThanOrEqual(2 * saved.items.length);
  });

  it('the result is the same: a name its own schedule had twice in the area still matches none', () => {
    const saved = savedTasks();
    const twin = { ...saved.items[0], id: 'M1-twin', taskName: saved.items[0].taskName } as ScheduleItem;
    const shown = saved.items.filter(item => item.id.startsWith('M3-')).map(item => ({ ...item }));
    const linkOf = scheduleTaskLinks(shown, [...saved.items, twin]);
    const [first] = updates(1);
    expect(linkOf(first)).toBeNull();
    expect(scheduleTaskLinks(shown, saved.items)(first)).toMatchObject({ basis: 'stored_task_name' });
  });
});

describe('A10 p7 L4 (b): the phone\'s deleted-task check never works out the tasks shown', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a deleted task with a field update: one pass over the saved tasks', () => {
    const select = jest.spyOn(reconciliation, 'selectAuthoritativeScheduleItems');
    const saved = savedTasks();
    const tombstones: DAVESyncTombstone[] = [{ entityType: 'schedule_item', recordId: 'gone-1', deletedAt: '2026-09-27T12:00:00.000Z' }];
    const list = [...updates(5), { ...updates(1)[0], id: 'u-gone', scheduleItemId: 'gone-1' }];
    const split = partitionProjectUpdatesByDeletedTask(list, tombstones, update => update, { scheduleItems: saved.items });
    expect(split.historical.map(update => update.id)).toEqual(['u-gone']);
    expect(select).not.toHaveBeenCalled();
    expect(saved.reads()).toBe(0);
  });
});
