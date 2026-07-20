import type {
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';

export type DAVEWebScheduleItem = ScheduleItem & Readonly<{
  /** Exact cloud row revision used for optimistic concurrency checks. */
  cloudUpdatedAt: string | null;
}>;

export type DAVEWebTaskDraft = Readonly<{
  taskName: string;
  projectName: string;
  locationName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  contractor: string;
  percentComplete: number | string;
  priority: SchedulePriority;
  status: ScheduleStatus;
  notes: string;
}>;

export class DAVEWebTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAVEWebTaskValidationError';
  }
}

export function createDAVEWebTaskId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new DAVEWebTaskValidationError(
      'This browser cannot create a secure task identity. Update the browser and try again.',
    );
  }
  return globalThis.crypto.randomUUID();
}

export function buildDAVEWebScheduleItem({
  draft,
  current = null,
  id,
  now,
  actor,
}: {
  draft: DAVEWebTaskDraft;
  current?: DAVEWebScheduleItem | null;
  id: string;
  now: string;
  actor: string;
}): DAVEWebScheduleItem {
  const taskName = requiredText(draft.taskName, 'Task name');
  const projectName = requiredText(draft.projectName, 'Project');
  const progress = reconcileScheduleProgress(draft.status, draft.percentComplete);
  const currentProjectScope = normalized(current?.scheduleProjectName || current?.projectName);
  const projectNameForRecord = current && currentProjectScope === normalized(projectName)
    ? current.projectName
    : projectName;
  const progressChanged = !current ||
    current.status !== progress.status ||
    current.percentComplete !== progress.percentComplete;

  return {
    id: requiredText(id, 'Task identity'),
    scheduleProjectName: projectName,
    projectTimeZone: current?.projectTimeZone ?? null,
    projectName: projectNameForRecord,
    locationName: draft.locationName.trim(),
    taskName,
    startDate: draft.startDate.trim(),
    finishDate: draft.finishDate.trim(),
    milestone: draft.milestone.trim(),
    owner: draft.owner.trim(),
    contractor: draft.contractor.trim(),
    durationDays: current?.durationDays ?? null,
    percentComplete: progress.percentComplete,
    progressSource: 'project_manager',
    progressConfirmedAt: progressChanged ? now : current?.progressConfirmedAt ?? now,
    progressConfirmedBy: progressChanged
      ? actor.trim() || 'Project manager'
      : current?.progressConfirmedBy ?? (actor.trim() || 'Project manager'),
    priority: draft.priority,
    status: progress.status,
    notes: draft.notes.trim(),
    importedFrom: current?.importedFrom ?? null,
    importedAt: current?.importedAt ?? null,
    importBatchId: current?.importBatchId ?? null,
    sourceDocumentId: current?.sourceDocumentId ?? null,
    completionVerification: progressChanged ? null : current?.completionVerification ?? null,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    cloudUpdatedAt: current?.cloudUpdatedAt ?? null,
  };
}

export function scheduleItemForCloud(
  item: DAVEWebScheduleItem | ScheduleItem,
): ScheduleItem {
  const { cloudUpdatedAt: _cloudUpdatedAt, ...scheduleItem } = item as DAVEWebScheduleItem;
  return scheduleItem;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new DAVEWebTaskValidationError(`${label} is required.`);
  return normalized;
}

function normalized(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
