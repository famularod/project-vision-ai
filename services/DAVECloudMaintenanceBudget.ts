import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  processDAVEStorageCleanup,
  type DAVEStorageCleanupResult,
} from './DAVEStorageCleanup';
import { purgeExpiredDAVEDeletionAudit } from './SupabaseService';

export const DAVE_CLOUD_MAINTENANCE_STORAGE_KEY =
  '@dave/cloud-maintenance-budget/v1';
export const DAVE_STORAGE_CLEANUP_INTERVAL_MS = 60 * 60_000;
export const DAVE_DELETION_AUDIT_INTERVAL_MS = 24 * 60 * 60_000;

type DAVECloudMaintenanceState = Readonly<{
  storageCleanupAttemptedAt: number | null;
  deletionAuditAttemptedAt: number | null;
}>;

type DAVECloudMaintenanceStorage = Pick<
  typeof AsyncStorage,
  'getItem' | 'setItem'
>;

export type DAVECloudMaintenanceResult = Readonly<{
  storageCleanupRan: boolean;
  storageCleanupCompleted: number;
  storageCleanupRemaining: number;
  storageCleanupErrors: readonly string[];
  deletionAuditRan: boolean;
}>;

export type DAVECloudMaintenanceScheduler = Readonly<{
  run: (options?: Readonly<{
    forceStorageCleanup?: boolean;
  }>) => Promise<DAVECloudMaintenanceResult>;
}>;

type DAVECloudMaintenanceDependencies = Readonly<{
  storage: DAVECloudMaintenanceStorage;
  now: () => number;
  processStorageCleanup: () => Promise<DAVEStorageCleanupResult>;
  purgeDeletionAudit: () => Promise<unknown>;
}>;

const EMPTY_STATE: DAVECloudMaintenanceState = Object.freeze({
  storageCleanupAttemptedAt: null,
  deletionAuditAttemptedAt: null,
});

/**
 * Bounds best-effort cleanup traffic independently from upload retries.
 * Attempts are persisted before the network work starts so a failing service
 * cannot turn a background retry loop into another Supabase request storm.
 */
export function createDAVECloudMaintenanceScheduler(
  dependencies: DAVECloudMaintenanceDependencies,
): DAVECloudMaintenanceScheduler {
  let cachedState: DAVECloudMaintenanceState | null = null;
  let inFlight: Promise<DAVECloudMaintenanceResult> | null = null;

  async function run(
    options: Readonly<{ forceStorageCleanup?: boolean }> = {},
  ): Promise<DAVECloudMaintenanceResult> {
    if (inFlight) return inFlight;
    const task = perform(options);
    inFlight = task;
    try {
      return await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  }

  async function perform({
    forceStorageCleanup = false,
  }: Readonly<{ forceStorageCleanup?: boolean }>): Promise<DAVECloudMaintenanceResult> {
    const now = dependencies.now();
    const state = cachedState ?? await loadState(dependencies.storage);
    cachedState = state;

    const storageCleanupDue = forceStorageCleanup || isDue(
      state.storageCleanupAttemptedAt,
      DAVE_STORAGE_CLEANUP_INTERVAL_MS,
      now,
    );
    const deletionAuditDue = isDue(
      state.deletionAuditAttemptedAt,
      DAVE_DELETION_AUDIT_INTERVAL_MS,
      now,
    );

    if (!storageCleanupDue && !deletionAuditDue) {
      return emptyResult();
    }

    const nextState: DAVECloudMaintenanceState = Object.freeze({
      storageCleanupAttemptedAt: storageCleanupDue
        ? now
        : state.storageCleanupAttemptedAt,
      deletionAuditAttemptedAt: deletionAuditDue
        ? now
        : state.deletionAuditAttemptedAt,
    });
    cachedState = nextState;
    await persistState(dependencies.storage, nextState).catch(() => undefined);

    const [storageCleanup] = await Promise.allSettled([
      storageCleanupDue
        ? Promise.resolve().then(() => dependencies.processStorageCleanup())
        : Promise.resolve<DAVEStorageCleanupResult | null>(null),
      deletionAuditDue
        ? Promise.resolve().then(() => dependencies.purgeDeletionAudit())
        : Promise.resolve(null),
    ]);

    const cleanupResult = storageCleanup.status === 'fulfilled'
      ? storageCleanup.value
      : null;

    return {
      storageCleanupRan: storageCleanupDue,
      storageCleanupCompleted: cleanupResult?.completed ?? 0,
      storageCleanupRemaining: cleanupResult?.remaining ?? (
        storageCleanupDue && storageCleanup.status === 'rejected' ? 1 : 0
      ),
      storageCleanupErrors: cleanupResult?.errors ?? (
        storageCleanupDue && storageCleanup.status === 'rejected'
          ? ['Protected file cleanup is temporarily unavailable.']
          : []
      ),
      deletionAuditRan: deletionAuditDue,
    };
  }

  return Object.freeze({ run });
}

const defaultScheduler = createDAVECloudMaintenanceScheduler({
  storage: AsyncStorage,
  now: () => Date.now(),
  processStorageCleanup: () => processDAVEStorageCleanup(),
  purgeDeletionAudit: () => purgeExpiredDAVEDeletionAudit(),
});

export function runDAVECloudMaintenanceIfDue(
  options: Readonly<{ forceStorageCleanup?: boolean }> = {},
): Promise<DAVECloudMaintenanceResult> {
  return defaultScheduler.run(options);
}

function isDue(
  attemptedAt: number | null,
  intervalMs: number,
  now: number,
): boolean {
  return attemptedAt === null || attemptedAt > now || now - attemptedAt >= intervalMs;
}

async function loadState(
  storage: DAVECloudMaintenanceStorage,
): Promise<DAVECloudMaintenanceState> {
  try {
    const raw = await storage.getItem(DAVE_CLOUD_MAINTENANCE_STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return EMPTY_STATE;
    }
    const record = parsed as Record<string, unknown>;
    return Object.freeze({
      storageCleanupAttemptedAt: finiteTimestamp(record.storageCleanupAttemptedAt),
      deletionAuditAttemptedAt: finiteTimestamp(record.deletionAuditAttemptedAt),
    });
  } catch {
    return EMPTY_STATE;
  }
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function persistState(
  storage: DAVECloudMaintenanceStorage,
  state: DAVECloudMaintenanceState,
): Promise<void> {
  await storage.setItem(DAVE_CLOUD_MAINTENANCE_STORAGE_KEY, JSON.stringify(state));
}

function emptyResult(): DAVECloudMaintenanceResult {
  return {
    storageCleanupRan: false,
    storageCleanupCompleted: 0,
    storageCleanupRemaining: 0,
    storageCleanupErrors: [],
    deletionAuditRan: false,
  };
}
