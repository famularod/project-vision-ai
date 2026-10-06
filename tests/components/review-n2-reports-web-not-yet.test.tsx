import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportPeriodMovedMessage, forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N2 follow-up (5 Oct 2026, to finding 4). After the share menu or an
// email draft the web asks "Was the report sent?" and promises "once you send
// it, use Mark as Sent"; "Not yet" answers "Nothing was recorded. Once you
// send it, use Mark as Sent." Both said so also when Mark as Sent was no
// longer offered for that report: another device (or another tab) had since
// sent a later report, so this one's approval was gone and its "since the
// last report" section out of date. They now say what is true.
// The web shell is real; the cloud is an in-memory report_snapshots table;
// the other tab is its own copy of the web report module. Synthetic data.

/** Another tab of the same browser: its own copy of the web report module, the same storage and cloud. */
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

const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const QUESTION = 'Was the report sent?';
const STOPPED_BY_TAB = /^Another tab of this browser sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;
const OTHER_DEVICE = /Your other device/;
const NOT_RECORDED = /^This computer could not record that this report was sent/;
const setNavigator = (value: unknown) => { (globalThis as { navigator?: unknown }).navigator = value; };

/** The other tab's page: it approves the report of `snapshot`'s facts and copies it (a send), at `sentAt`. */
async function otherTabApprovesAndCopies(snapshot: DAVEWebReadOnlySnapshot, sentAt = new Date().toISOString()) {
  const store = {
    storage: otherTab.daveWebReportStorage(async () => 'owner-1'),
    cloud: otherTab.daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
  };
  const truths = buildDAVEWebReportTruths(snapshot, null);
  const facts = buildDAVEReportSourceFingerprint(truths);
  const period = (await otherTab.loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot;
  const current = buildDAVEReportSnapshot({ truths, scopeKey: 'tower', sourceFingerprint: facts, capturedAt: snapshot.refreshedAt, reportFormat: 'project_manager' });
  expect((await otherTab.approveDAVEWebReportPeriod(store, current, reportPeriodSentAt(period))).status).toBe('saved');
  expect((await otherTab.recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, facts, sentAt))?.status).toBe('saved');
  await settle();
  return sentAt;
}
/** This tab approves the report on its page (Pour slab at 50%). */
async function approveHereAt50() {
  table = PHONE_AT_10();
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z', 50);
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return view;
}
const AT_70 = () => webSnapshot(100, '2026-10-01T12:05:00.000Z', 70);
/** Report history holding the report `saved` (as the page saved it). */
const historyOf = (saved: SavedReport) => [{
  id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
  category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
  projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
  webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
}] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'];

beforeEach(() => {
  otherTab.forgetDAVEWebOwnReportSends();
  otherTab.forgetDAVEWebReportTabMemory();
});

const NOT_YET_WITH_MARK = 'Nothing was recorded. Once you send it, use Mark as Sent.';
const PROMISE_WITH_MARK = 'If you sent it, the next report on every device runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.';
const USE_MARK_AS_SENT = /use Mark as Sent/;
const OVERTAKEN_BY_DEVICE = /^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;
const NOT_YET_OVERTAKEN_BY_DEVICE = /^Nothing was recorded\. Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;
const NOT_YET_OVERTAKEN_BY_TAB = /^Nothing was recorded\. Another tab of this browser sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;

/** This tab approves the report (Pour slab 50%) and hands it to the share menu: the question is up. */
async function sharedAndAsked() {
  setNavigator({ share: jest.fn(async () => undefined) });
  const view = await approveHereAt50();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(QUESTION);
  await settle();
  return view;
}
/** A refresh of the project record that changes no facts on this tab: the period is read again. */
async function periodReadAgain(view: ReturnType<typeof render>) {
  mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: '2026-10-01T12:07:00.000Z' };
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
}

describe('review N2 follow-up: "Not yet" and the question say what is true once the report has been overtaken', () => {
  it('the phone sent a later report meanwhile: no promise of Mark as Sent, and "Not yet" says why and what to do', async () => {
    const view = await sharedAndAsked();
    expect(screen.getByText(PROMISE_WITH_MARK)).toBeTruthy();
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();
    // The phone sends a later report; this tab reads the period again.
    const at = new Date().toISOString();
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: phoneSent(100, at), deliveredAt: at });
    await periodReadAgain(view);

    // Mark as Sent is gone; the question is still asked, and promises nothing it cannot keep.
    expect(screen.queryByLabelText('Mark as Sent')).toBeNull();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(screen.queryByText(USE_MARK_AS_SENT)).toBeNull();
    expect(within(screen.getByLabelText(QUESTION)).getByText(OVERTAKEN_BY_DEVICE)).toBeTruthy();

    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOT_YET_OVERTAKEN_BY_DEVICE)).toBeTruthy();
    expect(screen.queryByText(USE_MARK_AS_SENT)).toBeNull();
    expect(screen.queryByText(QUESTION)).toBeNull();
    // Nothing was recorded: the phone's report is still the last one sent.
    expect(sharedRow()?.deliveredAt).toBe(at);
  });

  it('another tab of this browser sent the later report: the same, and it is not called another device', async () => {
    const view = await sharedAndAsked();
    await otherTabApprovesAndCopies(AT_70());
    await periodReadAgain(view);
    expect(screen.queryByText(USE_MARK_AS_SENT)).toBeNull();
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOT_YET_OVERTAKEN_BY_TAB)).toBeTruthy();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(screen.queryByText(USE_MARK_AS_SENT)).toBeNull();
  });

  it('"Yes, it was sent" for a report the phone has overtaken still says it was not recorded, as before', async () => {
    const view = await sharedAndAsked();
    const at = new Date().toISOString();
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: phoneSent(100, at), deliveredAt: at });
    await periodReadAgain(view);
    fireEvent.press(screen.getByText('Yes, it was sent'));
    expect(await screen.findByText(/^Your other device sent a report .*, after this one was approved, so this one was not recorded as sent\. The next report counts from your other device's report\.$/)).toBeTruthy();
    expect(sharedRow()?.deliveredAt).toBe(at);
  });
});

describe('review N2 follow-up: Mark as Sent is promised only for a report it is offered for', () => {
  it('offered (its approval is waiting on this computer): the question and "Not yet" read as before', async () => {
    await sharedAndAsked();
    expect(screen.getByText(PROMISE_WITH_MARK)).toBeTruthy();
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOT_YET_WITH_MARK)).toBeTruthy();
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();
  });

  it('an older approved report opened from Report history, while Mark as Sent is for the later approval: nothing is promised for it', async () => {
    setNavigator({ share: jest.fn(async () => undefined) });
    const view = await approveHereAt50();
    const earlier = lastSaved();
    // Work moves on (70%); he regenerates and approves the next report over the first (told first, review N1 L5).
    mockAuth.snapshot = { ...AT_70(), referenceDocuments: historyOf(earlier) };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    fireEvent.press(await screen.findByText('Approve Anyway'));
    await screen.findByText('Share Approved Report');
    await settle();
    // He opens the first report from Report history and hands it to the share menu.
    fireEvent.press(screen.getByText('Open'));
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    // Mark as Sent on the page is for the later approval, not for this report.
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();
    expect(screen.getByText('If you sent it, the next report on every device runs from this one. If not, nothing is recorded.')).toBeTruthy();
    expect(within(screen.getByLabelText(QUESTION)).queryByText(USE_MARK_AS_SENT)).toBeNull();
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText('Nothing was recorded.')).toBeTruthy();
  });
});
