/**
 * Independent review R08 (Build 229), Build 231 E1 item 10: the desktop task
 * editor accepted an absurd duration (a billion working days) and the
 * schedule preview then counted them out one day at a time and did not
 * finish. Limits are now checked before anything is calculated, in the
 * builder, the change preview and the calculation itself (so a stored or
 * imported value is refused too), and dates outside 2000 through 2100 are
 * refused.
 */
import {
  buildDAVEWebScheduleItem,
  DAVEWebTaskValidationError,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import {
  SCHEDULE_DURATION_RANGE_TEXT,
  SCHEDULE_LAG_RANGE_TEXT,
  SCHEDULE_MAX_DURATION_WORKING_DAYS,
  SCHEDULE_MAX_LAG_WORKING_DAYS,
  scheduleDateRangeText,
  scheduleDayIsSupported,
  scheduleDurationBoxProblem,
  scheduleDurationIsSupported,
  scheduleLagBoxProblem,
} from '../../services/ScheduleInputLimits';
import { analyzeVitruviusSchedule } from '../../services/VitruviusScheduleAnalytics';
import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import { previewVitruviusFinishToStartSchedule } from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

// The real analytics, counted, so a refused draft can be shown to calculate nothing.
jest.mock('../../services/VitruviusScheduleAnalytics', () => {
  const actual = jest.requireActual('../../services/VitruviusScheduleAnalytics');
  return { ...actual, analyzeVitruviusSchedule: jest.fn(actual.analyzeVitruviusSchedule) };
});
const analyze = jest.mocked(analyzeVitruviusSchedule);

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-20',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 1,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * Runs `work` with every one-day step of a date counted, and stops it with
 * an error past `limit` steps: on Build 229 a billion-day duration took a
 * billion of them, which a test cannot wait for.
 */
function countingDaySteps<T>(limit: number, work: () => T): { result: T; steps: number } {
  const real = Date.prototype.setUTCDate;
  let steps = 0;
  const spy = jest.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (this: Date, day: number) {
    steps += 1;
    if (steps > limit) throw new Error(`More than ${limit} one-day steps: the calculation is not bounded.`);
    return real.call(this, day);
  });
  try {
    return { result: work(), steps };
  } finally {
    spy.mockRestore();
  }
}

const weekdaysFromTo = (start: string, finish: string) => {
  let count = 0;
  for (const day = new Date(`${start}T00:00:00Z`); day.getTime() <= new Date(`${finish}T00:00:00Z`).getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) count += 1;
  }
  return count;
};

beforeEach(() => analyze.mockClear());

describe('R08: the limits and their sentences', () => {
  it('a duration is a plain number of working days from 0 to 2,600, or blank', () => {
    expect(SCHEDULE_MAX_DURATION_WORKING_DAYS).toBe(2_600);
    expect(SCHEDULE_DURATION_RANGE_TEXT).toBe('Enter the duration in working days as a number from 0 to 2,600, or leave it blank.');
    for (const accepted of ['', '   ', '0', '1', '5', '2.5', '2600', ' 2600 ']) {
      expect([accepted, scheduleDurationBoxProblem(accepted)]).toEqual([accepted, null]);
    }
    for (const refused of ['2601', '1000000000', '1e9', '1E3', '9'.repeat(400), '-1', 'abc', '5 days', 'Infinity', 'NaN', '0x10']) {
      expect([refused, scheduleDurationBoxProblem(refused)]).toEqual([refused, SCHEDULE_DURATION_RANGE_TEXT]);
    }
  });

  it('a lag is a plain number of working days from 0 to 365, or blank', () => {
    expect(SCHEDULE_MAX_LAG_WORKING_DAYS).toBe(365);
    for (const accepted of ['', '0', '10', '365']) expect(scheduleLagBoxProblem(accepted)).toBeNull();
    for (const refused of ['366', '1000000000', '1e2', '-1', 'two']) expect(scheduleLagBoxProblem(refused)).toBe(SCHEDULE_LAG_RANGE_TEXT);
  });

  it('a stored duration is supported up to the limit; not set is supported', () => {
    for (const supported of [null, undefined, 0, 1, 2_600, 2_600.4]) expect(scheduleDurationIsSupported(supported)).toBe(true);
    for (const unsupported of [2_600.5, 2_601, 1_000_000_000, 1e21, Number.MAX_VALUE, Infinity, NaN, -1, '5']) {
      expect([unsupported, scheduleDurationIsSupported(unsupported)]).toEqual([unsupported, false]);
    }
  });

  it('a date is supported from 2000 through 2100', () => {
    expect(scheduleDateRangeText('Start date')).toBe('Start date must be a real date from 2000 through 2100.');
    for (const supported of ['2000-01-01', '2026-10-06', '2100-12-31']) expect(scheduleDayIsSupported(supported)).toBe(true);
    for (const unsupported of ['1999-12-31', '0202-10-05', '2101-01-01', '9999-12-31']) expect(scheduleDayIsSupported(unsupported)).toBe(false);
    expect(scheduleDayIsSupported(new Date('2026-10-06T00:00:00Z'))).toBe(true);
    expect(scheduleDayIsSupported(new Date(NaN))).toBe(false);
  });
});

describe('R08: the calculation refuses a stored or imported duration beyond the limit before walking it', () => {
  const predecessor = task('pour', { taskName: 'Pour slab', startDate: '2026-07-20', finishDate: '2026-07-24', durationDays: 5 });
  const successor = (overrides: Partial<ScheduleItem>) => task('frame', {
    taskName: 'Frame walls',
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
    dependencies: [{ predecessorItemId: 'pour', type: 'FS' }],
    ...overrides,
  });

  it.each([
    2_601,
    1_000_000,
    1_000_000_000,
    1e21,
    Number.MAX_VALUE,
  ])('a duration of %p working days is refused promptly, and the task is left as it was', durationDays => {
    const items = [predecessor, successor({ durationDays })];
    const before = JSON.stringify(items);
    const { result, steps } = countingDaySteps(10_000, () => previewVitruviusFinishToStartSchedule(items));

    expect(steps).toBeLessThan(50);
    expect(result.safeToApply).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.issues).toEqual([{
      code: 'unsupported_task_duration',
      severity: 'error',
      itemId: 'frame',
      message: 'Frame walls is longer than the 2,600 working days the schedule supports. Correct its duration or dates before its dates can be calculated.',
    }]);
    expect(result.items.find(item => item.id === 'frame')).toMatchObject({ startDate: '2026-07-20', finishDate: '2026-07-21', durationDays });
    expect(JSON.stringify(items)).toBe(before);
  });

  it('dates centuries apart with no duration are not counted out either', () => {
    const items = [predecessor, successor({ durationDays: null, startDate: '2026-07-20', finishDate: '9999-12-31' })];
    const { result, steps } = countingDaySteps(10_000, () => previewVitruviusFinishToStartSchedule(items));
    expect(steps).toBeLessThan(50);
    expect(result.issues.map(issue => issue.code)).toEqual(['unsupported_task_duration']);
    expect(result.changes).toEqual([]);
  });

  it('a predecessor finishing outside 2000 through 2100 moves nothing (was: a start in the year 10000)', () => {
    const items = [task('pour', { taskName: 'Pour slab', finishDate: '9999-12-30' }), successor({ durationDays: 3 })];
    const { result } = countingDaySteps(10_000, () => previewVitruviusFinishToStartSchedule(items));
    expect(result.changes).toEqual([]);
    expect(result.safeToApply).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({
      code: 'invalid_task_date',
      itemId: 'frame',
      message: "Frame walls would be moved outside 2000 through 2100. Correct its predecessors' dates before it can be calculated.",
    })]);
  });

  // Guards: these already hold on 594a71d.
  it('the supported maximum is calculated: 2,600 working days from the day after the predecessor', () => {
    const items = [predecessor, successor({ durationDays: SCHEDULE_MAX_DURATION_WORKING_DAYS })];
    const { result, steps } = countingDaySteps(10_000, () => previewVitruviusFinishToStartSchedule(items));
    expect(result.safeToApply).toBe(true);
    expect(result.changes).toHaveLength(1);
    const { nextStartDate, nextFinishDate } = result.changes[0];
    expect(nextStartDate).toBe('2026-07-27');
    expect(weekdaysFromTo(nextStartDate, nextFinishDate)).toBe(2_600);
    expect(nextFinishDate).toBe('2036-07-11');
    expect(steps).toBeLessThan(4_000);
  });

  it('an ordinary duration is calculated as before', () => {
    const { result } = countingDaySteps(1_000, () => previewVitruviusFinishToStartSchedule([predecessor, successor({ durationDays: 3 })]));
    expect(result.changes).toEqual([expect.objectContaining({ nextStartDate: '2026-07-27', nextFinishDate: '2026-07-29' })]);
  });
});

describe('R08: the change preview checks the draft before it calculates anything', () => {
  const items = [
    task('pour', { taskName: 'Pour slab', startDate: '2026-07-20', finishDate: '2026-07-24', durationDays: 5 }),
    task('frame', { taskName: 'Frame walls', startDate: '2026-07-27', finishDate: '2026-07-29', durationDays: 3, dependencies: [{ predecessorItemId: 'pour', type: 'FS' }] }),
    task('roof', { taskName: 'Roof', startDate: '2026-07-30', finishDate: '2026-07-31', durationDays: 2, dependencies: [{ predecessorItemId: 'frame', type: 'FS' }] }),
  ];
  const preview = (draft: Parameters<typeof buildVitruviusScheduleChangeScenario>[0]['draft']) =>
    countingDaySteps(10_000, () => buildVitruviusScheduleChangeScenario({ items, itemId: 'frame', draft }));

  it.each([2_601, 1_000_000_000, 1e21, Infinity, NaN, -1])('a duration of %p is refused with the plain sentence and nothing is calculated', durationDays => {
    const before = JSON.stringify(items);
    const { result, steps } = preview({ durationDays });
    expect(analyze).not.toHaveBeenCalled();
    expect(steps).toBe(0);
    expect(result.safety).toEqual({
      safeToApply: false,
      issues: [{ code: 'unsupported_duration', itemId: 'frame', message: SCHEDULE_DURATION_RANGE_TEXT }],
    });
    expect(result.proposedProjectItems).toEqual([]);
    expect(result.downstreamChanges).toEqual([]);
    expect(result.projectFinish).toEqual({ before: null, after: null, deltaCalendarDays: null });
    expect(JSON.stringify(items)).toBe(before);
  });

  it.each([
    ['startDate', '0202-10-05', 'Start date must be a real date from 2000 through 2100.'],
    ['startDate', '1999-12-31', 'Start date must be a real date from 2000 through 2100.'],
    ['finishDate', '9999-12-31', 'Finish date must be a real date from 2000 through 2100.'],
    ['finishDate', '2101-01-01', 'Finish date must be a real date from 2000 through 2100.'],
  ] as const)('%s %s is refused with the plain sentence and nothing is calculated', (field, value, message) => {
    const { result, steps } = preview({ [field]: value });
    expect(analyze).not.toHaveBeenCalled();
    expect(steps).toBe(0);
    expect(result.safety.safeToApply).toBe(false);
    expect(result.safety.issues).toEqual([{ code: 'date_out_of_range', itemId: 'frame', message }]);
  });

  // Guards: these already hold on 594a71d.
  it('the supported maximum is previewed: the task after it moves', () => {
    const { result } = preview({ durationDays: SCHEDULE_MAX_DURATION_WORKING_DAYS, finishDate: '2036-07-11' });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.safety).toEqual({ safeToApply: true, issues: [] });
    expect(result.downstreamChanges).toEqual([expect.objectContaining({ itemId: 'roof', nextStartDate: '2036-07-14' })]);
  });

  it('a date that is not a date is still reported after the calculation, as before', () => {
    const { result } = preview({ startDate: 'next week' });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.safety.issues.map(issue => issue.code)).toContain('invalid_start_date');
  });
});

describe('R08: the desktop task builder refuses them before it builds a task', () => {
  const DRAFT: DAVEWebTaskDraft = {
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    taskName: 'Frame walls',
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    startDate: '07/27/2026',
    finishDate: '07/29/2026',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activityMessage: '',
  };
  const build = (draft: Partial<DAVEWebTaskDraft>, current: DAVEWebScheduleItem | null = null) => buildDAVEWebScheduleItem({
    draft: { ...DRAFT, ...draft },
    current,
    id: 'frame',
    now: '2026-10-06T18:00:00.000Z',
    actor: 'pm@example.com',
  });
  const refusal = (work: () => unknown) => {
    try {
      work();
    } catch (error) {
      return error instanceof DAVEWebTaskValidationError ? error.message : `not a validation error: ${String(error)}`;
    }
    return 'built';
  };

  it.each([2_601, 1_000_000_000, '1000000000', '1e9', 1e21, Infinity, -1, 'abc'])('a duration of %p is refused with the plain sentence (was built)', durationDays => {
    expect(refusal(() => build({ durationDays }))).toBe(SCHEDULE_DURATION_RANGE_TEXT);
  });

  it.each([
    ['startDate', '10/05/0202', 'Start date must be a real date from 2000 through 2100.'],
    ['finishDate', '9999-12-31', 'Finish date must be a real date from 2000 through 2100.'],
    ['baselineStartDate', '12/31/1999', 'Baseline start must be a real date from 2000 through 2100.'],
    ['baselineFinishDate', '2101-01-01', 'Baseline finish must be a real date from 2000 through 2100.'],
  ] as const)('%s changed to %s is refused with the plain sentence (was built)', (field, value, message) => {
    expect(refusal(() => build({ [field]: value }))).toBe(message);
  });

  // Guards: these already hold on 594a71d.
  it('the supported maximum, a blank duration and ordinary dates are built', () => {
    expect(build({ durationDays: 2_600 }).durationDays).toBe(2_600);
    expect(build({ durationDays: '2600' }).durationDays).toBe(2_600);
    expect(build({ durationDays: '2.5' }).durationDays).toBe(3);
    expect(build({ durationDays: '' }).durationDays).toBeNull();
    expect(build({ durationDays: null }).durationDays).toBeNull();
    expect(build({}).durationDays).toBeNull();
    expect(build({ startDate: '01/01/2000', finishDate: '12/31/2100' })).toMatchObject({ startDate: '01/01/2000', finishDate: '12/31/2100' });
  });

  it('a stored date outside the range that the save leaves alone, and text that names no day, are kept', () => {
    const stored = { ...build({}), startDate: '12/31/1999', finishDate: 'TBD', durationDays: 7 } as DAVEWebScheduleItem;
    const saved = build({ startDate: '1999-12-31', finishDate: 'TBD', notes: 'Renamed only' }, stored);
    expect(saved).toMatchObject({ startDate: '1999-12-31', finishDate: 'TBD', durationDays: 7, notes: 'Renamed only' });
  });
});
