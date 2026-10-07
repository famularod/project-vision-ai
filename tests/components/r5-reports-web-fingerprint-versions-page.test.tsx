import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  isLegacyReportSource,
  legacyReportSourcesOf,
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

// R5 item 2. R4 (item 4a) gave the report's fingerprint a new version and kept every report made under the
// earlier one known for the same facts. Three checks in the web Reports page's own record of a send had no test
// of their own (R4's notes): taking an approved report as this computer's approval when no approval of it is on
// record, moving the approval onto the period its own send starts, and promising Mark as Sent for the report the
// "Was the report sent?" question is about. Each is pinned here with a report made by the build before (its
// fingerprint the earlier version's) meeting the same facts today.
// The web shell is real; the cloud is an in-memory report_snapshots table (the harness of
// review-n2-reports-web-another-tab). Synthetic data.

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

const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const QUESTION = 'Was the report sent?';
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
/** Report history holding the report `saved` (as the page saved it). */
const historyOf = (saved: SavedReport) => [{
  id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
  category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
  projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
  webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
}] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'];

const NOT_YET_WITH_MARK = 'Nothing was recorded. Once you send it, use Mark as Sent.';
const PROMISE_WITH_MARK = 'If you sent it, the next report on every device runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.';
const RECORDED = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const SENT_FROM_HERE = /^This report was sent from this computer .*\. Sharing it again is not counted as another send\.$/;
const SHARED_AGAIN = /^Shared again\. This report was already recorded as sent .*, so this is not counted as another send\.$/;
const AT_50 = () => webSnapshot(100, '2026-10-01T12:00:00.000Z', 50);
/**
 * The approval waiting in the shared record for the report now on the page (Pour slab 50%), as the build before
 * saved it from another browser: the same report under the earlier fingerprint, counting from the phone's 10:00 one.
 */
function approvalMadeBeforeTheUpdateWaits() {
  const truths = buildDAVEWebReportTruths(AT_50(), null);
  const earlier = buildDAVELegacyReportSourceFingerprint(truths);
  expect(isLegacyReportSource(earlier)).toBe(true);
  expect(earlier).not.toBe(buildDAVEReportSourceFingerprint(truths));
  const approval = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths, scopeKey: 'tower', sourceFingerprint: earlier, capturedAt: '2026-10-01T11:00:00.000Z', reportFormat: 'project_manager',
  }), phoneSent(40, '2026-10-01T10:00:00.000Z')) as DAVEReportSnapshot;
  expect(approval.deliveredAt).toBeNull();
  table = new Map([['tower|project_manager', { snapshot: approval, deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
  mockAuth.snapshot = AT_50();
  return approval;
}
/** He opens Reports after the update and approves the report on the page: the same facts as that approval. */
async function approveTheSameReportHere() {
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return view;
}

describe('R5 item 2 (web page): a report made under the earlier fingerprint version, the same facts today', () => {
  it('the approval stands on the period its own send starts: shared, it is recorded, stays the approved report, and a second share is not another send', async () => {
    const approval = approvalMadeBeforeTheUpdateWaits();
    await approveTheSameReportHere();
    // Nothing replaced the approval: it is still the one made before the update.
    expect(sharedSnapshot()).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: null });
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED);
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(sharedSnapshot()).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: expect.any(String) });
    // Still the approved report on the page, known as sent from here.
    expect(screen.getByText(SENT_FROM_HERE)).toBeTruthy();
    expect(screen.getByText('Share Approved Report')).toBeTruthy();
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(SHARED_AGAIN)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(2);
  });

  it('after that send he corrects a word in the report and approves it again: it stands on the period its send started, and is not refused as "facts changed"', async () => {
    approvalMadeBeforeTheUpdateWaits();
    await approveTheSameReportHere();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED);
    await settle();
    fireEvent.press(screen.getByText('Edit Report'));
    fireEvent.changeText(screen.getByLabelText('Report body'), `${String(screen.getByLabelText('Report body').props.value)}\nSee you Thursday.`);
    fireEvent.press(screen.getByText('Approve Report'));
    // (Left on the period it was approved on, it read "Project facts changed after this report was prepared ...".)
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText(/^Project facts changed after this report was prepared/)).toBeNull();
    // Still that report, already sent: sharing it is not another send.
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(SHARED_AGAIN)).toBeTruthy();
    await settle();
  });

  it('"Was the report sent?" for that report promises Mark as Sent, and "Not yet" says to use it: its approval is the one waiting here', async () => {
    approvalMadeBeforeTheUpdateWaits();
    setNavigator({ share: jest.fn(async () => undefined) });
    await approveTheSameReportHere();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    await settle();
    expect(screen.getByText(PROMISE_WITH_MARK)).toBeTruthy();
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOT_YET_WITH_MARK)).toBeTruthy();
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();
  });

  it('an approved report saved before the update, with no approval of it on record: shared from Report history, this computer takes it as its approval and records the send', async () => {
    // Approved on this computer (the page saves the report with its source).
    const first = await approveHereAt50();
    const saved = lastSaved();
    first.unmount();
    // As the build before saved it: its facts under the earlier fingerprint. And this browser's site data was
    // cleared since, so no approval of it is kept here or in the shared record (the phone's 10:00 report is).
    const source = String(saved.report.sourceFingerprint);
    const [facts, ...rest] = source.split(':media-');
    const [earlier] = legacyReportSourcesOf(facts);
    expect(isLegacyReportSource(earlier)).toBe(true);
    const savedBefore = { ...saved, report: { ...saved.report, sourceFingerprint: [earlier, ...rest].join(':media-') } };
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    profile.clear();
    table = PHONE_AT_10();
    copied().mockClear();
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T12:00:00.000Z', 50), referenceDocuments: historyOf(savedBefore) };
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    // (It read "This computer could not record that this report was sent ..." without the check.)
    expect(await screen.findByText(RECORDED)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    expect(sharedSnapshot()).toMatchObject({ deliveredAt: expect.any(String), supersedes: { deliveredAt: '2026-10-01T10:00:00.000Z' } });
  });
});
