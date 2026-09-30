/**
 * Whole-app audit A8 pass 3 L2 (30 Sep 2026): deleting a project rewrites
 * the queued copy of a document shared with other projects (audit A3 pass 4),
 * so it no longer names the deleted project. For a Current drawing the cloud
 * refuses any change to its projects outside Make Current
 * (ecos_atomic_current_activation_required), and the phone held the change
 * saying "Make another revision current first, then edit this one again",
 * though the owner had not edited the drawing. The held reason now says the
 * cloud kept the drawing's projects, and names them.
 *
 * Not changed (recorded): the rewrite itself still cannot reach the cloud
 * while the drawing is Current.
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
// The guard (migration 20260809065350): a Current drawing's projects
// (projectId, projectName, projectNames) change only through Make Current.
const mockScope = (row: MockRow) => [...new Set([row.projectId, row.projectName, ...((row.projectNames as unknown[]) || [])]
  .map(value => String(value || '').trim().toLowerCase()).filter(Boolean))].sort().join('|');
const mockUpsertReferenceDocument = jest.fn(async (document: MockRow) => {
  const previous = mockCloud.get(String(document.id));
  if (previous?.isCurrent === true && document.isCurrent === true && mockScope(previous) !== mockScope(document)) {
    return { ok: false, configured: true, data: null, status: 400, error: 'ecos_atomic_current_activation_required' };
  }
  const { cloudUpdatedAt: _cloudUpdatedAt, ...documentData } = document;
  mockCloud.set(String(document.id), { ...documentData, cloudUpdatedAt: '2026-09-30T12:00:30.000Z' });
  return { ok: true, configured: true, stubbed: false, data: document };
});

jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([{ id: '4c6f1f1e-8b8a-4c2e-9d61-0f8f7d6a0001', name: 'Alpha' }, { id: '4c6f1f1e-8b8a-4c2e-9d61-0f8f7d6a0002', name: 'Beta' }]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok([...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: MockRow) => mockUpsertReferenceDocument(document),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import {
  getOfflineQueue,
  queueReferenceDocumentRecord,
  sanitizeUserFacingSyncMessage,
  uploadPendingChanges,
  withdrawQueuedChangesOfDeletedProject,
} from '../../services/SyncService';
import { classifySyncFailureText, CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE } from '../../services/SyncFailureCategory';
import type { ReferenceDocument } from '../../types';

const drawing: ReferenceDocument = {
  id: 'drawing-a201', name: 'A-201', originalFileName: 'A-201.pdf', uri: '', mimeType: 'application/pdf',
  category: 'Drawing', notes: '', isCurrent: true, importedAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z', storagePath: 'owner-1/documents/drawing-a201/A-201.pdf',
  drawingNumber: 'A-201', drawingRevision: '3', projectName: 'Alpha', projectNames: ['Alpha', 'Beta'],
};
const KEPT = 'This drawing is Current for ECOS, so the cloud kept its shared record and its projects (Alpha, Beta). Its projects change only once another revision is current: make one current first, then edit this drawing again.';

beforeEach(() => {
  mockStorageValues.clear();
  mockCloud.clear();
  mockCloud.set(drawing.id, { ...drawing, cloudUpdatedAt: '2026-09-01T12:00:05.000Z' });
  mockUpsertReferenceDocument.mockClear();
});

describe('a Current drawing shared with a deleted project (audit A8 pass 3 L2)', () => {
  it('the held reason names the projects the cloud kept, not an edit the owner never made', async () => {
    await queueReferenceDocumentRecord({ ...drawing, notes: 'Field verified', updatedAt: '2026-09-30T09:00:00.000Z' }, false);
    // Alpha deleted on the phone: the queued copy no longer names it.
    await expect(withdrawQueuedChangesOfDeletedProject('Alpha', [{ id: '4c6f1f1e-8b8a-4c2e-9d61-0f8f7d6a0002', name: 'Beta' }])).resolves.toBe(1);

    const result = await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);
    expect(result.errors.join(' ')).toContain(KEPT);
    expect(result.errors.join(' ')).not.toContain('then edit this one again');
    const [held] = await getOfflineQueue();
    expect(held).toMatchObject({ lastError: KEPT, lastFailureCategory: 'current_drawing_protected' });

    // Held, not retried, and still said the same way on the next pass.
    const again = await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);
    expect(again.errors.join(' ')).toContain(KEPT);
  });

  it('a refusal for another reason keeps the plain reason it had', async () => {
    // Moved out of Drawing: the projects are unchanged.
    mockUpsertReferenceDocument.mockResolvedValueOnce({ ok: false, configured: true, data: null, status: 400, error: 'ecos_atomic_current_activation_required' } as never);
    await queueReferenceDocumentRecord({ ...drawing, category: 'Specification', updatedAt: '2026-09-30T09:00:00.000Z' }, false);
    const result = await uploadPendingChanges();
    expect(result.errors.join(' ')).toContain(CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE);
  });

  it('the sentence is still read as the same held refusal', () => {
    expect(classifySyncFailureText([KEPT])).toBe('current_drawing_protected');
    expect(sanitizeUserFacingSyncMessage(KEPT)).toBe(KEPT);
    expect(sanitizeUserFacingSyncMessage('ecos_atomic_current_activation_required')).toBe(CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE);
  });
});
