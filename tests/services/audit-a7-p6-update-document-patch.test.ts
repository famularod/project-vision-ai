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

import { createPhotoSignedUrl, listProjectUpdates, saveProjectUpdate } from '../../services/SupabaseService';
import {
  getOfflineQueue,
  hydrateProjectUpdatePhotoPreviews,
  cloudPhotoPreviewIsFresh,
  projectUpdateUploadedSince,
  loadRemovedFieldUpdateDocuments,
  queueProjectUpdateDocumentChange,
  queueProjectUpdateRecord,
  requeueRemovedFieldUpdateDocuments,
  runFieldUpdateCloudSync,
  uploadPendingChanges,
} from '../../services/SyncService';
import { resolveLegacyOwnedLocalFilePath } from '../../services/OwnedLocalFileRepository';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { hasMatchingQueuedProjectUpdateRevision } from '../../services/ProjectUpdateQueueRevision';
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
} from '../../services/ProjectDocumentUploadRetry';
import {
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
      withDeviceDocumentUploadState, hydrateProjectUpdatePhotoPreviews, getOfflineQueue,
      documentsUploadedAfterCloudCopy, resendUpdatesListingDocument: device.resendUpdatesListingDocument,
      deletedUpdateTombstonesRef: { current: [] }, buildUpdateTombstone: A.buildUpdateTombstone,
      upsertDeletedUpdateTombstone: A.upsertDeletedUpdateTombstone, hasMatchingQueuedProjectUpdateRevision,
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
    isComplianceSensitiveProjectDocument: () => false,
    findSharedReferenceDocumentForProjectDocument: () => null,
    referenceDocumentsCurrentRef: { current: [] },
    projectDocumentSharedRecordSync: { cancel: jest.fn() },
    deleteOwnedProjectDocument: async () => ({ status: 'deleted' }), hiddenSharedDocuments: { hide: jest.fn() },
    withdrawUnsentProjectDocumentBridge: async () => null, getOfflineQueue,
    removeOperationalRecordFromSyncQueue: async () => undefined, setReferenceDocuments: jest.fn(),
    removeReferenceDocumentEverywhere: async () => undefined,
    queueProjectUpdateRecord, queueProjectUpdateDocumentChange, requestQueuedUpdateSync, fieldUpdatesToResendForDocument,
    withoutFieldUpdateDocument, withDeviceDocumentUploadState,
  };
  const names = ['updateDocumentEverywhere', 'retryProjectDocumentUpload', 'deleteProjectDocument', 'resendUpdatesListingDocument'];
  const fns = evaluate<{
    retryProjectDocumentUpload: (documentId: string) => Promise<boolean | undefined>;
    deleteProjectDocument: (documentId: string) => void;
    resendUpdatesListingDocument: (documentId: string, change: (update: Update) => Update) => void;
  }>(transpile([...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n')), deps);
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
    ...fns, render, settle, press, deleteFromThisDevice, alerts, requestQueuedUpdateSync, setSavedUpdates,
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
    expect(phone.saved()?.status).toBe('queued');
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalled();

    // Reconnected: the waiting update's sync pass stages it and uploads the queue.
    await syncWaitingUpdate(phone);
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
    expect(phone.saved()?.status).toBe('queued');

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
