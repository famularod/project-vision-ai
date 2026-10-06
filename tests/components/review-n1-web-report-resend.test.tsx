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
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review N1 of the web Reports page's own sends (owner answer 2 Oct, web
// sends count; 46e3332 and 58d42da). Each finding has its own describe.
// The harness is owner-2oct-web-report-sends' own: the web shell is real,
// the cloud is an in-memory report_snapshots table. Synthetic data.

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
const webSnapshot = (frame: number, pulledAt: string): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: 'project-tower', name: 'Tower' } as DAVEWebReadOnlySnapshot['projects'][number]],
  scheduleItems: [task('frame', 'Frame walls', frame), task('pour', 'Pour slab', 40)],
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
const ownSendTimes = () => JSON.parse(profile.get('@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1') ?? '[]') as string[];
// Review N1 L2 (3 Oct 2026): what the page says when a send cannot be recorded (was "There is no approval of this
// report waiting to be recorded as sent on this computer."); pin updated deliberately.
const NO_APPROVAL = 'This computer could not record that this report was sent: no approval of it is waiting here, and it cannot take one now (the project facts have changed since it was prepared, or another approved report is waiting to be marked sent). The next report will count from the last report recorded as sent, and may repeat what this one covered.';
const ALREADY_RECORDED = /^Shared again\. This report was already recorded as sent .*, so this is not counted as another send\.$/;
const PHONE_AT_10 = () => new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);

describe('review N1 (Low): a second Share of a report this computer already sent is not an error and not a second send', () => {
  it('in the same visit: copied again, said plainly, the first send unchanged', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/);
    await settle();
    const firstSend = sharedSnapshot()?.deliveredAt;
    expect(ownSendTimes()).toEqual([firstSend]);
    mockAuth.saveReportPeriod.mockClear();
    copied().mockClear();

    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(ALREADY_RECORDED)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NO_APPROVAL)).toBeNull();
    // Not a second send: the shared period, this computer's copy and its own-send list are as the first left them.
    expect(sharedSnapshot()?.deliveredAt).toBe(firstSend);
    expect(sharedRow()?.deliveredAt).toBe(firstSend);
    expect(ownSendTimes()).toEqual([firstSend]);
    expect(mockAuth.saveReportPeriod.mock.calls.every(([row]) => row.deliveredAt === firstSend)).toBe(true);
  });

  it('the store answers "already sent" with when, from this computer\'s own copy; with no approval and no send of these facts, null as before', async () => {
    const store = {
      storage: daveWebReportStorage(async () => 'owner-1'),
      cloud: daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
    };
    const period = { scopeKey: 'tower', reportFormat: 'project_manager' } as const;
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const facts = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(mockAuth.snapshot, null));
    // Never approved here with these facts: nothing to record, and nothing was sent.
    await expect(recordDAVEWebReportSend(store, period, 'other-facts', '2026-10-01T12:40:00.000Z')).resolves.toBeNull();
    await expect(recordDAVEWebReportSend(store, period, facts, '2026-10-01T12:45:00.000Z')).resolves.toMatchObject({ status: 'saved' });
    // The same report again, a moment later (before the page has read the period again): already sent, at the first time.
    await expect(recordDAVEWebReportSend(store, period, facts, '2026-10-01T12:46:00.000Z'))
      .resolves.toEqual({ status: 'already_sent', sentAt: '2026-10-01T12:45:00.000Z' });
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T12:45:00.000Z');
    expect(ownSendTimes()).toEqual(['2026-10-01T12:45:00.000Z']);
    // Another report's facts are still not this one's send.
    await expect(recordDAVEWebReportSend(store, period, 'other-facts', '2026-10-01T12:47:00.000Z')).resolves.toBeNull();
  });

  it('a report with no approval on this computer whose facts have changed since, never sent from it, still says nothing was recorded', async () => {
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    // This browser's site data is cleared, and the shared copy holds only the phone's send: no approval is left here.
    profile.clear();
    forgetDAVEWebOwnReportSends();
    table = PHONE_AT_10();
    // Review N1 L2 (3 Oct 2026): with the facts unchanged this computer now takes the approval as its own and records
    // the send (review-n1b-web-reports). The facts have moved on here, so it cannot, and says so.
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T12:20:00.000Z'), scheduleItems: [task('frame', 'Frame walls', 100), task('pour', 'Pour slab', 75)] };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NO_APPROVAL)).toBeTruthy();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('review N1 M2: an approved report this computer sent can be shared again when it is reopened from Report history', () => {
  /** The approved report as the page saved it, back in Report history on a later visit. */
  function reopenedLater() {
    const calls = (mockAuth.saveReport as jest.Mock).mock.calls as unknown as Array<[{ id: string; projectName: string | null; report: Record<string, unknown> }]>;
    const saved = calls[calls.length - 1][0];
    expect(saved.report.status).toBe('approved');
    mockAuth.snapshot = {
      ...webSnapshot(100, '2026-10-01T12:00:00.000Z'),
      referenceDocuments: [{
        id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
        category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
        projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
        webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
      }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
    return saved;
  }
  /** Approve and Share (a send from this computer), then leave the page. */
  async function approveAndSendThenLeave() {
    const visit = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/);
    await settle();
    const sentAt = sharedSnapshot()?.deliveredAt as string;
    const saved = reopenedLater();
    visit.unmount();
    // A new visit: this tab knows no sends of its own until it reads them back.
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    return { sentAt, saved };
  }
  async function openFromHistory() {
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
  }
  const OTHER_DEVICE = /Your other device sent a report/;

  it('Share copies it, says it was already sent, and records no new send; nothing calls this computer\'s send another device\'s', async () => {
    table = PHONE_AT_10();
    const { sentAt, saved } = await approveAndSendThenLeave();
    // The saved report still names the period it was prepared on; this computer's send started the next one.
    expect(saved.report.sourcePeriodKey).toBe('sent:2026-10-01T10:00:00.000Z');
    await openFromHistory();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(screen.getByText(/^This report was sent from this computer .*\. Sharing it again is not counted as another send\.$/)).toBeTruthy();
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.queryByText(/^Project facts changed after this draft was prepared/)).toBeNull();

    mockAuth.saveReportPeriod.mockClear();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(ALREADY_RECORDED)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(String(copied().mock.calls[0][0])).toContain(String(saved.report.title));
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(screen.queryByText(NO_APPROVAL)).toBeNull();
    // Not a new send.
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
    expect(ownSendTimes()).toEqual([sentAt]);
    expect(mockAuth.saveReportPeriod.mock.calls.every(([row]) => row.deliveredAt === sentAt)).toBe(true);
  });

  it('Prepare Email opens the draft and asks nothing; the share menu hands it over and asks nothing', async () => {
    table = PHONE_AT_10();
    const { sentAt } = await approveAndSendThenLeave();
    await openFromHistory();
    const open = (globalThis as unknown as { window: { open: jest.Mock } }).window.open;
    open.mockClear();
    fireEvent.press(screen.getByText('Prepare Email'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/^mailto:\?subject=/);
    expect(await screen.findByText(/^An email draft was opened\. Review the recipients and content before sending\. This report was already recorded as sent .*, so sending it again is not counted as another send\.$/)).toBeTruthy();
    expect(screen.queryByLabelText('Was the report sent?')).toBeNull();

    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^The approved report was handed to the system share menu\. This report was already recorded as sent /)).toBeTruthy();
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Was the report sent?')).toBeNull();
    await settle();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('after Sign Out of This Computer removed this account\'s copy: its send is still its own, by this browser\'s sender id in the shared period', async () => {
    table = PHONE_AT_10();
    const { sentAt } = await approveAndSendThenLeave();
    for (const key of [...profile.keys()]) if (key.startsWith('@vitruvius/web/owner-1/')) profile.delete(key);
    await openFromHistory();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(ALREADY_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    await settle();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
  });

  it('after the phone sends a later report, the report this computer sent can still be shared again', async () => {
    table = PHONE_AT_10();
    const { sentAt } = await approveAndSendThenLeave();
    // The phone approves the next report (it remembers the web's as the one before) and sends it.
    const webSent = sharedSnapshot() as DAVEReportSnapshot;
    const after = (minutes: number) => new Date(Date.parse(sentAt) + minutes * 60_000).toISOString();
    const phoneNext = markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
      truths: buildDAVEWebReportTruths(webSnapshot(100, after(30)), null),
      scopeKey: 'tower', sourceFingerprint: 'phone-next', capturedAt: after(30), reportFormat: 'project_manager',
    }), webSent) as DAVEReportSnapshot, after(60), 'phone-install');
    table = new Map([['tower|project_manager', { snapshot: JSON.parse(JSON.stringify(phoneNext)), deliveredAt: after(60) }]]);
    // This computer has downloaded every task since the phone's send.
    mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: after(90), tasksPulledAt: after(90) };
    await openFromHistory();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(ALREADY_RECORDED)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    await settle();
    // The period still runs from the phone's later send; the web's own earlier send was not recorded again.
    expect(sharedRow()?.deliveredAt).toBe(after(60));
    expect(ownSendTimes()).toEqual([sentAt]);
  });

  it('this computer\'s own later send of another report is never read as another device\'s: an earlier approval is not stopped by it', async () => {
    table = PHONE_AT_10();
    // An approval never sent, left in Report history.
    const first = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    const calls = (mockAuth.saveReport as jest.Mock).mock.calls as unknown as Array<[{ id: string; projectName: string | null; report: Record<string, unknown> }]>;
    const earlier = calls[calls.length - 1][0];
    first.unmount();
    // The facts change; the next report is approved and sent from this computer.
    const changed = { ...webSnapshot(100, '2026-10-01T12:10:00.000Z'), scheduleItems: [task('frame', 'Frame walls', 100), task('pour', 'Pour slab', 75)] };
    mockAuth.snapshot = changed;
    const second = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    // Review N1 L5 (3 Oct 2026): the earlier approval is not recorded as sent, so Approve asks first. Deliberate.
    fireEvent.press(await screen.findByText('Approve Anyway'));
    await screen.findByText('Share Approved Report');
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    const sentAt = sharedSnapshot()?.deliveredAt;
    second.unmount();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    mockAuth.snapshot = {
      ...changed,
      referenceDocuments: [{
        id: earlier.id, name: String(earlier.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
        category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(earlier.report.generatedAt),
        projectId: null, projectName: earlier.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
        webReport: earlier.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
      }] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
    };
    await openFromHistory();
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    // Copied; it is not the report that was sent, and no approval of it is waiting, so nothing is recorded, and the page says so.
    expect(await screen.findByText(NO_APPROVAL)).toBeTruthy();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(OTHER_DEVICE)).toBeNull();
    expect(sharedRow()?.deliveredAt).toBe(sentAt);
    expect(ownSendTimes()).toEqual([sentAt]);
  });

  it('an approval this computer never sent is still stopped by another device\'s later send', async () => {
    table = PHONE_AT_10();
    const visit = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    reopenedLater();
    visit.unmount();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    const later = phoneSent(100, '2026-10-01T13:00:00.000Z');
    table = new Map([['tower|project_manager', { snapshot: later, deliveredAt: '2026-10-01T13:00:00.000Z' }]]);
    mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: '2026-10-01T14:00:00.000Z', tasksPulledAt: '2026-10-01T14:00:00.000Z' };
    await openFromHistory();
    copied().mockClear();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await settle();
    expect(screen.getAllByText(/^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/).length).toBeGreaterThan(0);
    expect(copied()).not.toHaveBeenCalled();
  });
});

describe('review N1 (Low): after Sign Out of This Computer removed the account\'s report periods, the next sign-in rebuilds them', () => {
  /** Sign Out of This Computer, as the gateway does it for the signed-in account; then a new visit after signing in again. */
  function signOutThenSignInAgain() {
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebReportPeriodSession();
    expect([...profile.keys()].filter(key => key.startsWith('@vitruvius/web/owner-1/'))).toEqual([]);
    expect([...profile.values()].join('\n')).not.toMatch(/Frame walls|Tower|Dana/);
  }
  const NONE_SENT_HERE = /^Reports aren't shared between your devices yet, and this computer has no record of one sent from here/;

  it('with the shared table: the period is read back from it, and this computer\'s earlier send is still its own', async () => {
    table = PHONE_AT_10();
    const visit = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    const sentAt = sharedSnapshot()?.deliveredAt as string;
    visit.unmount();
    signOutThenSignInAgain();

    mockAuth.refreshSnapshot.mockClear();
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    // The report this computer sent reads as it did before the sign-out, and it never waits for a download of its own send.
    expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy();
    expect(screen.queryByText(/^Not counted yet/)).toBeNull();
    expect(screen.queryByText(NONE_SENT_HERE)).toBeNull();
    expect(mockAuth.refreshSnapshot).not.toHaveBeenCalled();
    // Known as its own by this browser's sender id, and on the account's own-send list again.
    expect(ownSendTimes()).toEqual([sentAt]);
  });

  it('with the shared table: an approval that was waiting is approved again here, and then its send is recorded', async () => {
    table = PHONE_AT_10();
    const visit = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    visit.unmount();
    signOutThenSignInAgain();

    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    // This computer keeps the approval again: Mark as Sent is offered, and Share records the send.
    expect(await screen.findByLabelText('Mark as Sent')).toBeTruthy();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/)).toBeTruthy();
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
  });

  it('without the shared table: the account\'s period on this computer is gone, and the page says none was sent from here', async () => {
    table = 'missing';
    const visit = render(<DesktopReadOnlyShell page="reports" />);
    fireEvent.press(await screen.findByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    expect(await screen.findByText(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /)).toBeTruthy();
    visit.unmount();
    signOutThenSignInAgain();

    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(NONE_SENT_HERE)).toBeTruthy();
  });
});

describe('review N1 (Low): with the profile\'s storage full, the period this tab kept instead is read back', () => {
  // Review N1 L1 (3 Oct 2026): the message no longer says "Try Approve again" (it never helped); pin updated deliberately.
  const NOT_SAVED = /could not save its reporting period/;

  it('Approve saves the period for this tab, and Share records the send, here and in the shared period', async () => {
    table = PHONE_AT_10();
    profileFull = true;
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    expect(screen.queryByText(NOT_SAVED)).toBeNull();
    expect(profile.size).toBe(0);
    expect(await screen.findByLabelText('Mark as Sent')).toBeTruthy();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/)).toBeTruthy();
    await settle();
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
    expect(sharedSnapshot()?.sentBy).toEqual(expect.any(String));
    // Still this computer's own send: no wait for a download, and a second Share is not a second send.
    expect(screen.queryByText(/^Not counted yet/)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(ALREADY_RECORDED)).toBeTruthy();
  });

  it('without the shared table too: the send is this tab\'s own period for as long as the tab lasts', async () => {
    table = 'missing';
    profileFull = true;
    render(<DesktopReadOnlyShell page="reports" />);
    fireEvent.press(await screen.findByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText(NOT_SAVED)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/)).toBeTruthy();
    await settle();
    expect(await screen.findByText(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /)).toBeTruthy();
    expect(profile.size).toBe(0);
  });
});
