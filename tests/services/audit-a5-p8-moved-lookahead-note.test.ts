/**
 * Whole-app audit A5 pass 8 L3 (30 Sep 2026): a task a new master moved lost
 * its lookahead note, and the hidden old row kept it.
 *
 * (a) Master 20%; David enters 40%; a lookahead sets 60%; then a new master
 * moves the task and has no % column. The new row carried 60% with no note,
 * so Delete PDF + Items on the lookahead left it at 60%, where the same task
 * left on its dates got 40% back. With no entry by David, the moved task
 * stayed at 60% where the unmoved one went back to 20%.
 *
 * (b) After any master that moved a lookahead's task, the delete question
 * said it "also puts back the earlier dates and progress of 1 task", but
 * nothing shown changed: the hidden old row was counted, rewritten and
 * synced.
 *
 * Now the row a master saves for a task it moved carries the task's note,
 * brought up to what the master says (its dates, and its percent when it
 * states one), as the same task left on its dates keeps it; and the delete
 * counts and gives back only the tasks shown. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleItemsAfterScheduleDeleted,
  scheduleLookaheadDeleteNote,
} from '../../services/ScheduleLookahead';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const DAVID_AT = '2026-09-10T15:00:00.000Z';
const DELETED_AT = '2026-09-28T00:00:00.000Z';
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const master2 = schedule('MASTER 0926', '2026-09-26T12:00:00.000Z');

function rows(source: ReferenceDocument, header: string, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
const PERCENT = 'Task,Project,Area,Start,Finish,% Complete';
const NO_PERCENT = 'Task,Project,Area,Start,Finish';

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
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pour = (state: State) => {
  const pours = shown(state).filter(item => item.taskName === 'Pour slab');
  expect(pours).toHaveLength(1);
  return pours[0];
};

/** What the phone's Delete PDF + Items does (App.tsx): the question, then the tasks it saves. */
function deleteLookahead(state: State) {
  const removed = scheduleItemsOnlyInImportBatch(state.items, lookahead, state.documents);
  const question = scheduleLookaheadDeleteNote(state.items, lookahead, removed, state.documents);
  const items = state.items.filter(item => !removed.includes(item));
  const documents = state.documents.filter(document => document !== lookahead);
  const saved = scheduleItemsAfterScheduleDeleted({ items, removed, document: lookahead, documents, updatedAt: DELETED_AT });
  const changed = new Map(saved.map(item => [item.id, item]));
  return { question, saved, after: { items: items.map(item => changed.get(item.id) || item), documents } };
}

/** Master 20% (and David's 40% by hand, when asked); the lookahead sets 60%. */
function raised(byDavid: boolean): State {
  const atMaster = approve({ items: [], documents: [] }, master, rows(master, PERCENT, [
    'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
  ]));
  const items = byDavid ? atMaster.items.map(item => item.taskName === 'Pour slab' ? {
    ...item, percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: DAVID_AT, updatedAt: DAVID_AT,
  } as ScheduleItem : item) : atMaster.items;
  const state = approve({ ...atMaster, items }, lookahead, rows(lookahead, PERCENT, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,60%']));
  expect(pour(state)).toMatchObject({ percentComplete: 60, startDate: '09/28/2026' });
  return state;
}
const movedBy = (state: State, header: string, line: string) =>
  approve(state, master2, rows(master2, header, [line, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));

describe('A5 p8 L3 (a): a task a master moved keeps its lookahead note, so deleting the lookahead gives its percent back', () => {
  it.each([
    ['David entered 40%', true, 40],
    ['no entry by David (the master\'s 20%)', false, 20],
  ])('%s: the moved task goes back to the percent before the lookahead, as the task left on its dates does', (_label, byDavid, back) => {
    const state = raised(byDavid);
    const oldId = pour(state).id;
    // The control: the master repeats the lookahead's dates, so the task is not moved.
    const unmoved = deleteLookahead(movedBy(state, NO_PERCENT, 'Pour slab,Alpha,Lot,09/28/2026,09/30/2026'));
    expect(pour(unmoved.after)).toMatchObject({ id: oldId, percentComplete: back });

    const moved = movedBy(state, NO_PERCENT, 'Pour slab,Alpha,Lot,10/05/2026,10/07/2026');
    const task = pour(moved);
    expect(task.id).not.toBe(oldId);
    expect(task).toMatchObject({ percentComplete: 60, startDate: '10/05/2026', revisedFromTaskIds: [oldId] });
    // The note, brought up to what the new master says: its dates.
    expect(task.lookaheadOverlay).toMatchObject({ masterStartDate: '10/05/2026', masterFinishDate: '10/07/2026' });
    expect(task.lookaheadOverlay?.lookaheads.map(entry => entry.batchId)).toEqual([lookahead.importBatchId]);

    const deleted = deleteLookahead(moved);
    expect(deleted.question).toContain('also puts back the earlier progress of 1 task this lookahead changed.');
    expect(pour(deleted.after)).toMatchObject({ id: task.id, percentComplete: back, startDate: '10/05/2026' });
    expect(pour(deleted.after)).not.toHaveProperty('lookaheadOverlay');
    // Only the task shown is saved; the hidden old row is left as it was.
    expect(deleted.saved.map(item => item.id)).toEqual([task.id]);
  });
});

describe('A5 p8 L3 (b): the delete counts and gives back only the tasks shown', () => {
  it('a master that moved the task and stated its own 30%: nothing shown goes back, so the question says nothing and nothing is saved', () => {
    const moved = movedBy(raised(true), PERCENT, 'Pour slab,Alpha,Lot,10/05/2026,10/07/2026,30%');
    const hidden = moved.items.find(item => item.taskName === 'Pour slab' && item.importBatchId === master.importBatchId)!;
    expect(hidden.lookaheadOverlay).toBeDefined();
    expect(shown(moved).some(item => item.id === hidden.id)).toBe(false);
    const deleted = deleteLookahead(moved);
    expect(deleted.question).toBe('');
    expect(deleted.saved.some(item => item.id === hidden.id)).toBe(false);
    expect(deleted.after.items.find(item => item.id === hidden.id)).toBe(hidden);
  });

  it('the phone\'s delete question passes the saved schedules', () => {
    expect(app).toContain('scheduleLookaheadDeleteNote(scheduleItems as unknown as import(\'./types\').ScheduleItem[], document, relatedScheduleItems as unknown as import(\'./types\').ScheduleItem[], referenceDocuments)');
  });
});
