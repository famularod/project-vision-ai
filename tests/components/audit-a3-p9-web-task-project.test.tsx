/**
 * Whole-app audit A3 pass 9 M1 (30 Sep 2026): on the web Tasks page,
 * editing a task and choosing another project (Lot 9 → 2375 Main St) saved
 * the row with the new project's name and the old project's cloud id. The
 * phone then refused every upload of that task ("project name and cloud
 * identity disagree": 0 uploads, retried) and told David to check the task's
 * project on the phone, which cannot change it; Ask ECOS counted it under
 * the old project by id.
 *
 * Now a task's project is shown, not editable, when editing on the Tasks
 * page, as in the Schedule Builder, and no web save of an existing task
 * changes its project. The row the web saves goes through the phone's real
 * upload (uploadPendingChanges against a mocked cloud with both projects
 * open).
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { ScheduleItem } from '../../types';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  },
}));

const mockLot9Id = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const mockMainStId = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const mockOk = <T,>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockUpsertScheduleItem = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }));

// The phone's cloud: Lot 9 and 2375 Main St are both open.
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  listProjects: () => mockOk([
    { id: mockLot9Id, name: 'Lot 9' },
    { id: mockMainStId, name: '2375 Main St' },
  ]),
  listArchivedProjects: () => mockOk([]),
  listDAVESyncTombstones: () => mockOk([]),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => mockOk(tombstones),
  listScheduleItems: () => mockOk([]),
  // A new task's row, read by its id when the list does not have it (whole-app
  // audit A7 pass 17 L-4: every upload whose row the list missed reads it,
  // a whole copy too): the cloud has none, so the phone's copy is written.
  getScheduleItem: () => mockOk(null),
  upsertScheduleItem: (...args: unknown[]) => mockUpsertScheduleItem(...args),
  listReferenceDocuments: () => mockOk([]),
  listDAVEStorageCleanupIntents: () => mockOk([]),
  removeProtectedStorageObject: () => mockOk(null),
  recordDAVEStorageCleanupAttempt: () => mockOk(null),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: null,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-09-30T14:00:02.000Z',
    lastAttemptAt: '2026-09-30T14:00:02.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  signInWithPassword: jest.fn(),
  signOutOfDesktop: jest.fn(),
  refreshSnapshot: jest.fn(async () => true),
  getArtifactUrl: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTasks: jest.fn(),
  deleteTask: jest.fn(),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  setCurrentSchedule: jest.fn(),
  saveReport: jest.fn(),
  restoreMissingTasks: jest.fn(),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { getOfflineQueue, runScheduleItemCloudSync, uploadPendingChanges } from '../../services/SyncService';

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

beforeEach(() => {
  mockStorage.clear();
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.createTask.mockResolvedValue(undefined);
});

const LOCKED = 'A task stays in its project. To move it, add it in the right project, then delete it here.';

const lot9Task = scheduleItem('stripe', {
  taskName: 'Stripe parking',
  projectId: mockLot9Id,
  projectName: 'Lot 9',
  scheduleProjectName: 'Lot 9',
});

function openEditor(task: DAVEWebScheduleItem) {
  mockAuth.snapshot = snapshotWith(task);
  const screen = render(<DesktopReadOnlyShell page="tasks" />);
  fireEvent.press(screen.getByLabelText(`Expand ${task.locationName}`));
  fireEvent.press(screen.getAllByLabelText(`View details for ${task.taskName}`)[0]);
  fireEvent.press(screen.getByText('Edit Task'));
  return screen;
}

describe('a task edited on the web Tasks page keeps its project (A3 pass 9 M1)', () => {
  test('whatever the editor offers for the project, the saved row uploads from the phone', async () => {
    const screen = openEditor(lot9Task);
    // Every way the editor offers to move it to 2375 Main St.
    screen.queryAllByLabelText('Project: 2375 Main St').forEach(choice => fireEvent.press(choice));
    screen.queryAllByLabelText('Project, custom value').forEach(input => (
      fireEvent.changeText(input, '2375 Main St')
    ));
    fireEvent.changeText(screen.getByLabelText('Location / area, custom value'), 'South Lot');
    fireEvent.press(screen.getByText('Save Task Changes'));
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const saved = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(saved.locationName).toBe('South Lot');

    // The phone gets the row, David changes its progress there, and it
    // uploads. Before the fix: "The saved item project name and cloud
    // identity disagree, so it was not uploaded", 0 uploaded, 1 queued.
    const { cloudUpdatedAt: _cloudUpdatedAt, ...row } = saved;
    const onPhone: ScheduleItem = { ...row, percentComplete: 40, updatedAt: '2026-09-30T15:00:00.000Z' };
    const result = await runScheduleItemCloudSync(onPhone);
    expect(result.errors).toEqual([]);
    expect([result.uploaded, result.queued]).toEqual([1, 0]);
    expect((await uploadPendingChanges()).errors).toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'stripe',
      projectId: mockLot9Id,
      projectName: 'Lot 9',
    }));
    expect(saved).toMatchObject({ projectId: mockLot9Id, projectName: 'Lot 9', scheduleProjectName: 'Lot 9' });
  });

  test('the project is shown, with how to move a misfiled task; Add Task still offers the projects', () => {
    const screen = openEditor(lot9Task);
    expect(screen.queryByLabelText('Project, custom value')).toBeNull();
    expect(screen.queryByLabelText('Project: 2375 Main St')).toBeNull();
    expect(screen.getByText(LOCKED)).toBeTruthy();
    expect(screen.getAllByText('Lot 9').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.press(screen.getByText('Add Task'));
    expect(screen.getByLabelText('Project: 2375 Main St')).toBeTruthy();
    expect(screen.getByLabelText('Project, custom value')).toBeTruthy();
    expect(screen.queryByText(LOCKED)).toBeNull();
  });
});

function snapshotWith(task: DAVEWebScheduleItem): DAVEWebReadOnlySnapshot {
  return {
    projects: [
      { id: mockLot9Id, name: 'Lot 9' },
      { id: mockMainStId, name: '2375 Main St' },
    ] as never,
    scheduleItems: [task],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-09-30T14:00:02.000Z',
  };
}

function scheduleItem(
  id: string,
  overrides: Partial<DAVEWebScheduleItem> = {},
): DAVEWebScheduleItem {
  return {
    id,
    projectId: mockLot9Id,
    itemType: 'Task',
    scheduleProjectName: 'Lot 9',
    projectName: 'Lot 9',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '10/05/2026',
    finishDate: '10/09/2026',
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
