/**
 * Build 232 round, item 5: the one rule for counting a schedule's days (the
 * owner's answer to question 41, 13 Oct 2026). services/ScheduleWorkingDays.ts
 * says which days are working days (Monday to Friday) and how long a task is;
 * the critical path and rescheduling both ask it, and neither counts days of
 * its own any more.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  isScheduleWorkingDay,
  scheduleTaskLengthInWorkingDays,
  scheduleWorkingDaysFromThrough,
} from '../../services/ScheduleWorkingDays';
import { analyzeVitruviusCriticalPath } from '../../services/VitruviusScheduleAnalytics';
import { previewVitruviusFinishToStartSchedule } from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

jest.mock('../../services/ScheduleWorkingDays', () => {
  const actual = jest.requireActual('../../services/ScheduleWorkingDays');
  return { ...actual, scheduleTaskLengthInWorkingDays: jest.fn(actual.scheduleTaskLengthInWorkingDays) };
});
const lengthAsked = jest.mocked(scheduleTaskLengthInWorkingDays);

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Monday to Friday counted out one day at a time, to check the rule against. */
function countedOut(start: Date, finish: Date) {
  let count = 0;
  for (let at = start.getTime(); at <= finish.getTime(); at += 86_400_000) {
    const weekday = new Date(at).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: 'Harbor Lofts',
    projectName: 'Harbor Lofts',
    locationName: 'Level 1',
    taskName: id,
    startDate: '',
    finishDate: '',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: null,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => lengthAsked.mockClear());

describe('which days are working days', () => {
  it('Monday to Friday are; Saturday and Sunday are not', () => {
    // Mon 12 Oct 2026 through Sun 18 Oct 2026.
    expect(['12', '13', '14', '15', '16', '17', '18'].map(date => isScheduleWorkingDay(day(`2026-10-${date}`))))
      .toEqual([true, true, true, true, true, false, false]);
  });
});

describe('the working days from one day through another, both counted', () => {
  it.each([
    ['a Friday to the Monday', '2026-10-09', '2026-10-12', 2],
    ['a Friday to the Monday after next', '2026-10-09', '2026-10-19', 7],
    ['a Saturday to the Tuesday', '2026-10-10', '2026-10-13', 2],
    ['a Thursday to the Sunday', '2026-10-08', '2026-10-11', 2],
    ['a Saturday and its Sunday', '2026-10-10', '2026-10-11', 0],
    ['one Saturday', '2026-10-10', '2026-10-10', 0],
    ['one Monday', '2026-10-12', '2026-10-12', 1],
    ['Monday to Friday', '2026-10-12', '2026-10-16', 5],
    ['the finish before the start', '2026-10-16', '2026-10-12', 0],
  ])('%s', (_what, start, finish, days) => {
    expect(scheduleWorkingDaysFromThrough(day(start), day(finish))).toBe(days);
  });

  it('agrees with counting the days out one at a time, from every day of the week, for every length up to 60 days', () => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const start = new Date(day('2026-10-11').getTime() + weekday * 86_400_000);
      for (let length = 0; length <= 60; length += 1) {
        const finish = new Date(start.getTime() + length * 86_400_000);
        expect([weekday, length, scheduleWorkingDaysFromThrough(start, finish)]).toEqual([weekday, length, countedOut(start, finish)]);
      }
    }
  });

  it('a hundred years is worked out, not counted out day by day', () => {
    const start = day('2000-01-03');
    const finish = day('2100-12-31');
    const expected = countedOut(start, finish);
    const stepped = jest.spyOn(Date.prototype, 'setUTCDate');
    try {
      expect(scheduleWorkingDaysFromThrough(start, finish)).toBe(expected);
      expect(stepped).not.toHaveBeenCalled();
    } finally {
      stepped.mockRestore();
    }
  });
});

describe('a task\'s length', () => {
  const friday = day('2026-10-09');
  const monday = day('2026-10-12');

  it('a milestone has none', () => {
    expect(scheduleTaskLengthInWorkingDays({ isMilestone: true, durationDays: 5 }, friday, monday)).toBe(0);
  });

  it('a length typed in is used as typed, to the nearest whole day and never less than one', () => {
    expect([3, 1, 2.5, 0.4, 2_600].map(durationDays => scheduleTaskLengthInWorkingDays({ durationDays }, friday, monday)))
      .toEqual([3, 1, 3, 1, 2_600]);
  });

  it('with nothing typed, its dates give it: the working days from its start through its finish, never less than one', () => {
    expect([0, null, undefined, Number.NaN, -4].map(durationDays => scheduleTaskLengthInWorkingDays({ durationDays }, friday, monday)))
      .toEqual([2, 2, 2, 2, 2]);
    expect(scheduleTaskLengthInWorkingDays({ durationDays: null }, day('2026-10-10'), day('2026-10-11'))).toBe(1);
  });

  it('with no dates to go on it is one day', () => {
    expect(scheduleTaskLengthInWorkingDays({ durationDays: null }, null, monday)).toBe(1);
    expect(scheduleTaskLengthInWorkingDays({ durationDays: null }, friday, null)).toBe(1);
    expect(scheduleTaskLengthInWorkingDays({ durationDays: null }, monday, friday)).toBe(1);
  });
});

describe('the critical path and rescheduling both ask the one rule', () => {
  const fridayToMonday = task('inspect', { startDate: '2026-10-09', finishDate: '2026-10-12' });

  it('the critical path asks it for every task, and uses its answer', () => {
    lengthAsked.mockReturnValue(40);
    const analysis = analyzeVitruviusCriticalPath([
      fridayToMonday,
      task('pour', { durationDays: 1, dependencies: [{ predecessorItemId: 'inspect', type: 'FS' }] }),
    ]);
    lengthAsked.mockReset();
    lengthAsked.mockImplementation(jest.requireActual('../../services/ScheduleWorkingDays').scheduleTaskLengthInWorkingDays);
    expect(analysis.items.map(item => [item.itemId, item.durationDays])).toEqual([['inspect', 40], ['pour', 40]]);
    expect(analysis.projectDurationDays).toEqual({ 'Harbor Lofts': 80 });
  });

  it('rescheduling asks it for the task it moves, and uses its answer', () => {
    lengthAsked.mockReturnValueOnce(4);
    const preview = previewVitruviusFinishToStartSchedule([
      task('before', { startDate: '2026-10-23', finishDate: '2026-10-23', durationDays: 1 }),
      { ...fridayToMonday, dependencies: [{ predecessorItemId: 'before', type: 'FS' }] },
    ]);
    expect(lengthAsked).toHaveBeenCalledTimes(1);
    expect(lengthAsked.mock.calls[0].slice(1)).toEqual([day('2026-10-09'), day('2026-10-12')]);
    // Monday 26 Oct and the three working days after it.
    expect(preview.items.find(item => item.id === 'inspect')).toMatchObject({ startDate: '2026-10-26', finishDate: '2026-10-29', durationDays: 4 });
  });

  it('neither keeps a day count of its own', () => {
    const source = (file: string) => readFileSync(join(__dirname, '..', '..', 'services', file), 'utf8');
    const analytics = source('VitruviusScheduleAnalytics.ts');
    const engine = source('VitruviusScheduleEngine.ts');
    // The weekday test lives in the one rule only.
    expect(analytics).not.toMatch(/getUTCDay|getDay\(/);
    expect(engine).not.toMatch(/getUTCDay|getDay\(/);
    expect(source('ScheduleWorkingDays.ts').match(/getUTCDay\(\)/g)).toHaveLength(1);
    // The critical path's own calendar-day length is gone.
    expect(analytics).not.toMatch(/calendarDaysBetween\(start, finish\)/);
    expect(engine).not.toMatch(/function workingDaySpan/);
  });
});

describe('the limits come before any counting', () => {
  it('the critical path of a task a hundred years long, with no length typed in, takes no day-by-day steps', () => {
    const stepped = jest.spyOn(Date.prototype, 'setUTCDate');
    try {
      const analysis = analyzeVitruviusCriticalPath([
        task('warranty', { startDate: '2000-01-03', finishDate: '2100-12-31' }),
        task('close', { durationDays: 1, dependencies: [{ predecessorItemId: 'warranty', type: 'FS' }] }),
      ]);
      expect(stepped).not.toHaveBeenCalled();
      expect(analysis.items.find(item => item.itemId === 'warranty')!.durationDays).toBe(countedOut(day('2000-01-03'), day('2100-12-31')));
    } finally {
      stepped.mockRestore();
    }
  });

  it('rescheduling still refuses a task longer than 2,600 working days, counted from its dates, and leaves it as it was', () => {
    // 3 Aug 2026 through 21 Jul 2036 is 2,601 working days: one over.
    const start = '2026-08-03';
    const finish = '2036-07-21';
    expect(countedOut(day(start), day(finish))).toBe(2_601);
    const items = [
      task('before', { startDate: '2026-10-23', finishDate: '2026-10-23', durationDays: 1 }),
      task('warranty', { taskName: 'Warranty period', startDate: start, finishDate: finish, dependencies: [{ predecessorItemId: 'before', type: 'FS' }] }),
    ];
    const preview = previewVitruviusFinishToStartSchedule(items);
    expect(preview.changes).toEqual([]);
    expect(preview.issues.map(issue => [issue.code, issue.severity, issue.itemId])).toEqual([['unsupported_task_duration', 'warning', 'warranty']]);
    // One day shorter is exactly 2,600 and is moved.
    const atTheLimit = previewVitruviusFinishToStartSchedule([items[0], { ...items[1], finishDate: '2036-07-18' }]);
    expect(atTheLimit.issues).toEqual([]);
    expect(atTheLimit.items.find(item => item.id === 'warranty')).toMatchObject({ startDate: '2026-10-26', durationDays: 2_600 });
  });
});
