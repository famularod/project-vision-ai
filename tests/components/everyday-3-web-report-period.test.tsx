import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { buildDAVEReportSnapshot, markReportSnapshotDelivered, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { REPORT_PERIOD_WAITING_LINE } from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import { forgetDAVEWebOwnReportSends } from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Everyday item 3 (2 Oct 2026): the web Reports page had no "since the last
// report" period. It now reads the period the phone and the iPad share
// (report_snapshots, read only) and counts it with the phone's rules: from
// the last sent report (an approval not yet sent never starts a period), and
// not at all while this tab has not downloaded every task since the other
// device's send: it waits and downloads, instead of reading the other
// device's changes backwards. An approval stands only on its period.
// Synthetic data.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
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
  id,
  scheduleProjectName: 'Tower',
  projectName: 'Tower',
  locationName: 'Level 2',
  taskName,
  startDate: '09/01/2026',
  finishDate: '06/30/2027',
  milestone: '',
  owner: 'Dana',
  contractor: 'Acme',
  percentComplete,
  progressSource: 'project_manager',
  priority: 'Medium',
  status: percentComplete >= 100 ? 'Complete' : 'In Progress',
  notes: '',
  createdAt: '2026-09-01T12:00:00.000Z',
  cloudUpdatedAt: '2026-09-10T12:00:00.000Z',
});
const webSnapshot = (frame: number, tasksPulledAt: string | null): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: 'project-tower', name: 'Tower' } as DAVEWebReadOnlySnapshot['projects'][number]],
  scheduleItems: [task('frame', 'Frame walls', frame), task('pour', 'Pour slab', 40)],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: tasksPulledAt ?? '2026-10-01T08:00:00.000Z',
  tasksPulledAt,
});

/** The report the phone sent at `sentAt`, with Frame walls at `frame`%. */
const phoneSent = (frame: number, sentAt: string, format: 'project_manager' | 'executive' = 'project_manager') => {
  const approved = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths: buildDAVEWebReportTruths(webSnapshot(frame, null), null),
    scopeKey: 'tower',
    sourceFingerprint: `phone-${frame}`,
    capturedAt: '2026-09-29T15:00:00.000Z',
    reportFormat: format,
  }), null) as DAVEReportSnapshot;
  return markReportSnapshotDelivered(approved, sentAt, 'phone-install');
};

let shared: DAVEReportSnapshot | null | 'unavailable' | 'throws' = null;
const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: webSnapshot(100, '2026-10-01T12:00:00.000Z'),
  freshness: { status: 'connected', lastSuccessfulRefreshAt: null, lastAttemptAt: null, consecutiveFailures: 0 },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  loadReportPeriod: jest.fn(async (_scopeKey: string, _format: string) => {
    if (shared === 'throws') throw new Error('offline');
    if (shared === 'unavailable') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: shared };
  }),
  // Owner answer 2 Oct (web sends count): the web now writes the period too, keeps its own copy per
  // account and has its own sender id; mocks added deliberately (behaviour in owner-2oct-web-report-sends).
  saveReportPeriod: jest.fn(async () => 'saved' as const),
  reportOwnerId: jest.fn(async () => 'owner-1'),
  saveReport: jest.fn(async () => '2026-10-01T12:30:00.000Z'),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(),
  loadDocumentProof: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
});
/** This browser profile's storage, empty for each test. */
let mockProfile = new Map<string, string>();
beforeEach(() => {
  mockProfile = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => mockProfile.get(key) ?? null,
    setItem: (key: string, value: string) => { mockProfile.set(key, value); },
    removeItem: (key: string) => { mockProfile.delete(key); },
  };
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  mockAuth.refreshSnapshot.mockClear();
  mockAuth.loadReportPeriod.mockClear();
  mockAuth.saveReport.mockClear();
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z');
});

const day = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
/** The page's "Since the last report" card (the changes also feed "What changed", as on the phone). */
const since = () => within(screen.getByLabelText('Since the last report'));
const openComposer = () => fireEvent.press(screen.getByText('Review & Prepare Report'));
const reportBody = () => {
  fireEvent.press(screen.getByText('Edit Report'));
  return screen.getByLabelText('Report body').props.value as string;
};

describe('the web Reports page counts "since the last report" as the phone does (everyday item 3)', () => {
  it('from the phone\'s last sent report: the same lines on the page and in the formal report', async () => {
    shared = phoneSent(40, '2026-10-01T10:00:00.000Z');
    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(`Since the report sent ${day('2026-10-01T10:00:00.000Z')}`)).toBeTruthy();
    expect(since().getByText('+1 completed; -1 open; +0 overdue.')).toBeTruthy();
    expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy();
    expect(mockAuth.loadReportPeriod).toHaveBeenCalledWith('tower', 'project_manager');
    // Downloaded after the send: nothing to wait for.
    expect(mockAuth.refreshSnapshot).not.toHaveBeenCalled();

    openComposer();
    const body = reportBody();
    expect(body).toContain(`## Since the Last Report\nSince the report sent ${day('2026-10-01T10:00:00.000Z')}\n- +1 completed; -1 open; +0 overdue.\n- Tower: Frame walls was completed.`);
    fireEvent.press(screen.getByText('Approve Report'));
    await waitFor(() => expect(mockAuth.saveReport).toHaveBeenCalledTimes(1));
    const saved = (mockAuth.saveReport.mock.calls[0] as unknown as [{ report: { sourcePeriodKey: string; sourceFingerprint: string } }])[0].report;
    // The approval belongs to that period.
    expect(saved.sourcePeriodKey).toBe('sent:2026-10-01T10:00:00.000Z');
    expect(saved.sourceFingerprint).toContain(':period-sent:2026-10-01T10:00:00.000Z');
  });

  it('behind the phone\'s send: not counted, downloads every task once, and Approve waits', async () => {
    shared = phoneSent(40, '2026-10-01T10:00:00.000Z');
    // This tab last downloaded every task at 9:00, before the phone's 10:00 send.
    mockAuth.snapshot = webSnapshot(40, '2026-10-01T09:00:00.000Z');
    const view = render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(REPORT_PERIOD_WAITING_LINE)).toBeTruthy();
    expect(since().queryByText(/was completed\./)).toBeNull();
    await waitFor(() => expect(mockAuth.refreshSnapshot).toHaveBeenCalledTimes(1));
    openComposer();
    fireEvent.press(screen.getByText('Approve Report'));
    expect(await screen.findAllByText(/^This computer hasn't received your other device's latest changes yet/)).not.toHaveLength(0);
    expect(mockAuth.saveReport).not.toHaveBeenCalled();

    // The download (started at 10:05) brings the phone's change: counted now.
    mockAuth.snapshot = webSnapshot(100, '2026-10-01T10:05:00.000Z');
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    expect(screen.queryByText(REPORT_PERIOD_WAITING_LINE)).toBeNull();
    expect(mockAuth.refreshSnapshot).toHaveBeenCalledTimes(1);
  });

  it('an approval the phone never sent does not start the period; the report it superseded does', async () => {
    const sent = phoneSent(0, '2026-09-30T10:00:00.000Z');
    const pending = reportSnapshotToSave(buildDAVEReportSnapshot({
      truths: buildDAVEWebReportTruths(webSnapshot(40, null), null),
      scopeKey: 'tower', sourceFingerprint: 'phone-40', capturedAt: '2026-10-01T09:00:00.000Z', reportFormat: 'project_manager',
    }), sent) as DAVEReportSnapshot;
    shared = pending;
    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(`Since the report sent ${day('2026-09-30T10:00:00.000Z')}`)).toBeTruthy();
    expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy();
  });

  it('no report sent yet, no shared table, or not readable: said plainly, and the formal report has no such section', async () => {
    shared = null;
    const view = render(<DesktopReadOnlyShell page="reports" />);
    // Owner answer 2 Oct (web sends count): a send from this computer counts too, so the notes no longer name only the phone and iPad; pins updated deliberately.
    expect(await screen.findByText('No report for these projects has been recorded as sent yet.')).toBeTruthy();
    view.unmount();

    shared = 'unavailable';
    const second = render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(/^Reports aren't shared between your devices yet, and this computer has no record of one sent from here/)).toBeTruthy();
    openComposer();
    expect(reportBody()).not.toContain('Since the Last Report');
    second.unmount();

    shared = 'throws';
    render(<DesktopReadOnlyShell page="reports" />);
    expect(await screen.findByText(/^Couldn't check your last report/)).toBeTruthy();
  });

  it('each format reads its own period (owner answer Q17)', async () => {
    shared = phoneSent(40, '2026-10-01T10:00:00.000Z');
    render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    openComposer();
    shared = null;
    fireEvent.press(screen.getByLabelText('Executive Summary report'));
    await waitFor(() => expect(mockAuth.loadReportPeriod).toHaveBeenCalledWith('tower', 'executive'));
    // Owner answer 2 Oct (web sends count): a send from this computer counts too, so the notes no longer name only the phone and iPad; pins updated deliberately.
    expect(await screen.findByText('No report for these projects has been recorded as sent yet.')).toBeTruthy();
  });

  it('an approval stands only on its period: after the phone sends a later report, it is not shared', async () => {
    shared = phoneSent(40, '2026-10-01T10:00:00.000Z');
    const view = render(<DesktopReadOnlyShell page="reports" />);
    await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
    openComposer();
    fireEvent.press(screen.getByText('Approve Report'));
    await screen.findByText('Share Approved Report');

    // The phone sends at noon; this tab's next refresh reads it (and has downloaded since).
    shared = phoneSent(100, '2026-10-01T12:00:00.000Z');
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T12:05:00.000Z') };
    view.rerender(<DesktopReadOnlyShell page="reports" />);
    // Owner answer 2 Oct (web sends count): a send from this computer counts too, so the later send is \"your other device\"; pins updated deliberately.
    expect(await screen.findAllByText(/^Your other device sent a report .*, after this one was approved/)).not.toHaveLength(0);
    const share = jest.fn();
    (globalThis as { navigator?: unknown }).navigator = { share };
    await act(async () => {
      fireEvent.press(screen.getByText('Share Approved Report'));
    });
    expect(share).not.toHaveBeenCalled();
  });

  it('a report prepared before the period existed keeps its old fingerprint; one counted from a send is tied to it', () => {
    const snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z');
    const plain = buildDAVEWebReportSource(snapshot, null);
    expect(buildDAVEWebReportSource(snapshot, null, 'none').fingerprint).toBe(plain.fingerprint);
    expect(buildDAVEWebReportSource(snapshot, null, 'sent:2026-10-01T10:00:00.000Z').fingerprint)
      .toBe(`${plain.fingerprint}:period-sent:2026-10-01T10:00:00.000Z`);
  });
});
