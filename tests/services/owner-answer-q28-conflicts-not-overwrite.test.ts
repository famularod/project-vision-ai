/**
 * Owner answer Q28 (2 Oct 2026): "YES, and extend to schedule tasks: remember
 * which cloud copy each edit started from. Field updates get Review Conflicts
 * instead of a silent overwrite. Schedule tasks keep both devices' changes
 * field by field and ask only when the same field changed on both. App-only."
 *
 * Field updates (A4 p16, older than the audit: last save wins): the iPad
 * changed an update's note while the phone was offline; later the phone
 * changed only the area and saved, and its whole copy went up over the note
 * with no conflict shown. The copy David opened is now kept with the edit
 * (per account, through a relaunch); changed in the cloud too since, the
 * update goes to Review Conflicts, and nothing automatic sends it. Changed only
 * here, it goes up as before.
 *
 * Schedule tasks (the whole-row merge on Full Sync): a stale offline iPad's
 * Sync Now wrote its whole copy of a task over the note, owner or lookahead
 * dates entered on the phone or the web, also after a relaunch and when it
 * had approved another master offline. Each queued task edit now keeps the
 * copy it started from, and is weighed field by field on upload, on Full
 * Sync, Sync Now, the refresh, the startup load and realtime. The same field
 * changed on both is asked about; the percent keeps its own rules.
 *
 * Queue items made by Build 229 and earlier (no base) behave as before.
 *
 * Two devices and the web, one cloud, in the app's real order: each device has
 * its own storage and its own SyncService (a relaunch is a fresh one on the
 * same storage). App.tsx's own code runs, compiled from its source: the task
 * edit, Full Sync's download apply, the refresh (tasks and field updates),
 * the startup load, openSavedUpdate, retryQueuedUpdate with
 * applyFieldUpdateSyncResultIfCurrent, Settings' Retry callback and Review
 * Conflicts' choice (AdminScreen's resolveConflict). Synthetic data.
 */
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
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockStore().get(key) ?? null,
    setItem: async (key: string, value: string) => { mockStore().set(key, value); },
    removeItem: async (key: string) => { mockStore().delete(key); },
    getAllKeys: async () => [...mockStore().keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, mockStore().get(key) ?? null]),
    multiSet: async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStore().set(key, value)); },
    multiRemove: async (keys: string[]) => { keys.forEach(key => mockStore().delete(key)); },
  };
  return { __esModule: true, default: api, ...api };
});
/** Photo files on each device: a device has the files it took. */
const mockFiles = new Map<string, Set<string>>();
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///var/mobile/Documents/',
  cacheDirectory: 'file:///var/mobile/Library/Caches/',
  getInfoAsync: async (uri: string) => ((mockFiles.get(mockDevice) || new Set()).has(uri) ? { exists: true, size: 2048, isDirectory: false } : { exists: false }),
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async () => undefined,
  downloadAsync: async (_url: string, destination: string) => ({ uri: destination }),
  readAsStringAsync: async () => '',
  copyAsync: async () => undefined,
  moveAsync: async () => undefined,
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: async () => new ArrayBuffer(32) }));

/** The cloud: task rows, field update rows, photo objects, deletion history, every write, realtime events. */
const mockCloud = {
  rows: new Map<string, unknown>(),
  updates: new Map<string, { updatedAt: string; updateData: Record<string, unknown> }>(),
  photos: new Set<string>(),
  tombstones: [] as Array<{ entityType: string; recordId: string; deletedAt: string }>,
  writes: [] as string[],
  events: [] as Array<{ id: string; row: unknown }>,
  offline: new Set<string>(),
};
const mockCopy = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockDown = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
const mockOnline = () => !mockCloud.offline.has(mockDevice);
const mockTick = () => { try { jest.setSystemTime(Date.now() + 1000); } catch { /* real timers */ } };
const MOCK_PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
jest.mock('../../services/SupabaseService', () => {
  const actual = jest.requireActual('../../services/SupabaseService');
  const read = <T,>(data: () => T) => async () => { mockTick(); return mockOnline() ? mockOk(data()) : mockDown(); };
  const addTombstones = (list: Array<{ entityType: string; recordId: string; deletedAt: string }>) => {
    list.forEach(tombstone => {
      if (!mockCloud.tombstones.some(known => known.entityType === tombstone.entityType && known.recordId === tombstone.recordId)) {
        mockCloud.tombstones.push(mockCopy(tombstone));
      }
      if (tombstone.entityType === 'schedule_item') mockCloud.rows.delete(tombstone.recordId);
      if (tombstone.entityType === 'project_update') mockCloud.updates.delete(tombstone.recordId);
    });
  };
  const updateRow = (id: string, current: { updatedAt: string; updateData: Record<string, unknown> }) => ({
    id, projectId: MOCK_PROJECT_ID, projectName: 'Alpha', areaName: '', idempotencyKey: id, createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: current.updatedAt, ownerId: 'owner-d', updateData: mockCopy(current.updateData),
  });
  return {
    ...actual,
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    testSupabaseConnection: async () => (mockOnline()
      ? { connected: true, projectCount: 1 }
      : { connected: false, projectCount: null, error: 'Network request failed' }),
    countCloudProjects: read(() => 1),
    listProjects: read(() => [{ id: MOCK_PROJECT_ID, name: 'Alpha' }]),
    listArchivedProjects: read(() => []),
    verifyDAVEAppOwner: async () => (mockOnline() ? mockOk(true) : mockDown()),
    listProjectUpdates: read(() => [...mockCloud.updates.entries()].map(([id, current]) => updateRow(id, current))),
    getProjectUpdateSyncMetadata: async (id: string) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      const current = mockCloud.updates.get(id);
      return mockOk(current ? { id, projectId: MOCK_PROJECT_ID, updatedAt: current.updatedAt, projectName: 'Alpha', areaName: '', updateData: mockCopy(current.updateData) } : null);
    },
    saveProjectUpdate: async (params: { id: string; projectId: string; updatedAt: string; updateData: Record<string, unknown> }) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      mockCloud.updates.set(params.id, { updatedAt: params.updatedAt, updateData: mockCopy({ ...params.updateData, projectId: params.projectId }) });
      mockCloud.writes.push(`${mockDevice}:update:${params.id}`);
      return mockOk({ id: params.id, updateData: params.updateData });
    },
    archiveProjectUpdate: async () => (mockOnline() ? mockOk(null) : mockDown()),
    deleteProjectUpdate: async () => (mockOnline() ? mockOk(null) : mockDown()),
    createPhotoSignedUrl: async (pathName: string) => {
      if (!mockOnline()) return mockDown();
      return mockCloud.photos.has(pathName) ? mockOk('https://signed.example/photo.jpg')
        : { ok: false, configured: true, stubbed: false, data: null, error: 'Object not found', status: 404 };
    },
    uploadPhoto: async ({ path: pathName }: { path: string }) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      mockCloud.photos.add(pathName);
      return mockOk({ path: pathName });
    },
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
    getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
  };
});
jest.mock('../../services/BackgroundTaskGuard', () => ({ startGuardedBackgroundTask: () => undefined }));
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  runDAVECloudMaintenanceIfDue: async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] }),
}));

import { daveScheduleItemsNeedingCloudUpload, isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords, mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { reconcileCurrentScheduleDocuments, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeStartupArray } from '../../services/StartupRecovery';
import { preserveLocalPhotoTransport, withLatestLocalPhotoTransport } from '../../services/ProjectPhotoTransport';
import { cloudCopyShownOnDevice, documentsUploadedAfterCloudCopy, withDeviceDocumentUploadState } from '../../services/FieldUpdateDocumentUploadState';
import { hasMatchingQueuedProjectUpdateRevision, refreshKeepsLocalProjectUpdate } from '../../services/ProjectUpdateQueueRevision';
import { reconcileFieldUpdateSyncResult } from '../../services/FieldUpdateSyncGeneration';
import { persistedStatusForSyncResult } from '../../services/FieldUpdateLifecycle';
import { classifySyncFailureText } from '../../services/SyncFailureCategory';
import { resolveLegacyOwnedLocalFilePath, isOwnedLocalFileManifestMember } from '../../services/OwnedLocalFileRepository';
import { withStoredPhotoComparisonCap } from '../../services/PhotoAssessment';
import { optionalString, uid } from '../../services/RecordValues';
import { PROJECT_DOCUMENT_CATEGORIES } from '../../services/ProjectDocumentClassification';
import { cloudPhotoPreviewIsFresh } from '../../services/ProjectPhotoTransport';
import { isResumableFieldUpdateStatus } from '../../services/FieldUpdateLifecycle';
import { fieldUpdateConflictChanges } from '../../services/FieldUpdateEditBase';
import { scheduleItemConflictCopyKeeping, scheduleItemConflictCopyOfFields, scheduleItemConflictFields, scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemEditBaseAfterLanding, scheduleItemEditBasesMerged } from '../../services/ScheduleItemEditBase';
import { scheduleItemChangeUsesDebouncedSync } from '../../services/ScheduleItemTextSyncLifecycle';

/* Per-device module sets --------------------------------------------------- */
type SyncModule = typeof import('../../services/SyncService');
type Mods = {
  sync: SyncModule;
  carry: typeof import('../../services/ScheduleProgressCarryUpload');
  tomb: typeof import('../../services/DAVESyncTombstones');
  realtime: typeof import('../../services/DAVEOperationalRealtimeApplication');
  removed: typeof import('../../services/FieldUpdateRemovedDocuments');
};
/**
 * The sync merge marks the rows it carries a percent to in its own module (DAVEScheduleRecovery), and the App's code
 * (compiled here) and each device's carry upload must see the same marks, as in the app: one instance of it, and of
 * the project controls' edit marks, for every device.
 */
import * as DAVEScheduleRecoveryShared from '../../services/DAVEScheduleRecovery';
import * as ProjectControlsShared from '../../services/VitruviusProjectControls';
jest.doMock('../../services/DAVEScheduleRecovery', () => DAVEScheduleRecoveryShared);
jest.doMock('../../services/VitruviusProjectControls', () => ProjectControlsShared);
function loadMods(): Mods {
  let mods: Mods | null = null;
  jest.isolateModules(() => {
    const owner = require('../../services/CloudOwnerBinding');
    owner.noteSignedInOwner('owner-d');
    mods = {
      sync: require('../../services/SyncService'),
      carry: require('../../services/ScheduleProgressCarryUpload'),
      tomb: require('../../services/DAVESyncTombstones'),
      realtime: require('../../services/DAVEOperationalRealtimeApplication'),
      removed: require('../../services/FieldUpdateRemovedDocuments'),
    };
  });
  return mods!;
}

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
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function evaluate<T>(js: string, deps: Record<string, unknown>): T {
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}
function appFunction(name: string): string {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(APP);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const rest = APP.slice(match.index + 1).replace(/^export /, '');
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}
function blockAfter(marker: string): string {
  const start = APP.indexOf(marker);
  if (start < 0) throw new Error(`App.tsx has no ${marker}`);
  const open = start + marker.length - 1;
  let depth = 0;
  for (let index = open; index < APP.length; index += 1) {
    if (APP[index] === '{') depth += 1;
    if (APP[index] === '}') { depth -= 1; if (depth === 0) return APP.slice(open, index + 1); }
  }
  throw new Error('unbalanced block');
}
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(APP);
  if (!match) throw new Error(`no component function ${name}`);
  const open = APP.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < APP.length; index += 1) {
    if (APP[index] === '{') depth += 1;
    if (APP[index] === '}') { depth -= 1; if (depth === 0) return APP.slice(match.index + 3, index + 1); }
  }
  throw new Error('unbalanced function');
}
const REFRESH_SOURCE = appSlice("      if (scheduleItemsLoaded && shouldRefresh('schedule_items')) collectionRefreshes.push({ name: 'schedule_items', run: async () => {", '\n      }});', true);
const FULL_SYNC_APPLY_SOURCE = appSlice('                if (failed.scheduleItems === null) {', '\n                }\n', true);
const STARTUP_APPLY_SOURCE = appSlice('    applyCloud: (items, tombstones) => setScheduleItems(current => recoverDAVEScheduleRecords({', '\n    })),', true);
const UPDATE_SOURCE = appSlice('\n  function updateScheduleItem(', '\n  async function saveScheduleItemChanges(');
const CARRY_EFFECT_LINE = APP.split('\n').find(line => line.includes('useEffect(') && line.includes('(scheduleItems)') && line.includes('Carried')) ?? null;
const UPDATES_REFRESH_BLOCK = blockAfter("collectionRefreshes.push({ name: 'project_updates', run: async () => {");

const helperNames = [
  'resolveProjectPhotoUri', 'optionalNumber', 'optionalBoolean', 'optionalFiniteNumber', 'normalizePhoto',
  'uniqueStrings', 'normalizeRecipientSelection', 'normalizeUpdate', 'normalizeStoredUpdateRecord', 'isRecord',
  'lifecycleStatusForUpdate', 'updateNeedsAutomaticSyncRetry', 'mergeSavedUpdatesWithTombstones',
  'buildUpdateTombstone', 'buildCloudUpdateDeletionBarrier', 'upsertDeletedUpdateTombstone',
  'normalizeFieldUpdateDocuments', 'normalizeProjectDocument', 'normalizeProjectDocumentStatus',
  'normalizeProjectDocumentCategory', 'ownsProjectDocumentFile', 'projectDocumentStatusDetail', 'formatSavedTime',
  'resolveProjectPhotoDisplayUri',
];
const A = evaluate<Record<string, (...args: any[]) => any>>(
  transpile([...helperNames.map(appFunction), `module.exports = { ${helperNames.join(', ')} };`].join('\n')),
  {
    PHOTO_STORAGE_DIR: 'file:///var/mobile/Documents/project-photos/',
    PHOTO_STORAGE_FOLDER: 'project-photos', RECOVERED_PHOTO_CACHE_FOLDER: 'dave-recovered-project-photos',
    FileSystem: { cacheDirectory: 'file:///var/mobile/Library/Caches/' },
    resolveLegacyOwnedLocalFilePath, cloudPhotoPreviewIsFresh, optionalString, uid, mergeLocalUpdateWithCloudCopy,
    withStoredPhotoComparisonCap, PROJECT_DOCUMENT_CATEGORIES, isOwnedLocalFileManifestMember,
    CATEGORIES: ['Open Issue', 'Safety Concern', 'Update'], ACTION_STATUSES: ['Open', 'In Progress', 'Waiting', 'Closed'],
    QUICK_CONTEXTS: [], DEFAULT_PROJECTS: ['Alpha'], isoToday: () => '2026-09-30', authorityProjectId: () => null,
    normalizeInterpretationDecisionLog: () => [], normalizeFieldUpdateSyncDiagnostics: (value: unknown) => value ?? null,
    normalizeFieldUpdateDeleteDiagnostics: (value: unknown) => value ?? null,
    normalizeWorkflowTimestamps: (value: unknown) => value ?? {}, migrateLegacyProjectUpdate: (value: unknown) => value,
  },
);
const DIAGNOSTICS = [
  'classifySyncFailureCategory', 'syncCategoryForStorageFailure', 'syncCategoryIsRlsOrAuth', 'emptyPermissionAttempt',
  'inferPermissionAttemptFromFailure', 'buildSkippedSyncDiagnostics', 'buildSyncDiagnosticsFromUpload', 'statusForSyncDiagnostics',
];
const RETRY_SOURCE = transpile([...DIAGNOSTICS.map(appFunction),
  ...['upsertSavedUpdateUnlessDeleted', 'applyFieldUpdateSyncResultIfCurrent', 'syncFieldUpdateWithMissingPhotoRepair', 'retryQueuedUpdate'].map(componentFunction),
  'module.exports = { retryQueuedUpdate };'].join('\n'));

const identity = <T,>(value: T) => value;
const listCopy = (items: ScheduleItem[]) => items.map(item => ({ ...item }));

/* A device ---------------------------------------------------------------- */
type DeviceName = 'phone' | 'ipad';
type Update = Record<string, any> & { id: string; status: string };
type Device = {
  name: DeviceName;
  m: Mods;
  state: ScheduleItem[];
  ref: { current: ScheduleItem[] };
  documents: ReferenceDocument[];
  saves: number;
  generation: Map<string, number>;
  effectsSeen: ScheduleItem[] | null;
  pendingEffects: Array<Promise<unknown>>;
  /** Field updates as the App holds them. */
  updates: Update[];
  updatesRef: { current: Update[] };
  updateSaves: number;
  /** The update open as the draft. */
  draftRef: { current: Update };
};
function newDevice(name: DeviceName): Device {
  mockDevice = name;
  const m = loadMods();
  return { name, m, state: [], ref: { current: [] }, documents: [], saves: 0, generation: new Map(), effectsSeen: null, pendingEffects: [],
    updates: [], updatesRef: { current: [] }, updateSaves: 0, draftRef: { current: { id: '', status: 'draft' } } };
}
const on = (device: Device) => { mockDevice = device.name; };
function setter(device: Device) {
  return (next: ScheduleItem[] | ((previous: ScheduleItem[]) => ScheduleItem[])) => {
    const value = typeof next === 'function' ? (next as (previous: ScheduleItem[]) => ScheduleItem[])(device.state) : next;
    if (value !== device.state) device.saves += 1;
    device.state = value;
  };
}
function updatesSetter(device: Device) {
  return (next: Update[] | ((previous: Update[]) => Update[])) => {
    const value = typeof next === 'function' ? (next as (previous: Update[]) => Update[])(device.updates) : next;
    if (value !== device.updates) device.updateSaves += 1;
    device.updates = value;
    device.updatesRef.current = value;
  };
}
async function render(device: Device) {
  device.ref.current = device.state;
  device.updatesRef.current = device.updates;
  if (device.effectsSeen === device.state) return;
  device.effectsSeen = device.state;
  if (!CARRY_EFFECT_LINE) return;
  const deps: Record<string, unknown> = {
    useEffect: (effect: () => void) => effect(), startupHydrationReady: true, scheduleItemsLoaded: true, scheduleItems: device.state,
    queueScheduleProgressCarriedToCloud: (items: readonly ScheduleItem[]) => {
      const pending = device.m.carry.queueScheduleProgressCarriedToCloud(items);
      device.pendingEffects.push(pending);
      return pending;
    },
  };
  compiled(`module.exports = null; ${CARRY_EFFECT_LINE}`, deps);
  await Promise.all(device.pendingEffects.splice(0));
}
async function backgroundUpload(device: Device) {
  on(device);
  if (mockOnline()) await device.m.sync.uploadPendingChanges();
}
/** A relaunch: a fresh set of modules (nothing held in memory) on the same storage and saved lists. */
function relaunchModules(device: Device) {
  on(device);
  device.m = loadMods();
  device.effectsSeen = null;
}

/* Tasks ---------------------------------------------------------------------- */
const rowsOf = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
  mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
const scheduleDoc = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

async function approve(device: Device, source: ReferenceDocument, lines: string[], lookahead = false) {
  on(device);
  const before = device.ref.current;
  const merged = mergeApprovedScheduleImportItems({
    existing: before, imported: rowsOf(source, lines), completionMatch: () => null, mergeCompletion: (item: ScheduleItem) => item,
    isCurrent: scheduleItemsVisibleBeforeImport(before, [...device.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...(lookahead ? { overlay: true } : {}),
  } as never) as { additions: ScheduleItem[]; next: ScheduleItem[] };
  const synchronized = reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]);
  const previous = new Map(before.map(item => [item.id, item]));
  const changed = synchronized.filter(item => JSON.stringify(item) !== JSON.stringify(previous.get(item.id)));
  // As App.tsx's approval: with the tasks as they were before it (Q28 head; b03af1c ignores it).
  const result = await device.m.sync.runScheduleImportCloudSync({ scheduleItems: changed, referenceDocuments: [], scheduleItemsBefore: before } as never);
  const superseded = new Set(result.supersededScheduleItemIds);
  setter(device)(synchronized.filter(item => !superseded.has(item.id)));
  device.documents = lookahead ? [...device.documents, source]
    : scheduleDocumentsAfterActivation(source, [...device.documents, source], 'project');
  await render(device);
}

async function edit(device: Device, itemId: string, change: Partial<ScheduleItem>, restoresProgress = false) {
  on(device);
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: device.ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: (id: string) => { const next = (device.generation.get(id) || 0) + 1; device.generation.set(id, next); return next; },
    markScheduleItemsAuthorityReady: () => undefined, setScheduleItems: setter(device),
    scheduleItemChangeUsesDebouncedSync: () => false, cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: (item: ScheduleItem, _generation: number, changedFields?: readonly (keyof ScheduleItem)[], before?: ScheduleItem) => {
      device.pendingEffects.push((device.m.sync.runScheduleItemCloudSync as (...args: unknown[]) => Promise<unknown>)(item, changedFields, before));
    },
    queueScheduleItemRecord: device.m.sync.queueScheduleItemRecord,
    Alert: { alert: () => undefined },
  };
  const update = compiled<(id: string, change: Partial<ScheduleItem>, workflow?: unknown, restores?: boolean) => void>(`module.exports = (() => { ${UPDATE_SOURCE}\n return updateScheduleItem; })();`, deps);
  update(itemId, change, undefined, restoresProgress);
  await Promise.all(device.pendingEffects.splice(0));
  await render(device);
}

/* The task editor's own path (review N1) ----------------------------------------------------------------------- */
type FollowUpResult = { uploaded: number; queued: number; conflicts: number };
const FOLLOW_UP_SOURCE = appSlice('\n  function queueDebouncedScheduleItemTextSync(', '\n  function updateScheduleItem(');
/** What App.tsx passes on to runScheduleItemCloudSync from syncScheduleItemRevision (its own call, read from the source). */
const followUpRun = (device: Device) => (item: ScheduleItem, _generation: number | undefined, changedFields?: unknown, before?: unknown, ...rest: unknown[]) =>
  (device.m.sync.runScheduleItemCloudSync as (...args: unknown[]) => Promise<FollowUpResult>)(item, changedFields, before, ...rest);
/** The follow-up send 700 ms after the typing stops: App.tsx's own (the debounce's onReady), compiled. */
async function editorFollowUp(device: Device, itemId: string): Promise<FollowUpResult | null> {
  on(device);
  let sent: Promise<FollowUpResult> | null = null;
  compiled<(id: string, generation: number) => void>(`module.exports = (() => { ${FOLLOW_UP_SOURCE}\n return queueDebouncedScheduleItemTextSync; })();`, {
    scheduleItemSyncGenerationsRef: { current: device.generation }, scheduleItemTextSyncLifecycleRef: { current: {} }, scheduleItemsCurrentRef: device.ref,
    scheduleScheduleItemTextSync: ({ onReady, itemId: id, generation }: { onReady: (id: string, generation: number) => void; itemId: string; generation: number }) => onReady(id, generation),
    syncScheduleItemRevision: (...args: unknown[]) => { sent = (followUpRun(device) as (...values: unknown[]) => Promise<FollowUpResult>)(...args); },
  })(itemId, device.generation.get(itemId) as number);
  const result = await sent;
  await render(device);
  return result;
}
/** Save in the task editor: App.tsx's own saveScheduleItemChanges, compiled. */
async function saveInEditor(device: Device, itemId: string): Promise<FollowUpResult | null> {
  on(device);
  let sent: Promise<FollowUpResult> | null = null;
  const save = evaluate<{ saveScheduleItemChanges: (id: string) => Promise<unknown> }>(
    transpile(`${componentFunction('saveScheduleItemChanges')}\nmodule.exports = { saveScheduleItemChanges };`), {
      Keyboard: { dismiss: () => undefined }, delay: async () => undefined, scheduleItemsCurrentRef: device.ref, cancelScheduleItemTextSync: () => undefined,
      scheduleItemSyncGenerationsRef: { current: device.generation },
      syncScheduleItemRevision: (...args: unknown[]) => { sent = (followUpRun(device) as (...values: unknown[]) => Promise<FollowUpResult>)(...args); return sent; },
    });
  await save.saveScheduleItemChanges(itemId);
  const result = await sent;
  await render(device);
  return result;
}
/** The phone hears only the cloud's writes since `from` (its own upload's); what it had not heard before, it hears later. */
async function ownEcho(device: Device, from: number) {
  const mark = heard.get(device.name) ?? 0;
  heard.set(device.name, from);
  try { await echoes(device); } finally { heard.set(device.name, mark); }
}
/**
 * A change typed in the task editor (a note, an owner, a percent), in the app's real order: App.tsx's updateScheduleItem
 * with the app's own debounce rule queues it with its fields and base; the automatic upload it asks for runs; the device
 * hears its own write (`hears`: 'own', or 'nothing' yet); then the follow-up send fires. Its answer is returned.
 */
async function typed(device: Device, itemId: string, change: Partial<ScheduleItem>, hears: 'own' | 'nothing' = 'own'): Promise<FollowUpResult | null> {
  on(device);
  const queued: Array<Promise<unknown>> = [];
  let debounced = false;
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: device.ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: (id: string) => { const next = (device.generation.get(id) || 0) + 1; device.generation.set(id, next); return next; },
    markScheduleItemsAuthorityReady: () => undefined, setScheduleItems: setter(device),
    scheduleItemChangeUsesDebouncedSync, cancelScheduleItemTextSync: () => undefined, markScheduleItemTextSyncPending: () => undefined,
    scheduleItemTextSyncLifecycleRef: { current: {} }, scheduleItemSyncGenerationsRef: { current: device.generation },
    queueDebouncedScheduleItemTextSync: () => { debounced = true; },
    syncScheduleItemRevision: () => { throw new Error('a typed change goes through the debounce'); },
    queueScheduleItemRecord: (...args: unknown[]) => { const pending = (device.m.sync.queueScheduleItemRecord as (...values: unknown[]) => Promise<void>)(...args); queued.push(pending); return pending; },
    Alert: { alert: () => undefined },
  };
  compiled<(id: string, change: Partial<ScheduleItem>) => void>(`module.exports = (() => { ${UPDATE_SOURCE}\n return updateScheduleItem; })();`, deps)(itemId, change);
  await Promise.all(queued);
  await render(device);
  expect(debounced).toBe(true);
  const eventsBefore = mockCloud.events.length;
  await backgroundUpload(device);
  if (hears === 'own') await ownEcho(device, eventsBefore);
  jest.setSystemTime(Date.now() + 700);
  return editorFollowUp(device, itemId);
}

const rebaseDep = (device: Device) => {
  const queueRevision = require('../../services/ScheduleItemQueueRevision');
  return {
    scheduleItemsWithPendingEditsOverCloud: queueRevision.scheduleItemsWithPendingEditsOverCloud,
    scheduleItemEditsWaitingAtLastLoad: device.m.sync.scheduleItemEditsWaitingAtLastLoad,
  };
};

/** Full Sync from Settings: synchronizeLocalData (tasks and field updates), then App.tsx's download apply. */
async function fullSync(device: Device, upload = true) {
  on(device);
  const result = await device.m.sync.synchronizeLocalData({
    projects: ['Alpha'], savedUpdates: device.updates as never, projectAreas: [], scheduleItems: device.state, referenceDocuments: [],
  } as never);
  if (!result.connected) return result;
  const recovered = result.recovered;
  const apply = compiled<(recovered: unknown) => void>(`module.exports = (recovered) => { const failed = recovered.collectionErrors; ${FULL_SYNC_APPLY_SOURCE} };`, {
    normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
    markScheduleItemsAuthorityReady: () => undefined, recordScheduleCloudPull: async () => undefined,
    ...rebaseDep(device),
  });
  apply(recovered);
  if (recovered.collectionErrors.updates === null) {
    const cloudUpdates = (recovered.updates as unknown as Update[]).map(update => A.normalizeUpdate(update));
    updatesSetter(device)(previous => A.mergeSavedUpdatesWithTombstones({ localUpdates: previous, cloudUpdates, tombstones: [] }));
  }
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return result;
}

async function refresh(device: Device, upload = true) {
  on(device);
  if (!mockOnline()) return false;
  const tombstones = await device.m.tomb.loadDAVEOperationalTombstones();
  const collectionRefreshes: Array<{ name: string; run: () => Promise<void> }> = [];
  compiled(`module.exports = null; ${REFRESH_SOURCE}`, {
    scheduleItemsLoaded: true, shouldRefresh: () => true, collectionRefreshes,
    listScheduleItems: require('../../services/SupabaseService').listScheduleItems,
    active: true, refreshCommit: { isCurrent: () => true, commit: (commit: () => void) => commit() },
    normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
    deletedDAVERecordIds, tombstones, scheduleItemsCurrentRef: device.ref, getOfflineQueue: device.m.sync.getOfflineQueue,
    scheduleItemRevisionForCloudRefresh: require('../../services/ScheduleItemQueueRevision').scheduleItemRevisionForCloudRefresh,
    recoverDAVEScheduleRecords, setScheduleItems: setter(device),
    identityAliasCleanup: { markScheduleRefreshed: () => undefined }, recordScheduleCloudPull: async () => undefined,
    refreshStartedAt: new Date().toISOString(),
  });
  try {
    await collectionRefreshes[0].run();
    await updatesRefresh(device);
  } catch {
    return false;
  }
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return true;
}

/** The refresh's project_updates run, compiled from App.tsx, on this device. */
async function updatesRefresh(device: Device) {
  on(device);
  const SupabaseMock = require('../../services/SupabaseService');
  const run = evaluate<() => Promise<void>>(
    transpile(`module.exports = async function () ${UPDATES_REFRESH_BLOCK}`),
    {
      listProjectUpdates: SupabaseMock.listProjectUpdates, active: true,
      refreshCommit: { isCurrent: () => true, commit: (effect: () => void) => { effect(); return true; } },
      normalizeStartupArray, normalizeStoredUpdateRecord: A.normalizeStoredUpdateRecord,
      savedUpdatesRef: device.updatesRef, projectDocumentsCurrentRef: { current: [] },
      resolveProjectPhotoUri: A.resolveProjectPhotoUri, preserveLocalPhotoTransport, withLatestLocalPhotoTransport,
      withDeviceDocumentUploadState, cloudCopyShownOnDevice, hydrateProjectUpdatePhotoPreviews: device.m.sync.hydrateProjectUpdatePhotoPreviews,
      getOfflineQueue: device.m.sync.getOfflineQueue,
      documentsUploadedAfterCloudCopy, resendUpdatesListingDocument: () => undefined,
      deletedUpdateTombstonesRef: { current: [] }, buildUpdateTombstone: A.buildUpdateTombstone,
      upsertDeletedUpdateTombstone: A.upsertDeletedUpdateTombstone, hasMatchingQueuedProjectUpdateRevision,
      refreshKeepsLocalProjectUpdate, projectUpdateUploadedSince: device.m.sync.projectUpdateUploadedSince,
      mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones,
      setDeletedUpdateTombstones: () => undefined, setSavedUpdates: updatesSetter(device),
      loadRemovedFieldUpdateDocuments: device.m.removed.loadRemovedFieldUpdateDocuments,
      requeueRemovedFieldUpdateDocuments: device.m.sync.requeueRemovedFieldUpdateDocuments, requestPendingChangesUpload: () => undefined,
    },
  );
  await run();
  device.updatesRef.current = device.updates;
}

async function startup(device: Device, upload = true) {
  on(device);
  if (!mockOnline()) return false;
  const tombstones = await device.m.tomb.synchronizeDAVESyncTombstones();
  const list = await device.m.sync.listScheduleItemsWithEditsWaiting(); // the App's loadCloud, noting the task edits waiting

  if (!list.ok || !tombstones.cloudAuthoritative) return false;
  const holder = compiled<{ applyCloud: (items: ScheduleItem[], tombstones: unknown) => void }>(`module.exports = { ${STARTUP_APPLY_SOURCE} };`, {
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds, ...rebaseDep(device),
  });
  holder.applyCloud((list.data as ScheduleItem[]).filter(isDAVESafeCloudScheduleRecord), tombstones.tombstones);
  try { await updatesRefresh(device); } catch { /* offline */ }
  syncDocuments(device);
  await render(device);
  if (upload) await backgroundUpload(device);
  return true;
}

const heard = new Map<DeviceName, number>();
function applierFor(device: Device, tombstones: () => DAVESyncTombstone[], commitTombstones: (next: DAVESyncTombstone[]) => void = () => undefined) {
  return device.m.realtime.createDAVEOperationalRealtimeApplier({
    isActive: () => true,
    snapshot: () => ({
      projects: ['Alpha'], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: [], deletedUpdates: [],
      tombstones: tombstones(), areas: [], scheduleItems: device.ref.current, documents: device.documents,
    }),
    getPendingQueue: device.m.sync.getOfflineQueue,
    normalizeUpdate: identity as never, normalizeAreas: identity as never,
    normalizeSchedule: (value: unknown) => listCopy(value as ScheduleItem[]),
    normalizeDocuments: identity as never, migrateSchedule: identity,
    localPhotoUri: () => '', mergeProjectNames: (base: string[]) => base, updateHasPendingLocalWork: () => false,
    mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates, buildUpdateTombstone: identity as never,
    buildCloudDeletionBarrier: identity as never, upsertDeletedUpdate: identity as never,
    commitProjects: () => undefined, commitDeletedProjects: () => undefined, commitUpdates: () => undefined,
    commitDeletedUpdates: () => undefined, commitTombstones, commitAreas: () => undefined,
    commitSchedule: (items: ScheduleItem[]) => { setter(device)(items); device.ref.current = items; },
    commitDocuments: () => undefined,
  } as never);
}
async function echoes(device: Device) {
  on(device);
  if (!mockOnline()) return 0;
  const from = heard.get(device.name) ?? 0;
  const events = mockCloud.events.slice(from);
  heard.set(device.name, mockCloud.events.length);
  const tombstones = deletedDAVERecordIds(mockCloud.tombstones as DAVESyncTombstone[], 'schedule_item');
  const apply = applierFor(device, () => mockCloud.tombstones as DAVESyncTombstone[]);
  for (const event of events) {
    if (tombstones.includes(event.id)) continue;
    await apply('schedule_item', { eventType: 'UPDATE', newRow: { id: event.id, item_data: event.row } } as never);
  }
  await render(device);
  return events.length;
}
const heardTombstones = new Map<DeviceName, number>();
async function tombstoneEchoes(device: Device) {
  on(device);
  if (!mockOnline()) return 0;
  const from = heardTombstones.get(device.name) ?? 0;
  const events = mockCloud.tombstones.slice(from);
  heardTombstones.set(device.name, mockCloud.tombstones.length);
  let tombstones = mockCloud.tombstones.slice(0, from) as DAVESyncTombstone[];
  const apply = applierFor(device, () => tombstones, next => { tombstones = next; });
  for (const tombstone of events) {
    const row = { entity_type: tombstone.entityType, record_id: tombstone.recordId, deleted_at: tombstone.deletedAt };
    await apply('sync_tombstone' as never, { eventType: 'INSERT', newRow: row } as never);
  }
  await render(device);
  return events.length;
}

async function deleteWithItems(device: Device, target: ReferenceDocument) {
  on(device);
  const document = device.documents.find(saved => saved.id === target.id);
  if (!document) return;
  const items = device.ref.current;
  const shownBefore = new Map(items.map(item => [item.id, item]));
  const removed = scheduleItemsOnlyInImportBatch(items, document, device.documents.filter(scheduleDocumentIsScheduleLike));
  await device.m.tomb.recordDAVESyncTombstones(removed.map(item => ({ entityType: 'schedule_item' as const, recordId: item.id })));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = device.documents.filter(other => other.id !== document.id);
  const kept = items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents }).map(item => [item.id, item]));
  setter(device)(kept.map(item => restored.get(item.id) || item));
  device.documents = documents;
  deletedDocuments.add(document.id);
  // As App.tsx: each restored task with the copy it started from (Q28 head; b03af1c ignores it).
  await Promise.all([...restored.values()].map(item => (device.m.sync.runScheduleItemCloudSync as (...args: unknown[]) => Promise<unknown>)(item, undefined, shownBefore.get(item.id))));
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

/* The web desktop: writes straight to the cloud ---------------------------- */
function webWrite(item: ScheduleItem) {
  mockCloud.rows.set(item.id, mockCopy(item));
  mockCloud.writes.push(`web:${item.id}`);
  mockCloud.events.push({ id: item.id, row: mockCopy(item) });
}
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

/* Field updates -------------------------------------------------------------- */
const UPDATE_ID = 'u-q28';
const photoUri = (device: DeviceName, photoId: string) => `file:///var/mobile/Documents/project-photos/${device}-${photoId}.jpg`;
function newPhoto(device: DeviceName, photoId: string, at: string) {
  const uri = photoUri(device, photoId);
  let files = mockFiles.get(device);
  if (!files) { files = new Set(); mockFiles.set(device, files); }
  files.add(uri);
  return { id: photoId, uri, caption: '', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', createdAt: at };
}
function appRetry(device: Device) {
  return evaluate<{ retryQueuedUpdate: (update: Update, sync?: { automatic?: boolean; overConflict?: boolean }) => Promise<Update> }>(RETRY_SOURCE, {
    classifySyncFailureText, persistedStatusForSyncResult, reconcileFieldUpdateSyncResult,
    savedUpdatesRef: device.updatesRef, setSavedUpdates: updatesSetter(device),
    mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones, deletedUpdateTombstonesRef: { current: [] },
    getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
    fieldUpdateSyncCategoryWithoutSession: async () => 'offline', signInPendingRef: { current: false },
    runFieldUpdateCloudSync: device.m.sync.runFieldUpdateCloudSync, markMissingPhotosUnavailable: device.m.sync.markMissingPhotosUnavailable,
    removeMissingPhotosFromSyncQueue: device.m.sync.removeMissingPhotosFromSyncQueue, persistSavedUpdateImmediately: async () => true,
    withPhoneAnalysisResults: device.m.sync.withPhoneAnalysisResults, withAnalysisResultsLastInCloud: device.m.sync.withAnalysisResultsLastInCloud,
    withDeviceDocumentUploadState, projectDocumentsCurrentRef: { current: [] },
  }).retryQueuedUpdate;
}
const theUpdate = (device: Device) => device.updates.find(update => update.id === UPDATE_ID);
/** David's waiting-update sync (the App's retry of a queued or failed card, automatic). */
async function waitingUpdateSync(device: Device) {
  on(device);
  if (!mockOnline()) return;
  const card = theUpdate(device);
  if (!card || !A.updateNeedsAutomaticSyncRetry(card)) return;
  await appRetry(device)(card, { automatic: true });
  device.updatesRef.current = device.updates;
}
const OPEN_SOURCE = transpile(`${componentFunction('openSavedUpdate')}\nmodule.exports = { openSavedUpdate };`);
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
/** David opens the saved update on this device (the App's own openSavedUpdate): the card becomes the draft. */
async function openOnly(device: Device) {
  on(device);
  const update = theUpdate(device)!;
  const { openSavedUpdate } = evaluate<{ openSavedUpdate: (update: Update) => void }>(OPEN_SOURCE, {
    lifecycleStatusForUpdate: A.lifecycleStatusForUpdate, isResumableFieldUpdateStatus,
    updateDetailReturnScreenRef: { current: 'SavedUpdates' }, setSelectedWorkspaceProject: () => undefined,
    setSelectedDetailUpdate: () => undefined, setScreen: () => undefined, draftRef: device.draftRef,
    screenForUpdateResume: () => 'BuildUpdate', noteFieldUpdateEditOpened: device.m.sync.noteFieldUpdateEditOpened,
    hasDraftContent: () => false, draft: device.draftRef.current, Alert: { alert: () => undefined },
    setDraft: (next: Update) => { device.draftRef.current = next; }, discardDraftAfterReplacement: async () => undefined,
  });
  openSavedUpdate(update);
  await flush();
  expect(device.draftRef.current.id).toBe(UPDATE_ID);
}
/** He changes the draft and saves it: the card and its queue record as the App's save writes them, then the save's own sync. */
async function saveOpened(device: Device, change: (card: Update) => Partial<Update>) {
  on(device);
  const draft = device.draftRef.current;
  const now = new Date().toISOString();
  const queued: Update = {
    ...draft, ...change(draft), status: 'queued', sendAttempts: (draft.sendAttempts || 0) + 1, lastSendAttemptAt: now,
    stableSendId: draft.stableSendId || `send-${draft.id}`, idempotencyKey: draft.idempotencyKey || `send-${draft.id}`,
    workflowTimestamps: { ...(draft.workflowTimestamps || {}), sendTappedAt: now },
  };
  updatesSetter(device)(device.updates.map(update => update.id === UPDATE_ID ? queued : update));
  device.draftRef.current = { id: '' } as Update;
  await device.m.sync.queueProjectUpdateRecord(queued as never, false);
  if (mockOnline()) {
    await appRetry(device)(queued, { automatic: true });
    device.updatesRef.current = device.updates;
  }
}
async function openAndSave(device: Device, change: (card: Update) => Partial<Update>) {
  await openOnly(device);
  await saveOpened(device, change);
}

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
const webShown = () => shownOf(cloudItems(), cloudDocuments);
const deviceShown = (device: Device) => shownOf(device.state, device.documents);
async function queueOf(device: Device) { on(device); return device.m.sync.getOfflineQueue(); }
async function conflictsOf(device: Device) { on(device); return device.m.sync.getSyncConflicts(); }
const cloudWrites = () => mockCloud.writes.length;
const cloudUpdate = () => mockCloud.updates.get(UPDATE_ID)?.updateData as Update | undefined;
const cloudRow = (id: string) => mockCloud.rows.get(id) as ScheduleItem | undefined;

function resetRig() {
  mockStores.clear();
  mockFiles.clear();
  mockCloud.rows.clear();
  mockCloud.updates.clear();
  mockCloud.photos.clear();
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

/** Both devices start from the phone's approved master and the phone's sent field update, synced to the iPad. */
async function startBoth(master: ReferenceDocument, lines: string[]) {
  resetRig();
  const phone = newDevice('phone');
  const ipad = newDevice('ipad');
  await approve(phone, master, lines);
  shareDocuments(phone);
  await backgroundUpload(phone);
  // The phone's field update, sent.
  on(phone);
  const at = new Date().toISOString();
  const first: Update = {
    ...A.normalizeStoredUpdateRecord({
      id: UPDATE_ID, projectName: 'Alpha', date: '2026-09-07', notes: 'Pour', recipients: { contactIds: [] },
      photos: [newPhoto('phone', 'p0', at)], selectedAreaId: 'area-0', selectedAreaName: 'Area 0', documents: [],
    }),
    status: 'queued',
  };
  updatesSetter(phone)([first]);
  await phone.m.sync.queueProjectUpdateRecord(first as never, false);
  await appRetry(phone)(first, { automatic: true });
  await fullSync(ipad);
  await refresh(ipad);
  heard.set('phone', mockCloud.events.length);
  heard.set('ipad', mockCloud.events.length);
  return { phone, ipad };
}

/* Settings: Review Conflicts' choice and its Retry callback, as the App wires them ------------------------------ */
const ADMIN = fs.readFileSync(path.resolve(__dirname, '../../screens/AdminScreen.tsx'), 'utf8');
function adminFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(ADMIN);
  if (!match) throw new Error(`no AdminScreen function ${name}`);
  const open = ADMIN.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < ADMIN.length; index += 1) {
    if (ADMIN[index] === '{') depth += 1;
    if (ADMIN[index] === '}') { depth -= 1; if (depth === 0) return ADMIN.slice(match.index + 3, index + 1); }
  }
  throw new Error('unbalanced function');
}
/** Settings' Retry callback as the App wires it (onRetryUpdateSync, the App's own retryQueuedUpdate); `settled` waits for its calls. */
function settingsRetryCallback(device: Device) {
  const wiring = /onRetryUpdateSync=\{(.+)\}\n/.exec(APP)![1];
  const retry = evaluate<(...args: unknown[]) => Promise<unknown>>(transpile(`module.exports = ${wiring};`), { retryQueuedUpdate: appRetry(device) });
  const calls: Array<Promise<unknown>> = [];
  const onRetryUpdateSync = jest.fn((...args: unknown[]) => {
    const call = retry(...args);
    calls.push(call);
    return call;
  });
  return { onRetryUpdateSync, settled: async () => { await Promise.all(calls); device.updatesRef.current = device.updates; } };
}
/** Keep Phone or Keep Cloud in Settings: AdminScreen's own resolveConflict, then the App's own handler for the chosen copy. */
async function chooseInSettings(device: Device, conflictId: string, resolution: 'keep_local' | 'keep_cloud') {
  on(device);
  const applyUpdate = evaluate<(update: Update) => void>(
    transpile(`module.exports = function (update) ${blockAfter('onApplyCloudConflictUpdate={update => {')}`),
    {
      normalizeStoredUpdateRecord: A.normalizeStoredUpdateRecord, setSavedUpdates: updatesSetter(device), savedUpdatesRef: device.updatesRef,
      mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones, deletedUpdateTombstonesRef: { current: [] },
    },
  );
  const applyTask = evaluate<(item: ScheduleItem) => void>(
    transpile(`module.exports = function (item) ${blockAfter('onApplyCloudConflictScheduleItem={item => {')}`),
    {
      migrateLegacyScheduleItem: identity, normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), deletedDAVERecordIds,
      operationalSyncTombstonesRef: { current: mockCloud.tombstones }, scheduleItemsCurrentRef: device.ref, setScheduleItems: setter(device),
    },
  );
  const { onRetryUpdateSync, settled } = settingsRetryCallback(device);
  const alerts: string[] = [];
  const { resolveConflict } = evaluate<{ resolveConflict: (conflict: unknown, resolution: string) => Promise<void> }>(
    transpile(`${adminFunction('resolveConflict')}\nmodule.exports = { resolveConflict };`),
    {
      setResolvingConflictId: () => undefined,
      resolveScheduleItemSyncConflict: device.m.sync.resolveScheduleItemSyncConflict, onApplyCloudConflictScheduleItem: applyTask,
      resolveProjectUpdateSyncConflict: device.m.sync.resolveProjectUpdateSyncConflict, syncConflictChoiceStopReason: device.m.sync.syncConflictChoiceStopReason,
      onApplyCloudConflictUpdate: applyUpdate, savedUpdates: device.updatesRef.current, savedUpdatesRef: device.updatesRef,
      projectUpdateCopyIsLastInCloud: device.m.sync.projectUpdateCopyIsLastInCloud, onRetryUpdateSync,
      getSyncConflicts: device.m.sync.getSyncConflicts, getSyncStatus: async () => null, setSyncConflicts: () => undefined, setSyncStatus: () => undefined,
      setSyncAttemptMessage: () => undefined, setConflictReviewVisible: () => undefined,
      Alert: { alert: (title: string) => { alerts.push(title); } },
    },
  );
  await resolveConflict((await device.m.sync.getSyncConflicts()).find(item => item.id === conflictId), resolution);
  await settled();
  await render(device);
  expect(alerts).toEqual([]);
}

/** Framing as the phone's master F gives it, unstamped. */
const cloudTaskRow = () => ({
  id: 'MASTER F-1', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026',
  milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-09-07T12:00:00.000Z',
}) as unknown as ScheduleItem;

/* What the tests read ------------------------------------------------------------------------------------------ */
const framingOf = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Framing');
/** What a place shows of Framing: dates, percent, note, owner. */
const shows = (items: readonly ScheduleItem[]) => framingOf(items).map(item => [item.startDate, item.finishDate, item.percentComplete, item.notes || '', item.owner || '']);
const onDevice = (device: Device) => shows(deviceShown(device));
const onWeb = () => shows(webShown());
const theRow = (device: Device) => framingOf(deviceShown(device))[0];
const card = (device: Device) => {
  const update = theUpdate(device);
  return update && { notes: update.notes, area: update.selectedAreaName, photos: (update.photos || []).map((photo: { id: string }) => photo.id), status: update.status };
};
const inCloud = () => {
  const update = cloudUpdate();
  return update && { notes: update.notes, area: update.selectedAreaName, photos: (update.photos || []).map((photo: { id: string }) => photo.id) };
};
/** A card the App lets David open (its last send failed), as the save sync leaves it. */
function cardFails(device: Device) {
  updatesSetter(device)(device.updates.map(update => update.id === UPDATE_ID ? { ...update, status: 'failed' } : update));
}
/** Build 229's queue and conflicts on this device: every record without the copy its edit started from. */
function asBuild229(device: Device) {
  const store = mockStores.get(device.name)!;
  const strip = (key: string, at: (item: any) => any) => {
    const raw = store.get(key);
    if (!raw) return;
    store.set(key, JSON.stringify((JSON.parse(raw) as unknown[]).map(item => { delete at(item)?.base; delete at(item)?.askedFields; return item; })));
  };
  strip('projectVisionAI.syncQueue.v1', item => item?.payload);
  strip('projectVisionAI.syncConflicts.v1', item => item?.localPayload);
  store.delete('projectVisionAI.fieldUpdateEditBases.v1');
}

jest.setTimeout(60_000);
const F = scheduleDoc('MASTER F', '2026-09-07T12:00:00.000Z');
const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
const F_ROW = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,';
const L = scheduleDoc('LOOKAHEAD L', '2026-09-10T12:00:00.000Z', 'lookahead');
const L_ROW = 'Framing,Alpha,Lot,10/18/2026,10/28/2026,';
const G = scheduleDoc('MASTER G', '2026-09-10T18:00:00.000Z');
const IPAD_NOTE = 'Pour moved to Tuesday (typed on the iPad)';
const PHONE_NOTE = 'Crew short Tuesday';
beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-09-07T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
});
afterEach(() => { jest.useRealTimers(); });
const at = (when: string) => jest.setSystemTime(Date.parse(when));
const start = () => { at('2026-09-07T12:00:00.000Z'); return startBoth(F, [F_ROW, SURVEY]); };

/* ------------------------------------------------------------------------------------------------------------- */
describe('Q28 field updates: an update changed on both devices goes to Review Conflicts, not last save wins', () => {
  /** A4 p16: the iPad changes the note while the phone is offline; later the phone changes only the area and saves. */
  async function a4p16() {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, area: 'Area 0' });
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ selectedAreaId: 'area-b', selectedAreaName: 'Area B' }));
    at('2026-09-08T10:00:00.000Z');
    setOnline(phone, true);
    await waitingUpdateSync(phone);
    return { phone, ipad };
  }

  it('A4 p16: the phone\'s area change does not go over the iPad\'s note; it goes to Review Conflicts, which says what changed where', async () => {
    const { phone } = await a4p16();
    expect(inCloud()).toEqual({ notes: IPAD_NOTE, area: 'Area 0', photos: ['p0'] });
    const conflicts = await conflictsOf(phone);
    expect(conflicts).toEqual([expect.objectContaining({ entity: 'project_update', localId: UPDATE_ID })]);
    expect(fieldUpdateConflictChanges(conflicts[0].localPayload, conflicts[0].remotePayload))
      .toBe('Changed on this phone: Area. Changed on another device: Note.');
    expect(card(phone)).toMatchObject({ notes: 'Pour', area: 'Area B' }); // Needs Review: the phone's own work stays on its card
    expect(card(phone)?.status).not.toBe('sent');
  });

  it('nothing automatic sends it: Retry Sync, Sync Now, the waiting-update sync and a relaunch leave the iPad\'s note in the cloud', async () => {
    const { phone } = await a4p16();
    await backgroundUpload(phone);
    await fullSync(phone);
    await waitingUpdateSync(phone);
    relaunchModules(phone);
    await startup(phone);
    await waitingUpdateSync(phone);
    expect(inCloud()).toEqual({ notes: IPAD_NOTE, area: 'Area 0', photos: ['p0'] });
    expect(await conflictsOf(phone)).toHaveLength(1);
  });

  it('Keep Cloud: the phone shows the iPad\'s note and the area as it was, everywhere; Keep Phone: the phone\'s copy, as David chose', async () => {
    const kept = await a4p16();
    await chooseInSettings(kept.phone, (await conflictsOf(kept.phone))[0].id, 'keep_cloud');
    await refresh(kept.ipad);
    expect([card(kept.phone), card(kept.ipad), inCloud()].map(copy => copy && [copy.notes, copy.area])).toEqual(Array(3).fill([IPAD_NOTE, 'Area 0']));
    expect(await conflictsOf(kept.phone)).toEqual([]);

    const chosen = await a4p16();
    await chooseInSettings(chosen.phone, (await conflictsOf(chosen.phone))[0].id, 'keep_local');
    await refresh(chosen.ipad);
    expect([card(chosen.phone), card(chosen.ipad), inCloud()].map(copy => copy && [copy.notes, copy.area])).toEqual(Array(3).fill(['Pour', 'Area B']));
    expect(await conflictsOf(chosen.phone)).toEqual([]);
  });

  it('only the phone changed it: its edit goes up exactly as before, with no conflict card', async () => {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ selectedAreaId: 'area-b', selectedAreaName: 'Area B', notes: PHONE_NOTE }));
    setOnline(phone, true);
    await waitingUpdateSync(phone);
    await refresh(ipad);
    expect([card(phone), card(ipad), inCloud()].map(copy => copy && [copy.notes, copy.area])).toEqual(Array(3).fill([PHONE_NOTE, 'Area B']));
    expect(card(phone)?.status).toBe('sent');
    expect([await conflictsOf(phone), await queueOf(phone)]).toEqual([[], []]);
  });

  it('the copy the edit started from lasts through a relaunch: opened, relaunched, saved offline, relaunched again, it still goes to Review Conflicts', async () => {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    cardFails(phone);
    await openOnly(phone);
    relaunchModules(phone);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    await saveOpened(phone, () => ({ selectedAreaId: 'area-b', selectedAreaName: 'Area B' }));
    relaunchModules(phone);
    setOnline(phone, true);
    await startup(phone);
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, area: 'Area 0' });
    expect(await conflictsOf(phone)).toEqual([expect.objectContaining({ entity: 'project_update' })]);
  });

  it('an edit queued by Build 229 (no base) goes up as before: the phone\'s copy over the iPad\'s note, last save wins', async () => {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ selectedAreaId: 'area-b', selectedAreaName: 'Area B' }));
    asBuild229(phone);
    setOnline(phone, true);
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: 'Pour', area: 'Area B' }); // as at b03af1c
    expect(await conflictsOf(phone)).toEqual([]);
  });

  it('a copy whose own change the cloud already has (both took the photo off) is settled by the cloud\'s copy, also on the waiting-update sync', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    cardFails(phone);
    await openAndSave(phone, card => ({ selectedAreaId: 'area-b', selectedAreaName: 'Area B', photos: card.photos.filter((photo: { id: string }) => photo.id !== 'p0') }));
    expect(inCloud()).toEqual({ notes: 'Pour', area: 'Area B', photos: [] });
    at('2026-09-08T09:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, card => ({ photos: card.photos.filter((photo: { id: string }) => photo.id !== 'p0') })); // the iPad never heard the phone's area
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await waitingUpdateSync(ipad); // its card still reads waiting: staged again, it is settled again, not sent whole
    await refresh(ipad);
    expect(inCloud()).toEqual({ notes: 'Pour', area: 'Area B', photos: [] });
    expect(card(ipad)).toMatchObject({ area: 'Area B', photos: [], status: 'sent' });
    expect(await conflictsOf(ipad)).toEqual([]);
  });

  it('Sync Now on a phone that had not heard the iPad\'s photo and note leaves them in the cloud (its Sent card is not sent over them)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, card => ({ notes: IPAD_NOTE, photos: [...card.photos, newPhoto('ipad', 'p1', new Date().toISOString())] }));
    expect(inCloud()).toEqual({ notes: IPAD_NOTE, area: 'Area 0', photos: ['p0', 'p1'] });
    at('2026-09-08T09:00:00.000Z');
    relaunchModules(phone); // nothing held in memory of what the phone last put in the cloud
    await fullSync(phone);
    await refresh(phone);
    expect(inCloud()).toEqual({ notes: IPAD_NOTE, area: 'Area 0', photos: ['p0', 'p1'] });
    expect(card(phone)).toMatchObject({ notes: IPAD_NOTE, photos: ['p0', 'p1'] });
    expect(await conflictsOf(phone)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
describe('Q28 schedule tasks: both devices\' changes kept field by field, asked only when the same field changed on both', () => {
  /**
   * The flagged case: the iPad goes offline. On the phone, lookahead L moves Framing to new dates and David types a
   * note. Later, on the offline iPad, he changes Framing's owner (or approves master G). The iPad comes back and he
   * taps Sync Now before the automatic upload. At b03af1c the iPad's copy, newer, went up whole: the note and the
   * lookahead dates were gone everywhere.
   */
  async function staleIPad({ relaunch = false, offlineMaster = false, build229 = false } = {}) {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at(L.importedAt!);
    await approve(phone, L, [L_ROW], true);
    shareDocuments(phone);
    at('2026-09-10T14:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    expect(onWeb()).toEqual([['10/18/2026', '10/28/2026', 0, PHONE_NOTE, '']]);
    at('2026-09-10T18:00:00.000Z');
    if (offlineMaster) {
      await approve(ipad, G, [F_ROW.replace('10/25/2026,', '10/25/2026,10'), SURVEY]); // master G offline: the same dates, 10%
    } else {
      await edit(ipad, theRow(ipad).id, { owner: 'Mike' });
    }
    if (build229) asBuild229(ipad);
    at('2026-09-11T08:00:00.000Z');
    if (relaunch) relaunchModules(ipad);
    setOnline(ipad, true);
    await fullSync(ipad, false); // Sync Now, before the automatic upload
    await backgroundUpload(ipad);
    await refresh(phone);
    await refresh(ipad);
    return { phone, ipad };
  }

  it('the flagged case: the stale iPad\'s Sync Now keeps the phone\'s note and the lookahead dates, and the iPad\'s owner', async () => {
    const { phone, ipad } = await staleIPad();
    const expected = [['10/18/2026', '10/28/2026', 0, PHONE_NOTE, 'Mike']];
    expect([onWeb(), onDevice(phone), onDevice(ipad)]).toEqual([expected, expected, expected]);
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('the same after a relaunch, when Sync Now runs before the automatic upload', async () => {
    const { phone, ipad } = await staleIPad({ relaunch: true });
    const expected = [['10/18/2026', '10/28/2026', 0, PHONE_NOTE, 'Mike']];
    expect([onWeb(), onDevice(phone), onDevice(ipad)]).toEqual([expected, expected, expected]);
  });

  it('the same when the iPad approved another master offline: its copy of the task does not bring back the old note', async () => {
    const { phone, ipad } = await staleIPad({ offlineMaster: true });
    expect(framingOf(cloudItems()).every(item => item.notes === PHONE_NOTE)).toBe(true);
    expect([onDevice(phone), onDevice(ipad)].map(rows => rows.map(row => row[3]))).toEqual([[PHONE_NOTE], [PHONE_NOTE]]);
  });

  it('an edit queued by Build 229 (no base) goes up as before: the iPad\'s whole copy wins', async () => {
    const { phone } = await staleIPad({ build229: true });
    expect(onWeb()).toEqual([['10/15/2026', '10/25/2026', 0, '', 'Mike']]); // as at b03af1c
    expect(onDevice(phone)).toEqual(onWeb());
  });

  /** The same field on both: the phone, offline, types a note and an owner; the iPad types another note. */
  async function sameField() {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE, owner: 'Mike' });
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: IPAD_NOTE, contractor: 'Acme' });
    at('2026-09-08T10:00:00.000Z');
    setOnline(phone, true);
    await backgroundUpload(phone);
    return { phone, ipad };
  }

  it('the same field changed on both asks: Review Conflicts shows the note on each side; the owner goes up now', async () => {
    const { phone } = await sameField();
    expect(cloudRow(theRow(phone).id)).toMatchObject({ notes: IPAD_NOTE, owner: 'Mike', contractor: 'Acme' });
    const conflicts = await conflictsOf(phone);
    expect(conflicts).toEqual([expect.objectContaining({ entity: 'schedule_item' })]);
    expect(scheduleItemConflictFields(conflicts[0].localPayload)).toEqual(['notes']);
    expect(scheduleItemConflictCopyOfFields((conflicts[0].localPayload as { itemData: ScheduleItem }).itemData, ['notes'])).toBe(`Note: ${PHONE_NOTE}`);
    expect(scheduleItemConflictCopyOfFields(conflicts[0].remotePayload, ['notes'])).toBe(`Note: ${IPAD_NOTE}`);
    // A percent entered later is no choice about the note: the card stays.
    await edit(phone, theRow(phone).id, { percentComplete: 20 });
    expect(await conflictsOf(phone)).toHaveLength(1);
  });

  it('Keep Phone sends only the note (not the phone\'s old contractor); Keep Cloud keeps the iPad\'s note', async () => {
    const kept = await sameField();
    await chooseInSettings(kept.phone, (await conflictsOf(kept.phone))[0].id, 'keep_local');
    expect(cloudRow(theRow(kept.phone).id)).toMatchObject({ notes: PHONE_NOTE, owner: 'Mike', contractor: 'Acme' });
    await refresh(kept.phone); await refresh(kept.ipad);
    expect([onDevice(kept.phone), onDevice(kept.ipad)]).toEqual([onWeb(), onWeb()]);
    expect(await conflictsOf(kept.phone)).toEqual([]);

    const cloud = await sameField();
    await chooseInSettings(cloud.phone, (await conflictsOf(cloud.phone))[0].id, 'keep_cloud');
    expect(cloudRow(theRow(cloud.phone).id)).toMatchObject({ notes: IPAD_NOTE, owner: 'Mike', contractor: 'Acme' });
    expect(onDevice(cloud.phone)).toEqual([['10/15/2026', '10/25/2026', 0, IPAD_NOTE, 'Mike']]);
    expect(await conflictsOf(cloud.phone)).toEqual([]);
  });

  it('different fields merge: the phone\'s owner and the iPad\'s note are both kept, with no card', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: IPAD_NOTE });
    at('2026-09-08T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { owner: 'Mike' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(phone); await refresh(ipad);
    const expected = [['10/15/2026', '10/25/2026', 0, IPAD_NOTE, 'Mike']];
    expect([onWeb(), onDevice(phone), onDevice(ipad)]).toEqual([expected, expected, expected]);
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('a percent on both devices is never asked about: its own rules decide (David\'s later entry), with the note asked alone', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 40, notes: PHONE_NOTE });
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 60, notes: IPAD_NOTE });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(phone); await refresh(ipad);
    expect(onWeb()).toEqual([['10/15/2026', '10/25/2026', 60, PHONE_NOTE, '']]);
    const conflicts = await conflictsOf(ipad);
    expect(conflicts.map(conflict => scheduleItemConflictFields(conflict.localPayload))).toEqual([['notes']]);
    expect([onDevice(phone), onDevice(ipad)].map(rows => rows[0][2])).toEqual([60, 60]);
  });

  it('two notes typed on the offline phone are one edit: it started from the cloud\'s note, so it goes up with no card', async () => {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: 'First try' });
    at('2026-09-08T08:05:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    setOnline(phone, true);
    await backgroundUpload(phone);
    await refresh(ipad);
    expect([onWeb(), onDevice(ipad)].map(rows => rows[0][3])).toEqual([PHONE_NOTE, PHONE_NOTE]);
    expect(await conflictsOf(phone)).toEqual([]);
  });

  it('a second field asked about joins the first on the card: the note asked earlier is not dropped', async () => {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: IPAD_NOTE });
    setOnline(phone, true);
    await backgroundUpload(phone); // asks about the note
    setOnline(phone, false);
    at('2026-09-08T10:00:00.000Z');
    await edit(phone, theRow(phone).id, { owner: 'Mike' });
    at('2026-09-08T11:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { owner: 'Ana' });
    setOnline(phone, true);
    await backgroundUpload(phone); // asks about the owner too
    const conflicts = await conflictsOf(phone);
    expect(conflicts.map(conflict => scheduleItemConflictFields(conflict.localPayload))).toEqual([['notes', 'owner']]);
    expect(scheduleItemConflictCopyOfFields((conflicts[0].localPayload as { itemData: ScheduleItem }).itemData, ['notes', 'owner']))
      .toBe(`Note: ${PHONE_NOTE} · Owner: Mike`);
  });

  it('David\'s later percent stands over an older one the offline iPad sends later, as the merge has it', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { percentComplete: 60 });
    at('2026-09-08T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { percentComplete: 40 });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(phone); await refresh(ipad);
    expect([onWeb(), onDevice(phone), onDevice(ipad)].map(rows => rows[0][2])).toEqual([40, 40, 40]);
    expect(await conflictsOf(ipad)).toEqual([]);
  });

  it('a whole copy waiting on the iPad (master G approved offline) shows the phone\'s note at the refresh before it goes up', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-10T14:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    at(G.importedAt!);
    await approve(ipad, G, [F_ROW.replace('10/25/2026,', '10/25/2026,10'), SURVEY]);
    setOnline(ipad, true);
    await refresh(ipad, false); // the refresh runs before the upload
    expect(onDevice(ipad).map(row => row[3])).toEqual([PHONE_NOTE]);
  });

  it('a whole copy that keeps the cloud\'s owner is stamped now: the iPad\'s older copy does not win the next Full Sync', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, theRow(phone).id, { owner: 'Mike' });
    at(L.importedAt!);
    await approve(ipad, L, [L_ROW], true); // offline, later than the owner, from the iPad's copy without it
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await fullSync(ipad);
    await refresh(phone);
    const expected = [['10/18/2026', '10/28/2026', 0, '', 'Mike']];
    expect([onWeb(), onDevice(phone), onDevice(ipad)]).toEqual([expected, expected, expected]);
  });

  it('Full Sync\'s download apply shows a task edit still waiting over the cloud\'s row (App.tsx\'s own apply)', () => {
    const device = newDevice('phone');
    const cloud = { ...cloudTaskRow(), notes: IPAD_NOTE, owner: 'Ana', updatedAt: '2026-09-08T09:00:00.000Z' };
    device.state = [{ ...cloudTaskRow(), owner: 'Mike', updatedAt: '2026-09-08T10:00:00.000Z' }];
    const apply = compiled<(recovered: unknown) => void>(`module.exports = (recovered) => { const failed = recovered.collectionErrors; ${FULL_SYNC_APPLY_SOURCE} };`, {
      normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
      setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
      markScheduleItemsAuthorityReady: () => undefined, recordScheduleCloudPull: async () => undefined, ...rebaseDep(device),
    });
    apply({
      collectionErrors: { scheduleItems: null }, scheduleItems: [cloud], tombstones: [],
      scheduleItemEditsWaiting: [{ id: cloud.id, itemData: device.state[0], changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' } }, inConflict: false }],
    });
    // The iPad's note and the phone's waiting owner; without it, the phone's copy (newer in its stamp) kept its old note.
    expect(device.state.map(item => [item.notes, item.owner])).toEqual([[IPAD_NOTE, 'Mike']]);
  });

  it('App.tsx passes the copy each queued task edit started from: the edit, the approval, a lookahead deleted, Set Active\'s carry', () => {
    expect(APP).toContain('void syncScheduleItemRevision(updated, syncGeneration, changedFields, current);');
    expect(APP).toContain('void queueScheduleItemRecord(updated, true, changedFields, current)');
    expect(APP).toContain('scheduleItemsBefore: scheduleItemsCurrentRef.current,');
    expect(APP.match(/void syncScheduleItemRevision\(item, advanceScheduleItemSyncGeneration\(item\.id\), undefined, shownBefore\.get\(item\.id\)\)/g)).toHaveLength(2);
    expect(APP).toContain('const result = await runScheduleItemCloudSync(item, changedFields, before, followUp);'); // with the follow-up mark (review N1)
  });

  it('the copy a task edit started from lasts through a relaunch', async () => {
    const { phone, ipad } = await start();
    setOnline(ipad, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { owner: 'Mike' }); // later than the phone's note, on the iPad that never heard it
    relaunchModules(ipad);
    setOnline(ipad, true);
    await startup(ipad, false);
    expect(onDevice(ipad).map(row => row[3])).toEqual([PHONE_NOTE]); // the startup load keeps no old copy of the note
    await fullSync(ipad);
    expect(onWeb()).toEqual([['10/15/2026', '10/25/2026', 0, PHONE_NOTE, 'Mike']]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
describe('Q28 task bases, one by one', () => {
  const task = (patch: Partial<ScheduleItem>) => ({
    id: 't', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026',
    milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...patch,
  }) as ScheduleItem;
  const entry = (id: string) => ({ id, message: id, author: 'David', createdAt: '2026-09-02T00:00:00.000Z' });

  it('the activity log both devices added to keeps both devices\' entries, with no card', () => {
    const before = task({ activity: [entry('a')] });
    const here = task({ activity: [entry('a'), entry('phone')] });
    const cloud = task({ activity: [entry('a'), entry('ipad')] });
    const weighed = scheduleItemEditAgainstCloud(here, ['activity'], scheduleItemEditBase(before, ['activity']), cloud);
    expect(weighed.asked).toEqual([]);
    expect((weighed.itemData.activity || []).map(item => item.id)).toEqual(['a', 'ipad', 'phone']);
  });

  it('the hand links\' stamp (owner answer Q29) goes with the links: held back when the links are asked about, the cloud\'s with the cloud\'s links', () => {
    const link = (id: string) => [{ predecessorId: id, type: 'FS' }];
    const before = task({ dependencies: link('a') as never, dependenciesUpdatedAt: '2026-09-01T00:00:00.000Z' } as never);
    const here = task({ dependencies: link('phone') as never, dependenciesUpdatedAt: '2026-09-02T00:00:00.000Z' } as never);
    const cloud = task({ dependencies: link('ipad') as never, dependenciesUpdatedAt: '2026-09-03T00:00:00.000Z' } as never);
    const fields = ['dependencies', 'dependenciesUpdatedAt', 'updatedAt'];
    const asked = scheduleItemEditAgainstCloud(here, fields, scheduleItemEditBase(before, fields), cloud);
    expect([asked.asked, asked.held, asked.keptFromCloud]).toEqual([['dependencies'], ['dependenciesUpdatedAt'], []]);
    const back = task({ dependencies: link('a') as never, dependenciesUpdatedAt: '2026-09-02T00:00:00.000Z' } as never);
    const kept = scheduleItemEditAgainstCloud(back, fields, scheduleItemEditBase(before, fields), cloud);
    expect([kept.asked, kept.keptFromCloud]).toEqual([[], ['dependencies', 'dependenciesUpdatedAt']]);
  });

  it('a field an edit queued by Build 229 changed keeps no base when a newer edit joins it; the others keep the first edit\'s', () => {
    const old = { changedFields: ['notes', 'updatedAt'] };
    const newer = { changedFields: ['notes', 'owner', 'updatedAt'], base: { updatedAt: null, fields: { notes: 'typed before', owner: '' } } };
    expect(scheduleItemEditBasesMerged(old, newer)).toEqual({ updatedAt: null, fields: { owner: '' } });
    const first = { changedFields: ['notes', 'updatedAt'], base: { updatedAt: 'x', fields: { notes: 'cloud' } } };
    expect(scheduleItemEditBasesMerged(first, newer)).toEqual({ updatedAt: 'x', fields: { notes: 'cloud', owner: '' } });
  });

  it('after the first part of a queued edit landed, a newer edit merged meanwhile starts from what landed', () => {
    const current = { changedFields: ['notes', 'owner'], base: { updatedAt: null, fields: { notes: '', owner: '' } }, itemData: task({ notes: 'B', owner: 'Mike' }) };
    const landed = { changedFields: ['notes', 'updatedAt'], itemData: task({ notes: 'A', updatedAt: '2026-09-03T00:00:00.000Z' }) };
    expect(scheduleItemEditBaseAfterLanding(current, landed)).toEqual({ updatedAt: '2026-09-03T00:00:00.000Z', fields: { notes: 'A', owner: '' } });
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Review pass 1, finding 1 (High, caused by 79a5ae1). After each change typed in the task editor the app sent the task
 * again 700 ms later, on Save and when it went to the background: WHOLE, with no copy it started from. Equal to the
 * cloud's row, that copy closed every card of the task in Review Conflicts; otherwise the older whole-copy conflict
 * took the card's place. The note David typed offline, waiting in the card for his choice, was then in no card, on no
 * device and not in the cloud, with no alert. The follow-up send now queues nothing (what waits goes as it was queued,
 * with its base), and a whole copy never closes or replaces a card of fields.
 */
describe('Review N1 finding 1: a card in Review Conflicts stays until David chooses, whatever the task editor sends afterwards', () => {
  /** The phone's offline note meets the iPad's note: Review Conflicts asks about the note on the phone. */
  async function noteCard() {
    const { phone, ipad } = await start();
    setOnline(phone, false);
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, theRow(phone).id, { notes: PHONE_NOTE });
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: IPAD_NOTE });
    at('2026-09-08T10:00:00.000Z');
    setOnline(phone, true);
    await backgroundUpload(phone);
    await refresh(phone);
    return { phone, ipad, id: theRow(phone).id };
  }
  const cards = async (device: Device) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'schedule_item')
    .map(conflict => [scheduleItemConflictFields(conflict.localPayload), (conflict.localPayload as { itemData: ScheduleItem }).itemData.notes, (conflict.remotePayload as ScheduleItem).notes]);

  it.each([
    ['the owner', { owner: 'Bob' }, { owner: 'Bob' }],
    ['the percent', { percentComplete: 40 }, { percentComplete: 40 }],
  ] as Array<[string, Partial<ScheduleItem>, Partial<ScheduleItem>]>)(
    'the card about the note stays when David then changes %s online: the upload lands, the phone hears its write, the follow-up fires, he taps Save',
    async (_what, change, landed) => {
      const { phone, id } = await noteCard();
      expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
      at('2026-09-08T11:00:00.000Z');
      const followUp = await typed(phone, id, change);
      expect(cloudRow(id)).toMatchObject({ notes: IPAD_NOTE, ...landed }); // his change went up; the note waits for his choice
      expect(followUp).toMatchObject({ uploaded: 0, queued: 0, conflicts: 1 }); // "choose which task copy to keep"
      expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
      expect(await queueOf(phone)).toEqual([]);
      expect(await saveInEditor(phone, id)).toMatchObject({ conflicts: 1 });
      expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
      // Keep Phone still has the note to send (Review Conflicts reads the cards' cloud copies again as it opens).
      await phone.m.sync.refreshScheduleItemConflictCloudCopies();
      await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_local');
      expect(cloudRow(id)).toMatchObject({ notes: PHONE_NOTE, ...landed });
      expect(await conflictsOf(phone)).toEqual([]);
    });

  it('online but not yet told of the iPad\'s note: what David types is asked about, and Save leaves the card', async () => {
    const { phone, ipad } = await start();
    const id = theRow(phone).id;
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, id, { notes: IPAD_NOTE });
    at('2026-09-08T10:00:00.000Z');
    const followUp = await typed(phone, id, { notes: PHONE_NOTE }); // the phone hears its own upload's write: it shows the cloud's row
    expect(onDevice(phone).map(row => row[3])).toEqual([IPAD_NOTE]);
    expect(followUp).toMatchObject({ uploaded: 0, conflicts: 1 });
    expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
    await echoes(phone);
    await refresh(phone);
    expect(await saveInEditor(phone, id)).toMatchObject({ conflicts: 1 }); // was: the whole task, equal to the cloud's row, closed the card
    expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]); // the note he typed is still his to keep
    expect(cloudRow(id)).toMatchObject({ notes: IPAD_NOTE });
  });

  it('the follow-up queues nothing: after the upload landed and before the phone heard it, no whole copy goes and no card appears (finding 5)', async () => {
    const { phone, ipad } = await start();
    const id = theRow(phone).id;
    at('2026-09-08T09:00:00.000Z');
    await edit(ipad, id, { owner: 'Mike' }); // the phone has not heard this
    at('2026-09-08T10:00:00.000Z');
    const writes = mockCloud.writes.length;
    const followUp = await typed(phone, id, { notes: 'Crew' }, 'nothing');
    expect(followUp).toMatchObject({ uploaded: 1, queued: 0, conflicts: 0 });
    expect(mockCloud.writes.slice(writes)).toEqual([`phone:${id}`]); // the note, once
    expect(await conflictsOf(phone)).toEqual([]); // was: "This task changed on another device before the local edit finished syncing."
    expect(cloudRow(id)).toMatchObject({ notes: 'Crew', owner: 'Mike' });
    // Offline, the follow-up leaves the edit waiting as it was queued, with its fields and base.
    setOnline(phone, false);
    expect(await typed(phone, id, { notes: 'Crew short' })).toMatchObject({ uploaded: 0, queued: 1, conflicts: 0 });
    expect((await queueOf(phone)).map(item => [(item.payload as { changedFields?: string[] }).changedFields, (item.payload as { base?: { fields: unknown } }).base?.fields]))
      .toEqual([[['notes', 'updatedAt'], { notes: 'Crew' }]]);
  });

  it('a whole copy of the task never closes or replaces the card: one equal to the cloud\'s row, and one that ends in the older conflict', async () => {
    const { phone, id } = await noteCard();
    // As a queue item of Build 229, or the editor's follow-up before this fix: the whole task, no base, equal to the cloud's row.
    on(phone);
    await phone.m.sync.runScheduleItemCloudSync(theRow(phone));
    expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
    // A whole copy the cloud's newer row outranks (a lookahead deleted offline, seed 911116): the older conflict keeps the card's note.
    on(phone);
    await phone.m.sync.runScheduleItemCloudSync({ ...theRow(phone), contractor: 'Old Co', updatedAt: '2026-09-07T13:00:00.000Z' });
    const open = await conflictsOf(phone);
    expect(open).toEqual([expect.objectContaining({ reason: 'This task changed on another device before the local edit finished syncing.' })]);
    expect(await cards(phone)).toEqual([[['notes'], PHONE_NOTE, IPAD_NOTE]]);
    expect((open[0].localPayload as { itemData: ScheduleItem; changedFields?: unknown }).changedFields).toBeUndefined(); // still a whole copy
    await chooseInSettings(phone, open[0].id, 'keep_local');
    expect(cloudRow(id)).toMatchObject({ notes: PHONE_NOTE, contractor: 'Old Co' });
    expect(await conflictsOf(phone)).toEqual([]);
  });

  it('a whole copy waiting in the card takes what David changes afterwards: Keep Phone does not put the older owner back', async () => {
    const { phone, id } = await noteCard();
    on(phone);
    await phone.m.sync.runScheduleItemCloudSync({ ...theRow(phone), contractor: 'Old Co', updatedAt: '2026-09-07T13:00:00.000Z' });
    at('2026-09-08T11:00:00.000Z');
    await typed(phone, id, { owner: 'Bob' }); // lands; the card about the note stays, with the whole copy
    const [open] = await conflictsOf(phone);
    expect((open.localPayload as { itemData: ScheduleItem }).itemData).toMatchObject({ notes: PHONE_NOTE, owner: 'Bob', contractor: 'Old Co' });
    on(phone);
    await phone.m.sync.refreshScheduleItemConflictCloudCopies();
    await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_local');
    expect(cloudRow(id)).toMatchObject({ notes: PHONE_NOTE, owner: 'Bob', contractor: 'Old Co' });
  });

  it('App.tsx: the debounce, Save and the background flush send the follow-up, which queues nothing', () => {
    expect(APP).toContain('if (latest) void syncScheduleItemRevision(latest, readyGeneration, undefined, undefined, true);');
    expect(APP).toContain('if (latest) void syncScheduleItemRevision(latest, generation, undefined, undefined, true);');
    expect(APP).toContain('return syncScheduleItemRevision(latest, generation, undefined, undefined, true);');
    expect(APP).toContain('const result = await runScheduleItemCloudSync(item, changedFields, before, followUp);');
    // A task just added still goes whole: it has no row in the cloud yet.
    expect(APP).toContain('void syncScheduleItemRevision(next, syncGeneration);');
  });

  describe('the copy a card keeps (scheduleItemConflictCopyKeeping)', () => {
    const row = (patch: Record<string, unknown>) => ({ id: 't', taskName: 'Framing', notes: '', owner: '', contractor: '', ...patch });
    const fieldCard = { id: 't', itemData: row({ notes: 'phone note' }), changedFields: ['notes', 'updatedAt'], askedFields: ['notes'], base: { updatedAt: 'b', fields: { notes: '' } } };

    it('a whole copy over a card of fields keeps the fields asked about, with David\'s values and their base', () => {
      const whole = { id: 't', itemData: row({ notes: 'ipad note', contractor: 'Old Co' }), base: { updatedAt: 'w', fields: { notes: 'ipad note', owner: '' } } };
      expect(scheduleItemConflictCopyKeeping(fieldCard, whole, null)).toEqual({
        id: 't', itemData: row({ notes: 'phone note', contractor: 'Old Co' }), askedFields: ['notes'],
        base: { updatedAt: 'w', fields: { notes: '', owner: '' } },
      });
    });

    it('a field asked about later joins a whole copy waiting in its card: the whole copy stays, with the newer values', () => {
      const wholeCard = { id: 't', itemData: row({ contractor: 'Old Co', owner: 'Al' }) };
      const later = { id: 't', itemData: row({ notes: 'typed', owner: 'Bob' }), changedFields: ['notes', 'updatedAt'], askedFields: ['notes'], base: { updatedAt: 'n', fields: { notes: '' } } };
      const kept = scheduleItemConflictCopyKeeping(wholeCard, later, ['owner', 'updatedAt'], row({ notes: 'cloud', owner: 'Bob' }));
      expect(kept).toEqual({ id: 't', itemData: row({ contractor: 'Old Co', owner: 'Bob', notes: 'typed' }), askedFields: ['notes'], base: { updatedAt: 'n', fields: { notes: '' } } });
      expect('changedFields' in kept).toBe(false);
    });

    it('nothing is kept from a card whose fields the edit sent, or under a newer whole copy of a whole copy', () => {
      const whole = { id: 't', itemData: row({ contractor: 'New Co' }) };
      expect(scheduleItemConflictCopyKeeping({ id: 't', itemData: row({ contractor: 'Old Co' }) }, whole, null)).toBe(whole);
      const again = { id: 't', itemData: row({ notes: 'typed again' }), changedFields: ['notes', 'updatedAt'], askedFields: ['notes'], base: { updatedAt: 'n', fields: { notes: 'x' } } };
      expect(scheduleItemConflictCopyKeeping(fieldCard, again, [])).toBe(again);
      expect(scheduleItemConflictCopyKeeping(null, again, null)).toBe(again);
    });
  });
});
