import type { ScheduleItem } from '../types';
import { daysUntilDate, parseFlexibleDate } from '../utils/date';
import {
  normalizeScheduleStatus,
  scheduleProgressIsComplete,
} from './ScheduleProgressInvariant';

export type DAVEProjectScheduleHealth = 'On Track' | 'At Risk' | 'Blocked';

export type ScheduleTaskAccounting = Readonly<{
  total: number;
  complete: number;
  open: number;
  inProgress: number;
  waiting: number;
  notStarted: number;
}>;

export type DAVEProjectScheduleRollup = {
  projectName: string;
  tasks: ScheduleItem[];
  taskCount: number;
  completedCount: number;
  openCount: number;
  overdueCount: number;
  dueSoonCount: number;
  scheduledLaterCount: number;
  undatedCount: number;
  waitingCount: number;
  percentComplete: number;
  forecastFinishDate: string | null;
  health: DAVEProjectScheduleHealth;
  healthReason: string;
};

function sameName(left: string | null | undefined, right: string) {
  return left?.trim().toLowerCase() === right.trim().toLowerCase();
}

export function scheduleTaskDurationWeight(
  item: Readonly<{ durationDays?: unknown; notes?: unknown }>,
) {
  if (typeof item.durationDays === 'number' && item.durationDays > 0) {
    return item.durationDays;
  }

  const notes = typeof item.notes === 'string' ? item.notes : '';
  const legacyDuration = notes.match(/\bDuration:\s*(\d+(?:\.\d+)?)\s+days?\b/i);
  const parsed = legacyDuration ? Number(legacyDuration[1]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function scheduleTaskIsComplete(item: ScheduleItem) {
  return scheduleProgressIsComplete(item);
}

/** One canonical accounting model for every task total shown in the app. */
export function buildScheduleTaskAccounting(
  records: readonly Readonly<{ status: unknown; percentComplete: unknown }>[],
): ScheduleTaskAccounting {
  let complete = 0;
  let inProgress = 0;
  let waiting = 0;
  let notStarted = 0;

  for (const record of records) {
    const status = normalizeScheduleStatus(record.status);
    const numericPercent = typeof record.percentComplete === 'number'
      ? record.percentComplete
      : typeof record.percentComplete === 'string' && record.percentComplete.trim()
        ? Number(record.percentComplete.replace('%', '').trim())
        : Number.NaN;
    const percentComplete = Number.isFinite(numericPercent)
      ? Math.max(0, Math.min(100, Math.round(numericPercent)))
      : 0;

    if (status === 'Complete' && percentComplete === 100) complete += 1;
    else if (status === 'Waiting') waiting += 1;
    else if (status === 'Not Started' && percentComplete === 0) notStarted += 1;
    else inProgress += 1;
  }

  const total = records.length;
  return Object.freeze({
    total,
    complete,
    open: total - complete,
    inProgress,
    waiting,
    notStarted,
  });
}

export function scheduleTasksForParentProject(
  projectName: string,
  items: ScheduleItem[],
) {
  return items.filter(item =>
    sameName(item.scheduleProjectName, projectName) ||
    (!item.scheduleProjectName && sameName(item.projectName, projectName)),
  );
}

export function buildDAVEProjectScheduleRollup({
  projectName,
  items,
  now = new Date(),
}: {
  projectName: string;
  items: ScheduleItem[];
  now?: Date;
}): DAVEProjectScheduleRollup {
  const tasks = scheduleTasksForParentProject(projectName, items);
  const accounting = buildScheduleTaskAccounting(tasks);
  const incompleteTasks = tasks.filter(item => !scheduleTaskIsComplete(item));
  const overdueCount = incompleteTasks.filter(item => {
    const days = daysUntilDate(item.finishDate, now, item.projectTimeZone || undefined);
    return days !== null && days < 0;
  }).length;
  const dueSoonCount = incompleteTasks.filter(item => {
    const days = daysUntilDate(item.finishDate, now, item.projectTimeZone || undefined);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const scheduledLaterCount = incompleteTasks.filter(item => {
    const days = daysUntilDate(item.finishDate, now, item.projectTimeZone || undefined);
    return days !== null && days > 7;
  }).length;
  const undatedCount = incompleteTasks.filter(item =>
    daysUntilDate(item.finishDate, now, item.projectTimeZone || undefined) === null,
  ).length;
  const waitingCount = accounting.waiting;
  const totalWeight = tasks.reduce((total, item) => total + scheduleTaskDurationWeight(item), 0);
  const weightedProgress = tasks.reduce(
    (total, item) => total + scheduleTaskDurationWeight(item) * item.percentComplete,
    0,
  );
  const percentComplete = totalWeight > 0
    ? Math.round(weightedProgress / totalWeight)
    : 0;
  const forecastFinishDate = incompleteTasks
    .map(item => ({ value: item.finishDate, date: parseFlexibleDate(item.finishDate) }))
    .filter((item): item is { value: string; date: Date } => Boolean(item.date))
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0]?.value || null;

  const health: DAVEProjectScheduleHealth = waitingCount > 0
    ? 'Blocked'
    : overdueCount > 0 || dueSoonCount > 0
      ? 'At Risk'
      : 'On Track';
  const healthReason = waitingCount > 0
    ? `${waitingCount} ${waitingCount === 1 ? 'task is' : 'tasks are'} waiting and cannot advance.`
    : overdueCount > 0
      ? `${overdueCount} incomplete ${overdueCount === 1 ? 'task is' : 'tasks are'} overdue.`
      : dueSoonCount > 0
        ? `${dueSoonCount} incomplete ${dueSoonCount === 1 ? 'task is' : 'tasks are'} due within 7 days.`
        : tasks.length > 0
          ? 'No incomplete tasks are overdue or due within 7 days.'
          : 'No schedule tasks are assigned to this project yet.';

  return {
    projectName,
    tasks,
    taskCount: accounting.total,
    completedCount: accounting.complete,
    openCount: accounting.open,
    overdueCount,
    dueSoonCount,
    scheduledLaterCount,
    undatedCount,
    waitingCount,
    percentComplete,
    forecastFinishDate,
    health,
    healthReason,
  };
}
