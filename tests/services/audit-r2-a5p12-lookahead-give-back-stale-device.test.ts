/**
 * Audit round 2, A5 pass 12 leftovers K2 (1 Oct 2026): deleting a lookahead
 * on a phone that had not caught up overwrote a newer percent David entered
 * on another device.
 *
 * Pour slab is at 20% from the master; David enters 40% (10 Sep). A
 * three-week lookahead raises it to 60%, the schedule's, confirmed at its
 * approval (20 Sep), and notes his 40%. The phone syncs, then goes without a
 * connection. On the web David enters 50% (25 Sep). On the 30th the phone,
 * still at the lookahead's 60%, runs Delete PDF + Items on the lookahead: the
 * give-back (4be10cf) returned his noted 40% confirmed at the delete, and
 * sync orders David's percents by that confirmation, so the 40% won the
 * upload's merge over his newer 50% on every device. Talk's Undo before the
 * delete (2c565cb) did the same with a lookahead's percent given back.
 *
 * Now the give-back is confirmed 1 ms after the later of the task's own
 * confirmation and the noted one, as Set Active's carry (92e0843) and the
 * Delete PDF + Items hand-over (14408b1) are: newer than every older copy of
 * the task, never than a later entry made elsewhere. When David judged the
 * percent is still kept (progressJudgment). Real merge, delete and sync
 * helpers. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressJudgedAt,
  scheduleProgressUndoPoint,
  scheduleTalkUndo,
} from '../../services/ScheduleProgressSource';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const DAVID_40_AT = '2026-09-10T15:00:00.000Z';
const WEB_50_AT = '2026-09-25T15:00:00.000Z';
const PHONE_DELETED_AT = '2026-09-30T09:00:00.000Z';
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const earlierLookahead = schedule('Alpha 3 Week Lookahead 0915', '2026-09-15T12:00:00.000Z', { scheduleRole: 'lookahead' });

function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,% Complete', ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv',
    projects: ['Alpha'], now: new Date(source.importedAt),
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
/** David enters a percent (the phone's or the web's task edit marks it his). */
function entered(state: State, id: string, percentComplete: number, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
      progressConfirmedAt: at, updatedAt: at,
    } as ScheduleItem : item),
  };
}
/** Delete PDF + Items on a lookahead (App.tsx's service, shared with the web). */
function deleteLookahead(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(other => other !== document);
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: items.map(item => saved.get(item.id) || item), documents };
}
/** The phone's upload and Full Sync after it reconnects, and another device reading the cloud after. */
function sync(phone: ScheduleItem[], cloud: ScheduleItem[], id: string) {
  const upload = daveScheduleItemsNeedingCloudUpload({ local: phone, cloud });
  const cloudAfter = cloud.map(item => upload.find(sent => sent.id === item.id) || item);
  return {
    phone: recoverDAVEScheduleRecords({ local: phone, cloud: cloudAfter, allowCloudOnly: true }).find(item => item.id === id)!,
    cloud: cloudAfter.find(item => item.id === id)!,
  };
}

describe('A5 p12 K2: an offline phone\'s lookahead delete never overwrites a newer percent entered on another device', () => {
  const imported = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%']));
  const taskId = imported.items.find(item => item.taskName === 'Pour slab')!.id;
  const raised = approve(entered(imported, taskId, 40, DAVID_40_AT), lookahead, rows(lookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%']));
  const pour = (state: State) => state.items.find(item => item.id === taskId)!;

  it('the scenario: the lookahead\'s 60% is the schedule\'s, confirmed at its approval, noting David\'s 40%', () => {
    expect(pour(raised)).toMatchObject({ percentComplete: 60, progressConfirmedAt: lookahead.importedAt });
    expect(pour(raised).lookaheadOverlay).toMatchObject({
      masterPercentComplete: 40, masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: DAVID_40_AT,
    });
  });

  it('David\'s 50% on the web, after the phone last synced, stays on every device', () => {
    const cloud = entered(raised, taskId, 50, WEB_50_AT).items;
    const phone = deleteLookahead(raised, lookahead, PHONE_DELETED_AT).items;
    expect(phone.find(item => item.id === taskId)).toMatchObject({ percentComplete: 40, progressSource: 'project_manager' });
    const after = sync(phone, cloud, taskId);
    expect(after.cloud).toMatchObject({ percentComplete: 50, progressConfirmedAt: WEB_50_AT });
    expect(after.phone).toMatchObject({ percentComplete: 50, progressConfirmedAt: WEB_50_AT });
  });

  it('the give-back is confirmed 1 ms after the later of the task\'s and the noted confirmation, judged when David entered it', () => {
    const givenBack = pour(deleteLookahead(raised, lookahead, PHONE_DELETED_AT));
    // The lookahead's approval (20 Sep) is later than David's 40% (10 Sep).
    expect(givenBack).toMatchObject({
      percentComplete: 40, progressSource: 'project_manager', progressConfirmedBy: 'David',
      progressConfirmedAt: '2026-09-20T12:00:00.001Z',
      progressJudgment: { judgedAt: DAVID_40_AT, givenBackAt: '2026-09-20T12:00:00.001Z' },
      updatedAt: PHONE_DELETED_AT,
    });
    expect(scheduleProgressJudgedAt(givenBack)).toBe(DAVID_40_AT);
  });

  it('it still wins over the cloud\'s older copy at the lookahead\'s 60% (4be10cf), whichever syncs first', () => {
    const stale = pour(raised);
    const givenBack = pour(deleteLookahead(raised, lookahead, PHONE_DELETED_AT));
    expect(recoverDAVEScheduleRecords({ local: [givenBack], cloud: [stale], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
    expect(daveScheduleItemsNeedingCloudUpload({ local: [givenBack], cloud: [stale] }).map(item => item.percentComplete)).toEqual([40]);
    expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [givenBack], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
  });

  it('after Talk\'s Undo (manager rank kept, 2c565cb): the give-back beats the Undo\'s copy, never David\'s later web entry', () => {
    const UNDO_AT = '2026-09-22T15:00:05.000Z';
    const talked = entered(raised, taskId, 70, '2026-09-22T15:00:00.000Z');
    const before = scheduleProgressUndoPoint(pour(raised));
    const undo = scheduleTalkUndo(talked.items, pour(talked), before, scheduleProgressUndoPoint(pour(talked)), UNDO_AT);
    if (!undo.ok) throw new Error(undo.message);
    const undone = { ...talked, items: talked.items.map(item => item.id === taskId ? { ...item, ...undo.edit, updatedAt: UNDO_AT } as ScheduleItem : item) };
    expect(pour(undone)).toMatchObject({ percentComplete: 60, progressSource: 'project_manager', progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER });
    const givenBack = pour(deleteLookahead(undone, lookahead, PHONE_DELETED_AT));
    expect(givenBack).toMatchObject({ percentComplete: 40, progressSource: 'project_manager', progressConfirmedAt: '2026-09-22T15:00:05.001Z' });
    // Over the Undo's copy it wins either way round.
    expect(recoverDAVEScheduleRecords({ local: [givenBack], cloud: [pour(undone)], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
    expect(recoverDAVEScheduleRecords({ local: [pour(undone)], cloud: [givenBack], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
    // David's 50% on the web after it stays.
    const after = sync(deleteLookahead(undone, lookahead, PHONE_DELETED_AT).items, entered(undone, taskId, 50, WEB_50_AT).items, taskId);
    expect([after.phone.percentComplete, after.cloud.percentComplete]).toEqual([50, 50]);
  });

  it('back to an earlier lookahead\'s percent (not the noted one): the same rule', () => {
    // Lookahead A (15 Sep) gives 50%, lookahead B (20 Sep) 60%; Talk's Undo leaves B's 60% manager-rank.
    const A = approve(imported, earlierLookahead, rows(earlierLookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,50%']));
    const B = approve(A, lookahead, rows(lookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%']));
    const UNDO_AT = '2026-09-22T15:00:05.000Z';
    const talked = entered(B, taskId, 70, '2026-09-22T15:00:00.000Z');
    const undo = scheduleTalkUndo(talked.items, pour(talked), scheduleProgressUndoPoint(pour(B)), scheduleProgressUndoPoint(pour(talked)), UNDO_AT);
    if (!undo.ok) throw new Error(undo.message);
    const undone = { ...talked, items: talked.items.map(item => item.id === taskId ? { ...item, ...undo.edit, updatedAt: UNDO_AT } as ScheduleItem : item) };
    const givenBack = pour(deleteLookahead(undone, lookahead, PHONE_DELETED_AT));
    expect(givenBack).toMatchObject({ percentComplete: 50, progressSource: 'project_manager', progressConfirmedAt: '2026-09-22T15:00:05.001Z' });
    expect(recoverDAVEScheduleRecords({ local: [pour(undone)], cloud: [givenBack], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 50 });
    const after = sync(deleteLookahead(undone, lookahead, PHONE_DELETED_AT).items, entered(undone, taskId, 55, WEB_50_AT).items, taskId);
    expect([after.phone.percentComplete, after.cloud.percentComplete]).toEqual([55, 55]);
  });
});
