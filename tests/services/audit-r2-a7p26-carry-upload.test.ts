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
 * A7 p27 L2 (Low, older): after the queue-only upload refused a carry, Sync
 *   Now sent the iPad's old copy whole over a newer lookahead.
 * A5 p24 L1 (Low, caused by dc3f469): a master stating exactly David's
 *   percent was read as having taken it over.
 * A5 p24 L3 (Low, caused by ef943e5): deleted rows passing David's percent:
 *   (a) an unknown row between stopped a newer one, (b) an older one passed
 *   a row between holding a newer one.
 * A6 p24 L1 (Low, caused by cab99c0): a lookahead floor older than the
 *   percent David entered since came back from the other device's copy.
 * A5 p25 L1 (Low, partly caused by d3db006): a refresh carried David's old
 *   percent past masters that had replaced it, once a later master restated
 *   the row between at or below his percent.
 * A7 p28 L (Low, caused by b3d1970): a carry from a row deleted over
 *   realtime, refused later, let Sync Now send the iPad's old copy whole.
 * A7 p29 L1 (Low, caused by f81ccc1; with F's row kept, from 30170fc): a
 *   percent a lookahead delete gave back while its upload waited was weighed
 *   as a carry by the refresh and the startup load, which showed the deleted
 *   lookahead's percent; a note or Sync Now in that window kept it.
 * A5 p26 L1 (Low, caused by aa3e0be and 82b9842): after a Talk Undo, the
 *   undone percent another device still held was taken as David's latest
 *   entry: kept as the floor under a file's percent, or as having taken his
 *   percent over on a new master's row.
 * Left open, with their tests skipped: A5 p24 L1 (b), A5 p24 L2 and the A5
 *   recorded Low (Set Active to an older master); see each test.
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
    // Independent review R02: several tasks' rows are read by their ids in one request, and a GPS area's row by its id.
    getScheduleItemsByIds: async (ids: string[]) => (mockOnline()
      ? mockOk(ids.flatMap(id => (mockCloud.rows.has(id) ? [mockCopy(mockCloud.rows.get(id))] : []))) : mockDown()),
    getProjectAreasByIds: async () => (mockOnline() ? mockOk([]) : mockDown()),
    upsertScheduleItem: async (item: { id: string }) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      mockCloud.rows.set(item.id, mockCopy(item));
      mockCloud.writes.push(`${mockDevice}:${item.id}`);
      mockCloud.events.push({ id: item.id, row: mockCopy(item) });
      return mockOk(mockCopy(item));
    },
    listDAVESyncTombstones: read(() => mockCopy(mockCloud.tombstones)),
    // The deletion records the cloud holds now for these records of one kind (sync batch Y1, item 2).
    listDAVESyncTombstonesForRecords: async (entityType: string, ids: string[]) => (mockOnline()
      ? mockOk(mockCopy(mockCloud.tombstones.filter(tombstone => tombstone.entityType === entityType &&
        ids.some(id => id.trim().toLowerCase() === tombstone.recordId.trim().toLowerCase()))))
      : mockDown()),
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

import { clearDeletedScheduleRowsHeld, daveScheduleItemsNeedingCloudUpload, isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords, scheduleItemsAfterCloudDeletion, scheduleItemsAfterCloudRowHeard } from '../../services/DAVEScheduleRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { deletedDAVERecordIds, loadDAVEOperationalTombstones, recordDAVESyncTombstones, synchronizeDAVESyncTombstones } from '../../services/DAVESyncTombstones';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { reconcileCurrentScheduleDocuments, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation, scheduleProgressCarriedToShownTasks } from '../../services/ScheduleImportMerge';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemRevisionForCloudRefresh, scheduleItemsWithPendingEditsOverCloud } from '../../services/ScheduleItemQueueRevision';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import {
  getOfflineQueue, getSyncConflicts, queueScheduleItemProgressCarried, queueScheduleItemRecord, runScheduleImportCloudSync, runScheduleItemCloudSync,
  synchronizeLocalData, uploadPendingChanges, listScheduleItemsWithEditsWaiting, scheduleItemEditsWaitingAtLastLoad,
} from '../../services/SyncService';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleFileTookHisPercentOver, scheduleManagersOwnPercent, scheduleNewestMastersPercentOverHis, scheduleManagersPercentUnderFileOfBoth, scheduleProgressLeftStanding, scheduleProgressStandsSince, scheduleProgressUndoPoint, scheduleTalkUndo } from '../../services/ScheduleProgressSource';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';

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

/** A task edit (App.tsx's updateScheduleItem, then its sync); `restoresProgress` as Talk's Undo applies its edit. */
async function edit(device: Device, itemId: string, change: Partial<ScheduleItem>, restoresProgress = false) {
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
    // The task the edit started from goes with it (owner answer Q28).
    syncScheduleItemRevision: (item: ScheduleItem, _generation: number, changedFields?: readonly (keyof ScheduleItem)[], before?: ScheduleItem) => {
      device.pendingEffects.push(runScheduleItemCloudSync(item, changedFields, before));
    },
    queueScheduleItemRecord,
    Alert: { alert: () => undefined },
  };
  const update = compiled<(id: string, change: Partial<ScheduleItem>, workflow?: unknown, restores?: boolean) => void>(`module.exports = (() => { ${UPDATE_SOURCE}\n return updateScheduleItem; })();`, deps);
  update(itemId, change, undefined, restoresProgress);
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
    scheduleItemsWithPendingEditsOverCloud, // a task edit waiting with its base, over the cloud's row (owner answer Q28)
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
  const list = await listScheduleItemsWithEditsWaiting(); // the App's loadCloud, noting the task edits waiting (owner answer Q28)
  if (!list.ok || !tombstones.cloudAuthoritative) return false;
  const holder = compiled<{ applyCloud: (items: ScheduleItem[], tombstones: unknown) => void }>(`module.exports = { ${STARTUP_APPLY_SOURCE} };`, {
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
    scheduleItemsWithPendingEditsOverCloud, scheduleItemEditsWaitingAtLastLoad,
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
  clearDeletedScheduleRowsHeld();
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
  it('two devices (Q32 case 1), Framing on its dates: H\'s 30% everywhere (open: the row does not keep G\'s 60%)', async () => {
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
    // With when he judged it, everywhere (A6 p24 L1: the floor is his latest entry, so a merge weighs it by its time).
    expect([cloudRow('MASTER G-1'), theRow(ipad), theRow(phone)].map(row => row!.managersPercentUnderFileJudgedAt)).toEqual(Array(3).fill(BEFORE_G));
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
  it('case 2: G at 60% on the phone, H at 30% on the offline iPad, both on Framing\'s dates: H\'s 30% after Full Sync (open)', async () => {
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
  it('the deletion heard before G\'s row (open): 30% everywhere', async () => {
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

describe('A7 p27 L2: a carry the queue-only upload refuses leaves no old copy for Sync Now to send', () => {
  const L = scheduleDoc('LOOKAHEAD L', '2026-09-16T09:00:00.000Z', 'lookahead');
  const lookaheadNote = (row: ScheduleItem | undefined) => (row?.lookaheadOverlay?.lookaheads || []).map(entry => entry.batchId);
  /** The iPad's carry waits on its queue, offline; the phone approves L stating `lPercent` on new dates and types a note. */
  async function carryThenLookahead(lPercent: string) {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad, false);
    setOnline(ipad, false);
    expect((await queueOf(ipad)).map(item => (item.payload as { carriedProgress?: boolean }).carriedProgress)).toEqual([true]);
    at(L.importedAt!);
    await approve(phone, L, [`Framing,Alpha,Lot,10/25/2026,11/04/2026,${lPercent}`], true);
    shareDocuments(phone);
    at('2026-09-16T09:30:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'Crew short Tuesday' });
    at('2026-09-16T10:00:00.000Z');
    setOnline(ipad, true);
    return { phone, ipad };
  }

  it.each([
    ['L states 60%: the carry is refused, and L\'s 60% stands', '60', 60],
    ['L states 10%: the carry lands (never below David\'s 30%)', '10', 30],
    ['L states no percent: the carry lands', '', 30],
  ] as const)('%s; L\'s dates, its note and the phone\'s note stay everywhere, as with Sync Now alone', async (_label, lPercent, percent) => {
    const { phone, ipad } = await carryThenLookahead(lPercent);
    await backgroundUpload(ipad); // the reconnect upload, or Retry Sync
    expect(await queueOf(ipad)).toEqual([]);
    await fullSync(ipad); // Sync Now
    await refresh(phone);
    await refresh(ipad);
    const expected = [['10/25/2026', '11/04/2026', percent, 'Crew short Tuesday', '']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
    expect(lookaheadNote(cloudRow('MASTER G-1'))).toEqual(['batch-LOOKAHEAD L']);
  });

  it('control: Sync Now with no queue-only upload first gives the same', async () => {
    const { phone, ipad } = await carryThenLookahead('60');
    await fullSync(ipad);
    await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual(Array(3).fill([['10/25/2026', '11/04/2026', 60, 'Crew short Tuesday', '']]));
  });

  it('pure: a copy holding a percent carried from its old row is weighed with that row; David\'s own percent on the row is weighed alone, as before', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    const imported = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [davids.id] } as ScheduleItem;
    const carried = { ...imported, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David' } as ScheduleItem;
    // The cloud's copy: lookahead L restated G's row at 60% on new dates, and the phone typed a note.
    const restated = {
      ...imported, startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60, status: 'In Progress', notes: 'Crew short Tuesday',
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'], updatedAt: '2026-09-16T09:30:00.000Z',
      lookaheadOverlay: { masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 0, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60 }] },
    } as ScheduleItem;
    expect(daveScheduleItemsNeedingCloudUpload({ local: [davids, carried], cloud: [davids, restated] })).toEqual([]);
    // His own 30% typed on G's row itself (judged later than any percent on F's row) still outranks a file's percent.
    const own = { ...carried, progressConfirmedAt: '2026-09-16T11:00:00.000Z', updatedAt: '2026-09-16T11:00:00.000Z' } as ScheduleItem;
    expect(daveScheduleItemsNeedingCloudUpload({ local: [davids, own], cloud: [davids, restated] }).map(row => [row.id, row.percentComplete]))
      .toEqual([[own.id, 30]]);
  });

  it('pure: weighed with every task, as the download weighs it: a newer percent on the old row goes to a row with a sibling too, and the upload sends what the download gave (seed 4235 of the A7 p27 comparisons; S4 item 2 a)', () => {
    // The iPad's 100% on F's row went to G's row with G's import; the phone's newer 80% on F's row; the phone's P row also answers to F's.
    const ipadOld = { ...rowsOf(F, [F_ROW])[0], percentComplete: 100, status: 'Complete', progressSource: 'project_manager', progressConfirmedAt: BEFORE_G, progressConfirmedBy: 'David', updatedAt: BEFORE_G } as ScheduleItem;
    const phoneOld = { ...ipadOld, percentComplete: 80, status: 'In Progress', progressConfirmedAt: AFTER_G, updatedAt: AFTER_G } as ScheduleItem;
    const gRowCopy = { ...rowsOf(G, [G_ROW()])[0], percentComplete: 100, status: 'Complete', progressSource: 'project_manager', progressConfirmedAt: BEFORE_G, progressConfirmedBy: 'David', revisedFromTaskIds: [ipadOld.id] } as ScheduleItem;
    const sibling = { ...rowsOf(H, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,'])[0], percentComplete: 80, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', revisedFromTaskIds: [ipadOld.id, 'MASTER P-1'] } as ScheduleItem;
    // The cloud's copy of G's row changed since (a note typed on the phone).
    const gCloud = { ...gRowCopy, notes: 'Crew short Tuesday', updatedAt: '2026-09-16T00:00:00.000Z' } as ScheduleItem;
    // Build 231, S4 item 2 (a). This pinned "two rows answer to F's: no carry", so G's row kept his OLDER 100% beside the
    // 80% he entered after it: the gap. What the seed was for still holds: the upload weighs as the download does. The
    // download now gives G's row his newer 80%, with the note typed on the phone, and the upload sends exactly that row.
    expect(recoverDAVEScheduleRecords({ local: [ipadOld, gRowCopy], cloud: [phoneOld, gCloud, sibling], allowCloudOnly: true }).map(row => [row.id, row.percentComplete]))
      .toEqual([[ipadOld.id, 80], [gRowCopy.id, 80], [sibling.id, 80]]);
    expect(daveScheduleItemsNeedingCloudUpload({ local: [ipadOld, gRowCopy], cloud: [phoneOld, gCloud, sibling] }).map(row => [row.id, row.percentComplete, row.notes]))
      .toEqual([[gRowCopy.id, 80, 'Crew short Tuesday']]);
  });

  it('pure: a percent of his given back on the device after the cloud\'s copy last changed is weighed alone, as before (sweep seeds 9093, 9036)', () => {
    // His 70% on F's row; lookahead L stated 80% on G's row (his 70% under it); a note on the phone; then deleting L on
    // this device gave his 70% back, stamped 1 ms after L's percent (his own time kept), after the cloud's copy last changed.
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: BEFORE_G, progressConfirmedBy: 'David', updatedAt: BEFORE_G } as ScheduleItem;
    const cloudG = { ...rowsOf(G, [G_ROW()])[0], percentComplete: 80, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-16T09:00:00.000Z', managersPercentUnderFile: 70, revisedFromTaskIds: [davids.id], notes: 'Crew short Tuesday', updatedAt: '2026-09-17T09:00:00.000Z' } as ScheduleItem;
    const givenBack = { ...cloudG, percentComplete: 70, progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-16T09:00:00.001Z', progressJudgment: { judgedAt: BEFORE_G, givenBackAt: '2026-09-16T09:00:00.001Z' }, managersPercentUnderFile: undefined, updatedAt: '2026-09-18T10:00:00.000Z' } as ScheduleItem;
    expect(daveScheduleItemsNeedingCloudUpload({ local: [davids, givenBack], cloud: [davids, cloudG] }).map(row => [row.id, row.percentComplete]))
      .toEqual([[givenBack.id, 70]]);
  });
});

/* Set Active, Make Current and the web's upload, as the app and the web run them (A5 pass 24). */
/** Phone Set Active (App.tsx activateReferenceDocument): the cloud's schedules, then the carried tasks saved and sent. */
async function setActive(device: Device, target: ReferenceDocument, when: string) {
  at(when);
  on(device);
  const before = device.documents;
  cloudDocuments = scheduleDocumentsAfterActivation(cloudDocuments.find(document => document.id === target.id)!, cloudDocuments, 'project', when);
  device.documents = reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({ local: before, cloud: cloudDocuments, deletedIds: [] }));
  const carried = scheduleProgressCarriedOnActivation({ items: device.ref.current, documentsBefore: before, documentsAfter: device.documents });
  if (carried.length > 0) {
    const byId = new Map(carried.map(item => [item.id, item]));
    setter(device)(device.ref.current.map(item => byId.get(item.id) || item));
    await Promise.all(carried.map(item => runScheduleItemCloudSync(item)));
  }
  await render(device);
}
/** A write the web makes straight to the cloud. */
function webWrite(item: ScheduleItem) {
  mockCloud.rows.set(item.id, mockCopy(item));
  mockCloud.writes.push(`web:${item.id}`);
  mockCloud.events.push({ id: item.id, row: mockCopy(item) });
}
/** The web's Make Current (desktop-auth-provider setCurrentSchedule): the carried tasks written. */
function webMakeCurrent(target: ReferenceDocument, when: string) {
  at(when);
  const shownBefore = webShown();
  const documentsBefore = cloudDocuments;
  cloudDocuments = scheduleDocumentsAfterActivation(cloudDocuments.find(document => document.id === target.id)!, cloudDocuments, 'project', when);
  scheduleProgressCarriedToShownTasks({ before: shownBefore, after: webShown(), documentsBefore, documentsAfter: cloudDocuments, now: when })
    .forEach(webWrite);
}
/** A schedule uploaded on the web (not current until made current). */
function webUpload(id: string, when: string, lines: string[]): ReferenceDocument {
  at(when);
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: `${id}.csv`, mimeType: 'text/csv', sizeBytes: 300, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: 'd'.repeat(64), now: when,
  } as never);
  const document = { ...(prepared.document as ReferenceDocument), id, importBatchId: `batch-${id}` } as ReferenceDocument;
  const rows = (prepared.scheduleItems as ScheduleItem[]).map((row, index) => ({ ...row, id: `${id}-${index + 1}`, importBatchId: document.importBatchId, sourceDocumentId: id }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown().map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) } as never, importedScheduleItems: rows });
  const plain = (item: ScheduleItem) => { const { cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
  plan.additions.forEach(item => webWrite(plain(item as ScheduleItem)));
  plan.revisions.forEach(revision => webWrite(plain(revision.item as ScheduleItem)));
  cloudDocuments = [...cloudDocuments, document];
  return document;
}
const percentsOf = (...devices: Device[]) => [webShown(), ...devices.map(deviceShown)].map(items => framingOf(items).map(item => item.percentComplete));

describe('A5 p24 L1: a master stating exactly David\'s percent has not taken it over', () => {
  const G1 = scheduleDoc('MASTER G', '2026-09-13T00:00:00.000Z');
  const H1 = scheduleDoc('MASTER H', '2026-09-14T00:00:00.000Z');
  const gRow = 'Framing,Alpha,Lot,10/20/2026,10/30/2026,30';
  const hRow = 'Framing,Alpha,Lot,10/22/2026,11/01/2026,20';

  it('one device: David\'s 30%, G moving Framing at 30%, H at 20%: his 30% stays (a file stating his percent changes nothing)', async () => {
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-12T17:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 30 });
    at(G1.importedAt!); await approve(phone, G1, [gRow, SURVEY]);
    at(H1.importedAt!); await approve(phone, H1, [hRow, SURVEY]);
    expect(onDevice(phone)[0][2]).toBe(30);
  });

  it('two devices (seed 478): David\'s 30% on the iPad; the offline phone approves G at 30%, then H at 20%: 30% everywhere', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at('2026-09-12T17:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 30 });
    at(G1.importedAt!); await approve(phone, G1, [gRow, SURVEY]);
    at(H1.importedAt!); await approve(phone, H1, [hRow, SURVEY]);
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await fullSync(phone); await fullSync(ipad); await fullSync(phone); await refresh(ipad);
    expect(percentsOf(ipad, phone)).toEqual([[30], [30], [30]]);
  });

  it('unchanged: G stating more than his percent took it over, and H\'s lower percent stands (A5 p23 L1, Q32 b)', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at('2026-09-12T17:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 30 });
    at(G1.importedAt!); await approve(phone, G1, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,31', SURVEY]);
    at(H1.importedAt!); await approve(phone, H1, [hRow, SURVEY]);
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await fullSync(phone); await fullSync(ipad); await fullSync(phone); await refresh(ipad);
    expect(percentsOf(ipad, phone)).toEqual([[20], [20], [20]]);
  });

  // Left open (L1 b, seed 1658): David's 70% on F's row on the web; the phone, not refreshed, approves G moving Framing at
  // 80% (above his: G took it over); the web makes F current again, which shows his 70%; the phone, still not refreshed,
  // approves H at 30% on G's row. One device pairs H with F's row and keeps 70%. The sync merge sees G's 80% stated after
  // his 70% on a row between and reads it as a take-over: the rows do not record that Make Current set G aside. Recording
  // it would mean re-confirming his 70% at the activation, which would outrank a newer percent he entered offline on that
  // row before it (the A5 pass 12 L class). A mark at the activation for a file's percent (L2, also left open, below)
  // would not apply here either: here the activation lets his own percent stand.
  it('L1 (b), open: Make Current F after G\'s take-over, then H at 30% on the phone: 70% everywhere', async () => {
    const G2 = scheduleDoc('MASTER G', '2026-09-13T00:00:00.000Z');
    const H2 = scheduleDoc('MASTER H', '2026-09-15T00:00:00.000Z');
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T21:00:00.000Z');
    webWrite({ ...cloudRow('MASTER F-1')!, percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-10T21:00:00.000Z', updatedAt: '2026-09-10T21:00:00.000Z' });
    at(G2.importedAt!); await approve(phone, G2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,80', SURVEY]); shareDocuments(phone);
    webMakeCurrent(F, '2026-09-14T09:00:00.000Z');
    at(H2.importedAt!); await approve(phone, H2, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,30', SURVEY]); shareDocuments(phone);
    at('2026-09-16T08:00:00.000Z');
    await fullSync(phone); await fullSync(ipad); await fullSync(phone); await refresh(ipad);
    expect(percentsOf(ipad, phone)).toEqual([[70], [70], [70]]);
  });
});

describe('A5 p24 L3: deleted rows lend David\'s percent by its time', () => {
  const davids = (row: ScheduleItem, percent: number, when: string) => ({ ...row, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: when, updatedAt: when }) as ScheduleItem;
  const P1 = scheduleDoc('MASTER P1', '2026-09-09T12:00:00.000Z');
  const P2 = scheduleDoc('MASTER P2', '2026-09-10T19:00:00.000Z');
  const P5 = scheduleDoc('MASTER P5', '2026-09-15T22:00:00.000Z');
  const old = davids(rowsOf(F, [F_ROW])[0], 10, '2026-09-12T10:00:00.000Z');
  const p2 = { ...davids(rowsOf(P2, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'])[0], 30, '2026-09-10T03:00:00.000Z'), revisedFromTaskIds: [old.id, 'MASTER P1-1'] } as ScheduleItem;
  const p5 = { ...p2, id: 'MASTER P5-1', importBatchId: P5.importBatchId, sourceDocumentId: P5.id, importedAt: P5.importedAt, startDate: '10/21/2026', finishDate: '10/31/2026', revisedFromTaskIds: [old.id, 'MASTER P1-1', p2.id] } as ScheduleItem;
  const newest = (rows: ScheduleItem[]) => rows.find(row => row.id === p5.id)!.percentComplete;

  it('(a) seed 8211: the iPad\'s newer 10% on F\'s row (deleted on the phone) passes P1\'s row, which it never had, as P2\'s row shows his older 30% from there', () => {
    expect(P1.importedAt! < p2.progressConfirmedAt!).toBe(true);
    expect(newest(recoverDAVEScheduleRecords({ local: [old], cloud: [p2, p5], deletedIds: [old.id, 'MASTER P1-1'], allowCloudOnly: true }))).toBe(10);
  });

  it('(a) unchanged: with no row it knows after the unknown one, an older percent of his does not pass it (A5 p23 M)', () => {
    const p5Alone = { ...p5, revisedFromTaskIds: [old.id, 'MASTER P1-1'] } as ScheduleItem;
    const fileRow = { ...p5Alone, percentComplete: 5, status: 'In Progress', progressSource: null, progressConfirmedBy: null, progressConfirmedAt: null } as ScheduleItem;
    expect(recoverDAVEScheduleRecords({ local: [old], cloud: [fileRow], deletedIds: [old.id, 'MASTER P1-1'], allowCloudOnly: true })
      .find(row => row.id === p5.id)!.percentComplete).toBe(5);
    // A row it knows after the unknown one that holds a file's percent says nothing of his there either.
    const p2File = { ...p2, percentComplete: 5, progressSource: null, progressConfirmedBy: null, progressConfirmedAt: null } as ScheduleItem;
    expect(recoverDAVEScheduleRecords({ local: [old], cloud: [p2File, { ...fileRow, revisedFromTaskIds: [old.id, 'MASTER P1-1', p2.id] } as ScheduleItem], deletedIds: [old.id, 'MASTER P1-1'], allowCloudOnly: true })
      .find(row => row.id === p5.id)!.percentComplete).toBe(5);
  });

  it('(b) seed 20876: a deleted row\'s older 90% does not pass a row between holding his newer 50% (answered by sibling rows, it carries nothing itself)', () => {
    const deletedOld = davids(rowsOf(F, [F_ROW])[0], 90, '2026-09-10T10:00:00.000Z');
    const between = { ...davids(rowsOf(P2, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'])[0], 50, '2026-09-12T10:00:00.000Z'), revisedFromTaskIds: [deletedOld.id] } as ScheduleItem;
    const sibling = { ...rowsOf(P1, ['Framing,Alpha,Lot,10/19/2026,10/29/2026,20'])[0], revisedFromTaskIds: [between.id] } as ScheduleItem;
    const last = { ...rowsOf(P5, ['Framing,Alpha,Lot,10/21/2026,10/31/2026,80'])[0], revisedFromTaskIds: [deletedOld.id, between.id] } as ScheduleItem;
    const merged = recoverDAVEScheduleRecords({ local: [deletedOld, between, sibling, last], cloud: [between, sibling, last], deletedIds: [deletedOld.id], allowCloudOnly: true });
    expect(merged.find(row => row.id === last.id)!.percentComplete).toBe(80);
    // Without the row between's newer word, the deleted row's 90% passes (A5 p23 M).
    const filed = { ...between, percentComplete: 0, status: 'Not Started', progressSource: null, progressConfirmedBy: null, progressConfirmedAt: null } as ScheduleItem;
    expect(recoverDAVEScheduleRecords({ local: [deletedOld, filed, sibling, last], cloud: [filed, sibling, last], deletedIds: [deletedOld.id], allowCloudOnly: true })
      .find(row => row.id === last.id)!.percentComplete).toBe(90);
  });
});

describe('Left open: Set Active and Make Current (A5 p24 L2, A5 recorded Low)', () => {
  // A5 p24 L2 (Low, older), left open: Set Active G lets G's 70% stand over David's 60% entered under F, but the sync
  // merge dates G's 70% by G's import, so after H's 40% the next refresh carries his 60% past G's row. Marking G's row at
  // the activation as approval marks a file's percent over his ("Schedule update", project_manager rank, his percent kept
  // under it) fixes this case, but the A5 p24 generator found the mark's manager rank making the marked copy outrank the
  // other device's later lookahead on that row in the sync merge, losing the lookahead's dates (its seeds 2203 and 3097).
  // A mark that only the carry reads needs a new task field. Built and measured, then left out (1 Oct).
  it('L2, open: phone G 70% (moved), Set Active F, David 60%, Set Active G (70%), H (moved) 40%: 40% after a refresh, on the iPad and the web', async () => {
    const G1 = scheduleDoc('MASTER G', '2026-09-08T09:00:00.000Z');
    const H1 = scheduleDoc('MASTER H', '2026-09-12T09:00:00.000Z');
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at(G1.importedAt!); await approve(phone, G1, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70', SURVEY]); shareDocuments(phone);
    await setActive(phone, F, '2026-09-08T12:00:00.000Z');
    at('2026-09-09T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 60 });
    await setActive(phone, G1, '2026-09-10T09:00:00.000Z');
    at(H1.importedAt!); await approve(phone, H1, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,40', SURVEY]); shareDocuments(phone);
    at('2026-09-13T09:00:00.000Z');
    await refresh(phone);
    await fullSync(ipad);
    expect(percentsOf(ipad, phone)).toEqual([[40], [40], [40]]);
  });

  // A5 recorded Low (older), left open: G uploaded on the web at 40%, David's 60% after it, H approved at 70%, then G
  // made current shows G's 40%: the activation weighs only the row it hides (H's), never F's row with his 60%. Weighing
  // the rows the task now shown answers to (with every task known passed by Set Active and by the web's Make Current)
  // fixes this case, but follows the two-device chain of earlier ids, which can differ from one device's: a master
  // approved on a device with a stale view answers to a row one device would not link, so the activation gave David's
  // percent where one device keeps the file's (the A5 p24 generator's seed 20077, and 1224 and 2070). Built and
  // measured, then left out (1 Oct).
  it('A5 recorded Low, open: phone Set Active back to G after H: his later 60% everywhere, as without H', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    const G1 = webUpload('WEB G', '2026-09-08T09:00:00.000Z', ['Framing,Alpha,Lot,10/22/2026,11/01/2026,40', SURVEY]);
    await refresh(phone);
    at('2026-09-09T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 60 });
    const H1 = scheduleDoc('MASTER H', '2026-09-10T09:00:00.000Z');
    at(H1.importedAt!); await approve(phone, H1, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,70', SURVEY]); shareDocuments(phone);
    await refresh(phone);
    await setActive(phone, G1, '2026-09-11T09:00:00.000Z');
    await refresh(phone); await fullSync(ipad);
    expect(percentsOf(ipad, phone)).toEqual([[60], [60], [60]]);
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

describe('A6 p24 L1: the lookahead floor is David\'s latest own entry', () => {
  const L1 = scheduleDoc('LOOKAHEAD L1', '2026-09-10T10:00:00.000Z', 'lookahead');
  const L2 = scheduleDoc('LOOKAHEAD L2', '2026-09-11T10:00:00.000Z', 'lookahead');
  const L3 = scheduleDoc('LOOKAHEAD L3', '2026-09-12T10:00:00.000Z', 'lookahead');
  const lookaheadRow = (start: string, finish: string, pct: string) => `Framing,Alpha,Lot,${start},${finish},${pct}`;
  const syncRound = async (phone: Device, ipad: Device) => {
    await backgroundUpload(phone); await backgroundUpload(ipad);
    await fullSync(ipad); await fullSync(phone); await fullSync(ipad);
    await refresh(phone); await refresh(ipad); await echoes(phone); await echoes(ipad);
  };
  const floorOf = (row: ScheduleItem | undefined) => [row?.managersPercentUnderFile ?? null, row?.managersPercentUnderFileJudgedAt ?? null];
  /** What Reports says moved on Framing's percent, from the report before. */
  function framingReport(device: Device, previous: DAVEReportSnapshot | null) {
    const now = new Date().toISOString();
    const view = deviceShown(device);
    const truth = buildDAVEProjectTruth({ projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: view, projectAreas: [], referenceDocuments: [], now });
    const fingerprint = buildDAVEReportSourceFingerprint([truth]);
    const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(previous, fingerprint), scheduleItems: view });
    const approved = reportSnapshotToSave(buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' }), previous);
    return { lines: briefing.recentChanges.map(change => change.summary).filter(line => /Framing moved/.test(line)), sent: approved ? markReportSnapshotDelivered(approved, now, device.name) : previous };
  }

  /**
   * David's 20%, then L1 at 70% (his 20% kept under it) on both devices. David then lowers Framing to 10% (`how`: on the
   * phone, or on the web); before the iPad hears of it, `approver` approves L2 at 40%. After a sync round, the phone
   * approves L3 stating `l3`.
   */
  async function lowered({ how = 'phone', approver = 'ipad', l3 }: { how?: 'phone' | 'web'; approver?: DeviceName; l3: string }) {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 20 });
    at(L1.importedAt!); await approve(phone, L1, [lookaheadRow('10/16/2026', '10/26/2026', '70')], true); shareDocuments(phone);
    at('2026-09-10T12:00:00.000Z'); await syncRound(phone, ipad);
    expect([theRow(phone), theRow(ipad)].map(row => [row.percentComplete, ...floorOf(row)])).toEqual(Array(2).fill([70, 20, '2026-09-10T09:00:00.000Z']));
    const reportBefore = framingReport(phone, null).sent;
    at('2026-09-11T09:00:00.000Z');
    if (how === 'phone') await edit(phone, theRow(phone).id, { percentComplete: 10 });
    else webWrite(webEdited(cloudRow(theRow(phone).id)!, { percentComplete: '10' }));
    at(L2.importedAt!);
    const device = approver === 'ipad' ? ipad : phone;
    if (approver === 'phone') await refresh(phone);
    await approve(device, L2, [lookaheadRow('10/17/2026', '10/27/2026', '40')], true); shareDocuments(device);
    at('2026-09-11T12:00:00.000Z'); await syncRound(phone, ipad);
    const reportL2 = framingReport(phone, reportBefore);
    at(L3.importedAt!); await approve(phone, L3, [lookaheadRow('10/18/2026', '10/28/2026', l3)], true); shareDocuments(phone);
    at('2026-09-12T12:00:00.000Z'); await syncRound(phone, ipad);
    return { phone, ipad, report: framingReport(phone, reportL2.sent).lines };
  }
  /** A web edit of Framing (the desktop's task editor), from the cloud's copy. */
  function webEdited(current: ScheduleItem, patch: Record<string, unknown>): ScheduleItem {
    const built = buildDAVEWebScheduleItem({
      id: current.id, now: new Date().toISOString(), actor: 'David', current: { ...current, cloudUpdatedAt: current.updatedAt ?? null } as never,
      draft: {
        projectId: MOCK_PROJECT_ID, itemType: 'Task', taskName: current.taskName, projectName: current.projectName, locationName: current.locationName || '',
        startDate: current.startDate, finishDate: current.finishDate, milestone: '', owner: current.owner || '', contractor: '', percentComplete: String(current.percentComplete),
        priority: 'Medium', status: current.status, notes: current.notes || '', nextAction: '', activityMessage: '', ...patch,
      } as never,
    }) as ScheduleItem & { cloudUpdatedAt?: unknown };
    const { cloudUpdatedAt: _cloud, ...plain } = built;
    return plain as ScheduleItem;
  }

  it('the finding: his 10% on the phone, L2 at 40% on the iPad before it heard of it, then L3 at 10%: 10% everywhere, and Reports says 40% to 10%', async () => {
    const { phone, ipad, report } = await lowered({ l3: '10' });
    expect(percentsOf(ipad, phone)).toEqual([[10], [10], [10]]);
    expect(report).toEqual(['Alpha: Framing moved from 40% to 10% complete.']);
  });

  it('after L2 every copy keeps his 10% under L2\'s 40%, as one device does, not the 20% he entered before it', async () => {
    const twoDevices = await lowered({ l3: '' });
    const oneDevice = await lowered({ approver: 'phone', l3: '' });
    for (const { phone, ipad } of [twoDevices, oneDevice]) {
      expect([cloudRow(theRow(phone).id), theRow(ipad), theRow(phone)].map(row => [row!.percentComplete, ...floorOf(row)]))
        .toEqual(Array(3).fill([40, 10, '2026-09-11T09:00:00.000Z']));
    }
  });

  it.each([['at', '10', 10], ['below', '5', 10], ['above', '25', 25]] as const)('L3 %s his new 10%% (%s%%): %s%% everywhere, on two devices as on one', async (_label, l3, expected) => {
    for (const approver of ['ipad', 'phone'] as const) {
      const { phone, ipad } = await lowered({ approver, l3 });
      expect(percentsOf(ipad, phone)).toEqual([[expected], [expected], [expected]]);
    }
  });

  it('unchanged: a web edit to 10% drops the floor from the cloud\'s copy, and the same sequence gives 10%', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 20 });
    at(L1.importedAt!); await approve(phone, L1, [lookaheadRow('10/16/2026', '10/26/2026', '70')], true); shareDocuments(phone);
    at('2026-09-10T12:00:00.000Z'); await syncRound(phone, ipad);
    at('2026-09-11T09:00:00.000Z');
    const edited = webEdited(cloudRow(theRow(phone).id)!, { percentComplete: '10' });
    expect([edited.percentComplete, 'managersPercentUnderFile' in edited, 'managersPercentUnderFileJudgedAt' in edited]).toEqual([10, false, false]);
    const noted = webEdited(cloudRow(theRow(phone).id)!, { notes: 'Crane Friday' });
    expect([noted.percentComplete, ...floorOf(noted)]).toEqual([70, 20, '2026-09-10T09:00:00.000Z']);
    const { phone: phone2, ipad: ipad2 } = await lowered({ how: 'web', l3: '5' });
    expect(percentsOf(ipad2, phone2)).toEqual([[10], [10], [10]]);
  });

  it('the floor stays while a file\'s percent is shown: L2 at 40% with no entry of his since, then L3 at 10%: his 20%', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 20 });
    at(L1.importedAt!); await approve(phone, L1, [lookaheadRow('10/16/2026', '10/26/2026', '70')], true); shareDocuments(phone);
    at('2026-09-10T12:00:00.000Z'); await syncRound(phone, ipad);
    at(L2.importedAt!); await approve(ipad, L2, [lookaheadRow('10/17/2026', '10/27/2026', '40')], true); shareDocuments(ipad);
    at('2026-09-11T12:00:00.000Z'); await syncRound(phone, ipad);
    expect([cloudRow(theRow(phone).id), theRow(ipad), theRow(phone)].map(row => [row!.percentComplete, ...floorOf(row)]))
      .toEqual(Array(3).fill([40, 20, '2026-09-10T09:00:00.000Z']));
    at(L3.importedAt!); await approve(phone, L3, [lookaheadRow('10/18/2026', '10/28/2026', '10')], true); shareDocuments(phone);
    at('2026-09-12T12:00:00.000Z'); await syncRound(phone, ipad);
    expect(percentsOf(ipad, phone)).toEqual([[20], [20], [20]]);
  });

  it('a master moving the task keeps his percent under its file\'s with when he judged it, row to row', async () => {
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: 20 });
    at(G.importedAt!); await approve(phone, G, [G_ROW('40'), SURVEY]); shareDocuments(phone);
    const his = [20, '2026-09-10T09:00:00.000Z'];
    expect([theRow(phone).id, theRow(phone).percentComplete, ...floorOf(theRow(phone))]).toEqual(['MASTER G-1', 40, ...his]);
    at(H.importedAt!); await approve(phone, H, ['Framing,Alpha,Lot,10/29/2026,11/08/2026,50', SURVEY]); shareDocuments(phone);
    expect([theRow(phone).id, theRow(phone).percentComplete, ...floorOf(theRow(phone))]).toEqual(['MASTER H-1', 50, ...his]);
  });

  it('pure merge: the floor is the later entry of his either copy knows; his own percent shown is its own floor', () => {
    const row = rowsOf(F, [F_ROW])[0];
    const file = { ...row, percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-11T10:00:00.000Z', managersPercentUnderFile: 20, managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z' } as ScheduleItem;
    const own = (pct: number, when: string) => ({ ...row, percentComplete: pct, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: when, managersPercentUnderFile: 20, managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z', updatedAt: when }) as ScheduleItem;
    const merged = (local: ScheduleItem, cloud: ScheduleItem) => recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true })[0];
    // His 10% entered after the 20% under the file's 40%: the floor, whichever copy is the device's.
    for (const [local, cloud] of [[file, own(10, '2026-09-11T09:00:00.000Z')], [own(10, '2026-09-11T09:00:00.000Z'), file]]) {
      expect([merged(local, cloud).percentComplete, ...floorOf(merged(local, cloud))]).toEqual([40, 10, '2026-09-11T09:00:00.000Z']);
    }
    // His 10% entered before the 20%: the 20% stays the floor.
    expect(floorOf(merged(file, own(10, '2026-09-09T09:00:00.000Z')))).toEqual([20, '2026-09-10T09:00:00.000Z']);
    // A later floor on the other copy's file percent wins too; an older one does not.
    const laterFloor = { ...file, percentComplete: 50, progressConfirmedAt: '2026-09-11T08:00:00.000Z', managersPercentUnderFile: 15, managersPercentUnderFileJudgedAt: '2026-09-10T20:00:00.000Z' } as ScheduleItem;
    expect(floorOf(merged(file, laterFloor))).toEqual([15, '2026-09-10T20:00:00.000Z']);
    expect(floorOf(merged({ ...file, managersPercentUnderFileJudgedAt: '2026-09-10T21:00:00.000Z' }, laterFloor))).toEqual([20, '2026-09-10T21:00:00.000Z']);
    // His own 10% shown wins the progress: the field is left as it was, and his 10% is the floor (it is never read under his own).
    const ownWins = merged(own(10, '2026-09-12T09:00:00.000Z'), file);
    expect([ownWins.percentComplete, ...floorOf(ownWins)]).toEqual([10, 20, '2026-09-10T09:00:00.000Z']);
    expect(scheduleManagersOwnPercent(ownWins)).toEqual({ percent: 10, judgedAt: '2026-09-12T09:00:00.000Z' });
    expect(scheduleManagersOwnPercent(file)).toEqual({ percent: 20, judgedAt: '2026-09-10T09:00:00.000Z' });
  });
});

describe('A5 p25 L1: a master that replaced David\'s percent keeps it from passing, after a later master restates that row', () => {
  const I = scheduleDoc('MASTER I', '2026-09-28T12:00:00.000Z');
  const G_ROW_AT = (pct: string) => `Framing,Alpha,Lot,10/22/2026,11/01/2026,${pct}`;
  /** One device: David's 30% under F; G moves Framing at 40%; H lists it on G's dates at `hPercent`; I moves it at 10%. */
  async function restated(hPercent: string) {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: 30 });
    const his = [30, '2026-09-10T09:00:00.000Z'];
    at(G.importedAt!); await approve(phone, G, [G_ROW_AT('40'), SURVEY]); shareDocuments(phone);
    expect([theRow(phone).id, theRow(phone).percentComplete, theRow(phone).managersPercentUnderFile, theRow(phone).managersPercentUnderFileJudgedAt]).toEqual(['MASTER G-1', 40, ...his]);
    at(H.importedAt!); await approve(phone, H, [G_ROW_AT(hPercent), SURVEY]); shareDocuments(phone);
    at(I.importedAt!); await approve(phone, I, ['Framing,Alpha,Lot,10/29/2026,11/08/2026,10', SURVEY]); shareDocuments(phone);
    // I's new row keeps his 30% under its 10%, with when he judged it.
    expect([theRow(phone).id, theRow(phone).percentComplete, theRow(phone).managersPercentUnderFile, theRow(phone).managersPercentUnderFileJudgedAt]).toEqual(['MASTER I-1', 10, ...his]);
    return { phone, ipad };
  }

  it.each([['his percent exactly (the finding)', '30'], ['below his percent', '25'], ['control: above his percent', '35']] as const)('H %s: 10%% after approval, a refresh, a restart and Full Sync, on the phone, the web and the iPad', async (_label, hPercent) => {
    const { phone, ipad } = await restated(hPercent);
    const seen = [theRow(phone).percentComplete];
    at('2026-09-28T13:00:00.000Z');
    await refresh(phone); seen.push(theRow(phone).percentComplete);
    await startup(phone); seen.push(theRow(phone).percentComplete);
    await fullSync(phone); await fullSync(ipad); await refresh(ipad);
    expect([seen, percentsOf(ipad, phone)]).toEqual([[10, 10, 10], [[10], [10], [10]]]);
  });

  it('pure merge: his percent kept under a file\'s on a row between or the newest stops it from passing; an older floor, or one saved without its time, does not', () => {
    const davids = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T09:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-10T09:00:00.000Z' } as ScheduleItem;
    const fileRow = (id: string, from: ScheduleItem, pct: number, floor?: { percent: number; judgedAt?: string }) => ({
      ...rowsOf(G, [G_ROW()])[0], id, percentComplete: pct, status: 'In Progress', revisedFromTaskIds: [...(from.revisedFromTaskIds || []), from.id],
      ...(floor ? { managersPercentUnderFile: floor.percent, ...(floor.judgedAt ? { managersPercentUnderFileJudgedAt: floor.judgedAt } : {}) } : {}),
    }) as ScheduleItem;
    const carriedTo = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: rows, cloud: [], allowCloudOnly: true }).find(item => item.id === rows[rows.length - 1].id)!.percentComplete;
    const his = { percent: 30, judgedAt: davids.progressConfirmedAt! };
    const between = fileRow('MASTER G-1', davids, 30, his);
    // Between, or on the newest row alone: his 30% was replaced by a file's there.
    expect(carriedTo([davids, between, fileRow('MASTER I-1', between, 10, his)])).toBe(10);
    expect(carriedTo([davids, between, fileRow('MASTER I-1', between, 10)])).toBe(10);
    expect(carriedTo([davids, fileRow('MASTER G-1', davids, 10, his)])).toBe(10);
    // A later entry of his kept under a file's stops an older one too.
    expect(carriedTo([davids, fileRow('MASTER G-1', davids, 10, { percent: 20, judgedAt: '2026-09-11T09:00:00.000Z' })])).toBe(10);
    // An older entry of his under the file's (judged before this one), or a floor saved without its time: carried, as before.
    expect(carriedTo([davids, fileRow('MASTER G-1', davids, 10, { percent: 30, judgedAt: '2026-09-09T09:00:00.000Z' })])).toBe(30);
    expect(carriedTo([davids, fileRow('MASTER G-1', davids, 10, { percent: 30 })])).toBe(30);
  });
});

describe('A7 p28 L: a carry from a row deleted over realtime, refused later, leaves no old copy for Sync Now to send', () => {
  const L = scheduleDoc('LOOKAHEAD L', '2026-09-16T09:00:00.000Z', 'lookahead');
  const MARK = { taskId: 'MASTER F-1', judgedAt: AFTER_G };
  /**
   * The phone, offline, approves G and deletes F with its items; the online iPad's 30% on F's row goes up. The phone
   * syncs; the iPad hears G's row, then F's deletion over realtime, and carries the 30% to G's row (queued). Then the
   * iPad loses signal; the phone approves lookahead L stating `lPercent` on new dates and types a note; the iPad is back.
   */
  async function heardThenLookahead(lPercent: string) {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!); await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z'); await deleteWithItems(phone, F);
    at(AFTER_G); await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    await backgroundUpload(phone);
    await echoes(ipad);
    await fullSync(phone);
    expect(await tombstoneEchoes(ipad)).toBe(1);
    expect([theRow(ipad).percentComplete, theRow(ipad).progressCarriedFrom]).toEqual([30, MARK]);
    expect((await queueOf(ipad)).map(item => (item.payload as { carriedProgress?: boolean }).carriedProgress)).toEqual([true]);
    setOnline(ipad, false);
    at(L.importedAt!); await approve(phone, L, [`Framing,Alpha,Lot,10/25/2026,11/04/2026,${lPercent}`], true); shareDocuments(phone);
    at('2026-09-16T09:30:00.000Z'); await edit(phone, 'MASTER G-1', { notes: 'Phone note' });
    at('2026-09-16T10:00:00.000Z'); setOnline(ipad, true);
    return { phone, ipad };
  }

  it.each([
    ['reconnect upload, then Sync Now (the finding)', 'reconnect', '60', 60],
    ['Sync Now twice (the finding)', 'twice', '60', 60],
    ['reconnect upload, then Sync Now: L states 10%, never below David\'s 30%', 'reconnect', '10', 30],
    ['Sync Now twice: L states 10%', 'twice', '10', 30],
    ['reconnect upload, then Sync Now: L states no percent, and the carry lands', 'reconnect', '', 30],
  ] as const)('%s: L\'s dates, the percent and the phone\'s note stay everywhere', async (_label, mode, lPercent, percent) => {
    const { phone, ipad } = await heardThenLookahead(lPercent);
    if (mode === 'reconnect') {
      await backgroundUpload(ipad); // the reconnect upload, or Retry Sync
      expect(await queueOf(ipad)).toEqual([]);
      // A carry that still stands lands with its mark; a refused one leaves the cloud's copy unmarked.
      expect(cloudRow('MASTER G-1')!.progressCarriedFrom ?? null).toEqual(percent === 30 ? MARK : null);
    } else {
      await fullSync(ipad, false); // Sync Now, its upload pass not yet requested again
    }
    await fullSync(ipad); // Sync Now
    await refresh(phone); await refresh(ipad);
    const expected = [['10/25/2026', '11/04/2026', percent, 'Phone note', '']];
    expect([onWeb(), onDevice(ipad), onDevice(phone)]).toEqual([expected, expected, expected]);
    // Another round writes nothing.
    const writes = framingWritesOf(phone, ipad);
    at('2026-09-17T08:00:00.000Z');
    await fullSync(ipad); await fullSync(phone); await refresh(ipad); await refresh(phone);
    expect(framingWritesOf(phone, ipad)).toBe(writes);
  });

  it('unchanged: online, the carry goes up at once with its mark, and every place shows 30%', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!); await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z'); await deleteWithItems(phone, F);
    at(AFTER_G); await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    await backgroundUpload(phone); await echoes(ipad); await fullSync(phone);
    await tombstoneEchoes(ipad);
    // While the carry waits on the queue, a refresh keeps 30% (no flicker to the cloud's 0%).
    await refresh(ipad, false);
    expect(onDevice(ipad)[0][2]).toBe(30);
    await backgroundUpload(ipad);
    await refresh(phone);
    expect([cloudRow('MASTER G-1')!.progressCarriedFrom, theRow(phone).progressCarriedFrom]).toEqual([MARK, MARK]);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([30, 30, 30]);
    // David's own 45% on G's row is his word there: the mark no longer counts.
    at('2026-09-16T08:00:00.000Z');
    await edit(phone, 'MASTER G-1', { percentComplete: 45 });
    await fullSync(ipad); await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => place[0][2])).toEqual([45, 45, 45]);
  });

  it('pure: a copy holding the percent its mark names, from a row the sync knows as deleted, is weighed as carried; otherwise as before', () => {
    const imported = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: ['MASTER F-1'] } as ScheduleItem;
    const carried = { ...imported, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', progressCarriedFrom: MARK, updatedAt: '2026-09-14T14:00:00.001Z' } as ScheduleItem;
    // The cloud's copy: lookahead L restated G's row at 60% on new dates, and the phone typed a note.
    const restated = {
      ...imported, startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60, status: 'In Progress', notes: 'Phone note',
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'], updatedAt: '2026-09-16T09:30:00.000Z',
      lookaheadOverlay: { masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 0, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60 }] },
    } as ScheduleItem;
    expect(daveScheduleItemsNeedingCloudUpload({ local: [carried], cloud: [restated], deletedIds: ['MASTER F-1'] })).toEqual([]);
    expect(recoverDAVEScheduleRecords({ local: [carried], cloud: [restated], deletedIds: ['MASTER F-1'], allowCloudOnly: true })[0]).toEqual(restated);
    // Not known as deleted (a single row weighed alone), a percent of his entered on G's row since, or a mark naming another
    // row: his percent outranks the cloud's copy whole, as before.
    const asBefore = (local: ScheduleItem, deletedIds: string[]) => daveScheduleItemsNeedingCloudUpload({ local: [local], cloud: [restated], deletedIds }).map(row => [row.percentComplete, row.startDate]);
    expect(asBefore(carried, [])).toEqual([[30, '10/22/2026']]);
    const ownSince = { ...carried, progressConfirmedAt: '2026-09-16T11:00:00.000Z', updatedAt: '2026-09-16T11:00:00.000Z' } as ScheduleItem;
    expect(asBefore(ownSince, ['MASTER F-1'])).toEqual([[30, '10/22/2026']]);
    expect(recoverDAVEScheduleRecords({ local: [ownSince], cloud: [restated], deletedIds: ['MASTER F-1'], allowCloudOnly: true }).map(row => [row.percentComplete, row.startDate])).toEqual([[30, '10/22/2026']]);
    expect(asBefore({ ...carried, progressCarriedFrom: { taskId: 'MASTER E-1', judgedAt: AFTER_G } } as ScheduleItem, ['MASTER F-1', 'MASTER E-1'])).toEqual([[30, '10/22/2026']]);
    // The cloud's copy unchanged but for the note: the carried 30% still stands, with the cloud's note and the mark.
    const noted = { ...imported, notes: 'Phone note', updatedAt: '2026-09-16T09:30:00.000Z' } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [carried], cloud: [noted], deletedIds: ['MASTER F-1'], allowCloudOnly: true });
    expect([merged.percentComplete, merged.notes, merged.progressCarriedFrom]).toEqual([30, 'Phone note', MARK]);
    // His 30% judged before G's import (entered offline under F): a lookahead stating 10% on G's row stops the carry (G's
    // file spoke after it), and its percent is floored at his 30% (owner answer Q22), as the carry from his row floors it.
    const before = { ...carried, progressConfirmedAt: BEFORE_G, progressCarriedFrom: { taskId: 'MASTER F-1', judgedAt: BEFORE_G } } as ScheduleItem;
    const lowered = { ...restated, percentComplete: 10, lookaheadOverlay: { ...restated.lookaheadOverlay!, lookaheads: [{ ...restated.lookaheadOverlay!.lookaheads[0], percentComplete: 10 }] } } as ScheduleItem;
    const [floored] = recoverDAVEScheduleRecords({ local: [before], cloud: [lowered], deletedIds: ['MASTER F-1'], allowCloudOnly: true });
    expect([floored.percentComplete, floored.startDate, floored.notes, floored.managersPercentUnderFile]).toEqual([30, '10/25/2026', 'Phone note', 30]);
  });

  it('pure: a cloud copy that kept the carried percent under a file\'s since (a newer master replaced it there) keeps the file\'s', () => {
    const imported = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: ['MASTER F-1'] } as ScheduleItem;
    const carried = { ...imported, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', progressCarriedFrom: MARK, updatedAt: '2026-09-14T14:00:00.001Z' } as ScheduleItem;
    const replaced = { ...imported, percentComplete: 10, status: 'In Progress', managersPercentUnderFile: 30, managersPercentUnderFileJudgedAt: AFTER_G, notes: 'Phone note', updatedAt: '2026-09-16T09:30:00.000Z' } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [carried], cloud: [replaced], deletedIds: ['MASTER F-1'], allowCloudOnly: true });
    expect(merged).toEqual(replaced);
  });

  it('pure: the mark goes with the percent in a merge, not with the copy that leads the task', () => {
    const imported = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: ['MASTER F-1'] } as ScheduleItem;
    const carried = { ...imported, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', progressCarriedFrom: MARK, updatedAt: '2026-09-14T14:00:00.001Z' } as ScheduleItem;
    // The other copy: an older percent of his (13 Sep) and a newer note, so it leads the task while the carried 30% is newer.
    const older = { ...imported, percentComplete: 20, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-13T09:00:00.000Z', progressConfirmedBy: 'David', notes: 'Phone note', updatedAt: '2026-09-16T09:30:00.000Z' } as ScheduleItem;
    for (const [local, cloud] of [[carried, older], [older, carried]]) {
      const [merged] = recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true });
      expect([merged.percentComplete, merged.notes, merged.progressCarriedFrom]).toEqual([30, 'Phone note', MARK]);
    }
    // The other way round: the older copy's progress wins (a newer percent of his there), and no mark comes with it.
    const newer = { ...older, percentComplete: 45, progressConfirmedAt: '2026-09-16T09:30:00.000Z' } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [carried], cloud: [newer], allowCloudOnly: true });
    expect([merged.percentComplete, merged.progressCarriedFrom ?? null]).toEqual([45, null]);
  });
});

describe('A7 p29 L1: a percent given back while its upload waits is David\'s word, not a carry, in the refresh and the startup load', () => {
  const L = scheduleDoc('LOOKAHEAD L', '2026-09-16T09:00:00.000Z', 'lookahead');
  const GIVEN = [['10/22/2026', '11/01/2026', 30, '', '']];
  const NOTED = [['10/22/2026', '11/01/2026', 30, 'Phone note', '']];

  /** A7 p28's flow with the carry landing: G's row holds David's 30% carried from F's row (marked); F deleted on both devices. */
  async function carriedAndLanded() {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!); await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z'); await deleteWithItems(phone, F);
    at(AFTER_G); await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    await backgroundUpload(phone); await echoes(ipad); await fullSync(phone);
    await tombstoneEchoes(ipad); await backgroundUpload(ipad); await echoes(phone);
    expect([cloudRow('MASTER G-1')!.progressCarriedFrom, theRow(phone).progressCarriedFrom]).toEqual([
      { taskId: 'MASTER F-1', judgedAt: AFTER_G }, { taskId: 'MASTER F-1', judgedAt: AFTER_G },
    ]);
    return { phone, ipad };
  }

  /**
   * Lookahead L states 60% on Framing (above his 30%); the phone, offline, deletes L with its items, which gives back his
   * 30% (queued whole); back online, the routine refresh or the startup cloud load runs before that upload.
   */
  async function giveBackThenLoad(phone: Device, ipad: Device, mode: 'refresh' | 'startup') {
    at(L.importedAt!); await approve(phone, L, ['Framing,Alpha,Lot,10/25/2026,11/04/2026,60'], true);
    shareDocuments(phone); await echoes(ipad);
    setOnline(phone, false);
    at('2026-09-16T10:00:00.000Z'); await deleteWithItems(phone, L);
    const given = onDevice(phone);
    expect((await queueOf(phone)).map(item => (item.payload as { changedFields?: unknown }).changedFields ?? 'whole')).toEqual(['whole']);
    at('2026-09-16T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    if (mode === 'refresh') await refresh(phone, false); else await startup(phone, false);
    return { given, during: onDevice(phone) };
  }
  /** Then the background upload and a sync round on both devices. */
  async function settle(phone: Device, ipad: Device) {
    await backgroundUpload(phone);
    await echoes(phone); await echoes(ipad); await refresh(phone); await refresh(ipad); await fullSync(phone); await fullSync(ipad);
    return [onWeb(), onDevice(ipad), onDevice(phone)];
  }

  it.each(['refresh', 'startup'] as const)('(the finding) F deleted, %s first: the phone shows 30%%, not the deleted lookahead\'s 60%%', async (mode) => {
    const { phone, ipad } = await carriedAndLanded();
    const { given, during } = await giveBackThenLoad(phone, ipad, mode);
    expect([given, during]).toEqual([GIVEN, GIVEN]);
    expect(await settle(phone, ipad)).toEqual([GIVEN, GIVEN, GIVEN]);
  });

  it.each(['refresh', 'startup'] as const)('(the finding) F deleted, %s first, then a note on Framing before the upload: 30%% and the note everywhere', async (mode) => {
    const { phone, ipad } = await carriedAndLanded();
    await giveBackThenLoad(phone, ipad, mode);
    at('2026-09-16T12:05:00.000Z'); await edit(phone, 'MASTER G-1', { notes: 'Phone note' });
    expect(await settle(phone, ipad)).toEqual([NOTED, NOTED, NOTED]);
  });

  it.each(['refresh', 'startup'] as const)('(the finding) F deleted, %s first, then Sync Now before the upload: 30%% everywhere', async (mode) => {
    const { phone, ipad } = await carriedAndLanded();
    await giveBackThenLoad(phone, ipad, mode);
    await fullSync(phone, false); // Sync Now, its upload pass not yet requested again
    expect(await settle(phone, ipad)).toEqual([GIVEN, GIVEN, GIVEN]);
  });

  it.each(['refresh', 'startup'] as const)('(older, 30170fc) F\'s row kept, %s first, then a note: 30%% and the note everywhere', async (mode) => {
    const { phone, ipad } = await offlineThirty();
    await fullSync(ipad);
    await echoes(phone); await refresh(phone);
    const { during } = await giveBackThenLoad(phone, ipad, mode);
    at('2026-09-16T12:05:00.000Z'); await edit(phone, 'MASTER G-1', { notes: 'Phone note' });
    expect([during, await settle(phone, ipad)]).toEqual([GIVEN, [NOTED, NOTED, NOTED]]);
    // Another round writes nothing.
    const writes = framingWritesOf(phone, ipad);
    at('2026-09-17T08:00:00.000Z');
    await fullSync(ipad); await fullSync(phone); await refresh(ipad); await refresh(phone);
    expect(framingWritesOf(phone, ipad)).toBe(writes);
  });

  it('pure: a copy changed here after the cloud\'s is weighed alone; the same copy no newer than the cloud\'s is still weighed as carried', () => {
    const MARK = { taskId: 'MASTER F-1', judgedAt: AFTER_G };
    const imported = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: ['MASTER F-1'] } as ScheduleItem;
    const earlier = { ...rowsOf(F, [F_ROW])[0], percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: AFTER_G, progressConfirmedBy: 'David', updatedAt: AFTER_G } as ScheduleItem;
    // The cloud's copy: L restated G's row at 60% on new dates, his 30% noted under it.
    const restated = {
      ...imported, startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60, status: 'In Progress',
      progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-16T09:00:00.000Z',
      managersPercentUnderFile: 30, managersPercentUnderFileJudgedAt: AFTER_G, progressCarriedFrom: MARK,
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'], updatedAt: '2026-09-16T09:00:00.000Z',
      lookaheadOverlay: { masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 30, masterStatus: 'In Progress', masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: AFTER_G, masterFilePercentComplete: null, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60 }] },
    } as ScheduleItem;
    // The phone's copy after deleting L: his 30% given back with when he judged it, the mark still on the row.
    const givenBack = {
      ...imported, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
      progressConfirmedAt: '2026-09-16T09:00:00.001Z', progressJudgment: { judgedAt: AFTER_G, givenBackAt: '2026-09-16T09:00:00.001Z' },
      managersPercentUnderFile: 30, managersPercentUnderFileJudgedAt: AFTER_G, progressCarriedFrom: MARK,
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'], updatedAt: '2026-09-16T10:00:00.000Z',
    } as ScheduleItem;
    const merged = (local: ScheduleItem[], deletedIds: string[]) => recoverDAVEScheduleRecords({ local, cloud: [restated], deletedIds, allowCloudOnly: true })
      .filter(row => row.id === 'MASTER G-1').map(row => [row.percentComplete, row.startDate]);
    // F's row deleted (the mark), and F's row kept: 30% on G's dates, as one device shows after deleting L.
    expect(merged([givenBack], ['MASTER F-1'])).toEqual([[30, '10/22/2026']]);
    expect(merged([earlier, givenBack], [])).toEqual([[30, '10/22/2026']]);
    // Sync Now's upload check sends it, as before.
    expect(daveScheduleItemsNeedingCloudUpload({ local: [givenBack], cloud: [restated], deletedIds: ['MASTER F-1'] }).map(row => row.percentComplete)).toEqual([30]);
    // The same copy stamped no later than the cloud's (a carried copy keeps the row's own stamp): weighed as carried, as
    // before, so the cloud's newer lookahead stands (A7 pass 28 L, A7 pass 26 M-1).
    const notNewer = { ...givenBack, updatedAt: restated.updatedAt } as ScheduleItem;
    expect(merged([notNewer], ['MASTER F-1'])).toEqual([[60, '10/25/2026']]);
    expect(merged([earlier, notNewer], [])).toEqual([[60, '10/25/2026']]);
  });
});

describe('A5 p26 L1: after a Talk Undo, the percent it undid is not David\'s latest entry', () => {
  const FRAMING = (pct: number | '' = '') => `Framing,Alpha,Lot,10/15/2026,10/25/2026,${pct}`;
  const G_AT = scheduleDoc('MASTER G', '2026-09-14T12:00:00.000Z');
  const L = scheduleDoc('LOOKAHEAD L', '2026-09-21T12:00:00.000Z', 'lookahead');
  const percentEverywhere = (phone: Device, ipad: Device) => [theRow(phone)?.percentComplete, theRow(ipad)?.percentComplete, framingOf(webShown())[0]?.percentComplete];

  /**
   * On the phone Talk sets `percent` on Framing; the iPad hears it (`hears`: realtime, or its Sync Now), then sleeps or
   * loses signal, and David taps Undo a few minutes later (as the app applies it, giving back who stated the progress).
   */
  async function talkThenUndo(phone: Device, ipad: Device, percent: number, hears: 'realtime' | 'Sync Now') {
    at('2026-09-16T10:00:00.000Z');
    const target = theRow(phone);
    const previous = scheduleProgressUndoPoint(target);
    await edit(phone, target.id, { percentComplete: percent });
    const written = scheduleProgressUndoPoint(phone.ref.current.find(item => item.id === target.id)!);
    await backgroundUpload(phone);
    if (hears === 'realtime') await echoes(ipad); else await fullSync(ipad);
    expect(theRow(ipad).percentComplete).toBe(percent);
    setOnline(ipad, false);
    at('2026-09-16T10:04:00.000Z');
    const undo = scheduleTalkUndo(phone.ref.current, { id: target.id, taskName: 'Framing' }, previous, written, new Date().toISOString(), deviceShown(phone));
    if (!undo.ok) throw new Error(undo.message);
    await edit(phone, undo.taskId, undo.edit, true);
    await backgroundUpload(phone);
  }
  /** The iPad wakes and its app starts again: the saved list read back, then the startup cloud load. */
  async function coldLaunch(ipad: Device) {
    at('2026-09-19T08:00:00.000Z');
    setOnline(ipad, true);
    heard.set('ipad', mockCloud.events.length); // realtime missed the Undo
    ipad.state = JSON.parse(JSON.stringify(ipad.state)); ipad.ref.current = ipad.state; ipad.effectsSeen = null;
    await startup(ipad);
  }
  /** David's percent, then master G stating `gPercent` above it on Framing's dates (his percent kept under G's). */
  async function underG(own: number, gPercent: number) {
    const { phone, ipad } = await startBoth(F, [FRAMING(), SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: own });
    await backgroundUpload(phone); await echoes(ipad);
    at(G_AT.importedAt!); await approve(phone, G_AT, [FRAMING(gPercent), SURVEY]); shareDocuments(phone);
    await backgroundUpload(phone); await echoes(ipad); await fullSync(ipad);
    expect([theRow(ipad).percentComplete, theRow(ipad).managersPercentUnderFile]).toEqual([gPercent, own]);
    return { phone, ipad };
  }
  async function lookaheadThenRound(phone: Device, ipad: Device, by: Device, percent: number) {
    at(L.importedAt!); await approve(by, L, [`Framing,Alpha,Lot,10/16/2026,10/26/2026,${percent}`], true); shareDocuments(by);
    await backgroundUpload(by);
    await fullSync(ipad); await fullSync(phone); await refresh(ipad); await refresh(phone);
    return percentEverywhere(phone, ipad);
  }

  it.each([
    ['the iPad', 'realtime', 'ipad'],
    ['the phone, after the iPad\'s Sync Now', 'realtime', 'phone'],
    ['the iPad, which heard Talk on its Sync Now', 'Sync Now', 'ipad'],
  ] as const)('(the finding) his 40%% under G\'s 60%%, Talk 50%%, Undo: after the iPad\'s cold launch a lookahead at 45%% on %s shows 45%% everywhere', async (_label, hears, where) => {
    const { phone, ipad } = await underG(40, 60);
    await talkThenUndo(phone, ipad, 50, hears);
    expect([theRow(phone).percentComplete, theRow(phone).managersPercentUnderFile]).toEqual([60, 40]);
    await coldLaunch(ipad);
    // The iPad keeps his 40% under G's 60%, not Talk's undone 50%, and sends nothing over it.
    expect([theRow(ipad).percentComplete, theRow(ipad).managersPercentUnderFile]).toEqual([60, 40]);
    if (where === 'phone') { await fullSync(ipad); await fullSync(phone); }
    expect(await lookaheadThenRound(phone, ipad, where === 'ipad' ? ipad : phone, 45)).toEqual([45, 45, 45]);
  });

  it('(lowering) his 10% under G\'s 60%, Talk 0%, Undo: a lookahead at 5% shows his 10% (owner answer Q22), not 5%', async () => {
    const { phone, ipad } = await underG(10, 60);
    await talkThenUndo(phone, ipad, 0, 'realtime');
    await coldLaunch(ipad);
    expect(await lookaheadThenRound(phone, ipad, ipad, 5)).toEqual([10, 10, 10]);
  });

  it('(Undo back to his own percent, then a master raises it) his 40%, Talk 50%, Undo, master H at 60%: a lookahead at 45% shows 45%', async () => {
    const { phone, ipad } = await startBoth(F, [FRAMING(), SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: 40 });
    await backgroundUpload(phone); await echoes(ipad);
    await talkThenUndo(phone, ipad, 50, 'realtime');
    expect(theRow(phone).percentComplete).toBe(40);
    const H18 = scheduleDoc('MASTER H', '2026-09-18T12:00:00.000Z');
    at(H18.importedAt!); await approve(phone, H18, [FRAMING(60), SURVEY]); shareDocuments(phone); await backgroundUpload(phone);
    // His 40% is kept under H's 60%, and the task still notes Talk's 50% as taken back.
    expect([theRow(phone).managersPercentUnderFile, theRow(phone).progressUndone]).toEqual([40, { percentComplete: 50, confirmedAt: '2026-09-16T10:00:00.000Z' }]);
    await coldLaunch(ipad); await fullSync(ipad);
    expect(await lookaheadThenRound(phone, ipad, ipad, 45)).toEqual([45, 45, 45]);
  });

  it('(the mirror) the iPad, still holding Talk\'s 50%, approves master H raising Framing to 60%: a lookahead at 45% shows 45%', async () => {
    const { phone, ipad } = await startBoth(F, [FRAMING(), SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: 40 });
    await backgroundUpload(phone); await echoes(ipad);
    await talkThenUndo(phone, ipad, 50, 'realtime');
    // The iPad, which never heard the Undo, approves H over its 50%, kept under H's 60% from Talk's time.
    const H18 = scheduleDoc('MASTER H', '2026-09-18T12:00:00.000Z');
    at(H18.importedAt!); await approve(ipad, H18, [FRAMING(60), SURVEY]);
    expect([theRow(ipad).percentComplete, theRow(ipad).managersPercentUnderFile]).toEqual([60, 50]);
    at('2026-09-19T08:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    await backgroundUpload(ipad); await fullSync(ipad); await fullSync(phone); await refresh(ipad);
    // The phone's 40%, given back by the Undo after Talk's 50%, is his latest entry: kept under H's 60%.
    expect([theRow(phone).managersPercentUnderFile, theRow(ipad).managersPercentUnderFile, cloudRow(theRow(phone).id)!.managersPercentUnderFile]).toEqual([40, 40, 40]);
    expect(await lookaheadThenRound(phone, ipad, phone, 45)).toEqual([45, 45, 45]);
  });

  it('(take-over, 82b9842) the iPad, still holding Talk\'s 20%, approves a master moving Framing at 30%: his 40% everywhere', async () => {
    const { phone, ipad } = await startBoth(F, [FRAMING(), SURVEY]);
    at('2026-09-10T09:00:00.000Z'); await edit(phone, theRow(phone).id, { percentComplete: 40 });
    await backgroundUpload(phone); await echoes(ipad);
    await talkThenUndo(phone, ipad, 20, 'Sync Now');
    expect(theRow(phone).percentComplete).toBe(40);
    // The iPad, which never heard the Undo, approves master M moving Framing at 30% over its 20%.
    const M = scheduleDoc('MASTER M', '2026-09-18T00:00:00.000Z');
    at(M.importedAt!); await approve(ipad, M, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,30', SURVEY]);
    expect([theRow(ipad).percentComplete, theRow(ipad).managersPercentUnderFile]).toEqual([30, 20]);
    at('2026-09-18T04:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    await backgroundUpload(ipad); await fullSync(ipad); await fullSync(phone); await fullSync(ipad); await refresh(phone); await refresh(ipad);
    // One device: his 40% (given back by the Undo, after Talk's 20%) is not lowered by M's 30%.
    expect(percentEverywhere(phone, ipad)).toEqual([40, 40, 40]);
  });

  it('pure: the Undo notes the entry it took back; that entry, or a floor made from it, is not his word; every other entry is weighed as before', () => {
    const base = { ...rowsOf(G_AT, [FRAMING(60)])[0], status: 'In Progress' } as ScheduleItem;
    const TALK = '2026-09-16T10:00:00.000Z';
    const UNDONE = { percentComplete: 50, confirmedAt: TALK };
    // G's 60% over his 40% (judged 10 Sep); Talk wrote 50% at 10:00; Undo at 10:04.
    const restated = { ...base, percentComplete: 60, progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: G_AT.importedAt, managersPercentUnderFile: 40, managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z' } as ScheduleItem;
    const talk = { ...restated, percentComplete: 50, progressConfirmedBy: 'David', progressConfirmedAt: TALK } as ScheduleItem;
    const undo = scheduleTalkUndo([talk], { id: talk.id, taskName: 'Framing' }, scheduleProgressUndoPoint(restated), scheduleProgressUndoPoint(talk), '2026-09-16T10:04:00.000Z');
    if (!undo.ok) throw new Error(undo.message);
    const undone = { ...talk, ...undo.edit } as ScheduleItem;
    expect([undone.percentComplete, undone.managersPercentUnderFile, undone.managersPercentUnderFileJudgedAt, undone.progressUndone]).toEqual([60, 40, '2026-09-10T09:00:00.000Z', UNDONE]);
    // Merged with a copy still holding Talk's 50%: his 40% stays under G's 60%, and the note stays.
    expect(scheduleManagersPercentUnderFileOfBoth(undone, talk)).toEqual({ managersPercentUnderFile: 40, managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z' });
    const [merged] = recoverDAVEScheduleRecords({ local: [talk], cloud: [undone], allowCloudOnly: true });
    expect([merged.percentComplete, merged.managersPercentUnderFile, merged.progressUndone]).toEqual([60, 40, UNDONE]);
    // An entry of his after the Undo, or one at Talk's time with another percent, is still his latest.
    const later = { ...talk, percentComplete: 55, progressConfirmedAt: '2026-09-16T11:00:00.000Z' } as ScheduleItem;
    expect(scheduleManagersPercentUnderFileOfBoth(undone, later).managersPercentUnderFile).toBe(55);
    expect(scheduleManagersPercentUnderFileOfBoth(undone, { ...talk, percentComplete: 45 } as ScheduleItem).managersPercentUnderFile).toBe(45);
    // A floor made from Talk's 50% (a master approved over it) gives way to the restored copy's entry of his.
    const hFloor = { ...restated, managersPercentUnderFile: 50, managersPercentUnderFileJudgedAt: TALK, progressConfirmedAt: '2026-09-18T12:00:00.000Z' } as ScheduleItem;
    const ownBack = { ...base, percentComplete: 40, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-16T10:04:00.000Z', progressJudgment: { judgedAt: '2026-09-10T09:00:00.000Z', givenBackAt: '2026-09-16T10:04:00.000Z' }, progressUndone: UNDONE } as ScheduleItem;
    expect(scheduleManagersPercentUnderFileOfBoth(hFloor, ownBack)).toEqual({ managersPercentUnderFile: 40, managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z' });
    // Without the note (another task, or one no Undo touched), a later floor stands over an older entry, as before.
    expect(scheduleManagersPercentUnderFileOfBoth(hFloor, { ...ownBack, progressUndone: undefined } as ScheduleItem).managersPercentUnderFile).toBe(50);
  });
});

/*
 * Build 231, schedule batch S3, item 1 (the independent review's F02): the rules behind the tests un-skipped above,
 * on the records alone. A task saved by Build 229 / 230 has no progressStandsSince: it is weighed as before.
 */
describe('S3 item 1: when a schedule was made current with a percent left standing, kept with the task', () => {
  const davids = (row: ScheduleItem, percent: number, at: string) => ({ ...row, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at }) as ScheduleItem;
  const fRow = () => rowsOf(F, [F_ROW])[0];
  const gRow = (percent: number, importedAt: string) => ({ ...rowsOf(scheduleDoc('MASTER G', importedAt), [G_ROW(String(percent))])[0], revisedFromTaskIds: ['MASTER F-1'] }) as ScheduleItem;
  const hRow = (percent: number, importedAt: string) => ({ ...rowsOf(scheduleDoc('MASTER H', importedAt), [`Framing,Alpha,Lot,10/25/2026,11/04/2026,${percent}`])[0], revisedFromTaskIds: ['MASTER F-1', 'MASTER G-1'] }) as ScheduleItem;
  const merged = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: rows, cloud: rows, allowCloudOnly: true }).find(item => item.id === 'MASTER H-1')!.percentComplete;
  const MARK = '2026-09-10T09:00:00.000Z';

  it('the activation marks the row it shows when that row\'s percent is left standing against a later one on the row it hides, and only then', () => {
    const his = davids(fRow(), 60, '2026-09-09T09:00:00.000Z');
    const files = gRow(70, '2026-09-08T09:00:00.000Z');
    // G made current: its file's 70% stands over the 60% he entered since under F.
    expect(scheduleProgressLeftStanding(his, files, MARK)).toEqual({ ...files, progressStandsSince: { at: MARK, percentComplete: 70 }, updatedAt: MARK });
    // F made current again: his 70% stands though G's file stated 80% after it.
    const took = gRow(80, '2026-09-13T00:00:00.000Z');
    const seventy = davids(fRow(), 70, '2026-09-10T21:00:00.000Z');
    expect(scheduleProgressLeftStanding(took, seventy, '2026-09-14T09:00:00.000Z')!.progressStandsSince).toEqual({ at: '2026-09-14T09:00:00.000Z', percentComplete: 70 });
    // Nothing to mark: the file stated before... and he entered his percent after the file's (the carry gives it); a file's lower percent; his own on both.
    expect(scheduleProgressLeftStanding(davids(fRow(), 60, '2026-09-07T13:00:00.000Z'), files, MARK)).toBeNull();
    expect(scheduleProgressLeftStanding(his, gRow(50, '2026-09-08T09:00:00.000Z'), MARK)).toBeNull();
    expect(scheduleProgressLeftStanding(gRow(60, '2026-09-08T09:00:00.000Z'), seventy, MARK)).toBeNull();
    expect(scheduleProgressLeftStanding(his, davids(files, 70, '2026-09-08T10:00:00.000Z'), MARK)).toBeNull();
    // The same activation heard twice marks once.
    expect(scheduleProgressLeftStanding(his, scheduleProgressLeftStanding(his, files, MARK)!, MARK)).toBeNull();
  });

  it('the mark goes with the percent: it counts while the row still holds that percent, and a task saved before has none', () => {
    const files = gRow(70, '2026-09-08T09:00:00.000Z');
    expect(scheduleProgressStandsSince({ ...files, progressStandsSince: { at: MARK, percentComplete: 70 } })).toBe(Date.parse(MARK));
    expect(scheduleProgressStandsSince({ ...files, percentComplete: 75, progressStandsSince: { at: MARK, percentComplete: 70 } })).toBe(0);
    expect(scheduleProgressStandsSince(files)).toBe(0);
  });

  it('the sync\'s carry (L2): a file\'s percent left standing at Set Active counts from then; with no mark (Build 229 / 230) his 60% is carried as before, never less', () => {
    const his = davids(fRow(), 60, '2026-09-09T09:00:00.000Z');
    const g = gRow(70, '2026-09-08T09:00:00.000Z');
    const h = hRow(40, '2026-09-12T09:00:00.000Z');
    expect(merged([his, g, h])).toBe(60);
    expect(merged([his, { ...g, progressStandsSince: { at: MARK, percentComplete: 70 } }, h])).toBe(40);
    // A mark made for a percent the row no longer holds counts for nothing.
    expect(merged([his, { ...g, progressStandsSince: { at: MARK, percentComplete: 65 } }, h])).toBe(60);
    // A percent he entered after that activation is carried as before.
    expect(merged([davids(fRow(), 60, '2026-09-11T09:00:00.000Z'), { ...g, progressStandsSince: { at: MARK, percentComplete: 70 } }, h])).toBe(60);
  });

  it('the sync\'s carry (L1 b): his percent on a row made current again is not taken over by what a row between stated before; with no mark, as before', () => {
    const his = davids(fRow(), 70, '2026-09-10T21:00:00.000Z');
    const g = gRow(80, '2026-09-13T00:00:00.000Z');
    const h = hRow(30, '2026-09-15T00:00:00.000Z');
    expect(merged([his, g, h])).toBe(30);
    expect(merged([{ ...his, progressStandsSince: { at: '2026-09-14T09:00:00.000Z', percentComplete: 70 } }, g, h])).toBe(70);
    // G made current once more after that (its file's 80% stands from then): G has taken it over again.
    expect(merged([{ ...his, progressStandsSince: { at: '2026-09-14T09:00:00.000Z', percentComplete: 70 } }, { ...g, progressStandsSince: { at: '2026-09-14T12:00:00.000Z', percentComplete: 80 } }, h])).toBe(30);
  });

  it('two copies of a row: the later mark that goes with the percent kept, from whichever copy has it', () => {
    const g = gRow(70, '2026-09-08T09:00:00.000Z');
    const marked = { ...g, progressStandsSince: { at: MARK, percentComplete: 70 }, updatedAt: MARK };
    const later = { ...g, progressStandsSince: { at: '2026-09-11T09:00:00.000Z', percentComplete: 70 } };
    const mark = (local: ScheduleItem, cloud: ScheduleItem) => recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true })[0].progressStandsSince;
    expect([mark(g, marked), mark(marked, g), mark(marked, later), mark(later, marked)]).toEqual([marked.progressStandsSince, marked.progressStandsSince, later.progressStandsSince, later.progressStandsSince]);
    // The other copy's mark was for another percent: not kept.
    expect(mark(g, { ...g, progressStandsSince: { at: MARK, percentComplete: 65 } })).toBeUndefined();
  });

  it('Set Active back to an older master (the A5 recorded Low): a row whose file stated less before he entered his percent is floored at the percent the hidden row keeps under its file\'s', () => {
    const g = gRow(40, '2026-09-08T09:00:00.000Z');
    const h = { ...hRow(70, '2026-09-10T09:00:00.000Z'), managersPercentUnderFile: 60, managersPercentUnderFileJudgedAt: '2026-09-09T09:00:00.000Z' } as ScheduleItem;
    const at = '2026-09-11T09:00:00.000Z';
    const shownAfter = (hidden: ScheduleItem, shown: ScheduleItem) => scheduleProgressCarriedToShownTasks({ before: [hidden], after: [shown], now: at })
      .map(item => [item.percentComplete, item.progressSource ?? null, item.managersPercentUnderFile, item.managersPercentUnderFileJudgedAt]);
    expect(shownAfter(h, g)).toEqual([[60, null, 60, '2026-09-09T09:00:00.000Z']]);
    // He entered it before G's file stated its percent: G's stands (its import weighed his). No floor kept (a task saved before): as before.
    expect(shownAfter({ ...h, managersPercentUnderFileJudgedAt: '2026-09-08T08:00:00.000Z' }, g)).toEqual([]);
    expect(shownAfter(hRow(70, '2026-09-10T09:00:00.000Z'), g)).toEqual([]);
    // A file that stated more than his percent stands.
    expect(shownAfter(h, gRow(65, '2026-09-08T09:00:00.000Z'))).toEqual([]);
  });

  it('a row deleted over the live connection before the row that answers to it is heard waits for it, lends once that row is heard, and then stops waiting', () => {
    clearDeletedScheduleRowsHeld();
    const his = davids(fRow(), 30, AFTER_G);
    const moved = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [his.id] } as ScheduleItem;
    expect(scheduleItemsAfterCloudDeletion([his], his.id)).toEqual([]);
    const heardOnce = scheduleItemsAfterCloudRowHeard([moved], moved.id);
    expect(heardOnce.map(item => [item.id, item.percentComplete, item.progressCarriedFrom])).toEqual([[moved.id, 30, { taskId: his.id, judgedAt: AFTER_G }]]);
    // The cloud's row heard again as it was, before the carried percent has gone up: lent again.
    expect(scheduleItemsAfterCloudRowHeard([moved], moved.id)[0].percentComplete).toBe(30);
    // Heard with the percent: nothing more to take, and the deleted row stops waiting.
    expect(scheduleItemsAfterCloudRowHeard(heardOnce, moved.id)).toBe(heardOnce);
    expect(scheduleItemsAfterCloudRowHeard([moved], moved.id)[0].percentComplete).toBe(0);
  });

  it('two devices: heard over the live connection alone, with no refresh: 30% on the iPad at once, and in the cloud after its upload', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(phone, false);
    at(G.importedAt!); await approve(phone, G, [G_ROW(), SURVEY]);
    at('2026-09-14T13:00:00.000Z'); await deleteWithItems(phone, F);
    at(AFTER_G); await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    at('2026-09-15T08:00:00.000Z');
    setOnline(phone, true); shareDocuments(phone);
    await fullSync(phone);
    await tombstoneEchoes(ipad);
    expect(ipad.state.map(item => item.id)).not.toContain('MASTER F-1');
    await echoes(ipad);
    expect(onDevice(ipad)).toEqual([['10/22/2026', '11/01/2026', 30, '', '']]);
    await backgroundUpload(ipad);
    expect([onWeb(), await queueOf(ipad)]).toEqual([[['10/22/2026', '11/01/2026', 30, '', '']], []]);
  });

  it('...a refresh or Full Sync that brings the row lends it too; a deleted row with nothing of his is not held; a device with no tasks holds nothing', () => {
    clearDeletedScheduleRowsHeld();
    const his = davids(fRow(), 30, AFTER_G);
    const moved = { ...rowsOf(G, [G_ROW()])[0], revisedFromTaskIds: [his.id] } as ScheduleItem;
    const survey = rowsOf(F, [F_ROW, SURVEY])[1];
    scheduleItemsAfterCloudDeletion([his, survey], his.id);
    expect(recoverDAVEScheduleRecords({ local: [survey], cloud: [survey, moved], deletedIds: [his.id], allowCloudOnly: true }).find(item => item.id === moved.id)!.percentComplete).toBe(30);
    expect(scheduleItemsAfterCloudRowHeard([moved], moved.id)[0].percentComplete).toBe(0);
    // Nothing of his on the deleted row: nothing waits.
    scheduleItemsAfterCloudDeletion([fRow()], 'MASTER F-1');
    expect(clearDeletedScheduleRowsHeld()).toBe(0);
    expect(scheduleItemsAfterCloudRowHeard([moved], moved.id)).toEqual([moved]);
    // Held, then the device starts over with no tasks: nothing is lent.
    scheduleItemsAfterCloudDeletion([his], his.id);
    recoverDAVEScheduleRecords({ local: [], cloud: [], allowCloudOnly: true });
    expect(scheduleItemsAfterCloudRowHeard([moved], moved.id)[0].percentComplete).toBe(0);
  });
});

/*
 * Build 231, S3 item 1, second part (owner answer Q32, option b, on a task the masters keep on its dates): the row
 * keeps the highest percent a master's file has stated on it and when (fileProgressPeak).
 */
describe('S3 item 1: the highest percent a master\'s file stated on a row, kept with the row', () => {
  const davids = (row: ScheduleItem, percent: number, at: string) => ({ ...row, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at }) as ScheduleItem;
  const inPlace = (percent: number) => `Framing,Alpha,Lot,10/15/2026,10/25/2026,${percent}`;
  /** The phone approves these masters in turn, each on Framing's own dates; its row after the last. */
  async function phoneRowAfter(...masters: Array<[ReferenceDocument, number]>) {
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    for (const [master, percent] of masters) { at(master.importedAt!); await approve(phone, master, [inPlace(percent), SURVEY]); shareDocuments(phone); }
    return theRow(phone);
  }

  it('the approval records it: G\'s 60% then H\'s 30% keeps 60% of G\'s approval; a higher one later replaces it; a task no master restated has none', async () => {
    expect((await phoneRowAfter([G, 60], [H, 30])).fileProgressPeak).toEqual({ percentComplete: 60, statedAt: G.importedAt });
    resetRig();
    expect((await phoneRowAfter([G, 30], [H, 60])).fileProgressPeak).toEqual({ percentComplete: 60, statedAt: H.importedAt });
    resetRig();
    const { phone } = await startBoth(F, [F_ROW, SURVEY]);
    expect(theRow(phone).fileProgressPeak).toBeUndefined();
  });

  it('two copies of the row: his older 40% against a file\'s 30% whose row says a file had stated 60% since: the 30% stands, his 40% kept under it', async () => {
    const files = await phoneRowAfter([G, 60], [H, 30]);
    const his = davids(rowsOf(F, [F_ROW])[0], 40, BEFORE_G);
    expect(scheduleFileTookHisPercentOver(his, files)).toBe(true);
    for (const [local, cloud] of [[his, files], [files, his]]) {
      const [row] = recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true });
      expect([row.percentComplete, row.progressSource ?? null, row.managersPercentUnderFile, row.managersPercentUnderFileJudgedAt, row.fileProgressPeak]).toEqual([30, null, 40, BEFORE_G, { percentComplete: 60, statedAt: G.importedAt }]);
    }
  });

  it('unchanged: H\'s 30% straight over his 40% leaves his 40%; a percent he entered after the file\'s 60% stands; a row with no record (Build 229 / 230) is weighed as before, his 40% kept', async () => {
    const straight = await phoneRowAfter([H, 30]);
    const his = davids(rowsOf(F, [F_ROW])[0], 40, BEFORE_G);
    const kept = (local: ScheduleItem, cloud: ScheduleItem) => recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true })[0].percentComplete;
    expect([scheduleFileTookHisPercentOver(his, straight), kept(his, straight)]).toEqual([false, 40]);
    resetRig();
    const files = await phoneRowAfter([G, 60], [H, 30]);
    const after = davids(rowsOf(F, [F_ROW])[0], 40, AFTER_G);
    expect([scheduleFileTookHisPercentOver(after, files), kept(after, files)]).toEqual([false, 40]);
    const { fileProgressPeak: _none, ...saved229 } = files;
    expect([scheduleFileTookHisPercentOver(his, saved229 as ScheduleItem), kept(his, saved229 as ScheduleItem)]).toEqual([false, 40]);
  });

  it('his offline 40% is not sent over the cloud\'s row once a file has taken it over there, and a note typed with it still goes up', async () => {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(BEFORE_G);
    await edit(ipad, theRow(ipad).id, { percentComplete: 40, notes: 'Walls up' });
    at(G.importedAt!); await approve(phone, G, [inPlace(60), SURVEY]); shareDocuments(phone);
    at(H.importedAt!); await approve(phone, H, [inPlace(30), SURVEY]); shareDocuments(phone);
    at('2026-09-22T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect([cloudRow('MASTER F-1')!.percentComplete, cloudRow('MASTER F-1')!.notes, (await conflictsOf(ipad)).length]).toEqual([30, 'Walls up', 0]);
    await fullSync(ipad); await refresh(phone);
    expect([onWeb(), onDevice(ipad), onDevice(phone)].map(place => [place[0][2], place[0][3]])).toEqual(Array(3).fill([30, 'Walls up']));
  });
});

/*
 * Build 231, schedule batch S3, item 4 (the window sync batch Y1, item 2, left in the automatic upload): a task
 * deleted on another device just after this device's upload pass read the deletion history was sent back once.
 */
describe('S3 item 4: the automatic upload does not send back a task deleted on another device since its pass read the deletion history', () => {
  /**
   * The deletion of F's Framing row lands in the cloud (the row dropped, the deletion record kept) at the moment the
   * next upload pass lists the cloud's tasks: after that pass has read the deletion history. Returns the undo.
   */
  function deletionLandsDuringTheNextPass(): () => void {
    const rows = mockCloud.rows;
    const values = rows.values.bind(rows);
    let landed = false;
    rows.values = (() => {
      if (!landed) {
        landed = true;
        mockCloud.tombstones.push({ entityType: 'schedule_item', recordId: 'MASTER F-1', deletedAt: new Date(Date.now()).toISOString() });
        rows.delete('MASTER F-1');
      }
      return values();
    }) as typeof rows.values;
    return () => { rows.values = values as typeof rows.values; };
  }
  /** His 30% entered on the offline iPad, waiting to go up. */
  async function percentWaitingOnTheIpad() {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    setOnline(ipad, false);
    at(AFTER_G);
    await edit(ipad, 'MASTER F-1', { percentComplete: 30 });
    expect((await queueOf(ipad)).length).toBe(1);
    at('2026-09-15T08:00:00.000Z');
    setOnline(ipad, true);
    return { phone, ipad };
  }

  it('not sent back: the cloud keeps no row for it, the queued copy is retired, and the task leaves the iPad at its next refresh', async () => {
    const { ipad } = await percentWaitingOnTheIpad();
    const undo = deletionLandsDuringTheNextPass();
    try { await backgroundUpload(ipad); } finally { undo(); }
    // (It was: the row back in the cloud at 30%, on every device again until the next sync took it away.)
    expect([cloudRow('MASTER F-1'), mockCloud.tombstones.map(tombstone => tombstone.recordId), await queueOf(ipad)]).toEqual([undefined, ['MASTER F-1'], []]);
    await refresh(ipad);
    expect(ipad.state.map(item => item.id)).not.toContain('MASTER F-1');
    expect(onWeb()).toEqual([]);
  });

  it('unchanged: with no deletion a task the cloud has no row for goes up; and when the deletion history cannot be asked again, the task goes up as before', async () => {
    const { ipad } = await percentWaitingOnTheIpad();
    mockCloud.rows.delete('MASTER F-1'); // the cloud lost the row, and has no deletion record for it
    await backgroundUpload(ipad);
    expect([cloudRow('MASTER F-1')?.percentComplete, await queueOf(ipad)]).toEqual([30, []]);

    resetRig();
    const again = await percentWaitingOnTheIpad();
    const cloudService = jest.requireMock('../../services/SupabaseService') as { listDAVESyncTombstonesForRecords: unknown };
    const ask = cloudService.listDAVESyncTombstonesForRecords;
    cloudService.listDAVESyncTombstonesForRecords = async () => mockDown();
    const undo = deletionLandsDuringTheNextPass();
    try { await backgroundUpload(again.ipad); } finally { undo(); cloudService.listDAVESyncTombstonesForRecords = ask; }
    expect(cloudRow('MASTER F-1')?.percentComplete).toBe(30);
  });
});

/* Build 231, S4 item 2 (a): two rows that both answer to the old row each take his percent from it, by the carry's own rule. */
describe('S4 item 2 (a): the carry reaches each of two rows that answer to the old row', () => {
  const davids = (percent: number, at: string) => ({ ...rowsOf(F, [F_ROW])[0], percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at }) as ScheduleItem;
  const answering = (source: ReferenceDocument, line: string) => ({ ...rowsOf(source, [line])[0], revisedFromTaskIds: ['MASTER F-1'] }) as ScheduleItem;
  const percents = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: rows, cloud: rows, allowCloudOnly: true }).map(row => [row.id, row.percentComplete]);

  it('his 30% on F\'s row; G (approved on one device) and H (on the other) each moved the task: both rows show 30% (both showed 0%)', () => {
    expect(percents([davids(30, AFTER_G), answering(G, G_ROW()), answering(H, 'Framing,Alpha,Lot,10/25/2026,11/04/2026,')]))
      .toEqual([['MASTER F-1', 30], ['MASTER G-1', 30], ['MASTER H-1', 30]]);
  });

  it('each sibling by the rule: a file that states more than his percent keeps its own; one that states less takes his', () => {
    expect(percents([davids(30, BEFORE_G), answering(G, G_ROW('60')), answering(H, 'Framing,Alpha,Lot,10/25/2026,11/04/2026,10')]))
      .toEqual([['MASTER F-1', 30], ['MASTER G-1', 60], ['MASTER H-1', 30]]);
  });

  it('unchanged: a row another row answers to is not the newest and takes nothing', () => {
    const h = { ...answering(H, 'Framing,Alpha,Lot,10/25/2026,11/04/2026,'), revisedFromTaskIds: ['MASTER F-1', 'MASTER G-1'] } as ScheduleItem;
    expect(percents([davids(30, AFTER_G), answering(G, G_ROW()), h])).toEqual([['MASTER F-1', 30], ['MASTER G-1', 0], ['MASTER H-1', 30]]);
  });
});

/*
 * Build 231, S4 item 3 (owner answer Q32, option b; two masters approved apart on two devices that both restate one
 * row): each copy of the row keeps the last percent a master's file stated on it, standing or not (fileProgressLast),
 * beside the highest (fileProgressPeak); the sync's merge replays the two.
 */
describe('S4 item 3: two masters approved apart that both restate the row', () => {
  const inPlace = (percent: number) => `Framing,Alpha,Lot,10/15/2026,10/25/2026,${percent}`;
  /** His 40% on both devices; then the phone approves G and the offline iPad approves H, each on Framing's own dates. Each device's row. */
  async function approvedApart(gPercent: number, hPercent: number) {
    const { phone, ipad } = await startBoth(F, [F_ROW, SURVEY]);
    at('2026-09-10T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 40 });
    await fullSync(ipad);
    setOnline(ipad, false);
    at(G.importedAt!); await approve(phone, G, [inPlace(gPercent), SURVEY]); shareDocuments(phone);
    at(H.importedAt!); await approve(ipad, H, [inPlace(hPercent), SURVEY]);
    return { onPhone: theRow(phone), onIpad: theRow(ipad) };
  }
  const merged = (local: ScheduleItem, cloud: ScheduleItem) => recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true })[0];

  it('each approval records what its file stated: G\'s 60% stands on the phone; H\'s 30% does not stand on the iPad, and is recorded all the same', async () => {
    const { onPhone, onIpad } = await approvedApart(60, 30);
    expect([onPhone.percentComplete, onPhone.fileProgressPeak, onPhone.fileProgressLast]).toEqual([60, { percentComplete: 60, statedAt: G.importedAt }, { percentComplete: 60, statedAt: G.importedAt }]);
    expect([onIpad.percentComplete, onIpad.fileProgressPeak, onIpad.fileProgressLast]).toEqual([40, undefined, { percentComplete: 30, statedAt: H.importedAt }]);
  });

  it('the two copies meet: H\'s 30%, the newest master\'s, as a file\'s percent stated at H\'s approval, his 40% kept under it; whichever copy is the device\'s', async () => {
    const { onPhone, onIpad } = await approvedApart(60, 30);
    for (const [local, cloud] of [[onIpad, onPhone], [onPhone, onIpad]]) {
      const row = merged(local, cloud);
      expect([row.percentComplete, row.progressConfirmedBy, row.progressConfirmedAt, row.managersPercentUnderFile, row.managersPercentUnderFileJudgedAt, row.fileProgressLast])
        .toEqual([30, 'Schedule update', H.importedAt, 40, '2026-09-10T10:00:00.000Z', { percentComplete: 30, statedAt: H.importedAt }]);
    }
  });

  it('unchanged: G never took his percent over (G at 35%): his 40% stays; H above G\'s (70%): the later file\'s 70%; a copy saved before (no record of H): G\'s 60%, as before', async () => {
    const low = await approvedApart(35, 30);
    expect(merged(low.onIpad, low.onPhone).percentComplete).toBe(40);
    resetRig();
    const high = await approvedApart(60, 70);
    expect(merged(high.onIpad, high.onPhone).percentComplete).toBe(70);
    resetRig();
    const { onPhone, onIpad } = await approvedApart(60, 30);
    const { fileProgressLast: _none, ...saved230 } = onIpad;
    expect(merged(saved230 as ScheduleItem, onPhone).percentComplete).toBe(60);
  });

  it('the rule on the records alone: a file takes his percent over only by stating MORE, AFTER he judged it; the newest master\'s percent is then the task\'s', () => {
    const peak = { percentComplete: 60, statedAt: G.importedAt! };
    const last = { percentComplete: 30, statedAt: H.importedAt! };
    const replay = (percent: number, judgedAt: string) => scheduleNewestMastersPercentOverHis({ status: 'In Progress' }, { percent, judgedAt }, peak, last)?.percentComplete ?? null;
    // His 40% before G: taken over, then H's 30%. His 70% before G (entered on the other device): G's 60% took nothing over.
    expect([replay(40, BEFORE_G), replay(70, BEFORE_G), replay(40, AFTER_G)]).toEqual([30, null, null]);
    // No records (a task saved before): nothing.
    expect(scheduleNewestMastersPercentOverHis({ status: 'In Progress' }, { percent: 40, judgedAt: BEFORE_G }, undefined, last)).toBeNull();
    expect(scheduleNewestMastersPercentOverHis({ status: 'In Progress' }, { percent: 40, judgedAt: BEFORE_G }, peak, undefined)).toBeNull();
  });

  it('unchanged: a percent he entered after G\'s approval stands over H\'s lower one; and while a lookahead restates the row nothing is replayed', async () => {
    const { onPhone, onIpad } = await approvedApart(60, 30);
    const after = { ...onIpad, percentComplete: 45, progressConfirmedAt: '2026-09-16T09:00:00.000Z', updatedAt: '2026-09-16T09:00:00.000Z' } as ScheduleItem;
    expect(merged(after, onPhone).percentComplete).toBe(45);
    const noted = { ...onPhone, lookaheadOverlay: { masterStartDate: '10/15/2026', masterFinishDate: '10/25/2026', masterPercentComplete: 60, lookaheads: [{ batchId: 'batch-L', startDate: '10/18/2026', finishDate: '10/28/2026' }] } } as ScheduleItem;
    expect(merged(onIpad, noted).percentComplete).toBe(60);
  });
});

