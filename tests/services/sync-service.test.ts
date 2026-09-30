import {
  hydrateProjectUpdatePhotoPreviews,
  markMissingPhotosUnavailable,
  projectUpdatePhotoStoragePath,
  projectPhotoPreviewTransform,
  projectUpdateWithCloudPhotoPaths,
  recoveredSignedPhotoUriIsFresh,
  cloudPhotoPreviewIsFresh,
  sanitizeUserFacingSyncMessage,
  signProjectPhotoPreview,
} from '../../services/SyncService';
import { createPhotoSignedUrl } from '../../services/SupabaseService';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  createPhotoSignedUrl: jest.fn(),
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

describe('photo previews signed when shown (whole-app audit A4 pass 6)', () => {
  const signedUrl = createPhotoSignedUrl as jest.Mock;
  beforeEach(() => {
    let count = 0;
    signedUrl.mockReset().mockImplementation(async (storagePath: string) => ({
      ok: true, stubbed: false, data: `https://signed.example/${storagePath}?v=${++count}`,
    }));
  });

  it('a refresh that does not sign keeps the cloud path and makes no call', async () => {
    const source = update();
    source.photos[0] = { ...source.photos[0], uri: '', cloudStoragePath: null };
    const hydrated = await hydrateProjectUpdatePhotoPreviews(source, { sign: false });
    expect(hydrated.photos[0]).toMatchObject({
      uri: '',
      cloudStoragePath: '2321-compliance-project/update-17/photo-1-north-lot.heic',
    });
    expect(hydrated.photos[0].cloudPreviewUri).toBeUndefined();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('reuses a signed preview, signs again when forced, and shares the cache with hydration', async () => {
    const photo = { cloudStoragePath: 'p/u9/a.jpg', mimeType: 'image/jpeg' };
    const first = await signProjectPhotoPreview(photo);
    expect(first).toEqual({ uri: 'https://signed.example/p/u9/a.jpg?v=1', usableUntil: expect.any(Number) });
    expect(await signProjectPhotoPreview(photo)).toEqual(first);
    expect(signedUrl).toHaveBeenCalledTimes(1);

    const forced = await signProjectPhotoPreview(photo, { force: true });
    expect(forced?.uri).toBe('https://signed.example/p/u9/a.jpg?v=2');
    expect(await signProjectPhotoPreview(photo)).toEqual(forced);
    const source = update();
    const hydrated = await hydrateProjectUpdatePhotoPreviews({
      ...source,
      photos: [{ ...source.photos[0], uri: '', fileName: 'a.jpg', ...photo }],
    });
    expect(hydrated.photos[0].cloudPreviewUri).toBe(forced?.uri);
    expect(signedUrl).toHaveBeenCalledTimes(2);
    expect(await signProjectPhotoPreview({ cloudStoragePath: ' ' })).toBeNull();
  });
});
