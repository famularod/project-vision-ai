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
  });
}

/**
 * Whether two copies of an update are the same generation. A photo's cloud
 * storage path never counts here: only staging writes the queued copy's
 * path (derived, or the legacy path found at upload), and the phone's copy
 * carries one only from an earlier cloud merge, so a path difference is
 * never a user edit (audit A4 pass 4: comparing paths when both were
 * present broke the guard for a relocation found at upload). The cloud
 * receipt compares paths when both copies carry one; see
 * PhotoStoragePathAlignment.
 */
export function sameFieldUpdateSyncGeneration(
  left: FieldUpdateSyncGenerationRecord,
  right: FieldUpdateSyncGenerationRecord,
): boolean {
  return fieldUpdateSyncGeneration(withoutPhotoStoragePaths(left)) ===
    fieldUpdateSyncGeneration(withoutPhotoStoragePaths(right));
}

function withoutPhotoStoragePaths<T extends FieldUpdateSyncGenerationRecord>(update: T): T {
  if (!Array.isArray(update.photos)) return update;
  return {
    ...update,
    photos: update.photos.map(photo => {
      if (!photo || typeof photo !== 'object') return photo;
      const { cloudStoragePath: _path, ...rest } = photo as Record<string, unknown>;
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? 'null' : stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
