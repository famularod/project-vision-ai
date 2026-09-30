/**
 * Audit A7 M3 (30 Sep 2026): photos taken on one device showed blank on the
 * other, and after a restore a restored photo copy lost its reference at the
 * next launch. Also A7 M5: a refresh put a row listed before this device's own
 * upload over the newer local copy. Runs the App's own photo resolvers, normalizers, merge and the
 * project_updates refresh closure, compiled from App.tsx, with the real
 * SyncService preview hydration, realtime applier, cloud-recovery merge and
 * queue matcher. Network is mocked; no Supabase call is made. (Harness from
 * the audit's verifier.)
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []), multiSet: jest.fn(async () => undefined),
  },
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
const mockExisting = new Set<string>();
const mockUnreadable = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Documents/',
  cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/',
  getInfoAsync: jest.fn(async (uri: string) => {
    if (mockUnreadable.has(uri)) throw new Error('file system busy');
    return mockExisting.has(uri)
    ? { exists: true, isDirectory: false, size: 1234, modificationTime: 1 }
    : { exists: false };
  }),
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

import { createPhotoSignedUrl, listProjectUpdates } from '../../services/SupabaseService';
import {
  cloudPhotoPreviewIsFresh,
  hydrateProjectUpdatePhotoPreviews,
  projectUpdateUploadedSince,
} from '../../services/SyncService';
import { loadCloudUpdates } from '../../services/updateService';
import { resolveLegacyOwnedLocalFilePath } from '../../services/OwnedLocalFileRepository';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { hasMatchingQueuedProjectUpdateRevision } from '../../services/ProjectUpdateQueueRevision';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { preserveLocalPhotoTransport } from '../../services/ProjectPhotoTransport';
import { normalizeStartupArray } from '../../services/StartupRecovery';
import { optionalString, uid } from '../../services/RecordValues';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A top-level function of App.tsx (optionally exported/async), up to the next top-level declaration. */
function appFunction(name: string): string {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const rest = app.slice(match.index + 1).replace(/^export /, '');
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}

/** The body of the refresh's project_updates `run` closure, brace-matched. */
function refreshRunBody(): string {
  const marker = "collectionRefreshes.push({ name: 'project_updates', run: async () => {";
  const start = app.indexOf(marker);
  if (start < 0) throw new Error('refresh closure not found');
  const open = start + marker.length - 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(open, index + 1);
    }
  }
  throw new Error('unbalanced closure');
}

const DOCUMENTS = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/';
const PHOTO_STORAGE_FOLDER = 'project-photos';
const PHOTO_STORAGE_DIR = `${DOCUMENTS}${PHOTO_STORAGE_FOLDER}/`;
const RECOVERED_PHOTO_CACHE_FOLDER = 'dave-recovered-project-photos';

const helperNames = [
  'resolveProjectPhotoUri', 'resolveProjectPhotoDisplayUri', 'optionalNumber', 'normalizePhoto',
  'uniqueStrings', 'normalizeRecipientSelection', 'normalizeUpdate', 'normalizeStoredUpdateRecord',
  'isRecord', 'lifecycleStatusForUpdate', 'updateNeedsAutomaticSyncRetry', 'mergeSavedUpdatesWithTombstones',
  'buildUpdateTombstone', 'buildCloudUpdateDeletionBarrier', 'upsertDeletedUpdateTombstone',
];
const compiled = ts.transpileModule(
  [...helperNames.map(appFunction), `module.exports = { ${helperNames.join(', ')} };`].join('\n'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const appModule = { exports: {} as Record<string, (...args: never[]) => unknown> };
const injected: Record<string, unknown> = {
  PHOTO_STORAGE_DIR, PHOTO_STORAGE_FOLDER, RECOVERED_PHOTO_CACHE_FOLDER,
  FileSystem: { cacheDirectory: 'file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/' },
  resolveLegacyOwnedLocalFilePath, cloudPhotoPreviewIsFresh, optionalString, uid,
  mergeLocalUpdateWithCloudCopy,
  CATEGORIES: ['Open Issue', 'Safety Concern', 'Update'],
  ACTION_STATUSES: ['Open', 'In Progress', 'Waiting', 'Closed'],
  QUICK_CONTEXTS: [], DEFAULT_PROJECTS: ['P'], isoToday: () => '2026-09-30',
  // Non-photo sub-normalizers are not under test here; photos go through the real normalizePhoto.
  normalizeFieldUpdateDocuments: () => [], authorityProjectId: () => null,
  normalizeInterpretationDecisionLog: () => [], normalizeFieldUpdateSyncDiagnostics: (value: unknown) => value ?? null,
  normalizeFieldUpdateDeleteDiagnostics: (value: unknown) => value ?? null,
  normalizeWorkflowTimestamps: (value: unknown) => value ?? {},
  migrateLegacyProjectUpdate: (value: unknown) => value, // project "P" is not a legacy work container
};
new Function('module', 'exports', ...Object.keys(injected), compiled)(appModule, appModule.exports, ...Object.values(injected));
const A = appModule.exports as unknown as {
  resolveProjectPhotoUri: (photo: unknown) => string;
  resolveProjectPhotoDisplayUri: (photo: unknown) => string;
  normalizeStoredUpdateRecord: (value: unknown) => Record<string, any>;
  mergeSavedUpdatesWithTombstones: (input: { localUpdates: unknown[]; cloudUpdates: unknown[]; tombstones: unknown[] }) => Array<Record<string, any>>;
  buildUpdateTombstone: (...args: unknown[]) => unknown;
  buildCloudUpdateDeletionBarrier: (...args: unknown[]) => unknown;
  upsertDeletedUpdateTombstone: (...args: unknown[]) => unknown[];
};

/** The refresh closure, compiled from App.tsx, with its free variables supplied. */
function makeRefresh(deps: Record<string, unknown>) {
  const js = ts.transpileModule(`module.exports = async function () ${refreshRunBody()}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as unknown as () => Promise<void> };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports as unknown as () => Promise<void>;
}

const signed = createPhotoSignedUrl as jest.Mock;
const listUpdates = listProjectUpdates as jest.Mock;
const OLD = 'file:///var/mobile/Containers/Data/Application/OLD-OR-OTHER-DEVICE/Documents/project-photos/';
const photo = (id: string, uri: string, extra: Record<string, unknown> = {}) => ({
  id, uri, caption: `c-${id}`, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', fileName: `IMG_${id}.jpg`, mimeType: 'image/jpeg', cloudStoragePath: `p/u1/${id}-IMG_${id}.jpg`, ...extra,
});
const cloudRow = (notes = 'Rebar placed', photos = [photo('p1', `${OLD}aaa-IMG_p1.jpg`), photo('p2', `${OLD}bbb-IMG_p2.jpg`)]) => ({
  id: 'u1', projectId: null, projectName: 'P', areaName: '', idempotencyKey: 'u1', createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z', ownerId: 'o',
  updateData: { id: 'u1', projectName: 'P', date: '2026-09-20', notes, recipients: { contactIds: [] }, status: 'queued', photos },
});
const exists = async (uri: string) => mockExisting.has(uri);

function refreshDeps(
  state: { saved: unknown[]; queue: unknown[] },
  onList?: () => void,
  rows = [cloudRow()],
  uploadedSince: (id: string, since: number) => boolean = projectUpdateUploadedSince,
) {
  const savedUpdatesRef = { current: state.saved };
  listUpdates.mockImplementation(async () => { onList?.(); return { ok: true, stubbed: false, data: rows }; });
  return {
    savedUpdatesRef,
    run: makeRefresh({
      listProjectUpdates, active: true,
      refreshCommit: { isCurrent: () => true, commit: (effect: () => void) => { effect(); return true; } },
      normalizeStartupArray, normalizeStoredUpdateRecord: A.normalizeStoredUpdateRecord, savedUpdatesRef,
      resolveProjectPhotoUri: A.resolveProjectPhotoUri, preserveLocalPhotoTransport,
      hydrateProjectUpdatePhotoPreviews, getOfflineQueue: async () => state.queue,
      deletedUpdateTombstonesRef: { current: [] }, buildUpdateTombstone: A.buildUpdateTombstone,
      upsertDeletedUpdateTombstone: A.upsertDeletedUpdateTombstone, hasMatchingQueuedProjectUpdateRevision,
      projectUpdateUploadedSince: uploadedSince,
      mergeSavedUpdatesWithTombstones: A.mergeSavedUpdatesWithTombstones,
      setDeletedUpdateTombstones: () => undefined, setSavedUpdates: () => undefined,
    }),
  };
}

beforeEach(() => {
  mockExisting.clear();
  mockUnreadable.clear();
  signed.mockReset().mockImplementation(async (storagePath: string) => ({
    ok: true, stubbed: false, data: `https://signed.example/${storagePath}?preview`,
  }));
  listUpdates.mockReset();
});



const displays = (update: Record<string, any>) =>
  update.photos.map((item: unknown) => A.resolveProjectPhotoDisplayUri(item));
const SIGNED = /^https:\/\/signed\.example\//;

describe('photos on a device that does not hold their file (audit A7 M3)', () => {
  it('same phone after an app update: the file is found and kept, no preview signed', async () => {
    mockExisting.add(`${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`);
    mockExisting.add(`${PHOTO_STORAGE_DIR}bbb-IMG_p2.jpg`);
    listUpdates.mockResolvedValue({ ok: true, stubbed: false, data: [cloudRow()] });
    const [normalized] = normalizeStartupArray(await loadCloudUpdates(), A.normalizeStoredUpdateRecord, 'cloud').value;
    expect(signed).not.toHaveBeenCalled();
    expect(displays(normalized))
      .toEqual([`${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`, `${PHOTO_STORAGE_DIR}bbb-IMG_p2.jpg`]);
    const { run, savedUpdatesRef } = refreshDeps({ saved: [normalized], queue: [] });
    await run();
    expect(displays((savedUpdatesRef.current as Array<Record<string, any>>)[0]))
      .toEqual([`${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`, `${PHOTO_STORAGE_DIR}bbb-IMG_p2.jpg`]);
    expect(signed).not.toHaveBeenCalled();
  });

  it('another device: startup, refresh and realtime all display the preview', async () => {
    listUpdates.mockResolvedValue({ ok: true, stubbed: false, data: [cloudRow()] });
    const [startup] = normalizeStartupArray(await loadCloudUpdates(), A.normalizeStoredUpdateRecord, 'cloud').value;
    expect(displays(startup).every((uri: string) => SIGNED.test(uri))).toBe(true);
    const { run, savedUpdatesRef } = refreshDeps({ saved: [], queue: [] });
    await run();
    expect(displays((savedUpdatesRef.current as Array<Record<string, any>>)[0])
      .every((uri: string) => SIGNED.test(uri))).toBe(true);
  });

  it('clears the other device\'s path the iPad already saved, and signs no preview it still holds', async () => {
    // Build 228 state: an earlier refresh saved the iPhone's path, which
    // resolves into this device's photo folder where no such file exists.
    const saved = A.normalizeStoredUpdateRecord({ ...cloudRow().updateData, status: 'sent' });
    expect(displays(saved)[0]).toBe(`${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`);
    const first = refreshDeps({ saved: [saved], queue: [] });
    await first.run();
    const [after] = first.savedUpdatesRef.current as Array<Record<string, any>>;
    expect(after.photos.map((item: { uri: string }) => item.uri)).toEqual(['', '']);
    expect(displays(after).every((uri: string) => SIGNED.test(uri))).toBe(true);
    // The saved copy keeps its cloud path, so reloading never drops the photo.
    const reloaded = A.normalizeStoredUpdateRecord(JSON.parse(JSON.stringify(after)));
    expect(reloaded.photos.map((item: { id: string }) => item.id)).toEqual(['p1', 'p2']);

    signed.mockClear();
    const second = refreshDeps({ saved: [reloaded], queue: [] });
    await second.run();
    expect(displays((second.savedUpdatesRef.current as Array<Record<string, any>>)[0])
      .every((uri: string) => SIGNED.test(uri))).toBe(true);
    expect(signed).not.toHaveBeenCalled();
  });

  it('keeps a path whose file cannot be checked, so a file on this device is never orphaned', async () => {
    const onDevice = `${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`;
    mockUnreadable.add(onDevice);
    mockUnreadable.add(`${OLD}aaa-IMG_p1.jpg`);
    const saved = A.normalizeStoredUpdateRecord({ ...cloudRow().updateData, status: 'sent' });
    const { run, savedUpdatesRef } = refreshDeps({ saved: [saved], queue: [] });
    await run();
    const [after] = savedUpdatesRef.current as Array<Record<string, any>>;
    expect(after.photos[0].uri).toBe(onDevice);
    expect(after.photos[1].uri).toBe('');
  });

  it('a cleared photo keeps a cloud path even when its row carried none', async () => {
    const row = cloudRow('Rebar placed', [photo('p1', `${OLD}aaa-IMG_p1.jpg`, { cloudStoragePath: null })]);
    listUpdates.mockResolvedValue({ ok: true, stubbed: false, data: [row] });
    const [startup] = normalizeStartupArray(await loadCloudUpdates(), A.normalizeStoredUpdateRecord, 'cloud').value;
    expect(startup.photos[0]).toMatchObject({ uri: '', cloudStoragePath: 'p/u1/p1-img_p1.jpg' });
    expect(A.normalizeStoredUpdateRecord(startup).photos).toHaveLength(1);

    // With a preview still usable nothing is signed, and the path must still be set.
    signed.mockClear();
    const held = await hydrateProjectUpdatePhotoPreviews({
      ...row.updateData,
      photos: [photo('p1', `${OLD}aaa-IMG_p1.jpg`, {
        cloudStoragePath: null,
        cloudPreviewUri: 'https://signed.example/held?preview',
        cloudPreviewSignedUrlExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })],
    } as never) as unknown as Record<string, any>;
    expect(signed).not.toHaveBeenCalled();
    expect(held.photos[0]).toMatchObject({ uri: '', cloudStoragePath: 'p/u1/p1-img_p1.jpg' });
    expect(A.normalizeStoredUpdateRecord(held).photos).toHaveLength(1);
  });

  it('a refresh keeps this device\'s usable preview for a photo with no file here, not an expired one', () => {
    const now = Date.parse('2026-09-30T12:00:00.000Z');
    const cloudPhoto = photo('p1', `${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`);
    const local = (expiresInMs: number) => ({
      photos: [photo('p1', '', {
        cloudPreviewUri: 'https://signed.example/local?preview',
        cloudPreviewSignedUrlExpiresAt: new Date(now + expiresInMs).toISOString(),
      })],
    });
    expect(preserveLocalPhotoTransport(cloudPhoto as never, local(60_000) as never, A.resolveProjectPhotoUri, now))
      .toMatchObject({ cloudPreviewUri: 'https://signed.example/local?preview' });
    expect((preserveLocalPhotoTransport(cloudPhoto as never, local(-60_000) as never, A.resolveProjectPhotoUri, now) as { cloudPreviewUri?: string })
      .cloudPreviewUri).toBeUndefined();
  });

  it('an expired recovered signed URL is replaced by a preview', async () => {
    const hydrated = await hydrateProjectUpdatePhotoPreviews({
      ...cloudRow().updateData,
      photos: [photo('p1', 'https://old-signed.example/p1', {
        cloudRecoveryStatus: 'signed_url',
        cloudSignedUrlExpiresAt: '2026-01-01T00:00:00.000Z',
      })],
    } as never) as unknown as Record<string, any>;
    expect(hydrated.photos[0]).toMatchObject({ uri: '', cloudRecoveryStatus: null, cloudSignedUrlExpiresAt: null });
    expect(A.resolveProjectPhotoDisplayUri(hydrated.photos[0])).toMatch(SIGNED);
  });

  it('restore on a fresh install: relaunch keeps the restored file; a photo the backup lacked shows its preview', async () => {
    const restoredFile = `${PHOTO_STORAGE_DIR}newid-IMG_p1.jpg`;
    mockExisting.add(restoredFile);
    const restored = A.normalizeStoredUpdateRecord({ ...cloudRow().updateData, status: 'sent', photos: [photo('p1', restoredFile), photo('p2', '')] });
    listUpdates.mockResolvedValue({ ok: true, stubbed: false, data: [cloudRow()] });
    const cloud = normalizeStartupArray(await loadCloudUpdates(), A.normalizeStoredUpdateRecord, 'cloud').value;
    const [merged] = A.mergeSavedUpdatesWithTombstones({ localUpdates: [restored], cloudUpdates: cloud, tombstones: [] });
    expect(merged.photos[0].uri).toBe(restoredFile);
    expect(A.resolveProjectPhotoDisplayUri(merged.photos[1])).toMatch(SIGNED);
    const { run, savedUpdatesRef } = refreshDeps({ saved: [merged], queue: [] });
    await run();
    const [after] = savedUpdatesRef.current as Array<Record<string, any>>;
    expect(A.resolveProjectPhotoDisplayUri(after.photos[0])).toBe(restoredFile);
    expect(A.resolveProjectPhotoDisplayUri(after.photos[1])).toMatch(SIGNED);
  });

  it('the launch merge keeps a restored path even against a cloud row whose own path still resolves', () => {
    const restoredFile = `${PHOTO_STORAGE_DIR}newid-IMG_p1.jpg`;
    const local = { ...cloudRow().updateData, status: 'sent', photos: [photo('p1', restoredFile)] };
    const cloudPlain = { ...cloudRow().updateData, photos: [photo('p1', `${PHOTO_STORAGE_DIR}aaa-IMG_p1.jpg`)] };
    const mergedUri = (cloud: unknown) =>
      (mergeLocalUpdateWithCloudCopy(local as never, cloud as never) as unknown as { photos: Array<{ uri: string }> })
        .photos[0].uri;
    expect(mergedUri(cloudPlain)).toBe(restoredFile);
    // A copy this device fetched from the cloud still stands in for a missing one.
    const cached = `file:///var/mobile/Containers/Data/Application/NEW/Library/Caches/${RECOVERED_PHOTO_CACHE_FOLDER}/p1.jpg`;
    const cloudCached = { ...cloudRow().updateData, photos: [photo('p1', cached, { cloudRecoveryStatus: 'cached' })] };
    expect(mergedUri(cloudCached)).toBe(cached);
  });

  it('realtime row on a device without the file: preview displayed', async () => {
    const commitUpdates = jest.fn();
    const state = { projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [], updates: [] as unknown[],
      deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [] };
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true, snapshot: () => state as never, getPendingQueue: async () => [],
      normalizeUpdate: A.normalizeStoredUpdateRecord as never, normalizeAreas: () => [], normalizeSchedule: () => [],
      normalizeDocuments: () => [], migrateSchedule: item => item, localPhotoUri: A.resolveProjectPhotoUri,
      mergeProjectNames: (names: string[]) => names, updateHasPendingLocalWork: () => false,
      mergeUpdates: A.mergeSavedUpdatesWithTombstones as never, buildUpdateTombstone: A.buildUpdateTombstone as never,
      buildCloudDeletionBarrier: A.buildCloudUpdateDeletionBarrier as never, upsertDeletedUpdate: A.upsertDeletedUpdateTombstone as never,
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    });
    await apply('project_update', { eventType: 'UPDATE', newRow: { id: 'u1', update_data: cloudRow().updateData }, oldRow: null, raw: null });
    const [committed] = commitUpdates.mock.calls[0][0] as Array<Record<string, any>>;
    expect(A.resolveProjectPhotoDisplayUri(committed.photos[0])).toMatch(SIGNED);
  });
});

describe('a refresh racing this device\'s own upload (audit A7 M5)', () => {
  const uploadedAt = new Map<string, number>();
  const uploadedSince = (id: string, since: number) => (uploadedAt.get(id) ?? -1) >= since;
  const v1 = () => cloudRow('Rebar placed', []).updateData;
  const vN = (notes: string, status: string) => ({ ...A.normalizeStoredUpdateRecord({ ...v1(), notes }), status });
  const queued = (updateData: unknown) => ({ id: 'project-update-u1', entity: 'project_update', operation: 'update',
    payload: { id: 'u1', updateData }, createdAt: 't', changedAt: '2026-09-30T12:00:00.000Z', retryCount: 0 });
  const rowsV1 = [cloudRow('Rebar placed', [])];
  const notes = (ref: { current: unknown[] }) => (ref.current as Array<Record<string, any>>)[0].notes;
  beforeEach(() => uploadedAt.clear());

  it('keeps a queued edit that uploads while the rows are listed', async () => {
    const local = vN('v2', 'queued');
    const state = { saved: [local] as unknown[], queue: [queued(local)] as unknown[] };
    const { run, savedUpdatesRef } = refreshDeps(state, () => {
      uploadedAt.set('u1', Date.now()); state.queue = []; savedUpdatesRef.current = [{ ...local, status: 'sent' }];
    }, rowsV1, uploadedSince);
    await run();
    expect(notes(savedUpdatesRef)).toBe('v2');
  });

  it('keeps an edit made and uploaded entirely while the rows are listed', async () => {
    const state = { saved: [vN('v2', 'sent')] as unknown[], queue: [] as unknown[] };
    const { run, savedUpdatesRef } = refreshDeps(state, () => {
      uploadedAt.set('u1', Date.now()); savedUpdatesRef.current = [vN('v3', 'sent')];
    }, rowsV1, uploadedSince);
    await run();
    expect(notes(savedUpdatesRef)).toBe('v3');
  });

  it('still takes another device\'s newer row over an idle local copy', async () => {
    uploadedAt.set('u1', Date.now() - 60_000);
    const { run, savedUpdatesRef } = refreshDeps(
      { saved: [vN('old', 'sent')], queue: [] }, undefined, [cloudRow('iPad edit', [])], uploadedSince,
    );
    await run();
    expect(notes(savedUpdatesRef)).toBe('iPad edit');
  });
});
