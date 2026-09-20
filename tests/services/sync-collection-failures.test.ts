/**
 * Audit P1-27: cloud list failures must surface as per-collection errors,
 * never as silently empty collections that read like authoritative state.
 */

const mockLists = {
  projects: jest.fn(),
  updates: jest.fn(),
  areas: jest.fn(),
  schedules: jest.fn(),
  documents: jest.fn(),
};

const mockCloudConnection = {
  configuration: jest.fn(),
  test: jest.fn(),
  countProjects: jest.fn(),
};

const mockWrites = {
  area: jest.fn(),
  schedule: jest.fn(),
  document: jest.fn(),
  prepareDocument: jest.fn(),
};

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorage.keys()])),
}));

jest.mock('../../services/SupabaseService', () => {
  const actual = jest.requireActual('../../services/SupabaseService');
  return {
    ...actual,
    listProjects: (...args: unknown[]) => mockLists.projects(...args),
    listProjectUpdates: (...args: unknown[]) => mockLists.updates(...args),
    listProjectAreas: (...args: unknown[]) => mockLists.areas(...args),
    listScheduleItems: (...args: unknown[]) => mockLists.schedules(...args),
    listReferenceDocuments: (...args: unknown[]) => mockLists.documents(...args),
    getSupabaseConfigurationStatus: (...args: unknown[]) =>
      mockCloudConnection.configuration(...args),
    testSupabaseConnection: (...args: unknown[]) => mockCloudConnection.test(...args),
    countCloudProjects: (...args: unknown[]) => mockCloudConnection.countProjects(...args),
    upsertProjectArea: (...args: unknown[]) => mockWrites.area(...args),
    upsertScheduleItem: (...args: unknown[]) => mockWrites.schedule(...args),
    upsertReferenceDocument: (...args: unknown[]) => mockWrites.document(...args),
  };
});

const mockTombstoneSync = jest.fn();

jest.mock('../../services/DAVESyncTombstones', () => {
  const actual = jest.requireActual('../../services/DAVESyncTombstones');
  return {
    ...actual,
    synchronizeDAVESyncTombstones: (...args: unknown[]) => mockTombstoneSync(...args),
  };
});

jest.mock('../../services/ReferenceDocumentRepository', () => ({
  prepareReferenceDocumentForCloud: (...args: unknown[]) =>
    mockWrites.prepareDocument(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  downloadCloudChanges,
  synchronizeLocalData,
} from '../../services/SyncService';

function okResult<T>(data: T) {
  return { ok: true, configured: true, data };
}

function failedResult(error: string) {
  return { ok: false, configured: true, data: null, error };
}

function missingTableStub(message: string) {
  return { ok: true, configured: true, stubbed: true, data: [], message };
}

function authoritativeTombstones() {
  return {
    cloudAuthoritative: true,
    cloudError: null,
    tombstones: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockTombstoneSync.mockResolvedValue(authoritativeTombstones());
  mockCloudConnection.configuration.mockReturnValue({
    configured: true,
    url: 'https://example.supabase.co',
    message: 'Configured.',
  });
  mockCloudConnection.test.mockResolvedValue({
    connected: true,
    projectCount: 1,
  });
  mockCloudConnection.countProjects.mockResolvedValue(okResult(1));
  mockLists.projects.mockResolvedValue(okResult([{ name: 'Alpha' }]));
  mockLists.updates.mockResolvedValue(okResult([]));
  mockLists.areas.mockResolvedValue(okResult([]));
  mockLists.schedules.mockResolvedValue(okResult([]));
  mockLists.documents.mockResolvedValue(okResult([]));
  mockWrites.area.mockResolvedValue(okResult(null));
  mockWrites.schedule.mockResolvedValue(okResult(null));
  mockWrites.document.mockResolvedValue(okResult(null));
  mockWrites.prepareDocument.mockImplementation(document => Promise.resolve(document));
});

describe('downloadCloudChanges collection failure propagation', () => {
  it('does not rewrite unchanged cloud GPS, task, or document records', async () => {
    const area = {
      id: 'area-1',
      name: 'North Lot',
      latitude: 33.9,
      longitude: -117.9,
      radiusFeet: 250,
      locationCapturedAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    };
    const task = {
      id: 'task-1',
      projectName: 'Alpha',
      scheduleProjectName: 'Alpha',
      locationName: 'North Lot',
      taskName: 'Install panels',
      startDate: '2026-08-15',
      finishDate: '2026-08-16',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 95,
      priority: 'Medium' as const,
      status: 'In Progress' as const,
      notes: '',
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    };
    const localDocument = {
      id: 'document-1',
      name: 'Current Drawing',
      originalFileName: 'drawing.pdf',
      uri: 'file:///device/drawing.pdf',
      storagePath: 'owner/drawings/drawing.pdf',
      category: 'Drawings',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
      projectId: 'project-alpha',
      projectName: 'Alpha',
    };
    const cloudDocument = {
      ...localDocument,
      uri: '',
      cloudUpdatedAt: '2026-08-15T12:01:00.000Z',
      ecosHostedIndexStatus: 'Ready for ECOS',
    };
    mockLists.areas.mockResolvedValue(okResult([area]));
    mockLists.schedules.mockResolvedValue(okResult([task]));
    mockLists.documents.mockResolvedValue(okResult([cloudDocument]));

    const result = await synchronizeLocalData({
      projects: ['Alpha'],
      savedUpdates: [],
      projectAreas: [area],
      scheduleItems: [task],
      referenceDocuments: [localDocument],
    });

    expect(mockWrites.area).not.toHaveBeenCalled();
    expect(mockWrites.schedule).not.toHaveBeenCalled();
    expect(mockWrites.document).not.toHaveBeenCalled();
    expect(result.details).toEqual(expect.objectContaining({
      areasUploaded: 0,
      schedulesUploaded: 0,
      documentsUploaded: 0,
    }));
    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.stringContaining('could not sync'),
    ]));
  });

  it('full-syncs the exact shared schedule and its protected file without requiring one project id', async () => {
    const PROJECT_2321 = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
    const PROJECT_2375 = '72e941d8-8114-4082-a976-ae5b2b5daba9';
    const localDocument = {
      id: 'mrv3pyi1-9o6xn6mt',
      name: 'PLZ 2321 & 2375 MASTER CONSTRUCTION SCHEDULE UPDATE 3-WEEK LOOKAHEAD 7202026',
      originalFileName: 'PLZ-2321-2375-MASTER-CONSTRUCTION-SCHEDULE.pdf',
      uri: 'file:///owned/project-documents/shared-master-schedule.pdf',
      mimeType: 'application/pdf',
      category: 'Schedules',
      notes: 'Schedule uploaded for task extraction and project manager review.',
      isCurrent: true,
      importedAt: '2026-07-21T20:23:54.601Z',
      updatedAt: '2026-07-21T20:23:54.601Z',
      projectId: null,
      projectName: null,
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      storagePath: null,
    };
    const cloudDocument = {
      ...localDocument,
      uri: '',
      cloudUpdatedAt: '2026-08-09T04:18:45.799275+00:00',
    };
    mockLists.projects.mockResolvedValue(okResult([
      { id: PROJECT_2321, name: '2321 Compliance Project' },
      { id: PROJECT_2375, name: '2375 Compliance Project' },
    ]));
    mockLists.documents.mockResolvedValue(okResult([cloudDocument]));
    mockWrites.prepareDocument.mockResolvedValueOnce({
      ...localDocument,
      storagePath: 'mobile/mrv3pyi1-9o6xn6mt/shared-master-schedule.pdf',
      contentSha256: 'b'.repeat(64),
      sizeBytes: 160_768,
    });

    const result = await synchronizeLocalData({
      projects: ['2321 Compliance Project', '2375 Compliance Project'],
      savedUpdates: [],
      projectAreas: [],
      scheduleItems: [],
      referenceDocuments: [localDocument],
    });

    expect(mockWrites.prepareDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: localDocument.id,
        projectId: null,
        projectName: null,
        projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      }),
    );
    expect(mockWrites.document).toHaveBeenCalledWith(
      expect.objectContaining({
        id: localDocument.id,
        projectId: null,
        projectName: null,
        projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
        storagePath: 'mobile/mrv3pyi1-9o6xn6mt/shared-master-schedule.pdf',
      }),
    );
    expect(result.details.documentsUploaded).toBe(1);
    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.stringContaining('does not identify its project'),
    ]));
  });

  it('reports no errors when every collection reads successfully', async () => {
    const result = await downloadCloudChanges();

    expect(result.collectionErrors).toEqual({
      projects: null,
      updates: null,
      projectAreas: null,
      scheduleItems: null,
      referenceDocuments: null,
    });
    expect(result.projects).toHaveLength(1);
  });

  it('marks a failed projects read instead of returning silent empty truth', async () => {
    mockLists.projects.mockResolvedValue(failedResult('relation unreachable'));

    const result = await downloadCloudChanges();

    expect(result.projects).toEqual([]);
    expect(result.collectionErrors.projects).toContain('relation unreachable');
    expect(result.collectionErrors.updates).toBeNull();
  });

  it('marks configured missing-table stubs as failed collection reads', async () => {
    mockLists.projects.mockResolvedValue(
      missingTableStub('projects table is not installed'),
    );
    mockLists.updates.mockResolvedValue(
      missingTableStub('updates table is not installed'),
    );

    const result = await downloadCloudChanges();

    expect(result.projects).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.collectionErrors.projects).toContain('projects table is not installed');
    expect(result.collectionErrors.updates).toContain('updates table is not installed');
  });

  it('returns a partial full sync without stamping lastSync when a configured table is missing', async () => {
    mockLists.projects.mockResolvedValue(
      missingTableStub('projects table is not installed'),
    );

    const result = await synchronizeLocalData({
      projects: [],
      savedUpdates: [],
      projectAreas: [],
      scheduleItems: [],
      referenceDocuments: [],
    });

    expect(result.downloadStatus).toBe('partial');
    expect(result.lastSyncAt).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('projects table is not installed'),
    ]));
    expect(result.recovered.projects).toEqual([]);
    expect(result.recovered.collectionErrors.projects).toContain(
      'projects table is not installed',
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      'projectVisionAI.lastSyncAt.v1',
      expect.any(String),
    );
  });

  it('marks each independently failed collection', async () => {
    mockLists.schedules.mockResolvedValue(failedResult('timeout'));
    mockLists.documents.mockResolvedValue(failedResult('row cap'));

    const result = await downloadCloudChanges();

    expect(result.collectionErrors.scheduleItems).toContain('timeout');
    expect(result.collectionErrors.referenceDocuments).toContain('row cap');
    expect(result.collectionErrors.projects).toBeNull();
    expect(result.collectionErrors.projectAreas).toBeNull();
  });

  it('marks tombstone-gated collections failed when deletion history is unverifiable', async () => {
    mockTombstoneSync.mockResolvedValue({
      cloudAuthoritative: false,
      cloudError: 'tombstone table unreachable',
      tombstones: [],
    });
    mockLists.areas.mockResolvedValue(okResult([{ id: 'a1' }]));

    const result = await downloadCloudChanges();

    expect(result.projectAreas).toEqual([]);
    expect(result.collectionErrors.projectAreas).toContain('tombstone table unreachable');
    expect(result.collectionErrors.scheduleItems).toContain('tombstone table unreachable');
    expect(result.collectionErrors.referenceDocuments).toContain('tombstone table unreachable');
    // Every remotely deletable collection is tombstone-gated. If deletion
    // history cannot be verified, projects and updates must fail closed too.
    expect(result.collectionErrors.projects).toContain('tombstone table unreachable');
    expect(result.collectionErrors.updates).toContain('tombstone table unreachable');
  });

  it('leaves unconfigured stubs silent rather than inventing failures', async () => {
    const stub = { ok: false, configured: false, data: null };
    mockLists.projects.mockResolvedValue(stub);
    mockLists.updates.mockResolvedValue(stub);

    const result = await downloadCloudChanges();

    expect(result.collectionErrors.projects).toBeNull();
    expect(result.collectionErrors.updates).toBeNull();
    expect(result.configured).toBe(false);
  });
});

describe('a failed projects read does not cascade into one error per record', () => {
  function scheduleTask(id: string) {
    return {
      id,
      projectName: 'Alpha',
      scheduleProjectName: 'Alpha',
      locationName: 'North Lot',
      taskName: `Task ${id}`,
      startDate: '2026-08-15',
      finishDate: '2026-08-16',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 0,
      priority: 'Medium' as const,
      status: 'Not Started' as const,
      notes: '',
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    };
  }

  it('reports the read once instead of once per task and document', async () => {
    // Schedule items and reference documents both resolve their project
    // through the identity authority built from listProjects. When that read
    // fails the authority is empty, so without a guard every record fails to
    // bind and contributes its own error — one upstream failure presented to
    // the field as N problems, none of which the owner can act on.
    const document = {
      id: 'document-1',
      name: 'Current Drawing',
      originalFileName: 'drawing.pdf',
      uri: 'file:///device/drawing.pdf',
      storagePath: 'owner/drawings/drawing.pdf',
      category: 'Drawings',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
      projectId: 'project-alpha',
      projectName: 'Alpha',
    };
    mockLists.projects.mockResolvedValue(failedResult('Cloud projects unavailable.'));

    const result = await synchronizeLocalData({
      projects: [],
      savedUpdates: [],
      projectAreas: [],
      scheduleItems: [scheduleTask('task-1'), scheduleTask('task-2'), scheduleTask('task-3')],
      referenceDocuments: [document],
    });

    expect(mockWrites.schedule).not.toHaveBeenCalled();
    expect(mockWrites.document).not.toHaveBeenCalled();
    expect(result.errors.filter(error => error.includes('Schedule task'))).toEqual([]);
    expect(result.errors.filter(error => error.includes('Document'))).toEqual([]);
    expect(result.errors).toContain('Cloud projects unavailable.');
  });
});
