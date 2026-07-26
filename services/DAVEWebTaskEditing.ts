import type {
  ProjectItemType,
  ScheduleDependency,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import {
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
} from './ScheduleProgressInvariant';
import { appendProjectItemActivity } from './ProjectItemWorkflow';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';

export type DAVEWebScheduleItem = ScheduleItem & Readonly<{
  /** Exact cloud row revision used for optimistic concurrency checks. */
  cloudUpdatedAt: string | null;
}>;

export type DAVEWebTaskDraft = Readonly<{
  itemType: ProjectItemType;
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
  nextAction: string;
  /** New append-only activity entered during this save. */
  activityMessage: string;
  /** Optional planning fields used by the desktop schedule builder. */
  wbsCode?: string;
  parentItemId?: string;
  sortOrder?: number | string | null;
  durationDays?: number | string | null;
  dependencies?: readonly ScheduleDependency[];
  isSummary?: boolean;
  isMilestone?: boolean;
  baselineStartDate?: string;
  baselineFinishDate?: string;
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
  const normalizedDraftProgress = reconcileScheduleProgress(
    draft.status,
    draft.percentComplete,
  );
  const statusChanged = !current || draft.status !== current.status;
  const draftPercentNumber = typeof draft.percentComplete === 'number'
    ? draft.percentComplete
    : Number(draft.percentComplete.replace('%', '').trim());
  const boundedDraftPercent = Number.isFinite(draftPercentNumber)
    ? Math.max(0, Math.min(100, Math.round(draftPercentNumber)))
    : current?.percentComplete;
  const percentChanged = !current || boundedDraftPercent !== current.percentComplete;
  const progress = current
    ? reconcileScheduleProgressEdit(current, {
        ...(statusChanged ? { status: draft.status } : {}),
        ...(percentChanged ? { percentComplete: draft.percentComplete } : {}),
      })
    : normalizedDraftProgress;
  const currentProjectScope = normalized(current?.scheduleProjectName || current?.projectName);
  const projectNameForRecord = current && currentProjectScope === normalized(projectName)
    ? current.projectName
    : projectName;
  const progressChanged = !current ||
    current.status !== progress.status ||
    current.percentComplete !== progress.percentComplete;
  const activityMessage = draft.activityMessage.trim();
  const activity = appendProjectItemActivity({
    activity: current?.activity,
    message: activityMessage,
    author: actor,
    createdAt: now,
    id: `activity-${now}-${current?.activity?.length ?? 0}`,
  });

  return {
    id: requiredText(id, 'Task identity'),
    itemType: draft.itemType,
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
    durationDays: optionalPlanningNumber(draft.durationDays, current?.durationDays),
    wbsCode: optionalPlanningText(draft.wbsCode, current?.wbsCode),
    parentItemId: optionalPlanningText(draft.parentItemId, current?.parentItemId),
    sortOrder: optionalPlanningNumber(draft.sortOrder, current?.sortOrder),
    dependencies: normalizeScheduleDependencies(
      draft.dependencies === undefined ? current?.dependencies : draft.dependencies,
    ),
    isSummary: draft.isSummary === undefined
      ? current?.isSummary === true
      : draft.isSummary === true,
    isMilestone: draft.isMilestone === undefined
      ? current?.isMilestone === true
      : draft.isMilestone === true,
    baselineStartDate: optionalPlanningText(
      draft.baselineStartDate,
      current?.baselineStartDate,
    ),
    baselineFinishDate: optionalPlanningText(
      draft.baselineFinishDate,
      current?.baselineFinishDate,
    ),
    percentComplete: progress.percentComplete,
    progressSource: 'project_manager',
    progressConfirmedAt: progressChanged ? now : current?.progressConfirmedAt ?? now,
    progressConfirmedBy: progressChanged
      ? actor.trim() || 'Project manager'
      : current?.progressConfirmedBy ?? (actor.trim() || 'Project manager'),
    priority: draft.priority,
    status: progress.status,
    notes: draft.notes.trim(),
    nextAction: draft.nextAction.trim(),
    activity,
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

function optionalPlanningText(
  value: string | undefined,
  fallback: string | null | undefined,
): string | null {
  if (value === undefined) return fallback?.trim() || null;
  return value.trim() || null;
}

function optionalPlanningNumber(
  value: number | string | null | undefined,
  fallback: number | null | undefined,
): number | null {
  if (value === undefined) return fallback ?? null;
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}
