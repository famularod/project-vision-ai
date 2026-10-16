/**
 * N761d (open item 7.61, 15 Oct 2026), on the screen: Settings > Support > "Report check details" on the iPhone and
 * iPad. It copies, to this device's clipboard ONLY, the text of the report last opened in Reports (what that screen's
 * fingerprint is worked out from: services/DAVEReportCheckDetails.ts), to compare with the computer's Reports >
 * Review & Prepare Report > Details. It reads nothing from the cloud, sends nothing, writes nothing on the device.
 * Mocks and renderer as in s1b-2-30-settings-field-update-check.test.tsx. Synthetic data.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockClipboard = { setStringAsync: jest.fn(async (_text: string) => true) };
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockClipboard.setStringAsync(text) }));
const mockSyncStatus = { queuedChanges: 0, heldForConflictReview: 0, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 };
const mockCloud = {
  updates: { ok: true, configured: true, data: [{ id: 'u-A' }], status: 200 } as Record<string, unknown>,
  deletions: { ok: true, configured: true, data: [] as unknown[], status: 200 } as Record<string, unknown>,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiRemove: jest.fn(async () => undefined),
}));
jest.mock('../../services/SupabaseService', () => ({
  getCurrentSessionAccessToken: jest.fn(async () => null),
  getSupabaseConfigurationStatus: () => ({ configured: true }),
  getSupabaseConnectionStatus: jest.fn(async () => ({ configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com' })),
  testSupabaseConnection: jest.fn(async () => ({ connected: true })),
  subscribeToAuthStateChange: () => () => undefined,
  signIn: jest.fn(), signOut: jest.fn(), signUp: jest.fn(),
  listProjectUpdates: jest.fn(async () => mockCloud.updates),
  listDAVESyncTombstonesForRecords: jest.fn(async () => mockCloud.deletions),
}));
jest.mock('../../services/SyncService', () => ({
  getSyncConflicts: jest.fn(async () => []),
  getSyncStatus: jest.fn(async () => mockSyncStatus),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  resolveProjectUpdateSyncConflict: jest.fn(),
  resolveScheduleItemSyncConflict: jest.fn(),
  synchronizeLocalData: jest.fn(),
  uploadPendingChanges: jest.fn(),
  getOfflineQueue: jest.fn(async () => []),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AdminScreen } from '../../screens/AdminScreen';
import * as Supabase from '../../services/SupabaseService';
import * as Sync from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEReportCheckDetails, forgetDAVEReportCheckInput, holdDAVEReportCheckInput, type DAVEReportCheckInput } from '../../services/DAVEReportCheckDetails';
import type { ScheduleItem } from '../../types';

const update = (id: string, status: ProjectUpdate['status'], notes: string) => ({
  id, projectName: 'Alpha', date: '2026-09-22T15:30:00.000Z', photos: [], notes, recipients: { contactIds: [] }, status,
}) as ProjectUpdate;
const ROW = 'Report check details';

/** Settings as it opens, its own first reads (status, conflicts) settled. */
async function renderAdmin(savedUpdates: ProjectUpdate[]) {
  const screen = render(
    <AdminScreen
      localProjects={['Alpha']} savedUpdates={savedUpdates} projectAreas={[]} scheduleItems={[]} referenceDocuments={[]}
      displayName="David" onDisplayNameChange={jest.fn()} onBack={jest.fn()} onDiagnostics={jest.fn()} onBackup={jest.fn()}
      onRestore={jest.fn()} onAddArea={jest.fn(() => true)} onUpdateArea={jest.fn()} onDeleteArea={jest.fn()}
      onUseCurrentLocationForArea={jest.fn()} onRemoveMissingPhotos={jest.fn(async () => undefined)}
      onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))} onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
      failedDocumentCount={0} onApplyCloudConflictUpdate={jest.fn()} onApplyCloudConflictScheduleItem={jest.fn()}
      onApplyCloudRecovery={jest.fn()} onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return screen;
}

/** What the Reports screen holds for Alpha: its truths, the period (none: a first report) and the format. */
function heldForAlpha(format: DAVEReportCheckInput['format'] = 'project_manager'): DAVEReportCheckInput {
  const task = {
    id: 'frame', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Level 2', taskName: 'Frame walls', startDate: '09/01/2026', finishDate: '10/30/2026',
    milestone: '', owner: 'Dana', contractor: 'Acme', percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: 'Call dana@example.com', createdAt: '2026-09-01T12:00:00.000Z',
  } as unknown as ScheduleItem;
  const updates = [{ ...update('u-A', 'sent', 'Framing at the stair'), scheduleItemId: 'frame', scheduleTaskName: 'Frame walls', selectedAreaName: 'Level 2' } as ProjectUpdate];
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }],
    projectRecords: [{ name: 'Alpha' }] as never,
    updates: updates as never,
    scheduleItems: [task],
    knownScheduleItems: [task],
    projectAreas: [],
    referenceDocuments: [],
    drawingDocuments: [],
  } as never);
  return { truths, period: null, format, periodState: 'read', shared: 'checked' };
}

describe('N761d: Settings > "Report check details" (to the clipboard only)', () => {
  let fetchSpy: jest.Mock;
  let realFetch: unknown;
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockClipboard.setStringAsync.mockReset();
    mockClipboard.setStringAsync.mockImplementation(async () => true);
    forgetDAVEReportCheckInput();
    realFetch = (globalThis as any).fetch;
    fetchSpy = jest.fn();
    (globalThis as any).fetch = fetchSpy;
  });
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    forgetDAVEReportCheckInput();
    cleanup();
    jest.restoreAllMocks();
  });

  /** Every call Settings could make to the cloud, to sync, or to the device's storage: counted before and after the tap. */
  const outside = () => [
    ...Object.values(Supabase).filter(fn => jest.isMockFunction(fn)).map(fn => (fn as jest.Mock).mock.calls.length),
    ...Object.values(Sync).filter(fn => jest.isMockFunction(fn)).map(fn => (fn as jest.Mock).mock.calls.length),
    ...['setItem', 'removeItem', 'multiRemove'].map(name => ((AsyncStorage as any)[name] as jest.Mock).mock.calls.length),
  ];

  it('copies the held report\'s text to the clipboard, and nothing else: no cloud, no sync, no device write, no network', async () => {
    const held = heldForAlpha();
    holdDAVEReportCheckInput(held);
    const screen = await renderAdmin([update('u-A', 'sent', 'Framing at the stair')]);
    const before = outside();
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(mockClipboard.setStringAsync).toHaveBeenCalledTimes(1);
    const text = mockClipboard.setStringAsync.mock.calls[0][0] as string;
    expect(text).toBe(buildDAVEReportCheckDetails(held));
    expect(text).toMatch(/^REPORT CHECK DETAILS \(report-check\/1\)/);
    expect(text).toContain('\nparts make the fingerprint: yes\n');
    expect(text).toContain('projects."alpha".schedule[taskId=frame].percentComplete = 40');
    expect(text).not.toContain('dana@example.com');
    expect(outside()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith('Report check details copied', `Alpha · Project Manager · ${text.split('\n').length} lines. Copied to this device only; nothing was sent.`);
  });

  it('the Executive format is named', async () => {
    holdDAVEReportCheckInput(heldForAlpha('executive'));
    const screen = await renderAdmin([]);
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(mockClipboard.setStringAsync.mock.calls[0][0]).toContain('\nformat: executive\n');
    expect(Alert.alert).toHaveBeenLastCalledWith('Report check details copied', expect.stringMatching(/^Alpha · Executive Summary · \d+ lines\. Copied to this device only; nothing was sent\.$/));
  });

  it('nothing held yet (Reports not opened since the app started): says to open Reports first, and copies nothing', async () => {
    const screen = await renderAdmin([]);
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(mockClipboard.setStringAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith('Open Reports first', 'Open Reports, choose the project and the report format, then come back here and tap Report check details again.');
  });

  it('a copy that fails says so, in plain words', async () => {
    holdDAVEReportCheckInput(heldForAlpha());
    mockClipboard.setStringAsync.mockImplementation(async () => { throw new Error('denied'); });
    const screen = await renderAdmin([]);
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(Alert.alert).toHaveBeenLastCalledWith('Not copied', 'The details could not be copied to the clipboard. Try again.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
