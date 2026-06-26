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

export type ConstructionTimelineFilter =
  | 'All'
  | 'Updates'
  | 'Photos'
  | 'Schedule'
  | 'Safety'
  | 'Action Items'
  | 'Documents';

export type ConstructionTimelineEventType = Exclude<
  ConstructionTimelineFilter,
  'All'
>;

export type ConstructionTimelineEvent = {
  id: string;
  type: ConstructionTimelineEventType;
  dateLabel: string;
  timestamp: number;
  projectName: string;
  areaName: string;
  description: string;
  relatedPhotosCount: number;
  relatedActionItems: string[];
  hasRisk: boolean;
  hasSafety: boolean;
  sourceLabel: string;
};

export type ConstructionTimelineSummary = {
  projectCount: number;
  totalEvents: number;
  updateEvents: number;
  photoEvents: number;
  scheduleEvents: number;
  safetyEvents: number;
  actionItemEvents: number;
  documentEvents: number;
  riskEvents: number;
  relatedPhotos: number;
  relatedActionItems: number;
};

export type ConstructionTimeline = {
  events: ConstructionTimelineEvent[];
  summary: ConstructionTimelineSummary;
};

export const TIMELINE_FILTERS: ConstructionTimelineFilter[] = [
  'All',
  'Updates',
  'Photos',
  'Schedule',
  'Safety',
  'Action Items',
  'Documents',
];

type ConstructionTimelineParams = {
  projects: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate?: ProjectUpdate | null;
};

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

function scheduleDate(item: ScheduleItem) {
  return (
    parseFlexibleDate(item.finishDate) ||
    parseFlexibleDate(item.startDate) ||
    parseStoredDate(item.importedAt) ||
    parseStoredDate(item.createdAt)
  );
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function truncateText(value: string, fallback: string) {
  const trimmed = value.trim();
  const text = trimmed || fallback;

  if (text.length <= 120) return text;

  return `${text.slice(0, 117).trim()}...`;
}

function updateArea(update: ProjectUpdate) {
  return (
    update.selectedAreaName ||
    update.photos.find(photo => photo.selectedAreaName)?.selectedAreaName ||
    'No area selected'
  );
}

function photoArea(update: ProjectUpdate, photo: UpdatePhoto) {
  return photo.selectedAreaName || update.selectedAreaName || 'No area selected';
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

function actionText(photo: UpdatePhoto) {
  return photo.actionRequired || photo.caption || photo.category;
}

function actionDueText(photo: UpdatePhoto) {
  return photo.actionDueDate.trim()
    ? ` ${dueStatusText(photo.actionDueDate)}.`
    : '';
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

function categorySummary(photos: UpdatePhoto[]) {
  const counts = photos.reduce<Record<string, number>>((summary, photo) => {
    summary[photo.category] = (summary[photo.category] || 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .map(([category, count]) => `${count} ${category}`)
    .join(', ');
}

function makeEvent({
  id,
  type,
  date,
  projectName,
  areaName,
  description,
  relatedPhotosCount = 0,
  relatedActionItems = [],
  hasRisk = false,
  hasSafety = false,
  sourceLabel,
}: {
  id: string;
  type: ConstructionTimelineEventType;
  date: Date;
  projectName: string;
  areaName: string;
  description: string;
  relatedPhotosCount?: number;
  relatedActionItems?: string[];
  hasRisk?: boolean;
  hasSafety?: boolean;
  sourceLabel: string;
}): ConstructionTimelineEvent {
  return {
    id,
    type,
    dateLabel: formatDateLabel(date),
    timestamp: date.getTime(),
    projectName: projectName.trim() || 'No project selected',
    areaName: areaName.trim() || 'No area selected',
    description,
    relatedPhotosCount,
    relatedActionItems,
    hasRisk,
    hasSafety,
    sourceLabel,
  };
}

function updateEvents(updates: ProjectUpdate[]) {
  return updates.flatMap(update => {
    const date = parseUpdateDate(update);
    if (!date) return [];

    const openActions = update.photos.filter(isOpenAction);
    const safetyConcerns = update.photos.filter(
      photo => photo.category === 'Safety Concern',
    );

    return [
      makeEvent({
        id: `update-${update.id}`,
        type: 'Updates',
        date,
        projectName: update.projectName,
        areaName: updateArea(update),
        description: truncateText(
          update.notes,
          `Project update captured with ${countLabel(update.photos.length, 'photo')}.`,
        ),
        relatedPhotosCount: update.photos.length,
        relatedActionItems: openActions.map(actionText),
        hasRisk: openActions.length > 0,
        hasSafety: safetyConcerns.length > 0,
        sourceLabel: 'Saved update',
      }),
    ];
  });
}

function photoEvents(updates: ProjectUpdate[]) {
  return updates.flatMap(update => {
    if (update.photos.length === 0) return [];

    const date = parseUpdateDate(update);
    if (!date) return [];

    const openActions = update.photos.filter(isOpenAction);
    const safetyConcerns = update.photos.filter(
      photo => photo.category === 'Safety Concern',
    );

    return [
      makeEvent({
        id: `photos-${update.id}`,
        type: 'Photos',
        date,
        projectName: update.projectName,
        areaName: updateArea(update),
        description: `${countLabel(update.photos.length, 'photo')} added: ${categorySummary(update.photos) || 'field progress'}.`,
        relatedPhotosCount: update.photos.length,
        relatedActionItems: openActions.map(actionText),
        hasRisk: openActions.length > 0,
        hasSafety: safetyConcerns.length > 0,
        sourceLabel: 'Photo capture',
      }),
    ];
  });
}

function actionItemEvents(updates: ProjectUpdate[]) {
  return updates.flatMap(update => {
    const date = parseUpdateDate(update);
    if (!date) return [];

    return update.photos
      .filter(photo => isActionCategory(photo) && hasActionDetails(photo))
      .map(photo =>
        makeEvent({
          id: `action-${update.id}-${photo.id}`,
          type: 'Action Items',
          date,
          projectName: update.projectName,
          areaName: photoArea(update, photo),
          description: truncateText(
            `${actionText(photo)}.${actionDueText(photo)}`,
            'Action item recorded.',
          ),
          relatedPhotosCount: 1,
          relatedActionItems: [actionText(photo)],
          hasRisk: photo.actionStatus !== 'Closed' || isOverdueAction(photo),
          hasSafety: photo.category === 'Safety Concern',
          sourceLabel: photo.actionStatus,
        }),
      );
  });
}

function safetyEvents(updates: ProjectUpdate[]) {
  return updates.flatMap(update => {
    const date = parseUpdateDate(update);
    if (!date) return [];

    return update.photos
      .filter(photo => photo.category === 'Safety Concern')
      .map(photo =>
        makeEvent({
          id: `safety-${update.id}-${photo.id}`,
          type: 'Safety',
          date,
          projectName: update.projectName,
          areaName: photoArea(update, photo),
          description: truncateText(
            photo.actionRequired || photo.caption,
            'Safety concern recorded.',
          ),
          relatedPhotosCount: 1,
          relatedActionItems: hasActionDetails(photo) ? [actionText(photo)] : [],
          hasRisk: photo.actionStatus !== 'Closed',
          hasSafety: true,
          sourceLabel: photo.actionStatus,
        }),
      );
  });
}

function scheduleEvents(scheduleItems: ScheduleItem[]) {
  return scheduleItems.flatMap(item => {
    const date = scheduleDate(item);
    if (!date) return [];

    const overdue = daysUntilDate(item.finishDate) !== null &&
      (daysUntilDate(item.finishDate) ?? 0) < 0 &&
      item.status !== 'Complete';
    const title = item.milestone || item.taskName || 'Schedule milestone';
    const progressText = `${item.percentComplete}% complete`;
    const ownerText = item.owner ? ` Owner: ${item.owner}.` : '';

    return [
      makeEvent({
        id: `schedule-${item.id}`,
        type: 'Schedule',
        date,
        projectName: item.projectName,
        areaName: item.locationName || 'No area selected',
        description: truncateText(
          `${title} is ${item.status.toLowerCase()} (${progressText}).${ownerText}`,
          'Schedule milestone tracked.',
        ),
        hasRisk: overdue || item.priority === 'High',
        hasSafety: false,
        sourceLabel: item.priority,
      }),
    ];
  });
}

function documentEvents(referenceDocuments: ReferenceDocument[]) {
  return referenceDocuments.flatMap(document => {
    const date = parseStoredDate(document.importedAt);
    if (!date) return [];

    return [
      makeEvent({
        id: `document-${document.id}`,
        type: 'Documents',
        date,
        projectName: document.category || 'Reference Documents',
        areaName: document.category || 'Documents',
        description: truncateText(
          document.notes,
          `${document.name || document.originalFileName || 'Reference document'} added.`,
        ),
        hasRisk: false,
        hasSafety: false,
        sourceLabel: document.isCurrent ? 'Current document' : 'Reference document',
      }),
    ];
  });
}

function timelineSummary(
  events: ConstructionTimelineEvent[],
  projectCount: number,
) {
  return events.reduce<ConstructionTimelineSummary>(
    (summary, event) => {
      summary.totalEvents += 1;
      summary.relatedPhotos += event.relatedPhotosCount;
      summary.relatedActionItems += event.relatedActionItems.length;

      if (event.hasRisk) summary.riskEvents += 1;

      if (event.type === 'Updates') summary.updateEvents += 1;
      if (event.type === 'Photos') summary.photoEvents += 1;
      if (event.type === 'Schedule') summary.scheduleEvents += 1;
      if (event.type === 'Safety') summary.safetyEvents += 1;
      if (event.type === 'Action Items') summary.actionItemEvents += 1;
      if (event.type === 'Documents') summary.documentEvents += 1;

      return summary;
    },
    {
      projectCount,
      totalEvents: 0,
      updateEvents: 0,
      photoEvents: 0,
      scheduleEvents: 0,
      safetyEvents: 0,
      actionItemEvents: 0,
      documentEvents: 0,
      riskEvents: 0,
      relatedPhotos: 0,
      relatedActionItems: 0,
    },
  );
}

export function buildConstructionTimeline({
  projects,
  updates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
}: ConstructionTimelineParams): ConstructionTimeline {
  const timelineUpdates = updatesWithCurrent(updates, currentUpdate);
  const projectNames = new Set<string>();
  projects.forEach(project => {
    if (project.trim()) projectNames.add(project.trim().toLowerCase());
  });
  timelineUpdates.forEach(update => {
    if (update.projectName.trim()) {
      projectNames.add(update.projectName.trim().toLowerCase());
    }
  });
  scheduleItems.forEach(item => {
    if (item.projectName.trim()) {
      projectNames.add(item.projectName.trim().toLowerCase());
    }
  });

  const events = [
    ...updateEvents(timelineUpdates),
    ...photoEvents(timelineUpdates),
    ...actionItemEvents(timelineUpdates),
    ...safetyEvents(timelineUpdates),
    ...scheduleEvents(scheduleItems),
    ...documentEvents(referenceDocuments),
  ]
    .filter(event => !Number.isNaN(event.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp || a.type.localeCompare(b.type));

  return {
    events,
    summary: timelineSummary(events, projectNames.size),
  };
}
