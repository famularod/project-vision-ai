import {
  createFieldNote,
  createFieldNoteRepository,
  fieldNoteStorageKey,
  markFieldNoteSynced,
  normalizeFieldNote,
  updateFieldNoteDetails,
  updateFieldNoteStatus,
} from '../../services/FieldNoteRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}

describe('FieldNoteRepository', () => {
  it('stores a project-optional observation without creating formal work', async () => {
    const storage = memoryStorage();
    const repository = createFieldNoteRepository(storage);
    const note = createFieldNote({
      id: 'note-1',
      text: 'Call the contractor when the project walk is finished.',
      actionKind: 'follow_up',
      actionText: 'Call the contractor',
      now: '2026-08-03T15:00:00.000Z',
    });

    await repository.save('owner-a', note);

    expect(await repository.list('owner-a')).toEqual([note]);
    expect(note.projectName).toBeNull();
    expect(note.status).toBe('open');
  });

  it('isolates notes by signed-in owner key', async () => {
    const storage = memoryStorage();
    const repository = createFieldNoteRepository(storage);
    await repository.save('owner-a', createFieldNote({ id: 'a', text: 'Owner A note' }));

    expect(await repository.list('owner-b')).toEqual([]);
    expect(fieldNoteStorageKey('owner-a')).not.toBe(fieldNoteStorageKey('owner-b'));
  });

  it('resolves and archives notes without changing their original text', async () => {
    const storage = memoryStorage();
    const repository = createFieldNoteRepository(storage);
    const note = createFieldNote({ id: 'note-2', text: 'Guardrail appears to be missing.' });
    await repository.save('owner-a', note);

    const resolved = await repository.updateStatus(
      'owner-a',
      note.id,
      'resolved',
      '2026-08-03T16:00:00.000Z',
    );
    const archived = updateFieldNoteStatus(resolved, 'archived', '2026-08-03T17:00:00.000Z');

    expect(resolved.originalText).toBe(note.originalText);
    expect(resolved.resolvedAt).toBe('2026-08-03T16:00:00.000Z');
    expect(archived.originalText).toBe(note.originalText);
    expect(archived.archivedAt).toBe('2026-08-03T17:00:00.000Z');
    expect(archived.resolvedAt).toBeNull();
  });

  it('quarantines corrupt data without exposing it to another owner', async () => {
    const storage = memoryStorage();
    const repository = createFieldNoteRepository(storage);
    const ownerKey = fieldNoteStorageKey('owner-a');
    storage.values.set(ownerKey, '{bad json');

    await expect(repository.list('owner-a')).rejects.toThrow('was corrupt and was quarantined');
    expect(storage.values.has(ownerKey)).toBe(false);
    expect([...storage.values.keys()].some(key => key.startsWith(`${ownerKey}.corrupt.`))).toBe(true);
    expect(await repository.list('owner-b')).toEqual([]);
  });

  it('hydrates legacy device notes as pending without losing their content', () => {
    const hydrated = normalizeFieldNote({
      schemaVersion: 'vitruvius-field-note/1.0',
      id: 'legacy-note',
      originalText: 'Legacy observation',
      source: 'typed',
      projectName: null,
      locationName: null,
      actionKind: 'none',
      actionText: null,
      status: 'open',
      createdAt: '2026-08-03T15:00:00.000Z',
      updatedAt: '2026-08-03T15:00:00.000Z',
      resolvedAt: null,
      archivedAt: null,
    });

    expect(hydrated.originalText).toBe('Legacy observation');
    expect(hydrated.revision).toBe(0);
    expect(hydrated.syncState).toBe('pending');
  });

  it('edits a synchronized note while preserving the revision used for conflict checks', () => {
    const created = createFieldNote({
      id: 'editable-note',
      text: 'Initial observation',
      now: '2026-08-03T15:00:00.000Z',
    });
    const synchronized = markFieldNoteSynced(
      created,
      3,
      '2026-08-03T15:01:00.000Z',
    );
    const edited = updateFieldNoteDetails(synchronized, {
      text: 'Corrected observation',
      projectId: 'project-1',
      projectName: '2321 Compliance Project',
      locationName: 'North Lot',
      actionKind: 'safety_candidate',
      actionText: 'Review the exposed edge',
      now: '2026-08-03T15:05:00.000Z',
    });

    expect(edited.revision).toBe(3);
    expect(edited.syncState).toBe('pending');
    expect(edited.originalText).toBe('Corrected observation');
    expect(edited.projectId).toBe('project-1');
  });
});
