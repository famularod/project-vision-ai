type FieldUpdateSyncGenerationRecord = {
  id: string;
  status?: unknown;
  syncDiagnostics?: unknown;
  deleteDiagnostics?: unknown;
  workflowTimestamps?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type FieldUpdateSyncReconciliation<T> = {
  updates: T[];
  applied: boolean;
  current: T | null;
};

/**
 * Identifies the exact user-authored/evidence generation that a sync attempt
 * started with. Transport-only state is intentionally excluded so a status
 * stamp cannot make its own result stale. Any user edit, retry generation,
 * archive action, photo repair, or evidence change produces a new signature.
 */
export function fieldUpdateSyncGeneration(
  update: FieldUpdateSyncGenerationRecord,
): string {
  return generationSignature(update, false);
}

function generationSignature(
  update: FieldUpdateSyncGenerationRecord,
  nullIsMissing: boolean,
): string {
  const {
    status: _status,
    syncDiagnostics: _syncDiagnostics,
    deleteDiagnostics: _deleteDiagnostics,
    workflowTimestamps,
    ...content
  } = update;
  const {
    sendResolvedAt: _sendResolvedAt,
    ...contentWorkflowTimestamps
  } = workflowTimestamps || {};

  return stableStringify({
    ...content,
    workflowTimestamps: Object.keys(contentWorkflowTimestamps).length > 0
      ? contentWorkflowTimestamps
      : undefined,
  }, nullIsMissing);
}

/**
 * Whether two copies of an update are the same generation. A photo's cloud
 * storage path never counts here: only staging writes the queued copy's
 * path (derived, or the legacy path found at upload), and the phone's copy
 * carries one only from an earlier cloud merge, so a path difference is
 * never a user edit (audit A4 pass 4: comparing paths when both were
 * present broke the guard for a relocation found at upload). The cloud
 * receipt compares paths when both copies carry one; see
 * PhotoStoragePathAlignment. The same holds for the photo's other cloud
 * recovery fields, and a field stored as null reads as a missing one: a
 * relaunch writes those fields as null on the phone's copy while the queued
 * copy has none, which read as a new generation and let the sign-in refresh
 * replace a resumed edit (audit A4 pass 5). Nor does the photo's local file
 * path count, as in the cloud receipt: an app update moves the app's folder,
 * the phone's copy is read back under the new path while the queued copy
 * keeps the old one, and the refresh put the older cloud copy over the
 * pending edit (whole-app audit A7 pass 4 #2 (30 Sep 2026)).
 */
export function sameFieldUpdateSyncGeneration(
  left: FieldUpdateSyncGenerationRecord,
  right: FieldUpdateSyncGenerationRecord,
): boolean {
  return generationSignature(withoutPhotoTransportFields(left), true) ===
    generationSignature(withoutPhotoTransportFields(right), true);
}

const PHOTO_TRANSPORT_FIELDS = [
  'uri',
  'cloudStoragePath',
  'cloudRecoveredAt',
  'cloudRecoveryStatus',
  'cloudSignedUrlExpiresAt',
  'cloudPreviewUri',
  'cloudPreviewSignedUrlExpiresAt',
] as const;

function withoutPhotoTransportFields<T extends FieldUpdateSyncGenerationRecord>(update: T): T {
  if (!Array.isArray(update.photos)) return update;
  return {
    ...update,
    photos: update.photos.map(photo => {
      if (!photo || typeof photo !== 'object') return photo;
      const rest = { ...(photo as Record<string, unknown>) };
      PHOTO_TRANSPORT_FIELDS.forEach(field => {
        delete rest[field];
      });
      return rest;
    }),
  };
}

/**
 * Applies an asynchronous sync result only while the saved record is still
 * the same generation. A deleted record is never recreated, and an older
 * request can never overwrite a newer edit or retry.
 */
export function reconcileFieldUpdateSyncResult<
  T extends FieldUpdateSyncGenerationRecord,
>(
  currentUpdates: readonly T[],
  attemptedUpdate: T,
  syncResult: T,
): FieldUpdateSyncReconciliation<T> {
  const currentIndex = currentUpdates.findIndex(item => item.id === attemptedUpdate.id);
  if (currentIndex < 0) {
    return { updates: [...currentUpdates], applied: false, current: null };
  }

  const current = currentUpdates[currentIndex];
  if (!sameFieldUpdateSyncGeneration(current, attemptedUpdate)) {
    return { updates: [...currentUpdates], applied: false, current };
  }

  const updates = [...currentUpdates];
  updates[currentIndex] = syncResult;
  return { updates, applied: true, current: syncResult };
}

function stableStringify(value: unknown, nullIsMissing = false): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? 'null' : stableStringify(item, nullIsMissing)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter(key => record[key] !== undefined && !(nullIsMissing && record[key] === null))
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key], nullIsMissing)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
