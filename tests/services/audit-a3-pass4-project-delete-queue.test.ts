// Whole-app audit A3 pass 4 (30 Sep 2026), findings 1a, 1b and 2 (queued
// copy): the real uploadPendingChanges against a mocked cloud.
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

type ListResult = {
  ok: boolean;
  configured: boolean;
  stubbed: boolean;
  data: Array<{ id: string; name: string }>;
  error?: string;
};
const listed = (data: Array<{ id: string; name: string }> = []): ListResult =>
  ({ ok: true, configured: true, stubbed: false, data });
const unreadable: ListResult = {
  ok: false, configured: true, stubbed: false, data: [], error: 'Network request failed',
};

// The cloud: which projects exist, as the mocked calls change it.
let mockCloudProjects: Array<{ id: string; name: string }> = [];
const mockCalls: string[] = [];
const mockListProjects = jest.fn((): Promise<ListResult> => Promise.resolve(listed(mockCloudProjects)));
const mockListArchivedProjects = jest.fn((): Promise<ListResult> => Promise.resolve(listed()));
const mockCreateProject = jest.fn(async (project: { name: string }) => {
  mockCalls.push(`create ${project.name}`);
  mockCloudProjects.push({ id: '2b1f3a52-8c1d-4e5f-9a6b-7c8d9e0f1a2b', name: project.name });
  return { ok: true, configured: true, stubbed: false, data: project };
});
const mockDeleteProject = jest.fn(async (project: { name: string }) => {
  mockCalls.push(`delete ${project.name}`);
  mockCloudProjects = mockCloudProjects.filter(candidate =>
    candidate.name.toLowerCase() !== project.name.toLowerCase());
  return { ok: true, configured: true, stubbed: false, data: null };
});
const mockUpdateProject = jest.fn(async (project: { previousName?: string; archived?: boolean }) => {
  mockCalls.push(`update ${project.previousName}`);
  const found = mockCloudProjects.some(candidate =>
    candidate.name.toLowerCase() === String(project.previousName).toLowerCase());
  if (found || project.archived === true) return { ok: true, configured: true, stubbed: false, data: null };
  return { ok: false, configured: true, stubbed: false, error: 'Project could not be found.' };
});
const mockUploadPhoto = jest.fn(async (upload: { path: string }) => {
  mockCalls.push(`upload ${upload.path}`);
  return { ok: true, configured: true, stubbed: false };
});
const mockUpsertReferenceDocument = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }));

jest.mock('../../services/SupabaseService', () => ({
  createProject: (project: { name: string }) => mockCreateProject(project),
  deleteProject: (project: { name: string }) => mockDeleteProject(project),
  updateProject: (project: { previousName?: string; archived?: boolean }) => mockUpdateProject(project),
  uploadPhoto: (upload: { path: string }) => mockUploadPhoto(upload),
  listProjects: () => mockListProjects(),
  listArchivedProjects: () => mockListArchivedProjects(),
  listReferenceDocuments: () => Promise.resolve({ ok: true, configured: true, stubbed: false, data: [] }),
  upsertReferenceDocument: (...args: unknown[]) => mockUpsertReferenceDocument(...args),
  listDAVESyncTombstones: () => Promise.resolve({ ok: true, configured: true, stubbed: false, data: [] }),
  upsertDAVESyncTombstones: (tombstones: unknown[]) =>
    Promise.resolve({ ok: true, configured: true, stubbed: false, data: tombstones }),
  listDAVEStorageCleanupIntents: () => Promise.resolve({ ok: true, configured: true, stubbed: false, data: [] }),
  removeProtectedStorageObject: () => Promise.resolve({ ok: true, configured: true, stubbed: false }),
  recordDAVEStorageCleanupAttempt: () => Promise.resolve({ ok: true, configured: true, stubbed: false }),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import {
  getOfflineQueue,
  uploadPendingChanges,
  withdrawQueuedChangesOfDeletedProject,
  type SyncQueueItem,
} from '../../services/SyncService';

const QUEUE_KEY = 'projectVisionAI.syncQueue.v1';
const DELETED_PROJECTS_KEY = 'projectPhotoUpdate.deletedProjects.v1';
const TOMBSTONES_KEY = '@dave/sync-tombstones/v1';
const TOWER_B_ID = '5c2d8e1f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const DELETED_ID = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

function projectItem(id: string, operation: SyncQueueItem['operation'], payload: Record<string, unknown>): SyncQueueItem {
  return {
    id,
    entity: 'project',
    operation,
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
    changedAt: '2026-09-30T12:00:00.000Z',
    retryCount: 0,
    lastError: null,
  };
}

const cover = (name: string) => projectItem(`cover-${name}`, 'update', {
  previousName: name,
  data: { coverPhoto: { remotePath: 'project-covers/lot-5-eats.jpg' } },
  coverPhotoUpload: {
    localUri: 'file:///cover.jpg', remotePath: 'project-covers/lot-5-eats.jpg', mimeType: 'image/jpeg',
  },
});

function sharedSchedule(projectNames: string[], projectName: string, projectId: string | null) {
  return {
    id: 'combined-schedule',
    name: 'Combined schedule',
    originalFileName: 'combined.pdf',
    uri: '',
    storagePath: 'owner/schedules/combined.pdf',
    category: 'Schedules',
    notes: '',
    isCurrent: true,
    importedAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    projectNames,
    projectName,
    projectId,
  };
}

function referenceDocumentItem(documentData: ReturnType<typeof sharedSchedule>): SyncQueueItem {
  return {
    id: `reference-document-${documentData.id}`,
    entity: 'reference_document',
    operation: 'update',
    payload: { id: documentData.id, documentData },
    createdAt: '2026-09-30T12:00:00.000Z',
    changedAt: '2026-09-30T12:00:00.000Z',
    retryCount: 0,
    lastError: null,
  };
}

describe('a deleted project stays deleted in the cloud (audit A3 pass 4, 1a)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCloudProjects = [];
    mockCalls.length = 0;
    // mockReset also drops a once-answer a test left unused.
    mockListArchivedProjects.mockReset();
    mockListArchivedProjects.mockImplementation(() => Promise.resolve(listed()));
  });

  it('drops the create of a project on the deleted list, so the delete leaves nothing active', async () => {
    // Added offline as "Lot 5 Eats" (a typo) and deleted; the deleted list
    // has it, the deletion record does not (a project deleted before
    // deletion records existed has only the list).
    mockStorageValues.set(DELETED_PROJECTS_KEY, JSON.stringify(['Lot 5 Eats']));
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      projectItem('create-lot-5', 'create', { name: 'Lot 5 Eats' }),
      projectItem('delete-lot-5', 'delete', { name: 'Lot 5 Eats' }),
    ]));
    // Weak signal: the create's name check cannot read the lists.
    mockListArchivedProjects.mockImplementationOnce(() => Promise.resolve(unreadable));

    const first = await uploadPendingChanges();
    expect(first.itemOutcomes).toMatchObject({ 'create-lot-5': 'superseded', 'delete-lot-5': 'uploaded' });
    await uploadPendingChanges();

    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockCloudProjects).toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('holds the delete while the project\'s create is still queued, then deletes what the create made', async () => {
    // Neither the deleted list nor a deletion record is readable here, so
    // only the queue order protects the project.
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      projectItem('create-lot-5', 'create', { name: 'Lot 5 Eats' }),
      projectItem('delete-lot-5', 'delete', { name: 'Lot 5 Eats' }),
    ]));
    mockListArchivedProjects.mockImplementationOnce(() => Promise.resolve(unreadable));

    const first = await uploadPendingChanges();
    expect(first.itemOutcomes).toMatchObject({ 'create-lot-5': 'failed', 'delete-lot-5': 'failed' });
    expect(first.errors.join(' ')).toContain('Project delete is waiting for the project to reach the cloud.');
    expect(mockDeleteProject).not.toHaveBeenCalled();

    await uploadPendingChanges();
    expect(mockCalls).toEqual(['create Lot 5 Eats', 'delete Lot 5 Eats']);
    expect(mockCloudProjects).toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('sends the delete in the same pass once the queued create is retired', async () => {
    mockStorageValues.set(DELETED_PROJECTS_KEY, JSON.stringify(['Lot 5 Eats']));
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      projectItem('create-lot-5', 'create', { name: 'Lot 5 Eats' }),
      projectItem('delete-lot-5', 'delete', { name: 'Lot 5 Eats' }),
    ]));
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0, errors: [] });
    expect(mockCalls).toEqual(['delete Lot 5 Eats']);
  });
});

describe('a deleted project\'s cover photo and reopen stop retrying (audit A3 pass 4, 1b)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCloudProjects = [];
    mockCalls.length = 0;
    // mockReset also drops a once-answer a test left unused.
    mockListArchivedProjects.mockReset();
    mockListArchivedProjects.mockImplementation(() => Promise.resolve(listed()));
  });

  it('retires a queued cover and reopen for a project on the deleted list without uploading the cover', async () => {
    mockStorageValues.set(DELETED_PROJECTS_KEY, JSON.stringify(['Lot 5 Eats']));
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      cover('Lot 5 Eats'),
      projectItem('reopen-lot-5', 'update', { previousName: 'Lot 5 Eats', archived: false }),
    ]));

    const result = await uploadPendingChanges();
    expect(result.itemOutcomes).toMatchObject({ 'cover-Lot 5 Eats': 'superseded', 'reopen-lot-5': 'superseded' });
    expect(result.errors).toEqual([]);
    expect(mockUploadPhoto).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('still sends a close for a name on the deleted list (the startup migration closes the retired shells)', async () => {
    mockStorageValues.set(DELETED_PROJECTS_KEY, JSON.stringify(['Tank Farm']));
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      projectItem('close-tank-farm', 'update', { previousName: 'Tank Farm', archived: true }),
    ]));
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0, errors: [] });
    expect(mockCalls).toEqual(['update Tank Farm']);
  });

  it('keeps a cover for a live project that is not on the deleted list', async () => {
    mockCloudProjects = [{ id: TOWER_B_ID, name: 'Tower B' }];
    mockStorageValues.set(DELETED_PROJECTS_KEY, JSON.stringify(['Lot 5 Eats']));
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([cover('Tower B')]));
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0, errors: [] });
    expect(mockCalls).toEqual(['upload project-covers/lot-5-eats.jpg', 'update Tower B']);
  });

  it('the delete cascade withdraws the project\'s cover and reopen and rewrites a shared document\'s queued copy', async () => {
    const otherCover = cover('Tower B');
    const close = projectItem('close-lot-5', 'update', { previousName: 'Lot 5 Eats', archived: true });
    const create = projectItem('create-lot-5', 'create', { name: 'Lot 5 Eats' });
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      create,
      cover('Lot 5 Eats'),
      projectItem('reopen-lot-5', 'update', { previousName: 'lot 5 eats', archived: false }),
      close,
      otherCover,
      referenceDocumentItem(sharedSchedule(['Lot 5 Eats', 'Tower B'], 'Lot 5 Eats', DELETED_ID)),
    ]));

    await expect(withdrawQueuedChangesOfDeletedProject('Lot 5 Eats', [
      { name: 'Lot 5 Eats', id: DELETED_ID },
      { name: 'Tower B', id: TOWER_B_ID },
    ])).resolves.toBe(3);

    const queue = await getOfflineQueue();
    expect(queue.map(item => item.id)).toEqual([
      create.id, close.id, otherCover.id, 'reference-document-combined-schedule',
    ]);
    expect((queue[3].payload as { documentData: unknown }).documentData).toMatchObject({
      projectNames: ['Tower B'], projectName: 'Tower B', projectId: TOWER_B_ID,
    });
  });
});

describe('a shared schedule kept after one of its projects is deleted still uploads (audit A3 pass 4, 2)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCalls.length = 0;
    mockCloudProjects = [{ id: TOWER_B_ID, name: 'Tower B' }];
    mockStorageValues.set(TOMBSTONES_KEY, JSON.stringify([
      { entityType: 'project', recordId: 'lot 5 eats', deletedAt: '2026-09-30T12:01:00.000Z' },
    ]));
  });

  it('uploads a copy that still carries the deleted project\'s id under its remaining project', async () => {
    // What the cloud's delete leaves: the list and name moved on, the id did not.
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      referenceDocumentItem(sharedSchedule(['Tower B'], 'Tower B', DELETED_ID)),
    ]));
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0, errors: [] });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: TOWER_B_ID, projectName: 'Tower B', projectNames: ['Tower B'] }),
      { existing: false },
    );
  });

  it('uploads the queued copy the delete cascade rewrote', async () => {
    mockStorageValues.set(QUEUE_KEY, JSON.stringify([
      referenceDocumentItem(sharedSchedule(['Lot 5 Eats', 'Tower B'], 'Lot 5 Eats', DELETED_ID)),
    ]));
    await withdrawQueuedChangesOfDeletedProject('Lot 5 Eats', [{ name: 'Lot 5 Eats', id: DELETED_ID }]);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0, errors: [] });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: TOWER_B_ID, projectName: 'Tower B', projectNames: ['Tower B'] }),
      { existing: false },
    );
  });
});
