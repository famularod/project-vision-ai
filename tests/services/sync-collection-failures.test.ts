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

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
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

import { downloadCloudChanges } from '../../services/SyncService';

function okResult<T>(data: T) {
  return { ok: true, configured: true, data };
}

function failedResult(error: string) {
  return { ok: false, configured: true, data: null, error };
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
  mockTombstoneSync.mockResolvedValue(authoritativeTombstones());
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
