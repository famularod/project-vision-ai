import { planPendingUploadBatch } from '../../services/SyncUploadBatchPolicy';

type QueueItem = Readonly<{
  id: string;
  entity: 'schedule_item' | 'project_update' | 'project_area' | 'reference_document';
  retryCount: number;
}>;

function item(
  id: string,
  entity: QueueItem['entity'],
  retryCount = 0,
): QueueItem {
  return { id, entity, retryCount };
}

describe('sync upload batch policy', () => {
  it('gives a new task revision one bounded task-only pass', () => {
    const plan = planPendingUploadBatch([
      item('task-new', 'schedule_item'),
      item('photo-update', 'project_update'),
      item('document', 'reference_document'),
    ]);

    expect(plan.taskPriorityBatch).toBe(true);
    expect(plan.uploadBatch.map(entry => entry.id)).toEqual(['task-new']);
  });

  it('does not let a previously failed task starve other entity types', () => {
    const plan = planPendingUploadBatch([
      item('task-failed', 'schedule_item', 1),
      item('photo-update', 'project_update'),
      item('area', 'project_area'),
      item('document', 'reference_document'),
    ]);

    expect(plan.taskPriorityBatch).toBe(false);
    expect(plan.uploadBatch.map(entry => entry.id)).toEqual([
      'task-failed',
      'photo-update',
      'area',
      'document',
    ]);
  });

  it('keeps all task revisions together during a new task priority pass', () => {
    const plan = planPendingUploadBatch([
      item('task-new', 'schedule_item'),
      item('task-failed', 'schedule_item', 4),
      item('photo-update', 'project_update'),
    ]);

    expect(plan.uploadBatch.map(entry => entry.id)).toEqual([
      'task-new',
      'task-failed',
    ]);
  });

  it('processes the complete queue when no task revision is waiting', () => {
    const queue = [
      item('photo-update', 'project_update'),
      item('area', 'project_area'),
    ];

    expect(planPendingUploadBatch(queue).uploadBatch).toEqual(queue);
  });
});
