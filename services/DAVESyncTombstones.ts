import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DAVESyncTombstone,
  DAVESyncTombstoneEntity,
} from '../types';
import {
  listDAVESyncTombstones,
  upsertDAVESyncTombstones,
} from './SupabaseService';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';
import {
  CLOUD_ACCOUNT_CHANGED_MESSAGE,
  callAsCloudOwner,
  cloudOwnerUnchanged,
  currentCloudOwner,
  type CloudOwnerBinding,
} from './CloudOwnerBinding';
import { anotherAccountHasUsedThisPhone } from './OwnerStorageSandbox';

export const DAVE_SYNC_TOMBSTONES_STORAGE_KEY = '@dave/sync-tombstones/v1';
/**
 * Review pass 1, sync G5 (owner answer Q45, 6 Oct 2026): the deletion records on this phone whose account is not
 * known. A list of marks, one per record ("kind:id|when it was deleted"); a record with no mark here is the
 * account's own. See accountUnknownMarks. It travels with the account when the phone's storage is switched.
 */
export const DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY = '@dave/sync-tombstones/account-unknown/v1';
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
/** The order of calls and starts, counted (no clock): which came first, a caller or the synchronization under way. */
let synchronizationCalls = 0;
let synchronizationInFlightSince = 0;
let operationalRefreshInFlight: Promise<DAVESyncTombstoneSyncResult> | null = null;
/**
 * Review pass 1, sync G5: which account each read under way was begun for. A caller is handed a read already under
 * way only when it was begun for the account that is signed in now: one account's deletion history is never the
 * answer to another account's question.
 */
let synchronizationInFlightFor = -1;
let operationalRefreshInFlightFor = -1;

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
  /**
   * When the cloud read of this history started (whole-app audit A6 pass 11,
   * 30 Sep 2026). A refresh handed a read already in flight
   * (`loadDAVEOperationalTombstones`) gets that read's earlier start, so a
   * download is never recorded as holding a deletion made after it.
   */
  readStartedAt?: string;
};

// A real owner can accumulate hundreds of durable deletion markers. Physical
// device evidence showed the paginated, owner-scoped read regularly completes
// after 1.5 seconds even on healthy Wi-Fi. Keep the operation bounded, but do
// not classify that normal latency as a failed authority refresh.
const DAVE_OPERATIONAL_TOMBSTONE_REFRESH_TIMEOUT_MS = 8_000;
export const DAVE_SYNC_TOMBSTONE_UPLOAD_BATCH_SIZE = 100;

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

/** This account's deletion records on this phone (a record whose account is not known is left out: see accountUnknownMarks). */
export async function loadDAVESyncTombstones(): Promise<DAVESyncTombstone[]> {
  const account = currentCloudOwner();
  return serializeTombstoneMutation(async () => {
    const local = await readLocalTombstones();
    const unknown = await accountUnknownMarks(local, account);
    return unknown ? withoutAccountUnknown(local, unknown) : [];
  });
}

/**
 * Review pass 1, sync G5 (older; owner answer Q45, 6 Oct 2026: "check who is signed in at every step of sending,
 * and always save an item under the account that made it").
 *
 * What was wrong. This file read the cloud's deletion history, merged it with the phone's own list, saved the merged
 * list and uploaded all of it, and looked at who was signed in at none of those steps. When account A signed out
 * and B signed in while A's history was being read, A's records were saved into what was by then B's list on the
 * phone and written into B's history in the cloud, as B. A project's deletion record is the project's NAME, so B's
 * own project of that name then read as deleted. The same for the upload, a hundred records at a time: the rest of
 * A's list went up as B. And a read already under way was handed to whoever asked next, whichever account.
 *
 * Now, as for a waiting item (sync batch Y4):
 *  - every step is for the account that was signed in when it began. The cloud is asked "as" that account, so the
 *    cloud layer refuses when it finds another one signed in, and the request names the account, so it is not sent
 *    with another account's sign-in;
 *  - the account is looked at again after every answer, before the phone's list is read, and in the instant before
 *    anything is saved. Once it has changed nothing is saved, nothing more is uploaded, and the answer is "not
 *    known": no records, not authoritative, saying the account changed. So one account's records are never saved
 *    into, uploaded as, or applied to another's. They are still in its own cloud history and in its own stored list,
 *    and it has them again at its next sync;
 *  - a read under way is shared only with the account it was begun for.
 */
function answerForAnotherAccount(readStartedAt?: string): DAVESyncTombstoneSyncResult {
  return {
    tombstones: [],
    cloudAuthoritative: false,
    cloudError: CLOUD_ACCOUNT_CHANGED_MESSAGE,
    ...(readStartedAt ? { readStartedAt } : {}),
  };
}

const accountUnknownMark = (tombstone: DAVESyncTombstone) =>
  `${tombstoneKey(tombstone.entityType, tombstone.recordId)}|${tombstone.deletedAt}`;
const recordOfAccountUnknownMark = (mark: string) => mark.slice(0, Math.max(0, mark.lastIndexOf('|')));

function withoutAccountUnknown(
  tombstones: readonly DAVESyncTombstone[],
  unknown: ReadonlySet<string>,
): DAVESyncTombstone[] {
  return unknown.size === 0
    ? [...tombstones]
    : tombstones.filter(tombstone => !unknown.has(accountUnknownMark(tombstone)));
}

/**
 * Review pass 1, sync G5: the records already on a phone when this build first runs. They carry nothing that says
 * whose they are, and an earlier build could have saved another account's records among them. No owner is guessed:
 *  - when this phone's account boundary knows of no other account, nothing can have been mixed: they are this
 *    account's own, as before;
 *  - otherwise each is marked "account not known". A marked record is kept on the phone exactly as it is, and until
 *    its mark goes it is not uploaded as anyone, it is not given to anything that deletes or holds back (it is left
 *    out of every answer of this file), and so it protects nothing by itself. Its mark goes when the signed-in
 *    account's own cloud history is read and holds a record of the same thing (the cloud then says whose it is), or
 *    when this account deletes the same thing on this phone.
 * Decided once per account's stored list (the answer is saved, an empty list included), under the lock every change
 * to the list takes. Records added after that, by anything, are the account's own. A list of marks that cannot be
 * read marks every record there is. With no account known to be signed in nothing is marked, as nothing is held then.
 * Null: the account changed meanwhile, and nothing was read or saved for it.
 */
async function accountUnknownMarks(
  local: readonly DAVESyncTombstone[],
  account: CloudOwnerBinding,
): Promise<Set<string> | null> {
  if (!cloudOwnerUnchanged(account)) return null;
  if (typeof account.ownerId !== 'string' || !account.ownerId) return new Set();
  const raw = await AsyncStorage.getItem(DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY);
  if (raw !== null) {
    try {
      const saved: unknown = JSON.parse(raw);
      if (Array.isArray(saved) && saved.every(mark => typeof mark === 'string')) return new Set(saved as string[]);
    } catch {
      // Not readable: decided again below, and nothing is taken for this account's own.
    }
  }
  const marked = raw !== null || (local.length > 0 && await anotherAccountHasUsedThisPhone(AsyncStorage, account.ownerId))
    ? local.map(accountUnknownMark)
    : [];
  if (!cloudOwnerUnchanged(account)) return null;
  await AsyncStorage.setItem(DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY, JSON.stringify(marked));
  return new Set(marked);
}

/** Saves the marks when they changed. False: the account changed, and nothing was saved. */
async function saveAccountUnknownMarks(
  before: ReadonlySet<string>,
  after: readonly string[],
  account: CloudOwnerBinding,
): Promise<boolean> {
  if (!cloudOwnerUnchanged(account)) return false;
  if (after.length !== before.size) {
    await AsyncStorage.setItem(DAVE_SYNC_TOMBSTONES_ACCOUNT_UNKNOWN_KEY, JSON.stringify(after));
  }
  return cloudOwnerUnchanged(account);
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

  // Review pass 1, sync G5: a deletion is saved under the account that made it, and uploaded as that account. If
  // the account changes before it is saved it is not saved at all (and the caller, which removes the record from
  // this phone only after this, is told).
  const account = currentCloudOwner();
  await serializeTombstoneMutation(async () => {
    if (!cloudOwnerUnchanged(account)) throw new Error(CLOUD_ACCOUNT_CHANGED_MESSAGE);
    const local = await readLocalTombstones();
    const unknown = await accountUnknownMarks(local, account);
    // This account now deletes these itself: an older record of the same thing is no longer of an unknown account.
    const deletedNow = new Set(validTombstones.map(tombstone => tombstoneKey(tombstone.entityType, tombstone.recordId)));
    if (!unknown || !await saveAccountUnknownMarks(
      unknown,
      [...unknown].filter(mark => !deletedNow.has(recordOfAccountUnknownMark(mark))),
      account,
    )) throw new Error(CLOUD_ACCOUNT_CHANGED_MESSAGE);
    await persistLocalTombstones(mergeDAVESyncTombstones(local, validTombstones));
  });

  await uploadDAVESyncTombstoneBatches(validTombstones, account);

  return validTombstones;
}

/**
 * `beganAfterThisCall` (sync batch Y3, item 7): the caller records how far this device has caught up from the
 * moment it was asked to sync, so the history it uses must have been read after that moment. Settings' Sync Now
 * was handed a synchronization already under way, whose read of the cloud began before he pressed it: a deletion
 * made on another device between that read and the press was not in it, yet Reports was told this device had
 * caught up to the press. One already under way is waited for (two never run at once), and then the history is
 * read again; one that began after this call is as good as its own. Every other caller shares, as before.
 */
export async function synchronizeDAVESyncTombstones(
  { beganAfterThisCall = false }: Readonly<{ beganAfterThisCall?: boolean }> = {},
): Promise<DAVESyncTombstoneSyncResult> {
  const calledAt = synchronizationCalls += 1;
  while (synchronizationInFlight) {
    // One begun for another account is waited for, never handed over (review pass 1, sync G5).
    if (synchronizationInFlightFor === currentCloudOwner().epoch &&
      (!beganAfterThisCall || synchronizationInFlightSince > calledAt)) return synchronizationInFlight;
    await synchronizationInFlight.catch(() => undefined);
  }

  const task = performTombstoneSynchronization();
  synchronizationInFlight = task;
  synchronizationInFlightFor = currentCloudOwner().epoch;
  synchronizationInFlightSince = synchronizationCalls += 1;

  try {
    return await task;
  } finally {
    if (synchronizationInFlight === task) synchronizationInFlight = null;
  }
}

async function performTombstoneSynchronization(): Promise<DAVESyncTombstoneSyncResult> {
  // The account this synchronization is for: the same one its read captures in this same instant.
  const account = currentCloudOwner();
  const refreshed = await refreshDAVESyncTombstonesFromCloud();
  if (!cloudOwnerUnchanged(account)) return answerForAnotherAccount(refreshed.readStartedAt);
  // Audit P1-28: count unacknowledged uploads instead of discarding results.
  // Failed tombstones remain in the durable local journal and are re-sent on
  // every explicit/full synchronization pass.
  const uploadFailures = await uploadDAVESyncTombstoneBatches(refreshed.tombstones, account);
  // The list just uploaded is the first account's: it is not the answer once another has signed in.
  if (!cloudOwnerUnchanged(account)) return answerForAnotherAccount(refreshed.readStartedAt);
  return { ...refreshed, uploadFailures };
}

/**
 * Uploads this account's records, a hundred at a time, as the account they were read for (review pass 1, sync G5).
 * The account is looked at again before each hundred: once it has changed the rest are not sent (they are counted
 * as not acknowledged, and stay in their own account's list for its next sync).
 */
async function uploadDAVESyncTombstoneBatches(
  tombstones: readonly DAVESyncTombstone[],
  account: CloudOwnerBinding,
): Promise<number> {
  let uploadFailures = 0;
  for (
    let index = 0;
    index < tombstones.length;
    index += DAVE_SYNC_TOMBSTONE_UPLOAD_BATCH_SIZE
  ) {
    const batch = tombstones.slice(
      index,
      index + DAVE_SYNC_TOMBSTONE_UPLOAD_BATCH_SIZE,
    );
    if (!cloudOwnerUnchanged(account)) {
      uploadFailures += tombstones.length - index;
      break;
    }
    try {
      const result = await callAsCloudOwner(account.ownerId, () => upsertDAVESyncTombstones(batch));
      if (result.configured && !result.stubbed && !result.ok) {
        uploadFailures += batch.length;
      }
    } catch {
      uploadFailures += batch.length;
    }
  }
  return uploadFailures;
}

/**
 * Pulls deletion history without re-uploading the full durable journal.
 * Open-device polling uses this path so hundreds of historical tombstones do
 * not starve current task, area, or document refreshes.
 */
export async function refreshDAVESyncTombstonesFromCloud(): Promise<DAVESyncTombstoneSyncResult> {
  // Review pass 1, sync G5: the account this read is for. Its answer is that account's, whoever is signed in when
  // it arrives.
  const account = currentCloudOwner();
  const readStartedAt = new Date().toISOString();
  let cloudTombstones: DAVESyncTombstone[] = [];
  let cloudAuthoritative = false;
  let cloudError: string | null = null;
  try {
    const cloud = await callAsCloudOwner(account.ownerId, () => listDAVESyncTombstones());
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

  if (!cloudOwnerUnchanged(account)) return answerForAnotherAccount(readStartedAt);

  const merged = await serializeTombstoneMutation(async () => {
    // Looked at again here: the list on the phone is by now the next account's (or nobody's).
    if (!cloudOwnerUnchanged(account)) return null;
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
    const unknown = await accountUnknownMarks(local, account);
    if (!unknown) return null;
    const next = mergeDAVESyncTombstones(local, cloudTombstones);
    // A record of unknown account that this account's own cloud history also holds is this account's: the cloud
    // says so. The others keep their mark (one whose record is no longer in the list is dropped with it).
    const inCloud = new Set(cloudAuthoritative
      ? cloudTombstones.map(tombstone => tombstoneKey(tombstone.entityType, tombstone.recordId))
      : []);
    const listed = new Set(next.map(accountUnknownMark));
    const stillUnknown = [...unknown].filter(mark => listed.has(mark) && !inCloud.has(recordOfAccountUnknownMark(mark)));
    // And in the instant before each save: nothing of this account's is written into another's list.
    if (!await saveAccountUnknownMarks(unknown, stillUnknown, account)) return null;
    await persistLocalTombstones(next);
    return withoutAccountUnknown(next, new Set(stillUnknown));
  });
  if (!merged || !cloudOwnerUnchanged(account)) return answerForAnotherAccount(readStartedAt);

  return {
    tombstones: merged,
    cloudAuthoritative,
    cloudError,
    readStartedAt,
  };
}

/**
 * Bounded receive-side deletion protection. If the cloud inventory is slow,
 * the durable local journal still protects known deletions and callers may
 * safely merge updates only for records already present on this device.
 */
export async function loadDAVEOperationalTombstones(): Promise<DAVESyncTombstoneSyncResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  // Review pass 1, sync G5: a read begun for another account is not this caller's, and its answer is not waited
  // for here. The answer of this one is this account's only while this account stays signed in.
  const account = currentCloudOwner();
  if (operationalRefreshInFlight && operationalRefreshInFlightFor !== account.epoch) operationalRefreshInFlight = null;
  const refresh = operationalRefreshInFlight || refreshDAVESyncTombstonesFromCloud();
  if (!operationalRefreshInFlight) {
    operationalRefreshInFlight = refresh;
    operationalRefreshInFlightFor = account.epoch;
    void refresh.then(
      () => {
        if (operationalRefreshInFlight === refresh) operationalRefreshInFlight = null;
      },
      () => {
        if (operationalRefreshInFlight === refresh) operationalRefreshInFlight = null;
      },
    );
  }
  try {
    const answer = await Promise.race([
      refresh,
      new Promise<DAVESyncTombstoneSyncResult>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('operational_tombstone_refresh_timeout')),
          DAVE_OPERATIONAL_TOMBSTONE_REFRESH_TIMEOUT_MS,
        );
      }),
    ]);
    return cloudOwnerUnchanged(account) ? answer : answerForAnotherAccount(answer.readStartedAt);
  } catch {
    // A transport can remain pending forever after this bounded caller has
    // timed out. Do not keep handing that same dead request to every future
    // sync attempt; its completion handler remains safe if it eventually
    // settles, while the next caller is allowed to start a fresh read.
    if (operationalRefreshInFlight === refresh) operationalRefreshInFlight = null;
    if (!cloudOwnerUnchanged(account)) return answerForAnotherAccount();
    const local = await loadDAVESyncTombstones();
    if (!cloudOwnerUnchanged(account)) return answerForAnotherAccount();
    return {
      tombstones: local,
      cloudAuthoritative: false,
      cloudError: 'Cloud deletion history refresh is still in progress.',
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  return value === 'project' ||
    value === 'project_update' ||
    value === 'project_area' ||
    value === 'schedule_item' ||
    value === 'reference_document';
}

function tombstoneKey(entityType: DAVESyncTombstoneEntity, recordId: string) {
  return `${entityType}:${normalizedRecordId(recordId)}`;
}

function normalizedRecordId(recordId: string) {
  return String(recordId || '').trim().toLowerCase();
}
