/**
 * Audit round 2, A5 pass 21 (1 Oct 2026): Low findings in the schedule merge,
 * each caused by the previous round's fixes. R1 (b98824e): Set Active / Make
 * Current (ScheduleImportMerge, ScheduleLookahead).
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task, its
 * percent floored at David's own.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items and
 * shown-task pick, and the web's upload plan and Make Current carry.
 * Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation, scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const doc = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
/** A CSV's rows through the real normalizer, with the import's provenance. */
const rows = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
  mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
/** Each shown copy of a task: start, finish and percent. */
const copies = (state: State, name: string) => named(state, name).map(item => [item.startDate, item.finishDate, item.percentComplete]);

/** Approving a schedule on the phone (App.tsx): a master is made current; a lookahead adds to it (Q22). */
function approve(state: State, source: ReferenceDocument, lines: string[], lookahead = false): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...(lookahead ? { overlay: true } : {}),
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A master uploaded on the web: planned against the tasks the web shows, saved not current. */
function upload(state: State, fileName: string, lines: string[], now: string): { state: State; document: ReferenceDocument } {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName, mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: fileName.padEnd(64, 'x').slice(0, 64), now,
  });
  const webShown = shown(state).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown as any }, importedScheduleItems: prepared.scheduleItems });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  return {
    document: prepared.document as ReferenceDocument,
    state: { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, prepared.document as ReferenceDocument] },
  };
}
/** Make Current on the web: the schedule current, and the carry over the tasks shown before and after. */
function makeCurrent(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(entry => entry.id === document.id)!;
  const current: State = { ...state, documents: scheduleDocumentsAfterActivation(target, state.documents, 'project') };
  const carried = new Map(scheduleProgressCarriedToShownTasks({
    before: shown(state), after: shown(current), documentsBefore: state.documents, documentsAfter: current.documents, now,
  }).map(item => [item.id, item]));
  return { ...current, items: current.items.map(item => carried.get(item.id) || item) };
}
/** Set Active on the phone, with its progress carry (App.tsx). */
function setActive(state: State, target: ReferenceDocument, now: string): State {
  const saved = state.documents.find(document => document.id === target.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(saved, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** Delete PDF + Items on the phone (App.tsx). */
function deleteWithItems(state: State, target: ReferenceDocument, at: string): State {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
}
/**
 * R1 (Low, caused by b98824e): master F lists Framing 10/15-10/25; lookahead
 * L1 moves it to 10/18-10/28, then L2 to 10/20-10/30; master G lists Framing
 * on L2's dates, so the task is updated in place and L1's dates are marked
 * replaced by G. With F current again (Set Active), or G uploaded on the web
 * and not yet current, deleting L2 rightly gives L1's 10/18-10/28. Making G
 * current then left Framing on 10/18-10/28, though G is newer than L1 and
 * lists 10/20-10/30 (at c73ceab it ended on G's dates).
 */
describe('R1: making the master that replaced a lookahead\'s dates current again gives its dates', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const H = doc('MASTER H', '2026-09-21T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const G_LINES = ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY];
  const onL2 = () => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    return approve(state, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
  };
  const L1_DATES = ['10/18/2026', '10/28/2026', 0];
  const G_DATES = ['10/20/2026', '10/30/2026', 0];
  /** Route B: G approved on the phone, F current again, L2 deleted. */
  const routeB = () => {
    let state = approve(onL2(), G, G_LINES);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    return deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
  };
  /** Route A: G uploaded on the web, not current; L2 deleted on the phone. */
  const routeA = () => {
    const up = upload(onL2(), 'alpha-master-g.csv', G_LINES, G.importedAt as string);
    return { state: deleteWithItems(up.state, L2, '2026-09-16T10:00:00.000Z'), G: up.document };
  };
  const AT = '2026-09-17T10:00:00.000Z';

  it('route B: after the delete under F, L1\'s dates (unchanged, A5 pass 20 P1)', () => {
    expect(copies(routeB(), 'Framing')).toEqual([L1_DATES]);
  });

  it.each([
    ['phone Set Active', (state: State) => setActive(state, G, AT)],
    ['web Make Current', (state: State) => makeCurrent(state, G, AT)],
  ] as const)('route B, then %s of G: G\'s 10/20-10/30', (_how, current) => {
    const after = current(routeB());
    expect(copies(after, 'Framing')).toEqual([G_DATES]);
    expect(named(after, 'Framing')[0].updatedAt).toBe(AT);
  });

  it.each([
    ['web Make Current', (state: State, master: ReferenceDocument) => makeCurrent(state, master, AT)],
    ['phone Set Active', (state: State, master: ReferenceDocument) => setActive(state, master, AT)],
  ] as const)('route A: G uploaded on the web, L2 deleted, then %s of G: G\'s 10/20-10/30', (_how, current) => {
    const { state, G: uploaded } = routeA();
    expect(copies(state, 'Framing')).toEqual([L1_DATES]);
    expect(copies(current(state, uploaded), 'Framing')).toEqual([G_DATES]);
  });

  it('a later master repeating G\'s dates keeps them', () => {
    const state = approve(setActive(routeB(), G, AT), H, G_LINES);
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
  });

  it('F current again after G: L1\'s dates again, as at the delete (L1 is newer than F)', () => {
    let state = setActive(routeB(), G, AT);
    state = setActive(state, F, '2026-09-18T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([L1_DATES]);
    expect(copies(makeCurrent(state, G, '2026-09-19T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
    expect(copies(makeCurrent(setActive(routeB(), G, AT), F, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('unchanged: Set Active of F with no delete keeps L2\'s dates (G listed them too)', () => {
    let state = approve(onL2(), G, G_LINES);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: a newer lookahead L3 on its own dates stays when G is made current', () => {
    const L3 = doc('LOOKAHEAD L3', '2026-09-16T18:00:00.000Z', 'lookahead');
    const state = approve(routeB(), L3, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([['10/22/2026', '11/01/2026', 0]]);
  });

  it('unchanged: dates David moved by hand after the delete stay', () => {
    const moved = routeB();
    const id = named(moved, 'Framing')[0].id;
    const state = { ...moved, items: moved.items.map(item => item.id === id ? { ...item, startDate: '10/19/2026', finishDate: '10/29/2026' } : item) };
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([['10/19/2026', '10/29/2026', 0]]);
  });
});
