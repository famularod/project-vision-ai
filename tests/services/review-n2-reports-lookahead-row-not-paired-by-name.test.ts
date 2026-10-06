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
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Review N2 of reports (5 Oct 2026, Medium; an older rule, shown by the
// reviewer's random run: p2-sched-text-random seed 486, the last of the ten
// sequences flagged "a task a new master drops is not reported as removed").
// A master dropped a task while a lookahead added a row of the same name. The
// import made the lookahead's row a new detail task (it did not take it for
// the dropped one), but the report paired the two by name, as it pairs rows
// saved before imports kept a task's earlier ids: "Punch list finish changed
// from 10/16/2026 to 11/08/2026.", which no task did, and the master's task
// was never said removed. A lookahead's detail row is no longer paired by
// name with a task that is not one; the report follows the rows the import
// made, as it does everywhere else.
// The CSV reader, the import's merge, the shown list and the report builders
// are the app's own; phone and web are both checked.

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
/** What David answers to "which same-named task is which": for each row of the file, by its start date, the saved task's start date, or 'new'. */
type Answers = Record<string, string>;
function approve(state: State, source: ReferenceDocument, lines: string[], answers?: Answers): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = rows(source, lines);
  const questions = scheduleImportPairingQuestions({ existing: shown(state), imported, overlay: lookahead });
  const pairingChoices: Record<string, string | null> = {};
  for (const question of questions) {
    if (!answers) { Object.assign(pairingChoices, question.guess); continue; }
    for (const row of question.rows) {
      const answer = answers[row.startDate];
      pairingChoices[row.id] = answer === 'new' ? null : question.saved.find(item => item.startDate === answer)!.id;
    }
  }
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead, ...(questions.length > 0 ? { pairingChoices } : {}),
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

const M1 = schedule('MASTER 1', '2026-10-01T12:00:00.000Z');
const M2 = schedule('MASTER 2', '2026-10-06T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD 1', '2026-10-07T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD 2', '2026-10-14T12:00:00.000Z', 'lookahead');
const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const ROOFING = 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,';
const PUNCH_ON_MASTER = 'Punch list,Alpha,Lot,10/12/2026,10/16/2026,';
const PUNCH_ON_LOOKAHEAD = 'Punch list,Alpha,Lot,11/02/2026,11/08/2026,';
const REMOVED = 'Punch list was removed from the current project plan.';
const ADDED = 'Punch list was added to the project plan.';
const punch = (state: State) => shown(state).filter(item => item.taskName === 'Punch list').map(item => [item.id, item.importedAsLookahead === true, `${item.startDate}-${item.finishDate}`]);

describe('review N2 (Medium): a master\'s dropped task is not paired by name with a row a lookahead added', () => {
  it('master 2 drops Punch list and a lookahead adds a Punch list: one removed, one added, and no finish change no task made', () => {
    let state = approve(EMPTY, M1, [FRAMING, ROOFING, PUNCH_ON_MASTER]);
    const first = sent(state, null, '2026-10-01T14:00:00.000Z');
    state = approve(state, M2, [FRAMING, ROOFING]);
    expect(punch(state)).toEqual([]);
    state = approve(state, L1, [PUNCH_ON_LOOKAHEAD]);
    // The import made the lookahead's row a new detail task: its own id, and nothing saying it is the dropped one.
    expect(punch(state)).toEqual([['LOOKAHEAD 1-1', true, '11/02/2026-11/08/2026']]);
    expect(shown(state).find(item => item.id === 'LOOKAHEAD 1-1')?.revisedFromTaskIds ?? []).toEqual([]);

    const phone = phoneReport(state, first, '2026-10-07T14:00:00.000Z');
    expect([...phone.lines].sort()).toEqual([ADDED, REMOVED].sort());
    expect(phone.lines.join(' ')).not.toMatch(/finish changed/);
    // One open task left the list and one came: the counts are as the lists are.
    expect([phone.completed, phone.open]).toEqual([0, 0]);
    const web = webReport(state, first, '2026-10-07T14:00:00.000Z');
    expect(web.lines).toEqual(phone.lines);
    expect(web.said).toEqual(phone.said);
  });

  it('the dropped task was complete: "-1 completed", and the lookahead\'s row is not said "reopened"', () => {
    let state = approve(EMPTY, M1, [FRAMING, ROOFING, PUNCH_ON_MASTER]);
    state = record(state, 'Punch list', 100, '2026-10-01T13:00:00.000Z');
    const first = sent(state, null, '2026-10-01T14:00:00.000Z');
    state = approve(state, M2, [FRAMING, ROOFING]);
    state = approve(state, L1, [PUNCH_ON_LOOKAHEAD]);
    const report = phoneReport(state, first, '2026-10-07T14:00:00.000Z');
    expect([...report.lines].sort()).toEqual([ADDED, REMOVED].sort());
    expect(report.lines.join(' ')).not.toMatch(/reopened/);
    expect([report.completed, report.open]).toEqual([-1, 1]);
  });

  it('the other way round: a lookahead\'s detail row that left with its lookahead is not taken for a task a master adds under that name', () => {
    let state = approve(EMPTY, M1, [FRAMING, ROOFING]);
    state = approve(state, L1, [PUNCH_ON_LOOKAHEAD]);
    const first = sent(state, null, '2026-10-07T14:00:00.000Z');
    expect(first.tasks.find(task => task.taskName === 'Punch list')).toMatchObject({ taskId: 'LOOKAHEAD 1-1', lookaheadDetail: true });
    // A newer lookahead replaces the first: its detail row leaves the list, unsaid (owner answer 3 Oct).
    state = approve(state, L2, ['Inspections,Alpha,Lot,10/20/2026,10/21/2026,']);
    expect(punch(state)).toEqual([]);
    // The report now also has a master's row called Punch list, with nothing tying it to the detail row.
    const current = phoneReport(state, first, '2026-10-14T14:00:00.000Z').snapshot;
    const mastersRow = { ...first.tasks.find(task => task.taskName === 'Framing')!, taskId: 'MASTER 9-9', taskName: 'Punch list', finishDate: '12/01/2026', contentKey: 'another' };
    const withMastersRow = { ...current, tasks: [...current.tasks, mastersRow] } as DAVEReportSnapshot;
    const truth = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents,
      now: '2026-10-14T14:00:00.000Z', knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
    });
    const period = compareDAVEReportSnapshots({ current: withMastersRow, previous: first, tasksLeftByLookahead: reportTasksLeftByLookahead([truth]) });
    const lines = period.changes.map(change => change.summary);
    // The master's row is added; the detail row left with its lookahead and is not mentioned (owner answer 3 Oct).
    expect(lines).toEqual(expect.arrayContaining([ADDED, 'Inspections was added to the project plan.']));
    expect(lines.join(' ')).not.toMatch(/Punch list finish changed|Punch list was removed/);
  });
});

describe('review N2 (Medium): what is still paired by name', () => {
  const taskOf = (taskId: string, taskName: string, finishDate: string, extra: Record<string, unknown> = {}) => ({
    taskId, projectName: 'Alpha', taskName, areaName: 'Lot', owner: null, status: 'Not Started', percentComplete: 0, finishDate,
    urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
  });
  const snapshotOf = (capturedAt: string, tasks: unknown[]) => ({
    version: 'dave-report-snapshot/1.0', scopeKey: 'alpha', capturedAt, sourceFingerprint: capturedAt, tasks, reportFormat: 'project_manager',
  }) as unknown as DAVEReportSnapshot;

  it('two rows a master saved before imports kept earlier ids: still the same task on new dates', () => {
    const period = compareDAVEReportSnapshots({
      previous: snapshotOf('2026-10-01T14:00:00.000Z', [taskOf('old-1', 'Punch list', '10/16/2026')]),
      current: snapshotOf('2026-10-07T14:00:00.000Z', [taskOf('new-1', 'Punch list', '11/08/2026')]),
    });
    expect(period.changes.map(change => change.summary)).toEqual(['Punch list finish changed from 10/16/2026 to 11/08/2026.']);
  });

  it('two detail rows of lookaheads, with no ids between them: still paired with each other', () => {
    const period = compareDAVEReportSnapshots({
      previous: snapshotOf('2026-10-01T14:00:00.000Z', [taskOf('old-1', 'Punch list', '10/16/2026', { lookaheadDetail: true })]),
      current: snapshotOf('2026-10-07T14:00:00.000Z', [taskOf('new-1', 'Punch list', '11/08/2026', { lookaheadDetail: true })]),
    });
    expect(period.changes.map(change => change.summary)).toEqual(['Punch list finish changed from 10/16/2026 to 11/08/2026.']);
  });

  it('an earlier report saved before detail rows were marked has none marked: a detail row now is not paired by name with its rows', () => {
    const period = compareDAVEReportSnapshots({
      previous: snapshotOf('2026-10-01T14:00:00.000Z', [taskOf('old-1', 'Punch list', '10/16/2026')]),
      current: snapshotOf('2026-10-07T14:00:00.000Z', [taskOf('new-1', 'Punch list', '11/08/2026', { lookaheadDetail: true })]),
    });
    expect(period.changes.map(change => change.summary).sort()).toEqual([ADDED, REMOVED].sort());
  });

  it('the saved report marks a lookahead\'s detail row, and no other', () => {
    let state = approve(EMPTY, M1, [FRAMING, ROOFING, PUNCH_ON_MASTER]);
    state = approve(state, L1, ['Rebar delivery,Alpha,Lot,10/09/2026,10/10/2026,', 'Framing,Alpha,Lot,09/16/2026,09/26/2026,']);
    const saved = sent(state, null, '2026-10-07T14:00:00.000Z');
    expect(saved.tasks.filter(task => task.lookaheadDetail === true).map(task => task.taskName)).toEqual(['Rebar delivery']);
    expect(saved.tasks.find(task => task.taskName === 'Framing')).not.toHaveProperty('lookaheadDetail');
  });
});
