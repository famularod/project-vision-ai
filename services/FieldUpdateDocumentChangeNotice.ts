import { queuedFieldUpdateDocumentPatches } from './FieldUpdateDocumentPatch';
import { getOfflineQueue, subscribeToOfflineQueue, type SyncQueueItem } from './SyncService';

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
 * record waits already reads "Waiting to Sync" or failed.
 */
export function fieldUpdateDocumentChangeWaiting(
  queue: readonly SyncQueueItem[],
  updateId: string,
  now = Date.now(),
): FieldUpdateDocumentChangeWaiting {
  const item = queue.find(candidate =>
    (candidate.payload as { id?: unknown }).id === updateId && queuedFieldUpdateDocumentPatches(candidate));
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
