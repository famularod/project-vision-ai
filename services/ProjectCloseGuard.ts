import type { SyncQueueItem } from './SyncService';

/**
 * Work queued for one project that has not reached the cloud. Closing the
 * project while it waits is allowed: field updates still upload to a closed
 * project, while its tasks and documents wait until it is reopened (audit A7
 * M2). The count lets Close Project say so before the owner confirms.
 */
export type QueuedProjectWork = Readonly<{
  updates: number;
  tasksAndDocuments: number;
}>;

export function queuedWorkForProject(
  queue: readonly SyncQueueItem[],
  projectName: string,
): QueuedProjectWork {
  const key = projectName.trim().toLowerCase();
  let updates = 0;
  let tasksAndDocuments = 0;
  if (!key) return { updates, tasksAndDocuments };
  for (const item of queue) {
    if (item.operation === 'delete') continue;
    const names = queuedItemProjectNames(item);
    if (!names.some(name => name.trim().toLowerCase() === key)) continue;
    if (item.entity === 'project_update') updates += 1;
    else tasksAndDocuments += 1;
  }
  return { updates, tasksAndDocuments };
}

function queuedItemProjectNames(item: SyncQueueItem): string[] {
  const payload = record(item.payload);
  if (item.entity === 'project_update') {
    if (payload.archiveOnly) return [];
    return strings([payload.projectName, record(payload.updateData).projectName]);
  }
  if (item.entity === 'schedule_item') {
    return strings([record(payload.itemData).projectName]);
  }
  if (item.entity === 'reference_document') {
    const document = record(payload.documentData);
    return strings([
      document.projectName,
      ...(Array.isArray(document.projectNames) ? document.projectNames : []),
    ]);
  }
  return [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function strings(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

export function closeProjectMessage(projectName: string, waiting: QueuedProjectWork): string {
  const lines = [`${projectName} will move to Archived Projects.`];
  if (waiting.updates > 0) {
    lines.push(`${plural(waiting.updates, 'field update')} still waiting to upload will upload after it closes.`);
  }
  if (waiting.tasksAndDocuments > 0) {
    lines.push(`${plural(waiting.tasksAndDocuments, 'task or document change')} waiting to upload will wait until you reopen it.`);
  }
  return lines.join('\n\n');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
