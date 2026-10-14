/**
 * Review pass 4 of the Build 232 round, C-2 (13 Oct 2026; Low, caused by the
 * owner's answer to question 47 as built, e81cd19c). The coordinator's
 * decision.
 *
 * A newer master now turns a task it leaves on its dates High when its file
 * marks the task Critical or lists its finish within the week (a finish
 * already past included). That also turned a FINISHED task High: at every
 * new master, each task it left in place whose finish had gone by read High,
 * one that had been 100% complete since June included. Build 231 left them
 * Medium.
 *
 * Decided: a task that is Complete is never raised by a master that leaves
 * it on its dates: not by the file's Critical mark, not by its finish date.
 * "Complete" is the app's own reading of a schedule row
 * (scheduleProgressIsComplete on reconcileScheduleProgress: its percent is
 * 100, or it says Complete and holds no percent), read off the row as the
 * approval leaves it, so with the percent the master's own file gives it
 * where that stands.
 * Everything else of question 47 stays: an unfinished task is raised as
 * before, nothing lowers a priority, and a task the master MOVES is as it
 * was (its new row holds its file's priority).
 *
 * Here: the phone's approval (the merge as App.tsx calls it) and the
 * desktop's upload (its own plan, planDAVEWebScheduleImport). Synthetic data.
 */
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedToShownTasks } from '../../services/ScheduleImportMerge';
import { reconcileScheduleProgressEdit, scheduleProgressIsComplete } from '../../services/ScheduleProgressInvariant';
import { schedulePriorityHeSet, schedulePriorityIsHis } from '../../services/ScheduleTaskRevisions';
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
const START = Date.parse('2026-05-01T12:00:00.000Z');
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
/** Make Current on the desktop, for the master uploaded above (desktop-auth-provider setCurrentSchedule). */
function makeCurrent(state: State, source: ReferenceDocument, at: string): State {
  const file = state.documents.find(document => document.id === source.id)!;
  const documents = scheduleDocumentsAfterActivation(file, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedToShownTasks({ before: shown(state), after: shown({ items: state.items, documents }), documentsBefore: state.documents, documentsAfter: documents, now: at })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
/** A percent he enters on a task himself (the app's own rule for his progress edit: 100 is Complete). */
function progress(state: State, id: string, percentComplete: number, at = '2026-10-06T09:00:00.000Z'): State {
  return { ...state, items: state.items.map(item => (item.id === id
    ? { ...item, ...reconcileScheduleProgressEdit(item, { percentComplete }), progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at } as ScheduleItem
    : item)) };
}
/** His edit of a task's priority as the phone saves it (App.tsx hands every task edit to this helper first). */
function sets(state: State, id: string, priority: ScheduleItem['priority'], at = '2026-10-06T09:05:00.000Z'): State {
  jest.setSystemTime(Date.parse(at));
  const change = withProjectControlsEditMerged(row(state, id), { priority });
  jest.setSystemTime(START);
  return { ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item)) };
}
/** A row as a build before Build 231 saved it: no word of what its own import gave it. */
const savedBefore = (state: State): State => ({ ...state, items: state.items.map(item => { const { priorityAsImported: _own, ...rest } = item; return rest as ScheduleItem; }) });
/** What a task shows and what its row says of it: the priority, the row's own-import word, whether it is his, whether a mark says so. */
const reads = (item: ScheduleItem) => [item.priority, item.priorityAsImported, schedulePriorityIsHis(item), Boolean(schedulePriorityHeSet(item))];
const done = (item: ScheduleItem) => [item.percentComplete, item.status];

jest.useFakeTimers({ now: START });
afterAll(() => { jest.useRealTimers(); });
afterEach(() => { jest.setSystemTime(START); });

// E is imported on 1 May, long before any task is due: each row's own priority is Medium.
const E = schedule('MASTER E', '2026-05-01T12:00:00.000Z');
// M and N are imported on 8 and 9 Oct; H on 16 Oct. Demo's finish (5 June) has gone by; Survey's (14 Oct) is within
// the week of M and N; Roof (21 Nov) and Paint (10 Dec) are far off.
const M = schedule('MASTER M', '2026-10-08T12:00:00.000Z');
const N = schedule('MASTER N', '2026-10-09T12:00:00.000Z');
const H = schedule('MASTER H', '2026-10-16T12:00:00.000Z');
const line = (name: 'Demo' | 'Survey' | 'Roof' | 'Paint', percent = '', critical = '') => `${name},Alpha,Lot,${{
  Demo: '06/01/2026,06/05/2026', Survey: '10/12/2026,10/14/2026', Roof: '11/13/2026,11/21/2026', Paint: '12/01/2026,12/10/2026',
}[name]},${percent},${critical}`;
const UNMOVED = [line('Demo'), line('Survey'), line('Roof', '', 'Yes'), line('Paint')];

const onE = approve(EMPTY, E, [line('Demo'), line('Survey'), line('Roof'), line('Paint')]);
const ids = { Demo: one(onE, 'Demo').id, Survey: one(onE, 'Survey').id, Roof: one(onE, 'Roof').id, Paint: one(onE, 'Paint').id };
const WHY = [
  ['Demo', 'its finish date has gone by'],
  ['Survey', 'its finish comes within the week'],
  ['Roof', 'the file marks it Critical'],
] as const;

describe('C-2: the tasks as master E saved them, and what master N\'s file reads for each (the file reader\'s rule; not changed)', () => {
  it('all Medium, not started; N\'s rows read High for Demo, Survey and Roof, Medium for Paint, complete or not', () => {
    expect(shown(onE).map(item => [item.taskName, ...reads(item), ...done(item)])).toEqual(
      ['Demo', 'Survey', 'Roof', 'Paint'].map(name => [name, 'Medium', 'Medium', false, false, 0, 'Not Started']),
    );
    expect(rows(N, UNMOVED).map(item => item.priority)).toEqual(['High', 'High', 'High', 'Medium']);
    expect(rows(N, [line('Demo', '100'), line('Survey', '100'), line('Roof', '100', 'Yes'), line('Paint', '100')]).map(item => item.priority)).toEqual(['High', 'High', 'High', 'Medium']);
  });
});

describe.each([
  ['the phone\'s approval', approve],
  ['the desktop\'s upload', upload],
] as const)('C-2: a newer master that leaves the task on its dates, by %s', (_road, road) => {
  it.each(WHY)('%s is COMPLETE and %s: it is NOT raised; the same row, still Medium, and nothing of its priority is written', (name, _why) => {
    const finished = progress(onE, ids[name], 100);
    const after = road(finished, N, UNMOVED);
    const task = row(after, ids[name]);
    expect([...reads(task), ...done(task)]).toEqual(['Medium', 'Medium', false, false, 100, 'Complete']);
    // It is still that master's task too (the row belongs to N as well), as any task a master leaves in place.
    expect(task.alsoImportedInBatchIds).toEqual(['batch-MASTER N']);
    expect(task.prioritySetByHand).toBeUndefined();
  });

  it.each(WHY)('%s is NOT complete (40%%) and %s: it IS raised, as before', (name, _why) => {
    const after = road(progress(onE, ids[name], 40), N, UNMOVED);
    expect([...reads(row(after, ids[name])), ...done(row(after, ids[name]))]).toEqual(['High', 'High', false, false, 40, 'In Progress']);
  });

  it('all three finished, Paint not: one approval leaves every one of them Medium', () => {
    const finished = progress(progress(progress(onE, ids.Demo, 100), ids.Survey, 100), ids.Roof, 100);
    const after = road(finished, N, UNMOVED);
    expect(['Demo', 'Survey', 'Roof', 'Paint'].map(name => row(after, ids[name as keyof typeof ids]).priority)).toEqual(['Medium', 'Medium', 'Medium', 'Medium']);
  });

  it('the master\'s own file says the task is 100% complete (he had it at 40%): Complete as the approval leaves it, and not raised', () => {
    const after = road(progress(onE, ids.Demo, 40), N, [line('Demo', '100'), line('Survey'), line('Roof', '', 'Yes'), line('Paint')]);
    expect([...reads(row(after, ids.Demo)), ...done(row(after, ids.Demo))]).toEqual(['Medium', 'Medium', false, false, 100, 'Complete']);
  });

  it('he finished it and the master\'s file says 40%: his 100% stands (a file never lowers his percent), so it is Complete and not raised', () => {
    const after = road(progress(onE, ids.Demo, 100), N, [line('Demo', '40'), line('Survey'), line('Roof', '', 'Yes'), line('Paint')]);
    expect([...reads(row(after, ids.Demo)), ...done(row(after, ids.Demo))]).toEqual(['Medium', 'Medium', false, false, 100, 'Complete']);
  });

  it('an earlier FILE said 100% and this master\'s file corrects it to 40%: the task is open again as the approval leaves it, and IS raised', () => {
    const byFile = approve(EMPTY, E, [line('Demo', '100'), line('Survey'), line('Roof'), line('Paint')]);
    expect([...reads(one(byFile, 'Demo')), ...done(one(byFile, 'Demo'))]).toEqual(['Medium', 'Medium', false, false, 100, 'Complete']);
    const after = road(byFile, N, [line('Demo', '40'), line('Survey'), line('Roof', '', 'Yes'), line('Paint')]);
    expect([...reads(row(after, one(byFile, 'Demo').id)), ...done(row(after, one(byFile, 'Demo').id))]).toEqual(['High', 'High', false, false, 40, 'In Progress']);
  });

  it('a finished task saved before rows kept their import\'s word (Build 230 and earlier): not raised, and still no word is written', () => {
    const after = road(progress(savedBefore(onE), ids.Demo, 100), N, UNMOVED);
    expect([row(after, ids.Demo).priority, row(after, ids.Demo).priorityAsImported, schedulePriorityIsHis(row(after, ids.Demo))]).toEqual(['Medium', undefined, false]);
  });

  it('"Complete" is the app\'s own reading: 99% and a Waiting task are raised; a row holding 100% is Complete whatever its status word', () => {
    const at99 = road(progress(onE, ids.Demo, 99), N, UNMOVED);
    expect([row(at99, ids.Demo).priority, scheduleProgressIsComplete(row(at99, ids.Demo))]).toEqual(['High', false]);
    const waiting: State = { ...onE, items: onE.items.map(item => (item.id === ids.Demo ? { ...item, percentComplete: 60, status: 'Waiting' } as ScheduleItem : item)) };
    expect(row(road(waiting, N, UNMOVED), ids.Demo).priority).toBe('High');
    // A record not yet put through the progress rule (100 beside "In Progress"): every screen reads it Complete.
    const odd: State = { ...onE, items: onE.items.map(item => (item.id === ids.Demo ? { ...item, percentComplete: 100, status: 'In Progress' } as ScheduleItem : item)) };
    expect(row(road(odd, N, UNMOVED), ids.Demo).priority).toBe('Medium');
  });

  it('nothing is lowered: a task a master raised while it was open, finished since, stays High at the next master', () => {
    const raised = approve(onE, M, UNMOVED);
    expect(reads(one(raised, 'Survey'))).toEqual(['High', 'High', false, false]);
    const after = road(progress(raised, ids.Survey, 100, '2026-10-08T16:00:00.000Z'), N, UNMOVED);
    expect([...reads(row(after, ids.Survey)), ...done(row(after, ids.Survey))]).toEqual(['High', 'High', false, false, 100, 'Complete']);
  });

  it('a priority he set himself on a finished task stays his: Low stays Low, and a High he set stays High', () => {
    const low = road(progress(sets(onE, ids.Roof, 'Low'), ids.Roof, 100), N, UNMOVED);
    expect(reads(row(low, ids.Roof))).toEqual(['Low', 'Medium', true, true]);
    const high = road(progress(sets(onE, ids.Demo, 'High'), ids.Demo, 100), N, UNMOVED);
    expect(reads(row(high, ids.Demo))).toEqual(['High', 'Medium', true, true]);
  });

  it('not raised for ever: he opens the task again (40%), and the NEXT master that leaves it on its dates raises it', () => {
    const afterN = road(progress(onE, ids.Demo, 100), N, UNMOVED);
    expect(row(afterN, ids.Demo).priority).toBe('Medium');
    const reopened = progress(afterN, ids.Demo, 40, '2026-10-12T09:00:00.000Z');
    const afterH = road(reopened, H, [line('Demo'), line('Survey'), line('Roof'), line('Paint')]);
    expect([...reads(row(afterH, ids.Demo)), ...done(row(afterH, ids.Demo))]).toEqual(['High', 'High', false, false, 40, 'In Progress']);
  });

  it('a finished task the master MOVES is as it was before this change: its new row holds its own file\'s priority, and the old row is left alone', () => {
    const finished = progress(onE, ids.Demo, 100);
    const after = road(finished, N, ['Demo,Alpha,Lot,06/02/2026,06/08/2026,,', line('Survey'), line('Roof', '', 'Yes'), line('Paint')]);
    const moved = after.items.filter(item => item.taskName === 'Demo' && item.id !== ids.Demo);
    expect(moved).toHaveLength(1);
    expect([moved[0].startDate, moved[0].finishDate, ...reads(moved[0]), ...done(moved[0])]).toEqual(['06/02/2026', '06/08/2026', 'High', 'High', false, false, 100, 'Complete']);
    expect(row(after, ids.Demo)).toEqual(row(finished, ids.Demo));
  });
});

describe('C-2: on the desktop, after Make Current', () => {
  it('the finished tasks the uploaded master left on their dates read Medium before and after it is made current; the open one reads High', () => {
    const finished = progress(progress(onE, ids.Demo, 100), ids.Roof, 100);
    const uploaded = upload(finished, N, UNMOVED);
    const current = makeCurrent(uploaded, N, '2026-10-09T13:00:00.000Z');
    const priorities = (state: State) => ['Demo', 'Survey', 'Roof', 'Paint'].map(name => one(state, name).priority);
    expect([priorities(uploaded), priorities(current)]).toEqual(Array(2).fill(['Medium', 'High', 'Medium', 'Medium']));
    expect(['Demo', 'Survey', 'Roof', 'Paint'].map(name => one(current, name).id)).toEqual([ids.Demo, ids.Survey, ids.Roof, ids.Paint]);
  });
});
