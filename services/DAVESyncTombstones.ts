import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DAVESyncTombstone,
  DAVESyncTombstoneEntity,
} from '../types';
import {
  listDAVESyncTombstones,
  upsertDAVESyncTombstone,
} from './SupabaseService';

export const DAVE_SYNC_TOMBSTONES_STORAGE_KEY = '@dave/sync-tombstones/v1';
/**
 * Audit P1-28: deletion history is a durable journal. Corrupt journal bytes
 * are preserved here for forensic recovery instead of being replaced by [].
 */
export const DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY =
  '@dave/sync-tombstones/quarantine/v1';

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
  return readLocalTombstones();
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
    const local = await readLocalTombstones();
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
  const next = mutationTail.then(mutation, mutation);
  mutationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readLocalTombstones(): Promise<DAVESyncTombstone[]> {
  const raw = await AsyncStorage.getItem(DAVE_SYNC_TOMBSTONES_STORAGE_KEY);
  if (!raw) return [];
  try {
    return parseDAVESyncTombstones(JSON.parse(raw));
  } catch {
    // Audit P1-28: never destroy the deletion journal. Preserve the corrupt
    // bytes for recovery, then continue from an explicitly empty journal.
    await quarantineCorruptTombstoneBytes(raw);
    return [];
  }
}

async function quarantineCorruptTombstoneBytes(raw: string): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(
      DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY,
    );
    // Keep the FIRST corrupt payload; later corruption must not overwrite
    // earlier forensic evidence.
    if (existing === null) {
      await AsyncStorage.setItem(
        DAVE_SYNC_TOMBSTONES_QUARANTINE_KEY,
        JSON.stringify({ quarantinedAt: new Date().toISOString(), raw }),
      );
    }
    await AsyncStorage.removeItem(DAVE_SYNC_TOMBSTONES_STORAGE_KEY);
  } catch {
    // Quarantine is best-effort; the corrupt key is left in place so a later
    // attempt can still preserve it.
  }
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
