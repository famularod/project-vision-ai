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
});
