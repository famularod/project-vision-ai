/**
 * Audit round 2, A10 pass 8 L1 / A5 pass 10 L2 (30 Sep 2026): Make Current
 * back to the old master, then delete a task.
 *
 * Lot has two Pour slabs on master A, phase 1 and phase 2. Master B moved
 * phase 1: its new row answers to A's phase 1 row (revisedFromTaskIds). David
 * made A current again (Set Active), so A's phase 1 is the row shown and B's
 * is hidden. A field report says phase 1 is complete. David then deletes
 * phase 1 on the phone. The delete took the task and the hidden rows it
 * answers to (A10 pass 7 L5), but none answers the other way: B's hidden row
 * still listed the deleted id, so the report stayed current, reconciliation's
 * name fallback put it on phase 2 ("… complete while the schedule remains Not
 * Started …"), and Set Active on B showed the deleted task again.
 *
 * Two fixes were possible: give no name fallback for an id a saved hidden
 * row answers to, or make the delete take the hidden rows that answer to the
 * task too. The second is simpler and fixes all three effects: the delete now
 * takes the saved hidden rows of the task's revision chain in both
 * directions, in its project. These tests run App.tsx's own
 * deleteScheduleItem, compiled. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import * as deletedTaskEvidence from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Lot Project', projectNames: ['Lot Project'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const A = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const B = schedule('MASTER B', '2026-09-26T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Lot Project'],
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
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');

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

/** App.tsx's own deleteScheduleItem, compiled, tapping Delete. */
async function deleteTask(state: State, taskId: string) {
  let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const failures: string[] = [];
  const tombstones: DAVESyncTombstone[] = [];
  const scheduleItemsCurrentRef = { current: state.items };
  const record = async (list: Array<{ entityType: DAVESyncTombstone['entityType']; recordId: string }>) => {
    const recorded = list.map(entry => ({ ...entry, deletedAt: '2026-09-29T18:00:00.000Z' }));
    tombstones.push(...recorded);
    return recorded;
  };
  const noop = () => undefined;
  const deps: Record<string, unknown> = {
    ...deletedTaskEvidence,
    scheduleItemsCurrentRef, referenceDocumentsCurrentRef: { current: state.documents },
    Alert: { alert: (title: string, _message: string, list?: typeof buttons) => { if (list) buttons = list; else failures.push(title); } },
    recordDAVESyncTombstones: record,
    recordDAVESyncTombstone: async (entityType: DAVESyncTombstone['entityType'], recordId: string) => (await record([{ entityType, recordId }]))[0],
    advanceScheduleItemSyncGeneration: noop, cancelScheduleItemTextSync: noop, rememberOperationalTombstones: noop,
    removeOperationalRecordFromSyncQueue: async () => undefined,
    clearScheduleItemSyncConflicts: async () => undefined, markScheduleItemsAuthorityReady: noop, setScheduleItems: noop,
    dependencyChangesForDeletedTask, scheduleItemSyncWarningsRef: { current: new Set<string>() }, updateScheduleItem: noop,
  };
  const js = ts.transpileModule(
    [componentFunction('dropDeletedPredecessors'), componentFunction('deleteScheduleItem'), 'module.exports = { deleteScheduleItem };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { deleteScheduleItem: (itemId: string) => void } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  mod.exports.deleteScheduleItem(taskId);
  buttons.find(button => button.text === 'Delete')!.onPress!();
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => setImmediate(resolve));
  expect(failures).toEqual([]);
  return { items: scheduleItemsCurrentRef.current, tombstones };
}

const PHASE_2 = 'Pour slab,Lot Project,Lot,10/20/2026,10/22/2026,0%';
const onA = approve({ items: [], documents: [] }, A, rows(A, ['Pour slab,Lot Project,Lot,09/01/2026,09/03/2026,40%', PHASE_2]));
const [phase1, phase2] = pours(onA.items).sort((left, right) => left.startDate.localeCompare(right.startDate));
const onB = approve(onA, B, rows(B, ['Pour slab,Lot Project,Lot,09/02/2026,09/04/2026,40%', PHASE_2]));
const movedRow = pours(onB.items).find(item => item.id !== phase1.id && item.id !== phase2.id)!;
const aDoc = onB.documents.find(document => document.id === A.id)!;
const bDoc = onB.documents.find(document => document.id === B.id)!;
/** Make Current back to master A. */
const backOnA: State = { ...onB, documents: scheduleDocumentsAfterActivation(aDoc, onB.documents, 'project') };
const report: ProjectUpdate = {
  id: 'u-phase-1-complete', projectName: 'Lot Project', scheduleProjectName: 'Lot Project', date: '2026-09-28T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is complete.', scheduleItemId: phase1.id, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;

describe('A10 p8 L1: deleting a task after Make Current back to the old master', () => {
  it('the scenario: A\'s phase 1 is shown, and B\'s hidden row answers to it', () => {
    expect(movedRow.revisedFromTaskIds).toEqual([phase1.id]);
    expect(pours(shown(backOnA)).map(item => item.id).sort()).toEqual([phase1.id, phase2.id].sort());
  });

  it('the delete takes B\'s hidden row too; the report is history, matched to no task, and Set Active on B does not bring phase 1 back', async () => {
    const after = await deleteTask(backOnA, phase1.id);
    expect(after.tombstones.map(entry => entry.recordId).sort()).toEqual([phase1.id, movedRow.id].sort());
    const split = deletedTaskEvidence.partitionProjectUpdatesByDeletedTask([report], after.tombstones, update => update, { scheduleItems: after.items });
    expect(split.active).toEqual([]);
    expect(split.historical.map(update => update.id)).toEqual(['u-phase-1-complete']);
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown({ ...backOnA, items: after.items }), updates: split.active, projectName: 'Lot Project', now: new Date('2026-09-29T19:00:00.000Z'),
    });
    expect(reconciliation.matches).toEqual([]);
    const onBAgain = { items: after.items, documents: scheduleDocumentsAfterActivation(bDoc, backOnA.documents, 'project') };
    expect(pours(shown(onBAgain)).map(item => item.id)).toEqual([phase2.id]);
  });

  it('only the chain\'s hidden rows of the same project: a row of another project that lists the id stays', () => {
    const otherProject = { ...movedRow, id: 'beta-moved', projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    expect(deletedTaskEvidence.scheduleItemIdsDeletedWithTask([...backOnA.items, otherProject], phase1, backOnA.documents).sort())
      .toEqual([phase1.id, movedRow.id].sort());
  });
});
