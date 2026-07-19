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
});

describe('downloadCloudChanges collection failure propagation', () => {
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
    // Projects/updates are not tombstone-gated and stay independent.
    expect(result.collectionErrors.projects).toBeNull();
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
