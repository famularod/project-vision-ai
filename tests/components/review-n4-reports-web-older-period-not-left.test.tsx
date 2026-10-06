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

// Review N4 of reports (6 Oct 2026), L2, on the page (Low, caused by 46e3332
// and de5f6f5, with the sentence of 4cc5d40). With the browser's storage full
// as a report is sent and reports not shared between his devices, the page
// promised "no 'since the last report' section until one is sent from here
// again", but the browser still held the report BEFORE: in the next tab the
// page counted from that one and called it "the last report sent from this
// computer". The harness is review-n1b-web-reports' own: the web shell is
// real, the cloud is an in-memory report_snapshots table. Synthetic data.

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

const TAB_ONLY = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open.";
const NO_SINCE_UNTIL_SENT_AGAIN = `${TAB_ONLY} After that, the next report from this computer has no "since the last report" section until one is sent from here again. Clearing other sites' data in this browser makes room.`;
const MAY_COUNT_FROM_EARLIER = `${TAB_ONLY} After that, the next report from this computer may count from an earlier report and repeat what the last one covered: this browser would not clear the earlier one.`;
const NO_RECORD_HERE = "Reports aren't shared between your devices yet, and this computer has no record of one sent from here, so this report has no \"since the last report\" section.";
const COUNTS_FROM = /^Reports aren't shared between your devices yet, so this counts from the last report /;
const PERIOD_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1:tower:project_manager';

/** He approves the report on screen and shares it (copied to be pasted and sent). */
async function approveAndShare() {
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(/^Recorded as sent /);
  await settle();
}
/** Reports are not shared between his devices. Report 1 goes out with room in the browser; a week's work later the browser is full as report 2 goes out. */
async function twoReportsTheSecondWithTheBrowserFull() {
  table = 'missing';
  const view = render(<DesktopReadOnlyShell page="reports" />);
  fireEvent.press(await screen.findByText('Review & Prepare Report'));
  await approveAndShare();
  expect(profile.has(PERIOD_KEY)).toBe(true);
  // The facts move on: Pour slab is at 70%.
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T14:00:00.000Z', 70);
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
  fireEvent.press(screen.getByText('Regenerate from Current Facts'));
  await settle();
  expect(since().getByText(/Pour slab moved from 40% to 70% complete/)).toBeTruthy();
  profileFull = true;
  await approveAndShare();
  expect(copied()).toHaveBeenCalledTimes(2);
  return view;
}
/** He closes the tab and opens Reports in a new one. */
async function closeTheTabAndOpenANewOne(view: ReturnType<typeof render>) {
  view.unmount();
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(screen.queryByText('Checking your last report…')).toBeNull());
  await settle();
}

describe('review N4 L2: with the browser full as a report is sent, the page never goes back to the report before', () => {
  it('what the tab promises is what the next tab does: no "since the last report" section, and no earlier date', async () => {
    const view = await twoReportsTheSecondWithTheBrowserFull();
    expect(screen.getByText(NO_SINCE_UNTIL_SENT_AGAIN)).toBeTruthy();
    // The browser no longer holds the first report's period as if it were the last.
    expect(profile.has(PERIOD_KEY)).toBe(false);

    await closeTheTabAndOpenANewOne(view);
    expect(screen.getByText(NO_RECORD_HERE)).toBeTruthy();
    expect(screen.queryByText(COUNTS_FROM)).toBeNull();
    // Nothing is counted from the first report again: what the second report covered is not repeated.
    expect(since().queryByText(/Pour slab moved from 40% to 70% complete/)).toBeNull();
  });

  it('the browser refuses the removal too: the tab says the next report may count from an earlier one, and the next tab does not call that one the last sent', async () => {
    removalRefused = true;
    const view = await twoReportsTheSecondWithTheBrowserFull();
    expect(screen.getByText(MAY_COUNT_FROM_EARLIER)).toBeTruthy();
    expect(screen.queryByText(NO_SINCE_UNTIL_SENT_AGAIN)).toBeNull();
    expect(profile.has(PERIOD_KEY)).toBe(true);

    await closeTheTabAndOpenANewOne(view);
    expect(screen.getByText(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /)).toBeTruthy();
    expect(screen.queryByText(/the last report sent from this computer,/)).toBeNull();
  });

  it('the browser lets go while the tab is still open: the line goes back to the plain promise, and the earlier period is gone', async () => {
    removalRefused = true;
    const view = await twoReportsTheSecondWithTheBrowserFull();
    expect(screen.getByText(MAY_COUNT_FROM_EARLIER)).toBeTruthy();
    removalRefused = false;
    // The page's next refresh.
    mockAuth.snapshot = { ...mockAuth.snapshot, refreshedAt: '2026-10-01T14:05:00.000Z' };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await settle();
    expect(screen.getByText(NO_SINCE_UNTIL_SENT_AGAIN)).toBeTruthy();
    expect(profile.has(PERIOD_KEY)).toBe(false);
  });
});
