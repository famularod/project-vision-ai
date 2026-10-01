/**
 * Owner answer Q22 follow-ups from whole-app audit A5 pass 5 and A12 (30 Sep
 * 2026). Synthetic data only.
 *
 * H1 A contractor's lookahead with no % Complete column (Task, Project, Area,
 *    Start, Finish, Owner) set the master task's file progress to 0%, and
 *    neither a new master repeating 60% nor Delete PDF + Items gave it back.
 *    Each parser now notes a row that states no percent, and such a row
 *    leaves progress alone, for full schedules too.
 * M1 A lookahead row with no area, or with no parent project where the
 *    master's rows have one, did not pair with the master's task, so the
 *    task showed twice.
 * M3 The suggested default picked Lookahead for real full schedules by their
 *    names ("Alpha 12 Week Schedule rev2", "Schedule Update 2026-09-30 Wk 40").
 * L1 The delete question counted tasks that do not go back (dates the manager
 *    changed, tasks the delete removes) and called a lookahead's own tasks
 *    "master tasks".
 * A12 M2 Dates saved by the web builder (2026-10-05) and dates from files and
 *    the phone (10/05/2026) counted as different, so a revised upload made a
 *    second copy of an unchanged task.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleItemsFromRemoteExtractorPayload } from '../../services/PIEScheduleRemoteExtraction';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleImportRoleRefusal,
  scheduleItemsAfterLookaheadDeleted,
  scheduleLookaheadDeleteNote,
  suggestScheduleImportRole,
} from '../../services/ScheduleLookahead';
import { sameScheduleCalendarDay, scheduleCalendarDayKey } from '../../services/ScheduleCalendarDay';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

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

const APPROVED = '2026-09-20T12:00:00.000Z';
const master = schedule('MASTER UPDATE 8312026', ['Alpha', 'Beta'], '2026-08-31T12:00:00.000Z');
/** The master's file says Pour slab is 60% and Roofing 30%: file progress, not the manager's. */
const masterItems = () => [
  task('m-pour', 'Alpha', 'Pour slab', master, '10/01/2026', '10/03/2026', { percentComplete: 60, status: 'In Progress' }),
  task('m-roof', 'Alpha', 'Roofing', master, '12/01/2026', '12/15/2026', { percentComplete: 30, status: 'In Progress' }),
  task('m-beta', 'Beta', 'Beta sitework', master, '10/01/2026', '10/30/2026'),
];
const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], APPROVED, { scheduleRole: 'lookahead' });

/** A file read as the phone reads a CSV, bound to its schedule document. */
function csvRows(contents: string, source: ReferenceDocument): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents, sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha', 'Beta'], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
/** A contractor's lookahead: no % Complete column. */
const CONTRACTOR_LOOKAHEAD = [
  'Task,Project,Area,Start,Finish,Owner',
  'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,Acme Concrete',
  'Rebar inspection,Alpha,Lot,09/25/2026,09/25/2026,City inspector',
].join('\n');

function approve(items: ScheduleItem[], documents: ReferenceDocument[], source: ReferenceDocument, rows: ScheduleItem[], approvedAt = source.importedAt) {
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
  return { items: [...merged.additions, ...merged.next], documents: withDocument, merged };
}
const shown = (items: ScheduleItem[], documents: ReferenceDocument[]) =>
  selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents });
const view = (items: ScheduleItem[], documents: ReferenceDocument[], filter = /./) => shown(items, documents)
  .map(item => `${item.id} ${item.taskName} ${item.startDate}-${item.finishDate} ${item.percentComplete}%`)
  .filter(line => filter.test(line)).sort();

/** Delete PDF + Items, as the phone does it: the question first, then the tasks only it contains go, and its overlay comes off. */
function deleteLookahead(items: ScheduleItem[], documents: ReferenceDocument[], document: ReferenceDocument) {
  const removed = scheduleItemsOnlyInImportBatch(items, document, documents);
  const removedIds = new Set(removed.map(item => item.id));
  const note = scheduleLookaheadDeleteNote(items, document, removed);
  const kept = items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterLookaheadDeleted(kept, document, '2026-09-25T00:00:00.000Z').map(item => [item.id, item]));
  return {
    note,
    items: kept.map(item => restored.get(item.id) || item),
    documents: documents.filter(candidate => candidate.id !== document.id),
  };
}

/** What a lookahead approved before this build left when its file had no % column: the task at 0%, the master's 60% noted. */
const damaged = () => {
  const items = masterItems().map(item => item.id === 'm-pour' ? {
    ...item, startDate: '09/28/2026', finishDate: '09/30/2026', percentComplete: 0, status: 'Not Started',
    alsoImportedInBatchIds: [lookahead.importBatchId as string],
    lookaheadOverlay: {
      masterStartDate: '10/01/2026', masterFinishDate: '10/03/2026', masterPercentComplete: 60,
      lookaheads: [{ batchId: lookahead.importBatchId as string, startDate: '09/28/2026', finishDate: '09/30/2026' }],
    },
  } as ScheduleItem : item);
  return { items, documents: [master, lookahead] };
};

describe('H1: a schedule file with no % Complete never zeroes progress (audit A5 pass 5)', () => {
  it('each reader notes a row that states no percent: CSV/Excel text, Microsoft Project rows, the schedule service', () => {
    const noColumn = csvRows(CONTRACTOR_LOOKAHEAD, lookahead);
    expect(noColumn.map(row => [row.taskName, row.percentComplete, row.status, row.percentCompleteStated]))
      .toEqual([['Pour slab', 0, 'Not Started', false], ['Rebar inspection', 0, 'Not Started', false]]);

    const withColumn = csvRows([
      'Task,Project,Area,Start,Finish,Status,% Complete',
      'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,,40%',
      'Rebar inspection,Alpha,Lot,09/25/2026,09/25/2026,,',
      'Form walls,Alpha,Lot,09/26/2026,09/27/2026,,0%',
      'Strip forms,Alpha,Lot,09/24/2026,09/24/2026,Complete,',
    ].join('\n'), lookahead);
    // A blank cell states nothing; a stated 0%, and a Complete status, are statements.
    expect(withColumn.map(row => [row.taskName, row.percentComplete, row.percentCompleteStated])).toEqual([
      ['Pour slab', 40, undefined], ['Rebar inspection', 0, false], ['Form walls', 0, undefined], ['Strip forms', 100, undefined],
    ]);

    const msp = normalizeMicrosoftProjectPdfRows({
      contents: [
        'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
        '1\tAlpha\t0\t60 days\t09/01/2026\t12/15/2026\t',
        '2\tPour slab\t1\t3 days\t10/01/2026\t10/03/2026\t',
        '3\tRoofing\t1\t10 days\t12/01/2026\t12/15/2026\t25%',
      ].join('\n'),
      sourceName: 'Alpha.pdf', projects: ['Alpha'], now: new Date(APPROVED),
    });
    expect(msp.map(row => [row.taskName, row.percentComplete, row.percentCompleteStated]))
      .toEqual([['Pour slab', 0, false], ['Roofing', 25, undefined]]);

    const remote = scheduleItemsFromRemoteExtractorPayload({
      items: [
        { taskName: 'Pour slab', projectName: 'Alpha', finishDate: '09/30/2026' },
        { taskName: 'Roofing', projectName: 'Alpha', finishDate: '12/15/2026', percentComplete: '25%' },
        { taskName: 'Strip forms', projectName: 'Alpha', finishDate: '09/24/2026', status: 'Complete' },
      ],
    }, { fileName: 'lookahead.pdf', projects: ['Alpha'], extractedAt: APPROVED });
    expect(remote.items.map(row => [row.taskName, row.percentComplete, row.percentCompleteStated]))
      .toEqual([['Pour slab', 0, false], ['Roofing', 25, undefined], ['Strip forms', 100, undefined]]);
  });

  it('the contractor\'s lookahead moves Pour slab to its dates and keeps the master\'s 60%', () => {
    const { items, documents, merged } = approve(masterItems(), [master], lookahead, csvRows(CONTRACTOR_LOOKAHEAD, lookahead));
    expect(merged.overlaidIds).toEqual(['m-pour']);
    expect(view(items, documents)).toEqual([
      'Alpha 3 Week Lookahead-2 Rebar inspection 09/25/2026-09/25/2026 0%',
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 09/28/2026-09/30/2026 60%',
      'm-roof Roofing 12/01/2026-12/15/2026 30%',
    ]);
    // The lookahead noted no percent of its own; the flag describes the file's row, not the task.
    expect(items.find(item => item.id === 'm-pour')?.lookaheadOverlay?.lookaheads).toEqual([
      { batchId: lookahead.importBatchId, startDate: '09/28/2026', finishDate: '09/30/2026', percentComplete: null },
    ]);
    expect(items.some(item => 'percentCompleteStated' in item)).toBe(false);
    // Deleting it gives the master's dates back, and the 60% stays.
    const after = deleteLookahead(items, documents, lookahead);
    expect(view(after.items, after.documents, /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 60%']);
  });

  it('a full schedule with no % column keeps file progress, on the same dates or new ones; a stated 0% is still the scheduler\'s', () => {
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const noPercent = csvRows([
      'Task,Project,Area,Start,Finish,Owner',
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,Acme Concrete',
      'Roofing,Alpha,Lot,12/08/2026,12/22/2026,Top Roofing',
      'Beta sitework,Beta,Lot,10/01/2026,10/30/2026,Dirt Co',
    ].join('\n'), master2);
    const { items, documents } = approve(masterItems(), [master], master2, noPercent);
    expect(view(items, documents)).toEqual([
      'MASTER UPDATE 9302026-2 Roofing 12/08/2026-12/22/2026 30%',
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 10/01/2026-10/03/2026 60%',
    ]);
    expect(items.some(item => 'percentCompleteStated' in item)).toBe(false);

    const stated = csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%',
    ].join('\n'), master2);
    const corrected = approve(masterItems(), [master], master2, stated);
    expect(corrected.items.find(item => item.id === 'm-pour')).toMatchObject({ percentComplete: 0, status: 'Not Started' });
  });

  it('a task a lookahead zeroed before this build: a new master repeating 60% brings the 60% back', () => {
    const { items, documents } = damaged();
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const repeated = csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%',
      'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
    ].join('\n'), master2);
    const after = approve(items, documents, master2, repeated);
    expect(view(after.items, after.documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
  });

  it('Delete PDF + Items puts back the percent the master said when the task still has the lookahead\'s; never the manager\'s own', () => {
    // Damage left before this build.
    const old = damaged();
    const repaired = deleteLookahead(old.items, old.documents, lookahead);
    expect(view(repaired.items, repaired.documents, /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 60%']);
    expect(repaired.items.find(item => item.id === 'm-pour')).toMatchObject({ status: 'In Progress' });
    expect(repaired.items.find(item => item.id === 'm-pour')).not.toHaveProperty('lookaheadOverlay');

    // A lookahead that stated 0% itself: its 0% goes with it.
    const zero = approve(masterItems(), [master], lookahead, csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,0%',
    ].join('\n'), lookahead));
    expect(view(zero.items, zero.documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 0%']);
    expect(view(deleteLookahead(zero.items, zero.documents, lookahead).items, [master], /Pour/))
      .toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 60%']);

    // Progress the manager recorded since is the manager's own: kept.
    const edited = old.items.map(item => item.id === 'm-pour' ? {
      ...item, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager',
      progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-22T00:00:00.000Z',
    } as ScheduleItem : item);
    expect(view(deleteLookahead(edited, old.documents, lookahead).items, [master], /Pour/))
      .toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 30%']);
  });
});

describe('M1: a lookahead row with no area, or no parent project, pairs with the one same-named task (audit A5 pass 5)', () => {
  const noArea = [
    'Task,Project,Start,Finish,Owner',
    'Pour slab,Alpha,09/28/2026,09/30/2026,Acme Concrete',
  ].join('\n');

  it('a lookahead with no Area column restates the master\'s task: shown once', () => {
    const rows = csvRows(noArea, lookahead);
    expect(rows[0].locationName).toBe('');
    const { items, documents, merged } = approve(masterItems(), [master], lookahead, rows);
    expect(merged.overlaidIds).toEqual(['m-pour']);
    expect(view(items, documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
    expect(items.find(item => item.id === 'm-pour')?.locationName).toBe('Lot');
  });

  it('two same-named tasks in different areas: unsure, so the row is not merged', () => {
    const twoAreas = [...masterItems(), task('m-pour-2', 'Alpha', 'Pour slab', master, '11/01/2026', '11/03/2026', { locationName: 'Level 2' })];
    const { merged } = approve(twoAreas, [master], lookahead, csvRows(noArea, lookahead));
    expect(merged.overlaidIds).toEqual([]);
    expect(merged.additions.map(item => item.taskName)).toEqual(['Pour slab']);
  });

  it('two area-less rows and two tasks in two areas: never paired in file order across areas', () => {
    const twoAreas = [...masterItems(), task('m-pour-2', 'Alpha', 'Pour slab', master, '11/01/2026', '11/03/2026', { locationName: 'Level 2' })];
    const rows = csvRows([
      'Task,Project,Start,Finish,Owner',
      'Pour slab,Alpha,09/28/2026,09/30/2026,Acme Concrete',
      'Pour slab,Alpha,10/28/2026,10/30/2026,Acme Concrete',
    ].join('\n'), lookahead);
    const { merged } = approve(twoAreas, [master], lookahead, rows);
    expect(merged.overlaidIds).toEqual([]);
    expect(merged.additions.map(item => item.id)).toEqual(['Alpha 3 Week Lookahead-1', 'Alpha 3 Week Lookahead-2']);
  });

  it('the master\'s rows name a parent project and the lookahead\'s do not', () => {
    const parented = masterItems().map(item => item.projectName === 'Alpha'
      ? { ...item, scheduleProjectName: 'Alpha', projectName: 'Alpha Tower' } : item);
    const rows = csvRows(CONTRACTOR_LOOKAHEAD, lookahead).map(row => ({ ...row, projectName: 'Alpha Tower', scheduleProjectName: null }));
    const { items, documents, merged } = approve(parented, [master], lookahead, rows);
    expect(merged.overlaidIds).toEqual(['m-pour']);
    expect(view(items, documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
  });

  it('a full schedule pairs as before: a row with no area is a task of its own', () => {
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha'], '2026-09-30T12:00:00.000Z');
    const { merged } = approve(masterItems(), [master], master2, csvRows(noArea, master2));
    expect(merged.additions.map(item => item.taskName)).toEqual(['Pour slab']);
    expect(merged.rehomedIds).toEqual([]);
  });
});

describe('M3: the suggested default reads a lookahead by its dates; its name only says why (audit A5 pass 5)', () => {
  const yearMaster = { documents: [master], scheduleItems: [
    ...masterItems(), task('m-closeout', 'Alpha', 'Closeout', master, '09/01/2027', '09/30/2027'),
  ] };
  const spanning = (name: string, from: string, to: string) => {
    const document = schedule(name, ['Alpha'], APPROVED);
    return { documents: [document], items: [task(`${name}-a`, 'Alpha', 'Pour slab', document, from, from), task(`${name}-b`, 'Alpha', 'Roofing', document, to, to)] };
  };

  it('full schedules whose names have a week number are suggested as Full schedule', () => {
    expect(suggestScheduleImportRole({ batch: spanning('Alpha 12 Week Schedule rev2', '10/01/2026', '12/23/2026'), ...yearMaster }))
      .toEqual({ role: 'master', reason: 'its dates cover 12 weeks and the master for Alpha covers about 12 months' });
    expect(suggestScheduleImportRole({ batch: spanning('Schedule Update 2026-09-30 Wk 40', '10/01/2026', '09/30/2027'), ...yearMaster }).role)
      .toBe('master');
    // "30 Wk" in a short file's name is the date's day, not a span: the dates decide, and say so.
    expect(suggestScheduleImportRole({ batch: spanning('Schedule Update 2026-09-30 Wk 40', '10/01/2026', '10/14/2026'), ...yearMaster }).reason)
      .toBe('its dates cover 2 weeks and the master for Alpha covers about 12 months');
  });

  it('a name that says lookahead still needs dates that read as one', () => {
    expect(suggestScheduleImportRole({ batch: spanning('Alpha 3 Week Lookahead', '10/01/2026', '05/31/2027'), ...yearMaster }).role).toBe('master');
    expect(suggestScheduleImportRole({ batch: spanning('Alpha 3 Week Lookahead', '10/01/2026', '10/06/2026'), ...yearMaster }))
      .toEqual({ role: 'lookahead', reason: 'its name says “3 Week”' });
    expect(suggestScheduleImportRole({ batch: spanning('Alpha_Look-Ahead', '10/01/2026', '10/20/2026'), ...yearMaster }))
      .toEqual({ role: 'lookahead', reason: 'its name says “Look-Ahead”' });
    expect(suggestScheduleImportRole({ batch: spanning('Alpha six wk plan', '10/01/2026', '10/20/2026'), ...yearMaster }).reason)
      .toBe('its name says “six wk”');
    expect(suggestScheduleImportRole({ batch: spanning('Alpha 8 week plan', '10/01/2026', '10/20/2026'), ...yearMaster }))
      .toEqual({ role: 'lookahead', reason: 'its dates cover 3 weeks and the master for Alpha covers about 12 months' });
    expect(suggestScheduleImportRole({ batch: spanning('Alpha 3 Week Lookahead', '10/01/2026', '10/06/2026'), documents: [], scheduleItems: [] }).role)
      .toBe('master');
  });
});

describe('L1: the delete question counts only the tasks that actually go back (audit A5 pass 5)', () => {
  it('not dates the manager changed since, not a task the delete removes; a lookahead\'s own task is not called a master task', () => {
    const { items, documents } = approve(masterItems(), [master], lookahead, csvRows([
      'Task,Project,Area,Start,Finish,Owner',
      'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,Acme',
      'Roofing,Alpha,Lot,11/20/2026,12/01/2026,Top',
    ].join('\n'), lookahead));
    expect(deleteLookahead(items, documents, lookahead).note)
      .toBe(' Delete PDF + Items also puts back the earlier dates of 2 tasks this lookahead changed.');
    // The manager moved Roofing since: it keeps the manager's dates, so it is not counted.
    const edited = items.map(item => item.id === 'm-roof' ? { ...item, finishDate: '12/05/2026' } : item);
    expect(deleteLookahead(edited, documents, lookahead).note)
      .toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
    // The master deleted with "Delete PDF Only": Pour slab is only in the lookahead now, so the delete removes it.
    const masterGone = deleteLookahead(edited, documents.filter(document => document.id !== master.id), lookahead);
    expect(masterGone.note).toBe('');

    // A lookahead's own task restated by a later lookahead goes back to the earlier lookahead's dates.
    const lookahead2 = schedule('Alpha lookahead week 40', ['Alpha'], '2026-09-27T12:00:00.000Z', { scheduleRole: 'lookahead' });
    const rebar = approve(masterItems(), [master], lookahead, csvRows(CONTRACTOR_LOOKAHEAD, lookahead));
    const both = approve(rebar.items, rebar.documents, lookahead2, csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Rebar inspection,Alpha,Lot,09/26/2026,09/26/2026,50%',
    ].join('\n'), lookahead2));
    const withoutSecond = deleteLookahead(both.items, both.documents, lookahead2);
    expect(withoutSecond.note).toBe(' Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    expect(view(withoutSecond.items, withoutSecond.documents, /Rebar/)).toEqual(['Alpha 3 Week Lookahead-2 Rebar inspection 09/25/2026-09/25/2026 0%']);
  });
});

describe('A12 M2: schedule dates compare by calendar day', () => {
  it('ISO, M/D/YYYY, with or without a time, are the same day; anything else compares as text', () => {
    expect(scheduleCalendarDayKey('2026-10-05')).toBe('2026-10-05');
    expect(['10/05/2026', '10/5/2026', '2026-10-05T00:00:00.000Z', '2026-10-05 08:00', '10/5/2026 8:00 AM', 'Oct 5, 2026', ' 10/05/26 ']
      .map(scheduleCalendarDayKey)).toEqual(Array(7).fill('2026-10-05'));
    expect(sameScheduleCalendarDay('2026-10-05', '10/06/2026')).toBe(false);
    expect(sameScheduleCalendarDay('TBD', ' tbd ')).toBe(true);
    expect(sameScheduleCalendarDay('13/45/2026', '2026-13-45')).toBe(false);
    expect(sameScheduleCalendarDay('', '')).toBe(true);
  });

  it('a revised file re-homes a task the web builder saved in ISO dates instead of copying it', () => {
    const webSaved = masterItems().map(item => item.id === 'm-pour' ? { ...item, startDate: '2026-10-01', finishDate: '2026-10-03' } : item);
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const { items, documents, merged } = approve(webSaved, [master], master2, csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%',
    ].join('\n'), master2));
    expect(merged.additions).toEqual([]);
    expect(merged.rehomedIds).toEqual(['m-pour']);
    expect(view(items, documents, /Pour/)).toEqual(['m-pour Pour slab 2026-10-01-2026-10-03 60%']);
  });

  it('a lookahead\'s dates saved in another form still go back on delete, and a master repeating its dates in another form is a repeat', () => {
    const { items, documents } = approve(masterItems(), [master], lookahead, csvRows(CONTRACTOR_LOOKAHEAD, lookahead));
    const isoSaved = items.map(item => item.id === 'm-pour' ? { ...item, startDate: '2026-09-28', finishDate: '2026-09-30' } : item);
    expect(view(deleteLookahead(isoSaved, documents, lookahead).items, [master], /Pour/)).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 60%']);

    // The master's task as the web builder saved it; the lookahead notes those dates; the new master states them as files do.
    const webSaved = masterItems().map(item => item.id === 'm-pour' ? { ...item, startDate: '2026-10-01', finishDate: '2026-10-03' } : item);
    const overlaid = approve(webSaved, [master], lookahead, csvRows(CONTRACTOR_LOOKAHEAD, lookahead));
    expect(overlaid.items.find(item => item.id === 'm-pour')?.lookaheadOverlay?.masterStartDate).toBe('2026-10-01');
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const repeated = approve(overlaid.items, overlaid.documents, master2, csvRows([
      'Task,Project,Area,Start,Finish,% Complete',
      'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,60%',
    ].join('\n'), master2));
    expect(view(repeated.items, repeated.documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
  });
});

describe('A8 pass 5 L3: a lookahead imported before Q22 as a full schedule becomes one by importing it again', () => {
  it('the review is preset to Lookahead and refuses Full schedule; approved, it restates the master\'s tasks in place', () => {
    // Imported before this build: a full schedule, which replaced the master; David has made the master current again.
    const earlier = schedule('Alpha 3 Week Lookahead', ['Alpha'], '2026-09-15T12:00:00.000Z', { isCurrent: false, scheduleRole: undefined });
    const earlierCopies = [
      task('old-pour', 'Alpha', 'Pour slab', earlier, '09/28/2026', '09/30/2026', { percentComplete: 60, status: 'In Progress' }),
      task('old-rebar', 'Alpha', 'Rebar inspection', earlier, '09/25/2026', '09/25/2026'),
    ];
    const saved = { items: [...masterItems(), ...earlierCopies], documents: [master, earlier] };
    // Imported again (a new import of its own, preset as a lookahead by scheduleImportOfFile).
    const again = schedule('Alpha 3 Week Lookahead', ['Alpha'], APPROVED, { id: 'again', importBatchId: 'batch-again', scheduleRole: 'lookahead' });
    const batch = { documents: [again], items: csvRows(CONTRACTOR_LOOKAHEAD, again) };
    expect(suggestScheduleImportRole({ batch, documents: saved.documents, scheduleItems: saved.items })).toEqual({
      role: 'lookahead', only: true,
      reason: 'this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead',
    });
    expect(scheduleImportRoleRefusal(batch, 'master')).toMatch(/^This exact schedule is already saved as a full schedule/);
    expect(scheduleImportRoleRefusal(batch, 'lookahead')).toBeNull();
    expect(scheduleImportRoleRefusal({ documents: [{ ...again, scheduleRole: undefined }] }, 'master')).toBeNull();

    const { items, documents, merged } = approve(saved.items, saved.documents, again, batch.items);
    // The master's task is restated in place; the earlier import's copy of it stays hidden with that import.
    expect(merged.overlaidIds).toContain('m-pour');
    expect(merged.overlaidIds).not.toContain('old-pour');
    expect(view(items, documents).map(line => line.replace(/^\S+ /, '')).sort()).toEqual([
      'Beta sitework 10/01/2026-10/30/2026 0%',
      'Pour slab 09/28/2026-09/30/2026 60%',
      'Rebar inspection 09/25/2026-09/25/2026 0%',
      'Roofing 12/01/2026-12/15/2026 30%',
    ]);
    expect(view(items, documents, /Pour/)).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 60%']);
  });
});
