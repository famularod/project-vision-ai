import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { DAVEWebAuthorizationError, DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review pass 1, web L6 (6 Oct 2026; caused by WS1 item 8), on the Tasks page. After Delete Task, when the links
// other tasks had to the deleted task could not all be taken away, he was told they "were being changed on another
// device at that moment" whatever had happened, and the count was of saved rows, hidden ones included. Now: the true
// reason for each kind of failure, a count of the tasks he can open, and one task that cannot be saved no longer
// keeps the others' links. Synthetic data; the harness of web-ws1-task-delete-removes-links-page.test.tsx.

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

const DELETED = 'Task deleted and protected from returning on another device.';
const conflict = () => new DAVEWebTaskMutationError('conflict', 'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.');
const notSaved = () => new DAVEWebTaskMutationError('write_failed', 'The task could not be updated. Refresh the workspace and try again.');
const savedIn = (call: number) => (mockAuth.updateTasks.mock.calls[call][0] as DAVEWebScheduleItem[]).map(item => item.id);
/** The cloud as read again after the first save failed: both tasks still list Framing. */
const cloudStillLists = () => jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue(snapshotOf([
  task('roofing', 'Roofing', ['framing'], '2026-10-06T18:00:05.000Z'),
  task('siding', 'Siding', ['framing', 'roofing'], '2026-10-06T18:00:03.000Z'),
]) as never);
const notice = (screen: ReturnType<typeof render>) =>
  screen.getAllByText(/^Task deleted and protected from returning on another device\./).map(node => [node.props.children].flat().join(''));

describe('after Delete Task, a link that could not be taken: the true reason, and a count of what he can open (review pass 1, web L6)', () => {
  it('another device was changing ONE of the two tasks: that one is counted, with that reason, and the other task\'s link is still taken', async () => {
    cloudStillLists();
    mockAuth.updateTasks.mockImplementation(async (items: readonly DAVEWebScheduleItem[]) => {
      // The first save, of both, is refused; then Roofing is refused again and Siding goes through.
      if (items.length > 1 || items[0].id === 'roofing') throw conflict();
      return items.length;
    });
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(3));
    expect([savedIn(0), savedIn(1), savedIn(2)]).toEqual([['roofing', 'siding'], ['roofing'], ['siding']]);
    expect(notice(screen)).toEqual([`${DELETED} 1 other task still lists it as a predecessor, because it was being changed on another device at that moment. Open that task in Schedule and untick the deleted task.`]);
  });

  it('the save failed and it was no other device (the cloud could be read again): "could not be saved", and no device is blamed', async () => {
    cloudStillLists();
    mockAuth.updateTasks.mockRejectedValue(notSaved());
    const screen = await deleteFraming();

    // The first of them fails the same way: the rest are not tried one by one against a cloud that is not taking saves.
    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(2));
    expect(notice(screen)).toEqual([`${DELETED} 2 other tasks still list it as a predecessor, because the change to them could not be saved just then (the connection may have dropped). Open those tasks in Schedule and untick the deleted task.`]);
    expect(notice(screen)[0]).not.toMatch(/another device at that moment/);
  });

  it('the connection dropped (the save failed, and the cloud could not be read again): "up to", and no device is blamed', async () => {
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new Error('Failed to fetch'));
    mockAuth.updateTasks.mockRejectedValue(new Error('Failed to fetch'));
    const screen = await deleteFraming();

    await waitFor(() => expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTasks).toHaveBeenCalledTimes(1);
    expect(notice(screen)).toEqual([`${DELETED} Up to 2 other tasks may still list it as a predecessor: removing those links was interrupted, and the schedule could not then be read from the cloud to finish (the connection may have dropped). Open those tasks in Schedule and untick the deleted task where it is still listed.`]);
  });

  it('his sign-in was no longer accepted: said so, with "Sign in again"', async () => {
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new DAVEWebAuthorizationError('Sign in is required for the Vitruvius desktop pilot.'));
    mockAuth.updateTasks.mockRejectedValue(new DAVEWebAuthorizationError('Sign in is required for the Vitruvius desktop pilot.'));
    const screen = await deleteFraming();

    await waitFor(() => expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1));
    expect(notice(screen)).toEqual([`${DELETED} Up to 2 other tasks may still list it as a predecessor, because this browser's sign-in was no longer accepted before every link was removed. Sign in again, then open those tasks in Schedule and untick the deleted task where it is still listed.`]);
  });

  it('only ONE task was to lose the link, and its save failed with no second read: that one task, not "up to"', async () => {
    mockAuth.snapshot = snapshotOf([task('framing', 'Framing'), task('roofing', 'Roofing', ['framing'])]);
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new Error('Failed to fetch'));
    mockAuth.updateTasks.mockRejectedValue(new Error('Failed to fetch'));
    const screen = await deleteFraming();

    await waitFor(() => expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1));
    expect(notice(screen)).toEqual([`${DELETED} 1 other task still lists it as a predecessor, because the change to it could not be saved just then (the connection may have dropped). Open that task in Schedule and untick the deleted task.`]);
  });

  it('guard: only one task was to lose the link, another device was changing it, and the cloud could not be read again: that reason stands', async () => {
    mockAuth.snapshot = snapshotOf([task('framing', 'Framing'), task('roofing', 'Roofing', ['framing'])]);
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new Error('Failed to fetch'));
    mockAuth.updateTasks.mockRejectedValue(conflict());
    const screen = await deleteFraming();

    await waitFor(() => expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1));
    expect(notice(screen)).toEqual([`${DELETED} 1 other task still lists it as a predecessor, because it was being changed on another device at that moment. Open that task in Schedule and untick the deleted task.`]);
  });

  it('one task shown and one row not shown were to lose the link, the save was cut short and the cloud could not be read again: one task, which "may" still list it', async () => {
    const shown = [task('framing', 'Framing'), task('roofing', 'Roofing', ['framing'])];
    mockAuth.snapshot = { ...snapshotOf(shown), knownScheduleItems: [...shown, task('roofing-earlier-row', 'Roofing', ['framing'])] };
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new Error('Failed to fetch'));
    mockAuth.updateTasks.mockRejectedValue(new Error('Failed to fetch'));
    const screen = await deleteFraming();

    await waitFor(() => expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1));
    expect(notice(screen)).toEqual([`${DELETED} 1 other task may still list it as a predecessor: removing the links was interrupted, and the schedule could not then be read from the cloud to finish (the connection may have dropped). Open that task in Schedule and untick the deleted task if it is still listed.`]);
  });

  it('a saved row the schedule does not show is not counted: he is not sent to open a task he cannot open', async () => {
    // Roofing's earlier row, hidden since a newer master moved Roofing, lists Framing too. Its save is refused; Roofing's goes through.
    const shown = [task('framing', 'Framing'), task('roofing', 'Roofing', ['framing'])];
    const hidden = task('roofing-earlier-row', 'Roofing', ['framing']);
    const holds = () => ({ ...snapshotOf(shown), knownScheduleItems: [...shown, hidden] });
    mockAuth.snapshot = holds();
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue(holds() as never);
    mockAuth.updateTasks.mockImplementation(async (items: readonly DAVEWebScheduleItem[]) => {
      if (items.length > 1 || items[0].id === 'roofing-earlier-row') throw conflict();
      return items.length;
    });
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(3));
    expect(notice(screen)).toEqual([DELETED]);
  });

  it('a task that listed it was itself deleted on another device meanwhile: it lists nothing any more, and is not counted', async () => {
    cloudStillLists();
    mockAuth.updateTasks.mockImplementation(async (items: readonly DAVEWebScheduleItem[]) => {
      if (items.length > 1) throw conflict();
      if (items[0].id === 'roofing') throw new DAVEWebTaskMutationError('deleted', 'This task was deleted on another device. The workspace has been refreshed.');
      return items.length;
    });
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(3));
    expect(notice(screen)).toEqual([DELETED]);
  });

  it('when every link is taken on the second try, each on its own, nothing more is said', async () => {
    cloudStillLists();
    mockAuth.updateTasks.mockRejectedValueOnce(conflict());
    const screen = await deleteFraming();

    await waitFor(() => expect(mockAuth.updateTasks).toHaveBeenCalledTimes(3));
    expect(notice(screen)).toEqual([DELETED]);
  });
});
