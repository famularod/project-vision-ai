/**
 * Review pass 1, sync, finding G2 (older; owner answer Q45 (6 Oct)): a document's FILE across a change of account.
 *
 * The document store's own code (services/ReferenceDocumentRepository.ts prepareReferenceDocumentForCloud) measures
 * and hashes the file (seconds; up to 50 MB) and then uploads it. Sync batch Y4 stopped that from STARTING once the
 * account had changed. When the account changed while the file was being measured or hashed, the file was still
 * sent, with no account named at all, so as whoever was signed in by then. (The reviewer confirmed this by reading;
 * he wrote no test for it.)
 *
 * The rig is sync batch Y4's (tests/services/sync-batch-y4-account-boundary.test.ts): the real SyncService and queue,
 * a fresh one for each run, the cloud calls mocked at SupabaseService, and the account change made by the sign-in
 * events' own binding update. Here the document store is the REAL one, and the file's measuring and hashing are
 * stand-ins at which a test can change the account. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const shared = globalThis as { reviewP5G2Storage?: Map<string, string> };
  const values = (shared.reviewP5G2Storage ??= new Map<string, string>());
  const api = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([k, v]) => values.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach(k => values.delete(k)); },
    clear: async () => values.clear(),
  };
  return { __esModule: true, default: api, ...api };
});
// Passes run only when a test runs them.
jest.mock('../../services/BackgroundTaskGuard', () => ({
  ...jest.requireActual('../../services/BackgroundTaskGuard'),
  startGuardedBackgroundTask: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///phone/Documents/',
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
type CloudCall = { name: string; as: string | null };
/** Every cloud call made, in the order they began, with the account each was told it must be made as. */
const mockCalls: CloudCall[] = [];
/** A test changes the account while the file is at this step. */
const mockChange = { during: null as null | 'measuring' | 'hashing', made: false, make: (() => undefined) as () => void };
const mockFileSteps: string[] = [];
const mockFileStep = async (step: 'measuring' | 'hashing') => {
  mockFileSteps.push(step);
  await Promise.resolve();
  if (mockChange.during === step && !mockChange.made) {
    mockChange.made = true;
    mockChange.make();
  }
};
jest.mock('../../services/FileSizePreflight', () => ({
  ...jest.requireActual('../../services/FileSizePreflight'),
  preflightExpoFileRead: jest.fn(async () => { await mockFileStep('measuring'); return { sizeBytes: 4096 }; }),
  hashExpoFileSha256: jest.fn(async () => { await mockFileStep('hashing'); return { sha256: 'c'.repeat(64), sizeBytes: 4096 }; }),
}));
const mockAnswers: Record<string, () => unknown> = {
  listProjects: () => [{ id: PROJECT_ID, name: 'Canopy B' }],
  uploadPhoto: () => ({ bucket: 'project-documents', path: 'mobile/document-of-a/permit.pdf', fullPath: null }),
};
function mockCloudCall(name: string, answer: () => unknown) {
  return async () => {
    const binding = jest.requireActual('../../services/CloudOwnerBinding') as Partial<typeof import('../../services/CloudOwnerBinding')>;
    mockCalls.push({ name, as: binding.cloudOwnerExpectedForThisCall?.() ?? null });
    await Promise.resolve();
    return answer();
  };
}
jest.mock('../../services/SupabaseService', () => new Proxy({} as Record<string, unknown>, {
  get: (_target, key) => {
    if (typeof key !== 'string' || key === 'then') return undefined;
    if (key === '__esModule') return false;
    if (key === 'getSupabaseConfigurationStatus') return () => ({ configured: true, message: 'Configured.' });
    if (key === 'testSupabaseConnection') return async () => ({ connected: true, projectCount: 1 });
    return mockCloudCall(key, () => ({ ok: true, configured: true, stubbed: false, data: key in mockAnswers ? mockAnswers[key]() : [] }));
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

type Sync = typeof import('../../services/SyncService');
type Binding = typeof import('../../services/CloudOwnerBinding');
/** The app, started afresh on this phone: nothing held in memory. Account A is signed in. */
function startApp() {
  jest.resetModules();
  const binding = require('../../services/CloudOwnerBinding') as Binding;
  const sync = require('../../services/SyncService') as Sync;
  binding.noteSignedInOwner('owner-a');
  mockCalls.length = 0;
  mockFileSteps.length = 0;
  Object.assign(mockChange, { during: null, made: false, make: () => { binding.noteSignedInOwner(null); binding.noteSignedInOwner('owner-b'); } });
  return sync;
}
const named = (name: string) => mockCalls.filter(call => call.name === name);
const ACCOUNT_CHANGED = 'The account changed during sync. Work not yet sent waits for the account that saved it.';

const document = {
  id: 'document-of-a', name: 'Permit', category: 'Permit', projectName: 'Canopy B', projectNames: ['Canopy B'],
  uri: 'file:///phone/Documents/project-documents/permit-of-a.pdf',
  originalFileName: 'permit.pdf', mimeType: 'application/pdf', importedAt: '2026-09-30T08:05:00.000Z', updatedAt: '2026-09-30T08:05:00.000Z',
};
const syncNow = (sync: Sync) => sync.synchronizeLocalData({
  projects: [], savedUpdates: [], scheduleItems: [], projectAreas: [], referenceDocuments: [document],
} as never);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('G2: a waiting document, and the account changes while its file is being measured or hashed', () => {
  it('control: no change of account. The file is measured, hashed and sent as the account the document was queued under, then its record', async () => {
    const sync = startApp();
    await sync.queueReferenceDocumentRecord(document as never, false);

    const result = await sync.uploadPendingChanges();

    expect(mockFileSteps).toEqual(['measuring', 'hashing']);
    // Before, the file's upload named no account to the cloud layer (as: null): it left as whoever was signed in.
    expect(named('uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: 'owner-a' }]);
    expect(named('upsertReferenceDocument')).toEqual([{ name: 'upsertReferenceDocument', as: 'owner-a' }]);
    expect(result.errors).toEqual([]);
    await expect(sync.getOfflineQueue()).resolves.toEqual([]);
  });

  it.each(['measuring', 'hashing'] as const)('the account changes while the file is "%s": the file is not sent, its record is not written, and the document still waits for account A', async step => {
    const sync = startApp();
    await sync.queueReferenceDocumentRecord(document as never, false);
    mockChange.during = step;

    await sync.uploadPendingChanges();

    expect(mockChange.made).toBe(true);
    expect(named('uploadPhoto')).toEqual([]);
    expect(named('upsertReferenceDocument')).toEqual([]);
    expect((await sync.getOfflineQueue()).map(item => [item.entity, item.ownerId])).toEqual([['reference_document', 'owner-a']]);
  });

  it('a document an earlier build queued with no account recorded: its file is sent as the account the pass began with', async () => {
    const sync = startApp();
    await sync.queueReferenceDocumentRecord(document as never, false);
    const key = 'projectVisionAI.syncQueue.v1'; // the waiting uploads, as the phone stores them
    const stored = JSON.parse((await AsyncStorage.getItem(key))!) as Array<Record<string, unknown>>;
    await AsyncStorage.setItem(key, JSON.stringify(stored.map(({ ownerId: _ownerId, ...item }) => item)));

    await startApp().uploadPendingChanges();

    expect(named('uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: 'owner-a' }]);
  });

  it('before the app knows who is signed in, a document queued under account A has its file sent only as account A', async () => {
    const sync = startApp();
    await sync.queueReferenceDocumentRecord(document as never, false);
    // The app is closed and opened again; no sign-in event has arrived yet.
    jest.resetModules();
    const again = require('../../services/SyncService') as Sync;
    expect((require('../../services/CloudOwnerBinding') as Binding).currentCloudOwner().ownerId).toBeUndefined();
    mockCalls.length = 0;

    await again.uploadPendingChanges();

    expect(named('uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: 'owner-a' }]);
  });
});

describe('G2: Sync Now, a document only on this phone', () => {
  it('control: no change of account. The file and the record are sent as the account Sync Now began with', async () => {
    const sync = startApp();

    await syncNow(sync);

    expect(named('uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: 'owner-a' }]);
    expect(named('upsertReferenceDocument')).toEqual([{ name: 'upsertReferenceDocument', as: 'owner-a' }]);
  });

  it.each(['measuring', 'hashing'] as const)('the account changes while the file is "%s": neither the file nor the record is sent, and Sync Now says the account changed', async step => {
    const sync = startApp();
    mockChange.during = step;

    const result = await syncNow(sync);

    expect(mockChange.made).toBe(true);
    expect(named('uploadPhoto')).toEqual([]);
    expect(named('upsertReferenceDocument')).toEqual([]);
    expect(result.errors.join(' ')).toMatch(/account changed during sync/i);
  });
});

describe('G2: the document store itself', () => {
  it('every other caller: with no upload handed in, the file is sent as it always was (no account named)', async () => {
    startApp();
    const store = require('../../services/ReferenceDocumentRepository') as typeof import('../../services/ReferenceDocumentRepository');
    const prepared = await store.prepareReferenceDocumentForCloud(document as never);
    expect(named('uploadPhoto')).toEqual([{ name: 'uploadPhoto', as: null }]);
    expect(prepared).toMatchObject({ storagePath: 'mobile/document-of-a/permit.pdf', contentSha256: 'c'.repeat(64), sizeBytes: 4096 });
  });

  it('the upload handed in is used after the file was measured and hashed, and a refusal leaves the document with no cloud file (so its record is not written)', async () => {
    startApp();
    const store = require('../../services/ReferenceDocumentRepository') as typeof import('../../services/ReferenceDocumentRepository');
    const asked: string[] = [];
    const prepared = await store.prepareReferenceDocumentForCloud(document as never, async file => {
      asked.push(`${mockFileSteps.join(',')} then ${file.bucket}/${file.path}`);
      return { ok: false, configured: true, stubbed: false, data: null, error: ACCOUNT_CHANGED } as never;
    });
    expect(asked).toEqual(['measuring,hashing then project-documents/mobile/document-of-a/permit.pdf']);
    expect(named('uploadPhoto')).toEqual([]);
    expect(prepared.storagePath).toBeUndefined();
  });
});
