/**
 * Audit round 2, A8 pass 10 (30 Sep 2026): "Delete PDF + Items" slowed with
 * each full master between the deleted one and the new one.
 *
 * Before the deletions are recorded the delete works out, for each removed
 * row, the one task shown it was (scheduleTasksAnsweringToRemovedTasks); the
 * matching was indexed by name and project (A8 pass 9 L3), but the check
 * that no full schedule in between left the task out (A8 pass 9 L1) still
 * scanned every row of each import in between for every removed row: 16 ms
 * with none in between, 424 ms with one and 1,205 ms with three, at 1,500
 * removed rows in jest. Each import's rows are now indexed by app project and
 * name once per delete; the rule and its results are unchanged.
 *
 * Timings are measured in plain Node (see the commit); these tests pin the
 * work done, which does not depend on the machine. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { scheduleTasksAnsweringToRemovedTasks } from '../../services/ScheduleTaskRevisions';

const REMOVED = 300;
const OTHERS = 60;

const schedule = (id: string, importedAt: string) => ({ importBatchId: `batch-${id}`, importedAt }) as Pick<ReferenceDocument, 'importBatchId' | 'importedAt'>;
const F = schedule('F', '2026-08-01T12:00:00.000Z');
const BETWEEN = [schedule('G1', '2026-08-10T12:00:00.000Z'), schedule('G2', '2026-08-15T12:00:00.000Z'), schedule('G3', '2026-08-20T12:00:00.000Z')];
const M = schedule('M', '2026-09-26T12:00:00.000Z');

/** Rows of a schedule, counting reads of each task's name. */
function rows(source: string, count: number, offset: number, counter: { reads: number }, name = (index: number) => `Task ${index}`): ScheduleItem[] {
  return Array.from({ length: count }, (_, index) => {
    const row = {
      id: `${source}-${index + offset}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: `Area ${(index + offset) % 10}`,
      startDate: '10/01/2026', finishDate: '10/02/2026', milestone: '', owner: '', contractor: '', percentComplete: 0,
      status: 'Not Started', priority: 'Medium', notes: '', importBatchId: `batch-${source}`, sourceDocumentId: source,
    } as unknown as ScheduleItem;
    const taskName = name(index + offset);
    Object.defineProperty(row, 'taskName', { enumerable: true, get: () => { counter.reads += 1; return taskName; } });
    return row;
  });
}

/** F's rows removed; M (old format, no earlier ids) moved every one; each master between kept them (its own rows). */
function deleteF(between: number, counter: { reads: number }, betweenName?: (index: number) => string) {
  const removed = rows('F', REMOVED, 0, counter);
  const shown = [...rows('M', REMOVED, 0, counter), ...rows('M', OTHERS, REMOVED, counter)];
  const middle = BETWEEN.slice(0, between).flatMap(document => rows(document.importBatchId!.replace('batch-', ''), REMOVED, 0, counter, betweenName));
  counter.reads = 0;
  const written = scheduleTasksAnsweringToRemovedTasks(shown, removed, [...shown, ...middle], [F, ...BETWEEN.slice(0, between), M]);
  return { written, tasks: shown.length + removed.length + middle.length };
}

describe('A8 p10: the in-between check reads each task a few times, not once per removed row', () => {
  it.each([1, 3])(`${REMOVED} removed rows with %i full master(s) in between that kept every task`, between => {
    const counter = { reads: 0 };
    const { written, tasks } = deleteF(between, counter);
    // No master in between left the tasks out: each removed id goes onto M's row of it, as before.
    expect(written).toHaveLength(REMOVED);
    expect(written.every(item => item.revisedFromTaskIds?.[0] === item.id.replace(/^M-/, 'F-'))).toBe(true);
    expect(counter.reads).toBeLessThanOrEqual(12 * tasks);
  });

  it('as before: a full master in between that left the tasks out writes no id', () => {
    const counter = { reads: 0 };
    const { written, tasks } = deleteF(1, counter, index => `Other ${index}`);
    expect(written).toEqual([]);
    expect(counter.reads).toBeLessThanOrEqual(12 * tasks);
  });
});
