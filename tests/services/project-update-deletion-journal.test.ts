const mockStorage = new Map<string, string>();
let mockFailQuarantineWrites = false;
let mockDiscardJournalWrites = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockFailQuarantineWrites && key.includes('.quarantine.')) {
        throw new Error('storage unavailable');
      }
      if (mockDiscardJournalWrites && key === 'projectPhotoUpdate.deletionJournal.v1') {
        return;
      }
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

import {
  PROJECT_UPDATE_DELETION_JOURNAL_QUARANTINE_PREFIX,
  PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
  hasProjectUpdateDeletionIntent,
  recordProjectUpdateDeletionIntent,
} from '../../services/ProjectUpdateDeletionJournal';

beforeEach(() => {
  mockStorage.clear();
  mockFailQuarantineWrites = false;
  mockDiscardJournalWrites = false;
});

describe('ProjectUpdateDeletionJournal corruption safety', () => {
  it('quarantines exact corrupt bytes and fails the discovering mutation', async () => {
    mockStorage.set(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY, '{bad-json');

    await expect(recordProjectUpdateDeletionIntent({ id: 'new-delete' }))
      .rejects.toThrow(/was corrupt and was quarantined/i);
    expect(mockStorage.has(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY)).toBe(false);
    const quarantined = [...mockStorage.entries()].find(([key]) =>
      key.startsWith(PROJECT_UPDATE_DELETION_JOURNAL_QUARANTINE_PREFIX),
    );
    expect(quarantined?.[1]).toBe('{bad-json');

    await recordProjectUpdateDeletionIntent({ id: 'new-delete' });
    await expect(hasProjectUpdateDeletionIntent('new-delete')).resolves.toBe(true);
  });

  it('preserves valid deletion barriers from a partially corrupt journal', async () => {
    const valid = {
      updateId: 'keep-delete',
      requestedAt: '2026-07-18T12:00:00.000Z',
      cloudDeleteConfirmedAt: null,
    };
    mockStorage.set(
      PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
      JSON.stringify([valid, { updateId: '', requestedAt: 'not-a-date' }]),
    );

    await expect(recordProjectUpdateDeletionIntent({ id: 'new-delete' }))
      .rejects.toThrow(/1 valid record was preserved/i);
    expect(JSON.parse(
      mockStorage.get(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY) || '[]',
    )).toEqual([valid]);

    await recordProjectUpdateDeletionIntent({ id: 'new-delete' });
    await expect(hasProjectUpdateDeletionIntent('keep-delete')).resolves.toBe(true);
    await expect(hasProjectUpdateDeletionIntent('new-delete')).resolves.toBe(true);
  });

  it('leaves the active journal untouched when quarantine cannot be verified', async () => {
    mockStorage.set(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY, 'corrupt');
    mockFailQuarantineWrites = true;

    await expect(recordProjectUpdateDeletionIntent({ id: 'must-not-write' }))
      .rejects.toThrow(/active data was left in place/i);
    expect(mockStorage.get(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY))
      .toBe('corrupt');
  });

  it('does not report deletion intent when the journal write cannot be verified', async () => {
    mockDiscardJournalWrites = true;

    await expect(recordProjectUpdateDeletionIntent({ id: 'must-be-durable' }))
      .rejects.toThrow(/could not be verified/i);
    expect(mockStorage.has(PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY)).toBe(false);
  });
});
