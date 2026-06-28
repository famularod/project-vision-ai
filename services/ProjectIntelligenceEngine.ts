import type {
  ContactBook,
  ProjectArea,
  ProjectContact,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  parseDueDate,
  parseFlexibleDate,
} from '../utils/date';
import {
  buildProjectEvents,
  getOpenDecisionEvents,
  getProjectEventTimeline,
  getProjectStory,
  getRecentProjectEvents,
  type ProjectEvent,
  type ProjectStory,
} from './ProjectEventService';
import {
  analyzeProjectLocationIntelligence,
  type ProjectLocationIntelligence,
} from './LocationIntelligenceService';

// PIE is intentionally rule-based today. It will later feed Project Overview,
// Project Assistant, Reports, Morning Brief, Customer Updates, and Executive Updates.

export type ProjectSignalSeverity =
  | 'positive'
  | 'neutral'
  | 'warning'
  | 'critical';

export type ProjectHealthStatus =
  | 'healthy'
  | 'watch'
  | 'at-risk'
  | 'unknown';

export type ProjectScheduleStatus =
  | 'not-available'
  | 'on-track'
  | 'due-soon'
  | 'overdue'
  | 'complete';

export type ProjectProgressStatus =
  | 'not-calculated'
  | 'not-started'
  | 'in-progress'
  | 'near-complete'
  | 'complete'
  | 'blocked';

export type ProjectConfidenceLevel = 'low' | 'medium' | 'high';

export type ProjectCommunicationReadinessLevel =
  | 'not-ready'
  | 'needs-context'
  | 'ready';

export type ProjectNextActionType =
  | 'capture-update'
  | 'review-overdue-schedule'
  | 'review-upcoming-schedule'
  | 'review-safety'
  | 'review-open-issues'
  | 'review-photo-actions'
  | 'assign-action-owner'
  | 'review-project-areas'
  | 'review-documents'
  | 'sync-project'
  | 'review-decisions'
  | 'add-schedule'
  | 'generate-report'
  | 'continue-monitoring';

export type ProjectIntelligenceSource =
  | 'project'
  | 'typed-update'
  | 'current-draft'
  | 'photo'
  | 'photo-caption'
  | 'photo-category'
  | 'photo-action'
  | 'schedule'
  | 'project-area'
  | 'contact-recipient'
  | 'document-metadata'
  | 'report-history'
  | 'sync-cloud'
  | 'project-event'
  | 'confidence';

export type ProjectReportHistoryMetadata = {
  id?: string;
  projectName?: string | null;
  title?: string | null;
  reportType?: string | null;
  generatedAt?: string | null;
  source?: string | null;
};

export type ProjectSyncFreshnessMetadata = {
  configured?: boolean;
  queuedChanges?: number;
  conflicts?: number;
  lastSyncAt?: string | null;
  checkedAt?: string | null;
  message?: string;
};

export type ProjectHealthSignal = {
  status: ProjectHealthStatus;
  score: number;
  severity: ProjectSignalSeverity;
  label: string;
  message: string;
  evidence: string[];
  sources: ProjectIntelligenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type ProjectRiskSignal = {
  id: string;
  label: string;
  severity: ProjectSignalSeverity;
  message: string;
  count?: number;
  source: ProjectIntelligenceSource;
  sources: ProjectIntelligenceSource[];
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  suggestedAction: string;
};

export type ProjectRecommendation = {
  id: string;
  title: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  action: ProjectNextActionType;
  source: ProjectIntelligenceSource;
  sources: ProjectIntelligenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type ProjectConfidenceSignal = {
  score: number;
  level: ProjectConfidenceLevel;
  message: string;
  factors: Array<{
    id: string;
    label: string;
    present: boolean;
    weight: number;
    message: string;
    source: ProjectIntelligenceSource;
  }>;
  sources: ProjectIntelligenceSource[];
};

export type ProjectCommunicationReadiness = {
  score: number;
  level: ProjectCommunicationReadinessLevel;
  message: string;
  strengths: string[];
  missingItems: string[];
  sources: ProjectIntelligenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type ProjectNextAction = {
  id: string;
  label: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  action: ProjectNextActionType;
  source: ProjectIntelligenceSource;
  sources: ProjectIntelligenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type ProjectIntelligenceSummary = {
  projectName: string;
  generatedAt: string;
  healthStatus: ProjectHealthStatus;
  scheduleStatus: ProjectScheduleStatus;
  progressStatus: ProjectProgressStatus;
  lastUpdate: string | null;
  latestActivity: string | null;
  photoCount: number;
  updateCount: number;
  recentEvents: ProjectEvent[];
  projectStory: ProjectStory;
  locationIntelligence: ProjectLocationIntelligence;
  overdueScheduleItems: number;
  upcomingScheduleItems: number;
  confidence: ProjectConfidenceSignal;
  healthSignal: ProjectHealthSignal;
  riskSignals: ProjectRiskSignal[];
  recommendations: ProjectRecommendation[];
  recommendedNextAction: ProjectNextAction;
  communicationReadiness: ProjectCommunicationReadiness;
  metrics: {
    averageScheduleProgress: number | null;
    scheduleItemCount: number;
    openIssueCount: number;
    safetyConcernCount: number;
    daysSinceLastUpdate: number | null;
    noteCount: number;
    captionCount: number;
    photoActionCount: number;
    overduePhotoActionCount: number;
    unassignedPhotoActionCount: number;
    areaSignalCount: number;
    gpsSignalCount: number;
    locationConfidenceScore: number;
    scheduleOwnerCount: number;
    scheduleContractorCount: number;
    highPriorityScheduleItemCount: number;
    waitingScheduleItemCount: number;
    contactRecipientCount: number;
    documentCount: number;
    currentDocumentCount: number;
    scheduleDocumentCount: number;
    reportHistoryCount: number;
    queuedSyncChanges: number | null;
    syncConflictCount: number | null;
    daysSinceLastSync: number | null;
    projectEventCount: number;
    openDecisionCount: number;
    daysSinceLatestActivity: number | null;
  };
};

export type AnalyzeProjectIntelligenceParams = {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook | ProjectContact[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  projectEvents?: ProjectEvent[];
  locationIntelligence?: ProjectLocationIntelligence | null;
  now?: Date;
};

export type AnalyzeProjectsIntelligenceParams = {
  projectNames: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook | ProjectContact[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  projectEvents?: ProjectEvent[];
  locationIntelligenceByProject?: Record<string, ProjectLocationIntelligence>;
  now?: Date;
};

const UPCOMING_SCHEDULE_WINDOW_DAYS = 14;
const STALE_UPDATE_DAYS = 7;
const VERY_STALE_UPDATE_DAYS = 14;
const STALE_SYNC_DAYS = 7;

function uniqueValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];

  values.forEach(value => {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(trimmed);
  });

  return unique;
}

function uniqueSources(sources: ProjectIntelligenceSource[]) {
  return uniqueValues(sources) as ProjectIntelligenceSource[];
}

function sourceConfidence(sources: ProjectIntelligenceSource[]): ProjectConfidenceLevel {
  const count = uniqueSources(sources).filter(source => source !== 'confidence').length;

  if (count >= 4) return 'high';
  if (count >= 2) return 'medium';

  return 'low';
}

function levelFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';

  return 'low';
}

function parseDateTime(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSinceDateTime(value: string | null | undefined, now: Date) {
  const date = parseDateTime(value);

  if (!date) return null;

  return Math.max(0, daysBetween(startOfDay(date), startOfDay(now)));
}

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

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function daysSinceUpdate(dateValue: string, now: Date) {
  const date = parseDueDate(dateValue);

  if (!date) return null;

  return Math.max(0, daysBetween(date, startOfDay(now)));
}

function daysUntilScheduleDate(dateValue: string, now: Date) {
  const date = parseFlexibleDate(dateValue);

  if (!date) return null;

  return daysBetween(startOfDay(now), date);
}

function relatedProjectUpdates({
  projectName,
  updates,
  currentUpdate,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
}) {
  const savedProjectUpdates = updates.filter(update =>
    isSameProject(projectName, update.projectName),
  );
  const shouldIncludeCurrentUpdate =
    currentUpdate &&
    isSameProject(projectName, currentUpdate.projectName) &&
    hasUpdateContent(currentUpdate) &&
    !savedProjectUpdates.some(update => update.id === currentUpdate.id);

  return shouldIncludeCurrentUpdate
    ? [currentUpdate, ...savedProjectUpdates]
    : savedProjectUpdates;
}

function relatedScheduleItems(projectName: string, scheduleItems: ScheduleItem[]) {
  return scheduleItems.filter(item => isSameProject(projectName, item.projectName));
}

function contactList(contacts?: ContactBook | ProjectContact[]) {
  if (!contacts) return [];

  return Array.isArray(contacts) ? contacts : contacts.contacts;
}

function latestUpdateDate(updates: ProjectUpdate[]) {
  return (
    updates
      .map(update => update.date)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || null
  );
}

function textMatchesProject(projectName: string, values: Array<string | null | undefined>) {
  const normalizedProject = projectName.trim().toLowerCase();

  if (!normalizedProject) return false;

  return values.some(value =>
    value?.toLowerCase().includes(normalizedProject),
  );
}

function narrativeStats(projectUpdates: ProjectUpdate[]) {
  const notes = projectUpdates.filter(update => update.notes.trim());
  const captions = projectUpdates.flatMap(update =>
    update.photos.filter(photo => photo.caption.trim()),
  );

  return {
    noteCount: notes.length,
    captionCount: captions.length,
    sources: uniqueSources([
      ...(notes.length > 0 ? ['typed-update' as const] : []),
      ...(captions.length > 0 ? ['photo-caption' as const] : []),
    ]),
  };
}

function photoActionStats(photos: UpdatePhoto[], now: Date) {
  const actionPhotos = photos.filter(isOpenAction);
  const overdueActions = actionPhotos.filter(photo => {
    const dueDate = parseDueDate(photo.actionDueDate);

    return Boolean(dueDate && dueDate < startOfDay(now));
  });
  const unassignedActions = actionPhotos.filter(
    photo => !photo.actionOwner.trim(),
  );
  const dueDateActions = actionPhotos.filter(photo =>
    Boolean(photo.actionDueDate.trim()),
  );

  return {
    actionCount: actionPhotos.length,
    overdueActionCount: overdueActions.length,
    unassignedActionCount: unassignedActions.length,
    dueDateActionCount: dueDateActions.length,
    ownerCount: uniqueValues(actionPhotos.map(photo => photo.actionOwner)).length,
    requiredCount: actionPhotos.filter(photo => photo.actionRequired.trim()).length,
    waitingCount: actionPhotos.filter(photo => photo.actionStatus === 'Waiting').length,
    sources: actionPhotos.length > 0
      ? (['photo-action', 'photo-category'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function scheduleContextStats(scheduleItems: ScheduleItem[]) {
  const openItems = scheduleItems.filter(
    item => item.status !== 'Complete' && boundedPercent(item.percentComplete) < 100,
  );

  return {
    ownerCount: uniqueValues(scheduleItems.map(item => item.owner)).length,
    contractorCount: uniqueValues(scheduleItems.map(item => item.contractor)).length,
    noteCount: scheduleItems.filter(item => item.notes.trim()).length,
    highPriorityOpenCount: openItems.filter(item => item.priority === 'High').length,
    waitingCount: openItems.filter(item => item.status === 'Waiting').length,
    importedSourceCount: uniqueValues(
      scheduleItems.map(item => item.importedFrom),
    ).length,
  };
}

function areaContextStats({
  projectAreas = [],
  projectUpdates,
  scheduleItems,
}: {
  projectAreas?: ProjectArea[];
  projectUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
}) {
  const areaIds = uniqueValues([
    ...projectUpdates.map(update => update.selectedAreaId),
    ...projectUpdates.flatMap(update =>
      update.photos.map(photo => photo.selectedAreaId),
    ),
  ]);
  const areaNames = uniqueValues([
    ...projectUpdates.map(update => update.selectedAreaName),
    ...projectUpdates.flatMap(update =>
      update.photos.map(photo => photo.selectedAreaName),
    ),
    ...scheduleItems.map(item => item.locationName),
  ]);
  const matchedAreas = projectAreas.filter(area => {
    const areaName = area.name.trim().toLowerCase();

    return (
      areaIds.includes(area.id) ||
      areaNames.some(name => name.toLowerCase() === areaName)
    );
  });
  const gpsUpdateCount = projectUpdates.filter(
    update =>
      typeof update.gpsLatitude === 'number' &&
      typeof update.gpsLongitude === 'number',
  ).length;
  const gpsPhotoCount = projectUpdates
    .flatMap(update => update.photos)
    .filter(
      photo =>
        typeof photo.gpsLatitude === 'number' &&
        typeof photo.gpsLongitude === 'number',
    ).length;

  return {
    areaSignalCount: areaNames.length,
    matchedAreaCount: matchedAreas.length,
    configuredAreaCount: projectAreas.length,
    gpsSignalCount: gpsUpdateCount + gpsPhotoCount,
    sources: areaNames.length > 0 || gpsUpdateCount + gpsPhotoCount > 0
      ? (['project-area'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function recipientStats({
  projectUpdates,
  contacts,
}: {
  projectUpdates: ProjectUpdate[];
  contacts?: ContactBook | ProjectContact[];
}) {
  const recipientIds = uniqueValues(
    projectUpdates.flatMap(update => update.recipients.contactIds),
  );
  const allContacts = contactList(contacts);
  const matchedContacts = allContacts.filter(contact =>
    recipientIds.includes(contact.id),
  );
  const deliverableContacts = matchedContacts.filter(contact =>
    Boolean(
      contact.selectedEmail?.trim() ||
        contact.email.trim() ||
        contact.selectedPhone?.trim() ||
        contact.phone.trim(),
    ),
  );

  return {
    recipientCount: recipientIds.length,
    matchedContactCount: matchedContacts.length,
    deliverableContactCount: deliverableContacts.length,
    contactBookCount: allContacts.length,
    sources: recipientIds.length > 0
      ? (['contact-recipient'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function relatedReferenceDocuments({
  projectName,
  scheduleItems,
  referenceDocuments = [],
}: {
  projectName: string;
  scheduleItems: ScheduleItem[];
  referenceDocuments?: ReferenceDocument[];
}) {
  const scheduleSources = uniqueValues(
    scheduleItems.map(item => item.importedFrom),
  ).map(value => value.toLowerCase());

  return referenceDocuments.filter(document => {
    const category = document.category.trim().toLowerCase();
    const documentNames = [
      document.name,
      document.originalFileName,
      document.category,
      document.notes,
    ];
    const matchesScheduleSource = scheduleSources.some(source =>
      [
        document.name,
        document.originalFileName,
        document.uri,
      ].some(value => value.toLowerCase().includes(source)),
    );

    return (
      textMatchesProject(projectName, documentNames) ||
      matchesScheduleSource ||
      (category === 'schedules' && scheduleItems.length > 0)
    );
  });
}

function documentContextStats(documents: ReferenceDocument[]) {
  return {
    documentCount: documents.length,
    currentDocumentCount: documents.filter(document => document.isCurrent).length,
    scheduleDocumentCount: documents.filter(
      document => document.category.trim().toLowerCase() === 'schedules',
    ).length,
    documentNoteCount: documents.filter(document => document.notes.trim()).length,
    sources: documents.length > 0
      ? (['document-metadata'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function relatedReportHistory({
  projectName,
  reportHistory = [],
}: {
  projectName: string;
  reportHistory?: ProjectReportHistoryMetadata[];
}) {
  return reportHistory.filter(report =>
    !report.projectName || isSameProject(projectName, report.projectName),
  );
}

function reportHistoryStats(reports: ProjectReportHistoryMetadata[]) {
  return {
    reportHistoryCount: reports.length,
    latestReportAt:
      reports
        .map(report => report.generatedAt || '')
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] || null,
    sources: reports.length > 0
      ? (['report-history'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function syncFreshnessStats(
  syncMetadata: ProjectSyncFreshnessMetadata | null | undefined,
  now: Date,
) {
  const queuedChanges =
    typeof syncMetadata?.queuedChanges === 'number'
      ? syncMetadata.queuedChanges
      : null;
  const conflicts =
    typeof syncMetadata?.conflicts === 'number'
      ? syncMetadata.conflicts
      : null;
  const daysSinceLastSync = daysSinceDateTime(syncMetadata?.lastSyncAt, now);

  return {
    configured: syncMetadata?.configured ?? null,
    queuedChanges,
    conflicts,
    lastSyncAt: syncMetadata?.lastSyncAt ?? null,
    daysSinceLastSync,
    sources: syncMetadata
      ? (['sync-cloud'] as ProjectIntelligenceSource[])
      : ([] as ProjectIntelligenceSource[]),
  };
}

function scheduleStatus({
  scheduleItems,
  overdueCount,
  upcomingCount,
}: {
  scheduleItems: ScheduleItem[];
  overdueCount: number;
  upcomingCount: number;
}): ProjectScheduleStatus {
  if (scheduleItems.length === 0) return 'not-available';

  const completeCount = scheduleItems.filter(
    item => item.status === 'Complete' || boundedPercent(item.percentComplete) >= 100,
  ).length;

  if (completeCount === scheduleItems.length) return 'complete';
  if (overdueCount > 0) return 'overdue';
  if (upcomingCount > 0) return 'due-soon';

  return 'on-track';
}

function progressStatus({
  scheduleItems,
  averageProgress,
  overdueCount,
}: {
  scheduleItems: ScheduleItem[];
  averageProgress: number | null;
  overdueCount: number;
}): ProjectProgressStatus {
  if (scheduleItems.length === 0 || averageProgress === null) {
    return 'not-calculated';
  }

  if (
    scheduleItems.some(item => item.status === 'Waiting') &&
    overdueCount > 0
  ) {
    return 'blocked';
  }

  if (averageProgress >= 100) return 'complete';
  if (averageProgress >= 80) return 'near-complete';
  if (averageProgress > 0) return 'in-progress';

  return 'not-started';
}

function confidenceSignal({
  projectName,
  updateCount,
  photoCount,
  scheduleItems,
  daysSinceLastUpdate,
  openIssueCount,
  safetyConcernCount,
  noteCount,
  captionCount,
  photoActionCount,
  areaSignalCount,
  gpsSignalCount,
  locationConfidenceScore,
  scheduleOwnerCount,
  scheduleContractorCount,
  documentCount,
  contactRecipientCount,
  projectEventCount,
  daysSinceLatestActivity,
}: {
  projectName: string;
  updateCount: number;
  photoCount: number;
  scheduleItems: ScheduleItem[];
  daysSinceLastUpdate: number | null;
  openIssueCount: number;
  safetyConcernCount: number;
  noteCount: number;
  captionCount: number;
  photoActionCount: number;
  areaSignalCount: number;
  gpsSignalCount: number;
  locationConfidenceScore: number;
  scheduleOwnerCount: number;
  scheduleContractorCount: number;
  documentCount: number;
  contactRecipientCount: number;
  projectEventCount: number;
  daysSinceLatestActivity: number | null;
}): ProjectConfidenceSignal {
  const datedScheduleCount = scheduleItems.filter(item =>
    Boolean(item.finishDate.trim() && parseFlexibleDate(item.finishDate)),
  ).length;
  const factors = [
    {
      id: 'project-name',
      label: 'Project name',
      present: Boolean(projectName.trim()),
      weight: 10,
      message: projectName.trim()
        ? 'Project identity is available.'
        : 'Project identity is missing.',
      source: 'project' as const,
    },
    {
      id: 'updates',
      label: 'Saved updates',
      present: updateCount > 0,
      weight: 16,
      message:
        updateCount > 0
          ? `${updateCount} update${updateCount === 1 ? '' : 's'} available.`
          : 'No saved updates are available.',
      source: 'typed-update' as const,
    },
    {
      id: 'photos',
      label: 'Photos',
      present: photoCount > 0,
      weight: 12,
      message:
        photoCount > 0
          ? `${photoCount} photo${photoCount === 1 ? '' : 's'} available.`
          : 'No project photos are available.',
      source: 'photo' as const,
    },
    {
      id: 'narrative',
      label: 'Notes and captions',
      present: noteCount > 0 || captionCount > 0,
      weight: 10,
      message:
        noteCount > 0 || captionCount > 0
          ? `${noteCount} note${noteCount === 1 ? '' : 's'} and ${captionCount} caption${captionCount === 1 ? '' : 's'} available.`
          : 'No typed notes or photo captions are available.',
      source: noteCount > 0 ? 'typed-update' as const : 'photo-caption' as const,
    },
    {
      id: 'schedule',
      label: 'Schedule',
      present: scheduleItems.length > 0,
      weight: 16,
      message:
        scheduleItems.length > 0
          ? `${scheduleItems.length} schedule item${scheduleItems.length === 1 ? '' : 's'} available.`
          : 'No schedule items are available.',
      source: 'schedule' as const,
    },
    {
      id: 'schedule-dates',
      label: 'Dated schedule items',
      present: datedScheduleCount > 0,
      weight: 8,
      message:
        datedScheduleCount > 0
          ? `${datedScheduleCount} schedule item${datedScheduleCount === 1 ? '' : 's'} include finish dates.`
          : 'No dated schedule items are available.',
      source: 'schedule' as const,
    },
    {
      id: 'schedule-responsibility',
      label: 'Schedule responsibility',
      present: scheduleOwnerCount > 0 || scheduleContractorCount > 0,
      weight: 5,
      message:
        scheduleOwnerCount > 0 || scheduleContractorCount > 0
          ? `${scheduleOwnerCount} owner${scheduleOwnerCount === 1 ? '' : 's'} and ${scheduleContractorCount} contractor${scheduleContractorCount === 1 ? '' : 's'} available.`
          : 'No schedule owners or contractors are available.',
      source: 'schedule' as const,
    },
    {
      id: 'recent-activity',
      label: 'Recent activity',
      present:
        daysSinceLastUpdate !== null && daysSinceLastUpdate <= STALE_UPDATE_DAYS,
      weight: 10,
      message:
        daysSinceLastUpdate === null
          ? 'No recent activity date is available.'
          : daysSinceLastUpdate <= STALE_UPDATE_DAYS
            ? `Last update was ${daysSinceLastUpdate} day${daysSinceLastUpdate === 1 ? '' : 's'} ago.`
            : `Last update is ${daysSinceLastUpdate} days old.`,
      source: 'typed-update' as const,
    },
    {
      id: 'issue-tracking',
      label: 'Issue tracking',
      present: openIssueCount > 0 || safetyConcernCount > 0 || photoActionCount > 0,
      weight: 5,
      message:
        openIssueCount > 0 || safetyConcernCount > 0 || photoActionCount > 0
          ? 'Issue, safety, or photo action tracking data is available.'
          : 'No issue or safety tracking data is available.',
      source: 'photo-action' as const,
    },
    {
      id: 'area-context',
      label: 'Project area context',
      present: areaSignalCount > 0 || gpsSignalCount > 0,
      weight: 5,
      message:
        areaSignalCount > 0 || gpsSignalCount > 0
          ? `${areaSignalCount} area signal${areaSignalCount === 1 ? '' : 's'} and ${gpsSignalCount} GPS signal${gpsSignalCount === 1 ? '' : 's'} available.`
          : 'No project area or GPS context is available.',
      source: 'project-area' as const,
    },
    {
      id: 'location-intelligence',
      label: 'Location intelligence',
      present: locationConfidenceScore >= 45,
      weight: 5,
      message:
        locationConfidenceScore >= 45
          ? `PIE has ${locationConfidenceScore}% location confidence.`
          : 'PIE location confidence is low.',
      source: 'project-area' as const,
    },
    {
      id: 'documents',
      label: 'Document metadata',
      present: documentCount > 0,
      weight: 2,
      message:
        documentCount > 0
          ? `${documentCount} related document${documentCount === 1 ? '' : 's'} available.`
          : 'No related document metadata is available.',
      source: 'document-metadata' as const,
    },
    {
      id: 'recipients',
      label: 'Recipient context',
      present: contactRecipientCount > 0,
      weight: 3,
      message:
        contactRecipientCount > 0
          ? `${contactRecipientCount} selected recipient${contactRecipientCount === 1 ? '' : 's'} available.`
          : 'No selected recipients are available.',
      source: 'contact-recipient' as const,
    },
    {
      id: 'event-memory',
      label: 'Project event memory',
      present: projectEventCount > 0,
      weight: 4,
      message:
        projectEventCount > 0
          ? `${projectEventCount} project event${projectEventCount === 1 ? '' : 's'} derived from project history.`
          : 'No derived project events are available.',
      source: 'project-event' as const,
    },
    {
      id: 'latest-activity',
      label: 'Latest activity',
      present:
        daysSinceLatestActivity !== null &&
        daysSinceLatestActivity <= STALE_UPDATE_DAYS,
      weight: 2,
      message:
        daysSinceLatestActivity === null
          ? 'No latest project activity event is available.'
          : daysSinceLatestActivity <= STALE_UPDATE_DAYS
            ? `Latest project event was ${daysSinceLatestActivity} day${daysSinceLatestActivity === 1 ? '' : 's'} ago.`
            : `Latest project event is ${daysSinceLatestActivity} days old.`,
      source: 'project-event' as const,
    },
  ];
  const score = Math.min(100, factors.reduce(
    (total, factor) => total + (factor.present ? factor.weight : 0),
    0,
  ));
  const level = levelFromScore(score);
  const sources = uniqueSources(
    factors
      .filter(factor => factor.present)
      .map(factor => factor.source),
  );

  return {
    score,
    level,
    message:
      level === 'high'
        ? 'Project context is strong enough to support confident intelligence.'
        : level === 'medium'
          ? 'Project context is usable, but additional updates or schedule data would improve confidence.'
          : 'Project context is limited. Capture updates or add schedule data before relying on recommendations.',
    factors,
    sources,
  };
}

function healthSignal({
  updateCount,
  photoCount,
  overdueCount,
  upcomingCount,
  openIssueCount,
  safetyConcernCount,
  averageProgress,
  daysSinceLastUpdate,
  scheduleItemCount,
  noteCount,
  captionCount,
  overduePhotoActionCount,
  unassignedPhotoActionCount,
  areaSignalCount,
  locationConfidenceScore,
  locationNeedsConfirmation,
  documentCount,
  highPriorityScheduleItemCount,
  waitingScheduleItemCount,
  syncConflictCount,
  projectEventCount,
  openDecisionCount,
  daysSinceLatestActivity,
}: {
  updateCount: number;
  photoCount: number;
  overdueCount: number;
  upcomingCount: number;
  openIssueCount: number;
  safetyConcernCount: number;
  averageProgress: number | null;
  daysSinceLastUpdate: number | null;
  scheduleItemCount: number;
  noteCount: number;
  captionCount: number;
  overduePhotoActionCount: number;
  unassignedPhotoActionCount: number;
  areaSignalCount: number;
  locationConfidenceScore: number;
  locationNeedsConfirmation: boolean;
  documentCount: number;
  highPriorityScheduleItemCount: number;
  waitingScheduleItemCount: number;
  syncConflictCount: number | null;
  projectEventCount: number;
  openDecisionCount: number;
  daysSinceLatestActivity: number | null;
}): ProjectHealthSignal {
  if (updateCount === 0 && scheduleItemCount === 0) {
    const sources = uniqueSources(['project']);

    return {
      status: 'unknown',
      score: 35,
      severity: 'neutral',
      label: 'Project status unknown',
      message: 'PIE needs updates or schedule data before it can evaluate project health.',
      evidence: ['No saved updates found.', 'No schedule items found.'],
      sources,
      confidence: 'low',
    };
  }

  let score = 72;
  const evidence: string[] = [];
  const sources: ProjectIntelligenceSource[] = ['project'];

  if (updateCount > 0) {
    score += Math.min(updateCount, 4) * 3;
    evidence.push(`${updateCount} update${updateCount === 1 ? '' : 's'} available.`);
    sources.push('typed-update');
  } else {
    score -= 18;
    evidence.push('No saved updates available.');
  }

  if (photoCount > 0) {
    score += Math.min(photoCount, 8);
    evidence.push(`${photoCount} photo${photoCount === 1 ? '' : 's'} available.`);
    sources.push('photo');
  } else {
    score -= 5;
    evidence.push('No project photos available.');
  }

  if (noteCount > 0 || captionCount > 0) {
    score += 3;
    evidence.push(`${noteCount} note${noteCount === 1 ? '' : 's'} and ${captionCount} caption${captionCount === 1 ? '' : 's'} available.`);
    sources.push(noteCount > 0 ? 'typed-update' : 'photo-caption');
  }

  score -= Math.min(overdueCount * 10, 30);
  score -= Math.min(upcomingCount * 2, 10);
  score -= Math.min(openIssueCount * 5, 25);
  score -= Math.min(safetyConcernCount * 9, 36);
  score -= Math.min(overduePhotoActionCount * 8, 24);
  score -= Math.min(unassignedPhotoActionCount * 3, 12);
  score -= Math.min(highPriorityScheduleItemCount * 3, 12);
  score -= Math.min(waitingScheduleItemCount * 4, 16);

  if (scheduleItemCount > 0) {
    sources.push('schedule');
  }

  if (overdueCount > 0) {
    evidence.push(`${overdueCount} overdue schedule item${overdueCount === 1 ? '' : 's'}.`);
  }

  if (openIssueCount > 0) {
    evidence.push(`${openIssueCount} open issue${openIssueCount === 1 ? '' : 's'}.`);
  }

  if (safetyConcernCount > 0) {
    evidence.push(`${safetyConcernCount} open safety concern${safetyConcernCount === 1 ? '' : 's'}.`);
    sources.push('photo-action');
  }

  if (overduePhotoActionCount > 0) {
    evidence.push(`${overduePhotoActionCount} photo action${overduePhotoActionCount === 1 ? '' : 's'} overdue.`);
    sources.push('photo-action');
  }

  if (unassignedPhotoActionCount > 0) {
    evidence.push(`${unassignedPhotoActionCount} open photo action${unassignedPhotoActionCount === 1 ? '' : 's'} without an owner.`);
    sources.push('photo-action');
  }

  if (highPriorityScheduleItemCount > 0) {
    evidence.push(`${highPriorityScheduleItemCount} high-priority schedule item${highPriorityScheduleItemCount === 1 ? '' : 's'} still open.`);
    sources.push('schedule');
  }

  if (waitingScheduleItemCount > 0) {
    evidence.push(`${waitingScheduleItemCount} schedule item${waitingScheduleItemCount === 1 ? '' : 's'} waiting.`);
    sources.push('schedule');
  }

  if (averageProgress !== null) {
    if (averageProgress >= 80) {
      score += 8;
    } else if (averageProgress >= 50) {
      score += 4;
    } else if (averageProgress < 25) {
      score -= 6;
    }

    evidence.push(`Average schedule progress is ${averageProgress}%.`);
  }

  if (areaSignalCount > 0) {
    score += 2;
    evidence.push(`${areaSignalCount} project area signal${areaSignalCount === 1 ? '' : 's'} available.`);
    sources.push('project-area');
  }

  if (locationConfidenceScore >= 75) {
    score += 3;
    evidence.push(`PIE location confidence is ${locationConfidenceScore}%.`);
    sources.push('project-area');
  } else if (locationNeedsConfirmation) {
    score -= 3;
    evidence.push(`PIE location confidence is ${locationConfidenceScore}% and needs confirmation.`);
    sources.push('project-area');
  }

  if (documentCount > 0) {
    score += 1;
    evidence.push(`${documentCount} related document${documentCount === 1 ? '' : 's'} available.`);
    sources.push('document-metadata');
  }

  if (projectEventCount > 0) {
    score += 2;
    evidence.push(`${projectEventCount} project event${projectEventCount === 1 ? '' : 's'} available in event memory.`);
    sources.push('project-event');
  }

  if (openDecisionCount > 0) {
    score -= Math.min(openDecisionCount * 5, 20);
    evidence.push(`${openDecisionCount} open decision event${openDecisionCount === 1 ? '' : 's'} need review.`);
    sources.push('project-event');
  }

  if (daysSinceLastUpdate === null) {
    score -= 8;
  } else if (daysSinceLastUpdate > VERY_STALE_UPDATE_DAYS) {
    score -= 18;
    evidence.push(`Last update is ${daysSinceLastUpdate} days old.`);
  } else if (daysSinceLastUpdate > STALE_UPDATE_DAYS) {
    score -= 9;
    evidence.push(`Last update is ${daysSinceLastUpdate} days old.`);
  } else {
    score += 4;
    evidence.push(`Last update was ${daysSinceLastUpdate} day${daysSinceLastUpdate === 1 ? '' : 's'} ago.`);
  }

  if (syncConflictCount !== null && syncConflictCount > 0) {
    score -= Math.min(syncConflictCount * 8, 24);
    evidence.push(`${syncConflictCount} sync conflict${syncConflictCount === 1 ? '' : 's'} need review.`);
    sources.push('sync-cloud');
  }

  if (
    daysSinceLatestActivity !== null &&
    daysSinceLatestActivity <= STALE_UPDATE_DAYS
  ) {
    score += 2;
    evidence.push(`Latest project event was ${daysSinceLatestActivity} day${daysSinceLatestActivity === 1 ? '' : 's'} ago.`);
    sources.push('project-event');
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const status: ProjectHealthStatus =
    boundedScore >= 78
      ? 'healthy'
      : boundedScore >= 58
        ? 'watch'
        : 'at-risk';
  const severity: ProjectSignalSeverity =
    status === 'healthy'
      ? 'positive'
      : status === 'watch'
        ? 'warning'
        : 'critical';

  return {
    status,
    score: boundedScore,
    severity,
    label:
      status === 'healthy'
        ? 'Project appears healthy'
        : status === 'watch'
          ? 'Project needs monitoring'
          : 'Project needs attention',
    message:
      status === 'healthy'
        ? 'Current local data does not show major schedule, safety, or update risks.'
        : status === 'watch'
          ? 'Current local data shows conditions that should be reviewed.'
          : 'Current local data shows project risks that should be addressed.',
    evidence,
    sources: uniqueSources(sources),
    confidence: sourceConfidence(sources),
  };
}

function createRiskSignal({
  id,
  label,
  severity,
  message,
  count,
  source,
  sources = [source],
  confidence,
  evidence,
  suggestedAction,
}: ProjectRiskSignal): ProjectRiskSignal {
  return {
    id,
    label,
    severity,
    message,
    count,
    source,
    sources: uniqueSources(sources),
    confidence,
    evidence,
    suggestedAction,
  };
}

function riskSignals({
  updateCount,
  overdueCount,
  openIssueCount,
  safetyConcernCount,
  scheduleItemCount,
  daysSinceLastUpdate,
  photoActionCount,
  overduePhotoActionCount,
  unassignedPhotoActionCount,
  highPriorityScheduleItemCount,
  waitingScheduleItemCount,
  areaSignalCount,
  projectAreaCount,
  locationConfidenceScore,
  locationNeedsConfirmation,
  locationConfirmationPrompt,
  documentCount,
  currentDocumentCount,
  scheduleDocumentCount,
  queuedSyncChanges,
  syncConflictCount,
  daysSinceLastSync,
  openDecisionCount,
}: {
  updateCount: number;
  overdueCount: number;
  openIssueCount: number;
  safetyConcernCount: number;
  scheduleItemCount: number;
  daysSinceLastUpdate: number | null;
  photoActionCount: number;
  overduePhotoActionCount: number;
  unassignedPhotoActionCount: number;
  highPriorityScheduleItemCount: number;
  waitingScheduleItemCount: number;
  areaSignalCount: number;
  projectAreaCount: number;
  locationConfidenceScore: number;
  locationNeedsConfirmation: boolean;
  locationConfirmationPrompt: string | null;
  documentCount: number;
  currentDocumentCount: number;
  scheduleDocumentCount: number;
  queuedSyncChanges: number | null;
  syncConflictCount: number | null;
  daysSinceLastSync: number | null;
  openDecisionCount: number;
}): ProjectRiskSignal[] {
  const risks: ProjectRiskSignal[] = [];

  if (updateCount === 0) {
    risks.push(createRiskSignal({
      id: 'missing-updates',
      label: 'No updates captured',
      severity: 'warning',
      message: 'No saved updates are available for this project.',
      source: 'typed-update',
      sources: ['typed-update'],
      confidence: 'high',
      evidence: ['No saved project updates matched this project.'],
      suggestedAction: 'Capture today\'s progress.',
    }));
  }

  if (daysSinceLastUpdate !== null && daysSinceLastUpdate > STALE_UPDATE_DAYS) {
    risks.push(createRiskSignal({
      id: 'stale-update',
      label: 'Project update is stale',
      severity: daysSinceLastUpdate > VERY_STALE_UPDATE_DAYS ? 'critical' : 'warning',
      message: `The latest update is ${daysSinceLastUpdate} days old.`,
      source: 'typed-update',
      sources: ['typed-update'],
      confidence: 'high',
      evidence: [`Latest saved update is ${daysSinceLastUpdate} days old.`],
      suggestedAction: 'Capture a fresh project update.',
    }));
  }

  if (scheduleItemCount === 0) {
    risks.push(createRiskSignal({
      id: 'missing-schedule',
      label: 'Schedule data missing',
      severity: 'warning',
      message: 'No schedule items are available for this project.',
      source: 'schedule',
      sources: ['schedule'],
      confidence: 'high',
      evidence: ['No schedule items matched this project.'],
      suggestedAction: 'Import or add schedule items.',
    }));
  }

  if (overdueCount > 0) {
    risks.push(createRiskSignal({
      id: 'overdue-schedule',
      label: 'Overdue schedule work',
      severity: 'critical',
      message: `${overdueCount} schedule item${overdueCount === 1 ? ' is' : 's are'} overdue.`,
      count: overdueCount,
      source: 'schedule',
      sources: ['schedule'],
      confidence: 'high',
      evidence: [`${overdueCount} incomplete schedule item${overdueCount === 1 ? ' has' : 's have'} finish dates before today.`],
      suggestedAction: 'Review overdue schedule items.',
    }));
  }

  if (safetyConcernCount > 0) {
    risks.push(createRiskSignal({
      id: 'open-safety',
      label: 'Open safety concern',
      severity: 'critical',
      message: `${safetyConcernCount} safety concern${safetyConcernCount === 1 ? ' is' : 's are'} still open.`,
      count: safetyConcernCount,
      source: 'photo-action',
      sources: ['photo-category', 'photo-action'],
      confidence: 'high',
      evidence: [`${safetyConcernCount} safety photo${safetyConcernCount === 1 ? '' : 's'} are not closed.`],
      suggestedAction: 'Review open safety concerns.',
    }));
  }

  if (openIssueCount > 0) {
    risks.push(createRiskSignal({
      id: 'open-issues',
      label: 'Open issue',
      severity: 'warning',
      message: `${openIssueCount} issue${openIssueCount === 1 ? ' is' : 's are'} still open.`,
      count: openIssueCount,
      source: 'photo-action',
      sources: ['photo-category', 'photo-action'],
      confidence: 'high',
      evidence: [`${openIssueCount} open issue photo${openIssueCount === 1 ? '' : 's'} are not closed.`],
      suggestedAction: 'Review open project issues.',
    }));
  }

  if (overduePhotoActionCount > 0) {
    risks.push(createRiskSignal({
      id: 'overdue-photo-actions',
      label: 'Overdue photo action',
      severity: 'critical',
      message: `${overduePhotoActionCount} photo action${overduePhotoActionCount === 1 ? ' is' : 's are'} past due.`,
      count: overduePhotoActionCount,
      source: 'photo-action',
      sources: ['photo-action'],
      confidence: 'high',
      evidence: [`${overduePhotoActionCount} open photo action${overduePhotoActionCount === 1 ? ' has' : 's have'} due dates before today.`],
      suggestedAction: 'Review overdue photo actions.',
    }));
  }

  if (photoActionCount > 0 && unassignedPhotoActionCount > 0) {
    risks.push(createRiskSignal({
      id: 'unassigned-photo-actions',
      label: 'Photo action missing owner',
      severity: 'warning',
      message: `${unassignedPhotoActionCount} open photo action${unassignedPhotoActionCount === 1 ? ' needs' : 's need'} an owner.`,
      count: unassignedPhotoActionCount,
      source: 'photo-action',
      sources: ['photo-action'],
      confidence: 'medium',
      evidence: [`${unassignedPhotoActionCount} open action photo${unassignedPhotoActionCount === 1 ? '' : 's'} have no action owner.`],
      suggestedAction: 'Assign action owners.',
    }));
  }

  if (waitingScheduleItemCount > 0) {
    risks.push(createRiskSignal({
      id: 'waiting-schedule-items',
      label: 'Schedule work is waiting',
      severity: highPriorityScheduleItemCount > 0 ? 'critical' : 'warning',
      message: `${waitingScheduleItemCount} schedule item${waitingScheduleItemCount === 1 ? ' is' : 's are'} waiting.`,
      count: waitingScheduleItemCount,
      source: 'schedule',
      sources: ['schedule'],
      confidence: 'high',
      evidence: [`${waitingScheduleItemCount} incomplete schedule item${waitingScheduleItemCount === 1 ? ' has' : 's have'} Waiting status.`],
      suggestedAction: 'Confirm blockers, owners, and recovery dates.',
    }));
  }

  if (highPriorityScheduleItemCount > 0) {
    risks.push(createRiskSignal({
      id: 'high-priority-schedule',
      label: 'High-priority schedule work open',
      severity: 'warning',
      message: `${highPriorityScheduleItemCount} high-priority schedule item${highPriorityScheduleItemCount === 1 ? ' is' : 's are'} still open.`,
      count: highPriorityScheduleItemCount,
      source: 'schedule',
      sources: ['schedule'],
      confidence: 'high',
      evidence: [`${highPriorityScheduleItemCount} incomplete schedule item${highPriorityScheduleItemCount === 1 ? ' is' : 's are'} marked High priority.`],
      suggestedAction: 'Review high-priority schedule responsibilities.',
    }));
  }

  if (updateCount > 0 && projectAreaCount > 0 && areaSignalCount === 0) {
    risks.push(createRiskSignal({
      id: 'missing-area-context',
      label: 'Project area context missing',
      severity: 'warning',
      message: 'Updates exist, but none are tied to a project area.',
      source: 'project-area',
      sources: ['typed-update', 'project-area'],
      confidence: 'medium',
      evidence: ['Saved updates matched this project, but no selected areas were found.'],
      suggestedAction: 'Attach future updates to the correct project area.',
    }));
  }

  if (locationNeedsConfirmation) {
    risks.push(createRiskSignal({
      id: 'location-needs-confirmation',
      label: 'Location needs confirmation',
      severity: 'warning',
      message:
        locationConfirmationPrompt ||
        'PIE has a location guess, but confidence is not high enough to rely on it automatically.',
      source: 'project-area',
      sources: ['project-area'],
      confidence: 'medium',
      evidence: [`Location confidence is ${locationConfidenceScore}%.`],
      suggestedAction: 'Confirm the detected project area before relying on location-aware recommendations.',
    }));
  }

  if (documentCount === 0 && scheduleItemCount > 0) {
    risks.push(createRiskSignal({
      id: 'missing-document-context',
      label: 'Document context not linked',
      severity: 'neutral',
      message: 'Schedule work exists, but PIE does not see related reference document metadata.',
      source: 'document-metadata',
      sources: ['schedule', 'document-metadata'],
      confidence: 'medium',
      evidence: ['No related reference documents matched this project or its schedule sources.'],
      suggestedAction: 'Link current schedule, drawings, or reference documents when available.',
    }));
  }

  if (documentCount > 0 && currentDocumentCount === 0) {
    risks.push(createRiskSignal({
      id: 'no-current-documents',
      label: 'No current document marked',
      severity: 'neutral',
      message: `${documentCount} related document${documentCount === 1 ? ' is' : 's are'} available, but none are marked current.`,
      count: documentCount,
      source: 'document-metadata',
      sources: ['document-metadata'],
      confidence: 'medium',
      evidence: ['Related document metadata exists without a current document flag.'],
      suggestedAction: 'Mark the active reference or schedule document current.',
    }));
  }

  if (scheduleItemCount > 0 && scheduleDocumentCount === 0 && documentCount > 0) {
    risks.push(createRiskSignal({
      id: 'missing-schedule-document',
      label: 'Schedule document not identified',
      severity: 'neutral',
      message: 'Schedule items exist, but no related schedule document is marked in document metadata.',
      source: 'document-metadata',
      sources: ['schedule', 'document-metadata'],
      confidence: 'medium',
      evidence: ['Related documents exist, but none use the Schedules category.'],
      suggestedAction: 'Classify the current schedule document as a schedule reference.',
    }));
  }

  if (syncConflictCount !== null && syncConflictCount > 0) {
    risks.push(createRiskSignal({
      id: 'sync-conflicts',
      label: 'Sync conflicts need review',
      severity: 'critical',
      message: `${syncConflictCount} sync conflict${syncConflictCount === 1 ? ' needs' : 's need'} review.`,
      count: syncConflictCount,
      source: 'sync-cloud',
      sources: ['sync-cloud'],
      confidence: 'high',
      evidence: [`Sync metadata reports ${syncConflictCount} conflict${syncConflictCount === 1 ? '' : 's'}.`],
      suggestedAction: 'Review sync conflicts before relying on cloud status.',
    }));
  }

  if (queuedSyncChanges !== null && queuedSyncChanges > 0) {
    risks.push(createRiskSignal({
      id: 'queued-sync-changes',
      label: 'Cloud sync pending',
      severity: 'warning',
      message: `${queuedSyncChanges} local change${queuedSyncChanges === 1 ? ' is' : 's are'} waiting to sync.`,
      count: queuedSyncChanges,
      source: 'sync-cloud',
      sources: ['sync-cloud'],
      confidence: 'high',
      evidence: [`Sync metadata reports ${queuedSyncChanges} queued change${queuedSyncChanges === 1 ? '' : 's'}.`],
      suggestedAction: 'Sync when network access is available.',
    }));
  }

  if (daysSinceLastSync !== null && daysSinceLastSync > STALE_SYNC_DAYS) {
    risks.push(createRiskSignal({
      id: 'stale-sync',
      label: 'Cloud sync may be stale',
      severity: 'warning',
      message: `Last sync was ${daysSinceLastSync} days ago.`,
      source: 'sync-cloud',
      sources: ['sync-cloud'],
      confidence: 'medium',
      evidence: [`Last sync timestamp is ${daysSinceLastSync} days old.`],
      suggestedAction: 'Run sync before sharing cloud-dependent status.',
    }));
  }

  if (openDecisionCount > 0) {
    risks.push(createRiskSignal({
      id: 'open-decisions',
      label: 'Open decision recorded',
      severity: 'warning',
      message: `${openDecisionCount} decision event${openDecisionCount === 1 ? ' needs' : 's need'} review.`,
      count: openDecisionCount,
      source: 'project-event',
      sources: ['project-event'],
      confidence: 'medium',
      evidence: [`${openDecisionCount} decision_recorded event${openDecisionCount === 1 ? '' : 's'} are not closed.`],
      suggestedAction: 'Review open decisions and capture the outcome.',
    }));
  }

  return risks;
}

function communicationReadiness({
  projectName,
  projectUpdates,
  photoCount,
  scheduleItemCount,
  riskCount,
  daysSinceLastUpdate,
  noteCount,
  captionCount,
  contactRecipientCount,
  deliverableContactCount,
  documentCount,
  currentDocumentCount,
  reportHistoryCount,
  daysSinceLastSync,
  locationConfidenceScore,
  locationNeedsConfirmation,
}: {
  projectName: string;
  projectUpdates: ProjectUpdate[];
  photoCount: number;
  scheduleItemCount: number;
  riskCount: number;
  daysSinceLastUpdate: number | null;
  noteCount: number;
  captionCount: number;
  contactRecipientCount: number;
  deliverableContactCount: number;
  documentCount: number;
  currentDocumentCount: number;
  reportHistoryCount: number;
  daysSinceLastSync: number | null;
  locationConfidenceScore: number;
  locationNeedsConfirmation: boolean;
}): ProjectCommunicationReadiness {
  const hasNarrative = noteCount > 0 || captionCount > 0;
  const strengths: string[] = [];
  const missingItems: string[] = [];
  const sources: ProjectIntelligenceSource[] = [];
  let score = 20;

  if (projectName.trim()) {
    score += 10;
    strengths.push('Project name is available.');
    sources.push('project');
  }

  if (projectUpdates.length > 0) {
    score += 20;
    strengths.push('Project updates are available.');
    sources.push('typed-update');
  } else {
    missingItems.push('Capture at least one project update.');
  }

  if (hasNarrative) {
    score += 20;
    strengths.push(`${noteCount} note${noteCount === 1 ? '' : 's'} and ${captionCount} photo caption${captionCount === 1 ? '' : 's'} are available.`);
    if (noteCount > 0) sources.push('typed-update');
    if (captionCount > 0) sources.push('photo-caption');
  } else {
    missingItems.push('Add notes or photo captions for communication context.');
  }

  if (photoCount > 0) {
    score += 10;
    strengths.push('Photos are available for evidence.');
    sources.push('photo');
  } else {
    missingItems.push('Add photos if visual evidence is needed.');
  }

  if (scheduleItemCount > 0) {
    score += 10;
    strengths.push('Schedule context is available.');
    sources.push('schedule');
  } else {
    missingItems.push('Add schedule data for schedule-aware communication.');
  }

  if (daysSinceLastUpdate !== null && daysSinceLastUpdate <= STALE_UPDATE_DAYS) {
    score += 10;
    strengths.push('Recent update activity is available.');
    sources.push('typed-update');
  } else {
    missingItems.push('Capture a recent update before sending stakeholder communication.');
  }

  if (contactRecipientCount > 0) {
    score += deliverableContactCount > 0 ? 8 : 4;
    strengths.push(`${contactRecipientCount} selected recipient${contactRecipientCount === 1 ? '' : 's'} available.`);
    sources.push('contact-recipient');
  } else {
    missingItems.push('Select recipients for stakeholder-ready communication.');
  }

  if (documentCount > 0) {
    score += currentDocumentCount > 0 ? 5 : 2;
    strengths.push(`${documentCount} related document${documentCount === 1 ? '' : 's'} available for reference.`);
    sources.push('document-metadata');
  }

  if (locationConfidenceScore >= 75) {
    score += 4;
    strengths.push('Location intelligence is confident enough for project context.');
    sources.push('project-area');
  } else if (locationNeedsConfirmation) {
    missingItems.push('Confirm the detected project area before sending location-aware communication.');
    sources.push('project-area');
  }

  if (currentDocumentCount === 0 && documentCount > 0) {
    missingItems.push('Mark the current reference document when document-backed communication matters.');
  }

  if (reportHistoryCount > 0) {
    score += 4;
    strengths.push('Report history metadata is available.');
    sources.push('report-history');
  }

  if (daysSinceLastSync !== null && daysSinceLastSync <= STALE_SYNC_DAYS) {
    score += 3;
    strengths.push('Cloud sync freshness metadata is recent.');
    sources.push('sync-cloud');
  } else if (daysSinceLastSync !== null) {
    missingItems.push('Run sync if cloud freshness matters for this communication.');
  }

  if (riskCount > 0) {
    score += 5;
    strengths.push('Risks are identified for review.');
    sources.push('confidence');
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const level: ProjectCommunicationReadinessLevel =
    boundedScore >= 75
      ? 'ready'
      : boundedScore >= 45
        ? 'needs-context'
        : 'not-ready';

  return {
    score: boundedScore,
    level,
    message:
      level === 'ready'
        ? 'Project data is ready to support stakeholder communication.'
        : level === 'needs-context'
          ? 'Project data can support a draft, but more context would improve the communication.'
          : 'Project data is not ready for reliable stakeholder communication.',
    strengths,
    missingItems,
    sources: uniqueSources(sources),
    confidence: levelFromScore(boundedScore),
  };
}

function recommendation(
  id: string,
  title: string,
  reason: string,
  priority: ProjectRecommendation['priority'],
  action: ProjectNextActionType,
  source: ProjectIntelligenceSource,
  sources: ProjectIntelligenceSource[] = [source],
  confidence: ProjectConfidenceLevel = 'medium',
): ProjectRecommendation {
  return {
    id,
    title,
    reason,
    priority,
    action,
    source,
    sources: uniqueSources(sources),
    confidence,
  };
}

function recommendations({
  risks,
  communication,
  upcomingCount,
}: {
  risks: ProjectRiskSignal[];
  communication: ProjectCommunicationReadiness;
  upcomingCount: number;
}): ProjectRecommendation[] {
  const items: ProjectRecommendation[] = [];

  risks.forEach(risk => {
    if (risk.id === 'open-safety') {
      items.push(
        recommendation(
          'review-safety',
          'Review open safety concerns',
          risk.message,
          'high',
          'review-safety',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'overdue-schedule') {
      items.push(
        recommendation(
          'review-overdue-schedule',
          'Review overdue schedule items',
          risk.message,
          'high',
          'review-overdue-schedule',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'missing-updates' || risk.id === 'stale-update') {
      items.push(
        recommendation(
          'capture-update',
          'Capture today\'s progress',
          risk.message,
          'high',
          'capture-update',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'missing-schedule') {
      items.push(
        recommendation(
          'add-schedule',
          'Add schedule context',
          risk.message,
          'medium',
          'add-schedule',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'open-issues') {
      items.push(
        recommendation(
          'review-open-issues',
          'Review open project issues',
          risk.message,
          'medium',
          'review-open-issues',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'overdue-photo-actions') {
      items.push(
        recommendation(
          'review-photo-actions',
          'Review overdue photo actions',
          risk.message,
          'high',
          'review-photo-actions',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'unassigned-photo-actions') {
      items.push(
        recommendation(
          'assign-action-owner',
          'Assign photo action owners',
          risk.message,
          'medium',
          'assign-action-owner',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'waiting-schedule-items' || risk.id === 'high-priority-schedule') {
      items.push(
        recommendation(
          'review-schedule-responsibility',
          'Review schedule responsibility',
          risk.message,
          risk.severity === 'critical' ? 'high' : 'medium',
          'review-overdue-schedule',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (
      risk.id === 'missing-area-context' ||
      risk.id === 'location-needs-confirmation'
    ) {
      items.push(
        recommendation(
          'review-project-areas',
          risk.id === 'location-needs-confirmation'
            ? 'Confirm detected project area'
            : 'Add project area context',
          risk.message,
          'medium',
          'review-project-areas',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (
      risk.id === 'missing-document-context' ||
      risk.id === 'no-current-documents' ||
      risk.id === 'missing-schedule-document'
    ) {
      items.push(
        recommendation(
          'review-documents',
          'Review project document context',
          risk.message,
          'low',
          'review-documents',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (
      risk.id === 'sync-conflicts' ||
      risk.id === 'queued-sync-changes' ||
      risk.id === 'stale-sync'
    ) {
      items.push(
        recommendation(
          'sync-project',
          'Review project sync status',
          risk.message,
          risk.severity === 'critical' ? 'high' : 'medium',
          'sync-project',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    } else if (risk.id === 'open-decisions') {
      items.push(
        recommendation(
          'review-decisions',
          'Review open project decisions',
          risk.message,
          'medium',
          'review-decisions',
          risk.source,
          risk.sources,
          risk.confidence,
        ),
      );
    }
  });

  if (upcomingCount > 0) {
    items.push(
      recommendation(
        'review-upcoming-schedule',
        'Review upcoming schedule items',
        `${upcomingCount} schedule item${upcomingCount === 1 ? ' is' : 's are'} due soon.`,
        'medium',
        'review-upcoming-schedule',
        'schedule',
        ['schedule'],
        'high',
      ),
    );
  }

  if (communication.level === 'ready') {
    items.push(
      recommendation(
        'generate-report',
        'Generate executive report',
        'Project data is ready for stakeholder communication.',
        'medium',
        'generate-report',
        'report-history',
        communication.sources,
        communication.confidence,
      ),
    );
  }

  if (items.length === 0) {
    items.push(
      recommendation(
        'continue-monitoring',
        'Continue monitoring project status',
        'No urgent local project risks were detected.',
        'low',
        'continue-monitoring',
        'confidence',
        communication.sources.length > 0 ? communication.sources : ['confidence'],
        communication.confidence,
      ),
    );
  }

  return items.filter(
    (item, index, list) => list.findIndex(next => next.id === item.id) === index,
  );
}

function nextAction(recommendationsList: ProjectRecommendation[]): ProjectNextAction {
  const priorityRank = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const selected = [...recommendationsList].sort(
    (a, b) => priorityRank[b.priority] - priorityRank[a.priority],
  )[0];

  return {
    id: selected.id,
    label: selected.title,
    description: selected.reason,
    priority: selected.priority,
    action: selected.action,
    source: selected.source,
    sources: selected.sources,
    confidence: selected.confidence,
  };
}

export function analyzeProjectIntelligence({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas,
  contacts,
  referenceDocuments,
  reportHistory,
  syncMetadata,
  projectEvents,
  locationIntelligence,
  now = new Date(),
}: AnalyzeProjectIntelligenceParams): ProjectIntelligenceSummary {
  const projectUpdates = relatedProjectUpdates({
    projectName,
    updates,
    currentUpdate,
  });
  const projectScheduleItems = relatedScheduleItems(projectName, scheduleItems);
  const photos = projectUpdates.flatMap(update => update.photos);
  const narrative = narrativeStats(projectUpdates);
  const photoActions = photoActionStats(photos, now);
  const scheduleContext = scheduleContextStats(projectScheduleItems);
  const areaContext = areaContextStats({
    projectAreas,
    projectUpdates,
    scheduleItems: projectScheduleItems,
  });
  const projectLocationIntelligence =
    locationIntelligence ??
    analyzeProjectLocationIntelligence({
      projectName,
      updates,
      scheduleItems,
      currentUpdate,
      projectAreas,
      now,
    });
  const recipients = recipientStats({
    projectUpdates,
    contacts,
  });
  const projectDocuments = relatedReferenceDocuments({
    projectName,
    scheduleItems: projectScheduleItems,
    referenceDocuments,
  });
  const documents = documentContextStats(projectDocuments);
  const projectReports = relatedReportHistory({
    projectName,
    reportHistory,
  });
  const reports = reportHistoryStats(projectReports);
  const sync = syncFreshnessStats(syncMetadata, now);
  const derivedProjectEvents =
    projectEvents ??
    buildProjectEvents({
      projectNames: [projectName],
      updates: projectUpdates,
      scheduleItems: projectScheduleItems,
      contacts,
      referenceDocuments: projectDocuments,
      reportHistory: projectReports,
      syncMetadata,
      now,
    });
  const projectEventTimeline = getProjectEventTimeline(derivedProjectEvents, {
    projectName,
  });
  const recentEvents = getRecentProjectEvents(derivedProjectEvents, {
    projectName,
    limit: 5,
  });
  const projectStory = getProjectStory(derivedProjectEvents, {
    projectName,
    limit: 5,
    now,
  });
  const openDecisionEvents = getOpenDecisionEvents(derivedProjectEvents, {
    projectName,
  });
  const latestActivity = projectStory.latestActivityAt;
  const daysSinceLatestActivity = daysSinceDateTime(latestActivity, now);
  const latestUpdate = latestUpdateDate(projectUpdates);
  const daysSinceLastUpdate = latestUpdate
    ? daysSinceUpdate(latestUpdate, now)
    : null;
  const incompleteScheduleItems = projectScheduleItems.filter(
    item => item.status !== 'Complete' && boundedPercent(item.percentComplete) < 100,
  );
  const overdueScheduleItems = incompleteScheduleItems.filter(item => {
    const days = daysUntilScheduleDate(item.finishDate, now);

    return days !== null && days < 0;
  });
  const upcomingScheduleItems = incompleteScheduleItems.filter(item => {
    const days = daysUntilScheduleDate(item.finishDate, now);

    return days !== null && days >= 0 && days <= UPCOMING_SCHEDULE_WINDOW_DAYS;
  });
  const progressValues = projectScheduleItems.map(item =>
    boundedPercent(item.percentComplete),
  );
  const averageScheduleProgress =
    progressValues.length > 0
      ? Math.round(
          progressValues.reduce((total, value) => total + value, 0) /
            progressValues.length,
        )
      : null;
  const openIssueCount = photos.filter(
    photo => photo.category === 'Open Issue' && photo.actionStatus !== 'Closed',
  ).length;
  const safetyConcernCount = photos.filter(isOpenSafetyConcern).length;
  const schedule = scheduleStatus({
    scheduleItems: projectScheduleItems,
    overdueCount: overdueScheduleItems.length,
    upcomingCount: upcomingScheduleItems.length,
  });
  const progress = progressStatus({
    scheduleItems: projectScheduleItems,
    averageProgress: averageScheduleProgress,
    overdueCount: overdueScheduleItems.length,
  });
  const confidence = confidenceSignal({
    projectName,
    updateCount: projectUpdates.length,
    photoCount: photos.length,
    scheduleItems: projectScheduleItems,
    daysSinceLastUpdate,
    openIssueCount,
    safetyConcernCount,
    noteCount: narrative.noteCount,
    captionCount: narrative.captionCount,
    photoActionCount: photoActions.actionCount,
    areaSignalCount: areaContext.areaSignalCount,
    gpsSignalCount: areaContext.gpsSignalCount,
    locationConfidenceScore: projectLocationIntelligence.confidenceScore,
    scheduleOwnerCount: scheduleContext.ownerCount,
    scheduleContractorCount: scheduleContext.contractorCount,
    documentCount: documents.documentCount,
    contactRecipientCount: recipients.recipientCount,
    projectEventCount: projectEventTimeline.length,
    daysSinceLatestActivity,
  });
  const health = healthSignal({
    updateCount: projectUpdates.length,
    photoCount: photos.length,
    overdueCount: overdueScheduleItems.length,
    upcomingCount: upcomingScheduleItems.length,
    openIssueCount,
    safetyConcernCount,
    averageProgress: averageScheduleProgress,
    daysSinceLastUpdate,
    scheduleItemCount: projectScheduleItems.length,
    noteCount: narrative.noteCount,
    captionCount: narrative.captionCount,
    overduePhotoActionCount: photoActions.overdueActionCount,
    unassignedPhotoActionCount: photoActions.unassignedActionCount,
    areaSignalCount: areaContext.areaSignalCount,
    locationConfidenceScore: projectLocationIntelligence.confidenceScore,
    locationNeedsConfirmation: projectLocationIntelligence.needsConfirmation,
    documentCount: documents.documentCount,
    highPriorityScheduleItemCount: scheduleContext.highPriorityOpenCount,
    waitingScheduleItemCount: scheduleContext.waitingCount,
    syncConflictCount: sync.conflicts,
    projectEventCount: projectEventTimeline.length,
    openDecisionCount: openDecisionEvents.length,
    daysSinceLatestActivity,
  });
  const risks = riskSignals({
    updateCount: projectUpdates.length,
    overdueCount: overdueScheduleItems.length,
    openIssueCount,
    safetyConcernCount,
    scheduleItemCount: projectScheduleItems.length,
    daysSinceLastUpdate,
    photoActionCount: photoActions.actionCount,
    overduePhotoActionCount: photoActions.overdueActionCount,
    unassignedPhotoActionCount: photoActions.unassignedActionCount,
    highPriorityScheduleItemCount: scheduleContext.highPriorityOpenCount,
    waitingScheduleItemCount: scheduleContext.waitingCount,
    areaSignalCount: areaContext.areaSignalCount,
    projectAreaCount: areaContext.configuredAreaCount,
    locationConfidenceScore: projectLocationIntelligence.confidenceScore,
    locationNeedsConfirmation: projectLocationIntelligence.needsConfirmation,
    locationConfirmationPrompt: projectLocationIntelligence.confirmationPrompt,
    documentCount: documents.documentCount,
    currentDocumentCount: documents.currentDocumentCount,
    scheduleDocumentCount: documents.scheduleDocumentCount,
    queuedSyncChanges: sync.queuedChanges,
    syncConflictCount: sync.conflicts,
    daysSinceLastSync: sync.daysSinceLastSync,
    openDecisionCount: openDecisionEvents.length,
  });
  const communication = communicationReadiness({
    projectName,
    projectUpdates,
    photoCount: photos.length,
    scheduleItemCount: projectScheduleItems.length,
    riskCount: risks.length,
    daysSinceLastUpdate,
    noteCount: narrative.noteCount,
    captionCount: narrative.captionCount,
    contactRecipientCount: recipients.recipientCount,
    deliverableContactCount: recipients.deliverableContactCount,
    documentCount: documents.documentCount,
    currentDocumentCount: documents.currentDocumentCount,
    reportHistoryCount: reports.reportHistoryCount,
    daysSinceLastSync: sync.daysSinceLastSync,
    locationConfidenceScore: projectLocationIntelligence.confidenceScore,
    locationNeedsConfirmation: projectLocationIntelligence.needsConfirmation,
  });
  const projectRecommendations = recommendations({
    risks,
    communication,
    upcomingCount: upcomingScheduleItems.length,
  });

  return {
    projectName,
    generatedAt: now.toISOString(),
    healthStatus: health.status,
    scheduleStatus: schedule,
    progressStatus: progress,
    lastUpdate: latestUpdate,
    latestActivity,
    photoCount: photos.length,
    updateCount: projectUpdates.length,
    recentEvents,
    projectStory,
    locationIntelligence: projectLocationIntelligence,
    overdueScheduleItems: overdueScheduleItems.length,
    upcomingScheduleItems: upcomingScheduleItems.length,
    confidence,
    healthSignal: health,
    riskSignals: risks,
    recommendations: projectRecommendations,
    recommendedNextAction: nextAction(projectRecommendations),
    communicationReadiness: communication,
    metrics: {
      averageScheduleProgress,
      scheduleItemCount: projectScheduleItems.length,
      openIssueCount,
      safetyConcernCount,
      daysSinceLastUpdate,
      noteCount: narrative.noteCount,
      captionCount: narrative.captionCount,
      photoActionCount: photoActions.actionCount,
      overduePhotoActionCount: photoActions.overdueActionCount,
      unassignedPhotoActionCount: photoActions.unassignedActionCount,
      areaSignalCount: areaContext.areaSignalCount,
      gpsSignalCount: areaContext.gpsSignalCount,
      locationConfidenceScore: projectLocationIntelligence.confidenceScore,
      scheduleOwnerCount: scheduleContext.ownerCount,
      scheduleContractorCount: scheduleContext.contractorCount,
      highPriorityScheduleItemCount: scheduleContext.highPriorityOpenCount,
      waitingScheduleItemCount: scheduleContext.waitingCount,
      contactRecipientCount: recipients.recipientCount,
      documentCount: documents.documentCount,
      currentDocumentCount: documents.currentDocumentCount,
      scheduleDocumentCount: documents.scheduleDocumentCount,
      reportHistoryCount: reports.reportHistoryCount,
      queuedSyncChanges: sync.queuedChanges,
      syncConflictCount: sync.conflicts,
      daysSinceLastSync: sync.daysSinceLastSync,
      projectEventCount: projectEventTimeline.length,
      openDecisionCount: openDecisionEvents.length,
      daysSinceLatestActivity,
    },
  };
}

export function analyzeProjectsIntelligence({
  projectNames,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas,
  contacts,
  referenceDocuments,
  reportHistory,
  syncMetadata,
  projectEvents,
  locationIntelligenceByProject,
  now = new Date(),
}: AnalyzeProjectsIntelligenceParams): ProjectIntelligenceSummary[] {
  return projectNames.map(projectName =>
    analyzeProjectIntelligence({
      projectName,
      updates,
      scheduleItems,
      currentUpdate,
      projectAreas,
      contacts,
      referenceDocuments,
      reportHistory,
      syncMetadata,
      projectEvents,
      locationIntelligence: locationIntelligenceByProject?.[projectName],
      now,
    }),
  );
}
