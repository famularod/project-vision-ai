import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSource,
  ProjectIntelligenceSummary,
  ProjectNextActionType,
  ProjectRiskSignal,
} from './ProjectIntelligenceEngine';
import type {
  PIEConcern,
  PIEQuestion,
  PIEReasoningResult,
  PIEReasoningSource,
  PIEThoughtRecommendation,
} from './PIEReasoningEngine';
import {
  getPIEConcerns,
  getPIEQuestions,
  getPIERecommendations,
} from './PIEReasoningEngine';
import type {
  PIEMemoryGap,
  PIEMemoryInsight,
  PIEMemorySnapshot,
  PIEMemorySource,
} from './PIEMemoryEngine';
import type {
  ProjectEvent,
  ProjectEventSource,
} from './ProjectEventService';

export type PIEDecisionPriority = 'low' | 'medium' | 'high' | 'critical';

export type PIEDecisionAction =
  | 'capture-todays-progress'
  | 'review-overdue-schedule-items'
  | 'verify-inspection-status'
  | 'generate-executive-report'
  | 'send-customer-update'
  | 'walk-project'
  | 'review-safety-concern'
  | 'update-missing-project-information'
  | 'review-open-project-decision'
  | 'continue-monitoring';

export type PIEDecisionSource =
  | ProjectIntelligenceSource
  | PIEReasoningSource
  | PIEMemorySource
  | ProjectEventSource
  | 'project-intelligence'
  | 'pie-reasoning'
  | 'pie-memory'
  | 'project-event'
  | 'decision-engine'
  | 'communication'
  | 'project-walk';

export type PIEDecisionImpactArea =
  | 'capture'
  | 'schedule'
  | 'inspection'
  | 'communication'
  | 'project-walk'
  | 'safety'
  | 'project-context'
  | 'decision'
  | 'monitoring';

export type PIEUserApprovalStatus =
  | 'not-required'
  | 'required'
  | 'approved'
  | 'rejected'
  | 'deferred';

export type PIEDecisionReason = {
  summary: string;
  why: string;
  evidence: string[];
  sources: PIEDecisionSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIEDecisionImpact = {
  area: PIEDecisionImpactArea;
  severity: PIEDecisionPriority;
  description: string;
  affectedStakeholders: string[];
};

export type PIEUserApprovalState = {
  required: boolean;
  status: PIEUserApprovalStatus;
  reason: string;
};

export type PIEDecision = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  priority: PIEDecisionPriority;
  action: PIEDecisionAction;
  reason: PIEDecisionReason;
  evidence: string[];
  sources: PIEDecisionSource[];
  confidence: ProjectConfidenceLevel;
  impact: PIEDecisionImpact;
  suggestedNextAction: string;
  userApproval: PIEUserApprovalState;
  createdAt: string;
  relatedDecisionIds: string[];
  metadata: Record<string, unknown>;
};

export type PIENextBestAction = {
  decisionId: string;
  projectName: string;
  title: string;
  summary: string;
  action: PIEDecisionAction;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  impact: PIEDecisionImpact;
  suggestedNextAction: string;
  userApprovalRequired: boolean;
  why: string;
  evidence: string[];
};

export type PIEDecisionQueue = {
  projectName: string;
  generatedAt: string;
  decisions: PIEDecision[];
  nextBestAction: PIENextBestAction;
  criticalDecisions: PIEDecision[];
  communicationDecisions: PIEDecision[];
  projectWalkDecision: PIEDecision | null;
  userApprovalRequiredDecisions: PIEDecision[];
  confidence: ProjectConfidenceLevel;
  sources: PIEDecisionSource[];
};

export type BuildPIEDecisionQueueParams = {
  projectName?: string;
  intelligence: ProjectIntelligenceSummary;
  reasoning?: PIEReasoningResult | null;
  memory?: PIEMemorySnapshot | null;
  projectEvents?: ProjectEvent[];
  now?: Date;
};

type DecisionContext = {
  projectName: string;
  generatedAt: string;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult | null;
  memory: PIEMemorySnapshot | null;
  projectEvents: ProjectEvent[];
  risks: ProjectRiskSignal[];
  concerns: PIEConcern[];
  questions: PIEQuestion[];
  recommendations: PIEThoughtRecommendation[];
  memoryGaps: PIEMemoryGap[];
  memoryInsights: PIEMemoryInsight[];
};

type DecisionInput = Omit<
  PIEDecision,
  | 'id'
  | 'projectName'
  | 'reason'
  | 'createdAt'
  | 'relatedDecisionIds'
  | 'metadata'
> & {
  id?: string;
  reason: Omit<PIEDecisionReason, 'evidence' | 'sources' | 'confidence'> &
    Partial<
      Pick<PIEDecisionReason, 'evidence' | 'sources' | 'confidence'>
    >;
  relatedDecisionIds?: string[];
  metadata?: Record<string, unknown>;
};

export function buildPIEDecisionQueue({
  projectName: explicitProjectName,
  intelligence,
  reasoning = null,
  memory = null,
  projectEvents,
  now = new Date(),
}: BuildPIEDecisionQueueParams): PIEDecisionQueue {
  const projectName = explicitProjectName?.trim() || intelligence.projectName;
  const generatedAt = now.toISOString();
  const context: DecisionContext = {
    projectName,
    generatedAt,
    intelligence,
    reasoning,
    memory,
    projectEvents: relatedProjectEvents(
      projectName,
      projectEvents ?? intelligence.recentEvents,
    ),
    risks: intelligence.riskSignals,
    concerns: reasoning ? getPIEConcerns(reasoning) : [],
    questions: reasoning ? getPIEQuestions(reasoning) : [],
    recommendations: reasoning ? getPIERecommendations(reasoning) : [],
    memoryGaps: memory?.gaps ?? [],
    memoryInsights: memory?.insights ?? [],
  };
  const decisions = sortDecisions(dedupeDecisions([
    ...coreProjectDecisions(context),
    ...intelligenceRecommendationDecisions(context),
    ...communicationDecisionsFromContext(context),
    ...reasoningDecisions(context),
    ...memoryDecisions(context),
    ...projectEventDecisions(context),
    ...projectWalkDecisionsFromContext(context),
  ]));
  const finalDecisions =
    decisions.length > 0 ? decisions : [monitoringDecision(context)];
  const nextBestAction = decisionToNextBestAction(finalDecisions[0]);

  return {
    projectName,
    generatedAt,
    decisions: finalDecisions,
    nextBestAction,
    criticalDecisions: finalDecisions.filter(isCriticalDecision),
    communicationDecisions: finalDecisions.filter(isCommunicationDecision),
    projectWalkDecision:
      finalDecisions.find(decision => decision.action === 'walk-project') ??
      null,
    userApprovalRequiredDecisions: finalDecisions.filter(
      decision => decision.userApproval.required,
    ),
    confidence: queueConfidence(finalDecisions),
    sources: uniqueSources(finalDecisions.flatMap(decision => decision.sources)),
  };
}

export function getNextBestAction(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIENextBestAction {
  return normalizeQueue(queueOrParams).nextBestAction;
}

export function getCriticalDecisions(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIEDecision[] {
  return normalizeQueue(queueOrParams).criticalDecisions;
}

export function getCommunicationDecisions(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIEDecision[] {
  return normalizeQueue(queueOrParams).communicationDecisions;
}

export function getProjectWalkDecision(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIEDecision | null {
  return normalizeQueue(queueOrParams).projectWalkDecision;
}

export function getUserApprovalRequiredDecisions(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIEDecision[] {
  return normalizeQueue(queueOrParams).userApprovalRequiredDecisions;
}

function intelligenceRecommendationDecisions(
  context: DecisionContext,
): PIEDecision[] {
  const action = actionFromProjectNextAction(
    context.intelligence.recommendedNextAction.action,
  );

  if (action === 'continue-monitoring') return [];

  return [
    createDecision(context, {
      id: `intelligence-next-action-${action}`,
      title: context.intelligence.recommendedNextAction.label,
      summary: context.intelligence.recommendedNextAction.description,
      priority: toDecisionPriority(
        context.intelligence.recommendedNextAction.priority,
      ),
      action,
      evidence: [
        context.intelligence.recommendedNextAction.description,
        context.intelligence.healthSignal.message,
      ],
      sources: uniqueSources([
        'project-intelligence',
        ...context.intelligence.recommendedNextAction.sources,
      ]),
      confidence: context.intelligence.recommendedNextAction.confidence,
      impact: {
        area: impactAreaFromText(
          `${context.intelligence.recommendedNextAction.label} ${context.intelligence.recommendedNextAction.description}`,
        ),
        severity: toDecisionPriority(
          context.intelligence.recommendedNextAction.priority,
        ),
        description: context.intelligence.recommendedNextAction.description,
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: context.intelligence.recommendedNextAction.label,
      userApproval: approvalForAction(action),
      reason: {
        summary: 'Project Intelligence Summary recommends this next action.',
        why: context.intelligence.recommendedNextAction.description,
      },
    }),
  ];
}

function coreProjectDecisions(context: DecisionContext): PIEDecision[] {
  const { intelligence } = context;
  const decisions: PIEDecision[] = [];

  if (
    intelligence.updateCount === 0 ||
    (intelligence.metrics.daysSinceLastUpdate ?? 0) > 7 ||
    intelligence.recommendedNextAction.action === 'capture-update' ||
    hasRisk(context, ['missing-updates', 'stale-update'])
  ) {
    const days = intelligence.metrics.daysSinceLastUpdate;
    const stale = days !== null && days > 7;

    decisions.push(createDecision(context, {
      id: 'capture-todays-progress',
      title: 'Capture today\'s progress',
      summary: stale
        ? `The latest update is ${days} days old.`
        : 'PIE needs a current field update to improve project confidence.',
      priority: days !== null && days > 14 ? 'critical' : 'high',
      action: 'capture-todays-progress',
      evidence: [
        intelligence.lastUpdate
          ? `Last update: ${intelligence.lastUpdate}.`
          : 'No saved update found for this project.',
        intelligence.healthSignal.message,
      ],
      sources: ['typed-update', 'project-intelligence'],
      confidence: intelligence.confidence.level,
      impact: {
        area: 'capture',
        severity: days !== null && days > 14 ? 'critical' : 'high',
        description: 'A current update improves project status, reporting, and assistant answers.',
        affectedStakeholders: ['Project Manager', 'Field Team'],
      },
      suggestedNextAction: 'Capture and review today\'s project progress before relying on status outputs.',
      userApproval: approvalRequired(
        'Capturing progress creates or updates project history, so the user must review and save it.',
      ),
      reason: {
        summary: 'Project status needs current field evidence.',
        why: stale
          ? 'PIE confidence drops when recent field history is stale.'
          : 'PIE cannot confidently explain project status without current field evidence.',
      },
      metadata: {
        daysSinceLastUpdate: days,
      },
    }));
  }

  if (
    intelligence.scheduleStatus === 'overdue' ||
    intelligence.overdueScheduleItems > 0 ||
    hasRisk(context, ['overdue-schedule'])
  ) {
    decisions.push(createDecision(context, {
      id: 'review-overdue-schedule-items',
      title: 'Review overdue schedule items',
      summary: `${intelligence.overdueScheduleItems} schedule item${intelligence.overdueScheduleItems === 1 ? ' is' : 's are'} overdue.`,
      priority: 'critical',
      action: 'review-overdue-schedule-items',
      evidence: [
        `Schedule status: ${intelligence.scheduleStatus}.`,
        `${intelligence.overdueScheduleItems} overdue schedule item${intelligence.overdueScheduleItems === 1 ? '' : 's'}.`,
      ],
      sources: ['schedule', 'project-intelligence'],
      confidence: 'high',
      impact: {
        area: 'schedule',
        severity: 'critical',
        description: 'Overdue work can affect schedule commitments and stakeholder expectations.',
        affectedStakeholders: ['Project Manager', 'Executive', 'Customer'],
      },
      suggestedNextAction: 'Review overdue items, confirm blockers, and capture a recovery action.',
      userApproval: approvalNotRequired(
        'PIE is only recommending review; schedule changes still require user action.',
      ),
      reason: {
        summary: 'Overdue schedule work needs attention.',
        why: 'Overdue schedule items are one of the strongest indicators that the project manager should act next.',
      },
    }));
  }

  if (
    intelligence.metrics.safetyConcernCount > 0 ||
    hasRisk(context, ['open-safety'])
  ) {
    decisions.push(createDecision(context, {
      id: 'review-safety-concern',
      title: 'Review safety concern',
      summary: `${intelligence.metrics.safetyConcernCount} open safety concern${intelligence.metrics.safetyConcernCount === 1 ? '' : 's'} found.`,
      priority: 'critical',
      action: 'review-safety-concern',
      evidence: [
        `${intelligence.metrics.safetyConcernCount} safety concern${intelligence.metrics.safetyConcernCount === 1 ? '' : 's'} in current project intelligence.`,
      ],
      sources: ['photo-action', 'project-intelligence'],
      confidence: 'high',
      impact: {
        area: 'safety',
        severity: 'critical',
        description: 'Safety concerns require review before normal project reporting or routine monitoring.',
        affectedStakeholders: ['Project Manager', 'Field Team', 'Safety Team'],
      },
      suggestedNextAction: 'Review the safety concern, confirm owner and closure status, and document the outcome.',
      userApproval: approvalNotRequired(
        'PIE can flag safety concern review, but the user must decide and record the outcome.',
      ),
      reason: {
        summary: 'Safety-related project evidence requires attention.',
        why: 'PIE prioritizes safety concerns above routine reporting and monitoring.',
      },
    }));
  }

  if (
    intelligence.confidence.level === 'low' ||
    intelligence.locationIntelligence.needsConfirmation ||
    hasRisk(context, [
      'missing-area-context',
      'location-needs-confirmation',
      'missing-document-context',
      'no-current-documents',
      'missing-schedule',
    ])
  ) {
    decisions.push(createDecision(context, {
      id: 'update-missing-project-information',
      title: 'Update missing project information',
      summary: 'PIE is missing context that would improve project confidence.',
      priority: intelligence.confidence.level === 'low' ? 'high' : 'medium',
      action: 'update-missing-project-information',
      evidence: [
        intelligence.confidence.message,
        ...intelligence.communicationReadiness.missingItems.slice(0, 3),
      ],
      sources: uniqueSources([
        'confidence',
        'project-intelligence',
        ...intelligence.confidence.sources,
      ]),
      confidence: intelligence.confidence.level,
      impact: {
        area: 'project-context',
        severity: intelligence.confidence.level === 'low' ? 'high' : 'medium',
        description: 'Missing context limits status confidence, project story quality, and communication readiness.',
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction:
        intelligence.locationIntelligence.confirmationPrompt ||
        'Fill the highest-value missing project context before sharing status.',
      userApproval: approvalRequired(
        'Adding or correcting project information changes what PIE will rely on later.',
      ),
      reason: {
        summary: 'Project confidence can be improved with missing context.',
        why: 'PIE should ask for correction or missing information when confidence is low instead of guessing.',
      },
      metadata: {
        confidenceScore: intelligence.confidence.score,
        locationConfidenceScore: intelligence.metrics.locationConfidenceScore,
      },
    }));
  }

  return decisions;
}

function communicationDecisionsFromContext(
  context: DecisionContext,
): PIEDecision[] {
  const { intelligence, reasoning } = context;
  const decisions: PIEDecision[] = [];
  const ready = intelligence.communicationReadiness.level === 'ready';
  const communicationEvidence = [
    intelligence.communicationReadiness.message,
    ...intelligence.communicationReadiness.strengths.slice(0, 3),
  ];

  if (ready) {
    decisions.push(createDecision(context, {
      id: 'generate-executive-report',
      title: 'Generate executive report',
      summary: 'Project data is ready enough to prepare an executive report for review.',
      priority: 'medium',
      action: 'generate-executive-report',
      evidence: communicationEvidence,
      sources: uniqueSources([
        'communication',
        'project-intelligence',
        ...intelligence.communicationReadiness.sources,
      ]),
      confidence: intelligence.communicationReadiness.confidence,
      impact: {
        area: 'communication',
        severity: 'medium',
        description: 'An executive report can turn current project intelligence into stakeholder-ready communication.',
        affectedStakeholders: ['Project Manager', 'Executive'],
      },
      suggestedNextAction: 'Generate the report, review it, and approve before sharing.',
      userApproval: approvalRequired(
        'PIE may prepare a report, but the user must review and approve it before sharing.',
      ),
      reason: {
        summary: 'Communication readiness is high.',
        why: 'The project has enough local context to support an executive communication draft.',
      },
    }));

    decisions.push(createDecision(context, {
      id: 'send-customer-update',
      title: 'Prepare customer update for approval',
      summary: 'Project status can support a customer-facing update after user review.',
      priority: hasCriticalRisk(context) ? 'high' : 'medium',
      action: 'send-customer-update',
      evidence: [
        ...communicationEvidence,
        reasoning?.communicationInsight.summary ||
          'Reasoning communication insight is not available.',
      ],
      sources: uniqueSources([
        'communication',
        'project-intelligence',
        ...(reasoning ? ['pie-reasoning' as const] : []),
      ]),
      confidence: intelligence.communicationReadiness.confidence,
      impact: {
        area: 'communication',
        severity: hasCriticalRisk(context) ? 'high' : 'medium',
        description: 'Customer communication can reduce uncertainty, but it must be reviewed before sending.',
        affectedStakeholders: ['Project Manager', 'Customer'],
      },
      suggestedNextAction: 'Review and approve the customer update before sending.',
      userApproval: approvalRequired(
        'PIE must never send customer communication automatically.',
      ),
      reason: {
        summary: 'Customer communication may now be useful.',
        why: 'PIE sees enough communication context to prepare a customer-facing draft, but the user must approve it.',
      },
    }));
  }

  return decisions;
}

function reasoningDecisions(context: DecisionContext): PIEDecision[] {
  const concernDecisions = context.concerns.slice(0, 3).map(concern =>
    createDecision(context, {
      id: `reasoning-concern-${stableId(concern.id)}`,
      title: concern.title,
      summary: concern.summary,
      priority: toDecisionPriority(concern.priority),
      action: actionFromText(concern.suggestedNextAction),
      evidence: evidenceByIds(context, concern.evidenceIds),
      sources: ['pie-reasoning', concern.source],
      confidence: concern.confidence,
      impact: {
        area: impactAreaFromText(`${concern.title} ${concern.summary}`),
        severity: toDecisionPriority(concern.priority),
        description: concern.impact,
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: concern.suggestedNextAction,
      userApproval: approvalForAction(
        actionFromText(concern.suggestedNextAction),
      ),
      reason: {
        summary: 'PIE reasoning surfaced a concern.',
        why: concern.summary,
      },
      relatedDecisionIds: [concern.id],
    }),
  );
  const questionDecisions = context.questions.slice(0, 3).map(question =>
    createDecision(context, {
      id: `reasoning-question-${stableId(question.id)}`,
      title: 'Answer open PIE question',
      summary: question.question,
      priority: toDecisionPriority(question.priority),
      action: 'update-missing-project-information',
      evidence: evidenceByIds(context, question.evidenceIds),
      sources: ['pie-reasoning', question.source],
      confidence: question.confidence,
      impact: {
        area: 'project-context',
        severity: toDecisionPriority(question.priority),
        description: 'Answering this question can improve PIE confidence and reduce project uncertainty.',
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: question.question,
      userApproval: approvalRequired(
        'Answering an open PIE question changes the project context PIE relies on.',
      ),
      reason: {
        summary: question.reason,
        why: 'PIE asks questions when confidence is not high enough to decide silently.',
      },
      relatedDecisionIds: [question.id],
    }),
  );
  const recommendationDecisions = context.recommendations.slice(0, 3).map(
    recommendation =>
      createDecision(context, {
        id: `reasoning-recommendation-${stableId(recommendation.id)}`,
        title: recommendation.title,
        summary: recommendation.why,
        priority: toDecisionPriority(recommendation.priority),
        action: actionFromText(
          `${recommendation.title} ${recommendation.suggestedNextAction}`,
        ),
        evidence:
          recommendation.evidence.length > 0
            ? recommendation.evidence
            : evidenceByIds(context, recommendation.evidenceIds),
        sources: ['pie-reasoning', recommendation.source],
        confidence: recommendation.confidence,
        impact: {
          area: impactAreaFromText(
            `${recommendation.title} ${recommendation.impact}`,
          ),
          severity: toDecisionPriority(recommendation.priority),
          description: recommendation.impact,
          affectedStakeholders: ['Project Manager'],
        },
        suggestedNextAction: recommendation.suggestedNextAction,
        userApproval: approvalForAction(
          actionFromText(
            `${recommendation.title} ${recommendation.suggestedNextAction}`,
          ),
        ),
        reason: {
          summary: recommendation.why,
          why: 'PIE reasoning produced a recommendation from evidence-backed thoughts.',
        },
        relatedDecisionIds: [recommendation.id],
      }),
  );

  return [...concernDecisions, ...questionDecisions, ...recommendationDecisions];
}

function memoryDecisions(context: DecisionContext): PIEDecision[] {
  const decisions = context.memoryGaps.slice(0, 4).map(gap =>
    createDecision(context, {
      id:
        gap.id === 'missing-inspection-status'
          ? 'verify-inspection-status'
          : `memory-gap-${stableId(gap.id)}`,
      title:
        gap.id === 'missing-inspection-status'
          ? 'Verify inspection status'
          : gap.title,
      summary: gap.summary,
      priority: toDecisionPriority(gap.priority),
      action:
        gap.id === 'missing-inspection-status'
          ? 'verify-inspection-status'
          : 'update-missing-project-information',
      evidence: [gap.summary, gap.impact],
      sources: ['pie-memory', gap.source],
      confidence: gap.confidence,
      impact: {
        area:
          gap.id === 'missing-inspection-status'
            ? 'inspection'
            : 'project-context',
        severity: toDecisionPriority(gap.priority),
        description: gap.impact,
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: gap.suggestedAction,
      userApproval: approvalRequired(
        'Resolving a memory gap updates project context or project history.',
      ),
      reason: {
        summary: 'Project memory has a gap that affects confidence.',
        why: gap.impact,
      },
      relatedDecisionIds: [gap.id],
    }),
  );
  const insightDecisions = context.memoryInsights.slice(0, 2).map(insight =>
    createDecision(context, {
      id: `memory-insight-${stableId(insight.id)}`,
      title: insight.title,
      summary: insight.summary,
      priority: toDecisionPriority(insight.priority),
      action: actionFromText(insight.suggestedNextAction),
      evidence: [insight.summary, insight.whyItMatters],
      sources: ['pie-memory', insight.source],
      confidence: insight.confidence,
      impact: {
        area: impactAreaFromText(`${insight.title} ${insight.summary}`),
        severity: toDecisionPriority(insight.priority),
        description: insight.whyItMatters,
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: insight.suggestedNextAction,
      userApproval: approvalForAction(actionFromText(insight.suggestedNextAction)),
      reason: {
        summary: 'Project memory produced an insight.',
        why: insight.whyItMatters,
      },
      relatedDecisionIds: [insight.id],
    }),
  );

  return [...decisions, ...insightDecisions];
}

function projectEventDecisions(context: DecisionContext): PIEDecision[] {
  const openDecisionEvents = context.projectEvents.filter(event => {
    if (event.eventType !== 'decision_recorded') return false;

    const status = String(event.metadata.status ?? '').trim().toLowerCase();
    return !['closed', 'complete', 'completed', 'resolved'].includes(status);
  });

  if (openDecisionEvents.length === 0) return [];

  return [
    createDecision(context, {
      id: 'review-open-project-decision',
      title: 'Review open project decision',
      summary: `${openDecisionEvents.length} project decision${openDecisionEvents.length === 1 ? '' : 's'} still need review.`,
      priority: 'high',
      action: 'review-open-project-decision',
      evidence: openDecisionEvents
        .slice(0, 3)
        .map(event => `${event.title}: ${event.description}`),
      sources: ['project-event', 'decision'],
      confidence: 'medium',
      impact: {
        area: 'decision',
        severity: 'high',
        description: 'Open decisions can block schedule, communication, or field execution.',
        affectedStakeholders: ['Project Manager'],
      },
      suggestedNextAction: 'Review the open decision and capture the approved outcome.',
      userApproval: approvalRequired(
        'PIE must not approve or close project decisions automatically.',
      ),
      reason: {
        summary: 'Project event memory includes open decisions.',
        why: 'Decisions require user review and approval before PIE treats them as resolved.',
      },
      relatedDecisionIds: openDecisionEvents.map(event => event.id),
    }),
  ];
}

function projectWalkDecisionsFromContext(
  context: DecisionContext,
): PIEDecision[] {
  const { intelligence, memory, questions, memoryGaps } = context;
  const needsWalk =
    intelligence.metrics.daysSinceLastUpdate === null ||
    (intelligence.metrics.daysSinceLastUpdate ?? 0) > 7 ||
    intelligence.confidence.level === 'low' ||
    memoryGaps.length > 0 ||
    questions.length > 0 ||
    intelligence.locationIntelligence.needsConfirmation;

  if (!needsWalk) return [];

  const priority: PIEDecisionPriority =
    hasCriticalRisk(context) ||
    (intelligence.metrics.daysSinceLastUpdate ?? 0) > 14
      ? 'high'
      : 'medium';

  return [
    createDecision(context, {
      id: 'walk-project',
      title: 'Walk the project',
      summary: 'A project walk would improve field confidence and resolve missing context.',
      priority,
      action: 'walk-project',
      evidence: [
        memory?.story.likelyNextStep ||
          intelligence.recommendedNextAction.label,
        ...memoryGaps.slice(0, 3).map(gap => gap.title),
        intelligence.locationIntelligence.confirmationPrompt ||
          intelligence.locationIntelligence.gpsStatus,
      ],
      sources: ['project-walk', 'pie-memory', 'project-intelligence'],
      confidence: memory?.confidence ?? intelligence.confidence.level,
      impact: {
        area: 'project-walk',
        severity: priority,
        description: 'Walking the project can verify current conditions, answer open questions, and prepare a better update.',
        affectedStakeholders: ['Project Manager', 'Field Team'],
      },
      suggestedNextAction: 'Start Project Walk, then review and approve any captured update before saving.',
      userApproval: approvalRequired(
        'Project Walk can prepare an update, but the user must start it and approve any saved output.',
      ),
      reason: {
        summary: 'Field verification would reduce uncertainty.',
        why: 'PIE sees stale, missing, low-confidence, or unresolved context that a project walk can clarify.',
      },
    }),
  ];
}

function monitoringDecision(context: DecisionContext): PIEDecision {
  return createDecision(context, {
    id: 'continue-monitoring',
    title: 'Continue monitoring project status',
    summary: 'No urgent decision surfaced from current local PIE signals.',
    priority: 'low',
    action: 'continue-monitoring',
    evidence: [context.intelligence.healthSignal.message],
    sources: ['decision-engine', 'project-intelligence'],
    confidence: context.intelligence.confidence.level,
    impact: {
      area: 'monitoring',
      severity: 'low',
      description: 'PIE will continue watching for schedule, safety, update, memory, and communication signals.',
      affectedStakeholders: ['Project Manager'],
    },
    suggestedNextAction: context.intelligence.recommendedNextAction.label,
    userApproval: approvalNotRequired(
      'No project record, communication, or status change is being made.',
    ),
    reason: {
      summary: 'Current signals do not require urgent action.',
      why: 'PIE did not find a higher-priority decision from current intelligence, reasoning, memory, or events.',
    },
  });
}

function createDecision(
  context: DecisionContext,
  input: DecisionInput,
): PIEDecision {
  const evidence = compactValues(input.evidence);
  const sources = uniqueSources(input.sources);
  const confidence = input.confidence;

  return {
    id: input.id ?? stableId(input.title, input.action),
    projectName: context.projectName,
    title: input.title,
    summary: input.summary,
    priority: input.priority,
    action: input.action,
    reason: {
      summary: input.reason.summary,
      why: input.reason.why,
      evidence: input.reason.evidence ?? evidence,
      sources: input.reason.sources
        ? uniqueSources(input.reason.sources)
        : sources,
      confidence: input.reason.confidence ?? confidence,
    },
    evidence,
    sources,
    confidence,
    impact: input.impact,
    suggestedNextAction: input.suggestedNextAction,
    userApproval: input.userApproval,
    createdAt: context.generatedAt,
    relatedDecisionIds: input.relatedDecisionIds ?? [],
    metadata: input.metadata ?? {},
  };
}

function decisionToNextBestAction(decision: PIEDecision): PIENextBestAction {
  return {
    decisionId: decision.id,
    projectName: decision.projectName,
    title: decision.title,
    summary: decision.summary,
    action: decision.action,
    priority: decision.priority,
    confidence: decision.confidence,
    impact: decision.impact,
    suggestedNextAction: decision.suggestedNextAction,
    userApprovalRequired: decision.userApproval.required,
    why: decision.reason.why,
    evidence: decision.evidence,
  };
}

function normalizeQueue(
  queueOrParams: PIEDecisionQueue | BuildPIEDecisionQueueParams,
): PIEDecisionQueue {
  return isDecisionQueue(queueOrParams)
    ? queueOrParams
    : buildPIEDecisionQueue(queueOrParams);
}

function isDecisionQueue(value: unknown): value is PIEDecisionQueue {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'decisions' in value &&
      'nextBestAction' in value,
  );
}

function hasRisk(context: DecisionContext, ids: string[]) {
  return context.risks.some(risk => ids.includes(risk.id));
}

function hasCriticalRisk(context: DecisionContext) {
  return context.risks.some(risk => risk.severity === 'critical');
}

function isCriticalDecision(decision: PIEDecision) {
  return decision.priority === 'critical';
}

function isCommunicationDecision(decision: PIEDecision) {
  return (
    decision.impact.area === 'communication' ||
    decision.action === 'generate-executive-report' ||
    decision.action === 'send-customer-update'
  );
}

function queueConfidence(decisions: PIEDecision[]): ProjectConfidenceLevel {
  if (decisions.some(decision => decision.confidence === 'high')) return 'high';
  if (decisions.some(decision => decision.confidence === 'medium')) return 'medium';

  return 'low';
}

function evidenceByIds(context: DecisionContext, evidenceIds: string[]) {
  if (!context.reasoning) return [];

  return evidenceIds
    .map(id => context.reasoning?.evidence.find(evidence => evidence.id === id))
    .filter((evidence): evidence is NonNullable<typeof evidence> => Boolean(evidence))
    .map(evidence => `${evidence.title}: ${evidence.detail}`);
}

function approvalRequired(reason: string): PIEUserApprovalState {
  return {
    required: true,
    status: 'required',
    reason,
  };
}

function approvalNotRequired(reason: string): PIEUserApprovalState {
  return {
    required: false,
    status: 'not-required',
    reason,
  };
}

function approvalForAction(action: PIEDecisionAction): PIEUserApprovalState {
  if (
    action === 'capture-todays-progress' ||
    action === 'verify-inspection-status' ||
    action === 'generate-executive-report' ||
    action === 'send-customer-update' ||
    action === 'walk-project' ||
    action === 'update-missing-project-information' ||
    action === 'review-open-project-decision'
  ) {
    return approvalRequired(
      'This decision affects project history, communication, or approved project context.',
    );
  }

  return approvalNotRequired(
    'PIE is recommending review only and is not changing project data.',
  );
}

function actionFromProjectNextAction(
  action: ProjectNextActionType,
): PIEDecisionAction {
  if (action === 'capture-update') return 'capture-todays-progress';
  if (
    action === 'review-overdue-schedule' ||
    action === 'review-upcoming-schedule'
  ) {
    return 'review-overdue-schedule-items';
  }
  if (action === 'review-safety') return 'review-safety-concern';
  if (action === 'generate-report') return 'generate-executive-report';
  if (action === 'review-decisions') return 'review-open-project-decision';
  if (
    action === 'add-schedule' ||
    action === 'review-project-areas' ||
    action === 'review-documents' ||
    action === 'sync-project'
  ) {
    return 'update-missing-project-information';
  }

  return 'continue-monitoring';
}

function actionFromText(value: string): PIEDecisionAction {
  const normalized = value.toLowerCase();

  if (normalized.includes('capture') || normalized.includes('update')) {
    return 'capture-todays-progress';
  }
  if (
    normalized.includes('overdue') ||
    normalized.includes('schedule') ||
    normalized.includes('recovery')
  ) {
    return 'review-overdue-schedule-items';
  }
  if (normalized.includes('inspection')) return 'verify-inspection-status';
  if (normalized.includes('executive') || normalized.includes('report')) {
    return 'generate-executive-report';
  }
  if (normalized.includes('customer') || normalized.includes('client')) {
    return 'send-customer-update';
  }
  if (normalized.includes('walk')) return 'walk-project';
  if (normalized.includes('safety')) return 'review-safety-concern';
  if (normalized.includes('decision')) return 'review-open-project-decision';
  if (
    normalized.includes('missing') ||
    normalized.includes('context') ||
    normalized.includes('question') ||
    normalized.includes('document') ||
    normalized.includes('area')
  ) {
    return 'update-missing-project-information';
  }

  return 'continue-monitoring';
}

function impactAreaFromText(value: string): PIEDecisionImpactArea {
  const normalized = value.toLowerCase();

  if (normalized.includes('safety')) return 'safety';
  if (normalized.includes('schedule') || normalized.includes('overdue')) {
    return 'schedule';
  }
  if (normalized.includes('inspection')) return 'inspection';
  if (
    normalized.includes('report') ||
    normalized.includes('customer') ||
    normalized.includes('communication')
  ) {
    return 'communication';
  }
  if (normalized.includes('walk')) return 'project-walk';
  if (normalized.includes('capture') || normalized.includes('update')) {
    return 'capture';
  }
  if (normalized.includes('decision')) return 'decision';

  return 'project-context';
}

function toDecisionPriority(
  priority: 'low' | 'medium' | 'high',
): PIEDecisionPriority {
  return priority;
}

function sortDecisions(decisions: PIEDecision[]) {
  return [...decisions].sort((left, right) => {
    const priorityDelta =
      priorityRank(right.priority) - priorityRank(left.priority);

    if (priorityDelta !== 0) return priorityDelta;

    const confidenceDelta =
      confidenceRank(right.confidence) - confidenceRank(left.confidence);

    if (confidenceDelta !== 0) return confidenceDelta;

    return left.title.localeCompare(right.title);
  });
}

function dedupeDecisions(decisions: PIEDecision[]) {
  const byAction = new Map<string, PIEDecision>();

  decisions.forEach(decision => {
    const key = decision.id || decision.action;
    const existing = byAction.get(key);

    if (!existing || compareDecisionPriority(decision, existing) > 0) {
      byAction.set(key, decision);
    }
  });

  return Array.from(byAction.values());
}

function compareDecisionPriority(left: PIEDecision, right: PIEDecision) {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);

  if (priorityDelta !== 0) return priorityDelta;

  return confidenceRank(left.confidence) - confidenceRank(right.confidence);
}

function priorityRank(priority: PIEDecisionPriority) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;

  return 1;
}

function confidenceRank(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;

  return 1;
}

function relatedProjectEvents(projectName: string, events: ProjectEvent[]) {
  const key = projectName.trim().toLowerCase();

  return events.filter(
    event => event.projectName.trim().toLowerCase() === key,
  );
}

function uniqueSources(sources: PIEDecisionSource[]) {
  const seen = new Set<string>();
  const unique: PIEDecisionSource[] = [];

  sources.forEach(source => {
    const key = source.trim().toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(source);
  });

  return unique;
}

function compactValues(values: Array<string | null | undefined>) {
  return values
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function stableId(...values: string[]) {
  return (
    values
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'decision'
  );
}

export function decisionActionFromProjectNextAction(
  action: ProjectNextActionType,
): PIEDecisionAction {
  return actionFromProjectNextAction(action);
}
