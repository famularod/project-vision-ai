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
      ...withProjectIdBoundOnOneSideAside(
        withoutDocumentUploadState(payload.updateData),
        withoutDocumentUploadState(update),
      ),
    );
  });
}

/**
 * Whether a refresh keeps this device's copy of a field update over the
 * cloud's: its exact generation is queued, or it still owes its own sync
 * ("Waiting to Sync" or failed) and a whole copy of it is still queued
 * (whole-app audit A4 pass 12 H1). An edit saved again while the first
 * waited on its photos, its own queue write lost, no longer matched: the
 * refresh put the cloud's older copy on the card as Sent, and the waiting
 * copy sat behind its photos with nothing to send it. The queue record must
 * still be there: a waiting status alone kept an old copy over a newer cloud
 * record after its queue record had cleared. A document change alone, or an
 * archive, does not keep it.
 */
export function refreshKeepsLocalProjectUpdate(
  update: ProjectUpdate,
  queue: readonly SyncQueueItem[],
): boolean {
  if (hasMatchingQueuedProjectUpdateRevision(update, queue)) return true;
  if (update.status !== 'queued' && update.status !== 'failed') return false;
  return queue.some(item => {
    if (item.entity !== 'project_update' || item.operation === 'delete') return false;
    const payload = item.payload as ProjectUpdateQueuePayload;
    return payload.id === update.id && payload.archiveOnly !== true &&
      !queuedFieldUpdateDocumentPatches(item) && isProjectUpdateRecord(payload.updateData);
  });
}

/**
 * The cloud project id an upload pass writes into the queued copy
 * (prepareQueueItemProjectIdentity) is not an edit: the card never gets it,
 * so after an edit of a Sent update waited on its photos the two no longer
 * matched, and the refresh put the cloud's older copy on the card as Sent,
 * with nothing left to send the edit (whole-app audit A4 pass 12 H1). The
 * id counts only when both copies carry one; the project name still does.
 */
function withProjectIdBoundOnOneSideAside<T extends { projectId?: unknown }>(queued: T, local: T): [T, T] {
  if (queued.projectId && local.projectId) return [queued, local];
  return [{ ...queued, projectId: undefined }, { ...local, projectId: undefined }];
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
