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
    expect(result.uploadFailures).toBe(1);
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
    jest.advanceTimersByTime(1_500);
    await Promise.resolve();
    const result = await resultPromise;

    expect(result.cloudAuthoritative).toBe(false);
    expect(result.tombstones.map(item => item.recordId)).toEqual(['known-delete']);
    expect(mockUpsertTombstone).not.toHaveBeenCalled();
  });
});
