/**
 * Whole-app audit A5 pass 9 L3 (30 Sep 2026, from b03042f): a lookahead's
 * percent came back after its delete when Talk's Undo came first.
 *
 * An imported task is at 20%; a lookahead sets 60%. Talk sets 70%, and Undo
 * gives back 60% the way a file's percent over David's is kept: marked
 * project_manager, confirmed by "Schedule update" at the Undo (b03042f).
 * Delete PDF + Items on the lookahead then gave back the master's 20% with the
 * file's own source, which ranks below a manager-rank percent. The upload's
 * merge and Full Sync rank before time (DAVEScheduleRecovery), so both took
 * the Undo's 60% back: the phone recorded a conflict and other devices kept
 * 60%. The same for a task entered by hand.
 *
 * Now, when the task's percent is manager-rank, the percent the note gives
 * back keeps that rank: a file's percent comes back as project_manager,
 * confirmed by "Schedule update" at the delete (the summaries still read it as
 * the file's), and one entered by hand with no source as David's (as the
 * import and the summaries count it), dated when it was stated. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleHasAuthoritativeProgressJudgment } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressRecordedByManager } from '../../services/ScheduleProgressInvariant';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressJudgedAt,
  scheduleProgressUndoPoint,
  scheduleTalkUndo,
} from '../../services/ScheduleProgressSource';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const CREATED_AT = '2026-08-01T00:00:00.000Z';
const TALK_AT = '2026-09-26T15:00:00.000Z';
const UNDO_AT = '2026-09-26T15:00:05.000Z';
const DELETED_AT = '2026-09-27T09:00:00.000Z';
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });

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

/** Talk sets 70% (David's, as the phone's task update marks it), then Undo gives back what it noted. */
function talkThenUndo(state: State, taskId: string): State & { stale: ScheduleItem } {
  const task = state.items.find(item => item.id === taskId)!;
  const before = scheduleProgressUndoPoint(task);
  const talked = { ...task, percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: TALK_AT, updatedAt: TALK_AT } as ScheduleItem;
  const items = state.items.map(item => (item.id === taskId ? talked : item));
  const undo = scheduleTalkUndo(items, talked, before, scheduleProgressUndoPoint(talked), UNDO_AT);
  if (!undo.ok) throw new Error(undo.message);
  const undone = { ...talked, ...undo.edit, updatedAt: UNDO_AT } as ScheduleItem;
  return { ...state, items: items.map(item => (item.id === taskId ? undone : item)), stale: undone };
}

/** Delete PDF + Items on the lookahead (App.tsx's service). */
function deleteLookahead(state: State): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, lookahead, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(document => document !== lookahead);
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items, removed, document: lookahead, documents, updatedAt: DELETED_AT })
    .map(item => [item.id, item]));
  return { items: items.map(item => saved.get(item.id) || item), documents };
}

/** Whichever copy syncs first, the given-back percent stays. */
function syncsBothWays(givenBack: ScheduleItem, stale: ScheduleItem, percent: number) {
  expect(recoverDAVEScheduleRecords({ local: [givenBack], cloud: [stale], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: percent });
  expect(daveScheduleItemsNeedingCloudUpload({ local: [givenBack], cloud: [stale] }).map(item => item.percentComplete)).toEqual([percent]);
  expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [givenBack], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: percent });
  expect(daveScheduleItemsNeedingCloudUpload({ local: [stale], cloud: [givenBack] })).toEqual([]);
}

describe('A5 p9 L3: deleting a lookahead after Talk\'s Undo gives the percent back with the rank the Undo left', () => {
  it('an imported task: the master\'s 20% comes back as project_manager, confirmed by "Schedule update" at the delete, and wins the sync', () => {
    const raised = approve(approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%'])),
      lookahead, rows(lookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%']));
    const taskId = raised.items.find(item => item.taskName === 'Pour slab')!.id;
    const undone = talkThenUndo(raised, taskId);
    expect(undone.stale).toMatchObject({ percentComplete: 60, progressSource: 'project_manager', progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER });
    const givenBack = deleteLookahead(undone).items.find(item => item.id === taskId)!;
    expect(givenBack).toMatchObject({ percentComplete: 20 });
    syncsBothWays(givenBack, undone.stale, 20);
    expect(givenBack).toMatchObject({
      progressSource: 'project_manager', progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER, progressConfirmedAt: DELETED_AT,
    });
    // Still the file's percent for the summaries.
    expect(scheduleProgressRecordedByManager(givenBack)).toBe(false);
    expect(scheduleHasAuthoritativeProgressJudgment(givenBack)).toBe(false);
  });

  it('a task entered by hand: David\'s 40% comes back as his, dated when it was stated, and wins the sync', () => {
    const handEntered = {
      id: 'hand', projectName: 'Alpha', taskName: 'Punch list', locationName: 'Lot', owner: '', contractor: '', startDate: '11/01/2026',
      finishDate: '11/05/2026', milestone: '', status: 'In Progress', percentComplete: 40, priority: 'Medium', notes: '', createdAt: CREATED_AT,
    } as ScheduleItem;
    const raised = approve(approve({ items: [handEntered], documents: [] }, master, rows(master, ['Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%'])),
      lookahead, rows(lookahead, ['Punch list,Alpha,Lot,11/01/2026,11/05/2026,50%']));
    const undone = talkThenUndo(raised, 'hand');
    expect(undone.stale).toMatchObject({ percentComplete: 50, progressSource: 'project_manager', progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER });
    const givenBack = deleteLookahead(undone).items.find(item => item.id === 'hand')!;
    expect(givenBack).toMatchObject({ percentComplete: 40 });
    syncsBothWays(givenBack, undone.stale, 40);
    expect(givenBack).toMatchObject({ progressSource: 'project_manager', progressConfirmedAt: DELETED_AT });
    expect(givenBack.progressConfirmedBy).not.toBe(SCHEDULE_UPDATE_PROGRESS_CONFIRMER);
    expect(scheduleHasAuthoritativeProgressJudgment(givenBack)).toBe(true);
    expect(scheduleProgressJudgedAt(givenBack)).toBe(CREATED_AT);
  });

  it('with no Undo first (the percent is the file\'s, not manager-rank), the give-back is as before', () => {
    const raised = approve(approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%'])),
      lookahead, rows(lookahead, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%']));
    const taskId = raised.items.find(item => item.taskName === 'Pour slab')!.id;
    const givenBack = deleteLookahead(raised).items.find(item => item.id === taskId)!;
    expect(givenBack.percentComplete).toBe(20);
    expect(givenBack.progressSource).not.toBe('project_manager');
  });
});
