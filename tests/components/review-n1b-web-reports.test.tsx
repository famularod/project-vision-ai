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
import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportPeriods } from '../../services/DAVEWebReportSend';
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
