import type { ScheduleItem } from '../types';
import { projectDateRelativeDays } from './ProjectDateTime';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

export type VitruviusMyWorkAssignmentSource =
  | 'project_controls'
  | 'legacy_owner'
  | 'unassigned';

export type VitruviusMyWorkDueState =
  | 'overdue'
  | 'due_within_7_days'
  | 'later'
  | 'undated';

export type VitruviusMyWorkItem = Readonly<{
  item: ScheduleItem;
  assignment: string;
  assignmentSource: VitruviusMyWorkAssignmentSource;
  daysUntilDue: number | null;
  dueState: VitruviusMyWorkDueState;
}>;

export type VitruviusMyWorkCounts = Readonly<{
  /** Open, non-summary work assigned to the current identity. */
  open: number;
  /** Assigned work with a finish date before today in the project timezone. */
  overdue: number;
  /** Assigned work due today through seven calendar days from today. */
  due7: number;
  /** All open work with neither a project-controls assignee nor legacy owner. */
  unassigned: number;
}>;

export type VitruviusMyWork = Readonly<{
  identityAliases: readonly string[];
  items: readonly VitruviusMyWorkItem[];
  unassignedItems: readonly VitruviusMyWorkItem[];
  counts: VitruviusMyWorkCounts;
}>;

/**
 * Builds a read-only personal work view from fields already carried by the
 * shared task record. Identity matching is exact after case and whitespace
 * normalization; display names and email addresses are never partially
 * matched.
 */
export function buildVitruviusMyWork({
  items,
  displayName,
  email,
  now = new Date(),
}: {
  items: readonly ScheduleItem[];
  displayName?: string | null;
  email?: string | null;
  now?: Date;
}): VitruviusMyWork {
  const identityAliases = uniqueNormalizedValues([displayName, email]);
  const aliasSet = new Set(identityAliases);
  const assignedItems: VitruviusMyWorkItem[] = [];
  const unassignedItems: VitruviusMyWorkItem[] = [];

  for (const item of items) {
    if (item.isSummary === true || scheduleProgressIsComplete(item)) continue;

    const controlsAssignee = cleanText(item.projectControls?.assignee);
    const legacyOwner = cleanText(item.owner);
    const normalizedAssignee = normalizeIdentity(controlsAssignee);
    const normalizedOwner = normalizeIdentity(legacyOwner);
    const daysUntilDue = projectDateRelativeDays(
      item.finishDate,
      now,
      item.projectTimeZone || undefined,
    );
    const dueState = myWorkDueState(daysUntilDue);

    if (!normalizedAssignee && !normalizedOwner) {
      unassignedItems.push(Object.freeze({
        item,
        assignment: '',
        assignmentSource: 'unassigned',
        daysUntilDue,
        dueState,
      }));
      continue;
    }

    if (normalizedAssignee && aliasSet.has(normalizedAssignee)) {
      assignedItems.push(Object.freeze({
        item,
        assignment: controlsAssignee,
        assignmentSource: 'project_controls',
        daysUntilDue,
        dueState,
      }));
      continue;
    }

    // An explicit project-controls assignment is authoritative. Do not keep
    // showing reassigned work to a former legacy owner.
    if (!normalizedAssignee && normalizedOwner && aliasSet.has(normalizedOwner)) {
      assignedItems.push(Object.freeze({
        item,
        assignment: legacyOwner,
        assignmentSource: 'legacy_owner',
        daysUntilDue,
        dueState,
      }));
    }
  }

  assignedItems.sort(compareMyWorkItems);
  unassignedItems.sort(compareMyWorkItems);

  return Object.freeze({
    identityAliases: Object.freeze(identityAliases),
    items: Object.freeze(assignedItems),
    unassignedItems: Object.freeze(unassignedItems),
    counts: Object.freeze({
      open: assignedItems.length,
      overdue: assignedItems.filter(row => row.dueState === 'overdue').length,
      due7: assignedItems.filter(row => row.dueState === 'due_within_7_days').length,
      unassigned: unassignedItems.length,
    }),
  });
}

export function normalizeVitruviusMyWorkIdentity(value: unknown) {
  return normalizeIdentity(value);
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeIdentity(value: unknown) {
  return cleanText(value).normalize('NFKC').toLocaleLowerCase('en-US');
}

function uniqueNormalizedValues(values: readonly unknown[]) {
  return [...new Set(values.map(normalizeIdentity).filter(Boolean))];
}

function myWorkDueState(
  daysUntilDue: number | null,
): VitruviusMyWorkDueState {
  if (daysUntilDue === null) return 'undated';
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 7) return 'due_within_7_days';
  return 'later';
}

function compareMyWorkItems(
  left: VitruviusMyWorkItem,
  right: VitruviusMyWorkItem,
) {
  const dueStateOrder = dueOrder(left.dueState) - dueOrder(right.dueState);
  if (dueStateOrder !== 0) return dueStateOrder;

  const dueDateOrder = (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
    (right.daysUntilDue ?? Number.POSITIVE_INFINITY);
  if (Number.isFinite(dueDateOrder) && dueDateOrder !== 0) return dueDateOrder;

  const projectOrder = projectName(left.item).localeCompare(
    projectName(right.item),
    undefined,
    { numeric: true, sensitivity: 'base' },
  );
  if (projectOrder !== 0) return projectOrder;

  return left.item.taskName.localeCompare(right.item.taskName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function dueOrder(state: VitruviusMyWorkDueState) {
  if (state === 'overdue') return 0;
  if (state === 'due_within_7_days') return 1;
  if (state === 'later') return 2;
  return 3;
}

function projectName(item: ScheduleItem) {
  return item.scheduleProjectName?.trim() || item.projectName.trim();
}
