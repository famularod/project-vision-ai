/**
 * Whole-app audit A8 pass 2 #1 (30 Sep 2026): the phone uploads a schedule
 * PDF as a shared "Schedules" record with no import batch. "Import This
 * Schedule" then imports the same file as a second record, whose tasks
 * carry the file name in importedFrom. "Delete PDF + Items" on the upload
 * copy matched tasks by that file name, so it took the imported schedule's
 * tasks with it, on every device. A document with no import batch now takes
 * only the tasks naming it as their source and, by file name, only tasks
 * with no batch or source of their own. Runs App.tsx's own
 * deleteScheduleDocument, compiled from the source, through the real
 * provenance rules.
 */
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';
import { scheduleDocumentIsScheduleLike } from '../../services/PIEScheduleReconciliation';
import * as provenance from '../../services/ScheduleImportProvenance';
import { scheduleDependenciesAfterScheduleDeleted, scheduleFileOnlyDeleteRefusal, scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
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
  id, projectName: 'Alpha', taskName: id, locationName: '', owner: '', startDate: '09/01/2026', finishDate: '09/30/2026',
  milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-09-01T00:00:00.000Z', ...extra,
} as ScheduleItem);
const schedule = (id: string, extra: Partial<ReferenceDocument>): ReferenceDocument => ({
  id, name: 'Schedule', originalFileName: 'Schedule.pdf', uri: `file:///docs/${id}.pdf`, category: 'Schedules', notes: '',
  isCurrent: false, importedAt: '2026-09-20T00:00:00.000Z', projectName: 'Alpha', ...extra,
} as ReferenceDocument);

// The phone's upload of Schedule.pdf: shared, no batch, no tasks.
const uploadCopy = schedule('upload-copy', { importBatchId: null });
// "Import This Schedule" on the same file: its own record and batch.
const imported = schedule('imported', { importBatchId: 'batch-1', isCurrent: true });
const importedTasks = () => ['t1', 't2', 't3'].map(id =>
  task(id, { importedFrom: 'Schedule.pdf', importBatchId: 'batch-1', sourceDocumentId: 'imported' }));

function harness(items: ScheduleItem[], documents: ReferenceDocument[]) {
  let alert: { message: string; buttons: Array<{ text: string; onPress?: () => void }> } = { message: '', buttons: [] };
  const tombstoned: Array<{ entityType: string; recordId: string }> = [];
  const scheduleItemsCurrentRef = { current: items };
  const noop = () => undefined;
  const deps: Record<string, unknown> = {
    referenceDocuments: documents, scheduleItems: items,
    scheduleItemsOnlyInImportBatch: provenance.scheduleItemsOnlyInImportBatch,
    scheduleItemsForExactImportBatch: provenance.scheduleItemsForExactImportBatch,
    scheduleItemsOfUnbatchedDocument: provenance.scheduleItemsOfUnbatchedDocument,
    scheduleDocumentIsScheduleLike, dependencyChangesForDeletedTask,
    // Owner answer Q22 (landed after this test): a deleted lookahead's master tasks go back to their dates.
    // A10 pass 6 M1: the delete's other saves (lookahead give-backs, removed ids on the moved tasks) come from one service now.
    scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote, scheduleFileOnlyDeleteRefusal, fileOnlyDeleteRefused: () => false, syncScheduleItemRevision: noop,
    // Pin changed deliberately (A6 pass 14 L1, 1 Oct 2026): after this delete a link to a removed row moves to the
    // task shown that answers to it, worked out by one more service.
    scheduleDependenciesAfterScheduleDeleted,
    Alert: { alert: (_title: string, message: string, buttons: typeof alert.buttons) => { alert = { message, buttons }; } },
    recordDAVESyncTombstones: async (list: typeof tombstoned) => { tombstoned.push(...list); return list; },
    advanceScheduleItemSyncGeneration: noop, cancelScheduleItemTextSync: noop, rememberOperationalTombstones: noop,
    markReferenceDocumentsAuthorityReady: noop, markScheduleItemsAuthorityReady: noop,
    referenceDocumentsCurrentRef: { current: documents }, scheduleItemsCurrentRef,
    setReferenceDocuments: noop, setScheduleItems: noop,
    removeOperationalRecordFromSyncQueue: async () => undefined, clearScheduleItemSyncConflicts: async () => undefined,
    deleteStoredReferenceDocument: async () => undefined, removeReferenceDocumentEverywhere: async () => undefined,
    scheduleItemSyncWarningsRef: { current: new Set<string>() }, updateScheduleItem: noop,
  };
  const js = ts.transpileModule(
    [componentFunction('dropDeletedPredecessors'), componentFunction('deleteScheduleDocument'),
      'module.exports = { deleteScheduleDocument };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { deleteScheduleDocument: (documentId: string) => void } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  const deleteWithItems = async (documentId: string) => {
    mod.exports.deleteScheduleDocument(documentId);
    alert.buttons.find(button => button.text === 'Delete PDF + Items')?.onPress?.();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { deleteWithItems, tombstoned, scheduleItemsCurrentRef, message: () => alert.message };
}

describe('"Delete PDF + Items" on the phone\'s task-less upload copy (audit A8 pass 2 #1)', () => {
  it('leaves the imported schedule\'s tasks, on this phone and in the deletions sent to every device', async () => {
    const h = harness(importedTasks(), [uploadCopy, imported]);
    await h.deleteWithItems('upload-copy');
    expect(h.message()).toContain('remove the 0 schedule items only this PDF contains');
    expect(h.tombstoned).toEqual([{ entityType: 'reference_document', recordId: 'upload-copy' }]);
    expect(h.scheduleItemsCurrentRef.current.map(item => item.id)).toEqual(['t1', 't2', 't3']);
  });

  it('the other way round: deleting the imported schedule still takes its own tasks', async () => {
    const h = harness(importedTasks(), [uploadCopy, imported]);
    await h.deleteWithItems('imported');
    expect(h.tombstoned.map(entry => entry.recordId)).toEqual(['imported', 't1', 't2', 't3']);
    expect(h.scheduleItemsCurrentRef.current).toEqual([]);
  });

  it('an older schedule with no batch still takes its own unbatched tasks by file name, and none held by a batch', async () => {
    const legacy = schedule('legacy', { importBatchId: null });
    const items = [
      task('old-1', { importedFrom: 'Schedule.pdf' }),
      task('old-2', { importedFrom: 'Schedule' }),
      task('other-file', { importedFrom: 'Other.pdf' }),
      task('batched', { importedFrom: 'Schedule.pdf', importBatchId: 'batch-9' }),
      task('also-batched', { importedFrom: 'Schedule.pdf', alsoImportedInBatchIds: ['batch-9'] }),
      task('another-source', { importedFrom: 'Schedule.pdf', sourceDocumentId: 'imported' }),
      task('own-source', { importedFrom: 'Renamed.pdf', sourceDocumentId: 'legacy' }),
    ];
    const h = harness(items, [legacy]);
    await h.deleteWithItems('legacy');
    expect(h.tombstoned.map(entry => entry.recordId)).toEqual(['legacy', 'old-1', 'old-2', 'own-source']);
    expect(h.scheduleItemsCurrentRef.current.map(item => item.id))
      .toEqual(['other-file', 'batched', 'also-batched', 'another-source']);
  });
});
