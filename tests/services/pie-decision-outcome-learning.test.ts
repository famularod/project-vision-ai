import {
  buildVerifiedLearningEventsFromDecisionLedger,
} from '../../services/PIEDecisionOutcomeLearning';
import type {
  PIEActualOutcomeRecord,
  PIEDecisionRecord,
} from '../../services/PIEDecisionLedger';

const validator = {
  id: 'pm-validator-1',
  name: 'Project manager',
  role: 'validation_authority' as const,
  organizationId: 'org-1',
};

function outcome(
  overrides: Partial<PIEActualOutcomeRecord> = {},
): PIEActualOutcomeRecord {
  return {
    id: 'outcome-1',
    decisionId: 'decision-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    classification: 'successful',
    summary: 'The recovery plan restored the planned sequence.',
    actualResults: ['Work resumed.'],
    measuredValues: {},
    predictionComparisons: [],
    evidenceReferences: [{
      id: 'schedule-item-17',
      sourceType: 'schedule_item',
      organizationId: 'org-1',
      projectId: 'project-1',
      summary: 'Task returned to in-progress status.',
      capturedAt: '2026-07-22T15:00:00.000Z',
    }],
    unintendedConsequences: [],
    confoundingFactors: [],
    observationPeriod: {
      startedAt: '2026-07-21T15:00:00.000Z',
      endedAt: '2026-07-22T15:00:00.000Z',
    },
    validationStatus: 'human_validated',
    validator,
    validationDate: '2026-07-22T16:00:00.000Z',
    createdAt: '2026-07-22T15:30:00.000Z',
    createdBy: validator,
    ...overrides,
  };
}

function decision(
  actualOutcomes: PIEActualOutcomeRecord[],
  overrides: Partial<PIEDecisionRecord> = {},
): PIEDecisionRecord {
  return {
    id: 'decision-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    currentStatus: 'outcome_validated',
    currentVersion: 1,
    immutableSnapshot: {} as PIEDecisionRecord['immutableSnapshot'],
    versions: [],
    actualOutcomes,
    auditHistory: [],
    createdAt: '2026-07-21T12:00:00.000Z',
    createdBy: validator,
    updatedAt: '2026-07-22T16:00:00.000Z',
    closeBlockers: [],
    ...overrides,
  };
}

describe('verified decision outcome learning (audit P1-12)', () => {
  it('converts a matching human-validated outcome into a traceable learning event', () => {
    const events = buildVerifiedLearningEventsFromDecisionLedger({
      decisions: [decision([outcome()])],
      organizationId: 'org-1',
      projectId: 'project-1',
    });

    expect(events).toEqual([expect.objectContaining({
      id: 'decision-outcome-learning:decision-1:outcome-1',
      source: 'decision_outcome',
      outcome: 'worked',
      verifiedBy: 'pm-validator-1',
      provenanceRecordIds: ['schedule-item-17'],
    })]);
  });

  it.each([
    ['unvalidated outcome', outcome({ validationStatus: 'unvalidated' })],
    ['system-supported outcome', outcome({ validationStatus: 'system_supported' })],
    ['missing evidence', outcome({ evidenceReferences: [] })],
    ['wrong project', outcome({ projectId: 'project-2' })],
    ['inconclusive outcome', outcome({ classification: 'inconclusive' })],
  ])('rejects %s', (_label, invalidOutcome) => {
    const events = buildVerifiedLearningEventsFromDecisionLedger({
      decisions: [decision([invalidOutcome])],
      organizationId: 'org-1',
      projectId: 'project-1',
    });

    expect(events).toEqual([]);
  });

  it('does not cross organization or project boundaries', () => {
    const records = [decision([outcome()])];

    expect(buildVerifiedLearningEventsFromDecisionLedger({
      decisions: records,
      organizationId: 'org-2',
      projectId: 'project-1',
    })).toEqual([]);
    expect(buildVerifiedLearningEventsFromDecisionLedger({
      decisions: records,
      organizationId: 'org-1',
      projectId: 'project-2',
    })).toEqual([]);
  });
});
