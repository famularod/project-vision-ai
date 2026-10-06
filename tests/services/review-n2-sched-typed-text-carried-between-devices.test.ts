/**
 * Review N2 P1, the carry between devices (pass 2 of the next round, 5 Oct
 * 2026; older, the same on Build 229; the reviewer's seed 56). The phone
 * approves a master that moves Framing, so Framing gets a new row. The iPad,
 * which has not heard of that master, still shows the old row, and David
 * assigns Mike and types a note there. After everything synced, every device
 * showed the new row with no owner and no note: they stayed on the hidden old
 * row. His percent has a carry for this; his owner, contractor and note had
 * none.
 *
 * The sync merge now carries them to the task's newest row (a blank only,
 * and only from a row changed after the newest row last was), and the carry
 * goes up as those fields alone, filling only a blank in the cloud's row.
 *
 * Two devices and the web, one cloud, in the app's real order. The rig is the
 * one owner-answer-q28-conflicts-not-overwrite.test.ts carries (each device
 * its own storage and SyncService; App.tsx's own task edit, refresh, Full Sync
 * apply and startup load compiled from its source), copied here as that file
 * and audit-r2-a7p26-carry-upload.test.ts each carry theirs. Synthetic data.
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
  /** Writes that reach the cloud while their answer does not come back (weak signal): how many more. */
  lostAnswers: 0,
  /** The cloud's schedule documents (what the web desktop works the shown tasks out from). */
  documents: [] as unknown[],
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
      if (mockCloud.lostAnswers > 0) { mockCloud.lostAnswers -= 1; return mockDown(); }
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
    listReferenceDocuments: read(() => mockCopy(mockCloud.documents)),
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
      if (mockCloud.lostAnswers > 0) { mockCloud.lostAnswers -= 1; return mockDown(); }
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
import { scheduleItemConflictCopyOnRow, scheduleItemRowAnsweringTo, scheduleItemStampAfter, scheduleItemWholeCopyBase, scheduleItemWholeCopyRestUnchanged } from '../../services/ScheduleItemEditBase';
import { scheduleItemConflictCopyKeeping, scheduleItemConflictCopyOfFields, scheduleItemConflictFields, scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemEditBaseAfterLanding, scheduleItemEditBasesMerged } from '../../services/ScheduleItemEditBase';
import { scheduleItemChangeUsesDebouncedSync } from '../../services/ScheduleItemTextSyncLifecycle';
import { scheduleProgressUndoPoint, scheduleTalkUndo } from '../../services/ScheduleProgressSource';
import { scheduleItemFieldsWithOwnProgress, scheduleItemLaterPercentGivenBack } from '../../services/ScheduleItemEditBase';

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
  await keyed(device, itemId, change);
  const eventsBefore = mockCloud.events.length;
  await backgroundUpload(device);
  if (hears === 'own') await ownEcho(device, eventsBefore);
  jest.setSystemTime(Date.now() + 700);
  return editorFollowUp(device, itemId);
}
/** One change typed in the task editor, as far as the device itself: shown, and queued with its fields and base. */
async function keyed(device: Device, itemId: string, change: Partial<ScheduleItem>): Promise<void> {
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
  mockCloud.documents = merged;
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
  mockCloud.lostAnswers = 0;
  heard.clear();
  heardTombstones.clear();
  cloudDocuments = [];
  mockCloud.documents = [];
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
const G_ROW = 'Framing,Alpha,Lot,10/20/2026,10/30/2026,';
const NOTE = 'Crew short Tuesday';
const everywhere = async (phone: Device, ipad: Device) => { await refresh(phone); await refresh(ipad); return [onDevice(phone), onDevice(ipad), onWeb()]; };
const ON_G = (percent: number, note: string, owner: string) => Array(3).fill([['10/20/2026', '10/30/2026', percent, note, owner]]);
/** Everything delivered and uploaded, both ways, twice over. */
async function settle(phone: Device, ipad: Device) {
  for (let round = 0; round < 2; round += 1) {
    for (const device of [phone, ipad]) { await backgroundUpload(device); await echoes(device); await tombstoneEchoes(device); await refresh(device); }
  }
}
/**
 * The iPad loses signal; the phone approves master G, which moves Framing; on the iPad, still showing F's row, `typing`
 * happens; then the iPad gets signal back (its waiting edits go up, and it refreshes).
 */
async function typedOnTheOldRow(
  typing: (ipad: Device, oldId: string) => Promise<void>,
  beforeReconnect?: ((phone: Device, newId: string) => Promise<void>) | null,
  reconnects = true,
) {
  const { phone, ipad } = await start();
  const oldId = theRow(phone).id;
  at('2026-09-08T08:00:00.000Z');
  setOnline(ipad, false);
  at(G.importedAt!);
  await approve(phone, G, [G_ROW, SURVEY]);
  shareDocuments(phone);
  await backgroundUpload(phone);
  const newId = theRow(phone).id;
  expect(newId).not.toBe(oldId);
  expect(theRow(ipad).id).toBe(oldId);
  at('2026-09-11T09:00:00.000Z');
  await typing(ipad, oldId);
  if (beforeReconnect) await beforeReconnect(phone, newId);
  at('2026-09-12T08:00:00.000Z');
  setOnline(ipad, true);
  await backgroundUpload(ipad);
  if (reconnects) await refresh(ipad);
  return { phone, ipad, oldId, newId };
}
const noteAndOwner = async (ipad: Device, oldId: string) => {
  await edit(ipad, oldId, { notes: NOTE });
  at('2026-09-11T09:05:00.000Z');
  await edit(ipad, oldId, { owner: 'Mike' });
};

describe('Review N2 P1: an owner and a note typed on a device that had not heard of the master follow the task', () => {
  it('the iPad, the phone and the web show them on the task\'s new row; the old row keeps its copy; nothing is asked', async () => {
    const { phone, ipad, oldId, newId } = await typedOnTheOldRow(noteAndOwner);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, owner: 'Mike', percentComplete: 0 });
    expect(cloudRow(oldId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });

  it('once it has landed, more syncing writes nothing more, and no refresh saves the task list again', async () => {
    const { phone, ipad } = await typedOnTheOldRow(noteAndOwner);
    await settle(phone, ipad);
    const [writes, phoneSaves, ipadSaves] = [cloudWrites(), phone.saves, ipad.saves];
    await settle(phone, ipad);
    // No refresh or realtime echo saves the task list again, and nothing more goes up.
    expect([cloudWrites(), phone.saves, ipad.saves]).toEqual([writes, phoneSaves, ipadSaves]);
    await fullSync(phone);
    await fullSync(ipad);
    expect(cloudWrites()).toBe(writes);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
  });

  it('with a percent of his typed there too: the percent, the owner and the note all follow', async () => {
    const { phone, ipad } = await typedOnTheOldRow(async (ipad, oldId) => {
      await noteAndOwner(ipad, oldId);
      at('2026-09-11T09:10:00.000Z');
      await edit(ipad, oldId, { percentComplete: 30 });
    });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(30, NOTE, 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });

  it('when the iPad\'s refresh runs before its waiting edits go up (either order happens at a reconnect): shown at once, percent and all', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    await noteAndOwner(ipad, oldId);
    at('2026-09-11T09:10:00.000Z');
    await edit(ipad, oldId, { percentComplete: 30 });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await refresh(ipad, false);
    expect(onDevice(ipad)).toEqual([['10/20/2026', '10/30/2026', 30, NOTE, 'Mike']]);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(30, NOTE, 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });

  it('through Sync Now on the iPad instead of the automatic upload', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    await noteAndOwner(ipad, oldId);
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await fullSync(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });
});

describe('Review N2 P1: only a blank is filled, and a blank he left stands', () => {
  it('a note he cleared on the new row afterwards stays cleared on every device, through every later sync', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner);
    await settle(phone, ipad);
    at('2026-09-13T09:00:00.000Z');
    await edit(phone, newId, { notes: '' });
    await settle(phone, ipad);
    await fullSync(ipad);
    await fullSync(phone);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Mike'));
  });

  it('a note typed on the new row (the phone\'s) stands over the one typed on the old row; the owner, blank there, still follows', async () => {
    const { phone, ipad, oldId } = await typedOnTheOldRow(noteAndOwner, async (phone, newId) => {
      at('2026-09-11T10:00:00.000Z');
      await edit(phone, newId, { notes: 'Typed on the phone' });
    });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed on the phone', 'Mike'));
    expect(cloudRow(oldId)).toMatchObject({ notes: NOTE });
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('a percent entered on the new row meanwhile (the phone\'s) leaves its note and owner blank: they still follow, beside it', async () => {
    // A row has one time for all its fields, and it is the time the change reached the cloud: the iPad's note, typed
    // with no signal before the phone's percent, reaches the cloud after it. The blank beside the percent was never his.
    const { phone, ipad } = await typedOnTheOldRow(noteAndOwner, async (phone, newId) => {
      at('2026-09-11T12:00:00.000Z');
      await edit(phone, newId, { percentComplete: 40 });
    });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(40, NOTE, 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('the cloud\'s row is given a note between the iPad\'s merge and its upload: the cloud\'s stands, nothing is asked', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner);
    // The iPad has carried them to its copy of the new row; before that goes up, the web types a note on the new row.
    expect(onDevice(ipad)).toEqual([['10/20/2026', '10/30/2026', 0, NOTE, 'Mike']]);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
    // The same race, made by hand: the phone's copy carries too, while the cloud's row already holds another note.
    at('2026-09-12T09:00:00.000Z');
    webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed on the web' }));
    const writes = cloudWrites();
    await refresh(phone, false);
    await backgroundUpload(phone);
    expect(mockCloud.writes.slice(writes).filter(write => write.endsWith(`:${newId}`))).toEqual([]);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed on the web', 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });
});

describe('Review N2 P1: both devices carry the same owner and note', () => {
  it('one of them writes the row; the other finds it as it would write it, writes nothing and asks nothing', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner, null, false);
    // The iPad's edits of the old row are in the cloud; each device now merges, and neither has sent its carry yet.
    const writes = cloudWrites();
    await refresh(ipad, false);
    await refresh(phone, false);
    expect([onDevice(phone), onDevice(ipad)]).toEqual([[['10/20/2026', '10/30/2026', 0, NOTE, 'Mike']], [['10/20/2026', '10/30/2026', 0, NOTE, 'Mike']]]);
    await backgroundUpload(ipad);
    await backgroundUpload(phone);
    expect(mockCloud.writes.slice(writes).filter(write => write.endsWith(`:${newId}`))).toEqual([`ipad:${newId}`]);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });
});

describe('Review N2 P1: the carry waiting to go up, and what David does to the task meanwhile', () => {
  it('he types over the carried note before it has gone up: his note goes up, the carried owner with it', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner, null, false);
    await refresh(ipad, false);
    expect(theRow(ipad)).toMatchObject({ id: newId, notes: NOTE, owner: 'Mike' });
    at('2026-09-12T08:30:00.000Z');
    setOnline(ipad, false);
    await edit(ipad, newId, { notes: 'Crew back Wednesday' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Crew back Wednesday', 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('he types over the carried note while the web has typed one there too: it is his edit, and goes up as one', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner, null, false);
    await refresh(ipad, false);
    at('2026-09-12T08:30:00.000Z');
    setOnline(ipad, false);
    webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed on the web' }));
    await edit(ipad, newId, { notes: 'Crew back Wednesday' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // Not held back as a carried note would be: the cloud has what he typed, at once, and the carried owner beside it.
    expect(cloudRow(newId)).toMatchObject({ notes: 'Crew back Wednesday', owner: 'Mike' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Crew back Wednesday', 'Mike'));
  });

  it('he enters a percent on the task before the carry has gone up, and the web has typed a note there: his percent lands, the web\'s note stands', async () => {
    const { phone, ipad, newId } = await typedOnTheOldRow(noteAndOwner, null, false);
    await refresh(ipad, false);
    at('2026-09-12T08:30:00.000Z');
    setOnline(ipad, false);
    webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed on the web' }));
    await edit(ipad, newId, { percentComplete: 25 });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ notes: 'Typed on the web', owner: 'Mike', percentComplete: 25 });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(25, 'Typed on the web', 'Mike'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });
});

describe('Review N2 P1: a card waiting in Review Conflicts is not closed by the carry', () => {
  it('a whole-copy card on the task\'s new row stays until David chooses', async () => {
    const { phone, newId } = await typedOnTheOldRow(noteAndOwner, null, false);
    // The phone merges first, so the carry that goes up is the phone's own.
    await refresh(phone, false);
    expect(theRow(phone)).toMatchObject({ id: newId, notes: NOTE, owner: 'Mike' });
    // A conflict already waiting on the phone for that row (as an approval's whole copy leaves one).
    on(phone);
    const detectedAt = new Date().toISOString();
    const store = mockStores.get('phone')!;
    const key = 'projectVisionAI.syncConflicts.v1';
    store.set(key, JSON.stringify([...JSON.parse(store.get(key) || '[]'), {
      id: 'conflict-new-row', entity: 'schedule_item', localId: newId, localChangedAt: detectedAt, remoteChangedAt: null,
      reason: 'This task changed on another device before the local edit finished syncing.', detectedAt,
      localPayload: { id: newId, itemData: theRow(phone) }, remotePayload: cloudRow(newId),
    }]));
    expect((await conflictsOf(phone)).map(conflict => conflict.id)).toEqual(['conflict-new-row']);
    const writes = cloudWrites();
    await backgroundUpload(phone);
    expect(mockCloud.writes.slice(writes)).toEqual([`phone:${newId}`]);
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
    expect((await conflictsOf(phone)).map(conflict => conflict.id)).toEqual(['conflict-new-row']);
  });
});

describe('Review N2 P1: what an import on Build 229 left on a hidden row comes forward at the next sync', () => {
  /** As Build 229 saved it: the note and owner typed before the master, the master's new row blank and never changed. */
  async function strandedOnBuild229() {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T09:00:00.000Z');
    await edit(phone, oldId, { notes: NOTE });
    await edit(phone, oldId, { owner: 'Mike' });
    await settle(phone, ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    const newId = theRow(phone).id;
    // Build 229's approval left the new row blank; put that back on the phone's copy and in what it sends.
    setter(phone)(phone.state.map(item => (item.id === newId ? { ...item, notes: '', owner: '' } : item)));
    phone.ref.current = phone.state;
    on(phone);
    const queueKey = 'projectVisionAI.syncQueue.v1';
    const store = mockStores.get('phone')!;
    store.set(queueKey, JSON.stringify((JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { id?: string; itemData?: ScheduleItem } }>)
      .map(queued => (queued.payload?.id === newId && queued.payload.itemData ? { ...queued, payload: { ...queued.payload, itemData: { ...queued.payload.itemData, notes: '', owner: '' } } } : queued))));
    if (cloudRow(newId)) mockCloud.rows.set(newId, { ...cloudRow(newId)!, notes: '', owner: '' });
    shareDocuments(phone);
    return { phone, ipad, oldId, newId };
  }

  it('the task shown, never changed since its import, takes them on the phone, the iPad and the web', async () => {
    const { phone, ipad, oldId, newId } = await strandedOnBuild229();
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: '', owner: '' });
    expect(cloudRow(newId)!.updatedAt ?? null).toBeNull();
    at('2026-09-12T08:00:00.000Z');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    expect(cloudRow(oldId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });

  it('a task he has changed since the master moved it keeps its blank: his old note stays on the hidden row', async () => {
    const { phone, ipad, oldId, newId } = await strandedOnBuild229();
    await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    // (A percent entered on the new row, sent as Build 229 sent it: the row is stamped later than the old row.)
    mockCloud.rows.set(newId, { ...cloudRow(newId)!, percentComplete: 20, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-11T09:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-11T09:00:00.000Z' });
    setter(phone)(phone.state.map(item => (item.id === newId ? { ...(cloudRow(newId) as ScheduleItem) } : item)));
    phone.ref.current = phone.state;
    at('2026-09-12T08:00:00.000Z');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(20, '', ''));
    expect(cloudRow(oldId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
  });
});

describe('Review N2 P1: the merge\'s rule, on the records alone', () => {
  const row = (id: string, extra: Partial<ScheduleItem> = {}) => ({
    id, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '',
    owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', createdAt: '2026-09-07T12:00:00.000Z',
    importedAt: '2026-09-07T12:00:00.000Z', ...extra,
  }) as ScheduleItem;
  const merged = (rows: ScheduleItem[], deletedIds: string[] = []) => recoverDAVEScheduleRecords({ local: rows, cloud: rows.filter(item => !deletedIds.includes(item.id)), deletedIds, allowCloudOnly: true });
  const textOf = (rows: ScheduleItem[], id: string) => { const found = rows.find(item => item.id === id)!; return [found.owner, found.contractor, found.notes, found.updatedAt ?? null]; };
  const T1 = '2026-09-08T09:00:00.000Z', T2 = '2026-09-09T09:00:00.000Z', T3 = '2026-09-10T09:00:00.000Z';

  it('moved twice: the newest row takes them from the row changed last, and only it takes them', () => {
    const rows = [
      row('A', { notes: 'older', owner: 'Ana', updatedAt: T1 }),
      row('B', { revisedFromTaskIds: ['A'], notes: 'newer', updatedAt: T2 }),
      row('C', { revisedFromTaskIds: ['A', 'B'] }),
    ];
    const out = merged(rows);
    // From B, the row changed last: its note; its owner is blank, and A's older one is not read past it.
    expect(textOf(out, 'C')).toEqual(['', '', 'newer', null]);
    expect(textOf(out, 'B')).toEqual(['', '', 'newer', T2]);
  });

  it('the newest row keeps its own stamp, and a second merge changes nothing', () => {
    const rows = [row('A', { notes: 'typed', updatedAt: T2 }), row('B', { revisedFromTaskIds: ['A'], updatedAt: T1 })];
    const once = merged(rows);
    expect(textOf(once, 'B')).toEqual(['', '', 'typed', T1]);
    expect(merged(once)).toEqual(once);
  });

  it('not from a row changed before the newest row was, not over a value, and not when two rows answer to the old one', () => {
    expect(textOf(merged([row('A', { notes: 'typed', updatedAt: T1 }), row('B', { revisedFromTaskIds: ['A'], updatedAt: T2 })]), 'B')).toEqual(['', '', '', T2]);
    expect(textOf(merged([row('A', { notes: 'typed', updatedAt: T2 }), row('B', { revisedFromTaskIds: ['A'], notes: 'its own' })]), 'B')).toEqual(['', '', 'its own', null]);
    const twins = merged([row('A', { notes: 'typed', updatedAt: T3 }), row('B', { revisedFromTaskIds: ['A'] }), row('C', { revisedFromTaskIds: ['A'], startDate: '10/29/2026' })]);
    expect([textOf(twins, 'B')[2], textOf(twins, 'C')[2]]).toEqual(['', '']);
  });

  it('a row that was never changed lends nothing (what a file said there is not his)', () => {
    expect(textOf(merged([row('A', { owner: 'From the old file' }), row('B', { revisedFromTaskIds: ['A'] })]), 'B')).toEqual(['', '', '', null]);
  });

  it('a deleted row this sync drops lends them once', () => {
    const rows = [row('A', { notes: 'typed', owner: 'Mike', updatedAt: T2 }), row('B', { revisedFromTaskIds: ['A'] })];
    const out = merged(rows, ['A']);
    expect(out.map(item => item.id)).toEqual(['B']);
    expect(textOf(out, 'B')).toEqual(['Mike', '', 'typed', null]);
  });
});
