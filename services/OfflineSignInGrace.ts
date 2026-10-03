import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import {
  awaitSavedSignInRefresh,
  readSavedSignIn,
  type SavedSignIn,
  type SavedSignInRefresh,
  type SavedSignInRefreshOptions,
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
/**
 * Whole-app audit A1 pass 3 L2: a kept "latest time seen" later than this
 * after the saved sign-in's last refresh is not trusted. A time is only kept
 * while the workspace is open offline within the 7 days, so every time this
 * module keeps is at most the last refresh plus 7 days (and a later sign-in
 * only moves the last refresh later); the hour is margin. So the cap never
 * lets a clock set back through; it only ignores a kept time that cannot have
 * been seen here, which would otherwise refuse a correct clock until signal.
 */
export const OFFLINE_SIGN_IN_TIME_SEEN_TRUST_MS = OFFLINE_SIGN_IN_GRACE_MS + 60 * 60 * 1000;
/** A1 pass 3 L1: shown while the sign-in finishes once signal is back. */
export const SIGNAL_BACK_FINISHING_SIGN_IN = 'Signal is back — finishing sign-in…';
/**
 * Whole-app audit A1 pass 4 L2: the lockout when the sign-in server answered
 * 5xx (an outage). It said "Signal is back — finishing sign-in…" for about 90
 * seconds, then "No signal, and your sign-in has not refreshed for 7 days…",
 * with signal there all along.
 */
export const SIGN_IN_SERVER_NOT_ANSWERING_MESSAGE =
  'The sign-in server isn\'t answering right now. Your work on this phone is kept. Try again in a few minutes.';

export type WorkspaceOwnerAfterFailedLookup = Readonly<{
  ownerId: string;
  signInPending: boolean;
  /**
   * With signInPending: when the saved sign-in the launch check read last
   * refreshed, for the re-check while open offline (A1 pass 3 L3).
   */
  lastRefreshedAtMs?: number;
}>;

/** Why an offline opening was refused (whole-app audit A1 pass 2 #3). */
export type OfflineSignInRefusal = 'expired' | 'other_account' | 'clock' | 'unconfirmed';

/**
 * Why the launch lookup kept the lockout: a refusal, or with any refusal but
 * the clock's, the sign-in server not answering (A1 pass 4 L2).
 */
export type OfflineSignInLookupRefusal = OfflineSignInRefusal | 'server_not_answering';

/** With 'clock', the latest time this phone saw, which the clock is earlier than (A1 pass 3 L2). */
export type OfflineSignInRefusalDetail = Readonly<{ reason: OfflineSignInRefusal; seenAtMs?: number }>;

/**
 * What the lockout says for each refusal. Every refused offline opening said
 * "Authentication is still loading. Try opening this workspace again in a
 * moment.", which was not why and did not say what to do (A1 pass 2 #3).
 * A1 pass 3 L2: the clock refusal said "The phone's clock looks wrong. Check
 * Date & Time", also when the clock was right and a time kept earlier (with
 * the clock ahead) was the wrong one. It now says what was seen, and what to
 * do either way; offlineSignInRefusalMessage adds the time when known.
 */
export const OFFLINE_SIGN_IN_REFUSAL_MESSAGES: Readonly<Record<OfflineSignInRefusal, string>> = {
  expired: 'No signal, and your sign-in has not refreshed for 7 days. Your work is saved on this phone. Connect to the internet, then tap Retry.',
  other_account: 'No signal, and this phone was last used with a different account. Connect to the internet, then tap Retry.',
  clock: 'The phone\'s clock is earlier than a time this phone already saw. If the clock is right, connect to the internet, then tap Retry. If not, correct it in Date & Time, then tap Retry.',
  unconfirmed: 'No signal, and Vitruvius could not confirm your sign-in on this phone. Connect to the internet, then tap Retry.',
};

/** The lockout's message; for a clock refusal, with the time seen (A1 pass 3 L2). */
export function offlineSignInRefusalMessage(reason: OfflineSignInLookupRefusal, seenAtMs?: number | null): string {
  if (reason === 'server_not_answering') return SIGN_IN_SERVER_NOT_ANSWERING_MESSAGE;
  if (reason !== 'clock' || typeof seenAtMs !== 'number' || !Number.isFinite(seenAtMs)) {
    return OFFLINE_SIGN_IN_REFUSAL_MESSAGES[reason];
  }
  return `The phone's clock is earlier than a time this phone already saw on ${formatTimeSeen(seenAtMs)}. ` +
    'If the clock is right, connect to the internet, then tap Retry. If not, correct it in Date & Time, then tap Retry.';
}

/** "Oct 3, 2026, 2:05 PM", in the phone's time zone. */
function formatTimeSeen(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

type OfflineSignInGraceInput = Readonly<{
  saved: SavedSignIn | null;
  workspaceOwnerId: string | null;
  nowMs: number;
  /** The latest time this account's offline workspace saw (A1 pass 2 #5). */
  latestTimeSeenMs?: number | null;
}>;

export function offlineSignInGraceRefusal(input: OfflineSignInGraceInput): OfflineSignInRefusal | null {
  return offlineSignInGraceRefusalDetail(input)?.reason ?? null;
}

/** As offlineSignInGraceRefusal, with the time seen for a clock refusal (A1 pass 3 L2). */
export function offlineSignInGraceRefusalDetail({
  saved,
  workspaceOwnerId,
  nowMs,
  latestTimeSeenMs = null,
}: OfflineSignInGraceInput): OfflineSignInRefusalDetail | null {
  if (!saved || !workspaceOwnerId) return { reason: 'unconfirmed' };
  // The phone's open workspace must already be this account's: an offline
  // start never switches accounts or opens another account's data.
  if (saved.ownerId !== workspaceOwnerId) return { reason: 'other_account' };
  const clock = clockRefusal(nowMs, saved.lastRefreshedAtMs, latestTimeSeenMs);
  if (clock) return clock;
  return nowMs - saved.lastRefreshedAtMs <= OFFLINE_SIGN_IN_GRACE_MS ? null : { reason: 'expired' };
}

/**
 * A clock earlier, beyond the drift allowance, than the latest time this
 * phone saw for the sign-in: its last refresh (auth security review), or a
 * later time kept while open offline (A1 pass 2 #5) that can be trusted
 * (A1 pass 3 L2). Without a last refresh, a kept time is taken as it is.
 */
function clockRefusal(
  nowMs: number,
  lastRefreshedAtMs: number | null,
  latestTimeSeenMs: number | null,
): OfflineSignInRefusalDetail | null {
  const kept = trustedTimeSeen(latestTimeSeenMs, lastRefreshedAtMs);
  const seenAtMs = Math.max(lastRefreshedAtMs ?? -Infinity, kept ?? -Infinity);
  return Number.isFinite(seenAtMs) && nowMs < seenAtMs - OFFLINE_SIGN_IN_CLOCK_SKEW_MS
    ? { reason: 'clock', seenAtMs }
    : null;
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

/** A kept time, unless it cannot have been seen here on this sign-in (A1 pass 3 L2). */
function trustedTimeSeen(latestTimeSeenMs: number | null, lastRefreshedAtMs: number | null): number | null {
  if (latestTimeSeenMs === null) return null;
  if (lastRefreshedAtMs === null) return latestTimeSeenMs;
  return latestTimeSeenMs - lastRefreshedAtMs <= OFFLINE_SIGN_IN_TIME_SEEN_TRUST_MS ? latestTimeSeenMs : null;
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

/**
 * Keeps `nowMs` if it is later than the kept time, or the kept time is one
 * not trusted for the sign-in last refreshed at `lastRefreshedAtMs` (A1 pass 3
 * L2): that one is replaced, so the set-back check keeps a time to check
 * against. Never throws.
 */
export async function noteLatestTimeSeen(
  ownerId: string,
  nowMs: number,
  lastRefreshedAtMs: number | null = null,
): Promise<void> {
  try {
    const latest = trustedTimeSeen(await readLatestTimeSeen(ownerId), lastRefreshedAtMs);
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
  refreshOptions: SavedSignInRefreshOptions = {},
): Promise<
  | WorkspaceOwnerAfterFailedLookup
  | Readonly<{ refused: OfflineSignInLookupRefusal; seenAtMs?: number }>
  | null
> {
  const refresh = await savedSignInRefreshWithin(timeoutMs, refreshOptions);
  if (refresh.status === 'signed_in') {
    return { ownerId: refresh.ownerId, signInPending: false };
  }
  // A1 pass 4 L2: a sign-in server answering 5xx is no refusal either (owner
  // answer Q13: the 7 days apply), but the lockout says the server, not "No
  // signal". The clock's refusal keeps its own words.
  const serverNotAnswering = refresh.status === 'server_unavailable';
  if (refresh.status !== 'network_unavailable' && !serverNotAnswering) return null;
  const [saved, workspaceOwnerId] = await Promise.all([
    readSavedSignIn(),
    workspaceOwnerOnThisPhone(),
  ]);
  const latestTimeSeenMs = workspaceOwnerId ? await readLatestTimeSeen(workspaceOwnerId) : null;
  const nowMs = now();
  const refused = offlineSignInGraceRefusalDetail({ saved, workspaceOwnerId, nowMs, latestTimeSeenMs });
  if (refused) {
    if (serverNotAnswering && refused.reason !== 'clock') return { refused: 'server_not_answering' };
    return refused.seenAtMs === undefined
      ? { refused: refused.reason }
      : { refused: refused.reason, seenAtMs: refused.seenAtMs };
  }
  if (!workspaceOwnerId || !saved) return { refused: serverNotAnswering ? 'server_not_answering' : 'unconfirmed' };
  await noteLatestTimeSeen(workspaceOwnerId, nowMs, saved.lastRefreshedAtMs);
  // The launch read's last refresh goes with the opening (A1 pass 3 L3).
  return { ownerId: workspaceOwnerId, signInPending: true, lastRefreshedAtMs: saved.lastRefreshedAtMs };
}

/**
 * Whole-app audit A1 pass 4 L3: the time this phone already saw that its
 * clock is now earlier than (beyond the drift allowance), or null. auth-js
 * uses a saved token that is valid by the phone's clock without asking the
 * server, so a clock set back into the token's last hour opened the
 * workspace fully signed in: no "offline, sign-in pending", no 7 days, and
 * the kept time unchecked (only the failed-lookup path checked it). Checked
 * as there: the token's last refresh, and a kept time trusted for it. A right
 * clock is never earlier than either (a time is kept only as seen here, and
 * a refresh the server answers clears it).
 */
export async function savedSignInClockSetBack(
  ownerId: string,
  now: () => number = Date.now,
): Promise<number | null> {
  const [saved, latestTimeSeenMs] = await Promise.all([
    // A sign-in that cannot be read leaves the kept time to decide.
    Promise.resolve().then(() => readSavedSignIn()).catch(() => null),
    readLatestTimeSeen(ownerId),
  ]);
  const lastRefreshedAtMs = saved?.ownerId === ownerId ? saved.lastRefreshedAtMs : null;
  return clockRefusal(now(), lastRefreshedAtMs, latestTimeSeenMs)?.seenAtMs ?? null;
}

/**
 * A1 pass 4 L3: with the clock set back, the saved sign-in is not opened on
 * the phone's word. A real refresh asks the server, whose time decides: it
 * answers, and the workspace opens as on any refreshed sign-in; it refuses,
 * and the phone is signed out (owner answer Q13); no answer (or the server
 * not answering), and the same clock lockout as with an expired token.
 */
export async function workspaceOwnerWithClockSetBack(
  seenAtMs: number,
  timeoutMs: number = OFFLINE_LOOKUP_TIMEOUT_MS,
  refreshOptions: SavedSignInRefreshOptions = {},
): Promise<
  | Readonly<{ ownerId: string | null; signInPending: false }>
  | Readonly<{ refused: 'clock'; seenAtMs: number }>
> {
  const refresh = await savedSignInRefreshWithin(timeoutMs, { ...refreshOptions, askServer: true });
  if (refresh.status === 'signed_in') return { ownerId: refresh.ownerId, signInPending: false };
  if (refresh.status === 'rejected' || refresh.status === 'signed_out') return { ownerId: null, signInPending: false };
  return { refused: 'clock', seenAtMs };
}

/**
 * The refresh's outcome, or no signal after `timeoutMs` (a captive portal).
 * A1 pass 3 L1: once signal is back the sign-in is waited for, not cut at
 * `timeoutMs`; and once this has answered, signal found later is not
 * announced (the lookup has already decided).
 */
async function savedSignInRefreshWithin(
  timeoutMs: number,
  options: SavedSignInRefreshOptions,
): Promise<SavedSignInRefresh> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answered = false;
  const stillWanted = () => !answered && (options.stillWanted?.() ?? true);
  // Set before the refresh is asked, so signal found at once still cancels it.
  const timedOut = new Promise<SavedSignInRefresh>(resolve => {
    timer = setTimeout(() => resolve({ status: 'network_unavailable' }), timeoutMs);
  });
  try {
    return await Promise.race([
      awaitSavedSignInRefresh({
        ...options,
        stillWanted,
        onSignalBack: () => {
          if (!stillWanted()) return;
          clearTimeout(timer);
          options.onSignalBack?.();
        },
      }),
      timedOut,
    ]);
  } finally {
    answered = true;
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether the workspace open offline for `ownerId` is still within the 7 days.
 * A saved sign-in that cannot be read is not a sign-out (the Keychain can
 * refuse a read for a moment, as while the phone is locked): the last good
 * read decides, and with none the answer is unknown (null), asked again at
 * the next check. Before, a read error closed the workspace with "Your
 * sign-in has not refreshed for 7 days" (whole-app audit A2 pass 2 L1). The
 * launch check stays strict: a read error there opens nothing, with Retry.
 */
export async function offlineSignInGraceStillAllows(
  ownerId: string,
  now: () => number = () => Date.now(),
  lastRead: { saved?: SavedSignIn | null } = {},
): Promise<boolean | null> {
  const saved = await savedSignInOrLastGoodRead(lastRead);
  if (saved === undefined) return null;
  return offlineSignInGraceAllows({ saved, workspaceOwnerId: ownerId, nowMs: now() });
}

/** The saved sign-in; if it cannot be read, the last good read; undefined with none. */
async function savedSignInOrLastGoodRead(
  lastRead: { saved?: SavedSignIn | null },
): Promise<SavedSignIn | null | undefined> {
  try {
    lastRead.saved = await readSavedSignIn();
  } catch {
    // Kept as it was: the last good read, or none.
  }
  return lastRead.saved;
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
 * once, with the reason, and for a clock refusal the time seen (A1 pass 3
 * L2/L4). Returns the function that stops watching.
 */
export function watchOfflineSignInGrace({
  ownerId,
  lastRefreshedAtMs,
  onExpired,
  now = () => Date.now(),
  recheckMs = OFFLINE_SIGN_IN_GRACE_RECHECK_MS,
  appState = AppState as unknown as AppStateLike,
}: Readonly<{
  ownerId: string;
  /** When the saved sign-in the launch check read last refreshed (A1 pass 3 L3). */
  lastRefreshedAtMs?: number;
  onExpired: (reason: OfflineSignInRefusal, seenAtMs?: number) => void;
  now?: () => number;
  recheckMs?: number;
  appState?: AppStateLike;
}>): () => void {
  let watching = true;
  const lastRead: { saved?: SavedSignIn | null } = {};
  const launchLastRefreshMs = typeof lastRefreshedAtMs === 'number' && Number.isFinite(lastRefreshedAtMs)
    ? lastRefreshedAtMs
    : null;
  // However long reads keep failing, not beyond 7 days from the last refresh
  // the launch check read, nor from opening. Before, only from opening: a
  // sign-in six days old when opened stayed open six more days unread
  // (A1 pass 3 L3).
  const openedAtMs = now();
  const latestExpiryMs = Math.min(openedAtMs, launchLastRefreshMs ?? openedAtMs) + OFFLINE_SIGN_IN_GRACE_MS;
  const check = () => {
    void savedSignInOrLastGoodRead(lastRead).then(async saved => {
      const nowMs = now();
      const latestTimeSeenMs = await readLatestTimeSeen(ownerId);
      // Decided as at launch, with its reason: a sign-in gone from the
      // Keychain or switched is not "7 days" (A1 pass 3 L4), and a clock set
      // back behind a time already seen refuses (A1 pass 2 #5). With no read
      // at all, unknown is not expired until the latest expiry (A2 pass 2 L1).
      const refused = saved !== undefined
        ? offlineSignInGraceRefusalDetail({ saved, workspaceOwnerId: ownerId, nowMs, latestTimeSeenMs })
        : clockRefusal(nowMs, launchLastRefreshMs, latestTimeSeenMs) ??
          (nowMs <= latestExpiryMs ? null : { reason: 'expired' as const });
      if (!watching) return;
      if (!refused) {
        if (saved) await noteLatestTimeSeen(ownerId, nowMs, saved.lastRefreshedAtMs);
        return;
      }
      stop();
      if (refused.seenAtMs === undefined) onExpired(refused.reason);
      else onExpired(refused.reason, refused.seenAtMs);
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
