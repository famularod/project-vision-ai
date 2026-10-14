import { daveWebLinkCircleRefusal } from '../../services/DAVEWebTaskLinkCircle';
import { analyzeVitruviusCriticalPath } from '../../services/VitruviusScheduleAnalytics';
import { previewVitruviusFinishToStartSchedule } from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

// T1b (14 Oct 2026), review pass 6 H6S-1 (caused by d9557b83, open item 3.6). A circle through a phase could be saved
// by two roads: a new task ticked to start after Paving (which starts after the phase Sitework) and THEN put in
// Sitework; and, from a tab that had not seen Paving linked to Sitework, Fence (after Paving) put in Sitework (the
// save read the cloud only when it ADDED a link). Afterwards the Gantt named Paving and Sitework but never the task
// that closed the circle. Now every save road is checked, against this tab's schedule and the cloud's at save time,
// and refused in words naming the task that closes it; and a circle already saved is named with every task in it.
// Synthetic data; made-up names.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const YARD = 'Alpha Yard';
function task(id: string, taskName: string, predecessors: string[] = [], extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, scheduleProjectName: YARD, projectName: YARD, locationName: 'Lot', taskName, startDate: '2026-10-05', finishDate: '2026-10-09',
    milestone: '', owner: '', contractor: '', durationDays: 5, percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
    createdAt: '2026-10-01T12:00:00.000Z',
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    ...extra,
  };
}
const phase = (id: string, taskName: string, extra: Partial<ScheduleItem> = {}) => task(id, taskName, [], { isSummary: true, ...extra });
/** The reviewer's schedule: Sitework holds Grading and Trenching; Paving starts after Sitework; Fence after Paving. */
const site = (pavingAfterSitework = true) => [
  phase('sitework', 'Sitework'),
  task('grading', 'Grading', [], { parentItemId: 'sitework' }),
  task('trenching', 'Trenching', [], { parentItemId: 'sitework', finishDate: '2026-10-14', durationDays: 8 }),
  task('paving', 'Paving', pavingAfterSitework ? ['sitework'] : [], { startDate: '2026-10-15', finishDate: '2026-10-21' }),
  task('fence', 'Fence', ['paving'], { startDate: '2026-10-22', finishDate: '2026-10-28' }),
];
const curb = (extra: Partial<ScheduleItem> = {}) => task('curb', 'Curb', ['paving'], { parentItemId: 'sitework', ...extra });
const cloudOf = (items: ScheduleItem[]) => async () => ({ scheduleItems: items, knownScheduleItems: items }) as never;
const hereOf = (items: ScheduleItem[]) => ({ scheduleItems: items, knownScheduleItems: items }) as never;

const CURB_CIRCLE = '“Curb” would close a circle: “Curb” is in the phase “Sitework”, “Paving” starts after the phase “Sitework”, and “Curb” starts after “Paving”. The schedule could not place them. Untick “Paving”, or choose another parent phase for “Curb”, and save again.';
const FENCE_CIRCLE = '“Fence” would close a circle: “Fence” is in the phase “Sitework”, “Paving” starts after the phase “Sitework”, and “Fence” starts after “Paving”. The schedule could not place them. Untick “Paving”, or choose another parent phase for “Fence”, and save again.';
const ELSEWHERE = 'With what has been saved on another device or in another browser tab, ';

describe('every save road refuses a circle through a phase, naming the task that closes it (T1b)', () => {
  it('road (a): a new task that starts after Paving, put in Sitework', async () => {
    const load = jest.fn(cloudOf(site()));
    const refusal = await daveWebLinkCircleRefusal({ item: curb(), opened: null, here: hereOf(site()), load });

    expect(refusal).toBe(`Not saved. ${CURB_CIRCLE}`);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('road (a) from a tab that has not seen Paving linked to Sitework: the cloud\'s links refuse it, and say so', async () => {
    const refusal = await daveWebLinkCircleRefusal({ item: curb(), opened: null, here: hereOf(site(false)), load: cloudOf(site()) });

    expect(refusal).toBe(`Not saved. ${ELSEWHERE}${CURB_CIRCLE}`);
  });

  it('road (b): Fence, from a tab that has not seen Paving linked to Sitework, put in Sitework (no link added)', async () => {
    const fence = site(false)[4];
    const load = jest.fn(cloudOf(site()));
    const refusal = await daveWebLinkCircleRefusal({ item: { ...fence, parentItemId: 'sitework' }, opened: fence, here: hereOf(site(false)), load });

    expect(refusal).toBe(`Not saved. ${ELSEWHERE}${FENCE_CIRCLE}`);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('road (b) in a tab that shows the link: refused in the same words, with nothing said of another tab', async () => {
    const fence = site()[4];
    const refusal = await daveWebLinkCircleRefusal({ item: { ...fence, parentItemId: 'sitework' }, opened: fence, here: hereOf(site()), load: cloudOf(site()) });

    expect(refusal).toBe(`Not saved. ${FENCE_CIRCLE}`);
  });

  it('guard: decided by the cloud (as F7): a circle only this tab\'s stale copy still holds refuses nothing', async () => {
    const fence = site()[4];

    expect(await daveWebLinkCircleRefusal({ item: { ...fence, parentItemId: 'sitework' }, opened: fence, here: hereOf(site()), load: cloudOf(site(false)) })).toBeNull();
  });

  it('a change of phase the cloud cannot be read for is refused in plain words', async () => {
    const fence = site()[4];
    const refusal = await daveWebLinkCircleRefusal({
      item: { ...fence, parentItemId: 'sitework' }, opened: fence, here: hereOf(site(false)), load: async () => { throw new Error('offline'); },
    });

    expect(refusal).toBe('Not saved. Vitruvius could not read the latest schedule to check this change against it. Check your connection and try again.');
  });

  it('guard: a change of phase that makes no circle is saved (the cloud is read)', async () => {
    const load = jest.fn(cloudOf(site()));
    const grading = site()[1];

    expect(await daveWebLinkCircleRefusal({ item: { ...grading, parentItemId: null }, opened: grading, here: hereOf(site()), load })).toBeNull();
    expect(await daveWebLinkCircleRefusal({ item: { ...site()[4], parentItemId: 'nowhere-phase' }, opened: site()[4], here: hereOf(site()), load })).toBeNull();
    const fenceAlone = { ...site()[4], dependencies: [] };
    expect(await daveWebLinkCircleRefusal({ item: { ...fenceAlone, parentItemId: 'sitework' }, opened: fenceAlone, here: hereOf(site()), load: cloudOf(site().map(item => item.id === 'fence' ? fenceAlone : item)) })).toBeNull();
  });

  it('guard: a new task with links and no phase, or with a phase and no links, cannot close a circle and reads nothing', async () => {
    const load = jest.fn(cloudOf(site()));

    expect(await daveWebLinkCircleRefusal({ item: curb({ parentItemId: null }), opened: null, here: hereOf(site()), load })).toBeNull();
    expect(await daveWebLinkCircleRefusal({ item: curb({ dependencies: [] }), opened: null, here: hereOf(site()), load })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('guard: a circle the cloud already held is not this save\'s doing (as WS1 item 7), even when the save adds a link', async () => {
    const stored = [...site(), curb()];
    const saved = stored[5];
    const load = jest.fn(cloudOf(stored));
    const withGrading = { ...saved, dependencies: [...(saved.dependencies ?? []), { predecessorItemId: 'grading', type: 'FS' as const, lagDays: 0 }] };

    expect(await daveWebLinkCircleRefusal({ item: withGrading, opened: saved, here: hereOf(stored), load })).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('by task (Q29): a link that names a row a master has since replaced counts as that task\'s row shown', async () => {
    const oldSitework = phase('sitework-old', 'Sitework', { importBatchId: 'batch-F' } as Partial<ScheduleItem>);
    const cloud = site().map(item => item.id === 'sitework'
      ? { ...item, importBatchId: 'batch-G', revisedFromTaskIds: ['sitework-old'] } as ScheduleItem
      : item.id === 'paving' ? { ...item, dependencies: [{ predecessorItemId: 'sitework-old', type: 'FS' as const, lagDays: 0 }] } : item);
    const fence = site(false)[4];
    const refusal = await daveWebLinkCircleRefusal({
      item: { ...fence, parentItemId: 'sitework' }, opened: fence, here: hereOf(site(false)),
      load: async () => ({ scheduleItems: cloud, knownScheduleItems: [...cloud, oldSitework] }) as never,
    });

    expect(refusal).toBe(`Not saved. ${ELSEWHERE}${FENCE_CIRCLE}`);
  });
});

describe('a circle already saved is named with every task in it (T1b)', () => {
  const CURB_SAVED = 'Paving starts after the phase Sitework, Curb starts after Paving, and Curb is in the phase Sitework: that is a circle, and the schedule cannot place them until one of these is changed.';

  it('the Impact preview and the Gantt name Curb, the task that closed it, with Paving and Sitework', () => {
    const items = [...site(), curb()];
    const preview = previewVitruviusFinishToStartSchedule(items);
    const critical = analyzeVitruviusCriticalPath(items);

    expect(preview.issues.map(issue => issue.message)).toEqual([CURB_SAVED]);
    expect(preview.safeToApply).toBe(false);
    expect(critical.issues).toEqual([`${YARD}: ${CURB_SAVED}`]);
  });

  it('the same for Fence put in Sitework from a tab that had not seen the link', () => {
    const items = site().map(item => item.id === 'fence' ? { ...item, parentItemId: 'sitework' } : item);

    expect(previewVitruviusFinishToStartSchedule(items).issues.map(issue => issue.message)).toEqual([
      'Paving starts after the phase Sitework, Fence starts after Paving, and Fence is in the phase Sitework: that is a circle, and the schedule cannot place them until one of these is changed.',
    ]);
  });

  it('a circle of tasks alone is named by its tasks, not their ids', () => {
    const items = [task('framing', 'Framing', ['survey']), task('survey', 'Survey', ['inspection']), task('inspection', 'Inspection', ['framing'])];
    const preview = previewVitruviusFinishToStartSchedule(items);
    const critical = analyzeVitruviusCriticalPath(items);

    const SAID = 'Inspection starts after Framing, Survey starts after Inspection, and Framing starts after Survey: that is a circle, and the schedule cannot place them until one of these is changed.';
    expect(preview.issues.map(issue => [issue.code, issue.message])).toEqual([['dependency_cycle', SAID]]);
    expect(critical.issues).toEqual([`${YARD}: ${SAID}`]);
  });

  it('guard: the two short circles read as before', () => {
    expect(previewVitruviusFinishToStartSchedule([phase('sitework', 'Sitework'), task('grading', 'Grading', ['sitework'], { parentItemId: 'sitework' })]).issues.map(issue => issue.message))
      .toEqual(['Grading is in the phase Sitework, so it cannot start after Sitework is finished: that is a circle.']);
    expect(previewVitruviusFinishToStartSchedule([phase('sitework', 'Sitework', { dependencies: [{ predecessorItemId: 'grading', type: 'FS', lagDays: 0 }] }), task('grading', 'Grading', [], { parentItemId: 'sitework' })]).issues.map(issue => issue.message))
      .toEqual(['The phase Sitework is set to start after Grading, one of its own tasks: that is a circle.']);
  });
});
