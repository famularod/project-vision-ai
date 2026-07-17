export type PersistedFieldUpdateStatus =
  | 'draft'
  | 'ready_to_send'
  | 'queued'
  | 'sent'
  | 'failed';

export type FieldUpdateLifecycleState =
  | 'draft'
  | 'ready_to_sync'
  | 'waiting_to_sync'
  | 'cloud_synced'
  | 'sync_failed';

/**
 * `sent` is a legacy persistence token used by existing device and cloud data.
 * It means the cloud write was acknowledged; it never proves an email or text
 * was delivered.
 */
export function fieldUpdateLifecycleState(
  status: PersistedFieldUpdateStatus,
): FieldUpdateLifecycleState {
  if (status === 'ready_to_send') return 'ready_to_sync';
  if (status === 'queued') return 'waiting_to_sync';
  if (status === 'sent') return 'cloud_synced';
  if (status === 'failed') return 'sync_failed';
  return 'draft';
}

export function fieldUpdateLifecycleLabel(
  status: PersistedFieldUpdateStatus,
) {
  const state = fieldUpdateLifecycleState(status);
  if (state === 'ready_to_sync') return 'Ready to Sync';
  if (state === 'waiting_to_sync') return 'Waiting to Sync';
  if (state === 'cloud_synced') return 'Cloud Synced';
  if (state === 'sync_failed') return 'Sync Failed';
  return 'Draft';
}

export function persistedStatusForSyncResult(input: {
  result: 'success' | 'failed' | 'skipped' | null;
  failureCategory: string | null;
}): PersistedFieldUpdateStatus {
  // Keep the legacy token so existing builds, AsyncStorage records, queue
  // payloads, and cloud rows remain compatible.
  if (input.result === 'success') return 'sent';
  if (input.failureCategory === 'offline') return 'queued';
  return 'failed';
}
