// Whole-app audit A6 pass 10 (30 Sep 2026), on owner answer Q16 (the phone
// and the iPad share "since the last report").
//
// M1. Pass 9 held a task back only when the other device's copy of that row
//     was newer, and every edit on the phone stamps the row: David added a
//     note to Frame walls on the phone before its sync, so the phone's copy
//     looked newer and the report read "-1 completed; +1 open; Frame walls
//     was reopened at 40% complete.", approvable, while after the sync Frame
//     walls stayed complete (progress is merged by its own time), so the next
//     report said "completed" again.
// M2. Only rows both had were checked: the iPad added "Punch list" (or
//     deleted "Set roof") and sent; the phone before its sync said "Punch list
//     was removed" ("Set roof was added") and could send it.
// L2. The hold could last for good: with the iPad's clock ahead, a reopen
//     made on the phone after it synced was still held and left out; "Keep
//     cloud" brought back an older copy and both devices were held; Sync Now
//     could not clear it.
// L3. The sender id was in app storage: a reinstall lost it (the phone's own
//     send then read "Your other device already sent this report"), and an
//     iPad restored from the phone's backup took the phone's (the phone's
//     sends counted as the iPad's own).
//
// Now: a device is behind when the report it counts from was sent by the
// other install after this device last downloaded every task. While behind,
// "since the last report" is not counted and approval waits, saying why; the
// screen asks the app to download the tasks, and Settings › Sync Now does it
// too. Once a download started after the send has landed it never waits. The
// install id lives in the Keychain, this device only.

/** Each simulated device has its own app storage and Keychain; one shared fake cloud stands in for report_snapshots. */
const mockDevices = new Map<string, Map<string, string>>();
const mockKeychains = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockStore = (stores: Map<string, Map<string, string>>) => {
  if (!stores.has(mockDevice)) stores.set(mockDevice, new Map());
  return stores.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore(mockDevices).get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore(mockDevices).set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore(mockDevices).delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockStore(mockDevices).keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStore(mockDevices).get(key) ?? null])),
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockStore(mockKeychains).get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore(mockKeychains).set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore(mockKeychains).delete(key);
  }),
}));

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
const mockCloud = new Map<string, MockCloudRow>();
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) =>
    mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null })),
  // The table's rule: a row whose period started from a later send is kept.
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
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
  rememberReportApproval,
  rememberReportEdits,
} from '../../services/ReportSessionState';
import {
  forgetScheduleCloudPullSession,
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const SESSION_KEY = 'daily_project_update|project_manager|tower';
const onDevice = (device: string) => {
  mockDevice = device;
};
const local = (device: string) => {
  const raw = mockDevices.get(device)?.get(KEY);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;

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
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const withFrame = (plan: ScheduleItem[], change: Partial<ScheduleItem>) =>
  plan.map(item => item.id === 'frame' ? { ...item, ...change } as ScheduleItem : item);
const frameComplete = { percentComplete: 100, status: 'Complete' } as Partial<ScheduleItem>;

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
/** `device` downloads every task from the cloud (its refresh, or Settings › Sync Now), started `at` (now). */
const downloadsTasks = async (device: string, at = new Date().toISOString()) => {
  const was = mockDevice;
  onDevice(device);
  await act(async () => {
    await recordScheduleCloudPull(at);
  });
  onDevice(was);
};

async function keepingPhoneMemory<T>(visit: () => Promise<T>): Promise<T> {
  const memory = recallReportSessionState(SESSION_KEY);
  const sends = [...ownReportSendTimes()];
  const result = await visit();
  forgetAllReportSessionState();
  if (memory?.edits) rememberReportEdits(SESSION_KEY, memory.edits);
  if (memory?.approvedTextKey) {
    rememberReportApproval(SESSION_KEY, memory.approvedTextKey, memory.approvedFingerprint ?? null, memory.approvedPeriodSentAt ?? null);
  }
  sends.forEach(rememberOwnReportSend);
  return result;
}

let unregisterPullRequest: () => void = () => undefined;
beforeEach(() => {
  mockDevices.clear();
  mockKeychains.clear();
  mockCloud.clear();
  onDevice('phone');
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
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
  unregisterPullRequest();
  unregisterPullRequest = () => undefined;
  views.splice(0).forEach(view => view.unmount());
  jest.restoreAllMocks();
});

const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const approveButtonDisabled = () =>
  screen.getByRole('button', { name: 'Approve Report' }).props.accessibilityState?.disabled === true;
const approveAndSend = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  if (!screen.queryByRole('button', { name: 'Copy Report' })) fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
/** The period section of the written report on screen. */
const period = async () => {
  if (!screen.queryByText(/SINCE THE LAST APPROVED REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
  return body.slice(start, body.indexOf('COMPLETED WORK', start));
};
const loaded = async () => {
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull(), SLOW);
  await settle();
};
const switchTabAndBack = async (view: View, scheduleItems: ScheduleItem[]) => {
  view.unmount();
  onDevice('phone');
  const back = mount(scheduleItems);
  await loaded();
  return back;
};

/** The phone downloads the tasks at the start of the day, sends the morning report, and stays on Reports. */
async function phoneSendsInTheMorning() {
  await downloadsTasks('phone');
  const phone = open('phone', tower(0));
  await approveAndSend();
  return phone;
}
/** The iPad, synced, makes its change, approves and sends, and is put down; the phone is shown again. */
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

const deviceBehind = (sent: DAVEReportSnapshot) =>
  `This device hasn't received your other device's latest changes yet: your other device sent the last report ${describeReportSendTime(sent.deliveredAt as string)}, after this device last downloaded your tasks. Use Settings › Sync Now, then review.`;
const NOT_COUNTED = "Not counted yet: this device hasn't received your other device's latest changes.";
const alreadySent = (sent: DAVEReportSnapshot) =>
  `Your other device already sent this report ${describeReportSendTime(sent.deliveredAt as string)}. Approve it only if you want to send it a second time.`;

describe('a device behind on the other device\'s changes waits, whatever it did to the task itself (A6 pass 10 M1)', () => {
  it('the iPad marked Frame walls complete and sent; the phone added a note to it before its sync: held, said why, nothing reopened', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = withFrame(tower(0), { ...frameComplete, updatedAt: minutesFromNow(-10) });
    const midday = await ipadSends(ipadPlan, phone);

    // Before its sync, David adds a note to Frame walls on the phone: its row is the newer one.
    const touched = withFrame(tower(0), { notes: 'Inspector Tuesday.', updatedAt: new Date().toISOString() });
    const back = await switchTabAndBack(phone, touched);
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    const behind = await period();
    expect(behind).toContain(NOT_COUNTED);
    expect(behind).not.toMatch(/reopened|-1 completed|\+1 open/);

    // Its sync lands: Frame walls stays complete (the iPad's progress is the newer), with the phone's note.
    back.rerender(reportsScreen(withFrame(ipadPlan, { notes: 'Inspector Tuesday.', updatedAt: new Date().toISOString() })));
    await downloadsTasks('phone');
    await approvable();
    expect(screen.queryByText(/hasn't received your other device's latest changes/)).toBeNull();
    const caughtUp = await period();
    expect(caughtUp).not.toContain(NOT_COUNTED);
    expect(caughtUp).not.toMatch(/reopened|Frame walls was completed/);
  });
});

describe('tasks the other device added or deleted are not reported backwards (A6 pass 10 M2)', () => {
  it('the iPad added Punch list and sent: the phone before its sync does not say it was removed, and waits', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = [...tower(0), { ...task('punch', 'Punch list', false), createdAt: minutesFromNow(-5) } as ScheduleItem];
    const midday = await ipadSends(ipadPlan, phone);

    const back = await switchTabAndBack(phone, tower(0));
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    const behind = await period();
    expect(behind).toContain(NOT_COUNTED);
    expect(behind).not.toMatch(/Punch list was removed|-1 open/);

    back.rerender(reportsScreen(ipadPlan));
    await downloadsTasks('phone');
    await approvable();
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
    expect(await period()).not.toContain('Punch list was removed');
  });

  it('the iPad deleted Set roof and sent: the phone before its sync does not say it was added, and waits', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = tower(0).filter(item => item.id !== 'roof');
    const midday = await ipadSends(ipadPlan, phone);

    const back = await switchTabAndBack(phone, tower(0));
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    const behind = await period();
    expect(behind).toContain(NOT_COUNTED);
    expect(behind).not.toMatch(/Set roof was added|\+1 open/);

    back.rerender(reportsScreen(ipadPlan));
    await downloadsTasks('phone');
    await approvable();
    expect(await period()).not.toContain('Set roof was added');
  });

  it('edits made while "since the last report" was not counted wait to be discarded once the phone has the tasks', async () => {
    const phone = await phoneSendsInTheMorning();
    // The iPad completes Frame walls and sends; the phone already has that, and moved Set roof to Eli itself.
    const ipadPlan = withFrame(tower(0), frameComplete);
    const midday = await ipadSends(ipadPlan, phone);
    const phonePlan = ipadPlan.map(item => item.id === 'roof' ? { ...item, owner: 'Eli' } as ScheduleItem : item);
    const back = await switchTabAndBack(phone, phonePlan);
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
    const input = await screen.findByPlaceholderText('Report body', {}, SLOW);
    fireEvent.changeText(input, `${input.props.value as string}\nCrane arrives Monday.`);

    // Off to Settings › Sync Now (nothing new comes down) and back: the edited body still says "Not counted yet".
    back.unmount();
    await downloadsTasks('phone');
    const again = mount(phonePlan);
    await loaded();
    const changed = 'The reporting period changed after you edited this report. Discard your edits and review what changed since then before you approve.';
    expect(screen.getByText(changed)).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Discard report edits' }));
    await approvable();
    const counted = await period();
    expect(counted).toContain('Set roof owner changed from Dana to Eli.');
    expect(counted).not.toContain(NOT_COUNTED);
    again.unmount();
  });

  it('a report the phone sent itself never waits, downloaded or not', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approvable();
    expect(screen.queryByText(/hasn't received/)).toBeNull();
    expect(await period()).toContain('Frame walls was completed.');
  });
});

describe('the wait always ends once this device has downloaded the tasks (A6 pass 10 L2)', () => {
  /** The iPad, its clock an hour ahead, marks Frame walls complete and sends. */
  async function ipadAheadSends(phone: View) {
    const ipadPlan = withFrame(tower(0), { ...frameComplete, updatedAt: minutesFromNow(60) });
    const sent = await ipadSends(ipadPlan, phone);
    // Its clock: the send is stamped an hour ahead of the phone's.
    const ahead = { ...sent, deliveredAt: minutesFromNow(60) };
    mockCloud.set('tower|project_manager', { snapshot: ahead, deliveredAt: ahead.deliveredAt });
    return { ipadPlan, sent: ahead as DAVEReportSnapshot };
  }

  it('the iPad\'s clock is ahead: after Settings › Sync Now, a reopen made on the phone is reported and nothing is held', async () => {
    const phone = await phoneSendsInTheMorning();
    const { ipadPlan, sent } = await ipadAheadSends(phone);
    // Synced two minutes ago, then reopened on the phone.
    await downloadsTasks('phone', minutesFromNow(-2));
    const reopened = withFrame(ipadPlan, { percentComplete: 60, status: 'In Progress', updatedAt: minutesFromNow(-1) });
    await switchTabAndBack(phone, reopened);
    // The phone first saw the iPad's send after that download, so it cannot tell yet.
    expect(screen.getByText(deviceBehind(sent))).toBeTruthy();

    await downloadsTasks('phone');
    await approvable();
    expect(screen.queryByText(/hasn't received/)).toBeNull();
    expect(await period()).toContain('Frame walls was reopened at 60% complete.');
  });

  it('Reports asks the app to download the tasks itself, and the wait ends when that lands', async () => {
    const phone = await phoneSendsInTheMorning();
    const { ipadPlan } = await ipadAheadSends(phone);
    const requests = jest.fn(() => {
      void recordScheduleCloudPull(new Date().toISOString());
    });
    unregisterPullRequest = registerScheduleCloudPullRequest(requests);
    const reopened = withFrame(ipadPlan, { percentComplete: 60, status: 'In Progress', updatedAt: minutesFromNow(-1) });
    await switchTabAndBack(phone, reopened);
    await approvable();
    expect(requests).toHaveBeenCalled();
    expect(await period()).toContain('Frame walls was reopened at 60% complete.');
  });

  it('"Keep cloud" brought back an older copy of Frame walls on both devices: neither waits, and the report says it is at 40%', async () => {
    const phone = await phoneSendsInTheMorning();
    const ipadPlan = withFrame(tower(0), { ...frameComplete, updatedAt: minutesFromNow(-5) });
    await ipadSends(ipadPlan, phone);
    // Keep cloud: the cloud's older copy (40%, changed two hours ago) replaces Frame walls on each device.
    const keptCloud = withFrame(tower(0), { updatedAt: minutesFromNow(-120) });

    await downloadsTasks('phone');
    await switchTabAndBack(phone, keptCloud);
    await approvable();
    expect(await period()).toContain('Frame walls was reopened at 40% complete.');
    phone.unmount();

    // The iPad sent the report itself.
    open('ipad', keptCloud);
    await approvable();
    expect(screen.queryByText(/hasn't received/)).toBeNull();
    expect(await period()).toContain('Frame walls was reopened at 40% complete.');
  });
});

const SECURE_SENDER_ID_KEY = 'vitruvius.report-sender-id.v1';

describe('this install\'s sender id lives in the Keychain, on this device only (A6 pass 10 L3)', () => {
  it('after a reinstall (app storage wiped, Keychain kept), the phone\'s own earlier send is still its own', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approveAndSend();
    const own = local('phone') as DAVEReportSnapshot;
    expect(own.sentBy).toBe(mockKeychains.get('phone')?.get(SECURE_SENDER_ID_KEY));
    await waitFor(() => expect(cloudRow()?.snapshot.sentBy).toBe(own.sentBy), SLOW);
    phone.unmount();

    mockDevices.get('phone')?.clear();
    open('phone', tower(1));
    await approvable();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
  });

  it('an iPad restored from the phone\'s backup has an id of its own: the phone\'s send is the other device\'s there', async () => {
    const phone = await phoneSendsInTheMorning();
    phone.rerender(reportsScreen(tower(1)));
    await approveAndSend();
    const phoneSend = local('phone') as DAVEReportSnapshot;
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(phoneSend.deliveredAt), SLOW);
    phone.unmount();

    // The backup carries app storage; a this-device-only Keychain item stays on the phone.
    mockDevices.set('ipad', new Map(mockDevices.get('phone')));
    await downloadsTasks('ipad');
    const ipad = open('ipad', tower(1));
    await approvable();
    expect(screen.getByText(alreadySent(phoneSend))).toBeTruthy();

    // The iPad completes Pour slab and sends: its send carries its own id.
    ipad.rerender(reportsScreen(tower(2)));
    await approveAndSend();
    const ipadSend = local('ipad') as DAVEReportSnapshot;
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(ipadSend.deliveredAt), SLOW);
    expect(ipadSend.sentBy).toBe(mockKeychains.get('ipad')?.get(SECURE_SENDER_ID_KEY));
    expect(ipadSend.sentBy).not.toBe(phoneSend.sentBy);
    ipad.unmount();

    // So the phone, synced, is told the iPad already sent it, instead of sending it a third time.
    await downloadsTasks('phone');
    open('phone', tower(2));
    await approvable();
    expect(screen.getByText(alreadySent(ipadSend))).toBeTruthy();
    expect(onCopyReport).toHaveBeenCalledTimes(3);
  });
});
