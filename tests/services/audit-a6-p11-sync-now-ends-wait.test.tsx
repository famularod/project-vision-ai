// Whole-app audit A6 pass 11 L1 (30 Sep 2026), on pass 10 M1, M2 (a device
// that has not downloaded the tasks since the other device's send waits).
//
// The waiting message says "Use Settings › Sync Now, then review.", but Sync
// Now recorded no download: only the background refresh did, and only when
// its deletion-history read came back within eight seconds. On weak signal
// that read is slower, the refresh records nothing, and Sync Now could not
// end the wait however often David pressed it. Pass 10's test stood in for
// Sync Now by recording a download directly, which hid it.
//
// Now: when Sync Now applies the tasks with a verified deletion history, it
// records the time Sync Now started. Run here through AdminScreen's own Sync
// Now button and App.tsx's own onApplyCloudRecovery closure, with the app's
// own download request (the background refresh) doing nothing.

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
  multiRemove: jest.fn(async () => undefined),
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
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    const key = `${row.scopeKey}|${row.format}`;
    const existing = mockCloud.get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return mockOk(null);
    mockCloud.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return mockOk(null);
  }),
  // What Settings reads (as in audit-a8-p2-admin-sync).
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
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import {
  forgetScheduleCloudPullSession,
  lastScheduleCloudPull,
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import { pressSettingsSyncNow, syncNowResult } from '../fixtures/settings-sync-now';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const onDevice = (device: string) => {
  mockDevice = device;
};
const local = (device: string) => {
  const raw = mockDevices.get(device)?.get(KEY);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager');

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
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const morningPlan = [task('frame', 'Frame walls', false), task('roof', 'Set roof', false)];
const ipadPlan = [task('frame', 'Frame walls', true), task('roof', 'Set roof', false)];
/** After the morning report David moved Set roof to Eli on the phone, before its sync. */
const toEli = (plan: ScheduleItem[]) =>
  plan.map(item => item.id === 'roof' ? { ...item, owner: 'Eli', updatedAt: new Date().toISOString() } as ScheduleItem : item);

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
    onCopyReport={async () => 'completed'}
    onEmailReport={async () => 'completed'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

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

/** The phone sends the morning report; the iPad, synced, completes Frame walls and sends at midday. */
async function ipadSentAtMidday() {
  onDevice('phone');
  await recordScheduleCloudPull(new Date().toISOString());
  const phone = render(reportsScreen(morningPlan));
  await approveAndSend();
  phone.unmount();

  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  onDevice('ipad');
  await recordScheduleCloudPull(new Date().toISOString());
  const ipad = render(reportsScreen(ipadPlan));
  await approveAndSend();
  const sent = local('ipad') as DAVEReportSnapshot;
  await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
  ipad.unmount();

  // The phone, a new app session, has not downloaded since its morning report.
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  onDevice('phone');
  return sent;
}

let unregisterPullRequest: () => void = () => undefined;
beforeEach(() => {
  mockDevices.clear();
  mockKeychains.clear();
  mockCloud.clear();
  onDevice('phone');
  forgetAllReportSessionState();
  forgetScheduleCloudPullSession();
  mockSynchronizeLocalData.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
  // The background refresh on weak signal: its deletion-history read takes
  // over eight seconds, comes back unverified, and records no download.
  unregisterPullRequest = registerScheduleCloudPullRequest(() => undefined);
});
afterEach(() => {
  unregisterPullRequest();
  jest.restoreAllMocks();
});

describe('Settings › Sync Now ends the wait it tells David to use it for (A6 pass 11 L1)', () => {
  it('the refresh records nothing on weak signal; Sync Now downloads every task and the report is counted again', async () => {
    const midday = await ipadSentAtMidday();
    const phone = { scheduleItems: toEli(morningPlan) };
    const reports = render(reportsScreen(phone.scheduleItems));
    await loaded();
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
    reports.unmount();

    // Off to Settings › Sync Now: the phone's change goes up, and every task
    // and the deletion history come down (the iPad's Frame walls with it).
    const cloud = toEli(ipadPlan);
    mockSynchronizeLocalData.mockImplementation(async () => syncNowResult(cloud));
    const startedBefore = Date.now();
    await pressSettingsSyncNow(phone);
    expect(mockSynchronizeLocalData).toHaveBeenCalledTimes(1);
    expect(phone.scheduleItems.find(item => item.id === 'frame')?.status).toBe('Complete');

    // Back on Reports: nothing held, counted from the iPad's report.
    render(reportsScreen(phone.scheduleItems));
    await approvable();
    expect(screen.queryByText(/hasn't received your other device's latest changes/)).toBeNull();
    const counted = await period();
    expect(counted).not.toContain('Not counted yet');
    expect(counted).toContain('Tower: Set roof owner changed from Dana to Eli.');
    expect(counted).not.toMatch(/reopened|Frame walls was completed/);
    expect(Date.parse(await lastScheduleCloudPull() as string)).toBeGreaterThanOrEqual(startedBefore);
  });

  it('a Sync Now whose deletion history could not be verified applies no tasks and still waits', async () => {
    const midday = await ipadSentAtMidday();
    const before = toEli(morningPlan);
    const phone = { scheduleItems: before };
    const morningDownload = await lastScheduleCloudPull();
    mockSynchronizeLocalData.mockImplementation(async () => syncNowResult(toEli(ipadPlan), 'unverified'));
    await pressSettingsSyncNow(phone);
    expect(phone.scheduleItems).toBe(before);
    expect(await lastScheduleCloudPull()).toBe(morningDownload);

    render(reportsScreen(phone.scheduleItems));
    await loaded();
    expect(screen.getByText(deviceBehind(midday))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
  });

  it('the time recorded is when Sync Now started: a send made while it ran is still waited for', async () => {
    onDevice('phone');
    await recordScheduleCloudPull(new Date(Date.now() - 60 * 60_000).toISOString());
    const morning = render(reportsScreen(morningPlan));
    await approveAndSend();
    morning.unmount();
    forgetAllReportSessionState();
    forgetScheduleCloudPullSession();

    // Sync Now starts on the phone; while it runs, the iPad sends at midday.
    const phone = { scheduleItems: morningPlan };
    let releaseDownload: () => void = () => undefined;
    // What the phone downloads was read before the iPad's change reached the cloud.
    const download = new Promise<void>(resolve => {
      releaseDownload = resolve;
    }).then(() => syncNowResult(morningPlan));
    mockSynchronizeLocalData.mockImplementation(() => download);
    let middaySend: DAVEReportSnapshot | null = null;
    const startedBefore = new Date().toISOString();
    await pressSettingsSyncNow(phone, async () => {
      onDevice('ipad');
      await recordScheduleCloudPull(new Date().toISOString());
      const ipad = render(reportsScreen(ipadPlan));
      await approveAndSend();
      const sent = local('ipad') as DAVEReportSnapshot;
      middaySend = sent;
      await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sent.deliveredAt), SLOW);
      ipad.unmount();
      // The phone's app session did not see the iPad's screen.
      forgetAllReportSessionState();
      forgetScheduleCloudPullSession();
      onDevice('phone');
      releaseDownload();
    });
    const recorded = await lastScheduleCloudPull();
    expect(recorded).not.toBeNull();
    expect(Date.parse(recorded as string)).toBeGreaterThanOrEqual(Date.parse(startedBefore));
    expect(Date.parse(recorded as string)).toBeLessThan(Date.parse((middaySend as unknown as DAVEReportSnapshot).deliveredAt as string));

    render(reportsScreen(phone.scheduleItems));
    await loaded();
    expect(screen.getByText(deviceBehind(middaySend as unknown as DAVEReportSnapshot))).toBeTruthy();
    expect(approveButtonDisabled()).toBe(true);
  });
});
