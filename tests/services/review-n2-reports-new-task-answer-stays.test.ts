import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
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
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Review N2 of reports (5 Oct 2026, Medium; a gap f7b2d02 left). Found in
// the reviewer's random run (p2-sched-text-random: seeds 115, 136, 173, 205,
// 309, 340, 363 and 375), under the heading "a task a new master drops is not
// reported as removed": these are not the lookahead case, and happen on the
// commit before a587e9f too.
// A master listed two tasks called Pour slab. At the next master David
// answered "which Pour slab is which": one row is the earlier first one, the
// other is a NEW task, so the earlier second one was dropped. f7b2d02 made
// the report follow that answer for the row he answered for. But the master
// after that re-dated the new task as a new row, which answers to the first
// by its earlier ids and carried no answer: the report paired it by name
// with the dropped task ("Pour slab finish changed from 10/16/2026 to
// 10/30/2026"; "Pour slab was completed" when the new one was done), and the
// dropped task was never said removed.
// The CSV reader, the import's question and merge, the shown list and the
// report builders are the app's own; phone and web are both checked.

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

const M1 = schedule('MASTER 1', '2026-10-01T12:00:00.000Z');
const M2 = schedule('MASTER 2', '2026-10-06T12:00:00.000Z');
const M3 = schedule('MASTER 3', '2026-10-13T12:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const pour = (start: string, finish: string) => `Pour slab,Alpha,Lot,${start},${finish},`;
const REMOVED = 'Pour slab was removed from the current project plan.';
const ADDED = 'Pour slab was added to the project plan.';
const pours = (state: State) => shown(state).filter(item => item.taskName === 'Pour slab').map(item => `${item.startDate}-${item.finishDate} ${item.percentComplete}%`).sort();

/** Master 1 lists two Pour slabs; the first report goes out. */
function firstReport() {
  const state = approve(EMPTY, M1, [FRAMING, pour('10/05/2026', '10/09/2026'), pour('10/12/2026', '10/16/2026')]);
  return { state, first: sent(state, null, '2026-10-01T14:00:00.000Z') };
}
/** Master 2: he answers that 10/12 is the one that was on 10/05, and 10/19 is a new task (so the one on 10/12 was dropped). */
const masterTwo = (state: State) =>
  approve(state, M2, [FRAMING, pour('10/12/2026', '10/16/2026'), pour('10/19/2026', '10/23/2026')], { '10/12/2026': '10/05/2026', '10/19/2026': 'new' });
/** Master 3 moves both a week; the app's guess (each is the one a week earlier) is confirmed. */
const masterThree = (state: State) =>
  approve(state, M3, [FRAMING, pour('10/19/2026', '10/23/2026'), pour('10/26/2026', '10/30/2026')]);

describe('review N2 (Medium): "this row is a new task" stays with the task when the next master re-dates it', () => {
  it('two masters after the last report: the dropped task is said removed, the new one added, and no finish change no task made', () => {
    const { state, first } = firstReport();
    const afterTwo = masterTwo(state);
    const afterThree = masterThree(afterTwo);
    expect(pours(afterThree)).toEqual(['10/19/2026-10/23/2026 0%', '10/26/2026-10/30/2026 0%']);
    // The row master 3 gave the new task answers to master 2's row, which he had called new.
    const newTask = shown(afterThree).find(item => item.startDate === '10/26/2026')!;
    const answeredFor = afterTwo.items.find(item => item.taskName === 'Pour slab' && item.startDate === '10/19/2026')!;
    expect(newTask.revisedFromTaskIds).toEqual([answeredFor.id]);
    expect(answeredFor.notRevisionOfTaskIds?.length).toBe(2);

    const phone = phoneReport(afterThree, first, '2026-10-13T14:00:00.000Z');
    expect([...phone.lines].sort()).toEqual([ADDED, 'Pour slab finish changed from 10/09/2026 to 10/23/2026.', REMOVED].sort());
    expect(phone.lines.join(' ')).not.toMatch(/10\/16\/2026 to 10\/30\/2026/);
    expect([phone.completed, phone.open]).toEqual([0, 0]);
    const web = webReport(afterThree, first, '2026-10-13T14:00:00.000Z');
    expect(web.lines).toEqual(phone.lines);
    expect(web.said).toEqual(phone.said);
  });

  it('the new task was completed meanwhile: it is added as complete; the dropped task is not said "was completed"', () => {
    const { state, first } = firstReport();
    const afterTwo = record(masterTwo(state), '10/19/2026', 100, '2026-10-07T10:00:00.000Z');
    const afterThree = masterThree(afterTwo);
    expect(pours(afterThree)).toEqual(['10/19/2026-10/23/2026 0%', '10/26/2026-10/30/2026 100%']);
    const report = phoneReport(afterThree, first, '2026-10-13T14:00:00.000Z');
    expect(report.lines).toEqual(expect.arrayContaining([ADDED, REMOVED]));
    expect(report.lines.join(' ')).not.toMatch(/Pour slab was completed/);
    // Two open before; one open and one complete now.
    expect([report.completed, report.open]).toEqual([1, -1]);
  });

  it('the answer is read from the saved rows: the report\'s task says which tasks it is not', () => {
    const { state } = firstReport();
    const afterThree = masterThree(masterTwo(state));
    const truth = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(afterThree), projectAreas: [], referenceDocuments: afterThree.documents,
      now: '2026-10-13T14:00:00.000Z', knownScheduleItems: afterThree.items, knownScheduleDocuments: afterThree.documents, reportLookaheadReplacement: true,
    });
    const tasks = truth.schedule.filter(task => task.taskName === 'Pour slab');
    const newTask = tasks.find(task => task.finishDate === '10/30/2026')!;
    const moved = tasks.find(task => task.finishDate === '10/23/2026')!;
    expect([...(newTask.notTaskIds ?? [])].sort()).toEqual(['MASTER 1-2', 'MASTER 1-3']);
    // The task he said was the earlier first one carries no such answer.
    expect(moved.notTaskIds).toBeUndefined();
    // Without the saved rows (a caller that gives the shown list only) nothing is guessed.
    const shownOnly = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(afterThree), projectAreas: [], referenceDocuments: afterThree.documents,
      now: '2026-10-13T14:00:00.000Z',
    });
    expect(shownOnly.schedule.find(task => task.finishDate === '10/30/2026')?.notTaskIds).toBeUndefined();
  });
});

describe('review N2 (Medium): what already read right still does', () => {
  it('one master after the last report (the row he answered for): removed and added, as f7b2d02 made it', () => {
    const { state, first } = firstReport();
    const report = phoneReport(masterTwo(state), first, '2026-10-06T14:00:00.000Z');
    expect([...report.lines].sort()).toEqual([ADDED, 'Pour slab finish changed from 10/09/2026 to 10/16/2026.', REMOVED].sort());
  });

  it('a report sent between the two masters: the new task is followed by its ids, and reads as moved', () => {
    const { state, first } = firstReport();
    const afterTwo = masterTwo(state);
    const second = sent(afterTwo, first, '2026-10-06T14:00:00.000Z');
    const report = phoneReport(masterThree(afterTwo), second, '2026-10-13T14:00:00.000Z');
    expect([...report.lines].sort()).toEqual([
      'Pour slab finish changed from 10/16/2026 to 10/23/2026.',
      'Pour slab finish changed from 10/23/2026 to 10/30/2026.',
    ]);
    expect([report.completed, report.open]).toEqual([0, 0]);
  });

  it('he answered that both rows are the earlier tasks, a week on: both read as moved across two masters', () => {
    const { state, first } = firstReport();
    const afterTwo = approve(state, M2, [FRAMING, pour('10/12/2026', '10/16/2026'), pour('10/19/2026', '10/23/2026')], { '10/12/2026': '10/05/2026', '10/19/2026': '10/12/2026' });
    const report = phoneReport(masterThree(afterTwo), first, '2026-10-13T14:00:00.000Z');
    expect([...report.lines].sort()).toEqual([
      'Pour slab finish changed from 10/09/2026 to 10/23/2026.',
      'Pour slab finish changed from 10/16/2026 to 10/30/2026.',
    ]);
  });
});
