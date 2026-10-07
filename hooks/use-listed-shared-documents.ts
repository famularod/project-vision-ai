import { useRef, useSyncExternalStore } from 'react';

import { sharedDocumentArchiveView, sharedDocumentsListed, subscribeSharedDocumentArchive } from '../services/SharedDocumentArchiveView';

const archivedIdsNow = () => sharedDocumentArchiveView().archivedIds;

/**
 * The shared documents a screen or an engine may count (owner answer Q44;
 * review of D1, L10): the ones this device does not know to be archived.
 *
 * With none of them archived the very same list is handed back, so nothing
 * worked out from it moves (a report's fingerprint above all). When the
 * archived set changes without changing what is left, the list handed back
 * last time is handed back again, so nothing downstream is worked out twice.
 */
export function useListedSharedDocuments<L extends readonly Readonly<{ id: string }>[] | undefined>(documents: L): L {
  const archivedIds = useSyncExternalStore(subscribeSharedDocumentArchive, archivedIdsNow, archivedIdsNow);
  const last = useRef<{ from: L; listed: L } | null>(null);
  if (!documents) return documents;
  const listed = sharedDocumentsListed(documents, archivedIds) as L & object;
  if (listed === documents) return documents;
  const before = last.current;
  if (before && before.from === documents && before.listed && before.listed.length === listed.length &&
      before.listed.every((document, index) => document === listed[index])) return before.listed;
  last.current = { from: documents, listed };
  return listed;
}
