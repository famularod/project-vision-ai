/**
 * R5 item 1 (the returning task, report side; Medium, older).
 *
 * Since schedule batch S2 a task one master schedule leaves out and a later
 * master lists again comes back as the SAME task, by its Unique ID or by his
 * answer at the import review ("The same task" or "New work"). The reports
 * did not know it:
 *  - a report sent while the task was out rightly said "removed"; the next
 *    one said "added" and compared the task with nothing;
 *  - "New work" must stay removed and added, also after a later master moves
 *    the new task;
 *  - the recorded case: a master drops Paint, a lookahead lists Paint as its
 *    own row, the next master lists it, and the report read "Paint moved
 *    from 60% to 0% complete."
 *
 * The real CSV reader, the phone's import review and approval, the shown
 * list, the one report recipe (phone and web) and the report's comparison.
 * Synthetic data.
 */
import { scheduleImportPairingChosen, scheduleImportPairingGuess, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { daveProjectTruthAsBuilt } from '../../services/DAVEProjectTruth';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, compareDAVEReportSnapshots, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot,
  reportSnapshotToSave, type DAVEReportSnapshot, type DAVEReportSnapshotTask,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport, type ScheduleImportPairingQuestion } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
const PLAIN = 'Task,Project,Area,Start,Finish,Percent Complete';
const WITH_IDS = 'Unique ID,Task,Project,Area,Start,Finish,Percent Complete';
/** How he answers a question of the import review: the row each earlier task is (null: none of the file's rows). */
type Answers = (question: ScheduleImportPairingQuestion) => Record<string, string | null>;
const SAME_TASK: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, question.rows[0].id]));
const NEW_WORK: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, null]));
/** The titles of the questions the review asked, in order. */
let asked: string[] = [];
beforeEach(() => { asked = []; });

/** The approval as the phone makes it: the review's questions answered (or confirmed as guessed), then the merge. */
function approve(state: State, source: ReferenceDocument, lines: string[], header = PLAIN, answers?: Answers): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const questions = scheduleImportReviewPairingQuestions({ saved: state.items, documents: state.documents, importBatchId: source.importBatchId || '', imported, overlay: lookahead });
  questions.forEach(question => asked.push(question.title));
  const answerOf = (question: ScheduleImportPairingQuestion) => {
    let answer = scheduleImportPairingGuess(question);
    Object.entries(answers ? answers(question) : {}).forEach(([savedId, rowId]) => { answer = scheduleImportPairingChosen(answer, savedId, rowId); });
    return { ...answer, confirmed: true };
  };
  const { pairingChoices } = withScheduleImportPairingChoices({ pairingChoices: null }, questions, answerOf);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: lookahead, pairingChoices,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const one = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
/** He sets something on the task shown under that name. */
function set(state: State, name: string, change: Partial<ScheduleItem>, at: string): State {
  const id = one(state, name)[0].id;
  return { ...state, items: state.items.map(item => (item.id === id ? {
    ...item, ...change,
    ...(typeof change.percentComplete === 'number' ? { status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David' } : {}),
    updatedAt: at,
  } as ScheduleItem : item)) };
}

/** The phone's Reports screen recipe (screens/ReportsScreen.tsx), with the clock given. */
const phoneTruths = (state: State, now: string) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
  knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now,
});
/** What the web has downloaded of the same data (services/DAVEWebOperations.ts). */
const webSnapshot = (state: State, now: string): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
  projectUpdates: [], referenceDocuments: state.documents, refreshedAt: now,
}) as unknown as DAVEWebReadOnlySnapshot;
type Read = { counts: string; lines: string[]; paint: string[] };
const readOf = (period: ReturnType<typeof buildDAVEReportBriefing>['reportingPeriod']): Read => {
  const lines = period.changes.map(change => change.summary);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
  return { counts: `${signed(period.completeDelta)} completed; ${signed(period.openDelta)} open`, lines, paint: lines.filter(line => line.startsWith('Paint ')) };
};
/** The report as the phone reads it against the period saved, and that report approved and sent. */
function report(state: State, known: DAVEReportSnapshot | null, now: string) {
  const truths = phoneTruths(state, now);
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  const approved = (reportSnapshotToSave(snapshot, known) ?? known) as DAVEReportSnapshot;
  // The same report read again once approved: against the period as the approval saved it.
  const onceApproved = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(approved, fingerprint), scheduleItems: shown(state) });
  return { ...readOf(briefing.reportingPeriod), onceApproved: readOf(onceApproved.reportingPeriod), truths, sent: markReportSnapshotDelivered(approved, now, 'phone') };
}
/** The same report as the web reads it. */
function webReport(state: State, known: DAVEReportSnapshot | null, now: string): Read {
  const snapshot = webSnapshot(state, now);
  const fingerprint = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, 'Alpha'));
  return readOf(buildDAVEWebReportDraft(snapshot, 'Alpha', { previousSnapshot: reportBaselineSnapshot(known, fingerprint), waitingForOtherDevice: false }).reportingPeriod);
}
const sameOnTheWeb = (state: State, known: DAVEReportSnapshot | null, now: string, phone: Read) => {
  const web = webReport(state, known, now);
  expect({ counts: web.counts, lines: web.lines }).toEqual({ counts: phone.counts, lines: phone.lines });
};

const OTHERS = ['Framing,Alpha,Lot,11/01/2026,11/03/2026,', 'Drywall,Alpha,Lot,11/02/2026,11/04/2026,', 'Tile,Alpha,Lot,11/03/2026,11/05/2026,'];
const PAINT = 'Paint,Alpha,Lot,10/01/2026,10/05/2026,';
const PAINT_MOVED = 'Paint,Alpha,Lot,10/03/2026,10/07/2026,';
const numbered = (lines: string[]) => lines.map((line, index) => `${index + 1},${line}`);
const ADDED = 'Paint was added to the project plan.';
const REMOVED = 'Paint was removed from the current project plan.';
const BACK = 'Paint is back in the project plan.';

/** Master 1 lists Paint; he sets 60% and Sam; the first report goes out; master 2 leaves Paint out. */
function paintLeftOut(header = PLAIN, percentAtReport = 60) {
  const lines = (rows: string[]) => (header === WITH_IDS ? numbered(rows) : rows);
  let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), lines([...OTHERS, PAINT]), header);
  state = set(state, 'Paint', { percentComplete: percentAtReport, owner: 'Sam' }, '2026-09-08T08:00:00.000Z');
  const first = report(state, null, '2026-09-08T15:00:00.000Z');
  if (percentAtReport !== 60) state = set(state, 'Paint', { percentComplete: 60 }, '2026-09-08T16:00:00.000Z');
  state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), lines([...OTHERS]), header);
  expect(one(state, 'Paint')).toEqual([]);
  return { state, first, lines };
}

describe('R5 item 1: a task a report said was removed, that a later master lists again as the same task, reads as back', () => {
  it('he answered "The same task" after a report sent while it was out: back, with his 60% to 70% and the new finish; never "added"', () => {
    const { state: out, first } = paintLeftOut();
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    expect(whileOut.paint).toEqual([REMOVED]);
    expect(whileOut.counts).toBe('+0 completed; -1 open');
    let state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    expect(asked).toEqual(['Paint in Lot was on an earlier schedule: the same task, or new work?']);
    expect(one(state, 'Paint').map(item => [item.revisedFromTaskIds, item.percentComplete, item.owner])).toEqual([[['MASTER 1-4'], 60, 'Sam']]);
    // Nothing changed on it but its dates: it is back, on its new finish.
    const back = report(state, whileOut.sent, '2026-09-10T15:00:00.000Z');
    expect(back.paint).toEqual([BACK, 'Paint finish changed from 10/05/2026 to 10/07/2026.']);
    expect(back.counts).toBe('+0 completed; +1 open');
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T15:00:00.000Z', back);
    // (It read: ["Paint was added to the project plan."], his 60% to 70% below never said.)
    state = set(state, 'Paint', { percentComplete: 70 }, '2026-09-10T16:00:00.000Z');
    const moved = report(state, whileOut.sent, '2026-09-10T17:00:00.000Z');
    expect(moved.paint).toEqual([BACK, 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 10/05/2026 to 10/07/2026.']);
    expect(moved.lines).not.toContain(ADDED);
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T17:00:00.000Z', moved);
    // Unchanged since it was sent, it reads as it was sent; the next report counts from it and says nothing of Paint.
    expect(report(state, moved.sent, '2026-09-11T15:00:00.000Z').paint).toEqual(moved.paint);
    const after = report(set(state, 'Tile', { percentComplete: 20 }, '2026-09-11T16:00:00.000Z'), moved.sent, '2026-09-11T17:00:00.000Z');
    expect(after.lines).toEqual(['Tile moved from 0% to 20% complete.', 'Tile changed from Not Started to In Progress.']);
  });

  it('by its Unique ID, with nothing asked: the same', () => {
    const { state: out, first, lines } = paintLeftOut(WITH_IDS);
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    let state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), lines([...OTHERS, PAINT_MOVED]), WITH_IDS);
    expect(asked).toEqual([]);
    state = set(state, 'Paint', { percentComplete: 70, owner: 'Dana' }, '2026-09-10T16:00:00.000Z');
    const back = report(state, whileOut.sent, '2026-09-10T17:00:00.000Z');
    expect(back.paint).toEqual([BACK, 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 10/05/2026 to 10/07/2026.', 'Paint owner changed from Sam to Dana.']);
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T17:00:00.000Z', back);
  });

  it('what he had changed on it after the last report that listed it is said against that report: 40% there, 60% when it left', () => {
    const { state: out, first } = paintLeftOut(PLAIN, 40);
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    const state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    const back = report(state, whileOut.sent, '2026-09-10T15:00:00.000Z');
    expect(back.paint).toEqual([BACK, 'Paint moved from 40% to 60% complete.', 'Paint finish changed from 10/05/2026 to 10/07/2026.']);
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T15:00:00.000Z', back);
  });

  it('out for three reports, longer than a saved period remembers: back, against the row it left on, which is still saved', () => {
    const { state: out, first } = paintLeftOut();
    let known = report(out, first.sent, '2026-09-09T15:00:00.000Z').sent;
    let state = out;
    // Two more reports go out while Paint is not in the list (something else changes each time).
    for (const [day, percent] of [['12', 20], ['13', 40]] as const) {
      state = set(state, 'Tile', { percentComplete: percent }, `2026-09-${day}T08:00:00.000Z`);
      const sentWhileOut = report(state, known, `2026-09-${day}T15:00:00.000Z`);
      expect(sentWhileOut.paint).toEqual([]);
      known = sentWhileOut.sent;
    }
    // No report the period keeps has Paint now.
    const kept = [known, known.supersedes, known.supersedes?.supersedes].flatMap(saved => saved?.tasks ?? []);
    expect(kept.some(task => task.taskName === 'Paint')).toBe(false);
    state = approve(state, schedule('MASTER 3', '2026-09-20T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    state = set(state, 'Paint', { percentComplete: 70 }, '2026-09-20T16:00:00.000Z');
    const back = report(state, known, '2026-09-20T17:00:00.000Z');
    expect(back.paint).toEqual([BACK, 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 10/05/2026 to 10/07/2026.']);
    expect(back.counts).toBe('+0 completed; +1 open');
    sameOnTheWeb(state, known, '2026-09-20T17:00:00.000Z', back);
  });

  it('listed again on the days it had, he confirms "The same task": the same row is shown again, and reads as back', () => {
    const { state: out, first } = paintLeftOut();
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    let state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT]);
    expect(asked).toEqual(['Paint in Lot was on an earlier schedule: the same task, or new work?']);
    expect(one(state, 'Paint').map(item => [item.id, item.percentComplete])).toEqual([['MASTER 1-4', 60]]);
    state = set(state, 'Paint', { percentComplete: 70 }, '2026-09-10T16:00:00.000Z');
    const back = report(state, whileOut.sent, '2026-09-10T17:00:00.000Z');
    expect(back.paint).toEqual([BACK, 'Paint moved from 60% to 70% complete.']);
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T17:00:00.000Z', back);
  });

  it('back on its own row after two reports, a row that itself answers to an older row: "added", never compared with that older row (found by the taught text driver)', () => {
    // Master 1 lists Paint; master 2 moves it, on a new row that answers to master 1's; he sets 60% and Sam; a report goes out.
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-05T12:00:00.000Z'), [...OTHERS, PAINT]);
    state = approve(state, schedule('MASTER 2', '2026-09-07T12:00:00.000Z'), [...OTHERS, PAINT_MOVED]);
    state = set(state, 'Paint', { percentComplete: 60, owner: 'Sam' }, '2026-09-08T08:00:00.000Z');
    expect(one(state, 'Paint').map(item => [item.id, item.revisedFromTaskIds])).toEqual([['MASTER 2-4', ['MASTER 1-4']]]);
    const first = report(state, null, '2026-09-08T15:00:00.000Z');
    // Master 3 leaves it out, and two reports go out.
    state = approve(state, schedule('MASTER 3', '2026-09-09T12:00:00.000Z'), [...OTHERS]);
    const whileOut = report(state, first.sent, '2026-09-09T15:00:00.000Z');
    expect(whileOut.paint).toEqual([REMOVED]);
    state = set(state, 'Tile', { percentComplete: 20 }, '2026-09-12T08:00:00.000Z');
    const secondWhileOut = report(state, whileOut.sent, '2026-09-12T15:00:00.000Z');
    expect(secondWhileOut.paint).toEqual([]);
    // Master 4 lists it on the days it had and he confirms "The same task": the row it had is shown again.
    state = approve(state, schedule('MASTER 4', '2026-09-20T12:00:00.000Z'), [...OTHERS, PAINT_MOVED]);
    expect(one(state, 'Paint').map(item => [item.id, item.percentComplete, item.owner])).toEqual([['MASTER 2-4', 60, 'Sam']]);
    state = set(state, 'Paint', { percentComplete: 70 }, '2026-09-20T16:00:00.000Z');
    const back = report(state, secondWhileOut.sent, '2026-09-20T17:00:00.000Z');
    // The row it left on is the row shown: nothing saved tells how it stood in the last report that listed it. Master
    // 1's row is older than that report, and what it holds was never what a report said. (It read: back, "moved from
    // 0% to 70% complete", "finish changed from 10/05/2026 to 10/07/2026", "owner changed from unassigned to Sam".)
    expect(back.paint).toEqual([ADDED]);
    expect(back.onceApproved.paint).toEqual([ADDED]);
    sameOnTheWeb(state, secondWhileOut.sent, '2026-09-20T17:00:00.000Z', back);
  });

  it('left out before the first report was ever sent, and listed again after it: "added", since no report can have said it was removed (found by the taught text driver)', () => {
    // Master 1 lists Paint and he sets 60%; master 2 leaves it out; only then does the first report go out.
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-05T12:00:00.000Z'), [...OTHERS, PAINT]);
    state = set(state, 'Paint', { percentComplete: 60, owner: 'Sam' }, '2026-09-06T08:00:00.000Z');
    state = approve(state, schedule('MASTER 2', '2026-09-07T12:00:00.000Z'), [...OTHERS]);
    const first = report(state, null, '2026-09-08T15:00:00.000Z');
    expect(first.lines).toEqual([]);
    // Master 3 lists it again on other days, and he answers "The same task": a new row, with his 60%.
    state = approve(state, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    expect(one(state, 'Paint').map(item => [item.revisedFromTaskIds, item.percentComplete])).toEqual([[['MASTER 1-4'], 60]]);
    state = set(state, 'Paint', { percentComplete: 70 }, '2026-09-10T16:00:00.000Z');
    const next = report(state, first.sent, '2026-09-10T17:00:00.000Z');
    // (It read: "Paint is back in the project plan.", "Paint moved from 60% to 70% complete.", "Paint finish changed
    // from 10/05/2026 to 10/07/2026.", to a reader whose only report never had Paint.)
    expect(next.paint).toEqual([ADDED]);
    expect(next.onceApproved.paint).toEqual([ADDED]);
    sameOnTheWeb(state, first.sent, '2026-09-10T17:00:00.000Z', next);
  });

  it('reads the same once approved as it did as a draft, in every case above', () => {
    const { state: out, first } = paintLeftOut();
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    const state = set(approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK), 'Paint', { percentComplete: 70 }, '2026-09-10T16:00:00.000Z');
    const back = report(state, whileOut.sent, '2026-09-10T17:00:00.000Z');
    expect(back.paint[0]).toBe(BACK);
    expect(back.onceApproved).toEqual({ counts: back.counts, lines: back.lines, paint: back.paint });
    // And where the report before the last one does not have it either (out for two reports).
    const stateOut = set(out, 'Tile', { percentComplete: 20 }, '2026-09-12T08:00:00.000Z');
    const secondWhileOut = report(stateOut, whileOut.sent, '2026-09-12T15:00:00.000Z');
    const later = approve(stateOut, schedule('MASTER 3', '2026-09-20T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    const backLater = report(later, secondWhileOut.sent, '2026-09-20T17:00:00.000Z');
    expect(backLater.paint).toEqual([BACK, 'Paint finish changed from 10/05/2026 to 10/07/2026.']);
    expect(backLater.onceApproved).toEqual({ counts: backLater.counts, lines: backLater.lines, paint: backLater.paint });
  });

  it('guard: with no report sent while it was out it was never said removed, and only what changed is said', () => {
    const { state: out, first } = paintLeftOut();
    const state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    const next = report(state, first.sent, '2026-09-10T15:00:00.000Z');
    expect(next.paint).toEqual(['Paint finish changed from 10/05/2026 to 10/07/2026.']);
    expect(next.counts).toBe('+0 completed; +0 open');
    sameOnTheWeb(state, first.sent, '2026-09-10T15:00:00.000Z', next);
  });

  it('guard: a task new since the last report, which a second master then moves, is added, not back', () => {
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS]);
    const first = report(state, null, '2026-09-08T15:00:00.000Z');
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS, PAINT]);
    state = set(state, 'Paint', { percentComplete: 30 }, '2026-09-09T16:00:00.000Z');
    state = approve(state, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED]);
    expect(one(state, 'Paint').map(item => [item.revisedFromTaskIds, item.percentComplete])).toEqual([[['MASTER 2-4'], 30]]);
    const next = report(state, first.sent, '2026-09-10T15:00:00.000Z');
    expect(next.paint).toEqual([ADDED]);
    sameOnTheWeb(state, first.sent, '2026-09-10T15:00:00.000Z', next);
  });
});

describe('R5 item 1: "New work" stays removed and added', () => {
  it('guard: in the report after his answer, and still after a later master moves the new task', () => {
    const { state: out, first } = paintLeftOut();
    let state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, NEW_WORK);
    expect(one(state, 'Paint').map(item => [item.revisedFromTaskIds ?? [], item.notRevisionOfTaskIds, item.percentComplete])).toEqual([[[], ['MASTER 1-4'], 0]]);
    const answered = report(state, first.sent, '2026-09-10T15:00:00.000Z');
    expect(answered.paint).toEqual([ADDED, REMOVED]);
    sameOnTheWeb(state, first.sent, '2026-09-10T15:00:00.000Z', answered);
    state = approve(state, schedule('MASTER 4', '2026-09-11T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/05/2026,10/09/2026,']);
    expect(one(state, 'Paint').map(item => item.revisedFromTaskIds)).toEqual([['MASTER 3-4']]);
    const moved = report(state, first.sent, '2026-09-11T15:00:00.000Z');
    expect(moved.paint).toEqual([ADDED, REMOVED]);
    expect(moved.counts).toBe('+0 completed; +0 open');
    sameOnTheWeb(state, first.sent, '2026-09-11T15:00:00.000Z', moved);
  });

  it('guard: with a report sent while it was out, the new task is added, never back; also after a later master moves it', () => {
    const { state: out, first } = paintLeftOut();
    const whileOut = report(out, first.sent, '2026-09-09T15:00:00.000Z');
    expect(whileOut.paint).toEqual([REMOVED]);
    let state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, NEW_WORK);
    const answered = report(state, whileOut.sent, '2026-09-10T15:00:00.000Z');
    expect(answered.paint).toEqual([ADDED]);
    sameOnTheWeb(state, whileOut.sent, '2026-09-10T15:00:00.000Z', answered);
    state = approve(state, schedule('MASTER 4', '2026-09-11T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/05/2026,10/09/2026,']);
    const moved = report(state, whileOut.sent, '2026-09-11T15:00:00.000Z');
    expect(moved.paint).toEqual([ADDED]);
    sameOnTheWeb(state, whileOut.sent, '2026-09-11T15:00:00.000Z', moved);
  });
});

describe('R5 item 1: the recorded case, a lookahead lists the dropped task as its own row and the next master lists it', () => {
  it('removed and added, as the report said one step earlier; never "moved from 60% to 0% complete"', () => {
    const { state: out, first } = paintLeftOut();
    let state = approve(out, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), ['Paint,Alpha,Lot,10/02/2026,10/06/2026,']);
    expect(one(state, 'Paint').map(item => [item.id, item.importedAsLookahead, item.percentComplete])).toEqual([['LOOKAHEAD 1-1', true, 0]]);
    const onLookahead = report(state, first.sent, '2026-09-10T15:00:00.000Z');
    expect(onLookahead.paint).toEqual([ADDED, REMOVED]);
    state = approve(state, schedule('MASTER 3', '2026-09-11T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/05/2026,10/09/2026,']);
    // Nothing is asked: the list has a Paint (the lookahead's row), and the master's row is that one, moved.
    expect(asked).toEqual([]);
    expect(one(state, 'Paint').map(item => [item.id, item.revisedFromTaskIds, item.percentComplete])).toEqual([['MASTER 3-4', ['LOOKAHEAD 1-1'], 0]]);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    // (It read: "Paint moved from 60% to 0% complete.", "Paint changed from In Progress to Not Started.",
    //  "Paint finish changed from 10/05/2026 to 10/09/2026.", "Paint owner changed from Sam to unassigned.")
    expect(next.paint).toEqual([ADDED, REMOVED]);
    expect(next.counts).toBe('+0 completed; +0 open');
    expect(next.onceApproved.paint).toEqual([ADDED, REMOVED]);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
    // The owner he sets on the Paint now shown is said beside them, as for a lookahead's own row (R1 item 4).
    state = set(state, 'Paint', { owner: 'Dana' }, '2026-09-12T16:00:00.000Z');
    expect(report(state, first.sent, '2026-09-12T17:00:00.000Z').paint).toEqual([ADDED, REMOVED, 'Paint owner changed from Sam to Dana.']);
  });

  it('the same when the next master lists it on the lookahead\'s own days: the lookahead\'s row itself becomes the master\'s task', () => {
    const { state: out, first } = paintLeftOut();
    let state = approve(out, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), ['Paint,Alpha,Lot,10/02/2026,10/06/2026,']);
    state = approve(state, schedule('MASTER 3', '2026-09-11T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/02/2026,10/06/2026,']);
    expect(asked).toEqual([]);
    // The same row, a master's task now (no longer a lookahead's detail).
    expect(one(state, 'Paint').map(item => [item.id, item.revisedFromTaskIds ?? [], item.percentComplete])).toEqual([['LOOKAHEAD 1-1', [], 0]]);
    const truths = phoneTruths(state, '2026-09-12T15:00:00.000Z');
    expect(truths[0].schedule.find(task => task.taskName === 'Paint')?.lookaheadDetail).toBeUndefined();
    expect(truths[0].lookaheadAddedTaskIds).toEqual(['LOOKAHEAD 1-1']);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    // (It read: "Paint moved from 60% to 0% complete.", "Paint changed from In Progress to Not Started.",
    //  "Paint finish changed from 10/05/2026 to 10/06/2026.", "Paint owner changed from Sam to unassigned.")
    expect(next.paint).toEqual([ADDED, REMOVED]);
    expect(next.onceApproved.paint).toEqual([ADDED, REMOVED]);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
  });

  it('guard: where nothing he had set is lost (he had set nothing on the dropped Paint), the two read as one task, as before', () => {
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, PAINT]);
    const first = report(state, null, '2026-09-08T15:00:00.000Z');
    state = approve(state, schedule('MASTER 2', '2026-09-09T12:00:00.000Z'), [...OTHERS]);
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), ['Paint,Alpha,Lot,10/02/2026,10/06/2026,']);
    state = approve(state, schedule('MASTER 3', '2026-09-11T12:00:00.000Z'), [...OTHERS, 'Paint,Alpha,Lot,10/05/2026,10/09/2026,']);
    expect(one(state, 'Paint').map(item => [item.id, item.revisedFromTaskIds])).toEqual([['MASTER 3-4', ['LOOKAHEAD 1-1']]]);
    // Paint was in his list at both reports, with nothing on it: only its finish moved. No "removed" and "added".
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    expect(next.paint).toEqual(['Paint finish changed from 10/05/2026 to 10/09/2026.']);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
    // What he sets on it since is said as his, against the earlier report.
    state = set(state, 'Paint', { percentComplete: 30, owner: 'Dana' }, '2026-09-12T16:00:00.000Z');
    const worked = report(state, first.sent, '2026-09-12T17:00:00.000Z');
    expect(worked.paint).toEqual([
      'Paint moved from 0% to 30% complete.', 'Paint changed from Not Started to In Progress.',
      'Paint finish changed from 10/05/2026 to 10/09/2026.', 'Paint owner changed from unassigned to Dana.',
    ]);
    sameOnTheWeb(state, first.sent, '2026-09-12T17:00:00.000Z', worked);
  });

  it('guard: with Unique IDs the next master brings the dropped Paint back with his 60%, and only its finish is said', () => {
    const { state: out, first, lines } = paintLeftOut(WITH_IDS);
    let state = approve(out, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), ['9,Paint,Alpha,Lot,10/02/2026,10/06/2026,'], WITH_IDS);
    state = approve(state, schedule('MASTER 3', '2026-09-11T12:00:00.000Z'), lines([...OTHERS, 'Paint,Alpha,Lot,10/05/2026,10/09/2026,']), WITH_IDS);
    expect(one(state, 'Paint').map(item => [item.revisedFromTaskIds, item.percentComplete, item.owner])).toEqual([[['MASTER 1-4'], 60, 'Sam']]);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    expect(next.paint).toEqual(['Paint finish changed from 10/05/2026 to 10/09/2026.']);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
  });
});

describe('R5 item 1: the report\'s fingerprint does not move', () => {
  it('the earlier rows handed to the comparison are in neither version of the fingerprint', () => {
    const { state: out } = paintLeftOut();
    const state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    const truths = phoneTruths(state, '2026-09-10T15:00:00.000Z');
    expect((truths[0].earlierRows ?? []).map(row => [row.taskId, row.earlierTaskId, row.percentComplete, row.owner, row.finishDate])).toEqual([['MASTER 3-4', 'MASTER 1-4', 60, 'Sam', '10/05/2026']]);
    const without = truths.map(truth => { const { earlierRows: _rows, lookaheadAddedTaskIds: _ids, ...rest } = truth; return rest as typeof truth; });
    expect(buildDAVEReportSourceFingerprint(truths)).toBe(buildDAVEReportSourceFingerprint(without));
    // 1.0 is worked out from the truth as it was built, which carries the rows too: without them there as well.
    const asBuilt = daveProjectTruthAsBuilt(truths[0]);
    expect(asBuilt.earlierRows).toHaveLength(1);
    const { earlierRows: _built, ...asBuiltWithout } = asBuilt;
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(buildDAVELegacyReportSourceFingerprint([asBuiltWithout as typeof asBuilt]));
  });

  it('nor is the list of tasks whose own row a lookahead added', () => {
    const { state: out } = paintLeftOut();
    const state = approve(out, schedule('LOOKAHEAD 1', '2026-09-10T12:00:00.000Z', 'lookahead'), ['Paint,Alpha,Lot,10/02/2026,10/06/2026,']);
    const truths = phoneTruths(state, '2026-09-10T15:00:00.000Z');
    expect(truths[0].lookaheadAddedTaskIds).toEqual(['LOOKAHEAD 1-1']);
    const without = truths.map(truth => { const { lookaheadAddedTaskIds: _ids, ...rest } = truth; return rest as typeof truth; });
    expect(buildDAVEReportSourceFingerprint(truths)).toBe(buildDAVEReportSourceFingerprint(without));
    const asBuilt = daveProjectTruthAsBuilt(truths[0]);
    expect(asBuilt.lookaheadAddedTaskIds).toEqual(['LOOKAHEAD 1-1']);
    const { lookaheadAddedTaskIds: _built, ...asBuiltWithout } = asBuilt;
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(buildDAVELegacyReportSourceFingerprint([asBuiltWithout as typeof asBuilt]));
  });

  it('guard: a truth built without the saved tasks has no earlier rows, and reads as before', () => {
    const { state: out } = paintLeftOut();
    const state = approve(out, schedule('MASTER 3', '2026-09-10T12:00:00.000Z'), [...OTHERS, PAINT_MOVED], PLAIN, SAME_TASK);
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
      projectAreas: [], referenceDocuments: state.documents, now: '2026-09-10T15:00:00.000Z',
    });
    expect(truths[0].earlierRows).toBeUndefined();
  });
});

describe('R5 item 1: the earlier rows the report\'s Project Truth hands over', () => {
  const NOW = '2026-09-10T15:00:00.000Z';
  const item = (id: string, change: Partial<ScheduleItem> = {}) => ({
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Paint', startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '',
    owner: 'Sam', contractor: '', percentComplete: 60, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
    importedAt: '2026-09-07T12:00:00.000Z', importBatchId: `batch-${id}`, ...change,
  }) as unknown as ScheduleItem;
  const rowsOf = (shownItems: ScheduleItem[], saved: ScheduleItem[]) => (buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }, { name: 'Beta' }] as never, updates: [], scheduleItems: shownItems,
    knownScheduleItems: saved, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: NOW,
  })[0].earlierRows ?? []).map(row => [row.taskId, row.earlierTaskId, row.savedAt, row.percentComplete, row.owner, row.addedByLookahead ?? false, row.taskSavedAt]);

  it('each saved row a task shown answers to, oldest first, with when it came in and how it stood; a row a lookahead added says so; and when the row shown came in', () => {
    const shownNow = item('now', { revisedFromTaskIds: ['first', 'second', 'gone'], percentComplete: 70, importedAt: '2026-09-10T12:00:00.000Z' });
    const first = item('first', { percentComplete: 20, owner: 'Lee', importedAt: '2026-08-03T12:00:00.000Z' });
    const second = item('second', { percentComplete: 40, importedAsLookahead: true, importedAt: '2026-08-17T12:00:00.000Z' });
    expect(rowsOf([shownNow], [shownNow, second, first])).toEqual([
      ['now', 'first', '2026-08-03T12:00:00.000Z', 20, 'Lee', false, '2026-09-10T12:00:00.000Z'],
      ['now', 'second', '2026-08-17T12:00:00.000Z', 40, 'Sam', true, '2026-09-10T12:00:00.000Z'],
    ]);
  });

  it('a row entered by hand has no import: when it was made stands for when it came in', () => {
    const shownNow = item('now', { revisedFromTaskIds: ['by-hand'] });
    const byHand = item('by-hand', { importedAt: null, importBatchId: null, createdAt: '2026-08-20T09:00:00.000Z' });
    expect(rowsOf([shownNow], [shownNow, byHand])).toEqual([['now', 'by-hand', '2026-08-20T09:00:00.000Z', 60, 'Sam', false, '2026-09-07T12:00:00.000Z']]);
    // The same for the row shown.
    const shownByHand = item('now', { revisedFromTaskIds: ['by-hand'], importedAt: null, importBatchId: null, createdAt: '2026-09-02T09:00:00.000Z' });
    expect(rowsOf([shownByHand], [shownByHand, byHand]).map(row => row[6])).toEqual(['2026-09-02T09:00:00.000Z']);
  });

  it('never another project\'s row, and never a row that is itself shown', () => {
    const shownNow = item('now', { revisedFromTaskIds: ['elsewhere', 'also-shown'] });
    const elsewhere = item('elsewhere', { projectName: 'Beta', scheduleProjectName: 'Beta' });
    const alsoShown = item('also-shown', { taskName: 'Paint touch-up' });
    expect(rowsOf([shownNow, alsoShown], [shownNow, alsoShown, elsewhere])).toEqual([]);
  });
});

describe('R5 item 1: the comparison\'s rules, on saved reports alone', () => {
  const task = (taskId: string, change: Partial<DAVEReportSnapshotTask> = {}): DAVEReportSnapshotTask => ({
    taskId, projectName: 'Alpha', taskName: 'Paint', areaName: 'Lot', owner: 'Sam', status: 'In Progress', percentComplete: 60, finishDate: '10/05/2026',
    urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...change,
  });
  const saved = (capturedAt: string, tasks: DAVEReportSnapshotTask[], supersedes: DAVEReportSnapshot | null = null): DAVEReportSnapshot => ({
    version: 'dave-report-snapshot/1.0', scopeKey: 'alpha', capturedAt, sourceFingerprint: `f-${capturedAt}`, tasks, supersedes, deliveredAt: capturedAt, reportFormat: 'project_manager',
  });
  const other = task('other', { taskName: 'Framing', owner: null, status: 'Not Started', percentComplete: 0 });
  const before = saved('2026-09-08T15:00:00.000Z', [other, task('old')]);
  const whileOut = saved('2026-09-09T15:00:00.000Z', [other], before);
  const linesOf = (current: DAVEReportSnapshotTask[], previous = whileOut, earlierRows: Parameters<typeof compareDAVEReportSnapshots>[0]['earlierRows'] = []) =>
    compareDAVEReportSnapshots({ current: saved('2026-09-10T15:00:00.000Z', [other, ...current]), previous, earlierRows }).changes.map(change => change.summary);
  /** An earlier row of a task shown; the row shown was made after the last report (2026-09-09T15:00) unless said. */
  const row = (taskId: string, earlierTaskId: string, savedAt: string, change: object = {}) => ({
    taskId, earlierTaskId, savedAt, taskSavedAt: '2026-09-09T18:00:00.000Z', projectName: 'Alpha', taskName: 'Paint', areaName: 'Lot', owner: 'Sam', status: 'In Progress', percentComplete: 60,
    finishDate: '10/05/2026', approvalStatus: null, estimatedScheduleImpactDays: null, ...change,
  });

  it('a row that answers to the row the report before the last one had is back, by that report', () => {
    expect(linesOf([task('new', { earlierTaskIds: ['old'], percentComplete: 70 })])).toEqual([BACK, 'Paint moved from 60% to 70% complete.']);
  });

  it('one to one only: two rows that answer to the one removed row are both added, as two that answer to one row of the last report are', () => {
    expect(linesOf([task('new-1', { earlierTaskIds: ['old'] }), task('new-2', { earlierTaskIds: ['old'], finishDate: '10/20/2026' })])).toEqual([ADDED, ADDED]);
  });

  it('two rows that answer to one row the last report still has stay as they were (added, and that row removed): never "back" by an older row', () => {
    const lastReport = saved('2026-09-09T15:00:00.000Z', [other, task('old')], before);
    const current = [task('new-1', { earlierTaskIds: ['old'] }), task('new-2', { earlierTaskIds: ['old'], finishDate: '10/20/2026' })];
    expect(linesOf(current, lastReport, [row('new-1', 'old', '2026-09-07T12:00:00.000Z'), row('new-2', 'old', '2026-09-07T12:00:00.000Z')])).toEqual([ADDED, ADDED, REMOVED]);
  });

  it('a lookahead\'s detail row that left with its replaced lookahead was never said removed: listed again, it reads as before', () => {
    const detailBefore = saved('2026-09-08T15:00:00.000Z', [other, task('old', { lookaheadDetail: true })]);
    expect(linesOf([task('old', { lookaheadDetail: true })], saved('2026-09-09T15:00:00.000Z', [other], detailBefore))).toEqual([ADDED]);
  });

  it('guard: nor is it back when a master lists it now: the master\'s task is added, since nothing said the detail row was removed', () => {
    const detailBefore = saved('2026-09-08T15:00:00.000Z', [other, task('old', { lookaheadDetail: true })]);
    const lastReport = saved('2026-09-09T15:00:00.000Z', [other], detailBefore);
    // The lookahead's row itself became the master's task; or the master made a new row that answers to it.
    expect(linesOf([task('old')], lastReport)).toEqual([ADDED]);
    expect(linesOf([task('listed', { earlierTaskIds: ['old'] })], lastReport)).toEqual([ADDED]);
  });

  it('nor when the report that listed it was saved by a build that did not yet mark a lookahead\'s detail rows (found by the taught text driver)', () => {
    // The same detail row, in a report saved before the mark existed: it left with its lookahead, nothing was said,
    // and a later lookahead lists it again on the row it had.
    const unmarkedBefore = saved('2026-09-08T15:00:00.000Z', [other, task('old', { finishDate: '10/11/2026' })]);
    expect(linesOf([task('old', { lookaheadDetail: true, finishDate: '09/19/2026' })], saved('2026-09-09T15:00:00.000Z', [other], unmarkedBefore))).toEqual([ADDED]);
    // Nor by a row it answers to, nor by a saved row handed over.
    expect(linesOf([task('again', { lookaheadDetail: true, earlierTaskIds: ['old'] })], saved('2026-09-09T15:00:00.000Z', [other], unmarkedBefore))).toEqual([ADDED]);
    expect(linesOf([task('again', { lookaheadDetail: true, earlierTaskIds: ['old'] })], saved('2026-09-09T15:00:00.000Z', [other]), [row('again', 'old', '2026-09-07T12:00:00.000Z')])).toEqual([ADDED]);
    // Guard: a master's task on that same unmarked report is back, as before.
    expect(linesOf([task('old', { percentComplete: 70 })], saved('2026-09-09T15:00:00.000Z', [other], unmarkedBefore)))
      .toEqual([BACK, 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 10/11/2026 to 10/05/2026.']);
  });

  it('with no report kept that has it: back by the row it left on, only when that row was already saved when the last report was made', () => {
    const lastReport = saved('2026-09-09T15:00:00.000Z', [other], saved('2026-09-08T15:00:00.000Z', [other]));
    const current = [task('new', { earlierTaskIds: ['old'], percentComplete: 70 })];
    expect(linesOf(current, lastReport, [row('new', 'old', '2026-09-07T12:00:00.000Z')])).toEqual([BACK, 'Paint moved from 60% to 70% complete.']);
    // A row saved after that report: the task came in since, and a second master moved it.
    expect(linesOf(current, lastReport, [row('new', 'old', '2026-09-09T16:00:00.000Z')])).toEqual([ADDED]);
    // The latest of several rows saved by then is how it last stood.
    expect(linesOf(current, lastReport, [row('new', 'older', '2026-09-01T12:00:00.000Z', { percentComplete: 20 }), row('new', 'old', '2026-09-07T12:00:00.000Z', { percentComplete: 50 })]))
      .toEqual([BACK, 'Paint moved from 50% to 70% complete.']);
    // Never by a row a lookahead added, and never with no time on the row.
    expect(linesOf(current, lastReport, [row('new', 'old', '2026-09-07T12:00:00.000Z', { addedByLookahead: true })])).toEqual([ADDED]);
    expect(linesOf(current, lastReport, [{ ...row('new', 'old', ''), savedAt: null }])).toEqual([ADDED]);
    // Nor when the row SHOWN was already saved when that report was made: it is the task's own row shown again, the
    // row it left on, and an older row of it is not how it last stood. Nor with no time on the row shown.
    expect(linesOf(current, lastReport, [row('new', 'old', '2026-09-07T12:00:00.000Z', { taskSavedAt: '2026-09-08T12:00:00.000Z' })])).toEqual([ADDED]);
    expect(linesOf(current, lastReport, [row('new', 'old', '2026-09-07T12:00:00.000Z', { taskSavedAt: null })])).toEqual([ADDED]);
    // Nor when the last report is the only one there has been: no report can have listed the task and said it removed.
    expect(linesOf(current, saved('2026-09-09T15:00:00.000Z', [other]), [row('new', 'old', '2026-09-07T12:00:00.000Z')])).toEqual([ADDED]);
  });

  it('a task that began as a lookahead\'s own row and a master\'s task of the last report: apart only where he would be said to have lost what he set', () => {
    const was = (change: Partial<DAVEReportSnapshotTask>) => saved('2026-09-09T15:00:00.000Z', [other, task('dropped', { owner: null, status: 'Not Started', percentComplete: 0, ...change })]);
    const now = (change: Partial<DAVEReportSnapshotTask>) => [task('listed', { earlierTaskIds: ['lookahead-row'], owner: null, status: 'Not Started', percentComplete: 0, ...change })];
    const began = [row('listed', 'lookahead-row', '2026-09-09T16:00:00.000Z', { addedByLookahead: true })];
    const APART = [ADDED, REMOVED];
    // Progress gone back, or a completion undone.
    expect(linesOf(now({}), was({ status: 'In Progress', percentComplete: 60 }), began)).toEqual(APART);
    expect(linesOf(now({ status: 'In Progress', percentComplete: 90 }), was({ status: 'Complete', percentComplete: 100 }), began)).toEqual(APART);
    // An owner, an approval he asked for, a schedule impact gone.
    expect(linesOf(now({}), was({ owner: 'Sam' }), began)).toEqual(APART);
    expect(linesOf(now({}), was({ approvalStatus: 'Pending' }), began)).toEqual(APART);
    expect(linesOf(now({}), was({ estimatedScheduleImpactDays: 2 }), began)).toEqual(APART);
    // Nothing lost: one task, with what changed. "Not Required" is no approval he asked for.
    expect(linesOf(now({ finishDate: '10/09/2026' }), was({}), began)).toEqual(['Paint finish changed from 10/05/2026 to 10/09/2026.']);
    expect(linesOf(now({ status: 'In Progress', percentComplete: 75, owner: 'Dana' }), was({ approvalStatus: 'Not Required' }), began))
      .toEqual(['Paint moved from 0% to 75% complete.', 'Paint changed from Not Started to In Progress.', 'Paint owner changed from unassigned to Dana.', 'Paint approval changed from Not Required to not set.']);
    // The owner changed to another is his doing, not a loss.
    expect(linesOf(now({ owner: 'Dana' }), was({ owner: 'Sam' }), began)).toEqual(['Paint owner changed from Sam to Dana.']);
    // And a task with no lookahead's row behind it reads as before, whatever it lost (review N6).
    expect(linesOf(now({}), was({ status: 'In Progress', percentComplete: 60 }), [])).toEqual(['Paint moved from 60% to 0% complete.', 'Paint changed from In Progress to Not Started.']);
    // The same for a task whose own row a lookahead added.
    expect(compareDAVEReportSnapshots({
      current: saved('2026-09-10T15:00:00.000Z', [other, task('lookahead-row', { owner: null, status: 'Not Started', percentComplete: 0 })]),
      previous: was({ status: 'In Progress', percentComplete: 60 }), lookaheadAddedTaskIds: ['lookahead-row'],
    }).changes.map(change => change.summary)).toEqual(APART);
  });

  it('guard: a task the last report has under its name alone is still that task, whatever rows it has been through (review N6)', () => {
    const lastReport = saved('2026-09-09T15:00:00.000Z', [other, task('listed-again')], before);
    expect(linesOf([task('moved', { earlierTaskIds: ['in-between'], percentComplete: 70 })], lastReport, [row('moved', 'in-between', '2026-09-09T16:00:00.000Z', { percentComplete: 0 })]))
      .toEqual(['Paint moved from 60% to 70% complete.']);
  });
});
