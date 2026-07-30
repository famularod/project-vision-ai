import {
  confirmScheduleItemCloudAcknowledgement,
  scheduleItemCloudAcknowledgementMatches,
} from '../../services/ScheduleItemCloudAcknowledgement';
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

describe('schedule item cloud acknowledgement', () => {
  it('accepts the exact returned task revision regardless of object key order', () => {
    expect(scheduleItemCloudAcknowledgementMatches(task, {
      id: task.id,
      item_data: {
        ...task,
        status: task.status,
        percentComplete: task.percentComplete,
      },
    })).toBe(true);
  });

  it('rejects a stale percentage returned by the cloud', () => {
    expect(scheduleItemCloudAcknowledgementMatches(task, {
      id: task.id,
      item_data: { ...task, percentComplete: 10 },
    })).toBe(false);
  });

  it('rejects a response without the persisted row', () => {
    expect(scheduleItemCloudAcknowledgementMatches(task, null)).toBe(false);
  });

  it('does not perform an extra read when the upsert response is exact', async () => {
    const readPersistedRow = jest.fn(async () => null);

    await expect(confirmScheduleItemCloudAcknowledgement(
      task,
      { id: task.id, item_data: task },
      readPersistedRow,
    )).resolves.toBe(true);
    expect(readPersistedRow).not.toHaveBeenCalled();
  });

  it('accepts a successful persisted revision after a normalized upsert response', async () => {
    await expect(confirmScheduleItemCloudAcknowledgement(
      task,
      { id: task.id, item_data: { ...task, percentComplete: 10 } },
      async () => ({ id: task.id, item_data: task }),
    )).resolves.toBe(true);
  });

  it('rejects the acknowledgement when the authoritative reread is still stale', async () => {
    await expect(confirmScheduleItemCloudAcknowledgement(
      task,
      null,
      async () => ({
        id: task.id,
        item_data: { ...task, updatedAt: '2026-07-27T10:04:00.000Z' },
      }),
    )).resolves.toBe(false);
  });
});
