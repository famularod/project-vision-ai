import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import { DAVEWebSignOutNeedsConnectionError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N2 follow-up (5 Oct 2026, to finding 5), on the page. Sign Out's
// warning "A report sent from this computer may not have reached your other
// devices" also appeared for a report that had reached the shared record when
// it was sent, whenever the record could not be reached at sign-out. Sign Out
// now goes ahead with no question for a send this computer has seen in the
// shared record, and still asks for one it has not.
// The web shell is real; the cloud is an in-memory report_snapshots table;
// the sign-out is the provider's, mocked to remove the account's periods as
// the real one does. Synthetic data.

let mockPath = '/reports';
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children) };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPath,
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() },
}));

const task = (id: string, taskName: string, percentComplete: number): DAVEWebScheduleItem => ({
  id, scheduleProjectName: 'Tower', projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '09/01/2026', finishDate: '06/30/2027', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, progressSource: 'project_manager', priority: 'Medium',
  status: percentComplete >= 100 ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', cloudUpdatedAt: '2026-09-10T12:00:00.000Z',
});
const webSnapshot = (frame: number, pulledAt: string, pour = 40): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: 'project-tower', name: 'Tower' } as DAVEWebReadOnlySnapshot['projects'][number]],
  scheduleItems: [task('frame', 'Frame walls', frame), task('pour', 'Pour slab', pour)],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: pulledAt,
  tasksPulledAt: pulledAt,
});
/** The report the phone sent at `sentAt`, with Frame walls at `frame`%. */
const phoneSent = (frame: number, sentAt: string) => markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
  truths: buildDAVEWebReportTruths(webSnapshot(frame, '2026-09-29T15:00:00.000Z'), null),
  scopeKey: 'tower', sourceFingerprint: `phone-${frame}`, capturedAt: '2026-09-29T15:00:00.000Z', reportFormat: 'project_manager',
}), null) as DAVEReportSnapshot, sentAt, 'phone-install');

/** The cloud's report_snapshots table, with its keep-the-later-send trigger. */
let table: Map<string, { snapshot: unknown; deliveredAt: string | null }> | 'missing' = new Map();
const rowKey = (scopeKey: string, format: string) => `${scopeKey}|${format}`;
const sharedRow = () => (table === 'missing' ? undefined : table.get('tower|project_manager'));
const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: webSnapshot(100, '2026-10-01T12:00:00.000Z'),
  freshness: { status: 'connected', lastSuccessfulRefreshAt: null, lastAttemptAt: null, consecutiveFailures: 0 },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  loadReportPeriod: jest.fn(async (scopeKey: string, format: string) => {
    if (table === 'missing') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  }),
  saveReportPeriod: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (table === 'missing') return 'unavailable' as const;
    const existing = table.get(rowKey(row.scopeKey, row.format));
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
    table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved' as const;
  }),
  reportOwnerId: jest.fn(async () => 'owner-1'),
  saveReport: jest.fn(async () => '2026-10-01T12:30:00.000Z'),
  signInWithPassword: jest.fn(),
  // The real sign-out removes the account's report periods from this browser (review N1).
  signOutOfDesktop: jest.fn(async (_scope?: string) => { forgetDAVEWebReportPeriods('owner-1'); }),
  restoreMissingTasks: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(),
  loadDocumentProof: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));

let profile = new Map<string, string>();
beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock; open?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
  browserWindow.open = jest.fn();
});
beforeEach(() => {
  table = new Map();
  profile = new Map();
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportTabMemory();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => { profile.set(key, value); },
    removeItem: (key: string) => { profile.delete(key); },
    key: (index: number) => [...profile.keys()][index] ?? null,
    get length() { return profile.size; },
  };
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  mockAuth.refreshSnapshot.mockClear();
  mockAuth.loadReportPeriod.mockImplementation(async (scopeKey: string, format: string) => {
    if (table === 'missing') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  });
  mockAuth.saveReportPeriod.mockImplementation(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (table === 'missing') return 'unavailable' as const;
    const existing = table.get(rowKey(row.scopeKey, row.format));
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
    table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved' as const;
  });
  mockAuth.saveReport.mockClear();
  mockAuth.saveReportPeriod.mockClear();
  mockAuth.signOutOfDesktop.mockClear();
  mockAuth.signOutOfDesktop.mockImplementation(async () => { forgetDAVEWebReportPeriods('owner-1'); });
  mockAuth.reportOwnerId.mockImplementation(async () => 'owner-1');
  mockPath = '/reports';
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z');
  (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText: jest.fn(async () => undefined) } };
  (globalThis as unknown as { window: { open: jest.Mock } }).window.open.mockClear();
});

const since = () => within(screen.getByLabelText('Since the last report'));
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
const copied = () => (globalThis as unknown as { navigator: { clipboard: { writeText: jest.Mock } } }).navigator.clipboard.writeText;
const PHONE_AT_10 = () => new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
type SavedReport = { id: string; projectName: string | null; report: Record<string, unknown> };
const savedReports = () => (mockAuth.saveReport as jest.Mock).mock.calls as unknown as Array<[SavedReport]>;
const lastSaved = () => savedReports()[savedReports().length - 1][0];
const approvals = () => savedReports().filter(([saved]) => saved.report.status === 'approved');

const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const keptInBrowser = () => [...profile.keys()].filter(key => key.startsWith('@vitruvius/web/owner-1/'));
const NOT_SHARED_TITLE = 'A report sent from this computer may not have reached your other devices';
const RECORDED_HERE_ONLY = /^Recorded as sent .* on this computer\. Your other devices count from it once this computer reaches the shared record again\.$/;
/** The shared record cannot be reached (the table is installed). */
function recordDown() {
  mockAuth.loadReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be read.'); });
  mockAuth.saveReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be saved.'); });
}
/** The shared record can be reached again. */
function recordBack() {
  mockAuth.loadReportPeriod.mockImplementation(async (scopeKey: string, format: string) => {
    if (table === 'missing') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  });
  mockAuth.saveReportPeriod.mockImplementation(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (table === 'missing') return 'unavailable' as const;
    const existing = table.get(rowKey(row.scopeKey, row.format));
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
    table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved' as const;
  });
}
/** The reviewer's steps: approve; the shared record goes down; Share (copy) records the send on this computer only. */
async function sentFromHereWhileTheRecordWasDown() {
  table = PHONE_AT_10();
  const reports = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  recordDown();
  // The page's next refresh finds the shared record out of reach (no fact changes).
  mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: '2026-10-01T12:05:00.000Z' };
  reports.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(RECORDED_HERE_ONLY);
  await settle();
  expect(copied()).toHaveBeenCalledTimes(1);
  expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  expect(sharedSnapshot()?.deliveredAt).toBeNull();
  reports.unmount();
}
/** He goes to Settings and presses Sign out. */
function openSignOutChoice() {
  mockPath = '/settings';
  render(<DesktopReadOnlyShell page="settings" />);
  fireEvent.press(screen.getByText('Sign out'));
  expect(screen.getByText('Sign out of which devices?')).toBeTruthy();
}

/** He approves a report and shares it with the shared record working: it reaches the record. */
async function sentFromHereWithTheRecordWorking() {
  table = PHONE_AT_10();
  const reports = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/);
  await settle();
  const sentAt = sharedRow()?.deliveredAt;
  expect(sentAt).not.toBe('2026-10-01T10:00:00.000Z');
  reports.unmount();
  return sentAt;
}

describe('review N2 follow-up: Sign Out asks nothing about a send this computer has seen in the shared record', () => {
  it('sent with the record working, record out of reach at sign-out: signed out with no question, and nothing is lost', async () => {
    const sentAt = await sentFromHereWithTheRecordWorking();
    recordDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('local');
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    // The shared record has the send; this browser keeps nothing of his.
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
    expect(keptInBrowser()).toEqual([]);
  });

  it('the same on a later visit, in a new tab that never opened Reports', async () => {
    await sentFromHereWithTheRecordWorking();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    forgetDAVEWebReportTabMemory();
    recordDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of All Devices'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('global');
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
  });

  it('a send made while the record could not be reached is still asked about', async () => {
    await sentFromHereWhileTheRecordWasDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    expect(await screen.findByText(NOT_SHARED_TITLE)).toBeTruthy();
    expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
  });
});
