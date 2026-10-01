import type { SyncQueueItem } from './SyncService';
import {
  applyFieldUpdatePhotoAnalysisPatch,
  isFieldUpdatePhotoAnalysisPatch,
  mergeFieldUpdatePhotoAnalysisPatches,
  photoAnalysisFinishedAfterPatch,
  type FieldUpdatePhotoAnalysisPatch,
} from './FieldUpdatePhotoAnalysisPatch';

/**
 * A change to one document attached to a sent field update, sent on its own
 * (whole-app audit A7 pass 6 M1, 30 Sep 2026).
 *
 * Taking a document off a sent update, or finishing its upload, sent this
 * phone's whole copy of the update again. A phone that had not yet seen the
 * iPad's newer edit of the update put its older copy over it, and the iPad's
 * note was gone from the cloud and from the iPad. The conflict check could
 * not stop it: it compared the cloud's time with the queue time, which each
 * sync attempt stamps afresh. The change now waits in the queue as a patch
 * and is applied to the cloud's current copy at upload.
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

/** Taken off the update, or its upload state as this device has it. */
export type FieldUpdateDocumentChange = Readonly<{
  documentId: string;
  remove?: true;
  uploadState?: Readonly<Record<string, unknown>>;
}>;

/**
 * A change that goes up on its own, as a patch on the cloud's copy: a
 * document's, or a photo analysis result that finished late (whole-app audit
 * A4 pass 13 G1; FieldUpdatePhotoAnalysisPatch). Both wait in a queued item's
 * `documentPatches`, the name it has on disk.
 */
export type FieldUpdateDocumentPatch = FieldUpdateDocumentChange | FieldUpdatePhotoAnalysisPatch;

/** The patch that brings a copy of the update to `update` for this document. */
export function fieldUpdateDocumentPatchFor(update: object, documentId: string): FieldUpdateDocumentChange {
  const document = (update as UpdateWithDocuments).documents?.find(item => item.id === documentId) as
    Record<string, unknown> | undefined;
  if (!document) return { documentId, remove: true };
  return {
    documentId,
    uploadState: Object.fromEntries(FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS
      .filter(field => document[field] !== undefined)
      .map(field => [field, document[field]])),
  };
}

/**
 * The patches that still go onto a copy of the update: an analysis result is
 * left out when the copy holds a later result for that photo, or the same one,
 * which may carry David's review mark (whole-app audit A4 pass 23 L2, pass 24
 * M1). Document patches all go. Used wherever this device's queued patches go
 * onto a copy: its own edit going up (A4 pass 14 #3), the cloud's copy at
 * upload and on the card, and the copies Keep Phone and Keep Cloud send (A4
 * pass 25 L1: the phone's result, finished offline, went over the iPad's
 * newer retried result and its Confirmed mark).
 */
export function fieldUpdatePatchesNotSuperseded(
  update: object,
  patches: readonly FieldUpdateDocumentPatch[],
): FieldUpdateDocumentPatch[] {
  return patches.filter(patch => !isFieldUpdatePhotoAnalysisPatch(patch) || !photoAnalysisFinishedAfterPatch(update, patch));
}

/**
 * The update with the patches applied, in order; the same object when none
 * changes it. A document the update does not list is not added back: it was
 * taken off elsewhere.
 */
export function applyFieldUpdateDocumentPatches<TUpdate extends object>(
  update: TUpdate,
  patches: readonly FieldUpdateDocumentPatch[],
): TUpdate {
  return patches.reduce((current, patch) => {
    if (isFieldUpdatePhotoAnalysisPatch(patch)) return applyFieldUpdatePhotoAnalysisPatch(current, patch);
    const documents = (current as UpdateWithDocuments).documents;
    if (!Array.isArray(documents) || !documents.some(document => document.id === patch.documentId)) return current;
    if (patch.remove) return { ...current, documents: documents.filter(document => document.id !== patch.documentId) };
    let changed = false;
    const nextDocuments = documents.map(document => {
      if (document.id !== patch.documentId || !patch.uploadState) return document;
      const next: Record<string, unknown> = { ...document };
      FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS.forEach(field => {
        if (patch.uploadState![field] === undefined) delete next[field];
        else next[field] = patch.uploadState![field];
      });
      if (uploadStateKey(next) === uploadStateKey(document as Record<string, unknown>)) return document;
      changed = true;
      return next as unknown as UpdateDocument;
    });
    return changed ? { ...current, documents: nextDocuments } : current;
  }, update);
}

/**
 * Patches waiting for one update: a later one for the same document replaces
 * it; a removal stands. A later result for the same photo goes last, with
 * what the earlier one cleared.
 */
export function mergeFieldUpdateDocumentPatches(
  existing: readonly FieldUpdateDocumentPatch[],
  incoming: FieldUpdateDocumentPatch,
): FieldUpdateDocumentPatch[] {
  if (isFieldUpdatePhotoAnalysisPatch(incoming)) {
    const earlier = existing.find((patch): patch is FieldUpdatePhotoAnalysisPatch =>
      isFieldUpdatePhotoAnalysisPatch(patch) && patch.photoId === incoming.photoId);
    return [
      ...existing.filter(patch => patch !== earlier),
      earlier ? mergeFieldUpdatePhotoAnalysisPatches(earlier, incoming) : incoming,
    ];
  }
  const sameDocument = (patch: FieldUpdateDocumentPatch): patch is FieldUpdateDocumentChange =>
    !isFieldUpdatePhotoAnalysisPatch(patch) && patch.documentId === incoming.documentId;
  if (existing.find(sameDocument)?.remove) return [...existing];
  return [...existing.filter(patch => !sameDocument(patch)), incoming];
}

/** The patches of a queued item that carries only document changes (or late analysis results); null for any other item. */
export function queuedFieldUpdateDocumentPatches(item: SyncQueueItem | undefined): FieldUpdateDocumentPatch[] | null {
  if (!item || item.entity !== 'project_update' || item.operation === 'delete') return null;
  const patches = (item.payload as { documentPatches?: unknown }).documentPatches;
  return Array.isArray(patches) && patches.length > 0 ? patches as FieldUpdateDocumentPatch[] : null;
}

/** The document patches waiting in the queue for this update, if that is all that waits for it. */
export function queuedDocumentPatchesForUpdate(
  queue: readonly SyncQueueItem[],
  updateId: string,
): FieldUpdateDocumentPatch[] | null {
  for (const item of queue) {
    if (item.entity !== 'project_update' || (item.payload as { id?: unknown }).id !== updateId) continue;
    const patches = queuedFieldUpdateDocumentPatches(item);
    if (patches) return patches;
  }
  return null;
}

/**
 * The update without its documents' upload state, nor the stamp each upload
 * step puts on a document: that is transport, not a new generation. A real
 * change to a document (its name, its category) still counts.
 */
export function withoutDocumentUploadState<TUpdate extends object>(update: TUpdate): TUpdate {
  const documents = (update as UpdateWithDocuments).documents;
  if (!Array.isArray(documents)) return update;
  return {
    ...update,
    documents: documents.map(document => {
      if (!document || typeof document !== 'object') return document;
      const rest: Record<string, unknown> = { ...document };
      [...FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS, 'updatedAt'].forEach(field => { delete rest[field]; });
      return rest;
    }),
  };
}

function uploadStateKey(document: Record<string, unknown>): string {
  return JSON.stringify(FIELD_UPDATE_DOCUMENT_UPLOAD_STATE_FIELDS.map(field => document[field] ?? null));
}

/**
 * Documents this device took off a field update on purpose (its journal:
 * FieldUpdateRemovedDocuments), as `${updateId}\n${documentId}`.
 */
export type RemovedFieldUpdateDocuments = ReadonlySet<string>;

export const removedFieldUpdateDocumentKey = (updateId: string, documentId: string) => `${updateId}\n${documentId}`;

/** The update without the documents this device took off it. */
export function withoutRemovedFieldUpdateDocuments<TUpdate extends object>(
  update: TUpdate,
  removed: RemovedFieldUpdateDocuments | undefined,
): TUpdate {
  const documents = (update as UpdateWithDocuments).documents;
  const updateId = (update as { id?: unknown }).id;
  if (!removed?.size || !Array.isArray(documents) || typeof updateId !== 'string') return update;
  const kept = documents.filter(document => !removed.has(removedFieldUpdateDocumentKey(updateId, document.id)));
  return kept.length === documents.length ? update : { ...update, documents: kept };
}
