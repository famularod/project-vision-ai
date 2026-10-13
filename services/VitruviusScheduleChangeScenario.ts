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
import {
  SCHEDULE_DURATION_RANGE_TEXT,
  scheduleDateRangeText,
  scheduleDayIsSupported,
  scheduleDurationIsSupported,
} from './ScheduleInputLimits';

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
  | 'unsupported_duration'
  | 'date_out_of_range'
  | 'critical_path_unavailable';

export type VitruviusScheduleScenarioIssue = Readonly<{
  code: VitruviusScheduleScenarioIssueCode;
  itemId: string | null;
  message: string;
  /**
   * Set only on a note that does not stop the save: another task whose new
   * dates the calculation cannot give (review pass 1, L2). It is listed so
   * he sees it; it is not something this change did.
   */
  severity?: 'warning';
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
  shownTaskOf,
}: {
  items: readonly ScheduleItem[];
  itemId: string;
  draft: VitruviusScheduleChangeDraft;
  /**
   * Review pass 1, web M1 (6 Oct 2026): the task the schedule shows for a
   * predecessor id, wherever it is filed (null when no task shown answers
   * to it). The scenario is worked out within the edited task's own schedule
   * (the tasks filed under one schedule name), so a predecessor filed under
   * another name was "missing" to it, though it is alive and shown: a task
   * added by hand on the web, filed under its building's name, that starts
   * after a task of a Microsoft Project master filed under the master's own
   * root name. The editor then read "Correct Schedule Issues" until he
   * unticked a link that was right. With this, such a predecessor counts as
   * present, on the dates it has (predecessorsFiledElsewhere). Without it,
   * as before.
   */
  shownTaskOf?: (predecessorId: string) => ScheduleItem | null | undefined;
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
  // The draft's limits are checked before anything is calculated
  // (independent review R08: validation came after the analytics, so a
  // duration of a billion days was walked day by day first).
  const limitIssues = draftLimitIssues(draftedItem, editedItem);
  if (limitIssues.length > 0) {
    return Object.freeze({
      editedItemId: itemId,
      projectName,
      draftedItem,
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
        issues: Object.freeze(limitIssues),
      }),
    });
  }
  const candidateProjectItems = currentProjectItems.map(item =>
    item.id === itemId ? draftedItem : item,
  );
  // Predecessors the schedule shows under another schedule name: there for the calculation, never returned (M1).
  const elsewhere = shownTaskOf
    ? predecessorsFiledElsewhere([...currentProjectItems, draftedItem], editedItem, shownTaskOf)
    : [];
  const elsewhereIds = new Set(elsewhere.map(item => item.id));
  const currentAnalytics = analyzeVitruviusSchedule([...currentProjectItems, ...elsewhere]);
  const candidateAnalytics = analyzeVitruviusSchedule([...candidateProjectItems, ...elsewhere]);
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
  const proposedProjectItems = candidateAnalytics.impactPreview.items
    .filter(item => !elsewhereIds.has(item.id))
    .map(cloneScheduleItem);
  const scenarioIssues = scenarioValidationIssues(draftedItem);
  const engineIssues = candidateAnalytics.impactPreview.issues.map(issue => Object.freeze({
    code: issue.code,
    itemId: issue.itemId,
    message: issue.message,
    ...(issue.severity === 'warning' ? { severity: 'warning' as const } : {}),
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
      // A note about another task does not stop this one from being saved.
      safeToApply:
        !issues.some(issue => issue.severity !== 'warning') &&
        candidateAnalytics.impactPreview.safeToApply &&
        candidateAnalytics.criticalPath.safe,
      issues: Object.freeze(issues),
    }),
  });
}

/**
 * Review pass 1, web M1: the predecessors of a schedule's tasks that are in
 * the schedule shown but filed under another schedule name, each as a fixed
 * row for the calculation: under the id the link names (a link may name a
 * row a master has since replaced; the task's row shown stands for it), on
 * the dates it has, in the edited task's schedule so that the engine and the
 * critical path find it, and with no predecessors of its own (its own
 * schedule places it; this one only starts after it). A predecessor with no
 * finish date is then named as one of the schedule's own would be. Left as
 * before, so still "missing": a predecessor no schedule shows (deleted, or
 * only on a schedule that is not the current one), and a link that names an
 * earlier row of one of this schedule's own tasks, the task itself included.
 */
function predecessorsFiledElsewhere(
  projectItems: readonly ScheduleItem[],
  editedItem: ScheduleItem,
  shownTaskOf: (predecessorId: string) => ScheduleItem | null | undefined,
): ScheduleItem[] {
  const own = new Set(projectItems.map(item => item.id));
  const elsewhere = new Map<string, ScheduleItem>();
  projectItems.forEach(item => {
    normalizeScheduleDependencies(item.dependencies).forEach(dependency => {
      const id = dependency.predecessorItemId;
      if (own.has(id) || elsewhere.has(id)) return;
      const shown = shownTaskOf(id);
      if (!shown || own.has(shown.id)) return;
      elsewhere.set(id, cloneScheduleItem({
        ...shown,
        id,
        scheduleProjectName: editedItem.scheduleProjectName,
        projectName: editedItem.projectName,
        dependencies: [],
      }));
    });
  });
  return [...elsewhere.values()];
}

/**
 * What the draft asks for beyond what the schedule supports: nothing is
 * calculated for it.
 *
 * A date is judged only when the draft changes it (review pass 1, L1). A task
 * already stored with a date outside 2000 through 2100 (an old file, a year
 * mistyped on another device or an earlier build) was judged here every time
 * its editor was open, so it could not be saved for any change, not even a
 * rename, until its date was changed. A milestone's finish is its start and
 * is not judged apart from it.
 */
function draftLimitIssues(
  item: ScheduleItem,
  stored: ScheduleItem,
): VitruviusScheduleScenarioIssue[] {
  const issues: VitruviusScheduleScenarioIssue[] = [];
  if (!item.isMilestone && !scheduleDurationIsSupported(item.durationDays)) {
    issues.push(Object.freeze({
      code: 'unsupported_duration',
      itemId: item.id,
      message: SCHEDULE_DURATION_RANGE_TEXT,
    }));
  }
  ([
    ['Start date', item.startDate, stored.startDate],
    ...(item.isMilestone ? [] : [['Finish date', item.finishDate, stored.finishDate] as const]),
  ] as const).forEach(([label, value, storedValue]) => {
    const day = parseVitruviusScheduleDate(value);
    const storedDay = parseVitruviusScheduleDate(storedValue);
    const changed = !day || !storedDay || day.getTime() !== storedDay.getTime();
    if (day && changed && !scheduleDayIsSupported(day)) {
      issues.push(Object.freeze({
        code: 'date_out_of_range',
        itemId: item.id,
        message: scheduleDateRangeText(label),
      }));
    }
  });
  return issues;
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
