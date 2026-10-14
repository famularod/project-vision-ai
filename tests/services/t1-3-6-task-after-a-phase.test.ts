import { daveWebLinkCircleClosedBy } from '../../services/DAVEWebTaskLinkCircle';
import { analyzeVitruviusCriticalPath } from '../../services/VitruviusScheduleAnalytics';
import { buildVitruviusScheduleChangeScenario } from '../../services/VitruviusScheduleChangeScenario';
import { previewVitruviusFinishToStartSchedule } from '../../services/VitruviusScheduleEngine';
import { buildVitruviusLookahead } from '../../services/VitruviusLookahead';
import { schedulePredecessorOptions } from '../../services/VitruviusScheduleWorkspace';
import type { ScheduleItem } from '../../types';

// Open item 3.6 (14 Oct 2026). A link to a phase could not be saved on the computer: the schedule placed an item after
// tasks and milestones only. The coordinator's rule: a task MAY follow a phase, as in Microsoft Project. A phase
// finishes when the last task under it finishes, so a finish-to-start link from a phase means "starts after every task
// in that phase is finished". A phase may not follow one of its own tasks, and no link may make a circle. Both on the
// critical path and on "Apply dates". Synthetic data; made-up names.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const NORTH = 'Harbor North';
const ROOT = 'PLZ 2400 Harbor Project';

function task(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: NORTH,
    projectName: NORTH,
    locationName: 'Lot',
    taskName: id,
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
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
const phase = (id: string, taskName: string, overrides: Partial<ScheduleItem> = {}) =>
  task(id, { taskName, isSummary: true, durationDays: null as unknown as number, ...overrides });

/** The phase Sitework holds Grading (5 days) and Trenching (8 days, to Wed 14 Oct). Paving starts after Sitework. */
const sitework = (overrides: Partial<ScheduleItem> = {}) => phase('sitework', 'Sitework', { finishDate: '2026-10-09', ...overrides });
const grading = (overrides: Partial<ScheduleItem> = {}) => task('grading', { taskName: 'Grading', parentItemId: 'sitework', ...overrides });
const trenching = (overrides: Partial<ScheduleItem> = {}) =>
  task('trenching', { taskName: 'Trenching', parentItemId: 'sitework', finishDate: '2026-10-14', durationDays: 8, ...overrides });
const paving = (overrides: Partial<ScheduleItem> = {}) =>
  task('paving', { taskName: 'Paving', startDate: '2026-10-12', finishDate: '2026-10-16', dependencies: after('sitework'), ...overrides });
const site = () => [sitework(), grading(), trenching(), paving()];

const changesOf = (items: readonly ScheduleItem[]) =>
  previewVitruviusFinishToStartSchedule(items).changes.map(change => [change.itemId, change.nextStartDate, change.nextFinishDate]);
const messagesOf = (items: readonly ScheduleItem[]) => previewVitruviusFinishToStartSchedule(items).issues.map(issue => issue.message);

describe('"Apply dates": a task that starts after a phase (open item 3.6)', () => {
  it('starts after every task in the phase is finished, and the link is kept as saved', () => {
    const preview = previewVitruviusFinishToStartSchedule(site());

    expect(preview.issues).toEqual([]);
    expect(preview.safeToApply).toBe(true);
    // Trenching, the last of Sitework's tasks, finishes Wed 14 Oct: Paving starts Thu 15 Oct, five working days.
    expect(preview.changes.map(change => [change.itemId, change.nextStartDate, change.nextFinishDate, change.predecessorItemIds]))
      .toEqual([['paving', '2026-10-15', '2026-10-21', ['sitework']]]);
    expect(preview.items.find(item => item.id === 'paving')?.dependencies).toEqual(after('sitework'));
    // The phase's own stored finish (9 Oct) is not what Paving waits for.
    expect(preview.items.find(item => item.id === 'sitework')).toMatchObject({ startDate: '2026-10-05', finishDate: '2026-10-09' });
  });

  it('waits for the tasks\' calculated dates: a task in the phase that moves first moves Paving after it', () => {
    const survey = task('survey', { taskName: 'Survey', startDate: '2026-10-05', finishDate: '2026-10-16' });
    const items = [survey, sitework(), grading({ dependencies: after('survey') }), trenching(), paving()];

    // Grading moves to 19-23 Oct after Survey; Paving then starts on Mon 26 Oct.
    expect(changesOf(items)).toEqual([['grading', '2026-10-19', '2026-10-23'], ['paving', '2026-10-26', '2026-10-30']]);
  });

  it('counts the work in a phase inside the phase, and keeps the link\'s lag', () => {
    const utilities = phase('utilities', 'Utilities', { parentItemId: 'sitework' });
    const conduit = task('conduit', { taskName: 'Conduit', parentItemId: 'utilities', finishDate: '2026-10-16', durationDays: 10 });
    const items = [sitework(), utilities, conduit, grading(), paving({ dependencies: [{ predecessorItemId: 'sitework', type: 'FS', lagDays: 2 }] })];

    // Conduit finishes Fri 16 Oct; two working days' lag: Paving starts Wed 21 Oct.
    expect(changesOf(items)).toEqual([['paving', '2026-10-21', '2026-10-27']]);
  });

  it('a phase with nothing under it yet is placed by its own dates, as a task is', () => {
    const landscaping = phase('landscaping', 'Landscaping', { finishDate: '2026-10-13' });
    const items = [landscaping, paving({ dependencies: after('landscaping') })];

    expect(messagesOf(items)).toEqual([]);
    expect(changesOf(items)).toEqual([['paving', '2026-10-14', '2026-10-20']]);
    expect(analyzeVitruviusCriticalPath(items).safe).toBe(true);
  });

  it('a hand-made task after a master\'s phase (filed under the master\'s name) is placed as well', () => {
    const items = [sitework({ scheduleProjectName: ROOT }), grading({ scheduleProjectName: ROOT }), trenching({ scheduleProjectName: ROOT }), paving()];

    expect(messagesOf(items)).toEqual([]);
    expect(changesOf(items)).toEqual([['paving', '2026-10-15', '2026-10-21']]);
  });
});

describe('the critical path and a task that starts after a phase (open item 3.6)', () => {
  it('is calculated: the phase is the work in it', () => {
    const analysis = analyzeVitruviusCriticalPath(site());

    expect(analysis.issues).toEqual([]);
    expect(analysis.safe).toBe(true);
    expect(analysis.available).toBe(true);
    // Trenching (8) then Paving (5) is the longest chain; Grading (5) has float. The phase is no row of its own.
    expect([...analysis.criticalItemIds].sort()).toEqual(['paving', 'trenching']);
    expect(analysis.items.map(item => item.itemId).sort()).toEqual(['grading', 'paving', 'trenching']);
    expect(analysis.items.find(item => item.itemId === 'paving')).toMatchObject({ earliestStart: 8, earliestFinish: 13 });
  });

  it('a hand-made task after a master\'s phase: calculated through both schedules', () => {
    const items = [sitework({ scheduleProjectName: ROOT }), grading({ scheduleProjectName: ROOT }), trenching({ scheduleProjectName: ROOT }), paving()];
    const analysis = analyzeVitruviusCriticalPath(items);

    expect(analysis.issues).toEqual([]);
    expect([...analysis.criticalItemIds].sort()).toEqual(['paving', 'trenching']);
  });

  it('the phone\'s and the iPad\'s lookahead marks the same tasks critical', () => {
    const lookahead = buildVitruviusLookahead({ items: site(), weeks: 3, today: new Date('2026-10-06T18:00:00.000Z') });

    expect(lookahead.rows.filter(row => row.critical).map(row => row.item.id).sort()).toEqual(['paving', 'trenching']);
  });
});

describe('a link through a phase that would make a circle (open item 3.6)', () => {
  const holds = (items: readonly ScheduleItem[], message: string) => {
    const preview = previewVitruviusFinishToStartSchedule(items);
    const critical = analyzeVitruviusCriticalPath(items);
    expect(preview.issues.map(issue => [issue.code, issue.severity, issue.message])).toEqual([['phase_link_circle', 'error', message]]);
    expect(preview.safeToApply).toBe(false);
    expect(critical.safe).toBe(false);
    expect(critical.issues).toEqual([`${NORTH}: ${message}`]);
  };

  it('a task in a phase that starts after that phase', () => {
    holds([sitework(), grading({ dependencies: after('sitework') }), trenching()],
      'Grading is in the phase Sitework, so it cannot start after Sitework is finished: that is a circle.');
  });

  it('a phase set to start after one of its own tasks', () => {
    holds([sitework({ dependencies: after('grading') }), grading(), trenching()],
      'The phase Sitework is set to start after Grading, one of its own tasks: that is a circle.');
  });

  it('a task after a phase that holds work coming after that task', () => {
    holds([sitework(), grading({ dependencies: after('paving') }), trenching(), paving()],
      // Every step named since T1b (it read "..., and the phase Sitework also waits for Paving: that is a circle.").
      'Paving starts after the phase Sitework, Grading starts after Paving, and Grading is in the phase Sitework: that is a circle, and the schedule cannot place them until one of these is changed.');
  });

  it('guard: a circle of tasks with no phase in it reads as before', () => {
    const preview = previewVitruviusFinishToStartSchedule([task('a', { dependencies: after('b') }), task('b', { dependencies: after('a') })]);

    expect(preview.issues.map(issue => issue.code)).toEqual(['dependency_cycle']);
  });
});

describe('the computer\'s Schedule editor and a phase as a predecessor (open item 3.6)', () => {
  const offered = (itemId: string | null, items: readonly ScheduleItem[], parentItemId?: string | null) =>
    schedulePredecessorOptions(itemId, items, parentItemId).map(item => item.id);

  it('offers a phase, also one with nothing under it yet', () => {
    const items = [...site(), phase('landscaping', 'Landscaping'), task('fence', { taskName: 'Fence' })];

    expect(offered('fence', items)).toEqual(expect.arrayContaining(['sitework', 'landscaping', 'grading', 'trenching', 'paving']));
  });

  it('never offers what would make a circle: its own phase, a phase holding work that comes after it, or what comes after it', () => {
    const items = [...site(), task('curb', { taskName: 'Curb', dependencies: after('fence') }), task('fence', { taskName: 'Fence' })];

    // Grading is in Sitework.
    expect(offered('grading', items)).not.toContain('sitework');
    // Paving starts after Sitework: Paving comes after Grading, so Grading may not start after Paving.
    expect(offered('grading', items)).not.toContain('paving');
    // Curb comes after Fence; a phase holding Curb comes after Fence too.
    expect(offered('fence', [...items.filter(item => item.id !== 'curb'), task('curb', { taskName: 'Curb', parentItemId: 'sitework', dependencies: after('fence') })]))
      .not.toContain('sitework');
    // A new item, or one moved in the form, under Sitework: not Sitework.
    expect(offered(null, items, 'sitework')).not.toContain('sitework');
    expect(offered('fence', items, 'sitework')).not.toContain('sitework');
    expect(offered('fence', items)).toContain('sitework');
  });
});

describe('the editor\'s change preview with a task that starts after a phase (open item 3.6)', () => {
  const shownIn = (shown: readonly ScheduleItem[]) => (id: string) => shown.find(item => item.id === id) ?? null;

  it('a hand-made task after a master\'s phase filed under the master\'s name: ready to save', () => {
    const items = [sitework({ scheduleProjectName: ROOT }), grading({ scheduleProjectName: ROOT }), trenching({ scheduleProjectName: ROOT }), paving()];
    const scenario = buildVitruviusScheduleChangeScenario({ items, itemId: 'paving', draft: {}, shownTaskOf: shownIn(items) });

    expect(scenario.safety.issues).toEqual([]);
    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.proposedProjectItems.map(item => item.id)).toEqual(['paving']);
    // After the last task in the phase (Trenching, to Wed 14 Oct), not the phase row's own finish (9 Oct).
    expect(scenario.proposedProjectItems[0]).toMatchObject({ startDate: '2026-10-15', finishDate: '2026-10-21' });
  });

  it('a task in the phase that finishes later lists the task after the phase as affected', () => {
    const scenario = buildVitruviusScheduleChangeScenario({ items: site(), itemId: 'trenching', draft: { finishDate: '2026-10-16', durationDays: 10 } });

    expect(scenario.safety.safeToApply).toBe(true);
    expect(scenario.downstreamChanges.map(change => [change.itemId, change.nextStartDate])).toEqual([['paving', '2026-10-19']]);
  });

  it('moved in the form into the phase it starts after: named, and the save is held', () => {
    const scenario = buildVitruviusScheduleChangeScenario({ items: site(), itemId: 'paving', draft: { parentItemId: 'sitework' } });

    expect(scenario.safety.safeToApply).toBe(false);
    expect(scenario.safety.issues.map(issue => issue.message))
      .toContain('Paving is in the phase Sitework, so it cannot start after Sitework is finished: that is a circle.');
  });
});

describe('the save\'s check of the cloud, and a circle through a phase made from two places (open item 3.6)', () => {
  it('refuses a new link to a phase whose work already comes after the task', () => {
    const cloud = [sitework(), grading({ dependencies: after('paving') }), trenching(), paving({ dependencies: [] })];
    const circle = daveWebLinkCircleClosedBy({ item: paving(), opened: paving({ dependencies: [] }), cloud: { scheduleItems: cloud, knownScheduleItems: cloud } as never });

    expect(circle && [circle.task.id, circle.predecessor.id, circle.through.map(step => step.id)]).toEqual(['paving', 'sitework', ['grading']]);
  });

  it('guard: a new link to a phase that waits for nothing of the task\'s is not refused', () => {
    const cloud = [sitework(), grading(), trenching(), paving({ dependencies: [] })];

    expect(daveWebLinkCircleClosedBy({ item: paving(), opened: paving({ dependencies: [] }), cloud: { scheduleItems: cloud, knownScheduleItems: cloud } as never })).toBeNull();
  });
});
