/**
 * Audit round 2, A8 pass 9 L1 (30 Sep 2026): "Delete PDF + Items" could
 * write a removed task's id onto a same-named task the import never paired
 * with it.
 *
 * Master F has Pour slab phase 1. An intermediate master G drops it. A later
 * master M adds phase 2 as a new task, also named Pour slab. Deleting F with
 * its items wrote phase 1's id onto phase 2 (the one Pour slab shown), so
 * phase 1's "complete" report read as phase 2's and warned that the schedule
 * was behind.
 *
 * A row a new master saved before 79f49d3 lists no earlier id, and neither
 * does a row the merge paired with nothing (it leaves the field off), so the
 * two cannot be told apart by the row. The closest safe rule: the id goes
 * only onto a task a master imported (never one entered by hand), and only
 * when no full schedule saved for that project between the removed task's
 * schedule and that task's own dropped the task; that is, the task came in
 * where the import would have paired it. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-10T12:00:00.000Z');
const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
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
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const legacy = (state: State): State => ({ ...state, items: state.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) });
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');

const ROOFING = 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%';
const PHASE_1 = 'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,100%';
const PHASE_2 = 'Pour slab,Alpha,Lot,10/20/2026,10/22/2026,0%';

/** The phone's "Delete PDF + Items" (App.tsx deleteScheduleDocument). */
function deleteWithItems(state: State, document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: '2026-09-27T12:00:00.000Z' })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: '2026-09-27T12:00:00.000Z' }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones, removed, saved: [...saved.values()] };
}
const report = (scheduleItemId: string): ProjectUpdate => ({
  id: 'u-phase-1', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-04T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab is complete.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
}) as ProjectUpdate;

describe('A8 p9 L1: the removed id goes only where the import would have paired the task', () => {
  const onF = approve({ items: [], documents: [] }, F, rows(F, [PHASE_1, ROOFING]));
  const phase1 = pours(onF.items)[0];

  it('F → G (drops Pour slab) → M (adds phase 2): deleting F writes nothing onto phase 2, and phase 1\'s report is history', () => {
    const onM = legacy(approve(approve(onF, G, rows(G, [ROOFING])), M, rows(M, [PHASE_2, ROOFING])));
    const deleted = deleteWithItems(onM, F);
    expect(deleted.removed.map(item => item.id)).toEqual([phase1.id]);
    const phase2 = pours(shown(deleted))[0];
    expect(phase2.revisedFromTaskIds).toBeUndefined();
    expect(deleted.saved).toEqual([]);
    const partition = partitionProjectUpdatesByDeletedTask([report(phase1.id)], deleted.tombstones, update => update, { scheduleItems: deleted.items });
    expect(partition.historical.map(update => update.id)).toEqual(['u-phase-1']);
  });

  it('a task entered by hand is never taken for the removed task', () => {
    const byHand = { ...pours(rows(M, [PHASE_2]))[0], id: 'hand-pour', importBatchId: null, sourceDocumentId: null, importedFrom: null } as ScheduleItem;
    const onM = legacy(approve(onF, M, rows(M, [ROOFING])));
    const deleted = deleteWithItems({ ...onM, items: [...onM.items, byHand] }, F);
    expect(pours(shown(deleted)).map(item => [item.id, item.revisedFromTaskIds])).toEqual([['hand-pour', undefined]]);
  });

  it('still: F → M moved it (saved before 79f49d3) writes the id; F → G moved → M moved (G\'s row legacy, M\'s answering to G\'s) too', () => {
    const MOVED_G = 'Pour slab,Alpha,Lot,09/02/2026,09/04/2026,100%';
    const MOVED_M = 'Pour slab,Alpha,Lot,09/03/2026,09/05/2026,100%';
    const direct = deleteWithItems(legacy(approve(onF, M, rows(M, [MOVED_M, ROOFING]))), F);
    expect(pours(shown(direct))[0].revisedFromTaskIds).toEqual([phase1.id]);

    const onG = legacy(approve(onF, G, rows(G, [MOVED_G, ROOFING])));
    const gRow = pours(shown(onG))[0];
    const onM = approve(onG, M, rows(M, [MOVED_M, ROOFING]));
    expect(pours(shown(onM))[0].revisedFromTaskIds).toEqual([gRow.id]);
    const chained = deleteWithItems(onM, F);
    expect(pours(shown(chained))[0].revisedFromTaskIds).toEqual([phase1.id, gRow.id]);
  });
});
