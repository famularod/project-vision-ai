/**
 * Whole-app audit A7 pass 6 M1 (30 Sep 2026), with A4 pass 8 F1-F3: a change
 * to a document attached to a sent field update.
 *
 * M1 A document change (taken off, or its upload finished) re-sent this
 *    phone's whole copy of the update, older than the iPad's edit: the cloud,
 *    and then the iPad, lost the iPad's note. The conflict guard compared the
 *    cloud's time with the queue time, which each sync attempt re-stamps.
 *    Now the change goes up as a patch applied to the cloud's current copy.
 * F1 A progress step during another document's upload let a refresh put a
 *    deleted document back on the phone, and the re-send sent it for good.
 * F2 A refresh after a document upload attempt turned a sent update into
 *    "Waiting to Sync" and sent it again.
 * F3 The re-send un-archived an update archived on the iPad.
 *
 * A7 pass 7 M1 (with A4 pass 9 M1, L1-L3): once the patch had landed, the
 * waiting-update sync still sent the phone's whole older copy over the
 * iPad's note. A document change now leaves a sent update "sent" and only
 * the patch goes up; a sync attempt does not re-send a copy already in the
 * cloud, and its second save replaces only its own queue record.
 *
 * A7 pass 8 L1: an edit whose queue write was lost (the update reads
 * "Waiting to Sync", nothing queued) was gone after a document change: the
 * patch, once landed, stood for the edit. Now such an update goes up whole
 * with the change, and staging keeps a waiting patch only while the copy owes
 * nothing beyond it.
 *
 * Runs the App's own project_updates refresh closure, retryProjectDocumentUpload,
 * deleteProjectDocument and resendUpdatesListingDocument, compiled from
 * App.tsx, with the real SyncService queue, staging (runFieldUpdateCloudSync)
 * and uploadPendingChanges, and the real realtime applier. The cloud is a
 * mocked row per update; no Supabase call is made.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Documents/',
  cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async (_url: string, destination: string) => ({ uri: destination })),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

/** The cloud: one row per field update. */
const mockCloud = new Map<string, { updatedAt: string; updateData: Record<string, any> }>();
jest.mock('../../services/SupabaseService', () => {
  const ok = <T>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  const project = { id: '72e941d8-8114-4082-a976-ae5b2b5daba9', name: 'P' };
  return {
    ...jest.requireActual('../../services/SupabaseService'),
    createPhotoSignedUrl: jest.fn(),
    listProjectUpdates: jest.fn(),
    verifyDAVEAppOwner: jest.fn(async () => ({ ok: true, data: true })),
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    listProjects: jest.fn(async () => ok([project])),
    listArchivedProjects: jest.fn(async () => ok([])),
    getProjectUpdateSyncMetadata: jest.fn(async (id: string) => {
      const current = mockCloud.get(id);
      return ok(current ? {
        id, projectId: project.id, updatedAt: current.updatedAt, projectName: 'P', areaName: '',
        updateData: JSON.parse(JSON.stringify(current.updateData)),
      } : null);
    }),
    saveProjectUpdate: jest.fn(async (params: { id: string; projectId: string; updatedAt: string; updateData: Record<string, unknown> }) => {
      mockCloud.set(params.id, { updatedAt: params.updatedAt, updateData: JSON.parse(JSON.stringify({ ...params.updateData, projectId: params.projectId })) });
      return ok({ id: params.id, updateData: params.updateData });
    }),
    archiveProjectUpdate: jest.fn(async () => ok(null)),
    listDAVESyncTombstones: jest.fn(async () => ok([])),
  };
});
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  ...jest.requireActual('../../services/DAVECloudMaintenanceBudget'),
  runDAVECloudMaintenanceIfDue: jest.fn(async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] })),
}));

import { archiveProjectUpdate, createPhotoSignedUrl, listProjectUpdates, saveProjectUpdate } from '../../services/SupabaseService';
import { fieldUpdateDocumentChangeWaiting, fieldUpdateHasOpenConflict } from '../../services/FieldUpdateDocumentChangeNotice';
import {
  getOfflineQueue,
  getSyncConflicts,
  getSyncStatus,
  hydrateProjectUpdatePhotoPreviews,
  cloudPhotoPreviewIsFresh,
  projectUpdateUploadedSince,
  loadRemovedFieldUpdateDocuments,
  projectUpdateCopyIsLastInCloud,
  queueProjectUpdateDocumentChange,
  queueProjectUpdatePhotoAnalysis,
  queueProjectUpdateRecord,
  requeueRemovedFieldUpdateDocuments,
  resetFieldUpdateSyncMemoryForTests,
  resolveProjectUpdateSyncConflict,
  syncConflictChoiceStopReason,
  runFieldUpdateCloudSync,
  synchronizeLocalData,
  uploadPendingChanges,
} from '../../services/SyncService';
import { reconcileProjectUpdateDeletionJournal } from '../../services/updateService';
import { reconcileFieldUpdateSyncResult } from '../../services/FieldUpdateSyncGeneration';
import { persistedStatusForSyncResult } from '../../services/FieldUpdateLifecycle';
import { classifySyncFailureText } from '../../services/SyncFailureCategory';
import { resolveLegacyOwnedLocalFilePath } from '../../services/OwnedLocalFileRepository';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { hasMatchingQueuedProjectUpdateRevision, refreshKeepsLocalProjectUpdate } from '../../services/ProjectUpdateQueueRevision';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { preserveLocalPhotoTransport, withLatestLocalPhotoTransport } from '../../services/ProjectPhotoTransport';
import { normalizeStartupArray } from '../../services/StartupRecovery';
import { withStoredPhotoComparisonCap } from '../../services/PhotoAssessment';
import { optionalString, uid } from '../../services/RecordValues';
import { PROJECT_DOCUMENT_CATEGORIES } from '../../services/ProjectDocumentClassification';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
  isOwnedLocalFileManifestMember,
} from '../../services/OwnedLocalFileRepository';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  bindProjectDocumentUploadToAccount,
  projectDocumentUploadAttemptsAfterFailure,
  uploadedProjectDocumentToShare,
} from '../../services/ProjectDocumentUploadRetry';
import {
  cloudCopyShownOnDevice,
  documentsUploadedAfterCloudCopy,
  fieldUpdatesToResendForDocument,
  withDeviceDocumentUploadState,
  withoutFieldUpdateDocument,
} from '../../services/FieldUpdateDocumentUploadState';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const transpile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

/** A top-level function of App.tsx, up to the next top-level declaration. */
function appFunction(name: string): string {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const rest = app.slice(match.index + 1).replace(/^export /, '');
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}

/** The brace-matched block that opens at the end of `marker`. */
function blockAfter(marker: string): string {
  const start = app.indexOf(marker);
  if (start < 0) throw new Error(`App.tsx has no ${marker}`);
  const open = start + marker.length - 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(open, index + 1);
    }
  }
  throw new Error('unbalanced block');
}

/** A function of the App component (two-space indent), brace-matched; or of another screen's. */
function componentFunction(name: string, source = app): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(source);
  if (!match) throw new Error(`no component function ${name}`);
  const open = source.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}
const adminScreen = fs.readFileSync(path.resolve(__dirname, '../../screens/AdminScreen.tsx'), 'utf8');

function evaluate<T>(js: string, deps: Record<string, unknown>): T {
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const helperNames = [
  'resolveProjectPhotoUri', 'optionalNumber', 'optionalBoolean', 'optionalFiniteNumber', 'normalizePhoto',
  'uniqueStrings', 'normalizeRecipientSelection', 'normalizeUpdate', 'normalizeStoredUpdateRecord', 'isRecord',
  'lifecycleStatusForUpdate', 'updateNeedsAutomaticSyncRetry', 'mergeSavedUpdatesWithTombstones',
  'buildUpdateTombstone', 'buildCloudUpdateDeletionBarrier', 'upsertDeletedUpdateTombstone',
  'normalizeFieldUpdateDocuments', 'normalizeProjectDocument', 'normalizeProjectDocumentStatus',
  'normalizeProjectDocumentCategory', 'ownsProjectDocumentFile', 'projectDocumentStatusDetail', 'formatSavedTime',
  'resolveProjectPhotoDisplayUri', // an echo of an update with photos (A7 pass 7)
];
const A = evaluate<Record<string, (...args: any[]) => any>>(
  transpile([...helperNames.map(appFunction), `module.exports = { ${helperNames.join(', ')} };`].join('\n')),
  {
    PHOTO_STORAGE_DIR: 'file:///var/mobile/Containers/Data/Application/NEW/Documents/project-photos/',
    PHOTO_STORAGE_FOLDER: 'project-photos', RECOVERED_PHOTO_CACHE_FOLDER: 'dave-recovered-project-photos',
    FileSystem: { cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/' },
    resolveLegacyOwnedLocalFilePath, cloudPhotoPreviewIsFresh, optionalString, uid, mergeLocalUpdateWithCloudCopy,
    withStoredPhotoComparisonCap, PROJECT_DOCUMENT_CATEGORIES, isOwnedLocalFileManifestMember,
    CATEGORIES: ['Open Issue', 'Safety Concern', 'Update'], ACTION_STATUSES: ['Open', 'In Progress', 'Waiting', 'Closed'],
    QUICK_CONTEXTS: [], DEFAULT_PROJECTS: ['P'], isoToday: () => '2026-09-30', authorityProjectId: () => null,
    normalizeInterpretationDecisionLog: () => [], normalizeFieldUpdateSyncDiagnostics: (value: unknown) => value ?? null,
    normalizeFieldUpdateDeleteDiagnostics: (value: unknown) => value ?? null,
    normalizeWorkflowTimestamps: (value: unknown) => value ?? {}, migrateLegacyProjectUpdate: (value: unknown) => value,
  },
);

type Doc = Record<string, any> & { id: string; status: string };
type Update = Record<string, any> & { id: string; status: string; documents?: Doc[] };

function phoneDocument(id: string, extra: Partial<Doc> = {}): Doc {
  const fileId = `${id.padEnd(8, '0').slice(0, 8)}-e29b-41d4-a716-446655440000`;
  return {
    id, status: 'failed', projectId: 'p-key', updateId: 'u1', name: `${id}.pdf`, category: 'Permit',
    mimeType: 'application/pdf', sizeBytes: 10, localUri: `file:///phone/Documents/project-documents-v2/${fileId}.pdf`,
    ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId, kind: 'project_document', generatedBasename: `${fileId}.pdf`, relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 1, lastUploadAttemptAt: '2026-09-28T08:00:00.000Z',
    createdAt: '2026-09-28T08:00:00.000Z', updatedAt: '2026-09-28T08:00:00.000Z', importedAt: '2026-09-28T08:00:00.000Z',
    ...extra,
  };
}
const uploaded = (id: string) => phoneDocument(id, { status: 'uploaded', uploadedAt: '2026-09-28T08:05:00.000Z', uploadProgress: 1 });
/** An update as the phone saved it: through the App's own normalizer. */
const savedUpdate = (documents: Doc[], status = 'sent', id = 'u1'): Update => ({
  ...A.normalizeStoredUpdateRecord({
    id, projectName: 'P', date: '2026-09-28', notes: 'Pour', recipients: { contactIds: [] }, photos: [], documents,
  }),
  status,
});

const SENT_AT = '2026-09-28T09:00:00.000Z';
const IPAD_EDITED_AT = '2026-09-28T10:00:00.000Z';
const IPAD_NOTE = 'Pour moved to Tuesday (typed on the iPad)';
/** The row as the phone's send left it: rows carry the 'queued' status verbatim. */
const putInCloud = (update: Update, updatedAt = SENT_AT) =>
  mockCloud.set(update.id, { updatedAt, updateData: JSON.parse(JSON.stringify({ ...update, status: 'queued' })) });
const inCloud = (id = 'u1') => mockCloud.get(id)!.updateData as Update;
/** The iPad's edit reaches the cloud. */
const iPadEditsNotes = (id = 'u1') => putInCloud({ ...inCloud(id), notes: IPAD_NOTE }, IPAD_EDITED_AT);
const cloudRows = () => [...mockCloud.entries()].map(([id, current]) => ({
  id, projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9', projectName: 'P', areaName: '', idempotencyKey: id,
  createdAt: SENT_AT, updatedAt: current.updatedAt, ownerId: 'o', updateData: JSON.parse(JSON.stringify(current.updateData)),
}));
const queuedFor = async (id = 'u1') => (await getOfflineQueue())
  .find(item => item.entity === 'project_update' && (item.payload as { id: string }).id === id);
const documentIds = (update: Update | undefined) => (update?.documents || []).map(document => document.id);

/**
 * The refresh's project_updates run, compiled from App.tsx, on a device's own
 * state. `own` is what only that device holds: the iPad has not taken any
 * document off here (its own journal of removed documents is empty).
 */
function refresh(device: Device, own: Record<string, unknown> = {}) {
  (listProjectUpdates as jest.Mock).mockResolvedValue({ ok: true, stubbed: false, data: cloudRows() });
  const run = evaluate<() => Promise<void>>(
    transpile(`module.exports = async function () ${blockAfter("collectionRefreshes.push({ name: 'project_updates', run: async () => {")}`),
    {
      listProjectUpdates, active: true,
      refreshCommit: { isCurrent: () => true, commit: (effect: () => void) => { effect(); return true; } },
      normalizeStartupArray, normalizeStoredUpdateRecord: A.normalizeStoredUpdateRecord,
      savedUpdatesRef: device.savedUpdatesRef, projectDocumentsCurrentRef: device.projectDocumentsCurrentRef,
      resolveProjectPhotoUri: A.resolveProjectPhotoUri, preserveLocalPhotoTransport, withLatestLocalPhotoTransport,
      withDeviceDocumentUploadState, cloudCopyShownOnDevice, hydrateProjectUpdatePhotoPreviews, getOfflineQueue,
      documentsUploadedAfterCloudCopy, resendUpdatesListingDocument: device.resendUpdatesListingDocument,
      deletedUpdateTombstonesRef: { current: [] }, buildUpdateTombstone: A.buildUpdateTombstone,
      upsertDeletedUpdateTombstone: A.upsertDeletedUpdateTombstone, hasMatchingQueuedProjectUpdateRevision,
      refreshKeepsLocalProjectUpdate, // the refresh keeps a card whose own copy still waits (A4 pass 12 H1)
      projectUpdateUploadedSince, mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones,
      setDeletedUpdateTombstones: () => undefined, setSavedUpdates: device.setSavedUpdates,
      // A document taken off on purpose stays off (A7 pass 6 M1).
      loadRemovedFieldUpdateDocuments, requeueRemovedFieldUpdateDocuments, requestPendingChangesUpload: jest.fn(),
      ...own,
    },
  );
  return run().then(() => device.render());
}
/** The iPad's own queue and journal of removed documents: nothing of the phone's. */
const iPadOwn = { loadRemovedFieldUpdateDocuments: async () => new Set<string>(), getOfflineQueue: async () => [] };

type Device = ReturnType<typeof device>;
/** A device as these functions see it; `render()` reads state back into the refs, as each render does. */
function device(documents: Doc[], saved: Update[], options: {
  upload?: (onProgress: (progress: number) => void) => Promise<{ ok: boolean; error?: string }>;
} = {}) {
  let documentsState = documents;
  let savedState = saved;
  const projectDocumentsCurrentRef = { current: documentsState };
  const savedUpdatesRef = { current: savedState };
  const alerts: Array<{ title: string; message?: string; buttons: Array<{ text: string; onPress?: () => void }> }> = [];
  const requestQueuedUpdateSync = jest.fn();
  const requestPendingChangesUpload = jest.fn(); // a sent update's patch goes up through the queue upload (A7 pass 7 M1)
  const setSavedUpdates = (next: Update[] | ((prev: Update[]) => Update[])) => {
    savedState = typeof next === 'function' ? next(savedState) : next;
  };
  const deps: Record<string, unknown> = {
    projectDocumentsCurrentRef, savedUpdatesRef, draft: { documents: [] },
    get projectDocuments() { return documentsState; },
    setProjectDocuments: (next: Doc[] | ((prev: Doc[]) => Doc[])) => {
      documentsState = typeof next === 'function' ? next(documentsState) : next;
    },
    setDraft: () => undefined, setSavedUpdates,
    buildProjectDocumentStoragePath: (id: string) => `project-documents/p-key/${id}/${id}.pdf`,
    verifyOwnedProjectDocument: async () => undefined,
    uploadPhoto: async ({ onProgress }: { onProgress: (progress: number) => void }) =>
      (options.upload || (async () => ({ ok: true })))(onProgress),
    PROJECT_DOCUMENT_UPLOAD_FOLDER: 'project-documents', MAX_PROJECT_DOCUMENT_FILE_BYTES: 1e9,
    persistProjectDocumentsImmediately: async () => undefined,
    publishUploadedProjectDocument: async () => undefined,
    PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE: 'add again', reportStoragePersistenceFailure: jest.fn(),
    PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments',
    Alert: { alert: (title: string, message?: string, buttons: Array<{ text: string; onPress?: () => void }> = []) => {
      alerts.push({ title, message, buttons });
    } },
    projectDocumentUploadAttemptsAfterFailure, bindProjectDocumentUploadToAccount,
    uploadedProjectDocumentToShare, // audit A8 pass 4 L4: read again from the list before it is shared
    isComplianceSensitiveProjectDocument: () => false,
    findSharedReferenceDocumentForProjectDocument: () => null,
    referenceDocumentsCurrentRef: { current: [] },
    projectDocumentSharedRecordSync: { cancel: jest.fn() },
    deleteOwnedProjectDocument: async () => ({ status: 'deleted' }), hiddenSharedDocuments: { hide: jest.fn() },
    withdrawUnsentProjectDocumentBridge: async () => null, getOfflineQueue,
    removeOperationalRecordFromSyncQueue: async () => undefined, setReferenceDocuments: jest.fn(),
    removeReferenceDocumentEverywhere: async () => undefined,
    queueProjectUpdateRecord, queueProjectUpdateDocumentChange, requestQueuedUpdateSync, fieldUpdatesToResendForDocument,
    withoutFieldUpdateDocument, withDeviceDocumentUploadState, requestPendingChangesUpload,
  };
  const names = ['updateDocumentEverywhere', 'retryProjectDocumentUpload', 'deleteProjectDocument', 'resendUpdatesListingDocument'];
  const fns = evaluate<{
    retryProjectDocumentUpload: (documentId: string) => Promise<boolean | undefined>;
    deleteProjectDocument: (documentId: string) => void;
    resendUpdatesListingDocument: (documentId: string, change: (update: Update) => Update) => void;
  }>(transpile([...names.map(name => componentFunction(name)), `module.exports = { ${names.join(', ')} };`].join('\n')), deps);
  const render = () => {
    projectDocumentsCurrentRef.current = documentsState;
    savedUpdatesRef.current = savedState;
  };
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
    render();
  };
  const press = async (text: string) => {
    alerts.at(-1)?.buttons.find(button => button.text === text)?.onPress?.();
    await settle();
  };
  const deleteFromThisDevice = async (documentId: string) => {
    fns.deleteProjectDocument(documentId);
    await press('Delete from This Device');
  };
  return {
    ...fns, render, settle, press, deleteFromThisDevice, alerts, requestQueuedUpdateSync, requestPendingChangesUpload, setSavedUpdates,
    projectDocumentsCurrentRef, savedUpdatesRef,
    saved: (id = 'u1') => savedState.find(update => update.id === id),
  };
}

/** The phone's sync pass for a waiting update, as hydrateQueuedUpdates runs it: staging, then the queue upload. */
async function syncWaitingUpdate(phone: Device, id = 'u1', choice: { overConflict?: boolean } = {}) {
  const { syncResult } = await runFieldUpdateCloudSync(phone.saved(id) as never, choice);
  if (syncResult.itemOutcomes?.[`project-update-${id}`] === 'uploaded') {
    phone.setSavedUpdates(prev => prev.map(update => update.id === id ? { ...update, status: 'sent' } : update));
  }
  phone.render();
  return syncResult;
}

beforeEach(() => {
  mockStorage.clear();
  mockCloud.clear();
  // What a launch holds in memory (the copy each update last put in the
  // cloud, the documents re-sent) starts empty in each test: none depends on
  // the one before it (A7 pass 9).
  resetFieldUpdateSyncMemoryForTests();
  noteSignedInOwner('owner-a');
  (listProjectUpdates as jest.Mock).mockReset();
  (createPhotoSignedUrl as jest.Mock).mockReset();
});

describe('a document change keeps the iPad\'s newer edit of the update (audit A7 pass 6 M1)', () => {
  it('(A) Delete from This Device on a phone that has not seen the iPad\'s edit: the cloud and the iPad keep the iPad\'s note', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    iPadEditsNotes();
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]); // offline since before the iPad's edit

    await phone.deleteFromThisDevice('permit');
    expect(documentIds(phone.saved())).toEqual(['survey']);
    // Pins changed in A7 pass 7 M1: the update stays "sent", and only its
    // patch goes up, through the queue upload (not the waiting-update sync).
    expect(phone.saved()?.status).toBe('sent');
    expect(phone.requestPendingChangesUpload).toHaveBeenCalled();
    expect(phone.requestQueuedUpdateSync).not.toHaveBeenCalled();

    // Reconnected: the queue upload sends the patch.
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);

    const iPad = device([], [{ ...sent, notes: IPAD_NOTE }]);
    await refresh(iPad, iPadOwn);
    expect(iPad.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(iPad.saved())).toEqual(['survey']);
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(phone.saved())).toEqual(['survey']);
  });

  it('(B) an upload finishing before this phone pulled the iPad\'s edit: the refresh takes the iPad\'s note, and the upload keeps it', async () => {
    const sent = savedUpdate([phoneDocument('permit', { status: 'failed' })]);
    putInCloud(sent);
    iPadEditsNotes();
    const phone = device([phoneDocument('permit', { status: 'failed' })], [sent]);

    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();
    expect(phone.saved()?.status).toBe('sent'); // pin changed in A7 pass 7 M1: stays "sent"

    // A refresh before the re-send uploads: the iPad's note, with this phone's upload state.
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(phone.saved()!.documents![0].status).toBe('uploaded');

    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(inCloud().documents![0]).toMatchObject({ id: 'permit', status: 'uploaded' });
  });

  it('(B) a realtime echo of the iPad\'s edit while the document change waits: the phone shows the iPad\'s note', async () => {
    const sent = savedUpdate([phoneDocument('permit', { status: 'failed' })]);
    putInCloud(sent);
    const phone = device([phoneDocument('permit', { status: 'failed' })], [sent]);
    await phone.retryProjectDocumentUpload('permit');
    await phone.settle();
    iPadEditsNotes();

    const commitUpdates = jest.fn();
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => ({ projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: phone.savedUpdatesRef.current,
        deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [] }) as never,
      getPendingQueue: getOfflineQueue,
      normalizeUpdate: A.normalizeStoredUpdateRecord as never, normalizeAreas: () => [], normalizeSchedule: () => [],
      normalizeDocuments: () => [], migrateSchedule: item => item, localPhotoUri: A.resolveProjectPhotoUri,
      mergeProjectNames: (names: string[]) => names, updateHasPendingLocalWork: A.updateNeedsAutomaticSyncRetry as never,
      deviceDocuments: () => phone.projectDocumentsCurrentRef.current,
      mergeUpdates: A.mergeSavedUpdatesWithTombstones as never, buildUpdateTombstone: A.buildUpdateTombstone as never,
      buildCloudDeletionBarrier: A.buildCloudUpdateDeletionBarrier as never, upsertDeletedUpdate: A.upsertDeletedUpdateTombstone as never,
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    });
    await apply('project_update', { eventType: 'UPDATE', newRow: { id: 'u1', update_data: inCloud() }, oldRow: null, raw: null });
    expect(commitUpdates).toHaveBeenCalled();
    const committed = (commitUpdates.mock.calls.at(-1)![0] as Update[]).find(update => update.id === 'u1')!;
    expect(committed).toMatchObject({ notes: IPAD_NOTE });
    expect(committed.documents![0].status).toBe('uploaded');
  });

  it('(F3) an update archived on the iPad stays archived when the phone takes a document off it', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud({ ...sent, isArchived: true, archivedAt: IPAD_EDITED_AT }, IPAD_EDITED_AT);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);

    await phone.deleteFromThisDevice('permit');
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ isArchived: true, archivedAt: IPAD_EDITED_AT });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('several document changes waiting together go up as one, on the cloud\'s copy', async () => {
    const sent = savedUpdate([uploaded('permit'), phoneDocument('survey', { status: 'failed' })]);
    putInCloud(sent);
    iPadEditsNotes();
    const phone = device([uploaded('permit'), phoneDocument('survey', { status: 'failed' })], [sent]);

    await phone.deleteFromThisDevice('permit');
    await phone.retryProjectDocumentUpload('survey');
    await phone.settle();
    const queue = (await getOfflineQueue()).filter(item => item.entity === 'project_update');
    expect(queue).toHaveLength(1);

    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'survey', status: 'uploaded' })]);
  });

  it('a real edit on this phone afterwards sends its whole copy, under the usual rules', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');

    const edited = { ...phone.saved()!, notes: 'Pour, 40 yards' };
    await queueProjectUpdateRecord(edited, false);
    const item = await queuedFor();
    expect((item!.payload as Record<string, unknown>).documentPatches).toBeUndefined();
    expect((item!.payload as { updateData: Update }).updateData).toMatchObject({ notes: 'Pour, 40 yards' });
    expect(documentIds((item!.payload as { updateData: Update }).updateData)).toEqual(['survey']);
  });

  it('a document change made while this phone\'s own edit waits is added to that edit', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const edited = { ...sent, notes: 'Pour, 40 yards', status: 'queued' };
    const phone = device([uploaded('permit'), uploaded('survey')], [edited]);
    await queueProjectUpdateRecord(edited, false);

    await phone.deleteFromThisDevice('permit');
    const item = await queuedFor();
    expect((item!.payload as Record<string, unknown>).documentPatches).toBeUndefined();
    expect((item!.payload as { updateData: Update }).updateData).toMatchObject({ notes: 'Pour, 40 yards' });
    expect(documentIds((item!.payload as { updateData: Update }).updateData)).toEqual(['survey']);
  });

  it('a photo this phone could not re-check does not hold a patch; with no cloud copy it holds the whole copy', async () => {
    (createPhotoSignedUrl as jest.Mock).mockResolvedValue({ ok: false, configured: true, stubbed: false, error: 'Object not found', status: 404 });
    const photo = { id: 'photo-1', uri: 'file:///phone/Documents/project-photos/photo-1.jpg', caption: '', createdAt: SENT_AT };
    const withPhoto = { ...savedUpdate([uploaded('permit'), uploaded('survey')]), photos: [photo] };
    putInCloud(withPhoto);
    iPadEditsNotes();
    const phone = device([uploaded('permit'), uploaded('survey')], [withPhoto]);
    await phone.deleteFromThisDevice('permit');
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);

    mockCloud.clear();
    const other = { ...withPhoto, id: 'u2', documents: [uploaded('permit'), uploaded('survey')].map(document => ({ ...document, updateId: 'u2' })) };
    const second = device([], [other]);
    await queueProjectUpdateDocumentChange(withoutFieldUpdateDocument(other, 'permit'), 'permit');
    await syncWaitingUpdate(second, 'u2');
    expect(mockCloud.has('u2')).toBe(false);
    expect((await queuedFor('u2'))!.payload.pendingPhotoAssetIds).toEqual(['photo-1']);
  });

  it('with no cloud copy, the whole update goes up', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: 'Pour' });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });
});

describe('a document taken off stays off when the iPad sends an older copy (audit A7 pass 6 M1)', () => {
  it('the phone keeps it off, takes it off the cloud copy again, and the iPad drops it', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await syncWaitingUpdate(phone);
    expect(documentIds(inCloud())).toEqual(['survey']);

    // The iPad, offline since before the delete, sends its own edit of its older copy.
    putInCloud({ ...sent, notes: IPAD_NOTE }, '2026-09-28T11:00:00.000Z');
    await refresh(phone);
    await phone.settle();
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(phone.saved())).toEqual(['survey']);

    // The phone takes it off the cloud copy again, keeping the iPad's note.
    expect(await queuedFor()).toBeDefined();
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    const iPad = device([], [{ ...sent, notes: IPAD_NOTE }]);
    await refresh(iPad, iPadOwn);
    expect(documentIds(iPad.saved())).toEqual(['survey']);

    // Only once: the next refresh has nothing more to send.
    await refresh(phone);
    await phone.settle();
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('survives a relaunch: the journal is on the phone', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await expect(loadRemovedFieldUpdateDocuments()).resolves.toEqual(new Set(['u1\npermit']));
  });
});

describe('a refresh during another document\'s upload keeps a deleted one off (audit A4 pass 8 F1)', () => {
  it('delete, progress, refresh, then the upload finishes: the delete stands on the phone and in the cloud', async () => {
    const sent = savedUpdate([uploaded('permit'), phoneDocument('survey', { status: 'failed' })]);
    putInCloud(sent);
    let queuedBeforeRefresh: string[] = [];
    let afterRefresh: string[] = [];
    const phone: Device = device([uploaded('permit'), phoneDocument('survey', { status: 'failed' })], [sent], {
      upload: async onProgress => {
        onProgress(0.3);
        phone.render();
        await phone.deleteFromThisDevice('permit');
        queuedBeforeRefresh = documentIds((await queuedFor())!.payload.updateData as Update);
        onProgress(0.6);
        phone.render();
        await refresh(phone);
        afterRefresh = documentIds(phone.saved());
        return { ok: true };
      },
    });
    await expect(phone.retryProjectDocumentUpload('survey')).resolves.toBe(true);
    await phone.settle();
    expect(queuedBeforeRefresh).toEqual(['survey']);
    expect(afterRefresh).toEqual(['survey']);
    expect(documentIds((await queuedFor())!.payload.updateData as Update)).toEqual(['survey']);

    await syncWaitingUpdate(phone);
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'survey', status: 'uploaded' })]);
  });
});

describe('a refresh during a document upload keeps this phone\'s waiting edit (audit A4 pass 8 F1)', () => {
  it('a progress step is not an edit: the queued edit still holds the phone\'s copy', async () => {
    const sent = savedUpdate([phoneDocument('survey', { status: 'failed' })]);
    putInCloud(sent);
    const edited = { ...sent, notes: 'Pour, 40 yards', status: 'queued' };
    await queueProjectUpdateRecord(edited, false);
    let midUpload: Update | undefined;
    const phone: Device = device([phoneDocument('survey', { status: 'failed' })], [edited], {
      upload: async onProgress => {
        onProgress(0.5);
        phone.render();
        await refresh(phone);
        midUpload = phone.saved();
        return { ok: true };
      },
    });
    await phone.retryProjectDocumentUpload('survey');
    await phone.settle();
    expect(midUpload).toMatchObject({ notes: 'Pour, 40 yards' });
    expect(A.projectDocumentStatusDetail(midUpload!.documents![0])).toBe('Uploading 50%');
  });
});

describe('a refresh after a document upload attempt leaves a sent update sent (audit A4 pass 8 F2)', () => {
  it('a failed attempt changes only this phone\'s upload state: no "Waiting to Sync", nothing sent', async () => {
    const sent = savedUpdate([phoneDocument('permit', { status: 'failed' })]);
    putInCloud(sent);
    const phone = device([phoneDocument('permit', { status: 'failed' })], [sent], {
      upload: async () => ({ ok: false, error: 'Network request failed' }),
    });
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(false);
    await phone.settle();
    const attemptedAt = phone.projectDocumentsCurrentRef.current[0].lastUploadAttemptAt;
    expect(attemptedAt).not.toBe('2026-09-28T08:00:00.000Z');

    await refresh(phone);
    expect(phone.saved()?.status).toBe('sent');
    expect(phone.saved()!.documents![0].lastUploadAttemptAt).toBe(attemptedAt);
    expect(await getOfflineQueue()).toEqual([]);
  });
});

describe('the patch rules', () => {
  it('a re-sent document change never goes up as the whole older copy when the cloud has the update', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    iPadEditsNotes();
    await queueProjectUpdateDocumentChange(withoutFieldUpdateDocument(sent, 'permit'), 'permit');
    await uploadPendingChanges();
    expect(saveProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      updateData: expect.objectContaining({ notes: IPAD_NOTE, documents: [expect.objectContaining({ id: 'survey' })] }),
    }));
  });
});

/** A realtime echo of the cloud row, applied to the phone as the App commits it. */
async function realtimeEcho(phone: Device, id = 'u1') {
  const apply = createDAVEOperationalRealtimeApplier({
    isActive: () => true,
    snapshot: () => ({ projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: phone.savedUpdatesRef.current,
      deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [] }) as never,
    getPendingQueue: getOfflineQueue,
    normalizeUpdate: A.normalizeStoredUpdateRecord as never, normalizeAreas: () => [], normalizeSchedule: () => [],
    normalizeDocuments: () => [], migrateSchedule: item => item, localPhotoUri: A.resolveProjectPhotoUri,
    mergeProjectNames: (names: string[]) => names, updateHasPendingLocalWork: A.updateNeedsAutomaticSyncRetry as never,
    deviceDocuments: () => phone.projectDocumentsCurrentRef.current,
    mergeUpdates: A.mergeSavedUpdatesWithTombstones as never, buildUpdateTombstone: A.buildUpdateTombstone as never,
    buildCloudDeletionBarrier: A.buildCloudUpdateDeletionBarrier as never, upsertDeletedUpdate: A.upsertDeletedUpdateTombstone as never,
    commitProjects: jest.fn(), commitDeletedProjects: jest.fn(),
    commitUpdates: updates => { phone.setSavedUpdates(updates as Update[]); phone.render(); },
    commitDeletedUpdates: jest.fn(), commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
  });
  await apply('project_update', { eventType: 'UPDATE', newRow: { id, update_data: inCloud(id) }, oldRow: null, raw: null });
  return phone.saved(id);
}

/** The phone took a document off its sent copy, offline since before the iPad edited the note. */
async function phoneTakesPermitOff(extra: Partial<Update> = {}) {
  const sent = { ...savedUpdate([uploaded('permit'), uploaded('survey')]), ...extra };
  putInCloud(sent);
  iPadEditsNotes();
  const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
  await phone.deleteFromThisDevice('permit');
  return { phone, sent };
}
/** As an earlier build left it: "Waiting to Sync" while the patch waits. */
const leftWaitingByAnEarlierBuild = (phone: Device) => {
  phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, status: 'queued' } : update));
  phone.render();
};
const signedUrl = { ok: true, configured: true, stubbed: false, data: 'https://signed.example/photo.jpg' };

describe('after a document patch lands, the phone\'s older copy never goes up whole (audit A7 pass 7 M1, A4 pass 9 M1)', () => {
  it('R1 (P1, P1b): delete, the upload run sends the patch, the realtime echo, then the waiting-update retry: the iPad keeps its note, the phone shows it, the update reads Sent', async () => {
    const { phone, sent } = await phoneTakesPermitOff();
    expect(phone.saved()?.status).toBe('sent');
    expect(A.updateNeedsAutomaticSyncRetry(phone.saved()!)).toBe(false); // the waiting-update retry has nothing for it
    expect(phone.requestPendingChangesUpload).toHaveBeenCalledWith('field_update_document_change');
    expect(phone.requestQueuedUpdateSync).not.toHaveBeenCalled();

    // Reconnect: the upload run sends the patch onto the cloud's copy.
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);

    // The echo shows the cloud's copy; nothing is left waiting.
    const shown = await realtimeEcho(phone);
    expect(shown).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(documentIds(shown)).toEqual(['survey']);
    expect(A.updateNeedsAutomaticSyncRetry(shown!)).toBe(false);

    // The waiting-update retry, had it run, sends the same copy: still the iPad's note.
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    const iPad = device([], [{ ...sent, notes: IPAD_NOTE }]);
    await refresh(iPad, iPadOwn);
    expect(iPad.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(iPad.saved())).toEqual(['survey']);
  });

  it.each([
    ['the update reads Sent (a Sync Now staging it)', false],
    ['the update reads Waiting to Sync, as an earlier build left it', true],
  ])('P1: a sync attempt after the patch landed and before the echo sends nothing more: %s', async (_label, waiting) => {
    const { phone } = await phoneTakesPermitOff();
    if (waiting) leftWaitingByAnEarlierBuild(phone);
    await uploadPendingChanges();
    expect(phone.saved()).toMatchObject({ notes: 'Pour' }); // no echo yet

    const result = await syncWaitingUpdate(phone);
    expect(result.itemOutcomes?.['project-update-u1']).toBe('uploaded');
    expect(phone.saved()?.status).toBe('sent');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
  });

  it('P1c (control): a refresh between the upload run and the sync attempt shows the cloud copy, and the cloud keeps it', async () => {
    const { phone } = await phoneTakesPermitOff();
    await uploadPendingChanges();
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });

  it.each([
    ['the update reads Sent (a Sync Now staging it)', false],
    ['the update reads Waiting to Sync, as an earlier build left it', true],
  ])('R2 (P3): the upload run sends the patch while the update\'s own sync checks its photos; the sync does not queue the whole older copy: %s', async (_label, waiting) => {
    const photo = { id: `photo-r2-${waiting}`, uri: `file:///phone/Documents/project-photos/r2-${waiting}.jpg`, caption: '', createdAt: SENT_AT };
    const { phone } = await phoneTakesPermitOff({ photos: [photo] } as Partial<Update>);
    if (waiting) leftWaitingByAnEarlierBuild(phone);
    let reconnectUpload: Promise<unknown> | null = null;
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async () => {
      reconnectUpload ??= uploadPendingChanges(); // reconnect starts the upload run too
      await reconnectUpload;
      return signedUrl;
    });

    const result = await syncWaitingUpdate(phone);
    expect(reconnectUpload).not.toBeNull();
    expect(result.itemOutcomes?.['project-update-u1']).toBe('uploaded');
    expect(phone.saved()?.status).toBe('sent');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
  });

  it('the second save still replaces its own record when an upload run found it waiting for photos meanwhile', async () => {
    const photo = { id: 'photo-own', uri: 'file:///phone/Documents/project-photos/own.jpg', caption: '', createdAt: SENT_AT };
    const edited = { ...savedUpdate([uploaded('survey')], 'queued'), notes: 'Pour, 40 yards', photos: [photo] };
    const phone = device([uploaded('survey')], [edited]);
    await queueProjectUpdateRecord(edited, false);
    let reconnectUpload: Promise<unknown> | null = null;
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async () => {
      reconnectUpload ??= uploadPendingChanges(); // binds the record's project id, finds it waiting for photos
      await reconnectUpload;
      return signedUrl;
    });

    const result = await syncWaitingUpdate(phone);
    expect(reconnectUpload).not.toBeNull();
    expect(result.itemOutcomes?.['project-update-u1']).toBe('uploaded');
    expect(inCloud()).toMatchObject({ notes: 'Pour, 40 yards' });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('a late photo-analysis result queued while a pass checks the photos is not overwritten by that pass\'s older copy (review pass 7 known limit)', async () => {
    const photo = { id: 'photo-late', uri: 'file:///phone/Documents/project-photos/late.jpg', caption: '', createdAt: SENT_AT };
    const waiting = { ...savedUpdate([], 'queued'), photos: [photo] };
    const phone = device([], [waiting]);
    await queueProjectUpdateRecord(waiting, false);
    // Stands in for the result: the App queues the update with it at once (queueProjectUpdateRecord).
    const withResult = { ...waiting, photos: [{ ...photo, caption: 'Rebar spacing checked' }] };
    let landed = false;
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async () => {
      if (!landed) {
        landed = true;
        phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? withResult : update));
        phone.render();
        await queueProjectUpdateRecord(withResult, false);
      }
      return signedUrl;
    });

    const first = await runFieldUpdateCloudSync(waiting as never);
    expect(landed).toBe(true);
    expect(first.syncResult.itemOutcomes?.['project-update-u1']).not.toBe('uploaded');
    expect(((await queuedFor())!.payload.updateData as Update).photos[0].caption).toBe('Rebar spacing checked');
    expect(mockCloud.has('u1')).toBe(false);

    await syncWaitingUpdate(phone); // the rerun the result asked for
    expect(inCloud().photos[0]).toMatchObject({ caption: 'Rebar spacing checked' });
  });

  it('a real edit on this phone after the patch landed still goes up whole, under the usual rules', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await uploadPendingChanges();

    const edited = { ...phone.saved()!, notes: 'Pour, 40 yards', status: 'queued' };
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? edited : update));
    phone.render();
    await queueProjectUpdateRecord(edited, false); // the save's own queue write
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: 'Pour, 40 yards' });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('a real edit whose queue write was interrupted still goes up whole: it is not the copy already in the cloud', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await uploadPendingChanges();

    leftWaitingByAnEarlierBuild(phone);
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, notes: 'Pour, 40 yards' } : update));
    phone.render();
    expect(await getOfflineQueue()).toEqual([]);
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: 'Pour, 40 yards' });
  });
});

describe('a document change on an update in conflict keeps the conflict (audit A4 pass 9 L1)', () => {
  it('the phone\'s typed note and attachment stay for review, with the Keep Phone choice', async () => {
    const LATER = '2099-01-01T00:00:00.000Z';
    putInCloud({ ...savedUpdate([]), notes: IPAD_NOTE }, LATER);
    const permit = phoneDocument('permit', { status: 'failed' });
    const phoneEdit = { ...savedUpdate([permit]), notes: 'Pour, 40 yards (typed on the phone)', status: 'queued' };
    await queueProjectUpdateRecord(phoneEdit, false);
    await uploadPendingChanges();
    expect(await getSyncConflicts()).toHaveLength(1);

    // The update reads failed (conflict); its document then finishes uploading.
    const phone = device([permit], [{ ...phoneEdit, status: 'failed' }]);
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();
    expect(await queuedFor()).toBeDefined();
    await uploadPendingChanges();

    expect(await getSyncConflicts()).toEqual([expect.objectContaining({
      localId: 'u1',
      localPayload: expect.objectContaining({
        updateData: expect.objectContaining({ notes: 'Pour, 40 yards (typed on the phone)', documents: [expect.objectContaining({ id: 'permit' })] }),
      }),
    })]);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });
});

describe('a document change on an update not yet in the cloud waits for its photos (audit A4 pass 9 L2)', () => {
  it('the upload run that beats the update\'s own sync sends nothing; the sync checks the photo, then sends it', async () => {
    const photo = { id: 'photo-l2', uri: 'file:///phone/Documents/project-photos/photo-l2.jpg', caption: '', createdAt: SENT_AT };
    const permit = phoneDocument('permit', { status: 'failed' });
    // Saved, but its queue write was interrupted: nothing queued, nothing in the cloud.
    const waiting = { ...savedUpdate([permit], 'queued'), photos: [photo] };
    const phone = device([permit], [waiting]);
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalled();
    expect((await queuedFor())!.payload.pendingPhotoAssetIds).toEqual(['photo-l2']);

    await uploadPendingChanges();
    expect(mockCloud.has('u1')).toBe(false);

    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl); // the photo is in the cloud
    await syncWaitingUpdate(phone);
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
    expect(inCloud().photos).toEqual([expect.objectContaining({ id: 'photo-l2' })]);
  });
});

describe('the realtime echo reads the queue after its photo previews (audit A4 pass 9 L3)', () => {
  it('an edit saved while the previews are signed is not replaced by the cloud copy', async () => {
    const photo = { id: 'photo-l3', uri: '', caption: '', createdAt: SENT_AT, cloudStoragePath: 'project-photos/p-key/u1/photo-l3.jpg' };
    const { phone } = await phoneTakesPermitOff({ photos: [photo] } as Partial<Update>);
    expect(await queuedFor()).toBeDefined(); // the patch waits
    let saved = false;
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async () => {
      if (!saved) {
        saved = true;
        const edited = { ...phone.saved()!, notes: 'Pour, 40 yards', status: 'queued' };
        phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? edited : update));
        phone.render();
        await queueProjectUpdateRecord(edited, false);
      }
      return signedUrl;
    });

    const shown = await realtimeEcho(phone);
    expect(saved).toBe(true);
    expect(shown).toMatchObject({ notes: 'Pour, 40 yards', status: 'queued' });
  });
});

/**
 * A7 pass 8 L1: David edits a sent update; the phone saves it ("Waiting to
 * Sync") but the save's queue write never happens (the app is killed in that
 * window, or the write fails; startup recovery stages it again). Before the
 * next staging he takes a document off it, or its upload finishes.
 */
async function editWhoseQueueWriteWasLost(documents = () => [uploaded('permit'), uploaded('survey')]) {
  const sent = savedUpdate(documents());
  putInCloud(sent);
  const phone = device(documents(), [sent]);
  phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1'
    ? { ...update, notes: 'Pour, 40 yards', status: 'queued' } : update));
  phone.render();
  expect(await getOfflineQueue()).toEqual([]);
  return phone;
}
const EDIT = 'Pour, 40 yards';

describe('an edit whose queue write was lost survives a document change (audit A7 pass 8 L1)', () => {
  it('S1a: the upload run lands first, then the waiting-update sync: the edit reaches the cloud and stays on the phone', async () => {
    const phone = await editWhoseQueueWriteWasLost();
    await phone.deleteFromThisDevice('permit');
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalled(); // it still owes its own sync

    await uploadPendingChanges(); // reconnect: the upload run goes first
    const result = await syncWaitingUpdate(phone);
    expect(result.itemOutcomes?.['project-update-u1']).toBe('uploaded');
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
    const shown = await realtimeEcho(phone);
    expect(shown).toMatchObject({ notes: EDIT, status: 'sent' });
    expect(documentIds(shown)).toEqual(['survey']);
  });

  it('S1b: the waiting-update sync stages it first: the edit goes up with the document change', async () => {
    const phone = await editWhoseQueueWriteWasLost();
    await phone.deleteFromThisDevice('permit');

    const result = await syncWaitingUpdate(phone);
    expect(result.itemOutcomes?.['project-update-u1']).toBe('uploaded');
    expect(phone.saved()?.status).toBe('sent');
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(documentIds(inCloud())).toEqual(['survey']);
    const shown = await realtimeEcho(phone);
    expect(shown).toMatchObject({ notes: EDIT, status: 'sent' });
    expect(documentIds(shown)).toEqual(['survey']);
  });

  it('S1a, a document upload finishing instead of a delete: the edit and the upload state both reach the cloud', async () => {
    const phone = await editWhoseQueueWriteWasLost(() => [phoneDocument('permit', { status: 'failed' })]);
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();

    await uploadPendingChanges();
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: EDIT, status: 'sent' });
  });

  it('S1c: the document change came first, on the sent update; then the edit whose queue write was lost: staging sends the edit', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit'); // a patch on the sent copy waits
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, notes: EDIT, status: 'queued' } : update));
    phone.render();

    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: EDIT, status: 'sent' });
  });

  it('S1, a refresh before either sync: the queued whole copy holds the phone\'s edit on screen, and it goes up', async () => {
    const phone = await editWhoseQueueWriteWasLost();
    await phone.deleteFromThisDevice('permit');
    const item = await queuedFor();
    expect((item!.payload as Record<string, unknown>).documentPatches).toBeUndefined(); // the whole copy, with the change
    expect((item!.payload as { updateData: Update }).updateData).toMatchObject({ notes: EDIT });

    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: EDIT });
    expect(documentIds(phone.saved())).toEqual(['survey']);
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('a Retry of an update an earlier build left "Waiting to Sync" keeps its waiting patch: a Retry\'s stamps are not an edit', async () => {
    const { phone } = await phoneTakesPermitOff();
    leftWaitingByAnEarlierBuild(phone);
    // As retryQueuedUpdate stamps it.
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1'
      ? { ...update, sendAttempts: 2, lastSendAttemptAt: '2026-09-30T08:00:00.000Z', stableSendId: 'send-u1', idempotencyKey: 'send-u1' }
      : update));
    phone.render();

    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('an update in conflict still sends only the patch: the phone\'s edit waits for review (A4 pass 9 L1 holds)', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phoneEdit = { ...sent, notes: 'Pour, 40 yards (typed on the phone)', status: 'queued' };
    await queueProjectUpdateRecord(phoneEdit, false);
    const queuedAt = Date.parse((await queuedFor())!.changedAt);
    // The iPad's edit reaches the cloud just after the phone queued its own.
    putInCloud({ ...sent, notes: IPAD_NOTE }, new Date(queuedAt + 1).toISOString());
    await uploadPendingChanges();
    expect(await getSyncConflicts()).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 5)); // a later change would now be newer than the iPad's

    const phone = device([uploaded('permit'), uploaded('survey')], [{ ...phoneEdit, status: 'failed' }]);
    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  });

  it('the sent-update path is unchanged: the document change goes up as a patch, and the iPad keeps its note', async () => {
    const { phone } = await phoneTakesPermitOff();
    const item = await queuedFor();
    expect((item!.payload as Record<string, unknown>).documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    await uploadPendingChanges();
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
  });
});

/**
 * A4 pass 10 R2H-3: an update in conflict keeps the conflict after a document
 * change (A4 pass 9 L1). Keep Phone and Keep Cloud then wrote the copy
 * recorded with the conflict, from before the change: the cloud listed the
 * document taken off again, or read its finished upload as failed.
 */
const PHONE_NOTE = 'Pour, 40 yards (typed on the phone)';
async function phoneEditInConflict(documents: () => Doc[]) {
  const sent = savedUpdate(documents());
  putInCloud(sent);
  const phoneEdit = { ...sent, notes: PHONE_NOTE, status: 'queued' };
  await queueProjectUpdateRecord(phoneEdit, false);
  const queuedAt = Date.parse((await queuedFor())!.changedAt);
  // The iPad's edit reaches the cloud just after the phone queued its own.
  putInCloud({ ...sent, notes: IPAD_NOTE }, new Date(queuedAt + 1).toISOString());
  await uploadPendingChanges();
  const [conflict] = await getSyncConflicts();
  expect(conflict).toMatchObject({ localId: 'u1' });
  await new Promise(resolve => setTimeout(resolve, 5)); // the resolution's write is newer than the iPad's
  const phone = device(documents(), [{ ...phoneEdit, status: 'failed' }]);
  /** The App's own document list, as it persists it. */
  const persistDocuments = () => mockStorage.set('projectPhotoUpdate.projectDocuments.v1', JSON.stringify(phone.projectDocumentsCurrentRef.current));
  persistDocuments();
  return { phone, conflict, persistDocuments };
}

describe('Keep Phone and Keep Cloud keep a document change made while the update was in conflict (audit A4 pass 10 R2H-3)', () => {
  it.each([
    ['keep_local', PHONE_NOTE],
    ['keep_cloud', IPAD_NOTE],
  ] as const)('a document taken off, its patch already in the cloud: %s writes the chosen note without it', async (resolution, note) => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']);

    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, resolution);
    expect(inCloud()).toMatchObject({ notes: note });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(documentIds(chosen)).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it.each(['keep_local', 'keep_cloud'] as const)('a document taken off while offline, its patch still waiting: %s writes the chosen copy without it', async resolution => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);

    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, resolution);
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(documentIds(chosen)).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it.each(['keep_local', 'keep_cloud'] as const)('a document upload that finished, its patch already in the cloud: %s writes it uploaded', async resolution => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [phoneDocument('permit', { status: 'failed' })]);
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();
    persistDocuments();
    await uploadPendingChanges();
    expect(inCloud().documents![0]).toMatchObject({ status: 'uploaded' });

    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, resolution);
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
    expect(chosen.documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
  });
});

describe('Keep Cloud takes a finished upload still waiting to go up (audit A4 pass 10 R2H-3)', () => {
  it('the waiting patch is the newest word on the document, over the document list the App last stored', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [phoneDocument('permit', { status: 'failed' })]);
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle(); // offline: the patch waits; the stored list still reads failed

    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(inCloud().documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
    expect(chosen.documents).toEqual([expect.objectContaining({ id: 'permit', status: 'uploaded' })]);
  });
});

describe('a document change on a sent update that failed to upload shows on its card (audit A7 pass 8 L2)', () => {
  it('the patch upload is refused: the update still reads Sent, and its card says the document change waits; gone once it uploads', async () => {
    const { phone } = await phoneTakesPermitOff();
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1').shown).toBe(false); // just queued

    (saveProjectUpdate as jest.Mock).mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'permission denied for table project_updates' });
    await uploadPendingChanges();
    expect(phone.saved()?.status).toBe('sent');
    expect((await queuedFor())!.lastError).toBeTruthy();
    expect(documentIds(inCloud())).toEqual(['permit', 'survey']); // the iPad still lists it
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1')).toMatchObject({ shown: true });
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u2')).toEqual({ shown: false, shownAt: null });

    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1')).toEqual({ shown: false, shownAt: null });
  });

  it('a patch still waiting after two minutes shows too; the update\'s own waiting record does not (it reads Waiting to Sync)', async () => {
    await phoneTakesPermitOff();
    const queued = Date.parse((await queuedFor())!.createdAt);
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1', queued + 119_000).shown).toBe(false);
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1', queued + 120_000).shown).toBe(true);

    mockStorage.clear();
    await queueProjectUpdateRecord({ ...savedUpdate([uploaded('survey')], 'queued'), notes: 'Pour, 40 yards' }, false);
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1', queued + 600_000)).toEqual({ shown: false, shownAt: null });
  });
});

/**
 * A7 pass 9 L1, with A4 pass 11 L1: the "Waiting to Sync" or failed status
 * of an update can be stale, its own record already in the cloud. A document
 * change then took it for an edit whose queue write was lost (A7 pass 8 L1)
 * and sent the phone's whole older copy, stamped now, over the iPad's newer
 * note, with no conflict raised:
 * (a) its record went up in a background upload pass whose realtime echo
 *     arrived while it was still queued, and was ignored;
 * (a2) Keep Phone left the card failed;
 * (b) a refresh or a realtime echo while a document change waited turned a
 *     Sent update into "Waiting to Sync" (the cloud row's 'queued').
 */
const IPAD_SECOND_NOTE = 'Pour moved to Wednesday (typed on the iPad again)';
/** The iPad's edit lands now; this phone's next write is later still. */
async function iPadEditsNow(note: string, id = 'u1') {
  putInCloud({ ...inCloud(id), notes: note }, new Date().toISOString());
  await new Promise(resolve => setTimeout(resolve, 5));
}
/** The realtime echo of the next save arrives while its record is still queued, and is ignored. */
function echoWhileStillQueued(phone: Device) {
  const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
  const seen: Array<Update | undefined> = [];
  (saveProjectUpdate as jest.Mock).mockImplementationOnce(async (params: { id: string }) => {
    const result = await save(params);
    seen.push(await realtimeEcho(phone, params.id));
    return result;
  });
  return seen;
}
/**
 * Keep Phone or Keep Cloud in Settings: AdminScreen's own resolveConflict, then the App's own handler for the chosen copy.
 * `onRetryUpdateSync`: what Settings' Retry callback does (A4 pass 17 L2); by default nothing, so the test runs the syncs itself.
 */
async function chooseInSettings(
  phone: Device, conflict: { id: string }, resolution: 'keep_local' | 'keep_cloud',
  onRetryUpdateSync: (...args: unknown[]) => Promise<unknown> = jest.fn(async () => ({})),
  /** What happens on the phone while the choice talks to the cloud (A4 pass 18 L1). */
  duringChoice?: () => Promise<void>,
) {
  const applyChosen = evaluate<(update: Update) => void>(
    transpile(`module.exports = function (update) ${blockAfter('onApplyCloudConflictUpdate={update => {')}`),
    {
      normalizeStoredUpdateRecord: A.normalizeStoredUpdateRecord, setSavedUpdates: phone.setSavedUpdates,
      mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones, deletedUpdateTombstonesRef: { current: [] },
    },
  );
  const alerts: string[] = [];
  const { resolveConflict } = evaluate<{ resolveConflict: (conflict: unknown, resolution: string) => Promise<void> }>(
    transpile(`${componentFunction('resolveConflict', adminScreen)}\nmodule.exports = { resolveConflict };`),
    {
      setResolvingConflictId: () => undefined, resolveScheduleItemSyncConflict: jest.fn(), onApplyCloudConflictScheduleItem: jest.fn(),
      resolveProjectUpdateSyncConflict: duringChoice
        ? async (...args: Parameters<typeof resolveProjectUpdateSyncConflict>) => {
          const resolved = await resolveProjectUpdateSyncConflict(...args);
          await duringChoice();
          return resolved;
        }
        : resolveProjectUpdateSyncConflict,
      syncConflictChoiceStopReason, onApplyCloudConflictUpdate: applyChosen, savedUpdates: phone.savedUpdatesRef.current,
      savedUpdatesRef: phone.savedUpdatesRef, projectUpdateCopyIsLastInCloud, onRetryUpdateSync,
      getSyncConflicts, getSyncStatus: async () => null, setSyncConflicts: () => undefined, setSyncStatus: () => undefined,
      setSyncAttemptMessage: () => undefined, setConflictReviewVisible: () => undefined,
      Alert: { alert: (title: string) => { alerts.push(title); } },
    },
  );
  await resolveConflict((await getSyncConflicts()).find(item => item.id === conflict.id), resolution);
  phone.render();
  expect(alerts).toEqual([]);
}

/**
 * A4 pass 16 L3 (A7 pass 14 M-1): a choice made while the conflict still
 * holds an older cloud copy than the cloud's sends nothing; the conflict takes
 * the cloud's copy, which Review Conflicts then shows, and David chooses again.
 */
async function reviewAgainAfterIPadEdit(conflictId: string, resolution: 'keep_local' | 'keep_cloud', cloudNote: string) {
  const cloudBefore = JSON.stringify(mockCloud.get('u1'));
  await expect(resolveProjectUpdateSyncConflict<Update>(conflictId, resolution)).rejects.toThrow('sync_conflict_cloud_copy_changed');
  expect(JSON.stringify(mockCloud.get('u1'))).toBe(cloudBefore);
  expect(await getSyncConflicts()).toEqual([expect.objectContaining({
    id: conflictId, remotePayload: expect.objectContaining({ notes: cloudNote }),
  })]);
}

describe('a stale "Waiting to Sync" or failed status does not send the phone\'s older copy over the iPad\'s note (audit A7 pass 9 L1)', () => {
  it.each([
    ['the upload run lands first', true],
    ['the waiting-update sync stages it first', false],
  ])('X1c: its record went up in a background pass whose echo was ignored; the iPad edits; a document comes off: the iPad keeps its note, the phone shows it, Sent (%s)', async (_label, uploadFirst) => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const edited = { ...sent, notes: EDIT, status: 'queued' };
    const phone = device([uploaded('permit'), uploaded('survey')], [edited]);
    await queueProjectUpdateRecord(edited, false);
    const echoes = echoWhileStillQueued(phone);
    await uploadPendingChanges(); // a background pass
    expect(echoes).toEqual([expect.objectContaining({ notes: EDIT, status: 'queued' })]); // ignored: still queued then
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(await getOfflineQueue()).toEqual([]);

    await iPadEditsNow(IPAD_NOTE);
    // It still appears to owe its own sync, so the echo leaves its content.
    expect(await realtimeEcho(phone)).toMatchObject({ notes: EDIT, status: 'queued' });

    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    if (uploadFirst) await uploadPendingChanges();
    await syncWaitingUpdate(phone); // the waiting-update sync it asked for
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    const shown = await realtimeEcho(phone);
    expect(shown).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(documentIds(shown)).toEqual(['survey']);
  });

  it('X2: Keep Phone, then the iPad edits again and this phone misses it; a document comes off the card Keep Phone left failed: the iPad keeps its note', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local'); // the card stays failed, as an earlier build left it
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(phone.saved()?.status).toBe('failed');

    await iPadEditsNow(IPAD_SECOND_NOTE);
    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('X2: Keep Phone in Settings shows the kept copy as Sent; after a relaunch a document change still goes up as a patch', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(phone.saved()).toMatchObject({ notes: PHONE_NOTE, status: 'sent' });
    expect(A.updateNeedsAutomaticSyncRetry(phone.saved()!)).toBe(false);

    resetFieldUpdateSyncMemoryForTests(); // a relaunch: nothing held in memory
    await iPadEditsNow(IPAD_SECOND_NOTE);
    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_SECOND_NOTE, status: 'sent' });
  });

  it('Keep Phone in Settings after a document came off during the conflict: Sent, without the document', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(phone.saved()).toMatchObject({ notes: PHONE_NOTE, status: 'sent' });
    expect(documentIds(phone.saved())).toEqual(['survey']);
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('Keep Phone in Settings leaves a newer edit made on the phone since the conflict as it is: it still owes its own sync', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    const newer = { ...phone.saved()!, notes: 'Pour, 45 yards (typed on the phone after the conflict)' };
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? newer : update));
    phone.render();
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(phone.saved()).toMatchObject({ notes: newer.notes, status: 'failed' });
    // A document change then sends that edit whole: it was never sent.
    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toBeUndefined();
  });

  it('a failed update with a photo, its record since sent by a background pass: a document taken off reaches the iPad on its own, without a Retry', async () => {
    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl);
    const photo = { id: 'photo-failed', uri: 'file:///phone/Documents/project-photos/failed.jpg', caption: '', createdAt: SENT_AT };
    const sent = { ...savedUpdate([uploaded('permit'), uploaded('survey')]), photos: [photo] };
    putInCloud(sent);
    const edited = { ...sent, notes: EDIT, status: 'queued' };
    const phone = device([uploaded('permit'), uploaded('survey')], [edited]);
    (saveProjectUpdate as jest.Mock).mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'permission denied for table project_updates' });
    await syncWaitingUpdate(phone); // the photo is checked; the save is refused
    expect((await queuedFor())!.payload.pendingPhotoAssetIds).toEqual([]);
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, status: 'failed' } : update));
    phone.render();
    await uploadPendingChanges(); // a background pass sends it; this phone misses its echo
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(phone.saved()?.status).toBe('failed');

    await iPadEditsNow(IPAD_NOTE);
    await phone.deleteFromThisDevice('permit');
    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']); // the iPad sees it
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it.each([
    ['the phone\'s sync runs first (P1r, F1-A)', 'sync'],
    ['the removal uploads first (F1-B)', 'upload'],
  ])('a refresh while a removal waits keeps the update Sent; the iPad edits again: its second edit stays (%s)', async (_label, first) => {
    const { phone } = await phoneTakesPermitOff();
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(documentIds(phone.saved())).toEqual(['survey']);
    expect(A.updateNeedsAutomaticSyncRetry(phone.saved()!)).toBe(false); // no waiting-update sync follows

    await iPadEditsNow(IPAD_SECOND_NOTE);
    if (first === 'sync') await syncWaitingUpdate(phone); // a sync attempt, had one run
    else await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_SECOND_NOTE, status: 'sent' });
  });

  it('F2: a realtime echo of the iPad\'s edit while a removal waits keeps the update Sent; the iPad edits again: its second edit stays', async () => {
    const { phone } = await phoneTakesPermitOff();
    const shown = await realtimeEcho(phone);
    expect(shown).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(documentIds(shown)).toEqual(['survey']);

    await iPadEditsNow(IPAD_SECOND_NOTE);
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('F3: the iPad\'s older copy lists the document again; the refresh takes it off again as a patch, and the iPad\'s next edit stays', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']);

    // The iPad, offline since before the delete, sends its own edit of its older copy.
    putInCloud({ ...sent, notes: IPAD_NOTE }, new Date().toISOString());
    await refresh(phone);
    await phone.settle();
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect((await queuedFor())!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);

    await iPadEditsNow(IPAD_SECOND_NOTE);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('G1: an update in conflict; a document comes off; the iPad\'s edit echoes: the conflict stays, with the phone\'s note for Keep Phone', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await iPadEditsNow(IPAD_SECOND_NOTE);
    await realtimeEcho(phone);
    if (A.updateNeedsAutomaticSyncRetry(phone.saved()!)) await syncWaitingUpdate(phone); // as the App's waiting-update sync would
    await uploadPendingChanges();

    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({
      localId: 'u1',
      localPayload: expect.objectContaining({ updateData: expect.objectContaining({ notes: PHONE_NOTE }) }),
    })]);
    // Pin changed in A4 pass 16 L3 (A7 pass 14 M-1): the conflict still showed
    // the iPad's first note, and Keep Phone put the phone's copy over its
    // second without it ever being shown. Now it sends nothing, the conflict
    // takes the cloud's copy, and Keep Phone chosen again goes ahead.
    await reviewAgainAfterIPadEdit(conflict.id, 'keep_local', IPAD_SECOND_NOTE);
    await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('the lost-queue-write protection holds when the copy in the cloud is known: an edit beyond it still goes up whole', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey')]);
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await queueProjectUpdateRecord(sent, false);
    await uploadPendingChanges(); // this device's copy is in the cloud, and known to be
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, notes: EDIT, status: 'queued' } : update));
    phone.render(); // its queue write lost
    await phone.deleteFromThisDevice('permit');
    expect((await queuedFor())!.payload.documentPatches).toBeUndefined();
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('a second document change on an update whose first went up as a patch, its status still stale: a patch again', async () => {
    const sent = savedUpdate([uploaded('permit'), uploaded('survey'), uploaded('plan')]);
    putInCloud(sent);
    const edited = { ...sent, notes: EDIT, status: 'queued' };
    const phone = device([uploaded('permit'), uploaded('survey'), uploaded('plan')], [edited]);
    await queueProjectUpdateRecord(edited, false);
    await uploadPendingChanges();
    await iPadEditsNow(IPAD_NOTE);
    await phone.deleteFromThisDevice('permit');
    await phone.deleteFromThisDevice('plan');
    expect((await queuedFor())!.payload.documentPatches).toEqual([
      { documentId: 'permit', remove: true }, { documentId: 'plan', remove: true },
    ]);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });
});

describe('Keep Cloud takes the cloud\'s copy as it is now (audit A4 pass 11 O1)', () => {
  it('an iPad edit made after the conflict was found stays in the cloud and comes to the phone', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await iPadEditsNow(IPAD_SECOND_NOTE);
    // Pin changed in A4 pass 16 L3 (A7 pass 14 M-1): shown first, then kept.
    await reviewAgainAfterIPadEdit(conflict.id, 'keep_cloud', IPAD_SECOND_NOTE);
    await chooseInSettings(phone, conflict, 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(phone.saved()).toMatchObject({ notes: IPAD_SECOND_NOTE, status: 'sent' });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('with a document change waiting: the change goes onto the cloud\'s current copy', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await iPadEditsNow(IPAD_SECOND_NOTE);
    await reviewAgainAfterIPadEdit(conflict.id, 'keep_cloud', IPAD_SECOND_NOTE); // pin changed in A4 pass 16 L3: shown first
    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(chosen).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(documentIds(chosen)).toEqual(['survey']);
  });

  it('a retry of the phone\'s copy that reached the cloud meanwhile does not become the cloud\'s choice', async () => {
    const { conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    putInCloud({ ...inCloud(), notes: PHONE_NOTE }, new Date().toISOString()); // the phone's own copy, sent by a retry
    const chosen = await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud');
    expect(chosen).toMatchObject({ notes: IPAD_NOTE });
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });

  it('the cloud cannot be read: neither copy changes', async () => {
    const { conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await iPadEditsNow(IPAD_SECOND_NOTE);
    const { getProjectUpdateSyncMetadata } = jest.requireMock('../../services/SupabaseService') as { getProjectUpdateSyncMetadata: jest.Mock };
    getProjectUpdateSyncMetadata.mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
    await expect(resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud')).rejects.toThrow();
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
  });
});

describe('archiving a Sent update while a document change waits keeps the change (audit A4 pass 11 O2)', () => {
  it('the archived cloud copy no longer lists the document taken off', async () => {
    (archiveProjectUpdate as jest.Mock).mockImplementationOnce(async ({ id, archivedAt }: { id: string; archivedAt: string }) => {
      const row = mockCloud.get(id)!;
      mockCloud.set(id, { updatedAt: archivedAt, updateData: { ...row.updateData, isArchived: true, archivedAt } });
      return { ok: true, configured: true, stubbed: false, data: null };
    });
    const { phone } = await phoneTakesPermitOff();
    const archivedAt = new Date().toISOString();
    // As the App's Archive does: its tombstone is replayed into the queue.
    await reconcileProjectUpdateDeletionJournal([A.buildUpdateTombstone(phone.saved()!, 'archive_sent_update', archivedAt)]);
    expect((await queuedFor())!.payload).toMatchObject({ archiveOnly: true, documentPatches: [{ documentId: 'permit', remove: true }] });

    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ isArchived: true, archivedAt, notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('an archive with nothing waiting is unchanged', async () => {
    const sent = savedUpdate([uploaded('permit')]);
    putInCloud(sent);
    await reconcileProjectUpdateDeletionJournal([A.buildUpdateTombstone(sent, 'archive_sent_update', SENT_AT)]);
    const payload = (await queuedFor())!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ archiveOnly: true });
    expect(payload.documentPatches).toBeUndefined();
  });
});

/**
 * A4 pass 12 H1 (A7 pass 10 L-3): David sends an update, then, before the
 * next full refresh, edits it on weak signal. The project list loads but the
 * photo check or upload fails. The upload pass writes the cloud project id
 * into the queued copy, which then waits on its photos; the card never had
 * that id, so the refresh no longer matched the two, put the cloud's older
 * copy on the card as Sent, and nothing sent the edit again.
 */
const CLOUD_PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const photoCheckFails = { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
const supabaseMock = () => jest.requireMock('../../services/SupabaseService') as Record<string, unknown>;
const fileSystemMock = () => jest.requireMock('expo-file-system/legacy') as { getInfoAsync: jest.Mock };

/** Sent through the waiting-update sync, as David's Send does; the card reads Sent, without the cloud project id. */
async function sentThroughTheApp(photos: Array<{ id: string } & Record<string, unknown>>) {
  (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl); // its photos are in the cloud
  const first = { ...savedUpdate([], 'queued'), photos };
  const phone = device([], [first]);
  await queueProjectUpdateRecord(first, false);
  await syncWaitingUpdate(phone);
  expect(phone.saved()).toMatchObject({ status: 'sent', notes: 'Pour' });
  expect(phone.saved()?.projectId).toBeUndefined();
  expect(inCloud()).toMatchObject({ notes: 'Pour', projectId: CLOUD_PROJECT_ID });
  return phone;
}
/** David reopens it, edits it and saves: the card and its queue record, as the App's save writes them. */
async function editAndSave(phone: Device, change: Partial<Update>) {
  const edited = { ...phone.saved()!, ...change, status: 'queued' };
  phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? edited : update));
  phone.render();
  await queueProjectUpdateRecord(edited, false);
  return edited;
}
/** Refresh, another upload pass, a relaunch: the edit stays Waiting to Sync on the card, its queued copy intact. */
async function editSurvivesWeakSignal(phone: Device, note: string, photoIds: string[]) {
  const stillWaiting = async () => {
    expect(phone.saved()).toMatchObject({ notes: note, status: 'queued' });
    expect((phone.saved()!.photos as Array<{ id: string }>).map(photo => photo.id)).toEqual(photoIds);
    expect(A.updateNeedsAutomaticSyncRetry(phone.saved()!)).toBe(true); // the waiting-update sync retries it
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(note);
  };
  await refresh(phone);
  await stillWaiting();
  await uploadPendingChanges(); // another upload pass: still waiting on the photo
  await refresh(phone);
  await stillWaiting();
  resetFieldUpdateSyncMemoryForTests(); // a relaunch: nothing held in memory
  await refresh(phone);
  await stillWaiting();
  expect(inCloud()).toMatchObject({ notes: 'Pour' });
}

describe('an edit of a Sent update waiting on its photos stays Waiting to Sync through a refresh (audit A4 pass 12 H1)', () => {
  it('R6: a note-only edit whose photo re-check fails: stays waiting through a refresh, an upload pass and a relaunch, and reaches the cloud when the signal returns', async () => {
    const photo = { id: 'photo-r6', uri: 'file:///phone/Documents/project-photos/r6.jpg', caption: '', createdAt: SENT_AT };
    const phone = await sentThroughTheApp([photo]);
    await editAndSave(phone, { notes: EDIT });

    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(photoCheckFails); // weak signal: the project list loads, the photo check fails
    await syncWaitingUpdate(phone);
    const waiting = await queuedFor();
    expect(waiting!.payload).toMatchObject({ projectId: CLOUD_PROJECT_ID, pendingPhotoAssetIds: ['photo-r6'] });
    expect((waiting!.payload.updateData as Update).projectId).toBe(CLOUD_PROJECT_ID); // bound by the upload pass
    expect(phone.saved()?.projectId).toBeUndefined();

    await editSurvivesWeakSignal(phone, EDIT, ['photo-r6']);

    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl); // the signal returns
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: EDIT });
    expect(await getOfflineQueue()).toEqual([]);
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: EDIT, status: 'sent' });
  });

  it('R5: a new photo whose upload fails: stays waiting through a refresh, an upload pass and a relaunch, and reaches the cloud when the signal returns', async () => {
    const phone = await sentThroughTheApp([]);
    const added = { id: 'photo-r5', uri: 'file:///phone/Documents/project-photos/r5.jpg', caption: '', createdAt: SENT_AT };
    await editAndSave(phone, { notes: EDIT, photos: [added] });

    const notInCloudYet = { ok: false, configured: true, stubbed: false, error: 'Object not found', status: 404 };
    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(notInCloudYet);
    fileSystemMock().getInfoAsync.mockImplementation(async (uri: string) =>
      uri === added.uri ? { exists: true, size: 2048 } : { exists: false });
    const upload = jest.spyOn(supabaseMock() as { uploadPhoto: (...args: unknown[]) => Promise<unknown> }, 'uploadPhoto')
      .mockResolvedValue(photoCheckFails); // weak signal: the upload fails
    try {
      await syncWaitingUpdate(phone);
      expect(upload).toHaveBeenCalled();
      expect((await queuedFor())!.payload).toMatchObject({ projectId: CLOUD_PROJECT_ID, pendingPhotoAssetIds: ['photo-r5'] });

      await editSurvivesWeakSignal(phone, EDIT, ['photo-r5']);

      upload.mockResolvedValue({ ok: true, configured: true, stubbed: false, data: { path: 'uploaded' } }); // the signal returns
      await syncWaitingUpdate(phone);
      expect(inCloud()).toMatchObject({ notes: EDIT });
      expect(inCloud().photos).toEqual([expect.objectContaining({ id: 'photo-r5' })]);
      expect(await getOfflineQueue()).toEqual([]);
      (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl);
      await refresh(phone);
      expect(phone.saved()).toMatchObject({ notes: EDIT, status: 'sent' });
    } finally {
      upload.mockRestore();
      fileSystemMock().getInfoAsync.mockImplementation(async () => ({ exists: false }));
    }
  });
});

describe('a refresh keeps a card whose own queued copy still waits (audit A4 pass 12 H1, the deeper weakness)', () => {
  it('a second edit whose queue write was lost while the first waits on its photo: the refresh keeps it, and the waiting-update sync sends it', async () => {
    const photo = { id: 'photo-r7', uri: 'file:///phone/Documents/project-photos/r7.jpg', caption: '', createdAt: SENT_AT };
    const phone = await sentThroughTheApp([photo]);
    await editAndSave(phone, { notes: EDIT });
    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(photoCheckFails);
    await syncWaitingUpdate(phone);
    const SECOND = 'Pour, 45 yards (edited again)';
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, notes: SECOND } : update));
    phone.render(); // its queue write lost; the first edit is still queued

    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: SECOND, status: 'queued' });

    (createPhotoSignedUrl as jest.Mock).mockResolvedValue(signedUrl);
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: SECOND });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('a Sent card with no edit of its own still takes the iPad\'s newer copy while a whole copy of it is queued', async () => {
    const sent = savedUpdate([uploaded('permit')]);
    putInCloud(sent);
    const phone = device([uploaded('permit')], [sent]);
    await queueProjectUpdateRecord({ ...sent, notes: 'an older queued copy' }, false);
    iPadEditsNotes();
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
  });
});

/**
 * A4 pass 12 L1 (A7 pass 10 L-1): Keep Cloud took this update's waiting work
 * off the queue before it read the cloud's copy. When that read failed,
 * Settings said "Neither copy was changed", but a newer phone edit or a
 * waiting document change was already gone from the queue.
 */
describe('Keep Cloud with an unreadable cloud leaves the phone\'s waiting work queued (audit A4 pass 12 L1)', () => {
  const cloudReadFailsOnce = () => (jest.requireMock('../../services/SupabaseService') as { getProjectUpdateSyncMetadata: jest.Mock })
    .getProjectUpdateSyncMetadata.mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });

  it('a newer phone edit made since the conflict stays queued', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    const NEWER = 'Pour, 45 yards (typed on the phone after the conflict)';
    await editAndSave(phone, { notes: NEWER });
    cloudReadFailsOnce();
    await expect(chooseInSettingsExpectingFailure(phone, conflict, 'keep_cloud')).resolves.toEqual(['Conflict not resolved']);
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });

  it('a document taken off since the conflict stays queued', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    const before = await queuedFor();
    expect(before).toBeDefined();
    cloudReadFailsOnce();
    await expect(resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud')).rejects.toThrow('sync_conflict_cloud_copy_unreadable');
    expect(await queuedFor()).toEqual(before);
  });
});

/** As chooseInSettings, for a choice that fails: the alerts Settings shows. */
async function chooseInSettingsExpectingFailure(phone: Device, conflict: { id: string }, resolution: 'keep_local' | 'keep_cloud') {
  const alerts: string[] = [];
  const { resolveConflict } = evaluate<{ resolveConflict: (conflict: unknown, resolution: string) => Promise<void> }>(
    transpile(`${componentFunction('resolveConflict', adminScreen)}\nmodule.exports = { resolveConflict };`),
    {
      setResolvingConflictId: () => undefined, resolveScheduleItemSyncConflict: jest.fn(), onApplyCloudConflictScheduleItem: jest.fn(),
      resolveProjectUpdateSyncConflict, syncConflictChoiceStopReason, onApplyCloudConflictUpdate: jest.fn(), savedUpdates: phone.savedUpdatesRef.current,
      savedUpdatesRef: phone.savedUpdatesRef,
      projectUpdateCopyIsLastInCloud, onRetryUpdateSync: jest.fn(async () => ({})), // Settings' Retry callback (A4 pass 17 L2)
      getSyncConflicts, getSyncStatus: async () => null, setSyncConflicts: () => undefined, setSyncStatus: () => undefined,
      setSyncAttemptMessage: () => undefined, setConflictReviewVisible: () => undefined,
      Alert: { alert: (title: string) => { alerts.push(title); } },
    },
  );
  await resolveConflict((await getSyncConflicts()).find(item => item.id === conflict.id), resolution);
  return alerts;
}

/**
 * A4 pass 12 L2 (A7 pass 10 L-2): a document change waiting for an update
 * the cloud reads archived was dropped. The refresh turns this phone's
 * "archived here" record into "hidden, archived in the cloud" (records are
 * replaced by update id), and the next full replay of the records (a
 * relaunch, deleting another update or a project) dropped the update's whole
 * queue item, the change with it. The re-queue of removed documents skips
 * archived copies, so nothing put it back.
 */
describe('a document change waiting for an update archived in the cloud still reaches its archived copy (audit A4 pass 12 L2)', () => {
  /** The refresh, with this phone's own records of updates taken off its list. */
  async function refreshWithRecords(phone: Device, records: { current: unknown[] }) {
    await refresh(phone, { deletedUpdateTombstonesRef: records, setDeletedUpdateTombstones: (next: unknown[]) => { records.current = next; } });
    return records.current as Array<{ updateId: string; action: string; deletedAt: string }>;
  }
  const archiveTheRow = ({ id, archivedAt }: { id: string; archivedAt: string }) => {
    const row = mockCloud.get(id)!;
    mockCloud.set(id, { updatedAt: archivedAt, updateData: { ...row.updateData, isArchived: true, archivedAt } });
    return { ok: true, configured: true, stubbed: false, data: null };
  };

  it('archived on this phone, the archive saved but the removal\'s save failed; a refresh, then a relaunch: the removal still goes up', async () => {
    const { phone } = await phoneTakesPermitOff();
    const archivedAt = new Date().toISOString();
    const records = { current: [A.buildUpdateTombstone(phone.saved()!, 'archive_sent_update', archivedAt)] as unknown[] };
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    try {
      // Weak signal: the archive is saved, every other save fails, until the relaunch.
      (archiveProjectUpdate as jest.Mock).mockImplementationOnce(async (params: { id: string; archivedAt: string }) => archiveTheRow(params));
      (saveProjectUpdate as jest.Mock).mockResolvedValue({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
      await reconcileProjectUpdateDeletionJournal(records.current as never);
      await uploadPendingChanges();
      await uploadPendingChanges(); // and any pass the archive's queueing asked for
      expect(inCloud()).toMatchObject({ isArchived: true, archivedAt });
      expect(documentIds(inCloud())).toEqual(['permit', 'survey']); // the removal's save failed
      expect((await queuedFor())!.payload).toMatchObject({ archiveOnly: true, documentPatches: [{ documentId: 'permit', remove: true }] });

      expect(await refreshWithRecords(phone, records)).toEqual([expect.objectContaining({ updateId: 'u1', action: 'hide_cloud_update' })]);
      resetFieldUpdateSyncMemoryForTests(); // a relaunch replays the records
      await reconcileProjectUpdateDeletionJournal(records.current as never);
      expect((await queuedFor())!.payload).toMatchObject({ documentPatches: [{ documentId: 'permit', remove: true }] });
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
    await uploadPendingChanges(); // the signal returns
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(inCloud()).toMatchObject({ isArchived: true, archivedAt, notes: IPAD_NOTE });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('archived on the iPad while a removal waits on the phone; a refresh, then a relaunch: the removal goes onto the archived copy', async () => {
    const { phone } = await phoneTakesPermitOff();
    const archivedAt = new Date().toISOString();
    putInCloud({ ...inCloud(), isArchived: true, archivedAt }, archivedAt); // the iPad archives it
    const records = { current: [] as unknown[] };
    expect(await refreshWithRecords(phone, records)).toEqual([expect.objectContaining({ updateId: 'u1', action: 'hide_cloud_update' })]);

    resetFieldUpdateSyncMemoryForTests();
    await reconcileProjectUpdateDeletionJournal(records.current as never);
    expect((await queuedFor())!.payload).toMatchObject({ documentPatches: [{ documentId: 'permit', remove: true }] });
    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(inCloud()).toMatchObject({ isArchived: true, archivedAt, notes: IPAD_NOTE });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('an update archived in the cloud with only its own record waiting: the record is still dropped, and the cloud copy is not written', async () => {
    const sent = savedUpdate([uploaded('permit')]);
    const archivedAt = new Date().toISOString();
    putInCloud({ ...sent, isArchived: true, archivedAt }, archivedAt);
    await queueProjectUpdateRecord({ ...sent, notes: EDIT, status: 'queued' }, false);
    (saveProjectUpdate as jest.Mock).mockClear();
    await reconcileProjectUpdateDeletionJournal([A.buildUpdateTombstone({ ...sent, isArchived: true, archivedAt }, 'hide_cloud_update', archivedAt)]);
    expect(await getOfflineQueue()).toEqual([]);
    await uploadPendingChanges();
    expect(saveProjectUpdate).not.toHaveBeenCalled();
  });
});

/**
 * A4 pass 12 L3 (A7 pass 10 L-5): during a conflict nothing is queued for
 * the update, so a refresh shows the iPad's copy on the card, as Sent. Keep
 * Phone then took that card for a newer edit made on the phone and left it,
 * while the cloud now held the phone's note.
 */
describe('Keep Phone after a refresh shows the phone\'s copy on the card (audit A4 pass 12 L3)', () => {
  it('the refresh showed the iPad\'s copy: after Keep Phone the card reads the phone\'s note, Sent', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });

    await chooseInSettings(phone, conflict, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(phone.saved()).toMatchObject({ notes: PHONE_NOTE, status: 'sent' });
    expect(A.updateNeedsAutomaticSyncRetry(phone.saved()!)).toBe(false);
  });

  it('the realtime echo showed the iPad\'s copy: the same', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(phone.saved()).toMatchObject({ notes: PHONE_NOTE, status: 'sent' });
  });
});

/**
 * A7 pass 10 L-4: Keep Phone put the copy recorded with the conflict on the
 * queue over a newer edit David had saved on the phone since, still waiting
 * there. Offline it then said "Neither copy was changed"; once the older
 * copy went up, a refresh before the waiting-update sync showed it as Sent,
 * and the newer edit was lost.
 */
describe('Keep Phone keeps a newer phone edit still waiting in the queue (audit A7 pass 10 L-4)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';

  it('offline: nothing changes, the newer edit stays queued; reconnected, a refresh keeps it, and Keep Phone chosen again sends it', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    try {
      (saveProjectUpdate as jest.Mock).mockResolvedValue({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
      await expect(chooseInSettingsExpectingFailure(phone, conflict, 'keep_local')).resolves.toEqual(['Conflict not resolved']);
      expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);
      expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }

    await uploadPendingChanges(); // reconnected
    await refresh(phone); // before the waiting-update sync
    expect(phone.saved()).toMatchObject({ notes: NEWER });
    // Pin changed in A4 pass 15 H1: the conflict is still open, so the newer
    // edit no longer goes up by itself; it waits for David's choice, and Keep
    // Phone, chosen again, sends it (after the conflict's own copy).
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    await chooseInSettings(phone, conflict, 'keep_local');
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: NEWER });
  });

  it('online: the kept copy goes up, then the newer edit after it; a refresh before the waiting-update sync keeps it', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' }); // still owes its own sync
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);

    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: NEWER });
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('a Retry of the conflict\'s own copy is not a newer edit: nothing is queued after Keep Phone', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await queueProjectUpdateRecord({ ...phone.saved()!, status: 'queued', sendAttempts: 2, lastSendAttemptAt: new Date().toISOString() }, false);
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(await getOfflineQueue()).toEqual([]);
  });
});

/**
 * A4 pass 13 M1: David edits a Sent update on the phone with no signal; the
 * iPad then edits the same update online. When the phone reconnected, its
 * older note replaced the iPad's newer one, with no conflict shown:
 * - with photos, the upload pass skips the edit while it waits on them, and
 *   the waiting-update sync then wrote it again stamped "now": the conflict
 *   check compared the cloud's time with that stamp, so the phone always
 *   read newer;
 * - without photos, the conflict was found, but the card still read Waiting
 *   to Sync, and the waiting-update sync sent the phone's copy whole: an
 *   automatic Keep Phone.
 * Now a sync attempt keeps the time David saved the edit, and the
 * waiting-update sync leaves an update in conflict for Settings (or Retry).
 */
/** The waiting-update sync, as the App runs it: its own hydrateQueuedUpdatesPass and missing-photo repair, compiled from App.tsx. */
async function waitingUpdateSync(phone: Device) {
  const { runAutomaticSyncQueue, shouldPersistAutomaticSyncOutcome } = jest.requireActual('../../services/AutomaticSyncState');
  const { hydrateQueuedUpdatesPass } = evaluate<{ hydrateQueuedUpdatesPass: () => Promise<void> }>(
    transpile([componentFunction('syncFieldUpdateWithMissingPhotoRepair'), componentFunction('hydrateQueuedUpdatesPass'),
      'module.exports = { hydrateQueuedUpdatesPass };'].join('\n')),
    {
      savedUpdatesRef: phone.savedUpdatesRef, updateNeedsAutomaticSyncRetry: A.updateNeedsAutomaticSyncRetry,
      directSyncIsRecent: () => false, queuedHydrationDeferredRerun: { current: null },
      getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
      runAutomaticSyncQueue, shouldPersistAutomaticSyncOutcome, runFieldUpdateCloudSync,
      buildSyncDiagnosticsFromUpload: (result: { uploaded: number; errors: string[]; failureCategory?: string | null }) => ({
        lastSyncResult: result.uploaded > 0 && result.errors.length === 0 ? 'success' : 'failed',
        lastSyncFailureCategory: result.uploaded > 0 && result.errors.length === 0 ? null : result.failureCategory ?? 'unknown',
      }),
      statusForSyncDiagnostics: (diagnostics: { lastSyncResult: string }) => diagnostics.lastSyncResult === 'success' ? 'sent' : 'failed',
      applyFieldUpdateSyncResultIfCurrent: (attempted: Update, next: Update) => {
        phone.setSavedUpdates(prev => prev.map(update => update.id === attempted.id ? next : update));
      },
    },
  );
  await hydrateQueuedUpdatesPass();
  phone.render();
}

describe('a phone edit saved offline does not go over a newer iPad edit (audit A4 pass 13 M1)', () => {
  const OFFLINE_EDIT = 'Pour, 40 yards (typed on the phone with no signal)';
  /** Sent, then edited on the phone offline; the iPad's edit lands after it. */
  async function offlineEditThenIPadEdit(photos: Array<{ id: string } & Record<string, unknown>>) {
    const phone = await sentThroughTheApp(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE); // the phone reconnects later still
    return phone;
  }
  const photo = { id: 'photo-m1', uri: 'file:///phone/Documents/project-photos/m1.jpg', caption: '', createdAt: SENT_AT };

  it('S2a, with photos: the upload pass waits on them; the waiting-update sync finds the conflict, and the iPad keeps its note', async () => {
    const phone = await offlineEditThenIPadEdit([photo]);
    await uploadPendingChanges(); // reconnected: the edit waits on its photos
    expect(await getSyncConflicts()).toEqual([]);

    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT });
  });

  it('S2c, without photos: the upload pass finds the conflict; the waiting-update sync leaves it for Settings', async () => {
    const phone = await offlineEditThenIPadEdit([]);
    await uploadPendingChanges(); // reconnected
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT, status: 'queued' });

    await waitingUpdateSync(phone);
    await waitingUpdateSync(phone); // and again on the next trigger
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT, status: 'queued' }); // left as it was
  });

  it('then Keep Phone, Keep Cloud or Retry still sends it', async () => {
    const phone = await offlineEditThenIPadEdit([]);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    await new Promise(resolve => setTimeout(resolve, 5));
    // Pin changed in A4 pass 15 H1: the card's Retry sends over the conflict
    // once David confirms it ("Send your version over it?"), as it asks.
    await syncWaitingUpdate(phone, 'u1', { overConflict: true }); // Retry on the card, confirmed
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it.each([
    ['with photos', [photo]],
    ['without photos', []],
  ])('an offline edit with no iPad edit still goes up by itself, with no conflict (%s)', async (_label, photos) => {
    const phone = await sentThroughTheApp(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT, status: 'sent' });
  });

  it('a Retry of the waiting edit keeps the time it was saved: the conflict is found, not sent over', async () => {
    const phone = await offlineEditThenIPadEdit([photo]);
    const retried = { ...phone.saved()!, sendAttempts: 2, lastSendAttemptAt: new Date().toISOString() };
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? retried : update));
    phone.render();
    await syncWaitingUpdate(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
  });
});

/**
 * A4 pass 13 L1: Keep Cloud read the cloud's copy before it withdrew this
 * phone's waiting work and ran its own upload pass, then wrote the copy it
 * had read: an iPad save that landed during that pass was overwritten.
 */
describe('Keep Cloud keeps an iPad save that lands while it runs (audit A4 pass 13 L1)', () => {
  const IPAD_THIRD_NOTE = 'Pour moved to Thursday (saved on the iPad during Keep Cloud)';
  const cloudReads = () => (jest.requireMock('../../services/SupabaseService') as { getProjectUpdateSyncMetadata: jest.Mock })
    .getProjectUpdateSyncMetadata;
  /** The iPad saves again just after Keep Cloud's first read of the cloud. */
  function iPadSavesAfterTheFirstRead() {
    const read = cloudReads().getMockImplementation()!;
    cloudReads().mockImplementationOnce(async (id: string) => {
      const first = await read(id);
      putInCloud({ ...inCloud(id), notes: IPAD_THIRD_NOTE }, new Date().toISOString());
      return first;
    });
  }

  it('the iPad\'s save stays in the cloud and comes to the phone', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await iPadEditsNow(IPAD_SECOND_NOTE);
    // Pin changed in A4 pass 16 L3 (A7 pass 14 M-1): the iPad's second note is shown first.
    await reviewAgainAfterIPadEdit(conflict.id, 'keep_cloud', IPAD_SECOND_NOTE);
    iPadSavesAfterTheFirstRead();
    await chooseInSettings(phone, conflict, 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_THIRD_NOTE });
    expect(phone.saved()).toMatchObject({ notes: IPAD_THIRD_NOTE, status: 'sent' });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('the second read fails: the first read\'s copy is written, as before', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await iPadEditsNow(IPAD_SECOND_NOTE);
    await reviewAgainAfterIPadEdit(conflict.id, 'keep_cloud', IPAD_SECOND_NOTE); // pin changed in A4 pass 16 L3: shown first
    const read = cloudReads().getMockImplementation()!;
    cloudReads()
      .mockImplementationOnce(read)
      .mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
    await chooseInSettings(phone, conflict, 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(phone.saved()).toMatchObject({ notes: IPAD_SECOND_NOTE, status: 'sent' });
  });
});

/**
 * A4 pass 13 L2 (the open part of A4 pass 12 L1): Keep Cloud read the cloud,
 * withdrew the phone's waiting work (a newer edit, a document change), and
 * then its save failed. Settings said "Neither copy was changed", but that
 * work was gone, and the cloud copy it had queued went up later and cleared
 * the conflict. Now the withdrawn work goes back in its place.
 */
describe('Keep Cloud whose save fails leaves the phone\'s waiting work as it was (audit A4 pass 13 L2)', () => {
  const NEWER = 'Pour, 45 yards (typed on the phone after the conflict)';
  const offline = async <T>(work: () => Promise<T>) => {
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockResolvedValue({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
    try { return await work(); } finally { (saveProjectUpdate as jest.Mock).mockImplementation(save); }
  };

  it('a newer phone edit made since the conflict is queued again; reconnected, it waits for review, and Keep Phone sends it', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    const before = await queuedFor();
    await expect(offline(() => chooseInSettingsExpectingFailure(phone, conflict, 'keep_cloud'))).resolves.toEqual(['Conflict not resolved']);
    expect(await getOfflineQueue()).toEqual([before]);
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });

    // Pin changed in A4 pass 15 H1: the conflict is still open, so the
    // reconnected upload pass leaves the newer edit queued for David's choice.
    await uploadPendingChanges(); // reconnected
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getOfflineQueue()).toEqual([before]);
    await chooseInSettings(phone, conflict, 'keep_local');
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('a document change waiting since the conflict is queued again', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    const before = await queuedFor();
    expect(before!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    await expect(offline(() => resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_cloud'))).rejects.toThrow();
    expect(await getOfflineQueue()).toEqual([before]);
    expect(await getSyncConflicts()).toHaveLength(1);
  });

  it('nothing was waiting: the cloud copy it queued does not stay to clear the conflict later', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    expect(await getOfflineQueue()).toEqual([]);
    await expect(offline(() => chooseInSettingsExpectingFailure(phone, conflict, 'keep_cloud'))).resolves.toEqual(['Conflict not resolved']);
    expect(await getOfflineQueue()).toEqual([]);
    await uploadPendingChanges();
    expect(await getSyncConflicts()).toHaveLength(1);
  });
});

/**
 * A7 pass 11 L-2: Keep Phone put the conflict's copy over a newer edit still
 * waiting in the queue, and kept that edit only in memory: it put it back
 * on a failure, or queued it again after the kept copy landed. Killed in
 * either window, the queue on disk held only the older copy; after a
 * relaunch the upload pass sent it, a refresh before the waiting-update
 * sync showed it on the card as Sent, and nothing sent the newer edit.
 */
describe('Keep Phone keeps the newer phone edit on disk while it runs (audit A7 pass 11 L-2)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const CONFLICTS_KEY = 'projectVisionAI.syncConflicts.v1';
  const asyncStorage = () => (jest.requireMock('@react-native-async-storage/async-storage') as { default: { setItem: jest.Mock } }).default;

  /** A relaunch with only what was on disk, then an upload pass and a refresh before the waiting-update sync. */
  async function relaunchFrom(onDisk: Map<string, string>, phone: Device) {
    mockStorage.clear();
    onDisk.forEach((value, key) => mockStorage.set(key, value));
    resetFieldUpdateSyncMemoryForTests();
    await uploadPendingChanges();
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: NEWER });
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
  }

  it('killed while the kept copy uploads: the newer edit still reaches the card and the cloud', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    let onDisk: Map<string, string> | undefined;
    (saveProjectUpdate as jest.Mock).mockImplementationOnce(async () => {
      onDisk = new Map(mockStorage); // the app is killed here: nothing after reaches the disk
      return { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
    });
    await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local').catch(() => undefined);
    await relaunchFrom(onDisk!, phone);
  });

  it('killed once the kept copy landed and the conflict was cleared: the same', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    const setItem = asyncStorage().setItem.getMockImplementation()!;
    let onDisk: Map<string, string> | undefined;
    asyncStorage().setItem.mockImplementation(async (key: string, value: string) => {
      await setItem(key, value);
      if (key === CONFLICTS_KEY && value === '[]') onDisk = new Map(mockStorage); // the last such write before Keep Phone returns
    });
    try {
      await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local');
    } finally {
      asyncStorage().setItem.mockImplementation(setItem);
    }
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    await relaunchFrom(onDisk!, phone);
  });

  it('killed while the kept copy uploads, then Keep Phone again after the relaunch: the newer edit still follows it', async () => {
    const { phone, conflict } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await editAndSave(phone, { notes: NEWER });
    let onDisk: Map<string, string> | undefined;
    (saveProjectUpdate as jest.Mock).mockImplementationOnce(async () => {
      onDisk = new Map(mockStorage);
      return { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
    });
    await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local').catch(() => undefined);
    mockStorage.clear();
    onDisk!.forEach((value, key) => mockStorage.set(key, value));
    resetFieldUpdateSyncMemoryForTests();

    await new Promise(resolve => setTimeout(resolve, 5));
    await resolveProjectUpdateSyncConflict<Update>(conflict.id, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: NEWER });
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: NEWER });
  });
});

/**
 * A4 pass 13 G1: a photo analysis that finished after its update was sent
 * (it adds what the photo shows) queued the phone's whole copy again, stamped
 * now. When the iPad had edited the note meanwhile, the conflict check read
 * the phone's copy as the newer one, and its older note went over the iPad's.
 * Now only the result goes up, as a patch on the cloud's copy, like a
 * document change; an edit still waiting on the phone takes the result in its
 * own queued copy, and keeps the time David saved it.
 */
describe('a late photo analysis result does not go over a newer iPad edit (audit A4 pass 13 G1)', () => {
  const OFFLINE_EDIT = 'Pour, 40 yards (typed on the phone with no signal)';
  const analyzing = { id: 'photo-g1', uri: 'file:///phone/Documents/project-photos/g1.jpg', caption: '', createdAt: SENT_AT,
    photoIntelligence: { status: 'analyzing', updatedAt: SENT_AT } };
  const finished = () => ({ status: 'analysis_complete', updatedAt: new Date().toISOString(),
    currentObservation: 'Rebar mat placed at column C4', additions: ['Rebar mat'] });

  /** The App's own applyPhotoIntelligenceResult, compiled from App.tsx, on the phone's state: the result lands. */
  function analysisFinishes(phone: Device, result: Record<string, unknown>, photoId = analyzing.id) {
    const { applyPhotoIntelligenceResult } = evaluate<{
      applyPhotoIntelligenceResult: (projectId: string, updateId: string, photoId: string, result: unknown) => void;
    }>(
      transpile([componentFunction('applyPhotoIntelligenceResult'), 'module.exports = { applyPhotoIntelligenceResult };'].join('\n')),
      {
        authorityProjectId: () => 'p-key',
        // The update's analysis reads complete once each photo's has finished.
        summarizePIEStatusForUpdate: (update: Update) => (update.photos as Array<{ photoIntelligence?: { status?: string } }>)
          .every(photo => photo.photoIntelligence?.status === 'analysis_complete')
          ? { status: 'complete', summary: 'Possible changes found' }
          : { status: 'analyzing', summary: 'Checking photos' },
        setDraft: () => undefined, setSavedUpdates: phone.setSavedUpdates, savedUpdatesRef: phone.savedUpdatesRef,
        upsertSavedUpdateUnlessDeleted: (update: Update) => {
          phone.setSavedUpdates(prev => prev.map(item => item.id === update.id ? update : item));
          phone.render();
        },
        queueProjectUpdateRecord, queueProjectUpdatePhotoAnalysis,
        requestQueuedUpdateSync: phone.requestQueuedUpdateSync, requestPendingChangesUpload: phone.requestPendingChangesUpload,
      },
    );
    applyPhotoIntelligenceResult('p-key', 'u1', photoId, result);
  }
  /** Reconnected: the queue upload, then the waiting-update sync, whichever the result asked for. */
  async function reconnect(phone: Device) {
    await phone.settle();
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
  }
  const photoAnalysis = (update: Update | undefined) => (update?.photos as Array<{ photoIntelligence?: unknown }>)[0].photoIntelligence;

  it('G1: a Sent update whose analysis finishes after the iPad edited its note: the iPad keeps its note, and the result reaches the cloud', async () => {
    const phone = await sentThroughTheApp([analyzing]);
    await iPadEditsNow(IPAD_NOTE); // the phone has not seen it
    const result = finished();
    analysisFinishes(phone, result);
    await phone.settle();
    // The card stays Sent; only the result waits, for the queue upload.
    expect(phone.saved()).toMatchObject({ notes: 'Pour', status: 'sent' });
    expect(phone.requestPendingChangesUpload).toHaveBeenCalledWith('late_photo_analysis');
    expect(phone.requestQueuedUpdateSync).not.toHaveBeenCalled();
    // A refresh before it goes up shows the iPad's note, and keeps the result on the card.
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent', pieStatus: 'complete' });
    expect(photoAnalysis(phone.saved())).toEqual(result);

    await reconnect(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(photoAnalysis(inCloud())).toEqual(result);
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(await realtimeEcho(phone)).toMatchObject({ notes: IPAD_NOTE, status: 'sent', pieStatus: 'complete' });
    expect(photoAnalysis(phone.saved())).toEqual(result);
  });

  it('a result that cannot go up yet keeps waiting, and its card does not call it a document change', async () => {
    const phone = await sentThroughTheApp([analyzing]);
    analysisFinishes(phone, finished());
    await phone.settle();
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockImplementation(async () =>
      ({ ok: false, configured: true, stubbed: false, error: 'Network request failed' }));
    try {
      await uploadPendingChanges();
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
    expect((await queuedFor())!.lastError).toBeTruthy();
    expect(fieldUpdateDocumentChangeWaiting(await getOfflineQueue(), 'u1').shown).toBe(false);
    await uploadPendingChanges(); // the signal is back
    expect(photoAnalysis(inCloud())).toMatchObject({ status: 'analysis_complete' });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('a result on an update not edited elsewhere still reaches the cloud, and the card reads Sent', async () => {
    const phone = await sentThroughTheApp([analyzing]);
    const result = finished();
    analysisFinishes(phone, result);
    await reconnect(phone);
    expect(inCloud()).toMatchObject({ notes: 'Pour', pieStatus: 'complete' });
    expect(photoAnalysis(inCloud())).toEqual(result);
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: 'Pour', status: 'sent' });
    // A relaunch, then the waiting-update sync and an upload pass: nothing more goes up.
    const writes = (saveProjectUpdate as jest.Mock).mock.calls.length;
    resetFieldUpdateSyncMemoryForTests();
    await reconnect(phone);
    expect((saveProjectUpdate as jest.Mock).mock.calls.length).toBe(writes);
  });

  it('an edit still waiting on the phone takes the result in its own queued copy, keeping the time David saved it: the iPad\'s later note is a conflict, not overwritten', async () => {
    const phone = await sentThroughTheApp([analyzing]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: OFFLINE_EDIT });
    const savedAt = (await queuedFor())!.changedAt;
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    analysisFinishes(phone, finished());
    await phone.settle();
    const queued = (await queuedFor())!;
    expect(queued.changedAt).toBe(savedAt);
    expect(queued.payload.updateData).toMatchObject({ notes: OFFLINE_EDIT, pieStatus: 'complete' });
    expect(photoAnalysis(queued.payload.updateData as Update)).toMatchObject({ status: 'analysis_complete' });
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT, status: 'queued' });
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalled();

    await reconnect(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  });

  it('a pass that read the waiting edit before the result, and stages it after: the time David saved it still stands, and the conflict is found', async () => {
    const phone = await sentThroughTheApp([analyzing]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: OFFLINE_EDIT });
    // Another update waits ahead of it in the same pass.
    const ahead = { ...savedUpdate([], 'queued', 'u0'),
      photos: [{ id: 'photo-u0', uri: 'file:///phone/Documents/project-photos/u0.jpg', caption: '', createdAt: SENT_AT }] };
    phone.setSavedUpdates(prev => [ahead, ...prev]);
    phone.render();
    await queueProjectUpdateRecord(ahead, false);
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    let landed = false;
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async () => {
      if (!landed) { // while the pass checks the other update's photos
        landed = true;
        analysisFinishes(phone, finished());
        await phone.settle();
      }
      return signedUrl;
    });

    await waitingUpdateSync(phone); // then stages the edit as it read it, without the result
    expect(landed).toBe(true);
    await waitingUpdateSync(phone); // the rerun the result asked for
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    // Known limit: the copy that pass read, without the result, is the one
    // kept for review.
    expect((await getSyncConflicts())[0].localPayload).toMatchObject({ updateData: { notes: OFFLINE_EDIT } });
  });

  it('two results, one per photo, both go up; neither undoes the other', async () => {
    const second = { ...analyzing, id: 'photo-g1b', uri: 'file:///phone/Documents/project-photos/g1b.jpg' };
    const phone = await sentThroughTheApp([analyzing, second]);
    await iPadEditsNow(IPAD_NOTE);
    analysisFinishes(phone, finished());
    await phone.settle();
    analysisFinishes(phone, finished(), second.id);
    await reconnect(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect((inCloud().photos as Array<{ photoIntelligence: { status: string } }>).map(photo => photo.photoIntelligence.status))
      .toEqual(['analysis_complete', 'analysis_complete']);
    expect(await getOfflineQueue()).toEqual([]);
  });
});

/**
 * Settings' Sync Now (AdminScreen's own handleFullSyncNow), with the real full
 * sync; lifted out of the A4 pass 13 G2 tests for the A4 pass 15 H1 tests.
 */
const answers = <T>(data: T) => async () => ({ ok: true, configured: true, stubbed: false, data });

/** AdminScreen's own Sync Now (handleFullSyncNow), with the real full sync; the message it shows. */
async function pressSyncNow(phone: Device): Promise<string> {
  const mock = supabaseMock();
  const spies = [
    jest.spyOn(mock as never, 'testSupabaseConnection' as never).mockImplementation((async () => ({ connected: true, projectCount: 1 })) as never),
    jest.spyOn(mock as never, 'listProjectAreas' as never).mockImplementation(answers([]) as never),
    jest.spyOn(mock as never, 'listScheduleItems' as never).mockImplementation(answers([]) as never),
    jest.spyOn(mock as never, 'listReferenceDocuments' as never).mockImplementation(answers([]) as never),
    jest.spyOn(mock as never, 'countCloudProjects' as never).mockImplementation(answers(1) as never),
  ];
  (listProjectUpdates as jest.Mock).mockImplementation(async () => ({ ok: true, configured: true, stubbed: false, data: cloudRows() }));
  const messages: string[] = [];
  try {
    const { handleFullSyncNow } = evaluate<{ handleFullSyncNow: () => Promise<void> }>(
      transpile(`${componentFunction('handleFullSyncNow', adminScreen)}\nmodule.exports = { handleFullSyncNow };`),
      {
        setIsSyncing: () => undefined, setLastFullSyncIssueCount: () => undefined,
        setSyncAttemptMessage: (message: string) => { messages.push(message); }, setAdminActionSummary: () => undefined,
        startProjectDocumentUploadRun: () => ({ remaining: () => 0 }), onRetryDocumentUploads: jest.fn(),
        synchronizeLocalData, localProjects: ['P'], savedUpdates: phone.savedUpdatesRef.current,
        projectAreas: [], scheduleItems: [], referenceDocuments: [],
        getSyncStatus, getSyncConflicts, setSyncStatus: () => undefined, setSyncConflicts: () => undefined,
        onApplyCloudRecovery: () => undefined, failedDocumentCountRef: { current: 0 },
        projectDocumentsStillUploadingNotice: () => null, showMissingPhotoSyncAlert: jest.fn(),
        updateSyncAttentionCount: 0, failedDocumentCount: 0,
      },
    );
    await handleFullSyncNow();
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
  return messages.at(-1) || '';
}

/**
 * A4 pass 13 G2: Settings › Sync Now sent every local copy that differs from
 * the cloud's, an update in conflict too, whole and stamped now: a silent Keep
 * Phone. The iPad's newer note was gone and the conflict with it. Sync Now
 * now leaves an update in conflict for Keep Phone or Keep Cloud, as the
 * waiting-update sync does, and its message counts it as needing review.
 */
describe('Sync Now leaves an update in conflict for review (audit A4 pass 13 G2)', () => {
  const OFFLINE_EDIT = 'Pour, 40 yards (typed on the phone with no signal)';
  /** Sent, edited on the phone offline, the iPad's edit lands after; reconnected, the upload pass finds the conflict. */
  async function phoneEditInConflictWithIPad(photos: Array<{ id: string } & Record<string, unknown>>) {
    const phone = await sentThroughTheApp(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    return phone;
  }
  const photo = { id: 'photo-g2', uri: 'file:///phone/Documents/project-photos/g2.jpg', caption: '', createdAt: SENT_AT };

  it.each([
    ['without photos', []],
    ['with photos', [photo]],
  ])('G2 (%s): Sync Now keeps the iPad\'s note in the cloud and the conflict open, and says it needs review', async (_label, photos) => {
    const phone = await phoneEditInConflictWithIPad(photos);
    const message = await pressSyncNow(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(phone.saved()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(message).toBe('Cloud sync finished, but 1 saved conflict needs review.');
  });

  it('then Keep Phone still sends the phone\'s copy', async () => {
    const phone = await phoneEditInConflictWithIPad([]);
    await pressSyncNow(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('an update not in conflict still goes up with Sync Now', async () => {
    const phone = await sentThroughTheApp([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    const edited = { ...phone.saved()!, notes: OFFLINE_EDIT, status: 'queued' };
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? edited : update)); // its queue write was lost
    phone.render();
    const message = await pressSyncNow(phone);
    expect(inCloud()).toMatchObject({ notes: OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
    expect(message).toMatch(/^Cloud sync completed\./);
  });
});

/**
 * A7 pass 12 M-1 (A4 pass 14 #1): Settings › Retry Sync retried each queued
 * or failed card through the card's own Retry, an explicit send. An update in
 * conflict went up whole, stamped now, over the iPad's newer note: the
 * conflict was gone, and Settings said "1 pending item synced successfully."
 * Retry Sync is the button Settings offers whenever anything is pending, and
 * before its status read lands. It now leaves an update in conflict for
 * review, as Sync Now does (A4 pass 13 G2), and counts it as needing review.
 */
const RETRY_SYNC_OFFLINE_EDIT = 'Pour, 40 yards (typed on the phone with no signal)';
/** The App's own retryQueuedUpdate (with its missing-photo repair and its result handling), on this phone's state. */
function appRetryQueuedUpdate(phone: Device) {
  const diagnostics = [
    'classifySyncFailureCategory', 'syncCategoryForStorageFailure', 'syncCategoryIsRlsOrAuth', 'emptyPermissionAttempt',
    'inferPermissionAttemptFromFailure', 'buildSkippedSyncDiagnostics', 'buildSyncDiagnosticsFromUpload', 'statusForSyncDiagnostics',
  ];
  const own = ['upsertSavedUpdateUnlessDeleted', 'applyFieldUpdateSyncResultIfCurrent', 'syncFieldUpdateWithMissingPhotoRepair', 'retryQueuedUpdate'];
  return evaluate<{ retryQueuedUpdate: (update: Update, sync?: { automatic?: boolean; overConflict?: boolean }) => Promise<Update> }>(
    transpile([...diagnostics.map(appFunction), ...own.map(name => componentFunction(name)), 'module.exports = { retryQueuedUpdate };'].join('\n')),
    {
      classifySyncFailureText, persistedStatusForSyncResult, reconcileFieldUpdateSyncResult,
      savedUpdatesRef: phone.savedUpdatesRef, setSavedUpdates: phone.setSavedUpdates,
      mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones, deletedUpdateTombstonesRef: { current: [] },
      getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
      fieldUpdateSyncCategoryWithoutSession: async () => 'offline', signInPendingRef: { current: false },
      runFieldUpdateCloudSync, markMissingPhotosUnavailable: (update: Update) => update,
      removeMissingPhotosFromSyncQueue: async () => undefined, persistSavedUpdateImmediately: async () => true,
    },
  ).retryQueuedUpdate;
}
/** AdminScreen's own Retry Sync (handleRetrySync), through the App's own onRetryUpdateSync; the message it shows. */
async function pressRetrySync(phone: Device): Promise<string> {
  const wiring = /onRetryUpdateSync=\{(.+)\}\n/.exec(app)![1];
  const onRetryUpdateSync = evaluate<(...args: unknown[]) => Promise<Update>>(
    transpile(`module.exports = ${wiring};`), { retryQueuedUpdate: appRetryQueuedUpdate(phone) });
  const messages: string[] = [];
  const { handleRetrySync } = evaluate<{ handleRetrySync: () => Promise<void> }>(
    transpile(`${componentFunction('handleRetrySync', adminScreen)}\nmodule.exports = { handleRetrySync };`),
    {
      setIsSyncing: () => undefined, setAdminActionSummary: () => undefined,
      setSyncAttemptMessage: (message: string | null) => { if (message) messages.push(message); },
      startProjectDocumentUploadRun: () => ({ remaining: () => 0 }), onRetryDocumentUploads: jest.fn(),
      savedUpdates: phone.savedUpdatesRef.current, onRetryUpdateSync, withSyncTimeout: <T>(work: Promise<T>) => work,
      uploadPendingChanges, getSyncStatus, SETTINGS_STATUS_TIMEOUT_MS: 8_000, setSyncStatus: () => undefined,
      failedDocumentCountRef: { current: 0 }, setSyncConflicts: () => undefined, getSyncConflicts,
    },
  );
  await handleRetrySync();
  phone.render();
  return messages.at(-1) || '';
}
/** Sent, edited on the phone offline, the iPad's edit lands after; reconnected, the conflict is found. */
async function offlineEditInConflictWithIPad(photos: Array<{ id: string } & Record<string, unknown>>) {
  const phone = await sentThroughTheApp(photos);
  await new Promise(resolve => setTimeout(resolve, 5));
  await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
  await new Promise(resolve => setTimeout(resolve, 5));
  await iPadEditsNow(IPAD_NOTE);
  await uploadPendingChanges();
  await waitingUpdateSync(phone);
  expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  return phone;
}

describe('Settings › Retry Sync leaves an update in conflict for review (audit A7 pass 12 M-1)', () => {
  const photo = { id: 'photo-m-1', uri: 'file:///phone/Documents/project-photos/m-1.jpg', caption: '', createdAt: SENT_AT };

  it.each([
    ['without photos', []],
    ['with photos', [photo]],
  ])('M-1 (%s): Retry Sync keeps the iPad\'s note in the cloud and the conflict open, leaves the card as it was, and says it needs review', async (_label, photos) => {
    const phone = await offlineEditInConflictWithIPad(photos);
    const before = phone.saved()!;
    expect(['queued', 'failed']).toContain(before.status); // Retry Sync retries it
    const message = await pressRetrySync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(phone.saved()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, status: before.status, sendAttempts: before.sendAttempts });
    expect(message).toBe('The sync queue is clear, but 1 saved conflict needs review.');
  });

  it('another update that fails alongside is counted apart: it needs attention, and the conflict needs review', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const other = { ...savedUpdate([], 'queued', 'u2'), notes: 'Strip forms' };
    phone.setSavedUpdates(prev => [...prev, other]);
    phone.render();
    await queueProjectUpdateRecord(other, false);
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockImplementation(async (params: { id: string }) => params.id === 'u2'
      ? { ok: false, configured: true, stubbed: false, error: 'permission denied' }
      : save(params));
    try {
      const message = await pressRetrySync(phone);
      expect(message).toBe('1 item still needs attention. It remains saved on this phone. 1 saved conflict also needs review.');
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });

  it('an update not in conflict still goes up with Retry Sync', async () => {
    const phone = await sentThroughTheApp([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    const message = await pressRetrySync(phone);
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(phone.saved()).toMatchObject({ status: 'sent' });
    expect(message).toBe('1 pending item synced successfully.');
  });

  it('the card\'s own Retry is still an explicit send: the phone\'s copy goes over the iPad\'s, and the conflict is settled', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await pressRetrySync(phone);
    await new Promise(resolve => setTimeout(resolve, 5));
    // Pin changed in A4 pass 15 H1: once David confirms it, as the card asks.
    await appRetryQueuedUpdate(phone)(phone.saved()!, { overConflict: true });
    phone.render();
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
    expect(phone.saved()).toMatchObject({ status: 'sent' });
  });

  it('then Keep Phone still sends the phone\'s copy', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await pressRetrySync(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
  });
});

/**
 * A7 pass 12 L-1 (from A4 pass 13 M1): a newer edit David saved on the phone
 * during the conflict waits in the queue on its photos, and only staging
 * checks them: it never went up, and the card read "Waiting to Sync" for
 * good, with no visible way out. The same after a failed Keep Phone or Keep
 * Cloud put such an edit back.
 *
 * Pins changed in A4 pass 15 H1: 139b0bb's way out (the newer edit staged and
 * sent by itself) let any copy that was not exactly the conflict's own go up
 * over the iPad's edit, and clear the conflict with David's offline edit in
 * it. Now nothing automatic sends an update in conflict, the newer edit
 * included. The way out is visible instead: the card reads "Needs Review",
 * Settings offers Review Conflicts, and Keep Phone sends the newer edit after
 * the conflict's own copy (A7 pass 11 L-2), its photos checked as for any
 * edit. The old conflict copy is still never sent by itself.
 */
describe('a newer edit saved during a conflict has a way out (audit A7 pass 12 L-1, A4 pass 15 H1)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const photo = { id: 'photo-l-1', uri: 'file:///phone/Documents/project-photos/l-1.jpg', caption: '', createdAt: SENT_AT };
  const needsReview = async () => fieldUpdateHasOpenConflict(await getSyncConflicts(), 'u1');

  it.each([
    ['with photos', [photo]],
    ['without photos', []],
  ])('L-1 (%s): reconnected, the newer edit waits and its card reads Needs Review; Keep Phone sends it, the conflict is settled and the queue drains', async (_label, photos) => {
    const phone = await offlineEditInConflictWithIPad(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER }); // offline, after the iPad's edit
    await uploadPendingChanges(); // reconnected
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await needsReview()).toBe(true);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });

  it('with photos, Settings › Retry Sync leaves it for review too', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    // The newer edit stays queued, so the queue is not called clear. Pin
    // changed in A4 pass 15b F2: it is counted once, as the conflict, and no
    // longer again as "1 item still needs attention".
    expect(await pressRetrySync(phone)).toBe('Nothing else is waiting to sync, but 1 saved conflict needs review.');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);
  });

  it('an iPad edit made after the newer edit is kept: the newer edit never goes up by itself, and the conflict keeps David\'s offline edit', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_SECOND_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    const [conflict] = await getSyncConflicts();
    expect((conflict.localPayload as { updateData: Update }).updateData).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    await waitingUpdateSync(phone); // and again
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
  });

  it('the conflict\'s own copy is still held, a Retry\'s stamps or a document taken off since aside', async () => {
    const { phone } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1'
      ? { ...update, status: 'queued', sendAttempts: 3, lastSendAttemptAt: new Date().toISOString() } : update));
    phone.render();
    await uploadPendingChanges(); // the document change goes onto the cloud's copy; the conflict stays
    await waitingUpdateSync(phone);
    await pressRetrySync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toHaveLength(1);
  });

  it.each([
    ['Keep Phone', 'keep_local'],
    ['Keep Cloud', 'keep_cloud'],
  ] as const)('after a failed %s puts a newer edit with photos back, it waits for review once reconnected; Keep Phone then sends it', async (_label, resolution) => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    // The signal drops during the choice: its first cloud read lands, nothing after it.
    const reads = supabaseMock().getProjectUpdateSyncMetadata as jest.Mock;
    const read = reads.getMockImplementation()!;
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    try {
      reads.mockImplementationOnce(read).mockResolvedValue(photoCheckFails);
      (saveProjectUpdate as jest.Mock).mockResolvedValue(photoCheckFails);
      await expect(chooseInSettingsExpectingFailure(phone, (await getSyncConflicts())[0], resolution)).resolves.toEqual(['Conflict not resolved']);
    } finally {
      reads.mockImplementation(read);
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);
    expect(await getSyncConflicts()).toHaveLength(1);
    await uploadPendingChanges(); // reconnected
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await needsReview()).toBe(true);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });
});

/**
 * A4 pass 15b F2: with a newer edit saved during a conflict, Settings › Retry
 * Sync said "1 item still needs attention. It remains saved on this phone. 1
 * saved conflict also needs review." for what is one update: the newer edit,
 * held in the queue for review, was counted again as an item needing
 * attention. An update held for conflict review is now counted once, in the
 * conflict sentence; the queue, which still holds that edit, is not called
 * clear.
 */
describe('Retry Sync counts an update held for conflict review once (audit A4 pass 15b F2)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const photo = { id: 'photo-f2', uri: 'file:///phone/Documents/project-photos/f2.jpg', caption: '', createdAt: SENT_AT };
  const ONE_CONFLICT_ONLY = 'Nothing else is waiting to sync, but 1 saved conflict needs review.';

  it.each([
    ['with photos', [photo]],
    ['without photos', []],
  ])('a newer edit (%s) waiting for review: one conflict, and nothing else said to need attention', async (_label, photos) => {
    const phone = await offlineEditInConflictWithIPad(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    expect(await pressRetrySync(phone)).toBe(ONE_CONFLICT_ONLY);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER); // held, so the queue is not called clear
  });

  it('its card reading Sent (a refresh showed the iPad\'s copy), so Retry Sync only runs the queue: counted once too', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...inCloud(), status: 'sent' } : update));
    phone.render();
    expect(await pressRetrySync(phone)).toBe(ONE_CONFLICT_ONLY);
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER);
  });

  it('another update that fails alongside is still counted, once: it needs attention, and the conflict needs review', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    const other = { ...savedUpdate([], 'queued', 'u2'), notes: 'Strip forms' };
    phone.setSavedUpdates(prev => [...prev, other]);
    phone.render();
    await queueProjectUpdateRecord(other, false);
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockImplementation(async (params: { id: string }) => params.id === 'u2'
      ? { ok: false, configured: true, stubbed: false, error: 'permission denied' }
      : save(params));
    try {
      expect(await pressRetrySync(phone)).toBe('1 item still needs attention. It remains saved on this phone. 1 saved conflict also needs review.');
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
  });
});

/** A photo still being analysed when its update was sent, and a result for it (as in the A4 pass 13 G1 tests). */
const analyzingPhoto = { id: 'photo-p12', uri: 'file:///phone/Documents/project-photos/p12.jpg', caption: '', createdAt: SENT_AT,
  photoIntelligence: { status: 'analyzing', updatedAt: SENT_AT } };
const finishedAnalysis = () => ({ status: 'analysis_complete', updatedAt: new Date().toISOString(),
  currentObservation: 'Rebar mat placed at column C4', additions: ['Rebar mat'] });
const firstPhotoAnalysis = (update: Update | undefined) => (update?.photos as Array<{ photoIntelligence?: unknown }>)[0].photoIntelligence;
/** The App's own applyPhotoIntelligenceResult, compiled from App.tsx, on the phone's state: the result lands. */
function lateAnalysisFinishes(phone: Device, result: Record<string, unknown>, photoId = analyzingPhoto.id) {
  const { applyPhotoIntelligenceResult } = evaluate<{
    applyPhotoIntelligenceResult: (projectId: string, updateId: string, photoId: string, result: unknown) => void;
  }>(
    transpile([componentFunction('applyPhotoIntelligenceResult'), 'module.exports = { applyPhotoIntelligenceResult };'].join('\n')),
    {
      authorityProjectId: () => 'p-key',
      summarizePIEStatusForUpdate: (update: Update) => (update.photos as Array<{ photoIntelligence?: { status?: string } }>)
        .every(photo => photo.photoIntelligence?.status === 'analysis_complete')
        ? { status: 'complete', summary: 'Possible changes found' }
        : { status: 'analyzing', summary: 'Checking photos' },
      setDraft: () => undefined, setSavedUpdates: phone.setSavedUpdates, savedUpdatesRef: phone.savedUpdatesRef,
      upsertSavedUpdateUnlessDeleted: (update: Update) => {
        phone.setSavedUpdates(prev => prev.map(item => item.id === update.id ? update : item));
        phone.render();
      },
      queueProjectUpdateRecord, queueProjectUpdatePhotoAnalysis,
      requestQueuedUpdateSync: phone.requestQueuedUpdateSync, requestPendingChangesUpload: phone.requestPendingChangesUpload,
    },
  );
  applyPhotoIntelligenceResult('p-key', 'u1', photoId, result);
}

/**
 * A4 pass 14 #3 (A7 pass 12): a patch upload (a late photo analysis result,
 * a document change) stamps the cloud's row with the time it went up, and a
 * whole-copy edit carries the time David saved it (A4 pass 13 M1). An edit
 * saved while this phone's own patch was going up read older than the
 * cloud's copy, and a conflict was shown: nothing lost, but a false
 * conflict. When the only change in the cloud since the edit is this phone's
 * own patch, the edit now goes up, with the patch, and no conflict.
 */
describe('this phone\'s own patch landing after an edit is not a conflict (audit A4 pass 14 #3)', () => {
  const NEWER = 'Pour, 45 yards (saved while the result was going up)';
  /** Sent, its card bound to the cloud project (as a refresh leaves it), its photo's analysis still running. */
  async function sentAndAnalyzing() {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, projectId: CLOUD_PROJECT_ID } : update));
    phone.render();
    return phone;
  }
  /** David saves an edit while the upload pass that sends this phone's patch reads the cloud's copy. */
  function editWhileThePatchGoesUp(phone: Device, change: Partial<Update>, iPadFirst?: string) {
    const reads = supabaseMock().getProjectUpdateSyncMetadata as jest.Mock;
    const read = reads.getMockImplementation()!;
    reads.mockImplementationOnce(async (id: string) => {
      if (iPadFirst) await iPadEditsNow(iPadFirst); // and the iPad's edit landed before the edit
      const current = await read(id);
      await editAndSave(phone, change);
      await new Promise(resolve => setTimeout(resolve, 5)); // the patch is stamped after the edit was saved
      return current;
    });
  }
  async function reconnected(phone: Device) {
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
  }

  it('#3 (late analysis): the edit goes up with the result, and no conflict is shown', async () => {
    const phone = await sentAndAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    editWhileThePatchGoesUp(phone, { notes: NEWER });
    await uploadPendingChanges(); // the result lands, after the edit was saved
    expect(inCloud()).toMatchObject({ notes: 'Pour', pieStatus: 'complete' });
    await reconnected(phone);
    expect(await getSyncConflicts()).toEqual([]);
    expect(inCloud()).toMatchObject({ notes: NEWER, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toMatchObject({ status: 'analysis_complete' });
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });

  it('#3 (document change): the edit goes up with the document taken off, and no conflict is shown', async () => {
    const sent = { ...savedUpdate([uploaded('permit'), uploaded('survey')]), projectId: CLOUD_PROJECT_ID };
    putInCloud(sent);
    const phone = device([uploaded('permit'), uploaded('survey')], [sent]);
    await phone.deleteFromThisDevice('permit');
    editWhileThePatchGoesUp(phone, { notes: NEWER });
    await uploadPendingChanges();
    expect(documentIds(inCloud())).toEqual(['survey']);
    await reconnected(phone);
    expect(await getSyncConflicts()).toEqual([]);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('an iPad edit the patch went onto, saved before this edit, is no conflict either: the newer save goes up, as before', async () => {
    const phone = await sentAndAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    editWhileThePatchGoesUp(phone, { notes: NEWER }, IPAD_NOTE);
    await uploadPendingChanges();
    await reconnected(phone);
    expect(await getSyncConflicts()).toEqual([]);
    expect(inCloud()).toMatchObject({ notes: NEWER, pieStatus: 'complete' });
  });

  it('an iPad edit that lands after the patch is still a conflict, and the iPad keeps its note', async () => {
    const phone = await sentAndAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    editWhileThePatchGoesUp(phone, { notes: NEWER });
    await uploadPendingChanges();
    await iPadEditsNow(IPAD_NOTE);
    await reconnected(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  });

  it('an iPad edit the patch went onto, saved after this edit, is still a conflict', async () => {
    const phone = await sentAndAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    const reads = supabaseMock().getProjectUpdateSyncMetadata as jest.Mock;
    const read = reads.getMockImplementation()!;
    reads.mockImplementationOnce(async (id: string) => {
      await editAndSave(phone, { notes: NEWER });
      await new Promise(resolve => setTimeout(resolve, 5));
      await iPadEditsNow(IPAD_NOTE); // after the edit, before the patch goes onto the cloud's copy
      return read(id);
    });
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    await reconnected(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  });
});

/**
 * A4 pass 14 #4 (A7 pass 12): a photo analysis that finished while its
 * update was in conflict (its card "Sync failed") stayed on the phone's card
 * only: the late-analysis path handled Sent and Waiting cards. Keep Phone
 * then sent the conflict's copy without the result, and Settings, seeing the
 * card's copy (with it) as a newer edit, left the card reading "Sync failed".
 * The cloud and the iPad showed "Analyzing" until a Retry. The result now
 * goes up as a patch for a failed card too, and is the phone's copy's in the
 * conflict, so it survives Keep Phone and Keep Cloud.
 */
describe('a late photo analysis on an update in conflict reaches the cloud (audit A4 pass 14 #4)', () => {
  /** Sent while its photo was being analysed, edited offline, the iPad's edit after it; reconnected, the conflict is found. */
  async function inConflictWhileAnalyzing() {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(phone.saved()).toMatchObject({ status: 'failed' }); // "Sync failed"
    return phone;
  }

  it.each([
    ['offline until Keep Phone', false],
    ['online: the result goes up before Keep Phone', true],
  ])('#4 (%s): Keep Phone sends the phone\'s copy with the result, and the card reads Sent', async (_label, online) => {
    const phone = await inConflictWhileAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    if (online) {
      await uploadPendingChanges();
      expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
      expect(await getSyncConflicts()).toHaveLength(1); // a result settles no conflict
    }
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toMatchObject({ status: 'analysis_complete' });
    expect(phone.saved()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, status: 'sent' });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it.each([
    ['offline until Keep Cloud', false],
    ['online: the result goes up before Keep Cloud', true],
  ])('#4 (%s): Keep Cloud keeps the iPad\'s note, with the result', async (_label, online) => {
    const phone = await inConflictWhileAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    if (online) await uploadPendingChanges();
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toMatchObject({ status: 'analysis_complete' });
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('#4: left in conflict, the result still reaches the cloud\'s copy, so the iPad stops showing Analyzing; the phone\'s own copy is still held', async () => {
    const phone = await inConflictWhileAnalyzing();
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    expect(phone.requestPendingChangesUpload).toHaveBeenCalledWith('late_photo_analysis');
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toMatchObject({ status: 'analysis_complete' });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(phone.saved()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, status: 'failed' });
  });
});

/**
 * A4 pass 15 H1 (A7 pass 13; caused by 139b0bb): since 139b0bb any phone copy
 * of an update in conflict that was not exactly the conflict's own copy
 * counted as a "newer edit". The conflict's own queue item is dropped when the
 * conflict is found, so such a copy was staged "now" and went up over the
 * iPad's edit by itself; the conflict was cleared, and David's offline edit,
 * which lived only in the conflict record, was gone:
 * - A: a document's details edited (note, category), "Choose File Again", or
 *   a schedule document losing its current mark; then the waiting-update sync
 *   or Settings › Retry Sync ("1 pending item synced successfully.");
 * - B: a refresh put the iPad's copy on the card (Sent), and a document's
 *   upload attempts differ from the cloud's; then Sync Now;
 * - R1/R4: the same with a late analysis result or a document taken off
 *   waiting; R5: the cloud row lacks fields the card has empty; R6: an older
 *   copy put back on the card, then Retry Sync.
 * Now, while an update has an open conflict, nothing automatic sends it: the
 * automatic retry, the waiting-update sync, Retry Sync, Sync Now and the
 * refresh/realtime-triggered upload passes all leave it for review. Only Keep
 * Phone, Keep Cloud, or a Retry David confirms over the conflict sends it. A
 * newer edit made during the conflict waits too; Keep Phone sends it, after
 * the conflict's own copy (A7 pass 11 L-2), and its photos are checked as for
 * any edit.
 */
describe('nothing automatic sends an update in conflict (audit A4 pass 15 H1, A7 pass 13)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const conflictsPhoneNote = async () =>
    (((await getSyncConflicts())[0]?.localPayload as { updateData?: Update } | undefined)?.updateData)?.notes;
  /** The iPad keeps its note, the conflict stays open, and its phone side is still David's offline edit. */
  async function stillLeftForReview(offlineNote: string) {
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(await conflictsPhoneNote()).toBe(offlineNote);
  }
  /** The App's own updateDocumentEverywhere (as updateProjectDocument and Choose File Again run it), on the phone's card. */
  function changeDocumentEverywhere(phone: Device, documentId: string, updater: (document: Doc) => Doc) {
    evaluate<{ updateDocumentEverywhere: (id: string, change: (document: Doc) => Doc) => Doc | null }>(
      transpile(`${componentFunction('updateDocumentEverywhere')}\nmodule.exports = { updateDocumentEverywhere };`),
      {
        projectDocumentsCurrentRef: phone.projectDocumentsCurrentRef, setProjectDocuments: () => undefined,
        setDraft: () => undefined, setSavedUpdates: phone.setSavedUpdates,
      },
    ).updateDocumentEverywhere(documentId, updater);
    phone.render();
  }
  const photo = { id: 'photo-h1', uri: 'file:///phone/Documents/project-photos/h1.jpg', caption: '', createdAt: SENT_AT };

  it.each([
    ['its note and category edited', 'permit', (document: Doc) => ({ ...document, note: 'Revised permit, sheet 2', category: 'Drawing' })],
    ['Choose File Again', 'permit', (document: Doc) => ({
      ...document, name: 'permit-rev2.pdf', sizeBytes: 2048, status: 'local', uploadAttemptCount: 0,
      localUri: 'file:///phone/Documents/project-documents-v2/replacement.pdf', ownedFileId: 'replacement-file',
    })],
    ['a schedule document losing its current mark', 'lookahead', (document: Doc) => ({ ...document, isCurrent: false })],
  ])('A (%s): the waiting-update sync and Retry Sync leave it for review; Retry Sync does not say it synced', async (_label, documentId, change) => {
    const { phone } = await phoneEditInConflict(() => [uploaded('permit'), { ...uploaded('lookahead'), category: 'Schedule', isCurrent: true }]);
    changeDocumentEverywhere(phone, documentId, change);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    await stillLeftForReview(PHONE_NOTE);
    expect(await pressRetrySync(phone)).toBe('The sync queue is clear, but 1 saved conflict needs review.');
    await stillLeftForReview(PHONE_NOTE);
    expect(phone.saved()).toMatchObject({ notes: PHONE_NOTE });
  });

  it('B: a refresh shows the iPad\'s copy as Sent, a document\'s upload attempts differ from the cloud\'s; Sync Now leaves it for review', async () => {
    const { phone } = await phoneEditInConflict(() => [phoneDocument('permit', { status: 'failed', uploadAttemptCount: 1 })]);
    // Another failed upload attempt on this phone since the update was sent.
    phone.projectDocumentsCurrentRef.current = [phoneDocument('permit', { status: 'failed', uploadAttemptCount: 3 })];
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    expect(await pressSyncNow(phone)).toBe('Cloud sync finished, but 1 saved conflict needs review.');
    await stillLeftForReview(PHONE_NOTE);
    // Keep Phone still sends David's offline edit.
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('control: a refresh, then Sync Now, keeps the conflict, with David\'s offline edit as its phone side', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await refresh(phone);
    await pressSyncNow(phone);
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
  });

  it('R1: a refresh shows the iPad\'s copy, a late analysis result waits; Sync Now leaves it for review, and the result still reaches the cloud\'s copy', async () => {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    await pressSyncNow(phone);
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
    expect(inCloud()).toMatchObject({ pieStatus: 'complete' });
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, pieStatus: 'complete' });
  });

  it('R4: a refresh shows the iPad\'s copy, a document taken off waits; Sync Now leaves it for review, and the document still comes off the cloud\'s copy', async () => {
    const { phone, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE });
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await pressSyncNow(phone);
    await stillLeftForReview(PHONE_NOTE);
    expect(documentIds(inCloud())).toEqual(['survey']);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('R4b: the iPad takes off the same document while the phone\'s change waits: the change found already in the cloud settles no conflict', async () => {
    const { phone, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await refresh(phone);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    // The iPad took it off too: the cloud's copy is the one the change waits with.
    putInCloud({ ...inCloud(), documents: phone.saved()!.documents, projectId: phone.saved()!.projectId }, new Date().toISOString());
    await uploadPendingChanges(); // the change is already in the cloud's copy
    expect(await getOfflineQueue()).toEqual([]);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
    expect(await conflictsPhoneNote()).toBe(PHONE_NOTE);
  });

  it('R5: the iPad\'s row lacks fields the card holds empty; after a refresh, Sync Now leaves it for review', async () => {
    const phone = await sentThroughTheApp([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    const { documents: _documents, ...withoutDocuments } = inCloud();
    putInCloud({ ...withoutDocuments, notes: IPAD_NOTE } as Update, new Date().toISOString());
    await new Promise(resolve => setTimeout(resolve, 5));
    await uploadPendingChanges();
    await refresh(phone);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, documents: [] });
    await pressSyncNow(phone);
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
  });

  it('R6: an older copy put back on the card (a restore on this phone), then Retry Sync: the iPad keeps its note', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    phone.setSavedUpdates(prev => prev.map(update => update.id === 'u1' ? { ...update, notes: 'Pour', status: 'failed' } : update));
    phone.render();
    expect(await pressRetrySync(phone)).toBe('The sync queue is clear, but 1 saved conflict needs review.');
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
  });

  it.each([
    ['without photos', []],
    ['with photos', [photo]],
  ])('a newer edit saved during the conflict (%s) is held by every automatic sync; Keep Phone sends it, the newest', async (_label, photos) => {
    const phone = await offlineEditInConflictWithIPad(photos);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER }); // after the iPad's edit
    await uploadPendingChanges(); // the automatic retry
    await waitingUpdateSync(phone);
    await pressRetrySync(phone);
    await pressSyncNow(phone);
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
    expect(((await queuedFor())!.payload.updateData as Update).notes).toBe(NEWER); // still waiting, with the time it was saved
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' });

    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges();
    await waitingUpdateSync(phone); // its photos are checked, as for any edit
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });

  it('a Retry sends the phone\'s copy over the conflict only once David confirms it; unconfirmed it is held', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await appRetryQueuedUpdate(phone)(phone.saved()!); // not confirmed (as a Save's own sync, or a Retry tapped before the card knew)
    phone.render();
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
    await appRetryQueuedUpdate(phone)(phone.saved()!, { overConflict: true }); // "Send your version over it?" Send
    phone.render();
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
    expect(phone.saved()).toMatchObject({ status: 'sent' });
  });

  it('the Save\'s own sync of a newer edit (no choice made) is held too', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    const edited = await editAndSave(phone, { notes: NEWER });
    const { heldForConflictReview } = await runFieldUpdateCloudSync(edited as never);
    expect(heldForConflictReview).toBe(true);
    await stillLeftForReview(RETRY_SYNC_OFFLINE_EDIT);
  });
});

/**
 * A7 pass 13 L-1 (caused by ec8199d, A4 pass 14 #3): the stamp that lets an
 * edit go up with this phone's own patches (the time the last of them left on
 * the cloud's copy) was given to every whole copy, Keep Phone's and a
 * confirmed Retry's too, which are stamped "now". The copy David chose went
 * up stamped with the earlier patch time: an iPad edit saved offline after
 * that time, before his choice, read newer than it, and went over it without
 * a conflict. Now the copy keeps the later of the two times.
 */
describe('a copy David chose is not stamped back to an earlier patch\'s time (audit A7 pass 13 L-1)', () => {
  /** In conflict while its photo was analysed; the result then lands on the iPad's copy; the iPad saves offline after that. */
  async function patchLandedThenIPadSavesOffline() {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toHaveLength(1);
    lateAnalysisFinishes(phone, finishedAnalysis());
    await phone.settle();
    await uploadPendingChanges(); // the result goes onto the iPad's copy
    const patchLandedAt = mockCloud.get('u1')!.updatedAt;
    await new Promise(resolve => setTimeout(resolve, 5));
    const iPadSavedOfflineAt = new Date().toISOString(); // its upload will compare the cloud's time with this
    await new Promise(resolve => setTimeout(resolve, 5));
    return { phone, patchLandedAt, iPadSavedOfflineAt };
  }

  it('Keep Phone: the kept copy reads newer than the iPad\'s offline save, so the iPad\'s upload finds the conflict', async () => {
    const { phone, patchLandedAt, iPadSavedOfflineAt } = await patchLandedThenIPadSavesOffline();
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, pieStatus: 'complete' });
    expect(mockCloud.get('u1')!.updatedAt).not.toBe(patchLandedAt);
    expect(Date.parse(mockCloud.get('u1')!.updatedAt)).toBeGreaterThan(Date.parse(iPadSavedOfflineAt));
  });

  it('a Retry David confirmed: the same', async () => {
    const { phone, iPadSavedOfflineAt } = await patchLandedThenIPadSavesOffline();
    await appRetryQueuedUpdate(phone)(phone.saved()!, { overConflict: true });
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(Date.parse(mockCloud.get('u1')!.updatedAt)).toBeGreaterThan(Date.parse(iPadSavedOfflineAt));
  });
});

/**
 * A7 pass 13 L-2 (older; visible since A4 pass 14 #5 names other failures
 * after the conflict sentence): Sync Now runs two upload passes, and an item
 * that fails in both was counted, and listed, twice: "2 other items still
 * need attention", the same update twice; with no conflict, "Cloud sync
 * finished with 2 items still needing attention". Errors of the same item
 * with the same message now count once.
 */
describe('Sync Now counts an item failing in both of its upload passes once (audit A7 pass 13 L-2)', () => {
  const REFUSED = 'permission denied for table project_updates';
  /** Another update, waiting on this phone, that the cloud refuses each time. */
  async function anotherUpdateRefused(phone: Device) {
    const other = { ...savedUpdate([], 'queued', 'u2'), notes: 'Strip forms' };
    phone.setSavedUpdates(prev => [...prev, other]);
    phone.render();
    await queueProjectUpdateRecord(other, false);
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockImplementation(async (params: { id: string }) => params.id === 'u2'
      ? { ok: false, configured: true, stubbed: false, error: REFUSED }
      : save(params));
    return () => (saveProjectUpdate as jest.Mock).mockImplementation(save);
  }
  const failure = 'Field update for “P” could not sync. Cloud sync needs service attention. Your changes remain saved on this phone.';

  it('beside a conflict: "1 other item still needs attention", listed once', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const restore = await anotherUpdateRefused(phone);
    try {
      expect(await pressSyncNow(phone)).toBe([
        'Cloud sync finished, but 1 saved conflict needs review.',
        '1 other item still needs attention:',
        `• ${failure}`,
      ].join('\n'));
    } finally {
      restore();
    }
  });

  it('with no conflict: "Cloud sync finished with 1 item still needing attention", listed once', async () => {
    const phone = await sentThroughTheApp([]);
    const restore = await anotherUpdateRefused(phone);
    try {
      expect(await pressSyncNow(phone)).toBe([
        'Cloud sync finished with 1 item still needing attention:',
        `• ${failure}`,
      ].join('\n'));
    } finally {
      restore();
    }
  });

  it('two updates of the same project failing with the same message still count as two', async () => {
    const phone = await sentThroughTheApp([]);
    const restore = await anotherUpdateRefused(phone);
    const third = { ...savedUpdate([], 'queued', 'u3'), notes: 'Pour deck' };
    phone.setSavedUpdates(prev => [...prev, third]);
    phone.render();
    await queueProjectUpdateRecord(third, false);
    const refuseBoth = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    (saveProjectUpdate as jest.Mock).mockImplementation(async (params: { id: string }) => params.id === 'u3'
      ? { ok: false, configured: true, stubbed: false, error: REFUSED }
      : refuseBoth(params));
    try {
      expect(await pressSyncNow(phone)).toBe([
        'Cloud sync finished with 2 items still needing attention:',
        `• ${failure}`,
        `• ${failure}`,
      ].join('\n'));
    } finally {
      restore();
    }
  });
});

/**
 * A4 pass 16 M1 (A7 pass 14 L-1; caused by 0cf5d20): David saved a newer
 * edit, with a photo, of an update in conflict. The Save's own sync was held
 * for review, but its result, "has a cloud conflict that needs review", was
 * written to the card as a failure ("Sync failed · Retry", failure category
 * unknown), which no automatic sync retries. Review Conflicts showed the
 * newer edit; Keep Phone sent the conflict's copy and queued the newer edit
 * after it, still waiting on its photo; Settings said "Pending local changes
 * will sync automatically", but nothing checked that photo, and the iPad kept
 * the older copy until David tapped Retry or Sync Now. The Save's own sync
 * now leaves a held update as it is, Waiting to Sync (its card reads Needs
 * Review), as the waiting-update sync does; after Keep Phone the
 * waiting-update sync checks the photo and sends the edit.
 */
/** The App's own syncQueuedFieldUpdateInBackground (a Save's own sync), compiled from App.tsx, on the phone's state. */
function appSaveSync(phone: Device) {
  const diagnostics = [
    'classifySyncFailureCategory', 'syncCategoryForStorageFailure', 'syncCategoryIsRlsOrAuth', 'emptyPermissionAttempt',
    'inferPermissionAttemptFromFailure', 'buildSkippedSyncDiagnostics', 'buildSyncDiagnosticsFromUpload', 'statusForSyncDiagnostics',
  ];
  return evaluate<{ syncQueuedFieldUpdateInBackground: (update: Update) => Promise<void> }>(
    transpile([...diagnostics.map(appFunction), componentFunction('syncQueuedFieldUpdateInBackground'),
      'module.exports = { syncQueuedFieldUpdateInBackground };'].join('\n')),
    {
      classifySyncFailureText, persistedStatusForSyncResult,
      getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
      fieldUpdateSyncCategoryWithoutSession: async () => 'offline', signInPendingRef: { current: false },
      runFieldUpdateCloudSync,
      // The card takes what the Save's sync wrote (the App's own commit checks it is still the saved copy).
      persistSavedUpdateImmediately: async (update: Update) => {
        phone.setSavedUpdates(prev => prev.map(item => item.id === update.id ? update : item));
        phone.render();
        return true;
      },
    },
  ).syncQueuedFieldUpdateInBackground;
}

describe('after Keep Phone, a newer edit with photos saved during the conflict reaches the cloud (audit A4 pass 16 M1, A7 pass 14 L-1)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const photo = { id: 'photo-p16-m1', uri: 'file:///phone/Documents/project-photos/p16-m1.jpg', caption: '', createdAt: SENT_AT };
  const added = { id: 'photo-p16-m1-new', uri: 'file:///phone/Documents/project-photos/p16-m1-new.jpg', caption: '', createdAt: SENT_AT };
  const notInCloudYet = { ok: false, configured: true, stubbed: false, error: 'Object not found', status: 404 };

  it('the Save\'s own sync leaves the newer edit Waiting to Sync; Keep Phone, then the automatic retry and the waiting-update sync send it with its new photo', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    // David edits it again and saves: the App's save writes the card and its queue record, then runs its own sync.
    const edited = await editAndSave(phone, { notes: NEWER, photos: [photo, added] });
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async (path: string) => String(path).includes(added.id) ? notInCloudYet : signedUrl);
    fileSystemMock().getInfoAsync.mockImplementation(async (uri: string) =>
      uri === added.uri ? { exists: true, size: 2048 } : { exists: false });
    const upload = jest.spyOn(supabaseMock() as { uploadPhoto: (...args: unknown[]) => Promise<unknown> }, 'uploadPhoto')
      .mockResolvedValue({ ok: true, configured: true, stubbed: false, data: { path: 'uploaded' } });
    try {
      await appSaveSync(phone)(edited);
      // Held for review, its card as the save left it: Waiting to Sync, which reads Needs Review while the conflict is open.
      expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' });
      expect(fieldUpdateHasOpenConflict(await getSyncConflicts(), 'u1')).toBe(true);
      expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
      expect(upload).not.toHaveBeenCalled(); // nothing of it goes up while held

      await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
      expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT }); // the conflict's own copy first
      expect(await getSyncConflicts()).toEqual([]);
      // What Settings says is now true.
      expect((await getSyncStatus()).message).toBe('Supabase is configured. Pending local changes will sync automatically.');

      await uploadPendingChanges(); // the automatic retry
      await waitingUpdateSync(phone);
      expect(upload).toHaveBeenCalled();
      expect(inCloud()).toMatchObject({ notes: NEWER });
      expect((inCloud().photos as Array<{ id: string }>).map(item => item.id)).toEqual([photo.id, added.id]);
      expect(await getOfflineQueue()).toEqual([]);
      expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
    } finally {
      upload.mockRestore();
      fileSystemMock().getInfoAsync.mockImplementation(async () => ({ exists: false }));
    }
  });

  it('without photos: the same, and the card never reads "Sync failed"', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    const edited = await editAndSave(phone, { notes: NEWER });
    await appSaveSync(phone)(edited);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' });
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });

  it('control: a Save\'s own sync of an update not in conflict still records its outcome', async () => {
    const phone = await sentThroughTheApp([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    const edited = await editAndSave(phone, { notes: NEWER });
    await appSaveSync(phone)(edited);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });
});

/**
 * A4 pass 16 L1 (older): a Keep Phone whose save failed, with no newer edit
 * waiting, left its kept copy in the queue, still marked as David's choice
 * over the conflict (only a newer edit was put back). Settings said "Neither
 * copy was changed. Check the cloud connection and try again.", but once the
 * signal returned the kept copy went up by itself and the conflict was
 * cleared. The queue is now put back as it was before the choice: the kept
 * copy is dropped, and whatever waited for the update (a document change, a
 * newer edit) is queued again, unmarked, as a failed Keep Cloud does.
 */
describe('a failed Keep Phone leaves neither copy changed (audit A4 pass 16 L1)', () => {
  const offline = { ok: false, configured: true, stubbed: false, error: 'Network request failed' };
  /** Keep Phone in Settings with the signal gone: its save fails. The alerts Settings shows. */
  async function keepPhoneFails(phone: Device, conflict: { id: string }) {
    const save = (saveProjectUpdate as jest.Mock).getMockImplementation()!;
    try {
      (saveProjectUpdate as jest.Mock).mockResolvedValue(offline);
      return await chooseInSettingsExpectingFailure(phone, conflict, 'keep_local');
    } finally {
      (saveProjectUpdate as jest.Mock).mockImplementation(save);
    }
  }

  it('nothing else waiting: once reconnected, the kept copy does not go up by itself, and the conflict stays for review', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const [conflict] = await getSyncConflicts();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(await keepPhoneFails(phone, conflict)).toEqual(['Conflict not resolved']);
    expect(await getOfflineQueue()).toEqual([]);

    await uploadPendingChanges(); // reconnected: the automatic retry
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ id: conflict.id, localId: 'u1' })]);
    // Keep Phone chosen again still sends it.
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('a document taken off while in conflict: it is queued again as it was, goes onto the cloud\'s copy, and settles nothing', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    const waiting = await queuedFor();
    expect(waiting!.payload.documentPatches).toEqual([{ documentId: 'permit', remove: true }]);
    expect(await keepPhoneFails(phone, conflict)).toEqual(['Conflict not resolved']);
    expect(await queuedFor()).toEqual(waiting);

    await uploadPendingChanges(); // reconnected
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
    expect(await getSyncConflicts()).toEqual([expect.objectContaining({ localId: 'u1' })]);
  });

  it('control: a newer edit made during the conflict is still put back, unmarked, and waits for review', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: 'Pour, 45 yards (saved on the phone during the conflict)' });
    expect(await keepPhoneFails(phone, (await getSyncConflicts())[0])).toEqual(['Conflict not resolved']);
    const queued = (await queuedFor())!;
    expect(queued.payload.overConflict).toBeUndefined();
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
  });
});

/** Keep Phone or Keep Cloud in Settings (AdminScreen's own resolveConflict): everything the screen shows afterwards. */
async function chooseInSettingsSeeing(phone: Device, conflict: { id: string }, resolution: 'keep_local' | 'keep_cloud') {
  const seen = {
    alerts: [] as Array<{ title: string; message?: string }>, messages: [] as string[],
    conflictsShown: [] as unknown[][], reviewClosed: false, applied: [] as Update[],
  };
  const { resolveConflict } = evaluate<{ resolveConflict: (conflict: unknown, resolution: string) => Promise<void> }>(
    transpile(`${componentFunction('resolveConflict', adminScreen)}\nmodule.exports = { resolveConflict };`),
    {
      setResolvingConflictId: () => undefined, resolveScheduleItemSyncConflict: jest.fn(), onApplyCloudConflictScheduleItem: jest.fn(),
      resolveProjectUpdateSyncConflict, syncConflictChoiceStopReason, onApplyCloudConflictUpdate: (update: Update) => { seen.applied.push(update); },
      savedUpdates: phone.savedUpdatesRef.current, savedUpdatesRef: phone.savedUpdatesRef, projectUpdateCopyIsLastInCloud,
      onRetryUpdateSync: jest.fn(async () => ({})), // Settings' Retry callback (A4 pass 17 L2)
      getSyncConflicts, getSyncStatus: async () => null, setSyncStatus: () => undefined,
      setSyncConflicts: (conflicts: unknown[]) => { seen.conflictsShown.push(conflicts); },
      setSyncAttemptMessage: (message: string | null) => { if (message) seen.messages.push(message); },
      setConflictReviewVisible: (visible: boolean) => { if (!visible) seen.reviewClosed = true; },
      Alert: { alert: (title: string, message?: string) => { seen.alerts.push({ title, message }); } },
    },
  );
  await resolveConflict((await getSyncConflicts()).find(item => item.id === conflict.id), resolution);
  phone.render();
  return seen;
}

/**
 * A4 pass 16 L2 (older): an update in conflict was deleted on the iPad. Keep
 * Phone always failed ("Conflict not resolved. Neither copy was changed."):
 * the deletion record superseded its kept copy. Keep Cloud did clear the
 * conflict, but said "Conflict not resolved" too, and the list was not
 * refreshed, so the conflict still showed. A deleted update's conflict is now
 * closed for either choice, nothing is sent, and Settings says so and
 * refreshes the list.
 */
describe('a conflict for an update deleted on the iPad is closed by either choice (audit A4 pass 16 L2)', () => {
  const DELETED_MESSAGE = 'This update was deleted on another device, so the conflict is closed.';
  /** The iPad deletes the update: its cloud row is gone, and its deletion record is in the cloud. */
  function iPadDeletesIt() {
    mockCloud.delete('u1');
    (supabaseMock().listDAVESyncTombstones as jest.Mock).mockResolvedValue({
      ok: true, configured: true, stubbed: false,
      data: [{ entityType: 'project_update', recordId: 'u1', deletedAt: new Date().toISOString() }],
    });
  }
  afterEach(() => {
    (supabaseMock().listDAVESyncTombstones as jest.Mock).mockResolvedValue({ ok: true, configured: true, stubbed: false, data: [] });
  });

  it.each([
    ['Keep Phone', 'keep_local'],
    ['Keep Cloud', 'keep_cloud'],
  ] as const)('%s: the conflict is closed, Settings says why and refreshes the list, and nothing is sent', async (_label, resolution) => {
    const phone = await offlineEditInConflictWithIPad([]);
    const [conflict] = await getSyncConflicts();
    iPadDeletesIt();
    const writes = (saveProjectUpdate as jest.Mock).mock.calls.length;
    const seen = await chooseInSettingsSeeing(phone, conflict, resolution);
    expect(seen.alerts).toEqual([]);
    expect(seen.messages.at(-1)).toBe(DELETED_MESSAGE);
    expect(seen.conflictsShown.at(-1)).toEqual([]);
    expect(seen.reviewClosed).toBe(true);
    expect(seen.applied).toEqual([]);
    expect(await getSyncConflicts()).toEqual([]);
    expect((saveProjectUpdate as jest.Mock).mock.calls.length).toBe(writes);
    expect(mockCloud.has('u1')).toBe(false);
  });

  it('another conflict still open stays listed, and the message says so', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const [conflict] = await getSyncConflicts();
    // A second update in conflict.
    const other = { ...savedUpdate([], 'queued', 'u2'), notes: 'Strip forms (phone)' };
    putInCloud({ ...other, notes: 'Strip forms' });
    await queueProjectUpdateRecord(other, false);
    await new Promise(resolve => setTimeout(resolve, 5));
    putInCloud({ ...other, notes: 'Strip forms (iPad)' }, new Date().toISOString());
    await uploadPendingChanges();
    expect(await getSyncConflicts()).toHaveLength(2);
    iPadDeletesIt();
    const seen = await chooseInSettingsSeeing(phone, conflict, 'keep_local');
    expect(seen.alerts).toEqual([]);
    expect(seen.messages.at(-1)).toBe(`${DELETED_MESSAGE} 1 conflict remains to review.`);
    expect(seen.conflictsShown.at(-1)).toEqual([expect.objectContaining({ localId: 'u2' })]);
    expect(seen.reviewClosed).toBe(false);
  });

  it('control: an update not deleted is still kept as chosen', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const seen = await chooseInSettingsSeeing(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(seen.alerts).toEqual([]);
    expect(seen.messages.at(-1)).toBe('Cloud conflicts resolved.');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
  });
});

/**
 * A4 pass 16 L3, raised to Medium as A7 pass 14 M-1 (older): Review
 * Conflicts' "Cloud:" line showed the cloud's copy saved when the conflict
 * was found, and nothing read it again. When the iPad edited the update once
 * more, Keep Phone (stamped now, so it passed the conflict check) put the
 * phone's copy over an iPad edit the screen never showed, and Keep Cloud
 * ended with a copy the screen never showed either. Each choice now reads the
 * cloud's copy first; when it changed since the conflict was saved (other
 * than by this phone's own document changes or analysis results), the
 * conflict is saved again with the current copy, nothing is sent, and
 * Settings says "The cloud copy changed — review again" and shows it.
 */
describe('Keep Phone and Keep Cloud never act on a cloud copy the screen did not show (audit A4 pass 16 L3, A7 pass 14 M-1)', () => {
  const remoteNote = async () => (((await getSyncConflicts())[0]?.remotePayload as Update | undefined)?.notes);

  it.each([
    ['Keep Phone', 'keep_local'],
    ['Keep Cloud', 'keep_cloud'],
  ] as const)('%s after the iPad edited again: nothing is sent, Settings asks to review again, and the conflict shows the iPad\'s newest copy; chosen again, it goes ahead', async (_label, resolution) => {
    const phone = await offlineEditInConflictWithIPad([]);
    const [conflict] = await getSyncConflicts();
    expect(await remoteNote()).toBe(IPAD_NOTE); // what the Cloud line shows
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_SECOND_NOTE);
    const writes = (saveProjectUpdate as jest.Mock).mock.calls.length;

    const seen = await chooseInSettingsSeeing(phone, conflict, resolution);
    expect(seen.alerts).toEqual([{ title: 'Cloud copy changed', message: 'The cloud copy changed — review again. Nothing was sent.' }]);
    expect((saveProjectUpdate as jest.Mock).mock.calls.length).toBe(writes);
    expect(inCloud()).toMatchObject({ notes: IPAD_SECOND_NOTE });
    expect(seen.applied).toEqual([]);
    expect(seen.reviewClosed).toBe(false);
    expect(seen.conflictsShown.at(-1)).toEqual([expect.objectContaining({ id: conflict.id, remotePayload: expect.objectContaining({ notes: IPAD_SECOND_NOTE }) })]);
    expect(await remoteNote()).toBe(IPAD_SECOND_NOTE);
    expect(await getOfflineQueue()).toEqual([]);

    // Reviewed again: the choice goes ahead.
    await new Promise(resolve => setTimeout(resolve, 5));
    await chooseInSettings(phone, conflict, resolution);
    expect(inCloud()).toMatchObject({ notes: resolution === 'keep_local' ? RETRY_SYNC_OFFLINE_EDIT : IPAD_SECOND_NOTE });
    expect(await getSyncConflicts()).toEqual([]);
  });

  it('this phone\'s own document change on the cloud\'s copy is not a change (an analysis result neither: R1 above): Keep Phone goes ahead at once', async () => {
    const { phone, conflict, persistDocuments } = await phoneEditInConflict(() => [uploaded('permit'), uploaded('survey')]);
    await phone.deleteFromThisDevice('permit');
    persistDocuments();
    await uploadPendingChanges(); // the change goes onto the iPad's copy; the conflict stays
    expect(documentIds(inCloud())).toEqual(['survey']);
    await chooseInSettings(phone, conflict, 'keep_local');
    expect(inCloud()).toMatchObject({ notes: PHONE_NOTE });
    expect(documentIds(inCloud())).toEqual(['survey']);
  });

  it('the cloud cannot be read: Keep Phone sends nothing, and neither copy changes', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const reads = supabaseMock().getProjectUpdateSyncMetadata as jest.Mock;
    const read = reads.getMockImplementation()!;
    try {
      reads.mockResolvedValue(photoCheckFails);
      const seen = await chooseInSettingsSeeing(phone, (await getSyncConflicts())[0], 'keep_local');
      expect(seen.alerts.map(alert => alert.title)).toEqual(['Conflict not resolved']);
    } finally {
      reads.mockImplementation(read);
    }
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE });
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(await getOfflineQueue()).toEqual([]);
  });
});

/**
 * A7 pass 14 L-3 (older): an update archived while it was in conflict (on
 * this phone, or on the iPad) kept its conflict open, and Keep Phone then
 * sent the conflict's copy, which was not archived: the cloud read the update
 * as not archived again. An archive is not a choice between the two copies,
 * so it does not settle the conflict (that would silently drop David's
 * offline edit kept in it); instead Keep Phone, and Keep Cloud, keep the
 * update archived when either device archived it.
 */
describe('Keep Phone keeps an update archived during its conflict archived (audit A7 pass 14 L-3)', () => {
  /** archiveProjectUpdate as the cloud does it: the row is marked archived. */
  function cloudArchives() {
    (archiveProjectUpdate as jest.Mock).mockImplementation(async ({ id, archivedAt }: { id: string; archivedAt: string }) => {
      const row = mockCloud.get(id)!;
      mockCloud.set(id, { updatedAt: archivedAt, updateData: { ...row.updateData, isArchived: true, archivedAt } });
      return { ok: true, configured: true, stubbed: false, data: null };
    });
  }
  afterEach(() => {
    (archiveProjectUpdate as jest.Mock).mockImplementation(async () => ({ ok: true, configured: true, stubbed: false, data: null }));
  });
  /** David archives it on this phone, as the App's Archive does: its record is replayed into the queue. */
  async function archivedOnThePhone(phone: Device) {
    const archivedAt = new Date().toISOString();
    await reconcileProjectUpdateDeletionJournal([A.buildUpdateTombstone(phone.saved()!, 'archive_sent_update', archivedAt)]);
    expect((await queuedFor())!.payload).toMatchObject({ archiveOnly: true });
    return archivedAt;
  }

  it('archived on this phone, the archive in the cloud: Keep Phone sends the phone\'s copy, still archived', async () => {
    cloudArchives();
    const phone = await offlineEditInConflictWithIPad([]);
    const archivedAt = await archivedOnThePhone(phone);
    await uploadPendingChanges();
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, isArchived: true, archivedAt });
    expect(await getSyncConflicts()).toHaveLength(1); // an archive settles nothing
    await new Promise(resolve => setTimeout(resolve, 5));
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, isArchived: true, archivedAt });
    expect(await getSyncConflicts()).toEqual([]);
  });

  /** Archived on this phone; the cloud refuses the archive for now, so it waits in the queue. */
  async function archiveWaitingOnThePhone(phone: Device) {
    (archiveProjectUpdate as jest.Mock).mockResolvedValue({ ok: false, configured: true, stubbed: false, error: 'Network request failed' });
    const archivedAt = await archivedOnThePhone(phone);
    await uploadPendingChanges();
    expect((await queuedFor())!.payload).toMatchObject({ archiveOnly: true, archivedAt });
    expect(inCloud().isArchived ?? false).toBe(false);
    return archivedAt;
  }

  it('archived on this phone, the archive still waiting to go up: the same', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const archivedAt = await archiveWaitingOnThePhone(phone);
    await new Promise(resolve => setTimeout(resolve, 5));
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, isArchived: true, archivedAt });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('archived on the iPad: Keep Phone sends the phone\'s copy, still archived', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const archivedAt = new Date().toISOString();
    putInCloud({ ...inCloud(), isArchived: true, archivedAt }, archivedAt);
    await new Promise(resolve => setTimeout(resolve, 5));
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, isArchived: true, archivedAt });
  });

  it('archived on this phone, the archive still waiting: Keep Cloud keeps it archived too', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const archivedAt = await archiveWaitingOnThePhone(phone);
    await new Promise(resolve => setTimeout(resolve, 5));
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, isArchived: true, archivedAt });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('control: an update not archived stays not archived', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(inCloud().isArchived ?? false).toBe(false);
  });
});

/**
 * A7 pass 14 L-2 (exposed by 0cf5d20): a photo's analysis finished while its
 * update was in conflict with a newer edit of David's held for review. The
 * result was put only into that held edit (as into any edit still waiting),
 * so it never reached the cloud's copy: the iPad showed "Analyzing" for as
 * long as the conflict was open. Keep Cloud then withdrew the held edit and
 * kept the cloud's copy, and the result was gone. The result now also goes
 * onto the cloud's copy as a patch, as for an update with nothing held (the
 * held edit takes it too and waits on), and Keep Cloud keeps this phone's
 * results for the photos the cloud's copy shares.
 */
describe('a late analysis result reaches the cloud\'s copy while a newer edit waits for review (audit A7 pass 14 L-2)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  /** Sent with its photo still being analysed; edited offline; the iPad edits; reconnected, the conflict is found; then a newer edit. */
  async function newerEditHeldWhileAnalysing() {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    return phone;
  }
  /** The result lands, then the automatic retry and the waiting-update sync run. */
  async function analysisFinishesThenSyncs(phone: Device) {
    const result = finishedAnalysis();
    lateAnalysisFinishes(phone, result);
    await phone.settle();
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    return result;
  }

  it('the result goes onto the cloud\'s copy at once; the conflict and the held newer edit (with the result) stay for review', async () => {
    const phone = await newerEditHeldWhileAnalysing();
    const result = await analysisFinishesThenSyncs(phone);
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toEqual(result);
    expect(await getSyncConflicts()).toHaveLength(1);
    const held = (await queuedFor())!;
    expect(held.payload.updateData).toMatchObject({ notes: NEWER, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(held.payload.updateData as Update)).toEqual(result);
    expect(held.payload.documentPatches).toBeUndefined(); // the whole held copy again, nothing more to send
  });

  it('then Keep Cloud: the cloud keeps the iPad\'s note with the result, and the card takes it', async () => {
    const phone = await newerEditHeldWhileAnalysing();
    const result = await analysisFinishesThenSyncs(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toEqual(result);
    expect(phone.saved()).toMatchObject({ notes: IPAD_NOTE, status: 'sent' });
    expect(firstPhotoAnalysis(phone.saved())).toEqual(result);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('then Keep Phone: the cloud ends with the newer edit, with the result', async () => {
    const phone = await newerEditHeldWhileAnalysing();
    const result = await analysisFinishesThenSyncs(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toEqual(result);
    expect(await getSyncConflicts()).toEqual([]);
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('a result taken into the phone\'s edit before the conflict was found: Keep Cloud keeps it on the cloud\'s copy', async () => {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    const result = finishedAnalysis();
    lateAnalysisFinishes(phone, result); // taken into the waiting edit, offline
    await phone.settle();
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toHaveLength(1);
    expect(firstPhotoAnalysis(inCloud())).toMatchObject({ status: 'analyzing' });
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_cloud');
    expect(inCloud()).toMatchObject({ notes: IPAD_NOTE, pieStatus: 'complete' });
    expect(firstPhotoAnalysis(inCloud())).toEqual(result);
  });
});

/**
 * A4 pass 16 (recorded): when Settings › Sync Now could not finish, its
 * message counted the items still on the phone as the queued changes plus
 * the conflicts. An update held for conflict review is both (its newer edit
 * waits in the queue, and its conflict is open), so one update read "2 items
 * remain saved on this phone". It is counted once, as Retry Sync counts it
 * (81ec965).
 */
describe('Sync Now that cannot finish counts an update held for conflict review once (audit A4 pass 16)', () => {
  /** AdminScreen's own Sync Now with the full sync failing; the message it shows. */
  async function pressSyncNowThatFails(phone: Device): Promise<string> {
    const messages: string[] = [];
    const { handleFullSyncNow } = evaluate<{ handleFullSyncNow: () => Promise<void> }>(
      transpile(`${componentFunction('handleFullSyncNow', adminScreen)}\nmodule.exports = { handleFullSyncNow };`),
      {
        setIsSyncing: () => undefined, setLastFullSyncIssueCount: () => undefined,
        setSyncAttemptMessage: (message: string) => { messages.push(message); }, setAdminActionSummary: () => undefined,
        startProjectDocumentUploadRun: () => ({ remaining: () => 0 }), onRetryDocumentUploads: jest.fn(),
        synchronizeLocalData: async () => { throw new Error('Network request failed'); },
        localProjects: ['P'], savedUpdates: phone.savedUpdatesRef.current, projectAreas: [], scheduleItems: [], referenceDocuments: [],
        getSyncStatus, getSyncConflicts, setSyncStatus: () => undefined, setSyncConflicts: () => undefined,
        onApplyCloudRecovery: () => undefined, failedDocumentCountRef: { current: 0 },
        projectDocumentsStillUploadingNotice: () => null, showMissingPhotoSyncAlert: jest.fn(),
        // As AdminScreen counts them: its cards Waiting to Sync or failed.
        updateSyncAttentionCount: phone.savedUpdatesRef.current.filter(update => update.status === 'queued' || update.status === 'failed').length,
        failedDocumentCount: 0,
      },
    );
    await handleFullSyncNow();
    return messages.at(-1) || '';
  }

  it('a newer edit held for review: one item, not two', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: 'Pour, 45 yards (saved on the phone during the conflict)' });
    expect((await getSyncStatus()).heldForConflictReview).toBe(1);
    expect(await pressSyncNowThatFails(phone)).toBe('Full cloud sync could not finish. 1 item remains saved on this phone.');
  });

  it('another update waiting too is still counted: two items', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: 'Pour, 45 yards (saved on the phone during the conflict)' });
    const other = { ...savedUpdate([], 'queued', 'u2'), notes: 'Strip forms' };
    phone.setSavedUpdates(prev => [...prev, other]);
    phone.render();
    await queueProjectUpdateRecord(other, false);
    expect(await pressSyncNowThatFails(phone)).toBe('Full cloud sync could not finish. 2 items remain saved on this phone.');
  });
});

/**
 * Whole-app audit A4 pass 17 L2 (914d361 incomplete; 01f4638 regressed the
 * newer-edit case): the iPad archived an update in conflict on the phone.
 * Keep Phone sent the phone's copy, archived, as it should. But Settings
 * read the kept copy (archived) as differing from the card (not archived),
 * took that for a newer phone edit, and left the card as it was, Waiting to
 * Sync. The next waiting-update sync staged the card's un-archived copy over
 * the queued one and sent it: the cloud read not archived, and the update
 * came back on the iPad. The same with a newer edit held for review, with or
 * without a new photo. The archive is now left out of that comparison and
 * put on the card, which hides it; and no staging sends a copy un-archived
 * over an archived one queued or put in the cloud by this phone.
 */
describe('Keep Phone\'s archive is not undone by the waiting-update sync (audit A4 pass 17 L2)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';
  const photo = { id: 'photo-p17-l2', uri: 'file:///phone/Documents/project-photos/p17-l2.jpg', caption: '', createdAt: SENT_AT };
  const added = { id: 'photo-p17-l2-new', uri: 'file:///phone/Documents/project-photos/p17-l2-new.jpg', caption: '', createdAt: SENT_AT };
  const notInCloudYet = { ok: false, configured: true, stubbed: false, error: 'Object not found', status: 404 };
  let upload: jest.SpyInstance;
  beforeEach(() => {
    upload = jest.spyOn(supabaseMock() as { uploadPhoto: (...args: unknown[]) => Promise<unknown> }, 'uploadPhoto')
      .mockResolvedValue({ ok: true, configured: true, stubbed: false, data: { path: 'uploaded' } });
  });
  afterEach(() => {
    upload.mockRestore();
    fileSystemMock().getInfoAsync.mockImplementation(async () => ({ exists: false }));
  });
  type Kind = 'no newer edit' | 'a held newer edit' | 'a held newer edit with a new photo';
  /** In conflict (with a newer edit held for review, per `kind`); then the iPad archives it. */
  async function archivedOnTheIPadWhileInConflict(kind: Kind) {
    const phone = await offlineEditInConflictWithIPad(kind === 'a held newer edit with a new photo' ? [photo] : []);
    if (kind !== 'no newer edit') {
      await new Promise(resolve => setTimeout(resolve, 5));
      const photos = kind === 'a held newer edit with a new photo' ? [photo, added] : [];
      if (photos.length > 0) {
        (createPhotoSignedUrl as jest.Mock).mockImplementation(async (path: string) => String(path).includes(added.id) ? notInCloudYet : signedUrl);
        fileSystemMock().getInfoAsync.mockImplementation(async (uri: string) => uri === added.uri ? { exists: true, size: 2048 } : { exists: false });
      }
      const edited = await editAndSave(phone, { notes: NEWER, photos });
      await appSaveSync(phone)(edited);
      expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' }); // held for review
    }
    const archivedAt = new Date().toISOString();
    putInCloud({ ...inCloud(), isArchived: true, archivedAt }, archivedAt);
    await new Promise(resolve => setTimeout(resolve, 5));
    return { phone, archivedAt };
  }
  /** Settings' Retry callback as the App wires it (onRetryUpdateSync, the App's own retryQueuedUpdate); `settled` waits for its calls. */
  function settingsRetryCallback(phone: Device) {
    const wiring = /onRetryUpdateSync=\{(.+)\}\n/.exec(app)![1];
    const retry = evaluate<(...args: unknown[]) => Promise<unknown>>(
      transpile(`module.exports = ${wiring};`), { retryQueuedUpdate: appRetryQueuedUpdate(phone) });
    const calls: Array<Promise<unknown>> = [];
    const onRetryUpdateSync = jest.fn((...args: unknown[]) => {
      const call = retry(...args);
      calls.push(call);
      return call;
    });
    return { onRetryUpdateSync, settled: async () => { await Promise.all(calls); phone.render(); } };
  }
  /** Hidden as an archive hides it: the App lists only cards not archived (activeSavedUpdates), and a refresh drops one the cloud reads archived. */
  async function hiddenOnTheCard(phone: Device) {
    expect(phone.saved()).toMatchObject({ isArchived: true });
    await refresh(phone);
    expect(phone.saved()?.isArchived ?? 'dropped').not.toBe(false);
  }

  it.each([
    ['no newer edit'], ['a held newer edit'], ['a held newer edit with a new photo'],
  ] as Array<[Kind]>)('%s: Keep Phone, then the automatic retry and the waiting-update sync; archived in the cloud and hidden on the card', async kind => {
    const { phone, archivedAt } = await archivedOnTheIPadWhileInConflict(kind);
    const { onRetryUpdateSync, settled } = settingsRetryCallback(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local', onRetryUpdateSync);
    // The card is archived at once (it stayed Waiting to Sync, not archived);
    // a newer edit's card through Settings' Retry callback, archived.
    expect(phone.saved()).toMatchObject({ isArchived: true, archivedAt });
    expect(onRetryUpdateSync.mock.calls.map(([update]) => (update as Update).isArchived)).toEqual(kind === 'no newer edit' ? [] : [true]);
    await settled();
    expect(await getSyncConflicts()).toEqual([]);
    await uploadPendingChanges(); // the automatic retry
    await waitingUpdateSync(phone);
    const kept = kind === 'no newer edit' ? RETRY_SYNC_OFFLINE_EDIT : NEWER;
    // It read not archived: the card's copy went up over the archived one.
    expect(inCloud()).toMatchObject({ notes: kept, isArchived: true, archivedAt });
    if (kind === 'a held newer edit with a new photo') {
      expect(upload).toHaveBeenCalled();
      expect((inCloud().photos as Array<{ id: string }>).map(item => item.id)).toEqual([photo.id, added.id]);
    }
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: kept, status: 'sent', isArchived: true, archivedAt });
    await hiddenOnTheCard(phone);
    expect(inCloud()).toMatchObject({ isArchived: true });
  });

  it.each([
    ['a held newer edit'], ['a held newer edit with a new photo'],
  ] as Array<[Kind]>)('%s, the archive not yet on the card (the app closed right after Keep Phone): the waiting-update sync still sends it archived', async kind => {
    const { phone, archivedAt } = await archivedOnTheIPadWhileInConflict(kind);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local'); // Settings' Retry callback never ran
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'queued' });
    expect(phone.saved()!.isArchived ?? false).toBe(false);
    await waitingUpdateSync(phone); // before the automatic retry: it stages the card's copy over the queued, archived one
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER, isArchived: true, archivedAt });
    expect(await getOfflineQueue()).toEqual([]);
    await refresh(phone);
    expect(phone.saved()?.isArchived ?? 'dropped').not.toBe(false);
    expect(inCloud()).toMatchObject({ isArchived: true });
  });

  it('a held newer edit, the automatic retry first, then the waiting-update sync with the card not archived: nothing goes up un-archived', async () => {
    const { phone, archivedAt } = await archivedOnTheIPadWhileInConflict('a held newer edit');
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local');
    await uploadPendingChanges(); // the newer edit, archived, goes up
    expect(inCloud()).toMatchObject({ notes: NEWER, isArchived: true, archivedAt });
    const writes = (saveProjectUpdate as jest.Mock).mock.calls.length;
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER, isArchived: true, archivedAt });
    expect((saveProjectUpdate as jest.Mock).mock.calls.length).toBe(writes);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
  });

  /**
   * A4 pass 17 (observation): after Keep Phone with a newer edit that has a
   * new photo, nothing started the waiting-update sync: its card already
   * read Waiting to Sync, so the trigger for cards waiting did not fire
   * again, and the edit waited for the app to come back to the front or for
   * realtime to reconnect. Settings now sends it at once, after the kept
   * copy, through its Retry callback.
   */
  it('observation: Keep Phone with a held newer edit with a new photo sends it at once, with no automatic retry or waiting-update sync', async () => {
    const phone = await offlineEditInConflictWithIPad([photo]);
    await new Promise(resolve => setTimeout(resolve, 5));
    (createPhotoSignedUrl as jest.Mock).mockImplementation(async (path: string) => String(path).includes(added.id) ? notInCloudYet : signedUrl);
    fileSystemMock().getInfoAsync.mockImplementation(async (uri: string) => uri === added.uri ? { exists: true, size: 2048 } : { exists: false });
    await appSaveSync(phone)(await editAndSave(phone, { notes: NEWER, photos: [photo, added] }));
    const { onRetryUpdateSync, settled } = settingsRetryCallback(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local', onRetryUpdateSync);
    expect(onRetryUpdateSync).toHaveBeenCalledWith(expect.objectContaining({ notes: NEWER }), { automatic: true });
    await settled();
    // It kept the conflict's copy, the newer edit and its photo still waiting.
    expect(upload).toHaveBeenCalled();
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect((inCloud().photos as Array<{ id: string }>).map(item => item.id)).toEqual([photo.id, added.id]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
    expect(inCloud().isArchived ?? false).toBe(false);
  });

  it('observation, control: Keep Phone with no newer edit asks for no further send', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    const { onRetryUpdateSync } = settingsRetryCallback(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local', onRetryUpdateSync);
    expect(onRetryUpdateSync).not.toHaveBeenCalled();
    expect(inCloud()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT });
    expect(phone.saved()).toMatchObject({ notes: RETRY_SYNC_OFFLINE_EDIT, status: 'sent' });
  });

  it('control: not archived, Keep Phone with a held newer edit ends with the newer edit, not archived', async () => {
    const phone = await offlineEditInConflictWithIPad([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await appSaveSync(phone)(await editAndSave(phone, { notes: NEWER }));
    const { onRetryUpdateSync, settled } = settingsRetryCallback(phone);
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local', onRetryUpdateSync);
    await settled();
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(inCloud().isArchived ?? false).toBe(false);
    expect(phone.saved()).toMatchObject({ notes: NEWER, status: 'sent' });
    expect(phone.saved()!.isArchived ?? false).toBe(false);
  });
});

/**
 * Whole-app audit A4 pass 18 L1 (caused by 6c4f49a): after Keep Phone with a
 * newer edit, Settings sent the card as it was when David tapped. A photo
 * analysis that finished while Keep Phone talked to the cloud had reached
 * the card; the App's Retry wrote the older copy over the card, then over
 * the waiting edit, then to the cloud, and both devices read "Analyzing".
 * Settings now sends the card as it is after the choice.
 */
describe('after Keep Phone, Settings sends the newer edit as the card is now (audit A4 pass 18 L1)', () => {
  const NEWER = 'Pour, 45 yards (saved on the phone during the conflict)';

  it('a photo analysis that finishes while Keep Phone talks to the cloud stays on the card and reaches the cloud', async () => {
    const phone = await sentThroughTheApp([analyzingPhoto]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: RETRY_SYNC_OFFLINE_EDIT });
    await new Promise(resolve => setTimeout(resolve, 5));
    await iPadEditsNow(IPAD_NOTE);
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(await getSyncConflicts()).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await editAndSave(phone, { notes: NEWER });
    // Settings' Retry callback as the App wires it.
    const wiring = /onRetryUpdateSync=\{(.+)\}\n/.exec(app)![1];
    const retry = evaluate<(...args: unknown[]) => Promise<unknown>>(
      transpile(`module.exports = ${wiring};`), { retryQueuedUpdate: appRetryQueuedUpdate(phone) });
    const calls: Array<Promise<unknown>> = [];
    const onRetryUpdateSync = jest.fn((...args: unknown[]) => {
      const call = retry(...args);
      calls.push(call);
      return call;
    });
    const result = finishedAnalysis();
    await chooseInSettings(phone, (await getSyncConflicts())[0], 'keep_local', onRetryUpdateSync, async () => {
      lateAnalysisFinishes(phone, result);
      await phone.settle();
    });
    expect(onRetryUpdateSync).toHaveBeenCalledTimes(1);
    expect(firstPhotoAnalysis(onRetryUpdateSync.mock.calls[0][0] as Update)).toEqual(result);
    await Promise.all(calls);
    phone.render();
    await uploadPendingChanges();
    await waitingUpdateSync(phone);
    expect(phone.saved()).toMatchObject({ notes: NEWER });
    expect(firstPhotoAnalysis(phone.saved())).toEqual(result);
    expect(inCloud()).toMatchObject({ notes: NEWER });
    expect(firstPhotoAnalysis(inCloud())).toEqual(result);
    expect(await getSyncConflicts()).toEqual([]);
  });
});
