import type { ScheduleItem } from '../types';
import { buildPIEScheduleDependencyNetwork } from './PIEScheduleDependencyNetwork';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import { scheduleTaskLengthInWorkingDays } from './ScheduleWorkingDays';
import { parseVitruviusScheduleDate } from './VitruviusGanttModel';
import {
  normalizeScheduleDependencies,
  previewVitruviusFinishToStartSchedule,
  scheduleItemsWithPhaseLinksWorkedOut,
  type VitruviusSchedulePreview,
} from './VitruviusScheduleEngine';

/** Every number here is in working days (Monday to Friday), as a typed duration and a lag are. */
export type VitruviusCriticalPathItem = Readonly<{
  itemId: string;
  projectName: string;
  durationDays: number;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  totalFloatDays: number;
  critical: boolean;
}>;

export type VitruviusCriticalPathAnalysis = Readonly<{
  available: boolean;
  safe: boolean;
  items: readonly VitruviusCriticalPathItem[];
  criticalItemIds: ReadonlySet<string>;
  projectDurationDays: Readonly<Record<string, number>>;
  issues: readonly string[];
}>;

export type VitruviusBaselineVarianceStatus =
  | 'late'
  | 'on_plan'
  | 'early'
  | 'no_baseline'
  | 'invalid';

export type VitruviusBaselineVariance = Readonly<{
  itemId: string;
  taskName: string;
  baselineStartDate: string | null;
  baselineFinishDate: string | null;
  currentStartDate: string | null;
  currentFinishDate: string | null;
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  status: VitruviusBaselineVarianceStatus;
}>;

export type VitruviusScheduleAnalytics = Readonly<{
  criticalPath: VitruviusCriticalPathAnalysis;
  baselineVariance: readonly VitruviusBaselineVariance[];
  impactPreview: VitruviusSchedulePreview;
}>;

export function analyzeVitruviusSchedule(
  items: readonly ScheduleItem[],
): VitruviusScheduleAnalytics {
  return Object.freeze({
    criticalPath: analyzeVitruviusCriticalPath(items),
    baselineVariance: Object.freeze(items.map(analyzeBaselineVariance)),
    impactPreview: previewVitruviusFinishToStartSchedule(items),
  });
}

/**
 * The tasks shown that the tasks listed are linked with, through any number of links either way, wherever they are
 * filed (open item 3.4, 14 Oct 2026). With a project chosen at the top, the computer's Schedule page lists the tasks
 * filed under that one schedule name; a link between a task he made by hand (filed under its building's name) and a
 * master's task (filed under the master's own name) leads out of that list.
 */
export function scheduleTasksLinkedWith(
  listed: readonly ScheduleItem[],
  shown: readonly ScheduleItem[],
): ScheduleItem[] {
  const listedIds = new Set(listed.map(item => item.id));
  const shownById = new Map(shown.map(item => [item.id, item]));
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const existing = neighbours.get(from);
    if (existing) existing.push(to);
    else neighbours.set(from, [to]);
  };
  [...listed, ...shown].forEach(item => {
    normalizeScheduleDependencies(item.dependencies).forEach(dependency => {
      link(item.id, dependency.predecessorItemId);
      link(dependency.predecessorItemId, item.id);
    });
  });
  // A phase finishes with the work in it (open item 3.6): a task linked to a phase is linked to that work too.
  shown.forEach(item => {
    const parentId = item.parentItemId?.trim();
    if (parentId && shownById.get(parentId)?.isSummary === true) link(parentId, item.id);
  });
  const linked = new Map<string, ScheduleItem>();
  const queue = [...listedIds];
  while (queue.length > 0) {
    (neighbours.get(queue.shift()!) || []).forEach(id => {
      const item = shownById.get(id);
      if (!item || listedIds.has(id) || linked.has(id)) return;
      linked.set(id, item);
      queue.push(id);
    });
  }
  return [...linked.values()];
}

/**
 * The analytics of the tasks a page lists, worked out with every task shown they are linked with (open item 3.4):
 * the critical path and the calculated dates are those the whole linked schedule gives, and only the listed tasks'
 * marks, rows and date changes are returned. The notes name what is wrong anywhere in what was worked out. With
 * nothing linked outside the list, this is analyzeVitruviusSchedule of the list, as before.
 */
export function analyzeVitruviusListedSchedule(
  listed: readonly ScheduleItem[],
  shown: readonly ScheduleItem[],
): VitruviusScheduleAnalytics {
  const linked = scheduleTasksLinkedWith(listed, shown);
  if (linked.length === 0) return analyzeVitruviusSchedule(listed);
  const listedIds = new Set(listed.map(item => item.id));
  const whole = analyzeVitruviusSchedule([...listed, ...linked]);
  return Object.freeze({
    criticalPath: Object.freeze({
      ...whole.criticalPath,
      items: Object.freeze(whole.criticalPath.items.filter(item => listedIds.has(item.itemId))),
      criticalItemIds: new Set([...whole.criticalPath.criticalItemIds].filter(id => listedIds.has(id))),
    }),
    baselineVariance: Object.freeze(whole.baselineVariance.filter(variance => listedIds.has(variance.itemId))),
    impactPreview: Object.freeze({
      ...whole.impactPreview,
      items: Object.freeze(whole.impactPreview.items.filter(item => listedIds.has(item.id))) as unknown as ScheduleItem[],
      changes: Object.freeze(whole.impactPreview.changes.filter(change => listedIds.has(change.itemId))) as unknown as VitruviusSchedulePreview['changes'],
    }),
  });
}

export function analyzeVitruviusCriticalPath(
  sourceItems: readonly ScheduleItem[],
): VitruviusCriticalPathAnalysis {
  // Open item 3.6 (14 Oct 2026): a task may start after a phase. The phase is the work in it (its tasks and
  // milestones), so a link to it is worked out as links to each of them; a phase with nothing under it yet that a
  // task waits for is counted on its own dates, as a task is. Phases are otherwise no part of the critical path. A
  // link that would make a circle through a phase is named, and holds the critical path. Before, a task that started
  // after a phase held it: "... starts after the phase Sitework, and the critical path counts tasks and milestones only."
  const phaseLinks = scheduleItemsWithPhaseLinksWorkedOut(sourceItems);
  const waitedFor = new Set(phaseLinks.items.flatMap(item =>
    normalizeScheduleDependencies(item.dependencies).map(dependency => dependency.predecessorItemId)));
  const groups = groupProjectTasks(
    phaseLinks.items.filter(item => item.isSummary !== true || waitedFor.has(item.id)),
  );
  const results: VitruviusCriticalPathItem[] = [];
  const projectDurationDays: Record<string, number> = {};
  const sourceItemsById = new Map(sourceItems.map(item => [item.id, item]));
  const issues: string[] = phaseLinks.issues.map(issue =>
    `${scheduleNameOf(sourceItemsById.get(issue.itemId ?? ''))}: ${issue.message}`);
  let calculatedProjectCount = 0;

  groups.forEach(items => {
    const itemIds = new Set(items.map(item => item.id));
    const network = buildPIEScheduleDependencyNetwork(items);
    const nameOf = (itemId: string | undefined) => scheduleNameOf(sourceItemsById.get(itemId ?? ''));
    network.cycles.forEach(cycle => {
      issues.push(`${nameOf(cycle[0])}: dependency cycle includes ${cycle.join(', ')}.`);
    });
    network.nodes.forEach(node => {
      node.unresolvedPredecessors.forEach(predecessorId => {
        issues.push(`${nameOf(node.scheduleItemId)}: ${node.taskName} references missing predecessor ${predecessorId}.`);
      });
    });
    if (network.cycles.length > 0 || network.nodes.some(
      node => node.unresolvedPredecessors.length > 0,
    )) return;
    if (network.edges.length === 0) return;
    calculatedProjectCount += 1;

    const dependencies = new Map<string, ReturnType<typeof normalizeScheduleDependencies>>();
    const successors = new Map<string, Array<{ itemId: string; lagDays: number }>>();
    const inDegree = new Map(items.map(item => [item.id, 0]));
    items.forEach(item => {
      const valid = normalizeScheduleDependencies(item.dependencies)
        .filter(dependency => itemIds.has(dependency.predecessorItemId));
      dependencies.set(item.id, valid);
      valid.forEach(dependency => {
        inDegree.set(item.id, (inDegree.get(item.id) || 0) + 1);
        const existing = successors.get(dependency.predecessorItemId);
        const successor = { itemId: item.id, lagDays: dependency.lagDays || 0 };
        if (existing) existing.push(successor);
        else successors.set(dependency.predecessorItemId, [successor]);
      });
    });
    const queue = items
      .filter(item => (inDegree.get(item.id) || 0) === 0)
      .map(item => item.id);
    const order: string[] = [];
    while (queue.length > 0) {
      queue.sort();
      const itemId = queue.shift();
      if (!itemId) break;
      order.push(itemId);
      (successors.get(itemId) || []).forEach(successor => {
        const next = (inDegree.get(successor.itemId) || 0) - 1;
        inDegree.set(successor.itemId, next);
        if (next === 0) queue.push(successor.itemId);
      });
    }
    if (order.length !== items.length) {
      issues.push(`${scheduleNameOf(items[0])}: the dependency order could not be calculated.`);
      return;
    }

    const itemsById = new Map(items.map(item => [item.id, item]));
    const earliestStart = new Map<string, number>();
    const earliestFinish = new Map<string, number>();
    order.forEach(itemId => {
      const predecessorFinish = (dependencies.get(itemId) || []).map(dependency =>
        (earliestFinish.get(dependency.predecessorItemId) || 0) +
        (dependency.lagDays || 0),
      );
      const start = predecessorFinish.length > 0 ? Math.max(...predecessorFinish) : 0;
      const finish = start + criticalPathDuration(itemsById.get(itemId)!);
      earliestStart.set(itemId, start);
      earliestFinish.set(itemId, finish);
    });
    const projectDuration = Math.max(0, ...earliestFinish.values());
    // Each schedule name's own finish within the calculation (two names linked are worked out together, 3.4).
    items.forEach(item => {
      const name = scheduleNameOf(item);
      projectDurationDays[name] = Math.max(projectDurationDays[name] ?? 0, earliestFinish.get(item.id) || 0);
    });
    const latestStart = new Map<string, number>();
    const latestFinish = new Map<string, number>();
    [...order].reverse().forEach(itemId => {
      const nextItems = successors.get(itemId) || [];
      const finish = nextItems.length > 0
        ? Math.min(...nextItems.map(successor =>
            (latestStart.get(successor.itemId) ?? projectDuration) - successor.lagDays,
          ))
        : projectDuration;
      const start = finish - criticalPathDuration(itemsById.get(itemId)!);
      latestFinish.set(itemId, finish);
      latestStart.set(itemId, start);
    });
    order.forEach(itemId => {
      const item = itemsById.get(itemId)!;
      const totalFloatDays = Math.max(
        0,
        (latestStart.get(itemId) || 0) - (earliestStart.get(itemId) || 0),
      );
      results.push(Object.freeze({
        itemId,
        projectName: scheduleNameOf(item),
        durationDays: criticalPathDuration(item),
        earliestStart: earliestStart.get(itemId) || 0,
        earliestFinish: earliestFinish.get(itemId) || 0,
        latestStart: latestStart.get(itemId) || 0,
        latestFinish: latestFinish.get(itemId) || 0,
        totalFloatDays,
        critical: totalFloatDays === 0,
      }));
    });
  });

  return Object.freeze({
    available: calculatedProjectCount > 0,
    safe: issues.length === 0,
    items: Object.freeze(results),
    criticalItemIds: new Set(
      results
        .filter(item => {
          const sourceItem = sourceItemsById.get(item.itemId);
          return item.critical && sourceItem && !scheduleProgressIsComplete(sourceItem);
        })
        .map(item => item.itemId),
    ),
    projectDurationDays: Object.freeze(projectDurationDays),
    issues: Object.freeze(issues),
  });
}

export function analyzeBaselineVariance(
  item: ScheduleItem,
): VitruviusBaselineVariance {
  const baselineStart = parseVitruviusScheduleDate(item.baselineStartDate);
  const baselineFinish = parseVitruviusScheduleDate(item.baselineFinishDate);
  const currentStart = parseVitruviusScheduleDate(item.startDate);
  const currentFinish = parseVitruviusScheduleDate(item.finishDate);
  if (!item.baselineStartDate?.trim() && !item.baselineFinishDate?.trim()) {
    return varianceResult(item, null, null, currentStart, currentFinish, null, null, 'no_baseline');
  }
  if (!baselineStart || !baselineFinish || !currentStart || !currentFinish) {
    return varianceResult(
      item,
      baselineStart,
      baselineFinish,
      currentStart,
      currentFinish,
      null,
      null,
      'invalid',
    );
  }
  const startVarianceDays = calendarDaysBetween(baselineStart, currentStart);
  const finishVarianceDays = calendarDaysBetween(baselineFinish, currentFinish);
  const greatestDelay = Math.max(startVarianceDays, finishVarianceDays);
  const earliestGain = Math.min(startVarianceDays, finishVarianceDays);
  return varianceResult(
    item,
    baselineStart,
    baselineFinish,
    currentStart,
    currentFinish,
    startVarianceDays,
    finishVarianceDays,
    greatestDelay > 0 ? 'late' : earliestGain < 0 ? 'early' : 'on_plan',
  );
}

function varianceResult(
  item: ScheduleItem,
  baselineStart: Date | null,
  baselineFinish: Date | null,
  currentStart: Date | null,
  currentFinish: Date | null,
  startVarianceDays: number | null,
  finishVarianceDays: number | null,
  status: VitruviusBaselineVarianceStatus,
): VitruviusBaselineVariance {
  return Object.freeze({
    itemId: item.id,
    taskName: item.taskName,
    baselineStartDate: formatDate(baselineStart),
    baselineFinishDate: formatDate(baselineFinish),
    currentStartDate: formatDate(currentStart),
    currentFinishDate: formatDate(currentFinish),
    startVarianceDays,
    finishVarianceDays,
    status,
  });
}

/**
 * The tasks of each schedule name, worked out together. Open item 3.4 (14 Oct 2026): schedule names that a link
 * joins are one group, so a link between a task he made by hand (filed under its building's name) and a master's
 * task (filed under the master's own name) counts like any other. It read "references missing predecessor <id>",
 * and the critical path was unavailable.
 */
function groupProjectTasks(items: readonly ScheduleItem[]) {
  const itemsById = new Map(items.map(item => [item.id, item]));
  const joinedTo = new Map<string, string>();
  const groupOf = (name: string): string => {
    const next = joinedTo.get(name);
    return next === undefined || next === name ? name : groupOf(next);
  };
  items.forEach(item => {
    const name = scheduleNameOf(item);
    if (!joinedTo.has(name)) joinedTo.set(name, name);
  });
  items.forEach(item => {
    normalizeScheduleDependencies(item.dependencies).forEach(dependency => {
      const predecessor = itemsById.get(dependency.predecessorItemId);
      if (!predecessor) return;
      const left = groupOf(scheduleNameOf(item));
      const right = groupOf(scheduleNameOf(predecessor));
      if (left !== right) joinedTo.set(right, left);
    });
  });
  const groups = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const group = groupOf(scheduleNameOf(item));
    const members = groups.get(group);
    if (members) members.push(item);
    else groups.set(group, [item]);
  });
  return groups;
}

function scheduleNameOf(item: ScheduleItem | undefined) {
  return item?.scheduleProjectName?.trim() || item?.projectName?.trim() || 'Unassigned Project';
}

/**
 * A task's length on the critical path, in working days, by the one rule
 * rescheduling uses too (the owner's answer to question 41, 13 Oct 2026).
 * This counted every calendar day, so a task from a Friday to the Monday
 * with no length typed in was 4 days here and 2 when it was rescheduled.
 */
function criticalPathDuration(item: ScheduleItem) {
  return scheduleTaskLengthInWorkingDays(
    item,
    parseVitruviusScheduleDate(item.startDate),
    parseVitruviusScheduleDate(item.finishDate),
  );
}

/** The days between two dates (how far a date is from its baseline): calendar days. Not a task's length. */
function calendarDaysBetween(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}
