// Whole-app audit A6 pass 11 L3, L4 (30 Sep 2026), on pass 10 L3 (this
// install's report sender id lives in the Keychain, this device only) and
// pass 10 M1 (a device waits until it has downloaded the tasks since the
// other device's send).
//
// L3. A send whose sender id could not be read (the iPad's Keychain locked
//     at the moment the share sheet closed) went without one, and the phone
//     never waits on a send without an id, so the phone's report read the
//     iPad's completion backwards again: "Frame walls was reopened" (M1).
//     Now the id read when Reports opened is kept for the app session and
//     used at send; and a send with no id that this device does not know as
//     its own (its own are known by their send time) is the other install's:
//     a send from an older build waits for a download, which ends by itself.
// L4. A device restored from a backup taken before the Keychain move carried
//     the other device's id in app storage, and the move wrote that one id
//     into both Keychains for good: each device's sends counted as the
//     other's own. The move now makes a fresh id and deletes the app-storage
//     one; this device's sends under the old id are still known as its own
//     by its saved copy of them.

const mockDevices = new Map<string, Map<string, string>>();
const mockKeychains = new Map<string, Map<string, string>>();
const mockLocked = new Set<string>();
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
// Each device's Keychain; a this-device-only item cannot be read or written while that device is locked.
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => {
    if (mockLocked.has(mockDevice)) throw new Error('User interaction is not allowed.');
    return mockStore(mockKeychains).get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockLocked.has(mockDevice)) throw new Error('User interaction is not allowed.');
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
import {
  describeReportSendTime,
  otherDeviceSendNotReceived,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  forgetReportSenderIdSession,
  reportSenderId,
  reportSnapshotSentHere,
} from '../../services/DAVEReportSnapshotRepository';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import {
  forgetScheduleCloudPullSession,
  recordScheduleCloudPull,
} from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const APP_STORAGE_SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';
const KEYCHAIN_SENDER_ID_KEY = 'vitruvius.report-sender-id.v1';
const local = (device: string) => {
  const raw = mockDevices.get(device)?.get(KEY);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;
const keychainId = (device: string) => mockKeychains.get(device)?.get(KEYCHAIN_SENDER_ID_KEY);

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
const views: View[] = [];
/** Opens Reports on `device` in a new app session there (nothing remembered in memory, the sender id included). */
const open = (device: string, scheduleItems: ScheduleItem[]) => {
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  forgetReportSenderIdSession();
  mockDevice = device;
  const view = render(reportsScreen(scheduleItems));
  views.push(view);
  return view;
};
/** `device`'s background refresh downloads every task, started now. */
const downloadsTasks = async (device: string) => {
  const was = mockDevice;
  mockDevice = device;
  await act(async () => {
    await recordScheduleCloudPull(new Date().toISOString());
  });
  mockDevice = was;
};

beforeEach(() => {
  mockDevices.clear();
  mockKeychains.clear();
  mockLocked.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  forgetReportSenderIdSession();
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
const loaded = async () => {
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull(), SLOW);
  await settle();
};
/** Approves and copies the report; `beforeSendLands` runs while the share sheet is open. */
const approveAndSend = async (beforeSendLands: () => void = () => undefined) => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  if (!screen.queryByRole('button', { name: 'Copy Report' })) fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  onCopyReport.mockImplementationOnce(async () => {
    beforeSendLands();
    return 'completed';
  });
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
const period = async () => {
  if (!screen.queryByText(/SINCE THE LAST APPROVED REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
  return body.slice(start, body.indexOf('COMPLETED WORK', start));
};
const deviceBehind = (sent: DAVEReportSnapshot) =>
  `This device hasn't received your other device's latest changes yet: your other device sent the last report ${describeReportSendTime(sent.deliveredAt as string)}, after this device last downloaded your tasks. Use Settings › Sync Now, then review.`;
const alreadySent = (sent: DAVEReportSnapshot) =>
  `Your other device already sent this report ${describeReportSendTime(sent.deliveredAt as string)}. Approve it only if you want to send it a second time.`;
const NOT_COUNTED = "Not counted yet: this device hasn't received your other device's latest changes.";

/** `device`, downloaded, sends the report on `plan`; `beforeSendLands` runs while its share sheet is open. */
async function sends(device: string, plan: ScheduleItem[], beforeSendLands?: () => void) {
  await downloadsTasks(device);
  const view = open(device, plan);
  await approveAndSend(beforeSendLands);
  const sent = local(device) as DAVEReportSnapshot;
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
  view.unmount();
  return sent;
}

describe('L3: a send whose sender id could not be read still tells the other device to wait', () => {
  it('the iPad locks as its share sheet closes: its send carries the id read when Reports opened, and the phone waits', async () => {
    // The iPad sent yesterday's report (it has an id); the phone sent this
    // morning's, after moving Set roof to Eli.
    const toEli = (plan: ScheduleItem[]) =>
      plan.map(item => item.id === 'roof' ? { ...item, owner: 'Eli' } as ScheduleItem : item);
    await sends('ipad', tower(0));
    await sends('phone', toEli(tower(0)));

    // The iPad, a new app session, completes Frame walls; it locks before the send is recorded.
    const midday = await sends('ipad', toEli(tower(1)), () => mockLocked.add('ipad'));
    expect(midday.sentBy).toBe(keychainId('ipad'));
    expect(midday.sentBy).not.toBe(keychainId('phone'));

    // The phone, before its sync: waits, and nothing is reopened.
    open('phone', toEli(tower(0)));
    await loaded();
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    const behind = await period();
    expect(behind).toContain(NOT_COUNTED);
    expect(behind).not.toMatch(/reopened|-1 completed/);
  });

  it('the iPad\'s first send, locked before any id was read: sent without one, and the phone still waits until it downloads', async () => {
    await sends('phone', tower(0));
    const midday = await sends('ipad', tower(1), () => mockLocked.add('ipad'));
    expect(midday.sentBy).toBeUndefined();

    const phone = open('phone', tower(0));
    await loaded();
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(await period()).not.toMatch(/reopened/);

    // Its sync lands: the wait ends by itself.
    phone.rerender(reportsScreen(tower(1)));
    await downloadsTasks('phone');
    await approvable();
    expect(screen.queryByText(/hasn't received/)).toBeNull();
    expect(screen.getByText(alreadySent(midday))).toBeTruthy();
  });

  it('one device only: its own send made while locked, read back after a relaunch, never waits', async () => {
    const own = await sends('phone', tower(0), () => mockLocked.add('phone'));
    expect(own.sentBy).toBeUndefined();
    mockLocked.delete('phone');

    // A relaunch, Frame walls completed since, no download since the send.
    open('phone', tower(1));
    await approvable();
    expect(screen.queryByText(/hasn't received|^Your other device/)).toBeNull();
    expect(await period()).toContain('Frame walls was completed.');
  });

  it('the rule: a send with no id is the other install\'s unless it is one of this device\'s own', () => {
    const send = {
      version: 'dave-report-snapshot/1.0', scopeKey: 'tower', reportFormat: 'project_manager',
      capturedAt: '2026-09-30T11:59:00.000Z', deliveredAt: '2026-09-30T12:00:00.000Z',
      sourceFingerprint: 'ipad facts', tasks: [],
    } as unknown as DAVEReportSnapshot;
    const rule = (ownSends: string[]) => otherDeviceSendNotReceived({
      period: send, currentFingerprint: 'phone facts', ownSends: new Set(ownSends), pulledAt: '2026-09-30T09:00:00.000Z',
    });
    expect(rule([])).toBe(send);
    expect(rule(['2026-09-30T12:00:00.000Z'])).toBeNull();
  });
});

describe('L3: the sender id read this app session is used while the Keychain cannot be read', () => {
  it('read when Reports opens, kept, and used at a locked send; a new session that never read it sends none', async () => {
    mockKeychains.set('phone', new Map([[KEYCHAIN_SENDER_ID_KEY, 'phone-install-id-0123456789']]));
    const sent = { deliveredAt: '2026-09-30T08:00:00.000Z', sentBy: 'someone-else', scopeKey: 'tower' } as unknown as DAVEReportSnapshot;
    expect(await reportSnapshotSentHere(sent)).toBe(false);
    mockLocked.add('phone');
    expect(await reportSenderId()).toBe('phone-install-id-0123456789');

    forgetReportSenderIdSession();
    await expect(reportSenderId()).rejects.toThrow();
    expect(mockDevices.get('phone')?.get(APP_STORAGE_SENDER_ID_KEY)).toBeUndefined();
  });
});

/** Before this build: the pass 9 id in app storage, nothing in the Keychain, and the last send made under that id. */
function asBeforeTheKeychainMove(device: string, oldId: string) {
  const storage = mockDevices.get(device) as Map<string, string>;
  const sent = { ...(local(device) as DAVEReportSnapshot), sentBy: oldId };
  storage.set(KEY, JSON.stringify(sent));
  storage.set(APP_STORAGE_SENDER_ID_KEY, oldId);
  mockKeychains.get(device)?.clear();
  const row = cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
  if (row.deliveredAt === sent.deliveredAt) mockCloud.set('tower|project_manager', { ...row, snapshot: sent });
  return sent;
}
const OLD_ID = 'pass9-app-storage-id-0123456789';
const FORMER_KEYCHAIN_KEY = 'vitruvius.report-sender-id.app-storage.v1';

describe('L4: the move to the Keychain makes a fresh id, so a device restored from an earlier backup has its own', () => {
  it('the move: a fresh id in the Keychain, the app-storage one deleted and kept in the Keychain as this device\'s former id', async () => {
    mockDevices.set('phone', new Map([[APP_STORAGE_SENDER_ID_KEY, OLD_ID]]));
    const id = await reportSenderId();
    expect(id).not.toBe(OLD_ID);
    expect(keychainId('phone')).toBe(id);
    expect(mockDevices.get('phone')?.has(APP_STORAGE_SENDER_ID_KEY)).toBe(false);
    expect(mockKeychains.get('phone')?.get(FORMER_KEYCHAIN_KEY)).toBe(OLD_ID);
    expect(await reportSenderId()).toBe(id);
  });

  it('this device\'s send under the old id is still its own, before and after the move', async () => {
    await sends('phone', tower(0));
    const own = asBeforeTheKeychainMove('phone', OLD_ID);

    // This build, before the move: Frame walls completed since, no download since that send.
    open('phone', tower(1));
    await approvable();
    expect(screen.queryByText(/hasn't received|^Your other device/)).toBeNull();
    expect(await period()).toContain('Frame walls was completed.');
    views.splice(0).forEach(view => view.unmount());

    // The move (the next send), then the same report: still its own.
    await reportSenderId();
    expect(keychainId('phone')).not.toBe(OLD_ID);
    open('phone', tower(0));
    await approvable();
    expect(screen.queryByText(/^Your other device/)).toBeNull();
    expect(own.sentBy).toBe(OLD_ID);
  });

  it('an iPad restored from the phone\'s backup taken before the move: each device\'s sends are the other\'s there', async () => {
    // The phone, on the pass 9 build, sent the morning report under its app-storage id.
    await sends('phone', tower(0));
    asBeforeTheKeychainMove('phone', OLD_ID);
    // Its backup, app storage only, restored onto the iPad; both then update to this build.
    mockDevices.set('ipad', new Map(mockDevices.get('phone')));

    // The iPad completes Frame walls and sends: under an id of its own.
    const midday = await sends('ipad', tower(1));
    expect(midday.sentBy).toBe(keychainId('ipad'));
    expect(midday.sentBy).not.toBe(OLD_ID);
    expect(mockDevices.get('ipad')?.has(APP_STORAGE_SENDER_ID_KEY)).toBe(false);

    // The phone, before its sync, waits for the iPad's changes: nothing reopened.
    const phone = open('phone', tower(0));
    await loaded();
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(await period()).not.toMatch(/reopened/);

    // Synced, the phone completes Pour slab and sends: under another id of its own.
    phone.rerender(reportsScreen(tower(2)));
    await downloadsTasks('phone');
    await approveAndSend();
    const afternoon = local('phone') as DAVEReportSnapshot;
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(afternoon.deliveredAt), SLOW);
    expect(afternoon.sentBy).toBe(keychainId('phone'));
    expect([OLD_ID, midday.sentBy]).not.toContain(afternoon.sentBy);
    phone.unmount();

    // So the iPad, synced, is told the phone already sent it.
    await downloadsTasks('ipad');
    open('ipad', tower(2));
    await approvable();
    expect(screen.getByText(alreadySent(afternoon))).toBeTruthy();
  });
});
