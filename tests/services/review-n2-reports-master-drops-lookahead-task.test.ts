import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  reportTasksLeftByLookahead,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Review N2 of reports (5 Oct 2026, Medium, caused by a587e9f). A lookahead
// added Rebar delivery; the next master listed it on other days; a report
// went out; a newer lookahead replaced the first; he recorded Rebar delivery
// 100%; a report went out; a later master dropped it. The task left his task
// list, the next report said nothing about it, and the count line still
// counted it ("+0 completed" where the list had lost a completed task).
// The owner's rule is unchanged: a DETAIL task that only a lookahead listed,
// and that left with that lookahead when it was replaced, is not mentioned.
// A task a master has listed is a master's task from then on.
// The CSV reader, the import merge, the shown list and the report builders
// are the app's own; the phone's and the web's reports are both checked.
// The tests say what the report reads once the task has left the list; the
// last two give the report the list directly, whichever change emptied it.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
}
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return { items: [...merged.additions, ...merged.next], documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
function record(state: State, taskName: string, percentComplete: number, at: string): State {
  const id = shown(state).find(item => item.taskName === taskName)!.id;
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : percentComplete > 0 ? 'In Progress' : 'Not Started',
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}
type Report = { lines: string[]; completed: number; open: number; said: string[]; snapshot: DAVEReportSnapshot };
/** The report as the phone builds it from the tasks shown (`list`) and every saved task. */
function phoneReport(state: State, known: DAVEReportSnapshot | null, now: string, list: ScheduleItem[] = shown(state)): Report {
  const truth = buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: list, projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
  });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: list });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  const period = briefing.reportingPeriod;
  return { lines: period.changes.map(change => change.summary), completed: period.completeDelta, open: period.openDelta, said: reportPeriodMovementLines(briefing) ?? [], snapshot };
}
/** The same report as the web builds it. */
function webReport(state: State, known: DAVEReportSnapshot | null, now: string): Pick<Report, 'lines' | 'completed' | 'open' | 'said'> {
  const web = {
    projects: [{ id: 'report:alpha', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
    projectUpdates: [], referenceDocuments: state.documents, refreshedAt: now, tasksPulledAt: now,
  } as unknown as DAVEWebReadOnlySnapshot;
  const truths = [buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
  })];
  const briefing = buildDAVEWebReportDraft(web, null, { previousSnapshot: reportBaselineSnapshot(known, buildDAVEReportSourceFingerprint(truths)), waitingForOtherDevice: false });
  const period = briefing.reportingPeriod;
  return { lines: period.changes.map(change => change.summary), completed: period.completeDelta, open: period.openDelta, said: reportPeriodMovementLines(briefing) ?? [] };
}
const sent = (state: State, known: DAVEReportSnapshot | null, now: string) =>
  markReportSnapshotDelivered((reportSnapshotToSave(phoneReport(state, known, now).snapshot, known) ?? known) as DAVEReportSnapshot, now, 'phone');
const names = (state: State) => shown(state).map(item => item.taskName).sort();

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const H = schedule('MASTER H', '2026-09-21T12:00:00.000Z');
const MASTER_TASKS = ['Framing,Alpha,Lot,09/15/2026,09/25/2026,', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,'];
const REBAR_ON_LOOKAHEAD_DAYS = 'Rebar delivery,Alpha,Lot,09/09/2026,09/10/2026,';
const REBAR_ON_OTHER_DAYS = 'Rebar delivery,Alpha,Lot,09/16/2026,09/17/2026,';
const REMOVED = 'Rebar delivery was removed from the current project plan.';

/** The reviewer's steps up to the second report: master F, lookahead L1 adds Rebar delivery, master G lists it, lookahead L2 replaces L1. */
function untilTheSecondReport(masterGLine: string, percent: number) {
  let state = approve(EMPTY, F, MASTER_TASKS);
  state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
  state = approve(state, G, [...MASTER_TASKS, masterGLine]);
  const first = sent(state, null, '2026-09-14T14:00:00.000Z');
  state = approve(state, L2, ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,']);
  // The newer lookahead replaced the first; Rebar delivery is master G's task and stays.
  expect(names(state)).toEqual(['Framing', 'Inspections', 'Rebar delivery', 'Roofing']);
  expect(phoneReport(state, first, '2026-09-15T14:00:00.000Z').lines).toEqual(['Inspections was added to the project plan.']);
  state = record(state, 'Rebar delivery', percent, '2026-09-16T10:00:00.000Z');
  return { state, second: sent(state, first, '2026-09-16T14:00:00.000Z') };
}

describe('review N2 (Medium): a task a master has listed and a later master drops reads as removed, though a lookahead first added it', () => {
  it('the reviewer\'s steps (the master re-dated it): the report says it was removed, and the completed count drops by one', () => {
    const { state, second } = untilTheSecondReport(REBAR_ON_OTHER_DAYS, 100);
    const afterH = approve(state, H, MASTER_TASKS);
    // The task has left his list.
    expect(names(afterH)).toEqual(['Framing', 'Inspections', 'Roofing']);

    const phone = phoneReport(afterH, second, '2026-09-21T14:00:00.000Z');
    expect(phone.lines).toEqual([REMOVED]);
    expect(phone.completed).toBe(-1);
    expect(phone.open).toBe(0);
    expect(phone.said).toEqual(['-1 completed; +0 open; +0 overdue.', `Alpha: ${REMOVED}`]);
    const web = webReport(afterH, second, '2026-09-21T14:00:00.000Z');
    expect(web.lines).toEqual(phone.lines);
    expect([web.completed, web.open]).toEqual([-1, 0]);
    expect(web.said).toEqual(phone.said);
  });

  it('open when it was dropped: removed, and one fewer open', () => {
    const { state, second } = untilTheSecondReport(REBAR_ON_OTHER_DAYS, 40);
    const report = phoneReport(approve(state, H, MASTER_TASKS), second, '2026-09-21T14:00:00.000Z');
    expect(report.lines).toEqual([REMOVED]);
    expect([report.completed, report.open]).toEqual([0, -1]);
  });

  it('the lookahead\'s own old row was complete and the master\'s row was not: removed, never "was completed"', () => {
    let state = approve(EMPTY, F, MASTER_TASKS);
    state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
    // He completed it while only the lookahead listed it.
    state = record(state, 'Rebar delivery', 100, '2026-09-09T10:00:00.000Z');
    state = approve(state, G, [...MASTER_TASKS, REBAR_ON_OTHER_DAYS]);
    // Then set it back on the master's row.
    state = record(state, 'Rebar delivery', 50, '2026-09-14T13:00:00.000Z');
    const first = sent(state, null, '2026-09-14T14:00:00.000Z');
    state = approve(state, L2, ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,']);
    const second = sent(state, first, '2026-09-16T14:00:00.000Z');
    const afterH = approve(state, H, MASTER_TASKS);
    expect(names(afterH)).not.toContain('Rebar delivery');
    const report = phoneReport(afterH, second, '2026-09-21T14:00:00.000Z');
    expect(report.lines).toEqual([REMOVED]);
    expect(report.lines.join(' ')).not.toMatch(/was completed/);
    expect([report.completed, report.open]).toEqual([0, -1]);
  });

  it('listed by the master on the lookahead\'s own days (the same row): removed, as before', () => {
    const { state, second } = untilTheSecondReport(REBAR_ON_LOOKAHEAD_DAYS, 100);
    const afterH = approve(state, H, MASTER_TASKS);
    expect(names(afterH)).toEqual(['Framing', 'Inspections', 'Roofing']);
    const report = phoneReport(afterH, second, '2026-09-21T14:00:00.000Z');
    expect(report.lines).toEqual([REMOVED]);
    expect(report.completed).toBe(-1);
  });
});

describe('review N2 (Medium): the owner\'s rule stays as he gave it', () => {
  it('a detail task only a lookahead listed, gone with that lookahead when it was replaced, is not mentioned and still counts as it stood', () => {
    let state = approve(EMPTY, F, MASTER_TASKS);
    state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
    state = record(state, 'Rebar delivery', 100, '2026-09-09T10:00:00.000Z');
    const first = sent(state, null, '2026-09-10T14:00:00.000Z');
    state = approve(state, L2, ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,']);
    expect(names(state)).toEqual(['Framing', 'Inspections', 'Roofing']);
    const report = phoneReport(state, first, '2026-09-15T14:00:00.000Z');
    expect(report.lines).toEqual(['Inspections was added to the project plan.']);
    expect(report.lines.join(' ')).not.toMatch(/Rebar delivery/);
    expect([report.completed, report.open]).toEqual([0, 1]);
  });

  it('one he completed after the last report, before it left with its lookahead, is said "was completed" once', () => {
    let state = approve(EMPTY, F, MASTER_TASKS);
    state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
    const first = sent(state, null, '2026-09-08T14:00:00.000Z');
    state = record(state, 'Rebar delivery', 100, '2026-09-09T10:00:00.000Z');
    state = approve(state, L2, ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,']);
    const report = phoneReport(state, first, '2026-09-15T14:00:00.000Z');
    expect(report.lines).toEqual(expect.arrayContaining(['Rebar delivery was completed.']));
    expect(report.lines.join(' ')).not.toMatch(/Rebar delivery was removed/);
    expect(report.completed).toBe(1);
    // That report goes out; the next one, after other work moved on, does not say it again.
    const second = sent(state, first, '2026-09-15T14:00:00.000Z');
    const later = record(state, 'Framing', 10, '2026-09-16T10:00:00.000Z');
    const next = phoneReport(later, second, '2026-09-16T14:00:00.000Z');
    expect(next.lines.join(' ')).toMatch(/Framing moved from 0% to 10% complete\./);
    expect(next.lines.join(' ')).not.toMatch(/Rebar delivery/);
    expect(next.completed).toBe(0);
  });
});

describe('review N2 (Medium): what the report says of a master\'s task that has left the list, whichever change took it off', () => {
  it('still saved under master G, and no longer shown while G is the current master: removed, and the count follows', () => {
    const { state, second } = untilTheSecondReport(REBAR_ON_OTHER_DAYS, 100);
    // The list without the task, given to the report as it is; nothing here says how it came to leave.
    const list = shown(state).filter(item => item.taskName !== 'Rebar delivery');
    const report = phoneReport(state, second, '2026-09-21T14:00:00.000Z', list);
    expect(report.lines).toEqual([REMOVED]);
    expect([report.completed, report.open]).toEqual([-1, 0]);
  });

  it('the lookahead\'s old row is still a detail row that left; the master\'s row that answers to it is not taken for it', () => {
    const { state, second } = untilTheSecondReport(REBAR_ON_OTHER_DAYS, 100);
    const afterH = approve(state, H, MASTER_TASKS);
    const rebarRows = afterH.items.filter(item => item.taskName === 'Rebar delivery');
    // Two saved rows: the lookahead's, and master G's, which answers to it.
    expect(rebarRows.map(item => [item.id, item.importedAsLookahead === true, item.revisedFromTaskIds ?? []])).toEqual(expect.arrayContaining([
      ['LOOKAHEAD L1-1', true, []],
      ['MASTER G-3', false, ['LOOKAHEAD L1-1']],
    ]));
    const truth = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(afterH), projectAreas: [], referenceDocuments: afterH.documents,
      now: '2026-09-21T14:00:00.000Z', knownScheduleItems: afterH.items, knownScheduleDocuments: afterH.documents, reportLookaheadReplacement: true,
    });
    const tasksLeftByLookahead = reportTasksLeftByLookahead([truth]);
    expect(tasksLeftByLookahead.map(task => task.taskId)).toEqual(['LOOKAHEAD L1-1']);
    // The earlier report had the master's row.
    expect(second.tasks.find(task => task.taskName === 'Rebar delivery')).toMatchObject({ taskId: 'MASTER G-3', earlierTaskIds: ['LOOKAHEAD L1-1'], percentComplete: 100 });
    const current = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: 'now', capturedAt: '2026-09-21T14:00:00.000Z', reportFormat: 'project_manager' });
    const period = compareDAVEReportSnapshots({ current, previous: second, tasksLeftByLookahead });
    expect(period.changes.map(change => [change.kind, change.summary])).toEqual([['removed', REMOVED]]);
    expect(period.completeDelta).toBe(-1);
  });

  it('the last report went out before the first lookahead was replaced, and the lookahead\'s old row was complete: removed, never "was completed"', () => {
    let state = approve(EMPTY, F, MASTER_TASKS);
    state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
    state = record(state, 'Rebar delivery', 100, '2026-09-09T10:00:00.000Z');
    state = approve(state, G, [...MASTER_TASKS, REBAR_ON_OTHER_DAYS]);
    state = record(state, 'Rebar delivery', 50, '2026-09-14T13:00:00.000Z');
    const first = sent(state, null, '2026-09-14T14:00:00.000Z');
    // Since that report: the newer lookahead replaced the first, and master H dropped the task.
    state = approve(state, L2, ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,']);
    const afterH = approve(state, H, MASTER_TASKS);
    expect(names(afterH)).toEqual(['Framing', 'Inspections', 'Roofing']);
    const report = phoneReport(afterH, first, '2026-09-21T14:00:00.000Z');
    expect([...report.lines].sort()).toEqual(['Inspections was added to the project plan.', REMOVED]);
    expect(report.lines.join(' ')).not.toMatch(/was completed/);
    expect([report.completed, report.open]).toEqual([0, 0]);
  });
});

describe('review N2 (Medium): a lookahead\'s row that is on the list as the lookahead\'s again still leaves with its lookahead, unsaid', () => {
  it('a master listed the task and the next master dropped it while its lookahead still listed it; then that lookahead is replaced', () => {
    let state = approve(EMPTY, F, MASTER_TASKS);
    state = approve(state, L1, [REBAR_ON_LOOKAHEAD_DAYS]);
    state = approve(state, G, [...MASTER_TASKS, REBAR_ON_OTHER_DAYS]);
    // Master H drops it; the lookahead in effect still lists it, so it is on his list, on the lookahead's days.
    state = approve(state, H, MASTER_TASKS);
    expect(shown(state).filter(item => item.taskName === 'Rebar delivery').map(item => [item.id, item.startDate])).toEqual([['LOOKAHEAD L1-1', '09/09/2026']]);
    const first = sent(state, null, '2026-09-21T14:00:00.000Z');
    expect(first.tasks.find(task => task.taskName === 'Rebar delivery')?.taskId).toBe('LOOKAHEAD L1-1');
    // The newer lookahead replaces it: the detail row leaves with its lookahead.
    const L3 = schedule('LOOKAHEAD L3', '2026-09-22T12:00:00.000Z', 'lookahead');
    state = approve(state, L3, ['Inspections,Alpha,Lot,09/24/2026,09/25/2026,']);
    expect(names(state)).toEqual(['Framing', 'Inspections', 'Roofing']);
    const report = phoneReport(state, first, '2026-09-22T14:00:00.000Z');
    expect(report.lines).toEqual(['Inspections was added to the project plan.']);
    expect([report.completed, report.open]).toEqual([0, 1]);
    const web = webReport(state, first, '2026-09-22T14:00:00.000Z');
    expect(web.lines).toEqual(report.lines);
  });
});
