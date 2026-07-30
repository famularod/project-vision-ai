type PendingUploadItem = Readonly<{
  entity: string;
  retryCount: number;
}>;

export type PendingUploadBatchPlan<TItem extends PendingUploadItem> = Readonly<{
  taskPriorityBatch: boolean;
  uploadBatch: readonly TItem[];
}>;

/**
 * A newly confirmed task edit gets one task-only pass so its Save action is
 * not held behind older media or document work. Once a task has already
 * failed, it must share the next pass with the rest of the queue; otherwise a
 * permanently failing task can starve every other entity forever.
 */
export function planPendingUploadBatch<TItem extends PendingUploadItem>(
  orderedQueue: readonly TItem[],
): PendingUploadBatchPlan<TItem> {
  const taskPriorityBatch = orderedQueue.some(item => (
    item.entity === 'schedule_item' &&
    item.retryCount === 0
  ));

  return Object.freeze({
    taskPriorityBatch,
    uploadBatch: taskPriorityBatch
      ? orderedQueue.filter(item => item.entity === 'schedule_item')
      : [...orderedQueue],
  });
}
