/**
 * Schedule batch S5, item 1 (7 Oct 2026; Medium, older: the same on Build
 * 229). When a newer master moved a task to a new row, the task's ACTIVITY
 * NOTES (its dated history lines) and its PRIORITY stayed behind on the old,
 * hidden row. His owner, contractor, note, next step, milestone, approval,
 * schedule impact and hand links already follow by one rule: the new row
 * says what it took from the row it replaces, and wherever two rows of the
 * task meet each field is weighed from that record. Activity notes and the
 * priority now follow by that same rule.
 *
 * Here: the rule on the records alone, on every path that puts two rows of a
 * task together. The phone's approval and the web's upload (one merge), Set
 * Active and Make Current (one helper), a new row's first upload, an edit
 * typed on a replaced row, and the sync's own merge (a refresh, Full Sync, a
 * deletion heard live). Two devices with one cloud are in
 * review-n2-sched-typed-text-carried-between-devices. Synthetic data.
 */
import {
  reconcileDAVEScheduleRecords,
  clearDeletedScheduleRowsHeld,
  recoverDAVEScheduleRecords,
  scheduleItemsAfterCloudDeletion,
  scheduleItemsAfterCloudRowHeard,
  scheduleItemsTakingCarriedText,
} from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import {
  scheduleItemActivityWithOtherRows,
  scheduleItemAgainstItsTask,
  scheduleItemCarriedFieldsToSend,
  scheduleItemEditBase,
  scheduleItemNewRowMetAgain,
  scheduleItemRecordAfterTheSyncWrote,
  scheduleItemTextEditOnRow,
  scheduleTaskOfRowId,
} from '../../services/ScheduleItemEditBase';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ProjectItemActivity, ReferenceDocument, ScheduleItem } from '../../types';

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
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
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
/** Set Active on the phone; the web's Make Current calls the same helper with the tasks shown before and after. */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const documents = scheduleDocumentsAfterActivation(target, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
const note = (id: string, createdAt: string): ProjectItemActivity => ({ id, message: `Note ${id}`, author: 'David', createdAt });
const noteIds = (item: Pick<ScheduleItem, 'activity'> | undefined) => (item?.activity ?? []).map(entry => entry.id);
const withNote = (state: State, id: string, entry: ProjectItemActivity): State =>
  patch(state, id, { activity: [...(state.items.find(item => item.id === id)!.activity ?? []), entry] }, entry.createdAt);

// The import works a row's priority out from today's date (High when the finish is within a week). The clock is set
// far from the tasks' dates, so the import's own priority for each row is Medium.
jest.useFakeTimers({ now: Date.parse('2026-06-01T12:00:00.000Z') });
afterAll(() => { jest.useRealTimers(); });
const F = schedule('MASTER F', '2026-06-01T12:00:00.000Z');
const G = schedule('MASTER G', '2026-06-08T12:00:00.000Z');
const H = schedule('MASTER H', '2026-06-15T12:00:00.000Z');
const FRAMING_F = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,';
const FRAMING_G = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,';
const FRAMING_H = 'Framing,Alpha,Lot,10/09/2026,10/19/2026,';
const ROOF = 'Roof,Alpha,Lot,10/13/2026,10/21/2026,';
const A1 = note('a1', '2026-06-02T09:00:00.000Z');
const A2 = note('a2', '2026-06-03T09:00:00.000Z');
const A3 = note('a3', '2026-06-09T09:00:00.000Z');
const A4 = note('a4', '2026-06-10T09:00:00.000Z');

const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
const framingF = one(onF, 'Framing').id;
/** He adds two activity notes to Framing and marks it Low, while F is the master. */
const withHistory = patch(withNote(withNote(onF, framingF, A1), framingF, A2), framingF, { priority: 'Low' }, '2026-06-03T09:05:00.000Z');

describe('S5 item 1: a master that moves a task takes its activity notes and its priority to the new row', () => {
  it('the task shown after the master has every note, each once, and the priority he set', () => {
    expect(one(onF, 'Framing').priority).toBe('Medium');
    const onG = approve(withHistory, G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    expect(framing.id).not.toBe(framingF);
    expect([framing.startDate, noteIds(framing), framing.priority]).toEqual(['10/05/2026', ['a1', 'a2'], 'Low']);
    // The row says it took the priority, as it says what it took of his text.
    expect(framing.textFromTask).toMatchObject({ taskId: framingF, priority: 'Low' });
    // The old row keeps its copy, hidden.
    expect(onG.items.find(item => item.id === framingF)).toMatchObject({ priority: 'Low', activity: [A1, A2] });
  });

  it('moved twice: the notes and the priority are on the third row, and a note added on the second goes too', () => {
    const onG = approve(withHistory, G, [FRAMING_G, ROOF]);
    const onH = approve(withNote(onG, one(onG, 'Framing').id, A3), H, [FRAMING_H, ROOF]);
    const framing = one(onH, 'Framing');
    expect([framing.startDate, noteIds(framing), framing.priority]).toEqual(['10/09/2026', ['a1', 'a2', 'a3'], 'Low']);
  });

  it('the import\'s own "due within a week" High is not a word about a task he already has: the moved task keeps its priority, as one left on its dates always did', () => {
    // G is imported four days before the task's new finish: the import marks its row High.
    const late = schedule('MASTER G', '2026-10-11T12:00:00.000Z');
    jest.setSystemTime(Date.parse(late.importedAt as string));
    try {
      expect(rows(late, [FRAMING_G]).map(item => item.priority)).toEqual(['High']);
      expect(one(approve(withHistory, late, [FRAMING_G, ROOF]), 'Framing').priority).toBe('Low');
      // A task he never touched keeps the priority it had, moved or not.
      const untouched = approve(onF, late, [FRAMING_G, ROOF]);
      expect([one(untouched, 'Framing').priority, one(untouched, 'Roof').priority]).toEqual(['Medium', 'Medium']);
      // A task new to the list starts with the import's.
      expect(one(approve(onF, late, [FRAMING_G, ROOF, 'Paint,Alpha,Lot,10/10/2026,10/14/2026,']), 'Paint').priority).toBe('High');
    } finally { jest.setSystemTime(Date.parse('2026-06-01T12:00:00.000Z')); }
  });

  it('a task the master leaves on its dates is the same row, untouched', () => {
    const onG = approve(withHistory, G, [FRAMING_F, ROOF]);
    const framing = one(onG, 'Framing');
    expect([framing.id, noteIds(framing), framing.priority]).toEqual([framingF, ['a1', 'a2'], 'Low']);
    expect(framing.textFromTask).toBeUndefined();
  });
});

describe('S5 item 1: Set Active and Make Current, back and forth', () => {
  const onG = approve(withHistory, G, [FRAMING_G, ROOF]);
  const framingG = one(onG, 'Framing').id;

  it('a note added and a priority set under the newer master show on the older master\'s row when it is made current again', () => {
    const later = patch(withNote(onG, framingG, A3), framingG, { priority: 'High' }, '2026-06-09T09:05:00.000Z');
    const backOnF = setActive(later, F, '2026-06-10T08:00:00.000Z');
    const framing = one(backOnF, 'Framing');
    expect([framing.id, noteIds(framing), framing.priority]).toEqual([framingF, ['a1', 'a2', 'a3'], 'High']);
  });

  it('and one added under the older master shows on the newer master\'s row when that is made current again; no note is ever listed twice', () => {
    const later = patch(withNote(onG, framingG, A3), framingG, { priority: 'High' }, '2026-06-09T09:05:00.000Z');
    const backOnF = setActive(later, F, '2026-06-10T08:00:00.000Z');
    const onFAgain = patch(withNote(backOnF, framingF, A4), framingF, { priority: 'Medium' }, '2026-06-10T09:05:00.000Z');
    const onGAgain = setActive(onFAgain, G, '2026-06-11T08:00:00.000Z');
    const framing = one(onGAgain, 'Framing');
    expect([framing.id, noteIds(framing), framing.priority]).toEqual([framingG, ['a1', 'a2', 'a3', 'a4'], 'Medium']);
    // Once more round: nothing to bring, nothing saved.
    const again = setActive(setActive(onGAgain, F, '2026-06-12T08:00:00.000Z'), G, '2026-06-13T08:00:00.000Z');
    expect(noteIds(one(again, 'Framing'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(scheduleProgressCarriedOnActivation({ items: again.items, documentsBefore: again.documents, documentsAfter: scheduleDocumentsAfterActivation(F, again.documents, 'project', '2026-06-14T08:00:00.000Z'), now: '2026-06-14T08:00:00.000Z' })
      .filter(item => item.taskName === 'Framing' && JSON.stringify(noteIds(item)) !== JSON.stringify(['a1', 'a2', 'a3', 'a4']))).toEqual([]);
  });

  it('a priority he set on the newer row stands when only the older row is stamped later for something else', () => {
    const high = patch(onG, framingG, { priority: 'High' }, '2026-06-09T09:05:00.000Z');
    // The hidden older row is given a percent by another device afterwards: its priority is still the one the new row took.
    const stamped = patch(high, framingF, { percentComplete: 10 }, '2026-06-09T10:00:00.000Z');
    expect(one(setActive(setActive(stamped, F, '2026-06-10T08:00:00.000Z'), G, '2026-06-11T08:00:00.000Z'), 'Framing').priority).toBe('High');
  });

  it('a row a master made before this build keeps no word about its priority: it stays as it is (recorded limit)', () => {
    const { priority: _taken, ...record } = one(onG, 'Framing').textFromTask as NonNullable<ScheduleItem['textFromTask']>;
    const asBefore = { ...onG, items: onG.items.map(item => (item.id === framingG ? { ...item, priority: 'Medium', textFromTask: record } as ScheduleItem : item)) };
    const backAndForth = setActive(setActive(asBefore, F, '2026-06-10T08:00:00.000Z'), G, '2026-06-11T08:00:00.000Z');
    expect(one(backAndForth, 'Framing').priority).toBe('Medium');
    // Its activity notes need no record: they come all the same.
    const without = { ...asBefore, items: asBefore.items.map(item => (item.id === framingG ? { ...item, activity: [] } as ScheduleItem : item)) };
    expect(noteIds(one(setActive(setActive(without, F, '2026-06-10T08:00:00.000Z'), G, '2026-06-11T08:00:00.000Z'), 'Framing'))).toEqual(['a1', 'a2']);
  });
});

describe('S5 item 1: the new row\'s first upload, weighed against the cloud\'s row of its task', () => {
  // The phone approved G with no signal, from its own copy of F's row: no note yet, Medium.
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const newRow = one(onG, 'Framing');
  const cloudOld = (change: Partial<ScheduleItem>) => ({ ...onF.items.find(item => item.id === framingF)!, ...change, updatedAt: '2026-06-09T09:00:00.000Z' }) as ScheduleItem;

  it('a note added and a priority set on the task on another device meanwhile go on the new row; nothing is asked', () => {
    const weighed = scheduleItemAgainstItsTask(newRow, cloudOld({ activity: [A1, A2], priority: 'High' }), 'ask');
    expect([noteIds(weighed.row), weighed.row.priority, weighed.asked]).toEqual([['a1', 'a2'], 'High', []]);
    // The record follows the priority, so a change he makes on this row later reads as his.
    expect(weighed.row.textFromTask).toMatchObject({ priority: 'High' });
    // Stamped after both, so every device takes the row.
    expect(Date.parse(weighed.row.updatedAt!)).toBeGreaterThan(Date.parse('2026-06-09T09:00:00.000Z'));
  });

  it('a priority set on the new row and another on the old row meanwhile: he is asked, one choice for the task; the notes of both rows are kept without asking', () => {
    const mine = { ...newRow, priority: 'Low', activity: [A3], updatedAt: '2026-06-09T12:00:00.000Z' } as ScheduleItem;
    const weighed = scheduleItemAgainstItsTask(mine, cloudOld({ activity: [A1], priority: 'High' }), 'ask');
    expect([weighed.asked, noteIds(weighed.row), weighed.base.fields]).toEqual([['priority'], ['a1', 'a3'], { priority: 'Medium' }]);
  });

  it('nothing changed on the task meanwhile: the row goes up as it is', () => {
    const made = one(approve(withHistory, G, [FRAMING_G, ROOF]), 'Framing');
    const weighed = scheduleItemAgainstItsTask(made, withHistory.items.find(item => item.id === framingF)!, 'ask');
    expect(weighed.row).toBe(made);
  });

  it('the retry of a first upload whose answer was lost sends a priority he has set on the row since it was made', () => {
    const made = one(approve(withHistory, G, [FRAMING_G, ROOF]), 'Framing');
    const waiting = { ...made, priority: 'High', updatedAt: '2026-06-09T12:00:00.000Z' } as ScheduleItem;
    const retry = scheduleItemNewRowMetAgain(waiting, made, () => scheduleTaskOfRowId([made]), { updatedAt: null, fields: { priority: 'Low' } });
    expect(retry).toMatchObject({ changedFields: ['priority', 'updatedAt'], base: { fields: { priority: 'Low' } } });
    expect(scheduleItemNewRowMetAgain(made, made, () => scheduleTaskOfRowId([made]), { updatedAt: null, fields: {} })).toBeNull();
  });
});

describe('S5 item 1: a note added or a priority set on a row a newer master has replaced (the device had not heard of it)', () => {
  const onG = approve(withHistory, G, [FRAMING_G, ROOF]);
  const newRow = one(onG, 'Framing');
  const oldRow = withHistory.items.find(item => item.id === framingF)!;
  const editOf = (change: Partial<ScheduleItem>, fields: Array<keyof ScheduleItem>) => ({
    id: framingF, itemData: { ...oldRow, ...change, updatedAt: '2026-06-10T09:00:00.000Z' } as ScheduleItem,
    changedFields: [...fields, 'updatedAt'] as string[], base: scheduleItemEditBase(oldRow, fields as string[]),
  });

  it('the note goes on to the task\'s row, once, with nothing asked', () => {
    const edit = editOf({ activity: [A1, A2, A4] }, ['activity']);
    const sentOn = scheduleItemTextEditOnRow(edit, edit.changedFields, newRow)!;
    expect([sentOn.id, noteIds(sentOn.itemData), sentOn.changedFields]).toEqual([newRow.id, ['a1', 'a2', 'a4'], ['activity', 'updatedAt']]);
    // The task's row as it is counts as the copy the notes started from: they land with no card.
    expect(sentOn.base.fields).toEqual({ activity: [A1, A2] });
    // The task's row already holds the note (another device brought it): nothing to send.
    expect(scheduleItemTextEditOnRow(edit, edit.changedFields, { ...newRow, activity: [A1, A2, A4] } as ScheduleItem)).toBeNull();
  });

  it('a note the task\'s row has that the old row lacks stays, and the order is by date', () => {
    const edit = editOf({ activity: [A1, A2, A4] }, ['activity']);
    const sentOn = scheduleItemTextEditOnRow(edit, edit.changedFields, { ...newRow, activity: [A1, A2, A3] } as ScheduleItem)!;
    expect(noteIds(sentOn.itemData)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('the priority goes on to the task\'s row as his edit: over the priority that row took it lands; over one set there meanwhile he is asked', () => {
    const edit = editOf({ priority: 'High' }, ['priority']);
    const sentOn = scheduleItemTextEditOnRow(edit, edit.changedFields, newRow)!;
    expect([sentOn.itemData.priority, sentOn.changedFields, sentOn.base.fields, sentOn.sentOn]).toEqual(['High', ['priority', 'updatedAt'], { priority: 'Low' }, ['priority']]);
    // Set to Medium on the task's row meanwhile: the copy his edit is weighed from is the old row's Low, so the two differ and it is asked.
    const changedThere = { ...newRow, priority: 'Medium', updatedAt: '2026-06-09T12:00:00.000Z' } as ScheduleItem;
    expect(scheduleItemTextEditOnRow(edit, edit.changedFields, changedThere)!.base.fields).toEqual({ priority: 'Low' });
    // What the sync writes on the row is again a copy of what the task has: the row's record follows it.
    expect(scheduleItemRecordAfterTheSyncWrote(newRow, sentOn.itemData, ['priority']).textFromTask).toMatchObject({ priority: 'High' });
  });
});

describe('S5 item 1: the sync\'s own merge (a refresh, Full Sync, a deletion heard live)', () => {
  const onG = approve(onF, G, [FRAMING_G, ROOF]);
  const framingG = one(onG, 'Framing').id;
  const row = (state: State, id: string) => state.items.find(item => item.id === id)!;
  /** The cloud holds F's row with what was set on it on another device; this device holds G's row as its approval made it. */
  const merge = (local: ScheduleItem[], cloud: ScheduleItem[]) => recoverDAVEScheduleRecords({ local, cloud, allowCloudOnly: true });
  const cloudOld = (change: Partial<ScheduleItem>, at = '2026-06-09T09:00:00.000Z') => ({ ...row(onF, framingF), ...change, updatedAt: at }) as ScheduleItem;

  it('the task\'s newest row takes the notes its earlier row holds that it lacks, each once, and they go up as the notes alone', () => {
    const cloud = [cloudOld({ activity: [A1, A2] }), row(onG, framingG), ...onG.items.filter(item => item.taskName === 'Roof')];
    const merged = merge(onG.items, cloud);
    const framing = merged.find(item => item.id === framingG)!;
    expect(noteIds(framing)).toEqual(['a1', 'a2']);
    expect(scheduleItemsTakingCarriedText(merged).map(({ item, fields }) => [item.id, fields])).toEqual([[framingG, ['activity']]]);
    // The row keeps its own stamp: the carry is no edit of his.
    expect(framing.updatedAt).toBe(row(onG, framingG).updatedAt);
    // A second merge finds nothing to bring.
    const again = merge(merged, cloud.map(item => (item.id === framingG ? framing : item)));
    expect(noteIds(again.find(item => item.id === framingG))).toEqual(['a1', 'a2']);
    expect(scheduleItemsTakingCarriedText(again)).toEqual([]);
  });

  it('both devices bring the same notes: the second finds the cloud\'s row holding them and sends nothing; one that lacks a note is completed, never doubled', () => {
    const carried = { ...row(onG, framingG), activity: [A1, A2] } as ScheduleItem;
    expect(scheduleItemCarriedFieldsToSend(['activity'], carried, carried)).toEqual([]);
    expect(scheduleItemCarriedFieldsToSend(['activity'], carried, { ...carried, activity: [A2, A1] } as ScheduleItem)).toEqual([]);
    expect(scheduleItemCarriedFieldsToSend(['activity'], carried, { ...carried, activity: [A1] } as ScheduleItem)).toEqual(['activity']);
    expect(noteIds({ activity: scheduleItemActivityWithOtherRows([A1, A3], carried.activity)! })).toEqual(['a1', 'a2', 'a3']);
  });

  it('moved twice: only the newest row takes them, from every earlier row', () => {
    const onH = approve(onG, H, [FRAMING_H, ROOF]);
    const framingH = one(onH, 'Framing').id;
    const cloud = [cloudOld({ activity: [A1] }), { ...row(onH, framingG), activity: [A3], updatedAt: '2026-06-09T10:00:00.000Z' } as ScheduleItem, row(onH, framingH)];
    const merged = merge(onH.items, cloud);
    expect([noteIds(merged.find(item => item.id === framingH)), noteIds(merged.find(item => item.id === framingG))]).toEqual([['a1', 'a3'], ['a3']]);
  });

  it('the priority: a row that still holds the one it took takes the one set on that row since; one set on the new row stands', () => {
    const cloud = [cloudOld({ priority: 'High' }), row(onG, framingG)];
    const merged = merge(onG.items, cloud);
    const framing = merged.find(item => item.id === framingG)!;
    expect([framing.priority, framing.textFromTask?.priority]).toEqual(['High', 'High']);
    expect(scheduleItemsTakingCarriedText(merged).map(({ fields }) => fields)).toEqual([['priority']]);
    // Set on the new row: it is his there.
    const setHere = onG.items.map(item => (item.id === framingG ? { ...item, priority: 'Low', updatedAt: '2026-06-09T08:00:00.000Z' } as ScheduleItem : item));
    expect(merge(setHere, [cloudOld({ priority: 'High' }), setHere.find(item => item.id === framingG)!]).find(item => item.id === framingG)!.priority).toBe('Low');
    // The old row was changed before the new row last was: nothing is taken.
    const later = onG.items.map(item => (item.id === framingG ? { ...item, updatedAt: '2026-06-10T08:00:00.000Z' } as ScheduleItem : item));
    expect(merge(later, [cloudOld({ priority: 'High' }), later.find(item => item.id === framingG)!]).find(item => item.id === framingG)!.priority).toBe('Medium');
  });

  it('the carried priority is sent only while the cloud\'s row still holds the one it took', () => {
    const carried = { ...row(onG, framingG), priority: 'High', textFromTask: { ...row(onG, framingG).textFromTask!, priority: 'High' } } as ScheduleItem;
    expect(scheduleItemCarriedFieldsToSend(['priority', 'notes'], carried, row(onG, framingG))).toEqual(['priority', 'notes']);
    expect(scheduleItemCarriedFieldsToSend(['priority'], carried, { ...row(onG, framingG), priority: 'Low' } as ScheduleItem)).toEqual([]);
    expect(scheduleItemCarriedFieldsToSend(['priority'], carried, carried)).toEqual([]);
  });

  it('a row deleted in the cloud lends its notes to the row that answers to it', () => {
    const items = [{ ...row(onF, framingF), activity: [A1, A2], updatedAt: '2026-06-03T09:00:00.000Z' } as ScheduleItem, ...onG.items.filter(item => item.id !== framingF)];
    const after = scheduleItemsAfterCloudDeletion(items, framingF);
    expect(after.map(item => item.id)).not.toContain(framingF);
    expect(noteIds(after.find(item => item.id === framingG))).toEqual(['a1', 'a2']);
  });

  it('deleted before the row that answers to it has been heard: a row with nothing of his but notes is held for them, and lends them when that row arrives', () => {
    clearDeletedScheduleRowsHeld();
    const items = [{ ...row(onF, framingF), activity: [A1, A2], updatedAt: '2026-06-03T09:00:00.000Z' } as ScheduleItem, ...onF.items.filter(item => item.id !== framingF)];
    const after = scheduleItemsAfterCloudDeletion(items, framingF);
    const heard = scheduleItemsAfterCloudRowHeard([...after, row(onG, framingG)], framingG);
    expect(noteIds(heard.find(item => item.id === framingG))).toEqual(['a1', 'a2']);
    clearDeletedScheduleRowsHeld();
  });
});

describe('S5 item 1: the notes of two rows put together', () => {
  it('each note once, in the order of their dates; null when the row lacks none, so nothing is rewritten', () => {
    expect(scheduleItemActivityWithOtherRows([A1, A2], [A2, A1])).toBeNull();
    expect(scheduleItemActivityWithOtherRows([A1, A2], undefined, null, [])).toBeNull();
    expect(scheduleItemActivityWithOtherRows(undefined, [A2], [A1, A2])!.map(entry => entry.id)).toEqual(['a1', 'a2']);
    expect(scheduleItemActivityWithOtherRows([A4], [A1, A3], [A3, A2])!.map(entry => entry.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    // Notes of the same moment keep the order they were in; one with no date goes first.
    const same = (id: string) => note(id, '2026-06-05T09:00:00.000Z');
    expect(scheduleItemActivityWithOtherRows([same('x'), same('y')], [{ ...same('z'), createdAt: '' }, same('w')])!.map(entry => entry.id)).toEqual(['z', 'x', 'y', 'w']);
  });
});
