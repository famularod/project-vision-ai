import type {
  PIEAttentionState,
  PIEUserActionType,
} from './PIEAttentionEngine';
import type { PIEReportDraft } from './PIEReporter';
import type { PIEMemoryInfluence } from './PIEMemoryRecall';
import type { PIEDeliberationResult } from './PIEDeliberationEngine';
import type { PIEBelief, PIEBeliefReadiness } from './PIEBeliefEngine';
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

export type PIEExperienceState =
  | 'greeting'
  | 'mission'
  | 'collect_evidence'
  | 'confirm_location'
  | 'capture_photo'
  | 'capture_note'
  | 'verify_progress'
  | 'continue_walk'
  | 'finish_walk'
  | 'review_walk_update'
  | 'report_ready'
  | 'report_needs_review'
  | 'report_editing'
  | 'report_approved'
  | 'communicate_ready'
  | 'communication_complete'
  | 'thinking'
  | 'review'
  | 'communicate'
  | 'complete'
  | 'blocked';

export type PIEExperienceMode =
  | 'morning'
  | 'field_walk'
  | 'report_review'
  | 'schedule_review'
  | 'issue_review'
  | 'monitor';

export type PIEExperienceAction =
  | 'confirm'
  | 'capture'
  | 'correct'
  | 'approve'
  | 'communicate'
  | 'wait'
  | 'review';

export type PIEExperienceTransition = {
  from: PIEExperienceState;
  to: PIEExperienceState;
  reason: string;
};

export type PIEExperienceContext = {
  surface?: 'today' | 'walk' | 'review' | 'schedule' | 'project' | 'admin';
  hasRecentGreeting?: boolean;
  isWalkActive?: boolean;
  evidenceJustCaptured?: boolean;
  locationEvidenceNeeded?: boolean;
  communicationReady?: boolean;
  currentProject?: string | null;
  currentArea?: string | null;
  gpsRecommendation?: {
    projectName?: string | null;
    areaName?: string | null;
    confidence?: number | null;
    reason?: string | null;
    needsUserSelection?: boolean | null;
  } | null;
  schedulePriority?: string | null;
  missingEvidence?: string[];
  missingEvidenceResult?: PIEMissingEvidenceResult | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  photoProgressStatus?: string | null;
  lastCapturedPhoto?: string | null;
  photoCount?: number;
  hasNote?: boolean;
  walkCompletionState?: 'active' | 'ready_to_finish' | 'complete';
  nextWalkArea?: string | null;
  nextWalkAreaReason?: string | null;
  reportDraft?: PIEReportDraft | null;
  reportEditing?: boolean;
  reportApproved?: boolean;
  communicationComplete?: boolean;
  combinedUpdateSelectedItems?: number;
  scheduleImportStatus?: string | null;
  memoryInfluences?: PIEMemoryInfluence[];
  deliberation?: PIEDeliberationResult | null;
  beliefsNeedingVerification?: PIEBelief[];
  beliefReadiness?: PIEBeliefReadiness | null;
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
  enforceAuthoritativeInputs?: boolean;
  decisionMemory?: PIEDecisionMemoryResult | null;
  executiveReasoning?: PIEExecutiveReasoningResult | null;
  highestValueAction?: string | null;
  bestNextStep?: string | null;
  recommendationWhy?: string | null;
  predictions?: PIEPredictionResult | null;
  predictiveReality?: PIEPredictiveRealityResult | null;
};

export type PIEExperienceOutput = {
  currentState: PIEExperienceState;
  mode: PIEExperienceMode;
  primaryMessage: string;
  reason: string;
  primaryAction: PIEExperienceAction;
  secondaryAction: PIEExperienceAction | null;
  nextState: PIEExperienceState;
  confidence: number;
  needsUserInput: boolean;
  userActionType: PIEExperienceAction;
  currentProject: string | null;
  currentArea: string | null;
  reportTitle: string | null;
  reportReadiness: string | null;
  reviewWarnings: string[];
  transition: PIEExperienceTransition;
};

export type PIEExperienceInput = {
  runtime: PIERuntimeState;
  attentionState: PIEAttentionState;
  context?: PIEExperienceContext;
};

export type PIEWalkExperienceInput = {
  attentionState: PIEAttentionState;
  context: PIEExperienceContext;
};

export function buildPIEExperience(
  input: PIEExperienceInput,
): PIEExperienceOutput {
  if (input.context?.enforceAuthoritativeInputs && (!input.context.realityModel || !input.context.executiveJudgment)) {
    throw new Error('Experience requires authoritative Reality Model and Executive Judgment in live mode.');
  }
  const currentState = getExperienceState(input);
  const mode = getExperienceMode(input);
  const primaryAction = getPrimaryAction(input, currentState);
  const nextState = getNextExperienceState(input, currentState);

  return {
    currentState,
    mode,
    primaryMessage: getPrimaryMessage(input, currentState),
    reason: getExperienceReason(input, currentState),
    primaryAction,
    secondaryAction: getSecondaryAction(input, currentState),
    nextState,
    confidence: normalizeConfidence(input.attentionState.confidence),
    needsUserInput: needsUserInput(currentState, primaryAction),
    userActionType: primaryAction,
    currentProject:
      input.context?.currentProject ||
      input.attentionState.currentProject ||
      input.runtime.projectName ||
      null,
    currentArea:
      input.context?.currentArea ||
      input.attentionState.currentArea ||
      input.runtime.recommendedWalkAreas[0] ||
      null,
    reportTitle: input.context?.reportDraft?.title || null,
    reportReadiness: input.context?.reportDraft?.reportReadiness || null,
    reviewWarnings: buildReviewWarnings(input.context?.reportDraft),
    transition: getExperienceTransition(currentState, nextState, input),
  };
}

export function buildPIEWalkExperience(
  input: PIEWalkExperienceInput,
): PIEExperienceOutput {
  const context = {
    ...input.context,
    surface: 'walk' as const,
    isWalkActive: true,
  };
  const currentState = getWalkExperienceState({
    attentionState: input.attentionState,
    context,
  });
  const primaryAction = getWalkPrimaryAction(input, currentState);
  const nextState = getNextWalkExperienceState({ ...input, context }, currentState);

  return {
    currentState,
    mode: 'field_walk',
    primaryMessage: getWalkPrimaryMessage({ ...input, context }, currentState),
    reason: getWalkReason({ ...input, context }, currentState),
    primaryAction,
    secondaryAction: getWalkSecondaryAction(currentState),
    nextState,
    confidence: normalizeConfidence(input.attentionState.confidence),
    needsUserInput: needsUserInput(currentState, primaryAction),
    userActionType: primaryAction,
    currentProject:
      context.currentProject ||
      context.gpsRecommendation?.projectName ||
      input.attentionState.currentProject ||
      null,
    currentArea:
      context.currentArea ||
      context.gpsRecommendation?.areaName ||
      input.attentionState.currentArea ||
      null,
    reportTitle: null,
    reportReadiness: null,
    reviewWarnings: [],
    transition: {
      from: currentState,
      to: nextState,
      reason: `${currentState} advances to ${nextState} based on GPS recommendation, current project, current area, schedule priority, missing evidence, photo progress status, last captured photo, walk completion state, and Attention output.`,
    },
  };
}

export function buildPIEReviewExperience(
  input: PIEExperienceInput,
): PIEExperienceOutput {
  return buildPIEExperience({
    ...input,
    context: {
      ...input.context,
      surface: 'review',
    },
  });
}

export function getExperienceState({
  runtime,
  attentionState,
  context,
}: PIEExperienceInput): PIEExperienceState {
  const missionNotStarted =
    runtime.currentMission.status === 'not-started' ||
    runtime.missionProgress.score === 0;
  const evidenceNeeded =
    Boolean(context?.isWalkActive) ||
    Boolean(context?.locationEvidenceNeeded) ||
    attentionState.userActionType === 'Capture' ||
    runtime.recommendedEvidence.length > 0 ||
    runtime.currentMission.evidenceStillNeeded.length > 0 ||
    runtime.recommendedWalkAreas.length > 0 ||
    Boolean(context?.missingEvidenceResult?.highestImpactEvidenceGap);
  const lowConfidence =
    attentionState.confidence < 45 ||
    runtime.overallConfidence === 'low' ||
    runtime.beliefChanges.some(change => change.direction === 'weakened') ||
    runtime.evidenceGaps.some(gap => gap.severity === 'critical') ||
    Boolean(context?.missingEvidenceResult?.prioritizedItems.some(item =>
      item.priority === 'critical' || item.priority === 'high',
    )) ||
    Boolean(context?.memoryInfluences?.some(influence =>
      influence.appliesTo === 'experience' &&
      /lower confidence|verify|corrected/i.test(`${influence.summary} ${influence.influence}`),
    )) ||
    Boolean(context?.beliefsNeedingVerification?.length) ||
    context?.beliefReadiness === 'Blocked' ||
    context?.beliefReadiness === 'Uncertain' ||
    context?.executiveReasoning?.executiveReadiness === 'Blocked' ||
    context?.executiveReasoning?.executiveReadiness === 'Uncertain' ||
    context?.predictions?.predictionConfidence === 'low' ||
    context?.predictiveReality?.confidence === 'low' ||
    Boolean(context?.predictiveReality?.risks.some(risk =>
      risk.severity === 'critical' || risk.severity === 'high',
    )) ||
    context?.executiveJudgment?.executiveReadiness === 'Blocked' ||
    context?.executiveJudgment?.executiveReadiness === 'Uncertain' ||
    Boolean(context?.realityModel?.objects.some(object =>
      object.currentStatus === 'blocked' ||
      object.currentStatus === 'needs_verification',
    )) ||
    Boolean(context?.situationIntelligence?.situationState === 'blocked' ||
      context?.situationIntelligence?.situationState === 'needs_verification' ||
      context?.situationIntelligence?.situationState === 'uncertain') ||
    context?.deliberation?.recommendationReadiness === 'Blocked' ||
    context?.deliberation?.recommendationReadiness === 'Uncertain';
  const reportReady =
    runtime.summary.reportReadiness === 'high' ||
    runtime.summary.reportNeedsReview;
  const communicationReady =
    Boolean(context?.communicationReady) ||
    runtime.intelligence.communicationReadiness.level === 'ready';

  if (context?.surface === 'walk' || context?.isWalkActive) {
    return getWalkExperienceState({ attentionState, context });
  }

  if (context?.surface === 'review') {
    return getReviewExperienceState({ runtime, context });
  }

  if (context?.hasRecentGreeting === false) return 'greeting';
  if (missionNotStarted) return 'mission';
  if (evidenceNeeded) return 'collect_evidence';
  if (context?.evidenceJustCaptured) return 'thinking';
  if (reportReady) return 'review';
  if (context?.reportApproved && communicationReady) return 'communicate';
  if (runtime.missionComplete) return 'complete';
  if (lowConfidence) return 'blocked';

  return 'mission';
}

export function getExperienceMode({
  runtime,
  context,
}: PIEExperienceInput): PIEExperienceMode {
  if (context?.isWalkActive || runtime.surface === 'project-walk') {
    return 'field_walk';
  }

  if (context?.surface === 'review' || runtime.response.reportNeedsReview) {
    return 'report_review';
  }

  if (
    context?.surface === 'schedule' ||
    runtime.overdueTasks.length > 0 ||
    runtime.upcomingTasks.length > 0
  ) {
    return 'schedule_review';
  }

  if (
    runtime.executiveEscalations.length > 0 ||
    runtime.missionBlockers.length > 0
  ) {
    return 'issue_review';
  }

  if (context?.surface === 'today' || runtime.surface === 'home') {
    return 'morning';
  }

  return 'monitor';
}

export function getPrimaryMessage(
  { runtime, attentionState, context }: PIEExperienceInput,
  state: PIEExperienceState,
): string {
  if (isWalkState(state)) {
    return getWalkPrimaryMessage({ attentionState, context }, state);
  }

  if (isReviewState(state)) {
    return getReviewPrimaryMessage({ runtime, context }, state);
  }

  if (state === 'greeting') return 'Good morning. DAVE is ready to focus the day.';
  if (state === 'mission') return `Current mission: ${runtime.currentMission.title}.`;
  if (state === 'collect_evidence') {
    if (context?.decisionMemory?.whenNotToActReasons[0]) {
      return context.decisionMemory.whenNotToActReasons[0].recommendedAlternative;
    }

    if (context?.executiveJudgment?.waitForEvidenceReasoning.shouldWaitForEvidence) {
      return context.executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest;
    }

    if (context?.bestNextStep) {
      return context.bestNextStep;
    }

    if (context?.executiveJudgment?.highestValueAction) {
      return context.executiveJudgment.highestValueAction.action;
    }

    if (context?.predictiveReality?.opportunities[0]) {
      return context.predictiveReality.opportunities[0].recoveryAction;
    }

    if (context?.situationIntelligence?.situationPriorities[0]) {
      return context.situationIntelligence.situationPriorities[0].action;
    }

    if (context?.missingEvidenceResult?.highestImpactEvidenceGap) {
      return context.missingEvidenceResult.highestImpactEvidenceGap.smallestEvidenceRequest;
    }

    const urgentPrediction = context?.predictions?.cascadingImpacts.find(impact =>
      impact.severity === 'high',
    );
    if (urgentPrediction && context?.predictions?.predictionConfidence !== 'low') {
      return urgentPrediction.summary;
    }

    return context?.highestValueAction ||
      context?.executiveReasoning?.highestValueAction?.action ||
      attentionState.whatMattersNow;
  }
  if (state === 'blocked' && context?.executiveReasoning?.biggestRisk) {
    return `DAVE needs to verify executive risk: ${context.executiveReasoning.biggestRisk.risk}.`;
  }
  if (state === 'blocked' && context?.decisionMemory?.whenNotToActReasons[0]) {
    return context.decisionMemory.whenNotToActReasons[0].recommendedAlternative;
  }
  if (state === 'blocked' && context?.executiveJudgment?.waitForEvidenceReasoning.shouldWaitForEvidence) {
    return context.executiveJudgment.waitForEvidenceReasoning.smallestEvidenceRequest;
  }
  if (state === 'blocked' && context?.bestNextStep) {
    return context.bestNextStep;
  }
  if (state === 'blocked' && context?.executiveJudgment?.highestValueAction) {
    return context.executiveJudgment.highestValueAction.governance.whatWouldChangeRecommendation[0] ||
      context.executiveJudgment.highestValueAction.action;
  }
  if (state === 'blocked' && context?.predictiveReality?.risks[0]) {
    return context.predictiveReality.risks[0].verificationNeeded;
  }
  if (state === 'blocked' && context?.situationIntelligence?.situationSummary) {
    return context.situationIntelligence.situationSummary.whatNeedsVerification;
  }
  if (state === 'blocked' && context?.missingEvidenceResult?.highestImpactEvidenceGap) {
    return context.missingEvidenceResult.highestImpactEvidenceGap.smallestEvidenceRequest;
  }
  if (state === 'blocked' && context?.realityModel?.objects[0]) {
    return context.objectIntelligence?.objectNextBestActions[0]?.action ||
      `DAVE needs to verify: ${context.realityModel.objects[0].name}.`;
  }
  if (state === 'blocked' && context?.beliefsNeedingVerification?.[0]) {
    return `DAVE needs to verify: ${context.beliefsNeedingVerification[0].statement}.`;
  }
  if (state === 'thinking') return 'DAVE is processing the new evidence.';
  if (state === 'review') return 'A project update is ready for review.';
  if (state === 'communicate') return 'The approved update is ready to communicate.';
  if (state === 'complete') return 'The current mission is complete.';

  return 'DAVE needs one correction before moving forward.';
}

export function getExperienceReason(
  { runtime, attentionState, context }: PIEExperienceInput,
  state: PIEExperienceState,
): string {
  if (isWalkState(state)) {
    return getWalkReason({ attentionState, context }, state);
  }

  if (isReviewState(state)) {
    return getReviewReason({ runtime, context }, state);
  }

  if (state === 'blocked' && context?.beliefsNeedingVerification?.[0]) {
    return context.beliefsNeedingVerification[0].explanation.readinessReason;
  }

  if (state === 'greeting') {
    return 'Experience starts by orienting the user before showing details.';
  }

  if (state === 'mission') return runtime.currentMission.purpose;

  if (state === 'collect_evidence') {
    if (context?.decisionMemory?.whenNotToActReasons[0]) {
      return context.decisionMemory.whenNotToActReasons[0].explanation;
    }

    if (context?.executiveJudgment?.waitForEvidenceReasoning.shouldWaitForEvidence) {
      return context.executiveJudgment.waitForEvidenceReasoning.reason;
    }

    if (context?.executiveJudgment?.highestValueAction) {
      return context.executiveJudgment.highestValueAction.governance.why;
    }

    if (context?.predictiveReality?.risks[0]) {
      return context.predictiveReality.noActionForecast.summary;
    }

    if (context?.situationIntelligence?.situationSummary) {
      return context.situationIntelligence.situationSummary.whatMattersNow;
    }

    if (context?.missingEvidenceResult?.highestImpactEvidenceGap) {
      return context.missingEvidenceResult.highestImpactEvidenceGap.whyItMatters;
    }

    const urgentPrediction = context?.predictions?.cascadingImpacts.find(impact =>
      impact.severity === 'high',
    );
    if (urgentPrediction && context?.predictions && context.predictions.predictionConfidence !== 'low') {
      return `Predictive Simulation: ${context.predictions.noActionOutcome.likelyOutcome}`;
    }

    if (context?.executiveReasoning?.highestValueAction) {
      return `Executive Reasoning: ${context.executiveReasoning.highestValueAction.whyRecommended}`;
    }

    if (context?.deliberation) {
      const alternative = context.deliberation.alternativesConsidered[1]?.action;
      return alternative
        ? `${context.deliberation.explanation} DAVE considered ${alternative}, but selected this action based on readiness and trade-offs.`
        : context.deliberation.explanation;
    }

    const memoryInfluence = context?.memoryInfluences?.find(influence =>
      influence.appliesTo === 'experience' || influence.appliesTo === 'attention',
    );
    if (memoryInfluence) {
      return `Memory Recall: ${memoryInfluence.influence}`;
    }

    if (runtime.recommendedEvidence[0]) {
      return `Reflection recommends collecting: ${runtime.recommendedEvidence[0]}`;
    }

    return attentionState.whyItMatters;
  }

  if (state === 'thinking') {
    return 'Fresh evidence should be fused into Runtime before DAVE asks for the next decision.';
  }

  if (state === 'review') {
    return runtime.response.reportNeedsReview
      ? 'DAVE has report material that needs user review before communication.'
      : 'Reporter readiness indicates the draft can be reviewed.';
  }

  if (state === 'communicate') {
    return 'The user has approved the report and communication is ready.';
  }

  if (state === 'complete') {
    return runtime.missionSummary.overallPurpose;
  }

  return context?.deliberation?.whatWouldChangeRecommendation[0] ||
    context?.missingEvidenceResult?.highestImpactEvidenceGap?.whyItMatters ||
    context?.executiveJudgment?.executiveJudgmentSummary ||
    context?.predictiveReality?.explanation ||
    context?.situationIntelligence?.explanation ||
    context?.objectIntelligence?.summary ||
    context?.realityModel?.objects.find(object => object.currentStatus === 'blocked' || object.currentStatus === 'needs_verification')?.currentState.summary ||
    context?.executiveReasoning?.judgment.verifyBeforeActing ||
    context?.memoryInfluences?.find(influence => influence.appliesTo === 'experience')?.influence ||
    runtime.beliefChanges.find(change => change.direction === 'weakened')?.reason ||
    runtime.evidenceGaps[0]?.summary ||
    runtime.missionBlockers[0]?.summary ||
    'Confidence is too low or required evidence is missing.';
}

export function getPrimaryAction(
  input: PIEExperienceInput,
  state: PIEExperienceState,
): PIEExperienceAction {
  if (isWalkState(state)) {
    return getWalkPrimaryAction(input, state);
  }

  if (isReviewState(state)) {
    return getReviewPrimaryAction(input, state);
  }

  if (state === 'greeting') return 'confirm';
  if (state === 'mission') return 'confirm';
  if (state === 'thinking') return 'wait';
  if (state === 'review') return 'review';
  if (state === 'communicate') return 'communicate';
  if (state === 'complete') return 'confirm';
  if (state === 'blocked') return 'correct';

  return mapAttentionAction(input.attentionState.userActionType);
}

export function getSecondaryAction(
  _input: PIEExperienceInput,
  state: PIEExperienceState,
): PIEExperienceAction | null {
  if (isWalkState(state)) {
    return getWalkSecondaryAction(state);
  }

  if (isReviewState(state)) {
    return getReviewSecondaryAction(state);
  }

  if (state === 'collect_evidence') return 'correct';
  if (state === 'review') return 'correct';
  if (state === 'blocked') return 'review';

  return null;
}

export function getNextExperienceState(
  input: PIEExperienceInput,
  state: PIEExperienceState,
): PIEExperienceState {
  if (isWalkState(state)) {
    return getNextWalkExperienceState(input, state);
  }

  if (isReviewState(state)) {
    return getNextReviewExperienceState(input, state);
  }

  if (state === 'greeting') return 'mission';
  if (state === 'mission') return 'collect_evidence';
  if (state === 'collect_evidence') return 'thinking';
  if (state === 'thinking') return 'review';
  if (state === 'review') {
    return input.context?.reportApproved ? 'communicate' : 'review';
  }
  if (state === 'communicate') return 'complete';
  if (state === 'blocked') return 'collect_evidence';

  return 'complete';
}

function getWalkExperienceState({
  attentionState,
  context,
}: Pick<PIEExperienceInput, 'attentionState' | 'context'>): PIEExperienceState {
  const gpsConfidence = context?.gpsRecommendation?.confidence ?? attentionState.confidence;
  const needsLocationCorrection =
    Boolean(context?.gpsRecommendation?.needsUserSelection) ||
    gpsConfidence < 60 ||
    attentionState.stage === 'recommend_project_area' ||
    attentionState.stage === 'confirm_location';
  const photoCount = context?.photoCount ?? 0;
  const hasNote = Boolean(context?.hasNote);
  const photoSaved = Boolean(context?.lastCapturedPhoto);
  const readyToFinish = context?.walkCompletionState === 'ready_to_finish';

  if (needsLocationCorrection) return 'confirm_location';
  if (photoSaved && attentionState.stage === 'verify_progress') {
    return 'verify_progress';
  }
  if (photoSaved && context?.nextWalkArea) return 'continue_walk';
  if (photoSaved && !hasNote) return 'capture_note';
  if (readyToFinish || attentionState.stage === 'finish_walk') {
    return 'finish_walk';
  }
  if (context?.walkCompletionState === 'complete') return 'review_walk_update';
  if (
    photoCount === 0 ||
    attentionState.stage === 'capture_photo' ||
    (context?.missingEvidence || []).some(item => /photo|evidence/i.test(item))
  ) {
    return 'capture_photo';
  }

  return 'review_walk_update';
}

function getWalkPrimaryMessage(
  { attentionState, context }: Pick<PIEExperienceInput, 'attentionState' | 'context'>,
  state: PIEExperienceState,
) {
  const project =
    context?.gpsRecommendation?.projectName ||
    context?.currentProject ||
    attentionState.currentProject ||
    'the current project';
  const area =
    context?.gpsRecommendation?.areaName ||
    context?.currentArea ||
    attentionState.currentArea ||
    'the current area';

  if (state === 'confirm_location') {
    return `DAVE believes you are at ${project} / ${area}.`;
  }

  if (state === 'capture_photo') {
    return `DAVE needs one progress photo for ${area}.`;
  }

  if (state === 'capture_note') {
    return `Photo saved. Add one note for ${area}.`;
  }

  if (state === 'verify_progress') {
    return `Photo saved. Next, verify progress at ${area}.`;
  }

  if (state === 'continue_walk') {
    return context?.nextWalkArea
      ? `Photo saved. Next, verify ${context.nextWalkArea}.`
      : 'Photo saved. Continue to the next walk area.';
  }

  if (state === 'finish_walk') {
    return 'Evidence captured. Finish the Walk update.';
  }

  return 'Review the Walk update before saving.';
}

function getWalkReason(
  { attentionState, context }: Pick<PIEExperienceInput, 'attentionState' | 'context'>,
  state: PIEExperienceState,
) {
  if (state === 'confirm_location') {
    return context?.gpsRecommendation?.reason ||
      attentionState.whyItMatters ||
      'GPS recommendation needs user confirmation before evidence is filed.';
  }

  if (state === 'capture_photo') {
    return context?.schedulePriority ||
      context?.missingEvidence?.[0] ||
      attentionState.whyItMatters;
  }

  if (state === 'capture_note') {
    return 'A short note helps DAVE connect the photo to progress, issues, safety, and next actions.';
  }

  if (state === 'verify_progress') {
    return context?.photoProgressStatus ||
      'DAVE needs the user to verify what changed before it treats the photo as project evidence.';
  }

  if (state === 'continue_walk') {
    return context?.nextWalkAreaReason ||
      'Schedule priority or missing evidence suggests another area should be checked.';
  }

  if (state === 'finish_walk') {
    return 'DAVE has enough Walk evidence to prepare the update for review.';
  }

  return 'The Walk update should be reviewed before it becomes saved project evidence.';
}

function getWalkPrimaryAction(
  _input: Pick<PIEExperienceInput, 'attentionState' | 'context'>,
  state: PIEExperienceState,
): PIEExperienceAction {
  if (state === 'confirm_location') return 'confirm';
  if (state === 'capture_photo') return 'capture';
  if (state === 'capture_note') return 'review';
  if (state === 'verify_progress') return 'capture';
  if (state === 'continue_walk') return 'capture';
  if (state === 'finish_walk') return 'review';
  if (state === 'review_walk_update') return 'review';

  return 'confirm';
}

function getWalkSecondaryAction(
  state: PIEExperienceState,
): PIEExperienceAction | null {
  if (state === 'confirm_location') return 'correct';
  if (state === 'capture_photo') return 'correct';
  if (state === 'capture_note') return 'capture';
  if (state === 'verify_progress') return 'review';
  if (state === 'continue_walk') return 'review';
  if (state === 'finish_walk') return 'capture';

  return null;
}

function getNextWalkExperienceState(
  input: Pick<PIEExperienceInput, 'attentionState' | 'context'>,
  state: PIEExperienceState,
): PIEExperienceState {
  if (state === 'confirm_location') return 'capture_photo';
  if (state === 'capture_photo') return 'verify_progress';
  if (state === 'capture_note') return 'finish_walk';
  if (state === 'verify_progress') {
    return input.context?.nextWalkArea ? 'continue_walk' : 'finish_walk';
  }
  if (state === 'continue_walk') return 'capture_photo';
  if (state === 'finish_walk') return 'review_walk_update';

  return 'complete';
}

function isWalkState(state: PIEExperienceState) {
  return [
    'confirm_location',
    'capture_photo',
    'capture_note',
    'verify_progress',
    'continue_walk',
    'finish_walk',
    'review_walk_update',
  ].includes(state);
}

function getReviewExperienceState({
  runtime,
  context,
}: Pick<PIEExperienceInput, 'runtime' | 'context'>): PIEExperienceState {
  const report = context?.reportDraft;
  const warnings = buildReviewWarnings(report);
  const hasActionItems = (report?.actionItems.length || 0) > 0;
  const hasImageReferences = (report?.imageReferences.length || 0) > 0;
  const missingEvidence =
    runtime.evidenceGaps.length > 0 ||
    (context?.scheduleImportStatus || '').toLowerCase().includes('review') ||
    (context?.photoProgressStatus || '').toLowerCase().includes('review') ||
    (context?.combinedUpdateSelectedItems ?? 1) === 0;
  const lowConfidence =
    report?.confidence === 'low' ||
    runtime.overallConfidence === 'low' ||
    warnings.length > 0 ||
    missingEvidence;

  if (context?.communicationComplete) return 'communication_complete';
  if (context?.reportApproved && context?.communicationReady) {
    return 'communicate_ready';
  }
  if (context?.reportApproved) return 'report_approved';
  if (context?.reportEditing) return 'report_editing';
  if (!report) return 'review';
  if (report.needsReview || lowConfidence) return 'report_needs_review';
  if (report.reportReadiness === 'high' || hasActionItems || hasImageReferences) {
    return 'report_ready';
  }

  return 'report_needs_review';
}

function getReviewPrimaryMessage(
  { context }: Pick<PIEExperienceInput, 'runtime' | 'context'>,
  state: PIEExperienceState,
) {
  if (state === 'report_ready') return "DAVE prepared today's project update.";
  if (state === 'report_needs_review') {
    const count = buildReviewWarnings(context?.reportDraft).length || 1;
    return `${count} item${count === 1 ? '' : 's'} need review before this report is ready.`;
  }
  if (state === 'report_editing') return 'Edit the report before approval.';
  if (state === 'report_approved') return 'Report approved.';
  if (state === 'communicate_ready') return 'Report is ready to send.';
  if (state === 'communication_complete') return 'Communication complete.';

  return 'Generate a DAVE project update for review.';
}

function getReviewReason(
  { runtime, context }: Pick<PIEExperienceInput, 'runtime' | 'context'>,
  state: PIEExperienceState,
) {
  const report = context?.reportDraft;
  const warning = buildReviewWarnings(report)[0];

  if (state === 'report_ready') {
    return `${report?.title || 'The report draft'} is ready for user approval before copy or email.`;
  }
  if (state === 'report_needs_review') {
    return warning ||
      runtime.evidenceGaps[0]?.summary ||
      'DAVE found items that need review before communication, including possible schedule or photo progress context.';
  }
  if (state === 'report_editing') {
    return 'User edits should happen before approval so final communication stays intentional.';
  }
  if (state === 'report_approved') {
    return 'Approval is recorded for this review session; copy and email can now be used.';
  }
  if (state === 'communicate_ready') {
    return 'No automatic sending occurs. The user chooses Copy Report or opens the mail composer.';
  }
  if (state === 'communication_complete') {
    return 'The user completed the communication step.';
  }

  return 'Review is an approval state, not a report menu.';
}

function getReviewPrimaryAction(
  _input: PIEExperienceInput,
  state: PIEExperienceState,
): PIEExperienceAction {
  if (state === 'report_ready') return 'approve';
  if (state === 'report_needs_review') return 'review';
  if (state === 'report_editing') return 'approve';
  if (state === 'report_approved') return 'communicate';
  if (state === 'communicate_ready') return 'communicate';
  if (state === 'communication_complete') return 'confirm';

  return 'review';
}

function getReviewSecondaryAction(
  state: PIEExperienceState,
): PIEExperienceAction | null {
  if (state === 'report_ready') return 'correct';
  if (state === 'report_needs_review') return 'correct';
  if (state === 'report_editing') return 'review';
  if (state === 'report_approved') return 'review';
  if (state === 'communicate_ready') return 'review';

  return null;
}

function getNextReviewExperienceState(
  _input: PIEExperienceInput,
  state: PIEExperienceState,
): PIEExperienceState {
  if (state === 'review') return 'report_ready';
  if (state === 'report_ready') return 'report_approved';
  if (state === 'report_needs_review') return 'report_editing';
  if (state === 'report_editing') return 'report_approved';
  if (state === 'report_approved') return 'communicate_ready';
  if (state === 'communicate_ready') return 'communication_complete';

  return 'complete';
}

function isReviewState(state: PIEExperienceState) {
  return [
    'report_ready',
    'report_needs_review',
    'report_editing',
    'report_approved',
    'communicate_ready',
    'communication_complete',
  ].includes(state);
}

function buildReviewWarnings(report?: PIEReportDraft | null): string[] {
  if (!report) return [];

  const warnings = report.reviewFlags.map(flag =>
    normalizeReviewWarning(flag),
  );

  if (report.actionItems.some(item => item.needsOwner)) {
    warnings.push('missing owner');
  }

  if (report.imageReferences.length === 0) {
    warnings.push('missing supporting photos');
  }

  return Array.from(new Set(warnings)).slice(0, 6);
}

function normalizeReviewWarning(flag: string) {
  const normalized = flag.toLowerCase();

  if (/area|location|work area/.test(normalized)) return 'unclear work area';
  if (/owner|assigned/.test(normalized)) return 'missing owner';
  if (/schedule|date|impact/.test(normalized)) {
    return 'uncertain schedule impact';
  }
  if (/photo|image|supporting/.test(normalized)) {
    return 'missing supporting photos';
  }

  return flag;
}

export function getExperienceTransition(
  from: PIEExperienceState,
  to: PIEExperienceState,
  input: PIEExperienceInput,
): PIEExperienceTransition {
  return {
    from,
    to,
    reason: `${from} advances to ${to} based on Runtime, Mission, Executive, Schedule Intelligence, Evidence Fusion, Photo Progress, GPS Walk recommendation, Reporter readiness, and Attention output. Primary attention: ${input.attentionState.whatMattersNow}`,
  };
}

function mapAttentionAction(action: PIEUserActionType): PIEExperienceAction {
  if (action === 'Capture') return 'capture';
  if (action === 'Correct') return 'correct';
  if (action === 'Approve') return 'approve';
  if (action === 'Communicate') return 'communicate';

  return 'confirm';
}

function needsUserInput(
  state: PIEExperienceState,
  action: PIEExperienceAction,
) {
  return state !== 'thinking' && action !== 'wait';
}

function normalizeConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
