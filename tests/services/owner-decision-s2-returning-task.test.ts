/*
 * Build 231, schedule batch S2, item 1 (the coordinator's decisions of 6 Oct 2026 on "a task one master leaves out
 * and a later master lists again"; older Medium, the same on Build 229).
 *
 * Master F lists Paint; he enters 60% and a note. Master G leaves Paint out. Master H lists Paint again on new
 * dates: it came back as a new row at 0% with no note, and his 60% and note stayed on F's hidden row.
 *
 *  (a) The same Microsoft Project Unique ID as a task no longer shown: the same task. What he set comes back.
 *  (b) Without IDs: never paired silently. The import review asks, by the "which is which" step of owner answer
 *      Q30: the task, the percent and note it had, "the same task" or "new work". Nothing is carried unless he
 *      says the same task.
 *  (c) A task that was 100% is asked like any other.
 *  "New work" sticks: that earlier task is not offered again.
 */
import { scheduleImportPairingGuess, scheduleImportPairingChosen, scheduleImportPairingRefusal, scheduleImportPairingWording, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport, type ScheduleImportPairingQuestion } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const PLAIN = 'Task,Project,Area,Start,Finish,Percent Complete';
const WITH_IDS = 'Unique ID,Task,Project,Area,Start,Finish,Percent Complete';
const rowsOf = (source: ReferenceDocument, header: string, lines: string[]) => (normalizeScheduleImport({
  contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
/** The questions the phone's import review asks for this file. */
const questionsFor = (state: State, source: ReferenceDocument, header: string, lines: string[]) =>
  scheduleImportReviewPairingQuestions({ saved: state.items, documents: state.documents, importBatchId: source.importBatchId || '', imported: rowsOf(source, header, lines) });
/** How he answers a question: the row each saved task is, by the saved task's id (null: none of the file's rows). */
type Answers = (question: ScheduleImportPairingQuestion) => Record<string, string | null>;
/** The approval, as App.tsx makes it: the review's questions answered (or confirmed as guessed), then the merge. */
function approve(state: State, source: ReferenceDocument, lines: string[], header = PLAIN, answers?: Answers): State {
  const imported = rowsOf(source, header, lines);
  const questions = scheduleImportReviewPairingQuestions({ saved: state.items, documents: state.documents, importBatchId: source.importBatchId || '', imported });
  const answerOf = (question: ScheduleImportPairingQuestion) => {
    let answer = scheduleImportPairingGuess(question);
    Object.entries(answers ? answers(question) : {}).forEach(([savedId, rowId]) => { answer = scheduleImportPairingChosen(answer, savedId, rowId); });
    return { ...answer, confirmed: true };
  };
  const { pairingChoices } = withScheduleImportPairingChoices({ pairingChoices: null }, questions, answerOf);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, pairingChoices,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-21T12:00:00.000Z');
const I = schedule('MASTER I', '2026-09-28T12:00:00.000Z');
/** On F's Paint: his percent, a note, an owner, Approval Pending and a schedule impact of 2 days. */
function hisPaint(state: State, percent = 60): State {
  const at = '2026-09-08T12:00:00.000Z';
  return { ...state, items: state.items.map(item => (item.taskName === 'Paint' ? {
    ...item, percentComplete: percent, status: percent === 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David',
    notes: 'Primer on', owner: 'Mike', updatedAt: at,
    projectControls: reviseProjectControls({ current: item.projectControls, patch: { approvalStatus: 'Pending', estimatedScheduleImpactDays: 2 }, actor: 'David', now: at }),
  } as ScheduleItem : item)) };
}
/** Framing after Paint, made by hand on F's rows. */
const linked = (state: State): State => ({ ...state, items: state.items.map(item => (item.taskName === 'Framing' && item.id === 'MASTER F-1'
  ? { ...item, dependencies: [{ predecessorItemId: 'MASTER F-2', type: 'FS' as const, lagDays: 0 }], dependenciesUpdatedAt: '2026-09-08T13:00:00.000Z' } : item)) });
/** Paint as the list shows it: its row, the rows it answers to, start, percent, note, owner, approval, impact. */
const paint = (state: State) => shown(state).filter(item => item.taskName === 'Paint').map(item => {
  const controls = normalizeProjectControls(item.projectControls);
  return [item.id, item.revisedFromTaskIds ?? [], item.startDate, item.percentComplete, item.notes || '', item.owner || '', controls.approvalStatus, controls.estimatedScheduleImpactDays ?? null];
});
const FRAMING = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,';
const PAINT = 'Paint,Alpha,Lot,11/02/2026,11/06/2026,';
const PAINT_BACK = 'Paint,Alpha,Lot,11/09/2026,11/13/2026,';
const withIds = (lines: string[], ids: number[]) => lines.map((line, index) => `${ids[index]},${line}`);
/** F lists Framing and Paint, he sets things on Paint, and G leaves Paint out. */
function paintLeftOut(header = PLAIN, percent = 60): State {
  const ids = (lines: string[], numbers: number[]) => (header === WITH_IDS ? withIds(lines, numbers) : lines);
  const onF = linked(hisPaint(approve({ items: [], documents: [] }, F, ids([FRAMING, PAINT], [1, 2]), header), percent));
  const onG = approve(onF, G, ids([FRAMING], [1]), header);
  expect(shown(onG).map(item => item.taskName)).toEqual(['Framing']);
  return onG;
}
const SAME_TASK: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, question.rows[0].id]));
const NEW_WORK: Answers = question => Object.fromEntries(question.saved.map(item => [item.id, null]));
const AS_HE_LEFT_IT = [['MASTER H-2', ['MASTER F-2'], '11/09/2026', 60, 'Primer on', 'Mike', 'Pending', 2]];

describe('S2 item 1 (a): the same Unique ID as a task no longer shown is the same task', () => {
  it('Paint comes back with his percent, note, owner, approval and impact; nothing is asked; and Framing\'s hand link names its new row', () => {
    const onG = paintLeftOut(WITH_IDS);
    const lines = withIds([FRAMING, PAINT_BACK], [1, 2]);
    expect(questionsFor(onG, H, WITH_IDS, lines)).toEqual([]);
    const onH = approve(onG, H, lines, WITH_IDS);
    // (It was: [['MASTER H-2', [], '11/09/2026', 0, '', '', 'Not Required', null]], his 60% and note on F's hidden row.)
    expect(paint(onH)).toEqual(AS_HE_LEFT_IT);
    expect(shown(onH).find(item => item.taskName === 'Framing')!.dependencies).toEqual([{ predecessorItemId: 'MASTER H-2', type: 'FS', lagDays: 0 }]);
  });

  it('another Unique ID is another task, whatever its name: new work, with nothing asked', () => {
    const onG = paintLeftOut(WITH_IDS);
    const lines = withIds([FRAMING, PAINT_BACK], [1, 7]);
    expect(questionsFor(onG, H, WITH_IDS, lines)).toEqual([]);
    expect(paint(approve(onG, H, lines, WITH_IDS))).toEqual([['MASTER H-2', [], '11/09/2026', 0, '', '', 'Not Required', null]]);
  });

  it('a task shown is never taken for one that left: with Paint still in the list, a second Paint with the left task\'s ID pairs with the one that left', () => {
    const onF = hisPaint(approve({ items: [], documents: [] }, F, withIds([FRAMING, PAINT, 'Paint,Alpha,Lot,11/16/2026,11/20/2026,'], [1, 2, 3]), WITH_IDS));
    const onG = approve(onF, G, withIds([FRAMING, 'Paint,Alpha,Lot,11/16/2026,11/20/2026,'], [1, 3]), WITH_IDS);
    const onH = approve(onG, H, withIds([FRAMING, 'Paint,Alpha,Lot,11/16/2026,11/20/2026,', PAINT_BACK], [1, 3, 2]), WITH_IDS);
    const rows = shown(onH).filter(item => item.taskName === 'Paint').map(item => [item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []]);
    expect(rows.sort()).toEqual([['11/09/2026', 60, ['MASTER F-2']], ['11/16/2026', 60, []]].sort());
  });
});

describe('S2 item 1 (b): without Unique IDs the import review asks, and nothing is carried unless he says the same task', () => {
  it('the question names the task, the percent and note it had, and offers the same task or new work; new work is what is selected', () => {
    const onG = paintLeftOut();
    const [question, ...others] = questionsFor(onG, H, PLAIN, [FRAMING, PAINT_BACK]);
    expect(others).toEqual([]);
    expect(question).toMatchObject({ taskName: 'Paint', areaName: 'Lot', returning: true, title: 'Paint in Lot was on an earlier schedule: the same task, or new work?', guess: { 'MASTER H-2': null } });
    expect(question.saved.map(item => [item.id, item.percentComplete, item.notes])).toEqual([['MASTER F-2', 60, 'Primer on']]);
    expect(question.rows.map(row => row.id)).toEqual(['MASTER H-2']);
    const wording = scheduleImportPairingWording(question);
    expect(wording.intro).toBe('This task was on an earlier schedule and is not in your list now. If this file brings the same task back, its percent, notes and what you set on it come back with it. Nothing is carried unless you say it is the same task.');
    expect([wording.savedTitle(question.saved[0], 0), wording.rowOption(question.rows[0]), wording.none]).toEqual(['Earlier Paint: 11/2–11/6 · 60% · “Primer on”', 'The same task: 11/9–11/13 · no %', 'New work']);
    expect(scheduleImportPairingGuess(question)).toEqual({ confirmed: false, rowOfSaved: { 'MASTER F-2': null } });
    // Accept waits until he has answered.
    expect(scheduleImportPairingRefusal([question], scheduleImportPairingGuess)).toBe('Confirm whether Paint in Lot is the same task or new work before saving.');
  });

  it('"the same task": his percent, note, owner, approval, impact and hand link come back with it', () => {
    const onH = approve(paintLeftOut(), H, [FRAMING, PAINT_BACK], PLAIN, SAME_TASK);
    expect(paint(onH)).toEqual(AS_HE_LEFT_IT);
    expect(shown(onH).find(item => item.taskName === 'Framing')!.dependencies).toEqual([{ predecessorItemId: 'MASTER H-2', type: 'FS', lagDays: 0 }]);
  });

  it('"new work": a new task at 0% with nothing of the old one, and the answer sticks: the next master is not asked about that earlier task again', () => {
    const onH = approve(paintLeftOut(), H, [FRAMING, PAINT_BACK], PLAIN, NEW_WORK);
    expect(paint(onH)).toEqual([['MASTER H-2', [], '11/09/2026', 0, '', '', 'Not Required', null]]);
    // Master I leaves the new Paint out, and lists Paint again on other dates with it gone: asked about the new Paint
    // only (the row he called new work), never again about F's.
    const again = [FRAMING, 'Paint,Alpha,Lot,11/23/2026,11/27/2026,'];
    const withoutPaint = approve(onH, I, [FRAMING]);
    const J = schedule('MASTER J', '2026-10-05T12:00:00.000Z');
    expect(questionsFor(withoutPaint, J, PLAIN, again).map(question => question.saved.map(item => item.id))).toEqual([['MASTER H-2']]);
    // And a master that lists the Paint still shown, moved, asks nothing at all.
    expect(questionsFor(onH, I, PLAIN, again)).toEqual([]);
  });

  it('(c) a task that was 100% is asked like any other, and the question shows the 100% he would be carrying', () => {
    const onG = paintLeftOut(PLAIN, 100);
    const [question] = questionsFor(onG, H, PLAIN, [FRAMING, PAINT_BACK]);
    expect([question.returning, scheduleImportPairingWording(question).savedTitle(question.saved[0], 0)]).toEqual([true, 'Earlier Paint: 11/2–11/6 · 100% · “Primer on”']);
    expect(paint(approve(onG, H, [FRAMING, PAINT_BACK], PLAIN, NEW_WORK)).map(row => row[3])).toEqual([0]);
    expect(paint(approve(onG, H, [FRAMING, PAINT_BACK], PLAIN, SAME_TASK)).map(row => row[3])).toEqual([100]);
  });

  it('a row on exactly the days the task had is asked about too, with "the same task" selected; confirmed, the task\'s own row is shown again, as before', () => {
    const onG = paintLeftOut();
    const [question] = questionsFor(onG, H, PLAIN, [FRAMING, PAINT]);
    expect([question.returning, question.guess]).toEqual([true, { 'MASTER H-2': 'MASTER F-2' }]);
    expect(paint(approve(onG, H, [FRAMING, PAINT])).map(row => [row[0], row[3], row[4]])).toEqual([['MASTER F-2', 60, 'Primer on']]);
    expect(paint(approve(onG, H, [FRAMING, PAINT], PLAIN, NEW_WORK)).map(row => [row[0], row[3], row[4]])).toEqual([['MASTER H-2', 0, '']]);
  });

  it('with more than one earlier task of the name it is the same-named question, the earlier ones among the choices; each row to the one he picks', () => {
    const second = 'Paint,Alpha,Lot,11/16/2026,11/20/2026,';
    const onF = hisPaint(approve({ items: [], documents: [] }, F, [FRAMING, PAINT, second]));
    const onG = approve(onF, G, [FRAMING]);
    const [question] = questionsFor(onG, H, PLAIN, [FRAMING, PAINT_BACK]);
    expect([question.returning, question.saved.map(item => item.id), question.rows.map(row => row.id), question.guess]).toEqual([true, ['MASTER F-2', 'MASTER F-3'], ['MASTER H-2'], { 'MASTER H-2': null }]);
    const onH = approve(onG, H, [FRAMING, PAINT_BACK], PLAIN, () => ({ 'MASTER F-3': 'MASTER H-2' }));
    expect(shown(onH).filter(item => item.taskName === 'Paint').map(item => item.revisedFromTaskIds)).toEqual([['MASTER F-3']]);
  });

  it('with a Paint still in the list and a second row of the name in the file: the same-named question, with the earlier Paint among the choices and marked as earlier', () => {
    const second = 'Paint,Alpha,Lot,11/16/2026,11/20/2026,';
    const onF = hisPaint(approve({ items: [], documents: [] }, F, [FRAMING, PAINT, second]), 60);
    const onG = approve(onF, G, [FRAMING, second]);
    expect(shown(onG).filter(item => item.taskName === 'Paint').map(item => item.id)).toEqual(['MASTER F-3']);
    const [question] = questionsFor(onG, H, PLAIN, [FRAMING, second, PAINT_BACK]);
    expect([question.returning, question.title, question.saved.map(item => item.id), question.earlierIds]).toEqual([undefined, '2 tasks named Paint in Lot — confirm which is which', ['MASTER F-2', 'MASTER F-3'], ['MASTER F-2']]);
    const wording = scheduleImportPairingWording(question);
    expect([wording.savedTitle(question.saved[0], 0).slice(0, 14), wording.savedTitle(question.saved[1], 1).slice(0, 13)]).toEqual(['Earlier Paint ', 'Saved Paint 2']);
    // Confirmed as guessed: the Paint in the list stays itself, and the earlier one is not brought back.
    const asGuessed = approve(onG, H, [FRAMING, second, PAINT_BACK]);
    expect(shown(asGuessed).filter(item => item.taskName === 'Paint').map(item => [item.startDate, item.percentComplete]).sort()).toEqual([['11/09/2026', 0], ['11/16/2026', 60]]);
    // He says the new row is the earlier Paint: it comes back with his 60%.
    const picked = approve(onG, H, [FRAMING, second, PAINT_BACK], PLAIN, () => ({ 'MASTER F-2': 'MASTER H-3' }));
    expect(shown(picked).filter(item => item.taskName === 'Paint').map(item => [item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []]).sort())
      .toEqual([['11/09/2026', 60, ['MASTER F-2']], ['11/16/2026', 60, []]]);
  });

  it('not asked: a task still in the list that a master moves (one row, one task); a name that was never on a schedule; a lookahead', () => {
    const onF = hisPaint(approve({ items: [], documents: [] }, F, [FRAMING, PAINT]));
    expect(questionsFor(onF, G, PLAIN, [FRAMING, PAINT_BACK])).toEqual([]);
    expect(questionsFor(paintLeftOut(), H, PLAIN, [FRAMING, 'Siding,Alpha,Lot,11/09/2026,11/13/2026,'])).toEqual([]);
    const onG = paintLeftOut();
    expect(scheduleImportReviewPairingQuestions({ saved: onG.items, documents: onG.documents, importBatchId: 'batch-L', imported: rowsOf(schedule('L', H.importedAt as string), PLAIN, [PAINT_BACK]), overlay: true })).toEqual([]);
  });
});

describe('S2 item 1: which row a task that left is, when masters had moved it', () => {
  const PAINT_3 = 'Paint,Alpha,Lot,11/23/2026,11/27/2026,';
  const J = schedule('MASTER J', '2026-10-05T12:00:00.000Z');
  const setActive = (state: State, document: ReferenceDocument): State => ({ ...state, documents: scheduleDocumentsAfterActivation(document, state.documents, 'project') });
  const percentOn = (state: State, id: string, percent: number): State => ({ ...state, items: state.items.map(item => (item.id === id
    ? { ...item, percentComplete: percent, progressSource: 'project_manager', progressConfirmedAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-15T12:00:00.000Z' } as ScheduleItem : item)) });
  /** F lists Paint (his 60%); G moves it, and he enters 80% on G's row. */
  const movedByG = (header = PLAIN): State => {
    const ids = (lines: string[], numbers: number[]) => (header === WITH_IDS ? withIds(lines, numbers) : lines);
    const onF = hisPaint(approve({ items: [], documents: [] }, F, ids([FRAMING, PAINT], [1, 2]), header));
    return percentOn(approve(onF, G, ids([FRAMING, PAINT_BACK], [1, 2]), header), 'MASTER G-2', 80);
  };

  it('a task Set Active put back on its older row is a task shown: the newer row it is hidden behind is never offered as an earlier task', () => {
    const onF = setActive(movedByG(), F);
    expect(paint(onF).map(row => [row[0], row[3]])).toEqual([['MASTER F-2', 60]]);
    // A master with two Paints: the same-named question, with the Paint he sees and nothing "earlier" beside it.
    const [question, ...others] = questionsFor(onF, H, PLAIN, [FRAMING, PAINT_3, 'Paint,Alpha,Lot,11/16/2026,11/20/2026,']);
    expect([others, question.returning, question.saved.map(item => item.id), question.earlierIds]).toEqual([[], undefined, ['MASTER F-2'], undefined]);
  });

  it.each([['with Unique IDs', WITH_IDS], ['without', PLAIN]])('moved by two masters in turn (G, then H after Set Active back to F) and then left out: one earlier task, the row the list last showed (%s)', (_name, header) => {
    const ids = (lines: string[], numbers: number[]) => (header === WITH_IDS ? withIds(lines, numbers) : lines);
    const onH = approve(setActive(movedByG(header), F), H, ids([FRAMING, PAINT_3], [1, 2]), header);
    expect(paint(onH).map(row => [row[0], row[1]])).toEqual([['MASTER H-2', ['MASTER F-2']]]);
    const onI = approve(onH, I, ids([FRAMING], [1]), header);
    const again = ids([FRAMING, 'Paint,Alpha,Lot,12/07/2026,12/11/2026,'], [1, 2]);
    // Two rows answer to F's (G's and H's): the task is offered once, on H's row, not as two earlier Paints.
    expect(questionsFor(onI, J, header, again).map(question => [question.returning, question.saved.map(item => item.id)])).toEqual(header === WITH_IDS ? [] : [[true, ['MASTER H-2']]]);
    expect(paint(approve(onI, J, again, header, SAME_TASK)).map(row => [row[0], row[1], row[3], row[4]])).toEqual([['MASTER J-2', ['MASTER F-2', 'MASTER H-2'], 60, 'Primer on']]);
  });

  it.each([['with Unique IDs', WITH_IDS], ['without', PLAIN]])('the row no row answers to is the task\'s last, whatever the clocks said: G approved on a device a week behind still gives back his 80%% (%s)', (_name, header) => {
    const ids = (lines: string[], numbers: number[]) => (header === WITH_IDS ? withIds(lines, numbers) : lines);
    const onG = movedByG(header);
    const behind: State = { ...onG, items: onG.items.map(item => (item.id.startsWith('MASTER G-') ? { ...item, importedAt: '2026-09-06T12:00:00.000Z' } : item)) };
    expect(paint(behind).map(row => [row[0], row[3]])).toEqual([['MASTER G-2', 80]]);
    const onH = approve(behind, H, ids([FRAMING], [1]), header);
    const again = ids([FRAMING, 'Paint,Alpha,Lot,12/07/2026,12/11/2026,'], [1, 2]);
    expect(questionsFor(onH, I, header, again).map(question => question.saved.map(item => [item.id, item.percentComplete]))).toEqual(header === WITH_IDS ? [] : [[['MASTER G-2', 80]]]);
    // (By the import time alone it was F's row: 60%, under the 80% he had entered.)
    expect(paint(approve(onH, I, again, header, SAME_TASK)).map(row => [row[0], row[1], row[3]])).toEqual([['MASTER I-2', ['MASTER F-2', 'MASTER G-2'], 80]]);
  });
});
