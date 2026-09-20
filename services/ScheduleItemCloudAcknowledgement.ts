import type { ScheduleItem } from '../types';

/**
 * A queue item is complete only after Supabase returns the exact schedule-item
 * revision that was written. A successful HTTP response without a matching
 * row is not sufficient because RLS or a stale write can otherwise look like
 * a cross-device save.
 */
export function scheduleItemCloudAcknowledgementMatches(
  expected: ScheduleItem,
  row: unknown,
): boolean {
  if (!row || typeof row !== 'object') return false;
  const record = row as Record<string, unknown>;
  if (record.id !== expected.id) return false;
  return canonicalJson(record.item_data) === canonicalJson(expected);
}

/**
 * Supabase normally returns the written JSONB row from the upsert. If that
 * immediate representation does not match, one authoritative read separates a
 * transient/normalized response from a genuinely stale persisted revision.
 */
export async function confirmScheduleItemCloudAcknowledgement(
  expected: ScheduleItem,
  immediateRow: unknown,
  readPersistedRow: () => Promise<unknown>,
): Promise<boolean> {
  if (scheduleItemCloudAcknowledgementMatches(expected, immediateRow)) {
    return true;
  }

  return scheduleItemCloudAcknowledgementMatches(
    expected,
    await readPersistedRow(),
  );
}

/**
 * Name the fields that disagree, so an acknowledgement failure is actionable.
 *
 * Without this the field sees only "the cloud did not confirm the exact saved
 * task revision", which is true of a stale row, a dropped field and a value
 * that does not survive the round trip alike — and every one of them returns
 * the identical count on every sync with nothing to act on.
 *
 * Field NAMES only. Values are project data and are never included.
 */
export function describeScheduleItemAcknowledgementMismatch(
  expected: ScheduleItem,
  row: unknown,
): string {
  if (!row || typeof row !== 'object') return 'the cloud returned no row';
  const record = row as Record<string, unknown>;
  if (record.id !== expected.id) return 'the cloud returned a different record id';

  const stored = canonicalValue(record.item_data);
  const sent = canonicalValue(expected);
  if (!stored || typeof stored !== 'object') return 'the stored record is not an object';

  const storedRecord = stored as Record<string, unknown>;
  const sentRecord = sent as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(storedRecord), ...Object.keys(sentRecord)])].sort();

  const missing: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  for (const key of keys) {
    const inStored = key in storedRecord;
    const inSent = key in sentRecord;
    if (inSent && !inStored) missing.push(key);
    else if (inStored && !inSent) added.push(key);
    else if (JSON.stringify(storedRecord[key]) !== JSON.stringify(sentRecord[key])) changed.push(key);
  }

  const parts: string[] = [];
  if (missing.length) parts.push(`dropped by the cloud: ${missing.join(', ')}`);
  if (added.length) parts.push(`only in the cloud copy: ${added.join(', ')}`);
  if (changed.length) parts.push(`different value: ${changed.join(', ')}`);
  return parts.length ? parts.join('; ') : 'the records match field by field but not as a whole';
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => canonicalValue(entry));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalValue(entry);
      return result;
    }, {});
}
