import type { ScheduleItem } from '../types';
import { formatAppDate, parseFlexibleDate } from '../utils/date';
import {
  reconcileScheduleProgress,
  scheduleProgressIsComplete,
} from './ScheduleProgressInvariant';

export type DAVETaskAreaWarning = Readonly<{
  taskId: string;
  taskName: string;
  message: string;
}>;

export type DAVETaskAreaWorkItem = Readonly<{
  taskId: string;
  taskName: string;
  percentComplete: number;
  statusLabel: string;
  startDateLabel: string;
  finishDateLabel: string;
}>;

export type DAVETaskAreaSummary = Readonly<{
  projectName: string;
  areaName: string;
  taskCount: number;
  openCount: number;
  inProgressCount: number;
  completeCount: number;
  overdueCount: number;
  missingStartCount: number;
  missingFinishCount: number;
  earliestStartLabel: string;
  latestFinishLabel: string;
  workItems: DAVETaskAreaWorkItem[];
  warnings: DAVETaskAreaWarning[];
}>;

function normalizedDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateLabel(value: string, missingLabel: string) {
  return value.trim() ? formatAppDate(value) : missingLabel;
}

export function buildDAVETaskAreaSummary({
  projectName,
  areaName,
  tasks,
  now = new Date(),
}: {
  projectName: string;
  areaName: string;
  tasks: ScheduleItem[];
  now?: Date;
}): DAVETaskAreaSummary {
  const today = normalizedDay(now);
  const warnings: DAVETaskAreaWarning[] = [];
  const validStarts: Date[] = [];
  const validFinishes: Date[] = [];
  let completeCount = 0;
  let inProgressCount = 0;
  let overdueCount = 0;
  let missingStartCount = 0;
  let missingFinishCount = 0;

  const workItems = tasks.map(item => {
    const progress = reconcileScheduleProgress(item.status, item.percentComplete);
    const rawStart = item.startDate.trim();
    const rawFinish = item.finishDate.trim();
    const start = rawStart ? parseFlexibleDate(rawStart) : null;
    const finish = rawFinish ? parseFlexibleDate(rawFinish) : null;
    const complete = scheduleProgressIsComplete(progress);

    if (!rawStart) missingStartCount += 1;
    else if (!start) {
      warnings.push({
        taskId: item.id,
        taskName: item.taskName,
        message: `Start date “${rawStart}” is not a valid calendar date.`,
      });
    } else validStarts.push(start);

    if (!rawFinish) missingFinishCount += 1;
    else if (!finish) {
      warnings.push({
        taskId: item.id,
        taskName: item.taskName,
        message: `Finish / due date “${rawFinish}” is not a valid calendar date.`,
      });
    } else validFinishes.push(finish);

    if (start && finish && start.getTime() > finish.getTime()) {
      warnings.push({
        taskId: item.id,
        taskName: item.taskName,
        message: `Start ${formatAppDate(rawStart)} is after finish ${formatAppDate(rawFinish)}.`,
      });
    }

    if (!complete && finish && finish.getTime() < today.getTime()) {
      overdueCount += 1;
      warnings.push({
        taskId: item.id,
        taskName: item.taskName,
        message: `Past due since ${formatAppDate(rawFinish)} at ${progress.percentComplete}% complete.`,
      });
    }

    if (complete) completeCount += 1;
    else if (progress.status === 'In Progress') inProgressCount += 1;

    return Object.freeze({
      taskId: item.id,
      taskName: item.taskName,
      percentComplete: progress.percentComplete,
      statusLabel: progress.status,
      startDateLabel: dateLabel(rawStart, 'Start not set'),
      finishDateLabel: dateLabel(rawFinish, 'Finish / due not set'),
    });
  });

  const earliestStart = validStarts.sort((left, right) => left.getTime() - right.getTime())[0];
  const latestFinish = validFinishes.sort((left, right) => right.getTime() - left.getTime())[0];

  return Object.freeze({
    projectName,
    areaName,
    taskCount: tasks.length,
    openCount: tasks.length - completeCount,
    inProgressCount,
    completeCount,
    overdueCount,
    missingStartCount,
    missingFinishCount,
    earliestStartLabel: earliestStart ? formatAppDate(earliestStart.toISOString().slice(0, 10)) : 'Not set',
    latestFinishLabel: latestFinish ? formatAppDate(latestFinish.toISOString().slice(0, 10)) : 'Not set',
    workItems,
    warnings,
  });
}
