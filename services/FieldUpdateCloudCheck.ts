import type { DAVESyncTombstone, ProjectUpdate } from '../types';
import { cloudOwnerUnchanged, currentCloudOwner } from './CloudOwnerBinding';
import { fieldUpdateLifecycleLabel } from './FieldUpdateLifecycle';
import { classifySyncFailureText, syncFailureCategoryOfError } from './SyncFailureCategory';
import { listDAVESyncTombstonesForRecords, listProjectUpdates, type SupabaseServiceResult } from './SupabaseService';
import { getOfflineQueue, type SyncQueueItem } from './SyncService';

/**
 * Open item 2.30 (13-14 Oct 2026; S1's report, the coordinator's decision): Builds 210 to 228 marked every saved field
 * update "Cloud Synced" before it uploaded (whole-app audit A4, fixed in Build 229 for new saves). An update whose
 * upload then never reached the cloud still reads "Cloud Synced" on that iPhone or iPad, nothing sends it by itself,
 * and nothing says so. Settings > Sync Now would send it, silently, also one deleted on another device before
 * deletions left a record.
 *
 * "Check field updates against the cloud" FINDS them and does nothing else: it sends nothing and changes nothing, on
 * this device or in the cloud. Only when he taps it, it reads the cloud's list of this account's field updates once
 * and, only for those missing from it, asks the cloud once whether a deletion record names them. It lists each field
 * update on this device that reads "Cloud Synced", is not archived, is not in the cloud's list, has no upload waiting
 * on this device, and is named by no deletion record.
 */

type CheckedUpdate = ProjectUpdate & { isArchived?: boolean; stableSendId?: string | null };
type CloudReceipt = Readonly<{ id: string; idempotencyKey?: string | null }>;

const key = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** The field updates the check names (pure): see above. In the device's own order. */
export function fieldUpdatesMarkedSyncedMissingFromCloud({
  local,
  cloud,
  deletedIds,
  waitingIds,
}: Readonly<{
  local: readonly CheckedUpdate[];
  cloud: readonly CloudReceipt[];
  deletedIds: readonly string[];
  waitingIds: readonly string[];
}>): CheckedUpdate[] {
  const inCloud = new Set(cloud.flatMap(row => [key(row.id), key(row.idempotencyKey)]).filter(Boolean));
  const deleted = new Set(deletedIds.map(key));
  const waiting = new Set(waitingIds.map(key));
  return local.filter(update => marksCloudSynced(update) &&
    !inCloud.has(key(update.id)) && !(key(update.stableSendId) && inCloud.has(key(update.stableSendId))) &&
    !deleted.has(key(update.id)) && !waiting.has(key(update.id)));
}

/** What the update's card says: "Cloud Synced", and not archived (an archived update is not in his lists). */
function marksCloudSynced(update: CheckedUpdate): boolean {
  return Boolean(update.status) && fieldUpdateLifecycleLabel(update.status!) === 'Cloud Synced' && update.isArchived !== true;
}

/** The ids of the field updates with an upload waiting on this device, from its queue as it reads it. */
function waitingUpdateIds(queue: readonly SyncQueueItem[]): string[] {
  return queue.flatMap(item => (item.entity === 'project_update' && typeof (item.payload as { id?: unknown })?.id === 'string'
    ? [(item.payload as { id: string }).id]
    : []));
}

export type FieldUpdateCloudCheckOutcome =
  | Readonly<{ kind: 'nothing_to_check' }>
  | Readonly<{ kind: 'none_found'; checked: number }>
  | Readonly<{ kind: 'found'; checked: number; updates: readonly CheckedUpdate[] }>
  | Readonly<{ kind: 'could_not_run'; reason: 'not_signed_in' | 'no_signal' | 'not_set_up' | 'account_changed' | 'unreadable' }>;

/** Why a cloud read failed, in the check's own terms. */
function failureReason(result: SupabaseServiceResult<unknown>): Extract<FieldUpdateCloudCheckOutcome, { kind: 'could_not_run' }>['reason'] {
  if (result.configured === false) return 'not_set_up';
  const category = classifySyncFailureText([result.error || '', result.message || '']);
  if (category === 'signed_out' || category === 'auth') return 'not_signed_in';
  if (category === 'offline') return 'no_signal';
  return 'unreadable';
}

/**
 * The check. `readers` are the cloud's and this device's (injected only by tests). Nothing it calls writes: the two
 * cloud lists, and this device's waiting-uploads queue as SyncService gives it.
 */
export async function checkFieldUpdatesAgainstCloud(
  savedUpdates: readonly CheckedUpdate[],
  readers: Readonly<{
    listCloudUpdates?: () => Promise<SupabaseServiceResult<readonly CloudReceipt[]>>;
    listDeletionRecords?: (ids: readonly string[]) => Promise<SupabaseServiceResult<readonly DAVESyncTombstone[]>>;
    readWaitingUploads?: () => Promise<readonly SyncQueueItem[]>;
  }> = {},
): Promise<FieldUpdateCloudCheckOutcome> {
  const {
    listCloudUpdates = () => listProjectUpdates<unknown>(),
    listDeletionRecords = ids => listDAVESyncTombstonesForRecords('project_update', ids),
    readWaitingUploads = getOfflineQueue,
  } = readers;
  const marked = savedUpdates.filter(marksCloudSynced);
  if (marked.length === 0) return { kind: 'nothing_to_check' };
  const account = currentCloudOwner();
  try {
    return await checkMarked(marked, account, listCloudUpdates, listDeletionRecords, readWaitingUploads);
  } catch (error) {
    // A request that threw (no connection) is said as such; anything else, as a list not read.
    return { kind: 'could_not_run', reason: syncFailureCategoryOfError(error) === 'offline' ? 'no_signal' : 'unreadable' };
  }
}

async function checkMarked(
  marked: readonly CheckedUpdate[],
  account: ReturnType<typeof currentCloudOwner>,
  listCloudUpdates: () => Promise<SupabaseServiceResult<readonly CloudReceipt[]>>,
  listDeletionRecords: (ids: readonly string[]) => Promise<SupabaseServiceResult<readonly DAVESyncTombstone[]>>,
  readWaitingUploads: () => Promise<readonly SyncQueueItem[]>,
): Promise<FieldUpdateCloudCheckOutcome> {
  const cloud = await listCloudUpdates();
  if (!cloud.ok || cloud.stubbed || !Array.isArray(cloud.data)) return { kind: 'could_not_run', reason: failureReason(cloud) };
  const waitingIds = waitingUpdateIds(await readWaitingUploads());
  const missing = fieldUpdatesMarkedSyncedMissingFromCloud({ local: marked, cloud: cloud.data, deletedIds: [], waitingIds });
  let deletedIds: string[] = [];
  if (missing.length > 0) {
    const deletions = await listDeletionRecords(missing.map(update => update.id));
    if (!deletions.ok || deletions.stubbed || !Array.isArray(deletions.data)) return { kind: 'could_not_run', reason: failureReason(deletions) };
    deletedIds = deletions.data.filter(record => record.entityType === 'project_update').map(record => record.recordId);
  }
  // The lists are this account's: a sign-in to another account meanwhile makes them the wrong lists.
  if (!cloudOwnerUnchanged(account)) return { kind: 'could_not_run', reason: 'account_changed' };
  const found = fieldUpdatesMarkedSyncedMissingFromCloud({ local: marked, cloud: cloud.data, deletedIds, waitingIds });
  return found.length > 0 ? { kind: 'found', checked: marked.length, updates: found } : { kind: 'none_found', checked: marked.length };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOTHING_CHANGED = 'Nothing was sent or changed.';

/** "7 Oct 2026", in this device's time zone; the date as stored when it cannot be read. */
function dayOf(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return (value || '').trim() || 'No date';
  const day = new Date(time);
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/** The first words of the update's note, at most eight. */
function firstWords(notes: unknown): string {
  const words = (typeof notes === 'string' ? notes : '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '(no note)';
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : words.join(' ');
}

/** One line per update the check found: its date, its project and the first words of its note. */
export function fieldUpdateCloudCheckItemLine(update: CheckedUpdate): string {
  return `${dayOf(update.date)} · ${(update.projectName || '').trim() || 'No project'} · ${firstWords(update.notes)}`;
}

/** What Settings says after the check: its sentence, and one line per update found. */
export function fieldUpdateCloudCheckText(outcome: FieldUpdateCloudCheckOutcome): Readonly<{ summary: string; items: string[] }> {
  if (outcome.kind === 'nothing_to_check') {
    return { summary: `No field update on this device reads “Cloud Synced”, so there was nothing to check. ${NOTHING_CHANGED}`, items: [] };
  }
  if (outcome.kind === 'none_found') {
    const all = outcome.checked === 1 ? 'The 1 field update on this device that reads “Cloud Synced” is' : `All ${outcome.checked} field updates on this device that read “Cloud Synced” are`;
    return { summary: `${all} in the cloud. ${NOTHING_CHANGED}`, items: [] };
  }
  if (outcome.kind === 'found') {
    const count = outcome.updates.length;
    const these = count === 1 ? 'This field update reads' : `These ${count} field updates read`;
    return {
      summary: `${these} “Cloud Synced” on this device but ${count === 1 ? 'is' : 'are'} not in the cloud, and no deletion record names ${count === 1 ? 'it' : 'them'}. ${NOTHING_CHANGED} Sync Now would send ${count === 1 ? 'it' : 'them'}; if ${count === 1 ? 'it is' : 'one is'} an update you deleted on another device, delete it here first.`,
      items: outcome.updates.map(fieldUpdateCloudCheckItemLine),
    };
  }
  const why = {
    not_signed_in: 'this device is not signed in to the cloud. Sign in, then check again.',
    no_signal: 'the cloud could not be reached. This device may have no signal; try again when it has.',
    not_set_up: 'this copy of the app is not set up to reach the cloud.',
    account_changed: 'the account signed in changed while it ran. Check again.',
    unreadable: 'the cloud’s list could not be read just now. Try again shortly.',
  }[outcome.reason];
  return { summary: `The check could not run: ${why} ${NOTHING_CHANGED}`, items: [] };
}
