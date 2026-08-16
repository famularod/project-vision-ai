/**
 * Audit P1-38: the append-only cloud judgment table cannot rewrite old rows,
 * so supersession must be derived from the history rather than stored
 * mutations. A judgment is superseded by the first later judgment with a
 * different primary recommendation.
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

import { resolveJudgmentSupersession } from '../../services/PIEExecutiveJudgmentRepository';
import type { PIEExecutiveJudgmentRecord } from '../../services/PIEExecutiveJudgmentRepository';

function judgment(
  id: string,
  judgmentTime: string,
  primaryRecommendation: string,
  overrides: Partial<PIEExecutiveJudgmentRecord> = {},
): PIEExecutiveJudgmentRecord {
  return {
    id,
    judgmentTime,
    primaryRecommendation,
    supersededBy: null,
    supersededAt: null,
  } as PIEExecutiveJudgmentRecord & { supersededBy: string | null };
}

describe('resolveJudgmentSupersession (audit P1-38)', () => {
  it('marks older judgments superseded by the first later different recommendation', () => {
    const records = [
      judgment('j3', '2026-07-18T12:00:00Z', 'Pour Tuesday'),
      judgment('j2', '2026-07-18T10:00:00Z', 'Pour Tuesday'),
      judgment('j1', '2026-07-18T08:00:00Z', 'Pour Monday'),
    ];

    const resolved = resolveJudgmentSupersession(records);

    const j1 = resolved.find(record => record.id === 'j1');
    expect(j1?.supersededBy).toBe('j2');
    expect(j1?.supersededAt).toBe('2026-07-18T10:00:00Z');
  });

  it('keeps same-recommendation successors from superseding earlier judgments', () => {
    const records = [
      judgment('j2', '2026-07-18T10:00:00Z', 'Pour Monday'),
      judgment('j1', '2026-07-18T08:00:00Z', 'Pour Monday'),
    ];

    const resolved = resolveJudgmentSupersession(records);

    expect(resolved.every(record => record.supersededBy === null)).toBe(true);
  });

  it('never rewrites an explicitly stored supersession', () => {
    const stored = {
      ...judgment('j1', '2026-07-18T08:00:00Z', 'Pour Monday'),
      supersededBy: 'legacy-id',
      supersededAt: '2026-07-18T09:00:00Z',
    };
    const records = [judgment('j2', '2026-07-18T10:00:00Z', 'Pour Tuesday'), stored];

    const resolved = resolveJudgmentSupersession(records);

    expect(resolved.find(record => record.id === 'j1')?.supersededBy).toBe('legacy-id');
  });

  it('resolves the newest non-superseded judgment as active', () => {
    const records = [
      judgment('j3', '2026-07-18T12:00:00Z', 'Pour Wednesday'),
      judgment('j2', '2026-07-18T10:00:00Z', 'Pour Tuesday'),
      judgment('j1', '2026-07-18T08:00:00Z', 'Pour Monday'),
    ];

    const resolved = resolveJudgmentSupersession(records);
    const active = resolved.filter(record => !record.supersededBy);

    expect(active.map(record => record.id)).toEqual(['j3']);
  });
});
