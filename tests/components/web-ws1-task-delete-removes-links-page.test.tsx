import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 8 (6 Oct 2026), on the Tasks page: Delete
// Task also takes the links other tasks had to the deleted task, and says so
// when one could not be taken. Synthetic data; the harness of
// audit-a3-p9-web-task-project.test.tsx.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/tasks',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));

const PROJECT = 'Alpha';
const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';

function task(id: string, taskName: string, predecessors: string[] = [], cloudUpdatedAt = '2026-10-01T12:00:01.000Z'): DAVEWebScheduleItem {
  return {
    id,
    projectId: PROJECT_ID,
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName,
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'David',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt,
  } as DAVEWebScheduleItem;
}

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'david@example.com',
  sessionExpiresAt: null,
  snapshot: null,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-10-06T14:00:02.000Z',
    lastAttemptAt: '2026-10-06T14:00:02.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  getArtifactUrl: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTasks: jest.fn(async (items: readonly DAVEWebScheduleItem[]) => items.length),
  deleteTask: jest.fn(async (_item: DAVEWebScheduleItem) => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

jest.setTimeout(30_000);

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

const tasks = () => [task('framing', 'Framing'), task('roofing', 'Roofing', ['framing']), task('siding', 'Siding', ['framing', 'roofing'])];
const snapshotOf = (items: DAVEWebScheduleItem[]) => ({
  projects: [{ id: PROJECT_ID, name: PROJECT }],
  openCloudProjects: [{ id: PROJECT_ID, name: PROJECT }],
  scheduleItems: items,
  knownScheduleItems: items,
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: '2026-10-06T14:00:02.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.deleteTask.mockResolvedValue(undefined);
  mockAuth.updateTasks.mockImplementation(async (items: readonly DAVEWebScheduleItem[]) => items.length);
  mockAuth.snapshot = snapshotOf(tasks());
});

async function deleteFraming() {
  const screen = render(<DesktopReadOnlyShell page="tasks" />);
  fireEvent.press(screen.getByLabelText('Expand Lot'));
  fireEvent.press(screen.getAllByLabelText('View details for Framing')[0]);
  // The task's own Delete, in its details panel (the last one on the page).
  fireEvent.press(screen.getAllByText('Delete').at(-1)!);
  expect(screen.getByText('Delete “Framing”?')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Delete Task')); });
  return screen;
}
const written = (call: number) => (mockAuth.updateTasks.mock.calls[call][0] as DAVEWebScheduleItem[])
  .map(item => [item.id, (item.dependencies ?? []).map(link => link.predecessorItemId), item.cloudUpdatedAt]);

describe('Delete Task on the web\'s Tasks page (WS1 item 8)', () => {
  it('after the delete, the tasks that started after it are saved without that link', async () => {
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(1));
    expect(mockAuth.deleteTask).toHaveBeenCalledTimes(1);
    expect(mockAuth.deleteTask.mock.invocationCallOrder[0]).toBeLessThan(mockAuth.updateTasks.mock.invocationCallOrder[0]);
    expect(written(0)).toEqual([
      ['roofing', [], '2026-10-01T12:00:01.000Z'],
      ['siding', ['roofing'], '2026-10-01T12:00:01.000Z'],
    ]);
    expect(screen.getByText('Task deleted and protected from returning on another device.')).toBeTruthy();
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });

  it('one of them was changed on another device just then: the cloud is read and the rest is done from its newer copy', async () => {
    mockAuth.updateTasks.mockRejectedValueOnce(new Error('changed elsewhere'));
    // By then Roofing went through; Siding has a newer revision, and still lists the deleted task.
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue(snapshotOf([
      task('roofing', 'Roofing', [], '2026-10-06T18:00:05.000Z'),
      task('siding', 'Siding', ['framing', 'roofing'], '2026-10-06T18:00:03.000Z'),
    ]) as never);
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(2));
    expect(written(1)).toEqual([['siding', ['roofing'], '2026-10-06T18:00:03.000Z']]);
    expect(screen.getByText('Task deleted and protected from returning on another device.')).toBeTruthy();
  });

  it('when a link still could not be taken, he is told how many tasks still list it and what to do', async () => {
    // The cloud's own refusal of a task another device changed (review pass 1, web L6: this sentence had been given
    // for any error at all, a plain one included; the other kinds are in web-ws3-task-delete-links-left-page).
    mockAuth.updateTasks.mockRejectedValue(new DAVEWebTaskMutationError('conflict', 'This task changed on another device.'));
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue(snapshotOf([
      task('roofing', 'Roofing', [], '2026-10-06T18:00:05.000Z'),
      task('siding', 'Siding', ['framing', 'roofing'], '2026-10-06T18:00:03.000Z'),
    ]) as never);
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Task deleted and protected from returning on another device. 1 other task still lists it as a predecessor, because it was being changed on another device at that moment. Open that task in Schedule and untick the deleted task.')).toBeTruthy();
  });

  it('guard: a task nobody waits for is deleted as before, with no other task written', async () => {
    mockAuth.snapshot = snapshotOf([task('framing', 'Framing'), task('roofing', 'Roofing')]);
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.deleteTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTasks).not.toHaveBeenCalled();
    expect(screen.getByText('Task deleted and protected from returning on another device.')).toBeTruthy();
  });

  it('guard: a delete the cloud refuses writes no other task', async () => {
    mockAuth.deleteTask.mockRejectedValue(new Error('The task deletion marker could not be saved. Nothing was deleted.'));
    await deleteFraming();
    expect(mockAuth.updateTasks).not.toHaveBeenCalled();
  });
});

describe('a link left behind by an earlier delete can be removed in the Schedule editor (WS1 item 8)', () => {
  // Before: the task whose predecessor was deleted showed "Missing", its editor listed nothing to untick, and Save
  // read "Correct Schedule Issues": it could not be saved on the web at all.
  it('the link is listed and ticked; unticking it frees Save, and the task is saved without it', async () => {
    mockAuth.updateTask.mockResolvedValue(undefined);
    const screen = render(<DesktopSchedulePage tasks={[task('roofing', 'Roofing', ['framing-deleted']), task('survey', 'Survey')]} projects={[PROJECT]} selectedProject={PROJECT} />);
    fireEvent.press(screen.getByLabelText('Edit Roofing'));

    expect(screen.getByText('This item is set to start after a task that is no longer in the schedule (deleted, or on a schedule that is not the current one). The schedule cannot place it until that link is removed. Untick it below, then save.')).toBeTruthy();
    expect(screen.getByLabelText('A task no longer in the schedule').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('Correct Schedule Issues')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('A task no longer in the schedule'));
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0].dependencies).toEqual([]);
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });

  it('guard: a task whose predecessors are all in the schedule shows no such line', () => {
    const screen = render(<DesktopSchedulePage tasks={[task('roofing', 'Roofing', ['survey']), task('survey', 'Survey')]} projects={[PROJECT]} selectedProject={PROJECT} />);
    fireEvent.press(screen.getByLabelText('Edit Roofing'));
    expect(screen.queryByLabelText('A task no longer in the schedule')).toBeNull();
    expect(screen.queryByText(/no longer in the schedule/)).toBeNull();
  });
});
