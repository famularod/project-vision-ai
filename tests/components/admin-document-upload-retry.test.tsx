/**
 * Whole-app audit A8 pass 1 F5 (30 Sep 2026): Settings left out the
 * documents whose file never uploaded, and Sync Now sent none of them. They
 * are counted as pending, named in the sign-out warning, and uploaded first
 * by Sync Now and Retry Sync.
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

describe('Settings counts and uploads documents saved without signal (audit A8 pass 1 F5)', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('counts them with the queued changes as pending on this phone', async () => {
    const { screen } = renderAdmin({ failedDocumentCount: 2 });
    expect(await screen.findByText('3 items pending on this device')).toBeTruthy();
    expect(screen.getByText('Retry Sync')).toBeTruthy();
  });

  it('names them in the sign-out warning, which says they sync after signing in again', async () => {
    const { screen } = renderAdmin({ failedDocumentCount: 2 });
    fireEvent.press(await screen.findByText('Sign Out'));
    // Owner answer Q21 (30 Sep 2026): the same warning, first, now followed by
    // what each of the two Sign Out choices does.
    expect(Alert.alert).toHaveBeenCalledWith(
      'Sign Out',
      expect.stringMatching(/^3 items are not in the cloud yet\. They stay on this phone and sync after you sign in here again with this account\. Sign out anyway\?\n\nThis Device: /),
      expect.any(Array),
    );
  });

  it('Sync Now uploads the documents before it syncs, and says when one is still waiting', async () => {
    const onRetryDocumentUploads = jest.fn(async () => {
      mockCalls.push('documents');
      return { attempted: 2, uploaded: 1, remaining: 1 };
    });
    const { screen } = renderAdmin({ failedDocumentCount: 2, onRetryDocumentUploads });
    await screen.findByText('3 items pending on this device');
    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });
    await waitFor(() => expect(mockCalls).toEqual(['documents', 'synchronizeLocalData']));
    expect(onRetryDocumentUploads).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText(/1 document saved on this phone has not uploaded yet; it retries automatically\./))
      .not.toHaveLength(0);
  });

  it('Retry Sync uploads the documents first and does not report success while one remains', async () => {
    const onRetryDocumentUploads = jest.fn(async () => {
      mockCalls.push('documents');
      return { attempted: 1, uploaded: 0, remaining: 1 };
    });
    const { screen } = renderAdmin({ failedDocumentCount: 1, onRetryDocumentUploads });
    await screen.findByText('2 items pending on this device');
    await act(async () => {
      fireEvent.press(screen.getByText('Retry Sync'));
    });
    await waitFor(() => expect(mockCalls).toEqual(['documents', 'uploadPendingChanges']));
    expect(await screen.findAllByText('1 item still needs attention. It remains saved on this phone.'))
      .not.toHaveLength(0);
  });
});
