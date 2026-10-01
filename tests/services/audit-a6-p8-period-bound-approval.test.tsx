// Whole-app audit A6 pass 8 M1 (30 Sep 2026), on owner answers Q16 (the phone
// and the iPad share "since the last report") and Q17 (a period per format).
//
// An approval or edit made before the other device sent was not tied to the
// reporting period it was made on:
// (a) Approved on the phone at 10:00, the same report sent from the iPad at
//     12:00: after a tab switch the approval came back and Copy sent the
//     report again, with nothing said.
// (b) Edited and approved at 10:00, the iPad sent at 12:00: after a tab switch
//     the old approval came back and the edited morning report went out
//     ("+2 completed; Frame walls was completed.", which the iPad had sent).
// (c) Left on screen with an edited report, the notice said "this report now
//     covers what changed since then" while the edited body still counted
//     from the morning.
// An approval now stands only on the period it was given on, and edits made
// on another period are not current: the owner is told so, plainly.

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
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
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
  onDevice(device);
  return mount(scheduleItems);
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
const periodChangedAfterEdits = (sent: DAVEReportSnapshot) =>
  `The reporting period changed after you edited this report, because your other device sent a report ${describeReportSendTime(sent.deliveredAt as string)}. Discard your edits and review what changed since then before you approve.`;

describe('an approval stands only on the period it was given on (A6 pass 8 M1)', () => {
  it('(a) approved at 10:00, the iPad sent the same report at 12:00: after a tab switch the approval is not back, and the owner is told', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    const midday = await ipadSends(tower(1), phone);
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    await switchTabAndBack(phone, tower(1));
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    // Approving again is the owner's choice to send it a second time; the iPad's period is kept.
    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
    expect(cloudRow()?.deliveredAt).toBe(midday.deliveredAt);
  });

  it('(a) the phone\'s own send keeps its approval across a tab switch, as before', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approveAndSend();
    await switchTabAndBack(phone, tower(1));
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
    await pressCopy();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
  });

  it('(a) nothing sent in between: the approval comes back after a tab switch, as before', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    await switchTabAndBack(phone, tower(1));
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
  });

  it('approved at 10:00, the iPad sent a different report at 12:00: after a tab switch the owner is told the report now counts from it', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    await approve();
    const midday = await ipadSends(tower(1), phone);

    await switchTabAndBack(phone, tower(2));
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.getByText(
      `Your other device sent a report ${describeReportSendTime(midday.deliveredAt as string)}, so this report now covers what changed since then. Review it, then approve.`,
    )).toBeTruthy();
    const now = await period();
    expect(now).toContain('+1 completed; ');
    expect(now).not.toContain('Frame walls was completed.');
  });

  it('a report of another type sent from this device since: the earlier approval does not come back, and no other device is named', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    // The combined report of the same project shares the period (Q17: per projects and format).
    phone.rerender(reportsScreen(tower(1), 'combined_project_update'));
    await approveAndSend();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    phone.rerender(reportsScreen(tower(1)));
    await approvable();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
    // After a tab switch this device's own send is still known as its own.
    await switchTabAndBack(phone, tower(1));
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
  });

  it('the send check compares against the period the approval was given on', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approve();
    const approval = recallReportSessionState(SESSION_KEY);
    expect(approval?.approvedPeriodSentAt).toBe(local('phone')?.supersedes?.deliveredAt);
    const midday = await ipadSends(tower(1), phone);
    // Still on screen: the send is stopped and the owner is told, as in pass 7.
    await pressCopy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    expect(screen.getByText(
      `Your other device already sent this report ${describeReportSendTime(midday.deliveredAt as string)}, so it was not sent again. Approve it only if you want to send it a second time.`,
    )).toBeTruthy();
  });
});

describe('edits made on another period are not current (A6 pass 8 M1)', () => {
  it('(b) edited and approved at 10:00, the iPad sent at 12:00: after a tab switch the edited morning report cannot be sent', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    await approvable();
    await addOwnLine('Crane arrives Monday.');
    await approve();
    expect(await period()).toContain('+2 completed; ');
    const midday = await ipadSends(tower(1), phone);

    await switchTabAndBack(phone, tower(2));
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.getByText(periodChangedAfterEdits(midday))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Report' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(onCopyReport).toHaveBeenCalledTimes(2);

    // Discarding shows what changed since the iPad's send; that is what goes out.
    fireEvent.press(screen.getByRole('button', { name: 'Discard report edits' }));
    const now = await period();
    expect(now).toContain('+1 completed; ');
    expect(now).toContain('Pour slab was completed.');
    expect(now).not.toContain('Frame walls was completed.');
    await approveAndSend();
    expect(lastSentBody()).not.toContain('Frame walls was completed.');
    expect(lastSentBody()).not.toContain('Crane arrives Monday.');
  });

  it('(c) left on screen with an edited report: no "now covers" notice, and the plain reason', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    await approvable();
    await addOwnLine('Crane arrives Monday.');
    await approve();
    const midday = await ipadSends(tower(1), phone);

    await backToTheApp();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull(), SLOW);
    // The edited body still counts from the morning, so it is not said to cover what changed since the iPad's send.
    expect(await period()).toContain('+2 completed; ');
    expect(screen.queryByText(/now covers what changed since then/)).toBeNull();
    expect(screen.getByText(periodChangedAfterEdits(midday))).toBeTruthy();
  });

  it('(c) pressing Copy on an edited report the iPad overtook: not sent, and nothing says it now covers the later period', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(2)));
    await approvable();
    await addOwnLine('Crane arrives Monday.');
    await approve();
    const midday = await ipadSends(tower(1), phone);

    await pressCopy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    expect(screen.getByText(
      `Your other device sent a report ${describeReportSendTime(midday.deliveredAt as string)}, so this report was not sent.`,
    )).toBeTruthy();
    expect(screen.queryByText(/now covers what changed since then/)).toBeNull();
    expect(screen.getByText(periodChangedAfterEdits(midday))).toBeTruthy();
  });

  it('edits made before the period loaded: the period changed, and the other device is not blamed', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.unmount();
    // The shared copy does not answer, so the period loads from this device after four seconds.
    mockCloudState = 'hanging';
    mount(tower(1));
    expect(screen.getByText('The reporting period is still loading.')).toBeTruthy();
    await addOwnLine('Crane arrives Monday.');
    await waitFor(() => expect(screen.getByText(
      'The reporting period changed after you edited this report. Discard your edits and review what changed since then before you approve.',
    )).toBeTruthy(), SLOW);
    expect(screen.getByRole('button', { name: 'Approve Report' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('edits on the same period stay current: an own send, a tab switch, and nothing new keep them approvable', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approvable();
    await addOwnLine('Crane arrives Monday.');
    await approveAndSend();
    expect(lastSentBody()).toContain('Crane arrives Monday.');
    await switchTabAndBack(phone, tower(1));
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByText(/reporting period changed/)).toBeNull();
    expect(await period()).toContain('Frame walls was completed.');
  });
});

describe('the "Couldn\'t check" line after an offline send (A6 pass 8 L2)', () => {
  it('names the report the "since" section on screen counts from', async () => {
    mockCloudState = 'offline';
    open('phone', tower(0));
    await approveAndSend();
    // That report went out yesterday, so the two sends read differently.
    const morning = { ...(local('phone') as DAVEReportSnapshot), deliveredAt: new Date(Date.now() - 86_400_000).toISOString() };
    mockDevices.get('phone')?.set(KEY, JSON.stringify(morning));
    const phone = open('phone', tower(1));
    await approveAndSend();
    const own = local('phone') as DAVEReportSnapshot;
    expect(own.deliveredAt).not.toBe(morning.deliveredAt);
    // The report just sent still reads from the morning, and so does the line.
    expect(await period()).toContain('Frame walls was completed.');
    expect(screen.getByText(
      `Couldn't check your other device's last report, so this report counts from the last one this device knows about, sent ${describeReportSendTime(morning.deliveredAt as string)}.`,
    )).toBeTruthy();
    // The next report counts from the send just made, and the line says so.
    phone.rerender(reportsScreen(tower(2)));
    await approvable();
    const next = await period();
    expect(next).toContain('+1 completed; ');
    expect(screen.getByText(
      `Couldn't check your other device's last report, so this report counts from the last one this device knows about, sent ${describeReportSendTime(own.deliveredAt as string)}.`,
    )).toBeTruthy();
  });
});
