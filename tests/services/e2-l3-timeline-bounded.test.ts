/**
 * Review pass 1, L3 (older): a task that already holds a year such as 0202
 * or 9999 (from a file, the phone, or an older desktop build) made the
 * timeline build one column for every day, week or month from that date to
 * the rest of the schedule: about 95,000 week columns or 666,000 day columns
 * for one task dated 0202, and 2.9 million for one dated 9999. Typing such a
 * year on the desktop is refused; a date already stored was not.
 *
 * The timeline now draws only dates from 2000 through 2100. A task with a
 * date outside those years stays in the list with its dates as stored, has no
 * bar, and is marked, so it is not silently hidden and its date is never
 * changed for it.
 */
import { buildVitruviusGanttModel, type VitruviusGanttZoom } from '../../services/VitruviusGanttModel';
import type { ScheduleItem } from '../../types';

const TODAY = new Date('2026-07-24T12:00:00.000Z');

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: 'Lot 9',
    projectName: 'Lot 9',
    locationName: 'North Pad',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-24',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 5,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

const pour = task('pour', { taskName: 'Pour slab' });
const frame = task('frame', { taskName: 'Frame walls', startDate: '2026-07-27', finishDate: '2026-07-29', durationDays: 3 });

/** Builds the timeline, counting one-day steps, and stops it past `limit` of them so a runaway fails at once. */
function build(items: readonly ScheduleItem[], zoom: VitruviusGanttZoom, limit = 20_000) {
  const real = Date.prototype.setUTCDate;
  let steps = 0;
  const spy = jest.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (this: Date, day: number) {
    steps += 1;
    if (steps > limit) throw new Error(`More than ${limit} one-day steps: the timeline is not bounded.`);
    return real.call(this, day);
  });
  try {
    return { model: buildVitruviusGanttModel({ items, zoom, today: TODAY, groupBy: 'appProject' }), steps };
  } finally {
    spy.mockRestore();
  }
}

const withoutStray = (zoom: VitruviusGanttZoom) => build([pour, frame], zoom).model;

describe('L3: one stored task with a year the schedule does not take', () => {
  it.each([
    ['0202-05-01', 'day', 14],
    ['0202-05-01', 'week', 3],
    ['0202-05-01', 'month', 1],
    ['9999-12-31', 'day', 14],
    ['9999-12-31', 'week', 3],
    ['1900-01-01', 'day', 14],
    ['2101-01-01', 'week', 3],
    ['5/1/0202', 'week', 3],
  ] as const)('dated %s, %s zoom: the timeline is as wide as the other tasks need (%i columns), not from that year to this one', (date, zoom, columns) => {
    const stray = task('stray', { taskName: 'Stray date', startDate: date, finishDate: date, durationDays: 1 });
    const { model } = build([pour, frame, stray], zoom);
    const expected = withoutStray(zoom);
    expect(model.columns).toHaveLength(columns);
    expect(model.columns).toEqual(expected.columns);
    expect([model.rangeStart, model.rangeFinish, model.timelineWidth])
      .toEqual([expected.rangeStart, expected.rangeFinish, expected.timelineWidth]);
    // The other tasks sit exactly where they would without it.
    expect(model.rows.filter(row => row.item.id !== 'stray'))
      .toEqual(expected.rows);
  });

  it('the task is still listed, with its dates as stored and no bar, and is marked', () => {
    const stray = task('stray', { taskName: 'Stray date', startDate: '0202-05-01', finishDate: '0202-05-04', percentComplete: 50 });
    const { model } = build([pour, frame, stray], 'week');
    expect(model.rows.map(row => row.item.taskName).sort()).toEqual(['Frame walls', 'Pour slab', 'Stray date']);
    const strayRow = model.rows.find(row => row.item.id === 'stray')!;
    expect(strayRow).toMatchObject({
      startDate: '0202-05-01',
      finishDate: '0202-05-04',
      left: null,
      width: null,
      progressWidth: null,
      outsideSupportedYears: true,
    });
    expect(model.rows.filter(row => row.item.id !== 'stray').map(row => row.outsideSupportedYears)).toEqual([false, false]);
    // Nothing about the task itself is changed.
    expect(strayRow.item).toBe(stray);
  });

  it('a start this year with a finish in 9999: no bar millions of pixels wide', () => {
    const lease = task('lease', { taskName: 'Ground lease', startDate: '2026-07-20', finishDate: '9999-12-31' });
    const { model } = build([pour, lease], 'day');
    expect(model.columns.length).toBeLessThan(20);
    expect(model.rows.find(row => row.item.id === 'lease')).toMatchObject({
      startDate: '2026-07-20', finishDate: '9999-12-31', left: null, width: null, outsideSupportedYears: true,
    });
  });

  it('a phase takes its dates from its tasks inside 2000 through 2100 only', () => {
    const phase = task('phase', { taskName: 'Site work', startDate: '', finishDate: '', isSummary: true });
    const inside = task('inside', { taskName: 'Grade pad', parentItemId: 'phase', startDate: '2026-07-20', finishDate: '2026-07-22' });
    const outside = task('outside', { taskName: 'Old survey', parentItemId: 'phase', startDate: '0202-05-01', finishDate: '0202-05-04' });
    const { model } = build([phase, inside, outside], 'week');
    expect(model.rows.find(row => row.item.id === 'phase')).toMatchObject({
      startDate: '2026-07-20', finishDate: '2026-07-22', outsideSupportedYears: false,
    });
    expect(model.rows.find(row => row.item.id === 'phase')?.width).toBe(3 * 16);
    expect(model.columns.length).toBeLessThan(5);
  });

  it('a baseline with such a year is not drawn; the task\'s own bar is', () => {
    const item = task('item', { baselineStartDate: '0202-07-13', baselineFinishDate: '0202-07-17' });
    const { model } = build([item], 'day');
    expect(model.rows[0]).toMatchObject({ baselineLeft: null, baselineWidth: null, outsideSupportedYears: false });
    expect(model.rows[0].left).not.toBeNull();
    expect(model.columns.length).toBeLessThan(20);
  });

  it('when every dated task is outside 2000 through 2100 the timeline shows the four weeks from today, as for no dates', () => {
    const { model } = build([task('a', { startDate: '0202-05-01', finishDate: '0202-05-04' })], 'week');
    const empty = build([task('a', { startDate: '', finishDate: '' })], 'week').model;
    expect([model.rangeStart, model.rangeFinish]).toEqual([empty.rangeStart, empty.rangeFinish]);
    expect(model.rows[0]).toMatchObject({ left: null, width: null, outsideSupportedYears: true });
  });
});

describe('L3: the most the timeline can now be asked to draw', () => {
  it('tasks at both ends of 2000 through 2100: 101 years of columns, and no more', () => {
    const first = task('first', { startDate: '2000-01-01', finishDate: '2000-01-03' });
    const last = task('last', { startDate: '2100-12-29', finishDate: '2100-12-31' });
    const far = task('far', { startDate: '9999-12-31', finishDate: '9999-12-31' });
    expect(build([first, last, far], 'month', 200_000).model.columns).toHaveLength(101 * 12 + 2);
    const week = build([first, last, far], 'week', 200_000).model;
    expect(week.columns.length).toBeGreaterThan(5_200);
    expect(week.columns.length).toBeLessThan(5_300);
    expect(week.rows.map(row => [row.item.id, row.outsideSupportedYears]).sort())
      .toEqual([['far', true], ['first', false], ['last', false]]);
  });
});

describe('L3 guards: tasks inside 2000 through 2100 are drawn as before', () => {
  it.each(['2000-01-01', '2100-12-31'])('a task dated %s, the edge of the supported years, has its bar', date => {
    const { model } = build([task('edge', { startDate: date, finishDate: date, durationDays: 1 })], 'day');
    expect(model.rows[0]).toMatchObject({ startDate: date, finishDate: date, outsideSupportedYears: false });
    expect(model.rows[0].left).toBe(2 * 38);
    expect(model.rows[0].width).toBe(38);
  });

  it('a task with no dates is still listed with no bar, and is not marked as outside the years', () => {
    const { model } = build([pour, task('undated', { startDate: '', finishDate: '' })], 'week');
    expect(model.rows.find(row => row.item.id === 'undated'))
      .toMatchObject({ startDate: null, finishDate: null, left: null, width: null, outsideSupportedYears: false });
  });
});
