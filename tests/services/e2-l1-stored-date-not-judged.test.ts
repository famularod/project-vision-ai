/**
 * Review pass 1, L1 (caused by "Desktop schedule: a duration, lag or date
 * beyond what the schedule supports is refused ..."): a task already stored
 * with a date outside 2000 through 2100 could not be saved on the desktop for
 * any change, even a rename, although that commit says a date the save does
 * not change is not judged. The builder and the editor's own Save check did
 * leave it alone; the change preview judged it, and the editor will not save
 * while the preview says "Needs correction".
 *
 * Only a date the draft changes is judged now. These are the preview's cases;
 * the editor's are in tests/components/e2-l1-stored-date-editor.test.tsx.
 */
import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import { scheduleCalendarDay } from '../../services/ScheduleCalendarDay';
import type { ScheduleItem } from '../../types';

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

/** The dates as the desktop editor hands them to the preview: the calendar day its date boxes show. */
const asTheEditorShows = (item: ScheduleItem) => ({
  startDate: scheduleCalendarDay(item.startDate) ?? '',
  finishDate: item.isMilestone ? scheduleCalendarDay(item.startDate) ?? '' : scheduleCalendarDay(item.finishDate) ?? '',
});

/** Counts every one-day step of a date while `work` runs, and stops it past `limit`. */
function countingDaySteps<T>(limit: number, work: () => T) {
  const real = Date.prototype.setUTCDate;
  let steps = 0;
  const spy = jest.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (this: Date, day: number) {
    steps += 1;
    if (steps > limit) throw new Error(`More than ${limit} one-day steps: the preview is not bounded.`);
    return real.call(this, day);
  });
  try {
    return { result: work(), steps };
  } finally {
    spy.mockRestore();
  }
}

describe('L1: a stored date outside 2000 through 2100 that the draft does not change is not judged', () => {
  it.each([
    ['an old file, 1999', '1999-11-01', '1999-11-05'],
    ['a year typed 0202 on another device or an earlier build', '0202-07-20', '0202-07-24'],
    ['a year typed 2202', '2202-07-20', '2202-07-24'],
    ['a year typed 9999', '9999-12-27', '9999-12-31'],
    ['kept as month/day/year text', '5/1/0202', '5/7/0202'],
  ])('%s: a change to something else is ready to review (was: "Needs correction", both dates named)', (_name, startDate, finishDate) => {
    const old = task('old', { taskName: 'Old task', startDate, finishDate });
    const { result, steps } = countingDaySteps(2_000, () => buildVitruviusScheduleChangeScenario({
      items: [pour, old],
      itemId: 'old',
      draft: { ...asTheEditorShows(old), durationDays: 5, status: 'In Progress', percentComplete: 10 },
    }));
    expect(result.safety).toEqual({ safeToApply: true, issues: [] });
    expect(steps).toBeLessThan(100);
  });

  it('a milestone stored with such a date and no finish date', () => {
    const handover = task('handover', { taskName: 'Handover', startDate: '0202-07-20', finishDate: '', durationDays: 0, isMilestone: true });
    const result = buildVitruviusScheduleChangeScenario({
      items: [pour, handover],
      itemId: 'handover',
      draft: { ...asTheEditorShows(handover), durationDays: 0, isMilestone: true, percentComplete: 0 },
    });
    expect(result.safety).toEqual({ safeToApply: true, issues: [] });
  });

  it('one stored date left alone and the other corrected: only what was changed is looked at', () => {
    const old = task('old', { taskName: 'Old task', startDate: '1999-11-01', finishDate: '1999-11-05' });
    const result = buildVitruviusScheduleChangeScenario({
      items: [pour, old],
      itemId: 'old',
      draft: { startDate: '1999-11-01', finishDate: '2000-01-07', durationDays: 5 },
    });
    expect(result.safety).toEqual({ safeToApply: true, issues: [] });
  });

  it('with tasks before and after it, the preview still calculates and stays short', () => {
    const old = task('old', {
      taskName: 'Old task', startDate: '0202-07-20', finishDate: '0202-07-24',
      dependencies: [{ predecessorItemId: 'pour', type: 'FS', lagDays: 0 }],
    });
    const after = task('after', {
      taskName: 'After it', startDate: '2026-08-03', finishDate: '2026-08-05', durationDays: 3,
      dependencies: [{ predecessorItemId: 'old', type: 'FS', lagDays: 0 }],
    });
    const { result, steps } = countingDaySteps(2_000, () => buildVitruviusScheduleChangeScenario({
      items: [pour, old, after],
      itemId: 'old',
      draft: { ...asTheEditorShows(old), durationDays: 5, status: 'In Progress' },
    }));
    expect(result.safety).toEqual({ safeToApply: true, issues: [] });
    expect(steps).toBeLessThan(100);
  });
});

describe('L1 guards: a date the draft does change is still judged', () => {
  const old = task('old', { taskName: 'Old task', startDate: '1999-11-01', finishDate: '1999-11-05' });

  it.each([
    ['startDate', '1998-01-05', 'Start date must be a real date from 2000 through 2100.'],
    ['startDate', '0202-07-20', 'Start date must be a real date from 2000 through 2100.'],
    ['finishDate', '2202-07-24', 'Finish date must be a real date from 2000 through 2100.'],
  ] as const)('%s changed to %s is refused, and only that date is named', (field, value, message) => {
    const result = buildVitruviusScheduleChangeScenario({
      items: [pour, old],
      itemId: 'old',
      draft: { ...asTheEditorShows(old), [field]: value },
    });
    expect(result.safety).toEqual({
      safeToApply: false,
      issues: [{ code: 'date_out_of_range', itemId: 'old', message }],
    });
  });

  it('a supported date changed to an unsupported one is refused as before', () => {
    const result = buildVitruviusScheduleChangeScenario({
      items: [pour, task('frame', { startDate: '2026-07-27', finishDate: '2026-07-29', durationDays: 3 })],
      itemId: 'frame',
      draft: { startDate: '0202-10-05' },
    });
    expect(result.safety.issues).toEqual([
      { code: 'date_out_of_range', itemId: 'frame', message: 'Start date must be a real date from 2000 through 2100.' },
    ]);
  });
});
