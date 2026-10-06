import { useEffect, useRef } from 'react';

import { useNativeWorkspaceSignInPending } from '../components/native-workspace-owner';

/**
 * Runs `run` once each time "offline, sign-in pending" ends in the open
 * workspace (owner answer Q13): the saved sign-in refreshed when signal came
 * back. Everyday item 5 (2 Oct 2026): documents added meanwhile upload then,
 * as field updates already do.
 */
export function useAfterSignInPendingEnds(run: () => void): void {
  const pending = useNativeWorkspaceSignInPending();
  const wasPendingRef = useRef(pending);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (wasPendingRef.current && !pending) runRef.current();
    wasPendingRef.current = pending;
  }, [pending]);
}
