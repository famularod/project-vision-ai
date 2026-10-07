import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// R1 item 4 (8 Oct 2026, the owner's open items; the reviewer's seed plain
// 255). A lookahead's own row and a master's row of one name are not paired
// (the decided rule): the report says one was removed and one added. When he
// had set the owner on the row now shown, no report ever said so: an added
// task gets no owner line, and the next report already counts from the new
// owner. The owner he set is now said beside "added" and "removed", where
// exactly one task of that name was added and exactly one removed, one of
// them a lookahead's own row and the other a master's.
// The CSV reader, the import's merge, the shown list and both report builders
// are the app's own. Synthetic data.

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
function record(state: State, startDate: string, percentComplete: number, at: string): State {
  const id = shown(state).find(item => item.taskName === 'Pour slab' && item.startDate === startDate)!.id;
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

const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const ELECTRICAL = (start: string, finish: string) => `Electrical rough,Alpha,Lot,${start},${finish},`;
const OWNER_SAID = 'Electrical rough owner changed from unassigned to Sam.';
const electricalLines = (report: Pick<Report, 'lines'>) => report.lines.filter(line => line.startsWith('Electrical rough')).sort();
/** He sets the owner of the one Electrical rough in the list. */
function setOwner(state: State, owner: string, at: string): State {
  const [task] = shown(state).filter(item => item.taskName === 'Electrical rough');
  return { ...state, items: state.items.map(item => item.id === task.id ? { ...item, owner, updatedAt: at } as ScheduleItem : item) };
}

describe('R1 item 4: the owner he set is said when the task reads removed and added', () => {
  it('the master drops the task, a lookahead lists it as its own row, he sets its owner: added, removed, and the owner', () => {
    let state = approve(EMPTY, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [FRAMING, ELECTRICAL('10/01/2026', '10/05/2026')]);
    const first = sent(state, null, '2026-09-08T15:00:00.000Z');
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [FRAMING]);
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), [ELECTRICAL('10/02/2026', '10/06/2026')]);
    state = setOwner(state, 'Sam', '2026-09-10T14:00:00.000Z');
    for (const report of [phoneReport(state, first, '2026-09-11T15:00:00.000Z'), webReport(state, first, '2026-09-11T15:00:00.000Z')]) {
      expect(electricalLines(report)).toEqual([
        OWNER_SAID,
        'Electrical rough was added to the project plan.',
        'Electrical rough was removed from the current project plan.',
      ]);
    }
    // Said once: after that report goes out and Framing moves on, the next report says nothing of Electrical rough.
    const second = sent(state, first, '2026-09-11T15:00:00.000Z');
    const later: State = { ...state, items: state.items.map(item => item.taskName === 'Framing'
      ? { ...item, percentComplete: 10, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-12T08:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-12T08:00:00.000Z' } as ScheduleItem
      : item) };
    const next = phoneReport(later, second, '2026-09-12T15:00:00.000Z');
    expect(next.lines).toContain('Framing moved from 0% to 10% complete.');
    expect(electricalLines(next)).toEqual([]);
  });
});

describe('R1 item 4: on two reports as they are kept, nothing else is paired', () => {
  type Extra = Record<string, unknown>;
  const row = (id: string, taskName: string, owner: string | null, extra: Extra = {}) => ({
    taskId: id, taskName, areaName: 'Lot', owner, status: 'Not Started', percentComplete: 0, finishDate: '10/09/2026',
    urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
  });
  const kept = (schedule: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
    truths: [{ projectName: 'Tower', schedule } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
  });
  const lines = (previous: unknown[], current: unknown[]) =>
    compareDAVEReportSnapshots({ previous: kept(previous, '2026-09-08T15:00:00.000Z'), current: kept(current, '2026-09-12T15:00:00.000Z') })
      .changes.map(change => change.summary).sort();
  const ADDED = 'Electrical rough was added to the project plan.';
  const REMOVED = 'Electrical rough was removed from the current project plan.';
  const detail = { lookaheadDetail: true };

  it('a master\'s row before, a lookahead\'s own row with an owner now: the owner is said', () => {
    expect(lines([row('master', 'Electrical rough', null)], [row('own', 'Electrical rough', 'Sam', detail)])).toEqual([OWNER_SAID, ADDED, REMOVED]);
  });

  it('the other way round (a lookahead\'s own row before, a master\'s row he called new now): the owner is said', () => {
    expect(lines([row('own', 'Electrical rough', 'Dana', detail)], [row('master', 'Electrical rough', 'Sam', { notTaskIds: ['own'] })]))
      .toEqual(['Electrical rough owner changed from Dana to Sam.', ADDED, REMOVED]);
  });

  it('no owner on the row now shown: nothing more is said (what the list lost is not his change)', () => {
    expect(lines([row('master', 'Electrical rough', 'Sam')], [row('own', 'Electrical rough', null, detail)])).toEqual([ADDED, REMOVED]);
  });

  it('the same owner on both: nothing more is said', () => {
    expect(lines([row('master', 'Electrical rough', 'Sam')], [row('own', 'Electrical rough', 'Sam', detail)])).toEqual([ADDED, REMOVED]);
  });

  it('two masters\' rows he said are different tasks (neither a lookahead\'s own): not paired for the owner either', () => {
    expect(lines([row('first', 'Electrical rough', null)], [row('second', 'Electrical rough', 'Sam', { notTaskIds: ['first'] })])).toEqual([ADDED, REMOVED]);
  });

  it('two of that name added: no telling which is the earlier task, so nothing more is said', () => {
    expect(lines(
      [row('master', 'Electrical rough', null)],
      [row('own-a', 'Electrical rough', 'Sam', detail), row('own-b', 'Electrical rough', 'Dana', detail)],
    )).toEqual([ADDED, ADDED, REMOVED]);
  });

  it('two of that name removed: no telling whose owner changed, so nothing more is said', () => {
    expect(lines(
      [row('master-a', 'Electrical rough', null), row('master-b', 'Electrical rough', 'Dana')],
      [row('own', 'Electrical rough', 'Sam', detail)],
    )).toEqual([ADDED, REMOVED, REMOVED]);
  });
});
