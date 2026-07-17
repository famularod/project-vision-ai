import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';
import type {
  PIERuntimeState,
  PIERecommendation as RuntimePIERecommendation,
} from './PIERuntime';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEDeliberationReadiness =
  | 'Ready'
  | 'Needs Verification'
  | 'Uncertain'
  | 'Blocked';

export type PIEDeliberationQuestion = {
  id: string;
  question: string;
  answer: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDeliberationAssumption = {
  id: string;
  assumption: string;
  whyItMatters: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEDeliberationAlternative = {
  id: string;
  action: string;
  rationale: string;
  supportingEvidence: string[];
  risk: string;
  score: PIEDeliberationDecisionScore;
};

export type PIEDeliberationTradeoff = {
  id: string;
  optionA: string;
  optionB: string;
  benefit: string;
  cost: string;
  preferredOption: string;
};

export type PIEDeliberationContradiction = {
  id: string;
  contradiction: string;
  evidence: string[];
  severity: 'low' | 'medium' | 'high';
};

export type PIEDeliberationUncertainty = {
  id: string;
  uncertainty: string;
  missingEvidence: string;
  impact: string;
};

export type PIEDeliberationDecisionScore = {
  evidenceStrength: number;
  urgency: number;
  riskReduction: number;
  userEffort: number;
  reversibility: number;
  total: number;
  readiness: PIEDeliberationReadiness;
};

export type PIEDeliberationHypothesisEvaluation = {
  hypothesis: string;
  supports: string[];
  contradicts: string[];
  testNeeded: string;
  readiness: PIEDeliberationReadiness;
};

export type PIEDeliberationRecommendation = {
  action: string;
  whyRecommended: string;
  whyBetterThanAlternatives: string;
  readiness: PIEDeliberationReadiness;
  confidence: ProjectConfidenceLevel;
  whatWouldChangeRecommendation: string[];
};

export type PIEDeliberationResult = {
  generatedAt: string;
  recommendedAction: string;
  decisionScore: PIEDeliberationDecisionScore;
  whyRecommended: string;
  alternativesConsidered: PIEDeliberationAlternative[];
  tradeoffs: PIEDeliberationTradeoff[];
  assumptions: PIEDeliberationAssumption[];
  missingEvidence: string[];
  contradictions: PIEDeliberationContradiction[];
  uncertainty: PIEDeliberationUncertainty[];
  hypothesisEvaluations: PIEDeliberationHypothesisEvaluation[];
  whatWouldChangeRecommendation: string[];
  recommendationReadiness: PIEDeliberationReadiness;
  confidence: ProjectConfidenceLevel;
  questions: PIEDeliberationQuestion[];
  deliberatedRecommendation: PIEDeliberationRecommendation;
  explanation: string;
};

export type PIEDeliberationInput = {
  runtime: PIERuntimeState;
  memoryRecall?: PIEMemoryRecallResult | null;
  candidateRecommendations?: RuntimePIERecommendation[];
  evidenceQuality?: PIEEvidenceQualityResult | null;
  generatedAt?: string;
};

export const PIE_DELIBERATION_QUESTIONS = [
  'What does DAVE know?',
  'What is DAVE assuming?',
  'What evidence supports this?',
  'What evidence contradicts this?',
  'What is missing?',
  'What alternatives exist?',
  'What are the trade-offs?',
  'What is the strongest recommendation?',
  'Why is this better than the alternatives?',
  "What would change DAVE's recommendation?",
] as const;

export function buildPIEDeliberation(
  input: PIEDeliberationInput,
): PIEDeliberationResult {
  const recommendations = input.candidateRecommendations?.length
    ? input.candidateRecommendations
    : input.runtime.recommendations;
  const assumptions = identifyAssumptions(input);
  const contradictions = identifyContradictions(input);
  const missingEvidence = identifyMissingEvidence(input);
  const uncertainty = buildUncertainty(input, missingEvidence);
  const hypothesisEvaluations = evaluateHypotheses(input, missingEvidence, contradictions);
  const alternatives = scoreAlternatives(
    buildAlternatives(input, recommendations),
    input,
  );
  const tradeoffs = compareTradeoffs(alternatives);
  const deliberatedRecommendation = buildDeliberatedRecommendation({
    ...input,
    assumptions,
    contradictions,
    missingEvidence,
    uncertainty,
    alternatives,
    tradeoffs,
  });

  return {
    generatedAt: input.generatedAt || input.runtime.generatedAt || new Date().toISOString(),
    recommendedAction: deliberatedRecommendation.action,
    decisionScore: alternatives[0]?.score || fallbackScore(input.runtime.overallConfidence),
    whyRecommended: deliberatedRecommendation.whyRecommended,
    alternativesConsidered: alternatives,
    tradeoffs,
    assumptions,
    missingEvidence,
    contradictions,
    uncertainty,
    hypothesisEvaluations,
    whatWouldChangeRecommendation: deliberatedRecommendation.whatWouldChangeRecommendation,
    recommendationReadiness: deliberatedRecommendation.readiness,
    confidence: deliberatedRecommendation.confidence,
    questions: buildDeliberationQuestions({
      ...input,
      assumptions,
      contradictions,
      missingEvidence,
      alternatives,
      tradeoffs,
      recommendation: deliberatedRecommendation,
    }),
    deliberatedRecommendation,
    explanation: explainDeliberation({
      recommendation: deliberatedRecommendation,
      alternatives,
      tradeoffs,
      contradictions,
      missingEvidence,
    }),
  };
}

export function evaluateHypotheses(
  input: PIEDeliberationInput,
  missingEvidence: string[] = identifyMissingEvidence(input),
  contradictions: PIEDeliberationContradiction[] = identifyContradictions(input),
): PIEDeliberationHypothesisEvaluation[] {
  const primaryAction = input.runtime.nextBestAction.suggestedNextAction;
  return [
    {
      hypothesis: `The best current action is: ${primaryAction}`,
      supports: input.runtime.nextBestAction.evidence,
      contradicts: contradictions.map(item => item.contradiction),
      testNeeded: missingEvidence[0] || 'Confirm with current field evidence.',
      readiness: readinessFromRuntime(input.runtime),
    },
    {
      hypothesis: 'Evidence should be verified before recommending action.',
      supports: missingEvidence,
      contradicts: input.runtime.nextBestAction.evidence,
      testNeeded: missingEvidence[0] || 'Review the current recommendation with the user.',
      readiness: missingEvidence.length > 0 ? 'Needs Verification' : 'Uncertain',
    },
  ];
}

export function identifyAssumptions(
  input: PIEDeliberationInput,
): PIEDeliberationAssumption[] {
  const assumptions: PIEDeliberationAssumption[] = [
    {
      id: 'assumption-runtime-current',
      assumption: 'Runtime reflects the current project state.',
      whyItMatters: 'DAVE recommendations depend on current schedule, evidence, memory, and mission state.',
      confidence: input.runtime.overallConfidence,
    },
  ];

  if (input.runtime.recommendedWalkAreas[0]) {
    assumptions.push({
      id: 'assumption-walk-area',
      assumption: `${input.runtime.recommendedWalkAreas[0]} is the best area to inspect next.`,
      whyItMatters: 'The recommendation may change if a different area has higher risk or missing evidence.',
      confidence: input.runtime.scheduleConfidence,
    });
  }

  if (input.memoryRecall?.memoryInfluences.length) {
    assumptions.push({
      id: 'assumption-memory-applies',
      assumption: 'Past similar memory applies to the current evidence.',
      whyItMatters: 'Memory can improve interpretation, but stale history can also bias recommendations.',
      confidence: input.memoryRecall.confidence,
    });
  }

  return assumptions;
}

export function identifyContradictions(
  input: PIEDeliberationInput,
): PIEDeliberationContradiction[] {
  return [
    ...input.runtime.evidenceConflicts.map((conflict, index) => ({
      id: `contradiction-evidence-${index + 1}`,
      contradiction: conflict.summary,
      evidence: conflict.sources,
      severity: conflict.severity === 'critical' ? 'high' : conflict.severity,
    })),
    ...input.runtime.beliefChanges
      .filter(change => change.direction === 'weakened')
      .map((change, index) => ({
        id: `contradiction-belief-${index + 1}`,
        contradiction: change.reason,
        evidence: [change.previousBelief, change.updatedBelief],
        severity: 'medium' as const,
      })),
  ].slice(0, 8);
}

export function identifyMissingEvidence(
  input: PIEDeliberationInput,
): string[] {
  return Array.from(new Set([
    ...input.runtime.evidenceGaps.map(gap => gap.suggestedAction || gap.summary),
    ...input.runtime.graphGaps.map(gap => gap.suggestedAction || gap.summary),
    ...input.runtime.recommendedEvidence,
    ...(input.memoryRecall?.memoryInfluences
      .filter(influence => /verify|evidence|confirmation/i.test(influence.influence))
      .map(influence => influence.influence) || []),
    ...(input.evidenceQuality?.weakEvidence.slice(0, 3).map(item =>
      `Verify weak evidence: ${item.evidence.summary}`,
    ) || []),
    ...(input.evidenceQuality?.staleEvidence.slice(0, 3).map(item =>
      `Refresh stale evidence: ${item.evidence.summary}`,
    ) || []),
  ].filter(Boolean))).slice(0, 8);
}

export function buildAlternatives(
  input: PIEDeliberationInput,
  recommendations: RuntimePIERecommendation[] = input.runtime.recommendations,
): PIEDeliberationAlternative[] {
  const direct = recommendations.slice(0, 4).map(recommendation => ({
    id: `alternative-${recommendation.id}`,
    action: recommendation.suggestedNextAction || recommendation.title,
    rationale: recommendation.summary || recommendation.impact,
    supportingEvidence: recommendation.evidence,
    risk: recommendation.requiresApproval
      ? 'Requires user approval before action.'
      : recommendation.impact || 'May be less useful if evidence is stale.',
    score: fallbackScore(recommendation.confidence),
  }));

  const verification = {
    id: 'alternative-verify-first',
    action: 'Verify the highest-risk assumption before acting.',
    rationale: 'Verification reduces the chance of acting on stale, missing, or contradicted evidence.',
    supportingEvidence: [
      input.runtime.evidenceGaps[0]?.summary,
      input.memoryRecall?.summaryForPIE,
    ].filter(Boolean) as string[],
    risk: 'Slower than immediate action, but safer when confidence is not ready.',
    score: fallbackScore(input.runtime.overallConfidence),
  };

  const monitor = {
    id: 'alternative-monitor',
    action: 'Continue monitoring until stronger evidence arrives.',
    rationale: 'Useful when the impact is low or current evidence is not actionable.',
    supportingEvidence: input.runtime.unknowns.slice(0, 3).map(unknown => unknown.summary),
    risk: 'Can delay action if the condition is actually urgent.',
    score: fallbackScore('medium' as ProjectConfidenceLevel),
  };

  return [...direct, verification, monitor].slice(0, 6);
}

export function scoreAlternatives(
  alternatives: PIEDeliberationAlternative[],
  input: PIEDeliberationInput,
): PIEDeliberationAlternative[] {
  return alternatives
    .map(alternative => {
      const qualityBoost = input.evidenceQuality?.evidenceReadiness === 'strong'
        ? 3
        : input.evidenceQuality?.evidenceReadiness === 'conflicting' ||
            input.evidenceQuality?.evidenceReadiness === 'insufficient'
          ? -3
          : 0;
      const evidenceStrength = clamp(
        alternative.supportingEvidence.length * 2 +
          confidenceBase(alternative.score.readiness) +
          qualityBoost,
      );
      const urgency = /safety|overdue|critical|blocked|risk/i.test(`${alternative.action} ${alternative.rationale}`)
        ? 9
        : input.runtime.missionBlockers.length > 0
          ? 7
          : 5;
      const riskReduction = /verify|inspect|walk|capture|review/i.test(alternative.action) ? 8 : 5;
      const userEffort = /monitor|defer/i.test(alternative.action) ? 9 : 6;
      const reversibility = /send|approve|communicate/i.test(alternative.action) ? 4 : 8;
      const total = evidenceStrength + urgency + riskReduction + userEffort + reversibility;

      return {
        ...alternative,
        score: {
          evidenceStrength,
          urgency,
          riskReduction,
          userEffort,
          reversibility,
          total,
          readiness: readinessFromScore(total, input),
        },
      };
    })
    .sort((left, right) => right.score.total - left.score.total);
}

export function compareTradeoffs(
  alternatives: PIEDeliberationAlternative[],
): PIEDeliberationTradeoff[] {
  const top = alternatives[0];
  return alternatives.slice(1, 4).map((alternative, index) => ({
    id: `tradeoff-${index + 1}`,
    optionA: top?.action || 'Recommended action',
    optionB: alternative.action,
    benefit: top
      ? `${top.action} has a stronger decision score and clearer path to action.`
      : 'The recommended action has the best available support.',
    cost: `${alternative.action} may be safer or easier, but appears less decisive from current evidence.`,
    preferredOption: top?.action || alternative.action,
  }));
}

export function buildDeliberatedRecommendation(input: PIEDeliberationInput & {
  assumptions: PIEDeliberationAssumption[];
  contradictions: PIEDeliberationContradiction[];
  missingEvidence: string[];
  uncertainty: PIEDeliberationUncertainty[];
  alternatives: PIEDeliberationAlternative[];
  tradeoffs: PIEDeliberationTradeoff[];
}): PIEDeliberationRecommendation {
  const best = input.alternatives[0];
  const readiness = best?.score.readiness || readinessFromRuntime(input.runtime);
  const confidence = confidenceFromReadiness(readiness);
  const whatWouldChangeRecommendation = [
    ...input.missingEvidence.slice(0, 3),
    ...input.contradictions.slice(0, 2).map(item => `Resolve contradiction: ${item.contradiction}`),
    input.memoryRecall?.pastCorrections[0]
      ? 'A related user correction would require confirmation before acting.'
      : null,
  ].filter(Boolean) as string[];

  return {
    action: best?.action || input.runtime.nextBestAction.suggestedNextAction,
    whyRecommended: best?.rationale || input.runtime.nextBestAction.why,
    whyBetterThanAlternatives:
      input.tradeoffs[0]?.benefit ||
      'This action has the best available evidence, urgency, risk reduction, and approval boundary.',
    readiness,
    confidence,
    whatWouldChangeRecommendation: whatWouldChangeRecommendation.length > 0
      ? whatWouldChangeRecommendation
      : ['New contradictory evidence or a user correction would change this recommendation.'],
  };
}

export function explainDeliberation({
  recommendation,
  alternatives,
  tradeoffs,
  contradictions,
  missingEvidence,
}: {
  recommendation: PIEDeliberationRecommendation;
  alternatives: PIEDeliberationAlternative[];
  tradeoffs: PIEDeliberationTradeoff[];
  contradictions: PIEDeliberationContradiction[];
  missingEvidence: string[];
}): string {
  const alternativeText = alternatives[1]
    ? `DAVE considered ${alternatives[1].action}`
    : 'DAVE considered waiting for more evidence';
  const tradeoffText = tradeoffs[0]
    ? tradeoffs[0].benefit
    : recommendation.whyBetterThanAlternatives;
  const caution = contradictions.length > 0 || missingEvidence.length > 0
    ? ' DAVE also found uncertainty that should be verified.'
    : '';

  return `${recommendation.action} is ${recommendation.readiness}. ${alternativeText}, but ${tradeoffText}.${caution}`;
}

function buildUncertainty(
  input: PIEDeliberationInput,
  missingEvidence: string[],
): PIEDeliberationUncertainty[] {
  return [
    ...missingEvidence.slice(0, 4).map((missing, index) => ({
      id: `uncertainty-missing-${index + 1}`,
      uncertainty: missing,
      missingEvidence: missing,
      impact: 'This could change the recommendation or readiness level.',
    })),
    ...input.runtime.unknowns.slice(0, 3).map((unknown, index) => ({
      id: `uncertainty-runtime-${index + 1}`,
      uncertainty: unknown.summary,
      missingEvidence: unknown.suggestedAction,
      impact: unknown.impact,
    })),
  ];
}

function buildDeliberationQuestions(input: PIEDeliberationInput & {
  assumptions: PIEDeliberationAssumption[];
  contradictions: PIEDeliberationContradiction[];
  missingEvidence: string[];
  alternatives: PIEDeliberationAlternative[];
  tradeoffs: PIEDeliberationTradeoff[];
  recommendation: PIEDeliberationRecommendation;
}): PIEDeliberationQuestion[] {
  return [
    {
      id: 'question-what-known',
      question: 'What does DAVE know?',
      answer: input.runtime.currentUnderstanding.whatPIEKnows,
      confidence: input.runtime.overallConfidence,
    },
    {
      id: 'question-assumptions',
      question: 'What is DAVE assuming?',
      answer: input.assumptions.map(item => item.assumption).join(' '),
      confidence: confidenceFromReadiness(input.recommendation.readiness),
    },
    {
      id: 'question-supporting-evidence',
      question: 'What evidence supports this?',
      answer: input.alternatives[0]?.supportingEvidence.join(' ') || input.runtime.nextBestAction.evidence.join(' '),
      confidence: input.runtime.trustScore.level,
    },
    {
      id: 'question-contradictions',
      question: 'What evidence contradicts this?',
      answer: input.contradictions[0]?.contradiction || 'No strong contradiction is currently surfaced.',
      confidence: input.contradictions.length ? 'medium' : 'high',
    },
    {
      id: 'question-missing',
      question: 'What is missing?',
      answer: input.missingEvidence[0] || 'No major missing evidence is blocking the recommendation.',
      confidence: input.missingEvidence.length ? 'medium' : 'high',
    },
    {
      id: 'question-alternatives',
      question: 'What alternatives exist?',
      answer: input.alternatives.map(item => item.action).join(' | '),
      confidence: 'medium',
    },
    {
      id: 'question-tradeoffs',
      question: 'What are the trade-offs?',
      answer: input.tradeoffs[0]?.cost || 'The main trade-off is speed versus verification.',
      confidence: 'medium',
    },
    {
      id: 'question-strongest',
      question: 'What is the strongest recommendation?',
      answer: input.recommendation.action,
      confidence: input.recommendation.confidence,
    },
    {
      id: 'question-why-better',
      question: 'Why is this better than the alternatives?',
      answer: input.recommendation.whyBetterThanAlternatives,
      confidence: input.recommendation.confidence,
    },
    {
      id: 'question-change',
      question: "What would change DAVE's recommendation?",
      answer: input.recommendation.whatWouldChangeRecommendation.join(' '),
      confidence: 'medium',
    },
  ];
}

function fallbackScore(confidence: ProjectConfidenceLevel): PIEDeliberationDecisionScore {
  const base = confidence === 'high' ? 8 : confidence === 'medium' ? 6 : 4;
  const total = base * 5;
  return {
    evidenceStrength: base,
    urgency: base,
    riskReduction: base,
    userEffort: base,
    reversibility: base,
    total,
    readiness: total >= 38 ? 'Ready' : total >= 28 ? 'Needs Verification' : 'Uncertain',
  };
}

function readinessFromScore(
  total: number,
  input: PIEDeliberationInput,
): PIEDeliberationReadiness {
  if (input.runtime.evidenceGaps.some(gap => gap.severity === 'critical')) return 'Blocked';
  if (input.runtime.evidenceConflicts.length > 0 || input.runtime.beliefChanges.some(change => change.direction === 'weakened')) {
    return 'Needs Verification';
  }
  if (total >= 38 && input.runtime.overallConfidence === 'high') return 'Ready';
  if (total >= 30) return 'Needs Verification';
  if (total >= 22) return 'Uncertain';

  return 'Blocked';
}

function readinessFromRuntime(runtime: PIERuntimeState): PIEDeliberationReadiness {
  if (runtime.evidenceGaps.some(gap => gap.severity === 'critical')) return 'Blocked';
  if (runtime.evidenceConflicts.length > 0 || runtime.overallConfidence === 'low') return 'Uncertain';
  if (runtime.overallConfidence === 'high') return 'Ready';

  return 'Needs Verification';
}

function confidenceFromReadiness(readiness: PIEDeliberationReadiness): ProjectConfidenceLevel {
  if (readiness === 'Ready') return 'high';
  if (readiness === 'Needs Verification') return 'medium';

  return 'low';
}

function confidenceBase(readiness: PIEDeliberationReadiness) {
  if (readiness === 'Ready') return 7;
  if (readiness === 'Needs Verification') return 5;
  if (readiness === 'Uncertain') return 3;

  return 1;
}

function clamp(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}
