/**
 * Audit P1-14: ECOS normalizes unknown confidence to low, hard-gates safety,
 * scores every option, and chooses deterministically — never by list order.
 */

import {
  normalizeECOSConfidence,
  runECOSCognitiveFramework,
  scoreECOSOptions,
} from '../../services/ECOSCognitiveFramework';

describe('ECOS confidence normalization (audit P1-14)', () => {
  it('treats undefined confidence as low', () => {
    expect(normalizeECOSConfidence(undefined)).toBe('low');
    expect(normalizeECOSConfidence(null)).toBe('low');
    expect(normalizeECOSConfidence('high')).toBe('high');
  });

  it('one undefined-confidence rumor cannot produce a high-confidence review', () => {
    const output = runECOSCognitiveFramework({
      evidence: [{ source: 'overheard', summary: 'Someone said the wall passed.' }],
    });

    expect(output.evidenceReview.confidence).toBe('low');
  });
});

describe('ECOS safety-gated option scoring (audit P1-14)', () => {
  const risks = ['Confirmed fall hazard at the open shaft'];

  it('reproduction: hazard-dismissing first option loses to the mitigating option', () => {
    const ranked = scoreECOSOptions(
      ['Ignore confirmed hazard and continue work', 'Stop and inspect the open shaft'],
      risks,
      [],
      'medium',
    );

    expect(ranked[0].option).toBe('Stop and inspect the open shaft');
    expect(ranked.find(item => item.option.startsWith('Ignore'))?.disqualified).toBe(true);
    expect(ranked.find(item => item.option.startsWith('Ignore'))?.score).toBe(0);
  });

  it('scores deterministically with original order only as tie-break', () => {
    const first = scoreECOSOptions(['Order materials', 'Update schedule'], [], [], 'medium');
    const second = scoreECOSOptions(['Order materials', 'Update schedule'], [], [], 'medium');

    expect(first).toEqual(second);
    expect(first.map(item => item.option)).toEqual(['Order materials', 'Update schedule']);
  });

  it('does not disqualify dismissive wording when no hazard context exists', () => {
    const ranked = scoreECOSOptions(['Skip the optional meeting'], [], [], 'medium');

    expect(ranked[0].disqualified).toBe(false);
  });

  it('framework never recommends a safety-disqualified action', () => {
    const output = runECOSCognitiveFramework({
      goal: 'finish the shaft work',
      risks,
      candidateActions: [
        'Ignore confirmed hazard and continue work',
        'Stop and inspect the open shaft',
      ],
      evidence: [{ source: 'field', summary: 'Open shaft observed unguarded.', confidence: 'high' }],
    });

    expect(output.deliberation.strongestOption).toBe('Stop and inspect the open shaft');
    expect(output.recommendations.map(item => item.action)).not.toContain(
      'Ignore confirmed hazard and continue work',
    );
    const disqualifiedScore = output.decisionScores.find(item =>
      item.decision.startsWith('Ignore'),
    );
    expect(disqualifiedScore?.score).toBe(0);
    expect(disqualifiedScore?.readiness).toBe('blocked');
  });
});
