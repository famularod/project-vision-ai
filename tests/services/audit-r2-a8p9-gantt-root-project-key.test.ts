/**
 * Audit round 2, A8 pass 9 M1 scenario B (30 Sep 2026): a Microsoft Project
 * master whose rows sit under one root summary row ("PLZ 2375 Campus
 * Project") files 2375A's and 2375B's tasks under the same schedule project
 * (scheduleProjectName), each under its own app project (projectName).
 *
 * The new master moved both Pour slabs (it was imported before 79f49d3, so
 * the rows list no earlier id). "Delete PDF + Items" on the old master writes
 * each removed id onto the one task shown with its name, project and area
 * (A10 pass 6 M1), but it keyed the project by the schedule's root, so the
 * two Pour slabs looked like one project's twins and no id was written: both
 * field updates became "Historical evidence — linked task was deleted.".
 *
 * Now the project is the app project, as the field update's own matching
 * keys it, here and in the task delete's hidden rows. Real Microsoft Project
 * normalizer, the phone's merge and delete helpers. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import {
  partitionProjectUpdatesByDeletedTask,
  scheduleItemIdsDeletedWithTask,
} from '../../services/DAVEDeletedTaskEvidence';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';

const PROJECTS = ['2375A', '2375B'];
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: null, projectNames: PROJECTS, importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const master = schedule('CAMPUS 0831', '2026-08-31T12:00:00.000Z');
const master2 = schedule('CAMPUS 0926', '2026-09-26T08:00:00.000Z');

/** A Microsoft Project export: the campus root, then each building's tasks. */
function mspRows(source: ReferenceDocument, pours: Readonly<{ a: string; b: string }>): ScheduleItem[] {
  const contents = [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
    '1\tPLZ 2375 Campus Project\t0\t60 days\t09/01/2026\t12/01/2026\t10%',
    '2\t2375A\t1\t30 days\t09/01/2026\t10/31/2026\t10%',
    `3\tPour slab\t2\t3 days\t${pours.a}\t40%`,
    '4\t2375B\t1\t30 days\t09/01/2026\t10/31/2026\t10%',
    `5\tPour slab\t2\t3 days\t${pours.b}\t0%`,
  ].join('\n');
  return normalizeMicrosoftProjectPdfRows({ contents, sourceName: source.originalFileName, projects: PROJECTS, now: new Date(source.importedAt) })
    .map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
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
const pourOf = (items: readonly ScheduleItem[], project: string) => items.find(item => item.taskName === 'Pour slab' && item.projectName === project)!;

function fieldUpdate(id: string, project: string, scheduleItemId: string): ProjectUpdate {
  return {
    id, projectName: project, scheduleProjectName: project, date: '2026-09-25T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
    notes: 'Pour slab: forms set.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Unassigned / Unknown Area',
  } as ProjectUpdate;
}

/** The phone's "Delete PDF + Items" (App.tsx deleteScheduleDocument): the rows only this PDF has, and the tasks it saves. */
function deleteWithItems(state: State, document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: '2026-09-27T12:00:00.000Z' })
    .map(item => [item.id, item]));
  const tombstones: DAVESyncTombstone[] = [master.id, ...removedIds].map((recordId, index) => ({
    entityType: index === 0 ? 'reference_document' : 'schedule_item', recordId, deletedAt: '2026-09-27T12:00:00.000Z',
  }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones, removed, saved: [...saved.values()] };
}

describe('A8 p9 M1 scenario B: one Gantt root, two app projects', () => {
  // The new master moved both Pour slabs by a day; its rows were saved before 79f49d3 (no earlier ids).
  const before = approve({ items: [], documents: [] }, master, mspRows(master, { a: '09/28/2026\t09/30/2026', b: '10/05/2026\t10/07/2026' }));
  const after = approve(before, master2, mspRows(master2, { a: '09/29/2026\t10/01/2026', b: '10/06/2026\t10/08/2026' }));
  const legacy: State = { ...after, items: after.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) };
  const oldA = pourOf(before.items, '2375A');
  const oldB = pourOf(before.items, '2375B');

  it('the rows share the schedule root and differ by app project', () => {
    expect([oldA.scheduleProjectName, oldB.scheduleProjectName]).toEqual([oldA.scheduleProjectName, oldA.scheduleProjectName]);
    expect(oldA.scheduleProjectName).toBeTruthy();
    expect(shown(legacy).filter(item => item.taskName === 'Pour slab').map(item => item.projectName).sort()).toEqual(PROJECTS);
  });

  it('"Delete PDF + Items" on the old master writes each removed id onto its own project\'s Pour slab; both updates stay current', () => {
    const deleted = deleteWithItems(legacy, master);
    expect(deleted.removed.map(item => item.id).sort()).toEqual([oldA.id, oldB.id].sort());
    const newA = pourOf(shown(deleted), '2375A');
    const newB = pourOf(shown(deleted), '2375B');
    expect(newA.revisedFromTaskIds).toEqual([oldA.id]);
    expect(newB.revisedFromTaskIds).toEqual([oldB.id]);
    const partition = partitionProjectUpdatesByDeletedTask(
      [fieldUpdate('u-a', '2375A', oldA.id), fieldUpdate('u-b', '2375B', oldB.id)],
      deleted.tombstones,
      update => update,
      { scheduleItems: deleted.items },
    );
    expect(partition.historical).toEqual([]);
    expect(partition.active.map(update => update.id)).toEqual(['u-a', 'u-b']);
  });

  it('deleting a task takes only its own project\'s hidden rows, never another project\'s under the same root', () => {
    // A row of 2375A that (by an older pairing across the root) lists 2375B's hidden row.
    const newA = { ...pourOf(shown(legacy), '2375A'), revisedFromTaskIds: [oldA.id, oldB.id] };
    const items = legacy.items.map(item => item.id === newA.id ? newA : item);
    expect(scheduleItemIdsDeletedWithTask(items, newA, legacy.documents).sort()).toEqual([newA.id, oldA.id].sort());
  });
});
