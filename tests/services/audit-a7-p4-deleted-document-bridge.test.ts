/**
 * Whole-app audit A7 pass 4 (30 Sep 2026): deleting a phone document left its
 * shared record ("bridge") in the list and the upload queue. Since batch 1
 * let name-keyed records upload, a deleted document came back as a "Shared
 * project document" card and uploaded to the iPad and the cloud, and every
 * document deleted on Build 228 did the same on first launch. A bridge that
 * has not uploaded is now withdrawn; one already in the cloud is left for the
 * owner's decision (Q14).
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

const CLOUD_2375 = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockUpsertReferenceDocument = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }),
);

jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([{ id: CLOUD_2375, name: '2375 Compliance Project' }]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok([]),
  upsertReferenceDocument: (...args: unknown[]) => mockUpsertReferenceDocument(...args),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import {
  isProjectDocumentBridge,
  legacyOrphanedProjectDocumentBridges,
  parseStoredProjectDocuments,
  PROJECT_DOCUMENTS_STORAGE_KEY,
  projectDocumentBridgeOrphaned,
  withdrawUnsentProjectDocumentBridge,
} from '../../services/ProjectDocumentBridge';
import { enqueuePendingChange, getOfflineQueue, uploadPendingChanges } from '../../services/SyncService';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const KEY = 'project-2375-compliance-project';
const bridge = (overrides: Record<string, unknown> = {}) => ({
  id: 'spec-1',
  name: 'spec',
  originalFileName: 'spec.pdf',
  uri: '',
  storagePath: `project-documents/${KEY}/spec-1/spec.pdf`,
  category: 'Specification',
  notes: '',
  isCurrent: false,
  importedAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
  projectId: KEY,
  projectName: '2375 Compliance Project',
  projectNames: ['2375 Compliance Project'],
  ...overrides,
});
const phoneDocument = { id: 'spec-1', storagePath: `project-documents/${KEY}/spec-1/spec.pdf` };

describe('which shared records are a phone document\'s bridge, and when it is orphaned', () => {
  it('recognises only project-documents/<project>/<own id>/<file>', () => {
    expect(isProjectDocumentBridge(bridge())).toBe(true);
    expect(isProjectDocumentBridge(bridge({ storagePath: 'mobile/spec-1/spec.pdf' }))).toBe(false);
    // A Make Current schedule record has a fresh id under the document's path.
    expect(isProjectDocumentBridge(bridge({ id: 'uid-9' }))).toBe(false);
    expect(isProjectDocumentBridge(bridge({ storagePath: null }))).toBe(false);
  });

  it('is kept while any document, archived included, links to it by id, link or path', () => {
    expect(projectDocumentBridgeOrphaned(bridge(), [])).toBe(true);
    expect(projectDocumentBridgeOrphaned(bridge(), [{ id: 'spec-1' }])).toBe(false);
    expect(projectDocumentBridgeOrphaned(bridge(), [{ id: 'other', referenceDocumentId: 'spec-1' }])).toBe(false);
    expect(projectDocumentBridgeOrphaned(bridge(), [{ id: 'other', storagePath: phoneDocument.storagePath }])).toBe(false);
    expect(projectDocumentBridgeOrphaned(bridge({ storagePath: 'mobile/x/spec.pdf' }), [])).toBe(false);
  });

  it('reads the stored documents, or nothing when missing or unreadable', () => {
    expect(parseStoredProjectDocuments(null)).toBeNull();
    expect(parseStoredProjectDocuments('{')).toBeNull();
    expect(parseStoredProjectDocuments('{"id":"x"}')).toBeNull();
    expect(parseStoredProjectDocuments(JSON.stringify([phoneDocument, 7]))).toEqual([phoneDocument]);
  });

  it('drops at startup only Build 228 leftovers: name-key id, not current, no document', () => {
    const records = [
      bridge(),
      bridge({ id: 'uploaded', storagePath: `project-documents/${KEY}/uploaded/a.pdf`, projectId: CLOUD_2375 }),
      bridge({ id: 'new-style', storagePath: `project-documents/${KEY}/new-style/a.pdf`, projectId: null }),
      bridge({ id: 'current', storagePath: `project-documents/${KEY}/current/a.pdf`, isCurrent: true }),
      bridge({ id: 'linked', storagePath: `project-documents/${KEY}/linked/a.pdf` }),
      // Another non-cloud id is not this phone's name key: left alone.
      bridge({ id: 'foreign', storagePath: `project-documents/${KEY}/foreign/a.pdf`, projectId: 'project-other-site' }),
    ];
    expect(legacyOrphanedProjectDocumentBridges(records, [{ id: 'linked' }]).map(record => record.id)).toEqual(['spec-1']);
  });
});

describe('deleting a phone document withdraws its bridge only while it has not uploaded', () => {
  const run = (overrides: Partial<Parameters<typeof withdrawUnsentProjectDocumentBridge>[0]>) => {
    const withdraw = jest.fn(async () => undefined);
    const result = withdrawUnsentProjectDocumentBridge({
      bridge: bridge({ projectId: null }),
      remainingDocuments: [],
      isQueued: async () => true,
      withdraw,
      ...overrides,
    });
    return { result, withdraw };
  };

  it('withdraws a queued bridge nothing else links to', async () => {
    const { result, withdraw } = run({});
    await expect(result).resolves.toBe('spec-1');
    expect(withdraw).toHaveBeenCalledWith('spec-1');
  });

  it('leaves one already uploaded, still linked, current, or missing', async () => {
    for (const overrides of [
      { isQueued: async () => false },
      { remainingDocuments: [{ id: 'other', referenceDocumentId: 'spec-1' }] },
      { bridge: bridge({ isCurrent: true }) },
      { bridge: null },
    ]) {
      const { result, withdraw } = run(overrides);
      await expect(result).resolves.toBeNull();
      expect(withdraw).not.toHaveBeenCalled();
    }
  });

  it('is wired into the phone delete and the startup cleanup', () => {
    const start = app.indexOf('  function deleteProjectDocument(documentId: string) {');
    const body = app.slice(start, app.indexOf('  function deleteReferenceDocument(', start));
    expect(body).toMatch(/if \(!sensitive\) void withdrawUnsentProjectDocumentBridge\(\{/);
    expect(body).toContain("await removeOperationalRecordFromSyncQueue('reference_document', id); setReferenceDocuments(prev => prev.filter(item => item.id !== id));");
    expect(app).toContain('const orphanIds = legacyOrphanedProjectDocumentBridges(referenceDocuments, projectDocuments).map(document => document.id);');
    expect(app).toContain(`const PROJECT_DOCUMENTS_STORAGE_KEY = '${PROJECT_DOCUMENTS_STORAGE_KEY}';`);
  });

  // Owner answer Q14 (30 Sep 2026): the phone offers both.
  it('offers Delete from This Device and Delete from All Devices; All Devices deletes the shared copy first', () => {
    const start = app.indexOf('  function deleteProjectDocument(documentId: string) {');
    const body = app.slice(start, app.indexOf('  function deleteReferenceDocument(', start));
    expect(body).toContain("{ text: 'Delete from This Device', style: 'destructive', onPress: () => void removeFromDevice() },");
    expect(body).toContain("{ text: 'Delete from All Devices', style: 'destructive', onPress: removeFromAllDevices },");
    expect(body).toContain('This cannot be undone.');
    expect(body).toMatch(/if \(!sharedRecord \|\| sharedWithAnotherDocument\) return void removeFromDevice\(\);\n\s+void removeReferenceDocumentEverywhere\(sharedRecord\.id\)\n\s+\.then\(removed => \(removed === false \? undefined : removeFromDevice\(\)\)\)\n\s+\.catch\(\(\) => Alert\.alert\('Delete failed'/);
    // A compliance-sensitive document is still only archived.
    expect(body).toMatch(/\{ text: `Archive \$\{document\.category\}`, style: 'destructive', onPress: \(\) => void removeFromDevice\(\) \}/);
    // The same durable deletion record as every other reference delete.
    const everywhere = app.slice(app.indexOf('  async function removeReferenceDocumentEverywhere(documentId: string) {'));
    expect(everywhere.slice(0, 600)).toMatch(/await recordDAVESyncTombstone\('reference_document', documentId\);\n\s+rememberOperationalTombstones\(\[tombstone\]\);/);
    expect(app.match(/void removeReferenceDocumentEverywhere\(documentId\)/g)).toHaveLength(2);
  });
});

describe('the upload queue withdraws a bridge whose phone document is gone', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockUpsertReferenceDocument.mockClear();
  });

  const queueBridge = (documentData = bridge()) => enqueuePendingChange({
    id: 'reference-document-spec-1',
    entity: 'reference_document',
    operation: 'update',
    payload: { id: 'spec-1', documentData },
    changedAt: documentData.updatedAt,
    autoUpload: false,
  });

  it('a Build 228 leftover never uploads once its document was deleted', async () => {
    mockStorageValues.set(PROJECT_DOCUMENTS_STORAGE_KEY, JSON.stringify([{ id: 'other-doc' }]));
    await queueBridge();
    await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a bridge whose document is still there uploads as before', async () => {
    mockStorageValues.set(PROJECT_DOCUMENTS_STORAGE_KEY, JSON.stringify([phoneDocument]));
    await queueBridge();
    await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('uploads as before when the documents cannot be read', async () => {
    await queueBridge();
    await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(1);
  });
});
