/**
 * Whole-app audit A12 pass 5 L1 (30 Sep 2026). On the web Tasks page and in
 * the Schedule Builder, emptying the Percent complete box and saving stored
 * 0% (Number('') is 0) and marked it as the project manager's judgment, so
 * an imported 100% task he only moved to another area became "Not Started",
 * confirmed by David.
 *
 * Now a blank box leaves the percent as it was: the stored percent, with its
 * source and confirmer, is kept. Only a typed number changes it, and a box
 * that is not a number from 0 to 100 is refused with "Enter a percent from
 * 0 to 100."
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
const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const RANGE = 'Enter a percent from 0 to 100.';

const imported: DAVEWebScheduleItem = {
  id: 'pour-slab',
  projectId: PROJECT_ID,
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
    projects: [{ id: PROJECT_ID, name: PROJECT }] as never,
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
  mockAuth.createTask.mockResolvedValue(undefined);
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

describe('Tasks page: an emptied percent box (A12 pass 5 L1)', () => {
  function percentBox(screen: ReturnType<typeof render>) {
    const input = screen.UNSAFE_getAllByType('input' as never)
      .find(candidate => candidate.props['aria-label'] === 'Percent complete');
    if (!input) throw new Error('No Percent complete box');
    return input;
  }
  function typePercent(screen: ReturnType<typeof render>, value: string) {
    fireEvent(percentBox(screen), 'change', { currentTarget: { value } });
  }
  function openEditor() {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByText('Completed Tasks'));
    fireEvent.press(screen.getByLabelText('Expand Level 1'));
    fireEvent.press(screen.getAllByLabelText('View details for Pour slab')[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    fireEvent.changeText(screen.getByLabelText('Location / area, custom value'), 'Level 1 East');
    return screen;
  }

  test('Save with the box emptied keeps the stored 100% and its unmarked source', async () => {
    const screen = openEditor();
    typePercent(screen, '');
    expect(percentBox(screen).props.value).toBe('');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const written = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', percentComplete: 100, status: 'Complete' });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('Apply My Changes with the box emptied keeps the newer version’s percent and source', async () => {
    mockAuth.updateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    const screen = openEditor();
    typePercent(screen, '');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    mockAuth.snapshot = snapshotWith(phoneVersion);
    screen.rerender(<DesktopReadOnlyShell page="tasks" />);

    await act(async () => { fireEvent.press(screen.getByText('Apply My Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const written = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({
      locationName: 'Level 1 East',
      notes: 'Phone note: slab poured',
      percentComplete: 100,
      status: 'Complete',
    });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('a typed number still changes it, marked as his', async () => {
    const screen = openEditor();
    typePercent(screen, '');
    typePercent(screen, '80');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0]).toMatchObject({
      percentComplete: 80,
      status: 'In Progress',
      progressSource: 'project_manager',
      progressConfirmedBy: 'pm@example.com',
    });
  });

  test('a percent over 100 is refused with the plain line', async () => {
    const screen = openEditor();
    typePercent(screen, '150');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    expect(screen.getByText(RANGE)).toBeTruthy();
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
  });
});

describe('Schedule Builder: an emptied percent box (A12 pass 5 L1)', () => {
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
    fireEvent.changeText(screen.getByDisplayValue('100'), '');
    return screen;
  }

  test('Save Changes with the box emptied keeps the stored 100% and its unmarked source', async () => {
    const screen = openEditor();
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const written = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({ locationName: 'Level 1 East', percentComplete: 100, status: 'Complete' });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('Apply My Changes with the box emptied keeps the newer version’s percent and source', async () => {
    mockAuth.updateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = openEditor();
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());

    await act(async () => { fireEvent.press(screen.getByText('Apply My Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const written = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect(written).toMatchObject({
      locationName: 'Level 1 East',
      notes: 'Phone note: slab poured',
      percentComplete: 100,
      status: 'Complete',
    });
    expect(marking(written)).toEqual(UNMARKED);
  });

  test('text that is not a percent is refused with the plain line', async () => {
    const screen = render(<Workspace initial={[imported]} />);
    fireEvent.press(screen.getByLabelText('Edit Pour slab'));
    fireEvent.changeText(screen.getByDisplayValue('100'), 'about half');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    expect(screen.getByText(RANGE)).toBeTruthy();
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
  });

  test('a new task with the box emptied starts at 0%', async () => {
    const screen = render(<Workspace initial={[imported]} />);
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.changeText(screen.getAllByDisplayValue('')[0], 'Cure slab');
    // Lag after predecessors also shows 0; Percent complete comes after it.
    const zeros = screen.getAllByDisplayValue('0');
    fireEvent.changeText(zeros[zeros.length - 1], '');
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });

    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.createTask.mock.calls[0][0]).toMatchObject({
      taskName: 'Cure slab',
      percentComplete: 0,
      status: 'Not Started',
    });
  });
});
