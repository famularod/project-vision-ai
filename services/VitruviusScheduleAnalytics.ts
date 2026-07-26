import type { ScheduleItem } from '../types';
import { buildPIEScheduleDependencyNetwork } from './PIEScheduleDependencyNetwork';
import { parseVitruviusScheduleDate } from './VitruviusGanttModel';
import {
  normalizeScheduleDependencies,
  previewVitruviusFinishToStartSchedule,
  type VitruviusSchedulePreview,
} from './VitruviusScheduleEngine';

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

export function analyzeVitruviusCriticalPath(
  sourceItems: readonly ScheduleItem[],
): VitruviusCriticalPathAnalysis {
  const groups = groupProjectTasks(
    sourceItems.filter(item => item.isSummary !== true),
  );
  const results: VitruviusCriticalPathItem[] = [];
  const issues: string[] = [];
  const projectDurationDays: Record<string, number> = {};

  groups.forEach((items, projectName) => {
    const itemIds = new Set(items.map(item => item.id));
    const network = buildPIEScheduleDependencyNetwork(items);
    network.cycles.forEach(cycle => {
      issues.push(`${projectName}: dependency cycle includes ${cycle.join(', ')}.`);
    });
    network.nodes.forEach(node => {
      node.unresolvedPredecessors.forEach(predecessorId => {
        issues.push(
          `${projectName}: ${node.taskName} references missing predecessor ${predecessorId}.`,
        );
      });
    });
    if (network.cycles.length > 0 || network.nodes.some(
      node => node.unresolvedPredecessors.length > 0,
    )) return;

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
      issues.push(`${projectName}: the dependency order could not be calculated.`);
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
    projectDurationDays[projectName] = projectDuration;
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
        projectName,
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
    safe: issues.length === 0,
    items: Object.freeze(results),
    criticalItemIds: new Set(
      results.filter(item => item.critical).map(item => item.itemId),
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

function groupProjectTasks(items: readonly ScheduleItem[]) {
  const groups = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const projectName = item.scheduleProjectName?.trim() || item.projectName?.trim() ||
      'Unassigned Project';
    const group = groups.get(projectName);
    if (group) group.push(item);
    else groups.set(projectName, [item]);
  });
  return groups;
}

function criticalPathDuration(item: ScheduleItem) {
  if (item.isMilestone) return 0;
  if (
    typeof item.durationDays === 'number' &&
    Number.isFinite(item.durationDays) &&
    item.durationDays > 0
  ) {
    return Math.max(1, Math.round(item.durationDays));
  }
  const start = parseVitruviusScheduleDate(item.startDate);
  const finish = parseVitruviusScheduleDate(item.finishDate);
  return start && finish && finish.getTime() >= start.getTime()
    ? Math.max(1, calendarDaysBetween(start, finish) + 1)
    : 1;
}

function calendarDaysBetween(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}
