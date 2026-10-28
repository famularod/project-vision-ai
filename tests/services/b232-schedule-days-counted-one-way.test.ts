/**
 * Build 232 round, item 5: one rule for counting days (the owner's answer to
 * question 41, 13 Oct 2026: "make skipping weekends teh defalut but teh optn
 * to change ti include weekends").
 *
 * A task with a start and a finish date and no length typed in had its
 * length worked out in two places that disagreed. The critical path (the
 * computer's Schedule page and Lookahead tab, the change preview in the task
 * editor, and the "Critical" column of the lookahead file the phone shares)
 * counted every calendar day; rescheduling counted Monday to Friday. A task
 * from a Friday to the Monday was 4 days in one and 2 in the other.
 *
 * Now both count working days, Monday to Friday. What must NOT move is
 * pinned here too: a length he typed, a lag, and every date rescheduling
 * gives (those were working days already).
 *
 * October 2026: Fri 9, Sat 10, Sun 11, Mon 12 ... Fri 16, Sat 17, Sun 18,
 * Mon 19 ... Fri 23, Mon 26, Tue 27 ... Fri 30, Mon 2 Nov, Tue 3 Nov.
 */
import { analyzeVitruviusCriticalPath, analyzeVitruviusSchedule } from '../../services/VitruviusScheduleAnalytics';
import { buildVitruviusLookahead, vitruviusLookaheadCsv } from '../../services/VitruviusLookahead';
import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import { previewVitruviusFinishToStartSchedule } from '../../services/VitruviusScheduleEngine';
import type { ScheduleDependency, ScheduleItem } from '../../types';

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

const after = (...ids: string[]): ScheduleDependency[] => ids.map(id => ({ predecessorItemId: id, type: 'FS' as const }));

/** The task's length where the critical path and float are worked out. */
function lengthOnTheCriticalPath(overrides: Partial<ScheduleItem>): number {
  const analysis = analyzeVitruviusCriticalPath([
    task('it', overrides),
    task('handover', { isMilestone: true, durationDays: 0, dependencies: after('it') }),
  ]);
  expect(analysis.safe).toBe(true);
  return analysis.items.find(item => item.itemId === 'it')!.durationDays;
}

/**
 * The task's length where rescheduling is worked out: a task before it
 * finishes on Friday 23 Oct, so it must start on Monday 26 Oct, and its new
 * finish and saved length show what rescheduling took its length to be.
 */
function whenRescheduled(overrides: Partial<ScheduleItem>) {
  const preview = previewVitruviusFinishToStartSchedule([
    task('before', { startDate: '2026-10-23', finishDate: '2026-10-23', durationDays: 1 }),
    task('it', { ...overrides, dependencies: after('before') }),
  ]);
  expect(preview.issues).toEqual([]);
  const moved = preview.items.find(item => item.id === 'it')!;
  return { length: moved.durationDays, start: moved.startDate, finish: moved.finishDate };
}

describe('a task with dates and no length typed in is the same number of days in every place', () => {
  it.each([
    // what, start, finish, working days, its finish when rescheduled to start Mon 26 Oct
    ['from a Friday to the Monday (was 4 on the critical path)', '2026-10-09', '2026-10-12', 2, '2026-10-27'],
    ['across two weekends, Friday to the Monday after next (was 11)', '2026-10-09', '2026-10-19', 7, '2026-11-03'],
    ['starting on a Saturday, to the Tuesday (was 4)', '2026-10-10', '2026-10-13', 2, '2026-10-27'],
    ['ending on a Sunday, from the Thursday (was 4)', '2026-10-08', '2026-10-11', 2, '2026-10-27'],
    ['wholly on a weekend, Saturday and Sunday: never less than one day (was 2)', '2026-10-10', '2026-10-11', 1, '2026-10-26'],
    ['Monday to the next Monday (was 8)', '2026-10-12', '2026-10-19', 6, '2026-11-02'],
    ['Monday to Friday', '2026-10-12', '2026-10-16', 5, '2026-10-30'],
    ['one weekday', '2026-10-13', '2026-10-13', 1, '2026-10-26'],
    ['one Saturday', '2026-10-10', '2026-10-10', 1, '2026-10-26'],
    ['a finish before its start', '2026-10-16', '2026-10-12', 1, '2026-10-26'],
    ['a start and no finish', '2026-10-12', '', 1, '2026-10-26'],
    ['no dates at all', '', '', 1, '2026-10-26'],
  ])('%s', (_what, startDate, finishDate, days, rescheduledFinish) => {
    const dates = { startDate, finishDate, durationDays: null };
    expect(lengthOnTheCriticalPath(dates)).toBe(days);
    expect(whenRescheduled(dates)).toEqual({ length: days, start: '2026-10-26', finish: rescheduledFinish });
  });

  it('the same dates written the way the phone stores them (10/09/2026) count the same', () => {
    const dates = { startDate: '10/09/2026', finishDate: '10/12/2026', durationDays: null };
    expect(lengthOnTheCriticalPath(dates)).toBe(2);
    expect(whenRescheduled(dates).length).toBe(2);
  });

  it('a milestone has no length, whatever its dates', () => {
    const milestone = { startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: null, isMilestone: true };
    expect(lengthOnTheCriticalPath(milestone)).toBe(0);
    expect(whenRescheduled(milestone)).toEqual({ length: 0, start: '2026-10-26', finish: '2026-10-26' });
    expect(lengthOnTheCriticalPath({ ...milestone, durationDays: 5 })).toBe(0);
  });
});

describe('a length he typed is never changed', () => {
  it.each([
    [3, 3, '2026-10-28'],
    [1, 1, '2026-10-26'],
    [10, 10, '2026-11-06'],
    // Accepted 4.68 preserves exact fractional lengths in storage and analytics.
    // Date-only scheduling occupies ceil(length) weekday slots; the finish dates stay unchanged.
    [2.5, 2.5, '2026-10-28'],
    [0.4, 0.4, '2026-10-26'],
  ])('%p typed on a Friday-to-Monday task counts as %p in both places, not the 2 its dates give', (typed, counted, rescheduledFinish) => {
    const typedTask = { startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: typed };
    expect(lengthOnTheCriticalPath(typedTask)).toBe(counted);
    expect(whenRescheduled(typedTask)).toEqual({ length: counted, start: '2026-10-26', finish: rescheduledFinish });
  });

  it.each([[0], [null], [undefined]])('nothing typed (%p) leaves the dates to give the length', typed => {
    const untyped = { startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: typed };
    expect(lengthOnTheCriticalPath(untyped)).toBe(2);
    expect(whenRescheduled(untyped).length).toBe(2);
  });

  it('working out the critical path and the rescheduling changes no stored task', () => {
    const items = [
      task('steel', { startDate: '2026-10-07', finishDate: '2026-10-09', durationDays: 3 }),
      task('inspect', { startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: null, dependencies: after('steel') }),
      task('pour', { startDate: '2026-10-12', finishDate: '2026-10-20', durationDays: 12, dependencies: after('inspect') }),
    ];
    const stored = JSON.stringify(items);
    const analysis = analyzeVitruviusSchedule(items);
    expect(JSON.stringify(items)).toBe(stored);
    // "steel" is not moved, and keeps the 3 he typed; "pour" is moved, and keeps the 12 he typed.
    expect(analysis.impactPreview.items.map(item => [item.id, item.durationDays, item.startDate, item.finishDate])).toEqual([
      ['steel', 3, '2026-10-07', '2026-10-09'],
      ['inspect', 2, '2026-10-12', '2026-10-13'],
      ['pour', 12, '2026-10-14', '2026-10-29'],
    ]);
  });
});

describe('a lag is counted as before: in working days, and a negative one is no lag', () => {
  /** "close" finishes on Thursday 15 Oct; "open" starts after it with the lag given. */
  const startAfterThursday = (lagDays: number | null | undefined) => previewVitruviusFinishToStartSchedule([
    task('close', { startDate: '2026-10-14', finishDate: '2026-10-15', durationDays: 2 }),
    task('open', {
      startDate: '2026-10-12', finishDate: '2026-10-12', durationDays: 1,
      dependencies: [{ predecessorItemId: 'close', type: 'FS', lagDays }],
    }),
  ]).items.find(item => item.id === 'open')!.startDate;

  it.each([
    ['no lag', undefined, '2026-10-16'],
    ['a lag of 0', 0, '2026-10-16'],
    ['a negative lag (-3): read as no lag', -3, '2026-10-16'],
    ['a lag of 1: over the weekend', 1, '2026-10-19'],
    ['a lag of 2', 2, '2026-10-20'],
  ])('rescheduling, %s', (_what, lagDays, start) => {
    expect(startAfterThursday(lagDays)).toBe(start);
  });

  /** "close" has no length typed in and runs from a Friday to the Monday; "open" starts after it with the lag given. */
  const earliestStartAfterFridayToMonday = (lagDays: number | null | undefined) => analyzeVitruviusCriticalPath([
    task('close', { startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: null }),
    task('open', { durationDays: 1, dependencies: [{ predecessorItemId: 'close', type: 'FS', lagDays }] }),
  ]).items.find(item => item.itemId === 'open')!.earliestStart;

  it.each([
    ['no lag', undefined, 2],
    ['a lag of 0', 0, 2],
    ['a negative lag (-3): read as no lag', -3, 2],
    ['a lag of 2', 2, 4],
  ])('the critical path, %s: the task after starts after the 2 working days, plus the lag (was 4 plus the lag)', (_what, lagDays, earliestStart) => {
    expect(earliestStartAfterFridayToMonday(lagDays)).toBe(earliestStart);
  });
});

describe('what moves: float and the critical mark', () => {
  // Two tasks before the pour. Steel has 3 days typed. The inspection has no
  // length typed and runs Friday to Monday: 2 working days, 4 calendar days.
  const steel = task('steel', { taskName: 'Set steel', startDate: '2026-10-07', finishDate: '2026-10-09', durationDays: 3 });
  const inspect = task('inspect', { taskName: 'Inspection', startDate: '2026-10-09', finishDate: '2026-10-12', durationDays: null });
  const pour = task('pour', { taskName: 'Pour slab', startDate: '2026-10-13', finishDate: '2026-10-13', durationDays: 1, dependencies: after('steel', 'inspect') });
  const items = [steel, inspect, pour];

  it('the 3 typed days are the longer road, so steel is critical and the inspection has a day of float (was the other way round)', () => {
    const analysis = analyzeVitruviusCriticalPath(items);
    expect(analysis.projectDurationDays).toEqual({ 'Harbor Lofts': 4 });
    expect(analysis.items.map(item => [item.itemId, item.durationDays, item.totalFloatDays, item.critical]).sort()).toEqual([
      ['inspect', 2, 1, false],
      ['pour', 1, 0, true],
      ['steel', 3, 0, true],
    ]);
    expect([...analysis.criticalItemIds].sort()).toEqual(['pour', 'steel']);
  });

  it('the lookahead (the computer\'s tab and the file the phone shares) marks the same tasks, and shows the same dates as before', () => {
    const lookahead = buildVitruviusLookahead({ items, weeks: 3, today: new Date('2026-10-07T12:00:00.000Z') });
    expect(lookahead.rows.map(row => [row.item.id, row.critical, row.startDate, row.finishDate]).sort()).toEqual([
      ['inspect', false, '2026-10-09', '2026-10-12'],
      ['pour', true, '2026-10-13', '2026-10-13'],
      ['steel', true, '2026-10-07', '2026-10-09'],
    ]);
    expect(lookahead.criticalCount).toBe(2);
    const csv = vitruviusLookaheadCsv(lookahead).split('\n');
    const critical = (name: string) => csv.find(line => line.includes(`"${name}"`))!.split(',')[7];
    expect([critical('Set steel'), critical('Inspection'), critical('Pour slab')]).toEqual(['"Yes"', '"No"', '"Yes"']);
  });

  it('the change preview in the task editor counts the critical path the same way', () => {
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'pour', draft: { percentComplete: 10 } });
    expect(scenario.criticalPath.beforeItemIds).toEqual(['steel', 'pour']);
    expect(scenario.criticalPath.afterItemIds).toEqual(['steel', 'pour']);
  });

  it('no date moves: rescheduling these tasks gives what it gave before', () => {
    const preview = previewVitruviusFinishToStartSchedule(items);
    expect(preview.changes).toEqual([]);
    expect(preview.items.map(item => [item.id, item.startDate, item.finishDate, item.durationDays])).toEqual([
      ['steel', '2026-10-07', '2026-10-09', 3],
      ['inspect', '2026-10-09', '2026-10-12', null],
      ['pour', '2026-10-13', '2026-10-13', 1],
    ]);
    // The steel slips to finish on Friday 16 Oct: the pour goes to Monday 19 Oct, as before.
    const slipped = previewVitruviusFinishToStartSchedule([{ ...steel, finishDate: '2026-10-16' }, inspect, pour]);
    expect(slipped.changes.map(change => [change.itemId, change.nextStartDate, change.nextFinishDate])).toEqual([
      ['pour', '2026-10-19', '2026-10-19'],
    ]);
  });
});
