import type { FieldUpdateSyncFailureCategory } from './FieldUpdateSyncDiagnosticsRecord';
import {
  readSavedSignIn,
  type SavedSignIn,
  type SupabaseSessionTokenLookupResult,
} from './SupabaseService';

/**
 * Why a field update could not start its upload for want of a session
 * (whole-app audit A4 pass 7 M1, 30 Sep 2026). Opened with no signal on a
 * saved sign-in whose hourly token had expired (owner answer Q13), the
 * session lookup answers "still loading" and then "unknown", never "signed
 * out", and every update he saved was stamped "Sync Failed · Session expired
 * · Sign in again", which invited a sign-out he could not undo without
 * signal. While the sign-in waits for signal (the workspace is marked
 * "offline, sign-in pending", or the lookup is unsettled while a sign-in is
 * saved on this phone) the update waits as any offline update does.
 */
export async function fieldUpdateSyncCategoryWithoutSession(
  lookup: Pick<SupabaseSessionTokenLookupResult, 'missingReason'> | null | undefined,
  signInPending: boolean,
  savedSignIn: () => Promise<SavedSignIn | null> = readSavedSignIn,
): Promise<Extract<FieldUpdateSyncFailureCategory, 'signed_out' | 'auth' | 'offline'>> {
  const reason = lookup?.missingReason ?? null;
  if (reason === 'signed_out') return 'signed_out';
  const unsettled = reason === null || reason === 'unknown' || reason === 'auth_loading';
  if (!signInPending && !unsettled) return 'auth';
  // A refused refresh has already removed the saved sign-in (auth-js does so
  // before the lookup returns), so only that still reads "Session expired".
  return (await savedSignIn().catch(() => null)) ? 'offline' : 'auth';
}
