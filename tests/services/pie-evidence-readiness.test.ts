/**
 * Audit P1-03: evidence readiness must reflect the whole evidence base.
 * One strong item among many insufficient ones is not strong readiness.
 */

import {
  evidenceReadinessFromItems,
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
