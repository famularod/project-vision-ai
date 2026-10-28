/**
 * Open item 2.76 (15 Oct 2026, Build 233, simulated iPhone): opened after ~4 hours switched off, the phone's report
 * ran on its old records ("Test fence was removed from the current project plan", -1 completed) with Approve, and
 * Settings said "Cloud sync: All caught up", until Sync Now. The report counted from this device's own send, so the
 * rule for the other device's send (A6 pass 10) did not hold it. Now, until this device has downloaded every record
 * since it was opened (or came back), approval waits, saying why, and Settings says it is downloading.
 * Made-up data only; the rig is audit-a6-p10-two-device-report's.
 */
/** Each simulated device has its own app storage and Keychain; one shared fake cloud stands in for report_snapshots. */
const mockDevices = new Map<string, Map<string, string>>();
const mockKeychains = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockStore = (stores: Map<string, Map<string, string>>) => {
  if (!stores.has(mockDevice)) stores.set(mockDevice, new Map());
  return stores.get(mockDevice) as Map<string, string>;
};
/**
 * R6 item 2 (the coordinator's decision): the storage, Keychain and cloud calls the app has started and has had no
 * answer to yet, and how many it has started in all. The rig waits until none is under way before another device
 * is picked up (`screenAtRest`, below).
 */
let mockCallsUnderWay = 0;
let mockCallsStarted = 0;
function mockCounted<A extends unknown[], R>(call: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    mockCallsStarted += 1;
    mockCallsUnderWay += 1;
    try {
      return await call(...args);
    } finally {
      mockCallsUnderWay -= 1;
    }
  };
}
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(mockCounted(async (key: string) => mockStore(mockDevices).get(key) ?? null)),
  setItem: jest.fn(mockCounted(async (key: string, value: string) => {
    mockStore(mockDevices).set(key, value);
  })),
  removeItem: jest.fn(mockCounted(async (key: string) => {
    mockStore(mockDevices).delete(key);
  })),
  getAllKeys: jest.fn(mockCounted(async () => Array.from(mockStore(mockDevices).keys()))),
  multiGet: jest.fn(mockCounted(async (keys: string[]) => keys.map(key => [key, mockStore(mockDevices).get(key) ?? null]))),
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(mockCounted(async (key: string) => mockStore(mockKeychains).get(key) ?? null)),
  setItemAsync: jest.fn(mockCounted(async (key: string, value: string) => {
    mockStore(mockKeychains).set(key, value);
  })),
  deleteItemAsync: jest.fn(mockCounted(async (key: string) => {
    mockStore(mockKeychains).delete(key);
  })),
}));

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
let mockCloudDown = false;
const mockCloud = new Map<string, MockCloudRow>();
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(mockCounted(async (scopeKey: string, format: string) => (mockCloudDown
    ? { ok: false, configured: true, data: null, error: 'Network request failed' }
    : mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null })))),
  // The table's rule: a row whose period started from a later send is kept.
  saveReportSnapshotCloud: jest.fn(mockCounted(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    const key = `${row.scopeKey}|${row.format}`;
    const existing = mockCloud.get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return mockOk(null);
    mockCloud.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return mockOk(null);
  })),
  // What Settings reads, for Sync Now (A6 pass 11 L1; as in audit-a8-p2-admin-sync).
  getCurrentSessionAccessToken: jest.fn(async () => null),
  getSupabaseConfigurationStatus: () => ({ configured: true }),
  getSupabaseConnectionStatus: jest.fn(async () => ({
    configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com',
  })),
  testSupabaseConnection: jest.fn(async () => ({ connected: true })),
  subscribeToAuthStateChange: () => () => undefined,
  readSavedSignIn: jest.fn(async () => null),
  signIn: jest.fn(),
  signOut: jest.fn(),
  signUp: jest.fn(),
}));
// Settings › Sync Now's download, with no network (A6 pass 11 L1): each test says what comes down.
const mockSynchronizeLocalData = jest.fn();
jest.mock('../../services/SyncService', () => ({
  ...jest.requireActual('../../services/SyncService'),
  getSyncConflicts: jest.fn(async () => []),
  getSyncStatus: jest.fn(async () => ({ queuedChanges: 0, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 })),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  synchronizeLocalData: (...args: unknown[]) => mockSynchronizeLocalData(...args),
}));

let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { Alert, AppState } from 'react-native';
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
  noteDeviceCloudPullNeeded,
  recordDeviceCloudPull,
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import { AdminScreen } from '../../screens/AdminScreen';
import type { ScheduleItem } from '../../types';
import { pressSettingsSyncNow, syncNowResult } from '../fixtures/settings-sync-now';

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
/**
 * `device`'s background refresh downloads every task from the cloud, started
 * `at` (now). Settings › Sync Now is run for real (`syncNow`): pass 10 stood
 * in for it here, which hid that Sync Now recorded no download (A6 pass 11 L1).
 */
const downloadsTasks = async (device: string, at = new Date().toISOString()) => {
  const was = mockDevice;
  onDevice(device);
  await act(async () => {
    await recordScheduleCloudPull(at);
  });
  onDevice(was);
};

/**
 * Settings › Sync Now on the phone, through AdminScreen and App.tsx's own
 * onApplyCloudRecovery (A6 pass 11 L1): `cloud` is every task that comes
 * down, with the deletion history verified. Returns the phone's tasks after.
 */
const syncNow = async (scheduleItems: ScheduleItem[], cloud: ScheduleItem[]) => {
  onDevice('phone');
  mockSynchronizeLocalData.mockImplementation(async () => syncNowResult(cloud));
  const phone = { scheduleItems };
  await pressSettingsSyncNow(phone);
  return phone.scheduleItems;
};

/**
 * R6 item 2 (the coordinator's decision; a race in this rig, never in the app; the same rig as
 * audit-a6-p8-period-bound-approval, where it was seen and reproduced). One process plays both devices: while the
 * iPad is used the app's memory and the device's storage are the iPad's, and the phone's screen stays mounted. What
 * the phone's last action started could still be finishing when the iPad was picked up, and the phone's screen then
 * drew itself with the iPad's memory.
 *
 * Before another device is picked up, the screen that is mounted has finished: no storage, Keychain or cloud call
 * of the app is under way, the screen has drawn what came back, and drawing it started no further call. Nothing is
 * waited for by the clock.
 */
async function screenAtRest(): Promise<void> {
  for (let round = 0; round < 100; round += 1) {
    await waitFor(() => expect(mockCallsUnderWay).toBe(0), SLOW);
    const started = mockCallsStarted;
    await settle();
    if (mockCallsUnderWay === 0 && mockCallsStarted === started) return;
  }
  throw new Error('The screen never came to rest: it kept starting storage, Keychain or cloud calls.');
}

async function keepingPhoneMemory<T>(visit: () => Promise<T>): Promise<T> {
  await screenAtRest();
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
  mockCloudDown = false;
  onDevice('phone');
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSynchronizeLocalData.mockReset();
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
/**
 * Open item 7.61: the report this device sent last for the period, the same report, shows as sent here (Share Report
 * there, no Approve Report), after a relaunch too. Waits for it.
 */
const shownAsSentHere = async () => {
  await screen.findByText(/^This device sent this report /, {}, SLOW);
  expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Approve Report' })).toBeNull();
};
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
  if (!screen.queryByText(/SINCE THE LAST REPORT/)) {
    fireEvent.press(await screen.findByRole('button', { name: 'Full written report' }, SLOW));
  }
  const body = (await screen.findByText(/SINCE THE LAST REPORT/, {}, SLOW)).props.children as string;
  const start = body.indexOf('SINCE THE LAST REPORT');
  return body.slice(start, body.indexOf('COMPLETED WORK', start));
};
const loaded = async () => {
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull(), SLOW);
  await settle();
};

const task276 = (id: string, taskName: string, percentComplete: number) => ({
  ...task(id, taskName, percentComplete >= 100), projectName: 'Tower', percentComplete,
  status: percentComplete >= 100 ? 'Complete' : 'In Progress',
}) as unknown as ScheduleItem;
/** What the phone sent at 9:17 (Test fence complete). */
const MORNING = [task276('paint', 'Test paint', 70), task276('trim', 'Test trim', 20), task276('fence', 'Test fence', 100)];
/** Opened at 13:30 before its download: the rows it kept, Test fence's not among them (a schedule switch half seen). */
const STALE = [task276('paint', 'Test paint', 70), task276('trim', 'Test trim', 20)];
/** The cloud's records, once downloaded: the new full schedule's row for the gate too. */
const CLOUD = [...MORNING, task276('gate', 'Test gate', 0)];
const WAITS = "This device is still downloading your other devices' latest changes. " +
  'Approval waits until they are here; Settings › Sync Now gets them now.';

/** The phone, opened again (a new app session): the app asks for a download first, then Reports opens. */
const reopenPhone = (scheduleItems: ScheduleItem[]) => {
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  onDevice('phone');
  noteDeviceCloudPullNeeded();
  return mount(scheduleItems);
};

describe('opened after time away, approval waits for this device\'s download of every record (2.76)', () => {
  it('the report on the old records ("Test fence was removed") is not approvable until the download lands', async () => {
    await downloadsTasks('phone');
    const morning = open('phone', MORNING);
    await approveAndSend();
    await screenAtRest();
    morning.unmount();

    const phone = reopenPhone(STALE);
    await loaded();
    await screenAtRest();
    // What the simulator showed; the rule for the other device's send does not apply (the phone sent it).
    expect(await period()).toMatch(/Test fence was removed from the current project plan/);
    expect(screen.queryByText(/hasn't received your other device's latest changes/)).toBeNull();
    expect(approveButtonDisabled()).toBe(true);
    expect(screen.getAllByText(WAITS).length).toBeGreaterThan(0);

    // The download of every record lands.
    await act(async () => { recordDeviceCloudPull(new Date().toISOString()); });
    phone.rerender(reportsScreen(CLOUD));
    await approvable();
    expect(screen.queryByText(WAITS)).toBeNull();
    expect(await period()).not.toMatch(/Test fence was removed/);
  });

  it('offline (the other device\'s last report could not be checked) approval is not held, as before', async () => {
    await downloadsTasks('phone');
    const morning = open('phone', MORNING);
    await approveAndSend();
    await screenAtRest();
    morning.unmount();

    mockCloudDown = true;
    reopenPhone(STALE);
    await loaded();
    await approvable();
    expect(screen.queryByText(WAITS)).toBeNull();
  });
});

describe('Settings says "All caught up" only once every record has come down (2.76)', () => {
  const settings = () => render(
    <AdminScreen
      localProjects={['Tower']} savedUpdates={[]} projectAreas={[]} scheduleItems={STALE} referenceDocuments={[]}
      displayName="David" onDisplayNameChange={jest.fn()} onBack={jest.fn()} onDiagnostics={jest.fn()}
      onBackup={jest.fn()} onRestore={jest.fn()} onAddArea={jest.fn(() => true)} onUpdateArea={jest.fn()}
      onDeleteArea={jest.fn()} onUseCurrentLocationForArea={jest.fn()}
      onRemoveMissingPhotos={jest.fn(async () => undefined)} onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))}
      onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
      failedDocumentCount={0}
      onApplyCloudConflictUpdate={jest.fn()} onApplyCloudConflictScheduleItem={jest.fn()}
      onApplyCloudRecovery={jest.fn()} onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );

  it('opened and not downloaded yet: "Downloading your other devices\' changes"; the refresh landing: "All caught up"', async () => {
    noteDeviceCloudPullNeeded();
    const view = settings();
    views.push(view);
    expect(await screen.findByText("Downloading your other devices' changes", {}, SLOW)).toBeTruthy();
    expect(screen.queryByText('All caught up')).toBeNull();
    await act(async () => { recordDeviceCloudPull(new Date().toISOString()); });
    expect(await screen.findByText('All caught up', {}, SLOW)).toBeTruthy();
  });

  it('Sync Now that brings every record down ends it too; one that could not verify deletions does not', async () => {
    noteDeviceCloudPullNeeded();
    const view = settings();
    views.push(view);
    await screen.findByText("Downloading your other devices' changes", {}, SLOW);
    const result = (errors: Record<string, string | null>) => ({
      ...syncNowResult(CLOUD), errors: [],
      recovered: { ...syncNowResult(CLOUD).recovered, collectionErrors: errors },
    });
    const none = { projects: null, updates: null, projectAreas: null, scheduleItems: null, referenceDocuments: null };
    mockSynchronizeLocalData.mockImplementation(async () => result({ ...none, scheduleItems: 'Deletion history could not be verified.' }));
    fireEvent.press(screen.getByText('Sync Now'));
    await waitFor(() => expect(screen.queryByText('Syncing…')).toBeNull(), SLOW);
    // N276b F4: not "Downloading" once a download has failed.
    expect(screen.getByText("Could not download your other devices' changes yet; Sync Now to retry")).toBeTruthy();

    mockSynchronizeLocalData.mockImplementation(async () => result(none));
    fireEvent.press(screen.getByText('Sync Now'));
    expect(await screen.findByText('All caught up', {}, SLOW)).toBeTruthy();
  });
});
