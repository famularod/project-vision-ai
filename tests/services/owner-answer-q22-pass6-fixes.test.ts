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
 * A8 p5 M1 Picking the master in use again (by accident, or to finish rows
 *    an Accept Selected left) opened the review preset to Lookahead, "can
 *    only be added again as a lookahead": the master became its own
 *    lookahead, whose tasks always show, so a task the next master dropped
 *    stayed and went overdue.
 * A5 p6 L1 A lookahead imported before Q22 as a full schedule, imported again
 *    as a lookahead before the master was made current, paired with its own
 *    old copy; after Set Active the task showed twice when the file had no
 *    Area column.
 * A5 p6 L2 A CSV percent written as a fraction ("0.4", as a spreadsheet's
 *    percent cell exports) was read as a stated 0%.
 * A10 p4 (residual) The fallback for records older than progress provenance
 *    called an untouched schedule-file task below 100% the project manager's
 *    judgment, and rows marked schedule_import too.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleHasAuthoritativeProgressJudgment, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleImportRoleRefusal,
  scheduleItemsAfterLookaheadDeleted,
  scheduleLookaheadDeleteNote,
  suggestScheduleImportRole,
} from '../../services/ScheduleLookahead';
import { resolveScheduleImportSourceIdentity } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';
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
      // A5 pass 7 L3: the note also keeps the status stated with the percent, given back with it.
      masterStartDate: '10/01/2026', masterFinishDate: '10/03/2026', masterPercentComplete: 40, masterStatus: 'In Progress',
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

describe('A8 p5 M1 / A5 p6 L1: a full schedule\'s file is offered again as a lookahead only while it is not the schedule shown', () => {
  const PROJECTS = [{ id: 'alpha-id', name: 'Alpha' }];
  const fileOf = (lines: string[]) => {
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const identity = resolveScheduleImportSourceIdentity({ bytes, projects: PROJECTS, documentIdIsDeleted: () => false });
    const pick = (documents: ReferenceDocument[]) => scheduleImportOfFile({
      bytes, projects: PROJECTS, documentIdIsDeleted: () => false, documents, scheduleItems: [], projectNames: ['Alpha'],
    });
    return { identity, pick };
  };
  const ALREADY = 'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate.';
  const MASTER_FIRST = ' If this file is a lookahead, make your master schedule current first, then import it again.';
  const masterFile = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Frame walls,Alpha,Lot,10/05/2026,10/09/2026,0%']);
  const savedMaster = schedule(masterFile.identity.documentId, ['Alpha'], '2026-08-31T12:00:00.000Z', {
    importBatchId: masterFile.identity.batchId, contentSha256: masterFile.identity.contentSha256,
  });
  const newerMaster = schedule('MASTER UPDATE 9152026', ['Alpha'], '2026-09-15T12:00:00.000Z');

  it('the master in use, picked again, is refused "Schedule already added", with what to do if the file is a lookahead', () => {
    const result = masterFile.pick([savedMaster]);
    expect(result).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: ALREADY + MASTER_FIRST });
  });

  it('once another master is the one shown, the same file is offered as a lookahead under an import of its own', () => {
    for (const documents of [[{ ...savedMaster, isCurrent: false }, newerMaster], [savedMaster, newerMaster]]) {
      const result = masterFile.pick(documents);
      expect(result).toMatchObject({ alreadyImported: false, asLookahead: true });
      expect(result.identity.documentId).not.toBe(savedMaster.id);
    }
  });

  it('a file already saved as a lookahead is refused as before, with no hint', () => {
    expect(masterFile.pick([{ ...savedMaster, scheduleRole: 'lookahead' }]))
      .toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: ALREADY });
  });

  it('the review refuses it too when the file\'s full copy is the schedule shown by the time it is accepted', () => {
    const again = schedule('again', ['Alpha'], APPROVED, { scheduleRole: 'lookahead', contentSha256: masterFile.identity.contentSha256 });
    const batch = { documents: [again], items: [] as ScheduleItem[] };
    expect(suggestScheduleImportRole({ batch, documents: [savedMaster], scheduleItems: [] })).toEqual({
      role: 'lookahead', only: true,
      reason: 'this exact file is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead',
    });
    const refusal = 'This exact schedule is the full schedule shown now for these projects. Make your master current first, then import this as a lookahead.';
    expect(scheduleImportRoleRefusal(batch, 'lookahead', [savedMaster])).toBe(refusal);
    expect(scheduleImportRoleRefusal(batch, 'master', [savedMaster])).toBe(refusal);
    // With the master made current: as before.
    expect(scheduleImportRoleRefusal(batch, 'lookahead', [{ ...savedMaster, isCurrent: false }, newerMaster])).toBeNull();
    expect(scheduleImportRoleRefusal(batch, 'master', [{ ...savedMaster, isCurrent: false }, newerMaster]))
      .toMatch(/^This exact schedule is already saved as a full schedule/);
  });

  it('a lookahead saved as a full schedule before Q22, with no Area column: refused until the master is current, then shown once', () => {
    const LINES = ['Task,Project,Start,Finish,Owner', 'Pour slab,Alpha,09/28/2026,09/30/2026,Acme Concrete'];
    const earlierFile = fileOf(LINES);
    // Imported before Q22 as a full schedule: newer than the master, so it is the schedule Alpha shows.
    const earlier = schedule(earlierFile.identity.documentId, ['Alpha'], '2026-09-15T12:00:00.000Z', {
      importBatchId: earlierFile.identity.batchId, contentSha256: earlierFile.identity.contentSha256,
    });
    const saved: State = {
      items: [...masterItems(20), ...csvRows(LINES, earlier).map(row => ({ ...row, id: `old-${row.id}` }))],
      documents: [master, earlier],
    };
    expect(view(saved, /Pour/)).toEqual([`old-${earlier.id}-1 Pour slab 09/28/2026-09/30/2026 0%`]);
    expect(earlierFile.pick(saved.documents)).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: ALREADY + MASTER_FIRST });

    // Set Active on the master; then the file is offered as a lookahead and restates the master's task.
    const current: State = { ...saved, documents: [{ ...master, importedAt: master.importedAt }, { ...earlier, isCurrent: false }] };
    expect(view(current, /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 20%']);
    const picked = earlierFile.pick(current.documents);
    expect(picked.asLookahead).toBe(true);
    const again = schedule(picked.identity.documentId, ['Alpha'], APPROVED, {
      importBatchId: picked.identity.batchId, contentSha256: picked.identity.contentSha256, scheduleRole: 'lookahead',
    });
    const after = approve(current, again, csvRows(LINES, again));
    expect(view(after, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 20%']);
  });
});

describe('A5 p6 L2: a percent written as a fraction reads as that share of 100', () => {
  const percents = (lines: string[]) => csvRows([HEADER, ...lines.map((value, index) => `Task ${index + 1},Alpha,Lot,10/01/2026,10/03/2026,${value}`)], lookahead)
    .map(row => [row.percentComplete, row.status, row.percentCompleteStated]);

  it('a column of fractions: 0.4 is 40%, 1 and 1.0 are 100%, 0 is 0%', () => {
    expect(percents(['0.4', '.25', '1.0', '1', '0', '0.00'])).toEqual([
      [40, 'In Progress', undefined], [25, 'In Progress', undefined], [100, 'Complete', undefined],
      [100, 'Complete', undefined], [0, 'Not Started', undefined], [0, 'Not Started', undefined],
    ]);
  });

  it('a column of whole percents keeps today\'s reading: 1 and 1.0 are 1%; a 0–1 decimal there is a percent too', () => {
    // A5 pass 7 L1: the column decides, not the cell. With 45 in it the column is percents, so 0.4 is
    // under half a percent (0%), not 40%. Pin updated (A5 pass 8 L4): "0.5%" is half a percent, rounded as
    // the progress rule rounds it, to 1% (it was cut to 0%).
    expect(percents(['1.0', '1', '45', '0.4', '50%', '0.5%', ''])).toEqual([
      [1, 'In Progress', undefined], [1, 'In Progress', undefined], [45, 'In Progress', undefined],
      [0, 'Not Started', undefined], [50, 'In Progress', undefined], [1, 'In Progress', undefined], [0, 'Not Started', false],
    ]);
  });

  it('Microsoft Project rows read the same way', () => {
    const rows = normalizeMicrosoftProjectPdfRows({
      contents: [
        'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
        '1\tAlpha\t0\t60 days\t09/01/2026\t12/15/2026\t0.5',
        '2\tPour slab\t1\t3 days\t10/01/2026\t10/03/2026\t0.4',
        '3\tRoofing\t1\t10 days\t12/01/2026\t12/15/2026\t1.00',
      ].join('\n'),
      sourceName: 'Alpha.pdf', projects: ['Alpha'], now: new Date(APPROVED),
    });
    expect(rows.map(row => [row.taskName, row.percentComplete])).toEqual([['Pour slab', 40], ['Roofing', 100]]);
  });

  it('through the merge: a lookahead stating 0.4 takes the master\'s 20% to 40%, not to 0% Not Started', () => {
    const state = approve({ items: masterItems(20), documents: [master] }, lookahead,
      csvRows([HEADER, 'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,0.4'], lookahead));
    expect(pour(state)).toMatchObject({ percentComplete: 40, status: 'In Progress' });
  });
});

describe('A10 p4: a schedule file\'s percent reads as the schedule\'s, never as the manager\'s judgment', () => {
  const truthRecord = (state: State, id: string) => {
    const truth = buildDAVEProjectTruth({
      projectId: 'project-alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state),
      referenceDocuments: state.documents, now: '2026-09-26T12:00:00.000Z',
    });
    return truth.evidence.records.find(value => value.id === `schedule:${id}`)!.summary.replace(/, due [0-9/]+/, '');
  };
  const inboxAction = (state: State, id: string) => buildDAVEActionInbox({ scheduleItems: shown(state), now: new Date('2026-12-20T12:00:00.000Z') })
    .items.find(item => item.scheduleItemId === id)!.requestedAction;

  it('a master task David never touched, at 30%, and one a lookahead raised to 60%, are the schedule\'s', () => {
    const state: State = { items: masterItems(20), documents: [master] };
    const roof = shown(state).find(item => item.id === 'm-roof')!;
    expect(roof).toMatchObject({ status: 'In Progress', percentComplete: 30 });
    expect(roof.progressSource ?? null).toBeNull();
    expect(scheduleHasAuthoritativeProgressJudgment(roof)).toBe(false);
    expect(truthRecord(state, 'm-roof')).toBe('Roofing: In Progress, 30% complete.');
    expect(inboxAction(state, 'm-roof')).toBe('Confirm current field status and the next accountable step.');
    // Marked as the import's.
    expect(scheduleHasAuthoritativeProgressJudgment({ ...roof, progressSource: 'schedule_import' })).toBe(false);

    const raised = approve(state, lookahead, pourRow(lookahead, 60));
    expect(pour(raised)).toMatchObject({ percentComplete: 60, status: 'In Progress' });
    expect(pour(raised).progressSource ?? null).toBeNull();
    expect(truthRecord(raised, 'm-pour')).toBe('Pour slab: In Progress, 60% complete.');
  });

  it('David\'s own percent is his judgment, and so is a task entered by hand before progress was recorded with who set it', () => {
    const state: State = { items: byDavid(masterItems(20), 'm-roof', 30), documents: [master] };
    expect(truthRecord(state, 'm-roof')).toBe('Roofing: In Progress, 30% complete — project manager judgment.');
    expect(inboxAction(state, 'm-roof')).toBe('Set the recovery date and next accountable step while preserving the project manager progress judgment.');
    const handEntered = {
      id: 'hand', projectName: 'Alpha', taskName: 'Punch list', locationName: 'Lot', owner: '', contractor: '', startDate: '11/01/2026',
      finishDate: '11/05/2026', milestone: '', status: 'In Progress', percentComplete: 40, priority: 'Medium', notes: '', createdAt: '2026-08-01T00:00:00.000Z',
    } as ScheduleItem;
    expect(scheduleHasAuthoritativeProgressJudgment(handEntered)).toBe(true);
  });
});
