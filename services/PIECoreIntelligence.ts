import {
  buildPIEAttentionState,
  type PIEAttentionState,
} from './PIEAttentionEngine';
import {
  evaluateEvidenceQuality,
  type PIEEvidenceQualityInput,
  type PIEEvidenceQualityItem,
  type PIEEvidenceQualityLevel,
  type PIEEvidenceQualityResult,
  type PIEEvidenceConflict as PIEQualityEvidenceConflict,
} from './PIEEvidenceQuality';
import {
  findMissingEvidence,
  type PIEMissingEvidenceInput,
  type PIEMissingEvidenceItem,
  type PIEMissingEvidenceRequest,
  type PIEMissingEvidenceResult,
} from './PIEMissingEvidence';
import {
  buildEvidenceTimeline,
  type PIEEvidenceTimeline,
  type PIEEvidenceTimelineChange,
  type PIEEvidenceTimelineEvent,
  type PIEEvidenceTimelineGap,
  type PIEEvidenceTimelineMomentum,
} from './PIEEvidenceTimeline';
import {
  buildPIERealityModel,
  type PIERealityModel,
  type PIERealityModelSummary,
  type PIERealityNextAction,
  type PIERealityObject,
  type PIERealityObjectIntelligenceResult,
  type PIERealitySourceObject,
} from './PIERealityModel';
import {
  buildQualifiedRealityEvidence,
  type PIERealityModelSynchronizationResult,
} from './PIERealityModelSynchronization';
import {
  buildPIESituation,
  type PIESituation,
  type PIESituationBlocker,
  type PIESituationChange,
  type PIESituationIntent,
  type PIESituationOpportunity,
  type PIESituationPriority,
  type PIESituationResult,
  type PIESituationRisk,
  type PIESituationState,
  type PIESituationSummary,
  type PIESituationUnknown,
} from './PIESituationIntelligence';
import {
  runECOSCognitiveFramework,
  type ECOSCognitiveOutput,
} from './ECOSCognitiveFramework';
import {
  buildPIEDomainMappingResult,
  buildPIEDomainInput,
  mapECOSToPIEIntelligence,
  type PIEProjectIntelligenceOutput,
} from './PIEDomainAdapter';
import {
  buildPIEExperience,
  type PIEExperienceOutput,
} from './PIEExperienceEngine';
import {
  buildPIEReportDraft,
  buildPIEReportDraftFromExecutiveJudgment,
  type PIEReportDraft,
  type PIEReportType,
} from './PIEReporter';
import {
  buildPIEMemoryRecall,
  type PIEMemoryInfluence,
  type PIEMemoryRecallInput,
  type PIEMemoryRecallResult,
  type PIEMemoryPattern,
  type PIERelevantMemory,
} from './PIEMemoryRecall';
import {
  buildPIELearning,
  type PIELearningConfidenceCalibration,
  type PIELearningDecisionQuality,
  type PIELearningMemoryConsolidation,
  type PIELearningResult,
  type PIELearningSignal as PIELearningEngineSignal,
  type PIEVerifiedLearningEvent,
} from './PIELearningEngine';
import {
  buildPIEDeliberation,
  type PIEDeliberationAlternative,
  type PIEDeliberationAssumption,
  type PIEDeliberationResult,
  type PIEDeliberationTradeoff,
} from './PIEDeliberationEngine';
import {
  buildPIEPatternIntelligence,
  type PIEPatternConfidence,
  type PIEPatternIntelligence,
  type PIEPatternMatch,
  type PIEPatternRecommendation,
  type PIEPatternWarning,
  type PIEPattern,
} from './PIEPatternEngine';
import {
  runPIEScientificMethod,
  type PIEScientificChallenge,
  type PIEScientificHypothesis,
  type PIEScientificResult,
  type PIEUncertainty,
  type PIEUncertaintyReductionAction,
  type PIEDecisionQualityScore,
} from './PIEScientificMethod';
import {
  buildPIEBeliefs,
  type PIEBelief as PIEEngineBelief,
  type PIEBeliefChange as PIEEngineBeliefChange,
  type PIEBeliefExplanation,
  type PIEBeliefReadiness,
  type PIEBeliefEngineResult,
} from './PIEBeliefEngine';
import {
  buildPIEExecutiveReasoning,
  type PIEExecutiveAction,
  type PIEExecutiveBriefingPoint,
  type PIEExecutivePriority,
  type PIEExecutiveReadiness,
  type PIEExecutiveReasoningResult,
  type PIEExecutiveRisk,
} from './PIEExecutiveReasoning';
import {
  buildPIEPredictions,
  type PIEPredictionImpact,
  type PIEPredictionOutcome,
  type PIEPredictionRecoveryAction,
  type PIEPredictionResult,
} from './PIEPredictiveEngine';
import {
  buildPIEPredictiveReality,
  type PIECascadingEffect,
  type PIEFutureObjectState,
  type PIEPredictiveReality,
  type PIEPredictiveRealityOpportunity,
  type PIEPredictiveRealityResult,
  type PIEReadinessForecast,
} from './PIEPredictiveReality';
import {
  buildPIEPhotoProgressIntelligence,
  type PIEPhotoProgressIntelligenceResult,
} from './PIEPhotoProgressIntelligence';
import {
  buildPIEDecisionSimulation,
  type PIEDecisionSimulationResult,
} from './PIEDecisionSimulation';
import {
  challengePIERecommendation,
  type PIERecommendationChallengeResult,
} from './PIERecommendationChallenge';
import {
  validatePIEReasoningWithJARVIS,
  type PIEJarvisReasoningValidation,
} from './PIEJarvisReasoningValidation';
import {
  decomposePIERecommendationConfidence,
  type PIEConfidenceDecomposition,
} from './PIEConfidenceDecomposition';
import {
  prioritizeEvidenceByDecisionValue,
  type PIEEvidenceValuePrioritization,
} from './PIEEvidenceValuePrioritization';
import {
  buildPIEExecutiveJudgment,
  buildExecutiveJudgmentAuthority,
  type PIEExecutiveAction as PIEJudgmentAction,
  type PIEExecutiveConstraint as PIEJudgmentConstraint,
  type PIEExecutiveDecision as PIEJudgmentDecision,
  type PIEExecutiveJudgment as PIEExecutiveJudgmentModel,
  type PIEExecutiveActionSafetyCheck,
  type PIEExecutiveJudgmentExplanation,
  type PIEExecutiveJudgmentResult,
  type PIEExecutiveOpportunity as PIEJudgmentOpportunity,
  type PIEExecutivePriority as PIEJudgmentPriority,
  type PIEExecutiveReadiness as PIEJudgmentReadiness,
  type PIEExecutiveRisk as PIEJudgmentRisk,
  type PIEEscalationAnalysis,
  type PIEOpportunityCost,
  type PIEDecisionTiming,
  type PIENoActionReasoning,
  type PIETradeoffAnalysis,
  type PIEWaitForEvidenceReasoning,
} from './PIEExecutiveJudgment';
import {
  persistStructuredExecutiveJudgment,
  type PIEExecutiveJudgmentRecord,
} from './PIEExecutiveJudgmentRepository';
import {
  resolvePIERealityAuthorityScope,
  runPIERealityModelOrchestration,
  type PIERealityModelOrchestrationResult,
  type PIERealityPersistenceStatus,
} from './PIERealityModelOrchestrator';
import { runExclusivePIEAuthorityMutation } from './PIEAuthorityMutationCoordinator';
import {
  buildPIEAdaptiveIntelligence,
  type PIEAdaptiveIntelligence,
  type PIEAdaptiveResult,
  type PIEOutcomeIntelligence,
  type PIECalibrationIntelligence,
  type PIEAdaptiveLesson,
  type PIEAdaptivePolicy,
  type PIEStrategyIntelligence,
  type PIECommunicationIntelligence,
  type PIETrustIntelligence,
} from './PIEAdaptiveIntelligence';
import {
  buildPIEDecisionMemory,
  type PIEDecisionMemory,
  type PIEDecisionMemoryResult,
  type PIEDecisionRecord,
  type PIEExecutiveWisdomLesson,
  type PIETrustCalibrationRecord,
  type PIEWhenNotToActReason,
  type PIEWisdomRecommendation,
} from './PIEDecisionMemory';
import {
  buildRuntime,
  type PIEBelief as RuntimePIEBelief,
  type PIERuntimeContext,
  type PIERuntimeState,
  type PIERecommendation as RuntimePIERecommendation,
} from './PIERuntime';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIECoreDomain =
  | 'project_intelligence'
  | 'maintenance'
  | 'manufacturing'
  | 'safety'
  | 'compliance'
  | 'operations'
  | 'facilities'
  | 'logistics'
  | 'custom';

export type PIECoreInput = {
  domain?: PIECoreDomain;
  runtime?: PIERuntimeState;
  runtimeContext?: PIERuntimeContext;
  appName?: string;
  authoritativeRealityModel?: PIERealityModel | null;
  liveRealityAuthority?: PIERealityModelOrchestrationResult | null;
  enforceLiveReality?: boolean;
  identityTrusted?: boolean;
  cloudAvailable?: boolean;
  expectedMinimumRealityModelVersion?: number;
  organizationId?: string;
  projectId?: string;
  verifiedLearningEvents?: readonly PIEVerifiedLearningEvent[];
  reportType?: PIEReportType;
  reportProjectNames?: string[];
  memoryRecallInput?: Omit<
    PIEMemoryRecallInput,
    'projectName' | 'areaName' | 'pastRecommendations' | 'pastLessons' | 'pastBeliefs' | 'pastOpinions' | 'coreIntelligence'
  >;
};

export type PIEEvidenceReview = {
  summary: string;
  receivedData: string[];
  missingData: string[];
  conflicts: string[];
  sourceCount: number;
  confidence: ProjectConfidenceLevel;
};

export type PIEInterpretation = {
  id: string;
  meaning: string;
  source: string;
  confidence: ProjectConfidenceLevel;
};

export type PIERelationshipAnalysis = {
  id: string;
  relationship: string;
  connectedFacts: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEBelief = {
  id: string;
  belief: string;
  evidence: string[];
  uncertainty: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEOpinion = {
  id: string;
  opinion: string;
  strength: 'weak' | 'moderate' | 'strong';
  reason: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionSupport = {
  id: string;
  decisionNeeded: string;
  reason: string;
  options: string[];
  approvalRequired: boolean;
  confidence: ProjectConfidenceLevel;
};

export type PIERecommendation = {
  id: string;
  recommendation: string;
  nextAction: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEExplanation = {
  id: string;
  explains: string;
  because: string[];
  uncertainty: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEReflectionResult = {
  summary: string;
  lessonsLearned: string[];
  beliefChanges: string[];
  confidenceChanges: string[];
  recommendedEvidence: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIELearningSignal = PIELearningEngineSignal;

export type PIECoreOutput = {
  domain: PIECoreDomain;
  generatedAt: string;
  appName: string;
  ecosCognitiveFramework: ECOSCognitiveOutput;
  pieDomainIntelligence: PIEProjectIntelligenceOutput;
  evidenceQuality: PIEEvidenceQualityResult;
  strongEvidence: PIEEvidenceQualityItem[];
  weakEvidence: PIEEvidenceQualityItem[];
  conflictingEvidence: PIEQualityEvidenceConflict[];
  staleEvidence: PIEEvidenceQualityItem[];
  evidenceReadiness: PIEEvidenceQualityLevel;
  missingEvidence: PIEMissingEvidenceResult;
  highestImpactEvidenceGap: PIEMissingEvidenceItem | null;
  recommendedEvidenceRequests: PIEMissingEvidenceRequest[];
  evidenceTimeline: PIEEvidenceTimeline;
  timelineGaps: PIEEvidenceTimelineGap[];
  staleAreas: PIEEvidenceTimelineGap[];
  momentumSignals: PIEEvidenceTimelineMomentum[];
  recentChanges: PIEEvidenceTimelineChange[];
  realityModel: PIERealityModel;
  realityObjects: PIERealityObject[];
  realityModelSummary: PIERealityModelSummary;
  realitySummary: string;
  objectsNeedingVerification: PIERealityObject[];
  objectsAtRisk: PIERealityObject[];
  objectsBlocked: PIERealityObject[];
  objectsRecentlyUpdated: PIERealityObject[];
  objectIntelligence: PIERealityObjectIntelligenceResult;
  objectsReady: PIERealityObject[];
  objectsUncertain: PIERealityObject[];
  objectsWithHighRisk: PIERealityObject[];
  objectNextActions: PIERealityNextAction[];
  objectNextBestActions: PIERealityNextAction[];
  objectRelationshipSummary: string;
  realityModelSynchronization: Pick<
    PIERealityModelSynchronizationResult,
    | 'changed'
    | 'createdObjectCount'
    | 'changedObjectCount'
    | 'conflictedObjectCount'
    | 'uncertaintyCount'
    | 'snapshotCreated'
  >;
  realityAuthority: {
    modelId: string;
    modelVersion: number;
    snapshotId: string;
    evidenceCutoffTime: string;
    persistenceStatus: PIERealityPersistenceStatus;
    activeConflictIds: string[];
    activeUncertaintyIds: string[];
  };
  currentSituation: PIESituation;
  situationIntent: PIESituationIntent;
  situationState: PIESituationState;
  situationChanges: PIESituationChange[];
  situationRisks: PIESituationRisk[];
  situationOpportunities: PIESituationOpportunity[];
  situationUnknowns: PIESituationUnknown[];
  situationBlockers: PIESituationBlocker[];
  situationPriorities: PIESituationPriority[];
  situationSummary: PIESituationSummary;
  situationIntelligence: PIESituationResult;
  evidenceReview: PIEEvidenceReview;
  interpretations: PIEInterpretation[];
  relationships: PIERelationshipAnalysis[];
  beliefs: PIEEngineBelief[];
  beliefSystem: PIEBeliefEngineResult;
  beliefChanges: PIEEngineBeliefChange[];
  strongestBeliefs: PIEEngineBelief[];
  challengedBeliefs: PIEEngineBelief[];
  beliefsNeedingVerification: PIEEngineBelief[];
  beliefReadiness: PIEBeliefReadiness;
  beliefExplanations: PIEBeliefExplanation[];
  predictionResult: PIEPredictionResult;
  predictions: PIEPredictionResult['predictions'];
  mostLikelyOutcome: PIEPredictionOutcome;
  bestCaseOutcome: PIEPredictionOutcome;
  worstCaseOutcome: PIEPredictionOutcome;
  noActionOutcome: PIEPredictionOutcome;
  cascadingImpacts: PIEPredictionImpact[];
  recoveryActions: PIEPredictionRecoveryAction[];
  predictionConfidence: PIEPredictionResult['predictionConfidence'];
  predictiveReality: PIEPredictiveRealityResult;
  futureObjectStates: PIEFutureObjectState[];
  readinessForecasts: PIEReadinessForecast[];
  predictiveCascadingEffects: PIECascadingEffect[];
  cascadingRealityEffects: PIECascadingEffect[];
  noActionForecast: PIEPredictiveReality;
  noActionOutcomes: PIEPredictiveReality;
  recoveryForecast: PIEPredictiveReality;
  recoveryPaths: PIEPredictiveRealityOpportunity[];
  predictiveRealitySummary: string;
  executiveJudgment: PIEExecutiveJudgmentModel;
  executiveJudgmentResult: PIEExecutiveJudgmentResult;
  executiveJudgmentRecord: PIEExecutiveJudgmentRecord | null;
  executiveJudgmentExplanation: PIEExecutiveJudgmentExplanation;
  actionSafetyCheck: PIEExecutiveActionSafetyCheck;
  executiveJudgmentHighestValueAction: PIEJudgmentAction | null;
  executiveDecisions: PIEJudgmentDecision[];
  executiveJudgmentPriorities: PIEJudgmentPriority[];
  executiveRisks: PIEJudgmentRisk[];
  executiveOpportunities: PIEJudgmentOpportunity[];
  executiveConstraints: PIEJudgmentConstraint[];
  tradeoffAnalysis: PIETradeoffAnalysis;
  escalationAnalysis: PIEEscalationAnalysis;
  opportunityCost: PIEOpportunityCost;
  decisionTiming: PIEDecisionTiming;
  noActionReasoning: PIENoActionReasoning;
  waitForEvidenceReasoning: PIEWaitForEvidenceReasoning;
  executiveJudgmentReadiness: PIEJudgmentReadiness;
  executiveJudgmentSummary: string;
  decisionSimulation: PIEDecisionSimulationResult;
  simulatedOptions: PIEDecisionSimulationResult['options'];
  simulationScenarios: PIEDecisionSimulationResult['scenarios'];
  optionScores: PIEDecisionSimulationResult['scores'];
  simulationSensitivity: PIEDecisionSimulationResult['sensitivityAnalysis'];
  simulationProvenance: PIEDecisionSimulationResult['provenance'];
  recommendationChallenge: PIERecommendationChallengeResult;
  jarvisReasoningValidation: PIEJarvisReasoningValidation;
  confidenceDecomposition: PIEConfidenceDecomposition;
  evidenceValuePrioritization: PIEEvidenceValuePrioritization;
  highestValueEvidenceRequest: PIEEvidenceValuePrioritization['highestValueEvidence'];
  decisionProvenance: PIEDecisionSimulationResult['provenance'];
  longitudinalPhotoIntelligence: PIEPhotoProgressIntelligenceResult;
  photoSequences: PIEPhotoProgressIntelligenceResult['sequences'];
  photoProgressEvents: PIEPhotoProgressIntelligenceResult['progressEvents'];
  photoProgressConflicts: PIEPhotoProgressIntelligenceResult['conflicts'];
  photoRepeatGuidance: PIEPhotoProgressIntelligenceResult['repeatPhotoGuidance'];
  visualJarvisValidation: PIEPhotoProgressIntelligenceResult['visualJarvisValidation'];
  bestNextStep: string;
  whatCanWait: string;
  whatNotToDo: string;
  decisionNeeded: string;
  escalationRecommendation: string;
  recommendationWhy: string;
  recommendationAlternatives: string[];
  recommendationSuccessMeasure: string;
  executiveReasoning: PIEExecutiveReasoningResult;
  executivePriorities: PIEExecutivePriority[];
  biggestRisk: PIEExecutiveRisk | null;
  highestValueAction: PIEExecutiveAction | null;
  executiveBriefingPoints: PIEExecutiveBriefingPoint[];
  executiveReadiness: PIEExecutiveReadiness;
  opinions: PIEOpinion[];
  decisionsNeeded: PIEDecisionSupport[];
  recommendations: PIERecommendation[];
  explanations: PIEExplanation[];
  adaptiveIntelligence: PIEAdaptiveIntelligence;
  adaptiveResult: PIEAdaptiveResult;
  outcomeIntelligence: PIEOutcomeIntelligence;
  calibrationIntelligence: PIECalibrationIntelligence;
  strategyAdjustments: PIEStrategyIntelligence['strategyAdjustments'];
  communicationAdjustments: PIECommunicationIntelligence['communicationAdjustments'];
  trustAssessment: PIETrustIntelligence;
  adaptiveLessons: PIEAdaptiveLesson[];
  adaptivePolicyUpdates: PIEAdaptivePolicy[];
  decisionMemory: PIEDecisionMemory;
  decisionMemoryResult: PIEDecisionMemoryResult;
  decisionHistory: PIEDecisionRecord[];
  wisdomLessons: PIEExecutiveWisdomLesson[];
  whenNotToActReasons: PIEWhenNotToActReason[];
  wisdomRecommendations: PIEWisdomRecommendation[];
  trustCalibrationHistory: PIETrustCalibrationRecord[];
  learningResult: PIELearningResult;
  reflection: PIEReflectionResult;
  memoryRecall: PIEMemoryRecallResult;
  deliberation: PIEDeliberationResult;
  patternIntelligence: PIEPatternIntelligence;
  patternMatches: PIEPatternMatch[];
  earlyWarnings: PIEPatternWarning[];
  patternBasedRecommendations: PIEPatternRecommendation[];
  patternConfidence: PIEPatternConfidence;
  scientificResult: PIEScientificResult;
  primaryHypothesis: PIEScientificHypothesis | null;
  challengedAssumptions: PIEScientificChallenge[];
  primaryUncertainty: PIEUncertainty | null;
  uncertaintyReductionActions: PIEUncertaintyReductionAction[];
  decisionQualitySignals: PIEDecisionQualityScore;
  assumptions: PIEDeliberationAssumption[];
  alternatives: PIEDeliberationAlternative[];
  tradeoffs: PIEDeliberationTradeoff[];
  recommendationReadiness: PIEDeliberationResult['recommendationReadiness'];
  whatWouldChangeRecommendation: string[];
  memoryInfluences: PIEMemoryInfluence[];
  pastLessons: PIEMemoryRecallResult['pastLessons'];
  recurringPatterns: Array<PIEMemoryPattern | PIEPattern>;
  similarPastEvents: PIERelevantMemory[];
  missingData: string[];
  confidence: ProjectConfidenceLevel;
  nextBestActions: string[];
  learningSignals: PIELearningSignal[];
  lessonsLearned: PIELearningResult['lessonsLearned'];
  confidenceCalibration: PIELearningConfidenceCalibration[];
  futureAdjustments: string[];
  memoryConsolidation: PIELearningMemoryConsolidation[];
  decisionQualityLearning: PIELearningDecisionQuality[];
  connectedEngines: string[];
  runtime: PIERuntimeState;
  attention: PIEAttentionState;
  experience: PIEExperienceOutput;
  reportDraft: PIEReportDraft;
};

const CORE_ENGINE_CHAIN = [
  'Evidence Fusion',
  'Reality Model',
  'Situation Intelligence',
  'Knowledge Graph',
  'Reflection',
  'Continuous Learning',
  'Mission',
  'Executive',
  'Predictive Simulation',
  'Predictive Reality',
  'Executive Judgment',
  'Adaptive Intelligence',
  'Decision Memory',
  'Executive Reasoning',
  'Attention',
  'Experience',
  'Reporter',
  'Runtime',
] as const;

function coreReportScope(
  input: PIECoreInput,
  runtime: PIERuntimeState,
): {
  reportType: PIEReportType;
  projectNames: string[];
} {
  const explicitlySelectedProjects = (input.reportProjectNames || [])
    .map(name => name.trim())
    .filter(Boolean);
  const contextProjects = (input.runtimeContext?.projectNames || [])
    .map(name => name.trim())
    .filter(Boolean);
  const projectNames = explicitlySelectedProjects.length > 0
    ? explicitlySelectedProjects
    : contextProjects.length > 0
      ? contextProjects
      : runtime.projectNames;

  return {
    reportType:
      input.reportType ||
      (projectNames.length > 1
        ? 'combined_project_update'
        : 'daily_project_update'),
    projectNames,
  };
}

export function buildPIECoreIntelligence(
  input: PIECoreInput = {},
): PIECoreOutput {
  if (input.enforceLiveReality && !input.liveRealityAuthority) {
    throw new Error('DAVE Core requires live authoritative Reality Model orchestration in production mode.');
  }
  const runtime = input.runtime || buildRuntime(input.runtimeContext || {});
  const reportScope = coreReportScope(input, runtime);
  const baselineLearning = buildPIELearning({
    runtime,
    organizationId: input.organizationId,
    projectId: input.projectId,
    verifiedLearningEvents: input.verifiedLearningEvents,
    reportDraft: runtime.response.reportDraft,
  });
  const memoryRecall = buildPIEMemoryRecall({
    ...(input.memoryRecallInput || {}),
    projectName: runtime.projectName,
    areaName: runtime.recommendedWalkAreas[0] || null,
    newEvidenceSummary:
      input.memoryRecallInput?.newEvidenceSummary ||
      runtime.intelligentSummary.whatChanged ||
      runtime.nextBestAction.summary,
    pastRecommendations: runtime.recommendations,
    pastLessons: runtime.lessonsLearned,
    pastBeliefs: runtime.currentBeliefs,
    learningResult: baselineLearning,
  });
  const evidenceQuality = evaluateEvidenceQuality(
    buildRuntimeEvidenceQualityInputs(runtime, memoryRecall),
    runtime.generatedAt,
  );
  const missingEvidence = findMissingEvidence(
    buildRuntimeMissingEvidenceInput(runtime, evidenceQuality),
    runtime.generatedAt,
  );
  const evidenceTimeline = buildEvidenceTimeline(
    { events: buildRuntimeEvidenceTimelineEvents(runtime) },
    runtime.generatedAt,
  );
  const organizationId = input.organizationId || input.authoritativeRealityModel?.organizationId || 'local-unverified-anonymous';
  const projectId = input.projectId || input.authoritativeRealityModel?.projectId || stableCoreProjectId(runtime.projectName || runtime.projectNames[0] || 'Project');
  const realitySourceObjects = buildRuntimeRealitySourceObjects(runtime, {
      evidenceQuality,
      missingEvidence,
      evidenceTimeline,
    }, organizationId, projectId);
  const qualifiedRealityEvidence = buildQualifiedRealityEvidence(
    realitySourceObjects,
    organizationId,
    projectId,
  );
  const realityModel = input.liveRealityAuthority?.model || buildPIERealityModel({
      organizationId,
      projectId,
      previousModel: input.authoritativeRealityModel || null,
      objects: qualifiedRealityEvidence,
      generatedAt: runtime.generatedAt,
      sourceEvidenceCutoffAt: runtime.generatedAt,
    });
  const previousVersion = input.authoritativeRealityModel?.version ?? -1;
  const realityModelSynchronization = input.liveRealityAuthority?.synchronization
    ? {
        changed: input.liveRealityAuthority.synchronization.changed,
        createdObjectCount: input.liveRealityAuthority.synchronization.createdObjectCount,
        changedObjectCount: input.liveRealityAuthority.synchronization.changedObjectCount,
        conflictedObjectCount: input.liveRealityAuthority.synchronization.conflictedObjectCount,
        uncertaintyCount: input.liveRealityAuthority.synchronization.uncertaintyCount,
        snapshotCreated: input.liveRealityAuthority.synchronization.snapshotCreated,
      }
    : {
    changed: realityModel.version !== previousVersion,
    createdObjectCount: input.authoritativeRealityModel
      ? Math.max(0, realityModel.objects.length - input.authoritativeRealityModel.objects.length)
      : realityModel.objects.length,
    changedObjectCount: realityModel.changeHistory.length,
    conflictedObjectCount: realityModel.evidenceConflicts.length,
    uncertaintyCount: realityModel.activeUncertainties.length,
    snapshotCreated: realityModel.version !== previousVersion,
  };
  const executiveAuthority = buildExecutiveJudgmentAuthority({
    realityModel,
    snapshotId: input.liveRealityAuthority?.snapshotId,
    conflicts: realityModel.evidenceConflicts,
    uncertainties: realityModel.activeUncertainties,
    persistenceStatus: input.liveRealityAuthority?.persistenceStatus,
  });
  const realityAuthority = {
    modelId: executiveAuthority.realityModelId,
    modelVersion: executiveAuthority.realityModelVersion,
    snapshotId: executiveAuthority.realitySnapshotId,
    evidenceCutoffTime: executiveAuthority.evidenceCutoffTime,
    persistenceStatus: input.liveRealityAuthority?.persistenceStatus || 'degraded_local_only' as PIERealityPersistenceStatus,
    activeConflictIds: executiveAuthority.activeConflictIds,
    activeUncertaintyIds: executiveAuthority.activeUncertaintyIds,
  };
  const situationIntelligence = buildPIESituation({
    realityModel,
    objectIntelligence: realityModel.intelligence,
    generatedAt: runtime.generatedAt,
    userContext: {
      surface: runtime.surface,
      requestedReport: runtime.response.reportNeedsReview || runtime.response.reportActionItems.length > 0,
      walkActive: runtime.surface === 'project-walk',
    },
  });
  const deliberation = buildPIEDeliberation({
    runtime,
    memoryRecall,
    candidateRecommendations: runtime.recommendations,
    evidenceQuality,
  });
  const patternIntelligence = buildPIEPatternIntelligence({
    currentEvidenceSummary:
      input.memoryRecallInput?.newEvidenceSummary ||
      runtime.intelligentSummary.whatChanged ||
      runtime.nextBestAction.summary,
    projectName: runtime.projectName,
    areaName: runtime.recommendedWalkAreas[0] || null,
    memoryRecall,
    lessonsLearned: runtime.lessonsLearned,
    beliefChanges: runtime.beliefChanges,
    learningResult: baselineLearning,
    evidenceTimeline,
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
  });
  const scientificResult = runPIEScientificMethod({
    runtime,
    memoryRecall,
    patternIntelligence,
    deliberation,
    reflectionLessons: runtime.lessonsLearned,
    evidenceQuality,
  });
  const beliefSystem = buildPIEBeliefs({
    runtime,
    scientificResult,
    patternIntelligence,
    memoryRecall,
    reflectionBeliefChanges: runtime.beliefChanges,
    reflectionLessons: runtime.lessonsLearned,
    learningResult: baselineLearning,
    evidenceQuality,
    evidenceTimeline,
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
  });
  const predictionResult = buildPIEPredictions({
    runtime,
    beliefSystem,
    patternIntelligence,
    memoryRecall,
    scientificResult,
    deliberation,
    learningResult: baselineLearning,
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
  });
  const predictiveReality = buildPIEPredictiveReality({
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
    evidenceTimeline,
    beliefSystem,
    patternIntelligence,
    predictionResult,
    missingEvidence,
    generatedAt: runtime.generatedAt,
  });
  const longitudinalPhotoIntelligence = buildPIEPhotoProgressIntelligence({
    organizationId: realityModel.organizationId,
    projectId: realityModel.projectId,
    projectName: runtime.projectName,
    updates: input.runtimeContext?.updates,
    currentUpdate: input.runtimeContext?.currentUpdate,
    realityModel,
    scheduleItems: input.runtimeContext?.scheduleItems,
    documents: input.runtimeContext?.referenceDocuments,
    now: new Date(runtime.generatedAt),
  });
  const reflection = buildCoreReflection(runtime);
  const preliminaryAdaptiveResult = buildPIEAdaptiveIntelligence({
    generatedAt: runtime.generatedAt,
    learningResult: baselineLearning,
    reflection,
    memoryRecall,
    predictionResult,
    reportDraft: runtime.response.reportDraft,
  });
  const preliminaryDecisionMemory = buildPIEDecisionMemory({
    generatedAt: runtime.generatedAt,
    learningResult: baselineLearning,
    reflection,
    memoryRecall,
    adaptiveIntelligence: preliminaryAdaptiveResult,
    predictionResult,
    reportDraft: runtime.response.reportDraft,
  });
  const executiveJudgmentResult = buildPIEExecutiveJudgment({
    realityModel,
    authority: executiveAuthority,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
    predictiveReality,
    evidenceQuality,
    missingEvidence,
    beliefSystem,
    patternIntelligence,
    evidenceTimeline,
    adaptivePolicies: preliminaryAdaptiveResult.adaptivePolicyUpdates,
    decisionMemory: preliminaryDecisionMemory,
    generatedAt: runtime.generatedAt,
  });
  const decisionSimulation = buildPIEDecisionSimulation({
    realityModel,
    executiveJudgment: executiveJudgmentResult,
    executiveJudgmentRecord: null,
    predictiveReality,
    missingEvidence,
    longitudinalPhotoIntelligence,
    projectGoals: realityModel.goals.map(goal => goal.goal),
    activeRisks: realityModel.activeRisks,
    activeConstraints: executiveJudgmentResult.executiveConstraints.map(constraint => constraint.constraint),
    dependencies: realityModel.dependencies.map(dependency => dependency.summary),
    scheduleState: runtime.scheduleSummary ? [scheduleSummaryText(runtime.scheduleSummary)] : [],
    resourceAvailability: executiveJudgmentResult.executiveResourceNeeds.map(need => need.resource),
    authorityBoundaries: [executiveJudgmentResult.escalationAnalysis.target.role],
    generatedAt: runtime.generatedAt,
  });
  const recommendationChallenge = challengePIERecommendation({
    realityModel,
    executiveJudgment: executiveJudgmentResult,
    simulation: decisionSimulation,
    generatedAt: runtime.generatedAt,
  });
  const jarvisReasoningValidation = validatePIEReasoningWithJARVIS({
    realityModel,
    executiveJudgment: executiveJudgmentResult,
    simulation: decisionSimulation,
    challenge: recommendationChallenge,
    generatedAt: runtime.generatedAt,
  });
  const confidenceDecomposition = decomposePIERecommendationConfidence({
    realityModel,
    executiveJudgment: executiveJudgmentResult,
    evidenceQuality,
    predictiveReality,
    simulation: decisionSimulation,
    challenge: recommendationChallenge,
    jarvisValidation: jarvisReasoningValidation,
    generatedAt: runtime.generatedAt,
  });
  const evidenceValuePrioritization = prioritizeEvidenceByDecisionValue({
    realityModel,
    executiveJudgment: executiveJudgmentResult,
    missingEvidence,
    simulation: decisionSimulation,
    generatedAt: runtime.generatedAt,
  });
  const executiveReasoning = buildPIEExecutiveReasoning({
    runtime,
    beliefSystem,
    patternIntelligence,
    memoryRecall,
    scientificResult,
    deliberation,
    predictions: predictionResult,
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
    predictiveReality,
  });
  const learningResult = buildPIELearning({
    runtime,
    organizationId: input.organizationId,
    projectId: input.projectId,
    verifiedLearningEvents: input.verifiedLearningEvents,
    beliefSystem,
    patternIntelligence,
    predictionResult,
    executiveReasoning,
    reportDraft: runtime.response.reportDraft,
  });
  const decisionMemoryResult = buildPIEDecisionMemory({
    generatedAt: runtime.generatedAt,
    learningResult,
    reflection,
    memoryRecall,
    adaptiveIntelligence: preliminaryAdaptiveResult,
    executiveJudgment: executiveJudgmentResult,
    predictionResult,
    reportDraft: runtime.response.reportDraft,
  });
  const adaptiveResult = buildPIEAdaptiveIntelligence({
    generatedAt: runtime.generatedAt,
    learningResult,
    reflection,
    memoryRecall,
    decisionMemory: decisionMemoryResult,
    executiveJudgment: executiveJudgmentResult,
    predictionResult,
    reportDraft: runtime.response.reportDraft,
  });
  const attention = buildPIEAttentionState({
    runtime,
    enforceAuthoritativeInputs: Boolean(input.liveRealityAuthority),
    memoryRecall,
    deliberation,
    beliefsNeedingVerification: beliefSystem.beliefsNeedingVerification,
    executiveReasoning,
    executiveJudgment: executiveJudgmentResult,
    decisionMemory: decisionMemoryResult,
    predictions: predictionResult,
    predictiveReality,
    missingEvidence,
    realityModel,
    objectIntelligence: realityModel.intelligence,
    situationIntelligence,
  });
  const experience = buildPIEExperience({
    runtime,
    attentionState: attention,
    context: {
      surface: runtime.surface === 'project-walk' ? 'walk' : 'today',
      hasRecentGreeting: true,
      memoryInfluences: memoryRecall.memoryInfluences,
      deliberation,
      beliefsNeedingVerification: beliefSystem.beliefsNeedingVerification,
      beliefReadiness: beliefSystem.beliefReadiness,
      executiveReasoning,
      executiveJudgment: executiveJudgmentResult,
      enforceAuthoritativeInputs: Boolean(input.liveRealityAuthority),
      decisionMemory: decisionMemoryResult,
      highestValueAction: executiveReasoning.highestValueAction?.action || null,
      predictions: predictionResult,
      predictiveReality,
      missingEvidenceResult: missingEvidence,
      realityModel,
      objectIntelligence: realityModel.intelligence,
      situationIntelligence,
    },
  });
  const similarPastEvents = memoryRecall.memories.filter(memory =>
    memory.source === 'project_event' || memory.source === 'update',
  );
  const reportDraft = buildPIEReportDraft({
    reportType: reportScope.reportType,
    audience: 'internal_team',
    selectedProjectNames: reportScope.projectNames,
    currentUpdate: input.runtimeContext?.currentUpdate,
    savedUpdates: input.runtimeContext?.updates,
    scheduleItems: input.runtimeContext?.scheduleItems,
    projectAreas: input.runtimeContext?.projectAreas,
    contacts: input.runtimeContext?.contacts,
    runtime: {
      ...runtime,
      memoryRecallSummary: memoryRecall.summaryForPIE,
      memoryInfluences: memoryRecall.memoryInfluences,
      recurringPatterns: memoryRecall.patterns,
      patternIntelligence,
      patternMatches: patternIntelligence.patternMatches,
      earlyWarnings: patternIntelligence.earlyWarnings,
      patternBasedRecommendations: patternIntelligence.patternBasedRecommendations,
      patternConfidence: patternIntelligence.patternConfidence,
      beliefs: beliefSystem.beliefs,
      beliefChanges: beliefSystem.beliefChanges,
      strongestBeliefs: beliefSystem.strongestBeliefs,
      challengedBeliefs: beliefSystem.challengedBeliefs,
      beliefsNeedingVerification: beliefSystem.beliefsNeedingVerification,
      beliefReadiness: beliefSystem.beliefReadiness,
      beliefExplanations: beliefSystem.beliefExplanations,
      predictionResult,
      predictions: predictionResult.predictions,
      mostLikelyOutcome: predictionResult.mostLikelyOutcome,
      bestCaseOutcome: predictionResult.bestCaseOutcome,
      worstCaseOutcome: predictionResult.worstCaseOutcome,
      noActionOutcome: predictionResult.noActionOutcome,
      cascadingImpacts: predictionResult.cascadingImpacts,
      recoveryActions: predictionResult.recoveryActions,
      predictionConfidence: predictionResult.predictionConfidence,
      predictiveReality,
      futureObjectStates: predictiveReality.futureObjectStates,
      readinessForecasts: predictiveReality.readinessForecasts,
      predictiveCascadingEffects: predictiveReality.cascadingEffects,
      noActionForecast: predictiveReality.noActionForecast,
      recoveryForecast: predictiveReality.recoveryForecast,
      predictiveRealitySummary: predictiveReality.predictiveRealitySummary,
      executiveJudgment: executiveJudgmentResult,
      executiveJudgmentSummary: executiveJudgmentResult.executiveJudgmentSummary,
      executiveJudgmentHighestValueAction: executiveJudgmentResult.highestValueAction,
      executiveDecisions: executiveJudgmentResult.executiveDecisions,
      executiveRisks: executiveJudgmentResult.executiveRisks,
      executiveOpportunities: executiveJudgmentResult.executiveOpportunities,
      executiveConstraints: executiveJudgmentResult.executiveConstraints,
      decisionMemory: decisionMemoryResult,
      decisionHistory: decisionMemoryResult.decisionHistory,
      wisdomLessons: decisionMemoryResult.wisdomLessons,
      whenNotToActReasons: decisionMemoryResult.whenNotToActReasons,
      wisdomRecommendations: decisionMemoryResult.wisdomRecommendations,
      trustCalibrationHistory: decisionMemoryResult.trustCalibrationHistory,
      tradeoffAnalysis: executiveJudgmentResult.tradeoffAnalysis,
      escalationAnalysis: executiveJudgmentResult.escalationAnalysis,
      opportunityCost: executiveJudgmentResult.opportunityCost,
      decisionTiming: executiveJudgmentResult.decisionTiming,
      noActionReasoning: executiveJudgmentResult.noActionReasoning,
      waitForEvidenceReasoning: executiveJudgmentResult.waitForEvidenceReasoning,
      learningResult,
      learningSignals: learningResult.learningSignals,
      lessonsLearned: learningResult.lessonsLearned,
      confidenceCalibration: learningResult.confidenceCalibration,
      futureAdjustments: learningResult.futureAdjustments,
      memoryConsolidation: learningResult.memoryConsolidation,
      decisionQualityLearning: learningResult.decisionQualityLearning,
      executiveReasoning,
      executivePriorities: executiveReasoning.priorities,
      biggestRisk: executiveReasoning.biggestRisk,
      highestValueAction: executiveReasoning.highestValueAction,
      executiveBriefingPoints: executiveReasoning.briefingPoints,
      executiveReadiness: executiveReasoning.executiveReadiness,
      similarPastEvents,
      deliberation,
      recommendationReadiness: deliberation.recommendationReadiness,
      whatWouldChangeRecommendation: deliberation.whatWouldChangeRecommendation,
      scientificResult,
      primaryUncertainty: scientificResult.primaryUncertainty?.uncertainty,
      uncertaintyReductionActions: scientificResult.uncertaintyReductionActions.map(action => action.action),
      decisionQualitySignals: scientificResult.decisionQualitySignals,
      realityModel,
      realitySummary: realityModel.summary.summary,
      objectIntelligence: realityModel.intelligence,
      situationIntelligence,
      situationSummary: situationIntelligence.situationSummary.headline,
    },
    generatedAt: new Date(runtime.generatedAt),
  });

  const evidenceReview = buildEvidenceReview(runtime, memoryRecall);
  const interpretations = buildInterpretations(runtime, memoryRecall);
  const relationships = buildRelationships(runtime);
  const pieDomainInput = buildPIEDomainInput({
    runtime,
    evidenceReview,
    memory: memoryRecall.memories.map(memory => memory.summary),
    patterns: patternIntelligence.patternMatches.map(match => match.pattern.title),
    constraints: deliberation.assumptions.map(assumption => assumption.assumption),
    risks: [
      ...predictionResult.cascadingImpacts.map(impact => impact.summary),
      executiveReasoning.biggestRisk?.risk,
    ].filter((item): item is string => Boolean(item)),
    decisions: executiveReasoning.decisionNeeds.map(decision => decision.decisionNeeded),
    candidateActions: [
      executiveReasoning.highestValueAction?.action,
      runtime.nextBestAction.suggestedNextAction,
      ...runtime.recommendations.map(recommendation => recommendation.suggestedNextAction),
    ].filter((item): item is string => Boolean(item)),
    outcomes: runtime.lessonsLearned.map(lesson => lesson.lesson),
    feedback: learningResult.learningSignals.map(signal => signal.signal),
  });
  const pieDomainMapping = buildPIEDomainMappingResult(pieDomainInput);
  const ecosCognitiveFramework = runECOSCognitiveFramework(pieDomainMapping.ecosInput);
  const pieDomainIntelligence = mapECOSToPIEIntelligence(
    pieDomainInput,
    ecosCognitiveFramework,
  );
  const beliefs = beliefSystem.beliefs;
  const opinions = buildOpinions(runtime, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult);
  const decisionsNeeded = buildDecisionsNeeded(runtime, executiveReasoning);
  const recommendations = buildRecommendations(runtime.recommendations, memoryRecall.memoryInfluences, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult);
  const explanations = buildExplanations(runtime, recommendations, memoryRecall, deliberation, scientificResult, patternIntelligence, beliefSystem, executiveReasoning, predictionResult);
  return {
    domain: input.domain || 'project_intelligence',
    generatedAt: runtime.generatedAt,
    appName: input.appName || 'Project Vision AI',
    ecosCognitiveFramework,
    pieDomainIntelligence,
    evidenceQuality,
    strongEvidence: evidenceQuality.strongEvidence,
    weakEvidence: evidenceQuality.weakEvidence,
    conflictingEvidence: evidenceQuality.conflictingEvidence,
    staleEvidence: evidenceQuality.staleEvidence,
    evidenceReadiness: evidenceQuality.evidenceReadiness,
    missingEvidence,
    highestImpactEvidenceGap: missingEvidence.highestImpactEvidenceGap,
    recommendedEvidenceRequests: missingEvidence.requests,
    evidenceTimeline,
    timelineGaps: evidenceTimeline.gaps,
    staleAreas: evidenceTimeline.staleAreas,
    momentumSignals: evidenceTimeline.momentumSignals,
    recentChanges: evidenceTimeline.recentChanges,
    realityModel,
    realityObjects: realityModel.objects,
    realityModelSummary: realityModel.summary,
    realitySummary: realityModel.summary.summary,
    objectsNeedingVerification: realityModel.objects.filter(object =>
      object.currentStatus === 'needs_verification' ||
      object.currentState.uncertain,
    ),
    objectsAtRisk: realityModel.objects.filter(object => object.currentStatus === 'at_risk'),
    objectsBlocked: realityModel.objects.filter(object => object.currentStatus === 'blocked'),
    objectsRecentlyUpdated: realityModel.objects.filter(object =>
      daysBetweenDates(object.lastUpdated, runtime.generatedAt) <= 7,
    ),
    objectIntelligence: realityModel.intelligence,
    objectsReady: realityModel.intelligence.objectsReady,
    objectsUncertain: realityModel.intelligence.objectsUncertain,
    objectsWithHighRisk: realityModel.intelligence.objectsWithHighRisk,
    objectNextActions: realityModel.intelligence.objectNextBestActions,
    objectNextBestActions: realityModel.intelligence.objectNextBestActions,
    objectRelationshipSummary: realityModel.intelligence.objectRelationshipSummary,
    realityModelSynchronization,
    realityAuthority,
    currentSituation: situationIntelligence.currentSituation,
    situationIntent: situationIntelligence.situationIntent,
    situationState: situationIntelligence.situationState,
    situationChanges: situationIntelligence.situationChanges,
    situationRisks: situationIntelligence.situationRisks,
    situationOpportunities: situationIntelligence.situationOpportunities,
    situationUnknowns: situationIntelligence.situationUnknowns,
    situationBlockers: situationIntelligence.situationBlockers,
    situationPriorities: situationIntelligence.situationPriorities,
    situationSummary: situationIntelligence.situationSummary,
    situationIntelligence,
    evidenceReview,
    interpretations,
    relationships,
    beliefs,
    beliefSystem,
    beliefChanges: beliefSystem.beliefChanges,
    strongestBeliefs: beliefSystem.strongestBeliefs,
    challengedBeliefs: beliefSystem.challengedBeliefs,
    beliefsNeedingVerification: beliefSystem.beliefsNeedingVerification,
    beliefReadiness: beliefSystem.beliefReadiness,
    beliefExplanations: beliefSystem.beliefExplanations,
    predictionResult,
    predictions: predictionResult.predictions,
    mostLikelyOutcome: predictionResult.mostLikelyOutcome,
    bestCaseOutcome: predictionResult.bestCaseOutcome,
    worstCaseOutcome: predictionResult.worstCaseOutcome,
    noActionOutcome: predictionResult.noActionOutcome,
    cascadingImpacts: predictionResult.cascadingImpacts,
    recoveryActions: predictionResult.recoveryActions,
    predictionConfidence: predictionResult.predictionConfidence,
    predictiveReality,
    futureObjectStates: predictiveReality.futureObjectStates,
    readinessForecasts: predictiveReality.readinessForecasts,
    predictiveCascadingEffects: predictiveReality.cascadingEffects,
    cascadingRealityEffects: predictiveReality.cascadingEffects,
    noActionForecast: predictiveReality.noActionForecast,
    noActionOutcomes: predictiveReality.noActionForecast,
    recoveryForecast: predictiveReality.recoveryForecast,
    recoveryPaths: predictiveReality.opportunities,
    predictiveRealitySummary: predictiveReality.predictiveRealitySummary,
    executiveJudgment: executiveJudgmentResult.executiveJudgment,
    executiveJudgmentResult,
    executiveJudgmentRecord: null,
    executiveJudgmentExplanation: executiveJudgmentResult.executiveJudgment.explanation,
    actionSafetyCheck: executiveJudgmentResult.actionSafetyCheck,
    executiveJudgmentHighestValueAction: executiveJudgmentResult.highestValueAction,
    executiveDecisions: executiveJudgmentResult.executiveDecisions,
    executiveJudgmentPriorities: executiveJudgmentResult.executivePriorities,
    executiveRisks: executiveJudgmentResult.executiveRisks,
    executiveOpportunities: executiveJudgmentResult.executiveOpportunities,
    executiveConstraints: executiveJudgmentResult.executiveConstraints,
    tradeoffAnalysis: executiveJudgmentResult.tradeoffAnalysis,
    escalationAnalysis: executiveJudgmentResult.escalationAnalysis,
    opportunityCost: executiveJudgmentResult.opportunityCost,
    decisionTiming: executiveJudgmentResult.decisionTiming,
    noActionReasoning: executiveJudgmentResult.noActionReasoning,
    waitForEvidenceReasoning: executiveJudgmentResult.waitForEvidenceReasoning,
    executiveJudgmentReadiness: executiveJudgmentResult.executiveReadiness,
    executiveJudgmentSummary: executiveJudgmentResult.executiveJudgmentSummary,
    decisionSimulation,
    simulatedOptions: decisionSimulation.options,
    simulationScenarios: decisionSimulation.scenarios,
    optionScores: decisionSimulation.scores,
    simulationSensitivity: decisionSimulation.sensitivityAnalysis,
    simulationProvenance: decisionSimulation.provenance,
    recommendationChallenge,
    jarvisReasoningValidation,
    confidenceDecomposition,
    evidenceValuePrioritization,
    highestValueEvidenceRequest: evidenceValuePrioritization.highestValueEvidence,
    decisionProvenance: decisionSimulation.provenance,
    longitudinalPhotoIntelligence,
    photoSequences: longitudinalPhotoIntelligence.sequences,
    photoProgressEvents: longitudinalPhotoIntelligence.progressEvents,
    photoProgressConflicts: longitudinalPhotoIntelligence.conflicts,
    photoRepeatGuidance: longitudinalPhotoIntelligence.repeatPhotoGuidance,
    visualJarvisValidation: longitudinalPhotoIntelligence.visualJarvisValidation,
    bestNextStep:
      executiveJudgmentResult.highestValueAction?.score.readiness === 'Ready'
        ? executiveJudgmentResult.highestValueAction.action
        : executiveJudgmentResult.waitForEvidenceReasoning.shouldWaitForEvidence
          ? executiveJudgmentResult.waitForEvidenceReasoning.smallestEvidenceRequest
          : executiveJudgmentResult.highestValueAction?.governance.whatWouldChangeRecommendation[0] ||
            executiveJudgmentResult.executiveJudgment.bestActionIfEvidenceIncomplete,
    whatCanWait: executiveJudgmentResult.executiveJudgment.whatCanWait,
    whatNotToDo:
      executiveJudgmentResult.highestValueAction?.type === 'escalate' &&
      !executiveJudgmentResult.escalationAnalysis.shouldEscalate
        ? 'Do not escalate without verification.'
        : executiveJudgmentResult.executiveJudgment.whatShouldNotEscalate,
    decisionNeeded: executiveJudgmentResult.executiveJudgment.decisionNeeded,
    escalationRecommendation: executiveJudgmentResult.escalationAnalysis.shouldEscalate
      ? executiveJudgmentResult.escalationAnalysis.justification
      : `Do not escalate yet. ${executiveJudgmentResult.escalationAnalysis.justification}`,
    recommendationWhy:
      executiveJudgmentResult.highestValueAction?.governance.why ||
      executiveJudgmentResult.executiveJudgment.explanation.summary,
    recommendationAlternatives:
      executiveJudgmentResult.highestValueAction?.governance.alternativesConsidered ||
      executiveJudgmentResult.tradeoffAnalysis.options.map(option => option.label),
    recommendationSuccessMeasure:
      executiveJudgmentResult.highestValueAction?.governance.successMeasure ||
      'Success is measured by improved readiness, lower uncertainty, and no unsupported escalation.',
    executiveReasoning,
    executivePriorities: executiveReasoning.priorities,
    biggestRisk: executiveReasoning.biggestRisk,
    highestValueAction: executiveReasoning.highestValueAction,
    executiveBriefingPoints: executiveReasoning.briefingPoints,
    executiveReadiness: executiveReasoning.executiveReadiness,
    opinions,
    decisionsNeeded,
    recommendations,
    explanations,
    adaptiveIntelligence: adaptiveResult.adaptiveIntelligence,
    adaptiveResult,
    outcomeIntelligence: adaptiveResult.outcomeIntelligence,
    calibrationIntelligence: adaptiveResult.calibrationIntelligence,
    strategyAdjustments: adaptiveResult.strategyIntelligence.strategyAdjustments,
    communicationAdjustments: adaptiveResult.communicationIntelligence.communicationAdjustments,
    trustAssessment: adaptiveResult.trustIntelligence,
    adaptiveLessons: adaptiveResult.adaptiveLessons,
    adaptivePolicyUpdates: adaptiveResult.adaptivePolicyUpdates,
    decisionMemory: decisionMemoryResult.decisionMemory,
    decisionMemoryResult,
    decisionHistory: decisionMemoryResult.decisionHistory,
    wisdomLessons: decisionMemoryResult.wisdomLessons,
    whenNotToActReasons: decisionMemoryResult.whenNotToActReasons,
    wisdomRecommendations: decisionMemoryResult.wisdomRecommendations,
    trustCalibrationHistory: decisionMemoryResult.trustCalibrationHistory,
    learningResult,
    reflection,
    memoryRecall,
    deliberation,
    patternIntelligence,
    patternMatches: patternIntelligence.patternMatches,
    earlyWarnings: patternIntelligence.earlyWarnings,
    patternBasedRecommendations: patternIntelligence.patternBasedRecommendations,
    patternConfidence: patternIntelligence.patternConfidence,
    scientificResult,
    primaryHypothesis: scientificResult.hypotheses[0] || null,
    challengedAssumptions: scientificResult.challenges,
    primaryUncertainty: scientificResult.primaryUncertainty,
    uncertaintyReductionActions: scientificResult.uncertaintyReductionActions,
    decisionQualitySignals: scientificResult.decisionQualitySignals,
    assumptions: deliberation.assumptions,
    alternatives: deliberation.alternativesConsidered,
    tradeoffs: deliberation.tradeoffs,
    recommendationReadiness: deliberation.recommendationReadiness,
    whatWouldChangeRecommendation: deliberation.whatWouldChangeRecommendation,
    memoryInfluences: memoryRecall.memoryInfluences,
    pastLessons: memoryRecall.pastLessons,
    recurringPatterns: [
      ...memoryRecall.patterns,
      ...patternIntelligence.recurringIssues,
    ],
    similarPastEvents,
    missingData: evidenceReview.missingData,
    confidence: runtime.overallConfidence,
    nextBestActions: [
      learningResult.futureAdjustments[0],
      predictionResult.recoveryActions[0]?.action,
      predictiveReality.opportunities[0]?.recoveryAction,
      predictiveReality.risks[0]?.verificationNeeded,
      executiveJudgmentResult.waitForEvidenceReasoning.shouldWaitForEvidence
        ? executiveJudgmentResult.waitForEvidenceReasoning.smallestEvidenceRequest
        : null,
      executiveJudgmentResult.decisionTiming.recommendation === 'escalate_now'
        ? executiveJudgmentResult.escalationAnalysis.target.ask
        : null,
      executiveJudgmentResult.highestValueAction?.action,
      executiveReasoning.highestValueAction?.action,
      runtime.nextBestAction.title,
      runtime.nextBestAction.suggestedNextAction,
      missingEvidence.minimumEvidenceNeeded[0]?.suggestedCaptureAction,
      ...runtime.recommendedEvidence,
    ].filter((action): action is string => Boolean(action)),
    learningSignals: learningResult.learningSignals,
    lessonsLearned: learningResult.lessonsLearned,
    confidenceCalibration: learningResult.confidenceCalibration,
    futureAdjustments: learningResult.futureAdjustments,
    memoryConsolidation: learningResult.memoryConsolidation,
    decisionQualityLearning: learningResult.decisionQualityLearning,
    connectedEngines: [...CORE_ENGINE_CHAIN],
    runtime,
    attention,
    experience,
    reportDraft,
  };
}

export async function buildLivePIECoreIntelligence(
  input: PIECoreInput = {},
): Promise<PIECoreOutput> {
  const runtime = input.runtime || buildRuntime(input.runtimeContext || {});
  const scope = resolvePIERealityAuthorityScope(
    input.organizationId,
    input.projectId,
    runtime,
  );
  return runExclusivePIEAuthorityMutation(
    scope.organizationId,
    scope.projectId,
    () => buildLivePIECoreIntelligenceForScope({ ...input, runtime }),
  );
}

async function buildLivePIECoreIntelligenceForScope(
  input: PIECoreInput,
): Promise<PIECoreOutput> {
  const runtime = input.runtime || buildRuntime(input.runtimeContext || {});
  const reportScope = coreReportScope(input, runtime);
  const liveRealityAuthority = await runPIERealityModelOrchestration({
    runtime,
    organizationId: input.organizationId,
    projectId: input.projectId,
    identityTrusted: input.identityTrusted,
    cloudAvailable: input.cloudAvailable,
    expectedMinimumModelVersion: input.expectedMinimumRealityModelVersion,
  });
  const core = buildPIECoreIntelligence({
    ...input,
    runtime,
    enforceLiveReality: true,
    organizationId: liveRealityAuthority.organizationId,
    projectId: liveRealityAuthority.projectId,
    authoritativeRealityModel: liveRealityAuthority.model,
    liveRealityAuthority,
  });
  const executiveJudgmentRecord = await persistStructuredExecutiveJudgment({
    result: core.executiveJudgmentResult,
    realityModel: core.realityModel,
    situationSummary: core.situationSummary.headline,
    cloudEnabled: input.cloudAvailable,
    identityTrusted: input.identityTrusted,
  });
  // Core already computed and validated these deterministic products. The
  // live wrapper persists the judgment record, then attaches its immutable ID
  // to simulation provenance instead of rerunning the full option/sensitivity
  // pipeline on the React Native JS thread.
  const decisionSimulation = {
    ...core.decisionSimulation,
    provenance: {
      ...core.decisionSimulation.provenance,
      executiveJudgmentId: executiveJudgmentRecord.id,
    },
  };
  const recommendationChallenge = core.recommendationChallenge;
  const jarvisReasoningValidation = core.jarvisReasoningValidation;
  const confidenceDecomposition = core.confidenceDecomposition;
  const evidenceValuePrioritization = core.evidenceValuePrioritization;
  const reportDraft = buildPIEReportDraftFromExecutiveJudgment({
    reportType: reportScope.reportType,
    audience: 'internal_team',
    selectedProjectNames: reportScope.projectNames,
    currentUpdate: input.runtimeContext?.currentUpdate,
    savedUpdates: input.runtimeContext?.updates,
    scheduleItems: input.runtimeContext?.scheduleItems,
    projectAreas: input.runtimeContext?.projectAreas,
    contacts: input.runtimeContext?.contacts,
    runtime: {
      ...core.runtime,
      executiveJudgmentRecord,
      executiveJudgment: core.executiveJudgmentResult,
      executiveJudgmentSummary: core.executiveJudgmentSummary,
      executiveJudgmentHighestValueAction: core.executiveJudgmentHighestValueAction,
      bestNextStep: core.bestNextStep,
      decisionNeeded: core.decisionNeeded,
      recommendationWhy: core.recommendationWhy,
      recommendationAlternatives: core.recommendationAlternatives,
      recommendationSuccessMeasure: core.recommendationSuccessMeasure,
      decisionSimulation,
      recommendationChallenge,
      jarvisReasoningValidation,
      confidenceDecomposition,
      evidenceValuePrioritization,
      realityModel: core.realityModel,
      realitySummary: core.realitySummary,
      situationIntelligence: core.situationIntelligence,
      situationSummary: core.situationSummary.headline,
    },
    executiveJudgmentRecord,
    generatedAt: new Date(core.generatedAt),
  });

  return {
    ...core,
    executiveJudgmentRecord,
    decisionSimulation,
    simulatedOptions: decisionSimulation.options,
    simulationScenarios: decisionSimulation.scenarios,
    optionScores: decisionSimulation.scores,
    simulationSensitivity: decisionSimulation.sensitivityAnalysis,
    simulationProvenance: decisionSimulation.provenance,
    recommendationChallenge,
    jarvisReasoningValidation,
    confidenceDecomposition,
    evidenceValuePrioritization,
    highestValueEvidenceRequest: evidenceValuePrioritization.highestValueEvidence,
    decisionProvenance: decisionSimulation.provenance,
    reportDraft,
  };
}

function buildEvidenceReview(
  runtime: PIERuntimeState,
  memoryRecall: PIEMemoryRecallResult,
): PIEEvidenceReview {
  return {
    summary: memoryRecall.memories.length > 0
      ? `${runtime.evidenceFusionSummary.summary} ${memoryRecall.summaryForPIE}`
      : runtime.evidenceFusionSummary.summary,
    receivedData: [
      runtime.evidenceFusionSummary.scheduleItemCount > 0 ? 'schedule' : '',
      runtime.evidenceFusionSummary.photoCount > 0 ? 'photos' : '',
      runtime.evidenceFusionSummary.gpsAvailable ? 'gps' : '',
      runtime.evidenceFusionSummary.userUpdateCount > 0 ? 'notes' : '',
      runtime.evidenceFusionSummary.issueCount > 0 ? 'issues' : '',
      runtime.evidenceFusionSummary.safetyCount > 0 ? 'safety' : '',
    ].filter(Boolean),
    missingData: [
      ...runtime.evidenceGaps.map(gap => gap.summary),
      ...runtime.graphGaps.map(gap => gap.summary),
      ...runtime.recommendedEvidence,
      ...memoryRecall.memoryInfluences
        .filter(influence => influence.appliesTo === 'interpretation')
        .map(influence => influence.influence),
    ],
    conflicts: runtime.evidenceConflicts.map(conflict => conflict.summary),
    sourceCount: runtime.evidenceFusionSummary.sourceCount,
    confidence: runtime.evidenceFusionSummary.confidence,
  };
}

function scheduleSummaryText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      record.summary,
      record.status,
      record.upcomingSummary,
      record.overdueSummary,
      record.criticalSummary,
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' ');
  }
  return '';
}

/**
 * Audit P1-02: evidence freshness comes from real captured timestamps on the
 * underlying evidence, never from the analysis run time. Missing timestamps
 * stay null so quality scoring treats them honestly as unknown-age.
 */
function latestRealCapturedAt(
  candidates: readonly (string | null | undefined)[],
): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = Date.parse(candidate);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

function conservativeEvidenceConfidence(
  values: readonly ProjectConfidenceLevel[],
): ProjectConfidenceLevel {
  if (values.length === 0 || values.some(value => value === 'low')) return 'low';
  if (values.some(value => value === 'medium')) return 'medium';
  return 'high';
}

export function buildRuntimeEvidenceQualityInputs(
  runtime: PIERuntimeState,
  memoryRecall: PIEMemoryRecallResult,
): PIEEvidenceQualityInput[] {
  const projectName = runtime.projectName || runtime.projectNames[0] || null;
  const areaName = runtime.recommendedWalkAreas[0] || null;
  const fused = runtime.fusedEvidence;
  const scheduleCapturedAt = latestRealCapturedAt(
    fused.scheduleEvidence.flatMap(item => [
      item.importedAt,
      ...item.sources.map(source => source.capturedAt),
    ]),
  );
  const photoCapturedAt = latestRealCapturedAt(
    fused.photoEvidence.map(item => item.timestamp),
  );
  const gpsCapturedAt = latestRealCapturedAt(
    fused.gpsEvidence.sources.map(source => source.capturedAt),
  );
  const notesCapturedAt = latestRealCapturedAt(
    fused.userUpdateEvidence.flatMap(item => [
      item.date,
      ...item.sources.map(source => source.capturedAt),
    ]),
  );
  const issuesCapturedAt = latestRealCapturedAt(
    fused.issueEvidence.flatMap(item => item.sources.map(source => source.capturedAt)),
  );
  const safetyCapturedAt = latestRealCapturedAt(
    fused.safetyEvidence.flatMap(item => item.sources.map(source => source.capturedAt)),
  );
  const overallCapturedAt = latestRealCapturedAt([
    scheduleCapturedAt,
    photoCapturedAt,
    gpsCapturedAt,
    notesCapturedAt,
    issuesCapturedAt,
    safetyCapturedAt,
  ]);

  const inputs: PIEEvidenceQualityInput[] = [
    {
      id: 'quality-runtime-summary',
      source: 'runtime',
      summary: runtime.intelligentSummary.whatChanged || runtime.evidenceFusionSummary.summary,
      projectName,
      areaName,
      capturedAt: overallCapturedAt,
      gpsConfirmed: fused.gpsEvidence.gpsAvailable && fused.gpsEvidence.confidenceScore >= 70,
      photoSupported: fused.photoEvidence.length > 0,
      scheduleSupported: fused.scheduleEvidence.length > 0,
      userConfirmed: false,
      matchesPriorEvidence: memoryRecall.memories.length > 0,
      confidence: runtime.overallConfidence,
    },
    {
      id: 'quality-schedule',
      source: 'schedule',
      summary: runtime.intelligentSummary.scheduleStatus,
      projectName,
      areaName,
      capturedAt: scheduleCapturedAt,
      gpsConfirmed: false,
      photoSupported: false,
      scheduleSupported: fused.scheduleEvidence.length > 0,
      // A clean import is not a human confirmation. Only an explicit PM
      // progress source carries that authority.
      userConfirmed: fused.scheduleEvidence.some(item =>
        item.sources.some(source => source.type === 'typed-update'),
      ),
      matchesPriorEvidence: memoryRecall.patterns.length > 0,
      unreviewedOCR: runtime.scheduleSummary.needsReviewCount > 0,
      confidence: fused.scheduleEvidence.length > 0
        ? runtime.scheduleConfidence
        : 'low',
    },
    {
      id: 'quality-photo',
      source: 'photo',
      summary: runtime.intelligentSummary.photoEvidenceSummary,
      projectName,
      areaName,
      capturedAt: photoCapturedAt,
      gpsConfirmed: fused.gpsEvidence.gpsAvailable,
      photoSupported: fused.photoEvidence.length > 0,
      scheduleSupported: false,
      // Provider/JARVIS review state is not a human confirmation event.
      userConfirmed: false,
      matchesPriorEvidence: runtime.lastComparison !== null,
      confidence: fused.photoEvidence.length > 0
        ? runtime.comparisonConfidence
        : 'low',
    },
    {
      id: 'quality-gps',
      source: 'gps',
      summary: runtime.intelligentSummary.gpsLocationConfidence,
      projectName,
      areaName,
      capturedAt: gpsCapturedAt,
      gpsConfirmed: fused.gpsEvidence.gpsAvailable && fused.gpsEvidence.confidenceScore >= 70,
      photoSupported: false,
      scheduleSupported: false,
      userConfirmed: false,
      matchesPriorEvidence: false,
      confidence: fused.gpsEvidence.confidenceScore >= 70
        ? 'high'
        : fused.gpsEvidence.confidenceScore >= 45
          ? 'medium'
          : 'low',
    },
    {
      id: 'quality-notes',
      source: 'notes',
      summary: runtime.intelligentSummary.userUpdateSummary,
      projectName,
      areaName,
      capturedAt: notesCapturedAt,
      gpsConfirmed: false,
      photoSupported: fused.photoEvidence.length > 0,
      scheduleSupported: false,
      // Audit P1-02: confirmed only when an actual user note exists.
      userConfirmed: fused.userUpdateEvidence.some(item => Boolean(item.notes?.trim())),
      matchesPriorEvidence: memoryRecall.memories.length > 0,
      confidence: fused.userUpdateEvidence.length > 0
        ? conservativeEvidenceConfidence(
            fused.userUpdateEvidence.map(item => item.confidence),
          )
        : 'low',
    },
    {
      id: 'quality-issues',
      source: 'issues',
      summary: runtime.intelligentSummary.risksAndIssues,
      projectName,
      areaName,
      capturedAt: issuesCapturedAt,
      gpsConfirmed: false,
      photoSupported: fused.photoEvidence.length > 0,
      scheduleSupported: fused.scheduleEvidence.length > 0,
      // Audit P1-02: derived issue summaries carry no confirmation event.
      userConfirmed: false,
      matchesPriorEvidence: memoryRecall.comparisons.length > 0,
      confidence: conservativeEvidenceConfidence(
        fused.issueEvidence.map(item => item.confidence),
      ),
    },
    {
      id: 'quality-safety',
      source: 'safety',
      summary: runtime.intelligentSummary.safetySummary,
      projectName,
      areaName,
      capturedAt: safetyCapturedAt,
      gpsConfirmed: false,
      photoSupported: fused.photoEvidence.length > 0,
      scheduleSupported: false,
      // Audit P1-02: derived safety summaries carry no confirmation event.
      userConfirmed: false,
      matchesPriorEvidence: memoryRecall.patterns.length > 0,
      confidence: conservativeEvidenceConfidence(
        fused.safetyEvidence.map(item => item.confidence),
      ),
    },
    {
      id: 'quality-report-history',
      source: 'reports',
      summary:
        fused.reportEvidence.length > 0
          ? `${fused.reportEvidence.length} previous report evidence item${fused.reportEvidence.length === 1 ? '' : 's'} available.`
          : 'No previous report evidence is available.',
      projectName,
      areaName: null,
      capturedAt: null,
      gpsConfirmed: false,
      photoSupported: false,
      scheduleSupported: false,
      userConfirmed: false,
      matchesPriorEvidence: memoryRecall.memories.length > 0,
      confidence: fused.reportEvidence.length > 0 ? 'medium' : 'low',
    },
  ];

  return inputs.filter(item => item.summary.trim().length > 0);
}

function buildRuntimeMissingEvidenceInput(
  runtime: PIERuntimeState,
  evidenceQuality: PIEEvidenceQualityResult,
): PIEMissingEvidenceInput {
  const projectName = runtime.projectName || runtime.projectNames[0] || null;
  const priorityTask =
    runtime.overdueTasks[0] ||
    runtime.criticalTasks[0] ||
    runtime.upcomingTasks[0] ||
    null;
  const areaName =
    priorityTask?.area ||
    runtime.recommendedWalkAreas[0] ||
    null;
  const fused = runtime.fusedEvidence;
  const reportDraft = runtime.response.reportDraft;
  const hasOpenSafetyConcern = fused.safetyEvidence.some(item => item.isOpen);
  const hasOwner =
    reportDraft.actionItems.length === 0 ||
    reportDraft.actionItems.every(item => !item.needsOwner);
  const hasDecision =
    reportDraft.decisionsNeeded.length === 0 &&
    runtime.priorityQueue.approvalRequired.length === 0;

  return {
    projectName,
    areaName,
    currentTask: priorityTask?.task || null,
    schedulePriority:
      priorityTask?.task ||
      runtime.scheduleIntelligence.criticalPathSummary ||
      null,
    reportNeedsReview:
      runtime.response.reportNeedsReview ||
      reportDraft.needsReview ||
      reportDraft.reviewFlags.length > 0,
    needsUserConfirmation:
      runtime.overallConfidence === 'low' ||
      runtime.comparisonNeedsReview ||
      runtime.scheduleSummary.needsReviewCount > 0 ||
      evidenceQuality.evidenceReadiness === 'conflicting' ||
      evidenceQuality.evidenceReadiness === 'insufficient',
    hasAnyPhoto: fused.photoEvidence.length > 0,
    hasCurrentPhoto:
      fused.photoEvidence.length > 0 &&
      !runtime.comparisonNeedsReview &&
      evidenceQuality.staleEvidence.every(item => item.evidence.source !== 'photo'),
    hasLocation:
      fused.gpsEvidence.gpsAvailable &&
      fused.gpsEvidence.confidenceScore >= 60 &&
      Boolean(projectName || areaName),
    hasSchedule: runtime.scheduleSummary.totalItems > 0 || fused.scheduleEvidence.length > 0,
    hasOwner,
    hasDecision,
    hasInspectionStatus:
      runtime.scheduleSummary.totalItems === 0 ||
      runtime.milestones.length > 0 ||
      runtime.criticalTasks.length === 0,
    hasSafetyConfirmation: !hasOpenSafetyConcern,
    hasProgressNote: fused.userUpdateEvidence.length > 0,
    hasDocument: fused.documentEvidence.length > 0 || runtime.evidenceGaps.every(gap => !/document/i.test(gap.summary)),
    hasReportReview: !runtime.response.reportNeedsReview,
    evidenceQuality,
    runtimeEvidenceGaps: [
      ...runtime.evidenceGaps.map(gap => gap.summary),
      ...runtime.graphGaps.map(gap => gap.summary),
    ],
    recommendedEvidence: runtime.recommendedEvidence,
  };
}

function buildRuntimeEvidenceTimelineEvents(
  runtime: PIERuntimeState,
): PIEEvidenceTimelineEvent[] {
  const generatedAt = runtime.generatedAt;
  const fused = runtime.fusedEvidence;

  const scheduleEvents = fused.scheduleEvidence.flatMap(item => {
    const importedAt = item.importedAt || item.dueDate || item.startDate || generatedAt;
    const events: PIEEvidenceTimelineEvent[] = [{
      id: `timeline-schedule-imported-${item.id}`,
      type: 'schedule_imported',
      occurredAt: importedAt,
      projectName: item.projectName,
      areaName: item.areaName,
      workPackage: item.taskName,
      issueId: null,
      scheduleItemId: item.id,
      decisionId: null,
      summary: `${item.taskName} schedule imported with status ${item.status}.`,
      source: item.importedFrom || 'schedule',
      confidence: item.confidence,
    }];

    if (item.isOverdue || item.needsReview || item.percentComplete > 0) {
      events.push({
        id: `timeline-schedule-changed-${item.id}`,
        type: 'schedule_changed',
        occurredAt: item.dueDate || importedAt,
        projectName: item.projectName,
        areaName: item.areaName,
        workPackage: item.taskName,
        issueId: null,
        scheduleItemId: item.id,
        decisionId: null,
        summary: `${item.taskName} is ${item.status} with ${item.percentComplete}% complete.`,
        source: 'schedule',
        confidence: item.confidence,
      });
    }

    return events;
  });

  const photoEvents = fused.photoEvidence.map(photo => ({
    id: `timeline-photo-${photo.id}`,
    type: 'photo_added' as const,
    occurredAt: photo.timestamp || generatedAt,
    projectName: photo.projectName,
    areaName: photo.areaName,
    workPackage: photo.category || null,
    issueId: photo.isIssue ? photo.id : null,
    scheduleItemId: null,
    decisionId: null,
    summary: photo.caption || photo.actionRequired || 'Photo evidence added.',
    source: 'photo',
    confidence: photo.confidence,
  }));

  const gpsEvents = fused.gpsEvidence.gpsAvailable
    ? [{
        id: 'timeline-gps-confirmed',
        type: 'GPS_confirmed' as const,
        occurredAt: generatedAt,
        projectName: fused.gpsEvidence.recommendedProject || runtime.projectName || null,
        areaName: fused.gpsEvidence.recommendedArea,
        workPackage: null,
        issueId: null,
        scheduleItemId: null,
        decisionId: null,
        summary: fused.gpsEvidence.evidence[0] || 'GPS confirmed project location context.',
        source: 'gps',
        confidence: fused.gpsEvidence.confidence,
      }]
    : [];

  const noteEvents = fused.userUpdateEvidence.map(update => ({
    id: `timeline-note-${update.id}`,
    type: 'note_added' as const,
    occurredAt: update.date || generatedAt,
    projectName: update.projectName,
    areaName: update.areaName,
    workPackage: null,
    issueId: null,
    scheduleItemId: null,
    decisionId: null,
    summary: update.notes || 'Progress note added.',
    source: 'typed-update',
    confidence: update.confidence,
  }));

  const issueEvents = fused.issueEvidence.map(issue => ({
    id: `timeline-issue-${issue.id}`,
    type: /resolved|closed|complete/i.test(issue.status)
      ? 'issue_resolved' as const
      : 'issue_opened' as const,
    occurredAt: issue.dueDate || generatedAt,
    projectName: issue.projectName,
    areaName: issue.areaName,
    workPackage: null,
    issueId: issue.id,
    scheduleItemId: null,
    decisionId: null,
    summary: issue.title,
    source: 'issue',
    confidence: issue.confidence,
  }));

  const safetyEvents = fused.safetyEvidence.map(item => ({
    id: `timeline-safety-${item.id}`,
    type: item.isOpen ? 'issue_opened' as const : 'issue_resolved' as const,
    occurredAt: item.dueDate || generatedAt,
    projectName: item.projectName,
    areaName: item.areaName,
    workPackage: 'safety',
    issueId: item.id,
    scheduleItemId: null,
    decisionId: null,
    summary: item.title,
    source: 'safety',
    confidence: item.confidence,
  }));

  const decisionEvents = runtime.executiveQuestions.map((question, index) => ({
    id: `timeline-decision-needed-${index + 1}`,
    type: 'decision_needed' as const,
    occurredAt: generatedAt,
    projectName: runtime.projectName || runtime.projectNames[0] || null,
    areaName: runtime.recommendedWalkAreas[0] || null,
    workPackage: null,
    issueId: null,
    scheduleItemId: null,
    decisionId: question.id,
    summary: question.question,
    source: 'executive-question',
    confidence: question.confidence,
  }));

  const reportEvents = fused.reportEvidence.map((report, index) => ({
    id: `timeline-report-${report.recordId || index + 1}`,
    type: 'report_generated' as const,
    occurredAt: report.capturedAt || generatedAt,
    projectName: runtime.projectName || runtime.projectNames[0] || null,
    areaName: null,
    workPackage: null,
    issueId: null,
    scheduleItemId: null,
    decisionId: null,
    summary: report.label,
    source: report.type,
    confidence: report.confidence,
  }));

  const reportApprovalEvents = runtime.response.reportNeedsReview
    ? []
    : [{
        id: 'timeline-report-approved-current',
        type: 'report_approved' as const,
        occurredAt: generatedAt,
        projectName: runtime.projectName || runtime.projectNames[0] || null,
        areaName: null,
        workPackage: null,
        issueId: null,
        scheduleItemId: null,
        decisionId: null,
        summary: 'Current report does not require review.',
        source: 'report',
        confidence: runtime.response.reportReadiness === 'high' ? 'high' as const : 'medium' as const,
      }];

  return [
    ...scheduleEvents,
    ...photoEvents,
    ...gpsEvents,
    ...noteEvents,
    ...issueEvents,
    ...safetyEvents,
    ...decisionEvents,
    ...reportEvents,
    ...reportApprovalEvents,
  ].filter(event => event.summary.trim().length > 0);
}

function buildRuntimeRealitySourceObjects(
  runtime: PIERuntimeState,
  perception: {
    evidenceQuality: PIEEvidenceQualityResult;
    missingEvidence: PIEMissingEvidenceResult;
    evidenceTimeline: PIEEvidenceTimeline;
  },
  organizationId = 'local-unverified-anonymous',
  projectId = stableCoreProjectId(runtime.projectName || runtime.projectNames[0] || 'Project'),
): PIERealitySourceObject[] {
  const projectName = runtime.projectName || runtime.projectNames[0] || 'Project';
  const generatedAt = runtime.generatedAt;
  const fused = runtime.fusedEvidence;
  const objects: PIERealitySourceObject[] = [{
    id: `reality-project-${normalizeRealityId(projectName)}`,
    organizationId,
    projectId,
    type: 'project',
    name: projectName,
    projectName,
    areaName: null,
    summary: runtime.intelligentSummary.projectStatus || runtime.evidenceFusionSummary.summary,
    status: runtime.missionComplete ? 'complete' : 'in_progress',
    confidence: runtime.overallConfidence,
    evidenceType: 'runtime',
    evidenceId: 'runtime-project',
    knowledgeType: 'belief',
    updatedAt: generatedAt,
    nextAction: runtime.nextBestAction.suggestedNextAction,
    uncertain: runtime.overallConfidence === 'low',
  }];

  for (const group of runtime.scheduleSummary.byArea) {
    objects.push({
      id: `reality-area-${normalizeRealityId(projectName)}-${normalizeRealityId(group.name)}`,
      organizationId,
      projectId,
      type: 'area',
      name: group.name,
      projectName,
      areaName: group.name,
      summary: `${group.count} schedule item${group.count === 1 ? '' : 's'} tracked. ${group.overdueCount} overdue, ${group.upcoming30Count} upcoming in 30 days.`,
      status: group.overdueCount > 0 ? 'at_risk' : group.completedCount === group.count ? 'complete' : 'in_progress',
      confidence: runtime.scheduleConfidence,
      evidenceType: 'schedule',
      evidenceId: `schedule-area-${group.name}`,
      knowledgeType: 'timeline',
      updatedAt: generatedAt,
      nextAction: group.overdueCount > 0 ? `Verify overdue work in ${group.name}.` : `Capture current evidence for ${group.name}.`,
      stale: perception.evidenceTimeline.staleAreas.some(gap => gap.areaName === group.name),
      uncertain: group.count === 0,
    });
  }

  for (const item of fused.scheduleEvidence) {
    objects.push({
      id: `reality-schedule-${item.id}`,
      organizationId,
      projectId,
      type: item.isMilestone ? 'milestone' : 'schedule_activity',
      name: item.taskName,
      projectName: item.projectName,
      areaName: item.areaName,
      summary: `${item.taskName} is ${item.status} with ${item.percentComplete}% complete.`,
      status: item.isComplete ? 'complete' : item.isOverdue ? 'at_risk' : item.needsReview ? 'needs_verification' : item.percentComplete > 0 ? 'in_progress' : 'not_started',
      confidence: item.confidence,
      evidenceType: 'schedule',
      evidenceId: item.id,
      knowledgeType: 'timeline',
      updatedAt: item.importedAt || item.dueDate || generatedAt,
      nextAction: item.needsReview ? `Review schedule activity ${item.taskName}.` : null,
      stale: perception.evidenceTimeline.staleAreas.some(gap => gap.areaName === item.areaName),
      uncertain: item.needsReview,
    });
  }

  for (const update of fused.userUpdateEvidence) {
    objects.push({
      id: `reality-note-${update.id}`,
      organizationId,
      projectId,
      type: 'work_package',
      name: update.notes?.slice(0, 80) || 'Progress note',
      projectName: update.projectName,
      areaName: update.areaName,
      summary: update.notes || 'Progress note added.',
      status: update.blockers.length > 0 ? 'blocked' : 'in_progress',
      confidence: update.confidence,
      evidenceType: 'typed-update',
      evidenceId: update.id,
      knowledgeType: 'timeline',
      updatedAt: update.date || generatedAt,
      nextAction: update.nextSteps[0] || null,
      uncertain: update.notes === null,
    });
  }

  for (const issue of fused.issueEvidence) {
    objects.push({
      id: `reality-issue-${issue.id}`,
      organizationId,
      projectId,
      type: 'issue',
      name: issue.title,
      projectName: issue.projectName,
      areaName: issue.areaName,
      summary: issue.evidenceText[0] || issue.title,
      status: /resolved|closed|complete/i.test(issue.status) ? 'complete' : issue.isOverdue ? 'blocked' : 'at_risk',
      confidence: issue.confidence,
      evidenceType: 'issue',
      evidenceId: issue.id,
      knowledgeType: 'pattern',
      updatedAt: issue.dueDate || generatedAt,
      nextAction: issue.owner ? `Follow up with ${issue.owner}.` : 'Assign an owner.',
      uncertain: !issue.owner,
    });
  }

  for (const safety of fused.safetyEvidence) {
    objects.push({
      id: `reality-safety-${safety.id}`,
      organizationId,
      projectId,
      type: 'safety_observation',
      name: safety.title,
      projectName: safety.projectName,
      areaName: safety.areaName,
      summary: safety.evidenceText[0] || safety.title,
      status: safety.isOpen ? 'blocked' : 'complete',
      confidence: safety.confidence,
      evidenceType: 'safety',
      evidenceId: safety.id,
      knowledgeType: 'pattern',
      updatedAt: safety.dueDate || generatedAt,
      nextAction: safety.isOpen ? 'Verify safety condition before continuing.' : null,
      uncertain: safety.isOpen,
    });
  }

  for (const document of fused.documentEvidence) {
    objects.push({
      id: `reality-document-${document.recordId || normalizeRealityId(document.label)}`,
      organizationId,
      projectId,
      type: 'document',
      name: document.label,
      projectName,
      areaName: null,
      summary: document.label,
      status: 'ready',
      confidence: document.confidence,
      evidenceType: document.type,
      evidenceId: document.recordId || document.label,
      knowledgeType: 'quality',
      updatedAt: document.capturedAt || generatedAt,
    });
  }

  for (const report of fused.reportEvidence) {
    objects.push({
      id: `reality-report-${report.recordId || normalizeRealityId(report.label)}`,
      organizationId,
      projectId,
      type: 'report',
      name: report.label,
      projectName,
      areaName: null,
      summary: report.label,
      status: runtime.response.reportNeedsReview ? 'needs_verification' : 'ready',
      confidence: report.confidence,
      evidenceType: report.type,
      evidenceId: report.recordId || report.label,
      knowledgeType: 'decision',
      updatedAt: report.capturedAt || generatedAt,
      nextAction: runtime.response.reportNeedsReview ? 'Review report before communication.' : null,
      uncertain: runtime.response.reportNeedsReview,
    });
  }

  for (const gap of perception.missingEvidence.prioritizedItems.slice(0, 5)) {
    objects.push({
      id: `reality-gap-${gap.id}`,
      organizationId,
      projectId,
      type: gap.type.includes('decision') ? 'decision' : 'risk',
      name: gap.title,
      projectName,
      areaName: runtime.recommendedWalkAreas[0] || null,
      summary: gap.summary,
      status: gap.priority === 'critical' || gap.priority === 'high' ? 'at_risk' : 'needs_verification',
      confidence: 'medium',
      evidenceType: 'missing-evidence',
      evidenceId: gap.id,
      knowledgeType: 'missing_evidence',
      updatedAt: generatedAt,
      nextAction: gap.nextCaptureAction,
      uncertain: true,
    });
  }

  return objects;
}

function stableCoreProjectId(projectName: string) {
  return `project-${normalizeRealityId(projectName || 'unassigned') || 'unassigned'}`;
}

function normalizeRealityId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function daysBetweenDates(earlier: string, later: string) {
  const left = new Date(earlier).getTime();
  const right = new Date(later).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((right - left) / 86_400_000));
}

function buildInterpretations(
  runtime: PIERuntimeState,
  memoryRecall: PIEMemoryRecallResult,
): PIEInterpretation[] {
  return [
    {
      id: 'interpretation-summary',
      meaning: `${runtime.intelligentSummary.projectStatus} ${runtime.intelligentSummary.whatChanged}`.trim(),
      source: 'Evidence Fusion',
      confidence: runtime.intelligentSummary.confidence,
    },
    ...memoryRecall.comparisons.slice(0, 3).map((comparison, index) => ({
      id: `interpretation-memory-${index + 1}`,
      meaning: comparison.summary,
      source: 'Memory Recall',
      confidence: comparison.confidence,
    })),
    ...runtime.insights.slice(0, 5).map((insight, index) => ({
      id: `interpretation-insight-${index + 1}`,
      meaning: insight.summary,
      source: insight.source,
      confidence: insight.confidence,
    })),
  ];
}

function buildRelationships(runtime: PIERuntimeState): PIERelationshipAnalysis[] {
  return [
    ...runtime.graphInsights.slice(0, 5).map((insight, index) => ({
      id: `relationship-insight-${index + 1}`,
      relationship: insight.summary,
      connectedFacts: [
        ...insight.nodeIds,
        ...insight.relationshipIds,
      ],
      confidence: insight.confidence,
    })),
    ...runtime.connectedEvidence.slice(0, 5).map((item, index) => ({
      id: `relationship-evidence-${index + 1}`,
      relationship: item.summary,
      connectedFacts: item.evidence.map(evidence => evidence.label),
      confidence: runtime.relationshipConfidence.level,
    })),
  ];
}

function buildBeliefs(
  runtimeBeliefs: RuntimePIEBelief[],
  memoryInfluences: PIEMemoryInfluence[],
): PIEBelief[] {
  return runtimeBeliefs.map(belief => ({
    id: belief.id,
    belief: memoryInfluences.some(influence => influence.appliesTo === 'belief')
      ? `${belief.statement} Memory recall should be considered before treating this belief as final.`
      : belief.statement,
    evidence: belief.supportingEvidence.map(evidence => evidence.title),
    uncertainty: belief.remainingUncertainty,
    confidence: belief.confidence,
  }));
}

function buildOpinions(
  runtime: PIERuntimeState,
  memoryInfluences: PIEMemoryInfluence[],
  deliberation: PIEDeliberationResult,
  scientificResult: PIEScientificResult,
  patternIntelligence: PIEPatternIntelligence,
  beliefSystem: PIEBeliefEngineResult,
  executiveReasoning: PIEExecutiveReasoningResult,
  predictionResult: PIEPredictionResult,
): PIEOpinion[] {
  const priorities = executiveReasoning.priorities.length
    ? executiveReasoning.priorities
    : runtime.executivePriorities.map(priority => ({
        id: priority.id,
        priority: priority.title,
        reason: priority.summary || priority.recommendedAction,
        urgency: priority.priority,
        recommendedAction: priority.recommendedAction,
        confidence: priority.confidence,
      }));

  return priorities.slice(0, 5).map(priority => ({
    id: priority.id,
    opinion: priority.priority,
    strength: priority.urgency === 'critical' || priority.urgency === 'high'
      ? 'strong'
      : priority.urgency === 'medium'
        ? 'moderate'
        : 'weak',
    reason: [
      priority.reason || priority.recommendedAction,
      executiveReasoning.highestValueAction
        ? `Executive Reasoning highest-value action: ${executiveReasoning.highestValueAction.action}.`
        : null,
      executiveReasoning.biggestRisk
        ? `Biggest executive risk: ${executiveReasoning.biggestRisk.risk}.`
        : null,
      predictionResult.mostLikelyOutcome.riskLevel !== 'low'
        ? `Prediction: ${predictionResult.mostLikelyOutcome.likelyOutcome}`
        : null,
      memoryInfluences.find(influence => influence.appliesTo === 'opinion')?.influence,
      deliberation.recommendationReadiness !== 'Ready'
        ? `Deliberation readiness is ${deliberation.recommendationReadiness}.`
        : null,
      scientificResult.primaryUncertainty
        ? `Scientific Method primary uncertainty: ${scientificResult.primaryUncertainty.uncertainty}.`
        : null,
      patternIntelligence.earlyWarnings[0]
        ? `Pattern warning: ${patternIntelligence.earlyWarnings[0].warning}.`
        : null,
      beliefSystem.strongestBeliefs[0]
        ? `Belief support: ${beliefSystem.strongestBeliefs[0].statement}.`
        : null,
    ].filter(Boolean).join(' '),
    confidence: priority.confidence,
  }));
}

function buildDecisionsNeeded(
  runtime: PIERuntimeState,
  executiveReasoning: PIEExecutiveReasoningResult,
): PIEDecisionSupport[] {
  const approvalItems = runtime.priorityQueue.approvalRequired.map(item => ({
    id: item.id,
    decisionNeeded: item.title,
    reason: item.summary,
    options: ['approve', 'correct', 'collect more evidence'],
    approvalRequired: true,
    confidence: item.confidence,
  }));

  const executiveQuestions = runtime.executiveQuestions.map(question => ({
    id: question.id,
    decisionNeeded: question.question,
    reason: question.reason,
    options: ['answer now', 'verify in field', 'defer'],
    approvalRequired: false,
    confidence: question.confidence,
  }));

  const executiveNeeds = executiveReasoning.decisionNeeds.map(decision => ({
    id: decision.id,
    decisionNeeded: decision.decisionNeeded,
    reason: decision.whyNow,
    options: decision.options.map(option => option.toLowerCase()),
    approvalRequired: decision.owner === 'User',
    confidence: decision.confidence,
  }));

  return [...executiveNeeds, ...approvalItems, ...executiveQuestions].slice(0, 8);
}

function buildRecommendations(
  runtimeRecommendations: RuntimePIERecommendation[],
  memoryInfluences: PIEMemoryInfluence[],
  deliberation: PIEDeliberationResult,
  scientificResult: PIEScientificResult,
  patternIntelligence: PIEPatternIntelligence,
  beliefSystem: PIEBeliefEngineResult,
  executiveReasoning: PIEExecutiveReasoningResult,
  predictionResult: PIEPredictionResult,
): PIERecommendation[] {
  return runtimeRecommendations.slice(0, 8).map(recommendation => ({
    id: recommendation.id,
    recommendation: recommendation.title,
    nextAction: [
      recommendation.suggestedNextAction,
      recommendation.id === runtimeRecommendations[0]?.id && executiveReasoning.highestValueAction
        ? `Highest-value action: ${executiveReasoning.highestValueAction.action}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && predictionResult.recoveryActions[0]
        ? `Predicted recovery action: ${predictionResult.recoveryActions[0].action}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && predictionResult.noActionOutcome.riskLevel === 'high'
        ? `No-action consequence: ${predictionResult.noActionOutcome.likelyOutcome}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && executiveReasoning.executiveReadiness !== 'Ready'
        ? `Executive readiness is ${executiveReasoning.executiveReadiness}.`
        : null,
      memoryInfluences.find(influence => influence.appliesTo === 'recommendation')?.influence,
      recommendation.id === runtimeRecommendations[0]?.id
        ? `${deliberation.recommendedAction} Readiness: ${deliberation.recommendationReadiness}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && scientificResult.uncertaintyReductionActions[0]
        ? `Reduce uncertainty by: ${scientificResult.uncertaintyReductionActions[0].action}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && patternIntelligence.patternBasedRecommendations[0]
        ? `Pattern context: ${patternIntelligence.patternBasedRecommendations[0].recommendation}.`
        : null,
      recommendation.id === runtimeRecommendations[0]?.id && beliefSystem.beliefsNeedingVerification[0]
        ? `Verify belief: ${beliefSystem.beliefsNeedingVerification[0].statement}.`
        : null,
    ].filter(Boolean).join(' '),
    evidence: recommendation.evidence,
    confidence: recommendation.confidence,
  }));
}

function buildExplanations(
  runtime: PIERuntimeState,
  recommendations: PIERecommendation[],
  memoryRecall: PIEMemoryRecallResult,
  deliberation: PIEDeliberationResult,
  scientificResult: PIEScientificResult,
  patternIntelligence: PIEPatternIntelligence,
  beliefSystem: PIEBeliefEngineResult,
  executiveReasoning: PIEExecutiveReasoningResult,
  predictionResult: PIEPredictionResult,
): PIEExplanation[] {
  return recommendations.map(recommendation => ({
    id: `explanation-${recommendation.id}`,
    explains: recommendation.recommendation,
    because: [
      ...recommendation.evidence,
      runtime.relationshipConfidence.reasons[0],
      runtime.trustScore.reasons[0],
      memoryRecall.summaryForPIE,
      recommendation.id === recommendations[0]?.id
        ? `Deliberation: ${deliberation.explanation}`
        : null,
      recommendation.id === recommendations[0]?.id
        ? `Scientific Method: ${scientificResult.explanation.summary}`
        : null,
      recommendation.id === recommendations[0]?.id && patternIntelligence.patternMatches[0]
        ? `Pattern Intelligence: ${patternIntelligence.patternMatches[0].explanation}`
        : null,
      recommendation.id === recommendations[0]?.id && beliefSystem.strongestBeliefs[0]
        ? `Belief: ${beliefSystem.strongestBeliefs[0].explanation.summary}`
        : null,
      recommendation.id === recommendations[0]?.id && executiveReasoning.judgment.explanation
        ? `Executive Reasoning: ${executiveReasoning.judgment.explanation}`
        : null,
      recommendation.id === recommendations[0]?.id && predictionResult.predictionConfidence !== 'low'
        ? `Predictive Simulation: ${predictionResult.explanation.summary}`
        : null,
    ].filter((item): item is string => Boolean(item)),
    uncertainty: [
      ...runtime.unknowns.slice(0, 2).map(unknown => unknown.summary),
      ...runtime.evidenceGaps.slice(0, 2).map(gap => gap.summary),
      ...scientificResult.uncertainty.slice(0, 2).map(item => item.uncertainty),
      ...patternIntelligence.earlyWarnings.slice(0, 2).map(warning => warning.warning),
      ...beliefSystem.beliefsNeedingVerification.slice(0, 2).map(belief => belief.explanation.weakestAssumption),
      ...predictionResult.evidenceThatWouldImprovePrediction.slice(0, 2),
    ],
    confidence: recommendation.confidence,
  }));
}

function buildCoreReflection(runtime: PIERuntimeState): PIEReflectionResult {
  return {
    summary: runtime.reflectionSummary.summary,
    lessonsLearned: runtime.lessonsLearned.map(lesson => lesson.lesson),
    beliefChanges: runtime.beliefChanges.map(change => change.reason),
    confidenceChanges: runtime.confidenceChanges.map(change => change.reason),
    recommendedEvidence: runtime.recommendedEvidence,
    confidence: runtime.reflectionConfidence,
  };
}
