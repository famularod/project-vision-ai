/**
 * The owner's answer to question 47 (13 Oct 2026), "47 A"; the schedules
 * reviewer's P1-8 (Medium, older, every time).
 *
 * A newer master turned a task High (the file marks it Critical, or its
 * finish comes within the week) only when it also MOVED the task: the moved
 * task gets a new row, and the new row holds the file's priority. A task the
 * master left on its dates is the same row, and nothing looked at its
 * priority: Critical in the file, Medium in the app.
 *
 * Decided: the task is turned High in both cases, unless he set that task's
 * priority himself (his always stays). It never lowers a priority. The rule
 * for "High" is the file reader's own, read off the imported row: there is no
 * second one. A lookahead's approval is as it was.
 *
 * Here: the rule on the records alone (the phone's approval and the desktop's
 * upload are this one merge), and the two places where two copies of a row
 * are weighed. Two devices with one cloud are in
 * review-n2-sched-typed-text-carried-between-devices. Synthetic data.
 */
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemWholeCopyAgainstCloud, scheduleItemWholeCopyBase, scheduleItemWholeCopyOverCloud } from '../../services/ScheduleItemEditBase';
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
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete,Critical';
const START = Date.parse('2026-06-01T12:00:00.000Z');
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
/** The merge as the phone's approval calls it (App.tsx); `more` is what the desktop's upload or a lookahead adds. */
function merged(state: State, source: ReferenceDocument, lines: string[], more: Record<string, unknown> = {}) {
  return mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...more,
  });
}
/** Approving a master on the phone: the merge, then the master is made current. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const result = merged(state, source, lines);
  return {
    items: reconcileDAVEScheduleRecords([...result.additions, ...result.next]),
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A lookahead approved on the phone: it adds to the master and is in effect beside it. */
function approveLookahead(state: State, source: ReferenceDocument, lines: string[]): State {
  const result = merged(state, source, lines, { overlay: true });
  return { items: reconcileDAVEScheduleRecords([...result.additions, ...result.next]), documents: [...state.documents, source] };
}
/** His edit of a task's priority as the phone saves it (App.tsx hands every task edit to this helper first), made at `at`. */
function sets(state: State, id: string, priority: ScheduleItem['priority'], at = '2026-06-03T09:05:00.000Z'): State {
  const current = state.items.find(item => item.id === id)!;
  jest.setSystemTime(Date.parse(at));
  const change = withProjectControlsEditMerged(current, { priority });
  jest.setSystemTime(START);
  return { ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item)) };
}
/** Set Active on the phone; the desktop's Make Current calls the same helper. */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const documents = scheduleDocumentsAfterActivation(target, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
/** A row as a build before Build 231 saved it: no word of what its own import gave it. */
const savedBefore = (state: State): State => ({ ...state, items: state.items.map(item => { const { priorityAsImported: _own, ...rest } = item; return rest as ScheduleItem; }) });
/** What a task shows and what its row says of it: the priority, the row's own-import word, whether it is his, whether a mark says so. */
const reads = (item: ScheduleItem) => [item.priority, item.priorityAsImported, schedulePriorityIsHis(item), Boolean(schedulePriorityHeSet(item))];

jest.useFakeTimers({ now: START });
afterAll(() => { jest.useRealTimers(); });
afterEach(() => { jest.setSystemTime(START); });

// F is imported long before the tasks are due: each row's own priority is Medium.
const F = schedule('MASTER F', '2026-06-01T12:00:00.000Z');
// G is imported on the day Framing is due to finish: the file reader gives Framing's row High, moved or not.
const G = schedule('MASTER G', '2026-10-11T12:00:00.000Z');
// H is imported the next day.
const H = schedule('MASTER H', '2026-10-12T12:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,,';
const FRAMING_MOVED_NEAR = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,,';
const FRAMING_MOVED_FAR = 'Framing,Alpha,Lot,11/05/2026,11/15/2026,,';
const ROOF = 'Roof,Alpha,Lot,11/13/2026,11/21/2026,,';
const ROOF_CRITICAL = 'Roof,Alpha,Lot,11/13/2026,11/21/2026,,Yes';
const ROOF_MOVED = 'Roof,Alpha,Lot,11/20/2026,11/28/2026,,';
const ROOF_MOVED_CRITICAL = 'Roof,Alpha,Lot,11/20/2026,11/28/2026,,Yes';
const PAINT = 'Paint,Alpha,Lot,12/01/2026,12/10/2026,,';

const onF = approve(EMPTY, F, [FRAMING, ROOF, PAINT]);
const framingF = one(onF, 'Framing').id;
const roofF = one(onF, 'Roof').id;
const paintF = one(onF, 'Paint').id;

describe('Q47: what the file reader gives each row (the one rule for High; not changed)', () => {
  it('Medium far from its finish; High when the file marks it Critical, or the finish is within a week of the import', () => {
    expect(shown(onF).map(item => [item.taskName, ...reads(item)])).toEqual([
      ['Framing', 'Medium', 'Medium', false, false], ['Roof', 'Medium', 'Medium', false, false], ['Paint', 'Medium', 'Medium', false, false],
    ]);
    expect(rows(G, [FRAMING, ROOF, ROOF_CRITICAL, PAINT]).map(item => item.priority)).toEqual(['High', 'Medium', 'High', 'Medium']);
  });
});

describe('Q47: a newer master that leaves the task on its dates', () => {
  it('the file now marks it Critical: High, on the same row; the row\'s own-import word says High and nothing says it is his', () => {
    const onH = approve(onF, H, [FRAMING_MOVED_FAR, ROOF_CRITICAL, PAINT]);
    const roof = one(onH, 'Roof');
    expect([roof.id, roof.startDate, roof.finishDate]).toEqual([roofF, '11/13/2026', '11/21/2026']);
    expect(reads(roof)).toEqual(['High', 'High', false, false]);
    expect([schedulePriorityIsItsImports(roof), roof.textFromTask, roof.prioritySetByHand]).toEqual([true, undefined, undefined]);
  });

  it('its finish has come within the week of the new master: High, on the same row', () => {
    const onG = approve(onF, G, [FRAMING, ROOF, PAINT]);
    const framing = one(onG, 'Framing');
    expect([framing.id, ...reads(framing)]).toEqual([framingF, 'High', 'High', false, false]);
  });

  it('the same ending as when the master moves the task (which is how it was already)', () => {
    const left = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const moved = approve(onF, G, [FRAMING_MOVED_NEAR, ROOF_MOVED_CRITICAL, PAINT]);
    expect([one(moved, 'Framing').id === framingF, one(moved, 'Roof').id === roofF]).toEqual([false, false]);
    expect(['Framing', 'Roof', 'Paint'].map(name => one(left, name).priority)).toEqual(['Framing', 'Roof', 'Paint'].map(name => one(moved, name).priority));
    expect(['Framing', 'Roof', 'Paint'].map(name => one(left, name).priority)).toEqual(['High', 'High', 'Medium']);
  });

  it('a task the file neither marks nor lists near its finish keeps its priority, and nothing of its priority is written', () => {
    const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const paint = one(onG, 'Paint');
    expect([paint.id, ...reads(paint), paint.updatedAt]).toEqual([paintF, 'Medium', 'Medium', false, false, one(onF, 'Paint').updatedAt]);
  });

  it('a task saved before rows kept their import\'s word (Build 230 and earlier): a Medium is raised, and the row now keeps the word', () => {
    const onG = approve(savedBefore(onF), G, [FRAMING, ROOF_CRITICAL, PAINT]);
    expect([reads(one(onG, 'Framing')), reads(one(onG, 'Roof')), one(onG, 'Paint').priority]).toEqual([['High', 'High', false, false], ['High', 'High', false, false], 'Medium']);
  });

  it('the same master approved a second time changes nothing', () => {
    const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const again = merged(onG, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    expect([again.additions, again.next.filter((item, index) => item !== onG.items[index])]).toEqual([[], []]);
  });
});

describe('Q47: a priority he set himself always stays, moved or not', () => {
  const kept = (state: State, lines: string[], name: string) => one(approve(state, G, lines), name);

  it('he set Low; the file marks the task Critical and leaves it on its dates: Low, his, on the same row', () => {
    const roof = kept(sets(onF, roofF, 'Low'), [FRAMING, ROOF_CRITICAL, PAINT], 'Roof');
    expect([roof.id, ...reads(roof)]).toEqual([roofF, 'Low', 'Medium', true, true]);
  });

  it('he set Low; the finish comes within the week and the master leaves it on its dates: Low', () => {
    expect(reads(kept(sets(onF, framingF, 'Low'), [FRAMING, ROOF, PAINT], 'Framing'))).toEqual(['Low', 'Medium', true, true]);
  });

  it('he set Low and later Medium, which is also what the file first gave: the Medium is his, and stays under a Critical mark', () => {
    const his = sets(sets(onF, roofF, 'Low'), roofF, 'Medium', '2026-06-04T09:00:00.000Z');
    expect(reads(kept(his, [FRAMING, ROOF_CRITICAL, PAINT], 'Roof'))).toEqual(['Medium', 'Medium', true, true]);
  });

  it('a Low on a task saved before rows kept their import\'s word (no import gives a Low): his, and it stays', () => {
    const before = savedBefore(onF);
    const his: State = { ...before, items: before.items.map(item => (item.id === roofF ? { ...item, priority: 'Low' } as ScheduleItem : item)) };
    expect(kept(his, [FRAMING, ROOF_CRITICAL, PAINT], 'Roof').priority).toBe('Low');
  });

  it('a priority that followed the task to this row from an earlier one (the row says it took it): stays when the next master leaves the task there', () => {
    const onG = approve(sets(onF, roofF, 'Low'), G, [FRAMING, ROOF_MOVED, PAINT]);
    expect(one(onG, 'Roof').textFromTask).toMatchObject({ taskId: roofF, priority: 'Low' });
    expect(one(approve(onG, H, [FRAMING, ROOF_MOVED_CRITICAL, PAINT]), 'Roof').priority).toBe('Low');
  });

  it('and when the master moves the task: his stays too (as it was already)', () => {
    expect(kept(sets(onF, roofF, 'Low'), [FRAMING, ROOF_MOVED_CRITICAL, PAINT], 'Roof').priority).toBe('Low');
    expect(kept(sets(onF, framingF, 'Low'), [FRAMING_MOVED_NEAR, ROOF, PAINT], 'Framing').priority).toBe('Low');
  });
});

describe('Q47: it never lowers a priority', () => {
  it('raised by one master\'s Critical mark; the next master lists it on the same dates with no mark: still High', () => {
    const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const onH = approve(onG, H, [FRAMING, ROOF, PAINT]);
    expect([one(onH, 'Roof').id, ...reads(one(onH, 'Roof'))]).toEqual([roofF, 'High', 'High', false, false]);
  });

  it('a High he set himself on a task the file does not mark: still High, and still his', () => {
    const onG = approve(sets(onF, roofF, 'High'), G, [FRAMING, ROOF, PAINT]);
    expect(reads(one(onG, 'Roof'))).toEqual(['High', 'Medium', true, true]);
  });
});

describe('Q47: the High the app gave is the file\'s word, not his', () => {
  const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);

  it('the next master moves the task and marks nothing: the new row holds its own file\'s priority, exactly as for a task whose High came with a move', () => {
    const afterLeft = approve(onG, H, [FRAMING_MOVED_FAR, ROOF_MOVED, PAINT]);
    const afterMoved = approve(approve(onF, G, [FRAMING_MOVED_NEAR, ROOF_MOVED_CRITICAL, PAINT]), H, [FRAMING_MOVED_FAR, 'Roof,Alpha,Lot,11/27/2026,12/05/2026,,', PAINT]);
    expect([one(afterLeft, 'Framing').priority, one(afterLeft, 'Roof').priority]).toEqual([one(afterMoved, 'Framing').priority, one(afterMoved, 'Roof').priority]);
    expect([one(afterLeft, 'Framing').priority, one(afterLeft, 'Roof').priority]).toEqual(['Medium', 'Medium']);
  });

  it('he then lowers it himself: that is his, and it stays when the next master marks the task Critical again', () => {
    const lowered = sets(onG, roofF, 'Medium', '2026-10-11T15:00:00.000Z');
    expect(reads(one(lowered, 'Roof'))).toEqual(['Medium', 'High', true, true]);
    expect(reads(one(approve(lowered, H, [FRAMING, ROOF_CRITICAL, PAINT]), 'Roof'))).toEqual(['Medium', 'High', true, true]);
  });
});

describe('Q47: Set Active back to the older master and forward again', () => {
  it('the task stays High each way, the switches write nothing on its row, and nothing makes it his', () => {
    const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const back = setActive(onG, F, '2026-10-12T08:00:00.000Z');
    const forward = setActive(back, G, '2026-10-13T08:00:00.000Z');
    const row = (state: State, id: string) => state.items.find(item => item.id === id)!;
    expect([one(onG, 'Roof'), one(back, 'Roof'), one(forward, 'Roof')].map(item => [item.id, ...reads(item)])).toEqual(Array(3).fill([roofF, 'High', 'High', false, false]));
    expect([one(onG, 'Framing'), one(back, 'Framing'), one(forward, 'Framing')].map(item => [item.id, ...reads(item)])).toEqual(Array(3).fill([framingF, 'High', 'High', false, false]));
    expect([row(back, roofF), row(forward, roofF), row(back, framingF), row(forward, framingF)]).toEqual([row(onG, roofF), row(onG, roofF), row(onG, framingF), row(onG, framingF)]);
  });

  it('his own priority under the same switches: his each way', () => {
    const onG = approve(sets(onF, roofF, 'Low'), G, [FRAMING, ROOF_CRITICAL, PAINT]);
    const forward = setActive(setActive(onG, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z');
    expect(reads(one(forward, 'Roof'))).toEqual(['Low', 'Medium', true, true]);
  });
});

describe('Q47: the desktop\'s upload (the same merge, the master not yet made current)', () => {
  it('the task left on its dates is raised at the upload, as the file\'s percent is taken on such a row; his own priority stays', () => {
    const plan = merged(sets(onF, roofF, 'Low'), G, [FRAMING, ROOF_CRITICAL, PAINT], { current: false });
    const row = (id: string) => plan.next.find(item => item.id === id)!;
    expect([plan.additions, reads(row(framingF)), reads(row(roofF)), reads(row(paintF))]).toEqual([
      [], ['High', 'High', false, false], ['Low', 'Medium', true, true], ['Medium', 'Medium', false, false],
    ]);
  });
});

describe('Q47: left as it was', () => {
  it('a lookahead\'s approval: a task the master has keeps its priority, whether the lookahead moves it or not, marks it or not; a task the lookahead adds holds its file\'s', () => {
    const L = schedule('LOOKAHEAD L', '2026-10-11T12:00:00.000Z', 'lookahead');
    const onL = approveLookahead(onF, L, [FRAMING, 'Roof,Alpha,Lot,10/13/2026,10/16/2026,,Yes', 'Punch list,Alpha,Lot,10/12/2026,10/14/2026,,']);
    expect(['Framing', 'Roof', 'Paint', 'Punch list'].map(name => one(onL, name).priority)).toEqual(['Medium', 'Medium', 'Medium', 'High']);
    expect([one(onL, 'Framing').id, one(onL, 'Roof').id]).toEqual([framingF, roofF]);
  });

  it('a task he entered by hand: no master changes its priority, on its dates or moved (he chose it when he made the task)', () => {
    const hand = { id: 'hand-1', projectName: 'Alpha', locationName: 'Lot', taskName: 'Inspection', startDate: '10/08/2026', finishDate: '10/11/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '', createdAt: '2026-06-02T08:00:00.000Z' } as unknown as ScheduleItem;
    const withHand: State = { ...onF, items: [...onF.items, hand] };
    const left = approve(withHand, G, [FRAMING, ROOF, PAINT, 'Inspection,Alpha,Lot,10/08/2026,10/11/2026,,Yes']);
    const moved = approve(withHand, G, [FRAMING, ROOF, PAINT, 'Inspection,Alpha,Lot,10/09/2026,10/12/2026,,Yes']);
    expect([one(left, 'Inspection').id, one(left, 'Inspection').priority, one(moved, 'Inspection').id, one(moved, 'Inspection').priority]).toEqual(['hand-1', 'Medium', 'hand-1', 'Medium']);
  });
});

describe('Q47: two copies of the row are put together (a sync); a priority the app raised is never asked about', () => {
  const onG = approve(onF, G, [FRAMING, ROOF_CRITICAL, PAINT]);
  const before = onF.items.find(item => item.id === roofF)!;
  const raised = onG.items.find(item => item.id === roofF)!;
  /** His Low on the row as another device left it in the cloud, from the row as it was before the master. */
  const hisLow = sets(onF, roofF, 'Low', '2026-10-11T09:00:00.000Z').items.find(item => item.id === roofF)!;

  it('the approving device\'s copy against the cloud\'s row, where he set Low meanwhile on another device: his Low stands and nothing is asked', () => {
    const weighed = scheduleItemWholeCopyAgainstCloud(raised, raised, scheduleItemWholeCopyBase(before), hisLow);
    expect([weighed.asked, weighed.itemData.priority, schedulePriorityIsHis(weighed.itemData), weighed.itemData.prioritySetByHand]).toEqual([[], 'Low', true, hisLow.prioritySetByHand]);
  });

  it('...and where nobody touched it: the raise goes up', () => {
    const weighed = scheduleItemWholeCopyAgainstCloud(raised, raised, scheduleItemWholeCopyBase(before), before);
    expect([weighed.asked, ...reads(weighed.itemData)]).toEqual([[], 'High', 'High', false, false]);
  });

  it('his Low waiting on a device that had not heard, against the cloud\'s row the master raised: his Low goes up and nothing is asked', () => {
    const fields = ['priority', 'prioritySetByHand', 'updatedAt'];
    const weighed = scheduleItemEditAgainstCloud(hisLow, fields, scheduleItemEditBase(before, fields), raised);
    expect([weighed.asked, weighed.keptFromCloud, weighed.itemData.priority]).toEqual([[], [], 'Low']);
  });

  // The schedules reviewer's P2-4, as it would meet this rule: his priority reads as the copy the other side started
  // from, so "nobody changed it". The mark his edit left says it is his.
  it('he set Low and then Medium again on the other device (the row reads as it did, with his mark): his Medium stands over the raise, both ways round, and nothing is asked', () => {
    const hisMedium = sets(sets(onF, roofF, 'Low', '2026-10-11T09:00:00.000Z'), roofF, 'Medium', '2026-10-11T09:30:00.000Z').items.find(item => item.id === roofF)!;
    expect(reads(hisMedium)).toEqual(['Medium', 'Medium', true, true]);
    const copy = scheduleItemWholeCopyAgainstCloud(raised, raised, scheduleItemWholeCopyBase(before), hisMedium);
    expect([copy.asked, copy.itemData.priority, schedulePriorityIsHis(copy.itemData), copy.itemData.prioritySetByHand]).toEqual([[], 'Medium', true, hisMedium.prioritySetByHand]);
    const fields = ['priority', 'prioritySetByHand', 'updatedAt'];
    const edit = scheduleItemEditAgainstCloud(hisMedium, fields, scheduleItemEditBase(before, fields), raised);
    expect([edit.asked, edit.keptFromCloud, edit.itemData.priority]).toEqual([[], [], 'Medium']);
  });

  it('the row\'s word goes with the High wherever one copy takes it from the other, so it never reads as his: the raise onto the cloud\'s row, and the cloud\'s raise onto a copy waiting here', () => {
    // The cloud's row was changed meanwhile for something else (a note), and the sync's merge took it whole.
    const noted = { ...before, notes: 'Crew short Tuesday', updatedAt: '2026-10-11T13:00:00.000Z' } as ScheduleItem;
    const up = scheduleItemWholeCopyAgainstCloud(noted, raised, scheduleItemWholeCopyBase(before), noted);
    expect([up.asked, ...reads(up.itemData), up.itemData.notes]).toEqual([[], 'High', 'High', false, false, 'Crew short Tuesday']);
    // The other way round: this device's whole copy left the priority as it was; the cloud's row was raised by a master approved elsewhere.
    const down = scheduleItemWholeCopyAgainstCloud(noted, noted, scheduleItemWholeCopyBase(before), raised);
    expect([down.asked, ...reads(down.itemData)]).toEqual([[], 'High', 'High', false, false]);
    // ...and as that waiting copy is shown over the cloud's row meanwhile.
    expect(reads(scheduleItemWholeCopyOverCloud(noted, scheduleItemWholeCopyBase(before), raised))).toEqual(['High', 'High', false, false]);
  });

  it('two priorities he set himself on two devices are still asked about (as before)', () => {
    const hisHigh = sets(onF, roofF, 'High', '2026-10-11T10:00:00.000Z').items.find(item => item.id === roofF)!;
    const fields = ['priority', 'prioritySetByHand', 'updatedAt'];
    expect(scheduleItemEditAgainstCloud(hisLow, fields, scheduleItemEditBase(before, fields), hisHigh).asked).toEqual(['priority']);
    expect(scheduleItemWholeCopyAgainstCloud(hisHigh, hisHigh, scheduleItemWholeCopyBase(before), hisLow).asked).toEqual(['priority']);
  });
});
