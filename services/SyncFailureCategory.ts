/**
 * Why a field update's cloud sync failed, as a category the app acts on:
 * 'offline', 'signed_out' and 'auth' are retried automatically; the rest
 * wait for the manager.
 *
 * Whole-app audit A4 (29 Sep 2026): the category was read from the queue
 * item's sanitised, user-facing sentence ("Cloud sync could not connect…"),
 * which the classifier did not recognise, so an offline save of an update
 * with no photo step read "Sync failed · Retry" and was left out of the
 * automatic retry. The queue now records the category from the raw failure
 * before the sentence is written, and the sanitised sentences themselves
 * are recognised for older queue items. A transport failure anywhere in the
 * chain ("Network request failed" inside a database-step message) is
 * offline.
 */
export type SyncFailureCategory =
  | 'rls_denied'
  | 'signed_out'
  | 'auth'
  | 'malformed_payload'
  | 'database_insert_failed'
  | 'storage_upload_failed'
  | 'offline'
  | 'unknown';

/** The sentences sanitizeUserFacingSyncMessage writes, mapped back to their meaning. */
const SANITIZED_SENTENCES: ReadonlyArray<readonly [RegExp, SyncFailureCategory]> = [
  [/cloud sync could not connect/, 'offline'],
  [/cloud sync needs you to sign in again/, 'auth'],
  [/original files are no longer available/, 'storage_upload_failed'],
  [/cloud sync needs service attention/, 'database_insert_failed'],
];

/** Unambiguous transport failures, wherever they appear in a message. */
const TRANSPORT_FAILURE =
  /network request failed|failed to fetch|fetch failed|load failed|timed out|timeout|econn|enotfound|internet connection|appears to be offline|\boffline\b|socket|unreachable/;

export function classifySyncFailureText(errors: readonly string[]): SyncFailureCategory {
  const message = errors.join(' ').toLowerCase();

  if (!message.trim()) return 'unknown';
  for (const [pattern, category] of SANITIZED_SENTENCES) {
    if (pattern.test(message)) return category;
  }
  if (TRANSPORT_FAILURE.test(message)) return 'offline';
  // Highest-confidence, most specific signals are checked first so a message
  // that happens to also mention "network" or "fetch" (common in wrapped
  // fetch/auth errors) is never misclassified as offline. Generic
  // offline/network wording is checked last, only once nothing more
  // specific has matched.
  if (/row level|rls|policy|permission denied|42501|violates row-level/.test(message)) return 'rls_denied';
  if (/signed out|sign in|no user|session unavailable|storage_unavailable/.test(message)) return 'signed_out';
  if (/auth|jwt|token|unauthorized|forbidden|401|403/.test(message)) return 'auth';
  if (/malformed|invalid|schema|column|not null|constraint|payload/.test(message)) return 'malformed_payload';
  if (/database|insert|upsert|postgres|postgrest|supabase/.test(message)) return 'database_insert_failed';
  if (/photo|storage|bucket|object|upload/.test(message)) return 'storage_upload_failed';
  if (/network|connection|fetch|internet/.test(message)) return 'offline';
  return 'unknown';
}

export function isSyncFailureCategory(value: unknown): value is SyncFailureCategory {
  return value === 'rls_denied' || value === 'signed_out' || value === 'auth' || value === 'malformed_payload' ||
    value === 'database_insert_failed' || value === 'storage_upload_failed' || value === 'offline' || value === 'unknown';
}
