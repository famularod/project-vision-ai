import type {
  PIEActualOutcomeRecord,
  PIEDecisionRecord,
} from './PIEDecisionLedger';
import type {
  PIELearningOutcome,
  PIEVerifiedLearningEvent,
} from './PIELearningEngine';

/**
 * Converts only explicitly human-validated decision outcomes into learning
 * events. Observed or system-supported outcomes remain visible in Decision
 * History but cannot teach Core that a recommendation worked or failed.
 */
export function buildVerifiedLearningEventsFromDecisionLedger({
  decisions,
  organizationId,
  projectId,
}: {
  decisions: readonly PIEDecisionRecord[];
  organizationId: string | null | undefined;
  projectId: string | null | undefined;
}): PIEVerifiedLearningEvent[] {
  const scopedOrganizationId = clean(organizationId);
  const scopedProjectId = clean(projectId);
  if (!scopedOrganizationId || !scopedProjectId) return [];

  return decisions
    .filter(decision =>
      decision.organizationId === scopedOrganizationId &&
      decision.projectId === scopedProjectId,
    )
    .flatMap(decision =>
      decision.actualOutcomes
        .map(outcome => verifiedOutcomeEvent(decision, outcome))
        .filter((event): event is PIEVerifiedLearningEvent => Boolean(event)),
    )
    .sort((left, right) =>
      Date.parse(left.verifiedAt) - Date.parse(right.verifiedAt) ||
      left.id.localeCompare(right.id),
    );
}

function verifiedOutcomeEvent(
  decision: PIEDecisionRecord,
  outcome: PIEActualOutcomeRecord,
): PIEVerifiedLearningEvent | null {
  const validator = outcome.validator;
  const verifiedAt = clean(outcome.validationDate);
  const eventOutcome = learningOutcome(outcome);
  const provenanceRecordIds = Array.from(new Set(
    outcome.evidenceReferences
      .map(reference => clean(reference.id))
      .filter((value): value is string => Boolean(value)),
  ));

  if (
    outcome.validationStatus !== 'human_validated' ||
    !validator ||
    validator.role !== 'validation_authority' ||
    validator.organizationId !== decision.organizationId ||
    outcome.organizationId !== decision.organizationId ||
    outcome.projectId !== decision.projectId ||
    outcome.decisionId !== decision.id ||
    !verifiedAt ||
    !validTimestamp(verifiedAt) ||
    !clean(validator.id) ||
    !eventOutcome ||
    provenanceRecordIds.length === 0
  ) {
    return null;
  }

  const evidence = outcome.evidenceReferences
    .map(reference => clean(reference.summary))
    .filter((value): value is string => Boolean(value));
  const summary = clean(outcome.summary);
  if (!summary || evidence.length === 0) return null;

  return {
    id: `decision-outcome-learning:${decision.id}:${outcome.id}`,
    source: 'decision_outcome',
    event: summary,
    outcome: eventOutcome,
    evidence,
    confidence: 'high',
    organizationId: decision.organizationId,
    projectId: decision.projectId,
    verifiedAt,
    verifiedBy: validator.id,
    verificationStatus: 'human_validated',
    provenanceRecordIds,
  };
}

function learningOutcome(
  outcome: PIEActualOutcomeRecord,
): PIELearningOutcome | null {
  switch (outcome.classification) {
    case 'successful':
      return 'worked';
    case 'partially_successful':
    case 'mixed':
      return 'partially_worked';
    case 'unsuccessful':
      return 'failed';
    case 'inconclusive':
    case 'not_implemented':
    case 'cancelled':
      return null;
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}
