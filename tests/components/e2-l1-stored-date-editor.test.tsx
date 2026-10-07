/**
 * Review pass 1, L1, in the desktop schedule editor: a task already stored
 * with a date outside 2000 through 2100 opened with "Needs correction" and a
 * disabled "Correct Schedule Issues" button, so it could not even be renamed
 * until its date was changed. A date left as stored is not judged now; the
 * task is saved with the stored date kept exactly.
 */
import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockUpdateTask = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    snapshot: { projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: 'Lot 9' }] },
    createTask: jest.fn(),
    updateTask: mockUpdateTask,
    updateTasks: jest.fn(),
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
    startDate: '2026-07-20',
    finishDate: '2026-07-24',
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

const pour = scheduleItem('pour', { taskName: 'Pour slab' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
});

function editOldTask(startDate: string, finishDate: string) {
  const old = scheduleItem('old', { taskName: 'Old task', startDate, finishDate });
  const screen = render(<DesktopSchedulePage tasks={[pour, old]} projects={[PROJECT]} selectedProject={PROJECT} />);
  fireEvent.press(screen.getByLabelText('Edit Old task'));
  return screen;
}

describe('L1: a task stored with a date outside 2000 through 2100', () => {
  it.each([
    ['an old file, 1999', '1999-11-01', '1999-11-05'],
    ['a year typed 0202', '0202-07-20', '0202-07-24'],
    ['a year typed 2202', '2202-07-20', '2202-07-24'],
    ['kept as month/day/year text', '5/1/0202', '5/7/0202'],
  ])('%s: it can be renamed, and its dates are saved exactly as stored (was: "Correct Schedule Issues", disabled)', async (_name, startDate, finishDate) => {
    const screen = editOldTask(startDate, finishDate);
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.queryByText(/must be a real date from 2000 through 2100/)).toBeNull();
    expect(screen.queryByText('Correct Schedule Issues')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Name'), 'Old task renamed');
    fireEvent.changeText(screen.getByLabelText('Owner'), 'Site superintendent');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      taskName: 'Old task renamed',
      owner: 'Site superintendent',
      startDate,
      finishDate,
    });
  });

  it('the date itself can be corrected in the same save', async () => {
    const screen = editOldTask('0202-07-20', '0202-07-24');
    fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '2026-07-20' } });
    fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '2026-07-24' } });
    expect(screen.getByText('Ready to review')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({ startDate: '2026-07-20', finishDate: '2026-07-24' });
  });

  // Guard: this already holds.
  it('changing its date to another one outside 2000 through 2100 is still refused, and only that date is named', async () => {
    const screen = editOldTask('1999-11-01', '1999-11-05');
    await act(async () => { fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '1998-11-02' } }); });
    expect(screen.getByText('Needs correction')).toBeTruthy();
    expect(screen.getByText('• Start date must be a real date from 2000 through 2100.')).toBeTruthy();
    expect(screen.queryByText('• Finish date must be a real date from 2000 through 2100.')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('Correct Schedule Issues')); });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});
