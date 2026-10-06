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

// Review N2 of reports (5 Oct 2026, Low, caused by b1281f0), on the page.
// He approved a report on the web, the shared record could not be reached
// when he shared it, and the page said "Recorded as sent ... on this
// computer. Your other devices count from it once this computer reaches the
// shared record again." Sign Out of This Computer before Reports was opened
// again removed it for good (the reviewer's seeds 1044 and 12). Sign Out now
// tries the shared record once more first, and when the send still cannot be
// confirmed there he is told what that means before the sign-out goes ahead.
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

describe('review N2 (Low): Sign Out tries the shared record once more for a report sent while it could not be reached', () => {
  it('the record can be reached again: the send is carried up, then he is signed out and the browser keeps none of his periods', async () => {
    await sentFromHereWhileTheRecordWasDown();
    recordBack();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('local');
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    // His other devices now count from it; this browser keeps nothing of his (review N1).
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
    expect(sharedRow()?.deliveredAt).toBe(sharedSnapshot()?.deliveredAt);
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
    expect(keptInBrowser()).toEqual([]);
  });

  it('the record still cannot be reached: he is told before anything is signed out or removed, and can cancel', async () => {
    await sentFromHereWhileTheRecordWasDown();
    const kept = keptInBrowser().length;
    expect(kept).toBeGreaterThan(0);
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    expect(await screen.findByText(NOT_SHARED_TITLE)).toBeTruthy();
    expect(screen.getByText(/^Vitruvius tried again just now and could not confirm that the report sent from this computer (at|on) .* is in the record your devices share\.$/)).toBeTruthy();
    expect(screen.getByText(
      "Signing out removes this computer's own record of it. If the shared record does not have it, your other devices will not count from it: " +
      'the next report on every device will count from the report before it, and may repeat what it covered.',
    )).toBeTruthy();
    expect(screen.getByText('Cancel and sign out a little later so Vitruvius can try again, or sign out now.')).toBeTruthy();
    expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
    expect(keptInBrowser()).toHaveLength(kept);
    expect(screen.queryByText('Sign out of which devices?')).toBeNull();

    // Cancel: nothing is signed out, and his send is still in this browser.
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
    expect(keptInBrowser()).toHaveLength(kept);

    // A little later the record is back: Sign Out carries it up and goes ahead with nothing more to say.
    recordBack();
    fireEvent.press(screen.getByText('Sign out'));
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
    expect(keptInBrowser()).toEqual([]);
  });

  it('told, he signs out anyway: this computer is signed out and its periods are removed, as the privacy rule has it', async () => {
    await sentFromHereWhileTheRecordWasDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await screen.findByText(NOT_SHARED_TITLE);
    expect(screen.queryByText('Sign Out of All Devices Anyway')).toBeNull();
    fireEvent.press(screen.getByText('Sign Out of This Computer Anyway'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('local');
    expect(keptInBrowser()).toEqual([]);
    // Nothing was written for it: the shared record still runs from the phone's report.
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('Sign Out of All Devices is held up the same way, and goes ahead as All Devices', async () => {
    await sentFromHereWhileTheRecordWasDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of All Devices'));
    await screen.findByText(NOT_SHARED_TITLE);
    expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Sign Out of All Devices Anyway'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('global');
  });

  it('a sign-out that then does not finish says so, and he can try again', async () => {
    await sentFromHereWhileTheRecordWasDown();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of All Devices'));
    await screen.findByText(NOT_SHARED_TITLE);
    mockAuth.signOutOfDesktop.mockImplementationOnce(async () => { throw new DAVEWebSignOutNeedsConnectionError(); });
    fireEvent.press(screen.getByText('Sign Out of All Devices Anyway'));
    expect(await screen.findByText(/Try again when this computer is back online\.$/)).toBeTruthy();
    expect(keptInBrowser().length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Sign Out of All Devices Anyway'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(2));
  });
});

describe('review N2 (Low): Sign Out is not held up when there is nothing to say', () => {
  it('before the shared table exists: signed out at once, as before (the period was this computer\'s alone)', async () => {
    table = 'missing';
    const reports = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(screen.queryByText('Checking your last report…')).toBeNull());
    await settle();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/);
    await settle();
    reports.unmount();
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    expect(keptInBrowser()).toEqual([]);
  });

  it('a send that reached the shared record when it was made: signed out with nothing asked', async () => {
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
    reports.unmount();
    // The record can be reached at sign-out and already has the send: nothing is asked.
    openSignOutChoice();
    fireEvent.press(screen.getByText('Sign Out of This Computer'));
    await waitFor(() => expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(NOT_SHARED_TITLE)).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('a browser that keeps no report period signs out in the same press, with no wait', async () => {
    openSignOutChoice();
    await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1);
    expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('local');
    expect(mockAuth.loadReportPeriod).not.toHaveBeenCalled();
  });
});
