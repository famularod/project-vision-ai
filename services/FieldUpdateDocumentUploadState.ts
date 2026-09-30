import type { PersistedFieldUpdateStatus } from './FieldUpdateLifecycle';
import { hasMatchingQueuedProjectUpdateRevision } from './ProjectUpdateQueueRevision';
import type { SyncQueueItem } from './SyncService';
import type { ProjectUpdate } from '../types';

/**
 * Documents attached to a field update (whole-app audit A7 pass 5 M1, 30 Sep
 * 2026).
 *
 * Each attached document carries its upload state: whether its file has
 * reached the cloud, the attempts, and where the file sits on the device
 * that added it. Only that device uploads the file, so only its own document
 * list says how the upload stands. A cloud copy of the update holds the state
 * the phone had when the update was last sent. A refresh put that copy over
 * the phone's own, so a document that uploaded after the update was sent read
 * "Document upload failed · Retry" again after every refresh.
 *
 * The list of attached documents is part of the update, and there is one
 * update shared by every device. Taking a document off it on the phone only
 * changed the phone's copy, and the next refresh put the document back.
 */

type UpdateDocument = Readonly<{ id: string }>;
type UpdateWithDocuments = Readonly<{ documents?: readonly UpdateDocument[] | null }>;

/** A document's upload state, which only the device holding the file knows. */
export const FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS = [
  'status',
  'uploadProgress',
  'uploadAttemptCount',
  'lastUploadAttemptAt',
  'uploadedAt',
  'storagePath',
  'referenceDocumentId',
  'localUri',
  'ownedFileId',
  'ownedFileManifest',
] as const;

/**
 * The update with this device's own upload state for each attached document
 * this device holds (its own document list has it). A document this device
 * does not hold keeps the state in the update: that is the other device's
 * last report. The same object comes back when nothing differs.
 */
export function withDeviceDocumentUploadState<TUpdate extends object>(
  update: TUpdate,
  deviceDocuments: readonly UpdateDocument[] | null | undefined,
): TUpdate {
  const documents = (update as UpdateWithDocuments).documents;
  if (!Array.isArray(documents) || documents.length === 0 || !deviceDocuments?.length) {
    return update;
  }
  const held = new Map(deviceDocuments.map(document => [document.id, document]));
  let changed = false;
  const nextDocuments = documents.map(document => {
    const own = held.get(document.id) as Record<string, unknown> | undefined;
    if (!own) return document;
    const next: Record<string, unknown> = { ...document };
    FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS.forEach(field => {
      if (own[field] === undefined) delete next[field];
      else next[field] = own[field];
    });
    if (uploadState(next) === uploadState(document as Record<string, unknown>)) return document;
    changed = true;
    return next as unknown as UpdateDocument;
  });
  return changed ? { ...update, documents: nextDocuments } : update;
}

/** The update without the document; the same object when it did not list it. */
export function withoutFieldUpdateDocument<TUpdate extends object>(
  update: TUpdate,
  documentId: string,
): TUpdate {
  const documents = (update as UpdateWithDocuments).documents;
  if (!Array.isArray(documents) || !documents.some(document => document.id === documentId)) {
    return update;
  }
  return { ...update, documents: documents.filter(document => document.id !== documentId) };
}

/**
 * The saved updates that must go up again after a change to one of their
 * documents that the other devices have to see, with the change made. Each
 * one lists the document and has been sent, or is waiting to be: a draft is
 * only on this device and goes up whole when it is sent. An archived one is
 * left as it is: its queue record may be the archive itself. A sent update
 * waits to sync again, as one does after a late photo-analysis result.
 */
export function fieldUpdatesToResendForDocument<
  TUpdate extends Readonly<{ id: string; status?: PersistedFieldUpdateStatus; isArchived?: boolean }>,
>(
  updates: readonly TUpdate[],
  documentId: string,
  change: (update: TUpdate) => TUpdate,
): TUpdate[] {
  return updates
    .filter(update =>
      (update.status === 'sent' || update.status === 'queued' || update.status === 'failed') &&
      !update.isArchived &&
      Boolean((update as UpdateWithDocuments).documents?.some(document => document.id === documentId)))
    .map(update => ({
      ...change(update),
      status: update.status === 'sent' ? 'queued' : update.status,
    }));
}

/**
 * The documents this device has uploaded that a cloud copy of an update
 * still reads as not uploaded, for an update this device owes nothing more
 * for (no queued revision): the copy the other devices hold is out of date.
 * An update sent before this was fixed still says "Document upload failed ·
 * Retry" on the iPad for a document that uploaded afterwards; the refresh
 * that finds it sends the update again. Once per document per launch: an
 * upload the cloud keeps refusing is not sent again at every refresh.
 */
export function documentsUploadedAfterCloudCopy(
  cloudUpdates: readonly object[],
  localUpdates: readonly object[],
  queue: readonly SyncQueueItem[],
  deviceDocuments: readonly UpdateDocument[],
): string[] {
  const uploaded = new Set(deviceDocuments
    .filter(document => (document as { status?: unknown }).status === 'uploaded')
    .map(document => document.id));
  if (uploaded.size === 0) return [];
  const localById = new Map(localUpdates.map(update => [(update as { id: string }).id, update]));
  const owed = new Set<string>();
  cloudUpdates.forEach(cloudUpdate => {
    const local = localById.get((cloudUpdate as { id: string }).id);
    if (!local || (cloudUpdate as { isArchived?: boolean }).isArchived) return;
    if (hasMatchingQueuedProjectUpdateRevision(local as ProjectUpdate, queue)) return;
    ((cloudUpdate as UpdateWithDocuments).documents || []).forEach(document => {
      if (uploaded.has(document.id) && (document as { status?: unknown }).status !== 'uploaded') owed.add(document.id);
    });
  });
  const due = [...owed].filter(documentId => !resentThisLaunch.has(documentId));
  due.forEach(documentId => resentThisLaunch.add(documentId));
  return due;
}

const resentThisLaunch = new Set<string>();

function uploadState(document: Record<string, unknown>): string {
  return JSON.stringify(FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS.map(field => document[field] ?? null));
}
