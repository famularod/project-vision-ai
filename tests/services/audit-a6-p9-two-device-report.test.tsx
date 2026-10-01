// Whole-app audit A6 pass 9 (30 Sep 2026), on owner answer Q16 (the phone
// and the iPad share "since the last report").
//
// M2. A device whose sync was behind sent "reopened": the iPad marked Frame
//     walls complete and sent at 12:00; the phone opened Reports before its
//     sync pulled that, and its report read "-1 completed; +1 open; Tower:
//     Frame walls was reopened at 40% complete.", approvable and copyable with
//     nothing said, and its send became the period, so the next report said
//     "Frame walls was completed." again. A task the other device's report has
//     newer facts for is no longer reported as changed, and approval waits for
//     this device's sync, with the reason.
// L2. "Already sent" was said only when an approval was held: edited on the
//     phone without approving, sent from the iPad at 12:00, a tab switch said
//     nothing, and Approve then Copy sent the same report again. Opening
//     Reports on a report the other device already sent now says so, and this
//     device's own sends (marked with a random id this install keeps) are told
//     apart from the other device's after a relaunch too.

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
let mockCloudState: 'ok' | 'offline' | 'hanging' = 'ok';
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
    if (mockCloudState === 'hanging') return new Promise(() => undefined);
    return mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null });
  }),
  // The table's rule: a row whose period started from a later send is kept.
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
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
import { describeReportSendTime, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  forgetAllReportSessionState,
  ownReportSendTimes,
  recallReportSessionState,
  rememberOwnReportSend,
  rememberReportAcknowledgement,
  rememberReportApproval,
  rememberReportEdits,
} from '../../services/ReportSessionState';
import { forgetScheduleCloudPullSession, recordScheduleCloudPull } from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
/** The Reports screen's session memory key for the Tower Project Manager report. */
const SESSION_KEY = 'daily_project_update|project_manager|tower';
const onDevice = (device: string) => {
  mockDevice = device;
};
const local = (device: string) => {
  const raw = mockDevices.get(device)?.get(KEY);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;

const appStateListeners = new Set<(state: string) => void>();

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
const reportsScreen = (scheduleItems: ScheduleItem[], reportType = 'daily_project_update') => (
  <ReportsScreen
    projectName="Tower"
    reportType={reportType as never}
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
const mount = (scheduleItems: ScheduleItem[]) => {
  const view = render(reportsScreen(scheduleItems));
  views.push(view);
  return view;
};
/** Opens the Reports tab on `device` (a new app session there: nothing remembered in memory). */
const open = (device: string, scheduleItems: ScheduleItem[]) => {
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  onDevice(device);
  return mount(scheduleItems);
};
/**
 * `device` has downloaded every task from the cloud, now. Added on purpose by
 * A6 pass 10 M1/M2: a device whose report counts from the other device's
 * send, with other facts, now waits until it has downloaded the tasks since
 * that send, so a device that made its change after syncing says so here.
 */
const downloadsTasks = async (device: string) => {
  const was = mockDevice;
  onDevice(device);
  await act(async () => {
    await recordScheduleCloudPull(new Date().toISOString());
  });
  onDevice(was);
};

/**
 * The phone's app memory while the iPad is used. Both devices run in this one
 * test process, and the iPad's visit is a new app session there, so the
 * phone's memory (what it approved, edited and sent) is put back after it.
 */
async function keepingPhoneMemory<T>(visit: () => Promise<T>): Promise<T> {
  const memory = recallReportSessionState(SESSION_KEY);
  const sends = [...ownReportSendTimes()];
  const result = await visit();
  forgetAllReportSessionState();
  if (memory?.edits) rememberReportEdits(SESSION_KEY, memory.edits);
  if (memory?.acknowledgement) rememberReportAcknowledgement(SESSION_KEY, memory.acknowledgement);
  if (memory?.approvedTextKey) {
    rememberReportApproval(SESSION_KEY, memory.approvedTextKey, memory.approvedFingerprint ?? null, memory.approvedPeriodSentAt ?? null);
  }
  sends.forEach(rememberOwnReportSend);
  return result;
}

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
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});
afterEach(() => {
  views.splice(0).forEach(view => view.unmount());
  jest.restoreAllMocks();
});

const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const shareable = () => screen.findByRole('button', { name: 'Share Report' }, SLOW);
const approve = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await shareable();
};
const pressCopy = async () => {
  if (!screen.queryByRole('button', { name: 'Copy Report' })) fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
const approveAndSend = async () => {
  await approve();
  await pressCopy();
};
/** The period section of the report on screen (the edited body when there is one). */
const period = async () => {
  if (!screen.queryByText(/SINCE THE LAST APPROVED REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
  return body.slice(start, body.indexOf('COMPLETED WORK', start));
};
/** Edits the report body on screen: the owner adds a line of their own. */
const addOwnLine = async (line: string) => {
  fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
  const input = await screen.findByPlaceholderText('Report body', {}, SLOW);
  fireEvent.changeText(input, `${input.props.value as string}\n${line}`);
};
/** Leaves Reports for another tab and comes back: the screen unmounts, the app session goes on. */
const switchTabAndBack = async (view: View, scheduleItems: ScheduleItem[]) => {
  view.unmount();
  onDevice('phone');
  const back = mount(scheduleItems);
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull(), SLOW);
  await settle();
  return back;
};

/** The phone sends the morning report and stays on Reports. */
async function phoneSendsInTheMorning() {
  const phone = open('phone', tower(0));
  await approveAndSend();
  return phone;
}
/** The iPad opens Reports, approves and sends, and is put down; the phone is shown again. */
async function ipadSends(scheduleItems: ScheduleItem[], phone: View) {
  return keepingPhoneMemory(async () => {
    await downloadsTasks('ipad');
    const ipad = open('ipad', scheduleItems);
    await approveAndSend();
    const sent = local('ipad') as DAVEReportSnapshot;
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
    ipad.unmount();
    onDevice('phone');
    setRenderResult(phone);
    return sent;
  });
}

const alreadySent = (sent: DAVEReportSnapshot) =>
  `Your other device already sent this report ${describeReportSendTime(sent.deliveredAt as string)}. Approve it only if you want to send it a second time.`;
// Changed on purpose by A6 pass 10 L2: the hold now says why (the other
// device sent the last report after this device last downloaded the tasks),
// and "since the last report" is not counted while it waits (M1/M2).
const deviceBehind = (sent: DAVEReportSnapshot) =>
  `This device hasn't received your other device's latest changes yet: your other device sent the last report ${describeReportSendTime(sent.deliveredAt as string)}, after this device last downloaded your tasks. Use Settings › Sync Now, then review.`;
const NOT_COUNTED = "Not counted yet: this device hasn't received your other device's latest changes.";
const SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';

/** The iPad's copy of the plan after it marked Frame walls complete at `at`. */
const frameMarkedCompleteOnIpad = (at: string) => tower(0).map(item => item.id === 'frame'
  ? { ...item, percentComplete: 100, status: 'Complete', updatedAt: at } as ScheduleItem
  : item);

describe('a device whose sync is behind does not report the other device\'s change backwards (A6 pass 9 M2)', () => {
  it('the iPad marked Frame walls complete and sent at 12:00; the phone before its sync: held, said why, nothing reopened', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = frameMarkedCompleteOnIpad(new Date().toISOString());
    const midday = await ipadSends(ipadPlan, phone);

    // The phone has not pulled the iPad's change yet.
    const back = await switchTabAndBack(phone, tower(0));
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Report' }).props.accessibilityState).toMatchObject({ disabled: true });
    const behind = await period();
    expect(behind).not.toContain('reopened');
    expect(behind).not.toContain('-1 completed');
    expect(behind).toContain(NOT_COUNTED);
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    // Its sync lands: the hold clears, and the report is the one the iPad sent, said as such.
    back.rerender(reportsScreen(ipadPlan));
    await downloadsTasks('phone');
    await approvable();
    expect(screen.queryByText(deviceBehind(midday))).toBeNull();
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
    expect(await period()).not.toContain('reopened');
  });

  it('a change the phone made after the iPad\'s send is still reported, and nothing is held', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = frameMarkedCompleteOnIpad(new Date(Date.now() - 60_000).toISOString());
    await ipadSends(ipadPlan, phone);
    // Synced, then reopened on the phone.
    await downloadsTasks('phone');
    const reopened = ipadPlan.map(item => item.id === 'frame'
      ? { ...item, percentComplete: 60, status: 'In Progress', updatedAt: new Date(Date.now() + 60_000).toISOString() } as ScheduleItem
      : item);
    await switchTabAndBack(phone, reopened);
    await approvable();
    expect(screen.queryByText(/hasn't received your other device's latest changes/)).toBeNull();
    expect(await period()).toContain('Frame walls was reopened at 60% complete.');
  });
});

describe('"already sent" is said on opening Reports, not only when an approval was held (A6 pass 9 L2)', () => {
  it('edited on the phone without approving, the iPad sent the same report at 12:00: after a tab switch the owner is told', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approvable();
    await addOwnLine('Crane arrives Monday.');
    const midday = await ipadSends(tower(1), phone);

    await switchTabAndBack(phone, tower(1));
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    // Approving is the owner's choice to send it a second time; the notice goes with it.
    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(alreadySent(midday))).toBeNull();
  });

  it('opened fresh after the iPad sent the same report: told, from the first look', async () => {
    const phone = await phoneSendsInTheMorning();
    const midday = await ipadSends(tower(1), phone);
    phone.unmount();
    open('phone', tower(1));
    await approvable();
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
  });

  it('this device\'s own send, read back after a relaunch, is never said to be the other device\'s', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approveAndSend();
    const own = local('phone') as DAVEReportSnapshot;
    // The send carries this install's id, kept on this device only.
    expect(own.sentBy).toEqual(expect.stringMatching(/^[\w-]{16,}$/));
    expect(own.sentBy).toBe(mockDevices.get('phone')?.get(SENDER_ID_KEY));
    expect(mockDevices.get('ipad')?.get(SENDER_ID_KEY)).toBeUndefined();
    await waitFor(() => expect((cloudRow()?.snapshot as DAVEReportSnapshot | undefined)?.sentBy).toBe(own.sentBy), SLOW);
    phone.unmount();
    // A relaunch: nothing remembered in memory.
    open('phone', tower(1));
    await approvable();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
  });

  it('a report sent before sends carried an id: this device\'s own saved copy tells its own send from the iPad\'s', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approveAndSend();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    const withoutId = ({ sentBy: _sentBy, ...snapshot }: DAVEReportSnapshot) => snapshot;
    mockDevices.get('phone')?.set(KEY, JSON.stringify(withoutId(local('phone') as DAVEReportSnapshot)));
    const row = cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
    mockCloud.set('tower|project_manager', { ...row, snapshot: withoutId(row.snapshot) as DAVEReportSnapshot });
    phone.unmount();
    const relaunched = open('phone', tower(1));
    await approvable();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
    relaunched.unmount();

    // The iPad's send of the next report, also without an id, is the other device's.
    const ipadSent = await keepingPhoneMemory(async () => {
      const ipad = open('ipad', tower(2));
      await approveAndSend();
      const sent = local('ipad') as DAVEReportSnapshot;
      await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
      ipad.unmount();
      return sent;
    });
    const ipadRow = cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
    mockCloud.set('tower|project_manager', { ...ipadRow, snapshot: withoutId(ipadRow.snapshot) as DAVEReportSnapshot });
    open('phone', tower(2));
    await approvable();
    expect(screen.getByText(alreadySent(ipadSent))).toBeTruthy();
  });

  it('a different report the iPad sent is not called "already sent"', async () => {
    const phone = await phoneSendsInTheMorning();
    await ipadSends(tower(1), phone);
    // Synced, then Pour slab completed on the phone.
    await downloadsTasks('phone');
    await switchTabAndBack(phone, tower(2));
    await approvable();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
  });
});
