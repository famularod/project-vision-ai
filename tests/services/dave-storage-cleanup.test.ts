jest.mock('../../services/SupabaseService', () => ({
  listDAVEStorageCleanupIntents: jest.fn(),
  recordDAVEStorageCleanupAttempt: jest.fn(),
  removeProtectedStorageObject: jest.fn(),
}));

import {
  processDAVEStorageCleanup,
  type DAVEStorageCleanupDependencies,
} from '../../services/DAVEStorageCleanup';
import type { DAVEStorageCleanupIntent } from '../../services/SupabaseService';

const PHOTO_INTENT: DAVEStorageCleanupIntent = {
  id: 'cleanup-photo-1',
  bucket: 'project-photos',
  objectPath: 'project/update/photo.jpg',
  sourceEntityType: 'project_update',
  sourceRecordId: 'update-1',
  status: 'pending',
  attemptCount: 0,
  lastError: null,
  updatedAt: '2026-07-26T00:00:00.000Z',
};

const DOCUMENT_INTENT: DAVEStorageCleanupIntent = {
  id: 'cleanup-document-1',
  bucket: 'project-documents',
  objectPath: 'owner/web/document/schedule.pdf',
  sourceEntityType: 'reference_document',
  sourceRecordId: 'document-1',
  status: 'failed',
  attemptCount: 2,
  lastError: 'Previous attempt failed.',
  updatedAt: '2026-07-26T00:01:00.000Z',
};

function dependencies(
  overrides: Partial<DAVEStorageCleanupDependencies> = {},
): DAVEStorageCleanupDependencies {
  return {
    list: jest.fn(async () => ({
      ok: true,
      intents: [PHOTO_INTENT, DOCUMENT_INTENT],
    })),
    remove: jest.fn(async () => ({ ok: true })),
    record: jest.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('DAVE protected storage cleanup', () => {
  it('removes every queued object and records a completed receipt', async () => {
    const fixture = dependencies();

    const result = await processDAVEStorageCleanup(fixture);

    expect(result).toEqual({
      attempted: 2,
      completed: 2,
      failed: 0,
      remaining: 0,
      errors: [],
    });
    expect(fixture.remove).toHaveBeenNthCalledWith(1, PHOTO_INTENT);
    expect(fixture.remove).toHaveBeenNthCalledWith(2, DOCUMENT_INTENT);
    expect(fixture.record).toHaveBeenNthCalledWith(
      1,
      PHOTO_INTENT,
      true,
      null,
    );
    expect(fixture.record).toHaveBeenNthCalledWith(
      2,
      DOCUMENT_INTENT,
      true,
      null,
    );
  });

  it('keeps a failed removal retryable and records only generic user-safe detail', async () => {
    const record = jest.fn(async () => ({ ok: true }));
    const fixture = dependencies({
      remove: jest.fn(async intent => ({
        ok: intent.id !== DOCUMENT_INTENT.id,
        error: intent.id === DOCUMENT_INTENT.id
          ? 'provider secret and internal object path'
          : undefined,
      })),
      record,
    });

    const result = await processDAVEStorageCleanup(fixture);

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.errors).toEqual([
      'A deleted project file is waiting for protected cloud cleanup.',
    ]);
    expect(record).toHaveBeenLastCalledWith(
      DOCUMENT_INTENT,
      false,
      'A deleted project file is waiting for protected cloud cleanup.',
    );
    expect(JSON.stringify(result)).not.toContain('provider secret');
  });

  it('does not claim cleanup succeeded when the completion receipt fails', async () => {
    const fixture = dependencies({
      list: jest.fn(async () => ({ ok: true, intents: [PHOTO_INTENT] })),
      record: jest.fn(async () => ({
        ok: false,
        error: 'receipt write failed',
      })),
    });

    const result = await processDAVEStorageCleanup(fixture);

    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.errors).toEqual([
      'A protected file cleanup receipt could not be saved and will be retried.',
    ]);
  });

  it('surfaces an unavailable cleanup queue as unfinished work', async () => {
    const fixture = dependencies({
      list: jest.fn(async () => ({
        ok: false,
        intents: [],
        error: 'Protected cleanup table is unavailable.',
      })),
    });

    const result = await processDAVEStorageCleanup(fixture);

    expect(result).toEqual({
      attempted: 0,
      completed: 0,
      failed: 0,
      remaining: 1,
      errors: ['Protected cleanup table is unavailable.'],
    });
    expect(fixture.remove).not.toHaveBeenCalled();
  });
});
