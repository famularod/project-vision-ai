import { analyzeProjectCoach } from './AIProjectCoach';
import { buildProjectRiskMatrix } from './ProjectRiskService';
import { generateWeeklyExecutiveReport } from './WeeklyExecutiveReportService';
import type {
  ProjectRisk,
  RiskSeverity,
} from './ProjectRiskService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  parseDueDate,
  parseFlexibleDate,
} from '../utils/date';

export type PortfolioSortKey =
  | 'Health'
  | 'Project Name'
  | 'Last Updated'
  | 'Risk'
  | 'Schedule'
  | 'Safety';

export type PortfolioFilterKey =
  | 'Active'
  | 'Completed'
  | 'At Risk'
  | 'Healthy'
  | 'On Hold';

export type PortfolioProjectStatus =
  | 'Healthy'
  | 'Warning'
  | 'Critical'
  | 'Completed'
  | 'On Hold';

export type PortfolioMetricSummary = {
  openActionItems: number;
  overdueActionItems: number;
  safetyConcerns: number;
  photosThisWeek: number;
  updatesThisWeek: number;
  upcomingMilestones: number;
  overdueMilestones: number;
  documentsAdded: number;
};

export type PortfolioProject = {
  projectName: string;
  healthScore: number;
  status: PortfolioProjectStatus;
  lastUpdate: string;
  lastUpdateTimestamp: number;
  openItems: number;
  overdueItems: number;
  safetyIssues: number;
  nextMilestone: string;
  nextMilestoneDays: number | null;
  aiHealthIndicator: string;
  riskScore: number;
  scheduleRiskScore: number;
  safetyRiskScore: number;
  archived: boolean;
};

export type PortfolioDashboard = {
  summary: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    onHoldProjects: number;
    overallHealthScore: number;
  };
  statusCounts: Record<PortfolioProjectStatus, number>;
  metrics: PortfolioMetricSummary;
  executivePriorities: string[];
  projects: PortfolioProject[];
};

type PortfolioDashboardParams = {
  activeProjects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate?: ProjectUpdate | null;
};

export const PORTFOLIO_SORT_OPTIONS: PortfolioSortKey[] = [
  'Health',
  'Project Name',
  'Last Updated',
  'Risk',
  'Schedule',
  'Safety',
];

export const PORTFOLIO_FILTER_OPTIONS: PortfolioFilterKey[] = [
  'Active',
  'Completed',
  'At Risk',
  'Healthy',
  'On Hold',
];

const WEEK_DAYS = 7;
const UPCOMING_MILESTONE_DAYS = 14;

const severityRank: Record<RiskSeverity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function uniqueProjectNames(names: string[]) {
  const projectNames: string[] = [];

  names.forEach(name => {
    const trimmed = name.trim();

    if (
      trimmed &&
      !projectNames.some(project => isSameProject(project, trimmed))
    ) {
      projectNames.push(trimmed);
    }
  });

  return projectNames;
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function updatesWithCurrent(
  savedUpdates: ProjectUpdate[],
  currentUpdate?: ProjectUpdate | null,
) {
  if (
    !currentUpdate ||
    !hasUpdateContent(currentUpdate) ||
    savedUpdates.some(update => update.id === currentUpdate.id)
  ) {
    return savedUpdates;
  }

  return [currentUpdate, ...savedUpdates];
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

function formatShortDate(date: Date | null) {
  if (!date) return 'No update';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

function isDateInPeriod(date: Date | null, start: Date, end: Date) {
  return Boolean(date && date >= start && date <= end);
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

function latestUpdateDate(updates: ProjectUpdate[]) {
  return updates
    .map(parseUpdateDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function scheduleDate(item: ScheduleItem) {
  return (
    parseFlexibleDate(item.finishDate) ||
    parseFlexibleDate(item.startDate) ||
    parseStoredDate(item.importedAt) ||
    parseStoredDate(item.createdAt)
  );
}

function nextMilestone(scheduleItems: ScheduleItem[]) {
  const next = scheduleItems
    .filter(item => item.status !== 'Complete')
    .map(item => ({
      item,
      date: scheduleDate(item),
      days: daysUntilDate(item.finishDate),
    }))
    .filter(entry => entry.date)
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))[0];

  if (!next) {
    return {
      label: 'No upcoming milestone',
      days: null,
    };
  }

  const title = next.item.milestone || next.item.taskName || 'Schedule milestone';
  const dueText = next.item.finishDate.trim()
    ? dueStatusText(next.item.finishDate)
    : 'No due date';

  return {
    label: `${title} - ${dueText}`,
    days: next.days,
  };
}

function projectRisks(
  projectName: string,
  risks: ProjectRisk[],
) {
  return risks.filter(risk => isSameProject(risk.relatedProject, projectName));
}

function riskScoreFor(risks: ProjectRisk[]) {
  return risks.reduce(
    (total, risk) => total + severityRank[risk.severity],
    0,
  );
}

function topRiskSeverity(risks: ProjectRisk[]) {
  return risks
    .map(risk => risk.severity)
    .sort((a, b) => severityRank[b] - severityRank[a])[0] || 'Low';
}

function statusForProject({
  archived,
  healthScore,
  risks,
  scheduleItems,
}: {
  archived: boolean;
  healthScore: number;
  risks: ProjectRisk[];
  scheduleItems: ScheduleItem[];
}): PortfolioProjectStatus {
  if (archived) return 'Completed';

  if (scheduleItems.some(item => item.status === 'Waiting')) {
    return 'On Hold';
  }

  const topSeverity = topRiskSeverity(risks);

  if (topSeverity === 'Critical' || healthScore < 55) return 'Critical';
  if (topSeverity === 'High' || healthScore < 75) return 'Warning';

  return 'Healthy';
}

function aiHealthIndicator(score: number) {
  if (score >= 80) return 'Strong';
  if (score >= 65) return 'Watch';
  if (score >= 50) return 'At Risk';

  return 'Critical';
}

function projectFromData({
  projectName,
  archived,
  savedUpdates,
  scheduleItems,
  currentUpdate,
  risks,
}: {
  projectName: string;
  archived: boolean;
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  risks: ProjectRisk[];
}): PortfolioProject {
  const projectUpdates = savedUpdates.filter(update =>
    isSameProject(update.projectName, projectName),
  );
  const projectScheduleItems = scheduleItems.filter(item =>
    isSameProject(item.projectName, projectName),
  );
  const analysis = analyzeProjectCoach({
    projectName,
    updates: savedUpdates,
    scheduleItems,
    currentUpdate:
      currentUpdate && isSameProject(currentUpdate.projectName, projectName)
        ? currentUpdate
        : null,
  });
  const photos = projectUpdates.flatMap(update => update.photos);
  const openActions = photos.filter(isOpenAction);
  const overdueActions = openActions.filter(isOverdueAction);
  const safetyIssues = photos.filter(
    photo => photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed',
  );
  const relatedRisks = projectRisks(projectName, risks);
  const scheduleRiskScore = riskScoreFor(
    relatedRisks.filter(risk => risk.category === 'Schedule risk'),
  );
  const safetyRiskScore = riskScoreFor(
    relatedRisks.filter(risk => risk.category === 'Safety risk'),
  );
  const lastUpdateDate = latestUpdateDate(projectUpdates);
  const milestone = nextMilestone(projectScheduleItems);
  const status = statusForProject({
    archived,
    healthScore: analysis.score,
    risks: relatedRisks,
    scheduleItems: projectScheduleItems,
  });

  return {
    projectName,
    healthScore: analysis.score,
    status,
    lastUpdate: formatShortDate(lastUpdateDate),
    lastUpdateTimestamp: lastUpdateDate?.getTime() ?? 0,
    openItems: openActions.length,
    overdueItems: overdueActions.length,
    safetyIssues: safetyIssues.length,
    nextMilestone: milestone.label,
    nextMilestoneDays: milestone.days,
    aiHealthIndicator: aiHealthIndicator(analysis.score),
    riskScore: riskScoreFor(relatedRisks),
    scheduleRiskScore,
    safetyRiskScore,
    archived,
  };
}

function countDocumentsThisWeek(referenceDocuments: ReferenceDocument[]) {
  const today = startOfToday();
  const start = periodStart(today);

  return referenceDocuments.filter(document =>
    isDateInPeriod(parseStoredDate(document.importedAt), start, today),
  ).length;
}

function overdueMilestones(scheduleItems: ScheduleItem[]) {
  return scheduleItems.filter(item => {
    if (item.status === 'Complete') return false;

    const days = daysUntilDate(item.finishDate);

    return days !== null && days < 0;
  }).length;
}

function statusCounts(projects: PortfolioProject[]) {
  return projects.reduce<Record<PortfolioProjectStatus, number>>(
    (summary, project) => {
      summary[project.status] += 1;
      return summary;
    },
    {
      Healthy: 0,
      Warning: 0,
      Critical: 0,
      Completed: 0,
      'On Hold': 0,
    },
  );
}

function averageHealth(projects: PortfolioProject[]) {
  if (projects.length === 0) return 0;

  return Math.round(
    projects.reduce((total, project) => total + project.healthScore, 0) /
      projects.length,
  );
}

function priorityText(risk: ProjectRisk) {
  return `${risk.relatedProject}: ${risk.title} - ${risk.recommendedAction}`;
}

function executivePriorities(risks: ProjectRisk[]) {
  const prioritized = [...risks]
    .filter(risk => risk.severity !== 'Low')
    .sort((a, b) => {
      if (severityRank[b.severity] !== severityRank[a.severity]) {
        return severityRank[b.severity] - severityRank[a.severity];
      }

      return a.relatedProject.localeCompare(b.relatedProject);
    })
    .map(priorityText);

  return prioritized.length > 0
    ? prioritized.slice(0, 10)
    : ['No elevated portfolio priorities detected from current project data.'];
}

export function buildPortfolioDashboard({
  activeProjects,
  archivedProjects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
}: PortfolioDashboardParams): PortfolioDashboard {
  const allProjectNames = uniqueProjectNames([
    ...activeProjects,
    ...archivedProjects,
    ...savedUpdates.map(update => update.projectName),
    ...scheduleItems.map(item => item.projectName),
    ...(currentUpdate && hasUpdateContent(currentUpdate)
      ? [currentUpdate.projectName]
      : []),
  ]);
  const activeProjectSet = new Set(
    activeProjects.map(project => project.trim().toLowerCase()),
  );
  const archivedProjectSet = new Set(
    archivedProjects.map(project => project.trim().toLowerCase()),
  );
  const allUpdates = updatesWithCurrent(savedUpdates, currentUpdate);
  const riskMatrix = buildProjectRiskMatrix({
    projects: allProjectNames,
    updates: savedUpdates,
    scheduleItems,
    referenceDocuments,
    currentUpdate,
  });
  const portfolioProjects = allProjectNames.map(projectName =>
    projectFromData({
      projectName,
      archived: archivedProjectSet.has(projectName.trim().toLowerCase()) &&
        !activeProjectSet.has(projectName.trim().toLowerCase()),
      savedUpdates: allUpdates,
      scheduleItems,
      currentUpdate,
      risks: riskMatrix.risks,
    }),
  );
  const weeklyReport = generateWeeklyExecutiveReport({
    projects: allProjectNames,
    updates: savedUpdates,
    scheduleItems,
    referenceDocuments,
    currentUpdate,
  });
  const counts = statusCounts(portfolioProjects);

  return {
    summary: {
      totalProjects: portfolioProjects.length,
      activeProjects: portfolioProjects.filter(project => !project.archived).length,
      completedProjects: counts.Completed,
      onHoldProjects: counts['On Hold'],
      overallHealthScore: averageHealth(portfolioProjects),
    },
    statusCounts: counts,
    metrics: {
      openActionItems: weeklyReport.metrics.openActionItems,
      overdueActionItems: weeklyReport.metrics.overdueActionItems,
      safetyConcerns: weeklyReport.metrics.safetyConcerns,
      photosThisWeek: weeklyReport.metrics.photosThisWeek,
      updatesThisWeek: weeklyReport.metrics.updatesThisWeek,
      upcomingMilestones: weeklyReport.metrics.upcomingMilestones,
      overdueMilestones: overdueMilestones(scheduleItems),
      documentsAdded: countDocumentsThisWeek(referenceDocuments),
    },
    executivePriorities: executivePriorities(riskMatrix.risks),
    projects: portfolioProjects,
  };
}

export function filterPortfolioProjects(
  projects: PortfolioProject[],
  filter: PortfolioFilterKey,
) {
  return projects.filter(project => {
    if (filter === 'Active') return !project.archived;
    if (filter === 'Completed') return project.status === 'Completed';
    if (filter === 'At Risk') {
      return project.status === 'Warning' || project.status === 'Critical';
    }
    if (filter === 'Healthy') return project.status === 'Healthy';
    if (filter === 'On Hold') return project.status === 'On Hold';

    return true;
  });
}

export function sortPortfolioProjects(
  projects: PortfolioProject[],
  sortKey: PortfolioSortKey,
) {
  return [...projects].sort((a, b) => {
    if (sortKey === 'Health') return a.healthScore - b.healthScore;
    if (sortKey === 'Project Name') return a.projectName.localeCompare(b.projectName);
    if (sortKey === 'Last Updated') return b.lastUpdateTimestamp - a.lastUpdateTimestamp;
    if (sortKey === 'Risk') return b.riskScore - a.riskScore;
    if (sortKey === 'Schedule') return b.scheduleRiskScore - a.scheduleRiskScore;
    if (sortKey === 'Safety') return b.safetyRiskScore - a.safetyRiskScore;

    return a.projectName.localeCompare(b.projectName);
  });
}
