import type {
  PIEDecision,
  PIEDecisionPriority,
  PIEDecisionQueue,
} from './PIEDecisionEngine';
import type { PIEExecutiveBrief } from './PIEExecutive';
import type {
  PIEGraph,
  PIEGraphGap,
  PIEGraphRelationship,
} from './PIEKnowledgeGraph';
import type { PIEMemoryGap, PIEMemorySnapshot } from './PIEMemoryEngine';
import type {
  PIEQuestion,
  PIEReasoningResult,
  PIEThoughtRecommendation,
} from './PIEReasoningEngine';
import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
} from './ProjectIntelligenceEngine';
import type { ProjectEvent } from './ProjectEventService';
import type {
  PIEBelief,
  PIERecommendation,
  PIERuntimeResponse,
  PIERuntimeState,
} from './PIERuntime';

export type PIEReflectionPriority = 'low' | 'medium' | 'high' | 'critical';

export type PIEReflectionSource =
  | 'pie-runtime'
  | 'pie-runtime-response'
  | 'pie-executive'
  | 'pie-decision'
  | 'pie-reasoning'
  | 'pie-memory'
  | 'pie-knowledge-graph'
  | 'project-event'
  | 'project-intelligence'
  | 'pie-reflection';

export type PIEReflectionFinding = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  priority: PIEReflectionPriority;
  confidence: ProjectConfidenceLevel;
  source: PIEReflectionSource;
  evidence: string[];
  suggestedAction: string;
  createdAt: string;
};

export type PIEReflectionRisk = {
  id: string;
  projectName: string;
  title: string;
  risk: string;
  impact: string;
  priority: PIEReflectionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  suggestedVerification: string;
  createdAt: string;
};

export type PIEReflectionGap = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  missingEvidenceType:
    | 'photo'
    | 'schedule'
    | 'inspection'
    | 'update'
    | 'document'
    | 'relationship'
    | 'owner'
    | 'confidence'
    | 'unknown';
  impact: string;
  priority: PIEReflectionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  relatedRecommendationIds: string[];
  suggestedAction: string;
  createdAt: string;
};

export type PIEReflectionWeakRecommendation = {
  id: string;
  projectName: string;
  recommendationId: string;
  title: string;
  summary: string;
  weakness: string[];
  evidenceCount: number;
  confidence: ProjectConfidenceLevel;
  priority: PIEReflectionPriority;
  source: PIEReflectionSource;
  userApprovalRequired: boolean;
  suggestedAction: string;
};

export type PIEReflectionVerificationQuestion = {
  id: string;
  projectName: string;
  question: string;
  reason: string;
  priority: PIEReflectionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  source: PIEReflectionSource;
};

export type PIEReflectionConfidenceAdjustment = {
  id: string;
  targetId: string;
  targetType:
    | 'runtime'
    | 'belief'
    | 'recommendation'
    | 'decision'
    | 'executive-priority'
    | 'project-intelligence';
  currentConfidence: ProjectConfidenceLevel;
  suggestedConfidence: ProjectConfidenceLevel;
  reason: string;
  evidence: string[];
};

export type PIEReflectionConfidenceAudit = {
  score: number;
  level: ProjectConfidenceLevel;
  summary: string;
  suggestedAdjustments: PIEReflectionConfidenceAdjustment[];
  factors: Array<{
    id: string;
    label: string;
    score: number;
    reason: string;
  }>;
};

export type PIEReflectionEvidenceAudit = {
  score: number;
  level: ProjectConfidenceLevel;
  summary: string;
  totalEvidenceCount: number;
  freshEvidenceCount: number;
  staleEvidenceCount: number;
  strongestEvidence: string[];
  weakestEvidence: string[];
  missingEvidence: PIEReflectionGap[];
  contradictions: string[];
  recommendationSupport: Array<{
    recommendationId: string;
    title: string;
    evidenceCount: number;
    confidence: ProjectConfidenceLevel;
  }>;
};

export type PIEReflectionResult = {
  id: string;
  projectName: string;
  generatedAt: string;
  overallReflectionScore: number;
  reflectionLevel: ProjectConfidenceLevel;
  reflectionSummary: string;
  strongestSupportedBelief: PIEBelief | null;
  weakestSupportedBelief: PIEBelief | null;
  findings: PIEReflectionFinding[];
  risks: PIEReflectionRisk[];
  gaps: PIEReflectionGap[];
  weakRecommendations: PIEReflectionWeakRecommendation[];
  verificationQuestions: PIEReflectionVerificationQuestion[];
  confidenceAudit: PIEReflectionConfidenceAudit;
  evidenceAudit: PIEReflectionEvidenceAudit;
  suggestedConfidenceAdjustments: PIEReflectionConfidenceAdjustment[];
  whatPIEShouldVerifyFirst: string;
  userFacingExplanation: string;
  priority: PIEReflectionPriority;
  sources: PIEReflectionSource[];
};

export type BuildPIEReflectionParams = {
  runtime?: PIERuntimeState | null;
  runtimeResponse?: PIERuntimeResponse | null;
  executiveBrief?: PIEExecutiveBrief | null;
  decisionQueue?: PIEDecisionQueue | null;
  reasoning?: PIEReasoningResult | null;
  memory?: PIEMemorySnapshot | null;
  knowledgeGraph?: PIEGraph | null;
  projectEvents?: ProjectEvent[];
  intelligence?: ProjectIntelligenceSummary | null;
  now?: Date;
};

type ReflectionInput = PIEReflectionResult | BuildPIEReflectionParams;

type ReflectionContext = {
  projectName: string;
  generatedAt: string;
  runtime: PIERuntimeState | null;
  runtimeResponse: PIERuntimeResponse | null;
  executiveBrief: PIEExecutiveBrief | null;
  decisionQueue: PIEDecisionQueue | null;
  reasoning: PIEReasoningResult | null;
  memory: PIEMemorySnapshot | null;
  knowledgeGraph: PIEGraph | null;
  projectEvents: ProjectEvent[];
  intelligence: ProjectIntelligenceSummary | null;
  recommendations: ReflectionRecommendation[];
  beliefs: PIEBelief[];
  questions: PIEQuestion[];
  memoryGaps: PIEMemoryGap[];
  graphGaps: PIEGraphGap[];
  graphContradictions: PIEGraphRelationship[];
};

type ReflectionRecommendation = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  priority: PIEReflectionPriority;
  source: PIEReflectionSource;
  userApprovalRequired: boolean;
  suggestedAction: string;
};

export function buildPIEReflection(
  params: BuildPIEReflectionParams = {},
): PIEReflectionResult {
  const context = buildReflectionContext(params);
  const gaps = findReflectionGaps(context);
  const weakRecommendations = findWeakRecommendations(context);
  const risks = getReflectionRisks(context);
  const verificationQuestions = getVerificationQuestions({
    ...context,
    gaps,
    weakRecommendations,
    risks,
  });
  const evidenceAudit = auditPIEEvidence({
    ...context,
    gaps,
  });
  const confidenceAudit = auditPIEConfidence({
    ...context,
    gaps,
    weakRecommendations,
    risks,
    evidenceAudit,
  });
  const findings = buildFindings({
    context,
    gaps,
    weakRecommendations,
    risks,
    confidenceAudit,
    evidenceAudit,
  });
  const overallReflectionScore = reflectionScore({
    confidenceAudit,
    evidenceAudit,
    gaps,
    weakRecommendations,
    risks,
  });
  const reflectionLevel = confidenceFromScore(overallReflectionScore);
  const priority = getReflectionPriority({
    ...context,
    gaps,
    weakRecommendations,
    risks,
  });
  const strongestSupportedBelief = strongestBelief(context.beliefs);
  const weakestSupportedBelief = weakestBelief(context.beliefs);
  const whatPIEShouldVerifyFirst =
    verificationQuestions[0]?.question ||
    gaps[0]?.suggestedAction ||
    weakRecommendations[0]?.suggestedAction ||
    'Continue monitoring; PIE does not see a specific verification need.';

  return {
    id: `pie-reflection:${slug(context.projectName)}:${context.generatedAt}`,
    projectName: context.projectName,
    generatedAt: context.generatedAt,
    overallReflectionScore,
    reflectionLevel,
    reflectionSummary: reflectionSummary({
      context,
      reflectionLevel,
      gaps,
      weakRecommendations,
      risks,
    }),
    strongestSupportedBelief,
    weakestSupportedBelief,
    findings,
    risks,
    gaps,
    weakRecommendations,
    verificationQuestions,
    confidenceAudit,
    evidenceAudit,
    suggestedConfidenceAdjustments: confidenceAudit.suggestedAdjustments,
    whatPIEShouldVerifyFirst,
    userFacingExplanation: userFacingExplanation({
      reflectionLevel,
      weakRecommendations,
      gaps,
      whatPIEShouldVerifyFirst,
    }),
    priority,
    sources: reflectionSources(context),
  };
}

export function auditPIEConfidence(
  input: ReflectionInput & {
    gaps?: PIEReflectionGap[];
    weakRecommendations?: PIEReflectionWeakRecommendation[];
    risks?: PIEReflectionRisk[];
    evidenceAudit?: PIEReflectionEvidenceAudit;
  } = {},
): PIEReflectionConfidenceAudit {
  const result = asReflectionResult(input);
  if (result) return result.confidenceAudit;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const gaps = input.gaps ?? findReflectionGaps(context);
  const weakRecommendations =
    input.weakRecommendations ?? findWeakRecommendations(context);
  const risks = input.risks ?? getReflectionRisks(context);
  const evidenceAudit =
    input.evidenceAudit ?? auditPIEEvidence({ ...context, gaps });
  const trustScore = context.runtime?.trustScore.overallScore ??
    context.intelligence?.confidence.score ??
    scoreForConfidence(context.runtime?.overallConfidence ?? 'medium');
  const understandingScore = context.runtime?.understandingScore.score ??
    scoreForConfidence(context.memory?.confidence ?? 'medium');
  const contradictionCount = evidenceAudit.contradictions.length;
  const lowConfidenceCount = [
    context.runtime?.overallConfidence,
    context.executiveBrief?.confidence,
    context.decisionQueue?.confidence,
    context.reasoning?.communicationInsight.confidence,
    context.memory?.confidence,
    context.intelligence?.confidence.level,
  ].filter(value => value === 'low').length;
  const score = clamp(
    Math.round(
      trustScore * 0.3 +
      understandingScore * 0.25 +
      evidenceAudit.score * 0.25 +
      (100 - Math.min(100, weakRecommendations.length * 18)) * 0.1 +
      (100 - Math.min(100, gaps.length * 12 + contradictionCount * 18)) * 0.1,
    ) - lowConfidenceCount * 4,
    0,
    100,
  );
  const suggestedAdjustments = buildConfidenceAdjustments({
    context,
    gaps,
    weakRecommendations,
    risks,
    evidenceAudit,
  });

  return {
    score,
    level: confidenceFromScore(score),
    summary:
      suggestedAdjustments.length > 0
        ? `${suggestedAdjustments.length} confidence adjustment${suggestedAdjustments.length === 1 ? '' : 's'} should be considered.`
        : 'PIE confidence appears consistent with current supporting evidence.',
    suggestedAdjustments,
    factors: [
      {
        id: 'reflection-trust',
        label: 'Runtime Trust',
        score: trustScore,
        reason: context.runtime
          ? `Runtime Trust Score is ${context.runtime.trustScore.overallScore}.`
          : 'Runtime Trust Score is not available.',
      },
      {
        id: 'reflection-understanding',
        label: 'Runtime Understanding',
        score: understandingScore,
        reason: context.runtime
          ? `Runtime Understanding Score is ${context.runtime.understandingScore.score}.`
          : 'Runtime Understanding Score is not available.',
      },
      {
        id: 'reflection-evidence',
        label: 'Evidence Support',
        score: evidenceAudit.score,
        reason: evidenceAudit.summary,
      },
      {
        id: 'reflection-weak-recommendations',
        label: 'Weak Recommendations',
        score: 100 - Math.min(100, weakRecommendations.length * 18),
        reason: `${weakRecommendations.length} weak recommendation${weakRecommendations.length === 1 ? '' : 's'} found.`,
      },
      {
        id: 'reflection-contradictions',
        label: 'Contradictions',
        score: 100 - Math.min(100, contradictionCount * 25),
        reason: `${contradictionCount} contradiction signal${contradictionCount === 1 ? '' : 's'} found.`,
      },
    ],
  };
}

export function auditPIEEvidence(
  input: ReflectionInput & {
    gaps?: PIEReflectionGap[];
  } = {},
): PIEReflectionEvidenceAudit {
  const result = asReflectionResult(input);
  if (result) return result.evidenceAudit;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const gaps = input.gaps ?? findReflectionGaps(context);
  const evidence = collectEvidence(context);
  const freshEvidence = evidence.filter(item => !item.isStale);
  const staleEvidence = evidence.filter(item => item.isStale);
  const contradictions = uniqueText([
    ...context.beliefs.flatMap(belief =>
      belief.contradictingEvidence.map(item => item.detail),
    ),
    ...context.graphContradictions.map(item => item.summary),
    context.intelligence?.metrics.syncConflictCount
      ? `${context.intelligence.metrics.syncConflictCount} sync conflict signal${context.intelligence.metrics.syncConflictCount === 1 ? '' : 's'} detected.`
      : null,
  ]);
  const recommendationSupport = context.recommendations.map(recommendation => ({
    recommendationId: recommendation.id,
    title: recommendation.title,
    evidenceCount: uniqueText(recommendation.evidence).length,
    confidence: recommendation.confidence,
  }));
  const supportAverage =
    recommendationSupport.length === 0
      ? 45
      : recommendationSupport.reduce(
          (sum, item) => sum + Math.min(100, item.evidenceCount * 35),
          0,
        ) / recommendationSupport.length;
  const score = clamp(
    Math.round(
      Math.min(100, evidence.length * 8) * 0.3 +
      (evidence.length === 0
        ? 0
        : (freshEvidence.length / evidence.length) * 100) * 0.25 +
      supportAverage * 0.25 +
      (100 - Math.min(100, gaps.length * 12 + contradictions.length * 20)) * 0.2,
    ),
    0,
    100,
  );

  return {
    score,
    level: confidenceFromScore(score),
    summary:
      evidence.length === 0
        ? 'PIE Reflection found no supporting evidence in the supplied PIE outputs.'
        : `${evidence.length} evidence signal${evidence.length === 1 ? '' : 's'} reviewed; ${freshEvidence.length} appear current and ${staleEvidence.length} appear stale.`,
    totalEvidenceCount: evidence.length,
    freshEvidenceCount: freshEvidence.length,
    staleEvidenceCount: staleEvidence.length,
    strongestEvidence: evidence
      .filter(item => item.confidence === 'high' && !item.isStale)
      .slice(0, 5)
      .map(item => item.detail),
    weakestEvidence: uniqueText([
      ...staleEvidence.slice(0, 5).map(item => item.detail),
      ...context.recommendations
        .filter(recommendation => recommendation.evidence.length === 0)
        .slice(0, 3)
        .map(recommendation => `${recommendation.title} has no attached evidence.`),
    ]),
    missingEvidence: gaps,
    contradictions,
    recommendationSupport,
  };
}

export function findWeakRecommendations(
  input: ReflectionInput,
): PIEReflectionWeakRecommendation[] {
  const result = asReflectionResult(input);
  if (result) return result.weakRecommendations;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);

  return sortWeakRecommendations(dedupeWeakRecommendations(
    context.recommendations.flatMap(recommendation => {
      const evidence = uniqueText(recommendation.evidence);
      const weakness = uniqueText([
        evidence.length === 0 ? 'No supporting evidence is attached.' : null,
        evidence.length === 1 ? 'Only one supporting evidence item is attached.' : null,
        recommendation.confidence === 'low'
          ? 'Recommendation confidence is low.'
          : null,
        recommendation.priority === 'critical' && evidence.length < 2
          ? 'Critical recommendation has fewer than two evidence items.'
          : null,
        recommendation.priority === 'high' && evidence.length < 2
          ? 'High-priority recommendation has weak support.'
          : null,
        textContains(recommendationText(recommendation), ['inspection']) &&
          !hasInspectionEvidence(context)
          ? 'Inspection recommendation is missing inspection status evidence.'
          : null,
        textContains(recommendationText(recommendation), ['schedule', 'overdue']) &&
          !hasScheduleEvidence(context)
          ? 'Schedule recommendation is missing schedule support.'
          : null,
        hasStaleUpdateRisk(context) &&
          textContains(recommendationText(recommendation), ['status', 'progress'])
          ? 'Project status recommendation may rely on stale update evidence.'
          : null,
      ]);

      if (weakness.length === 0) return [];

      return [{
        id: `reflection-weak-recommendation-${slug(recommendation.id)}`,
        projectName: recommendation.projectName,
        recommendationId: recommendation.id,
        title: recommendation.title,
        summary: recommendation.summary,
        weakness,
        evidenceCount: evidence.length,
        confidence: recommendation.confidence,
        priority: recommendation.priority,
        source: recommendation.source,
        userApprovalRequired: recommendation.userApprovalRequired,
        suggestedAction: `Verify support for: ${recommendation.suggestedAction}`,
      }];
    }),
  ));
}

export function findReflectionGaps(
  input: ReflectionInput,
): PIEReflectionGap[] {
  const result = asReflectionResult(input);
  if (result) return result.gaps;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const generatedAt = context.generatedAt;
  const gaps: PIEReflectionGap[] = [];

  if (hasStaleUpdateRisk(context)) {
    gaps.push(reflectionGap({
      id: 'stale-update',
      context,
      title: 'Recent update is stale or missing',
      summary: staleUpdateSummary(context),
      missingEvidenceType: 'update',
      impact:
        'PIE may be reasoning from outdated project status and should verify current field conditions.',
      priority: 'high',
      confidence: 'high',
      evidence: [staleUpdateSummary(context)],
      suggestedAction: 'Capture or verify the latest project update.',
      createdAt: generatedAt,
    }));
  }

  if (!hasPhotoEvidence(context)) {
    gaps.push(reflectionGap({
      id: 'missing-photos',
      context,
      title: 'Photo evidence is missing',
      summary: 'PIE does not see field photos in current project evidence.',
      missingEvidenceType: 'photo',
      impact:
        'Visual confirmation is weak; progress, quality, safety, and completion conclusions may be less reliable.',
      priority: 'medium',
      confidence: 'high',
      evidence: ['No photo evidence detected.'],
      suggestedAction: 'Capture current field photos with captions.',
      createdAt: generatedAt,
    }));
  }

  if (!hasScheduleEvidence(context)) {
    gaps.push(reflectionGap({
      id: 'missing-schedule',
      context,
      title: 'Schedule support is missing',
      summary: 'PIE does not see schedule items or schedule relationship evidence.',
      missingEvidenceType: 'schedule',
      impact:
        'Schedule risk, overdue work, and next milestone recommendations may stay broad.',
      priority: 'medium',
      confidence: 'high',
      evidence: ['No schedule evidence detected.'],
      suggestedAction: 'Import or enter schedule items before relying on schedule conclusions.',
      createdAt: generatedAt,
    }));
  }

  if (needsInspectionStatus(context)) {
    gaps.push(reflectionGap({
      id: 'missing-inspection-status',
      context,
      title: 'Inspection status needs verification',
      summary:
        'Inspection is mentioned or implied, but PIE does not see a clear inspection status.',
      missingEvidenceType: 'inspection',
      impact:
        'Completion or communication recommendations may be premature without inspection status.',
      priority: 'high',
      confidence: 'medium',
      evidence: matchingContextEvidence(context, ['inspection']),
      suggestedAction: 'Verify and record the current inspection status.',
      createdAt: generatedAt,
    }));
  }

  context.graphGaps.slice(0, 4).forEach(gap => {
    gaps.push(reflectionGap({
      id: `graph-${gap.id}`,
      context,
      title: gap.title,
      summary: gap.summary,
      missingEvidenceType: graphGapType(gap),
      impact:
        'PIE has weaker relationship confidence until this missing relationship evidence is resolved.',
      priority: gap.severity,
      confidence: gap.confidence,
      evidence: [gap.summary],
      suggestedAction: gap.suggestedAction,
      createdAt: generatedAt,
    }));
  });

  context.memoryGaps.slice(0, 4).forEach(gap => {
    gaps.push(reflectionGap({
      id: `memory-${gap.id}`,
      context,
      title: gap.title,
      summary: gap.summary,
      missingEvidenceType: memoryGapType(gap),
      impact: gap.impact,
      priority: gap.priority,
      confidence: gap.confidence,
      evidence: [gap.summary],
      suggestedAction: gap.suggestedAction,
      createdAt: generatedAt,
    }));
  });

  return sortGaps(dedupeGaps(gaps));
}

export function getVerificationQuestions(
  input: ReflectionInput & {
    gaps?: PIEReflectionGap[];
    weakRecommendations?: PIEReflectionWeakRecommendation[];
    risks?: PIEReflectionRisk[];
  },
): PIEReflectionVerificationQuestion[] {
  const result = asReflectionResult(input);
  if (result) return result.verificationQuestions;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const gaps = input.gaps ?? findReflectionGaps(context);
  const weakRecommendations =
    input.weakRecommendations ?? findWeakRecommendations(context);
  const risks = input.risks ?? getReflectionRisks(context);
  const questions: PIEReflectionVerificationQuestion[] = [
    ...context.questions.slice(0, 4).map(question => ({
      id: `reflection-question-${question.id}`,
      projectName: question.projectName,
      question: question.question,
      reason: question.reason,
      priority: question.priority,
      confidence: question.confidence,
      evidence: question.evidenceIds,
      source: 'pie-reasoning' as const,
    })),
    ...gaps.slice(0, 4).map(gap => ({
      id: `reflection-gap-question-${gap.id}`,
      projectName: gap.projectName,
      question: questionForGap(gap),
      reason: gap.impact,
      priority: gap.priority,
      confidence: gap.confidence,
      evidence: gap.evidence,
      source: 'pie-reflection' as const,
    })),
    ...weakRecommendations.slice(0, 3).map(recommendation => ({
      id: `reflection-weak-question-${recommendation.id}`,
      projectName: recommendation.projectName,
      question: `What evidence confirms "${recommendation.title}"?`,
      reason: recommendation.weakness.join(' '),
      priority: recommendation.priority,
      confidence: recommendation.confidence,
      evidence: recommendation.weakness,
      source: 'pie-reflection' as const,
    })),
    ...risks.slice(0, 3).map(risk => ({
      id: `reflection-risk-question-${risk.id}`,
      projectName: risk.projectName,
      question: risk.suggestedVerification,
      reason: risk.impact,
      priority: risk.priority,
      confidence: risk.confidence,
      evidence: risk.evidence,
      source: 'pie-reflection' as const,
    })),
  ];

  return dedupeQuestions(sortQuestions(questions));
}

export function getReflectionRisks(
  input: ReflectionInput,
): PIEReflectionRisk[] {
  const result = asReflectionResult(input);
  if (result) return result.risks;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const risks: PIEReflectionRisk[] = [];

  context.decisionQueue?.decisions
    .filter(decision =>
      ['high', 'critical'].includes(decision.priority) &&
      (decision.evidence.length < 2 || decision.confidence === 'low'),
    )
    .forEach(decision => {
      risks.push(reflectionRisk({
        id: `weak-high-priority-decision-${decision.id}`,
        context,
        title: 'High-priority decision has weak support',
        risk: decision.title,
        impact:
          'PIE may be asking for urgent action before enough evidence is attached.',
        priority: decision.priority,
        confidence: decision.confidence,
        evidence: decision.evidence,
        suggestedVerification: `Verify evidence before acting on: ${decision.suggestedNextAction}`,
      }));
    });

  if (context.graphContradictions.length > 0) {
    risks.push(reflectionRisk({
      id: 'contradicting-graph-evidence',
      context,
      title: 'Contradicting evidence exists',
      risk: 'Knowledge Graph contains contradiction relationships.',
      impact:
        'PIE should reduce confidence until contradicting project evidence is resolved.',
      priority: 'high',
      confidence: 'medium',
      evidence: context.graphContradictions.map(item => item.summary),
      suggestedVerification: 'Resolve the contradictory evidence before relying on affected recommendations.',
    }));
  }

  if (context.beliefs.some(belief => belief.status === 'contested')) {
    const contested = context.beliefs.filter(belief => belief.status === 'contested');
    risks.push(reflectionRisk({
      id: 'contested-runtime-beliefs',
      context,
      title: 'Runtime beliefs are contested',
      risk: `${contested.length} belief${contested.length === 1 ? '' : 's'} include contradicting evidence.`,
      impact:
        'PIE should explain uncertainty before presenting these beliefs as reliable.',
      priority: 'high',
      confidence: 'high',
      evidence: contested.map(belief => belief.statement),
      suggestedVerification: 'Review contested beliefs and resolve contradicting evidence.',
    }));
  }

  if (hasStaleUpdateRisk(context) && context.recommendations.length > 0) {
    risks.push(reflectionRisk({
      id: 'stale-update-risk',
      context,
      title: 'Recommendations may rely on stale updates',
      risk: staleUpdateSummary(context),
      impact:
        'PIE should verify current field status before recommending communication or status decisions.',
      priority: 'medium',
      confidence: 'high',
      evidence: [staleUpdateSummary(context)],
      suggestedVerification: 'Capture or verify current project progress.',
    }));
  }

  return sortRisks(dedupeRisks(risks));
}

export function getReflectionPriority(
  input: ReflectionInput & {
    gaps?: PIEReflectionGap[];
    weakRecommendations?: PIEReflectionWeakRecommendation[];
    risks?: PIEReflectionRisk[];
  },
): PIEReflectionPriority {
  const result = asReflectionResult(input);
  if (result) return result.priority;

  const context = buildReflectionContext(input as BuildPIEReflectionParams);
  const gaps = input.gaps ?? findReflectionGaps(context);
  const weakRecommendations =
    input.weakRecommendations ?? findWeakRecommendations(context);
  const risks = input.risks ?? getReflectionRisks(context);
  const priorities = [
    ...gaps.map(gap => gap.priority),
    ...weakRecommendations.map(recommendation => recommendation.priority),
    ...risks.map(risk => risk.priority),
  ];

  if (priorities.includes('critical')) return 'critical';
  if (priorities.includes('high')) return 'high';
  if (priorities.includes('medium')) return 'medium';

  return 'low';
}

function buildReflectionContext(params: BuildPIEReflectionParams): ReflectionContext {
  const runtime = params.runtime ?? null;
  const runtimeResponse = params.runtimeResponse ?? runtime?.response ?? null;
  const executiveBrief =
    params.executiveBrief ?? runtime?.pieExecutiveBrief ?? null;
  const decisionQueue =
    params.decisionQueue ?? runtime?.decisionQueue ?? null;
  const reasoning = params.reasoning ?? runtime?.reasoning ?? null;
  const memory = params.memory ?? runtime?.memory ?? null;
  const knowledgeGraph =
    params.knowledgeGraph ?? runtime?.knowledgeGraph ?? null;
  const projectEvents =
    params.projectEvents ?? runtime?.projectEvents ?? [];
  const intelligence =
    params.intelligence ?? runtime?.intelligence ?? null;
  const generatedAt =
    runtime?.generatedAt ||
    runtimeResponse?.generatedAt ||
    executiveBrief?.generatedAt ||
    decisionQueue?.generatedAt ||
    reasoning?.generatedAt ||
    memory?.generatedAt ||
    knowledgeGraph?.generatedAt ||
    intelligence?.generatedAt ||
    projectEvents[0]?.occurredAt ||
    (params.now ?? new Date()).toISOString();
  const projectName =
    runtime?.projectName ||
    runtimeResponse?.projectName ||
    decisionQueue?.projectName ||
    reasoning?.projectName ||
    memory?.projectName ||
    knowledgeGraph?.projectName ||
    intelligence?.projectName ||
    projectEvents[0]?.projectName ||
    'Unassigned Project';
  const recommendations = collectRecommendations({
    projectName,
    runtime,
    runtimeResponse,
    executiveBrief,
    decisionQueue,
    reasoning,
    intelligence,
  });
  const beliefs = runtime?.currentBeliefs ??
    runtimeResponse?.currentBeliefs ??
    [];
  const questions = [
    ...(reasoning?.questions ?? []),
    ...(runtime?.reasoning.questions ?? []),
  ];
  const memoryGaps = [
    ...(memory?.gaps ?? []),
    ...(runtime?.memory.gaps ?? []),
  ];
  const graphGaps = [
    ...(knowledgeGraph?.gaps ?? []),
    ...(runtime?.graphGaps ?? []),
    ...(runtimeResponse?.graphGaps ?? []),
  ];
  const graphContradictions = [
    ...(knowledgeGraph?.relationships.filter(
      relationship => relationship.edgeType === 'contradicts',
    ) ?? []),
    ...(runtime?.knowledgeGraph.relationships.filter(
      relationship => relationship.edgeType === 'contradicts',
    ) ?? []),
  ];

  return {
    projectName,
    generatedAt,
    runtime,
    runtimeResponse,
    executiveBrief,
    decisionQueue,
    reasoning,
    memory,
    knowledgeGraph,
    projectEvents,
    intelligence,
    recommendations: dedupeReflectionRecommendations(recommendations),
    beliefs: dedupeBeliefs(beliefs),
    questions: dedupeReasoningQuestions(questions),
    memoryGaps: dedupeMemoryGaps(memoryGaps),
    graphGaps: dedupeGraphGaps(graphGaps),
    graphContradictions: dedupeRelationships(graphContradictions),
  };
}

function collectRecommendations({
  projectName,
  runtime,
  runtimeResponse,
  executiveBrief,
  decisionQueue,
  reasoning,
  intelligence,
}: {
  projectName: string;
  runtime: PIERuntimeState | null;
  runtimeResponse: PIERuntimeResponse | null;
  executiveBrief: PIEExecutiveBrief | null;
  decisionQueue: PIEDecisionQueue | null;
  reasoning: PIEReasoningResult | null;
  intelligence: ProjectIntelligenceSummary | null;
}): ReflectionRecommendation[] {
  return [
    ...(runtime?.recommendations ?? []).map(runtimeRecommendationToReflection),
    ...(runtimeResponse?.recommendations ?? []).map(runtimeRecommendationToReflection),
    ...(executiveBrief?.recommendations ?? []).map(recommendation => ({
      id: recommendation.id,
      projectName: recommendation.projectName,
      title: recommendation.recommendation,
      summary: recommendation.why,
      evidence: recommendation.evidence,
      confidence: recommendation.confidence,
      priority: recommendation.urgency,
      source: 'pie-executive' as const,
      userApprovalRequired: recommendation.userApprovalRequired,
      suggestedAction: recommendation.recommendation,
    })),
    ...(decisionQueue?.decisions ?? []).map(decisionToReflectionRecommendation),
    ...(reasoning?.recommendations ?? []).map(reasoningRecommendationToReflection),
    ...(intelligence?.recommendations ?? []).map(recommendation => ({
      id: `intelligence-${recommendation.id}`,
      projectName,
      title: recommendation.title,
      summary: recommendation.reason,
      evidence: [recommendation.reason],
      confidence: recommendation.confidence,
      priority: recommendation.priority,
      source: 'project-intelligence' as const,
      userApprovalRequired: true,
      suggestedAction: recommendation.title,
    })),
  ];
}

function runtimeRecommendationToReflection(
  recommendation: PIERecommendation,
): ReflectionRecommendation {
  return {
    id: recommendation.id,
    projectName: recommendation.projectName,
    title: recommendation.title,
    summary: recommendation.summary,
    evidence: recommendation.evidence,
    confidence: recommendation.confidence,
    priority: recommendation.priority,
    source: 'pie-runtime',
    userApprovalRequired: recommendation.requiresApproval,
    suggestedAction: recommendation.suggestedNextAction,
  };
}

function decisionToReflectionRecommendation(
  decision: PIEDecision,
): ReflectionRecommendation {
  return {
    id: decision.id,
    projectName: decision.projectName,
    title: decision.title,
    summary: decision.summary,
    evidence: decision.evidence,
    confidence: decision.confidence,
    priority: decision.priority,
    source: 'pie-decision',
    userApprovalRequired: decision.userApproval.required,
    suggestedAction: decision.suggestedNextAction,
  };
}

function reasoningRecommendationToReflection(
  recommendation: PIEThoughtRecommendation,
): ReflectionRecommendation {
  return {
    id: recommendation.id,
    projectName: recommendation.projectName,
    title: recommendation.title,
    summary: recommendation.why,
    evidence: recommendation.evidence,
    confidence: recommendation.confidence,
    priority: recommendation.priority,
    source: 'pie-reasoning',
    userApprovalRequired: true,
    suggestedAction: recommendation.suggestedNextAction,
  };
}

function buildFindings({
  context,
  gaps,
  weakRecommendations,
  risks,
  confidenceAudit,
  evidenceAudit,
}: {
  context: ReflectionContext;
  gaps: PIEReflectionGap[];
  weakRecommendations: PIEReflectionWeakRecommendation[];
  risks: PIEReflectionRisk[];
  confidenceAudit: PIEReflectionConfidenceAudit;
  evidenceAudit: PIEReflectionEvidenceAudit;
}): PIEReflectionFinding[] {
  const findings: Array<PIEReflectionFinding | null> = [
    ...weakRecommendations.slice(0, 5).map(recommendation => ({
      id: `finding-${recommendation.id}`,
      projectName: recommendation.projectName,
      title: 'Weak recommendation needs review',
      summary: `${recommendation.title}: ${recommendation.weakness.join(' ')}`,
      priority: recommendation.priority,
      confidence: recommendation.confidence,
      source: 'pie-reflection' as const,
      evidence: recommendation.weakness,
      suggestedAction: recommendation.suggestedAction,
      createdAt: context.generatedAt,
    })),
    ...gaps.slice(0, 5).map(gap => ({
      id: `finding-${gap.id}`,
      projectName: gap.projectName,
      title: gap.title,
      summary: gap.summary,
      priority: gap.priority,
      confidence: gap.confidence,
      source: 'pie-reflection' as const,
      evidence: gap.evidence,
      suggestedAction: gap.suggestedAction,
      createdAt: context.generatedAt,
    })),
    ...risks.slice(0, 5).map(risk => ({
      id: `finding-${risk.id}`,
      projectName: risk.projectName,
      title: risk.title,
      summary: risk.risk,
      priority: risk.priority,
      confidence: risk.confidence,
      source: 'pie-reflection' as const,
      evidence: risk.evidence,
      suggestedAction: risk.suggestedVerification,
      createdAt: context.generatedAt,
    })),
    confidenceAudit.suggestedAdjustments[0]
      ? {
          id: 'finding-confidence-adjustment',
          projectName: context.projectName,
          title: 'Confidence should be reduced',
          summary: confidenceAudit.suggestedAdjustments[0].reason,
          priority: 'high' as const,
          confidence: 'high' as const,
          source: 'pie-reflection' as const,
          evidence: confidenceAudit.suggestedAdjustments[0].evidence,
          suggestedAction: 'Show the user what PIE is uncertain about before acting.',
          createdAt: context.generatedAt,
        }
      : null,
    evidenceAudit.contradictions[0]
      ? {
          id: 'finding-evidence-contradiction',
          projectName: context.projectName,
          title: 'Contradicting evidence needs review',
          summary: evidenceAudit.contradictions[0],
          priority: 'high' as const,
          confidence: 'medium' as const,
          source: 'pie-reflection' as const,
          evidence: evidenceAudit.contradictions,
          suggestedAction: 'Resolve contradictory evidence before relying on affected conclusions.',
          createdAt: context.generatedAt,
        }
      : null,
  ];

  return sortFindings(dedupeFindings(
    findings.filter((finding): finding is PIEReflectionFinding =>
      Boolean(finding),
    ),
  ));
}

function buildConfidenceAdjustments({
  context,
  gaps,
  weakRecommendations,
  risks,
  evidenceAudit,
}: {
  context: ReflectionContext;
  gaps: PIEReflectionGap[];
  weakRecommendations: PIEReflectionWeakRecommendation[];
  risks: PIEReflectionRisk[];
  evidenceAudit: PIEReflectionEvidenceAudit;
}): PIEReflectionConfidenceAdjustment[] {
  return dedupeConfidenceAdjustments([
    ...(context.runtime && (
      context.runtime.overallConfidence === 'high' &&
      (evidenceAudit.level === 'low' || weakRecommendations.length > 0)
    )
      ? [{
          id: 'confidence-runtime-high-with-weak-evidence',
          targetId: context.runtime.id,
          targetType: 'runtime' as const,
          currentConfidence: context.runtime.overallConfidence,
          suggestedConfidence: evidenceAudit.level,
          reason:
            'Runtime confidence is high, but Reflection found weak evidence support or weak recommendations.',
          evidence: uniqueText([
            evidenceAudit.summary,
            weakRecommendations[0]?.title,
          ]),
        }]
      : []),
    ...context.beliefs
      .filter(belief =>
        belief.confidence !== 'low' &&
        (belief.status === 'contested' || belief.supportingEvidence.length === 0),
      )
      .map(belief => ({
        id: `confidence-belief-${belief.id}`,
        targetId: belief.id,
        targetType: 'belief' as const,
        currentConfidence: belief.confidence,
        suggestedConfidence: belief.status === 'contested' ? 'low' as const : 'medium' as const,
        reason: `Belief status is ${belief.status}.`,
        evidence: uniqueText([
          belief.statement,
          ...belief.contradictingEvidence.map(item => item.detail),
        ]),
      })),
    ...weakRecommendations
      .filter(recommendation => recommendation.confidence !== 'low')
      .map(recommendation => ({
        id: `confidence-recommendation-${recommendation.recommendationId}`,
        targetId: recommendation.recommendationId,
        targetType: 'recommendation' as const,
        currentConfidence: recommendation.confidence,
        suggestedConfidence:
          recommendation.evidenceCount === 0 ? 'low' as const : 'medium' as const,
        reason: recommendation.weakness.join(' '),
        evidence: recommendation.weakness,
      })),
    ...risks
      .filter(risk => risk.priority === 'critical')
      .map(risk => ({
        id: `confidence-risk-${risk.id}`,
        targetId: risk.id,
        targetType: 'project-intelligence' as const,
        currentConfidence: risk.confidence,
        suggestedConfidence: lowerConfidence(risk.confidence),
        reason: risk.impact,
        evidence: risk.evidence,
      })),
    ...gaps
      .filter(gap => gap.priority === 'high' || gap.priority === 'critical')
      .slice(0, 3)
      .map(gap => ({
        id: `confidence-gap-${gap.id}`,
        targetId: gap.id,
        targetType: 'project-intelligence' as const,
        currentConfidence: gap.confidence,
        suggestedConfidence: 'medium' as const,
        reason: gap.impact,
        evidence: gap.evidence,
      })),
  ]);
}

function collectEvidence(context: ReflectionContext) {
  return [
    ...context.beliefs.flatMap(belief => [
      ...belief.supportingEvidence.map(item => ({
        id: item.id,
        detail: item.detail,
        confidence: item.confidence,
        occurredAt: item.occurredAt,
        isStale: isStale(item.occurredAt, context.generatedAt),
      })),
      ...belief.contradictingEvidence.map(item => ({
        id: item.id,
        detail: item.detail,
        confidence: item.confidence,
        occurredAt: item.occurredAt,
        isStale: isStale(item.occurredAt, context.generatedAt),
      })),
    ]),
    ...(context.reasoning?.evidence.map(item => ({
      id: item.id,
      detail: item.detail,
      confidence: item.confidence,
      occurredAt: item.occurredAt,
      isStale: isStale(item.occurredAt, context.generatedAt),
    })) ?? []),
    ...(context.projectEvents.map(event => ({
      id: event.id,
      detail: event.description,
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      isStale: isStale(event.occurredAt, context.generatedAt),
    }))),
    ...(context.knowledgeGraph?.nodes.map(node => ({
      id: node.id,
      detail: node.summary,
      confidence: node.confidence,
      occurredAt: node.occurredAt,
      isStale: isStale(node.occurredAt, context.generatedAt),
    })) ?? []),
    ...(context.intelligence?.riskSignals.flatMap(risk =>
      risk.evidence.map((detail, index) => ({
        id: `${risk.id}-${index}`,
        detail,
        confidence: risk.confidence,
        occurredAt: context.intelligence?.generatedAt ?? null,
        isStale: false,
      })),
    ) ?? []),
  ].filter(item => item.detail.trim().length > 0);
}

function reflectionGap(input: Omit<PIEReflectionGap, 'projectName' | 'relatedRecommendationIds'> & {
  context: ReflectionContext;
}): PIEReflectionGap {
  const relatedRecommendationIds = input.context.recommendations
    .filter(recommendation =>
      textContains(
        recommendationText(recommendation),
        [input.missingEvidenceType, input.title, input.summary],
      ),
    )
    .map(recommendation => recommendation.id);

  return {
    id: `reflection-gap-${slug(input.id)}`,
    projectName: input.context.projectName,
    title: input.title,
    summary: input.summary,
    missingEvidenceType: input.missingEvidenceType,
    impact: input.impact,
    priority: input.priority,
    confidence: input.confidence,
    evidence: uniqueText(input.evidence),
    relatedRecommendationIds,
    suggestedAction: input.suggestedAction,
    createdAt: input.createdAt,
  };
}

function reflectionRisk(input: Omit<PIEReflectionRisk, 'projectName' | 'createdAt'> & {
  context: ReflectionContext;
}): PIEReflectionRisk {
  return {
    id: `reflection-risk-${slug(input.id)}`,
    projectName: input.context.projectName,
    title: input.title,
    risk: input.risk,
    impact: input.impact,
    priority: input.priority,
    confidence: input.confidence,
    evidence: uniqueText(input.evidence),
    suggestedVerification: input.suggestedVerification,
    createdAt: input.context.generatedAt,
  };
}

function hasStaleUpdateRisk(context: ReflectionContext) {
  const days = context.intelligence?.metrics.daysSinceLastUpdate;
  if (days === null || days === undefined) {
    return (context.memory?.sourceCounts.updates ?? 0) === 0;
  }

  return days > 7;
}

function staleUpdateSummary(context: ReflectionContext) {
  const days = context.intelligence?.metrics.daysSinceLastUpdate;
  if (days === null || days === undefined) {
    return 'PIE does not see a saved project update.';
  }

  return `Last saved update is ${days} day${days === 1 ? '' : 's'} old.`;
}

function hasPhotoEvidence(context: ReflectionContext) {
  return Boolean(
    (context.intelligence?.photoCount ?? 0) > 0 ||
    (context.memory?.sourceCounts.photos ?? 0) > 0 ||
    (context.knowledgeGraph?.sourceCounts.photo ?? 0) > 0 ||
    context.knowledgeGraph?.nodes.some(node => node.type === 'photo'),
  );
}

function hasScheduleEvidence(context: ReflectionContext) {
  return Boolean(
    (context.intelligence?.metrics.scheduleItemCount ?? 0) > 0 ||
    (context.memory?.sourceCounts.scheduleItems ?? 0) > 0 ||
    (context.knowledgeGraph?.sourceCounts.schedule_item ?? 0) > 0 ||
    context.knowledgeGraph?.nodes.some(node => node.type === 'schedule_item'),
  );
}

function hasInspectionEvidence(context: ReflectionContext) {
  return Boolean(
    context.projectEvents.some(event => event.eventType === 'inspection_event') ||
    context.knowledgeGraph?.nodes.some(node => node.type === 'inspection') ||
    matchingContextEvidence(context, ['inspection passed', 'inspection failed', 'inspection complete', 'inspection scheduled']).length > 0,
  );
}

function needsInspectionStatus(context: ReflectionContext) {
  const text = contextText(context);
  const inspectionMentioned = textContains(text, [
    'inspection',
    'inspect',
    'approved',
    'passed',
    'failed',
  ]);

  return inspectionMentioned && !hasInspectionEvidence(context);
}

function matchingContextEvidence(context: ReflectionContext, terms: string[]) {
  const normalizedTerms = terms.map(term => term.toLowerCase());
  return uniqueText([
    ...(context.reasoning?.evidence.map(item => item.detail) ?? []),
    ...context.projectEvents.map(event => event.description),
    ...(context.knowledgeGraph?.relationships.map(item => item.summary) ?? []),
    ...(context.intelligence?.riskSignals.flatMap(risk => risk.evidence) ?? []),
    ...context.recommendations.flatMap(recommendation => recommendation.evidence),
  ].filter(item =>
    normalizedTerms.some(term => item.toLowerCase().includes(term)),
  ));
}

function graphGapType(gap: PIEGraphGap): PIEReflectionGap['missingEvidenceType'] {
  if (gap.missingNodeType === 'photo') return 'photo';
  if (gap.missingNodeType === 'schedule_item') return 'schedule';
  if (gap.missingNodeType === 'inspection') return 'inspection';
  if (gap.missingNodeType === 'document') return 'document';

  return 'relationship';
}

function memoryGapType(gap: PIEMemoryGap): PIEReflectionGap['missingEvidenceType'] {
  const text = `${gap.title} ${gap.summary} ${gap.suggestedAction}`.toLowerCase();
  if (textContains(text, ['photo'])) return 'photo';
  if (textContains(text, ['schedule'])) return 'schedule';
  if (textContains(text, ['inspection'])) return 'inspection';
  if (textContains(text, ['document'])) return 'document';
  if (textContains(text, ['update', 'recent'])) return 'update';

  return 'unknown';
}

function questionForGap(gap: PIEReflectionGap) {
  switch (gap.missingEvidenceType) {
    case 'photo':
      return 'Do we have current photos that confirm this project status?';
    case 'schedule':
      return 'Is the current schedule imported or updated?';
    case 'inspection':
      return 'What is the current inspection status?';
    case 'document':
      return 'Which document or specification supports this conclusion?';
    case 'update':
      return 'What changed since the last saved update?';
    case 'owner':
      return 'Who owns this open item?';
    case 'relationship':
      return 'What project record connects this recommendation to evidence?';
    case 'confidence':
      return 'What evidence would raise PIE confidence?';
    case 'unknown':
    default:
      return gap.suggestedAction;
  }
}

function reflectionScore({
  confidenceAudit,
  evidenceAudit,
  gaps,
  weakRecommendations,
  risks,
}: {
  confidenceAudit: PIEReflectionConfidenceAudit;
  evidenceAudit: PIEReflectionEvidenceAudit;
  gaps: PIEReflectionGap[];
  weakRecommendations: PIEReflectionWeakRecommendation[];
  risks: PIEReflectionRisk[];
}) {
  return clamp(
    Math.round(
      confidenceAudit.score * 0.35 +
      evidenceAudit.score * 0.35 +
      (100 - Math.min(100, gaps.length * 10)) * 0.1 +
      (100 - Math.min(100, weakRecommendations.length * 15)) * 0.1 +
      (100 - Math.min(100, risks.length * 18)) * 0.1,
    ),
    0,
    100,
  );
}

function reflectionSummary({
  context,
  reflectionLevel,
  gaps,
  weakRecommendations,
  risks,
}: {
  context: ReflectionContext;
  reflectionLevel: ProjectConfidenceLevel;
  gaps: PIEReflectionGap[];
  weakRecommendations: PIEReflectionWeakRecommendation[];
  risks: PIEReflectionRisk[];
}) {
  if (gaps.length === 0 && weakRecommendations.length === 0 && risks.length === 0) {
    return `PIE Reflection found ${reflectionLevel} self-audit confidence for ${context.projectName}. No major weak recommendation or missing evidence signal is visible.`;
  }

  return `PIE Reflection found ${weakRecommendations.length} weak recommendation${weakRecommendations.length === 1 ? '' : 's'}, ${gaps.length} evidence gap${gaps.length === 1 ? '' : 's'}, and ${risks.length} reflection risk${risks.length === 1 ? '' : 's'} for ${context.projectName}.`;
}

function userFacingExplanation({
  reflectionLevel,
  weakRecommendations,
  gaps,
  whatPIEShouldVerifyFirst,
}: {
  reflectionLevel: ProjectConfidenceLevel;
  weakRecommendations: PIEReflectionWeakRecommendation[];
  gaps: PIEReflectionGap[];
  whatPIEShouldVerifyFirst: string;
}) {
  if (reflectionLevel === 'high') {
    return `PIE's current thinking appears well supported. First verification: ${whatPIEShouldVerifyFirst}`;
  }

  if (weakRecommendations.length > 0) {
    return `PIE sees a recommendation that needs stronger support before acting. First verification: ${whatPIEShouldVerifyFirst}`;
  }

  if (gaps.length > 0) {
    return `PIE is missing evidence that would improve confidence. First verification: ${whatPIEShouldVerifyFirst}`;
  }

  return `PIE should keep confidence moderate until more evidence is available. First verification: ${whatPIEShouldVerifyFirst}`;
}

function strongestBelief(beliefs: PIEBelief[]): PIEBelief | null {
  return [...beliefs].sort((first, second) =>
    beliefScore(second) - beliefScore(first),
  )[0] ?? null;
}

function weakestBelief(beliefs: PIEBelief[]): PIEBelief | null {
  return [...beliefs].sort((first, second) =>
    beliefScore(first) - beliefScore(second),
  )[0] ?? null;
}

function beliefScore(belief: PIEBelief) {
  return scoreForConfidence(belief.confidence) +
    belief.supportingEvidence.length * 8 -
    belief.contradictingEvidence.length * 22 -
    belief.remainingUncertainty.length * 8;
}

function recommendationText(recommendation: ReflectionRecommendation) {
  return `${recommendation.title} ${recommendation.summary} ${recommendation.suggestedAction} ${recommendation.evidence.join(' ')}`.toLowerCase();
}

function contextText(context: ReflectionContext) {
  return [
    context.runtimeResponse?.whatPIEKnows,
    context.runtimeResponse?.whatChanged,
    context.runtimeResponse?.whatConcernsPIE,
    context.runtimeResponse?.whatPIERecommends,
    context.executiveBrief?.executiveSummary,
    ...(context.recommendations.map(recommendation => recommendationText(recommendation))),
    ...(context.reasoning?.evidence.map(item => `${item.title} ${item.detail}`) ?? []),
    ...context.projectEvents.map(event => `${event.title} ${event.description}`),
    ...(context.knowledgeGraph?.relationships.map(item => item.summary) ?? []),
  ].join(' ').toLowerCase();
}

function asReflectionResult(input: ReflectionInput): PIEReflectionResult | null {
  return isReflectionResult(input) ? input : null;
}

function isReflectionResult(input: ReflectionInput): input is PIEReflectionResult {
  return Boolean(
    input &&
      typeof input === 'object' &&
      'overallReflectionScore' in input &&
      'confidenceAudit' in input &&
      'evidenceAudit' in input,
  );
}

function reflectionSources(context: ReflectionContext): PIEReflectionSource[] {
  return uniqueText([
    context.runtime ? 'pie-runtime' : null,
    context.runtimeResponse ? 'pie-runtime-response' : null,
    context.executiveBrief ? 'pie-executive' : null,
    context.decisionQueue ? 'pie-decision' : null,
    context.reasoning ? 'pie-reasoning' : null,
    context.memory ? 'pie-memory' : null,
    context.knowledgeGraph ? 'pie-knowledge-graph' : null,
    context.projectEvents.length > 0 ? 'project-event' : null,
    context.intelligence ? 'project-intelligence' : null,
    'pie-reflection',
  ]) as PIEReflectionSource[];
}

function dedupeReflectionRecommendations(
  recommendations: ReflectionRecommendation[],
): ReflectionRecommendation[] {
  const byKey = new Map<string, ReflectionRecommendation>();
  recommendations.forEach(recommendation => {
    const key = normalizedKey(`${recommendation.title} ${recommendation.suggestedAction}`);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...recommendation,
        evidence: uniqueText(recommendation.evidence),
      });
      return;
    }

    byKey.set(key, {
      ...existing,
      evidence: uniqueText([...existing.evidence, ...recommendation.evidence]),
      confidence: lowerConfidence(existing.confidence, recommendation.confidence),
      priority: higherPriority(existing.priority, recommendation.priority),
      userApprovalRequired:
        existing.userApprovalRequired || recommendation.userApprovalRequired,
    });
  });

  return Array.from(byKey.values());
}

function dedupeBeliefs(beliefs: PIEBelief[]): PIEBelief[] {
  return uniqueBy(beliefs, belief => belief.id);
}

function dedupeReasoningQuestions(questions: PIEQuestion[]): PIEQuestion[] {
  return uniqueBy(questions, question => question.id);
}

function dedupeMemoryGaps(gaps: PIEMemoryGap[]): PIEMemoryGap[] {
  return uniqueBy(gaps, gap => gap.id);
}

function dedupeGraphGaps(gaps: PIEGraphGap[]): PIEGraphGap[] {
  return uniqueBy(gaps, gap => gap.id);
}

function dedupeRelationships(
  relationships: PIEGraphRelationship[],
): PIEGraphRelationship[] {
  return uniqueBy(relationships, relationship => relationship.id);
}

function dedupeWeakRecommendations(
  recommendations: PIEReflectionWeakRecommendation[],
): PIEReflectionWeakRecommendation[] {
  return uniqueBy(recommendations, recommendation => recommendation.id);
}

function dedupeGaps(gaps: PIEReflectionGap[]): PIEReflectionGap[] {
  return uniqueBy(gaps, gap => gap.id);
}

function dedupeRisks(risks: PIEReflectionRisk[]): PIEReflectionRisk[] {
  return uniqueBy(risks, risk => risk.id);
}

function dedupeQuestions(
  questions: PIEReflectionVerificationQuestion[],
): PIEReflectionVerificationQuestion[] {
  return uniqueBy(questions, question => normalizedKey(question.question));
}

function dedupeFindings(findings: PIEReflectionFinding[]): PIEReflectionFinding[] {
  return uniqueBy(findings, finding => finding.id);
}

function dedupeConfidenceAdjustments(
  adjustments: PIEReflectionConfidenceAdjustment[],
): PIEReflectionConfidenceAdjustment[] {
  return uniqueBy(adjustments, adjustment => adjustment.id);
}

function sortWeakRecommendations(
  recommendations: PIEReflectionWeakRecommendation[],
): PIEReflectionWeakRecommendation[] {
  return [...recommendations].sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority) ||
    first.evidenceCount - second.evidenceCount,
  );
}

function sortGaps(gaps: PIEReflectionGap[]): PIEReflectionGap[] {
  return [...gaps].sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function sortRisks(risks: PIEReflectionRisk[]): PIEReflectionRisk[] {
  return [...risks].sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function sortQuestions(
  questions: PIEReflectionVerificationQuestion[],
): PIEReflectionVerificationQuestion[] {
  return [...questions].sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function sortFindings(findings: PIEReflectionFinding[]): PIEReflectionFinding[] {
  return [...findings].sort((first, second) =>
    priorityRank(second.priority) - priorityRank(first.priority),
  );
}

function isStale(occurredAt: string | null, generatedAt: string) {
  if (!occurredAt) return false;

  return daysBetween(occurredAt, generatedAt) > 14;
}

function daysBetween(start: string, end: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;

  return Math.abs(endTime - startTime) / (1000 * 60 * 60 * 24);
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';

  return 'low';
}

function scoreForConfidence(confidence: ProjectConfidenceLevel): number {
  if (confidence === 'high') return 90;
  if (confidence === 'medium') return 65;

  return 35;
}

function lowerConfidence(
  first: ProjectConfidenceLevel,
  second?: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  if (!second) {
    if (first === 'high') return 'medium';
    if (first === 'medium') return 'low';
    return 'low';
  }

  return confidenceRank(second) < confidenceRank(first) ? second : first;
}

function confidenceRank(confidence: ProjectConfidenceLevel) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;

  return 1;
}

function higherPriority(
  first: PIEReflectionPriority,
  second: PIEReflectionPriority,
): PIEReflectionPriority {
  return priorityRank(second) > priorityRank(first) ? second : first;
}

function priorityRank(priority: PIEDecisionPriority | PIEReflectionPriority) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;

  return 1;
}

function textContains(value: string, candidates: string[]) {
  const normalized = value.toLowerCase();

  return candidates.some(candidate => normalized.includes(candidate.toLowerCase()));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function uniqueBy<T>(items: T[], keyForItem: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  items.forEach(item => {
    const key = keyForItem(item);
    if (seen.has(key)) return;

    seen.add(key);
    result.push(item);
  });

  return result;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
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
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function slug(value: string) {
  return normalizedKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
