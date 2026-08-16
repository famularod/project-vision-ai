import {
  immutableProjectCoverStoragePath,
  projectCoverStoragePathKind,
  validProjectCoverCommitMutation,
} from '../../services/ProjectCoverCommitAuthority';

describe('project cover commit authority', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const contentSha256 = 'a'.repeat(64);

  it('builds one immutable object namespace per exact project and attempt', () => {
    const path = immutableProjectCoverStoragePath(projectId, attemptId, 'image/jpeg');
    expect(path).toBe(
      `project-covers/${projectId}/revisions/${attemptId}.jpg`,
    );
    expect(projectCoverStoragePathKind(projectId, path)).toBe('immutable');
    expect(projectCoverStoragePathKind(
      projectId,
      `project-covers/${projectId}/cover.jpg`,
    )).toBe('legacy');
    expect(projectCoverStoragePathKind(
      projectId,
      'project-covers/22222222-2222-4222-8222-222222222222/revisions/' +
        `${attemptId}.jpg`,
    )).toBeNull();
  });

  it('accepts legacy paths only as a predecessor and requires immutable manual targets', () => {
    const updatedAt = '2026-08-11T15:30:00.000Z';
    expect(validProjectCoverCommitMutation(projectId, {
      expected: {
        coverPhoto: {
          remotePath: `project-covers/${projectId}/cover.jpg`,
          mimeType: 'image/jpeg',
          contentSha256: null,
          sizeBytes: null,
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
        mode: 'manual',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
      target: {
        coverPhoto: {
          remotePath: `project-covers/${projectId}/revisions/${attemptId}.jpg`,
          mimeType: 'image/jpeg',
          contentSha256,
          sizeBytes: 1234,
          updatedAt,
        },
        mode: 'manual',
        updatedAt,
      },
    })).toBe(true);

    expect(validProjectCoverCommitMutation(projectId, {
      expected: { coverPhoto: null, mode: 'automatic', updatedAt: null },
      target: {
        coverPhoto: {
          remotePath: `project-covers/${projectId}/cover.jpg`,
          mimeType: 'image/jpeg',
          contentSha256: null,
          sizeBytes: null,
          updatedAt,
        },
        mode: 'manual',
        updatedAt,
      },
    })).toBe(false);
  });
});
