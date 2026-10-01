/**
 * Audit round 2, A5 pass 20 (1 Oct 2026): a Low finding in the schedule merge
 * (ScheduleLookahead).
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task.
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
import { scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
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
/** Delete PDF + Items on the phone (App.tsx), with the question it asks first. */
function deleteWithItems(state: State, target: ReferenceDocument, at: string): State & { question: string } {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const question = scheduleLookaheadDeleteNote(state.items, document, removed, state.documents);
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents, question };
}

/**
 * P1 (Low, caused by fd69155): master F lists Framing 10/15-10/25; lookahead
 * L1 moves it to 10/18-10/28, then L2 to 10/20-10/30; master G lists Framing
 * on L2's dates, so L1's dates are marked replaced. David makes F current
 * again and deletes L2. Framing stayed on G's 10/20-10/30, though G is not
 * current and L1 is newer than F: it shows L1's 10/18-10/28 (at b41718d it
 * did). The same for G uploaded on the web and never made current.
 */
describe('P1: a lookahead delete falls back to dates only a master that is current replaced', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const H = doc('MASTER H', '2026-09-21T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const onL2 = () => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    return approve(state, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
  };
  const L1_DATES = ['10/18/2026', '10/28/2026', 0];
  const G_DATES = ['10/20/2026', '10/30/2026', 0];

  it('phone: G approved, Set Active back to F, Delete PDF + Items of L2: L1\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    // G marks L1's dates replaced, and says which master did.
    expect(named(state, 'Framing')[0].lookaheadOverlay!.lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', 'batch-MASTER G']);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
    const deleted = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(deleted, 'Framing')).toEqual([L1_DATES]);
    // The question before the delete says so.
    expect(deleted.question).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
  });

  it('web Make Current back to F, then the delete: L1\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = makeCurrent(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('G uploaded on the web and never made current: L1\'s dates', () => {
    const up = upload(onL2(), 'alpha-master-g.csv', ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY], G.importedAt as string);
    expect(up.state.documents.find(saved => saved.id === up.document.id)!.isCurrent).not.toBe(true);
    expect(copies(deleteWithItems(up.state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('G uploaded on the web, made current, then F again: L1\'s dates', () => {
    const up = upload(onL2(), 'alpha-master-g.csv', ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY], G.importedAt as string);
    let state = makeCurrent(up.state, up.document, '2026-09-14T13:00:00.000Z');
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('unchanged: G still current, the delete keeps G\'s dates (A6 pass 19 M1)', () => {
    const state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    const deleted = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(deleted, 'Framing')).toEqual([G_DATES]);
    expect(deleted.question).toBe('');
  });

  it('unchanged: G made current again on the web after Set Active back to F, G\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    state = makeCurrent(state, G, '2026-09-15T11:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: a newer master H repeating G\'s dates is current, the delete keeps them', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = approve(state, H, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    expect(copies(deleteWithItems(state, L2, '2026-09-22T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: G\'s own row, hidden while F is current, keeps G\'s dates for when G is current again', () => {
    // G moves Framing (a new row of G's, with the note: L1 replaced by G); L2 restates G's row on G's dates.
    // The sweep's seed 273 shape: the row the delete hides reads G's mark as before.
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    state = approve(state, G, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,', SURVEY]);
    state = approve(state, L2, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,'], true);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([['10/16/2026', '10/26/2026', 0]]); // L2's, newest
    state = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([L1_DATES]); // F's row, on L1's dates; G's row hidden
    expect(copies(setActive(state, G, '2026-09-17T10:00:00.000Z'), 'Framing')).toEqual([['10/16/2026', '10/26/2026', 0]]);
  });

  it('a mark saved before (true) still reads as replaced, whichever master is current', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    state = {
      ...state,
      items: state.items.map(item => item.lookaheadOverlay ? {
        ...item,
        lookaheadOverlay: { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(entry => ({ ...entry, datesReplacedByMaster: true })) },
      } : item),
    };
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });
});
