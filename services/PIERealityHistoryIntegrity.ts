export type PIERealityHistoryCloudRow = Readonly<{
  id: string;
  organization_id: string;
  project_id: string;
  object_id: string;
  occurred_at: string;
  event_type: string;
  summary: string;
  previous_status: string | null;
  next_status: string;
}>;

export type PIERealityHistoryVerification = Readonly<{
  ok: boolean;
  missingIds: readonly string[];
  conflictingIds: readonly string[];
  error: string | null;
}>;

export function verifyPIERealityHistoryRows(
  expectedRows: readonly PIERealityHistoryCloudRow[],
  cloudRows: readonly unknown[],
): PIERealityHistoryVerification {
  const expected = indexRows(expectedRows);
  const actual = indexRows(cloudRows);
  const missingIds: string[] = [];
  const conflictingIds: string[] = [];

  for (const [id, expectedRow] of expected.rows) {
    const cloudRow = actual.rows.get(id);
    if (!cloudRow) {
      missingIds.push(id);
    } else if (stableStringify(expectedRow) !== stableStringify(cloudRow)) {
      conflictingIds.push(id);
    }
  }
  conflictingIds.push(...expected.conflictingIds, ...actual.conflictingIds);

  const uniqueMissing = sortedUnique(missingIds);
  const uniqueConflicting = sortedUnique(conflictingIds);
  const parts = [
    uniqueMissing.length > 0 ? `missing IDs: ${uniqueMissing.join(', ')}` : '',
    uniqueConflicting.length > 0 ? `conflicting IDs: ${uniqueConflicting.join(', ')}` : '',
  ].filter(Boolean);

  return {
    ok: parts.length === 0,
    missingIds: uniqueMissing,
    conflictingIds: uniqueConflicting,
    error: parts.length > 0
      ? `Reality history immutable verification failed (${parts.join('; ')}).`
      : null,
  };
}

function indexRows(rows: readonly unknown[]) {
  const indexed = new Map<string, PIERealityHistoryCloudRow>();
  const conflictingIds: string[] = [];
  for (const value of rows) {
    const row = normalizeRow(value);
    if (!row.id) continue;
    const prior = indexed.get(row.id);
    if (prior && stableStringify(prior) !== stableStringify(row)) {
      conflictingIds.push(row.id);
    } else {
      indexed.set(row.id, row);
    }
  }
  return { rows: indexed, conflictingIds };
}

function normalizeRow(value: unknown): PIERealityHistoryCloudRow {
  const row = isRecord(value) ? value : {};
  return {
    id: text(row.id),
    organization_id: text(row.organization_id),
    project_id: text(row.project_id),
    object_id: text(row.object_id),
    occurred_at: normalizedTimestamp(row.occurred_at),
    event_type: text(row.event_type),
    summary: text(row.summary),
    previous_status: nullableText(row.previous_status),
    next_status: text(row.next_status),
  };
}

function normalizedTimestamp(value: unknown) {
  const raw = text(value);
  const milliseconds = new Date(raw).getTime();
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : raw;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function nullableText(value: unknown) {
  const valueText = text(value).trim();
  return valueText || null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sortedUnique(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
