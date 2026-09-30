/**
 * Whole-app audit A8 pass 1 F3 (30 Sep 2026): the cloud refused almost every
 * phone edit to a Current drawing, and retried it forever. The phone saved
 * with an upsert, and Postgres runs the guard trigger's insert branch of an
 * upsert first, which refuses every Current drawing. A record the cloud
 * already has is now updated, a renumbered Current drawing keeps its family,
 * and a change the cloud still refuses is held with a plain reason, without
 * a retry, until the owner edits the document again.
 *
 * The cloud below models the guard (migration 20260809065350): an insert of a
 * Current drawing is refused, and an update is refused when a drawing's
 * current flag, category or family changes.
 */
const mockStorageValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorageValues.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorageValues.delete(key);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

type MockRow = Record<string, unknown>;
const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockCloud = new Map<string, MockRow>();
const mockCategory = (row: MockRow) => {
  const category = String(row.category || '').trim().toLowerCase();
  return category === 'plans' ? 'drawing' : category;
};
const mockFamily = (row: MockRow) =>
  String(row.webVersionGroupId || '').trim().toLowerCase() ||
  String(row.drawingNumber || '').trim().toLowerCase();
const mockRefused = { ok: false, configured: true, data: null, status: 400, error: 'ecos_atomic_current_activation_required' };
const mockUpsertReferenceDocument = jest.fn(async (
  document: MockRow,
  { existing = false }: { existing?: boolean } = {},
) => {
  const previous = mockCloud.get(String(document.id));
  const nextCurrent = document.isCurrent === true;
  if (!existing) {
    // An upsert runs the guard's insert branch first.
    if (mockCategory(document) === 'drawing' && nextCurrent) return mockRefused;
  } else {
    if (!previous) {
      return { ok: false, configured: true, data: null, status: 404, code: 'not_found', error: 'The shared document record was not found in the cloud. It will be checked again.' };
    }
    const previousCurrent = previous.isCurrent === true;
    const drawingInvolved = mockCategory(document) === 'drawing' || mockCategory(previous) === 'drawing';
    const familyChanged = previousCurrent && nextCurrent && (
      mockCategory(previous) !== mockCategory(document) || mockFamily(previous) !== mockFamily(document)
    );
    if (drawingInvolved && (previousCurrent !== nextCurrent || familyChanged)) return mockRefused;
  }
  const { cloudUpdatedAt: _cloudUpdatedAt, ...documentData } = document;
  mockCloud.set(String(document.id), { ...documentData, cloudUpdatedAt: '2026-09-30T12:00:30.000Z' });
  return { ok: true, configured: true, stubbed: false, data: document };
});

jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok([...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: MockRow, options?: { existing?: boolean }) =>
    mockUpsertReferenceDocument(document, options),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import { pendingChangesUploadNeedsRetry } from '../../services/PendingChangesRetryController';
import { synchronizeSharedReferenceDocumentMetadata } from '../../services/ProjectDocumentLifecycle';
import {
  getOfflineQueue,
  queueReferenceDocumentRecord,
  uploadPendingChanges,
} from '../../services/SyncService';
import type { ReferenceDocument } from '../../types';

const PLAIN = 'This drawing is Current for ECOS, so the cloud kept its shared record. Make another revision current first, then edit this one again.';

const currentDrawing: ReferenceDocument = {
  id: 'drawing-a201',
  name: 'A-201',
  originalFileName: 'A-201.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  storagePath: 'owner-1/documents/drawing-a201/A-201.pdf',
  drawingNumber: 'A-201',
  drawingRevision: '3',
};

function phoneEdit(next: Partial<ReferenceDocument>, updatedAt: string): ReferenceDocument {
  return { ...currentDrawing, ...next, updatedAt };
}

describe('edits to a Current drawing reach the cloud (A8 pass 1 F3)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCloud.clear();
    mockCloud.set(currentDrawing.id, { ...currentDrawing, cloudUpdatedAt: '2026-09-01T12:00:05.000Z' });
    mockUpsertReferenceDocument.mockClear();
  });

  it('a note edit to a Current drawing uses the update path and succeeds', async () => {
    await queueReferenceDocumentRecord(phoneEdit({ notes: 'Field verified' }, '2026-09-30T09:00:00.000Z'), false);

    const result = await uploadPendingChanges();

    expect(result).toMatchObject({ uploaded: 1, queued: 0, errors: [] });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: currentDrawing.id, notes: 'Field verified', isCurrent: true }),
      { existing: true },
    );
    expect(mockCloud.get(currentDrawing.id)).toMatchObject({ notes: 'Field verified' });
    await expect(getOfflineQueue()).resolves.toEqual([]);
    // The same write as an upsert is what the cloud refused.
    await expect(mockUpsertReferenceDocument({ ...currentDrawing, notes: 'x' })).resolves.toMatchObject({
      ok: false,
      error: 'ecos_atomic_current_activation_required',
    });
  });

  it('a corrected drawing number keeps the drawing in its family and is accepted', async () => {
    const corrected = synchronizeSharedReferenceDocumentMetadata({
      sharedDocument: currentDrawing,
      document: {
        id: 'phone-drawing-a201',
        referenceDocumentId: currentDrawing.id,
        projectId: '',
        name: 'A-201.pdf',
        category: 'Drawing',
        mimeType: 'application/pdf',
        storagePath: currentDrawing.storagePath,
        drawingNumber: 'A-210',
        drawingRevision: '3',
        importedAt: currentDrawing.importedAt,
      },
      projectName: null,
      updatedAt: '2026-09-30T09:00:00.000Z',
    });
    await queueReferenceDocumentRecord(corrected, false);

    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 1, queued: 0 });
    expect(mockCloud.get(currentDrawing.id)).toMatchObject({
      drawingNumber: 'A-210',
      webVersionGroupId: 'a-201',
    });
  });

  it('a change the cloud refuses is held with a plain reason and no retry until the owner edits again', async () => {
    await queueReferenceDocumentRecord(phoneEdit({ category: 'Specifications' }, '2026-09-30T09:00:00.000Z'), false);

    const refused = await uploadPendingChanges();
    expect(refused).toMatchObject({
      uploaded: 0,
      queued: 1,
      heldErrorCount: 1,
      itemOutcomes: { 'reference-document-drawing-a201': 'blocked' },
      errors: [`Document “A-201” could not sync. ${PLAIN}`],
    });
    expect(pendingChangesUploadNeedsRetry(refused)).toBe(false);
    await expect(getOfflineQueue()).resolves.toEqual([
      expect.objectContaining({
        id: 'reference-document-drawing-a201',
        lastError: PLAIN,
        lastFailureCategory: 'current_drawing_protected',
      }),
    ]);
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);

    // Held: a later pass does not send it again or ask for a retry.
    const held = await uploadPendingChanges();
    expect(held).toMatchObject({
      queued: 1,
      heldErrorCount: 1,
      itemOutcomes: { 'reference-document-drawing-a201': 'blocked' },
      errors: [`Document “A-201” could not sync. ${PLAIN}`],
    });
    expect(pendingChangesUploadNeedsRetry(held)).toBe(false);
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);

    // The owner puts it back in Drawing: the new revision is sent and accepted.
    await queueReferenceDocumentRecord(phoneEdit({ notes: 'Back in Drawing' }, '2026-09-30T09:05:00.000Z'), false);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 1, queued: 0, errors: [] });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(2);
    expect(mockCloud.get(currentDrawing.id)).toMatchObject({ category: 'Drawing', notes: 'Back in Drawing' });
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('another failure still asks for a retry', () => {
    expect(pendingChangesUploadNeedsRetry({
      configured: true,
      uploaded: 0,
      itemOutcomes: { held: 'blocked', other: 'failed' },
      queued: 2,
      conflicts: 0,
      errors: ['held', 'other'],
      heldErrorCount: 1,
    })).toBe(true);
    expect(pendingChangesUploadNeedsRetry({
      configured: true,
      uploaded: 0,
      itemOutcomes: { held: 'blocked' },
      queued: 2,
      conflicts: 0,
      errors: ['held', 'Protected file cleanup is temporarily unavailable.'],
      heldErrorCount: 1,
    })).toBe(true);
  });
});
