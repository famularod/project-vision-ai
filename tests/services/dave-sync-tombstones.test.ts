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
  loadDAVESyncTombstones,
  loadQuarantinedDAVESyncTombstones,
  recordDAVESyncTombstone,
  synchronizeDAVESyncTombstones,
} from '../../services/DAVESyncTombstones';

function cloudOk(data: unknown[] = []) {
  return { ok: true, configured: true, stubbed: false, data };
}

function upsertOk() {
  return { ok: true, configured: true, stubbed: false, data: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockListTombstones.mockResolvedValue(cloudOk());
  mockUpsertTombstone.mockResolvedValue(upsertOk());
});

describe('DAVESyncTombstones durability (audit P1-28)', () => {
  it('quarantines corrupt journal bytes instead of silently discarding them', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, '{corrupt json!!');

    const tombstones = await loadDAVESyncTombstones();

    expect(tombstones).toEqual([]);
    const quarantined = await loadQuarantinedDAVESyncTombstones();
    expect(quarantined?.raw).toBe('{corrupt json!!');
    expect(quarantined?.quarantinedAt).toBeTruthy();
    expect(mockStorage.has(DAVE_SYNC_TOMBSTONES_STORAGE_KEY)).toBe(false);
  });

  it('keeps the first quarantined payload when corruption repeats', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'first-corruption');
    await loadDAVESyncTombstones();
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'second-corruption');
    await loadDAVESyncTombstones();

    const quarantined = await loadQuarantinedDAVESyncTombstones();
    expect(quarantined?.raw).toBe('first-corruption');
  });

  it('journals new deletions after corruption without losing the quarantine', async () => {
    mockStorage.set(DAVE_SYNC_TOMBSTONES_STORAGE_KEY, 'corrupt');
    await loadDAVESyncTombstones();

    await recordDAVESyncTombstone('schedule_item', 'task-1');

    const tombstones = await loadDAVESyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].recordId).toBe('task-1');
    expect((await loadQuarantinedDAVESyncTombstones())?.raw).toBe('corrupt');
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

  it('reports zero upload failures when the cloud acknowledges everything', async () => {
    await recordDAVESyncTombstone('reference_document', 'doc-1');

    const result = await synchronizeDAVESyncTombstones();

    expect(result.uploadFailures).toBe(0);
  });
});
