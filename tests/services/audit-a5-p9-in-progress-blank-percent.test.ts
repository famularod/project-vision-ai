/**
 * Whole-app audit A5 pass 9 L5 (30 Sep 2026): a schedule row with Status "In
 * Progress" and a blank or missing % Complete read as Not Started at 0%.
 *
 * The percent reading returned 0 for a cell with no number, so the progress
 * rule (reconcileScheduleProgress: In Progress with no number is 1%, Complete
 * is 100%) never applied, and 0% with In Progress became Not Started. A cell
 * with no number is now no number: the status decides. A real "0" or "0%"
 * still reads 0%, and a row with no percent still never changes the percent
 * of a task already saved (A5 pass 5 H1). Synthetic data.
 */
import type { ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';

const read = (header: string, lines: string[]) => normalizeScheduleImport({
  contents: [header, ...lines].join('\n'), sourceName: 'MASTER 0930.csv', mimeType: 'text/csv', projects: ['Alpha'],
  now: new Date('2026-09-30T12:00:00.000Z'),
}).items as ScheduleItem[];
const progress = (items: readonly ScheduleItem[]) => items.map(item => [item.taskName, item.status, item.percentComplete]);

describe('A5 p9 L5: In Progress with no percent reads In Progress', () => {
  it('a blank % Complete cell: the status decides (In Progress 1%, Complete 100%, Not Started 0%)', () => {
    const items = read('Task,Project,Area,Start,Finish,Status,% Complete', [
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,',
      'Roofing,Alpha,Lot,12/01/2026,12/15/2026,Complete,',
      'Framing,Alpha,Lot,11/01/2026,11/15/2026,Not Started,',
    ]);
    expect(progress(items)).toEqual([
      ['Pour slab', 'In Progress', 1],
      ['Roofing', 'Complete', 100],
      ['Framing', 'Not Started', 0],
    ]);
  });

  it('no % Complete column at all: In Progress is 1%', () => {
    const items = read('Task,Project,Area,Start,Finish,Status', ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress']);
    expect(progress(items)).toEqual([['Pour slab', 'In Progress', 1]]);
  });

  it('a real 0 or 0% still reads 0%', () => {
    const items = read('Task,Project,Area,Start,Finish,Status,% Complete', [
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,0',
      'Roofing,Alpha,Lot,12/01/2026,12/15/2026,In Progress,0%',
      'Framing,Alpha,Lot,11/01/2026,11/15/2026,In Progress,35%',
    ]);
    expect(items.map(item => item.percentComplete)).toEqual([0, 0, 35]);
  });

  it('a blank cell on a task already saved leaves its percent (David\'s 40%, and a file\'s 30%)', () => {
    const [row] = read('Task,Project,Area,Start,Finish,Status,% Complete', ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,']);
    expect(row.percentCompleteStated).toBe(false);
    const saved = (extra: Partial<ScheduleItem>) => ({
      ...row, id: 'saved-pour', importBatchId: 'batch-old', sourceDocumentId: 'old', percentCompleteStated: undefined, ...extra,
    }) as ScheduleItem;
    const imported = { ...row, id: 'new-pour', importBatchId: 'batch-new', sourceDocumentId: 'new' } as ScheduleItem;
    for (const [task, percent] of [
      [saved({ percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-20T12:00:00.000Z' }), 40],
      [saved({ percentComplete: 30, status: 'In Progress', progressSource: 'schedule_import' }), 30],
    ] as const) {
      const merged = mergeApprovedScheduleImportItems({
        existing: [task], imported: [imported], completionMatch: () => null, mergeCompletion: item => item, approvedAt: '2026-09-30T12:00:00.000Z',
      });
      const pour = [...merged.next, ...merged.additions].filter(item => item.taskName === 'Pour slab');
      expect(pour.map(item => item.percentComplete)).toEqual([percent]);
    }
  });
});
