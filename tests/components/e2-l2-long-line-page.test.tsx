/**
 * Review pass 1, L2, on the desktop Schedule page: one line longer than 2,600
 * working days with a predecessor stopped the predecessor's slip from being
 * saved ("Correct Schedule Issues", disabled) and stopped "apply calculated
 * dates" for every task on the page. The long line is now named in a note
 * and left as it is; the slip saves and the other dates apply.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockUpdateTask = jest.fn();
const mockUpdateTasks = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    snapshot: { projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: 'Lot 9' }] },
    createTask: jest.fn(),
    updateTask: mockUpdateTask,
    updateTasks: mockUpdateTasks,
    refreshSnapshot: jest.fn(async () => true),
  }),
}));

const PROJECT = 'Lot 9';

function scheduleItem(id: string, overrides: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Pad',
    taskName: id,
    startDate: '2026-08-03',
    finishDate: '2026-08-07',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 5,
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-24T12:00:00.000Z',
    progressConfirmedBy: 'PM',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    cloudUpdatedAt: '2026-07-24T12:00:01.000Z',
    ...overrides,
  };
}

const after = (predecessorItemId: string) => [{ predecessorItemId, type: 'FS' as const, lagDays: 0 }];
const closeout = scheduleItem('closeout', { taskName: 'Substantial completion' });
const warranty = (overrides: Partial<DAVEWebScheduleItem> = {}) => scheduleItem('warranty', {
  taskName: 'Roof warranty period', startDate: '2026-08-03', finishDate: '2038-07-19', durationDays: 3_120,
  dependencies: after('closeout'), ...overrides,
});
const punch = scheduleItem('punch', {
  taskName: 'Punch list', startDate: '2026-08-03', finishDate: '2026-08-05', durationDays: 3, dependencies: after('closeout'),
});
const clean = scheduleItem('clean', {
  taskName: 'Final clean', startDate: '2026-08-03', finishDate: '2026-08-04', durationDays: 2, dependencies: after('closeout'),
});

const NOTE = (start: string) =>
  '• Roof warranty period is longer than the 2,600 working days the schedule supports, so its dates were not calculated. ' +
  `Its predecessors now put its start on or after ${start}: move it yourself. The other date changes can still be applied.`;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
  mockUpdateTasks.mockImplementation(async (updates: readonly unknown[]) => updates.length);
});

const page = (tasks: DAVEWebScheduleItem[]) =>
  render(<DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />);

describe('L2: the task before a very long line slips a week in the editor', () => {
  it('the slip is saved; the preview says "Ready to review" and names the long line (was: "Correct Schedule Issues", disabled)', async () => {
    // In step with its predecessor until the slip.
    const screen = page([closeout, warranty({ startDate: '2026-08-10', finishDate: '2038-07-23' })]);
    fireEvent.press(screen.getByLabelText('Edit Substantial completion'));
    await act(async () => { fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '2026-08-14' } }); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '10'); });
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.getByText(NOTE('2026-08-17'))).toBeTruthy();
    expect(screen.queryByText('Correct Schedule Issues')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({ id: 'closeout', finishDate: '2026-08-14', durationDays: 10 });
  });
});

describe('L2: Gantt, Impact preview, with a very long line that its predecessor now pushes', () => {
  function openImpactPreview(tasks: DAVEWebScheduleItem[]) {
    const screen = page(tasks);
    fireEvent.press(screen.getByText('Gantt'));
    fireEvent.press(screen.getByText(/Impact preview/));
    return screen;
  }

  it('one other task: it says "Safe to review", names the long line, and the other task\'s dates can be applied (was: refused for the whole page)', async () => {
    const screen = openImpactPreview([closeout, warranty(), punch]);
    expect(screen.getByText('Safe to review')).toBeTruthy();
    expect(screen.queryByText('Needs correction')).toBeNull();
    expect(screen.getByText(NOTE('2026-08-10'))).toBeTruthy();
    // The long line is not offered a date it was never given.
    expect(screen.queryByLabelText('Apply calculated dates for Roof warranty period')).toBeNull();

    fireEvent.press(screen.getByLabelText('Apply calculated dates for Punch list'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'punch', startDate: '2026-08-10', finishDate: '2026-08-12' }),
    ));
    expect(screen.queryByText('Correct the dependency issues before applying calculated dates.')).toBeNull();
  });

  it('"Apply all changes" applies the others and says how many were left as they are', async () => {
    const screen = openImpactPreview([closeout, warranty(), punch, clean]);
    fireEvent.press(screen.getByLabelText('Apply all calculated dependency date changes'));
    await waitFor(() => expect(mockUpdateTasks).toHaveBeenCalledTimes(1));
    expect(mockUpdateTasks.mock.calls[0][0].map((update: DAVEWebScheduleItem) => [update.id, update.startDate]))
      .toEqual([['punch', '2026-08-10'], ['clean', '2026-08-10']]);
    await waitFor(() => expect(screen.getByText(
      '2 calculated date changes applied and synced. 1 task could not be calculated and was left as it is; see the note in the impact preview.',
    )).toBeTruthy());
  });

  it('when the long line is the only thing out of step, the panel does not say every date is satisfied', () => {
    const screen = openImpactPreview([closeout, warranty()]);
    expect(screen.getByText(NOTE('2026-08-10'))).toBeTruthy();
    expect(screen.queryByText('Current task dates already satisfy the saved finish-to-start relationships.')).toBeNull();
    expect(screen.getByText('No other date changes are needed. See the note above.')).toBeTruthy();
  });

  // Guards: these already hold.
  it('with nothing out of step, the panel says the dates are satisfied', () => {
    const screen = openImpactPreview([closeout, warranty({ startDate: '2026-08-10', finishDate: '2038-07-23' })]);
    expect(screen.getByText('Current task dates already satisfy the saved finish-to-start relationships.')).toBeTruthy();
    expect(screen.queryByText(/longer than the 2,600 working days/)).toBeNull();
  });

  it('a real fault (a link to a task that is gone) still stops the dates from being applied', async () => {
    const orphan = scheduleItem('orphan', { taskName: 'Orphan', dependencies: after('gone') });
    const screen = openImpactPreview([closeout, punch, orphan]);
    expect(screen.getByText('Needs correction')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Apply calculated dates for Punch list'));
    await act(async () => { await Promise.resolve(); });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});
