import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 6 (6 Oct 2026), on the two pages that save a
// task: the Tasks page's Edit Task and the Schedule page's editor. A task of
// Lot 9 saved earlier under the name "2375 Main St" (Lot 9's cloud id) is
// repaired by the next save, and the page says so. Synthetic data.

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

const LOT_9_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const MAIN_ST_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const TOLD = 'This task was saved under “2375 Main St” by mistake: it belongs to “Lot 9” in the cloud, so it is now listed under “Lot 9” and your iPhone and iPad can sync it again.';

/** As the old Tasks page save left it: 2375 Main St's name in both places, Lot 9's cloud id. */
function stripe(extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id: 'stripe',
    projectId: LOT_9_ID,
    itemType: 'Task',
    scheduleProjectName: '2375 Main St',
    projectName: '2375 Main St',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: 'Stripe parking',
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
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
    ...extra,
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
  updateTask: jest.fn(async (_item: DAVEWebScheduleItem) => undefined),
  updateTasks: jest.fn(),
  deleteTask: jest.fn(),
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

function workspace(task: DAVEWebScheduleItem, open = [{ id: LOT_9_ID, name: 'Lot 9' }, { id: MAIN_ST_ID, name: '2375 Main St' }]) {
  mockAuth.snapshot = {
    projects: open,
    openCloudProjects: open,
    scheduleItems: [task],
    knownScheduleItems: [task],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-10-06T14:00:02.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
});

const saved = () => mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
const project = (item: DAVEWebScheduleItem) => [item.projectName, item.scheduleProjectName, item.projectId];

describe('the Tasks page repairs it at the next save, and says so (WS1 item 6)', () => {
  async function editAndSave(task: DAVEWebScheduleItem) {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByLabelText(`Expand ${task.locationName}`));
    fireEvent.press(screen.getAllByLabelText(`View details for ${task.taskName}`)[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    fireEvent.changeText(screen.getByLabelText('Next action'), 'Order paint');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });
    return screen;
  }

  it('the task is saved under Lot 9, its cloud id unchanged', async () => {
    workspace(stripe());
    const screen = await editAndSave(stripe());

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(project(saved())).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
    expect(saved().nextAction).toBe('Order paint');
    expect(screen.getByText(`Task updated and synced to the cloud. ${TOLD}`)).toBeTruthy();
  });

  it('guard: when its id names no open project nothing is changed and nothing more is said', async () => {
    workspace(stripe(), [{ id: MAIN_ST_ID, name: '2375 Main St' }]);
    const screen = await editAndSave(stripe());

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(project(saved())).toEqual(['2375 Main St', '2375 Main St', LOT_9_ID]);
    expect(screen.getByText('Task updated and synced to the cloud.')).toBeTruthy();
  });

  it('guard: a task whose name is its id\'s project is saved as before', async () => {
    const right = stripe({ projectName: 'Lot 9', scheduleProjectName: 'Lot 9' });
    workspace(right);
    const screen = await editAndSave(right);

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(project(saved())).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
    expect(screen.getByText('Task updated and synced to the cloud.')).toBeTruthy();
  });
});

describe('the Schedule page repairs it at the next save, and says so (WS1 item 6)', () => {
  it('the item is saved under Lot 9, its cloud id unchanged', async () => {
    workspace(stripe());
    const screen = render(<DesktopSchedulePage tasks={[stripe()]} projects={['2375 Main St', 'Lot 9']} selectedProject="2375 Main St" />);
    fireEvent.press(screen.getByLabelText('Edit Stripe parking'));
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Stripe Co');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(project(saved())).toEqual(['Lot 9', 'Lot 9', LOT_9_ID]);
    expect(saved().contractor).toBe('Stripe Co');
    expect(screen.getByText(`Schedule item updated and synced. ${TOLD}`)).toBeTruthy();
  });
});
