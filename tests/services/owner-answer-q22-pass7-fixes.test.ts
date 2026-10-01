/**
 * Owner answer Q22 follow-ups from whole-app audit A5 pass 7 and A10 pass 5
 * (30 Sep 2026). A lookahead adds to the master; progress from a file never
 * goes below what David entered. Synthetic data only.
 *
 * A5 p7 M1 An old percent David already corrected came back as his: master
 *    20%, David 40% by mistake, a lookahead 60% (its note: "40%, David"),
 *    David corrects to 20% by hand; masters at 30% then 35% left the task at
 *    40%, David's, confirmed on the 35% master's approval date. The same
 *    with a second lookahead at 35% after the 30% master.
 * A5 p7 L1 The fraction rule decided cell by cell: "0.5, 75" read 50% and
 *    75%; "0.4, 1, 40%" read the 1 as 1%; "0, 1" read a done task as 1%.
 * A5 p7 L2 = A10 p5 L2 A task entered by hand whose percent a file set read
 *    as David's judgment (no progress source, no import record); evidence
 *    correlation and Project Truth judged the same task differently.
 * A5 p7 L3 David's own status ("Waiting") was not given back with his
 *    percent: "Waiting 40%" came back as "In Progress 40%".
 * A10 p5 L1 David's percent given back (lookahead deleted, or a file below
 *    his noted percent) was stamped with the delete or approval time, so a
 *    field report after his judgment but before the give-back ("Pour slab is
 *    complete") no longer raised "Possible progress is not reflected", and
 *    Project Truth dated his 40% at the delete.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { extractScheduleEvidence } from '../../services/PIEEvidenceFusion';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import {
  buildPIEScheduleReconciliation,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import {
  scheduleImportAddsToMaster,
  scheduleItemsAfterLookaheadDeleted,
  scheduleLookaheadDeleteNote,
} from '../../services/ScheduleLookahead';
import { scheduleProgressJudgedAt } from '../../services/ScheduleProgressSource';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

// Helpers as in owner-answer-q22-pass6-fixes.test.ts.
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
const CORRECTED_AT = '2026-09-22T08:00:00.000Z';
const DELETED_AT = '2026-09-25T00:00:00.000Z';
const master = schedule('MASTER UPDATE 8312026', ['Alpha', 'Beta'], '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
const master3 = schedule('MASTER UPDATE 10052026', ['Alpha', 'Beta'], '2026-10-05T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], APPROVED, { scheduleRole: 'lookahead' });
const lookahead2 = schedule('Alpha lookahead week 40', ['Alpha'], '2026-09-27T12:00:00.000Z', { scheduleRole: 'lookahead' });
const lookahead3 = schedule('Alpha lookahead week 41', ['Alpha'], '2026-10-04T12:00:00.000Z', { scheduleRole: 'lookahead' });

const masterItems = (pour: number) => [
  task('m-pour', 'Alpha', 'Pour slab', master, '10/01/2026', '10/03/2026', { percentComplete: pour, status: statusOf(pour) }),
  task('m-roof', 'Alpha', 'Roofing', master, '12/01/2026', '12/15/2026', { percentComplete: 30, status: 'In Progress' }),
];
/** David records a percent (and, if he chooses, a status) by hand on the phone. */
const byDavid = (items: ScheduleItem[], id: string, percent: number, at = DAVID_AT, status: string = statusOf(percent)) =>
  items.map(item => item.id === id ? {
    ...item, percentComplete: percent, status,
    progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item);

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
const pour = (state: State) => {
  const matches = shown(state).filter(item => item.taskName === 'Pour slab');
  expect(matches).toHaveLength(1);
  return matches[0];
};
const edit = (state: State, id: string, percent: number, at: string, status?: string): State =>
  ({ ...state, items: byDavid(state.items, id, percent, at, status) });

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

function truthOf(state: State, id: string) {
  const truth = buildDAVEProjectTruth({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state),
    referenceDocuments: state.documents, now: '2026-10-06T12:00:00.000Z',
  });
  const record = truth.evidence.records.find(value => value.id === `schedule:${id}`)!;
  const correlation = truth.correlations.tasks.find(value => value.taskId === id)!;
  return { record: record.summary.replace(/, due [0-9/]+/, ''), capturedAt: record.capturedAt, explanation: correlation.explanation };
}

/** Master 20%; David records 40% by hand; the lookahead raises it to 60%. */
const davidThenLookahead = (masterPercent = 20, lookaheadPercent = 60, davidStatus?: string) => approve(
  { items: byDavid(masterItems(masterPercent), 'm-pour', 40, DAVID_AT, davidStatus), documents: [master] },
  lookahead, pourRow(lookahead, lookaheadPercent),
);
/** ...and David then corrects his mistaken 40% to 20% by hand. */
const corrected = () => edit(davidThenLookahead(), 'm-pour', 20, CORRECTED_AT);

describe('A5 p7 M1: a percent David corrected never comes back as his', () => {
  it('masters at 30% then 35% after his correction to 20%: the task reads 35%, the schedule\'s', () => {
    const at30 = approve(corrected(), master2, masterRows(master2, 30));
    expect(pour(at30)).toMatchObject({ id: 'm-pour', percentComplete: 30, progressConfirmedBy: 'Schedule update' });
    // The note took David's corrected 20% before the master applied; the master's 30% is above it.
    expect(pour(at30).lookaheadOverlay).toMatchObject({
      masterPercentComplete: 30, masterProgressConfirmedBy: 'Schedule update', masterFilePercentComplete: 30,
    });
    expect(pour(at30).lookaheadOverlay?.lookaheads.map(entry => entry.percentComplete)).toEqual([null]);

    const at35 = approve(at30, master3, masterRows(master3, 35));
    expect(pour(at35)).toMatchObject({
      id: 'm-pour', percentComplete: 35, status: 'In Progress', progressConfirmedBy: 'Schedule update', progressConfirmedAt: master3.importedAt,
    });
    expect(truthOf(at35, 'm-pour').record).toBe('Pour slab: In Progress, 35% complete.');
  });

  it('a second lookahead at 35% after the 30% master: 35%, the schedule\'s', () => {
    const at30 = approve(corrected(), master2, masterRows(master2, 30));
    const second = approve(at30, lookahead3, pourRow(lookahead3, 35, '09/29/2026', '10/01/2026'));
    expect(pour(second)).toMatchObject({ id: 'm-pour', percentComplete: 35, progressConfirmedBy: 'Schedule update' });
    expect(truthOf(second, 'm-pour').record).toBe('Pour slab: In Progress, 35% complete.');
  });

  it('his corrected 20% stands over a master at or below it, and keeps his own time', () => {
    const at15 = approve(corrected(), master2, masterRows(master2, 15));
    expect(pour(at15)).toMatchObject({ percentComplete: 20, progressConfirmedBy: 'David', progressConfirmedAt: CORRECTED_AT });
    expect(pour(at15).lookaheadOverlay).toMatchObject({
      masterPercentComplete: 20, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: CORRECTED_AT,
    });
    // A later lookahead at 18% stays above nothing: his 20% (not the mistaken 40%) is the floor.
    const later = approve(at15, lookahead3, pourRow(lookahead3, 18));
    expect(pour(later)).toMatchObject({ percentComplete: 20, progressConfirmedBy: 'David' });
  });

  it('a master at the same percent David holds changes nothing; his percent and time stay', () => {
    const again = approve(corrected(), master2, masterRows(master2, 20));
    expect(pour(again)).toMatchObject({ percentComplete: 20, progressConfirmedBy: 'David', progressConfirmedAt: CORRECTED_AT });
  });
});

describe('A10 p5 L1: David\'s percent given back keeps the time he judged it', () => {
  const fieldReport = (date: string): ProjectUpdate => ({
    id: `field-${date}`, projectName: 'Alpha', date, notes: 'Pour slab is complete.', scheduleItemId: 'm-pour',
    photos: [], recipients: { contactIds: [] },
  } as unknown as ProjectUpdate);
  const notReflected = (state: State, update: ProjectUpdate) => buildPIEScheduleReconciliation({
    scheduleItems: shown(state), updates: [update], projectName: 'Alpha', now: new Date('2026-09-26T12:00:00.000Z'),
  }).warnings.filter(warning => warning.type === 'field_progress_not_reflected' && warning.scheduleItemId === 'm-pour');

  it('Delete PDF + Items: a field report of 22 Sep after his 10 Sep 40% still raises the warning; the record is dated 10 Sep', () => {
    const after = deleteLookahead(davidThenLookahead(), lookahead);
    // Confirmed at the delete so every device takes it back (sync); judged when David judged it.
    expect(pour(after)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David', progressConfirmedAt: DELETED_AT });
    expect(scheduleProgressJudgedAt(pour(after))).toBe(DAVID_AT);
    expect(notReflected(after, fieldReport('2026-09-22T09:00:00.000Z'))).toHaveLength(1);
    // A report older than his judgment is still overridden by it.
    expect(notReflected(after, fieldReport('2026-09-05T09:00:00.000Z'))).toHaveLength(0);
    expect(truthOf(after, 'm-pour').capturedAt).toBe(DAVID_AT);
    const fused = extractScheduleEvidence({ projectName: 'Alpha', scheduleItems: shown(after) }).find(item => item.id === 'm-pour')!;
    expect(fused.sources[0]).toMatchObject({ type: 'typed-update', capturedAt: DAVID_AT });
  });

  it('the floor: a second lookahead at 30% gives back his 40%, dated when he judged it', () => {
    const floored = approve(davidThenLookahead(), lookahead2, pourRow(lookahead2, 30, '09/29/2026', '10/01/2026'));
    expect(pour(floored)).toMatchObject({ percentComplete: 40, progressConfirmedAt: lookahead2.importedAt });
    expect(scheduleProgressJudgedAt(pour(floored))).toBe(DAVID_AT);
    expect(notReflected(floored, fieldReport('2026-09-22T09:00:00.000Z'))).toHaveLength(1);
  });

  it('A5 p7 M1: the note takes David\'s own time, not the time his percent was given back, when it is refreshed', () => {
    // The floor gives back David's 40% at the second lookahead; a master then restates the task.
    const floored = approve(davidThenLookahead(), lookahead2, pourRow(lookahead2, 30, '09/29/2026', '10/01/2026'));
    expect(pour(floored)).toMatchObject({ percentComplete: 40, progressConfirmedBy: 'David' });
    const restated = approve(floored, master2, masterRows(master2, 20));
    expect(pour(restated).lookaheadOverlay).toMatchObject({
      masterPercentComplete: 40, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: DAVID_AT,
    });
  });

  it('sync: a device still holding the lookahead\'s 60% takes back David\'s 40% with the time he judged it', () => {
    const before = davidThenLookahead();
    const after = deleteLookahead(before, lookahead);
    // That device then edits the task's notes, so its row is the newer one; the progress is the delete's.
    const noted = { ...pour(before), notes: 'Pump truck booked.', updatedAt: '2026-09-26T08:00:00.000Z' };
    const [merged] = recoverDAVEScheduleRecords({ local: [noted], cloud: [pour(after)], allowCloudOnly: true });
    expect(merged).toMatchObject({ notes: 'Pump truck booked.', percentComplete: 40, progressConfirmedBy: 'David', progressConfirmedAt: DELETED_AT });
    expect(scheduleProgressJudgedAt(merged)).toBe(DAVID_AT);
  });

  it('a later edit by David is his newer judgment: the earlier judged time no longer applies', () => {
    const after = deleteLookahead(davidThenLookahead(), lookahead);
    const later = edit(after, 'm-pour', 45, '2026-09-26T08:00:00.000Z');
    expect(scheduleProgressJudgedAt(pour(later))).toBe('2026-09-26T08:00:00.000Z');
  });
});

describe('A5 p7 L3: David\'s own status comes back with his percent', () => {
  it('"Waiting 40%" is noted with the lookahead and given back by the floor and by the delete', () => {
    const state = davidThenLookahead(20, 60, 'Waiting');
    expect(pour(state).lookaheadOverlay).toMatchObject({ masterPercentComplete: 40, masterStatus: 'Waiting' });
    const floored = approve(state, lookahead2, pourRow(lookahead2, 30, '09/29/2026', '10/01/2026'));
    expect(pour(floored)).toMatchObject({ percentComplete: 40, status: 'Waiting', progressConfirmedBy: 'David' });
    const after = deleteLookahead(state, lookahead);
    expect(pour(after)).toMatchObject({ percentComplete: 40, status: 'Waiting', progressConfirmedBy: 'David' });
  });

  it('a status David sets under the lookahead is the one the note keeps', () => {
    const waiting = edit(davidThenLookahead(), 'm-pour', 45, CORRECTED_AT, 'Waiting');
    const floored = approve(waiting, lookahead2, pourRow(lookahead2, 30, '09/29/2026', '10/01/2026'));
    expect(pour(floored)).toMatchObject({ percentComplete: 45, status: 'Waiting', progressConfirmedBy: 'David' });
    const above = approve(waiting, lookahead2, pourRow(lookahead2, 50, '09/29/2026', '10/01/2026'));
    expect(pour(above)).toMatchObject({ percentComplete: 50, status: 'In Progress' });
    expect(pour(above).lookaheadOverlay).toMatchObject({ masterPercentComplete: 45, masterStatus: 'Waiting' });
    expect(pour(deleteLookahead(above, lookahead2))).toMatchObject({ percentComplete: 45, status: 'Waiting', progressConfirmedBy: 'David' });
  });
});
