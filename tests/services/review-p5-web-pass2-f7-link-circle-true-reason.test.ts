import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { daveWebLinkCircleClosedBy, daveWebLinkCircleRefusal, daveWebLinkCircleText } from '../../services/DAVEWebTaskLinkCircle';
import type { ScheduleItem } from '../../types';

// Second review of the web area, F7, the sentence only (7 Oct 2026; caused by the fix for review pass 1, M1).
// A save that adds a predecessor link is refused when the link would close a circle with what the cloud holds.
// The refusal always said the other links were made "on another device or in another browser tab". With a
// project chosen at the top the editor can offer a task that already comes after the item through a task
// filed under another schedule name, and then every link of the circle is in the schedule this very tab
// shows: nothing was made elsewhere.
//
// The save is now told what this tab's schedule holds, and blames another device or tab only for a circle that
// schedule does not hold. Whether a save is refused is decided as before, by the cloud alone.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function task(id: string, taskName: string, extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, projectId: 'alpha', itemType: 'Task', scheduleProjectName: 'Alpha', projectName: 'Alpha', locationName: 'Lot', taskName,
    startDate: '10/05/2026', finishDate: '10/09/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium',
    status: 'Not Started', notes: '', nextAction: '', activity: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  } as ScheduleItem;
}
const after = (...ids: string[]) => ({ dependencies: ids.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })) });
const tasksOf = (shown: ScheduleItem[], hidden: ScheduleItem[] = []) =>
  ({ scheduleItems: shown as DAVEWebScheduleItem[], knownScheduleItems: [...shown, ...hidden] as DAVEWebScheduleItem[] });

const punch = task('punch', 'Punch walk');
const excavation = task('excavation', 'Excavation', { scheduleProjectName: 'PLZ 2400 Harbor Project', ...after('punch') });
const grading = task('grading', 'Grading', after('excavation'));
/** Punch walk as this save would write it: to start after Grading. */
const saving = { ...punch, ...after('grading') };

const IN_THIS_SCHEDULE = 'Not saved. “Grading” already comes after “Punch walk” (through “Excavation”). Making “Punch walk” start after “Grading” as well would put them in a circle, and the schedule could not place either one. Untick “Grading” and save again, or remove the other link first.';
const MADE_ELSEWHERE = 'Not saved. “Grading” already comes after “Punch walk” (through “Excavation”), on another device or in another browser tab. Making “Punch walk” start after “Grading” as well would put them in a circle, and the schedule could not place either one. Untick “Grading” and save again, or remove the other link first.';

describe('second review, web F7 (the sentence): what the refusal says about where the other links are', () => {
  const cloud = tasksOf([excavation, grading, punch]);
  const load = async () => cloud;

  it('every link of the circle is in the schedule this tab shows: the true reason, the same tasks named, and no other device or tab blamed', async () => {
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here: tasksOf([excavation, grading, punch]), load })).toBe(IN_THIS_SCHEDULE);
  });

  it('the link between the two tasks in between is not in this tab’s schedule (it was made elsewhere since): it says so, as before', async () => {
    const here = tasksOf([excavation, { ...grading, dependencies: [] }, punch]);
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here, load })).toBe(MADE_ELSEWHERE);
  });

  it('the link back to the task being saved is not in this tab’s schedule: it says so, as before', async () => {
    const here = tasksOf([{ ...excavation, dependencies: [] }, grading, punch]);
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here, load })).toBe(MADE_ELSEWHERE);
  });

  it('a task of the circle is not in this tab’s schedule at all: it says so, as before', async () => {
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here: tasksOf([grading, punch]), load })).toBe(MADE_ELSEWHERE);
  });

  it('two tasks linked directly, both links in this tab’s schedule: the true reason', async () => {
    const framing = task('framing', 'Framing', after('survey'));
    const survey = task('survey', 'Survey');
    const both = tasksOf([framing, survey]);
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, ...after('framing') }, opened: survey, here: both, load: async () => both })).toBe(
      'Not saved. “Framing” is already set to start after “Survey”. Making “Survey” start after “Framing” as well would put them in a circle, and the schedule could not place either one. Untick “Framing” and save again, or remove the other link first.',
    );
  });

  it('by task, as the list shows links: a link in this tab’s schedule that names a row a master has since replaced is the same link', async () => {
    const oldExcavation = task('excavation-old', 'Excavation', { importBatchId: 'batch-F' });
    const newExcavation = { ...excavation, importBatchId: 'batch-G', revisedFromTaskIds: ['excavation-old'] } as ScheduleItem;
    const here = tasksOf([newExcavation, { ...grading, ...after('excavation-old') }, punch], [oldExcavation]);
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here, load: async () => here })).toBe(IN_THIS_SCHEDULE);
  });

  it('guard: whether the save is refused is decided by the cloud alone: a circle only this tab’s stale schedule still holds refuses nothing', async () => {
    const cloudNow = tasksOf([{ ...excavation, dependencies: [] }, grading, punch]);
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, here: tasksOf([excavation, grading, punch]), load: async () => cloudNow })).toBeNull();
  });

  it('guard: a caller that does not say what its tab holds gets the sentence as it was', async () => {
    expect(await daveWebLinkCircleRefusal({ item: saving, opened: punch, load })).toBe(MADE_ELSEWHERE);
    const circle = daveWebLinkCircleClosedBy({ item: saving, opened: punch, cloud });
    expect(daveWebLinkCircleText(circle!)).toBe(MADE_ELSEWHERE);
    expect(daveWebLinkCircleText(circle!, { inThisSchedule: true })).toBe(IN_THIS_SCHEDULE);
  });
});
