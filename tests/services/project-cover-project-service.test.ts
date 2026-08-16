jest.mock('../../services/SyncService', () => ({
  queueProjectCreate: jest.fn(),
  queueProjectDelete: jest.fn(),
  queueProjectUpdate: jest.fn(async () => undefined),
  requestPendingChangesUpload: jest.fn(),
}));
jest.mock('../../services/SupabaseService', () => ({
  listArchivedProjects: jest.fn(),
  listProjects: jest.fn(),
}));
jest.mock('../../services/BackgroundTaskGuard', () => ({
  startGuardedBackgroundTask: jest.fn(),
}));

import { startGuardedBackgroundTask } from '../../services/BackgroundTaskGuard';
import { saveCloudProjectCoverPhoto } from '../../services/projectService';
import { queueProjectUpdate } from '../../services/SyncService';

const mockQueueProjectUpdate = jest.mocked(queueProjectUpdate);
const mockStartGuardedBackgroundTask = jest.mocked(startGuardedBackgroundTask);

describe('project cover project-service authority', () => {
  const PROJECT_A_ID = '11111111-1111-4111-8111-111111111111';
  const PROJECT_B_ID = '22222222-2222-4222-8222-222222222222';
  const CONTENT_SHA256 = 'a'.repeat(64);
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queues a manual cover with one exact project id and the same exact object receipt', async () => {
    const projectId = PROJECT_A_ID;
    const remotePath = `project-covers/${projectId}/revisions/33333333-3333-4333-8333-333333333333.jpg`;
    const expectedRecord = {
      id: projectId,
      name: 'Shared Project',
      coverPhoto: null,
      coverPhotoMode: 'automatic' as const,
      coverPhotoUpdatedAt: '2026-08-09T23:59:00.000Z',
      data: {
        coverPhoto: null,
        coverPhotoMode: 'automatic',
        coverPhotoUpdatedAt: '2026-08-09T23:59:00.000Z',
      },
    };
    saveCloudProjectCoverPhoto(projectId, 'Shared Project', {
      localUri: 'file:///cover.jpg',
      remotePath,
      mimeType: 'image/jpeg',
      contentSha256: CONTENT_SHA256,
      sizeBytes: 1234,
      updatedAt: '2026-08-10T00:00:00.000Z',
    }, 'manual', expectedRecord);

    const task = mockStartGuardedBackgroundTask.mock.calls[0][0].task;
    await task();

    expect(mockQueueProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: projectId,
      previousName: 'Shared Project',
      data: expect.objectContaining({
        coverPhotoMode: 'manual',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
        coverPhoto: expect.objectContaining({
          remotePath,
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      }),
      coverPhotoCommit: expect.objectContaining({
        expected: expect.objectContaining({
          mode: 'automatic',
          updatedAt: '2026-08-09T23:59:00.000Z',
        }),
        target: expect.objectContaining({
          mode: 'manual',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
      }),
      coverPhotoUpload: expect.objectContaining({
        remotePath,
      }),
    }));
  });

  it('rejects the retired shared cover object path before queueing', () => {
    expect(() => saveCloudProjectCoverPhoto(PROJECT_A_ID, 'Shared Project', {
      localUri: 'file:///cover.jpg',
      remotePath: `project-covers/${PROJECT_A_ID}/cover.jpg`,
      mimeType: 'image/jpeg',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }, 'manual', {
      id: PROJECT_A_ID,
      name: 'Shared Project',
      coverPhoto: null,
      coverPhotoMode: 'automatic',
      coverPhotoUpdatedAt: null,
      data: null,
    })).toThrow(/immutable cover revision/i);

    expect(mockStartGuardedBackgroundTask).not.toHaveBeenCalled();
  });

  it('rejects a manual cover object owned by a different project before queueing', () => {
    expect(() => saveCloudProjectCoverPhoto(PROJECT_A_ID, 'Shared Project', {
      localUri: 'file:///cover.jpg',
      remotePath: `project-covers/${PROJECT_B_ID}/cover.jpg`,
      mimeType: 'image/jpeg',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }, 'manual', {
      id: PROJECT_A_ID,
      name: 'Shared Project',
      coverPhoto: null,
      coverPhotoMode: 'automatic',
      coverPhotoUpdatedAt: null,
      data: null,
    })).toThrow(/exact project ID/i);

    expect(mockStartGuardedBackgroundTask).not.toHaveBeenCalled();
    expect(mockQueueProjectUpdate).not.toHaveBeenCalled();
  });

  it('does not upload retained manual bytes when switching the project to automatic mode', async () => {
    const projectId = PROJECT_A_ID;
    const retainedCover = {
      localUri: 'file:///cover.jpg',
      remotePath: `project-covers/${projectId}/cover.jpg`,
      mimeType: 'image/jpeg',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    saveCloudProjectCoverPhoto(projectId, 'Shared Project', {
      ...retainedCover,
    }, 'automatic', {
      id: projectId,
      name: 'Shared Project',
      coverPhoto: retainedCover,
      coverPhotoMode: 'manual',
      coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      data: {
        coverPhoto: {
          remotePath: retainedCover.remotePath,
          mimeType: retainedCover.mimeType,
          updatedAt: retainedCover.updatedAt,
        },
        coverPhotoMode: 'manual',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
    }, '2026-08-10T00:01:00.000Z');

    await mockStartGuardedBackgroundTask.mock.calls[0][0].task();

    expect(mockQueueProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: projectId,
      data: expect.objectContaining({
        coverPhotoMode: 'automatic',
        coverPhotoUpdatedAt: '2026-08-10T00:01:00.000Z',
      }),
      coverPhotoCommit: expect.objectContaining({
        expected: expect.objectContaining({
          mode: 'manual',
          updatedAt: '2026-08-10T00:00:00.000Z',
        }),
        target: expect.objectContaining({
          mode: 'automatic',
          updatedAt: '2026-08-10T00:01:00.000Z',
        }),
      }),
      coverPhotoUpload: undefined,
    }));
  });
});
