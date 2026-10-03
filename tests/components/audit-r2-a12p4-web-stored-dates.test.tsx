/**
 * Whole-app audit A12 pass 4 L1 and L2 (30 Sep 2026), through the web
 * screens.
 *
 * L1, Schedule Builder: a stored date the date box showed as a day but the
 * same-day check did not recognise (2026-10-05 08:00, 10/5/2026 8:00 AM,
 * Mon 10/5/26, 2026-10-5) was rewritten as 10/05/2026 by any save; "TBD"
 * showed an empty box and any save erased it; a phase was always saved with
 * blank dates, so Apply My Changes on a phase blanked the phone's newer
 * phase dates. Now a box that still shows what the stored date showed keeps
 * the stored text exactly, and a phase's dates (which the builder does not
 * show) are never written by it.
 *
 * L2, Tasks page: its date boxes had their own conversion, through UTC, and
 * showed the day before east of UTC (10/05/2026 as 4 Oct in UTC+14). They
 * now read stored dates as calendar days with the builder's reading.
 *
 * Run in Los Angeles, UTC+14 and UTC-11: jest cannot change the time zone
 * inside a run, so this file is run three times with TZ set (see the A12
 * pass 4 report). The describe titles name the zone it ran in.
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

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PROJECT = '2321 Compliance Project';

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

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

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

function conflict() {
  return new DAVEWebTaskMutationError(
    'conflict',
    'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
  );
}

const box = (screen: ReturnType<typeof render>, label: string) =>
  screen.getByLabelText(label).props.value as string;

async function savedAfter(screen: ReturnType<typeof render>, call = 0) {
  fireEvent.press(screen.getByText('Save Changes'));
  await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(call + 1));
  return mockAuth.updateTask.mock.calls[call][0] as DAVEWebScheduleItem;
}

describe(`Schedule Builder keeps stored date text (A12 pass 4 L1, ${ZONE})`, () => {
  test('the four forms the same-day check missed: shown as their day, kept exactly on an area-only save', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: '2026-10-05 08:00',
      finishDate: '10/9/2026 8:00 AM',
      baselineStartDate: 'Mon 10/5/26',
      baselineFinishDate: '2026-10-9',
    });
    const screen = render(<Workspace initial={[stored]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));

    expect([
      box(screen, 'Start date'),
      box(screen, 'Finish date'),
      box(screen, 'Baseline start'),
      box(screen, 'Baseline finish'),
    ]).toEqual(['2026-10-05', '2026-10-09', '2026-10-05', '2026-10-09']);
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });

    expect(await savedAfter(screen)).toMatchObject({
      locationName: 'South Yard',
      startDate: '2026-10-05 08:00',
      finishDate: '10/9/2026 8:00 AM',
      baselineStartDate: 'Mon 10/5/26',
      baselineFinishDate: '2026-10-9',
    });
  });

  test('"TBD" and "Week 41" show an empty box and are kept; a date he picks is written', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: 'TBD',
      finishDate: '10/09/2026',
      baselineStartDate: 'Week 41',
      baselineFinishDate: '',
    });
    const screen = render(<Workspace initial={[stored]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));

    // Not 1 Jan 2041, as the browser's own date parser reads "Week 41".
    expect([box(screen, 'Start date'), box(screen, 'Baseline start')]).toEqual(['', '']);
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'South Yard' } });
    expect(await savedAfter(screen)).toMatchObject({
      startDate: 'TBD',
      finishDate: '10/09/2026',
      baselineStartDate: 'Week 41',
      baselineFinishDate: null,
    });

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '2026-10-07' } });
    expect(await savedAfter(screen, 1)).toMatchObject({ startDate: '10/07/2026', baselineStartDate: 'Week 41' });
  });

  test('a date he clears is cleared', async () => {
    const stored = scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: '10/5/2026 8:00 AM',
      finishDate: '10/09/2026',
      baselineStartDate: '10/05/2026',
    });
    const screen = render(<Workspace initial={[stored]} />);
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Baseline start'), 'change', { target: { value: '' } });

    expect(await savedAfter(screen)).toMatchObject({
      startDate: '10/5/2026 8:00 AM',
      baselineStartDate: null,
    });
  });

  const phase = scheduleItem('phase', {
    taskName: 'Site work',
    wbsCode: '1',
    isSummary: true,
    startDate: '10/01/2026',
    finishDate: '10/30/2026',
    baselineStartDate: '10/01/2026',
    baselineFinishDate: '10/30/2026',
    durationDays: null,
  });

  test('renaming a phase keeps its dates', async () => {
    const screen = render(<Workspace initial={[phase]} />);
    fireEvent.press(screen.getByLabelText('Edit Site work'));
    fireEvent.changeText(screen.getByDisplayValue('Site work'), 'Site work and paving');

    expect(await savedAfter(screen)).toMatchObject({
      taskName: 'Site work and paving',
      startDate: '10/01/2026',
      finishDate: '10/30/2026',
      baselineStartDate: '10/01/2026',
      baselineFinishDate: '10/30/2026',
    });
  });

  test('Apply My Changes on a phase keeps the phone’s newer phase dates', async () => {
    const phoneVersion: DAVEWebScheduleItem = {
      ...phase,
      startDate: '10/05/2026',
      finishDate: '11/06/2026',
      updatedAt: '2026-09-30T14:05:00.000Z',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    };
    mockAuth.updateTask.mockRejectedValueOnce(conflict()).mockResolvedValue(undefined);
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks([phoneVersion]);
      return true;
    });
    const screen = render(<Workspace initial={[phase]} />);
    fireEvent.press(screen.getByLabelText('Edit Site work'));
    fireEvent.changeText(screen.getByDisplayValue('Site work'), 'Site work and paving');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());

    fireEvent.press(screen.getByText('Apply My Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    expect(mockAuth.updateTask.mock.calls[1][0]).toMatchObject({
      taskName: 'Site work and paving',
      startDate: '10/05/2026',
      finishDate: '11/06/2026',
      cloudUpdatedAt: '2026-09-30T14:05:01.000Z',
    });
  });
});

describe(`Tasks page date boxes show the stored day (A12 pass 4 L2, ${ZONE})`, () => {
  function openEditor(task: DAVEWebScheduleItem) {
    mockAuth.snapshot = snapshotWith(task);
    const screen = render(<DesktopReadOnlyShell page="tasks" />);
    fireEvent.press(screen.getByLabelText(`Expand ${task.locationName}`));
    fireEvent.press(screen.getAllByLabelText(`View details for ${task.taskName}`)[0]);
    fireEvent.press(screen.getByText('Edit Task'));
    return screen;
  }

  test.each([
    ['10/05/2026', '10/09/2026', '2026-10-05', '2026-10-09'],
    ['Oct 5, 2026', '10/9/26', '2026-10-05', '2026-10-09'],
    ['2026-10-05 08:00', 'Mon 10/12/26', '2026-10-05', '2026-10-12'],
    ['TBD', 'Week 41', '', ''],
  ])('stored %s – %s shows %s – %s', (startDate, finishDate, shownStart, shownFinish) => {
    const screen = openEditor(scheduleItem('paving', { taskName: 'Place asphalt', startDate, finishDate }));

    expect([box(screen, 'Start date'), box(screen, 'Finish / due date')]).toEqual([shownStart, shownFinish]);
  });

  test('an area-only save keeps the stored text', async () => {
    const screen = openEditor(scheduleItem('paving', {
      taskName: 'Place asphalt',
      startDate: 'TBD',
      finishDate: '10/9/2026 8:00 AM',
    }));
    fireEvent.changeText(screen.getByLabelText('Location / area, custom value'), 'South Yard');
    fireEvent.press(screen.getByText('Save Task Changes'));

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect(mockAuth.updateTask.mock.calls[0][0]).toMatchObject({
      locationName: 'South Yard',
      startDate: 'TBD',
      finishDate: '10/9/2026 8:00 AM',
    });
  });
});

function snapshotWith(task: DAVEWebScheduleItem): DAVEWebReadOnlySnapshot {
  return {
    projects: [{ id: 'project-1', name: PROJECT }] as never,
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
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
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
