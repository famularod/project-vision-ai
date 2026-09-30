import { noteSignedInOwner } from './CloudOwnerBinding';
import {
  awaitSavedSignInRefresh,
  readSavedSignIn,
  type SavedSignIn,
} from './SupabaseService';

/**
 * Owner answer Q13 (30 Sep 2026). The hourly sign-in token expires while the
 * app is closed; opened with no signal, its refresh cannot reach the server
 * and the owner was held at "Workspace protection needs attention" until
 * signal returned. The workspace already on this phone now opens for the
 * account whose sign-in is saved here, and only that account, marked
 * "offline, sign-in pending", for up to 7 days after the token last
 * refreshed. Uploads wait: no request carries an expired token. A refresh
 * the server rejects still signs out (auth-js removes the session and emits
 * SIGNED_OUT); after 7 days the lockout returns until there is signal.
 */
export const OFFLINE_SIGN_IN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkspaceOwnerAfterFailedLookup = Readonly<{
  ownerId: string;
  signInPending: boolean;
}>;

export function offlineSignInGraceAllows({
  saved,
  workspaceOwnerId,
  nowMs,
}: Readonly<{
  saved: SavedSignIn | null;
  workspaceOwnerId: string | null;
  nowMs: number;
}>): boolean {
  return Boolean(
    saved &&
    workspaceOwnerId &&
    // The phone's open workspace must already be this account's: an offline
    // start never switches accounts or opens another account's data.
    saved.ownerId === workspaceOwnerId &&
    nowMs - saved.lastRefreshedAtMs <= OFFLINE_SIGN_IN_GRACE_MS,
  );
}

/**
 * After the startup session lookup failed: the workspace to open, or null to
 * keep today's "Workspace protection needs attention".
 */
export async function workspaceOwnerAfterFailedLookup(
  workspaceOwnerOnThisPhone: () => Promise<string | null>,
  now: () => number = Date.now,
): Promise<WorkspaceOwnerAfterFailedLookup | null> {
  const refresh = await awaitSavedSignInRefresh();
  if (refresh.status === 'signed_in') {
    return { ownerId: refresh.ownerId, signInPending: false };
  }
  if (refresh.status !== 'network_unavailable') return null;
  const [saved, workspaceOwnerId] = await Promise.all([
    readSavedSignIn(),
    workspaceOwnerOnThisPhone(),
  ]);
  if (!offlineSignInGraceAllows({ saved, workspaceOwnerId, nowMs: now() }) || !workspaceOwnerId) {
    return null;
  }
  // Work queued meanwhile is this account's (whole-app audit A1 M3).
  noteSignedInOwner(workspaceOwnerId);
  return { ownerId: workspaceOwnerId, signInPending: true };
}
