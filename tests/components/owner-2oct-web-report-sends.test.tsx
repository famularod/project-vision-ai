import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  otherDeviceSendNotReceived,
  reportBaselineSnapshot,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, type DAVEReportSnapshotCloud } from '../../services/DAVEReportSnapshotStore';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import { daveWebStoredReportValue, forgetDAVEWebOwnReportSends } from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Owner answer 2 Oct (web sends count): a report sent from the web desktop
// moves "since the last report" on the iPhone and the iPad, exactly like a
// send from the phone: the same store (DAVEReportSnapshotStore), a sender id
// of its own per browser profile, its own-send list, the shared period
// (report_snapshots, owner answer Q16) with the table's keep-the-later-send
// rule, the same refusal of a later send from another device, and Mark as
// Sent. Without the table a web send stays in this browser profile's own
// period. The web shell is real; the cloud is an in-memory report_snapshots
// table, and the phone reads it through the same store. Synthetic data.

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

/** The phone, reading the same table through the same store. */
const phoneCloud: DAVEReportSnapshotCloud = {
  read: async (scopeKey, format) => {
    if (table === 'missing') return null;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  },
  write: async () => undefined,
};
const phoneStorage = () => {
  const values = new Map<string, string>();
  return { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
};

/** This browser profile's storage. */
let profile = new Map<string, string>();
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
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => { profile.set(key, value); },
    removeItem: (key: string) => { profile.delete(key); },
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

describe('a report sent from the web counts on the iPhone and the iPad (owner answer 2 Oct)', () => {
  it('Copy on the web is a send, as on the phone: it goes into the shared period with the web\'s own sender id', async () => {
    table = new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' }]]);
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    // The approval is saved, not sent: it never moves the period's start.
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
    expect(sharedSnapshot()?.deliveredAt).toBeNull();

    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent .*\. The next report on every device runs from this one\.$/);
    const sent = sharedSnapshot() as DAVEReportSnapshot;
    expect(typeof sent.deliveredAt).toBe('string');
    expect(sharedRow()?.deliveredAt).toBe(sent.deliveredAt);
    // This browser profile's own sender id (one per profile, whoever signs in), and its own-send list per account.
    const senderId = profile.get('@vitruvius/report-sender-id/v1');
    expect(senderId).toEqual(expect.any(String));
    expect(sent.sentBy).toBe(senderId);
    expect(JSON.parse(profile.get('@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1') ?? '[]')).toEqual([sent.deliveredAt]);

    // The iPhone's next report counts from the web's send, and waits for a download made after it.
    const onPhone = await loadDAVEReportPeriod('tower', 'project_manager', phoneStorage(), phoneCloud);
    expect(onPhone.snapshot?.deliveredAt).toBe(sent.deliveredAt);
    expect(reportBaselineSnapshot(onPhone.snapshot, 'phone-later')?.deliveredAt).toBe(sent.deliveredAt);
    const behind = (pulledAt: string) => otherDeviceSendNotReceived({ period: onPhone.snapshot, currentFingerprint: 'phone-later', ownSends: new Set(), pulledAt });
    expect(behind('2026-10-01T11:00:00.000Z')).not.toBeNull();
    expect(behind(new Date(Date.parse(sent.deliveredAt as string) + 1_000).toISOString())).toBeNull();

    // This computer is never "behind" its own send: no download asked for, and the period still counted.
    expect(mockAuth.refreshSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Not counted yet/)).toBeNull();
    // Its approval still stands on the period its own send started: it can be shared again.
    expect(screen.queryByText(/after this one was approved/)).toBeNull();
  });

  it('the share menu or an email draft asks; "Not yet" records nothing, "Yes, it was sent" records it', async () => {
    const share = jest.fn(async () => undefined);
    setNavigator({ share });
    table = new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' }]]);
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(screen.getByText('Share Approved Report'));
    fireEvent.press(await screen.findByText('Not yet'));
    await settle();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    expect(screen.getByText('Nothing was recorded. Once you send it, use Mark as Sent.')).toBeTruthy();

    fireEvent.press(screen.getByText('Prepare Email'));
    fireEvent.press(await screen.findByText('Yes, it was sent'));
    await screen.findByText(/^Recorded as sent /);
    expect(typeof sharedSnapshot()?.deliveredAt).toBe('string');
  });

  it('Mark as Sent on the web: an earlier time, with the phone\'s rules, recorded with when it was marked', async () => {
    table = new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' }]]);
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    fireEvent.press(await screen.findByLabelText('Mark as Sent'));
    fireEvent.press(screen.getByLabelText('Sent earlier'));
    const [input] = screen.UNSAFE_root.findAll(node => node.type === 'input');
    // Before the approved facts: refused, nothing recorded.
    act(() => { input.props.onChange({ target: { value: '2026-09-30T09:00' } }); });
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    expect(await screen.findByText(/^Choose .* or later: this report has the project facts as they were then\.$/)).toBeTruthy();
    expect(sharedSnapshot()?.deliveredAt).toBeNull();
    // Later that day: recorded at that minute, with the time it was marked.
    act(() => { input.props.onChange({ target: { value: '2026-10-01T23:30' } }); });
    fireEvent.press(screen.getByLabelText('Record as Sent'));
    await screen.findByText(/^Recorded as sent /);
    const sent = sharedSnapshot() as DAVEReportSnapshot;
    expect(sent.deliveredAt).toBe(new Date('2026-10-01T23:30').toISOString());
    expect(Date.parse(sent.markedSentAt as string)).toBeGreaterThan(Date.parse(sent.deliveredAt as string));
  });

  it('not recorded over a later send from the phone: the next report counts from the phone\'s', async () => {
    table = new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' }]]);
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    // While the web shows its approval, the phone sends a later report.
    const later = phoneSent(100, '2026-10-01T13:00:00.000Z');
    (table as Map<string, { snapshot: unknown; deliveredAt: string | null }>).set('tower|project_manager', { snapshot: later, deliveredAt: later.deliveredAt as string });
    fireEvent.press(screen.getByText('Share Approved Report'));
    // Review N1 (3 Oct 2026, the later-send check comes first): the report is no longer copied and then "not recorded
    // as sent"; the period is read again before the copy, and a report the phone has overtaken is not copied at all.
    expect(await screen.findByText(/^Your other device sent a report .*, after this one was approved, so its "since the last report" section is out of date\. Regenerate it from current facts, then approve\.$/)).toBeTruthy();
    expect((globalThis as unknown as { navigator: { clipboard: { writeText: jest.Mock } } }).navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T13:00:00.000Z');
    expect(JSON.parse(profile.get('@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1') ?? '[]')).toEqual([]);
  });

  it('without the shared table: the web\'s send is this browser profile\'s own period only; the phone cannot see it', async () => {
    table = 'missing';
    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(/^Reports aren't shared between your devices yet, and none was sent from this computer/)).toBeTruthy();
    fireEvent.press(screen.getByText('Review & Prepare Report'));
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');
    await settle();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(/^Recorded as sent .*\. Reports aren't shared between your devices yet, so the next report counts from it on this computer only\.$/)).toBeTruthy();
    await settle();
    // The web counts from its own send now; the phone has nothing.
    expect(await screen.findByText(/^Reports aren't shared between your devices yet, so this counts from the last report sent from this computer, /)).toBeTruthy();
    expect(Array.from(profile.keys()).some(key => key.startsWith('@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1:tower'))).toBe(true);
    expect((await loadDAVEReportPeriod('tower', 'project_manager', phoneStorage(), phoneCloud)).snapshot).toBeNull();
  });

  it('another account on the same browser profile has its own periods; the profile keeps one sender id', async () => {
    table = 'missing';
    const send = async () => {
      const view = render(<DesktopReadOnlyShell page="reports" />);
      fireEvent.press(await screen.findByText('Review & Prepare Report'));
      fireEvent.press(screen.getByText('Approve Report'));
      await screen.findByText('Share Approved Report');
      await settle();
      fireEvent.press(screen.getByText('Share Approved Report'));
      await screen.findByText(/^Recorded as sent /);
      view.unmount();
    };
    await send();
    const senderId = profile.get('@vitruvius/report-sender-id/v1');
    mockAuth.reportOwnerId.mockImplementation(async () => 'owner-2');
    forgetDAVEWebOwnReportSends();
    await send();
    // Each account's own copy of its period and own sends; one sender id for this browser profile.
    const periodKey = (owner: string) => `@vitruvius/web/${owner}/@vitruvius/report-snapshots/v1:tower:project_manager`;
    expect(profile.has(periodKey('owner-1')) && profile.has(periodKey('owner-2'))).toBe(true);
    expect(profile.get('@vitruvius/report-sender-id/v1')).toBe(senderId);
    // Review N1 L1 (3 Oct 2026): the period is kept compactly in the browser's storage; read back, it is the same period.
    expect((JSON.parse(daveWebStoredReportValue(profile.get(periodKey('owner-2'))) as string) as DAVEReportSnapshot).sentBy).toBe(senderId);
  });
});
