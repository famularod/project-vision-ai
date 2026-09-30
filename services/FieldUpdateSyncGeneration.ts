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
    // The storage path is transport: staging stamps it on the queued copy
    // only, and the path is derived from the ids, so it is not a new
    // generation (whole-app audit A4/A7, 30 Sep 2026: the queued copy never
    // matched the local record, so a refresh could replace an unsynced edit
    // and the 'sent' stamp was refused).
    photos: Array.isArray(content.photos)
      ? content.photos.map(photo => {
          if (!photo || typeof photo !== 'object') return photo;
          const { cloudStoragePath: _cloudStoragePath, ...rest } = photo as Record<string, unknown>;
          return rest;
        })
      : content.photos,
    workflowTimestamps: Object.keys(contentWorkflowTimestamps).length > 0
      ? contentWorkflowTimestamps
      : undefined,
  });
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
  if (
    fieldUpdateSyncGeneration(current) !==
    fieldUpdateSyncGeneration(attemptedUpdate)
  ) {
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
