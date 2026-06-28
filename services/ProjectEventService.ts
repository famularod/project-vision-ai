import type {
  ContactBook,
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

export type ProjectEventType =
  | 'update_created'
  | 'photo_added'
  | 'schedule_imported'
  | 'schedule_item_overdue'
  | 'report_generated'
  | 'assistant_interaction'
  | 'project_created'
  | 'project_archived'
  | 'project_restored'
  | 'sync_completed'
  | 'issue_created'
  | 'issue_closed'
  | 'safety_observation'
  | 'inspection_event'
  | 'decision_recorded';

export type ProjectEventSource =
  | 'project_update'
  | 'photo'
  | 'schedule'
  | 'report'
  | 'assistant'
  | 'project'
  | 'sync'
  | 'issue'
  | 'safety'
  | 'inspection'
  | 'decision'
  | 'derived';

export type ProjectEventConfidence = 'low' | 'medium' | 'high';

export type ProjectEventRelatedArea = {
  id?: string | null;
  name?: string | null;
  building?: string | null;
};

export type ProjectEventRelatedPerson = {
  id?: string | null;
  name: string;
  role?: string | null;
  contactMethod?: string | null;
};

export type ProjectEventRelatedDocument = {
  id?: string | null;
  name: string;
  category?: string | null;
};

export type ProjectEvent = {
  id: string;
  projectId?: string | null;
  projectName: string;
  eventType: ProjectEventType;
  title: string;
  description: string;
  occurredAt: string;
  source: ProjectEventSource;
  confidence: ProjectEventConfidence;
  relatedArea: ProjectEventRelatedArea | null;
  relatedPeople: ProjectEventRelatedPerson[];
  relatedDocuments: ProjectEventRelatedDocument[];
  metadata: Record<string, unknown>;
};

export type ProjectEventReportMetadata = {
  id?: string;
  projectId?: string | null;
  projectName?: string | null;
  title?: string | null;
  reportType?: string | null;
  generatedAt?: string | null;
  source?: string | null;
};

export type ProjectAssistantInteractionMetadata = {
  id?: string;
  projectId?: string | null;
  projectName: string;
  question?: string | null;
  responseSummary?: string | null;
  occurredAt: string;
  confidence?: ProjectEventConfidence;
};

export type ProjectLifecycleEventMetadata = {
  id?: string;
  projectId?: string | null;
  projectName: string;
  eventType:
    | 'project_created'
    | 'project_archived'
    | 'project_restored'
    | 'inspection_event'
    | 'decision_recorded';
  title?: string | null;
  description?: string | null;
  occurredAt: string;
  confidence?: ProjectEventConfidence;
  relatedArea?: ProjectEventRelatedArea | null;
  relatedPeople?: ProjectEventRelatedPerson[];
  relatedDocuments?: ProjectEventRelatedDocument[];
  metadata?: Record<string, unknown>;
};

export type ProjectEventSyncMetadata = {
  configured?: boolean;
  queuedChanges?: number;
  conflicts?: number;
  lastSyncAt?: string | null;
  checkedAt?: string | null;
  message?: string;
};

export type BuildProjectEventsParams = {
  projectNames?: string[];
  projectIdsByName?: Record<string, string | null | undefined>;
  updates?: ProjectUpdate[];
  scheduleItems?: ScheduleItem[];
  contacts?: ContactBook | ProjectContact[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectEventReportMetadata[];
  assistantInteractions?: ProjectAssistantInteractionMetadata[];
  projectLifecycleEvents?: ProjectLifecycleEventMetadata[];
  syncMetadata?: ProjectEventSyncMetadata | null;
  manualEvents?: ProjectEvent[];
  now?: Date;
};

export type ProjectEventFilterOptions = {
  projectId?: string | null;
  projectName?: string | null;
  eventTypes?: ProjectEventType[];
  limit?: number;
};

export type ProjectStory = {
  projectName: string;
  generatedAt: string;
  eventCount: number;
  latestActivityAt: string | null;
  summary: string;
  highlights: string[];
  recentEvents: ProjectEvent[];
  openDecisions: ProjectEvent[];
  eventTypes: ProjectEventType[];
};

export function buildProjectEvents({
  projectNames = [],
  projectIdsByName = {},
  updates = [],
  scheduleItems = [],
  contacts,
  referenceDocuments = [],
  reportHistory = [],
  assistantInteractions = [],
  projectLifecycleEvents = [],
  syncMetadata = null,
  manualEvents = [],
  now = new Date(),
}: BuildProjectEventsParams): ProjectEvent[] {
  const contactLookup = contactList(contacts).reduce<Record<string, ProjectContact>>(
    (lookup, contact) => ({
      ...lookup,
      [contact.id]: contact,
    }),
    {},
  );
  const events: ProjectEvent[] = [];

  updates.forEach(update => {
    const projectId = projectIdsByName[projectKey(update.projectName)] ?? null;
    const relatedDocuments = relatedDocumentsForProject(
      update.projectName,
      referenceDocuments,
    );

    events.push(updateCreatedEvent(update, projectId, contactLookup, relatedDocuments));

    update.photos.forEach(photo => {
      events.push(photoAddedEvent(update, photo, projectId, relatedDocuments));

      const issueEvent = issueEventFromPhoto(update, photo, projectId, relatedDocuments);
      if (issueEvent) events.push(issueEvent);

      const safetyEvent = safetyEventFromPhoto(update, photo, projectId, relatedDocuments);
      if (safetyEvent) events.push(safetyEvent);
    });
  });

  events.push(
    ...scheduleImportedEvents({
      scheduleItems,
      referenceDocuments,
      projectIdsByName,
    }),
  );
  events.push(
    ...scheduleOverdueEvents({
      scheduleItems,
      referenceDocuments,
      projectIdsByName,
      now,
    }),
  );
  events.push(
    ...reportHistory.map(report =>
      reportGeneratedEvent(report, projectIdsByName, referenceDocuments, now),
    ),
  );
  events.push(
    ...assistantInteractions.map(interaction =>
      assistantInteractionEvent(interaction, projectIdsByName),
    ),
  );
  events.push(
    ...projectLifecycleEvents.map(event =>
      lifecycleProjectEvent(event, projectIdsByName),
    ),
  );

  const syncEvent = syncCompletedEvent({
    syncMetadata,
    projectNames,
    projectIdsByName,
  });
  if (syncEvent) events.push(syncEvent);

  return dedupeEvents([...events, ...manualEvents]).sort(compareEventsNewestFirst);
}

export function getRecentProjectEvents(
  events: ProjectEvent[],
  options: ProjectEventFilterOptions = {},
): ProjectEvent[] {
  const limit = options.limit ?? 10;

  return filterProjectEvents(events, options)
    .sort(compareEventsNewestFirst)
    .slice(0, limit);
}

export function getProjectStory(
  events: ProjectEvent[],
  options: ProjectEventFilterOptions & { now?: Date } = {},
): ProjectStory {
  const projectEvents = getProjectEventTimeline(events, options);
  const recentEvents = getRecentProjectEvents(projectEvents, {
    ...options,
    limit: options.limit ?? 5,
  });
  const openDecisions = getOpenDecisionEvents(projectEvents, options);
  const latestActivityAt = recentEvents[0]?.occurredAt ?? null;
  const eventTypes = uniqueEventTypes(projectEvents);
  const projectName =
    options.projectName?.trim() ||
    recentEvents[0]?.projectName ||
    projectEvents[0]?.projectName ||
    'Project';
  const highlights = buildProjectHighlights(projectEvents, openDecisions);

  return {
    projectName,
    generatedAt: (options.now ?? new Date()).toISOString(),
    eventCount: projectEvents.length,
    latestActivityAt,
    summary: buildProjectStorySummary(projectName, projectEvents, latestActivityAt),
    highlights,
    recentEvents,
    openDecisions,
    eventTypes,
  };
}

export function getOpenDecisionEvents(
  events: ProjectEvent[],
  options: ProjectEventFilterOptions = {},
): ProjectEvent[] {
  return filterProjectEvents(events, {
    ...options,
    eventTypes: ['decision_recorded'],
  }).filter(event => {
    const status = String(event.metadata.status ?? '').trim().toLowerCase();

    return !['closed', 'complete', 'completed', 'resolved'].includes(status);
  });
}

export function getProjectEventTimeline(
  events: ProjectEvent[],
  options: ProjectEventFilterOptions = {},
): ProjectEvent[] {
  return filterProjectEvents(events, options).sort(compareEventsOldestFirst);
}

function updateCreatedEvent(
  update: ProjectUpdate,
  projectId: string | null,
  contactLookup: Record<string, ProjectContact>,
  relatedDocuments: ProjectEventRelatedDocument[],
): ProjectEvent {
  const photoCount = update.photos.length;
  const note = update.notes.trim();

  return {
    id: stableId('update_created', update.id),
    projectId,
    projectName: update.projectName,
    eventType: 'update_created',
    title: 'Update captured',
    description:
      note ||
      `${photoCount} photo${photoCount === 1 ? '' : 's'} saved for this update.`,
    occurredAt: normalizeDateValue(update.date),
    source: 'project_update',
    confidence: 'high',
    relatedArea: relatedAreaFromUpdate(update),
    relatedPeople: relatedPeopleFromRecipientIds(
      update.recipients.contactIds,
      contactLookup,
    ),
    relatedDocuments,
    metadata: {
      updateId: update.id,
      photoCount,
      hasNotes: Boolean(note),
      recipientIds: update.recipients.contactIds,
    },
  };
}

function photoAddedEvent(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  projectId: string | null,
  relatedDocuments: ProjectEventRelatedDocument[],
): ProjectEvent {
  return {
    id: stableId('photo_added', update.id, photo.id),
    projectId,
    projectName: update.projectName,
    eventType: 'photo_added',
    title: 'Photo added',
    description: photo.caption.trim() || `${photo.category} photo added.`,
    occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date),
    source: 'photo',
    confidence: 'high',
    relatedArea: relatedAreaFromPhoto(update, photo),
    relatedPeople: relatedPeopleFromPhoto(photo),
    relatedDocuments,
    metadata: {
      updateId: update.id,
      photoId: photo.id,
      category: photo.category,
      actionRequired: photo.actionRequired,
      actionStatus: photo.actionStatus,
      actionDueDate: photo.actionDueDate || null,
      hasGps:
        typeof photo.gpsLatitude === 'number' &&
        typeof photo.gpsLongitude === 'number',
    },
  };
}

function issueEventFromPhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  projectId: string | null,
  relatedDocuments: ProjectEventRelatedDocument[],
): ProjectEvent | null {
  if (photo.category !== 'Open Issue') return null;

  const closed = photo.actionStatus === 'Closed';

  return {
    id: stableId(closed ? 'issue_closed' : 'issue_created', update.id, photo.id),
    projectId,
    projectName: update.projectName,
    eventType: closed ? 'issue_closed' : 'issue_created',
    title: closed ? 'Issue closed' : 'Issue created',
    description:
      photo.actionRequired.trim() ||
      photo.caption.trim() ||
      (closed ? 'Issue was marked closed.' : 'Open issue was captured.'),
    occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date),
    source: 'issue',
    confidence: 'high',
    relatedArea: relatedAreaFromPhoto(update, photo),
    relatedPeople: relatedPeopleFromPhoto(photo),
    relatedDocuments,
    metadata: {
      updateId: update.id,
      photoId: photo.id,
      actionStatus: photo.actionStatus,
      actionDueDate: photo.actionDueDate || null,
    },
  };
}

function safetyEventFromPhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
  projectId: string | null,
  relatedDocuments: ProjectEventRelatedDocument[],
): ProjectEvent | null {
  if (photo.category !== 'Safety Concern') return null;

  return {
    id: stableId('safety_observation', update.id, photo.id),
    projectId,
    projectName: update.projectName,
    eventType: 'safety_observation',
    title: 'Safety observation',
    description:
      photo.actionRequired.trim() ||
      photo.caption.trim() ||
      'Safety concern was captured.',
    occurredAt: normalizeDateValue(photo.locationCapturedAt || update.date),
    source: 'safety',
    confidence: 'high',
    relatedArea: relatedAreaFromPhoto(update, photo),
    relatedPeople: relatedPeopleFromPhoto(photo),
    relatedDocuments,
    metadata: {
      updateId: update.id,
      photoId: photo.id,
      actionStatus: photo.actionStatus,
      actionDueDate: photo.actionDueDate || null,
    },
  };
}

function scheduleImportedEvents({
  scheduleItems,
  referenceDocuments,
  projectIdsByName,
}: {
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  projectIdsByName: Record<string, string | null | undefined>;
}) {
  const grouped = new Map<string, ScheduleItem[]>();

  scheduleItems.forEach(item => {
    if (!item.importedFrom && !item.importedAt) return;

    const key = [
      item.projectName,
      item.importedFrom || 'Manual schedule',
      item.importedAt || item.createdAt,
    ].join('|');
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });

  return Array.from(grouped.values()).map(items => {
    const first = items[0];
    const sourceName = first.importedFrom || 'Manual schedule';
    const relatedDocuments = relatedDocumentsForScheduleSource(
      first.projectName,
      sourceName,
      referenceDocuments,
    );

    return {
      id: stableId(
        'schedule_imported',
        first.projectName,
        sourceName,
        first.importedAt || first.createdAt,
      ),
      projectId: projectIdsByName[projectKey(first.projectName)] ?? null,
      projectName: first.projectName,
      eventType: 'schedule_imported' as const,
      title: 'Schedule imported',
      description: `${items.length} schedule item${items.length === 1 ? '' : 's'} imported from ${sourceName}.`,
      occurredAt: normalizeDateValue(first.importedAt || first.createdAt),
      source: 'schedule' as const,
      confidence: 'medium' as const,
      relatedArea: first.locationName
        ? {
            name: first.locationName,
          }
        : null,
      relatedPeople: uniquePeople([
        ...items.map(item => namedPerson(item.owner, 'Owner')),
        ...items.map(item => namedPerson(item.contractor, 'Contractor')),
      ]),
      relatedDocuments,
      metadata: {
        importedFrom: first.importedFrom || null,
        itemCount: items.length,
        importedAt: first.importedAt || null,
      },
    };
  });
}

function scheduleOverdueEvents({
  scheduleItems,
  referenceDocuments,
  projectIdsByName,
  now,
}: {
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  projectIdsByName: Record<string, string | null | undefined>;
  now: Date;
}) {
  const today = startOfDay(now);

  return scheduleItems
    .filter(item => {
      if (item.status === 'Complete' || boundedPercent(item.percentComplete) >= 100) {
        return false;
      }

      const finishDate = parseFlexibleDate(item.finishDate);

      return Boolean(finishDate && finishDate < today);
    })
    .map(item => ({
      id: stableId('schedule_item_overdue', item.id, item.finishDate),
      projectId: projectIdsByName[projectKey(item.projectName)] ?? null,
      projectName: item.projectName,
      eventType: 'schedule_item_overdue' as const,
      title: 'Schedule item overdue',
      description: `${item.taskName || 'Schedule item'} is overdue.`,
      occurredAt: normalizeDateValue(item.finishDate || item.createdAt),
      source: 'schedule' as const,
      confidence: 'high' as const,
      relatedArea: item.locationName
        ? {
            name: item.locationName,
          }
        : null,
      relatedPeople: uniquePeople([
        namedPerson(item.owner, 'Owner'),
        namedPerson(item.contractor, 'Contractor'),
      ]),
      relatedDocuments: relatedDocumentsForScheduleSource(
        item.projectName,
        item.importedFrom || '',
        referenceDocuments,
      ),
      metadata: {
        scheduleItemId: item.id,
        taskName: item.taskName,
        finishDate: item.finishDate,
        status: item.status,
        percentComplete: item.percentComplete,
        priority: item.priority,
      },
    }));
}

function reportGeneratedEvent(
  report: ProjectEventReportMetadata,
  projectIdsByName: Record<string, string | null | undefined>,
  referenceDocuments: ReferenceDocument[],
  now: Date,
): ProjectEvent {
  const projectName = report.projectName?.trim() || 'Portfolio';
  const title = report.title?.trim() || report.reportType?.trim() || 'Report';

  return {
    id: stableId('report_generated', report.id || title, report.generatedAt || now.toISOString()),
    projectId: report.projectId ?? projectIdsByName[projectKey(projectName)] ?? null,
    projectName,
    eventType: 'report_generated',
    title: 'Report generated',
    description: `${title} was generated.`,
    occurredAt: normalizeDateValue(report.generatedAt || now.toISOString()),
    source: 'report',
    confidence: report.generatedAt ? 'high' : 'medium',
    relatedArea: null,
    relatedPeople: [],
    relatedDocuments: relatedDocumentsForProject(projectName, referenceDocuments),
    metadata: {
      reportId: report.id || null,
      reportType: report.reportType || null,
      source: report.source || null,
    },
  };
}

function assistantInteractionEvent(
  interaction: ProjectAssistantInteractionMetadata,
  projectIdsByName: Record<string, string | null | undefined>,
): ProjectEvent {
  return {
    id: stableId('assistant_interaction', interaction.id || interaction.occurredAt, interaction.projectName),
    projectId: interaction.projectId ?? projectIdsByName[projectKey(interaction.projectName)] ?? null,
    projectName: interaction.projectName,
    eventType: 'assistant_interaction',
    title: 'Assistant interaction',
    description:
      interaction.responseSummary?.trim() ||
      interaction.question?.trim() ||
      'Project Assistant was used for this project.',
    occurredAt: normalizeDateValue(interaction.occurredAt),
    source: 'assistant',
    confidence: interaction.confidence ?? 'medium',
    relatedArea: null,
    relatedPeople: [],
    relatedDocuments: [],
    metadata: {
      interactionId: interaction.id || null,
      question: interaction.question || null,
    },
  };
}

function lifecycleProjectEvent(
  event: ProjectLifecycleEventMetadata,
  projectIdsByName: Record<string, string | null | undefined>,
): ProjectEvent {
  return {
    id: stableId(event.eventType, event.id || event.occurredAt, event.projectName),
    projectId: event.projectId ?? projectIdsByName[projectKey(event.projectName)] ?? null,
    projectName: event.projectName,
    eventType: event.eventType,
    title: event.title?.trim() || titleForEventType(event.eventType),
    description:
      event.description?.trim() ||
      `${titleForEventType(event.eventType)} recorded for this project.`,
    occurredAt: normalizeDateValue(event.occurredAt),
    source: sourceForLifecycleEvent(event.eventType),
    confidence: event.confidence ?? 'medium',
    relatedArea: event.relatedArea ?? null,
    relatedPeople: event.relatedPeople ?? [],
    relatedDocuments: event.relatedDocuments ?? [],
    metadata: event.metadata ?? {},
  };
}

function syncCompletedEvent({
  syncMetadata,
  projectNames,
  projectIdsByName,
}: {
  syncMetadata: ProjectEventSyncMetadata | null;
  projectNames: string[];
  projectIdsByName: Record<string, string | null | undefined>;
}): ProjectEvent | null {
  if (!syncMetadata?.lastSyncAt) return null;

  const projectName = projectNames[0] || 'All Projects';

  return {
    id: stableId('sync_completed', syncMetadata.lastSyncAt, projectName),
    projectId: projectIdsByName[projectKey(projectName)] ?? null,
    projectName,
    eventType: 'sync_completed',
    title: 'Sync completed',
    description: syncMetadata.message || 'Project data sync completed.',
    occurredAt: normalizeDateValue(syncMetadata.lastSyncAt),
    source: 'sync',
    confidence: 'medium',
    relatedArea: null,
    relatedPeople: [],
    relatedDocuments: [],
    metadata: {
      configured: syncMetadata.configured ?? null,
      queuedChanges: syncMetadata.queuedChanges ?? null,
      conflicts: syncMetadata.conflicts ?? null,
      checkedAt: syncMetadata.checkedAt ?? null,
    },
  };
}

function filterProjectEvents(
  events: ProjectEvent[],
  options: ProjectEventFilterOptions,
) {
  return events.filter(event => {
    if (options.projectId && event.projectId !== options.projectId) return false;
    if (
      options.projectName &&
      event.projectName.trim().toLowerCase() !== options.projectName.trim().toLowerCase()
    ) {
      return false;
    }
    if (
      options.eventTypes &&
      !options.eventTypes.includes(event.eventType)
    ) {
      return false;
    }

    return true;
  });
}

function buildProjectStorySummary(
  projectName: string,
  events: ProjectEvent[],
  latestActivityAt: string | null,
) {
  if (events.length === 0) {
    return `${projectName} does not have derived project events yet.`;
  }

  const latest = latestActivityAt
    ? ` Latest activity: ${formatEventDate(latestActivityAt)}.`
    : '';

  return `${projectName} has ${events.length} derived project event${events.length === 1 ? '' : 's'} across ${uniqueEventTypes(events).length} event type${uniqueEventTypes(events).length === 1 ? '' : 's'}.${latest}`;
}

function buildProjectHighlights(
  events: ProjectEvent[],
  openDecisions: ProjectEvent[],
) {
  const highlights: string[] = [];
  const counts = eventTypeCounts(events);

  if (counts.update_created) {
    highlights.push(`${counts.update_created} update${counts.update_created === 1 ? '' : 's'} captured.`);
  }
  if (counts.photo_added) {
    highlights.push(`${counts.photo_added} photo${counts.photo_added === 1 ? '' : 's'} added.`);
  }
  if (counts.schedule_item_overdue) {
    highlights.push(`${counts.schedule_item_overdue} overdue schedule event${counts.schedule_item_overdue === 1 ? '' : 's'}.`);
  }
  if (counts.issue_created || counts.issue_closed) {
    highlights.push(`${counts.issue_created || 0} issue${counts.issue_created === 1 ? '' : 's'} created, ${counts.issue_closed || 0} closed.`);
  }
  if (counts.safety_observation) {
    highlights.push(`${counts.safety_observation} safety observation${counts.safety_observation === 1 ? '' : 's'} recorded.`);
  }
  if (openDecisions.length > 0) {
    highlights.push(`${openDecisions.length} open decision${openDecisions.length === 1 ? '' : 's'} need review.`);
  }

  return highlights.length > 0
    ? highlights
    : ['Project event memory is available for this project.'];
}

function eventTypeCounts(events: ProjectEvent[]) {
  return events.reduce<Partial<Record<ProjectEventType, number>>>((counts, event) => ({
    ...counts,
    [event.eventType]: (counts[event.eventType] ?? 0) + 1,
  }), {});
}

function uniqueEventTypes(events: ProjectEvent[]) {
  return Array.from(new Set(events.map(event => event.eventType)));
}

function relatedAreaFromUpdate(update: ProjectUpdate): ProjectEventRelatedArea | null {
  if (!update.selectedAreaId && !update.selectedAreaName) return null;

  return {
    id: update.selectedAreaId ?? null,
    name: update.selectedAreaName ?? null,
  };
}

function relatedAreaFromPhoto(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): ProjectEventRelatedArea | null {
  if (
    !photo.selectedAreaId &&
    !photo.selectedAreaName &&
    !update.selectedAreaId &&
    !update.selectedAreaName
  ) {
    return null;
  }

  return {
    id: photo.selectedAreaId ?? update.selectedAreaId ?? null,
    name: photo.selectedAreaName ?? update.selectedAreaName ?? null,
  };
}

function relatedPeopleFromPhoto(photo: UpdatePhoto) {
  return uniquePeople([
    namedPerson(photo.actionOwner, 'Action Owner'),
  ]);
}

function relatedPeopleFromRecipientIds(
  contactIds: string[],
  contactLookup: Record<string, ProjectContact>,
) {
  return uniquePeople(
    contactIds.map(contactId => {
      const contact = contactLookup[contactId];

      if (!contact) {
        return {
          id: contactId,
          name: contactId,
          role: 'Recipient',
        };
      }

      return {
        id: contact.id,
        name: contact.name || contact.email || contact.phone || contact.id,
        role: 'Recipient',
        contactMethod:
          contact.selectedEmail ||
          contact.email ||
          contact.selectedPhone ||
          contact.phone ||
          null,
      };
    }),
  );
}

function relatedDocumentsForProject(
  projectName: string,
  documents: ReferenceDocument[],
) {
  const normalizedProject = projectName.trim().toLowerCase();

  return documents
    .filter(document => {
      if (!normalizedProject) return false;

      return [
        document.name,
        document.originalFileName,
        document.category,
        document.notes,
      ].some(value => value.toLowerCase().includes(normalizedProject));
    })
    .map(relatedDocumentFromReference);
}

function relatedDocumentsForScheduleSource(
  projectName: string,
  sourceName: string,
  documents: ReferenceDocument[],
) {
  const normalizedSource = sourceName.trim().toLowerCase();
  const projectDocuments = relatedDocumentsForProject(projectName, documents);
  const sourceDocuments = documents
    .filter(document => {
      if (!normalizedSource) {
        return document.category.trim().toLowerCase() === 'schedules';
      }

      return [
        document.name,
        document.originalFileName,
        document.uri,
      ].some(value => value.toLowerCase().includes(normalizedSource));
    })
    .map(relatedDocumentFromReference);

  return uniqueDocuments([...projectDocuments, ...sourceDocuments]);
}

function relatedDocumentFromReference(
  document: ReferenceDocument,
): ProjectEventRelatedDocument {
  return {
    id: document.id,
    name: document.name || document.originalFileName,
    category: document.category,
  };
}

function contactList(contacts?: ContactBook | ProjectContact[]) {
  if (!contacts) return [];

  return Array.isArray(contacts) ? contacts : contacts.contacts;
}

function namedPerson(
  name: string | null | undefined,
  role: string,
): ProjectEventRelatedPerson | null {
  const trimmed = name?.trim();

  if (!trimmed) return null;

  return {
    name: trimmed,
    role,
  };
}

function uniquePeople(
  people: Array<ProjectEventRelatedPerson | null | undefined>,
) {
  const seen = new Set<string>();
  const unique: ProjectEventRelatedPerson[] = [];

  people.forEach(person => {
    if (!person?.name.trim()) return;

    const key = `${person.id || ''}|${person.name}|${person.role || ''}`.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(person);
  });

  return unique;
}

function uniqueDocuments(documents: ProjectEventRelatedDocument[]) {
  const seen = new Set<string>();
  const unique: ProjectEventRelatedDocument[] = [];

  documents.forEach(document => {
    const key = `${document.id || ''}|${document.name}`.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(document);
  });

  return unique;
}

function dedupeEvents(events: ProjectEvent[]) {
  const seen = new Set<string>();
  const unique: ProjectEvent[] = [];

  events.forEach(event => {
    if (seen.has(event.id)) return;

    seen.add(event.id);
    unique.push(event);
  });

  return unique;
}

function normalizeDateValue(value: string) {
  const trimmed = value.trim();
  const parsedDate = parseDueDate(trimmed) || parseFlexibleDate(trimmed);

  if (parsedDate) return parsedDate.toISOString();

  const date = new Date(trimmed);

  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compareEventsNewestFirst(left: ProjectEvent, right: ProjectEvent) {
  return right.occurredAt.localeCompare(left.occurredAt);
}

function compareEventsOldestFirst(left: ProjectEvent, right: ProjectEvent) {
  return left.occurredAt.localeCompare(right.occurredAt);
}

function stableId(...parts: Array<string | number | null | undefined>) {
  return parts
    .map(part => String(part ?? 'none').trim().toLowerCase())
    .join('|')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function projectKey(projectName: string) {
  return projectName.trim().toLowerCase();
}

function titleForEventType(eventType: ProjectEventType) {
  return eventType
    .split('_')
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function sourceForLifecycleEvent(eventType: ProjectEventType): ProjectEventSource {
  if (eventType === 'inspection_event') return 'inspection';
  if (eventType === 'decision_recorded') return 'decision';

  return 'project';
}

function formatEventDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
