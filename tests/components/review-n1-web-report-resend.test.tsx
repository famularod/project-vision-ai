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


const copied = () => (globalThis as unknown as { navigator: { clipboard: { writeText: jest.Mock } } }).navigator.clipboard.writeText;
const ownSendTimes = () => JSON.parse(profile.get('@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1') ?? '[]') as string[];
const NO_APPROVAL = 'There is no approval of this report waiting to be recorded as sent on this computer.';
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

  it('a report with no approval on this computer, and never sent from it, still says nothing was recorded', async () => {
    table = PHONE_AT_10();
    render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    // This browser's site data is cleared, and the shared copy holds only the phone's send: no approval is left here.
    profile.clear();
    forgetDAVEWebOwnReportSends();
    table = PHONE_AT_10();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(NO_APPROVAL)).toBeTruthy();
    expect(sharedRow()?.deliveredAt).toBe('2026-10-01T10:00:00.000Z');
  });
});
