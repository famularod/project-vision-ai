/*
 * Review pass 4, reports (6 Oct 2026), M1 (Medium; older, the same on Build 229; the reviewer's seed "plain 106").
 *
 * A task the newest master leaves out, or renames, stays in the list while the lookahead in effect lists it. The
 * lookahead holds the row it restated; a master approved since had moved the task to a newer row, and the list went
 * back to the older one: the percent, owner and schedule impact he entered after that master were gone, and the
 * report said they had changed.
 *
 * The steps are the reports reviewer's (notes/p4-reports/p4-l2-held-old-row.test.ts): the real CSV reader, the
 * phone's merge, the shown list, the project truth and the report.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
/** Approved on the phone; `madeCurrent` false for a master uploaded and not made current yet. */
function approve(state: State, source: ReferenceDocument, lines: string[], madeCurrent = true): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    // As the phone holds a task: with its default project controls (App.tsx normalizeScheduleItem).
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: lookahead, current: madeCurrent,
  });
  const documents = lookahead ? [...state.documents, source]
    : madeCurrent ? scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') : [...state.documents, { ...source, isCurrent: false } as ReferenceDocument];
  return { items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[], documents };
}
function setActive(state: State, id: string, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
function patch(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  return { ...state, items: state.items.map(item => (item.id === id ? {
    ...item, ...change,
    ...(typeof change.percentComplete === 'number' ? { status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David' } : {}),
    updatedAt: at,
  } as ScheduleItem : item)) };
}
function report(state: State, known: DAVEReportSnapshot | null, now: string) {
  const truth = buildDAVEProjectTruth({ projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  return { lines: briefing.reportingPeriod.changes.map(change => change.summary), sent: markReportSnapshotDelivered((reportSnapshotToSave(snapshot, known) ?? known) as DAVEReportSnapshot, now, 'phone') };
}
/** Each task of this name in the list: its row, days, percent, owner and schedule impact. */
const listed = (state: State, name = 'Sitework') => shown(state).filter(item => item.taskName === name)
  .map(item => [item.id, `${item.startDate}-${item.finishDate}`, item.percentComplete, item.owner || '', normalizeProjectControls(item.projectControls).estimatedScheduleImpactDays ?? null]);

// A real-size master, so the newest master is "heard" (b07f7c3): 12 other tasks that never change.
const OTHERS = Array.from({ length: 12 }, (_, index) => `Other task ${index + 1},Alpha,Lot,11/${String(index + 1).padStart(2, '0')}/2026,11/${String(index + 3).padStart(2, '0')}/2026,`);
const RENAMED = 'Site work phase 1,Alpha,Lot,09/23/2026,10/05/2026,';

/**
 * Master 1 lists Sitework and he records 5%. This week's lookahead lists Sitework. Master 2 re-dates it; on its new
 * row he records 35%, owner Dana and a schedule impact of 1 day (unless `untouched`). The report is sent.
 */
function underMasterTwo(untouched = false) {
  let state: State = { items: [], documents: [] };
  state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/27/2026,10/09/2026,']);
  state = patch(state, shown(state).find(item => item.taskName === 'Sitework')!.id, { percentComplete: 5 }, '2026-09-08T08:00:00.000Z');
  state = approve(state, schedule('LOOKAHEAD 1', '2026-09-08T12:00:00.000Z', 'lookahead'), ['Sitework,Alpha,Lot,10/01/2026,10/12/2026,']);
  state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/23/2026,10/05/2026,']);
  const moved = shown(state).find(item => item.taskName === 'Sitework')!;
  expect(moved.id).toBe('MASTER 2-13');
  if (!untouched) {
    state = patch(state, moved.id, { percentComplete: 35, owner: 'Dana' }, '2026-09-10T08:00:00.000Z');
    state = patch(state, moved.id, { projectControls: reviseProjectControls({ current: moved.projectControls, patch: { estimatedScheduleImpactDays: 1 }, actor: 'David', now: '2026-09-10T08:05:00.000Z' }) }, '2026-09-10T08:05:00.000Z');
  }
  return { state, first: report(state, null, '2026-09-10T15:00:00.000Z') };
}
const AS_HE_LEFT_IT = [['MASTER 2-13', '09/23/2026-10/05/2026', 35, 'Dana', 1]];
const MASTER_3 = schedule('MASTER 3', '2026-09-11T12:00:00.000Z');

describe('Review P4 M1: a task the newest master leaves out, which the lookahead in effect still lists, is shown as he last set it', () => {
  it.each([['renames it', [...OTHERS, RENAMED], ['Site work phase 1 was added to the project plan.']], ['leaves it out', OTHERS, []]] as const)('the next master %s: the list keeps the task on its latest row, and the report says nothing changed on it', (_how, lines, expected) => {
    const { state, first } = underMasterTwo();
    expect(listed(state)).toEqual(AS_HE_LEFT_IT);
    const after = approve(state, MASTER_3, [...lines]);
    // (It was: [['MASTER 1-13', '10/01/2026-10/12/2026', 5, '', null]], and the report said "Sitework moved from 35% to
    // 5% complete.", "Sitework finish changed from 10/05/2026 to 10/12/2026.", "Sitework owner changed from Dana to
    // unassigned." and "Sitework schedule impact changed from 1 day to not set.")
    expect(listed(after)).toEqual(AS_HE_LEFT_IT);
    expect(report(after, first.sent, '2026-09-12T15:00:00.000Z').lines).toEqual(expected);
  });

  it('what he enters on it next goes on that row, and a later master that lists the task again moves it from there with all of it', () => {
    const { state } = underMasterTwo();
    let after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    after = patch(after, shown(after).find(item => item.taskName === 'Sitework')!.id, { percentComplete: 50 }, '2026-09-12T08:00:00.000Z');
    expect(listed(after)).toEqual([['MASTER 2-13', '09/23/2026-10/05/2026', 50, 'Dana', 1]]);
    const again = approve(after, schedule('MASTER 4', '2026-09-13T12:00:00.000Z'), [...OTHERS, RENAMED, 'Sitework,Alpha,Lot,09/25/2026,10/07/2026,']);
    // (It was: the new row made from master 1's row, at 5% with no owner.)
    expect(listed(again)).toEqual([['MASTER 4-14', '09/25/2026-10/07/2026', 50, 'Dana', 1]]);
    expect(again.items.find(item => item.id === 'MASTER 4-14')!.revisedFromTaskIds).toEqual(expect.arrayContaining(['MASTER 1-13', 'MASTER 2-13']));
  });

  it('moved by two masters before the one that leaves it out: the last of those rows, not the first', () => {
    const { state } = underMasterTwo();
    let twice = approve(state, schedule('MASTER 2B', '2026-09-10T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/24/2026,10/06/2026,']);
    twice = patch(twice, 'MASTER 2B-13', { percentComplete: 60 }, '2026-09-10T16:00:00.000Z');
    const after = approve(twice, MASTER_3, [...OTHERS, RENAMED]);
    expect(listed(after)).toEqual([['MASTER 2B-13', '09/24/2026-10/06/2026', 60, 'Dana', 1]]);
  });

  it('two of its older rows are held (two lookaheads listed it under two masters, and the newest master is too small to be taken as heard): still listed once, on its latest row', () => {
    // Small masters: one that lists no more tasks than it leaves out is not taken to have dropped anything (b07f7c3),
    // so the older lookahead's row is held as well as the newer one's.
    const ONE = [OTHERS[0]];
    let state: State = { items: [], documents: [] };
    state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...ONE, 'Sitework,Alpha,Lot,10/12/2026,10/20/2026,']);
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-08T06:00:00.000Z', 'lookahead'), ['Sitework,Alpha,Lot,10/17/2026,10/24/2026,']);
    state = approve(state, schedule('MASTER 2', '2026-09-08T14:00:00.000Z'), [...ONE, 'Sitework,Alpha,Lot,10/12/2026,10/24/2026,']);
    state = approve(state, schedule('LOOKAHEAD 2', '2026-09-08T16:00:00.000Z', 'lookahead'), ['Sitework,Alpha,Lot,10/09/2026,10/20/2026,']);
    state = patch(state, 'MASTER 2-2', { owner: 'Dana' }, '2026-09-08T23:00:00.000Z');
    state = approve(state, schedule('MASTER 2B', '2026-09-09T07:00:00.000Z'), [...ONE, 'Sitework,Alpha,Lot,10/16/2026,10/28/2026,']);
    state = patch(state, 'MASTER 2B-2', { percentComplete: 35 }, '2026-09-09T11:00:00.000Z');
    expect(listed(state)).toEqual([['MASTER 2B-2', '10/16/2026-10/28/2026', 35, 'Dana', null]]);
    const after = approve(state, MASTER_3, ONE);
    // (Applied before the copies of one task are folded, the rule showed the latest row for one held row and left the
    // other held row beside it: two Siteworks. The reports reviewer's driver, seed "legacy 549".)
    expect(listed(after)).toEqual([['MASTER 2B-2', '10/16/2026-10/28/2026', 35, 'Dana', null]]);
  });

  it('a row he never touched is that row all the same: the task stays on the days master 2 gave it', () => {
    const { state, first } = underMasterTwo(true);
    const after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    expect(listed(after)).toEqual([['MASTER 2-13', '09/23/2026-10/05/2026', 5, '', null]]);
    expect(report(after, first.sent, '2026-09-12T15:00:00.000Z').lines).toEqual(['Site work phase 1 was added to the project plan.']);
  });

  it('never a row of a schedule newer than the current master: one uploaded and not made current yet does not show', () => {
    const { state } = underMasterTwo();
    const after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    const uploaded = approve(after, schedule('MASTER 4', '2026-09-13T12:00:00.000Z'), [...OTHERS, RENAMED, 'Sitework,Alpha,Lot,09/25/2026,10/07/2026,'], false);
    expect(uploaded.items.some(item => item.id === 'MASTER 4-14' && (item.revisedFromTaskIds || []).includes('MASTER 2-13'))).toBe(true);
    expect(listed(uploaded)).toEqual(AS_HE_LEFT_IT);
  });

  it('as before: with no lookahead in effect for it the task leaves the list with the master that drops it; and Set Active to master 1 shows master 1\'s row', () => {
    const { state } = underMasterTwo();
    const after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    // A newer lookahead that does not list Sitework replaces the one that did.
    const replaced = approve(after, schedule('LOOKAHEAD 2', '2026-09-12T12:00:00.000Z', 'lookahead'), ['Other task 1,Alpha,Lot,11/02/2026,11/04/2026,']);
    expect(listed(replaced)).toEqual([]);
    expect(listed(setActive(after, 'MASTER 1', '2026-09-12T12:00:00.000Z')).map(row => row[0])).toEqual(['MASTER 1-13']);
  });

  it('not when the current master lists a task of that name on a row of its own that answers to nothing (saved by a device that had not heard): one Sitework, the master\'s, as before', () => {
    const { state } = underMasterTwo();
    const after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    // (Master 3's own row for the renamed task, as a row of that master named Sitework.)
    const template = after.items.find(item => item.id === 'MASTER 3-13')!;
    expect(template.importBatchId).toBe('batch-MASTER 3');
    const unlinked = { ...template, id: 'MASTER 3-99', taskName: 'Sitework', startDate: '09/25/2026', finishDate: '10/07/2026' } as ScheduleItem;
    const withIt: State = { ...after, items: [...after.items, unlinked] };
    // (Shown on its latest row here, the task would be listed twice: the rule that folds a master's copy and a
    // lookahead's knows the held row, not that one.)
    expect(listed(withIt).map(row => row[0])).toEqual(['MASTER 3-99']);
  });

  it('nor when a row that answers to the held row is shown already (he renamed the task by hand, and the next master lists it under that name): the held row stays as it was', () => {
    const { state } = underMasterTwo();
    const renamedByHand = patch(state, 'MASTER 2-13', { taskName: 'Site prep' }, '2026-09-10T09:00:00.000Z');
    const after = approve(renamedByHand, MASTER_3, [...OTHERS, 'Site prep,Alpha,Lot,09/25/2026,10/07/2026,']);
    expect(after.items.find(item => item.id === 'MASTER 3-13')!.revisedFromTaskIds).toEqual(expect.arrayContaining(['MASTER 1-13', 'MASTER 2-13']));
    expect([listed(after, 'Site prep').map(row => row[0]), listed(after).map(row => row[0])]).toEqual([['MASTER 3-13'], ['MASTER 1-13']]);
  });

  it('not a task the lookahead added itself: it stays the lookahead\'s row on the lookahead\'s days, as before (the report\'s "left with its lookahead" rule goes by that row)', () => {
    let state: State = { items: [], documents: [] };
    state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), OTHERS);
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-08T12:00:00.000Z', 'lookahead'), ['Punch list,Alpha,Lot,10/01/2026,10/12/2026,']);
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Punch list,Alpha,Lot,09/23/2026,10/05/2026,']);
    expect(shown(state).filter(item => item.taskName === 'Punch list').map(item => item.id)).toEqual(['MASTER 2-13']);
    state = patch(state, 'MASTER 2-13', { percentComplete: 35, owner: 'Dana' }, '2026-09-10T08:00:00.000Z');
    const after = approve(state, MASTER_3, OTHERS);
    expect(listed(after, 'Punch list').map(row => row.slice(0, 2))).toEqual([['LOOKAHEAD 1-1', '10/01/2026-10/12/2026']]);
  });

  it('not a newer master\'s row that is behind the held row: after Set Active back to master 1 he works on master 1\'s row, and that is the task as he last set it', () => {
    let state: State = { items: [], documents: [] };
    state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/27/2026,10/09/2026,']);
    state = patch(state, 'MASTER 1-13', { percentComplete: 5 }, '2026-09-08T08:00:00.000Z');
    state = approve(state, schedule('MASTER 2', '2026-09-08T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/23/2026,10/05/2026,']);
    state = setActive(state, 'MASTER 1', '2026-09-08T18:00:00.000Z');
    expect(listed(state).map(row => row[0])).toEqual(['MASTER 1-13']);
    state = patch(state, 'MASTER 1-13', { percentComplete: 35, owner: 'Dana' }, '2026-09-09T08:00:00.000Z');
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-09T12:00:00.000Z', 'lookahead'), ['Sitework,Alpha,Lot,10/01/2026,10/12/2026,']);
    const after = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    // (Master 2's row answers to master 1's and is older than master 3, but nothing has been set on it since: found by
    // the reports reviewer's driver, seed "plain 248" with Set Active, on a first form of this fix.)
    expect(listed(after)).toEqual([['MASTER 1-13', '10/01/2026-10/12/2026', 35, 'Dana', null]]);
  });

  it('only a task a lookahead holds: a row shown because its master\'s file was deleted alone stays as it was', () => {
    let state: State = { items: [], documents: [] };
    state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/27/2026,10/09/2026,']);
    state = patch(state, 'MASTER 1-13', { percentComplete: 5 }, '2026-09-08T08:00:00.000Z');
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-08T12:00:00.000Z', 'lookahead'), ['Other task 1,Alpha,Lot,11/02/2026,11/04/2026,']);
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/23/2026,10/05/2026,']);
    state = patch(state, 'MASTER 2-13', { percentComplete: 35, owner: 'Dana' }, '2026-09-10T08:00:00.000Z');
    state = approve(state, MASTER_3, [...OTHERS, RENAMED]);
    expect(listed(state)).toEqual([]);
    const fileDeletedAlone: State = { ...state, documents: state.documents.filter(document => document.id !== 'MASTER 1') };
    expect(listed(fileDeletedAlone).map(row => row[0])).toEqual(['MASTER 1-13']);
  });

  it('as before: while master 2 is current the task is listed once, on master 2\'s row', () => {
    expect(listed(underMasterTwo().state)).toEqual(AS_HE_LEFT_IT);
  });
});
