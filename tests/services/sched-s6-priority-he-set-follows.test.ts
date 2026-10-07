/**
 * Schedule batch S6, item 1 (7 Oct 2026; puts S5 item 1 right). S5 made a
 * task's priority follow it to the row a newer master moves it to, ALWAYS.
 * Its cost: a task David never touched no longer turned High by itself when
 * a master moved it into the coming week, and a file's Critical column no
 * longer raised a task he already has.
 *
 * Decided: only a priority he SET follows the task. A task whose priority he
 * never set takes the new row's priority exactly as before S5 (the file's
 * Critical column, or High when the finish is within a week of the import).
 *
 * How the app tells: every row an import adds keeps what its own import gave
 * it (priorityAsImported). A priority that reads otherwise is his; so is one
 * the row says it took from the task (textFromTask.priority). A row saved
 * before this build keeps neither word: there only a Low is known to be his
 * (no import gives a Low).
 *
 * Here: the rule on the records alone, on every path that puts two rows of a
 * task together. Two devices with one cloud are in
 * review-n2-sched-typed-text-carried-between-devices; the web's edit keeping
 * the row's word is in dave-web-task-editing. Synthetic data.
 */
import { reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords, scheduleItemsTakingCarriedText } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import {
  scheduleItemAgainstItsTask,
  scheduleItemCarriedFieldsToSend,
  scheduleItemEditBase,
  scheduleItemRecordAfterTheSyncWrote,
  scheduleItemTextEditOnRow,
} from '../../services/ScheduleItemEditBase';
import { schedulePriorityIsHis, schedulePriorityIsItsImports, schedulePriorityItsImportGave } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
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
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete,Critical';
/** The file's rows as the import reads them ON THE DAY OF THE IMPORT: that is when a row's own priority is worked out. */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  const clock = Date.now();
  jest.setSystemTime(Date.parse(source.importedAt as string));
  try {
    return (normalizeScheduleImport({
      contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName,
      mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
    }).items as ScheduleItem[]).map((item, index) => ({
      ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
    }));
  } finally { jest.setSystemTime(clock); }
}
/** Approving a master on the phone (App.tsx), which is also the web's upload: the merge, then the master is made current. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A task edit on the phone or the web: the fields given on the saved row, stamped. */
const patch = (state: State, id: string, change: Partial<ScheduleItem>, at: string): State => ({
  ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item)),
});
/** Set Active on the phone; the web's Make Current calls the same helper. */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const documents = scheduleDocumentsAfterActivation(target, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
/** A row as a build before this one saved it: no word of what its import gave it, and (Build 229) none of what it took. */
const savedBefore = (item: ScheduleItem, alsoNoRecord = false): ScheduleItem => {
  const { priorityAsImported: _own, ...rest } = item;
  if (!alsoNoRecord) return (rest.textFromTask ? { ...rest, textFromTask: Object.fromEntries(Object.entries(rest.textFromTask).filter(([field]) => field !== 'priority')) } : rest) as ScheduleItem;
  const { textFromTask: _taken, ...plain } = rest;
  return plain as ScheduleItem;
};
const allSavedBefore = (state: State, alsoNoRecord = false): State => ({ ...state, items: state.items.map(item => savedBefore(item, alsoNoRecord)) });

jest.useFakeTimers({ now: Date.parse('2026-06-01T12:00:00.000Z') });
afterAll(() => { jest.useRealTimers(); });
// F is imported long before the tasks are due: each row's own priority is Medium.
const F = schedule('MASTER F', '2026-06-01T12:00:00.000Z');
// G is imported FOUR DAYS before Framing's new finish: the import marks G's row High.
const G = schedule('MASTER G', '2026-10-11T12:00:00.000Z');
// H is imported the next day and pushes Framing a month out: its row is Medium again.
const H = schedule('MASTER H', '2026-10-12T12:00:00.000Z');
const FRAMING_F = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,,';
const FRAMING_G = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,,';
const FRAMING_H = 'Framing,Alpha,Lot,11/05/2026,11/15/2026,,';
const ROOF = 'Roof,Alpha,Lot,11/13/2026,11/21/2026,,';
const ROOF_MOVED = 'Roof,Alpha,Lot,11/20/2026,11/28/2026,,';
const ROOF_MOVED_CRITICAL = 'Roof,Alpha,Lot,11/20/2026,11/28/2026,,Yes';

const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
const framingF = one(onF, 'Framing').id;
const roofF = one(onF, 'Roof').id;
const set = (state: State, id: string, priority: ScheduleItem['priority'], at = '2026-06-03T09:05:00.000Z') => patch(state, id, { priority }, at);

describe('S6 item 1: how the app tells a priority he set from one the import gave', () => {
  it('every row an import adds keeps what its own import gave it; nothing else is his', () => {
    expect(shown(onF).map(item => [item.taskName, item.priority, item.priorityAsImported])).toEqual([['Framing', 'Medium', 'Medium'], ['Roof', 'Medium', 'Medium']]);
    expect(rows(G, [FRAMING_G, ROOF_MOVED_CRITICAL]).map(item => item.priority)).toEqual(['High', 'High']);
    const framing = one(onF, 'Framing');
    expect([schedulePriorityIsHis(framing), schedulePriorityIsItsImports(framing), schedulePriorityItsImportGave(framing)]).toEqual([false, true, 'Medium']);
    // Set to anything else, it is his; set back to what the import gave, it reads as untouched.
    expect((['Low', 'High', 'Medium'] as const).map(priority => schedulePriorityIsHis({ ...framing, priority }))).toEqual([true, true, false]);
  });

  it('a row saved before this build keeps no such word: only a Low is known to be his, and nothing is known to be the import\'s', () => {
    const old = savedBefore(one(onF, 'Framing'));
    expect((['Low', 'Medium', 'High'] as const).map(priority => schedulePriorityIsHis({ ...old, priority }))).toEqual([true, false, false]);
    expect((['Low', 'Medium', 'High'] as const).map(priority => schedulePriorityIsItsImports({ ...old, priority }))).toEqual([false, false, false]);
    expect(schedulePriorityItsImportGave({ ...old, priority: 'Low' })).toBe('Medium');
    expect([schedulePriorityIsHis(null), schedulePriorityIsItsImports(undefined)]).toEqual([false, false]);
  });
});

describe('S6 item 1: a master that moves a task', () => {
  it('he never touched it and the master moves it into the coming week: it turns High, as before S5', () => {
    const onG = approve(onF, G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    expect([framing.id === framingF, framing.startDate, framing.priority, framing.priorityAsImported]).toEqual([false, '10/05/2026', 'High', 'High']);
    // The row took no priority, and says so by saying nothing: its record names his text only.
    expect(framing.textFromTask).toMatchObject({ taskId: framingF });
    expect(Object.prototype.hasOwnProperty.call(framing.textFromTask, 'priority')).toBe(false);
    // And out of the coming week again with the next master: Medium again.
    expect(one(approve(onG, H, [FRAMING_H, ROOF]), 'Framing').priority).toBe('Medium');
  });

  it('he set it Low and the master moves it into the coming week: it stays Low, and the row says it took it', () => {
    const onG = approve(set(onF, framingF, 'Low'), G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    expect([framing.startDate, framing.priority]).toEqual(['10/05/2026', 'Low']);
    expect(framing.textFromTask).toMatchObject({ taskId: framingF, priority: 'Low' });
    // Nothing is lost: the row still holds what its own file and dates said.
    expect(framing.priorityAsImported).toBe('High');
    // Moved again: still Low.
    expect(one(approve(onG, H, [FRAMING_H, ROOF]), 'Framing').priority).toBe('Low');
  });

  it('the file marks it Critical and he never touched it: Critical wins, however far out the task is', () => {
    const onG = approve(onF, G, [FRAMING_F, ROOF_MOVED_CRITICAL]);
    expect([one(onG, 'Roof').id === roofF, one(onG, 'Roof').priority]).toEqual([false, 'High']);
    // The same row without the mark: Medium.
    expect(one(approve(onF, G, [FRAMING_F, ROOF_MOVED]), 'Roof').priority).toBe('Medium');
  });

  it('he set it and the file says Critical: his stands, and the file\'s word is kept on the row beside it', () => {
    const onG = approve(set(onF, roofF, 'Low'), G, [FRAMING_F, ROOF_MOVED_CRITICAL]);
    expect([one(onG, 'Roof').priority, one(onG, 'Roof').priorityAsImported, one(onG, 'Roof').textFromTask?.priority]).toEqual(['Low', 'High', 'Low']);
  });

  it('he raised a far-off task to High: it stays High when a master moves it, near or far', () => {
    const onG = approve(set(onF, roofF, 'High'), G, [FRAMING_F, ROOF_MOVED]);
    expect([one(onG, 'Roof').priority, one(onG, 'Roof').priorityAsImported]).toEqual(['High', 'Medium']);
  });

  it('the High he set is also what the next row\'s own import gives: still his, and it stays when a later master moves the task far out', () => {
    const onG = approve(set(onF, framingF, 'High'), G, [FRAMING_G, ROOF]);
    expect([one(onG, 'Framing').priority, one(onG, 'Framing').priorityAsImported, one(onG, 'Framing').textFromTask?.priority]).toEqual(['High', 'High', 'High']);
    expect(one(approve(onG, H, [FRAMING_H, ROOF]), 'Framing').priority).toBe('High');
  });

  it('he set it and set it back to what the import gave: untouched again, it takes the new row\'s', () => {
    const back = set(set(onF, framingF, 'Low'), framingF, 'Medium', '2026-06-04T09:00:00.000Z');
    expect(one(approve(back, G, [FRAMING_G, ROOF]), 'Framing').priority).toBe('High');
  });

  it('a priority he sets on the row a master made follows to the next row', () => {
    const onG = approve(onF, G, [FRAMING_G, ROOF]);
    const lowered = set(onG, one(onG, 'Framing').id, 'Medium', '2026-10-11T13:00:00.000Z');
    const onH = approve(lowered, H, ['Framing,Alpha,Lot,10/06/2026,10/16/2026,,', ROOF]);
    expect(rows(H, ['Framing,Alpha,Lot,10/06/2026,10/16/2026,,']).map(item => item.priority)).toEqual(['High']);
    expect(one(onH, 'Framing').priority).toBe('Medium');
  });

  it('a task the master leaves on its dates is the same row, its priority as it was, set or not', () => {
    const onG = approve(set(onF, roofF, 'Low'), G, [FRAMING_F, ROOF]);
    expect([one(onG, 'Framing').id, one(onG, 'Framing').priority, one(onG, 'Roof').id, one(onG, 'Roof').priority]).toEqual([framingF, 'Medium', roofF, 'Low']);
  });

  it('rows saved before this build: a Low he set follows; a Medium or High there cannot be told from the file\'s and takes the new row\'s, as on Build 229', () => {
    const before = allSavedBefore(onF);
    expect(one(approve(set(before, framingF, 'Low'), G, [FRAMING_G, ROOF]), 'Framing').priority).toBe('Low');
    // Never touched: High, as before.
    expect(one(approve(before, G, [FRAMING_G, ROOF]), 'Framing').priority).toBe('High');
    // He had raised Roof to High before this build; the master moves it, still far out: the new row's own Medium.
    expect(one(approve(set(before, roofF, 'High'), G, [FRAMING_F, ROOF_MOVED]), 'Roof').priority).toBe('Medium');
    // From that new row on the app knows: what he sets there follows.
    const onG = approve(before, G, [FRAMING_G, ROOF]);
    expect(one(approve(set(onG, one(onG, 'Framing').id, 'Medium', '2026-10-11T13:00:00.000Z'), H, ['Framing,Alpha,Lot,10/06/2026,10/16/2026,,', ROOF]), 'Framing').priority).toBe('Medium');
  });
});

describe('S6 item 1: Set Active and Make Current, back and forth', () => {
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const framingG = one(onG, 'Framing').id;
  const backOn = (state: State, target: ReferenceDocument, at: string) => one(setActive(state, target, at), 'Framing');

  it('never touched: each master\'s row shows its own priority, as before S5, and the switch saves no priority', () => {
    const onFAgain = setActive(onG, F, '2026-10-12T08:00:00.000Z');
    expect([one(onFAgain, 'Framing').id, one(onFAgain, 'Framing').priority]).toEqual([framingF, 'Medium']);
    const onGAgain = setActive(onFAgain, G, '2026-10-13T08:00:00.000Z');
    expect([one(onGAgain, 'Framing').id, one(onGAgain, 'Framing').priority]).toEqual([framingG, 'High']);
    expect(onGAgain.items.find(item => item.id === framingF)!.priority).toBe('Medium');
  });

  it('he sets it under the newer master: the older master\'s row shows it when that master is made current again', () => {
    const lowered = set(onG, framingG, 'Low', '2026-10-11T13:00:00.000Z');
    expect([backOn(lowered, F, '2026-10-12T08:00:00.000Z').id, backOn(lowered, F, '2026-10-12T08:00:00.000Z').priority]).toEqual([framingF, 'Low']);
  });

  it('he sets it under the older master, made current again: the newer master\'s row shows it when that one is current again, and says it took it', () => {
    const onFAgain = setActive(onG, F, '2026-10-12T08:00:00.000Z');
    const lowered = set(onFAgain, framingF, 'Low', '2026-10-12T09:00:00.000Z');
    const framing = backOn(lowered, G, '2026-10-13T08:00:00.000Z');
    expect([framing.id, framing.priority, framing.textFromTask?.priority]).toEqual([framingG, 'Low', 'Low']);
    // Round again: nothing more to bring.
    const round = setActive(setActive(setActive(lowered, G, '2026-10-13T08:00:00.000Z'), F, '2026-10-14T08:00:00.000Z'), G, '2026-10-15T08:00:00.000Z');
    expect([one(round, 'Framing').priority, round.items.find(item => item.id === framingF)!.priority]).toEqual(['Low', 'Low']);
  });

  it('set on both rows to different values: the row changed later, as nothing is asked at Set Active', () => {
    const both = set(set(onG, framingF, 'Low', '2026-10-11T13:00:00.000Z'), framingG, 'Medium', '2026-10-11T14:00:00.000Z');
    expect(backOn(both, F, '2026-10-12T08:00:00.000Z').priority).toBe('Medium');
    const other = set(set(onG, framingG, 'Medium', '2026-10-11T13:00:00.000Z'), framingF, 'Low', '2026-10-11T14:00:00.000Z');
    expect(one(setActive(setActive(other, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z'), 'Framing').priority).toBe('Low');
  });

  it('S6 item 4 a, rows a master made before this build: a Low he set on the hidden row comes to the task\'s row when that row was changed later; a High there stays behind', () => {
    const before = allSavedBefore(onG, true);
    const lowOnOld = set(before, framingF, 'Low', '2026-10-11T13:00:00.000Z');
    expect(one(setActive(setActive(lowOnOld, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z'), 'Framing').priority).toBe('Low');
    // The task's row was changed after the old one (he may have set it there): it keeps its own.
    const changedSince = patch(lowOnOld, framingG, { percentComplete: 10 }, '2026-10-11T15:00:00.000Z');
    expect(one(setActive(setActive(changedSince, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z'), 'Framing').priority).toBe('High');
    // A High he had set on the old row before this build is not known to be his: the task's row keeps its own.
    const highOnOld = set(allSavedBefore(approve(onF, G, [FRAMING_F, ROOF_MOVED]), true), roofF, 'High', '2026-10-11T13:00:00.000Z');
    expect(one(setActive(setActive(highOnOld, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z'), 'Roof').priority).toBe('Medium');
    // A row that says what it took, but saved before rows kept their import's priority: the same caution.
    const halfway = allSavedBefore(onG);
    const stamped = patch(set(halfway, framingF, 'Low', '2026-10-11T13:00:00.000Z'), framingG, { percentComplete: 10 }, '2026-10-11T15:00:00.000Z');
    expect(one(setActive(setActive(stamped, F, '2026-10-12T08:00:00.000Z'), G, '2026-10-13T08:00:00.000Z'), 'Framing').priority).toBe('High');
  });
});

describe('S6 item 1: the new row\'s first upload, weighed against the cloud\'s row of its task', () => {
  // The phone approved G with no signal, from its own copy of F's row: Medium there, never touched as far as it knew.
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const newRow = one(onG, 'Framing');
  const cloudOld = (change: Partial<ScheduleItem>) => ({ ...onF.items.find(item => item.id === framingF)!, ...change, updatedAt: '2026-10-11T09:00:00.000Z' }) as ScheduleItem;

  it('he had set it Low on another device meanwhile: the new row goes up Low, nothing is asked, and the row says it took it', () => {
    const weighed = scheduleItemAgainstItsTask(newRow, cloudOld({ priority: 'Low' }), 'ask');
    expect([weighed.row.priority, weighed.asked, weighed.row.textFromTask?.priority, weighed.row.priorityAsImported]).toEqual(['Low', [], 'Low', 'High']);
  });

  it('nobody set it anywhere: the new row keeps its own High though the cloud\'s old row reads Medium, and goes up as it is', () => {
    expect([newRow.priority, cloudOld({ owner: '' }).priority]).toEqual(['High', 'Medium']);
    expect(scheduleItemAgainstItsTask(newRow, cloudOld({ owner: '' }), 'ask').row).toBe(newRow);
  });

  it('set on the new row here and on the old row there, to different values: he is asked once, from what the new row\'s own import gave it', () => {
    const mine = { ...newRow, priority: 'Medium', updatedAt: '2026-10-11T13:00:00.000Z' } as ScheduleItem;
    const weighed = scheduleItemAgainstItsTask(mine, cloudOld({ priority: 'Low' }), 'ask');
    expect([weighed.asked, weighed.base.fields]).toEqual([['priority'], { priority: 'High' }]);
  });

  it('he set High on the old row, which is also what the new row\'s import gave: nothing to change or ask, and the row now says the High is his', () => {
    const weighed = scheduleItemAgainstItsTask(newRow, cloudOld({ priority: 'High' }), 'ask');
    expect([weighed.row.priority, weighed.asked, weighed.row.textFromTask?.priority]).toEqual(['High', [], 'High']);
    expect(schedulePriorityIsHis(weighed.row)).toBe(true);
  });
});

describe('S6 item 1: a priority set on a row a newer master has replaced (the device had not heard of it)', () => {
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const newRow = one(onG, 'Framing');
  const oldRow = onF.items.find(item => item.id === framingF)!;
  const edit = {
    id: framingF, itemData: { ...oldRow, priority: 'Low', updatedAt: '2026-10-11T14:00:00.000Z' } as ScheduleItem,
    changedFields: ['priority', 'updatedAt'], base: scheduleItemEditBase(oldRow, ['priority']),
  };

  it('goes on to the task\'s row as his edit, over the priority that row\'s own import gave it, with nothing asked', () => {
    const sentOn = scheduleItemTextEditOnRow(edit, edit.changedFields, newRow)!;
    // The copy his edit is weighed from is the task's row as it is (High): it lands with no card.
    expect([sentOn.id, sentOn.itemData.priority, sentOn.changedFields, sentOn.base.fields]).toEqual([newRow.id, 'Low', ['priority', 'updatedAt'], { priority: 'High' }]);
    // What the sync wrote on the row is his: the row's record says so from then on.
    expect(scheduleItemRecordAfterTheSyncWrote(newRow, sentOn.itemData, ['priority']).textFromTask).toMatchObject({ taskId: framingF, priority: 'Low' });
  });

  it('set on the task\'s row meanwhile too (to the very value the old row had): weighed from what that row\'s own import gave it, so the two differ and he is asked', () => {
    const changedThere = { ...newRow, priority: 'Medium', updatedAt: '2026-10-11T13:00:00.000Z' } as ScheduleItem;
    expect(scheduleItemTextEditOnRow(edit, edit.changedFields, changedThere)!.base.fields).toEqual({ priority: 'High' });
  });
});

describe('S6 item 1: the sync\'s own merge (a refresh, Full Sync)', () => {
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const framingG = one(onG, 'Framing').id;
  const row = (state: State, id: string) => state.items.find(item => item.id === id)!;
  const merge = (local: ScheduleItem[], cloud: ScheduleItem[]) => recoverDAVEScheduleRecords({ local, cloud, allowCloudOnly: true });
  const cloudOld = (state: State, change: Partial<ScheduleItem>, at = '2026-10-11T14:00:00.000Z') => ({ ...row(state, framingF), ...change, updatedAt: at }) as ScheduleItem;

  it('the task\'s row took no priority and still holds its own: it takes the one he set on the old row since, and that goes up as the priority alone', () => {
    const merged = merge(onG.items, [cloudOld(onG, { priority: 'Low' }), row(onG, framingG)]);
    const framing = merged.find(item => item.id === framingG)!;
    expect([framing.priority, framing.textFromTask?.priority]).toEqual(['Low', 'Low']);
    expect(scheduleItemsTakingCarriedText(merged).map(({ item, fields }) => [item.id, fields])).toEqual([[framingG, ['priority']]]);
  });

  it('nobody set it: the old row\'s Medium is not carried over the new row\'s own High', () => {
    const merged = merge(onG.items, [cloudOld(onG, { percentComplete: 5 }), row(onG, framingG)]);
    expect(merged.find(item => item.id === framingG)!.priority).toBe('High');
    expect(scheduleItemsTakingCarriedText(merged)).toEqual([]);
  });

  it('he set one on the task\'s row too: his there stands', () => {
    const setHere = onG.items.map(item => (item.id === framingG ? { ...item, priority: 'Medium', updatedAt: '2026-10-11T13:00:00.000Z' } as ScheduleItem : item));
    expect(merge(setHere, [cloudOld(onG, { priority: 'Low' }), setHere.find(item => item.id === framingG)!]).find(item => item.id === framingG)!.priority).toBe('Medium');
  });

  it('the carried priority is sent while the cloud\'s row still holds its own import\'s, and not over one he set there', () => {
    const carried = { ...row(onG, framingG), priority: 'Low', textFromTask: { ...row(onG, framingG).textFromTask!, priority: 'Low' } } as ScheduleItem;
    expect(scheduleItemCarriedFieldsToSend(['priority'], carried, row(onG, framingG))).toEqual(['priority']);
    expect(scheduleItemCarriedFieldsToSend(['priority'], carried, { ...row(onG, framingG), priority: 'Medium' } as ScheduleItem)).toEqual([]);
  });

  it('S6 item 4 a, a row a master made before this build: a Low he set on the old row comes forward at the next sync; a High there does not', () => {
    const before = allSavedBefore(onG, true);
    const merged = merge(before.items, [cloudOld(before, { priority: 'Low' }), row(before, framingG)]);
    expect(merged.find(item => item.id === framingG)!.priority).toBe('Low');
    expect(scheduleItemsTakingCarriedText(merged).map(({ fields }) => fields)).toEqual([['priority']]);
    // Roof's old row raised to High before this build: not known to be his, nothing is carried.
    const onRoof = allSavedBefore(approve(onF, G, [FRAMING_F, ROOF_MOVED]), true);
    const roofG = one(onRoof, 'Roof').id;
    const mergedRoof = merge(onRoof.items, [{ ...row(onRoof, roofF), priority: 'High', updatedAt: '2026-10-11T14:00:00.000Z' } as ScheduleItem, row(onRoof, roofG)]);
    expect(mergedRoof.find(item => item.id === roofG)!.priority).toBe('Medium');
    // And not once the task's row has been changed after the old one.
    const later = before.items.map(item => (item.id === framingG ? { ...item, updatedAt: '2026-10-11T15:00:00.000Z' } as ScheduleItem : item));
    expect(merge(later, [cloudOld(before, { priority: 'Low' }), later.find(item => item.id === framingG)!]).find(item => item.id === framingG)!.priority).toBe('High');
  });
});
