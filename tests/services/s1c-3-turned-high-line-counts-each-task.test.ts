/**
 * S1c item 3 (14 Oct 2026; review pass 5's H5S-3, Low, caused by 5cf8d766, 2.38). The line naming the tasks a newer
 * schedule turned High counted two different tasks with one name (and area) as one: "This schedule turned 1 task
 * High: Inspection" when two were. Now every task is counted, and where names repeat they are told apart in plain
 * words: by project, then by the day each ends, then by the day each starts. The phone's approval, the computer's
 * upload and its Make Current all use this function, so they stay the same. The reviewer's L1 and L2
 * (notes/p6-b232/hrv5s-line.test.ts). Synthetic data.
 */
import { scheduleTurnedHighLine, scheduleTurnedHighLineBetween, scheduleUploadTurnedHighLine } from '../../services/ScheduleTurnedHigh';
import type { ScheduleItem } from '../../types';

const row = (id: string, taskName: string, priority: string, extra: Partial<ScheduleItem> = {}) => ({
  id, projectName: 'Alpha', taskName, locationName: '', owner: '', startDate: '10/13/2026', finishDate: '10/16/2026', milestone: '',
  status: 'Not Started', percentComplete: 0, notes: '', priority, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
}) as unknown as ScheduleItem;
const raised = (before: ScheduleItem[]) => before.map(item => ({ ...item, priority: 'High' })) as ScheduleItem[];
const BACK = 'To set one back, open it and change its priority.';

describe('S1c item 3: each task turned High is counted, and tasks of one name are told apart', () => {
  it('L1: two tasks named alike in one project, no area: two tasks, by the day each ends', () => {
    const before = [row('i1', 'Inspection', 'Medium', { finishDate: '10/15/2026' }), row('i2', 'Inspection', 'Medium', { finishDate: '10/16/2026' })];
    expect(scheduleTurnedHighLineBetween(before, raised(before)))
      .toBe(`This schedule turned 2 tasks High: Inspection (ends 10/15/2026) and Inspection (ends 10/16/2026). ${BACK}`);
  });

  it('L2: the same name and area in two projects of one combined schedule: two tasks, by project', () => {
    const before = [row('a', 'Framing', 'Medium', { locationName: 'Level 1' }), row('b', 'Framing', 'Medium', { locationName: 'Level 1', projectName: 'Beta' })];
    expect(scheduleTurnedHighLineBetween(before, raised(before)))
      .toBe(`This schedule turned 2 tasks High: Framing (Level 1, Alpha) and Framing (Level 1, Beta). ${BACK}`);
  });

  it('the same day ends: by the day each starts; nothing left to tell them by: both named, both counted', () => {
    const starts = [row('p1', 'Pour slab', 'Medium', { locationName: 'Lot', startDate: '10/12/2026' }), row('p2', 'Pour slab', 'Medium', { locationName: 'Lot', startDate: '10/14/2026' })];
    expect(scheduleTurnedHighLineBetween(starts, raised(starts)))
      .toBe(`This schedule turned 2 tasks High: Pour slab (Lot, starts 10/12/2026) and Pour slab (Lot, starts 10/14/2026). ${BACK}`);
    const twins = [row('t1', 'Pour slab', 'Medium', { locationName: 'Lot' }), row('t2', 'Pour slab', 'Medium', { locationName: 'Lot' })];
    expect(scheduleTurnedHighLineBetween(twins, raised(twins))).toBe(`This schedule turned 2 tasks High: Pour slab (Lot) and Pour slab (Lot). ${BACK}`);
  });

  it('"and N more" counts tasks, not names; a name that does not repeat reads as before', () => {
    const before = ['Deck', 'Framing', 'Paint'].map((name, index) => row(`t${index}`, name, 'Medium', { locationName: 'Lot' }))
      .concat([row('i1', 'Inspection', 'Medium', { locationName: 'Lot', finishDate: '10/15/2026' }), row('i2', 'Inspection', 'Medium', { locationName: 'Lot', finishDate: '10/16/2026' })]);
    expect(scheduleTurnedHighLineBetween(before, raised(before)))
      .toBe(`This schedule turned 5 tasks High: Deck (Lot), Framing (Lot), Inspection (Lot, ends 10/15/2026) and 2 more. ${BACK}`);
    expect(scheduleTurnedHighLine([row('r', 'Roof', 'High', { locationName: 'Lot' })])).toBe(`This schedule turned 1 task High: Roof (Lot). ${BACK}`);
  });

  it('the computer\'s upload names them the same way (the same function)', () => {
    const previous = [row('a', 'Framing', 'Medium', { locationName: 'Level 1' }), row('b', 'Framing', 'Medium', { locationName: 'Level 1', projectName: 'Beta' })];
    const plan = { revisions: previous.map(item => ({ previous: item, item: { ...item, priority: 'High' } as ScheduleItem })) };
    expect(scheduleUploadTurnedHighLine(plan)).toBe(`This schedule turned 2 tasks High: Framing (Level 1, Alpha) and Framing (Level 1, Beta). ${BACK}`);
  });
});
