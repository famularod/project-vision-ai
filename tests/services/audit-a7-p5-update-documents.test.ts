/**
 * Whole-app audit A7 pass 5 (30 Sep 2026), documents attached to a field
 * update.
 *
 * M1 (a) Delete from This Device / All Devices took a document off a sent
 *    update on the phone only; nothing was queued, so the next refresh put
 *    the cloud copy back, still listing it, and the iPad kept listing it.
 * M1 (b) A document that uploaded after its update was sent read "Document
 *    upload failed · Retry" again after every refresh (the cloud copy holds
 *    the state the phone had when it sent the update), and on the iPad.
 *
 * Runs the App's own project_updates refresh closure, updateDocumentEverywhere,
 * retryProjectDocumentUpload, deleteProjectDocument and the new resend
 * helper, compiled from App.tsx, with the real SyncService queue (in-memory
 * storage), queue matcher, normalizers and realtime applier. Network is
 * mocked; no Supabase call is made.
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
jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  createPhotoSignedUrl: jest.fn(),
  listProjectUpdates: jest.fn(),
  verifyDAVEAppOwner: jest.fn(async () => ({ ok: true, data: true })),
}));
jest.mock('../../services/SyncService', () => ({
  ...jest.requireActual('../../services/SyncService'),
  requestPendingChangesUpload: jest.fn(),
}));

import { listProjectUpdates } from '../../services/SupabaseService';
import {
  cloudPhotoPreviewIsFresh,
  getOfflineQueue,
  hydrateProjectUpdatePhotoPreviews,
  projectUpdateUploadedSince,
  queueProjectUpdateRecord,
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
    uploadAttemptCount: 1, lastUploadAttemptAt: '2026-09-30T08:00:00.000Z',
    createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z', importedAt: '2026-09-30T08:00:00.000Z',
    ...extra,
  };
}
/** An update as the phone saved it: through the App's own normalizer. */
const savedUpdate = (documents: Doc[], status = 'sent', id = 'u1'): Update => ({
  ...A.normalizeStoredUpdateRecord({
    id, projectName: 'P', date: '2026-09-30', notes: 'Pour', recipients: { contactIds: [] }, photos: [], documents,
  }),
  status,
});
const row = (updateData: Record<string, any>) => ({
  id: updateData.id, projectId: null, projectName: 'P', areaName: '', idempotencyKey: updateData.id,
  createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z', ownerId: 'o', updateData,
});
/** The cloud rows once the queued records have uploaded: what the iPad lists next. */
async function rowsAfterUpload(rows: Array<ReturnType<typeof row>>) {
  const queued = new Map((await getOfflineQueue())
    .filter(item => item.entity === 'project_update')
    .map(item => [(item.payload as { id: string }).id, (item.payload as { updateData: Record<string, any> }).updateData]));
  return rows.map(current => queued.has(current.id) ? row(queued.get(current.id)!) : current);
}
const queuedUpdate = async (id: string) => (await getOfflineQueue())
  .find(item => item.entity === 'project_update' && (item.payload as { id: string }).id === id)
  ?.payload as { updateData: Update } | undefined;

/** The refresh's project_updates run, compiled from App.tsx, on a device's own state. */
function refresh(device: Device, rows: Array<ReturnType<typeof row>>) {
  (listProjectUpdates as jest.Mock).mockResolvedValue({ ok: true, stubbed: false, data: rows });
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
    },
  );
  return run().then(() => device.render());
}

type Device = ReturnType<typeof device>;
/**
 * A device as these functions see it. State is set as React does; `render()`
 * reads it back into the refs, as each render does.
 */
function device(documents: Doc[], saved: Update[], options: {
  upload?: (onProgress: (progress: number) => void) => Promise<{ ok: boolean; error?: string }>;
  sharedRecord?: Record<string, unknown> | null;
  sensitive?: boolean;
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
    isComplianceSensitiveProjectDocument: () => Boolean(options.sensitive),
    findSharedReferenceDocumentForProjectDocument: () => options.sharedRecord ?? null,
    referenceDocumentsCurrentRef: { current: options.sharedRecord ? [options.sharedRecord] : [] },
    projectDocumentSharedRecordSync: { cancel: jest.fn() },
    deleteOwnedProjectDocument: async () => ({ status: 'deleted' }), hiddenSharedDocuments: { hide: jest.fn() },
    withdrawUnsentProjectDocumentBridge: async () => null, getOfflineQueue,
    removeOperationalRecordFromSyncQueue: async () => undefined, setReferenceDocuments: jest.fn(),
    removeReferenceDocumentEverywhere: async () => undefined,
    // A change the other devices must see goes up with its update (A7 pass 5 M1).
    queueProjectUpdateRecord, requestQueuedUpdateSync, fieldUpdatesToResendForDocument,
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
  return {
    ...fns, render, settle, press, alerts, requestQueuedUpdateSync, setSavedUpdates,
    projectDocumentsCurrentRef, savedUpdatesRef,
    saved: (id = 'u1') => savedState.find(update => update.id === id),
  };
}

const documentIds = (update: Update | undefined) => (update?.documents || []).map(document => document.id);

beforeEach(() => {
  mockStorage.clear();
  noteSignedInOwner('owner-a');
  (listProjectUpdates as jest.Mock).mockReset();
});

describe('a document taken off a sent field update stays off (audit A7 pass 5 M1 a)', () => {
  const setup = (options: Parameters<typeof device>[2] = {}) => {
    const permit = phoneDocument('permit', { status: 'uploaded', uploadedAt: '2026-09-30T08:05:00.000Z' });
    const survey = phoneDocument('survey', { status: 'uploaded', uploadedAt: '2026-09-30T08:06:00.000Z' });
    const sent = savedUpdate([permit, survey]);
    const draftListing = savedUpdate([permit], 'draft', 'u2');
    const rows = [row({ ...sent, status: 'queued' })];
    return { phone: device([permit, survey], [sent, draftListing], options), rows, sent };
  };

  it.each([
    ['Delete from This Device', {}],
    ['Delete from All Devices', { sharedRecord: { id: 'ref-permit', name: 'permit.pdf' } }],
  ] as const)('%s: the refresh keeps it off on the phone, and the iPad drops it too', async (choice, options) => {
    const { phone, rows, sent } = setup(options);
    phone.deleteProjectDocument('permit');
    await phone.press(choice);
    expect(documentIds(phone.saved())).toEqual(['survey']);

    // The shared update goes up again without it, and waits to sync.
    const queued = await queuedUpdate('u1');
    expect(queued && documentIds(queued.updateData)).toEqual(['survey']);
    expect(phone.saved()?.status).toBe('queued');
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalled();

    // A refresh before that upload lands still lists it in the cloud copy.
    await refresh(phone, rows);
    expect(documentIds(phone.saved())).toEqual(['survey']);

    // The iPad, which listed it from the cloud, lists it no more once it lands.
    const iPad = device([], [{ ...sent }]);
    await refresh(iPad, await rowsAfterUpload(rows));
    expect(documentIds(iPad.saved())).toEqual(['survey']);
  });

  it('a draft that lists it loses it on this device only; nothing is queued for it', async () => {
    const { phone } = setup();
    phone.deleteProjectDocument('permit');
    await phone.press('Delete from This Device');
    expect(documentIds(phone.saved('u2'))).toEqual([]);
    expect(await queuedUpdate('u2')).toBeUndefined();
  });

  it('the alert says the document comes off the field updates it was attached to', () => {
    const { phone } = setup();
    phone.deleteProjectDocument('permit');
    expect(phone.alerts.at(-1)?.message).toContain('Either way it is taken off any field update it was attached to.');
  });

  it('archiving a compliance document is not a delete: the update is not sent again', async () => {
    const { phone } = setup({ sensitive: true });
    phone.deleteProjectDocument('permit');
    await phone.press('Archive Permit');
    expect(await queuedUpdate('u1')).toBeUndefined();
  });
});

describe('a document uploaded after its update was sent reads uploaded (audit A7 pass 5 M1 b)', () => {
  const offlineAttached = () => phoneDocument('permit', { status: 'failed' });

  it('the phone: every refresh keeps its own upload state, during the upload and after it', async () => {
    const permit = offlineAttached();
    const sent = savedUpdate([permit]);
    const rows = [row({ ...sent, status: 'queued' })];
    let midUpload: Update | undefined;
    let queuedAtProgress: unknown[] = ['not checked'];
    const phone = device([permit], [sent], {
      upload: async onProgress => {
        onProgress(0.4);
        phone.render();
        queuedAtProgress = await getOfflineQueue();
        await refresh(phone, rows);
        midUpload = phone.saved();
        return { ok: true };
      },
    });
    expect(A.projectDocumentStatusDetail(phone.saved()!.documents![0])).toBe('Document upload failed · Retry');

    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await phone.settle();
    // A progress step is not sent anywhere.
    expect(queuedAtProgress).toEqual([]);
    // A refresh during the upload does not bring back "failed".
    expect(A.projectDocumentStatusDetail(midUpload!.documents![0])).toBe('Uploading 40%');

    await refresh(phone, rows);
    const [document] = phone.saved()!.documents!;
    expect(document.status).toBe('uploaded');
    expect(A.projectDocumentStatusDetail(document)).toMatch(/^Uploaded /);
  });

  it('the iPad: the update goes up again once, with the document uploaded', async () => {
    const permit = offlineAttached();
    const sent = savedUpdate([permit]);
    const rows = [row({ ...sent, status: 'queued' })];
    const phone = device([permit], [sent]);
    await phone.retryProjectDocumentUpload('permit');
    await phone.settle();
    expect(phone.saved()?.status).toBe('queued');
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalledTimes(1);
    expect((await queuedUpdate('u1'))?.updateData.documents?.[0].status).toBe('uploaded');

    const iPad = device([], [{ ...sent }]);
    await refresh(iPad, rows);
    expect(iPad.saved()!.documents![0].status).toBe('failed'); // before the phone's upload lands
    await refresh(iPad, await rowsAfterUpload(rows));
    expect(A.projectDocumentStatusDetail(iPad.saved()!.documents![0])).toMatch(/^Uploaded /);
  });

  it('a failed upload is not sent: its state stays on this device', async () => {
    const permit = offlineAttached();
    const phone = device([permit], [savedUpdate([permit])], { upload: async () => ({ ok: false, error: 'Network request failed' }) });
    await expect(phone.retryProjectDocumentUpload('permit')).resolves.toBe(false);
    await phone.settle();
    expect(await queuedUpdate('u1')).toBeUndefined();
    expect(phone.saved()?.status).toBe('sent');
  });

  it('a realtime echo of the older cloud copy keeps the phone\'s own upload state', async () => {
    const uploaded = phoneDocument('permit', { status: 'uploaded', uploadedAt: '2026-09-30T08:10:00.000Z', uploadProgress: 1 });
    const local = savedUpdate([uploaded]);
    const state = { projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: [local],
      deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [] };
    const commitUpdates = jest.fn();
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true, snapshot: () => state as never, getPendingQueue: async () => [],
      normalizeUpdate: A.normalizeStoredUpdateRecord as never, normalizeAreas: () => [], normalizeSchedule: () => [],
      normalizeDocuments: () => [], migrateSchedule: item => item, localPhotoUri: A.resolveProjectPhotoUri,
      mergeProjectNames: (names: string[]) => names, updateHasPendingLocalWork: () => false,
      deviceDocuments: () => [uploaded],
      mergeUpdates: A.mergeSavedUpdatesWithTombstones as never, buildUpdateTombstone: A.buildUpdateTombstone as never,
      buildCloudDeletionBarrier: A.buildCloudUpdateDeletionBarrier as never, upsertDeletedUpdate: A.upsertDeletedUpdateTombstone as never,
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    });
    const echo = { ...savedUpdate([offlineAttached()]), notes: 'Pour, edited on the iPad', status: 'queued' };
    await apply('project_update', { eventType: 'UPDATE', newRow: { id: 'u1', update_data: echo }, oldRow: null, raw: null });
    const [committed] = commitUpdates.mock.calls[0][0] as Update[];
    expect(committed.notes).toBe('Pour, edited on the iPad');
    expect(committed.documents![0]).toMatchObject({ status: 'uploaded', uploadedAt: '2026-09-30T08:10:00.000Z' });
  });
});

describe('an update sent before this fix is repaired once (audit A7 pass 5 M1 b)', () => {
  it('the phone\'s first refresh sends it again with the document uploaded; later refreshes do not', async () => {
    // Saved before this build: the phone uploaded the document after the
    // update was sent, and a refresh put the cloud copy's "failed" back.
    const uploaded = phoneDocument('older', { status: 'uploaded', uploadedAt: '2026-09-29T08:10:00.000Z' });
    const stale = savedUpdate([phoneDocument('older', { status: 'failed' })]);
    const rows = [row({ ...stale, status: 'queued' })];
    const phone = device([uploaded], [stale]);
    expect(A.projectDocumentStatusDetail(phone.saved()!.documents![0])).toBe('Document upload failed · Retry');

    await refresh(phone, rows);
    await phone.settle();
    expect(phone.saved()!.documents![0].status).toBe('uploaded');
    expect(phone.saved()!.status).toBe('queued');
    expect((await queuedUpdate('u1'))?.updateData.documents?.[0].status).toBe('uploaded');
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i += 1) await refresh(phone, rows); // still waiting to upload: nothing more is sent
    await phone.settle();
    expect(phone.requestQueuedUpdateSync).toHaveBeenCalledTimes(1);

    const iPad = device([], [{ ...stale }]);
    await refresh(iPad, await rowsAfterUpload(rows));
    expect(A.projectDocumentStatusDetail(iPad.saved()!.documents![0])).toMatch(/^Uploaded /);
  });

  it('a device that does not hold the file never sends the update', async () => {
    const stale = savedUpdate([phoneDocument('permit', { status: 'failed' })]);
    const iPad = device([], [stale]);
    await refresh(iPad, [row({ ...stale, status: 'queued' })]);
    expect(await getOfflineQueue()).toEqual([]);
    expect(iPad.saved()!.status).toBe('sent');
  });
});

describe('the upload-state rules (FieldUpdateDocumentUploadState)', () => {
  const held = phoneDocument('permit', { status: 'uploaded', uploadedAt: '2026-09-30T08:10:00.000Z' });

  it('takes only upload state from this device, and only for documents it holds', () => {
    const cloud = savedUpdate([
      phoneDocument('permit', { status: 'failed', name: 'renamed on the iPad.pdf' }),
      phoneDocument('survey', { status: 'failed' }),
    ]);
    const next = withDeviceDocumentUploadState(cloud, [held]);
    expect(next.documents![0]).toMatchObject({ status: 'uploaded', uploadedAt: held.uploadedAt, name: 'renamed on the iPad.pdf' });
    expect(next.documents![1]).toBe(cloud.documents![1]);
    // Nothing to change: the same objects, so a refresh sees no change.
    expect(withDeviceDocumentUploadState(next, [held])).toBe(next);
    expect(withDeviceDocumentUploadState(cloud, [])).toBe(cloud);
  });

  it('an out-of-date cloud copy is owed only when nothing is queued for it, and once per launch', () => {
    const survey = phoneDocument('survey', { status: 'uploaded', uploadedAt: '2026-09-30T08:10:00.000Z' });
    const local = savedUpdate([survey]);
    const cloudSays = (status: string) => [savedUpdate([phoneDocument('survey', { status })])];
    const queued = [{ id: 'project-update-u1', entity: 'project_update', operation: 'update', payload: { id: 'u1', updateData: local },
      createdAt: 't', changedAt: 't', retryCount: 0 }] as never[];
    expect(documentsUploadedAfterCloudCopy(cloudSays('uploaded'), [local], [], [survey])).toEqual([]);
    expect(documentsUploadedAfterCloudCopy(cloudSays('failed'), [local], queued, [survey])).toEqual([]);
    expect(documentsUploadedAfterCloudCopy(cloudSays('failed'), [local], [], [phoneDocument('survey', { status: 'failed' })])).toEqual([]);
    expect(documentsUploadedAfterCloudCopy(cloudSays('failed'), [local], [], [survey])).toEqual(['survey']);
    expect(documentsUploadedAfterCloudCopy(cloudSays('failed'), [local], [], [survey])).toEqual([]);
  });

  it('sends again only updates that have been, or are waiting to be, sent, and never an archived one', () => {
    const listing = (status: string, extra: Record<string, unknown> = {}) =>
      ({ ...savedUpdate([held], status, `u-${status}`), ...extra }) as Update & { status: never };
    const updates = [listing('sent'), listing('queued'), listing('failed'), listing('draft'), listing('ready_to_send'),
      { ...listing('sent'), id: 'u-archived', isArchived: true }, { ...savedUpdate([], 'sent', 'u-other') } as never];
    const resent = fieldUpdatesToResendForDocument(updates, 'permit', update => withoutFieldUpdateDocument(update, 'permit'));
    expect(resent.map(update => [update.id, update.status, update.documents?.length])).toEqual([
      ['u-sent', 'queued', 0], ['u-queued', 'queued', 0], ['u-failed', 'failed', 0],
    ]);
  });
});
