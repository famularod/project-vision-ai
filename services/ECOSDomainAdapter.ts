import type {
  ECOSCognitiveInput,
  ECOSCognitiveOutput,
  ECOSEvidenceInput,
} from './ECOSCognitiveFramework';

export type ECOSDomain =
  | 'project'
  | 'manufacturing'
  | 'maintenance'
  | 'safety'
  | 'compliance'
  | 'facilities'
  | 'logistics';

export type ECOSDomainEvidence = {
  id: string;
  domain: ECOSDomain;
  source: string;
  summary: string;
  confidence?: ECOSEvidenceInput['confidence'];
  timestamp?: string | null;
};

export type ECOSDomainContext = {
  id: string;
  domain: ECOSDomain;
  subject: string;
  summary: string;
};

export type ECOSDomainGoal = {
  id: string;
  goal: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
};

export type ECOSDomainRisk = {
  id: string;
  risk: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
};

export type ECOSDomainConstraint = {
  id: string;
  constraint: string;
  source: string;
};

export type ECOSDomainDecision = {
  id: string;
  decision: string;
  options: string[];
  owner?: string | null;
};

export type ECOSDomainRecommendation = {
  id: string;
  domain: ECOSDomain;
  recommendation: string;
  why: string;
  evidence: string[];
  confidence: ECOSEvidenceInput['confidence'];
};

export type ECOSDomainInput = {
  domain: ECOSDomain;
  subject: string;
  context: ECOSDomainContext[];
  goals: ECOSDomainGoal[];
  evidence: ECOSDomainEvidence[];
  risks: ECOSDomainRisk[];
  constraints: ECOSDomainConstraint[];
  decisions: ECOSDomainDecision[];
  candidateActions: string[];
  memory: string[];
  patterns: string[];
  outcomes: string[];
  feedback: string[];
  generatedAt?: string;
};

export type ECOSDomainMappingResult = {
  domain: ECOSDomain;
  subject: string;
  ecosInput: ECOSCognitiveInput;
  mappedEvidenceCount: number;
  mappedGoalCount: number;
  mappedRiskCount: number;
  mappedConstraintCount: number;
  mappedDecisionCount: number;
  explanation: string;
};

export type ECOSDomainOutput = {
  domain: ECOSDomain;
  subject: string;
  cognitiveOutput: ECOSCognitiveOutput;
  recommendations: ECOSDomainRecommendation[];
  decisions: ECOSDomainDecision[];
  risks: ECOSDomainRisk[];
  uncertainty: string[];
  nextBestActions: string[];
  mapping: ECOSDomainMappingResult;
};

export function buildECOSDomainInput(
  input: Partial<ECOSDomainInput> & Pick<ECOSDomainInput, 'domain' | 'subject'>,
): ECOSDomainInput {
  return {
    domain: input.domain,
    subject: input.subject,
    context: input.context || [],
    goals: input.goals || [],
    evidence: input.evidence || [],
    risks: input.risks || [],
    constraints: input.constraints || [],
    decisions: input.decisions || [],
    candidateActions: input.candidateActions || [],
    memory: input.memory || [],
    patterns: input.patterns || [],
    outcomes: input.outcomes || [],
    feedback: input.feedback || [],
    generatedAt: input.generatedAt,
  };
}

export function mapDomainEvidenceToECOS(
  evidence: ECOSDomainEvidence[],
): ECOSEvidenceInput[] {
  return evidence.map(item => ({
    id: item.id,
    source: `${item.domain}:${item.source}`,
    summary: item.summary,
    confidence: item.confidence || 'medium',
    timestamp: item.timestamp || undefined,
  }));
}

export function mapDomainGoalsToECOS(goals: ECOSDomainGoal[]): string {
  const primaryGoal =
    goals.find(goal => goal.priority === 'critical') ||
    goals.find(goal => goal.priority === 'high') ||
    goals[0];

  return primaryGoal?.goal || 'reduce uncertainty and recommend the next action';
}

export function mapDomainConstraintsToECOS(
  constraints: ECOSDomainConstraint[],
): string[] {
  return constraints.map(item => `${item.source}: ${item.constraint}`);
}

export function mapECOSOutputToDomain(
  domainInput: ECOSDomainInput,
  cognitiveOutput: ECOSCognitiveOutput,
): ECOSDomainOutput {
  const mapping = explainDomainMapping(domainInput);

  return {
    domain: domainInput.domain,
    subject: domainInput.subject,
    cognitiveOutput,
    recommendations: cognitiveOutput.recommendations.map(recommendation =>
      mapECOSRecommendationToDomain(domainInput.domain, recommendation),
    ),
    decisions: domainInput.decisions,
    risks: domainInput.risks,
    uncertainty: cognitiveOutput.uncertainty.unknowns,
    nextBestActions: cognitiveOutput.nextBestActions,
    mapping,
  };
}

export function mapECOSRecommendationToDomain(
  domain: ECOSDomain,
  recommendation: ECOSCognitiveOutput['recommendations'][number],
): ECOSDomainRecommendation {
  return buildDomainRecommendation({
    id: recommendation.id,
    domain,
    recommendation: recommendation.action,
    why: recommendation.why,
    evidence: recommendation.evidence,
    confidence: recommendation.confidence,
  });
}

export function buildDomainRecommendation(
  recommendation: ECOSDomainRecommendation,
): ECOSDomainRecommendation {
  return recommendation;
}

export function explainDomainMapping(
  domainInput: ECOSDomainInput,
): ECOSDomainMappingResult {
  const ecosInput: ECOSCognitiveInput = {
    subject: domainInput.subject,
    goal: mapDomainGoalsToECOS(domainInput.goals),
    context: domainInput.context.map(item => item.summary),
    evidence: mapDomainEvidenceToECOS(domainInput.evidence),
    priorMemory: domainInput.memory,
    knownPatterns: domainInput.patterns,
    constraints: mapDomainConstraintsToECOS(domainInput.constraints),
    risks: domainInput.risks.map(item => item.risk),
    decisions: domainInput.decisions.map(item => item.decision),
    candidateActions: domainInput.candidateActions,
    outcomes: domainInput.outcomes,
    feedback: domainInput.feedback,
    generatedAt: domainInput.generatedAt,
  };

  return {
    domain: domainInput.domain,
    subject: domainInput.subject,
    ecosInput,
    mappedEvidenceCount: domainInput.evidence.length,
    mappedGoalCount: domainInput.goals.length,
    mappedRiskCount: domainInput.risks.length,
    mappedConstraintCount: domainInput.constraints.length,
    mappedDecisionCount: domainInput.decisions.length,
    explanation:
      'Domain evidence, goals, risks, constraints, decisions, actions, memory, patterns, outcomes, and feedback were mapped into ECOS generic cognitive input.',
  };
}
