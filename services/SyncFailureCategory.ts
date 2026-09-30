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
  | 'current_drawing_protected'
  | 'unknown';

/**
 * The cloud refuses a write that would change a Current drawing's current
 * flag, category, drawing family or projects outside its Make Current
 * transaction (ecos_atomic_current_activation_required). The raw code was
 * shown, classified unknown and retried forever. It is permanent: the item
 * is held with this sentence until the owner edits the document again
 * (whole-app audit A8 pass 1 F3 (30 Sep 2026)).
 */
export const CURRENT_DRAWING_PROTECTED_SYNC_MESSAGE =
  'This drawing is Current for ECOS, so the cloud kept its shared record. Make another revision current first, then edit this one again.';
const CURRENT_DRAWING_PROTECTED = /ecos_atomic_current_activation_required|this drawing is current for ecos, so the cloud kept its shared record/;

/**
 * The same refusal when what changed is the drawing's list of projects,
 * most often a project deleted on this phone that the drawing was shared
 * with. The owner had not edited the drawing, and was told to edit it
 * again (whole-app audit A8 pass 3 L2).
 */
export function currentDrawingProjectsKeptMessage(projectNames: readonly string[]): string {
  const kept = projectNames.length > 0 ? ` (${projectNames.join(', ')})` : '';
  return `This drawing is Current for ECOS, so the cloud kept its shared record and its projects${kept}. Its projects change only once another revision is current: make one current first, then edit this drawing again.`;
}

/** The sentences sanitizeUserFacingSyncMessage writes, mapped back to their meaning. */
const SANITIZED_SENTENCES: ReadonlyArray<readonly [RegExp, SyncFailureCategory]> = [
  [/cloud sync could not connect/, 'offline'],
  [/cloud sync needs you to sign in again/, 'auth'],
  [/original files are no longer available/, 'storage_upload_failed'],
  [/cloud sync needs service attention/, 'database_insert_failed'],
];

/** Unambiguous transport failures, wherever they appear in a message. */
const TRANSPORT_FAILURE =
  /network request failed|failed to fetch|fetch failed|load failed|econn|enotfound|internet connection|appears to be offline|\boffline\b|unreachable/;

export function classifySyncFailureText(errors: readonly string[]): SyncFailureCategory {
  const message = errors.join(' ').toLowerCase();

  if (!message.trim()) return 'unknown';
  if (CURRENT_DRAWING_PROTECTED.test(message)) return 'current_drawing_protected';
  for (const [pattern, category] of SANITIZED_SENTENCES) {
    if (pattern.test(message)) return category;
  }
  // Access and sign-in failures first, whatever else the message says; then
  // an unambiguous transport failure anywhere in it (a statement timeout is
  // not one: 'timed out' alone stays with the step that reported it); then
  // the step words; generic network wording last.
  if (/row level|rls|policy|permission denied|42501|violates row-level/.test(message)) return 'rls_denied';
  if (/signed out|sign in|no user|session unavailable|storage_unavailable/.test(message)) return 'signed_out';
  if (/auth|jwt|token|unauthorized|forbidden|401|403/.test(message)) return 'auth';
  if (TRANSPORT_FAILURE.test(message)) return 'offline';
  if (/malformed|invalid|schema|column|not null|constraint|payload/.test(message)) return 'malformed_payload';
  if (/database|insert|upsert|postgres|postgrest|supabase/.test(message)) return 'database_insert_failed';
  if (/photo|storage|bucket|object|upload/.test(message)) return 'storage_upload_failed';
  if (/network|connection|fetch|internet/.test(message)) return 'offline';
  return 'unknown';
}

export function isSyncFailureCategory(value: unknown): value is SyncFailureCategory {
  return value === 'rls_denied' || value === 'signed_out' || value === 'auth' || value === 'malformed_payload' ||
    value === 'database_insert_failed' || value === 'storage_upload_failed' || value === 'offline' ||
    value === 'current_drawing_protected' || value === 'unknown';
}
