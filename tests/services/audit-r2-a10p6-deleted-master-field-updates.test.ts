/**
 * Audit round 2, A10 pass 6 M1 (30 Sep 2026): deleting the old master with
 * its items hid the field updates of every task the new master moved.
 *
 * A field update is linked to Pour slab on 25 Sep. On 26 Sep a new master
 * moves Pour slab: the import saves it as a new row and hides the old one. The
 * dialog for "Delete PDF + Items" on the old master says it removes the items
 * only that PDF contains "so outdated dates do not confuse Upcoming"; the old
 * Pour slab row is only in the old master, so its deletion is recorded. The
 * update still names the old id, so partitionProjectUpdatesByDeletedTask took
 * it for evidence of a deleted task: it left reconciliation, correlation,
 * Project Truth, the inbox, the project stats and the report scope, and the
 * feed called it "Historical evidence — linked task was deleted." while Pour
 * slab was still shown. The web did the same.
 *
 * Now an update is deleted-task evidence only when no saved task left
 * answers to its task id (its earlier ids; the stored-name fallback 1cebe2f
 * also used here was dropped by A10 pass 7 L1). And "Delete PDF + Items"
 * writes each removed id onto the one task
 * shown after the delete with its name, project and area, before the
 * deletions are recorded, so a row saved before the earlier ids were kept
 * answers to it by id. A task genuinely deleted stays history. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import {
  buildPIEScheduleReconciliation,
  scheduleDocumentIsScheduleLike,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import * as provenance from '../../services/ScheduleImportProvenance';
import * as lookaheadDelete from '../../services/ScheduleLookahead';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

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
const ROOFING = 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%';

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
const named = (items: readonly ScheduleItem[], name: string) => items.filter(item => item.taskName === name);

/** Master 0831 has Pour slab; master 0926 moves it by a day and leaves Roofing. */
function moved(legacy: boolean): State & { oldId: string } {
  const before = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%', ROOFING]));
  const oldId = named(before.items, 'Pour slab')[0].id;
  const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%', ROOFING]));
  // A row a new master saved before 79f49d3 kept no earlier ids.
  const items = legacy ? after.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) : after.items;
  return { ...after, items, oldId };
}

function fieldUpdate(id: string, scheduleItemId: string, taskName = 'Pour slab'): ProjectUpdate {
  return {
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-25T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
    notes: `${taskName}: forms set; rebar inspection passed.`, scheduleItemId, scheduleTaskName: taskName, selectedAreaName: 'Lot',
  } as ProjectUpdate;
}

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

/** App.tsx's own deleteScheduleDocument, compiled, tapping "Delete PDF + Items". */
async function deleteWithItems(state: State, document: ReferenceDocument) {
  let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const failures: string[] = [];
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
    Alert: { alert: (title: string, _message: string, list?: typeof buttons) => { if (list) buttons = list; else failures.push(title); } },
    recordDAVESyncTombstones: async (list: Array<{ entityType: DAVESyncTombstone['entityType']; recordId: string }>) => {
      const recorded = list.map(entry => ({ ...entry, deletedAt: '2026-09-27T12:00:00.000Z' }));
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
  expect(failures).toEqual([]);
  return { items: scheduleItemsCurrentRef.current, documents: referenceDocumentsCurrentRef.current, tombstones, synced };
}

/** The phone's partition: every saved task (App.tsx; the saved schedules too until A10 pass 7 L1). */
const phonePartition = (state: State, tombstones: readonly DAVESyncTombstone[], updates: ProjectUpdate[]) =>
  partitionProjectUpdatesByDeletedTask(updates, tombstones, update => update, { scheduleItems: state.items });

describe('A10 p6 M1: "Delete PDF + Items" on the old master keeps the field updates of a task the new master moved', () => {
  it.each([
    ['saved after 79f49d3 (earlier ids kept)', false],
    ['saved before 79f49d3 (no earlier ids)', true],
  ])('a row %s: the update stays current, and reconciliation matches it to Pour slab', async (_label, legacy) => {
    const state = moved(legacy);
    const update = fieldUpdate('u-pour-25sep', state.oldId);
    const after = await deleteWithItems(state, master);
    expect(after.tombstones.map(entry => entry.recordId)).toEqual([master.id, state.oldId]);
    const pour = named(shown(after), 'Pour slab');
    expect(pour).toHaveLength(1);
    expect(pour[0].revisedFromTaskIds).toEqual([state.oldId]);
    // A row saved before 79f49d3 takes the removed id and is saved to every device; one saved after already had it.
    expect(after.synced.map(item => item.id)).toEqual(legacy ? [pour[0].id] : []);
    const partition = phonePartition(after, after.tombstones, [update]);
    expect(partition.historical).toEqual([]);
    expect(partition.active.map(value => value.id)).toEqual(['u-pour-25sep']);
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown(after), updates: partition.active, projectName: 'Alpha', now: new Date('2026-09-27T12:00:00.000Z'),
    });
    expect(reconciliation.matches.filter(match => match.scheduleItemId === pour[0].id).map(match => match.updateId)).toEqual(['u-pour-25sep']);
  });

  it('a pair is made only when exactly one task shown and one task removed have the name: two removed Pour slabs write nothing', async () => {
    const before = approve({ items: [], documents: [] }, master, rows(master, [
      'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,100%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', ROOFING,
    ]));
    // The new master drops phase 1 and moves phase 2: one row against two saved, so the import pairs neither.
    const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026,0%', ROOFING]));
    const deleted = await deleteWithItems(after, master);
    expect(deleted.tombstones).toHaveLength(3);
    expect(named(shown(deleted), 'Pour slab')[0]).not.toHaveProperty('revisedFromTaskIds');
    expect(deleted.synced).toEqual([]);
  });
});

describe('A10 p6 M1: the partition asks whether a saved task still answers to the update\'s task id', () => {
  const tombstone = (recordId: string): DAVESyncTombstone => ({ entityType: 'schedule_item', recordId, deletedAt: '2026-09-27T12:00:00.000Z' });
  /** The old master deleted before this fix: its rows gone, no id written on the new rows. */
  function deletedBeforeFix(legacy: boolean) {
    const state = moved(legacy);
    const removed = provenance.scheduleItemsOnlyInImportBatch(state.items, master, state.documents);
    const after: State = {
      items: state.items.filter(item => !removed.includes(item)),
      documents: state.documents.filter(document => document !== master),
    };
    return { state, after, tombstones: [{ entityType: 'reference_document', recordId: master.id, deletedAt: '2026-09-27T12:00:00.000Z' } as DAVESyncTombstone, ...removed.map(item => tombstone(item.id))] };
  }

  it('by the earlier ids a new master kept (after 79f49d3)', () => {
    const { state, after, tombstones } = deletedBeforeFix(false);
    expect(phonePartition(after, tombstones, [fieldUpdate('u', state.oldId)]).active).toHaveLength(1);
  });

  // Pin changed deliberately (A10 pass 7 L1, 30 Sep 2026): this asserted that a deleted id still answered by
  // the update's stored task name among the tasks shown. That fallback put a task David deleted himself onto a
  // same-named task, so a deleted id answers only by the ids a task had before; "Delete PDF + Items" writes the
  // removed id onto a row saved before those were kept (the it.each above), and an old master deleted before
  // that (no id written) leaves its updates history, as before 1cebe2f.
  it('a row saved before 79f49d3 with no id written: the stored task name no longer answers to a deleted id', () => {
    const { state, after, tombstones } = deletedBeforeFix(true);
    expect(phonePartition(after, tombstones, [fieldUpdate('u', state.oldId)]).historical).toHaveLength(1);
    // Two tasks shown with the name: history too.
    const twin = { ...named(after.items, 'Pour slab')[0], id: 'twin-pour' };
    const twins = { ...after, items: [...after.items, twin] };
    expect(phonePartition(twins, tombstones, [fieldUpdate('u', state.oldId)]).historical).toHaveLength(1);
  });

  it('a task genuinely deleted (no task left answers to it) stays historical evidence', () => {
    const state = moved(false);
    const roofing = named(state.items, 'Roofing')[0];
    const items = state.items.filter(item => item.id !== roofing.id);
    const partition = phonePartition({ ...state, items }, [tombstone(roofing.id)], [fieldUpdate('u-roof', roofing.id, 'Roofing')]);
    expect(partition.active).toEqual([]);
    expect(partition.historical.map(value => value.id)).toEqual(['u-roof']);
  });

  it('without the saved tasks, as before: every update linked to a deleted id is history', () => {
    const { state, tombstones } = deletedBeforeFix(false);
    expect(partitionProjectUpdatesByDeletedTask([fieldUpdate('u', state.oldId)], tombstones, update => update).historical).toHaveLength(1);
  });

  // Pin changed deliberately (A10 pass 7 L1): with no name fallback the partition needs no schedules, only
  // every saved task, so the phone no longer passes the saved schedules (nor re-runs on them).
  it('the phone passes every saved task to the partition', () => {
    expect(app).toMatch(/partitionProjectUpdatesByDeletedTask\(\s*savedUpdates,\s*operationalSyncTombstones,\s*update => update,\s*\{ scheduleItems: scheduleItems as unknown as [^}]+\}/);
    expect(app).toMatch(/\[operationalSyncTombstones, savedUpdates, scheduleItems\]/);
  });

  it('the web: an update linked to the old row stays in the snapshot; one linked to a task genuinely deleted does not', async () => {
    const { state, after, tombstones } = deletedBeforeFix(false);
    const roofing = named(after.items, 'Roofing')[0];
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: 'p-alpha', name: 'Alpha', archived: false }],
      scheduleItems: after.items.filter(item => item !== roofing).map(item => ({ id: item.id, item_data: item })),
      referenceDocuments: after.documents.map(document => ({ id: document.id, document_data: document })),
      projectUpdates: [fieldUpdate('u-pour', state.oldId), fieldUpdate('u-roof', roofing.id, 'Roofing')]
        .map(update => ({ id: update.id, project_name: 'Alpha', update_data: update })),
      syncTombstones: [...tombstones, tombstone(roofing.id)].map(entry => ({
        entity_type: entry.entityType, record_id: entry.recordId, deleted_at: entry.deletedAt,
      })),
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.map(item => item.taskName)).toEqual(['Pour slab']);
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual(['u-pour']);
  });
});
