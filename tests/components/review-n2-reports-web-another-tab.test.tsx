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

// Review N2 of reports (5 Oct 2026, Low, caused by d33757b). With Reports
// open in two tabs, this tab approved a report ("Pour slab moved from 20% to
// 50%"), the other tab then approved and copied a later one (70%), and this
// tab's report still went out by Share Approved Report: another tab's send is
// this browser's own, and its own sends never stopped a share. Only
// afterwards did the page say it could not record it. Another DEVICE's later
// send stops the report before it leaves; another TAB's now does too, in the
// same words but for "Another tab of this browser" (a116909).
// The web shell is real; the cloud is an in-memory report_snapshots table.
// The other tab is its own copy of the web report module (its own memory),
// on the same browser storage and cloud. Synthetic data.

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

describe('review N2 (Low): another tab\'s later send stops an approved report before it leaves this tab', () => {
  it('the reviewer\'s seed 5164 (share menu): nothing is handed over, nothing is asked, and he is told another tab sent a report', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    await approveHereAt50();
    const sentAt = await otherTabApprovesAndCopies(AT_70());
    expect(sharedRow()?.deliveredAt).toBe(sentAt);

    fireEvent.press(screen.getByText('Share Approved Report'));
    expect((await screen.findAllByText(STOPPED_BY_TAB)).length).toBeGreaterThan(0);
    await settle();
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    // The other tab's report is still the last one sent.
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('copy and Prepare Email are stopped the same way', async () => {
    await approveHereAt50();
    await otherTabApprovesAndCopies(AT_70());
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect((await screen.findAllByText(STOPPED_BY_TAB)).length).toBeGreaterThan(0);
    expect(copied()).not.toHaveBeenCalled();
    const open = (globalThis as unknown as { window: { open: jest.Mock } }).window.open;
    fireEvent.press(screen.getByText('Prepare Email'));
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.getAllByText(STOPPED_BY_TAB).length).toBeGreaterThan(0);
  });

  it('once this tab has read the period again, the page says so before he presses anything, and Share is still stopped', async () => {
    const view = await approveHereAt50();
    await otherTabApprovesAndCopies(AT_70());
    // A refresh of the project record (the other tab's change arrives): the period is read again.
    mockAuth.snapshot = AT_70();
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    // In the review panel, as for another device's later report.
    expect(screen.getAllByText(STOPPED_BY_TAB)).toHaveLength(1);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(copied()).not.toHaveBeenCalled();
    // Work moves on (Pour slab 80%). Regenerated and approved, the report counts from the other tab's and goes out.
    mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:10:00.000Z', 80);
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryAllByText(STOPPED_BY_TAB)).toHaveLength(0);
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(String(copied().mock.calls[0][0])).toContain('Pour slab moved from 70% to 80% complete.');
  });

  it('the words are another device\'s, but for who sent it', () => {
    const key = 'sent:2026-10-01T13:00:00.000Z';
    expect(daveWebReportPeriodMovedMessage(key, true)).toBe(daveWebReportPeriodMovedMessage(key).replace('Your other device', 'Another tab of this browser'));
    expect(daveWebReportPeriodMovedMessage(key)).toMatch(/^Your other device sent a report /);
  });
});

describe('review N2 (Low): what does not stop a report', () => {
  it('this tab\'s own send of the report on screen: shared again, said already recorded, as before', async () => {
    await approveHereAt50();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Shared again\. This report was already recorded as sent /)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(STOPPED_BY_TAB)).toHaveLength(0);
  });

  it('the other tab sent the very report on this tab\'s screen: shared, and said already recorded', async () => {
    await approveHereAt50();
    // The other tab approves and copies the same facts (Pour slab 50%).
    await otherTabApprovesAndCopies(webSnapshot(100, '2026-10-01T12:00:00.000Z', 50));
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(STOPPED_BY_TAB)).toHaveLength(0);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
  });

  it('an older approved report opened from Report history after this browser sent a later one: copied, as pass 1 pinned it', async () => {
    const first = await approveHereAt50();
    const earlier = lastSaved();
    first.unmount();
    // Another tab (or an earlier visit) of this browser sends the later report before he opens the older one.
    const sentAt = await otherTabApprovesAndCopies(AT_70());
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    mockAuth.snapshot = { ...AT_70(), referenceDocuments: historyOf(earlier) };
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryAllByText(STOPPED_BY_TAB)).toHaveLength(0);
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NOT_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('the reviewer\'s seed 5208: an older report opened from Report history, and another tab sends a later one after that: still copied, as pass 1 pinned it', async () => {
    const view = await approveHereAt50();
    const earlier = lastSaved();
    // Work moves on (70%); he opens the approved 50% report from Report history in this tab.
    mockAuth.snapshot = { ...AT_70(), referenceDocuments: historyOf(earlier) };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    // Only now does the other tab approve and copy the later report.
    const sentAt = await otherTabApprovesAndCopies(AT_70());
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NOT_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(STOPPED_BY_TAB)).toHaveLength(0);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('this tab\'s own Mark as Sent of the later approval, with an older report on screen, is never called another tab\'s', async () => {
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
    // He opens the first report from Report history, then marks the second (the approval waiting) as sent, in this tab.
    fireEvent.press(screen.getByText('Open'));
    await settle();
    await new Promise(resolve => setTimeout(resolve, 5));
    fireEvent.press(screen.getByLabelText('Mark as Sent'));
    await settle();
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    expect(screen.queryAllByText(/Another tab of this browser/)).toHaveLength(0);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    // The older report can still be copied; it is not the one recorded, and the page says so (pass 1).
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NOT_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(/Another tab of this browser/)).toHaveLength(0);
  });

  it('a send this tab recorded itself (Mark as Sent of the approval the other tab made) is not another tab\'s: the report here is copied as before', async () => {
    const view = await approveHereAt50();
    // The other tab approves the later report (70%) and does not send it.
    const store = {
      storage: otherTab.daveWebReportStorage(async () => 'owner-1'),
      cloud: otherTab.daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
    };
    const truths = buildDAVEWebReportTruths(AT_70(), null);
    const later = buildDAVEReportSnapshot({ truths, scopeKey: 'tower', sourceFingerprint: buildDAVEReportSourceFingerprint(truths), capturedAt: AT_70().refreshedAt, reportFormat: 'project_manager' });
    expect((await otherTab.approveDAVEWebReportPeriod(store, later, '2026-10-01T10:00:00.000Z')).status).toBe('saved');
    await settle();
    // This tab reads the period again (a refresh that changes no facts here): the approval waiting is that one.
    mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: '2026-10-01T12:06:00.000Z' };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    // He marks it sent from this tab.
    fireEvent.press(screen.getByLabelText('Mark as Sent'));
    await settle();
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    expect(sharedSnapshot()?.sourceFingerprint).toBe(later.sourceFingerprint);
    // The report approved here is still on screen; this tab's own record is never called another tab's.
    expect(screen.queryAllByText(/Another tab of this browser/)).toHaveLength(0);
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NOT_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(/Another tab of this browser/)).toHaveLength(0);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
  });

  it('another device\'s later send still stops it, in its own words', async () => {
    await approveHereAt50();
    const at = new Date().toISOString();
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: phoneSent(100, at), deliveredAt: at });
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect((await screen.findAllByText(/^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\./)).length).toBeGreaterThan(0);
    expect(copied()).not.toHaveBeenCalled();
    expect(screen.queryByText(/Another tab/)).toBeNull();
  });
});
