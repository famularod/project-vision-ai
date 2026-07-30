import type {
  ScheduleDependency,
  ScheduleItem,
} from '../types';
import {
  buildPIEScheduleDependencyNetwork,
  type PIEScheduleDependencyNetwork,
} from './PIEScheduleDependencyNetwork';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';

export type VitruviusScheduleIssueCode =
  | 'dependency_cycle'
  | 'invalid_task_date'
  | 'missing_predecessor'
  | 'missing_predecessor_finish'
  | 'completed_task_locked';

export type VitruviusScheduleIssue = Readonly<{
  code: VitruviusScheduleIssueCode;
  severity: 'error' | 'warning';
  itemId: string | null;
  message: string;
}>;

export type VitruviusScheduleDateChange = Readonly<{
  itemId: string;
  taskName: string;
  predecessorItemIds: string[];
  previousStartDate: string;
  previousFinishDate: string;
  nextStartDate: string;
  nextFinishDate: string;
  reason: string;
}>;

export type VitruviusSchedulePreview = Readonly<{
  items: ScheduleItem[];
  changes: VitruviusScheduleDateChange[];
  issues: VitruviusScheduleIssue[];
  network: PIEScheduleDependencyNetwork;
  safeToApply: boolean;
}>;

export class VitruviusScheduleCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VitruviusScheduleCalculationError';
  }
}

/**
 * Produces a reviewable schedule calculation. It never changes the supplied
 * task records and it never moves work earlier than the PM-authored date.
 */
export function previewVitruviusFinishToStartSchedule(
  sourceItems: readonly ScheduleItem[],
): VitruviusSchedulePreview {
  const network = buildPIEScheduleDependencyNetwork(sourceItems);
  const issues: VitruviusScheduleIssue[] = [];
  const changes: VitruviusScheduleDateChange[] = [];
  const itemsById = new Map<string, ScheduleItem>(
    sourceItems.map(item => [
      item.id,
      {
        ...item,
        dependencies: normalizeScheduleDependencies(item.dependencies),
      },
    ]),
  );

  network.cycles.forEach(cycle => {
    issues.push(Object.freeze({
      code: 'dependency_cycle',
      severity: 'error',
      itemId: cycle[0] || null,
      message: `Dependency cycle includes ${cycle.join(', ')}.`,
    }));
  });
  network.nodes.forEach(node => {
    node.unresolvedPredecessors.forEach(predecessorId => {
      issues.push(Object.freeze({
        code: 'missing_predecessor',
        severity: 'error',
        itemId: node.scheduleItemId,
        message: `${node.taskName} references missing predecessor ${predecessorId}.`,
      }));
    });
  });

  if (network.cycles.length === 0) {
    topologicalScheduleOrder(sourceItems, network).forEach(itemId => {
      const item = itemsById.get(itemId);
      if (!item) return;
      const dependencies = normalizeScheduleDependencies(item.dependencies);
      if (dependencies.length === 0) return;

      const predecessorDates = dependencies.flatMap(dependency => {
        const predecessor = itemsById.get(dependency.predecessorItemId);
        if (!predecessor) return [];
        const finish = parseScheduleDate(predecessor.finishDate);
        if (!finish) {
          issues.push(Object.freeze({
            code: 'missing_predecessor_finish',
            severity: 'error',
            itemId,
            message: `${predecessor.taskName} needs a valid finish date before ${item.taskName} can be calculated.`,
          }));
          return [];
        }
        return [{
          dependency,
          requiredStart: addWorkingDays(nextWorkingDay(finish), dependency.lagDays || 0),
        }];
      });
      if (predecessorDates.length !== dependencies.length) return;

      const requiredStart = predecessorDates.reduce(
        (latest, candidate) => candidate.requiredStart.getTime() > latest.getTime()
          ? candidate.requiredStart
          : latest,
        predecessorDates[0].requiredStart,
      );
      const currentStart = item.startDate.trim()
        ? parseScheduleDate(item.startDate)
        : null;
      if (item.startDate.trim() && !currentStart) {
        issues.push(Object.freeze({
          code: 'invalid_task_date',
          severity: 'error',
          itemId,
          message: `${item.taskName} has an invalid start date.`,
        }));
        return;
      }
      if (currentStart && currentStart.getTime() >= requiredStart.getTime()) return;

      if (scheduleTaskIsComplete(item)) {
        issues.push(Object.freeze({
          code: 'completed_task_locked',
          severity: 'error',
          itemId,
          message: `${item.taskName} is complete and will not be rescheduled automatically.`,
        }));
        return;
      }

      const durationDays = scheduleDurationDays(item, currentStart);
      const nextFinish = item.isMilestone
        ? requiredStart
        : addWorkingDays(requiredStart, Math.max(0, durationDays - 1));
      const nextItem: ScheduleItem = {
        ...item,
        startDate: formatScheduleDate(requiredStart),
        finishDate: formatScheduleDate(nextFinish),
        durationDays,
      };
      itemsById.set(itemId, nextItem);
      changes.push(Object.freeze({
        itemId,
        taskName: item.taskName,
        predecessorItemIds: Object.freeze(
          dependencies.map(dependency => dependency.predecessorItemId),
        ) as unknown as string[],
        previousStartDate: item.startDate,
        previousFinishDate: item.finishDate,
        nextStartDate: nextItem.startDate,
        nextFinishDate: nextItem.finishDate,
        reason: 'Finish-to-start predecessor dates require this task to begin later.',
      }));
    });
  }

  const safeToApply = !issues.some(issue => issue.severity === 'error');
  return Object.freeze({
    items: Object.freeze(
      sourceItems.map(item => itemsById.get(item.id) || item),
    ) as unknown as ScheduleItem[],
    changes: Object.freeze(changes) as unknown as VitruviusScheduleDateChange[],
    issues: Object.freeze(issues) as unknown as VitruviusScheduleIssue[],
    network,
    safeToApply,
  });
}

/**
 * Makes the review boundary explicit. A calculation containing unresolved
 * logic or PM-protected completed work cannot be applied.
 */
export function applyVitruviusSchedulePreview(
  preview: VitruviusSchedulePreview,
): ScheduleItem[] {
  if (!preview.safeToApply) {
    throw new VitruviusScheduleCalculationError(
      'Schedule changes cannot be applied until dependency and date issues are resolved.',
    );
  }
  return preview.items.map(item => ({
    ...item,
    dependencies: normalizeScheduleDependencies(item.dependencies),
  }));
}

export function normalizeScheduleDependencies(
  value: unknown,
): ScheduleDependency[] {
  if (!Array.isArray(value)) return [];
  const byPredecessor = new Map<string, ScheduleDependency>();
  value.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    const record = candidate as Record<string, unknown>;
    const predecessorItemId = typeof record.predecessorItemId === 'string'
      ? record.predecessorItemId.trim()
      : '';
    if (
      !predecessorItemId ||
      byPredecessor.has(predecessorItemId) ||
      (record.type !== undefined && record.type !== null && record.type !== 'FS')
    ) return;
    const lagDays = typeof record.lagDays === 'number' && Number.isFinite(record.lagDays)
      ? Math.max(0, Math.min(365, Math.trunc(record.lagDays)))
      : 0;
    byPredecessor.set(predecessorItemId, Object.freeze({
      predecessorItemId,
      type: 'FS',
      lagDays,
    }));
  });
  return [...byPredecessor.values()];
}

function topologicalScheduleOrder(
  items: readonly ScheduleItem[],
  network: PIEScheduleDependencyNetwork,
) {
  const itemOrder = new Map(items.map((item, index) => [item.id, index]));
  const inDegree = new Map(items.map(item => [item.id, 0]));
  const successors = new Map<string, string[]>();
  network.edges.forEach(edge => {
    if (!inDegree.has(edge.fromScheduleItemId) || !inDegree.has(edge.toScheduleItemId)) return;
    inDegree.set(edge.toScheduleItemId, (inDegree.get(edge.toScheduleItemId) || 0) + 1);
    const existing = successors.get(edge.fromScheduleItemId);
    if (existing) existing.push(edge.toScheduleItemId);
    else successors.set(edge.fromScheduleItemId, [edge.toScheduleItemId]);
  });
  const queue = items
    .filter(item => (inDegree.get(item.id) || 0) === 0)
    .map(item => item.id);
  const result: string[] = [];
  while (queue.length > 0) {
    queue.sort((left, right) =>
      (itemOrder.get(left) || 0) - (itemOrder.get(right) || 0),
    );
    const itemId = queue.shift();
    if (!itemId) break;
    result.push(itemId);
    (successors.get(itemId) || []).forEach(successorId => {
      const nextDegree = (inDegree.get(successorId) || 0) - 1;
      inDegree.set(successorId, nextDegree);
      if (nextDegree === 0) queue.push(successorId);
    });
  }
  return result;
}

function scheduleDurationDays(item: ScheduleItem, parsedStart: Date | null) {
  if (item.isMilestone) return 0;
  if (
    typeof item.durationDays === 'number' &&
    Number.isFinite(item.durationDays) &&
    item.durationDays > 0
  ) {
    return Math.max(1, Math.round(item.durationDays));
  }
  const finish = parseScheduleDate(item.finishDate);
  if (parsedStart && finish && finish.getTime() >= parsedStart.getTime()) {
    return Math.max(1, workingDaySpan(parsedStart, finish));
  }
  return 1;
}

function workingDaySpan(start: Date, finish: Date) {
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= finish.getTime()) {
    if (isWorkingDay(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function nextWorkingDay(value: Date) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  while (!isWorkingDay(next)) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function addWorkingDays(value: Date, days: number) {
  const result = new Date(value.getTime());
  while (!isWorkingDay(result)) result.setUTCDate(result.getUTCDate() + 1);
  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWorkingDay(result)) remaining -= 1;
  }
  return result;
}

function isWorkingDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

function parseScheduleDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const named = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    const rawYear = Number(us[3]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  } else if (named) {
    const monthIndex = MONTHS.findIndex(monthName =>
      monthName.toLowerCase().startsWith(named[1].toLowerCase()),
    );
    if (monthIndex < 0) return null;
    year = Number(named[3]);
    month = monthIndex + 1;
    day = Number(named[2]);
  } else {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

function formatScheduleDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
