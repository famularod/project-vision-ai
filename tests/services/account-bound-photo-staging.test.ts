/**
 * Whole-app audit A1 M3 (owner-approved 30 Sep 2026): work being sent when
 * the account changes. A field update's photos not yet started are not sent
 * with the next account's session, and the update is not re-queued under the
 * next account (which would then have sent it as its own); a Settings Sync
 * Now in progress sends nothing more. Real SyncService and queue; the cloud
 * calls are mocked at SupabaseService, and the account change is the sign-in
 * events' own binding update.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([k, v]) => values.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach(k => values.delete(k)); },
    clear: async () => values.clear(),
  };
  return { __esModule: true, default: api, ...api };
});
const mockUploadPhoto = jest.fn();
const mockUpsertProjectArea = jest.fn();
// Every other cloud call answers "done, nothing there".
jest.mock('../../services/SupabaseService', () => {
  const calls: Record<string, unknown> = {
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    createPhotoSignedUrl: async () => ({
      ok: false, configured: true, data: null, error: 'Object not found', status: 400, code: 'not_found',
    }),
    verifyDAVEAppOwner: async () => ({ ok: true, configured: true, data: true }),
    testSupabaseConnection: async () => ({ connected: true, projectCount: 0 }),
    uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
    upsertProjectArea: (...args: unknown[]) => mockUpsertProjectArea(...args),
  };
  return new Proxy(calls, {
    get: (target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (key in target) return target[key];
      if (key === '__esModule') return false;
      return async () => ({ ok: true, configured: true, stubbed: false, data: [] });
    },
  });
});

import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { getOfflineQueue, stageProjectUpdateForSync, synchronizeLocalData } from '../../services/SyncService';

const photo = (id: string) => ({
  id, uri: `https://photos.invalid/${id}.jpg`, fileName: `${id}.jpg`, mimeType: 'image/jpeg',
  createdAt: '2026-09-30T08:00:00.000Z',
});

test('photos not yet sent, and the update itself, stay with the account that saved them', async () => {
  noteSignedInOwner('owner-a');
  const update = {
    id: 'update-a1', projectName: 'Canopy B', notes: 'Crack at column C4', status: 'queued',
    createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z',
    photos: ['p1', 'p2', 'p3', 'p4', 'p5'].map(photo),
  };
  let switched = false;
  mockUploadPhoto.mockImplementation(async () => {
    if (!switched) {
      switched = true;
      // owner-a signs out and owner-b signs in while the first photos upload.
      noteSignedInOwner(null);
      noteSignedInOwner('owner-b');
    }
    return { ok: true, configured: true, data: { path: 'x' } };
  });

  const staged = await stageProjectUpdateForSync(update as never);

  // Only the photo whose file had already left went out. (Until sync batch Y4, owner answer Q45, it was three: the
  // photos are begun three at a time, and the two whose check in the cloud was still waiting when the account
  // changed had their files sent after it, as the next account. One photo's upload is several requests too.)
  expect(mockUploadPhoto).toHaveBeenCalledTimes(1);
  expect(staged.workAttempt.errors.join(' ')).toMatch(/account changed during sync/);
  // The update is still queued for owner-a only, not re-queued as owner-b's.
  const queued = (await getOfflineQueue()).filter(item => item.entity === 'project_update');
  expect(queued.map(item => item.ownerId)).toEqual(['owner-a']);
});

test('Sync Now in progress when the account changes sends nothing more as the next account', async () => {
  noteSignedInOwner(null);
  noteSignedInOwner('owner-a');
  const area = (id: string) => ({ id, projectName: 'Canopy B', name: `Area ${id}`, latitude: 1, longitude: 1, radiusMeters: 30 });
  let switched = false;
  mockUpsertProjectArea.mockImplementation(async () => {
    if (!switched) {
      switched = true;
      noteSignedInOwner(null);
      noteSignedInOwner('owner-b');
    }
    return { ok: true, configured: true, stubbed: false, data: null };
  });

  const result = await synchronizeLocalData({
    projects: [], savedUpdates: [], scheduleItems: [], referenceDocuments: [],
    projectAreas: [area('area-1'), area('area-2'), area('area-3')] as never,
  });

  expect(mockUpsertProjectArea).toHaveBeenCalledTimes(1);
  // Nothing of the next account's is handed back for this one's screen to save.
  expect(result.downloadStatus).toBe('partial');
  expect(result.recovered.updates).toEqual([]);
  expect(result.errors.join(' ')).toMatch(/account changed during sync/);
});
