import {
  detectMaterialSimulationChange,
  scoreDecisionOption,
  type PIEDecisionOption,
  type PIEDecisionOptionScore,
  type PIEDecisionSimulationInput,
} from '../../services/PIEDecisionSimulation';

function option(overrides: Partial<PIEDecisionOption> = {}): PIEDecisionOption {
  return {
    optionId: 'option-1',
    optionType: 'recommended_action',
    action: 'Stop work, isolate the area, and inspect the hazard.',
    rationale: 'Protect people while the condition is verified.',
    prerequisites: [],
    expectedOutcome: 'The area remains controlled.',
    expectedTimeframe: 'Now',
    estimatedCostDirection: 'unknown',
    scheduleImpact: 'delays',
    resourceImpact: 'Safety lead required.',
    safetyImpact: 'Safety risk considered: Critical fall hazard is present.',
    complianceImpact: 'Compliance constraint considered: Inspection is required.',
    operationalImpact: 'Work pauses in the affected area.',
    reversibility: 'high',
    evidenceRequired: [],
    assumptions: [],
    risks: ['Critical fall hazard is present.'],
    uncertainty: [],
    authorityRequired: 'Safety lead',
    ...overrides,
  };
}

function input(): PIEDecisionSimulationInput {
  return {
    executiveJudgment: {
      executiveRisks: [{
        id: 'risk-safety',
        risk: 'Critical fall hazard is present.',
        whyItMatters: 'A worker could be injured.',
        severity: 'critical',
        shouldEscalate: true,
        confidence: 'high',
      }],
      confidence: 'high',
    },
  } as PIEDecisionSimulationInput;
}

function score(id: string, value: number, disqualified = false): PIEDecisionOptionScore {
  return {
    optionId: id,
    components: [],
    totalWeightedScore: value,
    disqualified,
    disqualificationReasons: [],
    explanation: '',
  };
}

describe('decision safety and material-change gates', () => {
  it('does not disqualify a protective action merely because shared context names a critical safety risk', () => {
    const result = scoreDecisionOption(option(), input(), []);

    expect(result.disqualified).toBe(false);
  });

  it('disqualifies no action and unprotected delay while a high safety hazard is active', () => {
    const noAction = scoreDecisionOption(option({
      optionId: 'no-action',
      optionType: 'no_action',
      action: 'Take no immediate action and monitor.',
    }), input(), []);
    const delay = scoreDecisionOption(option({
      optionId: 'delay',
      optionType: 'delay_and_gather_evidence',
      action: 'Wait until tomorrow and take another photo.',
    }), input(), []);

    expect(noAction.disqualified).toBe(true);
    expect(delay.disqualified).toBe(true);
  });

  it('disqualifies an action that explicitly ignores a hazard', () => {
    const result = scoreDecisionOption(option({
      action: 'Ignore the confirmed safety hazard and continue production.',
    }), input(), []);

    expect(result.disqualified).toBe(true);
  });

  it('does not treat shared compliance context as an option-specific violation', () => {
    const result = scoreDecisionOption(option({
      action: 'Pause and obtain the required permit.',
      complianceImpact: 'Compliance constraint considered: Non-compliance is a current project risk.',
    }), input(), []);

    expect(result.disqualified).toBe(false);
  });

  it('compares the preferred option score rather than the first array entry', () => {
    const current = option({ optionId: 'preferred' });
    const reasons = detectMaterialSimulationChange({
      ...input(),
      priorSimulation: {
        inputSignature: 'same',
        selectedOption: current,
        scores: [score('unrelated', 90), score('preferred', 40)],
      },
    }, 'same', current, [score('unrelated', 90), score('preferred', 55)]);

    expect(reasons).toContain('Option ranking or score changed materially.');
  });
});
