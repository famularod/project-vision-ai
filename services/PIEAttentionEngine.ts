import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type { PIEBelief } from './PIEBeliefEngine';
import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIEDecisionMemoryResult } from './PIEDecisionMemory';
import type { PIEExecutiveReasoningResult } from './PIEExecutiveReasoning';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type { PIEPredictiveRealityResult } from './PIEPredictiveReality';
import type { PIERuntimeState } from './PIERuntime';
import type { PIEMissingEvidenceResult } from './PIEMissingEvidence';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';

export type PIEUserActionType =
  | 'Confirm'
  | 'Capture'
  | 'Correct'
  | 'Approve'
  | 'Communicate';

export type PIEAttentionPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

export type PIEAttentionReason = {
  id: string;
  summary: string;
  source:
    | 'Runtime'
    | 'Mission'
    | 'Executive'
    | 'Schedule Intelligence'
    | 'Evidence Fusion'
    | 'Photo Progress'
    | 'GPS Walk Recommendation'
    | 'Open Issues'
    | 'Safety'
    | 'Report Readiness'
    | 'Memory Recall'
    | 'Deliberation'
    | 'Belief Engine'
    | 'Executive Judgment'
    | 'Decision Memory'
    | 'Executive Reasoning'
    | 'Predictive Simulation'
    | 'Predictive Reality'
    | 'Missing Evidence'
    | 'Situation Intelligence';
};

export type PIEAttentionRecommendation = {
  label: string;
  nextStep: string;
  userActionType: PIEUserActionType;
};

export type PIEWalkAttentionStage =
  | 'recommend_project_area'
  | 'confirm_location'
  | 'capture_photo'
  | 'add_note'
  | 'verify_progress'
  | 'continue_to_next_area'
  | 'finish_walk'
  | 'review_update';

export type PIEAttentionItem = {
  id: string;
  stage?: PIEWalkAttentionStage;
  currentProject?: string | null;
  currentArea?: string | null;
  whatMattersNow: string;
  whyItMatters: string;
  priority: PIEAttentionPriority;
  confidence: number;
  reasons: PIEAttentionReason[];
  recommendation: PIEAttentionRecommendation;
};

export type PIEAttentionState = {
  generatedAt: string;
  primaryItem: PIEAttentionItem;
  items: PIEAttentionItem[];
  stage?: PIEWalkAttentionStage;
  currentProject?: string | null;
  currentArea?: string | null;
  whatMattersNow: string;
  whyItMatters: string;
  recommendedAction: PIEAttentionRecommendation;
  confidence: number;
  nextStep: string;
  userActionType: PIEUserActionType;
};

export type PIEAttentionInput = {
  runtime: PIERuntimeState;
  enforceAuthoritativeInputs?: boolean;
  memoryRecall?: PIEMemoryRecallResult | null;
  deliberation?: PIEDeliberationResult | null;
  beliefsNeedingVerification?: PIEBelief[];
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
  bestNextStep?: string | null;
  recommendationWhy?: string | null;
  decisionMemory?: PIEDecisionMemoryResult | null;
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  predictions?: PIEPredictionResult | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
  missingEvidence?: PIEMissingEvidenceResult | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  gpsWalkRecommendation?: {
    projectName?: string | null;
    areaName?: string | null;
    confidenceScore?: number | null;
    detail?: string | null;
    needsUserSelection?: boolean | null;
  } | null;
};

export type PIEWalkAttentionInput = {
  projectName: string;
  areaName: string;
  recommendedProjectName: string;
  recommendedAreaName: string;
  recommendationReason: string;
  confidence: number;
  needsUserSelection: boolean;
  gpsUnavailable?: boolean;
  photoCount: number;
  hasNote: boolean;
  photoConfirmation?: string | null;
  nextAreaName?: string | null;
  nextAreaReason?: string | null;
};

const PRIORITY_SCORE: Record<PIEAttentionPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function buildPIEAttentionState(
  input: PIEAttentionInput,
): PIEAttentionState {
  if (input.enforceAuthoritativeInputs && (!input.realityModel || !input.executiveJudgment)) {
    throw new Error('Attention requires authoritative Reality Model and Executive Judgment in live mode.');
  }
  const items = buildAttentionItems(input).sort(
    (left, right) =>
      PRIORITY_SCORE[right.priority] - PRIORITY_SCORE[left.priority] ||
      right.confidence - left.confidence,
  );
  const primaryItem = getPrimaryAttentionItem(items);

  return {
    generatedAt: input.runtime.generatedAt,
    primaryItem,
    items,
    stage: primaryItem.stage,
    currentProject: primaryItem.currentProject,
    currentArea: primaryItem.currentArea,
    whatMattersNow: primaryItem.whatMattersNow,
    whyItMatters: primaryItem.whyItMatters,
    recommendedAction: primaryItem.recommendation,
    confidence: primaryItem.confidence,
    nextStep: primaryItem.recommendation.nextStep,
    userActionType: primaryItem.recommendation.userActionType,
  };
}

export function buildPIEWalkAttentionState(
  input: PIEWalkAttentionInput,
): PIEAttentionState {
  const item = buildWalkAttentionItem(input);

  return {
    generatedAt: new Date().toISOString(),
    primaryItem: item,
    items: [item],
    stage: item.stage,
    currentProject: item.currentProject,
    currentArea: item.currentArea,
    whatMattersNow: item.whatMattersNow,
    whyItMatters: item.whyItMatters,
    recommendedAction: item.recommendation,
    confidence: item.confidence,
    nextStep: item.recommendation.nextStep,
    userActionType: item.recommendation.userActionType,
  };
}

export function getPrimaryAttentionItem(
  items: PIEAttentionItem[],
): PIEAttentionItem {
  return items[0] || fallbackAttentionItem();
}

export function getAttentionReasons(
  item: PIEAttentionItem,
): PIEAttentionReason[] {
  return item.reasons;
}

export function getRecommendedUserAction(
  item: PIEAttentionItem,
): PIEAttentionRecommendation {
  return item.recommendation;
}

export function getAttentionNextStep(item: PIEAttentionItem): string {
  return item.recommendation.nextStep;
}

function buildAttentionItems({
  runtime,
  memoryRecall,
  deliberation,
  beliefsNeedingVerification,
  executiveJudgment,
  bestNextStep,
  recommendationWhy,
  decisionMemory,
  executiveReasoning,
  predictions,
  predictiveReality,
  missingEvidence,
  realityModel,
  objectIntelligence,
  situationIntelligence,
  gpsWalkRecommendation,
}: PIEAttentionInput): PIEAttentionItem[] {
  const items: PIEAttentionItem[] = [];
  const safetyPriority = runtime.executivePriorities.find(priority =>
    /safety/i.test(`${priority.title} ${priority.summary}`),
  );
  const overdueTask = runtime.overdueTasks[0];
  const criticalTask = runtime.criticalTasks[0];
  const missionBlocker = runtime.missionBlockers[0];
  const reportNeedsReview =
    runtime.response.reportNeedsReview ||
    runtime.response.reportActionItems.length > 0;
  const walkArea = runtime.recommendedWalkAreas[0];
  const gpsNeedsCorrection =
    gpsWalkRecommendation?.needsUserSelection ||
    (gpsWalkRecommendation?.confidenceScore ?? 100) < 60;
  const evidenceGap = runtime.evidenceGaps[0];
  const photoNeedsReview = runtime.comparisonNeedsReview;
  const memoryAttentionInfluence = memoryRecall?.memoryInfluences.find(influence =>
    influence.appliesTo === 'attention',
  );
  const deliberatedRecommendation = deliberation?.deliberatedRecommendation;
  const beliefNeedingVerification = beliefsNeedingVerification?.[0];
  const executiveJudgmentAction = executiveJudgment?.highestValueAction;
  const executiveRisk = executiveReasoning?.biggestRisk;
  const highestValueAction = executiveReasoning?.highestValueAction;
  const urgentPrediction = predictions?.cascadingImpacts.find(impact =>
    impact.severity === 'high',
  ) || predictions?.scheduleImpact;
  const urgentFutureRisk = predictiveReality?.risks.find(risk =>
    risk.severity === 'critical' || risk.severity === 'high',
  );
  const highestMissingEvidence = missingEvidence?.highestImpactEvidenceGap;
  const minimumEvidenceRequest = missingEvidence?.minimumEvidenceNeeded[0];
  const realityObjectNeedingAttention = realityModel?.objects.find(object =>
    object.currentStatus === 'blocked' ||
    object.currentStatus === 'at_risk' ||
    object.currentStatus === 'needs_verification',
  );
  const objectAction = objectIntelligence?.objectNextBestActions[0];
  const situationPriority = situationIntelligence?.situationPriorities[0];
  const situationRisk = situationIntelligence?.situationRisks[0];
  const situationBlocker = situationIntelligence?.situationBlockers[0];
  const wisdomCaution = decisionMemory?.whenNotToActReasons[0];
  const wisdomRecommendation = decisionMemory?.wisdomRecommendations[0];

  if (executiveJudgmentAction) {
    const executiveBestNextStep =
      bestNextStep ||
      (executiveJudgmentAction.score.readiness === 'Ready'
        ? executiveJudgmentAction.action
        : executiveJudgment.waitForEvidenceReasoning.shouldWaitForEvidence
          ? executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest
          : executiveJudgmentAction.governance.whatWouldChangeRecommendation[0] ||
            executiveJudgmentAction.action);
    const escalationIsUnsupported =
      executiveJudgmentAction.type === 'escalate' &&
      executiveJudgment?.escalationAnalysis.shouldEscalate === false;
    const waitForEvidence =
      executiveJudgment?.decisionTiming.recommendation === 'wait_for_evidence' ||
      executiveJudgment?.waitForEvidenceReasoning.shouldWaitForEvidence ||
      wisdomCaution?.reason === 'evidence_too_weak' ||
      wisdomCaution?.reason === 'prediction_confidence_low' ||
      wisdomCaution?.reason === 'truth_over_speed';
    items.push({
      id: 'attention-executive-judgment',
      whatMattersNow: waitForEvidence
        ? wisdomCaution?.recommendedAlternative || executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest
        : executiveJudgmentAction.action,
      whyItMatters: waitForEvidence
        ? wisdomCaution?.explanation || executiveJudgment.waitForEvidenceReasoning.reason
        : recommendationWhy || executiveJudgmentAction.why,
      priority:
        escalationIsUnsupported
          ? 'medium'
          : executiveJudgmentAction.score.readiness === 'Blocked'
          ? 'critical'
          : executiveJudgmentAction.score.total >= 65
            ? 'high'
            : 'medium',
      confidence: confidenceToScore(executiveJudgmentAction.confidence),
      reasons: [
        {
          id: 'attention-executive-judgment-reason',
          summary:
            executiveJudgment?.decisionTiming.reason ||
            wisdomRecommendation?.reason ||
            executiveJudgment?.executiveJudgmentSummary ||
            executiveJudgmentAction.governance.why,
          source: 'Executive Judgment',
        },
      ],
      recommendation: {
        label:
          waitForEvidence
            ? 'Capture'
            : executiveJudgmentAction.score.readiness === 'Ready'
            ? 'Act'
            : 'Verify',
        nextStep:
          waitForEvidence
            ? wisdomCaution?.recommendedAlternative || executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest
            : executiveBestNextStep,
        userActionType:
          waitForEvidence
            ? 'Capture'
            : executiveJudgmentAction.type === 'communicate'
            ? 'Communicate'
            : executiveJudgmentAction.score.readiness === 'Ready'
              ? 'Confirm'
              : 'Capture',
      },
    });
  }

  if (urgentFutureRisk && predictiveReality) {
    items.push({
      id: 'attention-predictive-reality',
      whatMattersNow: urgentFutureRisk.risk,
      whyItMatters: predictiveReality.noActionForecast.summary,
      priority: urgentFutureRisk.severity === 'critical' ? 'critical' : 'high',
      confidence: confidenceToScore(urgentFutureRisk.confidence),
      reasons: [
        {
          id: 'attention-predictive-reality-reason',
          summary: predictiveReality.explanation,
          source: 'Predictive Reality',
        },
      ],
      recommendation: {
        label: 'Verify Forecast',
        nextStep:
          predictiveReality.opportunities[0]?.recoveryAction ||
          urgentFutureRisk.verificationNeeded,
        userActionType: 'Capture',
      },
    });
  }

  if (situationPriority || situationRisk || situationBlocker) {
    items.push({
      id: 'attention-situation-intelligence',
      whatMattersNow:
        situationPriority?.priority ||
        situationRisk?.risk ||
        situationBlocker?.blocker ||
        situationIntelligence?.situationSummary.headline ||
        'Current situation needs attention.',
      whyItMatters:
        situationPriority?.reason ||
        situationRisk?.whyItMatters ||
        situationBlocker?.blocks ||
        situationIntelligence?.situationSummary.whatMattersNow ||
        'Situation Intelligence identified the current state as important.',
      priority:
        situationBlocker || situationRisk?.severity === 'critical'
          ? 'critical'
          : situationRisk?.severity === 'high'
            ? 'high'
            : 'medium',
      confidence: confidenceToScore(
        situationPriority?.confidence ||
        situationRisk?.confidence ||
        situationBlocker?.confidence ||
        situationIntelligence?.currentSituation.confidence ||
        'medium',
      ),
      reasons: [
        {
          id: 'attention-situation-reason',
          summary: situationIntelligence?.explanation || 'Situation Intelligence summarized current reality, risk, blockers, and readiness.',
          source: 'Situation Intelligence',
        },
      ],
      recommendation: {
        label: situationBlocker ? 'Resolve Blocker' : situationRisk ? 'Verify Risk' : 'Continue',
        nextStep:
          situationPriority?.action ||
          situationBlocker?.nextAction ||
          situationIntelligence?.situationSummary.whatUserShouldKnowNow ||
          'Act on the current situation priority.',
        userActionType: situationIntelligence?.situationState === 'ready' ? 'Confirm' : 'Correct',
      },
    });
  }

  if (urgentPrediction && predictions && predictions.predictionConfidence !== 'low') {
    items.push({
      id: 'attention-predictive-simulation',
      whatMattersNow: urgentPrediction.summary,
      whyItMatters: predictions.noActionOutcome.likelyOutcome,
      priority: urgentPrediction.severity === 'high' ? 'critical' : 'high',
      confidence: confidenceToScore(urgentPrediction.confidence),
      reasons: [
        {
          id: 'attention-prediction-reason',
          summary: predictions.explanation.doNotOverstate
            ? `${predictions.explanation.summary} Verify before acting.`
            : predictions.explanation.summary,
          source: 'Predictive Simulation',
        },
      ],
      recommendation: {
        label: predictions.recoveryActions[0]?.confidence === 'high'
          ? 'Recover'
          : 'Verify Risk',
        nextStep:
          predictions.recoveryActions[0]?.action ||
          predictions.evidenceThatWouldImprovePrediction[0] ||
          'Verify the predicted risk before acting.',
        userActionType: predictions.recoveryActions[0]?.confidence === 'high'
          ? 'Confirm'
          : 'Correct',
      },
    });
  }

  if (highestMissingEvidence && minimumEvidenceRequest) {
    items.push({
      id: 'attention-missing-evidence',
      whatMattersNow: highestMissingEvidence.smallestEvidenceRequest,
      whyItMatters: highestMissingEvidence.whyItMatters,
      priority:
        highestMissingEvidence.priority === 'critical'
          ? 'critical'
          : highestMissingEvidence.priority === 'high'
            ? 'high'
            : 'medium',
      confidence: Math.min(92, 50 + highestMissingEvidence.uncertaintyReduction),
      reasons: [
        {
          id: 'attention-missing-evidence-reason',
          summary: highestMissingEvidence.summary,
          source: 'Missing Evidence',
        },
      ],
      recommendation: {
        label: 'Capture Evidence',
        nextStep: minimumEvidenceRequest.suggestedCaptureAction,
        userActionType: 'Capture',
      },
    });
  }

  if (realityObjectNeedingAttention) {
    items.push({
      id: 'attention-reality-model',
      whatMattersNow: realityObjectNeedingAttention.name,
      whyItMatters: realityObjectNeedingAttention.currentState.summary,
      priority: realityObjectNeedingAttention.currentStatus === 'blocked' ? 'high' : 'medium',
      confidence: confidenceToScore(realityObjectNeedingAttention.currentState.confidence),
      currentProject: realityObjectNeedingAttention.projectName,
      currentArea: realityObjectNeedingAttention.areaName,
      reasons: [
        {
          id: 'attention-reality-model-reason',
          summary: realityModel?.summary.summary || 'Reality Model identified an object needing attention.',
          source: 'Runtime',
        },
      ],
      recommendation: {
        label: objectAction?.priority === 'critical' ? 'Act Now' : realityObjectNeedingAttention.currentState.nextAction ? 'Continue' : 'Verify',
        nextStep: objectAction?.action || realityObjectNeedingAttention.currentState.nextAction || 'Verify this reality object before acting.',
        userActionType: realityObjectNeedingAttention.currentStatus === 'needs_verification'
          ? 'Correct'
          : 'Confirm',
      },
    });
  }

  if (executiveRisk || highestValueAction) {
    items.push({
      id: 'attention-executive-risk',
      whatMattersNow:
        executiveRisk?.risk ||
        highestValueAction?.action ||
        'Review the highest-value action.',
      whyItMatters:
        executiveRisk?.whyItMatters ||
        highestValueAction?.whyRecommended ||
        'Executive Reasoning identified this as the best use of attention.',
      priority: executiveRisk?.likelyToGrow ? 'critical' : 'high',
      confidence: confidenceToScore(
        executiveRisk?.confidence ||
        (highestValueAction?.readiness === 'Ready' ? 'high' : 'medium'),
      ),
      reasons: [
        {
          id: 'attention-executive-risk-reason',
          summary: executiveReasoning?.judgment.explanation ||
            executiveRisk?.source ||
            'Executive Reasoning scored priorities, risk, opportunity, decisions, and readiness.',
          source: 'Executive Reasoning',
        },
      ],
      recommendation: {
        label: highestValueAction?.readiness === 'Ready'
          ? 'Act Now'
          : 'Verify First',
        nextStep:
          highestValueAction?.action ||
          executiveRisk?.whyItMatters ||
          'Review the executive risk before acting.',
        userActionType: highestValueAction?.readiness === 'Ready'
          ? 'Confirm'
          : 'Correct',
      },
    });
  }

  if (beliefNeedingVerification) {
    items.push({
      id: 'attention-belief-verification',
      whatMattersNow: beliefNeedingVerification.statement,
      whyItMatters: beliefNeedingVerification.explanation.readinessReason,
      priority: beliefNeedingVerification.contradictingEvidence.length > 0 ? 'high' : 'medium',
      confidence: confidenceToScore(beliefNeedingVerification.confidence),
      reasons: [
        {
          id: 'attention-belief-reason',
          summary: beliefNeedingVerification.explanation.weakestAssumption,
          source: 'Belief Engine',
        },
      ],
      recommendation: {
        label: 'Verify Belief',
        nextStep: beliefNeedingVerification.recommendedEvidence[0] || 'Collect evidence to verify this belief.',
        userActionType: 'Confirm',
      },
    });
  }

  if (deliberatedRecommendation) {
    items.push({
      id: 'attention-deliberation',
      whatMattersNow: deliberatedRecommendation.action,
      whyItMatters: deliberation.explanation,
      priority: deliberation.recommendationReadiness === 'Ready'
        ? 'high'
        : deliberation.recommendationReadiness === 'Needs Verification'
          ? 'medium'
          : 'low',
      confidence: confidenceToScore(deliberatedRecommendation.confidence),
      reasons: [
        {
          id: 'attention-deliberation-reason',
          summary: deliberatedRecommendation.whyBetterThanAlternatives,
          source: 'Deliberation',
        },
      ],
      recommendation: {
        label: deliberation.recommendationReadiness === 'Ready'
          ? 'Continue'
          : 'Verify First',
        nextStep: deliberatedRecommendation.action,
        userActionType: deliberation.recommendationReadiness === 'Ready'
          ? 'Confirm'
          : 'Confirm',
      },
    });
  }

  if (memoryAttentionInfluence) {
    items.push({
      id: 'attention-memory-recall',
      whatMattersNow: memoryAttentionInfluence.summary,
      whyItMatters: memoryAttentionInfluence.influence,
      priority: memoryRecall?.patterns.length ? 'high' : 'medium',
      confidence: confidenceToScore(memoryAttentionInfluence.confidence),
      reasons: [
        {
          id: 'attention-memory-recall-reason',
          summary: memoryRecall?.summaryForPIE || memoryAttentionInfluence.influence,
          source: 'Memory Recall',
        },
      ],
      recommendation: {
        label: 'Verify History',
        nextStep: 'Compare this evidence against prior similar updates before acting.',
        userActionType: 'Confirm',
      },
    });
  }

  if (safetyPriority) {
    items.push({
      id: 'attention-safety',
      whatMattersNow: safetyPriority.title,
      whyItMatters: safetyPriority.summary,
      priority: 'critical',
      confidence: confidenceToScore(safetyPriority.confidence),
      reasons: [
        {
          id: 'attention-safety-reason',
          summary: safetyPriority.evidence[0] || safetyPriority.summary,
          source: 'Safety',
        },
      ],
      recommendation: {
        label: 'Review Safety',
        nextStep: safetyPriority.recommendedAction,
        userActionType: 'Confirm',
      },
    });
  }

  if (overdueTask || criticalTask) {
    const task = overdueTask || criticalTask;
    const taskName = task?.task || 'Critical schedule work';
    const area = task?.area || walkArea || runtime.projectName;

    items.push({
      id: 'attention-schedule',
      whatMattersNow: area
        ? `Your attention belongs at ${area}.`
        : taskName,
      whyItMatters: `${taskName} is driving schedule attention and needs current field evidence.`,
      priority: overdueTask ? 'high' : 'medium',
      confidence: confidenceToScore(runtime.scheduleConfidence),
      reasons: [
        {
          id: 'attention-schedule-reason',
          summary: runtime.scheduleIntelligence.criticalPathSummary,
          source: 'Schedule Intelligence',
        },
      ],
      recommendation: {
        label: 'Start Walk',
        nextStep: area
          ? `Start a Walk and capture current evidence for ${area}.`
          : 'Start a Walk and capture current schedule evidence.',
        userActionType: 'Capture',
      },
    });
  }

  if (missionBlocker) {
    items.push({
      id: 'attention-mission',
      whatMattersNow: missionBlocker.title,
      whyItMatters: missionBlocker.summary,
      priority: missionBlocker.priority === 'high' || missionBlocker.priority === 'critical' ? 'high' : 'medium',
      confidence: confidenceToScore(missionBlocker.confidence),
      reasons: [
        {
          id: 'attention-mission-reason',
          summary: missionBlocker.evidence[0] || missionBlocker.summary,
          source: 'Mission',
        },
      ],
      recommendation: {
        label: 'Review Blocker',
        nextStep: missionBlocker.suggestedAction,
        userActionType: 'Confirm',
      },
    });
  }

  if (reportNeedsReview) {
    items.push({
      id: 'attention-report',
      whatMattersNow: 'A project update is ready for review.',
      whyItMatters: `${runtime.response.reportActionItems.length} report action item${runtime.response.reportActionItems.length === 1 ? '' : 's'} may need approval before communication.`,
      priority: 'medium',
      confidence: runtime.response.reportReadiness === 'high' ? 88 : 68,
      reasons: [
        {
          id: 'attention-report-reason',
          summary: 'A report draft requires user review before copy or email.',
          source: 'Report Readiness',
        },
      ],
      recommendation: {
        label: 'Review Report',
        nextStep: 'Open Review and approve the prepared project update before communicating it.',
        userActionType: 'Approve',
      },
    });
  }

  if (photoNeedsReview) {
    items.push({
      id: 'attention-photo-progress',
      whatMattersNow: 'Photo progress needs verification.',
      whyItMatters: runtime.photoProgressSummary,
      priority: 'medium',
      confidence: confidenceToScore(runtime.comparisonConfidence),
      reasons: [
        {
          id: 'attention-photo-progress-reason',
          summary: 'A photo comparison should be accepted, edited, or rejected.',
          source: 'Photo Progress',
        },
      ],
      recommendation: {
        label: 'Verify Comparison',
        nextStep: 'Review the photo progress summary and confirm whether it is correct.',
        userActionType: 'Confirm',
      },
    });
  }

  if (gpsNeedsCorrection) {
    items.push({
      id: 'attention-gps-correction',
      whatMattersNow: 'Project location is uncertain.',
      whyItMatters:
        gpsWalkRecommendation?.detail ||
        'Location confidence is low, so project and area context should be corrected before capture.',
      priority: 'medium',
      confidence: gpsWalkRecommendation?.confidenceScore ?? 50,
      reasons: [
        {
          id: 'attention-gps-reason',
          summary: 'GPS Walk recommendation needs user correction.',
          source: 'GPS Walk Recommendation',
        },
      ],
      recommendation: {
        label: 'Correct Location',
        nextStep: 'Choose the correct project and area before continuing the Walk.',
        userActionType: 'Correct',
      },
    });
  }

  if (walkArea && !items.some(item => item.id === 'attention-schedule')) {
    items.push({
      id: 'attention-walk',
      whatMattersNow: `Your next Walk should start at ${walkArea}.`,
      whyItMatters: 'This area was selected from schedule, mission, and evidence signals.',
      priority: 'low',
      confidence: confidenceToScore(runtime.scheduleConfidence),
      reasons: [
        {
          id: 'attention-walk-reason',
          summary: 'Recommended Walk area is available from Runtime.',
          source: 'Runtime',
        },
      ],
      recommendation: {
        label: 'Start Walk',
        nextStep: `Start a Walk at ${walkArea}.`,
        userActionType: 'Capture',
      },
    });
  }

  if (evidenceGap) {
    items.push({
      id: 'attention-evidence-gap',
      whatMattersNow: evidenceGap.title,
      whyItMatters: evidenceGap.summary,
      priority: evidenceGap.severity === 'high' || evidenceGap.severity === 'critical'
        ? 'medium'
        : 'low',
      confidence: confidenceToScore(evidenceGap.confidence),
      reasons: [
        {
          id: 'attention-evidence-gap-reason',
          summary: evidenceGap.suggestedAction,
          source: 'Evidence Fusion',
        },
      ],
      recommendation: {
        label: 'Capture Evidence',
        nextStep: evidenceGap.suggestedAction,
        userActionType: 'Capture',
      },
    });
  }

  items.push({
    id: 'attention-briefing',
    whatMattersNow: runtime.currentMission.title,
    whyItMatters: runtime.currentMission.purpose,
    priority: 'low',
    confidence: confidenceToScore(runtime.currentMission.trust),
    reasons: [
      {
        id: 'attention-briefing-reason',
        summary: runtime.nextBestAction.why,
        source: 'Executive',
      },
    ],
    recommendation: {
      label: actionLabelForType(runtime.nextBestAction.userApprovalRequired ? 'Approve' : 'Confirm'),
      nextStep: runtime.nextBestAction.suggestedNextAction,
      userActionType: runtime.nextBestAction.userApprovalRequired
        ? 'Approve'
        : 'Confirm',
    },
  });

  return items;
}

function fallbackAttentionItem(): PIEAttentionItem {
  return {
    id: 'attention-fallback',
    whatMattersNow: 'Preparing today’s project priorities.',
    whyItMatters: 'More project evidence will improve the next recommended action.',
    priority: 'low',
    confidence: 50,
    reasons: [
      {
        id: 'attention-fallback-reason',
        summary: 'Runtime did not provide a stronger attention item.',
        source: 'Runtime',
      },
    ],
    recommendation: {
      label: 'Capture Update',
      nextStep: 'Capture a current project update.',
      userActionType: 'Capture',
    },
  };
}

function buildWalkAttentionItem(input: PIEWalkAttentionInput): PIEAttentionItem {
  const currentProject = input.projectName || input.recommendedProjectName;
  const currentArea = input.areaName || input.recommendedAreaName;
  const locationSummary = `${input.recommendedProjectName || currentProject} / ${input.recommendedAreaName || currentArea}`;

  if (input.needsUserSelection) {
    return {
      id: 'walk-confirm-location',
      stage: 'confirm_location',
      currentProject,
      currentArea,
      whatMattersNow: 'Project Walk location is uncertain.',
      whyItMatters: input.recommendationReason || 'Project and area should be corrected before capture.',
      priority: 'high',
      confidence: input.confidence,
      reasons: [
        {
          id: 'walk-confirm-location-reason',
          summary: input.recommendationReason || 'Location confidence is low.',
          source: 'GPS Walk Recommendation',
        },
      ],
      recommendation: {
        label: 'Change',
        nextStep: 'Choose the correct project or area before capturing evidence.',
        userActionType: 'Correct',
      },
    };
  }

  if (input.photoConfirmation && input.nextAreaName) {
    return {
      id: 'walk-continue-next-area',
      stage: 'continue_to_next_area',
      currentProject,
      currentArea,
      whatMattersNow: `Photo saved. Next, verify ${input.nextAreaName}.`,
      whyItMatters: input.nextAreaReason || 'Another area may need field evidence.',
      priority: 'medium',
      confidence: input.confidence,
      reasons: [
        {
          id: 'walk-next-area-reason',
          summary: input.nextAreaReason || 'Next recommended area is available.',
          source: 'Schedule Intelligence',
        },
      ],
      recommendation: {
        label: 'Continue',
        nextStep: `Continue the Walk at ${input.nextAreaName}.`,
        userActionType: 'Capture',
      },
    };
  }

  if (input.photoConfirmation || input.photoCount > 0) {
    return {
      id: 'walk-finish-or-note',
      stage: input.hasNote ? 'finish_walk' : 'add_note',
      currentProject,
      currentArea,
      whatMattersNow: input.photoConfirmation || 'Photo saved.',
      whyItMatters: input.hasNote
        ? 'Photo and note evidence is ready for review.'
        : 'A short note will help explain what changed.',
      priority: 'medium',
      confidence: input.confidence,
      reasons: [
        {
          id: 'walk-photo-saved-reason',
          summary: 'Photo capture keeps the user in Walk and prepares the next recommendation.',
          source: 'Photo Progress',
        },
      ],
      recommendation: {
        label: input.hasNote ? 'Finish Walk' : 'Add Note',
        nextStep: input.hasNote
          ? 'Review and save the Walk update.'
          : 'Add a short note, then finish the Walk update.',
        userActionType: input.hasNote ? 'Approve' : 'Capture',
      },
    };
  }

  const acceptedLocation =
    normalizeName(currentProject) === normalizeName(input.recommendedProjectName) &&
    normalizeName(currentArea) === normalizeName(input.recommendedAreaName);

  if (!acceptedLocation) {
    return {
      id: 'walk-recommend-project-area',
      stage: 'recommend_project_area',
      currentProject,
      currentArea,
      whatMattersNow: `Suggested location: ${locationSummary}.`,
      whyItMatters: input.recommendationReason,
      priority: 'medium',
      confidence: input.confidence,
      reasons: [
        {
          id: 'walk-recommend-project-area-reason',
          summary: input.recommendationReason,
          source: input.gpsUnavailable ? 'Runtime' : 'GPS Walk Recommendation',
        },
      ],
      recommendation: {
        label: 'Accept',
        nextStep: `Accept ${input.recommendedAreaName || input.recommendedProjectName}, then capture one progress photo.`,
        userActionType: 'Confirm',
      },
    };
  }

  return {
    id: 'walk-capture-photo',
    stage: 'capture_photo',
    currentProject,
    currentArea,
    whatMattersNow: `One progress photo is needed for ${currentArea || currentProject}.`,
    whyItMatters: input.recommendationReason || 'Current photo evidence will help explain progress.',
    priority: 'medium',
    confidence: input.confidence,
    reasons: [
      {
        id: 'walk-capture-photo-reason',
        summary: input.recommendationReason || 'Walk context has been confirmed.',
        source: 'GPS Walk Recommendation',
      },
    ],
    recommendation: {
      label: 'Take Photo',
      nextStep: `Capture current field evidence for ${currentArea || currentProject}.`,
      userActionType: 'Capture',
    },
  };
}

function actionLabelForType(actionType: PIEUserActionType) {
  if (actionType === 'Capture') return 'Start Walk';
  if (actionType === 'Correct') return 'Correct';
  if (actionType === 'Approve') return 'Review';
  if (actionType === 'Communicate') return 'Communicate';

  return 'Confirm';
}

function confidenceToScore(confidence: 'low' | 'medium' | 'high') {
  if (confidence === 'high') return 90;
  if (confidence === 'medium') return 70;

  return 45;
}

function normalizeName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}
