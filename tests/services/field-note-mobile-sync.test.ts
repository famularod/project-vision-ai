import {
  createMobileFieldNoteDataSource,
  mergeFieldNoteCollections,
} from '../../services/FieldNoteMobileSync';
import {
  FieldNoteCloudError,
  type FieldNoteCloudGateway,
} from '../../services/FieldNoteCloudGateway';
import {
  createFieldNote,
  createFieldNoteRepository,
  markFieldNoteSynced,
  updateFieldNoteDetails,
  updateFieldNoteStatus,
  type FieldNote,
} from '../../services/FieldNoteRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}

function cloudGateway(): jest.Mocked<FieldNoteCloudGateway> {
  return {
    list: jest.fn(async () => []),
    create: jest.fn(),
    update: jest.fn(),
    subscribe: jest.fn(async (_onChange, _onStatus) => () => undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

function memoryCloudGateway(options: Readonly<{
  firstCreate?: 'deferred' | 'lost_response';
  timestampStyle?: 'z' | 'offset';
  initial?: FieldNote | null;
}> = {}) {
  let row = options.initial ?? null;
  const createStarted = deferred<void>();
  const releaseCreate = deferred<void>();
  let firstCreate = true;
  const asCloud = (note: FieldNote, revision: number) => {
    const synced = markFieldNoteSynced(note, revision, note.updatedAt);
    if (options.timestampStyle !== 'offset') return synced;
    const offset = (value: string | null) => value?.replace(/\.000Z$/, '+00:00') ?? null;
    return {
      ...synced,
      createdAt: offset(synced.createdAt)!,
      updatedAt: offset(synced.updatedAt)!,
      resolvedAt: offset(synced.resolvedAt),
      archivedAt: offset(synced.archivedAt),
      cloudUpdatedAt: offset(synced.cloudUpdatedAt),
    } as FieldNote;
  };
  const gateway: jest.Mocked<FieldNoteCloudGateway> = {
    list: jest.fn(async () => row ? [row] : []),
    create: jest.fn(async note => {
      if (!row && firstCreate) {
        firstCreate = false;
        row = asCloud(note, 1);
        if (options.firstCreate === 'deferred') {
          createStarted.resolve();
          await releaseCreate.promise;
        }
        if (options.firstCreate === 'lost_response') {
          throw new FieldNoteCloudError('write_failed', 'Response lost');
        }
        return row;
      }
      if (row) {
        const { sameFieldNoteContent } = jest.requireActual('../../services/FieldNoteCloudGateway');
        if (sameFieldNoteContent(note, row)) return row;
        throw new FieldNoteCloudError('conflict', 'Duplicate field note ID');
      }
      throw new Error('Unexpected create state');
    }),
    update: jest.fn(async (note, expectedRevision) => {
      if (!row || row.revision !== expectedRevision) {
        throw new FieldNoteCloudError('conflict', 'Stale revision');
      }
      row = asCloud(note, expectedRevision + 1);
      return row;
    }),
    subscribe: jest.fn(async (_onChange, _onStatus) => () => undefined),
  };
  return {
    gateway,
    createStarted: createStarted.promise,
    releaseCreate: () => releaseCreate.resolve(),
    row: () => row,
  };
}

describe('Field Note mobile synchronization', () => {
  it('keeps a new note safely pending when the cloud is unavailable', async () => {
    const local = createFieldNoteRepository(memoryStorage());
    const cloud = cloudGateway();
    cloud.create.mockRejectedValue(new FieldNoteCloudError(
      'write_failed',
      'The field note is saved on this device and is waiting to synchronize.',
    ));
    const source = createMobileFieldNoteDataSource({ localRepository: local, cloudGateway: cloud });
    const note = createFieldNote({ id: 'offline-note', text: 'Call the contractor.' });

    const saved = await source.save('owner-1', note);

    expect(saved.syncState).toBe('pending');
    expect((await local.list('owner-1'))[0].originalText).toBe('Call the contractor.');
  });

  it('retries a pending note and marks the verified cloud revision synchronized', async () => {
    const local = createFieldNoteRepository(memoryStorage());
    const cloud = cloudGateway();
    const note = createFieldNote({
      id: 'retry-note',
      text: 'Inspect the exposed parking edge.',
      now: '2026-08-03T15:00:00.000Z',
    });
    cloud.create.mockRejectedValueOnce(new FieldNoteCloudError('write_failed', 'Waiting'));
    cloud.create.mockResolvedValueOnce(markFieldNoteSynced(
      note,
      1,
      '2026-08-03T15:00:00.000Z',
    ));
    const source = createMobileFieldNoteDataSource({ localRepository: local, cloudGateway: cloud });
    await source.save('owner-1', note);

    const retried = await source.retryPending?.('owner-1');

    expect(retried?.[0].syncState).toBe('synced');
    expect(retried?.[0].revision).toBe(1);
    expect(cloud.create).toHaveBeenCalledTimes(2);
  });

  it('recognizes an identical cloud row after a lost response instead of creating a conflict', () => {
    const local = createFieldNote({
      id: 'lost-response-note',
      text: 'Remember to call the contractor.',
      now: '2026-08-03T15:00:00.000Z',
    });
    const cloud = markFieldNoteSynced(local, 1, '2026-08-03T15:00:00.000Z');

    const [merged] = mergeFieldNoteCollections([local], [cloud]);

    expect(merged.syncState).toBe('synced');
    expect(merged.revision).toBe(1);
  });

  it('accepts newer desktop content while rebasing a pending mobile status change', () => {
    const base = markFieldNoteSynced(
      createFieldNote({
        id: 'conflict-note',
        text: 'Initial observation',
        now: '2026-08-03T15:00:00.000Z',
      }),
      1,
      '2026-08-03T15:00:00.000Z',
    );
    const local = {
      ...base,
      status: 'resolved' as const,
      resolvedAt: '2026-08-03T15:05:00.000Z',
      updatedAt: '2026-08-03T15:05:00.000Z',
      syncState: 'pending' as const,
    };
    const cloud = markFieldNoteSynced(
      updateFieldNoteDetails(base, {
        text: 'Edited on desktop',
        now: '2026-08-03T15:04:00.000Z',
      }),
      2,
      '2026-08-03T15:04:00.000Z',
    );

    const [merged] = mergeFieldNoteCollections([local], [cloud]);

    expect(merged.syncState).toBe('pending');
    expect(merged.revision).toBe(2);
    expect(merged.originalText).toBe('Edited on desktop');
    expect(merged.status).toBe('resolved');
  });

  it('sends a status edit made before the first create acknowledgement', async () => {
    const local = createFieldNoteRepository(memoryStorage());
    const cloud = memoryCloudGateway({ firstCreate: 'deferred' });
    const source = createMobileFieldNoteDataSource({ localRepository: local, cloudGateway: cloud.gateway });
    const note = createFieldNote({
      id: 'deferred-create-note',
      text: 'Check the north wall.',
      now: '2026-09-17T16:00:00.000Z',
    });
    await source.saveLocal?.('owner-1', note);
    const firstSync = source.retryPending?.('owner-1');
    await cloud.createStarted;
    const resolved = updateFieldNoteStatus(note, 'resolved', '2026-09-17T16:01:00.000Z');
    const editSync = source.update('owner-1', resolved);
    cloud.releaseCreate();
    await Promise.all([firstSync, editSync]);

    const final = await source.retryPending?.('owner-1');

    expect(final?.[0]).toMatchObject({ syncState: 'synced', status: 'resolved' });
    expect(cloud.row()).toMatchObject({ status: 'resolved' });
    expect(cloud.gateway.create).toHaveBeenCalledTimes(2);
    expect(cloud.gateway.update).toHaveBeenCalledTimes(1);
  });

  it('recovers a committed create response with equivalent offset timestamps', async () => {
    const local = createFieldNoteRepository(memoryStorage());
    const cloud = memoryCloudGateway({ firstCreate: 'lost_response', timestampStyle: 'offset' });
    const source = createMobileFieldNoteDataSource({ localRepository: local, cloudGateway: cloud.gateway });
    const note = createFieldNote({
      id: 'lost-create-note',
      text: 'Confirm the temporary barrier.',
      now: '2026-09-17T16:00:00.000Z',
    });
    const first = await source.save('owner-1', note);
    expect(first.syncState).toBe('pending');

    const final = await source.retryPending?.('owner-1');

    expect(final?.[0]).toMatchObject({ syncState: 'synced', revision: 1 });
    expect(cloud.gateway.update).not.toHaveBeenCalled();
    expect(cloud.row()?.createdAt).toContain('+00:00');
  });

  it('keeps a desktop text edit when mobile only changed status before its first acknowledgement', () => {
    const created = createFieldNote({
      id: 'desktop-edited-note',
      text: 'Original wording',
      now: '2026-09-17T16:00:00.000Z',
    });
    const local = updateFieldNoteStatus(created, 'resolved', '2026-09-17T16:01:00.000Z');
    const cloud = markFieldNoteSynced(
      { ...created, originalText: 'Desktop corrected wording', updatedAt: '2026-09-17T16:02:00.000Z' },
      2,
      '2026-09-17T16:02:00.000Z',
    );

    const [merged] = mergeFieldNoteCollections([local], [cloud]);

    expect(merged).toMatchObject({
      originalText: 'Desktop corrected wording',
      status: 'resolved',
      revision: 2,
      syncState: 'pending',
    });
  });

  it('adopts the cloud note when a revision-zero local copy has the same status as a later cloud revision', () => {
    const created = createFieldNote({
      id: 'desktop-edited-same-status',
      text: 'Original wording',
      now: '2026-09-17T16:00:00.000Z',
    });
    const cloud = markFieldNoteSynced(
      { ...created, originalText: 'Desktop corrected wording', updatedAt: '2026-09-17T16:02:00.000Z' },
      2,
      '2026-09-17T16:02:00.000Z',
    );

    const [merged] = mergeFieldNoteCollections([created], [cloud]);

    expect(merged).toMatchObject({
      originalText: 'Desktop corrected wording', revision: 2, syncState: 'synced',
    });
  });

  it('keeps a true same-id collision with a different createdAt in conflict', () => {
    const local = createFieldNote({
      id: 'collision-note',
      text: 'Local note',
      now: '2026-09-17T16:00:00.000Z',
    });
    const cloud = markFieldNoteSynced(createFieldNote({
      id: 'collision-note',
      text: 'Different cloud note',
      now: '2026-09-17T16:05:00.000Z',
    }), 1, '2026-09-17T16:05:00.000Z');

    const [merged] = mergeFieldNoteCollections([local], [cloud]);

    expect(merged.syncState).toBe('conflict');
  });

  it('resolves an existing conflict by keeping either the local or cloud version', async () => {
    const localRepository = createFieldNoteRepository(memoryStorage());
    const cloudBase = markFieldNoteSynced(createFieldNote({
      id: 'manual-conflict-note',
      text: 'Cloud wording',
      now: '2026-09-17T16:00:00.000Z',
    }), 2, '2026-09-17T16:02:00.000Z');
    const localConflict = {
      ...updateFieldNoteDetails(cloudBase, {
        text: 'My wording',
        status: 'resolved',
        now: '2026-09-17T16:03:00.000Z',
      }),
      revision: 1,
      syncState: 'conflict' as const,
      syncError: 'Review required',
    };
    await localRepository.save('owner-1', localConflict);
    const cloud = memoryCloudGateway({ initial: cloudBase });
    const source = createMobileFieldNoteDataSource({ localRepository, cloudGateway: cloud.gateway });

    expect(source.resolveConflict).toBeDefined();
    const keptLocal = await source.resolveConflict?.('owner-1', localConflict, 'keep_local');
    expect(keptLocal).toMatchObject({
      syncState: 'synced', originalText: 'My wording', status: 'resolved', revision: 3,
    });
    expect(cloud.row()).toMatchObject({ originalText: 'My wording', status: 'resolved' });

    const secondConflict = {
      ...updateFieldNoteDetails(keptLocal!, {
        text: 'Another local edit',
        now: '2026-09-17T16:04:00.000Z',
      }),
      syncState: 'conflict' as const,
      syncError: 'Review required',
    };
    await localRepository.replace('owner-1', secondConflict);
    const usedCloud = await source.resolveConflict?.('owner-1', secondConflict, 'use_cloud');
    expect(usedCloud).toMatchObject({
      syncState: 'synced', originalText: 'My wording', status: 'resolved', revision: 3,
    });
  });
});
