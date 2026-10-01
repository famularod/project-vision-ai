/**
 * Whole-app audit A5 pass 12 L (1 Oct 2026), caused by the A5 pass 11 L-1
 * fix (ebbe975): a device that had not caught up, repeating Set Active, beat
 * a newer percent David entered on another device.
 *
 * As in audit-r2-a5p11-set-active-carry-sync: master A's Pour slab holds
 * David's 40% given back at a lookahead delete (confirmed 28 Sep), and master
 * B's row holds his 70% (27 Sep). On the iPad David does Set Active A, which
 * carries 70% onto A's row, then enters 50% there (29 Sep 10:00). A phone
 * whose documents had not refreshed does Set Active A at 11:00: its carried
 * 70% was confirmed at that moment, so the sync took it over David's newer
 * 50% on every device.
 *
 * Now the carry is confirmed 1 ms after the later of the two rows' own
 * confirmations, not at the Set Active: newer than the copies it replaces
 * (the cloud's 40% and a phone still holding it), never newer than a percent
 * David entered since. When David judged it is kept (progressJudgment).
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
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressJudgedAt } from '../../services/ScheduleProgressSource';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const DAVID_40_AT = '2026-09-10T15:00:00.000Z';
const DAVID_70_AT = '2026-09-27T15:00:00.000Z';
const DELETED_AT = '2026-09-28T00:00:00.000Z';
/**
 * The give-back as a build before A5 pass 12 K2 (1 Oct 2026) stamped it: confirmed at the delete (28 Sep),
 * after David's 70% (27 Sep). Since K2 it is confirmed 1 ms after the lookahead's approval (20 Sep), older than
 * the 70% (audit-r2-a5p12-lookahead-give-back-stale-device.test.ts). Rows given back before K2 are still in the
 * cloud, and this test's scenario is theirs, so it keeps their stamp.
 */
const asGivenBackBeforeK2 = (item: ScheduleItem): ScheduleItem => item.progressJudgment
  ? { ...item, progressConfirmedAt: DELETED_AT, progressJudgment: { ...item.progressJudgment, givenBackAt: DELETED_AT } }
  : item;
/** 1 ms after the later confirmation of the two rows: A's row's, given back at the delete. */
const CARRIED_AT = '2026-09-28T00:00:00.001Z';
const IPAD_SET_ACTIVE_AT = '2026-09-29T09:00:00.000Z';
const IPAD_50_AT = '2026-09-29T10:00:00.000Z';
const PHONE_SET_ACTIVE_AT = '2026-09-29T11:00:00.000Z';
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
/** David enters a percent. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, progressJudgment: undefined, updatedAt: at,
  } as ScheduleItem : item),
});
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourOf = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Pour slab')!;

/** The phone's Set Active (App.tsx activateReferenceDocument). */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

describe('A5 p12 L: a device that has not caught up, repeating Set Active, never beats a newer percent', () => {
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
      .map(item => [item.id, asGivenBackBeforeK2(item)]));
    return { items: items.map(item => changed.get(item.id) || item), documents };
  }
  /** Every device synced the delete. */
  const cloud = deleteLookahead(at70);

  // The iPad: Set Active A carries 70%, then David enters 50% on A's row; the iPad uploads it.
  const iPadOnA = setActive(cloud, masterA, IPAD_SET_ACTIVE_AT);
  const iPad50 = entered(iPadOnA, oldRow.id, 50, IPAD_50_AT);
  const cloudAfterIPad: State = { items: iPad50.items, documents: iPad50.documents };
  // The phone still holds the cloud as it was before the iPad's Set Active, and repeats it.
  const phoneOnA = setActive(cloud, masterA, PHONE_SET_ACTIVE_AT);
  const phoneRow = phoneOnA.items.find(item => item.id === oldRow.id)!;
  const iPadRow = cloudAfterIPad.items.find(item => item.id === oldRow.id)!;

  it('the scenario: each device\'s Set Active carries David\'s 70% onto A\'s row; the iPad then holds 50%', () => {
    expect(cloud.items.find(item => item.id === oldRow.id)).toMatchObject({ percentComplete: 40, progressConfirmedAt: DELETED_AT });
    expect(pourOf(shown(iPadOnA))).toMatchObject({ id: oldRow.id, percentComplete: 70 });
    expect(iPadRow).toMatchObject({ percentComplete: 50, progressConfirmedAt: IPAD_50_AT });
    expect(phoneRow).toMatchObject({ percentComplete: 70 });
  });

  it('the carry is confirmed 1 ms after the later of the two rows\' confirmations, not at the Set Active', () => {
    expect(phoneRow).toMatchObject({
      progressConfirmedAt: CARRIED_AT,
      progressJudgment: { judgedAt: DAVID_70_AT, givenBackAt: CARRIED_AT },
      updatedAt: PHONE_SET_ACTIVE_AT,
    });
    expect(scheduleProgressJudgedAt(phoneRow)).toBe(DAVID_70_AT);
    // Either device's Set Active stamps the same carry.
    expect(iPadOnA.items.find(item => item.id === oldRow.id)).toMatchObject({ progressConfirmedAt: CARRIED_AT });
  });

  it('the phone\'s upload merge keeps David\'s 50%, and the phone does not send 70%', () => {
    expect(recoverDAVEScheduleRecords({ local: [phoneRow], cloud: [iPadRow], allowCloudOnly: true }))
      .toEqual([expect.objectContaining({ id: oldRow.id, percentComplete: 50 })]);
    // Whatever the phone sends for A's row (its merge with the cloud's) holds 50%.
    const sent = daveScheduleItemsNeedingCloudUpload({ local: phoneOnA.items, cloud: cloudAfterIPad.items }).filter(item => item.id === oldRow.id);
    expect(sent.map(item => item.percentComplete).filter(percent => percent !== 50)).toEqual([]);
  });

  it('the phone\'s refresh takes 50%, and A shows 50% on every device', () => {
    const refreshed = recoverDAVEScheduleRecords({ local: phoneOnA.items, cloud: cloudAfterIPad.items, allowCloudOnly: true });
    expect(pourOf(shown({ items: refreshed, documents: phoneOnA.documents }))).toMatchObject({ id: oldRow.id, percentComplete: 50 });
    expect(pourOf(shown(cloudAfterIPad))).toMatchObject({ id: oldRow.id, percentComplete: 50 });
  });

  it('the later confirmation is the hidden row\'s when it is newer: the carry keeps it, as before', () => {
    const shownRow = { ...oldRow, id: 'shown', progressSource: 'project_manager', progressConfirmedBy: 'David', percentComplete: 30, status: 'In Progress', progressConfirmedAt: DAVID_40_AT } as ScheduleItem;
    const hiddenRow = { ...oldRow, id: 'hidden', progressSource: 'project_manager', progressConfirmedBy: 'David', percentComplete: 70, status: 'In Progress', progressConfirmedAt: DAVID_70_AT } as ScheduleItem;
    expect(scheduleProgressCarriedToShownTasks({ before: [hiddenRow], after: [shownRow], now: PHONE_SET_ACTIVE_AT }))
      .toEqual([expect.objectContaining({ id: 'shown', percentComplete: 70, progressConfirmedAt: DAVID_70_AT })]);
  });
});
