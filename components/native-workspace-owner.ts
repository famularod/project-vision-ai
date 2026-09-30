import { createContext, useContext } from 'react';

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
