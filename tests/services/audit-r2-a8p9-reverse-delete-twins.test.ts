/**
 * Audit round 2, A8 pass 9 L2 (30 Sep 2026): deleting the newer master with
 * its items when the older one has two tasks of one name.
 *
 * Master F has two "Pour slab" tasks, phase 1 and phase 2. Master M moves
 * phase 1: the import saves it as a new row answering to F's phase 1 row
 * (revisedFromTaskIds) and keeps phase 2 on its dates. A field update after
 * the move is linked to M's row. "Delete PDF + Items" on M brings F back and
 * removes M's row. The removed id goes onto the one task shown with its name,
 * and F shows two, so nothing was written, though M's row names which of F's
 * rows it was: the update became "Historical evidence — linked task was
 * deleted.".
 *
 * Now the removed id goes first onto the task shown that the removed row
 * itself answers to. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
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
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');

function deleteWithItems(state: State, document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: '2026-09-28T12:00:00.000Z' })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: '2026-09-28T12:00:00.000Z' }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones, removed };
}

describe('A8 p9 L2: deleting the newer master gives a removed row\'s id to the older row it answers to', () => {
  const onF = approve({ items: [], documents: [] }, F, rows(F, [
    'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,40%',
    'Pour slab,Alpha,Lot,10/20/2026,10/22/2026,0%',
  ]));
  const [phase1, phase2] = pours(onF.items).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const onM = approve(onF, M, rows(M, [
    'Pour slab,Alpha,Lot,09/02/2026,09/04/2026,40%',
    'Pour slab,Alpha,Lot,10/20/2026,10/22/2026,0%',
  ]));
  const movedRow = pours(shown(onM)).find(item => item.id !== phase2.id)!;

  it('M moved phase 1 (its row answers to F\'s phase 1) and kept phase 2', () => {
    expect(movedRow.revisedFromTaskIds).toEqual([phase1.id]);
    expect(pours(shown(onM)).map(item => item.id)).toContain(phase2.id);
  });

  it('"Delete PDF + Items" on M: F\'s phase 1 takes M\'s row id, and the update after the move stays current on phase 1', () => {
    const deleted = deleteWithItems(onM, M);
    expect(deleted.removed.map(item => item.id)).toEqual([movedRow.id]);
    const back = pours(shown(deleted));
    expect(back.map(item => item.id).sort()).toEqual([phase1.id, phase2.id].sort());
    expect(back.find(item => item.id === phase1.id)!.revisedFromTaskIds).toEqual([movedRow.id]);
    expect(back.find(item => item.id === phase2.id)!.revisedFromTaskIds).toBeUndefined();

    const update = {
      id: 'u-after-move', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-27T15:00:00.000Z', photos: [],
      recipients: { contactIds: [] }, notes: 'Pour slab phase 1: poured.', scheduleItemId: movedRow.id, scheduleTaskName: 'Pour slab',
      selectedAreaName: 'Lot',
    } as ProjectUpdate;
    const partition = partitionProjectUpdatesByDeletedTask([update], deleted.tombstones, value => value, { scheduleItems: deleted.items });
    expect(partition.historical).toEqual([]);
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: back, updates: partition.active, projectName: 'Alpha', now: new Date('2026-09-28T12:00:00.000Z'),
    });
    expect(reconciliation.matches.filter(match => match.updateId === 'u-after-move').map(match => match.scheduleItemId)).toEqual([phase1.id]);
  });
});
