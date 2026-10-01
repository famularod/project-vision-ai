/**
 * Whole-app audit A5 pass 8 L1 (30 Sep 2026, from 80ccee6): deleting a
 * lookahead gave back the percent on an older task entered by hand, and
 * David's own upload took it away again.
 *
 * Punch list, entered by hand with no progress source, sits at 40% (David's,
 * by the rule for older records). A lookahead raises it to 50%; since 80ccee6
 * that is saved as the schedule's, confirmed at the approval. Delete PDF +
 * Items gave back 40% with no source and no confirmation time. The upload
 * merges the whole row with the cloud copy, and sync prefers the copy with a
 * confirmation time, so the cloud got 50% back and every device followed.
 *
 * Now the give-back is confirmed at the delete whenever the task's percent
 * carries a confirmation time, or the noted percent counts as David's (a task
 * no import owns, with no source, included), the way his own percent is
 * given back: it keeps the time it was judged by (progressJudgment), so the
 * record keeps its date; a file's percent keeps the time it carried.
 * Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleHasAuthoritativeProgressJudgment, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterLookaheadDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressJudgedAt } from '../../services/ScheduleProgressSource';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const CREATED_AT = '2026-08-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T00:00:00.000Z';
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
function deleteLookahead(state: State): State {
  const removed = new Set(scheduleItemsOnlyInImportBatch(state.items, lookahead, state.documents).map(item => item.id));
  const kept = state.items.filter(item => !removed.has(item.id));
  const restored = new Map(scheduleItemsAfterLookaheadDeleted(kept, lookahead, DELETED_AT).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents: state.documents.filter(document => document !== lookahead) };
}
const punch = (state: State) => state.items.find(item => item.id === 'hand')!;

const handEntered = {
  id: 'hand', projectName: 'Alpha', taskName: 'Punch list', locationName: 'Lot', owner: '', contractor: '', startDate: '11/01/2026',
  finishDate: '11/05/2026', milestone: '', status: 'In Progress', percentComplete: 40, priority: 'Medium', notes: '', createdAt: CREATED_AT,
} as ScheduleItem;

describe('A5 p8 L1: a percent given back is confirmed at the delete, so no device\'s copy takes it away again', () => {
  const raised = approve(approve({ items: [handEntered], documents: [] }, master, rows(master, ['Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%'])),
    lookahead, rows(lookahead, ['Punch list,Alpha,Lot,11/01/2026,11/05/2026,50%']));

  it('the lookahead\'s 50% is the schedule\'s, confirmed at the approval (80ccee6)', () => {
    expect(punch(raised)).toMatchObject({
      percentComplete: 50, progressSource: 'schedule_import', progressConfirmedBy: 'Schedule update', progressConfirmedAt: lookahead.importedAt,
    });
  });

  it('a task entered by hand: his 40% comes back confirmed at the delete, still his, dated as before', () => {
    const after = deleteLookahead(raised);
    const task = punch(after);
    expect(task).toMatchObject({ percentComplete: 40, status: 'In Progress', progressConfirmedAt: DELETED_AT });
    expect(task.progressSource ?? null).toBeNull();
    expect(scheduleHasAuthoritativeProgressJudgment(task)).toBe(true);
    expect(scheduleProgressJudgedAt(task)).toBe(CREATED_AT);
    const truth = buildDAVEProjectTruth({
      projectId: 'project-alpha', projectName: 'Alpha', updates: [],
      scheduleItems: selectAuthoritativeScheduleItems({ scheduleItems: after.items, scheduleDocuments: after.documents }),
      referenceDocuments: after.documents, now: '2026-09-26T12:00:00.000Z',
    });
    expect(truth.evidence.records.find(record => record.id === 'schedule:hand')?.capturedAt).toBe(CREATED_AT);
  });

  it('the upload\'s whole-row merge with the cloud\'s 50% keeps the 40%, on this device and from the stale one', () => {
    const stale = punch(raised);
    const givenBack = punch(deleteLookahead(raised));
    expect(recoverDAVEScheduleRecords({ local: [givenBack], cloud: [stale], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
    expect(daveScheduleItemsNeedingCloudUpload({ local: [givenBack], cloud: [stale] }).map(item => item.percentComplete)).toEqual([40]);
    expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [givenBack], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
    expect(daveScheduleItemsNeedingCloudUpload({ local: [stale], cloud: [givenBack] })).toEqual([]);
  });

  it('a file\'s percent with its own confirmation time, raised by a lookahead, comes back confirmed at the delete too', () => {
    // A master set the hand-entered task to 30% (the schedule's, confirmed at its approval); the lookahead raises it to 50%.
    const fileSet = approve({ items: [{ ...handEntered, status: 'Not Started', percentComplete: 0 }], documents: [] }, master,
      rows(master, ['Punch list,Alpha,Lot,11/01/2026,11/05/2026,30%']));
    expect(punch(fileSet)).toMatchObject({ percentComplete: 30, progressSource: 'schedule_import', progressConfirmedAt: master.importedAt });
    const up = approve(fileSet, lookahead, rows(lookahead, ['Punch list,Alpha,Lot,11/01/2026,11/05/2026,50%']));
    const stale = punch(up);
    const givenBack = punch(deleteLookahead(up));
    expect(givenBack).toMatchObject({ percentComplete: 30, progressSource: 'schedule_import', progressConfirmedAt: DELETED_AT });
    expect(scheduleProgressJudgedAt(givenBack)).toBe(master.importedAt); // still dated when the master stated it
    expect(recoverDAVEScheduleRecords({ local: [givenBack], cloud: [stale], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 30 });
  });
});
