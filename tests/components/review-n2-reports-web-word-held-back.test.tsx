import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { REPORT_PERIOD_WAITING_LINE } from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { DAVE_WEB_REPORT_SAYS_NOT_COUNTED, forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N2 follow-up (5 Oct 2026, finding 1). Approve, Share and Prepare
// Email refuse a report whose "Since the Last Report" section says "Not
// counted yet"; Download Word Report did not. A Word file is one of the ways
// he sends a report to a client, and the file itself carried the sentence:
// the red line on the page beside the button does not travel with it. It is
// now held back with the same line and the same way out (regenerate), from
// the report workspace and from Report history.
// The web shell is real. A Word download first gathers the report's pictures
// (resolveWebReportWordMedia, a stand-in here) and then loads the Word
// builder, which jest cannot load on demand: so "the download went ahead" is
// that the pictures were asked for, and "held back" is that they were not.
// Synthetic data.

const mockGatherPictures = jest.fn(async (_input: unknown) => ({ media: [], unavailableMedia: [] }));
jest.mock('../../services/ReportWordMedia.web', () => ({
  resolveWebReportWordMedia: (input: unknown) => mockGatherPictures(input),
}));

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

const NOT_COUNTED = /Not counted yet/;
const COMPLETED = 'Tower: Frame walls was completed.';
const WORD_WAITS = /^This computer hasn't received your other device's latest changes yet: it sent the last report .*\. Vitruvius is downloading them now; download the Word report once they arrive\.$/;
/** The Download Word Report button of the report in the workspace (Report history rows have one each, below it). */
const pressWorkspaceDownload = () => fireEvent.press(screen.getAllByText('Download Word Report')[0]);
/** The draft in the workspace, as it would go into the Word file. */
const draftText = () => screen.getAllByText(/Since the Last Report|Executive Summary/i).map(node => String(node.props.children)).join('\n');

/** The tab's last full download was at 9:00, the phone sent at 10:00, and Frame walls 100% is already here by live update. */
async function openReportsBehindThePhone() {
  table = PHONE_AT_10();
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T09:00:00.000Z');
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await screen.findAllByText(NOT_COUNTED);
  await waitFor(() => expect(mockAuth.refreshSnapshot).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  await settle();
  return view;
}
/** The page's own download (started 10:05) lands; nothing in the facts changes. */
async function downloadLands(view: ReturnType<typeof render>) {
  mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T10:05:00.000Z') };
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
  await settle();
}
/** A saved report in Report history; with the line in it unless `withLine` is false. */
function savedReport(id: string, status: 'draft' | 'approved', withLine = true) {
  const source = buildDAVEWebReportSource(webSnapshot(100, '2026-10-01T10:05:00.000Z'), null, 'sent:2026-10-01T10:00:00.000Z');
  const report = {
    status, audience: 'project_manager', title: `Tower report ${id}`,
    body: `# Tower report ${id}\n\n## Since the Last Report\nSince the report sent Oct 1, 2026\n- ${withLine ? REPORT_PERIOD_WAITING_LINE : 'Tower: Frame walls was completed.'}\n\n## Project Status\n- Tower: on plan.`,
    generatedAt: '2026-10-01T10:04:00.000Z', sourceRefreshedAt: source.refreshedAt, sourceFingerprint: source.fingerprint,
    sourceScopeKey: source.scopeKey, sourceTaskIds: source.taskIds, sourceUpdateIds: source.updateIds, sourceDocumentIds: source.documentIds,
    sourcePeriodKey: 'sent:2026-10-01T10:00:00.000Z',
    audit: [{ id: 'audit-1', action: status === 'approved' ? 'approved' : 'created', actor: 'pm@example.com', at: '2026-10-01T10:06:00.000Z' }],
  };
  return {
    id, name: report.title, originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
    category: 'Report', notes: 'Project report', isCurrent: true, importedAt: report.generatedAt,
    projectId: null, projectName: null, importBatchId: null, webVersionGroupId: 'report:portfolio',
    webReport: report, cloudUpdatedAt: '2026-10-01T10:06:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
  };
}

beforeEach(() => { mockGatherPictures.mockClear(); });

describe('review N2 follow-up: Download Word Report is held back for a report that says "Not counted yet"', () => {
  it('a draft he edited while the tab was behind: no Word file is started, and he is told why, in the words Approve uses', async () => {
    const view = await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Edit Report'));
    fireEvent.changeText(screen.getByLabelText('Report body'), `${String(screen.getByLabelText('Report body').props.value)}\nSee you Thursday.`);
    fireEvent.press(screen.getByText('Close Editor'));
    await downloadLands(view);
    expect(draftText()).toMatch(NOT_COUNTED);

    pressWorkspaceDownload();
    await settle();
    expect(mockGatherPictures).not.toHaveBeenCalled();
    // Said in the review panel and once under the draft, not a third time.
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toHaveLength(2);

    // The way out is the same: regenerate; the draft then lists the change, and the download goes ahead.
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    expect(draftText()).not.toMatch(NOT_COUNTED);
    expect(draftText()).toContain('Frame walls was completed.');
    pressWorkspaceDownload();
    await settle();
    expect(mockGatherPictures).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toBeNull();
  });

  it('while the tab is still waiting: held back, and told the changes are on their way and to download once they arrive', async () => {
    const view = await openReportsBehindThePhone();
    pressWorkspaceDownload();
    await settle();
    expect(mockGatherPictures).not.toHaveBeenCalled();
    expect(screen.getByText(WORD_WAITS)).toBeTruthy();
    // They arrive: the untouched draft is written again, and the same press now goes ahead.
    await downloadLands(view);
    expect(draftText()).not.toMatch(NOT_COUNTED);
    pressWorkspaceDownload();
    await settle();
    expect(mockGatherPictures).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WORD_WAITS)).toBeNull();
  });

  it('from Report history, workspace closed: the saved report is not downloaded, and the line is said under its row', async () => {
    table = PHONE_AT_10();
    mockAuth.snapshot = {
      ...webSnapshot(100, '2026-10-01T10:05:00.000Z'),
      referenceDocuments: [savedReport('A', 'approved'), savedReport('B', 'draft', false)] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    expect(screen.queryByText('Approve Report')).toBeNull();
    const [rowA, rowB] = screen.getAllByText('Download Word Report');

    fireEvent.press(rowA);
    await settle();
    expect(mockGatherPictures).not.toHaveBeenCalled();
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toHaveLength(1);

    // A saved report that does not say it downloads as before, and the line under the other row goes.
    fireEvent.press(rowB);
    await settle();
    expect(mockGatherPictures).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toBeNull();
  });

  it('a report that does not say it goes ahead as before, approved or not', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    await settle();
    expect(draftText()).toContain('Frame walls was completed.');
    pressWorkspaceDownload();
    await settle();
    expect(mockGatherPictures).toHaveBeenCalledTimes(1);
  });
});
