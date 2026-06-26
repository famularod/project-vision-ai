import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  formatAppDate,
  parseFlexibleDate,
} from '../utils/date';

const DOCUMENT_REVIEW_DAYS = 30;
const UPDATE_FREQUENCY_DAYS = 14;

export type DelayCategory =
  | 'Schedule delay'
  | 'Action item delay'
  | 'Safety-related delay'
  | 'Documentation delay'
  | 'Update frequency delay'
  | 'Unknown/uncategorized delay';

export type DelayImpactLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type DelayItem = {
  id: string;
  projectName: string;
  areaName: string;
  category: DelayCategory;
  daysLate: number | null;
  isAtRisk: boolean;
  impact: DelayImpactLevel;
  likelyCause: string;
  recommendedAction: string;
  relatedItem: string;
  relatedMilestone: string;
};

export type DelayCause = {
  category: DelayCategory;
  count: number;
  criticalCount: number;
  detail: string;
};

export type DelayAnalysis = {
  delays: DelayItem[];
  summary: {
    totalDelayedItems: number;
    criticalDelays: number;
    atRiskDelays: number;
    averageDaysLate: number;
    impactedProjects: string[];
    impactedMilestones: string[];
    executiveSummary: string;
  };
  causes: DelayCause[];
  recommendedRecoveryActions: string[];
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
  const actionCategory =
    photo.category === 'Open Issue' || photo.category === 'Safety Concern';
  const actionDetails = Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );

  return actionCategory && photo.actionStatus !== 'Closed' && actionDetails;
}

function photoArea(update: ProjectUpdate, photo: UpdatePhoto) {
  return photo.selectedAreaName || update.selectedAreaName || '';
}

function today() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function daysSince(value: string) {
  const parsed = parseFlexibleDate(value);

  if (!parsed) return null;

  return Math.max(0, Math.round((today().getTime() - parsed.getTime()) / 86400000));
}

function daysSinceStoredDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today().getTime() - parsed.getTime()) / 86400000));
}

function delayImpact({
  category,
  daysLate,
  priority,
  isAtRisk,
}: {
  category: DelayCategory;
  daysLate: number | null;
  priority?: ScheduleItem['priority'];
  isAtRisk: boolean;
}): DelayImpactLevel {
  if (category === 'Safety-related delay' && (daysLate === null || daysLate >= 0)) {
    return 'Critical';
  }
  if (
    (daysLate !== null && daysLate >= 14) ||
    (priority === 'High' && daysLate !== null && daysLate > 0)
  ) {
    return 'Critical';
  }
  if (
    (daysLate !== null && daysLate >= 7) ||
    priority === 'High' ||
    category === 'Action item delay'
  ) {
    return 'High';
  }
  if ((daysLate !== null && daysLate > 0) || isAtRisk) return 'Medium';

  return 'Low';
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

function dateLabel(value: string) {
  return value.trim() ? formatAppDate(value) : 'No due date';
}

function delaySort(left: DelayItem, right: DelayItem) {
  const impactOrder: Record<DelayImpactLevel, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  };

  return (
    impactOrder[left.impact] - impactOrder[right.impact] ||
    (right.daysLate ?? -1) - (left.daysLate ?? -1) ||
    left.projectName.localeCompare(right.projectName)
  );
}

function latestUpdateDays(projectName: string, updates: ProjectUpdate[]) {
  const dates = updates
    .filter(update => isSameValue(update.projectName, projectName))
    .map(update => parseFlexibleDate(update.date))
    .filter((date): date is Date => Boolean(date));

  if (dates.length === 0) return null;

  const latest = dates.reduce((current, date) =>
    date > current ? date : current,
  );

  return Math.max(0, Math.round((today().getTime() - latest.getTime()) / 86400000));
}

function causeDetail(category: DelayCategory) {
  const details: Record<DelayCategory, string> = {
    'Schedule delay': 'Scheduled work is past its tracked finish date or due soon with elevated risk.',
    'Action item delay': 'An open action item has passed its assigned due date.',
    'Safety-related delay': 'An unresolved safety concern requires closure before progress can continue safely.',
    'Documentation delay': 'A reference document is not current and is beyond its review window.',
    'Update frequency delay': 'Field updates are missing or outside the expected reporting cadence.',
    'Unknown/uncategorized delay': 'An active schedule item lacks enough timing data to assess its delay.',
  };

  return details[category];
}

export function analyzeDelays({
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
}): DelayAnalysis {
  const allUpdates =
    currentUpdate &&
    hasUpdateContent(currentUpdate) &&
    !updates.some(update => update.id === currentUpdate.id)
      ? [currentUpdate, ...updates]
      : updates;
  const delays: DelayItem[] = [];

  scheduleItems.forEach(item => {
    if (item.status === 'Complete') return;

    const daysUntilDue = daysUntilDate(item.finishDate);
    const daysLate = daysUntilDue !== null && daysUntilDue < 0
      ? Math.abs(daysUntilDue)
      : null;
    const isAtRisk =
      daysUntilDue !== null &&
      daysUntilDue >= 0 &&
      daysUntilDue <= 7 &&
      (item.priority === 'High' || item.status === 'Waiting' || item.percentComplete <= 25);
    const milestone = item.milestone || item.taskName || 'Scheduled task';

    if (daysLate !== null || isAtRisk || item.status === 'Waiting') {
      const impact = delayImpact({
        category: 'Schedule delay',
        daysLate,
        priority: item.priority,
        isAtRisk,
      });

      delays.push({
        id: `schedule-${item.id}`,
        projectName: item.projectName || 'Unassigned project',
        areaName: item.locationName || '',
        category: 'Schedule delay',
        daysLate,
        isAtRisk,
        impact,
        likelyCause:
          item.status === 'Waiting'
            ? 'The schedule item is waiting for a dependency, decision, or field condition.'
            : daysLate !== null
              ? `${milestone} was due ${dateLabel(item.finishDate)} and remains ${item.status.toLowerCase()}.`
              : `${milestone} is due within seven days with ${item.percentComplete}% progress and ${item.priority.toLowerCase()} priority.`,
        recommendedAction:
          daysLate !== null
            ? `Assign a recovery owner and revised finish date for ${milestone}.`
            : `Confirm owner readiness and remove constraints before ${milestone} reaches its due date.`,
        relatedItem: milestone,
        relatedMilestone: item.milestone || item.taskName,
      });
    }

    if (!item.finishDate.trim() && (item.status === 'Waiting' || item.priority === 'High')) {
      delays.push({
        id: `unknown-${item.id}`,
        projectName: item.projectName || 'Unassigned project',
        areaName: item.locationName || '',
        category: 'Unknown/uncategorized delay',
        daysLate: null,
        isAtRisk: true,
        impact: delayImpact({
          category: 'Unknown/uncategorized delay',
          daysLate: null,
          priority: item.priority,
          isAtRisk: true,
        }),
        likelyCause: `${milestone} has no tracked finish date, so schedule exposure cannot be quantified.`,
        recommendedAction: `Add an owner-confirmed finish date and recovery checkpoint for ${milestone}.`,
        relatedItem: milestone,
        relatedMilestone: item.milestone || item.taskName,
      });
    }
  });

  allUpdates.forEach(update => {
    update.photos.filter(isOpenAction).forEach(photo => {
      const daysUntilDue = daysUntilDate(photo.actionDueDate);
      const daysLate = daysUntilDue !== null && daysUntilDue < 0
        ? Math.abs(daysUntilDue)
        : null;
      const isSafety = photo.category === 'Safety Concern';
      const isAtRisk =
        daysUntilDue !== null &&
        daysUntilDue >= 0 &&
        daysUntilDue <= 3;

      if (daysLate === null && !isAtRisk && !isSafety) return;

      const category: DelayCategory = isSafety
        ? 'Safety-related delay'
        : 'Action item delay';
      const actionName = photo.actionRequired || photo.caption || photo.category;
      const areaName = photoArea(update, photo);

      delays.push({
        id: `${category}-${update.id}-${photo.id}`,
        projectName: update.projectName || 'Unassigned project',
        areaName,
        category,
        daysLate,
        isAtRisk,
        impact: delayImpact({
          category,
          daysLate,
          isAtRisk,
        }),
        likelyCause: isSafety
          ? `Safety concern remains ${photo.actionStatus.toLowerCase()}${photo.actionDueDate ? ` after its due date of ${dateLabel(photo.actionDueDate)}` : ''}.`
          : `${actionName} remains ${photo.actionStatus.toLowerCase()}${photo.actionDueDate ? ` after its due date of ${dateLabel(photo.actionDueDate)}` : ''}.`,
        recommendedAction: isSafety
          ? `Confirm safe work conditions, owner accountability, and documented closure for ${actionName}.`
          : `Resolve or re-date ${actionName} with the assigned owner.`,
        relatedItem: actionName,
        relatedMilestone: '',
      });
    });
  });

  referenceDocuments.forEach(document => {
    const age = daysSinceStoredDate(document.importedAt);

    if (document.isCurrent || age === null || age <= DOCUMENT_REVIEW_DAYS) return;

    const daysLate = age - DOCUMENT_REVIEW_DAYS;

    delays.push({
      id: `document-${document.id}`,
      projectName: 'Portfolio Documentation',
      areaName: document.category || 'Reference Documents',
      category: 'Documentation delay',
      daysLate,
      isAtRisk: false,
      impact: delayImpact({
        category: 'Documentation delay',
        daysLate,
        isAtRisk: false,
      }),
      likelyCause: `${document.name || document.originalFileName} is not current and has not been refreshed within ${DOCUMENT_REVIEW_DAYS} days.`,
      recommendedAction: `Review ${document.name || document.originalFileName} and mark the current reference document for its category.`,
      relatedItem: document.name || document.originalFileName,
      relatedMilestone: '',
    });
  });

  const activeProjectNames = uniqueItems([
    ...projects,
    ...scheduleItems
      .filter(item => item.status !== 'Complete')
      .map(item => item.projectName),
  ]);

  activeProjectNames.forEach(projectName => {
    const hasActiveSchedule = scheduleItems.some(
      item => item.status !== 'Complete' && isSameValue(item.projectName, projectName),
    );

    if (!hasActiveSchedule) return;

    const age = latestUpdateDays(projectName, allUpdates);

    if (age !== null && age <= UPDATE_FREQUENCY_DAYS) return;

    const daysLate = age === null ? null : age - UPDATE_FREQUENCY_DAYS;

    delays.push({
      id: `update-frequency-${normalized(projectName)}`,
      projectName,
      areaName: '',
      category: 'Update frequency delay',
      daysLate,
      isAtRisk: true,
      impact: delayImpact({
        category: 'Update frequency delay',
        daysLate,
        isAtRisk: true,
      }),
      likelyCause: age === null
        ? `No saved update is available while ${projectName} has active schedule work.`
        : `The latest saved update is ${age} days old, beyond the ${UPDATE_FREQUENCY_DAYS}-day reporting cadence.`,
      recommendedAction: `Capture a current field update with photos and notes for ${projectName}.`,
      relatedItem: 'Project update cadence',
      relatedMilestone: '',
    });
  });

  const sortedDelays = delays.sort(delaySort);
  const delayedOnly = sortedDelays.filter(delay => delay.daysLate !== null && delay.daysLate > 0);
  const causes = (Object.keys({
    'Schedule delay': true,
    'Action item delay': true,
    'Safety-related delay': true,
    'Documentation delay': true,
    'Update frequency delay': true,
    'Unknown/uncategorized delay': true,
  }) as DelayCategory[])
    .map(category => {
      const categoryDelays = sortedDelays.filter(delay => delay.category === category);

      return {
        category,
        count: categoryDelays.length,
        criticalCount: categoryDelays.filter(delay => delay.impact === 'Critical').length,
        detail: causeDetail(category),
      };
    })
    .filter(cause => cause.count > 0)
    .sort((left, right) => right.criticalCount - left.criticalCount || right.count - left.count);
  const impactedProjects = uniqueItems(
    sortedDelays
      .map(delay => delay.projectName)
      .filter(project => project !== 'Portfolio Documentation'),
  );
  const impactedMilestones = uniqueItems(
    sortedDelays.map(delay => delay.relatedMilestone),
  );
  const criticalDelays = sortedDelays.filter(delay => delay.impact === 'Critical').length;
  const atRiskDelays = sortedDelays.filter(delay => delay.isAtRisk).length;
  const averageDaysLate = delayedOnly.length > 0
    ? Math.round(delayedOnly.reduce((total, delay) => total + (delay.daysLate || 0), 0) / delayedOnly.length)
    : 0;
  const recommendedRecoveryActions = uniqueItems(
    sortedDelays.map(delay => delay.recommendedAction),
  ).slice(0, 6);
  const executiveSummary =
    sortedDelays.length === 0
      ? 'No active delays or near-term delay risks are detected from the current local schedule, update, action, safety, and document data.'
      : `${sortedDelays.length} delay signal${sortedDelays.length === 1 ? '' : 's'} affect ${impactedProjects.length || 0} project${impactedProjects.length === 1 ? '' : 's'}, including ${criticalDelays} critical delay${criticalDelays === 1 ? '' : 's'} and ${atRiskDelays} at-risk item${atRiskDelays === 1 ? '' : 's'}. Average measured lateness is ${averageDaysLate} day${averageDaysLate === 1 ? '' : 's'}.`;

  return {
    delays: sortedDelays,
    summary: {
      totalDelayedItems: delayedOnly.length,
      criticalDelays,
      atRiskDelays,
      averageDaysLate,
      impactedProjects,
      impactedMilestones,
      executiveSummary,
    },
    causes,
    recommendedRecoveryActions:
      recommendedRecoveryActions.length > 0
        ? recommendedRecoveryActions
        : ['Maintain the current schedule review cadence and capture updates as work progresses.'],
  };
}
