import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { REPORT_PERIOD_WAITING_LINE } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEWebReportSource,
  buildDAVEWebReportTruths,
  daveWebReportSourceIsCurrent,
  daveWebReportSourceNotCounted,
  daveWebReportSourceOnPeriod,
} from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVE_WEB_REPORT_PREPARED_WHILE_WAITING,
  DAVE_WEB_REPORT_SAYS_NOT_COUNTED,
  forgetDAVEWebReportPeriodSession,
} from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N2 of reports (5 Oct 2026, Medium, caused by 58d42da). The web tab's
// last full download was at 9:00; the phone sent a report at 10:00; the tab
// already had the change (Frame walls 100%) by live update. He opened Reports:
// the draft was written while the tab was behind ("Not counted yet"). The
// page's own download landed and changed no facts: the card showed "Frame
// walls was completed.", the page said "Ready for review / The draft matches
// the latest project facts", and the draft still said "Not counted yet".
// Approve and Share sent that and recorded it as sent, so the change was
// never listed in any report.
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
const MATCHES = 'The draft matches the latest project facts. Review the wording, then save or approve it.';
const BEHIND = /^This computer hasn't received your other device's latest changes yet/;
const COMPLETED = 'Tower: Frame walls was completed.';
/** The preview's text: the draft as it would be approved. */
const draftText = () => screen.getAllByText(/Since the Last Report|Executive Summary/i).map(node => String(node.props.children)).join('\n');

/** The tab's last full download was at 9:00, the phone sent at 10:00, and Frame walls 100% is already here by live update. */
async function openReportsBehindThePhone() {
  table = PHONE_AT_10();
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T09:00:00.000Z');
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await screen.findAllByText(NOT_COUNTED);
  // The page asks for its own download once.
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

describe('review N2 (Medium): a draft written while this tab was behind is rewritten when the wait ends', () => {
  it('the reviewer\'s steps: the download lands with the same facts, and the draft, the approval and the copy all list the change', async () => {
    const view = await openReportsBehindThePhone();
    // While it waits, the draft says so, and the page does not call it ready.
    expect(draftText()).toMatch(NOT_COUNTED);
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();
    expect(screen.getByText(BEHIND)).toBeTruthy();

    await downloadLands(view);
    // The wait is over: nothing on the page says "Not counted yet", and the draft lists what the card lists.
    expect(screen.queryAllByText(NOT_COUNTED)).toHaveLength(0);
    expect(draftText()).toContain('Frame walls was completed.');
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByText(MATCHES)).toBeTruthy();

    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    const approved = String(lastSaved().report.body);
    expect(lastSaved().report.status).toBe('approved');
    expect(approved).not.toMatch(NOT_COUNTED);
    expect(approved).toContain('## Since the Last Report');
    expect(approved).toContain('- Tower: Frame walls was completed.');

    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    const text = String(copied().mock.calls[0][0]);
    expect(text).not.toMatch(NOT_COUNTED);
    expect(text).toContain('Frame walls was completed.');
    expect(sharedRow()?.deliveredAt).not.toBe('2026-10-01T10:00:00.000Z');
  });

  it('while the tab is still behind, Approve is refused and nothing is saved as approved', async () => {
    await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(screen.getAllByText(BEHIND).length).toBeGreaterThan(0);
    expect(screen.queryByText('Share Approved Report')).toBeNull();
    expect(approvals()).toHaveLength(0);
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('a draft he regenerated while behind is rewritten when the wait ends too', async () => {
    const view = await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    expect(draftText()).toMatch(NOT_COUNTED);
    await downloadLands(view);
    expect(screen.queryAllByText(NOT_COUNTED)).toHaveLength(0);
    expect(draftText()).toContain('Frame walls was completed.');
    expect(screen.getByText('Ready for review')).toBeTruthy();
  });
});

describe('review N2 (Medium): the page never calls a draft that says "Not counted yet" ready, and it cannot be approved', () => {
  it('a draft he edited while behind keeps his words: the page says why it cannot be approved, until he regenerates', async () => {
    const view = await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Edit Report'));
    const edited = `${String(screen.getByLabelText('Report body').props.value)}\nSee you Thursday.`;
    fireEvent.changeText(screen.getByLabelText('Report body'), edited);
    fireEvent.press(screen.getByText('Close Editor'));
    await downloadLands(view);

    // His edited draft is not rewritten under him; it still says "Not counted yet".
    expect(draftText()).toContain('See you Thursday.');
    expect(draftText()).toMatch(NOT_COUNTED);
    // So the page does not say it is ready, or that it matches the facts; it says what is wrong, plainly.
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();
    expect(screen.getByText('Refresh required')).toBeTruthy();
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Project facts changed after this draft was prepared/)).toBeNull();

    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(screen.queryByText('Share Approved Report')).toBeNull();
    expect(approvals()).toHaveLength(0);
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED).length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    expect(screen.queryAllByText(NOT_COUNTED)).toHaveLength(0);
    expect(screen.getByText('Ready for review')).toBeTruthy();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    expect(String(lastSaved().report.body)).toContain('- Tower: Frame walls was completed.');
  });

  it('a draft saved while behind and reopened from Report history after the wait: not ready, and not approved', async () => {
    const view = await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Save Draft'));
    await screen.findByText('Report draft saved to the shared project record.');
    const saved = lastSaved();
    expect(saved.report.status).toBe('draft');
    expect(String(saved.report.body)).toMatch(NOT_COUNTED);
    view.unmount();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();

    // A later visit, with every change downloaded.
    mockAuth.snapshot = {
      ...webSnapshot(100, '2026-10-01T10:05:00.000Z'),
      referenceDocuments: [{
        id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
        category: 'Report', notes: 'Draft project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
        projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
        webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
      }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    fireEvent.press(screen.getByText('Open'));
    await settle();
    expect(draftText()).toMatch(NOT_COUNTED);
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED).length).toBeGreaterThan(0);
    mockAuth.saveReport.mockClear();
    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(approvals()).toHaveLength(0);
    expect(screen.queryByText('Share Approved Report')).toBeNull();
  });

  it('he edited the line out while behind: the draft still does not count the other device\'s changes, and says so', async () => {
    const view = await openReportsBehindThePhone();
    fireEvent.press(screen.getByText('Edit Report'));
    const body = String(screen.getByLabelText('Report body').props.value);
    fireEvent.changeText(screen.getByLabelText('Report body'), body.replace(`- ${REPORT_PERIOD_WAITING_LINE}`, '- Nothing to report.'));
    fireEvent.press(screen.getByText('Close Editor'));
    await downloadLands(view);

    expect(screen.queryAllByText(NOT_COUNTED)).toHaveLength(0);
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();
    expect(screen.getAllByText(DAVE_WEB_REPORT_PREPARED_WHILE_WAITING).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(approvals()).toHaveLength(0);
    expect(screen.queryByText('Share Approved Report')).toBeNull();
  });
});

/** A report saved with the line in it by the build under review (its fingerprint says nothing of the wait), back in Report history. */
function savedWithTheLine(status: 'draft' | 'approved') {
  const source = buildDAVEWebReportSource(webSnapshot(100, '2026-10-01T10:05:00.000Z'), null, 'sent:2026-10-01T10:00:00.000Z');
  const report = {
    status, audience: 'project_manager', title: 'Tower — Project Manager Report',
    body: `# Tower — Project Manager Report\n\n## Since the Last Report\nSince the report sent Oct 1, 2026\n- ${REPORT_PERIOD_WAITING_LINE}\n\n## Project Status\n- Tower: on plan.`,
    generatedAt: '2026-10-01T10:04:00.000Z', sourceRefreshedAt: source.refreshedAt, sourceFingerprint: source.fingerprint,
    sourceScopeKey: source.scopeKey, sourceTaskIds: source.taskIds, sourceUpdateIds: source.updateIds, sourceDocumentIds: source.documentIds,
    sourcePeriodKey: 'sent:2026-10-01T10:00:00.000Z',
    audit: [{ id: 'audit-1', action: status === 'approved' ? 'approved' : 'created', actor: 'pm@example.com', at: '2026-10-01T10:06:00.000Z' }],
  };
  table = PHONE_AT_10();
  mockAuth.snapshot = {
    ...webSnapshot(100, '2026-10-01T10:05:00.000Z'),
    referenceDocuments: [{
      id: 'web-report-old', name: report.title, originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
      category: 'Report', notes: 'Project report', isCurrent: true, importedAt: report.generatedAt,
      projectId: null, projectName: null, importBatchId: null, webVersionGroupId: 'report:portfolio',
      webReport: report, cloudUpdatedAt: '2026-10-01T10:06:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
    }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
  };
}

describe('review N2 (Medium): a saved report that says "Not counted yet" is not approved or shared from the web', () => {
  it('a draft saved with the line: the page does not call it ready, and Approve is refused and says why', async () => {
    savedWithTheLine('draft');
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    fireEvent.press(screen.getByText('Open'));
    await settle();
    expect(draftText()).toMatch(NOT_COUNTED);
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();
    expect(screen.getByText('Refresh required')).toBeTruthy();
    // Said in the review panel and under the draft; pressing Approve says it once more, not a third time.
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toHaveLength(2);
    expect(screen.queryByText(/^Project facts changed after this/)).toBeNull();
    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(approvals()).toHaveLength(0);
    expect(mockAuth.saveReportPeriod).not.toHaveBeenCalled();
    expect(screen.queryByText('Share Approved Report')).toBeNull();
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED)).toHaveLength(2);
    expect(screen.queryByText(/^Project facts changed after this/)).toBeNull();
  });

  it('Share and Prepare Email: nothing is copied, no draft is opened, nothing is asked or recorded, and he is told why', async () => {
    savedWithTheLine('approved');
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText('Ready for review')).toBeNull();
    expect(screen.queryByText(MATCHES)).toBeNull();

    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(copied()).not.toHaveBeenCalled();
    expect(screen.getAllByText(DAVE_WEB_REPORT_SAYS_NOT_COUNTED).length).toBeGreaterThan(0);

    const open = (globalThis as unknown as { window: { open: jest.Mock } }).window.open;
    fireEvent.press(screen.getByText('Prepare Email'));
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText('Was the report sent?')).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('the share menu is not opened either', async () => {
    const share = jest.fn(async () => undefined);
    (globalThis as { navigator?: unknown }).navigator = { share };
    savedWithTheLine('approved');
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText(COMPLETED)).toBeTruthy());
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByText('Was the report sent?')).toBeNull();
  });
});

describe('review N2 (Medium): what a prepared report remembers of the wait', () => {
  const facts = webSnapshot(100, '2026-10-01T10:05:00.000Z');
  const PERIOD = 'sent:2026-10-01T10:00:00.000Z';

  it('a report prepared while "since the last report" was not counted is not current once it is counted', () => {
    const waiting = buildDAVEWebReportSource(facts, null, PERIOD, true);
    const counted = buildDAVEWebReportSource(facts, null, PERIOD);
    expect(daveWebReportSourceNotCounted(waiting.fingerprint)).toBe(true);
    expect(daveWebReportSourceNotCounted(counted.fingerprint)).toBe(false);
    expect(daveWebReportSourceIsCurrent(waiting.fingerprint, counted)).toBe(false);
    // Still waiting: the same facts, the same period, the same wait.
    expect(daveWebReportSourceIsCurrent(waiting.fingerprint, buildDAVEWebReportSource(facts, null, PERIOD, true))).toBe(true);
    // The project facts and the period are read from it as before.
    expect(waiting.fingerprint.split(':media-')[0]).toBe(counted.fingerprint.split(':media-')[0]);
    expect(waiting.periodKey).toBe(PERIOD);
  });

  it('moved to another period, it is still a report that did not count them', () => {
    const waiting = buildDAVEWebReportSource(facts, null, PERIOD, true);
    const moved = daveWebReportSourceOnPeriod(waiting, 'sent:2026-10-01T11:00:00.000Z');
    expect(daveWebReportSourceNotCounted(moved.fingerprint)).toBe(true);
    expect(moved.fingerprint.endsWith(':period-sent:2026-10-01T11:00:00.000Z')).toBe(true);
  });

  it('a report counted as before keeps the fingerprint it had: saved reports stay current', () => {
    const counted = buildDAVEWebReportSource(facts, null, PERIOD);
    expect(counted.fingerprint).toMatch(/^dave-report-source\/1\.0:[0-9a-f]+:media-[0-9a-f]{8}:period-sent:2026-10-01T10:00:00\.000Z$/);
    expect(buildDAVEWebReportSource(facts, null, PERIOD, false).fingerprint).toBe(counted.fingerprint);
    expect(daveWebReportSourceNotCounted(null)).toBe(false);
  });
});
