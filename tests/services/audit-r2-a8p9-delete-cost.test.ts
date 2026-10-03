/**
 * Audit round 2, A8 pass 9 L3 (30 Sep 2026): the "Delete PDF + Items" tap
 * froze on a big master.
 *
 * Before the deletions are recorded the delete works out, for each removed
 * row, the one task shown it was (scheduleTasksAnsweringToRemovedTasks). It
 * compared every removed row with every task shown, and again with every
 * saved task: about 2 s in plain Node at 1,500 removed of 3,300 saved. The
 * tasks are now indexed by name and project once per delete.
 *
 * Timings are measured in plain Node (see the commit); this test pins the
 * work done, which does not depend on the machine. Synthetic data.
 */
import type { ScheduleItem } from '../../types';
import { scheduleTasksAnsweringToRemovedTasks } from '../../services/ScheduleTaskRevisions';

const REMOVED = 300;
const OTHERS = 60;

/** Rows of a schedule, counting reads of each task's name. */
function rows(source: string, count: number, offset: number, counter: { reads: number }): ScheduleItem[] {
  return Array.from({ length: count }, (_, index) => {
    const row = {
      id: `${source}-${index + offset}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: `Area ${index % 10}`,
      startDate: '10/01/2026', finishDate: '10/02/2026', milestone: '', owner: '', contractor: '', percentComplete: 0,
      status: 'Not Started', priority: 'Medium', notes: '', importBatchId: `batch-${source}`, sourceDocumentId: source,
    } as unknown as ScheduleItem;
    const name = `Task ${index + offset}`;
    Object.defineProperty(row, 'taskName', { enumerable: true, get: () => { counter.reads += 1; return name; } });
    return row;
  });
}

describe('A8 p9 L3: the delete reads each task a few times, not once per removed row', () => {
  it(`${REMOVED} removed rows against ${REMOVED + OTHERS} tasks shown`, () => {
    const counter = { reads: 0 };
    const removed = rows('F', REMOVED, 0, counter);
    // The new master moved every task (saved before 79f49d3, no earlier ids) and has others.
    const shown = [...rows('M', REMOVED, 0, counter), ...rows('M', OTHERS, REMOVED, counter)];
    counter.reads = 0;
    const written = scheduleTasksAnsweringToRemovedTasks(shown, removed, shown);
    expect(written).toHaveLength(REMOVED);
    expect(written.every(item => item.revisedFromTaskIds?.[0] === item.id.replace(/^M-/, 'F-'))).toBe(true);
    const tasks = shown.length + removed.length;
    expect(counter.reads).toBeLessThanOrEqual(12 * tasks);
  });
});
