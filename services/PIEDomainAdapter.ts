import {
  buildECOSDomainInput,
  explainDomainMapping,
  mapECOSOutputToDomain,
  type ECOSDomainConstraint,
  type ECOSDomainDecision,
  type ECOSDomainEvidence,
  type ECOSDomainGoal,
  type ECOSDomainInput,
  type ECOSDomainOutput,
  type ECOSDomainRisk,
} from './ECOSDomainAdapter';
import type { ECOSCognitiveOutput } from './ECOSCognitiveFramework';
import type { PIERuntimeState } from './PIERuntime';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEDomainAdapterInput = {
  runtime: PIERuntimeState;
  evidenceReview?: {
    receivedData: string[];
    missingData: string[];
    conflicts: string[];
    confidence: ProjectConfidenceLevel;
  };
  memory?: string[];
  patterns?: string[];
  constraints?: string[];
  risks?: string[];
  decisions?: string[];
  candidateActions?: string[];
  outcomes?: string[];
  feedback?: string[];
};

export type PIEProjectIntelligenceOutput = {
  projectBeliefs: string[];
  projectRisks: string[];
  projectDecisions: string[];
  projectRecommendations: string[];
  projectUncertainty: string[];
  projectNextBestActions: string[];
  reportInsights: string[];
  domainOutput: ECOSDomainOutput;
};

export function buildPIEDomainInput(
  input: PIEDomainAdapterInput,
): ECOSDomainInput {
  const { runtime } = input;

  return buildECOSDomainInput({
    domain: 'project',
    subject: runtime.projectName || runtime.projectNames[0] || 'project',
    context: buildPIEContext(input),
    goals: mapPIEGoalsToECOS(input),
    evidence: mapPIEEvidenceToECOS(input),
    risks: mapPIERisksToECOS(input),
    constraints: mapPIEConstraintsToECOS(input),
    decisions: mapPIEDecisionsToECOS(input),
    candidateActions: input.candidateActions || defaultPIEActions(runtime),
    memory: input.memory || [],
    patterns: input.patterns || [],
    outcomes: input.outcomes || runtime.lessonsLearned.map(lesson => lesson.lesson),
    feedback: input.feedback || [],
    generatedAt: runtime.generatedAt,
  });
}

export function mapPIEEvidenceToECOS(
  input: PIEDomainAdapterInput,
): ECOSDomainEvidence[] {
  const { runtime, evidenceReview } = input;
  const reviewEvidence = evidenceReview?.receivedData || [];
  const fusedEvidence = runtime.fusedEvidence;

  return [
    ...reviewEvidence.map((summary, index) => ({
      id: `pie-review-evidence-${index + 1}`,
      domain: 'project' as const,
      source: 'evidence-review',
      summary,
      confidence: evidenceReview?.confidence || runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    })),
    {
      id: 'pie-schedule-evidence',
      domain: 'project' as const,
      source: 'schedule',
      summary: runtime.intelligentSummary.scheduleStatus,
      confidence: runtime.scheduleConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-photo-evidence',
      domain: 'project' as const,
      source: 'photos',
      summary: runtime.intelligentSummary.photoEvidenceSummary,
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-location-evidence',
      domain: 'project' as const,
      source: 'location',
      summary: runtime.intelligentSummary.gpsLocationConfidence,
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-note-evidence',
      domain: 'project' as const,
      source: 'notes',
      summary: runtime.intelligentSummary.userUpdateSummary,
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-issue-evidence',
      domain: 'project' as const,
      source: 'issues',
      summary: runtime.intelligentSummary.risksAndIssues,
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-safety-evidence',
      domain: 'project' as const,
      source: 'safety',
      summary: runtime.intelligentSummary.safetySummary,
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
    {
      id: 'pie-report-evidence',
      domain: 'project' as const,
      source: 'reports',
      summary:
        fusedEvidence.reportEvidence.length > 0
          ? `${fusedEvidence.reportEvidence.length} prior report evidence item${fusedEvidence.reportEvidence.length === 1 ? '' : 's'} available.`
          : 'No prior report evidence is available.',
      confidence: runtime.overallConfidence,
      timestamp: runtime.generatedAt,
    },
  ].filter(item => item.summary.trim().length > 0);
}

export function mapPIEGoalsToECOS(
  input: PIEDomainAdapterInput,
): ECOSDomainGoal[] {
  const { runtime } = input;

  return [
    {
      id: 'pie-current-mission',
      goal:
        runtime.currentMission.objective?.summary ||
        runtime.currentMission.objective?.title ||
        runtime.currentMission.purpose,
      priority: runtime.currentMission.priority === 'critical' ? 'critical' as const : 'high' as const,
    },
    {
      id: 'pie-next-best-action',
      goal: runtime.nextBestAction.suggestedNextAction,
      priority: 'high' as const,
    },
  ].filter(item => item.goal.trim().length > 0);
}

export function mapPIEConstraintsToECOS(
  input: PIEDomainAdapterInput,
): ECOSDomainConstraint[] {
  const { runtime } = input;
  const externalConstraints = input.constraints || [];

  return [
    ...runtime.evidenceGaps.map(gap => ({
      id: gap.id,
      constraint: gap.summary,
      source: gap.source,
    })),
    ...externalConstraints.map((constraint, index) => ({
      id: `pie-constraint-${index + 1}`,
      constraint,
      source: 'pie-adapter',
    })),
  ];
}

export function mapECOSToPIEIntelligence(
  domainInput: ECOSDomainInput,
  cognitiveOutput: ECOSCognitiveOutput,
): PIEProjectIntelligenceOutput {
  const domainOutput = mapECOSOutputToDomain(domainInput, cognitiveOutput);

  return {
    projectBeliefs: cognitiveOutput.beliefs.map(belief => belief.belief),
    projectRisks: [
      ...domainInput.risks.map(risk => risk.risk),
      ...cognitiveOutput.predictions
        .map(prediction => prediction.risk)
        .filter((risk): risk is string => Boolean(risk)),
    ],
    projectDecisions: [
      ...domainInput.decisions.map(decision => decision.decision),
      ...cognitiveOutput.decisionScores.map(score => score.decision),
    ],
    projectRecommendations: domainOutput.recommendations.map(
      recommendation => recommendation.recommendation,
    ),
    projectUncertainty: cognitiveOutput.uncertainty.unknowns,
    projectNextBestActions: cognitiveOutput.nextBestActions,
    reportInsights: cognitiveOutput.explanations.map(explanation =>
      `${explanation.explains}: ${explanation.because.join(' ')}`,
    ),
    domainOutput,
  };
}

export function buildPIEDomainMappingResult(input: ECOSDomainInput) {
  return explainDomainMapping(input);
}

function buildPIEContext(input: PIEDomainAdapterInput) {
  const { runtime } = input;

  return [
    {
      id: 'pie-project-status',
      domain: 'project' as const,
      subject: runtime.projectName || 'project',
      summary: runtime.intelligentSummary.projectStatus,
    },
    {
      id: 'pie-what-changed',
      domain: 'project' as const,
      subject: runtime.projectName || 'project',
      summary: runtime.intelligentSummary.whatChanged,
    },
    {
      id: 'pie-fusion-summary',
      domain: 'project' as const,
      subject: runtime.projectName || 'project',
      summary: runtime.evidenceFusionSummary.summary,
    },
    {
      id: 'pie-mission-summary',
      domain: 'project' as const,
      subject: runtime.projectName || 'project',
      summary: runtime.missionSummary.overallPurpose,
    },
  ].filter(item => item.summary.trim().length > 0);
}

function mapPIERisksToECOS(input: PIEDomainAdapterInput): ECOSDomainRisk[] {
  const { runtime } = input;
  const externalRisks = input.risks || [];

  return [
    ...runtime.evidenceConflicts.map(conflict => ({
      id: conflict.id,
      risk: conflict.summary,
      severity: conflict.severity,
    })),
    ...externalRisks.map((risk, index) => ({
      id: `pie-risk-${index + 1}`,
      risk,
      severity: 'medium' as const,
    })),
  ];
}

function mapPIEDecisionsToECOS(
  input: PIEDomainAdapterInput,
): ECOSDomainDecision[] {
  const decisions = input.decisions || [];

  return decisions.map((decision, index) => ({
    id: `pie-decision-${index + 1}`,
    decision,
    options: [],
    owner: null,
  }));
}

function defaultPIEActions(runtime: PIERuntimeState): string[] {
  return [
    runtime.nextBestAction.suggestedNextAction,
    ...runtime.recommendations.map(recommendation => recommendation.suggestedNextAction),
    ...runtime.recommendedEvidence,
  ].filter((action, index, actions): action is string =>
    Boolean(action) && actions.indexOf(action) === index,
  );
}
