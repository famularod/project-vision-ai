/**
 * Audit round 2, A10 pass 7 L5 (30 Sep 2026): deleting a task a master had
 * moved left its updates from before the move current.
 *
 * A field update is linked to Pour slab on 25 Sep. On 26 Sep a new master
 * moves Pour slab: the import saves it as a new row that answers to the old
 * id (revisedFromTaskIds) and hides the old row. David then deletes Pour slab.
 * The delete recorded only the new row's deletion, so the 25 Sep update, linked
 * to the hidden old row's id, was no deleted task's: it stayed in the project
 * stats, the inbox and the reports as current evidence of a task that is gone.
 *
 * Now deleting a task also records the deletion of the saved hidden rows it
 * answers to (its earlier ids, in the same project), so the updates linked to
 * them become history too. Rows still shown, and rows of another project, are
 * left alone. These tests run App.tsx's own deleteScheduleItem, compiled.
 * Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import * as deletedTaskEvidence from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
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

const ROOFING = 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%';
const before = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%', ROOFING]));
const oldId = before.items.find(item => item.taskName === 'Pour slab')!.id;
const moved = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%', ROOFING]));
const pourNow = shown(moved).find(item => item.taskName === 'Pour slab')!;

const fieldUpdate = (id: string, scheduleItemId: string, date: string): ProjectUpdate => ({
  id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date, photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab: forms set.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
}) as ProjectUpdate;

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
  const dequeued: string[] = [];
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
    removeOperationalRecordFromSyncQueue: async (_type: string, id: string) => { dequeued.push(id); },
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
  return { items: scheduleItemsCurrentRef.current, tombstones, dequeued };
}

describe('A10 p7 L5: deleting a task a master moved makes its updates from before the move history', () => {
  it('the scenario: the row shown answers to the hidden old row', () => {
    expect(pourNow.id).not.toBe(oldId);
    expect(pourNow.revisedFromTaskIds).toEqual([oldId]);
    expect(moved.items.some(item => item.id === oldId)).toBe(true);
    expect(shown(moved).some(item => item.id === oldId)).toBe(false);
  });

  it('David deletes Pour slab: the hidden old row is deleted too, and the 25 Sep update is history', async () => {
    const updates = [fieldUpdate('u-25sep', oldId, '2026-09-25T15:00:00.000Z'), fieldUpdate('u-27sep', pourNow.id, '2026-09-27T15:00:00.000Z')];
    const after = await deleteTask(moved, pourNow.id);
    const split = deletedTaskEvidence.partitionProjectUpdatesByDeletedTask(updates, after.tombstones, update => update, { scheduleItems: after.items });
    expect(split.active.map(update => update.id)).toEqual([]);
    expect(split.historical.map(update => update.id)).toEqual(['u-25sep', 'u-27sep']);
    expect(after.tombstones.map(entry => entry.recordId).sort()).toEqual([oldId, pourNow.id].sort());
    expect(after.items.map(item => item.taskName)).toEqual(['Roofing']);
    expect(after.dequeued.sort()).toEqual([oldId, pourNow.id].sort());
  });

  it('a task no master moved deletes only itself', async () => {
    const roofing = shown(moved).find(item => item.taskName === 'Roofing')!;
    const after = await deleteTask(moved, roofing.id);
    expect(after.tombstones.map(entry => entry.recordId)).toEqual([roofing.id]);
  });

  it('only saved hidden rows of the same project: a row still shown, or of another project, stays', () => {
    const hiddenOld = moved.items.find(item => item.id === oldId)!;
    const otherProject = { ...hiddenOld, id: 'beta-old', projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    const roofing = shown(moved).find(item => item.taskName === 'Roofing')!;
    const task = { ...pourNow, revisedFromTaskIds: [oldId, 'beta-old', roofing.id, 'never-saved'] } as ScheduleItem;
    const items = [...moved.items.map(item => (item.id === pourNow.id ? task : item)), otherProject];
    expect(deletedTaskEvidence.scheduleItemIdsDeletedWithTask(items, task, moved.documents)).toEqual([pourNow.id, oldId]);
  });
});
