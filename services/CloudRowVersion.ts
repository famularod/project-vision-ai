/**
 * Independent review pass 2 (item 1): which version of a cloud row a record
 * read from the cloud is.
 *
 * Every write of a task or a GPS area row, from the phone, the iPad or the
 * desktop, sets the row's `updated_at`. That value, exactly as the cloud
 * returned it, is the row's version: a write can then be made only if the row
 * is still that version (`... where updated_at = <as read>`, as the desktop
 * already writes tasks), so a copy weighed against a row another device has
 * changed since is never written over that change.
 *
 * The version is kept beside the record, not in it: a record is compared and
 * saved as the JSON the cloud holds, and nothing may be added to that.
 */
const versions = new WeakMap<object, string>();

/** Notes the version of the cloud row this record was read from, or written as. Returns the record. */
export function withCloudRowVersion<T>(record: T, updatedAt: unknown): T {
  if (record && typeof record === 'object' && typeof updatedAt === 'string' && updatedAt.trim()) {
    versions.set(record as object, updatedAt);
  }
  return record;
}

/** The version of the cloud row this record was read from; null when it is not known (the row is then written as before). */
export function cloudRowVersionOf(record: unknown): string | null {
  return record && typeof record === 'object' ? versions.get(record as object) ?? null : null;
}

/**
 * The code of a write made only if the cloud's row was still the version it
 * was weighed against, when it was not: nothing was written.
 */
export const CLOUD_ROW_CHANGED_SINCE_READ = 'cloud_row_changed_since_read';
