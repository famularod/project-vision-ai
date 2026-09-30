/**
 * Audit A7 M1: a document added on the phone was queued with its project's
 * name key ("project-2375-compliance-project") as the project id. The upload
 * rejected it as an invalid cloud identity on every attempt, so phone
 * documents never synced. Items already stuck in a phone's queue must drain.
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
  enqueuePendingChange,
  getOfflineQueue,
  uploadPendingChanges,
} from '../../services/SyncService';

function phoneDocument(projectId: string, projectName: string | null) {
  return {
    id: 'spec-1',
    name: 'spec',
    originalFileName: 'spec.pdf',
    uri: '',
    storagePath: 'owner/project-documents/spec-1/spec.pdf',
    category: 'Specification',
    notes: '',
    isCurrent: false,
    importedAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
    projectId,
    projectName,
    projectNames: projectName ? [projectName] : [],
  };
}

async function queueDocument(documentData: ReturnType<typeof phoneDocument>) {
  await enqueuePendingChange({
    id: 'reference-document-spec-1',
    entity: 'reference_document',
    operation: 'update',
    payload: { id: 'spec-1', documentData },
    changedAt: documentData.updatedAt,
    autoUpload: false,
  });
}

describe('phone documents keyed by project name (audit A7 M1)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockUpsertReferenceDocument.mockClear();
  });

  it('uploads a queued document under its cloud project id', async () => {
    await queueDocument(phoneDocument('project-2375-compliance-project', '2375 Compliance Project'));

    await expect(uploadPendingChanges()).resolves.toMatchObject({
      uploaded: 1,
      queued: 0,
      uploadedByEntity: { reference_document: 1 },
    });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(expect.objectContaining({
      id: 'spec-1',
      projectId: CLOUD_2375,
      projectName: '2375 Compliance Project',
      projectNames: ['2375 Compliance Project'],
    }));
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('keeps holding a document whose key names no project it carries', async () => {
    await queueDocument(phoneDocument('project-2375-compliance-project', null));

    await expect(uploadPendingChanges()).resolves.toMatchObject({ uploaded: 0, queued: 1 });
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
  });
});
