type IdentifiedProjectUpdate = Readonly<{ id: string }>;

type CloudProjectUpdateReceipt<TUpdate extends IdentifiedProjectUpdate> = Readonly<{
  id: string;
  updateData: TUpdate;
}>;

const RECEIPT_ONLY_KEYS = new Set([
  'status',
  'syncDiagnostics',
  'sendAttempts',
  'lastSendAttemptAt',
  'stableSendId',
  'idempotencyKey',
  'deleteDiagnostics',
]);

const DEVICE_PHOTO_TRANSPORT_KEYS = new Set([
  'uri',
  'cloudPreviewUri',
  'cloudRecoveredAt',
  'cloudRecoveryStatus',
  'cloudSignedUrlExpiresAt',
  'cloudPreviewSignedUrlExpiresAt',
]);

/**
 * Compares the shared meaning of two field updates while excluding lifecycle
 * receipts and device-local photo transport. A signed URL, cache file, retry
 * counter, or send timestamp may differ across devices without representing a
 * competing field edit.
 */
export function daveProjectUpdatesSemanticallyMatch(
  left: unknown,
  right: unknown,
): boolean {
  return stableStringify(normalizeProjectUpdateMeaning(left)) ===
    stableStringify(normalizeProjectUpdateMeaning(right));
}

/**
 * A cloud receipt may add the immutable project id to a legacy device record
 * that was originally saved before project-id binding existed. That one-way
 * enrichment is not a competing field edit. Two different concrete project
 * ids still never match.
 */
export function daveProjectUpdateMatchesCloudReceipt(
  local: unknown,
  cloud: unknown,
): boolean {
  if (daveProjectUpdatesSemanticallyMatch(local, cloud)) return true;
  if (!isRecord(local) || !isRecord(cloud)) return false;

  const localProjectId = normalizedOptionalString(local.projectId);
  const cloudProjectId = normalizedOptionalString(cloud.projectId);
  if (localProjectId || !cloudProjectId) return false;

  return daveProjectUpdatesSemanticallyMatch(
    { ...local, projectId: cloudProjectId },
    cloud,
  );
}

/**
 * Full sync should stage only records that are absent from cloud or whose
 * shared meaning actually differs. Re-staging every historical update creates
 * false conflicts and makes the pending counter grow after a successful sync.
 */
export function daveProjectUpdatesNeedingCloudUpload<
  TUpdate extends IdentifiedProjectUpdate,
>({
  local,
  cloud,
}: Readonly<{
  local: readonly TUpdate[];
  cloud: readonly CloudProjectUpdateReceipt<TUpdate>[];
}>): TUpdate[] {
  const cloudById = new Map(cloud.map(receipt => [receipt.id, receipt.updateData]));
  return local.filter(update => {
    const cloudUpdate = cloudById.get(update.id);
    return !cloudUpdate || !daveProjectUpdateMatchesCloudReceipt(update, cloudUpdate);
  });
}

function normalizeProjectUpdateMeaning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeProjectUpdateMeaning);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (RECEIPT_ONLY_KEYS.has(key) || DEVICE_PHOTO_TRANSPORT_KEYS.has(key)) continue;

    if (key === 'workflowTimestamps' && isRecord(value[key])) {
      const timestamps = { ...value[key] };
      delete timestamps.sendResolvedAt;
      normalized[key] = normalizeProjectUpdateMeaning(timestamps);
      continue;
    }

    normalized[key] = normalizeProjectUpdateMeaning(value[key]);
  }
  return normalized;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? 'null' : stableStringify(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
