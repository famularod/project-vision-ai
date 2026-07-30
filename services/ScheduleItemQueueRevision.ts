import type { SyncQueueItem } from './SyncService';
import type { ScheduleItem } from '../types';

type ScheduleItemQueuePayload = {
  id?: unknown;
  itemData?: unknown;
  changedFields?: unknown;
  forceLocal?: unknown;
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
  return queue.some(queueItem => {
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
  });
}

export function scheduleItemRevisionForCloudRefresh(
  localItem: ScheduleItem,
  cloudItem: ScheduleItem,
  queue: readonly SyncQueueItem[],
): ScheduleItem {
  return hasMatchingQueuedScheduleItemRevision(localItem, queue)
    ? localItem
    : cloudItem;
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
