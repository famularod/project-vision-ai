/**
 * Audit round 2, A8 pass 11 L1 (1 Oct 2026, caused by fd00285): after a
 * Make Current back to the old master, "Delete PDF + Items" on the newer
 * master handed the removed row's id to the old master's HIDDEN row, not to
 * the task shown.
 *
 * Master F has Pour slab (row A); David enters 40%. Master M moves it (row X,
 * which records A); David enters 70% on X and files a field report on X (from
 * the east bay of the Lot, so the stored area is not the task's). Make
 * Current back to F: A shows 70%. A corrected master N comes in while F is
 * current and moves Pour slab again: N's row Y records A, not X (the import
 * pairs only with the rows shown). Then David deletes M with its items.
 *
 * fd00285 (A5 pass 11 M-b) gives the removed row's id to the row it replaced
 * even when that row is hidden, and returned there: Y kept only [A] and the
 * hidden A took [X]. The report on X then linked to Y only by name (here the
 * areas differ, so to nothing), and deleting F with its items too took A,
 * the last row that answered to X: the report read "Historical evidence —
 * linked task was deleted.", for good. Before fd00285 the name match gave Y
 * [X, A] and the report stayed linked through both deletes.
 *
 * Now the removed id also goes onto the newest task shown, in its app
 * project, that answers to a row the removed row replaced (Y lists A), by
 * the same progress rule; and a removed row a task shown already answers to
 * hands that task its own earlier ids (deleting F gives Y what A recorded).
 * Both deletes, in both orders, on the phone's helper and through the web's
 * delete plan over an in-memory cloud. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { planDAVEWebScheduleDocumentDelete } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import * as gatewayModule from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks, scheduleTasksAnsweringToRemovedTasks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { FakeWebCloud } from '../fixtures/fake-web-cloud';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  const { createFakeWebCloud } = jest.requireActual('../fixtures/fake-web-cloud');
  const cloud = createFakeWebCloud();
  return { ...actual, __fakeCloud: cloud, daveWebSupabaseGateway: actual.createDAVEWebSupabaseGateway(cloud.client) };
});
const cloud = (gatewayModule as unknown as { __fakeCloud: FakeWebCloud }).__fakeCloud;
const gateway = gatewayModule.daveWebSupabaseGateway;

const DAVID_FIRST_AT = '2026-09-10T15:00:00.000Z';
const DAVID_MOVED_AT = '2026-09-27T15:00:00.000Z';
const SET_ACTIVE_AT = '2026-09-27T18:00:00.000Z';
const DELETED_M_AT = '2026-09-29T12:00:00.000Z';
const DELETED_F_AT = '2026-09-30T12:00:00.000Z';
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
const N = schedule('MASTER N', '2026-09-28T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item),
});
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name)!;
const row = (state: Pick<State, 'items'>, id: string) => state.items.find(item => item.id === id);
/** Make Current (App.tsx activateReferenceDocument): the schedules after, and the progress carried onto the tasks now shown. */
function makeCurrent(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
type Deleted = State & { tombstones: DAVESyncTombstone[] };
/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State & { tombstones?: DAVESyncTombstone[] }, document: ReferenceDocument, at: string): Deleted {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: at }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones: [...(state.tombstones || []), ...tombstones] };
}

const SCHEDULE_F = ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026', 'Framing,Alpha,Lot,10/10/2026,10/20/2026'];
const onF = approve({ items: [], documents: [] }, F, rows(F, SCHEDULE_F));
const rowA = named(onF.items, 'Pour slab');
const onM = approve(entered(onF, rowA.id, 40, DAVID_FIRST_AT), M, rows(M, ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026', SCHEDULE_F[1]]));
const rowX = named(shown(onM), 'Pour slab');
const backOnF = makeCurrent(entered(onM, rowX.id, 70, DAVID_MOVED_AT), F, SET_ACTIVE_AT);
const onN = approve(backOnF, N, rows(N, ['Pour slab,Alpha,Lot,10/03/2026,10/07/2026', SCHEDULE_F[1]]));
const rowY = named(shown(onN), 'Pour slab');

// Filed on X while M was current, from the east bay: the stored area is not the task's, so no name match.
const report: ProjectUpdate = {
  id: 'u-pour-70', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-27T16:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is 70% complete.', scheduleItemId: rowX.id, scheduleTaskName: 'Pour slab',
  selectedAreaName: 'Lot east bay',
} as ProjectUpdate;

/** Where the report stands: kept as current evidence, and the task it links to (reconciliation too). */
function reportOn(state: Deleted) {
  const split = partitionProjectUpdatesByDeletedTask([report], state.tombstones, update => update, { scheduleItems: state.items });
  const link = scheduleTaskLinks(shown(state), state.items)(report);
  const reconciliation = buildPIEScheduleReconciliation({
    scheduleItems: shown(state), knownScheduleItems: state.items, updates: split.active, projectName: 'Alpha', now: new Date(DELETED_F_AT),
  });
  return {
    historical: split.historical.map(update => update.id),
    linked: link ? link.item.id : null,
    matched: reconciliation.matches.filter(match => match.updateId === report.id).map(match => match.scheduleItemId),
  };
}
const STAYS_ON_Y = () => ({ historical: [], linked: rowY.id, matched: [rowY.id] });

describe('A8 p11 L1: Delete PDF + Items after a Make Current back keeps the report on the moved row linked to the task shown', () => {
  it('the scenario: X records A; back on F, A shows 70%; N (current) moved Pour slab again from A, so Y records only A', () => {
    expect(rowX.revisedFromTaskIds).toEqual([rowA.id]);
    expect(row(backOnF, rowA.id)).toMatchObject({ percentComplete: 70 });
    expect(rowY.id).not.toBe(rowA.id);
    expect(rowY.revisedFromTaskIds).toEqual([rowA.id]);
    expect(shown(onN).map(item => item.id).sort()).toEqual([rowY.id, named(onF.items, 'Framing').id].sort());
  });

  it('deleting M gives X\'s id to Y, the task shown, as well as to the hidden A', () => {
    const deleted = deleteWithItems(onN, M, DELETED_M_AT);
    expect(deleted.tombstones.map(entry => entry.recordId)).toEqual([rowX.id]);
    expect(row(deleted, rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
    expect(row(deleted, rowA.id)!.revisedFromTaskIds).toEqual([rowX.id]);
    expect(reportOn(deleted)).toEqual(STAYS_ON_Y());
  });

  it('then deleting F keeps the report current and linked to Y (it was "Historical evidence — linked task was deleted.")', () => {
    const deleted = deleteWithItems(deleteWithItems(onN, M, DELETED_M_AT), F, DELETED_F_AT);
    expect(deleted.tombstones.map(entry => entry.recordId)).toEqual([rowX.id, rowA.id]);
    expect(reportOn(deleted)).toEqual(STAYS_ON_Y());
    expect(row(deleted, rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
  });

  it('the other order: deleting F, then M, ends the same', () => {
    const afterF = deleteWithItems(onN, F, DELETED_M_AT);
    expect(afterF.tombstones.map(entry => entry.recordId)).toEqual([rowA.id]);
    const deleted = deleteWithItems(afterF, M, DELETED_F_AT);
    expect(row(deleted, rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
    expect(reportOn(deleted)).toEqual(STAYS_ON_Y());
  });

  it('a removed row a task shown already answers to gives that task its own earlier ids (the hidden A recorded X)', () => {
    // As after an M delete that wrote X only onto the hidden A (fd00285).
    const hiddenA = { ...row(onN, rowA.id)!, revisedFromTaskIds: [rowX.id] } as ScheduleItem;
    const answered = scheduleTasksAnsweringToRemovedTasks([rowY], [hiddenA], [rowY]);
    expect(answered.map(item => [item.id, item.revisedFromTaskIds])).toEqual([[rowY.id, [rowX.id, rowA.id]]]);
    // Nothing new to give: nothing is saved.
    expect(scheduleTasksAnsweringToRemovedTasks([rowY], [row(onN, rowA.id)!], [rowY])).toEqual([]);
  });

  it('the task shown takes the removed row\'s progress by the same rule as the hidden row (the caller\'s progressGivenBack)', () => {
    const asked: string[] = [];
    const answered = scheduleTasksAnsweringToRemovedTasks([rowY], [rowX], [rowY, row(onN, rowA.id)!], [], (task, gone) => {
      asked.push(`${task.id}<${gone.id}`);
      return task.id === rowY.id ? { percentComplete: 90 } : null;
    });
    expect(asked.sort()).toEqual([`${rowA.id}<${rowX.id}`, `${rowY.id}<${rowX.id}`].sort());
    expect(answered.find(item => item.id === rowY.id)).toMatchObject({ percentComplete: 90, revisedFromTaskIds: [rowX.id, rowA.id] });
    expect(answered.find(item => item.id === rowA.id)).toMatchObject({ percentComplete: row(onN, rowA.id)!.percentComplete, revisedFromTaskIds: [rowX.id] });
  });

  it('the task shown gives nothing to a row of another app project, and takes no older progress', () => {
    const beta = { ...rowX, id: 'beta-moved', projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    expect(scheduleTasksAnsweringToRemovedTasks([rowY], [beta], [rowY])).toEqual([]);
    const deleted = deleteWithItems(onN, M, DELETED_M_AT);
    expect(row(deleted, rowY.id)).toMatchObject({ percentComplete: rowY.percentComplete, progressConfirmedAt: rowY.progressConfirmedAt });
  });
});

/** The cloud as the phone left it after N; the web deletes from there. */
function seedCloud(state: State) {
  ['projects', 'schedule_items', 'reference_documents', 'project_updates', 'dave_sync_tombstones'].forEach(table => cloud.rows(table).splice(0));
  cloud.insert('projects', { id: 'p-alpha', owner_id: 'owner-1', name: 'Alpha', archived: false, created_at: '2026-08-01T00:00:00.000Z' });
  state.items.forEach((item, index) => cloud.insert('schedule_items', {
    id: item.id, owner_id: 'owner-1', project_name: item.projectName, task_name: item.taskName, item_data: item,
    updated_at: `2026-09-28T09:00:0${index}.000Z`,
  }));
  state.documents.forEach(document => cloud.insert('reference_documents', {
    id: document.id, owner_id: 'owner-1', document_data: document, updated_at: `rev-${document.id}`,
  }));
  cloud.insert('project_updates', {
    id: report.id, owner_id: 'owner-1', project_name: 'Alpha', update_data: report, created_at: report.date, updated_at: report.date,
  });
}
/** "Delete Document + N Tasks" on the web: a fresh read, the plan, then the gateway's delete. */
async function webDelete(document: ReferenceDocument, at: string) {
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  const saved = snapshot.referenceDocuments.find(candidate => candidate.id === document.id)!;
  const plan = planDAVEWebScheduleDocumentDelete({ snapshot, document: saved, updatedAt: at });
  await gateway.deleteAuthorizedReferenceDocument(saved.id, saved.cloudUpdatedAt, saved.linkedScheduleItems, plan);
}
/** What a phone downloads: the saved tasks not deleted, the schedules, and the deletion records. */
function phoneView(): Deleted {
  const tombstones = cloud.rows('dave_sync_tombstones').map(entry => ({
    entityType: entry.entity_type, recordId: entry.record_id, deletedAt: entry.deleted_at,
  }) as DAVESyncTombstone);
  const deleted = new Set(tombstones.map(entry => `${entry.entityType}:${entry.recordId}`));
  return {
    items: cloud.rows('schedule_items').map(entry => entry.item_data as ScheduleItem).filter(item => !deleted.has(`schedule_item:${item.id}`)),
    documents: cloud.rows('reference_documents').map(entry => entry.document_data as ReferenceDocument)
      .filter(document => !deleted.has(`reference_document:${document.id}`)),
    tombstones,
  };
}

describe('A8 p11 L1 on the web: the delete plan over the cloud ends the same, in both orders', () => {
  it('M then F', async () => {
    seedCloud(onN);
    await webDelete(M, DELETED_M_AT);
    expect(row(phoneView(), rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
    expect(reportOn(phoneView())).toEqual(STAYS_ON_Y());
    await webDelete(F, DELETED_F_AT);
    const after = phoneView();
    expect(after.tombstones.filter(entry => entry.entityType === 'schedule_item').map(entry => entry.recordId).sort()).toEqual([rowA.id, rowX.id].sort());
    expect(row(after, rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
    expect(reportOn(after)).toEqual(STAYS_ON_Y());
    // And the web's own read keeps the report.
    expect((await loadDAVEWebReadOnlySnapshot()).projectUpdates.map(update => update.id)).toEqual([report.id]);
  });

  it('F then M', async () => {
    seedCloud(onN);
    await webDelete(F, DELETED_M_AT);
    await webDelete(M, DELETED_F_AT);
    const after = phoneView();
    expect(row(after, rowY.id)!.revisedFromTaskIds).toEqual([rowX.id, rowA.id]);
    expect(reportOn(after)).toEqual(STAYS_ON_Y());
    expect((await loadDAVEWebReadOnlySnapshot()).projectUpdates.map(update => update.id)).toEqual([report.id]);
  });
});
