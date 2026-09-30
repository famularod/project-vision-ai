import AsyncStorage from '@react-native-async-storage/async-storage';
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

/** Why an offline opening was refused (whole-app audit A1 pass 2 #3). */
export type OfflineSignInRefusal = 'expired' | 'other_account' | 'clock' | 'unconfirmed';

/**
 * What the lockout says for each refusal. Every refused offline opening said
 * "Authentication is still loading. Try opening this workspace again in a
 * moment.", which was not why and did not say what to do (A1 pass 2 #3).
 */
export const OFFLINE_SIGN_IN_REFUSAL_MESSAGES: Readonly<Record<OfflineSignInRefusal, string>> = {
  expired: 'No signal, and your sign-in has not refreshed for 7 days. Your work is saved on this phone. Connect to the internet, then tap Retry.',
  other_account: 'No signal, and this phone was last used with a different account. Connect to the internet, then tap Retry.',
  clock: 'The phone\'s clock looks wrong. Check Date & Time, then tap Retry.',
  unconfirmed: 'No signal, and Vitruvius could not confirm your sign-in on this phone. Connect to the internet, then tap Retry.',
};

export function offlineSignInGraceRefusal({
  saved,
  workspaceOwnerId,
  nowMs,
  latestTimeSeenMs = null,
}: Readonly<{
  saved: SavedSignIn | null;
  workspaceOwnerId: string | null;
  nowMs: number;
  /** The latest time this account's offline workspace saw (A1 pass 2 #5). */
  latestTimeSeenMs?: number | null;
}>): OfflineSignInRefusal | null {
  if (!saved || !workspaceOwnerId) return 'unconfirmed';
  // The phone's open workspace must already be this account's: an offline
  // start never switches accounts or opens another account's data.
  if (saved.ownerId !== workspaceOwnerId) return 'other_account';
  const sinceLastRefreshMs = nowMs - saved.lastRefreshedAtMs;
  if (sinceLastRefreshMs < -OFFLINE_SIGN_IN_CLOCK_SKEW_MS) return 'clock';
  if (clockSetBack(nowMs, latestTimeSeenMs)) return 'clock';
  return sinceLastRefreshMs <= OFFLINE_SIGN_IN_GRACE_MS ? null : 'expired';
}

export function offlineSignInGraceAllows(
  input: Parameters<typeof offlineSignInGraceRefusal>[0],
): boolean {
  return offlineSignInGraceRefusal(input) === null;
}

/**
 * Whole-app audit A1 pass 2 #5: the 7 days were measured from the saved
 * token's issue time to the phone's clock, so setting the clock back
 * stretched them. The latest time the account's workspace saw while open
 * offline is kept on this phone (a time, not a secret), and an offline
 * opening whose clock reads earlier, beyond the drift allowance, is refused.
 * A sign-in refresh the server answered clears it (entry.ts), so a clock that
 * was wrong once and has been corrected does not keep refusing.
 */
const LATEST_TIME_SEEN_KEY_PREFIX = '@vitruvius/offline-sign-in/latest-time-seen/v1/';
const latestTimeSeenKey = (ownerId: string) =>
  `${LATEST_TIME_SEEN_KEY_PREFIX}${encodeURIComponent(ownerId)}`;

function clockSetBack(nowMs: number, latestTimeSeenMs: number | null): boolean {
  return latestTimeSeenMs !== null && nowMs < latestTimeSeenMs - OFFLINE_SIGN_IN_CLOCK_SKEW_MS;
}

/** Null when none is kept or it cannot be read: that alone refuses nothing. */
export async function readLatestTimeSeen(ownerId: string): Promise<number | null> {
  try {
    const value = Number(await AsyncStorage.getItem(latestTimeSeenKey(ownerId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Keeps `nowMs` if it is later than the kept time. Never throws. */
export async function noteLatestTimeSeen(ownerId: string, nowMs: number): Promise<void> {
  try {
    const latest = await readLatestTimeSeen(ownerId);
    if (latest !== null && latest >= nowMs) return;
    await AsyncStorage.setItem(latestTimeSeenKey(ownerId), String(nowMs));
  } catch {
    // Not kept: the saved token's time still bounds the clock.
  }
}

/** After a sign-in refresh the server answered: its token's time is the bound again. */
export async function clearLatestTimeSeen(ownerId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(latestTimeSeenKey(ownerId));
  } catch {
    // A kept time only refuses an offline opening; the next refresh retries.
  }
}

/**
 * After the startup session lookup failed: the workspace to open; or, with no
 * signal, why it stays locked (A1 pass 2 #3); or null to keep the lookup's
 * own message. The caller binds uploads to the account (whole-app audit A1
 * M3) only if it still opens it: a sign-in event that arrived meanwhile
 * decides instead (entry.ts).
 */
export async function workspaceOwnerAfterFailedLookup(
  workspaceOwnerOnThisPhone: () => Promise<string | null>,
  now: () => number = Date.now,
  timeoutMs: number = OFFLINE_LOOKUP_TIMEOUT_MS,
): Promise<WorkspaceOwnerAfterFailedLookup | Readonly<{ refused: OfflineSignInRefusal }> | null> {
  const refresh = await savedSignInRefreshWithin(timeoutMs);
  if (refresh.status === 'signed_in') {
    return { ownerId: refresh.ownerId, signInPending: false };
  }
  if (refresh.status !== 'network_unavailable') return null;
  const [saved, workspaceOwnerId] = await Promise.all([
    readSavedSignIn(),
    workspaceOwnerOnThisPhone(),
  ]);
  const latestTimeSeenMs = workspaceOwnerId ? await readLatestTimeSeen(workspaceOwnerId) : null;
  const nowMs = now();
  const refused = offlineSignInGraceRefusal({ saved, workspaceOwnerId, nowMs, latestTimeSeenMs });
  if (refused || !workspaceOwnerId) return { refused: refused ?? 'unconfirmed' };
  await noteLatestTimeSeen(workspaceOwnerId, nowMs);
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
 * or Retry (auth security review, 30 Sep 2026); so is the phone's clock, and
 * each passing check keeps the time it saw (A1 pass 2 #5). `onExpired` runs
 * once, with the reason. Returns the function that stops watching.
 */
export function watchOfflineSignInGrace({
  ownerId,
  onExpired,
  now = () => Date.now(),
  recheckMs = OFFLINE_SIGN_IN_GRACE_RECHECK_MS,
  appState = AppState as unknown as AppStateLike,
}: Readonly<{
  ownerId: string;
  onExpired: (reason: OfflineSignInRefusal) => void;
  now?: () => number;
  recheckMs?: number;
  appState?: AppStateLike;
}>): () => void {
  let watching = true;
  const check = () => {
    void offlineSignInGraceStillAllows(ownerId, now).then(async allowed => {
      const nowMs = now();
      const refused = clockSetBack(nowMs, await readLatestTimeSeen(ownerId))
        ? 'clock'
        : allowed ? null : 'expired';
      if (!watching) return;
      if (!refused) {
        await noteLatestTimeSeen(ownerId, nowMs);
        return;
      }
      stop();
      onExpired(refused);
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
