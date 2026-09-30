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
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    updateTasks: mockUpdateTasks,
    refreshSnapshot: mockRefreshSnapshot,
  }),
}));

const PROJECT = '2321 Compliance Project';

/** Lets a mocked refresh hand the page a newer task list, as the provider does. */
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

describe('Schedule Builder keeps what it does not edit (audit round 2 F5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateTask.mockResolvedValue(undefined);
  });

  test('an RFI saved from the builder stays an RFI, and its row says RFI', async () => {
    const rfi = scheduleItem('rfi-1', { taskName: 'Confirm curb detail', itemType: 'RFI' });
    const screen = render(<Workspace initial={[rfi]} />);

    expect(screen.getByText('RFI')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Edit Confirm curb detail'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfi-1',
      itemType: 'RFI',
      locationName: 'South Yard',
    })));
  });

  test('a closed RFI can be saved when its type is unchanged', async () => {
    const closedRfi = scheduleItem('rfi-closed', {
      taskName: 'Answered curb RFI',
      itemType: 'RFI',
      status: 'Complete',
      percentComplete: 100,
    });
    const screen = render(<Workspace initial={[closedRfi]} />);

    fireEvent.press(screen.getByLabelText('Edit Answered curb RFI'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfi-closed',
      itemType: 'RFI',
      status: 'Complete',
      locationName: 'South Yard',
    })));
    expect(screen.queryByText(/Reopen RFI before changing its project item type/)).toBeNull();
  });

  test('an imported milestone keeps its milestone text on an unrelated edit', async () => {
    const imported = scheduleItem('imported-milestone', {
      taskName: 'SC - Substantial Completion',
      milestone: 'Substantial Completion',
      isMilestone: false,
      startDate: '2026-10-30',
      finishDate: '2026-10-30',
      durationDays: 0,
    });
    const screen = render(<Workspace initial={[imported]} />);

    fireEvent.press(screen.getByLabelText('Edit SC - Substantial Completion'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'Whole site' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'imported-milestone',
      milestone: 'Substantial Completion',
      locationName: 'Whole site',
    })));
  });

  test('a marked milestone keeps its own milestone text unless it is renamed', async () => {
    const milestone = scheduleItem('marked-milestone', {
      taskName: 'Building dried in',
      milestone: 'Dry-in (owner milestone 4)',
      isMilestone: true,
      startDate: '2026-10-15',
      finishDate: '2026-10-15',
      durationDays: 0,
    });
    const screen = render(<Workspace initial={[milestone]} />);

    fireEvent.press(screen.getByLabelText('Edit Building dried in'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'Roof' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'marked-milestone',
      milestone: 'Dry-in (owner milestone 4)',
      isMilestone: true,
    })));
  });

  test('a new milestone still takes its name as its milestone text', async () => {
    const screen = render(<Workspace initial={[scheduleItem('existing')]} />);

    fireEvent.press(screen.getByText('Add Milestone'));
    fireEvent.changeText(screen.getAllByDisplayValue('')[0], 'Roof complete');
    fireEvent(screen.getByLabelText('Milestone date'), 'change', { target: { value: '2026-10-20' } });
    fireEvent.press(screen.getByText('Create Milestone'));

    await waitFor(() => expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'Roof complete',
      milestone: 'Roof complete',
      itemType: 'Task',
    })));
  });
});

describe('Schedule Builder conflict messages are true (audit round 2 F7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Changed 30 Sep 2026 (audit round 2 follow-up): a refused save no longer
  // loads the latest version over what he typed. It offers the Tasks page's
  // two choices; this test now takes Load Latest Version, which says it
  // discards his edits. The F7 guarantee is unchanged: after it, the next
  // save goes through.
  test('a refused save refreshes; Load Latest Version loads the phone’s version, so the next save goes through', async () => {
    const opened = scheduleItem('task-1', { taskName: 'Place asphalt' });
    const phoneVersion: DAVEWebScheduleItem = {
      ...opened,
      percentComplete: 60,
      status: 'In Progress',
      notes: 'Phone note',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    };
    mockUpdateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockRefreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[opened]} />);

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Your unsaved edits will be discarded\./)).toBeTruthy();
    fireEvent.press(screen.getByText('Load Latest Version'));

    // The editor now holds the phone's version, not the stale form.
    expect(screen.getByText('The latest shared version is loaded. Review it before saving.')).toBeTruthy();
    expect(screen.getByDisplayValue('60')).toBeTruthy();
    expect(screen.getByLabelText('Area').props.value).toBe('North Lot');

    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(2));
    expect(mockUpdateTask.mock.calls[1][0]).toMatchObject({
      id: 'task-1',
      percentComplete: 60,
      notes: 'Phone note',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
  });

  test('a refused single calculated-date change refreshes, as its message says', async () => {
    const phase = scheduleItem('phase', { taskName: 'Site work', wbsCode: '1', isSummary: true });
    const predecessor = scheduleItem('predecessor', {
      taskName: 'Prepare subgrade',
      parentItemId: phase.id,
      status: 'Complete',
      percentComplete: 100,
    });
    const task = scheduleItem('task', {
      taskName: 'Place asphalt',
      parentItemId: phase.id,
      dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
    });
    mockUpdateTask.mockRejectedValueOnce(conflict());
    mockRefreshSnapshot.mockResolvedValue(true);
    const screen = render(<Workspace initial={[phase, predecessor, task]} />);

    fireEvent.press(screen.getByText('Gantt'));
    fireEvent.press(screen.getByText(/Impact preview/));
    fireEvent.press(screen.getByLabelText('Apply calculated dates for Place asphalt'));

    await waitFor(() => expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/The workspace has been refreshed/)).toBeTruthy();
  });
});

describe('A refused Schedule Builder save keeps what he typed (audit round 2 follow-up)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const opened = scheduleItem('task-1', { taskName: 'Place asphalt' });
  const phoneVersion: DAVEWebScheduleItem = {
    ...opened,
    percentComplete: 60,
    status: 'In Progress',
    notes: 'Phone note',
    cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
  };

  async function refusedEdit() {
    mockUpdateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockRefreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[opened]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    return screen;
  }

  test('the refusal leaves his edits in the form and offers the Tasks page’s two choices', async () => {
    const screen = await refusedEdit();

    expect(screen.getByLabelText('Area').props.value).toBe('South Yard');
    expect(screen.getByText(
      'Another device changed this schedule item while you were editing. Choose which version to continue with.',
    )).toBeTruthy();
    expect(screen.getByText(/Apply My Changes saves only the fields you changed/)).toBeTruthy();
    expect(screen.getByText('Load Latest Version')).toBeTruthy();
    // Save would send the version he opened and be refused again (F7).
    fireEvent.press(screen.getByText('Choose a Version Above'));
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
  });

  test('Apply My Changes saves his fields, including edits made after the choice appeared, over the phone’s version', async () => {
    const screen = await refusedEdit();

    fireEvent.changeText(screen.getByDisplayValue('Project manager'), 'Dana Ruiz');
    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(2));
    expect(mockUpdateTask.mock.calls[1][0]).toMatchObject({
      id: 'task-1',
      locationName: 'South Yard',
      owner: 'Dana Ruiz',
      percentComplete: 60,
      status: 'In Progress',
      notes: 'Phone note',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
    await waitFor(() => expect(screen.getByText(
      'The fields you changed were applied to the latest shared version and synced.',
    )).toBeTruthy());
    expect(screen.queryByText('Choose how to resolve this edit')).toBeNull();
  });

  test('Apply My Changes refused again keeps his edits and the choice', async () => {
    const screen = await refusedEdit();
    mockUpdateTask.mockReset();
    mockUpdateTask.mockRejectedValueOnce(conflict());

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(screen.getByText(
      'The schedule item changed again. Review the refreshed version before trying once more.',
    )).toBeTruthy());
    expect(screen.getByLabelText('Area').props.value).toBe('South Yard');
    expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy();
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
