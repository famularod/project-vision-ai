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

// Review N2 of reports (5 Oct 2026, Low, a leftover of 72b7fc8). After the
// share menu or an email draft the web asks "Was the report sent?". When he
// then recorded that same report with Mark as Sent, the question stayed up,
// and "Not yet" said "Nothing was recorded. Once you send it, use Mark as
// Sent." though it had just been recorded.
// The web shell is real; the cloud is an in-memory report_snapshots table
// (the harness of owner-2oct-web-report-sends). Synthetic data.

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

const QUESTION = 'Was the report sent?';
const NOTHING_RECORDED = 'Nothing was recorded. Once you send it, use Mark as Sent.';
const RECORDED_EVERYWHERE = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const REFUSED = /^Your other device sent a report .*, after this one was approved, so this one was not recorded as sent\./;
const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const rows = () => table as Map<string, { snapshot: unknown; deliveredAt: string | null }>;
const setNavigator = (value: unknown) => { (globalThis as { navigator?: unknown }).navigator = value; };

async function approveOnWeb() {
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
}
async function markSentJustNow() {
  fireEvent.press(screen.getByLabelText('Mark as Sent'));
  await settle();
  fireEvent.press(screen.getByLabelText('Record as Sent'));
  await settle();
}

describe('review N2 (Low): "Was the report sent?" goes once that report is recorded with Mark as Sent', () => {
  it('after the share menu: Mark as Sent records it, and the question and "Not yet" are gone', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    await markSentJustNow();

    expect(screen.getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    const sentAt = sharedSnapshot()?.deliveredAt;
    expect(typeof sentAt).toBe('string');
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByText('Not yet')).toBeNull();
    expect(screen.queryByText('Yes, it was sent')).toBeNull();
    expect(screen.queryByText(NOTHING_RECORDED)).toBeNull();
    // Recorded once.
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('after an email draft: the same', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Prepare Email'));
    await screen.findByText(QUESTION);
    await markSentJustNow();
    expect(screen.getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByText(NOTHING_RECORDED)).toBeNull();
  });

  it('Mark as Sent refused because the phone sent a later report: the question goes too, and he is told why nothing was recorded', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    const at = new Date(Date.now() - 1000).toISOString();
    rows().set('tower|project_manager', { snapshot: phoneSent(100, at), deliveredAt: at });
    await markSentJustNow();
    expect(screen.getByText(REFUSED)).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByText('Not yet')).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe(at);
  });

  it('a time he may not pick records nothing, and the question stays to be answered', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    fireEvent.press(screen.getByLabelText('Mark as Sent'));
    fireEvent.press(screen.getByLabelText('Sent earlier'));
    const [input] = screen.UNSAFE_root.findAll(node => node.type === 'input');
    act(() => { input.props.onChange({ target: { value: '2026-09-30T09:00' } }); });
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    expect(await screen.findByText(/^Choose .* or later: this report has the project facts as they were then\.$/)).toBeTruthy();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    // "Not yet" is then true, and says so.
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOTHING_RECORDED)).toBeTruthy();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
  });

  it('a question about another report stays: Mark as Sent recorded the later approval, not the report that was shared', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const first = lastSaved();
    // The facts move on (Pour slab 70%); he regenerates and approves the next report over the first.
    mockAuth.snapshot = {
      ...webSnapshot(100, '2026-10-01T12:01:00.000Z', 70),
      referenceDocuments: [{
        id: first.id, name: String(first.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
        category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(first.report.generatedAt),
        projectId: null, projectName: first.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
        webReport: first.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
      }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    fireEvent.press(await screen.findByText('Approve Anyway'));
    await screen.findByText('Share Approved Report');
    await settle();
    const second = sharedSnapshot() as DAVEReportSnapshot;

    // He opens the first report from Report history and hands it to the share menu: the question is about that one.
    fireEvent.press(screen.getByText('Open'));
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    // Mark as Sent is for the approval waiting, the second report.
    await markSentJustNow();
    expect(screen.getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    expect(sharedSnapshot()?.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
    expect(screen.getByText(QUESTION)).toBeTruthy();
  });

  it('"Yes, it was sent" still records the report and takes the question and Mark as Sent away, as before', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    fireEvent.press(await screen.findByText('Yes, it was sent'));
    await screen.findByText(RECORDED_EVERYWHERE);
    await settle();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByLabelText('Mark as Sent')).toBeNull();
  });
});
