/**
 * Review pass 1, sync, finding G5 (older; owner answer Q45 (6 Oct)): the deletion history across a change of account.
 *
 * The first three tests are the reviewer's own (notes/p5-sync/p5s-deletion-history-account.test.ts), with one thing
 * added: his stand-in for the sign-in never told the app that the account had changed, so nothing in the app could
 * have known. The stand-in now says so in the two places the real sign-in does (the sign-out, then the next
 * sign-in), exactly as tests/services/sync-batch-y4-account-boundary.test.ts does. With that added, two of his
 * three still fail on the base (a542898), as he found. The tests after them are this batch's own.
 *
 * services/DAVESyncTombstones.ts reads the cloud's deletion history, merges it with the phone's own list, saves the
 * merged list on the phone and uploads all of it. The real module. Stand-ins: the phone's store, and a cloud that
 * keeps one deletion history per account and answers a request with the history of the account that was signed in
 * when the request LEFT (as the cloud does). The switch of the phone's storage from account A's to account B's is
 * modelled as entry.ts makes it: A's values are taken out and B's put in, after A has signed out and before B is
 * signed in.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  },
}));

type Account = 'account-a' | 'account-b';
type Deletion = { entityType: string; recordId: string; deletedAt: string };
let mockSignedIn: Account = 'account-a';
const mockCloudHistory: Record<Account, Deletion[]> = { 'account-a': [], 'account-b': [] };
const mockRead = { hold: false, waiting: false, answer: (() => undefined) as () => void };
const mockWrites: Array<{ as: Account; records: string[] }> = [];
const mockUpload = { hold: false, waiting: false, answer: (() => undefined) as () => void };
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
/** Added by this batch: the account each cloud call was told, in the instant it started, that it must be made as. */
const mockToldToBeMadeAs: Array<{ call: 'read' | 'upload'; as: string | null }> = [];
const mockExpected = () => (jest.requireActual('../../services/CloudOwnerBinding') as typeof import('../../services/CloudOwnerBinding')).cloudOwnerExpectedForThisCall();
/** Added by this batch: the cloud does not answer the read at all (no signal). */
const mockCloud = { reachable: true };

jest.mock('../../services/SupabaseService', () => ({
  listDAVESyncTombstones: async () => {
    mockToldToBeMadeAs.push({ call: 'read', as: mockExpected() });
    if (!mockCloud.reachable) return { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
    const answer = mockOk([...mockCloudHistory[mockSignedIn]]); // the request left as this account
    if (mockRead.hold) {
      mockRead.hold = false;
      mockRead.waiting = true;
      await new Promise<void>(resolve => { mockRead.answer = resolve; });
      mockRead.waiting = false;
    }
    return answer;
  },
  // As services/SupabaseService.ts: written as whoever is signed in when the call starts.
  upsertDAVESyncTombstones: async (tombstones: Deletion[]) => {
    mockToldToBeMadeAs.push({ call: 'upload', as: mockExpected() });
    if (!mockCloud.reachable) return { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
    const as = mockSignedIn; // the request leaves as this account
    if (mockUpload.hold) {
      mockUpload.hold = false;
      mockUpload.waiting = true;
      await new Promise<void>(resolve => { mockUpload.answer = resolve; });
      mockUpload.waiting = false;
    }
    mockWrites.push({ as, records: tombstones.map(tombstone => `${tombstone.entityType}:${tombstone.recordId}`) });
    tombstones.forEach(tombstone => {
      if (!mockCloudHistory[as].some(held => held.entityType === tombstone.entityType && held.recordId === tombstone.recordId)) mockCloudHistory[as].push(tombstone);
    });
    return mockOk(tombstones);
  },
  upsertDAVESyncTombstone: async (tombstone: Deletion) => mockOk(tombstone),
}));

import {
  DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY,
  DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
  loadDAVEOperationalTombstones,
  loadDAVESyncTombstones,
  recordDAVESyncTombstones,
  refreshDAVESyncTombstonesFromCloud,
  synchronizeDAVESyncTombstones,
} from '../../services/DAVESyncTombstones';
import { CLOUD_ACCOUNT_CHANGED_MESSAGE, noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  anotherAccountHasUsedThisPhone,
  createOwnerStorageSandbox,
  OWNER_STORAGE_SANDBOX_METADATA_KEY,
} from '../../services/OwnerStorageSandbox';

/** He signs out; the phone's storage is switched (A's values out); he signs in as B (B's values in: none here). */
function accountChangesToB() {
  noteSignedInOwner(null);
  mockStorage.clear();
  mockSignedIn = 'account-b';
  noteSignedInOwner('account-b');
}

const savedOnPhone = () => (JSON.parse(mockStorage.get(DAVE_SYNC_TOMBSTONES_STORAGE_KEY) ?? '[]') as Deletion[]).map(record => `${record.entityType}:${record.recordId}`);
const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 300 && !ready(); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
};

beforeEach(() => {
  mockStorage.clear();
  mockSignedIn = 'account-a';
  mockCloudHistory['account-a'] = [];
  mockCloudHistory['account-b'] = [];
  mockWrites.length = 0;
  mockRead.hold = false;
  mockUpload.hold = false;
  mockToldToBeMadeAs.length = 0;
  mockCloud.reachable = true;
  noteSignedInOwner('account-a');
});

describe('gap 3: the deletion history, and the account changes while it is being read', () => {
  it('control: no change of account. Account A\'s deletions stay account A\'s', async () => {
    mockCloudHistory['account-a'] = [{ entityType: 'project', recordId: 'Lot 9', deletedAt: '2026-10-01T10:00:00.000Z' }];
    await synchronizeDAVESyncTombstones();
    expect(mockWrites.every(write => write.as === 'account-a')).toBe(true);
    expect(mockCloudHistory['account-b']).toEqual([]);
  });

  it('account A signs out and B signs in while A\'s history is being read: none of A\'s deletion records reaches B\'s phone storage or B\'s cloud history', async () => {
    // Account A deleted its project "Lot 9" some time ago: the cloud's history for A says so.
    mockCloudHistory['account-a'] = [
      { entityType: 'project', recordId: 'Lot 9', deletedAt: '2026-10-01T10:00:00.000Z' },
      { entityType: 'schedule_item', recordId: 'task-of-a', deletedAt: '2026-10-01T10:00:00.000Z' },
    ];
    mockRead.hold = true;
    const sync = synchronizeDAVESyncTombstones(); // a refresh or a Sync Now of account A, on weak signal
    await waitFor(() => mockRead.waiting);

    accountChangesToB();
    mockRead.answer(); // the answer to A's request arrives now

    await sync;

    // FAILS on d0b60c7 and on 594a71d: A's two deletion records are saved in what is now B's storage on the phone,
    // and written into B's history in the cloud, as B. A deletion record of a project is the project's NAME:
    // account B's own project "Lot 9" is from then on a deleted project to every device of account B.
    expect(savedOnPhone()).toEqual([]);
    expect(mockWrites.filter(write => write.as === 'account-b')).toEqual([]);
    expect(mockCloudHistory['account-b']).toEqual([]);
  });

  it('the phone\'s own list goes up a hundred records at a time: he signs out and in as B while the first hundred are going up, and the rest are not uploaded as B', async () => {
    // Account A's phone holds 150 deletion records (a long-used account holds hundreds; every Sync Now sends them all
    // again, DAVE_SYNC_TOMBSTONE_UPLOAD_BATCH_SIZE at a time, one request after another).
    const own = Array.from({ length: 150 }, (_, index) => ({ entityType: index === 149 ? 'project' : 'schedule_item', recordId: index === 149 ? 'Main St' : `task-${index}`, deletedAt: '2026-10-05T10:00:00.000Z' }));
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(own));
    mockUpload.hold = true; // the first hundred wait on weak signal
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockUpload.waiting);

    accountChangesToB();
    mockUpload.answer();

    await sync;

    // FAILS on d0b60c7 and on 594a71d: the remaining records of account A, the deletion of its project "Main St"
    // among them, are written into account B's history, as B.
    expect(mockWrites.filter(write => write.as === 'account-b').map(write => write.records.length)).toEqual([]);
    expect(mockCloudHistory['account-b'].map(record => `${record.entityType}:${record.recordId}`).filter(key => key === 'project:Main St')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// This batch's own tests.
// ---------------------------------------------------------------------------------------------------------------
const record = (entityType: string, recordId: string, deletedAt = '2026-10-01T10:00:00.000Z'): Deletion => ({ entityType, recordId, deletedAt });
const keys = (records: ReadonlyArray<{ entityType: string; recordId: string }>) => records.map(item => `${item.entityType}:${item.recordId}`).sort();
const cloudKeys = (account: Account) => keys(mockCloudHistory[account]);
const marks = () => JSON.parse(mockStorage.get(DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY) ?? 'null') as string[] | null;
/** The phone's store as the account boundary (services/OwnerStorageSandbox.ts) needs it. */
const boundaryStorage = {
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
  removeItem: async (key: string) => { mockStorage.delete(key); },
  getAllKeys: async () => [...mockStorage.keys()],
  multiGet: async (wanted: readonly string[]) => wanted.map(key => [key, mockStorage.get(key) ?? null] as const),
  multiSet: async (entries: readonly (readonly [string, string])[]) => { entries.forEach(([key, value]) => mockStorage.set(key, value)); },
  multiRemove: async (wanted: readonly string[]) => { wanted.forEach(key => mockStorage.delete(key)); },
};
/** The real account boundary, and the sign-in telling the app, in the order entry.ts and the sign-in events do it. */
function phone() {
  const sandbox = createOwnerStorageSandbox({ storage: boundaryStorage });
  return {
    async signIn(account: Account) {
      mockSignedIn = account;
      noteSignedInOwner(account);
      await sandbox.activateOwner(account);
    },
    async signOut() {
      noteSignedInOwner(null);
      await sandbox.activateOwner(null);
    },
  };
}

describe('G5: every step is for the account that began it', () => {
  it('the cloud is asked, and each hundred is uploaded, "as" the account that is signed in: the cloud layer then refuses under any other', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(Array.from({ length: 150 }, (_, index) => record('schedule_item', `task-${index}`))));
    await synchronizeDAVESyncTombstones();
    expect(mockToldToBeMadeAs).toEqual([
      { call: 'read', as: 'account-a' }, { call: 'upload', as: 'account-a' }, { call: 'upload', as: 'account-a' },
    ]);
    mockToldToBeMadeAs.length = 0;
    await recordDAVESyncTombstones([{ entityType: 'project_area', recordId: 'area-1' }]);
    await refreshDAVESyncTombstonesFromCloud();
    expect(mockToldToBeMadeAs).toEqual([{ call: 'upload', as: 'account-a' }, { call: 'read', as: 'account-a' }]);
  });

  it('the account changes while A\'s history is being read: the answer holds no records, is not authoritative, and says why', async () => {
    mockCloudHistory['account-a'] = [record('project', 'Lot 9'), record('schedule_item', 'task-of-a')];
    mockRead.hold = true;
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    accountChangesToB();
    mockRead.answer();
    await expect(sync).resolves.toMatchObject({ tombstones: [], cloudAuthoritative: false, cloudError: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(marks()).toBeNull(); // and nothing at all was written into B's storage
    expect([...mockStorage.keys()]).toEqual([]);
  });

  it('the account changes while the phone\'s own list is going up: the answer no longer hands A\'s list to whoever asked', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('project', 'Main St')]));
    mockUpload.hold = true;
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockUpload.waiting);
    accountChangesToB();
    mockUpload.answer();
    await expect(sync).resolves.toMatchObject({ tombstones: [], cloudAuthoritative: false, cloudError: CLOUD_ACCOUNT_CHANGED_MESSAGE });
  });

  it('a synchronization under way for A is not handed to B: B waits for it and gets its own history', async () => {
    mockCloudHistory['account-a'] = [record('project', 'Lot 9')];
    mockCloudHistory['account-b'] = [record('schedule_item', 'task-of-b')];
    mockRead.hold = true;
    const ofA = synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    accountChangesToB();
    const ofB = synchronizeDAVESyncTombstones(); // B's first sync starts while A's read is still out
    mockRead.answer();
    expect(keys((await ofA).tombstones)).toEqual([]);
    const answer = await ofB;
    expect(answer.cloudAuthoritative).toBe(true);
    expect(keys(answer.tombstones)).toEqual(['schedule_item:task-of-b']);
    expect(savedOnPhone()).toEqual(['schedule_item:task-of-b']);
    expect(cloudKeys('account-b')).toEqual(['schedule_item:task-of-b']);
  });

  it('the same for the quick read the upload pass makes: A\'s read under way is not B\'s answer', async () => {
    mockCloudHistory['account-a'] = [record('project', 'Lot 9')];
    mockCloudHistory['account-b'] = [record('schedule_item', 'task-of-b')];
    mockRead.hold = true;
    const ofA = loadDAVEOperationalTombstones();
    await waitFor(() => mockRead.waiting);
    accountChangesToB();
    const ofB = loadDAVEOperationalTombstones();
    mockRead.answer();
    await expect(ofA).resolves.toMatchObject({ tombstones: [], cloudAuthoritative: false, cloudError: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(keys((await ofB).tombstones)).toEqual(['schedule_item:task-of-b']);
    expect(savedOnPhone()).toEqual(['schedule_item:task-of-b']);
  });

  it('wherever among the phone\'s own reads and saves the account changes during a sync: nothing is saved after it, and none of the first account\'s records is handed back or uploaded as B', async () => {
    const AsyncStorage = (jest.requireMock('@react-native-async-storage/async-storage') as { default: { getItem: jest.Mock; setItem: jest.Mock } }).default;
    /** One sync of account A; the account changes as the phone's n-th read or save answers. */
    const run = async (changeAt: number) => {
      mockStorage.clear();
      mockSignedIn = 'account-a';
      noteSignedInOwner('account-a');
      mockWrites.length = 0;
      mockCloudHistory['account-a'] = [record('project', 'Lot 9')];
      mockCloudHistory['account-b'] = [];
      mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('schedule_item', 'task-1')]));
      let steps = 0;
      let changed = false;
      const savedAfter: string[] = [];
      const step = () => {
        steps += 1;
        if (steps === changeAt) {
          changed = true;
          accountChangesToB();
        }
      };
      AsyncStorage.getItem.mockImplementation(async (key: string) => {
        const value = mockStorage.get(key) ?? null;
        step();
        return value;
      });
      AsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
        if (changed) savedAfter.push(key);
        mockStorage.set(key, value);
        step();
      });
      const answer = await synchronizeDAVESyncTombstones();
      return { steps, changed, savedAfter, handedBack: keys(answer.tombstones), asB: mockWrites.filter(write => write.as === 'account-b') };
    };
    try {
      const whole = await run(-1);
      expect(whole.handedBack).toEqual(['project:Lot 9', 'schedule_item:task-1']);
      expect(whole.steps).toBeGreaterThanOrEqual(4); // the list, the marks (read, decided, saved), the list saved
      for (let at = 1; at <= whole.steps; at += 1) {
        const cut = await run(at);
        expect([at, cut.changed, cut.savedAfter, cut.handedBack, cut.asB]).toEqual([at, true, [], [], []]);
      }
    } finally {
      AsyncStorage.getItem.mockImplementation(async (key: string) => mockStorage.get(key) ?? null);
      AsyncStorage.setItem.mockImplementation(async (key: string, value: string) => { mockStorage.set(key, value); });
    }
  });

  it('150 deletions made at once on this phone (a schedule and its tasks): the account changes while the first hundred go up, and the rest are not uploaded as B', async () => {
    mockUpload.hold = true;
    const made = recordDAVESyncTombstones(Array.from({ length: 150 }, (_, index) => ({ entityType: 'schedule_item' as const, recordId: `task-${index}` })));
    await waitFor(() => mockUpload.waiting);
    expect(savedOnPhone()).toHaveLength(150); // saved under A before anything is sent
    accountChangesToB();
    mockUpload.answer();
    await made;
    expect(mockWrites.map(write => [write.as, write.records.length])).toEqual([['account-a', 100]]);
    expect(mockCloudHistory['account-b']).toEqual([]);
  });

  it('a deletion whose save is overtaken by a change of account is not written into the next account\'s list', async () => {
    // The list's lock is held by an earlier save, so this deletion's own save starts after the account has changed.
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const AsyncStorage = (jest.requireMock('@react-native-async-storage/async-storage') as { default: { getItem: jest.Mock } }).default;
    AsyncStorage.getItem.mockImplementationOnce(async (key: string) => { await held; return mockStorage.get(key) ?? null; });
    const first = loadDAVESyncTombstones();
    const made = recordDAVESyncTombstones([{ entityType: 'project', recordId: 'Lot 9' }]);
    accountChangesToB();
    release();
    await first;
    await expect(made).rejects.toThrow(CLOUD_ACCOUNT_CHANGED_MESSAGE);
    expect(savedOnPhone()).toEqual([]);
    expect(mockWrites).toEqual([]);
  });
});

describe('G5: with the phone\'s real account boundary, each account keeps its own, and has it again when it signs in again', () => {
  it('A syncs, signs out, B signs in and syncs, B signs out, A signs in: A\'s records are A\'s, B\'s are B\'s, on the phone and in the cloud', async () => {
    const device = phone();
    mockCloudHistory['account-a'] = [record('project', 'Lot 9')];
    mockCloudHistory['account-b'] = [record('schedule_item', 'task-of-b')];
    await device.signIn('account-a');
    await recordDAVESyncTombstones([{ entityType: 'schedule_item', recordId: 'task-of-a' }]);
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    await device.signOut();
    await device.signIn('account-b');
    expect(savedOnPhone()).toEqual([]);
    const ofB = await synchronizeDAVESyncTombstones();
    expect(keys(ofB.tombstones)).toEqual(['schedule_item:task-of-b']);
    expect(cloudKeys('account-b')).toEqual(['schedule_item:task-of-b']);
    await device.signOut();
    await device.signIn('account-a');
    expect(savedOnPhone().sort()).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    expect(cloudKeys('account-a')).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
    expect(mockWrites.every(write => write.records.every(key => (write.as === 'account-a') === (key !== 'schedule_item:task-of-b')))).toBe(true);
  });

  it('A\'s read is cut by the change of account, with the real boundary: nothing of A\'s is in B\'s list, and A has all of it at its next sync', async () => {
    const device = phone();
    mockCloudHistory['account-a'] = [record('project', 'Lot 9'), record('schedule_item', 'task-of-a')];
    await device.signIn('account-a');
    mockRead.hold = true;
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    await device.signOut();
    await device.signIn('account-b');
    mockRead.answer();
    expect((await sync).tombstones).toEqual([]);
    expect(savedOnPhone()).toEqual([]);
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual([]); // B's own sync: B has deleted nothing
    expect(cloudKeys('account-b')).toEqual([]);
    await device.signOut();
    await device.signIn('account-a');
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['project:Lot 9', 'schedule_item:task-of-a']);
  });
});

describe('G5: one account only: nothing moves', () => {
  it('a token refresh in the middle of a sync (the same account is told again): the sync finishes as before', async () => {
    mockCloudHistory['account-a'] = [record('project', 'Lot 9')];
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('schedule_item', 'task-1')]));
    mockRead.hold = true;
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    noteSignedInOwner('account-a'); // TOKEN_REFRESHED names the same account
    mockRead.answer();
    const answer = await sync;
    expect(answer).toMatchObject({ cloudAuthoritative: true, cloudError: null, uploadFailures: 0 });
    expect(keys(answer.tombstones)).toEqual(['project:Lot 9', 'schedule_item:task-1']);
    expect(cloudKeys('account-a')).toEqual(['project:Lot 9', 'schedule_item:task-1']);
  });

  it('the same account signs out and in again in the middle of a sync: that sync answers "the account changed" once, and the next sends everything', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('schedule_item', 'task-1')]));
    mockRead.hold = true;
    const sync = synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    noteSignedInOwner(null);
    noteSignedInOwner('account-a'); // the storage is this account's again: nothing was taken out for good
    mockRead.answer();
    await expect(sync).resolves.toMatchObject({ tombstones: [], cloudAuthoritative: false, cloudError: CLOUD_ACCOUNT_CHANGED_MESSAGE });
    expect(savedOnPhone()).toEqual(['schedule_item:task-1']); // not lost
    const next = await synchronizeDAVESyncTombstones();
    expect(next).toMatchObject({ cloudAuthoritative: true, uploadFailures: 0 });
    expect(keys(next.tombstones)).toEqual(['schedule_item:task-1']);
    expect(cloudKeys('account-a')).toEqual(['schedule_item:task-1']);
  });

  it('"offline, sign-in pending" (the account is known, the cloud does not answer): the phone\'s own list still protects, and is counted as not uploaded, as before', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('schedule_item', 'task-1')]));
    mockCloud.reachable = false;
    const answer = await synchronizeDAVESyncTombstones();
    expect(answer).toMatchObject({ cloudAuthoritative: false, cloudError: 'Network request failed', uploadFailures: 1 });
    expect(keys(answer.tombstones)).toEqual(['schedule_item:task-1']);
    await expect(recordDAVESyncTombstones([{ entityType: 'project_area', recordId: 'area-1' }])).resolves.toHaveLength(1);
    expect(keys(await loadDAVESyncTombstones())).toEqual(['project_area:area-1', 'schedule_item:task-1']);
    mockCloud.reachable = true;
    expect((await synchronizeDAVESyncTombstones()).uploadFailures).toBe(0);
    expect(cloudKeys('account-a')).toEqual(['project_area:area-1', 'schedule_item:task-1']);
  });

  it('before the app knows who is signed in nothing is held, and learning the account is not a change', async () => {
    let fresh!: typeof import('../../services/DAVESyncTombstones');
    let binding!: typeof import('../../services/CloudOwnerBinding');
    jest.isolateModules(() => {
      fresh = require('../../services/DAVESyncTombstones');
      binding = require('../../services/CloudOwnerBinding');
    });
    expect(binding.currentCloudOwner().ownerId).toBeUndefined();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([record('schedule_item', 'task-1')]));
    mockRead.hold = true;
    const sync = fresh.synchronizeDAVESyncTombstones();
    await waitFor(() => mockRead.waiting);
    binding.noteSignedInOwner('account-a'); // the first sign-in event arrives
    mockRead.answer();
    const answer = await sync;
    expect(answer.cloudAuthoritative).toBe(true);
    expect(keys(answer.tombstones)).toEqual(['schedule_item:task-1']);
    expect(mockWrites.map(write => write.records)).toEqual([['schedule_item:task-1']]);
    expect(marks()).toBeNull(); // nothing was decided about the records while no account was known
  });
});

describe('G5: records an earlier build left on the phone', () => {
  const left = [record('project', 'Lot 9'), record('schedule_item', 'task-1'), record('schedule_item', 'task-2')];
  /** The boundary's own records after account A, and then account B, have used this phone (B is signed in). */
  async function twoAccountsHaveUsedThisPhone() {
    const device = phone();
    await device.signIn('account-a');
    await device.signOut();
    await device.signIn('account-b');
  }

  it('one account only has ever used this phone: nothing can have been mixed, and they are its own, as before', async () => {
    const device = phone();
    await device.signIn('account-a');
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(false);
    const answer = await synchronizeDAVESyncTombstones();
    expect(keys(answer.tombstones)).toEqual(keys(left));
    expect(cloudKeys('account-a')).toEqual(keys(left));
    expect(marks()).toEqual([]);
  });

  it('the boundary knows of another account: a record the signed-in account\'s cloud history does not hold is not uploaded as anyone and is in no answer, and it is kept exactly as it was', async () => {
    await twoAccountsHaveUsedThisPhone();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    mockCloudHistory['account-b'] = [record('schedule_item', 'task-2', '2026-09-30T08:00:00.000Z')]; // B's cloud says: this one is B's
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-b')).resolves.toBe(true);

    const answer = await synchronizeDAVESyncTombstones();

    expect(answer.cloudAuthoritative).toBe(true);
    expect(keys(answer.tombstones)).toEqual(['schedule_item:task-2']); // nothing else can delete, drop or hold anything
    expect(mockWrites).toEqual([{ as: 'account-b', records: ['schedule_item:task-2'] }]);
    expect(cloudKeys('account-b')).toEqual(['schedule_item:task-2']);
    expect(savedOnPhone().sort()).toEqual(keys(left)); // all three still on the phone
    expect(marks()).toEqual(['project:lot 9|2026-10-01T10:00:00.000Z', 'schedule_item:task-1|2026-10-01T10:00:00.000Z']);
    expect(keys(await loadDAVESyncTombstones())).toEqual(['schedule_item:task-2']);
    expect(keys((await loadDAVEOperationalTombstones()).tombstones)).toEqual(['schedule_item:task-2']);
    expect(keys((await refreshDAVESyncTombstonesFromCloud()).tombstones)).toEqual(['schedule_item:task-2']);
  });

  it('with no signal at the first start of this build they wait: none is in an answer or uploaded until the cloud has said which are this account\'s', async () => {
    await twoAccountsHaveUsedThisPhone();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    mockCloudHistory['account-b'] = left.slice(1);
    mockCloud.reachable = false;
    const offline = await synchronizeDAVESyncTombstones();
    expect(offline).toMatchObject({ tombstones: [], cloudAuthoritative: false, uploadFailures: 0 });
    expect(mockToldToBeMadeAs.filter(told => told.call === 'upload')).toEqual([]);
    mockCloud.reachable = true;
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['schedule_item:task-1', 'schedule_item:task-2']);
    expect(marks()).toEqual(['project:lot 9|2026-10-01T10:00:00.000Z']);
  });

  it('the mark goes when this account deletes the same thing itself, and that deletion counts and is uploaded as this account', async () => {
    await twoAccountsHaveUsedThisPhone();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    await synchronizeDAVESyncTombstones();
    expect(marks()).toHaveLength(3);
    await recordDAVESyncTombstones([{ entityType: 'project', recordId: 'Lot 9' }], '2026-10-06T09:00:00.000Z');
    expect(marks()).toEqual(['schedule_item:task-1|2026-10-01T10:00:00.000Z', 'schedule_item:task-2|2026-10-01T10:00:00.000Z']);
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['project:Lot 9']);
    expect(cloudKeys('account-b')).toEqual(['project:Lot 9']);
  });

  it('decided once: a record that anything adds to the list afterwards (a project deletion writes the list itself) is this account\'s own', async () => {
    await twoAccountsHaveUsedThisPhone();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    await synchronizeDAVESyncTombstones();
    // As services/ProjectDeletionTransaction.ts writes it: the whole list, with the new records merged in. A newer
    // deletion of "Lot 9" by this account replaces the older record of unknown account.
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([
      record('project', 'Lot 9', '2026-10-06T09:00:00.000Z'), record('project_area', 'area-9', '2026-10-06T09:00:00.000Z'), ...left.slice(1),
    ]));
    const answer = await synchronizeDAVESyncTombstones();
    expect(keys(answer.tombstones)).toEqual(['project:Lot 9', 'project_area:area-9']);
    expect(cloudKeys('account-b')).toEqual(['project:Lot 9', 'project_area:area-9']);
    expect(marks()).toEqual(['schedule_item:task-1|2026-10-01T10:00:00.000Z', 'schedule_item:task-2|2026-10-01T10:00:00.000Z']);
  });

  it('a list of marks that cannot be read: every record there is waits for the cloud\'s word', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify(left));
    mockStorage.set(DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY, '{not a list');
    mockCloudHistory['account-a'] = [left[0]];
    expect(keys((await synchronizeDAVESyncTombstones()).tombstones)).toEqual(['project:Lot 9']);
    expect(marks()).toHaveLength(2);
  });

  it('the boundary\'s own question: an account set aside while signed out, or a boundary record that cannot be read, counts as another account', async () => {
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(false); // nothing recorded at all
    mockStorage.set(OWNER_STORAGE_SANDBOX_METADATA_KEY, '{broken');
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(true);
    mockStorage.set(OWNER_STORAGE_SANDBOX_METADATA_KEY, JSON.stringify({ version: 1, activeOwnerId: 'account-a', legacyAssignedOwnerId: null, lastOwnerId: 'account-a', updatedAt: '2026-10-06T00:00:00.000Z' }));
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(false);
    mockStorage.set('@vitruvius/owner-storage-sandbox/quarantine/set-aside-1', '{}');
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(true);
    mockStorage.delete('@vitruvius/owner-storage-sandbox/quarantine/set-aside-1');
    mockStorage.set(OWNER_STORAGE_SANDBOX_METADATA_KEY, JSON.stringify({ version: 1, activeOwnerId: 'account-a', legacyAssignedOwnerId: 'account-b', lastOwnerId: 'account-a', updatedAt: '2026-10-06T00:00:00.000Z' }));
    await expect(anotherAccountHasUsedThisPhone(boundaryStorage, 'account-a')).resolves.toBe(true);
  });
});
