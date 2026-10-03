/**
 * Whole-app audit A3 pass 9 M1 (30 Sep 2026): a web save of an existing
 * task never changes its project. The Tasks page had saved a task moved
 * from Lot 9 to 2375 Main St with the new name and Lot 9's cloud id, which
 * the phone then refused to upload. buildDAVEWebScheduleItem now refuses
 * such a save with a plain line, whichever screen builds it; the same
 * project written differently, a task's schedule-scope name and a new
 * task are unaffected.
 */
import {
  buildDAVEWebScheduleItem,
  DAVE_WEB_TASK_PROJECT_FIXED_TEXT,
  DAVEWebTaskValidationError,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';

const LOT_9_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const MAIN_ST_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';

const current: DAVEWebScheduleItem = {
  id: 'stripe',
  projectId: LOT_9_ID,
  itemType: 'Task',
  scheduleProjectName: 'Lot 9 schedule',
  projectName: 'Lot 9',
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Stripe parking',
  startDate: '10/05/2026',
  finishDate: '10/09/2026',
  milestone: '',
  owner: 'PM',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  activity: [],
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:00:00.000Z',
  cloudUpdatedAt: '2026-07-24T12:00:01.000Z',
};

const draft = (projectName: string, projectId: string | null = null): DAVEWebTaskDraft => ({
  projectId,
  itemType: 'Task',
  taskName: 'Stripe parking',
  projectName,
  locationName: 'South Lot',
  startDate: '10/05/2026',
  finishDate: '10/09/2026',
  milestone: '',
  owner: 'PM',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  activityMessage: '',
});

const build = (value: DAVEWebTaskDraft, task: DAVEWebScheduleItem | null = current) =>
  buildDAVEWebScheduleItem({ draft: value, current: task, id: task?.id ?? 'new', now: '2026-09-30T15:00:00.000Z', actor: 'PM' });

describe('a web save of an existing task keeps its project (A3 pass 9 M1)', () => {
  test('another project is refused, with or without its cloud id', () => {
    for (const attempt of [draft('2375 Main St'), draft('2375 Main St', MAIN_ST_ID)]) {
      expect(() => build(attempt)).toThrow(DAVEWebTaskValidationError);
      expect(() => build(attempt)).toThrow(DAVE_WEB_TASK_PROJECT_FIXED_TEXT);
    }
    expect(DAVE_WEB_TASK_PROJECT_FIXED_TEXT).toBe(
      'A task stays in its project. To move it, add it in the right project, then delete it here.',
    );
  });

  test.each(['Lot 9', '  lot   9 ', 'Lot 9 schedule', 'LOT 9 SCHEDULE'])(
    '%p is its own project: saved with its names and id exactly as stored',
    projectName => {
      expect(build(draft(projectName))).toMatchObject({
        projectId: LOT_9_ID,
        projectName: 'Lot 9',
        scheduleProjectName: 'Lot 9 schedule',
        locationName: 'South Lot',
      });
    },
  );

  test('a new task takes the project chosen for it', () => {
    expect(build(draft('2375 Main St', MAIN_ST_ID), null)).toMatchObject({
      projectId: MAIN_ST_ID,
      projectName: '2375 Main St',
    });
  });
});
