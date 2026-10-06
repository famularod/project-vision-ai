/*
 * Review pass 4, schedules part 2 (6 Oct 2026), same-named tasks.
 *
 * P2-1 (Medium, caused by 9a1c22d with 14b3569 and f8ba60b): Microsoft Project's Unique ID was looked at only among
 * same-named twins. Where one row met one task (a master that dropped one Pour slab and added another leaves one of
 * each at Make Current and Set Active), they were paired as "the task, moved", and the new task took the dropped
 * one's note, owner, approval and schedule impact.
 *
 * The scenarios are the schedule reviewer's QA and QA-phone (notes/p4-sched/part2/q30-direct.test.ts), with what
 * each place shows asserted.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { daveWebScheduleImportPairingQuestions, planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
/** Each Pour slab shown: its start, percent, note, owner, approval and schedule impact, and its Unique ID. */
const pours = (state: State) => shown(state).filter(item => item.taskName === 'Pour slab').map(item => {
  const controls = normalizeProjectControls(item.projectControls);
  return `${item.startDate} ${item.percentComplete}% [${item.notes || ''}] [${item.owner || ''}] ${controls.approvalStatus}/${controls.estimatedScheduleImpactDays ?? '-'}${item.sourceUniqueId ? ` id ${item.sourceUniqueId}` : ''}`;
}).sort();
const schedule = (id: string, importedAt: string, role: 'master' | 'lookahead' = 'master'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role === 'lookahead' ? { scheduleRole: 'lookahead' } : {}),
}) as ReferenceDocument;
/** A file's rows. Each line starts with the Unique ID; without Unique IDs the column is left out of the file. */
function rows(source: ReferenceDocument, lines: string[], withIds: boolean): ScheduleItem[] {
  const header = withIds ? 'Unique ID,Task,Project,Area,Start,Finish,Percent Complete' : 'Task,Project,Area,Start,Finish,Percent Complete';
  return (normalizeScheduleImport({
    contents: [header, ...lines.map(line => (withIds ? line : line.replace(/^\d*,/, '')))].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
}
/** Approved on the phone. */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[], overlay = false): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item, overlay,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string,
  });
  return { items: [...merged.additions, ...merged.next], documents: overlay ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
/** He enters 40%, a note, an owner, an approval and a schedule impact on the Pour slab that starts on this day. */
function hisWordOn(state: State, start: string, at: string): State {
  const row = shown(state).find(item => item.taskName === 'Pour slab' && item.startDate === start)!;
  return { ...state, items: state.items.map(item => (item.id === row.id ? {
    ...item, percentComplete: 40, notes: 'Forms stripped', owner: 'Mike', status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at,
    progressConfirmedBy: 'David', updatedAt: at,
    projectControls: reviseProjectControls({ current: item.projectControls, patch: { approvalStatus: 'Pending', estimatedScheduleImpactDays: 5 }, actor: 'David', now: at }),
  } as ScheduleItem : item)) };
}
function setActive(state: State, source: ReferenceDocument, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** The web: the upload's review, the upload, then Make Current. What the review asks, and the state after each step. */
function webUploadsAndMakesCurrent(state: State, source: ReferenceDocument, imported: ScheduleItem[]) {
  const snapshot = { scheduleItems: shown(state).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) };
  const asks = daveWebScheduleImportPairingQuestions({ snapshot: snapshot as never, importedScheduleItems: imported }).map(question => question.title);
  const plan = planDAVEWebScheduleImport({ snapshot: snapshot as never, importedScheduleItems: imported });
  const plain = (item: ScheduleItem) => { const { cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, plain(revision.item as ScheduleItem)]));
  const items = [...state.items.map(item => revised.get(item.id) || item), ...plan.additions.map(item => plain(item as ScheduleItem))];
  const documentsBefore = [...state.documents, { ...source, isCurrent: false } as ReferenceDocument];
  const uploaded: State = { items, documents: documentsBefore };
  const documentsAfter = scheduleDocumentsAfterActivation(documentsBefore.find(document => document.id === source.id)!, documentsBefore, 'project', source.importedAt as string);
  const carried = new Map(scheduleProgressCarriedToShownTasks({
    before: shown(uploaded), after: selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documentsAfter }) as ScheduleItem[],
    documentsBefore, documentsAfter, now: source.importedAt as string, known: items,
  }).map(item => [item.id, item]));
  return { asks, uploaded, current: { items: items.map(item => carried.get(item.id) || item), documents: documentsAfter } as State };
}

const A = schedule('MASTER A', '2026-09-20T12:00:00.000Z');
const B = schedule('MASTER B', '2026-09-27T12:00:00.000Z');
const C = schedule('MASTER C', '2026-10-04T12:00:00.000Z');
const P = (id: number | '', start: string, finish: string) => `${id},Pour slab,Alpha,Lot,${start},${finish},`;
const FRAMING = '900,Framing,Alpha,Lot,11/30/2026,12/04/2026,';
const HIS = '40% [Forms stripped] [Mike] Pending/5';
const NONE = '0% [] [] Not Required/-';
/** Master A: three Pour slabs a week apart; his 40%, note, owner, approval and impact on the first. */
const THREE = [P(101, '10/12/2026', '10/16/2026'), P(102, '10/19/2026', '10/23/2026'), P(103, '10/26/2026', '10/30/2026'), FRAMING];
/** Master C: the first is dropped, and a new one (105) is added three weeks on. */
const DROPS_ONE_ADDS_ONE = [P(102, '10/19/2026', '10/23/2026'), P(103, '10/26/2026', '10/30/2026'), P(105, '11/16/2026', '11/20/2026'), FRAMING];
const onA = (withIds: boolean, lines = THREE, hisDay = '10/12/2026') => hisWordOn(approve({ items: [], documents: [] }, A, rows(A, lines, withIds)), hisDay, '2026-09-22T15:00:00.000Z');

describe('Review P4 P2-1: two rows that carry different Unique IDs are never the same task', () => {
  it('QA: the web uploads a master that drops one Pour slab and adds another. After Make Current the new task has nothing of the dropped one', () => {
    const { asks, uploaded, current } = webUploadsAndMakesCurrent(onA(true), C, rows(C, DROPS_ONE_ADDS_ONE, true));
    expect(asks).toEqual([]);
    expect(pours(uploaded)).toEqual([`10/12/2026 ${HIS} id 101`, `10/19/2026 ${NONE} id 102`, `10/26/2026 ${NONE} id 103`]);
    // (It was: "11/16/2026 0% [Forms stripped] [Mike] Pending/5 id 105". One task of the name left the list and one
    // came into it, so they were paired as the task, moved.)
    expect(pours(current)).toEqual([`10/19/2026 ${NONE} id 102`, `10/26/2026 ${NONE} id 103`, `11/16/2026 ${NONE} id 105`]);
  });

  it('QA-phone: the same master approved on the phone, then Set Active to the old master and back: the same', () => {
    const onC = approve(onA(true), C, rows(C, DROPS_ONE_ADDS_ONE, true));
    const clean = [`10/19/2026 ${NONE} id 102`, `10/26/2026 ${NONE} id 103`, `11/16/2026 ${NONE} id 105`];
    expect(pours(onC)).toEqual(clean);
    const backOnA = setActive(onC, A, '2026-10-05T12:00:00.000Z');
    expect(pours(backOnA)).toEqual([`10/12/2026 ${HIS} id 101`, `10/19/2026 ${NONE} id 102`, `10/26/2026 ${NONE} id 103`]);
    // (It was: his note, owner, approval and impact on 105 after the second Set Active.)
    expect(pours(setActive(backOnA, C, '2026-10-05T12:05:00.000Z'))).toEqual(clean);
  });

  it('one Pour slab only, and the master replaces it with another (a different id): a new task, on the phone and on the web', () => {
    const one = () => onA(true, [P(101, '10/12/2026', '10/16/2026'), FRAMING]);
    const other = [P(105, '11/16/2026', '11/20/2026'), FRAMING];
    // (It was, in both places: "11/16/2026 40% [Forms stripped] [Mike] Pending/5 id 105".)
    expect(pours(approve(one(), C, rows(C, other, true)))).toEqual([`11/16/2026 ${NONE} id 105`]);
    expect(pours(webUploadsAndMakesCurrent(one(), C, rows(C, other, true)).current)).toEqual([`11/16/2026 ${NONE} id 105`]);
  });

  it('the same id is the same task wherever it goes, with no question, as before: moved five weeks on, past its twins, it keeps what he set on it', () => {
    const moved = [P(102, '10/19/2026', '10/23/2026'), P(103, '10/26/2026', '10/30/2026'), P(101, '11/16/2026', '11/20/2026'), FRAMING];
    const kept = [`10/19/2026 ${NONE} id 102`, `10/26/2026 ${NONE} id 103`, `11/16/2026 ${HIS} id 101`];
    expect(scheduleImportReviewPairingQuestions({ saved: onA(true).items, documents: onA(true).documents, importBatchId: C.importBatchId!, imported: rows(C, moved, true) })).toEqual([]);
    const onC = approve(onA(true), C, rows(C, moved, true));
    expect(pours(onC)).toEqual(kept);
    expect(pours(setActive(setActive(onC, A, '2026-10-05T12:00:00.000Z'), C, '2026-10-05T12:05:00.000Z'))).toEqual(kept);
    const web = webUploadsAndMakesCurrent(onA(true), C, rows(C, moved, true));
    expect([web.asks, pours(web.current)]).toEqual([[], kept]);
  });

  it('where either side carries no Unique ID nothing changes: one row and one task of a name are the task, moved', () => {
    const one = (withIds: boolean) => onA(withIds, [P(101, '10/12/2026', '10/16/2026'), FRAMING]);
    const later = [P(105, '11/16/2026', '11/20/2026'), FRAMING];
    // No ids at all.
    expect(pours(approve(one(false), C, rows(C, later, false)))).toEqual([`11/16/2026 ${HIS}`]);
    expect(pours(webUploadsAndMakesCurrent(one(false), C, rows(C, later, false)).current)).toEqual([`11/16/2026 ${HIS}`]);
    // A task saved before the app kept the id, and a file that carries one; and the other way round.
    expect(pours(approve(one(false), C, rows(C, later, true)))).toEqual([`11/16/2026 ${HIS} id 105`]);
    expect(pours(approve(one(true), C, rows(C, later, false)))).toEqual([`11/16/2026 ${HIS}`]);
  });

  it('a lookahead pairs as before, whatever ids its file carries: it restates the task he sees', () => {
    const one = onA(true, [P(101, '10/12/2026', '10/16/2026'), FRAMING]);
    const L = schedule('LOOKAHEAD L', '2026-10-04T12:00:00.000Z', 'lookahead');
    const restated = approve(one, L, rows(L, [P(7, '10/13/2026', '10/17/2026')], true), true);
    expect(pours(restated)).toEqual([`10/13/2026 ${HIS} id 101`]);
  });

  it('a master that lists a task again on the very days of a saved row with another id does not take that row for it', () => {
    // Master B drops 101 (10/12) and keeps 102. Master C lists a new Pour slab, 104, on 10/12 to 10/16.
    const onB = approve(onA(true, [P(101, '10/12/2026', '10/16/2026'), P(102, '10/26/2026', '10/30/2026'), FRAMING]), B, rows(B, [P(102, '10/26/2026', '10/30/2026'), FRAMING], true));
    expect(pours(onB)).toEqual([`10/26/2026 ${NONE} id 102`]);
    const onC = approve(onB, C, rows(C, [P(104, '10/12/2026', '10/16/2026'), P(102, '10/26/2026', '10/30/2026'), FRAMING], true));
    // (It was: "10/12/2026 40% [Forms stripped] [Mike] Pending/5 id 101", the dropped task's own row shown again for 104.)
    expect(pours(onC)).toEqual([`10/12/2026 ${NONE} id 104`, `10/26/2026 ${NONE} id 102`]);
  });
});
