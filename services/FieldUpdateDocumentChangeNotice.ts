import { queuedFieldUpdateDocumentPatches } from './FieldUpdateDocumentPatch';
import { isFieldUpdatePhotoAnalysisPatch } from './FieldUpdatePhotoAnalysisPatch';
import {
  getOfflineQueue,
  getSyncConflicts,
  subscribeToOfflineQueue,
  subscribeToSyncConflicts,
  type SyncConflict,
  type SyncQueueItem,
} from './SyncService';

/**
 * A document change on a sent field update that has not reached the cloud
 * (whole-app audit A7 pass 8 L2, 30 Sep 2026).
 *
 * A document change on a sent update leaves it "Sent"; only its patch goes up
 * (A7 pass 7 M1). When that upload failed, the update still read "Sent" and
 * the iPad still listed the document taken off; only Admin's pending changes
 * said anything. The update's card now says so.
 */
export const FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT = 'Document change waiting to sync';

/** A patch whose upload has not failed is shown once it has waited this long; it normally goes up in seconds. */
export const FIELD_UPDATE_DOCUMENT_CHANGE_SHOWN_AFTER_MS = 2 * 60_000;

export type FieldUpdateDocumentChangeWaiting = Readonly<{
  /** The card shows the line. */
  shown: boolean;
  /** When a waiting patch is (or will be) shown; null when none waits. */
  shownAt: number | null;
}>;

/**
 * Whether a field update has a document change waiting to sync that its card
 * shows: a document patch for it is queued and its upload failed, or it has
 * waited FIELD_UPDATE_DOCUMENT_CHANGE_SHOWN_AFTER_MS. An update whose own
 * record waits already reads "Waiting to Sync" or failed. A late photo
 * analysis result waiting alone is not a document change (A4 pass 13 G1).
 */
export function fieldUpdateDocumentChangeWaiting(
  queue: readonly SyncQueueItem[],
  updateId: string,
  now = Date.now(),
): FieldUpdateDocumentChangeWaiting {
  const item = queue.find(candidate =>
    (candidate.payload as { id?: unknown }).id === updateId &&
    queuedFieldUpdateDocumentPatches(candidate)?.some(patch => !isFieldUpdatePhotoAnalysisPatch(patch)));
  if (!item) return { shown: false, shownAt: null };
  if (item.lastError) return { shown: true, shownAt: now };
  const queuedAt = Date.parse(item.createdAt);
  const shownAt = (Number.isFinite(queuedAt) ? queuedAt : now) + FIELD_UPDATE_DOCUMENT_CHANGE_SHOWN_AFTER_MS;
  return { shown: now >= shownAt, shownAt };
}

let queueSnapshot: readonly SyncQueueItem[] = [];
let queueWrites = 0;
let listening = false;
const snapshotListeners = new Set<() => void>();

function publishQueue(queue: readonly SyncQueueItem[]) {
  queueSnapshot = queue;
  queueWrites += 1;
  snapshotListeners.forEach(listener => listener());
}

/**
 * For useSyncExternalStore: the queue as this device last wrote it. Read once
 * when the first card subscribes (a write since that read began wins over
 * it), then kept by each write, so a card shown later starts current.
 */
export function subscribeToQueuedDocumentChanges(listener: () => void): () => void {
  snapshotListeners.add(listener);
  if (!listening) {
    listening = true;
    subscribeToOfflineQueue(publishQueue);
    const writesBeforeRead = queueWrites;
    void getOfflineQueue()
      .then(queue => {
        if (queueWrites === writesBeforeRead) publishQueue(queue);
      })
      .catch(() => undefined);
  }
  return () => {
    snapshotListeners.delete(listener);
  };
}

export function queuedDocumentChangesSnapshot(): readonly SyncQueueItem[] {
  return queueSnapshot;
}

/**
 * A field update in conflict, waiting or failed on this phone (whole-app
 * audit A7 pass 12 M-1). Every automatic sync (the waiting-update sync, Sync
 * Now, Retry Sync) leaves its own copy for Settings › Review Conflicts, but
 * its card still read "Waiting to Sync" and "Queued — will sync when you're
 * back online", with the phone online. It now says it needs review, and
 * where. Its Retry is still an explicit send of the phone's version: it asks
 * first.
 */
export const FIELD_UPDATE_CONFLICT_REVIEW_LABEL = 'Needs Review';
export const FIELD_UPDATE_CONFLICT_REVIEW_TEXT = 'Needs review — open Settings › Review Conflicts';
export const FIELD_UPDATE_RETRY_OVER_CONFLICT_TITLE = 'Send your version?';
export const FIELD_UPDATE_RETRY_OVER_CONFLICT_MESSAGE = 'This update was also changed on another device. Send your version over it?';

/** Whether a conflict saved on this phone is this field update's. */
export function fieldUpdateHasOpenConflict(conflicts: readonly SyncConflict[], updateId: string): boolean {
  return conflicts.some(conflict => conflict.entity === 'project_update' && conflict.localId === updateId);
}

let conflictsSnapshot: readonly SyncConflict[] = [];
let conflictWrites = 0;
let listeningToConflicts = false;
const conflictSnapshotListeners = new Set<() => void>();

function publishConflicts(conflicts: readonly SyncConflict[]) {
  conflictsSnapshot = conflicts;
  conflictWrites += 1;
  conflictSnapshotListeners.forEach(listener => listener());
}

/** For useSyncExternalStore: the saved conflicts, read and kept as the queue is (subscribeToQueuedDocumentChanges). */
export function subscribeToFieldUpdateConflicts(listener: () => void): () => void {
  conflictSnapshotListeners.add(listener);
  if (!listeningToConflicts) {
    listeningToConflicts = true;
    subscribeToSyncConflicts(publishConflicts);
    const writesBeforeRead = conflictWrites;
    void getSyncConflicts()
      .then(conflicts => {
        if (conflictWrites === writesBeforeRead) publishConflicts(conflicts);
      })
      .catch(() => undefined);
  }
  return () => {
    conflictSnapshotListeners.delete(listener);
  };
}

export function fieldUpdateConflictsSnapshot(): readonly SyncConflict[] {
  return conflictsSnapshot;
}
