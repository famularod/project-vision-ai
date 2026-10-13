/**
 * Audit P1-28: deletion history is a durable journal — corrupt bytes are
 * quarantined for recovery (never replaced by []), and unacknowledged cloud
 * uploads surface as a countable partial-sync condition.
 */

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

const mockListTombstones = jest.fn();
const mockUpsertTombstone = jest.fn();

jest.mock('../../services/SupabaseService', () => ({
  listDAVESyncTombstones: (...args: unknown[]) => mockListTombstones(...args),
  upsertDAVESyncTombstone: (...args: unknown[]) => mockUpsertTombstone(...args),
  upsertDAVESyncTombstones: async (tombstones: unknown[]) => {
    const results = await Promise.all(tombstones.map(tombstone =>
      mockUpsertTombstone(tombstone)));
    return results.find(result => result?.ok === false) || {
      ok: true,
      configured: true,
      stubbed: false,
      data: tombstones,
    };
  },
}));

import {
  DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY,
  DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
  loadDAVEOperationalTombstones,
  loadDAVESyncTombstones,
  loadQuarantinedDAVESyncTombstones,
  recordDAVESyncTombstone,
  refreshDAVESyncTombstonesFromCloud,
  synchronizeDAVESyncTombstones,
} from '../../services/DAVESyncTombstones';

function cloudOk(data: unknown[] = []) {
  return { ok: true, configured: true, stubbed: false, data };
}

function upsertOk() {
  return { ok: true, configured: true, stubbed: false, data: null };
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockStorage.clear();
  mockListTombstones.mockResolvedValue(cloudOk());
  mockUpsertTombstone.mockResolvedValue(upsertOk());
});

describe('DAVESyncTombstones durability (audit P1-28)', () => {
  it('quarantines corrupt journal bytes instead of silently discarding them', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, '{corrupt json!!');

    await expect(loadDAVESyncTombstones()).rejects.toThrow(/was corrupt and was quarantined/i);

    const quarantined = await loadQuarantinedDAVESyncTombstones();
    expect(quarantined?.raw).toBe('{corrupt json!!');
    expect(quarantined?.quarantinedAt).toBeTruthy();
    expect(mockStorage.has(DAVE_SYNC_TOMBSTONES_STORAGE_KEY)).toBe(false);
    expect([...mockStorage.values()]).toContain('{corrupt json!!');
    await expect(loadDAVESyncTombstones()).resolves.toEqual([]);
  });

  it('keeps the first quarantined payload when corruption repeats', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'first-corruption');
    await expect(loadDAVESyncTombstones()).rejects.toThrow(/quarantined/i);
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'second-corruption');
    await expect(loadDAVESyncTombstones()).rejects.toThrow(/quarantined/i);

    const quarantined = await loadQuarantinedDAVESyncTombstones();
    expect(quarantined?.raw).toBe('first-corruption');
    expect([...mockStorage.values()]).toEqual(expect.arrayContaining([
      'first-corruption',
      'second-corruption',
    ]));
  });

  it('journals new deletions after corruption without losing the quarantine', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'corrupt');
    await expect(loadDAVESyncTombstones()).rejects.toThrow(/quarantined/i);

    await recordDAVESyncTombstone('schedule_item', 'task-1');

    const tombstones = await loadDAVESyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].recordId).toBe('task-1');
    expect((await loadQuarantinedDAVESyncTombstones())?.raw).toBe('corrupt');
  });

  it('salvages valid rows but fails the discovering operation before mutation', async () => {
    const valid = {
      entityType: 'schedule_item',
      recordId: 'keep-delete',
      deletedAt: '2026-07-18T12:00:00.000Z',
    };
    mockStorage.set(
      DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
      JSON.stringify([valid, { entityType: 'schedule_item', recordId: '' }]),
    );

    await expect(recordDAVESyncTombstone('project_area', 'new-delete'))
      .rejects.toThrow(/1 valid record was preserved/i);
    expect(JSON.parse(mockStorage.get(DAVE_SYNC_TOMBSTONES_STORAGE_KEY) || '[]'))
      .toEqual([valid]);

    await recordDAVESyncTombstone('project_area', 'new-delete');
    expect((await loadDAVESyncTombstones()).map(item => item.recordId).sort())
      .toEqual(['keep-delete', 'new-delete']);
  });

  it('counts unacknowledged uploads as failures in the sync result', async () => {
    await recordDAVESyncTombstone('project_area', 'area-1');
    await recordDAVESyncTombstone('schedule_item', 'task-2');
    mockUpsertTombstone
      .mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'rls' })
      .mockResolvedValue(upsertOk());

    const result = await synchronizeDAVESyncTombstones();

    expect(result.cloudAuthoritative).toBe(true);
    expect(result.uploadFailures).toBe(2);
    // The failed tombstone remains journaled for the next pass.
    expect(result.tombstones).toHaveLength(2);
  });

  it('rebuilds a corrupt local journal only after an authoritative cloud read', async () => {
    const cloudTombstone = {
      entityType: 'schedule_item' as const,
      recordId: 'task-stays-deleted',
      deletedAt: '2026-07-20T12:00:00.000Z',
    };
    mockStorage.set(
      DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
      JSON.stringify([{
        ...cloudTombstone,
        deletedAt: 'Cloud sync could not finish. Your changes remain saved on this phone and will be retried.',
      }]),
    );
    mockListTombstones.mockResolvedValue(cloudOk([cloudTombstone]));

    const result = await synchronizeDAVESyncTombstones();

    expect(result.cloudAuthoritative).toBe(true);
    expect(result.tombstones).toEqual([cloudTombstone]);
    expect(await loadDAVESyncTombstones()).toEqual([cloudTombstone]);
    expect((await loadQuarantinedDAVESyncTombstones())?.raw)
      .toContain('Cloud sync could not finish');
  });

  it('reports zero upload failures when the cloud acknowledges everything', async () => {
    await recordDAVESyncTombstone('reference_document', 'doc-1');

    const result = await synchronizeDAVESyncTombstones();

    expect(result.uploadFailures).toBe(0);
  });

  it('refreshes deletion history for live reads without re-uploading the journal', async () => {
    await recordDAVESyncTombstone('schedule_item', 'local-delete');
    mockUpsertTombstone.mockClear();
    mockListTombstones.mockResolvedValue(cloudOk([{
      entityType: 'project_area',
      recordId: 'cloud-delete',
      deletedAt: '2026-07-22T00:00:00.000Z',
    }]));

    const result = await refreshDAVESyncTombstonesFromCloud();

    expect(result.cloudAuthoritative).toBe(true);
    expect(result.tombstones.map(item => item.recordId).sort())
      .toEqual(['cloud-delete', 'local-delete']);
    expect(mockUpsertTombstone).not.toHaveBeenCalled();
  });

  it('falls back to durable deletion history when the live cloud read stalls', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, JSON.stringify([{
      entityType: 'schedule_item',
      recordId: 'known-delete',
      deletedAt: '2026-07-22T00:00:00.000Z',
    }]));
    mockListTombstones.mockImplementation(() => new Promise(() => undefined));
    jest.useFakeTimers();

    const resultPromise = loadDAVEOperationalTombstones();
    jest.advanceTimersByTime(8_000);
    await Promise.resolve();
    const result = await resultPromise;

    expect(result.cloudAuthoritative).toBe(false);
    expect(result.tombstones.map(item => item.recordId)).toEqual(['known-delete']);
    expect(mockUpsertTombstone).not.toHaveBeenCalled();

    mockListTombstones.mockResolvedValue(cloudOk([{
      entityType: 'project_update',
      recordId: 'recovered-cloud-delete',
      deletedAt: '2026-07-23T00:00:00.000Z',
    }]));
    const recovered = await loadDAVEOperationalTombstones();
    expect(recovered.cloudAuthoritative).toBe(true);
    expect(recovered.tombstones.map(item => item.recordId).sort())
      .toEqual(['known-delete', 'recovered-cloud-delete']);
  });

  it('accepts a healthy authoritative refresh that completes after the former short timeout', async () => {
    jest.useFakeTimers();
    mockListTombstones.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(cloudOk([{
        entityType: 'project_update',
        recordId: 'archived-update',
        deletedAt: '2026-07-22T00:00:00.000Z',
      }])), 2_000);
    }));

    const resultPromise = loadDAVEOperationalTombstones();
    jest.advanceTimersByTime(2_000);
    await Promise.resolve();
    const result = await resultPromise;

    expect(result.cloudAuthoritative).toBe(true);
    expect(result.cloudError).toBeNull();
    expect(result.tombstones.map(item => item.recordId)).toEqual(['archived-update']);
    expect(mockUpsertTombstone).not.toHaveBeenCalled();
  });
});

/**
 * Sync batch Y3, item 7 (6 Oct 2026). Open item: "Sync Now can reuse a
 * deletion-history download that was already under way, so 'caught up' can
 * be recorded slightly early." Settings records this device as caught up
 * from the moment Sync Now was pressed (audit A6 pass 11), but the deletion
 * history it used could be one whose read of the cloud began before that.
 */
describe('a sync that must use a deletion history read after it was asked for (sync batch Y3, item 7)', () => {
  const deletion = (recordId: string) => ({
    entityType: 'schedule_item' as const, recordId, deletedAt: '2026-10-06T12:00:00.000Z',
  });
  /** The cloud's deletion history, answered when the test lets each read go. */
  function slowCloud() {
    const inCloud: Array<ReturnType<typeof deletion>> = [];
    const waiting: Array<() => void> = [];
    mockListTombstones.mockImplementation(() => {
      const asRead = [...inCloud]; // what the cloud holds when this read begins
      return new Promise(resolve => { waiting.push(() => resolve(cloudOk(asRead))); });
    });
    const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await Promise.resolve(); };
    return {
      inCloud,
      reads: () => mockListTombstones.mock.calls.length,
      answerNext: async () => { waiting.shift()?.(); await settle(); },
      settle,
    };
  }

  it('Sync Now pressed while a background synchronization is under way: it reads the history again, and hears a deletion made in between', async () => {
    const cloud = slowCloud();
    const background = synchronizeDAVESyncTombstones(); // already under way: its read began before the press
    await cloud.settle();
    expect(cloud.reads()).toBe(1);
    cloud.inCloud.push(deletion('deleted-on-the-ipad-just-now'));
    const pressedAt = new Date().toISOString();
    const syncNow = synchronizeDAVESyncTombstones({ beganAfterThisCall: true });
    await cloud.settle();
    expect(cloud.reads()).toBe(1); // two never run at once: it waits for the one under way

    await cloud.answerNext();
    expect((await background).tombstones).toEqual([]);
    expect(cloud.reads()).toBe(2); // and then reads again, for itself
    await cloud.answerNext();
    const result = await syncNow;
    expect(result.cloudAuthoritative).toBe(true);
    expect(result.tombstones.map(item => item.recordId)).toEqual(['deleted-on-the-ipad-just-now']);
    expect(Date.parse(result.readStartedAt!)).toBeGreaterThanOrEqual(Date.parse(pressedAt));
  });

  it('as before: any other caller shares the synchronization under way, and one read serves them all', async () => {
    const cloud = slowCloud();
    const first = synchronizeDAVESyncTombstones();
    const second = synchronizeDAVESyncTombstones();
    await cloud.settle();
    await cloud.answerNext();
    expect(await first).toBe(await second);
    expect(cloud.reads()).toBe(1);
  });

  it('a synchronization that began after Sync Now was pressed is as good as its own: a second Sync Now caller shares it', async () => {
    const cloud = slowCloud();
    const syncNow = synchronizeDAVESyncTombstones({ beganAfterThisCall: true });
    await cloud.settle();
    const other = synchronizeDAVESyncTombstones(); // a background caller joins Sync Now's
    await cloud.settle();
    expect(cloud.reads()).toBe(1);
    await cloud.answerNext();
    expect(await other).toBe(await syncNow);
    expect(cloud.reads()).toBe(1);
  });

  it('two callers that each need a fresh read, waiting behind one under way: one new read serves both', async () => {
    const cloud = slowCloud();
    const background = synchronizeDAVESyncTombstones();
    await cloud.settle();
    const one = synchronizeDAVESyncTombstones({ beganAfterThisCall: true });
    const two = synchronizeDAVESyncTombstones({ beganAfterThisCall: true });
    await cloud.settle();
    await cloud.answerNext();
    await background;
    await cloud.settle();
    await cloud.answerNext();
    expect(await one).toBe(await two);
    expect(cloud.reads()).toBe(2);
  });

  it('the one under way fails: the fresh read is still made, and its answer is the one used', async () => {
    const cloud = slowCloud();
    mockListTombstones.mockImplementationOnce(() => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('offline')), 1); }));
    const background = synchronizeDAVESyncTombstones();
    const syncNow = synchronizeDAVESyncTombstones({ beganAfterThisCall: true });
    expect((await background).cloudAuthoritative).toBe(false);
    await cloud.settle();
    await cloud.answerNext();
    expect((await syncNow).cloudAuthoritative).toBe(true);
  });

  it("Settings' Sync Now asks for it: Full Sync reads the deletion history that way, and only Full Sync does", () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../services/SyncService.ts'), 'utf8');
    const fullSync = source.slice(source.indexOf('export async function synchronizeLocalData'));
    expect(fullSync.slice(0, fullSync.indexOf('\nexport ', 10)))
      .toContain("const tombstoneSync = await synchronizeDAVESyncTombstones({ beganAfterThisCall: true });");
    expect(source.split('synchronizeDAVESyncTombstones({ beganAfterThisCall: true })')).toHaveLength(2);
  });
});
