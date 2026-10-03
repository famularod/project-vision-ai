import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
