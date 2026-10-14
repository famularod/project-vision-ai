/**
 * Open item 2.30 (S1b, 14 Oct 2026), on the screen: Settings > Data & Sync > "Check field updates against the cloud"
 * on the iPhone and iPad. Read only: it reads the cloud only when he taps it (its list of field updates once, and
 * the deletion records only of those missing from it), sends nothing, changes nothing, and says what it found. Mocks
 * and renderer as in audit-a8-p2-admin-sync.test.tsx; the rule and the words are in
 * tests/services/s1b-2-30-field-update-cloud-check.test.ts. Synthetic data.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

const update = (id: string, status: ProjectUpdate['status'], notes: string) => ({
  id, projectName: 'Alpha', date: '2026-09-22T15:30:00.000Z', photos: [], notes, recipients: { contactIds: [] }, status,
}) as ProjectUpdate;
const ROW = 'Check field updates against the cloud';

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

describe('2.30: Settings > "Check field updates against the cloud" (read only)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockCloud.updates = { ok: true, configured: true, data: [{ id: 'u-A' }], status: 200 };
    mockCloud.deletions = { ok: true, configured: true, data: [], status: 200 };
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('reads nothing until he taps it; then lists the one the cloud does not hold, and sends and writes nothing', async () => {
    const screen = await renderAdmin([update('u-A', 'sent', 'Framing inspection passed'), update('u-B', 'sent', 'Poured the footings at the north wall today'), update('u-C', 'queued', 'Waiting one')]);
    screen.getByText(ROW);
    expect(Supabase.listProjectUpdates).not.toHaveBeenCalled();
    const writesBefore = (AsyncStorage.setItem as jest.Mock).mock.calls.length + (AsyncStorage.removeItem as jest.Mock).mock.calls.length;
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(await screen.findByText('This field update reads “Cloud Synced” on this device but is not in the cloud, and no deletion record names it. Nothing was sent or changed. Sync Now would send it; if it is an update you deleted on another device, delete it here first.')).toBeTruthy();
    const day = new Date('2026-09-22T15:30:00.000Z').getDate();
    expect(screen.getByText(`• ${day} Sep 2026 · Alpha · Poured the footings at the north wall today`)).toBeTruthy();
    expect(Supabase.listProjectUpdates).toHaveBeenCalledTimes(1);
    expect(Supabase.listDAVESyncTombstonesForRecords).toHaveBeenCalledWith('project_update', ['u-B']);
    expect([Sync.synchronizeLocalData, Sync.uploadPendingChanges].map(fn => (fn as jest.Mock).mock.calls.length)).toEqual([0, 0]);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length + (AsyncStorage.removeItem as jest.Mock).mock.calls.length).toBe(writesBefore);
    // Tapped again: one more look, no more.
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(Supabase.listProjectUpdates).toHaveBeenCalledTimes(2);
  });

  it('none found, and no signal, each in plain words', async () => {
    const screen = await renderAdmin([update('u-A', 'sent', 'Framing inspection passed')]);
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(await screen.findByText('The 1 field update on this device that reads “Cloud Synced” is in the cloud. Nothing was sent or changed.')).toBeTruthy();
    mockCloud.updates = { ok: false, configured: true, data: null, error: 'TypeError: Network request failed' };
    await act(async () => { fireEvent.press(screen.getByText(ROW)); });
    expect(await screen.findByText('The check could not run: the cloud could not be reached. This device may have no signal; try again when it has. Nothing was sent or changed.')).toBeTruthy();
  });
});
