/**
 * Owner answer Q22 follow-ups from whole-app audit A5 pass 6 and A10 pass 4
 * (30 Sep 2026). A lookahead adds to the master: a task in both shows once
 * with the lookahead's dates and progress, progress from a file never goes
 * below what David entered, and deleting the lookahead gives back the
 * master's dates and the percent it gave. Synthetic data only.
 *
 * A5 p6 M2 = A10 p4 M1 The lookahead's note did not say whether the progress
 *    before it was David's own. Master 20%, David 40% by hand, lookahead 60%:
 *    a new master repeating 20% took the task to 20%, and deleting the
 *    lookahead gave back 40% still marked "Schedule update", so summaries
 *    called it the schedule's and a later master at 25% lowered it.
 * A5 p6 M1 Deleting an older lookahead lowered progress a newer one still
 *    states: master 60%, wk39 says 70%, wk40 says 70% too (no change, so it
 *    noted no percent); deleting wk39 took the task to 60% and the delete
 *    question said it put back the earlier progress of 1 task.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleItemsAfterLookaheadDeleted,
  scheduleLookaheadDeleteNote,
} from '../../services/ScheduleLookahead';
import { scheduleProgressRecordedByManager } from '../../services/ScheduleProgressInvariant';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

// Helpers as in owner-answer-q22-review-fixes.test.ts.
const schedule = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames,
  importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const task = (id: string, projectName: string, taskName: string, source: ReferenceDocument, startDate: string, finishDate: string, extra: Partial<ScheduleItem> = {}) => ({
  id, projectName, taskName, locationName: 'Lot', owner: '', contractor: '', startDate, finishDate, milestone: '',
  status: 'Not Started', percentComplete: 0, priority: 'Medium', notes: '', createdAt: source.importedAt,
  importedAt: source.importedAt, sourceDocumentId: source.id, importBatchId: source.importBatchId, ...extra,
}) as ScheduleItem;
const statusOf = (percent: number) => percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started';

const APPROVED = '2026-09-20T12:00:00.000Z';
const DAVID_AT = '2026-09-10T15:00:00.000Z';
const DELETED_AT = '2026-09-25T00:00:00.000Z';
const master = schedule('MASTER UPDATE 8312026', ['Alpha', 'Beta'], '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], APPROVED, { scheduleRole: 'lookahead' });
const lookahead2 = schedule('Alpha lookahead week 40', ['Alpha'], '2026-09-27T12:00:00.000Z', { scheduleRole: 'lookahead' });

/** The master's file says Pour slab is at `pour`% and Roofing 30%. */
const masterItems = (pour: number) => [
  task('m-pour', 'Alpha', 'Pour slab', master, '10/01/2026', '10/03/2026', { percentComplete: pour, status: statusOf(pour) }),
  task('m-roof', 'Alpha', 'Roofing', master, '12/01/2026', '12/15/2026', { percentComplete: 30, status: 'In Progress' }),
];
/** David records a percent by hand on the phone. */
const byDavid = (items: ScheduleItem[], id: string, percent: number, at = DAVID_AT) => items.map(item => item.id === id ? {
  ...item, percentComplete: percent, status: statusOf(percent),
  progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at,
} as ScheduleItem : item);

/** A file read as the phone reads a CSV, bound to its schedule document. */
function csvRows(lines: string[], source: ReferenceDocument): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: lines.join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha', 'Beta'], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
const pourRow = (source: ReferenceDocument, percent: number | string, start = '09/28/2026', finish = '09/30/2026') =>
  csvRows([HEADER, `Pour slab,Alpha,Lot,${start},${finish},${percent}%`], source);
/** A new master: Pour slab at `pour`% on its own dates (or new ones), Roofing as before. */
const masterRows = (source: ReferenceDocument, pour: number, start = '10/01/2026', finish = '10/03/2026') => csvRows([
  HEADER, `Pour slab,Alpha,Lot,${start},${finish},${pour}%`, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
], source);

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, rows: ScheduleItem[], approvedAt = source.importedAt): State {
  const { items, documents } = state;
  const withDocument = documents.some(document => document.id === source.id) ? documents : [...documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: items,
    imported: rows,
    completionMatch: () => null,
    mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(items, withDocument, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, documents),
    approvedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: withDocument };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents });
const view = (state: State, filter = /./) => shown(state)
  .map(item => `${item.id} ${item.taskName} ${item.startDate}-${item.finishDate} ${item.percentComplete}%`)
  .filter(line => filter.test(line)).sort();
const pour = (state: State) => {
  const matches = shown(state).filter(item => item.taskName === 'Pour slab');
  expect(matches).toHaveLength(1);
  return matches[0];
};

/** Delete PDF + Items, as the phone does it: the question first, then the tasks only it contains go, and its overlay comes off. */
function deleteLookahead(state: State, document: ReferenceDocument): State & { note: string } {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents);
  const removedIds = new Set(removed.map(item => item.id));
  const note = scheduleLookaheadDeleteNote(state.items, document, removed);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterLookaheadDeleted(kept, document, DELETED_AT).map(item => [item.id, item]));
  return {
    note,
    items: kept.map(item => restored.get(item.id) || item),
    documents: state.documents.filter(candidate => candidate.id !== document.id),
  };
}

/** What Project Truth says of Pour slab: its record line, and whether it reads as David's word. */
function truthOfPour(state: State) {
  const item = pour(state);
  const truth = buildDAVEProjectTruth({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state),
    referenceDocuments: state.documents, now: '2026-09-26T12:00:00.000Z',
  });
  const record = truth.evidence.records.find(value => value.id === `schedule:${item.id}`)!;
  const correlation = truth.correlations.tasks.find(value => value.taskId === item.id)!;
  return { record: record.summary.replace(/, due [0-9/]+/, ''), explanation: correlation.explanation };
}

/** Master 20%; David records 40% by hand; the lookahead raises it to 60%. */
const davidThenLookahead = (masterPercent = 20, lookaheadPercent = 60) => approve(
  { items: byDavid(masterItems(masterPercent), 'm-pour', 40), documents: [master] }, lookahead, pourRow(lookahead, lookaheadPercent),
);

describe('A5 p6 M2 / A10 p4 M1: the lookahead notes whether the progress before it was David\'s own', () => {
  it('the lookahead raises David\'s 40% to 60%, and its note keeps David\'s 40%, who said it, and that the master file\'s own percent is unknown', () => {
    const state = davidThenLookahead();
    expect(view(state, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
    expect(pour(state)).toMatchObject({ progressSource: 'project_manager', progressConfirmedBy: 'Schedule update' });
    expect(pour(state).lookaheadOverlay).toEqual({
      masterStartDate: '10/01/2026', masterFinishDate: '10/03/2026', masterPercentComplete: 40,
      masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: DAVID_AT,
      masterFilePercentComplete: null,
      lookaheads: [{ batchId: lookahead.importBatchId, startDate: '09/28/2026', finishDate: '09/30/2026', percentComplete: 60 }],
    });
    // A task the master file set notes the file's percent as the master file's own.
    const fileOnly = approve({ items: masterItems(20), documents: [master] }, lookahead, pourRow(lookahead, 60));
    expect(pour(fileOnly).lookaheadOverlay).toMatchObject({ masterPercentComplete: 20, masterProgressSource: null, masterFilePercentComplete: 20 });
  });

  it('(a) a new master repeating its dates and 20% leaves the lookahead\'s 60%; master 0%, David 40%, lookahead 70%, master repeating 0% leaves 70%', () => {
    const repeated = approve(davidThenLookahead(), master2, masterRows(master2, 20));
    expect(view(repeated, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
    // The note now knows what the master file says; David's 40% stays what is given back.
    expect(pour(repeated).lookaheadOverlay).toMatchObject({ masterPercentComplete: 40, masterProgressConfirmedBy: 'David', masterFilePercentComplete: 20 });
    const again = approve(repeated, schedule('MASTER UPDATE 10052026', ['Alpha', 'Beta'], '2026-10-05T12:00:00.000Z'),
      masterRows(schedule('MASTER UPDATE 10052026', ['Alpha', 'Beta'], '2026-10-05T12:00:00.000Z'), 20));
    expect(pour(again)).toMatchObject({ id: 'm-pour', percentComplete: 60 });

    const zero = approve(davidThenLookahead(0, 70), master2, masterRows(master2, 0));
    expect(pour(zero)).toMatchObject({ id: 'm-pour', percentComplete: 70, status: 'In Progress' });
    // A master that says more than David did is news: the newer file's percent, as before.
    expect(pour(approve(davidThenLookahead(), master2, masterRows(master2, 50)))).toMatchObject({ id: 'm-pour', percentComplete: 50 });
  });

  it('a later file never sets the task below David\'s 40%: a second lookahead at 30%, or a new master that moves the task at 20%', () => {
    const second = approve(davidThenLookahead(), lookahead2, pourRow(lookahead2, 30, '09/29/2026', '10/01/2026'));
    expect(pour(second)).toMatchObject({
      id: 'm-pour', startDate: '09/29/2026', percentComplete: 40, status: 'In Progress',
      progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: lookahead2.importedAt,
    });
    expect(truthOfPour(second).record).toBe('Pour slab: In Progress, 40% complete — project manager judgment.');

    const moved = approve(davidThenLookahead(), master2, masterRows(master2, 20, '10/12/2026', '10/14/2026'));
    expect(pour(moved)).toMatchObject({
      startDate: '10/12/2026', percentComplete: 40, progressSource: 'project_manager', progressConfirmedBy: 'David',
    });
    // Above David's 40% the file's percent stands, as before.
    expect(pour(approve(davidThenLookahead(), lookahead2, pourRow(lookahead2, 45)))).toMatchObject({ percentComplete: 45, progressConfirmedBy: 'Schedule update' });
  });

  it('(b) Delete PDF + Items gives back David\'s 40% as David\'s: the summaries say so, and a later master at 25% leaves it', () => {
    const state = davidThenLookahead();
    expect(truthOfPour(state).record).toBe('Pour slab: In Progress, 60% complete.');
    const after = deleteLookahead(state, lookahead);
    expect(after.note).toBe(' Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    expect(view(after, /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 40%']);
    // Confirmed at the delete, so every device takes it back (DAVEScheduleRecovery keeps the newer confirmation).
    expect(pour(after)).toMatchObject({
      status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: DELETED_AT,
    });
    expect(pour(after)).not.toHaveProperty('lookaheadOverlay');
    expect(scheduleProgressRecordedByManager(pour(after))).toBe(true);
    expect(truthOfPour(after)).toEqual({
      record: 'Pour slab: In Progress, 40% complete — project manager judgment.',
      explanation: 'A project manager recorded in progress at 40% complete. That professional judgment is the current progress evidence.',
    });
    const later = approve(after, master2, masterRows(master2, 25));
    expect(pour(later)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David' });
  });

  it('after a repeating master, Delete PDF + Items still gives back David\'s 40%, not the master file\'s 20%', () => {
    const repeated = approve(davidThenLookahead(), master2, masterRows(master2, 20));
    const after = deleteLookahead(repeated, lookahead);
    expect(pour(after)).toMatchObject({ startDate: '10/01/2026', percentComplete: 40, progressConfirmedBy: 'David' });
  });

  it('David records 75% under the first lookahead: the next lookahead\'s note takes his newer word, so deleting it gives back 75%, not the first lookahead\'s 70%', () => {
    const first = approve({ items: masterItems(60), documents: [master] }, lookahead, pourRow(lookahead, 70));
    const edited = { ...first, items: byDavid(first.items, 'm-pour', 75, '2026-09-22T08:00:00.000Z') };
    const second = approve(edited, lookahead2, pourRow(lookahead2, 80));
    expect(pour(second)).toMatchObject({ percentComplete: 80, progressConfirmedBy: 'Schedule update' });
    expect(pour(second).lookaheadOverlay).toMatchObject({
      masterPercentComplete: 75, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-22T08:00:00.000Z', masterFilePercentComplete: 60,
    });
    expect(pour(deleteLookahead(second, lookahead2))).toMatchObject({ percentComplete: 75, progressConfirmedBy: 'David' });

    // David lowered it to 50% under the first lookahead: its 70% no longer stands, so deleting the second gives back his 50%.
    const lowered = approve({ ...first, items: byDavid(first.items, 'm-pour', 50, '2026-09-22T08:00:00.000Z') }, lookahead2, pourRow(lookahead2, 65));
    expect(pour(lowered)).toMatchObject({ percentComplete: 65 });
    expect(pour(deleteLookahead(lowered, lookahead2))).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David' });
  });

  it('a lookahead noted before this build (no provenance) works as before', () => {
    const old = davidThenLookahead();
    const legacy: State = {
      ...old,
      items: old.items.map(item => item.id === 'm-pour' ? {
        ...item, lookaheadOverlay: {
          masterStartDate: '10/01/2026', masterFinishDate: '10/03/2026', masterPercentComplete: 40,
          lookaheads: item.lookaheadOverlay!.lookaheads,
        },
      } : item),
    };
    // Its percent was the file's: a master repeating 40% is a repeat, and deleting it gives back 40% marked as today.
    expect(pour(approve(legacy, master2, masterRows(master2, 40)))).toMatchObject({ percentComplete: 60 });
    expect(pour(deleteLookahead(legacy, lookahead))).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'Schedule update', progressConfirmedAt: DELETED_AT });
  });
});

describe('A5 p6 M1: deleting an older lookahead keeps the percent a newer one still states', () => {
  const wk39 = schedule('Alpha lookahead wk39', ['Alpha'], '2026-09-21T12:00:00.000Z', { scheduleRole: 'lookahead' });
  const wk40 = schedule('Alpha lookahead wk40', ['Alpha'], '2026-09-28T12:00:00.000Z', { scheduleRole: 'lookahead' });
  const both = () => approve(approve({ items: masterItems(60), documents: [master] }, wk39, pourRow(wk39, 70)), wk40, pourRow(wk40, 70));

  it('master 60%; wk39 and wk40 both say 70%: each notes the 70% it states', () => {
    expect(view(both(), /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 70%']);
    expect(pour(both()).lookaheadOverlay?.lookaheads.map(entry => [entry.batchId, entry.percentComplete]))
      .toEqual([[wk39.importBatchId, 70], [wk40.importBatchId, 70]]);
  });

  it('deleting wk39 keeps 70% and the question does not claim a change; deleting wk40 then gives back the master\'s dates and 60%', () => {
    const withoutWk39 = deleteLookahead(both(), wk39);
    expect(withoutWk39.note).toBe('');
    expect(view(withoutWk39, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 70%']);
    const neither = deleteLookahead(withoutWk39, wk40);
    expect(neither.note).toBe(' Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    expect(view(neither, /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 60%']);
  });

  it('David\'s 40% and a lookahead that states 40% too: it notes 40%, and its delete gives back only the dates', () => {
    const state = approve({ items: byDavid(masterItems(20), 'm-pour', 40), documents: [master] }, lookahead, pourRow(lookahead, 40));
    expect(pour(state).lookaheadOverlay?.lookaheads[0].percentComplete).toBe(40);
    const after = deleteLookahead(state, lookahead);
    expect(after.note).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
    expect(pour(after)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David', progressConfirmedAt: DAVID_AT });
  });

  it('a row it states but the task does not end at notes no percent: below David\'s, or with no % column', () => {
    const below = approve({ items: byDavid(masterItems(20), 'm-pour', 40), documents: [master] }, lookahead, pourRow(lookahead, 30));
    expect(pour(below)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David' });
    expect(pour(below).lookaheadOverlay?.lookaheads[0].percentComplete).toBeNull();
  });
});
