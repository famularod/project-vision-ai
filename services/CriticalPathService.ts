import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  formatAppDate,
  parseFlexibleDate,
} from '../utils/date';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_UPDATE_DAYS = 14;

export type CriticalPathRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type CriticalPathTask = {
  id: string;
  title: string;
  projectName: string;
  areaName: string;
  owner: string;
  dueDate: string;
  dueDateLabel: string;
  scheduleStatus: ScheduleItem['status'];
  priority: ScheduleItem['priority'];
  percentComplete: number;
  daysUntilDue: number | null;
  daysLabel: string;
  riskLevel: CriticalPathRiskLevel;
  isCritical: boolean;
  isBlocking: boolean;
  isDelayedMilestone: boolean;
  predecessorTitle: string | null;
  dependentTaskNames: string[];
  relatedUpdatesCount: number;
  relatedPhotosCount: number;
  openActionItemsCount: number;
  blockingIssues: string[];
  recommendedAction: string;
  remainingPathDays: number;
};

export type CriticalPathSummaryData = {
  totalTasks: number;
  criticalTasks: number;
  blockingTasks: number;
  delayedMilestones: number;
  longestRemainingPathDays: number;
  longestRemainingPathProject: string | null;
  estimatedCompletionDate: string;
  scheduleConfidenceScore: number;
  completionConfidence: string;
};

export type CriticalPathAnalysis = {
  summary: CriticalPathSummaryData;
  criticalTasks: CriticalPathTask[];
  blockingTasks: CriticalPathTask[];
  delayedMilestones: CriticalPathTask[];
  recommendedImmediateActions: string[];
};

type BaseTask = Omit<
  CriticalPathTask,
  | 'riskLevel'
  | 'isCritical'
  | 'isBlocking'
  | 'isDelayedMilestone'
  | 'predecessorTitle'
  | 'dependentTaskNames'
  | 'blockingIssues'
  | 'recommendedAction'
>;

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function isSameValue(left: string, right: string) {
  return Boolean(normalized(left) && normalized(left) === normalized(right));
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.notes.trim().length > 0 || update.photos.length > 0;
}

function isOpenAction(photo: UpdatePhoto) {
  const isActionCategory =
    photo.category === 'Open Issue' || photo.category === 'Safety Concern';
  const hasActionDetails = Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );

  return isActionCategory && photo.actionStatus !== 'Closed' && hasActionDetails;
}

function updateMatchesTask(update: ProjectUpdate, task: ScheduleItem) {
  if (!isSameValue(update.projectName, task.projectName)) return false;
  if (!task.locationName.trim()) return true;

  const updateArea = update.selectedAreaName || '';

  return (
    !updateArea ||
    isSameValue(updateArea, task.locationName) ||
    update.photos.some(photo =>
      isSameValue(photo.selectedAreaName || '', task.locationName),
    )
  );
}

function photoMatchesTask(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  task: ScheduleItem,
) {
  if (!isSameValue(update.projectName, task.projectName)) return false;
  if (!task.locationName.trim()) return true;

  const photoArea = photo.selectedAreaName || update.selectedAreaName || '';

  return !photoArea || isSameValue(photoArea, task.locationName);
}

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function taskDaysLabel(daysUntilDue: number | null, isComplete: boolean) {
  if (isComplete) return 'Completed';
  if (daysUntilDue === null) return 'No due date';
  if (daysUntilDue < 0) {
    const daysLate = Math.abs(daysUntilDue);

    return `${daysLate} day${daysLate === 1 ? '' : 's'} late`;
  }
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return '1 day remaining';

  return `${daysUntilDue} days remaining`;
}

function taskSort(left: BaseTask, right: BaseTask) {
  if (left.daysUntilDue === null && right.daysUntilDue === null) {
    return left.title.localeCompare(right.title);
  }
  if (left.daysUntilDue === null) return 1;
  if (right.daysUntilDue === null) return -1;

  return left.daysUntilDue - right.daysUntilDue || left.title.localeCompare(right.title);
}

function remainingPathDays(item: ScheduleItem, daysUntilDue: number | null) {
  if (item.status === 'Complete') return 0;

  const startDate = parseFlexibleDate(item.startDate);
  const finishDate = parseFlexibleDate(item.finishDate);
  const percentRemaining = Math.max(0, 100 - boundedPercent(item.percentComplete));

  if (startDate && finishDate && finishDate > startDate) {
    const plannedDays = Math.max(
      1,
      Math.round((finishDate.getTime() - startDate.getTime()) / DAY_MS),
    );

    return Math.max(1, Math.ceil((plannedDays * percentRemaining) / 100));
  }

  if (daysUntilDue !== null && daysUntilDue >= 0) {
    return Math.max(1, daysUntilDue);
  }

  if (daysUntilDue !== null) {
    return Math.max(7, Math.abs(daysUntilDue) + 3);
  }

  return 14;
}

function riskLevel({
  task,
  isBlocking,
  dependentCount,
}: {
  task: BaseTask;
  isBlocking: boolean;
  dependentCount: number;
}): CriticalPathRiskLevel {
  if (task.scheduleStatus === 'Complete') return 'Low';

  const late = task.daysUntilDue !== null && task.daysUntilDue < 0;
  const dueSoon = task.daysUntilDue !== null && task.daysUntilDue <= 7;

  if (late && (isBlocking || dependentCount > 0)) return 'Critical';
  if (
    late ||
    task.scheduleStatus === 'Waiting' ||
    (isBlocking && dependentCount > 0) ||
    task.openActionItemsCount > 0
  ) {
    return 'High';
  }
  if (
    task.priority === 'High' ||
    dueSoon ||
    (task.percentComplete <= 25 && task.daysUntilDue !== null && task.daysUntilDue <= 14) ||
    task.relatedUpdatesCount === 0
  ) {
    return 'Medium';
  }

  return 'Low';
}

function blockingIssues(task: BaseTask) {
  const issues: string[] = [];

  if (task.scheduleStatus === 'Waiting') {
    issues.push('Task is waiting for a dependency, decision, or field condition.');
  }
  if (task.daysUntilDue !== null && task.daysUntilDue < 0) {
    issues.push(task.daysLabel);
  }
  if (task.openActionItemsCount > 0) {
    issues.push(
      `${task.openActionItemsCount} related open action item${task.openActionItemsCount === 1 ? '' : 's'}.`,
    );
  }
  if (task.relatedUpdatesCount === 0) {
    issues.push('No related field update is available for progress validation.');
  }

  return issues;
}

function recommendedAction({
  task,
  issues,
  dependentCount,
}: {
  task: BaseTask;
  issues: string[];
  dependentCount: number;
}) {
  if (task.scheduleStatus === 'Complete') {
    return 'Confirm completion evidence and close any related action items.';
  }
  if (task.daysUntilDue !== null && task.daysUntilDue < 0) {
    return `Assign a recovery owner and revised completion date for ${task.title}.`;
  }
  if (task.openActionItemsCount > 0) {
    return `Resolve or re-date ${task.openActionItemsCount} open action item${task.openActionItemsCount === 1 ? '' : 's'} before the next milestone review.`;
  }
  if (task.scheduleStatus === 'Waiting') {
    return `Remove the waiting condition and confirm the next handoff for ${task.title}.`;
  }
  if (dependentCount > 0 && issues.length > 0) {
    return `Validate ${task.title} this week to protect ${dependentCount} dependent task${dependentCount === 1 ? '' : 's'}.`;
  }
  if (task.relatedUpdatesCount === 0) {
    return `Capture a field update to verify ${task.title} progress.`;
  }

  return 'Maintain the current owner checkpoint and confirm progress against the due date.';
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = normalized(item);

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function latestProjectUpdateDays(
  projectName: string,
  updates: ProjectUpdate[],
) {
  const dates = updates
    .filter(update => isSameValue(update.projectName, projectName))
    .map(update => parseFlexibleDate(update.date))
    .filter((date): date is Date => Boolean(date));

  if (dates.length === 0) return null;

  const mostRecent = dates.reduce((latest, date) =>
    date > latest ? date : latest,
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - mostRecent.getTime()) / DAY_MS));
}

function completionConfidence(score: number, hasTasks: boolean) {
  if (!hasTasks) return 'No schedule data';
  if (score >= 80) return 'High confidence';
  if (score >= 60) return 'Moderate confidence';

  return 'Low confidence';
}

export function analyzeCriticalPath({
  projects,
  scheduleItems,
  updates,
  currentUpdate,
}: {
  projects: string[];
  scheduleItems: ScheduleItem[];
  updates: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
}): CriticalPathAnalysis {
  const allUpdates =
    currentUpdate &&
    hasUpdateContent(currentUpdate) &&
    !updates.some(update => update.id === currentUpdate.id)
      ? [currentUpdate, ...updates]
      : updates;
  const baseTasks: BaseTask[] = scheduleItems.map(item => {
    const relatedUpdates = allUpdates.filter(update => updateMatchesTask(update, item));
    const relatedPhotos = relatedUpdates.flatMap(update =>
      update.photos.filter(photo => photoMatchesTask(update, photo, item)),
    );
    const openActionItemsCount = relatedPhotos.filter(isOpenAction).length;
    const daysUntilDue = daysUntilDate(item.finishDate);

    return {
      id: item.id,
      title: item.milestone || item.taskName || 'Untitled task',
      projectName: item.projectName || 'Unassigned project',
      areaName: item.locationName || '',
      owner: item.owner || item.contractor || 'Unassigned',
      dueDate: item.finishDate,
      dueDateLabel: item.finishDate.trim()
        ? formatAppDate(item.finishDate)
        : 'No due date',
      scheduleStatus: item.status,
      priority: item.priority,
      percentComplete: boundedPercent(item.percentComplete),
      daysUntilDue,
      daysLabel: taskDaysLabel(daysUntilDue, item.status === 'Complete'),
      relatedUpdatesCount: relatedUpdates.length,
      relatedPhotosCount: relatedPhotos.length,
      openActionItemsCount,
      remainingPathDays: remainingPathDays(item, daysUntilDue),
    };
  });
  const orderedByProject = new Map<string, BaseTask[]>();

  baseTasks.forEach(task => {
    const key = normalized(task.projectName);
    const items = orderedByProject.get(key) || [];

    items.push(task);
    orderedByProject.set(key, items);
  });

  orderedByProject.forEach(tasks => tasks.sort(taskSort));

  const predecessorByTaskId = new Map<string, BaseTask>();
  const dependentsByTaskId = new Map<string, BaseTask[]>();

  orderedByProject.forEach(tasks => {
    tasks.forEach((task, index) => {
      const priorSameArea = [...tasks.slice(0, index)]
        .reverse()
        .find(prior =>
          Boolean(task.areaName && prior.areaName && isSameValue(task.areaName, prior.areaName)),
        );
      const predecessor = priorSameArea || tasks[index - 1];

      if (!predecessor) return;

      predecessorByTaskId.set(task.id, predecessor);
      const dependents = dependentsByTaskId.get(predecessor.id) || [];

      dependents.push(task);
      dependentsByTaskId.set(predecessor.id, dependents);
    });
  });

  const tasks = baseTasks
    .map(task => {
      const dependentTasks = dependentsByTaskId.get(task.id) || [];
      const issues = blockingIssues(task);
      const isBlocking =
        task.scheduleStatus !== 'Complete' &&
        (task.scheduleStatus === 'Waiting' ||
          (task.daysUntilDue !== null && task.daysUntilDue < 0) ||
          task.openActionItemsCount > 0);
      const risk = riskLevel({
        task,
        isBlocking,
        dependentCount: dependentTasks.length,
      });
      const isCritical =
        task.scheduleStatus !== 'Complete' &&
        (risk === 'Critical' || risk === 'High' || (isBlocking && dependentTasks.length > 0));
      const isDelayedMilestone =
        task.scheduleStatus !== 'Complete' &&
        Boolean(task.title.trim()) &&
        ((task.daysUntilDue !== null && task.daysUntilDue < 0) ||
          task.scheduleStatus === 'Waiting');
      const predecessor = predecessorByTaskId.get(task.id);

      return {
        ...task,
        riskLevel: risk,
        isCritical,
        isBlocking,
        isDelayedMilestone,
        predecessorTitle: predecessor?.title || null,
        dependentTaskNames: dependentTasks.map(dependent => dependent.title),
        blockingIssues: issues,
        recommendedAction: recommendedAction({
          task,
          issues,
          dependentCount: dependentTasks.length,
        }),
      } satisfies CriticalPathTask;
    })
    .sort((left, right) => {
      const riskOrder: Record<CriticalPathRiskLevel, number> = {
        Critical: 0,
        High: 1,
        Medium: 2,
        Low: 3,
      };

      return (
        riskOrder[left.riskLevel] - riskOrder[right.riskLevel] ||
        (left.daysUntilDue ?? Number.MAX_SAFE_INTEGER) -
          (right.daysUntilDue ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title)
      );
    });
  const criticalTasks = tasks.filter(task => task.isCritical);
  const blockingTasks = tasks.filter(task => task.isBlocking);
  const delayedMilestones = tasks.filter(task => task.isDelayedMilestone);
  const activeProjectPaths = [...orderedByProject.values()]
    .map(projectTasks => {
      const activeTasks = projectTasks.filter(
        task => task.scheduleStatus !== 'Complete',
      );

      return {
        projectName: projectTasks[0]?.projectName || null,
        days: activeTasks.reduce((total, task) => total + task.remainingPathDays, 0),
      };
    })
    .filter(path => path.days > 0)
    .sort((left, right) => right.days - left.days);
  const longestPath = activeProjectPaths[0] || {
    projectName: null,
    days: 0,
  };
  const projectNames = new Set([
    ...projects.map(normalized).filter(Boolean),
    ...baseTasks.map(task => normalized(task.projectName)).filter(Boolean),
  ]);
  const staleProjectCount = [...projectNames].filter(projectName => {
    const daysSinceUpdate = latestProjectUpdateDays(projectName, allUpdates);

    return daysSinceUpdate === null || daysSinceUpdate > STALE_UPDATE_DAYS;
  }).length;
  const missingDueDateCount = tasks.filter(
    task => task.scheduleStatus !== 'Complete' && task.daysUntilDue === null,
  ).length;
  const waitingCount = tasks.filter(
    task => task.scheduleStatus === 'Waiting',
  ).length;
  const highPriorityCount = tasks.filter(
    task => task.scheduleStatus !== 'Complete' && task.priority === 'High',
  ).length;
  let scheduleConfidenceScore = tasks.length > 0 ? 88 : 0;

  scheduleConfidenceScore -= Math.min(delayedMilestones.length * 10, 35);
  scheduleConfidenceScore -= Math.min(waitingCount * 8, 20);
  scheduleConfidenceScore -= Math.min(blockingTasks.length * 5, 20);
  scheduleConfidenceScore -= Math.min(missingDueDateCount * 4, 16);
  scheduleConfidenceScore -= Math.min(staleProjectCount * 4, 12);
  scheduleConfidenceScore -= Math.min(highPriorityCount * 2, 8);
  scheduleConfidenceScore += Math.min(
    tasks.filter(task => task.scheduleStatus === 'Complete').length * 2,
    8,
  );
  scheduleConfidenceScore = Math.max(
    0,
    Math.min(100, Math.round(scheduleConfidenceScore)),
  );

  const estimatedCompletion = new Date();
  estimatedCompletion.setHours(0, 0, 0, 0);
  estimatedCompletion.setDate(estimatedCompletion.getDate() + longestPath.days);
  const recommendedImmediateActions = uniqueItems([
    ...blockingTasks.map(task => task.recommendedAction),
    ...criticalTasks.map(task => task.recommendedAction),
    staleProjectCount > 0
      ? `Capture current field updates for ${staleProjectCount} project${staleProjectCount === 1 ? '' : 's'} with stale or missing progress evidence.`
      : '',
    missingDueDateCount > 0
      ? `Add due dates to ${missingDueDateCount} active schedule task${missingDueDateCount === 1 ? '' : 's'} to improve completion confidence.`
      : '',
    tasks.length === 0
      ? 'Add schedule tasks with dates, owners, and status to calculate a critical path.'
      : '',
  ]).slice(0, 6);

  return {
    summary: {
      totalTasks: tasks.length,
      criticalTasks: criticalTasks.length,
      blockingTasks: blockingTasks.length,
      delayedMilestones: delayedMilestones.length,
      longestRemainingPathDays: longestPath.days,
      longestRemainingPathProject: longestPath.projectName,
      estimatedCompletionDate:
        longestPath.days > 0 ? formatAppDate(estimatedCompletion.toISOString().slice(0, 10)) : 'No active schedule path',
      scheduleConfidenceScore,
      completionConfidence: completionConfidence(scheduleConfidenceScore, tasks.length > 0),
    },
    criticalTasks,
    blockingTasks,
    delayedMilestones,
    recommendedImmediateActions:
      recommendedImmediateActions.length > 0
        ? recommendedImmediateActions
        : ['Maintain the current schedule review cadence and confirm upcoming task ownership.'],
  };
}
