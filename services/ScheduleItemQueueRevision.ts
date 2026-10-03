import type { SyncQueueItem } from './SyncService';
import type { ScheduleItem } from '../types';
import { isEditBase, scheduleItemWholeCopyOverCloud, type ScheduleItemEditBase } from './ScheduleItemEditBase';

type ScheduleItemQueuePayload = {
  id?: unknown;
  itemData?: unknown;
  changedFields?: unknown;
  forceLocal?: unknown;
  carriedProgress?: unknown;
  base?: unknown;
};

/**
 * A visible local task may stay in front of the cloud only while that exact
 * revision is durably waiting to upload. Once its queue entry clears, the
 * cloud row becomes authoritative so receiving devices cannot retain stale
 * owner, contractor, percentage, or status fields.
 */
export function hasMatchingQueuedScheduleItemRevision(
  item: ScheduleItem,
  queue: readonly SyncQueueItem[],
): boolean {
  return Boolean(matchingQueuedScheduleItemRevision(item, queue));
}

/**
 * Whether this copy of a task is a percent the sync merge carried, still
 * waiting to go up as a change of its progress alone (whole-app audit A7
 * pass 26 M-1). Full Sync leaves such a copy to that change: uploaded whole,
 * it outranked the cloud's newer notes, owner, dates and lookahead note.
 */
export function scheduleItemCarriedProgressWaiting(
  item: ScheduleItem,
  queue: readonly SyncQueueItem[],
): boolean {
  const queued = matchingQueuedScheduleItemRevision(item, queue);
  const payload = queued?.payload as ScheduleItemQueuePayload | undefined;
  return Boolean(payload && payload.carriedProgress === true && Array.isArray(payload.changedFields));
}

function matchingQueuedScheduleItemRevision(
  item: ScheduleItem,
  queue: readonly SyncQueueItem[],
): SyncQueueItem | null {
  return queue.find(queueItem => {
    if (
      queueItem.entity !== 'schedule_item' ||
      queueItem.operation === 'delete'
    ) {
      return false;
    }

    const payload = queueItem.payload as ScheduleItemQueuePayload;
    if (
      payload.id !== item.id ||
      !isScheduleItemRecord(payload.itemData)
    ) {
      return false;
    }

    const queuedItem = payload.itemData;
    if (queuedItem.updatedAt !== item.updatedAt) return false;

    if (!Array.isArray(payload.changedFields)) {
      return JSON.stringify(queuedItem) === JSON.stringify(item);
    }

    return payload.changedFields.every(field => (
      typeof field === 'string' &&
      JSON.stringify(queuedItem[field as keyof ScheduleItem]) ===
        JSON.stringify(item[field as keyof ScheduleItem])
    ));
  }) ?? null;
}

export function scheduleItemRevisionForCloudRefresh(
  localItem: ScheduleItem,
  cloudItem: ScheduleItem,
  queue: readonly SyncQueueItem[],
): ScheduleItem {
  const queuedRevision = matchingQueuedScheduleItemRevision(localItem, queue);
  if (!queuedRevision) return cloudItem;

  const payload = queuedRevision.payload as ScheduleItemQueuePayload;
  // A whole copy keeps the cloud's values where it is the copy it started from (owner answer Q28).
  if (!Array.isArray(payload.changedFields)) {
    return isEditBase(payload.base) && payload.forceLocal !== true ? scheduleItemWholeCopyOverCloud(localItem, payload.base, cloudItem) : localItem;
  }

  return payload.changedFields.reduce<ScheduleItem>((rebased, field) => {
    if (
      typeof field === 'string' &&
      Object.prototype.hasOwnProperty.call(localItem, field)
    ) {
      (rebased as Record<string, unknown>)[field] =
        (localItem as unknown as Record<string, unknown>)[field];
    }
    return rebased;
  }, { ...cloudItem });
}

function isScheduleItemRecord(value: unknown): value is ScheduleItem {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ScheduleItem>;
  return (
    typeof record.id === 'string' &&
    typeof record.taskName === 'string' &&
    typeof record.projectName === 'string' &&
    typeof record.status === 'string' &&
    typeof record.percentComplete === 'number' &&
    typeof record.updatedAt === 'string'
  );
}

/**
 * A task edit waiting on this device with the copy it started from (owner
 * answer Q28, ScheduleItemEditBase): queued, or held in Review Conflicts with
 * the fields changed on both devices.
 */
export type PendingScheduleItemEdit = Readonly<{
  id: string;
  itemData: ScheduleItem;
  /** The fields an edit changed; null for a whole copy (a schedule approved, a lookahead deleted, a carried percent). */
  changedFields: readonly string[] | null;
  base: ScheduleItemEditBase;
  inConflict: boolean;
}>;

/**
 * The tasks as a download merges them, with each task edit waiting here with
 * its base over the cloud's row (owner answer Q28): the cloud's row with the
 * edit's own fields, as the refresh already shows a waiting edit
 * (scheduleItemRevisionForCloudRefresh); a task whose edit waits in Review
 * Conflicts shows the cloud's row. The device's copy of such a task is
 * otherwise newer than the cloud's in its stamp alone, and Full Sync's
 * download and the startup load kept it whole: its old note, owner, dates and
 * lookahead note over the other device's. Tasks without such an edit (and
 * every edit queued by Build 229 or earlier) are merged as before.
 */
export function scheduleItemsWithPendingEditsOverCloud(
  local: readonly ScheduleItem[],
  cloud: readonly ScheduleItem[],
  pending: readonly PendingScheduleItemEdit[] | null | undefined,
): ScheduleItem[] {
  if (!pending || pending.length === 0) return [...local];
  const cloudById = new Map(cloud.map(item => [item.id, item]));
  return local.map(item => {
    const cloudItem = cloudById.get(item.id);
    const edits = pending.filter(edit => edit.id === item.id);
    if (!cloudItem || edits.length === 0) return item;
    const queued = edits.filter(edit => !edit.inConflict);
    if (queued.length === 0) return cloudItem;
    // A whole copy waiting: the device's copy, with the cloud's values where it is the copy it started from.
    const whole = queued.find(edit => edit.changedFields === null);
    if (whole) return scheduleItemWholeCopyOverCloud(item, whole.base, cloudItem);
    const rebased: Record<string, unknown> = { ...cloudItem };
    queued.forEach(edit => {
      const source = edit.itemData as unknown as Record<string, unknown>;
      (edit.changedFields || []).forEach(field => {
        if (Object.prototype.hasOwnProperty.call(source, field)) rebased[field] = source[field];
        else delete rebased[field];
      });
    });
    return rebased as unknown as ScheduleItem;
  });
}
