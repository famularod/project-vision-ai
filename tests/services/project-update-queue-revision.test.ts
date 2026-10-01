import { hasMatchingQueuedProjectUpdateRevision, refreshKeepsLocalProjectUpdate } from '../../services/ProjectUpdateQueueRevision';
import type { SyncQueueItem } from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

const update: ProjectUpdate = {
  id: 'update-1',
  projectName: 'Project A',
  date: '2026-07-27T10:00:00.000Z',
  photos: [],
  notes: 'Current field note',
  recipients: { contactIds: [] },
  status: 'queued',
  workflowTimestamps: { sendTappedAt: '2026-07-27T10:00:00.000Z' },
};

function queued(updateData: ProjectUpdate): SyncQueueItem {
  return {
    id: `project-update-${updateData.id}`,
    entity: 'project_update',
    operation: 'update',
    payload: { id: updateData.id, updateData },
    createdAt: '2026-07-27T10:00:00.000Z',
    changedAt: '2026-07-27T10:00:00.000Z',
    retryCount: 0,
  };
}

describe('project update queue revision', () => {
  it('preserves a local update only while its exact generation is queued', () => {
    expect(hasMatchingQueuedProjectUpdateRevision(update, [queued(update)])).toBe(true);
  });

  it('does not preserve an older local generation for a newer queued edit', () => {
    const newer = { ...update, notes: 'Corrected note' };
    expect(hasMatchingQueuedProjectUpdateRevision(update, [queued(newer)])).toBe(false);
  });

  it('ignores transport-only completion metadata', () => {
    const queuedCopy = {
      ...update,
      status: 'sent' as const,
      workflowTimestamps: {
        ...update.workflowTimestamps,
        sendResolvedAt: '2026-07-27T10:00:05.000Z',
      },
    };
    expect(hasMatchingQueuedProjectUpdateRevision(update, [queued(queuedCopy)])).toBe(true);
  });

  it('does not treat delete or archive-only work as a pending update revision', () => {
    const deletion = {
      ...queued(update),
      operation: 'delete' as const,
      payload: { id: update.id },
    };
    const archiveOnly = {
      ...queued(update),
      payload: { id: update.id, archiveOnly: true },
    };

    expect(hasMatchingQueuedProjectUpdateRevision(update, [deletion, archiveOnly])).toBe(false);
  });

  // Whole-app audit A4 pass 12 H1: an upload pass writes the cloud project id
  // into the queued copy; the card never gets it.
  it('matches a queued copy whose cloud project id an upload pass bound, the card having none', () => {
    const bound = { ...update, projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9' };
    expect(hasMatchingQueuedProjectUpdateRevision(update, [queued(bound)])).toBe(true);
    expect(hasMatchingQueuedProjectUpdateRevision({ ...update, projectId: null }, [queued(bound)])).toBe(true);
  });

  it('still tells apart two copies naming different projects', () => {
    const bound = { ...update, projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9' };
    const otherId = { ...update, projectId: '0b0c2f5e-35a5-4b27-9d0f-4f2a3c1e9b11' };
    expect(hasMatchingQueuedProjectUpdateRevision(otherId, [queued(bound)])).toBe(false);
    expect(hasMatchingQueuedProjectUpdateRevision({ ...update, projectName: 'Project B' }, [queued(bound)])).toBe(false);
  });

  it('a refresh keeps a card still owing its own sync while a whole copy of it is queued, and only then', () => {
    const older = queued({ ...update, notes: 'Earlier field note' });
    expect(refreshKeepsLocalProjectUpdate(update, [older])).toBe(true);
    expect(refreshKeepsLocalProjectUpdate({ ...update, status: 'failed' }, [older])).toBe(true);
    expect(refreshKeepsLocalProjectUpdate({ ...update, status: 'sent' }, [older])).toBe(false);
    expect(refreshKeepsLocalProjectUpdate(update, [])).toBe(false);
    const patchOnly = { ...older, payload: { ...older.payload, documentPatches: [{ documentId: 'd1', remove: true }] } };
    const archiveOnly = { ...older, payload: { id: update.id, archiveOnly: true } };
    expect(refreshKeepsLocalProjectUpdate(update, [patchOnly, archiveOnly])).toBe(false);
    expect(refreshKeepsLocalProjectUpdate(update, [queued({ ...update, id: 'update-2' })])).toBe(false);
  });
});
