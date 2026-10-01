/**
 * Whole-app audit A12 pass 3 (30 Sep 2026), M1 and M2.
 *
 * M1: the Schedule Builder form holds dates as 2026-10-05 while stored tasks
 * hold 10/05/2026, and "Apply My Changes" compared them as text. Dates David
 * never touched counted as his change and put back the dates the phone had
 * just moved (a lookahead's included). Untouched now means the same calendar
 * day as the version he opened.
 *
 * M2: every builder save wrote its dates as 2026-10-05, while schedule files
 * and the phone use 10/05/2026. The builder now keeps the format the task
 * already had (an unchanged date keeps its exact text), and a new item takes
 * the app's MM/DD/YYYY.
 */
import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockCreateTask = jest.fn();
const mockUpdateTask = jest.fn();
const mockUpdateTasks = jest.fn();
const mockRefreshSnapshot = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    // A new item's cloud project id now comes from the open projects, not
    // from another task of the project (whole-app audit A12 pass 5 M1,
    // 30 Sep 2026), so the workspace's project list is given here.
    snapshot: {
      projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: '2321 Compliance Project' }],
    },
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    updateTasks: mockUpdateTasks,
    refreshSnapshot: mockRefreshSnapshot,
  }),
}));

const PROJECT = '2321 Compliance Project';

let showTasks: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
function Workspace({ initial }: { initial: DAVEWebScheduleItem[] }) {
  const [tasks, setTasks] = useState(initial);
  showTasks = next => act(() => setTasks(next));
  return <DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />;
}

function conflict() {
  return new DAVEWebTaskMutationError(
    'conflict',
    'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
  mockCreateTask.mockResolvedValue(undefined);
  mockUpdateTasks.mockResolvedValue(1);
});

describe('Apply My Changes keeps the dates another device moved (A12 pass 3 M1)', () => {
  // Imported 10/05–10/09; the phone then took a lookahead that moved it to
  // 10/12–10/16 while the web editor was open on the imported version.
  const imported = scheduleItem('paving', {
    taskName: 'Place asphalt',
    startDate: '10/05/2026',
    finishDate: '10/09/2026',
    baselineStartDate: '10/05/2026',
    baselineFinishDate: '10/09/2026',
    durationDays: 5,
  });
  const phoneVersion: DAVEWebScheduleItem = {
    ...imported,
    startDate: '10/12/2026',
    finishDate: '10/16/2026',
    baselineStartDate: '10/06/2026',
    baselineFinishDate: '10/10/2026',
    lookaheadOverlay: {
      masterStartDate: '10/05/2026',
      masterFinishDate: '10/09/2026',
      masterPercentComplete: 0,
      lookaheads: [{ batchId: 'lookahead-1', startDate: '10/12/2026', finishDate: '10/16/2026' }],
    },
    updatedAt: '2026-09-30T14:05:00.000Z',
    cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
  };

  async function refusedAreaEdit() {
    mockUpdateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockRefreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[imported]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    return screen;
  }

  test('David changed only the area: the phone’s lookahead dates, baseline and record stay', async () => {
    const screen = await refusedAreaEdit();

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(2));
    const written = mockUpdateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({
      id: 'paving',
      locationName: 'South Yard',
      startDate: '10/12/2026',
      finishDate: '10/16/2026',
      baselineStartDate: '10/06/2026',
      baselineFinishDate: '10/10/2026',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
    expect(written.lookaheadOverlay).toEqual(phoneVersion.lookaheadOverlay);
  });

  test('a date David did change still wins, written as the task stores dates', async () => {
    const screen = await refusedAreaEdit();

    fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '2026-10-20' } });
    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(2));
    expect(mockUpdateTask.mock.calls[1][0]).toMatchObject({
      locationName: 'South Yard',
      startDate: '10/12/2026',
      finishDate: '10/20/2026',
      baselineStartDate: '10/06/2026',
    });
  });
});

describe('The builder writes dates the way the task stores them (A12 pass 3 M2)', () => {
  test('an area-only save leaves every date exactly as stored', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: '10/05/2026',
      finishDate: '10/09/2026',
      baselineStartDate: '10/05/2026',
      baselineFinishDate: '10/09/2026',
    });
    const screen = render(<Workspace initial={[stored]} />);

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    // The date inputs still show the browser's form of the same days.
    expect(screen.getByLabelText('Start date').props.value).toBe('2026-10-05');
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      locationName: 'South Yard',
      startDate: '10/05/2026',
      finishDate: '10/09/2026',
      baselineStartDate: '10/05/2026',
      baselineFinishDate: '10/09/2026',
    });
  });

  test('a changed date on a 10/05/2026 task is saved as 10/07/2026, a baseline taken from it too', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: '10/05/2026',
      finishDate: '10/09/2026',
    });
    const screen = render(<Workspace initial={[stored]} />);

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '2026-10-07' } });
    fireEvent.press(screen.getByLabelText('Use current dates as baseline'));
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      startDate: '10/07/2026',
      finishDate: '10/09/2026',
      baselineStartDate: '10/07/2026',
      baselineFinishDate: '10/09/2026',
    });
  });

  test('a task stored as 2026-10-05 keeps that format', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: '2026-10-05',
      finishDate: '2026-10-09',
    });
    const screen = render(<Workspace initial={[stored]} />);

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '2026-10-12' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      startDate: '2026-10-05',
      finishDate: '2026-10-12',
    });
  });

  test('a new milestone is saved with the app’s MM/DD/YYYY date', async () => {
    const screen = render(<Workspace initial={[scheduleItem('existing')]} />);

    fireEvent.press(screen.getByText('Add Milestone'));
    fireEvent.changeText(screen.getAllByDisplayValue('')[0], 'Roof complete');
    fireEvent(screen.getByLabelText('Milestone date'), 'change', { target: { value: '2026-10-20' } });
    fireEvent.press(screen.getByText('Create Milestone'));

    await waitFor(() => expect(mockCreateTask).toHaveBeenCalledTimes(1));
    expect(mockCreateTask.mock.calls[0][0]).toMatchObject({
      taskName: 'Roof complete',
      startDate: '10/20/2026',
      finishDate: '10/20/2026',
    });
  });

  test('applied calculated dates on a 10/05/2026 task are written the same way', async () => {
    const phase = scheduleItem('phase', { taskName: 'Site work', wbsCode: '1', isSummary: true });
    const predecessor = scheduleItem('predecessor', {
      taskName: 'Prepare subgrade',
      parentItemId: phase.id,
      startDate: '10/05/2026',
      finishDate: '10/09/2026',
      status: 'Complete',
      percentComplete: 100,
    });
    const task = scheduleItem('task', {
      taskName: 'Place asphalt',
      parentItemId: phase.id,
      startDate: '10/05/2026',
      finishDate: '10/06/2026',
      dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
    });
    const screen = render(<Workspace initial={[phase, predecessor, task]} />);

    fireEvent.press(screen.getByText('Gantt'));
    fireEvent.press(screen.getByText(/Impact preview/));
    fireEvent.press(screen.getByLabelText('Apply calculated dates for Place asphalt'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      id: 'task',
      startDate: '10/12/2026',
      finishDate: '10/13/2026',
    });
  });
});

function scheduleItem(
  id: string,
  overrides: Partial<DAVEWebScheduleItem> = {},
): DAVEWebScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 2,
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
