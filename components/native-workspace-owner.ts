import { createContext, useContext, useRef } from 'react';

/**
 * Selects local storage only, after NativeRoot has activated the owner sandbox.
 * This is not permission to read/write cloud data; backend authorization remains
 * separate. Undefined means the boundary is missing, not a signed-out owner.
 */
export const NativeWorkspaceOwnerContext = createContext<string | null | undefined>(undefined);

export function useNativeWorkspaceOwner(): string | null {
  const owner = useContext(NativeWorkspaceOwnerContext);
  if (owner === undefined) {
    throw new Error('Native local data requires the workspace owner boundary.');
  }
  return owner;
}

/**
 * True while the workspace is open offline on a saved sign-in whose refresh
 * could not reach the server (owner answer Q13). Uploads wait meanwhile.
 */
export const NativeWorkspaceSignInPendingContext = createContext(false);

export function useNativeWorkspaceSignInPending(): boolean {
  return useContext(NativeWorkspaceSignInPendingContext);
}

/**
 * The same, read when an upload is tried rather than when the screen drew:
 * a field update that cannot upload meanwhile waits to sync instead of
 * failing with "Session expired" (whole-app audit A4 pass 7 M1).
 */
export function useNativeWorkspaceSignInPendingRef(): { readonly current: boolean } {
  const pending = useNativeWorkspaceSignInPending();
  const ref = useRef(pending);
  ref.current = pending;
  return ref;
}
