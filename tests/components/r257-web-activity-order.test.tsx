/**
 * Whole-app audit A12 pass 4 residual R1 (30 Sep 2026), Tasks page text.
 *
 * The task's Start and Finish / due text (in its row and its detail panel)
 * read the stored date with the browser's own parser. That takes 2026-10-05,
 * the form older web builder saves wrote, as midnight UTC, so west of UTC
 * (David's Pacific time) it showed 4 Oct; it also read "Week 41" as
 * 1 Jan 2041. A plain day is now read with the same calendar-day reading as
 * the date boxes (scheduleCalendarDay) and shown without any time-zone
 * shift; text that names no day is shown as written. Real timestamps (the
 * latest activity's time) still show in local time.
 *
 * Run in Los Angeles, UTC+14 and UTC-11: jest cannot change the time zone
 * inside a run, so this file is run three times with TZ set. The describe
 * title names the zone it ran in.
 */
import { fireEvent, render, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
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
});

/** How this computer shows that calendar day (10/5/2026 in the US). */
const day = (year: number, month: number, dayOfMonth: number) =>
  new Date(year, month - 1, dayOfMonth).toLocaleDateString();

function openDetails(task: DAVEWebScheduleItem) {
  mockAuth.snapshot = snapshotWith(task);
  const screen = render(<DesktopReadOnlyShell page="tasks" />);
  fireEvent.press(screen.getByLabelText(`Expand ${task.locationName}`));
  const row = screen.getAllByLabelText(`View details for ${task.taskName}`)[0];
  const rowText = within(row);
  fireEvent.press(row);
  return { screen, rowText };
}

/** The detail panel's Start and Finish / due values are text on their own. */
const detailShows = (screen: ReturnType<typeof render>, text: string) =>
  screen.queryAllByText(text).length > 0;

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

it('2.57 desktop latest activity uses actual time, not final stored entry',()=>{
 const activity=[{id:'latest',message:'Latest actual note',author:'PM',createdAt:'2026-10-17T12:00:00Z'},{id:'older',message:'Older stored last',author:'PM',createdAt:'2026-09-01T12:00:00Z'}];const task=scheduleItem('paving',{activity});const before=JSON.stringify(task);const {screen}=openDetails(task);expect(screen.getByText('Latest actual note')).toBeTruthy();expect(screen.queryByText('Older stored last')).toBeNull();expect(JSON.stringify(task)).toBe(before);
});
