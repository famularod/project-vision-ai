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

// R1 item 3 (8 Oct 2026, the owner's open items). On the web, sharing again
// (and Mark as Sent) recognise only this computer's last three sent reports:
// that is how many a saved period remembers. An older report opened from
// Report history and shared again was answered "This computer could not
// record that this report was sent ... The next report ... may repeat what
// this one covered", as if something had gone wrong. The page now says what
// the limit is. The web shell is real; the cloud is an in-memory
// report_snapshots table. Synthetic data.

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


const OLDER_THAN_REMEMBERED = 'This is an older report. This computer remembers the last three reports it sent, and this one is from before them, so it cannot tell whether it was sent from here and has not recorded it as sent again. The next report still counts from the last report recorded as sent.';
/** He approves the report on screen and shares it (copied to be pasted and sent). */
async function shareIt() {
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(/^Recorded as sent /);
  await settle();
}
/** The facts move on (Pour slab at `pour`%); he regenerates, approves and shares the next report. */
async function nextReport(view: ReturnType<typeof render>, pour: number, minute: number) {
  mockAuth.snapshot = webSnapshot(100, `2026-10-01T12:${String(minute).padStart(2, '0')}:00.000Z`, pour);
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
  fireEvent.press(screen.getByText('Regenerate from Current Facts'));
  await settle();
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  await shareIt();
}
/** He opens a saved report from Report history on a later visit. */
async function openFromHistory(saved: SavedReport, facts: DAVEWebReadOnlySnapshot) {
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  mockAuth.snapshot = { ...facts, referenceDocuments: historyOf(saved) };
  render(<DesktopReadOnlyShell page="reports" />);
  await settle();
  fireEvent.press(screen.getByText('Open'));
  await screen.findByText('Share Approved Report');
  await settle();
  copied().mockClear();
}

describe('R1 item 3: a report from before the last three sent says so when it is shared again', () => {
  it('four reports sent from here, the first opened from Report history and shared: copied, and told plainly why nothing is recorded', async () => {
    const view = await approveHereAt50();
    await shareIt();
    const first = lastSaved();
    await nextReport(view, 60, 10);
    await nextReport(view, 70, 20);
    await nextReport(view, 80, 30);
    const lastSend = sharedRow()?.deliveredAt;
    view.unmount();
    await openFromHistory(first, webSnapshot(100, '2026-10-01T12:30:00.000Z', 80));
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(OLDER_THAN_REMEMBERED)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    // Nothing new is recorded: the period still runs from the last report sent.
    expect(sharedRow()?.deliveredAt).toBe(lastSend);
  });

  it('guard: the third report back is still remembered: shared again, "already recorded"', async () => {
    const view = await approveHereAt50();
    await shareIt();
    const first = lastSaved();
    await nextReport(view, 60, 10);
    await nextReport(view, 70, 20);
    view.unmount();
    await openFromHistory(first, webSnapshot(100, '2026-10-01T12:20:00.000Z', 70));
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Shared again\. This report was already recorded as sent /)).toBeTruthy();
    await settle();
    expect(screen.queryByText(OLDER_THAN_REMEMBERED)).toBeNull();
  });
});
