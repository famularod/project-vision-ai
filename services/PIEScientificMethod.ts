import type {
  PIEDeliberationResult,
  PIEDeliberationReadiness,
} from './PIEDeliberationEngine';
import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';
import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEPatternIntelligence } from './PIEPatternEngine';
import type { PIEPredictionResult } from './PIEPredictiveEngine';
import type { PIELessonLearned } from './PIEReflectionEngine';
import type { PIERuntimeState } from './PIERuntime';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEScientificQuestion = {
  id: string;
  question: string;
  whyItMatters: string;
};

export type PIEScientificObservation = {
  id: string;
  observation: string;
  source: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificEvidence = {
  id: string;
  summary: string;
  supports: string[];
  contradicts: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificInterpretation = {
  id: string;
  interpretation: string;
  evidenceIds: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificMemoryRecall = {
  summary: string;
  similarSituationIds: string[];
  patternMatchIds: string[];
  lessons: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificHypothesis = {
  id: string;
  statement: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  readiness: PIEDeliberationReadiness;
  confidence: ProjectConfidenceLevel;
  testNeeded: string;
};

export type PIEScientificChallenge = {
  id: string;
  hypothesisId: string;
  whatCouldMakePIEWrong: string;
  contradictingEvidence: string[];
  weakestAssumption: string;
  whatShouldBeVerifiedFirst: string;
};

export type PIEScientificAlternative = {
  id: string;
  action: string;
  expectedBenefit: string;
  risk: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificPrediction = {
  id: string;
  ifActionTaken: string;
  expectedOutcome: string;
  downsideRisk: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificDecision = {
  id: string;
  selectedAction: string;
  reason: string;
  readiness: PIEDeliberationReadiness;
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificExplanation = {
  summary: string;
  evidenceTrace: string[];
  uncertainty: string[];
  whatWouldChangeThis: string[];
};

export type PIEScientificOutcomeMonitor = {
  monitorFor: string[];
  expectedSignal: string;
  reviewTiming: string;
};

export type PIEScientificReflection = {
  reflectionPrompt: string;
  outcomeQuestions: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEScientificLearning = {
  lessonCandidates: string[];
  futureAdjustment: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEUncertainty = {
  id: string;
  uncertainty: string;
  whyItMatters: string;
  severity: 'low' | 'medium' | 'high';
};

export type PIEUncertaintyReductionAction = {
  id: string;
  action: string;
  reducesUncertainty: string;
  recommendedNextEvidence: string;
};

export type PIEDecisionOutcome = {
  id: string;
  decision: string;
  expectedOutcome: string;
  actualOutcome?: string | null;
  qualitySignal: 'unknown' | 'worked' | 'partially_worked' | 'failed';
};

export type PIEDecisionQualityScore = {
  evidenceTraceability: number;
  hypothesisStrength: number;
  selfChallengeStrength: number;
  uncertaintyReduction: number;
  explanationClarity: number;
  total: number;
  readiness: PIEDeliberationReadiness;
};

export type PIEScientificResult = {
  question: PIEScientificQuestion;
  observations: PIEScientificObservation[];
  evidence: PIEScientificEvidence[];
  interpretations: PIEScientificInterpretation[];
  recalledMemory: PIEScientificMemoryRecall;
  hypotheses: PIEScientificHypothesis[];
  beliefCandidateHypotheses: PIEScientificHypothesis[];
  challenges: PIEScientificChallenge[];
  alternatives: PIEScientificAlternative[];
  predictions: PIEScientificPrediction[];
  selectedDecision: PIEScientificDecision;
  explanation: PIEScientificExplanation;
  outcomeMonitor: PIEScientificOutcomeMonitor;
  reflection: PIEScientificReflection;
  learning: PIEScientificLearning;
  uncertainty: PIEUncertainty[];
  primaryUncertainty: PIEUncertainty | null;
  uncertaintyReductionActions: PIEUncertaintyReductionAction[];
  confidence: ProjectConfidenceLevel;
  readiness: PIEDeliberationReadiness;
  recommendedNextEvidence: string[];
  decisionQualitySignals: PIEDecisionQualityScore;
};

export type PIEScientificMethodInput = {
  runtime: PIERuntimeState;
  memoryRecall?: PIEMemoryRecallResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  predictiveResult?: PIEPredictionResult | null;
  deliberation?: PIEDeliberationResult | null;
  reflectionLessons?: PIELessonLearned[];
  evidenceQuality?: PIEEvidenceQualityResult | null;
  decisionOutcomes?: PIEDecisionOutcome[];
};

export function runPIEScientificMethod(
  input: PIEScientificMethodInput,
): PIEScientificResult {
  const question = buildQuestion(input);
  const observations = buildObservations(input);
  const evidence = buildEvidence(input, observations);
  const interpretations = buildInterpretations(evidence, input);
  const recalledMemory = buildScientificMemoryRecall(input);
  const hypotheses = generateHypotheses(input, evidence);
  const challenges = challengeHypotheses(input, hypotheses);
  const alternatives = buildScientificAlternatives(input);
  const predictions = predictOutcomes(input, alternatives);
  const uncertainty = buildUncertainty(input, challenges);
  const uncertaintyReductionActions = buildUncertaintyReductionActions(uncertainty, input);
  const selectedDecision = selectBestDecision(input, hypotheses, alternatives);
  const explanation = buildExplanation(input, selectedDecision, evidence, uncertainty);
  const outcomeMonitor = buildOutcomeMonitor(selectedDecision, uncertaintyReductionActions);
  const reflection = buildScientificReflection(input, selectedDecision);
  const learning = buildScientificLearning(input, reflection);
  const decisionQualitySignals = scoreDecisionQuality({
    evidence,
    hypotheses,
    challenges,
    uncertaintyReductionActions,
    explanation,
    readiness: selectedDecision.readiness,
  });

  return {
    question,
    observations,
    evidence,
    interpretations,
    recalledMemory,
    hypotheses,
    beliefCandidateHypotheses: hypotheses.filter(hypothesis =>
      hypothesis.supportingEvidence.length > 0 ||
      hypothesis.contradictingEvidence.length > 0,
    ),
    challenges,
    alternatives,
    predictions,
    selectedDecision,
    explanation,
    outcomeMonitor,
    reflection,
    learning,
    uncertainty,
    primaryUncertainty: uncertainty[0] || null,
    uncertaintyReductionActions,
    confidence: selectedDecision.confidence,
    readiness: selectedDecision.readiness,
    recommendedNextEvidence: uncertaintyReductionActions.map(action => action.recommendedNextEvidence),
    decisionQualitySignals,
  };
}

function buildQuestion(input: PIEScientificMethodInput): PIEScientificQuestion {
  return {
    id: 'scientific-question',
    question: `What should PIE recommend for ${input.runtime.projectName} right now?`,
    whyItMatters: 'PIE should make important recommendations only after evidence, hypothesis, self-challenge, uncertainty, and explanation are reviewed.',
  };
}

function buildObservations(input: PIEScientificMethodInput): PIEScientificObservation[] {
  return [
    {
      id: 'observation-runtime',
      observation: input.runtime.currentUnderstanding.whatPIEKnows,
      source: 'Runtime',
      confidence: input.runtime.overallConfidence,
    },
    {
      id: 'observation-evidence-fusion',
      observation: input.runtime.evidenceFusionSummary.summary,
      source: 'Evidence Fusion',
      confidence: input.runtime.evidenceFusionSummary.confidence,
    },
    input.memoryRecall?.summaryForPIE
      ? {
          id: 'observation-memory-recall',
          observation: input.memoryRecall.summaryForPIE,
          source: 'Memory Recall',
          confidence: input.memoryRecall.confidence,
        }
      : null,
  ].filter((item): item is PIEScientificObservation => Boolean(item));
}

function buildEvidence(
  input: PIEScientificMethodInput,
  observations: PIEScientificObservation[],
): PIEScientificEvidence[] {
  return [
    ...observations.map(observation => ({
      id: `evidence-${observation.id}`,
      summary: observation.observation,
      supports: [input.runtime.nextBestAction.title],
      contradicts: [],
      confidence: observation.confidence,
    })),
    ...input.runtime.evidenceConflicts.map((conflict, index) => ({
      id: `evidence-contradiction-${index + 1}`,
      summary: conflict.summary,
      supports: [],
      contradicts: [input.runtime.nextBestAction.title],
      confidence: conflict.confidence,
    })),
    ...(input.evidenceQuality?.items.slice(0, 5).map((item, index) => ({
      id: `evidence-quality-${index + 1}`,
      summary: `${item.score.level} evidence: ${item.evidence.summary}`,
      supports:
        item.score.level === 'strong' || item.score.level === 'good'
          ? [input.runtime.nextBestAction.title]
          : [],
      contradicts:
        item.score.level === 'conflicting' ||
        item.score.level === 'stale' ||
        item.score.level === 'insufficient'
          ? [input.runtime.nextBestAction.title]
          : [],
      confidence: item.score.confidence,
    })) || []),
  ];
}

function buildInterpretations(
  evidence: PIEScientificEvidence[],
  input: PIEScientificMethodInput,
): PIEScientificInterpretation[] {
  return [
    {
      id: 'interpretation-primary',
      interpretation: input.runtime.intelligentSummary.pieRecommendation,
      evidenceIds: evidence.slice(0, 4).map(item => item.id),
      confidence: input.runtime.intelligentSummary.confidence,
    },
    ...(input.memoryRecall?.comparisons.slice(0, 2).map((comparison, index) => ({
      id: `interpretation-memory-${index + 1}`,
      interpretation: comparison.summary,
      evidenceIds: comparison.relatedMemoryIds,
      confidence: comparison.confidence,
    })) || []),
  ];
}

function buildScientificMemoryRecall(
  input: PIEScientificMethodInput,
): PIEScientificMemoryRecall {
  return {
    summary: [
      input.memoryRecall?.summaryForPIE || 'No similar prior situation was recalled.',
      input.patternIntelligence?.summary,
    ].filter(Boolean).join(' '),
    similarSituationIds: input.memoryRecall?.memories.slice(0, 6).map(memory => memory.id) || [],
    patternMatchIds: input.patternIntelligence?.patternMatches.slice(0, 6).map(match => match.id) || [],
    lessons: [
      ...(input.memoryRecall?.pastLessons.map(lesson => lesson.lesson) || []),
      ...(input.reflectionLessons || []).map(lesson => lesson.lesson),
      ...(input.patternIntelligence?.patternBasedRecommendations.map(item => item.reason) || []),
    ].slice(0, 6),
    confidence: strongestConfidence([
      input.memoryRecall?.confidence,
      input.patternIntelligence?.patternConfidence,
    ]),
  };
}

function generateHypotheses(
  input: PIEScientificMethodInput,
  evidence: PIEScientificEvidence[],
): PIEScientificHypothesis[] {
  const primary = input.deliberation?.recommendedAction || input.runtime.nextBestAction.suggestedNextAction;
  const verify = input.deliberation?.missingEvidence[0] || input.runtime.recommendedEvidence[0] || 'Capture current evidence.';
  const patternMatch = input.patternIntelligence?.patternMatches[0];
  const patternRecommendation = input.patternIntelligence?.patternBasedRecommendations[0];

  return [
    {
      id: 'hypothesis-primary',
      statement: `If PIE recommends "${primary}", the user will reduce the most important uncertainty or risk.`,
      supportingEvidence: evidence.filter(item => item.supports.length > 0).map(item => item.summary).slice(0, 5),
      contradictingEvidence: evidence.filter(item => item.contradicts.length > 0).map(item => item.summary).slice(0, 5),
      readiness: input.deliberation?.recommendationReadiness || readinessFromConfidence(input.runtime.overallConfidence),
      confidence: input.deliberation?.confidence || input.runtime.overallConfidence,
      testNeeded: verify,
    },
    {
      id: 'hypothesis-verify-first',
      statement: 'If PIE verifies the weakest assumption first, the final recommendation will be more reliable.',
      supportingEvidence: input.deliberation?.missingEvidence || input.runtime.recommendedEvidence,
      contradictingEvidence: [],
      readiness: 'Needs Verification',
      confidence: input.runtime.evidenceGaps.length > 0 ? 'high' : 'medium',
      testNeeded: verify,
    },
    patternMatch
      ? {
          id: 'hypothesis-pattern',
          statement: `If this condition matches "${patternMatch.pattern.title}", PIE should account for what happened historically before recommending action.`,
          supportingEvidence: patternMatch.pattern.evidence.map(item => item.summary).slice(0, 5),
          contradictingEvidence: patternMatch.pattern.outcome.outcome === 'unknown'
            ? ['Historical outcome is not confirmed.']
            : [],
          readiness: patternMatch.confidence === 'high' ? 'Ready' : 'Needs Verification',
          confidence: patternMatch.confidence,
          testNeeded: patternRecommendation?.recommendation || patternMatch.explanation,
        }
      : null,
  ].filter((item): item is PIEScientificHypothesis => Boolean(item));
}

function challengeHypotheses(
  input: PIEScientificMethodInput,
  hypotheses: PIEScientificHypothesis[],
): PIEScientificChallenge[] {
  return hypotheses.map((hypothesis, index) => {
    const contradiction = hypothesis.contradictingEvidence[0] ||
      input.patternIntelligence?.earlyWarnings[0]?.warning ||
      input.deliberation?.contradictions[0]?.contradiction ||
      input.runtime.evidenceConflicts[0]?.summary ||
      'No direct contradiction surfaced yet.';
    const weakestAssumption = input.deliberation?.assumptions[0]?.assumption ||
      'PIE assumes Runtime evidence is current.';
    const verifyFirst = input.deliberation?.missingEvidence[0] ||
      input.patternIntelligence?.earlyWarnings[0]?.whatToVerify ||
      hypothesis.testNeeded ||
      input.runtime.recommendedEvidence[0] ||
      'Collect current field evidence.';

    return {
      id: `challenge-${index + 1}`,
      hypothesisId: hypothesis.id,
      whatCouldMakePIEWrong: contradiction,
      contradictingEvidence: hypothesis.contradictingEvidence,
      weakestAssumption,
      whatShouldBeVerifiedFirst: verifyFirst,
    };
  });
}

function buildScientificAlternatives(
  input: PIEScientificMethodInput,
): PIEScientificAlternative[] {
  const deliberated = input.deliberation?.alternativesConsidered || [];
  if (deliberated.length > 0) {
    return deliberated.slice(0, 5).map(alternative => ({
      id: alternative.id,
      action: alternative.action,
      expectedBenefit: alternative.rationale,
      risk: alternative.risk,
      confidence: confidenceFromReadiness(alternative.score.readiness),
    }));
  }

  return input.runtime.recommendations.slice(0, 4).map(recommendation => ({
    id: recommendation.id,
    action: recommendation.suggestedNextAction,
    expectedBenefit: recommendation.impact,
    risk: recommendation.requiresApproval ? 'Requires user approval.' : 'May need verification.',
    confidence: recommendation.confidence,
  }));
}

function predictOutcomes(
  input: PIEScientificMethodInput,
  alternatives: PIEScientificAlternative[],
): PIEScientificPrediction[] {
  return [
    ...alternatives.map(alternative => ({
    id: `prediction-${alternative.id}`,
    ifActionTaken: alternative.action,
    expectedOutcome: alternative.expectedBenefit,
    downsideRisk: alternative.risk,
    confidence: alternative.confidence || input.runtime.overallConfidence,
    })),
    ...(input.predictiveResult?.predictions.slice(0, 3).map(prediction => ({
      id: `prediction-predictive-engine-${prediction.id}`,
      ifActionTaken: prediction.recoveryActions[0]?.action ||
        'Use Predictive Simulation before acting.',
      expectedOutcome: prediction.outcome.likelyOutcome,
      downsideRisk: prediction.outcome.scenario === 'no_action'
        ? prediction.outcome.scheduleImpact
        : prediction.risks[0]?.propagation || prediction.outcome.scheduleImpact,
      confidence: prediction.confidence,
    })) || []),
    ...(input.patternIntelligence?.patternMatches.slice(0, 2).map(match => ({
      id: `prediction-${match.id}`,
      ifActionTaken: match.pattern.outcome.outcome === 'failed'
        ? 'Repeat the same response without verification.'
        : 'Use the pattern as historical context.',
      expectedOutcome: match.pattern.outcome.summary,
      downsideRisk: match.pattern.timeline.trend === 'worse'
        ? 'The same warning signs may indicate worsening conditions.'
        : 'The historical pattern may not apply to the current condition.',
      confidence: match.confidence,
    })) || []),
  ];
}

function selectBestDecision(
  input: PIEScientificMethodInput,
  hypotheses: PIEScientificHypothesis[],
  alternatives: PIEScientificAlternative[],
): PIEScientificDecision {
  const readiness = input.deliberation?.recommendationReadiness || hypotheses[0]?.readiness || readinessFromConfidence(input.runtime.overallConfidence);
  return {
    id: 'selected-decision',
    selectedAction: input.deliberation?.recommendedAction || alternatives[0]?.action || input.runtime.nextBestAction.suggestedNextAction,
    reason: input.deliberation?.whyRecommended || hypotheses[0]?.statement || input.runtime.nextBestAction.why,
    readiness,
    confidence: confidenceFromReadiness(readiness),
  };
}

function buildUncertainty(
  input: PIEScientificMethodInput,
  challenges: PIEScientificChallenge[],
): PIEUncertainty[] {
  return [
    ...challenges.map((challenge, index) => ({
      id: `uncertainty-challenge-${index + 1}`,
      uncertainty: challenge.whatCouldMakePIEWrong,
      whyItMatters: challenge.weakestAssumption,
      severity: challenge.whatCouldMakePIEWrong === 'No direct contradiction surfaced yet.' ? 'low' as const : 'medium' as const,
    })),
    ...input.runtime.evidenceGaps.slice(0, 3).map((gap, index) => ({
      id: `uncertainty-gap-${index + 1}`,
      uncertainty: gap.summary,
      whyItMatters: gap.suggestedAction,
      severity: gap.severity === 'critical' ? 'high' as const : gap.severity,
    })),
  ];
}

function buildUncertaintyReductionActions(
  uncertainty: PIEUncertainty[],
  input: PIEScientificMethodInput,
): PIEUncertaintyReductionAction[] {
  return uncertainty.slice(0, 5).map((item, index) => ({
    id: `uncertainty-reduction-${index + 1}`,
    action: input.patternIntelligence?.patternBasedRecommendations[index]?.recommendation ||
      item.whyItMatters ||
      input.runtime.nextBestAction.suggestedNextAction,
    reducesUncertainty: item.uncertainty,
    recommendedNextEvidence: input.patternIntelligence?.earlyWarnings[index]?.whatToVerify ||
      input.runtime.recommendedEvidence[index] ||
      item.whyItMatters ||
      'Collect current evidence.',
  }));
}

function buildExplanation(
  input: PIEScientificMethodInput,
  decision: PIEScientificDecision,
  evidence: PIEScientificEvidence[],
  uncertainty: PIEUncertainty[],
): PIEScientificExplanation {
  return {
    summary: `${decision.selectedAction} is ${decision.readiness}. PIE selected this after reviewing evidence, hypotheses, alternatives, uncertainty, and self-challenge.`,
    evidenceTrace: evidence.slice(0, 6).map(item => item.summary),
    uncertainty: uncertainty.slice(0, 4).map(item => item.uncertainty),
    whatWouldChangeThis: input.deliberation?.whatWouldChangeRecommendation ||
      uncertainty.slice(0, 3).map(item => item.whyItMatters),
  };
}

function buildOutcomeMonitor(
  decision: PIEScientificDecision,
  reductionActions: PIEUncertaintyReductionAction[],
): PIEScientificOutcomeMonitor {
  return {
    monitorFor: [
      decision.selectedAction,
      ...reductionActions.slice(0, 3).map(action => action.reducesUncertainty),
    ],
    expectedSignal: 'New evidence should confirm whether the recommendation reduced uncertainty or changed project understanding.',
    reviewTiming: 'Review after the next accepted update, walk completion, report approval, or user correction.',
  };
}

function buildScientificReflection(
  input: PIEScientificMethodInput,
  decision: PIEScientificDecision,
): PIEScientificReflection {
  return {
    reflectionPrompt: `Did the decision "${decision.selectedAction}" improve PIE understanding or require correction?`,
    outcomeQuestions: [
      'Was PIE right or wrong?',
      'Did the user correct the recommendation?',
      'Did the recommended evidence reduce uncertainty?',
      'Should future confidence increase or decrease?',
    ],
    confidence: input.runtime.reflectionConfidence,
  };
}

function buildScientificLearning(
  input: PIEScientificMethodInput,
  reflection: PIEScientificReflection,
): PIEScientificLearning {
  return {
    lessonCandidates: [
      ...input.runtime.lessonsLearned.map(lesson => lesson.lesson),
      ...reflection.outcomeQuestions,
    ].slice(0, 8),
    futureAdjustment: 'Use outcome monitoring and user corrections to update future hypotheses, uncertainty reduction, and decision quality scoring.',
    confidence: input.runtime.reflectionConfidence,
  };
}

function scoreDecisionQuality({
  evidence,
  hypotheses,
  challenges,
  uncertaintyReductionActions,
  explanation,
  readiness,
}: {
  evidence: PIEScientificEvidence[];
  hypotheses: PIEScientificHypothesis[];
  challenges: PIEScientificChallenge[];
  uncertaintyReductionActions: PIEUncertaintyReductionAction[];
  explanation: PIEScientificExplanation;
  readiness: PIEDeliberationReadiness;
}): PIEDecisionQualityScore {
  const evidenceTraceability = clamp(evidence.length * 2);
  const hypothesisStrength = clamp(hypotheses.filter(item => item.supportingEvidence.length > 0).length * 4);
  const selfChallengeStrength = clamp(challenges.length * 3);
  const uncertaintyReduction = clamp(uncertaintyReductionActions.length * 3);
  const explanationClarity = clamp(explanation.evidenceTrace.length + explanation.whatWouldChangeThis.length);
  const total = evidenceTraceability + hypothesisStrength + selfChallengeStrength + uncertaintyReduction + explanationClarity;

  return {
    evidenceTraceability,
    hypothesisStrength,
    selfChallengeStrength,
    uncertaintyReduction,
    explanationClarity,
    total,
    readiness,
  };
}

function readinessFromConfidence(confidence: ProjectConfidenceLevel): PIEDeliberationReadiness {
  if (confidence === 'high') return 'Ready';
  if (confidence === 'medium') return 'Needs Verification';
  return 'Uncertain';
}

function confidenceFromReadiness(readiness: PIEDeliberationReadiness): ProjectConfidenceLevel {
  if (readiness === 'Ready') return 'high';
  if (readiness === 'Needs Verification') return 'medium';
  return 'low';
}

function strongestConfidence(
  values: Array<ProjectConfidenceLevel | null | undefined>,
): ProjectConfidenceLevel {
  if (values.includes('high')) return 'high';
  if (values.includes('medium')) return 'medium';
  return 'low';
}

function clamp(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}
