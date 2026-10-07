import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useNativeWorkspaceOwner } from '../components/native-workspace-owner';
import type { DAVEOperationalRealtimePayload } from '../services/DAVEOperationalRefresh';
import { DAVE_SYNC_TOMBSTONES_STORAGE_KEY, deletedDAVERecordIds, parseDAVESyncTombstones } from '../services/DAVESyncTombstones';
import type { MobileArchivedDocument } from '../services/MobileDocumentWorkspace';
import {
  consumeSharedDocumentsRestoredElsewhere,
  noteSharedDocumentArchiveLiveRow,
  openSharedDocumentArchive,
  requestSharedDocumentArchive,
  sharedDocumentArchiveQuestion,
  sharedDocumentArchiveView,
  subscribeSharedDocumentArchive,
  syncSharedDocumentArchiveWithCloud,
} from '../services/SharedDocumentArchive';
import {
  getCurrentSessionUser,
  getSupabaseClient,
  setReferenceDocumentsListedListener,
} from '../services/SupabaseService';

/** While a mark is waiting and the cloud could take it, it is tried again this often. */
const WAITING_RETRY_MS = 30_000;
/** A mark the cloud has refused waits longer each time, up to this (review of D1, L3). */
const LONGEST_RETRY_MS = 15 * 60_000;

/**
 * The shared documents this device's deletion history says were deleted from
 * all devices (review of D1, L4): a deletion is not a Restore. Read as it is
 * saved, changing nothing; an unreadable history says nothing.
 */
async function deletedSharedDocumentIds(): Promise<string[]> {
  try {
    const saved = await AsyncStorage.getItem(DAVE_SYNC_TOMBSTONES_STORAGE_KEY);
    return saved ? deletedDAVERecordIds(parseDAVESyncTombstones(JSON.parse(saved)), 'reference_document') : [];
  } catch {
    return [];
  }
}

/**
 * Owner answer Q44 (6 Oct 2026): an archived compliance document is hidden on
 * every device and kept in the cloud. This gives the app shell what the
 * device knows of the mark (services/SharedDocumentArchive.ts), keeps it in
 * step with the cloud, and sends this device's own Archive and Restore:
 * - when the app opens, when it comes back to the front, and (once the
 *   cloud has the column) every time the shared-document list is read from
 *   the cloud (a refresh, Sync Now);
 * - straight after an Archive or a Restore, and again every half minute
 *   while one is still waiting for signal (one the cloud has refused is
 *   kept too, and tried after a wait that grows to a quarter of an hour).
 * Before the owner's database change there is nothing in the cloud to follow:
 * archiving stays on the one device, and nothing is shown about that.
 *
 * `restoreCards`: called with the ids of documents that are no longer
 * archived (restored here, or on another device), once `cardsLoaded`; the
 * shell takes the archived state off this device's own cards for them.
 */
export function useSharedDocumentArchive({ cardsLoaded, restoreCards }: Readonly<{
  cardsLoaded: boolean;
  restoreCards: (documentIds: readonly string[]) => void;
}>) {
  const ownerId = useNativeWorkspaceOwner();
  const view = useSyncExternalStore(subscribeSharedDocumentArchive, sharedDocumentArchiveView, sharedDocumentArchiveView);
  const restoreCardsRef = useRef(restoreCards);
  restoreCardsRef.current = restoreCards;
  const syncRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!ownerId) return undefined;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      const client = getSupabaseClient();
      if (!active || !client) return;
      try {
        const user = await getCurrentSessionUser();
        if (!active || !user.ok || user.data?.id !== ownerId) return;
        await syncSharedDocumentArchiveWithCloud({ client, ownerId, deletedDocumentIds: deletedSharedDocumentIds });
      } catch {
        // Nothing is shown: the device keeps what it last knew and tries again.
      }
      if (!active) return;
      if (retry) clearTimeout(retry);
      retry = undefined;
      const now = sharedDocumentArchiveView();
      if (now.waitingIds.size > 0 && now.installed !== false) {
        const wait = Math.min(LONGEST_RETRY_MS, Math.max(WAITING_RETRY_MS, (now.nextTryAt ?? 0) - Date.now()));
        retry = setTimeout(() => { void sync(); }, wait);
      }
    };
    syncRef.current = sync;
    // While the cloud has said "no such column" a list read does not ask again: the question is put when the app
    // opens and each time it comes back to the front, which is when the owner's database change is picked up.
    const listener = (client: Parameters<typeof syncSharedDocumentArchiveWithCloud>[0]['client'], listedFor: string) =>
      (listedFor === ownerId && sharedDocumentArchiveView().installed !== false
        ? syncSharedDocumentArchiveWithCloud({ client, ownerId, deletedDocumentIds: deletedSharedDocumentIds }) : Promise.resolve());
    setReferenceDocumentsListedListener?.(listener as Parameters<typeof setReferenceDocumentsListedListener>[0]);
    void openSharedDocumentArchive(ownerId).then(() => sync());
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      subscription.remove();
      setReferenceDocumentsListedListener?.(null);
      syncRef.current = async () => undefined;
    };
  }, [ownerId]);

  // Restored on another device: this device's own card for it comes back.
  useEffect(() => {
    if (!cardsLoaded || view.restoredElsewhere.length === 0) return;
    restoreCardsRef.current(view.restoredElsewhere);
    void consumeSharedDocumentsRestoredElsewhere(view.restoredElsewhere);
  }, [cardsLoaded, view.restoredElsewhere]);

  const ask = useCallback((documentId: string, archived: boolean, name?: string) => {
    void requestSharedDocumentArchive(documentId, archived, undefined, name).then(() => syncRef.current());
  }, []);
  // The document he was last asked about before archiving: its name goes with the tap, for the line that says so
  // if the tap is ever let go without being sent (review of D1, L2).
  const askedAboutRef = useRef<string | undefined>(undefined);

  return useMemo(() => ({
    installed: view.installed,
    archivedIds: view.archivedIds,
    waitingIds: view.waitingIds,
    refusedIds: view.refusedIds,
    /** The owner archived this shared document on this device. */
    archive: (documentId: string) => ask(documentId, true, askedAboutRef.current),
    /** Restore, from "Archived (n)": this device's card comes back and the cloud's mark is emptied. */
    restore: (document: MobileArchivedDocument) => {
      const ids = [document.cardId, document.sharedDocumentId].filter((id): id is string => Boolean(id));
      restoreCardsRef.current(ids);
      if (document.sharedDocumentId) ask(document.sharedDocumentId, false, document.name);
    },
    /** What the owner is asked before archiving, true to what will happen. */
    question: (name: string, category: string) => {
      askedAboutRef.current = name;
      return sharedDocumentArchiveQuestion(name, category, view.installed);
    },
    /** A live change to a shared document, as the cloud sent it. */
    noteLiveChange: (entity: string, payload?: DAVEOperationalRealtimePayload) => {
      if (entity !== 'reference_document' || !payload) return;
      void noteSharedDocumentArchiveLiveRow({ ownerId, eventType: payload.eventType, newRow: payload.newRow, oldRow: payload.oldRow });
    },
  }), [ask, ownerId, view]);
}
