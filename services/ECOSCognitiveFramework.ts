export type ECOSReadiness =
  | 'ready'
  | 'needs_verification'
  | 'uncertain'
  | 'blocked';

export type ECOSConfidence =
  | 'low'
  | 'medium'
  | 'high';

export type ECOSEvidenceInput = {
  id?: string;
  source: string;
  summary: string;
  confidence?: ECOSConfidence;
  timestamp?: string;
};

export type ECOSCognitiveInput = {
  subject?: string;
  goal?: string;
  context?: string[];
  evidence?: ECOSEvidenceInput[];
  priorMemory?: string[];
  knownPatterns?: string[];
  constraints?: string[];
  risks?: string[];
  decisions?: string[];
  candidateActions?: string[];
  outcomes?: string[];
  feedback?: string[];
  generatedAt?: string;
};

export type ECOSObservation = {
  id: string;
  subject: string;
  observation: string;
  source: string;
  confidence: ECOSConfidence;
};

export type ECOSEvidenceReview = {
  summary: string;
  receivedEvidence: string[];
  missingEvidence: string[];
  conflicts: string[];
  confidence: ECOSConfidence;
};

export type ECOSInterpretation = {
  id: string;
  meaning: string;
  basedOn: string[];
  confidence: ECOSConfidence;
};

export type ECOSMemoryRecall = {
  recalledItems: string[];
  relevance: ECOSConfidence;
  influence: string;
};

export type ECOSPatternRecognition = {
  id: string;
  pattern: string;
  evidence: string[];
  confidence: ECOSConfidence;
};

export type ECOSHypothesis = {
  id: string;
  hypothesis: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  confidence: ECOSConfidence;
};

export type ECOSSelfChallenge = {
  id: string;
  challenge: string;
  assumption: string;
  evidenceNeeded: string[];
  confidence: ECOSConfidence;
};

export type ECOSBelief = {
  id: string;
  belief: string;
  support: string[];
  uncertainty: string[];
  confidence: ECOSConfidence;
};

export type ECOSDeliberation = {
  question: string;
  options: string[];
  tradeoffs: string[];
  strongestOption: string | null;
  whatWouldChangeThis: string[];
  readiness: ECOSReadiness;
};

export type ECOSPrediction = {
  id: string;
  scenario: string;
  likelyOutcome: string;
  risk: string | null;
  confidence: ECOSConfidence;
};

export type ECOSDecisionScore = {
  id: string;
  decision: string;
  score: number;
  reason: string;
  readiness: ECOSReadiness;
};

export type ECOSRecommendation = {
  id: string;
  action: string;
  why: string;
  evidence: string[];
  confidence: ECOSConfidence;
};

export type ECOSExplanation = {
  id: string;
  explains: string;
  because: string[];
  uncertainty: string[];
  confidence: ECOSConfidence;
};

export type ECOSReflection = {
  summary: string;
  strengthened: string[];
  weakened: string[];
  stillUnknown: string[];
};

export type ECOSLearning = {
  lessons: string[];
  trustMore: string[];
  trustLess: string[];
  nextAdjustment: string | null;
};

export type ECOSUncertainty = {
  unknowns: string[];
  reductionActions: string[];
  confidence: ECOSConfidence;
};

export type ECOSCognitiveOutput = {
  generatedAt: string;
  subject: string;
  goal: string;
  observations: ECOSObservation[];
  evidenceReview: ECOSEvidenceReview;
  interpretations: ECOSInterpretation[];
  memoryRecall: ECOSMemoryRecall;
  patterns: ECOSPatternRecognition[];
  hypotheses: ECOSHypothesis[];
  challenges: ECOSSelfChallenge[];
  beliefs: ECOSBelief[];
  deliberation: ECOSDeliberation;
  predictions: ECOSPrediction[];
  decisionScores: ECOSDecisionScore[];
  recommendations: ECOSRecommendation[];
  explanations: ECOSExplanation[];
  reflection: ECOSReflection;
  learning: ECOSLearning;
  uncertainty: ECOSUncertainty;
  readiness: ECOSReadiness;
  nextBestActions: string[];
};

export function runECOSCognitiveFramework(
  input: ECOSCognitiveInput = {},
): ECOSCognitiveOutput {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const subject = input.subject || 'current subject';
  const goal = input.goal || 'reduce uncertainty and recommend the next action';
  const evidence = input.evidence || [];
  const context = input.context || [];
  const constraints = input.constraints || [];
  const risks = input.risks || [];
  const candidateActions = input.candidateActions || [];
  const decisions = input.decisions || [];

  const observations = buildObservations(subject, evidence, context);
  const evidenceReview = buildEvidenceReview(evidence, constraints, risks);
  const interpretations = buildInterpretations(observations, evidenceReview);
  const memoryRecall = buildMemoryRecall(input.priorMemory || []);
  const patterns = buildPatterns(input.knownPatterns || [], evidence);
  const hypotheses = buildHypotheses(interpretations, patterns, evidenceReview);
  const challenges = buildChallenges(hypotheses, constraints, evidenceReview);
  const beliefs = buildBeliefs(hypotheses, challenges);
  const deliberation = buildDeliberation(goal, candidateActions, decisions, risks, constraints, challenges);
  const predictions = buildPredictions(candidateActions, risks, evidenceReview);
  const decisionScores = buildDecisionScores(decisions, candidateActions, deliberation, evidenceReview);
  const recommendations = buildRecommendations(candidateActions, deliberation, evidenceReview, beliefs);
  const explanations = buildExplanations(recommendations, beliefs, evidenceReview, challenges);
  const reflection = buildReflection(input.outcomes || [], input.feedback || [], beliefs);
  const learning = buildLearning(input.feedback || [], input.outcomes || [], reflection);
  const uncertainty = buildUncertainty(evidenceReview, challenges, risks);
  const readiness = determineReadiness(evidenceReview, uncertainty, deliberation);

  return {
    generatedAt,
    subject,
    goal,
    observations,
    evidenceReview,
    interpretations,
    memoryRecall,
    patterns,
    hypotheses,
    challenges,
    beliefs,
    deliberation: {
      ...deliberation,
      readiness,
    },
    predictions,
    decisionScores,
    recommendations,
    explanations,
    reflection,
    learning,
    uncertainty,
    readiness,
    nextBestActions: buildNextBestActions(recommendations, uncertainty, candidateActions),
  };
}

function buildObservations(
  subject: string,
  evidence: ECOSEvidenceInput[],
  context: string[],
): ECOSObservation[] {
  const evidenceObservations = evidence.map((item, index) => ({
    id: item.id || `observation-${index + 1}`,
    subject,
    observation: item.summary,
    source: item.source,
    confidence: item.confidence || 'medium',
  }));

  const contextObservations = context.map((item, index) => ({
    id: `context-${index + 1}`,
    subject,
    observation: item,
    source: 'context',
    confidence: 'medium' as ECOSConfidence,
  }));

  return [...evidenceObservations, ...contextObservations];
}

function buildEvidenceReview(
  evidence: ECOSEvidenceInput[],
  constraints: string[],
  risks: string[],
): ECOSEvidenceReview {
  const lowConfidenceEvidence = evidence.filter(item => item.confidence === 'low');

  return {
    summary:
      evidence.length > 0
        ? `${evidence.length} evidence item${evidence.length === 1 ? '' : 's'} reviewed.`
        : 'No evidence has been provided.',
    receivedEvidence: evidence.map(item => `${item.source}: ${item.summary}`),
    missingEvidence: [
      evidence.length === 0 ? 'Evidence is needed before a strong recommendation.' : null,
      lowConfidenceEvidence.length > 0 ? 'Higher-confidence evidence is needed.' : null,
      constraints.length > 0 && risks.length === 0 ? 'Risk evidence should be checked against constraints.' : null,
    ].filter((item): item is string => Boolean(item)),
    conflicts: findConflicts(evidence),
    confidence:
      evidence.length === 0 || lowConfidenceEvidence.length > evidence.length / 2
        ? 'low'
        : lowConfidenceEvidence.length > 0
          ? 'medium'
          : 'high',
  };
}

function buildInterpretations(
  observations: ECOSObservation[],
  evidenceReview: ECOSEvidenceReview,
): ECOSInterpretation[] {
  if (observations.length === 0) {
    return [{
      id: 'interpretation-needed',
      meaning: 'Meaning cannot be determined until evidence is provided.',
      basedOn: [],
      confidence: 'low',
    }];
  }

  return observations.slice(0, 5).map((observation, index) => ({
    id: `interpretation-${index + 1}`,
    meaning: `Evidence suggests: ${observation.observation}`,
    basedOn: [observation.id],
    confidence: evidenceReview.confidence,
  }));
}

function buildMemoryRecall(priorMemory: string[]): ECOSMemoryRecall {
  return {
    recalledItems: priorMemory,
    relevance:
      priorMemory.length === 0 ? 'low' : priorMemory.length > 2 ? 'high' : 'medium',
    influence:
      priorMemory.length > 0
        ? 'Prior memory should influence interpretation, challenge, and recommendation.'
        : 'No prior memory was available.',
  };
}

function buildPatterns(
  knownPatterns: string[],
  evidence: ECOSEvidenceInput[],
): ECOSPatternRecognition[] {
  return knownPatterns.map((pattern, index) => ({
    id: `pattern-${index + 1}`,
    pattern,
    evidence: evidence.slice(0, 3).map(item => item.summary),
    confidence: evidence.length > 0 ? 'medium' : 'low',
  }));
}

function buildHypotheses(
  interpretations: ECOSInterpretation[],
  patterns: ECOSPatternRecognition[],
  evidenceReview: ECOSEvidenceReview,
): ECOSHypothesis[] {
  const primaryInterpretation = interpretations[0];
  const primaryPattern = patterns[0];

  return [{
    id: 'hypothesis-1',
    hypothesis: primaryInterpretation
      ? primaryInterpretation.meaning
      : 'Evidence may be incomplete.',
    supportingEvidence: primaryInterpretation?.basedOn || [],
    contradictingEvidence: evidenceReview.conflicts,
    confidence: evidenceReview.confidence,
  }, primaryPattern ? {
    id: 'hypothesis-2',
    hypothesis: `This may follow a known pattern: ${primaryPattern.pattern}`,
    supportingEvidence: primaryPattern.evidence,
    contradictingEvidence: [],
    confidence: primaryPattern.confidence,
  } : null].filter((item): item is ECOSHypothesis => Boolean(item));
}

function buildChallenges(
  hypotheses: ECOSHypothesis[],
  constraints: string[],
  evidenceReview: ECOSEvidenceReview,
): ECOSSelfChallenge[] {
  return hypotheses.map((hypothesis, index) => ({
    id: `challenge-${index + 1}`,
    challenge:
      hypothesis.contradictingEvidence.length > 0
        ? 'Contradicting evidence may weaken this hypothesis.'
        : 'This hypothesis should be checked before a strong action is taken.',
    assumption: hypothesis.hypothesis,
    evidenceNeeded: [
      ...evidenceReview.missingEvidence,
      ...constraints.map(constraint => `Verify constraint: ${constraint}`),
    ],
    confidence: hypothesis.confidence,
  }));
}

function buildBeliefs(
  hypotheses: ECOSHypothesis[],
  challenges: ECOSSelfChallenge[],
): ECOSBelief[] {
  return hypotheses.map((hypothesis, index) => ({
    id: `belief-${index + 1}`,
    belief: hypothesis.hypothesis,
    support: hypothesis.supportingEvidence,
    uncertainty: challenges[index]?.evidenceNeeded || [],
    confidence: hypothesis.confidence,
  }));
}

function buildDeliberation(
  goal: string,
  candidateActions: string[],
  decisions: string[],
  risks: string[],
  constraints: string[],
  challenges: ECOSSelfChallenge[],
): ECOSDeliberation {
  const options = candidateActions.length > 0
    ? candidateActions
    : decisions.length > 0
      ? decisions
      : ['Collect more evidence'];

  return {
    question: `What action best supports the goal: ${goal}?`,
    options,
    tradeoffs: [
      ...risks.map(risk => `Risk: ${risk}`),
      ...constraints.map(constraint => `Constraint: ${constraint}`),
    ],
    strongestOption: options[0] || null,
    whatWouldChangeThis: challenges.flatMap(challenge => challenge.evidenceNeeded).slice(0, 5),
    readiness: 'uncertain',
  };
}

function buildPredictions(
  candidateActions: string[],
  risks: string[],
  evidenceReview: ECOSEvidenceReview,
): ECOSPrediction[] {
  const actions = candidateActions.length > 0 ? candidateActions : ['Collect more evidence'];

  return actions.slice(0, 3).map((action, index) => ({
    id: `prediction-${index + 1}`,
    scenario: action,
    likelyOutcome:
      evidenceReview.confidence === 'low'
        ? 'Outcome is uncertain until stronger evidence is available.'
        : 'Outcome can be estimated from current evidence.',
    risk: risks[index] || risks[0] || null,
    confidence: evidenceReview.confidence,
  }));
}

function buildDecisionScores(
  decisions: string[],
  candidateActions: string[],
  deliberation: ECOSDeliberation,
  evidenceReview: ECOSEvidenceReview,
): ECOSDecisionScore[] {
  const decisionList = decisions.length > 0 ? decisions : candidateActions;

  return decisionList.slice(0, 5).map((decision, index) => ({
    id: `decision-${index + 1}`,
    decision,
    score: scoreForDecision(index, evidenceReview.confidence),
    reason:
      decision === deliberation.strongestOption
        ? 'This is the strongest available option from current evidence.'
        : 'This option may be useful but is not the strongest current option.',
    readiness: evidenceReview.confidence === 'high' ? 'ready' : 'needs_verification',
  }));
}

function buildRecommendations(
  candidateActions: string[],
  deliberation: ECOSDeliberation,
  evidenceReview: ECOSEvidenceReview,
  beliefs: ECOSBelief[],
): ECOSRecommendation[] {
  const actions = candidateActions.length > 0
    ? candidateActions
    : [deliberation.strongestOption || 'Collect more evidence'];

  return actions.slice(0, 3).map((action, index) => ({
    id: `recommendation-${index + 1}`,
    action,
    why:
      evidenceReview.confidence === 'low'
        ? 'This action reduces uncertainty before a stronger recommendation is made.'
        : 'This action is supported by current evidence and belief strength.',
    evidence: beliefs[index]?.support || evidenceReview.receivedEvidence.slice(0, 3),
    confidence: evidenceReview.confidence,
  }));
}

function buildExplanations(
  recommendations: ECOSRecommendation[],
  beliefs: ECOSBelief[],
  evidenceReview: ECOSEvidenceReview,
  challenges: ECOSSelfChallenge[],
): ECOSExplanation[] {
  return recommendations.map((recommendation, index) => ({
    id: `explanation-${index + 1}`,
    explains: recommendation.action,
    because: [
      recommendation.why,
      beliefs[index]?.belief,
      evidenceReview.summary,
    ].filter((item): item is string => Boolean(item)),
    uncertainty: challenges[index]?.evidenceNeeded || evidenceReview.missingEvidence,
    confidence: recommendation.confidence,
  }));
}

function buildReflection(
  outcomes: string[],
  feedback: string[],
  beliefs: ECOSBelief[],
): ECOSReflection {
  return {
    summary:
      outcomes.length > 0 || feedback.length > 0
        ? 'New outcomes or feedback are available for reflection.'
        : 'No new outcome feedback is available yet.',
    strengthened: beliefs
      .filter(belief => belief.confidence === 'high')
      .map(belief => belief.belief),
    weakened: feedback.filter(item => /wrong|reject|incorrect|weaken/i.test(item)),
    stillUnknown: beliefs.flatMap(belief => belief.uncertainty).slice(0, 5),
  };
}

function buildLearning(
  feedback: string[],
  outcomes: string[],
  reflection: ECOSReflection,
): ECOSLearning {
  return {
    lessons: [...feedback, ...outcomes, reflection.summary].filter(Boolean).slice(0, 5),
    trustMore: reflection.strengthened,
    trustLess: reflection.weakened,
    nextAdjustment: reflection.stillUnknown[0] || null,
  };
}

function buildUncertainty(
  evidenceReview: ECOSEvidenceReview,
  challenges: ECOSSelfChallenge[],
  risks: string[],
): ECOSUncertainty {
  const unknowns = [
    ...evidenceReview.missingEvidence,
    ...challenges.flatMap(challenge => challenge.evidenceNeeded),
  ];

  return {
    unknowns: [...new Set(unknowns)].slice(0, 8),
    reductionActions: [
      ...unknowns.map(item => `Verify: ${item}`),
      ...risks.map(risk => `Reduce risk: ${risk}`),
    ].slice(0, 8),
    confidence: evidenceReview.confidence,
  };
}

function buildNextBestActions(
  recommendations: ECOSRecommendation[],
  uncertainty: ECOSUncertainty,
  candidateActions: string[],
): string[] {
  return [
    recommendations[0]?.action,
    uncertainty.reductionActions[0],
    candidateActions[0],
  ].filter((item): item is string => Boolean(item));
}

function findConflicts(evidence: ECOSEvidenceInput[]): string[] {
  const summaries = evidence.map(item => item.summary.toLowerCase());
  const hasPositive = summaries.some(item => /complete|resolved|accepted|approved|stable/.test(item));
  const hasNegative = summaries.some(item => /blocked|rejected|failed|risk|issue|uncertain/.test(item));

  return hasPositive && hasNegative
    ? ['Evidence contains both positive and negative signals.']
    : [];
}

function determineReadiness(
  evidenceReview: ECOSEvidenceReview,
  uncertainty: ECOSUncertainty,
  deliberation: ECOSDeliberation,
): ECOSReadiness {
  if (evidenceReview.receivedEvidence.length === 0) return 'blocked';
  if (evidenceReview.conflicts.length > 0) return 'needs_verification';
  if (uncertainty.unknowns.length > 0 || !deliberation.strongestOption) return 'uncertain';
  if (evidenceReview.confidence === 'high') return 'ready';
  return 'needs_verification';
}

function scoreForDecision(index: number, confidence: ECOSConfidence): number {
  const confidenceScore = confidence === 'high' ? 30 : confidence === 'medium' ? 20 : 10;
  return Math.max(0, 100 - index * 15 - (30 - confidenceScore));
}
