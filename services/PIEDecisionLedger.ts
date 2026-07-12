export type PIEDecisionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'implemented'
  | 'awaiting_outcome'
  | 'outcome_observed'
  | 'outcome_validated'
  | 'closed'
  | 'cancelled';

export type PIEOutcomeClassification =
  | 'successful'
  | 'partially_successful'
  | 'unsuccessful'
  | 'mixed'
  | 'inconclusive'
  | 'not_implemented'
  | 'cancelled';

export type PIEOutcomeValidationStatus =
  | 'unvalidated'
  | 'system_supported'
  | 'human_validated'
  | 'disputed';

export type PIEImplementationQuality =
  | 'not_started'
  | 'low_fidelity'
  | 'partial_fidelity'
  | 'high_fidelity'
  | 'implemented_as_designed'
  | 'unknown';

export type PIEExpectedOutcomeDirection =
  | 'increase'
  | 'decrease'
  | 'maintain'
  | 'complete'
  | 'avoid'
  | 'verify'
  | 'unknown';

export type PIEActorRole =
  | 'system'
  | 'user'
  | 'decision_owner'
  | 'validation_authority'
  | 'admin';

export type PIELayer4Permission =
  | 'view_decision_history'
  | 'create_decision_candidate'
  | 'create_decision_snapshot'
  | 'approve_decision'
  | 'reject_decision'
  | 'defer_decision'
  | 'implement_decision'
  | 'cancel_decision'
  | 'record_outcome_plan'
  | 'record_implementation_assessment'
  | 'record_outcome'
  | 'validate_outcome'
  | 'dispute_outcome'
  | 'close_decision'
  | 'append_corrected_version'
  | 'append_decision_version'
  | 'synchronize_decision_history';

export type PIEActor = {
  id: string;
  name: string;
  role: PIEActorRole;
  organizationId: string;
  authorizedPermissions?: PIELayer4Permission[];
  identitySource?: 'supabase_auth' | 'offline_fallback' | 'unavailable';
  cloudTrusted?: boolean;
};

export type PIEAutomationLevel =
  | 'automatic'
  | 'confirmation_required'
  | 'human_decision_required';

export type PIEAutomationAuditDetail = {
  actionTaken: string;
  triggeringEvent: string;
  confidence: 'low' | 'medium' | 'high';
  automationLevel: PIEAutomationLevel;
  humanApprovalReason: string;
  correctionAvailable: boolean;
  reversible: boolean;
};

export type PIEEvidenceReference = {
  id: string;
  sourceType:
    | 'photo'
    | 'project_update'
    | 'schedule_item'
    | 'document'
    | 'note'
    | 'issue'
    | 'risk'
    | 'recommendation'
    | 'other';
  organizationId: string;
  projectId: string;
  summary: string;
  capturedAt?: string | null;
  uri?: string | null;
  versionId?: string | null;
  contentHash?: string | null;
};

export type PIEPredictedOutcome = {
  id: string;
  description: string;
  measurableResult: string;
  baseline?: string | number | null;
  targetValue?: string | number | null;
  expectedDirection: PIEExpectedOutcomeDirection;
  expectedReviewDate: string;
  evidenceRequired: string[];
  responsibleOwner: string;
  validationAuthority: string;
  predictionConfidence: 'low' | 'medium' | 'high';
  rationale: string;
};

export type PIEOutcomePlan = {
  id: string;
  checks: string[];
  reviewDate: string;
  responsibleOwner: string;
  acceptedEvidence: string[];
  evidenceReferences: PIEEvidenceReference[];
  validationAuthority: string;
  createdAt: string;
  updatedAt: string;
};

export type PIEImplementationAssessment = {
  id: string;
  quality: PIEImplementationQuality;
  approvedScopeImplemented: boolean;
  materialDeviations: string[];
  omittedControls: string[];
  timingDeviations: string[];
  externalFactors: string[];
  supportingEvidence: PIEEvidenceReference[];
  assessedAt: string;
  assessedBy: PIEActor;
};

export type PIEPredictedOutcomeComparison = {
  predictedOutcomeId: string;
  predictedDescription: string;
  actualResult: string;
  matched: boolean | null;
  explanation: string;
};

export type PIEActualOutcomeRecord = {
  id: string;
  decisionId: string;
  organizationId: string;
  projectId: string;
  classification: PIEOutcomeClassification;
  summary: string;
  actualResults: string[];
  measuredValues: Record<string, string | number | null>;
  predictionComparisons: PIEPredictedOutcomeComparison[];
  evidenceReferences: PIEEvidenceReference[];
  unintendedConsequences: string[];
  confoundingFactors: string[];
  observationPeriod: {
    startedAt: string;
    endedAt: string;
  };
  validationStatus: PIEOutcomeValidationStatus;
  validator?: PIEActor | null;
  validationDate?: string | null;
  createdAt: string;
  createdBy: PIEActor;
};

export type PIEAuditEvent = {
  id: string;
  organizationId: string;
  projectId: string;
  decisionId: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  timestamp: string;
  changedBy: PIEActor;
  reason: string;
  source: 'user' | 'system' | 'sync' | 'import' | 'review';
  linkedEvidence: PIEEvidenceReference[];
  automation?: PIEAutomationAuditDetail | null;
};

export type PIEDecisionSnapshot = {
  projectId: string;
  situationId: string;
  issueId?: string | null;
  recommendationId: string;
  selectedOption: string;
  decisionOwner: string;
  decisionAuthority: string;
  decisionDate: string;
  evidenceAvailable: PIEEvidenceReference[];
  knownEvidenceGaps: string[];
  assumptions: string[];
  risks: string[];
  constraints: string[];
  predictedOutcomes: PIEPredictedOutcome[];
  recommendationConfidence: 'low' | 'medium' | 'high';
  confidenceExplanation: string;
  selectedReason: string;
};

export type PIEDecisionVersion = {
  version: number;
  snapshot: PIEDecisionSnapshot;
  createdAt: string;
  createdBy: PIEActor;
  reason: string;
};

export type PIEDecisionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  currentStatus: PIEDecisionStatus;
  currentVersion: number;
  immutableSnapshot: PIEDecisionSnapshot;
  versions: PIEDecisionVersion[];
  outcomePlan?: PIEOutcomePlan | null;
  implementationAssessment?: PIEImplementationAssessment | null;
  actualOutcomes: PIEActualOutcomeRecord[];
  auditHistory: PIEAuditEvent[];
  createdAt: string;
  createdBy: PIEActor;
  updatedAt: string;
  closeBlockers: string[];
};

export type PIEDecisionRecordInput = {
  id?: string;
  organizationId: string;
  projectId: string;
  snapshot: PIEDecisionSnapshot;
  createdBy: PIEActor;
  createdAt?: string;
};

export type PIEDecisionTransitionInput = {
  decision: PIEDecisionRecord;
  nextStatus: PIEDecisionStatus;
  actor: PIEActor;
  reason: string;
  source: PIEAuditEvent['source'];
  linkedEvidence?: PIEEvidenceReference[];
  outcomePlan?: PIEOutcomePlan;
  implementationAssessment?: PIEImplementationAssessment;
  actualOutcome?: PIEActualOutcomeRecord;
  timestamp?: string;
};

export type PIEDecisionValidationResult = {
  valid: boolean;
  reasons: string[];
};

export const PIE_DECISION_STATUS_TRANSITIONS: Record<PIEDecisionStatus, PIEDecisionStatus[]> = {
  proposed: ['approved', 'rejected', 'deferred', 'cancelled'],
  approved: ['implemented', 'deferred', 'cancelled'],
  rejected: ['closed'],
  deferred: ['approved', 'cancelled'],
  implemented: ['awaiting_outcome', 'outcome_observed', 'cancelled'],
  awaiting_outcome: ['outcome_observed', 'cancelled'],
  outcome_observed: ['outcome_validated', 'cancelled'],
  outcome_validated: ['closed'],
  closed: [],
  cancelled: ['closed'],
};

const STATUS_PERMISSION: Record<PIEDecisionStatus, PIELayer4Permission | null> = {
  proposed: 'create_decision_snapshot',
  approved: 'approve_decision',
  rejected: 'reject_decision',
  deferred: 'defer_decision',
  implemented: 'implement_decision',
  awaiting_outcome: 'implement_decision',
  outcome_observed: 'record_outcome',
  outcome_validated: 'validate_outcome',
  closed: 'close_decision',
  cancelled: 'cancel_decision',
};

export function createDecisionRecord(input: PIEDecisionRecordInput): PIEDecisionRecord {
  assertSameBoundary(input.organizationId, input.projectId, input.createdBy);
  requireAnyActorPermission(input.createdBy, ['create_decision_candidate', 'create_decision_snapshot']);
  validateDecisionSnapshot(input.organizationId, input.projectId, input.snapshot);

  const createdAt = input.createdAt || new Date().toISOString();
  const snapshot = clone(input.snapshot);
  const record: PIEDecisionRecord = {
    id: input.id || `pie-decision-${Date.parse(createdAt) || Date.now()}`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    currentStatus: 'proposed',
    currentVersion: 1,
    immutableSnapshot: snapshot,
    versions: [{
      version: 1,
      snapshot,
      createdAt,
      createdBy: clone(input.createdBy),
      reason: 'Original decision snapshot.',
    }],
    outcomePlan: null,
    implementationAssessment: null,
    actualOutcomes: [],
    auditHistory: [{
      id: `audit-${Date.parse(createdAt) || Date.now()}-created`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      decisionId: input.id || `pie-decision-${Date.parse(createdAt) || Date.now()}`,
      field: 'status',
      previousValue: null,
      newValue: 'proposed',
      timestamp: createdAt,
      changedBy: clone(input.createdBy),
      reason: 'Decision snapshot created.',
      source: 'user',
      linkedEvidence: [],
      automation: null,
    }],
    createdAt,
    createdBy: clone(input.createdBy),
    updatedAt: createdAt,
    closeBlockers: ['Decision needs an approved outcome, justified inconclusive result, not implemented result, or cancellation before it can close.'],
  };

  return freezeDecision(record);
}

export function appendDecisionSnapshotVersion(
  decision: PIEDecisionRecord,
  snapshot: PIEDecisionSnapshot,
  actor: PIEActor,
  reason: string,
  timestamp: string = new Date().toISOString(),
): PIEDecisionRecord {
  assertSameBoundary(decision.organizationId, decision.projectId, actor);
  requireAnyActorPermission(actor, ['append_corrected_version', 'append_decision_version']);
  validateDecisionSnapshot(decision.organizationId, decision.projectId, snapshot);

  const nextVersion = decision.currentVersion + 1;
  const next: PIEDecisionRecord = {
    ...clone(decision),
    currentVersion: nextVersion,
    versions: [
      ...decision.versions,
      {
        version: nextVersion,
        snapshot: clone(snapshot),
        createdAt: timestamp,
        createdBy: clone(actor),
        reason,
      },
    ],
    auditHistory: [
      ...decision.auditHistory,
      buildAuditEvent(decision, actor, {
        field: 'version',
        previousValue: String(decision.currentVersion),
        newValue: String(nextVersion),
        reason,
        source: 'user',
        linkedEvidence: snapshot.evidenceAvailable,
        timestamp,
      }),
    ],
    updatedAt: timestamp,
  };

  return freezeDecision(next);
}

export function transitionDecisionStatus(input: PIEDecisionTransitionInput): PIEDecisionRecord {
  const timestamp = input.timestamp || new Date().toISOString();
  const decision = clone(input.decision);
  assertSameBoundary(decision.organizationId, decision.projectId, input.actor);
  const permission = STATUS_PERMISSION[input.nextStatus];
  if (permission) requireActorPermission(input.actor, permission);
  validateEvidenceBoundaries(decision.organizationId, decision.projectId, input.linkedEvidence || []);
  if (input.outcomePlan) {
    validateEvidenceBoundaries(decision.organizationId, decision.projectId, input.outcomePlan.evidenceReferences);
  }

  const transitionValidation = validateDecisionTransition(input);
  if (!transitionValidation.valid) {
    throw new Error(transitionValidation.reasons.join(' '));
  }

  const actualOutcomes = [...decision.actualOutcomes];
  if (input.actualOutcome) {
    validateActualOutcome(decision, input.actualOutcome, input.actor);
    actualOutcomes.push(clone(input.actualOutcome));
  }

  const next: PIEDecisionRecord = {
    ...decision,
    currentStatus: input.nextStatus,
    outcomePlan: input.outcomePlan ? clone(input.outcomePlan) : decision.outcomePlan,
    implementationAssessment: input.implementationAssessment
      ? clone(input.implementationAssessment)
      : decision.implementationAssessment,
    actualOutcomes,
    auditHistory: [
      ...decision.auditHistory,
      buildAuditEvent(decision, input.actor, {
        field: 'status',
        previousValue: decision.currentStatus,
        newValue: input.nextStatus,
        reason: input.reason,
        source: input.source,
        linkedEvidence: input.linkedEvidence || [],
        timestamp,
      }),
    ],
    updatedAt: timestamp,
    closeBlockers: [],
  };
  next.closeBlockers = getDecisionCloseBlockers(next);

  return freezeDecision(next);
}

export function updateDecisionOutcomePlan(
  decision: PIEDecisionRecord,
  outcomePlan: PIEOutcomePlan,
  actor: PIEActor,
  reason: string,
  timestamp: string = new Date().toISOString(),
): PIEDecisionRecord {
  assertSameBoundary(decision.organizationId, decision.projectId, actor);
  requireActorPermission(actor, 'record_outcome_plan');
  validateOutcomePlan(outcomePlan);
  validateEvidenceBoundaries(decision.organizationId, decision.projectId, outcomePlan.evidenceReferences);
  const next: PIEDecisionRecord = {
    ...clone(decision),
    outcomePlan: clone(outcomePlan),
    auditHistory: [
      ...decision.auditHistory,
      buildAuditEvent(decision, actor, {
        field: 'outcomePlan',
        previousValue: decision.outcomePlan ? decision.outcomePlan.id : null,
        newValue: outcomePlan.id,
        reason,
        source: 'user',
        linkedEvidence: outcomePlan.evidenceReferences,
        timestamp,
      }),
    ],
    updatedAt: timestamp,
  };
  next.closeBlockers = getDecisionCloseBlockers(next);
  return freezeDecision(next);
}

export function recordDecisionImplementationAssessment(
  decision: PIEDecisionRecord,
  implementationAssessment: PIEImplementationAssessment,
  actor: PIEActor,
  reason: string,
  timestamp: string = new Date().toISOString(),
): PIEDecisionRecord {
  assertSameBoundary(decision.organizationId, decision.projectId, actor);
  requireActorPermission(actor, 'record_implementation_assessment');
  validateEvidenceBoundaries(
    decision.organizationId,
    decision.projectId,
    implementationAssessment.supportingEvidence,
  );
  const next: PIEDecisionRecord = {
    ...clone(decision),
    implementationAssessment: clone(implementationAssessment),
    auditHistory: [
      ...decision.auditHistory,
      buildAuditEvent(decision, actor, {
        field: 'implementationAssessment',
        previousValue: decision.implementationAssessment?.quality || null,
        newValue: implementationAssessment.quality,
        reason,
        source: 'user',
        linkedEvidence: implementationAssessment.supportingEvidence,
        timestamp,
      }),
    ],
    updatedAt: timestamp,
  };
  next.closeBlockers = getDecisionCloseBlockers(next);
  return freezeDecision(next);
}

export function updateLatestOutcomeValidation(
  decision: PIEDecisionRecord,
  validationStatus: PIEOutcomeValidationStatus,
  actor: PIEActor,
  reason: string,
  linkedEvidence: PIEEvidenceReference[] = [],
  timestamp: string = new Date().toISOString(),
): PIEDecisionRecord {
  assertSameBoundary(decision.organizationId, decision.projectId, actor);
  requireActorPermission(
    actor,
    validationStatus === 'disputed' ? 'dispute_outcome' : 'validate_outcome',
  );
  validateEvidenceBoundaries(decision.organizationId, decision.projectId, linkedEvidence);
  const latest = decision.actualOutcomes[decision.actualOutcomes.length - 1];
  if (!latest) throw new Error('No actual outcome is available to validate or dispute.');
  const nextOutcome: PIEActualOutcomeRecord = {
    ...clone(latest),
    id: `${latest.id}-${validationStatus}-${Date.parse(timestamp) || Date.now()}`,
    evidenceReferences: mergeEvidenceReferences(latest.evidenceReferences, linkedEvidence),
    validationStatus,
    validator: clone(actor),
    validationDate: timestamp,
    createdAt: timestamp,
    createdBy: clone(actor),
  };
  if (validationStatus === 'human_validated' && !canValidateOutcome(nextOutcome, actor)) {
    throw new Error('Outcome validation requires an authorized validator.');
  }
  const nextOutcomes = [
    ...decision.actualOutcomes,
    nextOutcome,
  ];
  const nextStatus: PIEDecisionStatus =
    validationStatus === 'human_validated' || validationStatus === 'system_supported'
      ? 'outcome_validated'
      : decision.currentStatus;
  if (nextStatus !== decision.currentStatus) {
    return transitionDecisionStatus({
      decision: {
        ...decision,
          actualOutcomes: nextOutcomes,
      },
      nextStatus,
      actor,
      reason,
      source: 'user',
      linkedEvidence,
      timestamp,
    });
  }
  const next: PIEDecisionRecord = {
    ...clone(decision),
    actualOutcomes: nextOutcomes,
    auditHistory: [
      ...decision.auditHistory,
      buildAuditEvent(decision, actor, {
        field: 'outcomeValidation',
        previousValue: latest.validationStatus,
        newValue: validationStatus,
        reason,
        source: 'user',
        linkedEvidence: mergeEvidenceReferences(latest.evidenceReferences, linkedEvidence),
        timestamp,
      }),
    ],
    updatedAt: timestamp,
  };
  next.closeBlockers = getDecisionCloseBlockers(next);
  return freezeDecision(next);
}

export function validateDecisionTransition(input: PIEDecisionTransitionInput): PIEDecisionValidationResult {
  const reasons: string[] = [];
  const { decision, nextStatus } = input;
  const allowed = PIE_DECISION_STATUS_TRANSITIONS[decision.currentStatus] || [];

  if (!allowed.includes(nextStatus)) {
    reasons.push(`Invalid transition from ${decision.currentStatus} to ${nextStatus}.`);
  }

  if ((nextStatus === 'implemented' || nextStatus === 'awaiting_outcome') && !input.outcomePlan && !decision.outcomePlan) {
    reasons.push('Implemented decisions require an outcome plan.');
  }

  if (nextStatus === 'implemented' && decision.immutableSnapshot.predictedOutcomes.length === 0) {
    reasons.push('Implemented decisions require at least one predicted outcome.');
  }

  if (nextStatus === 'outcome_validated') {
    const outcome = input.actualOutcome || decision.actualOutcomes[decision.actualOutcomes.length - 1];
    if (!outcome) {
      reasons.push('Outcome validation requires an actual outcome record.');
    } else if (!canValidateOutcome(outcome, input.actor)) {
      reasons.push('Outcome validation requires an authorized validator.');
    }
  }

  if (nextStatus === 'closed') {
    const blockers = getDecisionCloseBlockers({
      ...decision,
      currentStatus: nextStatus,
      actualOutcomes: input.actualOutcome
        ? [...decision.actualOutcomes, input.actualOutcome]
        : decision.actualOutcomes,
    });
    if (blockers.length > 0) reasons.push(...blockers);
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function buildPredictedOutcome(input: Omit<PIEPredictedOutcome, 'id'> & { id?: string }): PIEPredictedOutcome {
  const outcome: PIEPredictedOutcome = {
    id: input.id || `predicted-outcome-${Date.now()}`,
    description: input.description,
    measurableResult: input.measurableResult,
    baseline: input.baseline ?? null,
    targetValue: input.targetValue ?? null,
    expectedDirection: input.expectedDirection,
    expectedReviewDate: input.expectedReviewDate,
    evidenceRequired: input.evidenceRequired,
    responsibleOwner: input.responsibleOwner,
    validationAuthority: input.validationAuthority,
    predictionConfidence: input.predictionConfidence,
    rationale: input.rationale,
  };
  validatePredictedOutcome(outcome);
  return outcome;
}

export function buildOutcomePlan(input: Omit<PIEOutcomePlan, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}): PIEOutcomePlan {
  const now = new Date().toISOString();
  const plan: PIEOutcomePlan = {
    id: input.id || `outcome-plan-${Date.now()}`,
    checks: input.checks,
    reviewDate: input.reviewDate,
    responsibleOwner: input.responsibleOwner,
    acceptedEvidence: input.acceptedEvidence,
    evidenceReferences: clone(input.evidenceReferences || []),
    validationAuthority: input.validationAuthority,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
  validateOutcomePlan(plan);
  return plan;
}

export function buildImplementationAssessment(input: Omit<PIEImplementationAssessment, 'id' | 'assessedAt'> & {
  id?: string;
  assessedAt?: string;
}): PIEImplementationAssessment {
  return {
    id: input.id || `implementation-assessment-${Date.now()}`,
    quality: input.quality,
    approvedScopeImplemented: input.approvedScopeImplemented,
    materialDeviations: input.materialDeviations,
    omittedControls: input.omittedControls,
    timingDeviations: input.timingDeviations,
    externalFactors: input.externalFactors,
    supportingEvidence: clone(input.supportingEvidence),
    assessedAt: input.assessedAt || new Date().toISOString(),
    assessedBy: clone(input.assessedBy),
  };
}

export function buildActualOutcomeRecord(input: Omit<PIEActualOutcomeRecord, 'id' | 'predictionComparisons' | 'createdAt'> & {
  id?: string;
  predictedOutcomes: PIEPredictedOutcome[];
  createdAt?: string;
}): PIEActualOutcomeRecord {
  const createdAt = input.createdAt || new Date().toISOString();
  const outcome: PIEActualOutcomeRecord = {
    id: input.id || `actual-outcome-${Date.parse(createdAt) || Date.now()}`,
    decisionId: input.decisionId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    classification: input.classification,
    summary: input.summary,
    actualResults: input.actualResults,
    measuredValues: clone(input.measuredValues),
    predictionComparisons: compareActualOutcomeToPredictions(
      input.predictedOutcomes,
      input.actualResults,
      input.measuredValues,
    ),
    evidenceReferences: clone(input.evidenceReferences),
    unintendedConsequences: input.unintendedConsequences,
    confoundingFactors: input.confoundingFactors,
    observationPeriod: clone(input.observationPeriod),
    validationStatus: input.validationStatus,
    validator: input.validator ? clone(input.validator) : null,
    validationDate: input.validationDate || null,
    createdAt,
    createdBy: clone(input.createdBy),
  };
  return outcome;
}

export function compareActualOutcomeToPredictions(
  predictions: PIEPredictedOutcome[],
  actualResults: string[],
  measuredValues: Record<string, string | number | null>,
): PIEPredictedOutcomeComparison[] {
  const actualText = actualResults.join(' ').toLowerCase();
  return predictions.map(prediction => {
    const target = prediction.targetValue;
    const measured = measuredValues[prediction.id] ?? measuredValues[prediction.measurableResult];
    const hasMeasurement = measured !== undefined && measured !== null && String(measured).trim().length > 0;
    const targetMet = hasMeasurement && target !== undefined && target !== null
      ? String(measured).toLowerCase() === String(target).toLowerCase()
      : null;
    const textMatched = actualText.includes(prediction.description.toLowerCase()) ||
      actualText.includes(prediction.measurableResult.toLowerCase());
    const matched = targetMet !== null ? targetMet : textMatched ? true : null;

    return {
      predictedOutcomeId: prediction.id,
      predictedDescription: prediction.description,
      actualResult: hasMeasurement
        ? `${prediction.measurableResult}: ${String(measured)}`
        : actualResults[0] || 'No actual result recorded.',
      matched,
      explanation: matched === true
        ? 'Actual result supports the predicted outcome.'
        : matched === false
          ? 'Actual result does not meet the predicted target.'
          : 'Actual result needs human review before DAVE can judge the prediction.',
    };
  });
}

export function canValidateOutcome(outcome: PIEActualOutcomeRecord, actor: PIEActor): boolean {
  if (actor.organizationId !== outcome.organizationId) return false;
  if (actor.role === 'admin' || actor.role === 'validation_authority') return true;
  return outcome.validator?.id === actor.id && outcome.validator.organizationId === actor.organizationId;
}

export function getDecisionCloseBlockers(decision: Pick<PIEDecisionRecord, 'currentStatus' | 'actualOutcomes'>): string[] {
  if (decision.currentStatus === 'cancelled') return [];
  const latestOutcome = decision.actualOutcomes[decision.actualOutcomes.length - 1];
  if (!latestOutcome) {
    return ['Decision cannot close until an outcome is validated, justified as inconclusive, not implemented, or cancelled.'];
  }
  if (latestOutcome.classification === 'cancelled' || latestOutcome.classification === 'not_implemented') return [];
  if (latestOutcome.classification === 'inconclusive' && latestOutcome.summary.trim().length > 0) return [];
  if (
    latestOutcome.validationStatus === 'human_validated' ||
    latestOutcome.validationStatus === 'system_supported'
  ) {
    return [];
  }
  return ['Decision cannot close because the outcome is not validated or justified.'];
}

export function decisionAwaitingOutcomeReview(decision: PIEDecisionRecord): boolean {
  return decision.currentStatus === 'implemented' || decision.currentStatus === 'awaiting_outcome';
}

function validateDecisionSnapshot(organizationId: string, projectId: string, snapshot: PIEDecisionSnapshot) {
  if (snapshot.projectId !== projectId) {
    throw new Error('Decision snapshot project boundary does not match the record.');
  }
  if (!snapshot.confidenceExplanation.trim()) {
    throw new Error('Recommendation confidence requires an explanation.');
  }
  if (!snapshot.selectedReason.trim()) {
    throw new Error('Selected option requires a reason.');
  }
  snapshot.predictedOutcomes.forEach(validatePredictedOutcome);
  validateEvidenceBoundaries(organizationId, projectId, snapshot.evidenceAvailable);
}

function validatePredictedOutcome(outcome: PIEPredictedOutcome) {
  if (!outcome.description.trim()) throw new Error('Predicted outcome requires a description.');
  if (!outcome.measurableResult.trim()) throw new Error('Predicted outcome requires a measurable or verifiable result.');
  if (!outcome.expectedReviewDate.trim()) throw new Error('Predicted outcome requires a review date.');
  if (outcome.evidenceRequired.length === 0) throw new Error('Predicted outcome requires verification evidence.');
  if (!outcome.rationale.trim()) throw new Error('Predicted outcome requires rationale.');
}

function validateOutcomePlan(plan: PIEOutcomePlan) {
  if (plan.checks.length === 0) throw new Error('Outcome plan requires checks.');
  if (!plan.reviewDate.trim()) throw new Error('Outcome plan requires a review date.');
  if (!plan.responsibleOwner.trim()) throw new Error('Outcome plan requires a responsible owner.');
  if (plan.acceptedEvidence.length === 0) throw new Error('Outcome plan requires accepted evidence.');
  if (!plan.validationAuthority.trim()) throw new Error('Outcome plan requires a validation authority.');
}

function mergeEvidenceReferences(
  existing: PIEEvidenceReference[],
  next: PIEEvidenceReference[],
): PIEEvidenceReference[] {
  const byKey = new Map<string, PIEEvidenceReference>();
  [...existing, ...next].forEach(item => {
    byKey.set(`${item.sourceType}:${item.id}:${item.versionId || ''}:${item.contentHash || ''}`, clone(item));
  });
  return Array.from(byKey.values());
}

function validateActualOutcome(
  decision: PIEDecisionRecord,
  outcome: PIEActualOutcomeRecord,
  actor: PIEActor,
) {
  assertSameBoundary(decision.organizationId, decision.projectId, actor);
  if (outcome.decisionId !== decision.id) throw new Error('Actual outcome must link to the original decision.');
  if (outcome.organizationId !== decision.organizationId || outcome.projectId !== decision.projectId) {
    throw new Error('Actual outcome boundary does not match the decision.');
  }
  validateEvidenceBoundaries(decision.organizationId, decision.projectId, outcome.evidenceReferences);
  const predictedIds = new Set(decision.immutableSnapshot.predictedOutcomes.map(item => item.id));
  outcome.predictionComparisons.forEach(comparison => {
    if (!predictedIds.has(comparison.predictedOutcomeId)) {
      throw new Error('Actual outcome comparison is disconnected from predicted outcomes.');
    }
  });
  if (outcome.validationStatus === 'human_validated' && !canValidateOutcome(outcome, actor)) {
    throw new Error('Outcome validation requires an authorized validator.');
  }
}

function validateEvidenceBoundaries(
  organizationId: string,
  projectId: string,
  evidence: PIEEvidenceReference[],
) {
  evidence.forEach(item => {
    if (item.organizationId !== organizationId || item.projectId !== projectId) {
      throw new Error('Evidence from another organization or project cannot be linked.');
    }
  });
}

function assertSameBoundary(organizationId: string, projectId: string, actor: PIEActor) {
  if (!organizationId.trim() || !projectId.trim()) {
    throw new Error('Decision records require organization and project boundaries.');
  }
  if (actor.organizationId !== organizationId) {
    throw new Error('Actor organization does not match decision organization.');
  }
}

function requireActorPermission(actor: PIEActor, permission: PIELayer4Permission) {
  if (actor.role === 'system') return;
  if (!actor.authorizedPermissions?.includes(permission)) {
    throw new Error(`Layer 4 permission denied: ${permission}.`);
  }
}

function requireAnyActorPermission(actor: PIEActor, permissions: PIELayer4Permission[]) {
  if (actor.role === 'system') return;
  if (!permissions.some(permission => actor.authorizedPermissions?.includes(permission))) {
    throw new Error(`Layer 4 permission denied: ${permissions.join(' or ')}.`);
  }
}

function buildAuditEvent(
  decision: PIEDecisionRecord,
  actor: PIEActor,
  input: Omit<PIEAuditEvent, 'id' | 'organizationId' | 'projectId' | 'decisionId' | 'changedBy'>,
): PIEAuditEvent {
  return {
    id: `audit-${Date.parse(input.timestamp) || Date.now()}-${input.field}`,
    organizationId: decision.organizationId,
    projectId: decision.projectId,
    decisionId: decision.id,
    field: input.field,
    previousValue: input.previousValue,
    newValue: input.newValue,
    timestamp: input.timestamp,
    changedBy: clone(actor),
    reason: input.reason,
    source: input.source,
    linkedEvidence: clone(input.linkedEvidence),
    automation: input.automation ? clone(input.automation) : null,
  };
}

function freezeDecision<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  Object.values(value as Record<string, unknown>).forEach(item => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      freezeDecision(item);
    }
  });
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
