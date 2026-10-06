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
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N2 follow-up (5 Oct 2026, to finding 5), on the page. "Recorded as
// sent ... The next report on every device runs from this one." was worded
// from the page's last read of the shared record, not from whether this
// send's own write arrived: a send made just as the record went out of reach
// said "every device" before it had got there (and Sign Out then warned that
// it may not have). The line now says "every device" only once the write is
// known to have arrived; until then it says the send is recorded on this
// computer, and it is corrected when the send does arrive.
// The web shell is real; the cloud is an in-memory report_snapshots table.
// Synthetic data.

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

const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const RECORDED_EVERYWHERE = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const RECORDED_HERE_ONLY = /^Recorded as sent .* on this computer\. Your other devices count from it once this computer reaches the shared record again\.$/;
const RECORDED_NOT_SHARED = /^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/;
const tableSave = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
  if (table === 'missing') return 'unavailable' as const;
  const existing = table.get(rowKey(row.scopeKey, row.format));
  if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
  table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
  return 'saved' as const;
};
const tableLoad = async (scopeKey: string, format: string) => {
  if (table === 'missing') return 'unavailable' as const;
  return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
};
/** The shared record cannot be reached (the table is installed). */
function recordDown() {
  mockAuth.loadReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be read.'); });
  mockAuth.saveReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be saved.'); });
}
/** The shared record can be reached again. */
function recordBack() {
  mockAuth.loadReportPeriod.mockImplementation(tableLoad);
  mockAuth.saveReportPeriod.mockImplementation(tableSave);
}
/** A sent report is slow to reach the shared record: it arrives there, and is answered, only at `release()`. */
function sendSlowToArrive(): { release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  mockAuth.saveReportPeriod.mockImplementation(async row => {
    if (row.deliveredAt) await held;
    return tableSave(row);
  });
  return { release: () => release() };
}
/** The shared record takes a sent report, but the answer to that write never comes back. */
function sendAnswerNeverComesBack() {
  mockAuth.saveReportPeriod.mockImplementation(async row => {
    const answer = await tableSave(row);
    if (row.deliveredAt) await new Promise<void>(() => undefined);
    return answer;
  });
}
/** He opens Reports, with the phone's 10:00 report in the shared record, and approves the report. */
async function approveOnWeb() {
  const reports = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(screen.queryByText('Checking your last report…')).toBeNull());
  await settle();
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return reports;
}
/** The page's next refresh (no fact changes): it reads the shared record again. */
async function nextRefresh(reports: ReturnType<typeof render>, at: string) {
  mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: at };
  reports.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
}

describe('review N2 follow-up: "on every device" only once this send is known to have reached the shared record', () => {
  it('the record goes out of reach after the page last read it: recorded on this computer, not "every device"', async () => {
    table = PHONE_AT_10();
    await approveOnWeb();
    // No refresh in between: the page's last read of the shared record was a good one.
    recordDown();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent/);
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.getByText(RECORDED_HERE_ONLY)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    // True: the shared record still runs from the phone's report.
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('and the line is corrected when the send does arrive', async () => {
    table = PHONE_AT_10();
    const reports = await approveOnWeb();
    recordDown();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_HERE_ONLY);
    await settle();
    recordBack();
    await nextRefresh(reports, '2026-10-01T12:05:00.000Z');
    await screen.findByText(RECORDED_EVERYWHERE);
    expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull();
    // True: the shared record runs from this computer's send.
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
  });

  it('the record is read again but the send still has not got there: the line stays as it is', async () => {
    table = PHONE_AT_10();
    const reports = await approveOnWeb();
    recordDown();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_HERE_ONLY);
    await settle();
    // Reads work again and show another report in the record (the phone's, from 11:00); writes still fail.
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T11:00:00.000Z'), deliveredAt: '2026-10-01T11:00:00.000Z' });
    mockAuth.loadReportPeriod.mockImplementation(tableLoad);
    await nextRefresh(reports, '2026-10-01T12:05:00.000Z');
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T11:00:00.000Z');
    expect(screen.getByText(RECORDED_HERE_ONLY)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
  });

  it('the send is slow to reach the record: nothing says "every device" until it has, then the line does', async () => {
    table = PHONE_AT_10();
    await approveOnWeb();
    const slow = sendSlowToArrive();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    // With no answer after a moment, the page says where the send stands.
    await screen.findByText(RECORDED_HERE_ONLY, {}, { timeout: 6000 });
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
    await act(async () => { slow.release(); });
    await screen.findByText(RECORDED_EVERYWHERE);
    expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull();
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
  }, 20000);

  it('the answer to the write is lost, but the page reads the record and finds the send there: "every device", without the wait', async () => {
    table = PHONE_AT_10();
    await approveOnWeb();
    sendAnswerNeverComesBack();
    fireEvent.press(screen.getByText('Share Approved Report'));
    // Well inside the moment a send waits for its answer.
    await screen.findByText(RECORDED_EVERYWHERE, {}, { timeout: 1000 });
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
    expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull();
  });

  it('Mark as Sent, the same: in its card, recorded on this computer, then corrected', async () => {
    table = PHONE_AT_10();
    const first = await approveOnWeb();
    first.unmount();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    const reports = render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    expect(since().getByLabelText('Mark as Sent')).toBeTruthy();
    recordDown();
    fireEvent.press(screen.getByLabelText('Mark as Sent'));
    await settle();
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    await settle();
    expect(since().getByText(RECORDED_HERE_ONLY)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    recordBack();
    await nextRefresh(reports, '2026-10-01T12:05:00.000Z');
    await waitFor(() => expect(since().getByText(RECORDED_EVERYWHERE)).toBeTruthy());
    expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull();
  });

  it('a line that has since been replaced is not brought back by the correction', async () => {
    table = PHONE_AT_10();
    const reports = await approveOnWeb();
    recordDown();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_HERE_ONLY);
    await settle();
    // He shares it again: the page now says it was already recorded.
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull());
    await settle();
    recordBack();
    await nextRefresh(reports, '2026-10-01T12:05:00.000Z');
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    expect(screen.queryByText(RECORDED_HERE_ONLY)).toBeNull();
  });

  it('guard: with the record working it says "every device" straight away, and the record has the send', async () => {
    table = PHONE_AT_10();
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_EVERYWHERE);
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
  });

  it('guard: with reports not shared between his devices yet it says this computer only, and stays so', async () => {
    table = 'missing';
    const reports = await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_NOT_SHARED);
    await nextRefresh(reports, '2026-10-01T12:05:00.000Z');
    expect(screen.getByText(RECORDED_NOT_SHARED)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
  });
});
