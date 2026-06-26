import { analyzeProjectCoach } from './AIProjectCoach';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  formatDisplayDate,
  parseDueDate,
} from '../utils/date';

const WEEK_DAYS = 7;
const UPCOMING_MILESTONE_DAYS = 14;

export type WeeklyExecutiveReport = {
  periodLabel: string;
  metrics: {
    overallHealthScore: number;
    projectsNeedingAttention: number;
    updatesThisWeek: number;
    photosThisWeek: number;
    documentsThisWeek: number;
    openActionItems: number;
    overdueActionItems: number;
    safetyConcerns: number;
    upcomingMilestones: number;
  };
  recentUpdates: string[];
  documentUpdates: string[];
  projectsNeedingAttention: string[];
  openActionItems: string[];
  overdueActionItems: string[];
  safetyConcerns: string[];
  upcomingMilestones: string[];
  keyAccomplishments: string[];
  topRisks: string[];
  recommendedExecutiveActions: string[];
  executiveSummary: string;
};

type WeeklyExecutiveReportParams = {
  projects: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate?: ProjectUpdate | null;
};

type ProjectHealth = {
  projectName: string;
  score: number;
  accomplishments: string[];
  risks: string[];
  recommendations: string[];
};

type ReportActionItem = {
  id: string;
  title: string;
  projectName: string;
  owner: string;
  status: string;
  dueLabel: string;
  isOverdue: boolean;
};

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
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

function isOpenSafetyConcern(photo: UpdatePhoto) {
  return photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed';
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
}

function periodStart(today: Date) {
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEK_DAYS - 1));

  return start;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function parseUpdateDate(value: string) {
  return parseDueDate(value);
}

function parseStoredDate(value: string) {
  if (!value.trim()) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function isDateInPeriod(date: Date | null, start: Date, end: Date) {
  return Boolean(date && date >= start && date <= end);
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
  const addProjectName = (projectName: string) => {
    const trimmed = projectName.trim();

    if (
      trimmed &&
      !projectNames.some(existing => isSameProject(existing, trimmed))
    ) {
      projectNames.push(trimmed);
    }
  };

  projects.forEach(addProjectName);
  updates.forEach(update => addProjectName(update.projectName));
  scheduleItems.forEach(item => addProjectName(item.projectName));

  if (currentUpdate && hasUpdateContent(currentUpdate)) {
    addProjectName(currentUpdate.projectName);
  }

  return projectNames.length > 0 ? projectNames : ['Selected Project'];
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

function projectHealthScores({
  projectNames,
  updates,
  scheduleItems,
  currentUpdate,
}: {
  projectNames: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
}): ProjectHealth[] {
  return projectNames.map(projectName => {
    const analysis = analyzeProjectCoach({
      projectName,
      updates,
      scheduleItems,
      currentUpdate:
        currentUpdate && isSameProject(projectName, currentUpdate.projectName)
          ? currentUpdate
          : null,
    });

    return {
      projectName,
      score: analysis.score,
      accomplishments: analysis.accomplishments,
      risks: analysis.risks,
      recommendations: analysis.recommendations,
    };
  });
}

function averageHealthScore(projectHealth: ProjectHealth[]) {
  if (projectHealth.length === 0) return 0;

  return Math.round(
    projectHealth.reduce((total, project) => total + project.score, 0) /
      projectHealth.length,
  );
}

function actionItemsFromUpdates(updates: ProjectUpdate[]) {
  return updates.flatMap(update =>
    update.photos
      .filter(isOpenAction)
      .map(photo => {
        const daysUntilDue = photo.actionDueDate.trim()
          ? daysUntilDate(photo.actionDueDate)
          : null;

        return {
          id: `${update.id}-${photo.id}`,
          title: photo.actionRequired || photo.caption || photo.category,
          projectName: update.projectName,
          owner: photo.actionOwner,
          status: photo.actionStatus,
          dueLabel: photo.actionDueDate.trim()
            ? dueStatusText(photo.actionDueDate)
            : 'No due date',
          isOverdue: daysUntilDue !== null && daysUntilDue < 0,
        };
      }),
  );
}

function actionItemText(item: ReportActionItem) {
  const ownerText = item.owner ? ` • ${item.owner}` : '';

  return `${item.projectName || 'No project'}: ${item.title || 'Open action'} (${item.status}, ${item.dueLabel}${ownerText}).`;
}

function safetyConcernText(update: ProjectUpdate, photo: UpdatePhoto) {
  const ownerText = photo.actionOwner ? ` • Owner: ${photo.actionOwner}` : '';
  const title = photo.actionRequired || photo.caption || 'Safety concern';

  return `${update.projectName || 'No project'}: ${title} (${photo.actionStatus}${ownerText}).`;
}

function upcomingMilestoneText(item: ScheduleItem) {
  return `${item.projectName || 'No project'}: ${item.milestone || item.taskName || 'Upcoming milestone'} (${dueStatusText(item.finishDate)}, ${item.status}, ${item.percentComplete}% complete).`;
}

function recentUpdateText(update: ProjectUpdate) {
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(update.date)
    ? formatDisplayDate(update.date)
    : update.date;
  const areaText =
    update.selectedAreaName ||
    update.photos.find(photo => photo.selectedAreaName)?.selectedAreaName ||
    '';
  const locationText = areaText ? ` • ${areaText}` : '';

  return `${update.projectName || 'No project'}: ${dateText}${locationText} • ${countLabel(update.photos.length, 'photo')}.`;
}

function documentUpdateText(document: ReferenceDocument) {
  const categoryText = document.category ? ` • ${document.category}` : '';

  return `${document.name || document.originalFileName || 'Reference document'}${categoryText}.`;
}

function buildAccomplishments({
  updatesThisWeek,
  photosThisWeek,
  documentsThisWeek,
  projectHealth,
}: {
  updatesThisWeek: number;
  photosThisWeek: number;
  documentsThisWeek: number;
  projectHealth: ProjectHealth[];
}) {
  const accomplishments: string[] = [];

  if (updatesThisWeek > 0) {
    accomplishments.push(
      `${countLabel(updatesThisWeek, 'project update')} captured this week.`,
    );
  }

  if (photosThisWeek > 0) {
    accomplishments.push(
      `${countLabel(photosThisWeek, 'photo')} added for field and executive context.`,
    );
  }

  if (documentsThisWeek > 0) {
    accomplishments.push(
      `${countLabel(documentsThisWeek, 'reference document')} added or refreshed this week.`,
    );
  }

  projectHealth
    .flatMap(project =>
      project.accomplishments.map(item => `${project.projectName}: ${item}`),
    )
    .forEach(item => accomplishments.push(item));

  const uniqueAccomplishments = uniqueItems(accomplishments);

  return uniqueAccomplishments.length > 0
    ? uniqueAccomplishments.slice(0, 6)
    : ['No weekly accomplishments were detected from the current local data.'];
}

function buildRisks({
  projectsNeedingAttention,
  overdueActionItems,
  safetyConcerns,
  upcomingMilestones,
  updatesThisWeek,
  projectHealth,
}: {
  projectsNeedingAttention: ProjectHealth[];
  overdueActionItems: ReportActionItem[];
  safetyConcerns: string[];
  upcomingMilestones: string[];
  updatesThisWeek: number;
  projectHealth: ProjectHealth[];
}) {
  const risks: string[] = [];

  if (projectsNeedingAttention.length > 0) {
    risks.push(
      `${countLabel(projectsNeedingAttention.length, 'project')} currently needs executive attention.`,
    );
  }

  if (overdueActionItems.length > 0) {
    risks.push(
      `${countLabel(overdueActionItems.length, 'action item')} is overdue.`,
    );
  }

  if (safetyConcerns.length > 0) {
    risks.push(
      `${countLabel(safetyConcerns.length, 'open safety concern')} remains unresolved.`,
    );
  }

  if (upcomingMilestones.length > 0) {
    risks.push(
      `${countLabel(upcomingMilestones.length, 'milestone')} is due within ${UPCOMING_MILESTONE_DAYS} days.`,
    );
  }

  if (updatesThisWeek === 0) {
    risks.push('No project updates were captured during this weekly reporting window.');
  }

  projectHealth
    .flatMap(project =>
      project.risks.map(item => `${project.projectName}: ${item}`),
    )
    .forEach(item => risks.push(item));

  const uniqueRisks = uniqueItems(risks);

  return uniqueRisks.length > 0
    ? uniqueRisks.slice(0, 6)
    : ['No major weekly risks were detected from the current local data.'];
}

function buildExecutiveActions({
  projectsNeedingAttention,
  overdueActionItems,
  safetyConcerns,
  upcomingMilestones,
  updatesThisWeek,
  projectHealth,
}: {
  projectsNeedingAttention: ProjectHealth[];
  overdueActionItems: ReportActionItem[];
  safetyConcerns: string[];
  upcomingMilestones: string[];
  updatesThisWeek: number;
  projectHealth: ProjectHealth[];
}) {
  const actions: string[] = [];

  if (projectsNeedingAttention.length > 0) {
    actions.push('Review projects needing attention and confirm owner-level recovery plans.');
  }

  if (overdueActionItems.length > 0) {
    actions.push('Resolve overdue action items or reset committed due dates before the next report.');
  }

  if (safetyConcerns.length > 0) {
    actions.push('Confirm every open safety concern has an owner and documented resolution path.');
  }

  if (upcomingMilestones.length > 0) {
    actions.push(`Confirm readiness for milestones due in the next ${UPCOMING_MILESTONE_DAYS} days.`);
  }

  if (updatesThisWeek === 0) {
    actions.push('Request a fresh field update with current photos and notes.');
  }

  projectHealth
    .flatMap(project =>
      project.recommendations.map(item => `${project.projectName}: ${item}`),
    )
    .forEach(item => actions.push(item));

  const uniqueActions = uniqueItems(actions);

  return uniqueActions.length > 0
    ? uniqueActions.slice(0, 5)
    : ['Continue the current update cadence and monitor field conditions.'];
}

export function generateWeeklyExecutiveReport({
  projects,
  updates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
}: WeeklyExecutiveReportParams): WeeklyExecutiveReport {
  const today = startOfToday();
  const start = periodStart(today);
  const periodLabel = `${formatShortDate(start)} - ${formatShortDate(today)}`;
  const projectNames = projectNamesFromData({
    projects,
    updates,
    scheduleItems,
    currentUpdate,
  });
  const reportUpdates = updatesWithCurrent(updates, currentUpdate);
  const projectHealth = projectHealthScores({
    projectNames,
    updates,
    scheduleItems,
    currentUpdate,
  });
  const weeklyUpdates = reportUpdates.filter(update =>
    isDateInPeriod(parseUpdateDate(update.date), start, today),
  );
  const photosThisWeek = weeklyUpdates.reduce(
    (total, update) => total + update.photos.length,
    0,
  );
  const weeklyDocuments = referenceDocuments.filter(document =>
    isDateInPeriod(parseStoredDate(document.importedAt), start, today),
  );
  const openActionItems = actionItemsFromUpdates(reportUpdates);
  const overdueActionItems = openActionItems.filter(item => item.isOverdue);
  const safetyConcerns = reportUpdates.flatMap(update =>
    update.photos
      .filter(isOpenSafetyConcern)
      .map(photo => safetyConcernText(update, photo)),
  );
  const upcomingMilestones = scheduleItems
    .filter(item => item.status !== 'Complete')
    .filter(item => {
      const days = daysUntilDate(item.finishDate);

      return days !== null && days >= 0 && days <= UPCOMING_MILESTONE_DAYS;
    })
    .sort(
      (a, b) =>
        (daysUntilDate(a.finishDate) ?? 9999) -
        (daysUntilDate(b.finishDate) ?? 9999),
    )
    .map(upcomingMilestoneText);
  const projectsNeedingAttention = projectHealth
    .filter(project => project.score < 70)
    .sort((a, b) => a.score - b.score);
  const projectAttentionText = projectsNeedingAttention.map(project => {
    const detail = project.risks[0] || 'Review project status and next steps.';

    return `${project.projectName}: ${project.score}/100 health score. ${detail}`;
  });
  const recentUpdates = weeklyUpdates
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
    .map(recentUpdateText);
  const documentUpdates = weeklyDocuments.slice(0, 5).map(documentUpdateText);
  const keyAccomplishments = buildAccomplishments({
    updatesThisWeek: weeklyUpdates.length,
    photosThisWeek,
    documentsThisWeek: weeklyDocuments.length,
    projectHealth,
  });
  const topRisks = buildRisks({
    projectsNeedingAttention,
    overdueActionItems,
    safetyConcerns,
    upcomingMilestones,
    updatesThisWeek: weeklyUpdates.length,
    projectHealth,
  });
  const recommendedExecutiveActions = buildExecutiveActions({
    projectsNeedingAttention,
    overdueActionItems,
    safetyConcerns,
    upcomingMilestones,
    updatesThisWeek: weeklyUpdates.length,
    projectHealth,
  });
  const overallHealthScore = averageHealthScore(projectHealth);
  const executiveSummary =
    `For ${periodLabel}, the portfolio health score is ${overallHealthScore}/100 across ${countLabel(projectNames.length, 'project')}. ` +
    `${countLabel(weeklyUpdates.length, 'update')} and ${countLabel(photosThisWeek, 'photo')} were captured this week, with ${countLabel(openActionItems.length, 'open action item')}, ${countLabel(overdueActionItems.length, 'overdue action item')}, and ${countLabel(safetyConcerns.length, 'open safety concern')}. ` +
    `${countLabel(upcomingMilestones.length, 'milestone')} is due within ${UPCOMING_MILESTONE_DAYS} days, and ${countLabel(weeklyDocuments.length, 'reference document')} was added or refreshed.`;

  return {
    periodLabel,
    metrics: {
      overallHealthScore,
      projectsNeedingAttention: projectsNeedingAttention.length,
      updatesThisWeek: weeklyUpdates.length,
      photosThisWeek,
      documentsThisWeek: weeklyDocuments.length,
      openActionItems: openActionItems.length,
      overdueActionItems: overdueActionItems.length,
      safetyConcerns: safetyConcerns.length,
      upcomingMilestones: upcomingMilestones.length,
    },
    recentUpdates:
      recentUpdates.length > 0
        ? recentUpdates
        : ['No updates were captured during this weekly reporting window.'],
    documentUpdates:
      documentUpdates.length > 0
        ? documentUpdates
        : ['No reference documents were added or refreshed this week.'],
    projectsNeedingAttention:
      projectAttentionText.length > 0
        ? projectAttentionText.slice(0, 5)
        : ['No projects currently fall below the attention threshold.'],
    openActionItems:
      openActionItems.length > 0
        ? openActionItems.slice(0, 6).map(actionItemText)
        : ['No open action items detected from saved updates.'],
    overdueActionItems:
      overdueActionItems.length > 0
        ? overdueActionItems.slice(0, 6).map(actionItemText)
        : ['No overdue action items detected.'],
    safetyConcerns:
      safetyConcerns.length > 0
        ? safetyConcerns.slice(0, 6)
        : ['No open safety concerns detected from saved updates.'],
    upcomingMilestones:
      upcomingMilestones.length > 0
        ? upcomingMilestones.slice(0, 6)
        : [`No milestones due within ${UPCOMING_MILESTONE_DAYS} days.`],
    keyAccomplishments,
    topRisks,
    recommendedExecutiveActions,
    executiveSummary,
  };
}
