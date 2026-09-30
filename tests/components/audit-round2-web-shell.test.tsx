import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

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

const opened: DAVEWebScheduleItem = {
  id: 'task-1',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: '2321 Compliance Project',
  projectName: '2321 Compliance Project',
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  startDate: '2099-09-28',
  finishDate: '2099-10-02',
  milestone: '',
  owner: 'Project manager',
  contractor: 'Paving Crew',
  durationDays: 5,
  percentComplete: 40,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-09-30T14:00:00.000Z',
  progressConfirmedBy: 'pm@example.com',
  priority: 'High',
  status: 'In Progress',
  notes: 'Old note',
  nextAction: '',
  activity: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-30T14:00:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};

const phoneVersion: DAVEWebScheduleItem = {
  ...opened,
  percentComplete: 60,
  progressConfirmedAt: '2026-09-30T14:05:00.000Z',
  progressConfirmedBy: 'field@example.com',
  notes: 'Phone note: north half paved',
  updatedAt: '2026-09-30T14:05:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
};

function snapshotWith(task: DAVEWebScheduleItem): DAVEWebReadOnlySnapshot {
  return {
    projects: [{ id: 'project-1', name: '2321 Compliance Project' }] as never,
    scheduleItems: [task],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-09-30T14:00:02.000Z',
  };
}

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: snapshotWith(opened),
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

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.snapshot = snapshotWith(opened);
});

describe('Apply My Changes on the Tasks page (audit round 2 F4)', () => {
  test('an owner-only change is applied over the phone’s newer 60% and note', async () => {
    mockAuth.updateTask
      .mockRejectedValueOnce(new DAVEWebTaskMutationError(
        'conflict',
        'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
      ))
      .mockResolvedValueOnce(undefined);
    const screen = render(<DesktopReadOnlyShell page="tasks" />);

    fireEvent.press(screen.getByLabelText('Expand North Lot'));
    fireEvent.press(screen.getAllByLabelText('View details for Place asphalt')[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    fireEvent.changeText(screen.getByLabelText('Owner, custom value'), 'Dana Ruiz');
    fireEvent.press(screen.getByText('Save Task Changes'));

    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    expect(screen.getByText(/Apply My Changes saves only the fields you changed/)).toBeTruthy();

    // The refresh brought the phone's version.
    mockAuth.snapshot = snapshotWith(phoneVersion);
    screen.rerender(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    expect(mockAuth.updateTask.mock.calls[1][0]).toMatchObject({
      id: 'task-1',
      owner: 'Dana Ruiz',
      percentComplete: 60,
      progressConfirmedAt: '2026-09-30T14:05:00.000Z',
      notes: 'Phone note: north half paved',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
  });
});

describe('Data export and recovery on the web (audit round 2 F6, F8)', () => {
  const backup = JSON.stringify({
    schemaVersion: 'vitruvius-web-backup/1.0',
    exportedAt: '2026-09-30T12:00:00.000Z',
    sourceRefreshedAt: '2026-09-30T12:00:00.000Z',
    projects: [],
    scheduleItems: [{ id: 'gone-task', taskName: 'Gone task' }],
    projectUpdates: [],
    referenceDocuments: [],
  });

  function chooseFile(screen: ReturnType<typeof render>, label: string) {
    const input = screen.UNSAFE_getAllByType('input' as never)
      .find(candidate => candidate.props['aria-label'] === label);
    if (!input) throw new Error(`No file input labelled ${label}`);
    const target = {
      files: [{ name: 'export.json', text: async () => backup }],
      value: 'C:\\fakepath\\export.json',
    };
    fireEvent(input, 'change', { target });
    return target;
  }

  test('the picker is emptied once read, so the same file can be chosen again', async () => {
    const screen = render(<DesktopReadOnlyShell page="settings" />);

    const target = chooseFile(screen, 'Choose Vitruvius data export');

    expect(target.value).toBe('');
    await waitFor(() => expect(screen.getByText('Validated recovery preview')).toBeTruthy());
  });

  test('the export and recovery text says what is and is not included', async () => {
    const screen = render(<DesktopReadOnlyShell page="settings" />);

    expect(screen.getByText(
      /neither are deleted tasks or the tasks of schedules that are not current/,
    )).toBeTruthy();
    chooseFile(screen, 'Choose Vitruvius data export');
    await waitFor(() => expect(screen.getByText(
      /adds back only tasks that are no longer in the shared record/,
    )).toBeTruthy());
    expect(screen.getByText(/tasks deleted on purpose stay deleted/)).toBeTruthy();
    expect(screen.queryByText(/restore deleted IDs/)).toBeNull();
  });
});
