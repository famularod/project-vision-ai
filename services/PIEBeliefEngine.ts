import type { PIEMemoryRecallResult } from './PIEMemoryRecall';
import type { PIELearningResult } from './PIELearningEngine';
import type { PIEEvidenceQualityResult } from './PIEEvidenceQuality';
import type { PIEEvidenceTimeline } from './PIEEvidenceTimeline';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { PIEPatternIntelligence } from './PIEPatternEngine';
import type {
  PIEBeliefChange as PIEReflectionBeliefChange,
  PIELessonLearned,
} from './PIEReflectionEngine';
import type {
  PIEScientificChallenge,
  PIEScientificHypothesis,
  PIEScientificResult,
} from './PIEScientificMethod';
import type { PIERuntimeState } from './PIERuntime';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import { parseDAVEAssertions } from './DAVEAssertionParser';

export type PIEBeliefType =
  | 'progress'
  | 'schedule'
  | 'risk'
  | 'safety'
  | 'quality'
  | 'inspection'
  | 'contractor'
  | 'decision'
  | 'communication'
  | 'evidence_gap'
  | 'location'
  | 'issue'
  | 'completion'
  | 'readiness';

export type PIEBeliefStatus =
  | 'forming'
  | 'supported'
  | 'challenged'
  | 'weakened'
  | 'strengthened'
  | 'contradicted'
  | 'retired'
  | 'needs_verification';

export type PIEBeliefConfidence = ProjectConfidenceLevel;

export type PIEBeliefReadiness =
  | 'Ready'
  | 'Needs Verification'
  | 'Uncertain'
  | 'Blocked';

export type PIEBeliefEvidence = {
  id: string;
  source: string;
  summary: string;
  confidence: PIEBeliefConfidence;
};

export type PIEBeliefContradiction = {
  id: string;
  source: string;
  summary: string;
  confidence: PIEBeliefConfidence;
};

export type PIEBeliefAssumption = {
  id: string;
  assumption: string;
  whyItMatters: string;
  confidence: PIEBeliefConfidence;
};

export type PIEBeliefUncertainty = {
  id: string;
  uncertainty: string;
  recommendedEvidence: string;
  severity: 'low' | 'medium' | 'high';
};

export type PIEBeliefRevision = {
  id: string;
  previousStatus: PIEBeliefStatus;
  nextStatus: PIEBeliefStatus;
  reason: string;
  evidenceIds: string[];
  changedAt: string;
};

export type PIEBeliefHistory = {
  createdAt: string;
  lastRevisedAt: string;
  revisions: PIEBeliefRevision[];
};

export type PIEBeliefExplanation = {
  summary: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  weakestAssumption: string;
  readinessReason: string;
};

export type PIEBelief = {
  id: string;
  type: PIEBeliefType;
  statement: string;
  status: PIEBeliefStatus;
  confidence: PIEBeliefConfidence;
  readiness: PIEBeliefReadiness;
  supportingEvidence: PIEBeliefEvidence[];
  contradictingEvidence: PIEBeliefContradiction[];
  assumptions: PIEBeliefAssumption[];
  uncertainty: PIEBeliefUncertainty[];
  recommendedEvidence: string[];
  explanation: PIEBeliefExplanation;
  history: PIEBeliefHistory;
};

export type PIEBeliefChange = {
  id: string;
  beliefId: string;
  change: 'formed' | 'strengthened' | 'weakened' | 'challenged' | 'contradicted' | 'retired';
  reason: string;
  previousStatus: PIEBeliefStatus | null;
  nextStatus: PIEBeliefStatus;
  confidence: PIEBeliefConfidence;
};

export type PIEBeliefEngineInput = {
  runtime: PIERuntimeState;
  scientificResult?: PIEScientificResult | null;
  patternIntelligence?: PIEPatternIntelligence | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  reflectionBeliefChanges?: PIEReflectionBeliefChange[];
  reflectionLessons?: PIELessonLearned[];
  learningResult?: PIELearningResult | null;
  evidenceQuality?: PIEEvidenceQualityResult | null;
  evidenceTimeline?: PIEEvidenceTimeline | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
  previousBeliefs?: PIEBelief[];
  generatedAt?: string;
};

export type PIEBeliefEngineResult = {
  generatedAt: string;
  beliefs: PIEBelief[];
  beliefChanges: PIEBeliefChange[];
  strongestBeliefs: PIEBelief[];
  challengedBeliefs: PIEBelief[];
  beliefsNeedingVerification: PIEBelief[];
  beliefReadiness: PIEBeliefReadiness;
  beliefExplanations: PIEBeliefExplanation[];
  summary: string;
  confidence: PIEBeliefConfidence;
};

export function buildPIEBeliefs(input: PIEBeliefEngineInput): PIEBeliefEngineResult {
  const generatedAt = input.generatedAt || input.runtime.generatedAt || new Date().toISOString();
  const formed = formBeliefsFromEvidence({ ...input, generatedAt });
  const revisedCurrent = reviseBeliefs(formed, { ...input, generatedAt });
  // Audit P1-13: prior belief state drives lifecycle — history carries
  // forward, and beliefs that vanished from current evidence are retired
  // explicitly rather than silently forgotten.
  const revised = applyPreviousBeliefLifecycle(
    revisedCurrent,
    input.previousBeliefs || [],
    generatedAt,
  );
  const beliefChanges = summarizeBeliefChanges(formed, revised);
  // Retired beliefs stay visible for lifecycle history but must not drive
  // readiness, verification demands, or confidence (audit P1-13).
  const active = revised.filter(belief => belief.status !== 'retired');
  const strongestBeliefs = active.filter(belief =>
    belief.status === 'supported' ||
    belief.status === 'strengthened',
  );
  const challengedBeliefs = active.filter(belief =>
    belief.status === 'challenged' ||
    belief.status === 'contradicted' ||
    belief.status === 'weakened',
  );
  const beliefsNeedingVerification = active.filter(belief =>
    belief.readiness !== 'Ready' ||
    belief.status === 'needs_verification',
  );

  return {
    generatedAt,
    beliefs: revised,
    beliefChanges,
    strongestBeliefs,
    challengedBeliefs,
    beliefsNeedingVerification,
    beliefReadiness: calculateOverallBeliefReadiness(active),
    beliefExplanations: revised.map(explainBelief),
    summary: summarizeBeliefs(active, beliefsNeedingVerification),
    confidence: confidenceFromBeliefs(active),
  };
}

export function formBeliefsFromEvidence(
  input: PIEBeliefEngineInput & { generatedAt?: string },
): PIEBelief[] {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const runtimeBeliefs = input.runtime.currentBeliefs.slice(0, 6).map((belief, index) => {
    const supportingEvidence = identifySupportingEvidence(input, belief.statement);
    const contradictingEvidence = identifyContradictingEvidence(input, belief.statement);
    return buildBelief({
      id: `belief-runtime-${belief.id || index}`,
      statement: belief.statement,
      type: inferBeliefType(belief.statement),
      supportingEvidence,
      contradictingEvidence,
      assumptions: [{
        id: `assumption-runtime-${index}`,
        assumption: 'Runtime belief reflects the current project state.',
        whyItMatters: 'DAVE should not treat old evidence as final truth.',
        confidence: belief.confidence,
      }],
      uncertainty: belief.remainingUncertainty.map((uncertainty, uncertaintyIndex) => ({
        id: `uncertainty-runtime-${index}-${uncertaintyIndex}`,
        uncertainty,
        recommendedEvidence: input.runtime.recommendedEvidence[uncertaintyIndex] || 'Collect current evidence.',
        severity: belief.confidence === 'low' ? 'high' : 'medium',
      })),
      confidence: belief.confidence,
      generatedAt,
    });
  });
  const hypothesisBeliefs = (input.scientificResult?.hypotheses || []).map((hypothesis, index) =>
    beliefFromHypothesis(input, hypothesis, input.scientificResult?.challenges[index], generatedAt),
  );
  const selectedDecisionBelief = input.scientificResult?.selectedDecision
    ? buildBelief({
        id: 'belief-selected-decision',
        statement: `DAVE selected decision: ${input.scientificResult.selectedDecision.selectedAction}`,
        type: 'decision',
        supportingEvidence: [{
          id: 'belief-support-selected-decision',
          source: 'Scientific Method selectedDecision',
          summary: input.scientificResult.selectedDecision.reason,
          confidence: input.scientificResult.selectedDecision.confidence,
        }],
        contradictingEvidence: [],
        assumptions: [{
          id: 'belief-assumption-selected-decision',
          assumption: 'The selectedDecision is based on the best current evidence.',
          whyItMatters: 'If the selected decision is based on weak evidence, DAVE should ask for verification.',
          confidence: input.scientificResult.selectedDecision.confidence,
        }],
        uncertainty: input.scientificResult.uncertainty.slice(0, 2).map((item, index) => ({
          id: `belief-uncertainty-selected-decision-${index}`,
          uncertainty: item.uncertainty,
          recommendedEvidence: input.scientificResult?.recommendedNextEvidence[index] || item.whyItMatters,
          severity: item.severity,
        })),
        confidence: input.scientificResult.selectedDecision.confidence,
        generatedAt,
      })
    : null;

  return [...runtimeBeliefs, ...hypothesisBeliefs, selectedDecisionBelief]
    .filter((belief): belief is PIEBelief => Boolean(belief))
    .slice(0, 12);
}

/**
 * Audit P1-13: connects the current belief set to the previous session's
 * beliefs. Matching beliefs keep their original createdAt and accumulated
 * revision history; previous beliefs with no current counterpart are
 * retired explicitly and kept (bounded) so the lifecycle is visible.
 */
export function applyPreviousBeliefLifecycle(
  current: PIEBelief[],
  previousBeliefs: PIEBelief[],
  generatedAt: string,
): PIEBelief[] {
  if (previousBeliefs.length === 0) return current;

  const withHistory = current.map(belief => {
    const previous = previousBeliefs.find(item =>
      item.id === belief.id || item.statement === belief.statement,
    );
    if (!previous) return belief;
    return {
      ...belief,
      history: {
        createdAt: previous.history.createdAt,
        lastRevisedAt: belief.history.lastRevisedAt,
        revisions: [
          ...previous.history.revisions,
          ...belief.history.revisions,
        ].slice(-10),
      },
    };
  });

  const currentIds = new Set(withHistory.map(belief => belief.id));
  const currentStatements = new Set(withHistory.map(belief => belief.statement));
  const retired = previousBeliefs
    .filter(previous =>
      previous.status !== 'retired' &&
      !currentIds.has(previous.id) &&
      !currentStatements.has(previous.statement),
    )
    .slice(0, 4)
    .map(previous => retireBelief(
      previous,
      'No current evidence re-forms this belief.',
      generatedAt,
    ));

  return [...withHistory, ...retired];
}

export function reviseBeliefs(
  beliefs: PIEBelief[],
  input: PIEBeliefEngineInput & { generatedAt?: string },
): PIEBelief[] {
  return beliefs.map(belief => {
    const reflectionChange = input.reflectionBeliefChanges?.find(change =>
      textsOverlap(change.previousBelief, belief.statement) ||
      textsOverlap(change.updatedBelief, belief.statement),
    );
    const memoryCorrection = input.memoryRecall?.pastCorrections.find(correction =>
      textsOverlap(correction.summary, belief.statement),
    );
    const patternWarning = input.patternIntelligence?.earlyWarnings.find(warning =>
      textsOverlap(warning.warning, belief.statement) ||
      warning.patternType === patternTypeForBelief(belief.type),
    );
    const learningBeliefUpdate = input.learningResult?.beliefUpdates.find(update =>
      textsOverlap(update.belief, belief.statement),
    );
    const learningCalibration = input.learningResult?.confidenceCalibration.find(item =>
      item.adjustment === 'lower' &&
      textsOverlap(item.reason, belief.statement),
    );

    if (reflectionChange?.direction === 'strengthened') {
      return strengthenBelief(belief, reflectionChange.reason, input.generatedAt);
    }

    if (
      reflectionChange?.direction === 'weakened' ||
      memoryCorrection ||
      patternWarning ||
      learningBeliefUpdate?.confidenceChange === 'decrease' ||
      learningCalibration
    ) {
      return weakenBelief(
        belief,
        reflectionChange?.reason ||
          memoryCorrection?.summary ||
          patternWarning?.warning ||
          learningBeliefUpdate?.reason ||
          learningCalibration?.reason ||
          'Historical context weakened this belief.',
        input.generatedAt,
      );
    }

    if (learningBeliefUpdate?.confidenceChange === 'increase' && belief.readiness === 'Ready') {
      return strengthenBelief(belief, learningBeliefUpdate.reason, input.generatedAt);
    }

    if (belief.contradictingEvidence.length > 0) {
      return {
        ...weakenBelief(belief, 'Contradicting evidence exists.', input.generatedAt),
        status: 'contradicted',
        readiness: 'Needs Verification',
      };
    }

    if (belief.supportingEvidence.length >= 2 && belief.readiness === 'Ready') {
      return strengthenBelief(belief, 'Multiple evidence sources support this belief.', input.generatedAt);
    }

    return belief;
  });
}

export function strengthenBelief(
  belief: PIEBelief,
  reason: string,
  changedAt: string = new Date().toISOString(),
): PIEBelief {
  return reviseBeliefStatus(belief, 'strengthened', reason, changedAt);
}

export function weakenBelief(
  belief: PIEBelief,
  reason: string,
  changedAt: string = new Date().toISOString(),
): PIEBelief {
  return reviseBeliefStatus(belief, 'weakened', reason, changedAt);
}

export function retireBelief(
  belief: PIEBelief,
  reason: string,
  changedAt: string = new Date().toISOString(),
): PIEBelief {
  return reviseBeliefStatus(belief, 'retired', reason, changedAt);
}

export function identifySupportingEvidence(
  input: PIEBeliefEngineInput,
  statement: string,
): PIEBeliefEvidence[] {
  // Audit P1-13: evidence may support a belief only when it is about the
  // belief's subject. Generic runtime signals no longer attach to every
  // belief (a parking-lot photo must not strengthen an electrical belief).
  return [
    input.runtime.intelligentSummary.whatChanged &&
    textsOverlap(input.runtime.intelligentSummary.whatChanged, statement)
      ? {
          id: 'belief-support-runtime-change',
          source: 'Runtime',
          summary: input.runtime.intelligentSummary.whatChanged,
          confidence: input.runtime.intelligentSummary.confidence,
        }
      : null,
    input.runtime.evidenceFusionSummary.summary &&
    textsOverlap(input.runtime.evidenceFusionSummary.summary, statement)
      ? {
          id: 'belief-support-evidence-fusion',
          source: 'Evidence Fusion',
          summary: input.runtime.evidenceFusionSummary.summary,
          confidence: input.runtime.evidenceFusionSummary.confidence,
        }
      : null,
    input.evidenceQuality?.strongEvidence[0] &&
    textsOverlap(input.evidenceQuality.strongEvidence[0].evidence.summary, statement)
      ? {
          id: 'belief-support-evidence-quality',
          source: 'Evidence Quality',
          summary: `Strong evidence ranked first: ${input.evidenceQuality.strongEvidence[0].evidence.summary}`,
          confidence: input.evidenceQuality.strongEvidence[0].score.confidence,
        }
      : null,
    input.evidenceTimeline?.recentChanges[0] &&
    textsOverlap(input.evidenceTimeline.recentChanges[0].summary, statement)
      ? {
          id: 'belief-support-evidence-timeline',
          source: 'Evidence Timeline',
          summary: `Recent change: ${input.evidenceTimeline.recentChanges[0].summary}`,
          confidence: input.evidenceTimeline.recentChanges[0].confidence,
        }
      : null,
    input.realityModel?.objects.find(object =>
      (object.currentStatus === 'ready' || object.currentStatus === 'complete') &&
      textsOverlap(object.name, statement))
      ? {
          id: 'belief-support-reality-model',
          source: 'Reality Model',
          summary: `Reality object supports current understanding: ${input.realityModel.objects.find(object =>
            (object.currentStatus === 'ready' || object.currentStatus === 'complete') &&
            textsOverlap(object.name, statement))?.name}`,
          confidence: input.realityModel.summary.confidence,
        }
      : null,
    input.objectIntelligence?.objectsReady[0] &&
    textsOverlap(input.objectIntelligence.objectsReady[0].name, statement)
      ? {
          id: 'belief-support-object-intelligence',
          source: 'Object Intelligence',
          summary: `Ready object: ${input.objectIntelligence.objectsReady[0].name}`,
          confidence: input.objectIntelligence.objectsReady[0].intelligence.confidence.level,
        }
      : null,
    ...((input.scientificResult?.hypotheses || [])
      .filter(hypothesis => textsOverlap(hypothesis.statement, statement))
      .flatMap((hypothesis, index) =>
        hypothesis.supportingEvidence.map((summary, evidenceIndex) => ({
          id: `belief-support-hypothesis-${index}-${evidenceIndex}`,
          source: 'Scientific Method',
          summary,
          confidence: hypothesis.confidence,
        })),
      )),
    ...((input.patternIntelligence?.patternMatches || [])
      .filter(match => textsOverlap(match.pattern.summary, statement))
      .slice(0, 2)
      .map((match, index) => ({
        id: `belief-support-pattern-${index}`,
        source: 'Pattern Intelligence',
        summary: match.explanation,
        confidence: match.confidence,
      }))),
    ...((input.memoryRecall?.memories || [])
      .filter(memory => textsOverlap(memory.summary, statement))
      .slice(0, 2)
      .map((memory, index) => ({
        id: `belief-support-memory-${index}`,
        source: 'Memory Recall',
        summary: memory.summary,
        confidence: memory.confidence,
      }))),
  ].filter((item): item is PIEBeliefEvidence => Boolean(item));
}

export function identifyContradictingEvidence(
  input: PIEBeliefEngineInput,
  statement: string,
): PIEBeliefContradiction[] {
  // Audit P1-13: a contradiction must be about this belief's subject.
  return [
    ...input.runtime.evidenceConflicts
      .filter(conflict => textsOverlap(conflict.summary, statement))
      .map((conflict, index) => ({
      id: `belief-contradiction-conflict-${index}`,
      source: 'Evidence Fusion',
      summary: conflict.summary,
      confidence: conflict.confidence,
    })),
    ...((input.evidenceTimeline?.staleAreas || [])
      .filter(gap => textsOverlap(gap.summary, statement))
      .slice(0, 2)
      .map((gap, index) => ({
        id: `belief-contradiction-timeline-stale-${index}`,
        source: 'Evidence Timeline',
        summary: gap.summary,
        confidence: gap.severity === 'high'
          ? 'high' as PIEBeliefConfidence
          : 'medium' as PIEBeliefConfidence,
      }))),
    ...((input.realityModel?.objects || [])
      .filter(object =>
        (object.currentStatus === 'blocked' ||
          object.currentStatus === 'at_risk' ||
          object.currentStatus === 'needs_verification') &&
        textsOverlap(object.name, statement),
      )
      .slice(0, 3)
      .map((object, index) => ({
        id: `belief-contradiction-reality-${index}`,
        source: 'Reality Model',
        summary: `${object.name}: ${object.currentState.summary}`,
        confidence: object.currentState.confidence,
      }))),
    ...((input.objectIntelligence?.objectsWithHighRisk || [])
      .filter(object => textsOverlap(object.name, statement))
      .slice(0, 2)
      .map((object, index) => ({
        id: `belief-contradiction-object-intelligence-${index}`,
        source: 'Object Intelligence',
        summary: `${object.name}: ${object.intelligence.summary}`,
        confidence: object.intelligence.confidence.level,
      }))),
    ...((input.scientificResult?.challenges || [])
      .filter(challenge => textsOverlap(challenge.whatCouldMakePIEWrong, statement))
      .slice(0, 3)
      .map((challenge, index) => ({
        id: `belief-contradiction-challenge-${index}`,
        source: 'Scientific Method',
        summary: challenge.whatCouldMakePIEWrong,
        confidence: 'medium' as PIEBeliefConfidence,
      }))),
    ...((input.patternIntelligence?.earlyWarnings || [])
      .filter(warning => textsOverlap(warning.warning, statement))
      .map((warning, index) => ({
        id: `belief-contradiction-pattern-${index}`,
        source: 'Pattern Intelligence',
        summary: warning.warning,
        confidence: warning.confidence,
      }))),
  ];
}

export function identifyWeakestAssumption(belief: PIEBelief): PIEBeliefAssumption {
  return belief.assumptions.sort((left, right) =>
    confidenceRank(left.confidence) - confidenceRank(right.confidence),
  )[0] || {
    id: 'assumption-default',
    assumption: 'Current evidence is complete enough to rely on.',
    whyItMatters: 'If evidence is incomplete, DAVE should verify before recommending action.',
    confidence: 'low',
  };
}

export function calculateBeliefReadiness(belief: Pick<PIEBelief, 'supportingEvidence' | 'contradictingEvidence' | 'uncertainty' | 'confidence' | 'status'>): PIEBeliefReadiness {
  if (belief.status === 'retired') return 'Blocked';
  if (belief.contradictingEvidence.length > 0) return 'Needs Verification';
  if (belief.uncertainty.some(item => item.severity === 'high')) return 'Needs Verification';
  if (belief.supportingEvidence.length >= 2 && belief.confidence === 'high') return 'Ready';
  if (belief.confidence === 'low') return 'Uncertain';
  return 'Needs Verification';
}

export function explainBelief(belief: PIEBelief): PIEBeliefExplanation {
  const weakestAssumption = identifyWeakestAssumption(belief);
  return {
    summary: `${belief.statement} is ${belief.status} and ${belief.readiness}.`,
    supportingEvidence: belief.supportingEvidence.map(item => item.summary),
    contradictingEvidence: belief.contradictingEvidence.map(item => item.summary),
    weakestAssumption: weakestAssumption.assumption,
    readinessReason: belief.readiness === 'Ready'
      ? 'Enough evidence supports the belief for DAVE to use it carefully.'
      : belief.uncertainty[0]?.recommendedEvidence || 'More evidence is needed before DAVE relies on this belief.',
  };
}

export function compareBeliefs(previous: PIEBelief, next: PIEBelief): PIEBeliefChange {
  const change =
    next.status === 'retired'
      ? 'retired'
      : next.status === 'strengthened'
        ? 'strengthened'
        : next.status === 'weakened'
          ? 'weakened'
          : next.status === 'contradicted'
            ? 'contradicted'
            : next.status === 'challenged'
              ? 'challenged'
              : 'formed';

  return {
    id: `belief-change-${next.id}`,
    beliefId: next.id,
    change,
    reason: next.history.revisions[0]?.reason || next.explanation.readinessReason,
    previousStatus: previous.status,
    nextStatus: next.status,
    confidence: next.confidence,
  };
}

export function summarizeBeliefChanges(
  previousBeliefs: PIEBelief[],
  nextBeliefs: PIEBelief[],
): PIEBeliefChange[] {
  return nextBeliefs.map(next => {
    const previous = previousBeliefs.find(item => item.id === next.id);
    if (!previous) {
      return {
        id: `belief-change-${next.id}`,
        beliefId: next.id,
        change: 'formed',
        reason: 'DAVE formed this belief from current evidence.',
        previousStatus: null,
        nextStatus: next.status,
        confidence: next.confidence,
      };
    }
    return compareBeliefs(previous, next);
  });
}

function buildBelief({
  id,
  statement,
  type,
  supportingEvidence,
  contradictingEvidence,
  assumptions,
  uncertainty,
  confidence,
  generatedAt,
}: {
  id: string;
  statement: string;
  type: PIEBeliefType;
  supportingEvidence: PIEBeliefEvidence[];
  contradictingEvidence: PIEBeliefContradiction[];
  assumptions: PIEBeliefAssumption[];
  uncertainty: PIEBeliefUncertainty[];
  confidence: PIEBeliefConfidence;
  generatedAt: string;
}): PIEBelief {
  const base = {
    supportingEvidence,
    contradictingEvidence,
    uncertainty,
    confidence,
    status: contradictingEvidence.length > 0 ? 'challenged' as const : 'forming' as const,
  };
  const readiness = calculateBeliefReadiness(base);
  const status: PIEBeliefStatus =
    readiness === 'Ready'
      ? 'supported'
      : contradictingEvidence.length > 0
        ? 'challenged'
        : 'needs_verification';
  const belief: PIEBelief = {
    id,
    type,
    statement,
    status,
    confidence,
    readiness,
    supportingEvidence,
    contradictingEvidence,
    assumptions,
    uncertainty,
    recommendedEvidence: uncertainty.map(item => item.recommendedEvidence),
    explanation: {
      summary: '',
      supportingEvidence: [],
      contradictingEvidence: [],
      weakestAssumption: '',
      readinessReason: '',
    },
    history: {
      createdAt: generatedAt,
      lastRevisedAt: generatedAt,
      revisions: [],
    },
  };
  return {
    ...belief,
    explanation: explainBelief(belief),
  };
}

function beliefFromHypothesis(
  input: PIEBeliefEngineInput,
  hypothesis: PIEScientificHypothesis,
  challenge: PIEScientificChallenge | undefined,
  generatedAt: string,
): PIEBelief {
  return buildBelief({
    id: `belief-hypothesis-${hypothesis.id}`,
    statement: hypothesis.statement,
    type: inferBeliefType(hypothesis.statement),
    supportingEvidence: hypothesis.supportingEvidence.map((summary, index) => ({
      id: `belief-support-${hypothesis.id}-${index}`,
      source: 'Scientific Method Hypothesis',
      summary,
      confidence: hypothesis.confidence,
    })),
    contradictingEvidence: [
      ...hypothesis.contradictingEvidence.map((summary, index) => ({
        id: `belief-contradiction-${hypothesis.id}-${index}`,
        source: 'Scientific Method Hypothesis',
        summary,
        confidence: hypothesis.confidence,
      })),
      ...(challenge && challenge.whatCouldMakePIEWrong !== 'No direct contradiction surfaced yet.'
        ? [{
            id: `belief-contradiction-${hypothesis.id}-challenge`,
            source: 'Scientific Method Challenge',
            summary: challenge.whatCouldMakePIEWrong,
            confidence: 'medium' as PIEBeliefConfidence,
          }]
        : []),
    ],
    assumptions: [{
      id: `belief-assumption-${hypothesis.id}`,
      assumption: challenge?.weakestAssumption || 'The hypothesis is supported by current evidence.',
      whyItMatters: 'A weak assumption can make a belief unreliable.',
      confidence: hypothesis.confidence,
    }],
    uncertainty: [{
      id: `belief-uncertainty-${hypothesis.id}`,
      uncertainty: challenge?.whatCouldMakePIEWrong || hypothesis.testNeeded,
      recommendedEvidence:
        challenge?.whatShouldBeVerifiedFirst ||
        input.scientificResult?.recommendedNextEvidence[0] ||
        hypothesis.testNeeded,
      severity: hypothesis.readiness === 'Ready' ? 'low' : 'medium',
    }],
    confidence: hypothesis.confidence,
    generatedAt,
  });
}

function reviseBeliefStatus(
  belief: PIEBelief,
  status: PIEBeliefStatus,
  reason: string,
  changedAt: string,
): PIEBelief {
  const next = {
    ...belief,
    status,
    readiness: status === 'strengthened'
      ? calculateBeliefReadiness({ ...belief, status: 'supported' })
      : status === 'retired'
        ? 'Blocked' as const
        : 'Needs Verification' as const,
    history: {
      ...belief.history,
      lastRevisedAt: changedAt,
      revisions: [
        {
          id: `revision-${belief.id}-${belief.history.revisions.length + 1}`,
          previousStatus: belief.status,
          nextStatus: status,
          reason,
          evidenceIds: [
            ...belief.supportingEvidence.map(item => item.id),
            ...belief.contradictingEvidence.map(item => item.id),
          ],
          changedAt,
        },
        ...belief.history.revisions,
      ],
    },
  };

  return {
    ...next,
    explanation: explainBelief(next),
  };
}

function inferBeliefType(statement: string): PIEBeliefType {
  const value = statement.toLowerCase();
  if (/schedule|overdue|due|late/.test(value)) return 'schedule';
  if (/safety|hazard|unsafe/.test(value)) return 'safety';
  if (/quality|rework|defect/.test(value)) return 'quality';
  if (/inspect|inspection|permit/.test(value)) return 'inspection';
  if (/contractor|crew|manpower/.test(value)) return 'contractor';
  if (/decision|approve|approval/.test(value)) return 'decision';
  if (/communicat|report|email|follow/.test(value)) return 'communication';
  if (/missing|unknown|evidence|verify/.test(value)) return 'evidence_gap';
  if (/location|area|gps|project/.test(value)) return 'location';
  if (/issue|block|risk/.test(value)) return 'risk';
  if (parseDAVEAssertions(value).assertions.some(assertion =>
    assertion.predicate === 'complete'
  )) return 'completion';
  if (/ready|readiness/.test(value)) return 'readiness';
  return 'progress';
}

function patternTypeForBelief(type: PIEBeliefType) {
  if (type === 'schedule') return 'schedule_slippage';
  if (type === 'safety') return 'recurring_safety_issue';
  if (type === 'inspection') return 'inspection_risk';
  if (type === 'quality') return 'quality_concern';
  if (type === 'contractor') return 'contractor_slowdown';
  if (type === 'communication') return 'communication_gap';
  if (type === 'evidence_gap') return 'missing_evidence';
  return null;
}

function textsOverlap(left: string, right: string) {
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  return leftTerms.some(term => rightTerms.includes(term));
}

const NON_SUBJECT_TERMS = new Set([
  'blocked',
  'complete',
  'completed',
  'current',
  'evidence',
  'finished',
  'issue',
  'pending',
  'progress',
  'project',
  'ready',
  'reported',
  'schedule',
  'status',
  'support',
  'supported',
  'update',
  'verified',
  'work',
]);

function terms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 4 && !NON_SUBJECT_TERMS.has(term));
}

function calculateOverallBeliefReadiness(beliefs: PIEBelief[]): PIEBeliefReadiness {
  if (beliefs.some(belief => belief.readiness === 'Blocked')) return 'Blocked';
  if (beliefs.some(belief => belief.readiness === 'Uncertain')) return 'Uncertain';
  if (beliefs.some(belief => belief.readiness === 'Needs Verification')) return 'Needs Verification';
  return 'Ready';
}

function confidenceFromBeliefs(beliefs: PIEBelief[]): PIEBeliefConfidence {
  if (beliefs.some(belief => belief.confidence === 'high' && belief.readiness === 'Ready')) return 'high';
  if (beliefs.some(belief => belief.confidence === 'medium')) return 'medium';
  return beliefs.length > 0 ? beliefs[0].confidence : 'low';
}

function summarizeBeliefs(
  beliefs: PIEBelief[],
  beliefsNeedingVerification: PIEBelief[],
) {
  if (beliefs.length === 0) return 'DAVE has not formed enough beliefs yet.';
  if (beliefsNeedingVerification.length > 0) {
    return `${beliefs.length} beliefs formed. ${beliefsNeedingVerification.length} need verification before DAVE should rely on them.`;
  }
  return `${beliefs.length} beliefs formed and ready to support recommendations.`;
}

function confidenceRank(confidence: PIEBeliefConfidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}
