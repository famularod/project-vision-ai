/**
 * Review N2 W1 (pass 2 of the next round, part 2, 5 Oct 2026; Medium, caused
 * by e9a3443). On the web, "Delete Document" / "Delete Document Only" on a
 * replaced lookahead lowered a task's percent to what it was before that
 * file, with nothing said: master Framing 10/01-10/11; lookahead L1 gives
 * Framing 60%; L2 (Roof only) replaces L1, Framing still reads 60%; delete L1
 * on the web without its tasks: 0%. The phone's "Delete PDF Only" from the
 * same state keeps 60%.
 *
 * The web's document-only delete now does what the phone's file-only delete
 * does, by the phone's own helper, and the web's dialog says what "+ Tasks"
 * also puts back, in the phone's words. The web's plan
 * (planDAVEWebScheduleDocumentDelete), the phone's save and delete as its
 * handler does them, the real CSV normalizer, merge and shown-schedule pick.
 * Synthetic data.
 */
import { daveWebScheduleDocumentDeleteNote, planDAVEWebScheduleDocumentDelete } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
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
function phoneSave(state: State, id: string, edit: Partial<ScheduleItem>, at: string, restoresProgress = false): State {
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
  try { (mod.exports as (id: string, edit: Partial<ScheduleItem>, workflow?: unknown, restores?: boolean) => void)(id, edit, undefined, restoresProgress); } finally { jest.useRealTimers(); }
  return { ...state, items: ref.current };
}

/** The phone's handler for "Delete PDF Only", read from App.tsx: what it saves before it removes the file. */
const DELETE_PDF_ONLY = (() => {
  const from = APP_SOURCE.indexOf("text: 'Delete PDF Only'");
  return APP_SOURCE.slice(from, APP_SOURCE.indexOf("text: 'Delete PDF + Items'", from));
})();
/** "Delete PDF Only" as the phone does it: the helper's tasks, each saved as the helper gives it (review P6-5; it was its two dates only), then the file goes. */
function deletePdfOnly(state: State, document: ReferenceDocument, at: string): State {
  expect(DELETE_PDF_ONLY).toContain('fileOnly: true, withWhatHeSet: true }).forEach(item => updateScheduleItem(item.id, item as unknown as ScheduleItem, undefined, true))');
  let next = state;
  scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, withWhatHeSet: true, updatedAt: at })
    .forEach(task => { next = phoneSave(next, task.id, task, at, true); });
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

const AT = '2026-09-16T12:00:00.000Z';
const CLOUD_AT = '2026-09-15T13:00:00.000Z';
const asWeb = (items: readonly ScheduleItem[]) => items.map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: CLOUD_AT })) as DAVEWebScheduleItem[];
const asPhone = (item: ScheduleItem) => { const { projectId: _project, cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
const linkedOf = (state: State, document: ReferenceDocument) => scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
const webSnapshot = (state: State) => ({ scheduleItems: asWeb(shown(state)), knownScheduleItems: asWeb(state.items), referenceDocuments: state.documents as never });
const webDocument = (state: State, document: ReferenceDocument) =>
  ({ ...document, cloudUpdatedAt: CLOUD_AT, linkedScheduleItems: asWeb(linkedOf(state, document)), lookaheadReplaced: 'Replaced by the lookahead of Sep 15, 2026' }) as never;
/** The web's "Delete Document (Only)" or "Delete Document + N Tasks": its plan's task writes, then the deletion records. */
function webDelete(state: State, document: ReferenceDocument, keepTasks: boolean): State {
  const revisions = planDAVEWebScheduleDocumentDelete({ snapshot: webSnapshot(state), document: webDocument(state, document), updatedAt: AT, keepTasks });
  const written = new Map(revisions.map(revision => [revision.item.id, asPhone(revision.item as ScheduleItem)]));
  const removedIds = new Set(keepTasks ? [] : linkedOf(state, document).map(item => item.id));
  return { items: state.items.filter(item => !removedIds.has(item.id)).map(item => written.get(item.id) || item), documents: state.documents.filter(other => other.id !== document.id) };
}

const M = schedule('MASTER M', '2026-09-01T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const L3 = schedule('LOOKAHEAD L3', '2026-09-17T12:00:00.000Z', 'lookahead');
const onM = approve(EMPTY, M, ['Framing,Alpha,Lot,10/01/2026,10/11/2026,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,']);
const framingId = one(onM, 'Framing').id;
const FRAMING_60 = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,60';
const ROOF_L2 = 'Roof,Alpha,Lot,10/14/2026,10/22/2026,';
/** L1 gives Framing 60% and adds a detail task; L2 (Roof only) replaces L1. */
const onL2 = approve(approve(onM, L1, [FRAMING_60, 'Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,']), L2, [ROOF_L2]);
const framing = (state: State) => `${dates(one(state, 'Framing'))} ${one(state, 'Framing').percentComplete}%`;

describe('Review N2 W1: the web\'s document-only delete of a replaced lookahead keeps the percent, as the phone\'s Delete PDF Only does', () => {
  it('L1 gave Framing 60% and L2 replaced L1: Framing shows the master\'s dates at 60%', () => {
    expect(framing(onL2)).toBe('10/01/2026-10/11/2026 60%');
  });

  it('the web\'s "Delete Document Only" on L1 leaves Framing at 60% (it read 0%)', () => {
    expect(framing(webDelete(onL2, L1, true))).toBe('10/01/2026-10/11/2026 60%');
  });

  it('with no linked task the web offers only "Delete Document": the same', () => {
    const noDetail = approve(approve(onM, L1, [FRAMING_60]), L2, [ROOF_L2]);
    expect(linkedOf(noDetail, L1)).toEqual([]);
    expect(framing(webDelete(noDetail, L1, true))).toBe('10/01/2026-10/11/2026 60%');
  });

  it('the rows the web saves are the rows the phone\'s Delete PDF Only saves', () => {
    const web = webDelete(onL2, L1, true), phone = deletePdfOnly(onL2, L1, AT);
    expect(web.items).toEqual(phone.items);
    expect(framing(phone)).toBe('10/01/2026-10/11/2026 60%');
    expect(web.items.some(item => item.savedLookaheadDates)).toBe(false);
  });

  it('then a later lookahead moves Framing and is deleted with its items: the master\'s dates, on the web\'s path too (review N2 F2)', () => {
    const onL3 = approve(webDelete(onL2, L1, true), L3, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,']);
    expect(dates(one(deleteWithItems(onL3, L3, '2026-09-18T12:00:00.000Z'), 'Framing'))).toBe('10/01/2026-10/11/2026');
  });

  it('"Delete Document + 1 Task" still puts the percent back, as the phone\'s Delete PDF + Items: the same rows', () => {
    const web = webDelete(onL2, L1, false), phone = deleteWithItems(onL2, L1, AT);
    expect(framing(web)).toBe('10/01/2026-10/11/2026 0%');
    expect(web.items).toEqual(phone.items);
  });

  it('his own percent is never lowered by either button', () => {
    const own = phoneSave(onL2, framingId, { percentComplete: 70 }, '2026-09-15T18:00:00.000Z');
    expect([framing(webDelete(own, L1, true)), framing(webDelete(own, L1, false))]).toEqual(['10/01/2026-10/11/2026 70%', '10/01/2026-10/11/2026 70%']);
    // His 40% from before L1 gave 60%: "Only" leaves the 60% shown; "+ Tasks" gives his 40% back.
    const before = phoneSave(onM, framingId, { percentComplete: 40 }, '2026-09-02T12:00:00.000Z');
    const replaced = approve(approve(before, L1, [FRAMING_60, 'Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,']), L2, [ROOF_L2]);
    expect([framing(webDelete(replaced, L1, true)), framing(webDelete(replaced, L1, false))]).toEqual(['10/01/2026-10/11/2026 60%', '10/01/2026-10/11/2026 40%']);
  });

  it('a master deleted without its tasks writes no task, as before', () => {
    expect(planDAVEWebScheduleDocumentDelete({ snapshot: webSnapshot(onL2), document: webDocument(onL2, M), updatedAt: AT, keepTasks: true })).toEqual([]);
  });
});

describe('Review N2 W1: the web\'s delete dialog says what "+ Tasks" also puts back, as the phone\'s question does', () => {
  it('the phone\'s sentence, with the web\'s button', () => {
    const phoneSays = scheduleLookaheadDeleteNote(onL2.items, L1, linkedOf(onL2, L1), onL2.documents);
    const webSays = daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(onL2), document: webDocument(onL2, L1) });
    expect(phoneSays).toMatch(/^ Delete PDF \+ Items also puts back the earlier .*progress of 1 task this lookahead changed\.$/);
    expect(webSays).toBe(phoneSays.replace('Delete PDF + Items', 'Delete Document + 1 Task'));
  });

  it('for a lookahead with no linked task, the same sentence with the button that puts it back (WS1 item 4: it said nothing, and only "Delete Document" was offered); nothing for a master, or when nothing goes back', () => {
    const noDetail = approve(approve(onM, L1, [FRAMING_60]), L2, [ROOF_L2]);
    expect(daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(noDetail), document: webDocument(noDetail, L1) }))
      .toBe(' Delete Document + Its Changes also puts back the earlier progress of 1 task this lookahead changed.');
    expect(daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(onL2), document: webDocument(onL2, M) })).toBe('');
    const plain = approve(approve(onM, L1, ['Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,']), L2, [ROOF_L2]);
    expect(daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(plain), document: webDocument(plain, L1) })).toBe('');
  });

  it('the web\'s dialog shows it, from the saved tasks and schedules', () => {
    const shell = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    expect(shell).toContain('daveWebScheduleDocumentDeleteNote({ snapshot: { scheduleItems: tasks, knownScheduleItems: knownTasks, referenceDocuments: scheduleDocuments }, document: deleteCandidate })');
    expect(shell).toContain('knownTasks={snapshot.knownScheduleItems}');
    expect(shell).toContain('scheduleDocuments={snapshot.referenceDocuments}');
  });
});
