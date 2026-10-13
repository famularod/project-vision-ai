import { getOfflineQueue } from './SyncService';

/**
 * Whether a shared document's own record is still waiting on this device to
 * go up to the cloud (second review of the archive change, P2-L4).
 *
 * The archive service asks this when the cloud says it holds no such
 * document while an Archive for it waits. Only a document made and archived
 * with no signal has no row in the cloud YET; with nothing of it waiting to
 * go up, "no such row" means the document has been deleted, and the Archive
 * is let go with a line saying so instead of being tried for ever.
 *
 * It reads the app's own upload list, the same way the rest of the app asks
 * whether a shared document is still queued, and changes nothing. If the
 * list cannot be read this rejects, and the archive service then decides
 * nothing (the Archive keeps waiting).
 */
export async function sharedDocumentRecordWaitingToUpload(documentId: string): Promise<boolean> {
  const queue = await getOfflineQueue();
  return queue.some(item => item.entity === 'reference_document' && (item.payload as { id?: string } | null)?.id === documentId);
}
