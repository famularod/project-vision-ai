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
  return Boolean(matchingQueuedScheduleItemRevision(item, queue));
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
  if (!Array.isArray(payload.changedFields)) return localItem;

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
