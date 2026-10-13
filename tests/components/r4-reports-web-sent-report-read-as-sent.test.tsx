import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// R4 (the coordinator's decision on R3's question 2). Where the facts on the web equal the last report another device sent,
// the web read "+0 completed; +0 open; +0 overdue." under "Since the last report", as if that were a new report to
// send; the phone and iPad read the report as it was sent and say the other device already sent it. The web's
// fingerprint of the facts never equalled the phone's (each filed the project under its own id). With one
// fingerprint for the same facts (R4 item 4a) the web reads it as they do, in the phone's sentence.
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

const PULLED = '2026-10-01T12:00:00.000Z';
/** A report as the phone saves and sends it: the facts' own fingerprint, carrying the report before it. */
const phoneReport = (frame: number, pour: number, sentAt: string, before: DAVEReportSnapshot | null) => {
  const truths = buildDAVEWebReportTruths(webSnapshot(frame, PULLED, pour), null);
  return markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
    truths, scopeKey: 'tower', sourceFingerprint: buildDAVEReportSourceFingerprint(truths), capturedAt: sentAt, reportFormat: 'project_manager',
  }), before) as DAVEReportSnapshot, sentAt, 'phone-install');
};
const ALREADY_SENT = /^Your other device already sent this report .*\. Approve it only if you want to send it a second time\.$/;
const NOTHING_SINCE = '+0 completed; +0 open; +0 overdue.';
/** The phone sent a report at 09:00 (Frame walls 40%) and one at 10:00 (Frame walls complete); the web has the same facts. */
const phoneSentTwice = () => {
  const at9 = phoneReport(40, 40, '2026-10-01T09:00:00.000Z', null);
  const at10 = phoneReport(100, 40, '2026-10-01T10:00:00.000Z', at9);
  table = new Map([['tower|project_manager', { snapshot: at10, deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
  mockAuth.snapshot = webSnapshot(100, PULLED);
};

describe('R4: the web reads a report another device sent, unchanged since, as it was sent', () => {
  it('"since the last report" reads as the phone\'s report did, and the page says the other device already sent it', async () => {
    phoneSentTwice();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    await settle();
    expect(since().queryByText(NOTHING_SINCE)).toBeNull();
    expect(since().getByText(ALREADY_SENT)).toBeTruthy();
    // The prepared report says the same.
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    await settle();
    expect(screen.queryByText(/after this one was approved/)).toBeNull();
  });

  it('guard: once something changes, it counts from the phone\'s report and says nothing of "already sent"', async () => {
    phoneSentTwice();
    const reports = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:10:00.000Z', 70);
    reports.rerender(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Pour slab moved from 40% to 70% complete.')).toBeTruthy());
    expect(since().queryByText('Tower: Frame walls was completed.')).toBeNull();
    expect(since().queryByText(ALREADY_SENT)).toBeNull();
  });

  it('guard: a report this computer sent itself is spoken of in its own words, as before', async () => {
    table = PHONE_AT_10();
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_EVERYWHERE);
    await settle();
    expect(screen.queryByText(ALREADY_SENT)).toBeNull();
    expect(screen.getByText(/^This report was sent from this computer .*\. Sharing it again is not counted as another send\.$/)).toBeTruthy();
  });

  it('guard: nor is it said in a new tab of the browser that sent the report', async () => {
    table = PHONE_AT_10();
    const first = await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED_EVERYWHERE);
    await settle();
    first.unmount();
    // A new tab: nothing of the old tab's memory, only what the browser keeps.
    forgetDAVEWebReportTabMemory();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    await settle();
    expect(since().queryByText(NOTHING_SINCE)).toBeNull();
    expect(since().queryByText(ALREADY_SENT)).toBeNull();
  });

  it('he approves it to send a second time: it goes out, and is said already recorded, not "could not record"', async () => {
    phoneSentTwice();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(ALREADY_SENT)).toBeTruthy());
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    // Approved to go again: the line under "Since the last report" has done its job.
    expect(since().queryByText(ALREADY_SENT)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Shared again\. This report was already recorded as sent .*, so this is not counted as another send\.$/)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not record that this report was sent/)).toBeNull();
    // The period still runs from the phone's report.
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
    expect(sharedSnapshot()).toMatchObject({ sentBy: 'phone-install', deliveredAt: '2026-10-01T10:00:00.000Z' });
  });
});
