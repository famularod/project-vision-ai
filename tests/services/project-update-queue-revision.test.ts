import { hasMatchingQueuedProjectUpdateRevision } from '../../services/ProjectUpdateQueueRevision';
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
});
