/**
 * Whole-app audit A5 pass 8 L4 (30 Sep 2026, from 8d5ddd0): in a percent
 * column, a decimal written without its leading zero was read wrong.
 *
 * A column with any number above 1 reads as percents (A5 pass 7 L1). There
 * ".5" read 5% and ".25" read 25%, because the reader took the digits after
 * the dot, while "0.5" read 0%. Older: "99.6" was cut to 99%, where the
 * progress rule (reconcileScheduleProgress) rounds 99.6 to 100%.
 *
 * Now a percent cell's number is read whole and rounded as the progress rule
 * rounds it: ".5" and "0.5" are both half a percent, 1%; ".25" is 0%; "99.6"
 * is 100%, Complete. Fraction columns are unchanged. Synthetic data.
 */
import type { ScheduleItem } from '../../types';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { reconcileScheduleProgress } from '../../services/ScheduleProgressInvariant';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const percents = (cells: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,% Complete', ...cells.map((value, index) => `Task ${index + 1},Alpha,Lot,10/01/2026,10/03/2026,${value}`)].join('\n'),
  sourceName: 'Alpha lookahead.csv', mimeType: 'text/csv', projects: ['Alpha'], now: new Date('2026-09-30T12:00:00.000Z'),
}).items as ScheduleItem[]).map(row => [row.percentComplete, row.status]);

describe('A5 p8 L4: a percent column reads a decimal as its whole number, rounded', () => {
  it('".5" reads as "0.5" does (1%), and ".25" as 0%, in a column with a number above 1', () => {
    expect(percents(['.5', '0.5', '.25', '75'])).toEqual([
      [1, 'In Progress'], [1, 'In Progress'], [0, 'Not Started'], [75, 'In Progress'],
    ]);
  });

  it('"99.6" rounds to 100% Complete, as the progress rule rounds it; "40.4%" is 40%', () => {
    expect(reconcileScheduleProgress('In Progress', 99.6)).toEqual({ status: 'Complete', percentComplete: 100 });
    expect(percents(['99.6', '40.4%', '45'])).toEqual([[100, 'Complete'], [40, 'In Progress'], [45, 'In Progress']]);
  });

  it('a column of fractions is unchanged: .25 is 25%', () => {
    expect(percents(['.25', '0.4', '1'])).toEqual([[25, 'In Progress'], [40, 'In Progress'], [100, 'Complete']]);
  });

  it('Microsoft Project rows the same way', () => {
    const rows = normalizeMicrosoftProjectPdfRows({
      contents: [
        'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
        '1\tAlpha\t0\t60 days\t09/01/2026\t12/15/2026\t0',
        '2\tPour slab\t1\t3 days\t10/01/2026\t10/03/2026\t.5',
        '3\tRoofing\t1\t10 days\t12/01/2026\t12/15/2026\t99.6',
        '4\tPaint\t1\t10 days\t12/01/2026\t12/15/2026\t.25',
      ].join('\n'),
      sourceName: 'Alpha.pdf', projects: ['Alpha'], now: new Date('2026-09-30T12:00:00.000Z'),
    });
    expect(rows.map(row => [row.taskName, row.percentComplete])).toEqual([['Pour slab', 1], ['Roofing', 100], ['Paint', 0]]);
  });
});
