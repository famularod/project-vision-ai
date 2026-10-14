/**
 * The owner's answer to question 51 (13 Oct 2026): A. Review pass 4 of the
 * Build 232 round, C-1 (Medium, caused by the owner's answer to question 47
 * as built, e81cd19c).
 *
 * A row saved before Build 231 keeps no word of what its import gave it
 * (priorityAsImported) and no mark of his edit (prioritySetByHand): both came
 * with Build 231. A Medium on such a row can be the file's or his own, and
 * the app cannot tell (schedulePriorityIsHis). So: a task came in from a
 * schedule file as High on Build 230 or older; still before Build 231 he set
 * it to Medium; a newer master lists it on the same dates and its file reads
 * High for it again: the task reads High again, nothing asked. Build 231
 * kept his Medium.
 *
 * Asked (question 51): A, the rule of question 47 applies to every task, and
 * that task goes High once more, which he sets back once and it then stays;
 * or B, a master that leaves a task on its dates raises it only where the
 * row is KNOWN to hold its own import's priority, so nothing saved before
 * Build 231 is raised without a move. Answered: A. Nothing is changed in the
 * app for it: these tests state the rule as it stands, each one named for
 * what answer B would have turned round.
 *
 * Here: the phone's approval (the merge as App.tsx calls it) and the
 * desktop's upload (its own plan, planDAVEWebScheduleImport). Synthetic data.
 */
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { schedulePriorityHeSet, schedulePriorityIsHis, schedulePriorityIsItsImports } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const one = (state: State, name: string) => {
  const found = shown(state).filter(item => item.taskName === name);
  expect(found).toHaveLength(1);
  return found[0];
};
const row = (state: State, id: string) => state.items.find(item => item.id === id)!;
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete,Critical';
const START = Date.parse('2026-10-01T12:00:00.000Z');
/** The file's rows as the import reads them ON THE DAY OF THE IMPORT: that is when the file reader works out a row's priority. */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  jest.setSystemTime(Date.parse(source.importedAt as string));
  try {
    return (normalizeScheduleImport({
      contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName,
      mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
    }).items as ScheduleItem[]).map((item, index) => ({
      ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
    }));
  } finally { jest.setSystemTime(START); }
}
/** Approving a master on the phone or the iPad: the merge as App.tsx calls it, then the master is made current. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const result = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string,
  });
  return {
    items: reconcileDAVEScheduleRecords([...result.additions, ...result.next]),
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** Uploading a master on the desktop: its own plan's new rows and revised tasks saved, the file saved and NOT current. */
function upload(state: State, source: ReferenceDocument, lines: string[]): State {
  const file = { ...source, isCurrent: false, webFileFingerprint: 'w'.repeat(64) } as ReferenceDocument;
  const cloud = (item: ScheduleItem) => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }) as DAVEWebScheduleItem;
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown(state).map(cloud), knownScheduleItems: state.items.map(cloud) }, importedScheduleItems: rows(source, lines) });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  return { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, file] };
}
/** His edit of a task's priority as the phone saves it ON BUILD 231 OR LATER (App.tsx hands every task edit to this helper first): it leaves his mark. */
function sets(state: State, id: string, priority: ScheduleItem['priority'], at: string): State {
  jest.setSystemTime(Date.parse(at));
  const change = withProjectControlsEditMerged(row(state, id), { priority });
  jest.setSystemTime(START);
  return { ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item)) };
}
/** The rows as Build 230 or older saved them: no word of what the import gave, no mark; `change` is what he did to one of them on that build. */
function savedBy230(state: State, change: (item: ScheduleItem) => ScheduleItem = item => item): State {
  return { ...state, items: state.items.map(item => {
    const { priorityAsImported: _word, prioritySetByHand: _mark, ...rest } = item;
    return change(rest as ScheduleItem);
  }) };
}
/** A priority set on Build 230 or older: the value alone, nothing beside it. */
const setOn230 = (name: string, priority: ScheduleItem['priority']) => (item: ScheduleItem) => (item.taskName === name ? { ...item, priority } : item);
/** What a task shows and what its row says of it: the priority, the row's own-import word, whether it is his, whether a mark says so. */
const reads = (item: ScheduleItem) => [item.priority, item.priorityAsImported, schedulePriorityIsHis(item), Boolean(schedulePriorityHeSet(item))];

jest.useFakeTimers({ now: START });
afterAll(() => { jest.useRealTimers(); });
afterEach(() => { jest.setSystemTime(START); });

// F is imported on 8 Oct, on Build 230 or older: Survey's finish (14 Oct) is 6 days off, so its file's row reads High;
// Framing (25 Oct) reads Medium. N (9 Oct), P (10 Oct) and Q (11 Oct) list both on the same dates: Survey High again.
const F = schedule('MASTER F', '2026-10-08T12:00:00.000Z');
const N = schedule('MASTER N', '2026-10-09T12:00:00.000Z');
const P = schedule('MASTER P', '2026-10-10T12:00:00.000Z');
const Q = schedule('MASTER Q', '2026-10-11T12:00:00.000Z');
const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,,';
const SURVEY_MOVED = 'Survey,Alpha,Lot,10/13/2026,10/15/2026,,';
const FRAMING = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,,';
const FRAMING_CRITICAL = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,,Yes';

const onF = approve(EMPTY, F, [SURVEY, FRAMING]);
const surveyF = one(onF, 'Survey').id;
const framingF = one(onF, 'Framing').id;
/** As Build 230 saved them, Survey lowered by him from the file's High to Medium on that build. */
const hisMediumOn230 = savedBy230(onF, setOn230('Survey', 'Medium'));

describe('Q51: the rows, and what the app can tell of a priority set before Build 231', () => {
  it('the first import gave Survey High and Framing Medium (Build 231 and later keep that word on the row)', () => {
    expect([reads(one(onF, 'Survey')), reads(one(onF, 'Framing'))]).toEqual([['High', 'High', false, false], ['Medium', 'Medium', false, false]]);
  });

  it('as Build 230 saved them, with his Medium on Survey: no word, no mark, and his Medium cannot be told from a file\'s (not his, not known as its import\'s)', () => {
    const survey = row(hisMediumOn230, surveyF);
    expect([survey.priority, survey.priorityAsImported, survey.prioritySetByHand]).toEqual(['Medium', undefined, undefined]);
    expect([schedulePriorityIsHis(survey), schedulePriorityIsItsImports(survey)]).toEqual([false, false]);
    // A Low is told: no import gives one.
    expect(schedulePriorityIsHis(row(savedBy230(onF, setOn230('Survey', 'Low')), surveyF))).toBe(true);
  });
});

describe.each([
  ['the phone\'s approval', approve],
  ['the desktop\'s upload', upload],
] as const)('Q51, answered A: a newer master that leaves the task on its dates, by %s', (_road, road) => {
  // Answer B would have turned this one round: Medium kept.
  it('ANSWER A (B: kept Medium): a Medium he chose before Build 231 on a task its file had given High goes High once more, on the same row, nothing saying it is his', () => {
    const after = road(hisMediumOn230, N, [SURVEY, FRAMING]);
    expect([row(after, surveyF).id, ...reads(row(after, surveyF))]).toEqual([surveyF, 'High', 'High', false, false]);
    expect(row(after, framingF).priority).toBe('Medium');
  });

  // Answer B would have turned this one round too: left Medium until a master moves the task.
  it('ANSWER A (B: left Medium): a Medium that was never his, on a row saved before Build 231, is raised when the file marks the task Critical', () => {
    const after = road(savedBy230(onF), N, [SURVEY, FRAMING_CRITICAL]);
    expect(reads(row(after, framingF))).toEqual(['High', 'High', false, false]);
  });

  it('the same under either answer: a Medium he sets on Build 231 or later is kept (his edit left its mark)', () => {
    const his = sets(onF, surveyF, 'Medium', '2026-10-08T15:00:00.000Z');
    expect(reads(row(his, surveyF))).toEqual(['Medium', 'High', true, true]);
    expect(reads(row(road(his, N, [SURVEY, FRAMING]), surveyF))).toEqual(['Medium', 'High', true, true]);
  });

  it('the same under either answer: a LOW he set before Build 231 is kept (no file gives a Low, so it is known as his)', () => {
    const after = road(savedBy230(onF, setOn230('Survey', 'Low')), N, [SURVEY, FRAMING]);
    expect([row(after, surveyF).priority, schedulePriorityIsHis(row(after, surveyF))]).toEqual(['Low', true]);
  });

  it('the same under either answer, and on Build 231: when the master MOVES that task, its new row holds the file\'s High (older; the reviewer\'s R3)', () => {
    const after = road(hisMediumOn230, N, [SURVEY_MOVED, FRAMING]);
    const moved = after.items.filter(item => item.taskName === 'Survey' && item.id !== surveyF);
    expect(moved).toHaveLength(1);
    expect([moved[0].startDate, moved[0].finishDate, ...reads(moved[0])]).toEqual(['10/13/2026', '10/15/2026', 'High', 'High', false, false]);
    expect(row(after, surveyF).priority).toBe('Medium');
  });

  it('ANSWER A, the way back: he sets it to Medium once more on this build, and the NEXT master that leaves it, and the one after, keep his Medium', () => {
    // N is approved on the phone and raises it; he sets it back that afternoon (the edit of Build 231 or later leaves his mark).
    const raised = approve(hisMediumOn230, N, [SURVEY, FRAMING]);
    expect(reads(one(raised, 'Survey'))).toEqual(['High', 'High', false, false]);
    const setBack = sets(raised, surveyF, 'Medium', '2026-10-09T15:00:00.000Z');
    expect(reads(row(setBack, surveyF))).toEqual(['Medium', 'High', true, true]);
    const afterP = road(setBack, P, [SURVEY, FRAMING]);
    expect([row(afterP, surveyF).id, ...reads(row(afterP, surveyF))]).toEqual([surveyF, 'Medium', 'High', true, true]);
    const afterQ = road(afterP, Q, [SURVEY, FRAMING]);
    expect(reads(row(afterQ, surveyF))).toEqual(['Medium', 'High', true, true]);
    expect(row(afterQ, surveyF).prioritySetByHand).toEqual({ priority: 'Medium', at: '2026-10-09T15:00:00.000Z' });
  });
});
