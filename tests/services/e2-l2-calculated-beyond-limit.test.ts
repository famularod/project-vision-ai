/**
 * Review pass 1, L2 (caused by "Desktop schedule: a duration, lag or date
 * beyond what the schedule supports is refused ..."): a line longer than
 * 2,600 working days that has a predecessor (a long warranty or lease).
 * When its predecessor pushed it, the calculation reported an error for it,
 * and one error made the whole calculation unsafe: the predecessor's slip
 * could not be saved in the editor, and "apply calculated dates" was refused
 * for every task on the page.
 *
 * A value he did not type must not block saving other things. A result the
 * calculation cannot give (a line too long to walk, a task that would land
 * outside 2000 through 2100) is now a note about that one task: its dates
 * are left as they are, the note says what it needs, and everything else is
 * calculated and can be applied.
 */
import { analyzeVitruviusSchedule } from '../../services/VitruviusScheduleAnalytics';
import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import {
  applyVitruviusSchedulePreview,
  previewVitruviusFinishToStartSchedule,
} from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: 'Lot 9',
    projectName: 'Lot 9',
    locationName: 'North Pad',
    taskName: id,
    startDate: '2026-08-03',
    finishDate: '2026-08-07',
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

const after = (predecessorItemId: string) => [{ predecessorItemId, type: 'FS' as const, lagDays: 0 }];

const closeout = task('closeout', { taskName: 'Substantial completion' });
/** Twelve years of weekdays: a real line, longer than the calculation walks. */
const warranty = (overrides: Partial<ScheduleItem> = {}) => task('warranty', {
  taskName: 'Roof warranty period', startDate: '2026-08-03', finishDate: '2038-07-19', durationDays: 3_120,
  dependencies: after('closeout'), ...overrides,
});
const punch = task('punch', {
  taskName: 'Punch list', startDate: '2026-08-03', finishDate: '2026-08-05', durationDays: 3, dependencies: after('closeout'),
});

const TOO_LONG =
  'Roof warranty period is longer than the 2,600 working days the schedule supports, so its dates were not calculated. ' +
  'Its predecessors now put its start on or after 2026-08-10: move it yourself. The other date changes can still be applied.';

/** Counts every one-day step of a date while `work` runs, and stops it past `limit`. */
function countingDaySteps<T>(limit: number, work: () => T) {
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

describe('L2: a line too long to calculate is a note about that line, and the rest is calculated', () => {
  it('the long line is left as it is and named; the task beside it still moves and can be applied (was: nothing could be applied)', () => {
    const items = [closeout, warranty(), punch];
    const preview = previewVitruviusFinishToStartSchedule(items);
    expect(preview.safeToApply).toBe(true);
    expect(preview.changes.map(change => [change.taskName, change.nextStartDate, change.nextFinishDate]))
      .toEqual([['Punch list', '2026-08-10', '2026-08-12']]);
    expect(preview.issues).toEqual([{
      code: 'unsupported_task_duration',
      severity: 'warning',
      itemId: 'warranty',
      message: TOO_LONG,
    }]);
    const applied = applyVitruviusSchedulePreview(preview);
    expect(applied.find(item => item.id === 'punch')).toMatchObject({ startDate: '2026-08-10', finishDate: '2026-08-12' });
    expect(applied.find(item => item.id === 'warranty')).toMatchObject({ startDate: '2026-08-03', finishDate: '2038-07-19', durationDays: 3_120 });
  });

  it.each([2_601, 3_120, 1_000_000_000, 1e21])('a stored duration of %p working days is still not walked day by day', durationDays => {
    const items = [closeout, warranty({ durationDays }), punch];
    const { result, steps } = countingDaySteps(10_000, () => previewVitruviusFinishToStartSchedule(items));
    expect(steps).toBeLessThan(50);
    expect(result.safeToApply).toBe(true);
    expect(result.issues.map(issue => [issue.code, issue.severity, issue.itemId]))
      .toEqual([['unsupported_task_duration', 'warning', 'warranty']]);
    expect(result.items.find(item => item.id === 'warranty')).toMatchObject({ startDate: '2026-08-03', durationDays });
  });

  it('a task after the long line is worked out from the long line\'s dates as they stand', () => {
    const walk = task('walk', {
      taskName: 'Warranty walk', startDate: '2038-07-20', finishDate: '2038-07-20', durationDays: 1, dependencies: after('warranty'),
    });
    const preview = previewVitruviusFinishToStartSchedule([closeout, warranty(), walk]);
    expect(preview.safeToApply).toBe(true);
    expect(preview.changes).toEqual([]);
  });

  it('a task that would be moved outside 2000 through 2100 is left as it is and named, with where it would have gone', () => {
    const old = task('old', { taskName: 'Old survey', startDate: '2202-07-20', finishDate: '2202-07-24' });
    const stake = task('stake', {
      taskName: 'Stake out', startDate: '2026-08-10', finishDate: '2026-08-12', durationDays: 3, dependencies: after('old'),
    });
    const preview = previewVitruviusFinishToStartSchedule([old, stake, closeout, punch]);
    expect(preview.safeToApply).toBe(true);
    expect(preview.changes.map(change => change.taskName)).toEqual(['Punch list']);
    expect(preview.issues).toEqual([{
      code: 'invalid_task_date',
      severity: 'warning',
      itemId: 'stake',
      message:
        'Stake out would be moved to 2202-07-26, outside 2000 through 2100, so its dates were left as they are. ' +
        "Correct its predecessors' dates. The other date changes can still be applied.",
    }]);
    expect(preview.items.find(item => item.id === 'stake')).toMatchObject({ startDate: '2026-08-10', finishDate: '2026-08-12' });
  });

  it('the whole-page analysis says the same: safe to apply, one change, one note', () => {
    const analysis = analyzeVitruviusSchedule([closeout, warranty(), punch]);
    expect(analysis.impactPreview.safeToApply).toBe(true);
    expect(analysis.impactPreview.changes).toHaveLength(1);
    expect(analysis.impactPreview.issues.map(issue => issue.message)).toEqual([TOO_LONG]);
  });
});

describe('L2: the change preview for the task before the long line', () => {
  /** In step with its predecessor, until the predecessor slips a week. */
  const inStep = warranty({ startDate: '2026-08-10', finishDate: '2038-07-23' });

  it('the slip is ready to review and the note is listed, marked as not stopping the save (was: "Needs correction")', () => {
    const scenario = buildVitruviusScheduleChangeScenario({
      items: [closeout, inStep, punch],
      itemId: 'closeout',
      draft: { finishDate: '2026-08-14', durationDays: 10 },
    });
    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.safety.issues).toEqual([{
      code: 'unsupported_task_duration',
      itemId: 'warranty',
      severity: 'warning',
      message: TOO_LONG.replace('2026-08-10', '2026-08-17'),
    }]);
    expect(scenario.downstreamChanges.map(change => [change.taskName, change.nextStartDate]))
      .toEqual([['Punch list', '2026-08-17']]);
    expect(scenario.projectFinish.after).toBe('2038-07-23');
  });
});

describe('L2 guards: a real fault in the plan still stops the calculation from being applied', () => {
  it('a missing predecessor, with the long line beside it', () => {
    const orphan = task('orphan', { taskName: 'Orphan', dependencies: after('gone') });
    const preview = previewVitruviusFinishToStartSchedule([closeout, warranty(), orphan]);
    expect(preview.safeToApply).toBe(false);
    expect(preview.issues.map(issue => [issue.code, issue.severity])).toEqual([
      ['missing_predecessor', 'error'],
      ['unsupported_task_duration', 'warning'],
    ]);
    expect(() => applyVitruviusSchedulePreview(preview)).toThrow('cannot be applied');
  });

  it('a completed task that would have to move', () => {
    const done = task('done', { taskName: 'Done early', status: 'Complete', percentComplete: 100, startDate: '2026-08-03', dependencies: after('closeout') });
    const preview = previewVitruviusFinishToStartSchedule([closeout, done]);
    expect(preview.safeToApply).toBe(false);
    expect(preview.issues.map(issue => [issue.code, issue.severity])).toEqual([['completed_task_locked', 'error']]);
  });

  it('a circle of links', () => {
    const a = task('a', { dependencies: after('b') });
    const b = task('b', { dependencies: after('a') });
    const scenario = buildVitruviusScheduleChangeScenario({ items: [a, b], itemId: 'a', draft: { status: 'In Progress' } });
    expect(scenario.safety.safeToApply).toBe(false);
  });

  it('a duration he types beyond the limit is still refused outright in the change preview', () => {
    const scenario = buildVitruviusScheduleChangeScenario({
      items: [closeout, punch],
      itemId: 'punch',
      draft: { durationDays: 3_120 },
    });
    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues.map(issue => issue.code)).toEqual(['unsupported_duration']);
  });

  it('a line at the limit is calculated and moved as before', () => {
    const preview = previewVitruviusFinishToStartSchedule([closeout, warranty({ durationDays: 2_600 })]);
    expect(preview.issues).toEqual([]);
    expect(preview.changes.map(change => change.nextStartDate)).toEqual(['2026-08-10']);
  });
});
