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
import { fieldUpdateDocumentChangeWaiting } from '../../services/FieldUpdateDocumentChangeNotice';
import {
  getOfflineQueue,
  getSyncConflicts,
  hydrateProjectUpdatePhotoPreviews,
  cloudPhotoPreviewIsFresh,
  projectUpdateUploadedSince,
  loadRemovedFieldUpdateDocuments,
  projectUpdateCopyIsLastInCloud,
  queueProjectUpdateDocumentChange,
  queueProjectUpdateRecord,
  requeueRemovedFieldUpdateDocuments,
  resetFieldUpdateSyncMemoryForTests,
  resolveProjectUpdateSyncConflict,
  runFieldUpdateCloudSync,
  uploadPendingChanges,
} from '../../services/SyncService';
import { reconcileProjectUpdateDeletionJournal } from '../../services/updateService';
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
async function syncWaitingUpdate(phone: Device, id = 'u1') {
  const { syncResult } = await runFieldUpdateCloudSync(phone.saved(id) as never);
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
/** Keep Phone or Keep Cloud in Settings: AdminScreen's own resolveConflict, then the App's own handler for the chosen copy. */
async function chooseInSettings(phone: Device, conflict: { id: string }, resolution: 'keep_local' | 'keep_cloud') {
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
      resolveProjectUpdateSyncConflict, onApplyCloudConflictUpdate: applyChosen, savedUpdates: phone.savedUpdatesRef.current,
      projectUpdateCopyIsLastInCloud,
      getSyncConflicts, getSyncStatus: async () => null, setSyncConflicts: () => undefined, setSyncStatus: () => undefined,
      setSyncAttemptMessage: () => undefined, setConflictReviewVisible: () => undefined,
      Alert: { alert: (title: string) => { alerts.push(title); } },
    },
  );
  await resolveConflict((await getSyncConflicts()).find(item => item.id === conflict.id), resolution);
  phone.render();
  expect(alerts).toEqual([]);
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
      resolveProjectUpdateSyncConflict, onApplyCloudConflictUpdate: jest.fn(), savedUpdates: phone.savedUpdatesRef.current,
      projectUpdateCopyIsLastInCloud,
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

  it('offline: nothing changes, the newer edit stays queued; reconnected, a refresh before the waiting-update sync keeps it and it reaches the cloud', async () => {
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
    await syncWaitingUpdate(phone); // Retry on the card
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
