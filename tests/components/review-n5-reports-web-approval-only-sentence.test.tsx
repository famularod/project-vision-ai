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

// Review N5 of reports (6 Oct 2026), finding C, on the page (Low, wording;
// the sentence is 4cc5d40's). Browser storage full, no shared record, the
// last report SENT kept in the browser, and the next report approved but not
// sent: the page said the next report "has no 'since the last report'
// section until one is sent from here again". Only the approval is in the
// tab; the next tab counts from the last report sent, as it should. The
// harness is review-n1b-web-reports' own: the web shell is real, the cloud is
// an in-memory report_snapshots table. Synthetic data.

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

const TAB_ONLY_APPROVAL = "This browser's storage for Vitruvius is full or switched off, so this computer remembers this approval only while this tab stays open.";
const APPROVAL_GOES = `${TAB_ONLY_APPROVAL} After that, the approval is gone: the report has to be approved again, and it still counts from the last report this computer knows it sent. Clearing other sites' data in this browser makes room.`;
const NO_SINCE_UNTIL_SENT_AGAIN = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open. After that, the next report from this computer has no \"since the last report\" section until one is sent from here again. Clearing other sites' data in this browser makes room.";
const COUNTS_FROM_LAST_KNOWN = /^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /;

/** Reports are not shared between his devices. Report 1 goes out with room in the browser; then the browser fills, and he approves report 2 without sending it. */
async function lastReportKeptThenTheNextApprovedWithTheBrowserFull() {
  table = 'missing';
  const view = render(<DesktopReadOnlyShell page="reports" />);
  fireEvent.press(await screen.findByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  fireEvent.press(screen.getByText('Share Approved Report'));
  await screen.findByText(/^Recorded as sent /);
  await settle();
  // The facts move on: Pour slab is at 70%.
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T14:00:00.000Z', 70);
  view.rerender(<DesktopReadOnlyShell page="reports" />);
  await settle();
  fireEvent.press(screen.getByText('Regenerate from Current Facts'));
  await settle();
  expect(since().getByText(/Pour slab moved from 40% to 70% complete/)).toBeTruthy();
  profileFull = true;
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return view;
}

describe('review N5 C: on the page, an approval held only in the tab is called that', () => {
  it('approved and not sent: the page says the approval goes with the tab, and the next tab counts from the last report sent', async () => {
    const view = await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    expect(screen.getByText(APPROVAL_GOES)).toBeTruthy();
    expect(screen.queryByText(NO_SINCE_UNTIL_SENT_AGAIN)).toBeNull();
    expect(copied()).toHaveBeenCalledTimes(1);

    // He closes the tab without sending, and opens Reports in a new one.
    view.unmount();
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(screen.queryByText('Checking your last report…')).toBeNull());
    await settle();
    // As the first tab said: it still counts from the last report sent, and there is nothing waiting to be marked sent.
    expect(screen.getByText(COUNTS_FROM_LAST_KNOWN)).toBeTruthy();
    expect(since().getByText(/Pour slab moved from 40% to 70% complete/)).toBeTruthy();
    expect(screen.queryByLabelText('Mark as Sent')).toBeNull();
  });

  it('then he shares it from this tab: the page goes to the promise that is true after a send', async () => {
    await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(/^Recorded as sent /);
    await settle();
    expect(copied()).toHaveBeenCalledTimes(2);
    expect(screen.getByText(NO_SINCE_UNTIL_SENT_AGAIN)).toBeTruthy();
    expect(screen.queryByText(APPROVAL_GOES)).toBeNull();
  });
});
