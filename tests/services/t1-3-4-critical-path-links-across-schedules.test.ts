import {
  analyzeVitruviusCriticalPath,
  analyzeVitruviusListedSchedule,
  analyzeVitruviusSchedule,
  scheduleTasksLinkedWith,
} from '../../services/VitruviusScheduleAnalytics';
import { buildVitruviusLookahead } from '../../services/VitruviusLookahead';
import type { ScheduleItem } from '../../types';

// Open item 3.4 (14 Oct 2026). A master files its tasks under its own name; a task he adds by hand on the computer is
// filed under its building's name. The critical path worked each schedule name out on its own, so a link between the
// two read "references missing predecessor <id>": the critical path was unavailable, and with a project chosen at the
// top of the computer's Schedule page "Apply dates" was switched off. A hand-made task is a real task: a link to or
// from it counts like any other. Synthetic data; made-up names.

const NORTH = 'Harbor North';
const ROOT = 'PLZ 2400 Harbor Project';

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: NORTH,
    projectName: NORTH,
    locationName: 'Lot',
    taskName: id,
    startDate: '2026-10-19',
    finishDate: '2026-10-23',
    milestone: '',
    owner: '',
    contractor: '',
    durationDays: 5,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}
const after = (...ids: string[]) => ids.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 }));

/** The master's tasks, filed under the master's own name: Survey, then Excavation. */
const survey = (overrides: Partial<ScheduleItem> = {}) =>
  task('survey', { taskName: 'Survey', scheduleProjectName: ROOT, startDate: '2026-10-05', finishDate: '2026-10-09', ...overrides });
const excavation = (overrides: Partial<ScheduleItem> = {}) =>
  task('excavation', { taskName: 'Excavation', scheduleProjectName: ROOT, startDate: '2026-10-12', finishDate: '2026-10-16', dependencies: after('survey'), ...overrides });
/** Added by hand on the computer, filed under the building: Punch walk starts after Excavation; Fence waits for nothing. */
const punch = (overrides: Partial<ScheduleItem> = {}) =>
  task('punch', { taskName: 'Punch walk', dependencies: after('excavation'), ...overrides });
const fence = (overrides: Partial<ScheduleItem> = {}) =>
  task('fence', { taskName: 'Fence', startDate: '2026-10-05', finishDate: '2026-10-07', durationDays: 3, ...overrides });
const harbor = () => [survey(), excavation(), punch(), fence()];

describe('the critical path and a link between a hand-made task and a master\'s task (open item 3.4)', () => {
  it('is calculated: nothing is called missing, and the chain runs through both schedules', () => {
    const analysis = analyzeVitruviusCriticalPath(harbor());

    expect(analysis.issues).toEqual([]);
    expect(analysis.safe).toBe(true);
    expect(analysis.available).toBe(true);
    // Survey (5) -> Excavation (5) -> Punch walk (5) is the longest chain; Fence (3) has float.
    expect([...analysis.criticalItemIds].sort()).toEqual(['excavation', 'punch', 'survey']);
    expect(analysis.items.find(item => item.itemId === 'punch')).toMatchObject({ projectName: NORTH, earliestStart: 10, earliestFinish: 15 });
    expect(analysis.items.find(item => item.itemId === 'excavation')).toMatchObject({ projectName: ROOT });
    // Each task once.
    expect(analysis.items.map(item => item.itemId).sort()).toEqual(['excavation', 'fence', 'punch', 'survey']);
  });

  it('gives each task the marks it would have if both were filed under one name', () => {
    const together = harbor().map(item => ({ ...item, scheduleProjectName: ROOT }));
    const split = analyzeVitruviusCriticalPath(harbor());
    const one = analyzeVitruviusCriticalPath(together);

    expect([...split.criticalItemIds].sort()).toEqual([...one.criticalItemIds].sort());
    expect(split.items.map(({ itemId, earliestStart, totalFloatDays }) => ({ itemId, earliestStart, totalFloatDays })))
      .toEqual(one.items.map(({ itemId, earliestStart, totalFloatDays }) => ({ itemId, earliestStart, totalFloatDays })));
  });

  it('the other way round: a master\'s task that waits for a hand-made task is calculated too', () => {
    const items = [task('mockup', { taskName: 'Mockup panel' }), survey({ dependencies: after('mockup') })];
    const analysis = analyzeVitruviusCriticalPath(items);

    expect(analysis.issues).toEqual([]);
    expect(analysis.safe).toBe(true);
    expect([...analysis.criticalItemIds].sort()).toEqual(['mockup', 'survey']);
  });

  it('a schedule not linked to another is worked out on its own, as before', () => {
    const other = [task('a', { scheduleProjectName: 'Alpha' }), task('b', { scheduleProjectName: 'Alpha', dependencies: after('a') })];
    const analysis = analyzeVitruviusCriticalPath([...harbor(), ...other]);

    expect(analysis.projectDurationDays).toEqual({ [ROOT]: 10, [NORTH]: 15, Alpha: 10 });
    expect([...analysis.criticalItemIds].sort()).toEqual(['a', 'b', 'excavation', 'punch', 'survey']);
  });

  it('guard: a predecessor in no schedule is still missing, by its schedule\'s name', () => {
    const analysis = analyzeVitruviusCriticalPath([survey(), excavation(), punch({ dependencies: after('excavation', 'deleted-task') })]);

    expect(analysis.safe).toBe(false);
    expect(analysis.issues).toEqual([`${NORTH}: Punch walk references missing predecessor deleted-task.`]);
  });

  it('guard: a circle across the two schedules is still a circle', () => {
    const analysis = analyzeVitruviusCriticalPath([survey({ dependencies: after('punch') }), excavation(), punch()]);

    expect(analysis.safe).toBe(false);
    // Named task by task since T1b ("dependency cycle includes <ids>" before).
    expect(analysis.issues.join(' ')).toMatch(/Survey starts after Punch walk.*: that is a circle/);
  });

  it('the phone\'s and the iPad\'s lookahead (the same critical path) marks the chain critical', () => {
    const lookahead = buildVitruviusLookahead({ items: harbor(), weeks: 3, today: new Date('2026-10-06T18:00:00.000Z') });

    expect(lookahead.rows.filter(row => row.critical).map(row => row.item.id).sort()).toEqual(['excavation', 'punch', 'survey']);
  });
});

describe('the computer\'s Schedule page with a project chosen at the top: only its own tasks listed (open item 3.4)', () => {
  // Harbor North chosen: the page lists Punch walk and Fence; the schedule shown holds the master's tasks too.
  const listed = () => [punch(), fence()];

  it('finds the tasks the listed tasks are linked with, through any number of links, wherever they are filed', () => {
    expect(scheduleTasksLinkedWith(listed(), harbor()).map(item => item.id).sort()).toEqual(['excavation', 'survey']);
    expect(scheduleTasksLinkedWith([fence()], harbor())).toEqual([]);
    // From the master's side: the hand-made task that waits for it.
    expect(scheduleTasksLinkedWith([survey()], harbor()).map(item => item.id).sort()).toEqual(['excavation', 'punch']);
  });

  it('the critical path is calculated with them and marks only the tasks listed', () => {
    const analytics = analyzeVitruviusListedSchedule(listed(), harbor());

    expect(analytics.criticalPath.safe).toBe(true);
    expect(analytics.criticalPath.available).toBe(true);
    expect([...analytics.criticalPath.criticalItemIds]).toEqual(['punch']);
    expect(analytics.criticalPath.items.map(item => item.itemId).sort()).toEqual(['fence', 'punch']);
  });

  it('"Apply dates" is not switched off: the dates are calculated, and only the listed tasks\' changes are offered', () => {
    // Survey runs late, so Excavation must move, and Punch walk after it.
    const shown = [survey({ finishDate: '2026-10-14' }), excavation(), punch(), fence()];
    const analytics = analyzeVitruviusListedSchedule(listed(), shown);

    expect(analytics.impactPreview.issues).toEqual([]);
    expect(analytics.impactPreview.safeToApply).toBe(true);
    expect(analytics.impactPreview.changes.map(change => [change.itemId, change.nextStartDate, change.nextFinishDate]))
      .toEqual([['punch', '2026-10-22', '2026-10-28']]);
    expect(analytics.impactPreview.items.map(item => item.id)).toEqual(['punch', 'fence']);
    expect(analytics.baselineVariance.map(variance => variance.itemId)).toEqual(['punch', 'fence']);
  });

  it('guard: with nothing linked elsewhere it is the page\'s analysis as before', () => {
    const alone = [fence(), task('gate', { taskName: 'Gate', dependencies: after('fence') })];

    expect(analyzeVitruviusListedSchedule(alone, [...harbor(), alone[1]])).toEqual(analyzeVitruviusSchedule(alone));
  });

  it('guard: a predecessor in no schedule shown is still missing, and "Apply dates" stays off for it', () => {
    const analytics = analyzeVitruviusListedSchedule([punch({ dependencies: after('excavation', 'deleted-task') })], harbor());

    expect(analytics.impactPreview.safeToApply).toBe(false);
    expect(analytics.criticalPath.issues).toEqual([`${NORTH}: Punch walk references missing predecessor deleted-task.`]);
  });

  it('the computer\'s Lookahead tab marks the same task critical when given the linked tasks', () => {
    const today = new Date('2026-10-06T18:00:00.000Z');
    const alone = buildVitruviusLookahead({ items: listed(), weeks: 3, today });
    const withLinks = buildVitruviusLookahead({ items: listed(), weeks: 3, today, linkedTasksElsewhere: scheduleTasksLinkedWith(listed(), harbor()) });

    expect(alone.rows.filter(row => row.critical)).toEqual([]);
    expect(withLinks.rows.filter(row => row.critical).map(row => row.item.id)).toEqual(['punch']);
    expect(withLinks.rows.map(row => row.item.id).sort()).toEqual(['fence', 'punch']);
  });
});
