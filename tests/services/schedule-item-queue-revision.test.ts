import {
  hasMatchingQueuedScheduleItemRevision,
  scheduleItemRevisionForCloudRefresh,
} from '../../services/ScheduleItemQueueRevision';
import type { SyncQueueItem } from '../../services/SyncService';
import type { ScheduleItem } from '../../types';

const task: ScheduleItem = {
  id: 'task-1',
  projectName: '2321 Compliance Project',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  startDate: '',
  finishDate: '2026-07-31',
  milestone: '',
  owner: 'David',
  contractor: '',
  percentComplete: 15,
  priority: 'Medium',
  status: 'In Progress',
  notes: '',
  createdAt: '2026-07-27T10:00:00.000Z',
  updatedAt: '2026-07-27T10:05:00.000Z',
};

function queued(
  itemData: ScheduleItem,
  changedFields: Array<keyof ScheduleItem> = ['percentComplete', 'status', 'updatedAt'],
): SyncQueueItem {
  const changedAt = itemData.updatedAt || '2026-07-27T10:05:00.000Z';
  return {
    id: `schedule-item-${itemData.id}`,
    entity: 'schedule_item',
    operation: 'update',
    payload: { id: itemData.id, itemData, changedFields },
    createdAt: changedAt,
    changedAt,
    retryCount: 0,
  };
}

describe('schedule item queue revision', () => {
  it('preserves a visible local task while its exact revision is queued', () => {
    expect(hasMatchingQueuedScheduleItemRevision(task, [queued(task)])).toBe(true);
  });

  it('does not preserve an older visible revision after a newer edit is queued', () => {
    const newer = {
      ...task,
      percentComplete: 20,
      updatedAt: '2026-07-27T10:06:00.000Z',
    };
    expect(hasMatchingQueuedScheduleItemRevision(task, [queued(newer)])).toBe(false);
  });

  it('requires every queued changed field to match the visible task', () => {
    const queuedCopy = { ...task, owner: 'Different owner' };
    expect(hasMatchingQueuedScheduleItemRevision(
      task,
      [queued(queuedCopy, ['owner', 'updatedAt'])],
    )).toBe(false);
  });

  it('ignores task deletions', () => {
    expect(hasMatchingQueuedScheduleItemRevision(task, [{
      ...queued(task),
      operation: 'delete',
      payload: { id: task.id },
    }])).toBe(false);
  });

  it('uses a newer cloud task once no exact local revision remains queued', () => {
    const cloud = {
      ...task,
      owner: 'Updated owner',
      percentComplete: 20,
      updatedAt: '2026-07-27T10:06:00.000Z',
    };
    expect(scheduleItemRevisionForCloudRefresh(task, cloud, [])).toBe(cloud);
    expect(scheduleItemRevisionForCloudRefresh(task, cloud, [queued(task)])).toBe(task);
  });
});
