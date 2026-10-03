import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  daveRegisteredIdentityNames,
  type DAVEIdentityCorrection,
} from '../services/DAVEIdentity';
import {
  markDAVEIdentityAliasCleanupScheduleRefreshed,
  runDAVEIdentityAliasCleanup,
  scheduleItemsSafeForFullSync,
  type DAVERemovedIdentityAlias,
} from '../services/DAVEIdentityAliasCleanup';

type ScheduleRow = {
  projectName: string;
  scheduleProjectName?: string | null;
  locationName: string;
};

/**
 * Runs the one-time alias cleanup (whole-app audit A11 pass 2) once the saved
 * corrections, projects and areas are on screen, and before the schedule's
 * names are settled, so startup (and with it every sync) waits for it. The
 * cloud refresh that follows startup gives renamed tasks their true names
 * back; until it lands, Sync Now leaves those tasks out.
 */
export function useIdentityAliasCleanup<T extends ScheduleRow>({
  retryAttempt,
  ready,
  projectNames,
  projectAreas,
  scheduleItems,
  onCorrections,
}: {
  retryAttempt: number;
  ready: boolean;
  projectNames: readonly string[];
  projectAreas: readonly { name: string }[];
  scheduleItems: readonly T[];
  onCorrections: (corrections: readonly DAVEIdentityCorrection[]) => void;
}) {
  const [doneAttempt, setDoneAttempt] = useState<number | null>(null);
  const [awaiting, setAwaiting] = useState<readonly DAVERemovedIdentityAlias[]>([]);
  const awaitingRef = useRef(awaiting);
  const inputsRef = useRef({ projectNames, projectAreas, onCorrections });
  inputsRef.current = { projectNames, projectAreas, onCorrections };
  const startedAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ready || startedAttemptRef.current === retryAttempt) return;
    startedAttemptRef.current = retryAttempt;
    let active = true;
    let finished = false;
    const inputs = inputsRef.current;
    void runDAVEIdentityAliasCleanup({
      registeredNames: daveRegisteredIdentityNames(inputs),
    })
      .then(result => {
        if (!active) return;
        if (result.removed.length > 0) inputsRef.current.onCorrections(result.corrections);
        awaitingRef.current = result.awaitingScheduleRefresh;
        setAwaiting(result.awaitingScheduleRefresh);
      })
      // Not fatal: the schedule ignores these aliases anyway, and the next
      // launch tries the cleanup again.
      .catch(() => undefined)
      .finally(() => {
        finished = true;
        if (active) setDoneAttempt(retryAttempt);
      });
    return () => {
      active = false;
      if (!finished) startedAttemptRef.current = null;
    };
  }, [ready, retryAttempt]);

  const markScheduleRefreshed = useCallback(() => {
    if (awaitingRef.current.length === 0) return;
    awaitingRef.current = [];
    setAwaiting([]);
    void markDAVEIdentityAliasCleanupScheduleRefreshed().catch(() => undefined);
  }, []);

  const scheduleItemsForFullSync = useMemo(
    () => scheduleItemsSafeForFullSync(scheduleItems, awaiting) as T[],
    [awaiting, scheduleItems],
  );

  return {
    done: doneAttempt === retryAttempt,
    awaitingScheduleRefresh: awaiting,
    markScheduleRefreshed,
    scheduleItemsForFullSync,
  };
}
