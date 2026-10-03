/**
 * Whole-app audit A12 pass 4 M1 (30 Sep 2026), through the web screens. All
 * four web save paths (Tasks page Save and Apply My Changes, Schedule Builder
 * Save and Apply My Changes) marked an imported task's progress as the
 * project manager's, confirmed by the signed-in email, when David changed
 * only its area. The saved task now keeps its progress marking unless the
 * percent or status changed.
 */
import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
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

const PROJECT = '2321 Compliance Project';

const imported: DAVEWebScheduleItem = {
  id: 'pour-slab',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: PROJECT,
  projectName: PROJECT,
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'Level 1',
  taskName: 'Pour slab',
  startDate: '09/14/2026',
  finishDate: '09/18/2026',
  milestone: '',
  owner: 'Concrete crew',
  contractor: 'Ready Mix Co',
  durationDays: 5,
  percentComplete: 100,
  progressSource: null,
  progressConfirmedAt: null,
  progressConfirmedBy: null,
  priority: 'Medium',
  status: 'Complete',
  notes: '',
  nextAction: '',
  activity: [],
  importedAt: '2026-09-01T09:00:00.000Z',
  importBatchId: 'batch-master-update',
  sourceDocumentId: 'doc-master-update',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-30T14:00:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};
const phoneVersion: DAVEWebScheduleItem = {
  ...imported,
  notes: 'Phone note: slab poured',
  updatedAt: '2026-09-30T14:05:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
};
const UNMARKED = { progressSource: null, progressConfirmedAt: null, progressConfirmedBy: null };

function snapshotWith(task: DAVEWebScheduleItem): DAVEWebReadOnlySnapshot {
  return {
    projects: [{ id: 'project-1', name: PROJECT }] as never,
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
  snapshot: snapshotWith(imported),
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
  mockAuth.snapshot = snapshotWith(imported);
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.refreshSnapshot.mockResolvedValue(true);
});

function conflict() {
  return new DAVEWebTaskMutationError(
    'conflict',
    'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
  );
}

const marking = (item: DAVEWebScheduleItem) => ({
  progressSource: item.progressSource,
  progressConfirmedAt: item.progressConfirmedAt,
  progressConfirmedBy: item.progressConfirmedBy,
});

describe('Tasks page (A12 pass 4 M1)', () => {
  function openEditor() {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByText('Completed Tasks'));
    fireEvent.press(screen.getByLabelText('Expand Level 1'));
    fireEvent.press(screen.getAllByLabelText('View details for Pour slab')[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    fireEvent.changeText(screen.getByLabelText('Location / area, custom value'), 'Level 1 East');
    return screen;
  }

  test('Save with only the area changed keeps the imported 100% unmarked', async () => {
    const screen = openEditor();
    fireEvent.press(screen.getByText('Save Task Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const written = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', percentComplete: 100, status: 'Complete' });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('Apply My Changes with only the area changed keeps it unmarked', async () => {
    mockAuth.updateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    const screen = openEditor();
    fireEvent.press(screen.getByText('Save Task Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    mockAuth.snapshot = snapshotWith(phoneVersion);
    screen.rerender(<DesktopReadOnlyShell page="tasks" />);

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const written = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', notes: 'Phone note: slab poured' });
    expect(marking(written)).toEqual(UNMARKED);
  });
});

describe('Schedule Builder (A12 pass 4 M1)', () => {
  let showTasks: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
  function Workspace({ initial }: { initial: DAVEWebScheduleItem[] }) {
    const [tasks, setTasks] = useState(initial);
    showTasks = next => act(() => setTasks(next));
    return <DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />;
  }
  function openEditor() {
    const screen = render(<Workspace initial={[imported]} />);
    fireEvent.press(screen.getByLabelText('Edit Pour slab'));
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'Level 1 East' } });
    return screen;
  }

  test('Save Changes with only the area changed keeps the imported 100% unmarked', async () => {
    const screen = openEditor();
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const written = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', percentComplete: 100, status: 'Complete' });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('Apply My Changes with only the area changed keeps it unmarked', async () => {
    mockAuth.updateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = openEditor();
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const written = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', notes: 'Phone note: slab poured' });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('a percent changed in the builder is marked as the manager’s', async () => {
    const screen = render(<Workspace initial={[{ ...imported, percentComplete: 60, status: 'In Progress' }]} />);
    fireEvent.press(screen.getByLabelText('Edit Pour slab'));
    fireEvent.changeText(screen.getByDisplayValue('60'), '80');
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0]).toMatchObject({
      percentComplete: 80,
      progressSource: 'project_manager',
      progressConfirmedBy: 'pm@example.com',
    });
  });
});
