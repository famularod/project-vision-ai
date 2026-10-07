/**
 * Whole-app audit A12 pass 4 residual R2 (30 Sep 2026), Schedule Builder.
 *
 * The builder does not show a phase's predecessors, lag, duration or
 * baseline dates, but its save wrote a phase with no dependencies, so
 * renaming a phase on the web wiped the dependencies set on the phone, and
 * Apply My Changes after a save conflict did the same to the phone's newer
 * ones. A builder save of a phase now leaves every field the builder does
 * not show for it exactly as stored; only the fields David changed are
 * written.
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

const PROJECT = '2321 Compliance Project';

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  updateTask: jest.fn(),
  createTask: jest.fn(),
  refreshSnapshot: jest.fn(async () => true),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));
// A save that adds a predecessor first reads the cloud, to refuse a link that would close a circle with a link made
// elsewhere (WS1 item 7). The cloud here holds no link.
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(async () => ({ scheduleItems: [], knownScheduleItems: [] })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.createTask.mockResolvedValue(undefined);
  mockAuth.refreshSnapshot.mockResolvedValue(true);
});

let showTasks: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
function Workspace({ initial }: { initial: DAVEWebScheduleItem[] }) {
  const [tasks, setTasks] = useState(initial);
  showTasks = next => act(() => setTasks(next));
  return <DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />;
}

const mobilization = scheduleItem('mobilize', { taskName: 'Mobilize', wbsCode: '0' });
const permits = scheduleItem('permits', { taskName: 'Permits', wbsCode: '0.1' });

/** A phase whose predecessors, lag and duration were set on the phone. */
const phase = scheduleItem('phase', {
  taskName: 'Site work',
  wbsCode: '1',
  isSummary: true,
  startDate: '10/01/2026',
  finishDate: '10/30/2026',
  baselineStartDate: '10/01/2026',
  baselineFinishDate: '10/30/2026',
  durationDays: 22,
  dependencies: [
    { predecessorItemId: 'mobilize', type: 'FS', lagDays: 2 },
    { predecessorItemId: 'permits', type: 'FS', lagDays: 0 },
  ],
});

function renamePhase(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByLabelText('Edit Site work'));
  fireEvent.changeText(screen.getByDisplayValue('Site work'), 'Site work and paving');
}

describe('Schedule Builder keeps a phase’s phone-set fields (A12 pass 4 R2)', () => {
  test('renaming a phase keeps its dependencies, duration and baselines', async () => {
    const screen = render(<Workspace initial={[mobilization, permits, phase]} />);
    renamePhase(screen);
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const saved = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(saved).toMatchObject({
      taskName: 'Site work and paving',
      isSummary: true,
      isMilestone: false,
      durationDays: 22,
      startDate: '10/01/2026',
      finishDate: '10/30/2026',
      baselineStartDate: '10/01/2026',
      baselineFinishDate: '10/30/2026',
    });
    expect(saved.dependencies).toEqual(phase.dependencies);
  });

  test('Apply My Changes on a phase keeps the phone’s newer dependencies', async () => {
    const phoneVersion: DAVEWebScheduleItem = {
      ...phase,
      durationDays: 24,
      dependencies: [{ predecessorItemId: 'permits', type: 'FS', lagDays: 3 }],
      updatedAt: '2026-09-30T14:05:00.000Z',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    };
    mockAuth.updateTask
      .mockRejectedValueOnce(new DAVEWebTaskMutationError(
        'conflict',
        'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
      ))
      .mockResolvedValue(undefined);
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks([mobilization, permits, phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[mobilization, permits, phase]} />);
    renamePhase(screen);
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const applied = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(applied).toMatchObject({
      taskName: 'Site work and paving',
      durationDays: 24,
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
    expect(applied.dependencies).toEqual(phoneVersion.dependencies);
  });

  test('Apply My Changes keeps dependencies the phone added after the web opened a phase with none', async () => {
    const bare = { ...phase, dependencies: [] };
    const phoneVersion: DAVEWebScheduleItem = {
      ...bare,
      dependencies: [{ predecessorItemId: 'mobilize', type: 'FS', lagDays: 1 }],
      updatedAt: '2026-09-30T14:05:00.000Z',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    };
    mockAuth.updateTask
      .mockRejectedValueOnce(new DAVEWebTaskMutationError('conflict', 'This task changed on another device.'))
      .mockResolvedValue(undefined);
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks([mobilization, permits, phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[mobilization, permits, bare]} />);
    renamePhase(screen);
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    expect(mockAuth.updateTask.mock.calls[1][0].dependencies).toEqual(phoneVersion.dependencies);
  });

  test('a task’s predecessors are still written from the builder', async () => {
    const task = scheduleItem('paving', { taskName: 'Place asphalt', wbsCode: '2' });
    const screen = render(<Workspace initial={[mobilization, task]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent.press(screen.getByRole('checkbox', { name: /Mobilize/ }));
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0].dependencies).toEqual([
      { predecessorItemId: 'mobilize', type: 'FS', lagDays: 0 },
    ]);
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
    startDate: '09/21/2026',
    finishDate: '09/22/2026',
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
