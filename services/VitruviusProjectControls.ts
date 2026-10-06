import type {
  ProjectControlApprovalStatus,
  ProjectControlChecklistItem,
  ProjectControlDataField,
  ProjectControlFieldRevision,
  ProjectControlImpactConfidence,
  ProjectControlLinkedRecord,
  ProjectControlLinkedRecordKind,
  ProjectControlResource,
  ProjectControlResourceKind,
  ProjectControls,
  ProjectControlWorkflowStage,
  ScheduleItem,
} from '../types';
import { scheduleEditWithDateChangedAlone } from './ScheduleDateEdit';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';

export const PROJECT_CONTROL_APPROVAL_STATUSES: readonly ProjectControlApprovalStatus[] = [
  'Not Required',
  'Draft',
  'Pending',
  'Approved',
  'Changes Requested',
];

export const PROJECT_CONTROL_WORKFLOW_STAGES: readonly ProjectControlWorkflowStage[] = [
  'Open',
  'In Review',
  'Waiting on Response',
  'Ready for Field',
  'Closed',
];

export const PROJECT_CONTROL_IMPACT_CONFIDENCE: readonly ProjectControlImpactConfidence[] = [
  'Low',
  'Medium',
  'High',
];

export const PROJECT_CONTROL_LINK_KINDS: readonly ProjectControlLinkedRecordKind[] = [
  'Drawing',
  'Document',
  'Photo',
  'Schedule',
];

export const PROJECT_CONTROL_RESOURCE_KINDS: readonly ProjectControlResourceKind[] = [
  'Person',
  'Crew',
  'Company',
  'Equipment',
];

export const PROJECT_CONTROL_DATA_FIELDS: readonly ProjectControlDataField[] = [
  'assignee',
  'trade',
  'watchers',
  'approvers',
  'approvalStatus',
  'workflowStage',
  'referenceNumber',
  'responseDueDate',
  'checklist',
  'linkedRecords',
  'resources',
  'estimatedCostImpact',
  'estimatedScheduleImpactDays',
  'impactConfidence',
  'impactNotes',
];

export type ProjectControlReadiness = Readonly<{
  ready: boolean;
  completedChecks: number;
  totalChecks: number;
  missing: string[];
  pendingApproval: boolean;
}>;

export type VitruviusPortfolioImpact = Readonly<{
  itemCount: number;
  costExposure: number;
  /** Sum of task-level estimates, not a calculated project-finish delay. */
  taskDelayEstimateDaysTotal: number;
  highConfidenceItemCount: number;
  pendingApprovalCount: number;
  unassignedItemCount: number;
}>;

export function emptyProjectControls(): ProjectControls {
  return {
    version: 1,
    assignee: '',
    trade: '',
    watchers: [],
    approvers: [],
    approvalStatus: 'Not Required',
    workflowStage: 'Open',
    referenceNumber: '',
    responseDueDate: '',
    checklist: [],
    linkedRecords: [],
    resources: [],
    estimatedCostImpact: null,
    estimatedScheduleImpactDays: null,
    impactConfidence: 'Medium',
    impactNotes: '',
    revision: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

export function normalizeProjectControls(value: unknown): ProjectControls {
  const source = isRecord(value) ? value : {};
  const normalizedFieldRevisions = fieldRevisions(source.fieldRevisions);
  return {
    version: 1,
    assignee: text(source.assignee),
    trade: text(source.trade),
    watchers: textList(source.watchers),
    approvers: textList(source.approvers),
    approvalStatus: option(
      source.approvalStatus,
      PROJECT_CONTROL_APPROVAL_STATUSES,
      'Not Required',
    ),
    workflowStage: option(
      source.workflowStage,
      PROJECT_CONTROL_WORKFLOW_STAGES,
      'Open',
    ),
    referenceNumber: text(source.referenceNumber),
    responseDueDate: text(source.responseDueDate),
    checklist: checklist(source.checklist),
    linkedRecords: linkedRecords(source.linkedRecords),
    resources: resources(source.resources),
    estimatedCostImpact: nonNegativeNumber(source.estimatedCostImpact),
    estimatedScheduleImpactDays: nonNegativeNumber(source.estimatedScheduleImpactDays),
    impactConfidence: option(
      source.impactConfidence,
      PROJECT_CONTROL_IMPACT_CONFIDENCE,
      'Medium',
    ),
    impactNotes: text(source.impactNotes),
    revision: nonNegativeInteger(source.revision) ?? 0,
    updatedAt: nullableText(source.updatedAt),
    updatedBy: nullableText(source.updatedBy),
    ...(Object.keys(normalizedFieldRevisions).length > 0
      ? { fieldRevisions: normalizedFieldRevisions }
      : {}),
  };
}

/**
 * The fields each edit made here changed (reviseProjectControls), kept beside
 * the edit object only: never stored or sent, so a stored copy passed whole
 * (Verify Complete sends the task as shown) is never taken as a fresh edit
 * by mergeProjectControlsEdit (whole-app audit A2 pass 5 L3).
 */
const fieldsStampedByEdit = new WeakMap<ProjectControls, ReadonlySet<ProjectControlDataField>>();

export function reviseProjectControls({
  current,
  patch,
  actor,
  now,
}: {
  current: ProjectControls | null | undefined;
  patch: Partial<ProjectControls>;
  actor: string;
  now: string;
}): ProjectControls {
  const normalizedCurrent = normalizeProjectControls(current);
  const nextRevision = normalizedCurrent.revision + 1;
  const updatedBy = actor.trim() || 'Project manager';
  const nextFieldRevisions = {
    ...(normalizedCurrent.fieldRevisions || {}),
  };
  const stamped = new Set<ProjectControlDataField>();
  PROJECT_CONTROL_DATA_FIELDS.forEach(field => {
    if (
      Object.prototype.hasOwnProperty.call(patch, field) &&
      JSON.stringify(patch[field]) !== JSON.stringify(normalizedCurrent[field])
    ) {
      stamped.add(field);
      nextFieldRevisions[field] = {
        revision: (normalizedCurrent.fieldRevisions?.[field]?.revision || 0) + 1,
        updatedAt: now,
        updatedBy,
      };
    }
  });
  const next = normalizeProjectControls({
    ...normalizedCurrent,
    ...patch,
    revision: nextRevision,
    updatedAt: now,
    updatedBy,
    fieldRevisions: nextFieldRevisions,
  });
  // Mobile editors persist on every keystroke. Preserve the exact text while a
  // person is typing so entering a space does not collapse words together.
  // Hydration still trims persisted values through normalizeProjectControls.
  const revised: ProjectControls = {
    ...next,
    ...(typeof patch.assignee === 'string' ? { assignee: patch.assignee } : {}),
    ...(typeof patch.trade === 'string' ? { trade: patch.trade } : {}),
    ...(typeof patch.referenceNumber === 'string'
      ? { referenceNumber: patch.referenceNumber }
      : {}),
    ...(typeof patch.responseDueDate === 'string'
      ? { responseDueDate: patch.responseDueDate }
      : {}),
    ...(typeof patch.impactNotes === 'string' ? { impactNotes: patch.impactNotes } : {}),
  };
  fieldsStampedByEdit.set(revised, stamped);
  return revised;
}

/**
 * Merge independently edited project-control fields without treating the
 * nested object as one last-write-wins value. Explicit per-field metadata
 * outranks legacy row metadata. When both devices edited the same field, the
 * later field timestamp is authoritative because revision counters are local
 * to each device; exact-time ties resolve by revision, actor, then canonical
 * value so every device reaches the same result.
 */
export function mergeProjectControlsRevisions(
  localValue: ProjectControls | null | undefined,
  cloudValue: ProjectControls | null | undefined,
): ProjectControls {
  const local = normalizeProjectControls(localValue);
  const cloud = normalizeProjectControls(cloudValue);
  const mergedFieldRevisions: Partial<
    Record<ProjectControlDataField, ProjectControlFieldRevision>
  > = {};
  const mergedValues = PROJECT_CONTROL_DATA_FIELDS.reduce<
    Pick<ProjectControls, ProjectControlDataField>
  >((result, field) => {
    const localWins = compareProjectControlFieldAuthority(
      local,
      cloud,
      field,
    ) >= 0;
    const winner = localWins ? local : cloud;
    const winnerRevision = winner.fieldRevisions?.[field];
    if (winnerRevision) {
      mergedFieldRevisions[field] = { ...winnerRevision };
    }
    return {
      ...result,
      [field]: cloneJsonValue(winner[field]),
    };
  }, {} as Pick<ProjectControls, ProjectControlDataField>);
  const rootWinner = compareProjectControlRootAuthority(local, cloud) >= 0
    ? local
    : cloud;
  const maxFieldRevision = Object.values(mergedFieldRevisions)
    .reduce((maximum, entry) => Math.max(maximum, entry?.revision || 0), 0);
  const latestFieldRevision = Object.values(mergedFieldRevisions)
    .filter((entry): entry is ProjectControlFieldRevision => Boolean(entry))
    .sort(compareFieldRevisionAuthority)
    .at(-1);

  return {
    version: 1,
    ...mergedValues,
    revision: Math.max(local.revision, cloud.revision, maxFieldRevision),
    updatedAt: latestTimestamp([
      local.updatedAt,
      cloud.updatedAt,
      latestFieldRevision?.updatedAt,
    ]),
    updatedBy: latestFieldRevision?.updatedBy || rootWinner.updatedBy,
    ...(Object.keys(mergedFieldRevisions).length > 0
      ? { fieldRevisions: mergedFieldRevisions }
      : {}),
  };
}

/**
 * A local Project controls edit laid over the copy the app holds now. The
 * editor builds its edit from the copy on screen, and a field removed while
 * being typed in saves with the copy of its last render: when another
 * device's change arrives in the render that takes the task out of view, that
 * copy is older (whole-app audit A2 pass 4 L1, 30 Sep 2026: Approval and
 * Trade went back, and a closed RFI refused the typed text). A field takes
 * the edit's value where the edit stamped it itself (an edit made on this
 * phone just now) or stamped it later than the held copy; every other field
 * keeps the held copy, including fields neither copy stamped, since an edit
 * stamps every field it changes. A field the edit stamped itself wins on the
 * phone even when another device, its clock ahead, stamped it later: the
 * merge kept that value and the field went on showing the unsaved text
 * (whole-app audit A2 pass 5 L3). The cloud's later-stamp rule
 * (mergeProjectControlsRevisions) still decides at upload. With nothing
 * newer held, the edit is returned as is.
 */
export function mergeProjectControlsEdit(
  heldValue: ProjectControls | null | undefined,
  edit: ProjectControls,
): ProjectControls {
  const held = normalizeProjectControls(heldValue);
  const incoming = normalizeProjectControls(edit);
  const stampedHere = fieldsStampedByEdit.get(edit);
  const keptFields = PROJECT_CONTROL_DATA_FIELDS.filter(field => {
    const editRevision = incoming.fieldRevisions?.[field];
    const heldRevision = held.fieldRevisions?.[field];
    const editChangedField = editRevision !== undefined && (
      stampedHere?.has(field) === true ||
      !heldRevision ||
      compareFieldRevisionAuthority(editRevision, heldRevision) > 0
    );
    return !editChangedField &&
      canonicalValue(held[field]) !== canonicalValue(incoming[field]);
  });
  if (keptFields.length === 0) return edit;
  const fieldRevisions = { ...(edit.fieldRevisions || {}) };
  const keptValues: Partial<Pick<ProjectControls, ProjectControlDataField>> = {};
  keptFields.forEach(field => {
    (keptValues as Record<ProjectControlDataField, unknown>)[field] =
      cloneJsonValue(held[field]);
    const heldRevision = held.fieldRevisions?.[field];
    if (heldRevision) fieldRevisions[field] = { ...heldRevision };
    else delete fieldRevisions[field];
  });
  const merged: ProjectControls = {
    ...edit,
    ...keptValues,
    revision: Math.max(edit.revision, held.revision + 1),
    fieldRevisions,
  };
  if (Object.keys(fieldRevisions).length === 0) delete merged.fieldRevisions;
  return merged;
}

/**
 * A task edit as the phone saves it (the first step of its task save): any
 * Project controls laid over the task's held copy, and a single date changed
 * by hand on a task a lookahead moved noted as David's (review N1 M1,
 * scheduleEditWithDateChangedAlone).
 */
export function withProjectControlsEditMerged(
  current: ScheduleItem,
  edit: Partial<ScheduleItem>,
): Partial<ScheduleItem> {
  const next = scheduleEditWithDateChangedAlone(current, edit);
  return next.projectControls
    ? {
        ...next,
        projectControls: mergeProjectControlsEdit(
          current.projectControls,
          next.projectControls,
        ),
      }
    : next;
}

export function createProjectControlChecklistItem({
  label,
  id,
}: {
  label: string;
  id: string;
}): ProjectControlChecklistItem | null {
  const cleanLabel = label.trim();
  const cleanId = id.trim();
  if (!cleanLabel || !cleanId) return null;
  return {
    id: cleanId,
    label: cleanLabel,
    completed: false,
    completedAt: null,
    completedBy: null,
  };
}

export function setProjectControlChecklistCompletion({
  items,
  itemId,
  completed,
  actor,
  now,
}: {
  items: readonly ProjectControlChecklistItem[];
  itemId: string;
  completed: boolean;
  actor: string;
  now: string;
}): ProjectControlChecklistItem[] {
  return items.map(item => item.id === itemId
    ? {
        ...item,
        completed,
        completedAt: completed ? now : null,
        completedBy: completed ? actor.trim() || 'Project manager' : null,
      }
    : { ...item });
}

export function projectControlReadiness(item: ScheduleItem): ProjectControlReadiness {
  const controls = normalizeProjectControls(item.projectControls);
  const missing: string[] = [];
  if (!controls.assignee && !item.owner.trim()) missing.push('assignee');
  if (!controls.trade && !item.contractor.trim()) missing.push('responsible trade');
  if (
    item.status !== 'Complete' &&
    controls.workflowStage !== 'Closed' &&
    !item.finishDate.trim() &&
    !controls.responseDueDate.trim()
  ) {
    missing.push('due date');
  }
  const totalChecks = controls.checklist.length;
  const completedChecks = controls.checklist.filter(check => check.completed).length;
  const checklistComplete = completedChecks === totalChecks;
  const pendingApproval = controls.approvalStatus === 'Pending' ||
    controls.approvalStatus === 'Changes Requested';
  return {
    ready: missing.length === 0 && checklistComplete && !pendingApproval,
    completedChecks,
    totalChecks,
    missing,
    pendingApproval,
  };
}

export function buildVitruviusPortfolioImpact(
  items: readonly ScheduleItem[],
): VitruviusPortfolioImpact {
  return items
    .filter(item => item.isSummary !== true)
    .reduce<VitruviusPortfolioImpact>((summary, item) => {
      const controls = normalizeProjectControls(item.projectControls);
      const completed = scheduleTaskIsComplete(item);
      return {
        itemCount: summary.itemCount + 1,
        costExposure: summary.costExposure +
          (completed ? 0 : controls.estimatedCostImpact || 0),
        taskDelayEstimateDaysTotal: summary.taskDelayEstimateDaysTotal +
          (completed ? 0 : controls.estimatedScheduleImpactDays || 0),
        highConfidenceItemCount: summary.highConfidenceItemCount +
          (!completed &&
          controls.impactConfidence === 'High' &&
          ((controls.estimatedCostImpact || 0) > 0 ||
          (controls.estimatedScheduleImpactDays || 0) > 0) ? 1 : 0),
        pendingApprovalCount: summary.pendingApprovalCount +
          (controls.approvalStatus === 'Pending' ||
          controls.approvalStatus === 'Changes Requested' ? 1 : 0),
        unassignedItemCount: summary.unassignedItemCount +
          (!completed && !controls.assignee && !item.owner.trim() ? 1 : 0),
      };
    }, {
      itemCount: 0,
      costExposure: 0,
      taskDelayEstimateDaysTotal: 0,
      highConfidenceItemCount: 0,
      pendingApprovalCount: 0,
      unassignedItemCount: 0,
    });
}

function checklist(value: unknown): ProjectControlChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const label = text(entry.label);
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label,
      completed: entry.completed === true,
      completedAt: nullableText(entry.completedAt),
      completedBy: nullableText(entry.completedBy),
    }];
  });
}

function linkedRecords(value: unknown): ProjectControlLinkedRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const label = text(entry.label);
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label,
      kind: option(entry.kind, PROJECT_CONTROL_LINK_KINDS, 'Document'),
      revision: nullableText(entry.revision),
    }];
  });
}

function resources(value: unknown): ProjectControlResource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const name = text(entry.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const allocation = nonNegativeNumber(entry.allocationPercent);
    return [{
      id,
      name,
      kind: option(entry.kind, PROJECT_CONTROL_RESOURCE_KINDS, 'Person'),
      allocationPercent: allocation === null ? null : Math.min(100, allocation),
    }];
  });
}

function fieldRevisions(
  value: unknown,
): Partial<Record<ProjectControlDataField, ProjectControlFieldRevision>> {
  if (!isRecord(value)) return {};
  return PROJECT_CONTROL_DATA_FIELDS.reduce<
    Partial<Record<ProjectControlDataField, ProjectControlFieldRevision>>
  >((result, field) => {
    const candidate = value[field];
    if (!isRecord(candidate)) return result;
    const revision = nonNegativeInteger(candidate.revision);
    const updatedAt = text(candidate.updatedAt);
    const updatedBy = text(candidate.updatedBy);
    if (revision === null || !updatedAt || !updatedBy) return result;
    result[field] = { revision, updatedAt, updatedBy };
    return result;
  }, {});
}

function compareProjectControlFieldAuthority(
  left: ProjectControls,
  right: ProjectControls,
  field: ProjectControlDataField,
): number {
  const leftRevision = left.fieldRevisions?.[field];
  const rightRevision = right.fieldRevisions?.[field];
  if (leftRevision && !rightRevision) return 1;
  if (!leftRevision && rightRevision) return -1;
  if (leftRevision && rightRevision) {
    const revisionDifference = compareFieldRevisionAuthority(
      leftRevision,
      rightRevision,
    );
    if (revisionDifference !== 0) return revisionDifference;
  } else {
    const rootDifference = compareProjectControlRootAuthority(left, right);
    if (rootDifference !== 0) return rootDifference;
  }
  return compareText(
    canonicalValue(left[field]),
    canonicalValue(right[field]),
  );
}

function compareProjectControlRootAuthority(
  left: ProjectControls,
  right: ProjectControls,
): number {
  const timeDifference = timestamp(left.updatedAt) - timestamp(right.updatedAt);
  if (timeDifference !== 0) return timeDifference;
  const revisionDifference = left.revision - right.revision;
  if (revisionDifference !== 0) return revisionDifference;
  return compareText(left.updatedBy || '', right.updatedBy || '');
}

function compareFieldRevisionAuthority(
  left: ProjectControlFieldRevision,
  right: ProjectControlFieldRevision,
): number {
  const timeDifference = timestamp(left.updatedAt) - timestamp(right.updatedAt);
  if (timeDifference !== 0) return timeDifference;
  const revisionDifference = left.revision - right.revision;
  if (revisionDifference !== 0) return revisionDifference;
  return compareText(left.updatedBy, right.updatedBy);
}

function latestTimestamp(
  values: readonly (string | null | undefined)[],
): string | null {
  const validValues = values.filter(
    (value): value is string => Boolean(value && Number.isFinite(Date.parse(value))),
  );
  return validValues.sort((left, right) => timestamp(left) - timestamp(right)).at(-1) || null;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function canonicalValue(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = value.flatMap(entry => typeof entry === 'string' ? [entry.trim()] : [])
    .filter(Boolean);
  return [...new Set(values)];
}

function option<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && options.includes(value as T)
    ? value as T
    : fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = nonNegativeNumber(value);
  return number === null ? null : Math.round(number);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
