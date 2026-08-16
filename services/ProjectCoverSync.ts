import {
  sameProjectCoverAuthority,
  type ProjectCoverAuthorityReceipt,
  type ProjectCoverCommitMutation,
  type ProjectCoverCommitReceipt,
} from './ProjectCoverCommitAuthority';

export type ProjectCoverSyncOutcome = Readonly<{
  outcome: 'uploaded' | 'conflict' | 'retry';
  message?: string | null;
}>;

export async function uploadAndCommitProjectCoverMutation({
  mutation,
  currentAuthority,
  uploadAttempt,
  commitMutation,
  removeAttempt,
}: Readonly<{
  mutation: ProjectCoverCommitMutation;
  currentAuthority: () => Promise<ProjectCoverAuthorityReceipt | null>;
  uploadAttempt?: () => Promise<Readonly<{ ok: boolean; message?: string | null }>>;
  commitMutation: () => Promise<Readonly<{
    ok: boolean;
    receipt?: ProjectCoverCommitReceipt | null;
    message?: string | null;
  }>>;
  removeAttempt?: () => Promise<unknown>;
}>): Promise<ProjectCoverSyncOutcome> {
  const current = await currentAuthority();
  if (!current) {
    return { outcome: 'retry', message: 'Project cover authority could not be checked.' };
  }
  // A prior commit may have succeeded even when its response was lost. Once
  // the exact target is current, finish the durable queue item without
  // uploading or deleting the immutable object again.
  if (sameProjectCoverAuthority(current, mutation.target)) {
    return { outcome: 'uploaded' };
  }
  if (!sameProjectCoverAuthority(current, mutation.expected)) {
    return { outcome: 'conflict', message: 'The project cover changed on another device.' };
  }

  if (uploadAttempt) {
    const upload = await uploadAttempt();
    if (!upload.ok) {
      return { outcome: 'retry', message: upload.message || 'Project cover upload could not finish.' };
    }
  }

  const commit = await commitMutation();
  if (!commit.ok || !commit.receipt) {
    // An RPC transport failure is ambiguous: the database may have committed
    // before the response was lost. Keep the immutable object and retry; a
    // later idempotent receipt decides whether cleanup is safe.
    return { outcome: 'retry', message: commit.message || 'Project cover commit could not be confirmed.' };
  }
  if (commit.receipt.status === 'committed' || commit.receipt.status === 'already_committed') {
    return { outcome: 'uploaded' };
  }

  if (removeAttempt) await removeAttempt();
  return {
    outcome: 'conflict',
    message: commit.receipt.reason || 'The project cover changed on another device.',
  };
}
