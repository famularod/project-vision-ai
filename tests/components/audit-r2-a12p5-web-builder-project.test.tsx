/**
 * Whole-app audit A12 pass 5 M1 (30 Sep 2026). The Schedule Builder took a
 * new item's cloud project id from another task of the project, not from
 * the project list:
 * (A) a project with no tasks yet: Add Phase / Add Task said "Choose a
 *     current cloud project before saving this task." and saved nothing, so
 *     a schedule could not be started from scratch on the web;
 * (B) a project holding one task saved with another project's id (the
 *     known web-move case): every new builder item copied that wrong id, and
 *     the phone then refused to upload edits to them ("project name and
 *     cloud identity disagree").
 *
 * Now a new item's id is looked up by its project's name among the open
 * cloud projects, as the Tasks page does; when there is not exactly one
 * open project of that name nothing is saved and he is told why. The Tasks
 * page uses the same rule. The rows are put through the phone's real upload
 * (runScheduleItemCloudSync against a mocked cloud with both projects open).
 */
import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
  // Independent review R02: a queued task the list does not hold is read by its id before it is sent as new.
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
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { runScheduleItemCloudSync } from '../../services/SyncService';

const OLD_REFUSAL = 'Choose a current cloud project before saving this task.';
const NOT_OPEN = (name: string) =>
  `This item was not saved: “${name}” is not one of your open projects in the cloud. Check the project on your iPhone or iPad, then try again.`;
const MORE_THAN_ONE = (name: string) =>
  `This item was not saved: more than one open project is named “${name}”, so Vitruvius cannot tell which one it belongs to. Check your projects on your iPhone or iPad.`;

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

beforeEach(() => {
  mockStorage.clear();
  jest.clearAllMocks();
  mockAuth.createTask.mockResolvedValue(undefined);
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.snapshot = snapshotWith([]);
});

function Builder({ project, tasks }: { project: string; tasks: DAVEWebScheduleItem[] }) {
  const [shown] = useState(tasks);
  return (
    <DesktopSchedulePage
      tasks={shown}
      projects={mockAuth.snapshot.projects.map((row: { name: string }) => row.name)}
      selectedProject={project}
    />
  );
}

async function createInBuilder(
  screen: ReturnType<typeof render>,
  kind: 'Phase' | 'Task',
  name: string,
) {
  fireEvent.press(screen.getByText(`Add ${kind}`));
  fireEvent.changeText(screen.getAllByDisplayValue('')[0], name);
  await act(async () => { fireEvent.press(screen.getByText(`Create ${kind}`)); });
}

/** The phone receives the web's new row, changes its progress, and uploads it. */
async function phoneUploads(row: DAVEWebScheduleItem) {
  const { cloudUpdatedAt: _cloudUpdatedAt, ...item } = row;
  const onPhone: ScheduleItem = { ...item, percentComplete: 30, updatedAt: '2026-09-30T15:00:00.000Z' };
  return runScheduleItemCloudSync(onPhone);
}

describe('Schedule Builder: a new item takes its project’s own cloud id (A12 pass 5 M1)', () => {
  test('(A) a project with no tasks yet: Add Phase and Add Task save, with the project’s id', async () => {
    const screen = render(<Builder project="Lot 9" tasks={[]} />);

    await createInBuilder(screen, 'Phase', 'Site work');
    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(OLD_REFUSAL)).toBeNull();
    expect(mockAuth.createTask.mock.calls[0][0]).toMatchObject({
      taskName: 'Site work',
      projectId: mockLot9Id,
      projectName: 'Lot 9',
      scheduleProjectName: 'Lot 9',
      isSummary: true,
    });

    await createInBuilder(screen, 'Task', 'Stake curb line');
    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(2));
    expect(mockAuth.createTask.mock.calls[1][0]).toMatchObject({
      taskName: 'Stake curb line',
      projectId: mockLot9Id,
      projectName: 'Lot 9',
    });

    const result = await phoneUploads(mockAuth.createTask.mock.calls[1][0]);
    expect(result.errors).toEqual([]);
    expect([result.uploaded, result.queued]).toEqual([1, 0]);
  });

  test('(B) a project holding a task with another project’s id: the new item still gets its own project’s id, and uploads from the phone', async () => {
    // Saved under 2375 Main St with Lot 9's id (the old web-move case).
    const misfiled = scheduleItem('misfiled', {
      taskName: 'Seal coat',
      projectId: mockLot9Id,
      projectName: '2375 Main St',
      scheduleProjectName: '2375 Main St',
    });
    const screen = render(<Builder project="2375 Main St" tasks={[misfiled]} />);

    await createInBuilder(screen, 'Task', 'Restripe stalls');
    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(1));
    const created = mockAuth.createTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(created).toMatchObject({ projectId: mockMainStId, projectName: '2375 Main St' });

    // Before: projectId was Lot 9's, and the phone said "The saved item
    // project name and cloud identity disagree, so it was not uploaded."
    const result = await phoneUploads(created);
    expect(result.errors).toEqual([]);
    expect([result.uploaded, result.queued]).toEqual([1, 0]);
    // Written only if the cloud still has no row for it (independent review R02).
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(expect.objectContaining({
      id: created.id,
      projectId: mockMainStId,
      projectName: '2375 Main St',
    }), { onlyIfAbsent: true });
  });

  test('a project that is not an open cloud project: nothing is saved, and he is told why', async () => {
    // A name that only tasks carry (the list shows it, but no cloud project has it).
    mockAuth.snapshot = snapshotWith([], [
      { id: mockLot9Id, name: 'Lot 9' },
      { id: mockMainStId, name: '2375 Main St' },
      { id: null, name: 'Old Yard' },
    ]);
    const screen = render(<Builder project="Old Yard" tasks={[
      scheduleItem('yard-task', { projectId: mockLot9Id, projectName: 'Old Yard', scheduleProjectName: 'Old Yard' }),
    ]} />);

    await createInBuilder(screen, 'Task', 'Haul off spoils');

    await waitFor(() => expect(screen.getByText(NOT_OPEN('Old Yard'))).toBeTruthy());
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });

  test('two open cloud projects with the same name: nothing is saved, and he is told why', async () => {
    mockAuth.snapshot = snapshotWith([], [
      { id: mockLot9Id, name: 'Lot 9' },
      { id: '0b0f6ad4-31a7-4c8b-9a51-1f43b8c0d7e2', name: 'lot 9 ' },
      { id: mockMainStId, name: '2375 Main St' },
    ]);
    const screen = render(<Builder project="Lot 9" tasks={[]} />);

    await createInBuilder(screen, 'Phase', 'Site work');

    await waitFor(() => expect(screen.getByText(MORE_THAN_ONE('Lot 9'))).toBeTruthy());
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });

  test('editing an existing item keeps its own stored id', async () => {
    const own = scheduleItem('own', { taskName: 'Pave', projectId: mockMainStId, projectName: '2375 Main St', scheduleProjectName: '2375 Main St' });
    const screen = render(<Builder project="2375 Main St" tasks={[own]} />);
    fireEvent.press(screen.getByLabelText('Edit Pave'));
    fireEvent.changeText(screen.getByDisplayValue('Pave'), 'Pave drive aisle');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0]).toMatchObject({ id: 'own', projectId: mockMainStId });
  });
});

describe('Tasks page: a new task uses the same rule (A12 pass 5 M1)', () => {
  async function createOnTasksPage(name: string) {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.press(screen.getByLabelText('Project: Lot 9'));
    fireEvent.changeText(screen.getByLabelText('Task name'), name);
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });
    return screen;
  }

  test('a new task gets its project’s id from the open projects', async () => {
    mockAuth.snapshot = snapshotWith([scheduleItem('existing')]);
    await createOnTasksPage('Patch potholes');
    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.createTask.mock.calls[0][0]).toMatchObject({
      taskName: 'Patch potholes',
      projectId: mockLot9Id,
      projectName: 'Lot 9',
    });
  });

  test('two open projects with the same name: nothing is saved, and he is told why', async () => {
    mockAuth.snapshot = snapshotWith([scheduleItem('existing')], [
      { id: mockLot9Id, name: 'Lot 9' },
      { id: '0b0f6ad4-31a7-4c8b-9a51-1f43b8c0d7e2', name: 'Lot 9' },
    ]);
    const screen = await createOnTasksPage('Patch potholes');
    await waitFor(() => expect(screen.getByText(MORE_THAN_ONE('Lot 9'))).toBeTruthy());
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });
});

function snapshotWith(
  tasks: DAVEWebScheduleItem[],
  openCloudProjects: Readonly<{ id: string | null; name: string }>[] = [
    { id: mockLot9Id, name: 'Lot 9' },
    { id: mockMainStId, name: '2375 Main St' },
  ],
): DAVEWebReadOnlySnapshot {
  // The project list is one entry per name; `openCloudProjects` is every
  // open cloud project row, two with one name included.
  const byName = new Map<string, { id: string | null; name: string }>();
  openCloudProjects.forEach(row => {
    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { id: row.id, name: row.name.trim() });
  });
  return {
    projects: [...byName.values()] as never,
    openCloudProjects: openCloudProjects.filter(row => row.id) as never,
    scheduleItems: tasks,
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-09-30T14:00:02.000Z',
  } as DAVEWebReadOnlySnapshot;
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
