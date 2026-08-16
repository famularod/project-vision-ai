import type { ScheduleDependency, ScheduleItem } from '../types';
import {
  analyzeVitruviusSchedule,
  type VitruviusScheduleAnalytics,
} from './VitruviusScheduleAnalytics';
import {
  normalizeScheduleDependencies,
  type VitruviusScheduleIssueCode,
} from './VitruviusScheduleEngine';
import { parseVitruviusScheduleDate } from './VitruviusGanttModel';

export type VitruviusScheduleChangeDraft = Readonly<
  Partial<
    Pick<
      ScheduleItem,
      | 'startDate'
      | 'finishDate'
      | 'durationDays'
      | 'dependencies'
      | 'isMilestone'
      | 'status'
      | 'percentComplete'
    >
  >
>;

export type VitruviusScheduleScenarioIssueCode =
  | VitruviusScheduleIssueCode
  | 'edited_item_missing'
  | 'invalid_start_date'
  | 'invalid_finish_date'
  | 'finish_before_start'
  | 'critical_path_unavailable';

export type VitruviusScheduleScenarioIssue = Readonly<{
  code: VitruviusScheduleScenarioIssueCode;
  itemId: string | null;
  message: string;
}>;

export type VitruviusScheduleScenarioTaskChange = Readonly<{
  itemId: string;
  taskName: string;
  previousStartDate: string;
  previousFinishDate: string;
  nextStartDate: string;
  nextFinishDate: string;
}>;

export type VitruviusScheduleScenarioProjectFinish = Readonly<{
  before: string | null;
  after: string | null;
  deltaCalendarDays: number | null;
}>;

export type VitruviusScheduleScenarioCriticalPath = Readonly<{
  beforeItemIds: readonly string[];
  afterItemIds: readonly string[];
  enteredItemIds: readonly string[];
  exitedItemIds: readonly string[];
}>;

export type VitruviusScheduleChangeScenario = Readonly<{
  editedItemId: string;
  projectName: string | null;
  draftedItem: ScheduleItem | null;
  proposedProjectItems: readonly ScheduleItem[];
  downstreamChanges: readonly VitruviusScheduleScenarioTaskChange[];
  projectFinish: VitruviusScheduleScenarioProjectFinish;
  criticalPath: VitruviusScheduleScenarioCriticalPath;
  safety: Readonly<{
    safeToApply: boolean;
    issues: readonly VitruviusScheduleScenarioIssue[];
  }>;
}>;

/**
 * Builds a review-only schedule scenario for one task and one project.
 *
 * The function never mutates its input. It also never returns records from a
 * different project, so a future integration cannot accidentally apply a
 * project-wide preview across portfolio boundaries.
 */
export function buildVitruviusScheduleChangeScenario({
  items,
  itemId,
  draft,
}: {
  items: readonly ScheduleItem[];
  itemId: string;
  draft: VitruviusScheduleChangeDraft;
}): VitruviusScheduleChangeScenario {
  const editedItem = items.find(item => item.id === itemId);
  if (!editedItem) {
    return Object.freeze({
      editedItemId: itemId,
      projectName: null,
      draftedItem: null,
      proposedProjectItems: Object.freeze([]),
      downstreamChanges: Object.freeze([]),
      projectFinish: Object.freeze({
        before: null,
        after: null,
        deltaCalendarDays: null,
      }),
      criticalPath: emptyCriticalPathSummary(),
      safety: Object.freeze({
        safeToApply: false,
        issues: Object.freeze([Object.freeze({
          code: 'edited_item_missing' as const,
          itemId,
          message: `Schedule item ${itemId} no longer exists.`,
        })]),
      }),
    });
  }

  const projectName = scheduleProjectName(editedItem);
  const currentProjectItems = items
    .filter(item => scheduleProjectName(item) === projectName)
    .map(cloneScheduleItem);
  const draftedItem = cloneScheduleItem({
    ...editedItem,
    ...draft,
    dependencies: draft.dependencies === undefined
      ? editedItem.dependencies
      : normalizeScheduleDependencies(draft.dependencies),
  });
  const candidateProjectItems = currentProjectItems.map(item =>
    item.id === itemId ? draftedItem : item,
  );
  const currentAnalytics = analyzeVitruviusSchedule(currentProjectItems);
  const candidateAnalytics = analyzeVitruviusSchedule(candidateProjectItems);
  const descendantIds = dependencyDescendantIds(itemId, candidateProjectItems);
  const downstreamChanges = candidateAnalytics.impactPreview.changes
    .filter(change => descendantIds.has(change.itemId))
    .map(change => Object.freeze({
      itemId: change.itemId,
      taskName: change.taskName,
      previousStartDate: change.previousStartDate,
      previousFinishDate: change.previousFinishDate,
      nextStartDate: change.nextStartDate,
      nextFinishDate: change.nextFinishDate,
    }));
  const proposedProjectItems = candidateAnalytics.impactPreview.items.map(cloneScheduleItem);
  const scenarioIssues = scenarioValidationIssues(draftedItem);
  const engineIssues = candidateAnalytics.impactPreview.issues.map(issue => Object.freeze({
    code: issue.code,
    itemId: issue.itemId,
    message: issue.message,
  }));
  const criticalIssues = candidateAnalytics.criticalPath.safe
    ? []
    : candidateAnalytics.criticalPath.issues.map(message => Object.freeze({
        code: 'critical_path_unavailable' as const,
        itemId: null,
        message,
      }));
  const issues = dedupeIssues([
    ...scenarioIssues,
    ...engineIssues,
    ...criticalIssues,
  ]);

  return Object.freeze({
    editedItemId: itemId,
    projectName,
    draftedItem,
    proposedProjectItems: Object.freeze(proposedProjectItems),
    downstreamChanges: Object.freeze(downstreamChanges),
    projectFinish: projectFinishSummary(currentProjectItems, proposedProjectItems),
    criticalPath: criticalPathSummary(
      currentAnalytics,
      candidateAnalytics,
      currentProjectItems,
      proposedProjectItems,
    ),
    safety: Object.freeze({
      safeToApply:
        issues.length === 0 &&
        candidateAnalytics.impactPreview.safeToApply &&
        candidateAnalytics.criticalPath.safe,
      issues: Object.freeze(issues),
    }),
  });
}

function scenarioValidationIssues(
  item: ScheduleItem,
): VitruviusScheduleScenarioIssue[] {
  const issues: VitruviusScheduleScenarioIssue[] = [];
  const start = parseVitruviusScheduleDate(item.startDate);
  const finish = parseVitruviusScheduleDate(item.finishDate);
  if (item.startDate.trim() && !start) {
    issues.push(Object.freeze({
      code: 'invalid_start_date',
      itemId: item.id,
      message: `${item.taskName} has an invalid start date.`,
    }));
  }
  if (item.finishDate.trim() && !finish) {
    issues.push(Object.freeze({
      code: 'invalid_finish_date',
      itemId: item.id,
      message: `${item.taskName} has an invalid finish date.`,
    }));
  }
  if (start && finish && finish.getTime() < start.getTime()) {
    issues.push(Object.freeze({
      code: 'finish_before_start',
      itemId: item.id,
      message: `${item.taskName} finishes before it starts.`,
    }));
  }
  return issues;
}

function criticalPathSummary(
  current: VitruviusScheduleAnalytics,
  candidate: VitruviusScheduleAnalytics,
  currentItems: readonly ScheduleItem[],
  candidateItems: readonly ScheduleItem[],
): VitruviusScheduleScenarioCriticalPath {
  const beforeItemIds = orderedSetValues(
    current.criticalPath.criticalItemIds,
    currentItems,
  );
  const afterItemIds = orderedSetValues(
    candidate.criticalPath.criticalItemIds,
    candidateItems,
  );
  const before = new Set(beforeItemIds);
  const after = new Set(afterItemIds);
  return Object.freeze({
    beforeItemIds: Object.freeze(beforeItemIds),
    afterItemIds: Object.freeze(afterItemIds),
    enteredItemIds: Object.freeze(afterItemIds.filter(id => !before.has(id))),
    exitedItemIds: Object.freeze(beforeItemIds.filter(id => !after.has(id))),
  });
}

function emptyCriticalPathSummary(): VitruviusScheduleScenarioCriticalPath {
  return Object.freeze({
    beforeItemIds: Object.freeze([]),
    afterItemIds: Object.freeze([]),
    enteredItemIds: Object.freeze([]),
    exitedItemIds: Object.freeze([]),
  });
}

function orderedSetValues(
  values: ReadonlySet<string>,
  items: readonly ScheduleItem[],
) {
  return items.flatMap(item => values.has(item.id) ? [item.id] : []);
}

function projectFinishSummary(
  beforeItems: readonly ScheduleItem[],
  afterItems: readonly ScheduleItem[],
): VitruviusScheduleScenarioProjectFinish {
  const beforeDate = latestProjectFinish(beforeItems);
  const afterDate = latestProjectFinish(afterItems);
  return Object.freeze({
    before: formatIsoDate(beforeDate),
    after: formatIsoDate(afterDate),
    deltaCalendarDays: beforeDate && afterDate
      ? Math.round((afterDate.getTime() - beforeDate.getTime()) / 86_400_000)
      : null,
  });
}

function latestProjectFinish(items: readonly ScheduleItem[]) {
  const finishes = items
    .filter(item => item.isSummary !== true)
    .flatMap(item => {
      const value = parseVitruviusScheduleDate(
        item.finishDate || (item.isMilestone ? item.startDate : ''),
      );
      return value ? [value] : [];
    });
  return finishes.length > 0
    ? new Date(Math.max(...finishes.map(date => date.getTime())))
    : null;
}

function dependencyDescendantIds(
  itemId: string,
  items: readonly ScheduleItem[],
) {
  const successors = new Map<string, string[]>();
  items.forEach(item => {
    normalizeScheduleDependencies(item.dependencies).forEach(dependency => {
      const existing = successors.get(dependency.predecessorItemId);
      if (existing) existing.push(item.id);
      else successors.set(dependency.predecessorItemId, [item.id]);
    });
  });
  const result = new Set<string>();
  const queue = [...(successors.get(itemId) || [])];
  while (queue.length > 0) {
    const successorId = queue.shift();
    if (!successorId || result.has(successorId)) continue;
    result.add(successorId);
    queue.push(...(successors.get(successorId) || []));
  }
  return result;
}

function dedupeIssues(
  issues: readonly VitruviusScheduleScenarioIssue[],
) {
  const byKey = new Map<string, VitruviusScheduleScenarioIssue>();
  issues.forEach(issue => {
    const key = `${issue.code}:${issue.itemId || ''}:${issue.message}`;
    if (!byKey.has(key)) byKey.set(key, issue);
  });
  return [...byKey.values()];
}

function cloneScheduleItem(item: ScheduleItem): ScheduleItem {
  const dependencies = cloneDependencies(item.dependencies);
  return Object.freeze({
    ...item,
    dependencies,
    activity: item.activity?.map(entry => ({ ...entry })),
    completionVerification: item.completionVerification
      ? {
          ...item.completionVerification,
          evidence: item.completionVerification.evidence.map(entry => ({ ...entry })),
        }
      : item.completionVerification,
  });
}

function cloneDependencies(
  dependencies: readonly ScheduleDependency[] | null | undefined,
) {
  return dependencies?.map(dependency => Object.freeze({ ...dependency }));
}

function scheduleProjectName(item: ScheduleItem) {
  return item.scheduleProjectName?.trim() ||
    item.projectName?.trim() ||
    'Unassigned Project';
}

function formatIsoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}
