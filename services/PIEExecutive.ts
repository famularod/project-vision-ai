import type {
  PIEDecision,
  PIEDecisionPriority,
  PIEDecisionQueue,
} from './PIEDecisionEngine';
import type {
  PIEGraph,
  PIEGraphGap,
  PIEGraphInsight,
  PIEGraphRelationship,
} from './PIEKnowledgeGraph';
import type { PIEMemorySnapshot } from './PIEMemoryEngine';
import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
  ProjectSignalSeverity,
} from './ProjectIntelligenceEngine';
import type {
  PIEQuestion,
  PIEReasoningResult,
} from './PIEReasoningEngine';
import type {
  PIERecommendation,
  PIERuntimeResponse,
  PIERuntimeState,
} from './PIERuntime';
import type { ProjectEvent } from './ProjectEventService';

export type PIEExecutiveOperatingMode =
  | 'morning_brief'
  | 'active_project_review'
  | 'project_walk_prep'
  | 'executive_meeting_prep'
  | 'customer_update_prep'
  | 'end_of_day_review'
  | 'monitor';

export type PIEExecutiveSource =
  | 'pie-runtime'
  | 'pie-runtime-response'
  | 'pie-decision'
  | 'pie-memory'
  | 'pie-reasoning'
  | 'pie-knowledge-graph'
  | 'project-event'
  | 'project-intelligence'
  | 'pie-executive';

export type PIEExecutivePriority = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  priority: PIEDecisionPriority;
  attentionScore: number;
  confidence: ProjectConfidenceLevel;
  sources: PIEExecutiveSource[];
  evidence: string[];
  recommendedAction: string;
  userApprovalRequired: boolean;
  shouldPrepare: boolean;
  shouldEscalate: boolean;
};

export type PIEExecutiveAttentionItem = {
  id: string;
  projectName: string;
  title: string;
  reason: string;
  attentionScore: number;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
};

export type PIEExecutiveRoutine = {
  id: string;
  mode: PIEExecutiveOperatingMode;
  title: string;
  summary: string;
  steps: string[];
  shouldRunNow: boolean;
  confidence: ProjectConfidenceLevel;
};

export type PIEExecutiveRecommendation = {
  id: string;
  projectName: string;
  recommendation: string;
  why: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  urgency: PIEDecisionPriority;
  userApprovalRequired: boolean;
  expectedImpact: string;
  sourcePriorityId: string | null;
};

export type PIEExecutiveEscalation = {
  id: string;
  projectName: string;
  title: string;
  reason: string;
  evidence: string[];
  urgency: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  recommendedAction: string;
  userApprovalRequired: boolean;
};

export type PIEExecutivePreparation = {
  id: string;
  projectName: string;
  title: string;
  purpose: string;
  preparedFor:
    | 'executive'
    | 'customer'
    | 'project-walk'
    | 'field-update'
    | 'decision-review';
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  userApprovalRequired: boolean;
  suggestedNextAction: string;
};

export type PIEExecutiveQuestion = {
  id: string;
  projectName: string;
  question: string;
  reason: string;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
};

export type PIEExecutiveDecision = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  userApprovalRequired: boolean;
  suggestedNextAction: string;
  evidence: string[];
};

export type PIEExecutiveBrief = {
  id: string;
  generatedAt: string;
  operatingMode: PIEExecutiveOperatingMode;
  executiveSummary: string;
  topPriority: PIEExecutivePriority | null;
  rankedPriorities: PIEExecutivePriority[];
  projectsNeedingAttention: PIEExecutiveAttentionItem[];
  escalations: PIEExecutiveEscalation[];
  preparations: PIEExecutivePreparation[];
  questionsForUser: PIEExecutiveQuestion[];
  recommendations: PIEExecutiveRecommendation[];
  decisions: PIEExecutiveDecision[];
  dailyRoutine: PIEExecutiveRoutine;
  whatPIERecommendsNow: string;
  whatShouldWait: string[];
  confidence: ProjectConfidenceLevel;
  trustExplanation: string;
  userApprovalRequiredItems: PIEExecutiveDecision[];
  sources: PIEExecutiveSource[];
};

export type BuildPIEExecutiveBriefParams = {
  runtime?: PIERuntimeState | null;
  runtimes?: PIERuntimeState[];
  runtimeResponse?: PIERuntimeResponse | null;
  decisionQueue?: PIEDecisionQueue | null;
  memory?: PIEMemorySnapshot | null;
  reasoning?: PIEReasoningResult | null;
  knowledgeGraph?: PIEGraph | null;
  projectEvents?: ProjectEvent[];
  intelligence?: ProjectIntelligenceSummary | null;
  operatingMode?: PIEExecutiveOperatingMode | null;
  now?: Date;
};

type ExecutiveProjectContext = {
  projectName: string;
  generatedAt: string;
  runtime: PIERuntimeState | null;
  runtimeResponse: PIERuntimeResponse | null;
  decisionQueue: PIEDecisionQueue | null;
  memory: PIEMemorySnapshot | null;
  reasoning: PIEReasoningResult | null;
  knowledgeGraph: PIEGraph | null;
  projectEvents: ProjectEvent[];
  intelligence: ProjectIntelligenceSummary | null;
};

type AttentionCandidate = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  weight: number;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  source: PIEExecutiveSource;
  recommendedAction: string;
  userApprovalRequired?: boolean;
  shouldPrepare?: boolean;
  shouldEscalate?: boolean;
};

// PIE Executive is designed for project intelligence first. The same pattern can
// later support operational domains such as maintenance operations,
// manufacturing operations, facility management, compliance programs, capital
// projects, and safety programs. Those domains should not be implemented until
// the project-management model is reliable and evidence-backed.

export function buildPIEExecutiveBrief(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveBrief {
  const contexts = normalizeExecutiveContexts(params);
  const generatedAt = (params.now ?? new Date()).toISOString();
  const rankedPriorities = buildExecutivePrioritiesFromContexts(contexts);
  const projectsNeedingAttention =
    buildProjectsNeedingAttentionFromPriorities(rankedPriorities);
  const escalations = buildEscalationsFromPriorities(rankedPriorities);
  const preparations = buildPreparationsFromContexts(contexts, rankedPriorities);
  const questionsForUser = buildQuestionsFromContexts(contexts, rankedPriorities);
  const recommendations =
    buildRecommendationsFromPriorities(rankedPriorities);
  const decisions = buildExecutiveDecisionsFromContexts(contexts);
  const operatingMode =
    params.operatingMode ??
    recommendedOperatingModeFromState({
      contexts,
      priorities: rankedPriorities,
      preparations,
      questions: questionsForUser,
      now: params.now ?? new Date(),
    });
  const dailyRoutine = buildDailyRoutineFromState(
    operatingMode,
    rankedPriorities,
    preparations,
    questionsForUser,
  );
  const topPriority = rankedPriorities[0] ?? null;
  const confidence = executiveConfidence(contexts, rankedPriorities);
  const whatShouldWait = buildWaitList(contexts, rankedPriorities);

  return {
    id: `pie-executive:${slug(operatingMode)}:${generatedAt}`,
    generatedAt,
    operatingMode,
    executiveSummary: executiveSummary({
      contexts,
      topPriority,
      escalations,
      preparations,
      questionsForUser,
      confidence,
    }),
    topPriority,
    rankedPriorities,
    projectsNeedingAttention,
    escalations,
    preparations,
    questionsForUser,
    recommendations,
    decisions,
    dailyRoutine,
    whatPIERecommendsNow:
      topPriority?.recommendedAction ||
      'Continue monitoring projects and capture current progress when conditions change.',
    whatShouldWait,
    confidence,
    trustExplanation: trustExplanation(contexts),
    userApprovalRequiredItems: decisions.filter(
      decision => decision.userApprovalRequired,
    ),
    sources: executiveSources(contexts, rankedPriorities),
  };
}

export function buildExecutivePriorities(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutivePriority[] {
  return buildExecutivePrioritiesFromContexts(
    normalizeExecutiveContexts(params),
  );
}

export function getProjectsNeedingAttention(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveAttentionItem[] {
  return buildProjectsNeedingAttentionFromPriorities(
    buildExecutivePriorities(params),
  );
}

export function getExecutiveEscalations(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveEscalation[] {
  return buildEscalationsFromPriorities(buildExecutivePriorities(params));
}

export function getExecutivePreparations(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutivePreparation[] {
  const contexts = normalizeExecutiveContexts(params);

  return buildPreparationsFromContexts(
    contexts,
    buildExecutivePrioritiesFromContexts(contexts),
  );
}

export function getExecutiveQuestions(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveQuestion[] {
  const contexts = normalizeExecutiveContexts(params);

  return buildQuestionsFromContexts(
    contexts,
    buildExecutivePrioritiesFromContexts(contexts),
  );
}

export function getExecutiveDailyRoutine(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveRoutine {
  const contexts = normalizeExecutiveContexts(params);
  const priorities = buildExecutivePrioritiesFromContexts(contexts);
  const preparations = buildPreparationsFromContexts(contexts, priorities);
  const questions = buildQuestionsFromContexts(contexts, priorities);
  const mode =
    params.operatingMode ??
    recommendedOperatingModeFromState({
      contexts,
      priorities,
      preparations,
      questions,
      now: params.now ?? new Date(),
    });

  return buildDailyRoutineFromState(mode, priorities, preparations, questions);
}

export function getRecommendedOperatingMode(
  params: BuildPIEExecutiveBriefParams = {},
): PIEExecutiveOperatingMode {
  const contexts = normalizeExecutiveContexts(params);
  const priorities = buildExecutivePrioritiesFromContexts(contexts);

  return params.operatingMode ??
    recommendedOperatingModeFromState({
      contexts,
      priorities,
      preparations: buildPreparationsFromContexts(contexts, priorities),
      questions: buildQuestionsFromContexts(contexts, priorities),
      now: params.now ?? new Date(),
    });
}

function normalizeExecutiveContexts(
  params: BuildPIEExecutiveBriefParams,
): ExecutiveProjectContext[] {
  const runtimeContexts = [
    ...(params.runtimes ?? []),
    ...(params.runtime ? [params.runtime] : []),
  ].map(runtimeToContext);

  if (runtimeContexts.length > 0) return uniqueContexts(runtimeContexts);

  return [
    {
      projectName: resolveProjectName(params),
      generatedAt:
        params.runtimeResponse?.generatedAt ||
        params.decisionQueue?.generatedAt ||
        params.memory?.generatedAt ||
        params.reasoning?.generatedAt ||
        params.knowledgeGraph?.generatedAt ||
        params.intelligence?.generatedAt ||
        params.projectEvents?.[0]?.occurredAt ||
        (params.now ?? new Date()).toISOString(),
      runtime: null,
      runtimeResponse: params.runtimeResponse ?? null,
      decisionQueue: params.decisionQueue ?? null,
      memory: params.memory ?? null,
      reasoning: params.reasoning ?? null,
      knowledgeGraph: params.knowledgeGraph ?? null,
      projectEvents: params.projectEvents ?? [],
      intelligence: params.intelligence ?? null,
    },
  ];
}

function runtimeToContext(runtime: PIERuntimeState): ExecutiveProjectContext {
  return {
    projectName: runtime.projectName,
    generatedAt: runtime.generatedAt,
    runtime,
    runtimeResponse: runtime.response,
    decisionQueue: runtime.decisionQueue,
    memory: runtime.memory,
    reasoning: runtime.reasoning,
    knowledgeGraph: runtime.knowledgeGraph,
    projectEvents: runtime.projectEvents,
    intelligence: runtime.intelligence,
  };
}

function buildExecutivePrioritiesFromContexts(
  contexts: ExecutiveProjectContext[],
): PIEExecutivePriority[] {
  return sortPriorities(dedupePriorities(
    contexts.flatMap(context => prioritiesForContext(context)),
  ));
}

function prioritiesForContext(
  context: ExecutiveProjectContext,
): PIEExecutivePriority[] {
  return dedupePriorities([
    ...criticalSafetyCandidates(context),
    ...criticalScheduleBlockerCandidates(context),
    ...inspectionCandidates(context),
    ...customerImpactCandidates(context),
    ...executiveReportCandidates(context),
    ...missingRecentUpdateCandidates(context),
    ...lowTrustCandidates(context),
    ...lowUnderstandingCandidates(context),
    ...approvalDecisionCandidates(context),
    ...communicationReadinessCandidates(context),
    ...projectWalkCandidates(context),
    ...missingEvidenceCandidates(context),
  ].map(candidateToPriority));
}

function criticalSafetyCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const safetyRisk = context.intelligence?.riskSignals.find(risk =>
    includesAny(`${risk.label} ${risk.message}`, ['safety', 'hazard']),
  );
  const safetyConcern = context.reasoning?.concerns.find(concern =>
    includesAny(`${concern.title} ${concern.summary}`, ['safety', 'hazard']),
  );
  const graphSafety = context.knowledgeGraph?.relationships.find(
    relationship =>
      relationship.fromNode.type === 'safety' ||
      relationship.toNode.type === 'safety',
  );
  const safetyCount = context.intelligence?.metrics.safetyConcernCount ?? 0;

  if (!safetyRisk && !safetyConcern && !graphSafety && safetyCount === 0) {
    return [];
  }

  return [{
    id: `safety-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Safety concern needs review',
    summary:
      safetyRisk?.message ||
      safetyConcern?.summary ||
      graphSafety?.summary ||
      `${safetyCount} safety concern signal${safetyCount === 1 ? '' : 's'} found.`,
    weight: 35,
    priority: 'critical',
    confidence:
      safetyRisk?.confidence ||
      safetyConcern?.confidence ||
      graphSafety?.confidence ||
      'medium',
    evidence: uniqueText([
      ...(safetyRisk?.evidence ?? []),
      ...(safetyConcern?.evidenceIds ?? []),
      graphSafety?.summary,
    ]),
    source: safetyRisk
      ? 'project-intelligence'
      : safetyConcern
        ? 'pie-reasoning'
        : 'pie-knowledge-graph',
    recommendedAction: 'Review the safety concern before routine project work.',
    userApprovalRequired: true,
    shouldEscalate: true,
  }];
}

function criticalScheduleBlockerCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const blockedRelationships =
    context.runtime?.blockedItems ??
    context.knowledgeGraph?.relationships.filter(
      relationship => relationship.edgeType === 'blocks',
    ) ??
    [];
  const criticalScheduleDecision = context.decisionQueue?.decisions.find(
    decision =>
      ['critical', 'high'].includes(decision.priority) &&
      decision.impact.area === 'schedule',
  );
  const waitingCount = context.intelligence?.metrics.waitingScheduleItemCount ?? 0;
  const overdueCount = context.intelligence?.overdueScheduleItems ?? 0;

  if (
    blockedRelationships.length === 0 &&
    !criticalScheduleDecision &&
    waitingCount === 0 &&
    overdueCount === 0
  ) {
    return [];
  }

  return [{
    id: `schedule-blocker-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Schedule blocker needs attention',
    summary:
      criticalScheduleDecision?.summary ||
      blockedRelationships[0]?.summary ||
      `${overdueCount} overdue and ${waitingCount} waiting schedule item${overdueCount + waitingCount === 1 ? '' : 's'} found.`,
    weight: blockedRelationships.length > 0 ? 30 : 24,
    priority: criticalScheduleDecision?.priority || 'high',
    confidence:
      criticalScheduleDecision?.confidence ||
      blockedRelationships[0]?.confidence ||
      context.intelligence?.confidence.level ||
      'medium',
    evidence: uniqueText([
      ...(criticalScheduleDecision?.evidence ?? []),
      ...blockedRelationships.slice(0, 3).map(item => item.summary),
    ]),
    source: blockedRelationships.length > 0
      ? 'pie-knowledge-graph'
      : criticalScheduleDecision
        ? 'pie-decision'
        : 'project-intelligence',
    recommendedAction:
      criticalScheduleDecision?.suggestedNextAction ||
      'Review overdue, waiting, or blocked schedule work.',
    userApprovalRequired: true,
    shouldEscalate: blockedRelationships.length > 0 ||
      criticalScheduleDecision?.priority === 'critical',
  }];
}

function inspectionCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const inspectionText = contextText(context);
  const inspectionMissing = includesAny(inspectionText, [
    'inspection missing',
    'missing inspection',
    'inspection not recorded',
    'verify inspection',
    'waiting on inspection',
  ]);

  if (!inspectionMissing) return [];

  return [{
    id: `inspection-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Inspection status needs verification',
    summary:
      'PIE found inspection language that suggests inspection status may be missing or unresolved.',
    weight: 22,
    priority: 'high',
    confidence: 'medium',
    evidence: matchingEvidence(context, ['inspection']),
    source: 'pie-executive',
    recommendedAction: 'Verify and record inspection status before communicating completion.',
    userApprovalRequired: true,
    shouldEscalate: true,
  }];
}

function customerImpactCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const communicationDecision = context.decisionQueue?.communicationDecisions[0];
  const customerText = contextText(context);
  const customerImpact = includesAny(customerText, [
    'customer',
    'stakeholder',
    'delay',
    'blocked',
    'overdue',
  ]);

  if (!communicationDecision && !customerImpact) return [];

  return [{
    id: `customer-impact-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Customer communication may be needed',
    summary:
      communicationDecision?.summary ||
      'PIE sees project risk or delay language that may affect customer communication.',
    weight: communicationDecision ? 20 : 12,
    priority: communicationDecision?.priority || 'medium',
    confidence: communicationDecision?.confidence ||
      context.intelligence?.communicationReadiness.confidence ||
      'medium',
    evidence: uniqueText([
      ...(communicationDecision?.evidence ?? []),
      ...matchingEvidence(context, ['customer', 'delay', 'blocked', 'overdue']),
    ]),
    source: communicationDecision ? 'pie-decision' : 'pie-executive',
    recommendedAction:
      communicationDecision?.suggestedNextAction ||
      'Review customer-facing impact before sending the next update.',
    userApprovalRequired: true,
    shouldPrepare: true,
  }];
}

function executiveReportCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const executiveDecision = context.decisionQueue?.decisions.find(decision =>
    decision.action === 'generate-executive-report',
  );
  const readiness = context.intelligence?.communicationReadiness;
  const runtimePreparedness =
    context.runtime?.preparednessScore.factors.find(
      factor => factor.area === 'executive-meeting',
    );

  if (
    !executiveDecision &&
    readiness?.level !== 'ready' &&
    (runtimePreparedness?.score ?? 0) < 70
  ) {
    return [];
  }

  return [{
    id: `executive-report-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Executive brief can be prepared',
    summary:
      executiveDecision?.summary ||
      runtimePreparedness?.reason ||
      readiness?.message ||
      'PIE has enough context to prepare an executive brief for review.',
    weight: executiveDecision ? 18 : 10,
    priority: executiveDecision?.priority || 'medium',
    confidence:
      executiveDecision?.confidence ||
      runtimePreparedness?.level ||
      readiness?.confidence ||
      'medium',
    evidence: uniqueText([
      ...(executiveDecision?.evidence ?? []),
      runtimePreparedness?.reason,
      readiness?.message,
    ]),
    source: executiveDecision ? 'pie-decision' : 'pie-runtime',
    recommendedAction:
      executiveDecision?.suggestedNextAction ||
      'Prepare an executive report draft for user review.',
    userApprovalRequired: true,
    shouldPrepare: true,
  }];
}

function missingRecentUpdateCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const days = context.intelligence?.metrics.daysSinceLastUpdate;
  const missingUpdateGap = context.memory?.gaps.find(gap =>
    includesAny(`${gap.title} ${gap.summary}`, ['recent update', 'no recent update']),
  );

  if (days !== null && days !== undefined && days <= 3 && !missingUpdateGap) {
    return [];
  }
  if (days === null && !missingUpdateGap) {
    return [];
  }

  return [{
    id: `missing-update-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Recent update is missing or stale',
    summary:
      missingUpdateGap?.summary ||
      (typeof days === 'number'
        ? `Last update is ${days} day${days === 1 ? '' : 's'} old.`
        : 'PIE does not see a saved update for this project.'),
    weight: typeof days === 'number' && days > 7 ? 18 : 12,
    priority: typeof days === 'number' && days > 7 ? 'high' : 'medium',
    confidence: missingUpdateGap?.confidence || 'high',
    evidence: uniqueText([
      missingUpdateGap?.summary,
      typeof days === 'number' ? `daysSinceLastUpdate=${days}` : null,
    ]),
    source: missingUpdateGap ? 'pie-memory' : 'project-intelligence',
    recommendedAction: 'Capture current project progress.',
  }];
}

function lowTrustCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const trustScore = context.runtime?.trustScore;

  if (!trustScore || trustScore.level !== 'low') return [];

  return [{
    id: `low-trust-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Trust Score is low',
    summary: trustScore.reasons[0] || 'PIE has low trust in current evidence.',
    weight: 12,
    priority: 'medium',
    confidence: trustScore.level,
    evidence: trustScore.reasons.slice(0, 4),
    source: 'pie-runtime',
    recommendedAction:
      trustScore.improvementSuggestions[0] ||
      'Add current evidence before relying on recommendations.',
  }];
}

function lowUnderstandingCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const understandingScore = context.runtime?.understandingScore;

  if (!understandingScore || understandingScore.level !== 'low') return [];

  return [{
    id: `low-understanding-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Understanding Score is low',
    summary:
      understandingScore.missingInformation[0] ||
      'PIE has incomplete project understanding.',
    weight: 12,
    priority: 'medium',
    confidence: understandingScore.level,
    evidence: understandingScore.missingInformation.slice(0, 4),
    source: 'pie-runtime',
    recommendedAction:
      understandingScore.improvementSuggestions[0] ||
      'Fill missing project context.',
  }];
}

function approvalDecisionCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const approvalDecision =
    context.decisionQueue?.userApprovalRequiredDecisions[0] ??
    context.runtime?.priorityQueue.approvalRequired[0];

  if (!approvalDecision) return [];

  return [{
    id: `approval-${slug(context.projectName)}-${slug(approvalDecision.id)}`,
    projectName: context.projectName,
    title: 'Decision needs user approval',
    summary: approvalDecision.summary,
    weight: priorityToWeight(approvalDecision.priority),
    priority: approvalDecision.priority,
    confidence: approvalDecision.confidence,
    evidence: approvalDecision.evidence,
    source: 'pie-decision',
    recommendedAction: approvalDecision.suggestedNextAction,
    userApprovalRequired: true,
  }];
}

function communicationReadinessCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const readiness = context.intelligence?.communicationReadiness;

  if (!readiness || readiness.level !== 'needs-context') return [];

  return [{
    id: `communication-context-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Communication needs context',
    summary: readiness.message,
    weight: 10,
    priority: 'medium',
    confidence: readiness.confidence,
    evidence: readiness.missingItems,
    source: 'project-intelligence',
    recommendedAction: readiness.missingItems[0] ||
      'Fill missing communication context before sending an update.',
    userApprovalRequired: true,
  }];
}

function projectWalkCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const walkDecision =
    context.decisionQueue?.projectWalkDecision ??
    context.runtime?.priorityQueue.projectWalk;
  const location = context.intelligence?.locationIntelligence;
  const needsWalk =
    Boolean(walkDecision) ||
    Boolean(location?.needsConfirmation) ||
    Boolean(context.runtime?.areaLinkedRisks.length);

  if (!needsWalk) return [];

  return [{
    id: `project-walk-${slug(context.projectName)}`,
    projectName: context.projectName,
    title: 'Project Walk should be prepared',
    summary:
      walkDecision?.summary ||
      location?.confirmationPrompt ||
      context.runtime?.areaLinkedRisks[0]?.risk ||
      'PIE has field context that should be verified during Project Walk.',
    weight: walkDecision ? priorityToWeight(walkDecision.priority) : 10,
    priority: walkDecision?.priority || 'medium',
    confidence: walkDecision?.confidence || location?.confidence || 'medium',
    evidence: uniqueText([
      ...(walkDecision?.evidence ?? []),
      location?.confirmationPrompt,
      context.runtime?.areaLinkedRisks[0]?.risk,
    ]),
    source: walkDecision ? 'pie-decision' : 'pie-runtime',
    recommendedAction:
      walkDecision?.suggestedNextAction ||
      'Prepare Project Walk verification prompts.',
    userApprovalRequired: true,
    shouldPrepare: true,
  }];
}

function missingEvidenceCandidates(
  context: ExecutiveProjectContext,
): AttentionCandidate[] {
  const graphGap =
    context.runtime?.graphGaps.find(gap => gap.severity === 'high') ||
    context.knowledgeGraph?.gaps.find(gap => gap.severity === 'high') ||
    context.runtime?.graphGaps[0] ||
    context.knowledgeGraph?.gaps[0];

  if (!graphGap) return [];

  return [{
    id: `missing-evidence-${slug(context.projectName)}-${slug(graphGap.id)}`,
    projectName: context.projectName,
    title: 'Missing evidence limits confidence',
    summary: graphGap.summary,
    weight: graphGap.severity === 'high' ? 16 : 9,
    priority: graphGap.severity,
    confidence: graphGap.confidence,
    evidence: [graphGap.summary],
    source: 'pie-knowledge-graph',
    recommendedAction: graphGap.suggestedAction,
    userApprovalRequired: false,
  }];
}

function candidateToPriority(
  candidate: AttentionCandidate,
): PIEExecutivePriority {
  return {
    id: `executive-priority-${candidate.id}`,
    projectName: candidate.projectName,
    title: candidate.title,
    summary: candidate.summary,
    priority: candidate.priority,
    attentionScore: clampAttentionScore(
      candidate.weight +
      priorityToWeight(candidate.priority) +
      confidenceToAttention(candidate.confidence),
    ),
    confidence: candidate.confidence,
    sources: [candidate.source],
    evidence: candidate.evidence,
    recommendedAction: candidate.recommendedAction,
    userApprovalRequired: Boolean(candidate.userApprovalRequired),
    shouldPrepare: Boolean(candidate.shouldPrepare),
    shouldEscalate:
      Boolean(candidate.shouldEscalate) ||
      candidate.priority === 'critical',
  };
}

function buildProjectsNeedingAttentionFromPriorities(
  priorities: PIEExecutivePriority[],
): PIEExecutiveAttentionItem[] {
  const byProject = new Map<string, PIEExecutivePriority[]>();

  priorities.forEach(priority => {
    const current = byProject.get(priority.projectName) ?? [];
    byProject.set(priority.projectName, [...current, priority]);
  });

  return Array.from(byProject.entries())
    .map(([projectName, projectPriorities]) => {
      const top = sortPriorities(projectPriorities)[0];

      return {
        id: `executive-attention-${slug(projectName)}`,
        projectName,
        title: top.title,
        reason: top.summary,
        attentionScore: Math.max(
          ...projectPriorities.map(priority => priority.attentionScore),
        ),
        priority: top.priority,
        confidence: top.confidence,
        evidence: uniqueText(projectPriorities.flatMap(priority => priority.evidence)),
      };
    })
    .sort((first, second) => second.attentionScore - first.attentionScore);
}

function buildEscalationsFromPriorities(
  priorities: PIEExecutivePriority[],
): PIEExecutiveEscalation[] {
  return priorities
    .filter(priority =>
      priority.shouldEscalate ||
      priority.priority === 'critical' ||
      priority.attentionScore >= 70,
    )
    .map(priority => ({
      id: `executive-escalation-${slug(priority.id)}`,
      projectName: priority.projectName,
      title: priority.title,
      reason: priority.summary,
      evidence: priority.evidence,
      urgency: priority.priority,
      confidence: priority.confidence,
      recommendedAction: priority.recommendedAction,
      userApprovalRequired: true,
    }));
}

function buildPreparationsFromContexts(
  contexts: ExecutiveProjectContext[],
  priorities: PIEExecutivePriority[],
): PIEExecutivePreparation[] {
  const priorityPreparations = priorities
    .filter(priority => priority.shouldPrepare)
    .map(priority => ({
      id: `executive-preparation-${slug(priority.id)}`,
      projectName: priority.projectName,
      title: preparationTitle(priority),
      purpose: priority.summary,
      preparedFor: preparationAudience(priority),
      evidence: priority.evidence,
      confidence: priority.confidence,
      userApprovalRequired: true,
      suggestedNextAction: priority.recommendedAction,
    }));
  const runtimePreparations = contexts.flatMap(context => {
    const items: PIEExecutivePreparation[] = [];
    const preparedness = context.runtime?.preparednessScore;
    if (!preparedness) return items;

    preparedness.factors
      .filter(factor => factor.score >= 70)
      .forEach(factor => {
        items.push({
          id: `executive-preparation-${slug(context.projectName)}-${factor.id}`,
          projectName: context.projectName,
          title: factor.label,
          purpose: factor.reason,
          preparedFor: preparednessAreaToPreparedFor(factor.area),
          evidence: [factor.reason || factor.label],
          confidence: factor.level,
          userApprovalRequired: true,
          suggestedNextAction:
            factor.improvementSuggestions[0] ||
            'Review prepared output before sharing.',
        });
      });

    return items;
  });

  return dedupePreparations([...priorityPreparations, ...runtimePreparations]);
}

function buildQuestionsFromContexts(
  contexts: ExecutiveProjectContext[],
  priorities: PIEExecutivePriority[],
): PIEExecutiveQuestion[] {
  const priorityQuestions = priorities
    .filter(priority =>
      includesAny(priority.title + priority.summary, [
        'missing',
        'unknown',
        'verify',
        'context',
      ]),
    )
    .map(priority => ({
      id: `executive-question-priority-${slug(priority.id)}`,
      projectName: priority.projectName,
      question: questionFromPriority(priority),
      reason: priority.summary,
      priority: priority.priority,
      confidence: priority.confidence,
      evidence: priority.evidence,
    }));
  const reasoningQuestions = contexts.flatMap(context =>
    (context.reasoning?.questions ?? []).map(question =>
      reasoningQuestionToExecutiveQuestion(context.projectName, question),
    ),
  );
  const runtimeUnknownQuestions = contexts.flatMap(context =>
    (context.runtime?.unknowns ?? []).slice(0, 3).map(unknown => ({
      id: `executive-question-unknown-${slug(unknown.id)}`,
      projectName: context.projectName,
      question: unknown.suggestedAction,
      reason: unknown.summary,
      priority: unknown.priority,
      confidence: unknown.confidence,
      evidence: [unknown.impact],
    })),
  );

  return dedupeQuestions([
    ...priorityQuestions,
    ...reasoningQuestions,
    ...runtimeUnknownQuestions,
  ]);
}

function buildRecommendationsFromPriorities(
  priorities: PIEExecutivePriority[],
): PIEExecutiveRecommendation[] {
  return priorities.slice(0, 8).map(priority => ({
    id: `executive-recommendation-${slug(priority.id)}`,
    projectName: priority.projectName,
    recommendation: priority.recommendedAction,
    why: priority.summary,
    evidence: priority.evidence,
    confidence: priority.confidence,
    urgency: priority.priority,
    userApprovalRequired: priority.userApprovalRequired,
    expectedImpact: expectedImpact(priority),
    sourcePriorityId: priority.id,
  }));
}

function buildExecutiveDecisionsFromContexts(
  contexts: ExecutiveProjectContext[],
): PIEExecutiveDecision[] {
  return sortExecutiveDecisions(
    contexts.flatMap(context =>
      [
        ...(context.decisionQueue?.decisions ?? []),
        ...(context.runtime?.decisionQueue.decisions ?? []),
      ].map(decisionToExecutiveDecision),
    ),
  );
}

function decisionToExecutiveDecision(
  decision: PIEDecision,
): PIEExecutiveDecision {
  return {
    id: `executive-decision-${decision.id}`,
    projectName: decision.projectName,
    title: decision.title,
    summary: decision.summary,
    priority: decision.priority,
    confidence: decision.confidence,
    userApprovalRequired: decision.userApproval.required,
    suggestedNextAction: decision.suggestedNextAction,
    evidence: decision.evidence,
  };
}

function recommendedOperatingModeFromState({
  contexts,
  priorities,
  preparations,
  questions,
  now,
}: {
  contexts: ExecutiveProjectContext[];
  priorities: PIEExecutivePriority[];
  preparations: PIEExecutivePreparation[];
  questions: PIEExecutiveQuestion[];
  now: Date;
}): PIEExecutiveOperatingMode {
  const hour = now.getHours();

  if (priorities.some(priority => priority.priority === 'critical')) {
    return 'active_project_review';
  }
  if (preparations.some(item => item.preparedFor === 'project-walk')) {
    return 'project_walk_prep';
  }
  if (preparations.some(item => item.preparedFor === 'executive')) {
    return 'executive_meeting_prep';
  }
  if (preparations.some(item => item.preparedFor === 'customer')) {
    return 'customer_update_prep';
  }
  if (hour < 11 && (priorities.length > 0 || contexts.length > 1)) {
    return 'morning_brief';
  }
  if (hour >= 16 && (priorities.length > 0 || questions.length > 0)) {
    return 'end_of_day_review';
  }

  return priorities.length > 0 ? 'active_project_review' : 'monitor';
}

function buildDailyRoutineFromState(
  mode: PIEExecutiveOperatingMode,
  priorities: PIEExecutivePriority[],
  preparations: PIEExecutivePreparation[],
  questions: PIEExecutiveQuestion[],
): PIEExecutiveRoutine {
  return {
    id: `executive-routine-${mode}`,
    mode,
    title: routineTitle(mode),
    summary: routineSummary(mode, priorities),
    steps: routineSteps(mode, priorities, preparations, questions),
    shouldRunNow: mode !== 'monitor' || priorities.length > 0,
    confidence: priorities[0]?.confidence || 'medium',
  };
}

function executiveSummary({
  contexts,
  topPriority,
  escalations,
  preparations,
  questionsForUser,
  confidence,
}: {
  contexts: ExecutiveProjectContext[];
  topPriority: PIEExecutivePriority | null;
  escalations: PIEExecutiveEscalation[];
  preparations: PIEExecutivePreparation[];
  questionsForUser: PIEExecutiveQuestion[];
  confidence: ProjectConfidenceLevel;
}) {
  if (!topPriority) {
    return `PIE Executive is monitoring ${contexts.length} project${contexts.length === 1 ? '' : 's'} with ${confidence} confidence. No urgent priority is visible from current PIE outputs.`;
  }

  return `${topPriority.projectName}: ${topPriority.title}. ${escalations.length} escalation${escalations.length === 1 ? '' : 's'}, ${preparations.length} preparation${preparations.length === 1 ? '' : 's'}, and ${questionsForUser.length} question${questionsForUser.length === 1 ? '' : 's'} need review.`;
}

function trustExplanation(contexts: ExecutiveProjectContext[]) {
  const runtime = contexts.find(context => context.runtime)?.runtime;
  if (runtime) {
    return `Runtime confidence is ${runtime.overallConfidence}; Trust Score ${runtime.trustScore.overallScore}%, Understanding Score ${runtime.understandingScore.score}%, relationship confidence ${runtime.relationshipConfidence.score}%.`;
  }

  const confidence = contexts[0]?.intelligence?.confidence;
  if (confidence) {
    return `Project intelligence confidence is ${confidence.score}% (${confidence.level}).`;
  }

  return 'PIE Executive has limited confidence because no Runtime or Intelligence output was provided.';
}

function buildWaitList(
  contexts: ExecutiveProjectContext[],
  priorities: PIEExecutivePriority[],
): string[] {
  const priorityProjects = new Set(priorities.map(priority => priority.projectName));

  return contexts
    .filter(context => !priorityProjects.has(context.projectName))
    .map(context =>
      `${context.projectName}: continue monitoring until new evidence, a decision, or a communication need appears.`,
    );
}

function executiveConfidence(
  contexts: ExecutiveProjectContext[],
  priorities: PIEExecutivePriority[],
): ProjectConfidenceLevel {
  if (priorities.some(priority => priority.confidence === 'low')) return 'low';
  if (contexts.some(context => context.runtime?.overallConfidence === 'low')) {
    return 'low';
  }
  if (
    contexts.length > 0 &&
    contexts.every(context =>
      context.runtime
        ? context.runtime.overallConfidence === 'high'
        : context.intelligence?.confidence.level === 'high',
    )
  ) {
    return 'high';
  }

  return 'medium';
}

function executiveSources(
  contexts: ExecutiveProjectContext[],
  priorities: PIEExecutivePriority[],
): PIEExecutiveSource[] {
  return uniqueText([
    ...priorities.flatMap(priority => priority.sources),
    ...contexts.flatMap(context => [
      context.runtime ? 'pie-runtime' : null,
      context.runtimeResponse ? 'pie-runtime-response' : null,
      context.decisionQueue ? 'pie-decision' : null,
      context.memory ? 'pie-memory' : null,
      context.reasoning ? 'pie-reasoning' : null,
      context.knowledgeGraph ? 'pie-knowledge-graph' : null,
      context.projectEvents.length > 0 ? 'project-event' : null,
      context.intelligence ? 'project-intelligence' : null,
    ]),
    'pie-executive',
  ]) as PIEExecutiveSource[];
}

function resolveProjectName(params: BuildPIEExecutiveBriefParams) {
  return params.runtimeResponse?.projectName ||
    params.decisionQueue?.projectName ||
    params.memory?.projectName ||
    params.reasoning?.projectName ||
    params.knowledgeGraph?.projectName ||
    params.intelligence?.projectName ||
    params.projectEvents?.[0]?.projectName ||
    'Portfolio';
}

function contextText(context: ExecutiveProjectContext) {
  return [
    context.runtimeResponse?.whatPIEKnows,
    context.runtimeResponse?.whatConcernsPIE,
    context.runtimeResponse?.whatPIERecommends,
    ...(context.intelligence?.riskSignals.map(risk => `${risk.label} ${risk.message}`) ?? []),
    ...(context.reasoning?.concerns.map(concern => `${concern.title} ${concern.summary}`) ?? []),
    ...(context.memory?.gaps.map(gap => `${gap.title} ${gap.summary}`) ?? []),
    ...(context.knowledgeGraph?.relationships.map(relationship => relationship.summary) ?? []),
    ...(context.projectEvents.map(event => `${event.title} ${event.description}`)),
  ].join(' ').toLowerCase();
}

function matchingEvidence(
  context: ExecutiveProjectContext,
  terms: string[],
): string[] {
  const normalizedTerms = terms.map(term => term.toLowerCase());
  const evidence = [
    ...(context.intelligence?.riskSignals.flatMap(risk => risk.evidence) ?? []),
    ...(context.reasoning?.evidence.map(item => item.detail) ?? []),
    ...(context.memory?.gaps.map(gap => gap.summary) ?? []),
    ...(context.knowledgeGraph?.relationships.map(relationship => relationship.summary) ?? []),
    ...(context.projectEvents.map(event => event.description)),
  ];

  return uniqueText(evidence.filter(item =>
    normalizedTerms.some(term => item.toLowerCase().includes(term)),
  ));
}

function reasoningQuestionToExecutiveQuestion(
  projectName: string,
  question: PIEQuestion,
): PIEExecutiveQuestion {
  return {
    id: `executive-question-${question.id}`,
    projectName,
    question: question.question,
    reason: question.reason,
    priority: question.priority,
    confidence: question.confidence,
    evidence: question.evidenceIds,
  };
}

function questionFromPriority(priority: PIEExecutivePriority) {
  if (includesAny(priority.title, ['inspection'])) {
    return 'What is the current inspection status?';
  }
  if (includesAny(priority.title, ['location', 'area'])) {
    return 'Is PIE using the correct project area?';
  }
  if (includesAny(priority.title, ['owner'])) {
    return 'Who owns this open item?';
  }

  return priority.recommendedAction;
}

function preparationTitle(priority: PIEExecutivePriority) {
  if (includesAny(priority.title, ['executive'])) return 'Prepare executive brief';
  if (includesAny(priority.title, ['customer'])) return 'Prepare customer update';
  if (includesAny(priority.title, ['walk'])) return 'Prepare Project Walk';

  return `Prepare review for ${priority.title}`;
}

function preparationAudience(
  priority: PIEExecutivePriority,
): PIEExecutivePreparation['preparedFor'] {
  if (includesAny(priority.title, ['executive'])) return 'executive';
  if (includesAny(priority.title, ['customer'])) return 'customer';
  if (includesAny(priority.title, ['walk'])) return 'project-walk';
  if (includesAny(priority.title, ['approval', 'decision'])) {
    return 'decision-review';
  }

  return 'field-update';
}

function preparednessAreaToPreparedFor(
  area: NonNullable<PIERuntimeState['preparednessScore']['factors'][number]>['area'],
): PIEExecutivePreparation['preparedFor'] {
  if (area === 'executive-meeting') return 'executive';
  if (area === 'customer-update') return 'customer';
  if (area === 'project-walk') return 'project-walk';
  if (area === 'decision') return 'decision-review';

  return 'field-update';
}

function expectedImpact(priority: PIEExecutivePriority) {
  if (priority.shouldEscalate) {
    return 'Reduces risk by getting user attention on the highest-impact item.';
  }
  if (priority.shouldPrepare) {
    return 'Reduces preparation time while keeping user approval in place.';
  }

  return 'Improves PIE confidence and project understanding.';
}

function routineTitle(mode: PIEExecutiveOperatingMode) {
  switch (mode) {
    case 'morning_brief':
      return 'Morning Executive Brief';
    case 'active_project_review':
      return 'Active Project Review';
    case 'project_walk_prep':
      return 'Project Walk Preparation';
    case 'executive_meeting_prep':
      return 'Executive Meeting Preparation';
    case 'customer_update_prep':
      return 'Customer Update Preparation';
    case 'end_of_day_review':
      return 'End-of-Day Review';
    case 'monitor':
    default:
      return 'Executive Monitoring';
  }
}

function routineSummary(
  mode: PIEExecutiveOperatingMode,
  priorities: PIEExecutivePriority[],
) {
  if (mode === 'monitor') {
    return 'PIE Executive is monitoring current Runtime outputs without an urgent action.';
  }

  return `${routineTitle(mode)} has ${priorities.length} ranked priorit${priorities.length === 1 ? 'y' : 'ies'}.`;
}

function routineSteps(
  mode: PIEExecutiveOperatingMode,
  priorities: PIEExecutivePriority[],
  preparations: PIEExecutivePreparation[],
  questions: PIEExecutiveQuestion[],
) {
  const topPriority = priorities[0];

  return uniqueText([
    topPriority ? `Review top priority: ${topPriority.title}.` : null,
    topPriority ? topPriority.recommendedAction : null,
    preparations[0] ? `Review prepared item: ${preparations[0].title}.` : null,
    questions[0] ? `Answer: ${questions[0].question}` : null,
    mode === 'monitor' ? 'Continue monitoring until project evidence changes.' : null,
    'User approval remains required before sending, closing, approving, or changing project status.',
  ]);
}

function priorityToWeight(priority: PIEDecisionPriority) {
  if (priority === 'critical') return 35;
  if (priority === 'high') return 24;
  if (priority === 'medium') return 14;

  return 6;
}

function confidenceToAttention(confidence: ProjectConfidenceLevel) {
  if (confidence === 'low') return 8;
  if (confidence === 'medium') return 4;

  return 0;
}

function severityToPriority(
  severity: ProjectSignalSeverity,
): PIEDecisionPriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'high';
  if (severity === 'positive') return 'low';

  return 'medium';
}

function clampAttentionScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function sortPriorities(priorities: PIEExecutivePriority[]) {
  return [...priorities].sort((first, second) => {
    const scoreDelta = second.attentionScore - first.attentionScore;
    if (scoreDelta !== 0) return scoreDelta;

    return priorityRank(second.priority) - priorityRank(first.priority);
  });
}

function sortExecutiveDecisions(decisions: PIEExecutiveDecision[]) {
  return dedupeExecutiveDecisions(decisions).sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function dedupePriorities(
  priorities: PIEExecutivePriority[],
): PIEExecutivePriority[] {
  const byKey = new Map<string, PIEExecutivePriority>();

  priorities.forEach(priority => {
    const key = normalizedKey(`${priority.projectName} ${priority.title}`);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...priority,
        evidence: uniqueText(priority.evidence),
        sources: uniqueText(priority.sources) as PIEExecutiveSource[],
      });
      return;
    }

    byKey.set(key, {
      ...existing,
      summary: longestText(existing.summary, priority.summary),
      priority: higherPriority(existing.priority, priority.priority),
      attentionScore: Math.max(existing.attentionScore, priority.attentionScore),
      confidence: lowerConfidence(existing.confidence, priority.confidence),
      evidence: uniqueText([...existing.evidence, ...priority.evidence]),
      sources: uniqueText([...existing.sources, ...priority.sources]) as PIEExecutiveSource[],
      recommendedAction: longestText(
        existing.recommendedAction,
        priority.recommendedAction,
      ),
      userApprovalRequired:
        existing.userApprovalRequired || priority.userApprovalRequired,
      shouldPrepare: existing.shouldPrepare || priority.shouldPrepare,
      shouldEscalate: existing.shouldEscalate || priority.shouldEscalate,
    });
  });

  return sortPriorities(Array.from(byKey.values()));
}

function dedupePreparations(
  preparations: PIEExecutivePreparation[],
): PIEExecutivePreparation[] {
  const byKey = new Map<string, PIEExecutivePreparation>();

  preparations.forEach(preparation => {
    const key = normalizedKey(`${preparation.projectName} ${preparation.title}`);
    if (!byKey.has(key)) byKey.set(key, preparation);
  });

  return Array.from(byKey.values());
}

function dedupeQuestions(
  questions: PIEExecutiveQuestion[],
): PIEExecutiveQuestion[] {
  const byKey = new Map<string, PIEExecutiveQuestion>();

  questions.forEach(question => {
    const key = normalizedKey(`${question.projectName} ${question.question}`);
    if (!byKey.has(key)) byKey.set(key, question);
  });

  return Array.from(byKey.values()).sort(
    (first, second) =>
      priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function dedupeExecutiveDecisions(
  decisions: PIEExecutiveDecision[],
): PIEExecutiveDecision[] {
  const byKey = new Map<string, PIEExecutiveDecision>();

  decisions.forEach(decision => {
    const key = normalizedKey(`${decision.projectName} ${decision.title}`);
    if (!byKey.has(key)) byKey.set(key, decision);
  });

  return Array.from(byKey.values());
}

function uniqueContexts(
  contexts: ExecutiveProjectContext[],
): ExecutiveProjectContext[] {
  const byKey = new Map<string, ExecutiveProjectContext>();

  contexts.forEach(context => {
    byKey.set(`${context.projectName}:${context.generatedAt}`, context);
  });

  return Array.from(byKey.values());
}

function priorityRank(priority: PIEDecisionPriority) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;

  return 1;
}

function higherPriority(
  first: PIEDecisionPriority,
  second: PIEDecisionPriority,
): PIEDecisionPriority {
  return priorityRank(second) > priorityRank(first) ? second : first;
}

function confidenceRank(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;

  return 1;
}

function lowerConfidence(
  first: ProjectConfidenceLevel,
  second: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  return confidenceRank(second) < confidenceRank(first) ? second : first;
}

function includesAny(value: string, terms: string[]) {
  const lowerValue = value.toLowerCase();

  return terms.some(term => lowerValue.includes(term.toLowerCase()));
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

function slug(value: string) {
  return (value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function longestText(first: string, second: string) {
  return second.length > first.length ? second : first;
}
