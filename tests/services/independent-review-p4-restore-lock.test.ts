/**
 * Independent review pass 4 (the restore lock; already in Build 229).
 *
 * A restore's record writes fail part-way and its recovery fails too: it is held ("Restore recovery required"), with
 * its journal saying which lists it had written. Before the next start something else saves one of those lists
 * again. From then on the recovery skipped that list as written, checked every written list against what it wrote,
 * found that one different, and threw, at every start and every Retry Recovery. The journal was never removed, and
 * the app could not be used.
 *
 * - Once storage works, the recovery always finishes: a list the restore had written and that has been saved again
 *   since is written again. He asked for the restore and editing was locked; what was saved meanwhile is a result of
 *   work begun before the restore, made from the lists as they were before it.
 * - The door that save came through is closed: while a restore's journal waits, the writers of its lists do not write.
 *
 * Synthetic data only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY, BackupRestoreRecoveryRequiredError, createBackupRestoreRuntime } from '../../services/BackupRestoreRuntime';
import { createDurableLocalTransactionRepository, type DurableLocalTransactionError } from '../../services/DurableLocalTransaction';
import { FieldUpdatePersistenceBlockedError, createFieldUpdateLocalPersistence } from '../../services/FieldUpdateLocalPersistence';
import { LocalStorageHeldForRecoveryError, assertLocalStorageKeysNotHeldForRecovery, holdLocalStorageKeysForRecovery } from '../../services/LocalStorageMutationCoordinator';
import { createDAVECaptureMemoryRepository, DAVE_CAPTURE_MEMORY_STORAGE_KEY } from '../../services/DAVECaptureMemoryRepository';
import { persistAndQueueProjectUpdateDeletion } from '../../services/updateService';
import { createProjectDeletionRuntime } from '../../services/ProjectDeletionRuntime';
import { persistStorageItem, removePersistedStorageItem, reportStoragePersistenceFailure } from '../../hooks/use-async-storage-persistence';

const mockValues = new Map<string, string>();
const mockFault = { failing: false, writes: 0, failAt: -1, reads: [] as string[] };
jest.mock('@react-native-async-storage/async-storage', () => {
  const write = (apply: () => void) => {
    mockFault.writes += 1;
    if (mockFault.failing || mockFault.writes === mockFault.failAt) { mockFault.failing = true; throw new Error('device storage write failed'); }
    apply();
  };
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => { mockFault.reads.push(key); return mockValues.get(key) ?? null; }),
      setItem: jest.fn(async (key: string, value: string) => { write(() => mockValues.set(key, value)); }),
      removeItem: jest.fn(async (key: string) => { write(() => mockValues.delete(key)); }),
      getAllKeys: jest.fn(async () => [...mockValues.keys()]),
    },
  };
});

const targetKeys = {
  updates: 'updates', projects: 'projects', archivedProjects: 'archived-projects', contacts: 'contacts', projectAreas: 'areas',
  referenceDocuments: 'reference-documents', projectDocuments: 'project-documents', scheduleItems: 'schedule-items',
  captureMemories: DAVE_CAPTURE_MEMORY_STORAGE_KEY, activeDraft: 'draft',
};
const barrierKeys = {
  deletedProjects: 'deleted-projects', deletedUpdates: 'deleted-updates', updateDeletionJournal: 'update-deletion-journal',
  projectDeletionCloudIntents: 'project-cloud-deletion-intents', projectDeletionFileCleanupIntents: 'project-file-cleanup-intents',
  daveSyncTombstones: 'dave-tombstones', fieldUpdateTransactionJournal: 'field-journal', projectDeletionTransactionJournal: 'project-journal',
};
/** What the backup holds, and each list as the restore writes it. */
const RESTORED_VALUES = {
  updates: [{ id: 'u1' }], projects: ['Alpha'], archivedProjects: [], contacts: {}, projectAreas: [], referenceDocuments: [],
  projectDocuments: [], scheduleItems: [], captureMemories: { schemaVersion: 'dave-capture-memory-repository/1.0', records: [] }, activeDraft: null,
};
const RESTORED = Object.fromEntries(Object.entries(RESTORED_VALUES).map(([name, value]) => [name, value === null ? null : JSON.stringify(value)])) as
  Record<keyof typeof RESTORED_VALUES, string | null>;
const SAVED_MEANWHILE = '[{"id":"u1"},{"id":"saved-meanwhile"}]';

let ids = 0;
/** A start of the app: a new restore runtime over the same device storage. */
const runtime = () => createBackupRestoreRuntime({
  storage: AsyncStorage, targetKeys, barrierKeys, createTransactionId: () => `restore-${String(ids += 1).padStart(4, '0')}`, now: () => '2026-10-05T12:00:00.000Z',
  recoverProjectDeletion: async () => undefined, recoverFieldUpdate: async () => undefined, loadQueuedProjectDeletionNames: async () => [],
});
const journal = () => JSON.parse(mockValues.get(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY) ?? 'null') as null |
  { phase: string; operations: Array<{ key: string }>; appliedOperationIndexes: number[] };
const journalWrote = () => (journal()?.appliedOperationIndexes ?? []).map(index => journal()!.operations[index].key);
const everyListIsTheRestores = () => (Object.keys(targetKeys) as Array<keyof typeof targetKeys>)
  .every(name => (mockValues.get(targetKeys[name]) ?? null) === RESTORED[name]);

/** A restore whose writes stop at write `failAt` and whose immediate recovery fails too: held, with its journal. Storage then works. */
async function heldRestore(failAt: number) {
  mockFault.writes = 0;
  mockFault.failAt = failAt;
  const held = runtime();
  const error = await held.commit(() => ({ values: RESTORED_VALUES, result: 'ok' })).catch((caught: unknown) => caught);
  mockFault.failing = false;
  mockFault.failAt = -1;
  return { held, error };
}

beforeEach(() => {
  mockValues.clear();
  mockValues.set('updates', '[{"id":"old"}]').set('projects', '["Old"]').set('draft', '{"draft":"before the restore"}');
  Object.assign(mockFault, { failing: false, writes: 0, failAt: -1 });
  mockFault.reads.length = 0;
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => undefined);
});
// He taps OK on any "Changes not saved" alert a test raised: the app shows one at a time.
afterEach(() => {
  (Alert.alert as jest.Mock).mock.calls.forEach(call => (call[2] as Array<{ onPress?: () => void }> | undefined)?.[0]?.onPress?.());
});

describe('independent review pass 4: a held restore always finishes once storage works', () => {
  it('the reviewed case: one of the lists it had written is saved again; the next start finishes the restore, and so does every start after', async () => {
    const { error } = await heldRestore(5);
    expect(error).toBeInstanceOf(BackupRestoreRecoveryRequiredError);
    expect(journalWrote()).toEqual(['updates']);
    // Something else saves the updates list (straight into storage: a writer that does not ask).
    mockValues.set('updates', SAVED_MEANWHILE);

    // It threw "Durable transaction outcome verification failed for updates." at this start and at every one after.
    for (let start = 1; start <= 3; start += 1) await expect(runtime().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect(journal()).toBeNull();
    expect(everyListIsTheRestores()).toBe(true);
  });

  it('wherever the writes stopped, and whichever written list was saved again', async () => {
    const outcomes: string[] = [];
    for (let failAt = 3; failAt <= 40; failAt += 1) {
      mockValues.clear();
      mockValues.set('updates', '[{"id":"old"}]').set('projects', '["Old"]');
      const { error } = await heldRestore(failAt);
      const wrote = journalWrote();
      if (!(error instanceof BackupRestoreRecoveryRequiredError) || wrote.length === 0) continue;
      for (const key of wrote) {
        const snapshot = new Map(mockValues);
        mockValues.set(key, '["saved meanwhile"]');
        const first = await runtime().recoverBeforeStartupReads().then(() => 'finished', (caught: Error) => `threw: ${caught.message}`);
        // The draft is the one the restore removes rather than writes: one saved since is left (next test).
        const restored = key === 'draft'
          ? mockValues.get('draft') === '["saved meanwhile"]' && mockValues.delete('draft') && everyListIsTheRestores()
          : everyListIsTheRestores();
        outcomes.push(`${failAt}/${key}: ${first}; journal ${journal() ? 'left' : 'gone'}; restored ${restored}`);
        mockValues.clear();
        snapshot.forEach((value, name) => mockValues.set(name, value));
      }
    }
    expect(outcomes.length).toBeGreaterThan(20);
    expect(outcomes.filter(line => !line.endsWith('finished; journal gone; restored true'))).toEqual([]);
  });

  it('a restore whose records were all written and whose journal could not be removed: a list saved again since is the restore\'s again', async () => {
    // The last write of a restore is its journal's removal.
    mockFault.writes = 0;
    const clean = runtime();
    await clean.commit(() => ({ values: RESTORED_VALUES, result: 'ok' }));
    const writesOfARestore = mockFault.writes;
    mockValues.clear();
    mockValues.set('updates', '[{"id":"old"}]');
    await heldRestore(writesOfARestore);
    expect(journal()?.phase).toBe('committed');
    mockValues.set('projects', '["saved meanwhile"]');

    await expect(runtime().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect(journal()).toBeNull();
    expect(everyListIsTheRestores()).toBe(true);
  });

  it('the draft the restore removed: a draft saved since is left, as when the removal is skipped, and the restore still finishes', async () => {
    mockFault.writes = 0;
    const clean = runtime();
    await clean.commit(() => ({ values: RESTORED_VALUES, result: 'ok' }));
    const writesOfARestore = mockFault.writes;
    mockValues.clear();
    mockValues.set('updates', '[{"id":"old"}]').set('draft', '{"draft":"before the restore"}');
    await heldRestore(writesOfARestore);
    expect(journalWrote()).toContain('draft');
    expect(mockValues.has('draft')).toBe(false);
    mockValues.set('draft', '{"draft":"saved since"}');

    await expect(runtime().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect(journal()).toBeNull();
    expect(mockValues.get('draft')).toBe('{"draft":"saved since"}');
    expect(mockValues.get('updates')).toBe(RESTORED.updates);
  });

  it('while storage still fails the journal stays; it finishes at the first start at which storage works', async () => {
    await heldRestore(5);
    mockValues.set('updates', SAVED_MEANWHILE);
    mockFault.failing = true;
    await expect(runtime().recoverBeforeStartupReads()).rejects.toMatchObject({ code: 'operation_failed', recoverable: true });
    expect(journal()).not.toBeNull();
    mockFault.failing = false;

    await expect(runtime().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect(journal()).toBeNull();
    expect(everyListIsTheRestores()).toBe(true);
  });

  it('the other journals keep their rule: a key their journal wrote that holds something else stops their recovery, as before', async () => {
    const repository = (recoveryWritesAgain?: boolean) => createDurableLocalTransactionRepository({
      storage: AsyncStorage, journalKey: 'some-journal', createTransactionId: () => 'transaction-0001', now: () => '2026-10-05T12:00:00.000Z',
      ...(recoveryWritesAgain === undefined ? {} : { recoveryWritesAgain }),
    });
    const stopPartWay = async () => {
      mockValues.clear();
      mockFault.writes = 0;
      mockFault.failAt = 5;
      await repository().commit([{ kind: 'set', key: 'a', value: '1' }, { kind: 'set', key: 'b', value: '2' }]).catch(() => undefined);
      mockFault.failing = false;
      mockFault.failAt = -1;
      mockValues.set('a', 'saved meanwhile');
    };
    await stopPartWay();
    const stopped = await repository().recover().catch((caught: DurableLocalTransactionError) => caught);
    expect(stopped).toMatchObject({ code: 'verification_failed' });
    expect(mockValues.get('a')).toBe('saved meanwhile');

    await stopPartWay();
    await expect(repository(true).recover()).resolves.toMatchObject({ recovered: true });
    expect([mockValues.get('a'), mockValues.get('b'), mockValues.has('some-journal')]).toEqual(['1', '2', false]);
  });
});

describe('independent review pass 4: while a restore\'s journal waits, nothing else saves its lists', () => {
  it('a save through the app\'s storage helper is refused, with no "Changes not saved" alert, and goes through once the restore has finished', async () => {
    const { held } = await heldRestore(5);

    mockFault.reads.length = 0;
    const refused = await persistStorageItem('updates', SAVED_MEANWHILE).catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(LocalStorageHeldForRecoveryError);
    // Asked once: a refusal is not tried again, as a write that failed is.
    expect(mockFault.reads).toEqual([BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY]);
    await expect(removePersistedStorageItem('draft')).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    await expect(persistStorageItem('schedule-items', '[{"id":"t1"}]')).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(mockValues.get('updates')).toBe(RESTORED.updates);
    expect(mockValues.get('draft')).toBe('{"draft":"before the restore"}');
    expect(mockValues.has('schedule-items')).toBe(false);
    // A key that is not one of the restore's is saved as always.
    await expect(persistStorageItem('a-setting', 'on')).resolves.toBeUndefined();
    expect(mockValues.get('a-setting')).toBe('on');
    // He is not told to check available storage: the screen already says editing is locked until the restore is finished.
    reportStoragePersistenceFailure({ storageKey: 'updates', label: 'saved updates', error: refused });
    expect(Alert.alert).not.toHaveBeenCalled();
    reportStoragePersistenceFailure({ storageKey: 'updates', label: 'saved updates', error: new Error('disk full') });
    expect(Alert.alert).toHaveBeenCalledTimes(1);

    // Retry Recovery in the same run of the app.
    await held.recoverBeforeStartupReads();
    expect(journal()).toBeNull();
    expect(everyListIsTheRestores()).toBe(true);
    await expect(persistStorageItem('schedule-items', '[{"id":"t1"}]')).resolves.toBeUndefined();
    expect(mockValues.get('schedule-items')).toBe('[{"id":"t1"}]');
  });

  it('a field update\'s save, already on its way when the restore stopped, is blocked; the updates list stays the restore\'s', async () => {
    const persistence = createFieldUpdateLocalPersistence<{ id: string }, { updateId: string }>({
      storage: AsyncStorage, keys: { journal: 'field-journal', updates: 'updates', tombstones: 'deleted-updates', draft: 'draft' },
      createTransactionId: () => 'field-save-0001', now: () => '2026-10-05T12:00:01.000Z',
      parseUpdate: value => value as { id: string }, parseTombstone: value => value as { updateId: string },
    });
    const { held } = await heldRestore(5);
    const prepare = jest.fn((snapshot: { persistedUpdates: Array<{ id: string }> }) => ({
      operations: [{ kind: 'set' as const, key: 'updates', value: JSON.stringify([...snapshot.persistedUpdates, { id: 'saved-meanwhile' }]) }], result: 'saved',
    }));

    const blocked = await persistence.commit(prepare).catch((caught: unknown) => caught);

    // It saved the list the restore had written, and the restore's recovery then failed at every start.
    expect(blocked).toBeInstanceOf(FieldUpdatePersistenceBlockedError);
    expect((blocked as FieldUpdatePersistenceBlockedError).stage).toBe('recovery');
    expect((blocked as FieldUpdatePersistenceBlockedError).cause).toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(prepare).not.toHaveBeenCalled();
    expect(mockValues.get('updates')).toBe(RESTORED.updates);
    // Its own recovery, which the restore's recovery runs first, is not blocked.
    await expect(persistence.recoverBeforeStartupReads()).resolves.toBeUndefined();

    await held.recoverBeforeStartupReads();
    await expect(persistence.commit(prepare)).resolves.toBe('saved');
    expect(mockValues.get('updates')).toBe(SAVED_MEANWHILE);
  });

  it('deleting a field update, saving a capture memory and deleting a project are refused the same way', async () => {
    const { held } = await heldRestore(5);
    const deletion = () => persistAndQueueProjectUpdateDeletion({
      update: { id: 'u1' } as never, tombstone: { updateId: 'u1', deletedAt: '2026-10-05T12:00:02.000Z' } as never,
      getCurrentUpdates: () => [], getCurrentTombstones: () => [], updatesStorageKey: 'updates', tombstonesStorageKey: 'deleted-updates',
    });
    await expect(deletion()).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(mockValues.get('updates')).toBe(RESTORED.updates);
    expect(mockValues.has('deleted-updates')).toBe(false);

    const memories = createDAVECaptureMemoryRepository(AsyncStorage);
    await expect(memories.replaceAll([])).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(mockValues.has(DAVE_CAPTURE_MEMORY_STORAGE_KEY)).toBe(false);

    // Deleting a project rewrites most of the restore's lists.
    const prepare = jest.fn(() => ({ operations: [{ kind: 'set' as const, key: 'projects', value: '[]' }], result: 'deleted' }));
    const deletions = createProjectDeletionRuntime({
      storage: AsyncStorage,
      storageKeys: {
        projects: 'projects', deletedProjects: 'deleted-projects', archivedProjects: 'archived-projects', updates: 'updates', deletedUpdates: 'deleted-updates',
        updateDeletionJournal: 'update-deletion-journal', projectDocuments: 'project-documents', referenceDocuments: 'reference-documents', projectAreas: 'areas',
        scheduleItems: 'schedule-items', daveSyncTombstones: 'dave-tombstones', activeDraft: 'draft', cloudIntents: 'project-cloud-deletion-intents',
        fileCleanupIntents: 'project-file-cleanup-intents',
      },
      createTransactionId: () => 'project-delete-0001', now: () => '2026-10-05T12:00:03.000Z',
      getOfflineQueue: async () => [], queueCloudProjectDelete: async () => undefined, cleanupLocalFile: async () => undefined,
    });
    await expect(deletions.commit(prepare)).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(prepare).not.toHaveBeenCalled();
    // Its own recovery, which the restore's recovery runs first, is not refused.
    await expect(deletions.recoverBeforeStartupReads()).resolves.toBeUndefined();

    await held.recoverBeforeStartupReads();
    await expect(memories.replaceAll([])).resolves.toEqual([]);
    await expect(deletions.commit(prepare)).resolves.toBe('deleted');
  });

  it('a restore that finished, and a start with no restore waiting, refuse nothing; each save asks storage once', async () => {
    const started = runtime();
    await started.recoverBeforeStartupReads();
    mockFault.reads.length = 0;
    await persistStorageItem('updates', '[{"id":"x"}]');
    expect(mockValues.get('updates')).toBe('[{"id":"x"}]');
    expect(mockFault.reads).toEqual([BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY]);
    await started.commit(() => ({ values: RESTORED_VALUES, result: 'ok' }));
    await expect(persistStorageItem('projects', '["P"]')).resolves.toBeUndefined();
    expect(mockValues.get('projects')).toBe('["P"]');
    // A journal that arrives with the account's other records (the signed-in account changed) is seen at once.
    mockValues.set(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY, '{"waiting":"from another run"}');
    await expect(persistStorageItem('projects', '["Q"]')).rejects.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect(mockValues.get('projects')).toBe('["P"]');
  });

  it('when it cannot be told whether a recovery waits, nothing is written, and it is reported as any save that failed', async () => {
    let asked = 0;
    const release = holdLocalStorageKeysForRecovery(['some-list'], async () => { asked += 1; throw new Error('device storage read failed'); });
    await expect(assertLocalStorageKeysNotHeldForRecovery(['some-list'])).rejects.toThrow('device storage read failed');
    asked = 0;

    const failed = await persistStorageItem('some-list', '[]').catch((caught: unknown) => caught);

    expect(mockValues.has('some-list')).toBe(false);
    // Not the quiet refusal: nothing says a restore waits, and he must hear that this was not saved.
    expect(failed).not.toBeInstanceOf(LocalStorageHeldForRecoveryError);
    expect((failed as Error).message).toBe('device storage read failed');
    reportStoragePersistenceFailure({ storageKey: 'some-list', label: 'app data', error: failed });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    // Asked again as a write that failed is tried again: twice more.
    expect(asked).toBe(3);
    release();
    await expect(persistStorageItem('some-list', '[]')).resolves.toBeUndefined();
  });

  it('storage answers at the second try that none waits: the save goes through, as a write that fails once does', async () => {
    let asked = 0;
    const release = holdLocalStorageKeysForRecovery(['some-list'], async () => {
      asked += 1;
      if (asked === 1) throw new Error('device storage read failed');
      return false;
    });
    await expect(persistStorageItem('some-list', '["saved"]')).resolves.toBeUndefined();
    expect(mockValues.get('some-list')).toBe('["saved"]');
    expect(asked).toBe(2);
    release();
  });
});
