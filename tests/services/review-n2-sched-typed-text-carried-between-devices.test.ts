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
  /** The next write of this task's row does not reach the cloud (weak signal), once. */
  failNextWriteOf: null as string | null,
  /** Review P7-5: the next write of this row reaches the cloud, and its answer does not come back. */
  lostAnswerFor: null as string | null,
  /** The cloud's schedule documents (what the web desktop works the shown tasks out from). */
  documents: [] as unknown[],
  /**
   * Review N3 P3-1: when on, the cloud keeps each task row's version and refuses a write made against an older one,
   * as the real one does (independent review pass 2, item 1). Off for the tests written before.
   */
  versioned: false,
  versions: new Map<string, number>(),
  /** Run once, just before the next task write reaches the cloud: another device writing in that moment. */
  beforeNextTaskWrite: null as (() => void) | null,
  /** Task writes the cloud refused because the row had changed since it was read. */
  refused: [] as string[],
  /** Review N3 R3: rows the list leaves out (it pages), and rows a read by id cannot reach just now. */
  unlisted: new Set<string>(),
  unreadable: new Set<string>(),
};
const mockVersionUp = (id: string) => { mockCloud.versions.set(id, (mockCloud.versions.get(id) ?? 0) + 1); };
/** Each device loads its own modules: a row's version is kept by the copy of CloudRowVersion that device's sync service uses. */
const mockRowVersions = new Map<string, typeof import('../../services/CloudRowVersion')>();
const mockCopy = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockDown = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
const mockOnline = () => !mockCloud.offline.has(mockDevice);
const mockTick = () => { try { jest.setSystemTime(Date.now() + 1000); } catch { /* real timers */ } };
const MOCK_PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
jest.mock('../../services/SupabaseService', () => {
  const actual = jest.requireActual('../../services/SupabaseService');
  /** A task row as the cloud answers a read: with its version beside it, when the cloud keeps versions. */
  const mockRowRead = <T extends { id: string }>(row: T): T => (mockCloud.versioned
    ? mockRowVersions.get(mockDevice)!.withCloudRowVersion(mockCopy(row), String(mockCloud.versions.get(row.id) ?? 0))
    : mockCopy(row));
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
    listScheduleItems: read(() => [...mockCloud.rows.values()].filter(row => !mockCloud.unlisted.has((row as { id: string }).id)).map(row => mockRowRead(row as { id: string }))),
    listReferenceDocuments: read(() => mockCopy(mockCloud.documents)),
    getScheduleItem: async (id: string) => { mockTick(); return mockOnline() && !mockCloud.unreadable.has(id) ? mockOk(mockCloud.rows.has(id) ? mockRowRead(mockCloud.rows.get(id) as { id: string }) : null) : mockDown(); },
    // Independent review R02: several tasks' rows are read by their ids in one request, and a GPS area's row by its id.
    getScheduleItemsByIds: async (ids: string[]) => (mockOnline() && !ids.some(id => mockCloud.unreadable.has(id))
      ? mockOk(ids.flatMap(id => (mockCloud.rows.has(id) ? [mockRowRead(mockCloud.rows.get(id) as { id: string })] : []))) : mockDown()),
    getProjectAreasByIds: async () => (mockOnline() ? mockOk([]) : mockDown()),
    upsertScheduleItem: async (item: { id: string }, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }) => {
      mockTick();
      if (!mockOnline()) return mockDown();
      if (mockCloud.failNextWriteOf === item.id) { mockCloud.failNextWriteOf = null; return mockDown(); }
      if (mockCloud.versioned) {
        const meanwhile = mockCloud.beforeNextTaskWrite;
        mockCloud.beforeNextTaskWrite = null;
        if (meanwhile) meanwhile();
        if (options?.ifUnchangedSince && String(mockCloud.versions.get(item.id) ?? 0) !== options.ifUnchangedSince) {
          mockCloud.refused.push(`${mockDevice}:${item.id}`);
          return { ok: false, configured: true, stubbed: false, data: null, status: 409, error: 'The cloud copy changed.',
            code: mockRowVersions.get(mockDevice)!.CLOUD_ROW_CHANGED_SINCE_READ };
        }
      }
      mockCloud.rows.set(item.id, mockCopy(item));
      mockVersionUp(item.id);
      mockCloud.writes.push(`${mockDevice}:${item.id}`);
      mockCloud.events.push({ id: item.id, row: mockCopy(item) });
      if (mockCloud.lostAnswers > 0) { mockCloud.lostAnswers -= 1; return mockDown(); }
      if (mockCloud.lostAnswerFor === item.id) { mockCloud.lostAnswerFor = null; return mockDown(); }
      return mockOk(mockRowRead(item));
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
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted, scheduleTasksOnMasterDatesOnceLookaheadGone, type ScheduleLookaheadNotesSeen } from '../../services/ScheduleLookahead';
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
import { scheduleItemConflictCopyOfBoth, scheduleItemConflictCopyOnRow, scheduleItemRowAnsweringTo, scheduleItemStampAfter, scheduleItemWholeCopyBase, scheduleItemWholeCopyRestUnchanged } from '../../services/ScheduleItemEditBase';
import { scheduleItemConflictCopyKeeping, scheduleItemConflictCopyOfFields, scheduleItemConflictFields, scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemEditBaseAfterLanding, scheduleItemEditBasesMerged } from '../../services/ScheduleItemEditBase';
import { scheduleItemChangeUsesDebouncedSync } from '../../services/ScheduleItemTextSyncLifecycle';
import { scheduleProgressUndoPoint, scheduleTalkUndo } from '../../services/ScheduleProgressSource';
import { scheduleItemFieldsWithOwnProgress, scheduleItemLaterPercentGivenBack } from '../../services/ScheduleItemEditBase';
import { scheduleItemAgainstItsTask, scheduleItemAsOwnWaitingEditLeavesIt, scheduleItemNewRowMetAgain, scheduleItemTextEditOnRow, scheduleTaskOfRowId, scheduleItemWholeCopyAgainstCloud, scheduleItemWholeCopyOverCloud } from '../../services/ScheduleItemEditBase';
import { scheduleItemChangedSinceMade, scheduleItemEditBaseOf, scheduleItemWholeCopyBaseSinceMade, scheduleItemWholeCopyFieldByField, SCHEDULE_ITEM_AS_MADE } from '../../services/ScheduleItemEditBase';
import { scheduleItemAsLastSetOnItsOtherRow } from '../../services/ScheduleItemEditBase';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectControls } from '../../types';

/* Per-device module sets --------------------------------------------------- */
type SyncModule = typeof import('../../services/SyncService');
type Mods = {
  sync: SyncModule;
  carry: typeof import('../../services/ScheduleProgressCarryUpload');
  tomb: typeof import('../../services/DAVESyncTombstones');
  realtime: typeof import('../../services/DAVEOperationalRealtimeApplication');
  removed: typeof import('../../services/FieldUpdateRemovedDocuments');
  versions: typeof import('../../services/CloudRowVersion');
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
      versions: require('../../services/CloudRowVersion'),
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
  /** What App.tsx keeps in a ref between two runs of the S5 item 2 effect, and what that effect last ran on. */
  lookaheadNotesSeen: ScheduleLookaheadNotesSeen;
  lookaheadGoneSeen?: [ScheduleItem[], ReferenceDocument[]];
};
function newDevice(name: DeviceName): Device {
  mockDevice = name;
  const m = loadMods();
  return { name, m, state: [], ref: { current: [] }, documents: [], saves: 0, generation: new Map(), effectsSeen: null, pendingEffects: [],
    updates: [], updatesRef: { current: [] }, updateSaves: 0, draftRef: { current: { id: '', status: 'draft' } }, lookaheadNotesSeen: { current: null } };
}
const on = (device: Device) => { mockDevice = device.name; mockRowVersions.set(device.name, device.m.versions); };
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
/**
 * App.tsx's own effect line of schedule batch S5, item 2 (a lookahead's deletion heard from another device runs the
 * date recompute Set Active uses), run as React runs it: whenever the tasks or the schedules have changed.
 */
const LOOKAHEAD_GONE_EFFECT_LINE = APP.split('\n').find(line => line.includes('useEffect(') && line.includes('scheduleTasksOnMasterDatesOnceLookaheadGone(')) ?? null;
async function lookaheadGoneEffect(device: Device) {
  if (!LOOKAHEAD_GONE_EFFECT_LINE || (device.lookaheadGoneSeen?.[0] === device.state && device.lookaheadGoneSeen?.[1] === device.documents)) return;
  device.lookaheadGoneSeen = [device.state, device.documents];
  on(device);
  compiled(`module.exports = null; ${LOOKAHEAD_GONE_EFFECT_LINE}`, {
    useEffect: (effect: () => void) => effect(), startupHydrationReady: true, scheduleItemsLoaded: true,
    scheduleItems: device.state, referenceDocuments: device.documents, lookaheadNotesSeenRef: device.lookaheadNotesSeen,
    scheduleTasksOnMasterDatesOnceLookaheadGone, scheduleItemsCurrentRef: device.ref, setScheduleItems: setter(device),
    advanceScheduleItemSyncGeneration: (id: string) => { const next = (device.generation.get(id) || 0) + 1; device.generation.set(id, next); return next; },
    syncScheduleItemRevision: (item: ScheduleItem, _generation: number, changedFields?: readonly (keyof ScheduleItem)[], before?: ScheduleItem) => {
      device.pendingEffects.push((device.m.sync.runScheduleItemCloudSync as (...args: unknown[]) => Promise<unknown>)(item, changedFields, before));
    },
  });
  await Promise.all(device.pendingEffects.splice(0));
  device.ref.current = device.state;
}
async function render(device: Device) {
  device.ref.current = device.state;
  device.updatesRef.current = device.updates;
  await lookaheadGoneEffect(device);
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
  device.lookaheadNotesSeen = { current: null };
  device.lookaheadGoneSeen = undefined;
}

/* Tasks ---------------------------------------------------------------------- */
// (A first line that starts "Task," is the file's own header: a schedule with more columns, an Owner column say.)
const rowsOf = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: [...(lines[0]?.startsWith('Task,') ? [] : ['Task,Project,Area,Start,Finish,Percent Complete']), ...lines].join('\n'), sourceName: source.originalFileName,
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
  mockVersionUp(item.id);
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
  mockCloud.failNextWriteOf = null;
  mockCloud.lostAnswerFor = null;
  mockCloud.versioned = false;
  mockCloud.versions.clear();
  mockCloud.beforeNextTaskWrite = null;
  mockCloud.refused.length = 0;
  mockCloud.unlisted.clear();
  mockCloud.unreadable.clear();
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
/**
 * The rows of the master just approved on this device as Build 229 saved them: with no record of what each took from
 * the row it replaces (textFromTask), in the device's list and in what waits to go up.
 */
function masterRowsAsBuild229SavedThem(device: Device) {
  // (Nor did Build 229 mark what is typed on a row: way 2's record of what the row was made with goes too.)
  const plain = (row: ScheduleItem) => { const { textFromTask: _taken, textAsMade: _made, ...rest } = row; return rest as ScheduleItem; };
  setter(device)(device.state.map(plain));
  device.ref.current = device.state;
  const store = mockStores.get(device.name)!;
  const queueKey = 'projectVisionAI.syncQueue.v1';
  const queued = JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { itemData?: ScheduleItem } }>;
  store.set(queueKey, JSON.stringify(queued.map(item => (item.payload?.itemData ? { ...item, payload: { ...item.payload, itemData: plain(item.payload.itemData) } } : item))));
}
/**
 * A carry that has to wait. The sync's carry is for a task's new row that keeps no record of what it took: one a master
 * approved on Build 229 saved. (Review P4 F1: a row that keeps the record is weighed from it when it first goes up and
 * takes what the task has by then; review N3 R3: an edit typed on a replaced row goes on with its own upload.) Here the
 * iPad, with signal, types the note and the owner on the task; the phone, with none and not having heard, approves
 * master G as Build 229 did, so the task's new row is blank and says nothing of what it took, and sends it when it is
 * back. The sync merge carries the note and the owner to it, on whichever device merges next.
 */
async function typedBeforeTheMasterArrived() {
  const { phone, ipad } = await start();
  const oldId = theRow(phone).id;
  at('2026-09-08T08:00:00.000Z');
  setOnline(phone, false);
  at('2026-09-09T09:00:00.000Z');
  await edit(ipad, oldId, { notes: NOTE });
  at('2026-09-09T09:05:00.000Z');
  await edit(ipad, oldId, { owner: 'Mike' });
  await backgroundUpload(ipad);
  at(G.importedAt!);
  await approve(phone, G, [G_ROW, SURVEY]);
  masterRowsAsBuild229SavedThem(phone);
  const newId = theRow(phone).id;
  at('2026-09-12T08:00:00.000Z');
  setOnline(phone, true);
  shareDocuments(phone);
  await backgroundUpload(phone);
  expect(cloudRow(newId)).toMatchObject({ notes: '', owner: '' });
  expect(cloudRow(newId)).not.toHaveProperty('textFromTask');
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

  it('a note typed on the new row (the phone\'s) and one typed on the old row by the iPad that had not heard: he is asked; the owner, blank there, still follows', async () => {
    const { phone, ipad, oldId, newId } = await typedOnTheOldRow(noteAndOwner, async (phone, newId) => {
      at('2026-09-11T10:00:00.000Z');
      await edit(phone, newId, { notes: 'Typed on the phone' });
      await backgroundUpload(phone);
    });
    // Changed deliberately (review N3 R3). It was: the phone's note stands and the iPad's stays on the hidden row, with
    // nothing asked ("only a blank is filled"). Both are his, typed on two devices on the same task: Review Conflicts
    // asks, on the iPad, and the note in the cloud stays until he chooses.
    expect(cloudRow(newId)).toMatchObject({ notes: 'Typed on the phone', owner: 'Mike' });
    expect(cloudRow(oldId)).toMatchObject({ notes: NOTE });
    const [conflict] = await conflictsOf(ipad);
    expect([conflict.localId, (conflict.localPayload as { askedFields?: string[] }).askedFields]).toEqual([newId, ['notes']]);
    await chooseInSettings(ipad, conflict.id, 'keep_cloud');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed on the phone', 'Mike'));
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
    const { phone, ipad, newId } = await typedBeforeTheMasterArrived();
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
    const { phone, ipad, newId } = await typedBeforeTheMasterArrived();
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

  it('he types over the carried note while the web has typed one there too: it is his edit, weighed like any edit of his', async () => {
    const { phone, ipad, newId } = await typedBeforeTheMasterArrived();
    await refresh(ipad, false);
    at('2026-09-12T08:30:00.000Z');
    setOnline(ipad, false);
    webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed on the web' }));
    await edit(ipad, newId, { notes: 'Crew back Wednesday' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // Changed deliberately (review N3 P3-1). This test pinned the fault: "it is his edit, and goes up as one", his note
    // over the web's with no card. It is still his edit and not held back as a carried note is (the web's note is not
    // simply left to stand): Review Conflicts asks which of the two notes, and the carried owner goes up beside it.
    expect(cloudRow(newId)).toMatchObject({ notes: 'Typed on the web', owner: 'Mike' });
    const [conflict] = await conflictsOf(ipad);
    expect((conflict.localPayload as { askedFields?: string[] }).askedFields).toEqual(['notes']);
    await chooseInSettings(ipad, conflict.id, 'keep_local');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Crew back Wednesday', 'Mike'));
  });

  it('he enters a percent on the task before the carry has gone up, and the web has typed a note there: his percent lands, the web\'s note stands', async () => {
    const { phone, ipad, newId } = await typedBeforeTheMasterArrived();
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
    const { phone, newId } = await typedBeforeTheMasterArrived();
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
    // Build 229's approval left the new row blank; put that back on the phone's copy and in what it sends. (Nor did it mark
    // what is typed on a row: way 2's record of what the row was made with goes too.)
    setter(phone)(phone.state.map(item => (item.id === newId ? { ...item, notes: '', owner: '', textFromTask: undefined, textAsMade: undefined } : item)));
    phone.ref.current = phone.state;
    on(phone);
    const queueKey = 'projectVisionAI.syncQueue.v1';
    const store = mockStores.get('phone')!;
    store.set(queueKey, JSON.stringify((JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { id?: string; itemData?: ScheduleItem } }>)
      .map(queued => (queued.payload?.id === newId && queued.payload.itemData ? { ...queued, payload: { ...queued.payload, itemData: { ...queued.payload.itemData, notes: '', owner: '', textFromTask: undefined, textAsMade: undefined } } } : queued))));
    if (cloudRow(newId)) mockCloud.rows.set(newId, mockCopy({ ...cloudRow(newId)!, notes: '', owner: '', textFromTask: undefined, textAsMade: undefined }));
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

  /**
   * Review N3 R2 (pass 3, schedule; Low, caused by 5360700 / c3899ef; the reviewer's N21, right at 06e7b1c). The iPad,
   * with no signal, types a NEW note on such a task. The phone refreshes: the old note comes forward and is sent up.
   * The iPad comes back: its note, typed over a blank, met the old one in the cloud's row, and every device showed the
   * OLD note with a card on the iPad for the one he had just typed. What the carry put there is the task's earlier
   * text, not typed on this row by anyone: his note goes up over it, and nothing is asked.
   */
  describe('Review N3 R2: a note he types is not put behind one brought forward', () => {
    /** The iPad holds the cloud's rows as they are (the new row blank), and loses signal. */
    async function ipadOfflineOnTheBlankRow() {
      const rig = await strandedOnBuild229();
      await backgroundUpload(rig.phone);
      setter(rig.ipad)([...mockCloud.rows.values()].map(row => mockCopy(row) as ScheduleItem));
      rig.ipad.ref.current = rig.ipad.state;
      rig.ipad.documents = [...rig.phone.documents];
      heard.set('ipad', mockCloud.events.length);
      expect(theRow(rig.ipad)).toMatchObject({ id: rig.newId, notes: '', owner: '' });
      at('2026-09-11T09:00:00.000Z');
      setOnline(rig.ipad, false);
      return rig;
    }

    it('N21: his new note, on every device, and no card', async () => {
      const { phone, ipad, newId } = await ipadOfflineOnTheBlankRow();
      await edit(ipad, newId, { notes: 'Typed now' });
      at('2026-09-12T08:00:00.000Z');
      await refresh(phone);
      expect(cloudRow(newId)).toMatchObject({ notes: NOTE, owner: 'Mike' });
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      // (It was: the old note stayed, and the iPad held a card "Typed now / the old note".)
      expect(cloudRow(newId)).toMatchObject({ notes: 'Typed now', owner: 'Mike' });
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed now', 'Mike'));
      expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
    });

    it('but a note someone typed on the new row itself meanwhile is still asked about', async () => {
      const { phone, ipad, newId } = await ipadOfflineOnTheBlankRow();
      await edit(ipad, newId, { notes: 'Typed now' });
      at('2026-09-12T08:00:00.000Z');
      await edit(phone, newId, { notes: 'Typed on the phone' });
      await backgroundUpload(phone);
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      expect(cloudRow(newId)).toMatchObject({ notes: 'Typed on the phone' });
      expect((await conflictsOf(ipad)).map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields)).toEqual([['notes']]);
    });

    it('and only over a blank: a note he typed over one he could see, while the same new text reached both rows from elsewhere, is asked about', async () => {
      const { ipad, oldId, newId } = await ipadOfflineOnTheBlankRow();
      // (The iPad's row shows a note here, not a blank.)
      setter(ipad)(ipad.state.map(item => (item.id === newId ? { ...item, notes: 'Seen on the iPad' } : item)));
      ipad.ref.current = ipad.state;
      await edit(ipad, newId, { notes: 'Typed now' });
      at('2026-09-12T08:00:00.000Z');
      webWrite(webEdited(cloudRow(oldId)!, { notes: 'Typed elsewhere' }));
      webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed elsewhere' }));
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      expect(cloudRow(newId)).toMatchObject({ notes: 'Typed elsewhere' });
      expect((await conflictsOf(ipad)).map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields)).toEqual([['notes']]);
    });

    it('and a field he did not type takes what was brought forward', async () => {
      const { phone, ipad, newId } = await ipadOfflineOnTheBlankRow();
      await edit(ipad, newId, { percentComplete: 30 });
      at('2026-09-12T08:00:00.000Z');
      await refresh(phone);
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(30, NOTE, 'Mike'));
      expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
    });
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

  it('review N3 C: a next step and a milestone he typed are carried as the note is; a blank only', () => {
    const out = merged([
      row('A', { nextAction: 'Order rebar', milestone: 'Slab pour', updatedAt: T1 }),
      row('B', { revisedFromTaskIds: ['A'], milestone: 'Topping out' }),
    ]);
    expect([out.find(item => item.id === 'B')!.nextAction, out.find(item => item.id === 'B')!.milestone]).toEqual(['Order rebar', 'Topping out']);
  });

  it('review N3 R3: a blank in a field the newest row took a value for and lost is his clear, and is not filled; a blank it took nothing for is, and so is any blank of a row never changed since its import', () => {
    const cleared = merged([
      row('A', { notes: 'Old note', owner: 'Mike', updatedAt: T2 }),
      row('B', { revisedFromTaskIds: ['A'], textFromTask: { taskId: 'A', notes: 'Old note' }, updatedAt: T1 }),
    ]);
    // A was changed later (its owner was set). The note B took from A and no longer has stays cleared; the owner is carried.
    expect(textOf(cleared, 'B')).toEqual(['Mike', '', '', T1]);
    // Other text typed on A since is not carried over his clear either: that edit goes on with its own upload and is
    // weighed there (Review Conflicts asks).
    expect(textOf(merged([
      row('A', { notes: 'Typed since', updatedAt: T2 }),
      row('B', { revisedFromTaskIds: ['A'], textFromTask: { taskId: 'A', notes: 'Old note' }, updatedAt: T1 }),
    ]), 'B')).toEqual(['', '', '', T1]);
    // No stamp of its own: nobody has changed B since its import, so nobody cleared anything there (the schedule
    // reviewer's N23 strands a row of this build so; a row Build 229 left has no such record at all).
    expect(textOf(merged([
      row('A', { notes: 'Old note', updatedAt: T2 }),
      row('B', { revisedFromTaskIds: ['A'], textFromTask: { taskId: 'A', notes: 'Old note' } }),
    ]), 'B')).toEqual(['', '', 'Old note', null]);
  });

  it('review P4 F4: a blank a row says it took is filled only from the very row it replaces, when that row has text now; never from an older row that was changed later', () => {
    // H's row took a blank owner from G's row (he had cleared it there). F's row still holds Mike, and was stamped later
    // (another device's percent landed on it): by the carry's own rule it is "the row changed last".
    const rows = [
      row('F', { owner: 'Mike', updatedAt: T3 }),
      row('G', { revisedFromTaskIds: ['F'], owner: '', textFromTask: { taskId: 'F', owner: 'Mike' }, updatedAt: T2 }),
      row('H', { revisedFromTaskIds: ['F', 'G'], owner: '', textFromTask: { taskId: 'G', owner: '' } }),
    ];
    // (It was: Mike again, on the newest row.)
    expect(textOf(merged(rows), 'H')).toEqual(['', '', '', null]);
    // The row it replaces has an owner now (set there by something that sends no edit on): filled, and the record follows.
    const ownerOnG = merged([rows[0], { ...rows[1], owner: 'Ana', updatedAt: T3 }, rows[2]]);
    expect(textOf(ownerOnG, 'H')).toEqual(['Ana', '', '', null]);
    expect(ownerOnG.find(item => item.id === 'H')!.textFromTask).toEqual({ taskId: 'G', owner: 'Ana' });
    // Cleared on H after that: the record says H held Ana, so the blank is his clear, and it stays.
    const cleared = ownerOnG.map(item => (item.id === 'H' ? { ...item, owner: '', updatedAt: T3 } : item));
    expect(textOf(merged(cleared), 'H')).toEqual(['', '', '', T3]);
    // And nothing is filled in a merge that does not hold the cloud's copy of the row it replaces (this device's copy
    // of that row may be behind).
    const [oldF, onG, newest] = [rows[0], { ...rows[1], owner: 'Ana', updatedAt: T3 }, rows[2]];
    const withoutCloudsG = recoverDAVEScheduleRecords({ local: [oldF, onG, newest], cloud: [newest], allowCloudOnly: true });
    expect(textOf(withoutCloudsG, 'H')).toEqual(['', '', '', null]);
  });

  it('review P4: that fill goes by the time of the row with the text, to the newest row only, and through a row in between only while that row holds the blank it took itself', () => {
    // A note on F (typed there by something that sends no edit on); G took a blank from F, and H a blank from G.
    const rows = [
      row('F', { notes: NOTE, updatedAt: T3 }),
      row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', notes: '' } }),
      row('H', { revisedFromTaskIds: ['F', 'G'], textFromTask: { taskId: 'G', notes: '' } }),
    ];
    const through = merged(rows);
    // The newest row has it. The row in between is left as it is (filled, it would lend on in a later merge whatever
    // was typed on the newest row since), and the newest row's record is still of that row's blank.
    expect([textOf(through, 'H')[2], textOf(through, 'G')[2]]).toEqual([NOTE, '']);
    expect(through.find(item => item.id === 'H')!.textFromTask).toEqual({ taskId: 'G', notes: '' });
    // Not a row changed after the row with the text was: the record says what the row held, not when, and a blank
    // typed back over a note set there reads as the blank it took. (The reviewer's generator, two masters apart, seed
    // 9179: the owner of a card still open was written over the web's later clear.)
    expect(textOf(merged([rows[0], rows[1], { ...rows[2], updatedAt: '2026-09-12T12:00:00.000Z' }]), 'H')[2]).toBe('');
    expect(textOf(merged([{ ...rows[0], updatedAt: T2 }, { ...rows[1], notes: NOTE, updatedAt: T2 }, { ...rows[2], updatedAt: T3 }]), 'H')[2]).toBe('');
    // Nor through a row in between whose blank is a note cleared there.
    expect(textOf(merged([rows[0], { ...rows[1], textFromTask: { taskId: 'F', notes: 'An older note' }, updatedAt: T2 }, rows[2]]), 'H')[2]).toBe('');
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

/**
 * Review N3 P3-1 (pass 3, sync; Low, caused by c3899ef). David types over a carried owner or note while the carry is
 * still waiting on the device, and another device has filled that same field of the task's new row. The carry and
 * his edit share one queue record; the carry counted as that field's first waiting edit and kept no copy it started
 * from, so his edit was not weighed against the cloud (owner answer Q28) and went up over the other device's value,
 * with no card. His edit of a field is now weighed from the copy he saw when he made it, carry or no carry. The
 * carry itself still only fills a blank, asks nothing and closes no card.
 */
describe('Review N3 P3-1: his edit typed over a carry still waiting is weighed against the cloud like any edit of his', () => {
  /** The iPad has carried the note and the owner to the task's new row and not sent them yet; it then loses signal. */
  async function carryWaitingOnTheIpad() {
    const rig = await typedBeforeTheMasterArrived();
    await refresh(rig.ipad, false);
    expect(theRow(rig.ipad)).toMatchObject({ id: rig.newId, notes: NOTE, owner: 'Mike' });
    expect(cloudRow(rig.newId)).toMatchObject({ notes: '', owner: '' });
    at('2026-09-12T08:30:00.000Z');
    setOnline(rig.ipad, false);
    return rig;
  }
  const asked = async (device: Device) => (await conflictsOf(device)).map(conflict => {
    const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
    const fields = mine.askedFields ?? [];
    return { row: conflict.localId, fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
  });

  it('another device set the owner of the task\'s new row meanwhile: Review Conflicts asks, and that owner stays until he chooses', async () => {
    const { phone, ipad, newId } = await carryWaitingOnTheIpad();
    webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
    await edit(ipad, newId, { owner: 'Lee' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // (It was: owner 'Lee' in the cloud, Ana's gone on every device, no card.)
    expect(cloudRow(newId)).toMatchObject({ owner: 'Ana', notes: NOTE });
    expect(await asked(ipad)).toEqual([{ row: newId, fields: ['owner'], here: ['Lee'], cloud: ['Ana'] }]);
    expect(theRow(ipad)).toMatchObject({ owner: 'Lee', notes: NOTE });
    await settle(phone, ipad);
    expect([onDevice(phone), onWeb()]).toEqual(Array(2).fill([['10/20/2026', '10/30/2026', 0, NOTE, 'Ana']]));
    expect(await asked(ipad)).toEqual([{ row: newId, fields: ['owner'], here: ['Lee'], cloud: ['Ana'] }]);
  });

  it('Keep Phone then puts his owner everywhere; Keep Cloud the other device\'s', async () => {
    for (const [resolution, owner] of [['keep_local', 'Lee'], ['keep_cloud', 'Ana']] as const) {
      resetRig();
      const { phone, ipad, newId } = await carryWaitingOnTheIpad();
      webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      await edit(ipad, newId, { owner: 'Lee' });
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      const [conflict] = await conflictsOf(ipad);
      await chooseInSettings(ipad, conflict.id, resolution);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, owner));
      expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
    }
  });

  it('nobody else touched the field: his owner goes up over the blank the carry was to fill, and nothing is asked', async () => {
    const { phone, ipad, newId } = await carryWaitingOnTheIpad();
    await edit(ipad, newId, { owner: 'Lee' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Lee', notes: NOTE });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Lee'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('the phone carried the same owner there first, so the cloud holds the very value he typed over: his goes up, nothing is asked', async () => {
    const { phone, ipad, newId } = await carryWaitingOnTheIpad();
    await refresh(phone);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Mike', notes: NOTE });
    await edit(ipad, newId, { owner: 'Lee' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Lee', notes: NOTE });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Lee'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('he types over it twice while it waits: still weighed from the copy he first typed over', async () => {
    const { ipad, newId } = await carryWaitingOnTheIpad();
    webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
    await edit(ipad, newId, { owner: 'Lee' });
    await edit(ipad, newId, { owner: 'Sam' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Ana', notes: NOTE });
    expect(await asked(ipad)).toEqual([{ row: newId, fields: ['owner'], here: ['Sam'], cloud: ['Ana'] }]);
  });

  it('the carried field he did not touch still only fills a blank: over the other device\'s note the cloud\'s stands, with nothing asked about it', async () => {
    const { phone, ipad, newId } = await carryWaitingOnTheIpad();
    webWrite(webEdited(cloudRow(newId)!, { notes: 'Typed on the web' }));
    await edit(ipad, newId, { owner: 'Lee' });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Lee', notes: 'Typed on the web' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed on the web', 'Lee'));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  describe('with a cloud that refuses a write made against a row changed since it was read (independent review pass 2, item 1)', () => {
    it('his edit over the carry: the other device\'s owner lands in the moment before the write; refused, read again, weighed again, asked', async () => {
      const { ipad, newId } = await carryWaitingOnTheIpad();
      await edit(ipad, newId, { owner: 'Lee' });
      setOnline(ipad, true);
      mockCloud.versioned = true;
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      await backgroundUpload(ipad);
      expect(mockCloud.refused).toEqual([`ipad:${newId}`]);
      // (It was: weighed again with no copy to weigh from, and 'Lee' written over Ana's.)
      expect(cloudRow(newId)).toMatchObject({ owner: 'Ana', notes: NOTE });
      expect(await asked(ipad)).toEqual([{ row: newId, fields: ['owner'], here: ['Lee'], cloud: ['Ana'] }]);
    });

    it('the carry alone: the other device\'s owner lands in that moment; refused, read again, and the cloud\'s stands with nothing asked', async () => {
      const { phone, ipad, newId } = await carryWaitingOnTheIpad();
      setOnline(ipad, true);
      mockCloud.versioned = true;
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      await backgroundUpload(ipad);
      expect(mockCloud.refused).toEqual([`ipad:${newId}`]);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Ana', notes: NOTE });
      expect(await conflictsOf(ipad)).toEqual([]);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Ana'));
      expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
      expect(mockCloud.refused).toEqual([`ipad:${newId}`]);
    });

    it('with no one else writing, the carry and his edit go up in one write, made against the row as read', async () => {
      const { ipad, newId } = await carryWaitingOnTheIpad();
      await edit(ipad, newId, { owner: 'Lee' });
      setOnline(ipad, true);
      mockCloud.versioned = true;
      const writes = cloudWrites();
      await backgroundUpload(ipad);
      expect([mockCloud.refused, mockCloud.writes.slice(writes)]).toEqual([[], [`ipad:${newId}`]]);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Lee', notes: NOTE });
      expect(await conflictsOf(ipad)).toEqual([]);
    });
  });
});

/**
 * Review N3 R3 (pass 3, schedule; MEDIUM, caused by the note-follows fixes 14b3569 and c3899ef). An owner or a note he
 * CHANGED or CLEARED on one device came back as the old one on every device, with no card, when a master that moves
 * the task was approved on a device that had not heard the change (the reviewer's C1-C4), or the change was typed on
 * the old row by a device that had not heard of the master (C6, C7). The master's new row was filled from the
 * approving device's own copy, and the carry only fills a blank. What follows the task to its new row is now what he
 * last did to that field on any device, by the rules of owner answer Q28.
 */
describe('Review N3 R3: what follows a task to its new row is what he last did to the field, on any device', () => {
  /** Both devices and the cloud hold this on Framing (the phone typed it, the iPad heard it). */
  async function onBoth(change: Partial<ScheduleItem>) {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, oldId, change);
    await backgroundUpload(phone);
    await echoes(ipad);
    expect(theRow(ipad)).toMatchObject(change);
    return { phone, ipad, oldId };
  }
  /** The phone, with no signal, approves master G, which moves Framing; then gets its signal back. */
  async function phoneApprovesOffline(phone: Device, back: 'auto' | 'syncnow' = 'auto') {
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    if (back === 'syncnow') await fullSync(phone); else await backgroundUpload(phone);
  }
  const noCards = async (phone: Device, ipad: Device) => expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  const asked = async (device: Device) => (await conflictsOf(device)).map(conflict => {
    const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
    const fields = mine.askedFields ?? [];
    return { fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
  });

  it('C1: he clears the note on the iPad; the phone, which has not heard, approves the master: the note stays cleared everywhere', async () => {
    const { phone, ipad } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: '' });
    await backgroundUpload(ipad);
    await phoneApprovesOffline(phone);
    // (It was: the old note on the task's new row in the cloud, and then on every device.)
    expect(cloudRow(theRow(phone).id)).toMatchObject({ notes: '' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
    await noCards(phone, ipad);
  });

  it('C2 and C4: owner Mike changed to Lee on the iPad; the phone approves the master unheard: Lee everywhere, by the automatic upload and by Sync Now', async () => {
    for (const back of ['auto', 'syncnow'] as const) {
      resetRig();
      const { phone, ipad } = await onBoth({ owner: 'Mike' });
      setOnline(phone, false);
      at('2026-09-09T08:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { owner: 'Lee' });
      await backgroundUpload(ipad);
      await phoneApprovesOffline(phone, back);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
      await noCards(phone, ipad);
    }
  });

  it('the note changed and an owner set on the iPad, both unheard by the phone that approves the master: the new row has both (the owner too, which it had nothing to take for)', async () => {
    const { phone, ipad } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: 'Changed on the iPad' });
    await edit(ipad, theRow(ipad).id, { owner: 'Ana' });
    await backgroundUpload(ipad);
    await phoneApprovesOffline(phone);
    // (The reviewer's generator, seed 20251: the note was corrected and the row stamped, and that stamp then kept the
    // sync's carry from ever filling the owner.)
    expect(cloudRow(theRow(phone).id)).toMatchObject({ notes: 'Changed on the iPad', owner: 'Ana' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Changed on the iPad', 'Ana'));
    await noCards(phone, ipad);
  });

  it('C3: the same when he cleared the note on the web', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    webWrite(webEdited(cloudRow(oldId)!, { notes: '' }));
    await phoneApprovesOffline(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
    await noCards(phone, ipad);
  });

  it('C5, as before: the phone had heard the change before it lost signal', async () => {
    const { phone, ipad } = await onBoth({ owner: 'Mike' });
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { owner: 'Lee' });
    await backgroundUpload(ipad);
    await echoes(phone);
    setOnline(phone, false);
    await phoneApprovesOffline(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
    await noCards(phone, ipad);
  });

  it('C6: the master first; then the iPad, which has not heard of it, clears the note on the row it still sees: cleared everywhere', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE });
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { notes: '' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // His clear reaches the task's new row as his edit, at once (it stayed on the hidden row).
    expect([cloudRow(oldId)!.notes, cloudRow(newId)!.notes]).toEqual(['', '']);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
    await noCards(phone, ipad);
  });

  it('C7: the same with the owner changed from Mike to Lee on the row the iPad still sees', async () => {
    const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(theRow(phone).id)).toMatchObject({ owner: 'Lee' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
    await noCards(phone, ipad);
  });

  it('both changed it: Lee typed on the old row by the iPad that had not heard, Sam typed on the new row meanwhile: Review Conflicts asks', async () => {
    const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-11T08:00:00.000Z');
    await edit(phone, newId, { owner: 'Sam' });
    await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ owner: 'Sam' });
    expect(await asked(ipad)).toEqual([{ fields: ['owner'], here: ['Lee'], cloud: ['Sam'] }]);
    const [conflict] = await conflictsOf(ipad);
    await chooseInSettings(ipad, conflict.id, 'keep_local');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
    await noCards(phone, ipad);
  });

  it('both changed it, and the device that approves the master is one of them: the other\'s note is on the new row until he chooses (the card no longer closes unasked)', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, oldId, { notes: 'Typed on the iPad' });
    await backgroundUpload(ipad);
    at('2026-09-09T09:00:00.000Z');
    await edit(phone, oldId, { notes: 'Typed on the phone' });
    await phoneApprovesOffline(phone);
    const newId = theRow(phone).id;
    expect(cloudRow(newId)).toMatchObject({ notes: 'Typed on the iPad' });
    // The card is the phone's, about the old row; opening Review Conflicts moves it to the task's row, where it still asks.
    const [conflict] = await conflictsOf(phone);
    await chooseInSettings(phone, conflict.id, 'keep_local');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Typed on the phone', ''));
    await noCards(phone, ipad);
  });

  describe('review N3 C: his approval status and schedule impact, between two devices', () => {
    const controlsNow = (row: ScheduleItem | undefined) => {
      const controls = normalizeProjectControls(row?.projectControls);
      return [controls.approvalStatus, controls.estimatedScheduleImpactDays];
    };
    const setOn = (device: Device, id: string, change: Partial<ProjectControls>) => edit(device, id, {
      projectControls: reviseProjectControls({ current: device.state.find(item => item.id === id)!.projectControls, patch: change, actor: 'David', now: new Date().toISOString() }),
    });
    async function pendingOnBoth() {
      const { phone, ipad } = await start();
      const oldId = theRow(phone).id;
      at('2026-09-08T08:00:00.000Z');
      await setOn(phone, oldId, { approvalStatus: 'Pending' });
      await backgroundUpload(phone);
      await echoes(ipad);
      expect(controlsNow(theRow(ipad))).toEqual(['Pending', null]);
      return { phone, ipad, oldId };
    }

    it('changed on the iPad (Approved, and an impact of 5 days) and unheard by the phone that approves the master: the later entries are on the new row everywhere', async () => {
      const { phone, ipad, oldId } = await pendingOnBoth();
      setOnline(phone, false);
      at('2026-09-09T08:00:00.000Z');
      await setOn(ipad, oldId, { approvalStatus: 'Approved', estimatedScheduleImpactDays: 5 });
      await backgroundUpload(ipad);
      await phoneApprovesOffline(phone);
      expect(controlsNow(cloudRow(theRow(phone).id))).toEqual(['Approved', 5]);
      await settle(phone, ipad);
      expect([controlsNow(theRow(phone)), controlsNow(theRow(ipad)), controlsNow(framingOf(webShown())[0])]).toEqual(Array(3).fill(['Approved', 5]));
      await noCards(phone, ipad);
    });

    it('the master first; then the iPad, which has not heard of it, sets them on the row it still sees: they reach the task\'s new row, and nothing is asked', async () => {
      const { phone, ipad, oldId } = await pendingOnBoth();
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const newId = theRow(phone).id;
      expect(controlsNow(cloudRow(newId))).toEqual(['Pending', null]);
      at('2026-09-11T09:00:00.000Z');
      await setOn(ipad, oldId, { approvalStatus: 'Approved', estimatedScheduleImpactDays: 5 });
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      expect(controlsNow(cloudRow(newId))).toEqual(['Approved', 5]);
      await settle(phone, ipad);
      expect([controlsNow(theRow(phone)), controlsNow(theRow(ipad))]).toEqual(Array(2).fill(['Approved', 5]));
      await noCards(phone, ipad);
    });

    it('set on both rows: of each field the later entry stands, with nothing asked (as on one row)', async () => {
      const { phone, ipad, oldId } = await pendingOnBoth();
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const newId = theRow(phone).id;
      at('2026-09-11T08:00:00.000Z');
      await setOn(ipad, oldId, { approvalStatus: 'Approved', estimatedScheduleImpactDays: 5 });
      at('2026-09-11T10:00:00.000Z');
      await setOn(phone, newId, { approvalStatus: 'Changes Requested' });
      await backgroundUpload(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      await settle(phone, ipad);
      expect([controlsNow(theRow(phone)), controlsNow(theRow(ipad))]).toEqual(Array(2).fill(['Changes Requested', 5]));
      await noCards(phone, ipad);
    });
  });

  it('review N3 C: a next step changed on the iPad and unheard by the phone that approves the master is on the new row everywhere; a milestone set on the row the iPad still sees after the master reaches the task\'s row', async () => {
    const everyNextStep = (phone: Device, ipad: Device, field: 'nextAction' | 'milestone') => [theRow(phone)[field], theRow(ipad)[field], framingOf(webShown())[0][field]];
    {
      const { phone, ipad } = await onBoth({ nextAction: 'Order rebar' });
      setOnline(phone, false);
      at('2026-09-09T08:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { nextAction: 'Call the inspector' });
      await backgroundUpload(ipad);
      await phoneApprovesOffline(phone);
      expect(cloudRow(theRow(phone).id)).toMatchObject({ nextAction: 'Call the inspector' });
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
      expect(everyNextStep(phone, ipad, 'nextAction')).toEqual(Array(3).fill('Call the inspector'));
      await noCards(phone, ipad);
    }
    resetRig();
    {
      const { phone, ipad, oldId } = await onBoth({ milestone: 'Slab pour' });
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const newId = theRow(phone).id;
      expect(cloudRow(newId)).toMatchObject({ milestone: 'Slab pour' });
      at('2026-09-11T09:00:00.000Z');
      await edit(ipad, oldId, { milestone: 'Topping out' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      expect([cloudRow(oldId)!.milestone, cloudRow(newId)!.milestone]).toEqual(['Topping out', 'Topping out']);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
      expect(everyNextStep(phone, ipad, 'milestone')).toEqual(Array(3).fill('Topping out'));
      await noCards(phone, ipad);
    }
  });

  it('his own note, typed with no signal on the row the master then moved, is not taken for an older copy: whichever of the two is sent first', async () => {
    for (const newRowFirst of [false, true]) {
      resetRig();
      const { phone, ipad } = await start();
      const oldId = theRow(phone).id;
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      await edit(ipad, oldId, { notes: NOTE });
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      if (newRowFirst) {
        // The new row goes up before his edit of the old one (the reviewer's generator, seeds 1126, 1190 and 1281).
        const store = mockStores.get('ipad')!;
        const queueKey = 'projectVisionAI.syncQueue.v1';
        const queued = JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { id?: string } }>;
        store.set(queueKey, JSON.stringify([...queued.filter(item => item.payload?.id !== oldId), ...queued.filter(item => item.payload?.id === oldId)]));
      }
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad);
      await backgroundUpload(ipad);
      // (With the new row first, it took the blank the cloud's old row still had, and the note was on no row shown.)
      expect([cloudRow(oldId)!.notes, cloudRow(newId)!.notes]).toEqual([NOTE, NOTE]);
      // And the cloud's new row never read blank on the way: it is written once, with his note.
      expect(mockCloud.events.filter(event => event.id === newId).map(event => (event.row as ScheduleItem).notes)).toEqual([NOTE]);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, ''));
      await noCards(phone, ipad);
    }
  });

  it('two rows answer to the row he typed on (a master\'s, and an uploaded schedule\'s not made current yet): his edit goes on to both', async () => {
    const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    // A second row answering to the old one, imported later (the web's upload of another revision, not current).
    webWrite({ ...(mockCopy(cloudRow(newId)!) as ScheduleItem), id: 'WEB-1', importBatchId: 'batch-WEB', sourceDocumentId: 'WEB', importedAt: '2026-09-10T20:00:00.000Z', createdAt: '2026-09-10T20:00:00.000Z' });
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect([cloudRow(oldId)!.owner, cloudRow(newId)!.owner, cloudRow('WEB-1')!.owner]).toEqual(['Lee', 'Lee', 'Lee']);
    expect(await conflictsOf(ipad)).toEqual([]);
  });

  it('the task\'s new row still holds the note exactly as it took it (the row was saved days ago; the note has changed on the task since): his edit goes over it, and nothing is asked', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, textFromTask: { taskId: oldId, notes: NOTE } });
    // The note on the task's own row was changed since (the web, on that row), and the iPad had heard that much.
    at('2026-09-11T08:00:00.000Z');
    webWrite(webEdited(cloudRow(oldId)!, { notes: 'Changed on the web' }));
    setter(ipad)(ipad.state.map(item => (item.id === oldId ? { ...(mockCopy(cloudRow(oldId)!) as ScheduleItem) } : item)));
    ipad.ref.current = ipad.state;
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { notes: 'Typed on the iPad' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // (Weighed from the copy his edit started from alone, "Changed on the web" against the new row's older copy read
    // as two changes, and a card asked "Typed on the iPad / the note the new row copied".)
    expect([cloudRow(oldId)!.notes, cloudRow(newId)!.notes]).toEqual(['Typed on the iPad', 'Typed on the iPad']);
    expect(await conflictsOf(ipad)).toEqual([]);
  });

  it('the task\'s new row has nothing in the field and took nothing for it (the owner was set on the web since, on the old row): his change goes over the blank, and nothing is asked', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-11T08:00:00.000Z');
    webWrite(webEdited(cloudRow(oldId)!, { owner: 'Lee' }));
    setter(ipad)(ipad.state.map(item => (item.id === oldId ? { ...(mockCopy(cloudRow(oldId)!) as ScheduleItem) } : item)));
    ipad.ref.current = ipad.state;
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Ana' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect([cloudRow(oldId)!.owner, cloudRow(newId)!.owner]).toEqual(['Ana', 'Ana']);
    expect(await conflictsOf(ipad)).toEqual([]);
  });

  it('changed on the old row itself by two of them after the master (Ana on a web page still open on it, Lee on the iPad): asked about there, and nothing goes on to the new row unasked', async () => {
    const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-11T08:00:00.000Z');
    webWrite(webEdited(cloudRow(oldId)!, { owner: 'Ana' }));
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect([cloudRow(oldId)!.owner, cloudRow(newId)!.owner]).toEqual(['Ana', 'Mike']);
    expect((await conflictsOf(ipad)).map(conflict => [conflict.localId, (conflict.localPayload as { askedFields?: string[] }).askedFields])).toEqual([[oldId, ['owner']]]);
  });

  it('Sync Now while the old row\'s cloud copy cannot be read: the new row is not sent then either', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, oldId, { notes: '' });
    await backgroundUpload(ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    const newId = theRow(phone).id;
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    mockCloud.unlisted.add(oldId);
    mockCloud.unreadable.add(oldId);
    await fullSync(phone);
    expect(cloudRow(newId)).toBeUndefined();
    mockCloud.unreadable.clear();
    mockCloud.unlisted.clear();
    await fullSync(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: '' });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
  });

  describe('he missed two masters: the row he typed on has been replaced twice', () => {
    const H = scheduleDoc('MASTER H', '2026-09-11T06:00:00.000Z');
    const H_ROW = 'Framing,Alpha,Lot,10/22/2026,11/01/2026,';
    const ON_H = (note: string, owner: string) => Array(3).fill([['10/22/2026', '11/01/2026', 0, note, owner]]);
    /** Owner Mike everywhere; the iPad loses signal; the phone approves G, then (after `onG`) H; the iPad changes Mike to Lee on the row it still sees. */
    async function twoMastersUnheard(onG?: (firstNewId: string) => void) {
      const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const firstNewId = theRow(phone).id;
      at('2026-09-10T20:00:00.000Z');
      if (onG) { onG(firstNewId); await refresh(phone); }
      at(H.importedAt!);
      await approve(phone, H, [H_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const newId = theRow(phone).id;
      expect(new Set([oldId, firstNewId, newId]).size).toBe(3);
      at('2026-09-11T09:00:00.000Z');
      await edit(ipad, oldId, { owner: 'Lee' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      return { phone, ipad, oldId, firstNewId, newId };
    }

    it('nobody typed on the way: his owner goes over the copy on the row shown, the hidden row in between is left as it is, and nothing is asked', async () => {
      const { phone, ipad, oldId, firstNewId, newId } = await twoMastersUnheard();
      expect([cloudRow(oldId)!.owner, cloudRow(firstNewId)!.owner, cloudRow(newId)!.owner]).toEqual(['Lee', 'Mike', 'Lee']);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_H('', 'Lee'));
      await noCards(phone, ipad);
    });

    it('another device set an owner on the row in between, and the second master copied it on: that is not a copy of what he saw, and Review Conflicts asks, once', async () => {
      const { phone, ipad, firstNewId, newId } = await twoMastersUnheard(firstNewId => webWrite(webEdited(cloudRow(firstNewId)!, { owner: 'Sam' })));
      // (It was: 'Sam' on the row shown read as merely copied, because that row holds it as it took it, and 'Lee' went over it with no card.)
      expect([cloudRow(firstNewId)!.owner, cloudRow(newId)!.owner]).toEqual(['Sam', 'Sam']);
      expect((await conflictsOf(ipad)).map(conflict => conflict.localId)).toEqual([newId]);
      expect(await asked(ipad)).toEqual([{ fields: ['owner'], here: ['Lee'], cloud: ['Sam'] }]);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_H('', 'Sam'));
      expect((await conflictsOf(ipad)).map(conflict => conflict.localId)).toEqual([newId]);
    });

    it('an owner the sync carried (not one he typed) is not taken on as his edit: over an owner set on the row shown meanwhile nothing is asked', async () => {
      // The iPad's note and owner were typed before master G arrived; G's new row is blank, and the iPad's sync has
      // carried them to it without sending them yet. He types over the carried note there, with no signal.
      const { phone, ipad, newId: firstNewId } = await typedBeforeTheMasterArrived();
      await refresh(ipad, false);
      expect(theRow(ipad)).toMatchObject({ id: firstNewId, notes: NOTE, owner: 'Mike' });
      setOnline(ipad, false);
      at('2026-09-12T09:00:00.000Z');
      await edit(ipad, firstNewId, { notes: 'Typed over the carried note' });
      // Meanwhile the phone approves H, which moves the task again, and the web sets an owner on H's row.
      const H2 = scheduleDoc('MASTER H', '2026-09-12T10:00:00.000Z');
      at(H2.importedAt!);
      await approve(phone, H2, [H_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const newId = theRow(phone).id;
      expect(newId).not.toBe(firstNewId);
      at('2026-09-12T11:00:00.000Z');
      webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      at('2026-09-12T12:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      // His note goes on to the row shown; the carried owner does not (it was: a card "Mike / Ana" for an owner he never typed there).
      expect(cloudRow(newId)).toMatchObject({ notes: 'Typed over the carried note', owner: 'Ana' });
      expect(await conflictsOf(ipad)).toEqual([]);
      await settle(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_H('Typed over the carried note', 'Ana'));
      await noCards(phone, ipad);
    });
  });

  it('the owner cleared on the web on the task\'s new row, then changed on the row the iPad still sees: both changed it, and it is asked about, not written over the clear (a save on the web keeps the row\'s record of what it took)', async () => {
    const { phone, ipad, oldId } = await onBoth({ owner: 'Mike' });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    expect(cloudRow(newId)).toMatchObject({ owner: 'Mike', textFromTask: { taskId: oldId, owner: 'Mike' } });
    at('2026-09-10T20:00:00.000Z');
    webWrite(webEdited(cloudRow(newId)!, { owner: '' }));
    expect(cloudRow(newId)).toMatchObject({ owner: '', textFromTask: { taskId: oldId, owner: 'Mike' } });
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // (It was: the web's save dropped the record, the cleared owner read as a blank nobody had typed, and 'Lee' went
    // over the clear with no card.)
    expect(cloudRow(newId)!.owner).toBe('');
    expect(await asked(ipad)).toEqual([{ fields: ['owner'], here: ['Lee'], cloud: [''] }]);
    await settle(phone, ipad);
    // And it stays asked: the sync's carry does not fill a blank the row took a value for and lost (his clear). Filled
    // from the old row as well, the card was left asking about an owner the row already held.
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
    on(ipad);
    expect((await ipad.m.sync.refreshScheduleItemConflictCloudCopies()).map(conflict => conflict.localId)).toEqual([newId]);
    expect(await asked(ipad)).toEqual([{ fields: ['owner'], here: ['Lee'], cloud: [''] }]);
    // Keep Phone: his 'Lee' everywhere.
    await chooseInSettings(ipad, (await conflictsOf(ipad))[0].id, 'keep_local');
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
    await noCards(phone, ipad);
  });

  it('a note he cleared on the task\'s new row does not come back as the old one when something else is typed later on the row the iPad still sees', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-10T20:00:00.000Z');
    await edit(phone, newId, { notes: '' });
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: '', textFromTask: { taskId: oldId, notes: NOTE } });
    // The iPad, which has heard of neither, sets an owner on the row it still sees: that row, with the old note, is now
    // the one changed last.
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { owner: 'Lee' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    // (It was: the sync's carry filled the blank note from the row changed later, and the note he had cleared was back
    // on every device. The new row says it took that very note: its blank is his clear, not a blank to fill.)
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Lee'));
    await noCards(phone, ipad);
  });

  it('his edit could not be taken on to the task\'s new row just then: it waits whole, and goes to both rows at the next try', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { notes: '' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    // The write to the new row is refused (the web set an owner there in that moment), and the row cannot be read again just then.
    mockCloud.versioned = true;
    mockCloud.beforeNextTaskWrite = () => { webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' })); mockCloud.unreadable.add(newId); };
    await backgroundUpload(ipad);
    expect(mockCloud.refused).toEqual([`ipad:${newId}`]);
    // (Counted as sent, his clear went to the hidden row alone and was not tried on the task's row again: the old note stayed.)
    expect([cloudRow(oldId)!.notes, cloudRow(newId)!.notes]).toEqual([NOTE, NOTE]);
    expect((await queueOf(ipad)).length).toBeGreaterThan(0);
    mockCloud.unreadable.clear();
    await backgroundUpload(ipad);
    expect([cloudRow(oldId)!.notes, cloudRow(newId)!.notes, cloudRow(newId)!.owner]).toEqual(['', '', 'Ana']);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Ana'));
    await noCards(phone, ipad);
  });

  it('the record of what the new row took is not part of the rest of the task: a lookahead approved with no signal on the row as first saved stands when another device types meanwhile', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, oldId, { notes: 'Changed on the iPad' });
    await backgroundUpload(ipad);
    // The phone approves G unheard. First sent, its new row takes the iPad's note, and its record says so.
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    const newId = theRow(phone).id;
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: 'Changed on the iPad', textFromTask: { taskId: oldId, notes: 'Changed on the iPad' } });
    // It loses signal before it has read that row back: its own copy has the record as it was first saved.
    setOnline(phone, false);
    expect(theRow(phone)).toMatchObject({ id: newId, textFromTask: { taskId: oldId, notes: NOTE } });
    const L2 = scheduleDoc('LOOKAHEAD L2', '2026-09-13T12:00:00.000Z', 'lookahead');
    at(L2.importedAt!);
    await approve(phone, L2, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
    // Later by the clock, the iPad sets an owner on the task's new row: the cloud's row is the later one.
    await refresh(ipad);
    at('2026-09-13T15:00:00.000Z');
    await edit(ipad, newId, { owner: 'Sam' });
    await backgroundUpload(ipad);
    at('2026-09-14T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    // (With the record read as a change to the rest of the task, the cloud's later row was taken whole and the
    // lookahead's dates were on no device: review N1 finding 3 again.)
    expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 0, 'Changed on the iPad', 'Sam']]));
    await noCards(phone, ipad);
  });

  describe('the rules on the records alone', () => {
    const task = (extra: Partial<ScheduleItem>): ScheduleItem => ({
      id: 'F-1', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/01/2026', finishDate: '10/11/2026', status: 'Not Started',
      percentComplete: 0, priority: 'Medium', notes: '', owner: '', contractor: '', milestone: '', createdAt: '2026-09-01T12:00:00.000Z', importedAt: '2026-09-01T12:00:00.000Z',
      importBatchId: 'batch-F', sourceDocumentId: 'MASTER F', ...extra,
    } as ScheduleItem);
    const movedBy = (saved: ScheduleItem, fileSays: Partial<ScheduleItem> = {}) => mergeApprovedScheduleImportItems({
      existing: [saved],
      imported: [task({ id: 'G-1', startDate: '10/20/2026', finishDate: '10/30/2026', importBatchId: 'batch-G', sourceDocumentId: 'MASTER G', createdAt: '2026-09-10T18:00:00.000Z', importedAt: '2026-09-10T18:00:00.000Z', ...fileSays })],
      completionMatch: () => null, mergeCompletion: item => item, approvedAt: '2026-09-10T18:00:00.000Z',
    }).additions[0];

    it('the master\'s new row says which row it replaces and, for every field the file left unset, what that row had, a blank too; not a field the file stated', () => {
      const ALL_BLANK = { owner: '', contractor: '', notes: '', nextAction: '', milestone: '' };
      const row = movedBy(task({ notes: NOTE, owner: 'Mike' }));
      expect(row).toMatchObject({ notes: NOTE, owner: 'Mike' });
      // (Not the task's priority, which he never set: schedule batch S6, item 1. S5 had the row always take it; one he
      // set is taken and named, at the end.)
      expect(row.textFromTask).toEqual({ taskId: 'F-1', ...ALL_BLANK, notes: NOTE, owner: 'Mike', dependencies: [] });
      const fileNamesTheOwner = movedBy(task({ notes: NOTE, owner: 'Mike' }), { owner: 'Acme Framing' });
      const { owner: _owner, ...unsetByTheFile } = ALL_BLANK;
      expect([fileNamesTheOwner.owner, fileNamesTheOwner.textFromTask]).toEqual(['Acme Framing', { taskId: 'F-1', ...unsetByTheFile, notes: NOTE, dependencies: [] }]);
      // Review P4 F1: also when it took nothing. (It kept no record then, and its first upload had nothing to weigh it against.)
      expect(movedBy(task({})).textFromTask).toEqual({ taskId: 'F-1', ...ALL_BLANK, dependencies: [] });
      // A value the file states stands as the file's even when the task had the same: it is not his to follow.
      expect(movedBy(task({ owner: 'Mike' }), { owner: 'Mike' }).textFromTask).toEqual({ taskId: 'F-1', ...unsetByTheFile, dependencies: [] });
      // Schedule batch S6, item 1: a priority he had set on the task (a Low: no import gives one) is taken, and named.
      const lowered = movedBy(task({ priority: 'Low' }));
      expect([lowered.priority, lowered.priorityAsImported, lowered.textFromTask]).toEqual(['Low', 'Medium', { taskId: 'F-1', ...ALL_BLANK, dependencies: [], priority: 'Low' }]);
    });

    it('first sent, a field still as taken takes what the cloud\'s row of the task has now, a clear too, and the row is stamped after all its own times', () => {
      const row = movedBy(task({ notes: NOTE, owner: 'Mike' }));
      const cloudsTask = task({ notes: '', owner: 'Lee', updatedAt: '2026-09-09T08:00:00.000Z' });
      const sent = scheduleItemAgainstItsTask(row, cloudsTask, 'ask');
      expect(sent.asked).toEqual([]);
      expect(sent.row).toMatchObject({ id: 'G-1', notes: '', owner: 'Lee', textFromTask: { taskId: 'F-1', notes: '', owner: 'Lee' } });
      expect(Date.parse(sent.row.updatedAt!)).toBeGreaterThan(Date.parse(row.importedAt!));
      // Review P4 F1: a blank it took as well (the device that approved had heard of no owner).
      const tookNothing = scheduleItemAgainstItsTask(movedBy(task({})), task({ owner: 'Lee', notes: NOTE }), 'ask');
      expect([tookNothing.asked, tookNothing.row.owner, tookNothing.row.notes]).toEqual([[], 'Lee', NOTE]);
    });

    it('a field set on the new row since stands while the task\'s row is as taken; changed on both, it is asked about, with the task\'s value on the row meanwhile; never a field the file stated', () => {
      const row = movedBy(task({ notes: NOTE, owner: 'Mike' }), { contractor: 'Acme Framing' });
      const typedHere = { ...row, notes: 'Typed on the new row', updatedAt: '2026-09-11T09:00:00.000Z' };
      expect(scheduleItemAgainstItsTask(typedHere, task({ notes: NOTE, owner: 'Mike', contractor: 'Other' }), 'ask')).toMatchObject({ row: typedHere, asked: [] });
      const changedThereToo = task({ notes: 'Changed on the iPad', owner: 'Mike', contractor: 'Other' });
      const both = scheduleItemAgainstItsTask(typedHere, changedThereToo, 'ask');
      expect([both.asked, both.base.fields]).toEqual([['notes'], { notes: NOTE }]);
      expect(both.row).toMatchObject({ notes: 'Changed on the iPad', owner: 'Mike', contractor: 'Acme Framing', textFromTask: { notes: 'Changed on the iPad' } });
      // A clear is a change like any other: his clear on the new row against another note typed on the task.
      expect(scheduleItemAgainstItsTask({ ...typedHere, notes: '' }, changedThereToo, 'ask').asked).toEqual(['notes']);
      // Where nothing can be asked (Set Active, Make Current) the caller says which row was changed later.
      expect(scheduleItemAgainstItsTask(typedHere, changedThereToo, 'row').row).toBe(typedHere);
      expect(scheduleItemAgainstItsTask(typedHere, changedThereToo, 'task')).toMatchObject({ row: { notes: 'Changed on the iPad' }, asked: [] });
      expect(scheduleItemAgainstItsTask(row, task({ notes: NOTE, owner: 'Mike' }), 'ask').row).toBe(row);
      expect(scheduleItemAgainstItsTask(row, null, 'ask').row).toBe(row);
    });

    it('review N3 C: first sent, a row whose controls already read as the task\'s is not written again or stamped; controls set on the task\'s row meanwhile are merged in though the row took none', () => {
      const controls = reviseProjectControls({ current: undefined, patch: { approvalStatus: 'Approved' }, actor: 'David', now: '2026-09-08T08:00:00.000Z' });
      const row = movedBy(task({ projectControls: controls }));
      expect(row).toMatchObject({ textFromTask: { taskId: 'F-1' }, projectControls: controls });
      expect(scheduleItemAgainstItsTask(row, task({ projectControls: controls }), 'ask').row).toBe(row);
      // Review P4 F1 (the reviewer's A): the device that approved had heard of no approval.
      const tookNone = scheduleItemAgainstItsTask(movedBy(task({})), task({ projectControls: controls }), 'ask');
      expect(normalizeProjectControls(tookNone.row.projectControls).approvalStatus).toBe('Approved');
    });

    it('first sent, a field the row has blank and the cloud\'s row of the task has missing reads the same: nothing is written, and the row is not stamped', () => {
      const row = movedBy(task({ notes: NOTE }));
      const { owner: _owner, contractor: _contractor, ...cloudsTask } = task({ notes: NOTE });
      expect(scheduleItemAgainstItsTask(row, cloudsTask as ScheduleItem, 'ask').row).toBe(row);
      // And a note cleared on the task reads the same as one the row took as '' and still has.
      const cleared = { ...row, notes: '', textFromTask: { taskId: 'F-1', notes: '' } };
      const { notes: _notes, ...cloudsTaskWithNone } = task({});
      expect(scheduleItemAgainstItsTask(cleared, cloudsTaskWithNone as ScheduleItem, 'ask').row).toBe(cleared);
    });

    it('review P4: what a row says it took goes with the field\'s value when a whole copy of the row meets the cloud\'s (the record is not put back to an older one)', () => {
      // The cloud's row: an owner sent on to it from the row it replaces, and its record says so.
      const cloud = task({ id: 'G-1', owner: 'Mike', textFromTask: { taskId: 'F-1', owner: 'Mike', notes: '' }, updatedAt: '2026-09-09T09:00:00.000Z' });
      // A device that had not heard holds the row as first saved, and a master approved there leaves the task where it
      // is: a whole copy of the row waits to go up.
      const before = task({ id: 'G-1', textFromTask: { taskId: 'F-1', owner: '', notes: '' } });
      const whole = { ...before, alsoImportedInBatchIds: ['batch-I'] } as ScheduleItem;
      const base = scheduleItemWholeCopyBase(before);
      // (It was: the cloud's owner beside this device's record, a blank. Cleared on the row after that, the owner read
      // as "a blank the row took" and came back from the old row. The reviewer's generator, two masters apart, seed 9139.)
      expect(scheduleItemWholeCopyOverCloud(whole, base, cloud)).toMatchObject({ owner: 'Mike', textFromTask: { taskId: 'F-1', owner: 'Mike', notes: '' } });
      expect(scheduleItemWholeCopyAgainstCloud(whole, whole, base, cloud).itemData).toMatchObject({ owner: 'Mike', textFromTask: { taskId: 'F-1', owner: 'Mike', notes: '' } });
      // A field this device changed goes up with its own entry; and a record of another row is left alone.
      const typedHere = { ...whole, notes: NOTE };
      const cloudSaysOtherwise = { ...cloud, textFromTask: { taskId: 'F-1', owner: 'Mike', notes: 'In the cloud\'s record' } };
      expect(scheduleItemWholeCopyAgainstCloud(typedHere, typedHere, base, cloudSaysOtherwise).itemData).toMatchObject({ owner: 'Mike', notes: NOTE, textFromTask: { owner: 'Mike', notes: '' } });
      expect(scheduleItemWholeCopyOverCloud(whole, base, { ...cloud, textFromTask: { taskId: 'E-1', owner: 'Mike' } }).textFromTask).toEqual({ taskId: 'F-1', owner: '', notes: '' });
    });

    it('an edit typed on the old row, as an edit of the task\'s new row: his values, from the copy his edit started from; nothing for a field with no such copy or the same value', () => {
      const newRow = task({ id: 'G-1', notes: NOTE, owner: 'Mike' });
      // (The field with no part in this was the priority until schedule batch S5, item 1, which makes it follow the task:
      // the milestone flag stands in for it here, and the priority has its own line at the end.)
      const edit = { itemData: task({ notes: '', owner: 'Mike', isMilestone: true }), changedFields: ['notes', 'isMilestone', 'updatedAt'], base: { updatedAt: null, fields: { notes: NOTE, isMilestone: false } } };
      expect(scheduleItemTextEditOnRow(edit, edit.changedFields, newRow)).toEqual({
        id: 'G-1', itemData: { ...newRow, notes: '' }, changedFields: ['notes', 'updatedAt'], base: { updatedAt: null, fields: { notes: NOTE } }, sentOn: [],
      });
      // Sent on to the row that replaced the very row he typed on, the field is named as the sync's write there (that
      // row's record of what it took follows it); not on a row two masters on, whose record is of the row in between.
      const replacesIt = { ...newRow, textFromTask: { taskId: 'F-1', notes: NOTE } };
      expect(scheduleItemTextEditOnRow({ ...edit, id: 'F-1' }, edit.changedFields, replacesIt)!.sentOn).toEqual(['notes']);
      expect(scheduleItemTextEditOnRow({ ...edit, id: 'E-1' }, edit.changedFields, replacesIt)!.sentOn).toEqual([]);
      expect(scheduleItemTextEditOnRow({ ...edit, base: undefined }, edit.changedFields, newRow)).toBeNull();
      expect(scheduleItemTextEditOnRow(edit, edit.changedFields, { ...newRow, notes: '' })).toBeNull();
      expect(scheduleItemTextEditOnRow(edit, ['isMilestone', 'updatedAt'], newRow)).toBeNull();
      // Nor a field the edit holds as it started (typed and typed back): no change of his to send on, whatever that row has.
      expect(scheduleItemTextEditOnRow({ ...edit, base: { updatedAt: null, fields: { notes: '', isMilestone: false } } }, edit.changedFields, newRow)).toBeNull();
      // Schedule batch S5, item 1: a priority he set on the old row does go on to the task's row, as his edit.
      const priority = { itemData: task({ notes: NOTE, owner: 'Mike', priority: 'High' }), changedFields: ['priority', 'updatedAt'], base: { updatedAt: null, fields: { priority: 'Medium' } } };
      expect(scheduleItemTextEditOnRow(priority, priority.changedFields, newRow)).toMatchObject({ id: 'G-1', itemData: { priority: 'High' }, changedFields: ['priority', 'updatedAt'], base: { fields: { priority: 'Medium' } } });
    });

    it('review P4 F3: nor a field whose value in the edit is the very value the new row says it took from the row he typed on: that row was made after the edit, from it', () => {
      const ownerTyped = { id: 'F-1', itemData: task({ owner: 'Mike', updatedAt: '2026-09-09T09:00:00.000Z' }), changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' } } };
      const madeLater = { importedAt: '2026-09-10T18:00:00.000Z', createdAt: '2026-09-10T18:00:00.000Z' };
      // The new row took "Mike" from F-1 and he has cleared it there since: "Mike" is not sent on over the clear.
      const clearedSince = task({ id: 'G-1', owner: '', textFromTask: { taskId: 'F-1', owner: 'Mike' }, updatedAt: '2026-09-11T09:00:00.000Z', ...madeLater });
      expect(scheduleItemTextEditOnRow(ownerTyped, ownerTyped.changedFields, clearedSince)).toBeNull();
      // Nor over "Ana", typed there since (it was: Review Conflicts asking about his own two entries).
      expect(scheduleItemTextEditOnRow(ownerTyped, ownerTyped.changedFields, { ...clearedSince, owner: 'Ana' })).toBeNull();
      // A row made by a device that had not heard of this edit took a blank: there it is news, and goes on.
      const madeUnheard = task({ id: 'G-1', owner: '', textFromTask: { taskId: 'F-1', owner: '' }, ...madeLater });
      expect(scheduleItemTextEditOnRow(ownerTyped, ownerTyped.changedFields, madeUnheard)).toMatchObject({ id: 'G-1', itemData: { owner: 'Mike' }, base: { fields: { owner: '' } } });
      // And only the row he typed on counts: a row that took "Mike" from another row was not made from this edit.
      const tookItElsewhere = task({ id: 'H-1', owner: 'Ana', textFromTask: { taskId: 'G-1', owner: 'Mike' }, updatedAt: '2026-09-11T09:00:00.000Z', ...madeLater });
      expect(scheduleItemTextEditOnRow(ownerTyped, ownerTyped.changedFields, tookItElsewhere)).toMatchObject({ id: 'H-1', itemData: { owner: 'Mike' }, base: { fields: { owner: '' } } });
      // Nor a row saved BEFORE he typed, though it says it took the same value (a blank, here): he typed a note on the
      // old row and cleared it again; the newest row, saved days earlier with nothing to take, holds that note from
      // the first edit going on. The clear goes on too. (The reviewer's generator, full profile, seed 5187: it did not.)
      const noteCleared = { id: 'F-1', itemData: task({ notes: '', updatedAt: '2026-09-09T18:59:00.000Z' }), changedFields: ['notes', 'updatedAt'], base: { updatedAt: null, fields: { notes: NOTE } } };
      const savedBefore = task({ id: 'G-1', notes: NOTE, textFromTask: { taskId: 'F-1', notes: '' }, importedAt: '2026-09-08T02:48:00.000Z', createdAt: '2026-09-08T02:48:00.000Z', updatedAt: '2026-09-09T00:24:00.000Z' });
      expect(scheduleItemTextEditOnRow(noteCleared, noteCleared.changedFields, savedBefore)).toMatchObject({ id: 'G-1', itemData: { notes: '' }, base: { fields: { notes: NOTE } } });
    });
  });

  it('the old row\'s cloud copy cannot be read just then: the new row waits on the device, and goes up right at the next try', async () => {
    const { phone, ipad, oldId } = await onBoth({ notes: NOTE });
    setOnline(phone, false);
    at('2026-09-09T08:00:00.000Z');
    await edit(ipad, oldId, { notes: '' });
    await backgroundUpload(ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    const newId = theRow(phone).id;
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    mockCloud.unlisted.add(oldId);
    mockCloud.unreadable.add(oldId);
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toBeUndefined();
    expect((await queueOf(phone)).length).toBeGreaterThan(0);
    mockCloud.unreadable.clear();
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: '' });
    mockCloud.unlisted.clear();
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
  });
});

/* ---------------------------------------------------------------------------------------------------------------------
 * Review pass 4 (6 Oct 2026). The tests below are appended after the rig, which is left as it was line for line (the
 * pass-4 reviewer's generator is built from this file's first 1027 lines).
 * ------------------------------------------------------------------------------------------------------------------- */
/** The App's own normalizeScheduleItem, compiled from App.tsx: the phone and the iPad hold every task as it leaves it. */
const appNormalize: (value: ScheduleItem) => ScheduleItem = (() => {
  let made: ((value: Partial<ScheduleItem>) => ScheduleItem) | null = null;
  return (value: ScheduleItem) => {
    if (!made) {
      const constant = (name: string) => {
        const match = new RegExp(`\\nconst ${name}[:= ][^;]*;`).exec(APP);
        if (!match) throw new Error(`App.tsx has no constant ${name}`);
        return match[0];
      };
      const source = [constant('SCHEDULE_PRIORITIES'), constant('zeroPad'), appFunction('parseFlexibleDate'), appFunction('formatAppDate'), appFunction('normalizeScheduleItem'),
        'module.exports = { normalizeScheduleItem };'].join('\n');
      made = evaluate<{ normalizeScheduleItem: (value: Partial<ScheduleItem>) => ScheduleItem }>(transpile(source), {
        reconcileScheduleProgress: require('../../services/ScheduleProgressInvariant').reconcileScheduleProgress, uid, optionalString,
        normalizeProjectItemType: require('../../services/ProjectItemWorkflow').normalizeProjectItemType,
        normalizeProjectItemActivity: require('../../services/ProjectItemWorkflow').normalizeProjectItemActivity,
        projectTimeZoneOrDefault: require('../../services/ProjectDateTime').projectTimeZoneOrDefault,
        parseMonthNameDateParts: require('../../services/ProjectDateTime').parseMonthNameDateParts,
        normalizeScheduleDependencies: require('../../services/VitruviusScheduleEngine').normalizeScheduleDependencies,
        normalizeImportedScheduleNote: require('../../services/PIEScheduleIntelligence').normalizeImportedScheduleNote, normalizeProjectControls,
        normalizeDAVECompletionVerification: require('../../services/DAVECompletionVerification').normalizeDAVECompletionVerification,
      }).normalizeScheduleItem;
    }
    return made(value);
  };
})();
/** This device's tasks as the app holds them after reading them (the rig passes tasks through as they are). */
function heldAsTheAppHoldsThem(device: Device) {
  setter(device)(device.state.map(appNormalize));
  device.ref.current = device.state;
}
/** A master uploaded on the web desktop and not made current (the web's own plan, its rows written as planned). */
function webUploads(id: string, lines: string[]): ReferenceDocument {
  const { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } = require('../../services/DAVEWebOperations');
  const when = new Date().toISOString();
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: `${id}.csv`, mimeType: 'text/csv', sizeBytes: 300, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: 'd'.repeat(64), now: when,
  } as never);
  const document = { ...(prepared.document as ReferenceDocument), id, importBatchId: `batch-${id}` } as ReferenceDocument;
  const rows = (prepared.scheduleItems as ScheduleItem[]).map((row, index) => ({ ...row, id: `${id}-${index + 1}`, importBatchId: document.importBatchId, sourceDocumentId: id }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown().map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) } as never, importedScheduleItems: rows });
  const plain = (item: ScheduleItem) => { const { cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
  plan.additions.forEach((item: ScheduleItem) => webWrite(plain(item)));
  plan.revisions.forEach((revision: { item: ScheduleItem }) => webWrite(plain(revision.item)));
  cloudDocuments = [...cloudDocuments, document];
  mockCloud.documents = cloudDocuments;
  return document;
}
/** A master uploaded on the web desktop and made current there (the web's own plan and activation, its rows written as planned). */
function webUploadsAndMakesCurrent(id: string, lines: string[]): ReferenceDocument {
  const { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } = require('../../services/DAVEWebOperations');
  const { scheduleProgressCarriedToShownTasks } = require('../../services/ScheduleImportMerge');
  const when = new Date().toISOString();
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: `${id}.csv`, mimeType: 'text/csv', sizeBytes: 300, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: 'd'.repeat(64), now: when,
  } as never);
  const document = { ...(prepared.document as ReferenceDocument), id, importBatchId: `batch-${id}` } as ReferenceDocument;
  const rows = (prepared.scheduleItems as ScheduleItem[]).map((row, index) => ({ ...row, id: `${id}-${index + 1}`, importBatchId: document.importBatchId, sourceDocumentId: id }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown().map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) } as never, importedScheduleItems: rows });
  const plain = (item: ScheduleItem) => { const { cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
  plan.additions.forEach((item: ScheduleItem) => webWrite(plain(item)));
  plan.revisions.forEach((revision: { item: ScheduleItem }) => webWrite(plain(revision.item)));
  cloudDocuments = [...cloudDocuments, document];
  const shownBefore = webShown();
  const documentsBefore = cloudDocuments;
  cloudDocuments = scheduleDocumentsAfterActivation(document, cloudDocuments, 'project', when);
  mockCloud.documents = cloudDocuments;
  (scheduleProgressCarriedToShownTasks({ before: shownBefore, after: webShown(), documentsBefore, documentsAfter: cloudDocuments, now: when, known: cloudItems() }) as ScheduleItem[]).forEach(webWrite);
  return document;
}

describe('Review P4 F2: his first next step or hand link on a task of a master the web uploaded', () => {
  const noCards = async (phone: Device, ipad: Device) => expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  const framingOn = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Framing')!;

  it('goes up and stays on the task, on the phone, the iPad and the web; Review Conflicts has nothing to ask', async () => {
    const { phone, ipad } = await start();
    at(G.importedAt!);
    webUploadsAndMakesCurrent('MASTER G', [G_ROW, SURVEY]);
    // The row the web wrote has no next step and no links at all; the phone holds it with a blank one and an empty list.
    expect(Object.keys(cloudRow('MASTER G-1')!)).not.toEqual(expect.arrayContaining(['nextAction']));
    expect(Object.keys(cloudRow('MASTER G-1')!)).not.toEqual(expect.arrayContaining(['dependencies']));
    at('2026-09-11T09:00:00.000Z');
    await refresh(phone); await refresh(ipad);
    heldAsTheAppHoldsThem(phone); heldAsTheAppHoldsThem(ipad);
    expect(theRow(phone)).toMatchObject({ id: 'MASTER G-1', nextAction: '', dependencies: [] });
    await edit(phone, theRow(phone).id, { nextAction: 'Call the inspector' });
    const survey = deviceShown(phone).find(item => item.taskName === 'Survey')!;
    await edit(phone, theRow(phone).id, { dependencies: [{ predecessorItemId: survey.id, type: 'FS', lagDays: 0 }] } as never);
    await edit(phone, theRow(phone).id, { isMilestone: true } as never);
    // (It was: neither in the cloud, and a card "Next action: Call the inspector / (none) · Predecessors: 1 item / (none)".)
    await backgroundUpload(phone);
    await noCards(phone, ipad);
    expect(cloudRow('MASTER G-1')).toMatchObject({ nextAction: 'Call the inspector', dependencies: [{ predecessorItemId: survey.id, type: 'FS', lagDays: 0 }], isMilestone: true });
    at('2026-09-12T08:00:00.000Z');
    await settle(phone, ipad);
    heldAsTheAppHoldsThem(phone); heldAsTheAppHoldsThem(ipad);
    for (const shown of [deviceShown(phone), deviceShown(ipad), webShown()]) {
      expect(framingOn(shown)).toMatchObject({ id: 'MASTER G-1', nextAction: 'Call the inspector', isMilestone: true });
      expect(framingOn(shown).dependencies).toEqual([{ predecessorItemId: survey.id, type: 'FS', lagDays: 0 }]);
    }
    await noCards(phone, ipad);
  });

  it('review P4 P2-5: a lookahead approved with no signal on such a task keeps its dates when the iPad types a note meanwhile (review N1\'s rule holds for a row the web\'s upload wrote)', async () => {
    const { phone, ipad } = await start();
    at(G.importedAt!);
    webUploadsAndMakesCurrent('MASTER G', [G_ROW, SURVEY]);
    at('2026-09-11T09:00:00.000Z');
    await refresh(phone); await refresh(ipad);
    heldAsTheAppHoldsThem(phone); heldAsTheAppHoldsThem(ipad);
    setOnline(phone, false);
    const L2 = scheduleDoc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
    at(L2.importedAt!);
    await approve(phone, L2, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
    heldAsTheAppHoldsThem(phone);
    at('2026-09-11T15:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: NOTE });
    await backgroundUpload(ipad);
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    // (It was: the phone's copy holds an empty activity list, blank controls and a time zone the cloud's row lacks, so
    // "the rest of the row" read as changed, the cloud's later row was taken whole, and the lookahead's dates were on
    // no device.)
    expect(cloudRow('MASTER G-1')).toMatchObject({ startDate: '10/22/2026', finishDate: '11/01/2026', notes: NOTE });
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 0, NOTE, '']]));
    await noCards(phone, ipad);
  });

  it('and a next step the web typed there meanwhile is still asked about', async () => {
    const { phone, ipad } = await start();
    at(G.importedAt!);
    webUploadsAndMakesCurrent('MASTER G', [G_ROW, SURVEY]);
    at('2026-09-11T09:00:00.000Z');
    await refresh(phone);
    heldAsTheAppHoldsThem(phone);
    setOnline(phone, false);
    await edit(phone, theRow(phone).id, { nextAction: 'Call the inspector' });
    at('2026-09-11T10:00:00.000Z');
    webWrite(webEdited(cloudRow('MASTER G-1')!, { nextAction: 'Order rebar' }));
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    await backgroundUpload(phone);
    expect(cloudRow('MASTER G-1')).toMatchObject({ nextAction: 'Order rebar' });
    expect((await conflictsOf(phone)).map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields)).toEqual([['nextAction']]);
    expect(await conflictsOf(ipad)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------------------------------
 * Review P4 F1, F3, F4, F5, F6 (6 Oct 2026), and the sync reviewer's P2-2 and P2-3: one rule.
 *
 * A row a master makes for a task says which row it replaces and what that row had of each thing David sets on a task
 * (textFromTask). That record is the copy the new row started from. Wherever the two rows meet, each field is weighed
 * from it by the rules of owner answer Q28: only one side changed it, that side stands; both did, he is asked; a clear
 * is a change. The findings were the places where a value copied forward was later taken for something else.
 * ------------------------------------------------------------------------------------------------------------------- */
describe('Review P4: what he has set on a task that a master moves, whatever the order and whichever device', () => {
  const H = scheduleDoc('MASTER H', '2026-09-17T18:00:00.000Z');
  const H_ROW = 'Framing,Alpha,Lot,10/27/2026,11/06/2026,';
  const ON_H = (percent: number, note: string, owner: string) => Array(3).fill([['10/27/2026', '11/06/2026', percent, note, owner]]);
  const controlsOf = (row: ScheduleItem | undefined) => { const controls = normalizeProjectControls(row?.projectControls); return [controls.approvalStatus, controls.estimatedScheduleImpactDays]; };
  const controlsEverywhere = (phone: Device, ipad: Device) => [controlsOf(theRow(phone)), controlsOf(theRow(ipad)), controlsOf(framingOf(webShown())[0])];
  const setControls = (device: Device, id: string, change: Partial<ProjectControls>) => edit(device, id, {
    projectControls: reviseProjectControls({ current: device.state.find(item => item.id === id)!.projectControls, patch: change, actor: 'David', now: new Date().toISOString() }),
  });
  const cards = async (device: Device) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'schedule_item').map(conflict => {
    const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
    const fields = mine.askedFields ?? [];
    return { row: conflict.localId, fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
  });
  const noCards = async (phone: Device, ipad: Device) => expect([await cards(phone), await cards(ipad)]).toEqual([[], []]);
  /** Everything delivered and uploaded, both ways, with Sync Now on each as well. */
  async function allSynced(phone: Device, ipad: Device) {
    setOnline(phone, true); setOnline(ipad, true);
    for (let round = 0; round < 3; round += 1) {
      for (const device of [phone, ipad]) { shareDocuments(device); await backgroundUpload(device); await echoes(device); await tombstoneEchoes(device); await refresh(device); }
      for (const device of [phone, ipad]) { shareDocuments(device); await fullSync(device); }
    }
  }
  /** The phone, with no signal and having heard nothing since, approves master G, which moves Framing. */
  async function phoneApprovesWithNoSignal(phone: Device) {
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    return theRow(phone).id;
  }

  describe('F1: set on one device, the master approved with no signal on the other, which had not heard', () => {
    it('A: an approval status and a schedule impact set on the iPad are on the task after the phone\'s master moves it', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await setControls(ipad, theRow(ipad).id, { estimatedScheduleImpactDays: 5 });
      await backgroundUpload(ipad);
      const newId = await phoneApprovesWithNoSignal(phone);
      // The phone's new row took nothing (it had heard of nothing), and says so: that is what it is weighed from.
      expect(theRow(phone).textFromTask).toMatchObject({ taskId: 'MASTER F-1', owner: '', notes: '' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      // (It was: "Not Required" and no impact on every device; they stayed on the hidden old row. No card.)
      expect(controlsOf(cloudRow(newId))).toEqual(['Pending', 5]);
      await allSynced(phone, ipad);
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', 5]));
      await noCards(phone, ipad);
    });

    it('A2: the other order (the master first, then the approval and a note on the iPad, which has signal and has not heard): both follow', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await edit(ipad, theRow(ipad).id, { notes: 'Inspector Tuesday' });
      await backgroundUpload(ipad);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: the note followed, by the sync's carry; the approval did not.)
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Inspector Tuesday', ''));
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', null]));
      await noCards(phone, ipad);
    });

    it('A3: the same as A with the approval set on the web', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      const row = cloudRow(theRow(ipad).id)!;
      webWrite(webEdited(row, { projectControls: reviseProjectControls({ current: row.projectControls, patch: { approvalStatus: 'Pending' }, actor: 'David', now: new Date().toISOString() }) }));
      await phoneApprovesWithNoSignal(phone);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', null]));
      await noCards(phone, ipad);
    });

    it('B: a note and an owner typed on the iPad; the phone approves the master and then enters a percent on the task: all three are on it', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { notes: 'Inspector Tuesday' });
      await edit(ipad, theRow(ipad).id, { owner: 'Mike' });
      await backgroundUpload(ipad);
      await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 30 });
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: the percent stamped the new row, so the carry, which goes by one time per row, left the note and the
      // owner behind. Recorded then as a limit of the carry.)
      expect(await everywhere(phone, ipad)).toEqual(ON_G(30, 'Inspector Tuesday', 'Mike'));
      await noCards(phone, ipad);
    });

    it.each([['the web', true], ['the iPad', false]])('X: the phone approves and types owner Mike on the task; later %s types Ana on the task as it still shows: he is asked, and Ana shows until he chooses', async (_who, onWeb) => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: 'Mike' });
      at('2026-09-11T15:00:00.000Z');
      if (onWeb) webWrite(webEdited(cloudRow('MASTER F-1')!, { owner: 'Ana' }));
      else { await edit(ipad, theRow(ipad).id, { owner: 'Ana' }); await backgroundUpload(ipad); }
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: Mike everywhere, Ana on the hidden row, and no card, though both changed it and Ana is the later.)
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Ana'));
      expect([await cards(phone), await cards(ipad)]).toEqual([[{ row: newId, fields: ['owner'], here: ['Mike'], cloud: ['Ana'] }], []]);
      // The card keeps the copy both started from: the blank the new row took.
      expect(((await conflictsOf(phone))[0].localPayload as { base?: { fields?: unknown } }).base?.fields).toEqual({ owner: '' });
      // Keep Phone: Mike everywhere.
      await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_local');
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Mike'));
      await noCards(phone, ipad);
    });

    it.each([['the device that typed on the old row', true], ['the device that approved the master', false]])('the sync reviewer\'s P2-2: an owner on the new row, another on the old row; whichever syncs first (%s), he is asked', async (_first, oldRowFirst) => {
      const { phone, ipad } = await start();
      at(G.importedAt!);
      setOnline(ipad, false);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      at('2026-09-11T09:00:00.000Z');
      await edit(ipad, newId, { owner: 'Ana' });
      if (!oldRowFirst) { setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad); setOnline(ipad, false); setOnline(phone, false); }
      at('2026-09-11T15:00:00.000Z');
      await edit(phone, 'MASTER F-1', { owner: 'Bob' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      await backgroundUpload(phone);
      await allSynced(phone, ipad);
      // (It was, with the old-row edit first: the iPad's owner everywhere and nothing asked.)
      const asked = [...await cards(phone), ...await cards(ipad)];
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ row: newId, fields: ['owner'] });
      expect([asked[0].here[0], asked[0].cloud[0]].sort()).toEqual(['Ana', 'Bob']);
    });
  });

  describe('F3: one device, no signal throughout', () => {
    it('C: he types owner Mike, approves the master, clears the owner, gets signal back: cleared everywhere', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: 'Mike' });
      const newId = await phoneApprovesWithNoSignal(phone);
      expect(theRow(phone)).toMatchObject({ id: newId, owner: 'Mike' });
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: '' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      // His older edit of the old row has gone up first, so the new row was weighed against a row that holds it.
      expect([cloudRow('MASTER F-1')!.owner, cloudRow(newId)!.owner]).toEqual(['Mike', '']);
      await allSynced(phone, ipad);
      // (It was: Mike on the phone, the iPad and the web. His older edit of the old row was sent on to the new row
      // after it and went over the clear.)
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
      await noCards(phone, ipad);
    });

    it('C2: he changes Mike to Ana instead: Ana everywhere, and nothing is asked about his own two entries', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: 'Mike' });
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: 'Ana' });
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: a card "Owner: Mike / Ana", and Keep Phone there put the older one everywhere.)
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Ana'));
      await noCards(phone, ipad);
    });

    it('C3: the same with a note, by upload and then refresh', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { notes: 'Crew short' });
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { notes: '' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      expect(framingOf(webShown())[0].notes || '').toBe('');
      await refresh(phone);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
      await noCards(phone, ipad);
    });

    it('the old-row edit could not go up in that pass and arrives after the new row: it is still not sent on over what he set since', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: 'Mike' });
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: '' });
      // The old row's edit is held back for one pass (as when its write fails): only the new row goes up.
      const store = mockStores.get('phone')!;
      const queueKey = 'projectVisionAI.syncQueue.v1';
      const queued = JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { id?: string } }>;
      const oldRowEdit = queued.filter(item => item.payload?.id === 'MASTER F-1');
      expect(oldRowEdit).toHaveLength(1);
      store.set(queueKey, JSON.stringify(queued.filter(item => item.payload?.id !== 'MASTER F-1')));
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      expect(cloudRow(newId)).toMatchObject({ owner: '' });
      store.set(queueKey, JSON.stringify([...JSON.parse(store.get(queueKey) || '[]'), ...oldRowEdit]));
      await backgroundUpload(phone);
      // The new row says it took "Mike" from the row he typed it on: it was made after that edit, from it.
      expect([cloudRow('MASTER F-1')!.owner, cloudRow(newId)!.owner]).toEqual(['Mike', '']);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', ''));
      await noCards(phone, ipad);
    });
  });

  describe('F4: an owner he cleared, and the next master', () => {
    it('E: the iPad enters a percent on the old row with no signal; the phone\'s master moves the task and he clears the owner; a week later the next master moves it again: still cleared', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: 'Mike' });
      await backgroundUpload(phone);
      await refresh(ipad);
      at('2026-09-09T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-09T12:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { percentComplete: 40 });
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: '' });
      await backgroundUpload(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad); await backgroundUpload(ipad); await refresh(ipad); await refresh(phone);
      expect([onDevice(phone), onDevice(ipad)]).toEqual(Array(2).fill([['10/20/2026', '10/30/2026', 40, '', '']]));
      at(H.importedAt!);
      await approve(phone, H, [H_ROW, SURVEY]);
      // H's row took a blank owner from G's row, and says so: that blank is not one to fill.
      expect(theRow(phone).textFromTask).toMatchObject({ taskId: 'MASTER G-1', owner: '' });
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-18T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: Mike again on every device. The oldest row, still holding Mike and stamped later by the iPad's
      // percent, was "the row changed last", and lent its owner to the blank on the newest row.)
      expect(await everywhere(phone, ipad)).toEqual(ON_H(40, '', ''));
      await noCards(phone, ipad);
    });
  });

  it('a note sent on to the task\'s new row and cleared there stays cleared when the old row is changed later by something else (the new row\'s record follows what the sync writes on it)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    const newId = theRow(phone).id;
    // The iPad, which has not heard of the master, types a note on the row it still sees. It goes up, and on to the new row.
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, 'MASTER F-1', { notes: NOTE });
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, textFromTask: { taskId: 'MASTER F-1', notes: NOTE } });
    // He clears it on the phone, on the task's row; the iPad, with no signal again and still on the old row, enters a percent.
    setOnline(ipad, false);
    await refresh(phone);
    at('2026-09-12T09:00:00.000Z');
    await edit(phone, newId, { notes: '' });
    await backgroundUpload(phone);
    at('2026-09-13T09:00:00.000Z');
    await edit(ipad, 'MASTER F-1', { percentComplete: 40 });
    at('2026-09-14T08:00:00.000Z');
    await allSynced(phone, ipad);
    // (Without the record following the note sent on, the cleared note read as "a blank the row took"; the old row,
    // still holding the note and stamped later by the percent, gave it back.)
    expect(await everywhere(phone, ipad)).toEqual(ON_G(40, '', ''));
    await noCards(phone, ipad);
  });

  describe('F5: a device with no signal across two masters', () => {
    it.each([['owner', 'A', 'B'], ['notes', 'Surveyor late', 'Stakes set']] as const)('his %s typed on the oldest row, another typed on the task between the two masters: he is asked, and the later one shows until he chooses', async (field, onOldest, between) => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { [field]: onOldest });
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { [field]: between });
      await backgroundUpload(phone);
      at(H.importedAt!);
      await approve(phone, H, [H_ROW, SURVEY]);
      shareDocuments(phone); await backgroundUpload(phone);
      const newestId = theRow(phone).id;
      expect(cloudRow(newestId)).toMatchObject({ [field]: between });
      at('2026-09-18T08:00:00.000Z');
      setOnline(ipad, true);
      await backgroundUpload(ipad);
      // (It was: the older one over it in the cloud, on every device, with nothing asked. The text typed in between
      // and copied on by the second master was taken for text the sync's carry had brought forward.)
      expect(cloudRow(newestId)).toMatchObject({ [field]: between });
      await allSynced(phone, ipad);
      expect([await cards(phone), await cards(ipad)]).toEqual([[], [{ row: newestId, fields: [field], here: [onOldest], cloud: [between] }]]);
      expect(await everywhere(phone, ipad)).toEqual(field === 'owner' ? ON_H(0, '', between) : ON_H(0, between, ''));
    });
  });

  it('an owner typed and cleared again with no signal on the old row is no change of his: the owner set on the task elsewhere meanwhile stays on its new row, his note goes on, and nothing is asked', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at('2026-09-09T09:00:00.000Z');
    await edit(phone, 'MASTER F-1', { owner: 'Mike' });
    await backgroundUpload(phone);
    await edit(ipad, 'MASTER F-1', { owner: 'Ana' });
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, 'MASTER F-1', { owner: '', notes: NOTE });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    // On the row he typed on the cloud's owner stays (owner answer Q28: back to the copy the edit started from). The
    // same on the task's new row. (It was: the blank sent on to the new row as his clear, over the copy of Mike there;
    // the reviewer's generator, seed 58.)
    expect([cloudRow('MASTER F-1')!.owner, cloudRow(newId)!.owner, cloudRow(newId)!.notes]).toEqual(['Mike', 'Mike', NOTE]);
    await allSynced(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    await noCards(phone, ipad);
  });

  it('an owner both devices knew, cleared on the oldest row by a device with no signal across two masters: cleared on the row shown, and the hidden row in between does not give it back', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    await edit(phone, 'MASTER F-1', { owner: 'Mike' });
    await allSynced(phone, ipad);
    expect(theRow(ipad).owner).toBe('Mike');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    at(H.importedAt!);
    await approve(phone, H, [H_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    const newestId = theRow(phone).id;
    at('2026-09-18T08:00:00.000Z');
    await edit(ipad, 'MASTER F-1', { owner: '' });
    at('2026-09-19T08:00:00.000Z');
    await allSynced(phone, ipad);
    // (The reviewer's generator, seed 3194, on a first form of this fix: the clear went on to the newest row, whose
    // record was then moved to the blank; the row in between, never written, still held Mike, and "a blank it took,
    // where the row it replaces has text now" filled it again.)
    expect(cloudRow(newestId)).toMatchObject({ owner: '' });
    expect(await everywhere(phone, ipad)).toEqual(ON_H(0, '', ''));
    await noCards(phone, ipad);
  });

  describe('F6: two masters approved in a row with no signal', () => {
    it('an owner and an approval changed on the other device meanwhile reach the row the second master shows, not only the first master\'s', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      await edit(phone, theRow(phone).id, { owner: 'Mike' });
      await backgroundUpload(phone);
      await refresh(ipad);
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { owner: 'Lee' });
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await backgroundUpload(ipad);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      at(H.importedAt!);
      await approve(phone, H, [H_ROW, SURVEY]);
      const newestId = theRow(phone).id;
      at('2026-09-18T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      // The first master's row went up before the second's, whichever the queue held first: each was weighed against
      // the row it replaces. (It was: the second row could go up while that row was not in the cloud yet, with nothing
      // to weigh it against; Lee reached the first master's hidden row only.)
      expect([cloudRow('MASTER G-1')!.owner, cloudRow(newestId)!.owner]).toEqual(['Lee', 'Lee']);
      expect(controlsOf(cloudRow(newestId))).toEqual(['Pending', null]);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_H(0, '', 'Lee'));
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', null]));
      await noCards(phone, ipad);
    });
  });

  it('a note typed with no signal on the old row, then a lookahead approved there (the note waits in a whole copy of the task): it reaches the row the phone\'s master moved the task to', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, 'MASTER F-1', { notes: NOTE });
    const L1 = scheduleDoc('LOOKAHEAD L1', '2026-09-11T12:00:00.000Z', 'lookahead');
    at(L1.importedAt!);
    await approve(ipad, L1, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,'], true);
    at('2026-09-12T08:00:00.000Z');
    await allSynced(phone, ipad);
    // (The reviewer's generator, full profile, seed 5216: a whole copy is not sent on to the task's row as an edit is,
    // and with the sync's carry kept to rows that keep no record, the note stayed on the hidden row. The task's row
    // took a blank from that row; the row has text now: the blank is filled from it.)
    expect([framingOf(deviceShown(phone))[0].notes, framingOf(deviceShown(ipad))[0].notes, framingOf(webShown())[0].notes]).toEqual([NOTE, NOTE, NOTE]);
    await noCards(phone, ipad);
  });

  it('a next step typed on the web on the older master\'s row while that master is current again: it is on the task when a master approved elsewhere shows the newer row again', async () => {
    const { phone, ipad } = await start();
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone); await backgroundUpload(phone);
    await refresh(ipad);
    const newId = theRow(ipad).id;
    setOnline(ipad, false);
    // The web makes master F current again and he types a next step there, on F's row (the web sends no edit on).
    at('2026-09-11T09:00:00.000Z');
    cloudDocuments = scheduleDocumentsAfterActivation(cloudDocuments.find(document => document.id === 'MASTER F')!, cloudDocuments, 'project', new Date().toISOString());
    mockCloud.documents = cloudDocuments;
    webWrite(webEdited(cloudRow('MASTER F-1')!, { nextAction: 'Call the inspector' }));
    // The iPad, which has heard of neither, approves a master that leaves Framing where G put it.
    const I = scheduleDoc('MASTER I', '2026-09-11T18:00:00.000Z');
    at(I.importedAt!);
    await approve(ipad, I, [G_ROW, 'Survey,Alpha,Lot,10/13/2026,10/15/2026,']);
    expect(theRow(ipad).id).toBe(newId);
    at('2026-09-12T08:00:00.000Z');
    await allSynced(phone, ipad);
    // (The reviewer's generator, full profile, seed 5014.)
    for (const shown of [deviceShown(phone), deviceShown(ipad), webShown()]) expect(framingOf(shown)[0]).toMatchObject({ id: newId, nextAction: 'Call the inspector' });
    await noCards(phone, ipad);
  });

  it('a note typed before the master\'s new row reached the cloud is on that row when it first goes up (no carry has to wait for it)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    at('2026-09-09T09:00:00.000Z');
    await edit(ipad, theRow(ipad).id, { notes: NOTE });
    await edit(ipad, theRow(ipad).id, { owner: 'Mike' });
    await backgroundUpload(ipad);
    const newId = await phoneApprovesWithNoSignal(phone);
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect(cloudRow(newId)).toMatchObject({ notes: NOTE, owner: 'Mike', textFromTask: { taskId: 'MASTER F-1', notes: NOTE, owner: 'Mike' } });
    await allSynced(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
    await noCards(phone, ipad);
  });

  /** A master's new row for Framing as an approval with no signal saves it: nothing set on it, and it says what it took. */
  const theRowAsApproved = (): ScheduleItem => ({
    id: 'MASTER G-1', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/20/2026', finishDate: '10/30/2026', status: 'Not Started',
    percentComplete: 0, priority: 'Medium', notes: '', owner: '', contractor: '', milestone: '', createdAt: G.importedAt, importedAt: G.importedAt,
    importBatchId: 'batch-MASTER G', sourceDocumentId: 'MASTER G', revisedFromTaskIds: ['MASTER F-1'],
    textFromTask: { taskId: 'MASTER F-1', owner: '', contractor: '', notes: '', nextAction: '', milestone: '' },
  } as ScheduleItem);

  describe('Review P5-1 / S-P5-2: the new row\'s first write reaches the cloud and its answer is lost on weak signal', () => {
    const queuedIds = async (device: Device) => (await queueOf(device)).map(item => (item.payload as { id?: string }).id);

    it('A: the next pass knows its own write: no card for the whole task, and the approval and note set elsewhere are on the task', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending', estimatedScheduleImpactDays: 5 });
      await edit(ipad, theRow(ipad).id, { notes: NOTE });
      await backgroundUpload(ipad);
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      mockCloud.lostAnswers = 1; // the first task write of this pass (the new row's) reaches the cloud; its answer does not come back
      await backgroundUpload(phone);
      expect(cloudRow(newId)).toMatchObject({ notes: NOTE });
      expect(await queuedIds(phone)).toContain(newId);
      const writesBefore = mockCloud.writes.length;
      await backgroundUpload(phone);
      // (It was: a card "This task changed on another device before the local edit finished syncing", this device's
      // own waiting copy against its own first write, with nothing to choose.)
      expect(await cards(phone)).toEqual([]);
      expect(await queuedIds(phone)).not.toContain(newId);
      // Nothing more is written for that row: the cloud holds it already.
      expect(mockCloud.writes.slice(writesBefore).filter(write => write.endsWith(`:${newId}`))).toEqual([]);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, ''));
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', 5]));
      await noCards(phone, ipad);
    });

    it('X2: and the real question is still asked (owner Mike typed on the new row, Ana on the row the iPad still sees); Keep Phone puts Mike everywhere', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: 'Mike' });
      at('2026-09-11T15:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { owner: 'Ana' });
      await backgroundUpload(ipad);
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      mockCloud.lostAnswers = 1;
      await backgroundUpload(phone);
      expect([cloudRow(newId)!.owner, await cards(phone)]).toEqual(['Ana', []]);
      await backgroundUpload(phone);
      // (It was: the whole-task card in its place, and "Mike or Ana" never asked.)
      expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Mike'], cloud: ['Ana'] }]);
      const [card] = await conflictsOf(phone);
      await chooseInSettings(phone, card.id, 'keep_local');
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, '', 'Mike'));
      await noCards(phone, ipad);
    });

    it('the sync reviewer\'s seed 74: the iPad\'s new row went up with the owner the phone set meanwhile; the retry raises nothing, and the iPad shows that owner', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, 'MASTER F-1', { owner: 'Bob', notes: NOTE });
      await backgroundUpload(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad);
      mockCloud.lostAnswers = 1;
      await backgroundUpload(ipad);
      await backgroundUpload(ipad);
      expect([await cards(ipad), await queuedIds(ipad)]).toEqual([[], []]);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Bob', notes: NOTE });
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Bob'));
      await noCards(phone, ipad);
    });

    it('the web types an owner on the new row between that write and the retry (the sync reviewer\'s seed 74 as its generator runs it): still no card, and the web\'s owner stands', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, 'MASTER F-1', { notes: NOTE });
      await backgroundUpload(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad);
      mockCloud.lostAnswers = 1;
      await backgroundUpload(ipad);
      webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      await backgroundUpload(ipad);
      // (It was, also with a first form of this fix that knew only the untouched write: the whole-task card.)
      expect([await cards(ipad), await queuedIds(ipad)]).toEqual([[], []]);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Ana'));
      await noCards(phone, ipad);
    });

    it('Keep Phone\'s kept copy of a master\'s new row is not taken for a first upload met again: it is written as he chose', async () => {
      const { phone } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      webWrite(webEdited(cloudRow(newId)!, { owner: 'Ana' }));
      // A card for the whole task on that row, as a build before this one could leave: the phone's copy, with an owner
      // he typed, against the cloud's.
      on(phone);
      const detectedAt = new Date().toISOString();
      mockStores.get('phone')!.set('projectVisionAI.syncConflicts.v1', JSON.stringify([{
        id: 'conflict-new-row', entity: 'schedule_item', localId: newId, localChangedAt: detectedAt, remoteChangedAt: null,
        reason: 'This task changed on another device before the local edit finished syncing.', detectedAt,
        localPayload: { id: newId, itemData: { ...theRow(phone), owner: 'Mike' } }, remotePayload: cloudRow(newId),
      }]));
      await chooseInSettings(phone, 'conflict-new-row', 'keep_local');
      await backgroundUpload(phone);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Mike' });
      expect(await cards(phone)).toEqual([]);
    });

    it('the rule on the records alone: what is left to send is what he has set on the row since it was made, started from what it took', () => {
      const taskOf = () => (rowId: string) => rowId;
      const waiting = theRowAsApproved();
      const inTheCloud = { ...waiting, owner: 'Bob', notes: NOTE, textFromTask: { ...waiting.textFromTask!, owner: 'Bob', notes: NOTE }, updatedAt: '2026-09-12T08:00:01.000Z' } as ScheduleItem;
      // Nothing set on it here: nothing to send, whatever the cloud's row holds by now.
      expect(scheduleItemNewRowMetAgain(waiting, inTheCloud, taskOf)).toBeNull();
      expect(scheduleItemNewRowMetAgain(waiting, { ...inTheCloud, owner: 'Typed on the web since' }, taskOf)).toBeNull();
      // An owner he set on it: an edit of the owner that started from the blank it took.
      expect(scheduleItemNewRowMetAgain({ ...waiting, owner: 'Mike', updatedAt: '2026-09-11T09:00:00.000Z' }, inTheCloud, taskOf))
        .toEqual({ changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' } } });
      // A link he made on it: with when he made it, started from the links it was made with.
      const linked = { ...waiting, dependencies: [{ predecessorItemId: 'MASTER F-2', type: 'FS' as const, lagDays: 0 }], dependenciesUpdatedAt: '2026-09-11T09:00:00.000Z', updatedAt: '2026-09-11T09:00:00.000Z',
        textFromTask: { ...waiting.textFromTask!, dependencies: [] } } as ScheduleItem;
      expect(scheduleItemNewRowMetAgain(linked, { ...inTheCloud, textFromTask: { ...inTheCloud.textFromTask!, dependencies: [] } }, taskOf))
        .toEqual({ changedFields: ['dependencies', 'dependenciesUpdatedAt', 'updatedAt'], base: { updatedAt: null, fields: { dependencies: [], dependenciesUpdatedAt: null } } });
      // His controls where his entry is the later, to be merged as ever; not where the cloud's row holds more (the first write took the task's).
      const controls = reviseProjectControls({ current: undefined, patch: { approvalStatus: 'Pending' }, actor: 'David', now: '2026-09-11T09:00:00.000Z' });
      expect(scheduleItemNewRowMetAgain({ ...waiting, projectControls: controls, updatedAt: '2026-09-11T09:00:00.000Z' }, inTheCloud, taskOf)).toMatchObject({ changedFields: ['projectControls', 'updatedAt'] });
      expect(scheduleItemNewRowMetAgain(waiting, { ...inTheCloud, projectControls: controls }, taskOf)).toBeNull();
      // Something else on the cloud's row by now (a percent entered on another device) is no change of this copy's: still nothing to send.
      expect(scheduleItemNewRowMetAgain(waiting, { ...inTheCloud, percentComplete: 40 }, taskOf)).toBeNull();
      // Not this case: the copy was changed here since it was made and differs in more than what he sets (his percent typed since); or the row keeps no record.
      expect(scheduleItemNewRowMetAgain({ ...waiting, percentComplete: 40, updatedAt: '2026-09-11T09:00:00.000Z' }, inTheCloud, taskOf)).toBeUndefined();
      expect(scheduleItemNewRowMetAgain({ ...waiting, textFromTask: undefined }, inTheCloud, taskOf)).toBeUndefined();
    });
  });

  describe('Review P5 S-P5-4: the old row\'s write does not go through in the pass where the master\'s new row first goes up', () => {
    it.each([['fails once (weak signal)', 'fails'], ['reaches the cloud and its answer is lost', 'lost']] as const)('the old row\'s write %s: the new row goes up with his owner and note all the same', async (_what, how) => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { owner: 'Ana', notes: NOTE });
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad);
      // The old row's edit goes first (rows go up after the rows they answer to).
      if (how === 'fails') mockCloud.failNextWriteOf = 'MASTER F-1'; else mockCloud.lostAnswers = 1;
      await backgroundUpload(ipad);
      // (It was: the new row weighed against a cloud row, or a listed copy of it, without this device's own waiting
      // word; it took the blank, and the web and the phone showed no owner and no note until the iPad's next upload.)
      expect(cloudRow(newId)).toMatchObject({ owner: 'Ana', notes: NOTE });
      expect(framingOf(webShown())[0]).toMatchObject({ id: newId, owner: 'Ana', notes: NOTE });
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Ana'));
      expect(cloudRow('MASTER F-1')).toMatchObject({ owner: 'Ana', notes: NOTE });
      await noCards(phone, ipad);
    });

    it('a field another device changed on the old row meanwhile is not this device\'s to assume: it stays the cloud\'s on the new row, and the old row\'s edit asks', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { owner: 'Ana', notes: NOTE });
      await edit(phone, 'MASTER F-1', { owner: 'Bob' });
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      const newId = theRow(ipad).id;
      at('2026-09-12T08:00:00.000Z');
      setOnline(ipad, true);
      shareDocuments(ipad);
      mockCloud.failNextWriteOf = 'MASTER F-1';
      await backgroundUpload(ipad);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Bob', notes: NOTE });
      await allSynced(phone, ipad);
      // (The card is raised on the row he typed on; it is on the task's row when Review Conflicts opens.)
      on(ipad);
      await ipad.m.sync.refreshScheduleItemConflictCloudCopies();
      expect([await cards(phone), await cards(ipad)]).toEqual([[], [{ row: newId, fields: ['owner'], here: ['Ana'], cloud: ['Bob'] }]]);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Bob'));
    });

    it('the rule on the records alone', () => {
      const cloud = { ...theRowAsApproved(), id: 'MASTER F-1', owner: '', notes: 'Typed elsewhere', textFromTask: undefined } as ScheduleItem;
      const waiting = { itemData: { ...cloud, owner: 'Ana', notes: NOTE, percentComplete: 40 } as ScheduleItem, changedFields: ['owner', 'notes', 'percentComplete', 'updatedAt'], base: { updatedAt: null, fields: { owner: '', notes: '', percentComplete: 0 } } };
      // The owner the cloud still has as his edit started: his. The note another device has typed since: the cloud's. His percent is not weighed here.
      expect(scheduleItemAsOwnWaitingEditLeavesIt(cloud, waiting)).toEqual({ ...cloud, owner: 'Ana' });
      expect(scheduleItemAsOwnWaitingEditLeavesIt(cloud, undefined)).toBe(cloud);
      expect(scheduleItemAsOwnWaitingEditLeavesIt(cloud, { ...waiting, base: undefined })).toBe(cloud);
      // A whole copy waiting (a lookahead approved there): the fields it changed from its copy.
      expect(scheduleItemAsOwnWaitingEditLeavesIt({ ...cloud, notes: '' }, { itemData: waiting.itemData, base: { updatedAt: null, fields: { owner: '', notes: '', contractor: '' } } }))
        .toEqual({ ...cloud, owner: 'Ana', notes: NOTE });
    });
  });

  describe('Review P5 S-P5-3: one task never has two cards, and the one card holds what he typed last', () => {
    /** The iPad types a note. The phone, with no signal, types its own, approves the master, and types the note again on the task's new row. */
    async function twoNotesOfHisAroundAMaster() {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { notes: 'iPad note' });
      await backgroundUpload(ipad);
      await edit(phone, 'MASTER F-1', { notes: 'First' });
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { notes: 'Second, typed last' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      return { phone, ipad, newId };
    }
    const LAST = (id: string) => [{ row: id, fields: ['notes'], here: ['Second, typed last'], cloud: ['iPad note'] }];

    it.each([['keep_local', 'Second, typed last'], ['keep_cloud', 'iPad note']] as const)('one card as soon as the upload has run, his last note against the iPad\'s; %s ends on "%s"', async (choice, ends) => {
      const { phone, ipad, newId } = await twoNotesOfHisAroundAMaster();
      await backgroundUpload(phone);
      // (It was: two cards, "Second" on the new row and "First" on the old one; when Review Conflicts opened they
      // became one holding "First", and "Second, typed last" was on no card and, after his choice, on no device.)
      expect(await cards(phone)).toEqual(LAST(newId));
      on(phone);
      await phone.m.sync.refreshScheduleItemConflictCloudCopies();
      expect(await cards(phone)).toEqual(LAST(newId));
      const [card] = await conflictsOf(phone);
      await chooseInSettings(phone, card.id, choice);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, ends, ''));
      await noCards(phone, ipad);
    });

    it('the other order: the old row\'s edit cannot go up in the first pass and is asked about after the new row\'s card exists: still one card, with his last note', async () => {
      const { phone, newId } = await twoNotesOfHisAroundAMaster();
      const store = mockStores.get('phone')!;
      const queueKey = 'projectVisionAI.syncQueue.v1';
      const queued = JSON.parse(store.get(queueKey) || '[]') as Array<{ payload?: { id?: string } }>;
      const oldRowEdit = queued.filter(item => item.payload?.id === 'MASTER F-1');
      expect(oldRowEdit).toHaveLength(1);
      // The old row's edit is held back for one pass: only the new row goes up, and asks.
      store.set(queueKey, JSON.stringify(queued.filter(item => item.payload?.id !== 'MASTER F-1')));
      await backgroundUpload(phone);
      expect(await cards(phone)).toEqual(LAST(newId));
      store.set(queueKey, JSON.stringify([...JSON.parse(store.get(queueKey) || '[]'), ...oldRowEdit]));
      await backgroundUpload(phone);
      expect(await cards(phone)).toEqual(LAST(newId));
      on(phone);
      await phone.m.sync.refreshScheduleItemConflictCloudCopies();
      expect(await cards(phone)).toEqual(LAST(newId));
    });

    it('two cards saved by a build before this one become one when Review Conflicts opens, and it holds his last note', async () => {
      const { phone, newId } = await twoNotesOfHisAroundAMaster();
      await backgroundUpload(phone);
      const [onTheNewRow] = await conflictsOf(phone);
      // The card that build left on the row the master replaced: "First" against the iPad's note.
      const oldRow = cloudRow('MASTER F-1')!;
      const onTheOldRow = {
        ...onTheNewRow, id: 'schedule_item_conflict:older', localId: 'MASTER F-1', localChangedAt: '2026-09-09T09:00:00.000Z', remotePayload: oldRow,
        localPayload: { id: 'MASTER F-1', itemData: { ...oldRow, notes: 'First' }, changedFields: ['notes', 'updatedAt'], askedFields: ['notes'], base: { updatedAt: null, fields: { notes: '' } } },
      };
      const store = mockStores.get('phone')!;
      const key = 'projectVisionAI.syncConflicts.v1';
      store.set(key, JSON.stringify([...JSON.parse(store.get(key) || '[]'), onTheOldRow]));
      expect((await cards(phone)).map(card => card.row).sort()).toEqual(['MASTER F-1', newId]);
      on(phone);
      await phone.m.sync.refreshScheduleItemConflictCloudCopies();
      // (It was: the moved card over the card on the task's row, so "First".)
      expect(await cards(phone)).toEqual(LAST(newId));
    });

    it('the rule on the two cards alone: of a field both ask about, the value he set later, whichever card it is on (after Set Active back he can type on the older row last)', () => {
      const row = theRowAsApproved();
      const card = (notes: string, extra: Record<string, unknown> = {}) => ({
        id: row.id, itemData: { ...row, notes, ...extra }, changedFields: ['notes', ...Object.keys(extra), 'updatedAt'], askedFields: ['notes', ...Object.keys(extra)],
        base: { updatedAt: null, fields: { notes: '', ...Object.fromEntries(Object.keys(extra).map(field => [field, ''])) } },
      });
      const notesOf = (copy: { itemData?: unknown }) => (copy.itemData as ScheduleItem).notes;
      const [earlier, later] = ['2026-09-09T09:00:00.000Z', '2026-09-11T09:00:00.000Z'];
      expect(notesOf(scheduleItemConflictCopyOfBoth(card('Moved'), earlier, card('On the row'), later, row))).toBe('On the row');
      expect(notesOf(scheduleItemConflictCopyOfBoth(card('Moved'), later, card('On the row'), earlier, row))).toBe('Moved');
      // A field only one of them asks about is kept either way.
      const both = scheduleItemConflictCopyOfBoth(card('Moved', { owner: 'Mike' }), earlier, card('On the row'), later, row) as { askedFields?: string[]; itemData?: unknown };
      expect([[...(both.askedFields ?? [])].sort(), (both.itemData as ScheduleItem).owner, notesOf(both)]).toEqual([['notes', 'owner'], 'Mike', 'On the row']);
    });

    it('a field only the older card asks about is kept in the one card, beside the newer card\'s field', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(ipad, 'MASTER F-1', { notes: 'iPad note', owner: 'Ana' });
      await backgroundUpload(ipad);
      await edit(phone, 'MASTER F-1', { notes: 'First', owner: 'Mike' });
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { notes: 'Second, typed last' });
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      await backgroundUpload(phone);
      const asked = await cards(phone);
      expect(asked).toHaveLength(1);
      expect(asked[0].row).toBe(newId);
      expect(Object.fromEntries(asked[0].fields.map((field, index) => [field, [asked[0].here[index], asked[0].cloud[index]]]))).toEqual({
        notes: ['Second, typed last', 'iPad note'], owner: ['Mike', 'Ana'],
      });
      const [card] = await conflictsOf(phone);
      await chooseInSettings(phone, card.id, 'keep_local');
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Second, typed last', 'Mike'));
      await noCards(phone, ipad);
    });
  });

  describe('Review P5-2: a hand link follows both tasks through a master, whichever device heard of what first', () => {
    const SURVEY_MOVED = 'Survey,Alpha,Lot,10/19/2026,10/21/2026,';
    const CASES = [
      ['the successor (Framing) moves', [G_ROW, SURVEY]],
      ['the predecessor (Survey) moves', [F_ROW, SURVEY_MOVED]],
      ['both move', [G_ROW, SURVEY_MOVED]],
    ] as const;
    const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name);
    /** In one place: the row Framing is shown on, and the rows its links name, with each link's lag. */
    const linksIn = (items: readonly ScheduleItem[]) => (named(items, 'Framing')?.dependencies || []).map(link => `${link.predecessorItemId}${link.lagDays ? ` +${link.lagDays}d` : ''}`);
    const linksEverywhere = (phone: Device, ipad: Device) => [linksIn(deviceShown(phone)), linksIn(deviceShown(ipad)), linksIn(webShown())];
    /** Framing after Survey, as the device shows the two tasks. */
    const link = (device: Device, lagDays = 0) => {
      const shown = deviceShown(device);
      return edit(device, named(shown, 'Framing')!.id, { dependencies: [{ predecessorItemId: named(shown, 'Survey')!.id, type: 'FS', lagDays }] } as Partial<ScheduleItem>);
    };
    /** The link to the Survey shown, in all three places. */
    const toTheSurveyShown = () => Array(3).fill([named(webShown(), 'Survey')!.id]);

    it.each(CASES)('L2, %s: linked on the phone with signal; the iPad, with no signal and not having heard, approves the master', async (_what, lines) => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-08T09:00:00.000Z');
      await link(phone);
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [...lines]);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: no link anywhere when Framing moved; a link to the old, hidden Survey row when only Survey moved.)
      expect(named(webShown(), 'Framing')!.id).toBe(lines[0] === G_ROW ? 'MASTER G-1' : 'MASTER F-1');
      expect(linksEverywhere(phone, ipad)).toEqual(toTheSurveyShown());
      await noCards(phone, ipad);
    });

    it.each(CASES)('L3, %s: the phone approves the master; the iPad, with no signal and not having heard, links the tasks as it still shows them', async (_what, lines) => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [...lines]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z');
      await link(ipad);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(linksEverywhere(phone, ipad)).toEqual(toTheSurveyShown());
      await noCards(phone, ipad);
    });

    it('linked on both sides of the master to the same task (the phone on the rows it sees, the iPad on the master\'s new rows): one link, and nothing to ask though the two name different rows', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-08T09:00:00.000Z');
      await link(phone);
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY_MOVED]);
      at('2026-09-11T09:00:00.000Z');
      await link(ipad);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(linksEverywhere(phone, ipad)).toEqual(toTheSurveyShown());
      await noCards(phone, ipad);
    });

    it('linked on both sides differently (a lag of two days on the phone, none on the iPad\'s new row): he is asked, and Keep Phone puts the iPad\'s link everywhere', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-08T09:00:00.000Z');
      await link(phone, 2);
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      at('2026-09-11T09:00:00.000Z');
      await link(ipad);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      const asked = await cards(ipad);
      expect([await cards(phone), asked.map(card => [card.row, card.fields])]).toEqual([[], [['MASTER G-1', ['dependencies']]]]);
      // The cloud's link shows until he chooses.
      expect(linksEverywhere(phone, ipad)).toEqual(Array(3).fill(['MASTER F-2 +2d']));
      const [card] = await conflictsOf(ipad);
      await chooseInSettings(ipad, card.id, 'keep_local');
      await allSynced(phone, ipad);
      expect(linksEverywhere(phone, ipad)).toEqual(Array(3).fill(['MASTER F-2']));
      await noCards(phone, ipad);
    });

    it('a link he removed on the phone, unheard by the iPad that approves the master, stays removed on the task\'s new row', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      await link(phone);
      await allSynced(phone, ipad);
      expect(linksIn(deviceShown(ipad))).toEqual(['MASTER F-2']);
      setOnline(ipad, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, 'MASTER F-1', { dependencies: [] } as Partial<ScheduleItem>);
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW, SURVEY]);
      expect(theRow(ipad).textFromTask).toMatchObject({ taskId: 'MASTER F-1', dependencies: [{ predecessorItemId: 'MASTER F-2' }] });
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(linksEverywhere(phone, ipad)).toEqual([[], [], []]);
      await noCards(phone, ipad);
    });

    it('a link to a task the master drops is left as it is, as before: it names that task\'s row, which is not shown, and is on Framing\'s new row all the same', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at('2026-09-08T09:00:00.000Z');
      await link(phone);
      await backgroundUpload(phone);
      at(G.importedAt!);
      await approve(ipad, G, [G_ROW]);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(named(webShown(), 'Survey')).toBeUndefined();
      expect(linksEverywhere(phone, ipad)).toEqual(Array(3).fill(['MASTER F-2']));
      await noCards(phone, ipad);
    });

    describe('the rules on the records alone', () => {
      const linkTo = (id: string, lagDays = 0) => [{ predecessorItemId: id, type: 'FS' as const, lagDays }];
      const newRow = (links: ReturnType<typeof linkTo> | [], made: ReturnType<typeof linkTo> | [] = []) =>
        ({ ...theRowAsApproved(), dependencies: links, textFromTask: { ...theRowAsApproved().textFromTask!, dependencies: made } }) as ScheduleItem;
      const oldRow = (links: ReturnType<typeof linkTo> | [], stamp?: string) =>
        ({ ...theRowAsApproved(), id: 'MASTER F-1', revisedFromTaskIds: undefined, textFromTask: undefined, dependencies: links, ...(stamp ? { dependenciesUpdatedAt: stamp } : {}) }) as ScheduleItem;
      // Survey's two rows are one task; Paint is another.
      const taskOf = scheduleTaskOfRowId([{ id: 'MASTER G-2', revisedFromTaskIds: ['MASTER F-2'] }, { id: 'MASTER F-2' }, { id: 'MASTER F-3' }] as ScheduleItem[]);

      it('the rows of one task are one name, whichever of their ids is asked; an id no row knows is itself', () => {
        expect([taskOf('MASTER G-2'), taskOf('MASTER F-2'), taskOf('MASTER F-3'), taskOf('NOT A ROW')]).toEqual(['MASTER F-2', 'MASTER F-2', 'MASTER F-3', 'NOT A ROW']);
        const twice = scheduleTaskOfRowId([{ id: 'H', revisedFromTaskIds: ['G', 'F'] }, { id: 'G', revisedFromTaskIds: ['F'] }] as ScheduleItem[]);
        expect(new Set(['F', 'G', 'H'].map(twice)).size).toBe(1);
      });

      it('first sent: links nobody changed on the new row take the task\'s, with when he changed them; links set on the new row stand; changed on both, he is asked', () => {
        const linkedMeanwhile = oldRow(linkTo('MASTER F-2'), '2026-09-08T09:00:00.000Z');
        const taken = scheduleItemAgainstItsTask(newRow([]), linkedMeanwhile, 'ask', taskOf);
        expect([taken.asked, taken.row.dependencies, taken.row.dependenciesUpdatedAt, taken.row.textFromTask!.dependencies])
          .toEqual([[], linkTo('MASTER F-2'), '2026-09-08T09:00:00.000Z', linkTo('MASTER F-2')]);
        // Set on the new row, the task's row as it was: the new row's stand.
        const setHere = newRow(linkTo('MASTER F-3'));
        expect(scheduleItemAgainstItsTask(setHere, oldRow([]), 'ask', taskOf).row).toBe(setHere);
        // Changed on both, to different links: asked, with the task's on the row until he chooses.
        const both = scheduleItemAgainstItsTask(setHere, linkedMeanwhile, 'ask', taskOf);
        expect([both.asked, both.row.dependencies, both.base.fields]).toEqual([['dependencies'], linkTo('MASTER F-2'), { dependencies: [] }]);
        // The same link on both sides, naming two rows of one task, is no difference.
        const sameTask = newRow(linkTo('MASTER G-2'));
        expect(scheduleItemAgainstItsTask(sameTask, linkedMeanwhile, 'ask', taskOf).row).toBe(sameTask);
        // A link the new row was made with, re-pointed at the predecessor's new row by the approval, and removed on the task's row since: removed.
        const madeWith = newRow(linkTo('MASTER G-2'), linkTo('MASTER G-2'));
        expect(scheduleItemAgainstItsTask(madeWith, oldRow([]), 'ask', taskOf).row.dependencies).toEqual([]);
        expect(scheduleItemAgainstItsTask(madeWith, oldRow(linkTo('MASTER F-2')), 'ask', taskOf).row).toBe(madeWith);
      });

      it('not a row that keeps no record of its links (its file stated them, or it was saved before rows kept one); and Set Active and Make Current, which give no way to tell tasks, leave links to their own rule', () => {
        const linkedMeanwhile = oldRow(linkTo('MASTER F-2'));
        const noRecord = { ...theRowAsApproved(), dependencies: linkTo('MASTER F-3') } as ScheduleItem;
        expect(scheduleItemAgainstItsTask(noRecord, linkedMeanwhile, 'ask', taskOf).row).toBe(noRecord);
        const made = newRow([]);
        expect(scheduleItemAgainstItsTask(made, linkedMeanwhile, 'task').row).toBe(made);
      });

      it('an edit of the links typed on the old row goes on to the task\'s new row with its stamp, like any other field', () => {
        const typedOnTheOldRow = {
          id: 'MASTER F-1', itemData: oldRow(linkTo('MASTER F-2'), '2026-09-11T09:00:00.000Z'),
          changedFields: ['dependencies', 'dependenciesUpdatedAt', 'updatedAt'], base: { updatedAt: null, fields: { dependencies: [], dependenciesUpdatedAt: null } },
        };
        expect(scheduleItemTextEditOnRow(typedOnTheOldRow, typedOnTheOldRow.changedFields, newRow([]))).toMatchObject({
          id: 'MASTER G-1', itemData: { dependencies: linkTo('MASTER F-2'), dependenciesUpdatedAt: '2026-09-11T09:00:00.000Z' },
          changedFields: ['dependencies', 'dependenciesUpdatedAt', 'updatedAt'], sentOn: ['dependencies'],
        });
      });

      it('a file that states links for a row keeps them, and the row keeps no record of links to weigh', () => {
        const saved = { ...oldRow(linkTo('MASTER F-2')), startDate: '10/15/2026', finishDate: '10/25/2026', importBatchId: 'batch-MASTER F', sourceDocumentId: 'MASTER F' } as ScheduleItem;
        const imported = { ...theRowAsApproved(), revisedFromTaskIds: undefined, textFromTask: undefined, dependencies: linkTo('FILE-9') } as ScheduleItem;
        // (With no links of its own the same row takes the task's, and says so.)
        const [plain] = mergeApprovedScheduleImportItems({ existing: [saved], imported: [{ ...imported, dependencies: undefined }], completionMatch: () => null, mergeCompletion: item => item, approvedAt: G.importedAt! }).additions;
        expect([plain.dependencies, plain.textFromTask?.dependencies]).toEqual([linkTo('MASTER F-2'), linkTo('MASTER F-2')]);
        const [row] = mergeApprovedScheduleImportItems({ existing: [saved], imported: [imported], completionMatch: () => null, mergeCompletion: item => item, approvedAt: G.importedAt! }).additions;
        expect([row.dependencies, Object.keys(row.textFromTask ?? {}).includes('dependencies')]).toEqual([linkTo('FILE-9'), false]);
      });
    });
  });

  describe('Review P6-1: his hand links are compared by the tasks they name wherever two copies of a task are weighed', () => {
    const PAINT = 'Paint,Alpha,Lot,11/02/2026,11/06/2026,';
    const SURVEY_MOVED = 'Survey,Alpha,Lot,10/19/2026,10/21/2026,';
    const start3 = () => { at('2026-09-07T12:00:00.000Z'); return startBoth(F, [F_ROW, SURVEY, PAINT]); };
    const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name)!;
    /** Framing after these tasks, as the device shows them. */
    const setLinks = (device: Device, predecessors: string[]) => {
      const shown = deviceShown(device);
      return edit(device, named(shown, 'Framing').id, { dependencies: predecessors.map(name => ({ predecessorItemId: named(shown, name).id, type: 'FS', lagDays: 0 })) } as Partial<ScheduleItem>);
    };
    /** In each of the three places: the tasks shown that Framing's links name. */
    const framingAfter = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()].map(items =>
      (named(items, 'Framing').dependencies || []).map(link => items.find(item => item.id === link.predecessorItemId)?.taskName ?? `NOT SHOWN ${link.predecessorItemId}`));
    const linkTo = (...ids: string[]) => ids.map(id => ({ predecessorItemId: id, type: 'FS' as const, lagDays: 0 }));

    it('the schedule reviewer\'s LK4: the same link made on both sides of a master that moved both tasks is one link and no question', async () => {
      const { phone, ipad } = await start3();
      at('2026-09-08T08:00:00.000Z');
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY_MOVED, PAINT]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z');
      await setLinks(phone, ['Survey']);
      await backgroundUpload(phone);
      at('2026-09-11T12:00:00.000Z');
      await setLinks(ipad, ['Survey']); // on the rows it still shows: MASTER F-1 after MASTER F-2
      at('2026-09-12T08:00:00.000Z');
      const asThePhoneWroteIt = cloudRow('MASTER G-1')!.updatedAt;
      await allSynced(phone, ipad);
      // (It was: a card on the iPad, "Predecessors: 1 item" on both sides.)
      await noCards(phone, ipad);
      expect(framingAfter(phone, ipad)).toEqual(Array(3).fill(['Survey']));
      // The task's row keeps the link as the phone wrote it there, and is not written again for the iPad's copy of it.
      expect([cloudRow('MASTER G-1')!.dependencies, cloudRow('MASTER G-1')!.updatedAt]).toEqual([linkTo('MASTER G-2'), asThePhoneWroteIt]);
    });

    it('the schedule reviewer\'s LK5: a second link added by a device that had not heard that a master moved the first link\'s task simply stands', async () => {
      const { phone, ipad } = await start3();
      at('2026-09-08T08:00:00.000Z');
      await setLinks(phone, ['Survey']);
      await backgroundUpload(phone); await refresh(ipad);
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [F_ROW, SURVEY_MOVED, PAINT]);
      shareDocuments(phone); await backgroundUpload(phone);
      // The approval points Framing's link at Survey's new row (App.tsx saves that after an approval; here, as an edit).
      await edit(phone, 'MASTER F-1', { dependencies: linkTo('MASTER G-2') } as Partial<ScheduleItem>);
      await backgroundUpload(phone);
      expect(cloudRow('MASTER F-1')!.dependencies).toEqual(linkTo('MASTER G-2'));
      at('2026-09-11T12:00:00.000Z');
      await setLinks(ipad, ['Survey', 'Paint']); // MASTER F-2 (the Survey it still shows) and MASTER F-3
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      // (It was: the added link held in a card, "2 items" / "1 item", and only Survey on the task until Keep Phone.)
      await noCards(phone, ipad);
      expect(framingAfter(phone, ipad)).toEqual(Array(3).fill(['Survey', 'Paint']));
      // Saved naming Survey's row as the cloud's copy named it, and the link he added.
      expect(cloudRow('MASTER F-1')!.dependencies).toEqual(linkTo('MASTER G-2', 'MASTER F-3'));
    });

    /** Framing after Survey in the cloud; the iPad loses signal; the phone's master G moves Survey, and Framing's link is pointed at Survey's new row. */
    async function surveyMovedBehindTheIPadsBack() {
      const { phone, ipad } = await start3();
      at('2026-09-08T08:00:00.000Z');
      await setLinks(phone, ['Survey']);
      await backgroundUpload(phone); await refresh(ipad);
      setOnline(ipad, false);
      at(G.importedAt!);
      await approve(phone, G, [F_ROW, SURVEY_MOVED, PAINT]);
      shareDocuments(phone); await backgroundUpload(phone);
      await edit(phone, 'MASTER F-1', { dependencies: linkTo('MASTER G-2') } as Partial<ScheduleItem>);
      await backgroundUpload(phone);
      return { phone, ipad };
    }

    it('...and when a second master has moved Framing meanwhile, the link he added reaches the task\'s new row', async () => {
      const { phone, ipad } = await surveyMovedBehindTheIPadsBack();
      at(H.importedAt!);
      await approve(phone, H, [H_ROW, SURVEY_MOVED, PAINT]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-18T12:00:00.000Z');
      await setLinks(ipad, ['Survey', 'Paint']);
      at('2026-09-19T08:00:00.000Z');
      await allSynced(phone, ipad);
      await noCards(phone, ipad);
      // (Weighed by row ids on the row he typed on, it was asked about there and never sent on.)
      expect([named(webShown(), 'Framing').id, framingAfter(phone, ipad)]).toEqual(['MASTER H-1', Array(3).fill(['Survey', 'Paint'])]);
    });

    it('...and when a lookahead approved on the iPad before it has signal sends the task whole, the whole copy\'s links are weighed the same way', async () => {
      const { phone, ipad } = await surveyMovedBehindTheIPadsBack();
      at('2026-09-11T12:00:00.000Z');
      await setLinks(ipad, ['Survey', 'Paint']);
      at('2026-09-11T13:00:00.000Z');
      await approve(ipad, scheduleDoc('LOOKAHEAD P6', '2026-09-11T13:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/16/2026,10/26/2026,'], true);
      expect((await queueOf(ipad)).map(item => Array.isArray((item.payload as { changedFields?: unknown }).changedFields))).toEqual([false]);
      at('2026-09-12T08:00:00.000Z');
      await allSynced(phone, ipad);
      await noCards(phone, ipad);
      expect(framingAfter(phone, ipad)).toEqual(Array(3).fill(['Survey', 'Paint']));
    });

    it('...and a master approved on the iPad that moves Framing goes up with the link he added though the old row\'s write fails in that pass (the cloud names Survey by its new row)', async () => {
      const { ipad } = await surveyMovedBehindTheIPadsBack();
      at('2026-09-11T12:00:00.000Z');
      await setLinks(ipad, ['Survey', 'Paint']);
      at(H.importedAt!);
      await approve(ipad, H, [H_ROW, SURVEY, PAINT]);
      at('2026-09-18T08:00:00.000Z');
      setOnline(ipad, true); shareDocuments(ipad);
      mockCloud.failNextWriteOf = 'MASTER F-1';
      await backgroundUpload(ipad);
      // (It was: weighed against the cloud's old row alone, whose link "had changed on another device", the new row
      // went up with Survey only; and the old row's edit was never sent on to a row made from it.)
      expect(cloudRow('MASTER H-1')!.dependencies).toEqual(linkTo('MASTER F-2', 'MASTER F-3'));
    });

    it('a card about the links left on a row a master has replaced closes when Review Conflicts opens, where the task\'s row holds the same links by task', async () => {
      const { phone, ipad } = await start3();
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY_MOVED, PAINT]);
      shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z');
      await setLinks(phone, ['Survey']);
      await backgroundUpload(phone);
      // A card as a build before this one left it on the iPad: the same link, made on the rows the iPad then showed.
      const oldRow = cloudRow('MASTER F-1')!;
      const detectedAt = new Date().toISOString();
      mockStores.get('ipad')!.set('projectVisionAI.syncConflicts.v1', JSON.stringify([{
        id: 'schedule_item_conflict:links', entity: 'schedule_item', localId: 'MASTER F-1', localChangedAt: detectedAt, remoteChangedAt: null,
        reason: 'This task changed on this device and on another device in the same place.', detectedAt,
        localPayload: { id: 'MASTER F-1', itemData: { ...oldRow, dependencies: linkTo('MASTER F-2') }, changedFields: ['dependencies', 'updatedAt'], askedFields: ['dependencies'], base: { updatedAt: null, fields: { dependencies: [] } } },
        remotePayload: oldRow,
      }]));
      expect((await cards(ipad)).map(card => [card.row, card.fields])).toEqual([['MASTER F-1', ['dependencies']]]);
      on(ipad);
      await ipad.m.sync.refreshScheduleItemConflictCloudCopies();
      // (It was: moved to the task's row and still asked, "1 item" against "1 item".)
      expect(await cards(ipad)).toEqual([]);
    });

    describe('the rule on the records alone', () => {
      // Survey moved from MASTER F-2 to MASTER G-2; Paint is MASTER F-3; Roofing is MASTER F-4.
      const taskOf = scheduleTaskOfRowId([{ id: 'MASTER G-2', revisedFromTaskIds: ['MASTER F-2'] }]);
      const framing = (dependencies: unknown, extra: Partial<ScheduleItem> = {}) => ({ id: 'MASTER F-1', taskName: 'Framing', dependencies, ...extra } as ScheduleItem);
      const editOf = (links: unknown, from: unknown) => ({ itemData: framing(links, { dependenciesUpdatedAt: '2026-09-11T12:00:00.000Z' }), fields: ['dependencies', 'dependenciesUpdatedAt', 'updatedAt'], base: { updatedAt: null, fields: { dependencies: from, dependenciesUpdatedAt: null } } });

      it('an edit of the links against the cloud\'s row', () => {
        const cloud = framing(linkTo('MASTER G-2'));
        // A link only pointed at its task's new row here (the approval does that), the cloud's still as it started: it goes up, as before.
        const pointed = editOf(linkTo('MASTER G-2'), linkTo('MASTER F-2'));
        expect(scheduleItemEditAgainstCloud(pointed.itemData, pointed.fields, pointed.base, framing(linkTo('MASTER F-2')), taskOf)).toMatchObject({ asked: [], keptFromCloud: [], itemData: { dependencies: linkTo('MASTER G-2') } });
        // The same links by task, named by other rows: the cloud's stay as written; nothing asked, nothing sent.
        const same = editOf(linkTo('MASTER F-2'), []);
        expect(scheduleItemEditAgainstCloud(same.itemData, same.fields, same.base, cloud, taskOf)).toMatchObject({ asked: [], keptFromCloud: ['dependencies', 'dependenciesUpdatedAt'] });
        // (By row ids, as it was weighed: changed on both.)
        expect(scheduleItemEditAgainstCloud(same.itemData, same.fields, same.base, cloud).asked).toEqual(['dependencies']);
        // A link added here while the cloud's are, by task, the links this edit started from: his go up, naming Survey's row as the cloud does.
        const added = editOf(linkTo('MASTER F-2', 'MASTER F-3'), linkTo('MASTER F-2'));
        const weighed = scheduleItemEditAgainstCloud(added.itemData, added.fields, added.base, cloud, taskOf);
        expect([weighed.asked, weighed.keptFromCloud, weighed.itemData.dependencies]).toEqual([[], [], linkTo('MASTER G-2', 'MASTER F-3')]);
        expect(scheduleItemEditAgainstCloud(added.itemData, added.fields, added.base, cloud).asked).toEqual(['dependencies']);
        // Changed on both to different tasks: asked, as before.
        const other = editOf(linkTo('MASTER F-4'), linkTo('MASTER F-2'));
        expect(scheduleItemEditAgainstCloud(other.itemData, other.fields, other.base, framing(linkTo('MASTER F-3')), taskOf)).toMatchObject({ asked: ['dependencies'], held: ['dependenciesUpdatedAt'] });
        // Only pointed at the new row here, and a link added in the cloud: the cloud's stay (by row ids it was "changed on both").
        const onlyPointed = editOf(linkTo('MASTER G-2'), linkTo('MASTER F-2'));
        expect(scheduleItemEditAgainstCloud(onlyPointed.itemData, onlyPointed.fields, onlyPointed.base, framing(linkTo('MASTER F-2', 'MASTER F-3')), taskOf)).toMatchObject({ asked: [], keptFromCloud: ['dependencies', 'dependenciesUpdatedAt'] });
        expect(scheduleItemEditAgainstCloud(onlyPointed.itemData, onlyPointed.fields, onlyPointed.base, framing(linkTo('MASTER F-2', 'MASTER F-3'))).asked).toEqual(['dependencies']);
      });

      it('a whole copy of the task (a lookahead approved with no signal) against the cloud\'s row', () => {
        const cloud = framing(linkTo('MASTER G-2'), { updatedAt: '2026-09-10T18:00:01.000Z' });
        const base = scheduleItemWholeCopyBase(framing(linkTo('MASTER F-2')))!;
        // His copy added Paint; the cloud's links are, by task, the ones his copy started from: his stand, named as the cloud names Survey.
        const added = framing(linkTo('MASTER F-2', 'MASTER F-3'));
        expect(scheduleItemWholeCopyAgainstCloud(added, added, base, cloud, taskOf)).toMatchObject({ asked: [], sentHere: ['dependencies'], itemData: { dependencies: linkTo('MASTER G-2', 'MASTER F-3') } });
        expect(scheduleItemWholeCopyAgainstCloud(added, added, base, cloud).asked).toEqual(['dependencies']); // by row ids, as it was
        // The same links by task on both, each changed from none: the cloud's, as written there; nothing of his to send.
        const same = framing(linkTo('MASTER F-2'));
        expect(scheduleItemWholeCopyAgainstCloud(same, same, scheduleItemWholeCopyBase(framing([]))!, cloud, taskOf)).toMatchObject({ asked: [], sentHere: [], itemData: { dependencies: linkTo('MASTER G-2') } });
        // A link the approval only pointed at its task's new row, over a cloud's row still as it was: it goes up, as before.
        const pointed = framing(linkTo('MASTER G-2'));
        expect(scheduleItemWholeCopyAgainstCloud(pointed, pointed, base, framing(linkTo('MASTER F-2')), taskOf)).toMatchObject({ asked: [], sentHere: ['dependencies'], itemData: { dependencies: linkTo('MASTER G-2') } });
      });

      it('this device\'s own waiting edit of the links of the row a master\'s new row replaces counts though the cloud names the task by its new row', () => {
        const waiting = editOf(linkTo('MASTER F-2', 'MASTER F-3'), linkTo('MASTER F-2'));
        const cloud = framing(linkTo('MASTER G-2'));
        const edit = { itemData: waiting.itemData, changedFields: waiting.fields, base: waiting.base };
        expect(scheduleItemAsOwnWaitingEditLeavesIt(cloud, edit, taskOf).dependencies).toEqual(linkTo('MASTER F-2', 'MASTER F-3'));
        expect(scheduleItemAsOwnWaitingEditLeavesIt(cloud, edit)).toBe(cloud); // by row ids, as it was: "changed on another device", left out
      });

      it('an edit of the links typed on a replaced row is not sent on to the task\'s row when that row already has the same links by task; and a card moved there asks no more', () => {
        const typed = { id: 'MASTER F-1', itemData: framing(linkTo('MASTER F-2'), { updatedAt: '2026-09-11T12:00:00.000Z' }), changedFields: ['dependencies', 'updatedAt'], base: { updatedAt: null, fields: { dependencies: [] } } };
        const newRow = { id: 'MASTER G-1', taskName: 'Framing', dependencies: linkTo('MASTER G-2'), revisedFromTaskIds: ['MASTER F-1'], importedAt: G.importedAt } as ScheduleItem;
        expect(scheduleItemTextEditOnRow(typed, typed.changedFields, newRow, [], taskOf)).toBeNull();
        expect(scheduleItemTextEditOnRow(typed, typed.changedFields, newRow)).not.toBeNull(); // by row ids, as it was
        const card = { id: 'MASTER F-1', itemData: typed.itemData, changedFields: typed.changedFields, askedFields: ['dependencies'], base: typed.base };
        expect(scheduleItemConflictCopyOnRow(card, newRow, taskOf)).toBeNull();
        expect(scheduleItemConflictCopyOnRow(card, newRow)).toMatchObject({ askedFields: ['dependencies'] });
      });
    });
  });

  describe('Review P6-2 and P6-3: the retry of a new row\'s first upload after its answer was lost, when he has changed more than his text on the row', () => {
    const waitingFor = async (device: Device, id: string) => (await queueOf(device)).map(item => item.payload as { id?: string; changedFields?: string[]; base?: unknown; sinceMade?: { fields: Record<string, unknown>; own?: Record<string, string[]> } }).find(payload => payload.id === id);
    const writesOf = (id: string, since: number) => mockCloud.writes.slice(since).filter(write => write.endsWith(`:${id}`));
    type Step = (phone: Device, newId: string) => Promise<unknown> | unknown;
    /**
     * The iPad sets Pending, 5 days and a note on the task. The phone, with no signal, approves master G (`before`: what
     * he does on its new row then). Signal back: the new row's first write reaches the cloud, its answer is lost.
     * `between`: what happens before the next pass, which is the retry.
     */
    async function lostAnswer(before: Step | null, between: Step | null) {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending', estimatedScheduleImpactDays: 5 });
      await edit(ipad, theRow(ipad).id, { notes: NOTE });
      await backgroundUpload(ipad);
      const newId = await phoneApprovesWithNoSignal(phone);
      at('2026-09-11T09:00:00.000Z');
      if (before) await before(phone, newId);
      at('2026-09-12T08:00:00.000Z');
      setOnline(phone, true);
      shareDocuments(phone);
      mockCloud.lostAnswers = 1;
      await backgroundUpload(phone);
      expect([cloudRow(newId)!.notes, (await waitingFor(phone, newId))?.changedFields]).toEqual([NOTE, undefined]);
      at('2026-09-12T08:30:00.000Z');
      if (between) await between(phone, newId);
      const writes = mockCloud.writes.length;
      at('2026-09-12T09:00:00.000Z');
      await backgroundUpload(phone);
      return { phone, ipad, newId, writes };
    }
    const offline = (step: Step): Step => async (phone, newId) => { setOnline(phone, false); await step(phone, newId); setOnline(phone, true); };

    it('the schedule reviewer\'s LA2: 30% entered after the lost answer goes up, and the note and approval the iPad set stay on the task', async () => {
      const { phone, ipad, newId } = await lostAnswer(null, offline((phone, id) => edit(phone, id, { percentComplete: 30 })));
      // (It was: his whole waiting copy, blank note and all, over the row. "Crew short Tuesday" gone everywhere, no card.)
      expect(cloudRow(newId)).toMatchObject({ percentComplete: 30, notes: NOTE });
      expect([await cards(phone), await waitingFor(phone, newId)]).toEqual([[], undefined]);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(30, NOTE, ''));
      expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', 5]));
      await noCards(phone, ipad);
    });

    it('the schedule reviewer\'s LA4: dates he moved after the lost answer go up, and the note stays', async () => {
      const { phone, ipad } = await lostAnswer(null, offline((phone, id) => edit(phone, id, { startDate: '10/21/2026', finishDate: '10/31/2026' })));
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/21/2026', '10/31/2026', 0, NOTE, '']]));
      await noCards(phone, ipad);
    });

    it('the sync reviewer\'s case: 40% after the lost answer AND an owner typed on the web meanwhile: the percent, the web\'s owner and the iPad\'s note are all on the task', async () => {
      const { phone, ipad } = await lostAnswer(null, async (phone, id) => {
        webWrite(webEdited(cloudRow(id)!, { owner: 'Web owner' }));
        await offline((device, row) => edit(device, row, { percentComplete: 40 }))(phone, id);
      });
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(40, NOTE, 'Web owner'));
      await noCards(phone, ipad);
    });

    it('P6-3: an owner typed on the new row before it first went up, and a note typed on the web after: no card, both stand, and nothing more is written for the row', async () => {
      const { phone, ipad, newId, writes } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Ana' }), (_phone, id) => { webWrite(webEdited(cloudRow(id)!, { notes: 'Web note' })); });
      // (It was: a card for the whole task, phone "Ana | (blank)" against cloud "Ana | Web note"; Keep Phone would blank the note.)
      expect([await cards(phone), await waitingFor(phone, newId), writesOf(newId, writes)]).toEqual([[], undefined, []]);
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, 'Web note', 'Ana'));
      await noCards(phone, ipad);
    });

    it('30% entered before the first upload: the retry finds it in the cloud already and writes nothing', async () => {
      const { phone, newId, writes } = await lostAnswer((phone, id) => edit(phone, id, { percentComplete: 30 }), null);
      expect([await cards(phone), await waitingFor(phone, newId), writesOf(newId, writes), cloudRow(newId)!.percentComplete]).toEqual([[], undefined, [], 30]);
    });

    it('an owner he typed before the first upload and typed again after the lost answer goes up: the cloud\'s "Ana" is his own first write', async () => {
      const { phone, ipad } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Ana' }), offline((phone, id) => edit(phone, id, { owner: 'Ana, corrected' })));
      await allSynced(phone, ipad);
      expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Ana, corrected'));
      await noCards(phone, ipad);
    });

    it('...and when the web has changed that owner too, he is asked about the owner, and the web\'s stands until he chooses (it was overwritten, with no card)', async () => {
      const { phone, newId } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Ana' }), async (phone, id) => {
        webWrite(webEdited(cloudRow(id)!, { owner: 'Web' }));
        await offline((device, row) => edit(device, row, { owner: 'Ana, corrected' }))(phone, id);
      });
      expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Ana, corrected'], cloud: ['Web'] }]);
      expect(cloudRow(newId)).toMatchObject({ owner: 'Web', notes: NOTE });
    });

    it('the same field changed on both sides is asked about: he moves the dates after the lost answer and the web has moved them too', async () => {
      const { phone, newId } = await lostAnswer(null, async (phone, id) => {
        webWrite(webEdited(cloudRow(id)!, { startDate: '10/22/2026', finishDate: '11/01/2026' }));
        await offline((device, row) => edit(device, row, { startDate: '10/21/2026', finishDate: '10/31/2026', percentComplete: 30 }))(phone, id);
      });
      const [card] = await cards(phone);
      expect([card.row, card.fields, card.here, card.cloud]).toEqual([newId, ['startDate', 'finishDate'], ['10/21/2026', '10/31/2026'], ['10/22/2026', '11/01/2026']]);
      // His percent, which nobody else changed, is up; the web's dates and the iPad's note stand until he chooses.
      expect(cloudRow(newId)).toMatchObject({ startDate: '10/22/2026', finishDate: '11/01/2026', percentComplete: 30, notes: NOTE });
    });

    it('the record is the approval\'s: on every row it makes, and it gathers what his edits change while the row waits', async () => {
      const { phone } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY, 'Paint,Alpha,Lot,11/02/2026,11/06/2026,']);
      const [newId, paintId] = [theRow(phone).id, deviceShown(phone).find(item => item.taskName === 'Paint')!.id];
      // Framing's new row keeps one, and so does Paint, a task the master adds (review P7-5); Survey, which the master only
      // lists again on the row the device already held, keeps none.
      expect([(await waitingFor(phone, newId))?.sinceMade, (await waitingFor(phone, paintId))?.sinceMade, (await waitingFor(phone, 'MASTER F-2'))?.sinceMade])
        .toEqual([{ updatedAt: null, fields: {} }, { updatedAt: null, fields: {} }, undefined]);
      at('2026-09-11T09:00:00.000Z');
      await edit(phone, newId, { owner: 'Ana' });
      await edit(phone, newId, { percentComplete: 30 });
      await edit(phone, newId, { owner: 'Ana, corrected' });
      const record = (await waitingFor(phone, newId))!.sinceMade!;
      // Each field as the row was made, and what he held for it before its latest value.
      expect([record.fields.owner, record.fields.percentComplete, record.own]).toEqual(['', 0, { owner: ['"Ana"'] }]);
      // A lookahead approved on the task saves a whole copy over the waiting one. The record becomes that copy's starting
      // copy: the row as the approval made it, his owner and percent not yet on it (review P7-4).
      at('2026-09-11T13:00:00.000Z');
      await approve(phone, scheduleDoc('LOOKAHEAD P6', '2026-09-11T13:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
      const afterLookahead = (await waitingFor(phone, newId))! as { changedFields?: unknown; sinceMade?: unknown; base?: { fields: Record<string, unknown>; copy?: Record<string, unknown>; own?: unknown } };
      expect([afterLookahead.changedFields, afterLookahead.sinceMade]).toEqual([undefined, undefined]);
      expect([afterLookahead.base?.fields.owner, afterLookahead.base?.copy?.owner, afterLookahead.base?.copy?.percentComplete, afterLookahead.base?.copy?.startDate, afterLookahead.base?.own])
        .toEqual(['', '', 0, '10/20/2026', { owner: ['"Ana"'] }]);
      // And a row staged by a caller that does not say which tasks the device had before keeps none: it may be a row the cloud has.
      on(phone);
      await phone.m.sync.runScheduleImportCloudSync({ scheduleItems: [{ ...theRowAsApproved(), id: 'MASTER X-1' }], referenceDocuments: [] } as never);
      expect([(await waitingFor(phone, 'MASTER X-1'))?.id, (await waitingFor(phone, 'MASTER X-1'))?.sinceMade]).toEqual(['MASTER X-1', undefined]);
    });

    it('the rule on the records alone', () => {
      const taskOf = () => (rowId: string) => rowId;
      const made = theRowAsApproved();
      const inTheCloud = { ...made, owner: 'Bob', notes: NOTE, textFromTask: { ...made.textFromTask!, owner: 'Bob', notes: NOTE }, updatedAt: '2026-09-12T08:00:01.000Z' } as ScheduleItem;
      const withPercent = { ...made, percentComplete: 40, status: 'In Progress', updatedAt: '2026-09-12T08:30:00.000Z' } as ScheduleItem;
      const record = { updatedAt: null, fields: { percentComplete: 0, status: 'Not Started' } };
      // His percent, as an edit that started from the row as made; the owner and note the cloud's row holds are not his to send.
      expect(scheduleItemNewRowMetAgain(withPercent, inTheCloud, taskOf, record))
        .toEqual({ changedFields: ['percentComplete', 'status', 'updatedAt'], base: { updatedAt: null, fields: { percentComplete: 0, status: 'Not Started' } } });
      // (Without the record: not this case, as before.)
      expect(scheduleItemNewRowMetAgain(withPercent, inTheCloud, taskOf)).toBeUndefined();
      // A field he changed and put back as the row was made is no change of his; one the cloud already holds as he has it needs nothing.
      expect(scheduleItemNewRowMetAgain({ ...withPercent, percentComplete: 0, status: 'Not Started' } as ScheduleItem, inTheCloud, taskOf, record)).toBeNull();
      expect(scheduleItemNewRowMetAgain({ ...withPercent, percentComplete: 0, status: 'Not Started' } as ScheduleItem, { ...inTheCloud, percentComplete: 20, status: 'In Progress' } as ScheduleItem, taskOf, record)).toBeNull();
      expect(scheduleItemNewRowMetAgain(withPercent, { ...inTheCloud, percentComplete: 40, status: 'In Progress' } as ScheduleItem, taskOf, record)).toBeNull();
      // His text is still read from what the row took, with the values he held for it since.
      expect(scheduleItemNewRowMetAgain({ ...made, owner: 'Ana, corrected', updatedAt: '2026-09-12T08:30:00.000Z' }, inTheCloud, taskOf, { updatedAt: null, fields: { owner: '' }, own: { owner: ['"Ana"'] } }))
        .toEqual({ changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' }, own: { owner: ['"Ana"'] } } });
      // The record itself: only on a whole copy that has one, only for an edit of fields with the copy it started from.
      const edit = { changedFields: ['percentComplete', 'updatedAt'], base: { updatedAt: null, fields: { percentComplete: 0 } }, itemData: withPercent };
      expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: SCHEDULE_ITEM_AS_MADE }, edit)).toEqual({ updatedAt: null, fields: { percentComplete: 0 } });
      expect(scheduleItemChangedSinceMade({ itemData: made }, edit)).toBeUndefined();
      expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: SCHEDULE_ITEM_AS_MADE }, { itemData: withPercent })).toBeUndefined();
      expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: SCHEDULE_ITEM_AS_MADE }, { changedFields: ['percentComplete', 'updatedAt'], itemData: withPercent })).toBeUndefined();
      expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: SCHEDULE_ITEM_AS_MADE, changedFields: ['owner'] }, edit)).toBeUndefined();
      expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: SCHEDULE_ITEM_AS_MADE }, { ...edit, changedFields: ['percentComplete', 'status', 'updatedAt'] })).toBeUndefined();
      // A second edit of a field keeps the first copy it started from.
      expect(scheduleItemChangedSinceMade({ itemData: withPercent, sinceMade: { updatedAt: null, fields: { percentComplete: 0 } } },
        { changedFields: ['percentComplete', 'updatedAt'], base: { updatedAt: null, fields: { percentComplete: 40 } }, itemData: { ...withPercent, percentComplete: 60 } }))
        .toEqual({ updatedAt: null, fields: { percentComplete: 0 }, own: { percentComplete: ['40'] } });
    });

    describe('Review P7-3, P7-4, P7-5: the retry knows the row as this device made it and what of his it has sent', () => {
      const SIDING = 'Siding,Alpha,Lot,11/09/2026,11/13/2026,';
      const siding = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Siding').map(item => [item.percentComplete, item.owner || '', item.notes || '']);
      const sidingEverywhere = async (phone: Device, ipad: Device) => { await refresh(phone); await refresh(ipad); return [siding(deviceShown(phone)), siding(deviceShown(ipad)), siding(webShown())]; };

      it('P7-3 (the reviewer\'s NF2): an owner he typed before the first upload, cleared on the web after the lost answer, is asked about; the web\'s clear stands until he chooses', async () => {
        const { phone, ipad, newId } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Mike' }), (_phone, id) => { webWrite(webEdited(cloudRow(id)!, { owner: '' })); });
        // (It was: "Mike" back on every device, with no card. Before b4de734: a card for the whole task.)
        expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Mike'], cloud: [''] }]);
        expect(cloudRow(newId)).toMatchObject({ owner: '', notes: NOTE });
        await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_local');
        await allSynced(phone, ipad);
        expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
        await noCards(phone, ipad);
      });

      it('...his percent entered before the first upload and set back to nothing on the web after: the progress has its own rules and is never asked about', async () => {
        const { phone, newId } = await lostAnswer((phone, id) => edit(phone, id, { percentComplete: 30 }), (_phone, id) => { webWrite(webEdited(cloudRow(id)!, { percentComplete: 0, status: 'Not Started' })); });
        expect(await cards(phone)).toEqual([]);
        expect(await waitingFor(phone, newId)).toBeUndefined();
      });

      it('...an owner typed AFTER the lost answer goes up as before: nothing of his had been sent, and a pass that fails before it writes does not count as sending', async () => {
        const { phone, ipad } = await lostAnswer(null, async (phone, id) => {
          setOnline(phone, false);
          await edit(phone, id, { owner: 'Mike' });
          await backgroundUpload(phone); // no signal: the pass cannot even read the cloud
          setOnline(phone, true);
        });
        expect(await cards(phone)).toEqual([]);
        await allSynced(phone, ipad);
        expect(await everywhere(phone, ipad)).toEqual(ON_G(0, NOTE, 'Mike'));
        await noCards(phone, ipad);
      });

      it('...an owner typed before, cleared on the web after, and typed again by him before the retry: asked, his last word against the web\'s clear', async () => {
        const { phone, newId } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Mike' }), async (phone, id) => {
          webWrite(webEdited(cloudRow(id)!, { owner: '' }));
          await offline((device, row) => edit(device, row, { owner: 'Mike R.' }))(phone, id);
        });
        expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Mike R.'], cloud: [''] }]);
      });

      it('...and when the retry\'s own answer is lost as well: the owner he typed after the first lost answer has been sent by then, so the web\'s clear of it is asked about', async () => {
        const { phone, newId } = await lostAnswer(null, async (phone, id) => {
          await offline((device, row) => edit(device, row, { owner: 'Mike' }))(phone, id);
          mockCloud.lostAnswerFor = id; // the retry writes "Mike" on the row; its answer does not come back either
        });
        expect([cloudRow(newId)!.owner, await cards(phone), (await waitingFor(phone, newId))?.id]).toEqual(['Mike', [], newId]);
        webWrite(webEdited(cloudRow(newId)!, { owner: '' }));
        await backgroundUpload(phone);
        expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Mike'], cloud: [''] }]);
        expect(cloudRow(newId)!.owner).toBe('');
      });

      it('P7-4 (the reviewer\'s NF1): a lookahead approved on the task between the lost answer and the retry keeps the note and approval the other device set, on the lookahead\'s dates', async () => {
        const { phone, ipad } = await lostAnswer(null, offline(phone => approve(phone, scheduleDoc('LOOKAHEAD P7', '2026-09-12T08:30:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true)));
        shareDocuments(phone);
        await allSynced(phone, ipad);
        // (It was: the whole copy over the row. "Crew short Tuesday" gone everywhere, no card.)
        expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 0, NOTE, '']]));
        expect(controlsEverywhere(phone, ipad)).toEqual(Array(3).fill(['Pending', 5]));
        await noCards(phone, ipad);
      });

      it('...and with his percent entered after that lookahead, and an owner he had typed on the row before its first upload', async () => {
        const { phone, ipad } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Mike' }), offline(async (phone, id) => {
          await approve(phone, scheduleDoc('LOOKAHEAD P7', '2026-09-12T08:30:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
          await edit(phone, id, { percentComplete: 40 });
        }));
        shareDocuments(phone);
        await allSynced(phone, ipad);
        expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 40, NOTE, 'Mike']]));
        await noCards(phone, ipad);
      });

      it('...a lookahead approved before the row first went up, and that upload\'s answer lost: the retry finds the row as it sent it and writes nothing', async () => {
        const { phone, ipad, newId, writes } = await lostAnswer(phone => approve(phone, scheduleDoc('LOOKAHEAD P7', '2026-09-11T09:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true), null);
        expect([await cards(phone), await waitingFor(phone, newId), writesOf(newId, writes)]).toEqual([[], undefined, []]);
        shareDocuments(phone);
        await allSynced(phone, ipad);
        expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 0, NOTE, '']]));
      });

      it('S2 item 6: with a lookahead approved on the task after the lost answer as well, the web\'s clear of the owner he had typed is still asked about', async () => {
        const { phone, ipad, newId } = await lostAnswer((phone, id) => edit(phone, id, { owner: 'Mike' }), async (phone, id) => {
          webWrite(webEdited(cloudRow(id)!, { owner: '' }));
          await offline(device => approve(device, scheduleDoc('LOOKAHEAD P7', '2026-09-12T08:30:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true))(phone, id);
        });
        // (It was: "Mike" back on every device with no card: the whole copy's weighing did not know he had been sent.)
        expect(await cards(phone)).toEqual([{ row: newId, fields: ['owner'], here: ['Mike'], cloud: [''] }]);
        shareDocuments(phone);
        await allSynced(phone, ipad);
        // The lookahead's dates are on the task all the same, with the iPad's note; the owner waits for his choice.
        expect(await everywhere(phone, ipad)).toEqual(Array(3).fill([['10/22/2026', '11/01/2026', 0, NOTE, '']]));
      });

      it('the rule on the records alone', () => {
        const taskOf = () => (rowId: string) => rowId;
        const made = theRowAsApproved();
        const withOwner = { ...made, owner: 'Mike', updatedAt: '2026-09-11T09:00:00.000Z' } as ScheduleItem;
        const record = { updatedAt: null, fields: { owner: '' } };
        const inTheCloud = { ...made, owner: 'Mike', notes: NOTE, textFromTask: { ...made.textFromTask!, notes: NOTE }, updatedAt: '2026-09-12T08:00:01.000Z' } as ScheduleItem;
        const cleared = { ...inTheCloud, owner: '' } as ScheduleItem;
        // P7-3. The retry says which of his fields a write has already sent: all he had changed when a write of this very copy was tried...
        expect(scheduleItemNewRowMetAgain(withOwner, cleared, taskOf, record, true)).toEqual({ changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' }, sent: ['owner'] } });
        expect(scheduleItemNewRowMetAgain(withOwner, cleared, taskOf, record)).toEqual({ changedFields: ['owner', 'updatedAt'], base: { updatedAt: null, fields: { owner: '' } } });
        // (Only what he had changed: a field of the record put back as the row was made was not sent changed.)
        expect(scheduleItemNewRowMetAgain({ ...made, percentComplete: 30, status: 'In Progress', updatedAt: '2026-09-11T09:00:00.000Z' } as ScheduleItem, cleared, taskOf, { updatedAt: null, fields: { owner: '', percentComplete: 0, status: 'Not Started' } }, true)!.base.sent)
          .toEqual(['percentComplete', 'status']);
        // ...or what the record says was sent before a later edit of his joined the waiting copy.
        expect(scheduleItemNewRowMetAgain({ ...withOwner, percentComplete: 30, status: 'In Progress' } as ScheduleItem, cleared, taskOf, { updatedAt: null, fields: { owner: '', percentComplete: 0, status: 'Not Started' }, sent: ['owner'] })!.base.sent).toEqual(['owner']);
        const laterEdit = { changedFields: ['percentComplete', 'updatedAt'], base: { updatedAt: null, fields: { percentComplete: 0 } }, itemData: { ...withOwner, percentComplete: 30 } };
        expect(scheduleItemChangedSinceMade({ itemData: withOwner, sinceMade: record, writeTried: true }, laterEdit)).toEqual({ updatedAt: null, fields: { owner: '', percentComplete: 0 }, sent: ['owner'] });
        expect(scheduleItemChangedSinceMade({ itemData: withOwner, sinceMade: record }, laterEdit)).toEqual({ updatedAt: null, fields: { owner: '', percentComplete: 0 } });
        expect(scheduleItemChangedSinceMade({ itemData: { ...withOwner, percentComplete: 30 }, sinceMade: { updatedAt: null, fields: { owner: '', percentComplete: 0 }, sent: ['owner'] } },
          { changedFields: ['notes', 'updatedAt'], base: { updatedAt: null, fields: { notes: '' } }, itemData: { ...withOwner, percentComplete: 30, notes: 'x' } })!.sent).toEqual(['owner']);
        // A field put back as the row was made by the time the write was tried was not sent changed.
        expect(scheduleItemChangedSinceMade({ itemData: made, sinceMade: record, writeTried: true }, laterEdit)!.sent).toBeUndefined();
        // An edit weighed against the cloud: the row's first value back in the cloud, for a field of his that was sent, is another device's change. Asked.
        const edit = (sent?: string[]) => ({ updatedAt: null, fields: { owner: '', percentComplete: 0 }, ...(sent ? { sent } : {}) });
        expect(scheduleItemEditAgainstCloud(withOwner, ['owner', 'updatedAt'], edit(['owner']), cleared).asked).toEqual(['owner']);
        expect(scheduleItemEditAgainstCloud(withOwner, ['owner', 'updatedAt'], edit(), cleared).asked).toEqual([]);
        expect(scheduleItemEditAgainstCloud(withOwner, ['owner', 'updatedAt'], edit(['owner']), inTheCloud)).toMatchObject({ asked: [], keptFromCloud: [] });
        // (His percent is never asked about, sent or not.)
        expect(scheduleItemEditAgainstCloud({ ...withOwner, percentComplete: 30 } as ScheduleItem, ['percentComplete', 'updatedAt'], edit(['percentComplete']), cleared)).toMatchObject({ asked: [], keptFromCloud: [] });

        // P7-5. A row that says nothing of what it took (a task the master adds), with the record: his changes since it was made; without: not this case.
        const added = { ...made, id: 'MASTER G-3', taskName: 'Siding', revisedFromTaskIds: undefined, textFromTask: undefined } as ScheduleItem;
        const addedInCloud = { ...added, owner: 'Ana', updatedAt: '2026-09-12T08:20:00.000Z' } as ScheduleItem;
        expect(scheduleItemNewRowMetAgain(added, addedInCloud, taskOf, SCHEDULE_ITEM_AS_MADE)).toBeNull();
        expect(scheduleItemNewRowMetAgain({ ...added, notes: 'His note', percentComplete: 20, updatedAt: '2026-09-12T08:30:00.000Z' } as ScheduleItem, addedInCloud, taskOf, { updatedAt: null, fields: { notes: '', percentComplete: 0 } }))
          .toEqual({ changedFields: ['notes', 'percentComplete', 'updatedAt'], base: { updatedAt: null, fields: { notes: '', percentComplete: 0 } } });
        expect(scheduleItemNewRowMetAgain(added, addedInCloud, taskOf)).toBeUndefined();

        // P7-4. A whole copy saved over the waiting row starts from the row as made: what he had changed put back.
        const beforeLookahead = { ...withOwner, percentComplete: 30 } as ScheduleItem;
        const started = scheduleItemWholeCopyBaseSinceMade({ updatedAt: null, fields: { owner: '', percentComplete: 0 }, own: { owner: ['"Mick"'] } }, scheduleItemWholeCopyBase(beforeLookahead))!;
        expect([started.fields.owner, started.copy!.owner, started.copy!.percentComplete, started.copy!.startDate, started.rest, started.own]).toEqual(['', '', 0, made.startDate, undefined, { owner: ['"Mick"'] }]);
        expect(scheduleItemWholeCopyBaseSinceMade(undefined, scheduleItemWholeCopyBase(beforeLookahead))).toBeUndefined();
        // S2 item 6: and what a write had sent of his goes with it: what the record already says, and all he had changed
        // when a write of the waiting copy was tried as it stood.
        const tracked = { updatedAt: null, fields: { owner: '', percentComplete: 0, notes: '' }, sent: ['notes'] };
        expect(scheduleItemWholeCopyBaseSinceMade(tracked, scheduleItemWholeCopyBase(beforeLookahead))!.sent).toEqual(['notes']);
        expect(scheduleItemWholeCopyBaseSinceMade(tracked, scheduleItemWholeCopyBase(beforeLookahead), { itemData: beforeLookahead, writeTried: true })!.sent).toEqual(['notes', 'owner', 'percentComplete']);
        expect(scheduleItemWholeCopyBaseSinceMade(record, scheduleItemWholeCopyBase(beforeLookahead), { itemData: beforeLookahead })!.sent).toBeUndefined();
        // A field of his that was sent and that the cloud holds as the row was made again: asked, in a whole copy's weighing too.
        const sentBase = scheduleItemWholeCopyBaseSinceMade(record, scheduleItemWholeCopyBase(beforeLookahead), { itemData: beforeLookahead, writeTried: true })!;
        expect(scheduleItemWholeCopyAgainstCloud(beforeLookahead, beforeLookahead, sentBase, cleared).asked).toEqual(['owner']);
        expect(scheduleItemWholeCopyAgainstCloud(beforeLookahead, beforeLookahead, { ...sentBase, sent: undefined }, cleared).asked).toEqual([]);
        expect(scheduleItemWholeCopyBaseSinceMade(record, { updatedAt: null, fields: { owner: 'Mike' } })).toBeUndefined();
        // And a value of his own that an earlier write put in the cloud is not another device's change, in what he types or in the rest.
        const lookahead = { ...beforeLookahead, owner: 'Mike', startDate: '10/24/2026' } as ScheduleItem;
        const ownEarlier = { ...started, copy: { ...started.copy!, startDate: '10/20/2026' }, own: { owner: ['"Mick"'], startDate: ['"2026-10-22"'] } };
        const earlierInCloud = { ...made, owner: 'Mick', startDate: '10/22/2026' } as ScheduleItem;
        expect(scheduleItemWholeCopyAgainstCloud(lookahead, lookahead, ownEarlier, earlierInCloud)).toMatchObject({ asked: [], itemData: { owner: 'Mike' } });
        expect(scheduleItemWholeCopyAgainstCloud(lookahead, lookahead, { ...ownEarlier, own: undefined }, earlierInCloud).asked).toEqual(['owner']);
        expect(scheduleItemWholeCopyFieldByField(lookahead, ownEarlier, earlierInCloud, earlierInCloud)).toMatchObject({ asked: [], itemData: { startDate: '10/24/2026' } });
        expect(scheduleItemWholeCopyFieldByField(lookahead, { ...ownEarlier, own: undefined }, earlierInCloud, earlierInCloud)!.asked).toEqual(['startDate']);
      });

      /** The phone, with no signal, approves master G, which adds Siding. Its rows' first writes reach the cloud; the answer to Siding's is lost. */
      async function sidingsAnswerLost(between: (phone: Device, sidingId: string) => Promise<unknown> | unknown) {
        const { phone, ipad } = await start();
        at('2026-09-08T08:00:00.000Z');
        setOnline(phone, false);
        at(G.importedAt!);
        await approve(phone, G, [G_ROW, SURVEY, SIDING]);
        const sidingId = deviceShown(phone).find(item => item.taskName === 'Siding')!.id;
        at('2026-09-12T08:00:00.000Z');
        setOnline(phone, true);
        shareDocuments(phone);
        mockCloud.lostAnswerFor = sidingId;
        await backgroundUpload(phone);
        expect([Boolean(cloudRow(sidingId)), (await waitingFor(phone, sidingId))?.id, (await waitingFor(phone, sidingId))?.changedFields]).toEqual([true, sidingId, undefined]);
        at('2026-09-12T08:30:00.000Z');
        await between(phone, sidingId);
        at('2026-09-12T09:00:00.000Z');
        await backgroundUpload(phone);
        return { phone, ipad, sidingId };
      }

      it('P7-5 (the reviewer\'s NF3): a task the master ADDS; the web types an owner on it after the lost answer and he enters 20% before the retry: both are on the task', async () => {
        const { phone, ipad } = await sidingsAnswerLost(async (phone, id) => {
          webWrite(webEdited(cloudRow(id)!, { owner: 'Ana' }));
          await offline((device, row) => edit(device, row, { percentComplete: 20 }))(phone, id);
        });
        // (It was: 20% and no owner, the web's "Ana" gone from the task on every device, with no card.)
        expect(await cards(phone)).toEqual([]);
        await allSynced(phone, ipad);
        expect(await sidingEverywhere(phone, ipad)).toEqual(Array(3).fill([[20, 'Ana', '']]));
        await noCards(phone, ipad);
      });

      it('...and without his 20% (NF3b): the web\'s owner stays and no card is raised (it was a card for the whole task, with nothing to choose)', async () => {
        const { phone, ipad, sidingId } = await sidingsAnswerLost((_phone, id) => { webWrite(webEdited(cloudRow(id)!, { owner: 'Ana' })); });
        expect([await cards(phone), await waitingFor(phone, sidingId)]).toEqual([[], undefined]);
        await allSynced(phone, ipad);
        expect(await sidingEverywhere(phone, ipad)).toEqual(Array(3).fill([[0, 'Ana', '']]));
      });

      it('...a note he types on the added task after the lost answer, where the web has typed one too: asked about the note', async () => {
        const { phone, sidingId } = await sidingsAnswerLost(async (phone, id) => {
          webWrite(webEdited(cloudRow(id)!, { notes: 'Web note' }));
          await offline((device, row) => edit(device, row, { notes: 'His note' }))(phone, id);
        });
        expect(await cards(phone)).toEqual([{ row: sidingId, fields: ['notes'], here: ['His note'], cloud: ['Web note'] }]);
      });
    });
  });

  describe('Review P7-2: a lookahead approved with no signal, and something else set on the task on another device meanwhile', () => {
    const LOOK = scheduleDoc('LOOKAHEAD P7', '2026-09-12T09:00:00.000Z', 'lookahead');
    /** In each of the three places: Framing's start, percent, note, approval status and schedule impact. */
    const framingEverywhere = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()].map(items => {
      const row = framingOf(items)[0];
      const controls = normalizeProjectControls(row?.projectControls);
      return [row?.startDate, row?.percentComplete, row?.notes || '', controls.approvalStatus, controls.estimatedScheduleImpactDays ?? null];
    });
    /**
     * The phone, with no signal, approves a lookahead that moves Framing to 10/22 (at 40% when `percent`). Meanwhile
     * `meanwhile` happens with signal. Then everything syncs.
     */
    async function lookaheadWithNoSignal(meanwhile: (ipad: Device) => Promise<unknown> | unknown, percent = '40') {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-12T09:00:00.000Z');
      await approve(phone, LOOK, [`Framing,Alpha,Lot,10/22/2026,11/01/2026,${percent}`], true);
      at('2026-09-12T10:00:00.000Z');
      await meanwhile(ipad);
      await backgroundUpload(ipad);
      at('2026-09-13T08:00:00.000Z');
      await allSynced(phone, ipad);
      return { phone, ipad };
    }

    it.each([
      ['an approval status', (ipad: Device) => setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' }), ['10/22/2026', 40, '', 'Pending', null]],
      ['a schedule impact', (ipad: Device) => setControls(ipad, theRow(ipad).id, { estimatedScheduleImpactDays: 5 }), ['10/22/2026', 40, '', 'Not Required', 5]],
      ['a note typed on the web', () => { webWrite(webEdited(cloudRow('MASTER F-1')!, { notes: 'Web note' })); }, ['10/22/2026', 40, 'Web note', 'Not Required', null]],
      ['a note and an approval status', async (ipad: Device) => { await edit(ipad, theRow(ipad).id, { notes: NOTE }); await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' }); }, ['10/22/2026', 40, NOTE, 'Pending', null]],
    ] as const)('%s set meanwhile: the lookahead\'s dates and percent stand, and so does what was set; no card', async (_what, meanwhile, expected) => {
      const { phone, ipad } = await lookaheadWithNoSignal(meanwhile);
      // (It was: 10/15 at 0% in all three places, with what the other device had set, and no card. The lookahead in
      // effect listed the task and the task did not show it.)
      expect(framingEverywhere(phone, ipad)).toEqual(Array(3).fill(expected));
      await noCards(phone, ipad);
      expect([await queueOf(phone), await queueOf(ipad)]).toEqual([[], []]);
    });

    it('his own percent entered meanwhile: the lookahead\'s dates stand, and the percent is the one the progress\'s own rules give (his, entered after the file\'s)', async () => {
      const { phone, ipad } = await lookaheadWithNoSignal(ipad => edit(ipad, theRow(ipad).id, { percentComplete: 60 }));
      // (It was: 10/15 at 60%.)
      expect(framingEverywhere(phone, ipad)).toEqual(Array(3).fill(['10/22/2026', 60, '', 'Not Required', null]));
      await noCards(phone, ipad);
    });

    it('...and that percent is still his when the lookahead is deleted with its items afterwards: the master\'s dates come back, not the percent it had before', async () => {
      const { phone, ipad } = await lookaheadWithNoSignal(ipad => edit(ipad, theRow(ipad).id, { percentComplete: 60 }));
      at('2026-09-14T08:00:00.000Z');
      await deleteWithItems(phone, LOOK);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 60, '', 'Not Required', null]));
    });

    it('his 30% already on the task, the lookahead states 70%, and he enters 60% elsewhere meanwhile: 60% on the lookahead\'s dates, and 60% still when the lookahead is deleted with its items', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 30 });
      await backgroundUpload(phone); await refresh(ipad);
      setOnline(phone, false);
      at('2026-09-12T09:00:00.000Z');
      await approve(phone, LOOK, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,70'], true);
      at('2026-09-12T10:00:00.000Z');
      await edit(ipad, theRow(ipad).id, { percentComplete: 60 });
      await backgroundUpload(ipad);
      at('2026-09-13T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad).map(row => row.slice(0, 2))).toEqual(Array(3).fill(['10/22/2026', 60]));
      at('2026-09-14T08:00:00.000Z');
      await deleteWithItems(phone, LOOK);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad).map(row => row.slice(0, 2))).toEqual(Array(3).fill(['10/15/2026', 60]));
      await noCards(phone, ipad);
    });

    it('a lookahead that states no percent, and his percent entered meanwhile: both stand', async () => {
      const { phone, ipad } = await lookaheadWithNoSignal(ipad => edit(ipad, theRow(ipad).id, { percentComplete: 60 }), '');
      expect(framingEverywhere(phone, ipad)).toEqual(Array(3).fill(['10/22/2026', 60, '', 'Not Required', null]));
      await noCards(phone, ipad);
    });

    it('the same field changed on both sides is asked about: the dates he moved by hand meanwhile stay until he chooses, and Keep Phone puts the lookahead\'s', async () => {
      const { phone, ipad } = await lookaheadWithNoSignal(ipad => edit(ipad, theRow(ipad).id, { startDate: '10/17/2026', finishDate: '10/27/2026' }));
      // (It was: his hand dates everywhere, the lookahead's dates and its 40% on no device and no card.)
      expect((await cards(phone)).map(card => [card.row, card.fields, card.here, card.cloud])).toEqual([['MASTER F-1', ['startDate', 'finishDate'], ['10/22/2026', '11/01/2026'], ['10/17/2026', '10/27/2026']]]);
      expect(framingEverywhere(phone, ipad).map(row => row.slice(0, 2))).toEqual(Array(3).fill(['10/17/2026', 40]));
      await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_local');
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad).map(row => row.slice(0, 2))).toEqual(Array(3).fill(['10/22/2026', 40]));
      await noCards(phone, ipad);
    });

    it('...and Keep Cloud leaves the dates he moved by hand, under the lookahead; nothing else of the lookahead is undone', async () => {
      const { phone, ipad } = await lookaheadWithNoSignal(ipad => edit(ipad, theRow(ipad).id, { startDate: '10/17/2026', finishDate: '10/27/2026' }));
      await chooseInSettings(phone, (await conflictsOf(phone))[0].id, 'keep_cloud');
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad).map(row => row.slice(0, 2))).toEqual(Array(3).fill(['10/17/2026', 40]));
      await noCards(phone, ipad);
      expect([await queueOf(phone), await queueOf(ipad)]).toEqual([[], []]);
    });

    it('with a note typed here before the lookahead was approved, both still waiting: the same', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      await edit(phone, theRow(phone).id, { notes: NOTE });
      at('2026-09-12T09:00:00.000Z');
      await approve(phone, LOOK, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,40'], true);
      at('2026-09-12T10:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await backgroundUpload(ipad);
      at('2026-09-13T08:00:00.000Z');
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad)).toEqual(Array(3).fill(['10/22/2026', 40, NOTE, 'Pending', null]));
      await noCards(phone, ipad);
    });

    it('the row it writes is stamped after both copies: the other device\'s Sync Now, run before it has refreshed, takes it and does not send its own older copy back', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-12T09:00:00.000Z');
      await approve(phone, LOOK, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
      at('2026-09-12T10:00:00.000Z');
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await backgroundUpload(ipad);
      const asTheIPadWroteIt = cloudRow('MASTER F-1')!.updatedAt!;
      at('2026-09-13T08:00:00.000Z');
      setOnline(phone, true); shareDocuments(phone);
      await backgroundUpload(phone);
      expect(Date.parse(cloudRow('MASTER F-1')!.updatedAt!)).toBeGreaterThan(Date.parse(asTheIPadWroteIt));
      shareDocuments(ipad);
      await fullSync(ipad);
      expect([cloudRow('MASTER F-1')!.startDate, normalizeProjectControls(cloudRow('MASTER F-1')!.projectControls).approvalStatus, theRow(ipad).startDate]).toEqual(['10/22/2026', 'Pending', '10/22/2026']);
    });

    it('a copy that holds nothing the cloud\'s row lacks writes nothing: the same whole copy queued again after it went up, with an approval set elsewhere since', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false);
      at('2026-09-12T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { notes: NOTE });
      await approve(phone, LOOK, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
      at('2026-09-12T10:00:00.000Z');
      setOnline(phone, true); shareDocuments(phone);
      await backgroundUpload(phone);
      await setControls(ipad, theRow(ipad).id, { approvalStatus: 'Pending' });
      await backgroundUpload(ipad);
      const before = cloudRow('MASTER F-1')!;
      const writes = mockCloud.writes.length;
      on(phone);
      await phone.m.sync.queueScheduleItemRecord(theRow(phone), false, undefined, theRow(phone));
      await backgroundUpload(phone);
      expect([mockCloud.writes.slice(writes).filter(write => write.endsWith(':MASTER F-1')), cloudRow('MASTER F-1')!.updatedAt, await cards(phone)]).toEqual([[], before.updatedAt, []]);
    });

    it('the rule on the records alone', () => {
      const was = { id: 'MASTER F-1', taskName: 'Framing', startDate: '10/15/2026', finishDate: '10/25/2026', percentComplete: 0, status: 'Not Started', notes: '', owner: '', importBatchId: 'batch-MASTER F' } as ScheduleItem;
      const overlay = { masterStartDate: '10/15/2026', masterFinishDate: '10/25/2026', lookaheads: [{ batchId: 'batch-L', startDate: '10/22/2026', finishDate: '11/01/2026' }] } as unknown as ScheduleItem['lookaheadOverlay'];
      /** The lookahead's copy: its dates, its note of the master's dates, its 40%, and the import it now belongs to as well. */
      const mine = { ...was, startDate: '10/22/2026', finishDate: '11/01/2026', lookaheadOverlay: overlay, percentComplete: 40, status: 'In Progress', alsoImportedInBatchIds: ['batch-L'], updatedAt: '2026-09-12T09:00:00.000Z' } as ScheduleItem;
      const base = scheduleItemWholeCopyBase(was)!;
      expect(base.copy).toEqual(was);
      const pending = reviseProjectControls({ current: undefined, patch: { approvalStatus: 'Pending' }, actor: 'David', now: '2026-09-12T10:00:00.000Z' });
      const weigh = (cloud: ScheduleItem, merged: ScheduleItem = cloud) => scheduleItemWholeCopyFieldByField(mine, base, cloud, merged);
      // Only the cloud's row changed a field (the approval, a duration set on the web): it stays, with everything only this copy changed.
      const approved = { ...was, projectControls: pending, durationDays: 9, updatedAt: '2026-09-12T10:00:00.000Z' } as ScheduleItem;
      expect(weigh(approved)).toEqual({ asked: [], itemData: { ...approved, startDate: '10/22/2026', finishDate: '11/01/2026', lookaheadOverlay: overlay, percentComplete: 40, status: 'In Progress', alsoImportedInBatchIds: ['batch-L'] } });
      // Both changed the dates, differently: asked, and the cloud's stay; changed to the same days: nothing to ask.
      expect(weigh({ ...was, startDate: '10/17/2026', finishDate: '10/27/2026' } as ScheduleItem)).toMatchObject({ asked: ['startDate', 'finishDate'], itemData: { startDate: '10/17/2026', finishDate: '10/27/2026', lookaheadOverlay: overlay, percentComplete: 40 } });
      expect(weigh({ ...was, startDate: '2026-10-22', finishDate: '2026-11-01' } as ScheduleItem)!.asked).toEqual([]);
      // Both changed the progress: as the sync merge states it, the whole of it together. Only the cloud's row did: the cloud's.
      const his = { ...was, percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-12T10:00:00.000Z', progressConfirmedBy: 'David' } as ScheduleItem;
      expect(weigh(his, his)).toMatchObject({ asked: [], itemData: { percentComplete: 60, progressSource: 'project_manager', progressConfirmedBy: 'David', startDate: '10/22/2026' } });
      expect(weigh(his, mine)!.itemData).toMatchObject({ percentComplete: 40, status: 'In Progress' });
      expect(scheduleItemWholeCopyFieldByField({ ...mine, percentComplete: 0, status: 'Not Started' } as ScheduleItem, base, his, mine)!.itemData).toMatchObject({ percentComplete: 60, progressConfirmedBy: 'David' });
      // The imports a task belongs to, changed on both: the sync merge's list of both.
      expect(weigh({ ...was, alsoImportedInBatchIds: ['batch-G'] } as ScheduleItem, { ...was, alsoImportedInBatchIds: ['batch-L', 'batch-G'] } as ScheduleItem)!.itemData.alsoImportedInBatchIds).toEqual(['batch-L', 'batch-G']);
      // Both changed the lookahead note (two lookaheads approved apart), or the copy keeps no copy it started from: not this rule's.
      expect(weigh({ ...was, lookaheadOverlay: { ...overlay, lookaheads: [] } } as ScheduleItem)).toBeNull();
      expect(scheduleItemWholeCopyFieldByField(mine, { updatedAt: null, fields: base.fields, rest: base.rest }, approved, approved)).toBeNull();
      // His controls on both copies: each field by its own time. The activity of both, when this copy added to it.
      const impact = reviseProjectControls({ current: undefined, patch: { estimatedScheduleImpactDays: 2 }, actor: 'David', now: '2026-09-12T09:30:00.000Z' });
      expect(normalizeProjectControls(scheduleItemWholeCopyFieldByField({ ...mine, projectControls: impact } as ScheduleItem, base, approved, approved)!.itemData.projectControls))
        .toMatchObject({ approvalStatus: 'Pending', estimatedScheduleImpactDays: 2 });
      const entry = (id: string) => ({ id, message: id, author: 'David', createdAt: '2026-09-12T09:00:00.000Z' });
      expect(scheduleItemWholeCopyFieldByField({ ...mine, activity: [entry('a')] } as ScheduleItem, base, { ...was, activity: [entry('b')] } as ScheduleItem, was)!.itemData.activity!.map(item => item.id)).toEqual(['b', 'a']);
      // A field of the rest that is asked about keeps the copy it started from in its card.
      expect(scheduleItemEditBaseOf(base, ['startDate', 'owner'])).toEqual({ updatedAt: null, fields: { startDate: '10/15/2026', owner: '' } });
      // A whole copy joining an edit still waiting: the copy it started from is the task less what that edit changed.
      const typedFirst = { changedFields: ['notes', 'updatedAt'], base: { updatedAt: null, fields: { notes: '' } }, itemData: { ...was, notes: NOTE } };
      expect(scheduleItemEditBasesMerged(typedFirst, { itemData: { ...mine, notes: NOTE }, base: scheduleItemWholeCopyBase({ ...was, notes: NOTE } as ScheduleItem) })!.copy).toEqual(was);
      expect(scheduleItemEditBasesMerged(typedFirst, { changedFields: ['owner', 'updatedAt'], itemData: { ...was, notes: NOTE, owner: 'Ana' }, base: { updatedAt: null, fields: { owner: '' } } })!.copy).toBeUndefined();
    });

    it('two lookaheads approved apart on two devices, each with no signal, end as before: the newer one\'s dates', async () => {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      setOnline(phone, false); setOnline(ipad, false);
      at('2026-09-12T09:00:00.000Z');
      await approve(phone, LOOK, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
      at('2026-09-12T10:00:00.000Z');
      await approve(ipad, scheduleDoc('LOOKAHEAD P7 B', '2026-09-12T10:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/24/2026,11/03/2026,'], true);
      at('2026-09-13T08:00:00.000Z');
      shareDocuments(phone); shareDocuments(ipad);
      await allSynced(phone, ipad);
      expect(framingEverywhere(phone, ipad).map(row => row[0])).toEqual(Array(3).fill('10/24/2026'));
      await noCards(phone, ipad);
    });
  });

  /**
   * Review pass 1 of Build 231's schedule round, P1-11 (7 Oct 2026; Medium; caused by "Review P7-2 ...: a whole copy
   * of a task is weighed field by field", found by bisect; the reviewer's generator seed 5067). He has 50% on Framing.
   * On the phone he enters 65%. The iPad, which has not heard that yet, approves a lookahead that states 60%: its
   * lookahead note records 50% as "the percent before the lookahead". That lookahead is later deleted with its items.
   * Build 230 gave back 65%, his latest entry; this round gave back 50%, the percent he had already replaced, in all
   * three places and with no card. The sync merge has always brought such a note up to his later percent on the
   * other copy; weighed field by field, the lookahead's copy put its note on the cloud's row as it was.
   */
  describe('Review pass 1, P1-11 (caused by Review P7-2): a lookahead approved on a device that had not heard his latest percent, and deleted or replaced later', () => {
    const LOOK = scheduleDoc('LOOKAHEAD P11', '2026-09-09T12:00:00.000Z', 'lookahead');
    const LOOK_ROW = 'Framing,Alpha,Lot,10/22/2026,11/01/2026,60';
    /** In each of the three places: Framing's start and percent. */
    const framing = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()].map(items => [framingOf(items)[0]?.startDate, framingOf(items)[0]?.percentComplete]);
    const starts = (phone: Device, ipad: Device) => framing(phone, ipad).map(row => row[0]);
    /** He has 50% on Framing, heard in all three places. */
    async function fiftyEverywhere() {
      const { phone, ipad } = await start();
      at('2026-09-08T08:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 50 });
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 50]));
      return { phone, ipad };
    }
    /**
     * He enters 65% (`enters`: on the phone and sent, or on the web). The iPad, with signal but not yet refreshed,
     * approves the lookahead stating 60%. Then everything syncs.
     */
    async function lookaheadBeforeHearing(enters: 'phone' | 'web' = 'phone') {
      const { phone, ipad } = await fiftyEverywhere();
      at('2026-09-09T09:00:00.000Z');
      if (enters === 'web') webWrite(webEdited(cloudRow('MASTER F-1')!, { percentComplete: '65' }));
      else { await edit(phone, theRow(phone).id, { percentComplete: 65 }); await backgroundUpload(phone); }
      expect([cloudRow('MASTER F-1')!.percentComplete, theRow(ipad).percentComplete]).toEqual([65, 50]);
      at(LOOK.importedAt!);
      await approve(ipad, LOOK, [LOOK_ROW], true);
      shareDocuments(ipad);
      await backgroundUpload(ipad);
      at('2026-09-09T18:00:00.000Z');
      await allSynced(phone, ipad);
      // (The percent shown under the lookahead is review P1-16's, older and not this finding's: not pinned here.)
      expect(starts(phone, ipad)).toEqual(Array(3).fill('10/22/2026'));
      return { phone, ipad };
    }

    it.each([['phone'], ['ipad']] as const)('entered on the phone, the lookahead deleted with its items on the %s: his 65% comes back in all three places, not the 50% he had replaced', async where => {
      const { phone, ipad } = await lookaheadBeforeHearing();
      at('2026-09-10T12:00:00.000Z');
      const device = where === 'phone' ? phone : ipad;
      await deleteWithItems(device, LOOK);
      shareDocuments(device);
      await allSynced(phone, ipad);
      // (It was: 10/15 at 50% in all three places.)
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
      expect([await queueOf(phone), await queueOf(ipad)]).toEqual([[], []]);
    });

    it('entered on the web: the same', async () => {
      const { phone, ipad } = await lookaheadBeforeHearing('web');
      at('2026-09-10T12:00:00.000Z');
      await deleteWithItems(phone, LOOK);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
    });

    it('a newer lookahead that leaves the task out replaces it, and the replaced lookahead is then deleted with its items: his 65%', async () => {
      const { phone, ipad } = await lookaheadBeforeHearing();
      at('2026-09-16T12:00:00.000Z');
      await approve(phone, scheduleDoc('LOOKAHEAD P11 B', '2026-09-16T12:00:00.000Z', 'lookahead'), ['Survey,Alpha,Lot,10/13/2026,10/15/2026,'], true);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(starts(phone, ipad)).toEqual(Array(3).fill('10/15/2026'));
      at('2026-09-17T12:00:00.000Z');
      await deleteWithItems(ipad, LOOK);
      shareDocuments(ipad);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
    });

    it('the next master moves the task, and the lookahead is deleted with its items after that: his 65% on the master\'s dates', async () => {
      const { phone, ipad } = await lookaheadBeforeHearing();
      at('2026-09-10T18:00:00.000Z');
      await approve(phone, scheduleDoc('MASTER G', '2026-09-10T18:00:00.000Z'), ['Framing,Alpha,Lot,10/26/2026,11/05/2026,', SURVEY]);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      at('2026-09-11T18:00:00.000Z');
      await deleteWithItems(ipad, LOOK);
      shareDocuments(ipad);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/26/2026', 65]));
      await noCards(phone, ipad);
    });

    it('with a note typed on the phone after the lookahead was approved with no signal (the cloud\'s row is then the later stamped): the lookahead\'s dates, the note, and his 65% when the lookahead is deleted', async () => {
      const { phone, ipad } = await fiftyEverywhere();
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 65 });
      await backgroundUpload(phone);
      setOnline(ipad, false);
      at(LOOK.importedAt!);
      await approve(ipad, LOOK, [LOOK_ROW], true);
      at('2026-09-09T13:00:00.000Z');
      await edit(phone, theRow(phone).id, { notes: NOTE });
      await backgroundUpload(phone);
      at('2026-09-09T18:00:00.000Z');
      // The iPad's signal comes back and its waiting approval goes up at once; the phone hears of it after that.
      setOnline(ipad, true); shareDocuments(ipad);
      await backgroundUpload(ipad);
      await allSynced(phone, ipad);
      expect([deviceShown(phone), deviceShown(ipad), webShown()].map(items => [framingOf(items)[0]?.startDate, framingOf(items)[0]?.notes])).toEqual(Array(3).fill(['10/22/2026', NOTE]));
      at('2026-09-10T12:00:00.000Z');
      await deleteWithItems(phone, LOOK);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
    });

    it('the other order (the lookahead approved with no signal first, his 65% entered elsewhere after it): 65% under the lookahead and 65% when it is deleted, as before', async () => {
      const { phone, ipad } = await fiftyEverywhere();
      setOnline(ipad, false);
      at(LOOK.importedAt!);
      await approve(ipad, LOOK, [LOOK_ROW], true);
      at('2026-09-09T15:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 65 });
      await backgroundUpload(phone);
      at('2026-09-09T18:00:00.000Z');
      setOnline(ipad, true); shareDocuments(ipad);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/22/2026', 65]));
      at('2026-09-10T12:00:00.000Z');
      await deleteWithItems(ipad, LOOK);
      shareDocuments(ipad);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
    });

    it('his 65% entered with no signal and sent only after the other device\'s lookahead went up: 65% when the lookahead is deleted', async () => {
      const { phone, ipad } = await fiftyEverywhere();
      setOnline(phone, false);
      at('2026-09-09T09:00:00.000Z');
      await edit(phone, theRow(phone).id, { percentComplete: 65 });
      at(LOOK.importedAt!);
      await approve(ipad, LOOK, [LOOK_ROW], true);
      shareDocuments(ipad);
      await backgroundUpload(ipad);
      at('2026-09-09T18:00:00.000Z');
      await allSynced(phone, ipad);
      expect(starts(phone, ipad)).toEqual(Array(3).fill('10/22/2026'));
      at('2026-09-10T12:00:00.000Z');
      await deleteWithItems(phone, LOOK);
      shareDocuments(phone);
      await allSynced(phone, ipad);
      expect(framing(phone, ipad)).toEqual(Array(3).fill(['10/15/2026', 65]));
      await noCards(phone, ipad);
    });

    it('the rule on the records alone: the note this copy puts on the cloud\'s row is brought up to his later percent there, by the sync merge\'s own rule', () => {
      const T50 = '2026-09-08T08:00:00.000Z';
      const T65 = '2026-09-09T09:00:00.000Z';
      const TL = '2026-09-09T12:00:00.000Z';
      const was = {
        id: 'MASTER F-1', taskName: 'Framing', startDate: '10/15/2026', finishDate: '10/25/2026', percentComplete: 50, status: 'In Progress', notes: '', owner: '',
        importBatchId: 'batch-MASTER F', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: T50, updatedAt: T50,
      } as ScheduleItem;
      const note = {
        masterStartDate: '10/15/2026', masterFinishDate: '10/25/2026', masterPercentComplete: 50, masterStatus: 'In Progress', masterProgressSource: 'project_manager',
        masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: T50, masterFilePercentComplete: null,
        lookaheads: [{ batchId: 'batch-L', startDate: '10/22/2026', finishDate: '11/01/2026', percentComplete: 60 }],
      } as unknown as NonNullable<ScheduleItem['lookaheadOverlay']>;
      /** The lookahead's copy: its dates, its 60% over his 50%, and its note of what the task said before it. */
      const mine = {
        ...was, startDate: '10/22/2026', finishDate: '11/01/2026', lookaheadOverlay: note, percentComplete: 60, progressConfirmedBy: 'Schedule update', progressConfirmedAt: TL,
        managersPercentUnderFile: 50, managersPercentUnderFileJudgedAt: T50, alsoImportedInBatchIds: ['batch-L'], updatedAt: TL,
      } as ScheduleItem;
      const base = scheduleItemWholeCopyBase(was)!;
      const weigh = (cloud: ScheduleItem, copy: ScheduleItem = mine) => scheduleItemWholeCopyFieldByField(copy, base, cloud,
        recoverDAVEScheduleRecords({ local: [copy], cloud: [cloud], allowCloudOnly: true }).find(row => row.id === was.id)!)!.itemData;
      // His later 65% on the cloud's row, which this copy had not heard: the note says 65%, his, and when he judged it.
      const his65 = { ...was, percentComplete: 65, progressConfirmedAt: T65, updatedAt: T65 } as ScheduleItem;
      expect(weigh(his65).lookaheadOverlay).toEqual({ ...note, masterPercentComplete: 65, masterProgressConfirmedAt: T65 });
      expect(weigh(his65)).toMatchObject({ startDate: '10/22/2026', alsoImportedInBatchIds: ['batch-L'] });
      // The same when something else stamped the cloud's row later than this copy (a note typed on the web).
      expect(weigh({ ...his65, notes: 'Web note', updatedAt: '2026-09-09T13:00:00.000Z' } as ScheduleItem).lookaheadOverlay).toMatchObject({ masterPercentComplete: 65, masterProgressConfirmedAt: T65 });
      // Nothing of his entered since on the cloud's row (an approval status set there): the note as this copy made it.
      const pending = { ...was, projectControls: reviseProjectControls({ current: undefined, patch: { approvalStatus: 'Pending' }, actor: 'David', now: T65 }), updatedAt: T65 } as ScheduleItem;
      expect(weigh(pending).lookaheadOverlay).toBe(note);
      // A file's percent on the cloud's row is no entry of his: the note as it is.
      expect(weigh({ ...was, percentComplete: 70, progressSource: 'schedule_import', progressConfirmedBy: null, progressConfirmedAt: T65, updatedAt: T65 } as ScheduleItem).lookaheadOverlay).toBe(note);
      // This copy took the note off (the lookahead deleted here): nothing to bring up, and no note comes back.
      const { lookaheadOverlay: _gone, ...deleted } = { ...mine, startDate: '10/15/2026', finishDate: '10/25/2026', percentComplete: 50, progressConfirmedBy: 'David' } as ScheduleItem;
      const noted = scheduleItemWholeCopyBase({ ...was, lookaheadOverlay: note } as ScheduleItem)!;
      expect(scheduleItemWholeCopyFieldByField(deleted as ScheduleItem, noted, { ...his65, lookaheadOverlay: note } as ScheduleItem, his65)!.itemData).not.toHaveProperty('lookaheadOverlay');
    });
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Schedule batch S5, item 1 (7 Oct 2026; Medium, older: the same on Build 229). A task's activity notes (its dated
 * history lines) and its priority stayed on the hidden old row when a master moved the task. They follow it now by
 * the rule his owner and note follow by, on the same paths: the approval, the new row's first upload, an edit typed
 * on the replaced row, and the sync's own merge. The rule on the records alone: sched-s5-activity-priority-follow.
 */
describe('S5 item 1: activity notes and the priority follow a task a master moved, between two devices', () => {
  const entry = (id: string, createdAt: string) => ({ id, message: `Note ${id}`, author: 'David', createdAt });
  const N1 = entry('n1', '2026-09-08T07:00:00.000Z');
  const N2 = entry('n2', '2026-09-11T09:00:00.000Z');
  const history = (item: ScheduleItem | undefined) => [(item?.activity ?? []).map(line => line.id), item?.priority];
  const historyEverywhere = async (phone: Device, ipad: Device) => {
    await refresh(phone); await refresh(ipad);
    return [history(theRow(phone)), history(theRow(ipad)), history(framingOf(webShown())[0])];
  };
  const nothingWaits = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);

  it('a note added and the priority set on the iPad, which had not heard of the master: both show on the task everywhere, the note once, nothing asked, and more syncing writes nothing', async () => {
    const { phone, ipad, oldId, newId } = await typedOnTheOldRow(async (ipad, oldId) => {
      await edit(ipad, oldId, { activity: [N2] });
      at('2026-09-11T09:05:00.000Z');
      await edit(ipad, oldId, { priority: 'High' });
    });
    await settle(phone, ipad);
    expect(await historyEverywhere(phone, ipad)).toEqual(Array(3).fill([['n2'], 'High']));
    expect([history(cloudRow(newId)), history(cloudRow(oldId))]).toEqual([[['n2'], 'High'], [['n2'], 'High']]);
    await nothingWaits(phone, ipad);
    const writes = cloudWrites();
    await settle(phone, ipad);
    await fullSync(phone);
    await fullSync(ipad);
    expect(cloudWrites()).toBe(writes);
    expect(await historyEverywhere(phone, ipad)).toEqual(Array(3).fill([['n2'], 'High']));
  });

  it('a note and a priority he had before the master go with the task at the approval; a note added since on the device that had not heard joins them, in date order', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T07:00:00.000Z');
    await edit(phone, oldId, { activity: [N1] });
    at('2026-09-08T07:05:00.000Z');
    await edit(phone, oldId, { priority: 'Low' });
    await backgroundUpload(phone);
    await refresh(ipad);
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect([theRow(phone).id === oldId, history(theRow(phone))]).toEqual([false, [['n1'], 'Low']]);
    at('2026-09-11T09:00:00.000Z');
    await edit(ipad, oldId, { activity: [N1, N2] });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await historyEverywhere(phone, ipad)).toEqual(Array(3).fill([['n1', 'n2'], 'Low']));
    await nothingWaits(phone, ipad);
  });

  it('through Sync Now on the iPad instead of the automatic upload', async () => {
    const { phone, ipad } = await typedOnTheOldRow(async (ipad, oldId) => {
      await edit(ipad, oldId, { activity: [N2] });
      at('2026-09-11T09:05:00.000Z');
      await edit(ipad, oldId, { priority: 'High' });
    }, null, false);
    await fullSync(ipad);
    await settle(phone, ipad);
    expect(await historyEverywhere(phone, ipad)).toEqual(Array(3).fill([['n2'], 'High']));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });

  it('the phone, with no signal and not having heard, approves the master; the note and priority set on the iPad meanwhile are on the new row when it first goes up', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    at('2026-09-09T09:00:00.000Z');
    await edit(ipad, oldId, { activity: [N1] });
    at('2026-09-09T09:05:00.000Z');
    await edit(ipad, oldId, { priority: 'High' });
    await backgroundUpload(ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    const newId = theRow(phone).id;
    expect(history(theRow(phone))).toEqual([[], 'Medium']);
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect(history(cloudRow(newId))).toEqual([['n1'], 'High']);
    await settle(phone, ipad);
    expect(await historyEverywhere(phone, ipad)).toEqual(Array(3).fill([['n1'], 'High']));
    await nothingWaits(phone, ipad);
  });

  it('a row a master saved before this build (it says nothing of what it took): both devices bring the notes forward, one writes them, and each note is there once', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    at('2026-09-09T09:00:00.000Z');
    await edit(ipad, oldId, { activity: [N1] });
    at('2026-09-09T09:05:00.000Z');
    await edit(ipad, oldId, { activity: [N1, N2] });
    await backgroundUpload(ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    masterRowsAsBuild229SavedThem(phone);
    const newId = theRow(phone).id;
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect(history(cloudRow(newId))[0]).toEqual([]);
    const writes = cloudWrites();
    await refresh(ipad, false);
    await refresh(phone, false);
    expect([history(theRow(phone))[0], history(theRow(ipad))[0]]).toEqual([['n1', 'n2'], ['n1', 'n2']]);
    await backgroundUpload(ipad);
    await backgroundUpload(phone);
    expect(mockCloud.writes.slice(writes).filter(write => write.endsWith(`:${newId}`))).toEqual([`ipad:${newId}`]);
    await settle(phone, ipad);
    expect(history(cloudRow(newId))[0]).toEqual(['n1', 'n2']);
    expect((await historyEverywhere(phone, ipad)).map(shown => shown[0])).toEqual(Array(3).fill(['n1', 'n2']));
    await nothingWaits(phone, ipad);
    const after = cloudWrites();
    await settle(phone, ipad);
    expect(cloudWrites()).toBe(after);
  });

  it('the task\'s new row is given a note of its own in the cloud between the iPad\'s merge and its upload: the notes brought forward join it, none lost and none twice', async () => {
    const N3 = entry('n3', '2026-09-12T09:00:00.000Z');
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    at('2026-09-09T09:00:00.000Z');
    await edit(ipad, oldId, { activity: [N1, N2] });
    await backgroundUpload(ipad);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    masterRowsAsBuild229SavedThem(phone);
    const newId = theRow(phone).id;
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await refresh(ipad, false);
    expect(history(theRow(ipad))[0]).toEqual(['n1', 'n2']);
    at('2026-09-12T09:00:00.000Z');
    webWrite({ ...cloudRow(newId)!, activity: [N3], updatedAt: '2026-09-12T09:00:00.000Z' } as ScheduleItem);
    await backgroundUpload(ipad);
    expect(history(cloudRow(newId))[0]).toEqual(['n1', 'n2', 'n3']);
    await settle(phone, ipad);
    expect((await historyEverywhere(phone, ipad)).map(shown => shown[0])).toEqual(Array(3).fill(['n1', 'n2', 'n3']));
    await nothingWaits(phone, ipad);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Schedule batch S6, item 1 (7 Oct 2026; puts S5 item 1 right). S5 made the priority follow a moved task always: a
 * task David never touched no longer turned High when a master moved it into the coming week. Decided: only a
 * priority he SET follows; one he never set is the new row's own, as before S5. Master N is imported six days before
 * Framing's new finish, so the import marks its row High.
 */
describe('S6 item 1: only a priority he set follows a task a master moved, between two devices and the web', () => {
  const N = scheduleDoc('MASTER N', '2026-10-24T12:00:00.000Z');
  const priorities = async (phone: Device, ipad: Device) => {
    await refresh(phone); await refresh(ipad);
    return [theRow(phone).priority, theRow(ipad).priority, framingOf(webShown())[0].priority];
  };
  const nothingWaits = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  const approveN = async (device: Device) => { at(N.importedAt!); await approve(device, N, [G_ROW, SURVEY]); shareDocuments(device); };

  it('he never touched it and the master moves it into the coming week: High on the phone, the iPad and the web, as before S5', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    expect(theRow(phone).priority).toBe('Medium');
    await approveN(phone);
    await backgroundUpload(phone);
    expect([theRow(phone).id === oldId, theRow(phone).priority]).toEqual([false, 'High']);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['High', 'High', 'High']);
    // The old row keeps its own, hidden; nothing was carried either way.
    expect(cloudRow(oldId)!.priority).toBe('Medium');
    await nothingWaits(phone, ipad);
    const writes = cloudWrites();
    await settle(phone, ipad); await fullSync(phone); await fullSync(ipad);
    expect([cloudWrites(), await priorities(phone, ipad)]).toEqual([writes, ['High', 'High', 'High']]);
  });

  it('he set it Low; the master moves it into the coming week: Low on the phone, the iPad and the web, nothing asked', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T07:05:00.000Z');
    await edit(phone, oldId, { priority: 'Low' });
    await backgroundUpload(phone);
    await refresh(ipad);
    await approveN(phone);
    await backgroundUpload(phone);
    expect([theRow(phone).id === oldId, theRow(phone).priority, theRow(phone).priorityAsImported]).toEqual([false, 'Low', 'High']);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Low', 'Low', 'Low']);
    await nothingWaits(phone, ipad);
    const writes = cloudWrites();
    await settle(phone, ipad); await fullSync(phone); await fullSync(ipad);
    expect([cloudWrites(), await priorities(phone, ipad)]).toEqual([writes, ['Low', 'Low', 'Low']]);
  });

  it('he set it Low on the iPad, which had not heard of the master: it goes on to the task\'s row over that row\'s own High, with nothing asked', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    await approveN(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    expect([theRow(phone).priority, theRow(ipad).id]).toEqual(['High', oldId]);
    at('2026-10-24T13:00:00.000Z');
    await edit(ipad, oldId, { priority: 'Low' });
    at('2026-10-24T14:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Low', 'Low', 'Low']);
    // The task's row says the Low is his from then on.
    expect([cloudRow(newId)!.priority, cloudRow(newId)!.textFromTask?.priority]).toEqual(['Low', 'Low']);
    await nothingWaits(phone, ipad);
  });

  it('the phone, with no signal and not having heard that he set it Low on the iPad, approves the master: the new row goes up Low', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(phone, false);
    at('2026-09-09T09:05:00.000Z');
    await edit(ipad, oldId, { priority: 'Low' });
    await backgroundUpload(ipad);
    await approveN(phone);
    const newId = theRow(phone).id;
    // On the phone, which has not heard: the new row's own High for now.
    expect(theRow(phone).priority).toBe('High');
    at('2026-10-24T14:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect([cloudRow(newId)!.priority, cloudRow(newId)!.priorityAsImported]).toEqual(['Low', 'High']);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Low', 'Low', 'Low']);
    await nothingWaits(phone, ipad);
  });

  /** Framing as a build before this one saved it, on both devices and in the cloud: no word of what its import gave it. */
  function framingAsSavedBeforeThisBuild(devices: Device[], priority: ScheduleItem['priority']) {
    const plain = (row: ScheduleItem) => { const { priorityAsImported: _own, ...rest } = row; return (row.taskName === 'Framing' ? { ...rest, priority } : row) as ScheduleItem; };
    devices.forEach(device => { setter(device)(device.state.map(plain)); device.ref.current = device.state; });
    [...mockCloud.rows.keys()].forEach(id => mockCloud.rows.set(id, plain(mockCloud.rows.get(id) as ScheduleItem)));
  }

  it('second part: a task saved before this build, High; he lowers it to Medium on the iPad; the phone\'s next master lists it within the week: Medium on the phone, the iPad and the web', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    framingAsSavedBeforeThisBuild([phone, ipad], 'High');
    at('2026-09-08T07:05:00.000Z');
    await edit(ipad, oldId, { priority: 'Medium' });
    await backgroundUpload(ipad);
    // The edit wrote, beside the priority, what the task held before it; both went up together.
    expect([cloudRow(oldId)!.priority, cloudRow(oldId)!.priorityAsImported]).toEqual(['Medium', 'High']);
    await refresh(phone);
    await approveN(phone);
    await backgroundUpload(phone);
    expect([theRow(phone).id === oldId, theRow(phone).priority]).toEqual([false, 'Medium']);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Medium', 'Medium', 'Medium']);
    await nothingWaits(phone, ipad);
  });

  it('second part: both devices set the priority of such a task apart, to different values: asked once about the priority, never about the word beside it', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    framingAsSavedBeforeThisBuild([phone, ipad], 'High');
    at('2026-09-08T07:00:00.000Z');
    setOnline(ipad, false);
    await edit(phone, oldId, { priority: 'Medium' });
    await backgroundUpload(phone);
    at('2026-09-08T08:00:00.000Z');
    await edit(ipad, oldId, { priority: 'Low' });
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    const cards = (await conflictsOf(ipad)).map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields);
    expect([cards, await conflictsOf(phone), cloudRow(oldId)!.priority, cloudRow(oldId)!.priorityAsImported]).toEqual([[['priority']], [], 'Medium', 'High']);
  });

  it('set on both rows apart (Low on the old row by the iPad that had not heard, Medium on the new row on the phone): Review Conflicts asks once', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    await approveN(phone);
    await backgroundUpload(phone);
    const newId = theRow(phone).id;
    at('2026-10-24T12:30:00.000Z');
    await edit(phone, newId, { priority: 'Medium' });
    await backgroundUpload(phone);
    at('2026-10-24T13:00:00.000Z');
    await edit(ipad, oldId, { priority: 'Low' });
    at('2026-10-24T14:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    const cards = [...await conflictsOf(phone), ...await conflictsOf(ipad)];
    expect(cards).toHaveLength(1);
    // Until he chooses, the task's row keeps the one set on it.
    expect(cloudRow(newId)!.priority).toBe('Medium');
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/** Set Active on a device with signal, as App.tsx: the schedule made current in the cloud, and the activation's carry. */
async function setActiveOn(device: Device, target: ReferenceDocument) {
  on(device);
  const when = new Date().toISOString();
  const before = device.documents;
  cloudDocuments = scheduleDocumentsAfterActivation(cloudDocuments.find(document => document.id === target.id)!, cloudDocuments, 'project', when);
  mockCloud.documents = cloudDocuments;
  device.documents = reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({ local: before, cloud: cloudDocuments, deletedIds: [...deletedDocuments] }));
  const carried = scheduleProgressCarriedOnActivation({ items: device.ref.current, documentsBefore: before, documentsAfter: device.documents }) as ScheduleItem[];
  if (carried.length > 0) {
    const shownBefore = new Map(device.ref.current.map(item => [item.id, item]));
    const byId = new Map(carried.map(item => [item.id, item]));
    setter(device)(device.ref.current.map(item => byId.get(item.id) || item));
    device.ref.current = device.state;
    await Promise.all(carried.map(item => (device.m.sync.runScheduleItemCloudSync as (...args: unknown[]) => Promise<unknown>)(item, undefined, shownBefore.get(item.id))));
  }
  await render(device);
}

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Review pass 1 of Build 231's schedule round, P1-1 and P1-2 (7 Oct 2026; with P1-9, one cause). S6 told "he set it"
 * by comparing a row's priority with what its own import gave it, which cannot work where the two coincide. The
 * coordinator's decision: every priority edit he makes, whatever its value, leaves a mark on the row that the
 * priority is his, and when (prioritySetByHand), carried wherever the priority goes. Here between two devices and
 * the web; the rule on the records alone is in sched-s6-priority-he-set-follows. Master N is imported six days before
 * Framing's new finish, so its row is High by its own import; master P, two days later, lists Framing a month out:
 * Medium by its own import.
 */
describe('Review pass 1, P1-1 and P1-2: a priority he sets that is also what a row\'s own file gave is still his, between two devices and the web', () => {
  const N = scheduleDoc('MASTER N', '2026-10-24T12:00:00.000Z');
  const P = scheduleDoc('MASTER P', '2026-10-26T12:00:00.000Z');
  const P_ROW = 'Framing,Alpha,Lot,11/20/2026,11/30/2026,';
  const priorities = async (phone: Device, ipad: Device) => {
    await refresh(phone); await refresh(ipad);
    return [theRow(phone).priority, theRow(ipad).priority, framingOf(webShown())[0].priority];
  };
  const nothingWaits = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  const approveOn = async (device: Device, master: ReferenceDocument, row: string) => { at(master.importedAt!); await approve(device, master, [row, SURVEY]); shareDocuments(device); await backgroundUpload(device); };
  const activate = async (device: Device, master: ReferenceDocument, phone: Device, ipad: Device) => { await setActiveOn(device, master); await backgroundUpload(device); await settle(phone, ipad); };

  it('P1-1 (a): High set on the iPad, which had not heard of the master that moved the task into the week (that master\'s file says High too): still his High when the next master moves the task out', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    await approveOn(phone, N, G_ROW);
    const newId = theRow(phone).id;
    expect([theRow(phone).priority, theRow(ipad).id, theRow(ipad).priority]).toEqual(['High', oldId, 'Medium']);
    at('2026-10-24T13:00:00.000Z');
    await edit(ipad, oldId, { priority: 'High' });
    at('2026-10-24T14:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['High', 'High', 'High']);
    // The task's row has been told the High is his, and when.
    expect(cloudRow(newId)!.prioritySetByHand).toEqual({ priority: 'High', at: '2026-10-24T13:00:00.000Z' });
    await nothingWaits(phone, ipad);
    await approveOn(phone, P, P_ROW);
    await settle(phone, ipad);
    // (It was: Medium, P's own. One device doing the same in order: High.)
    expect([theRow(phone).id === newId, await priorities(phone, ipad)]).toEqual([false, ['High', 'High', 'High']]);
    await nothingWaits(phone, ipad);
    const writes = cloudWrites();
    await settle(phone, ipad); await fullSync(phone); await fullSync(ipad);
    expect([cloudWrites(), await priorities(phone, ipad)]).toEqual([writes, ['High', 'High', 'High']]);
  });

  it('P1-1 (b): Low set on the task\'s new row on the web, then Medium set later on the iPad, which had not heard (on the old row; Medium is what the new row\'s file gave): Review Conflicts asks once, and Keep Phone puts his Medium everywhere', async () => {
    // Master F lists Framing within the week of its import: F's row is High by its own import. G moves it a month out: Medium.
    at('2026-09-07T12:00:00.000Z');
    const { phone, ipad } = await startBoth(F, ['Framing,Alpha,Lot,09/08/2026,09/12/2026,', SURVEY]);
    const oldId = theRow(phone).id;
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    await approveOn(phone, G, G_ROW);
    const newId = theRow(phone).id;
    expect([cloudRow(oldId)!.priority, cloudRow(newId)!.priority]).toEqual(['High', 'Medium']);
    at('2026-09-11T09:00:00.000Z');
    webWrite(webEdited(cloudRow(newId)!, { priority: 'Low' }));
    at('2026-09-11T11:00:00.000Z');
    await edit(ipad, oldId, { priority: 'Medium' });
    at('2026-09-12T08:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    // (It was: no card, and the older Low in all three places.)
    const asked = [...await conflictsOf(phone), ...await conflictsOf(ipad)].map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields);
    expect([asked, cloudRow(newId)!.priority]).toEqual([[['priority']], 'Low']);
    await chooseInSettings(ipad, (await conflictsOf(ipad))[0].id, 'keep_local');
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Medium', 'Medium', 'Medium']);
    await nothingWaits(phone, ipad);
  });

  it('P1-2: Low set under the newer master; Set Active on the older; he sets Medium there, which is what that row\'s own file gave; Set Active on the newer again: his Medium, and it follows the next master', async () => {
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    await approveOn(phone, N, G_ROW);
    await settle(phone, ipad);
    const newId = theRow(phone).id;
    at('2026-10-24T13:00:00.000Z');
    await edit(phone, newId, { priority: 'Low' });
    await backgroundUpload(phone);
    at('2026-10-24T14:00:00.000Z');
    await activate(phone, F, phone, ipad);
    expect([theRow(phone).id, theRow(ipad).id, await priorities(phone, ipad)]).toEqual([oldId, oldId, ['Low', 'Low', 'Low']]);
    at('2026-10-24T15:00:00.000Z');
    await edit(phone, oldId, { priority: 'Medium' });
    await backgroundUpload(phone);
    at('2026-10-24T16:00:00.000Z');
    await activate(phone, N, phone, ipad);
    // (It was: Low again, the priority he had replaced, on the phone, the iPad and the web.)
    expect([theRow(phone).id, theRow(ipad).id, await priorities(phone, ipad)]).toEqual([newId, newId, ['Medium', 'Medium', 'Medium']]);
    await nothingWaits(phone, ipad);
    await approveOn(phone, P, P_ROW);
    await settle(phone, ipad);
    expect(await priorities(phone, ipad)).toEqual(['Medium', 'Medium', 'Medium']);
    await nothingWaits(phone, ipad);
  });

  it('P1-1 (c): a High he sets under the oldest master shows under the newest, whose own file also said High, and under the master between (the mark alone travels where the two rows read the same)', async () => {
    const M = scheduleDoc('MASTER M', '2026-10-22T12:00:00.000Z');
    const { phone, ipad } = await start();
    const oldId = theRow(phone).id;
    await approveOn(phone, M, P_ROW);
    const middleId = theRow(phone).id;
    await approveOn(phone, N, G_ROW);
    await settle(phone, ipad);
    const newId = theRow(phone).id;
    expect([cloudRow(oldId)!.priority, cloudRow(middleId)!.priority, cloudRow(newId)!.priority]).toEqual(['Medium', 'Medium', 'High']);
    at('2026-10-24T13:00:00.000Z');
    await edit(phone, newId, { priority: 'Low' });
    await backgroundUpload(phone);
    at('2026-10-24T14:00:00.000Z');
    await activate(phone, F, phone, ipad);
    at('2026-10-24T15:00:00.000Z');
    await edit(phone, oldId, { priority: 'High' });
    await backgroundUpload(phone);
    at('2026-10-24T16:00:00.000Z');
    await activate(phone, N, phone, ipad);
    expect([theRow(phone).id, await priorities(phone, ipad), cloudRow(newId)!.prioritySetByHand]).toEqual([newId, ['High', 'High', 'High'], { priority: 'High', at: '2026-10-24T15:00:00.000Z' }]);
    at('2026-10-24T17:00:00.000Z');
    await activate(ipad, M, phone, ipad);
    // (It was: Medium, M's own, on the phone, the iPad and the web.)
    expect([theRow(phone).id, theRow(ipad).id, await priorities(phone, ipad)]).toEqual([middleId, middleId, ['High', 'High', 'High']]);
    await nothingWaits(phone, ipad);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Review pass 1 of Build 231's schedule round, P1-12 (7 Oct 2026; Low, a rare shape; caused by "S4 item 2 (a): the
 * carry reaches each of two rows that answer to the old row", found by bisect; the reviewer's generator seed 7060).
 * Master I moved Framing. Master F is made current again and he enters 30% there. A third master is uploaded on the
 * web and not made current, so two rows now answer to F's row, and the sync's carry gives each of them his 30%. The
 * phone, with no signal and still under master I, approves a lookahead that states 70% for Framing. Build 230 showed
 * the lookahead's 70% on master I's row; this round showed 30%: the carried percent, his by rank, outranked the
 * lookahead's later statement when the two copies of the row met.
 */
describe('Review pass 1, P1-12 (caused by S4 item 2 a): his percent carried to a second row that answers to the old row, and a lookahead approved with no signal that states more', () => {
  const I = scheduleDoc('MASTER I', '2026-09-10T18:00:00.000Z');
  const LOOK = scheduleDoc('LOOKAHEAD P12', '2026-09-14T09:00:00.000Z', 'lookahead');
  /**
   * Master I moves Framing; the phone loses signal; F is made current again on the iPad, and he enters 30% there. With
   * `sibling`, master J is then uploaded on the web and not made current: two rows answer to F's. The iPad's refresh
   * carries his 30% to the row (or rows) that answer to F's row, and sends it.
   */
  async function carriedUnderF(sibling: boolean) {
    const { phone, ipad } = await start();
    const rowF = theRow(phone).id;
    at(I.importedAt!);
    await approve(phone, I, [G_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    const rowI = theRow(phone).id;
    setOnline(phone, false);
    at('2026-09-11T09:00:00.000Z');
    await setActiveOn(ipad, F);
    await backgroundUpload(ipad);
    expect(theRow(ipad).id).toBe(rowF);
    at('2026-09-11T12:00:00.000Z');
    await edit(ipad, rowF, { percentComplete: 30 });
    await backgroundUpload(ipad);
    at('2026-09-12T12:00:00.000Z');
    if (sibling) webUploads('MASTER J', ['Framing,Alpha,Lot,10/27/2026,11/06/2026,', SURVEY]);
    await refresh(ipad);
    await backgroundUpload(ipad);
    return { phone, ipad, rowF, rowI };
  }
  /** The phone, with no signal and still under master I, approves a lookahead stating `percent` for Framing; then everything syncs. */
  async function lookaheadWithNoSignal(phone: Device, ipad: Device, percent: string) {
    at(LOOK.importedAt!);
    await approve(phone, LOOK, [`Framing,Alpha,Lot,10/22/2026,11/01/2026,${percent}`], true);
    at('2026-09-15T09:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    for (let round = 0; round < 2; round += 1) {
      await settle(phone, ipad);
      for (const device of [phone, ipad]) { shareDocuments(device); await fullSync(device); }
    }
  }
  const cardsOf = async (phone: Device, ipad: Device) => [...await conflictsOf(phone), ...await conflictsOf(ipad)];

  it('P1-12: the lookahead\'s 70% shows on master I\'s row, on its dates, and his 30% stays on the row he entered it on', async () => {
    const { phone, ipad, rowF, rowI } = await carriedUnderF(true);
    expect([cloudRow(rowI)!.percentComplete, cloudRow('MASTER J-1')!.percentComplete, cloudRow(rowF)!.percentComplete]).toEqual([30, 30, 30]);
    await lookaheadWithNoSignal(phone, ipad, '70');
    // (It was: 30% on master I's row, though the lookahead in effect there states more than he entered.)
    expect([cloudRow(rowI)!.startDate, cloudRow(rowI)!.percentComplete]).toEqual(['10/22/2026', 70]);
    expect([cloudRow(rowF)!.percentComplete, cloudRow('MASTER J-1')!.percentComplete]).toEqual([30, 30]);
    expect([phone.state.find(item => item.id === rowI)!.percentComplete, ipad.state.find(item => item.id === rowI)!.percentComplete]).toEqual([70, 70]);
    expect(await cardsOf(phone, ipad)).toEqual([]);
    // Nothing more is written: the carry does not put the 30% back.
    const writes = cloudWrites();
    await settle(phone, ipad); await fullSync(phone); await fullSync(ipad);
    expect([cloudWrites(), cloudRow(rowI)!.percentComplete]).toEqual([writes, 70]);
  });

  it('guard: a lookahead that states less than he entered is still floored at his 30% (owner answer Q22)', async () => {
    const { phone, ipad, rowI } = await carriedUnderF(true);
    await lookaheadWithNoSignal(phone, ipad, '20');
    expect([cloudRow(rowI)!.startDate, cloudRow(rowI)!.percentComplete]).toEqual(['10/22/2026', 30]);
    expect(await cardsOf(phone, ipad)).toEqual([]);
  });

  it('guard, not changed (a recorded limit, older, the same on Build 230): with ONE row answering to F\'s row, his carried 30% still stands over the lookahead\'s 70%', async () => {
    const { phone, ipad, rowI } = await carriedUnderF(false);
    expect(cloudRow(rowI)!.percentComplete).toBe(30);
    await lookaheadWithNoSignal(phone, ipad, '70');
    expect(cloudRow(rowI)!.percentComplete).toBe(30);
  });

  it('the rule on the records alone: the carry says when it gave a row his percent as one of two; such a percent does not outrank a lookahead\'s later, higher statement', () => {
    const T30 = '2026-09-11T12:00:00.000Z';
    const row = (id: string, change: Partial<ScheduleItem> = {}) => ({
      id, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/20/2026', finishDate: '10/30/2026', milestone: '', owner: '', contractor: '',
      percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', importBatchId: `batch-${id}`, importedAt: '2026-09-10T18:00:00.000Z',
      createdAt: '2026-09-10T18:00:00.000Z', revisedFromTaskIds: ['MASTER F-1'], ...change,
    }) as ScheduleItem;
    const his = row('MASTER F-1', { revisedFromTaskIds: undefined, importedAt: '2026-09-07T12:00:00.000Z', createdAt: '2026-09-07T12:00:00.000Z', percentComplete: 30, status: 'In Progress',
      progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: T30, updatedAt: T30 });
    // Two rows answer to F's row: each takes his 30%, and says it took it beside another row. One row alone says nothing of the kind.
    const two = recoverDAVEScheduleRecords({ local: [his, row('MASTER I-1'), row('MASTER J-1')], cloud: [his, row('MASTER I-1'), row('MASTER J-1')], allowCloudOnly: true });
    expect(two.map(item => [item.id, item.percentComplete, item.progressCarriedFrom])).toEqual([
      ['MASTER F-1', 30, undefined], ['MASTER I-1', 30, { taskId: 'MASTER F-1', judgedAt: T30, besideAnotherRow: true }], ['MASTER J-1', 30, { taskId: 'MASTER F-1', judgedAt: T30, besideAnotherRow: true }]]);
    const one = recoverDAVEScheduleRecords({ local: [his, row('MASTER I-1')], cloud: [his, row('MASTER I-1')], allowCloudOnly: true });
    expect(one.map(item => [item.id, item.percentComplete, item.progressCarriedFrom])).toEqual([['MASTER F-1', 30, undefined], ['MASTER I-1', 30, { taskId: 'MASTER F-1', judgedAt: T30 }]]);
    const carriedBeside = two.find(item => item.id === 'MASTER I-1')!;
    const carriedAlone = one.find(item => item.id === 'MASTER I-1')!;
    /** This device's copy of I's row: a lookahead approved with no signal restated it, stating `percent`. */
    const lookahead = (percent: number, updatedAt = '2026-09-14T09:00:00.000Z') => row('MASTER I-1', {
      startDate: '10/22/2026', finishDate: '11/01/2026', percentComplete: percent, status: 'In Progress', alsoImportedInBatchIds: ['batch-L'], updatedAt,
      lookaheadOverlay: { masterStartDate: '10/20/2026', masterFinishDate: '10/30/2026', masterPercentComplete: 0, masterStatus: 'Not Started', masterFilePercentComplete: 0,
        lookaheads: [{ batchId: 'batch-L', startDate: '10/22/2026', finishDate: '11/01/2026', percentComplete: percent, importedAt: '2026-09-14T09:00:00.000Z' }] },
    });
    const met = (local: ScheduleItem, cloud: ScheduleItem) => recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true })[0];
    // (It was: 30.) The lookahead's 70% stands, and the row no longer says its percent was carried.
    expect([met(lookahead(70), carriedBeside).percentComplete, met(lookahead(70), carriedBeside).progressCarriedFrom]).toEqual([70, undefined]);
    // A lookahead that states less than he entered: his percent stands, as before (owner answer Q22).
    expect(met(lookahead(20), carriedBeside).percentComplete).toBe(30);
    // The one row that answers: as before.
    expect(met(lookahead(70), carriedAlone).percentComplete).toBe(30);
    // A copy that is not this device's later word (an old copy of a lookahead since gone, never changed here since): his stands.
    expect(met(lookahead(70, '2026-09-11T10:00:00.000Z'), carriedBeside).percentComplete).toBe(30);
    // His own percent on this device's copy is ordered by when he judged it, as ever: the later of the two.
    const hisOwn = (at: string) => row('MASTER I-1', { percentComplete: 45, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at, updatedAt: at });
    expect([met(hisOwn('2026-09-14T09:00:00.000Z'), carriedBeside).percentComplete, met(hisOwn('2026-09-11T08:00:00.000Z'), carriedBeside).percentComplete]).toEqual([45, 30]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Schedule batch S5, item 2 (7 Oct 2026; uncovered by S4 item 1, the schedule reviewer's generator seed 5178). The
 * iPad deletes a lookahead with its items; the phone had made another master current before it heard of that. The
 * shape of that seed, with this rig's own tasks: F lists Framing 10/15, the lookahead moves it to 10/18, master G
 * lists it on the lookahead's dates. Under F with the lookahead gone, Framing is on F's 10/15.
 */
describe('S5 item 2: a lookahead deleted on the iPad, heard by the phone after it made another master current (seed 5178)', () => {
  const G2 = scheduleDoc('MASTER G2', '2026-09-11T12:00:00.000Z');
  const framingDates = (items: readonly ScheduleItem[]) => framingOf(items).map(item => [item.startDate, item.finishDate]);
  /** F, then the lookahead on both devices, then G2 on the lookahead's dates: G2 in effect everywhere, Framing on 10/18. */
  async function underG2() {
    const { phone, ipad } = await start();
    at(L.importedAt!);
    await approve(phone, L, [L_ROW], true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at(G2.importedAt!);
    await approve(phone, G2, [L_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await refresh(ipad);
    expect([framingDates(deviceShown(phone)), framingDates(deviceShown(ipad))]).toEqual(Array(2).fill([['10/18/2026', '10/28/2026']]));
    return { phone, ipad };
  }

  it('the phone made F current before it heard of the iPad\'s delete: once the delete arrives Framing is on F\'s dates everywhere, as one device in order', async () => {
    const { phone, ipad } = await underG2();
    at('2026-09-12T09:00:00.000Z');
    await deleteWithItems(ipad, L);
    expect(framingDates(deviceShown(ipad))).toEqual([['10/18/2026', '10/28/2026']]);
    at('2026-09-12T10:00:00.000Z');
    await setActiveOn(phone, F);
    // The phone has not heard the iPad's rows yet: the lookahead's note still holds Framing.
    expect([framingDates(deviceShown(phone)), Boolean(framingOf(deviceShown(phone))[0].lookaheadOverlay)]).toEqual([[['10/18/2026', '10/28/2026']], true]);
    at('2026-09-12T11:00:00.000Z');
    await refresh(phone);
    expect(framingDates(deviceShown(phone))).toEqual([['10/15/2026', '10/25/2026']]);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
    expect([framingDates(deviceShown(phone)), framingDates(deviceShown(ipad)), framingDates(webShown())]).toEqual(Array(3).fill([['10/15/2026', '10/25/2026']]));
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
    // Nothing more is written by more syncing.
    const writes = cloudWrites();
    await settle(phone, ipad);
    expect(cloudWrites()).toBe(writes);
  });

  it('in order on one device (the delete heard first, then Set Active): the same dates, and the heard delete changes nothing by itself', async () => {
    const { phone, ipad } = await underG2();
    at('2026-09-12T09:00:00.000Z');
    await deleteWithItems(ipad, L);
    at('2026-09-12T10:00:00.000Z');
    await refresh(phone);
    const writes = cloudWrites();
    await settle(phone, ipad);
    expect([cloudWrites(), framingDates(deviceShown(phone))]).toEqual([writes, [['10/18/2026', '10/28/2026']]]);
    at('2026-09-12T11:00:00.000Z');
    await setActiveOn(phone, F);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
    expect([framingDates(deviceShown(phone)), framingDates(deviceShown(ipad)), framingDates(webShown())]).toEqual(Array(3).fill([['10/15/2026', '10/25/2026']]));
  });

  // Schedule batch S6, item 4 b (7 Oct 2026). S5 recorded "a deletion that arrives across a restart of the app" as not
  // covered, because what the app has seen of the notes is kept in memory only. Looked at again: when the app opens
  // it first shows the tasks it saved, with the lookahead's note still on them, and only then hears the cloud. So a
  // delete made while the phone was closed is seen as a note gone since the last look, like one heard live, and the
  // recompute runs. Both ways the app hears the cloud at a start are here (its startup download, and a refresh).
  // What stays uncovered is narrower: the app closed BETWEEN hearing the task rows and hearing that the file is gone.
  it.each([['its startup download', startup], ['a refresh', refresh]] as const)('S6 item 4 b: the phone closed and opened again before it hears of the delete, then %s brings it: Framing is on F\'s dates everywhere', async (_how, hear) => {
    const { phone, ipad } = await underG2();
    at('2026-09-12T09:00:00.000Z');
    await deleteWithItems(ipad, L);
    at('2026-09-12T10:00:00.000Z');
    await setActiveOn(phone, F);
    // Closed and opened again: nothing kept in memory is left. The app shows the tasks and schedules it saved.
    relaunchModules(phone);
    await render(phone);
    expect([framingDates(deviceShown(phone)), Boolean(framingOf(deviceShown(phone))[0].lookaheadOverlay)]).toEqual([[['10/18/2026', '10/28/2026']], true]);
    at('2026-09-12T11:00:00.000Z');
    await hear(phone);
    expect(framingDates(deviceShown(phone))).toEqual([['10/15/2026', '10/25/2026']]);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
    expect([framingDates(deviceShown(phone)), framingDates(deviceShown(ipad)), framingDates(webShown())]).toEqual(Array(3).fill([['10/15/2026', '10/25/2026']]));
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Build 232, item 1 (13 Oct 2026; the schedules reviewer's P3-1: Medium, older, the same on Build 230). He edits a
 * task and, before the cloud has confirmed that edit, deletes on the same device the lookahead that moved the task,
 * with "Delete PDF + Items". The task stayed on the deleted lookahead's dates (and on its percent, where the lookahead
 * stated one) on the phone, the iPad and the web, still carrying the lookahead's note, with no card. A task he had not
 * edited went back correctly.
 *
 * Why: the delete saves each task it puts back as the whole task. That save, finding an edit of the task still
 * waiting, took over the waiting edit's list of fields (runScheduleItemCloudSync), so only his owner was sent. The
 * dates, percent and note the delete had put back were on the device alone, and the next read from the cloud put the
 * lookahead's back.
 *
 * The coordinator's decision: when a save of the whole task meets an edit of that task still waiting, what goes up
 * carries both, his edit and everything the whole-task save changed, as one write the cloud can refuse when its row
 * has changed since it was read. The save now joins the waiting edit as a whole copy of the task, the way a
 * lookahead's approval after a waiting edit always has: each field he edited keeps the copy his edit started from, so
 * it is still weighed as his edit, and the rest is weighed as the delete's own save is with nothing waiting.
 *
 * "Not yet confirmed", four ways: made with no signal and the delete with no signal too; made with no signal, signal
 * back, the delete before the automatic send; its write never reached the cloud; its write reached the cloud and the
 * answer was lost.
 */
describe('Build 232 item 1: an edit of a task not yet confirmed by the cloud, then the lookahead that moved the task is deleted with its items', () => {
  const LOOK = scheduleDoc('LOOKAHEAD B232', '2026-09-09T12:00:00.000Z', 'lookahead');
  /** The lookahead moves Framing, stating 70% for it, and Survey. */
  const BOTH_TASKS = ['Framing,Alpha,Lot,10/18/2026,10/28/2026,70', 'Survey,Alpha,Lot,10/13/2026,10/16/2026,'];
  /** A lookahead that moves Framing alone and states no percent. */
  const FRAMING_ONLY = ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'];
  const ON_THE_LOOKAHEAD = '10/18/2026 - 10/28/2026';
  const ON_THE_MASTER = '10/15/2026 - 10/25/2026';
  type Waiting = 'confirmed' | 'made with no signal, and the delete with no signal too' | 'made with no signal, signal back, the delete before the automatic send'
    | 'sent, and the write never reached the cloud' | 'sent and written in the cloud, and the answer was lost';
  const NOT_CONFIRMED: Waiting[] = ['made with no signal, and the delete with no signal too', 'made with no signal, signal back, the delete before the automatic send',
    'sent, and the write never reached the cloud', 'sent and written in the cloud, and the answer was lost'];
  const taskIn = (items: readonly ScheduleItem[], name: string) => items.filter(item => item.taskName === name);
  const EDITS = {
    'an owner': () => ({ owner: 'Mike' }),
    'a priority': () => ({ priority: 'Low' }),
    'a percent': () => ({ percentComplete: 30 }),
    'a hand link': (phone: Device) => ({ dependencies: [{ predecessorItemId: taskIn(deviceShown(phone), 'Survey')[0].id, type: 'FS', lagDays: 0 }] }),
  } as unknown as Record<'an owner' | 'a priority' | 'a percent' | 'a hand link', (phone: Device) => Partial<ScheduleItem>>;
  type Edit = keyof typeof EDITS;
  type Options = { rows?: string[]; webMaster?: boolean; stopAfterTheDelete?: boolean };

  /** What a place shows of a task: its dates, percent, owner, priority and hand links, and whether a lookahead's note is on it. */
  const shownIn = (items: readonly ScheduleItem[], name: string) => taskIn(items, name).map(item => ({
    dates: `${item.startDate} - ${item.finishDate}`, percent: item.percentComplete, owner: item.owner || '', priority: item.priority,
    links: (item.dependencies ?? []).map(link => link.predecessorItemId), lookaheadNote: Boolean(item.lookaheadOverlay),
  }));
  /** The phone, the iPad and the web. */
  const places = (phone: Device, ipad: Device, name: string) => [shownIn(deviceShown(phone), name), shownIn(deviceShown(ipad), name), shownIn(webShown(), name)];
  const ending = async (phone: Device, ipad: Device) => ({
    framing: places(phone, ipad, 'Framing'), survey: places(phone, ipad, 'Survey'),
    cards: [(await conflictsOf(phone)).length, (await conflictsOf(ipad)).length],
    waiting: [(await queueOf(phone)).length, (await queueOf(ipad)).length],
  });
  const everythingSynced = async (phone: Device, ipad: Device) => {
    setOnline(phone, true);
    shareDocuments(phone);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
  };

  /**
   * The lookahead is approved on the phone and heard everywhere. He edits Framing on the phone (`how` says whether the
   * cloud has confirmed that edit), then deletes the lookahead with its items on the phone. Then everything syncs.
   */
  async function editedThenDeleted(how: Waiting, change: (phone: Device) => Partial<ScheduleItem>, options: Options = {}) {
    const { phone, ipad } = await start();
    if (options.webMaster) {
      // A newer master uploaded on the web and not made current: every task has a second row waiting in the cloud.
      at('2026-09-08T12:00:00.000Z');
      webUploads('MASTER W', ['Framing,Alpha,Lot,10/14/2026,10/24/2026,', SURVEY]);
      await settle(phone, ipad);
    }
    at(LOOK.importedAt!);
    await approve(phone, LOOK, options.rows ?? BOTH_TASKS, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    expect(places(phone, ipad, 'Framing').map(place => [place[0]?.dates, place[0]?.lookaheadNote])).toEqual(Array(3).fill([ON_THE_LOOKAHEAD, true]));
    const id = theRow(phone).id;
    at('2026-09-10T09:00:00.000Z');
    const edited = change(phone);
    if (how === 'confirmed') { await edit(phone, id, edited); await backgroundUpload(phone); }
    else if (how === 'sent and written in the cloud, and the answer was lost') { mockCloud.lostAnswers = 1; await edit(phone, id, edited); mockCloud.lostAnswers = 0; }
    else if (how === 'sent, and the write never reached the cloud') { mockCloud.failNextWriteOf = id; await edit(phone, id, edited); mockCloud.failNextWriteOf = null; }
    else {
      setOnline(phone, false);
      await edit(phone, id, edited);
      if (how === 'made with no signal, signal back, the delete before the automatic send') setOnline(phone, true);
    }
    // But for the control, his edit is still waiting on the phone when he deletes the lookahead.
    expect((await queueOf(phone)).map(waiting => waiting.entity)).toEqual(how === 'confirmed' ? [] : ['schedule_item']);
    at('2026-09-10T12:00:00.000Z');
    await deleteWithItems(phone, LOOK);
    if (options.stopAfterTheDelete) return { phone, ipad, id };
    if (isOnline(phone)) { shareDocuments(phone); await backgroundUpload(phone); }
    at('2026-09-10T15:00:00.000Z');
    await everythingSynced(phone, ipad);
    return { phone, ipad, id };
  }
  /** How the same steps end with the edit confirmed before the delete. */
  const controls = new Map<string, Awaited<ReturnType<typeof ending>>>();
  async function control(kind: Edit, options: Options = {}) {
    const key = JSON.stringify([kind, options]);
    if (!controls.has(key)) {
      const { phone, ipad } = await editedThenDeleted('confirmed', EDITS[kind], options);
      controls.set(key, await ending(phone, ipad));
    }
    return controls.get(key)!;
  }
  /** Framing on the master's dates at the master's percent with his owner, Survey on the master's dates, no note of the lookahead, no card, nothing waiting. */
  const BACK_ON_THE_MASTER = {
    framing: Array(3).fill([{ dates: ON_THE_MASTER, percent: 0, owner: 'Mike', lookaheadNote: false }]),
    survey: Array(3).fill([{ dates: '10/12/2026 - 10/14/2026', lookaheadNote: false }]),
    cards: [0, 0], waiting: [0, 0],
  };

  it('the control: with his owner confirmed before the delete, Framing is back on the master\'s dates and percent in all three places, with his owner', async () => {
    expect(await control('an owner')).toMatchObject(BACK_ON_THE_MASTER);
  });

  it.each(NOT_CONFIRMED)('his owner %s: Framing is back on the master\'s dates and percent in all three places, with his owner, no card and no note of the lookahead', async how => {
    const confirmed = await control('an owner');
    const { phone, ipad } = await editedThenDeleted(how, EDITS['an owner']);
    const end = await ending(phone, ipad);
    // (It was: 10/18 - 10/28 at 70% in all three places, the lookahead's note still on the task.)
    expect(end).toMatchObject(BACK_ON_THE_MASTER);
    expect(end).toEqual(confirmed);
  });

  it.each([
    ['a priority', 'sent and written in the cloud, and the answer was lost'], ['a priority', 'made with no signal, and the delete with no signal too'],
    ['a percent', 'sent and written in the cloud, and the answer was lost'], ['a percent', 'made with no signal, and the delete with no signal too'],
    ['a hand link', 'sent and written in the cloud, and the answer was lost'], ['a hand link', 'made with no signal, and the delete with no signal too'],
  ] as Array<[Edit, Waiting]>)('%s, %s: Framing ends as it does with that edit confirmed first, on the master\'s dates', async (kind, how) => {
    const confirmed = await control(kind);
    const { phone, ipad } = await editedThenDeleted(how, EDITS[kind]);
    const end = await ending(phone, ipad);
    expect(end).toMatchObject({ framing: Array(3).fill([{ dates: ON_THE_MASTER, lookaheadNote: false }]), cards: [0, 0], waiting: [0, 0] });
    expect(end).toEqual(confirmed);
  });

  it('with a newer master uploaded on the web and not made current (each task has a second row in the cloud): the same', async () => {
    const confirmed = await control('an owner', { webMaster: true });
    const { phone, ipad } = await editedThenDeleted('sent and written in the cloud, and the answer was lost', EDITS['an owner'], { webMaster: true });
    const end = await ending(phone, ipad);
    expect(end).toMatchObject(BACK_ON_THE_MASTER);
    expect(end).toEqual(confirmed);
  });

  describe('it goes up as one write, which the cloud refuses when its row has changed since the phone read it', () => {
    const asked = async (device: Device) => (await conflictsOf(device)).map(conflict => {
      const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
      const fields = mine.askedFields ?? [];
      return { row: conflict.localId, fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
    });
    /** His owner and the delete both made with no signal; the phone has signal again and has sent nothing yet. */
    async function bothWaitingToGoUp() {
      const rig = await editedThenDeleted('made with no signal, and the delete with no signal too', EDITS['an owner'], { rows: FRAMING_ONLY, stopAfterTheDelete: true });
      at('2026-09-10T15:00:00.000Z');
      setOnline(rig.phone, true);
      shareDocuments(rig.phone);
      mockCloud.versioned = true;
      return rig;
    }

    it('nobody else writing: his owner and what the delete put back are in ONE write of the task, and nothing is refused', async () => {
      const { phone, id } = await bothWaitingToGoUp();
      const writes = cloudWrites();
      await backgroundUpload(phone);
      expect([mockCloud.refused, mockCloud.writes.slice(writes)]).toEqual([[], [`phone:${id}`]]);
      // (It was: one write with his owner alone, the row left on 10/18 - 10/28 with the lookahead's note.)
      expect(cloudRow(id)).toMatchObject({ owner: 'Mike', startDate: '10/15/2026', finishDate: '10/25/2026' });
      expect(Boolean(cloudRow(id)!.lookaheadOverlay)).toBe(false);
    });

    it('another device sets the owner in the moment before the write: refused, nothing written over it; weighed again he is asked about the owner as for any edit, and what the delete put back goes up', async () => {
      const { phone, ipad, id } = await bothWaitingToGoUp();
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(id)!, { owner: 'Ana' }));
      await backgroundUpload(phone);
      expect(mockCloud.refused).toEqual([`phone:${id}`]);
      expect(cloudRow(id)).toMatchObject({ owner: 'Ana' });
      expect(await asked(phone)).toEqual([{ row: id, fields: ['owner'], here: ['Mike'], cloud: ['Ana'] }]);
      await everythingSynced(phone, ipad);
      const end = await ending(phone, ipad);
      // The other device's owner stays in the cloud until he chooses; the dates are the master's everywhere.
      expect(end.framing).toMatchObject(Array(3).fill([{ dates: ON_THE_MASTER, lookaheadNote: false }]));
      expect([cloudRow(id)!.owner, end.framing[1][0].owner, end.framing[2][0].owner, end.cards]).toEqual(['Ana', 'Ana', 'Ana', [1, 0]]);
      expect(await asked(phone)).toEqual([{ row: id, fields: ['owner'], here: ['Mike'], cloud: ['Ana'] }]);
      expect(mockCloud.refused).toEqual([`phone:${id}`]);
    });

    it('another device types a note in that moment: refused; weighed again the note stays, his owner and what the delete put back go up, and nothing is asked', async () => {
      const { phone, ipad, id } = await bothWaitingToGoUp();
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(id)!, { notes: IPAD_NOTE }));
      await backgroundUpload(phone);
      expect(mockCloud.refused).toEqual([`phone:${id}`]);
      expect(cloudRow(id)).toMatchObject({ notes: IPAD_NOTE, owner: 'Mike', startDate: '10/15/2026', finishDate: '10/25/2026' });
      await everythingSynced(phone, ipad);
      const end = await ending(phone, ipad);
      expect(end).toMatchObject({ framing: Array(3).fill([{ dates: ON_THE_MASTER, owner: 'Mike', lookaheadNote: false }]), cards: [0, 0], waiting: [0, 0] });
      expect([deviceShown(phone), deviceShown(ipad), webShown()].map(items => taskIn(items, 'Framing')[0].notes)).toEqual(Array(3).fill(IPAD_NOTE));
    });
  });

  /**
   * The other save of a whole task that passed through the same lines: Set Active's carry of his percent to the row
   * now shown. For it to meet an edit still waiting on that very row, the edit's write must fail at every send in
   * between (Set Active needs signal, and every send tries all that waits). Then Set Active's save sent his owner
   * alone, and the cloud's row kept the older percent (40%, on the iPad and the web) until the phone synced again and
   * its sync carried the percent once more: where it ends was the same, what the other devices showed meanwhile was
   * not. Its save now carries both as well.
   */
  it.each([['fails at each send until then (the edit still waits on the row Set Active saves)', true], ['goes up at once (the control)', false]] as const)(
    'Set Active\'s carry onto a row whose owner edit %s: his percent and his owner are on the row shown in all three places', async (_label, fails) => {
      const { phone, ipad } = await start();
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      shareDocuments(phone);
      await backgroundUpload(phone);
      await settle(phone, ipad);
      const newId = theRow(phone).id;
      at('2026-09-11T08:00:00.000Z');
      await edit(phone, newId, { percentComplete: 40 });
      await settle(phone, ipad);
      const weakSignal = () => { mockCloud.failNextWriteOf = fails ? newId : null; };
      at('2026-09-11T09:00:00.000Z');
      weakSignal();
      await edit(phone, newId, { owner: 'Mike' });
      at('2026-09-11T10:00:00.000Z');
      weakSignal();
      await setActiveOn(phone, F);
      const oldId = theRow(phone).id;
      expect(oldId).not.toBe(newId);
      at('2026-09-11T11:00:00.000Z');
      weakSignal();
      await edit(phone, oldId, { percentComplete: 55 });
      expect((await queueOf(phone)).map(waiting => (waiting.payload as { id?: string }).id)).toEqual(fails ? [newId] : []);
      at('2026-09-11T12:00:00.000Z');
      mockCloud.failNextWriteOf = null;
      await setActiveOn(phone, G);
      // Set Active's own save, before anything else syncs: the cloud's row has his percent and his owner.
      expect(cloudRow(newId)).toMatchObject({ percentComplete: 55, owner: 'Mike' });
      at('2026-09-11T15:00:00.000Z');
      await everythingSynced(phone, ipad);
      const end = await ending(phone, ipad);
      expect(end).toMatchObject({ framing: Array(3).fill([{ dates: '10/20/2026 - 10/30/2026', percent: 55, owner: 'Mike' }]), cards: [0, 0], waiting: [0, 0] });
    });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Build 232, item 1b (13 Oct 2026; review pass 2's M1: Medium, caused by item 1; Build 231 does not have it). The
 * iPad has no signal. On it he types a note on a task (or makes a hand link, sets an owner or a priority). Still with
 * no signal he deletes, on the iPad, the lookahead that holds that task, with "Delete PDF + Items". Meanwhile another
 * device approves a new master, or makes another one current, so the task has a new row. Once everything had synced
 * his note was on the replaced master's row alone, which nobody is shown, and nothing asked him.
 *
 * Why: an edit that waits as a list of fields is sent on to the row the task lives on now (review N3 R3). Item 1 made
 * the delete's save of the whole task join his waiting edit as one whole copy of the task, and a whole copy is
 * written to its own row only. (Where the new row was made after his edit and is still blank there, the sync's own
 * carry fills it from the old row, so a note still arrived; not a link, not over a row the same delete had also put
 * back, and with nothing asked when another device had typed there.)
 *
 * The coordinator's decision: what he typed follows the task. The whole copy keeps the list of the fields of his
 * edit, and those are sent on to the task's new row exactly as when the edit waits alone: the same rule, the same
 * card when another device changed the same field there, the same write the cloud can refuse. What the delete itself
 * put back (the master's dates, the percent, the lookahead's note taken off) belongs to the old row and is not sent
 * on: the new master states its own.
 */
describe('Build 232 item 1b: an edit made with no signal, then the lookahead deleted with no signal too, while another device changes the master', () => {
  const LOOK = scheduleDoc('LOOKAHEAD B232B', '2026-09-09T12:00:00.000Z', 'lookahead');
  const OLD_ROW = 'MASTER F-1';
  const NEW_ROW = 'MASTER G-1';
  type Kind = 'a note' | 'a hand link' | 'an owner' | 'a priority' | 'a percent';
  const KINDS: Kind[] = ['a note', 'a hand link', 'an owner', 'a priority', 'a percent'];
  const EDIT: Record<Kind, Partial<ScheduleItem>> = {
    'a note': { notes: NOTE }, 'an owner': { owner: 'Mike' }, 'a priority': { priority: 'Low' }, 'a percent': { percentComplete: 30 },
    'a hand link': { dependencies: [{ predecessorItemId: 'MASTER F-2', type: 'FS', lagDays: 0 }] } as unknown as Partial<ScheduleItem>,
  };
  /** What he set, as it reads on the row a place shows for Framing (a link by the task it names). */
  const HIS: Record<Kind, unknown> = { 'a note': NOTE, 'an owner': 'Mike', 'a priority': 'Low', 'a percent': 30, 'a hand link': ['Survey'] };
  /**
   * How the task comes by its new row while the iPad has no signal:
   *  - the phone approves master G (the shape of the generator's seed 5311);
   *  - master G was approved earlier, under the lookahead, and F made current again; the phone now makes G current
   *    again (seed 6261). The iPad's delete then puts G's row back as well, since the lookahead had moved it too.
   */
  type Elsewhere = 'approves a new master' | 'makes the other master current again';
  const ELSEWHERE: Elsewhere[] = ['approves a new master', 'makes the other master current again'];
  /** Framing as a place shows it: the row, its dates, and what he can set on it. */
  const framingIn = (shown: readonly ScheduleItem[], all: readonly ScheduleItem[]) => framingOf(shown).map(item => ({
    row: item.id, dates: `${item.startDate} - ${item.finishDate}`,
    'a note': item.notes || '', 'an owner': item.owner || '', 'a priority': item.priority, 'a percent': item.percentComplete,
    'a hand link': (item.dependencies ?? []).map(link => all.find(row => row.id === link.predecessorItemId)?.taskName ?? link.predecessorItemId),
  }));
  /** The phone, the iPad and the web. */
  const places = (phone: Device, ipad: Device) => [framingIn(deviceShown(phone), phone.state), framingIn(deviceShown(ipad), ipad.state), framingIn(webShown(), cloudItems())];
  const asked = async (device: Device) => (await conflictsOf(device)).map(conflict => {
    const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
    const fields = mine.askedFields ?? [];
    return { row: conflict.localId, fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
  });
  const nothingWaitsOrIsAsked = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  async function everythingSyncs(phone: Device, ipad: Device) {
    setOnline(ipad, true);
    shareDocuments(ipad);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
  }
  const heardEverywhere = async (phone: Device, ipad: Device) => { shareDocuments(phone); await backgroundUpload(phone); await settle(phone, ipad); };
  /**
   * The lookahead that moves Framing is in effect under master F, heard everywhere. With no signal, on the iPad: he
   * makes the edit and (`deletes`) deletes the lookahead with its items. Meanwhile, on the phone, the task comes by
   * its new row (`elsewhere`). The iPad has heard nothing of that and has sent nothing.
   */
  async function editedWithNoSignal(kind: Kind, deletes: boolean, elsewhere: Elsewhere = 'approves a new master', afterTheDelete?: Partial<ScheduleItem>) {
    const { phone, ipad } = await start();
    at(LOOK.importedAt!);
    await approve(phone, LOOK, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    await heardEverywhere(phone, ipad);
    if (elsewhere === 'makes the other master current again') {
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      await heardEverywhere(phone, ipad);
      at('2026-09-11T08:00:00.000Z');
      await setActiveOn(phone, F);
      await heardEverywhere(phone, ipad);
    }
    expect(places(phone, ipad).map(place => place[0]?.row)).toEqual(Array(3).fill(OLD_ROW));
    setOnline(ipad, false);
    at('2026-09-12T09:00:00.000Z');
    await edit(ipad, OLD_ROW, EDIT[kind]);
    at('2026-09-12T12:00:00.000Z');
    if (deletes) await deleteWithItems(ipad, LOOK);
    at('2026-09-12T15:00:00.000Z');
    if (afterTheDelete) await edit(ipad, OLD_ROW, afterTheDelete);
    at('2026-09-12T18:00:00.000Z');
    if (elsewhere === 'approves a new master') await approve(phone, scheduleDoc('MASTER G', '2026-09-12T18:00:00.000Z'), [G_ROW, SURVEY]);
    else await setActiveOn(phone, G);
    shareDocuments(phone);
    await backgroundUpload(phone);
    expect(cloudRow(NEW_ROW)).toMatchObject({ taskName: 'Framing' });
    at('2026-09-13T08:00:00.000Z');
    return { phone, ipad };
  }

  describe.each(ELSEWHERE)('meanwhile the phone %s', elsewhere => {
    it.each(KINDS)('%s: it is on the row every place shows for the task, as when the edit waits alone, and nothing is asked', async kind => {
      // The same steps without the delete: the edit waits alone, as a list of fields, and is sent on to the new row.
      const alone = await editedWithNoSignal(kind, false, elsewhere);
      await everythingSyncs(alone.phone, alone.ipad);
      const whenAlone = places(alone.phone, alone.ipad).map(place => [place[0]?.row, place[0]?.[kind]]);
      expect(whenAlone).toEqual(Array(3).fill([NEW_ROW, HIS[kind]]));
      const { phone, ipad } = await editedWithNoSignal(kind, true, elsewhere);
      await everythingSyncs(phone, ipad);
      expect(places(phone, ipad).map(place => [place[0]?.row, place[0]?.[kind]])).toEqual(whenAlone);
      await nothingWaitsOrIsAsked(phone, ipad);
    });
  });

  it('a hand link he makes after the delete, still with no signal, joins the same record (seed 5311 links again after its delete): his note and his link are both on the row every place shows', async () => {
    const { phone, ipad } = await editedWithNoSignal('a note', true, 'approves a new master', EDIT['a hand link']);
    await everythingSyncs(phone, ipad);
    // (It was: the note, and no link, in all three places.)
    expect(places(phone, ipad).map(place => [place[0]?.row, place[0]?.['a note'], place[0]?.['a hand link']])).toEqual(Array(3).fill([NEW_ROW, NOTE, ['Survey']]));
    await nothingWaitsOrIsAsked(phone, ipad);
  });

  it('what the delete itself put back stays on the old row: that row is on its master\'s dates with no lookahead note, and the new row keeps the new master\'s own dates', async () => {
    const { phone, ipad } = await editedWithNoSignal('a note', true);
    await everythingSyncs(phone, ipad);
    // The old row, which nobody is shown: item 1's result stands on it, with his note.
    expect(cloudRow(OLD_ROW)).toMatchObject({ startDate: '10/15/2026', finishDate: '10/25/2026', notes: NOTE });
    expect(Boolean(cloudRow(OLD_ROW)!.lookaheadOverlay)).toBe(false);
    // The new row: the new master's dates, and his note.
    expect(places(phone, ipad).map(place => [place[0]?.row, place[0]?.dates, place[0]?.['a note']])).toEqual(Array(3).fill([NEW_ROW, '10/20/2026 - 10/30/2026', NOTE]));
    // More syncing writes nothing more.
    const writes = cloudWrites();
    await settle(phone, ipad);
    expect(cloudWrites()).toBe(writes);
  });

  it('another device typed a note on the new row meanwhile: he is asked as for any edit of his, and that note is not written over', async () => {
    const { phone, ipad } = await editedWithNoSignal('a note', true);
    await edit(phone, NEW_ROW, { notes: IPAD_NOTE });
    await backgroundUpload(phone);
    at('2026-09-13T12:00:00.000Z');
    await everythingSyncs(phone, ipad);
    // (It was: no card. His note was on the hidden row alone, and there was nothing to choose.)
    expect(await asked(ipad)).toEqual([{ row: NEW_ROW, fields: ['notes'], here: [NOTE], cloud: [IPAD_NOTE] }]);
    expect([cloudRow(NEW_ROW)!.notes, await conflictsOf(phone)]).toEqual([IPAD_NOTE, []]);
  });

  describe('with a cloud that refuses a write made against a row changed since it was read', () => {
    /** The iPad has signal again and has sent nothing yet. */
    async function aboutToSend() {
      const rig = await editedWithNoSignal('a note', true);
      setOnline(rig.ipad, true);
      shareDocuments(rig.ipad);
      mockCloud.versioned = true;
      return rig;
    }

    it('a note lands on the new row in the moment before his is written there: refused, read again, asked; nothing is written over', async () => {
      const { phone, ipad } = await aboutToSend();
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(NEW_ROW)!, { notes: IPAD_NOTE }));
      await backgroundUpload(ipad);
      // (It was: nothing written to the new row at all, so nothing refused and nothing asked.)
      expect(mockCloud.refused).toEqual([`ipad:${NEW_ROW}`]);
      expect(cloudRow(NEW_ROW)).toMatchObject({ notes: IPAD_NOTE });
      expect(await asked(ipad)).toEqual([{ row: NEW_ROW, fields: ['notes'], here: [NOTE], cloud: [IPAD_NOTE] }]);
      await settle(phone, ipad);
      expect([cloudRow(NEW_ROW)!.notes, mockCloud.refused]).toEqual([IPAD_NOTE, [`ipad:${NEW_ROW}`]]);
    });

    it('nobody else writing: one write on the new row (his note alone) and one on the old row (the whole task), neither refused', async () => {
      const { ipad } = await aboutToSend();
      const writes = cloudWrites();
      await backgroundUpload(ipad);
      expect([mockCloud.refused, mockCloud.writes.slice(writes)]).toEqual([[], [`ipad:${NEW_ROW}`, `ipad:${OLD_ROW}`]]);
      expect([cloudRow(NEW_ROW)!.notes, cloudRow(NEW_ROW)!.startDate, cloudRow(OLD_ROW)!.notes, cloudRow(OLD_ROW)!.startDate]).toEqual([NOTE, '10/20/2026', NOTE, '10/15/2026']);
    });
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Build 232, item 1c (13 Oct 2026; review pass 3's S3-1 and S3-2). Two small things in the lines of items 1 and 1b:
 * what a whole-task save ("Delete PDF + Items") does with the record that waits for the task when it comes.
 * The steps both parts share, and what the tests read.
 */
const ITEM_1C = (() => {
  const LOOK = scheduleDoc('LOOKAHEAD B232C', '2026-09-09T12:00:00.000Z', 'lookahead');
  const OLD_ROW = 'MASTER F-1';
  const NEW_ROW = 'MASTER G-1';
  const later = (minutes: number) => jest.setSystemTime(Date.now() + minutes * 60_000);
  /** Framing as a place shows it: the row, its dates, and what he can set on it (a link by the task it names). */
  const framingIn = (shown: readonly ScheduleItem[], all: readonly ScheduleItem[]) => framingOf(shown).map(item => ({
    row: item.id, dates: `${item.startDate} - ${item.finishDate}`, note: item.notes || '', owner: item.owner || '', priority: item.priority,
    links: (item.dependencies ?? []).map(link => all.find(row => row.id === link.predecessorItemId)?.taskName ?? link.predecessorItemId),
  }));
  /** The phone, the iPad and the web. */
  const places = (phone: Device, ipad: Device) => [framingIn(deviceShown(phone), phone.state), framingIn(deviceShown(ipad), ipad.state), framingIn(webShown(), cloudItems())];
  const asked = async (device: Device) => (await conflictsOf(device)).map(conflict => {
    const mine = conflict.localPayload as { askedFields?: string[]; itemData?: Record<string, unknown> };
    const fields = mine.askedFields ?? [];
    return { row: conflict.localId, fields, here: fields.map(field => mine.itemData?.[field]), cloud: fields.map(field => (conflict.remotePayload as Record<string, unknown>)[field]) };
  });
  type Waiting = { id?: string; changedFields?: string[]; carriedText?: string[]; carriedProgress?: boolean; joinedEditFields?: string[]; joinedCarriedText?: string[] };
  /** What waits to go up on a device, record by record. */
  const waiting = async (device: Device) => (await queueOf(device)).map(item => item.payload as Waiting);
  const nothingWaitsOrIsAsked = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  const heardEverywhere = async (phone: Device, ipad: Device) => { shareDocuments(phone); await backgroundUpload(phone); await settle(phone, ipad); };
  /** The lookahead that moves Framing is approved on the phone under master F and heard everywhere. */
  async function underTheLookahead() {
    const { phone, ipad } = await start();
    at(LOOK.importedAt!);
    await approve(phone, LOOK, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    await heardEverywhere(phone, ipad);
    return { phone, ipad };
  }
  /**
   * What the SYNC ITSELF carried waits to go up on the phone (the reviewer's C1 / C2). The phone, with no signal,
   * approves master G under the lookahead; with `rowsAsBuild229` its rows are saved as Build 229 saved them (no record
   * of what they took: only such a row has his owner and note brought forward later by the sync). On the iPad, which
   * has not heard of G, he sets `what` on Framing; it reaches the cloud. The phone gets signal, sends master G and
   * refreshes: its sync carries what he set to the task's new row, and that carry does not go up (weak signal). The
   * phone is left with no signal.
   */
  async function carriedAndWaitingOnThePhone(what: 'his owner and note' | 'his percent', rowsAsBuild229 = true) {
    const { phone, ipad } = await underTheLookahead();
    at('2026-09-10T08:00:00.000Z');
    setOnline(phone, false);
    at(G.importedAt!);
    await approve(phone, G, [G_ROW, SURVEY]);
    if (what === 'his owner and note' && rowsAsBuild229) masterRowsAsBuild229SavedThem(phone);
    at('2026-09-11T09:00:00.000Z');
    if (what === 'his owner and note') { await edit(ipad, OLD_ROW, { notes: NOTE }); at('2026-09-11T09:05:00.000Z'); await edit(ipad, OLD_ROW, { owner: 'Mike' }); }
    else await edit(ipad, OLD_ROW, { percentComplete: 30 });
    await backgroundUpload(ipad);
    setOnline(ipad, false); // the iPad is put away: it carries nothing itself until the end
    at('2026-09-12T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at('2026-09-12T10:00:00.000Z');
    await refresh(phone, false); // the refresh merges; what the sync carried is queued and does not go up yet
    setOnline(phone, false);
    at('2026-09-12T12:00:00.000Z');
    return { phone, ipad };
  }
  /** The phone has signal again and sends what waits. */
  async function thePhoneSends(phone: Device) {
    at('2026-09-13T08:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
  }
  /** Then: the phone refreshes twice, the iPad comes back, everything syncs twice, and a Full Sync on both. */
  async function everythingSyncsAndFullSync(phone: Device, ipad: Device) {
    await refresh(phone);
    later(60);
    await refresh(phone); await backgroundUpload(phone);
    later(60);
    setOnline(ipad, true);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
    later(60);
    await fullSync(phone); await fullSync(ipad); await settle(phone, ipad);
  }
  return { LOOK, OLD_ROW, NEW_ROW, later, places, asked, waiting, nothingWaitsOrIsAsked, heardEverywhere, underTheLookahead, carriedAndWaitingOnThePhone, thePhoneSends, everythingSyncsAndFullSync };
})();

/**
 * Part A (S3-1; Medium by the coordinator's grading, caused by item 1; Build 231 does not have it). The record that
 * waits is the SYNC'S OWN CARRY of his owner and note to a row a Build 229 master made. He then deletes the lookahead
 * with its items, with no signal. Item 1 made the delete's save of the whole task take the carry's place as one whole
 * copy, which read the carried owner and note as part of the copy it started from: its write left the cloud's blank,
 * and the next refresh blanked them on every device, for good.
 *
 * The coordinator's decision: the carried fields still go up by the carry's own rule (each only fills a blank in the
 * cloud's row; over another device's value the cloud's stands and nothing is asked), in the same one write the cloud
 * can refuse.
 */
describe('Build 232 item 1c, part A: what the sync itself carried still goes up when a lookahead is then deleted with no signal', () => {
  const { LOOK, OLD_ROW, NEW_ROW, places, asked, waiting, nothingWaitsOrIsAsked, carriedAndWaitingOnThePhone, thePhoneSends, everythingSyncsAndFullSync } = ITEM_1C;
  const shown = (phone: Device, ipad: Device) => places(phone, ipad).map(place => [place[0]?.row, place[0]?.note, place[0]?.owner]);

  it('his carried owner and note are on the task in all three places, as when the carry goes up by itself (the reviewer\'s C1 and C1c)', async () => {
    // The control: the same steps without the delete.
    const alone = await carriedAndWaitingOnThePhone('his owner and note');
    expect(await waiting(alone.phone)).toMatchObject([{ id: NEW_ROW, carriedText: ['owner', 'notes'] }]);
    await thePhoneSends(alone.phone);
    await everythingSyncsAndFullSync(alone.phone, alone.ipad);
    const whenAlone = shown(alone.phone, alone.ipad);
    expect(whenAlone).toEqual(Array(3).fill([NEW_ROW, NOTE, 'Mike']));
    const { phone, ipad } = await carriedAndWaitingOnThePhone('his owner and note');
    await deleteWithItems(phone, LOOK);
    await thePhoneSends(phone);
    // (It was: the cloud's row left blank by that upload; at the phone's next refresh no note and no owner on any device.)
    expect(cloudRow(NEW_ROW)).toMatchObject({ notes: NOTE, owner: 'Mike' });
    await everythingSyncsAndFullSync(phone, ipad);
    expect(shown(phone, ipad)).toEqual(whenAlone);
    await nothingWaitsOrIsAsked(phone, ipad);
  });

  it('the delete\'s own work stands beside them (item 1): the task\'s row is on the new master\'s dates without the lookahead\'s note, and the old row on its master\'s dates', async () => {
    const { phone, ipad } = await carriedAndWaitingOnThePhone('his owner and note');
    await deleteWithItems(phone, LOOK);
    await thePhoneSends(phone);
    await everythingSyncsAndFullSync(phone, ipad);
    expect([places(phone, ipad).map(place => place[0]?.dates), Boolean(cloudRow(NEW_ROW)!.lookaheadOverlay), cloudRow(OLD_ROW)!.startDate])
      .toEqual([Array(3).fill('10/20/2026 - 10/30/2026'), false, '10/15/2026']);
  });

  it('he sets a next step on that row after the delete, still with no signal: his carried owner and note still go up, and the next step with them', async () => {
    const { phone, ipad } = await carriedAndWaitingOnThePhone('his owner and note');
    await deleteWithItems(phone, LOOK);
    at('2026-09-12T12:30:00.000Z');
    await edit(phone, NEW_ROW, { nextAction: 'Call the inspector' });
    await thePhoneSends(phone);
    expect(cloudRow(NEW_ROW)).toMatchObject({ notes: NOTE, owner: 'Mike', nextAction: 'Call the inspector' });
    await everythingSyncsAndFullSync(phone, ipad);
    expect([shown(phone, ipad), cloudRow(NEW_ROW)!.nextAction]).toEqual([Array(3).fill([NEW_ROW, NOTE, 'Mike']), 'Call the inspector']);
    await nothingWaitsOrIsAsked(phone, ipad);
  });

  it('with rows saved as today\'s build saves them no carry waits, and the same steps end right, as before (C3)', async () => {
    const { phone, ipad } = await carriedAndWaitingOnThePhone('his owner and note', false);
    expect(await waiting(phone)).toEqual([]);
    await deleteWithItems(phone, LOOK);
    await thePhoneSends(phone);
    await everythingSyncsAndFullSync(phone, ipad);
    expect(shown(phone, ipad)).toEqual(Array(3).fill([NEW_ROW, NOTE, 'Mike']));
    await nothingWaitsOrIsAsked(phone, ipad);
  });

  it('another device set the owner of that row meanwhile: its owner stands, his carried note still fills the blank, and nothing is asked, as when the carry goes up by itself', async () => {
    const meanwhileOnTheWeb = () => { at('2026-09-12T13:00:00.000Z'); webWrite(webEdited(cloudRow(NEW_ROW)!, { owner: 'Ana' })); };
    const alone = await carriedAndWaitingOnThePhone('his owner and note');
    meanwhileOnTheWeb();
    await thePhoneSends(alone.phone);
    await everythingSyncsAndFullSync(alone.phone, alone.ipad);
    const whenAlone = [shown(alone.phone, alone.ipad), await asked(alone.phone), await asked(alone.ipad)];
    expect(whenAlone).toEqual([Array(3).fill([NEW_ROW, NOTE, 'Ana']), [], []]);
    const { phone, ipad } = await carriedAndWaitingOnThePhone('his owner and note');
    await deleteWithItems(phone, LOOK);
    meanwhileOnTheWeb();
    await thePhoneSends(phone);
    await everythingSyncsAndFullSync(phone, ipad);
    expect([shown(phone, ipad), await asked(phone), await asked(ipad)]).toEqual(whenAlone);
  });

  describe('with a cloud that refuses a write made against a row changed since it was read', () => {
    it('nobody else writing: the task\'s row is written once, with what the delete put back and his carried owner and note together', async () => {
      const { phone } = await carriedAndWaitingOnThePhone('his owner and note');
      await deleteWithItems(phone, LOOK);
      mockCloud.versioned = true;
      const writes = cloudWrites();
      await thePhoneSends(phone);
      expect([mockCloud.refused, mockCloud.writes.slice(writes).sort()]).toEqual([[], [`phone:${OLD_ROW}`, `phone:${NEW_ROW}`]]);
      expect([cloudRow(NEW_ROW)!.notes, cloudRow(NEW_ROW)!.owner]).toEqual([NOTE, 'Mike']);
    });

    it('an owner lands on that row in the moment before: the write is refused, the row read again; that owner stands, his note fills its blank, nothing is asked', async () => {
      const { phone } = await carriedAndWaitingOnThePhone('his owner and note');
      await deleteWithItems(phone, LOOK);
      mockCloud.versioned = true;
      mockCloud.beforeNextTaskWrite = () => webWrite(webEdited(cloudRow(NEW_ROW)!, { owner: 'Ana' }));
      await thePhoneSends(phone);
      expect(mockCloud.refused).toEqual([`phone:${NEW_ROW}`]);
      expect([cloudRow(NEW_ROW)!.notes, cloudRow(NEW_ROW)!.owner, await asked(phone)]).toEqual([NOTE, 'Ana', []]);
    });
  });
});

/**
 * Part B (S3-2; Low, caused by item 1b). The list a whole copy keeps of "the fields of his edit" (item 1b) must hold
 * his fields and nothing else. A PERCENT the sync itself had carried, still waiting when the delete's save joined it,
 * put all its progress fields in the list. Nothing read them wrongly (dates and percent are never sent on), but the
 * list was not what it says it is.
 */
describe('Build 232 item 1c, part B: the list of his fields holds his fields only', () => {
  const { LOOK, NEW_ROW, waiting, carriedAndWaitingOnThePhone } = ITEM_1C;
  const recordOfTheNewRow = async (phone: Device) => (await waiting(phone)).find(record => record.id === NEW_ROW)!;

  it('a percent the sync carried waits, then the delete\'s save joins it: none of its fields is in the list', async () => {
    const { phone } = await carriedAndWaitingOnThePhone('his percent');
    expect(await recordOfTheNewRow(phone)).toMatchObject({ carriedProgress: true, changedFields: expect.arrayContaining(['percentComplete', 'status']) });
    await deleteWithItems(phone, LOOK);
    const record = await recordOfTheNewRow(phone);
    // (It was: status, percentComplete, progressSource and eight more, none of them typed by him.)
    expect([record.changedFields, record.joinedEditFields ?? []]).toEqual([undefined, []]);
  });

  it('an owner and a note the sync carried wait, he sets a next step on that row, then the delete: the list is the next step alone (with its mark)', async () => {
    const { phone } = await carriedAndWaitingOnThePhone('his owner and note');
    at('2026-09-12T12:30:00.000Z');
    await edit(phone, NEW_ROW, { nextAction: 'Call the inspector' });
    expect(await recordOfTheNewRow(phone)).toMatchObject({ carriedText: ['owner', 'notes'], changedFields: expect.arrayContaining(['owner', 'notes', 'nextAction']) });
    at('2026-09-12T13:00:00.000Z');
    await deleteWithItems(phone, LOOK);
    const record = await recordOfTheNewRow(phone);
    // (Way 2: his edit of a typed field lists the field's own mark beside it, as a priority lists prioritySetByHand.)
    expect([record.changedFields, record.joinedEditFields]).toEqual([undefined, ['nextAction', 'nextActionSetByHand']]);
  });
});

/**
 * Part C (S3-O1; Medium, older: the same on Build 231; the mirror of item 1b's M1). "Delete, then edit": with no
 * signal he deletes the lookahead with its items and THEN makes a hand link on the task, while another device
 * approves a new master or makes another one current. The link was on the replaced master's row alone. (A note, an
 * owner or a priority made in that order still arrived, by the sync's own carry; a link is not carried by that road.)
 * Item 1b's list existed only when an edit was already waiting when the delete's save came.
 *
 * The coordinator's decision: an edit of his that joins a whole copy made by a whole-task save puts its fields in
 * the list, whether or not a list was there. What he typed after the delete follows the task exactly as what he typed
 * before it: the same rule, the same card, the same write the cloud can refuse.
 */
describe('Build 232 item 1c, part C: what he sets AFTER the delete, still with no signal, follows the task too', () => {
  const { LOOK, OLD_ROW, NEW_ROW, later, places, asked, nothingWaitsOrIsAsked, heardEverywhere, underTheLookahead } = ITEM_1C;
  const LINK = { dependencies: [{ predecessorItemId: 'MASTER F-2', type: 'FS', lagDays: 0 }] } as unknown as Partial<ScheduleItem>;
  type Elsewhere = 'approves a new master' | 'makes the other master current again';
  /**
   * The iPad has no signal. On it, in this order: each of `steps` (the delete of the lookahead with its items, or an
   * edit of Framing). Meanwhile the phone changes the master. The iPad has heard nothing and has sent nothing.
   */
  async function withNoSignalOnTheIpad(steps: Array<'delete' | Partial<ScheduleItem>>, elsewhere: Elsewhere) {
    const { phone, ipad } = await underTheLookahead();
    if (elsewhere === 'makes the other master current again') {
      at(G.importedAt!);
      await approve(phone, G, [G_ROW, SURVEY]);
      await heardEverywhere(phone, ipad);
      at('2026-09-11T08:00:00.000Z');
      await setActiveOn(phone, F);
      await heardEverywhere(phone, ipad);
    }
    setOnline(ipad, false);
    at('2026-09-12T09:00:00.000Z');
    for (const step of steps) {
      if (step === 'delete') await deleteWithItems(ipad, LOOK); else await edit(ipad, OLD_ROW, step);
      later(30);
    }
    at('2026-09-12T18:00:00.000Z');
    if (elsewhere === 'approves a new master') await approve(phone, scheduleDoc('MASTER G', '2026-09-12T18:00:00.000Z'), [G_ROW, SURVEY]);
    else await setActiveOn(phone, G);
    shareDocuments(phone);
    await backgroundUpload(phone);
    at('2026-09-13T08:00:00.000Z');
    return { phone, ipad };
  }
  async function everythingSyncs(phone: Device, ipad: Device) {
    setOnline(ipad, true);
    shareDocuments(ipad);
    await settle(phone, ipad);
    await refresh(phone); await refresh(ipad);
  }

  it.each(['approves a new master', 'makes the other master current again'] as Elsewhere[])(
    'the delete first, then a hand link, while the phone %s: the link is on the row every place shows, as the link made with no delete (the reviewer\'s A18, A19, A20)', async elsewhere => {
      const alone = await withNoSignalOnTheIpad([LINK], elsewhere);
      await everythingSyncs(alone.phone, alone.ipad);
      const whenAlone = places(alone.phone, alone.ipad).map(place => [place[0]?.row, place[0]?.links]);
      expect(whenAlone).toEqual(Array(3).fill([NEW_ROW, ['Survey']]));
      const { phone, ipad } = await withNoSignalOnTheIpad(['delete', LINK], elsewhere);
      await everythingSyncs(phone, ipad);
      // (It was, on Build 231 too: no link in any of the three places, and no card.)
      expect(places(phone, ipad).map(place => [place[0]?.row, place[0]?.links])).toEqual(whenAlone);
      // What the delete put back is the old row's: the new row keeps the new master's own dates.
      expect([places(phone, ipad).map(place => place[0]?.dates), cloudRow(OLD_ROW)!.startDate]).toEqual([Array(3).fill('10/20/2026 - 10/30/2026'), '10/15/2026']);
      await nothingWaitsOrIsAsked(phone, ipad);
    });

  it('the delete first, then a priority: it is on the row every place shows, as before (A21)', async () => {
    const { phone, ipad } = await withNoSignalOnTheIpad(['delete', { priority: 'Low' }], 'makes the other master current again');
    await everythingSyncs(phone, ipad);
    expect(places(phone, ipad).map(place => [place[0]?.row, place[0]?.priority])).toEqual(Array(3).fill([NEW_ROW, 'Low']));
    await nothingWaitsOrIsAsked(phone, ipad);
  });

  it('the delete first, then a note, while another device typed a note on the new row: he is asked as for any edit of his, and that note is not written over', async () => {
    const { phone, ipad } = await withNoSignalOnTheIpad(['delete', { notes: NOTE }], 'approves a new master');
    await edit(phone, NEW_ROW, { notes: IPAD_NOTE });
    await backgroundUpload(phone);
    at('2026-09-13T12:00:00.000Z');
    await everythingSyncs(phone, ipad);
    // (It was, on Build 231 too: no card; his note was on the hidden row alone.)
    expect(await asked(ipad)).toEqual([{ row: NEW_ROW, fields: ['notes'], here: [NOTE], cloud: [IPAD_NOTE] }]);
    expect([cloudRow(NEW_ROW)!.notes, await conflictsOf(phone)]).toEqual([IPAD_NOTE, []]);
  });

  it('with a cloud that refuses a changed row: a link made after the delete goes on in one write of its own, and the delete alone sends nothing on', async () => {
    const linked = await withNoSignalOnTheIpad(['delete', LINK], 'approves a new master');
    setOnline(linked.ipad, true);
    shareDocuments(linked.ipad);
    mockCloud.versioned = true;
    let writes = cloudWrites();
    await backgroundUpload(linked.ipad);
    expect([mockCloud.refused, mockCloud.writes.slice(writes)]).toEqual([[], [`ipad:${NEW_ROW}`, `ipad:${OLD_ROW}`]]);
    expect([cloudRow(NEW_ROW)!.startDate, cloudRow(OLD_ROW)!.startDate]).toEqual(['10/20/2026', '10/15/2026']);
    // The delete alone, nothing typed after it: only the old row is written; the new row is the new master's own.
    const alone = await withNoSignalOnTheIpad(['delete'], 'approves a new master');
    setOnline(alone.ipad, true);
    shareDocuments(alone.ipad);
    mockCloud.versioned = true;
    writes = cloudWrites();
    await backgroundUpload(alone.ipad);
    expect([mockCloud.refused, mockCloud.writes.slice(writes)]).toEqual([[], [`ipad:${OLD_ROW}`]]);
  });
});

/**
 * The hand probe that found "2.1e" (notes/impl-b232/runs-1c/probe-and-seed-6389/; the generator's seed 6389 by hand),
 * kept as a guard. An owner that ANOTHER device set on the task's earlier row must still reach the task once the
 * master has changed, whichever device syncs first and whatever he did to the task meanwhile with no signal.
 *
 * With items 1 and 1b in on Build 232's carry, "an edit, then Delete PDF + Items" ended with NO owner on the phone,
 * the iPad and the web when the device holding his edit synced first, and nothing asked: the write that sent his edit
 * on had stamped the task's new row later than its old row, and the carry by the rows' last change only filled from a
 * row changed after the new row last was. Way 2 (step 1) carries by each field's own mark; with items 1, 1b, 1c and
 * part C put back on it (step 2) every line below ends with that owner on the task, and with what he set.
 *
 * "The delete, THEN a priority" with the phone syncing first had ended without his priority on Build 231 and Build
 * 232 (the older loss of review pass 3's S3-O1 family): with part C it follows the task, so it is stated in full.
 * A note and a hand link are each set in both orders as well (Way 2 step 2).
 */
describe('Kept as a guard, the hand probe that found 2.1e: what another device set on the task\'s earlier row still reaches the task, whichever device syncs first', () => {
  const { LOOK, OLD_ROW, NEW_ROW, places, heardEverywhere, underTheLookahead, later } = ITEM_1C;
  type Step = 'delete' | Partial<ScheduleItem>;
  const LOW: Partial<ScheduleItem> = { priority: 'Low' };
  const HIS_NOTE: Partial<ScheduleItem> = { notes: NOTE };
  const LINK = { dependencies: [{ predecessorItemId: 'MASTER F-2', type: 'FS', lagDays: 0 }] } as unknown as Partial<ScheduleItem>;
  /**
   * Master G is approved and heard, then master F made current again; the lookahead moves Framing under F, heard
   * everywhere. With no signal, on the iPad: `steps`, in order (an edit of the task; "Delete PDF + Items" on the
   * lookahead). Meanwhile the web sets the task's owner on the row it still shows, the old one, and the phone makes
   * master G current, so the task has a new row. The iPad gets signal; with `ipadFirst` it syncs before the phone
   * has refreshed. Then everything syncs.
   */
  async function run(steps: Step[], ipadFirst: boolean) {
    const { phone, ipad } = await underTheLookahead();
    at(G.importedAt!); await approve(phone, G, [G_ROW, SURVEY]); await heardEverywhere(phone, ipad);
    at('2026-09-11T08:00:00.000Z'); await setActiveOn(phone, F); await heardEverywhere(phone, ipad);
    setOnline(ipad, false);
    at('2026-09-12T09:00:00.000Z');
    for (const step of steps) { if (step === 'delete') await deleteWithItems(ipad, LOOK); else await edit(ipad, OLD_ROW, step); later(30); }
    at('2026-09-12T12:00:00.000Z'); webWrite(webEdited(cloudRow(OLD_ROW)!, { owner: 'Ana' }));
    at('2026-09-12T18:00:00.000Z'); await setActiveOn(phone, G); shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-13T08:00:00.000Z');
    setOnline(ipad, true); shareDocuments(ipad);
    if (ipadFirst) { await backgroundUpload(ipad); await refresh(ipad); }
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    return places(phone, ipad);
  }
  /** What he does on the iPad with no signal, and the priority, note and links Framing then has. */
  const CASES: Array<[string, Step[], ScheduleItem['priority'], string, string[]]> = [
    ['nothing of his at all (the web\'s owner alone)', [], 'Medium', '', []],
    ['a priority alone, no delete (an edit waiting alone)', [LOW], 'Low', '', []],
    ['a priority, THEN the delete (the order of 2.1e)', [LOW, 'delete'], 'Low', '', []],
    ['the delete, THEN a priority', ['delete', LOW], 'Low', '', []],
    ['a note, THEN the delete', [HIS_NOTE, 'delete'], 'Medium', NOTE, []],
    ['the delete, THEN a note', ['delete', HIS_NOTE], 'Medium', NOTE, []],
    ['a hand link, THEN the delete', [LINK, 'delete'], 'Medium', '', ['Survey']],
    ['the delete, THEN a hand link', ['delete', LINK], 'Medium', '', ['Survey']],
    ['the delete alone', ['delete'], 'Medium', '', []],
  ];

  describe.each([['the iPad, which holds what he did,', true], ['the phone', false]] as const)('%s syncs first', (_who, ipadFirst) => {
    it.each(CASES)('%s: Framing is on its new row with the web\'s owner and what he set, in all three places', async (_label, steps, priority, note, links) => {
      const shown = await run(steps, ipadFirst);
      expect(shown.map(place => place.map(framing => [framing.row, framing.owner, framing.priority, framing.note, framing.links])))
        .toEqual(Array(3).fill([[NEW_ROW, 'Ana', priority, note, links]]));
    });
  });
});

/**
 * The owner's answer to question 47 (13 Oct 2026), "47 A"; the schedules reviewer's P1-8 (Medium, older). A newer
 * master turns a task High (its file marks it Critical, or its finish comes within the week) also when it leaves the
 * task on its dates, unless he set that task's priority himself. Here: two devices and the web with one cloud. A
 * device that hears of the master from another device ends on the same priorities, and a priority the app itself
 * raised is never asked about: his own stands over it, whichever device syncs first.
 * (The rule on the records alone: owner-answer-q47-critical-raises-unmoved-task.)
 */
describe('Q47: a master turns a task it leaves on its dates High, between two devices', () => {
  // N is approved five days before Survey's finish (10/14) and moves nothing: its file's Survey row reads High, its
  // Framing row (10/25) Medium. P, a day later, moves Survey a month out: Medium.
  const N = scheduleDoc('MASTER N', '2026-10-09T12:00:00.000Z');
  const P = scheduleDoc('MASTER P', '2026-10-10T12:00:00.000Z');
  const SURVEY_FAR = 'Survey,Alpha,Lot,11/12/2026,11/14/2026,';
  const surveyOf = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Survey');
  const priorities = (items: readonly ScheduleItem[]) => [surveyOf(items).map(item => item.priority), framingOf(items).map(item => item.priority)];
  const everywhere = async (phone: Device, ipad: Device) => {
    await refresh(phone); await refresh(ipad);
    return [priorities(deviceShown(phone)), priorities(deviceShown(ipad)), priorities(webShown())];
  };
  const ALL = (survey: string, framing = 'Medium') => Array(3).fill([[survey], [framing]]);
  const nothingAskedOrWaiting = async (phone: Device, ipad: Device) =>
    expect([await conflictsOf(phone), await conflictsOf(ipad), await queueOf(phone), await queueOf(ipad)]).toEqual([[], [], [], []]);
  const started = async () => {
    const { phone, ipad } = await start();
    const surveyId = surveyOf(deviceShown(phone))[0].id;
    expect(await everywhere(phone, ipad)).toEqual(ALL('Medium'));
    return { phone, ipad, surveyId };
  };
  const phoneApprovesN = async (phone: Device) => {
    at(N.importedAt!);
    await approve(phone, N, [F_ROW, SURVEY]);
    shareDocuments(phone);
    await backgroundUpload(phone);
  };
  const word = (item: ScheduleItem | undefined) => [item?.priority, item?.priorityAsImported, item?.prioritySetByHand?.priority ?? null];

  it('the phone approves it; the iPad and the web hear of it: High in all three places on the same row, nothing asked, and more syncing writes nothing', async () => {
    const { phone, ipad, surveyId } = await started();
    await phoneApprovesN(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('High'));
    expect([surveyOf(deviceShown(phone))[0].id, surveyOf(deviceShown(ipad))[0].id, surveyOf(webShown())[0].id]).toEqual([surveyId, surveyId, surveyId]);
    // The file's word, not his: no mark anywhere.
    expect([word(cloudRow(surveyId)), word(surveyOf(deviceShown(phone))[0]), word(surveyOf(deviceShown(ipad))[0])]).toEqual(Array(3).fill(['High', 'High', null]));
    await nothingAskedOrWaiting(phone, ipad);
    const writes = cloudWrites();
    await settle(phone, ipad);
    await fullSync(phone);
    await fullSync(ipad);
    expect(cloudWrites()).toBe(writes);
    expect(await everywhere(phone, ipad)).toEqual(ALL('High'));
  });

  it.each(['the automatic upload', 'Sync Now'])('he had set it Low on the iPad, which had no signal and had not heard of the master: his Low in all three places, nothing asked (%s)', async (path) => {
    const { phone, ipad, surveyId } = await started();
    setOnline(ipad, false);
    at('2026-10-09T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    await phoneApprovesN(phone);
    expect(word(cloudRow(surveyId))).toEqual(['High', 'High', null]);
    at('2026-10-09T15:00:00.000Z');
    setOnline(ipad, true);
    if (path === 'Sync Now') await fullSync(ipad); else { await backgroundUpload(ipad); await refresh(ipad); }
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    expect(word(cloudRow(surveyId))[2]).toBe('Low');
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('...and set after the phone approved, still not having heard: his Low all the same', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(ipad, false);
    await phoneApprovesN(phone);
    at('2026-10-09T14:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    at('2026-10-09T15:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('the other order: the phone, with no signal and not having heard of the Low he set on the iPad, approves the master: his Low in all three places, nothing asked', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(phone, false);
    at('2026-10-09T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    await backgroundUpload(ipad);
    at(N.importedAt!);
    await approve(phone, N, [F_ROW, SURVEY]);
    // On the phone, which has not heard, the task reads High until it syncs.
    expect(priorities(deviceShown(phone))).toEqual([['High'], ['Medium']]);
    at('2026-10-09T15:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    expect(word(cloudRow(surveyId))[2]).toBe('Low');
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('...and when the Low was set on the web desktop meanwhile', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(phone, false);
    at('2026-10-09T09:00:00.000Z');
    webWrite(webEdited(cloudRow(surveyId)!, { priority: 'Low' }));
    at(N.importedAt!);
    await approve(phone, N, [F_ROW, SURVEY]);
    at('2026-10-09T15:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('a Low he set before, heard everywhere: the master leaves it Low in all three places', async () => {
    const { phone, ipad, surveyId } = await started();
    at('2026-10-08T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    await phoneApprovesN(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('the desktop uploads the master and makes it current; the phone and the iPad hear of it: High in all three places, nothing asked', async () => {
    const { phone, ipad, surveyId } = await started();
    at(N.importedAt!);
    webUploadsAndMakesCurrent('MASTER N', [F_ROW, SURVEY]);
    expect(word(cloudRow(surveyId))).toEqual(['High', 'High', null]);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('High'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('...while the iPad, with no signal, had set it Low: his Low in all three places, nothing asked', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(ipad, false);
    at('2026-10-09T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    at(N.importedAt!);
    webUploadsAndMakesCurrent('MASTER N', [F_ROW, SURVEY]);
    at('2026-10-09T15:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Low'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  // (The schedules reviewer's P2-4, as it would meet this rule: his priority reads as the row did before, so "nobody
  // changed it"; the mark his edit left says it is his.)
  it('he set it Low and then Medium again on the iPad, heard by the cloud; the phone, with no signal, approves the master: his Medium in all three places, nothing asked', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(phone, false);
    at('2026-10-09T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    at('2026-10-09T09:30:00.000Z');
    await edit(ipad, surveyId, { priority: 'Medium' });
    await backgroundUpload(ipad);
    expect(word(cloudRow(surveyId))).toEqual(['Medium', 'Medium', 'Medium']);
    at(N.importedAt!);
    await approve(phone, N, [F_ROW, SURVEY]);
    at('2026-10-09T15:00:00.000Z');
    setOnline(phone, true);
    shareDocuments(phone);
    await backgroundUpload(phone);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Medium'));
    expect(word(cloudRow(surveyId))[2]).toBe('Medium');
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('...and the other order: set Low and Medium again on the iPad with no signal, after which the phone approves: his Medium in all three places, nothing asked', async () => {
    const { phone, ipad, surveyId } = await started();
    setOnline(ipad, false);
    at('2026-10-09T09:00:00.000Z');
    await edit(ipad, surveyId, { priority: 'Low' });
    at('2026-10-09T09:30:00.000Z');
    await edit(ipad, surveyId, { priority: 'Medium' });
    await phoneApprovesN(phone);
    at('2026-10-09T15:00:00.000Z');
    setOnline(ipad, true);
    await backgroundUpload(ipad);
    await refresh(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Medium'));
    expect(word(cloudRow(surveyId))[2]).toBe('Medium');
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('Set Active back to the older master and forward again, on the phone: High each way in all three places, and nothing asked', async () => {
    const { phone, ipad } = await started();
    await phoneApprovesN(phone);
    await settle(phone, ipad);
    at('2026-10-09T16:00:00.000Z');
    await setActiveOn(phone, F);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('High'));
    at('2026-10-09T17:00:00.000Z');
    await setActiveOn(phone, N);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('High'));
    await nothingAskedOrWaiting(phone, ipad);
  });

  it('the High is the file\'s word and not his: the next master, approved on the iPad that only heard of it, moves the task a month out and it reads Medium in all three places', async () => {
    const { phone, ipad, surveyId } = await started();
    await phoneApprovesN(phone);
    await settle(phone, ipad);
    at(P.importedAt!);
    await approve(ipad, P, [F_ROW, SURVEY_FAR]);
    shareDocuments(ipad);
    await backgroundUpload(ipad);
    await settle(phone, ipad);
    expect(await everywhere(phone, ipad)).toEqual(ALL('Medium'));
    expect(surveyOf(webShown())[0].id).not.toBe(surveyId);
    await nothingAskedOrWaiting(phone, ipad);
  });
});

/* ============================================================================================================== */
/* Review pass 10, O-9 (older: the same on Build 231). A newer schedule is deleted WITH its items ("Delete PDF +     */
/* Items") on the phone with no signal, while the iPad, with no signal, has a note waiting on a task that schedule  */
/* moved. The phone gets signal first: its restored row of the task goes up, its deletion records wait for its next */
/* Sync Now. The restored row and the deleted row then each name the other as an earlier row of the task, and the   */
/* iPad's upload sent his note on from one to the other for ever: it never finished, and memory grew without end.  */
/* Now his note is sent on to each row of the task once, and stops: it lands on the restored row, the row the task  */
/* lives on after the delete (and, until the phone's deletion records arrive, on the deleted row, never shown).     */
/* Every upload here is bounded: one that runs away fails the test at once instead of eating memory.               */
/* ============================================================================================================== */
const O9_J_ROWS = ['Framing,Alpha,Lot,10/06/2026,10/16/2026,', SURVEY];
/** The memory and the processor time an upload may add before it counts as running away (the rig's clock is fake, and a
 * loop of promises never lets a timer fire, so the bound is checked from inside: at every 10,000th list filter). */
const O9_HEAP_LIMIT = 400_000_000;
const O9_CPU_LIMIT_MICROSECONDS = 30_000_000;
let o9FilterCalls = 0;
async function o9Bounded(run: () => Promise<unknown>): Promise<'finished' | 'RUN-AWAY'> {
  const filter = Array.prototype.filter;
  const heapAtStart = process.memoryUsage().heapUsed;
  const cpuAtStart = process.cpuUsage();
  let ranAway = false;
  (Array.prototype as unknown as { filter: unknown }).filter = function bounded(this: unknown[], ...args: unknown[]) {
    o9FilterCalls += 1;
    if (ranAway || (o9FilterCalls % 10_000 === 0 && (process.memoryUsage().heapUsed > heapAtStart + O9_HEAP_LIMIT ||
      process.cpuUsage(cpuAtStart).user > O9_CPU_LIMIT_MICROSECONDS))) {
      ranAway = true;
      throw new Error('O-9: the upload did not finish');
    }
    return (filter as (...a: unknown[]) => unknown).apply(this, args);
  };
  try { await run(); } catch (error) { if (!ranAway) throw error; } finally { Array.prototype.filter = filter; }
  return ranAway ? 'RUN-AWAY' : 'finished';
}
const o9IdOf = (device: Device, name: string) => deviceShown(device).find(item => item.taskName === name)!.id;
async function o9ApproveOn(device: Device, doc: ReferenceDocument, lines: string[], lookahead = false) {
  at(doc.importedAt as string);
  await approve(device, doc, lines, lookahead);
  shareDocuments(device);
  await backgroundUpload(device);
}
const o9Row = (item: ScheduleItem) => [item.id, item.taskName, item.startDate, item.finishDate, item.notes || ''];
async function o9Places(phone: Device, ipad: Device) {
  return {
    phone: deviceShown(phone).map(o9Row), ipad: deviceShown(ipad).map(o9Row), web: webShown().map(o9Row),
    cards: (await conflictsOf(phone)).length + (await conflictsOf(ipad)).length,
    waiting: (await queueOf(phone)).length + (await queueOf(ipad)).length,
  };
}
/** The cloud's rows that hold his note, and the rows that name another as an earlier row of the task. */
const o9Cloud = () => ({
  withNote: cloudItems().filter(row => row.notes === NOTE).map(row => row.id).sort(),
  naming: cloudItems().filter(row => (row.revisedFromTaskIds || []).length > 0).map(row => `${row.id}<-${(row.revisedFromTaskIds || []).join('/')}`).sort(),
});
/** The phone's waiting deletion records go up (Sync Now), everything is heard and sent, then a Full Sync on both. */
async function o9Finish(phone: Device, ipad: Device) {
  const phoneFull = await o9Bounded(() => fullSync(phone));
  const settled = await o9Bounded(() => settle(phone, ipad));
  const afterSettle = await o9Places(phone, ipad);
  const synced = await o9Bounded(async () => { await fullSync(phone); await fullSync(ipad); await settle(phone, ipad); });
  const w0 = cloudWrites();
  const again = await o9Bounded(async () => { await settle(phone, ipad); await fullSync(phone); await fullSync(ipad); await settle(phone, ipad); });
  return { runs: [phoneFull, settled, synced, again], afterSettle, end: await o9Places(phone, ipad), writesWhenNothingHappens: cloudWrites() - w0, cloud: o9Cloud() };
}
const O9_RESULTS: Record<string, unknown> = {};
afterAll(() => { if (process.env.O9_OUT) fs.writeFileSync(process.env.O9_OUT, `${JSON.stringify(O9_RESULTS, null, 1)}\n`); });
/** Framing on F's row with his note, Survey on F's, in every place; nothing asked, nothing waiting. */
const O9_LANDED = [['MASTER F-1', 'Framing', '10/15/2026', '10/25/2026', NOTE], ['MASTER F-2', 'Survey', '10/12/2026', '10/14/2026', '']];
const O9_SETTLED = { phone: O9_LANDED, ipad: O9_LANDED, web: O9_LANDED, cards: 0, waiting: 0 };
const O9_SURVEY_ROWS = [['MASTER F-1', 'Framing', '10/15/2026', '10/25/2026', ''], ['MASTER F-2', 'Survey', '10/12/2026', '10/14/2026', 'Stakes out']];
const O9_SURVEY_NOTE = { phone: O9_SURVEY_ROWS, ipad: O9_SURVEY_ROWS, web: O9_SURVEY_ROWS, cards: 0, waiting: 0 };

describe('Review pass 10, O-9: a note waiting on the iPad while the phone deletes the newer schedule with its items', () => {
  it('O9a: a master the web uploaded and never made current: the iPad\'s upload finishes, and his note lands on F\'s row at once', async () => {
    const { phone, ipad } = await start();
    at('2026-09-12T09:00:00.000Z'); webUploads('MASTER J', O9_J_ROWS); await settle(phone, ipad);
    setOnline(phone, false); setOnline(ipad, false);
    at('2026-09-12T10:00:00.000Z'); const typedOn = o9IdOf(ipad, 'Framing'); await edit(ipad, typedOn, { notes: NOTE });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, { id: 'MASTER J' } as ReferenceDocument);
    at('2026-09-12T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone)); await refresh(phone);
    at('2026-09-12T12:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    const ipadUp = await o9Bounded(() => backgroundUpload(ipad));
    const atOnce = o9Cloud();
    const ipadAgain = await o9Bounded(() => backgroundUpload(ipad));
    at('2026-09-12T13:00:00.000Z');
    const end = await o9Finish(phone, ipad);
    O9_RESULTS.O9a = { typedOn, phoneUp, ipadUp, atOnce, ipadAgain, ...end };
    expect([phoneUp, ipadUp, ipadAgain]).toEqual(['finished', 'finished', 'finished']);
    expect(typedOn).toBe('MASTER F-1');
    expect(atOnce.naming).toEqual(['MASTER F-1<-MASTER J-1', 'MASTER J-1<-MASTER F-1']);
    expect(atOnce.withNote).toEqual(['MASTER F-1', 'MASTER J-1']);
    expect(end.runs).toEqual(['finished', 'finished', 'finished', 'finished']);
    expect(end.afterSettle).toEqual(O9_SETTLED);
    expect(end.end).toEqual(O9_SETTLED);
    expect(end.writesWhenNothingHappens).toBe(0);
    expect(end.cloud.withNote).toEqual(['MASTER F-1']);
  });

  it('O9c: the master in use: the iPad\'s upload finishes, and his note, typed on G\'s row, lands on F\'s row at once', async () => {
    const { phone, ipad } = await start();
    await o9ApproveOn(phone, G, [G_ROW, SURVEY]); await settle(phone, ipad);
    setOnline(phone, false); setOnline(ipad, false);
    at('2026-09-12T10:00:00.000Z'); const typedOn = o9IdOf(ipad, 'Framing'); await edit(ipad, typedOn, { notes: NOTE });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, G);
    at('2026-09-12T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone)); await refresh(phone);
    at('2026-09-12T12:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    const ipadUp = await o9Bounded(() => backgroundUpload(ipad));
    const atOnce = o9Cloud();
    at('2026-09-12T13:00:00.000Z');
    const end = await o9Finish(phone, ipad);
    // The master in use is gone, so no master is current until he makes F current again (as before this fix).
    at('2026-09-12T14:00:00.000Z'); await setActiveOn(phone, F);
    const afterSetActive = await o9Bounded(async () => { await backgroundUpload(phone); await settle(phone, ipad); });
    const shownAgain = await o9Places(phone, ipad);
    O9_RESULTS.O9c = { typedOn, phoneUp, ipadUp, atOnce, ...end, afterSetActive, shownAgain, cloudAfterSetActive: o9Cloud() };
    expect([phoneUp, ipadUp]).toEqual(['finished', 'finished']);
    expect(typedOn).toBe('MASTER G-1');
    expect(atOnce.naming).toEqual(['MASTER F-1<-MASTER G-1', 'MASTER G-1<-MASTER F-1']);
    expect(atOnce.withNote).toEqual(['MASTER F-1', 'MASTER G-1']);
    expect(end.runs).toEqual(['finished', 'finished', 'finished', 'finished']);
    expect(end.afterSettle).toEqual({ phone: [], ipad: [], web: [], cards: 0, waiting: 0 });
    expect(end.end).toEqual({ phone: [], ipad: [], web: [], cards: 0, waiting: 0 });
    expect(end.writesWhenNothingHappens).toBe(0);
    expect(end.cloud.withNote).toEqual(['MASTER F-1']);
    expect(afterSetActive).toBe('finished');
    expect(shownAgain).toEqual(O9_SETTLED);
  });

  // The reviewer's four controls, which never ran away: they end as they did before.
  it('O9b: the phone HAS signal when it deletes J (its deletion records go up at once)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-12T09:00:00.000Z'); webUploads('MASTER J', O9_J_ROWS); await settle(phone, ipad);
    setOnline(ipad, false);
    at('2026-09-12T10:00:00.000Z'); await edit(ipad, o9IdOf(ipad, 'Framing'), { notes: NOTE });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, { id: 'MASTER J' } as ReferenceDocument); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone)); await refresh(phone);
    at('2026-09-12T12:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    const ipadUp = await o9Bounded(() => backgroundUpload(ipad));
    const end = await o9Finish(phone, ipad);
    O9_RESULTS.O9b = { phoneUp, ipadUp, ...end };
    expect([phoneUp, ipadUp, ...end.runs]).toEqual(Array(6).fill('finished'));
    expect([end.afterSettle, end.end, end.writesWhenNothingHappens, end.cloud.withNote]).toEqual([O9_SETTLED, O9_SETTLED, 0, ['MASTER F-1']]);
  });

  it('O9d: a lookahead moved Framing, and the phone deletes the lookahead with its items', async () => {
    const { phone, ipad } = await start();
    await o9ApproveOn(phone, L, [L_ROW], true); await settle(phone, ipad);
    setOnline(phone, false); setOnline(ipad, false);
    at('2026-09-12T10:00:00.000Z'); await edit(ipad, o9IdOf(ipad, 'Framing'), { notes: NOTE });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, L);
    at('2026-09-12T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone)); await refresh(phone);
    at('2026-09-12T12:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    const ipadUp = await o9Bounded(() => backgroundUpload(ipad));
    const end = await o9Finish(phone, ipad);
    O9_RESULTS.O9d = { phoneUp, ipadUp, ...end };
    expect([phoneUp, ipadUp, ...end.runs]).toEqual(Array(6).fill('finished'));
    expect([end.afterSettle, end.end, end.writesWhenNothingHappens, end.cloud.withNote]).toEqual([O9_SETTLED, O9_SETTLED, 0, ['MASTER F-1']]);
  });

  it('O9e: as O9a, but the iPad\'s waiting note is on a task J did not move (Survey)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-12T09:00:00.000Z'); webUploads('MASTER J', O9_J_ROWS); await settle(phone, ipad);
    setOnline(phone, false); setOnline(ipad, false);
    at('2026-09-12T10:00:00.000Z'); await edit(ipad, o9IdOf(ipad, 'Survey'), { notes: 'Stakes out' });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, { id: 'MASTER J' } as ReferenceDocument);
    at('2026-09-12T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone)); await refresh(phone);
    at('2026-09-12T12:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
    const ipadUp = await o9Bounded(() => backgroundUpload(ipad));
    const end = await o9Finish(phone, ipad);
    O9_RESULTS.O9e = { phoneUp, ipadUp, ...end };
    expect([phoneUp, ipadUp, ...end.runs]).toEqual(Array(6).fill('finished'));
    expect([end.afterSettle, end.end, end.writesWhenNothingHappens, end.cloud.withNote]).toEqual([O9_SURVEY_NOTE, O9_SURVEY_NOTE, 0, []]);
  });

  it('O9f: as O9a, but the phone, which deletes J, has the note waiting (typed before the delete)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-12T09:00:00.000Z'); webUploads('MASTER J', O9_J_ROWS); await settle(phone, ipad);
    setOnline(phone, false);
    at('2026-09-12T10:00:00.000Z'); await edit(phone, o9IdOf(phone, 'Framing'), { notes: NOTE });
    at('2026-09-12T11:00:00.000Z'); await deleteWithItems(phone, { id: 'MASTER J' } as ReferenceDocument);
    at('2026-09-12T12:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    const phoneUp = await o9Bounded(() => backgroundUpload(phone));
    const end = await o9Finish(phone, ipad);
    O9_RESULTS.O9f = { phoneUp, ...end };
    expect([phoneUp, ...end.runs]).toEqual(Array(5).fill('finished'));
    expect([end.afterSettle, end.end, end.writesWhenNothingHappens, end.cloud.withNote]).toEqual([O9_SETTLED, O9_SETTLED, 0, ['MASTER F-1']]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Way 2 of the sync design note, step 1 (notes/sync-design/NOTE.txt, "WAY 2: A CARRY BY FIELD"; the coordinator's
 * decisions of 14 Oct 2026). The carry of his typed text from a task's earlier row to its newest row (review N2 P1)
 * read one time for all of a row's fields, the row's own stamp: a row stamped for any reason read as "typed later".
 * Now each of the five fields he types (owner, contractor, note, next step, milestone) has its own mark on the row:
 * the text he last typed there by hand, and when (ownerSetByHand, ...); and a row a master makes keeps what it was
 * made with in those fields (textAsMade): one with no mark that still holds that was not typed there since. The carry
 * reads those marks and the record of what the row took (textFromTask), not the stamps:
 *  1. text he typed on the OLD row follows to the new row, unless the new row has his own later typing of that field;
 *  2. a field he CLEARED stays cleared: a hidden row stamped by something else never gives a cleared value back;
 *  3. a row with no mark (written by Build 231 or 232, the web before it is updated, a master approved on Build 229)
 *     keeps the rule by the stamps exactly.
 * The priority reads the mark it already had (prioritySetByHand) the same way. Hand links and the percent: not here.
 */
describe('Way 2, step 1: the carry by field, on the records alone', () => {
  const row = (id: string, extra: Partial<ScheduleItem> & Record<string, unknown> = {}) => ({
    id, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '',
    owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', createdAt: '2026-09-07T12:00:00.000Z',
    importedAt: '2026-09-07T12:00:00.000Z', ...extra,
  }) as ScheduleItem;
  const merged = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: rows, cloud: rows, deletedIds: [], allowCloudOnly: true });
  const of = (rows: ScheduleItem[], id: string) => rows.find(item => item.id === id)!;
  const T1 = '2026-09-08T09:00:00.000Z', T2 = '2026-09-09T09:00:00.000Z', T3 = '2026-09-10T09:00:00.000Z', T4 = '2026-09-11T09:00:00.000Z';
  const typed = (text: string, at: string) => ({ text, at });
  /** What a row a master made on this build holds in each field he types when it is made (all blank unless given). */
  const madeWith = (text: Record<string, string> = {}) => ({ textAsMade: { owner: '', contractor: '', notes: '', nextAction: '', milestone: '', ...text } });
  /** A new row a master made on this build: it took a blank owner and note from F, and marks what is typed on it. */
  const newRow = (extra: Record<string, unknown> = {}) => row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', owner: '', notes: '' }, ...madeWith(), ...extra } as never);

  describe('decision 1: text he typed on the old row follows, unless the new row has his own later typing of that field', () => {
    it('the new row was stamped after the old row\'s owner for something else (2.1e\'s cause): the owner still reaches it', async () => {
      const out = merged([row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 } as never), newRow({ updatedAt: T3 })]);
      expect([of(out, 'G').owner, of(out, 'G').updatedAt, of(out, 'G').textFromTask]).toEqual(['Ana', T3, { taskId: 'F', owner: 'Ana', notes: '' }]);
    });
    it('the same when the old row has no mark (the web before it is updated wrote it): the new row never typed it, so the old row has the later word', async () => {
      expect(of(merged([row('F', { owner: 'Ana', updatedAt: T2 }), newRow({ updatedAt: T3 })]), 'G').owner).toBe('Ana');
    });
    it('he typed the owner on the new row and cleared it BEFORE the old row\'s owner was typed: the old row\'s owner follows', async () => {
      const out = merged([row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 } as never), newRow({ ownerSetByHand: typed('', T1), updatedAt: T3 })]);
      expect(of(out, 'G').owner).toBe('Ana');
    });
    it('he cleared it on the new row AFTER: his clear stands', async () => {
      const out = merged([row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 } as never), newRow({ ownerSetByHand: typed('', T3), updatedAt: T3 })]);
      expect(of(out, 'G').owner).toBe('');
    });
  });

  describe('decision 2: a field he cleared stays cleared', () => {
    it('the hidden row was stamped after his clear by something else (a lookahead\'s delete, a percent): its older note does not come back', async () => {
      const out = merged([row('F', { notes: NOTE, notesSetByHand: typed(NOTE, T1), updatedAt: T3 } as never), newRow({ notesSetByHand: typed('', T2), updatedAt: T2 })]);
      expect(of(out, 'G').notes).toBe('');
    });
    it('nor a note the hidden row holds from when it was made (it was never typed there since)', async () => {
      const out = merged([row('F', { notes: NOTE, ...madeWith({ notes: NOTE }), updatedAt: T3 } as never), newRow({ notesSetByHand: typed('', T2), updatedAt: T2 })]);
      expect(of(out, 'G').notes).toBe('');
    });
    it('but a note the hidden row holds that it was not made with, with no mark (typed there on Build 232): by the stamps', async () => {
      const out = merged([row('F', { notes: NOTE, ...madeWith(), updatedAt: T3 } as never), newRow({ notesSetByHand: typed('', T2), updatedAt: T2 })]);
      expect(of(out, 'G').notes).toBe(NOTE);
    });
    it('a note typed on the hidden row after his clear does come forward (his later word)', async () => {
      const out = merged([row('F', { notes: NOTE, notesSetByHand: typed(NOTE, T3), updatedAt: T3 } as never), newRow({ notesSetByHand: typed('', T2), updatedAt: T4 })]);
      expect(of(out, 'G').notes).toBe(NOTE);
    });
    it('seed 9179 with the marks: a blank typed back over an owner set on the newest row stands over an older note through a row in between', async () => {
      const rows = [
        row('F', { notes: NOTE, notesSetByHand: typed(NOTE, T2), updatedAt: T3 } as never),
        row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', notes: '' }, ...madeWith() } as never),
        row('H', { revisedFromTaskIds: ['F', 'G'], textFromTask: { taskId: 'G', notes: '' }, ...madeWith(), notesSetByHand: typed('', T4), updatedAt: T4 } as never),
      ];
      expect(of(merged(rows), 'H').notes).toBe('');
    });
    it('a clear typed on the row in between, after the oldest row\'s note, stands for the newest row too', async () => {
      const rows = [
        row('F', { notes: NOTE, notesSetByHand: typed(NOTE, T1), updatedAt: T1 } as never),
        row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', notes: '' }, ...madeWith(), notesSetByHand: typed('', T2), updatedAt: T2 } as never),
        row('H', { revisedFromTaskIds: ['F', 'G'], textFromTask: { taskId: 'G', notes: '' }, ...madeWith() } as never),
      ];
      expect(of(merged(rows), 'H').notes).toBe('');
    });
  });

  describe('decision 3: a row with no mark keeps the rule by the stamps exactly', () => {
    it('a new row Build 232 made (no mark): stamped after the old row\'s owner, it keeps its blank, as today', async () => {
      const out = merged([row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 } as never), row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', owner: '' }, updatedAt: T3 })]);
      expect(of(out, 'G').owner).toBe('');
    });
    it('a new row whose owner mark Build 232 left behind (it typed there, the mark no longer names what the row holds): by the stamps', async () => {
      // He typed Bob on this build, then cleared it on Build 232 (no mark left). By the stamps the clear is later: it stands.
      const out = merged([row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 } as never), newRow({ ownerSetByHand: typed('Bob', T1), updatedAt: T3 })]);
      expect(of(out, 'G').owner).toBe('');
    });
    it('a hidden row with no mark stamped after his clear: by the stamps, as today (its note comes back once)', async () => {
      const out = merged([row('F', { notes: NOTE, updatedAt: T3 }), newRow({ notesSetByHand: typed('', T2), updatedAt: T2 })]);
      expect(of(out, 'G').notes).toBe(NOTE);
    });
    it('rows with no record of what they took (Build 229) and no mark: from the row changed last, as today', async () => {
      const out = merged([row('A', { owner: 'Ana', updatedAt: T1 }), row('B', { revisedFromTaskIds: ['A'], notes: NOTE, updatedAt: T2 }), row('C', { revisedFromTaskIds: ['A', 'B'] })]);
      expect([of(out, 'C').owner, of(out, 'C').notes]).toEqual(['', NOTE]);
    });
  });

  describe('the comparisons for a row with no record of a field, by field where every row says when', () => {
    it('each field from the earlier row that typed it last', async () => {
      const out = merged([
        row('A', { owner: 'Ana', ownerSetByHand: typed('Ana', T3), ...madeWith(), updatedAt: T3 } as never),
        row('B', { revisedFromTaskIds: ['A'], notes: NOTE, notesSetByHand: typed(NOTE, T2), ...madeWith(), updatedAt: T4 } as never),
        row('C', { revisedFromTaskIds: ['A', 'B'], ...madeWith(), updatedAt: T1 } as never),
      ]);
      expect([of(out, 'C').owner, of(out, 'C').notes]).toEqual(['Ana', NOTE]);
    });
  });

  describe('the priority, by the mark it already had', () => {
    const P = (extra: Record<string, unknown>) => row('F', { priority: 'High', prioritySetByHand: { priority: 'High', at: T2 }, updatedAt: T2, ...extra } as never);
    const took = (extra: Record<string, unknown>) => row('G', { revisedFromTaskIds: ['F'], priority: 'Low', prioritySetByHand: { priority: 'Low', at: T1 }, textFromTask: { taskId: 'F', priority: 'Low' }, updatedAt: T3, ...extra } as never);
    it('set on the old row after the priority the new row took (the new row stamped later for something else): it follows, with its mark', async () => {
      const out = merged([P({}), took({})]);
      expect([of(out, 'G').priority, of(out, 'G').prioritySetByHand]).toEqual(['High', { priority: 'High', at: T2 }]);
    });
    it('set on the new row later: it stands', async () => {
      expect(of(merged([P({}), took({ prioritySetByHand: { priority: 'Low', at: T4 } })]), 'G').priority).toBe('Low');
    });
    it('the old row\'s priority has no mark (set on Build 230): by the stamps, as today', async () => {
      expect(of(merged([P({ prioritySetByHand: undefined, priorityAsImported: 'Medium' }), took({})]), 'G').priority).toBe('Low');
    });
  });
});

describe('Way 2, step 1: the carry by field, between two devices and the web', () => {
  const OLD_ROW = 'MASTER F-1';
  const NEW_ROW = 'MASTER G-1';
  const WEB_NOTE = 'Rebar inspection booked (typed on the web)';
  const places = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()]
    .map(shown => framingOf(shown).map(item => ({ row: item.id, owner: item.owner || '', note: item.notes || '', percent: item.percentComplete })));
  const heardEverywhere = async (phone: Device, ipad: Device) => { shareDocuments(phone); await backgroundUpload(phone); await settle(phone, ipad); };
  /** Master G approved and heard, then master F made current again and heard: the web shows F's row. Then the iPad loses signal. */
  async function fCurrentAgain() {
    const { phone, ipad } = await start();
    at(G.importedAt!); await approve(phone, G, [G_ROW, SURVEY]); await heardEverywhere(phone, ipad);
    at('2026-09-11T08:00:00.000Z'); await setActiveOn(phone, F); await heardEverywhere(phone, ipad);
    expect(places(phone, ipad).map(place => place[0]?.row)).toEqual(Array(3).fill(OLD_ROW));
    setOnline(ipad, false);
    return { phone, ipad };
  }
  async function everythingSyncs(phone: Device, ipad: Device) {
    at('2026-09-13T08:00:00.000Z');
    setOnline(ipad, true); shareDocuments(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
  }

  it('decision 1: the web sets the owner on the row it still shows; the phone, not having heard, makes G current and enters a percent on the task: the owner is on the task in all three places', async () => {
    const { phone, ipad } = await fCurrentAgain();
    at('2026-09-12T12:00:00.000Z'); webWrite(webEdited(cloudRow(OLD_ROW)!, { owner: 'Ana' }));
    at('2026-09-12T18:00:00.000Z'); await setActiveOn(phone, G); shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-12T19:00:00.000Z'); await edit(phone, NEW_ROW, { percentComplete: 40 }); await backgroundUpload(phone);
    await everythingSyncs(phone, ipad);
    // (By the stamps: the task's row was changed after the web's owner, so its blank stood and Ana stayed on the hidden row.)
    expect(places(phone, ipad)).toEqual(Array(3).fill([{ row: NEW_ROW, owner: 'Ana', note: '', percent: 40 }]));
  });

  it('decision 2: he types a note on the task and clears it; the other device then enters a percent on the row it still shows, where the web had typed a note earlier: his clear stands in all three places', async () => {
    const { phone, ipad } = await fCurrentAgain();
    at('2026-09-12T12:00:00.000Z'); webWrite(webEdited(cloudRow(OLD_ROW)!, { notes: WEB_NOTE }));
    at('2026-09-12T18:00:00.000Z'); await setActiveOn(phone, G); shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-12T18:30:00.000Z'); await edit(phone, NEW_ROW, { notes: PHONE_NOTE }); await backgroundUpload(phone);
    at('2026-09-12T18:35:00.000Z'); await edit(phone, NEW_ROW, { notes: '' }); await backgroundUpload(phone); await refresh(phone);
    expect(places(phone, ipad)[0]).toEqual([{ row: NEW_ROW, owner: '', note: '', percent: 0 }]);
    at('2026-09-12T19:00:00.000Z'); await edit(ipad, OLD_ROW, { percentComplete: 30 });
    await everythingSyncs(phone, ipad);
    // (By the stamps: the row the iPad's percent landed on read as "changed later", and the web's older note came back over his clear.)
    expect(places(phone, ipad).map(place => place.map(item => [item.row, item.note]))).toEqual(Array(3).fill([[NEW_ROW, '']]));
  });

  describe('seed 9179\'s shape: an owner set on the task, a card open for the other device\'s owner, and the web\'s later clear', () => {
    /**
     * The iPad, not having heard of G, sets Mike on the row it shows; the phone sets Bob on the task's new row; the
     * iPad gets signal (its Mike goes on to the task and is asked about over Bob); the web then clears the owner.
     * With `stampedAfter`, the iPad then enters a percent on the row it showed, which stamps that row after the clear.
     */
    async function run(stampedAfter: boolean) {
      const { phone, ipad } = await start();
      setOnline(ipad, false);
      at(G.importedAt!); await approve(phone, G, [G_ROW, SURVEY]); shareDocuments(phone); await backgroundUpload(phone);
      at('2026-09-11T09:00:00.000Z'); await edit(ipad, OLD_ROW, { owner: 'Mike' });
      at('2026-09-11T10:00:00.000Z'); await edit(phone, NEW_ROW, { owner: 'Bob' }); await backgroundUpload(phone);
      at('2026-09-11T10:30:00.000Z'); setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad);
      at('2026-09-11T11:00:00.000Z'); webWrite(webEdited(cloudRow(NEW_ROW)!, { owner: '' }));
      if (stampedAfter) { at('2026-09-11T12:00:00.000Z'); webWrite(webEdited(cloudRow(OLD_ROW)!, { percentComplete: '30' })); }
      at('2026-09-11T13:00:00.000Z');
      await settle(phone, ipad); await refresh(phone); await refresh(ipad);
      return { phone, ipad };
    }
    it('the web\'s clear stands in all three places', async () => {
      const { phone, ipad } = await run(false);
      expect(places(phone, ipad).map(place => place.map(item => [item.row, item.owner]))).toEqual(Array(3).fill([[NEW_ROW, '']]));
    });
    it('and still when the row the iPad showed is stamped after the clear for something else', async () => {
      const { phone, ipad } = await run(true);
      expect(places(phone, ipad).map(place => place.map(item => [item.row, item.owner]))).toEqual(Array(3).fill([[NEW_ROW, '']]));
    });
  });
});

describe('Way 2, step 1: the mark is left by his edit and goes wherever its field goes', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, taskName: 'Framing', owner: '', contractor: '', notes: '', nextAction: '', milestone: '', ...extra }) as unknown as ScheduleItem;
  const T1 = '2026-09-08T09:00:00.000Z', T2 = '2026-09-09T09:00:00.000Z', T3 = '2026-09-10T09:00:00.000Z';
  const typed = (text: string, at: string) => ({ text, at });

  it('the phone\'s and the iPad\'s edit leaves a mark for each such field it changes, a clear included, and is still text only', () => {
    const edited = withProjectControlsEditMerged(row('G', { owner: 'Mike' }), { owner: '', notes: '' });
    expect(edited).toEqual({ owner: '', notes: '', ownerSetByHand: { text: '', at: expect.any(String) } });
    expect(scheduleItemChangeUsesDebouncedSync(withProjectControlsEditMerged(row('G'), { notes: NOTE }))).toBe(true);
  });

  it('his edit sent on from the replaced row takes its mark with it; one made on an older build brings none', () => {
    const typedOn = row('F', { owner: 'Mike', ownerSetByHand: typed('Mike', T2), updatedAt: T2 });
    const task = row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', owner: '' } });
    const sent = scheduleItemTextEditOnRow({ id: 'F', itemData: typedOn, changedFields: ['owner', 'ownerSetByHand', 'updatedAt'], base: { updatedAt: T1, fields: { owner: '', ownerSetByHand: null } } },
      ['owner', 'ownerSetByHand', 'updatedAt'], task);
    expect([sent!.itemData.owner, sent!.itemData.ownerSetByHand, sent!.changedFields]).toEqual(['Mike', typed('Mike', T2), ['owner', 'ownerSetByHand', 'updatedAt']]);
    const older = scheduleItemTextEditOnRow({ id: 'F', itemData: { ...typedOn, ownerSetByHand: typed('Bob', T1) }, changedFields: ['owner', 'updatedAt'], base: { updatedAt: T1, fields: { owner: '' } } },
      ['owner', 'updatedAt'], task);
    expect([older!.itemData.owner, older!.itemData.ownerSetByHand ?? null, older!.changedFields]).toEqual(['Mike', null, ['owner', 'updatedAt']]);
  });

  it('a whole copy weighed against the cloud\'s row: each field\'s mark comes from the copy its text comes from', () => {
    const was = row('G');
    const local = row('G', { owner: 'Mike', ownerSetByHand: typed('Mike', T2) });
    const remote = row('G', { notes: NOTE, notesSetByHand: typed(NOTE, T3) });
    const out = scheduleItemWholeCopyAgainstCloud(local, local, scheduleItemWholeCopyBase(was), remote).itemData;
    expect([out.owner, out.ownerSetByHand, out.notes, out.notesSetByHand]).toEqual(['Mike', typed('Mike', T2), NOTE, typed(NOTE, T3)]);
  });
});

/**
 * Open item 2.41 (W2-1 of the review of Way 2; Medium for Build 233, older: Build 232 had it on the approval's road).
 * Review Conflicts' Keep Phone on a card that a WHOLE copy of the task made (his edit with no signal, then the lookahead
 * that moved the task deleted with its items, or a second lookahead approved: one whole copy since Way 2's item 1) kept
 * his value but left the other device's mark beside it (the priority's "set by hand, when"; since Way 2 also the five
 * typed fields'). His Medium then read as not his, and the next master turned it High everywhere with no question.
 * Now each field's mark comes from the copy its value came from, for Keep Phone as for Keep Cloud.
 */
describe('Open item 2.41: after Review Conflicts, each field\'s mark of who set it comes from the copy its value came from', () => {
  const { LOOK, underTheLookahead, heardEverywhere } = ITEM_1C;
  const FIELDS = {
    priority: ['prioritySetByHand', 'Low', 'High'],
    owner: ['ownerSetByHand', 'Bob', 'Ana'],
    contractor: ['contractorSetByHand', 'Acme Framing', 'Best Framing'],
    notes: ['notesSetByHand', 'Crew short Tuesday', 'Pour moved to Wednesday'],
    nextAction: ['nextActionSetByHand', 'Call the inspector', 'Order the trusses'],
    milestone: ['milestoneSetByHand', 'Dry-in', 'Topping out'],
  } as const;
  type Field = keyof typeof FIELDS;
  type Who = 'phone' | 'ipad';
  type Road = 'his edit alone' | 'his edit, then the lookahead deleted' | 'his edit, then a second lookahead approved';
  const PHONE_AT = '2026-09-10T09:00:00.000Z', IPAD_AT = '2026-09-10T09:30:00.000Z';
  const DATES: Record<Road, string> = {
    'his edit alone': '10/18/2026 - 10/28/2026', 'his edit, then the lookahead deleted': '10/15/2026 - 10/25/2026',
    'his edit, then a second lookahead approved': '10/19/2026 - 10/29/2026',
  };
  const valueOf = (field: Field, who: Who) => FIELDS[field][who === 'phone' ? 1 : 2];
  /** A field's value and its mark (what the mark names, and when), as a place holds them. */
  const held = (item: ScheduleItem | undefined, field: Field) => {
    const record = (item ?? {}) as unknown as Record<string, unknown>;
    const mark = record[FIELDS[field][0]] as { priority?: string; text?: string; at?: string } | null | undefined;
    return { value: record[field] ?? null, mark: mark ? { names: mark.priority ?? mark.text ?? null, at: mark.at ?? null } : null };
  };
  const his = (field: Field, who: Who, markAt = who === 'phone' ? PHONE_AT : IPAD_AT) => ({ value: valueOf(field, who), mark: { names: valueOf(field, who), at: markAt } });
  /** The phone, the iPad and the computer. */
  const shownRows = (phone: Device, ipad: Device) => [theRow(phone), theRow(ipad), framingOf(webShown())[0]];

  /**
   * Framing is under the lookahead everywhere. The phone, with no signal, sets `set('phone')` (then, on a whole copy's
   * road, deletes that lookahead with its items or approves a second one); the iPad sets `set('ipad')` and it goes up
   * (its clock `ipadAhead` minutes ahead). The phone gets signal; Review Conflicts asks; he chooses; everything syncs.
   */
  async function chosen(set: (who: Who) => Partial<ScheduleItem>, road: Road, choice: 'keep_local' | 'keep_cloud',
    { ipadAhead = 0, beforeChoice }: { ipadAhead?: number; beforeChoice?: (phone: Device) => void } = {}) {
    const { phone, ipad } = await underTheLookahead();
    const id = theRow(phone).id;
    setOnline(phone, false);
    at(PHONE_AT); await edit(phone, id, set('phone'));
    if (road === 'his edit, then the lookahead deleted') { at('2026-09-10T09:10:00.000Z'); await deleteWithItems(phone, LOOK); }
    if (road === 'his edit, then a second lookahead approved') {
      const L2 = scheduleDoc('LOOKAHEAD RVK3', '2026-09-10T09:10:00.000Z', 'lookahead');
      at(L2.importedAt!); await approve(phone, L2, ['Framing,Alpha,Lot,10/19/2026,10/29/2026,'], true);
    }
    at(IPAD_AT); if (ipadAhead) jest.setSystemTime(Date.now() + ipadAhead * 60_000);
    await edit(ipad, id, set('ipad')); await backgroundUpload(ipad);
    at('2026-09-10T10:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    await settle(phone, ipad);
    const cards = await conflictsOf(phone);
    const asked = cards.map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields ?? null);
    beforeChoice?.(phone);
    for (const conflict of cards) await chooseInSettings(phone, conflict.id, choice);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    const after = {
      asked, dates: shownRows(phone, ipad).map(item => (item ? `${item.startDate} - ${item.finishDate}` : null)),
      cards: [(await conflictsOf(phone)).length, (await conflictsOf(ipad)).length], waiting: [(await queueOf(phone)).length, (await queueOf(ipad)).length],
    };
    return { phone, ipad, after };
  }
  const settledAs = (road: Road, field: string) => ({ asked: [[field]], dates: Array(3).fill(DATES[road]), cards: [0, 0], waiting: [0, 0] });

  const CASES: Array<[Field, Road, 'keep_local' | 'keep_cloud']> = [];
  for (const field of Object.keys(FIELDS) as Field[]) {
    for (const road of Object.keys(DATES) as Road[]) for (const choice of ['keep_local', 'keep_cloud'] as const) CASES.push([field, road, choice]);
  }
  it.each(CASES)('K / K3, %s: %s; the iPad sets it too; %s leaves that copy\'s value AND that copy\'s mark on the phone, the iPad and the computer', async (field, road, choice) => {
    const { phone, ipad, after } = await chosen(who => ({ [field]: valueOf(field, who) }) as Partial<ScheduleItem>, road, choice);
    expect(after).toEqual(settledAs(road, field));
    // (It was, on a whole copy's road with Keep Phone: his value with the iPad's mark beside it, in all three places.)
    expect(shownRows(phone, ipad).map(item => held(item, field))).toEqual(Array(3).fill(his(field, choice === 'keep_local' ? 'phone' : 'ipad')));
  });

  it.each(['keep_local', 'keep_cloud'] as const)('K, seed 7749\'s clock (the iPad 2.5 h ahead), the priority on a whole copy\'s card, %s: the value and its mark from the same copy', async choice => {
    const { phone, ipad, after } = await chosen(who => ({ priority: valueOf('priority', who) }) as Partial<ScheduleItem>, 'his edit, then the lookahead deleted', choice, { ipadAhead: 150 });
    expect(after).toEqual(settledAs('his edit, then the lookahead deleted', 'priority'));
    expect(shownRows(phone, ipad).map(item => held(item, 'priority')))
      .toEqual(Array(3).fill(choice === 'keep_local' ? his('priority', 'phone') : his('priority', 'ipad', '2026-09-10T12:00:00.000Z')));
  });

  it.each(['keep_local', 'keep_cloud'] as const)('his hand links on a whole copy\'s card, %s: the links and their stamp come from the same copy', async choice => {
    const link = (lagDays: number) => [{ predecessorItemId: 'MASTER F-2', type: 'FS' as const, lagDays }];
    const { phone, ipad, after } = await chosen(who => ({ dependencies: link(who === 'phone' ? 0 : 3), dependenciesUpdatedAt: who === 'phone' ? PHONE_AT : IPAD_AT }) as Partial<ScheduleItem>,
      'his edit, then the lookahead deleted', choice);
    expect(after).toEqual(settledAs('his edit, then the lookahead deleted', 'dependencies'));
    expect(shownRows(phone, ipad).map(item => ({ lags: (item?.dependencies ?? []).map(entry => entry.lagDays), stamp: item?.dependenciesUpdatedAt ?? null })))
      .toEqual(Array(3).fill(choice === 'keep_local' ? { lags: [0], stamp: PHONE_AT } : { lags: [3], stamp: IPAD_AT }));
  });

  it('a card saved before Way 2 (his copy holds no mark of his typing): Keep Phone leaves his text and the row\'s mark as it was, as before (it cannot say whose the text is)', async () => {
    const { phone, ipad, after } = await chosen(who => ({ owner: valueOf('owner', who) }), 'his edit, then the lookahead deleted', 'keep_local', {
      beforeChoice: device => {
        const store = mockStores.get(device.name)!;
        const cards = JSON.parse(store.get('projectVisionAI.syncConflicts.v1')!) as Array<{ localPayload?: { itemData?: Record<string, unknown> } }>;
        cards.forEach(card => { delete card.localPayload?.itemData?.ownerSetByHand; });
        store.set('projectVisionAI.syncConflicts.v1', JSON.stringify(cards));
      },
    });
    expect(after).toEqual(settledAs('his edit, then the lookahead deleted', 'owner'));
    expect(shownRows(phone, ipad).map(item => held(item, 'owner'))).toEqual(Array(3).fill({ value: 'Bob', mark: { names: 'Ana', at: IPAD_AT } }));
  });

  it.each([[true], [false]] as const)('K2: his Medium kept by Keep Phone (the lookahead deleted with no signal too: %s); a new master then moves Framing to finish within the week: Medium stays, his, everywhere, with no question', async withDelete => {
    const { phone, ipad } = await underTheLookahead();
    const id = theRow(phone).id;
    at('2026-09-09T13:00:00.000Z'); await edit(phone, id, { priority: 'Low' }); await heardEverywhere(phone, ipad);
    setOnline(phone, false);
    at(PHONE_AT); await edit(phone, id, { priority: 'Medium' });
    if (withDelete) { at('2026-09-10T09:10:00.000Z'); await deleteWithItems(phone, LOOK); }
    at(IPAD_AT); await edit(ipad, id, { priority: 'High' }); await backgroundUpload(ipad);
    at('2026-09-10T10:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
    await settle(phone, ipad);
    const cards = await conflictsOf(phone);
    expect(cards.map(conflict => (conflict.localPayload as { askedFields?: string[] }).askedFields)).toEqual([['priority']]);
    for (const conflict of cards) await chooseInSettings(phone, conflict.id, 'keep_local');
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    const mediumHis = { value: 'Medium', mark: { names: 'Medium', at: PHONE_AT } };
    expect(shownRows(phone, ipad).map(item => held(item, 'priority'))).toEqual(Array(3).fill(mediumHis));
    const GH = scheduleDoc('MASTER GH', '2026-09-11T12:00:00.000Z');
    at(GH.importedAt!); await approve(phone, GH, ['Framing,Alpha,Lot,09/12/2026,09/16/2026,', SURVEY]); await heardEverywhere(phone, ipad);
    await refresh(phone); await refresh(ipad);
    // (It was, with the delete: High in all three places, the file's, with no question.)
    expect({ places: shownRows(phone, ipad).map(item => held(item, 'priority')), cards: [(await conflictsOf(phone)).length, (await conflictsOf(ipad)).length] })
      .toEqual({ places: Array(3).fill(mediumHis), cards: [0, 0] });
  });
});

/**
 * Way 2, step 2, part B: open item 2.49 (review pass 1 of Way 2 step 1, finding 2; Medium, older: the same on Build 232).
 * A schedule FILE can fill a task's owner, contractor, note or milestone itself (an Owner, Notes or Milestone column).
 * The new row a master makes then takes nothing for that field from the row it replaces, so it keeps no record of it
 * (textFromTask has no entry: the file's value is not his to follow). He clears that field on the task. Later the old
 * row, still holding its own file's value, is stamped by something else (a percent the other device enters on the row
 * it still shows; a lookahead's delete giving it dates back). The carry by field asked every older row when he typed
 * the field there, heard "not typed since it was made" from each, and then fell back to the rows' stamps: the old
 * file's value came back over his clear, once per such stamp.
 * Now: when this row says when he set the field here and every older row says it was not typed there since it was
 * made, nothing of his is newer than his own word here, and it stands (his clear included). A row that cannot say
 * (made by an older build, or typed on by one) keeps the rule by the stamps, as before.
 */
describe('Way 2, step 2 (2.49): a value he cleared on a field the new schedule file itself fills stays cleared', () => {
  const T1 = '2026-09-08T09:00:00.000Z', T2 = '2026-09-09T09:00:00.000Z', T3 = '2026-09-10T09:00:00.000Z';
  const TYPED = ['owner', 'contractor', 'notes', 'nextAction', 'milestone'] as const;
  type Typed = typeof TYPED[number];
  const markOf = (field: Typed) => `${field}SetByHand`;

  describe('on the records alone', () => {
    const row = (id: string, extra: Record<string, unknown> = {}) => ({
      id, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '',
      owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', createdAt: '2026-09-07T12:00:00.000Z',
      importedAt: '2026-09-07T12:00:00.000Z', ...extra,
    }) as unknown as ScheduleItem;
    const merged = (rows: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: rows, cloud: rows, deletedIds: [], allowCloudOnly: true });
    const of = (rows: ScheduleItem[], id: string) => rows.find(item => item.id === id)!;
    const madeWith = (text: Record<string, string> = {}) => ({ textAsMade: { owner: '', contractor: '', notes: '', nextAction: '', milestone: '', ...text } });
    /** F's row as its own file made it, the field holding F's file's value; `extra` on top. */
    const oldRow = (field: Typed, extra: Record<string, unknown> = {}) => row('F', { [field]: 'Ann (file F)', ...madeWith({ [field]: 'Ann (file F)' }), updatedAt: T3, ...extra });
    /** G's row: made by a newer file that states the field (so no entry for it in what G took from F), then cleared by him at T2. */
    const clearedOnTheNewRow = (field: Typed, extra: Record<string, unknown> = {}) => row('G', {
      revisedFromTaskIds: ['F'], [field]: '', textFromTask: { taskId: 'F', ...Object.fromEntries(TYPED.filter(other => other !== field).map(other => [other, ''])) },
      ...madeWith({ [field]: 'Ben (file G)' }), [markOf(field)]: { text: '', at: T2 }, updatedAt: T2, ...extra,
    });

    it.each(['owner', 'contractor', 'notes', 'milestone'] as const)(
      '%s: the old row holds its own file\'s value and is stamped after his clear for something else: his clear stands (the reviewer\'s R1, R1b)', field => {
        // (It was: "Ann (file F)" back on the task, by the stamps.)
        expect(of(merged([oldRow(field), clearedOnTheNewRow(field)]), 'G')[field]).toBe('');
      });
    it('typed on the old row AFTER his clear: that later word follows the task, as before', () => {
      const out = merged([oldRow('owner', { owner: 'Ann', ownerSetByHand: { text: 'Ann', at: T3 } }), clearedOnTheNewRow('owner')]);
      expect(of(out, 'G').owner).toBe('Ann');
    });
    it('typed on the old row BEFORE his clear: his clear stands, as before', () => {
      const out = merged([oldRow('owner', { owner: 'Ann', ownerSetByHand: { text: 'Ann', at: T1 } }), clearedOnTheNewRow('owner')]);
      expect(of(out, 'G').owner).toBe('');
    });
    it('the old row cannot say (its text is not what it was made with and has no mark: typed by an older build): by the stamps, as before', () => {
      const out = merged([oldRow('owner', { owner: 'Ann' }), clearedOnTheNewRow('owner')]);
      expect(of(out, 'G').owner).toBe('Ann');
    });
    it('the new row cannot say (made by an older build: nothing says what it was made with, no mark): by the stamps, as before', () => {
      const out = merged([oldRow('owner'), clearedOnTheNewRow('owner', { textAsMade: undefined, ownerSetByHand: undefined })]);
      expect(of(out, 'G').owner).toBe('Ann (file F)');
    });
  });

  describe('between two devices and the web, with schedules that have an Owner column', () => {
    const OLD_ROW = 'MASTER F-1';
    const NEW_ROW = 'MASTER G-1';
    const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete,Owner';
    const SURVEY_NO_OWNER = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,,';
    const places = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()]
      .map(shown => framingOf(shown).map(item => [item.id, item.owner || '']));

    it.each(['the phone', 'the web'] as const)(
      'both files give Framing an owner; %s clears the owner on the task; the iPad, not having heard of the new master, enters a percent on the row it shows: the clear stands in all three places, nothing asked', async who => {
        at('2026-09-07T12:00:00.000Z');
        const { phone, ipad } = await startBoth(F, [HEADER, 'Framing,Alpha,Lot,10/15/2026,10/25/2026,,Ann', SURVEY_NO_OWNER]);
        expect(places(phone, ipad)).toEqual(Array(3).fill([[OLD_ROW, 'Ann']]));
        setOnline(ipad, false);
        at(G.importedAt!); await approve(phone, G, [HEADER, 'Framing,Alpha,Lot,10/20/2026,10/30/2026,,Ben', SURVEY_NO_OWNER]);
        shareDocuments(phone); await backgroundUpload(phone);
        at('2026-09-11T09:00:00.000Z');
        if (who === 'the phone') { await edit(phone, NEW_ROW, { owner: '' }); await backgroundUpload(phone); } else webWrite(webEdited(cloudRow(NEW_ROW)!, { owner: '' }));
        at('2026-09-11T10:00:00.000Z'); await edit(ipad, OLD_ROW, { percentComplete: 30 });
        at('2026-09-12T08:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad);
        await settle(phone, ipad); await refresh(phone); await refresh(ipad);
        // (It was: "Ann", the old file's owner, back on the task in all three places.)
        expect(places(phone, ipad)).toEqual(Array(3).fill([[NEW_ROW, '']]));
        expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
      });
  });
});

/**
 * Way 2, step 2, part C. Set Active (phone and iPad), Make Current (web) and a schedule's delete show another row of
 * a task and bring across what he set on the row they hide (scheduleItemAsLastSetOnItsOtherRow). Where a field he
 * types was changed on BOTH rows since one took it from the other, nothing is asked there: the row changed last won,
 * by the rows' stamps. So did a blank on the row shown that keeps no record of the field. A row is stamped by much
 * that is not his typing (a percent, a lookahead), so his later word could lose to his earlier one, with no card.
 * Now, as in the carry between rows (Way 2 step 1, and part B): where both rows say when he typed the field there
 * (their marks; a row not typed in it since it was made says "never"), his later typing stands; where either cannot
 * say (made or typed by an older build), the rows' stamps decide, as before. The priority already went by its marks.
 */
describe('Way 2, step 2, part C: Set Active and Make Current weigh a field changed on both rows by his typing, not by the rows\' last change', () => {
  const T1 = '2026-09-08T09:00:00.000Z', T2 = '2026-09-09T09:00:00.000Z', T3 = '2026-09-10T09:00:00.000Z', NOW = '2026-09-11T09:00:00.000Z';
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id, taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '',
    owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', createdAt: '2026-09-07T12:00:00.000Z',
    importedAt: '2026-09-07T12:00:00.000Z', textAsMade: { owner: '', contractor: '', notes: '', nextAction: '', milestone: '' }, ...extra,
  }) as unknown as ScheduleItem;
  const typed = (text: string, at: string) => ({ text, at });
  /** G replaced F and took a blank owner and note from it. */
  const g = (extra: Record<string, unknown>) => row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', owner: '', notes: '' }, ...extra });
  /** The row shown after the change: the function's answer, or the row as it was when nothing differs. */
  const shownAfter = (hidden: ScheduleItem, shown: ScheduleItem) => scheduleItemAsLastSetOnItsOtherRow(hidden, shown, shown, NOW) ?? shown;

  describe('on the records alone', () => {
    it('Make Current / Set Active forward: typed on the old row, then later on the new row; the old row stamped after both for something else: the new row\'s later owner stands', () => {
      const F_ = row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T1), updatedAt: T3 });
      const G_ = g({ owner: 'Bob', ownerSetByHand: typed('Bob', T2), updatedAt: T2 });
      // (It was: Ana, the earlier word, because the old row was stamped last.)
      expect(shownAfter(F_, G_).owner).toBe('Bob');
    });
    it('the same the other way: typed on the new row, then later on the old row (the web on a master made current again); the new row stamped after both: the old row\'s later owner shows', () => {
      const F_ = row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 });
      const G_ = g({ owner: 'Bob', ownerSetByHand: typed('Bob', T1), updatedAt: T3 });
      expect(shownAfter(F_, G_).owner).toBe('Ana');
    });
    it('Set Active back to the older master: typed on the new row, then later on the old row; the new row stamped after both: the old row keeps his later owner', () => {
      const F_ = row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T2), updatedAt: T2 });
      const G_ = g({ owner: 'Bob', ownerSetByHand: typed('Bob', T1), updatedAt: T3 });
      // (It was: Bob, the earlier word, because the new row was stamped last.)
      expect(shownAfter(G_, F_).owner).toBe('Ana');
    });
    it('a note cleared on the row shown that keeps no record of it (its file states notes), the hidden row holding its own file\'s note and stamped later: the clear stands', () => {
      const F_ = row('F', { notes: 'Note of file F', textAsMade: { owner: '', contractor: '', notes: 'Note of file F', nextAction: '', milestone: '' }, updatedAt: T3 });
      const G_ = row('G', { revisedFromTaskIds: ['F'], textFromTask: { taskId: 'F', owner: '' }, textAsMade: { owner: '', contractor: '', notes: 'Note of file G', nextAction: '', milestone: '' },
        notesSetByHand: typed('', T2), updatedAt: T2 });
      // (It was: the old file's note back over his clear.)
      expect(shownAfter(F_, G_).notes).toBe('');
    });
    it('guards, as before: rows that cannot say (no marks, made by an older build) go by the stamps; a field changed on one row only follows', () => {
      const old = (extra: Record<string, unknown>) => row('F', { textAsMade: undefined, ...extra });
      const neu = (extra: Record<string, unknown>) => g({ textAsMade: undefined, ...extra });
      expect(shownAfter(old({ owner: 'Ana', updatedAt: T3 }), neu({ owner: 'Bob', updatedAt: T2 })).owner).toBe('Ana');
      expect(shownAfter(old({ owner: 'Ana', updatedAt: T1 }), neu({ owner: 'Bob', updatedAt: T2 })).owner).toBe('Bob');
      expect(shownAfter(row('F', { owner: 'Ana', ownerSetByHand: typed('Ana', T1), updatedAt: T1 }), g({ updatedAt: T3 })).owner).toBe('Ana');
    });
  });

  it('two devices and the web: he sets Bob on the task, makes the older master current, types Ana on the web; the iPad, not having heard, enters a percent on the newer row; he makes the newer master current again: Ana in all three places, nothing asked', async () => {
    const OLD_ROW = 'MASTER F-1';
    const NEW_ROW = 'MASTER G-1';
    const places = (phone: Device, ipad: Device) => [deviceShown(phone), deviceShown(ipad), webShown()].map(shown => framingOf(shown).map(item => [item.id, item.owner || '']));
    const { phone, ipad } = await start();
    at(G.importedAt!); await approve(phone, G, [G_ROW, SURVEY]); shareDocuments(phone); await backgroundUpload(phone); await settle(phone, ipad);
    at('2026-09-11T08:00:00.000Z'); await edit(phone, NEW_ROW, { owner: 'Bob' }); await backgroundUpload(phone); await settle(phone, ipad);
    setOnline(ipad, false);
    at('2026-09-11T09:00:00.000Z'); await setActiveOn(phone, F); shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-11T10:00:00.000Z'); webWrite(webEdited(cloudRow(OLD_ROW)!, { owner: 'Ana' }));
    at('2026-09-11T11:00:00.000Z'); await edit(ipad, NEW_ROW, { percentComplete: 30 });
    at('2026-09-11T12:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    at('2026-09-11T13:00:00.000Z'); await setActiveOn(phone, G); shareDocuments(phone); await backgroundUpload(phone);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    // (It was: Bob, his earlier word, in all three places: the iPad's percent had stamped the newer row last.)
    expect(places(phone, ipad)).toEqual(Array(3).fill([[NEW_ROW, 'Ana']]));
    expect([await conflictsOf(phone), await conflictsOf(ipad)]).toEqual([[], []]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Way 2, step 2b, part E (open item 2.52, 14 Oct 2026; older: on Build 232 with the note already sent, and with the
 * returned item 1 also while it waits; the generator's seed 6248). An activity note added on one device was gone from
 * every device once the other device's whole copy of the task went up: a whole copy (a schedule approved, a
 * lookahead deleted, a percent carried) that meets a cloud row changed elsewhere in something only the sync merge can
 * order (two lookaheads approved apart: each changed the lookahead's note) goes the merge's way, and the merge kept
 * ONE copy's activity list, the one it ranked first. Notes are only ever added (no screen removes one), so the copy
 * that goes up now keeps the notes of both, each once (by its id), in the order of their dates.
 */
describe('Way 2, step 2b, part E (2.52): an activity note is kept when a whole copy of the task goes up by the sync merge\'s rules', () => {
  /** A note both devices heard before anything else happened: it is on both copies, and must end once. */
  const HEARD = { id: 'act-heard', message: 'Forms ordered', author: 'David', createdAt: '2026-09-09T16:00:00.000Z' };
  const NEW = { id: 'act-new', message: 'Rebar checked', author: 'David', createdAt: '2026-09-10T09:00:00.000Z' };
  const L1 = scheduleDoc('LOOKAHEAD E1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const notesIn = (items: readonly ScheduleItem[]) => framingOf(items).map(item => (item.activity ?? []).map(entry => entry.id));
  const places = (phone: Device, ipad: Device) => [notesIn(deviceShown(phone)), notesIn(deviceShown(ipad)), notesIn(webShown())];
  const heardEverywhere = async (device: Device, other: Device) => { shareDocuments(device); await backgroundUpload(device); await settle(device, other); };
  const addNote = (device: Device, entry: typeof NEW) => edit(device, theRow(device).id, { activity: [...(theRow(device).activity ?? []), entry] } as Partial<ScheduleItem>);
  const nothingAskedOrWaiting = async (phone: Device, ipad: Device) =>
    expect([(await conflictsOf(phone)).length, (await conflictsOf(ipad)).length, (await queueOf(phone)).length, (await queueOf(ipad)).length]).toEqual([0, 0, 0, 0]);

  it.each([
    ['his note added on the phone and sent; the iPad, with no signal, approves its own lookahead for the task after the phone approved one', 'phone'],
    ['his note added on the iPad with no signal, then the iPad approves its own lookahead; the phone approves one later', 'ipad'],
  ] as const)('two lookaheads approved apart on two devices, %s: his note is on the task in all three places, and the note both had is there once', async (_label, noteOn) => {
    const { phone, ipad } = await start();
    at(L1.importedAt!); await approve(phone, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
    at(HEARD.createdAt); await addNote(phone, HEARD); await heardEverywhere(phone, ipad);
    setOnline(ipad, false);
    const onPhone = scheduleDoc('LOOKAHEAD E-PHONE', noteOn === 'phone' ? '2026-09-10T10:00:00.000Z' : '2026-09-10T11:00:00.000Z', 'lookahead');
    const onIpad = scheduleDoc('LOOKAHEAD E-IPAD', noteOn === 'phone' ? '2026-09-10T11:00:00.000Z' : '2026-09-10T10:00:00.000Z', 'lookahead');
    at(NEW.createdAt);
    if (noteOn === 'phone') { await addNote(phone, NEW); await backgroundUpload(phone); } else await addNote(ipad, NEW);
    const phoneApproves = async () => { at(onPhone.importedAt!); await approve(phone, onPhone, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true); shareDocuments(phone); await backgroundUpload(phone); };
    const ipadApproves = async () => { at(onIpad.importedAt!); await approve(ipad, onIpad, ['Framing,Alpha,Lot,10/21/2026,10/31/2026,'], true); };
    if (noteOn === 'phone') { await phoneApproves(); await ipadApproves(); } else { await ipadApproves(); await phoneApproves(); }
    at('2026-09-10T13:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    // (It was: ['act-heard'] in all three places: the copy the merge ranked first had not heard of his note.)
    expect(places(phone, ipad)).toEqual(Array(3).fill([['act-heard', 'act-new']]));
    await nothingAskedOrWaiting(phone, ipad);
  });

  /** Seed 6248's shape: two lookaheads list the task; the phone adds a note and deletes the first; the iPad, not having heard, deletes the second. */
  async function twoDeletes(noteConfirmed: boolean) {
    const LA = scheduleDoc('LOOKAHEAD E6248 A', '2026-09-09T12:00:00.000Z', 'lookahead');
    const LB = scheduleDoc('LOOKAHEAD E6248 B', '2026-09-09T14:00:00.000Z', 'lookahead');
    const { phone, ipad } = await start();
    at(LA.importedAt!); await approve(phone, LA, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
    at(LB.importedAt!); await approve(phone, LB, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
    at(HEARD.createdAt); await addNote(phone, HEARD); await heardEverywhere(phone, ipad);
    setOnline(ipad, false);
    at(NEW.createdAt);
    if (!noteConfirmed) setOnline(phone, false);
    await addNote(phone, NEW);
    if (noteConfirmed) await backgroundUpload(phone);
    at('2026-09-10T10:00:00.000Z'); await deleteWithItems(phone, LA);
    at('2026-09-10T11:00:00.000Z'); setOnline(phone, true); shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-10T12:00:00.000Z'); await deleteWithItems(ipad, LB);
    at('2026-09-10T13:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    return { phone, ipad };
  }
  it.each([['sent before the delete', true], ['added and the delete made with no signal', false]] as const)(
    'seed 6248\'s shape, his note %s: it is on the task in all three places, once', async (_label, confirmed) => {
      const { phone, ipad } = await twoDeletes(confirmed);
      // (It was: ['act-heard'] in all three places, his note gone with no card.)
      expect(places(phone, ipad)).toEqual(Array(3).fill([['act-heard', 'act-new']]));
      await nothingAskedOrWaiting(phone, ipad);
    });

  /**
   * Step 2's probe X15, kept: ONE lookahead lists the task, his note waits on the phone in each way a write can wait,
   * and he deletes the lookahead with its items. Green on the base too (step 2's item 1 gave it), kept as a guard.
   */
  it.each([
    'sent before the delete', 'added with no signal, and the delete with no signal too', 'added with no signal, signal back, the delete before the automatic send',
    'sent, and the write never reached the cloud', 'sent and written in the cloud, and the answer was lost',
  ])('one lookahead, his note %s, then the lookahead deleted with its items: the note in all three places, on the master\'s dates', async how => {
    for (const rows of [['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], ['Framing,Alpha,Lot,10/18/2026,10/28/2026,70', 'Survey,Alpha,Lot,10/13/2026,10/16/2026,']]) {
      const { phone, ipad } = await start();
      at(L1.importedAt!); await approve(phone, L1, rows, true); await heardEverywhere(phone, ipad);
      const id = theRow(phone).id;
      at(NEW.createdAt);
      const note = () => addNote(phone, NEW);
      if (how === 'sent before the delete') { await note(); await backgroundUpload(phone); }
      else if (how === 'sent and written in the cloud, and the answer was lost') { mockCloud.lostAnswers = 1; await note(); mockCloud.lostAnswers = 0; }
      else if (how === 'sent, and the write never reached the cloud') { mockCloud.failNextWriteOf = id; await note(); mockCloud.failNextWriteOf = null; }
      else { setOnline(phone, false); await note(); if (how.includes('signal back')) setOnline(phone, true); }
      at('2026-09-10T12:00:00.000Z'); await deleteWithItems(phone, L1);
      if (isOnline(phone)) { shareDocuments(phone); await backgroundUpload(phone); }
      at('2026-09-10T15:00:00.000Z'); setOnline(phone, true); shareDocuments(phone);
      await settle(phone, ipad); await refresh(phone); await refresh(ipad);
      expect([rows.length, places(phone, ipad), [deviceShown(phone), deviceShown(ipad), webShown()].map(shown => framingOf(shown).map(item => `${item.startDate} - ${item.finishDate}`))])
        .toEqual([rows.length, Array(3).fill([['act-new']]), Array(3).fill(['10/15/2026 - 10/25/2026'])]);
      await nothingAskedOrWaiting(phone, ipad);
    }
  });

  it('the same note on both copies, and only there: each copy\'s note goes up once, nothing is written twice', async () => {
    // A note both devices hold, then the two lookaheads approved apart with no new note: the merge has nothing to add.
    const { phone, ipad } = await start();
    at(L1.importedAt!); await approve(phone, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
    at(HEARD.createdAt); await addNote(phone, HEARD); await heardEverywhere(phone, ipad);
    setOnline(ipad, false);
    at('2026-09-10T10:00:00.000Z'); await approve(phone, scheduleDoc('LOOKAHEAD E-P', '2026-09-10T10:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
    shareDocuments(phone); await backgroundUpload(phone);
    at('2026-09-10T11:00:00.000Z'); await approve(ipad, scheduleDoc('LOOKAHEAD E-I', '2026-09-10T11:00:00.000Z', 'lookahead'), ['Framing,Alpha,Lot,10/21/2026,10/31/2026,'], true);
    at('2026-09-10T13:00:00.000Z'); setOnline(ipad, true); shareDocuments(ipad); await backgroundUpload(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
    expect(places(phone, ipad)).toEqual(Array(3).fill([['act-heard']]));
    await nothingAskedOrWaiting(phone, ipad);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/**
 * Way 2, step 2b, part F (open item 2.53, 14 Oct 2026; older: the design note's "seen in passing", 2.13's family;
 * the returned item 1 moved its waiting case from nearly right to wrong). A lookahead moves Framing and every device
 * has heard it. The phone loses signal. On the iPad he approves a SECOND lookahead that moves Framing again (and may
 * state a percent). On the phone, which has not heard of it, he deletes the FIRST lookahead with its items. Once
 * everything had synced Framing was on the MASTER's dates in all three places, the second lookahead's dates and
 * percent gone, with no card, though that lookahead is still listed.
 *
 * Why: the delete's save is a whole copy of the task, put back as the phone knew it (the master's dates). The cloud's
 * row had meanwhile taken the second lookahead, so the two copies' lookahead notes both changed and the sync merge
 * took the later copy whole: the phone's.
 *
 * The rule now: a delete's put-back never goes over a lookahead, or any newer schedule, the deleting device had not
 * heard of. When the cloud's row has heard from a schedule the copy did not know (a lookahead added or taken off, a
 * master's dates or marks in the note), the delete is made again on the cloud's row by the delete's own rule, as one
 * device doing the steps in order makes it; what else the copy changed (his edit that waited, a note) is weighed as
 * before. Only where the copy's dates and percent are the delete's own (made on the copy it started from, the delete
 * gives exactly them); otherwise as before.
 */
describe('Way 2, step 2b, part F (2.53): a delete\'s put-back never goes over a schedule the deleting device had not heard of', () => {
  const LOOK = scheduleDoc('LOOKAHEAD F1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const LOOK2 = scheduleDoc('LOOKAHEAD F2 SECOND', '2026-09-10T10:00:00.000Z', 'lookahead');
  const lookaheadsOf = (item: ScheduleItem) => ((item as unknown as { lookaheadOverlay?: { lookaheads?: Array<{ batchId?: string }> } }).lookaheadOverlay?.lookaheads ?? []).map(entry => entry.batchId);
  const seen = (items: readonly ScheduleItem[]) => framingOf(items).map(item => ({
    dates: `${item.startDate} - ${item.finishDate}`, percent: item.percentComplete, owner: item.owner || '', lookaheads: lookaheadsOf(item),
    notes: (item.activity ?? []).map(entry => entry.id),
  }));
  const ending = async (phone: Device, ipad: Device) => ({
    places: [seen(deviceShown(phone)), seen(deviceShown(ipad)), seen(webShown())],
    cards: [(await conflictsOf(phone)).length, (await conflictsOf(ipad)).length], waiting: [(await queueOf(phone)).length, (await queueOf(ipad)).length],
  });
  const heardEverywhere = async (device: Device, other: Device) => { shareDocuments(device); await backgroundUpload(device); await settle(device, other); };
  const everythingSyncs = async (phone: Device, ipad: Device) => {
    setOnline(phone, true); shareDocuments(phone); setOnline(ipad, true); shareDocuments(ipad);
    await settle(phone, ipad); await refresh(phone); await refresh(ipad);
  };
  const FIRST = { 'no percent': 'Framing,Alpha,Lot,10/18/2026,10/28/2026,', '70%': 'Framing,Alpha,Lot,10/18/2026,10/28/2026,70' } as const;
  const SECOND = {
    'moves it again, no percent': ['Framing,Alpha,Lot,10/21/2026,10/31/2026,', '10/21/2026 - 10/31/2026', 0],
    'moves it again and states 80%': ['Framing,Alpha,Lot,10/21/2026,10/31/2026,80', '10/21/2026 - 10/31/2026', 80],
    'leaves it on the first lookahead\'s dates and states 80%': ['Framing,Alpha,Lot,10/18/2026,10/28/2026,80', '10/18/2026 - 10/28/2026', 80],
  } as const;
  type How = 'one device in order' | 'his owner sent first' | 'his owner waiting';

  /**
   * The first lookahead is approved on the phone and heard everywhere; he sets Framing's owner on the phone. One device
   * in order: the phone then approves the second lookahead and deletes the first. Two devices: the phone loses signal,
   * the iPad approves the second, and the phone, not having heard, deletes the first (`signalBack`: with signal again
   * just before the delete, sending at once).
   */
  async function steps(how: How, first: keyof typeof FIRST, second: keyof typeof SECOND, signalBack = false) {
    const { phone, ipad } = await start();
    at(LOOK.importedAt!); await approve(phone, LOOK, [FIRST[first]], true); await heardEverywhere(phone, ipad);
    const id = theRow(phone).id;
    at('2026-09-10T09:00:00.000Z');
    if (how === 'his owner waiting') { setOnline(phone, false); await edit(phone, id, { owner: 'Mike' }); }
    else { await edit(phone, id, { owner: 'Mike' }); await backgroundUpload(phone); await echoes(ipad); if (how !== 'one device in order') setOnline(phone, false); }
    const approver = how === 'one device in order' ? phone : ipad;
    at(LOOK2.importedAt!); await approve(approver, LOOK2, [SECOND[second][0]], true); shareDocuments(approver); await backgroundUpload(approver);
    at('2026-09-10T12:00:00.000Z');
    if (signalBack) setOnline(phone, true);
    await deleteWithItems(phone, LOOK);
    if (isOnline(phone)) { shareDocuments(phone); await backgroundUpload(phone); }
    at('2026-09-10T15:00:00.000Z');
    await everythingSyncs(phone, ipad);
    return ending(phone, ipad);
  }

  describe.each(Object.keys(FIRST) as Array<keyof typeof FIRST>)('the first lookahead states %s', first => {
    it.each(Object.keys(SECOND) as Array<keyof typeof SECOND>)('the iPad\'s second lookahead %s: every way of syncing ends as one device doing the steps in order, on the second lookahead\'s dates and its percent', async second => {
      const inOrder = await steps('one device in order', first, second);
      const [, dates, percent] = SECOND[second];
      // One device in order (the design note's R16): the second lookahead's dates, its percent where it states one, his
      // owner, its note alone.
      expect(inOrder).toEqual({ places: Array(3).fill([{ dates, percent, owner: 'Mike', lookaheads: [LOOK2.importBatchId], notes: [] }]), cards: [0, 0], waiting: [0, 0] });
      for (const how of ['his owner sent first', 'his owner waiting'] as const) {
        for (const signalBack of [false, true]) {
          // (It was: the master's 10/15 - 10/25 at 0% in all three places, with no lookahead note.)
          expect([how, signalBack, await steps(how, first, second, signalBack)]).toEqual([how, signalBack, inOrder]);
        }
      }
    });
  });

  it('seed 6248\'s shape (two lookaheads list the task; the phone deletes the first, the iPad, not having heard, the second): the task is on the master\'s dates with no lookahead note, as one device in order', async () => {
    const LA = scheduleDoc('LOOKAHEAD F6248 A', '2026-09-09T12:00:00.000Z', 'lookahead');
    const LB = scheduleDoc('LOOKAHEAD F6248 B', '2026-09-09T14:00:00.000Z', 'lookahead');
    const run = async (inOrder: boolean) => {
      const { phone, ipad } = await start();
      at(LA.importedAt!); await approve(phone, LA, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
      at(LB.importedAt!); await approve(phone, LB, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
      if (!inOrder) setOnline(ipad, false);
      at('2026-09-10T10:00:00.000Z'); await deleteWithItems(phone, LA); shareDocuments(phone); await backgroundUpload(phone);
      if (inOrder) await settle(phone, ipad);
      at('2026-09-10T12:00:00.000Z'); await deleteWithItems(inOrder ? phone : ipad, LB);
      at('2026-09-10T13:00:00.000Z'); await everythingSyncs(phone, ipad);
      return ending(phone, ipad);
    };
    const inOrder = await run(true);
    expect(inOrder).toEqual({ places: Array(3).fill([{ dates: '10/15/2026 - 10/25/2026', percent: 0, owner: '', lookaheads: [], notes: [] }]), cards: [0, 0], waiting: [0, 0] });
    // (It was: the deleted lookaheads' 10/18 - 10/28 in all three places, the first one's note back on the task.)
    expect(await run(false)).toEqual(inOrder);
  });

  it('a newer MASTER the phone had not heard of lists the task on the lookahead\'s dates; the phone deletes the lookahead: the task stays on that master\'s dates, as one device in order', async () => {
    const GM = scheduleDoc('MASTER F-GM', '2026-09-10T10:00:00.000Z');
    const run = async (inOrder: boolean) => {
      const { phone, ipad } = await start();
      at(LOOK.importedAt!); await approve(phone, LOOK, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true); await heardEverywhere(phone, ipad);
      const approver = inOrder ? phone : ipad;
      if (!inOrder) setOnline(phone, false);
      at(GM.importedAt!); await approve(approver, GM, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]); shareDocuments(approver); await backgroundUpload(approver);
      at('2026-09-10T12:00:00.000Z'); await deleteWithItems(phone, LOOK);
      at('2026-09-10T15:00:00.000Z'); await everythingSyncs(phone, ipad);
      return ending(phone, ipad);
    };
    const inOrder = await run(true);
    expect(inOrder).toMatchObject({ places: Array(3).fill([{ dates: '10/18/2026 - 10/28/2026', lookaheads: [] }]), cards: [0, 0], waiting: [0, 0] });
    // (It was: the old master's 10/15 - 10/25 in all three places.)
    expect(await run(false)).toEqual(inOrder);
  });
});
