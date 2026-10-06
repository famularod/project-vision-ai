/**
 * Independent review R02 (Build 229): a record this device holds that the
 * cloud's list does not is not yet a record the cloud does not have.
 *
 * The list is read a page at a time. A task edited on another device while it
 * is read can be left out of the pages, and the sync then took the task as new
 * to the cloud and sent this device's whole copy over the other device's
 * newer row: 0% and no note over 80% and a note.
 *
 * Before anything is decided from a record's absence, the cloud is asked for
 * it by its exact id (one request for every hundred records, none when the
 * list held them all):
 *
 *   found    the record joins the list, and is weighed against this device's
 *            copy exactly as a listed record is. It is never sent whole.
 *   absent   the cloud really has none: it is new, as before.
 *   unread   the read failed: nothing is decided, the record is not sent, and
 *            the sync says so.
 */
import { canonicalScheduleItemJson } from './ScheduleItemCloudAcknowledgement';

type CloudReadResult<T> = Readonly<{
  ok: boolean;
  stubbed?: boolean;
  data: readonly T[] | null;
  error?: string;
  message?: string;
}>;

export type CloudRecordsByIdReader<T> = (ids: readonly string[]) => Promise<CloudReadResult<T>>;

export type CloudListAbsenceCheck<T> = Readonly<{
  /** The cloud's list, with the records it left out that the cloud has. */
  cloud: T[];
  /** Left out of the list, and the cloud has them. */
  foundIds: ReadonlySet<string>;
  /** Left out of the list, and the cloud has no record of them. */
  absentIds: ReadonlySet<string>;
  /** Left out of the list, and the read by id failed: nothing may be decided about them. */
  unreadIds: ReadonlySet<string>;
  /** Why the read by id failed; null when it did not. */
  error: string | null;
}>;

/**
 * The code of a task write made only if the cloud had no row for the task,
 * when it had one after all (upsertScheduleItem's onlyIfAbsent): the row is as
 * it was, and this device's copy was not sent over it.
 */
export const SCHEDULE_ITEM_ALREADY_IN_CLOUD = 'schedule_item_already_in_cloud';

const idKey = (id: unknown) => (typeof id === 'string' ? id.trim().toLowerCase().replace(/\s+/g, ' ') : '');

export async function confirmRecordsMissingFromCloudList<T extends { id: string }>({
  local,
  listed,
  deletedIds = [],
  readByIds,
}: Readonly<{
  local: readonly T[];
  listed: readonly T[];
  /** Records with a deletion record are never sent, so they are not asked about. */
  deletedIds?: readonly string[];
  readByIds: CloudRecordsByIdReader<T>;
}>): Promise<CloudListAbsenceCheck<T>> {
  const listedKeys = new Set(listed.map(record => idKey(record.id)));
  const deletedKeys = new Set(deletedIds.map(idKey));
  const missing = new Map<string, string>();
  local.forEach(record => {
    const key = idKey(record.id);
    if (key && !listedKeys.has(key) && !deletedKeys.has(key) && !missing.has(key)) missing.set(key, record.id);
  });
  if (missing.size === 0) {
    return { cloud: [...listed], foundIds: new Set(), absentIds: new Set(), unreadIds: new Set(), error: null };
  }

  let read: CloudReadResult<T> | null = null;
  try {
    read = await readByIds([...missing.values()]);
  } catch {
    read = null;
  }
  if (!read?.ok || read.stubbed || !Array.isArray(read.data)) {
    return {
      cloud: [...listed],
      foundIds: new Set(),
      absentIds: new Set(),
      unreadIds: new Set(missing.values()),
      error: read?.error || read?.message || 'The cloud could not be asked for these records one by one.',
    };
  }

  // Only what was asked for joins the list.
  const found = read.data.filter(record => missing.has(idKey(record.id)));
  const foundKeys = new Set(found.map(record => idKey(record.id)));
  return {
    cloud: [...listed, ...found],
    foundIds: new Set([...missing].filter(([key]) => foundKeys.has(key)).map(([, id]) => id)),
    absentIds: new Set([...missing].filter(([key]) => !foundKeys.has(key)).map(([, id]) => id)),
    unreadIds: new Set(),
    error: null,
  };
}

/** The records by the id the sync compares them by. */
export function cloudRecordsById<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map(record => [idKey(record.id), record] as const));
}

/** The key cloudRecordsById files this id under. */
export function cloudRecordKey(id: string): string {
  return idKey(id);
}

/** The record of this id among records keyed by cloudRecordsById. */
export function cloudRecordOf<T>(records: ReadonlyMap<string, T>, id: string): T | undefined {
  return records.get(idKey(id));
}

/**
 * Whether the cloud's record is still the one a decision was made against:
 * both absent, or the same content whatever the order of its fields.
 */
export function sameCloudRecord(before: unknown, now: unknown): boolean {
  if (before === undefined || before === null || now === undefined || now === null) {
    return (before === undefined || before === null) && (now === undefined || now === null);
  }
  return canonicalScheduleItemJson(before) === canonicalScheduleItemJson(now);
}
