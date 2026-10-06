/**
 * @jest-environment node
 */
import { buildDAVEReportSnapshot, compareDAVEReportSnapshots } from '../../services/DAVEReportSnapshot';

// R1 item 6 (8 Oct 2026, the owner's open items). "Inspection finish is back
// to the master schedule's 10/05/2026 (the previous lookahead showed
// 10/14/2026)." The date in brackets was the replaced lookahead's own. When a
// lookahead came and went between two reports, that was a date no report had
// ever shown: the last report said 10/12. The bracket now shows the date the
// earlier report showed. Two reports as they are kept. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type Extra = Record<string, unknown>;
const inspection = (startDate: string, finishDate: string, extra: Extra = {}) => ({
  taskId: 'inspection', taskName: 'Inspection', areaName: 'Lot', owner: null, status: 'Not Started', percentComplete: 0,
  startDate, finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
});
const kept = (schedule: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
  truths: [{ projectName: 'Tower', schedule } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
});
const lines = (previous: unknown[], current: unknown[]) =>
  compareDAVEReportSnapshots({ previous: kept(previous, '2026-09-08T15:00:00.000Z'), current: kept(current, '2026-09-12T15:00:00.000Z') })
    .changes.map(change => change.summary).sort();

describe('R1 item 6: the date in brackets is the one the earlier report showed', () => {
  it('a second lookahead came and went between the two reports: the bracket shows the last report\'s dates, not that lookahead\'s', () => {
    // The last report had Inspection on lookahead A's dates. Lookahead B re-dated it (no report went out), and
    // lookahead C, which does not list it, replaced B: it is back on the master's dates, with B's kept beside it.
    expect(lines(
      [inspection('10/07/2026', '10/12/2026', { onLookaheadDates: true })],
      [inspection('10/01/2026', '10/05/2026', { replacedLookaheadDates: { startDate: '10/09/2026', finishDate: '10/14/2026' } })],
    )).toEqual([
      "Inspection finish is back to the master schedule's 10/05/2026 (the previous lookahead showed 10/12/2026).",
      "Inspection start is back to the master schedule's 10/01/2026 (the previous lookahead showed 10/07/2026).",
    ]);
  });

  it('guard: the usual case (the replaced lookahead is the one the last report was on) reads as before', () => {
    expect(lines(
      [inspection('10/07/2026', '10/12/2026', { onLookaheadDates: true })],
      [inspection('10/01/2026', '10/05/2026', { replacedLookaheadDates: { startDate: '10/07/2026', finishDate: '10/12/2026' } })],
    )).toEqual([
      "Inspection finish is back to the master schedule's 10/05/2026 (the previous lookahead showed 10/12/2026).",
      "Inspection start is back to the master schedule's 10/01/2026 (the previous lookahead showed 10/07/2026).",
    ]);
  });

  it('guard: a date that did not come back from a lookahead reads "changed from ... to ..." as before', () => {
    expect(lines([inspection('10/07/2026', '10/12/2026')], [inspection('10/01/2026', '10/05/2026')]))
      .toEqual(['Inspection finish changed from 10/12/2026 to 10/05/2026.']);
  });
});
