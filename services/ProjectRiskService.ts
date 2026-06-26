import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  parseDueDate,
} from '../utils/date';

export type RiskCategory =
  | 'Schedule risk'
  | 'Safety risk'
  | 'Action item risk'
  | 'Documentation risk'
  | 'Project update frequency risk'
  | 'Photo/progress visibility risk';

export type RiskSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type RiskLikelihood = 'Low' | 'Medium' | 'High';
export type RiskImpact = 'Low' | 'Medium' | 'High';

export type ProjectRisk = {
  id: string;
  title: string;
  category: RiskCategory;
  severity: RiskSeverity;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  relatedProject: string;
  relatedArea: string;
  recommendedAction: string;
  detail: string;
};

export type ProjectRiskSummary = {
  projectName: string;
  totalRisks: number;
  criticalRisks: number;
  highRisks: number;
  mediumRisks: number;
  lowRisks: number;
  topCategory: RiskCategory;
};

export type ProjectRiskMatrix = {
  risks: ProjectRisk[];
  criticalRisks: ProjectRisk[];
  highPriorityRisks: ProjectRisk[];
  recommendedActions: string[];
  projectSummaries: ProjectRiskSummary[];
};

type ProjectRiskParams = {
  projects: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate?: ProjectUpdate | null;
};

type ProjectRiskContext = {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
};

const RECENT_UPDATE_DAYS = 7;
const STALE_UPDATE_DAYS = 14;
const CRITICAL_UPDATE_DAYS = 30;
const RECENT_PHOTO_DAYS = 14;
const UPCOMING_SCHEDULE_DAYS = 14;

const severityRank: Record<RiskSeverity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const categoryOrder: RiskCategory[] = [
  'Schedule risk',
  'Safety risk',
  'Action item risk',
  'Documentation risk',
  'Project update frequency risk',
  'Photo/progress visibility risk',
];

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function updatesWithCurrent(
  updates: ProjectUpdate[],
  currentUpdate?: ProjectUpdate | null,
) {
  if (
    !currentUpdate ||
    !hasUpdateContent(currentUpdate) ||
    updates.some(update => update.id === currentUpdate.id)
  ) {
    return updates;
  }

  return [currentUpdate, ...updates];
}

function projectNamesFromData({
  projects,
  updates,
  scheduleItems,
  currentUpdate,
}: {
  projects: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
}) {
  const projectNames: string[] = [];
  const addProject = (projectName: string) => {
    const trimmed = projectName.trim();

    if (
      trimmed &&
      !projectNames.some(existing => isSameProject(existing, trimmed))
    ) {
      projectNames.push(trimmed);
    }
  };

  projects.forEach(addProject);
  updates.forEach(update => addProject(update.projectName));
  scheduleItems.forEach(item => addProject(item.projectName));

  if (currentUpdate && hasUpdateContent(currentUpdate)) {
    addProject(currentUpdate.projectName);
  }

  return projectNames.length > 0 ? projectNames : ['Selected Project'];
}

function parseStoredDate(value: string | null | undefined) {
  if (!value || !value.trim()) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseUpdateDate(update: ProjectUpdate) {
  return parseDueDate(update.date) || parseStoredDate(update.date);
}

function daysSinceDate(date: Date | null) {
  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
}

function latestUpdateDate(updates: ProjectUpdate[]) {
  return updates
    .map(parseUpdateDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function isActionCategory(photo: UpdatePhoto) {
  return photo.category === 'Open Issue' || photo.category === 'Safety Concern';
}

function hasActionDetails(photo: UpdatePhoto) {
  return Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );
}

function isOpenAction(photo: UpdatePhoto) {
  return (
    isActionCategory(photo) &&
    photo.actionStatus !== 'Closed' &&
    hasActionDetails(photo)
  );
}

function isOverdueAction(photo: UpdatePhoto) {
  const days = photo.actionDueDate.trim()
    ? daysUntilDate(photo.actionDueDate)
    : null;

  return days !== null && days < 0 && photo.actionStatus !== 'Closed';
}

function photoArea(update: ProjectUpdate, photo: UpdatePhoto) {
  return photo.selectedAreaName || update.selectedAreaName || 'No area selected';
}

function projectAreaFromUpdates(updates: ProjectUpdate[]) {
  return (
    updates.find(update => update.selectedAreaName)?.selectedAreaName ||
    updates
      .flatMap(update => update.photos)
      .find(photo => photo.selectedAreaName)?.selectedAreaName ||
    'Project-wide'
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function riskId(projectName: string, category: RiskCategory) {
  return `${projectName}-${category}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function createRisk({
  projectName,
  category,
  title,
  severity,
  likelihood,
  impact,
  area,
  detail,
  recommendedAction,
}: {
  projectName: string;
  category: RiskCategory;
  title: string;
  severity: RiskSeverity;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  area: string;
  detail: string;
  recommendedAction: string;
}): ProjectRisk {
  return {
    id: riskId(projectName, category),
    title,
    category,
    severity,
    likelihood,
    impact,
    relatedProject: projectName,
    relatedArea: area,
    detail,
    recommendedAction,
  };
}

function scheduleRisk(context: ProjectRiskContext): ProjectRisk {
  const incompleteItems = context.scheduleItems.filter(
    item => item.status !== 'Complete',
  );
  const datedItems = incompleteItems
    .map(item => ({
      item,
      days: daysUntilDate(item.finishDate),
    }))
    .filter(entry => entry.days !== null);
  const overdueItems = datedItems.filter(entry => (entry.days ?? 0) < 0);
  const criticalOverdue = overdueItems.filter(entry => (entry.days ?? 0) < -14);
  const upcomingHighPriority = datedItems.filter(
    entry =>
      (entry.days ?? 9999) >= 0 &&
      (entry.days ?? 9999) <= UPCOMING_SCHEDULE_DAYS &&
      entry.item.priority === 'High',
  );
  const area =
    overdueItems[0]?.item.locationName ||
    upcomingHighPriority[0]?.item.locationName ||
    context.scheduleItems[0]?.locationName ||
    projectAreaFromUpdates(context.updates);

  if (criticalOverdue.length > 0 || overdueItems.length >= 3) {
    return createRisk({
      projectName: context.projectName,
      category: 'Schedule risk',
      title: 'Critical schedule slippage',
      severity: 'Critical',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(overdueItems.length, 'incomplete schedule item')} overdue, including ${countLabel(criticalOverdue.length, 'item')} more than 14 days overdue.`,
      recommendedAction: 'Hold a schedule recovery review, assign owners to overdue milestones, and update forecast dates.',
    });
  }

  if (overdueItems.length > 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Schedule risk',
      title: 'Overdue schedule milestone',
      severity: 'High',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(overdueItems.length, 'incomplete schedule item')} past due.`,
      recommendedAction: 'Confirm the blocker, update the milestone owner, and publish a recovery date.',
    });
  }

  if (upcomingHighPriority.length > 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Schedule risk',
      title: 'High-priority milestone approaching',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'High',
      area,
      detail: `${countLabel(upcomingHighPriority.length, 'high-priority milestone')} due within ${UPCOMING_SCHEDULE_DAYS} days.`,
      recommendedAction: 'Confirm readiness for upcoming high-priority work and escalate missing prerequisites.',
    });
  }

  if (context.scheduleItems.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Schedule risk',
      title: 'No schedule milestones tracked',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area,
      detail: 'No schedule items are available for this project.',
      recommendedAction: 'Add schedule milestones so project timing risk can be monitored.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Schedule risk',
    title: 'Schedule risk currently controlled',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'Medium',
    area,
    detail: 'No overdue or high-priority upcoming schedule risk detected.',
    recommendedAction: 'Continue updating schedule status as field conditions change.',
  });
}

function safetyRisk(context: ProjectRiskContext): ProjectRisk {
  const safetyItems = context.updates.flatMap(update =>
    update.photos
      .filter(photo => photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed')
      .map(photo => ({
        update,
        photo,
      })),
  );
  const overdueSafetyItems = safetyItems.filter(entry =>
    isOverdueAction(entry.photo),
  );
  const area =
    overdueSafetyItems[0]
      ? photoArea(overdueSafetyItems[0].update, overdueSafetyItems[0].photo)
      : safetyItems[0]
        ? photoArea(safetyItems[0].update, safetyItems[0].photo)
        : projectAreaFromUpdates(context.updates);

  if (overdueSafetyItems.length > 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Safety risk',
      title: 'Overdue safety concern',
      severity: 'Critical',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(overdueSafetyItems.length, 'open safety concern')} past due.`,
      recommendedAction: 'Escalate overdue safety concerns immediately and confirm corrective action ownership.',
    });
  }

  if (safetyItems.length >= 3) {
    return createRisk({
      projectName: context.projectName,
      category: 'Safety risk',
      title: 'Multiple open safety concerns',
      severity: 'Critical',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(safetyItems.length, 'open safety concern')} recorded across project updates.`,
      recommendedAction: 'Review the safety log with field leadership and close or reassign each concern.',
    });
  }

  if (safetyItems.length > 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Safety risk',
      title: 'Open safety concern',
      severity: 'High',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(safetyItems.length, 'open safety concern')} needs follow-up.`,
      recommendedAction: 'Assign a responsible owner and target date for each open safety concern.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Safety risk',
    title: 'No open safety concerns detected',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'High',
    area,
    detail: 'No open safety concern photos are currently recorded.',
    recommendedAction: 'Continue documenting safety observations in regular updates.',
  });
}

function actionItemRisk(context: ProjectRiskContext): ProjectRisk {
  const openActions = context.updates.flatMap(update =>
    update.photos
      .filter(isOpenAction)
      .map(photo => ({
        update,
        photo,
      })),
  );
  const overdueActions = openActions.filter(entry =>
    isOverdueAction(entry.photo),
  );
  const area =
    overdueActions[0]
      ? photoArea(overdueActions[0].update, overdueActions[0].photo)
      : openActions[0]
        ? photoArea(openActions[0].update, openActions[0].photo)
        : projectAreaFromUpdates(context.updates);

  if (overdueActions.length >= 3) {
    return createRisk({
      projectName: context.projectName,
      category: 'Action item risk',
      title: 'Critical overdue action backlog',
      severity: 'Critical',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `${countLabel(overdueActions.length, 'open action item')} past due.`,
      recommendedAction: 'Run an action-item recovery review and reset ownership, due dates, or closure criteria.',
    });
  }

  if (overdueActions.length > 0 || openActions.length >= 5) {
    return createRisk({
      projectName: context.projectName,
      category: 'Action item risk',
      title: 'High action-item exposure',
      severity: 'High',
      likelihood: 'High',
      impact: 'Medium',
      area,
      detail: `${countLabel(openActions.length, 'open action item')} with ${countLabel(overdueActions.length, 'overdue item')}.`,
      recommendedAction: 'Prioritize overdue action items and confirm owners for remaining open work.',
    });
  }

  if (openActions.length > 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Action item risk',
      title: 'Open action items need monitoring',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area,
      detail: `${countLabel(openActions.length, 'open action item')} currently tracked.`,
      recommendedAction: 'Review open action items during the next project check-in.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Action item risk',
    title: 'No open action-item risk detected',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'Medium',
    area,
    detail: 'No open issue or safety action items are currently pending.',
    recommendedAction: 'Continue closing actions in the same update cadence.',
  });
}

function documentationRisk(context: ProjectRiskContext): ProjectRisk {
  const currentDocuments = context.referenceDocuments.filter(
    document => document.isCurrent,
  );
  const scheduleDocuments = context.referenceDocuments.filter(
    document => document.category === 'Schedules',
  );
  const currentScheduleDocuments = scheduleDocuments.filter(
    document => document.isCurrent,
  );

  if (context.referenceDocuments.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Documentation risk',
      title: 'No reference documents available',
      severity: 'High',
      likelihood: 'Medium',
      impact: 'High',
      area: 'Documents',
      detail: 'No reference documents have been imported.',
      recommendedAction: 'Import current reference documents so field decisions can be checked against source material.',
    });
  }

  if (context.scheduleItems.length > 0 && currentScheduleDocuments.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Documentation risk',
      title: 'Schedule document is not marked current',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area: 'Schedules',
      detail: `${countLabel(scheduleDocuments.length, 'schedule document')} available, but none are marked current.`,
      recommendedAction: 'Mark the active schedule document current or import the latest schedule file.',
    });
  }

  if (currentDocuments.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Documentation risk',
      title: 'No current documents marked',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area: 'Documents',
      detail: `${countLabel(context.referenceDocuments.length, 'reference document')} available, but none are marked current.`,
      recommendedAction: 'Mark key documents current so the team knows which references are authoritative.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Documentation risk',
    title: 'Documentation status controlled',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'Medium',
    area: 'Documents',
    detail: `${countLabel(currentDocuments.length, 'current reference document')} available.`,
    recommendedAction: 'Continue marking superseded documents inactive as new files are imported.',
  });
}

function updateFrequencyRisk(context: ProjectRiskContext): ProjectRisk {
  const lastUpdateDate = latestUpdateDate(context.updates);
  const daysSinceLastUpdate = daysSinceDate(lastUpdateDate);
  const area = projectAreaFromUpdates(context.updates);

  if (daysSinceLastUpdate === null) {
    return createRisk({
      projectName: context.projectName,
      category: 'Project update frequency risk',
      title: 'No project updates captured',
      severity: 'High',
      likelihood: 'High',
      impact: 'Medium',
      area,
      detail: 'No saved update or active draft content is available for this project.',
      recommendedAction: 'Capture a project update to establish current status and executive visibility.',
    });
  }

  if (daysSinceLastUpdate > CRITICAL_UPDATE_DAYS) {
    return createRisk({
      projectName: context.projectName,
      category: 'Project update frequency risk',
      title: 'Project update cadence is critically stale',
      severity: 'Critical',
      likelihood: 'High',
      impact: 'High',
      area,
      detail: `Last update was ${countLabel(daysSinceLastUpdate, 'day')} ago.`,
      recommendedAction: 'Capture an immediate project update and confirm whether field status has changed.',
    });
  }

  if (daysSinceLastUpdate > STALE_UPDATE_DAYS) {
    return createRisk({
      projectName: context.projectName,
      category: 'Project update frequency risk',
      title: 'Project update cadence is stale',
      severity: 'High',
      likelihood: 'High',
      impact: 'Medium',
      area,
      detail: `Last update was ${countLabel(daysSinceLastUpdate, 'day')} ago.`,
      recommendedAction: 'Schedule a fresh update and reset the weekly reporting cadence.',
    });
  }

  if (daysSinceLastUpdate > RECENT_UPDATE_DAYS) {
    return createRisk({
      projectName: context.projectName,
      category: 'Project update frequency risk',
      title: 'Project update cadence needs attention',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area,
      detail: `Last update was ${countLabel(daysSinceLastUpdate, 'day')} ago.`,
      recommendedAction: 'Capture a brief status update before the project becomes stale.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Project update frequency risk',
    title: 'Project update cadence current',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'Medium',
    area,
    detail: `Last update was ${countLabel(daysSinceLastUpdate, 'day')} ago.`,
    recommendedAction: 'Continue the current update cadence.',
  });
}

function photoProgressRisk(context: ProjectRiskContext): ProjectRisk {
  const updateEntries = context.updates
    .map(update => ({
      update,
      date: parseUpdateDate(update),
    }))
    .filter((entry): entry is { update: ProjectUpdate; date: Date } =>
      Boolean(entry.date),
    );
  const allPhotos = context.updates.flatMap(update => update.photos);
  const recentPhotos = updateEntries
    .filter(entry => {
      const days = daysSinceDate(entry.date);

      return days !== null && days <= RECENT_PHOTO_DAYS;
    })
    .flatMap(entry => entry.update.photos);
  const area =
    context.updates
      .flatMap(update => update.photos)
      .find(photo => photo.selectedAreaName)?.selectedAreaName ||
    projectAreaFromUpdates(context.updates);

  if (allPhotos.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Photo/progress visibility risk',
      title: 'No progress photos captured',
      severity: 'High',
      likelihood: 'Medium',
      impact: 'Medium',
      area,
      detail: 'No photos are attached to this project history.',
      recommendedAction: 'Capture progress photos to improve executive and field visibility.',
    });
  }

  if (recentPhotos.length === 0) {
    return createRisk({
      projectName: context.projectName,
      category: 'Photo/progress visibility risk',
      title: 'Recent photo visibility is low',
      severity: 'Medium',
      likelihood: 'Medium',
      impact: 'Medium',
      area,
      detail: `${countLabel(allPhotos.length, 'photo')} exist, but none are tied to updates in the last ${RECENT_PHOTO_DAYS} days.`,
      recommendedAction: 'Add current photos with area labels during the next update.',
    });
  }

  return createRisk({
    projectName: context.projectName,
    category: 'Photo/progress visibility risk',
    title: 'Photo visibility current',
    severity: 'Low',
    likelihood: 'Low',
    impact: 'Medium',
    area,
    detail: `${countLabel(recentPhotos.length, 'recent photo')} available in the last ${RECENT_PHOTO_DAYS} days.`,
    recommendedAction: 'Continue capturing photos against important areas and action items.',
  });
}

function projectRisks(context: ProjectRiskContext) {
  return [
    scheduleRisk(context),
    safetyRisk(context),
    actionItemRisk(context),
    documentationRisk(context),
    updateFrequencyRisk(context),
    photoProgressRisk(context),
  ];
}

function sortRisks(risks: ProjectRisk[]) {
  return [...risks].sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }

    const categoryDelta =
      categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);

    if (categoryDelta !== 0) return categoryDelta;

    return a.relatedProject.localeCompare(b.relatedProject);
  });
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = item.trim().toLowerCase();

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function topCategoryForProject(projectRisksForSummary: ProjectRisk[]) {
  return sortRisks(projectRisksForSummary)[0]?.category || 'Schedule risk';
}

function projectSummaries(projectNames: string[], risks: ProjectRisk[]) {
  return projectNames.map(projectName => {
    const projectRisksForSummary = risks.filter(risk =>
      isSameProject(risk.relatedProject, projectName),
    );

    return {
      projectName,
      totalRisks: projectRisksForSummary.filter(risk => risk.severity !== 'Low').length,
      criticalRisks: projectRisksForSummary.filter(risk => risk.severity === 'Critical').length,
      highRisks: projectRisksForSummary.filter(risk => risk.severity === 'High').length,
      mediumRisks: projectRisksForSummary.filter(risk => risk.severity === 'Medium').length,
      lowRisks: projectRisksForSummary.filter(risk => risk.severity === 'Low').length,
      topCategory: topCategoryForProject(projectRisksForSummary),
    };
  });
}

export function buildProjectRiskMatrix({
  projects,
  updates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
}: ProjectRiskParams): ProjectRiskMatrix {
  const timelineUpdates = updatesWithCurrent(updates, currentUpdate);
  const projectNames = projectNamesFromData({
    projects,
    updates: timelineUpdates,
    scheduleItems,
    currentUpdate,
  });
  const risks = sortRisks(
    projectNames.flatMap(projectName =>
      projectRisks({
        projectName,
        updates: timelineUpdates.filter(update =>
          isSameProject(update.projectName, projectName),
        ),
        scheduleItems: scheduleItems.filter(item =>
          isSameProject(item.projectName, projectName),
        ),
        referenceDocuments,
      }),
    ),
  );
  const criticalRisks = risks.filter(risk => risk.severity === 'Critical');
  const highPriorityRisks = risks.filter(risk => risk.severity === 'High');
  const recommendedActions = uniqueItems(
    risks
      .filter(risk => risk.severity !== 'Low')
      .map(risk => `${risk.relatedProject}: ${risk.recommendedAction}`),
  );

  return {
    risks,
    criticalRisks,
    highPriorityRisks,
    recommendedActions:
      recommendedActions.length > 0
        ? recommendedActions.slice(0, 8)
        : ['Continue the current monitoring cadence; no elevated risks were detected.'],
    projectSummaries: projectSummaries(projectNames, risks),
  };
}
