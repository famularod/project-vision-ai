import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  parseFlexibleDate,
} from '../utils/date';

const UPDATE_FREQUENCY_DAYS = 14;
const DOCUMENT_REVIEW_DAYS = 30;

export const CONTRACTOR_FILTERS = [
  'All',
  'High Risk',
  'Safety Issues',
  'Schedule Risk',
  'Overdue Items',
  'By Project',
] as const;

export type ContractorFilter = typeof CONTRACTOR_FILTERS[number];
export type ContractorRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type ContractorPerformance = {
  contractorName: string;
  activeProjects: string[];
  openActionItems: number;
  overdueActionItems: number;
  safetyConcerns: number;
  delayedMilestones: number;
  delayedScheduleItems: number;
  recentUpdates: number;
  staleUpdateProjects: number;
  documentationIssues: number;
  performanceScore: number;
  riskLevel: ContractorRiskLevel;
  recommendedManagementAction: string;
};

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
  return (
    (photo.category === 'Open Issue' || photo.category === 'Safety Concern') &&
    photo.actionStatus !== 'Closed' &&
    Boolean(
      photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    )
  );
}

function photoMatchesContractorTask(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  tasks: ScheduleItem[],
) {
  return tasks.some(task => {
    if (!isSameValue(task.projectName, update.projectName)) return false;
    if (!task.locationName.trim()) return true;

    const area = photo.selectedAreaName || update.selectedAreaName || '';

    return !area || isSameValue(area, task.locationName);
  });
}

function daysSinceUpdate(value: string) {
  const date = parseFlexibleDate(value);

  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
}

function latestProjectUpdateAge(projectName: string, updates: ProjectUpdate[]) {
  const dates = updates
    .filter(update => isSameValue(update.projectName, projectName))
    .map(update => parseFlexibleDate(update.date))
    .filter((date): date is Date => Boolean(date));

  if (dates.length === 0) return null;

  const latest = dates.reduce((current, date) =>
    date > current ? date : current,
  );

  return daysSinceUpdate(latest.toISOString().slice(0, 10));
}

function staleDocumentCount(documents: ReferenceDocument[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return documents.filter(document => {
    if (document.isCurrent) return false;

    const imported = new Date(document.importedAt);

    if (Number.isNaN(imported.getTime())) return false;

    imported.setHours(0, 0, 0, 0);
    const age = Math.max(0, Math.round((today.getTime() - imported.getTime()) / 86400000));

    return age > DOCUMENT_REVIEW_DAYS;
  }).length;
}

function scoreRisk({
  overdueActionItems,
  safetyConcerns,
  delayedScheduleItems,
  delayedMilestones,
  staleUpdateProjects,
  documentationIssues,
}: Omit<ContractorPerformance, 'contractorName' | 'activeProjects' | 'openActionItems' | 'recentUpdates' | 'performanceScore' | 'riskLevel' | 'recommendedManagementAction'>) {
  let score = 100;

  score -= Math.min(overdueActionItems * 8, 32);
  score -= Math.min(safetyConcerns * 15, 30);
  score -= Math.min(delayedScheduleItems * 7, 28);
  score -= Math.min(delayedMilestones * 5, 20);
  score -= Math.min(staleUpdateProjects * 5, 15);
  score -= Math.min(documentationIssues * 4, 8);

  const performanceScore = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel: ContractorRiskLevel =
    safetyConcerns > 0 || overdueActionItems >= 2 || performanceScore < 50
      ? 'Critical'
      : overdueActionItems > 0 || delayedScheduleItems > 0 || performanceScore < 65
        ? 'High'
        : staleUpdateProjects > 0 || documentationIssues > 0 || performanceScore < 80
          ? 'Medium'
          : 'Low';

  return {
    performanceScore,
    riskLevel,
  };
}

function managementAction({
  contractorName,
  safetyConcerns,
  overdueActionItems,
  delayedScheduleItems,
  staleUpdateProjects,
  documentationIssues,
}: Pick<
  ContractorPerformance,
  | 'contractorName'
  | 'safetyConcerns'
  | 'overdueActionItems'
  | 'delayedScheduleItems'
  | 'staleUpdateProjects'
  | 'documentationIssues'
>) {
  if (safetyConcerns > 0) {
    return `Require ${contractorName} to document safety closure and safe-work readiness before affected work continues.`;
  }
  if (overdueActionItems > 0) {
    return `Review ${overdueActionItems} overdue action item${overdueActionItems === 1 ? '' : 's'} with ${contractorName} and confirm committed recovery dates.`;
  }
  if (delayedScheduleItems > 0) {
    return `Request a schedule recovery plan from ${contractorName} for delayed work and milestone commitments.`;
  }
  if (staleUpdateProjects > 0) {
    return `Request current field updates and photos from ${contractorName} for ${staleUpdateProjects} active project${staleUpdateProjects === 1 ? '' : 's'}.`;
  }
  if (documentationIssues > 0) {
    return `Confirm ${contractorName} is working from the current controlled project documentation.`;
  }

  return `Maintain the current performance cadence and confirm upcoming milestone readiness with ${contractorName}.`;
}

export function analyzeContractorPerformance({
  projects,
  scheduleItems,
  updates,
  referenceDocuments,
  currentUpdate,
}: {
  projects: string[];
  scheduleItems: ScheduleItem[];
  updates: ProjectUpdate[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate?: ProjectUpdate | null;
}) {
  const allUpdates =
    currentUpdate &&
    hasUpdateContent(currentUpdate) &&
    !updates.some(update => update.id === currentUpdate.id)
      ? [currentUpdate, ...updates]
      : updates;
  const tasksByContractor = new Map<string, ScheduleItem[]>();

  scheduleItems.forEach(item => {
    const name = item.contractor.trim();

    if (!name) return;

    const key = normalized(name);
    const contractorTasks = tasksByContractor.get(key) || [];

    contractorTasks.push(item);
    tasksByContractor.set(key, contractorTasks);
  });

  const documentationIssues = staleDocumentCount(referenceDocuments);
  const contractors = [...tasksByContractor.values()]
    .map(tasks => {
      const contractorName = tasks[0]?.contractor.trim() || 'Unassigned Contractor';
      const activeTasks = tasks.filter(item => item.status !== 'Complete');
      const activeProjects = [...new Set(activeTasks.map(item => item.projectName.trim()).filter(Boolean))];
      const taskPhotos = allUpdates.flatMap(update =>
        update.photos.filter(photo => photoMatchesContractorTask(update, photo, tasks)),
      );
      const openActions = taskPhotos.filter(isOpenAction);
      const overdueActionItems = openActions.filter(photo => {
        const days = daysUntilDate(photo.actionDueDate);

        return days !== null && days < 0;
      }).length;
      const safetyConcerns = taskPhotos.filter(
        photo => photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed',
      ).length;
      const delayedTasks = activeTasks.filter(item => {
        const days = daysUntilDate(item.finishDate);

        return days !== null && days < 0;
      });
      const delayedMilestones = delayedTasks.filter(item =>
        Boolean(item.milestone.trim()),
      ).length;
      const recentUpdates = allUpdates.filter(update => {
        const age = daysSinceUpdate(update.date);

        return (
          age !== null &&
          age <= UPDATE_FREQUENCY_DAYS &&
          tasks.some(task => isSameValue(task.projectName, update.projectName))
        );
      }).length;
      const staleUpdateProjects = activeProjects.filter(projectName => {
        const age = latestProjectUpdateAge(projectName, allUpdates);

        return age === null || age > UPDATE_FREQUENCY_DAYS;
      }).length;
      const scoring = scoreRisk({
        overdueActionItems,
        safetyConcerns,
        delayedScheduleItems: delayedTasks.length,
        delayedMilestones,
        staleUpdateProjects,
        documentationIssues,
      });

      return {
        contractorName,
        activeProjects,
        openActionItems: openActions.length,
        overdueActionItems,
        safetyConcerns,
        delayedMilestones,
        delayedScheduleItems: delayedTasks.length,
        recentUpdates,
        staleUpdateProjects,
        documentationIssues,
        ...scoring,
        recommendedManagementAction: managementAction({
          contractorName,
          overdueActionItems,
          safetyConcerns,
          delayedScheduleItems: delayedTasks.length,
          staleUpdateProjects,
          documentationIssues,
        }),
      } satisfies ContractorPerformance;
    })
    .sort((left, right) => left.performanceScore - right.performanceScore || left.contractorName.localeCompare(right.contractorName));

  const projectOptions = [...new Set([
    ...projects.map(project => project.trim()),
    ...contractors.flatMap(contractor => contractor.activeProjects),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));

  return {
    contractors,
    projectOptions,
  };
}

export function filterContractors({
  contractors,
  filter,
  projectName,
}: {
  contractors: ContractorPerformance[];
  filter: ContractorFilter;
  projectName?: string | null;
}) {
  const byProject = projectName?.trim()
    ? contractors.filter(contractor =>
        contractor.activeProjects.some(project => isSameValue(project, projectName)),
      )
    : contractors;

  if (filter === 'All' || filter === 'By Project') return byProject;
  if (filter === 'High Risk') {
    return byProject.filter(contractor =>
      contractor.riskLevel === 'High' || contractor.riskLevel === 'Critical',
    );
  }
  if (filter === 'Safety Issues') {
    return byProject.filter(contractor => contractor.safetyConcerns > 0);
  }
  if (filter === 'Schedule Risk') {
    return byProject.filter(contractor => contractor.delayedScheduleItems > 0 || contractor.delayedMilestones > 0);
  }

  return byProject.filter(contractor => contractor.overdueActionItems > 0);
}
