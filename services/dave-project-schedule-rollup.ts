import type { ScheduleItem } from '../types';
import { parseFlexibleDate } from '../utils/date';

export type DAVEProjectScheduleHealth = 'On Track' | 'At Risk' | 'Blocked';

export type DAVEProjectScheduleRollup = {
  projectName: string;
  tasks: ScheduleItem[];
  taskCount: number;
  completedCount: number;
  overdueCount: number;
  dueSoonCount: number;
  waitingCount: number;
  percentComplete: number;
  forecastFinishDate: string | null;
  health: DAVEProjectScheduleHealth;
  healthReason: string;
};

function sameName(left: string | null | undefined, right: string) {
  return left?.trim().toLowerCase() === right.trim().toLowerCase();
}

function taskDurationWeight(item: ScheduleItem) {
  if (typeof item.durationDays === 'number' && item.durationDays > 0) {
    return item.durationDays;
  }

  const legacyDuration = item.notes.match(/\bDuration:\s*(\d+(?:\.\d+)?)\s+days?\b/i);
  const parsed = legacyDuration ? Number(legacyDuration[1]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function relativeDays(value: string, now: Date) {
  const date = parseFlexibleDate(value);
  if (!date) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - start.getTime()) / 86_400_000);
}

export function scheduleTaskIsComplete(item: ScheduleItem) {
  return item.status === 'Complete' || item.percentComplete >= 100;
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
  const incompleteTasks = tasks.filter(item => !scheduleTaskIsComplete(item));
  const completedCount = tasks.length - incompleteTasks.length;
  const overdueCount = incompleteTasks.filter(item => {
    const days = relativeDays(item.finishDate, now);
    return days !== null && days < 0;
  }).length;
  const dueSoonCount = incompleteTasks.filter(item => {
    const days = relativeDays(item.finishDate, now);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const waitingCount = incompleteTasks.filter(item => item.status === 'Waiting').length;
  const totalWeight = tasks.reduce((total, item) => total + taskDurationWeight(item), 0);
  const weightedProgress = tasks.reduce(
    (total, item) => total + taskDurationWeight(item) * item.percentComplete,
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
    taskCount: tasks.length,
    completedCount,
    overdueCount,
    dueSoonCount,
    waitingCount,
    percentComplete,
    forecastFinishDate,
    health,
    healthReason,
  };
}
