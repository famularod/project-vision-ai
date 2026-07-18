import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  queueProjectUpdateDelete,
  removeProjectUpdateFromSyncQueue,
} from '../../services/SyncService';
import {
  persistAndQueueProjectUpdateDeletion,
  reconcileProjectUpdateDeletionJournal,
} from '../../services/updateService';
import type { ProjectUpdate } from '../../types';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('../../services/SyncService', () => ({
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

  it('replays only permanent cloud deletions after a restart', async () => {
    await reconcileProjectUpdateDeletionJournal([
      { updateId: 'permanent', action: 'delete_update_everywhere' },
      { updateId: 'archived', action: 'archive_sent_update' },
      { updateId: 'device-only', action: 'remove_from_device' },
    ]);

    expect(removeProjectUpdateFromSyncQueue).toHaveBeenCalledTimes(3);
    expect(queueProjectUpdateDelete).toHaveBeenCalledTimes(1);
    expect(queueProjectUpdateDelete).toHaveBeenCalledWith({ id: 'permanent' });
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
});
