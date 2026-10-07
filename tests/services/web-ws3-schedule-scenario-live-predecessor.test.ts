import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import type { ScheduleItem } from '../../types';

// Review pass 1, web M1 (6 Oct 2026): the web's Schedule editor previews a change within the edited task's own
// schedule (the tasks filed under one schedule name). A predecessor that is in the schedule shown but filed under
// another schedule name (a hand-made web task that starts after a task of a Microsoft Project master filed under
// its own root name) was "missing" to the preview, so Save read "Correct Schedule Issues" until he unticked a link
// that was right. Given the task the schedule shows for a predecessor id, the preview counts that task as present,
// on the dates it has. Synthetic data.

const NORTH = 'Harbor North';
const ROOT = 'PLZ 2400 Harbor Project';

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: NORTH,
    projectName: NORTH,
    locationName: 'Lot',
    taskName: id,
    startDate: '2026-10-12',
    finishDate: '2026-10-16',
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

/** A master's task, filed under the master's own root name, for the same building. */
const excavation = (overrides: Partial<ScheduleItem> = {}) =>
  task('excavation', { taskName: 'Excavation', scheduleProjectName: ROOT, startDate: '2026-10-05', finishDate: '2026-10-09', ...overrides });
/** A task he added by hand on the web: filed under the building's name. It starts after Excavation. */
const punch = (overrides: Partial<ScheduleItem> = {}) =>
  task('punch', { taskName: 'Punch walk', dependencies: [{ predecessorItemId: 'excavation', type: 'FS', lagDays: 0 }], ...overrides });

const shownIn = (shown: readonly ScheduleItem[]) => (id: string) => shown.find(item => item.id === id) ?? null;

describe('the editor\'s preview and a predecessor filed under another schedule name (review pass 1, web M1)', () => {
  it('counts a predecessor the schedule shows as present: nothing is missing, and the change is safe to save', () => {
    const items = [excavation(), punch()];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.safety.issues).toEqual([]);
    expect(scenario.safety.safeToApply).toBe(true);
  });

  it('the same when the page was handed the edited task\'s own schedule only (a project is chosen at the top)', () => {
    const all = [excavation(), punch()];
    const scenario = buildVitruviusScheduleChangeScenario({ items: [punch()], itemId: 'punch', draft: {}, shownTaskOf: shownIn(all) });

    expect(scenario.safety.issues).toEqual([]);
    expect(scenario.safety.safeToApply).toBe(true);
  });

  it('never returns the other schedule\'s task, and leaves it out of the project\'s finish and critical path', () => {
    // Excavation finishes long after this schedule's own tasks: it is not this schedule's finish.
    const late = excavation({ startDate: '2026-11-02', finishDate: '2026-11-27', durationDays: 20 });
    const items = [late, punch({ startDate: '2026-11-30', finishDate: '2026-12-04' }), task('fence', { taskName: 'Fence', startDate: '2026-10-19', finishDate: '2026-10-23' })];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'fence', draft: { finishDate: '2026-10-26' }, shownTaskOf: shownIn(items) });

    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.proposedProjectItems.map(item => item.id)).toEqual(['punch', 'fence']);
    expect(scenario.projectFinish).toEqual({ before: '2026-12-04', after: '2026-12-04', deltaCalendarDays: 0 });
    expect([...scenario.criticalPath.beforeItemIds, ...scenario.criticalPath.afterItemIds]).not.toContain('excavation');
    // The source records are left as they were.
    expect([late.scheduleProjectName, late.dependencies]).toEqual([ROOT, undefined]);
  });

  it('guard: its finish is never this schedule\'s finish', () => {
    // Punch walk is complete and is not moved; Excavation, filed elsewhere, finishes weeks after this schedule's tasks.
    const items = [
      excavation({ startDate: '2026-11-02', finishDate: '2026-11-27', durationDays: 20 }),
      punch({ status: 'Complete', percentComplete: 100 }),
      task('fence', { taskName: 'Fence', startDate: '2026-10-19', finishDate: '2026-10-23' }),
    ];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'fence', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.projectFinish).toEqual({ before: '2026-10-23', after: '2026-10-23', deltaCalendarDays: 0 });
    expect(scenario.proposedProjectItems.map(item => item.id)).toEqual(['punch', 'fence']);
  });

  it('places the task after it: a predecessor with no finish date is named, as one of the schedule\'s own would be', () => {
    const items = [excavation({ finishDate: '' }), punch()];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues.map(issue => issue.message)).toEqual(['Excavation needs a valid finish date before Punch walk can be calculated.']);
  });

  it('it is taken on the dates it has: what it waits for in its own schedule is not this schedule\'s to place', () => {
    // Excavation itself waits for Survey, in the master's schedule, and for a task that was deleted there.
    const survey = task('survey', { taskName: 'Survey', scheduleProjectName: ROOT, startDate: '2026-09-28', finishDate: '2026-10-02' });
    const items = [survey, excavation({ dependencies: [{ predecessorItemId: 'survey', type: 'FS', lagDays: 0 }, { predecessorItemId: 'deleted-in-the-master', type: 'FS', lagDays: 0 }] }), punch()];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.safety.issues).toEqual([]);
    expect(scenario.safety.safeToApply).toBe(true);
  });

  it('a link that names a row a master has since replaced counts as the row shown for that task', () => {
    const items = [excavation(), punch({ dependencies: [{ predecessorItemId: 'excavation-earlier-row', type: 'FS', lagDays: 0 }] })];
    const shownTaskOf = (id: string) => (id === 'excavation-earlier-row' ? items[0] : shownIn(items)(id));
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf });

    expect(scenario.safety.safeToApply).toBe(true);
  });

  it('another task of the edited task\'s schedule that waits for a task filed elsewhere does not hold this save either', () => {
    const items = [excavation(), punch(), task('fence', { taskName: 'Fence' })];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'fence', draft: { finishDate: '2026-10-19' }, shownTaskOf: shownIn(items) });

    expect(scenario.safety.safeToApply).toBe(true);
  });

  it('guard: a predecessor no schedule shows (deleted, or only on a schedule that is not the current one) is still missing', () => {
    const items = [excavation(), punch({ dependencies: [{ predecessorItemId: 'deleted-task', type: 'FS', lagDays: 0 }] })];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues.map(issue => issue.code)).toContain('missing_predecessor');
  });

  it('guard: a link that names an earlier row of the task itself is not a predecessor in the schedule', () => {
    const items = [excavation(), punch({ dependencies: [{ predecessorItemId: 'punch-earlier-row', type: 'FS', lagDays: 0 }] })];
    const shownTaskOf = (id: string) => (id === 'punch-earlier-row' ? items[1] : shownIn(items)(id));
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'punch', draft: {}, shownTaskOf });

    expect(scenario.safety.safeToApply).toBe(false);
  });

  it('guard: told nothing about the schedule shown, a predecessor filed under another schedule name is missing, as before', () => {
    const scenario = buildVitruviusScheduleChangeScenario({ items: [excavation(), punch()], itemId: 'punch', draft: {} });

    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues.map(issue => issue.message)).toContain('Punch walk references missing predecessor excavation.');
  });
});
