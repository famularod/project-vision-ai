import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DAVESyncTombstone,
  DAVESyncTombstoneEntity,
} from '../types';
import {
  listDAVESyncTombstones,
  upsertDAVESyncTombstone,
} from './SupabaseService';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const DAVE_SYNC_TOMBSTONES_STORAGE_KEY = '@dave/sync-tombstones/v1';
/**
 * Audit P1-28: deletion history is a durable journal. Corrupt journal bytes
 * are preserved here for forensic recovery instead of being replaced by [].
 */
export const DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY =
  '@dave/sync-tombstones/quarantine/v1';
export const DAVE_SYNC_TOMBSTONES_QUARANTINE_PREFIX =
  '@dave/sync-tombstones/quarantine/v2/';

let mutationTail: Promise<void> = Promise.resolve();
let synchronizationInFlight: Promise<DAVESyncTombstoneSyncResult> | null = null;

export type DAVESyncTombstoneSyncResult = {
  tombstones: DAVESyncTombstone[];
  cloudAuthoritative: boolean;
  cloudError: string | null;
  /**
   * Audit P1-28: number of tombstones the cloud did not acknowledge this
   * pass. They stay in the local journal and are retried on every sync, but
   * a non-zero count must surface as a visible partial-sync condition.
   */
  uploadFailures?: number;
};

export function parseDAVESyncTombstones(value: unknown): DAVESyncTombstone[] {
  if (!Array.isArray(value)) return [];
  return mergeDAVESyncTombstones(
    value
      .map(normalizeDAVESyncTombstone)
      .filter((item): item is DAVESyncTombstone => Boolean(item)),
  );
}

/** Strict parser for callers already holding the shared storage-key lock. */
export function parsePersistedDAVESyncTombstones(
  value: unknown,
): DAVESyncTombstone[] {
  if (!Array.isArray(value)) {
    throw new Error('The deletion history is not a stored array.');
  }
  const normalized = value.map(normalizeDAVESyncTombstone);
  if (normalized.some(item => !item)) {
    throw new Error('The deletion history contains an invalid record.');
  }
  return mergeDAVESyncTombstones(normalized as DAVESyncTombstone[]);
}

export function mergeDAVESyncTombstones(
  ...groups: readonly (readonly DAVESyncTombstone[])[]
): DAVESyncTombstone[] {
  const merged = new Map<string, DAVESyncTombstone>();

  groups.flat().forEach(candidate => {
    const normalized = normalizeDAVESyncTombstone(candidate);
    if (!normalized) return;

    const key = tombstoneKey(normalized.entityType, normalized.recordId);
    const previous = merged.get(key);
    if (
      !previous ||
      new Date(normalized.deletedAt).getTime() > new Date(previous.deletedAt).getTime()
    ) {
      merged.set(key, normalized);
    }
  });

  return [...merged.values()].sort((left, right) =>
    right.deletedAt.localeCompare(left.deletedAt),
  );
}

export function deletedDAVERecordIds(
  tombstones: readonly DAVESyncTombstone[],
  entityType: DAVESyncTombstoneEntity,
): string[] {
  return tombstones
    .filter(tombstone => tombstone.entityType === entityType)
    .map(tombstone => tombstone.recordId);
}

export function removeDAVETombstonedRecords<T extends { id: string }>(
  records: readonly T[],
  tombstones: readonly DAVESyncTombstone[],
  entityType: DAVESyncTombstoneEntity,
): T[] {
  const deletedIds = new Set(
    deletedDAVERecordIds(tombstones, entityType).map(normalizedRecordId),
  );
  return records.filter(record => !deletedIds.has(normalizedRecordId(record.id)));
}

export async function loadDAVESyncTombstones(): Promise<DAVESyncTombstone[]> {
  await mutationTail;
  return runExclusiveLocalStorageMutation(
    [DAVE_SYNC_TOMBSTONES_STORAGE_KEY],
    readLocalTombstones,
  );
}

export async function recordDAVESyncTombstone(
  entityType: DAVESyncTombstoneEntity,
  recordId: string,
  deletedAt = new Date().toISOString(),
): Promise<DAVESyncTombstone> {
  const [tombstone] = await recordDAVESyncTombstones(
    [{ entityType, recordId }],
    deletedAt,
  );
  return tombstone;
}

export async function recordDAVESyncTombstones(
  deletions: readonly {
    entityType: DAVESyncTombstoneEntity;
    recordId: string;
  }[],
  deletedAt = new Date().toISOString(),
): Promise<DAVESyncTombstone[]> {
  const tombstones = deletions.map(deletion =>
    normalizeDAVESyncTombstone({ ...deletion, deletedAt }),
  );
  if (tombstones.some(tombstone => !tombstone)) {
    throw new Error('A valid record id is required for deletion.');
  }
  const validTombstones = tombstones as DAVESyncTombstone[];
  if (validTombstones.length === 0) return [];

  await serializeTombstoneMutation(async () => {
    const local = await readLocalTombstones();
    await persistLocalTombstones(mergeDAVESyncTombstones(local, validTombstones));
  });

  await Promise.allSettled(
    validTombstones.map(tombstone => upsertDAVESyncTombstone(tombstone)),
  );

  return validTombstones;
}

export async function synchronizeDAVESyncTombstones(): Promise<DAVESyncTombstoneSyncResult> {
  if (synchronizationInFlight) return synchronizationInFlight;

  const task = performTombstoneSynchronization();
  synchronizationInFlight = task;

  try {
    return await task;
  } finally {
    if (synchronizationInFlight === task) synchronizationInFlight = null;
  }
}

async function performTombstoneSynchronization(): Promise<DAVESyncTombstoneSyncResult> {
  let cloudTombstones: DAVESyncTombstone[] = [];
  let cloudAuthoritative = false;
  let cloudError: string | null = null;
  try {
    const cloud = await listDAVESyncTombstones();
    if (cloud.ok && !cloud.stubbed && cloud.data) {
      cloudTombstones = cloud.data;
      cloudAuthoritative = true;
    } else {
      cloudError = cloud.error || cloud.message || 'Cloud deletion history is unavailable.';
    }
  } catch (error) {
    cloudTombstones = [];
    cloudError = error instanceof Error
      ? error.message
      : 'Cloud deletion history is unavailable.';
  }

  const merged = await serializeTombstoneMutation(async () => {
    let local: DAVESyncTombstone[] = [];
    try {
      local = await readLocalTombstones();
    } catch (error) {
      // A successful owner-scoped cloud read is authoritative enough to
      // rebuild a damaged local journal. The exact damaged bytes remain in
      // quarantine for support/export; never recover from an empty or failed
      // cloud response because that could forget a device-only deletion.
      if (!cloudAuthoritative) throw error;
    }
    const next = mergeDAVESyncTombstones(local, cloudTombstones);
    await persistLocalTombstones(next);
    return next;
  });

  // Audit P1-28: count unacknowledged uploads instead of discarding results.
  // Failed tombstones remain in the durable local journal and are re-sent on
  // every synchronization pass.
  const uploadResults = await Promise.allSettled(
    merged.map(tombstone => upsertDAVESyncTombstone(tombstone)),
  );
  const uploadFailures = uploadResults.filter(result =>
    result.status === 'rejected' ||
    (result.value.configured && !result.value.stubbed && !result.value.ok),
  ).length;
  return {
    tombstones: merged,
    cloudAuthoritative,
    cloudError,
    uploadFailures,
  };
}

function serializeTombstoneMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const guardedMutation = () => runExclusiveLocalStorageMutation(
    [DAVE_SYNC_TOMBSTONES_STORAGE_KEY],
    mutation,
  );
  const next = mutationTail.then(guardedMutation, guardedMutation);
  mutationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readLocalTombstones(): Promise<DAVESyncTombstone[]> {
  const raw = await AsyncStorage.getItem(DAVE_SYNC_TOMBSTONES_STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantineInvalidTombstones(raw, []);
    throw new Error('Unreachable after corrupt tombstone quarantine.');
  }

  if (!Array.isArray(parsed)) {
    await quarantineInvalidTombstones(raw, []);
    throw new Error('Unreachable after invalid tombstone quarantine.');
  }

  const normalized = parsed.map(normalizeDAVESyncTombstone);
  const valid = normalized.filter(
    (item): item is DAVESyncTombstone => Boolean(item),
  );
  if (valid.length !== parsed.length) {
    await quarantineInvalidTombstones(raw, mergeDAVESyncTombstones(valid));
    throw new Error('Unreachable after partial tombstone recovery.');
  }
  return mergeDAVESyncTombstones(valid);
}

async function quarantineInvalidTombstones(
  raw: string,
  valid: readonly DAVESyncTombstone[],
): Promise<never> {
  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey: DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
    quarantineKeyPrefix: DAVE_SYNC_TOMBSTONES_QUARANTINE_PREFIX,
    raw,
    replacementRaw: valid.length > 0 ? JSON.stringify(valid) : null,
  });

  // Keep a backward-compatible pointer to the first quarantined payload for
  // support/export while every exact payload remains in its own stable key.
  const existingPointer = await AsyncStorage.getItem(
    DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY,
  );
  if (existingPointer === null) {
    await AsyncStorage.setItem(
      DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY,
      JSON.stringify({ quarantinedAt: new Date().toISOString(), raw }),
    );
  }

  throw localCorruptionRecoveryError({
    label: 'The deletion history',
    recovery,
    salvagedRecords: valid.length,
  });
}

/** Audit P1-28: expose quarantined journal bytes for recovery/export. */
export async function loadQuarantinedDAVESyncTombstones(): Promise<
  { quarantinedAt: string; raw: string } | null
> {
  const stored = await AsyncStorage.getItem(DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as { quarantinedAt?: unknown; raw?: unknown };
    if (typeof parsed.raw !== 'string') return null;
    return {
      quarantinedAt: String(parsed.quarantinedAt || ''),
      raw: parsed.raw,
    };
  } catch {
    return null;
  }
}

async function persistLocalTombstones(tombstones: readonly DAVESyncTombstone[]) {
  await AsyncStorage.setItem(
    DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
    JSON.stringify(mergeDAVESyncTombstones(tombstones)),
  );
}

function normalizeDAVESyncTombstone(value: unknown): DAVESyncTombstone | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<DAVESyncTombstone>;
  const entityType = record.entityType;
  const recordId = String(record.recordId || '').trim();
  const deletedAtTimestamp = new Date(String(record.deletedAt || '')).getTime();
  if (
    !recordId ||
    !Number.isFinite(deletedAtTimestamp) ||
    !isDAVESyncTombstoneEntity(entityType)
  ) return null;

  return {
    entityType,
    recordId,
    deletedAt: new Date(deletedAtTimestamp).toISOString(),
  };
}

function isDAVESyncTombstoneEntity(
  value: unknown,
): value is DAVESyncTombstoneEntity {
  return value === 'project_area' ||
    value === 'schedule_item' ||
    value === 'reference_document';
}

function tombstoneKey(entityType: DAVESyncTombstoneEntity, recordId: string) {
  return `${entityType}:${normalizedRecordId(recordId)}`;
}

function normalizedRecordId(recordId: string) {
  return String(recordId || '').trim().toLowerCase();
}
