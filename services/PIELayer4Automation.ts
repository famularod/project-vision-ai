import type { PIEReportDraft } from './PIEReporter';
import {
  requirePersistedExecutiveJudgment,
  type PIEExecutiveJudgmentRecord,
} from './PIEExecutiveJudgmentRepository';
import {
  buildActualOutcomeRecord,
  buildOutcomePlan,
  buildPredictedOutcome,
  createDecisionRecord,
  transitionDecisionStatus,
  type PIEActor,
  type PIEAutomationAuditDetail,
  type PIEAutomationLevel,
  type PIEDecisionRecord,
  type PIEEvidenceReference,
  type PIEImplementationQuality,
  type PIEOutcomeClassification,
  type PIEOutcomePlan,
  type PIEPredictedOutcome,
} from './PIEDecisionLedger';

export type PIELayer4AutomationImpact =
  | 'low'
  | 'moderate'
  | 'high';

export type PIELayer4DecisionTrigger =
  | 'selected_course_of_action'
  | 'risk_response'
  | 'escalation'
  | 'approved_change'
  | 'owner_assignment'
  | 'schedule_or_cost_commitment'
  | 'compliance_or_safety_response'
  | 'corrective_action'
  | 'predicted_outcome'
  | 'informational';

export type PIELayer4AutomationPolicyInput = {
  confidence: 'low' | 'medium' | 'high';
  evidenceSufficient: boolean;
  reversible: boolean;
  impact: PIELayer4AutomationImpact;
  authorityRequired: boolean;
  evidenceConflicts: boolean;
  projectRecordMateriallyChanges?: boolean;
};

export type PIELayer4AutomationPolicyResult = {
  level: PIEAutomationLevel;
  reason: string;
  humanReviewAvailable: boolean;
};

export type PIELayer4DecisionCandidateResult = {
  created: boolean;
  skippedReason?: string;
  duplicateDecisionId?: string;
  decision?: PIEDecisionRecord;
  explanation: string;
};

export type PIELayer4AutomationException = {
  id: string;
  message: string;
  action:
    | 'approve'
    | 'reject'
    | 'correct'
    | 'confirm_implementation'
    | 'resolve_conflict'
    | 'validate_high_impact_outcome'
    | 'provide_missing_evidence';
  reason: string;
};

export type PIELayer4AutomationAction = {
  id: string;
  actionTaken: string;
  triggeringEvent: string;
  evidenceUsed: PIEEvidenceReference[];
  confidence: 'low' | 'medium' | 'high';
  automationLevel: PIEAutomationLevel;
  reasonHumanApprovalWasOrWasNotRequired: string;
  correctionAvailable: boolean;
  reversible: boolean;
  timestamp: string;
};

export type PIELayer4AutomationReview = {
  decision: PIEDecisionRecord | null;
  detected: string[];
  automaticActions: PIELayer4AutomationAction[];
  exceptions: PIELayer4AutomationException[];
  linkedEvidence: PIEEvidenceReference[];
  conciseExplanation: string;
};

export type PIELayer4DecisionCandidateInput = {
  report: PIEReportDraft;
  existingDecisions: PIEDecisionRecord[];
  organizationId: string;
  projectId: string;
  actor: PIEActor;
  evidence: PIEEvidenceReference[];
  now?: string;
};

export type PIELayer4JudgmentDecisionCandidateInput = {
  judgment: PIEExecutiveJudgmentRecord;
  existingDecisions: PIEDecisionRecord[];
  actor: PIEActor;
  evidence: PIEEvidenceReference[];
  now?: string;
};

export type PIELayer4LifecycleAutomationInput = {
  decision: PIEDecisionRecord;
  actor: PIEActor;
  evidence: PIEEvidenceReference[];
  now?: string;
};

const HIGH_AUTHORITY_PATTERN =
  /safety|compliance|legal|capital|cost|personnel|irreversible|policy|escalat/i;
const DECISION_PATTERN =
  /approve|approved|assign|owner|decision|recommend|corrective|escalat|risk|mitigat|commit|schedule|cost|safety|compliance|change|implement|resolve/i;
const IMPLEMENTATION_PATTERN =
  /implemented|complete|completed|installed|resolved|closed|finished|started|began/i;
const OUTCOME_PATTERN =
  /verified|confirmed|passed|failed|resolved|complete|completed|not achieved|partially/i;

export function classifyLayer4AutomationPolicy(
  input: PIELayer4AutomationPolicyInput,
): PIELayer4AutomationPolicyResult {
  if (
    input.confidence === 'low' ||
    input.evidenceConflicts ||
    input.authorityRequired ||
    input.impact === 'high'
  ) {
    return {
      level: 'human_decision_required',
      reason: 'Human authority is required because impact, conflict, confidence, or authority boundaries make automation unsafe.',
      humanReviewAvailable: true,
    };
  }

  if (
    input.confidence === 'medium' ||
    !input.evidenceSufficient ||
    input.projectRecordMateriallyChanges ||
    input.impact === 'moderate'
  ) {
    return {
      level: 'confirmation_required',
      reason: 'DAVE can prepare the action, but confirmation is needed before materially changing the decision record.',
      humanReviewAvailable: true,
    };
  }

  return {
    level: 'automatic',
    reason: 'Evidence is sufficient, confidence is high, impact is low, and no authority approval is required.',
    humanReviewAvailable: true,
  };
}

export function detectLayer4DecisionTrigger(report: PIEReportDraft): PIELayer4DecisionTrigger {
  const combined = [
    report.title,
    report.body,
    ...report.executiveSummary,
    ...report.actionItems.map(item => `${item.owner} ${item.action}`),
    ...report.risks.map(item => item.summary),
    ...report.decisionsNeeded.map(item => `${item.owner} ${item.question}`),
  ].join(' ');

  if (report.decisionsNeeded.length > 0 || report.actionItems.length > 0) return 'selected_course_of_action';
  if (/escalat/i.test(combined)) return 'escalation';
  if (/risk|mitigat/i.test(combined)) return 'risk_response';
  if (/owner|assign/i.test(combined)) return 'owner_assignment';
  if (/schedule|cost|commit/i.test(combined)) return 'schedule_or_cost_commitment';
  if (/safety|compliance/i.test(combined)) return 'compliance_or_safety_response';
  if (/corrective|resolve/i.test(combined)) return 'corrective_action';
  if (DECISION_PATTERN.test(combined)) return 'predicted_outcome';
  return 'informational';
}

export function isMeaningfulLayer4Decision(report: PIEReportDraft): boolean {
  if (report.confidence === 'low') return false;
  if (report.needsReview && report.reviewFlags.length > 2) return false;
  const trigger = detectLayer4DecisionTrigger(report);
  return trigger !== 'informational';
}

export function buildLayer4DecisionCandidate(input: PIELayer4DecisionCandidateInput): PIELayer4DecisionCandidateResult {
  void input;
  throw new Error('Layer 4 cannot create live decision candidates from report-only input. Use buildLayer4DecisionCandidateFromExecutiveJudgment.');
}

export function buildLayer4DecisionCandidateFromExecutiveJudgment(
  input: PIELayer4JudgmentDecisionCandidateInput,
): PIELayer4DecisionCandidateResult {
  const judgment = requirePersistedExecutiveJudgment(input.judgment);
  assertEvidenceWithinBoundary(input.evidence, {
    organizationId: judgment.organizationId,
    projectId: judgment.projectId,
  });
  if (
    judgment.persistenceStatus === 'persistence_failed' ||
    judgment.persistenceStatus === 'stale_model' ||
    judgment.persistenceStatus === 'conflict_blocked' ||
    judgment.persistenceStatus === 'blocked_identity' ||
    judgment.persistenceStatus === 'blocked_organization'
  ) {
    throw new Error(`Layer 4 high-impact automation is blocked because Reality authority is ${judgment.persistenceStatus}.`);
  }
  const now = input.now || new Date().toISOString();
  const duplicate = input.existingDecisions.find(decision =>
    decision.immutableSnapshot.recommendationId === judgment.id ||
    decision.immutableSnapshot.selectedOption === judgment.primaryRecommendation,
  );
  if (duplicate) {
    return {
      created: false,
      duplicateDecisionId: duplicate.id,
      decision: duplicate,
      explanation: 'DAVE found an existing decision candidate for this persisted Executive Judgment.',
    };
  }

  const evidence = collectRelevantOutcomeEvidence(input.evidence, {
    projectId: judgment.projectId,
    situationId: judgment.id,
    issueId: null,
    recommendationId: judgment.id,
    selectedOption: judgment.primaryRecommendation,
    decisionOwner: judgment.authorityRequirement,
    decisionAuthority: judgment.authorityRequirement,
    decisionDate: now,
    evidenceAvailable: input.evidence,
    knownEvidenceGaps: judgment.uncertainty,
    assumptions: judgment.conditionsThatWouldChangeRecommendation,
    risks: judgment.risks.map(risk => risk.risk),
    constraints: judgment.constraints.map(constraint => constraint.constraint),
    predictedOutcomes: [],
    recommendationConfidence: judgment.confidence,
    confidenceExplanation: judgment.priorityRationale,
    selectedReason: judgment.priorityRationale,
  }, {
    organizationId: judgment.organizationId,
    projectId: judgment.projectId,
  });
  const predictedOutcomes = judgment.conditionsThatWouldChangeRecommendation.length
    ? judgment.conditionsThatWouldChangeRecommendation.map((condition, index) => buildPredictedOutcome({
        id: `prediction-${judgment.id}-${index + 1}`,
        description: condition,
        measurableResult: condition,
        expectedDirection: 'verify',
        expectedReviewDate: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
        evidenceRequired: evidence.map(item => item.id).slice(0, 4),
        responsibleOwner: judgment.authorityRequirement || input.actor.name,
        validationAuthority: judgment.authorityRequirement || input.actor.name,
        predictionConfidence: judgment.confidence,
        rationale: judgment.priorityRationale,
      }))
    : [buildPredictedOutcome({
        id: `prediction-${judgment.id}-1`,
        description: judgment.primaryRecommendation,
        measurableResult: 'Project evidence verifies the recommendation outcome.',
        expectedDirection: 'verify',
        expectedReviewDate: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
        evidenceRequired: evidence.map(item => item.id).slice(0, 4),
        responsibleOwner: judgment.authorityRequirement || input.actor.name,
        validationAuthority: judgment.authorityRequirement || input.actor.name,
        predictionConfidence: judgment.confidence,
        rationale: judgment.priorityRationale,
      })];
  const decision = createDecisionRecord({
    id: `pie-judgment-decision-${stableHash(`${judgment.organizationId}:${judgment.projectId}:${judgment.id}`)}`,
    organizationId: judgment.organizationId,
    projectId: judgment.projectId,
    snapshot: {
      projectId: judgment.projectId,
      situationId: judgment.id,
      issueId: null,
      recommendationId: judgment.id,
      selectedOption: judgment.primaryRecommendation,
      decisionOwner: judgment.authorityRequirement || input.actor.name,
      decisionAuthority: judgment.authorityRequirement || input.actor.name,
      decisionDate: now,
      evidenceAvailable: evidence,
      knownEvidenceGaps: judgment.uncertainty,
      assumptions: judgment.conditionsThatWouldChangeRecommendation,
      risks: judgment.risks.map(risk => risk.risk),
      constraints: judgment.constraints.map(constraint => constraint.constraint),
      predictedOutcomes,
      recommendationConfidence: judgment.confidence,
      confidenceExplanation: judgment.priorityRationale,
      selectedReason: `Created from Executive Judgment ${judgment.id} using Reality Model ${judgment.realityModelId} v${judgment.realityModelVersion}.`,
    },
    createdBy: input.actor,
    createdAt: now,
  });

  return {
    created: true,
    decision,
    explanation: 'DAVE created a decision candidate from a persisted Executive Judgment and authoritative Reality Model snapshot.',
  };
}

export function buildDeprecatedReportOnlyLayer4DecisionCandidate(input: PIELayer4DecisionCandidateInput): PIELayer4DecisionCandidateResult {
  assertEvidenceWithinBoundary(input.evidence, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const now = input.now || new Date().toISOString();
  const trigger = detectLayer4DecisionTrigger(input.report);

  if (!isMeaningfulLayer4Decision(input.report)) {
    return {
      created: false,
      skippedReason: 'Report is informational, incomplete, low confidence, or still needs too much review.',
      explanation: 'DAVE did not create a decision candidate because this does not meet the meaningful-decision threshold.',
    };
  }

  const duplicate = findDuplicateLayer4Decision(input.report, input.existingDecisions);
  if (duplicate) {
    return {
      created: false,
      duplicateDecisionId: duplicate.id,
      decision: duplicate,
      explanation: 'DAVE found an existing decision candidate and avoided a duplicate.',
    };
  }

  const evidence = collectRelevantOutcomeEvidence(input.evidence, input.report, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const predictions = generatePredictedOutcomesFromReport(input.report, evidence, now, input.actor.name);
  const snapshot = {
    projectId: input.projectId,
    situationId: `layer4-${input.projectId}`,
    issueId: input.report.decisionsNeeded[0]?.id || input.report.risks[0]?.id || null,
    recommendationId: input.report.id,
    selectedOption: selectDecisionOption(input.report),
    decisionOwner: inferDecisionOwner(input.report, input.actor.name),
    decisionAuthority: inferDecisionAuthority(input.report, input.actor.name),
    decisionDate: now,
    evidenceAvailable: evidence,
    knownEvidenceGaps: input.report.reviewFlags,
    assumptions: buildDecisionAssumptions(input.report),
    risks: input.report.risks.length
      ? input.report.risks.map(risk => risk.summary)
      : ['DAVE must not treat implementation as outcome success without verification.'],
    constraints: buildDecisionConstraints(input.report),
    predictedOutcomes: predictions,
    recommendationConfidence: input.report.confidence,
    confidenceExplanation: input.report.reviewFlags[0] ||
      `DAVE confidence is ${input.report.confidence} based on current report evidence and review flags.`,
    selectedReason: input.report.executiveSummary[0] ||
      `DAVE detected a ${trigger.replace(/_/g, ' ')} that should be tracked through outcome review.`,
  };
  const decision = createDecisionRecord({
    id: `pie-auto-decision-${stableHash(`${input.organizationId}:${input.projectId}:${input.report.id}:${snapshot.selectedOption}`)}`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    snapshot,
    createdBy: input.actor,
    createdAt: now,
  });

  return {
    created: true,
    decision,
    explanation: 'DAVE created a decision candidate automatically from a meaningful Layer 3 recommendation.',
  };
}

export function buildAutomaticOutcomePlan(
  decision: PIEDecisionRecord,
  evidence: PIEEvidenceReference[],
  now: string = new Date().toISOString(),
): PIEOutcomePlan {
  const snapshot = decision.immutableSnapshot;
  const acceptedEvidence = Array.from(new Set(
    snapshot.predictedOutcomes.flatMap(outcome => outcome.evidenceRequired),
  ));
  const reviewDate = snapshot.predictedOutcomes[0]?.expectedReviewDate ||
    new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString();

  return buildOutcomePlan({
    id: `outcome-plan-${decision.id}`,
    checks: snapshot.predictedOutcomes.map(outcome => outcome.measurableResult),
    reviewDate,
    responsibleOwner: snapshot.decisionOwner || 'Decision owner',
    acceptedEvidence: acceptedEvidence.length ? acceptedEvidence : ['Project evidence that verifies the result'],
    evidenceReferences: collectRelevantOutcomeEvidence(evidence, decision.immutableSnapshot, decision),
    validationAuthority: snapshot.decisionAuthority || snapshot.decisionOwner || 'Validation authority',
    createdAt: now,
    updatedAt: now,
  });
}

export function collectRelevantOutcomeEvidence(
  evidence: PIEEvidenceReference[],
  context: PIEReportDraft | PIEDecisionRecord['immutableSnapshot'],
  boundary: Pick<PIEDecisionRecord, 'organizationId' | 'projectId'>,
): PIEEvidenceReference[] {
  const contextText = stringifyContext(context);
  if ('projectId' in context && context.projectId !== boundary.projectId) return [];
  const contextKeywords = new Set(keywords(contextText));
  const explicitEvidenceIds = explicitContextEvidenceIds(context);
  const matching = evidence.filter(item => {
    if (
      item.organizationId !== boundary.organizationId ||
      item.projectId !== boundary.projectId
    ) return false;
    if (explicitEvidenceIds.has(item.id)) return true;
    const sharedTerms = keywords(`${item.summary} ${item.sourceType}`)
      .filter(word => contextKeywords.has(word));
    return new Set(sharedTerms).size >= 2;
  });
  return dedupeEvidence(matching).slice(0, 8);
}

export function proposeImplementationQualityFromEvidence(
  decision: PIEDecisionRecord,
  evidence: PIEEvidenceReference[],
): {
  quality: PIEImplementationQuality;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  supportingEvidence: PIEEvidenceReference[];
} {
  const relevant = collectRelevantOutcomeEvidence(evidence, decision.immutableSnapshot, decision);
  const text = relevant.map(item => item.summary).join(' ');
  const hasImplementation = IMPLEMENTATION_PATTERN.test(text);
  const hasConflict = /partial|miss|deviation|delayed|failed|blocked/i.test(text);

  if (!relevant.length) {
    return {
      quality: 'unknown',
      reason: 'DAVE does not have enough implementation evidence yet.',
      confidence: 'low',
      supportingEvidence: [],
    };
  }

  if (hasImplementation && !hasConflict) {
    return {
      quality: 'high_fidelity',
      reason: 'Available evidence indicates implementation occurred without visible deviations.',
      confidence: relevant.length > 1 ? 'high' : 'medium',
      supportingEvidence: relevant,
    };
  }

  if (hasImplementation && hasConflict) {
    return {
      quality: 'partial_fidelity',
      reason: 'Evidence indicates implementation occurred with possible deviations or unresolved concerns.',
      confidence: 'medium',
      supportingEvidence: relevant,
    };
  }

  return {
    quality: 'not_started',
    reason: 'Available evidence does not show implementation has started.',
    confidence: 'medium',
    supportingEvidence: relevant,
  };
}

export function comparePredictedAndActualOutcomesAutomatically(
  decision: PIEDecisionRecord,
  evidence: PIEEvidenceReference[],
  actor: PIEActor,
  now: string = new Date().toISOString(),
) {
  const relevant = collectRelevantOutcomeEvidence(evidence, decision.immutableSnapshot, decision);
  const text = relevant.map(item => item.summary).join(' ');
  const hasOutcomeEvidence = OUTCOME_PATTERN.test(text);
  const classification: PIEOutcomeClassification = !hasOutcomeEvidence
    ? 'inconclusive'
    : /failed|not achieved|blocked/i.test(text)
      ? 'unsuccessful'
      : /partial|partly|mixed/i.test(text)
        ? 'partially_successful'
        : 'successful';

  return buildActualOutcomeRecord({
    decisionId: decision.id,
    organizationId: decision.organizationId,
    projectId: decision.projectId,
    classification,
    summary: hasOutcomeEvidence
      ? 'DAVE found project evidence related to the predicted outcome.'
      : 'DAVE found possible outcome evidence, but the result needs review.',
    actualResults: relevant.length
      ? relevant.map(item => item.summary)
      : ['No reliable outcome evidence available yet.'],
    measuredValues: {},
    predictedOutcomes: decision.immutableSnapshot.predictedOutcomes,
    evidenceReferences: relevant,
    unintendedConsequences: [],
    confoundingFactors: hasOutcomeEvidence ? [] : ['Outcome evidence is not strong enough for causation.'],
    observationPeriod: {
      startedAt: decision.createdAt,
      endedAt: now,
    },
    validationStatus: 'unvalidated',
    validator: null,
    validationDate: null,
    createdBy: actor,
    createdAt: now,
  });
}

export function automateLayer4DecisionLifecycle(
  input: PIELayer4LifecycleAutomationInput,
): PIELayer4AutomationReview {
  const now = input.now || new Date().toISOString();
  let decision = input.decision;
  const actions: PIELayer4AutomationAction[] = [];
  const exceptions: PIELayer4AutomationException[] = [];
  const linkedEvidence = collectRelevantOutcomeEvidence(input.evidence, decision.immutableSnapshot, decision);
  const authorityRequired = requiresHumanAuthority(decision);
  const hasConflict = linkedEvidence.some(item => /conflict|dispute|failed|unsafe|blocked/i.test(item.summary));

  if (hasConflict) {
    exceptions.push({
      id: `exception-conflict-${decision.id}`,
      message: 'Conflicting evidence needs review.',
      action: 'resolve_conflict',
      reason: 'DAVE found evidence that could change the decision outcome or implementation quality.',
    });
  }

  const policy = classifyLayer4AutomationPolicy({
    confidence: decision.immutableSnapshot.recommendationConfidence,
    evidenceSufficient: linkedEvidence.length > 0,
    reversible: true,
    impact: authorityRequired
      ? 'high'
      : decision.immutableSnapshot.recommendationConfidence === 'high'
        ? 'low'
        : 'moderate',
    authorityRequired,
    evidenceConflicts: hasConflict,
    projectRecordMateriallyChanges: decision.immutableSnapshot.recommendationConfidence !== 'high',
  });

  if (decision.currentStatus === 'approved' && !decision.outcomePlan) {
    const plan = buildAutomaticOutcomePlan(decision, linkedEvidence, now);
    decision = {
      ...decision,
      outcomePlan: plan,
      updatedAt: now,
      auditHistory: [
        ...decision.auditHistory,
        buildAutomationAudit(decision, input.actor, {
          field: 'outcomePlan',
          previousValue: null,
          newValue: plan.id,
          actionTaken: 'Generated outcome plan',
          triggeringEvent: 'Decision approved',
          evidenceUsed: linkedEvidence,
          confidence: decision.immutableSnapshot.recommendationConfidence,
          automationLevel: policy.level === 'human_decision_required' ? 'confirmation_required' : policy.level,
          humanApprovalReason: 'Outcome plan is generated from approved decision evidence; user can correct it.',
          reversible: true,
          timestamp: now,
        }),
      ],
    };
    actions.push(actionFromAudit(decision.auditHistory[decision.auditHistory.length - 1]));
  }

  if (policy.level === 'human_decision_required') {
    exceptions.push({
      id: `exception-approval-${decision.id}`,
      message: 'Human approval is required before DAVE changes this decision.',
      action: 'approve',
      reason: policy.reason,
    });
    return reviewResult(decision, actions, exceptions, linkedEvidence);
  }

  if (policy.level === 'confirmation_required') {
    exceptions.push({
      id: `exception-confirm-${decision.id}`,
      message: 'DAVE prepared the next step and needs a quick confirmation.',
      action: 'approve',
      reason: policy.reason,
    });
    return reviewResult(decision, actions, exceptions, linkedEvidence);
  }

  if (decision.currentStatus === 'approved' && decision.outcomePlan && linkedEvidence.length > 0) {
    const proposed = proposeImplementationQualityFromEvidence(decision, linkedEvidence);
    exceptions.push({
      id: `exception-implementation-${decision.id}`,
      message: 'Implementation needs confirmation before DAVE changes decision status.',
      action: 'confirm_implementation',
      reason: proposed.quality === 'not_started' || proposed.quality === 'unknown'
        ? proposed.reason
        : 'Evidence suggests implementation activity, but a human or authoritative workflow must record implementation.',
    });
  }

  if (decision.currentStatus === 'implemented') {
    decision = transitionDecisionStatus({
      decision,
      nextStatus: 'awaiting_outcome',
      actor: input.actor,
      reason: 'DAVE moved implemented decision to outcome review automatically.',
      source: 'system',
      linkedEvidence,
      timestamp: now,
    });
    actions.push({
      id: `auto-awaiting-${decision.id}`,
      actionTaken: 'Moved decision to awaiting outcome',
      triggeringEvent: 'Implementation was recorded',
      evidenceUsed: linkedEvidence,
      confidence: decision.immutableSnapshot.recommendationConfidence,
      automationLevel: 'automatic',
      reasonHumanApprovalWasOrWasNotRequired: 'This transition only opens outcome review and does not claim success.',
      correctionAvailable: true,
      reversible: true,
      timestamp: now,
    });
  }

  if (decision.currentStatus === 'awaiting_outcome' && OUTCOME_PATTERN.test(linkedEvidence.map(item => item.summary).join(' '))) {
    const outcome = comparePredictedAndActualOutcomesAutomatically(decision, linkedEvidence, input.actor, now);
    decision = transitionDecisionStatus({
      decision,
      nextStatus: 'outcome_observed',
      actor: input.actor,
      reason: 'DAVE observed outcome evidence and compared it to the prediction.',
      source: 'system',
      linkedEvidence,
      actualOutcome: outcome,
      timestamp: now,
    });
    actions.push({
      id: `auto-outcome-${decision.id}`,
      actionTaken: 'Recorded observed outcome',
      triggeringEvent: 'Outcome evidence found',
      evidenceUsed: linkedEvidence,
      confidence: 'medium',
      automationLevel: 'confirmation_required',
      reasonHumanApprovalWasOrWasNotRequired: 'Outcome evidence is useful but remains unvalidated until an authorized human validates it.',
      correctionAvailable: true,
      reversible: true,
      timestamp: now,
    });
  }

  if (decision.currentStatus === 'outcome_observed') {
    exceptions.push({
      id: `exception-validate-${decision.id}`,
      message: 'Outcome needs human validation before closure.',
      action: authorityRequired ? 'validate_high_impact_outcome' : 'provide_missing_evidence',
      reason: authorityRequired
        ? 'This decision affects high-impact authority boundaries.'
        : 'Automatic comparison can organize evidence, but DAVE cannot validate its own outcome.',
    });
  }

  const latestOutcome = decision.actualOutcomes[decision.actualOutcomes.length - 1];
  if (
    decision.currentStatus === 'outcome_validated' &&
    latestOutcome?.validationStatus === 'human_validated' &&
    !authorityRequired &&
    !hasConflict
  ) {
    decision = transitionDecisionStatus({
      decision,
      nextStatus: 'closed',
      actor: input.actor,
      reason: 'DAVE closed this low-risk decision after documented outcome support satisfied closeout requirements.',
      source: 'system',
      linkedEvidence,
      timestamp: now,
    });
    actions.push({
      id: `auto-closed-${decision.id}`,
      actionTaken: 'Closed decision after validated outcome',
      triggeringEvent: 'Closure requirements satisfied',
      evidenceUsed: linkedEvidence,
      confidence: 'high',
      automationLevel: 'automatic',
      reasonHumanApprovalWasOrWasNotRequired: 'Outcome validation and closeout requirements were satisfied without a high-impact authority boundary.',
      correctionAvailable: true,
      reversible: false,
      timestamp: now,
    });
  } else if (decision.currentStatus === 'outcome_validated' && latestOutcome?.validationStatus !== 'human_validated') {
    exceptions.push({
      id: `exception-human-validation-${decision.id}`,
      message: 'Only a human-validated outcome can close this decision.',
      action: 'provide_missing_evidence',
      reason: 'System-supported or unvalidated observations cannot satisfy the human validation boundary.',
    });
  }

  return reviewResult(decision, actions, exceptions, linkedEvidence);
}

export function findDuplicateLayer4Decision(
  report: PIEReportDraft,
  decisions: PIEDecisionRecord[],
): PIEDecisionRecord | null {
  const reportKey = normalizeDecisionText(selectDecisionOption(report));
  return decisions.find(decision => {
    if (decision.immutableSnapshot.recommendationId === report.id) return true;
    return normalizeDecisionText(decision.immutableSnapshot.selectedOption) === reportKey &&
      decision.currentStatus !== 'closed' &&
      decision.currentStatus !== 'cancelled';
  }) || null;
}

export function generatePredictedOutcomesFromReport(
  report: PIEReportDraft,
  evidence: PIEEvidenceReference[],
  now: string,
  fallbackOwner: string,
): PIEPredictedOutcome[] {
  const reviewDate = inferReviewDate(report, now);
  const owner = inferDecisionOwner(report, fallbackOwner);
  const authority = inferDecisionAuthority(report, fallbackOwner);
  const primaryAction = report.actionItems[0]?.action ||
    report.decisionsNeeded[0]?.question ||
    report.executiveSummary[0] ||
    report.title;

  return [
    buildPredictedOutcome({
      id: `predicted-${stableHash(`${report.id}:${primaryAction}`)}`,
      description: `Expected result: ${primaryAction}`,
      measurableResult: successConditionForReport(report),
      baseline: report.needsReview ? 'Needs review' : 'Current project evidence',
      targetValue: 'Verified result',
      expectedDirection: /avoid|risk|safety|compliance/i.test(primaryAction)
        ? 'avoid'
        : 'verify',
      expectedReviewDate: reviewDate,
      evidenceRequired: likelyEvidenceSources(report, evidence),
      responsibleOwner: owner,
      validationAuthority: authority,
      predictionConfidence: report.confidence,
      rationale: report.reviewFlags[0] ||
        'DAVE generated this outcome from the recommendation context, schedule/evidence signals, and report action items.',
    }),
  ];
}

function buildAutomationAudit(
  decision: PIEDecisionRecord,
  actor: PIEActor,
  input: {
    field: string;
    previousValue: string | null;
    newValue: string | null;
    actionTaken: string;
    triggeringEvent: string;
    evidenceUsed: PIEEvidenceReference[];
    confidence: 'low' | 'medium' | 'high';
    automationLevel: PIEAutomationLevel;
    humanApprovalReason: string;
    reversible: boolean;
    timestamp: string;
  },
) {
  const automation: PIEAutomationAuditDetail = {
    actionTaken: input.actionTaken,
    triggeringEvent: input.triggeringEvent,
    confidence: input.confidence,
    automationLevel: input.automationLevel,
    humanApprovalReason: input.humanApprovalReason,
    correctionAvailable: true,
    reversible: input.reversible,
  };

  return {
    id: `audit-${Date.parse(input.timestamp) || Date.now()}-${input.field}`,
    organizationId: decision.organizationId,
    projectId: decision.projectId,
    decisionId: decision.id,
    field: input.field,
    previousValue: input.previousValue,
    newValue: input.newValue,
    timestamp: input.timestamp,
    changedBy: actor,
    reason: `${input.actionTaken}. ${input.humanApprovalReason}`,
    source: 'system' as const,
    linkedEvidence: input.evidenceUsed,
    automation,
  };
}

function actionFromAudit(audit: {
  id: string;
  field: string;
  reason: string;
  source: string;
  linkedEvidence: PIEEvidenceReference[];
  timestamp: string;
  automation?: PIEAutomationAuditDetail | null;
}): PIELayer4AutomationAction {
  return {
    id: audit.id,
    actionTaken: audit.automation?.actionTaken || audit.reason,
    triggeringEvent: audit.automation?.triggeringEvent || audit.field,
    evidenceUsed: audit.linkedEvidence,
    confidence: audit.automation?.confidence || 'medium',
    automationLevel: audit.automation?.automationLevel || 'confirmation_required',
    reasonHumanApprovalWasOrWasNotRequired: audit.automation?.humanApprovalReason || audit.reason,
    correctionAvailable: audit.automation?.correctionAvailable ?? true,
    reversible: audit.automation?.reversible ?? true,
    timestamp: audit.timestamp,
  };
}

function reviewResult(
  decision: PIEDecisionRecord | null,
  actions: PIELayer4AutomationAction[],
  exceptions: PIELayer4AutomationException[],
  linkedEvidence: PIEEvidenceReference[],
): PIELayer4AutomationReview {
  return {
    decision,
    detected: [
      decision ? `Decision: ${decision.immutableSnapshot.selectedOption}` : 'No decision selected',
      `${linkedEvidence.length} evidence reference${linkedEvidence.length === 1 ? '' : 's'} linked automatically`,
    ],
    automaticActions: actions,
    exceptions,
    linkedEvidence,
    conciseExplanation: exceptions.length
      ? 'DAVE found decision history items that need review.'
      : actions.length
        ? 'DAVE updated decision history from project evidence.'
        : 'DAVE is monitoring this decision for outcome evidence.',
  };
}

function requiresHumanAuthority(decision: PIEDecisionRecord) {
  return HIGH_AUTHORITY_PATTERN.test([
    decision.immutableSnapshot.selectedOption,
    ...decision.immutableSnapshot.risks,
    ...decision.immutableSnapshot.constraints,
    decision.immutableSnapshot.selectedReason,
  ].join(' '));
}

function selectDecisionOption(report: PIEReportDraft) {
  return report.actionItems[0]?.action ||
    report.decisionsNeeded[0]?.question ||
    report.executiveSummary[0] ||
    report.title;
}

function inferDecisionOwner(report: PIEReportDraft, fallback: string) {
  return report.actionItems.find(item => item.owner && !item.needsOwner)?.owner ||
    report.decisionsNeeded.find(item => item.owner)?.owner ||
    fallback;
}

function inferDecisionAuthority(report: PIEReportDraft, fallback: string) {
  if (report.risks.some(risk => risk.severity === 'high')) return fallback;
  return inferDecisionOwner(report, fallback);
}

function buildDecisionAssumptions(report: PIEReportDraft) {
  return report.reviewFlags.length
    ? ['Review flags are visible and must be corrected before learning from the outcome.']
    : ['Current project evidence is sufficient to create a decision candidate.'];
}

function buildDecisionConstraints(report: PIEReportDraft) {
  const constraints = ['No automatic sending or external communication.'];
  if (report.needsReview) constraints.push('Needs review items must remain visible.');
  if (report.risks.some(risk => risk.severity === 'high')) constraints.push('High-risk items require human authority.');
  return constraints;
}

function inferReviewDate(report: PIEReportDraft, now: string) {
  const scheduleEvidence = report.sourceEvidence.find(item => item.source === 'schedule');
  const days = scheduleEvidence ? 3 : 7;
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

function successConditionForReport(report: PIEReportDraft) {
  if (report.actionItems[0]) return `Action completed or verified: ${report.actionItems[0].action}`;
  if (report.decisionsNeeded[0]) return `Decision answered and evidence recorded: ${report.decisionsNeeded[0].question}`;
  if (report.risks[0]) return `Risk response verified: ${report.risks[0].summary}`;
  return 'Decision result is verified with project evidence.';
}

function likelyEvidenceSources(report: PIEReportDraft, evidence: PIEEvidenceReference[]) {
  const sources = new Set<string>();
  evidence.forEach(item => {
    if (item.sourceType === 'photo') sources.add('Current photo evidence');
    if (item.sourceType === 'schedule_item') sources.add('Schedule update');
    if (item.sourceType === 'project_update') sources.add('Project update');
    if (item.sourceType === 'document') sources.add('Supporting document');
  });
  report.imageReferences.forEach(() => sources.add('Supporting photo'));
  report.actionItems.forEach(() => sources.add('Owner confirmation'));
  return Array.from(sources).slice(0, 5).length
    ? Array.from(sources).slice(0, 5)
    : ['Project evidence', 'Owner confirmation'];
}

function stringifyContext(context: PIEReportDraft | PIEDecisionRecord['immutableSnapshot']) {
  if ('body' in context) {
    return [
      context.title,
      context.body,
      ...context.executiveSummary,
      ...context.reviewFlags,
      ...context.actionItems.map(item => item.action),
      ...context.risks.map(item => item.summary),
    ].join(' ').toLowerCase();
  }
  return [
    context.selectedOption,
    context.selectedReason,
    ...context.assumptions,
    ...context.risks,
    ...context.constraints,
    ...context.predictedOutcomes.map(outcome => `${outcome.description} ${outcome.measurableResult}`),
  ].join(' ').toLowerCase();
}

function explicitContextEvidenceIds(
  context: PIEReportDraft | PIEDecisionRecord['immutableSnapshot'],
) {
  if ('body' in context) {
    return new Set([
      ...context.sourceEvidence.map(item => item.id),
      ...context.actionItems.flatMap(item => item.sourceEvidenceIds),
      ...context.risks.flatMap(item => item.sourceEvidenceIds),
      ...context.decisionsNeeded.flatMap(item => item.sourceEvidenceIds),
      ...context.imageReferences.map(item => item.photoId),
      ...context.constructionUnderstanding.workAreas.flatMap(item => item.sourceEvidenceIds),
    ].filter(Boolean));
  }
  return new Set([
    ...context.evidenceAvailable.map(item => item.id),
    ...context.predictedOutcomes.flatMap(outcome => outcome.evidenceRequired),
  ].filter(Boolean));
}

const EVIDENCE_MATCH_STOP_WORDS = new Set([
  'action', 'approved', 'complete', 'completed', 'current', 'decision',
  'evidence', 'project', 'ready', 'report', 'requirement', 'schedule',
  'selected', 'update', 'verified', 'work',
]);

function keywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 4 && !EVIDENCE_MATCH_STOP_WORDS.has(word))
    .slice(0, 28);
}

function dedupeEvidence(evidence: PIEEvidenceReference[]) {
  const byKey = new Map<string, PIEEvidenceReference>();
  evidence.forEach(item => {
    byKey.set(`${item.organizationId}:${item.projectId}:${item.sourceType}:${item.id}:${item.versionId || ''}`, item);
  });
  return Array.from(byKey.values());
}

function assertEvidenceWithinBoundary(
  evidence: readonly PIEEvidenceReference[],
  boundary: { organizationId: string; projectId: string },
) {
  const crossOrganization = evidence.find(
    item => item.organizationId !== boundary.organizationId,
  );
  if (crossOrganization) {
    throw new Error('Layer 4 evidence belongs to another organization.');
  }
  const crossProject = evidence.find(item => item.projectId !== boundary.projectId);
  if (crossProject) {
    throw new Error('Layer 4 evidence belongs to another project.');
  }
}

function normalizeDecisionText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return String(Math.abs(hash));
}
