import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  queueProjectUpdateArchive,
  queueProjectUpdateDelete,
  removeProjectUpdateFromSyncQueue,
} from '../../services/SyncService';
import {
  persistAndQueueProjectUpdateDeletion,
  reconcileProjectUpdateDeletionJournal,
} from '../../services/updateService';
import type { ProjectUpdate } from '../../types';

const mockStorage = new Map<string, string>();
const writeStorage = (key: string, value: string) => {
  mockStorage.set(key, value);
  return Promise.resolve();
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn(writeStorage),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('../../services/SyncService', () => ({
  queueProjectUpdateArchive: jest.fn(),
  queueProjectUpdateDelete: jest.fn(),
  removeProjectUpdateFromSyncQueue: jest.fn(),
}));

function update(id: string, notes: string): ProjectUpdate {
  return {
    id,
    projectName: '2375 Compliance Project',
    date: '2026-07-17',
    notes,
    photos: [],
    recipients: { contactIds: [] },
  };
}

describe('project update deletion persistence', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    jest.mocked(AsyncStorage.setItem).mockImplementation(writeStorage);
  });

  it('keeps unrelated changes that arrive while cloud deletion is being queued', async () => {
    const target = update('delete-me', 'Incorrect status');
    let currentUpdates = [target, update('keep-me', 'Original note')];
    let currentTombstones: Array<{ updateId: string }> = [];

    jest.mocked(queueProjectUpdateDelete).mockImplementation(async () => {
      currentUpdates = [
        target,
        update('keep-me', 'Background analysis completed'),
        update('new-update', 'Saved during deletion'),
      ];
      currentTombstones = [{ updateId: 'other-delete' }];
    });

    const result = await persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => currentUpdates,
      getCurrentTombstones: () => currentTombstones,
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    expect(result.remainingUpdates.map(item => [item.id, item.notes])).toEqual([
      ['keep-me', 'Background analysis completed'],
      ['new-update', 'Saved during deletion'],
    ]);
    expect(result.nextTombstones).toEqual([
      { updateId: 'delete-me' },
      { updateId: 'other-delete' },
    ]);
    expect(JSON.parse(mockStorage.get('updates') || '[]')).toEqual(result.remainingUpdates);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it('replays permanent deletions and account-wide archives after a restart', async () => {
    await reconcileProjectUpdateDeletionJournal([
      { updateId: 'permanent', action: 'delete_update_everywhere', deletedAt: '2026-07-19T08:00:00.000Z', cloudIdPresent: true },
      { updateId: 'archived', action: 'archive_sent_update', deletedAt: '2026-07-19T08:01:00.000Z', cloudIdPresent: true },
      { updateId: 'device-only-cloud', action: 'remove_from_device', deletedAt: '2026-07-19T08:02:00.000Z', cloudIdPresent: true },
      { updateId: 'device-only-draft', action: 'remove_from_device', deletedAt: '2026-07-19T08:03:00.000Z', cloudIdPresent: false },
    ]);

    expect(removeProjectUpdateFromSyncQueue).toHaveBeenCalledTimes(4);
    expect(queueProjectUpdateDelete).toHaveBeenCalledTimes(1);
    expect(queueProjectUpdateDelete).toHaveBeenCalledWith({ id: 'permanent' });
    expect(queueProjectUpdateArchive).toHaveBeenCalledTimes(2);
    expect(queueProjectUpdateArchive).toHaveBeenNthCalledWith(
      1,
      'archived',
      '2026-07-19T08:01:00.000Z',
    );
    expect(queueProjectUpdateArchive).toHaveBeenNthCalledWith(
      2,
      'device-only-cloud',
      '2026-07-19T08:02:00.000Z',
    );
  });

  it('keeps deletion intent when the cloud queue write is interrupted', async () => {
    const target = update('delete-offline', 'Incorrect status');
    const keep = update('keep-offline', 'Correct status');
    jest.mocked(queueProjectUpdateDelete).mockRejectedValueOnce(
      new Error('storage interrupted'),
    );

    const result = await persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => [target, keep],
      getCurrentTombstones: () => [],
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    expect(result.remainingUpdates).toEqual([keep]);
    expect(JSON.parse(mockStorage.get('tombstones') || '[]')).toEqual([
      { updateId: target.id },
    ]);
  });

  it('rolls forward after a one-time failure between tombstone and update writes', async () => {
    const target = update('delete-interrupted', 'Incorrect status');
    const keep = update('keep-interrupted', 'Correct status');
    mockStorage.set('updates', JSON.stringify([target, keep]));
    mockStorage.set('tombstones', '[]');
    let failUpdateWriteOnce = true;
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key === 'updates' && failUpdateWriteOnce) {
        failUpdateWriteOnce = false;
        throw new Error('interrupted after tombstone barrier');
      }
      mockStorage.set(key, value);
    });

    const result = await persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => [target, keep],
      getCurrentTombstones: () => [],
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    expect(result.phase).toBe('complete');
    expect(result.remainingUpdates).toEqual([keep]);
    expect(JSON.parse(mockStorage.get('tombstones') || '[]')).toEqual([
      { updateId: target.id },
    ]);
    expect(JSON.parse(mockStorage.get('updates') || '[]')).toEqual([keep]);
  });

  it('returns truthful barrier state when update-list cleanup keeps failing', async () => {
    const target = update('delete-barrier-only', 'Incorrect status');
    const keep = update('keep-barrier-only', 'Correct status');
    mockStorage.set('updates', JSON.stringify([target, keep]));
    mockStorage.set('tombstones', '[]');
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key === 'updates') throw new Error('persistent update-list failure');
      mockStorage.set(key, value);
    });

    const result = await persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => [target, keep],
      getCurrentTombstones: () => [],
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    expect(result).toMatchObject({
      phase: 'barrier_committed',
      remainingUpdates: [keep],
      nextTombstones: [{ updateId: target.id }],
    });
    expect(JSON.parse(mockStorage.get('tombstones') || '[]')).toEqual([
      { updateId: target.id },
    ]);
    expect(JSON.parse(mockStorage.get('updates') || '[]')).toEqual([target, keep]);
  });

  it('serializes overlapping deletions without restoring either update', async () => {
    const first = update('delete-first', 'First mistake');
    const second = update('delete-second', 'Second mistake');
    const keep = update('keep-both', 'Correct update');
    let currentUpdates = [first, second, keep];
    let currentTombstones: Array<{ updateId: string }> = [];
    let releaseFirstQueue: (() => void) | undefined;
    jest.mocked(queueProjectUpdateDelete)
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        releaseFirstQueue = resolve;
      }))
      .mockResolvedValueOnce();

    const firstDeletion = persistAndQueueProjectUpdateDeletion({
      update: first,
      tombstone: { updateId: first.id },
      getCurrentUpdates: () => currentUpdates,
      getCurrentTombstones: () => currentTombstones,
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });
    while (!releaseFirstQueue) await Promise.resolve();
    const secondDeletion = persistAndQueueProjectUpdateDeletion({
      update: second,
      tombstone: { updateId: second.id },
      getCurrentUpdates: () => currentUpdates,
      getCurrentTombstones: () => currentTombstones,
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    releaseFirstQueue();
    const firstResult = await firstDeletion;
    currentUpdates = firstResult.remainingUpdates;
    currentTombstones = firstResult.nextTombstones;
    const secondResult = await secondDeletion;

    expect(secondResult.remainingUpdates).toEqual([keep]);
    expect(secondResult.nextTombstones.map(item => item.updateId).sort()).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('quarantines a partially corrupt update store and requires a safe retry', async () => {
    const target = update('delete-after-recovery', 'Incorrect status');
    const keep = update('keep-after-recovery', 'Correct status');
    const exactRaw = JSON.stringify([target, keep, { id: '', photos: 'invalid' }]);
    mockStorage.set('updates', exactRaw);
    mockStorage.set('tombstones', '[]');

    const request = () => persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => [target, keep],
      getCurrentTombstones: () => [],
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    });

    await expect(request()).rejects.toThrow(/2 valid records were preserved/i);
    expect(jest.mocked(queueProjectUpdateDelete)).not.toHaveBeenCalled();
    expect(JSON.parse(mockStorage.get('updates') || '[]')).toEqual([target, keep]);
    expect([...mockStorage.entries()].some(([key, value]) =>
      key.startsWith('updates.corrupt.') && value === exactRaw,
    )).toBe(true);

    await expect(request()).resolves.toMatchObject({ remainingUpdates: [keep] });
  });

  it('never treats corrupt deletion barriers as an empty journal', async () => {
    const target = update('must-stay-protected', 'Incorrect status');
    mockStorage.set('updates', JSON.stringify([target]));
    mockStorage.set('tombstones', '{not-json');

    await expect(persistAndQueueProjectUpdateDeletion({
      update: target,
      tombstone: { updateId: target.id },
      getCurrentUpdates: () => [target],
      getCurrentTombstones: () => [],
      updatesStorageKey: 'updates',
      tombstonesStorageKey: 'tombstones',
    })).rejects.toThrow(/deleted field update records was corrupt/i);
    expect(jest.mocked(queueProjectUpdateDelete)).not.toHaveBeenCalled();
    expect(mockStorage.get('tombstones')).toBe('[]');
  });
});
