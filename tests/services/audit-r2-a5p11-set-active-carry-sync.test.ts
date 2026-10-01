/**
 * Whole-app audit A5 pass 11 L-1 (30 Sep 2026): the A5 pass 10 M1 fix held
 * only until the next sync.
 *
 * Master A has Pour slab at 20%; David enters 40% (10 Sep). Lookahead L sets
 * 60%. Master B moves the task, and David enters 70% on B's row (27 Sep).
 * Delete PDF + Items on L gives A's hidden row David's 40% back, confirmed at
 * the delete (28 Sep). Set Active on A: the carry rightly picks David's 70%
 * by when it was judged, but copied B's row's older confirmation (27 Sep) over
 * A's 28 Sep. Sync orders copies by that confirmation (DAVEScheduleRecovery),
 * so the phone's upload merge kept the cloud's 40%, the refresh took the
 * cloud's copy, and A showed 40% again on every device.
 *
 * Now a carried percent whose confirmation is older than the shown row's is
 * confirmed at the Set Active, with David's own time kept as when it was
 * judged (progressJudgment), as deleting a lookahead gives a percent back.
 * Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressJudgedAt } from '../../services/ScheduleProgressSource';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const DAVID_40_AT = '2026-09-10T15:00:00.000Z';
const DAVID_70_AT = '2026-09-27T15:00:00.000Z';
const DELETED_AT = '2026-09-28T00:00:00.000Z';
const SET_ACTIVE_AT = '2026-09-29T09:00:00.000Z';
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...extra,
}) as ReferenceDocument;
const masterA = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const masterB = schedule('MASTER B', '2026-09-26T12:00:00.000Z');

const PERCENT = 'Task,Project,Area,Start,Finish,% Complete';
const NO_PERCENT = 'Task,Project,Area,Start,Finish';
function rows(source: ReferenceDocument, header: string, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
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
/** David enters a percent on the phone. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item),
});
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourOf = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Pour slab')!;

/** The phone's Set Active (App.tsx activateReferenceDocument): the schedules after, and the progress carried onto the tasks now shown. */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

describe('A5 p11 L-1: the percent Set Active carries survives the next sync', () => {
  const atA = approve({ items: [], documents: [] }, masterA, rows(masterA, PERCENT, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%']));
  const oldRow = pourOf(atA.items);
  const withL = approve(entered(atA, oldRow.id, 40, DAVID_40_AT), lookahead, rows(lookahead, PERCENT, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,60%']));
  const movedState = approve(withL, masterB, rows(masterB, NO_PERCENT, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026']));
  const movedRow = pourOf(shown(movedState));
  const at70 = entered(movedState, movedRow.id, 70, DAVID_70_AT);

  function deleteLookahead(state: State): State {
    const removed = scheduleItemsOnlyInImportBatch(state.items, lookahead, state.documents);
    const items = state.items.filter(item => !removed.includes(item));
    const documents = state.documents.filter(saved => saved.id !== lookahead.id);
    const changed = new Map(scheduleItemsAfterScheduleDeleted({ items, removed, document: lookahead, documents, updatedAt: DELETED_AT })
      .map(item => [item.id, item]));
    return { items: items.map(item => changed.get(item.id) || item), documents };
  }
  /** Every device synced the delete: the cloud holds A's row at 40%, confirmed 28 Sep. */
  const cloud = deleteLookahead(at70);
  const onA = setActive(cloud, masterA, SET_ACTIVE_AT);
  const carriedRow = onA.items.find(item => item.id === oldRow.id)!;
  const cloudRow = cloud.items.find(item => item.id === oldRow.id)!;

  it('the scenario: the cloud\'s copy of A\'s row is 40%, confirmed at the delete, after David\'s 70% on B\'s row', () => {
    expect(cloudRow).toMatchObject({ percentComplete: 40, progressConfirmedAt: DELETED_AT });
    expect(pourOf(shown(onA))).toMatchObject({ id: oldRow.id, percentComplete: 70 });
  });

  it('the carried 70% is confirmed at the Set Active, still judged when David entered it', () => {
    expect(carriedRow).toMatchObject({
      percentComplete: 70, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: SET_ACTIVE_AT,
      progressJudgment: { judgedAt: DAVID_70_AT, givenBackAt: SET_ACTIVE_AT },
    });
    expect(scheduleProgressJudgedAt(carriedRow)).toBe(DAVID_70_AT);
  });

  it('the phone\'s upload merge sends 70% and the refresh keeps it', () => {
    // The upload's merge (SyncService) of the phone's row with the cloud's.
    expect(recoverDAVEScheduleRecords({ local: [carriedRow], cloud: [cloudRow], allowCloudOnly: true }))
      .toEqual([expect.objectContaining({ id: oldRow.id, percentComplete: 70 })]);
    expect(daveScheduleItemsNeedingCloudUpload({ local: onA.items, cloud: cloud.items }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: oldRow.id, percentComplete: 70 })]));
    // The refresh before the upload landed: the cloud still holds 40%.
    const refreshed = recoverDAVEScheduleRecords({ local: onA.items, cloud: cloud.items, allowCloudOnly: true });
    expect(pourOf(shown({ items: refreshed, documents: onA.documents }))).toMatchObject({ id: oldRow.id, percentComplete: 70 });
  });

  it('another phone still holding 40% does not send it back, and takes 70%', () => {
    const uploaded = cloud.items.map(item => item.id === oldRow.id ? carriedRow : item);
    const otherPhone = cloud.items;
    expect(daveScheduleItemsNeedingCloudUpload({ local: otherPhone, cloud: uploaded }).filter(item => item.id === oldRow.id)).toEqual([]);
    const refreshed = recoverDAVEScheduleRecords({ local: otherPhone, cloud: uploaded, allowCloudOnly: true });
    expect(pourOf(shown({ items: refreshed, documents: onA.documents }))).toMatchObject({ id: oldRow.id, percentComplete: 70 });
  });

  it('Set Active back on B still keeps 70% and carries nothing over it', () => {
    const onB = setActive(onA, masterB, '2026-09-29T10:00:00.000Z');
    expect(pourOf(shown(onB))).toMatchObject({ id: movedRow.id, percentComplete: 70, progressConfirmedAt: DAVID_70_AT });
  });
});
