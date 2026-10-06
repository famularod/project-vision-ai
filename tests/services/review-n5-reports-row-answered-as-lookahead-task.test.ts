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

// Review N5 of reports (6 Oct 2026), finding B (Low, older; the reviewer's
// "fields seed 461", untraced since pass 3). With three tasks of one name the
// report said "Pour slab moved from 60% to 0% complete." and "Pour slab
// changed from In Progress to Not Started." for a task that did neither, and
// never said the 60% one was removed.
// Two Pour slabs on the master; after the last report a lookahead adds a
// third as its own row; the next master lists two, and David answers "this
// row is the one the lookahead added, that row is the first one". So the
// second Pour slab (60%) is dropped, and the list follows him. The report
// paired the row he had answered for BY NAME with the dropped task: the row
// is a master's now, and its earlier ids (the lookahead's row) match nothing
// in the earlier report.
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
const L1 = schedule('LOOKAHEAD 1', '2026-10-02T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD 2', '2026-10-03T12:00:00.000Z', 'lookahead');
const L3 = schedule('LOOKAHEAD 3', '2026-10-05T12:00:00.000Z', 'lookahead');
const M2 = schedule('MASTER 2', '2026-10-06T12:00:00.000Z');
const L4 = schedule('LOOKAHEAD 4', '2026-10-06T18:00:00.000Z', 'lookahead');
const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const pour = (start: string, finish: string, percent = '') => `Pour slab,Alpha,Lot,${start},${finish},${percent}`;
const REMOVED = 'Pour slab was removed from the current project plan.';
const ADDED = 'Pour slab was added to the project plan.';
const pours = (state: State) => shown(state).filter(item => item.taskName === 'Pour slab').map(item => `${item.startDate}-${item.finishDate} ${item.percentComplete}%`).sort();
const openTasks = (state: State) => shown(state).filter(item => item.percentComplete < 100).length;
const pourLines = (report: Pick<Report, 'lines'>) => report.lines.filter(line => line.startsWith('Pour slab')).sort();

/**
 * The reviewer's steps. Master 1 lists two Pour slabs. Lookahead 1 gives the second 60% and adds a detail row he
 * calls a new task; lookahead 2 lists the same three. The report goes out. He records the first at 25%. Lookahead 3
 * then lists the second and a Pour slab of its own on 10/16: no question is asked, and that row is the THIRD task.
 */
function upToLookaheadThree(reportAfterIt = false) {
  let state = approve(EMPTY, M1, [FRAMING, pour('10/05/2026', '10/09/2026'), pour('10/12/2026', '10/16/2026')]);
  state = approve(state, L1, [pour('10/11/2026', '10/19/2026', '60'), pour('10/10/2026', '10/13/2026')], { '10/10/2026': 'new', '10/11/2026': '10/12/2026' });
  state = approve(state, L2, [pour('10/07/2026', '10/11/2026'), pour('10/10/2026', '10/13/2026')]);
  expect(pours(state)).toEqual(['10/07/2026-10/11/2026 0%', '10/10/2026-10/13/2026 0%', '10/12/2026-10/16/2026 60%']);
  let first = sent(state, null, '2026-10-03T14:00:00.000Z');
  let openThen = openTasks(state);
  state = record(state, '10/07/2026', 25, '2026-10-04T10:00:00.000Z');
  state = approve(state, L3, [pour('10/16/2026', '10/20/2026'), pour('10/11/2026', '10/15/2026')]);
  // The first back on the master's dates, the second on lookahead 3's, and lookahead 3's own row.
  expect(pours(state)).toEqual(['10/05/2026-10/09/2026 25%', '10/11/2026-10/15/2026 60%', '10/16/2026-10/20/2026 0%']);
  if (reportAfterIt) {
    first = sent(state, first, '2026-10-05T14:00:00.000Z');
    openThen = openTasks(state);
  }
  return { state, first, openThen };
}
/** Master 2 lists two Pour slabs. He answers: 10/12 is the one lookahead 3 added (on 10/16); 10/14 is the first (on 10/05). */
const masterTwoAsHeAnswers = (state: State) =>
  approve(state, M2, [FRAMING, pour('10/14/2026', '10/18/2026'), pour('10/12/2026', '10/16/2026')], { '10/12/2026': '10/16/2026', '10/14/2026': '10/05/2026' });
/** A newer lookahead that lists no Pour slab: lookahead 3 no longer holds the one master 2 dropped. */
const lookaheadFour = (state: State) => approve(state, L4, ['Framing,Alpha,Lot,09/16/2026,09/26/2026,']);
const NOW = '2026-10-07T14:00:00.000Z';

describe('review N5 B (Low): the row he said is the lookahead\'s task is that task in the report too', () => {
  it('the dropped 60% task is said removed, the lookahead\'s task added, and no percent change that no task made', () => {
    const { state: before, first, openThen } = upToLookaheadThree();
    const state = lookaheadFour(masterTwoAsHeAnswers(before));
    // The list follows him: the first Pour slab (25%) and the lookahead's (0%); the 60% one is gone.
    expect(pours(state)).toEqual(['10/12/2026-10/16/2026 0%', '10/14/2026-10/18/2026 25%']);
    for (const report of [phoneReport(state, first, NOW), webReport(state, first, NOW)]) {
      expect(pourLines(report)).toEqual([
        'Pour slab changed from Not Started to In Progress.',
        'Pour slab finish changed from 10/11/2026 to 10/18/2026.',
        'Pour slab moved from 0% to 25% complete.',
        ADDED,
        REMOVED,
      ].sort());
      // What it said before: a change against the dropped task.
      expect(report.lines).not.toContain('Pour slab moved from 60% to 0% complete.');
      expect(report.lines).not.toContain('Pour slab changed from In Progress to Not Started.');
      // The counts follow: one open task left and one came. (The list has one fewer than at the earlier report:
      // the detail task of lookahead 1, which left with its lookahead and by the decided rule moves no count.)
      expect(report.completed).toBe(0);
      expect(report.open).toBe(0);
      expect(openTasks(state) - openThen).toBe(-1);
    }
  });

  it('with the lookahead\'s row already in the earlier report it is compared with itself, and the dropped task is still said removed', () => {
    const { state: before, first, openThen } = upToLookaheadThree(true);
    const state = lookaheadFour(masterTwoAsHeAnswers(before));
    for (const report of [phoneReport(state, first, NOW), webReport(state, first, NOW)]) {
      // The lookahead's task moved from 10/20 to 10/16 with the master, the first from 10/09 to 10/18; the 60% one left.
      expect(pourLines(report)).toEqual([
        'Pour slab finish changed from 10/09/2026 to 10/18/2026.',
        'Pour slab finish changed from 10/20/2026 to 10/16/2026.',
        REMOVED,
      ].sort());
      expect(report.open).toBe(openTasks(state) - openThen);
      expect(report.open).toBe(-1);
    }
  });
});

describe('review N5 B: what stays as it was', () => {
  it('the app\'s own guess at master 2: each task is compared with itself, and the detail task that left with its lookahead is not mentioned', () => {
    const { state: before, first } = upToLookaheadThree();
    const state = lookaheadFour(approve(before, M2, [FRAMING, pour('10/14/2026', '10/18/2026'), pour('10/12/2026', '10/16/2026')]));
    for (const report of [phoneReport(state, first, NOW), webReport(state, first, NOW)]) {
      // 10/14 is the 60% one and 10/12 the first; lookahead 3's own row is in neither and left with its lookahead.
      expect(pours(state)).toEqual(['10/12/2026-10/16/2026 25%', '10/14/2026-10/18/2026 60%']);
      expect(pourLines(report)).toEqual([
        'Pour slab changed from Not Started to In Progress.',
        'Pour slab finish changed from 10/11/2026 to 10/16/2026.',
        'Pour slab finish changed from 10/16/2026 to 10/18/2026.',
        'Pour slab moved from 0% to 25% complete.',
      ].sort());
    }
  });

  it('rows saved before the import kept earlier ids still pair by name', () => {
    const state = approve(EMPTY, M1, [FRAMING, pour('10/05/2026', '10/09/2026')]);
    const first = sent(state, null, '2026-10-03T14:00:00.000Z');
    const moved = approve(state, M2, [FRAMING, pour('10/12/2026', '10/16/2026')]);
    // As an older build saved the new master's rows: with no record of the rows they revise.
    const legacy: State = { ...moved, items: moved.items.map(item => ({ ...item, revisedFromTaskIds: undefined })) };
    for (const report of [phoneReport(legacy, first, NOW), webReport(legacy, first, NOW)]) {
      expect(pourLines(report)).toEqual(['Pour slab finish changed from 10/09/2026 to 10/16/2026.']);
    }
  });
});
