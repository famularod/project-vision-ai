import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// R1 item 1 (8 Oct 2026, the owner's open items). On the web, "Recorded as
// sent ... The next report on every device runs from this one." stayed on
// screen after another device later sent a newer report, when the next report
// no longer runs from this one. Once the period on the page runs from a later
// send the line says so. The harness is review-n1b-web-reports' own: the web
// shell is real, the cloud is an in-memory report_snapshots table. Synthetic
// data. Every change the mounted page hears is made inside act.

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
/** A storage that fails altogether refuses removals too. */
let removalRefused = false;
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
  removalRefused = false;
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportPeriods('owner-2');
  forgetDAVEWebReportTabMemory();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (profileFull) throw new Error('QuotaExceededError');
      profile.set(key, value);
    },
    removeItem: (key: string) => {
      if (removalRefused) throw new Error('The storage failed.');
      profile.delete(key);
    },
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

const RECORDED_EVERYWHERE = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const OVERTAKEN_BY_OTHER_DEVICE = /^Recorded as sent .*\. Your other device sent a later report .*, so the next report counts from that one\.$/;
const OVERTAKEN_BY_ANOTHER_TAB = /^Recorded as sent .*\. Another tab of this browser sent a later report .*, so the next report counts from that one\.$/;
/** He approves the report and shares it; the shared record takes the send. */
async function sentFromTheWeb() {
  table = PHONE_AT_10();
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await approveOnWeb();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(RECORDED_EVERYWHERE);
  await settle();
  return { view, sentAt: sharedRow()?.deliveredAt as string };
}
/** The page's next refresh, with every task downloaded at `pulledAt`. */
async function refresh(view: ReturnType<typeof render>, pulledAt: string) {
  mockAuth.snapshot = webSnapshot(100, pulledAt);
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
}

describe('R1 item 1: "on every device runs from this one" goes once a later report stands', () => {
  it('the phone sends a newer report: the line says so, and no longer that the next report runs from this one', async () => {
    const { view, sentAt } = await sentFromTheWeb();
    // The phone sends a later report; this computer has downloaded the phone's changes since.
    const later = new Date(Date.parse(sentAt) + 60_000).toISOString();
    await act(async () => { rows().set('tower|project_manager', { snapshot: phoneSent(100, later), deliveredAt: later }); });
    await refresh(view, new Date(Date.parse(later) + 60_000).toISOString());
    expect(await screen.findByText(OVERTAKEN_BY_OTHER_DEVICE)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
  });

  it('the same while this computer still waits for the phone\'s changes', async () => {
    const { view, sentAt } = await sentFromTheWeb();
    const later = new Date(Date.parse(sentAt) + 60_000).toISOString();
    await act(async () => { rows().set('tower|project_manager', { snapshot: phoneSent(100, later), deliveredAt: later }); });
    // Not downloaded since the phone's send.
    await refresh(view, '2026-10-01T12:05:00.000Z');
    expect(await screen.findByText(OVERTAKEN_BY_OTHER_DEVICE)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
  });

  it('a line first written "on this computer" and corrected when the send arrived still knows its send', async () => {
    const down = async () => { throw new Error('The shared report period could not be reached.'); };
    const load = mockAuth.loadReportPeriod.getMockImplementation();
    const save = mockAuth.saveReportPeriod.getMockImplementation();
    table = PHONE_AT_10();
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await approveOnWeb();
    try {
      // The shared record goes out of reach as he shares: recorded on this computer for now.
      mockAuth.loadReportPeriod.mockImplementation(down);
      mockAuth.saveReportPeriod.mockImplementation(down);
      fireEvent.press(screen.getByText('Share Approved Report'));
      await screen.findByText(/^Recorded as sent .* on this computer\. /);
      await settle();
    } finally {
      mockAuth.loadReportPeriod.mockImplementation(load);
      mockAuth.saveReportPeriod.mockImplementation(save);
    }
    // It is in reach again: the send arrives and the line is corrected.
    await refresh(view, '2026-10-01T12:05:00.000Z');
    await screen.findByText(RECORDED_EVERYWHERE);
    const sentAt = sharedRow()?.deliveredAt as string;
    // Then the phone sends a later report.
    const later = new Date(Date.parse(sentAt) + 60_000).toISOString();
    await act(async () => { rows().set('tower|project_manager', { snapshot: phoneSent(100, later), deliveredAt: later }); });
    await refresh(view, new Date(Date.parse(later) + 60_000).toISOString());
    expect(await screen.findByText(OVERTAKEN_BY_OTHER_DEVICE)).toBeTruthy();
    expect(screen.queryByText(RECORDED_EVERYWHERE)).toBeNull();
  });

  it('another tab of this browser sends the newer report: called that, never "your other device"', async () => {
    const { view, sentAt } = await sentFromTheWeb();
    // The other tab's page (its own memory, the same browser storage and sender id) approves and copies a later report.
    let otherTab: typeof import('../../services/DAVEWebReportSend') | undefined;
    jest.isolateModules(() => { otherTab = require('../../services/DAVEWebReportSend'); });
    const other = otherTab as typeof import('../../services/DAVEWebReportSend');
    const later = new Date(Date.parse(sentAt) + 60_000).toISOString();
    const facts = webSnapshot(100, '2026-10-01T12:30:00.000Z', 70);
    await act(async () => {
      const store = {
        storage: other.daveWebReportStorage(async () => 'owner-1'),
        cloud: other.daveWebReportSnapshotCloud(mockAuth.loadReportPeriod, mockAuth.saveReportPeriod as never),
      };
      const truths = buildDAVEWebReportTruths(facts, null);
      const fingerprint = buildDAVEReportSourceFingerprint(truths);
      const period = (await other.loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot;
      const current = buildDAVEReportSnapshot({ truths, scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt: facts.refreshedAt, reportFormat: 'project_manager' });
      expect((await other.approveDAVEWebReportPeriod(store, current, reportPeriodSentAt(period))).status).toBe('saved');
      expect((await other.recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, fingerprint, later))?.status).toBe('saved');
    });
    await refresh(view, '2026-10-01T12:35:00.000Z');
    expect(await screen.findByText(OVERTAKEN_BY_ANOTHER_TAB)).toBeTruthy();
    expect(screen.queryByText(OVERTAKEN_BY_OTHER_DEVICE)).toBeNull();
  });

  it('guard: with no later report the line stays through a refresh', async () => {
    const { view } = await sentFromTheWeb();
    await refresh(view, '2026-10-01T12:05:00.000Z');
    expect(screen.getByText(RECORDED_EVERYWHERE)).toBeTruthy();
    expect(screen.queryByText(OVERTAKEN_BY_OTHER_DEVICE)).toBeNull();
    expect(screen.queryByText(OVERTAKEN_BY_ANOTHER_TAB)).toBeNull();
  });
});
