/**
 * Audit P1-37: corrected decision versions must be operative. The original
 * immutableSnapshot is retained only as the audit baseline; validation and
 * resolution must use versions[currentVersion].
 */

import {
  appendDecisionSnapshotVersion,
  buildPredictedOutcome,
  createDecisionRecord,
  currentDecisionSnapshot,
  validateDecisionTransition,
  type PIEActor,
  type PIEDecisionSnapshot,
} from '../../services/PIEDecisionLedger';

const ORG = 'org-1';
const PROJECT = 'project-1';

const actor: PIEActor = {
  id: 'user-1',
  name: 'David',
  role: 'system',
  organizationId: ORG,
};

function snapshot(overrides: Partial<PIEDecisionSnapshot> = {}): PIEDecisionSnapshot {
  return {
    projectId: PROJECT,
    situationId: 'situation-1',
    recommendationId: 'rec-1',
    selectedOption: 'Pour foundation Monday',
    decisionOwner: 'David',
    decisionAuthority: 'David',
    decisionDate: '2026-07-18',
    evidenceAvailable: [],
    knownEvidenceGaps: [],
    assumptions: [],
    risks: [],
    constraints: [],
    predictedOutcomes: [],
    recommendationConfidence: 'medium',
    confidenceExplanation: 'Based on schedule evidence.',
    selectedReason: 'Weather window is open.',
    ...overrides,
  };
}

function predicted() {
  return buildPredictedOutcome({
    description: 'Foundation cured',
    measurableResult: 'Cure test passes',
    expectedDirection: 'increase',
    expectedReviewDate: '2026-08-01',
    evidenceRequired: ['photo'],
    responsibleOwner: 'David',
    validationAuthority: 'David',
    predictionConfidence: 'medium',
    rationale: 'Standard cure time.',
  });
}

describe('decision current-version resolution (audit P1-37)', () => {
  it('resolves the corrected snapshot as operative after a version append', () => {
    const original = createDecisionRecord({
      organizationId: ORG,
      projectId: PROJECT,
      snapshot: snapshot(),
      createdBy: actor,
    });

    const corrected = appendDecisionSnapshotVersion(
      original,
      snapshot({ selectedOption: 'Pour foundation Tuesday', predictedOutcomes: [predicted()] }),
      actor,
      'Corrected pour date after weather update.',
    );

    expect(currentDecisionSnapshot(corrected).selectedOption).toBe('Pour foundation Tuesday');
    // The original stays intact as the audit baseline.
    expect(corrected.immutableSnapshot.selectedOption).toBe('Pour foundation Monday');
    expect(corrected.currentVersion).toBe(2);
  });

  it('falls back to the original snapshot for version-1 records', () => {
    const record = createDecisionRecord({
      organizationId: ORG,
      projectId: PROJECT,
      snapshot: snapshot(),
      createdBy: actor,
    });

    expect(currentDecisionSnapshot(record)).toEqual(record.immutableSnapshot);
  });

  it('validates implemented transitions against the corrected snapshot, not the original', () => {
    const original = createDecisionRecord({
      organizationId: ORG,
      projectId: PROJECT,
      snapshot: snapshot(), // original has NO predicted outcomes
      createdBy: actor,
    });
    const corrected = appendDecisionSnapshotVersion(
      original,
      snapshot({ predictedOutcomes: [predicted()] }),
      actor,
      'Added measurable predicted outcome.',
    );
    const approved = { ...corrected, currentStatus: 'approved' as const };

    const result = validateDecisionTransition({
      decision: approved,
      nextStatus: 'implemented',
      actor,
      reason: 'Work started.',
      source: 'user',
      outcomePlan: {
        decisionId: approved.id,
        steps: [],
        evidenceReferences: [],
        reviewCadenceDays: 7,
        createdAt: new Date().toISOString(),
        createdBy: actor,
      } as never,
    });

    expect(
      result.reasons.filter(reason => reason.includes('predicted outcome')),
    ).toHaveLength(0);
  });

  it('blocks implemented transitions when the corrected snapshot removed all predicted outcomes', () => {
    const original = createDecisionRecord({
      organizationId: ORG,
      projectId: PROJECT,
      snapshot: snapshot({ predictedOutcomes: [predicted()] }),
      createdBy: actor,
    });
    const corrected = appendDecisionSnapshotVersion(
      original,
      snapshot({ predictedOutcomes: [] }),
      actor,
      'Correction removed outcomes.',
    );
    const approved = { ...corrected, currentStatus: 'approved' as const };

    const result = validateDecisionTransition({
      decision: approved,
      nextStatus: 'implemented',
      actor,
      reason: 'Work started.',
      source: 'user',
    });

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toContain('predicted outcome');
  });
});
