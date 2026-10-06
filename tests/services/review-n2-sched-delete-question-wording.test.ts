/**
 * Review N2, wording (pass 2 of the next round, part 2, 5 Oct 2026; Low).
 * The phone's delete question for a lookahead a newer one replaced (owner
 * answer Q25) said "Delete PDF + Items also puts back the earlier dates and
 * progress of 1 task this lookahead changed", though the task already shows
 * the master's dates and no date David sees moves. It now says dates only
 * when a date he sees changes with the delete. The question's own helper,
 * the phone's delete, the real CSV normalizer, merge and shown-schedule pick.
 * Synthetic data.
 */
import { scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
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
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const AT = '2026-09-16T12:00:00.000Z';
const onM = approve(EMPTY, M, ['Framing,Alpha,Lot,10/01/2026,10/11/2026,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,']);
const ROOF_L2 = 'Roof,Alpha,Lot,10/14/2026,10/22/2026,';
/** The question's added words, as App.tsx asks for them: the saved tasks, the file, the tasks only it contains, the schedules. */
const question = (state: State, document: ReferenceDocument) => scheduleLookaheadDeleteNote(
  state.items, document, scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike)), state.documents);
const framing = (state: State) => `${dates(one(state, 'Framing'))} ${one(state, 'Framing').percentComplete}%`;

describe('Review N2 wording: the delete question for a replaced lookahead says only what David will see', () => {
  it('it moved Framing and gave it 60%: the progress goes back, and no date he sees moves', () => {
    const onL2 = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,60']), L2, [ROOF_L2]);
    expect(question(onL2, L1)).toBe(' Delete PDF + Items also puts back the earlier progress of 1 task this lookahead changed.');
    // And that is what happens.
    expect([framing(onL2), framing(deleteWithItems(onL2, L1, AT))]).toEqual(['10/01/2026-10/11/2026 60%', '10/01/2026-10/11/2026 0%']);
  });

  it('it only moved Framing: nothing he sees goes back, so nothing is added', () => {
    const onL2 = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,']), L2, [ROOF_L2]);
    expect(question(onL2, L1)).toBe('');
    expect([framing(onL2), framing(deleteWithItems(onL2, L1, AT))]).toEqual(['10/01/2026-10/11/2026 0%', '10/01/2026-10/11/2026 0%']);
  });

  it('two tasks, one percent: the progress of 1 task', () => {
    const onL2 = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,60', 'Roof,Alpha,Lot,10/15/2026,10/23/2026,']),
      L2, ['Drywall,Alpha,Lot,10/23/2026,11/02/2026,']);
    expect(question(onL2, L1)).toBe(' Delete PDF + Items also puts back the earlier progress of 1 task this lookahead changed.');
  });
});

describe('Review N2 wording: the question for the lookahead in effect is as before', () => {
  it('dates and progress, when both go back', () => {
    const onL1 = approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,60']);
    expect(question(onL1, L1)).toBe(' Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    expect([framing(onL1), framing(deleteWithItems(onL1, L1, AT))]).toEqual(['10/05/2026-10/15/2026 60%', '10/01/2026-10/11/2026 0%']);
  });

  it('dates alone', () => {
    const onL1 = approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,']);
    expect(question(onL1, L1)).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
  });

  it('the newest lookahead, with an older one that applies again: both sentences', () => {
    const onL2 = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,']), L2, [ROOF_L2]);
    expect(question(onL2, L2)).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed. The lookahead of Sep 8, 2026 applies again.');
  });

  it('without the schedules given, as before: the saved dates decide', () => {
    const onL2 = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,']), L2, [ROOF_L2]);
    expect(scheduleLookaheadDeleteNote(onL2.items, L1)).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
  });
});
