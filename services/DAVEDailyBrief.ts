import {
  buildStableAttentionItemId,
  dedupeAttentionItemsById,
  type PIEAttentionCategory,
  type PIEAttentionItemType,
} from './PIEAttentionIdentity';
import { type DAVEProjectCommitment } from './DAVEProjectCommitments';
import {
  buildProjectReality,
  projectRealitySourceRecords,
  type DAVEProjectReality,
  type DAVEProjectRealityState,
} from './DAVEProjectReality';
import type { DAVEProjectTimelineEvent } from './DAVEProjectTimeline';
import type { ProjectTimeZone } from './ProjectDateTime';

export type DAVEEvidenceClass = 'fact' | 'observation' | 'uncertainty';
export type DAVEBriefSourceType =
  | 'update'
  | 'photo'
  | 'issue'
  | 'document'
  | 'schedule'
  | 'project'
  | 'memory'
  | 'transcript';
export type DAVEBriefNavigationTarget =
  | 'update_detail'
  | 'project_documents'
  | 'schedule'
  | 'capture'
  | 'project_workspace';
export type DAVERecommendationActionType = 'Confirm' | 'Capture' | 'Correct' | 'Approve' | 'Communicate';

export type DAVEProjectDailyBriefItem = {
  id: string;
  evidenceClass: DAVEEvidenceClass;
  category: string;
  text: string;
  sourceType: DAVEBriefSourceType;
  sourceRecordId: string;
  timestamp: string | null;
  confidence: string | null;
  navigationTarget: DAVEBriefNavigationTarget;
  limitations: string[];
};

export type DAVEProjectDailyBriefAttentionItem = DAVEProjectDailyBriefItem & {
  priority: number;
  whyItMatters: string;
  evidence: string;
  actionText: string;
};

export type DAVEProjectDailyBriefRecommendation = {
  id: string;
  evidenceClass: 'recommendation';
  actionType: DAVERecommendationActionType;
  text: string;
  reason: string;
  sourceType: DAVEBriefSourceType;
  sourceRecordId: string;
  navigationTarget: DAVEBriefNavigationTarget;
  confidence: string | null;
  limitations: string[];
};

export type DAVEProjectDailyBrief = {
  projectId: string;
  realityState: DAVEProjectRealityState;
  reality: DAVEProjectReality;
  generatedAt: string;
  changedItems: DAVEProjectDailyBriefItem[];
  uncertaintyItems: DAVEProjectDailyBriefItem[];
  attentionItems: DAVEProjectDailyBriefAttentionItem[];
  recommendedAction: DAVEProjectDailyBriefRecommendation | null;
  evidenceSummary: {
    latestUpdateAt: string | null;
    photoFindingCount: number;
    openIssueCount: number;
    failedAnalysisCount: number;
    staleEvidenceCount: number;
    overdueCommitmentCount: number;
  };
  emptyStates: {
    changed: string;
    uncertainty: string;
    attention: string;
    recommendation: string;
  };
};

export type DAVEDailyBriefPhotoFinding = {
  findingType?: string;
  description?: string;
  confidence?: number | null;
  limitations?: string[];
};

export type DAVEDailyBriefPhotoResult = {
  status: string;
  visibleChange?: string | null;
  currentObservation?: string | null;
  additions?: string[];
  removals?: string[];
  findings?: DAVEDailyBriefPhotoFinding[];
  comparisonConfidence?: string | null;
  comparability?: string | null;
  captureLimitations?: string[];
  priorUpdateUsed?: string | null;
  priorEvidenceId?: string | null;
  updatedAt?: string | null;
};

export type DAVEDailyBriefPhoto = {
  id: string;
  category: 'Open Issue' | 'Safety Concern' | 'Update' | string;
  actionRequired?: string;
  actionOwner?: string;
  actionDueDate?: string;
  actionStatus?: 'Open' | 'In Progress' | 'Waiting' | 'Closed' | string;
  selectedAreaName?: string | null;
  locationCapturedAt?: string | null;
  photoIntelligence?: DAVEDailyBriefPhotoResult | null;
};

export type DAVEDailyBriefUpdate = {
  id: string;
  projectName: string;
  date: string;
  notes?: string;
  photos: DAVEDailyBriefPhoto[];
  selectedAreaName?: string | null;
  quickContext?: string | null;
  safetyFlag?: boolean;
  blockerFlag?: boolean;
  status?: string;
  workflowTimestamps?: {
    firstPhotoAddedAt?: string;
    sendTappedAt?: string;
    sendResolvedAt?: string;
  };
};

export type DAVEDailyBriefDocument = {
  id: string;
  projectId?: string;
  updateId?: string | null;
  name: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  importedAt?: string;
  isArchived?: boolean;
};

export type DAVEDailyBriefScheduleItem = {
  id: string;
  scheduleProjectName?: string | null;
  projectTimeZone?: string | null;
  projectName: string;
  locationName?: string;
  taskName: string;
  startDate?: string;
  milestone?: string;
  status: string;
  priority?: string;
  finishDate?: string;
  owner?: string;
  contractor?: string;
  durationDays?: number | null;
  percentComplete?: number;
  notes?: string;
  createdAt: string;
  importedAt?: string | null;
};

export type BuildProjectDailyBriefInput = {
  projectId: string;
  projectName: string;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
  now?: string;
  projectTimeZone?: ProjectTimeZone | string;
  staleAfterDays?: number;
};

export type BuildProjectDailyBriefFromRealityInput = {
  reality: DAVEProjectReality;
  timeline: DAVEProjectTimelineEvent[];
  staleAfterDays?: number;
};

const MAX_ITEMS = 3;
const DEFAULT_STALE_DAYS = 14;
const EMPTY_STATES = {
  changed: 'No verified project changes since the last update.',
  uncertainty: 'No major evidence gaps detected.',
  attention: 'No immediate attention items.',
  recommendation: 'No action recommended until more evidence is available.',
};

export function buildProjectDailyBrief(
  input: BuildProjectDailyBriefInput | BuildProjectDailyBriefFromRealityInput,
): DAVEProjectDailyBrief {
  if ('reality' in input) {
    if (input.timeline !== input.reality.timelineEvents) {
      throw new Error('Daily Brief must consume the canonical Project Reality timeline.');
    }
    return buildProjectDailyBriefModel(input.reality, input.staleAfterDays);
  }
  const now = validDate(input.now) ?? new Date();
  const reality = buildProjectReality({
    projectId: input.projectId,
    projectName: input.projectName,
    updates: input.updates,
    documents: input.documents,
    scheduleItems: input.scheduleItems,
    now: now.toISOString(),
    projectTimeZone: input.projectTimeZone,
  });
  return buildProjectDailyBriefModel(reality, input.staleAfterDays);
}

function buildProjectDailyBriefModel(
  reality: DAVEProjectReality,
  staleAfterDays: number | undefined,
): DAVEProjectDailyBrief {
  const now = validDate(reality.generatedAt) ?? new Date();
  const records = projectRealitySourceRecords(reality);
  const updates = records.updates
    .filter(update => normalizedKey(update.projectName) === normalizedKey(records.projectName))
    .sort((a, b) => timestampMs(updateTimestamp(b)) - timestampMs(updateTimestamp(a)));
  const documents = records.documents.filter(document => !document.isArchived);
  const staleCutoff = now.getTime() - (staleAfterDays ?? DEFAULT_STALE_DAYS) * 24 * 60 * 60 * 1000;
  const commitments = reality.openCommitments;

  const changedCandidates = buildChangedItems(updates, documents, staleCutoff);
  const uncertaintyCandidates = buildUncertaintyItems(reality.projectId, updates, staleCutoff);
  const attentionCandidates = buildAttentionItems(updates, commitments, staleCutoff);
  const changedItems = uniqueById(changedCandidates)
    .sort((a, b) => evidencePriority(a) - evidencePriority(b) || newestFirst(a, b))
    .slice(0, MAX_ITEMS);
  const uncertaintyItems = uniqueById(uncertaintyCandidates)
    .sort((a, b) => uncertaintyPriority(a) - uncertaintyPriority(b) || newestFirst(a, b))
    .slice(0, MAX_ITEMS);
  const attentionItems = dedupeAttentionItemsById(attentionCandidates)
    .sort((a, b) => a.priority - b.priority || newestFirst(a, b))
    .slice(0, MAX_ITEMS);
  const latestUpdateAt = updates[0] ? updateTimestamp(updates[0]) : null;
  const photoFindingCount = changedCandidates.filter(item => item.sourceType === 'photo').length;
  const openIssueCount = updates.reduce(
    (count, update) => count + update.photos.filter(photo => isOpenIssue(photo)).length,
    0,
  );
  const failedAnalysisCount = updates.reduce(
    (count, update) => count + update.photos.filter(photo => isFailedAnalysis(photo.photoIntelligence)).length,
    0,
  );
  const staleEvidenceCount = updates.filter(update => timestampMs(updateTimestamp(update)) < staleCutoff).length;

  return {
    projectId: reality.projectId,
    realityState: reality.state,
    reality,
    generatedAt: now.toISOString(),
    changedItems,
    uncertaintyItems,
    attentionItems,
    recommendedAction: recommendationFromReality(reality) || selectRecommendedAction(attentionItems, uncertaintyItems),
    evidenceSummary: {
      latestUpdateAt,
      photoFindingCount,
      openIssueCount,
      failedAnalysisCount,
      staleEvidenceCount,
      overdueCommitmentCount: commitments.filter(commitment => commitment.status === 'Overdue').length,
    },
    emptyStates: EMPTY_STATES,
  };
}

function recommendationFromReality(reality: DAVEProjectReality): DAVEProjectDailyBriefRecommendation | null {
  const recommendation = reality.topRecommendation;
  if (!recommendation || recommendation.supportingEvidence.length === 0) return null;
  const source = recommendation.supportingEvidence[0];
  return {
    id: stableBriefId('reality-recommendation', reality.projectId, recommendation.sourceRecordId),
    evidenceClass: 'recommendation',
    actionType: recommendation.action.toLowerCase().includes('review') ? 'Correct' : 'Confirm',
    text: recommendation.action,
    reason: recommendation.reason,
    sourceType: source.sourceType,
    sourceRecordId: recommendation.sourceRecordId,
    navigationTarget: recommendation.navigationTarget,
    confidence: reality.confidence,
    limitations: recommendation.limitations,
  };
}

function buildChangedItems(
  updates: DAVEDailyBriefUpdate[],
  documents: DAVEDailyBriefDocument[],
  recentCutoff: number,
): DAVEProjectDailyBriefItem[] {
  const items: DAVEProjectDailyBriefItem[] = [];
  for (const update of updates) {
    for (const photo of update.photos) {
      const result = photo.photoIntelligence;
      if (!isCompletedComparison(result) || !hasPriorComparison(result)) continue;
      if (timestampMs(result.updatedAt || photo.locationCapturedAt || updateTimestamp(update)) < recentCutoff) continue;
      const observations = safePhotoObservations(result);
      observations.forEach((observation, index) => {
        items.push({
          id: stableBriefId('photo-change', update.id, photo.id, observation.category, String(index)),
          evidenceClass: 'observation',
          category: observation.category,
          text: observation.text,
          sourceType: 'photo',
          sourceRecordId: update.id,
          timestamp: result?.updatedAt || photo.locationCapturedAt || updateTimestamp(update),
          confidence: observation.confidence,
          navigationTarget: 'update_detail',
          limitations: observation.limitations,
        });
      });
    }
  }

  documents.forEach(document => {
    if (document.status === 'failed') return;
    if (timestampMs(document.importedAt || document.createdAt) < recentCutoff) return;
    items.push({
      id: stableBriefId('document-added', document.id, document.category),
      evidenceClass: 'fact',
      category: 'document_added',
      text: `${document.category || 'Project'} document added: ${document.name}.`,
      sourceType: 'document',
      sourceRecordId: document.id,
      timestamp: document.importedAt || document.createdAt,
      confidence: 'recorded',
      navigationTarget: 'project_documents',
      limitations: [],
    });
  });

  return items;
}

function buildUncertaintyItems(
  projectId: string,
  updates: DAVEDailyBriefUpdate[],
  staleCutoff: number,
): DAVEProjectDailyBriefItem[] {
  const items: DAVEProjectDailyBriefItem[] = [];
  for (const update of updates) {
    for (const photo of update.photos) {
      const result = photo.photoIntelligence;
      if (result?.status === 'no_suitable_prior_photo') {
        items.push({
          id: stableBriefId('uncertainty', update.id, photo.id, 'no-prior-photo'),
          evidenceClass: 'uncertainty',
          category: 'missing_verification',
          text: 'No prior photo is available for comparison.',
          sourceType: 'photo',
          sourceRecordId: update.id,
          timestamp: result.updatedAt || updateTimestamp(update),
          confidence: null,
          navigationTarget: 'update_detail',
          limitations: ['The photo is a baseline and is not evidence of change.'],
        });
      } else if (isFailedAnalysis(result)) {
        items.push({
          id: stableBriefId('uncertainty', update.id, photo.id, 'analysis-unavailable'),
          evidenceClass: 'uncertainty',
          category: 'failed_analysis',
          text: 'Analysis unavailable · Retry',
          sourceType: 'photo',
          sourceRecordId: update.id,
          timestamp: result?.updatedAt || updateTimestamp(update),
          confidence: null,
          navigationTarget: 'update_detail',
          limitations: ['No visual conclusion was accepted from this analysis.'],
        });
      } else if (isCompletedComparison(result) && !hasPriorComparison(result)) {
        items.push({
          id: stableBriefId('uncertainty', update.id, photo.id, 'comparison-limited'),
          evidenceClass: 'uncertainty',
          category: 'missing_verification',
          text: 'The available photos are not sufficiently comparable.',
          sourceType: 'photo',
          sourceRecordId: update.id,
          timestamp: result.updatedAt || updateTimestamp(update),
          confidence: null,
          navigationTarget: 'update_detail',
          limitations: ['No change or progress conclusion was accepted from this comparison.'],
        });
      }
    }

    if (timestampMs(updateTimestamp(update)) < staleCutoff && update.photos.some(isOpenIssue)) {
      items.push({
        id: stableBriefId('uncertainty', update.id, 'open-issue-stale'),
        evidenceClass: 'uncertainty',
        category: 'stale_evidence',
        text: 'An unresolved issue has no recent supporting evidence.',
        sourceType: 'issue',
        sourceRecordId: update.id,
        timestamp: updateTimestamp(update),
        confidence: null,
        navigationTarget: 'update_detail',
        limitations: ['Missing recent evidence does not establish whether the work occurred.'],
      });
    }
  }

  if (updates.length === 0) {
    items.push({
      id: stableBriefId('uncertainty', projectId, 'no-project-evidence'),
      evidenceClass: 'uncertainty',
      category: 'missing_evidence',
      text: 'No recent project evidence has been recorded.',
      sourceType: 'project',
      sourceRecordId: projectId,
      timestamp: null,
      confidence: null,
      navigationTarget: 'capture',
        limitations: ['Missing evidence does not establish current project status.'],
    });
  }
  return items;
}

function buildAttentionItems(
  updates: DAVEDailyBriefUpdate[],
  commitments: DAVEProjectCommitment[],
  staleCutoff: number,
): DAVEProjectDailyBriefAttentionItem[] {
  const items: DAVEProjectDailyBriefAttentionItem[] = [];
  for (const update of updates) {
    if (update.blockerFlag || update.quickContext === 'Blocker') {
      items.push(attentionItem({
        update,
        category: 'open_issue',
        itemType: 'open_item',
        subtype: 'blocker',
        priority: 1,
        text: 'Blocking issue requires review.',
        whyItMatters: 'A saved project update is marked as blocking.',
        evidence: 'Blocker status is recorded on the project update.',
        actionText: 'Confirm the blocker status and next owner action.',
      }));
    }

    for (const photo of update.photos) {
      const open = isOpenIssue(photo);
      const safety = photo.category === 'Safety Concern' && open;
      if (safety || open) {
        const commitment = commitments.find(item => item.sourcePhotoId === photo.id && item.sourceUpdateId === update.id);
        const overdue = commitment?.status === 'Overdue';
        const category: PIEAttentionCategory = safety ? 'safety_concern' : 'open_issue';
        const commitmentRank = commitment ? Math.max(0, commitments.indexOf(commitment)) : 0;
        items.push(attentionItem({
          update,
          photo,
          category,
          itemType: safety ? 'safety_observation' : 'open_item',
          subtype: safety ? 'safety' : overdue ? 'overdue' : 'routine',
          priority: safety
            ? 0
            : overdue
              ? (commitment?.priority ?? 2) + commitmentRank / 1000
              : 6,
          text: safety
            ? 'Safety observation requires review.'
            : overdue
              ? `Overdue commitment: ${commitment.description}`
              : 'Open issue needs follow-up.',
          whyItMatters: safety
            ? 'The source photo is categorized as a safety concern.'
            : overdue
              ? 'The recorded action remains open after its due date.'
              : 'The recorded action remains unresolved.',
          evidence: photo.actionRequired?.trim()
            ? `Recorded action: ${photo.actionRequired.trim()}`
            : `Source update ${update.id} contains the open item.`,
          actionText: safety
            ? 'Confirm the safety status and responsible owner.'
            : commitment?.recommendedFollowUpAction || 'Follow up on the recorded open issue.',
        }));
      }

      if (isFailedAnalysis(photo.photoIntelligence)) {
        items.push(attentionItem({
          update,
          photo,
          category: 'analysis',
          itemType: 'analysis_failure',
          subtype: 'photo-analysis',
          priority: 5,
          text: 'Photo analysis is unavailable.',
          whyItMatters: 'The latest visual evidence could not be evaluated.',
          evidence: 'The stored photo analysis status is unavailable or failed.',
          actionText: 'Review and retry the failed photo analysis.',
        }));
      }
    }

    if (timestampMs(updateTimestamp(update)) < staleCutoff && update.photos.some(isOpenIssue)) {
      items.push(attentionItem({
        update,
        category: 'unknown',
        itemType: 'open_item',
        subtype: 'stale-evidence',
        priority: 6,
        text: 'Current evidence is needed for an unresolved issue.',
        whyItMatters: 'The issue remains open and the supporting update is stale.',
        evidence: 'No recent project record updates this issue.',
        actionText: 'Capture current evidence before deciding issue status.',
      }));
    }
  }
  for (const [commitmentIndex, commitment] of commitments.entries()) {
    if (commitment.status !== 'Overdue') continue;
    const update = updates.find(item => item.id === commitment.sourceUpdateId);
    const photo = update?.photos.find(item => item.id === commitment.sourcePhotoId);
    if (!update || !photo || isOpenIssue(photo)) continue;
    items.push(attentionItem({
      update,
      photo,
      category: 'open_issue',
      itemType: 'open_item',
      subtype: 'overdue',
      priority: commitment.priority + commitmentIndex / 1000,
      text: `Overdue commitment: ${commitment.description}`,
      whyItMatters: `The recorded due date ${commitment.dueDate} has passed and no closed status is recorded.`,
      evidence: `Linked update and photo identify ${commitment.owner} as the recorded owner.`,
      actionText: commitment.recommendedFollowUpAction,
    }));
  }
  return items;
}

function attentionItem(input: {
  update: DAVEDailyBriefUpdate;
  photo?: DAVEDailyBriefPhoto;
  category: PIEAttentionCategory;
  itemType: PIEAttentionItemType;
  subtype: string;
  priority: number;
  text: string;
  whyItMatters: string;
  evidence: string;
  actionText: string;
}): DAVEProjectDailyBriefAttentionItem {
  const sourceType: DAVEBriefSourceType = input.photo ? (input.photo.category === 'Safety Concern' ? 'issue' : 'photo') : 'issue';
  return {
    id: buildStableAttentionItemId({
      updateId: input.update.id,
      photoId: input.photo?.id,
      category: input.category,
      itemType: input.itemType,
      subtype: input.subtype,
    }),
    evidenceClass: 'fact',
    category: input.category,
    text: input.text,
    sourceType,
    sourceRecordId: input.update.id,
    timestamp: input.photo?.locationCapturedAt || updateTimestamp(input.update),
    confidence: 'recorded',
    navigationTarget: 'update_detail',
    limitations: [],
    priority: input.priority,
    whyItMatters: input.whyItMatters,
    evidence: input.evidence,
    actionText: input.actionText,
  };
}

function selectRecommendedAction(
  attentionItems: DAVEProjectDailyBriefAttentionItem[],
  uncertaintyItems: DAVEProjectDailyBriefItem[],
): DAVEProjectDailyBriefRecommendation | null {
  const attention = attentionItems[0];
  if (attention) {
    const actionType: DAVERecommendationActionType = attention.category === 'analysis'
      ? 'Correct'
      : 'Confirm';
    return {
      id: stableBriefId('recommendation', attention.id, actionType),
      evidenceClass: 'recommendation',
      actionType,
      text: attention.actionText,
      reason: attention.whyItMatters,
      sourceType: attention.sourceType,
      sourceRecordId: attention.sourceRecordId,
      navigationTarget: attention.navigationTarget,
      confidence: attention.confidence,
      limitations: ['Review only; no messages are sent and project status is not changed automatically.'],
    };
  }

  const uncertainty = uncertaintyItems[0];
  if (!uncertainty) return null;
  return {
    id: stableBriefId('recommendation', uncertainty.id, 'capture'),
    evidenceClass: 'recommendation',
    actionType: 'Capture',
    text: uncertainty.category === 'failed_analysis'
      ? 'Review the failed photo analysis.'
      : 'Capture current project evidence.',
    reason: uncertainty.text,
    sourceType: uncertainty.sourceType,
    sourceRecordId: uncertainty.sourceRecordId,
    navigationTarget: uncertainty.navigationTarget === 'capture' ? 'capture' : 'update_detail',
    confidence: uncertainty.confidence,
    limitations: ['Project status cannot be determined from missing or unavailable evidence.'],
  };
}

function safePhotoObservations(result: DAVEDailyBriefPhotoResult): Array<{
  category: string;
  text: string;
  confidence: string | null;
  limitations: string[];
}> {
  const values: Array<{ category: string; text: string; confidence: string | null; limitations: string[] }> = [];
  if (Array.isArray(result.findings)) {
    result.findings.forEach(finding => {
      const text = safeObservationText(finding.description);
      if (!text) return;
      values.push({
        category: finding.findingType || 'visual_change',
        text,
        confidence: typeof finding.confidence === 'number' ? String(finding.confidence) : result.comparisonConfidence || null,
        limitations: cleanStrings(finding.limitations).concat(cleanStrings(result.captureLimitations)),
      });
    });
  }

  if (values.length === 0) {
    const fallback = [
      ...cleanStrings(result.additions),
      ...cleanStrings(result.removals),
      result.visibleChange || '',
      result.currentObservation || '',
    ];
    fallback.forEach((candidate, index) => {
      const text = safeObservationText(candidate);
      if (!text || values.some(item => item.text.toLowerCase() === text.toLowerCase())) return;
      values.push({
        category: index < cleanStrings(result.additions).length ? 'added' : 'visual_change',
        text,
        confidence: result.comparisonConfidence || null,
        limitations: cleanStrings(result.captureLimitations),
      });
    });
  }
  return values;
}

function safeObservationText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/first visual baseline|baseline saved|no earlier photo|no prior photo|future comparison/i.test(text)) return null;
  if (/work progressed|progress increased|progressed significantly|percent complete|fully complete|work completed|milestone complete|finished/i.test(text)) return null;
  return text;
}

function isCompletedComparison(result: DAVEDailyBriefPhotoResult | null | undefined): result is DAVEDailyBriefPhotoResult {
  return result?.status === 'analysis_complete' || result?.status === 'completed_with_limitations';
}

function hasPriorComparison(result: DAVEDailyBriefPhotoResult): boolean {
  const comparability = result.comparability?.trim().toLowerCase();
  return Boolean(
    (result.priorUpdateUsed || result.priorEvidenceId) &&
    (comparability === 'strong' || comparability === 'probable'),
  );
}

function isFailedAnalysis(result: DAVEDailyBriefPhotoResult | null | undefined): boolean {
  return result?.status === 'analysis_failed_retry' || result?.status === 'comparison_unavailable';
}

function isOpenIssue(photo: DAVEDailyBriefPhoto): boolean {
  return (photo.category === 'Open Issue' || photo.category === 'Safety Concern') && photo.actionStatus !== 'Closed';
}

function updateTimestamp(update: DAVEDailyBriefUpdate): string {
  return update.workflowTimestamps?.sendResolvedAt ||
    update.workflowTimestamps?.sendTappedAt ||
    update.workflowTimestamps?.firstPhotoAddedAt ||
    update.date;
}

function newestFirst(a: { timestamp: string | null }, b: { timestamp: string | null }): number {
  return timestampMs(b.timestamp) - timestampMs(a.timestamp);
}

function evidencePriority(item: DAVEProjectDailyBriefItem): number {
  return item.evidenceClass === 'observation' ? 0 : 1;
}

function uncertaintyPriority(item: DAVEProjectDailyBriefItem): number {
  if (item.category === 'failed_analysis') return 0;
  if (item.category === 'missing_verification') return 1;
  if (item.category === 'stale_evidence') return 2;
  return 3;
}

function timestampMs(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function stableBriefId(...parts: string[]): string {
  return parts.map(part => encodeURIComponent(part.trim() || 'unknown')).join(':');
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
