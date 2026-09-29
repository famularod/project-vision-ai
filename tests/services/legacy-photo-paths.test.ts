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
  verifyDAVEAppOwner: jest.fn(),
  uploadPhoto: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { createPhotoSignedUrl, uploadPhoto, verifyDAVEAppOwner } from '../../services/SupabaseService';
import {
  hydrateRecoveredProjectUpdatePhotos,
  legacyProjectPhotoStoragePaths,
  uploadLocalPhotoWithDiagnostics,
} from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

const signedUrl = createPhotoSignedUrl as jest.Mock;
const ownerCheck = verifyDAVEAppOwner as jest.Mock;
const upload = uploadPhoto as jest.Mock;
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
  beforeEach(() => {
    signedUrl.mockReset();
    upload.mockReset();
    ownerCheck.mockReset().mockResolvedValue({ ok: true, data: true });
    (FileSystem.getInfoAsync as jest.Mock).mockReset().mockResolvedValue({ exists: false });
  });

  it('lists the same file under each legacy project name, and nothing without an update folder', () => {
    const paths = legacyProjectPhotoStoragePaths('2321-compliance-project/update-7/photo-1-lot.jpg');
    expect(paths).toContain('2321-north-side-lot/update-7/photo-1-lot.jpg');
    expect(paths).toContain('building-2321-east-driveway/update-7/photo-1-lot.jpg');
    expect(paths).not.toContain('2321-compliance-project/update-7/photo-1-lot.jpg');
    expect(paths.every(path => path.endsWith('/update-7/photo-1-lot.jpg'))).toBe(true);
    // Only migrated work-container names; legacy shell names were never renamed.
    expect(paths).not.toContain('tank-farm/update-7/photo-1-lot.jpg');
    expect(paths).toHaveLength(7);
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

  // Independent review, 28 Sep 2026: a signed-out "not found" must not be
  // remembered as a real miss, and a photo still on the phone must be
  // uploaded to its own path without any legacy search.
  it('does not search or remember while the owner is not verified', async () => {
    signedUrl.mockImplementation(async (path: string) => path.startsWith('2321-north-side-lot/')
      ? { ok: true, data: `https://signed.example/${path}` }
      : NOT_FOUND);
    ownerCheck.mockResolvedValue({ ok: true, data: false });

    const signedOut = await hydrateRecoveredProjectUpdatePhotos(julyUpdate('update-d', null));
    expect(signedOut.photos[0].cloudRecoveryStatus).toBe('unavailable');
    expect(signedUrl).toHaveBeenCalledTimes(1);

    ownerCheck.mockResolvedValue({ ok: true, data: true });
    const signedIn = await hydrateRecoveredProjectUpdatePhotos(julyUpdate('update-d', null));
    expect(signedIn.photos[0].cloudStoragePath).toBe('2321-north-side-lot/update-d/photo-1-lot.jpg');
  });

  it('uploads a photo that is on the phone to its own path, with no legacy search', async () => {
    signedUrl.mockResolvedValue(NOT_FOUND);
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false, size: 2048 });
    upload.mockResolvedValue({ ok: true, data: { path: 'x' } });
    const update = julyUpdate('update-e', null);
    update.photos[0].uri = 'file:///app/Documents/project-photos/lot.jpg';

    const result = await uploadLocalPhotoWithDiagnostics(update, update.photos[0]);

    expect(result.result).toBe('uploaded');
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(ownerCheck).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ path: '2321-compliance-project/update-e/photo-1-lot.jpg' }));
  });

  it('reports where a photo not on the phone was found, so sync records that path', async () => {
    signedUrl.mockImplementation(async (path: string) => path.startsWith('3-hour-fire-wall/')
      ? { ok: true, data: `https://signed.example/${path}` }
      : NOT_FOUND);
    const update = julyUpdate('update-f', '2321-compliance-project/update-f/photo-1-lot.jpg');

    const result = await uploadLocalPhotoWithDiagnostics(update, update.photos[0]);

    expect(result.result).toBe('skipped');
    expect(result.foundAtPath).toBe('3-hour-fire-wall/update-f/photo-1-lot.jpg');
    expect(upload).not.toHaveBeenCalled();
  });

  // Review pass 2, 28 Sep 2026: a pass whose lookup is inconclusive must not
  // write the empty pinned path back over the path the photo was found at.
  it('keeps a path found this session through an inconclusive lookup', async () => {
    let connectionDown = false;
    signedUrl.mockImplementation(async (path: string) => {
      if (connectionDown) return { ok: false, status: 503, error: 'Service unavailable' };
      return path.startsWith('2321-north-side-lot/') ? { ok: true, data: `https://signed.example/${path}` } : NOT_FOUND;
    });
    const update = julyUpdate('update-g', '2321-compliance-project/update-g/photo-1-lot.jpg');
    expect((await uploadLocalPhotoWithDiagnostics(update, update.photos[0])).foundAtPath)
      .toBe('2321-north-side-lot/update-g/photo-1-lot.jpg');

    connectionDown = true;
    signedUrl.mockImplementation(async (path: string) => path.startsWith('2321-compliance-project/')
      ? NOT_FOUND
      : { ok: false, status: 503, error: 'Service unavailable' });
    expect((await uploadLocalPhotoWithDiagnostics(update, update.photos[0])).foundAtPath)
      .toBe('2321-north-side-lot/update-g/photo-1-lot.jpg');
  });

  // Review pass 11, 29 Sep 2026: a failed owner check must not let a photo
  // marked unavailable sync without its found path; the pass retries later.
  it('retries later when the owner check itself fails, and skips when the caller is not the owner', async () => {
    signedUrl.mockResolvedValue(NOT_FOUND);
    const update = julyUpdate('update-h', '2321-compliance-project/update-h/photo-1-lot.jpg');
    update.photos[0].cloudRecoveryStatus = 'unavailable';

    ownerCheck.mockResolvedValue({ ok: false, error: 'network' });
    expect((await uploadLocalPhotoWithDiagnostics(update, update.photos[0])).result).toBe('failed');

    ownerCheck.mockResolvedValue({ ok: true, data: false });
    expect((await uploadLocalPhotoWithDiagnostics(update, update.photos[0])).result).toBe('skipped');
  });
});
