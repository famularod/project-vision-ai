import { fieldUpdateSyncGeneration } from './FieldUpdateSyncGeneration';
import type { SyncQueueItem } from './SyncService';
import type { ProjectUpdate } from '../types';

type ProjectUpdateQueuePayload = {
  id?: unknown;
  updateData?: unknown;
  archiveOnly?: unknown;
};

/**
 * Returns true only when the durable device queue contains the same
 * user-authored generation as the visible local update. A generic retryable
 * lifecycle is not enough: that can leave an old device copy in front of a
 * newer cloud record after the original queue entry has already cleared.
 */
export function hasMatchingQueuedProjectUpdateRevision(
  update: ProjectUpdate,
  queue: readonly SyncQueueItem[],
): boolean {
  const expectedGeneration = fieldUpdateSyncGeneration(update);

  return queue.some(item => {
    if (item.entity !== 'project_update' || item.operation === 'delete') {
      return false;
    }
    const payload = item.payload as ProjectUpdateQueuePayload;
    if (
      payload.id !== update.id ||
      payload.archiveOnly === true ||
      !isProjectUpdateRecord(payload.updateData)
    ) {
      return false;
    }
    return fieldUpdateSyncGeneration(payload.updateData) === expectedGeneration;
  });
}

function isProjectUpdateRecord(value: unknown): value is ProjectUpdate {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ProjectUpdate>;
  return (
    typeof record.id === 'string' &&
    typeof record.projectName === 'string' &&
    typeof record.date === 'string' &&
    typeof record.notes === 'string' &&
    Array.isArray(record.photos)
  );
}
