/**
 * Audit P1-51: Executive Judgment assertions and trace evidence flow only
 * through the chosen supporting Reality objects — never from every object.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  listPIEExecutiveJudgmentsCloud: jest.fn(),
  savePIEExecutiveJudgmentCloud: jest.fn(),
}));

import { buildExecutiveJudgmentRecord } from '../../services/PIEExecutiveJudgmentRepository';
import { buildPIERecommendationTrace } from '../../services/PIETraceability';

function judgmentResult() {
  return {
    generatedAt: '2026-07-18T12:00:00Z',
    confidence: 'medium',
    authority: {
      organizationId: 'org-1',
      projectId: 'project-1',
      realityModelId: 'rm-1',
      realityModelVersion: 3,
      realitySnapshotId: 'snap-1',
      activeConflictIds: [],
      activeUncertaintyIds: [],
      evidenceCutoffTime: '2026-07-18T11:00:00Z',
      persistenceStatus: undefined,
    },
    highestValueAction: {
      action: 'Complete the electrical rough-in inspection',
      why: 'Electrical rough-in is the critical path.',
      governance: {
        alternativesConsidered: ['Wait for next week'],
        whatWouldChangeRecommendation: ['Failed inspection'],
      },
    },
    executiveDecisions: [{ decision: 'Proceed with electrical rough-in', owner: 'David' }],
    executiveJudgment: {
      bestActionIfEvidenceIncomplete: 'Collect current photos.',
      explanation: { whatMattersMost: 'Schedule integrity.' },
    },
    executiveJudgmentSummary: 'Electrical is the priority.',
    tradeoffAnalysis: { options: [] },
    executiveRisks: [],
    executiveConstraints: [],
    executiveOpportunities: [],
    executiveResourceNeeds: [],
    executivePriorities: [],
    escalationAnalysis: { justification: 'None needed.', shouldEscalate: false, target: { role: 'User' } },
    noActionReasoning: { reason: 'Delay risks schedule.' },
    waitForEvidenceReasoning: { evidenceNeeded: [] },
    actionSafetyCheck: { warnings: [] },
  } as never;
}

function realityModel() {
  return {
    objects: [
      {
        identity: { id: 'obj-electrical' },
        name: 'Electrical rough-in',
        assertions: [{ id: 'assert-electrical-1' }, { id: 'assert-electrical-2' }],
        sourceEvidenceReferences: [{ evidenceId: 'ev-electrical' }],
      },
      {
        identity: { id: 'obj-parking' },
        name: 'Parking lot',
        assertions: [{ id: 'assert-parking-1' }],
        sourceEvidenceReferences: [{ evidenceId: 'ev-parking' }],
      },
    ],
  } as never;
}

describe('judgment supporting-object trace (audit P1-51)', () => {
  it('selects assertions only from referenced supporting objects', () => {
    const record = buildExecutiveJudgmentRecord({
      result: judgmentResult(),
      realityModel: realityModel(),
      situationSummary: 'Field walk summary',
    });

    expect(record.supportingRealityObjectIds).toEqual(['obj-electrical']);
    expect(record.supportingAssertionIds).toEqual([
      'assert-electrical-1',
      'assert-electrical-2',
    ]);
    expect(record.supportingAssertionIds).not.toContain('assert-parking-1');
  });

  it('traces evidence only through the supporting objects', () => {
    const record = buildExecutiveJudgmentRecord({
      result: judgmentResult(),
      realityModel: realityModel(),
      situationSummary: 'Field walk summary',
    });

    const trace = buildPIERecommendationTrace({
      core: {
        bestNextStep: 'Complete the electrical rough-in inspection',
        executiveJudgmentRecord: record,
        realityModel: realityModel(),
      } as never,
    });

    expect(trace.evidenceIds).toEqual(['ev-electrical']);
    expect(trace.evidenceIds).not.toContain('ev-parking');
    expect(trace.realityObjectIds).toEqual(['obj-electrical']);
  });
});
