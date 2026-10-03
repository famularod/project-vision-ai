/**
 * Whole-app audit A5 pass 3 F7 (30 Sep 2026): "Delete PDF + Items" removed the
 * schedule's own tasks but not their ids from the dependency lists of tasks
 * that survive it. Since batch 11 a task another schedule also contains
 * survives, so it was left pointing at deleted predecessors ("Map
 * predecessor" for good). A single task delete already dropped them. Runs
 * App.tsx's own deleteScheduleDocument and dropDeletedPredecessors, compiled
 * from the source, through the real provenance and dependency rules.
 */
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';
import { scheduleDocumentIsScheduleLike } from '../../services/PIEScheduleReconciliation';
import { scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument, scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleDependenciesAfterScheduleDeleted, scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched. */
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

const task = (id: string, extra: Partial<ScheduleItem>): ScheduleItem => ({
  id, projectName: '2321', taskName: id, locationName: '', owner: '', startDate: '09/01/2026', finishDate: '09/30/2026',
  milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-09-01T00:00:00.000Z', ...extra,
} as ScheduleItem);
const fs2 = (predecessorItemId: string) => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 });
const schedule = (id: string, importBatchId: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: `file:///docs/${id}.pdf`, category: 'Schedules', notes: '',
  isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z', importBatchId,
} as ReferenceDocument);

function harness(items: ScheduleItem[], documents: ReferenceDocument[]) {
  let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const scheduleItemsCurrentRef = { current: items };
  const updates: Array<[string, Partial<ScheduleItem>]> = [];
  const warnings = new Set<string>();
  const noop = () => undefined;
  const deps: Record<string, unknown> = {
    referenceDocuments: documents, scheduleItems: items,
    scheduleItemsOnlyInImportBatch, scheduleItemsForExactImportBatch, scheduleDocumentIsScheduleLike,
    // A document with no batch takes tasks through this rule since audit A8 pass 2 #1.
    scheduleItemsOfUnbatchedDocument,
    dependencyChangesForDeletedTask,
    // Owner answer Q22 (landed after this test): a deleted lookahead's master tasks go back to their dates.
    // A10 pass 6 M1: the delete's other saves (lookahead give-backs, removed ids on the moved tasks) come from one service now.
    scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote, syncScheduleItemRevision: noop,
    // Pin changed deliberately (A6 pass 14 L1, 1 Oct 2026): a link to a removed row moves to the task shown that
    // answers to it, dropped only when none does (none here, so the drops below are unchanged).
    scheduleDependenciesAfterScheduleDeleted,
    Alert: { alert: (_title: string, _message: string, options: typeof buttons) => { buttons = options; } },
    recordDAVESyncTombstones: async (list: unknown[]) => list,
    advanceScheduleItemSyncGeneration: noop, cancelScheduleItemTextSync: noop, rememberOperationalTombstones: noop,
    markReferenceDocumentsAuthorityReady: noop, markScheduleItemsAuthorityReady: noop,
    referenceDocumentsCurrentRef: { current: documents }, scheduleItemsCurrentRef,
    setReferenceDocuments: noop, setScheduleItems: noop,
    removeOperationalRecordFromSyncQueue: async () => undefined, clearScheduleItemSyncConflicts: async () => undefined,
    deleteStoredReferenceDocument: async () => undefined, removeReferenceDocumentEverywhere: async () => undefined,
    scheduleItemSyncWarningsRef: { current: warnings },
    // The normal task update, reduced to what it stores.
    updateScheduleItem: (id: string, next: Partial<ScheduleItem>) => {
      updates.push([id, next]);
      scheduleItemsCurrentRef.current = scheduleItemsCurrentRef.current.map(item => item.id === id ? { ...item, ...next } : item);
    },
  };
  const js = ts.transpileModule(
    [componentFunction('dropDeletedPredecessors'), componentFunction('deleteScheduleDocument'),
      'module.exports = { deleteScheduleDocument };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { deleteScheduleDocument: (documentId: string) => void } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  const press = async (text: string) => {
    buttons.find(button => button.text === text)?.onPress?.();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { ...mod.exports, press, scheduleItemsCurrentRef, updates, warnings };
}

describe('"Delete PDF + Items" and the tasks that survive it (whole-app audit A5 pass 3 F7)', () => {
  const v1 = schedule('rev-1', 'b1');
  const v2 = schedule('rev-2', 'b2');
  const items = () => [
    // Carried unchanged into revision 2, so it survives deleting revision 2.
    task('shared', { importBatchId: 'b1', alsoImportedInBatchIds: ['b2'], dependencies: [fs2('only-2a'), fs2('kept'), fs2('only-2b')] }),
    task('only-2a', { importBatchId: 'b2' }),
    task('only-2b', { importBatchId: 'b2', dependencies: [fs2('only-2a')] }),
    task('kept', { importBatchId: 'b1', dependencies: [fs2('shared')] }),
  ];

  it('drops the deleted tasks from a surviving task’s dependencies, once, through the task update', async () => {
    const h = harness(items(), [v1, v2]);
    h.deleteScheduleDocument('rev-2');
    await h.press('Delete PDF + Items');
    expect(h.scheduleItemsCurrentRef.current.map(item => item.id)).toEqual(['shared', 'kept']);
    expect(h.updates).toEqual([['shared', { dependencies: [fs2('kept')] }]]);
    expect(h.scheduleItemsCurrentRef.current.find(item => item.id === 'kept')?.dependencies).toEqual([fs2('shared')]);
    expect([...h.warnings]).toEqual(['shared']);
  });

  it('Delete PDF Only leaves every dependency as stored', async () => {
    const h = harness(items(), [v1, v2]);
    h.deleteScheduleDocument('rev-2');
    await h.press('Delete PDF Only');
    expect(h.updates).toEqual([]);
  });

  it('the rule takes several ids and gives one change per successor', () => {
    expect(dependencyChangesForDeletedTask(items(), ['only-2a', ' only-2b ', ''])).toEqual([
      { id: 'shared', dependencies: [fs2('kept')] },
    ]);
    // One id, as a single task delete passes it, is unchanged.
    expect(dependencyChangesForDeletedTask(items(), 'only-2a').map(change => change.id)).toEqual(['shared', 'only-2b']);
    expect(dependencyChangesForDeletedTask(items(), [])).toEqual([]);
  });
});
