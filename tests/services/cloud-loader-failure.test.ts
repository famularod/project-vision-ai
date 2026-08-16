jest.mock('../../services/SupabaseService', () => ({
  listProjectUpdates: jest.fn(),
  listProjects: jest.fn(),
  listArchivedProjects: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/SyncService', () => ({
  hydrateRecoveredProjectUpdatePhotos: jest.fn(async value => value),
  queueProjectUpdateDelete: jest.fn(),
  queueProjectUpdateRecord: jest.fn(),
  removeProjectUpdateFromSyncQueue: jest.fn(),
  requestPendingChangesUpload: jest.fn(),
  runFieldUpdateCloudSync: jest.fn(),
  uploadPendingChanges: jest.fn(async () => ({ configured: true, errors: [] })),
  queueProjectCreate: jest.fn(),
  queueProjectDelete: jest.fn(),
  queueProjectUpdate: jest.fn(),
}));

import {
  listArchivedProjects,
  listProjectUpdates,
  listProjects,
} from '../../services/SupabaseService';
import {
  loadCloudArchivedProjectNames,
  loadCloudProjectRecords,
} from '../../services/projectService';
import { loadCloudUpdates } from '../../services/updateService';
import { requestPendingChangesUpload } from '../../services/SyncService';

const mockedListUpdates = listProjectUpdates as jest.MockedFunction<typeof listProjectUpdates>;
const mockedListProjects = listProjects as jest.MockedFunction<typeof listProjects>;
const mockedListArchived = listArchivedProjects as jest.MockedFunction<typeof listArchivedProjects>;
const mockedRequestPendingChangesUpload = requestPendingChangesUpload as jest.MockedFunction<
  typeof requestPendingChangesUpload
>;

describe('cloud loader failure boundaries', () => {
  it('does not convert a failed update read into authoritative empty data', async () => {
    mockedListUpdates.mockResolvedValueOnce({
      ok: false,
      configured: true,
      data: null,
      error: 'updates unavailable',
    });

    await expect(loadCloudUpdates()).rejects.toThrow('updates unavailable');
  });

  it('does not convert failed active or archived project reads into empty arrays', async () => {
    mockedListProjects.mockResolvedValueOnce({
      ok: false,
      configured: true,
      data: null,
      error: 'projects unavailable',
    });
    mockedListArchived.mockResolvedValueOnce({
      ok: false,
      configured: true,
      data: null,
      error: 'archive unavailable',
    });

    await expect(loadCloudProjectRecords()).rejects.toThrow('projects unavailable');
    await expect(loadCloudArchivedProjectNames()).rejects.toThrow('archive unavailable');
  });

  it('does not convert configured missing-table stubs into authoritative empty data', async () => {
    const missingTableStub = {
      ok: true,
      configured: true,
      stubbed: true,
      data: [],
      message: 'Required cloud table is not installed.',
    };
    mockedListUpdates.mockResolvedValueOnce(missingTableStub);
    mockedListProjects.mockResolvedValueOnce(missingTableStub);
    mockedListArchived.mockResolvedValueOnce(missingTableStub);

    await expect(loadCloudUpdates()).rejects.toThrow('Required cloud table is not installed.');
    await expect(loadCloudProjectRecords()).rejects.toThrow('Required cloud table is not installed.');
    await expect(loadCloudArchivedProjectNames()).rejects.toThrow('Required cloud table is not installed.');
  });

  it('returns a verified empty collection only after a successful cloud read', async () => {
    mockedListUpdates.mockResolvedValueOnce({
      ok: true,
      configured: true,
      data: [],
    });
    mockedListProjects.mockResolvedValueOnce({
      ok: true,
      configured: true,
      data: [],
    });

    await expect(loadCloudUpdates()).resolves.toEqual([]);
    await expect(loadCloudProjectRecords()).resolves.toEqual([]);
    expect(mockedRequestPendingChangesUpload).toHaveBeenCalledWith('cloud_update_loader');
    expect(mockedRequestPendingChangesUpload).toHaveBeenCalledWith('cloud_project_loader');
  });
});
