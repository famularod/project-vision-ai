/**
 * Audit P1-03: evidence readiness must reflect the whole evidence base.
 * One strong item among many insufficient ones is not strong readiness.
 */

import {
  detectEvidenceConflicts,
  evidenceReadinessFromItems,
  scoreEvidenceFreshness,
  type PIEEvidenceConflict,
  type PIEEvidenceQualityItem,
} from '../../services/PIEEvidenceQuality';

function item(
  value: number,
  level: PIEEvidenceQualityItem['score']['level'],
): PIEEvidenceQualityItem {
  return {
    score: { value, level, confidence: 'medium' },
  } as PIEEvidenceQualityItem;
}

const conflict: PIEEvidenceConflict = {
  id: 'c1',
  evidenceIds: ['a', 'b'],
  summary: 'Sources disagree.',
  severity: 'high',
};

describe('evidenceReadinessFromItems (audit P1-03)', () => {
  it('reproduction: one strong + nine insufficient is insufficient, not strong', () => {
    const items = [item(90, 'strong'), ...Array.from({ length: 9 }, () => item(18, 'insufficient'))];

    expect(evidenceReadinessFromItems(items, [])).toBe('insufficient');
  });

  it('a majority of insufficient items blocks readiness regardless of average', () => {
    const items = [item(95, 'strong'), item(95, 'strong'), item(10, 'insufficient'), item(10, 'insufficient'), item(10, 'insufficient')];

    expect(evidenceReadinessFromItems(items, [])).toBe('insufficient');
  });

  it('uniformly strong evidence is strong', () => {
    const items = [item(90, 'strong'), item(88, 'strong'), item(92, 'strong')];

    expect(evidenceReadinessFromItems(items, [])).toBe('strong');
  });

  it('mixed good evidence lands on the average, not the best item', () => {
    const items = [item(90, 'strong'), item(60, 'weak'), item(60, 'weak')];

    expect(evidenceReadinessFromItems(items, [])).toBe('good');
  });

  it('conflicts block readiness entirely', () => {
    const items = [item(95, 'strong'), item(95, 'strong')];

    expect(evidenceReadinessFromItems(items, [conflict])).toBe('conflicting');
  });

  it('empty evidence is insufficient and all-stale evidence is stale', () => {
    expect(evidenceReadinessFromItems([], [])).toBe('insufficient');
    expect(evidenceReadinessFromItems([item(25, 'stale'), item(25, 'stale')], [])).toBe('stale');
  });
});

describe('evidence authority boundaries', () => {
  it('does not call completion and approval different domains a contradiction', () => {
    const conflicts = detectEvidenceConflicts([
      {
        id: 'complete',
        source: 'field',
        summary: 'Electrical rough-in is complete.',
      },
      {
        id: 'approval',
        source: 'inspection',
        summary: 'Electrical rough-in is not approved.',
      },
    ]);

    expect(conflicts).toEqual([]);
  });

  it('does not call incomplete but unblocked work a contradiction', () => {
    const conflicts = detectEvidenceConflicts([
      {
        id: 'incomplete',
        source: 'field',
        summary: 'Electrical rough-in is not complete.',
      },
      {
        id: 'unblocked',
        source: 'field',
        summary: 'Electrical rough-in is no longer blocked.',
      },
    ]);

    expect(conflicts).toEqual([]);
  });

  it('still detects opposite completion claims for the same subject', () => {
    const conflicts = detectEvidenceConflicts([
      {
        id: 'complete',
        source: 'field',
        summary: 'Electrical rough-in is complete.',
      },
      {
        id: 'incomplete',
        source: 'inspection',
        summary: 'Electrical rough-in is not complete.',
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].evidenceIds).toEqual(['complete', 'incomplete']);
  });

  it('never awards maximum freshness to future-dated evidence', () => {
    const freshness = scoreEvidenceFreshness(
      {
        id: 'future',
        source: 'device',
        summary: 'Future-clock field update.',
        capturedAt: '2026-07-20T12:00:00.000Z',
      },
      '2026-07-18T12:00:00.000Z',
    );

    expect(freshness.level).toBe('insufficient');
    expect(freshness.score).toBeLessThan(45);
    expect(freshness.ageDays).toBeLessThan(0);
  });
});
