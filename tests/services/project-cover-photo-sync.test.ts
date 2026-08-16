import {
  uploadAndCommitProjectCoverMutation,
} from '../../services/ProjectCoverSync';
import type {
  ProjectCoverCommitMutation,
} from '../../services/ProjectCoverCommitAuthority';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OLD_REVISION = '2026-08-10T00:00:00.000Z';
const NEW_REVISION = '2026-08-10T00:01:00.000Z';
const REMOTE_PATH = `project-covers/${PROJECT_ID}/revisions/33333333-3333-4333-8333-333333333333.jpg`;
const CONTENT_SHA256 = 'a'.repeat(64);

function mutation(): ProjectCoverCommitMutation {
  return {
    expected: {
      coverPhoto: null,
      mode: 'automatic',
      updatedAt: OLD_REVISION,
    },
    target: {
      coverPhoto: {
        remotePath: REMOTE_PATH,
        mimeType: 'image/jpeg',
        contentSha256: CONTENT_SHA256,
        sizeBytes: 1234,
        updatedAt: NEW_REVISION,
      },
      mode: 'manual',
      updatedAt: NEW_REVISION,
    },
  };
}

describe('project cover sync concurrency', () => {
  it('suppresses a stale queued revision before uploading any bytes', async () => {
    const uploadAttempt = jest.fn(async () => ({ ok: true }));
    const commitMutation = jest.fn(async () => ({
      ok: true,
      receipt: { status: 'committed' as const },
    }));

    await expect(uploadAndCommitProjectCoverMutation({
      mutation: mutation(),
      currentAuthority: async () => ({
        coverPhoto: null,
        mode: 'automatic',
        updatedAt: '2026-08-10T00:02:00.000Z',
      }),
      uploadAttempt,
      commitMutation,
    })).resolves.toMatchObject({ outcome: 'conflict' });
    expect(uploadAttempt).not.toHaveBeenCalled();
    expect(commitMutation).not.toHaveBeenCalled();
  });

  it('uploads one immutable attempt and commits it with the exact prior authority', async () => {
    const uploadAttempt = jest.fn(async () => ({ ok: true }));
    const commitMutation = jest.fn(async () => ({
      ok: true,
      receipt: { status: 'committed' as const },
    }));

    await expect(uploadAndCommitProjectCoverMutation({
      mutation: mutation(),
      currentAuthority: async () => mutation().expected,
      uploadAttempt,
      commitMutation,
    })).resolves.toEqual({ outcome: 'uploaded' });
    expect(uploadAttempt).toHaveBeenCalledTimes(1);
    expect(commitMutation).toHaveBeenCalledTimes(1);
  });

  it('cleans only the unique attempted object after an explicit atomic conflict', async () => {
    const removeAttempt = jest.fn(async () => undefined);

    await expect(uploadAndCommitProjectCoverMutation({
      mutation: mutation(),
      currentAuthority: async () => mutation().expected,
      uploadAttempt: async () => ({ ok: true }),
      commitMutation: async () => ({
        ok: true,
        receipt: { status: 'conflict', reason: 'revision changed' },
      }),
      removeAttempt,
    })).resolves.toMatchObject({ outcome: 'conflict' });
    expect(removeAttempt).toHaveBeenCalledTimes(1);
  });

  it('never deletes uploaded bytes after an indeterminate database failure', async () => {
    const removeAttempt = jest.fn(async () => undefined);

    await expect(uploadAndCommitProjectCoverMutation({
      mutation: mutation(),
      currentAuthority: async () => mutation().expected,
      uploadAttempt: async () => ({ ok: true }),
      commitMutation: async () => ({
        ok: false,
        message: 'connection closed after commit',
      }),
      removeAttempt,
    })).resolves.toMatchObject({
      outcome: 'retry',
      message: 'connection closed after commit',
    });
    expect(removeAttempt).not.toHaveBeenCalled();
  });

  it('resolves an already committed retry without uploading or deleting again', async () => {
    const uploadAttempt = jest.fn(async () => ({ ok: true }));
    const commitMutation = jest.fn(async () => ({
      ok: true,
      receipt: { status: 'committed' as const },
    }));
    const removeAttempt = jest.fn(async () => undefined);

    await expect(uploadAndCommitProjectCoverMutation({
      mutation: mutation(),
      currentAuthority: async () => mutation().target,
      uploadAttempt,
      commitMutation,
      removeAttempt,
    })).resolves.toEqual({ outcome: 'uploaded' });
    expect(uploadAttempt).not.toHaveBeenCalled();
    expect(commitMutation).not.toHaveBeenCalled();
    expect(removeAttempt).not.toHaveBeenCalled();
  });
});
