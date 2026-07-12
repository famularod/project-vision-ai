import type {
  PIERealityModel,
  PIERealityObject,
  PIERealityObjectIntelligenceResult,
  PIERealityReadiness,
} from './PIERealityModel';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIESituationState =
  | 'stable'
  | 'improving'
  | 'worsening'
  | 'blocked'
  | 'uncertain'
  | 'ready'
  | 'needs_verification'
  | 'at_risk';

export type PIESituationIntent =
  | 'daily_progress_walk'
  | 'inspection_preparation'
  | 'executive_update'
  | 'customer_update'
  | 'contractor_follow_up'
  | 'schedule_risk_review'
  | 'safety_review'
  | 'issue_resolution'
  | 'decision_preparation'
  | 'document_review'
  | 'project_status_review'
  | 'unknown';

export type PIESituationChange = {
  id: string;
  summary: string;
  objectId: string;
  changedAt: string;
  direction: 'improving' | 'worsening' | 'new' | 'resolved' | 'unchanged';
  confidence: ProjectConfidenceLevel;
};

export type PIESituationRisk = {
  id: string;
  risk: string;
  whyItMatters: string;
  objectId: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: ProjectConfidenceLevel;
};

export type PIESituationOpportunity = {
  id: string;
  opportunity: string;
  value: string;
  nextAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationUnknown = {
  id: string;
  unknown: string;
  whyItMatters: string;
  recommendedEvidence: string;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationPriority = {
  id: string;
  priority: string;
  reason: string;
  action: string;
  rank: number;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationBlocker = {
  id: string;
  blocker: string;
  blocks: string;
  ownerNeeded: boolean;
  nextAction: string;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationReadiness = {
  readiness: PIERealityReadiness;
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationSummary = {
  headline: string;
  whatIsHappening: string;
  whyUserIsLikelyHere: string;
  whatChangedRecently: string;
  whatMattersNow: string;
  whatIsReady: string;
  whatNeedsVerification: string;
  whatUserShouldKnowNow: string;
};

export type PIESituation = {
  state: PIESituationState;
  intent: PIESituationIntent;
  summary: PIESituationSummary;
  readiness: PIESituationReadiness;
  confidence: ProjectConfidenceLevel;
};

export type PIESituationResult = {
  generatedAt: string;
  currentSituation: PIESituation;
  situationIntent: PIESituationIntent;
  situationState: PIESituationState;
  situationChanges: PIESituationChange[];
  situationRisks: PIESituationRisk[];
  situationOpportunities: PIESituationOpportunity[];
  situationUnknowns: PIESituationUnknown[];
  situationBlockers: PIESituationBlocker[];
  situationPriorities: PIESituationPriority[];
  situationReadiness: PIESituationReadiness;
  situationSummary: PIESituationSummary;
  explanation: string;
};

export type PIESituationInput = {
  realityModel: PIERealityModel;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  generatedAt?: string;
  userContext?: {
    surface?: string | null;
    requestedReport?: boolean;
    walkActive?: boolean;
  };
};

export function buildPIESituation(
  input: PIESituationInput,
): PIESituationResult {
  const generatedAt = input.generatedAt || input.realityModel.generatedAt || new Date().toISOString();
  const objectIntelligence = input.objectIntelligence || input.realityModel.intelligence;
  const situationIntent = recognizeSituationIntent(input);
  const situationChanges = detectSituationChanges(input.realityModel, generatedAt);
  const situationRisks = identifySituationRisks(input.realityModel);
  const situationOpportunities = identifySituationOpportunities(input.realityModel);
  const situationUnknowns = identifySituationUnknowns(input.realityModel);
  const situationBlockers = identifySituationBlockers(input.realityModel);
  const situationPriorities = rankSituationPriorities({
    risks: situationRisks,
    blockers: situationBlockers,
    unknowns: situationUnknowns,
    objectIntelligence,
  });
  const situationReadiness = determineSituationReadiness(input.realityModel, situationRisks, situationUnknowns, situationBlockers);
  const situationState = stateFromSituation({
    readiness: situationReadiness,
    changes: situationChanges,
    risks: situationRisks,
    blockers: situationBlockers,
    unknowns: situationUnknowns,
  });
  const situationSummary = summarizeSituation({
    intent: situationIntent,
    state: situationState,
    changes: situationChanges,
    risks: situationRisks,
    opportunities: situationOpportunities,
    unknowns: situationUnknowns,
    blockers: situationBlockers,
    priorities: situationPriorities,
    readiness: situationReadiness,
    model: input.realityModel,
  });

  return {
    generatedAt,
    currentSituation: {
      state: situationState,
      intent: situationIntent,
      summary: situationSummary,
      readiness: situationReadiness,
      confidence: situationReadiness.confidence,
    },
    situationIntent,
    situationState,
    situationChanges,
    situationRisks,
    situationOpportunities,
    situationUnknowns,
    situationBlockers,
    situationPriorities,
    situationReadiness,
    situationSummary,
    explanation: explainSituation(situationSummary, situationReadiness),
  };
}

export function recognizeSituationIntent(
  input: PIESituationInput,
): PIESituationIntent {
  const objects = input.realityModel.objects;
  const text = objects.map(object => `${object.name} ${object.currentState.summary}`).join(' ').toLowerCase();
  if (input.userContext?.walkActive) return 'daily_progress_walk';
  if (input.userContext?.requestedReport) return 'executive_update';
  if (/inspection|rough-in|signoff/.test(text)) return 'inspection_preparation';
  if (/executive|report|brief|update/.test(text)) return 'executive_update';
  if (/customer/.test(text)) return 'customer_update';
  if (/contractor|owner|assign|follow up/.test(text)) return 'contractor_follow_up';
  if (/schedule|overdue|milestone|critical|delay/.test(text)) return 'schedule_risk_review';
  if (/safety|hazard|unsafe/.test(text)) return 'safety_review';
  if (/issue|blocked|resolve/.test(text)) return 'issue_resolution';
  if (/decision|approval|approve/.test(text)) return 'decision_preparation';
  if (/document|pdf|file/.test(text)) return 'document_review';
  if (objects.length > 0) return 'project_status_review';
  return 'unknown';
}

export function detectSituationChanges(
  realityModel: PIERealityModel,
  generatedAt: string = new Date().toISOString(),
): PIESituationChange[] {
  return realityModel.objects
    .filter(object => daysBetween(object.lastUpdated, generatedAt) <= 7)
    .slice(0, 8)
    .map((object, index) => ({
      id: `situation-change-${index + 1}`,
      summary: object.intelligence.summary || object.currentState.summary,
      objectId: object.identity.id,
      changedAt: object.lastUpdated,
      direction: changeDirectionForObject(object),
      confidence: object.intelligence.confidence.level,
    }));
}

export function identifySituationRisks(
  realityModel: PIERealityModel,
): PIESituationRisk[] {
  return realityModel.objects
    .filter(object =>
      object.intelligence.riskLevel === 'high' ||
      object.intelligence.riskLevel === 'critical' ||
      object.currentStatus === 'at_risk' ||
      object.currentStatus === 'blocked',
    )
    .slice(0, 8)
    .map((object, index) => ({
      id: `situation-risk-${index + 1}`,
      risk: object.name,
      whyItMatters: object.intelligence.summary,
      objectId: object.identity.id,
      severity: object.intelligence.riskLevel,
      confidence: object.intelligence.confidence.level,
    }));
}

export function identifySituationOpportunities(
  realityModel: PIERealityModel,
): PIESituationOpportunity[] {
  return realityModel.objects
    .filter(object => object.intelligence.readiness === 'Ready')
    .slice(0, 5)
    .map((object, index) => ({
      id: `situation-opportunity-${index + 1}`,
      opportunity: `${object.name} is ready.`,
      value: object.intelligence.goalsSupported[0]?.goal || 'Use ready project evidence.',
      nextAction: object.intelligence.nextBestAction.action,
      confidence: object.intelligence.confidence.level,
    }));
}

export function identifySituationUnknowns(
  realityModel: PIERealityModel,
): PIESituationUnknown[] {
  return realityModel.objects
    .flatMap(object =>
      object.intelligence.uncertainty.map((unknown, index) => ({
        id: `situation-unknown-${object.identity.id}-${index + 1}`,
        unknown: unknown.uncertainty,
        whyItMatters: object.intelligence.summary,
        recommendedEvidence: unknown.recommendedEvidence,
        confidence: object.intelligence.confidence.level,
      })),
    )
    .slice(0, 8);
}

export function identifySituationBlockers(
  realityModel: PIERealityModel,
): PIESituationBlocker[] {
  return realityModel.objects
    .filter(object => object.currentStatus === 'blocked' || object.intelligence.readiness === 'Blocked')
    .slice(0, 8)
    .map((object, index) => ({
      id: `situation-blocker-${index + 1}`,
      blocker: object.name,
      blocks: object.intelligence.dependencies[0]?.summary || object.currentState.summary,
      ownerNeeded: object.intelligence.ownerNeeded,
      nextAction: object.intelligence.nextBestAction.action,
      confidence: object.intelligence.confidence.level,
    }));
}

export function rankSituationPriorities(input: {
  risks: PIESituationRisk[];
  blockers: PIESituationBlocker[];
  unknowns: PIESituationUnknown[];
  objectIntelligence: PIERealityObjectIntelligenceResult;
}): PIESituationPriority[] {
  const blockerPriorities = input.blockers.map((blocker, index) => ({
    id: `situation-priority-blocker-${index + 1}`,
    priority: blocker.blocker,
    reason: blocker.blocks,
    action: blocker.nextAction,
    rank: index + 1,
    confidence: blocker.confidence,
  }));
  const riskPriorities = input.risks.map((risk, index) => ({
    id: `situation-priority-risk-${index + 1}`,
    priority: risk.risk,
    reason: risk.whyItMatters,
    action: input.objectIntelligence.objectNextBestActions[index]?.action || `Verify ${risk.risk}.`,
    rank: blockerPriorities.length + index + 1,
    confidence: risk.confidence,
  }));
  const unknownPriorities = input.unknowns.slice(0, 3).map((unknown, index) => ({
    id: `situation-priority-unknown-${index + 1}`,
    priority: unknown.unknown,
    reason: unknown.whyItMatters,
    action: unknown.recommendedEvidence,
    rank: blockerPriorities.length + riskPriorities.length + index + 1,
    confidence: unknown.confidence,
  }));
  return [...blockerPriorities, ...riskPriorities, ...unknownPriorities]
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 8);
}

export function determineSituationReadiness(
  realityModel: PIERealityModel,
  risks: PIESituationRisk[],
  unknowns: PIESituationUnknown[],
  blockers: PIESituationBlocker[],
): PIESituationReadiness {
  if (blockers.length > 0) {
    return { readiness: 'Blocked', reason: `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} must be resolved.`, confidence: 'high' };
  }
  if (risks.some(risk => risk.severity === 'critical' || risk.severity === 'high')) {
    return { readiness: 'Needs Verification', reason: 'High-risk reality objects need verification before DAVE recommends action.', confidence: 'medium' };
  }
  if (unknowns.length > 0) {
    return { readiness: 'Uncertain', reason: `${unknowns.length} unknown${unknowns.length === 1 ? '' : 's'} still affect the situation.`, confidence: 'medium' };
  }
  if (realityModel.intelligence.objectsReady.length > 0) {
    return { readiness: 'Ready', reason: 'Reality Model has ready objects and no blocking risks.', confidence: realityModel.summary.confidence };
  }
  return { readiness: 'Uncertain', reason: 'Not enough reality objects are ready yet.', confidence: 'low' };
}

export function summarizeSituation(input: {
  intent: PIESituationIntent;
  state: PIESituationState;
  changes: PIESituationChange[];
  risks: PIESituationRisk[];
  opportunities: PIESituationOpportunity[];
  unknowns: PIESituationUnknown[];
  blockers: PIESituationBlocker[];
  priorities: PIESituationPriority[];
  readiness: PIESituationReadiness;
  model: PIERealityModel;
}): PIESituationSummary {
  const priority = input.priorities[0];
  const blocker = input.blockers[0];
  const risk = input.risks[0];
  const ready = input.model.intelligence.objectsReady[0];
  return {
    headline: priority?.priority || input.model.summary.summary,
    whatIsHappening: input.model.summary.summary,
    whyUserIsLikelyHere: readableIntent(input.intent),
    whatChangedRecently: input.changes[0]?.summary || 'No recent change is clear yet.',
    whatMattersNow: priority?.reason || risk?.whyItMatters || input.readiness.reason,
    whatIsReady: ready ? `${ready.name} is ready.` : 'No major object is fully ready yet.',
    whatNeedsVerification: input.unknowns[0]?.unknown || input.readiness.reason,
    whatUserShouldKnowNow: blocker?.nextAction || priority?.action || input.opportunities[0]?.nextAction || 'Continue collecting current evidence.',
  };
}

export function explainSituation(
  summary: PIESituationSummary,
  readiness: PIESituationReadiness,
): string {
  return `${summary.headline} ${summary.whatMattersNow} Readiness: ${readiness.readiness}. ${readiness.reason}`;
}

function stateFromSituation(input: {
  readiness: PIESituationReadiness;
  changes: PIESituationChange[];
  risks: PIESituationRisk[];
  blockers: PIESituationBlocker[];
  unknowns: PIESituationUnknown[];
}): PIESituationState {
  if (input.blockers.length > 0 || input.readiness.readiness === 'Blocked') return 'blocked';
  if (input.risks.some(risk => risk.severity === 'critical' || risk.severity === 'high')) return 'at_risk';
  if (input.readiness.readiness === 'Needs Verification') return 'needs_verification';
  if (input.readiness.readiness === 'Uncertain' || input.unknowns.length > 0) return 'uncertain';
  if (input.changes.some(change => change.direction === 'worsening')) return 'worsening';
  if (input.changes.some(change => change.direction === 'improving' || change.direction === 'resolved')) return 'improving';
  if (input.readiness.readiness === 'Ready') return 'ready';
  return 'stable';
}

function changeDirectionForObject(
  object: PIERealityObject,
): PIESituationChange['direction'] {
  if (object.currentStatus === 'blocked' || object.currentStatus === 'at_risk') return 'worsening';
  if (object.currentStatus === 'complete' || object.intelligence.readiness === 'Ready') return 'improving';
  if (object.history.some(event => event.eventType === 'created')) return 'new';
  if (object.currentStatus === 'ready') return 'resolved';
  return 'unchanged';
}

function readableIntent(intent: PIESituationIntent) {
  return intent.replace(/_/g, ' ');
}

function daysBetween(earlier: string, later: string) {
  const left = new Date(earlier).getTime();
  const right = new Date(later).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((right - left) / 86_400_000));
}
