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
