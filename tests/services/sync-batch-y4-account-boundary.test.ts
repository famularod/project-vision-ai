/**
 * Sync batch Y4, the account boundary of an upload under way (owner answer Q45, 6 Oct 2026: yes).
 *
 * The other fixer's cases (p1-upload-in-flight-at-sign-out.test.ts) show it for a task, against a stand-in cloud:
 * one waiting item's upload is several requests, the pass looked at who is signed in before each item only, and a
 * write whose check was still waiting when the account changed went out as the next account.
 *
 * Here: the same shape for every kind of item the pass sends, and for the two other places that send several
 * requests for one record (Sync Now, and a field update's photos).
 *  - wherever among an item's requests the account changes, nothing more is asked of the cloud and its write is
 *    not made (each kind is run once to learn its requests, then once more for a change at each of them);
 *  - with no change, every write is made "as" the account the item was queued under.
 * Real SyncService and queue, a fresh one for each run; the cloud calls are mocked at SupabaseService, and the
 * account change is the sign-in events' own binding update (as in account-bound-photo-staging.test.ts).
 * Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  // The phone's storage: one for the whole file, so it outlives the app being closed and opened (a fresh
  // SyncService, below, gets a fresh copy of this stand-in over the same values).
  const shared = globalThis as { y4AccountBoundaryStorage?: Map<string, string>; y4AccountBoundaryStorageRead?: () => void };
  const values = (shared.y4AccountBoundaryStorage ??= new Map<string, string>());
  const api = {
    getItem: async (key: string) => {
      // A test changes the account at one of the phone's own reads, between two of an item's requests.
      shared.y4AccountBoundaryStorageRead?.();
      return values.get(key) ?? null;
    },
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
// Passes run only when a test runs them.
jest.mock('../../services/BackgroundTaskGuard', () => ({
  ...jest.requireActual('../../services/BackgroundTaskGuard'),
  startGuardedBackgroundTask: jest.fn(),
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
type CloudCall = { name: string; as: string | null; begunAfterTheChange: boolean };
/** Every cloud call made, in the order they began. */
const mockCalls: CloudCall[] = [];
/** A test changes the account as the call at this place (in the order they began) answers, or at one of the phone's own storage reads. */
const mockChange = { whenAnswering: -1, atStorageRead: -1, storageReads: 0, made: false, make: (() => undefined) as () => void };
(globalThis as { y4AccountBoundaryStorageRead?: () => void }).y4AccountBoundaryStorageRead = () => {
  mockChange.storageReads += 1;
  if (mockChange.storageReads === mockChange.atStorageRead && !mockChange.made) {
    mockChange.made = true;
    mockChange.make();
  }
};
const mockAnswers: Record<string, () => unknown> = {
  listProjects: () => [{ id: PROJECT_ID, name: 'Canopy B' }],
  getProjectUpdateSyncMetadata: () => null,
  getScheduleItem: () => null,
  createProject: () => ({ id: '22222222-2222-4222-8222-222222222222', name: 'Lot 9' }),
};
function mockCloudCall(name: string, answer: () => unknown) {
  return async () => {
    // (Read this way so that the file also runs, and fails for the right reason, on a tree from before this change.)
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
    if (key === 'createPhotoSignedUrl') {
      return mockCloudCall(key, () => ({ ok: false, configured: true, data: null, error: 'Object not found', status: 400, code: 'not_found' }));
    }
    return mockCloudCall(key, () => ({ ok: true, configured: true, stubbed: false, data: key in mockAnswers ? mockAnswers[key]() : [] }));
  },
}));
// A document's file is sent by the document store's own code, before its record: seen here as one more call.
jest.mock('../../services/ReferenceDocumentRepository', () => ({
  ...jest.requireActual('../../services/ReferenceDocumentRepository'),
  prepareReferenceDocumentForCloud: async (document: { id: string }) => {
    await mockCloudCall('the document\'s file', () => null)();
    return { ...document, storagePath: `mobile/${document.id}/permit.pdf` };
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

type Sync = typeof import('../../services/SyncService');
type Binding = typeof import('../../services/CloudOwnerBinding');
/** The app, started afresh on this phone: nothing held in memory. Account A is signed in unless `signedIn` says otherwise. */
function startApp(signedIn: 'owner-a' | 'not known yet' = 'owner-a') {
  jest.resetModules();
  const binding = require('../../services/CloudOwnerBinding') as Binding;
  const sync = require('../../services/SyncService') as Sync;
  if (signedIn === 'owner-a') binding.noteSignedInOwner('owner-a');
  mockCalls.length = 0;
  Object.assign(mockChange, { whenAnswering: -1, atStorageRead: -1, storageReads: 0, made: false, make: () => { binding.noteSignedInOwner(null); binding.noteSignedInOwner('owner-b'); } });
  return sync;
}

const WRITES = new Set([
  'upsertScheduleItem', 'upsertProjectArea', 'upsertReferenceDocument', 'saveProjectUpdate', 'archiveProjectUpdate', 'deleteProjectUpdate',
  'createProject', 'updateProject', 'deleteProject', 'uploadPhoto', 'the document\'s file',
]);
const writes = () => mockCalls.filter(call => WRITES.has(call.name)).map(call => ({ name: call.name, as: call.as }));
const ACCOUNT_CHANGED = 'The account changed during sync. Work not yet sent waits for the account that saved it.';

const task = {
  id: 'task-of-a', itemType: 'Task', projectName: 'Canopy B', locationName: '', taskName: 'Pour slab', startDate: '', finishDate: '2026-10-02',
  milestone: '', owner: 'A', contractor: '', percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: 'Rebar inspection first',
  nextAction: '', activity: [], createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
const area = { id: 'area-of-a', projectName: 'Canopy B', name: 'North lot', latitude: 1, longitude: 1, radiusMeters: 30, updatedAt: '2026-09-30T08:05:00.000Z' };
const document = {
  id: 'document-of-a', name: 'Permit', category: 'Permit', projectName: 'Canopy B', projectNames: ['Canopy B'], uri: 'file:///phone/Documents/permit.pdf',
  originalFileName: 'permit.pdf', mimeType: 'application/pdf', importedAt: '2026-09-30T08:05:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
const update = {
  id: 'update-of-a', projectId: PROJECT_ID, projectName: 'Canopy B', notes: 'Crack at column C4', status: 'queued', date: '2026-09-30',
  recipients: { contactIds: [] }, photos: [], createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};

/** What account A has waiting, by kind: how it is queued, and what its upload writes, in order. */
const KINDS: Array<[string, (sync: Sync) => Promise<void>, string[]]> = [
  ['a task', sync => sync.queueScheduleItemRecord(task as never, false), ['upsertScheduleItem']],
  ['a GPS area', sync => sync.queueProjectAreaRecord(area as never), ['upsertProjectArea']],
  ['a document', sync => sync.queueReferenceDocumentRecord(document as never, false), ['the document\'s file', 'upsertReferenceDocument']],
  ['a new project', sync => sync.queueProjectCreate('Lot 9'), ['createProject']],
  ['a field update', sync => sync.queueProjectUpdateRecord(update as never, false), ['saveProjectUpdate']],
];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('sync batch Y4: an item that is uploading when its account signs out and another signs in', () => {
  it.each(KINDS)('%s, with no change of account: every write is made, and made as the account it was queued under', async (_kind, queue, written) => {
    const sync = startApp();
    await queue(sync);
    expect((await sync.getOfflineQueue()).map(item => item.ownerId)).toEqual(['owner-a']);

    const result = await sync.uploadPendingChanges();

    // Before, a write named no account to the cloud layer: it was made as whoever was signed in by then.
    expect(writes()).toEqual(written.map(name => ({ name, as: name === 'the document\'s file' ? null : 'owner-a' })));
    expect(result.errors).toEqual([]);
    expect(result.uploaded).toBe(1);
    await expect(sync.getOfflineQueue()).resolves.toEqual([]);
  });

  it.each(KINDS)('%s: wherever among its requests the account changes, nothing more is asked of the cloud and nothing more of it is written', async (_kind, queue, written) => {
    // Its requests, in order, learned from a run with no change.
    const learn = startApp();
    await queue(learn);
    await learn.uploadPendingChanges();
    const requests = mockCalls.map(call => call.name);
    const firstWrite = requests.indexOf(written[0]);
    const lastWrite = requests.lastIndexOf(written[written.length - 1]);
    // It makes at least one check before it writes: that is the shape this is about.
    expect(firstWrite).toBeGreaterThan(0);

    for (let at = 0; at < lastWrite; at += 1) {
      await AsyncStorage.clear();
      const sync = startApp();
      await queue(sync);
      mockChange.whenAnswering = at;

      const result = await sync.uploadPendingChanges();

      const label = `the account changes as request ${at + 1} of ${requests.length} (${requests[at]}) answers`;
      expect({ label, changed: mockChange.made }).toEqual({ label, changed: true });
      // It went on: the rest of its checks, and its write, with the next account signed in.
      expect({ label, askedAfterTheChange: mockCalls.filter(call => call.begunAfterTheChange).map(call => call.name) }).toEqual({ label, askedAfterTheChange: [] });
      expect({ label, uploaded: result.uploaded, said: result.errors.includes(ACCOUNT_CHANGED) }).toEqual({ label, uploaded: 0, said: true });
    }
  });

  it.each(KINDS)('%s: the account changes at any of the phone\'s own reads during the pass (between two requests, or before the first): nothing is asked of the cloud after it', async (_kind, queue) => {
    const learn = startApp();
    await queue(learn);
    mockChange.storageReads = 0;
    await learn.uploadPendingChanges();
    const reads = mockChange.storageReads;
    expect(reads).toBeGreaterThan(3);

    // The housekeeping that ends a pass (files the cloud has marked for removal, old deletion records) carries
    // nothing of the items: it asks for, and acts on, what belongs to whoever is signed in.
    const HOUSEKEEPING = new Set(['listDAVEStorageCleanupIntents', 'purgeExpiredDAVEDeletionAudit']);
    const begunAfter: Record<number, string[]> = {};
    const housekeepingAfter: number[] = [];
    for (let at = 1; at <= reads; at += 1) {
      await AsyncStorage.clear();
      const sync = startApp();
      await queue(sync);
      mockChange.storageReads = 0;
      mockChange.atStorageRead = at;

      await sync.uploadPendingChanges();

      const after = mockCalls.filter(call => call.begunAfterTheChange).map(call => call.name);
      const ofTheItem = after.filter(name => !HOUSEKEEPING.has(name));
      if (!mockChange.made || ofTheItem.length > 0) begunAfter[at] = mockChange.made ? ofTheItem : ['(the pass made fewer reads this time)'];
      if (after.some(name => HOUSEKEEPING.has(name))) housekeepingAfter.push(at);
    }
    // The first request of an item went out after the change: its check, and then its write.
    expect(begunAfter).toEqual({});
    // The housekeeping is not begun once the account has changed. What is left is a change in the instant it
    // begins (its own first read of the phone): it then runs for the account that is signed in, as that account's
    // own next pass would. (It ran after a change at any read from the queue being written back onwards.)
    expect(housekeepingAfter.length).toBeLessThanOrEqual(1);
  });

  it('an item an earlier build queued with no account recorded is written as the account the pass began with', async () => {
    const sync = startApp();
    await sync.queueScheduleItemRecord(task as never, false);
    const [queued] = await sync.getOfflineQueue();
    const { ownerId: _none, ...withoutAccount } = queued;
    await AsyncStorage.setItem('projectVisionAI.syncQueue.v1', JSON.stringify([withoutAccount]));

    await sync.uploadPendingChanges();

    expect(writes()).toEqual([{ name: 'upsertScheduleItem', as: 'owner-a' }]);
  });

  it('before the app knows who is signed in, an item is still written only as the account it was queued under', async () => {
    const before = startApp();
    await before.queueScheduleItemRecord(task as never, false);
    // The app is closed and opened; an upload pass runs before the first sign-in event has arrived.
    const sync = startApp('not known yet');

    const result = await sync.uploadPendingChanges();

    // Nothing is held on a guess, as before; but the write names the account, so the cloud layer refuses it if
    // the sign-in on the phone turns out to be another one.
    expect(writes()).toEqual([{ name: 'upsertScheduleItem', as: 'owner-a' }]);
    expect(result.uploaded).toBe(1);
  });

  it('before the app knows who is signed in, an item with no account recorded is sent as it always was', async () => {
    const sync = startApp('not known yet');
    await sync.queueScheduleItemRecord(task as never, false);
    expect((await sync.getOfflineQueue()).map(item => item.ownerId ?? null)).toEqual([null]);

    const result = await sync.uploadPendingChanges();

    expect(writes()).toEqual([{ name: 'upsertScheduleItem', as: null }]);
    expect(result.uploaded).toBe(1);
  });
});

describe('sync batch Y4: the two other places that send several requests for one record', () => {
  const photos = (...ids: string[]) => ids.map(id => ({ id, uri: `https://photos.invalid/${id}.jpg`, fileName: `${id}.jpg`, mimeType: 'image/jpeg', createdAt: '2026-09-30T08:00:00.000Z' }));

  it('a field update\'s photos: the account changes while a photo is looked for in the cloud, and no file is sent', async () => {
    const sync = startApp();
    mockChange.whenAnswering = 0;

    const staged = await sync.stageProjectUpdateForSync({ ...update, photos: photos('p1', 'p2') } as never);

    expect(mockCalls[0].name).toBe('createPhotoSignedUrl');
    // It sent the files of the photos it had begun, as the next account.
    expect(writes()).toEqual([]);
    expect(staged.workAttempt.errors.join(' ')).toMatch(/account changed during sync/i);
    expect((await sync.getOfflineQueue()).filter(item => item.entity === 'project_update').map(item => item.ownerId)).toEqual(['owner-a']);
  });

  it('a field update\'s photo, with no change of account: its file is sent as that account', async () => {
    const sync = startApp();

    await sync.stageProjectUpdateForSync({ ...update, photos: photos('p1') } as never);

    expect(writes().filter(call => call.name === 'uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: 'owner-a' }]);
  });

  /** What Sync Now sends, the last check it makes of it before the write (a document has none), and the write. */
  const SYNC_NOW: Array<[string, Record<string, unknown[]>, string, string]> = [
    ['a GPS area', { projectAreas: [area] }, 'getProjectAreasByIds', 'upsertProjectArea'],
    ['a task', { scheduleItems: [task] }, 'getScheduleItem', 'upsertScheduleItem'],
    ['a new project', { projects: ['Lot 9'] }, 'listArchivedProjects', 'createProject'],
    ['a document', { referenceDocuments: [document] }, '', 'upsertReferenceDocument'],
  ];
  const syncNow = (sync: Sync, records: Record<string, unknown[]>) =>
    sync.synchronizeLocalData({ projects: [], savedUpdates: [], scheduleItems: [], referenceDocuments: [], projectAreas: [], ...records } as never);

  it.each(SYNC_NOW.filter(([, , check]) => check))('Sync Now, %s: the account changes while it is checked just before it is sent, and it is not sent', async (_kind, records, check, write) => {
    const learn = startApp();
    await syncNow(learn, records);
    const at = mockCalls.map(call => call.name).lastIndexOf(check);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(mockCalls.map(call => call.name).indexOf(write)).toBeGreaterThan(at);
    await AsyncStorage.clear();
    const sync = startApp();
    mockChange.whenAnswering = at;

    const result = await syncNow(sync, records);

    expect(mockChange.made).toBe(true);
    expect(writes().map(call => call.name)).not.toContain(write);
    expect(result.errors.join(' ')).toMatch(/account changed during sync/i);
  });

  it.each(SYNC_NOW)('Sync Now, %s, with no change of account: it is sent as the account Sync Now began with', async (_kind, records, _check, write) => {
    const sync = startApp();

    await syncNow(sync, records);

    expect(writes().filter(call => call.name === write)).toEqual([{ name: write, as: 'owner-a' }]);
  });
});
