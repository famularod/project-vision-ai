/**
 * Audit round 2, A7 pass 26, A6 pass 23 and A5 pass 23 (1 Oct 2026): the
 * progress Full Sync carries from a task's old row to the newest row that
 * answers to it (3035b7a, A6 pass 22 M1).
 *
 * A7 p26 M-1 (Medium, caused by 3035b7a): the carried percent stayed on the
 *   device (Full Sync carries after it uploads; a refresh uploads nothing),
 *   and as David's it outranked the cloud's copy whole, so that device's next
 *   Full Sync wrote its old notes, owner, dates and lookahead over the other
 *   device's newer ones.
 * A7 p26 L-1 (older): the cloud and the web showed 0% until a second Full
 *   Sync.
 * A7 p26 L-2 (caused by 3035b7a; A5 p23 L2 and A6 p23 L1 the same): a
 *   realtime echo put 0% back until the next refresh; each refresh carried
 *   again with a new stamp and re-saved the task list; after a sync round the
 *   two devices' copies differed only in that stamp.
 * A6 p23 M1 (Medium, older): the offline percent entered before G was lost
 *   when Framing had an earlier lookahead both devices saw.
 * A5 p23 L1 (Low, caused by 3035b7a): a refresh or Full Sync carried
 *   David's percent past a master that had replaced it with a file's, below
 *   a newer master's percent (owner answer Q32, option b: the newest master
 *   wins).
 * A5 p23 M (Medium, older): a deleted old master took David's offline
 *   percent with it.
 * A5 recorded Low R-c on Full Sync (cab99c0, owner answer Q22): a
 *   lookahead the phone approved below David's percent entered on the
 *   offline iPad was not floored at it.
 * A7 p26 follow-up (Low, caused by dbf7192; owner answer Q32, option b):
 *   David's 80% on the phone's old row, the very percent the iPad's newer
 *   master had already given the task, was carried past the iPad's later
 *   master stating 70%. One device shows 70%.
 * A7 p27 M (Medium, older): an old master deleted on the phone and heard
 *   over realtime on the iPad took David's percent on its row with it.
 * A7 p27 L1 (Low, caused by 30170fc): the carry's own upload closed a task
 *   conflict waiting for Review Conflicts.
 *
 * The two-device tests run in the app's real order, with each device's own
 * storage and one cloud: SyncService's Full Sync (upload, then download), its
 * queue and uploads, App.tsx's own download apply, refresh, startup load,
 * task edit and schedule effect (compiled from its source), and the realtime
 * applier. Synthetic data.
 */
/* ---------------------------------------------------------------------------
 * Two devices, one cloud, in the app's real order (A7 pass 26).
 *
 * Each device has its own app storage (the durable queue, the conflict store,
 * the deletion journal). The cloud is one row per task and one deletion
 * history. SyncService runs for real: Full Sync is synchronizeLocalData
 * (upload first, then download), a task edit is runScheduleItemCloudSync, an
 * approval is runScheduleImportCloudSync, the queue is uploadPendingChanges.
 * App.tsx's own code runs, compiled from its source: Full Sync's download
 * apply, the routine refresh, the startup cloud load, the task edit and the
 * schedule effects. A realtime echo is DAVEOperationalRealtimeApplication.
 * The background upload the app requests is a pass of uploadPendingChanges
 * right after. Synthetic data.
 * ------------------------------------------------------------------------- */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { DAVESyncTombstone, ReferenceDocument, ScheduleItem } from '../../types';

const mockStores = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockStore = () => {
  let store = mockStores.get(mockDevice);
  if (!store) { store = new Map(); mockStores.set(mockDevice, store); }
  return store;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore().get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStore().set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStore().delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStore().keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStore().get(key) ?? null])),
  },
}));

/** The cloud: task rows, deletion history, every write, and the realtime events to deliver. */
const mockCloud = {
  rows: new Map<string, unknown>(),
  tombstones: [] as Array<{ entityType: string; recordId: string; deletedAt: string }>,
  writes: [] as string[],
  events: [] as Array<{ id: string; row: unknown }>,
  offline: new Set<string>(),
};
const mockCopy = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockDown = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
const mockOnline = () => !mockCloud.offline.has(mockDevice);
/** Each cloud call takes a second of the (fake) clock, so a write is later than the edit that sent it. */
const mockTick = () => { try { jest.setSystemTime(Date.now() + 1000); } catch { /* real timers */ } };
const MOCK_PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
jest.mock('../../services/SupabaseService', () => {
  const actual = jest.requireActual('../../services/SupabaseService');
  const read = <T,>(data: () => T) => async () => { mockTick(); return mockOnline() ? mockOk(data()) : mockDown(); };
  // The table's trigger deletes a tombstoned record's row (dave_remove_tombstoned_operational_row).
  const addTombstones = (list: Array<{ entityType: string; recordId: string; deletedAt: string }>) => {
    list.forEach(tombstone => {
      if (!mockCloud.tombstones.some(known => known.entityType === tombstone.entityType && known.recordId === tombstone.recordId)) {
        mockCloud.tombstones.push(mockCopy(tombstone));
      }
      if (tombstone.entityType === 'schedule_item') mockCloud.rows.delete(tombstone.recordId);
    });
  };
  return {
    ...actual,
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    testSupabaseConnection: async () => (mockOnline()
      ? { connected: true, projectCount: 1 }
      : { connected: false, projectCount: null, error: 'Network request failed' }),
    countCloudProjects: read(() => 1),
    listProjects: read(() => [{ id: MOCK_PROJECT_ID, name: 'Alpha' }]),
    listArchivedProjects: read(() => []),
    listProjectUpdates: read(() => []),
    listProjectAreas: read(() => []),
    listReferenceDocuments: read(() => []),
    listScheduleItems: read(() => [...mockCloud.rows.values()].map(mockCopy)),
    getScheduleItem: async (id: string) => { mockTick(); return mockOnline() ? mockOk(mockCloud.rows.has(id) ? mockCopy(mockCloud.rows.get(id)) : null) : mockDown(); },
    upsertScheduleItem: async (item: { id: string }) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      mockCloud.rows.set(item.id, mockCopy(item));
      mockCloud.writes.push(`${mockDevice}:${item.id}`);
      mockCloud.events.push({ id: item.id, row: mockCopy(item) });
      return mockOk(mockCopy(item));
    },
    listDAVESyncTombstones: read(() => mockCopy(mockCloud.tombstones)),
    upsertDAVESyncTombstone: async (tombstone: { entityType: string; recordId: string; deletedAt: string }) => {
      if (!mockOnline()) return mockDown();
      addTombstones([tombstone]);
      return mockOk(tombstone);
    },
    upsertDAVESyncTombstones: async (list: Array<{ entityType: string; recordId: string; deletedAt: string }>) => {
      if (!mockOnline()) return mockDown();
      addTombstones(list);
      return mockOk(list);
    },
    createProject: async (input: { name: string }) => (mockOnline() ? mockOk({ id: MOCK_PROJECT_ID, name: input.name }) : mockDown()),
    upsertProjectArea: async () => (mockOnline() ? mockOk(null) : mockDown()),
    upsertReferenceDocument: async (document: unknown) => (mockOnline() ? mockOk(document) : mockDown()),
  };
});
// The app's background upload is run by the rig, right after each action that requests it.
jest.mock('../../services/BackgroundTaskGuard', () => ({ startGuardedBackgroundTask: () => undefined }));

import { daveScheduleItemsNeedingCloudUpload, isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords, scheduleItemsAfterCloudDeletion } from '../../services/DAVEScheduleRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { deletedDAVERecordIds, loadDAVEOperationalTombstones, recordDAVESyncTombstones, synchronizeDAVESyncTombstones } from '../../services/DAVESyncTombstones';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { reconcileCurrentScheduleDocuments, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemRevisionForCloudRefresh } from '../../services/ScheduleItemQueueRevision';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import {
  getOfflineQueue, getSyncConflicts, queueScheduleItemProgressCarried, queueScheduleItemRecord, runScheduleImportCloudSync, runScheduleItemCloudSync,
  synchronizeLocalData, uploadPendingChanges,
} from '../../services/SyncService';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';

/* App.tsx's own code, compiled -------------------------------------------- */
const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function appSlice(from: string, to: string, includeEnd = false): string {
  const start = APP.indexOf(from);
  if (start < 0) throw new Error(`App.tsx no longer has: ${from}`);
  const end = APP.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`App.tsx no longer has: ${to}`);
  return APP.slice(start, includeEnd ? end + to.length : end);
}
function compiled<T>(body: string, deps: Record<string, unknown>): T {
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports as T;
}
const REFRESH_SOURCE = appSlice("      if (scheduleItemsLoaded && shouldRefresh('schedule_items')) collectionRefreshes.push({ name: 'schedule_items', run: async () => {", '\n      }});', true);
const FULL_SYNC_APPLY_SOURCE = appSlice('                if (failed.scheduleItems === null) {', '\n                }\n', true);
const STARTUP_APPLY_SOURCE = appSlice('    applyCloud: (items, tombstones) => setScheduleItems(current => recoverDAVEScheduleRecords({', '\n    })),', true);
const UPDATE_SOURCE = appSlice('\n  function updateScheduleItem(', '\n  async function saveScheduleItemChanges(');
/** The schedule effect that sends what the merge carried (A7 pass 26), where the app has it. */
const CARRY_EFFECT_LINE = APP.split('\n').find(line => line.includes('useEffect(') && line.includes('(scheduleItems)') && line.includes('Carried')) ?? null;
const carryModulePath = path.resolve(__dirname, '../../services/ScheduleProgressCarryUpload.ts');
const carryModule = fs.existsSync(carryModulePath)
  ? require('../../services/ScheduleProgressCarryUpload') as Record<string, (items: readonly ScheduleItem[]) => Promise<number>>
  : null;

const identity = <T,>(value: T) => value;
const listCopy = (items: ScheduleItem[]) => items.map(item => ({ ...item }));

/* A device ---------------------------------------------------------------- */
type DeviceName = 'phone' | 'ipad';
type Device = {
  name: DeviceName;
  /** The app's state and the ref its async code reads (the ref follows each render). */
  state: ScheduleItem[];
  ref: { current: ScheduleItem[] };
  documents: ReferenceDocument[];
  /** Times the saved task list changed (the app persists on each change). */
  saves: number;
  generation: Map<string, number>;
  effectsSeen: ScheduleItem[] | null;
  pendingEffects: Array<Promise<unknown>>;
};

function newDevice(name: DeviceName): Device {
  return { name, state: [], ref: { current: [] }, documents: [], saves: 0, generation: new Map(), effectsSeen: null, pendingEffects: [] };
}

const on = (device: Device) => { mockDevice = device.name; };

function setter(device: Device) {
  return (next: ScheduleItem[] | ((previous: ScheduleItem[]) => ScheduleItem[])) => {
    const value = typeof next === 'function' ? (next as (previous: ScheduleItem[]) => ScheduleItem[])(device.state) : next;
    if (value !== device.state) device.saves += 1;
    device.state = value;
  };
}

/** A render: the ref takes the state, and the effects whose state changed run (the carry effect where the app has one). */
async function render(device: Device) {
  device.ref.current = device.state;
  if (device.effectsSeen === device.state) return;
  device.effectsSeen = device.state;
  if (!CARRY_EFFECT_LINE || !carryModule) return;
  const deps: Record<string, unknown> = {
    useEffect: (effect: () => void) => effect(),
    startupHydrationReady: true,
    scheduleItemsLoaded: true,
    scheduleItems: device.state,
    queueScheduleProgressCarriedToCloud: (items: readonly ScheduleItem[]) => {
      const pending = carryModule.queueScheduleProgressCarriedToCloud(items);
      device.pendingEffects.push(pending);
      return pending;
    },
  };
  compiled(`module.exports = null; ${CARRY_EFFECT_LINE}`, deps);
  await Promise.all(device.pendingEffects.splice(0));
}

/** The upload pass the app requests in the background after queueing. */
async function backgroundUpload(device: Device) {
  on(device);
  if (mockOnline()) await uploadPendingChanges();
}

/* Actions, each as the app runs it ----------------------------------------- */
const rowsOf = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
  mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));

const scheduleDoc = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** Approving a schedule (App.tsx's approval: the import merge, then the approved rows queued whole and sent). */
async function approve(device: Device, source: ReferenceDocument, lines: string[], lookahead = false) {
  on(device);
  const before = device.ref.current;
  const merged = mergeApprovedScheduleImportItems({
    existing: before, imported: rowsOf(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(before, [...device.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...(lookahead ? { overlay: true } : {}),
  });
  const synchronized = reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]);
  const previous = new Map(before.map(item => [item.id, item]));
  const changed = synchronized.filter(item => JSON.stringify(item) !== JSON.stringify(previous.get(item.id)));
  const result = await runScheduleImportCloudSync({ scheduleItems: changed, referenceDocuments: [] });
  const superseded = new Set(result.supersededScheduleItemIds);
  setter(device)(synchronized.filter(item => !superseded.has(item.id)));
  device.documents = lookahead ? [...device.documents, source]
    : scheduleDocumentsAfterActivation(source, [...device.documents, source], 'project');
  await render(device);
}

/** A task edit (App.tsx's updateScheduleItem, then its sync). */
async function edit(device: Device, itemId: string, change: Partial<ScheduleItem>) {
  on(device);
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: device.ref,
    withProjectControlsEditMerged,
    reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }),
    displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: (id: string) => { const next = (device.generation.get(id) || 0) + 1; device.generation.set(id, next); return next; },
    markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: setter(device),
    scheduleItemChangeUsesDebouncedSync: () => false,
    cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: (item: ScheduleItem, _generation: number, changedFields?: readonly (keyof ScheduleItem)[]) => {
      device.pendingEffects.push(runScheduleItemCloudSync(item, changedFields));
    },
    queueScheduleItemRecord,
    Alert: { alert: () => undefined },
  };
  const update = compiled<(id: string, change: Partial<ScheduleItem>) => void>(`module.exports = (() => { ${UPDATE_SOURCE}\n return updateScheduleItem; })();`, deps);
  update(itemId, change);
  await Promise.all(device.pendingEffects.splice(0));
  await render(device);
}

/** Full Sync from Settings: synchronizeLocalData, then App.tsx's download apply. */
async function fullSync(device: Device, upload = true) {
  on(device);
  const result = await synchronizeLocalData({
    projects: ['Alpha'], savedUpdates: [], projectAreas: [], scheduleItems: device.state, referenceDocuments: [],
  } as never);
  if (!result.connected) return result;
  const recovered = result.recovered;
  const apply = compiled<(recovered: unknown) => void>(`module.exports = (recovered) => { const failed = recovered.collectionErrors; ${FULL_SYNC_APPLY_SOURCE} };`, {
    normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
    markScheduleItemsAuthorityReady: () => undefined, recordScheduleCloudPull: async () => undefined,
  });
  apply(recovered);
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return result;
}

/** The routine refresh (App.tsx's operational refresh of tasks, after its deletion history). */
async function refresh(device: Device, upload = true) {
  on(device);
  if (!mockOnline()) return false;
  const tombstones = await loadDAVEOperationalTombstones();
  const collectionRefreshes: Array<{ name: string; run: () => Promise<void> }> = [];
  compiled(`module.exports = null; ${REFRESH_SOURCE}`, {
    scheduleItemsLoaded: true, shouldRefresh: () => true, collectionRefreshes,
    listScheduleItems: require('../../services/SupabaseService').listScheduleItems,
    active: true, refreshCommit: { isCurrent: () => true, commit: (commit: () => void) => commit() },
    normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
    deletedDAVERecordIds, tombstones, scheduleItemsCurrentRef: device.ref, getOfflineQueue,
    scheduleItemRevisionForCloudRefresh, recoverDAVEScheduleRecords, setScheduleItems: setter(device),
    identityAliasCleanup: { markScheduleRefreshed: () => undefined }, recordScheduleCloudPull: async () => undefined,
    refreshStartedAt: new Date().toISOString(),
  });
  try {
    await collectionRefreshes[0].run();
  } catch {
    return false;
  }
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return true;
}

/** The startup cloud load (App.tsx's applyCloud, after the deletion history). */
async function startup(device: Device, upload = true) {
  on(device);
  if (!mockOnline()) return false;
  const tombstones = await synchronizeDAVESyncTombstones();
  const list = await require('../../services/SupabaseService').listScheduleItems();
  if (!list.ok || !tombstones.cloudAuthoritative) return false;
  const holder = compiled<{ applyCloud: (items: ScheduleItem[], tombstones: unknown) => void }>(`module.exports = { ${STARTUP_APPLY_SOURCE} };`, {
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
  });
  holder.applyCloud((list.data as ScheduleItem[]).filter(isDAVESafeCloudScheduleRecord), tombstones.tombstones);
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return true;
}

/** Realtime: each cloud write since the device last heard, as the app applies it. */
const heard = new Map<DeviceName, number>();
async function echoes(device: Device) {
  on(device);
  if (!mockOnline()) return 0;
  const from = heard.get(device.name) ?? 0;
  const events = mockCloud.events.slice(from);
  heard.set(device.name, mockCloud.events.length);
  const tombstones = deletedDAVERecordIds(mockCloud.tombstones as DAVESyncTombstone[], 'schedule_item');
  const apply = createDAVEOperationalRealtimeApplier({
    isActive: () => true,
    snapshot: () => ({
      projects: ['Alpha'], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: [], deletedUpdates: [],
      tombstones: mockCloud.tombstones as DAVESyncTombstone[], areas: [], scheduleItems: device.ref.current, documents: device.documents,
    }),
    getPendingQueue: getOfflineQueue,
    normalizeUpdate: identity as never, normalizeAreas: identity as never,
    normalizeSchedule: (value: unknown) => listCopy(value as ScheduleItem[]),
    normalizeDocuments: identity as never, migrateSchedule: identity,
    localPhotoUri: () => '', mergeProjectNames: (base: string[]) => base, updateHasPendingLocalWork: () => false,
    mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates, buildUpdateTombstone: identity as never,
    buildCloudDeletionBarrier: identity as never, upsertDeletedUpdate: identity as never,
    commitProjects: () => undefined, commitDeletedProjects: () => undefined, commitUpdates: () => undefined,
    commitDeletedUpdates: () => undefined, commitTombstones: () => undefined, commitAreas: () => undefined,
    commitSchedule: (items: ScheduleItem[]) => { setter(device)(items); device.ref.current = items; },
    commitDocuments: () => undefined,
  } as never);
  for (const event of events) {
    if (tombstones.includes(event.id)) continue;
    await apply('schedule_item', { eventType: 'UPDATE', newRow: { id: event.id, item_data: event.row } } as never);
  }
  await render(device);
  return events.length;
}

/** Realtime: each deletion-history row since the device last heard, as the app applies it (A7 pass 27). */
const heardTombstones = new Map<DeviceName, number>();
async function tombstoneEchoes(device: Device) {
  on(device);
  if (!mockOnline()) return 0;
  const from = heardTombstones.get(device.name) ?? 0;
  const events = mockCloud.tombstones.slice(from);
  heardTombstones.set(device.name, mockCloud.tombstones.length);
  let tombstones = mockCloud.tombstones.slice(0, from) as DAVESyncTombstone[];
  const apply = createDAVEOperationalRealtimeApplier({
    isActive: () => true,
    snapshot: () => ({
      projects: ['Alpha'], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: [], deletedUpdates: [],
      tombstones, areas: [], scheduleItems: device.ref.current, documents: device.documents,
    }),
    getPendingQueue: getOfflineQueue,
    normalizeUpdate: identity as never, normalizeAreas: identity as never,
    normalizeSchedule: (value: unknown) => listCopy(value as ScheduleItem[]),
    normalizeDocuments: identity as never, migrateSchedule: identity,
    localPhotoUri: () => '', mergeProjectNames: (base: string[]) => base, updateHasPendingLocalWork: () => false,
    mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates, buildUpdateTombstone: identity as never,
    buildCloudDeletionBarrier: identity as never, upsertDeletedUpdate: identity as never,
    commitProjects: () => undefined, commitDeletedProjects: () => undefined, commitUpdates: () => undefined,
    commitDeletedUpdates: () => undefined, commitTombstones: (next: DAVESyncTombstone[]) => { tombstones = next; }, commitAreas: () => undefined,
    commitSchedule: (items: ScheduleItem[]) => { setter(device)(items); device.ref.current = items; },
    commitDocuments: () => undefined,
  } as never);
  for (const tombstone of events) {
    const row = { entity_type: tombstone.entityType, record_id: tombstone.recordId, deleted_at: tombstone.deletedAt };
    await apply('sync_tombstone' as never, { eventType: 'INSERT', newRow: row } as never);
  }
  await render(device);
  return events.length;
}

/** Delete PDF + Items of a schedule on this device (App.tsx: the deletion history first, then the tasks it gives back, sent). */
async function deleteWithItems(device: Device, target: ReferenceDocument) {
  on(device);
  const document = device.documents.find(saved => saved.id === target.id);
  if (!document) return;
  const items = device.ref.current;
  const removed = scheduleItemsOnlyInImportBatch(items, document, device.documents.filter(scheduleDocumentIsScheduleLike));
  await recordDAVESyncTombstones(removed.map(item => ({ entityType: 'schedule_item' as const, recordId: item.id })));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = device.documents.filter(other => other.id !== document.id);
  const kept = items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents }).map(item => [item.id, item]));
  setter(device)(kept.map(item => restored.get(item.id) || item));
  device.documents = documents;
  deletedDocuments.add(document.id);
  await Promise.all([...restored.values()].map(item => runScheduleItemCloudSync(item)));
  await render(device);
}

/* Documents: carried with each sync (not under test here) ------------------- */
let cloudDocuments: ReferenceDocument[] = [];
const deletedDocuments = new Set<string>();
function syncDocuments(device: Device) {
  if (!mockOnline()) return;
  const merged = reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({
    local: device.documents, cloud: cloudDocuments, deletedIds: [...deletedDocuments],
  }));
  cloudDocuments = merged;
  device.documents = merged;
}
function shareDocuments(device: Device) { on(device); syncDocuments(device); }

/* Reading what each place shows ------------------------------------------ */
function setOnline(device: Device, online: boolean) {
  if (online) mockCloud.offline.delete(device.name); else mockCloud.offline.add(device.name);
}
const isOnline = (device: Device) => !mockCloud.offline.has(device.name);
function cloudItems(): ScheduleItem[] {
  const deleted = new Set(deletedDAVERecordIds(mockCloud.tombstones as DAVESyncTombstone[], 'schedule_item'));
  return [...mockCloud.rows.values()].map(row => mockCopy(row) as ScheduleItem).filter(item => !deleted.has(item.id));
}
function shownOf(items: readonly ScheduleItem[], documents: readonly ReferenceDocument[]): ScheduleItem[] {
  return selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }) as ScheduleItem[];
}
/** The web desktop: the cloud's rows under the cloud's schedules. */
const webShown = () => shownOf(cloudItems(), cloudDocuments);
const deviceShown = (device: Device) => shownOf(device.state, device.documents);
async function queueOf(device: Device) { on(device); return getOfflineQueue(); }
async function conflictsOf(device: Device) { on(device); return getSyncConflicts(); }
const cloudWrites = () => mockCloud.writes.length;
const cloudWriteLog = () => [...mockCloud.writes];
const cloudRow = (id: string) => mockCloud.rows.get(id) as ScheduleItem | undefined;

function resetRig() {
  jest.clearAllMocks(); // the storage mocks' call history, kept by jest, grows with every sequence
  mockStores.clear();
  mockCloud.rows.clear();
  mockCloud.tombstones.length = 0;
  mockCloud.writes.length = 0;
  mockCloud.events.length = 0;
  mockCloud.offline.clear();
  heard.clear();
  heardTombstones.clear();
  cloudDocuments = [];
  deletedDocuments.clear();
  mockDevice = 'phone';
}

/** Both devices start from the phone's approved master, synced to the iPad. */
async function startBoth(master: ReferenceDocument, lines: string[]) {
  resetRig();
  const phone = newDevice('phone');
  const ipad = newDevice('ipad');
  await approve(phone, master, lines);
  shareDocuments(phone);
  await backgroundUpload(phone);
  await fullSync(ipad);
  heard.set('phone', mockCloud.events.length);
  heard.set('ipad', mockCloud.events.length);
  return { phone, ipad };
}


/* ---------------------------------------------------------------------------
 * The findings.
 * ------------------------------------------------------------------------- */
jest.setTimeout(60_000);
const F = scheduleDoc('MASTER F', '2026-09-07T12:00:00.000Z');
const G = scheduleDoc('MASTER G', '2026-09-14T12:00:00.000Z');
const H = scheduleDoc('MASTER H', '2026-09-21T12:00:00.000Z');
const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
const F_ROW = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,';
const G_ROW = (pct = '') => `Framing,Alpha,Lot,10/22/2026,11/01/2026,${pct}`;
const BEFORE_G = '2026-09-14T10:00:00.000Z';
const AFTER_G = '2026-09-14T14:00:00.000Z';

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-09-10T08:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
});
afterEach(() => { jest.useRealTimers(); });
const at = (when: string) => jest.setSystemTime(Date.parse(when));

const framingOf = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Framing');
/** What a place shows of Framing: dates, percent, notes, owner. */
const shows = (items: readonly ScheduleItem[]) => framingOf(items).map(item => [item.startDate, item.finishDate, item.percentComplete, item.notes || '', item.owner || '']);
const onDevice = (device: Device) => shows(deviceShown(device));
const onWeb = () => shows(webShown());
const theRow = (device: Device) => framingOf(deviceShown(device))[0];
/** Cloud writes of Framing's rows (another task's re-upload, unrelated to the carry, is left out). */
const framingWritesOf = (...devices: Device[]) => {
  const ids = new Set(devices.flatMap(device => framingOf(device.state).map(item => item.id)));
  return cloudWriteLog().filter(entry => ids.has(entry.slice(entry.indexOf(':') + 1))).length;
};

/**
 * F current on both devices. The iPad goes offline and David enters 30% on
 * Framing (F's row) at `when`; on the phone master G moves Framing to a new
 * row (G's row answers to F's). The iPad comes back online.
 */
async function offlineThirty(when = AFTER_G, gPercent = '') {
  const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
  setOnline(ipad, false);
  const [earlier, later] = when < G.importedAt! ? ['ipad', 'phone'] : ['phone', 'ipad'];
  for (const who of [earlier, later]) {
    if (who === 'ipad') { at(when); await edit(ipad, theRow(ipad).id, { percentComplete: 30 }); }
    else { at(G.importedAt!); await approve(phone, G, [G_ROW(gPercent), SURVEY]); shareDocuments(phone); }
  }
  at('2026-09-15T08:00:00.000Z');
  setOnline(ipad, true);
  return { phone, ipad };
}

describe('A7 p26 M-1: a carried percent goes up as itself, and never carries an old copy over newer edits', () => {
  it('(a) the iPad\'s Full Sync sends the 30% at once; the phone\'s note and owner typed after it survive the iPad\'s next Full Sync', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad);
    expect(onDevice(ipad)).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    expect(onWeb()).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    expect(await queueOf(ipad)).toEqual([]);
    setOnline(ipad, false);
    at('2026-09-15T09:00:00.000Z');
    // The phone has not heard of the 30% (no echo, no refresh): its copy is at 0%.
    expect(onDevice(phone)).toEqual([['10/22/2026', '11/01/2026', 0, '', '']]);
    await edit(phone, theRow(phone).id, { notes: 'Crew short Tuesday' });
    await edit(phone, theRow(phone).id, { owner: 'Mike' });
    at('2026-09-15T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    const expected = [['10/22/2026', '11/01/2026', 30, 'Crew short Tuesday', 'Mike']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
  });

  it('(a) the same when the 30% is still waiting to go up (the iPad went offline right after its sync)', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    setOnline(ipad, false);
    expect(onWeb()).toEqual([['10/22/2026', '11/01/2026', 0, '', '']]);
    expect((await queueOf(ipad)).map(item => [item.id, (item.payload as { changedFields?: string[] }).changedFields?.includes('notes')]))
      .toEqual([['schedule-item-MASTER%20G-1', false]]);
    at('2026-09-15T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'Crew short Tuesday' });
    await edit(phone, theRow(phone).id, { owner: 'Mike' });
    at('2026-09-15T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    const expected = [['10/22/2026', '11/01/2026', 30, 'Crew short Tuesday', 'Mike']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
  });

  it.each([['the iPad', true], ['the phone', false]])('(c) a note the offline phone typed on G\'s row before David\'s 30% survives when %s syncs first', async (_first, ipadFirst) => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(), SURVEY]);
    shareDocuments(phone);
    setOnline(phone, false);
    at('2026-09-14T13:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'Crew short Tuesday' });
    at(AFTER_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z');
    setOnline(ipad, true);
    setOnline(phone, true);
    for (const device of ipadFirst ? [ipad, phone, ipad, phone] : [phone, ipad, phone, ipad]) await fullSync(device);
    await refresh(phone);
    await refresh(ipad);
    const expected = [['10/22/2026', '11/01/2026', 30, 'Crew short Tuesday', '']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
  });

  it.each([
    ['the 30% already in the cloud, the phone\'s copy carried by an echo', true],
    ['the 30% still waiting on the iPad, the phone\'s copy at 0%', false],
  ])('(b) a lookahead the phone approves afterwards is not undone by the iPad\'s Full Sync: %s', async (_label, landed) => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, landed);
    if (landed) await echoes(phone); else setOnline(ipad, false);
    expect(onDevice(phone)[0][2]).toBe(landed ? 30 : 0);
    at('2026-09-16T09:00:00.000Z');
    const L = scheduleDoc('LOOKAHEAD L', '2026-09-16T09:00:00.000Z', 'lookahead');
    await approve(phone, L, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,'], true);
    shareDocuments(phone);
    at('2026-09-16T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    const expected = [['10/25/2026', '11/04/2026', 30, '', '']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
    const note = (row: ScheduleItem | undefined) => row?.lookaheadOverlay?.lookaheads.map(entry => [entry.batchId, entry.startDate]);
    expect([note(cloudRow('MASTER G-1')), note(theRow(ipad)), note(theRow(phone))]).toEqual(Array(3).fill([['batch-LOOKAHEAD L', '10/25/2026']]));
  });
});

describe('A7 p26 L-1: the cloud and the web get the carried percent', () => {
  it.each([
    ['the iPad\'s first Full Sync', (ipad: Device) => fullSync(ipad)],
    ['a refresh on the iPad', async (ipad: Device) => { await backgroundUpload(ipad); await refresh(ipad); }],
    ['the iPad\'s startup cloud load', async (ipad: Device) => { await backgroundUpload(ipad); await startup(ipad); }],
  ] as const)('after %s, the cloud and the web show 30%%, and the phone after its refresh', async (_label, sync) => {
    const { phone, ipad } = await offlineThirty();
    await sync(ipad);
    expect(onDevice(ipad)).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    expect(onWeb()).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    await refresh(phone);
    expect(onDevice(phone)).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
  });
});

describe('A7 p26 L-2: no 0% flicker, no re-stamp, no re-save', () => {
  it('a note saved on the phone after the carry echoes to both devices at 30%', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad);
    await echoes(phone);
    at('2026-09-15T11:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'Pump truck booked' });
    await echoes(ipad);
    await echoes(phone);
    const expected = [['10/22/2026', '11/01/2026', 30, 'Pump truck booked', '']];
    expect([onDevice(ipad), onDevice(phone), onWeb()]).toEqual([expected, expected, expected]);
  });

  it('while the 30% waits on the iPad\'s queue, an echo of the phone\'s note keeps 30% on the iPad', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    at('2026-09-15T11:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'Pump truck booked' });
    await echoes(ipad);
    expect(onDevice(ipad)).toEqual([['10/22/2026', '11/01/2026', 30, 'Pump truck booked', '']]);
  });

  it('a refresh that carries nothing new saves nothing; the carried row keeps G\'s row\'s own stamp, not the clock', async () => {
    const { ipad } = await offlineThirty();
    await backgroundUpload(ipad);
    at('2026-09-15T12:00:00.000Z');
    const g = cloudRow('MASTER G-1')!;
    // G's row has no stamp of its own (an approved row is as of its import): 1 ms after its import and David's 30%.
    const own = g.updatedAt ?? new Date(Math.max(Date.parse(g.importedAt!), Date.parse(AFTER_G)) + 1).toISOString();
    await refresh(ipad);
    const carried = theRow(ipad);
    expect(carried.percentComplete).toBe(30);
    // Only its progress changed, and that carries its own time (David's 30%, 14:00).
    expect([carried.updatedAt, carried.progressConfirmedAt]).toEqual([own, AFTER_G]);
    expect(cloudRow(carried.id)).toEqual(carried);
    const saves = ipad.saves;
    for (const when of ['2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z']) {
      at(when);
      await refresh(ipad);
    }
    expect(ipad.saves).toBe(saves);
    expect(theRow(ipad)).toBe(carried);
  });

  it('a task the web added has no stamp of its own: the carried copy reads newer than an unstamped copy, so Full Sync does not send it again and again', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    // The web's upload of G saved Framing's new row as the file gave it, with no stamp of its own.
    const { updatedAt: _none, ...webRow } = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [davids.id] } as ScheduleItem;
    const carried = recoverDAVEScheduleRecords({ local: [davids, webRow as ScheduleItem], cloud: [davids, webRow as ScheduleItem], allowCloudOnly: true })
      .find(item => item.id === webRow.id)!;
    expect([carried.percentComplete, carried.updatedAt]).toEqual([30, new Date(Date.parse(AFTER_G) + 1).toISOString()]);
    // The iPad's copy has the same progress on the unstamped row (a merge took the web's row as its base).
    const { updatedAt: _also, ...unstamped } = carried;
    expect(daveScheduleItemsNeedingCloudUpload({ local: [unstamped as ScheduleItem], cloud: [carried] })).toEqual([]);
    expect(recoverDAVEScheduleRecords({ local: [davids, unstamped as ScheduleItem], cloud: [davids, carried], allowCloudOnly: true })
      .find(item => item.id === carried.id)!.updatedAt).toBe(carried.updatedAt);
  });

  it('after a sync round both devices hold the same copy, so the next round changes nothing (A6 p23 L1)', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad);
    await fullSync(phone);
    await fullSync(ipad);
    const row = (device: Device) => device.state.find(item => item.id === 'MASTER G-1');
    expect(row(phone)).toEqual(row(ipad));
    expect(row(phone)).toEqual(cloudRow('MASTER G-1'));
    const framingWrites = () => framingWritesOf(phone, ipad);
    const writes = framingWrites();
    at('2026-09-16T08:00:00.000Z');
    await fullSync(phone);
    await fullSync(ipad);
    expect(framingWrites()).toBe(writes);
  });
});

describe('A7 p26: the rules the carry keeps', () => {
  it('David\'s later percent on G\'s row wins, also over a carry still waiting on the iPad\'s queue', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    setOnline(ipad, false);
    at('2026-09-15T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 50 });
    at('2026-09-15T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([50, 50, 50]);
  });

  it('a higher percent G states stands', async () => {
    const { phone, ipad } = await offlineThirty(AFTER_G, '60');
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([60, 60, 60]);
  });

  it('a newer lookahead\'s stated percent above David\'s restates, also over a carry still waiting', async () => {
    const { phone, ipad } = await offlineThirty(BEFORE_G);
    await fullSync(ipad, false);
    setOnline(ipad, false);
    at('2026-09-16T09:00:00.000Z');
    const L = scheduleDoc('LOOKAHEAD L', '2026-09-16T09:00:00.000Z', 'lookahead');
    await approve(phone, L, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,60'], true);
    shareDocuments(phone);
    at('2026-09-16T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0].slice(0, 3))).toEqual(Array(3).fill(['10/25/2026', '11/04/2026', 60]));
  });

  it('a task deleted while its carried percent waits is not brought back', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    setOnline(ipad, false);
    at('2026-09-16T09:00:00.000Z');
    await deleteWithItems(phone, G);
    shareDocuments(phone);
    at('2026-09-16T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    expect(cloudItems().map(item => item.id)).not.toContain('MASTER G-1');
    expect(ipad.state.map(item => item.id)).not.toContain('MASTER G-1');
    expect(await queueOf(ipad)).toEqual([]);
  });

  it('a note typed on the iPad while its carried percent waits goes up with it; a percent David enters there afterwards replaces the carried one', async () => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    setOnline(ipad, false);
    at('2026-09-15T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: 'Inspection Friday' });
    const payloadOf = async () => (await queueOf(ipad)).map(item => item.payload as { carriedProgress?: boolean; changedFields?: string[] });
    expect((await payloadOf()).map(payload => [payload.carriedProgress, payload.changedFields?.includes('notes'), payload.changedFields?.includes('percentComplete')]))
      .toEqual([[true, true, true]]);
    at('2026-09-15T10:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 45 });
    expect((await payloadOf()).map(payload => payload.carriedProgress)).toEqual([undefined]);
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(phone)]).toEqual(Array(2).fill([['10/22/2026', '11/01/2026', 45, 'Inspection Friday', '']]));
  });

  it('A6 p22 M1\'s case still carries past a row between: G\'s percent below David\'s on the phone, then H', async () => {
    const { phone, ipad } = await offlineThirty(AFTER_G, '20');
    at(H.importedAt!);
    await approve(phone, H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,10', SURVEY]);
    shareDocuments(phone);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
  });

  it('Set Active\'s own carry is unchanged: stamped at the Set Active, sent whole', () => {
    const items = [
      { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G },
      { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: ['MASTER F-1'] },
    ] as ScheduleItem[];
    const documents = [{ ...F, isCurrent: true }, { ...G, isCurrent: false }];
    const after = scheduleDocumentsAfterActivation(G, documents, 'project');
    const carried = require('../../services/ScheduleImportMerge').scheduleProgressCarriedOnActivation({
      items, documentsBefore: documents, documentsAfter: after, now: '2026-09-20T09:00:00.000Z',
    }) as ScheduleItem[];
    expect(carried.map(item => [item.id, item.percentComplete, item.updatedAt])).toEqual([['MASTER G-1', 30, '2026-09-20T09:00:00.000Z']]);
  });
});

describe('A6 p23 M1: the offline percent entered before G, when Framing had an earlier lookahead', () => {
  it.each([['L1 states no percent', '', 0], ['L1 states 20%', '20', 20]] as const)('%s: 30%% after Full Sync on both devices, the cloud and the web', async (_label, l1, l1Pct) => {
    const L1 = scheduleDoc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at(L1.importedAt!);
    await approve(phone, L1, [`Framing,Alpha,Lot,10/18/2026,10/28/2026,${l1}`], true);
    shareDocuments(phone);
    await fullSync(ipad);
    expect(onDevice(ipad)[0][2]).toBe(l1Pct);
    setOnline(ipad, false);
    at(BEFORE_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 30 });
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(), SURVEY]);
    shareDocuments(phone);
    at('2026-09-15T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 30, '', '']]));
    // David's own 30%, carried as his: not a file's percent floored at it.
    expect([cloudRow('MASTER G-1'), theRow(ipad), theRow(phone)].map(row => [row!.progressSource, row!.progressConfirmedBy]))
      .toEqual(Array(3).fill(['project_manager', 'David']));
  });

  it('a lookahead approved on G\'s row after its import still counts as a restatement', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: BEFORE_G, progressConfirmedBy: 'David', updatedAt: BEFORE_G } as ScheduleItem;
    const restated = {
      ...rowsOf(G, [G_ROW()])[0], percentComplete: 20, status: 'In Progress', revisedFromTaskIds: [davids.id],
      lookaheadOverlay: {
        masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 0,
        lookaheads: [{ batchId: 'batch-LOOKAHEAD L2', startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 20 }],
      },
    } as ScheduleItem;
    // Not carried as David's own: the lookahead's percent stands (or, under Q32, is floored at his, still the file's).
    const merged = recoverDAVEScheduleRecords({ local: [davids], cloud: [restated], allowCloudOnly: true }).find(item => item.id === restated.id)!;
    expect([merged.progressSource ?? null, merged.progressConfirmedBy ?? null]).toEqual([null, null]);
  });
});

describe('A5 p23 L1 and owner answer Q32 (option b): a newer master that replaced David\'s percent with a file\'s stands after the sync too', () => {
  it('one device: F, David\'s 50%, G moves Framing at 100%, H moves it at 10%: 10% after approval, a refresh, a restart and Full Sync', async () => {
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 50 });
    at(G.importedAt!);
    await approve(phone, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,100', SURVEY]);
    shareDocuments(phone);
    at(H.importedAt!);
    await approve(phone, H, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,10', SURVEY]);
    shareDocuments(phone);
    expect(onDevice(phone)[0][2]).toBe(10);
    await refresh(phone);
    expect(onDevice(phone)[0][2]).toBe(10);
    await startup(phone);
    expect(onDevice(phone)[0][2]).toBe(10);
    const writes = cloudWrites();
    await fullSync(phone);
    expect([onDevice(phone)[0][2], onWeb()[0][2], cloudWrites()]).toEqual([10, 10, writes]);
  });

  it.each([
    ['G and H move Framing', 'Framing,Alpha,Lot,10/18/2026,10/28/2026,60', 'Framing,Alpha,Lot,10/20/2026,10/30/2026,30'],
  ] as const)('two devices (Q32 case 1): David\'s 40%% on the offline iPad before G; G at 60%% and H at 30%% on the phone; %s: H\'s 30%% everywhere', async (_label, gRow, hRow) => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(BEFORE_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 40 });
    at(G.importedAt!);
    await approve(phone, G, [gRow, SURVEY]);
    shareDocuments(phone);
    at(H.importedAt!);
    await approve(phone, H, [hRow, SURVEY]);
    shareDocuments(phone);
    at('2026-09-22T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
  });

  // Q32 case 1 with Framing on its dates, left open: G and H restate F's row in place, and the row keeps only H's 30%, not
  // that G's 60% had replaced David's 40% first. Merging the iPad's copy (his 40%) with the cloud's (30%) cannot tell this
  // from H stating 30% straight over his 40%, which one device ignores. Telling them apart needs the row to keep each file's
  // stated percent, which the import does not record. The A7 p26 follow-up's rule (below) does not fit: there is no row
  // between, and his 40% was his own word on the row (it differed from what the row showed), so H's 30% stated after it
  // is the "straight over his 40%" case as far as the merge can see. Left as it was (the follow-up re-checked it).
  it.skip('two devices (Q32 case 1), Framing on its dates: H\'s 30% everywhere (open: the row does not keep G\'s 60%)', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(BEFORE_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 40 });
    at(G.importedAt!);
    await approve(phone, G, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,60', SURVEY]);
    shareDocuments(phone);
    at(H.importedAt!);
    await approve(phone, H, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,30', SURVEY]);
    shareDocuments(phone);
    at('2026-09-22T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
  });

  it('a row between whose master stated more than David\'s, then a lookahead lowered it, still took his percent over', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T16:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-10T16:00:00.000Z' } as ScheduleItem;
    // G (11 Sep) moved Framing at 70%, above his 60%; a lookahead then lowered G's row to 10%; H (13 Sep) moved it at 30%.
    const between = {
      ...rowsOf(G, [G_ROW('70')])[0], importedAt: '2026-09-11T12:00:00.000Z', percentComplete: 10, status: 'In Progress', revisedFromTaskIds: [davids.id],
      lookaheadOverlay: {
        masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 70, masterFilePercentComplete: 70, masterProgressSource: null,
        lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/24/2026', finishDate: '11/03/2026', percentComplete: 10 }],
      },
    } as ScheduleItem;
    const newest = { ...rowsOf(H, ['Framing,Alpha,Lot,10/27/2026,11/06/2026,30'])[0], importedAt: '2026-09-13T23:00:00.000Z', revisedFromTaskIds: [davids.id, between.id] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [davids], cloud: [davids, between, newest], allowCloudOnly: true });
    expect(merged.find(item => item.id === newest.id)!.percentComplete).toBe(30);
  });

  it('a percent the row between took from a lookahead note its import brought along does not stop the carry; one G stated itself does (A6 p23 M1)', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-12T10:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-12T10:00:00.000Z' } as ScheduleItem;
    const note = {
      masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 0, masterFilePercentComplete: 0,
      lookaheads: [{ batchId: 'batch-LOOKAHEAD L1', startDate: '10/18/2026', finishDate: '10/28/2026', percentComplete: 40, datesReplacedByMaster: 'batch-MASTER G' }],
    };
    const between = { ...rowsOf(G, [G_ROW()])[0], percentComplete: 40, status: 'In Progress', revisedFromTaskIds: [davids.id], lookaheadOverlay: note } as ScheduleItem;
    const newest = { ...rowsOf(H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,10'])[0], revisedFromTaskIds: [davids.id, between.id] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [davids], cloud: [between, newest], allowCloudOnly: true });
    expect(merged.find(item => item.id === newest.id)!.percentComplete).toBe(30);
    // The same row between, its 40% stated by G itself: G took David's 30% over, and H's newer 10% stands (Q32, option b).
    const stated = { ...between, lookaheadOverlay: { ...note, masterPercentComplete: 40, masterFilePercentComplete: 40 } } as ScheduleItem;
    expect(recoverDAVEScheduleRecords({ local: [davids], cloud: [stated, newest], allowCloudOnly: true }).find(item => item.id === newest.id)!.percentComplete).toBe(10);
  });
});

describe('A5 p23 M: a deleted old master no longer takes David\'s offline percent with it', () => {
  it('Delete PDF + Items of F on the phone after G: Full Sync keeps the 30% on G\'s row everywhere', async () => {
    const { phone, ipad } = await offlineThirty(BEFORE_G);
    setOnline(ipad, false);
    at('2026-09-15T09:00:00.000Z');
    await deleteWithItems(phone, F);
    shareDocuments(phone);
    expect(cloudItems().map(item => item.id)).not.toContain('MASTER F-1');
    at('2026-09-15T10:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 30, '', '']]));
    expect(ipad.state.map(item => item.id)).not.toContain('MASTER F-1');
  });

  it('the mirror: G deleted while the iPad recorded on G\'s row, and H answers to G\'s row', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(), SURVEY]);
    shareDocuments(phone);
    await fullSync(ipad);
    setOnline(ipad, false);
    at('2026-09-15T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 40 });
    at(H.importedAt!);
    await approve(phone, H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,', SURVEY]);
    shareDocuments(phone);
    at('2026-09-21T13:00:00.000Z');
    await deleteWithItems(phone, G);
    shareDocuments(phone);
    at('2026-09-21T14:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/25/2026', '11/04/2026', 40, '', '']]));
  });

  it('pure merge: the deleted row lends its percent and never comes back; a deleted row nothing answers to lends nothing', () => {
    const old = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: BEFORE_G, progressConfirmedBy: 'David', updatedAt: BEFORE_G } as ScheduleItem;
    const moved = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [old.id] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [old], cloud: [moved], deletedIds: [old.id], allowCloudOnly: true });
    expect(merged.map(item => [item.id, item.percentComplete])).toEqual([[moved.id, 30]]);
    const alone = { ...moved, revisedFromTaskIds: [] } as ScheduleItem;
    expect(recoverDAVEScheduleRecords({ local: [old], cloud: [alone], deletedIds: [old.id], allowCloudOnly: true }).map(item => [item.id, item.percentComplete]))
      .toEqual([[moved.id, 0]]);
  });

  it('a row between that this device no longer has (deleted with its schedule here) keeps an older percent of David\'s from coming back', () => {
    const older = { ...rowsOf(F, [F_ROW])[0], percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-08T02:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-08T02:00:00.000Z' } as ScheduleItem;
    // G's row held David's later 50%; H moved Framing at 60% (above his 50%); then G was deleted with its items.
    const newest = { ...rowsOf(H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,60'])[0], revisedFromTaskIds: [older.id, 'MASTER G-1'] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [older, newest], cloud: [older, newest], deletedIds: ['MASTER G-1'], allowCloudOnly: true });
    expect(merged.find(item => item.id === newest.id)!.percentComplete).toBe(60);
  });

  it('a percent of David\'s judged after the newest row\'s import passes a row between that this device never had', () => {
    // G was approved and deleted on the phone while the iPad was offline; H answers to G's row. David's 100% on the iPad
    // came after H's import, so it is newer than anything said on G's row.
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 100, status: 'Complete', progressSource: 'project_manager', progressConfirmedAt: '2026-09-22T10:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-22T10:00:00.000Z' } as ScheduleItem;
    const newest = { ...rowsOf(H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,60'])[0], revisedFromTaskIds: [davids.id, 'MASTER G-1'] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [davids], cloud: [davids, newest], deletedIds: ['MASTER G-1'], allowCloudOnly: true });
    expect(merged.find(item => item.id === newest.id)!.percentComplete).toBe(100);
  });

});

describe('A5 recorded Low R-c on Full Sync (cab99c0, Q22): a lookahead never leaves a synced task below David\'s own percent', () => {
  const L = scheduleDoc('LOOKAHEAD L', '2026-09-14T18:00:00.000Z', 'lookahead');
  /** David's 70% on the offline iPad before G; on the phone G states `gPercent`, then lookahead L states `lPercent`. */
  async function underG(gPercent: string, lPercent: string) {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(BEFORE_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 70 });
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(gPercent), SURVEY]);
    shareDocuments(phone);
    at(L.importedAt!);
    await approve(phone, L, [`Framing,Alpha,Lot,10/24/2026,11/03/2026,${lPercent}`], true);
    shareDocuments(phone);
    at('2026-09-15T08:00:00.000Z');
    setOnline(ipad, true);
    return { phone, ipad };
  }

  it.each([['the iPad syncs first', 'ipad'], ['the phone syncs first', 'phone']] as const)('%s: G 80%%, L 40%%: 70%% on both devices, the cloud and the web, his 70%% kept under the file\'s', async (_label, first) => {
    const { phone, ipad } = await underG('80', '40');
    for (const device of first === 'ipad' ? [ipad, phone, ipad] : [phone, ipad, phone]) await fullSync(device);
    await refresh(phone);
    await refresh(ipad);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/24/2026', '11/03/2026', 70, '', '']]));
    expect([cloudRow('MASTER G-1'), theRow(ipad), theRow(phone)].map(row => row!.managersPercentUnderFile)).toEqual([70, 70, 70]);
    const writes = framingWritesOf(phone, ipad);
    await fullSync(ipad);
    await fullSync(phone);
    expect(framingWritesOf(phone, ipad)).toBe(writes);
  });

  it('unchanged: a lookahead at or above David\'s percent stands', async () => {
    const { phone, ipad } = await underG('80', '75');
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([75, 75, 75]);
  });

  it('a lookahead approved on G\'s row after David\'s earlier 30% (entered before G) states 20%: 30% after Full Sync (Q22)', async () => {
    const { phone, ipad } = await offlineThirty(BEFORE_G);
    at('2026-09-16T09:00:00.000Z');
    const L2 = scheduleDoc('LOOKAHEAD L2', '2026-09-16T09:00:00.000Z', 'lookahead');
    await approve(phone, L2, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,20'], true);
    shareDocuments(phone);
    at('2026-09-16T10:00:00.000Z');
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0].slice(0, 3))).toEqual(Array(3).fill(['10/25/2026', '11/04/2026', 30]));
  });

  it('a percent carried onto a row keeps the row\'s floor with it, the same on the device and in the cloud', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-12T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 20 });
    await fullSync(ipad);
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW('50'), SURVEY]); // G's 50% replaces David's 20%, kept under it
    shareDocuments(phone);
    expect(theRow(phone).managersPercentUnderFile).toBe(20);
    at(AFTER_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 60 });
    at('2026-09-15T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([60, 60, 60]);
    expect([cloudRow('MASTER G-1'), theRow(ipad), theRow(phone)].map(row => row!.managersPercentUnderFile)).toEqual([20, 20, 20]);
  });
  it('a merge takes the floor from the copy whose progress wins, also when the other copy leads the task', () => {
    const row = rowsOf(G, [G_ROW()])[0];
    // The cloud's copy: a later file's 60% over David's 40%, his kept under it. This device's: an older 40%, a note typed since.
    const cloudCopy = { ...row, percentComplete: 60, status: 'In Progress', progressSource: 'schedule_import', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-15T10:00:00.000Z', managersPercentUnderFile: 40, updatedAt: '2026-09-15T10:00:00.000Z' } as ScheduleItem;
    const deviceCopy = { ...row, percentComplete: 40, status: 'In Progress', progressSource: 'schedule_import', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-14T10:00:00.000Z', notes: 'Crane Friday', updatedAt: '2026-09-16T10:00:00.000Z' } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [deviceCopy], cloud: [cloudCopy], allowCloudOnly: true });
    expect([merged.notes, merged.percentComplete, merged.managersPercentUnderFile]).toEqual(['Crane Friday', 60, 40]);
  });

  it('a row where a file replaced a percent David entered on that row itself keeps that one as its floor', () => {
    // David's 40% on F's row (10 Sep); on G's row he later entered 20%, and a lookahead's 30% replaced it (kept under it).
    const older = { ...rowsOf(F, [F_ROW])[0], percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T10:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-10T10:00:00.000Z' } as ScheduleItem;
    const newest = {
      ...rowsOf(G, [G_ROW()])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update',
      progressConfirmedAt: '2026-09-16T09:00:00.000Z', managersPercentUnderFile: 20, revisedFromTaskIds: [older.id],
      lookaheadOverlay: {
        masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 20, masterProgressSource: 'project_manager',
        masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-15T20:00:00.000Z',
        lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/24/2026', finishDate: '11/03/2026', percentComplete: 30 }],
      },
    } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [older], cloud: [newest], allowCloudOnly: true }).find(item => item.id === newest.id)!;
    expect([merged.percentComplete, merged.managersPercentUnderFile]).toEqual([30, 20]);
  });

  // Owner answer Q32 (option b) case 2, left open: David's 40% on both devices; the iPad offline since before G; the phone
  // approves G on Framing's dates at 60% (above his, kept under it) and the iPad approves H on the same dates at 30% (below
  // his, so the iPad keeps his 40%). One device, G then H, ends at H's 30%; after Full Sync the task shows G's 60%. H's
  // statement left no trace on the iPad's copy, and the two copies meet in the whole-row merge (the recorded A7 pass 25 L-2
  // class of two devices approving different imports offline), not in the carry this file covers.
  it.skip('case 2: G at 60% on the phone, H at 30% on the offline iPad, both on Framing\'s dates: H\'s 30% after Full Sync (open)', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 40 });
    await fullSync(ipad);
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,60', SURVEY]);
    shareDocuments(phone);
    at(H.importedAt!);
    await approve(ipad, H, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,30', SURVEY]);
    at('2026-09-22T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    shareDocuments(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
  });

});

describe('A7 p26 follow-up (Q32, option b): a master that stated a percent after David\'s entry stands on Full Sync too', () => {
  const H_ROW = (pct: string) => `Framing,Alpha,Lot,10/25/2026,11/04/2026,${pct}`;
  const percents = (...devices: Device[]) => [onWeb(), ...devices.map(onDevice)].map(place => place.map(row => row[2]));

  /**
   * Seed 4854's shape: David's 70% on both devices; the iPad, offline, approves master G moving Framing at 80% (above his
   * 70%, so the task takes G's 80%); the phone, which has not heard of G, gets David's 80% on its old row; then the iPad,
   * which has not heard of the 80%, approves master H moving Framing at 70%.
   */
  async function seed4854() {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 70 });
    await fullSync(ipad);
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(ipad, G, [G_ROW('80'), SURVEY]);
    at(AFTER_G);
    await edit(phone, theRow(phone).id, { percentComplete: 80 });
    at(H.importedAt!);
    await approve(ipad, H, [H_ROW('70'), SURVEY]);
    at('2026-09-22T08:00:00.000Z');
    setOnline(ipad, true);
    return { phone, ipad };
  }

  it('one device, the same in time order: David\'s 80% changes nothing (G shows 80%), and H\'s 70% stands', async () => {
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 70 });
    at(G.importedAt!);
    await approve(phone, G, [G_ROW('80'), SURVEY]);
    at(AFTER_G);
    await edit(phone, theRow(phone).id, { percentComplete: 80 });
    expect(theRow(phone).progressSource ?? null).not.toBe('project_manager');
    at(H.importedAt!);
    await approve(phone, H, [H_ROW('70'), SURVEY]);
    expect(onDevice(phone)).toEqual([['10/25/2026', '11/04/2026', 70, '', '']]);
  });

  it.each([['the iPad syncs first', 'ipad'], ['the phone syncs first', 'phone']] as const)('two devices (seed 4854), %s: H\'s 70%% on both devices, the cloud and the web; another round writes nothing', async (_label, first) => {
    const { phone, ipad } = await seed4854();
    for (const device of first === 'ipad' ? [ipad, phone, ipad] : [phone, ipad, phone]) await fullSync(device);
    await refresh(phone);
    await refresh(ipad);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/25/2026', '11/04/2026', 70, '', '']]));
    expect(cloudRow('MASTER H-1')).toEqual(ipad.state.find(item => item.id === 'MASTER H-1'));
    const writes = framingWritesOf(phone, ipad);
    at('2026-09-23T08:00:00.000Z');
    await fullSync(ipad);
    await fullSync(phone);
    expect(framingWritesOf(phone, ipad)).toBe(writes);
  });

  it('a master that stated a percent after David\'s entry: G at 30% on the phone, his 30% on the offline iPad\'s old row after G (as G showed), H at 10%: 10%, as on one device', async () => {
    const { phone: alone } = await startBoth(F, [F_ROW, SURVEY]);
    at(G.importedAt!);
    await approve(alone, G, [G_ROW('30'), SURVEY]);
    at(AFTER_G);
    await edit(alone, theRow(alone).id, { percentComplete: 30 });
    at(H.importedAt!);
    await approve(alone, H, [H_ROW('10'), SURVEY]);
    expect(onDevice(alone)[0][2]).toBe(10);

    const { phone, ipad } = await offlineThirty(AFTER_G, '30');
    at(H.importedAt!);
    await approve(phone, H, [H_ROW('10'), SURVEY]);
    shareDocuments(phone);
    await fullSync(ipad);
    await refresh(phone);
    expect(percents(ipad, phone)).toEqual([[10], [10], [10]]);
  });

  it('his percent differs from what G showed (G at 20%, his 30% after it): his own word, which H\'s lower 10% never replaces, as on one device', async () => {
    const { phone: alone } = await startBoth(F, [F_ROW, SURVEY]);
    at(G.importedAt!);
    await approve(alone, G, [G_ROW('20'), SURVEY]);
    at(AFTER_G);
    await edit(alone, theRow(alone).id, { percentComplete: 30 });
    at(H.importedAt!);
    await approve(alone, H, [H_ROW('10'), SURVEY]);
    expect(onDevice(alone)[0][2]).toBe(30);

    const { phone, ipad } = await offlineThirty(AFTER_G, '20');
    at(H.importedAt!);
    await approve(phone, H, [H_ROW('10'), SURVEY]);
    shareDocuments(phone);
    await fullSync(ipad);
    await refresh(phone);
    expect(percents(ipad, phone)).toEqual([[30], [30], [30]]);
  });

  it.each([
    ['G states no percent, his 30% before G (A6 p22 M1)', BEFORE_G, ''],
    ['G states no percent, his 30% after G (A6 p22 M1)', AFTER_G, ''],
    ['G states 20%, approved before his 30% (the iPad\'s entry is later)', AFTER_G, '20'],
  ] as const)('David\'s percent still carries: %s', async (_label, when, gPercent) => {
    const { phone, ipad } = await offlineThirty(when, gPercent);
    await fullSync(ipad);
    await refresh(phone);
    expect(percents(ipad, phone)).toEqual([[30], [30], [30]]);
  });

  it('pure merge: the row G\'s import gave held his 80% as a file\'s when he entered it; not when it held 75%, another status, or his own 80%', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 80, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    const between = { ...rowsOf(G, [G_ROW('80')])[0], revisedFromTaskIds: [davids.id] } as ScheduleItem;
    const newest = { ...rowsOf(H, [H_ROW('70')])[0], revisedFromTaskIds: [davids.id, between.id] } as ScheduleItem;
    const merged = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: [davids], cloud: rows, allowCloudOnly: true })
      .find(item => item.id === newest.id)!.percentComplete;
    expect([between.percentComplete, between.status, between.importedAt! < AFTER_G]).toEqual([80, 'In Progress', true]);
    expect(merged([between, newest])).toBe(70);
    expect(merged([{ ...between, percentComplete: 75 } as ScheduleItem, newest])).toBe(80);
    expect(merged([{ ...between, status: 'Not Started' } as ScheduleItem, newest])).toBe(80);
    // His own 80% there (entered on G's row on the other device): his word, which H's lower 70% never replaces on one device.
    const his = { ...between, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: G.importedAt } as ScheduleItem;
    expect(merged([his, newest])).toBe(80);
  });

  it('pure merge: a lookahead approved since is still floored at that percent of his (owner answer Q22; A5 p23 generator seed 856)', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    const between = { ...rowsOf(G, [G_ROW('60')])[0], revisedFromTaskIds: [davids.id] } as ScheduleItem;
    // H moved Framing stating no percent (G's 60% copied), then lookahead L stated 30% on H's row.
    const newest = {
      ...rowsOf(H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,'])[0], percentComplete: 30, status: 'In Progress', revisedFromTaskIds: [davids.id, between.id],
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'],
      lookaheadOverlay: { masterStartDate: '10/25/2026', masterFinishDate: '11/04/2026', masterPercentComplete: 60, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/27/2026', finishDate: '11/06/2026', percentComplete: 30 }] },
    } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [davids], cloud: [between, newest], allowCloudOnly: true }).find(item => item.id === newest.id)!;
    expect([merged.percentComplete, merged.managersPercentUnderFile]).toEqual([60, 60]);
  });
});

describe('A7 p27 M: an old master deleted on the phone, heard over realtime, keeps David\'s percent', () => {
  /** The phone, offline, approves G and deletes F with its items; the online iPad's 30% on F's row reaches the cloud. */
  async function deletedOffline() {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z');
    await deleteWithItems(phone, F);
    at(AFTER_G);
    await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    expect(cloudRow('MASTER F-1')?.percentComplete).toBe(30);
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true);
    await backgroundUpload(phone); // the reconnect upload sends G's rows
    shareDocuments(phone);
    await fullSync(phone); // the deletion goes up; the cloud drops F's row
    expect(cloudRow('MASTER F-1')).toBeUndefined();
    return { phone, ipad };
  }

  it('the iPad hears of G\'s row, then of F\'s deletion: 30% on G\'s row on the iPad, sent at once; the cloud, the web and the phone show 30%', async () => {
    const { phone, ipad } = await deletedOffline();
    await echoes(ipad);
    expect(await tombstoneEchoes(ipad)).toBe(1);
    expect(ipad.state.map(item => item.id)).not.toContain('MASTER F-1');
    expect(onDevice(ipad)).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    await backgroundUpload(ipad);
    expect(await queueOf(ipad)).toEqual([]);
    await refresh(phone);
    expect([onWeb(), onDevice(phone)]).toEqual(Array(2).fill([['10/22/2026', '11/01/2026', 30, '', '']]));
    const writes = framingWritesOf(phone, ipad);
    at('2026-09-16T08:00:00.000Z');
    await fullSync(ipad); await fullSync(phone); await refresh(ipad);
    expect([framingWritesOf(phone, ipad), onDevice(ipad)[0][2], onDevice(phone)[0][2]]).toEqual([writes, 30, 30]);
  });

  it('unchanged: heard by a refresh instead, the same 30% (A5 p23 M)', async () => {
    const { phone, ipad } = await deletedOffline();
    await refresh(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 30, '', '']]));
  });

  it('pure: a deleted row nothing answers to lends nothing; rows that do not answer to it stay as they were', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    const moved = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [davids.id] } as ScheduleItem;
    // Another task whose own old row holds a percent of David's a refresh would carry: realtime leaves it to the refresh.
    const otherOld = { ...rowsOf(F, ['Roofing,Alpha,Lot,10/15/2026,10/25/2026,'])[0], id: 'MASTER F-9', percentComplete: 50, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David' } as ScheduleItem;
    const otherNew = { ...rowsOf(G, ['Roofing,Alpha,Lot,10/22/2026,11/01/2026,'])[0], id: 'MASTER G-9', revisedFromTaskIds: [otherOld.id] } as ScheduleItem;
    const after = scheduleItemsAfterCloudDeletion([davids, moved, otherOld, otherNew], davids.id);
    expect(after.map(item => [item.id, item.percentComplete])).toEqual([[moved.id, 30], [otherOld.id, 50], [otherNew.id, 0]]);
    expect(scheduleItemsAfterCloudDeletion([davids, otherOld], davids.id).map(item => [item.id, item.percentComplete])).toEqual([[otherOld.id, 50]]);
  });

  // Left open: when the deletion reaches the iPad before G's row does (the phone's Full Sync sends the deletion history
  // before the tasks waiting on its queue), no row on the iPad answers to F's yet, so F's row goes with nothing to lend to,
  // and G's row then arrives at 0%. Holding the deleted row until a row that answers to it arrives needs state the
  // realtime applier does not keep.
  it.skip('the deletion heard before G\'s row (open): 30% everywhere', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z');
    await deleteWithItems(phone, F);
    at(AFTER_G);
    await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await fullSync(phone);
    await tombstoneEchoes(ipad);
    await echoes(ipad);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
  });
});

describe('A7 p27 L1: a carried percent sent on its own leaves a task conflict waiting for Review Conflicts', () => {
  const gOf = (device: Device) => device.state.find(item => item.id === 'MASTER G-1')!;
  const conflictNotes = async (device: Device) => (await conflictsOf(device))
    .map(conflict => [conflict.localId, (conflict.localPayload as { itemData?: ScheduleItem }).itemData?.notes]);
  /** The iPad holds a conflict on G's row (its copy's note against the web's); the phone's 30% on F's row is in the cloud. */
  async function conflictOnG() {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!);
    await approve(ipad, G, [G_ROW(), SURVEY]);
    shareDocuments(ipad);
    await backgroundUpload(ipad);
    at('2026-09-14T13:00:00.000Z');
    await edit(ipad, 'MASTER G-1', { notes: 'iPad note' });
    at('2026-09-14T13:30:00.000Z');
    mockCloud.rows.set('MASTER G-1', { ...cloudRow('MASTER G-1')!, notes: 'Web note', updatedAt: new Date().toISOString() });
    at('2026-09-14T13:40:00.000Z');
    on(ipad);
    await runScheduleItemCloudSync(gOf(ipad)); // Save sends the iPad's whole copy: the web changed it first
    expect(await conflictNotes(ipad)).toEqual([['MASTER G-1', 'iPad note']]);
    at(AFTER_G);
    await edit(phone, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true);
    await backgroundUpload(phone);
    return { phone, ipad };
  }

  it('the iPad\'s refresh carries the 30% to G\'s row and sends it: the cloud has 30% and the web\'s note; the conflict still waits', async () => {
    const { ipad } = await conflictOnG();
    await refresh(ipad);
    expect([cloudRow('MASTER G-1')?.percentComplete, cloudRow('MASTER G-1')?.notes]).toEqual([30, 'Web note']);
    expect(await queueOf(ipad)).toEqual([]);
    expect(await conflictNotes(ipad)).toEqual([['MASTER G-1', 'iPad note']]);
  });

  it('the same carry reaching a cloud copy that already holds it leaves the conflict too', async () => {
    const { ipad } = await conflictOnG();
    await refresh(ipad);
    const carried = gOf(ipad);
    on(ipad);
    await queueScheduleItemProgressCarried(carried, { ...carried, percentComplete: 0, status: 'Not Started', progressSource: null, progressConfirmedBy: null, progressConfirmedAt: null } as ScheduleItem);
    const writes = cloudWrites();
    await backgroundUpload(ipad);
    expect([await queueOf(ipad), cloudWrites() - writes]).toEqual([[], 0]);
    expect(await conflictNotes(ipad)).toEqual([['MASTER G-1', 'iPad note']]);
  });

  it('a note David types while the carry waits goes up with it and settles the conflict, as any edit of his does', async () => {
    const { ipad } = await conflictOnG();
    await refresh(ipad, false);
    expect((await queueOf(ipad)).map(item => (item.payload as { carriedProgress?: boolean }).carriedProgress)).toEqual([true]);
    at('2026-09-15T09:00:00.000Z');
    await edit(ipad, 'MASTER G-1', { notes: 'Inspection Friday' });
    expect([cloudRow('MASTER G-1')?.percentComplete, cloudRow('MASTER G-1')?.notes]).toEqual([30, 'Inspection Friday']);
    expect(await conflictNotes(ipad)).toEqual([]);
  });
});

describe('convergence', () => {
  it.each([['iPad syncs first', 'ipad'], ['phone syncs first', 'phone']] as const)('%s: after both devices sync, both devices, the cloud and the web agree; another round writes and saves nothing', async (_label, first) => {
    const { phone, ipad } = await offlineThirty(BEFORE_G);
    const order = first === 'ipad' ? [ipad, phone, ipad] : [phone, ipad, phone];
    for (const device of order) await fullSync(device);
    await refresh(phone); await refresh(ipad); await echoes(phone); await echoes(ipad);
    const expected = [['10/22/2026', '11/01/2026', 30, '', '']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
    const [writes, saves] = [cloudWrites(), phone.saves + ipad.saves];
    at('2026-09-16T08:00:00.000Z');
    await fullSync(ipad); await fullSync(phone);
    const fullSyncSaves = phone.saves + ipad.saves - saves; // Full Sync's download apply saves the list each time, as before
    await refresh(phone); await refresh(ipad); await echoes(phone); await echoes(ipad);
    expect([cloudWrites() - writes, phone.saves + ipad.saves - saves - fullSyncSaves]).toEqual([0, 0]);
  });
});
