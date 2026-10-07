/**
 * What this device knows, right now, of the archived mark on shared
 * documents (owner answer Q44, 6 Oct 2026: an archived compliance document
 * is hidden on every device and kept in the cloud), and the one rule every
 * list and count uses.
 *
 * It is kept apart from services/SharedDocumentArchive.ts, which saves it on
 * the device and keeps it in step with the cloud, so that a screen or an
 * engine that only has to leave archived documents out (Reports, Project
 * Truth) can follow it without loading the device's storage (review of D1,
 * L10). Nothing here reads or writes anything: it holds what that file
 * publishes, and tells whoever follows it when it changes.
 */

/** A Restore made on this device that the cloud has not been told yet (review of D1, L5). */
export type SharedDocumentRestoreWaiting = Readonly<{ documentId: string; name?: string; refused: boolean }>;

/**
 * A tap that was let go without being sent, told to the owner in a line (review of D1, L2; second review, P2-M1).
 * `why` is also what the document's state now is: archived again on another device (still archived), restored on
 * another device (in Documents again), or deleted. The line stays until he taps OK, taps on that document again
 * here, or the state it speaks of changes.
 */
export type SharedDocumentArchiveNotice = Readonly<{
  documentId: string;
  tap: 'archive' | 'restore';
  why: 'archived_again_on_another_device' | 'restored_on_another_device' | 'deleted_from_all_devices';
  name?: string;
}>;

export type SharedDocumentArchiveView = Readonly<{
  installed: boolean | null;
  /** Every shared document to leave out of this device's lists. */
  archivedIds: ReadonlySet<string>;
  /** Archived here, not yet told to the cloud. */
  waitingIds: ReadonlySet<string>;
  /** Waiting, and the cloud has answered and not taken it: said plainly, and tried again (review of D1, L3). */
  refusedIds: ReadonlySet<string>;
  restoredElsewhere: readonly string[];
  /** Taps that were let go without being sent, until the owner dismisses each line (review of D1, L2). */
  notices: readonly SharedDocumentArchiveNotice[];
  /**
   * Restores made here that a pass to the cloud has not been able to send:
   * the document is listed on this device and still hidden on the others
   * (review of D1, L5). One tapped with signal is sent at once and is never
   * in this list.
   */
  waitingRestores: readonly SharedDocumentRestoreWaiting[];
}>;

export const NO_SHARED_DOCUMENT_ARCHIVE_NOTICES: readonly SharedDocumentArchiveNotice[] = Object.freeze([]);
/** Nothing known: no account open, or nothing read yet. */
export const EMPTY_SHARED_DOCUMENT_ARCHIVE_VIEW: SharedDocumentArchiveView = Object.freeze({
  installed: null, archivedIds: new Set<string>(), waitingIds: new Set<string>(), refusedIds: new Set<string>(),
  restoredElsewhere: Object.freeze([]) as readonly string[], notices: NO_SHARED_DOCUMENT_ARCHIVE_NOTICES,
  waitingRestores: Object.freeze([]) as readonly SharedDocumentRestoreWaiting[],
});

let view: SharedDocumentArchiveView = EMPTY_SHARED_DOCUMENT_ARCHIVE_VIEW;
const listeners = new Set<() => void>();

export function sharedDocumentArchiveView(): SharedDocumentArchiveView {
  return view;
}

export function subscribeSharedDocumentArchive(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called by services/SharedDocumentArchive.ts alone, each time what the device knows has changed. */
export function publishSharedDocumentArchiveView(next: SharedDocumentArchiveView): void {
  view = next;
  listeners.forEach(listener => listener());
}

/**
 * The one rule for every list and count of shared documents (owner answer
 * Q44; review of D1, L1 and L10): one the device knows is archived is left
 * out. With nothing of the list archived the very same list comes back, so
 * whatever is worked out from it (a count, a report, a report's fingerprint)
 * is untouched for an owner who has archived nothing.
 */
export function sharedDocumentsListed<L extends readonly Readonly<{ id: string }>[]>(documents: L, archivedIds: ReadonlySet<string>): L {
  if (archivedIds.size === 0 || !documents.some(document => archivedIds.has(document.id))) return documents;
  return documents.filter(document => !archivedIds.has(document.id)) as unknown as L;
}

/**
 * An update that is still being written: the documents it is shown with,
 * and sent with (second review, P2-L5; the coordinator's decision).
 *
 * Nothing is taken off any record because of an archive (review of D1, M1),
 * and a SENT update keeps showing a document it was sent with, as the record
 * of what was sent. But an unsent update has not been sent yet: while a
 * document on it is archived, the document is not shown on it and does not
 * go out with it. The update's own record still holds it, so if he restores
 * the document before sending, it is on the update again and is sent.
 *
 * A document is archived when this phone's own card for it is put away (the
 * only way before the database change is installed), or when the device
 * knows its shared copy is archived. With none of them archived the very
 * same update comes back.
 *
 * Call this for an update that is being written or about to be sent, never
 * for one that has been sent.
 */
export function unsentUpdateWithoutArchivedDocuments<U extends Readonly<{
  documents?: readonly Readonly<{ id: string; referenceDocumentId?: string | null }>[];
}>>(
  update: U,
  cards: readonly Readonly<{ id: string; referenceDocumentId?: string | null; isArchived?: boolean }>[],
  archivedIds: ReadonlySet<string>,
): U {
  const documents = update.documents;
  if (!documents || documents.length === 0) return update;
  if (archivedIds.size === 0 && !cards.some(card => card.isArchived)) return update;
  const cardById = new Map(cards.map(card => [card.id, card] as const));
  const isArchived = (document: Readonly<{ id: string; referenceDocumentId?: string | null }>) => {
    const card = cardById.get(document.id);
    if (card?.isArchived) return true;
    return [document.id, document.referenceDocumentId, card?.referenceDocumentId]
      .some(id => { const sharedId = id?.trim(); return Boolean(sharedId) && archivedIds.has(sharedId as string); });
  };
  if (!documents.some(isArchived)) return update;
  return { ...update, documents: documents.filter(document => !isArchived(document)) };
}
