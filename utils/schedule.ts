import type {
  ProjectUpdate,
  ScheduleItem,
  SchedulePriority,
} from '../types';
import {
  daysUntilDate,
  formatDueDate,
  parseDueDate,
  dueStatusText,
} from './date';

export type ScheduleSummaryTask = {
  item: ScheduleItem;
  title: string;
  projectName: string;
  areaName: string;
  dueLabel: string;
  daysUntilDue: number | null;
  isCompleted: boolean;
  isMilestone: boolean;
  isOverdue: boolean;
  isUpcoming7: boolean;
  isUpcoming14: boolean;
  isUpcoming30: boolean;
  isMissingProject: boolean;
  isMissingArea: boolean;
};

export type ScheduleSummaryGroup = {
  name: string;
  count: number;
  overdueCount: number;
  upcoming30Count: number;
  completedCount: number;
};

export type ScheduleSummary = {
  totalItems: number;
  milestoneCount: number;
  overdueCount: number;
  upcoming7Count: number;
  upcoming14Count: number;
  upcoming30Count: number;
  completedCount: number;
  missingProjectCount: number;
  missingAreaCount: number;
  missingMappingCount: number;
  upcomingTasks: ScheduleSummaryTask[];
  upcoming7Tasks: ScheduleSummaryTask[];
  upcoming14Tasks: ScheduleSummaryTask[];
  upcoming30Tasks: ScheduleSummaryTask[];
  overdueTasks: ScheduleSummaryTask[];
  completedTasks: ScheduleSummaryTask[];
  milestoneTasks: ScheduleSummaryTask[];
  criticalPathItems: ScheduleSummaryTask[];
  missingMappingTasks: ScheduleSummaryTask[];
  byProject: ScheduleSummaryGroup[];
  byArea: ScheduleSummaryGroup[];
};

function isActionCategory(category: string) {
  return category === 'Open Issue' || category === 'Safety Concern';
}

function isOpenActionPhoto(photo: ProjectUpdate['photos'][number]) {
  return (
    isActionCategory(photo.category) &&
    photo.actionStatus !== 'Closed' &&
    Boolean(
      photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    )
  );
}

export function actionItemsFromUpdates(savedUpdates: ProjectUpdate[]) {
  return savedUpdates.flatMap(update =>
    update.photos
      .filter(isOpenActionPhoto)
      .map(photo => ({
        id: `${update.id}-${photo.id}`,
        projectName: update.projectName,
        locationName: photo.selectedAreaName || update.selectedAreaName || '',
        taskName: photo.actionRequired || photo.caption || photo.category,
        owner: photo.actionOwner,
        finishDate: photo.actionDueDate,
        status: photo.actionStatus,
        dueLabel: photo.actionDueDate
          ? formatDueDate(photo.actionDueDate)
          : 'No due date',
      }))
      .filter(item => item.finishDate && parseDueDate(item.finishDate)),
  );
}

export function schedulePriorityForDate(finishDate: string): SchedulePriority {
  const days = daysUntilDate(finishDate);

  if (days !== null && days <= 7) return 'High';

  return 'Medium';
}

export function sortedScheduleItems(scheduleItems: ScheduleItem[]) {
  return [...scheduleItems].sort((a, b) => {
    const aDays = daysUntilDate(a.finishDate);
    const bDays = daysUntilDate(b.finishDate);

    if (aDays === null && bDays === null) return 0;
    if (aDays === null) return 1;
    if (bDays === null) return -1;

    return aDays - bDays;
  });
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function displayGroupName(value: string, fallback: string) {
  return value.trim() || fallback;
}

function isMilestoneItem(item: ScheduleItem) {
  return (
    Boolean(item.milestone.trim()) ||
    item.taskName.toLowerCase().includes('milestone')
  );
}

function scheduleTaskTitle(item: ScheduleItem) {
  return item.milestone.trim() || item.taskName.trim() || 'Untitled schedule item';
}

function sortSummaryTasks(
  left: ScheduleSummaryTask,
  right: ScheduleSummaryTask,
) {
  const leftDays = left.daysUntilDue;
  const rightDays = right.daysUntilDue;

  if (leftDays === null && rightDays === null) {
    return left.title.localeCompare(right.title);
  }

  if (leftDays === null) return 1;
  if (rightDays === null) return -1;

  return leftDays - rightDays || left.title.localeCompare(right.title);
}

function groupTasks(
  tasks: ScheduleSummaryTask[],
  nameForTask: (task: ScheduleSummaryTask) => string,
  fallback: string,
) {
  const groups = new Map<string, ScheduleSummaryGroup>();

  tasks.forEach(task => {
    const rawName = nameForTask(task);
    const name = displayGroupName(rawName, fallback);
    const key = normalized(name);
    const current =
      groups.get(key) || {
        name,
        count: 0,
        overdueCount: 0,
        upcoming30Count: 0,
        completedCount: 0,
      };

    current.count += 1;
    current.overdueCount += task.isOverdue ? 1 : 0;
    current.upcoming30Count += task.isUpcoming30 ? 1 : 0;
    current.completedCount += task.isCompleted ? 1 : 0;

    groups.set(key, current);
  });

  return Array.from(groups.values()).sort(
    (left, right) =>
      right.overdueCount - left.overdueCount ||
      right.upcoming30Count - left.upcoming30Count ||
      right.count - left.count ||
      left.name.localeCompare(right.name),
  );
}

export function buildScheduleSummary(
  scheduleItems: ScheduleItem[],
  options: {
    projectName?: string;
    areaName?: string;
  } = {},
): ScheduleSummary {
  const projectFilter = normalized(options.projectName || '');
  const areaFilter = normalized(options.areaName || '');
  const filteredItems = scheduleItems.filter(item => {
    if (projectFilter && normalized(item.projectName) !== projectFilter) {
      return false;
    }

    if (areaFilter && normalized(item.locationName) !== areaFilter) {
      return false;
    }

    return true;
  });
  const tasks = filteredItems.map(item => {
    const days = daysUntilDate(item.finishDate);
    const isCompleted = item.status === 'Complete';
    const isOverdue = !isCompleted && days !== null && days < 0;
    const isUpcoming7 = !isCompleted && days !== null && days >= 0 && days <= 7;
    const isUpcoming14 = !isCompleted && days !== null && days >= 0 && days <= 14;
    const isUpcoming30 = !isCompleted && days !== null && days >= 0 && days <= 30;
    const isMissingProject = !item.projectName.trim();
    const isMissingArea = !item.locationName.trim();

    return {
      item,
      title: scheduleTaskTitle(item),
      projectName: displayGroupName(item.projectName, 'Unassigned project'),
      areaName: displayGroupName(item.locationName, 'Unassigned area'),
      dueLabel: dueStatusText(item.finishDate),
      daysUntilDue: days,
      isCompleted,
      isMilestone: isMilestoneItem(item),
      isOverdue,
      isUpcoming7,
      isUpcoming14,
      isUpcoming30,
      isMissingProject,
      isMissingArea,
    };
  });
  const upcomingTasks = tasks
    .filter(task => !task.isCompleted && task.daysUntilDue !== null && task.daysUntilDue >= 0)
    .sort(sortSummaryTasks);
  const overdueTasks = tasks
    .filter(task => task.isOverdue)
    .sort(sortSummaryTasks);
  const completedTasks = tasks
    .filter(task => task.isCompleted)
    .sort(sortSummaryTasks);
  const milestoneTasks = tasks
    .filter(task => task.isMilestone)
    .sort(sortSummaryTasks);
  const criticalPathItems = tasks
    .filter(
      task =>
        !task.isCompleted &&
        (task.isOverdue ||
          task.item.status === 'Waiting' ||
          task.item.priority === 'High'),
    )
    .sort(sortSummaryTasks);
  const missingMappingTasks = tasks.filter(
    task => task.isMissingProject || task.isMissingArea,
  );

  return {
    totalItems: tasks.length,
    milestoneCount: milestoneTasks.length,
    overdueCount: overdueTasks.length,
    upcoming7Count: tasks.filter(task => task.isUpcoming7).length,
    upcoming14Count: tasks.filter(task => task.isUpcoming14).length,
    upcoming30Count: tasks.filter(task => task.isUpcoming30).length,
    completedCount: completedTasks.length,
    missingProjectCount: tasks.filter(task => task.isMissingProject).length,
    missingAreaCount: tasks.filter(task => task.isMissingArea).length,
    missingMappingCount: missingMappingTasks.length,
    upcomingTasks,
    upcoming7Tasks: tasks.filter(task => task.isUpcoming7).sort(sortSummaryTasks),
    upcoming14Tasks: tasks.filter(task => task.isUpcoming14).sort(sortSummaryTasks),
    upcoming30Tasks: tasks.filter(task => task.isUpcoming30).sort(sortSummaryTasks),
    overdueTasks,
    completedTasks,
    milestoneTasks,
    criticalPathItems,
    missingMappingTasks,
    byProject: groupTasks(tasks, task => task.item.projectName, 'Unassigned project'),
    byArea: groupTasks(tasks, task => task.item.locationName, 'Unassigned area'),
  };
}

export function formatScheduleImportSummary(scheduleItems: ScheduleItem[]) {
  const summary = buildScheduleSummary(scheduleItems);

  return [
    `Schedule items imported: ${summary.totalItems}`,
    `Milestones identified: ${summary.milestoneCount}`,
    `Overdue tasks: ${summary.overdueCount}`,
    `Upcoming next 7 days: ${summary.upcoming7Count}`,
    `Upcoming next 14 days: ${summary.upcoming14Count}`,
    `Upcoming next 30 days: ${summary.upcoming30Count}`,
  ].join('\n');
}

export function scheduleSummaryHighlights(summary: ScheduleSummary) {
  const highlights = [
    `${summary.totalItems} schedule item${summary.totalItems === 1 ? '' : 's'} tracked.`,
    `${summary.milestoneCount} milestone${summary.milestoneCount === 1 ? '' : 's'} identified.`,
    `${summary.upcoming30Count} task${summary.upcoming30Count === 1 ? '' : 's'} due in the next 30 days.`,
  ];

  if (summary.overdueCount > 0) {
    highlights.push(
      `${summary.overdueCount} overdue task${summary.overdueCount === 1 ? '' : 's'} need recovery dates or status updates.`,
    );
  }

  if (summary.criticalPathItems.length > 0) {
    highlights.push(
      `${summary.criticalPathItems.length} high-risk schedule item${summary.criticalPathItems.length === 1 ? '' : 's'} flagged from overdue, waiting, or high-priority work.`,
    );
  }

  if (summary.missingMappingCount > 0) {
    highlights.push(
      `${summary.missingMappingCount} task${summary.missingMappingCount === 1 ? '' : 's'} need project or area mapping.`,
    );
  }

  return highlights;
}
