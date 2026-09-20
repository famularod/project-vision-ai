import {
  confirmScheduleItemCloudAcknowledgement,
  describeScheduleItemAcknowledgementMismatch,
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

describe('describeScheduleItemAcknowledgementMismatch', () => {
  it('names a field the cloud did not keep', () => {
    const { notes: _notes, ...withoutNotes } = task;

    expect(describeScheduleItemAcknowledgementMismatch(task, {
      id: task.id,
      item_data: withoutNotes,
    })).toBe('dropped by the cloud: notes');
  });

  it('names a field only the cloud copy carries', () => {
    expect(describeScheduleItemAcknowledgementMismatch(task, {
      id: task.id,
      item_data: { ...task, legacyField: 'x' },
    })).toBe('only in the cloud copy: legacyField');
  });

  it('names a field whose value changed, without disclosing either value', () => {
    const description = describeScheduleItemAcknowledgementMismatch(task, {
      id: task.id,
      item_data: { ...task, percentComplete: 99 },
    });

    expect(description).toBe('different value: percentComplete');
    expect(description).not.toContain('99');
    expect(description).not.toContain(String(task.percentComplete));
  });

  it('reports an absent row rather than a field list', () => {
    expect(describeScheduleItemAcknowledgementMismatch(task, null))
      .toBe('the cloud returned no row');
  });

  it('reports a mismatched record id', () => {
    expect(describeScheduleItemAcknowledgementMismatch(task, {
      id: 'someone-else',
      item_data: task,
    })).toBe('the cloud returned a different record id');
  });
});
