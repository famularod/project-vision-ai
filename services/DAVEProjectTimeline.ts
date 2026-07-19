import type {
  DAVEBriefNavigationTarget,
  DAVEBriefSourceType,
  DAVEDailyBriefDocument,
  DAVEDailyBriefPhoto,
  DAVEDailyBriefScheduleItem,
  DAVEDailyBriefUpdate,
} from './DAVEDailyBrief';
import type { DAVEProjectCommitment } from './DAVEProjectCommitments';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import type {
  DAVEProjectRealityConfidence,
  DAVEProjectRealityEvidence,
  DAVEProjectRealityRecommendation,
  DAVEProjectRealityState,
} from './DAVEProjectReality';
import {
  reconcileScheduleProgress,
  scheduleProgressIsComplete,
} from './ScheduleProgressInvariant';

export type DAVEProjectTimelineEventType =
  | 'project_created'
  | 'update_recorded'
  | 'qualified_photo_observation'
  | 'baseline_established'
  | 'document_added'
  | 'commitment_created'
  | 'commitment_completed'
  | 'commitment_overdue'
  | 'safety_issue_opened'
  | 'safety_issue_resolved'
  | 'action_created'
  | 'action_completed'
  | 'schedule_milestone_reached'
  | 'waiting_dependency_recorded'
  | 'project_state_changed'
  | 'recommendation_generated'
  | 'memory_confirmed';

export type DAVETimelineEvidenceClass = 'fact' | 'interpretation' | 'recommendation';

export type DAVEProjectTimelineEvent = {
  id: string;
  timestamp: string;
  projectId: string;
  eventType: DAVEProjectTimelineEventType;
  evidenceClass: DAVETimelineEvidenceClass;
  title: string;
  summary: string;
  evidence: DAVEProjectRealityEvidence[];
  navigationTarget: DAVEBriefNavigationTarget;
  confidence: DAVEProjectRealityConfidence;
  limitations: string[];
};

export type DAVEProjectTimelineRealityInput = {
  state: DAVEProjectRealityState;
  confidence: DAVEProjectRealityConfidence;
  lastVerifiedAt: string | null;
  topRecommendation: DAVEProjectRealityRecommendation | null;
};

export type BuildProjectTimelineInput = {
  projectId: string;
  projectName: string;
  projectCreatedAt?: string | null;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
  commitments: DAVEProjectCommitment[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  reality: DAVEProjectTimelineRealityInput;
  now?: string;
};

type StateMarker = {
  state: DAVEProjectRealityState;
  timestamp: string;
  evidence: DAVEProjectRealityEvidence;
  navigationTarget: DAVEBriefNavigationTarget;
};

const EVENT_ORDER: Record<DAVEProjectTimelineEventType, number> = {
  safety_issue_opened: 0,
  safety_issue_resolved: 0,
  commitment_created: 1,
  commitment_completed: 1,
  commitment_overdue: 1,
  qualified_photo_observation: 2,
  baseline_established: 2,
  document_added: 3,
  update_recorded: 4,
  project_created: 5,
  action_created: 5,
  action_completed: 5,
  schedule_milestone_reached: 5,
  waiting_dependency_recorded: 5,
  project_state_changed: 5,
  recommendation_generated: 5,
  memory_confirmed: 5,
};

export function buildProjectTimeline(input: BuildProjectTimelineInput): DAVEProjectTimelineEvent[] {
  const projectKey = normalizeKey(input.projectName);
  const updates = input.updates.filter(update => normalizeKey(update.projectName) === projectKey);
  const documents = input.documents.filter(document =>
    !document.isArchived && (!document.projectId || document.projectId === input.projectId),
  );
  const scheduleItems = input.scheduleItems.filter(item => normalizeKey(item.projectName) === projectKey);
  const updateById = new Map(updates.map(update => [update.id, update]));
  const photoById = new Map(updates.flatMap(update => update.photos.map(photo => [photo.id, { photo, update }] as const)));
  const captureMemories = (input.captureMemories ?? []).filter(memory =>
    projectMatches(memory.recommendedProject.value, input.projectId, input.projectName),
  );
  const memoryById = new Map(captureMemories.map(memory => [memory.id, memory]));
  const events: DAVEProjectTimelineEvent[] = [];
  const stateMarkers: StateMarker[] = [];

  if (validTimestamp(input.projectCreatedAt)) {
    events.push(event({
      projectId: input.projectId,
      timestamp: input.projectCreatedAt,
      eventType: 'project_created',
      evidenceClass: 'fact',
      sourceIdentity: input.projectId,
      title: 'Project created',
      summary: `${input.projectName} was added to project records. This establishes the start of the recorded project history.`,
      evidence: [evidence('project', input.projectId, 'Structured project creation record.')],
      navigationTarget: 'project_workspace',
      confidence: 'high',
      limitations: [],
    }));
  }

  for (const update of updates) {
    const timestamp = updateTimestamp(update);
    if (!validTimestamp(timestamp)) continue;
    events.push(event({
      projectId: input.projectId,
      timestamp,
      eventType: 'update_recorded',
      evidenceClass: 'fact',
      sourceIdentity: update.id,
      title: 'Project update recorded',
      summary: 'A structured project update was recorded. It matters because later observations and actions can be traced to this record.',
      evidence: [evidence('update', update.id, 'Structured project update record.')],
      navigationTarget: 'update_detail',
      confidence: 'high',
      limitations: ['The update record does not by itself verify project progress.'],
    }));

    if (update.safetyFlag || update.quickContext === 'Safety') {
      stateMarkers.push(marker('Blocked', timestamp, evidence('update', update.id,
        'Project update is recorded with a safety flag.'), 'update_detail'));
    } else if (update.blockerFlag || update.quickContext === 'Blocker') {
      stateMarkers.push(marker('Blocked', timestamp, evidence('update', update.id,
        'Project update is recorded as a blocker.'), 'update_detail'));
    }

    for (const photo of update.photos) {
      buildPhotoEvents(input.projectId, update, photo).forEach(item => events.push(item));
      const photoTimestamp = validTimestamp(photo.locationCapturedAt) ? photo.locationCapturedAt! : timestamp;
      if (photo.category === 'Safety Concern') {
        const resolved = photo.actionStatus === 'Closed';
        events.push(event({
          projectId: input.projectId,
          timestamp: photoTimestamp,
          eventType: resolved ? 'safety_issue_resolved' : 'safety_issue_opened',
          evidenceClass: 'fact',
          sourceIdentity: `${update.id}:${photo.id}`,
          title: resolved ? 'Safety issue recorded as resolved' : 'Safety issue opened',
          summary: resolved
            ? 'A safety concern is recorded with Closed status. This matters because the project record no longer marks this item open.'
            : 'A photo is categorized as an open Safety Concern. This matters because safety evidence takes priority over routine work.',
          evidence: [evidence('issue', update.id,
            `Photo ${photo.id} is categorized as Safety Concern with status ${photo.actionStatus || 'Open'}.`)],
          navigationTarget: 'update_detail',
          confidence: 'high',
          limitations: resolved
            ? ['Closed is a recorded status and is not independent proof that the condition was corrected.']
            : [],
        }));
        if (!resolved) {
          stateMarkers.push(marker('Blocked', photoTimestamp, evidence('issue', update.id,
            `Photo ${photo.id} records an open safety concern.`), 'update_detail'));
        }
      }

      if (photo.actionStatus === 'Waiting') {
        events.push(event({
          projectId: input.projectId,
          timestamp: photoTimestamp,
          eventType: 'waiting_dependency_recorded',
          evidenceClass: 'fact',
          sourceIdentity: `${update.id}:${photo.id}`,
          title: 'Waiting dependency recorded',
          summary: 'A project action is recorded with Waiting status. This matters because a dependency may need confirmation before the action can move.',
          evidence: [evidence('issue', update.id, `Photo ${photo.id} action status is Waiting.`)],
          navigationTarget: 'update_detail',
          confidence: 'high',
          limitations: ['Waiting status does not establish the cause or duration of the dependency.'],
        }));
        stateMarkers.push(marker('Waiting', photoTimestamp, evidence('issue', update.id,
          `Photo ${photo.id} action status is Waiting.`), 'update_detail'));
      }

      if (hasActionRecord(photo) && !isCommitmentRecord(photo)) {
        events.push(actionEvent(input.projectId, update, photo, photoTimestamp));
      }
    }
  }

  for (const document of documents) {
    const timestamp = document.importedAt || document.createdAt;
    if (!validTimestamp(timestamp) || document.status === 'failed') continue;
    events.push(event({
      projectId: input.projectId,
      timestamp,
      eventType: 'document_added',
      evidenceClass: 'fact',
      sourceIdentity: document.id,
      title: 'Document added',
      summary: `${document.category || 'Project'} document “${document.name}” was recorded. It matters because it adds structured project context.`,
      evidence: [evidence('document', document.id, 'Structured project document record.')],
      navigationTarget: 'project_documents',
      confidence: 'high',
      limitations: ['Document presence does not verify that its contents are current or approved.'],
    }));
  }

  for (const memory of captureMemories) {
    events.push(captureMemoryEvent(input.projectId, memory));
  }

  for (const commitment of input.commitments) {
    const memory = commitment.sourceMemoryId ? memoryById.get(commitment.sourceMemoryId) : undefined;
    const source = photoById.get(commitment.sourcePhotoId);
    if (!memory && source && !isCommitmentRecord(source.photo)) continue;
    const update = updateById.get(commitment.sourceUpdateId) || source?.update;
    const createdAt = memory?.confirmedAt || (update ? updateTimestamp(update) : null);
    if (!validTimestamp(createdAt)) continue;
    const citations = commitmentEvidence(commitment);
    events.push(event({
      projectId: input.projectId,
      timestamp: createdAt,
      eventType: 'commitment_created',
      evidenceClass: 'fact',
      sourceIdentity: commitment.id,
      title: 'Commitment created',
      summary: `${commitment.description} was recorded for ${commitment.owner}${commitment.dueDate ? `, due ${commitment.dueDate}` : ''}. It matters because the owner and follow-up can be tracked.`,
      evidence: citations,
      navigationTarget: memory ? 'project_workspace' : 'update_detail',
      confidence: 'high',
      limitations: ['A recorded commitment is not proof that the underlying work occurred.'],
    }));

    if (commitment.status === 'Completed') {
      events.push(event({
        projectId: input.projectId,
        timestamp: createdAt,
        eventType: 'commitment_completed',
        evidenceClass: 'fact',
        sourceIdentity: commitment.id,
        title: 'Commitment recorded as completed',
        summary: `${commitment.description} is recorded with Closed status. It matters because the commitment no longer appears open.`,
        evidence: citations,
        navigationTarget: memory ? 'project_workspace' : 'update_detail',
        confidence: 'high',
        limitations: ['Closed is a structured status, not independent proof that work was completed.'],
      }));
    } else if (commitment.status === 'Overdue' && commitment.dueDate) {
      const overdueAt = dateTimestamp(commitment.dueDate);
      if (overdueAt) {
        events.push(event({
          projectId: input.projectId,
          timestamp: overdueAt,
          eventType: 'commitment_overdue',
          evidenceClass: 'fact',
          sourceIdentity: commitment.id,
          title: 'Commitment became overdue',
          summary: `${commitment.description} passed its recorded due date and remains open. It matters because the current status needs confirmation.`,
          evidence: citations,
          navigationTarget: memory ? 'project_workspace' : 'update_detail',
          confidence: 'high',
          limitations: ['An open status does not prove that the underlying work is incomplete.'],
        }));
        stateMarkers.push(marker(
          'At Risk',
          overdueAt,
          citations[0],
          memory ? 'project_workspace' : 'update_detail',
        ));
      }
    }
  }

  for (const item of scheduleItems) {
    const timestamp = item.importedAt || item.createdAt;
    if (item.status === 'Waiting' && validTimestamp(timestamp)) {
      events.push(event({
        projectId: input.projectId,
        timestamp,
        eventType: 'waiting_dependency_recorded',
        evidenceClass: 'fact',
        sourceIdentity: item.id,
        title: 'Waiting dependency recorded',
        summary: `${item.taskName} is recorded as Waiting. It matters because the dependency and owner may need confirmation.`,
        evidence: [evidence('schedule', item.id, 'Structured schedule item with Waiting status.')],
        navigationTarget: 'schedule',
        confidence: 'high',
        limitations: ['Waiting status does not establish whether project work is delayed.'],
      }));
      stateMarkers.push(marker('Waiting', timestamp, evidence('schedule', item.id,
        'Structured schedule item with Waiting status.'), 'schedule'));
    }
    const scheduleComplete = scheduleProgressIsComplete(
      reconcileScheduleProgress(item.status, item.percentComplete),
    );
    if (scheduleComplete && item.milestone && validTimestamp(item.finishDate || timestamp)) {
      events.push(event({
        projectId: input.projectId,
        timestamp: validTimestamp(item.finishDate) ? dateTimestamp(item.finishDate!)! : timestamp,
        eventType: 'schedule_milestone_reached',
        evidenceClass: 'fact',
        sourceIdentity: item.id,
        title: 'Schedule milestone recorded as reached',
        summary: `${item.milestone} is recorded as Complete in the schedule. It matters because the structured schedule now marks this milestone closed.`,
        evidence: [evidence('schedule', item.id, 'Structured schedule milestone with Complete status.')],
        navigationTarget: 'schedule',
        confidence: 'high',
        limitations: ['Schedule status is not independent field verification of completion.'],
      }));
    }
  }

  buildStateTransitionEvents(input.projectId, stateMarkers, input.reality.confidence).forEach(item => events.push(item));
  const recommendationEvent = buildRecommendationEvent(input, events);
  if (recommendationEvent) events.push(recommendationEvent);

  return uniqueEvents(events).sort(compareEvents);
}

function buildPhotoEvents(
  projectId: string,
  update: DAVEDailyBriefUpdate,
  photo: DAVEDailyBriefPhoto,
): DAVEProjectTimelineEvent[] {
  const result = photo.photoIntelligence;
  if (!result) return [];
  const timestamp = validTimestamp(result.updatedAt)
    ? result.updatedAt!
    : validTimestamp(photo.locationCapturedAt)
      ? photo.locationCapturedAt!
      : updateTimestamp(update);
  if (!validTimestamp(timestamp)) return [];
  if (result.status === 'no_suitable_prior_photo') {
    return [event({
      projectId,
      timestamp,
      eventType: 'baseline_established',
      evidenceClass: 'fact',
      sourceIdentity: `${update.id}:${photo.id}`,
      title: 'Photo baseline established',
      summary: 'A photo was recorded without a suitable prior comparison. It matters because it can support a future comparison, but it is not a visual change.',
      evidence: [evidence('photo', update.id, `Photo ${photo.id} is recorded as the comparison baseline.`)],
      navigationTarget: 'update_detail',
      confidence: 'high',
      limitations: ['Baseline evidence is informational and does not establish project progress.'],
    })];
  }
  if (!isCompletedComparison(result.status) || !(result.priorEvidenceId || result.priorUpdateUsed)) return [];
  return observationDescriptions(result).map((description, index) => event({
    projectId,
    timestamp,
    eventType: 'qualified_photo_observation',
    evidenceClass: 'fact',
    sourceIdentity: `${update.id}:${photo.id}:${index}`,
    title: 'Qualified photo observation',
    summary: `${description} This matters because it records a visible difference between qualified project photos.`,
    evidence: [
      evidence('photo', update.id, `Current photo ${photo.id} in a completed comparison.`),
      evidence('photo', result.priorEvidenceId || result.priorUpdateUsed!, 'Recorded prior evidence used for comparison.'),
    ],
    navigationTarget: 'update_detail',
    confidence: normalizedConfidence(result.comparisonConfidence),
    limitations: cleanStrings(result.captureLimitations).concat('Visual change is not verified project progress.'),
  }));
}

function actionEvent(
  projectId: string,
  update: DAVEDailyBriefUpdate,
  photo: DAVEDailyBriefPhoto,
  timestamp: string,
): DAVEProjectTimelineEvent {
  const completed = photo.actionStatus === 'Closed';
  return event({
    projectId,
    timestamp,
    eventType: completed ? 'action_completed' : 'action_created',
    evidenceClass: 'fact',
    sourceIdentity: `${update.id}:${photo.id}`,
    title: completed ? 'Action recorded as completed' : 'Action created',
    summary: completed
      ? `${photo.actionRequired} is recorded with Closed status. It matters because the action no longer appears open.`
      : `${photo.actionRequired} was recorded as an action. It matters because the follow-up can now be reviewed.`,
    evidence: [evidence('issue', update.id, `Photo ${photo.id} contains the structured action record.`)],
    navigationTarget: 'update_detail',
    confidence: 'high',
    limitations: completed ? ['Closed status is not independent proof that work was completed.'] : [],
  });
}

function buildStateTransitionEvents(
  projectId: string,
  markers: StateMarker[],
  confidence: DAVEProjectRealityConfidence,
): DAVEProjectTimelineEvent[] {
  const strongestByTimestamp = new Map<string, StateMarker>();
  for (const item of markers.filter(value => validTimestamp(value.timestamp))) {
    const existing = strongestByTimestamp.get(item.timestamp);
    if (!existing || stateOrder(item.state) < stateOrder(existing.state)) {
      strongestByTimestamp.set(item.timestamp, item);
    }
  }
  const ordered = [...strongestByTimestamp.values()].sort((a, b) =>
    timestampMs(a.timestamp) - timestampMs(b.timestamp) || stateOrder(a.state) - stateOrder(b.state));
  const events: DAVEProjectTimelineEvent[] = [];
  let previous: StateMarker | null = null;
  for (const current of ordered) {
    if (!previous) {
      previous = current;
      continue;
    }
    if (current.state === previous.state) continue;
    events.push(event({
      projectId,
      timestamp: current.timestamp,
      eventType: 'project_state_changed',
      evidenceClass: 'interpretation',
      sourceIdentity: `${previous.state}:${current.state}:${current.evidence.recordId}`,
      title: `Project state interpreted as ${current.state}`,
      summary: `Structured evidence changed the qualified project-state interpretation from ${previous.state} to ${current.state}. This matters because guidance should follow the strongest current evidence.`,
      evidence: [previous.evidence, current.evidence],
      navigationTarget: current.navigationTarget,
      confidence,
      limitations: ['Project state is a qualified interpretation, not a claim of verified progress.'],
    }));
    previous = current;
  }
  return events;
}

function stateOrder(state: DAVEProjectRealityState): number {
  if (state === 'Blocked') return 0;
  if (state === 'Waiting') return 1;
  if (state === 'At Risk') return 2;
  return 3;
}

function buildRecommendationEvent(
  input: BuildProjectTimelineInput,
  sourceEvents: DAVEProjectTimelineEvent[],
): DAVEProjectTimelineEvent | null {
  const recommendation = input.reality.topRecommendation;
  if (!recommendation || recommendation.supportingEvidence.length === 0) return null;
  const sourceTimestamp = newestEvidenceTimestamp(recommendation.supportingEvidence, sourceEvents) || input.reality.lastVerifiedAt;
  if (!validTimestamp(sourceTimestamp)) return null;
  return event({
    projectId: input.projectId,
    timestamp: sourceTimestamp,
    eventType: 'recommendation_generated',
    evidenceClass: 'recommendation',
    sourceIdentity: recommendation.sourceRecordId,
    title: 'Recommendation generated',
    summary: `${recommendation.action} Reason: ${recommendation.reason}`,
    evidence: recommendation.supportingEvidence,
    navigationTarget: recommendation.navigationTarget,
    confidence: input.reality.confidence,
    limitations: recommendation.limitations,
  });
}

function captureMemoryEvent(
  projectId: string,
  memory: DAVEConfirmedCaptureMemory,
): DAVEProjectTimelineEvent {
  const remembered = [
    memory.fields.commitment,
    memory.fields.decision,
    memory.fields.ownerRequest,
    memory.fields.inspectionChange,
    memory.fields.scheduleChange,
    memory.fields.issue,
    memory.fields.risk,
    memory.fields.followUp,
    memory.fields.generalMemory,
  ].find(value => Boolean(value?.trim()));
  const location = memory.recommendedLocation.value
    ? ` Location: ${memory.recommendedLocation.value}.`
    : '';
  return event({
    projectId,
    timestamp: memory.confirmedAt,
    eventType: 'memory_confirmed',
    evidenceClass: 'fact',
    sourceIdentity: memory.id,
    title: 'Project memory confirmed',
    summary: `${remembered || 'A project memory was confirmed by the PM.'}${location} It matters because the record can support later follow-up without treating the conversation as proof that work occurred.`,
    evidence: [
      evidence('memory', memory.id, 'PM-confirmed project memory.'),
      evidence('transcript', memory.transcriptEvidenceId, 'Source transcript linked to the confirmed memory.'),
    ],
    navigationTarget: 'project_workspace',
    confidence: memory.recommendedProject.confidence === 'unknown'
      ? 'low'
      : memory.recommendedProject.confidence,
    limitations: ['The transcript records what was said; it does not independently verify that work occurred.'],
  });
}

function newestEvidenceTimestamp(
  citations: DAVEProjectRealityEvidence[],
  events: DAVEProjectTimelineEvent[],
): string | null {
  const recordIds = new Set(citations.map(item => item.recordId));
  return events
    .filter(item => item.evidence.some(citation => recordIds.has(citation.recordId)))
    .sort(compareEvents)[0]?.timestamp || null;
}

function event(input: Omit<DAVEProjectTimelineEvent, 'id'> & { sourceIdentity: string }): DAVEProjectTimelineEvent {
  const { sourceIdentity, ...value } = input;
  return {
    id: ['timeline', input.projectId, input.eventType, sourceIdentity]
      .map(part => encodeURIComponent(part.trim() || 'unknown'))
      .join(':'),
    ...value,
  };
}

function evidence(sourceType: DAVEBriefSourceType, recordId: string, summary: string): DAVEProjectRealityEvidence {
  return { sourceType, recordId, summary };
}

function marker(
  state: DAVEProjectRealityState,
  timestamp: string,
  citation: DAVEProjectRealityEvidence,
  navigationTarget: DAVEBriefNavigationTarget,
): StateMarker {
  return { state, timestamp, evidence: citation, navigationTarget };
}

function commitmentEvidence(commitment: DAVEProjectCommitment): DAVEProjectRealityEvidence[] {
  return commitment.linkedEvidence.map(item => evidence(
    item.type,
    item.recordId,
    `${item.type} record linked to ${commitment.description}.`,
  ));
}

function observationDescriptions(result: NonNullable<DAVEDailyBriefPhoto['photoIntelligence']>): string[] {
  const structured = Array.isArray(result.findings)
    ? result.findings.map(item => safeObservation(item.description)).filter((item): item is string => Boolean(item))
    : [];
  if (structured.length > 0) return uniqueStrings(structured);
  return uniqueStrings([
    ...cleanStrings(result.additions),
    ...cleanStrings(result.removals),
    safeObservation(result.visibleChange),
    safeObservation(result.currentObservation),
  ].filter((item): item is string => Boolean(item)));
}

function safeObservation(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/baseline|no prior photo|future comparison/i.test(text)) return null;
  if (/work progressed|progress increased|progressed significantly|percent complete|work completed|fully complete/i.test(text)) return null;
  return text;
}

function hasActionRecord(photo: DAVEDailyBriefPhoto): boolean {
  return Boolean(photo.actionRequired?.trim());
}

function isCommitmentRecord(photo: DAVEDailyBriefPhoto): boolean {
  return Boolean(photo.actionOwner?.trim() || photo.actionDueDate?.trim());
}

function isCompletedComparison(status: string): boolean {
  return status === 'analysis_complete' || status === 'completed_with_limitations';
}

function normalizedConfidence(value: string | null | undefined): DAVEProjectRealityConfidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function updateTimestamp(update: DAVEDailyBriefUpdate): string {
  return update.workflowTimestamps?.sendResolvedAt ||
    update.workflowTimestamps?.sendTappedAt ||
    update.workflowTimestamps?.firstPhotoAddedAt ||
    update.date;
}

function dateTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = `${value}T23:59:59.999Z`;
  return validTimestamp(timestamp) ? timestamp : null;
}

function validTimestamp(value: string | null | undefined): value is string {
  if (!value) return false;
  return Number.isFinite(new Date(value).getTime());
}

function timestampMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareEvents(a: DAVEProjectTimelineEvent, b: DAVEProjectTimelineEvent): number {
  return timestampMs(b.timestamp) - timestampMs(a.timestamp) ||
    EVENT_ORDER[a.eventType] - EVENT_ORDER[b.eventType] ||
    a.eventType.localeCompare(b.eventType) ||
    a.id.localeCompare(b.id);
}

function uniqueEvents(events: DAVEProjectTimelineEvent[]): DAVEProjectTimelineEvent[] {
  const seen = new Set<string>();
  return events.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function projectMatches(value: string | null, projectId: string, projectName: string): boolean {
  const selected = normalizeKey(value ?? '');
  return selected === normalizeKey(projectId) || selected === normalizeKey(projectName);
}
