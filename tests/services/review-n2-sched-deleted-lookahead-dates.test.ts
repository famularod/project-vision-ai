/**
 * Review N2 F2 (pass 2 of the next round, 5 Oct 2026; Low, residue of
 * 3e1b312). Lookahead L1 moves Framing; L2 (Roof only) replaces it, so
 * Framing shows the master's dates; "Delete PDF Only" on L1; L3 moves
 * Framing; "Delete PDF + Items" on L3. Framing landed on L1's dates: a file
 * deleted earlier, dates David had not seen since L2. The file-only delete
 * saved the dates shown and left L1's entry in the task's note as it was,
 * and the delete of L3 went back to it.
 *
 * The task save that takes a task from its lookahead's dates to the master's
 * now notes it on that entry (ScheduleDateEdit), and deleting a later
 * lookahead gives the master's dates back. One device; the phone's own save
 * (App.tsx updateScheduleItem, compiled) and its "Delete PDF Only" as its
 * handler does it. Real CSV normalizer, merge, shown-schedule pick and delete
 * helpers. Synthetic data.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
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
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
const one = (state: State, name: string) => {
  const found = named(state, name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;
const saved = (state: State, id: string) => state.items.find(item => item.id === id)!;

const schedule = (id: string, importedAt: string, role?: 'lookahead', project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], project = 'Alpha'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], project = 'Alpha'): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines, project), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
/** App.tsx's own updateScheduleItem, compiled from its source, at the time given: the task as the phone saves it. */
function phoneSave(state: State, id: string, edit: Partial<ScheduleItem>, at: string): State {
  const from = APP_SOURCE.indexOf('\n  function updateScheduleItem(');
  const to = APP_SOURCE.indexOf('\n  async function saveScheduleItemChanges(', from);
  expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(`module.exports = (() => { ${APP_SOURCE.slice(from, to)}\n return updateScheduleItem; })();`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const ref = { current: state.items };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: () => 1, markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: () => undefined, scheduleItemChangeUsesDebouncedSync: () => false, cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: () => undefined, queueScheduleItemRecord: async () => undefined, Alert: { alert: () => undefined },
  };
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  jest.useFakeTimers({ now: new Date(at) });
  try { (mod.exports as (id: string, edit: Partial<ScheduleItem>) => void)(id, edit); } finally { jest.useRealTimers(); }
  return { ...state, items: ref.current };
}

/** The phone's handler for "Delete PDF Only", read from App.tsx: what it saves before it removes the file. */
const DELETE_PDF_ONLY = (() => {
  const from = APP_SOURCE.indexOf("text: 'Delete PDF Only'");
  return APP_SOURCE.slice(from, APP_SOURCE.indexOf("text: 'Delete PDF + Items'", from));
})();
/** "Delete PDF Only" as the phone does it: the helper's tasks, each saved with its two dates only, then the file goes. */
function deletePdfOnly(state: State, document: ReferenceDocument, at: string): State {
  expect(DELETE_PDF_ONLY).toContain('fileOnly: true }).forEach(item => updateScheduleItem(item.id, { startDate: item.startDate, finishDate: item.finishDate }))');
  let next = state;
  scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, updatedAt: at })
    .forEach(task => { next = phoneSave(next, task.id, { startDate: task.startDate, finishDate: task.finishDate }, at); });
  return { items: next.items, documents: next.documents.filter(other => other.id !== document.id) };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents };
}

const M = schedule('MASTER M', '2026-09-07T12:00:00.000Z');
const L0 = schedule('LOOKAHEAD L0', '2026-09-08T12:00:00.000Z', 'lookahead');
const L1 = schedule('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-10T12:00:00.000Z', 'lookahead');
const L3 = schedule('LOOKAHEAD L3', '2026-09-12T12:00:00.000Z', 'lookahead');
const MASTERS = '10/01/2026-10/11/2026';
const onM = approve(EMPTY, M, ['Framing,Alpha,Lot,10/01/2026,10/11/2026,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,']);
const framingId = one(onM, 'Framing').id;
const FRAMING_L1 = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,';
const ROOF_L2 = 'Roof,Alpha,Lot,10/14/2026,10/22/2026,';
const FRAMING_L3 = 'Framing,Alpha,Lot,10/08/2026,10/18/2026,';
const DELETED_L1 = '2026-09-11T12:00:00.000Z';
const DELETED_L3 = '2026-09-13T12:00:00.000Z';
const keptMarks = (state: State) => (saved(state, framingId).lookaheadOverlay?.lookaheads || []).map(entry => [entry.batchId, entry.datesKeptAt ?? null]);
const entries = (state: State) => (saved(state, framingId).lookaheadOverlay?.lookaheads || []).map(entry => [entry.batchId, entry.startDate, entry.datesLeftAt ?? null]);

describe('Review N2 F2: a task does not go back to the dates of a lookahead file he deleted earlier', () => {
  const onL1 = approve(onM, L1, [FRAMING_L1]);
  const onL2 = approve(onL1, L2, [ROOF_L2]);
  const withoutL1 = deletePdfOnly(onL2, L1, DELETED_L1);

  it('L1 moved Framing and L2 replaced it: Framing shows the master\'s dates, saved on L1\'s', () => {
    expect([dates(one(onL2, 'Framing')), dates(saved(onL2, framingId))]).toEqual([MASTERS, '10/05/2026-10/15/2026']);
  });

  it('Delete PDF Only on L1 saves the dates shown, and notes on L1\'s entry that the task left its dates', () => {
    expect([dates(one(withoutL1, 'Framing')), dates(saved(withoutL1, framingId))]).toEqual([MASTERS, MASTERS]);
    expect(entries(withoutL1)).toEqual([[L1.importBatchId, '10/05/2026', DELETED_L1]]);
    expect(withoutL1.items.some(item => item.savedLookaheadDates)).toBe(false);
  });

  it('then L3 moves Framing and is deleted with its items: Framing is back on the master\'s dates, not L1\'s', () => {
    const onL3 = approve(withoutL1, L3, [FRAMING_L3]);
    expect(dates(one(onL3, 'Framing'))).toBe('10/08/2026-10/18/2026');
    const after = deleteWithItems(onL3, L3, DELETED_L3);
    expect([dates(one(after, 'Framing')), dates(saved(after, framingId))]).toEqual([MASTERS, MASTERS]);
  });

  it('the same end as Delete PDF + Items on the replaced L1 (which removes its entry)', () => {
    const withItems = deleteWithItems(onL2, L1, DELETED_L1);
    expect(entries(withItems)).toEqual([]);
    expect(dates(one(deleteWithItems(approve(withItems, L3, [FRAMING_L3]), L3, DELETED_L3), 'Framing'))).toBe(MASTERS);
  });

  it('the helper gives the web the task as the phone\'s save leaves it', () => {
    const [fromHelper] = scheduleItemsAfterScheduleDeleted({ items: onL2.items, removed: [], document: L1, documents: onL2.documents, fileOnly: true, updatedAt: DELETED_L1 });
    expect(fromHelper).toEqual(saved(withoutL1, framingId));
  });

  it('an earlier lookahead before L1 gives no dates back either: the task had left them all', () => {
    const onL0 = approve(onM, L0, ['Framing,Alpha,Lot,10/03/2026,10/13/2026,']);
    const replaced = approve(approve(onL0, L1, [FRAMING_L1]), L2, [ROOF_L2]);
    // (L0's file is still saved; only L1 is deleted alone.)
    const without = deletePdfOnly(replaced, L1, DELETED_L1);
    expect(entries(without)).toEqual([[L0.importBatchId, '10/03/2026', null], [L1.importBatchId, '10/05/2026', DELETED_L1]]);
    const after = deleteWithItems(approve(without, L3, [FRAMING_L3]), L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe(MASTERS);
  });

  it('the percent L1 gave is still the earlier progress the delete of L3 puts back', () => {
    const gave = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,30']), L2, [ROOF_L2]);
    const onL3 = approve(deletePdfOnly(gave, L1, DELETED_L1), L3, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,50']);
    expect(one(onL3, 'Framing').percentComplete).toBe(50);
    const after = deleteWithItems(onL3, L3, DELETED_L3);
    expect([dates(one(after, 'Framing')), one(after, 'Framing').percentComplete]).toEqual([MASTERS, 30]);
  });
});

describe('Review N2 F2: what stays as it was', () => {
  const onL1 = approve(onM, L1, [FRAMING_L1]);

  it('Delete PDF Only on the lookahead in effect keeps its tasks on its dates: the delete of a later one goes back to them', () => {
    const kept = deletePdfOnly(onL1, L1, DELETED_L1);
    expect(dates(one(kept, 'Framing'))).toBe('10/05/2026-10/15/2026');
    expect(entries(kept)).toEqual([[L1.importBatchId, '10/05/2026', null]]);
    // The delete writes nothing (review N2 F3). The next lookahead to move the task finds it on L1's dates with L1's
    // file gone, and says so on L1's entry: those dates were kept.
    expect(kept.items).toEqual(onL1.items);
    const onL3 = approve(kept, L3, [FRAMING_L3]);
    expect(keptMarks(onL3)).toEqual([[L1.importBatchId, L3.importedAt], [L3.importBatchId, null]]);
    const after = deleteWithItems(onL3, L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe('10/05/2026-10/15/2026');
  });

  it('the same two dates saved again on a task whose note says when its lookahead was imported note nothing', () => {
    const again = phoneSave(onL1, framingId, { startDate: '10/05/2026', finishDate: '10/15/2026' }, DELETED_L1);
    expect([entries(again), keptMarks(again)]).toEqual([[[L1.importBatchId, '10/05/2026', null]], [[L1.importBatchId, null]]]);
    // So L1 deleted alone after L3 replaced it still gives no dates back when L3 is deleted (the other order, below).
    const after = deleteWithItems(deletePdfOnly(approve(again, L3, [FRAMING_L3]), L1, DELETED_L1), L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe(MASTERS);
  });

  it('moved by hand off L1\'s dates after its file was deleted: L3 does not find the task on them, and nothing says they were kept', () => {
    const moved = phoneSave(deletePdfOnly(onL1, L1, DELETED_L1), framingId, { startDate: '10/06/2026', finishDate: '10/16/2026' }, DELETED_L1);
    expect(keptMarks(approve(moved, L3, [FRAMING_L3]))).toEqual([[L1.importBatchId, null], [L3.importBatchId, null]]);
  });

  it('with every file kept, deleting L3 with its items goes back to L1\'s dates while L1 is in effect', () => {
    const after = deleteWithItems(approve(onL1, L3, [FRAMING_L3]), L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe('10/05/2026-10/15/2026');
  });

  it('both dates moved by hand to other dates is a hand move, noted nowhere, as before', () => {
    const moved = phoneSave(onL1, framingId, { startDate: '10/06/2026', finishDate: '10/16/2026' }, DELETED_L1);
    expect([dates(saved(moved, framingId)), entries(moved)]).toEqual(['10/06/2026-10/16/2026', [[L1.importBatchId, '10/05/2026', null]]]);
  });

  it('a percent or a note saved on the task notes nothing', () => {
    const noted = phoneSave(phoneSave(onL1, framingId, { percentComplete: 20 }, DELETED_L1), framingId, { notes: 'Crew short' }, DELETED_L1);
    expect(entries(noted)).toEqual([[L1.importBatchId, '10/05/2026', null]]);
  });
});

describe('Review N2 F2, the other order: the later lookahead had moved the task too', () => {
  /** L1 moves Framing; L3 moves it again, so L3 replaces L1 and Framing is on L3's dates. */
  const onL3 = approve(approve(onM, L1, [FRAMING_L1]), L3, [FRAMING_L3]);

  it('Delete PDF Only on L1 has nothing shown to save: no task is written, L1\'s entry stays under L3\'s', () => {
    expect(scheduleItemsAfterScheduleDeleted({ items: onL3.items, removed: [], document: L1, documents: onL3.documents, fileOnly: true })).toEqual([]);
    const without = deletePdfOnly(onL3, L1, DELETED_L1);
    expect(without.items).toEqual(onL3.items);
    expect(dates(one(without, 'Framing'))).toBe('10/08/2026-10/18/2026');
  });

  it('then Delete PDF + Items on L3: the master\'s dates, not L1\'s (it went back to the file deleted earlier)', () => {
    const after = deleteWithItems(deletePdfOnly(onL3, L1, DELETED_L1), L3, DELETED_L3);
    expect([dates(one(after, 'Framing')), dates(saved(after, framingId))]).toEqual([MASTERS, MASTERS]);
  });

  it('with L1\'s file kept, deleting L3 puts L1 back in effect, on its dates, as before', () => {
    expect(dates(one(deleteWithItems(onL3, L3, DELETED_L3), 'Framing'))).toBe('10/05/2026-10/15/2026');
  });

  it('L1\'s file still saved when L3 moves the task: nothing says its dates were kept', () => {
    expect(keptMarks(onL3)).toEqual([[L1.importBatchId, null], [L3.importBatchId, null]]);
    expect(keptMarks(deletePdfOnly(onL3, L1, DELETED_L1))).toEqual([[L1.importBatchId, null], [L3.importBatchId, null]]);
  });

  it('a lookahead deleted alone on Build 229 while in effect, then L3 approved on this build: L3 finds the task on its dates, and L3\'s delete goes back to them', () => {
    const asBuild229: State = { items: approve(onM, L1, [FRAMING_L1]).items, documents: onM.documents };
    expect(dates(one(asBuild229, 'Framing'))).toBe('10/05/2026-10/15/2026');
    const after = deleteWithItems(approve(asBuild229, L3, [FRAMING_L3]), L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe('10/05/2026-10/15/2026');
  });

  it('with L3 approved before this build too, nothing says L1\'s dates were kept: L3\'s delete gives the master\'s', () => {
    const asBuild229: State = { items: approve(onM, L1, [FRAMING_L1]).items, documents: onM.documents };
    const onL3Then = approve(asBuild229, L3, [FRAMING_L3]);
    const unmarked: State = {
      ...onL3Then,
      items: onL3Then.items.map(item => (item.lookaheadOverlay
        ? { ...item, lookaheadOverlay: { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(({ datesKeptAt: _kept, ...entry }) => entry) } }
        : item)),
    };
    expect(dates(one(deleteWithItems(unmarked, L3, DELETED_L3), 'Framing'))).toBe(MASTERS);
  });

  it('an approval that is not told which files are saved notes nothing', () => {
    const asBuild229: State = { items: approve(onM, L1, [FRAMING_L1]).items, documents: onM.documents };
    const merged = mergeApprovedScheduleImportItems({
      existing: asBuild229.items, imported: rows(L3, [FRAMING_L3]), completionMatch: () => null, mergeCompletion: item => item,
      isCurrent: () => true, approvedAt: L3.importedAt, overlay: true,
    });
    const framing = merged.next.find(item => item.id === framingId)!;
    expect((framing.lookaheadOverlay?.lookaheads || []).map(entry => [entry.batchId, entry.datesKeptAt ?? null])).toEqual([[L1.importBatchId, null], [L3.importBatchId, null]]);
  });
});

describe('Review N2 F2: both dates set back to the master\'s by hand read the same', () => {
  it('L1 in effect, he types the master\'s dates back; L3 moves the task and is deleted: the dates he had set', () => {
    const onL1 = approve(onM, L1, [FRAMING_L1]);
    const back = phoneSave(onL1, framingId, { startDate: '10/01/2026', finishDate: '10/11/2026' }, DELETED_L1);
    expect(entries(back)).toEqual([[L1.importBatchId, '10/05/2026', DELETED_L1]]);
    expect(dates(one(back, 'Framing'))).toBe(MASTERS);
    const after = deleteWithItems(approve(back, L3, [FRAMING_L3]), L3, DELETED_L3);
    expect(dates(one(after, 'Framing'))).toBe(MASTERS);
  });
});
