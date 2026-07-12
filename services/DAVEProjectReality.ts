import { buildProjectCommitments, type DAVEProjectCommitment } from './DAVEProjectCommitments';
import {
  buildProjectEvidenceQuality,
  type DAVEProjectEvidenceQuality,
} from './DAVEProjectEvidenceQuality';
import type {
  DAVEBriefNavigationTarget,
  DAVEBriefSourceType,
  DAVEDailyBriefDocument,
  DAVEDailyBriefScheduleItem,
  DAVEDailyBriefUpdate,
} from './DAVEDailyBrief';
import { buildProjectTimeline, type DAVEProjectTimelineEvent } from './DAVEProjectTimeline';

export type DAVEProjectRealityState = 'Moving' | 'Waiting' | 'At Risk' | 'Blocked';
export type DAVEProjectRealityConfidence = 'high' | 'medium' | 'low';

export type DAVEProjectRealityEvidence = {
  sourceType: DAVEBriefSourceType;
  recordId: string;
  summary: string;
};

export type DAVEProjectRealityItem = {
  id: string;
  category: string;
  text: string;
  sourceType: DAVEBriefSourceType;
  sourceRecordId: string;
  evidenceClass: 'fact' | 'uncertainty';
};

export type DAVEProjectRealityRecommendation = {
  action: string;
  reason: string;
  navigationTarget: DAVEBriefNavigationTarget;
  sourceRecordId: string;
  supportingEvidence: DAVEProjectRealityEvidence[];
  limitations: string[];
};

export type DAVEProjectReality = {
  projectId: string;
  generatedAt: string;
  state: DAVEProjectRealityState;
  confidence: DAVEProjectRealityConfidence;
  lastVerifiedAt: string | null;
  blockers: DAVEProjectRealityItem[];
  commitments: DAVEProjectCommitment[];
  openCommitments: DAVEProjectCommitment[];
  uncertainties: DAVEProjectRealityItem[];
  evidenceSummary: DAVEProjectEvidenceQuality;
  topRecommendation: DAVEProjectRealityRecommendation | null;
  supportingEvidence: DAVEProjectRealityEvidence[];
  timelineEvents: DAVEProjectTimelineEvent[];
  recentTimelineEvents: DAVEProjectTimelineEvent[];
};

export type DAVEProjectRealitySourceRecords = {
  projectName: string;
  projectCreatedAt: string | null;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
};

const sourceRecordsByReality = new WeakMap<DAVEProjectReality, DAVEProjectRealitySourceRecords>();

export function projectRealitySourceRecords(reality: DAVEProjectReality): DAVEProjectRealitySourceRecords {
  const records = sourceRecordsByReality.get(reality);
  if (!records) throw new Error('Project Reality source records are unavailable for this object.');
  return records;
}

export type BuildProjectRealityInput = {
  projectId: string;
  projectName: string;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
  projectCreatedAt?: string | null;
  now?: string;
};

export function buildProjectReality(input: BuildProjectRealityInput): DAVEProjectReality {
  const generatedAt = validDate(input.now)?.toISOString() || new Date().toISOString();
  const projectKey = normalizeKey(input.projectName);
  const updates = input.updates.filter(update => normalizeKey(update.projectName) === projectKey);
  const documents = input.documents.filter(document =>
    !document.isArchived && (!document.projectId || document.projectId === input.projectId),
  );
  const scheduleItems = input.scheduleItems.filter(item => normalizeKey(item.projectName) === projectKey);
  const commitments = buildProjectCommitments({
    projectId: input.projectId,
    projectName: input.projectName,
    updates,
    documents,
    now: input.now,
  });
  const evidenceQuality = buildProjectEvidenceQuality({
    projectId: input.projectId,
    projectName: input.projectName,
    updates,
    documents,
    scheduleItems,
    now: input.now,
  });
  const blockers = buildBlockers(updates);
  const openCommitments = commitments.filter(commitment => commitment.status !== 'Completed');
  const overdueCommitments = openCommitments.filter(commitment => commitment.status === 'Overdue');
  const waitingEvidence = buildWaitingEvidence(updates, scheduleItems);
  const uncertainties = buildUncertainties(input.projectId, updates, evidenceQuality);
  const state: DAVEProjectRealityState = blockers.length > 0
    ? 'Blocked'
    : waitingEvidence.length > 0
      ? 'Waiting'
      : overdueCommitments.length > 0 || evidenceQuality.strength === 'Low'
        ? 'At Risk'
        : 'Moving';
  const supportingEvidence = uniqueEvidence([
    ...blockers.map(itemEvidence),
    ...waitingEvidence.map(itemEvidence),
    ...overdueCommitments.flatMap(commitmentEvidence),
  ]);
  const topRecommendation = selectTopRecommendation(
    blockers,
    waitingEvidence,
    overdueCommitments,
    uncertainties,
  );

  const realityBase: Omit<DAVEProjectReality, 'timelineEvents' | 'recentTimelineEvents'> = {
    projectId: input.projectId,
    generatedAt,
    state,
    confidence: evidenceQuality.strength === 'High' ? 'high' : evidenceQuality.strength === 'Medium' ? 'medium' : 'low',
    lastVerifiedAt: latestVerifiedAt(updates, documents, scheduleItems),
    blockers,
    commitments,
    openCommitments,
    uncertainties,
    evidenceSummary: evidenceQuality,
    topRecommendation,
    supportingEvidence: uniqueEvidence([
      ...supportingEvidence,
      ...(topRecommendation?.supportingEvidence ?? []),
    ]),
  };
  const timelineEvents = buildProjectTimeline({
    projectId: input.projectId,
    projectName: input.projectName,
    projectCreatedAt: input.projectCreatedAt,
    updates,
    documents,
    scheduleItems,
    commitments,
    reality: realityBase,
    now: input.now,
  });
  const recentTimelineEvents = timelineEvents.slice(0, 10);
  const reality: DAVEProjectReality = { ...realityBase, timelineEvents, recentTimelineEvents };
  sourceRecordsByReality.set(reality, {
    projectName: input.projectName,
    projectCreatedAt: input.projectCreatedAt || null,
    updates,
    documents,
    scheduleItems,
  });

  return reality;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function buildBlockers(updates: DAVEDailyBriefUpdate[]): DAVEProjectRealityItem[] {
  const items: DAVEProjectRealityItem[] = [];
  for (const update of updates) {
    if (update.safetyFlag || update.quickContext === 'Safety') {
      items.push(realityItem(update.id, 'safety', 'A project update is recorded with a safety flag.', 'update'));
    }
    if (update.blockerFlag || update.quickContext === 'Blocker') {
      items.push(realityItem(update.id, 'confirmed_blocker', 'A project update is recorded as blocked.', 'update'));
    }
    for (const photo of update.photos) {
      if (photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed') {
        items.push(realityItem(update.id, 'safety', 'An open safety concern is recorded in project evidence.', 'issue', photo.id));
      }
    }
  }
  return uniqueItems(items);
}

function buildWaitingEvidence(
  updates: DAVEDailyBriefUpdate[],
  scheduleItems: DAVEDailyBriefScheduleItem[],
): DAVEProjectRealityItem[] {
  const items: DAVEProjectRealityItem[] = [];
  for (const update of updates) {
    for (const photo of update.photos) {
      if (photo.actionStatus === 'Waiting') {
        items.push(realityItem(update.id, 'external_dependency', 'A project action status is recorded as Waiting.', 'issue', photo.id));
      }
    }
  }
  for (const item of scheduleItems) {
    if (item.status === 'Waiting') {
      items.push(realityItem(item.id, 'external_dependency', `${item.taskName} is recorded as waiting.`, 'schedule'));
    }
  }
  return uniqueItems(items);
}

function buildUncertainties(
  projectId: string,
  updates: DAVEDailyBriefUpdate[],
  evidenceQuality: DAVEProjectEvidenceQuality,
): DAVEProjectRealityItem[] {
  const items: DAVEProjectRealityItem[] = [];
  for (const update of updates) {
    for (const photo of update.photos) {
      const status = photo.photoIntelligence?.status;
      if (status === 'analysis_failed_retry' || status === 'comparison_unavailable') {
        items.push(uncertaintyItem(update.id, 'analysis_unavailable', 'Photo analysis is unavailable; no visual conclusion was accepted.'));
      } else if (status === 'no_suitable_prior_photo') {
        items.push(uncertaintyItem(update.id, 'no_prior_photo', 'No prior photo is available for visual comparison.'));
      }
    }
  }
  if (evidenceQuality.strength === 'Low') {
    items.push(uncertaintyItem(projectId, 'weak_evidence',
      'Project evidence coverage is weak; this does not establish whether work is complete or delayed.'));
  }
  return uniqueItems(items);
}

function selectTopRecommendation(
  blockers: DAVEProjectRealityItem[],
  waiting: DAVEProjectRealityItem[],
  overdue: DAVEProjectCommitment[],
  uncertainties: DAVEProjectRealityItem[],
): DAVEProjectRealityRecommendation | null {
  const blocker = blockers[0];
  if (blocker) {
    return recommendation('Confirm the recorded safety or blocker status.', blocker.text, blocker.sourceRecordId,
      'update_detail', [itemEvidence(blocker)], ['Review only; DAVE does not change project status.']);
  }
  const dependency = waiting[0];
  if (dependency) {
    return recommendation('Confirm the dependency owner and next step.', dependency.text, dependency.sourceRecordId,
      dependency.sourceType === 'schedule' ? 'schedule' : 'update_detail', [itemEvidence(dependency)],
      ['Waiting is based on a recorded status and should be confirmed before communication.']);
  }
  const commitment = overdue[0];
  if (commitment) {
    return recommendation(commitment.recommendedFollowUpAction,
      `Commitment due ${commitment.dueDate} remains open.`, commitment.sourceUpdateId, 'update_detail',
      commitmentEvidence(commitment), ['The open status is not proof that the underlying work did not occur.']);
  }
  const uncertainty = uncertainties[0];
  if (uncertainty && uncertainty.category !== 'weak_evidence') {
    return recommendation('Review the unavailable evidence before relying on project status.', uncertainty.text,
      uncertainty.sourceRecordId, 'update_detail', [itemEvidence(uncertainty)],
      ['No project status change is recommended from unavailable evidence alone.']);
  }
  return null;
}

function recommendation(
  action: string,
  reason: string,
  sourceRecordId: string,
  navigationTarget: DAVEBriefNavigationTarget,
  supportingEvidence: DAVEProjectRealityEvidence[],
  limitations: string[],
): DAVEProjectRealityRecommendation {
  return {
    action,
    reason,
    sourceRecordId,
    navigationTarget,
    supportingEvidence,
    limitations: [...new Set([
      ...limitations,
      'Review only; DAVE does not send messages or change project status.',
    ])],
  };
}

function realityItem(
  sourceRecordId: string,
  category: string,
  text: string,
  sourceType: DAVEBriefSourceType,
  identitySuffix = category,
): DAVEProjectRealityItem {
  return {
    id: `reality:${encodeURIComponent(sourceRecordId)}:${encodeURIComponent(identitySuffix)}`,
    category,
    text,
    sourceType,
    sourceRecordId,
    evidenceClass: 'fact',
  };
}

function uncertaintyItem(sourceRecordId: string, category: string, text: string): DAVEProjectRealityItem {
  return { ...realityItem(sourceRecordId, category, text, 'project'), evidenceClass: 'uncertainty' };
}

function itemEvidence(item: DAVEProjectRealityItem): DAVEProjectRealityEvidence {
  return { sourceType: item.sourceType, recordId: item.sourceRecordId, summary: item.text };
}

function commitmentEvidence(commitment: DAVEProjectCommitment): DAVEProjectRealityEvidence[] {
  return commitment.linkedEvidence.map(item => ({
    sourceType: item.type,
    recordId: item.recordId,
    summary: `${item.type} record linked to ${commitment.description}.`,
  }));
}

function latestVerifiedAt(
  updates: DAVEDailyBriefUpdate[],
  documents: DAVEDailyBriefDocument[],
  scheduleItems: DAVEDailyBriefScheduleItem[],
): string | null {
  const values = [
    ...updates.map(update => update.workflowTimestamps?.sendResolvedAt || update.workflowTimestamps?.sendTappedAt || update.date),
    ...documents.map(document => document.updatedAt || document.importedAt || document.createdAt),
    ...scheduleItems.map(item => item.importedAt || item.createdAt),
  ].filter((value): value is string => Boolean(value));
  return values.sort((a, b) => timestampMs(b) - timestampMs(a))[0] || null;
}

function timestampMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueItems(items: DAVEProjectRealityItem[]): DAVEProjectRealityItem[] {
  const seen = new Set<string>();
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function uniqueEvidence(items: DAVEProjectRealityEvidence[]): DAVEProjectRealityEvidence[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.sourceType}:${item.recordId}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
