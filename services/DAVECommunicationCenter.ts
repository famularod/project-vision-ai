import type { DAVEBriefSourceType } from './DAVEDailyBrief';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import type { DAVEProjectTimelineEvent } from './DAVEProjectTimeline';

export type DAVECommunicationDraftType =
  | 'owner_update'
  | 'customer_update'
  | 'contractor_follow_up'
  | 'internal_team_update'
  | 'weekly_summary'
  | 'inspection_readiness';

export type DAVECommunicationStatementClass =
  | 'fact'
  | 'observation'
  | 'interpretation'
  | 'recommendation';

export type DAVECommunicationEvidence = {
  id: string;
  sourceType: DAVEBriefSourceType;
  recordId: string;
  summary: string;
  timelineEventId: string | null;
};

export type DAVECommunicationStatement = {
  id: string;
  statementClass: DAVECommunicationStatementClass;
  text: string;
  evidenceIds: string[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
};

export type DAVECommunicationDraft = {
  id: string;
  draftType: DAVECommunicationDraftType;
  title: string;
  projectId: string;
  generatedAt: string;
  facts: DAVECommunicationStatement[];
  observations: DAVECommunicationStatement[];
  interpretations: DAVECommunicationStatement[];
  recommendations: DAVECommunicationStatement[];
  evidenceUsed: DAVECommunicationEvidence[];
  confidence: 'high' | 'medium' | 'low';
  knownLimitations: string[];
  reviewRequired: true;
};

export type DAVECommunicationCenter = {
  projectId: string;
  generatedAt: string;
  drafts: DAVECommunicationDraft[];
};

const DRAFT_TYPES: DAVECommunicationDraftType[] = [
  'owner_update',
  'customer_update',
  'contractor_follow_up',
  'internal_team_update',
  'weekly_summary',
  'inspection_readiness',
];

const DRAFT_TITLES: Record<DAVECommunicationDraftType, string> = {
  owner_update: 'Owner Update',
  customer_update: 'Customer Update',
  contractor_follow_up: 'Contractor Follow-up',
  internal_team_update: 'Internal Team Update',
  weekly_summary: 'Weekly Summary',
  inspection_readiness: 'Inspection Readiness',
};

export function buildDAVECommunicationCenter(
  intelligence: DAVEProjectIntelligence,
): DAVECommunicationCenter {
  return deepFreeze({
    projectId: intelligence.projectId,
    generatedAt: intelligence.generatedAt,
    drafts: DRAFT_TYPES.map(draftType => buildCommunicationDraft(intelligence, draftType)),
  });
}

export function buildCommunicationDraft(
  intelligence: DAVEProjectIntelligence,
  draftType: DAVECommunicationDraftType,
): DAVECommunicationDraft {
  const timeline = timelineForDraft(intelligence, draftType);
  const factEvents = timeline.filter(item =>
    item.evidenceClass === 'fact' && item.eventType !== 'qualified_photo_observation');
  const observationEvents = timeline.filter(item => item.eventType === 'qualified_photo_observation');
  const interpretationEvents = timeline.filter(item => item.evidenceClass === 'interpretation');
  const facts = factEvents.slice(0, factLimit(draftType)).map(item => statementFromTimeline(item, 'fact'));
  const observations = observationEvents.slice(0, observationLimit(draftType))
    .map(item => statementFromTimeline(item, 'observation'));
  const interpretations = interpretationEvents.slice(0, 2)
    .map(item => statementFromTimeline(item, 'interpretation'));
  const recommendations = recommendationStatements(intelligence);
  const allStatements = [...facts, ...observations, ...interpretations, ...recommendations];
  const evidenceUsed = collectEvidence(allStatements, timeline, intelligence);
  const knownLimitations = uniqueStrings([
    ...allStatements.flatMap(item => item.limitations),
    intelligence.evidenceQuality.limitation,
    ...draftSpecificLimitations(intelligence, draftType),
    'Review required: DAVE does not send communications or change project status.',
  ]);

  return deepFreeze({
    id: `communication:${encodeURIComponent(intelligence.projectId)}:${draftType}`,
    draftType,
    title: DRAFT_TITLES[draftType],
    projectId: intelligence.projectId,
    generatedAt: intelligence.generatedAt,
    facts,
    observations,
    interpretations,
    recommendations,
    evidenceUsed,
    confidence: intelligence.projectReality.confidence,
    knownLimitations,
    reviewRequired: true,
  });
}

function timelineForDraft(
  intelligence: DAVEProjectIntelligence,
  draftType: DAVECommunicationDraftType,
): DAVEProjectTimelineEvent[] {
  const events = intelligence.timeline;
  if (draftType === 'weekly_summary') {
    const cutoff = new Date(intelligence.generatedAt).getTime() - 7 * 24 * 60 * 60 * 1000;
    return events.filter(item => timestampMs(item.timestamp) >= cutoff);
  }
  if (draftType === 'contractor_follow_up') {
    return events.filter(item => [
      'commitment_created',
      'commitment_completed',
      'commitment_overdue',
      'action_created',
      'action_completed',
      'safety_issue_opened',
      'waiting_dependency_recorded',
      'qualified_photo_observation',
    ].includes(item.eventType));
  }
  if (draftType === 'inspection_readiness') {
    return events.filter(item =>
      item.eventType === 'qualified_photo_observation' ||
      item.eventType === 'document_added' ||
      item.eventType === 'commitment_created' ||
      item.eventType === 'commitment_completed' ||
      item.eventType === 'commitment_overdue' ||
      item.eventType === 'safety_issue_opened' ||
      item.eventType === 'safety_issue_resolved' ||
      item.eventType === 'schedule_milestone_reached' ||
      item.eventType === 'project_state_changed');
  }
  if (draftType === 'customer_update') {
    return events.filter(item =>
      item.eventType !== 'recommendation_generated' &&
      item.eventType !== 'project_state_changed');
  }
  return events.filter(item => item.eventType !== 'recommendation_generated');
}

function statementFromTimeline(
  timelineEvent: DAVEProjectTimelineEvent,
  statementClass: Exclude<DAVECommunicationStatementClass, 'recommendation'>,
): DAVECommunicationStatement {
  return {
    id: `communication-statement:${timelineEvent.id}:${statementClass}`,
    statementClass,
    text: timelineEvent.summary,
    evidenceIds: timelineEvent.evidence.map(item => evidenceId(item.sourceType, item.recordId)),
    confidence: timelineEvent.confidence,
    limitations: timelineEvent.limitations,
  };
}

function recommendationStatements(
  intelligence: DAVEProjectIntelligence,
): DAVECommunicationStatement[] {
  const action = intelligence.actionCenter;
  if (!action.recommendedAction || action.supportingEvidence.length === 0) return [];
  return [{
    id: `communication-statement:${encodeURIComponent(intelligence.projectId)}:recommendation`,
    statementClass: 'recommendation',
    text: `${action.recommendedAction} Reason: ${action.reason}`,
    evidenceIds: action.supportingEvidence.map(item => evidenceId(item.sourceType, item.recordId)),
    confidence: action.confidence || intelligence.projectReality.confidence,
    limitations: action.limitations,
  }];
}

function collectEvidence(
  statements: DAVECommunicationStatement[],
  timeline: DAVEProjectTimelineEvent[],
  intelligence: DAVEProjectIntelligence,
): DAVECommunicationEvidence[] {
  const requiredIds = new Set(statements.flatMap(item => item.evidenceIds));
  const timelineEvidence = timeline.flatMap(item => item.evidence.map(citation => ({
    id: evidenceId(citation.sourceType, citation.recordId),
    sourceType: citation.sourceType,
    recordId: citation.recordId,
    summary: citation.summary,
    timelineEventId: item.id,
  })));
  const actionEvidence = intelligence.actionCenter.supportingEvidence.map(item => ({
    id: evidenceId(item.sourceType, item.recordId),
    sourceType: item.sourceType,
    recordId: item.recordId,
    summary: item.summary,
    timelineEventId: item.timelineEventId || null,
  }));
  const seen = new Set<string>();
  return [...timelineEvidence, ...actionEvidence].filter(item => {
    if (!requiredIds.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function draftSpecificLimitations(
  intelligence: DAVEProjectIntelligence,
  draftType: DAVECommunicationDraftType,
): string[] {
  const limitations: string[] = [];
  if (intelligence.projectReality.confidence === 'low') {
    limitations.push('Project evidence is weak; verify each statement before using this draft.');
  }
  if (draftType === 'inspection_readiness') {
    const inspectionSignal = intelligence.evidenceQuality.signals.find(item => item.key === 'inspection_status');
    if (inspectionSignal?.quality !== 'strong') {
      limitations.push(inspectionSignal?.whyItMatters ||
        'Current records do not establish inspection status.');
    }
  }
  if (draftType === 'weekly_summary' && timelineForDraft(intelligence, draftType).length === 0) {
    limitations.push('No evidence-backed timeline events were recorded in the last seven days.');
  }
  return limitations;
}

function factLimit(draftType: DAVECommunicationDraftType): number {
  if (draftType === 'customer_update') return 3;
  if (draftType === 'contractor_follow_up') return 4;
  return 5;
}

function observationLimit(draftType: DAVECommunicationDraftType): number {
  return draftType === 'customer_update' ? 2 : 3;
}

function evidenceId(sourceType: DAVEBriefSourceType, recordId: string): string {
  return `evidence:${sourceType}:${encodeURIComponent(recordId)}`;
}

function timestampMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
