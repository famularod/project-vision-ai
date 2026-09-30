import { AppState } from 'react-native';

import {
  awaitSavedSignInRefresh,
  readSavedSignIn,
  type SavedSignIn,
  type SavedSignInRefresh,
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
/**
 * A saved token issued later than the phone's clock says is now means the
 * clock was set back; beyond this allowance for ordinary clock drift the
 * offline opening is refused (auth security review, 30 Sep 2026).
 */
export const OFFLINE_SIGN_IN_CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * How long the offline lookup waits for the sign-in refresh before deciding
 * from the saved sign-in as if there were no signal. A refresh that hangs
 * (a captive portal) otherwise kept "Opening your workspace" up for about a
 * minute (auth security review, 30 Sep 2026).
 */
export const OFFLINE_LOOKUP_TIMEOUT_MS = 8_000;
/** How often the 7-day limit is re-checked while the workspace is open offline. */
export const OFFLINE_SIGN_IN_GRACE_RECHECK_MS = 60_000;

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
  if (!saved || !workspaceOwnerId) return false;
  const sinceLastRefreshMs = nowMs - saved.lastRefreshedAtMs;
  return (
    // The phone's open workspace must already be this account's: an offline
    // start never switches accounts or opens another account's data.
    saved.ownerId === workspaceOwnerId &&
    sinceLastRefreshMs >= -OFFLINE_SIGN_IN_CLOCK_SKEW_MS &&
    sinceLastRefreshMs <= OFFLINE_SIGN_IN_GRACE_MS
  );
}

/**
 * After the startup session lookup failed: the workspace to open, or null to
 * keep today's "Workspace protection needs attention". The caller binds
 * uploads to the account (whole-app audit A1 M3) only if it still opens it:
 * a sign-in event that arrived meanwhile decides instead (entry.ts).
 */
export async function workspaceOwnerAfterFailedLookup(
  workspaceOwnerOnThisPhone: () => Promise<string | null>,
  now: () => number = Date.now,
  timeoutMs: number = OFFLINE_LOOKUP_TIMEOUT_MS,
): Promise<WorkspaceOwnerAfterFailedLookup | null> {
  const refresh = await savedSignInRefreshWithin(timeoutMs);
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
  return { ownerId: workspaceOwnerId, signInPending: true };
}

async function savedSignInRefreshWithin(timeoutMs: number): Promise<SavedSignInRefresh> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      awaitSavedSignInRefresh(),
      new Promise<SavedSignInRefresh>(resolve => {
        timer = setTimeout(() => resolve({ status: 'network_unavailable' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whether the workspace open offline for `ownerId` is still within the 7 days. */
export async function offlineSignInGraceStillAllows(
  ownerId: string,
  now: () => number = () => Date.now(),
): Promise<boolean> {
  const saved = await readSavedSignIn().catch(() => null);
  return offlineSignInGraceAllows({ saved, workspaceOwnerId: ownerId, nowMs: now() });
}

type AppStateLike = Readonly<{
  addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { remove: () => void } | undefined;
}>;

/**
 * While the workspace is open offline, the 7-day limit is checked again each
 * time the app returns to the foreground and every minute, not only at launch
 * or Retry (auth security review, 30 Sep 2026). `onExpired` runs once.
 * Returns the function that stops watching.
 */
export function watchOfflineSignInGrace({
  ownerId,
  onExpired,
  now = () => Date.now(),
  recheckMs = OFFLINE_SIGN_IN_GRACE_RECHECK_MS,
  appState = AppState as unknown as AppStateLike,
}: Readonly<{
  ownerId: string;
  onExpired: () => void;
  now?: () => number;
  recheckMs?: number;
  appState?: AppStateLike;
}>): () => void {
  let watching = true;
  const check = () => {
    void offlineSignInGraceStillAllows(ownerId, now).then(allowed => {
      if (!watching || allowed) return;
      stop();
      onExpired();
    });
  };
  const interval = setInterval(check, recheckMs);
  const subscription = appState.addEventListener('change', state => {
    if (state === 'active') check();
  });
  function stop() {
    if (!watching) return;
    watching = false;
    clearInterval(interval);
    subscription?.remove();
  }
  return stop;
}
