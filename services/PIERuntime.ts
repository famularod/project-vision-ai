import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
  ProjectRecommendation as ProjectIntelligenceRecommendation,
} from './ProjectIntelligenceEngine';
import type {
  PIEDecision,
  PIEDecisionPriority,
  PIEDecisionQueue,
  PIENextBestAction,
} from './PIEDecisionEngine';
import type {
  PIEConversation,
  PIEConversationContext,
  PIEConversationResponse,
  PIEConversationState,
  PIEConversationSuggestion,
} from './PIEConversationEngine';
import { buildConversation } from './PIEConversationEngine';
import type {
  PIEMemoryGap,
  PIEMemoryInsight,
  PIEMemorySnapshot,
} from './PIEMemoryEngine';
import type {
  PIEConcern,
  PIEEvidence,
  PIEQuestion,
  PIEReasoningResult,
  PIEThoughtRecommendation,
} from './PIEReasoningEngine';
import type {
  ProjectEvent,
  ProjectStory,
} from './ProjectEventService';
import {
  buildPIEKnowledgeGraph,
  getBlockedItems,
  getConnectedEvidence,
  getEvidenceForRecommendation,
  getGraphGaps,
  getGraphInsights,
  type PIEGraph,
  type PIEGraphGap,
  type PIEGraphInsight,
  type PIEGraphNode,
  type PIEGraphRelationship,
} from './PIEKnowledgeGraph';
import {
  buildExecutivePriorities,
  buildPIEExecutiveBrief,
  getExecutiveDailyRoutine,
  getExecutiveEscalations,
  getExecutivePreparations,
  getExecutiveQuestions,
  getProjectsNeedingAttention,
  getRecommendedOperatingMode,
  type PIEExecutiveAttentionItem,
  type PIEExecutiveBrief,
  type PIEExecutiveEscalation,
  type PIEExecutiveOperatingMode,
  type PIEExecutivePreparation,
  type PIEExecutivePriority,
  type PIEExecutiveQuestion,
  type PIEExecutiveRecommendation,
  type PIEExecutiveRoutine,
} from './PIEExecutive';
import {
  buildDailyMission,
  buildMission,
  buildMissionSummary,
  buildProjectMission,
  getMissionBlockers,
  getMissionEvidence,
  getMissionObjective,
  getMissionProgress,
  getMissionRecommendations,
  getMissionSuccessCriteria,
  getNextMission,
  isMissionComplete,
  type PIEMission,
  type PIEMissionBlocker,
  type PIEMissionEvidence,
  type PIEMissionObjective,
  type PIEMissionProgress,
  type PIEMissionRecommendation,
  type PIEMissionSuccessCriteria,
  type PIEMissionSummary,
  type PIEMissionTransition,
} from './PIEMissionEngine';

export type PIERuntimeSurface =
  | 'home'
  | 'projects'
  | 'project-overview'
  | 'capture'
  | 'reports'
  | 'project-assistant'
  | 'project-walk'
  | 'global';

export type PIERuntimeContext = PIEConversationContext & {
  surface?: PIERuntimeSurface;
};

export type PIERuntimeSource =
  | 'evidence-engine'
  | 'event-engine'
  | 'knowledge-graph'
  | 'intelligence-engine'
  | 'reasoning-engine'
  | 'memory-engine'
  | 'decision-engine'
  | 'conversation-engine'
  | 'pie-executive'
  | 'mission-engine'
  | 'runtime';

export type PIEPriority = PIEDecisionPriority;

export type PIETrustScoreLevel = ProjectConfidenceLevel;

export type PIETrustScoreFactorStatus =
  | 'strong'
  | 'adequate'
  | 'weak'
  | 'missing'
  | 'conflicting';

export type PIETrustScoreFactor = {
  id: string;
  label: string;
  score: number;
  weight: number;
  status: PIETrustScoreFactorStatus;
  reason: string;
  improvementSuggestion: string;
};

export type PIETrustScore = {
  overallScore: number;
  level: PIETrustScoreLevel;
  reasons: string[];
  improvementSuggestions: string[];
  factors: PIETrustScoreFactor[];
  generatedAt: string;
};

export type PIEUnderstandingScoreLevel = ProjectConfidenceLevel;

export type PIEUnderstandingScoreFactor = {
  id: string;
  label: string;
  score: number;
  weight: number;
  present: boolean;
  reason: string;
  missingInformation: string | null;
  improvementSuggestion: string;
};

export type PIEUnderstandingScore = {
  score: number;
  level: PIEUnderstandingScoreLevel;
  missingInformation: string[];
  improvementSuggestions: string[];
  factors: PIEUnderstandingScoreFactor[];
  generatedAt: string;
};

export type PIEBeliefConfidence = ProjectConfidenceLevel;

export type PIEBeliefStatus =
  | 'supported'
  | 'contested'
  | 'uncertain'
  | 'stale';

export type PIEBeliefEvidence = {
  id: string;
  title: string;
  detail: string;
  source: PIERuntimeSource | string;
  confidence: ProjectConfidenceLevel;
  occurredAt: string | null;
  relatedRecordId?: string | null;
};

export type PIEBelief = {
  id: string;
  projectName: string;
  statement: string;
  status: PIEBeliefStatus;
  confidence: PIEBeliefConfidence;
  supportingEvidence: PIEBeliefEvidence[];
  contradictingEvidence: PIEBeliefEvidence[];
  remainingUncertainty: string[];
  createdAt: string;
  source: PIERuntimeSource;
};

export type PIEPreparednessScoreLevel = ProjectConfidenceLevel;

export type PIEPreparednessArea =
  | 'executive-meeting'
  | 'customer-update'
  | 'project-walk'
  | 'report'
  | 'decision';

export type PIEPreparednessScoreFactor = {
  id: string;
  area: PIEPreparednessArea;
  label: string;
  score: number;
  weight: number;
  level: PIEPreparednessScoreLevel;
  reason: string;
  missingItems: string[];
  improvementSuggestions: string[];
};

export type PIEPreparednessScore = {
  score: number;
  level: PIEPreparednessScoreLevel;
  reasons: string[];
  missingItems: string[];
  improvementSuggestions: string[];
  factors: PIEPreparednessScoreFactor[];
  generatedAt: string;
};

export type PIERecommendation = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  priority: PIEDecisionPriority;
  source: PIERuntimeSource;
  sources: string[];
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  impact: string;
  suggestedNextAction: string;
  requiresApproval: boolean;
};

export type PIEUnknown = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  impact: string;
  suggestedAction: string;
  source: PIERuntimeSource;
  confidence: ProjectConfidenceLevel;
  priority: PIEDecisionPriority;
};

export type PIEInsight = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  whyItMatters: string;
  source: PIERuntimeSource;
  confidence: ProjectConfidenceLevel;
  priority: PIEDecisionPriority;
  evidence: string[];
  suggestedNextAction: string;
};

export type PIERuntimeConnectedEvidence = {
  nodeId: string;
  nodeType: PIEGraphNode['type'];
  label: string;
  summary: string;
  evidence: PIEGraphNode[];
};

export type PIERuntimeRecommendationEvidence = {
  recommendationId: string;
  recommendationTitle: string;
  evidence: PIEGraphNode[];
};

export type PIERuntimeAreaLinkedRisk = {
  area: string;
  risk: string;
  relationship: PIEGraphRelationship;
  confidence: ProjectConfidenceLevel;
  evidence: PIEGraphNode[];
};

export type PIERuntimeRelationshipConfidence = {
  score: number;
  level: ProjectConfidenceLevel;
  reasons: string[];
  improvementSuggestions: string[];
  relationshipCount: number;
  connectedEvidenceCount: number;
  gapCount: number;
  blockedItemCount: number;
  areaLinkedRiskCount: number;
  generatedAt: string;
};

export type PIERuntimeGraphOutputs = {
  graph: PIEGraph;
  graphInsights: PIEGraphInsight[];
  graphGaps: PIEGraphGap[];
  blockedItems: PIEGraphRelationship[];
  connectedEvidence: PIERuntimeConnectedEvidence[];
  evidenceForRecommendations: PIERuntimeRecommendationEvidence[];
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[];
  relationshipConfidence: PIERuntimeRelationshipConfidence;
};

export type PIERuntimeExecutiveOutputs = {
  pieExecutiveBrief: PIEExecutiveBrief;
  executivePriorities: PIEExecutivePriority[];
  projectsNeedingAttention: PIEExecutiveAttentionItem[];
  executiveEscalations: PIEExecutiveEscalation[];
  executivePreparations: PIEExecutivePreparation[];
  executiveQuestions: PIEExecutiveQuestion[];
  executiveDailyRoutine: PIEExecutiveRoutine;
  recommendedOperatingMode: PIEExecutiveOperatingMode;
};

export type PIERuntimeMissionOutputs = {
  currentMission: PIEMission;
  dailyMission: PIEMission;
  projectMission: PIEMission;
  missionSummary: PIEMissionSummary;
  missionObjective: PIEMissionObjective;
  missionProgress: PIEMissionProgress;
  missionBlockers: PIEMissionBlocker[];
  missionEvidence: PIEMissionEvidence[];
  missionRecommendations: PIEMissionRecommendation[];
  missionSuccessCriteria: PIEMissionSuccessCriteria[];
  missionComplete: boolean;
  nextMission: PIEMissionTransition | null;
};

export type PIECurrentUnderstanding = {
  projectName: string;
  generatedAt: string;
  whatPIEKnows: string;
  whatChanged: string;
  whatConcernsPIE: string;
  whatPIERecommends: string;
  whatPIENeedsFromYou: string;
  overallConfidence: ProjectConfidenceLevel;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  currentMission: PIEMission;
  projectUnderstandingScore: number;
  currentPriority: PIERecommendation | null;
  evidenceCount: number;
  eventCount: number;
  unknownCount: number;
  sources: PIERuntimeSource[];
};

export type PIEUnderstanding = PIECurrentUnderstanding;

export type PIEPriorityQueue = {
  projectName: string;
  generatedAt: string;
  nextBestAction: PIENextBestAction;
  currentPriority: PIERecommendation | null;
  recommendations: PIERecommendation[];
  critical: PIERecommendation[];
  communication: PIERecommendation[];
  projectWalk: PIERecommendation | null;
  approvalRequired: PIERecommendation[];
  confidence: ProjectConfidenceLevel;
};

export type PIEBriefing = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  whatPIEKnows: string;
  whatChanged: string;
  whatConcernsPIE: string;
  whatPIERecommends: string;
  whatPIENeedsFromYou: string;
  confidence: ProjectConfidenceLevel;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  priorityQueue: PIEPriorityQueue;
  nextBestAction: PIENextBestAction;
  currentPriority: PIERecommendation | null;
  recommendations: PIERecommendation[];
  insights: PIEInsight[];
  unknowns: PIEUnknown[];
  generatedAt: string;
};

export type PIERuntimeSummary = {
  projectName: string;
  generatedAt: string;
  overallConfidence: ProjectConfidenceLevel;
  currentPriority: string;
  whatPIEKnows: string;
  whatChanged: string;
  whatConcernsPIE: string;
  whatPIERecommends: string;
  whatPIENeedsFromYou: string;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  nextBestAction: PIENextBestAction;
  trustExplanation: string;
  recommendedOperatingMode: PIEExecutiveOperatingMode;
  currentMissionTitle: string;
  currentMissionPurpose: string;
  missionProgressScore: number;
  missionComplete: boolean;
  executivePriorityCount: number;
  executiveEscalationCount: number;
  projectsNeedingAttentionCount: number;
  graphInsightCount: number;
  graphGapCount: number;
  blockedItemCount: number;
  recommendationCount: number;
  insightCount: number;
  unknownCount: number;
};

export type PIERuntimeContractSections = {
  currentBeliefs: PIEBelief[];
  currentUnderstanding: PIEUnderstanding;
  recentChanges: string[];
  currentConcerns: PIEInsight[];
  recommendations: PIERecommendation[];
  needsFromUser: PIEUnknown[];
  projectStory: PIEMemorySnapshot['story'];
  decisionQueue: PIEPriorityQueue;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  graphInsights: PIEGraphInsight[];
  graphGaps: PIEGraphGap[];
  blockedItems: PIEGraphRelationship[];
  connectedEvidence: PIERuntimeConnectedEvidence[];
  evidenceForRecommendations: PIERuntimeRecommendationEvidence[];
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[];
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  pieExecutiveBrief: PIEExecutiveBrief;
  executivePriorities: PIEExecutivePriority[];
  projectsNeedingAttention: PIEExecutiveAttentionItem[];
  executiveEscalations: PIEExecutiveEscalation[];
  executivePreparations: PIEExecutivePreparation[];
  executiveQuestions: PIEExecutiveQuestion[];
  executiveDailyRoutine: PIEExecutiveRoutine;
  recommendedOperatingMode: PIEExecutiveOperatingMode;
  currentMission: PIEMission;
  missionSummary: PIEMissionSummary;
  missionObjective: PIEMissionObjective;
  missionProgress: PIEMissionProgress;
  missionBlockers: PIEMissionBlocker[];
  missionEvidence: PIEMissionEvidence[];
  missionRecommendations: PIEMissionRecommendation[];
  missionSuccessCriteria: PIEMissionSuccessCriteria[];
  missionComplete: boolean;
  nextMission: PIEMissionTransition | null;
};

export type PIERuntimeResponse = {
  id: string;
  projectName: string;
  generatedAt: string;
  currentBeliefs: PIEBelief[];
  currentUnderstanding: PIEUnderstanding;
  recentChanges: string[];
  currentConcerns: PIEInsight[];
  needsFromUser: PIEUnknown[];
  projectStory: PIEMemorySnapshot['story'];
  decisionQueue: PIEPriorityQueue;
  whatPIEKnows: string;
  whatChanged: string;
  whatConcernsPIE: string;
  whatPIERecommends: string;
  whatPIENeedsFromYou: string;
  confidence: ProjectConfidenceLevel;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  graphInsights: PIEGraphInsight[];
  graphGaps: PIEGraphGap[];
  blockedItems: PIEGraphRelationship[];
  connectedEvidence: PIERuntimeConnectedEvidence[];
  evidenceForRecommendations: PIERuntimeRecommendationEvidence[];
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[];
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  pieExecutiveBrief: PIEExecutiveBrief;
  executivePriorities: PIEExecutivePriority[];
  projectsNeedingAttention: PIEExecutiveAttentionItem[];
  executiveEscalations: PIEExecutiveEscalation[];
  executivePreparations: PIEExecutivePreparation[];
  executiveQuestions: PIEExecutiveQuestion[];
  executiveDailyRoutine: PIEExecutiveRoutine;
  recommendedOperatingMode: PIEExecutiveOperatingMode;
  currentMission: PIEMission;
  missionSummary: PIEMissionSummary;
  missionObjective: PIEMissionObjective;
  missionProgress: PIEMissionProgress;
  missionBlockers: PIEMissionBlocker[];
  missionEvidence: PIEMissionEvidence[];
  missionRecommendations: PIEMissionRecommendation[];
  missionSuccessCriteria: PIEMissionSuccessCriteria[];
  missionComplete: boolean;
  nextMission: PIEMissionTransition | null;
  trustExplanation: string;
  priorityQueue: PIEPriorityQueue;
  nextBestAction: PIENextBestAction;
  recommendations: PIERecommendation[];
  insights: PIEInsight[];
  unknowns: PIEUnknown[];
  sections: PIERuntimeContractSections;
};

export type PIERuntimeEngines = {
  evidence: PIEEvidence[];
  events: ProjectEvent[];
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  memory: PIEMemorySnapshot;
  decisions: PIEDecisionQueue;
  conversation: PIEConversation;
  knowledgeGraph: PIEGraph;
  executive: PIEExecutiveBrief;
  mission: PIEMissionSummary;
};

export type PIERuntimeState = {
  id: string;
  projectName: string;
  projectNames: string[];
  generatedAt: string;
  surface: PIERuntimeSurface;
  response: PIERuntimeResponse;
  summary: PIERuntimeSummary;
  understanding: PIEUnderstanding;
  currentUnderstanding: PIECurrentUnderstanding;
  priorityQueue: PIEPriorityQueue;
  morningBrief: PIEBriefing;
  projectBrief: PIEBriefing;
  projectWalkBrief: PIEBriefing;
  executiveBrief: PIEBriefing;
  pieExecutiveBrief: PIEExecutiveBrief;
  executivePriorities: PIEExecutivePriority[];
  projectsNeedingAttention: PIEExecutiveAttentionItem[];
  executiveEscalations: PIEExecutiveEscalation[];
  executivePreparations: PIEExecutivePreparation[];
  executiveQuestions: PIEExecutiveQuestion[];
  executiveDailyRoutine: PIEExecutiveRoutine;
  recommendedOperatingMode: PIEExecutiveOperatingMode;
  currentMission: PIEMission;
  missionSummary: PIEMissionSummary;
  missionObjective: PIEMissionObjective;
  missionProgress: PIEMissionProgress;
  missionBlockers: PIEMissionBlocker[];
  missionEvidence: PIEMissionEvidence[];
  missionRecommendations: PIEMissionRecommendation[];
  missionSuccessCriteria: PIEMissionSuccessCriteria[];
  missionComplete: boolean;
  nextMission: PIEMissionTransition | null;
  recommendations: PIERecommendation[];
  insights: PIEInsight[];
  unknowns: PIEUnknown[];
  currentBeliefs: PIEBelief[];
  overallConfidence: ProjectConfidenceLevel;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  graphInsights: PIEGraphInsight[];
  graphGaps: PIEGraphGap[];
  blockedItems: PIEGraphRelationship[];
  connectedEvidence: PIERuntimeConnectedEvidence[];
  evidenceForRecommendations: PIERuntimeRecommendationEvidence[];
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[];
  relationshipConfidence: PIERuntimeRelationshipConfidence;
  nextBestAction: PIENextBestAction;
  currentPriority: PIERecommendation | null;
  evidence: PIEEvidence[];
  projectEvents: ProjectEvent[];
  projectStory: ProjectStory;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  memory: PIEMemorySnapshot;
  decisionQueue: PIEDecisionQueue;
  conversation: PIEConversation;
  knowledgeGraph: PIEGraph;
  mission: PIEMissionSummary;
  engines: PIERuntimeEngines;
};

type RuntimeBuildParts = {
  conversation: PIEConversation;
  engineState: PIEConversationState;
  surface: PIERuntimeSurface;
  recommendations: PIERecommendation[];
  insights: PIEInsight[];
  unknowns: PIEUnknown[];
  currentBeliefs: PIEBelief[];
  graphOutputs: PIERuntimeGraphOutputs;
  executiveOutputs: PIERuntimeExecutiveOutputs;
  missionOutputs: PIERuntimeMissionOutputs;
  overallConfidence: ProjectConfidenceLevel;
  trustScore: PIETrustScore;
  understandingScore: PIEUnderstandingScore;
  preparednessScore: PIEPreparednessScore;
  currentPriority: PIERecommendation | null;
};

export function buildRuntime(
  context: PIERuntimeContext = {},
): PIERuntimeState {
  const conversation = buildConversation(context);
  const engineState = conversation.state;
  const baseRecommendations = buildRecommendationsFromState(
    engineState,
    conversation.response,
  );
  const graphOutputs = buildGraphOutputsFromState(
    context,
    engineState,
    baseRecommendations,
  );
  const executiveOutputs = buildExecutiveOutputsFromState(
    engineState,
    graphOutputs,
  );
  const missionOutputs = buildMissionOutputsFromState(
    engineState,
    graphOutputs,
    executiveOutputs,
  );
  const recommendations = sortRecommendations(dedupeRecommendations([
    ...baseRecommendations,
    ...executiveOutputs.pieExecutiveBrief.recommendations.map(
      executiveRecommendationToRecommendation,
    ),
    ...missionOutputs.missionRecommendations.map(
      recommendation =>
        missionRecommendationToRecommendation(
          recommendation,
          missionOutputs.currentMission,
        ),
    ),
  ]));
  const insights = buildInsightsFromState(
    engineState,
    conversation.response,
    graphOutputs,
    executiveOutputs,
  );
  const unknowns = buildUnknownsFromState(
    engineState,
    graphOutputs,
    missionOutputs,
  );
  const trustScore = buildTrustScoreFromState(
    engineState,
    unknowns,
    graphOutputs,
    missionOutputs,
  );
  const understandingScore = buildUnderstandingScoreFromState(
    engineState,
    unknowns,
    graphOutputs,
    missionOutputs,
  );
  const overallConfidence = resolveOverallConfidence(
    engineState,
    unknowns,
    trustScore,
    graphOutputs,
    missionOutputs,
  );
  const currentPriority = recommendations[0] ?? null;
  const currentBeliefs = buildBeliefsFromState(
    engineState,
    recommendations,
    insights,
    unknowns,
    graphOutputs,
    missionOutputs,
  );
  const preparednessScore = buildPreparednessScoreFromState(
    engineState,
    recommendations,
    unknowns,
    trustScore,
    understandingScore,
    missionOutputs,
  );
  const parts: RuntimeBuildParts = {
    conversation,
    engineState,
    surface: context.surface ?? 'global',
    recommendations,
    insights,
    unknowns,
    currentBeliefs,
    graphOutputs,
    executiveOutputs,
    missionOutputs,
    overallConfidence,
    trustScore,
    understandingScore,
    preparednessScore,
    currentPriority,
  };
  const currentUnderstanding = makeCurrentUnderstanding(parts);
  const priorityQueue = makePriorityQueue(parts);
  const morningBrief = makeBrief(parts, {
    id: 'morning-brief',
    title: 'Morning Brief',
    summary: briefSummary(parts, 'morning'),
    recommendationLimit: 3,
  });
  const projectBrief = makeBrief(parts, {
    id: 'project-brief',
    title: 'Project Brief',
    summary: briefSummary(parts, 'project'),
    recommendationLimit: 3,
  });
  const projectWalkBrief = makeBrief(parts, {
    id: 'project-walk-brief',
    title: 'Project Walk Brief',
    summary: briefSummary(parts, 'walk'),
    recommendationLimit: 4,
    needsOverride: projectWalkNeed(parts),
  });
  const executiveBrief = makeBrief(parts, {
    id: 'executive-brief',
    title: 'Executive Brief',
    summary: briefSummary(parts, 'executive'),
    recommendationLimit: 3,
    needsOverride:
      engineState.intelligence.communicationReadiness.missingItems[0] ||
      currentUnderstanding.whatPIENeedsFromYou,
  });
  const response = makeRuntimeResponse(
    engineState,
    currentUnderstanding,
    priorityQueue,
    recommendations,
    insights,
    unknowns,
    currentBeliefs,
    graphOutputs,
    executiveOutputs,
    missionOutputs,
  );
  const summary = makeRuntimeSummary(
    engineState,
    currentUnderstanding,
    trustScore,
    preparednessScore,
    priorityQueue.nextBestAction,
    recommendations,
    insights,
    unknowns,
    graphOutputs,
    executiveOutputs,
    missionOutputs,
  );

  return {
    id: runtimeId(engineState.projectName, engineState.generatedAt),
    projectName: engineState.projectName,
    projectNames: engineState.projectNames,
    generatedAt: engineState.generatedAt,
    surface: parts.surface,
    response,
    summary,
    understanding: currentUnderstanding,
    currentUnderstanding,
    priorityQueue,
    morningBrief,
    projectBrief,
    projectWalkBrief,
    executiveBrief,
    pieExecutiveBrief: executiveOutputs.pieExecutiveBrief,
    executivePriorities: executiveOutputs.executivePriorities,
    projectsNeedingAttention: executiveOutputs.projectsNeedingAttention,
    executiveEscalations: executiveOutputs.executiveEscalations,
    executivePreparations: executiveOutputs.executivePreparations,
    executiveQuestions: executiveOutputs.executiveQuestions,
    executiveDailyRoutine: executiveOutputs.executiveDailyRoutine,
    recommendedOperatingMode: executiveOutputs.recommendedOperatingMode,
    currentMission: missionOutputs.currentMission,
    missionSummary: missionOutputs.missionSummary,
    missionObjective: missionOutputs.missionObjective,
    missionProgress: missionOutputs.missionProgress,
    missionBlockers: missionOutputs.missionBlockers,
    missionEvidence: missionOutputs.missionEvidence,
    missionRecommendations: missionOutputs.missionRecommendations,
    missionSuccessCriteria: missionOutputs.missionSuccessCriteria,
    missionComplete: missionOutputs.missionComplete,
    nextMission: missionOutputs.nextMission,
    recommendations,
    insights,
    unknowns,
    currentBeliefs,
    graphInsights: graphOutputs.graphInsights,
    graphGaps: graphOutputs.graphGaps,
    blockedItems: graphOutputs.blockedItems,
    connectedEvidence: graphOutputs.connectedEvidence,
    evidenceForRecommendations: graphOutputs.evidenceForRecommendations,
    areaLinkedRisks: graphOutputs.areaLinkedRisks,
    relationshipConfidence: graphOutputs.relationshipConfidence,
    overallConfidence,
    trustScore,
    understandingScore,
    preparednessScore,
    nextBestAction: priorityQueue.nextBestAction,
    currentPriority,
    evidence: engineState.evidence,
    projectEvents: engineState.projectEvents,
    projectStory: engineState.projectStory,
    intelligence: engineState.intelligence,
    reasoning: engineState.reasoning,
    memory: engineState.memory,
    decisionQueue: engineState.decisionQueue,
    conversation,
    knowledgeGraph: graphOutputs.graph,
    mission: missionOutputs.missionSummary,
    engines: {
      evidence: engineState.evidence,
      events: engineState.projectEvents,
      intelligence: engineState.intelligence,
      reasoning: engineState.reasoning,
      memory: engineState.memory,
      decisions: engineState.decisionQueue,
      conversation,
      knowledgeGraph: graphOutputs.graph,
      executive: executiveOutputs.pieExecutiveBrief,
      mission: missionOutputs.missionSummary,
    },
  };
}

export function buildCurrentUnderstanding(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIECurrentUnderstanding {
  return normalizeRuntime(input).currentUnderstanding;
}

export function buildUnderstanding(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEUnderstanding {
  return normalizeRuntime(input).understanding;
}

export function buildPriorityQueue(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEPriorityQueue {
  return normalizeRuntime(input).priorityQueue;
}

export function buildBriefing(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBriefing {
  return normalizeRuntime(input).projectBrief;
}

export function buildMorningBrief(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBriefing {
  return normalizeRuntime(input).morningBrief;
}

export function buildProjectBrief(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBriefing {
  return normalizeRuntime(input).projectBrief;
}

export function buildProjectWalkBrief(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBriefing {
  return normalizeRuntime(input).projectWalkBrief;
}

export function buildExecutiveBrief(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBriefing {
  return normalizeRuntime(input).executiveBrief;
}

export function buildInsights(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEInsight[] {
  return normalizeRuntime(input).insights;
}

export function buildRecommendations(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIERecommendation[] {
  return normalizeRuntime(input).recommendations;
}

export function buildUnknowns(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEUnknown[] {
  return normalizeRuntime(input).unknowns;
}

export function buildTrustScore(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIETrustScore {
  return normalizeRuntime(input).trustScore;
}

export function buildCurrentBeliefs(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEBelief[] {
  return normalizeRuntime(input).currentBeliefs;
}

export function buildPreparednessScore(
  input: PIERuntimeContext | PIERuntimeState = {},
): PIEPreparednessScore {
  return normalizeRuntime(input).preparednessScore;
}

function buildExecutiveOutputsFromState(
  state: PIEConversationState,
  graphOutputs: PIERuntimeGraphOutputs,
): PIERuntimeExecutiveOutputs {
  const now = new Date(state.generatedAt);
  const executiveParams = {
    decisionQueue: state.decisionQueue,
    memory: state.memory,
    reasoning: state.reasoning,
    knowledgeGraph: graphOutputs.graph,
    projectEvents: state.projectEvents,
    intelligence: state.intelligence,
    now,
  };
  const pieExecutiveBrief = buildPIEExecutiveBrief(executiveParams);

  return {
    pieExecutiveBrief,
    executivePriorities: buildExecutivePriorities(executiveParams),
    projectsNeedingAttention: getProjectsNeedingAttention(executiveParams),
    executiveEscalations: getExecutiveEscalations(executiveParams),
    executivePreparations: getExecutivePreparations(executiveParams),
    executiveQuestions: getExecutiveQuestions(executiveParams),
    executiveDailyRoutine: getExecutiveDailyRoutine(executiveParams),
    recommendedOperatingMode: getRecommendedOperatingMode(executiveParams),
  };
}

function buildMissionOutputsFromState(
  state: PIEConversationState,
  graphOutputs: PIERuntimeGraphOutputs,
  executiveOutputs: PIERuntimeExecutiveOutputs,
): PIERuntimeMissionOutputs {
  const missionParams = {
    projectName: state.projectName,
    executiveBrief: executiveOutputs.pieExecutiveBrief,
    decisionQueue: state.decisionQueue,
    memory: state.memory,
    knowledgeGraph: graphOutputs.graph,
    projectEvents: state.projectEvents,
    intelligence: state.intelligence,
    now: new Date(state.generatedAt),
  };
  const selectedMission = buildMission(missionParams);
  const missionParamsWithType = {
    ...missionParams,
    missionType: selectedMission.missionType,
  };
  const currentMission = buildMission(missionParamsWithType);
  const dailyMission = buildDailyMission(missionParams);
  const projectMission = buildProjectMission(missionParams);
  const missionSummary = buildMissionSummary(missionParamsWithType);

  return {
    currentMission,
    dailyMission,
    projectMission,
    missionSummary: {
      ...missionSummary,
      currentMission,
      dailyMission,
      projectMission,
    },
    missionObjective: getMissionObjective(currentMission),
    missionProgress: getMissionProgress(currentMission),
    missionBlockers: getMissionBlockers(currentMission),
    missionEvidence: getMissionEvidence(currentMission),
    missionRecommendations: getMissionRecommendations(currentMission),
    missionSuccessCriteria: getMissionSuccessCriteria(currentMission),
    missionComplete: isMissionComplete(currentMission),
    nextMission: getNextMission(currentMission),
  };
}

function buildGraphOutputsFromState(
  context: PIERuntimeContext,
  state: PIEConversationState,
  recommendations: PIERecommendation[],
): PIERuntimeGraphOutputs {
  const graph = buildPIEKnowledgeGraph({
    projectName: state.projectName,
    projectNames: state.projectNames,
    projectEvents: state.projectEvents,
    intelligence: state.intelligence,
    reasoning: state.reasoning,
    memory: state.memory,
    decisionQueue: state.decisionQueue,
    updates: context.updates,
    scheduleItems: context.scheduleItems,
    referenceDocuments: context.referenceDocuments,
    reportHistory: context.reportHistory,
    projectAreas: context.projectAreas,
    contacts: context.contacts,
    now: new Date(state.generatedAt),
  });
  const graphInsights = getGraphInsights(graph);
  const graphGaps = getGraphGaps(graph);
  const blockedItems = getBlockedItems(graph);
  const areaLinkedRisks = buildAreaLinkedRisks(graph);
  const connectedEvidence = buildConnectedEvidence(
    graph,
    blockedItems,
    areaLinkedRisks,
  );
  const evidenceForRecommendations = buildEvidenceForRecommendations(
    graph,
    recommendations,
  );
  const relationshipConfidence = buildRelationshipConfidence({
    graph,
    graphGaps,
    blockedItems,
    connectedEvidence,
    evidenceForRecommendations,
    areaLinkedRisks,
  });

  return {
    graph,
    graphInsights,
    graphGaps,
    blockedItems,
    connectedEvidence,
    evidenceForRecommendations,
    areaLinkedRisks,
    relationshipConfidence,
  };
}

function buildAreaLinkedRisks(graph: PIEGraph): PIERuntimeAreaLinkedRisk[] {
  return graph.relationships
    .filter(
      relationship =>
        relationship.edgeType === 'located_in' &&
        ['issue', 'safety', 'inspection'].includes(relationship.fromNode.type) &&
        relationship.toNode.type === 'area',
    )
    .map(relationship => ({
      area: relationship.toNode.label,
      risk: relationship.fromNode.label,
      relationship,
      confidence: relationship.confidence,
      evidence: getConnectedEvidence(graph, relationship.fromNode.id),
    }));
}

function buildConnectedEvidence(
  graph: PIEGraph,
  blockedItems: PIEGraphRelationship[],
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[],
): PIERuntimeConnectedEvidence[] {
  const targetIds = uniqueText([
    ...blockedItems.flatMap(relationship => [
      relationship.fromNode.id,
      relationship.toNode.id,
    ]),
    ...areaLinkedRisks.flatMap(item => [
      item.relationship.fromNode.id,
      item.relationship.toNode.id,
    ]),
    ...graph.insights.flatMap(insight => insight.nodeIds),
  ]).slice(0, 10);

  return targetIds
    .map(nodeId => {
      const node = graph.nodes.find(candidate => candidate.id === nodeId);
      if (!node) return null;

      return {
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        summary: node.summary,
        evidence: getConnectedEvidence(graph, node.id).slice(0, 8),
      };
    })
    .filter((item): item is PIERuntimeConnectedEvidence =>
      item !== null && item.evidence.length > 0,
    );
}

function buildEvidenceForRecommendations(
  graph: PIEGraph,
  recommendations: PIERecommendation[],
): PIERuntimeRecommendationEvidence[] {
  return recommendations.slice(0, 8).map(recommendation => {
    const graphNodes = recommendationGraphNodes(graph, recommendation);
    const evidence = uniqueGraphNodes(
      graphNodes.flatMap(node => [
        ...getEvidenceForRecommendation(graph, node.id),
        ...getConnectedEvidence(graph, node.id),
      ]),
    );

    return {
      recommendationId: recommendation.id,
      recommendationTitle: recommendation.title,
      evidence,
    };
  });
}

function recommendationGraphNodes(
  graph: PIEGraph,
  recommendation: PIERecommendation,
): PIEGraphNode[] {
  const sourceId = runtimeRecommendationSourceId(recommendation);
  const titleKey = normalizedKey(recommendation.title);

  return graph.nodes.filter(node => {
    if (node.id === recommendation.id) return true;
    if (sourceId && node.relatedRecordId === sourceId) return true;
    if (node.type === 'recommendation' && normalizedKey(node.label) === titleKey) {
      return true;
    }
    if (
      recommendation.source === 'decision-engine' &&
      node.type === 'decision' &&
      (sourceId ? node.relatedRecordId === sourceId : titleKey === normalizedKey(node.label))
    ) {
      return true;
    }

    return false;
  });
}

function runtimeRecommendationSourceId(
  recommendation: PIERecommendation,
): string | null {
  const prefixes = [
    'runtime-decision-',
    'runtime-reasoning-',
    'runtime-intelligence-',
    'runtime-conversation-',
  ];
  const prefix = prefixes.find(value => recommendation.id.startsWith(value));

  return prefix ? recommendation.id.slice(prefix.length) : recommendation.id;
}

function buildRelationshipConfidence({
  graph,
  graphGaps,
  blockedItems,
  connectedEvidence,
  evidenceForRecommendations,
  areaLinkedRisks,
}: {
  graph: PIEGraph;
  graphGaps: PIEGraphGap[];
  blockedItems: PIEGraphRelationship[];
  connectedEvidence: PIERuntimeConnectedEvidence[];
  evidenceForRecommendations: PIERuntimeRecommendationEvidence[];
  areaLinkedRisks: PIERuntimeAreaLinkedRisk[];
}): PIERuntimeRelationshipConfidence {
  const relationshipCount = graph.relationships.length;
  const connectedEvidenceCount = uniqueGraphNodes([
    ...connectedEvidence.flatMap(item => item.evidence),
    ...evidenceForRecommendations.flatMap(item => item.evidence),
  ]).length;
  const supportCount = graph.relationships.filter(
    relationship => relationship.edgeType === 'supports',
  ).length;
  const highGapCount = graphGaps.filter(gap => gap.severity === 'high').length;
  const score = clamp(
    Math.round(
      20 +
      Math.min(30, relationshipCount * 2.5) +
      Math.min(25, connectedEvidenceCount * 4) +
      Math.min(15, supportCount * 2) +
      (blockedItems.length > 0 ? 5 : 0) +
      (areaLinkedRisks.length > 0 ? 5 : 0) -
      highGapCount * 12 -
      Math.max(0, graphGaps.length - highGapCount) * 5,
    ),
    0,
    100,
  );
  const level = trustLevelFromScore(score);

  return {
    score,
    level,
    reasons: uniqueText([
      `${relationshipCount} graph relationship${relationshipCount === 1 ? '' : 's'} available.`,
      `${connectedEvidenceCount} connected evidence node${connectedEvidenceCount === 1 ? '' : 's'} available.`,
      blockedItems.length > 0
        ? `${blockedItems.length} blocked item relationship${blockedItems.length === 1 ? '' : 's'} identified.`
        : 'No blocked item relationships are currently identified.',
      areaLinkedRisks.length > 0
        ? `${areaLinkedRisks.length} area-linked risk relationship${areaLinkedRisks.length === 1 ? '' : 's'} identified.`
        : 'No area-linked risk relationships are currently identified.',
      graphGaps.length > 0
        ? `${graphGaps.length} graph gap${graphGaps.length === 1 ? '' : 's'} limit relationship confidence.`
        : 'No graph relationship gaps are currently identified.',
    ]),
    improvementSuggestions: uniqueText([
      relationshipCount > 3
        ? null
        : 'Add updates, photos, schedule items, documents, or events so PIE can connect project relationships.',
      connectedEvidenceCount > 0
        ? null
        : 'Add evidence that connects recommendations to project records.',
      ...graphGaps.slice(0, 3).map(gap => gap.suggestedAction),
    ]),
    relationshipCount,
    connectedEvidenceCount,
    gapCount: graphGaps.length,
    blockedItemCount: blockedItems.length,
    areaLinkedRiskCount: areaLinkedRisks.length,
    generatedAt: graph.generatedAt,
  };
}

function buildRecommendationsFromState(
  state: PIEConversationState,
  response: PIEConversationResponse,
): PIERecommendation[] {
  return sortRecommendations(dedupeRecommendations([
    ...state.decisionQueue.decisions.map(decisionToRecommendation),
    ...state.recommendations.map(reasoningRecommendationToRecommendation),
    ...state.intelligence.recommendations.map(recommendation =>
      intelligenceRecommendationToRecommendation(recommendation, state.projectName),
    ),
    ...response.suggestions.map(suggestion =>
      suggestionToRecommendation(suggestion, state.projectName),
    ),
  ]));
}

function buildInsightsFromState(
  state: PIEConversationState,
  response: PIEConversationResponse,
  graphOutputs: PIERuntimeGraphOutputs,
  executiveOutputs: PIERuntimeExecutiveOutputs,
): PIEInsight[] {
  const memoryInsights = state.memoryInsights.map(memoryInsightToInsight);
  const graphInsights = graphOutputs.graphInsights.map(graphInsightToInsight);
  const executiveInsight = executiveBriefToInsight(
    executiveOutputs.pieExecutiveBrief,
    state.projectName,
  );
  const risks = state.intelligence.riskSignals.map(risk => ({
    id: `runtime-risk-${risk.id}`,
    projectName: state.projectName,
    title: risk.label,
    summary: risk.message,
    whyItMatters: risk.suggestedAction,
    source: 'intelligence-engine' as const,
    confidence: risk.confidence,
    priority: signalSeverityToPriority(risk.severity),
    evidence: risk.evidence,
    suggestedNextAction: risk.suggestedAction,
  }));
  const concerns = state.concerns.map(concernToInsight);
  const highlights = state.projectStory.highlights.map((highlight, index) => ({
    id: `runtime-story-highlight-${index}`,
    projectName: state.projectName,
    title: 'Project Story Highlight',
    summary: highlight,
    whyItMatters: 'This helps PIE explain what changed and what matters now.',
    source: 'event-engine' as const,
    confidence: eventConfidence(state.projectEvents),
    priority: 'medium' as const,
    evidence: state.projectStory.recentEvents.map(event => event.description),
    suggestedNextAction: state.decisionQueue.nextBestAction.suggestedNextAction,
  }));
  const conversationInsight = {
    id: `runtime-conversation-${response.id}`,
    projectName: state.projectName,
    title: response.title,
    summary: response.summary,
    whyItMatters:
      'The Conversation Engine synthesized current PIE state into user-facing project-manager language.',
    source: 'conversation-engine' as const,
    confidence: response.confidence,
    priority: response.confidence === 'low' ? 'medium' as const : 'low' as const,
    evidence: response.evidence,
    suggestedNextAction: response.suggestedNextAction,
  };

  return sortInsights(dedupeInsights([
    ...(executiveInsight ? [executiveInsight] : []),
    ...graphInsights,
    ...risks,
    ...concerns,
    ...memoryInsights,
    ...highlights,
    conversationInsight,
  ]));
}

function buildUnknownsFromState(
  state: PIEConversationState,
  graphOutputs: PIERuntimeGraphOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIEUnknown[] {
  const memoryUnknowns = state.memoryGaps.map(memoryGapToUnknown);
  const graphUnknowns = graphOutputs.graphGaps.map(graphGapToUnknown);
  const questionUnknowns = state.questions.map(questionToUnknown);
  const communicationUnknowns =
    state.intelligence.communicationReadiness.missingItems.map(
      (item, index) => ({
        id: `runtime-communication-missing-${index}`,
        projectName: state.projectName,
        title: 'Communication Context Missing',
        summary: item,
        impact:
          'PIE may not have enough context to prepare a complete stakeholder update.',
        suggestedAction: item,
        source: 'intelligence-engine' as const,
        confidence: state.intelligence.communicationReadiness.confidence,
        priority: 'medium' as const,
      }),
    );
  const location = state.intelligence.locationIntelligence;
  const locationUnknown =
    location.needsConfirmation && location.confirmationPrompt
      ? [{
          id: 'runtime-location-confirmation',
          projectName: state.projectName,
          title: 'Location Needs Confirmation',
          summary: location.confirmationPrompt,
          impact:
            'PIE should not assume the exact project area until the user confirms it.',
          suggestedAction: location.confirmationPrompt,
          source: 'intelligence-engine' as const,
          confidence: location.confidence,
          priority: 'medium' as const,
        }]
      : [];
  const emptyEvidenceUnknown =
    state.evidence.length === 0
      ? [{
          id: 'runtime-no-evidence',
          projectName: state.projectName,
          title: 'No PIE Evidence Yet',
          summary:
            'PIE does not have field evidence for this project in the current local data.',
          impact:
            'Recommendations will stay broad until updates, photos, schedule items, or documents are available.',
          suggestedAction: 'Capture current project progress.',
          source: 'runtime' as const,
          confidence: 'high' as const,
          priority: 'high' as const,
        }]
      : [];
  const missionUnknowns = [
    ...missionOutputs.currentMission.evidenceStillNeeded.map((item, index) => ({
      id: `runtime-mission-evidence-needed-${index}`,
      projectName: state.projectName,
      title: 'Mission Evidence Needed',
      summary: item,
      impact:
        'PIE needs this information to complete the current mission with stronger confidence.',
      suggestedAction: item,
      source: 'mission-engine' as const,
      confidence: missionOutputs.currentMission.confidence,
      priority: missionOutputs.currentMission.priority,
    })),
    ...missionOutputs.missionBlockers.slice(0, 4).map(blocker => ({
      id: `runtime-mission-blocker-${blocker.id}`,
      projectName: state.projectName,
      title: blocker.title,
      summary: blocker.summary,
      impact:
        'This blocker limits PIE progress on the current mission.',
      suggestedAction: blocker.suggestedAction,
      source: 'mission-engine' as const,
      confidence: blocker.confidence,
      priority: blocker.priority,
    })),
  ];

  return sortUnknowns(dedupeUnknowns([
    ...emptyEvidenceUnknown,
    ...missionUnknowns,
    ...locationUnknown,
    ...graphUnknowns,
    ...memoryUnknowns,
    ...questionUnknowns,
    ...communicationUnknowns,
  ]));
}

function buildBeliefsFromState(
  state: PIEConversationState,
  recommendations: PIERecommendation[],
  insights: PIEInsight[],
  unknowns: PIEUnknown[],
  graphOutputs: PIERuntimeGraphOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIEBelief[] {
  const uncertainty = unknowns.slice(0, 4).map(unknown => unknown.summary);
  const contradictingEvidence = contradictingBeliefEvidence(state, unknowns);
  const healthSignal = state.intelligence.healthSignal;
  const location = state.intelligence.locationIntelligence;
  const latestEvent = state.projectStory.recentEvents[0];
  const nextRecommendation = recommendations[0];
  const nextBestAction = state.decisionQueue.nextBestAction;
  const currentConcern = insights[0];
  const relationshipConfidence = graphOutputs.relationshipConfidence;
  const currentMission = missionOutputs.currentMission;
  const beliefs = [
    makeBelief({
      id: 'belief-current-mission',
      projectName: state.projectName,
      statement: `PIE's current mission is ${currentMission.title}.`,
      confidence: currentMission.confidence,
      supportingEvidence: [
        runtimeBeliefEvidence({
          id: 'belief-current-mission-purpose',
          title: 'Current Mission',
          detail: currentMission.whyThisMissionExists,
          source: 'mission-engine',
          confidence: currentMission.confidence,
          occurredAt: currentMission.generatedAt,
          relatedRecordId: currentMission.id,
        }),
        ...textBeliefEvidence(
          'belief-current-mission-evidence',
          currentMission.evidenceCollected.slice(0, 4).map(item => item.detail),
          'mission-engine',
          currentMission.confidence,
          currentMission.generatedAt,
        ),
      ],
      contradictingEvidence: [],
      remainingUncertainty: uniqueText([
        ...currentMission.evidenceStillNeeded.slice(0, 4),
        ...currentMission.blockers.slice(0, 3).map(blocker => blocker.summary),
      ]),
      createdAt: currentMission.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-relationship-evidence',
      projectName: state.projectName,
      statement:
        relationshipConfidence.relationshipCount > 0
          ? `PIE has connected ${relationshipConfidence.relationshipCount} project relationship${relationshipConfidence.relationshipCount === 1 ? '' : 's'} in the Knowledge Graph.`
          : 'PIE has not connected enough project relationships yet.',
      confidence: relationshipConfidence.level,
      supportingEvidence: graphOutputs.graphInsights.slice(0, 3).map(insight =>
        runtimeBeliefEvidence({
          id: `belief-graph-insight-${insight.id}`,
          title: insight.title,
          detail: insight.summary,
          source: 'knowledge-graph',
          confidence: insight.confidence,
          occurredAt: state.generatedAt,
          relatedRecordId: insight.id,
        }),
      ),
      contradictingEvidence: graphOutputs.graphGaps.slice(0, 3).map(gap =>
        runtimeBeliefEvidence({
          id: `belief-graph-gap-${gap.id}`,
          title: gap.title,
          detail: gap.summary,
          source: 'knowledge-graph',
          confidence: gap.confidence,
          occurredAt: state.generatedAt,
          relatedRecordId: gap.id,
        }),
      ),
      remainingUncertainty: uniqueText([
        ...graphOutputs.graphGaps.slice(0, 3).map(gap => gap.summary),
        ...uncertainty,
      ]),
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-project-health',
      projectName: state.projectName,
      statement: `PIE currently believes project health is ${state.intelligence.healthStatus}.`,
      confidence: healthSignal.confidence,
      supportingEvidence: [
        runtimeBeliefEvidence({
          id: 'belief-health-signal',
          title: healthSignal.label,
          detail: healthSignal.message,
          source: 'intelligence-engine',
          confidence: healthSignal.confidence,
          occurredAt: state.generatedAt,
        }),
        ...textBeliefEvidence(
          'belief-health-evidence',
          healthSignal.evidence,
          'intelligence-engine',
          healthSignal.confidence,
          state.generatedAt,
        ),
      ],
      contradictingEvidence,
      remainingUncertainty: uncertainty,
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-schedule-status',
      projectName: state.projectName,
      statement:
        state.intelligence.metrics.scheduleItemCount > 0
          ? `PIE currently believes schedule status is ${state.intelligence.scheduleStatus}.`
          : 'PIE does not have enough schedule evidence to confirm schedule status.',
      confidence:
        state.intelligence.metrics.scheduleItemCount > 0
          ? state.intelligence.confidence.level
          : 'low',
      supportingEvidence: [
        runtimeBeliefEvidence({
          id: 'belief-schedule-metrics',
          title: 'Schedule Metrics',
          detail: `${state.intelligence.metrics.scheduleItemCount} schedule item${state.intelligence.metrics.scheduleItemCount === 1 ? '' : 's'}, ${state.intelligence.overdueScheduleItems} overdue, ${state.intelligence.upcomingScheduleItems} upcoming.`,
          source: 'intelligence-engine',
          confidence: state.intelligence.confidence.level,
          occurredAt: state.generatedAt,
        }),
      ],
      contradictingEvidence,
      remainingUncertainty: uncertainty,
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-current-area',
      projectName: state.projectName,
      statement: location.currentArea
        ? `PIE currently believes the active area is ${location.currentArea}.`
        : 'PIE has not confirmed the current project area.',
      confidence: location.confidence,
      supportingEvidence: [
        runtimeBeliefEvidence({
          id: 'belief-location-intelligence',
          title: 'Location Intelligence',
          detail: location.currentArea
            ? `${location.currentArea}; ${location.gpsStatus}; ${location.confidenceScore}% location confidence.`
            : `${location.gpsStatus}; ${location.confidenceScore}% location confidence.`,
          source: 'intelligence-engine',
          confidence: location.confidence,
          occurredAt: state.generatedAt,
        }),
      ],
      contradictingEvidence,
      remainingUncertainty: location.needsConfirmation
        ? uniqueText([location.confirmationPrompt, ...uncertainty])
        : uncertainty,
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-latest-activity',
      projectName: state.projectName,
      statement: latestEvent
        ? `PIE believes the latest notable activity is ${latestEvent.title}.`
        : 'PIE does not have recent activity history for this project.',
      confidence: latestEvent?.confidence ?? 'low',
      supportingEvidence: latestEvent
        ? [projectEventBeliefEvidence(latestEvent)]
        : [
            runtimeBeliefEvidence({
              id: 'belief-no-latest-activity',
              title: 'No Recent Activity',
              detail:
                'Project Story does not include a recent event in current local data.',
              source: 'runtime',
              confidence: 'high',
              occurredAt: state.generatedAt,
            }),
          ],
      contradictingEvidence,
      remainingUncertainty: uncertainty,
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-next-best-action',
      projectName: state.projectName,
      statement: `PIE believes the next best action is ${nextRecommendation?.title || nextBestAction.title}.`,
      confidence: nextRecommendation?.confidence || nextBestAction.confidence,
      supportingEvidence:
        nextRecommendation
          ? recommendationBeliefEvidence(nextRecommendation, state.generatedAt)
          : textBeliefEvidence(
              'belief-next-best-action-evidence',
              nextBestAction.evidence,
              'decision-engine',
              nextBestAction.confidence,
              state.generatedAt,
            ),
      contradictingEvidence,
      remainingUncertainty: uncertainty,
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    makeBelief({
      id: 'belief-communication-readiness',
      projectName: state.projectName,
      statement: `PIE believes communication readiness is ${state.intelligence.communicationReadiness.level}.`,
      confidence: state.intelligence.communicationReadiness.confidence,
      supportingEvidence: [
        runtimeBeliefEvidence({
          id: 'belief-communication-readiness-signal',
          title: 'Communication Readiness',
          detail: state.intelligence.communicationReadiness.message,
          source: 'intelligence-engine',
          confidence: state.intelligence.communicationReadiness.confidence,
          occurredAt: state.generatedAt,
        }),
        ...textBeliefEvidence(
          'belief-communication-missing',
          state.intelligence.communicationReadiness.missingItems,
          'intelligence-engine',
          state.intelligence.communicationReadiness.confidence,
          state.generatedAt,
        ),
      ],
      contradictingEvidence,
      remainingUncertainty: uniqueText([
        ...state.intelligence.communicationReadiness.missingItems,
        ...uncertainty,
      ]),
      createdAt: state.generatedAt,
      source: 'runtime',
    }),
    currentConcern
      ? makeBelief({
          id: 'belief-current-concern',
          projectName: state.projectName,
          statement: `PIE believes ${currentConcern.title} is a current concern.`,
          confidence: currentConcern.confidence,
          supportingEvidence: [
            runtimeBeliefEvidence({
              id: `belief-current-concern-${currentConcern.id}`,
              title: currentConcern.title,
              detail: currentConcern.summary,
              source: currentConcern.source,
              confidence: currentConcern.confidence,
              occurredAt: state.generatedAt,
            }),
            ...textBeliefEvidence(
              `belief-current-concern-evidence-${currentConcern.id}`,
              currentConcern.evidence,
              currentConcern.source,
              currentConcern.confidence,
              state.generatedAt,
            ),
          ],
          contradictingEvidence,
          remainingUncertainty: uncertainty,
          createdAt: state.generatedAt,
          source: 'runtime',
        })
      : null,
    ...state.intelligence.riskSignals.slice(0, 2).map(risk =>
      makeBelief({
        id: `belief-risk-${risk.id}`,
        projectName: state.projectName,
        statement: `PIE believes ${risk.label} is a current risk signal.`,
        confidence: risk.confidence,
        supportingEvidence: [
          runtimeBeliefEvidence({
            id: `belief-risk-signal-${risk.id}`,
            title: risk.label,
            detail: risk.message,
            source: 'intelligence-engine',
            confidence: risk.confidence,
            occurredAt: state.generatedAt,
          }),
          ...textBeliefEvidence(
            `belief-risk-evidence-${risk.id}`,
            risk.evidence,
            'intelligence-engine',
            risk.confidence,
            state.generatedAt,
          ),
        ],
        contradictingEvidence,
        remainingUncertainty: uncertainty,
        createdAt: state.generatedAt,
        source: 'runtime',
      }),
    ),
  ].filter((belief): belief is PIEBelief => Boolean(belief));

  return dedupeBeliefs(beliefs);
}

function buildPreparednessScoreFromState(
  state: PIEConversationState,
  recommendations: PIERecommendation[],
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
  understandingScore: PIEUnderstandingScore,
  missionOutputs: PIERuntimeMissionOutputs,
): PIEPreparednessScore {
  const factors = [
    executiveMeetingPreparednessFactor(
      state,
      unknowns,
      trustScore,
      understandingScore,
    ),
    customerUpdatePreparednessFactor(state, unknowns, trustScore),
    projectWalkPreparednessFactor(state, unknowns),
    reportPreparednessFactor(state, unknowns, trustScore, understandingScore),
    decisionPreparednessFactor(state, recommendations, unknowns, trustScore),
    missionPreparednessFactor(missionOutputs),
  ];
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = clamp(
    Math.round(
      factors.reduce(
        (sum, factor) => sum + factor.score * factor.weight,
        0,
      ) / Math.max(1, totalWeight),
    ),
    0,
    100,
  );

  return {
    score,
    level: trustLevelFromScore(score),
    reasons: factors.map(factor => `${factor.label}: ${factor.reason}`),
    missingItems: uniqueText(factors.flatMap(factor => factor.missingItems)),
    improvementSuggestions: uniqueText(
      factors.flatMap(factor => factor.improvementSuggestions),
    ),
    factors,
    generatedAt: state.generatedAt,
  };
}

function makeBelief(input: Omit<PIEBelief, 'status'>): PIEBelief {
  const supportingEvidence = dedupeBeliefEvidence(input.supportingEvidence);
  const contradictingEvidence = dedupeBeliefEvidence(input.contradictingEvidence);

  return {
    ...input,
    status: beliefStatus({
      confidence: input.confidence,
      supportingEvidence,
      contradictingEvidence,
      remainingUncertainty: input.remainingUncertainty,
      createdAt: input.createdAt,
    }),
    supportingEvidence,
    contradictingEvidence,
    remainingUncertainty: uniqueText(input.remainingUncertainty),
  };
}

function beliefStatus({
  confidence,
  supportingEvidence,
  contradictingEvidence,
  remainingUncertainty,
  createdAt,
}: {
  confidence: ProjectConfidenceLevel;
  supportingEvidence: PIEBeliefEvidence[];
  contradictingEvidence: PIEBeliefEvidence[];
  remainingUncertainty: string[];
  createdAt: string;
}): PIEBeliefStatus {
  if (contradictingEvidence.length > 0) return 'contested';

  const evidenceIsStale = supportingEvidence.some(evidence => {
    if (!evidence.occurredAt) return false;

    return daysBetween(evidence.occurredAt, createdAt) > 14;
  });

  if (evidenceIsStale && confidence !== 'high') return 'stale';
  if (
    confidence === 'low' ||
    supportingEvidence.length === 0 ||
    remainingUncertainty.length >= 3
  ) {
    return 'uncertain';
  }

  return 'supported';
}

function runtimeBeliefEvidence(input: PIEBeliefEvidence): PIEBeliefEvidence {
  return {
    ...input,
    detail: compactSentence(input.detail),
  };
}

function textBeliefEvidence(
  idPrefix: string,
  values: string[],
  source: PIERuntimeSource | string,
  confidence: ProjectConfidenceLevel,
  occurredAt: string | null,
): PIEBeliefEvidence[] {
  return uniqueText(values).map((detail, index) =>
    runtimeBeliefEvidence({
      id: `${idPrefix}-${index}`,
      title: 'Supporting Evidence',
      detail,
      source,
      confidence,
      occurredAt,
    }),
  );
}

function projectEventBeliefEvidence(event: ProjectEvent): PIEBeliefEvidence {
  return runtimeBeliefEvidence({
    id: `belief-event-${event.id}`,
    title: event.title,
    detail: event.description,
    source: event.source,
    confidence: event.confidence,
    occurredAt: event.occurredAt,
    relatedRecordId: event.id,
  });
}

function recommendationBeliefEvidence(
  recommendation: PIERecommendation,
  generatedAt: string,
): PIEBeliefEvidence[] {
  return [
    runtimeBeliefEvidence({
      id: `belief-recommendation-${recommendation.id}`,
      title: recommendation.title,
      detail: recommendation.summary,
      source: recommendation.source,
      confidence: recommendation.confidence,
      occurredAt: generatedAt,
    }),
    ...textBeliefEvidence(
      `belief-recommendation-evidence-${recommendation.id}`,
      recommendation.evidence,
      recommendation.source,
      recommendation.confidence,
      generatedAt,
    ),
  ];
}

function contradictingBeliefEvidence(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
): PIEBeliefEvidence[] {
  const conflictCount = state.intelligence.metrics.syncConflictCount ?? 0;
  const conflictUnknowns = unknowns.filter(unknown =>
    includesAny(
      `${unknown.title} ${unknown.summary} ${unknown.impact}`.toLowerCase(),
      ['conflict', 'conflicting', 'mismatch'],
    ),
  );
  const syncEvidence =
    conflictCount > 0
      ? [
          runtimeBeliefEvidence({
            id: 'belief-sync-conflict',
            title: 'Sync Conflict',
            detail: `${conflictCount} sync conflict signal${conflictCount === 1 ? '' : 's'} detected.`,
            source: 'intelligence-engine',
            confidence: 'medium',
            occurredAt: state.generatedAt,
          }),
        ]
      : [];

  return [
    ...syncEvidence,
    ...conflictUnknowns.map(unknown =>
      runtimeBeliefEvidence({
        id: `belief-conflict-${unknown.id}`,
        title: unknown.title,
        detail: unknown.summary,
        source: unknown.source,
        confidence: unknown.confidence,
        occurredAt: state.generatedAt,
      }),
    ),
  ];
}

function executiveMeetingPreparednessFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
  understandingScore: PIEUnderstandingScore,
): PIEPreparednessScoreFactor {
  const communication = state.intelligence.communicationReadiness;
  const hasReportHistory =
    state.memory.sourceCounts.reports > 0 ||
    state.intelligence.metrics.reportHistoryCount > 0;
  const score = clamp(
    Math.round(
      communication.score * 0.4 +
      trustScore.overallScore * 0.25 +
      understandingScore.score * 0.2 +
      (hasReportHistory ? 15 : 0) -
      highPriorityUnknownPenalty(unknowns),
    ),
    0,
    100,
  );
  const missingItems = uniqueText([
    ...communication.missingItems,
    hasReportHistory ? null : 'No report history is available.',
    trustScore.level === 'low' ? 'Trust Score is low.' : null,
  ]);

  return preparednessFactor({
    id: 'preparedness-executive-meeting',
    area: 'executive-meeting',
    label: 'Executive Meeting Readiness',
    score,
    weight: 1,
    reason: `${communication.level} communication readiness with ${trustScore.level} trust and ${understandingScore.level} understanding.`,
    missingItems,
    improvementSuggestions: uniqueText([
      ...communication.missingItems,
      ...trustScore.improvementSuggestions.slice(0, 2),
      hasReportHistory ? null : 'Generate and review an executive report draft.',
    ]),
  });
}

function customerUpdatePreparednessFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
): PIEPreparednessScoreFactor {
  const communication = state.intelligence.communicationReadiness;
  const photoScore =
    state.intelligence.photoCount > 0
      ? Math.min(
          100,
          45 +
          state.intelligence.metrics.captionCount * 10 +
          state.intelligence.metrics.photoActionCount * 10,
        )
      : 20;
  const updateScore = updateFreshnessScore(
    state.intelligence.metrics.daysSinceLastUpdate,
  );
  const score = clamp(
    Math.round(
      communication.score * 0.45 +
      photoScore * 0.2 +
      updateScore * 0.2 +
      trustScore.overallScore * 0.15 -
      highPriorityUnknownPenalty(unknowns),
    ),
    0,
    100,
  );
  const missingItems = uniqueText([
    ...communication.missingItems,
    state.intelligence.photoCount > 0 ? null : 'No field photos are available.',
    updateScore >= 70 ? null : 'Recent customer-facing update context is missing.',
  ]);

  return preparednessFactor({
    id: 'preparedness-customer-update',
    area: 'customer-update',
    label: 'Customer Update Readiness',
    score,
    weight: 1,
    reason: `${communication.level} communication readiness with ${state.intelligence.photoCount} photo${state.intelligence.photoCount === 1 ? '' : 's'} and update freshness score ${updateScore}.`,
    missingItems,
    improvementSuggestions: uniqueText([
      ...communication.missingItems,
      state.intelligence.photoCount > 0 ? null : 'Capture current project photos.',
      updateScore >= 70 ? null : 'Capture or review the latest progress update.',
    ]),
  });
}

function projectWalkPreparednessFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
): PIEPreparednessScoreFactor {
  const location = state.intelligence.locationIntelligence;
  const updateScore = updateFreshnessScore(
    state.intelligence.metrics.daysSinceLastUpdate,
  );
  const walkDecisionScore = state.projectWalkDecision
    ? scoreForConfidence(state.projectWalkDecision.confidence)
    : 45;
  const score = clamp(
    Math.round(
      location.confidenceScore * 0.4 +
      updateScore * 0.2 +
      walkDecisionScore * 0.25 +
      (state.intelligence.photoCount > 0 ? 15 : 0) -
      highPriorityUnknownPenalty(unknowns),
    ),
    0,
    100,
  );
  const missingItems = uniqueText([
    location.currentArea ? null : 'Current project area is not confirmed.',
    location.needsConfirmation ? location.confirmationPrompt : null,
    state.intelligence.photoCount > 0 ? null : 'No field photos are available.',
  ]);

  return preparednessFactor({
    id: 'preparedness-project-walk',
    area: 'project-walk',
    label: 'Project Walk Readiness',
    score,
    weight: 1,
    reason: `${location.confidenceScore}% location confidence and ${state.projectWalkDecision ? 'a Project Walk decision is available' : 'no specific Project Walk decision is available'}.`,
    missingItems,
    improvementSuggestions: uniqueText([
      location.currentArea ? null : 'Confirm the project area before walking.',
      state.intelligence.photoCount > 0 ? null : 'Capture photos during the walk.',
      updateScore >= 70 ? null : 'Capture a fresh field update during the walk.',
    ]),
  });
}

function reportPreparednessFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
  understandingScore: PIEUnderstandingScore,
): PIEPreparednessScoreFactor {
  const communication = state.intelligence.communicationReadiness;
  const documentScore =
    state.intelligence.metrics.documentCount > 0
      ? Math.min(100, 55 + state.intelligence.metrics.currentDocumentCount * 10)
      : 25;
  const historyScore =
    state.memory.sourceCounts.reports > 0 ||
    state.intelligence.metrics.reportHistoryCount > 0
      ? 85
      : 45;
  const score = clamp(
    Math.round(
      communication.score * 0.3 +
      trustScore.overallScore * 0.2 +
      understandingScore.score * 0.2 +
      documentScore * 0.15 +
      historyScore * 0.15 -
      highPriorityUnknownPenalty(unknowns),
    ),
    0,
    100,
  );
  const missingItems = uniqueText([
    ...communication.missingItems,
    state.intelligence.metrics.documentCount > 0
      ? null
      : 'Document metadata is missing.',
    historyScore >= 70 ? null : 'No report history is available.',
  ]);

  return preparednessFactor({
    id: 'preparedness-report',
    area: 'report',
    label: 'Report Readiness',
    score,
    weight: 1,
    reason: `${communication.level} communication readiness with ${state.intelligence.metrics.documentCount} document signal${state.intelligence.metrics.documentCount === 1 ? '' : 's'}.`,
    missingItems,
    improvementSuggestions: uniqueText([
      ...communication.missingItems,
      state.intelligence.metrics.documentCount > 0
        ? null
        : 'Add or sync document metadata before generating formal reports.',
      historyScore >= 70 ? null : 'Generate a reviewed report draft.',
    ]),
  });
}

function decisionPreparednessFactor(
  state: PIEConversationState,
  recommendations: PIERecommendation[],
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
): PIEPreparednessScoreFactor {
  const decisionCount = state.decisionQueue.decisions.length;
  const approvalCount = state.decisionQueue.userApprovalRequiredDecisions.length;
  const recommendationCount = recommendations.length;
  const confidenceScore = scoreForConfidence(state.decisionQueue.confidence);
  const score = clamp(
    Math.round(
      confidenceScore * 0.35 +
      trustScore.overallScore * 0.25 +
      (decisionCount > 0 ? 25 : 5) +
      (recommendationCount > 0 ? 15 : 5) -
      highPriorityUnknownPenalty(unknowns),
    ),
    0,
    100,
  );
  const missingItems = uniqueText([
    decisionCount > 0 ? null : 'No decision queue is available.',
    approvalCount > 0 ? null : 'No explicit approval-required decisions are queued.',
    trustScore.level === 'low' ? 'Trust Score is low.' : null,
  ]);

  return preparednessFactor({
    id: 'preparedness-decision',
    area: 'decision',
    label: 'Decision Readiness',
    score,
    weight: 1.1,
    reason: `${decisionCount} decision${decisionCount === 1 ? '' : 's'} queued, ${approvalCount} requiring approval, with ${state.decisionQueue.confidence} decision confidence.`,
    missingItems,
    improvementSuggestions: uniqueText([
      decisionCount > 0 ? null : 'Capture more project evidence so PIE can build a decision queue.',
      approvalCount > 0 ? 'Review approval-required decisions.' : null,
      ...trustScore.improvementSuggestions.slice(0, 1),
    ]),
  });
}

function missionPreparednessFactor(
  missionOutputs: PIERuntimeMissionOutputs,
): PIEPreparednessScoreFactor {
  const mission = missionOutputs.currentMission;
  const blockerPenalty = Math.min(30, missionOutputs.missionBlockers.length * 10);
  const approvalReadyBonus = mission.userApprovalsRequired.length > 0 ? 10 : 0;
  const score = clamp(
    Math.round(
      missionOutputs.missionProgress.score * 0.55 +
        scoreForConfidence(mission.confidence) * 0.25 +
        Math.min(20, missionOutputs.missionEvidence.length * 4) +
        approvalReadyBonus -
        blockerPenalty,
    ),
    0,
    100,
  );

  return preparednessFactor({
    id: 'preparedness-current-mission',
    area: mission.missionType === 'project-walk'
      ? 'project-walk'
      : mission.missionType === 'executive-meeting-prep'
        ? 'executive-meeting'
        : mission.missionType === 'customer-update-prep' ||
            mission.missionType === 'communication-preparation'
          ? 'customer-update'
          : mission.missionType === 'documentation-completion'
            ? 'report'
            : 'decision',
    label: 'Mission Readiness',
    score,
    weight: 1.1,
    reason: `${mission.title} is ${mission.status} with ${missionOutputs.missionProgress.score}% mission progress.`,
    missingItems: uniqueText([
      ...mission.evidenceStillNeeded.slice(0, 4),
      ...missionOutputs.missionBlockers.slice(0, 3).map(blocker => blocker.summary),
    ]),
    improvementSuggestions: uniqueText([
      missionOutputs.missionRecommendations[0]?.recommendation,
      missionOutputs.missionBlockers[0]?.suggestedAction,
      mission.evidenceStillNeeded[0],
    ]),
  });
}

function preparednessFactor(
  input: Omit<PIEPreparednessScoreFactor, 'level'>,
): PIEPreparednessScoreFactor {
  const score = clamp(Math.round(input.score), 0, 100);

  return {
    ...input,
    score,
    level: trustLevelFromScore(score),
    missingItems: uniqueText(input.missingItems),
    improvementSuggestions: uniqueText(input.improvementSuggestions),
  };
}

function makeCurrentUnderstanding(
  parts: RuntimeBuildParts,
): PIECurrentUnderstanding {
  const state = parts.engineState;
  const response = parts.conversation.response;
  const graphOutputs = parts.graphOutputs;
  const firstConcern = parts.insights.find(insight =>
    insight.source === 'reasoning-engine' ||
    insight.source === 'knowledge-graph' ||
    insight.source === 'intelligence-engine',
  );
  const firstNeed = parts.unknowns[0];
  const graphKnowledge = graphKnowledgeLine(graphOutputs);
  const graphConcern = graphConcernLine(graphOutputs);
  const graphNeed = graphNeedLine(graphOutputs);
  const missionLine = currentMissionLine(parts.missionOutputs);
  const missionNeed = missionNeedLine(parts.missionOutputs);
  const executiveBrief = parts.executiveOutputs.pieExecutiveBrief;
  const executiveConcern =
    parts.executiveOutputs.executiveEscalations[0]?.reason ||
    parts.executiveOutputs.executivePriorities.find(
      priority => priority.shouldEscalate,
    )?.summary;
  const executiveNeed =
    parts.executiveOutputs.executiveQuestions[0]?.question ||
    parts.executiveOutputs.executivePreparations[0]?.suggestedNextAction;
  const whatPIERecommends =
    parts.currentPriority?.summary ||
    executiveBrief.whatPIERecommendsNow ||
    response.whatPIERecommends ||
    'Continue monitoring or capture current field progress.';

  return {
    projectName: state.projectName,
    generatedAt: state.generatedAt,
    whatPIEKnows: compactSentence(
      uniqueText([response.whatPIEKnows, graphKnowledge, missionLine]).join(' '),
    ),
    whatChanged: response.whatChanged,
    whatConcernsPIE:
      executiveConcern ||
      graphConcern ||
      firstConcern?.summary ||
      response.whatConcernsPIE ||
      'PIE does not see an urgent concern from current local evidence.',
    whatPIERecommends,
    whatPIENeedsFromYou:
      executiveNeed ||
      missionNeed ||
      graphNeed ||
      firstNeed?.suggestedAction ||
      response.whatPIENeedsFromYou ||
      'Review PIE output before taking action.',
    overallConfidence: parts.overallConfidence,
    trustScore: parts.trustScore,
    understandingScore: parts.understandingScore,
    preparednessScore: parts.preparednessScore,
    relationshipConfidence: parts.graphOutputs.relationshipConfidence,
    currentMission: parts.missionOutputs.currentMission,
    projectUnderstandingScore: parts.understandingScore.score,
    currentPriority: parts.currentPriority,
    evidenceCount: state.evidence.length,
    eventCount: state.projectEvents.length,
    unknownCount: parts.unknowns.length,
    sources: runtimeSources(state, graphOutputs),
  };
}

function executiveNextBestAction(parts: RuntimeBuildParts): PIENextBestAction {
  const fallback = parts.engineState.decisionQueue.nextBestAction;
  const mission = parts.missionOutputs.currentMission;
  const missionRecommendation = parts.missionOutputs.missionRecommendations[0];
  const topPriority = parts.executiveOutputs.pieExecutiveBrief.topPriority;

  if (
    missionRecommendation &&
    priorityRank(missionRecommendation.priority) >= priorityRank(fallback.priority)
  ) {
    return {
      ...fallback,
      decisionId: missionRecommendation.id,
      projectName: mission.projectName,
      title: `Current Mission: ${mission.title}`,
      summary: mission.purpose,
      priority: missionRecommendation.priority,
      confidence: missionRecommendation.confidence,
      suggestedNextAction: missionRecommendation.recommendation,
      userApprovalRequired:
        missionRecommendation.userApprovalRequired ||
        fallback.userApprovalRequired,
      why: missionRecommendation.why,
      evidence: uniqueText([
        ...missionRecommendation.evidence,
        ...mission.evidenceCollected.slice(0, 4).map(item => item.detail),
        ...fallback.evidence,
      ]),
    };
  }

  if (!topPriority) return fallback;

  return {
    ...fallback,
    decisionId: topPriority.id,
    projectName: topPriority.projectName,
    title: topPriority.title,
    summary: topPriority.summary,
    priority: topPriority.priority,
    confidence: topPriority.confidence,
    suggestedNextAction: topPriority.recommendedAction,
    userApprovalRequired:
      topPriority.userApprovalRequired || fallback.userApprovalRequired,
    why: topPriority.summary,
    evidence: uniqueText([...topPriority.evidence, ...fallback.evidence]),
  };
}

function makePriorityQueue(parts: RuntimeBuildParts): PIEPriorityQueue {
  const recommendations = parts.recommendations;
  const nextBestAction = executiveNextBestAction(parts);

  return {
    projectName: parts.engineState.projectName,
    generatedAt: parts.engineState.generatedAt,
    nextBestAction,
    currentPriority: parts.currentPriority,
    recommendations,
    critical: recommendations.filter(
      recommendation => recommendation.priority === 'critical',
    ),
    communication: recommendations.filter(recommendation =>
      includesAny(
        `${recommendation.title} ${recommendation.summary} ${recommendation.suggestedNextAction}`.toLowerCase(),
        ['communication', 'customer', 'executive', 'report', 'stakeholder'],
      ),
    ),
    projectWalk:
      recommendations.find(recommendation =>
        includesAny(
          `${recommendation.title} ${recommendation.suggestedNextAction}`.toLowerCase(),
          ['walk', 'field'],
        ),
      ) ?? null,
    approvalRequired: recommendations.filter(
      recommendation => recommendation.requiresApproval,
    ),
    confidence: parts.overallConfidence,
  };
}

function makeBrief(
  parts: RuntimeBuildParts,
  options: {
    id: string;
    title: string;
    summary: string;
    recommendationLimit: number;
    needsOverride?: string;
  },
): PIEBriefing {
  const currentUnderstanding = makeCurrentUnderstanding(parts);
  const priorityQueue = makePriorityQueue(parts);

  return {
    id: `${options.id}:${runtimeSlug(parts.engineState.projectName)}:${parts.engineState.generatedAt}`,
    projectName: parts.engineState.projectName,
    title: options.title,
    summary: compactSentence(options.summary),
    whatPIEKnows: currentUnderstanding.whatPIEKnows,
    whatChanged: currentUnderstanding.whatChanged,
    whatConcernsPIE: currentUnderstanding.whatConcernsPIE,
    whatPIERecommends: currentUnderstanding.whatPIERecommends,
    whatPIENeedsFromYou:
      options.needsOverride || currentUnderstanding.whatPIENeedsFromYou,
    confidence: parts.overallConfidence,
    trustScore: parts.trustScore,
    understandingScore: parts.understandingScore,
    preparednessScore: parts.preparednessScore,
    relationshipConfidence: parts.graphOutputs.relationshipConfidence,
    priorityQueue,
    nextBestAction: priorityQueue.nextBestAction,
    currentPriority: parts.currentPriority,
    recommendations: parts.recommendations.slice(0, options.recommendationLimit),
    insights: parts.insights.slice(0, 4),
    unknowns: parts.unknowns.slice(0, 4),
    generatedAt: parts.engineState.generatedAt,
  };
}

function makeRuntimeResponse(
  state: PIEConversationState,
  understanding: PIECurrentUnderstanding,
  priorityQueue: PIEPriorityQueue,
  recommendations: PIERecommendation[],
  insights: PIEInsight[],
  unknowns: PIEUnknown[],
  currentBeliefs: PIEBelief[],
  graphOutputs: PIERuntimeGraphOutputs,
  executiveOutputs: PIERuntimeExecutiveOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIERuntimeResponse {
  const recentChanges = runtimeRecentChanges(state);
  const currentConcerns = insights.filter(insight =>
    priorityRank(insight.priority) >= priorityRank('medium'),
  );
  const needsFromUser = unknowns;
  const sections: PIERuntimeContractSections = {
    currentBeliefs,
    currentUnderstanding: understanding,
    recentChanges,
    currentConcerns,
    recommendations,
    needsFromUser,
    projectStory: state.memory.story,
    decisionQueue: priorityQueue,
    trustScore: understanding.trustScore,
    understandingScore: understanding.understandingScore,
    preparednessScore: understanding.preparednessScore,
    graphInsights: graphOutputs.graphInsights,
    graphGaps: graphOutputs.graphGaps,
    blockedItems: graphOutputs.blockedItems,
    connectedEvidence: graphOutputs.connectedEvidence,
    evidenceForRecommendations: graphOutputs.evidenceForRecommendations,
    areaLinkedRisks: graphOutputs.areaLinkedRisks,
    relationshipConfidence: graphOutputs.relationshipConfidence,
    pieExecutiveBrief: executiveOutputs.pieExecutiveBrief,
    executivePriorities: executiveOutputs.executivePriorities,
    projectsNeedingAttention: executiveOutputs.projectsNeedingAttention,
    executiveEscalations: executiveOutputs.executiveEscalations,
    executivePreparations: executiveOutputs.executivePreparations,
    executiveQuestions: executiveOutputs.executiveQuestions,
    executiveDailyRoutine: executiveOutputs.executiveDailyRoutine,
    recommendedOperatingMode: executiveOutputs.recommendedOperatingMode,
    currentMission: missionOutputs.currentMission,
    missionSummary: missionOutputs.missionSummary,
    missionObjective: missionOutputs.missionObjective,
    missionProgress: missionOutputs.missionProgress,
    missionBlockers: missionOutputs.missionBlockers,
    missionEvidence: missionOutputs.missionEvidence,
    missionRecommendations: missionOutputs.missionRecommendations,
    missionSuccessCriteria: missionOutputs.missionSuccessCriteria,
    missionComplete: missionOutputs.missionComplete,
    nextMission: missionOutputs.nextMission,
  };

  return {
    id: `pie-runtime-response:${runtimeSlug(state.projectName)}:${state.generatedAt}`,
    projectName: state.projectName,
    generatedAt: state.generatedAt,
    currentBeliefs,
    currentUnderstanding: understanding,
    recentChanges,
    currentConcerns,
    needsFromUser,
    projectStory: state.memory.story,
    decisionQueue: priorityQueue,
    whatPIEKnows: understanding.whatPIEKnows,
    whatChanged: understanding.whatChanged,
    whatConcernsPIE: understanding.whatConcernsPIE,
    whatPIERecommends: understanding.whatPIERecommends,
    whatPIENeedsFromYou: understanding.whatPIENeedsFromYou,
    confidence: understanding.overallConfidence,
    trustScore: understanding.trustScore,
    understandingScore: understanding.understandingScore,
    preparednessScore: understanding.preparednessScore,
    graphInsights: graphOutputs.graphInsights,
    graphGaps: graphOutputs.graphGaps,
    blockedItems: graphOutputs.blockedItems,
    connectedEvidence: graphOutputs.connectedEvidence,
    evidenceForRecommendations: graphOutputs.evidenceForRecommendations,
    areaLinkedRisks: graphOutputs.areaLinkedRisks,
    relationshipConfidence: graphOutputs.relationshipConfidence,
    pieExecutiveBrief: executiveOutputs.pieExecutiveBrief,
    executivePriorities: executiveOutputs.executivePriorities,
    projectsNeedingAttention: executiveOutputs.projectsNeedingAttention,
    executiveEscalations: executiveOutputs.executiveEscalations,
    executivePreparations: executiveOutputs.executivePreparations,
    executiveQuestions: executiveOutputs.executiveQuestions,
    executiveDailyRoutine: executiveOutputs.executiveDailyRoutine,
    recommendedOperatingMode: executiveOutputs.recommendedOperatingMode,
    currentMission: missionOutputs.currentMission,
    missionSummary: missionOutputs.missionSummary,
    missionObjective: missionOutputs.missionObjective,
    missionProgress: missionOutputs.missionProgress,
    missionBlockers: missionOutputs.missionBlockers,
    missionEvidence: missionOutputs.missionEvidence,
    missionRecommendations: missionOutputs.missionRecommendations,
    missionSuccessCriteria: missionOutputs.missionSuccessCriteria,
    missionComplete: missionOutputs.missionComplete,
    nextMission: missionOutputs.nextMission,
    trustExplanation: runtimeTrustExplanation(
      executiveOutputs,
      missionOutputs,
    ),
    priorityQueue,
    nextBestAction: priorityQueue.nextBestAction,
    recommendations,
    insights,
    unknowns,
    sections,
  };
}

function makeRuntimeSummary(
  state: PIEConversationState,
  understanding: PIECurrentUnderstanding,
  trustScore: PIETrustScore,
  preparednessScore: PIEPreparednessScore,
  nextBestAction: PIENextBestAction,
  recommendations: PIERecommendation[],
  insights: PIEInsight[],
  unknowns: PIEUnknown[],
  graphOutputs: PIERuntimeGraphOutputs,
  executiveOutputs: PIERuntimeExecutiveOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIERuntimeSummary {
  return {
    projectName: state.projectName,
    generatedAt: state.generatedAt,
    overallConfidence: understanding.overallConfidence,
    currentPriority:
      understanding.currentPriority?.title ||
      state.decisionQueue.nextBestAction.title,
    whatPIEKnows: understanding.whatPIEKnows,
    whatChanged: understanding.whatChanged,
    whatConcernsPIE: understanding.whatConcernsPIE,
    whatPIERecommends: understanding.whatPIERecommends,
    whatPIENeedsFromYou: understanding.whatPIENeedsFromYou,
    trustScore,
    understandingScore: understanding.understandingScore,
    preparednessScore,
    relationshipConfidence: graphOutputs.relationshipConfidence,
    nextBestAction,
    trustExplanation: runtimeTrustExplanation(
      executiveOutputs,
      missionOutputs,
    ),
    recommendedOperatingMode: executiveOutputs.recommendedOperatingMode,
    currentMissionTitle: missionOutputs.currentMission.title,
    currentMissionPurpose: missionOutputs.currentMission.purpose,
    missionProgressScore: missionOutputs.missionProgress.score,
    missionComplete: missionOutputs.missionComplete,
    executivePriorityCount: executiveOutputs.executivePriorities.length,
    executiveEscalationCount: executiveOutputs.executiveEscalations.length,
    projectsNeedingAttentionCount:
      executiveOutputs.projectsNeedingAttention.length,
    graphInsightCount: graphOutputs.graphInsights.length,
    graphGapCount: graphOutputs.graphGaps.length,
    blockedItemCount: graphOutputs.blockedItems.length,
    recommendationCount: recommendations.length,
    insightCount: insights.length,
    unknownCount: unknowns.length,
  };
}

function runtimeTrustExplanation(
  executiveOutputs: PIERuntimeExecutiveOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): string {
  const mission = missionOutputs.currentMission;
  const missionEvidenceCount = missionOutputs.missionEvidence.length;
  const blockerCount = missionOutputs.missionBlockers.length;

  return compactSentence(
    `${executiveOutputs.pieExecutiveBrief.trustExplanation} Current Mission: ${mission.title}. Mission trust is ${mission.trust} with ${missionEvidenceCount} evidence signal${missionEvidenceCount === 1 ? '' : 's'} and ${blockerCount} blocker${blockerCount === 1 ? '' : 's'}.`,
  );
}

function decisionToRecommendation(decision: PIEDecision): PIERecommendation {
  return {
    id: `runtime-decision-${decision.id}`,
    projectName: decision.projectName,
    title: decision.title,
    summary: decision.summary,
    priority: decision.priority,
    source: 'decision-engine',
    sources: decision.sources,
    confidence: decision.confidence,
    evidence: decision.evidence,
    impact: decision.impact.description,
    suggestedNextAction: decision.suggestedNextAction,
    requiresApproval: decision.userApproval.required,
  };
}

function reasoningRecommendationToRecommendation(
  recommendation: PIEThoughtRecommendation,
): PIERecommendation {
  return {
    id: `runtime-reasoning-${recommendation.id}`,
    projectName: recommendation.projectName,
    title: recommendation.title,
    summary: recommendation.why,
    priority: recommendation.priority,
    source: 'reasoning-engine',
    sources: [recommendation.source],
    confidence: recommendation.confidence,
    evidence: recommendation.evidence,
    impact: recommendation.impact,
    suggestedNextAction: recommendation.suggestedNextAction,
    requiresApproval: true,
  };
}

function intelligenceRecommendationToRecommendation(
  recommendation: ProjectIntelligenceRecommendation,
  projectName: string,
): PIERecommendation {
  return {
    id: `runtime-intelligence-${recommendation.id}`,
    projectName,
    title: recommendation.title,
    summary: recommendation.reason,
    priority: recommendation.priority,
    source: 'intelligence-engine',
    sources: recommendation.sources,
    confidence: recommendation.confidence,
    evidence: [recommendation.reason],
    impact: recommendation.reason,
    suggestedNextAction: recommendation.title,
    requiresApproval: true,
  };
}

function suggestionToRecommendation(
  suggestion: PIEConversationSuggestion,
  projectName: string,
): PIERecommendation {
  return {
    id: `runtime-conversation-${suggestion.id}`,
    projectName,
    title: suggestion.label,
    summary: suggestion.detail,
    priority: suggestion.priority,
    source: 'conversation-engine',
    sources: ['conversation-engine'],
    confidence: suggestion.confidence,
    evidence: [suggestion.detail],
    impact: suggestion.detail,
    suggestedNextAction: suggestion.label,
    requiresApproval: suggestion.requiresApproval,
  };
}

function executiveRecommendationToRecommendation(
  recommendation: PIEExecutiveRecommendation,
): PIERecommendation {
  return {
    id: `runtime-executive-${recommendation.id}`,
    projectName: recommendation.projectName,
    title: recommendation.recommendation,
    summary: recommendation.why,
    priority: recommendation.urgency,
    source: 'pie-executive',
    sources: ['pie-executive'],
    confidence: recommendation.confidence,
    evidence: recommendation.evidence,
    impact: recommendation.expectedImpact,
    suggestedNextAction: recommendation.recommendation,
    requiresApproval: recommendation.userApprovalRequired,
  };
}

function missionRecommendationToRecommendation(
  recommendation: PIEMissionRecommendation,
  mission: PIEMission,
): PIERecommendation {
  return {
    id: `runtime-mission-${recommendation.id}`,
    projectName: mission.projectName,
    title: recommendation.title,
    summary: recommendation.why,
    priority: recommendation.priority,
    source: 'mission-engine',
    sources: ['mission-engine', recommendation.source],
    confidence: recommendation.confidence,
    evidence: recommendation.evidence,
    impact: recommendation.expectedImpact,
    suggestedNextAction: recommendation.recommendation,
    requiresApproval: recommendation.userApprovalRequired,
  };
}

function executiveBriefToInsight(
  brief: PIEExecutiveBrief,
  projectName: string,
): PIEInsight | null {
  const topPriority = brief.topPriority;

  return {
    id: `runtime-executive-${runtimeSlug(brief.id)}`,
    projectName: topPriority?.projectName || projectName,
    title: topPriority
      ? 'PIE Executive Recommendation'
      : 'PIE Executive Monitoring',
    summary: topPriority
      ? `PIE Executive recommends: ${topPriority.recommendedAction}`
      : brief.executiveSummary,
    whyItMatters: topPriority?.summary || brief.trustExplanation,
    source: 'pie-executive',
    confidence: topPriority?.confidence || brief.confidence,
    priority: topPriority?.priority || 'low',
    evidence: topPriority?.evidence.length
      ? topPriority.evidence
      : brief.sources,
    suggestedNextAction: brief.whatPIERecommendsNow,
  };
}

function memoryInsightToInsight(insight: PIEMemoryInsight): PIEInsight {
  return {
    id: `runtime-memory-${insight.id}`,
    projectName: insight.projectName,
    title: insight.title,
    summary: insight.summary,
    whyItMatters: insight.whyItMatters,
    source: 'memory-engine',
    confidence: insight.confidence,
    priority: insight.priority,
    evidence: [
      ...insight.supportingPatternIds,
      ...insight.supportingGapIds,
      ...insight.supportingEventIds,
    ],
    suggestedNextAction: insight.suggestedNextAction,
  };
}

function graphInsightToInsight(insight: PIEGraphInsight): PIEInsight {
  return {
    id: `runtime-graph-${insight.id}`,
    projectName: insight.projectName,
    title: insight.title,
    summary: insight.summary,
    whyItMatters:
      'The Knowledge Graph found relationships between project records that improve PIE explainability.',
    source: 'knowledge-graph',
    confidence: insight.confidence,
    priority: insight.priority,
    evidence: uniqueText([
      ...insight.nodeIds,
      ...insight.edgeIds,
      ...insight.relationshipIds,
    ]),
    suggestedNextAction: insight.suggestedNextAction,
  };
}

function concernToInsight(concern: PIEConcern): PIEInsight {
  return {
    id: `runtime-concern-${concern.id}`,
    projectName: concern.projectName,
    title: concern.title,
    summary: concern.summary,
    whyItMatters: concern.impact,
    source: 'reasoning-engine',
    confidence: concern.confidence,
    priority: concern.priority,
    evidence: concern.evidenceIds,
    suggestedNextAction: concern.suggestedNextAction,
  };
}

function memoryGapToUnknown(gap: PIEMemoryGap): PIEUnknown {
  return {
    id: `runtime-memory-gap-${gap.id}`,
    projectName: gap.projectName,
    title: gap.title,
    summary: gap.summary,
    impact: gap.impact,
    suggestedAction: gap.suggestedAction,
    source: 'memory-engine',
    confidence: gap.confidence,
    priority: gap.priority,
  };
}

function graphGapToUnknown(gap: PIEGraphGap): PIEUnknown {
  return {
    id: `runtime-graph-gap-${gap.id}`,
    projectName: gap.projectName,
    title: gap.title,
    summary: gap.summary,
    impact:
      'PIE has weaker relationship confidence until this missing project context is filled.',
    suggestedAction: gap.suggestedAction,
    source: 'knowledge-graph',
    confidence: gap.confidence,
    priority: gap.severity,
  };
}

function questionToUnknown(question: PIEQuestion): PIEUnknown {
  return {
    id: `runtime-question-${question.id}`,
    projectName: question.projectName,
    title: 'Question PIE Needs Answered',
    summary: question.question,
    impact: question.reason,
    suggestedAction: question.question,
    source: 'reasoning-engine',
    confidence: question.confidence,
    priority: question.priority,
  };
}

function briefSummary(
  parts: RuntimeBuildParts,
  type: 'morning' | 'project' | 'walk' | 'executive',
) {
  const state = parts.engineState;
  const priority =
    parts.currentPriority?.title ||
    state.decisionQueue.nextBestAction.title;
  const confidence = `${parts.overallConfidence} confidence`;
  const mission = `Current Mission: ${parts.missionOutputs.currentMission.title}.`;

  if (type === 'walk') {
    return `${mission} PIE is ready to guide a project walk for ${state.projectName}. Current priority: ${priority}.`;
  }

  if (type === 'executive') {
    const executiveSummary =
      parts.executiveOutputs.pieExecutiveBrief.executiveSummary ||
      `${state.projectName}: ${state.intelligence.healthStatus} health, ${state.intelligence.scheduleStatus} schedule, ${confidence}.`;

    return `${mission} ${executiveSummary}`;
  }

  if (type === 'project') {
    return `${mission} ${state.projectName}: PIE understands ${state.evidence.length} evidence signal${state.evidence.length === 1 ? '' : 's'} and recommends ${priority}.`;
  }

  return `${mission} ${state.projectName}: today's highest priority is ${priority}; PIE is at ${confidence}.`;
}

function projectWalkNeed(parts: RuntimeBuildParts) {
  const location = parts.engineState.intelligence.locationIntelligence;

  if (location.confirmationPrompt) return location.confirmationPrompt;
  const missionNeed = missionNeedLine(parts.missionOutputs);
  if (missionNeed) return missionNeed;
  const graphNeed = graphNeedLine(parts.graphOutputs);
  if (graphNeed) return graphNeed;
  if (parts.unknowns[0]) return parts.unknowns[0].suggestedAction;

  return 'Begin Project Walk when you are ready to verify current field conditions.';
}

function currentMissionLine(
  missionOutputs: PIERuntimeMissionOutputs,
): string {
  return `Current Mission: ${missionOutputs.currentMission.title}. ${missionOutputs.currentMission.purpose}`;
}

function missionNeedLine(
  missionOutputs: PIERuntimeMissionOutputs,
): string | null {
  return missionOutputs.missionBlockers[0]?.suggestedAction ||
    missionOutputs.currentMission.evidenceStillNeeded[0] ||
    missionOutputs.missionRecommendations[0]?.recommendation ||
    null;
}

function graphKnowledgeLine(graphOutputs: PIERuntimeGraphOutputs): string | null {
  const relationshipCount =
    graphOutputs.relationshipConfidence.relationshipCount;
  const evidenceCount =
    graphOutputs.relationshipConfidence.connectedEvidenceCount;

  if (relationshipCount === 0) return null;

  return `The Knowledge Graph connects ${relationshipCount} project relationship${relationshipCount === 1 ? '' : 's'} and ${evidenceCount} evidence node${evidenceCount === 1 ? '' : 's'}.`;
}

function graphConcernLine(graphOutputs: PIERuntimeGraphOutputs): string | null {
  const blocked = graphOutputs.blockedItems[0];
  if (blocked) {
    return `${blocked.fromNode.label} appears connected to a blocked item: ${blocked.toNode.label}.`;
  }

  const areaRisk = graphOutputs.areaLinkedRisks[0];
  if (areaRisk) {
    return `${areaRisk.risk} is connected to area ${areaRisk.area}.`;
  }

  return null;
}

function graphNeedLine(graphOutputs: PIERuntimeGraphOutputs): string | null {
  const highGap =
    graphOutputs.graphGaps.find(gap => gap.severity === 'high') ||
    graphOutputs.graphGaps[0];

  return highGap?.suggestedAction ?? null;
}

function buildTrustScoreFromState(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  graphOutputs: PIERuntimeGraphOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIETrustScore {
  const factors = [
    evidenceFreshnessFactor(state),
    evidenceCoverageFactor(state),
    photoCoverageFactor(state),
    scheduleCompletenessFactor(state),
    recentUpdatesFactor(state),
    openQuestionsFactor(state, unknowns),
    conflictingEvidenceFactor(state, unknowns),
    inspectionStatusFactor(state),
    relationshipEvidenceFactor(graphOutputs),
    missionTrustFactor(missionOutputs),
  ];
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const overallScore = clamp(
    Math.round(
      factors.reduce(
        (sum, factor) => sum + factor.score * factor.weight,
        0,
      ) / Math.max(1, totalWeight),
    ),
    0,
    100,
  );
  const weakFactors = factors.filter(factor => factor.score < 70);

  return {
    overallScore,
    level: trustLevelFromScore(overallScore),
    reasons: factors.map(factor => `${factor.label}: ${factor.reason}`),
    improvementSuggestions: uniqueText(
      weakFactors.map(factor => factor.improvementSuggestion),
    ),
    factors,
    generatedAt: state.generatedAt,
  };
}

function evidenceFreshnessFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const daysSinceActivity =
    state.intelligence.metrics.daysSinceLatestActivity ??
    state.intelligence.metrics.daysSinceLastUpdate;

  if (daysSinceActivity === null) {
    return trustFactor({
      id: 'evidence-freshness',
      label: 'Evidence Freshness',
      score: 25,
      weight: 1.2,
      status: 'missing',
      reason: 'PIE does not have a dated recent activity signal.',
      improvementSuggestion: 'Capture a current update or import recent activity.',
    });
  }

  if (daysSinceActivity <= 2) {
    return trustFactor({
      id: 'evidence-freshness',
      label: 'Evidence Freshness',
      score: 100,
      weight: 1.2,
      status: 'strong',
      reason: `Latest activity is ${daysSinceActivityLabel(daysSinceActivity)} old.`,
      improvementSuggestion: 'Keep capturing updates when field conditions change.',
    });
  }

  if (daysSinceActivity <= 7) {
    return trustFactor({
      id: 'evidence-freshness',
      label: 'Evidence Freshness',
      score: 78,
      weight: 1.2,
      status: 'adequate',
      reason: `Latest activity is ${daysSinceActivityLabel(daysSinceActivity)} old.`,
      improvementSuggestion: 'Capture a fresh update if work changed today.',
    });
  }

  if (daysSinceActivity <= 14) {
    return trustFactor({
      id: 'evidence-freshness',
      label: 'Evidence Freshness',
      score: 52,
      weight: 1.2,
      status: 'weak',
      reason: `Latest activity is ${daysSinceActivityLabel(daysSinceActivity)} old.`,
      improvementSuggestion: 'Capture a recent project update.',
    });
  }

  return trustFactor({
    id: 'evidence-freshness',
    label: 'Evidence Freshness',
    score: 25,
    weight: 1.2,
    status: 'weak',
    reason: `Latest activity is ${daysSinceActivityLabel(daysSinceActivity)} old.`,
    improvementSuggestion: 'Capture current project progress before relying on recommendations.',
  });
}

function evidenceCoverageFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const counts = state.memory.sourceCounts;
  const coveredSources = [
    counts.updates > 0,
    counts.photos > 0,
    counts.scheduleItems > 0,
    counts.documents > 0,
    counts.projectEvents > 0,
    counts.reasoningThoughts > 0,
  ].filter(Boolean).length;
  const score = Math.round((coveredSources / 6) * 100);

  return trustFactor({
    id: 'evidence-coverage',
    label: 'Evidence Coverage',
    score,
    weight: 1.1,
    status: statusFromScore(score),
    reason: `${coveredSources} of 6 core evidence categories are present.`,
    improvementSuggestion:
      'Add missing updates, photos, schedule items, documents, or project history.',
  });
}

function photoCoverageFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const photoCount = state.intelligence.photoCount;

  if (photoCount === 0) {
    return trustFactor({
      id: 'photo-coverage',
      label: 'Photo Coverage',
      score: 25,
      weight: 0.9,
      status: 'missing',
      reason: 'PIE does not have photos for this project.',
      improvementSuggestion: 'Capture field photos with captions and action status.',
    });
  }

  const captionCoverage = state.intelligence.metrics.captionCount / photoCount;
  const actionCoverage = state.intelligence.metrics.photoActionCount / photoCount;
  const score = clamp(
    Math.round(50 + captionCoverage * 25 + actionCoverage * 25),
    0,
    100,
  );

  return trustFactor({
    id: 'photo-coverage',
    label: 'Photo Coverage',
    score,
    weight: 0.9,
    status: statusFromScore(score),
    reason: `${photoCount} photo${photoCount === 1 ? '' : 's'} available; ${state.intelligence.metrics.captionCount} have captions and ${state.intelligence.metrics.photoActionCount} have action context.`,
    improvementSuggestion:
      'Add captions, owners, due dates, and action status to project photos.',
  });
}

function scheduleCompletenessFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const scheduleCount = state.intelligence.metrics.scheduleItemCount;

  if (scheduleCount === 0) {
    return trustFactor({
      id: 'schedule-completeness',
      label: 'Schedule Completeness',
      score: 25,
      weight: 1,
      status: 'missing',
      reason: 'PIE does not have schedule items for this project.',
      improvementSuggestion: 'Import or enter schedule items for the project.',
    });
  }

  const ownerCoverage =
    state.intelligence.metrics.scheduleOwnerCount / scheduleCount;
  const contractorCoverage =
    state.intelligence.metrics.scheduleContractorCount / scheduleCount;
  const progressCoverage =
    state.intelligence.metrics.averageScheduleProgress === null ? 0 : 1;
  const score = clamp(
    Math.round(40 + ownerCoverage * 25 + contractorCoverage * 25 + progressCoverage * 10),
    0,
    100,
  );

  return trustFactor({
    id: 'schedule-completeness',
    label: 'Schedule Completeness',
    score,
    weight: 1,
    status: statusFromScore(score),
    reason: `${scheduleCount} schedule item${scheduleCount === 1 ? '' : 's'} available with ${state.intelligence.metrics.scheduleOwnerCount} owner signal${state.intelligence.metrics.scheduleOwnerCount === 1 ? '' : 's'} and ${state.intelligence.metrics.scheduleContractorCount} contractor signal${state.intelligence.metrics.scheduleContractorCount === 1 ? '' : 's'}.`,
    improvementSuggestion:
      'Add schedule owners, contractors, progress, and notes where missing.',
  });
}

function recentUpdatesFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const daysSinceLastUpdate = state.intelligence.metrics.daysSinceLastUpdate;

  if (daysSinceLastUpdate === null) {
    return trustFactor({
      id: 'recent-updates',
      label: 'Recent Updates',
      score: 20,
      weight: 1.1,
      status: 'missing',
      reason: 'No saved project update is available.',
      improvementSuggestion: 'Save the first project update.',
    });
  }

  if (daysSinceLastUpdate <= 2) {
    return trustFactor({
      id: 'recent-updates',
      label: 'Recent Updates',
      score: 100,
      weight: 1.1,
      status: 'strong',
      reason: `Last update is ${daysSinceActivityLabel(daysSinceLastUpdate)} old.`,
      improvementSuggestion: 'Keep update cadence current.',
    });
  }

  if (daysSinceLastUpdate <= 7) {
    return trustFactor({
      id: 'recent-updates',
      label: 'Recent Updates',
      score: 80,
      weight: 1.1,
      status: 'adequate',
      reason: `Last update is ${daysSinceActivityLabel(daysSinceLastUpdate)} old.`,
      improvementSuggestion: 'Capture an update if field conditions changed today.',
    });
  }

  if (daysSinceLastUpdate <= 14) {
    return trustFactor({
      id: 'recent-updates',
      label: 'Recent Updates',
      score: 50,
      weight: 1.1,
      status: 'weak',
      reason: `Last update is ${daysSinceActivityLabel(daysSinceLastUpdate)} old.`,
      improvementSuggestion: 'Capture a fresh update to improve PIE confidence.',
    });
  }

  return trustFactor({
    id: 'recent-updates',
    label: 'Recent Updates',
    score: 25,
    weight: 1.1,
    status: 'weak',
    reason: `Last update is ${daysSinceActivityLabel(daysSinceLastUpdate)} old.`,
    improvementSuggestion: 'Capture current progress before acting on stale project intelligence.',
  });
}

function openQuestionsFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
): PIETrustScoreFactor {
  const openQuestionCount = state.questions.length + unknowns.length;

  if (openQuestionCount === 0) {
    return trustFactor({
      id: 'open-questions',
      label: 'Open Questions',
      score: 100,
      weight: 1,
      status: 'strong',
      reason: 'PIE does not have unresolved questions in the current runtime state.',
      improvementSuggestion: 'Keep reviewing PIE questions when new gaps appear.',
    });
  }

  const score =
    openQuestionCount <= 2 ? 78 : openQuestionCount <= 4 ? 55 : 30;

  return trustFactor({
    id: 'open-questions',
    label: 'Open Questions',
    score,
    weight: 1,
    status: statusFromScore(score),
    reason: `${openQuestionCount} open question${openQuestionCount === 1 ? '' : 's'} or unknown${openQuestionCount === 1 ? '' : 's'} need review.`,
    improvementSuggestion: 'Answer PIE questions and fill missing project context.',
  });
}

function conflictingEvidenceFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
): PIETrustScoreFactor {
  const syncConflicts = state.intelligence.metrics.syncConflictCount ?? 0;
  const conflictUnknowns = unknowns.filter(unknown =>
    includesAny(
      `${unknown.title} ${unknown.summary} ${unknown.impact}`.toLowerCase(),
      ['conflict', 'conflicting', 'mismatch'],
    ),
  ).length;
  const conflictCount = syncConflicts + conflictUnknowns;

  if (conflictCount === 0) {
    return trustFactor({
      id: 'conflicting-evidence',
      label: 'Conflicting Evidence',
      score: 100,
      weight: 1,
      status: 'strong',
      reason: 'PIE does not see sync conflicts or explicit conflicting evidence.',
      improvementSuggestion: 'Review conflicts if sync or field evidence changes.',
    });
  }

  return trustFactor({
    id: 'conflicting-evidence',
    label: 'Conflicting Evidence',
    score: 30,
    weight: 1,
    status: 'conflicting',
    reason: `${conflictCount} conflict signal${conflictCount === 1 ? '' : 's'} detected.`,
    improvementSuggestion: 'Resolve conflicting local, cloud, or field evidence.',
  });
}

function inspectionStatusFactor(
  state: PIEConversationState,
): PIETrustScoreFactor {
  const inspectionText = compactSentence([
    ...state.evidence.map(item => `${item.title} ${item.detail}`),
    ...state.projectEvents.map(event => `${event.title} ${event.description}`),
    ...state.memory.gaps.map(gap => `${gap.title} ${gap.summary}`),
    ...state.intelligence.riskSignals.map(risk => `${risk.label} ${risk.message}`),
  ].join(' ')).toLowerCase();

  if (!inspectionText.includes('inspection')) {
    return trustFactor({
      id: 'inspection-status',
      label: 'Inspection Status',
      score: 60,
      weight: 0.8,
      status: 'adequate',
      reason: 'Inspection status is not present in current project evidence.',
      improvementSuggestion:
        'Add inspection status when inspection is relevant to current work.',
    });
  }

  if (
    includesAny(inspectionText, [
      'missing inspection',
      'inspection has not',
      'waiting on inspection',
      'inspection not recorded',
      'verify inspection',
    ])
  ) {
    return trustFactor({
      id: 'inspection-status',
      label: 'Inspection Status',
      score: 35,
      weight: 0.8,
      status: 'weak',
      reason: 'Inspection is mentioned but appears unresolved or unverified.',
      improvementSuggestion: 'Verify and record inspection status.',
    });
  }

  return trustFactor({
    id: 'inspection-status',
    label: 'Inspection Status',
    score: 85,
    weight: 0.8,
    status: 'strong',
    reason: 'Inspection context is present in project evidence.',
    improvementSuggestion: 'Keep inspection status current as work progresses.',
  });
}

function relationshipEvidenceFactor(
  graphOutputs: PIERuntimeGraphOutputs,
): PIETrustScoreFactor {
  const relationshipConfidence = graphOutputs.relationshipConfidence;

  return trustFactor({
    id: 'relationship-evidence',
    label: 'Relationship Evidence',
    score: relationshipConfidence.score,
    weight: 0.9,
    status: statusFromScore(relationshipConfidence.score),
    reason: relationshipConfidence.reasons[0] ||
      'Knowledge Graph relationship confidence is available.',
    improvementSuggestion:
      relationshipConfidence.improvementSuggestions[0] ||
      'Keep connecting evidence to recommendations, blockers, and project areas.',
  });
}

function missionTrustFactor(
  missionOutputs: PIERuntimeMissionOutputs,
): PIETrustScoreFactor {
  const mission = missionOutputs.currentMission;
  const evidenceCount = missionOutputs.missionEvidence.length;
  const blockerCount = missionOutputs.missionBlockers.length;
  const successCount = missionOutputs.missionSuccessCriteria.length;
  const metCount = missionOutputs.missionSuccessCriteria.filter(
    criteria => criteria.met,
  ).length;
  const score = clamp(
    Math.round(
      scoreForConfidence(mission.trust) * 0.35 +
        Math.min(30, evidenceCount * 6) +
        Math.min(20, successCount === 0 ? 0 : (metCount / successCount) * 20) -
        Math.min(25, blockerCount * 8),
    ),
    0,
    100,
  );

  return trustFactor({
    id: 'mission-trust',
    label: 'Mission Trust',
    score,
    weight: 0.9,
    status: statusFromScore(score),
    reason: `${mission.title} has ${evidenceCount} evidence signal${evidenceCount === 1 ? '' : 's'}, ${blockerCount} blocker${blockerCount === 1 ? '' : 's'}, and ${metCount} of ${successCount} success criteria met.`,
    improvementSuggestion:
      mission.evidenceStillNeeded[0] ||
      missionOutputs.missionBlockers[0]?.suggestedAction ||
      'Keep mission evidence connected to recommendations and user approvals.',
  });
}

function trustFactor(input: PIETrustScoreFactor): PIETrustScoreFactor {
  return {
    ...input,
    score: clamp(Math.round(input.score), 0, 100),
  };
}

function statusFromScore(score: number): PIETrustScoreFactorStatus {
  if (score >= 85) return 'strong';
  if (score >= 65) return 'adequate';
  if (score >= 35) return 'weak';

  return 'missing';
}

function trustLevelFromScore(score: number): PIETrustScoreLevel {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';

  return 'low';
}

function daysSinceActivityLabel(days: number) {
  if (days === 0) return 'today';
  if (days === 1) return '1 day';

  return `${days} days`;
}

function buildUnderstandingScoreFromState(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  graphOutputs: PIERuntimeGraphOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): PIEUnderstandingScore {
  const factors = [
    understandingEvidenceCoverageFactor(state),
    understandingAreaCoverageFactor(state),
    understandingRecentUpdatesFactor(state),
    understandingPhotoCoverageFactor(state),
    understandingScheduleCompletenessFactor(state),
    understandingOpenQuestionsFactor(state),
    understandingUnknownsFactor(unknowns),
    understandingConflictingEvidenceFactor(state, unknowns),
    understandingRelationshipCoverageFactor(graphOutputs),
    understandingMissionCoverageFactor(missionOutputs),
  ];
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = clamp(
    Math.round(
      factors.reduce(
        (sum, factor) => sum + factor.score * factor.weight,
        0,
      ) / Math.max(1, totalWeight),
    ),
    0,
    100,
  );

  return {
    score,
    level: trustLevelFromScore(score),
    missingInformation: uniqueText(
      factors
        .map(factor => factor.missingInformation)
        .filter((item): item is string => Boolean(item)),
    ),
    improvementSuggestions: uniqueText(
      factors
        .filter(factor => factor.score < 75)
        .map(factor => factor.improvementSuggestion),
    ),
    factors,
    generatedAt: state.generatedAt,
  };
}

function understandingEvidenceCoverageFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const counts = state.memory.sourceCounts;
  const sourceChecks = [
    {
      present: counts.updates > 0,
      missing: 'saved updates',
    },
    {
      present: counts.photos > 0,
      missing: 'field photos',
    },
    {
      present: counts.scheduleItems > 0,
      missing: 'schedule items',
    },
    {
      present: counts.documents > 0,
      missing: 'document metadata',
    },
    {
      present: counts.projectEvents > 0,
      missing: 'project event history',
    },
    {
      present: counts.reasoningThoughts > 0,
      missing: 'PIE reasoning thoughts',
    },
  ];
  const presentCount = sourceChecks.filter(check => check.present).length;
  const missing = sourceChecks
    .filter(check => !check.present)
    .map(check => check.missing);
  const score = Math.round((presentCount / sourceChecks.length) * 100);

  return understandingFactor({
    id: 'understanding-evidence-coverage',
    label: 'Evidence Coverage',
    score,
    weight: 1.2,
    present: presentCount >= 4,
    reason: `${presentCount} of ${sourceChecks.length} project evidence categories are available.`,
    missingInformation: missing.length > 0 ? `Missing ${missing.join(', ')}.` : null,
    improvementSuggestion:
      'Add missing updates, photos, schedule items, documents, or project history.',
  });
}

function understandingAreaCoverageFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const location = state.intelligence.locationIntelligence;
  const hasArea =
    Boolean(location.currentArea) ||
    state.intelligence.metrics.areaSignalCount > 0;
  const hasGps =
    state.intelligence.metrics.gpsSignalCount > 0 ||
    location.gpsStatus.toLowerCase().includes('gps');
  const score = clamp(
    Math.round(
      (hasArea ? 45 : 0) +
      (hasGps ? 25 : 0) +
      Math.min(30, state.intelligence.metrics.locationConfidenceScore * 0.3),
    ),
    0,
    100,
  );

  return understandingFactor({
    id: 'understanding-area-coverage',
    label: 'Area Coverage',
    score,
    weight: 0.9,
    present: score >= 70,
    reason: location.currentArea
      ? `Current area is ${location.currentArea} with ${location.confidenceScore}% location confidence.`
      : `No current area is confirmed; location confidence is ${location.confidenceScore}%.`,
    missingInformation: score >= 70 ? null : 'Project area or GPS context is incomplete.',
    improvementSuggestion: 'Confirm project area or capture GPS-backed field context.',
  });
}

function understandingRecentUpdatesFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const daysSinceLastUpdate = state.intelligence.metrics.daysSinceLastUpdate;

  if (daysSinceLastUpdate === null) {
    return understandingFactor({
      id: 'understanding-recent-updates',
      label: 'Recent Updates',
      score: 20,
      weight: 1.1,
      present: false,
      reason: 'PIE does not have a saved update for this project.',
      missingInformation: 'No recent project update.',
      improvementSuggestion: 'Capture the first project update.',
    });
  }

  const score =
    daysSinceLastUpdate <= 2
      ? 100
      : daysSinceLastUpdate <= 7
        ? 78
        : daysSinceLastUpdate <= 14
          ? 50
          : 25;

  return understandingFactor({
    id: 'understanding-recent-updates',
    label: 'Recent Updates',
    score,
    weight: 1.1,
    present: score >= 70,
    reason: `Last update is ${daysSinceActivityLabel(daysSinceLastUpdate)} old.`,
    missingInformation: score >= 70 ? null : 'Recent field update is stale or missing.',
    improvementSuggestion: 'Capture current progress so PIE can understand today.',
  });
}

function understandingPhotoCoverageFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const photoCount = state.intelligence.photoCount;

  if (photoCount === 0) {
    return understandingFactor({
      id: 'understanding-photo-coverage',
      label: 'Photo Coverage',
      score: 20,
      weight: 1,
      present: false,
      reason: 'PIE does not have field photos for this project.',
      missingInformation: 'No field photos.',
      improvementSuggestion: 'Capture photos with captions and action status.',
    });
  }

  const captionCoverage = state.intelligence.metrics.captionCount / photoCount;
  const actionCoverage = state.intelligence.metrics.photoActionCount / photoCount;
  const score = clamp(
    Math.round(45 + captionCoverage * 30 + actionCoverage * 25),
    0,
    100,
  );

  return understandingFactor({
    id: 'understanding-photo-coverage',
    label: 'Photo Coverage',
    score,
    weight: 1,
    present: score >= 70,
    reason: `${photoCount} photo${photoCount === 1 ? '' : 's'} available; ${state.intelligence.metrics.captionCount} captioned and ${state.intelligence.metrics.photoActionCount} action-linked.`,
    missingInformation:
      score >= 70 ? null : 'Photo captions or action context are incomplete.',
    improvementSuggestion: 'Add captions, owners, due dates, and status to photos.',
  });
}

function understandingScheduleCompletenessFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const scheduleCount = state.intelligence.metrics.scheduleItemCount;

  if (scheduleCount === 0) {
    return understandingFactor({
      id: 'understanding-schedule-completeness',
      label: 'Schedule Completeness',
      score: 20,
      weight: 1,
      present: false,
      reason: 'PIE does not have schedule items for this project.',
      missingInformation: 'No project schedule.',
      improvementSuggestion: 'Import or enter schedule items.',
    });
  }

  const ownerCoverage =
    state.intelligence.metrics.scheduleOwnerCount / scheduleCount;
  const contractorCoverage =
    state.intelligence.metrics.scheduleContractorCount / scheduleCount;
  const progressCoverage =
    state.intelligence.metrics.averageScheduleProgress === null ? 0 : 1;
  const score = clamp(
    Math.round(40 + ownerCoverage * 25 + contractorCoverage * 20 + progressCoverage * 15),
    0,
    100,
  );

  return understandingFactor({
    id: 'understanding-schedule-completeness',
    label: 'Schedule Completeness',
    score,
    weight: 1,
    present: score >= 70,
    reason: `${scheduleCount} schedule item${scheduleCount === 1 ? '' : 's'} available with ${state.intelligence.metrics.scheduleOwnerCount} owner signal${state.intelligence.metrics.scheduleOwnerCount === 1 ? '' : 's'}.`,
    missingInformation:
      score >= 70 ? null : 'Schedule owner, contractor, or progress context is incomplete.',
    improvementSuggestion: 'Add schedule owners, contractors, progress, and notes.',
  });
}

function understandingOpenQuestionsFactor(
  state: PIEConversationState,
): PIEUnderstandingScoreFactor {
  const openQuestionCount = state.questions.length;
  const score =
    openQuestionCount === 0
      ? 100
      : openQuestionCount <= 2
        ? 75
        : openQuestionCount <= 4
          ? 50
          : 25;

  return understandingFactor({
    id: 'understanding-open-questions',
    label: 'Open Questions',
    score,
    weight: 0.9,
    present: openQuestionCount === 0,
    reason:
      openQuestionCount === 0
        ? 'PIE does not have unresolved reasoning questions.'
        : `${openQuestionCount} PIE question${openQuestionCount === 1 ? '' : 's'} need review.`,
    missingInformation:
      openQuestionCount === 0 ? null : 'PIE has unanswered project questions.',
    improvementSuggestion: 'Answer PIE questions or confirm missing context.',
  });
}

function understandingUnknownsFactor(
  unknowns: PIEUnknown[],
): PIEUnderstandingScoreFactor {
  const unknownCount = unknowns.length;
  const score =
    unknownCount === 0
      ? 100
      : unknownCount <= 2
        ? 75
        : unknownCount <= 4
          ? 52
          : 25;

  return understandingFactor({
    id: 'understanding-unknowns',
    label: 'Unknowns',
    score,
    weight: 1,
    present: unknownCount === 0,
    reason:
      unknownCount === 0
        ? 'PIE does not see major unknowns in the current runtime state.'
        : `${unknownCount} unknown${unknownCount === 1 ? '' : 's'} limit PIE's understanding.`,
    missingInformation:
      unknownCount === 0 ? null : unknowns[0]?.summary || 'Project context is incomplete.',
    improvementSuggestion:
      unknowns[0]?.suggestedAction || 'Fill missing project context.',
  });
}

function understandingConflictingEvidenceFactor(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
): PIEUnderstandingScoreFactor {
  const syncConflicts = state.intelligence.metrics.syncConflictCount ?? 0;
  const conflictUnknowns = unknowns.filter(unknown =>
    includesAny(
      `${unknown.title} ${unknown.summary} ${unknown.impact}`.toLowerCase(),
      ['conflict', 'conflicting', 'mismatch'],
    ),
  ).length;
  const conflictCount = syncConflicts + conflictUnknowns;

  return understandingFactor({
    id: 'understanding-conflicting-evidence',
    label: 'Conflicting Evidence',
    score: conflictCount === 0 ? 100 : 30,
    weight: 0.9,
    present: conflictCount === 0,
    reason:
      conflictCount === 0
        ? 'PIE does not see conflicting local or cloud evidence.'
        : `${conflictCount} conflict signal${conflictCount === 1 ? '' : 's'} detected.`,
    missingInformation:
      conflictCount === 0 ? null : 'Conflicting project evidence needs resolution.',
    improvementSuggestion:
      conflictCount === 0
        ? 'Continue monitoring sync and field evidence.'
        : 'Resolve sync conflicts or contradictory field context.',
  });
}

function understandingRelationshipCoverageFactor(
  graphOutputs: PIERuntimeGraphOutputs,
): PIEUnderstandingScoreFactor {
  const relationshipConfidence = graphOutputs.relationshipConfidence;
  const missingInformation =
    graphOutputs.graphGaps.length > 0
      ? graphOutputs.graphGaps[0].summary
      : null;

  return understandingFactor({
    id: 'understanding-relationship-coverage',
    label: 'Relationship Coverage',
    score: relationshipConfidence.score,
    weight: 0.9,
    present: relationshipConfidence.score >= 70,
    reason: uniqueText(relationshipConfidence.reasons).join(' '),
    missingInformation,
    improvementSuggestion:
      relationshipConfidence.improvementSuggestions[0] ||
      'Add project evidence that connects recommendations, risks, areas, and blockers.',
  });
}

function understandingMissionCoverageFactor(
  missionOutputs: PIERuntimeMissionOutputs,
): PIEUnderstandingScoreFactor {
  const mission = missionOutputs.currentMission;
  const successCriteria = missionOutputs.missionSuccessCriteria;
  const completedCriteria = successCriteria.filter(criteria => criteria.met);
  const hasObjective = Boolean(missionOutputs.missionObjective.summary);
  const hasEvidence = missionOutputs.missionEvidence.length > 0;
  const score = clamp(
    Math.round(
      (hasObjective ? 25 : 0) +
        (hasEvidence ? 25 : 0) +
        missionOutputs.missionProgress.score * 0.35 +
        (missionOutputs.nextMission ? 15 : 5),
    ),
    0,
    100,
  );

  return understandingFactor({
    id: 'understanding-current-mission',
    label: 'Current Mission',
    score,
    weight: 0.9,
    present: score >= 70,
    reason: `${mission.title} is ${mission.status}; ${completedCriteria.length} of ${successCriteria.length} success criteria are met.`,
    missingInformation:
      score >= 70
        ? null
        : mission.evidenceStillNeeded[0] ||
          missionOutputs.missionBlockers[0]?.summary ||
          'Mission purpose needs stronger evidence or completion criteria.',
    improvementSuggestion:
      mission.evidenceStillNeeded[0] ||
      missionOutputs.missionBlockers[0]?.suggestedAction ||
      'Review mission success criteria and evidence.',
  });
}

function understandingFactor(
  input: PIEUnderstandingScoreFactor,
): PIEUnderstandingScoreFactor {
  return {
    ...input,
    score: clamp(Math.round(input.score), 0, 100),
  };
}

function resolveOverallConfidence(
  state: PIEConversationState,
  unknowns: PIEUnknown[],
  trustScore: PIETrustScore,
  graphOutputs: PIERuntimeGraphOutputs,
  missionOutputs: PIERuntimeMissionOutputs,
): ProjectConfidenceLevel {
  const confidenceValues: ProjectConfidenceLevel[] = [
    state.intelligence.confidence.level,
    state.memory.confidence,
    state.decisionQueue.confidence,
  ];
  const highPriorityUnknowns = unknowns.filter(
    unknown => priorityRank(unknown.priority) >= priorityRank('high'),
  );

  if (highPriorityUnknowns.length >= 2) return 'low';
  if (
    graphOutputs.relationshipConfidence.level === 'low' &&
    graphOutputs.graphGaps.filter(gap => gap.severity === 'high').length >= 2
  ) {
    return 'low';
  }
  if (trustScore.level === 'low') return 'low';
  if (
    missionOutputs.currentMission.confidence === 'low' &&
    missionOutputs.missionBlockers.some(
      blocker => priorityRank(blocker.priority) >= priorityRank('high'),
    )
  ) {
    return 'low';
  }
  if (confidenceValues.some(value => value === 'low')) return 'low';
  if (
    trustScore.level === 'high' &&
    confidenceValues.every(value => value === 'high') &&
    unknowns.length <= 1 &&
    state.evidence.length > 0
  ) {
    return 'high';
  }

  return 'medium';
}

function runtimeSources(
  state: PIEConversationState,
  graphOutputs: PIERuntimeGraphOutputs,
): PIERuntimeSource[] {
  return uniqueText([
    state.evidence.length > 0 ? 'evidence-engine' : null,
    state.projectEvents.length > 0 ? 'event-engine' : null,
    graphOutputs.graph.relationships.length > 0 ? 'knowledge-graph' : null,
    'intelligence-engine',
    'reasoning-engine',
    'memory-engine',
    'decision-engine',
    'conversation-engine',
    'pie-executive',
    'mission-engine',
    'runtime',
  ]) as PIERuntimeSource[];
}

function runtimeRecentChanges(state: PIEConversationState): string[] {
  const eventChanges = state.projectStory.recentEvents
    .slice(0, 4)
    .map(event => event.description || event.title);
  const timelineChanges = state.timelineSegments
    .slice(0, 3)
    .map(segment => segment.summary);
  const storyChange = state.memory.story.whatChangedOverTime;

  return uniqueText([
    ...eventChanges,
    ...timelineChanges,
    storyChange,
    state.intelligence.latestActivity
      ? `Latest activity: ${state.intelligence.latestActivity}.`
      : null,
  ]);
}

function normalizeRuntime(
  input: PIERuntimeContext | PIERuntimeState,
): PIERuntimeState {
  if (isRuntimeState(input)) return input;

  return buildRuntime(input);
}

function isRuntimeState(
  input: PIERuntimeContext | PIERuntimeState,
): input is PIERuntimeState {
  return (
    Boolean(input) &&
    typeof input === 'object' &&
    'currentUnderstanding' in input &&
    'priorityQueue' in input &&
    'engines' in input
  );
}

function dedupeRecommendations(
  recommendations: PIERecommendation[],
): PIERecommendation[] {
  const byKey = new Map<string, PIERecommendation>();

  recommendations.forEach(recommendation => {
    const key = normalizedKey(
      `${recommendation.title} ${recommendation.suggestedNextAction}`,
    );
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...recommendation,
        evidence: uniqueText(recommendation.evidence),
        sources: uniqueText(recommendation.sources),
      });
      return;
    }

    byKey.set(key, {
      ...existing,
      priority: higherPriority(existing.priority, recommendation.priority),
      confidence: lowerConfidence(existing.confidence, recommendation.confidence),
      requiresApproval:
        existing.requiresApproval || recommendation.requiresApproval,
      evidence: uniqueText([...existing.evidence, ...recommendation.evidence]),
      sources: uniqueText([...existing.sources, ...recommendation.sources]),
      summary: longestText(existing.summary, recommendation.summary),
      impact: longestText(existing.impact, recommendation.impact),
    });
  });

  return Array.from(byKey.values());
}

function dedupeInsights(insights: PIEInsight[]): PIEInsight[] {
  const seen = new Set<string>();
  const result: PIEInsight[] = [];

  insights.forEach(insight => {
    const key = normalizedKey(`${insight.title} ${insight.summary}`);
    if (seen.has(key)) return;

    seen.add(key);
    result.push({
      ...insight,
      evidence: uniqueText(insight.evidence),
    });
  });

  return result;
}

function dedupeUnknowns(unknowns: PIEUnknown[]): PIEUnknown[] {
  const seen = new Set<string>();
  const result: PIEUnknown[] = [];

  unknowns.forEach(unknown => {
    const key = normalizedKey(`${unknown.title} ${unknown.summary}`);
    if (seen.has(key)) return;

    seen.add(key);
    result.push(unknown);
  });

  return result;
}

function dedupeBeliefs(beliefs: PIEBelief[]): PIEBelief[] {
  const seen = new Set<string>();
  const result: PIEBelief[] = [];

  beliefs.forEach(belief => {
    const key = normalizedKey(belief.statement);
    if (seen.has(key)) return;

    seen.add(key);
    result.push({
      ...belief,
      supportingEvidence: dedupeBeliefEvidence(belief.supportingEvidence),
      contradictingEvidence: dedupeBeliefEvidence(belief.contradictingEvidence),
      remainingUncertainty: uniqueText(belief.remainingUncertainty),
    });
  });

  return result;
}

function dedupeBeliefEvidence(
  evidenceItems: PIEBeliefEvidence[],
): PIEBeliefEvidence[] {
  const seen = new Set<string>();
  const result: PIEBeliefEvidence[] = [];

  evidenceItems.forEach(evidence => {
    const key = normalizedKey(`${evidence.title} ${evidence.detail}`);
    if (seen.has(key)) return;

    seen.add(key);
    result.push(evidence);
  });

  return result;
}

function uniqueGraphNodes(nodes: PIEGraphNode[]): PIEGraphNode[] {
  const byId = new Map<string, PIEGraphNode>();

  nodes.forEach(node => {
    byId.set(node.id, node);
  });

  return Array.from(byId.values());
}

function sortRecommendations(
  recommendations: PIERecommendation[],
): PIERecommendation[] {
  return [...recommendations].sort((first, second) => {
    const priorityDelta =
      priorityRank(second.priority) - priorityRank(first.priority);
    if (priorityDelta !== 0) return priorityDelta;

    const confidenceDelta =
      confidenceRank(second.confidence) - confidenceRank(first.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;

    return Number(second.requiresApproval) - Number(first.requiresApproval);
  });
}

function sortInsights(insights: PIEInsight[]): PIEInsight[] {
  return [...insights].sort((first, second) => {
    const priorityDelta =
      priorityRank(second.priority) - priorityRank(first.priority);
    if (priorityDelta !== 0) return priorityDelta;

    return confidenceRank(second.confidence) - confidenceRank(first.confidence);
  });
}

function sortUnknowns(unknowns: PIEUnknown[]): PIEUnknown[] {
  return [...unknowns].sort((first, second) => {
    const priorityDelta =
      priorityRank(second.priority) - priorityRank(first.priority);
    if (priorityDelta !== 0) return priorityDelta;

    return confidenceRank(second.confidence) - confidenceRank(first.confidence);
  });
}

function signalSeverityToPriority(
  severity: ProjectIntelligenceSummary['healthSignal']['severity'],
): PIEDecisionPriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'high';
  if (severity === 'neutral') return 'medium';

  return 'low';
}

function eventConfidence(events: ProjectEvent[]): ProjectConfidenceLevel {
  if (events.some(event => event.confidence === 'high')) return 'high';
  if (events.some(event => event.confidence === 'medium')) return 'medium';

  return 'low';
}

function higherPriority(
  first: PIEDecisionPriority,
  second: PIEDecisionPriority,
): PIEDecisionPriority {
  return priorityRank(second) > priorityRank(first) ? second : first;
}

function lowerConfidence(
  first: ProjectConfidenceLevel,
  second: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  return confidenceRank(second) < confidenceRank(first) ? second : first;
}

function priorityRank(priority: PIEDecisionPriority) {
  switch (priority) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

function confidenceRank(confidence: ProjectConfidenceLevel) {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

function scoreForConfidence(confidence: ProjectConfidenceLevel) {
  switch (confidence) {
    case 'high':
      return 90;
    case 'medium':
      return 65;
    case 'low':
    default:
      return 35;
  }
}

function updateFreshnessScore(daysSinceLastUpdate: number | null) {
  if (daysSinceLastUpdate === null) return 20;
  if (daysSinceLastUpdate <= 2) return 100;
  if (daysSinceLastUpdate <= 7) return 78;
  if (daysSinceLastUpdate <= 14) return 50;

  return 25;
}

function highPriorityUnknownPenalty(unknowns: PIEUnknown[]) {
  return unknowns
    .filter(unknown => priorityRank(unknown.priority) >= priorityRank('high'))
    .length * 6;
}

function daysBetween(start: string, end: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;

  return Math.abs(endTime - startTime) / (1000 * 60 * 60 * 24);
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some(candidate => value.includes(candidate));
}

function compactSentence(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const text = value?.trim();
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function runtimeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function runtimeId(projectName: string, generatedAt: string) {
  return `pie-runtime:${runtimeSlug(projectName)}:${generatedAt}`;
}

function longestText(first: string, second: string) {
  return second.length > first.length ? second : first;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
