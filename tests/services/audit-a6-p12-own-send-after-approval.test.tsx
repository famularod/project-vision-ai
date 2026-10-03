// Whole-app audit A6 pass 12 L2 (30 Sep 2026), on pass 11 L3 (a send with no
// sender id that this device does not know as its own is the other
// install's, and this device waits for a download before counting from it).
//
// The phone sent with no id (its Keychain locked as the share sheet closed,
// none read yet that app session). The next day, after a relaunch, it
// approved a new report and did not send it. Relaunched again before any
// download had completed since the send, it said "This device hasn't
// received your other device's latest changes yet…" and Approve was
// disabled, though no other device was involved: this device knew its own
// no-id send only while its saved copy was that send, and the approval had
// replaced it (the in-app memory of its own sends ends with the app session).
//
// Now each time this device sends, the send time is kept in a stored list
// for this account (under the report-snapshot prefix the owner storage
// sandbox keeps per account; the last 50 sends), and a send with no id, or
// under this install's former id, is this device's own when its time is on
// that list. The approval's superseded send is never taken for this
// device's own on its own say: it may be the other device's.


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
  reportPeriodSend,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  forgetReportSenderIdSession,
  rememberReportSentHere,
  reportSnapshotSentHere,
} from '../../services/DAVEReportSnapshotRepository';
import { isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';
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
  // Owner answer 2 Oct (report heading): the written report's heading is "SINCE THE LAST REPORT" (was "SINCE THE LAST APPROVED REPORT"); pin updated deliberately.
  if (!screen.queryByText(/SINCE THE LAST REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST REPORT');
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

/** Approves (does not send) the report on screen. */
const approveOnly = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
  await settle();
  await settle();
};

/** Where this device's own send times are kept (A6 pass 12 L2): under the report-snapshot prefix, per account. */
const OWN_SENDS_KEY = '@vitruvius/report-snapshots/own-sends/v1';
const ownSendList = (device: string) => JSON.parse(mockDevices.get(device)?.get(OWN_SENDS_KEY) ?? '[]') as string[];
const memoryStorage = (entries: [string, string][] = []) => {
  const map = new Map(entries);
  return {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
  };
};

describe('L2: this device\'s own send without an id stays its own once an approval is saved over it', () => {
  it('sent with no id, approved (not sent) the next day, relaunched before any download: no wait, and Approve stands', async () => {
    // The phone's send, locked as the share sheet closed, no id read yet this session.
    const own = await sends('phone', tower(0), () => mockLocked.add('phone'));
    expect(own.sentBy).toBeUndefined();
    mockLocked.delete('phone');

    // Next morning (a relaunch): Frame walls completed; the phone approves, not sent yet.
    const morning = open('phone', tower(1));
    await loaded();
    expect(screen.queryAllByText(/hasn't received/)).toHaveLength(0);
    await approveOnly();
    const saved = local('phone') as DAVEReportSnapshot;
    expect(saved.deliveredAt).toBeNull();
    expect(saved.supersedes?.deliveredAt).toBe(own.deliveredAt);
    morning.unmount();

    // Relaunched again before any download since the send; Pour slab completed too.
    open('phone', tower(2));
    await loaded();
    expect(screen.queryAllByText(/hasn't received/)).toHaveLength(0);
    expect(approveButtonDisabled()).toBe(false);
    const counted = await period();
    expect(counted).not.toContain(NOT_COUNTED);
    expect(counted).toContain('Frame walls was completed.');
    expect(counted).toContain('Pour slab was completed.');
  });

  it('the send time is kept for this account when the send is recorded', async () => {
    const own = await sends('phone', tower(0), () => mockLocked.add('phone'));
    expect(ownSendList('phone')).toEqual([own.deliveredAt]);
    expect(ownSendList('ipad')).toEqual([]);
    // Under the prefix the owner storage sandbox keeps for each account.
    expect(isOwnerSensitiveCanonicalStorageKey(OWN_SENDS_KEY)).toBe(true);
  });

  it('a send recorded before this build, still known by its saved copy when Reports opens, is kept on the list then', async () => {
    const own = await sends('phone', tower(0), () => mockLocked.add('phone'));
    mockLocked.delete('phone');
    // As if sent by the build before this one: no list.
    mockDevices.get('phone')?.delete(OWN_SENDS_KEY);

    const morning = open('phone', tower(1));
    await loaded();
    await waitFor(() => expect(ownSendList('phone')).toEqual([own.deliveredAt]), SLOW);
    await approveOnly();
    morning.unmount();

    open('phone', tower(2));
    await loaded();
    expect(screen.queryAllByText(/hasn't received/)).toHaveLength(0);
    expect(approveButtonDisabled()).toBe(false);
  });
});

describe('L2: the other device\'s send is still the other device\'s', () => {
  const ipadSend = {
    version: 'dave-report-snapshot/1.0', scopeKey: 'tower', reportFormat: 'project_manager',
    capturedAt: '2026-09-30T11:59:00.000Z', deliveredAt: '2026-09-30T12:00:00.000Z',
    sourceFingerprint: 'ipad facts', tasks: [],
  } as unknown as DAVEReportSnapshot;
  const approvalOver = (send: DAVEReportSnapshot) => ({
    ...send, capturedAt: '2026-09-30T14:00:00.000Z', sourceFingerprint: 'phone facts', deliveredAt: null, supersedes: send,
  }) as unknown as DAVEReportSnapshot;

  it('an approval here over the other device\'s send with no id: that send is never taken for this device\'s own', async () => {
    const approval = approvalOver(ipadSend);
    const storage = memoryStorage([[KEY, JSON.stringify(approval)]]);
    expect(await reportSnapshotSentHere(reportPeriodSend(approval), storage)).toBe(false);
    // This device's own send, kept on its list, is its own whatever is saved over it.
    await rememberReportSentHere(ipadSend.deliveredAt as string, storage);
    expect(await reportSnapshotSentHere(reportPeriodSend(approval), storage)).toBe(true);
  });

  it('a send carrying the other install\'s id is decided by the id, never by the list', async () => {
    const storage = memoryStorage();
    await rememberReportSentHere(ipadSend.deliveredAt as string, storage);
    expect(await reportSnapshotSentHere({ ...ipadSend, sentBy: 'ipad-install-id-0123456789' }, storage)).toBe(false);
  });

  it('the list keeps the last 50 sends, each once', async () => {
    const storage = memoryStorage();
    const times = Array.from({ length: 55 }, (_, index) => new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString());
    for (const time of times) await rememberReportSentHere(time, storage);
    await rememberReportSentHere(times[54], storage);
    await rememberReportSentHere('not a time', storage);
    const kept = JSON.parse(storage.map.get(OWN_SENDS_KEY) as string) as string[];
    expect(kept).toEqual(times.slice(5));
    const sent = (deliveredAt: string) => ({ ...ipadSend, deliveredAt }) as DAVEReportSnapshot;
    expect(await reportSnapshotSentHere(sent(times[4]), storage)).toBe(false);
    expect(await reportSnapshotSentHere(sent(times[5]), storage)).toBe(true);
  });
});
