import {
  markMissingPhotosUnavailable,
  projectUpdatePhotoStoragePath,
  projectPhotoPreviewTransform,
  projectUpdateWithCloudPhotoPaths,
  projectUpdateWithPhotoUploadReceipts,
  queueItemDAVETombstoneRecordId,
  queuedProjectDeletionBarriers,
  queueProjectCreate,
  queueProjectUpdate,
  queueProjectDelete,
  recoveredSignedPhotoUriIsFresh,
  cloudPhotoPreviewIsFresh,
  sanitizeUserFacingSyncMessage,
} from '../../services/SyncService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
}));

const syncStorage = new Map<string, string>();
const PROJECT_A_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_B_ID = '22222222-2222-4222-8222-222222222222';

function update(): ProjectUpdate {
  return {
    id: 'update 17',
    projectName: '2321 Compliance Project',
    date: '2026-07-17',
    notes: 'North Lot walk',
    recipients: { contactIds: [] },
    photos: [{
      id: 'photo 1',
      uri: 'file:///photo.heic',
      fileName: 'North Lot.heic',
      mimeType: 'image/heic',
      caption: '',
      category: 'Update',
      actionRequired: '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: 'Closed',
    }],
  };
}

describe('SyncService user-safe behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncStorage.clear();
    jest.mocked(AsyncStorage.getItem).mockImplementation(async key =>
      syncStorage.get(key) ?? null);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      syncStorage.set(key, value);
    });
    jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => {
      syncStorage.delete(key);
    });
    jest.mocked(AsyncStorage.getAllKeys).mockImplementation(async () =>
      [...syncStorage.keys()]);
    jest.mocked(AsyncStorage.multiGet).mockImplementation(async keys =>
      keys.map(key => [key, syncStorage.get(key) ?? null]));
  });

  it('persists project deletion queue authority as one exact id/name pair', async () => {
    await queueProjectDelete(PROJECT_A_ID, ' Shared Project ');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(`"projectId":"${PROJECT_A_ID}"`),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"name":"Shared Project"'),
    );
    await expect(queueProjectDelete('', 'Shared Project')).rejects.toThrow(
      /exact project ID and display name/i,
    );
    await expect(queueProjectDelete(PROJECT_A_ID, ' ')).rejects.toThrow(
      /exact project ID and display name/i,
    );
  });

  it('persists exact create/update authority and derives tombstone identity only from the UUID', async () => {
    await queueProjectCreate(PROJECT_A_ID, ' Shared Project ');
    await queueProjectUpdate({
      id: PROJECT_A_ID,
      previousName: 'Shared Project',
      archived: true,
    });

    const writes = jest.mocked(AsyncStorage.setItem).mock.calls.map(([, value]) => value);
    expect(writes.some(value => value.includes(`"id":"${PROJECT_A_ID}"`))).toBe(true);
    expect(writes.some(value => value.includes('"name":"Shared Project"'))).toBe(true);
    expect(queueItemDAVETombstoneRecordId({
      id: 'queue-create',
      entity: 'project',
      operation: 'create',
      payload: { id: PROJECT_A_ID, name: 'Shared Project' },
      createdAt: '2026-08-10T00:00:00.000Z',
      changedAt: '2026-08-10T00:00:00.000Z',
      retryCount: 0,
    })).toBe(PROJECT_A_ID);
    expect(queueItemDAVETombstoneRecordId({
      id: 'queue-legacy',
      entity: 'project',
      operation: 'update',
      payload: { previousName: 'Shared Project', archived: true },
      createdAt: '2026-08-10T00:00:00.000Z',
      changedAt: '2026-08-10T00:00:00.000Z',
      retryCount: 0,
    })).toBeNull();
    await expect(queueProjectCreate('project-shared-project', 'Shared Project'))
      .rejects.toThrow(/canonical project ID/i);
    await expect(queueProjectUpdate({ previousName: 'Shared Project', archived: true }))
      .rejects.toThrow(/canonical project ID/i);
  });

  it('keeps exact queued deletions out of the legacy name-wide startup barrier', () => {
    const item = (payload: Record<string, unknown>) => ({
      id: `queue-${String(payload.projectId || payload.name)}`,
      entity: 'project' as const,
      operation: 'delete' as const,
      payload,
      createdAt: '2026-08-10T00:00:00.000Z',
      changedAt: '2026-08-10T00:00:00.000Z',
      retryCount: 0,
    });
    expect(queuedProjectDeletionBarriers([
      item({ projectId: PROJECT_A_ID, name: 'Shared Project' }),
      item({ name: 'Historical Project' }),
    ])).toEqual({
      exactProjectIds: [PROJECT_A_ID],
      legacyProjectNames: ['Historical Project'],
    });
  });

  it('fails closed instead of treating a malformed supplied id as a legacy name barrier', () => {
    expect(() => queuedProjectDeletionBarriers([
      {
        id: 'delete-malformed',
        entity: 'project',
        operation: 'delete',
        payload: { projectId: ' project-a ', name: 'Shared Project' },
        createdAt: '2026-08-10T00:00:00.000Z',
        changedAt: '2026-08-10T00:00:00.000Z',
        retryCount: 0,
      },
    ])).toThrow('invalid project ID');
  });

  it('rejects name-only and cross-project cover mutations before queue persistence', async () => {
    await expect(queueProjectUpdate({
      previousName: 'Shared Project',
      data: {
        coverPhoto: null,
        coverPhotoMode: 'automatic',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
    })).rejects.toThrow(/exact project ID and storage path/i);

    await expect(queueProjectUpdate({
      id: PROJECT_A_ID,
      previousName: 'Shared Project',
      data: {
        coverPhoto: {
          remotePath: `project-covers/${PROJECT_B_ID}/cover.jpg`,
          mimeType: 'image/jpeg',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
        coverPhotoMode: 'manual',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
      coverPhotoUpload: {
        localUri: 'file:///cover.jpg',
        remotePath: `project-covers/${PROJECT_B_ID}/cover.jpg`,
        mimeType: 'image/jpeg',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1234,
      },
    })).rejects.toThrow(/exact project ID and storage path/i);

    await expect(queueProjectUpdate({
      id: PROJECT_A_ID,
      previousName: 'Shared Project',
      data: {
        coverPhoto: {
          remotePath: `project-covers/${PROJECT_A_ID}/cover.jpg`,
          mimeType: 'image/jpeg',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
        coverPhotoMode: 'manual',
        coverPhotoUpdatedAt: '2026-08-10T00:01:00.000Z',
      },
      coverPhotoUpload: {
        localUri: 'file:///cover.jpg',
        remotePath: `project-covers/${PROJECT_A_ID}/cover.jpg`,
        mimeType: 'image/jpeg',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1234,
      },
    })).rejects.toThrow(/exact project ID and storage path/i);

    await expect(queueProjectUpdate({
      id: PROJECT_A_ID,
      previousName: 'Shared Project',
      data: {
        coverPhoto: {
          remotePath: `project-covers/${PROJECT_A_ID}/cover.jpg`,
          mimeType: 'image/jpeg',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
    })).rejects.toThrow(/exact project ID and storage path/i);
  });

  it('never exposes native file paths or backend errors to a PM', () => {
    expect(sanitizeUserFacingSyncMessage(
      'readAsStringAsync failed at /var/mobile/Containers/Data/Application/photo.heic',
    )).toBe(
      'Some photos could not be synced because the original files are no longer available. The remaining items will continue syncing.',
    );
    expect(sanitizeUserFacingSyncMessage('PostgREST relation project_updates failed'))
      .toBe('Cloud sync needs service attention. Your changes remain saved on this phone.');
  });

  it('marks only the reported missing photo unavailable', () => {
    const source = update();
    const result = markMissingPhotosUnavailable(source, [{
      updateId: source.id,
      photoId: source.photos[0].id,
    }]);

    expect(result.photos[0].cloudRecoveryStatus).toBe('unavailable');
    expect(result.photos[0].cloudSignedUrlExpiresAt).toBeNull();
  });

  it('creates stable cloud paths without overwriting an existing path', () => {
    const source = update();
    expect(projectUpdatePhotoStoragePath(source, source.photos[0]))
      .toBe('2321-compliance-project/update-17/photo-1-north-lot.heic');

    const assigned = projectUpdateWithCloudPhotoPaths(source);
    expect(assigned.photos[0].cloudStoragePath)
      .toBe('2321-compliance-project/update-17/photo-1-north-lot.heic');
    assigned.photos[0].cloudStoragePath = 'existing/path.heic';
    expect(projectUpdateWithCloudPhotoPaths(assigned).photos[0].cloudStoragePath)
      .toBe('existing/path.heic');
  });

  it('binds only canonical exact-byte upload receipts to their photo IDs', () => {
    const source = update();
    const bound = projectUpdateWithPhotoUploadReceipts(source, {
      'photo 1': 'A'.repeat(64),
      'other-photo': 'b'.repeat(64),
    });

    expect(bound.photos[0].contentSha256).toBe('a'.repeat(64));
    expect(source.photos[0].contentSha256).toBeUndefined();
    expect(projectUpdateWithPhotoUploadReceipts(source, {
      'photo 1': 'not-a-digest',
    }).photos[0].contentSha256).toBeUndefined();
  });

  it('rejects expired recovered URLs while preserving ordinary local photos', () => {
    expect(recoveredSignedPhotoUriIsFresh({
      cloudRecoveryStatus: 'signed_url',
      cloudSignedUrlExpiresAt: '2026-07-17T12:00:00.000Z',
    }, new Date('2026-07-17T12:00:01.000Z').getTime())).toBe(false);
    expect(recoveredSignedPhotoUriIsFresh({
      cloudRecoveryStatus: 'cached',
      cloudSignedUrlExpiresAt: null,
    })).toBe(true);
  });

  it('uses a bounded preview transform while keeping HEIC originals untransformed', () => {
    expect(projectPhotoPreviewTransform({ mimeType: 'image/jpeg' })).toEqual({
      width: 960,
      quality: 72,
      resize: 'contain',
    });
    expect(projectPhotoPreviewTransform({ fileName: 'evidence.heic' })).toBeUndefined();
    expect(cloudPhotoPreviewIsFresh({
      cloudPreviewUri: 'https://signed.example/preview.jpg',
      cloudPreviewSignedUrlExpiresAt: '2026-08-01T10:10:00.000Z',
    }, new Date('2026-08-01T10:00:00.000Z').getTime())).toBe(true);
  });

});
