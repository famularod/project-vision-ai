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
  approveDAVEWebReportPeriod,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N1 of reports and sending (3 Oct 2026), the web Reports page
// (46e3332, 58d42da). Each finding has its own describe. The harness is
// owner-2oct-web-report-sends' own: the web shell is real, the cloud is an
// in-memory report_snapshots table. Synthetic data.

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

/** This browser profile's storage; when full, every write is refused. */
let profile = new Map<string, string>();
let profileFull = false;
type ShareNavigator = { share?: jest.Mock; clipboard?: { writeText: jest.Mock } };
const setNavigator = (value: ShareNavigator) => { (globalThis as { navigator?: unknown }).navigator = value; };
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
  profileFull = false;
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportPeriods('owner-2');
  forgetDAVEWebReportTabMemory();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (profileFull) throw new Error('QuotaExceededError');
      profile.set(key, value);
    },
    removeItem: (key: string) => { profile.delete(key); },
    // A browser's storage lists its keys.
    key: (index: number) => [...profile.keys()][index] ?? null,
    get length() { return profile.size; },
  };
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  mockAuth.refreshSnapshot.mockClear();
  mockAuth.saveReportPeriod.mockClear();
  mockAuth.reportOwnerId.mockImplementation(async () => 'owner-1');
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z');
  setNavigator({ clipboard: { writeText: jest.fn(async () => undefined) } });
});

const since = () => within(screen.getByLabelText('Since the last report'));
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
async function approveOnWeb() {
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
}
const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;



const copied = () => (globalThis as unknown as { navigator: { clipboard: { writeText: jest.Mock } } }).navigator.clipboard.writeText;
const PHONE_AT_10 = () => new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
const rows = () => table as Map<string, { snapshot: unknown; deliveredAt: string | null }>;
const QUESTION = 'Was the report sent?';
/** The facts move on: a refresh brings Pour slab at 70%. */
function refreshWithPourAt70(view: ReturnType<typeof render>) {
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T14:00:00.000Z', 70);
  view.rerender(<DesktopReadOnlyShell page="reports" />);
}

describe('review N1 M1: "Was the report sent?" is about the report that was shared, and only that one', () => {
  it('shared, then regenerated and the next report approved: the question is withdrawn, and the new report is never recorded as sent', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const r1 = sharedSnapshot() as DAVEReportSnapshot;
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    expect(share).toHaveBeenCalledTimes(1);

    // Later, on the same page: Pour slab is at 70%. A refresh alone leaves the question: the shared report is still on screen.
    refreshWithPourAt70(view);
    await settle();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    // He regenerates: the shared report is replaced, and its question goes with it.
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.getByText('A fresh draft was generated from the latest reconciled project record. Nothing was recorded for the report you shared: if it was sent, use Mark as Sent before you approve this one.')).toBeTruthy();
    // The shared report can still be recorded: its approval is the one waiting.
    expect(sharedSnapshot()?.sourceFingerprint).toBe(r1.sourceFingerprint);
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();

    fireEvent.press(screen.getByText('Approve Report'));
    // Review N1 L5: the shared report is approved and not recorded as sent; he is told before it is replaced.
    fireEvent.press(await screen.findByText('Approve Anyway'));
    await screen.findByText('Share Approved Report');
    await settle();
    // The new report, never shared: no question, and nothing recorded as sent.
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(screen.queryByText('Yes, it was sent')).toBeNull();
    const r2 = sharedSnapshot() as DAVEReportSnapshot;
    expect(r2.sourceFingerprint).not.toBe(r1.sourceFingerprint);
    expect(r2.deliveredAt).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('emailed as Project Manager, then switched to Executive and approved: no question, and neither report is recorded', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Prepare Email'));
    await screen.findByText(QUESTION);
    fireEvent.press(screen.getByLabelText('Executive Summary report'));
    await settle();
    expect(screen.queryByText(QUESTION)).toBeNull();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect((rows().get('tower|project_manager')?.snapshot as DAVEReportSnapshot).deliveredAt).toBeNull();
    expect((rows().get('tower|executive')?.snapshot as DAVEReportSnapshot | undefined)?.deliveredAt ?? null).toBeNull();
  });

  it('"Yes, it was sent" records the report that was shared: its own facts, after a refresh changed the facts on the page', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const r1 = sharedSnapshot() as DAVEReportSnapshot;
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    refreshWithPourAt70(view);
    await settle();
    fireEvent.press(screen.getByText('Yes, it was sent'));
    await screen.findByText(/^Recorded as sent /);
    const recorded = sharedSnapshot() as DAVEReportSnapshot;
    expect(recorded.sourceFingerprint).toBe(r1.sourceFingerprint);
    expect(typeof recorded.deliveredAt).toBe('string');
    // What the client was sent: Pour slab at 40%. The move to 70% is still to be reported.
    expect(recorded.tasks.find(task => task.taskName === 'Pour slab')?.percentComplete).toBe(40);
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('"Not yet" records nothing and leaves Mark as Sent for the shared report; Save Draft withdraws the question', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    fireEvent.press(await screen.findByText('Not yet'));
    await settle();
    expect(screen.getByText('Nothing was recorded. Once you send it, use Mark as Sent.')).toBeTruthy();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();

    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    fireEvent.press(screen.getByText('Save Draft'));
    await settle();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
  });
});

describe('review N1 (by reading): the later-send check comes before the report leaves the page', () => {
  const OVERTAKEN = /^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/;
  /** While the web shows its approved report, the phone sends a later one; this page has not read the period since. */
  function phoneSendsLater() {
    const later = phoneSent(100, '2026-10-01T13:00:00.000Z');
    rows().set('tower|project_manager', { snapshot: later, deliveredAt: later.deliveredAt as string });
  }
  const mailto = () => (globalThis as unknown as { window: { open: jest.Mock } }).window.open;
  const readPeriod = mockAuth.loadReportPeriod.getMockImplementation();
  afterEach(() => {
    mockAuth.loadReportPeriod.mockReset();
    mockAuth.loadReportPeriod.mockImplementation(readPeriod as never);
  });

  it('Share: a report the phone has overtaken is not copied; he is told why, and nothing is recorded', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    phoneSendsLater();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect((await screen.findAllByText(OVERTAKEN)).length).toBeGreaterThan(0);
    expect(copied()).not.toHaveBeenCalled();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T13:00:00.000Z');
    expect(screen.queryByText(/was not recorded as sent/)).toBeNull();
  });

  it('the share menu and Prepare Email: not opened, and no "Was the report sent?"', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    phoneSendsLater();
    mailto().mockClear();
    fireEvent.press(screen.getByText('Prepare Email'));
    expect((await screen.findAllByText(OVERTAKEN)).length).toBeGreaterThan(0);
    expect(mailto()).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('a first report (it counted from no report) the phone has since sent ahead of: not copied either', async () => {
    table = new Map();
    render(<DesktopReadOnlyShell page="reports" />);
    fireEvent.press(await screen.findByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    const first = phoneSent(40, '2026-10-01T13:00:00.000Z');
    rows().set('tower|project_manager', { snapshot: first, deliveredAt: first.deliveredAt as string });
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect((await screen.findAllByText(OVERTAKEN)).length).toBeGreaterThan(0);
    expect(copied()).not.toHaveBeenCalled();
  });

  it('the check is made as the pointer reaches the button, and then stands: the click copies at once, with no second read', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const reads = mockAuth.loadReportPeriod.mock.calls.length;
    fireEvent(screen.getByText('Share Approved Report'), 'hoverIn');
    await settle();
    expect(mockAuth.loadReportPeriod.mock.calls.length).toBe(reads + 1);
    // From here the cloud is slow to answer: a click that had to read the period again would not have copied yet.
    let answer: () => void = () => undefined;
    const slow = new Promise<void>(resolve => { answer = resolve; });
    mockAuth.loadReportPeriod.mockImplementationOnce(async (scopeKey: string, format: string) => {
      await slow;
      return { ownerId: 'owner-1', snapshot: rows().get(rowKey(scopeKey, format))?.snapshot ?? null };
    });
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(copied()).toHaveBeenCalledTimes(1));
    answer();
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
  });

  it('when the browser no longer takes the press as a click after the check: nothing is lost, and the next press shares', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const refused = Object.assign(new Error('Write permission denied.'), { name: 'NotAllowedError' });
    copied().mockRejectedValueOnce(refused);
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText('Checked: no other device has sent a report since this one was approved. Press Share Approved Report again.')).toBeTruthy();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(2);
  });

  it('Prepare Email where the browser says the click was used up by the wait: the draft opens on the next press', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    setNavigator({ clipboard: { writeText: jest.fn(async () => undefined) }, userActivation: { isActive: false } } as never);
    mailto().mockClear();
    fireEvent.press(screen.getByText('Prepare Email'));
    expect(await screen.findByText('Checked: no other device has sent a report since this one was approved. Press Prepare Email again.')).toBeTruthy();
    expect(mailto()).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Prepare Email'));
    await screen.findByText(QUESTION);
    expect(mailto()).toHaveBeenCalledTimes(1);
  });

  it('offline (the shared period cannot be read): the report is still shared, and recorded on this computer', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    mockAuth.loadReportPeriod.mockRejectedValue(new Error('offline'));
    fireEvent.press(screen.getByText('Share Approved Report'));
    await waitFor(() => expect(copied()).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
  });

  it('Mark as Sent still refuses a report the phone has overtaken, when it records', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    phoneSendsLater();
    fireEvent.press(await screen.findByLabelText('Mark as Sent'));
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    expect(await screen.findByText(/^Your other device sent a report .*, after this one was approved, so this one was not recorded as sent\./)).toBeTruthy();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T13:00:00.000Z');
  });
});

describe('review N1 L1: when this browser cannot keep the period, the page says so plainly and never "Try Approve again"', () => {
  const TAB_ONLY = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open.";

  it('storage full, reports shared between devices: kept for the tab, said once, and the send still reaches the other devices', async () => {
    table = PHONE_AT_10();
    profileFull = true;
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    expect(screen.getByText(`${TAB_ONLY} Reports recorded as sent still reach your other devices, and this computer reads them back from there.`)).toBeTruthy();
    expect(screen.queryByText(/Try Approve again/)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
  });

  it('storage full, reports not shared yet: says what is lost when the tab closes, and how to make room', async () => {
    table = 'missing';
    profileFull = true;
    render(<DesktopReadOnlyShell page="reports" />);
    fireEvent.press(await screen.findByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.getByText(`${TAB_ONLY} After that, the next report from this computer has no "since the last report" section until one is sent from here again. Clearing other sites' data in this browser makes room.`)).toBeTruthy();
    expect(screen.queryByText(/Try Approve again/)).toBeNull();
  });

  it('with room in the browser nothing is said; a period that cannot be saved at all says what that means, and that approving again will not help', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    expect(screen.queryByText(new RegExp(`^${TAB_ONLY.slice(0, 40)}`))).toBeNull();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    // The browser refuses this account's storage as Approve saves the period.
    mockAuth.reportOwnerId.mockRejectedValue(new Error('not signed in'));
    fireEvent.press(screen.getByText('Approve Report'));
    expect(await screen.findByText('The report is approved, but this browser could not save its reporting period, so this computer cannot record that it was sent: the next report would count from the report before this one. Approving again will not change that. Sign out of this computer and in again, or use another browser, before you send it.')).toBeTruthy();
    expect(screen.queryByText(/Try Approve again/)).toBeNull();
  });
});

describe('review N1 L2: a report approved in another browser (or before site data was cleared) and shared from this one is recorded', () => {
  /** The approved report as the page saved it, in Report history on a later visit. */
  function inReportHistory(snapshotOf: DAVEWebReadOnlySnapshot) {
    const calls = (mockAuth.saveReport as jest.Mock).mock.calls as unknown as Array<[{ id: string; projectName: string | null; report: Record<string, unknown> }]>;
    const saved = calls[calls.length - 1][0];
    expect(saved.report.status).toBe('approved');
    mockAuth.snapshot = {
      ...snapshotOf,
      referenceDocuments: [{
        id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
        category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
        projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
        webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
      }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
  }
  /** Browser 1 approves (not sent) and is closed; browser 2 is another profile, or this one after "clear site data". */
  async function approvedInAnotherBrowser(later: DAVEWebReadOnlySnapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z')) {
    const first = render(<DesktopReadOnlyShell page="reports" />);
    if (table === 'missing') {
      fireEvent.press(await screen.findByText('Review & Prepare Report'));
      fireEvent.press(screen.getByText('Approve Report'));
      await screen.findByText('Share Approved Report');
      await settle();
    } else {
      await approveOnWeb();
    }
    inReportHistory(later);
    first.unmount();
    const firstBrowser = profile.get('@vitruvius/report-sender-id/v1');
    profile.clear();
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    return firstBrowser;
  }
  const NOT_RECORDED = 'This computer could not record that this report was sent: no approval of it is waiting here, and it cannot take one now (the project facts have changed since it was prepared, or another approved report is waiting to be marked sent). The next report will count from the last report recorded as sent, and may repeat what this one covered.';

  it('with the shared record: its approval is known there, and the copy from this browser is recorded for every device', async () => {
    table = PHONE_AT_10();
    await approvedInAnotherBrowser();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    const sent = sharedSnapshot() as DAVEReportSnapshot;
    expect(typeof sent.deliveredAt).toBe('string');
    // Sent by this browser, and kept here now.
    expect(sent.sentBy).toBe(profile.get('@vitruvius/report-sender-id/v1'));
    expect([...profile.keys()].some(key => key.includes('report-snapshots/v1:tower'))).toBe(true);
    expect(screen.queryByText(/could not record that this report was sent/)).toBeNull();
  });

  it('with the shared record, when the facts have changed since: still that approved report, and still recorded', async () => {
    table = PHONE_AT_10();
    await approvedInAnotherBrowser({ ...webSnapshot(100, '2026-10-01T12:20:00.000Z', 75) });
    const approved = sharedSnapshot() as DAVEReportSnapshot;
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
    const sent = sharedSnapshot() as DAVEReportSnapshot;
    expect(sent.sourceFingerprint).toBe(approved.sourceFingerprint);
    expect(sent.tasks.find(task => task.taskName === 'Pour slab')?.percentComplete).toBe(40);
  });

  it('without the shared record: the report is the approved one on screen and its facts are current, so this computer records it', async () => {
    table = 'missing';
    await approvedInAnotherBrowser();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect([...profile.keys()].some(key => key.includes('report-snapshots/v1:tower'))).toBe(true);
  });

  it('without the shared record, when the facts have changed since: it cannot be recorded, and the page says so plainly', async () => {
    table = 'missing';
    await approvedInAnotherBrowser({ ...webSnapshot(100, '2026-10-01T12:20:00.000Z', 75) });
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NOT_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect([...profile.keys()].some(key => key.includes('report-snapshots/v1:tower'))).toBe(false);
  });
});

describe('review N1 (Low): the page\'s fixed lines are true with and without the shared report record', () => {
  /** Every line on the page that names whose reports count or where a send reaches. */
  const said = () => screen.UNSAFE_root
    .findAll(node => typeof node.props?.children === 'string' && /every device|phone or iPad|this computer|any of your devices/i.test(node.props.children))
    .map(node => node.props.children as string);

  it('before the shared record exists: nothing says "every device" or "phone or iPad"; each line says this computer', async () => {
    table = 'missing';
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    render(<DesktopReadOnlyShell page="reports" />);
    await screen.findByText(/^Reports aren't shared between your devices yet, and none was sent from this computer/);
    expect(screen.getByText('Counted from the last report sent from this computer.')).toBeTruthy();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.getByText(/^This approved report \(project facts as of .*\) isn't recorded as sent\. If you sent it from an email draft, the share menu or as the Word file, mark it sent so the next report on this computer runs from it\.$/)).toBeTruthy();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    expect(screen.getByText('If you sent it, the next report on this computer runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.')).toBeTruthy();
    expect(said().filter(line => /every device|phone or iPad|any of your devices/i.test(line))).toEqual([]);
    fireEvent.press(screen.getByText('Yes, it was sent'));
    expect(await screen.findByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/)).toBeTruthy();
    expect(said().filter(line => /every device|phone or iPad|any of your devices/i.test(line))).toEqual([]);
  });

  it('with the shared record: any of his devices, and every device', async () => {
    table = new Map();
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText('Counted from the last report sent from any of your devices.')).toBeTruthy();
    expect(screen.queryByText(/phone or iPad/)).toBeNull();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.getByText(/mark it sent so the next report on every device runs from it\.$/)).toBeTruthy();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    expect(screen.getByText('If you sent it, the next report on every device runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.')).toBeTruthy();
  });
});

describe('review N1 L5 (web): before an approval replaces an approved report that is not recorded as sent, he is told', () => {
  const TITLE = 'An approved report is not recorded as sent';
  const WARNING = /^The report you approved with the project facts as of .* isn't recorded as sent\. If you sent it, go back and use Mark as Sent first\. Once you approve this report, that one can no longer be recorded as sent, and the next report will repeat what it covered\.$/;

  it('Go Back keeps the earlier approval: it is marked sent, and then the next report is approved with no warning', async () => {
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const r1 = sharedSnapshot() as DAVEReportSnapshot;
    // The next day's facts; he regenerates and presses Approve before recording that the first report went out.
    refreshWithPourAt70(view);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText(WARNING)).toBeTruthy();
    // Nothing is approved or replaced yet.
    expect(sharedSnapshot()?.sourceFingerprint).toBe(r1.sourceFingerprint);
    expect(screen.queryByText('Share Approved Report')).toBeNull();

    fireEvent.press(screen.getByText('Go Back'));
    expect(screen.queryByText(TITLE)).toBeNull();
    fireEvent.press(screen.getByLabelText('Mark as Sent'));
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    expect(await screen.findByText(/^Recorded as sent /)).toBeTruthy();
    await settle();
    const sent = sharedSnapshot() as DAVEReportSnapshot;
    expect(sent.sourceFingerprint).toBe(r1.sourceFingerprint);
    expect(typeof sent.deliveredAt).toBe('string');

    // The first report is recorded: the next one is approved with no warning, and counts from it.
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    expect(screen.queryByText(TITLE)).toBeNull();
    await settle();
    expect((sharedSnapshot() as DAVEReportSnapshot).supersedes?.sourceFingerprint).toBe(r1.sourceFingerprint);
  });

  it('Approve Anyway approves the next report, as before; approving the same report again never warns', async () => {
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const r1 = sharedSnapshot() as DAVEReportSnapshot;
    // The same report approved again: nothing would be lost, so nothing is asked.
    fireEvent.press(screen.getByText('Approve Report'));
    await settle();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(sharedSnapshot()?.sourceFingerprint).toBe(r1.sourceFingerprint);

    refreshWithPourAt70(view);
    await settle();
    fireEvent.press(screen.getByText('Regenerate from Current Facts'));
    await settle();
    fireEvent.press(screen.getByText('Approve Report'));
    fireEvent.press(await screen.findByText('Approve Anyway'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(sharedSnapshot()?.sourceFingerprint).not.toBe(r1.sourceFingerprint);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe('review N1 (Low): a report another tab of this browser sent is not called "your other device"', () => {
  const store = () => ({
    storage: daveWebReportStorage(async () => 'owner-1'),
    cloud: daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
  });
  /** Another tab of the same browser (the same storage and sender id) approves the report on its page and sends it. */
  async function otherTabSends() {
    const truths = buildDAVEWebReportTruths(mockAuth.snapshot, null);
    const facts = buildDAVEReportSourceFingerprint(truths);
    const current = buildDAVEReportSnapshot({ truths, scopeKey: 'tower', sourceFingerprint: facts, capturedAt: '2026-10-01T12:00:00.000Z', reportFormat: 'project_manager' });
    expect((await approveDAVEWebReportPeriod(store(), current, '2026-10-01T10:00:00.000Z')).status).toBe('saved');
    const sentAt = new Date().toISOString();
    expect((await recordDAVEWebReportSend(store(), { scopeKey: 'tower', reportFormat: 'project_manager' }, facts, sentAt))?.status).toBe('saved');
    // This tab's own memory knows nothing of it until it reads the period again.
    forgetDAVEWebOwnReportSends();
    return current;
  }

  it('Approve in a tab that has not read the period since is still stopped, and says another tab sent the report', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    await otherTabSends();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    // Its report still counts from the older one, so it is not approved; but it was this browser that sent.
    expect(await screen.findByText(/^Another tab of this browser sent a report .*, so this report now covers what changed since then\. Regenerate it from current facts, then approve\.$/)).toBeTruthy();
    expect(screen.queryByText(/Your other device/)).toBeNull();
    expect(screen.queryByText('Share Approved Report')).toBeNull();
  });

  it('the store says whose the later report is: this browser\'s, or another device\'s', async () => {
    table = PHONE_AT_10();
    const sent = await otherTabSends();
    const newer = { ...sent, sourceFingerprint: 'newer-facts', capturedAt: '2026-10-01T12:10:00.000Z' };
    await expect(approveDAVEWebReportPeriod(store(), newer, '2026-10-01T10:00:00.000Z')).resolves.toMatchObject({ status: 'later_send', fromThisBrowser: true });
    // The phone's later report is another device's.
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebOwnReportSends();
    const phone = phoneSent(100, '2026-10-01T13:00:00.000Z');
    table = new Map([['tower|project_manager', { snapshot: phone, deliveredAt: '2026-10-01T13:00:00.000Z' }]]);
    const outcome = await approveDAVEWebReportPeriod(store(), newer, '2026-10-01T10:00:00.000Z');
    expect(outcome.status).toBe('later_send');
    expect((outcome as { fromThisBrowser?: boolean }).fromThisBrowser).toBeUndefined();
  });
});
