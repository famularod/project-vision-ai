/**
 * Review N2 G2 (pass 2 of the next round, part 2, 5 Oct 2026; Low, older:
 * the same on Build 229; ce64474 did not reach it). Pour slabs on 10/01,
 * 10/15 and 10/29; a lookahead lists the second one week later (10/22) and
 * the third two days later (10/31). The 10/22 row is as near to the second
 * as to the third, so it pairs with neither and came in as a new task, with
 * no question: the tie was counted only among the tasks left unpaired, and
 * the third had been taken by the 10/31 row. Listed alone, it was asked.
 *
 * A row the guess leaves new is now also asked about when two of all the
 * saved same-named tasks are equally nearest to it. The merge and its review
 * questions, the real CSV normalizer and shown-schedule pick. Synthetic data.
 */
import { scheduleImportPairingQuestions, scheduleImportReviewPairingQuestions } from '../../services/ScheduleImportMerge';
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

const M = schedule('MASTER M', '2026-09-01T12:00:00.000Z');
const L = schedule('LOOKAHEAD L', '2026-09-08T12:00:00.000Z', 'lookahead');
const onM = approve(EMPTY, M, [
  'Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Pour slab,Alpha,Lot,10/29/2026,11/02/2026,',
  'Framing,Alpha,Lot,11/20/2026,11/30/2026,',
]);
const [firstId, secondId, thirdId] = named(onM, 'Pour slab').sort((left, right) => (left.startDate < right.startDate ? -1 : 1)).map(item => item.id);
/** His own percent and a note naming each. */
const withHis = [[firstId, 80, 'first'], [secondId, 40, 'second'], [thirdId, 10, 'third']].reduce((state, [id, percent, note]) =>
  phoneSave(phoneSave(state, id as string, { percentComplete: percent as number }, '2026-09-02T09:00:00.000Z'), id as string, { notes: note as string }, '2026-09-02T09:05:00.000Z'), onM);
const pours = (state: State) => named(state, 'Pour slab').map(item => `${dates(item)} ${item.percentComplete}% ${item.notes}`.trim()).sort();
const asked = (lines: string[]) => scheduleImportReviewPairingQuestions({
  saved: withHis.items, documents: withHis.documents, importBatchId: L.importBatchId!, imported: rows(L, lines), overlay: true,
});
function approveAnswered(lines: string[], pairingChoices?: Record<string, string | null>): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: withHis.items, imported: rows(L, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(withHis.items, [...withHis.documents, L], L.importBatchId || ''),
    approvedAt: L.importedAt, overlay: true, ...(pairingChoices ? { pairingChoices } : {}),
  });
  return { items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]), documents: [...withHis.documents, L] };
}
/** The second one week later, the third two days later. */
const TIED = ['Pour slab,Alpha,Lot,10/22/2026,10/26/2026,', 'Pour slab,Alpha,Lot,10/31/2026,11/04/2026,'];
const [row1022, row1031] = rows(L, TIED);

describe('Review N2 G2: a lookahead row tied between two same-named tasks is asked about when another row took one of them', () => {
  it('10/22 is as near to the second as to the third, and 10/31 takes the third: he is asked (he was not)', () => {
    const [question, ...others] = asked(TIED);
    expect(others).toEqual([]);
    expect(question.title).toBe('3 tasks named Pour slab in Lot — confirm which is which');
    expect(question.saved.map(item => item.notes)).toEqual(['first', 'second', 'third']);
    // The app's guess, as before: 10/31 is the third, 10/22 a new task.
    expect(question.guess).toEqual({ [row1022.id]: null, [row1031.id]: thirdId });
  });

  it('asked from the tasks shown too (the web\'s upload review asks through the same check)', () => {
    expect(scheduleImportPairingQuestions({ existing: shown(withHis), imported: rows(L, TIED), overlay: true })).toHaveLength(1);
  });

  it('confirmed as guessed, the approval does what it did unasked: 10/22 comes in new', () => {
    const unasked = approveAnswered(TIED);
    expect(pours(unasked)).toEqual([
      '10/01/2026-10/05/2026 80% first', '10/15/2026-10/19/2026 40% second', '10/22/2026-10/26/2026 0%', '10/31/2026-11/04/2026 10% third',
    ]);
    expect(pours(approveAnswered(TIED, { [row1022.id]: null, [row1031.id]: thirdId }))).toEqual(pours(unasked));
  });

  it('answered (10/22 is the second), three Pour slabs, each with his percent and note', () => {
    expect(pours(approveAnswered(TIED, { [row1022.id]: secondId, [row1031.id]: thirdId }))).toEqual([
      '10/01/2026-10/05/2026 80% first', '10/22/2026-10/26/2026 40% second', '10/31/2026-11/04/2026 10% third',
    ]);
  });
});

describe('Review N2 G2: what is asked, and not asked, as before', () => {
  it('the tied row listed alone is asked (ce64474)', () => {
    expect(asked([TIED[0]])).toHaveLength(1);
  });

  it('rows on exactly the three tasks\' days: no question', () => {
    expect(asked(['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Pour slab,Alpha,Lot,10/29/2026,11/02/2026,'])).toEqual([]);
  });

  it('one row, on one task\'s days: no question', () => {
    expect(asked(['Pour slab,Alpha,Lot,10/15/2026,10/19/2026,'])).toEqual([]);
  });

  it('a row far from every Pour slab and nearest one alone, beside a row on a task\'s days: no question', () => {
    expect(asked(['Pour slab,Alpha,Lot,11/10/2026,11/14/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,'])).toEqual([]);
  });
});
