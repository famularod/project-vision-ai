/**
 * Field test, 28 Sep 2026: two photos on July updates of "2321 Compliance
 * Project" were on neither the phone nor, by their recorded path, the cloud.
 * An old migration renamed updates from legacy project names ("2321 North
 * Side Lot") without keeping the path their photos were uploaded to, and sync
 * then pinned the new path. The lookup now also tries the legacy project
 * paths, with the same update and photo ids, before calling a photo missing.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///app/Documents/',
  cacheDirectory: 'file:///app/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async (_url: string, destination: string) => ({ uri: destination })),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
  NativeModules: {},
  Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: jest.fn(),
  getCurrentSessionAccessToken: jest.fn(),
  createPhotoSignedUrl: jest.fn(),
}));

import { createPhotoSignedUrl } from '../../services/SupabaseService';
import {
  hydrateRecoveredProjectUpdatePhotos,
  legacyProjectPhotoStoragePaths,
} from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

const signedUrl = createPhotoSignedUrl as jest.Mock;
const NOT_FOUND = { ok: false, status: 400, error: 'Object not found', message: 'Object not found' };

function julyUpdate(id: string, pinnedPath: string | null): ProjectUpdate {
  return {
    id,
    projectName: '2321 Compliance Project',
    date: '2026-07-14',
    notes: '',
    recipients: { contactIds: [] },
    photos: [{
      id: 'photo-1', uri: '', fileName: 'lot.jpg', mimeType: 'image/jpeg', caption: '', category: 'Update',
      actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Closed',
      cloudStoragePath: pinnedPath,
    }],
  } as ProjectUpdate;
}

describe('photos uploaded under a legacy project name', () => {
  beforeEach(() => signedUrl.mockReset());

  it('lists the same file under each legacy project name, and nothing without an update folder', () => {
    const paths = legacyProjectPhotoStoragePaths('2321-compliance-project/update-7/photo-1-lot.jpg');
    expect(paths).toContain('2321-north-side-lot/update-7/photo-1-lot.jpg');
    expect(paths).toContain('building-2321-east-driveway/update-7/photo-1-lot.jpg');
    expect(paths).not.toContain('2321-compliance-project/update-7/photo-1-lot.jpg');
    expect(paths.every(path => path.endsWith('/update-7/photo-1-lot.jpg'))).toBe(true);
    expect(legacyProjectPhotoStoragePaths('only/two')).toEqual([]);
  });

  it('finds the photo under the legacy path even when sync pinned the new one', async () => {
    signedUrl.mockImplementation(async (path: string) => path.startsWith('2321-north-side-lot/')
      ? { ok: true, data: `https://signed.example/${path}` }
      : NOT_FOUND);

    const [photo] = (await hydrateRecoveredProjectUpdatePhotos(
      julyUpdate('update-a', '2321-compliance-project/update-a/photo-1-lot.jpg'),
    )).photos;

    expect(photo.cloudStoragePath).toBe('2321-north-side-lot/update-a/photo-1-lot.jpg');
    expect(photo.cloudRecoveryStatus).toBe('cached');
    expect(photo.uri.startsWith('file:///app/Caches/')).toBe(true);
  });

  it('does not search legacy paths when the first lookup is inconclusive', async () => {
    signedUrl.mockResolvedValue({ ok: false, status: 503, error: 'Service unavailable' });

    const [photo] = (await hydrateRecoveredProjectUpdatePhotos(julyUpdate('update-b', null))).photos;

    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(photo.cloudRecoveryStatus).toBe('unavailable');
  });

  it('marks a photo that is nowhere unavailable, and searches its legacy paths once per session', async () => {
    signedUrl.mockResolvedValue(NOT_FOUND);

    const first = await hydrateRecoveredProjectUpdatePhotos(julyUpdate('update-c', null));
    const callsAfterFirst = signedUrl.mock.calls.length;
    await hydrateRecoveredProjectUpdatePhotos(julyUpdate('update-c', null));

    expect(first.photos[0].cloudRecoveryStatus).toBe('unavailable');
    expect(first.photos[0].cloudStoragePath).toBe('2321-compliance-project/update-c/photo-1-lot.jpg');
    expect(callsAfterFirst).toBeGreaterThan(5);
    expect(signedUrl.mock.calls.length).toBe(callsAfterFirst + 1);
  });
});
