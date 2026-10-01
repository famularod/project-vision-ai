/**
 * Whole-app audit A5 pass 9 L1 (30 Sep 2026): the hidden old row kept a
 * deleted lookahead's dates and percent, and they came back.
 *
 * Master A has Pour slab at 20%; David enters 40%; lookahead L sets 60% on
 * 09/28-09/30; master B moves the task. Delete PDF + Items on L gave the row
 * B saved its 40% back but, since 85cd049, left the hidden old row as it was.
 * Deleting master B (or Set Active on A) then showed Pour slab on L's dates at
 * 60%, its note still listing the deleted L; without David's entry, 60%
 * instead of 20%. And when B dropped the task, the row was shown only because
 * of L: the delete question said it "also puts back the earlier progress of 1
 * task", but the delete worked out the tasks shown without L and gave nothing
 * back.
 *
 * Now the delete gives back the dates and percent of every row L restated,
 * hidden ones included, and takes L out of their notes; the question counts
 * only the tasks shown after the delete, from the same schedules the delete
 * uses (the saved ones without L). Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleItemsAfterScheduleDeleted,
  scheduleLookaheadDeleteNote,
} from '../../services/ScheduleLookahead';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const DAVID_AT = '2026-09-10T15:00:00.000Z';
const DELETED_AT = '2026-09-28T00:00:00.000Z';
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const masterA = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const masterB = schedule('MASTER B', '2026-09-26T12:00:00.000Z');

function rows(source: ReferenceDocument, header: string, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
const PERCENT = 'Task,Project,Area,Start,Finish,% Complete';
const NO_PERCENT = 'Task,Project,Area,Start,Finish';
const ROOFING = 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%';

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
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');

/** What the phone's Delete PDF + Items does (App.tsx): the question with the saved schedules, then the tasks it saves. */
function deleteWithItems(state: State, document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents);
  const question = scheduleLookaheadDeleteNote(state.items, document, removed, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(saved => saved !== document);
  const saved = scheduleItemsAfterScheduleDeleted({ items, removed, document, documents, updatedAt: DELETED_AT });
  const changed = new Map(saved.map(item => [item.id, item]));
  return { question, saved, after: { items: items.map(item => changed.get(item.id) || item), documents } };
}

/** Master A 20% (and David's 40% by hand, when asked); L sets 60% on 09/28-09/30. */
function raised(byDavid: boolean): State {
  const atA = approve({ items: [], documents: [] }, masterA, rows(masterA, PERCENT, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', ROOFING]));
  const items = byDavid ? atA.items.map(item => item.taskName === 'Pour slab' ? {
    ...item, percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: DAVID_AT, updatedAt: DAVID_AT,
  } as ScheduleItem : item) : atA.items;
  return approve({ ...atA, items }, lookahead, rows(lookahead, PERCENT, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,60%']));
}

describe('A5 p9 L1: deleting a lookahead gives back every row it restated, hidden ones included', () => {
  it.each([
    ['David entered 40%', true, 40],
    ['no entry by David (master A\'s 20%)', false, 20],
  ])('%s: master B moved the task; after deleting L, then master B, Pour slab is back on A\'s dates and percent', (_label, byDavid, back) => {
    const moved = approve(raised(byDavid), masterB, rows(masterB, NO_PERCENT, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026', ROOFING.replace(',30%', '')]));
    const oldRow = moved.items.find(item => item.taskName === 'Pour slab' && item.importBatchId === masterA.importBatchId)!;
    expect(shown(moved).some(item => item.id === oldRow.id)).toBe(false);

    const withoutL = deleteWithItems(moved, lookahead);
    // The question counts the task shown (B's row) only.
    expect(withoutL.question).toContain('also puts back the earlier progress of 1 task this lookahead changed.');
    expect(pours(shown(withoutL.after))[0]).toMatchObject({ percentComplete: back, startDate: '10/05/2026' });
    // The hidden old row is given back too, without L in its note.
    const hidden = withoutL.after.items.find(item => item.id === oldRow.id)!;
    expect(hidden).toMatchObject({ percentComplete: back, startDate: '10/01/2026', finishDate: '10/03/2026' });
    expect(hidden.lookaheadOverlay).toBeUndefined();
    expect(withoutL.saved.map(item => item.id)).toContain(oldRow.id);

    // Deleting master B shows the old row again: A's dates and the percent before L.
    const withoutB = deleteWithItems(withoutL.after, masterB);
    const pour = pours(shown(withoutB.after));
    expect(pour.map(item => item.id)).toEqual([oldRow.id]);
    expect(pour[0]).toMatchObject({ percentComplete: back, startDate: '10/01/2026', finishDate: '10/03/2026' });
    expect(pour[0].lookaheadOverlay).toBeUndefined();
  });

  it('master B dropped the task (shown only because of L): the question and the delete agree, and the row is given back', () => {
    const dropped = approve(raised(true), masterB, rows(masterB, PERCENT, [ROOFING]));
    const row = pours(dropped.items)[0];
    expect(pours(shown(dropped)).map(item => item.id)).toEqual([row.id]);
    const withoutL = deleteWithItems(dropped, lookahead);
    // Not shown once L is gone, so the question does not count it ...
    expect(pours(shown(withoutL.after))).toEqual([]);
    expect(withoutL.question).toBe('');
    // ... and the delete still takes L's dates and percent off it.
    expect(withoutL.after.items.find(item => item.id === row.id)).toMatchObject({ percentComplete: 40, startDate: '10/01/2026' });
    const withoutB = deleteWithItems(withoutL.after, masterB);
    expect(pours(shown(withoutB.after))[0]).toMatchObject({ id: row.id, percentComplete: 40, startDate: '10/01/2026' });
  });
});
