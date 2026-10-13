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

// R3 item 6 (a guard restored). The flicker fix of review N2's follow-up (65b616b) has two halves: a report that
// stands on a send this tab has just recorded is not taken as overtaken while the page has yet to read the period
// again; and only while that own send is LATER than the send the page last read the period from. The second half
// is what still stops a report once another device really sends a later one. R2 item 1 changed the one test that
// showed it (review-n2-reports-web-own-send-not-overtaken: the report on screen there is now known as sent from
// here, so the comparison is never reached), and nothing else reached it.
// Here, with reports shaped as the devices save them: this computer sends a report; work moves on and the next
// report is approved, counting from this computer's own send; the phone then sends a later report, which carries
// the reports before it. The approved report must be stopped.
// The web shell is real; the cloud is an in-memory report_snapshots table. Synthetic data.

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

const OTHER_DEVICE_SENT = /after this one was approved/;
/** After this computer's send has reached the shared record, the page's reads of it get no answer. */
function readsHangOnceTheSendIsIn() {
  mockAuth.loadReportPeriod.mockImplementation(async (scopeKey: string, format: string) => {
    if (sharedRow()?.deliveredAt !== '2026-10-01T10:00:00.000Z') await new Promise<void>(() => undefined);
    return tableLoad(scopeKey, format);
  });
}
/** He opens Reports, with the phone's 10:00 report in the shared record, and approves the report. */
async function approveOnWeb() {
  const reports = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return reports;
}

/** The report the phone sends at `sentAt` over what the shared record holds: it carries the reports before it, as a real one does. */
const phoneSendsOver = (held: DAVEReportSnapshot, frame: number, pour: number, sentAt: string) => markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
  truths: buildDAVEWebReportTruths(webSnapshot(frame, sentAt, pour), null),
  scopeKey: 'tower', sourceFingerprint: `phone-${frame}-${pour}`, capturedAt: sentAt, reportFormat: 'project_manager',
}), held) as DAVEReportSnapshot, sentAt, 'phone-install');
const OTHER_DEVICE_SENT_LATER = /^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;

describe('R3 item 6: a report approved on this computer\'s own send is stopped once another device sends a later one', () => {
  /** This computer sends a report, work moves on, and the next report is approved counting from that send. */
  async function sendThenApproveTheNext() {
    table = PHONE_AT_10();
    const reports = await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_EVERYWHERE);
    await settle();
    const ownSend = sharedRow()?.deliveredAt as string;
    expect(ownSend).not.toBe('2026-10-01T10:00:00.000Z');
    mockAuth.snapshot = webSnapshot(100, new Date(Date.parse(ownSend) + 20_000).toISOString(), 70);
    reports.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    return { reports, ownSend };
  }

  it('the next report, approved on this computer\'s own send, is offered for sharing with nothing said about another device', async () => {
    const { ownSend } = await sendThenApproveTheNext();
    // The shared record holds that approval, not yet sent, over this computer's sent report.
    expect(sharedSnapshot()).toMatchObject({ deliveredAt: null, supersedes: { deliveredAt: ownSend } });
    expect(screen.queryByText(/after this one was approved/)).toBeNull();
    expect(since().getByText('Tower: Pour slab moved from 40% to 70% complete.')).toBeTruthy();
  });

  it('the phone then sends a later report: the approved one is stopped, in the panel and at Share', async () => {
    const { reports, ownSend } = await sendThenApproveTheNext();
    const later = new Date(Date.parse(ownSend) + 60_000).toISOString();
    const fromPhone = phoneSendsOver(sharedSnapshot() as DAVEReportSnapshot, 100, 80, later);
    // Real-shaped: the phone's report remembers this computer's as the report before it.
    expect(fromPhone).toMatchObject({ deliveredAt: later, sentBy: 'phone-install', supersedes: { deliveredAt: ownSend } });
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: fromPhone, deliveredAt: later });
    // This computer has downloaded the phone's changes since.
    mockAuth.snapshot = webSnapshot(100, new Date(Date.parse(later) + 60_000).toISOString(), 70);
    reports.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    expect((await screen.findAllByText(OTHER_DEVICE_SENT_LATER)).length).toBeGreaterThan(0);
    const before = copied().mock.calls.length;
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(copied().mock.calls.length).toBe(before);
    // The phone's report is still the one the next report counts from.
    expect(sharedRow()?.deliveredAt).toBe(later);
  });
});
