/**
 * Audit P1-13: evidence may strengthen or challenge a belief only when it is
 * about the belief's subject, and prior belief state drives lifecycle
 * (history carry-forward and explicit retirement).
 */

import {
  applyPreviousBeliefLifecycle,
  identifyContradictingEvidence,
  identifySupportingEvidence,
  type PIEBelief,
  type PIEBeliefEngineInput,
} from '../../services/PIEBeliefEngine';

const ELECTRICAL_BELIEF = 'Electrical rough-in is complete in Building A';

function engineInput(overrides: {
  whatChanged?: string;
  conflicts?: string[];
  readyObjectName?: string;
  blockedObjectName?: string;
}): PIEBeliefEngineInput {
  return {
    runtime: {
      generatedAt: '2026-07-18T12:00:00Z',
      intelligentSummary: {
        whatChanged: overrides.whatChanged || '',
        confidence: 'medium',
      },
      evidenceFusionSummary: { summary: '', confidence: 'medium' },
      evidenceConflicts: (overrides.conflicts || []).map((summary, index) => ({
        id: `conflict-${index}`,
        summary,
        confidence: 'medium',
      })),
      currentBeliefs: [],
      recommendedEvidence: [],
    },
    realityModel: overrides.readyObjectName || overrides.blockedObjectName
      ? {
          summary: { confidence: 'medium' },
          objects: [
            overrides.readyObjectName
              ? { name: overrides.readyObjectName, currentStatus: 'ready', currentState: { summary: '', confidence: 'medium' } }
              : null,
            overrides.blockedObjectName
              ? { name: overrides.blockedObjectName, currentStatus: 'blocked', currentState: { summary: 'Blocked pending inspection', confidence: 'medium' } }
              : null,
          ].filter(Boolean),
        }
      : null,
  } as unknown as PIEBeliefEngineInput;
}

function belief(id: string, statement: string, status: PIEBelief['status'] = 'supported'): PIEBelief {
  return {
    id,
    type: 'status',
    statement,
    status,
    confidence: 'medium',
    readiness: 'Ready',
    supportingEvidence: [],
    contradictingEvidence: [],
    assumptions: [],
    uncertainty: [],
    recommendedEvidence: [],
    explanation: {
      summary: '',
      supportingEvidence: [],
      contradictingEvidence: [],
      weakestAssumption: '',
      readinessReason: '',
    },
    history: {
      createdAt: '2026-07-01T00:00:00Z',
      lastRevisedAt: '2026-07-01T00:00:00Z',
      revisions: [
        {
          id: 'rev-1',
          previousStatus: 'forming',
          nextStatus: status,
          reason: 'Initial evidence.',
          revisedAt: '2026-07-01T00:00:00Z',
        },
      ],
    },
  } as unknown as PIEBelief;
}

describe('belief evidence subject linking (audit P1-13)', () => {
  it('rejects unrelated runtime changes as supporting evidence', () => {
    const support = identifySupportingEvidence(
      engineInput({ whatChanged: 'Parking lot restriping finished today' }),
      ELECTRICAL_BELIEF,
    );

    expect(support).toHaveLength(0);
  });

  it('accepts runtime changes about the belief subject', () => {
    const support = identifySupportingEvidence(
      engineInput({ whatChanged: 'Electrical rough-in passed inspection' }),
      ELECTRICAL_BELIEF,
    );

    expect(support.map(item => item.source)).toContain('Runtime');
  });

  it('only attaches ready reality objects that match the subject', () => {
    const unrelated = identifySupportingEvidence(
      engineInput({ readyObjectName: 'Roof membrane' }),
      ELECTRICAL_BELIEF,
    );
    const related = identifySupportingEvidence(
      engineInput({ readyObjectName: 'Electrical rough-in' }),
      ELECTRICAL_BELIEF,
    );

    expect(unrelated).toHaveLength(0);
    expect(related.map(item => item.source)).toContain('Reality Model');
  });

  it('rejects unrelated conflicts as contradictions', () => {
    const contradictions = identifyContradictingEvidence(
      engineInput({ conflicts: ['Parking count mismatch between sources'] }),
      ELECTRICAL_BELIEF,
    );

    expect(contradictions).toHaveLength(0);
  });

  it('accepts conflicts about the belief subject as contradictions', () => {
    const contradictions = identifyContradictingEvidence(
      engineInput({ conflicts: ['Electrical panel schedule conflict reported'] }),
      ELECTRICAL_BELIEF,
    );

    expect(contradictions.map(item => item.source)).toContain('Evidence Fusion');
  });

  it('only attaches blocked reality objects that match the subject', () => {
    const unrelated = identifyContradictingEvidence(
      engineInput({ blockedObjectName: 'Landscaping irrigation' }),
      ELECTRICAL_BELIEF,
    );
    const related = identifyContradictingEvidence(
      engineInput({ blockedObjectName: 'Electrical service entrance' }),
      ELECTRICAL_BELIEF,
    );

    expect(unrelated).toHaveLength(0);
    expect(related.map(item => item.source)).toContain('Reality Model');
  });
});

describe('previous belief lifecycle (audit P1-13)', () => {
  const NOW = '2026-07-18T12:00:00Z';

  it('carries forward creation time and revision history for matching beliefs', () => {
    const previous = belief('b1', ELECTRICAL_BELIEF);
    const current = { ...belief('b1', ELECTRICAL_BELIEF), history: { createdAt: NOW, lastRevisedAt: NOW, revisions: [] } };

    const [merged] = applyPreviousBeliefLifecycle([current], [previous], NOW);

    expect(merged.history.createdAt).toBe('2026-07-01T00:00:00Z');
    expect(merged.history.revisions).toHaveLength(1);
  });

  it('retires previous beliefs with no current counterpart', () => {
    const previous = belief('gone', 'Concrete pour is scheduled for Friday');
    const current = belief('b1', ELECTRICAL_BELIEF);

    const result = applyPreviousBeliefLifecycle([current], [previous], NOW);

    const retired = result.find(item => item.id === 'gone');
    expect(retired?.status).toBe('retired');
    expect(result[0].status).toBe('supported');
  });

  it('does not re-retire already retired beliefs', () => {
    const previous = belief('gone', 'Old belief', 'retired');

    const result = applyPreviousBeliefLifecycle([belief('b1', ELECTRICAL_BELIEF)], [previous], NOW);

    expect(result.filter(item => item.id === 'gone')).toHaveLength(0);
  });
});
