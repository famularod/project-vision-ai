// Whole-app audit A6 pass 7 (30 Sep 2026), on owner answer Q16 (the phone and
// the iPad share "since the last report" through report_snapshots).
//
// 1. The shared period was read only when Reports opened. A phone left on
//    Reports since morning kept counting from its own morning send after the
//    iPad sent at midday: it reported "+2 completed; Frame walls… Pour slab…",
//    and its later send replaced the iPad's period with its own older one. An
//    approval made before the iPad's send was also sent later as it stood.
//    The period is now read again when the app comes back to the front, just
//    before Approve, and just before a send.
// 2. Nothing said when the other device's last report could not be checked
//    (offline, sign-in expired, no answer in four seconds). One quiet line now
//    says so, and says what the report counts from; not before the table
//    exists, when there is nothing to check.

/** Each simulated device has its own local store; one shared fake cloud stands in for report_snapshots. */
const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockLocal().set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockLocal().delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
}));

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
const mockCloud = new Map<string, MockCloudRow>();
let mockCloudState: 'ok' | 'offline' | 'expired' | 'hanging' | 'missing_table' | 'not_configured' = 'ok';
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
const mockMissingTable = { ok: true, configured: true, data: null, stubbed: true, message: 'not available yet' };
const mockNotConfigured = { ok: false, configured: false, data: null, error: 'Supabase is not configured.' };
const mockExpired = { ok: false, configured: true, data: null, error: 'The sign-in session expired.', status: 401, code: 'session_expired' };
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
    if (mockCloudState === 'hanging') return new Promise(() => undefined);
    if (mockCloudState === 'expired') return mockExpired;
    if (mockCloudState === 'missing_table') return mockMissingTable;
    if (mockCloudState === 'not_configured') return mockNotConfigured;
    return mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null });
  }),
  // The table's rule: a row whose period started from a later send is kept.
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
    if (mockCloudState === 'hanging') return new Promise(() => undefined);
    if (mockCloudState === 'expired') return mockExpired;
    if (mockCloudState === 'missing_table') return mockMissingTable;
    if (mockCloudState === 'not_configured') return mockNotConfigured;
    const key = `${row.scopeKey}|${row.format}`;
    const existing = mockCloud.get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return mockOk(null);
    mockCloud.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return mockOk(null);
  }),
}));

let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { AppState } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import {
  buildDAVEReportSnapshot,
  describeReportSendTime,
  laterSentReportPeriod,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  loadDAVEReportPeriod,
  type DAVEReportSnapshotCloud,
} from '../../services/DAVEReportSnapshotRepository';
import {
  forgetAllReportSessionState,
  ownReportSendTimes,
  recallReportSessionState,
  rememberOwnReportSend,
  rememberReportAcknowledgement,
  rememberReportApproval,
  rememberReportEdits,
} from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const onDevice = (device: string) => {
  mockDevice = device;
};
const local = (device: string) => {
  const raw = mockDevices.get(device)?.get(KEY);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;

/** The Reports screen's own AppState listeners, so a test can bring the app back to the front. */
const appStateListeners = new Set<(state: string) => void>();

// Added on purpose by A6 pass 10 M1/M2: a device whose report counts from
// the other device's send now waits until it has downloaded every task since
// that send, and asks the app to do it. These flows give each device's
// synced tasks as props, so the app here downloads at once when asked.
let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => {
    void recordScheduleCloudPull(new Date().toISOString());
  });
});
afterEach(() => stopAppDownloads());

beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockCloudState = 'ok';
  onDevice('phone');
  forgetAllReportSessionState();
  appStateListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  }) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the pieces: which period is later, and how a send time is said', () => {
  const truth = (completed: number) => ({
    projectName: 'Tower',
    schedule: ['a', 'b'].map((id, index) => ({
      taskId: id, taskName: `Task ${id}`, areaName: 'L2', owner: '',
      status: index < completed ? 'Complete' : 'In Progress', percentComplete: index < completed ? 100 : 40,
      finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
    })),
  }) as never;
  const snap = (fingerprint: string, completed: number, capturedAt: string) =>
    buildDAVEReportSnapshot({ truths: [truth(completed)], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt, reportFormat: 'project_manager' });
  const morning = markReportSnapshotDelivered(reportSnapshotToSave(snap('f0', 0, '2026-09-30T08:00:00.000Z'), null) as DAVEReportSnapshot, '2026-09-30T08:30:00.000Z');

  it('a later send is later; a tie, an approval never sent, and this device\'s own send of the shown approval are not', () => {
    const midday = markReportSnapshotDelivered(reportSnapshotToSave(snap('f1', 1, '2026-09-30T11:00:00.000Z'), morning) as DAVEReportSnapshot, '2026-09-30T12:05:00.000Z');
    expect(laterSentReportPeriod(midday, morning)).toBe(midday);
    expect(laterSentReportPeriod(morning, midday)).toBeNull();
    expect(laterSentReportPeriod(midday, null)).toBe(midday);
    expect(laterSentReportPeriod(null, morning)).toBeNull();
    // An approval not yet sent carries its superseded send: a tie with the morning.
    const pending = reportSnapshotToSave(snap('f2', 2, '2026-09-30T13:00:00.000Z'), morning) as DAVEReportSnapshot;
    expect(laterSentReportPeriod(pending, morning)).toBeNull();
    // A first approval never sent has no send at all.
    expect(laterSentReportPeriod(reportSnapshotToSave(snap('f3', 2, '2026-09-30T13:00:00.000Z'), null), null)).toBeNull();
    // This device's own send of the approval it shows, read back before the screen shows it, is not the other device's.
    const ownSend = markReportSnapshotDelivered(pending, '2026-09-30T17:00:00.000Z');
    expect(laterSentReportPeriod(ownSend, pending, new Set(['2026-09-30T17:00:00.000Z']))).toBeNull();
    // The same snapshot sent by the other device (it read this approval as its period) is.
    expect(laterSentReportPeriod(ownSend, pending, new Set(['2026-09-30T08:30:00.000Z']))).toBe(ownSend);
  });

  it('today at a time; another day with its date; another year with the year', () => {
    const now = new Date(2026, 8, 30, 17, 0);
    expect(describeReportSendTime(new Date(2026, 8, 30, 12, 5).toISOString(), now)).toMatch(/^at 12:05\sPM$/);
    expect(describeReportSendTime(new Date(2026, 8, 29, 9, 0).toISOString(), now)).toMatch(/^on Sep 29 at 9:00\sAM$/);
    expect(describeReportSendTime(new Date(2025, 11, 31, 16, 30).toISOString(), now)).toMatch(/^on Dec 31, 2025 at 4:30\sPM$/);
    expect(describeReportSendTime('not a date', now)).toBe('earlier');
  });

  it('the loader says whether the other device\'s copy was checked', async () => {
    const storage = { getItem: jest.fn(async () => JSON.stringify(morning)), setItem: jest.fn(async () => undefined) };
    const cloud = (read: DAVEReportSnapshotCloud['read']): DAVEReportSnapshotCloud => ({ read, write: jest.fn(async () => undefined) });
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, cloud(async () => ({ ownerId: 'o', snapshot: null }))))
      .resolves.toEqual({ snapshot: morning, shared: 'checked' });
    // Nothing to read (not configured, or the table not created yet): quiet.
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, cloud(async () => null)))
      .resolves.toEqual({ snapshot: morning, shared: 'unavailable' });
    // Could not be read (offline, signed out or expired, a server error).
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, cloud(async () => {
      throw new TypeError('Network request failed');
    }))).resolves.toEqual({ snapshot: morning, shared: 'unchecked' });
    // No answer within four seconds.
    jest.useFakeTimers();
    try {
      const load = loadDAVEReportPeriod('tower', 'project_manager', storage, cloud(() => new Promise<never>(() => undefined)));
      await jest.advanceTimersByTimeAsync(4000);
      await expect(load).resolves.toEqual({ snapshot: morning, shared: 'unchecked' });
    } finally {
      jest.useRealTimers();
    }
  });
});

// The whole Reports screen renders; a loaded machine needs more than the defaults.
jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
const task = (id: string, taskName: string, complete: boolean) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: complete ? 100 : 40, priority: 'Medium', status: complete ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
/** The Tower plan with the first `completed` of Frame walls, Pour slab, Set roof complete. */
const tower = (completed: number) => [
  task('frame', 'Frame walls', completed >= 1),
  task('pour', 'Pour slab', completed >= 2),
  task('roof', 'Set roof', completed >= 3),
];

const onCopyReport = jest.fn(async (_report: { body: string }) => 'completed' as const);
const reportsScreen = (scheduleItems: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={[]}
    scheduleItems={scheduleItems}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={async () => 'completed'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

type View = ReturnType<typeof render>;
// Two devices are on screen at once here. fireEvent only reaches the tree
// `screen` shows (the last render), so the phone is shown again after the
// iPad's visit.
const { setRenderResult } = jest.requireActual('@testing-library/react-native/build/screen') as {
  setRenderResult: (view: View) => void;
};
const views: View[] = [];
/** Opens the Reports tab on `device` (a new app session there: nothing remembered in memory). */
const open = (device: string, scheduleItems: ScheduleItem[]) => {
  forgetAllReportSessionState();
  onDevice(device);
  const view = render(reportsScreen(scheduleItems));
  views.push(view);
  return view;
};
const showDevice = (device: string, view: View) => {
  onDevice(device);
  setRenderResult(view);
};
afterEach(() => {
  views.splice(0).forEach(view => view.unmount());
});

const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const shareable = () => screen.findByRole('button', { name: 'Share Report' }, SLOW);
const pressApprove = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
};
const approve = async () => {
  await pressApprove();
  await shareable();
};
const pressCopy = async () => {
  if (!screen.queryByRole('button', { name: 'Copy Report' })) fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  // The delivered mark saves (and uploads) after the send resolves.
  await settle();
  await settle();
};
const approveAndSend = async () => {
  await approve();
  await pressCopy();
};
/** The written report's period section. */
const period = async () => {
  if (!screen.queryByText(/SINCE THE LAST APPROVED REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
  return body.slice(start, body.indexOf('COMPLETED WORK', start));
};
/** Brings the app back to the front, as after the phone was locked or another app was used. */
const backToTheApp = async () => {
  await act(async () => {
    appStateListeners.forEach(listener => {
      listener('background');
      listener('active');
    });
  });
  await settle();
};
const lastSentBody = () => onCopyReport.mock.calls.at(-1)?.[0].body ?? '';

/** The phone sends the morning report and stays on Reports. */
async function phoneSendsInTheMorning() {
  const phone = open('phone', tower(0));
  await approveAndSend();
  return phone;
}
/**
 * The iPad opens Reports, approves and sends, and is put down; the phone is shown again.
 *
 * Whole-app audit A6 pass 8 M1 (30 Sep 2026): the app session memory now
 * also holds this device's own sends and the period each approval was given
 * on. Both devices run in this one test process, so the iPad's visit (a new
 * app session there) wiped the phone's memory and left the iPad's in its
 * place; the phone's memory is now put back after it, as two devices have.
 */
async function ipadSends(scheduleItems: ScheduleItem[], phone: View) {
  const sessionKey = 'daily_project_update|project_manager|tower';
  const memory = recallReportSessionState(sessionKey);
  const sends = [...ownReportSendTimes()];
  const ipad = open('ipad', scheduleItems);
  await approveAndSend();
  const sent = local('ipad') as DAVEReportSnapshot;
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
  ipad.unmount();
  forgetAllReportSessionState();
  if (memory?.edits) rememberReportEdits(sessionKey, memory.edits);
  if (memory?.acknowledgement) rememberReportAcknowledgement(sessionKey, memory.acknowledgement);
  if (memory?.approvedTextKey) {
    rememberReportApproval(sessionKey, memory.approvedTextKey, memory.approvedFingerprint ?? null, memory.approvedPeriodSentAt ?? null);
  }
  sends.forEach(rememberOwnReportSend);
  showDevice('phone', phone);
  return sent;
}
const laterSendNotice = (sent: DAVEReportSnapshot) =>
  `Your other device sent a report ${describeReportSendTime(sent.deliveredAt as string)}, so this report now covers what changed since then. Review it, then approve.`;

beforeEach(() => {
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

describe('a device left on Reports while the other device sends (A6 pass 7, finding 1)', () => {
  it('coming back to the app, the phone counts from the iPad\'s midday send, and its own send keeps that start', async () => {
    const phone = await phoneSendsInTheMorning();
    const morning = local('phone') as DAVEReportSnapshot;
    const midday = await ipadSends(tower(1), phone);
    phone.rerender(reportsScreen(tower(2)));
    // Still on screen since morning: nothing has read the period again yet.
    expect(await period()).toContain('+2 completed; ');

    await backToTheApp();
    const now = await period();
    expect(now).toContain('+1 completed; ');
    expect(now).toContain('Pour slab was completed.');
    expect(now).not.toContain('Frame walls was completed.');
    expect(screen.getByText(laterSendNotice(midday))).toBeTruthy();

    await approveAndSend();
    expect(lastSentBody()).toContain('Pour slab was completed.');
    expect(lastSentBody()).not.toContain('Frame walls was completed.');
    // The shared period now runs from the phone's send, whose previous report is the iPad's, not the morning's.
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    expect(cloudRow()?.snapshot.supersedes?.sourceFingerprint).toBe(midday.sourceFingerprint);
    expect(cloudRow()?.snapshot.supersedes?.sourceFingerprint).not.toBe(morning.sourceFingerprint);
    // The notice goes once the owner approves.
    expect(screen.queryByText(/^Your other device/)).toBeNull();
  });

  it('coming back with nothing new keeps the report and its approval as they were', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    await backToTheApp();
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
    expect(await period()).toContain('Frame walls was completed.');
  });

  it('just before Approve: the iPad\'s later send moves the period, and the owner reviews it instead of approving', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    expect(await period()).toContain('+2 completed; ');
    const midday = await ipadSends(tower(1), phone);

    await pressApprove();
    expect(await screen.findByText(laterSendNotice(midday), {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    const now = await period();
    expect(now).toContain('+1 completed; ');
    expect(now).not.toContain('Frame walls was completed.');
    // Nothing of the refused approval was saved.
    expect(local('phone')?.deliveredAt).not.toBeNull();

    // Approve again: nothing newer, so it is approved and sent from the iPad's start.
    await approveAndSend();
    expect(lastSentBody()).toContain('Pour slab was completed.');
    expect(lastSentBody()).not.toContain('Frame walls was completed.');
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    expect(cloudRow()?.snapshot.supersedes?.sourceFingerprint).toBe(midday.sourceFingerprint);
  });

  it('approved at 10:00, the iPad sent at 12:00: the 17:00 send is not made, and the owner reviews the report it now is', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    await approve();
    const midday = await ipadSends(tower(1), phone);
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    await pressCopy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    expect(screen.getByText(
      `Your other device sent a report ${describeReportSendTime(midday.deliveredAt as string)}, so this report was not sent. It now covers what changed since then. Review it, then approve.`,
    )).toBeTruthy();
    // The approval no longer stands.
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
    const now = await period();
    expect(now).toContain('+1 completed; ');
    expect(now).not.toContain('Frame walls was completed.');
    // The iPad's period is kept.
    expect(cloudRow()?.snapshot.sourceFingerprint).toBe(midday.sourceFingerprint);

    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
    expect(lastSentBody()).not.toContain('Frame walls was completed.');
    await waitFor(() => expect(cloudRow()?.snapshot.supersedes?.sourceFingerprint).toBe(midday.sourceFingerprint), SLOW);
  });

  it('the iPad already sent the same report: the phone\'s copy is not sent again unless the owner approves it again', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    const midday = await ipadSends(tower(1), phone);

    await pressCopy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    expect(screen.getByText(
      `Your other device already sent this report ${describeReportSendTime(midday.deliveredAt as string)}, so it was not sent again. Approve it only if you want to send it a second time.`,
    )).toBeTruthy();
    // The text reads the same, but the approval was cleared.
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();

    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
    // A second send of the same report leaves the iPad's period as it was.
    expect(cloudRow()?.deliveredAt).toBe(midday.deliveredAt);
  });
});

const uncheckedWithSend = (sentAt: string) =>
  `Couldn't check your other device's last report, so this report counts from the last one this device knows about, sent ${describeReportSendTime(sentAt)}.`;
const uncheckedWithout = "Couldn't check your other device's last report, so this report has no earlier baseline.";

describe('the owner is told when the other device\'s last report could not be checked (A6 pass 7, finding 2)', () => {
  it('offline: one quiet line says what the report counts from; approving and sending still work; back online it goes', async () => {
    mockCloudState = 'offline';
    open('phone', tower(0));
    await approveAndSend();
    const own = local('phone') as DAVEReportSnapshot;

    open('phone', tower(1));
    expect(await period()).toContain('+1 completed; ');
    expect(screen.getByText(uncheckedWithSend(own.deliveredAt as string))).toBeTruthy();
    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    // A device with no report of its own.
    const ipad = open('ipad', tower(1));
    expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');
    expect(screen.getByText(uncheckedWithout)).toBeTruthy();

    // Back online: the next return to the app checks, and the line goes.
    mockCloudState = 'ok';
    showDevice('ipad', ipad);
    await backToTheApp();
    await waitFor(() => expect(screen.queryByText(uncheckedWithout)).toBeNull(), SLOW);
  });

  it('sign-in expired: the line is shown', async () => {
    mockCloudState = 'expired';
    open('ipad', tower(1));
    await period();
    expect(await screen.findByText(uncheckedWithout, {}, SLOW)).toBeTruthy();
  });

  it('no answer within four seconds: the line is shown', async () => {
    mockCloudState = 'hanging';
    open('ipad', tower(1));
    expect(await screen.findByText(uncheckedWithout, {}, SLOW)).toBeTruthy();
  });

  it.each(['missing_table', 'not_configured', 'ok'] as const)('%s: no line (nothing to check, or checked)', async state => {
    mockCloudState = state;
    open('phone', tower(0));
    await approveAndSend();
    open('phone', tower(1));
    expect(await period()).toContain('+1 completed; ');
    open('ipad', tower(1));
    await period();
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
    await backToTheApp();
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
  });
});
