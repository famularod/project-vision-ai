/**
 * Audit round 2, A10 pass 7 L1 (30 Sep 2026): a task David deleted himself
 * came back as current evidence on a same-named task.
 *
 * 1cebe2f made an update linked to a deleted task id count as current while a
 * saved task still answered to that id, including by the update's stored task
 * name among the tasks shown. The deleted row is gone, so the A10 pass 6 L2
 * guard (no fallback when the update's own schedule had the name twice) could
 * not look up its schedule. Lot has two "Pour slab" tasks; David deletes
 * phase 1. Its "complete" report stayed current and fell back by name to phase
 * 2: "Recent field evidence may show Pour slab complete while the schedule
 * remains Not Started at 0%", and its open action moved to phase 2. The same
 * for an update with no area when the only other Pour slab is in another area,
 * and for a task deleted then added again by hand. And after the A10 pass 6 L2
 * case, "Delete PDF + Items" on the old master rightly wrote nothing (two
 * removed Pour slabs), but the partition fell back by name and the warning
 * returned.
 *
 * Now a deleted task id answers only to a saved task that lists it among the
 * ids it had before (revisedFromTaskIds), which "Delete PDF + Items" writes
 * when it is safe. The name fallback is never used for a deleted id.
 * Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import {
  buildPIEScheduleReconciliation,
  scheduleDocumentIsScheduleLike,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import * as provenance from '../../services/ScheduleImportProvenance';
import * as lookaheadDelete from '../../services/ScheduleLookahead';
import * as revisions from '../../services/ScheduleTaskRevisions';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const NOW = new Date('2026-09-30T12:00:00.000Z');
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: `file:///docs/${id}.csv`, category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
  cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER 0926', '2026-09-26T08:00:00.000Z');

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourSlabs = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab')
  .sort((left, right) => left.startDate.localeCompare(right.startDate));
const tombstone = (recordId: string): DAVESyncTombstone => ({ entityType: 'schedule_item', recordId, deletedAt: '2026-09-29T18:00:00.000Z' });

/** Phase 1 is finished: its report says so, and another leaves an open action on it. */
function phase1Report(taskId: string, area: string | null = 'Lot'): ProjectUpdate[] {
  const base = {
    projectName: 'Alpha', scheduleProjectName: 'Alpha', recipients: { contactIds: [] }, scheduleItemId: taskId,
    scheduleTaskName: 'Pour slab', ...(area ? { selectedAreaName: area } : {}),
  };
  return [
    { ...base, id: 'u-phase1-complete', date: '2026-09-04T15:00:00.000Z', notes: 'Pour slab is complete. Finished and cured.', photos: [] },
    {
      ...base, id: 'u-phase1-action', date: '2026-09-02T15:00:00.000Z', notes: 'Slab edge chipped at the east side.',
      photos: [{
        id: 'p-edge', uri: 'file:///p-edge.jpg', caption: 'Slab edge', category: 'Open Issue', actionRequired: 'Patch the slab edge',
        actionOwner: 'Acme Concrete', actionDueDate: '', actionStatus: 'Open', ...(area ? { selectedAreaName: area } : {}),
      }],
    },
  ] as unknown as ProjectUpdate[];
}

/** The phone's partition (App.tsx): every saved task. */
const partition = (state: State, tombstones: readonly DAVESyncTombstone[], updates: ProjectUpdate[]) =>
  partitionProjectUpdatesByDeletedTask(updates, tombstones, update => update, { scheduleItems: state.items });

/** What a current report does to the schedule shown: the warnings and the open action's task. */
function currentEffect(state: State, tombstones: readonly DAVESyncTombstone[], updates: ProjectUpdate[]) {
  const split = partition(state, tombstones, updates);
  const items = shown(state);
  const warnings = buildPIEScheduleReconciliation({
    scheduleItems: items, knownScheduleItems: state.items, updates: split.active, projectName: 'Alpha', now: NOW,
  }).warnings.filter(warning => warning.type === 'field_progress_not_reflected');
  const action = buildDAVEActionInbox({ scheduleItems: items, knownScheduleItems: state.items, updates: split.active, now: NOW })
    .items.find(item => item.kind === 'field_action');
  return { historical: split.historical.map(value => value.id), warnings, actionTaskId: action?.scheduleItemId ?? null };
}

/** A single-task delete (App.tsx deleteScheduleItem): the task's deletion recorded, its row gone. */
function deleteTask(state: State, taskId: string) {
  return { state: { ...state, items: state.items.filter(item => item.id !== taskId) }, tombstones: [tombstone(taskId)] };
}

describe('A10 p7 L1: a task David deleted never comes back as current evidence on a same-named task', () => {
  const twoPhases = approve({ items: [], documents: [] }, master, rows(master, [
    'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,0%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
  ]));

  it('Lot has two Pour slabs; David deletes phase 1: its "complete" report is history, no warning, no action on phase 2', () => {
    const [phase1, phase2] = pourSlabs(twoPhases.items);
    // Before the delete the report is phase 1's: the warning and the action are on phase 1.
    const before = currentEffect(twoPhases, [], phase1Report(phase1.id));
    expect(before.warnings.map(warning => warning.scheduleItemId)).toEqual([phase1.id]);
    expect(before.actionTaskId).toBe(phase1.id);
    const { state, tombstones } = deleteTask(twoPhases, phase1.id);
    expect(pourSlabs(shown(state)).map(item => item.id)).toEqual([phase2.id]);
    const after = currentEffect(state, tombstones, phase1Report(phase1.id));
    expect(after.warnings.map(warning => warning.summary)).toEqual([]);
    expect(after.actionTaskId).toBeNull();
    expect(after.historical).toEqual(['u-phase1-complete', 'u-phase1-action']);
  });

  it('an update with no area, when the only other Pour slab is in another area', () => {
    const twoAreas = approve({ items: [], documents: [] }, master, rows(master, [
      'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,0%', 'Pour slab,Alpha,Deck,10/01/2026,10/03/2026,0%',
    ]));
    const lot = twoAreas.items.find(item => item.locationName === 'Lot')!;
    const { state, tombstones } = deleteTask(twoAreas, lot.id);
    const after = currentEffect(state, tombstones, phase1Report(lot.id, null));
    expect(after.warnings.map(warning => warning.summary)).toEqual([]);
    expect(after.actionTaskId).toBeNull();
    expect(after.historical).toEqual(['u-phase1-complete', 'u-phase1-action']);
  });

  it('a task deleted, then added again by hand under the same name', () => {
    const single = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%']));
    const old = single.items[0];
    const { state, tombstones } = deleteTask(single, old.id);
    const byHand = {
      ...old, id: 'hand-pour', importBatchId: null, sourceDocumentId: null, importedFrom: null, importedAt: null,
      createdAt: '2026-09-29T19:00:00.000Z', progressSource: 'project_manager', progressConfirmedAt: '2026-09-29T19:00:00.000Z',
      progressConfirmedBy: 'David',
    } as unknown as ScheduleItem;
    const readded = { ...state, items: [...state.items, byHand] };
    const after = currentEffect(readded, tombstones, phase1Report(old.id));
    expect(after.actionTaskId).toBeNull();
    expect(after.historical).toEqual(['u-phase1-complete', 'u-phase1-action']);
  });

  it('a task a new master moved still answers to its deleted old row by the ids it had before', () => {
    const single = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%']));
    const oldId = single.items[0].id;
    const moved = approve(single, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%']));
    const now = pourSlabs(shown(moved))[0];
    expect(now.revisedFromTaskIds).toEqual([oldId]);
    const { state, tombstones } = deleteTask(moved, oldId);
    expect(partition(state, tombstones, phase1Report(oldId)).active.map(value => value.id)).toEqual(['u-phase1-complete', 'u-phase1-action']);
  });
});

/** App.tsx's own deleteScheduleDocument, compiled, tapping "Delete PDF + Items" (as the A10 pass 6 M1 tests do). */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = app.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}
async function deleteWithItems(state: State, document: ReferenceDocument) {
  let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const tombstones: DAVESyncTombstone[] = [];
  const synced: ScheduleItem[] = [];
  const scheduleItemsCurrentRef = { current: state.items };
  const referenceDocumentsCurrentRef = { current: state.documents };
  const noop = () => undefined;
  const deps: Record<string, unknown> = {
    referenceDocuments: state.documents, scheduleItems: state.items,
    scheduleItemsOnlyInImportBatch: provenance.scheduleItemsOnlyInImportBatch,
    scheduleItemsForExactImportBatch: provenance.scheduleItemsForExactImportBatch,
    scheduleItemsOfUnbatchedDocument: provenance.scheduleItemsOfUnbatchedDocument,
    scheduleDocumentIsScheduleLike, dependencyChangesForDeletedTask, ...lookaheadDelete, ...revisions,
    syncScheduleItemRevision: (item: ScheduleItem) => { synced.push(item); return Promise.resolve(true); },
    Alert: { alert: (_title: string, _message: string, list?: typeof buttons) => { if (list) buttons = list; } },
    recordDAVESyncTombstones: async (list: Array<{ entityType: DAVESyncTombstone['entityType']; recordId: string }>) => {
      const recorded = list.map(entry => ({ ...entry, deletedAt: '2026-09-29T18:00:00.000Z' }));
      tombstones.push(...recorded);
      return recorded;
    },
    advanceScheduleItemSyncGeneration: noop, cancelScheduleItemTextSync: noop, rememberOperationalTombstones: noop,
    markReferenceDocumentsAuthorityReady: noop, markScheduleItemsAuthorityReady: noop,
    referenceDocumentsCurrentRef, scheduleItemsCurrentRef, setReferenceDocuments: noop, setScheduleItems: noop,
    removeOperationalRecordFromSyncQueue: async () => undefined, clearScheduleItemSyncConflicts: async () => undefined,
    deleteStoredReferenceDocument: async () => undefined, removeReferenceDocumentEverywhere: async () => undefined,
    scheduleItemSyncWarningsRef: { current: new Set<string>() }, updateScheduleItem: noop,
  };
  const js = ts.transpileModule(
    [componentFunction('dropDeletedPredecessors'), componentFunction('deleteScheduleDocument'), 'module.exports = { deleteScheduleDocument };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { deleteScheduleDocument: (documentId: string) => void } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  mod.exports.deleteScheduleDocument(document.id);
  buttons.find(button => button.text === 'Delete PDF + Items')!.onPress!();
  await new Promise(resolve => setImmediate(resolve));
  return { state: { items: scheduleItemsCurrentRef.current, documents: referenceDocumentsCurrentRef.current }, tombstones, synced };
}

describe('A10 p7 L1: the A10 pass 6 L2 case, then "Delete PDF + Items" on the old master', () => {
  it('the delete writes nothing (two removed Pour slabs), and the phase 1 report stays history: no warning returns', async () => {
    const before = approve({ items: [], documents: [] }, master, rows(master, [
      'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,0%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
    ]));
    const [phase1] = pourSlabs(before.items);
    // The new master drops phase 1 and moves phase 2: one row against two saved, so the import pairs neither.
    const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
    // Before the delete the A10 pass 6 L2 guard holds: no warning.
    expect(currentEffect(after, [], phase1Report(phase1.id)).warnings).toEqual([]);
    const deleted = await deleteWithItems(after, master);
    expect(deleted.synced).toEqual([]);
    expect(pourSlabs(shown(deleted.state))[0]).not.toHaveProperty('revisedFromTaskIds');
    const effect = currentEffect(deleted.state, deleted.tombstones, phase1Report(phase1.id));
    expect(effect.warnings.map(warning => warning.summary)).toEqual([]);
    expect(effect.actionTaskId).toBeNull();
    expect(effect.historical).toEqual(['u-phase1-complete', 'u-phase1-action']);
  });
});
