import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ReferenceDocument } from '../types';
import { personDetailsChanged } from '../services/SharedDocumentActivation';

import {
  cancelProjectDocumentSharedRecordSync,
  createProjectDocumentSharedRecordSyncLifecycle,
  disposeProjectDocumentSharedRecordSyncLifecycle,
  flushPendingProjectDocumentSharedRecordSync,
  flushProjectDocumentSharedRecordSync,
  projectDocumentChangeUsesDebouncedSync,
  queueProjectDocumentSharedRecordNow,
  scheduleProjectDocumentSharedRecordSync,
} from '../services/ProjectDocumentSharedRecordSyncLifecycle';

/** How long this device's own card edits are kept for a Make Current under way (S1e). */
const OWN_EDIT_KEPT_MS = 10 * 60 * 1000;

/**
 * Queues a phone document's shared record for the cloud: typed text once
 * typing pauses, a chip tap at once, and anything still waiting when the app
 * goes to the background (whole-app audit A8 pass 1 F1 (30 Sep 2026)).
 * `queueRecord` queues the latest shared record for that id.
 */
export function useProjectDocumentSharedRecordSync(
  queueRecord: (documentId: string) => void,
) {
  const queueRecordRef = useRef(queueRecord);
  queueRecordRef.current = queueRecord;
  const [lifecycle] = useState(createProjectDocumentSharedRecordSyncLifecycle);
  // S1e: what this device typed itself on each card, field by field and when (never a value received from elsewhere).
  const ownEditsRef = useRef(new Map<string, Map<string, { value: unknown; at: number }>>());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'background' && state !== 'inactive') return;
      flushPendingProjectDocumentSharedRecordSync({
        lifecycle,
        onReady: documentId => queueRecordRef.current(documentId),
      });
    });
    return () => {
      subscription.remove();
      disposeProjectDocumentSharedRecordSyncLifecycle(lifecycle);
    };
  }, [lifecycle]);

  return useMemo(() => {
    const onReady = (documentId: string) => queueRecordRef.current(documentId);
    return {
      queueAfterChange(documentId: string, next: object) {
        if (projectDocumentChangeUsesDebouncedSync(next)) {
          scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId, onReady });
        } else {
          queueProjectDocumentSharedRecordNow({ lifecycle, documentId, onReady });
        }
      },
      /**
       * Records one edit this device made itself on a card's shared copy (`before` -> `after`): the details it changed,
       * with the time. A value received from another device is never recorded here (the final review's F2, S1e).
       */
      noteOwnEdit(documentId: string, before: ReferenceDocument, after: ReferenceDocument) {
        const at = Date.now();
        const changed = Object.entries(personDetailsChanged(before, after));
        if (changed.length === 0) return;
        const fields = ownEditsRef.current.get(documentId) ?? new Map<string, { value: unknown; at: number }>();
        changed.forEach(([name, value]) => fields.set(name, { value, at }));
        ownEditsRef.current.set(documentId, fields);
        // Only the last minutes matter (a Make Current under way); older records are let go.
        ownEditsRef.current.forEach((kept, id) => {
          kept.forEach((edit, name) => { if (at - edit.at > OWN_EDIT_KEPT_MS) kept.delete(name); });
          if (kept.size === 0) ownEditsRef.current.delete(id);
        });
      },
      /** The details this device typed itself on each card since `time`, as they read after its last edit of each. */
      ownEditsSince(time: number): Map<string, Record<string, unknown>> {
        return new Map([...ownEditsRef.current].flatMap(([id, fields]) => {
          const since = Object.fromEntries([...fields].filter(([, edit]) => edit.at >= time).map(([name, edit]) => [name, edit.value]));
          return Object.keys(since).length > 0 ? [[id, since] as const] : [];
        }));
      },
      /**
       * Queues this document's shared record now, with any text still waiting for a pause: after Make Current, for text
       * typed on its card while the press was on its way (review pass 6, H6S-2).
       */
      queueNow(documentId: string) {
        queueProjectDocumentSharedRecordNow({ lifecycle, documentId, onReady });
      },
      /** Queues this document's waiting text now, as Make Current begins. */
      flush(documentId: string) {
        return flushProjectDocumentSharedRecordSync({ lifecycle, documentId, onReady });
      },
      cancel(documentId: string) {
        cancelProjectDocumentSharedRecordSync(lifecycle, documentId);
      },
    };
  }, [lifecycle]);
}
