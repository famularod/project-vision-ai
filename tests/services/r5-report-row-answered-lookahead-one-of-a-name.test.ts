/**
 * R5 item 4 (recorded by review N6 as "reached by no test"; Low, older).
 *
 * Review N5 B: a row he answered "this is the lookahead's task" for was paired
 * BY NAME with a same-named task the master had dropped ("Pour slab moved
 * from 60% to 0% complete."). The fix decided by the ids wherever either
 * report holds more than one task of the name (review N6 narrowed it so a
 * task with a name of its own, listed again, still reads as itself). Left
 * with no test: he answered so, and EACH report then holds only one task of
 * the name. The ids were not asked there, the name alone paired the
 * lookahead's task with the dropped one, and the old line came back.
 *
 * On 14dcbfd the first test below fails with exactly that line. It is put
 * right by R5 item 1's rule (a task that began as a lookahead's own row is
 * never paired by name with a master's task), and pinned here.
 *
 * The real CSV reader, the import review's question and approval, the shown
 * list, the one report recipe (phone and web). Synthetic data.
 */
import { scheduleImportPairingChosen, scheduleImportPairingGuess, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot,
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
/** How he answers a question of the import review: the row each earlier task is (null: none of the file's rows). */
type Answers = (question: ScheduleImportPairingQuestion) => Record<string, string | null>;
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
type Read = { counts: string; lines: string[]; pour: string[] };
const readOf = (period: ReturnType<typeof buildDAVEReportBriefing>['reportingPeriod']): Read => {
  const lines = period.changes.map(change => change.summary);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
  return { counts: `${signed(period.completeDelta)} completed; ${signed(period.openDelta)} open`, lines, pour: lines.filter(line => line.startsWith('Pour slab ')).sort() };
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

const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const pour = (start: string, finish: string) => `Pour slab,Alpha,Lot,${start},${finish},`;
const ADDED = 'Pour slab was added to the project plan.';
const REMOVED = 'Pour slab was removed from the current project plan.';
const pours = (state: State) => one(state, 'Pour slab').map(item => `${item.id} ${item.startDate} ${item.percentComplete}%`).sort();
const QUESTION = '2 tasks named Pour slab in Lot — confirm which is which';
/** At master 2's review: its one Pour slab row is the task the lookahead added; the master's own Pour slab gets no row. */
const THE_LOOKAHEADS: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, item.importedAsLookahead === true ? question.rows[0].id : null]));
/** The other answer: the row is the master's own Pour slab, moved; the lookahead's gets no row. */
const THE_MASTERS: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, item.importedAsLookahead === true ? null : question.rows[0].id]));

/**
 * Master 1 lists one Pour slab; he records 60% and Sam on it, and the report goes out (one Pour slab in it).
 * Lookahead 1 re-dates that task and adds a second Pour slab of its own. Master 2 lists ONE Pour slab row, and he
 * is asked which of the two it is. A newer lookahead then replaces lookahead 1, which no longer holds the other.
 */
function untilMasterTwo(answer: Answers) {
  let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [FRAMING, pour('10/05/2026', '10/09/2026')]);
  state = set(state, 'Pour slab', { percentComplete: 60, owner: 'Sam' }, '2026-09-08T08:00:00.000Z');
  const first = report(state, null, '2026-09-08T15:00:00.000Z');
  state = approve(state, schedule('LOOKAHEAD 1', '2026-09-09T12:00:00.000Z', 'lookahead'), [pour('10/06/2026', '10/10/2026'), pour('10/20/2026', '10/24/2026')]);
  expect(pours(state)).toEqual(['LOOKAHEAD 1-2 10/20/2026 0%', 'MASTER 1-2 10/06/2026 60%']);
  asked = [];
  state = approve(state, schedule('MASTER 2', '2026-09-10T12:00:00.000Z'), [FRAMING, pour('10/21/2026', '10/25/2026')], PLAIN, answer);
  expect(asked).toEqual([QUESTION]);
  state = approve(state, schedule('LOOKAHEAD 2', '2026-09-11T12:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,09/16/2026,09/26/2026,']);
  return { state, first };
}

describe('R5 item 4: he answered "this row is the lookahead\'s task", and each report holds one task of that name', () => {
  it('the master\'s dropped Pour slab is said removed and the lookahead\'s added; never "moved from 60% to 0% complete"', () => {
    const { state, first } = untilMasterTwo(THE_LOOKAHEADS);
    // The list follows him: one Pour slab, the lookahead's, on master 2's days; the 60% one is gone.
    expect(one(state, 'Pour slab').map(item => [item.id, item.revisedFromTaskIds, item.percentComplete, item.owner || ''])).toEqual([['MASTER 2-2', ['LOOKAHEAD 1-2'], 0, '']]);
    // One task of the name in the last report, and one now.
    expect(first.sent.tasks.filter(task => task.taskName === 'Pour slab')).toHaveLength(1);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    // (On 14dcbfd: "Pour slab moved from 60% to 0% complete.", "Pour slab changed from In Progress to Not Started.",
    //  "Pour slab finish changed from 10/09/2026 to 10/25/2026.", "Pour slab owner changed from Sam to unassigned.")
    expect(next.pour).toEqual([ADDED, REMOVED].sort());
    expect(next.counts).toBe('+0 completed; +0 open');
    expect(next.onceApproved.pour).toEqual(next.pour);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
  });

  it('where he had set nothing on the master\'s Pour slab, nothing of his is lost, and the one Pour slab of each report reads as one task, as before', () => {
    let state = approve({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [FRAMING, pour('10/05/2026', '10/09/2026')]);
    const first = report(state, null, '2026-09-08T15:00:00.000Z');
    state = approve(state, schedule('LOOKAHEAD 1', '2026-09-09T12:00:00.000Z', 'lookahead'), [pour('10/06/2026', '10/10/2026'), pour('10/20/2026', '10/24/2026')]);
    state = approve(state, schedule('MASTER 2', '2026-09-10T12:00:00.000Z'), [FRAMING, pour('10/21/2026', '10/25/2026')], PLAIN, THE_LOOKAHEADS);
    state = approve(state, schedule('LOOKAHEAD 2', '2026-09-11T12:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,09/16/2026,09/26/2026,']);
    expect(one(state, 'Pour slab').map(item => [item.id, item.revisedFromTaskIds])).toEqual([['MASTER 2-2', ['LOOKAHEAD 1-2']]]);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    expect(next.pour).toEqual(['Pour slab finish changed from 10/09/2026 to 10/25/2026.']);
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
  });

  it('guard: answered the other way (the row is the master\'s own Pour slab, moved), it is that task: its finish changed, and nothing is added or removed', () => {
    const { state, first } = untilMasterTwo(THE_MASTERS);
    expect(one(state, 'Pour slab').map(item => [item.id, item.revisedFromTaskIds, item.percentComplete, item.owner || ''])).toEqual([['MASTER 2-2', ['MASTER 1-2'], 60, 'Sam']]);
    const next = report(state, first.sent, '2026-09-12T15:00:00.000Z');
    expect(next.pour).toEqual(['Pour slab finish changed from 10/09/2026 to 10/25/2026.']);
    expect(next.counts).toBe('+0 completed; +0 open');
    sameOnTheWeb(state, first.sent, '2026-09-12T15:00:00.000Z', next);
  });
});
