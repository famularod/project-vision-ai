import {
  markMissingPhotosUnavailable,
  projectUpdatePhotoStoragePath,
  projectUpdateWithCloudPhotoPaths,
  recoveredSignedPhotoUriIsFresh,
  sanitizeUserFacingSyncMessage,
} from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

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
});
