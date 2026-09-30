import { queuedFieldUpdateDocumentPatches, withoutDocumentUploadState } from './FieldUpdateDocumentPatch';
import { sameFieldUpdateSyncGeneration } from './FieldUpdateSyncGeneration';
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
 *
 * A queued document change alone does not hold the local copy: it goes up
 * as a patch on the cloud's copy, which a refresh takes with the patch
 * applied (whole-app audit A7 pass 6 M1). Nor does a document's upload
 * state, which a progress step rewrites on this device only: a refresh in
 * an upload let the cloud's older copy replace a queued edit (A4 pass 8 F1).
 */
export function hasMatchingQueuedProjectUpdateRevision(
  update: ProjectUpdate,
  queue: readonly SyncQueueItem[],
): boolean {
  return queue.some(item => {
    if (item.entity !== 'project_update' || item.operation === 'delete') {
      return false;
    }
    const payload = item.payload as ProjectUpdateQueuePayload;
    if (
      payload.id !== update.id ||
      payload.archiveOnly === true ||
      queuedFieldUpdateDocumentPatches(item) ||
      !isProjectUpdateRecord(payload.updateData)
    ) {
      return false;
    }
    return sameFieldUpdateSyncGeneration(
      withoutDocumentUploadState(payload.updateData),
      withoutDocumentUploadState(update),
    );
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
