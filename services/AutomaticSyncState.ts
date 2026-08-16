import {
  reportBackgroundTaskFailure,
  startGuardedBackgroundTask,
} from './BackgroundTaskGuard';

type AutomaticSyncRecord = Readonly<{
  id: string;
  status?: unknown;
  syncDiagnostics?: Record<string, unknown> | null;
  workflowTimestamps?: Record<string, unknown> | null;
}>;

/**
 * Suppresses persistence when an automatic retry only changed volatile
 * attempt bookkeeping. New actionable failure details and successful state
 * transitions still persist immediately.
 */
export function shouldPersistAutomaticSyncOutcome(
  current: AutomaticSyncRecord,
  next: AutomaticSyncRecord,
): boolean {
  return automaticSyncPersistenceFingerprint(current) !==
    automaticSyncPersistenceFingerprint(next);
}

export function startAutomaticSyncBackgroundTask(
  trigger: string,
  task: () => Promise<void>,
): void {
  startGuardedBackgroundTask({
    key: 'field-update-automatic-sync',
    label: 'Automatic field update sync',
    trigger,
    maxConsecutiveRuns: 2,
    task,
  });
}

/** A rejected item stays unchanged/retryable and cannot abort later items. */
export async function runAutomaticSyncQueue<T>(
  items: readonly T[],
  runItem: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    try {
      await runItem(item);
    } catch (error) {
      reportBackgroundTaskFailure({
        key: 'field-update-automatic-sync-item',
        label: 'Automatic field update sync',
        trigger: 'queued_update',
        error,
      });
    }
  }
}

function automaticSyncPersistenceFingerprint(
  update: AutomaticSyncRecord,
): string {
  const diagnostics = update.syncDiagnostics || {};
  const {
    lastSyncAttemptAt: _lastSyncAttemptAt,
    retryAttemptNumber: _retryAttemptNumber,
    queuedUpdateCount: _queuedUpdateCount,
    ...durableDiagnostics
  } = diagnostics;

  return stableStringify({
    status: update.status,
    syncDiagnostics: durableDiagnostics,
    sendResolvedAt: update.workflowTimestamps?.sendResolvedAt || null,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
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
