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

export const MILESTONE_FILTERS = [
  'All',
  'Upcoming',
  'Overdue',
  'Completed',
  'At Risk',
  'By Project',
] as const;

export type MilestoneFilter = typeof MILESTONE_FILTERS[number];

export type MilestoneDisplayStatus =
  | 'Completed'
  | 'Overdue'
  | 'At Risk'
  | 'Upcoming'
  | 'No Due Date';

export type MilestoneRecord = {
  id: string;
  title: string;
  projectName: string;
  areaName: string;
  dueDate: string;
  dueDateLabel: string;
  status: MilestoneDisplayStatus;
  scheduleStatus: ScheduleItem['status'];
  priority: ScheduleItem['priority'];
  percentComplete: number;
  daysUntilDue: number | null;
  daysLabel: string;
  relatedUpdatesCount: number;
  relatedPhotosCount: number;
  relatedActionItemsCount: number;
  recommendedNextAction: string;
  isUpcoming: boolean;
  isOverdue: boolean;
  isAtRisk: boolean;
  isCompleted: boolean;
};

export type MilestoneBreakdown = {
  name: string;
  total: number;
  completed: number;
  atRisk: number;
  overdue: number;
};

export type MilestoneRelatedUpdate = {
  id: string;
  projectName: string;
  areaName: string;
  date: string;
  dateLabel: string;
  description: string;
  photoCount: number;
  relatedMilestonesCount: number;
};

export type MilestoneTrackingSummary = {
  total: number;
  completed: number;
  upcoming: number;
  overdue: number;
  atRisk: number;
  byProject: MilestoneBreakdown[];
  byArea: MilestoneBreakdown[];
};

export type MilestoneTracking = {
  milestones: MilestoneRecord[];
  summary: MilestoneTrackingSummary;
  recentUpdates: MilestoneRelatedUpdate[];
  projects: string[];
};

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function isSameValue(left: string, right: string) {
  return Boolean(normalized(left) && normalized(left) === normalized(right));
}

function updateHasContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function updateAreaMatches(update: ProjectUpdate, areaName: string) {
  if (!areaName.trim()) return true;

  if (isSameValue(update.selectedAreaName || '', areaName)) return true;

  return update.photos.some(photo =>
    isSameValue(photo.selectedAreaName || '', areaName),
  );
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

function relatedPhotosForUpdate(update: ProjectUpdate, areaName: string) {
  if (!areaName.trim()) return update.photos;

  return update.photos.filter(photo => {
    const photoArea = photo.selectedAreaName || update.selectedAreaName || '';

    return isSameValue(photoArea, areaName);
  });
}

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function milestoneStatus({
  scheduleItem,
  daysUntilDue,
  isAtRisk,
}: {
  scheduleItem: ScheduleItem;
  daysUntilDue: number | null;
  isAtRisk: boolean;
}): MilestoneDisplayStatus {
  if (scheduleItem.status === 'Complete') return 'Completed';
  if (daysUntilDue !== null && daysUntilDue < 0) return 'Overdue';
  if (isAtRisk) return 'At Risk';
  if (daysUntilDue !== null) return 'Upcoming';

  return 'No Due Date';
}

function daysLabel(daysUntilDue: number | null, isCompleted: boolean) {
  if (isCompleted) return 'Completed';
  if (daysUntilDue === null) return 'No due date';
  if (daysUntilDue < 0) {
    const days = Math.abs(daysUntilDue);

    return `${days} day${days === 1 ? '' : 's'} overdue`;
  }
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return '1 day remaining';

  return `${daysUntilDue} days remaining`;
}

function recommendedNextAction({
  scheduleItem,
  daysUntilDue,
  relatedUpdatesCount,
  relatedActionItemsCount,
  isAtRisk,
}: {
  scheduleItem: ScheduleItem;
  daysUntilDue: number | null;
  relatedUpdatesCount: number;
  relatedActionItemsCount: number;
  isAtRisk: boolean;
}) {
  const title = scheduleItem.milestone || scheduleItem.taskName || 'This milestone';

  if (scheduleItem.status === 'Complete') {
    return relatedUpdatesCount > 0
      ? 'Confirm completion evidence is current and close any remaining follow-up actions.'
      : `Capture a completion update for ${title}.`;
  }

  if (daysUntilDue !== null && daysUntilDue < 0) {
    return `Confirm an owner and recovery date for ${title}.`;
  }

  if (relatedActionItemsCount > 0) {
    return `Resolve or re-date ${relatedActionItemsCount} related open action item${relatedActionItemsCount === 1 ? '' : 's'}.`;
  }

  if (isAtRisk) {
    return `Review constraints, owner commitment, and recovery steps for ${title}.`;
  }

  if (daysUntilDue !== null && daysUntilDue <= 7) {
    return `Confirm readiness and field evidence before the ${title} due date.`;
  }

  if (relatedUpdatesCount === 0) {
    return `Capture a current field update to validate ${title} progress.`;
  }

  return 'Continue monitoring progress and confirm the next owner checkpoint.';
}

function buildBreakdown(
  milestones: MilestoneRecord[],
  nameForMilestone: (milestone: MilestoneRecord) => string,
) {
  const breakdown = new Map<string, MilestoneBreakdown>();

  milestones.forEach(milestone => {
    const name = nameForMilestone(milestone).trim() || 'Unassigned';
    const current = breakdown.get(name) || {
      name,
      total: 0,
      completed: 0,
      atRisk: 0,
      overdue: 0,
    };

    current.total += 1;
    if (milestone.isCompleted) current.completed += 1;
    if (milestone.isAtRisk) current.atRisk += 1;
    if (milestone.isOverdue) current.overdue += 1;

    breakdown.set(name, current);
  });

  return [...breakdown.values()].sort(
    (left, right) =>
      right.overdue - left.overdue ||
      right.atRisk - left.atRisk ||
      right.total - left.total ||
      left.name.localeCompare(right.name),
  );
}

function updateDescription(update: ProjectUpdate) {
  const notes = update.notes.trim().replace(/\s+/g, ' ');

  if (notes) {
    return notes.length > 120 ? `${notes.slice(0, 117).trim()}...` : notes;
  }

  return `${update.photos.length} photo${update.photos.length === 1 ? '' : 's'} captured.`;
}

export function buildMilestoneTracking({
  projects,
  updates,
  scheduleItems,
  currentUpdate,
}: {
  projects: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
}): MilestoneTracking {
  const allUpdates =
    currentUpdate &&
    updateHasContent(currentUpdate) &&
    !updates.some(update => update.id === currentUpdate.id)
      ? [currentUpdate, ...updates]
      : updates;

  const milestones = scheduleItems
    .map(scheduleItem => {
      const isCompleted = scheduleItem.status === 'Complete';
      const daysUntilDue = daysUntilDate(scheduleItem.finishDate);
      const isOverdue = !isCompleted && daysUntilDue !== null && daysUntilDue < 0;
      const isUpcoming = !isCompleted && daysUntilDue !== null && daysUntilDue >= 0;
      const isAtRisk =
        !isCompleted &&
        (isOverdue ||
          scheduleItem.status === 'Waiting' ||
          scheduleItem.priority === 'High' ||
          (daysUntilDue !== null && daysUntilDue <= 7) ||
          (scheduleItem.percentComplete <= 25 &&
            daysUntilDue !== null &&
            daysUntilDue <= 14));
      const relatedUpdates = allUpdates.filter(
        update =>
          isSameValue(update.projectName, scheduleItem.projectName) &&
          updateAreaMatches(update, scheduleItem.locationName),
      );
      const relatedPhotos = relatedUpdates.flatMap(update =>
        relatedPhotosForUpdate(update, scheduleItem.locationName),
      );
      const relatedActionItemsCount = relatedPhotos.filter(isOpenAction).length;

      return {
        id: scheduleItem.id,
        title: scheduleItem.milestone || scheduleItem.taskName || 'Untitled milestone',
        projectName: scheduleItem.projectName || 'Unassigned project',
        areaName: scheduleItem.locationName || '',
        dueDate: scheduleItem.finishDate,
        dueDateLabel: scheduleItem.finishDate.trim()
          ? formatAppDate(scheduleItem.finishDate)
          : 'No due date',
        status: milestoneStatus({
          scheduleItem,
          daysUntilDue,
          isAtRisk,
        }),
        scheduleStatus: scheduleItem.status,
        priority: scheduleItem.priority,
        percentComplete: boundedPercent(scheduleItem.percentComplete),
        daysUntilDue,
        daysLabel: daysLabel(daysUntilDue, isCompleted),
        relatedUpdatesCount: relatedUpdates.length,
        relatedPhotosCount: relatedPhotos.length,
        relatedActionItemsCount,
        recommendedNextAction: recommendedNextAction({
          scheduleItem,
          daysUntilDue,
          relatedUpdatesCount: relatedUpdates.length,
          relatedActionItemsCount,
          isAtRisk,
        }),
        isUpcoming,
        isOverdue,
        isAtRisk,
        isCompleted,
      } satisfies MilestoneRecord;
    })
    .sort((left, right) => {
      if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1;
      if (left.isAtRisk !== right.isAtRisk) return left.isAtRisk ? -1 : 1;
      if (left.isCompleted !== right.isCompleted) return left.isCompleted ? 1 : -1;
      if (left.daysUntilDue === null && right.daysUntilDue === null) {
        return left.title.localeCompare(right.title);
      }
      if (left.daysUntilDue === null) return 1;
      if (right.daysUntilDue === null) return -1;

      return left.daysUntilDue - right.daysUntilDue;
    });
  const milestoneProjectNames = new Set(
    milestones.map(milestone => normalized(milestone.projectName)),
  );
  const recentUpdates = allUpdates
    .filter(update => updateHasContent(update))
    .filter(update => milestoneProjectNames.has(normalized(update.projectName)))
    .map(update => {
      const relatedMilestones = milestones.filter(
        milestone =>
          isSameValue(milestone.projectName, update.projectName) &&
          updateAreaMatches(update, milestone.areaName),
      );
      const updateArea =
        update.selectedAreaName ||
        update.photos.find(photo => photo.selectedAreaName)?.selectedAreaName ||
        '';

      return {
        id: update.id,
        projectName: update.projectName || 'Unassigned project',
        areaName: updateArea,
        date: update.date,
        dateLabel: update.date.trim()
          ? formatAppDate(update.date)
          : 'Date not recorded',
        description: updateDescription(update),
        photoCount: update.photos.length,
        relatedMilestonesCount: relatedMilestones.length,
      } satisfies MilestoneRelatedUpdate;
    })
    .filter(update => parseFlexibleDate(update.date))
    .sort(
      (left, right) =>
        (parseFlexibleDate(right.date)?.getTime() ?? 0) -
        (parseFlexibleDate(left.date)?.getTime() ?? 0),
    )
    .slice(0, 6);
  const knownProjects = new Map<string, string>();
  [...projects, ...milestones.map(milestone => milestone.projectName)].forEach(
    project => {
      const name = project.trim();
      const key = normalized(name);

      if (name && !knownProjects.has(key)) knownProjects.set(key, name);
    },
  );

  return {
    milestones,
    summary: {
      total: milestones.length,
      completed: milestones.filter(milestone => milestone.isCompleted).length,
      upcoming: milestones.filter(milestone => milestone.isUpcoming).length,
      overdue: milestones.filter(milestone => milestone.isOverdue).length,
      atRisk: milestones.filter(milestone => milestone.isAtRisk).length,
      byProject: buildBreakdown(milestones, milestone => milestone.projectName),
      byArea: buildBreakdown(milestones, milestone => milestone.areaName),
    },
    recentUpdates,
    projects: [...knownProjects.values()].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function filterMilestones({
  milestones,
  filter,
  projectName,
}: {
  milestones: MilestoneRecord[];
  filter: MilestoneFilter;
  projectName?: string | null;
}) {
  const projectFiltered = projectName?.trim()
    ? milestones.filter(milestone =>
        isSameValue(milestone.projectName, projectName),
      )
    : milestones;

  if (filter === 'All' || filter === 'By Project') return projectFiltered;
  if (filter === 'Upcoming') {
    return projectFiltered.filter(milestone => milestone.isUpcoming);
  }
  if (filter === 'Overdue') {
    return projectFiltered.filter(milestone => milestone.isOverdue);
  }
  if (filter === 'Completed') {
    return projectFiltered.filter(milestone => milestone.isCompleted);
  }

  return projectFiltered.filter(milestone => milestone.isAtRisk);
}
