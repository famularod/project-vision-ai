/**
 * Whole-app audit A8 pass 2 #6 (30 Sep 2026): a slow document upload held
 * back Retry Sync and Sync Now. Retry Sync uploaded the documents first and
 * gave up after 30 seconds without retrying the queued field updates; Sync
 * Now waited for every upload before the data sync. Both now start the
 * document uploads, carry on at once, and count what is still uploading at
 * the end. (Mocks and renderer as in admin-document-upload-retry.test.tsx.)
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockSyncStatus = { queuedChanges: 1, conflicts: 0, recoveryAvailable: false, recoveryCopies: 0 };
const mockCalls: string[] = [];

// Settings now reads this account's field notes for the Sign Out warning
// (whole-app audit A11 pass 4 L5); none are on this phone here.
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
  getSyncConflicts: jest.fn(async () => []),
  getSyncStatus: jest.fn(async () => mockSyncStatus),
  reconcileSyncConflicts: jest.fn(async () => undefined),
  resolveProjectUpdateSyncConflict: jest.fn(),
  resolveScheduleItemSyncConflict: jest.fn(),
  synchronizeLocalData: jest.fn(async () => {
    mockCalls.push('synchronizeLocalData');
    return {
      errors: [],
      uploaded: 1,
      missingPhotos: [],
      recovered: {},
      details: {
        cloudProjectsDownloaded: 1, cloudSchedulesDownloaded: 0, cloudUpdatesDownloaded: 0,
        cloudAreasDownloaded: 0, cloudDocumentsDownloaded: 1,
      },
    };
  }),
  uploadPendingChanges: jest.fn(async () => {
    mockCalls.push('uploadPendingChanges');
    return { uploaded: 1, queued: 0 };
  }),
}));

import { AdminScreen } from '../../screens/AdminScreen';

function renderAdmin(props: {
  failedDocumentCount: number;
  onRetryDocumentUploads?: jest.Mock;
}) {
  const onRetryDocumentUploads = props.onRetryDocumentUploads || jest.fn(async () => {
    mockCalls.push('documents');
    return { attempted: 0, uploaded: 0, remaining: 0 };
  });
  const screen = render(
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
      onRetryDocumentUploads={onRetryDocumentUploads}
      failedDocumentCount={props.failedDocumentCount}
      onApplyCloudConflictUpdate={jest.fn()}
      onApplyCloudConflictScheduleItem={jest.fn()}
      onApplyCloudRecovery={jest.fn()}
      onSaveCaptureMemory={jest.fn(async () => undefined)}
    />,
  );
  return { screen, onRetryDocumentUploads };
}

describe('a slow document upload no longer holds back Retry Sync or Sync Now (audit A8 pass 2 #6)', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  // Uploading, and not finished while the sync runs; the document is
  // 'uploading' on the phone, so it is not among those waiting.
  const stillUploading = () => jest.fn(() => {
    mockCalls.push('documents');
    return new Promise<never>(() => undefined);
  });

  it('Retry Sync retries the queue at once and counts the document still uploading', async () => {
    const onRetryDocumentUploads = stillUploading();
    const { screen } = renderAdmin({ failedDocumentCount: 0, onRetryDocumentUploads });
    await screen.findByText('1 item pending on this device');
    await act(async () => {
      fireEvent.press(screen.getByText('Retry Sync'));
    });
    await waitFor(() => expect(mockCalls).toEqual(['documents', 'uploadPendingChanges']));
    expect(await screen.findAllByText('1 item still needs attention. It remains saved on this phone.'))
      .not.toHaveLength(0);
    expect(screen.queryAllByText(/taking longer than expected/)).toHaveLength(0);
  });

  it('Sync Now runs the data sync without waiting and says the document is still to upload', async () => {
    const onRetryDocumentUploads = stillUploading();
    const { screen } = renderAdmin({ failedDocumentCount: 0, onRetryDocumentUploads });
    await screen.findByText('1 item pending on this device');
    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });
    await waitFor(() => expect(mockCalls).toEqual(['documents', 'synchronizeLocalData']));
    expect(await screen.findAllByText(/1 document saved on this phone has not uploaded yet; it retries automatically\./))
      .not.toHaveLength(0);
  });

  it('a run that has finished gives its own count', async () => {
    const { startProjectDocumentUploadRun } = jest.requireActual('../../services/ProjectDocumentUploadRetry') as typeof import('../../services/ProjectDocumentUploadRetry');
    const finished = startProjectDocumentUploadRun(async () => ({ attempted: 2, uploaded: 2, remaining: 0 }));
    const failed = startProjectDocumentUploadRun(() => Promise.reject(new Error('no')));
    const thrown = startProjectDocumentUploadRun(() => { throw new Error('no'); });
    const going = startProjectDocumentUploadRun(() => new Promise(() => undefined));
    await new Promise(resolve => setImmediate(resolve));
    expect(finished.remaining(5)).toBe(0);
    expect(failed.remaining(3)).toBe(3);
    expect(thrown.remaining(3)).toBe(3);
    expect(going.remaining(3)).toBe(4);
  });
});
