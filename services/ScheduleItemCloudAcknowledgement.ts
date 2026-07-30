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
