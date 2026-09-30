import type { SyncQueueItem } from './SyncService';

/**
 * Work queued for one project that has not reached the cloud. Closing the
 * project while it waits is allowed: field updates still upload to a closed
 * project (audit A7 M2). Tasks and documents queued before the close sit
 * ahead of it in the queue, so they normally upload first; only one whose own
 * upload fails waits until the project is reopened (audit A3 pass 3). The
 * count lets Close Project say so before the owner confirms.
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
    lines.push(`${plural(waiting.tasksAndDocuments, 'task or document change')} waiting to upload normally upload${waiting.tasksAndDocuments === 1 ? 's' : ''} first; if one cannot, it waits until you reopen the project.`);
  }
  return lines.join('\n\n');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
