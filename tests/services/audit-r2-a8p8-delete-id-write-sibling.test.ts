/**
 * Audit round 2, A8 pass 8 L1 (30 Sep 2026): "Delete PDF + Items" wrote a
 * dropped task's id onto its same-named sibling.
 *
 * Old master F has two "Pour slab" tasks in Lot. Phase 1 is finished; new
 * master M keeps phase 2 on the same dates, so phase 2's row carries F's
 * import too, and drops phase 1. Delete PDF + Items on F removes only phase 1.
 * 1cebe2f then wrote phase 1's id onto phase 2 (the one Pour slab shown, the
 * one removed) and synced it: phase 1's field report linked to phase 2 by
 * task id, and the schedule warned "Field progress may be ahead of the
 * schedule". The guard counted same-named tasks only among the tasks shown
 * and those removed, not the kept rows of the removed task's own schedule.
 *
 * Now the id is never written onto a row that shares an import with the
 * removed task (a task of the same schedule, not a revision of it), and only
 * when the removed task's name was unique in its own schedule, counting the
 * rows the delete keeps and those it removes. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
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
import { scheduleTasksAnsweringToRemovedTasks } from '../../services/ScheduleTaskRevisions';
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
const oldMaster = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const newMaster = schedule('MASTER M', '2026-09-26T08:00:00.000Z');

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
    scheduleDocumentIsScheduleLike, dependencyChangesForDeletedTask, ...lookaheadDelete,
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

/** A field report on phase 1 while it was under way. */
const phase1Report = (taskId: string): ProjectUpdate => ({
  id: 'u-phase1', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-02T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is in progress. Forms set at the north bay.', scheduleItemId: taskId,
  scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
}) as ProjectUpdate;

describe('A8 p8 L1: "Delete PDF + Items" never writes a dropped task\'s id onto its same-named sibling', () => {
  // F: phase 1 finished, phase 2 not started. M keeps phase 2 on its dates (so its row carries F's import too) and drops phase 1.
  const before = approve({ items: [], documents: [] }, oldMaster, rows(oldMaster, [
    'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,100%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
  ]));
  const [phase1, phase2] = pourSlabs(before.items);
  const after = approve(before, newMaster, rows(newMaster, [
    'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
  ]));

  it('the scenario: phase 2 is the one Pour slab shown, on F\'s and M\'s imports; deleting F removes only phase 1', () => {
    expect(pourSlabs(shown(after)).map(item => item.id)).toEqual([phase2.id]);
    expect(provenance.scheduleItemImportBatchIds(pourSlabs(shown(after))[0])).toEqual([oldMaster.importBatchId, newMaster.importBatchId]);
    expect(provenance.scheduleItemsOnlyInImportBatch(after.items, oldMaster, after.documents).map(item => item.id)).toEqual([phase1.id]);
  });

  it('phase 2 keeps no earlier id and is not synced; phase 1\'s report is history, with no warning on phase 2', async () => {
    const deleted = await deleteWithItems(after, oldMaster);
    expect(deleted.tombstones.map(entry => entry.recordId)).toEqual([oldMaster.id, phase1.id]);
    const split = partitionProjectUpdatesByDeletedTask([phase1Report(phase1.id)], deleted.tombstones, update => update, { scheduleItems: deleted.state.items });
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown(deleted.state), knownScheduleItems: deleted.state.items, updates: split.active, projectName: 'Alpha', now: NOW,
    });
    expect(reconciliation.warnings.filter(warning => warning.type === 'field_progress_not_reflected').map(warning => warning.title)).toEqual([]);
    expect(reconciliation.matches.filter(match => match.updateId === 'u-phase1')).toEqual([]);
    expect(split.historical.map(update => update.id)).toEqual(['u-phase1']);
    const phase2Now = pourSlabs(shown(deleted.state))[0];
    expect(phase2Now.id).toBe(phase2.id);
    expect(phase2Now.revisedFromTaskIds ?? []).toEqual([]);
    expect(deleted.synced).toEqual([]);
  });
});

describe('A8 p8 L1: the removed task\'s name must be unique in its own schedule, counting the rows the delete keeps', () => {
  const task = (id: string, batches: string[], dates: [string, string], extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab', startDate: dates[0], finishDate: dates[1],
    milestone: '', owner: '', contractor: '', percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '',
    importBatchId: batches[0], ...(batches.length > 1 ? { alsoImportedInBatchIds: batches.slice(1) } : {}),
    sourceDocumentId: batches[0].replace('batch-', ''), ...extra,
  }) as ScheduleItem;

  it('a same-named row of F the delete keeps (hidden, also in a lookahead) stops the write', () => {
    const removed = task('F-1', ['batch-F'], ['09/01/2026', '09/03/2026']);
    const keptHidden = task('F-2', ['batch-F', 'batch-L'], ['10/01/2026', '10/03/2026']);
    const shownRow = task('M-1', ['batch-M'], ['10/05/2026', '10/07/2026']);
    expect(scheduleTasksAnsweringToRemovedTasks([shownRow], [removed], [keptHidden, shownRow])).toEqual([]);
    // With F's name unique (no kept F row of that name), the moved row takes the removed id, as 1cebe2f meant.
    expect(scheduleTasksAnsweringToRemovedTasks([shownRow], [removed], [shownRow]).map(item => item.revisedFromTaskIds)).toEqual([['F-1']]);
  });

  it('a row that shares an import with the removed task is its sibling, never its revision', () => {
    const removed = task('F-1', ['batch-F'], ['09/01/2026', '09/03/2026']);
    const sibling = task('F-2', ['batch-F', 'batch-M'], ['10/01/2026', '10/03/2026']);
    // Even with no kept rows counted: sharing F's import makes it F's own task.
    expect(scheduleTasksAnsweringToRemovedTasks([sibling], [removed])).toEqual([]);
    expect(scheduleTasksAnsweringToRemovedTasks([sibling], [removed], [sibling])).toEqual([]);
  });
});
