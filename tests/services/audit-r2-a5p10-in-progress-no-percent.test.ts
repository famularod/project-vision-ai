/**
 * Whole-app audit A5 pass 10 L1 (30 Sep 2026): the pass 9 L5 fix covered
 * only part of "In Progress with a blank percent".
 *
 * (a) A schedule PDF read by the extraction service: a row "In Progress"
 * with no percent still came in as Not Started at 0%, since the reading gave
 * the progress rule 0 for no number. It now gives no number, and the rule
 * reads In Progress 1%.
 *
 * (b) A task already saved at Not Started 0% stayed Not Started when a newer
 * master or lookahead row said "In Progress" with no percent: a row with no
 * percent never changes a saved task's progress (A5 pass 5 H1). Over Not
 * Started 0% it now takes In Progress 1%: upward only, never lowering a
 * percent and never over one stated. Synthetic data.
 */
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleItemsFromRemoteExtractorPayload } from '../../services/PIEScheduleRemoteExtraction';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';

const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...extra,
}) as ReferenceDocument;
const masterA = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const masterB = schedule('MASTER B', '2026-09-26T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });

const HEADER = 'Task,Project,Area,Start,Finish,Status,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, state.documents),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pour = (state: State) => shown(state).filter(item => item.taskName === 'Pour slab').map(item => [item.status, item.percentComplete]);

describe('A5 p10 L1 (a): a schedule PDF\'s "In Progress" row with no percent reads In Progress 1%', () => {
  it('a blank or missing percent under each status, and a real 0%', () => {
    const result = scheduleItemsFromRemoteExtractorPayload({
      items: [
        { taskName: 'Pour slab', status: 'In Progress', percentComplete: '', finishDate: '10/03/2026' },
        { taskName: 'Roofing', status: 'In Progress', finishDate: '12/15/2026' },
        { taskName: 'Framing', status: 'Complete', finishDate: '11/15/2026' },
        { taskName: 'Paint', status: 'Not Started', finishDate: '12/20/2026' },
        { taskName: 'Deck', status: 'In Progress', percentComplete: '0%', finishDate: '12/22/2026' },
      ],
    }, { fileName: 'master.pdf', projects: ['Alpha'], extractedAt: '2026-09-30T12:00:00.000Z' });
    expect(result.items.map(item => [item.taskName, item.status, item.percentComplete])).toEqual([
      ['Pour slab', 'In Progress', 1],
      ['Roofing', 'In Progress', 1],
      ['Framing', 'Complete', 100],
      ['Paint', 'Not Started', 0],
      ['Deck', 'Not Started', 0],
    ]);
    // It still states no percent, so it never lowers a saved task's.
    expect(result.items[0].percentCompleteStated).toBe(false);
  });
});

describe('A5 p10 L1 (b): "In Progress" with no percent over a task Not Started at 0%', () => {
  const atA = approve({ items: [], documents: [] }, masterA, rows(masterA, [
    'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,Not Started,0%',
  ]));

  it('a newer master restating it on its dates: In Progress 1%', () => {
    expect(pour(atA)).toEqual([['Not Started', 0]]);
    expect(pour(approve(atA, masterB, rows(masterB, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,'])))).toEqual([['In Progress', 1]]);
  });

  it('a newer master moving it: In Progress 1%', () => {
    expect(pour(approve(atA, masterB, rows(masterB, ['Pour slab,Alpha,Lot,10/02/2026,10/04/2026,In Progress,'])))).toEqual([['In Progress', 1]]);
  });

  it('a lookahead row: In Progress 1%, and deleting the lookahead gives Not Started 0% back', () => {
    const withL = approve(atA, lookahead, rows(lookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,']));
    expect(pour(withL)).toEqual([['In Progress', 1]]);
    const removed = scheduleItemsOnlyInImportBatch(withL.items, lookahead, withL.documents);
    const items = withL.items.filter(item => !removed.includes(item));
    const documents = withL.documents.filter(saved => saved.id !== lookahead.id);
    const changed = new Map(scheduleItemsAfterScheduleDeleted({ items, removed, document: lookahead, documents, updatedAt: '2026-09-28T00:00:00.000Z' })
      .map(item => [item.id, item]));
    expect(pour({ items: items.map(item => changed.get(item.id) || item), documents })).toEqual([['Not Started', 0]]);
  });

  it('upward only: a task at 40% or 30% keeps it, and a stated 0% leaves Not Started', () => {
    const at40 = { ...atA, items: atA.items.map(item => ({ ...item, percentComplete: 40, status: 'In Progress' }) as ScheduleItem) };
    expect(pour(approve(at40, masterB, rows(masterB, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,'])))).toEqual([['In Progress', 40]]);
    expect(pour(approve(atA, masterB, rows(masterB, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,In Progress,0%'])))).toEqual([['Not Started', 0]]);
    expect(pour(approve(atA, masterB, rows(masterB, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,Not Started,'])))).toEqual([['Not Started', 0]]);
  });
});
