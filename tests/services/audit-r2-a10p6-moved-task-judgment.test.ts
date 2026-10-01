/**
 * Audit round 2, A10 pass 6 L1 = A5 pass 8 L2 (30 Sep 2026): a master that
 * moved a task dropped the time David judged a percent given back to him.
 *
 * David recorded Pour slab at 40% on 10 Sep; a lookahead raised it to 60%;
 * Delete PDF + Items on 25 Sep gave back his 40%, confirmed at the delete and
 * judged on 10 Sep (progressJudgment, A10 pass 5 L1). A field report of 22 Sep
 * said "Pour slab is complete", so reconciliation warned "Possible progress is
 * not reflected in the schedule". Then a new master moved Pour slab: the new
 * row carried the percent, source, confirmer and confirmed time, but not
 * progressJudgment, so his 40% read as judged on 25 Sep, after the field
 * report, and the warning went away. The same with a 30% row and with a file
 * that has no percent column.
 *
 * Now both carries in ScheduleImportMerge keep progressJudgment. Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterLookaheadDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressJudgedAt } from '../../services/ScheduleProgressSource';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
  cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const master2 = schedule('MASTER 0926', '2026-09-26T12:00:00.000Z');

const DAVID_AT = '2026-09-10T15:00:00.000Z';
const DELETED_AT = '2026-09-25T00:00:00.000Z';

function csvRows(header: string, lines: string[], source: ReferenceDocument): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
const WITH_PERCENT = 'Task,Project,Area,Start,Finish,% Complete';
const NO_PERCENT = 'Task,Project,Area,Start,Finish';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, rows: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows, completionMatch: () => null, mergeCompletion: item => item,
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
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pour = (state: State) => {
  const pours = shown(state).filter(item => item.taskName === 'Pour slab');
  expect(pours).toHaveLength(1);
  return pours[0];
};

/** Master 20%; David 40% on 10 Sep; a lookahead 60%; Delete PDF + Items on 25 Sep gives back his 40%. */
function givenBack(): State {
  const atMaster = approve({ items: [], documents: [] }, master, csvRows(WITH_PERCENT, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%'], master));
  const byDavid = atMaster.items.map(item => item.taskName === 'Pour slab' ? {
    ...item, percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: DAVID_AT, updatedAt: DAVID_AT,
  } as ScheduleItem : item);
  const raised = approve({ ...atMaster, items: byDavid }, lookahead, csvRows(WITH_PERCENT, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,60%'], lookahead));
  expect(pour(raised)).toMatchObject({ percentComplete: 60 });
  return deleteLookahead(raised);
}

const fieldReport = (scheduleItemId: string): ProjectUpdate => ({
  id: 'field-22sep', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-22T09:00:00.000Z',
  notes: 'Pour slab is complete.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
  photos: [], recipients: { contactIds: [] },
} as unknown as ProjectUpdate);
const notReflected = (state: State, update: ProjectUpdate) => buildPIEScheduleReconciliation({
  scheduleItems: shown(state), updates: [update], projectName: 'Alpha', now: new Date('2026-09-27T12:00:00.000Z'),
}).warnings.filter(warning => warning.type === 'field_progress_not_reflected' && warning.scheduleItemId === pour(state).id);

describe('A10 p6 L1 / A5 p8 L2: a master that moves a task keeps the time David judged a percent given back', () => {
  it('before the move: his 40% is back, judged 10 Sep, and the 22 Sep field report warns', () => {
    const state = givenBack();
    expect(pour(state)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David', progressConfirmedAt: DELETED_AT });
    expect(scheduleProgressJudgedAt(pour(state))).toBe(DAVID_AT);
    expect(notReflected(state, fieldReport(pour(state).id))).toHaveLength(1);
  });

  it.each([
    ['a 30% row', WITH_PERCENT, 'Pour slab,Alpha,Lot,10/02/2026,10/04/2026,30%'],
    ['no percent column', NO_PERCENT, 'Pour slab,Alpha,Lot,10/02/2026,10/04/2026'],
  ])('a master that moves Pour slab (%s): the new row keeps his 40% judged 10 Sep, and the warning stays', (_label, header, line) => {
    const before = givenBack();
    const oldId = pour(before).id;
    const moved = approve(before, master2, csvRows(header, [line], master2));
    const task = pour(moved);
    expect(task.id).not.toBe(oldId);
    expect(task).toMatchObject({ startDate: '10/02/2026', percentComplete: 40, progressConfirmedBy: 'David', revisedFromTaskIds: [oldId] });
    expect(scheduleProgressJudgedAt(task)).toBe(DAVID_AT);
    expect(notReflected(moved, fieldReport(oldId))).toHaveLength(1);
  });
});
