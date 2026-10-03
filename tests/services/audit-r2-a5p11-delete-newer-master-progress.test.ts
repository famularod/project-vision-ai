/**
 * Audit round 2, A5 pass 11 M-b (30 Sep 2026): "Delete PDF + Items" on the
 * newer master threw away David's progress on the tasks that master moved.
 *
 * Master F has Pour slab and Framing; David enters 40% and 30%. Master M
 * moves Pour slab (a new row answering to F's, revisedFromTaskIds) and keeps
 * Framing on its dates (the same row, in both masters). David enters 70% on
 * M's Pour slab row and 60% on Framing, then deletes M with its items.
 * Framing kept 60%; Pour slab went back to F's row at 40% on every device
 * (the deletion syncs): the delete handed F's row the removed row's id
 * (A8 pass 9 L2), never its progress. His 70% field report then resolved to
 * the 40% task and read as "Field progress may be ahead of the schedule", and
 * a corrected master imported next paired with the 40% row, so the 70% was
 * gone for good. Set Active F before the delete would have carried it.
 *
 * And M was current, so F was retired: after the delete no schedule was
 * shown, the removed id went nowhere either, and Set Active F (the advice,
 * A8 pass 6 L1) showed 40%.
 *
 * Now the row a removed row replaced takes its id even when hidden, and,
 * when the removed row's progress is David's (not a file's) and was judged
 * later than that row's, its progress too, by Set Active's rule, confirmed
 * (since A5 pass 12 L) 1 ms after the later of the two rows' confirmations,
 * with David's own time kept as when it was judged (progressJudgment), so
 * every device holding an older copy takes it and a later field report still
 * counts against it. The phone and the web share the delete helper.
 * These tests run the real merge, activation, delete and Set Active helpers
 * and the web's snapshot and delete plan. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleDocumentDelete } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

const DAVID_FIRST_AT = '2026-09-10T15:00:00.000Z';
const DAVID_MOVED_AT = '2026-09-27T15:00:00.000Z';
const DELETED_AT = '2026-09-28T12:00:00.000Z';
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
const N = schedule('MASTER N', '2026-09-29T08:00:00.000Z');
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
/** Approving a master merges its rows and makes it current, retiring the one before (App.tsx: scheduleDocumentsAfterActivation). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
/** David enters a percent on the phone. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item),
});
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name)!;
const row = (state: Pick<State, 'items'>, id: string) => state.items.find(item => item.id === id)!;

/** The phone's Set Active (App.tsx activateReferenceDocument): the schedules after, and the progress carried onto the tasks now shown. */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

/** "Delete PDF + Items" as the phone does it (App.tsx): the items only that PDF has, through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: DELETED_AT })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: DELETED_AT }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, removed, tombstones };
}

const SCHEDULE_F = ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026', 'Framing,Alpha,Lot,10/10/2026,10/20/2026'];
const SCHEDULE_M = ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026', 'Framing,Alpha,Lot,10/10/2026,10/20/2026'];
const onF = approve({ items: [], documents: [] }, F, rows(F, SCHEDULE_F));
const fPour = named(onF.items, 'Pour slab');
const framing = named(onF.items, 'Framing');
const judgedOnF = entered(entered(onF, fPour.id, 40, DAVID_FIRST_AT), framing.id, 30, DAVID_FIRST_AT);
const onM = approve(judgedOnF, M, rows(M, SCHEDULE_M));
const mPour = named(shown(onM), 'Pour slab');
const judgedOnM = entered(entered(onM, mPour.id, 70, DAVID_MOVED_AT), framing.id, 60, DAVID_MOVED_AT);

const report70: ProjectUpdate = {
  id: 'u-pour-70', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-27T16:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is 70% complete.', scheduleItemId: mPour.id, scheduleTaskName: 'Pour slab',
  selectedAreaName: 'Lot',
} as ProjectUpdate;
const SET_ACTIVE_AT = '2026-09-28T13:00:00.000Z';
// Confirmed 1 ms after David's 70% on M's row, no longer at the delete (A5 pass 12 L: a delete-time
// stamp outranked a later entry on another device); still newer than F's row's 40% (10 Sep).
const HANDED_AT = '2026-09-27T15:00:00.001Z';
const HELD_70 = {
  percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
  progressConfirmedAt: HANDED_AT, progressJudgment: { judgedAt: DAVID_MOVED_AT, givenBackAt: HANDED_AT },
};

describe('A5 p11 M-b: deleting the newer master keeps David\'s progress on the task it moved', () => {
  it('the scenario: M (current, F retired) moved Pour slab (a new row answering to F\'s) and kept Framing (the same row)', () => {
    expect(onM.documents.map(document => [document.id, document.isCurrent])).toEqual([[F.id, false], [M.id, true]]);
    expect(mPour.id).not.toBe(fPour.id);
    expect(mPour.revisedFromTaskIds).toEqual([fPour.id]);
    expect(named(shown(onM), 'Framing').id).toBe(framing.id);
    expect(named(shown(judgedOnM), 'Pour slab')).toMatchObject({ percentComplete: 70 });
    expect(row(judgedOnM, fPour.id)).toMatchObject({ percentComplete: 40, progressConfirmedAt: DAVID_FIRST_AT });
  });

  it('after the delete, F\'s hidden Pour slab row holds David\'s 70% (confirmed just after it, judged when he entered it) and answers to M\'s row', () => {
    const deleted = deleteWithItems(judgedOnM, M);
    expect(deleted.removed.map(item => item.id)).toEqual([mPour.id]);
    expect(shown(deleted)).toEqual([]); // F is retired: Set Active F is the advice (A8 pass 6 L1)
    expect(row(deleted, fPour.id)).toMatchObject({ ...HELD_70, revisedFromTaskIds: [mPour.id], updatedAt: DELETED_AT });
    expect(row(deleted, framing.id)).toMatchObject({ percentComplete: 60 });
  });

  it('Set Active F then shows Pour slab at 70% and Framing at 60%, and his 70% report on M\'s row stays current on Pour slab', () => {
    const onF = setActive(deleteWithItems(judgedOnM, M), F, SET_ACTIVE_AT);
    expect(named(shown(onF), 'Pour slab')).toMatchObject({ id: fPour.id, percentComplete: 70 });
    expect(named(shown(onF), 'Framing')).toMatchObject({ id: framing.id, percentComplete: 60 });
    const deleted = deleteWithItems(judgedOnM, M);
    const split = partitionProjectUpdatesByDeletedTask([report70], deleted.tombstones, update => update, { scheduleItems: onF.items });
    expect(split.active.map(update => update.id)).toEqual([report70.id]);
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown(onF), knownScheduleItems: onF.items, updates: split.active, projectName: 'Alpha', now: new Date(SET_ACTIVE_AT),
    });
    expect(reconciliation.matches.filter(match => match.updateId === report70.id).map(match => match.scheduleItemId)).toEqual([fPour.id]);
  });

  it('with F still marked current (its retirement not synced yet), F\'s row is shown right after the delete at 70%', () => {
    const bothCurrent = { ...judgedOnM, documents: judgedOnM.documents.map(document => ({ ...document, isCurrent: true })) };
    const deleted = deleteWithItems(bothCurrent, M);
    expect(named(shown(deleted), 'Pour slab')).toMatchObject({ id: fPour.id, ...HELD_70, revisedFromTaskIds: [mPour.id] });
    expect(named(shown(deleted), 'Framing')).toMatchObject({ id: framing.id, percentComplete: 60 });
  });

  it('a corrected master imported next pairs with F\'s row and keeps the 70%', () => {
    const onF = setActive(deleteWithItems(judgedOnM, M), F, SET_ACTIVE_AT);
    const onN = approve(onF, N, rows(N, ['Pour slab,Alpha,Lot,10/03/2026,10/07/2026', 'Framing,Alpha,Lot,10/10/2026,10/20/2026']));
    expect(named(shown(onN), 'Pour slab')).toMatchObject({ startDate: '10/03/2026', percentComplete: 70 });
  });

  it('the 70% survives a recovery merge with an older cloud copy of F\'s row (40%), and is uploaded', () => {
    const deleted = deleteWithItems(judgedOnM, M);
    const cloud = judgedOnM.items.filter(item => item.id !== mPour.id);
    const recovered = recoverDAVEScheduleRecords({ local: deleted.items, cloud, deletedIds: [mPour.id], allowCloudOnly: true });
    expect(recovered.find(item => item.id === fPour.id)).toMatchObject({ percentComplete: 70, progressConfirmedAt: HANDED_AT }); // A5 pass 12 L
    expect(daveScheduleItemsNeedingCloudUpload({ local: deleted.items, cloud, deletedIds: [mPour.id] }).find(item => item.id === fPour.id))
      .toMatchObject({ percentComplete: 70 });
    // And another device holding the older 40% takes the 70% from the cloud.
    const otherDevice = recoverDAVEScheduleRecords({ local: cloud, cloud: deleted.items, deletedIds: [mPour.id], allowCloudOnly: true });
    expect(otherDevice.find(item => item.id === fPour.id)).toMatchObject({ percentComplete: 70 });
  });

  it('the web\'s delete plan writes the same 70% onto F\'s row', async () => {
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: 'p-alpha', name: 'Alpha', archived: false }],
      scheduleItems: judgedOnM.items.map(item => ({ id: item.id, item_data: item, updated_at: `rev-${item.id}` })),
      referenceDocuments: judgedOnM.documents.map(document => ({ id: document.id, document_data: document })),
      projectUpdates: [],
      syncTombstones: [],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const document = snapshot.referenceDocuments.find(saved => saved.id === M.id)!;
    expect(document.linkedScheduleItems.map(item => item.id)).toEqual([mPour.id]);
    const plan = planDAVEWebScheduleDocumentDelete({ snapshot, document, updatedAt: DELETED_AT });
    expect(plan.map(revision => revision.item.id)).toEqual([fPour.id]);
    expect(plan[0]).toMatchObject({ item: { ...HELD_70, revisedFromTaskIds: [mPour.id] }, cloudUpdatedAt: `rev-${fPour.id}` });
  });

  it('only David\'s own progress, judged later: a removed row whose percent is a file\'s, or judged before F\'s row\'s, gives back only its id', () => {
    const filesOnly = { ...judgedOnM, items: judgedOnM.items.map(item => item.id === mPour.id
      ? { ...item, percentComplete: 70, status: 'In Progress', progressSource: 'schedule_import', progressConfirmedBy: null, progressConfirmedAt: null } as ScheduleItem
      : item) };
    expect(row(deleteWithItems(filesOnly, M), fPour.id)).toMatchObject({ percentComplete: 40, progressConfirmedAt: DAVID_FIRST_AT, revisedFromTaskIds: [mPour.id] });
    // David judged F's row later (after Make Current back to F, say): his newer 80% stays.
    const newerOnF = entered(judgedOnM, fPour.id, 80, '2026-09-27T18:00:00.000Z');
    expect(row(deleteWithItems(newerOnF, M), fPour.id))
      .toMatchObject({ percentComplete: 80, progressConfirmedAt: '2026-09-27T18:00:00.000Z', revisedFromTaskIds: [mPour.id] });
  });

  it('a removed row of another app project that lists F\'s row gives it nothing', () => {
    const beta = { ...mPour, id: 'beta-moved', projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    const kept = judgedOnM.items.filter(item => item.id !== mPour.id);
    expect(scheduleItemsAfterScheduleDeleted({ items: kept, removed: [beta], document: M, documents: [F], updatedAt: DELETED_AT })).toEqual([]);
  });
});

/**
 * Audit round 2, A5 pass 12 L (1 Oct 2026, caused by fd00285): the hand-over
 * was confirmed at the delete, and sync orders progress by that confirmation.
 * David entered 70% on M's row (27 Sep); on the web he made F current (the
 * carry gave F's row 70%) and corrected it to 50% (28 Sep). A phone that had
 * not synced since the 27th then deleted M with its items (30 Sep): F's row
 * took 70% stamped the 30th, and the upload's merge took it over the 50% on
 * every device. The hand-over is now confirmed 1 ms after the later of the
 * row's own confirmation and the removed row's: newer than every older copy
 * of the row, never than a later entry on another device.
 */
describe('A5 p12 L: an offline phone\'s delete never overwrites a newer percent entered on another device', () => {
  const WEB_MAKE_CURRENT_AT = '2026-09-28T10:00:00.000Z';
  const WEB_50_AT = '2026-09-28T14:00:00.000Z';
  const PHONE_DELETED_AT = '2026-09-30T09:00:00.000Z';
  // The cloud after the web: F current, F's row carried to 70% at Make Current, then corrected to 50%.
  const onWeb = setActive(judgedOnM, F, WEB_MAKE_CURRENT_AT);
  const cloud = entered(onWeb, fPour.id, 50, WEB_50_AT).items;
  /** The phone, still on the 27th (M current), deletes M with its items on the 30th. */
  function phoneDelete() {
    const removed = scheduleItemsOnlyInImportBatch(judgedOnM.items, M, judgedOnM.documents.filter(scheduleDocumentIsScheduleLike));
    const removedIds = new Set(removed.map(item => item.id));
    const kept = judgedOnM.items.filter(item => !removedIds.has(item.id));
    const saved = new Map(scheduleItemsAfterScheduleDeleted({
      items: kept, removed, document: M, documents: judgedOnM.documents.filter(other => other.id !== M.id), updatedAt: PHONE_DELETED_AT,
    }).map(item => [item.id, item]));
    return kept.map(item => saved.get(item.id) || item);
  }

  it('the scenario: the web holds 50% on F\'s row, confirmed after the 70% the phone holds on M\'s', () => {
    expect(row(onWeb, fPour.id)).toMatchObject({ percentComplete: 70 });
    expect(cloud.find(item => item.id === fPour.id)).toMatchObject({ percentComplete: 50, progressConfirmedAt: WEB_50_AT });
  });

  it('the hand-over is confirmed 1 ms after the removed row\'s 70%, with David\'s time kept as when it was judged', () => {
    expect(phoneDelete().find(item => item.id === fPour.id)).toMatchObject({
      percentComplete: 70, progressConfirmedAt: '2026-09-27T15:00:00.001Z',
      progressJudgment: { judgedAt: DAVID_MOVED_AT, givenBackAt: '2026-09-27T15:00:00.001Z' },
      revisedFromTaskIds: [mPour.id], updatedAt: PHONE_DELETED_AT,
    });
  });

  it('after sync every device holds the web\'s 50%, and F\'s row still answers to M\'s', () => {
    const local = phoneDelete();
    const upload = daveScheduleItemsNeedingCloudUpload({ local, cloud, deletedIds: [mPour.id] }).find(item => item.id === fPour.id);
    expect(upload).toMatchObject({ percentComplete: 50, progressConfirmedAt: WEB_50_AT, revisedFromTaskIds: [mPour.id] });
    const phone = recoverDAVEScheduleRecords({ local, cloud, deletedIds: [mPour.id], allowCloudOnly: true });
    expect(phone.find(item => item.id === fPour.id)).toMatchObject({ percentComplete: 50, revisedFromTaskIds: [mPour.id] });
    const otherDevice = recoverDAVEScheduleRecords({ local: cloud, cloud: [...upload ? [upload] : [], ...cloud.filter(item => item.id !== fPour.id)], deletedIds: [mPour.id], allowCloudOnly: true });
    expect(otherDevice.find(item => item.id === fPour.id)).toMatchObject({ percentComplete: 50 });
  });

  it('a later percent on the receiving row moves the stamp past it: F\'s own confirmation after M\'s judgment', () => {
    // F's row confirmed (a file's percent re-confirmed, say) after David judged M's: the stamp follows the later.
    const laterF = { ...judgedOnM, items: judgedOnM.items.map(item => item.id === fPour.id
      ? { ...item, progressConfirmedAt: '2026-09-27T16:00:00.000Z', progressJudgment: { judgedAt: DAVID_FIRST_AT, givenBackAt: '2026-09-27T16:00:00.000Z' } } as ScheduleItem
      : item) };
    const removed = laterF.items.filter(item => item.id === mPour.id);
    const [handed] = scheduleItemsAfterScheduleDeleted({
      items: laterF.items.filter(item => item.id !== mPour.id), removed, document: M, documents: [F], updatedAt: PHONE_DELETED_AT,
    });
    expect(handed).toMatchObject({ id: fPour.id, percentComplete: 70, progressConfirmedAt: '2026-09-27T16:00:00.001Z' });
  });
});
