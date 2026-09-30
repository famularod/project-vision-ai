export type OwnerWorkspaceAuthDecision =
  | Readonly<{ action: 'activate'; ownerId: string | null }>
  | Readonly<{ action: 'ignore' }>;

/**
 * Supabase can emit a transient null INITIAL_SESSION while native secure
 * storage is still hydrating. That event must not move a signed-in device into
 * the signed-out storage namespace. Only an explicit SIGNED_OUT event may
 * activate the anonymous workspace.
 */
export function ownerWorkspaceAuthDecision(
  event: string,
  userId: string | null | undefined,
): OwnerWorkspaceAuthDecision {
  const normalizedUserId = userId?.trim() || null;
  if (normalizedUserId) {
    return { action: 'activate', ownerId: normalizedUserId };
  }
  if (event === 'SIGNED_OUT') {
    return { action: 'activate', ownerId: null };
  }
  return { action: 'ignore' };
}

export type WorkspaceAccountChange = Readonly<{
  userId: string | null;
  firstEvent: boolean;
  accountChanged: boolean;
}>;

/**
 * What one auth event means for the work the open workspace keeps per account
 * (App.tsx). A transient null, such as the INITIAL_SESSION of an offline start
 * whose refresh failed (owner answer Q13), says nothing about the account and
 * returns null: the token refresh that follows is the same account, so the
 * owner's field note and report are kept. A sign-out, or another account
 * after the first event, is a change.
 */
export function workspaceAccountChange(
  previousUserId: string | null | undefined,
  event: string,
  userId: string | null | undefined,
): WorkspaceAccountChange | null {
  const decision = ownerWorkspaceAuthDecision(event, userId);
  if (decision.action === 'ignore') return null;
  const firstEvent = previousUserId === undefined;
  return {
    userId: decision.ownerId,
    firstEvent,
    accountChanged: event === 'SIGNED_OUT' ||
      (!firstEvent && decision.ownerId !== previousUserId),
  };
}
