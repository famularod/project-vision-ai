import type {
  ProjectItemType,
  ProjectControls,
  ScheduleDependency,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import {
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
} from './ScheduleProgressInvariant';
import {
  appendProjectItemActivity,
  closeProjectItemWorkflow,
  projectItemWorkflowIsClosed,
  reopenProjectItemWorkflow,
  validateProjectItemWorkflowEdit,
} from './ProjectItemWorkflow';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';
import {
  normalizeProjectControls,
  PROJECT_CONTROL_DATA_FIELDS,
} from './VitruviusProjectControls';

export type DAVEWebScheduleItem = ScheduleItem & Readonly<{
  /** Exact cloud row revision used for optimistic concurrency checks. */
  cloudUpdatedAt: string | null;
}>;

export type DAVEWebTaskDraft = Readonly<{
  /** Immutable cloud project authority required by operational-row writes. */
  projectId?: string | null;
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
  /** Explicit structured-record transition requested by the workflow control. */
  workflowAction?: 'close' | 'reopen';
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
  /** Shared project-control fields edited on desktop or retained from mobile. */
  projectControls?: ProjectControls | null;
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
  const activity = draft.workflowAction
    ? [...(current?.activity || [])]
    : appendProjectItemActivity({
        activity: current?.activity,
        message: activityMessage,
        author: actor,
        createdAt: now,
        id: `activity-${now}-${current?.activity?.length ?? 0}`,
      });
  const projectId = current?.projectId?.trim() || draft.projectId?.trim() || null;
  if (!projectId) {
    throw new DAVEWebTaskValidationError(
      'Choose a current cloud project before saving this task.',
    );
  }

  const item: DAVEWebScheduleItem = {
    id: requiredText(id, 'Task identity'),
    projectId,
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
    projectControls: normalizeProjectControls(
      draft.projectControls === undefined
        ? current?.projectControls
        : draft.projectControls,
    ),
    importedFrom: current?.importedFrom ?? null,
    importedAt: current?.importedAt ?? null,
    importBatchId: current?.importBatchId ?? null,
    // Kept on a web edit, as the phone keeps it (whole-app audit A5 pass 2).
    ...(current?.alsoImportedInBatchIds?.length ? { alsoImportedInBatchIds: current.alsoImportedInBatchIds } : {}),
    sourceDocumentId: current?.sourceDocumentId ?? null,
    sourceActivityId: current?.sourceActivityId ?? null,
    sourceWbsCode: current?.sourceWbsCode ?? null,
    sourceRowNumber: current?.sourceRowNumber ?? null,
    completionVerification: progressChanged ? null : current?.completionVerification ?? null,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    cloudUpdatedAt: current?.cloudUpdatedAt ?? null,
  };

  if (draft.workflowAction) {
    if (
      draft.workflowAction === 'reopen' &&
      current &&
      projectItemWorkflowIsClosed(current) &&
      (current.itemType || 'Task') !== draft.itemType
    ) {
      throw new DAVEWebTaskValidationError(
        `Reopen ${current.itemType || 'Task'} before changing its project item type.`,
      );
    }
    const transition = draft.workflowAction === 'close'
      ? closeProjectItemWorkflow({
          item,
          actor,
          now,
          note: activityMessage || undefined,
          activityId: `activity-close-${id}-${now}`,
        })
      : reopenProjectItemWorkflow({
          item,
          actor,
          now,
          note: activityMessage || undefined,
          activityId: `activity-reopen-${id}-${now}`,
        });
    if (!transition.ok) {
      throw new DAVEWebTaskValidationError(transition.message);
    }
    return {
      ...item,
      ...transition.item,
      cloudUpdatedAt: item.cloudUpdatedAt,
    };
  }

  const workflowValidation = validateProjectItemWorkflowEdit({
    current,
    next: item,
  });
  if (!workflowValidation.ok) {
    throw new DAVEWebTaskValidationError(workflowValidation.message);
  }

  return item;
}

/**
 * "Apply My Changes" after a save conflict keeps what the other device saved
 * in every field the owner left alone (whole-app audit round 2 F4, 30 Sep
 * 2026). The whole form had been laid over the latest version, so a phone's
 * newer 60% and note went back to the 40% and old note the web had opened.
 * A field counts as changed when the form differs from `base`, the version
 * the form was opened on; when both devices changed it, the owner's value
 * wins. An unchanged progress value keeps the latest one and its
 * confirmation time, because buildDAVEWebScheduleItem then sees no progress
 * change. Project controls are merged field by field in the same way.
 */
export function mergeDAVEWebConflictDraft({
  draft,
  base,
  latest,
  now,
  actor,
}: {
  draft: DAVEWebTaskDraft;
  base: ScheduleItem;
  latest: ScheduleItem;
  now: string;
  actor: string;
}): DAVEWebTaskDraft {
  const text = (
    mine: string,
    opened: string | null | undefined,
    theirs: string | null | undefined,
  ) => (mine.trim() === (opened ?? '').trim() ? theirs ?? '' : mine);
  const minePercent = boundedPercent(draft.percentComplete);
  const openedProject = base.scheduleProjectName || base.projectName;
  const latestProject = latest.scheduleProjectName || latest.projectName;
  const planningText = (
    mine: string | undefined,
    opened: string | null | undefined,
  ) => (mine === undefined || mine.trim() === (opened ?? '').trim() ? undefined : mine);
  const planningNumber = (
    mine: number | string | null | undefined,
    opened: number | null | undefined,
  ) => (
    mine === undefined ||
    optionalPlanningNumber(mine, null) === optionalPlanningNumber(opened ?? null, null)
      ? undefined
      : mine
  );
  const planningFlag = (mine: boolean | undefined, opened: boolean | undefined) => (
    mine === undefined || (mine === true) === (opened === true) ? undefined : mine
  );
  const dependenciesChanged = draft.dependencies !== undefined &&
    JSON.stringify(normalizeScheduleDependencies(draft.dependencies)) !==
      JSON.stringify(normalizeScheduleDependencies(base.dependencies));

  return {
    ...draft,
    itemType: draft.itemType === (base.itemType || 'Task')
      ? latest.itemType || 'Task'
      : draft.itemType,
    taskName: text(draft.taskName, base.taskName, latest.taskName),
    projectName: normalized(draft.projectName) === normalized(openedProject)
      ? latestProject
      : draft.projectName,
    locationName: text(draft.locationName, base.locationName, latest.locationName),
    startDate: text(draft.startDate, base.startDate, latest.startDate),
    finishDate: text(draft.finishDate, base.finishDate, latest.finishDate),
    milestone: text(draft.milestone, base.milestone, latest.milestone),
    owner: text(draft.owner, base.owner, latest.owner),
    contractor: text(draft.contractor, base.contractor, latest.contractor),
    percentComplete: minePercent === null || minePercent === base.percentComplete
      ? latest.percentComplete
      : draft.percentComplete,
    priority: draft.priority === (base.priority ?? 'Medium')
      ? latest.priority ?? 'Medium'
      : draft.priority,
    status: draft.status === base.status ? latest.status : draft.status,
    notes: text(draft.notes, base.notes, latest.notes),
    nextAction: text(draft.nextAction, base.nextAction, latest.nextAction),
    wbsCode: planningText(draft.wbsCode, base.wbsCode),
    parentItemId: planningText(draft.parentItemId, base.parentItemId),
    sortOrder: planningNumber(draft.sortOrder, base.sortOrder),
    durationDays: planningNumber(draft.durationDays, base.durationDays),
    dependencies: dependenciesChanged ? draft.dependencies : undefined,
    isSummary: planningFlag(draft.isSummary, base.isSummary),
    isMilestone: planningFlag(draft.isMilestone, base.isMilestone),
    baselineStartDate: planningText(draft.baselineStartDate, base.baselineStartDate),
    baselineFinishDate: planningText(draft.baselineFinishDate, base.baselineFinishDate),
    projectControls: draft.projectControls === undefined
      ? undefined
      : mergeConflictProjectControls({
          mine: draft.projectControls,
          opened: base.projectControls,
          theirs: latest.projectControls,
          now,
          actor,
        }),
  };
}

function mergeConflictProjectControls({
  mine,
  opened,
  theirs,
  now,
  actor,
}: {
  mine: ProjectControls | null;
  opened: ProjectControls | null | undefined;
  theirs: ProjectControls | null | undefined;
  now: string;
  actor: string;
}): ProjectControls | null {
  const minePC = normalizeProjectControls(mine);
  const openedPC = normalizeProjectControls(opened);
  const changed = PROJECT_CONTROL_DATA_FIELDS.filter(field =>
    JSON.stringify(minePC[field]) !== JSON.stringify(openedPC[field]));
  if (changed.length === 0) return theirs ?? null;
  const theirsPC = normalizeProjectControls(theirs);
  const updatedBy = actor.trim() || 'Project manager';
  const fieldRevisions = { ...(theirsPC.fieldRevisions || {}) };
  const values: Partial<ProjectControls> = {};
  changed.forEach(field => {
    (values as Record<string, unknown>)[field] = JSON.parse(JSON.stringify(minePC[field]));
    // Stamped now: the owner chose to write his value over the other device's.
    fieldRevisions[field] = {
      revision: Math.max(
        minePC.fieldRevisions?.[field]?.revision || 0,
        theirsPC.fieldRevisions?.[field]?.revision || 0,
      ) + 1,
      updatedAt: now,
      updatedBy,
    };
  });
  return normalizeProjectControls({
    ...theirsPC,
    ...values,
    revision: Math.max(minePC.revision, theirsPC.revision) + 1,
    updatedAt: now,
    updatedBy,
    fieldRevisions,
  });
}

function boundedPercent(value: number | string): number | null {
  const parsed = typeof value === 'number'
    ? value
    : value.trim()
      ? Number(value.replace('%', '').trim())
      : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
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
