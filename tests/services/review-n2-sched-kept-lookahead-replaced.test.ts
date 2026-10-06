/**
 * Review N2 F3 (pass 2 of the next round, 5 Oct 2026; Low, gap in owner
 * answer Q25, ada8ef6). "Delete PDF Only" on the lookahead in effect keeps
 * its tasks on its dates. A newer lookahead that then left a master task out
 * never returned it to the master's dates, though the deleted lookahead's own
 * detail tasks did leave: with the file gone, nothing said when the lookahead
 * that moved the task had been imported.
 *
 * A lookahead that restates a task now notes on the task when its row was
 * imported, and the shown schedule reads a lookahead imported after that as
 * the newer one once the file is gone. The delete writes nothing, as before
 * (a save made by the delete stamped the task, and that stamp outranked a
 * newer lookahead approved offline on another device: the reviewer's
 * generator, seed 20137). For a note made before this review (no import
 * time) the delete saves those tasks as kept on their dates (the same task
 * save notes when, ScheduleDateEdit), and that time stands for the import.
 * One device; the phone's own save (App.tsx updateScheduleItem, compiled)
 * and its "Delete PDF Only" as its handler does it. Real CSV normalizer,
 * merge, shown-schedule pick, delete helpers and report. Synthetic data.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, reportBaselineSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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
const L2 = schedule('LOOKAHEAD L2', '2026-09-12T12:00:00.000Z', 'lookahead');
const MASTERS = '10/01/2026-10/11/2026';
const L1S = '10/05/2026-10/15/2026';
const onM = approve(EMPTY, M, ['Framing,Alpha,Lot,10/01/2026,10/11/2026,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,']);
const framingId = one(onM, 'Framing').id;
const L1_LINES = ['Framing,Alpha,Lot,10/05/2026,10/15/2026,', 'Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,'];
const ROOF_L2 = 'Roof,Alpha,Lot,10/14/2026,10/22/2026,';
const DELETED_L1 = '2026-09-10T12:00:00.000Z';
const onL1 = approve(onM, L1, L1_LINES);
/** "Delete PDF Only" on L1 while it is the lookahead in effect. */
const kept = deletePdfOnly(onL1, L1, DELETED_L1);
const keptAt = (state: State) => (saved(state, framingId).lookaheadOverlay?.lookaheads || []).map(entry => [entry.batchId, entry.datesKeptAt ?? null]);
/** The same tasks with notes as Build 229 made them: no import time on a lookahead's entry. */
const notedBeforeReview = (state: State): State => ({
  ...state,
  items: state.items.map(item => (item.lookaheadOverlay
    ? { ...item, lookaheadOverlay: { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(({ importedAt: _importedAt, ...entry }) => entry) } }
    : item)),
});

describe('Review N2 F3: a lookahead deleted alone while in effect is still replaced by a newer one', () => {
  it('the delete keeps its tasks on its dates and writes nothing, as before: the note already says when the lookahead was imported', () => {
    expect(kept.documents.map(document => document.id)).toEqual(['MASTER M']);
    expect([dates(one(kept, 'Framing')), dates(saved(kept, framingId))]).toEqual([L1S, L1S]);
    expect((saved(kept, framingId).lookaheadOverlay?.lookaheads || []).map(entry => [entry.batchId, entry.importedAt])).toEqual([[L1.importBatchId, L1.importedAt]]);
    expect(scheduleItemsAfterScheduleDeleted({ items: onL1.items, removed: [], document: L1, documents: onL1.documents, fileOnly: true })).toEqual([]);
    expect(kept.items).toEqual(onL1.items);
    expect(keptAt(kept)).toEqual([[L1.importBatchId, null]]);
    expect(named(kept, 'Inspect rebar').map(dates)).toEqual(['10/05/2026-10/07/2026']);
    expect(dates(one(kept, 'Roof'))).toBe('10/13/2026-10/21/2026');
    expect(kept.items.some(item => item.savedLookaheadDates)).toBe(false);
  });

  it('a newer lookahead that leaves Framing out: Framing is back on the master\'s dates, and the deleted one\'s detail task leaves', () => {
    const onL2 = approve(kept, L2, [ROOF_L2]);
    expect(dates(one(onL2, 'Framing'))).toBe(MASTERS);
    expect(named(onL2, 'Inspect rebar')).toEqual([]);
    expect(dates(one(onL2, 'Roof'))).toBe('10/14/2026-10/22/2026');
    // Shown, not saved: the saved task keeps the deleted lookahead's dates, as under a replaced lookahead whose file is kept.
    expect(dates(saved(onL2, framingId))).toBe(L1S);
    expect(one(onL2, 'Framing').savedLookaheadDates).toEqual({ startDate: '10/05/2026', finishDate: '10/15/2026', shownStartDate: '10/01/2026', shownFinishDate: '10/11/2026' });
  });

  it('the same as with L1\'s file kept', () => {
    const view = (state: State) => shown(state).map(item => `${item.taskName} ${dates(item)} ${item.percentComplete}`).sort();
    expect(view(approve(kept, L2, [ROOF_L2]))).toEqual(view(approve(onL1, L2, [ROOF_L2])));
  });

  it('a percent or a note he saves on Framing after that does not move it off the master\'s dates', () => {
    const onL2 = approve(kept, L2, [ROOF_L2]);
    const shownCopy = one(onL2, 'Framing');
    const edited = phoneSave(phoneSave(onL2, framingId, { percentComplete: 20 }, '2026-09-13T09:00:00.000Z'), framingId, { notes: 'Crew short' }, '2026-09-13T09:05:00.000Z');
    expect([dates(one(edited, 'Framing')), one(edited, 'Framing').percentComplete, one(edited, 'Framing').notes]).toEqual([MASTERS, 20, 'Crew short']);
    // The phone's date fields send the other date as shown: a finish he changes starts from the master's start.
    const moved = phoneSave(onL2, framingId, { finishDate: '10/13/2026', startDate: shownCopy.startDate }, '2026-09-13T09:00:00.000Z');
    expect(dates(one(moved, 'Framing'))).toBe('10/01/2026-10/13/2026');
  });

  it('deleting the newer lookahead with its items: the one before it applies again, the task and its detail task alike', () => {
    const back = deleteWithItems(approve(kept, L2, [ROOF_L2]), L2, '2026-09-14T12:00:00.000Z');
    expect(dates(one(back, 'Framing'))).toBe(L1S);
    expect(named(back, 'Inspect rebar').map(dates)).toEqual(['10/05/2026-10/07/2026']);
  });

  it('a newer lookahead that lists Framing moves it, as before', () => {
    const onL2 = approve(kept, L2, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,']);
    expect(dates(one(onL2, 'Framing'))).toBe('10/08/2026-10/18/2026');
  });
});

describe('Review N2 F3: what does not replace it', () => {
  it('an older lookahead still saved: the deleted one was newer, so its tasks keep its dates', () => {
    const onL0 = approve(onM, L0, [ROOF_L2]);
    const both = approve(onL0, L1, L1_LINES);
    const without = deletePdfOnly(both, L1, DELETED_L1);
    expect(without.documents.map(document => document.id)).toEqual(['MASTER M', 'LOOKAHEAD L0']);
    expect(dates(one(without, 'Framing'))).toBe(L1S);
    expect(named(without, 'Inspect rebar').map(dates)).toEqual(['10/05/2026-10/07/2026']);
  });

  it('a newer lookahead for another project only', () => {
    const beta = schedule('LOOKAHEAD BETA', '2026-09-12T12:00:00.000Z', 'lookahead', 'Beta');
    const onBeta = approve(kept, beta, ['Paving,Beta,Yard,10/14/2026,10/22/2026,'], 'Beta');
    expect(dates(one(onBeta, 'Framing'))).toBe(L1S);
  });

  it('dates he moved by hand after the delete stand when the newer lookahead comes', () => {
    const moved = phoneSave(kept, framingId, { startDate: '10/06/2026', finishDate: '10/16/2026' }, '2026-09-11T09:00:00.000Z');
    expect(dates(one(approve(moved, L2, [ROOF_L2]), 'Framing'))).toBe('10/06/2026-10/16/2026');
  });

  it('a lookahead deleted alone on Build 229 (nothing saved then, no import time noted) reads as before: its dates stay', () => {
    const asBuild229: State = { items: notedBeforeReview(onL1).items, documents: onL1.documents.filter(document => document.id !== L1.id) };
    expect(keptAt(asBuild229)).toEqual([[L1.importBatchId, null]]);
    expect(dates(one(approve(asBuild229, L2, [ROOF_L2]), 'Framing'))).toBe(L1S);
  });

  it('a master, and a task not on the lookahead\'s dates, are saved nothing', () => {
    expect(scheduleItemsAfterScheduleDeleted({ items: onL1.items, removed: [], document: M, documents: onL1.documents, fileOnly: true })).toEqual([]);
    const moved = phoneSave(onL1, framingId, { startDate: '10/06/2026', finishDate: '10/16/2026' }, '2026-09-09T15:00:00.000Z');
    expect(scheduleItemsAfterScheduleDeleted({ items: moved.items, removed: [], document: L1, documents: moved.documents, fileOnly: true })).toEqual([]);
  });
});

describe('Review N2 F3: judged by when the lookaheads were imported, with nothing written by the delete', () => {
  /** Imported after L1, on another device that was offline: this device deleted L1's file before it heard of it. */
  const LX = schedule('LOOKAHEAD LX', '2026-09-09T18:00:00.000Z', 'lookahead');

  it('a lookahead imported after L1 but before L1\'s file was deleted here (approved offline elsewhere) is the newer one all the same', () => {
    expect(Date.parse(LX.importedAt)).toBeLessThan(Date.parse(DELETED_L1));
    const onLX = approve(kept, LX, [ROOF_L2]);
    expect(dates(one(onLX, 'Framing'))).toBe(MASTERS);
    expect(named(onLX, 'Inspect rebar')).toEqual([]);
    // As with L1's file still saved.
    expect(dates(one(approve(onL1, LX, [ROOF_L2]), 'Framing'))).toBe(MASTERS);
  });

  it('the task\'s row is not stamped by the delete, so that lookahead\'s copy of it, stamped when it was approved, is the later one', () => {
    expect(saved(kept, framingId).updatedAt).toBe(saved(onL1, framingId).updatedAt);
    expect(Date.parse(saved(kept, framingId).updatedAt || '')).toBeLessThan(Date.parse(LX.importedAt));
  });
});

/**
 * Review N3 R1 (pass 3, schedule; Low, caused by the redone F3; the reviewer's D19, right at 06e7b1c). For a lookahead
 * approved before review N2 (no import time on its entry) "Delete PDF Only" while it was in effect saved its tasks on
 * the same dates, to note when they were kept. That save stamped them: with a newer lookahead approved with no signal
 * on another device, the stamp won when that device came back, and the task showed the deleted file's dates on every
 * device. The save is gone. Such a lookahead reads as it did before review N2.
 */
describe('Review N3 R1: a lookahead approved on an older build, deleted alone while in effect', () => {
  const before = notedBeforeReview(onL1);
  const keptBefore = deletePdfOnly(before, L1, DELETED_L1);

  it('the delete saves nothing and stamps nothing: the tasks are as they were, on its dates', () => {
    expect(scheduleItemsAfterScheduleDeleted({ items: before.items, removed: [], document: L1, documents: before.documents, fileOnly: true, updatedAt: DELETED_L1 })).toEqual([]);
    expect(keptBefore.items).toEqual(before.items);
    expect(saved(keptBefore, framingId).updatedAt).toBe(saved(before, framingId).updatedAt);
    expect([dates(one(keptBefore, 'Framing')), keptAt(keptBefore)]).toEqual([L1S, [[L1.importBatchId, null]]]);
  });

  it('so a newer lookahead approved on another device before the delete, and stamped then, is still the later copy of the task (the reviewer\'s D19)', () => {
    // The iPad, with no signal, approved L2 moving Framing: its copy of the task is stamped when it approved.
    const L2moves = schedule('LOOKAHEAD L2 MOVES', '2026-09-09T18:00:00.000Z', 'lookahead');
    const ipad = approve(before, L2moves, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,']);
    expect(Date.parse(L2moves.importedAt)).toBeLessThan(Date.parse(DELETED_L1));
    // The phone's copy after its delete is no later than before it, and the iPad's is later than that.
    expect(Date.parse(saved(ipad, framingId).updatedAt || '')).toBeGreaterThan(Date.parse(saved(keptBefore, framingId).updatedAt || ''));
    expect(dates(one(ipad, 'Framing'))).toBe('10/08/2026-10/18/2026');
  });

  it('a newer lookahead that leaves the task out does not return it to the master\'s dates, as before review N2 (recorded)', () => {
    expect(dates(one(approve(keptBefore, L2, [ROOF_L2]), 'Framing'))).toBe(L1S);
  });

  it('what a later lookahead noted when it restated the task still tells a newer one apart, once that later one is deleted with its items', () => {
    // L2 moves Framing off the deleted L1's dates and notes, on L1's entry, when it found the task still on them.
    const onL2 = approve(keptBefore, L2, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,']);
    expect(keptAt(onL2)).toEqual([[L1.importBatchId, expect.any(String)], [L2.importBatchId, null]]);
    // L3, newer, leaves Framing out; then Delete PDF + Items on L2. L1's entry is the last in the note again.
    const L3 = schedule('LOOKAHEAD L3', '2026-09-15T12:00:00.000Z', 'lookahead');
    const onL3 = approve(onL2, L3, [ROOF_L2]);
    expect(dates(one(onL3, 'Framing'))).toBe(MASTERS);
    const back = deleteWithItems(onL3, L2, '2026-09-16T12:00:00.000Z');
    expect((saved(back, framingId).lookaheadOverlay?.lookaheads || []).map(entry => entry.batchId)).toEqual([L1.importBatchId]);
    // Not the dates of L1, a file deleted two lookaheads ago: L3 is the lookahead in effect and does not list Framing.
    expect(dates(one(back, 'Framing'))).toBe(MASTERS);
    // And in the other order: L2 deleted with its items first (L1's dates are given back, as before), then L3.
    const backFirst = deleteWithItems(onL2, L2, '2026-09-14T12:00:00.000Z');
    expect(dates(one(backFirst, 'Framing'))).toBe(L1S);
    expect(dates(one(approve(backFirst, L3, [ROOF_L2]), 'Framing'))).toBe(MASTERS);
  });

  it('the same two dates saved again by hand note nothing either', () => {
    const again = phoneSave(before, framingId, { startDate: '10/05/2026', finishDate: '10/15/2026' }, DELETED_L1);
    expect(saved(again, framingId).lookaheadOverlay).toEqual(saved(before, framingId).lookaheadOverlay);
  });
});

describe('Review N2 F3: the report explains the date as back to the master schedule\'s', () => {
  function report(state: State, known: DAVEReportSnapshot | null, now: string) {
    const truth = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
      knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
    });
    const fingerprint = buildDAVEReportSourceFingerprint([truth]);
    const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
    return {
      lines: briefing.reportingPeriod.changes.map(change => change.summary).sort(),
      snapshot: buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' }),
    };
  }

  it('after the newer lookahead', () => {
    const before = report(kept, null, '2026-09-11T12:00:00.000Z');
    const after = report(approve(kept, L2, [ROOF_L2]), before.snapshot, '2026-09-13T12:00:00.000Z');
    expect(after.lines.filter(line => line.startsWith('Framing'))).toEqual([
      'Framing finish is back to the master schedule\'s 10/11/2026 (the previous lookahead showed 10/15/2026).',
      'Framing start is back to the master schedule\'s 10/01/2026 (the previous lookahead showed 10/05/2026).',
    ]);
  });
});
