/**
 * Whole-app audit A7 pass 12 M-1 (A4 pass 14 #1), 30 Sep 2026: Review
 * Conflicts, the only way into conflict review, showed only when nothing
 * was pending, and only once Settings' status read had landed, which waited
 * for the cloud check (and never landed when that timed out). With an update
 * in conflict and anything else waiting, Settings offered only Retry Sync,
 * and Sync Now's "1 saved conflict needs review" pointed at a button that
 * was not there. It now shows whenever a conflict is saved on this phone,
 * read without waiting for the cloud check. (Mocks and renderer as in
 * audit-a8-p2-admin-sync.test.tsx.)
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockSyncStatus = { queuedChanges: 1, conflicts: 1, recoveryAvailable: false, recoveryCopies: 0 };
const mockConflict = {
  id: 'conflict-u1', entity: 'project_update', localId: 'u1', localChangedAt: '2026-09-30T08:00:00.000Z',
  remoteChangedAt: '2026-09-30T09:00:00.000Z', reason: 'Remote update changed after the local pending change.',
  detectedAt: '2026-09-30T09:05:00.000Z',
  localPayload: { id: 'u1', projectName: 'Alpha', updateData: { id: 'u1', projectName: 'Alpha', notes: 'Phone note' } },
  remotePayload: { id: 'u1', projectName: 'Alpha', notes: 'iPad note' },
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
  getSupabaseConnectionStatus: jest.fn(async () => ({
    configured: true, clientReady: true, authenticated: true, userEmail: 'owner@example.com',
  })),
  testSupabaseConnection: jest.fn(async () => ({ connected: true })),
  subscribeToAuthStateChange: () => () => undefined,
  signIn: jest.fn(),
  signOut: jest.fn(),
  signUp: jest.fn(),
}));
jest.mock('../../services/SyncService', () => ({
  getSyncConflicts: jest.fn(async () => [mockConflict]),
  getSyncStatus: jest.fn(async () => mockSyncStatus),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  resolveProjectUpdateSyncConflict: jest.fn(),
  resolveScheduleItemSyncConflict: jest.fn(),
  projectUpdateCopyIsLastInCloud: jest.fn(() => true),
  synchronizeLocalData: jest.fn(async () => ({
    errors: [], uploaded: 0, missingPhotos: [], recovered: {},
    details: {
      cloudProjectsDownloaded: 1, cloudSchedulesDownloaded: 0, cloudUpdatesDownloaded: 1,
      cloudAreasDownloaded: 0, cloudDocumentsDownloaded: 0,
    },
  })),
  uploadPendingChanges: jest.fn(async () => ({ uploaded: 0, queued: 1 })),
}));

import { testSupabaseConnection } from '../../services/SupabaseService';
import { AdminScreen } from '../../screens/AdminScreen';

function renderAdmin() {
  return render(
    <AdminScreen
      localProjects={['Alpha']}
      savedUpdates={[]}
      projectAreas={[]}
      scheduleItems={[]}
      referenceDocuments={[]}
      displayName="David"
      onDisplayNameChange={jest.fn()}
      onBack={jest.fn()}
      onDiagnostics={jest.fn()}
      onBackup={jest.fn()}
      onRestore={jest.fn()}
      onAddArea={jest.fn(() => true)}
      onUpdateArea={jest.fn()}
      onDeleteArea={jest.fn()}
      onUseCurrentLocationForArea={jest.fn()}
      onRemoveMissingPhotos={jest.fn(async () => undefined)}
      onRetryUpdateSync={jest.fn(async () => ({ status: 'sent' }))}
      onRetryDocumentUploads={jest.fn(async () => ({ attempted: 0, uploaded: 0, remaining: 0 }))}
      failedDocumentCount={0}
      onApplyCloudConflictUpdate={jest.fn()}
      onApplyCloudConflictScheduleItem={jest.fn()}
      onApplyCloudRecovery={jest.fn()}
      onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );
}

describe('Review Conflicts shows whenever a conflict is saved on this phone (audit A7 pass 12 M-1)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('with another change still pending: Retry Sync and Review Conflicts are both offered', async () => {
    const screen = renderAdmin();
    await screen.findByText('1 item pending on this device');
    expect(screen.getByText('Retry Sync')).toBeTruthy();
    expect(screen.getByText('Review Conflicts')).toBeTruthy();
  });

  it('while the cloud check is still running (it may time out): the conflict saved here is offered for review', async () => {
    let finishCloudCheck: () => void = () => undefined;
    (testSupabaseConnection as jest.Mock).mockImplementationOnce(() => new Promise(resolve => {
      finishCloudCheck = () => resolve({ connected: true });
    }));
    const screen = renderAdmin();
    expect(await screen.findByText('Review Conflicts')).toBeTruthy();
    expect(screen.getByText('Checking…')).toBeTruthy(); // the cloud check has not answered
    await act(async () => { finishCloudCheck(); });
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
  });

  it('after Sync Now says a conflict needs review, the button it points to is there', async () => {
    const screen = renderAdmin();
    await screen.findByText('1 item pending on this device');
    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });
    expect(await screen.findAllByText('Cloud sync finished, but 1 saved conflict needs review.')).not.toHaveLength(0);
    expect(screen.getByText('Review Conflicts')).toBeTruthy();
  });
});
