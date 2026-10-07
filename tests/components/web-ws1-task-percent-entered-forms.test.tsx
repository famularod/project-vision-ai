import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 5 (6 Oct 2026), in the two web forms that
// have a Percent complete box: the Tasks page's Edit Task and the Schedule
// page's Edit schedule item. A percent he TYPES that is the percent a
// schedule file gave the task is saved as his own entry; a save with the box
// left as it opened still leaves the file's percent the file's.
// Synthetic data; the harnesses of audit-a3-p9-web-task-project.test.tsx and
// audit-round2-schedule-builder.test.tsx.

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

const PROJECT = 'Alpha';
const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';

/** A master's 60% taken over his own 30%: "Schedule update". */
function framing(): DAVEWebScheduleItem {
  return {
    id: 'framing',
    projectId: PROJECT_ID,
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName: 'Framing',
    startDate: '2026-10-15',
    finishDate: '2026-10-25',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 11,
    percentComplete: 60,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'Schedule update',
    managersPercentUnderFile: 30,
    priority: 'Medium',
    status: 'In Progress',
    notes: '',
    nextAction: '',
    activity: [],
    importedFrom: 'Master G.csv',
    importBatchId: 'batch-G',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.snapshot = {
    projects: [{ id: PROJECT_ID, name: PROJECT }],
    openCloudProjects: [{ id: PROJECT_ID, name: PROJECT }],
    scheduleItems: [framing()],
    knownScheduleItems: [framing()],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-10-06T14:00:02.000Z',
  };
});

const saved = () => mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
const whose = (item: DAVEWebScheduleItem) => [item.percentComplete, item.progressSource, item.progressConfirmedBy];

describe('the Tasks page: Edit Task (WS1 item 5)', () => {
  function openEditor() {
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByLabelText('Expand Lot'));
    fireEvent.press(screen.getAllByLabelText('View details for Framing')[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    return screen;
  }
  const typePercent = (screen: ReturnType<typeof render>, value: string) =>
    act(() => { screen.UNSAFE_getByProps({ 'data-testid': 'stable-web-numeric-input' }).props.onChange({ currentTarget: { value } }); });

  it('60 typed over the file\'s 60% is saved as his entry', async () => {
    const screen = openEditor();
    typePercent(screen, '');
    typePercent(screen, '60');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'david@example.com']);
    expect(saved().managersPercentUnderFile).toBeUndefined();
  });

  it('guard: the box left as it opened, another field changed: the percent stays the file\'s', async () => {
    const screen = openEditor();
    fireEvent.changeText(screen.getByLabelText('Next action'), 'Call the framer');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'Schedule update']);
    expect(saved().managersPercentUnderFile).toBe(30);
  });

  it('guard: the box emptied and left empty keeps the file\'s percent the file\'s', async () => {
    const screen = openEditor();
    typePercent(screen, '6');
    typePercent(screen, '');
    await act(async () => { fireEvent.press(screen.getByText('Save Task Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'Schedule update']);
  });
});

describe('the Schedule page: Edit schedule item (WS1 item 5)', () => {
  function openEditor() {
    const screen = render(<DesktopSchedulePage tasks={[framing()]} projects={[PROJECT]} selectedProject={PROJECT} />);
    fireEvent.press(screen.getByLabelText('Edit Framing'));
    return screen;
  }

  it('60 typed over the file\'s 60% is saved as his entry', async () => {
    const screen = openEditor();
    fireEvent.changeText(screen.getByLabelText('Percent complete'), '6');
    fireEvent.changeText(screen.getByLabelText('Percent complete'), '60');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'david@example.com']);
    expect(saved().managersPercentUnderFile).toBeUndefined();
  });

  it('guard: the box left as it opened, another field changed: the percent stays the file\'s', async () => {
    const screen = openEditor();
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Framing Co');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'Schedule update']);
    expect(saved().contractor).toBe('Framing Co');
  });

  it('typing in another box after the percent still saves the percent as his entry', async () => {
    const screen = openEditor();
    fireEvent.changeText(screen.getByLabelText('Percent complete'), '60');
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Framing Co');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(whose(saved())).toEqual([60, 'project_manager', 'david@example.com']);
    expect(saved().contractor).toBe('Framing Co');
  });
});
