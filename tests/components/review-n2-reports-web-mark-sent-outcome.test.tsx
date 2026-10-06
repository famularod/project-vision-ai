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

// Review N2 of reports (5 Oct 2026, Low, caused by 46e3332). Mark as Sent sits
// in the "Since the last report" card, outside the report workspace, and what
// happened was shown only inside the workspace. Pressed with the workspace
// closed, the panel just went away, whether the send was recorded or refused;
// "Your other device sent a report ... so this one was not recorded as sent"
// appeared only once he opened "Review & Prepare Report".
// The web shell is real; the cloud is an in-memory report_snapshots table
// (the harness of owner-2oct-web-report-sends). Synthetic data.

/** Another tab of the same browser: its own copy of the web report module (its own memory), the same storage and cloud. */
let otherTab: typeof import('../../services/DAVEWebReportSend');
jest.isolateModules(() => { otherTab = require('../../services/DAVEWebReportSend'); });

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
  usePathname: () => '/reports',
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

const RECORDED_EVERYWHERE = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const REFUSED = /^Your other device sent a report .*, after this one was approved, so this one was not recorded as sent\. The next report counts from your other device's report\.$/;
const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const rows = () => table as Map<string, { snapshot: unknown; deliveredAt: string | null }>;

/** He approves the report on the web. */
async function approveOnWeb() {
  // Once the period is read (with no shared record there is no "since" line to wait for).
  await waitFor(() => expect(screen.queryByText('Checking your last report…')).toBeNull());
  await settle();
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
}
/** A later visit to Reports: the workspace is closed, and Mark as Sent is offered in the card. */
async function approvedThenALaterVisit() {
  const first = render(<DesktopReadOnlyShell page="reports" />);
  await approveOnWeb();
  first.unmount();
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  render(<DesktopReadOnlyShell page="reports" />);
  await settle();
  expect(screen.queryByText('Approve Report')).toBeNull();
  expect(since().getByLabelText('Mark as Sent')).toBeTruthy();
}
async function markSentJustNow() {
  fireEvent.press(screen.getByLabelText('Mark as Sent'));
  await settle();
  fireEvent.press(screen.getByLabelText('Record as Sent'));
  await settle();
}

describe('review N2 (Low): Mark as Sent says what happened in its own card, with the report workspace closed', () => {
  it('recorded: the card says so, and where the next report runs from', async () => {
    table = PHONE_AT_10();
    await approvedThenALaterVisit();
    await markSentJustNow();
    expect(since().getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
    expect(screen.queryByLabelText('Mark as Sent')).toBeNull();
    expect(screen.queryByText('Approve Report')).toBeNull();
  });

  it('refused because the phone sent a later report: the card says so at once', async () => {
    table = PHONE_AT_10();
    await approvedThenALaterVisit();
    // Meanwhile the phone sends a later report (this page has not read the period since).
    const at = new Date(Date.now() - 1000).toISOString();
    rows().set('tower|project_manager', { snapshot: phoneSent(100, at), deliveredAt: at });
    await markSentJustNow();
    expect(since().getByText(REFUSED)).toBeTruthy();
    expect(sharedRow()?.deliveredAt).toBe(at);
    expect(screen.queryByText('Approve Report')).toBeNull();
    // Opening the workspace afterwards does not say it a second time.
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    await settle();
    expect(screen.getAllByText(REFUSED)).toHaveLength(1);
  });

  it('before the shared record exists, and while it cannot be reached: the card says where the next report counts from', async () => {
    table = 'missing';
    await approvedThenALaterVisit();
    await markSentJustNow();
    expect(since().getByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/)).toBeTruthy();
    screen.unmount();

    table = PHONE_AT_10();
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    const first = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    first.unmount();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    // The shared record cannot be reached on the later visit.
    mockAuth.loadReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be read.'); });
    mockAuth.saveReportPeriod.mockImplementation(async () => { throw new Error('The shared report period could not be saved.'); });
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    await markSentJustNow();
    expect(since().getByText(/^Recorded as sent .* on this computer\. Your other devices count from it once this computer reaches the shared record again\.$/)).toBeTruthy();
  });

  it('another tab of this browser has just recorded it: the card says it was already recorded, and never "Shared again"', async () => {
    table = PHONE_AT_10();
    await approvedThenALaterVisit();
    // In another tab he marks the same approved report as sent (this tab has not read the period since).
    const approval = sharedSnapshot() as DAVEReportSnapshot;
    const sentAt = new Date(Date.now() - 1000).toISOString();
    const store = {
      storage: otherTab.daveWebReportStorage(async () => 'owner-1'),
      cloud: otherTab.daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
    };
    expect((await otherTab.recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, approval.sourceFingerprint, sentAt))?.status).toBe('saved');
    await settle();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);

    await markSentJustNow();
    expect(since().getByText(/^This report was already recorded as sent .*, so nothing more was recorded\.$/)).toBeTruthy();
    expect(screen.queryByText(/Shared again/)).toBeNull();
    expect(screen.queryByLabelText('Mark as Sent')).toBeNull();
    // Recorded once, at the other tab's time.
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('with the workspace open it is said once, in the card', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    await markSentJustNow();
    expect(screen.getAllByText(RECORDED_EVERYWHERE)).toHaveLength(1);
    expect(since().getByText(RECORDED_EVERYWHERE)).toBeTruthy();
  });

  it('a share from the workspace still says so in the workspace, and the next thing he does there replaces the card\'s line', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_EVERYWHERE);
    expect(since().queryByText(RECORDED_EVERYWHERE)).toBeNull();
    screen.unmount();

    table = PHONE_AT_10();
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    await markSentJustNow();
    expect(since().getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
    expect(screen.getByText('A fresh draft was generated from the latest reconciled project record.')).toBeTruthy();
  });
});
