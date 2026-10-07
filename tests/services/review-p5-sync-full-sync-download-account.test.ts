/**
 * Review pass 1, sync, item 5 (older; found by the reviewer by reading; owner answer Q45 (6 Oct)): Full Sync's
 * DOWNLOAD across a change of account.
 *
 * Sync Now uploads, then downloads this account's lists and hands them to the screen, which merges and saves them
 * on the phone. It looked at who was signed in just before the download and not after it. A download in flight
 * across a sign-out and another sign-in handed the first account's rows to the screen. The same on Build 230.
 *
 * The rig is sync batch Y4's (tests/services/sync-batch-y4-account-boundary.test.ts): the real SyncService, a fresh
 * one for each run, the cloud calls mocked at SupabaseService, each call noting which account it was told it must
 * be made as, and the account change made by the sign-in events' own binding update. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const shared = globalThis as { reviewP5DownloadStorage?: Map<string, string> };
  const values = (shared.reviewP5DownloadStorage ??= new Map<string, string>());
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
jest.mock('../../services/BackgroundTaskGuard', () => ({
  ...jest.requireActual('../../services/BackgroundTaskGuard'),
  startGuardedBackgroundTask: jest.fn(),
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
type CloudCall = { name: string; as: string | null; begunAfterTheChange: boolean };
/** Every cloud call made, in the order they began. */
const mockCalls: CloudCall[] = [];
/** A test changes the account as the call at this place (in the order they began) answers. */
const mockChange = { whenAnswering: -1, made: false, make: (() => undefined) as () => void };
const mockTask = {
  id: 'task-of-a', itemType: 'Task', projectId: PROJECT_ID, projectName: 'Canopy B', locationName: '', taskName: 'Pour slab', startDate: '',
  finishDate: '2026-10-02', milestone: '', owner: 'A', contractor: '', percentComplete: 40, priority: 'Medium', status: 'In Progress',
  notes: 'Rebar inspection first', nextAction: '', activity: [], createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
const mockArea = { id: 'area-of-a', projectId: PROJECT_ID, projectName: 'Canopy B', name: 'North lot', latitude: 1, longitude: 1, radiusMeters: 30, updatedAt: '2026-09-30T08:05:00.000Z' };
const mockUpdate = {
  id: 'update-of-a', projectId: PROJECT_ID, projectName: 'Canopy B', areaName: '',
  updateData: { id: 'update-of-a', projectId: PROJECT_ID, projectName: 'Canopy B', notes: 'Crack at column C4', status: 'sent', date: '2026-09-30', photos: [], createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z' },
  createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
/** Account A's cloud. */
const mockAnswers: Record<string, () => unknown> = {
  listProjects: () => [{ id: PROJECT_ID, name: 'Canopy B' }],
  listProjectUpdates: () => [mockUpdate],
  listProjectAreas: () => [mockArea],
  listScheduleItems: () => [mockTask],
  listDAVESyncTombstones: () => [{ entityType: 'schedule_item', recordId: 'old-task-of-a', deletedAt: '2026-09-01T00:00:00.000Z' }],
  countCloudProjects: () => 1,
};
function mockCloudCall(name: string, answer: () => unknown) {
  return async () => {
    const binding = jest.requireActual('../../services/CloudOwnerBinding') as Partial<typeof import('../../services/CloudOwnerBinding')>;
    const place = mockCalls.push({ name, as: binding.cloudOwnerExpectedForThisCall?.() ?? null, begunAfterTheChange: mockChange.made }) - 1;
    await Promise.resolve();
    if (place === mockChange.whenAnswering && !mockChange.made) {
      mockChange.made = true;
      mockChange.make();
    }
    return answer();
  };
}
jest.mock('../../services/SupabaseService', () => new Proxy({} as Record<string, unknown>, {
  get: (_target, key) => {
    if (typeof key !== 'string' || key === 'then') return undefined;
    if (key === '__esModule') return false;
    if (key === 'getSupabaseConfigurationStatus') return () => ({ configured: true, message: 'Configured.' });
    if (key === 'testSupabaseConnection') return async () => ({ connected: true, projectCount: 1 });
    return mockCloudCall(key, () => ({ ok: true, configured: true, stubbed: false, data: key in mockAnswers ? mockAnswers[key]() : [] }));
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

type Sync = typeof import('../../services/SyncService');
type Binding = typeof import('../../services/CloudOwnerBinding');
/** The app, started afresh on this phone: nothing held in memory. Account A is signed in. */
function startApp() {
  jest.resetModules();
  const binding = require('../../services/CloudOwnerBinding') as Binding;
  const sync = require('../../services/SyncService') as Sync;
  binding.noteSignedInOwner('owner-a');
  mockCalls.length = 0;
  Object.assign(mockChange, { whenAnswering: -1, made: false, make: () => { binding.noteSignedInOwner(null); binding.noteSignedInOwner('owner-b'); } });
  return { sync, binding };
}
/** Sync Now on a phone that already holds what the cloud holds: nothing to upload, everything to download. */
const syncNow = (sync: Sync) => sync.synchronizeLocalData({
  projects: ['Canopy B'], savedUpdates: [], scheduleItems: [mockTask], projectAreas: [mockArea], referenceDocuments: [],
} as never);
const LAST_SYNC_KEY = 'projectVisionAI.lastSyncAt.v1';
const DOWNLOAD_LISTS = ['listProjects', 'listProjectUpdates', 'listProjectAreas', 'listScheduleItems', 'listReferenceDocuments'];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('Full Sync\'s download, and the account changes while it is under way', () => {
  it('control: no change of account. The lists are asked for as the account Sync Now began with, handed back, and the time of the sync is saved', async () => {
    const { sync } = startApp();

    const result = await syncNow(sync);

    expect(result.errors).toEqual([]);
    expect(result.downloadStatus).toBe('complete');
    expect(result.recovered.projects.map(project => project.name)).toEqual(['Canopy B']);
    expect(result.recovered.scheduleItems.map(item => item.id)).toEqual(['task-of-a']);
    expect(result.recovered.projectAreas.map(area => area.id)).toEqual(['area-of-a']);
    expect(result.recovered.updates.map(update => update.id)).toEqual(['update-of-a']);
    expect(result.recovered.tombstones.map(record => record.recordId)).toEqual(['old-task-of-a']);
    expect(result.lastSyncAt).not.toBeNull();
    expect(await AsyncStorage.getItem(LAST_SYNC_KEY)).not.toBeNull();
    // Each of the download's five lists: its last read in the sync, made as account A.
    const names = mockCalls.map(call => call.name);
    expect(DOWNLOAD_LISTS.map(name => mockCalls[names.lastIndexOf(name)])).toEqual(DOWNLOAD_LISTS.map(name => ({ name, as: 'owner-a', begunAfterTheChange: false })));
  });

  it('wherever the account changes from the download\'s first read to the end of the sync: nothing downloaded is handed back, nothing is counted, and the time of the sync is not saved', async () => {
    const learn = startApp();
    await syncNow(learn.sync);
    const names = mockCalls.map(call => call.name);
    const first = Math.min(...DOWNLOAD_LISTS.map(name => names.lastIndexOf(name)));
    expect(first).toBeGreaterThan(0);
    expect(names.length - first).toBeGreaterThanOrEqual(DOWNLOAD_LISTS.length + 1); // the five lists, then the count of projects

    for (let at = first; at < names.length; at += 1) {
      await AsyncStorage.clear();
      const { sync } = startApp();
      mockChange.whenAnswering = at;

      const result = await syncNow(sync);

      const where = `the account changes as "${names[at]}" (request ${at + 1} of ${names.length}) answers`;
      expect([where, mockChange.made]).toEqual([where, true]);
      expect([where, result.recovered.projects, result.recovered.updates, result.recovered.projectAreas, result.recovered.scheduleItems, result.recovered.referenceDocuments, result.recovered.tombstones])
        .toEqual([where, [], [], [], [], [], []]);
      // Every list is marked "not read", so the screen applies none of them as the cloud's word.
      expect([where, Object.values(result.recovered.collectionErrors).every(error => typeof error === 'string' && error.length > 0)]).toEqual([where, true]);
      expect([where, result.downloaded, result.downloadStatus, result.lastSyncAt]).toEqual([where, 0, 'partial', null]);
      expect([where, result.details.cloudProjectsDownloaded + result.details.cloudUpdatesDownloaded + result.details.cloudAreasDownloaded + result.details.cloudSchedulesDownloaded + result.details.cloudDocumentsDownloaded]).toEqual([where, 0]);
      expect([where, /account changed during sync/i.test(result.errors.join(' '))]).toEqual([where, true]);
      expect([where, await AsyncStorage.getItem(LAST_SYNC_KEY)]).toEqual([where, null]);
      // And once the account has changed, nothing more is asked of the cloud (the five lists are asked for together,
      // so the others had already begun, as account A).
      expect([where, mockCalls.filter(call => call.begunAfterTheChange)]).toEqual([where, []]);
    }
  });

  it('the download on its own (the function Sync Now uses): the account changes while a list is read, and it answers with no records and every list marked "not read"', async () => {
    const { sync } = startApp();
    mockChange.whenAnswering = 2;

    const download = await sync.downloadCloudChanges();

    expect(mockChange.made).toBe(true);
    expect([download.projects, download.projectNames, download.updates, download.projectAreas, download.scheduleItems, download.referenceDocuments, download.tombstones])
      .toEqual([[], [], [], [], [], [], []]);
    expect(download.tombstonesAuthoritative).toBe(false);
    expect(Object.values(download.collectionErrors)).toEqual(Array(5).fill('The account changed during sync. Work not yet sent waits for the account that saved it.'));
  });

  it('the download on its own, handed a deletion history that was read earlier (as Sync Now hands it one): the account changes while a list is read, and it still answers with no records', async () => {
    const { sync } = startApp();
    mockChange.whenAnswering = 1; // the second of the five lists; no deletion history is read by this call

    const download = await sync.downloadCloudChanges({
      tombstones: [{ entityType: 'schedule_item', recordId: 'old-task-of-a', deletedAt: '2026-09-01T00:00:00.000Z' }],
      cloudAuthoritative: true,
      cloudError: null,
    });

    expect(mockChange.made).toBe(true);
    expect(mockCalls.map(call => call.name)).not.toContain('listDAVESyncTombstones');
    expect([download.projects, download.projectNames, download.updates, download.projectAreas, download.scheduleItems, download.referenceDocuments, download.tombstones])
      .toEqual([[], [], [], [], [], [], []]);
    expect(download.tombstonesAuthoritative).toBe(false);
    expect(Object.values(download.collectionErrors)).toEqual(Array(5).fill('The account changed during sync. Work not yet sent waits for the account that saved it.'));
  });

  it('one account only: a token refresh in the middle of the download (the same account told again) changes nothing', async () => {
    const learn = startApp();
    await syncNow(learn.sync);
    const at = mockCalls.map(call => call.name).lastIndexOf('listScheduleItems');
    await AsyncStorage.clear();
    const { sync, binding } = startApp();
    Object.assign(mockChange, { whenAnswering: at, make: () => binding.noteSignedInOwner('owner-a') });

    const result = await syncNow(sync);

    expect(mockChange.made).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.recovered.scheduleItems.map(item => item.id)).toEqual(['task-of-a']);
    expect(result.lastSyncAt).not.toBeNull();
  });

  it('one account only: it signs out and in again in the middle of the download: that download is discarded once, and the next Sync Now hands everything back', async () => {
    const learn = startApp();
    await syncNow(learn.sync);
    const at = mockCalls.map(call => call.name).lastIndexOf('listScheduleItems');
    await AsyncStorage.clear();
    const { sync, binding } = startApp();
    Object.assign(mockChange, { whenAnswering: at, make: () => { binding.noteSignedInOwner(null); binding.noteSignedInOwner('owner-a'); } });

    const cut = await syncNow(sync);
    expect(cut.recovered.scheduleItems).toEqual([]);
    expect(cut.lastSyncAt).toBeNull();

    const next = await syncNow(sync);
    expect(next.errors).toEqual([]);
    expect(next.recovered.scheduleItems.map(item => item.id)).toEqual(['task-of-a']);
    expect(next.lastSyncAt).not.toBeNull();
  });
});
